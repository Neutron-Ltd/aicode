/**
 * Build Ultra — return account-linked workstation fields for the authenticated user.
 * GET + Authorization: Bearer <user_jwt> + apikey: <anon> (same pattern as log-usage).
 *
 * Response: { computeHost, defaultModel, apiKey } — nulls when unset.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  if (req.method !== "GET") {
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

  const dbClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });

  const { data, error } = await dbClient
    .from("user_private_compute")
    .select("compute_host, default_model, compute_api_key")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  const row = data as {
    compute_host?: string | null;
    default_model?: string | null;
    compute_api_key?: string | null;
  } | null;

  const host = typeof row?.compute_host === "string" ? row.compute_host.trim() : "";
  const model = typeof row?.default_model === "string" ? row.default_model.trim() : "";
  const apiKey =
    typeof row?.compute_api_key === "string" ? row.compute_api_key.trim() : "";

  return jsonResponse(
    {
      computeHost: host.length > 0 ? host : null,
      defaultModel: model.length > 0 ? model : null,
      apiKey: apiKey.length > 0 ? apiKey : null,
    },
    200,
  );
}

Deno.serve(handler);
