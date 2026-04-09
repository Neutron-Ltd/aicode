import * as vscode from "vscode";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import type { HostToWebviewMessage } from "../shared/messages";
import type { AuthService } from "./AuthService";
import type { PromptBuilderService } from "./PromptBuilderService";

/**
 * Calls the Supabase `chat` Edge Function with the user JWT and streams SSE deltas
 * to the webview (Chunk 6).
 *
 * **Request:** `POST /functions/v1/chat` with JSON body = `ChatPayload` (see `chatPayload.ts`).
 *
 * **Response (SSE):** `Content-Type: text/event-stream`. Each event line:
 * `data: {"delta":"..."}\n\n` — append `delta` to the assistant message. Optional terminal
 * event: `data: [DONE]\n\n`. Lines may include `{ "error": "..." }` to signal failure.
 * Non-SSE JSON responses fall back to `{ content: string }` or raw text.
 *
 * 302.ai / upstream keys stay **only** in the Edge Function env — never in the extension.
 */
export class ApiService {
  constructor(
    private readonly auth: AuthService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly postToWebview: (msg: HostToWebviewMessage) => void
  ) {}

  async sendChatMessage(query: string, modelId: string): Promise<void> {
    const url = SUPABASE_URL.trim();
    const anonKey = SUPABASE_ANON_KEY.trim();
    if (!url || !anonKey) {
      const message =
        "Mirror AI is not configured. Backend URL and key are missing in the extension build.";
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Mirror AI: ${message}`);
      return;
    }

    if (!this.auth.getSupabaseClient()) {
      const message = "Mirror AI client not configured.";
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Mirror AI: ${message}`);
      return;
    }

    const token = await this.auth.getSessionAccessToken();
    if (!token) {
      const message = "Sign in to use chat.";
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Mirror AI: ${message}`);
      return;
    }

    let payload;
    try {
      payload = await this.promptBuilder.buildChatPayload(query, modelId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.postChatError(message);
      return;
    }

    const assistantId = `a-${Date.now()}`;
    this.postToWebview({
      type: "CHAT_STREAM_START",
      payload: { id: assistantId },
    });

    const chatUrl = `${url.replace(/\/$/, "")}/functions/v1/chat`;

    try {
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

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        const message = `Chat failed (${response.status}): ${errText.slice(0, 400)}`;
        this.postChatError(message);
        void vscode.window.showErrorMessage(`Mirror AI: ${message}`);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        await this.streamSse(response, assistantId);
        this.postToWebview({
          type: "CHAT_STREAM_END",
          payload: { id: assistantId },
        });
      } else {
        await this.handleNonStreamBody(response, assistantId);
        this.postToWebview({
          type: "CHAT_STREAM_END",
          payload: { id: assistantId },
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.postChatError(message);
      void vscode.window.showErrorMessage(`Mirror AI: ${message}`);
    }
  }

  private postChatError(message: string): void {
    this.postToWebview({ type: "CHAT_ERROR", payload: { message } });
  }

  private async streamSse(
    response: Response,
    assistantId: string
  ): Promise<void> {
    const body = response.body;
    if (!body) {
      throw new Error("Empty response body from chat function.");
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
          this.processSseLine(line, assistantId);
        }
      }
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          this.processSseLine(line, assistantId);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private processSseLine(line: string, assistantId: string): void {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]" || data === "") {
      return;
    }
    try {
      const parsed = JSON.parse(data) as {
        delta?: string;
        error?: string;
        remaining_tokens?: number;
        usage_total_tokens?: number;
      };
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        throw new Error(parsed.error);
      }
      // Server-side accounting only — never forward as chat text.
      if (typeof parsed.usage_total_tokens === "number") {
        return;
      }
      if (typeof parsed.remaining_tokens === "number") {
        this.postToWebview({
          type: "UPDATE_QUOTA",
          payload: { remaining: parsed.remaining_tokens },
        });
      }
      if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
        this.postToWebview({
          type: "CHAT_STREAM_DELTA",
          payload: { id: assistantId, delta: parsed.delta },
        });
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        const t = data.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          return;
        }
        this.postToWebview({
          type: "CHAT_STREAM_DELTA",
          payload: { id: assistantId, delta: data },
        });
      } else {
        throw e;
      }
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
