/**
 * Build Ultra — Supabase Edge Function `embed`
 *
 * Receives workspace chunks from the extension host, generates embeddings via a
 * proprietary OpenAI-compatible API, and stores vectors in `workspace_documents`
 * using the caller's JWT (RLS enforced per-user).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function resolveUpstreamEmbeddingsUrl(): string | null {
  return Deno.env.get("BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL")?.trim() || null;
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
  batch: ChunkInput[]
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
      `Embedding count mismatch: got ${vectors.length}, expected ${batch.length}.`
    );
  }
  for (const vec of vectors) {
    if (!Array.isArray(vec) || vec.length !== EXPECTED_DIM) {
      throw new Error(
        `Invalid embedding dimension: expected ${EXPECTED_DIM}, got ${vec.length}.`
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
      500
    );
  }
  if (!embeddingsUrl) {
    return jsonResponse(
      {
        error:
          "BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL is not set. Use: supabase secrets set BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL=...",
      },
      503
    );
  }
  if (!upstreamKey) {
    return jsonResponse(
      {
        error:
          "AI_UPSTREAM_KEY is not set. Use: supabase secrets set AI_UPSTREAM_KEY=...",
      },
      503
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
  const chunksRaw = (raw as { chunks?: unknown[] }).chunks;
  if (!Array.isArray(chunksRaw)) {
    return jsonResponse({ error: "Body must include `chunks` array." }, 400);
  }
  if (chunksRaw.length > MAX_CHUNKS_PER_REQUEST) {
    return jsonResponse(
      { error: `Too many chunks. Max ${MAX_CHUNKS_PER_REQUEST} per request.` },
      413
    );
  }

  const chunks = chunksRaw.filter(isValidChunk).map((c) => ({
    ...c,
    content: c.content.slice(0, MAX_CHUNK_CHARS),
  }));
  if (chunks.length === 0) {
    return jsonResponse({ received: 0, embedded: 0, inserted: 0 }, 200);
  }

  const dbClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });

  // Simple de-dup strategy: clear user's existing index before full re-index.
  const { error: clearErr } = await dbClient
    .from("workspace_documents")
    .delete()
    .eq("user_id", user.id);
  if (clearErr) {
    return jsonResponse(
      { error: `Failed to clear existing index: ${clearErr.message}` },
      500
    );
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
        // keep each chunk addressable without schema changes
        file_path: `${b.file_path}#chunk-${b.chunk_index}`,
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
      500
    );
  }

  return jsonResponse(
    {
      received: chunksRaw.length,
      embedded,
      inserted: rowsToInsert.length,
      elapsed_ms: Date.now() - startedAt,
    },
    200
  );
}

Deno.serve(handler);

