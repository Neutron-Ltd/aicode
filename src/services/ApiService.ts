import * as vscode from "vscode";
import { openMutationDiffAndConfirm } from "../diffReview";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import type { ChatPayload } from "../types/chatPayload";
import type { HostToWebviewMessage } from "../shared/messages";
import { buildToolPlanSteps } from "../toolPlanParse";
import type { BuildUltraPreviewProvider } from "../virtualDocumentProvider";
import type { AuthService } from "./AuthService";
import type { PromptBuilderService } from "./PromptBuilderService";
import type { ToolCallWire, ToolExecutionService } from "./ToolExecutionService";

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
 * Calls the Supabase `chat` Edge Function with the user JWT and streams SSE deltas
 * to the webview (Chunk 6).
 *
 * **Request:** `POST /functions/v1/chat` with JSON body = `ChatPayload` (see `chatPayload.ts`).
 *
 * **Response (SSE):** `Content-Type: text/event-stream`. Each event line:
 * `data: {"delta":"..."}\n\n` — append `delta` to the assistant message. Optional terminal
 * event: `data: [DONE]\n\n`. Lines may include `{ "error": "..." }` to signal failure.
 * Tool rounds emit `data: {"tool_calls":[...]}\n\n` before `[DONE]`.
 *
 * Upstream API keys stay **only** in the Edge Function env — never in the extension.
 */
export class ApiService {
  private readonly planResolvers = new Map<string, (ok: boolean) => void>();

  constructor(
    private readonly auth: AuthService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly tools: ToolExecutionService,
    private readonly previewProvider: BuildUltraPreviewProvider,
    private readonly postToWebview: (msg: HostToWebviewMessage) => void
  ) {}

  /**
   * Invoked when the webview confirms or cancels a pending AI tool plan.
   */
  handleToolPlanResolution(planId: string, confirmed: boolean): void {
    const resolve = this.planResolvers.get(planId);
    if (resolve) {
      this.planResolvers.delete(planId);
      resolve(confirmed);
    }
  }

  private waitForToolPlan(planId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.planResolvers.set(planId, resolve);
    });
  }

  /**
   * After webview plan approval: optional `vscode.diff` for mutations, then execute tool.
   */
  private async maybeConfirmThenExecute(
    tc: ToolCallWire,
    expectedVersions: Map<string, number>
  ): Promise<{ tool_call_id: string; content: string; name: string; aborted?: string }> {
    const name = tc.function.name;
    if (name !== "write_file" && name !== "create_file") {
      return this.tools.executeOne(tc, expectedVersions);
    }
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return this.tools.executeOne(tc, expectedVersions);
    }
    const rel = typeof args.path === "string" ? args.path : "";
    const uri = this.tools.resolveAllowedPath(rel);
    if (!uri) {
      return this.tools.executeOne(tc, expectedVersions);
    }
    const proposed = typeof args.content === "string" ? args.content : "";
    let currentText = "";
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      currentText = doc.getText();
    } catch {
      currentText = "";
    }
    const range =
      name === "write_file"
        ? (args.range as { startLine?: number; endLine?: number } | undefined)
        : undefined;

    const confirmed = await openMutationDiffAndConfirm({
      provider: this.previewProvider,
      title: "Ultra AI",
      relPath: rel || "(file)",
      currentText,
      proposedText: proposed,
      range,
    });
    if (!confirmed) {
      return {
        tool_call_id: tc.id,
        name,
        content: "User skipped applying this edit after review.",
      };
    }
    return this.tools.executeOne(tc, expectedVersions);
  }

  async sendChatMessage(query: string, modelId: string): Promise<void> {
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
    this.postToWebview({
      type: "CHAT_STREAM_START",
      payload: { id: assistantId },
    });

    let chatAborted = false;
    try {
      let base = await this.promptBuilder.buildChatPayload(query, modelId);
      const chatUrl = `${url.replace(/\/$/, "")}/functions/v1/chat`;
      let conversationOverride: Conv | undefined;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const payload: ChatPayload = conversationOverride?.length
          ? {
              ...base,
              query: "",
              conversationOverride,
            }
          : base;

        const response = await fetch(chatUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: anonKey,
            "Content-Type": "application/json",
            Accept: "text/event-stream, application/json",
          },
          body: JSON.stringify(payload),
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
        let toolCalls: ToolCallWire[] = [];
        let assistantText = "";
        if (contentType.includes("text/event-stream")) {
          const r = await this.streamSse(response, assistantId);
          toolCalls = r.toolCalls;
          assistantText = r.assistantText;
        } else {
          await this.handleNonStreamBody(response, assistantId);
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

        const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const steps = buildToolPlanSteps(toolCalls);
        this.postToWebview({
          type: "TOOL_PLAN_PENDING",
          payload: { planId, steps },
        });

        const planConfirmed = await this.waitForToolPlan(planId);
        this.postToWebview({ type: "TOOL_PLAN_CLEARED", payload: { planId } });

        if (!planConfirmed) {
          break;
        }

        const expectedVersions = new Map<string, number>();
        const toolMsgs: Conv = [];
        for (const tc of toolCalls) {
          const result = await this.maybeConfirmThenExecute(tc, expectedVersions);
          toolMsgs.push({
            role: "tool",
            content: result.content,
            tool_call_id: result.tool_call_id,
            name: result.name,
          });
        }

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
      }

      if (!chatAborted) {
        this.postToWebview({
          type: "CHAT_STREAM_END",
          payload: { id: assistantId },
        });
      }
    } catch (e) {
      chatAborted = true;
      const message = e instanceof Error ? e.message : String(e);
      this.postChatError(message);
    }
  }

  private postChatError(message: string, kind?: "maintenance"): void {
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
    assistantId: string
  ): Promise<{ toolCalls: ToolCallWire[]; assistantText: string }> {
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
          const r = this.processSseLine(line, assistantId);
          if (r.toolCalls.length) lastToolCalls = r.toolCalls;
          assistantText += r.deltaChunk;
        }
      }
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          const r = this.processSseLine(line, assistantId);
          if (r.toolCalls.length) lastToolCalls = r.toolCalls;
          assistantText += r.deltaChunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
    return { toolCalls: lastToolCalls, assistantText };
  }

  private processSseLine(
    line: string,
    assistantId: string
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
        this.postToWebview({
          type: "CHAT_STREAM_DELTA",
          payload: { id: assistantId, delta: parsed.delta },
        });
        return { toolCalls: [], deltaChunk: parsed.delta };
      }
      return { toolCalls: [], deltaChunk: "" };
    } catch (e) {
      if (e instanceof SyntaxError) {
        const t = data.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          return { toolCalls: [], deltaChunk: "" };
        }
        this.postToWebview({
          type: "CHAT_STREAM_DELTA",
          payload: { id: assistantId, delta: data },
        });
        return { toolCalls: [], deltaChunk: data };
      }
      throw e;
    }
  }

  private async handleNonStreamBody(
    response: Response,
    assistantId: string
  ): Promise<void> {
    const text = await response.text();
    let content = text;
    try {
      const json = JSON.parse(text) as { content?: string; message?: string };
      if (typeof json.content === "string") {
        content = json.content;
      } else if (typeof json.message === "string") {
        content = json.message;
      }
    } catch {
      // use raw text
    }
    if (content) {
      this.postToWebview({
        type: "CHAT_STREAM_DELTA",
        payload: { id: assistantId, delta: content },
      });
    }
  }
}
