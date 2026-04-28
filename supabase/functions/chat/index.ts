/**
 * Build Ultra — Supabase Edge Function `chat`
 *
 * Secure bridge between the VS Code extension and a backend-owned upstream (e.g. OpenAI-compatible
 * gateways, including proxies toward IDE vendor APIs). Point `BUILD_ULTRA_UPSTREAM_CHAT_URL` at your
 * gateway; request bodies follow the OpenAI Chat Completions shape unless a future format flag applies.
 * Deploy: set `BUILD_ULTRA_UPSTREAM_CHAT_URL`, `BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL`, and
 * `AI_UPSTREAM_KEY` (or `THREETW_AI_API_KEY`) then `supabase functions deploy chat`
 *
 * **Client (extension):** POST JSON `ChatPayload` + `Authorization: Bearer <user_jwt>` + `apikey: <anon>`.
 * **Response:** `text/event-stream` with lines `data: {"delta":"..."}\n\n` and terminal `data: [DONE]\n\n`.
 */
/**
 * Supabase Edge runtime exposes `Deno.serve` (recommended for deploy).
 * Equivalent local pattern: `import { serve } from "https://deno.land/std@0.168.0/http/server.ts"`
 * then `serve(handler, { port: Number(Deno.env.get("PORT") ?? "8000") })`.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const EMBEDDING_MODEL = "text-embedding-3-small";

/** Avoid sending huge files on every request (tune as needed). */
const MAX_EDITOR_FILE_CHARS = 120_000;

/** Rough context budget (characters) for RAG + active file + rules — diagnostics & terminal exempt. */
const MAX_CONTEXT_CHARS = 100_000;

/** Approximate tokens from UTF-16 length (fast; aligns with PRD token window step). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const RATE_LIMIT_PER_MINUTE = 60;

/** OpenAI-compatible `/v1/chat/completions` body uses this temperature. */
const CHAT_TEMPERATURE = 0.7;

/**
 * When `modelId` is empty and `BUILD_ULTRA_DEFAULT_CHAT_MODEL` is unset.
 * Upstream routing is opaque; this is only a deterministic last resort.
 */
const FALLBACK_UPSTREAM_MODEL = "default";

function resolveUpstreamChatUrl(): string | null {
  return Deno.env.get("BUILD_ULTRA_UPSTREAM_CHAT_URL")?.trim() || null;
}

function resolveUpstreamEmbeddingsUrl(): string | null {
  return Deno.env.get("BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL")?.trim() || null;
}

/** Passes through non-empty `modelId`; otherwise env default or {@link FALLBACK_UPSTREAM_MODEL}. */
function resolveUpstreamModel(raw: string): string {
  const t = raw.trim();
  if (t) return t;
  return Deno.env.get("BUILD_ULTRA_DEFAULT_CHAT_MODEL")?.trim() ||
    FALLBACK_UPSTREAM_MODEL;
}

/**
 * Reserved for non–OpenAI-compatible gateways. Only `openai` is implemented; any other value logs a
 * warning and still sends OpenAI-style JSON (`model`, `messages`, `stream`, etc.).
 */
function resolveUpstreamPayloadFormat(): "openai" {
  const raw = Deno.env.get("BUILD_ULTRA_UPSTREAM_FORMAT")?.trim().toLowerCase();
  if (!raw || raw === "openai") {
    return "openai";
  }
  console.warn(
    `[chat] BUILD_ULTRA_UPSTREAM_FORMAT=${raw} not implemented; using OpenAI-compatible payloads.`,
  );
  return "openai";
}

function buildUpstreamChatRequestBody(
  upstreamModel: string,
  messages: ReturnType<typeof sanitizeChatMessages>,
): Record<string, unknown> {
  return {
    model: upstreamModel,
    messages,
    stream: true,
    temperature: CHAT_TEMPERATURE,
    stream_options: { include_usage: true },
    tools: OPENAI_TOOLS,
    tool_choice: "auto",
  };
}

/** Normalizes messages for the upstream API (supports tool follow-ups). */
function sanitizeChatMessages(messages: OpenAIChatMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    if (typeof role !== "string") continue;

    if (role === "tool") {
      const content = typeof m.content === "string" ? m.content : " ";
      const tool_call_id = typeof m.tool_call_id === "string"
        ? m.tool_call_id
        : "";
      const entry: OpenAIChatMessage = {
        role: "tool",
        content: content.length ? content : " ",
        tool_call_id,
      };
      if (typeof m.name === "string") entry.name = m.name;
      out.push(entry);
      continue;
    }

    if (
      role !== "system" && role !== "user" && role !== "assistant"
    ) {
      continue;
    }

    const hasTools = Boolean(m.tool_calls);
    let content: string | null = typeof m.content === "string" ? m.content : null;
    if (role === "assistant" && hasTools && (content === null || content === "")) {
      const entry: OpenAIChatMessage = { role, content: null };
      entry.tool_calls = m.tool_calls;
      out.push(entry);
      continue;
    }
    const c = content ?? "";
    const entry: OpenAIChatMessage = { role, content: c.length ? c : " " };
    if (m.tool_calls) entry.tool_calls = m.tool_calls;
    if (typeof m.name === "string") entry.name = m.name;
    out.push(entry);
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

/** Upstream LLM unreachable or error — client shows maintenance UI (no raw provider details). */
function maintenanceJsonResponse(): Response {
  return jsonResponse({ status: "maintenance" }, 503);
}

/** Matches extension `src/types/chatPayload.ts` */
interface ChatPayload {
  query: string;
  modelId: string;
  workspaceRules: string;
  diagnosticsSummary?: string;
  terminalContext?: {
    recentLines?: string[];
    combinedText?: string;
  };
  editorContext: {
    fileName: string | null;
    fullFileText: string;
    selectedText: string;
  };
  conversationOverride?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
}

type OpenAIChatMessage = Record<string, unknown>;

const OPENAI_TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read UTF-8 text from a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Replace a contiguous line range in an existing file. You must pass range (1-based inclusive lines). For a whole-file rewrite use startLine 1 and endLine equal to the file's line count (read_file first). For brand-new paths use create_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          range: {
            type: "object",
            properties: {
              startLine: { type: "integer", description: "1-based inclusive" },
              endLine: { type: "integer", description: "1-based inclusive" },
            },
            required: ["startLine", "endLine"],
          },
        },
        required: ["path", "content", "range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List non-hidden entries in a directory under the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path" },
        },
        required: ["path"],
      },
    },
  },
];

async function enforceRateLimit(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const minuteKey = new Date(
    Math.floor(Date.now() / 60_000) * 60_000,
  ).toISOString();
  const { data: row, error: selErr } = await admin
    .from("chat_rate_counters")
    .select("minute_bucket, request_count")
    .eq("user_id", userId)
    .maybeSingle();
  if (selErr) {
    console.warn("rate limit select:", selErr.message);
    return true;
  }
  if (!row) {
    const { error } = await admin.from("chat_rate_counters").insert({
      user_id: userId,
      minute_bucket: minuteKey,
      request_count: 1,
    });
    if (error) console.warn("rate limit insert:", error.message);
    return true;
  }
  const bucket = row.minute_bucket as string;
  const count = typeof row.request_count === "number" ? row.request_count : 0;
  if (bucket !== minuteKey) {
    await admin
      .from("chat_rate_counters")
      .update({
        minute_bucket: minuteKey,
        request_count: 1,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return true;
  }
  if (count >= RATE_LIMIT_PER_MINUTE) {
    return false;
  }
  await admin
    .from("chat_rate_counters")
    .update({
      request_count: count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return true;
}

async function fetchMasterSystemPrompt(
  dbClient: SupabaseClient,
): Promise<string> {
  const { data, error } = await dbClient
    .from("master_prompts")
    .select("content")
    .eq("name", "default")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("master_prompts:", error.message);
  }
  if (data && typeof (data as { content?: string }).content === "string") {
    return (data as { content: string }).content;
  }
  return "You are Ultra AI, a coding assistant for Build Ultra in VS Code.";
}

/**
 * Prune lowest-priority context first: RAG, then active file text, then workspace rules.
 */
function truncateRagFileRules(
  codebaseContext: string,
  fileBody: string,
  workspaceRules: string,
  maxChars: number,
): { rag: string; file: string; rules: string } {
  let rag = codebaseContext.trim();
  let file = fileBody;
  let rules = workspaceRules.trim();
  let total = rag.length + file.length + rules.length;
  if (total <= maxChars) {
    return { rag, file, rules };
  }

  let over = total - maxChars;
  if (rag.length >= over) {
    rag = rag.slice(0, Math.max(0, rag.length - over)) +
      "\n\n[… RAG context truncated for token budget …]";
    return { rag, file, rules };
  }
  over -= rag.length;
  rag = rag.slice(0, Math.max(0, rag.length - Math.floor(rag.length * 0.5))) +
    "\n\n[… RAG truncated …]";
  total = rag.length + file.length + rules.length;
  if (total <= maxChars) {
    return { rag, file, rules };
  }
  over = total - maxChars;

  if (file.length >= over) {
    file = file.slice(0, Math.max(0, file.length - over)) +
      "\n\n[… active file truncated for token budget …]";
    return { rag, file, rules };
  }
  over -= file.length;
  file = file.slice(0, Math.max(0, file.length - Math.floor(file.length * 0.5))) +
    "\n\n[… active file truncated …]";
  total = rag.length + file.length + rules.length;
  if (total <= maxChars) {
    return { rag, file, rules };
  }
  over = total - maxChars;

  if (rules.length >= over) {
    rules = rules.slice(0, Math.max(0, rules.length - over)) + "\n\n[… rules truncated …]";
    return { rag, file, rules };
  }
  rules = rules.slice(0, Math.max(0, rules.length - Math.max(over, 0))) + "\n\n[… rules truncated …]";
  return { rag, file, rules };
}

function buildContextUserMessage(payload: ChatPayload, rag: string, fileBody: string): string {
  const { workspaceRules, editorContext, terminalContext, diagnosticsSummary } = payload;
  const { fileName, selectedText } = editorContext;
  const rulesBlock = (workspaceRules ?? "").trim()
    ? `## Workspace rules (.ultrarules)\n${workspaceRules.trim()}`
    : "(No workspace rules file.)";
  const diag = (diagnosticsSummary ?? "").trim()
    ? `## Diagnostics (active file)\n${diagnosticsSummary.trim()}`
    : "(No diagnostics for the active file.)";
  return [
    "## Context bundle (not the user question)",
    "",
    diag,
    "",
    rulesBlock,
    "",
    "## Editor",
    `- Active file: ${fileName ?? "(none)"}`,
    "### Selection",
    selectedText?.trim() ? selectedText : "(empty)",
    "",
    "### Active file text",
    "```text",
    fileBody,
    "```",
    "",
    "## Indexed codebase (RAG)",
    rag.trim() ? rag : "(no relevant chunks)",
    "",
    "## Terminal",
    terminalContext?.combinedText?.trim()
      ? terminalContext.combinedText
      : "(no terminal output)",
  ].join("\n");
}

function assembleChatMessages(
  masterSystem: string,
  payload: ChatPayload,
  codebaseContext: string,
): OpenAIChatMessage[] {
  if (payload.conversationOverride?.length) {
    return [
      { role: "system", content: masterSystem },
      ...payload.conversationOverride.map((m) => {
        const o: OpenAIChatMessage = { role: m.role };
        if (m.role === "tool") {
          o.content = typeof m.content === "string" && m.content.length ? m.content : " ";
          if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
          if (m.name) o.name = m.name;
          return o;
        }
        if (m.tool_calls) {
          o.tool_calls = m.tool_calls;
          if (m.content === null || m.content === undefined) {
            o.content = null;
          } else {
            o.content = m.content;
          }
        } else {
          o.content = m.content ?? "";
        }
        if (m.name) o.name = m.name;
        return o;
      }),
    ];
  }

  let fileBody = payload.editorContext.fullFileText ?? "";
  if (fileBody.length > MAX_EDITOR_FILE_CHARS) {
    fileBody =
      fileBody.slice(0, MAX_EDITOR_FILE_CHARS) +
      "\n\n[... file truncated ...]";
  }
  const rulesRaw = (payload.workspaceRules ?? "").trim();
  const { rag, file, rules } = truncateRagFileRules(
    codebaseContext,
    fileBody,
    rulesRaw,
    MAX_CONTEXT_CHARS,
  );
  const contextPack = buildContextUserMessage(
    { ...payload, workspaceRules: rules, editorContext: { ...payload.editorContext, fullFileText: file } },
    rag,
    file,
  );

  return [
    { role: "system", content: masterSystem },
    { role: "user", content: contextPack },
    { role: "user", content: payload.query.trim() },
  ];
}

async function embedText(
  apiKey: string,
  embeddingsUrl: string,
  input: string,
): Promise<number[]> {
  const response = await fetch(embeddingsUrl, {
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

type ToolCallAcc = Map<
  number,
  { id?: string; name?: string; arguments: string }
>;

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

function finalizeToolCalls(acc: ToolCallAcc): unknown[] {
  const out: unknown[] = [];
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

/** Prefer explicit name, then shared secret. */
function resolveUpstreamApiKey(): string | null {
  const a = Deno.env.get("THREETW_AI_API_KEY")?.trim();
  const b = Deno.env.get("AI_UPSTREAM_KEY")?.trim();
  return a || b || null;
}

/**
 * OpenAI-compatible stream uses `data: {json}\n\n` with `choices[0].delta.content`.
 * With `stream_options.include_usage`, a final chunk may include `usage` (often with empty `choices`).
 * Build Ultra extension expects `data: {"delta":"..."}\n\n` and `data: [DONE]\n\n`.
 */
async function* transformUpstreamStreamToUltraSSE(
  upstreamBody: ReadableStream<Uint8Array>,
  toolAcc: ToolCallAcc,
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
        console.log("[upstream raw chunk]", rawPreview);
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

        accumulateToolCallsFromChunk(chunk, toolAcc);

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
            accumulateToolCallsFromChunk(chunk, toolAcc);
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

    const finalized = finalizeToolCalls(toolAcc);
    if (finalized.length > 0) {
      yield encoder.encode(
        `data: ${JSON.stringify({ tool_calls: finalized })}\n\n`,
      );
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

  const upstreamChatUrl = resolveUpstreamChatUrl();
  const upstreamEmbeddingsUrl = resolveUpstreamEmbeddingsUrl();
  if (!upstreamChatUrl || !upstreamEmbeddingsUrl) {
    return jsonResponse(
      {
        error:
          "BUILD_ULTRA_UPSTREAM_CHAT_URL and BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL must be set.",
      },
      503,
    );
  }

  void resolveUpstreamPayloadFormat();

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

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (serviceRoleKey) {
    const rateAdmin = createClient(supabaseUrl, serviceRoleKey);
    const allowed = await enforceRateLimit(rateAdmin, user.id);
    if (!allowed) {
      return jsonResponse(
        { error: "Rate limit exceeded. Try again in about a minute." },
        429,
      );
    }
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

  const hasOverride = Boolean(
    payload.conversationOverride && payload.conversationOverride.length > 0,
  );
  if (
    !hasOverride &&
    (typeof payload.query !== "string" || !payload.query.trim())
  ) {
    return jsonResponse({ error: "Missing query" }, 400);
  }

  const uiModelId = typeof payload.modelId === "string" ? payload.modelId : "";
  const upstreamModel = resolveUpstreamModel(uiModelId);

  if (
    !hasOverride &&
    (!payload.editorContext || typeof payload.editorContext !== "object")
  ) {
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

  const masterSystem = await fetchMasterSystemPrompt(dbClient);

  let codebaseContext = "";
  if (!hasOverride) {
    try {
      const queryEmbedding = await embedText(
        apiKey,
        upstreamEmbeddingsUrl,
        payload.query,
      );
      const { data: matches, error: matchErr } = await dbClient.rpc(
        "match_documents",
        {
          query_embedding: queryEmbedding,
          match_threshold: 0.65,
          match_count: 5,
        },
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
      codebaseContext = "";
    }
  }

  const builtMessages = assembleChatMessages(masterSystem, payload, codebaseContext);
  const messages = sanitizeChatMessages(builtMessages);
  const approxPromptTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(String(m.content ?? "")),
    0,
  );
  console.log(`[chat] approx prompt tokens (len/4): ${approxPromptTokens}`);

  const requestBody = buildUpstreamChatRequestBody(upstreamModel, messages);

  console.log("Sending to upstream:", JSON.stringify(requestBody, null, 2));

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamChatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[chat] upstream fetch failed:", msg);
    return maintenanceJsonResponse();
  }

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text().catch(() => "");
    console.warn(
      "[chat] upstream HTTP error:",
      upstreamResponse.status,
      errText.slice(0, 500),
    );
    return maintenanceJsonResponse();
  }

  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    console.warn("[chat] upstream returned empty body stream");
    return maintenanceJsonResponse();
  }

  const inputCharCount = messages.reduce((acc, m) => {
    const c = m.content;
    return acc + (typeof c === "string" ? c.length : 0);
  }, 0);

  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let usedTokensFromStream: number | null = null;
      let outputCharCount = 0;
      try {
        const toolAcc: ToolCallAcc = new Map();
        for await (const chunk of transformUpstreamStreamToUltraSSE(
          upstreamBody,
          toolAcc,
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
