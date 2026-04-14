import * as vscode from "vscode";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import type { ChatPayload } from "../types/chatPayload";
import type { HostToWebviewMessage } from "../shared/messages";
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
  constructor(
    private readonly auth: AuthService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly tools: ToolExecutionService,
    private readonly postToWebview: (msg: HostToWebviewMessage) => void
  ) {}

  async sendChatMessage(query: string, modelId: string): Promise<void> {
    const url = SUPABASE_URL.trim();
    const anonKey = SUPABASE_ANON_KEY.trim();
    if (!url || !anonKey) {
      const message =
        "Build Ultra is not configured. Backend URL and key are missing in the extension build.";
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Build Ultra: ${message}`);
      return;
    }

    if (!this.auth.getSupabaseClient()) {
      const message = "Build Ultra client not configured.";
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Build Ultra: ${message}`);
      return;
    }

    const token = await this.auth.getSessionAccessToken();
    if (!token) {
      const message = "Sign in to use chat.";
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Build Ultra: ${message}`);
      return;
    }

    const assistantId = `a-${Date.now()}`;
    this.postToWebview({
      type: "CHAT_STREAM_START",
      payload: { id: assistantId },
    });

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
          this.postChatError(message);
          void vscode.window.showWarningMessage(`Build Ultra: ${message}`);
          break;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          const message = `Chat failed (${response.status}): ${errText.slice(0, 400)}`;
          this.postChatError(message);
          void vscode.window.showErrorMessage(`Build Ultra: ${message}`);
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

        const expectedVersions = new Map<string, number>();
        const assistantMsg: Conv[number] = {
          role: "assistant",
          content: assistantText.trim() ? assistantText : null,
          tool_calls: toolCalls,
        };

        const toolMsgs: Conv = [];
        for (const tc of toolCalls) {
          const result = await this.tools.executeOne(tc, expectedVersions);
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

      this.postToWebview({
        type: "CHAT_STREAM_END",
        payload: { id: assistantId },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Build Ultra: ${message}`);
    }
  }

  private postChatError(message: string): void {
    this.postToWebview({ type: "CHAT_ERROR", payload: { message } });
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
