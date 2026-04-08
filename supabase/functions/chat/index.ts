/**
 * Mirror — Supabase Edge Function `chat`
 *
 * Secure bridge between the VS Code extension and 302.ai (OpenAI-compatible API).
 * Deploy: `supabase secrets set AI_UPSTREAM_KEY=...` then `supabase functions deploy chat`
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

/** Avoid sending huge files on every request (tune as needed). */
const MAX_EDITOR_FILE_CHARS = 120_000;

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
function buildOpenAIMessages(payload: ChatPayload): OpenAIChatMessage[] {
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
    "You are Mirror, an AI coding assistant inside VS Code.",
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
  ].join("\n");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: query },
  ];
}

/**
 * OpenAI/302 stream uses `data: {json}\n\n` with `choices[0].delta.content`.
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
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trimStart();
        if (data === "[DONE]") {
          yield encoder.encode(`data: [DONE]\n\n`);
          continue;
        }

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string | null };
            }>;
            usage?: { total_tokens?: number };
          };
          const hasEmptyChoices =
            Array.isArray(chunk.choices) && chunk.choices.length === 0;
          const totalTokens = chunk.usage?.total_tokens;
          // Final usage chunk from upstream: no choices + usage totals.
          if (hasEmptyChoices && typeof totalTokens === "number") {
            yield encoder.encode(
              `data: ${JSON.stringify({ usage_total_tokens: totalTokens })}\n\n`,
            );
            continue;
          }
          const piece = chunk.choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece.length > 0) {
            yield encoder.encode(
              `data: ${JSON.stringify({ delta: piece })}\n\n`,
            );
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trimEnd();
      if (trimmed.startsWith("data:")) {
        const data = trimmed.slice(5).trimStart();
        if (data === "[DONE]") {
          yield encoder.encode(`data: [DONE]\n\n`);
        } else {
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
              usage?: { total_tokens?: number };
            };
            const hasEmptyChoices =
              Array.isArray(chunk.choices) && chunk.choices.length === 0;
            const totalTokens = chunk.usage?.total_tokens;
            if (hasEmptyChoices && typeof totalTokens === "number") {
              yield encoder.encode(
                `data: ${JSON.stringify({ usage_total_tokens: totalTokens })}\n\n`,
              );
              continue;
            }
            const piece = chunk.choices?.[0]?.delta?.content;
            if (typeof piece === "string" && piece.length > 0) {
              yield encoder.encode(
                `data: ${JSON.stringify({ delta: piece })}\n\n`,
              );
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

  const model =
    typeof payload.modelId === "string" && payload.modelId.trim()
      ? payload.modelId.trim()
      : "gpt-4o-mini";

  if (!payload.editorContext || typeof payload.editorContext !== "object") {
    return jsonResponse({ error: "Missing editorContext" }, 400);
  }

  const { data: quotaRow, error: quotaError } = await dbClient
    .from("user_quotas")
    .select("remaining_tokens")
    .eq("user_id", user.id)
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
  if (typeof quotaRow.remaining_tokens !== "number" || quotaRow.remaining_tokens <= 0) {
    return jsonResponse({ error: "Insufficient token quota." }, 402);
  }

  const apiKey = Deno.env.get("AI_UPSTREAM_KEY");
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "AI_UPSTREAM_KEY is not set. Use: supabase secrets set AI_UPSTREAM_KEY=...",
      },
      503,
    );
  }

  const messages = buildOpenAIMessages(payload);

  const upstreamResponse = await fetch(UPSTREAM_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    }),
  });

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text();
    return jsonResponse(
      {
        error: "Upstream error",
        status: upstreamResponse.status,
        detail: errText.slice(0, 2000),
      },
      502,
    );
  }

  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    return jsonResponse({ error: "Empty upstream body" }, 502);
  }

  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let usedTokensExact: number | null = null;
      try {
        for await (const chunk of transformUpstreamStreamToMirrorSSE(
          upstreamBody,
        )) {
          const text = new TextDecoder().decode(chunk);
          const match = /^data:\s*(.+)$/m.exec(text);
          if (match && match[1] && match[1] !== "[DONE]") {
            try {
              const parsed = JSON.parse(match[1]) as {
                usage_total_tokens?: number;
              };
              if (typeof parsed.usage_total_tokens === "number") {
                usedTokensExact = parsed.usage_total_tokens;
              }
            } catch {
              // ignore parse failures on usage accounting
            }
          }
          controller.enqueue(chunk);
        }

        if (usedTokensExact === null) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error:
                  "Upstream stream ended without usage.total_tokens; quota was not deducted.",
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          return;
        }

        const { data: updatedQuota, error: deductError } = await dbClient
          .from("user_quotas")
          .update({
            remaining_tokens: Math.max(
              0,
              quotaRow.remaining_tokens - usedTokensExact,
            ),
          })
          .eq("user_id", user.id)
          .select("remaining_tokens")
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
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                remaining_tokens: updatedQuota.remaining_tokens,
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
