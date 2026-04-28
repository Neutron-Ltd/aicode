/**
 * Build Ultra — Supabase Edge Function `embed`
 *
 * Receives workspace chunks from the extension host, generates embeddings via a
 * backend-owned OpenAI-compatible embeddings endpoint (URL from env). The gateway may proxy to
 * vendor-specific APIs; request bodies use the OpenAI embeddings shape unless extended later.
 *
 * Body: `{ chunks?, reindex?: "full" | "incremental", incremental_for_paths?: string[] }`
 * — `reindex` defaults to `"full"`. Incremental updates delete prior `file_path#chunk-*` rows
 * for touched paths only, then insert new embeddings.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function resolveUpstreamEmbeddingsUrl(): string | null {
  return Deno.env.get("BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL")?.trim() || null;
}

/** See `BUILD_ULTRA_UPSTREAM_FORMAT` in `chat` — only OpenAI-compatible payloads are implemented. */
function resolveUpstreamPayloadFormat(): "openai" {
  const raw = Deno.env.get("BUILD_ULTRA_UPSTREAM_FORMAT")?.trim().toLowerCase();
  if (!raw || raw === "openai") {
    return "openai";
  }
  console.warn(
    `[embed] BUILD_ULTRA_UPSTREAM_FORMAT=${raw} not implemented; using OpenAI-compatible payloads.`,
  );
  return "openai";
}
const EMBEDDING_MODEL = "text-embedding-3-small";
const EXPECTED_DIM = 1536;
const MAX_CHUNKS_PER_REQUEST = 2000;
const MAX_CHUNK_CHARS = 8000;
const BATCH_SIZE = 50;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Max-Age": "86400",
};

type ChunkInput = {
  file_path: string;
  content: string;
  chunk_index: number;
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidChunk(v: unknown): v is ChunkInput {
  if (!v || typeof v !== "object") return false;
  const c = v as ChunkInput;
  return (
    typeof c.file_path === "string" &&
    c.file_path.length > 0 &&
    typeof c.content === "string" &&
    c.content.length > 0 &&
    typeof c.chunk_index === "number"
  );
}

function normalizeLogicalPath(raw: string): string {
  const t = raw.trim().replace(/\\/g, "/");
  const hash = t.indexOf("#chunk-");
  return hash >= 0 ? t.slice(0, hash) : t;
}

/** PostgreSQL LIKE: literal `%`, `_`, and `\` inside logical path segments. */
function likePatternChunkPrefix(logicalPath: string): string {
  const p = logicalPath.replace(/\\/g, "\\\\").replace(/%/g, "[%]").replace(/_/g, "[_]");
  return `${p}#chunk-%`;
}

function batchArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function embedBatch(
  embeddingsUrl: string,
  apiKey: string,
  batch: ChunkInput[],
): Promise<number[][]> {
  const response = await fetch(embeddingsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: batch.map((b) => b.content),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Embedding upstream failed (${response.status}): ${detail}`);
  }

  const parsed = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vectors = (parsed.data ?? []).map((d) => d.embedding ?? []);
  if (vectors.length !== batch.length) {
    throw new Error(
      `Embedding count mismatch: got ${vectors.length}, expected ${batch.length}.`,
    );
  }
  for (const vec of vectors) {
    if (!Array.isArray(vec) || vec.length !== EXPECTED_DIM) {
      throw new Error(
        `Invalid embedding dimension: expected ${EXPECTED_DIM}, got ${vec.length}.`,
      );
    }
  }
  return vectors;
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
  const upstreamKey = Deno.env.get("AI_UPSTREAM_KEY");
  const embeddingsUrl = resolveUpstreamEmbeddingsUrl();
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase env." },
      500,
    );
  }
  if (!embeddingsUrl) {
    return jsonResponse(
      {
        error:
          "BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL is not set. Use: supabase secrets set BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL=...",
      },
      503,
    );
  }
  void resolveUpstreamPayloadFormat();
  if (!upstreamKey) {
    return jsonResponse(
      {
        error:
          "AI_UPSTREAM_KEY is not set. Use: supabase secrets set AI_UPSTREAM_KEY=...",
      },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing or invalid Authorization." }, 401);
  }
  const jwt = authHeader.slice("Bearer ".length).trim();

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
    error: userErr,
  } = await authClient.auth.getUser(jwt);
  if (userErr || !user) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const body = raw as {
    chunks?: unknown[];
    reindex?: string;
    incremental_for_paths?: unknown;
  };

  const chunksRaw = Array.isArray(body.chunks) ? body.chunks : [];
  if (chunksRaw.length > MAX_CHUNKS_PER_REQUEST) {
    return jsonResponse(
      { error: `Too many chunks. Max ${MAX_CHUNKS_PER_REQUEST} per request.` },
      413,
    );
  }

  const reindexRaw = typeof body.reindex === "string" ? body.reindex.trim() : "";
  const mode = reindexRaw === "incremental" ? "incremental" : "full";

  const chunks = chunksRaw.filter(isValidChunk).map((c) => ({
    ...c,
    content: c.content.slice(0, MAX_CHUNK_CHARS),
  }));

  const explicitPaths: string[] = [];
  if (Array.isArray(body.incremental_for_paths)) {
    for (const p of body.incremental_for_paths) {
      if (typeof p === "string" && p.trim()) {
        explicitPaths.push(normalizeLogicalPath(p));
      }
    }
  }

  const pathsToTouch = new Set<string>(explicitPaths);
  for (const c of chunks) {
    pathsToTouch.add(normalizeLogicalPath(c.file_path));
  }

  if (mode === "incremental" && pathsToTouch.size === 0) {
    return jsonResponse({
      error:
        "incremental reindex requires `incremental_for_paths` and/or at least one valid chunk with file_path.",
    }, 400);
  }

  const dbClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });

  if (mode === "full") {
    const { error: clearErr } = await dbClient
      .from("workspace_documents")
      .delete()
      .eq("user_id", user.id);
    if (clearErr) {
      return jsonResponse(
        { error: `Failed to clear existing index: ${clearErr.message}` },
        500,
      );
    }
    if (chunks.length === 0) {
      return jsonResponse(
        {
          received: chunksRaw.length,
          embedded: 0,
          inserted: 0,
          reindex: "full",
          cleared: true,
        },
        200,
      );
    }
  } else {
    for (const logicalPath of pathsToTouch) {
      const pattern = likePatternChunkPrefix(logicalPath);
      const { error: delErr } = await dbClient
        .from("workspace_documents")
        .delete()
        .eq("user_id", user.id)
        .like("file_path", pattern);
      if (delErr) {
        return jsonResponse(
          { error: `Failed to delete chunks for ${logicalPath}: ${delErr.message}` },
          500,
        );
      }
    }
    if (chunks.length === 0) {
      return jsonResponse(
        {
          received: chunksRaw.length,
          embedded: 0,
          inserted: 0,
          reindex: "incremental",
          paths_refreshed: [...pathsToTouch],
        },
        200,
      );
    }
  }

  const startedAt = Date.now();
  let embedded = 0;
  const rowsToInsert: Array<{
    user_id: string;
    file_path: string;
    content: string;
    embedding: number[];
  }> = [];

  for (const batch of batchArray(chunks, BATCH_SIZE)) {
    const vectors = await embedBatch(embeddingsUrl, upstreamKey, batch);
    embedded += vectors.length;
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      rowsToInsert.push({
        user_id: user.id,
        file_path: `${normalizeLogicalPath(b.file_path)}#chunk-${b.chunk_index}`,
        content: b.content,
        embedding: vectors[i],
      });
    }
  }

  const { error: insertErr } = await dbClient
    .from("workspace_documents")
    .insert(rowsToInsert);
  if (insertErr) {
    return jsonResponse(
      { error: `Failed to persist embeddings: ${insertErr.message}` },
      500,
    );
  }

  return jsonResponse(
    {
      received: chunksRaw.length,
      embedded,
      inserted: rowsToInsert.length,
      elapsed_ms: Date.now() - startedAt,
      reindex: mode,
      paths_refreshed: mode === "incremental" ? [...pathsToTouch] : undefined,
    },
    200,
  );
}

Deno.serve(handler);
