/**
 * Stripe webhook — verifies `checkout.session.completed` and updates `user_quotas`.
 *
 * Secrets: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: STRIPE_SECRET_KEY (only if Stripe client needs a real key; webhook verify uses webhook secret).
 *
 * Checkout sessions should set `metadata.supabase_user_id` to the auth user UUID (or use `client_reference_id`).
 * Optional metadata: `tier`, `total_quota` (integer string), `entitlements` (JSON string).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, stripe-signature",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUserId(session: Stripe.Checkout.Session): string | null {
  const meta = session.metadata?.supabase_user_id?.trim();
  if (meta && UUID_RE.test(meta)) return meta;
  const ref = session.client_reference_id?.trim();
  if (ref && UUID_RE.test(ref)) return ref;
  return null;
}

function buildEntitlements(
  session: Stripe.Checkout.Session,
): Record<string, unknown> {
  const raw = session.metadata?.entitlements?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {
    stripe_checkout: true,
    checkout_session_id: session.id,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY")?.trim() ?? "";

  if (!webhookSecret || !supabaseUrl || !serviceKey) {
    return jsonResponse(
      {
        error:
          "Missing STRIPE_WEBHOOK_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY.",
      },
      503,
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return jsonResponse({ error: "Missing Stripe-Signature header." }, 400);
  }

  const rawBody = await req.text();

  const stripe = new Stripe(stripeSecret || "sk_test_placeholder", {
    apiVersion: "2024-06-20",
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: `Webhook signature verification failed: ${msg}` }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return jsonResponse({ received: true, ignored: event.type }, 200);
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const userId = parseUserId(session);
  if (!userId) {
    console.warn(
      "stripe-webhook: checkout.session.completed missing supabase_user_id / client_reference_id (uuid).",
    );
    return jsonResponse(
      {
        error:
          "Session must include metadata.supabase_user_id or client_reference_id as user UUID.",
      },
      400,
    );
  }

  const tier = session.metadata?.tier?.trim() || "pro";
  const totalQuotaRaw = session.metadata?.total_quota?.trim();
  const totalQuota = totalQuotaRaw
    ? Math.max(0, parseInt(totalQuotaRaw, 10) || 0)
    : tier === "pro"
    ? 500_000
    : 150_000;

  const entitlements = buildEntitlements(session);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: existing, error: selErr } = await admin
    .from("user_quotas")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (selErr) {
    return jsonResponse({ error: selErr.message }, 500);
  }

  if (existing) {
    const { error: upErr } = await admin
      .from("user_quotas")
      .update({
        tier,
        total_quota: totalQuota,
        entitlements,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (upErr) {
      return jsonResponse({ error: upErr.message }, 500);
    }
  } else {
    const { error: insErr } = await admin.from("user_quotas").insert({
      id: userId,
      tokens_used: 0,
      total_quota: totalQuota,
      tier,
      entitlements,
    });
    if (insErr) {
      return jsonResponse({ error: insErr.message }, 500);
    }
  }

  return jsonResponse({ ok: true, user_id: userId, tier }, 200);
});
