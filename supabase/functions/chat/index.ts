/**
 * Edge Function: `chat`
 *
 * Deploy: `supabase functions deploy chat`
 *
 * **Auth:** `Authorization: Bearer <user_jwt>` (verified via Supabase Auth).
 * **Client also sends:** `apikey: <anon key>` (Supabase convention).
 *
 * **Request body:** JSON matching `ChatPayload` (see extension `src/types/chatPayload.ts`):
 * `{ query, modelId, workspaceRules, editorContext }`.
 *
 * **Response:** `Content-Type: text/event-stream` (SSE). Each line:
 * `data: {"delta":"chunk"}\n\n`
 * Terminal: `data: [DONE]\n\n`
 * Error in-stream: `data: {"error":"message"}\n\n`
 *
 * **Secrets:** Put 302.ai or other upstream keys in Supabase Function secrets / env only —
 * never in the VS Code extension.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const jwt = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(jwt);
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Consume body (ChatPayload) — stub ignores; real impl would forward to 302.ai etc.
  try {
    await req.text();
  } catch {
    // ignore
  }

  const upstreamKey = Deno.env.get("AI_UPSTREAM_KEY");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      if (upstreamKey) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              delta:
                "[stub] AI_UPSTREAM_KEY is set — replace this block with a real 302.ai call.",
            })}\n\n`
          )
        );
      } else {
        const parts = ["Hello", " from", " Edge", " (mock stream)"];
        for (const p of parts) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta: p })}\n\n`)
          );
          await new Promise((r) => setTimeout(r, 40));
        }
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
