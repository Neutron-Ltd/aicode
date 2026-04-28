/**
 * Build Ultra — `log-usage` Edge Function
 *
 * Records token usage from Workstation (private compute) chats so SaaS quotas stay unified.
 * Client: POST `{ "total_tokens": number }` + `Authorization: Bearer <user_jwt>` + `apikey: <anon>`.
 * Response: `{ "remaining_tokens": number }` or 402 when quota already exhausted.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
    return jsonResponse({ error: "Server misconfiguration" }, 500);
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

  let body: { total_tokens?: unknown };
  try {
    body = (await req.json()) as { total_tokens?: unknown };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const raw = body.total_tokens;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) {
    return jsonResponse(
      { error: "total_tokens must be a finite number >= 1" },
      400,
    );
  }
  const deductTokens = Math.max(1, Math.floor(raw));

  const dbClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });

  const { data: quotaRow, error: quotaError } = await dbClient
    .from("user_quotas")
    .select("tokens_used, total_quota")
    .eq("id", user.id)
    .maybeSingle();
  if (quotaError) {
    return jsonResponse(
      { error: `Failed to read user quota: ${quotaError.message}` },
      500,
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

  const newTokensUsed = Math.min(totalQuota, tokensUsed + deductTokens);
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
    return jsonResponse(
      { error: `Quota update failed: ${deductError.message}` },
      500,
    );
  }
  const tu =
    typeof updatedQuota?.tokens_used === "number"
      ? updatedQuota.tokens_used
      : 0;
  const tq =
    typeof updatedQuota?.total_quota === "number"
      ? updatedQuota.total_quota
      : 0;
  const remaining_tokens = Math.max(0, tq - tu);
  return jsonResponse({ remaining_tokens }, 200);
}

Deno.serve(handler);
