import type { ToolCallWire } from "./services/ToolExecutionService";
import { tryRecoverToolCallsFromAssistantText } from "./toolCallTextRecovery";

type ToolCallAcc = Map<
  number,
  { id?: string; name?: string; arguments: string }
>;

function getUsageTotalTokens(chunk: {
  choices?: unknown;
  usage?: { total_tokens?: number };
}): number | null {
  const t = chunk.usage?.total_tokens;
  return typeof t === "number" ? t : null;
}

function extractAssistantDeltaText(chunk: unknown): string | null {
  if (chunk == null || typeof chunk !== "object") return null;
  const c = chunk as {
    choices?: Array<{
      delta?: { content?: unknown } | null;
      message?: { content?: unknown } | null;
      text?: unknown;
    }>;
  };
  const piece =
    c?.choices?.[0]?.delta?.content ??
    c?.choices?.[0]?.message?.content ??
    c?.choices?.[0]?.text;
  if (typeof piece === "string" && piece.length > 0) {
    return piece;
  }
  return null;
}

function accumulateToolCallsFromChunk(chunk: unknown, acc: ToolCallAcc): void {
  if (chunk == null || typeof chunk !== "object") return;
  const c = chunk as {
    choices?: Array<{
      delta?: {
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const tcs = c?.choices?.[0]?.delta?.tool_calls;
  if (!tcs) return;
  for (const tc of tcs) {
    const idx = tc.index ?? 0;
    let cur = acc.get(idx);
    if (!cur) {
      cur = { arguments: "" };
      acc.set(idx, cur);
    }
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.name = tc.function.name;
    if (tc.function?.arguments) cur.arguments += tc.function.arguments;
  }
}

function finalizeToolCalls(acc: ToolCallAcc): ToolCallWire[] {
  const out: ToolCallWire[] = [];
  const keys = [...acc.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const v = acc.get(k);
    if (!v?.id || !v.name) continue;
    out.push({
      id: v.id,
      type: "function",
      function: { name: v.name, arguments: v.arguments },
    });
  }
  return out;
}

/**
 * Parses native OpenAI-compatible SSE (choices[0].delta). Optionally streams text to the webview.
 * When `emitContentDeltas` is false, assistant text is accumulated only (no partial JSON in UI).
 */
export async function streamOpenAiCompatibleSse(
  response: Response,
  onTextDelta: (delta: string) => void,
  options?: { emitContentDeltas?: boolean }
): Promise<{
  toolCalls: ToolCallWire[];
  assistantText: string;
  /** Last non-null `usage.total_tokens` from any SSE JSON chunk (OpenAI-style). */
  usageTotalTokens: number | null;
  /** True when tool calls were parsed from assistant text (JSON-in-content fallback). */
  contentRecoveryApplied: boolean;
}> {
  const emitContentDeltas = options?.emitContentDeltas !== false;
  const body = response.body;
  if (!body) {
    throw new Error("Empty response body from chat endpoint.");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolAcc: ToolCallAcc = new Map();
  let assistantText = "";
  let usageTotalTokens: number | null = null;

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
        const trimmed = line.trimEnd();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.toLowerCase().startsWith("data:")) continue;

        const data = trimmed.slice(5).trimStart();
        if (data === "[DONE]" || data.length === 0) continue;

        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        accumulateToolCallsFromChunk(chunk, toolAcc);

        const u = getUsageTotalTokens(chunk as { usage?: { total_tokens?: number } });
        if (u !== null) {
          usageTotalTokens = u;
        }

        const piece = extractAssistantDeltaText(chunk);
        if (piece !== null) {
          assistantText += piece;
          if (emitContentDeltas) {
            onTextDelta(piece);
          }
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trimEnd();
      if (trimmed.toLowerCase().startsWith("data:")) {
        const data = trimmed.slice(5).trimStart();
        if (data !== "[DONE]" && data.length > 0) {
          try {
            const chunk = JSON.parse(data) as unknown;
            accumulateToolCallsFromChunk(chunk, toolAcc);
            const u = getUsageTotalTokens(chunk as { usage?: { total_tokens?: number } });
            if (u !== null) {
              usageTotalTokens = u;
            }
            const piece = extractAssistantDeltaText(chunk);
            if (piece !== null) {
              assistantText += piece;
              if (emitContentDeltas) {
                onTextDelta(piece);
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  let toolCalls = finalizeToolCalls(toolAcc);
  let contentRecoveryApplied = false;
  if (toolCalls.length === 0 && assistantText.length > 0) {
    const recovered = tryRecoverToolCallsFromAssistantText(assistantText);
    if (recovered.toolCalls.length > 0) {
      toolCalls = recovered.toolCalls;
      assistantText = recovered.displayText;
      contentRecoveryApplied = true;
    }
  }

  return {
    toolCalls,
    assistantText,
    usageTotalTokens,
    contentRecoveryApplied,
  };
}
