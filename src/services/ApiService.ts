import * as vscode from "vscode";
import { clearPreEditSnapshot, getPreEditSnapshot } from "../aiUndoTelemetry";
import { streamOpenAiCompatibleSse } from "../openAiCompatibleStream";
import {
  sanitizeAssistantMarkdownForUi,
  tryRecoverToolCallsFromAssistantText,
} from "../toolCallTextRecovery";
import { showChangedRangeHighlight, clearHighlight } from "../mutationHighlight";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import type { BuildUltraSettings } from "../buildUltraSettings";
import { assembleChatMessages } from "../chatPrompt/assembleMessages";
import { buildWorkstationChatRequestBody } from "../chatPrompt/workstationRequest";
import type { ChatPayload } from "../types/chatPayload";
import type { HostToWebviewMessage } from "../shared/messages";
import type { AuthService } from "./AuthService";
import type { PromptBuilderService } from "./PromptBuilderService";
import type { ToolCallWire, ToolExecutionResult, ToolExecutionService } from "./ToolExecutionService";

const MAX_TOOL_ROUNDS = 8;

type SseJson = {
  delta?: string;
  error?: string;
  tool_calls?: ToolCallWire[];
  remaining_tokens?: number;
  usage_total_tokens?: number;
};

type Conv = NonNullable<ChatPayload["conversationOverride"]>;

/**
 * **Cloud:** calls the Supabase `chat` Edge Function with the user JWT and streams SSE to the webview.
 *
 * **Workstation:** POSTs OpenAI-compatible chat completions to the configured private compute base URL;
 * tools and prompts are assembled in the extension (`src/chatPrompt/`).
 *
 * **Request:** `POST /functions/v1/chat` with JSON body = `ChatPayload` (see `chatPayload.ts`).
 *
 * **Response (SSE):** `Content-Type: text/event-stream`. Each event line:
 * `data: {"delta":"..."}\n\n` — append `delta` to the assistant message. Optional terminal
 * event: `data: [DONE]\n\n`. Lines may include `{ "error": "..." }` to signal failure.
 * Tool rounds emit `data: {"tool_calls":[...]}\n\n` before `[DONE]`.
 * Upstream API keys for **Cloud** stay in Edge env. **Workstation** uses the compute API key from Secret Storage.
 */
export class ApiService {
  private readonly editReviewUris = new Map<string, vscode.Uri>();

  /** Serial chat turns — never overlap SEND_MESSAGE handlers without blocking the textarea. */
  private chatTurnQueue: Promise<void> = Promise.resolve();

  /**
   * Tool fingerprints that failed last batch so the next duplicate invocation is skipped once
   * (duplicate model retries after failures).
   */
  private prevFailedToolFingerprints = new Set<string>();

  constructor(
    private readonly settings: BuildUltraSettings,
    private readonly auth: AuthService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly tools: ToolExecutionService,
    private readonly postToWebview: (msg: HostToWebviewMessage) => void
  ) {}

  /** Legacy no-op (tool plan UI removed). */
  handleToolPlanResolution(_planId: string, _confirmed: boolean): void {}

  handleEditReviewApprove(reviewId: string): void {
    const uri = this.editReviewUris.get(reviewId);
    if (!uri) {
      return;
    }
    clearHighlight(uri);
    clearPreEditSnapshot(uri);
    this.editReviewUris.delete(reviewId);
    this.postToWebview({ type: "EDIT_REVIEW_CLEARED", payload: { reviewId } });
  }

  handleEditReviewUndo(reviewId: string): void {
    const uri = this.editReviewUris.get(reviewId);
    if (!uri) {
      return;
    }
    const snapshot = getPreEditSnapshot(uri);
    if (snapshot === undefined) {
      clearHighlight(uri);
      this.editReviewUris.delete(reviewId);
      this.postToWebview({ type: "EDIT_REVIEW_CLEARED", payload: { reviewId } });
      return;
    }
    void vscode.workspace.openTextDocument(uri).then((doc) => {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length)
      );
      edit.replace(uri, fullRange, snapshot);
      void vscode.workspace.applyEdit(edit).then(() => {
        clearHighlight(uri);
        clearPreEditSnapshot(uri);
        this.editReviewUris.delete(reviewId);
        this.postToWebview({ type: "EDIT_REVIEW_CLEARED", payload: { reviewId } });
      });
    });
  }

  private pushAssistantMarkdown(
    assistantId: string,
    raw: string,
    mode: "replace" | "append"
  ): void {
    const content = sanitizeAssistantMarkdownForUi(raw);
    if (!content.trim()) {
      return;
    }
    if (mode === "replace") {
      this.postToWebview({
        type: "CHAT_ASSISTANT_CONTENT",
        payload: { id: assistantId, content },
      });
    } else {
      this.postToWebview({
        type: "CHAT_ASSISTANT_APPEND",
        payload: { id: assistantId, markdown: content },
      });
    }
  }

  private humanToolStatusMarkdown(tc: ToolCallWire): string {
    const { tool, path } = this.toolCallSummary(tc);
    const loc = path && path.trim().length > 0 ? path.trim() : "";
    switch (tool) {
      case "read_file":
        return loc ? `*Reading ${loc}…*` : `*Reading a workspace file…*`;
      case "search_replace":
        return loc ? `*Editing ${loc}…*` : `*Editing…*`;
      case "write_file":
        return loc ? `*Updating ${loc}…*` : `*Updating a file…*`;
      case "create_file":
        return loc ? `*Creating ${loc}…*` : `*Creating a file…*`;
      case "list_directory":
        return loc ? `*Listing ${loc}…*` : `*Listing directory…*`;
      default:
        return loc ? `*Running ${tool} (${loc})…*` : `*Running ${tool}…*`;
    }
  }

  private toolFingerprint(tc: ToolCallWire): string {
    const fn = tc.function;
    try {
      const o = JSON.parse(fn.arguments || "{}") as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      const sorted: Record<string, unknown> = {};
      for (const k of keys) sorted[k] = o[k];
      return `${fn.name}:${JSON.stringify(sorted)}`;
    } catch {
      return `${fn.name}:${fn.arguments ?? ""}`;
    }
  }

  private toolFollowupLooksFailed(toolContent: string): boolean {
    return (
      toolContent.startsWith("Error:") ||
      toolContent === "Invalid JSON in tool arguments." ||
      toolContent.includes("Path is blocked") ||
      toolContent === "applyEdit failed." ||
      toolContent.startsWith("Unknown tool:")
    );
  }

  private toolResultLooksFailed(result: ToolExecutionResult): boolean {
    return this.toolFollowupLooksFailed(result.content);
  }

  private async afterSuccessfulFileTool(result: ToolExecutionResult): Promise<void> {
    if (!result.editReview) {
      return;
    }
    const uri = this.tools.resolveAllowedPath(result.editReview.relativePath);
    if (!uri) {
      return;
    }
    for (const [rid, u] of [...this.editReviewUris.entries()]) {
      if (u.toString() === uri.toString()) {
        clearHighlight(u);
        this.editReviewUris.delete(rid);
        this.postToWebview({ type: "EDIT_REVIEW_CLEARED", payload: { reviewId: rid } });
      }
    }
    try {
      await showChangedRangeHighlight(uri, result.editReview.highlightRange);
    } catch {
      /* ignore */
    }
    const reviewId = `er-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.editReviewUris.set(reviewId, uri);
    this.postToWebview({
      type: "EDIT_REVIEW_PENDING",
      payload: { reviewId, relativePath: result.editReview.relativePath },
    });
  }

  private toolCallSummary(tc: ToolCallWire): { tool: string; path?: string } {
    const tool = tc.function.name;
    let path: string | undefined;
    try {
      const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      if (typeof args.path === "string") {
        path = args.path;
      }
    } catch {
      /* ignore */
    }
    return { tool, path };
  }

  private postMutationProgress(line: string, diffAwaiting = false): void {
    this.postToWebview({
      type: "MUTATION_PROGRESS",
      payload: { line, diffAwaiting },
    });
  }

  private clearMutationProgress(): void {
    this.postMutationProgress("", false);
  }

  private static readonly CHAT_REQUEST_TIMEOUT_MS = 120_000;

  /**
   * One deadline for the entire HTTP round (TCP + headers + streaming body).
   * Do not clear its timer until `dispose()` — clearing when `fetch` resolves leaves a hung SSE body unstoppable.
   */
  private beginUpstreamRoundDeadline(): {
    signal: AbortSignal;
    dispose: () => void;
  } {
    const ctl = new AbortController();
    const tid = globalThis.setTimeout(
      () => ctl.abort(),
      ApiService.CHAT_REQUEST_TIMEOUT_MS
    );
    return {
      signal: ctl.signal,
      dispose: () => globalThis.clearTimeout(tid),
    };
  }

  private isAbortLikeError(e: unknown): boolean {
    if (e instanceof Error && (e.name === "AbortError" || e.message === "AbortError")) {
      return true;
    }
    try {
      return (
        typeof DOMException !== "undefined" &&
        e instanceof DOMException &&
        e.name === "AbortError"
      );
    } catch {
      return false;
    }
  }

  private postModelStreamActive(active: boolean): void {
    this.postToWebview({ type: "CHAT_MODEL_STREAM_ACTIVE", payload: { active } });
  }

  /** Run one round of tool_calls: in-chat status, dedup-after-failure, tool messages for the model. */
  private async executeToolBatchForChat(
    assistantId: string,
    toolCalls: ToolCallWire[],
    expectedVersions: Map<string, number>
  ): Promise<
    Array<{
      role: "tool";
      content: string;
      tool_call_id: string;
      name: string;
    }>
  > {
    this.clearMutationProgress();
    const skipFingerprintsOnce = new Set(this.prevFailedToolFingerprints);
    const thisBatchFailedFingerprints = new Set<string>();

    const toolMsgs: Array<{
      role: "tool";
      content: string;
      tool_call_id: string;
      name: string;
    }> = [];

    for (const tc of toolCalls) {
      this.pushAssistantMarkdown(
        assistantId,
        this.humanToolStatusMarkdown(tc),
        "append"
      );
      const fp = this.toolFingerprint(tc);
      let result: ToolExecutionResult;

      if (skipFingerprintsOnce.has(fp)) {
        skipFingerprintsOnce.delete(fp);
        result = {
          tool_call_id: tc.id,
          name: tc.function.name,
          content:
            "Skipped duplicate tool invocation after failure; revise strategy.",
        };
      } else {
        result = await this.tools.executeOne(tc, expectedVersions);
      }

      await this.afterSuccessfulFileTool(result);

      if (this.toolResultLooksFailed(result)) {
        thisBatchFailedFingerprints.add(fp);
      }

      if (result.postApplyVersion) {
        expectedVersions.set(
          result.postApplyVersion.relativePath,
          result.postApplyVersion.version
        );
      }

      toolMsgs.push({
        role: "tool",
        content: result.content,
        tool_call_id: result.tool_call_id,
        name: result.name,
      });
    }

    this.prevFailedToolFingerprints = thisBatchFailedFingerprints;
    return toolMsgs;
  }

  async sendChatMessage(query: string, modelId: string): Promise<void> {
    const p = this.chatTurnQueue.then(() =>
      this.settings.isWorkstation()
        ? this.runWorkstationChatTurn(query, modelId)
        : this.runCloudChatTurn(query, modelId)
    );
    this.chatTurnQueue = p.catch(() => undefined);
    await p;
  }

  private async runCloudChatTurn(query: string, modelId: string): Promise<void> {
    const url = SUPABASE_URL.trim();
    const anonKey = SUPABASE_ANON_KEY.trim();
    if (!url || !anonKey) {
      const message =
        "Build Ultra is not configured. Backend URL and key are missing in the extension build.";
      this.postChatError(message);
      return;
    }

    if (!this.auth.getSupabaseClient()) {
      const message = "Build Ultra client not configured.";
      this.postChatError(message);
      return;
    }

    const token = await this.auth.getSessionAccessToken();
    if (!token) {
      const message = "Sign in to use chat.";
      this.postChatError(message);
      return;
    }

    const assistantId = `a-${Date.now()}`;
    let chatStreamOpened = false;

    try {
      this.prevFailedToolFingerprints.clear();

      this.postToWebview({
        type: "CHAT_STREAM_START",
        payload: { id: assistantId },
      });
      chatStreamOpened = true;

      let base = await this.promptBuilder.buildChatPayload(query, modelId);
      const chatUrl = `${url.replace(/\/$/, "")}/functions/v1/chat`;
      let conversationOverride: Conv | undefined;
      let chatAborted = false;
      let firstModelProseDone = false;
      let roundCap = MAX_TOOL_ROUNDS;

      for (let round = 0; round < roundCap; round++) {
        const payload: ChatPayload = conversationOverride?.length
          ? {
              ...base,
              query: "",
              conversationOverride,
            }
          : base;

        let toolCalls: ToolCallWire[] = [];
        let assistantText = "";

        this.postModelStreamActive(true);
        const deadline = this.beginUpstreamRoundDeadline();
        try {
          const response = await globalThis.fetch(chatUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: anonKey,
              "Content-Type": "application/json",
              Accept: "text/event-stream, application/json",
            },
            body: JSON.stringify(payload),
            signal: deadline.signal,
          });

          if (response.status === 429) {
            const errText = await response.text().catch(() => response.statusText);
            const message = `Rate limited: ${errText.slice(0, 400)}`;
            this.postToWebview({ type: "CHAT_ERROR", payload: { message } });
            void vscode.window.showWarningMessage(`Build Ultra: ${message}`);
            chatAborted = true;
            break;
          }

          if (!response.ok) {
            await this.handleChatHttpError(response);
            chatAborted = true;
            break;
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("text/event-stream")) {
            const r = await this.streamSse(response, assistantId, {
              bufferAssistantDeltas: true,
            });
            toolCalls = r.toolCalls;
            assistantText = r.assistantText;
            if (assistantText.trim()) {
              this.pushAssistantMarkdown(
                assistantId,
                assistantText,
                !firstModelProseDone ? "replace" : "append"
              );
              firstModelProseDone = true;
            }
          } else {
            const nr = await this.parseOpenAiNonStreamResponse(
              response,
              assistantId,
              false
            );
            toolCalls = nr.toolCalls;
            assistantText = nr.assistantText;
            if (assistantText.trim()) {
              this.pushAssistantMarkdown(
                assistantId,
                assistantText,
                !firstModelProseDone ? "replace" : "append"
              );
              firstModelProseDone = true;
            }
          }
        } finally {
          deadline.dispose();
          this.postModelStreamActive(false);
        }

        if (chatAborted) {
          break;
        }

        if (toolCalls.length === 0) {
          break;
        }

        base = await this.promptBuilder.refreshPayloadForToolRound(modelId, query);
        const ctxBundle = this.promptBuilder.buildToolFollowupContextBundle(base);
        const userQuery = query.trim();

        const assistantMsg: Conv[number] = {
          role: "assistant",
          content: assistantText.trim() ? assistantText : null,
          tool_calls: toolCalls,
        };

        const expectedVersions = new Map<string, number>();
        const toolMsgs = await this.executeToolBatchForChat(
          assistantId,
          toolCalls,
          expectedVersions
        );

        if (!conversationOverride?.length) {
          conversationOverride = [
            { role: "user", content: ctxBundle },
            { role: "user", content: userQuery },
            assistantMsg,
            ...toolMsgs,
          ];
        } else {
          conversationOverride = [...conversationOverride, assistantMsg, ...toolMsgs];
        }

        const entireBatchFailedTools =
          toolMsgs.length > 0 &&
          toolMsgs.every((m) => this.toolFollowupLooksFailed(m.content));

        if (
          entireBatchFailedTools &&
          round === MAX_TOOL_ROUNDS - 1 &&
          roundCap === MAX_TOOL_ROUNDS
        ) {
          roundCap = MAX_TOOL_ROUNDS + 1;
        }
      }
    } catch (e) {
      if (this.isAbortLikeError(e)) {
        this.postChatError(
          `Ultra AI timed out waiting for Cloud chat (${Math.round(ApiService.CHAT_REQUEST_TIMEOUT_MS / 1000)}s). Try again or check your connection.`
        );
      } else {
        const message = e instanceof Error ? e.message : String(e);
        this.postChatError(message);
      }
    } finally {
      if (chatStreamOpened) {
        this.postToWebview({
          type: "CHAT_STREAM_END",
          payload: { id: assistantId },
        });
      }
    }
  }

  private async getRemainingQuotaForUser(): Promise<number> {
    const client = this.auth.getSupabaseClient();
    if (!client) {
      return 0;
    }
    const {
      data: { session },
    } = await client.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      return 0;
    }
    const { data, error } = await client
      .from("user_quotas")
      .select("tokens_used, total_quota")
      .eq("id", uid)
      .maybeSingle();
    if (error || !data) {
      return 0;
    }
    const tokensUsed = typeof data.tokens_used === "number" ? data.tokens_used : 0;
    const totalQuota = typeof data.total_quota === "number" ? data.total_quota : 0;
    return Math.max(0, totalQuota - tokensUsed);
  }

  /**
   * POST SaaS usage after a full Workstation (private compute) turn.
   */
  private async postWorkstationLogUsage(totalTokens: number): Promise<void> {
    const url = SUPABASE_URL.trim();
    const anonKey = SUPABASE_ANON_KEY.trim();
    const token = await this.auth.getSessionAccessToken();
    if (!url || !anonKey || !token) {
      return;
    }
    const deduct = Math.max(1, Math.floor(totalTokens));
    try {
      const r = await fetch(`${url.replace(/\/$/, "")}/functions/v1/log-usage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ total_tokens: deduct }),
      });
      if (r.status === 402) {
        this.postToWebview({ type: "UPDATE_QUOTA", payload: { remaining: 0 } });
        this.postChatError("Your token quota is exhausted.");
        return;
      }
      if (!r.ok) {
        this.postChatError(
          "Ultra AI could not record usage. Your message still ran on compute."
        );
        return;
      }
      const j = (await r.json()) as { remaining_tokens?: unknown };
      if (typeof j.remaining_tokens === "number" && Number.isFinite(j.remaining_tokens)) {
        this.postToWebview({
          type: "UPDATE_QUOTA",
          payload: { remaining: Math.max(0, Math.floor(j.remaining_tokens)) },
        });
      }
    } catch {
      this.postChatError(
        "Ultra AI could not record usage. Check your connection."
      );
    }
  }

  private async runWorkstationChatTurn(
    query: string,
    modelId: string
  ): Promise<void> {
    const url = SUPABASE_URL.trim();
    const anonKey = SUPABASE_ANON_KEY.trim();
    if (!url || !anonKey) {
      this.postChatError(
        "Build Ultra is not configured. Backend URL and key are missing in the extension build."
      );
      return;
    }
    if (!this.auth.getSupabaseClient()) {
      this.postChatError("Build Ultra client not configured.");
      return;
    }
    if (!(await this.auth.getSessionAccessToken())) {
      this.postChatError("Sign in to use chat.");
      return;
    }

    const remainingQuota = await this.getRemainingQuotaForUser();
    if (remainingQuota <= 0) {
      this.postToWebview({ type: "UPDATE_QUOTA", payload: { remaining: 0 } });
      this.postChatError("Your token quota is exhausted.");
      return;
    }

    const chatUrl = this.settings.getChatCompletionsUrl();
    const apiKey = await this.settings.getWorkstationApiKey();

    if (!chatUrl) {
      this.postChatError(
        "Ultra AI can’t reach compute. Open Settings → Build Ultra and set the compute host."
      );
      return;
    }
    if (!apiKey) {
      this.postChatError(
        "Ultra AI needs an API key for your configured compute. Command Palette → “Build Ultra: Set Private Compute API Key.”"
      );
      return;
    }

    const assistantId = `a-${Date.now()}`;
    let chatStreamOpened = false;
    let chatAborted = false;
    let totalTurnTokens = 0;

    try {
      this.prevFailedToolFingerprints.clear();

      this.postToWebview({
        type: "CHAT_STREAM_START",
        payload: { id: assistantId },
      });
      chatStreamOpened = true;

      const masterSystem = await this.auth.resolveDefaultMasterPrompt();
      let base = await this.promptBuilder.buildChatPayload(query, modelId);
      const upstreamModel = this.settings.getEffectiveModel(modelId);
      let conversationOverride: Conv | undefined;
      let firstModelProseDone = false;
      let roundCap = MAX_TOOL_ROUNDS;

      for (let round = 0; round < roundCap; round++) {
        const payload: ChatPayload = conversationOverride?.length
          ? {
              ...base,
              query: "",
              conversationOverride,
            }
          : base;

        const built = assembleChatMessages(masterSystem, payload, "");
        const requestBody = buildWorkstationChatRequestBody(upstreamModel, built);

        let toolCalls: ToolCallWire[] = [];
        let assistantText = "";
        let roundUsage: number | null = null;

        this.postModelStreamActive(true);
        const deadline = this.beginUpstreamRoundDeadline();
        try {
          const response = await globalThis.fetch(chatUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream, application/json",
              "X-API-Key": apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: deadline.signal,
          });

          if (!response.ok) {
            await this.handleWorkstationHttpError(response);
            chatAborted = true;
            break;
          }

          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("text/event-stream")) {
            const r = await streamOpenAiCompatibleSse(
              response,
              () => {
                /* buffered — flushed below */
              },
              { emitContentDeltas: false }
            );
            toolCalls = r.toolCalls;
            assistantText = r.assistantText;
            roundUsage = r.usageTotalTokens;
            if (assistantText.trim()) {
              this.pushAssistantMarkdown(
                assistantId,
                assistantText,
                !firstModelProseDone ? "replace" : "append"
              );
              firstModelProseDone = true;
            }
          } else {
            const nr = await this.parseOpenAiNonStreamResponse(response, assistantId, false);
            toolCalls = nr.toolCalls;
            assistantText = nr.assistantText;
            roundUsage = nr.usageTotalTokens;
            if (assistantText.trim()) {
              this.pushAssistantMarkdown(
                assistantId,
                assistantText,
                !firstModelProseDone ? "replace" : "append"
              );
              firstModelProseDone = true;
            }
          }

          const promptChars = JSON.stringify(requestBody).length;
          const roundTokens =
            roundUsage !== null && Number.isFinite(roundUsage)
              ? Math.max(1, Math.floor(roundUsage))
              : Math.max(1, Math.ceil((promptChars + assistantText.length) / 4));
          totalTurnTokens += roundTokens;
        } finally {
          deadline.dispose();
          this.postModelStreamActive(false);
        }

        if (chatAborted) {
          break;
        }

        if (toolCalls.length === 0) {
          break;
        }

        base = await this.promptBuilder.refreshPayloadForToolRound(modelId, query);
        const ctxBundle = this.promptBuilder.buildToolFollowupContextBundle(base);
        const userQuery = query.trim();

        const assistantMsg: Conv[number] = {
          role: "assistant",
          content: assistantText.trim() ? assistantText : null,
          tool_calls: toolCalls,
        };

        const expectedVersions = new Map<string, number>();
        const toolMsgs = await this.executeToolBatchForChat(
          assistantId,
          toolCalls,
          expectedVersions
        );

        if (!conversationOverride?.length) {
          conversationOverride = [
            { role: "user", content: ctxBundle },
            { role: "user", content: userQuery },
            assistantMsg,
            ...toolMsgs,
          ];
        } else {
          conversationOverride = [
            ...conversationOverride,
            assistantMsg,
            ...toolMsgs,
          ];
        }

        const entireBatchFailedTools =
          toolMsgs.length > 0 &&
          toolMsgs.every((m) => this.toolFollowupLooksFailed(m.content));

        if (
          entireBatchFailedTools &&
          round === MAX_TOOL_ROUNDS - 1 &&
          roundCap === MAX_TOOL_ROUNDS
        ) {
          roundCap = MAX_TOOL_ROUNDS + 1;
        }
      }
    } catch (e) {
      chatAborted = true;
      if (this.isAbortLikeError(e)) {
        this.postChatError(
          `Ultra AI timed out waiting for private compute (${Math.round(ApiService.CHAT_REQUEST_TIMEOUT_MS / 1000)}s). Try again or check Settings → Build Ultra.`
        );
      } else {
        this.postChatError(
          "Ultra AI couldn’t reach compute. Check your network and Build Ultra settings."
        );
      }
    } finally {
      if (chatStreamOpened) {
        this.postToWebview({
          type: "CHAT_STREAM_END",
          payload: { id: assistantId },
        });
      }
    }

    if (!chatAborted && totalTurnTokens > 0) {
      await this.postWorkstationLogUsage(totalTurnTokens);
    }
  }

  private async handleWorkstationHttpError(response: Response): Promise<void> {
    await response.text().catch(() => "");
    if (response.status === 503 || response.status === 502) {
      this.postChatError(
        "Service temporarily unavailable.",
        "maintenance"
      );
      return;
    }
    if (response.status === 401 || response.status === 403) {
      this.postChatError(
        "Ultra AI could not authorize this request. Check your API key in settings."
      );
      return;
    }
    this.postChatError(
      "Ultra AI couldn’t complete the request. Try again in a moment."
    );
  }

  private async parseOpenAiNonStreamResponse(
    response: Response,
    assistantId: string,
    emitStreamDeltasToWebview: boolean
  ): Promise<{
    toolCalls: ToolCallWire[];
    assistantText: string;
    usageTotalTokens: number | null;
    contentRecoveryApplied: boolean;
  }> {
    const text = await response.text();
    let toolCalls: ToolCallWire[] = [];
    let assistantText = "";
    let usageTotalTokens: number | null = null;
    try {
      const j = JSON.parse(text) as {
        usage?: { total_tokens?: number };
        content?: string | null;
        message?: string;
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      if (typeof j.usage?.total_tokens === "number") {
        usageTotalTokens = j.usage.total_tokens;
      }
      const msg = j.choices?.[0]?.message;
      if (typeof msg?.content === "string" && msg.content.length > 0) {
        assistantText = msg.content;
        if (emitStreamDeltasToWebview) {
          this.postToWebview({
            type: "CHAT_STREAM_DELTA",
            payload: { id: assistantId, delta: msg.content },
          });
        }
      }
      const tcs = msg?.tool_calls;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          const id = typeof tc.id === "string" ? tc.id : "";
          const name = tc.function?.name ?? "";
          const args = tc.function?.arguments ?? "";
          if (id && name) {
            toolCalls.push({
              id,
              type: "function",
              function: {
                name,
                arguments: typeof args === "string" ? args : "",
              },
            });
          }
        }
      }

      const emptyProse =
        typeof assistantText !== "string" || assistantText.length === 0;
      if (emptyProse && typeof j.content === "string" && j.content.length > 0) {
        assistantText = j.content;
        if (emitStreamDeltasToWebview) {
          this.postToWebview({
            type: "CHAT_STREAM_DELTA",
            payload: { id: assistantId, delta: j.content },
          });
        }
      } else if (
        emptyProse &&
        typeof j.message === "string" &&
        j.message.length > 0
      ) {
        assistantText = j.message;
        if (emitStreamDeltasToWebview) {
          this.postToWebview({
            type: "CHAT_STREAM_DELTA",
            payload: { id: assistantId, delta: j.message },
          });
        }
      }
    } catch {
      if (text.trim()) {
        if (emitStreamDeltasToWebview) {
          this.postToWebview({
            type: "CHAT_STREAM_DELTA",
            payload: { id: assistantId, delta: text.slice(0, 20_000) },
          });
        }
        assistantText = text;
      }
    }
    let contentRecoveryApplied = false;
    if (toolCalls.length === 0 && assistantText.length > 0) {
      const recovered = tryRecoverToolCallsFromAssistantText(assistantText);
      if (recovered.toolCalls.length > 0) {
        toolCalls = recovered.toolCalls;
        assistantText = recovered.displayText;
        contentRecoveryApplied = true;
      }
    }
    assistantText = sanitizeAssistantMarkdownForUi(assistantText);
    return { toolCalls, assistantText, usageTotalTokens, contentRecoveryApplied };
  }

  private postChatError(message: string, kind?: "maintenance"): void {
    this.clearMutationProgress();
    if (kind === "maintenance") {
      this.postToWebview({
        type: "CHAT_ERROR",
        payload: { message, kind: "maintenance" },
      });
      void vscode.window.showWarningMessage(`Build Ultra: ${message}`);
    } else {
      this.postToWebview({ type: "CHAT_ERROR", payload: { message } });
      void vscode.window.showErrorMessage(`Build Ultra: ${message}`);
    }
  }

  /** Parses JSON `{ status: "maintenance" }` from Edge or falls back to generic error text. */
  private async handleChatHttpError(response: Response): Promise<void> {
    const errText = await response.text().catch(() => response.statusText);
    if (response.status === 402) {
      this.postToWebview({ type: "UPDATE_QUOTA", payload: { remaining: 0 } });
      this.postChatError("Your token quota is exhausted.");
      return;
    }
    let message = `Chat failed (${response.status}): ${errText.slice(0, 400)}`;
    let kind: "maintenance" | undefined;
    const trimmed = errText.trim();
    if (trimmed.startsWith("{")) {
      try {
        const j = JSON.parse(trimmed) as { status?: unknown };
        if (j.status === "maintenance") {
          kind = "maintenance";
          message = "Service temporarily unavailable.";
        }
      } catch {
        /* keep generic */
      }
    }
    this.postChatError(message, kind);
  }

  private async streamSse(
    response: Response,
    assistantId: string,
    options?: { bufferAssistantDeltas?: boolean }
  ): Promise<{ toolCalls: ToolCallWire[]; assistantText: string }> {
    const bufferAssistantDeltas = options?.bufferAssistantDeltas === true;
    const postAssistantDeltas = !bufferAssistantDeltas;
    const body = response.body;
    if (!body) {
      throw new Error("Empty response body from chat function.");
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastToolCalls: ToolCallWire[] = [];
    let assistantText = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const r = this.processSseLine(line, assistantId, postAssistantDeltas);
          if (r.toolCalls.length) lastToolCalls = r.toolCalls;
          assistantText += r.deltaChunk;
        }
      }
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          const r = this.processSseLine(line, assistantId, postAssistantDeltas);
          if (r.toolCalls.length) lastToolCalls = r.toolCalls;
          assistantText += r.deltaChunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (lastToolCalls.length === 0 && assistantText.length > 0) {
      const recovered = tryRecoverToolCallsFromAssistantText(assistantText);
      if (recovered.toolCalls.length > 0) {
        lastToolCalls = recovered.toolCalls;
        assistantText = recovered.displayText;
      }
    }
    assistantText = sanitizeAssistantMarkdownForUi(assistantText);
    return { toolCalls: lastToolCalls, assistantText };
  }

  private processSseLine(
    line: string,
    assistantId: string,
    postAssistantDeltas: boolean
  ): { toolCalls: ToolCallWire[]; deltaChunk: string } {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) {
      return { toolCalls: [], deltaChunk: "" };
    }
    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]" || data === "") {
      return { toolCalls: [], deltaChunk: "" };
    }
    try {
      const parsed = JSON.parse(data) as SseJson;
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        throw new Error(parsed.error);
      }
      if (typeof parsed.usage_total_tokens === "number") {
        return { toolCalls: [], deltaChunk: "" };
      }
      if (typeof parsed.remaining_tokens === "number") {
        this.postToWebview({
          type: "UPDATE_QUOTA",
          payload: { remaining: parsed.remaining_tokens },
        });
      }
      if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
        return {
          toolCalls: parsed.tool_calls as ToolCallWire[],
          deltaChunk: "",
        };
      }
      if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
        if (postAssistantDeltas) {
          this.postToWebview({
            type: "CHAT_STREAM_DELTA",
            payload: { id: assistantId, delta: parsed.delta },
          });
        }
        return { toolCalls: [], deltaChunk: parsed.delta };
      }
      return { toolCalls: [], deltaChunk: "" };
    } catch (e) {
      if (e instanceof SyntaxError) {
        const t = data.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          return { toolCalls: [], deltaChunk: "" };
        }
        if (postAssistantDeltas) {
          this.postToWebview({
            type: "CHAT_STREAM_DELTA",
            payload: { id: assistantId, delta: data },
          });
        }
        return { toolCalls: [], deltaChunk: "" };
      }
      throw e;
    }
  }
}
