/**
 * Mirror — Supabase Edge Function `chat`
 *
 * Secure bridge between the VS Code extension and 302.ai (OpenAI-compatible API).
 * Deploy: `supabase secrets set THREETW_AI_API_KEY=...` or `AI_UPSTREAM_KEY=...` then `supabase functions deploy chat`
 *
 * **Client (extension):** POST JSON `ChatPayload` + `Authorization: Bearer <user_jwt>` + `apikey: <anon>`.
 * **Response:** `text/event-stream` with lines `data: {"delta":"..."}\n\n` and terminal `data: [DONE]\n\n`.
 */
/**
 * Supabase Edge runtime exposes `Deno.serve` (recommended for deploy).
 * Equivalent local pattern: `import { serve } from "https://deno.land/std@0.168.0/http/server.ts"`
 * then `serve(handler, { port: Number(Deno.env.get("PORT") ?? "8000") })`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** 302.ai OpenAI-compatible chat endpoint */
const UPSTREAM_CHAT_URL = "https://api.302.ai/v1/chat/completions";
const UPSTREAM_EMBEDDINGS_URL = "https://api.302.ai/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";

/** Avoid sending huge files on every request (tune as needed). */
const MAX_EDITOR_FILE_CHARS = 120_000;

/** 302.AI `/v1/chat/completions` — strict OpenAI-compatible body uses this temperature. */
const CHAT_TEMPERATURE = 0.7;

/**
 * Technical model IDs for https://api.302.ai/v1/chat/completions — invalid `model` returns -10003.
 * Slug keys match `modelId` from the extension (lowercase).
 * Label keys: normalizeModelKey(friendly label).
 */
const MODEL_302_BY_SLUG: Record<string, string> = {
  "gpt-5.4-nano": "gpt-5.4-nano",
  "grok-code-fast": "grok-code-fast-1",
  "qwen-3.5": "qwen3.5-35b-a3b",
  doubao: "doubao-seed-code-preview-latest",
};

const MODEL_302_BY_LABEL: Record<string, string> = {
  "gpt 5.4 nano": "gpt-5.4-nano",
  "gpt 5.4 nano (default)": "gpt-5.4-nano",
  "grok code fast": "grok-code-fast-1",
  "qwen 3.5": "qwen3.5-35b-a3b",
  duobao: "doubao-seed-code-preview-latest",
};

function normalizeModelKey(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

const DEFAULT_UPSTREAM_MODEL =
  MODEL_302_BY_SLUG["gpt-5.4-nano"] ?? "gpt-5.4-nano";

/** Resolves extension `modelId` or a friendly display name to a 302.AI `model` string. */
function resolve302AiModelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_UPSTREAM_MODEL;

  const slugKey = trimmed.toLowerCase();
  if (MODEL_302_BY_SLUG[slugKey]) {
    return MODEL_302_BY_SLUG[slugKey];
  }

  const labelKey = normalizeModelKey(trimmed);
  if (MODEL_302_BY_LABEL[labelKey]) {
    return MODEL_302_BY_LABEL[labelKey];
  }

  const fallback = Deno.env.get("MIRROR_DEFAULT_CHAT_MODEL")?.trim();
  if (fallback) return fallback;

  return trimmed;
}

/**
 * Thinking / code-specialized models: omit `temperature` and `stream_options` so 302.AI
 * does not reject the request (-10003) on providers that only accept a minimal OpenAI body.
 */
const MINIMAL_PAYLOAD_UPSTREAM_MODEL_IDS = new Set<string>([
  "grok-code-fast-1",
  "doubao-seed-code-preview-latest",
]);

function buildUpstreamChatRequestBody(
  upstreamModel: string,
  messages: ReturnType<typeof sanitizeChatMessages>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: upstreamModel,
    messages,
    stream: true,
  };
  if (MINIMAL_PAYLOAD_UPSTREAM_MODEL_IDS.has(upstreamModel)) {
    return base;
  }
  base.temperature = CHAT_TEMPERATURE;
  base.stream_options = { include_usage: true };
  return base;
}

/** Ensures non-empty, valid roles and string content for the upstream API. */
function sanitizeChatMessages(
  messages: OpenAIChatMessage[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const allowed = new Set<string>(["system", "user", "assistant"]);
  const out: Array<{ role: "system" | "user" | "assistant"; content: string }> =
    [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    if (!allowed.has(role)) continue;
    let content = typeof m.content === "string" ? m.content : "";
    if (content.length === 0) content = " ";
    out.push({ role: role as "system" | "user" | "assistant", content });
  }
  if (out.length === 0) {
    return [{ role: "user", content: " " }];
  }
  return out;
}

// ---------------------------------------------------------------------------
// CORS — extension host `fetch` to Supabase is cross-origin; OPTIONS preflight.
// ---------------------------------------------------------------------------
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Matches extension `src/types/chatPayload.ts` */
interface ChatPayload {
  query: string;
  modelId: string;
  workspaceRules: string;
  terminalContext?: {
    recentLines?: string[];
    combinedText?: string;
  };
  editorContext: {
    fileName: string | null;
    fullFileText: string;
    selectedText: string;
  };
}

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Turn workspace rules + editor snapshot + user query into OpenAI-style messages.
 */
function buildOpenAIMessages(
  payload: ChatPayload,
  codebaseContext: string
): OpenAIChatMessage[] {
  const { query, workspaceRules, editorContext, terminalContext } = payload;
  const { fileName, fullFileText, selectedText } = editorContext;

  let fileBody = fullFileText ?? "";
  if (fileBody.length > MAX_EDITOR_FILE_CHARS) {
    fileBody =
      fileBody.slice(0, MAX_EDITOR_FILE_CHARS) +
      "\n\n[... file truncated for context length ...]";
  }

  const rulesBlock = (workspaceRules ?? "").trim()
    ? `## Workspace rules (.mirrorrules)\n${workspaceRules.trim()}`
    : "(No workspace rules file was provided.)";

  const systemContent = [
    "You are Mirror AI, an AI coding assistant inside VS Code.",
    "Follow the workspace rules when relevant. Use markdown in replies.",
    "",
    rulesBlock,
    "",
    "## Current editor context",
    `- Active file: ${fileName ?? "(none)"}`,
    "",
    "### User selection (highlighted text)",
    selectedText?.trim() ? selectedText : "(empty)",
    "",
    "### Full active file",
    "```text",
    fileBody,
    "```",
    "",
    "## Recent terminal context",
    terminalContext?.combinedText?.trim()
      ? terminalContext.combinedText
      : "(no terminal output captured)",
    "",
    "## Codebase Context",
    codebaseContext.trim() ? codebaseContext : "(no relevant indexed chunks found)",
  ].join("\n");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: query },
  ];
}

async function embedText(apiKey: string, input: string): Promise<number[]> {
  const response = await fetch(UPSTREAM_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Query embedding failed (${response.status}): ${detail}`);
  }
  const parsed = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vec = parsed.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== 1536) {
    throw new Error("Invalid query embedding dimension.");
  }
  return vec;
}

/** Pull `usage.total_tokens` from an OpenAI-style stream chunk (often last chunk). */
function getUsageTotalTokens(chunk: {
  choices?: unknown;
  usage?: { total_tokens?: number };
}): number | null {
  const t = chunk.usage?.total_tokens;
  return typeof t === "number" ? t : null;
}

/**
 * Assistant text from OpenAI-style stream chunks.
 * Uses optional chaining (`choices?.[0]?.delta?.content`); usage-only chunks skip text safely.
 * Adds small fallbacks for alternate provider shapes.
 */
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

/** Resolve 302.AI key: prefer explicit name, then legacy secret. */
function resolveUpstreamApiKey(): string | null {
  const a = Deno.env.get("THREETW_AI_API_KEY")?.trim();
  const b = Deno.env.get("AI_UPSTREAM_KEY")?.trim();
  return a || b || null;
}

/**
 * OpenAI/302 stream uses `data: {json}\n\n` with `choices[0].delta.content`.
 * With `stream_options.include_usage`, a final chunk may include `usage` (often with empty `choices`).
 * Mirror extension expects `data: {"delta":"..."}\n\n` and `data: [DONE]\n\n`.
 */
async function* transformUpstreamStreamToMirrorSSE(
  upstreamBody: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      if (value?.length) {
        const rawPreview = new TextDecoder().decode(value).slice(0, 50);
        console.log("[302 upstream raw chunk]", rawPreview);
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (!trimmed.toLowerCase().startsWith("data:")) continue;

        const data = trimmed.slice(5).trimStart();
        if (data === "[DONE]") {
          yield encoder.encode(`data: [DONE]\n\n`);
          continue;
        }
        if (data.length === 0) continue;

        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const usageTokens = getUsageTotalTokens(
          chunk as { choices?: unknown; usage?: { total_tokens?: number } },
        );
        if (usageTokens !== null) {
          yield encoder.encode(
            `data: ${JSON.stringify({ usage_total_tokens: usageTokens })}\n\n`,
          );
        }

        const piece = extractAssistantDeltaText(chunk);
        if (piece !== null) {
          yield encoder.encode(
            `data: ${JSON.stringify({ delta: piece })}\n\n`,
          );
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trimEnd();
      if (trimmed.toLowerCase().startsWith("data:")) {
        const data = trimmed.slice(5).trimStart();
        if (data === "[DONE]") {
          yield encoder.encode(`data: [DONE]\n\n`);
        } else if (data.length > 0) {
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            chunk = undefined;
          }
          if (chunk !== undefined) {
            const usageTokens = getUsageTotalTokens(
              chunk as { choices?: unknown; usage?: { total_tokens?: number } },
            );
            if (usageTokens !== null) {
              yield encoder.encode(
                `data: ${JSON.stringify({ usage_total_tokens: usageTokens })}\n\n`,
              );
            }
            const piece = extractAssistantDeltaText(chunk);
            if (piece !== null) {
              yield encoder.encode(
                `data: ${JSON.stringify({ delta: piece })}\n\n`,
              );
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase env" },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing or invalid Authorization" }, 401);
  }

  const jwt = authHeader.slice("Bearer ".length).trim();
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(jwt);

  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Use user JWT for RLS-aware reads/writes in Postgres.
  const dbClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });

  let payload: ChatPayload;
  try {
    payload = (await req.json()) as ChatPayload;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (typeof payload.query !== "string" || !payload.query.trim()) {
    return jsonResponse({ error: "Missing query" }, 400);
  }

  const uiModelId =
    typeof payload.modelId === "string" && payload.modelId.trim()
      ? payload.modelId.trim()
      : "gpt-5.4-nano";
  const upstreamModel = resolve302AiModelId(uiModelId);

  if (!payload.editorContext || typeof payload.editorContext !== "object") {
    return jsonResponse({ error: "Missing editorContext" }, 400);
  }

  const { data: quotaRow, error: quotaError } = await dbClient
    .from("user_quotas")
    .select("tokens_used, total_quota")
    .eq("id", user.id)
    .maybeSingle();
  if (quotaError) {
    return jsonResponse(
      { error: `Failed to read user quota: ${quotaError.message}` },
      500
    );
  }
  if (!quotaRow) {
    return jsonResponse({ error: "Quota row not found for user." }, 403);
  }
  const tokensUsed =
    typeof quotaRow.tokens_used === "number" ? quotaRow.tokens_used : 0;
  const totalQuota =
    typeof quotaRow.total_quota === "number" ? quotaRow.total_quota : 0;
  const remainingBefore = Math.max(0, totalQuota - tokensUsed);
  if (remainingBefore <= 0) {
    return jsonResponse({ error: "Insufficient token quota." }, 402);
  }

  const apiKey = resolveUpstreamApiKey();
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "THREETW_AI_API_KEY or AI_UPSTREAM_KEY is not set. Use: supabase secrets set THREETW_AI_API_KEY=...",
      },
      503,
    );
  }

  let codebaseContext = "";
  try {
    const queryEmbedding = await embedText(apiKey, payload.query);
    const { data: matches, error: matchErr } = await dbClient.rpc(
      "match_documents",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.65,
        match_count: 5,
      }
    );
    if (matchErr) {
      console.warn("match_documents failed:", matchErr.message);
    } else if (Array.isArray(matches) && matches.length > 0) {
      codebaseContext = matches
        .map((m: { file_path?: string; content?: string; similarity?: number }) => {
          const path = typeof m.file_path === "string" ? m.file_path : "(unknown)";
          const content = typeof m.content === "string" ? m.content : "";
          const similarity =
            typeof m.similarity === "number"
              ? m.similarity.toFixed(3)
              : "n/a";
          return [
            `### ${path} (similarity: ${similarity})`,
            "```text",
            content.slice(0, 4000),
            "```",
          ].join("\n");
        })
        .join("\n\n");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("RAG retrieval fallback:", msg);
    // graceful fallback: continue chat without codebase context
    codebaseContext = "";
  }

  const builtMessages = buildOpenAIMessages(payload, codebaseContext);
  const messages = sanitizeChatMessages(builtMessages);

  const requestBody = buildUpstreamChatRequestBody(upstreamModel, messages);

  console.log("Sending to 302.AI:", JSON.stringify(requestBody, null, 2));

  const upstreamResponse = await fetch(UPSTREAM_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text();
    let providerMessage = errText;
    try {
      const j = JSON.parse(errText) as {
        error?: { message?: string } | string;
        message?: string;
        msg?: string;
      };
      if (typeof j.error === "string") {
        providerMessage = j.error;
      } else if (j.error && typeof j.error === "object" && j.error.message) {
        providerMessage = j.error.message;
      } else if (typeof j.message === "string") {
        providerMessage = j.message;
      } else if (typeof j.msg === "string") {
        providerMessage = j.msg;
      }
    } catch {
      /* use raw errText */
    }
    return jsonResponse(
      {
        error: providerMessage.slice(0, 4000),
        upstream_status: upstreamResponse.status,
        upstream_raw: errText.slice(0, 8000),
      },
      502,
    );
  }

  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    return jsonResponse({ error: "Empty upstream body" }, 502);
  }

  const inputCharCount = messages.reduce(
    (acc, m) => acc + m.content.length,
    0,
  );

  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let usedTokensFromStream: number | null = null;
      let outputCharCount = 0;
      try {
        for await (const chunk of transformUpstreamStreamToMirrorSSE(
          upstreamBody,
        )) {
          const text = new TextDecoder().decode(chunk);
          for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trimStart();
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload) as {
                usage_total_tokens?: number;
                delta?: string;
              };
              if (typeof parsed.usage_total_tokens === "number") {
                usedTokensFromStream = parsed.usage_total_tokens;
              }
              if (typeof parsed.delta === "string") {
                outputCharCount += parsed.delta.length;
              }
            } catch {
              // ignore partial / non-JSON lines
            }
          }
          controller.enqueue(chunk);
        }

        let deductTokens = usedTokensFromStream;
        if (deductTokens === null || deductTokens === undefined) {
          const estimated = Math.max(
            1,
            Math.ceil((inputCharCount + outputCharCount) / 4),
          );
          console.warn(
            "Usage data missing, using estimated quota deduction.",
            { inputCharCount, outputCharCount, estimated },
          );
          deductTokens = estimated;
        }

        const newTokensUsed = Math.min(
          totalQuota,
          tokensUsed + deductTokens,
        );
        const { data: updatedQuota, error: deductError } = await dbClient
          .from("user_quotas")
          .update({
            tokens_used: newTokensUsed,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id)
          .select("tokens_used, total_quota")
          .single();
        if (deductError) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: `Quota update failed: ${deductError.message}`,
              })}\n\n`
            )
          );
        } else {
          const tu =
            typeof updatedQuota.tokens_used === "number"
              ? updatedQuota.tokens_used
              : 0;
          const tq =
            typeof updatedQuota.total_quota === "number"
              ? updatedQuota.total_quota
              : 0;
          const remaining_tokens = Math.max(0, tq - tu);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                remaining_tokens,
              })}\n\n`
            )
          );
        }

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(outputStream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

Deno.serve(handler);
