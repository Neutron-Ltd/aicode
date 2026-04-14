/**
 * Stripe webhook — syncs tiers, token allowances, and refill scheduling with `user_quotas`.
 *
 * Secrets: STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: STRIPE_SECRET_KEY (retrieve Subscription period end for `next_token_refill_at`).
 *
 * Events:
 * - `checkout.session.completed` — upgrade path: reset `tokens_used`, set `total_quota` / `tier`, idempotent per session id.
 * - `customer.subscription.updated` — monthly boundary: reset `tokens_used` to 0, refresh `next_token_refill_at`.
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

/** Monthly token allowance caps per product tier. */
const TIER_QUOTAS: Record<"free" | "pro" | "ultra", number> = {
  free: 150_000,
  pro: 500_000,
  ultra: 2_000_000,
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTier(raw: string | undefined): "free" | "pro" | "ultra" {
  const t = raw?.trim().toLowerCase() ?? "";
  if (t === "ultra" || t === "enterprise") return "ultra";
  if (t === "pro" || t === "professional") return "pro";
  if (t === "free") return "free";
  return "pro";
}

function parseUserIdFromSession(session: Stripe.Checkout.Session): string | null {
  const meta = session.metadata?.supabase_user_id?.trim();
  if (meta && UUID_RE.test(meta)) return meta;
  const ref = session.client_reference_id?.trim();
  if (ref && UUID_RE.test(ref)) return ref;
  return null;
}

function parseUserIdFromSubscription(sub: Stripe.Subscription): string | null {
  const meta = sub.metadata?.supabase_user_id?.trim();
  if (meta && UUID_RE.test(meta)) return meta;
  return null;
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

  const admin = createClient(supabaseUrl, serviceKey);

  if (event.type === "checkout.session.completed") {
    return await handleCheckoutCompleted(
      stripe,
      admin,
      event.data.object as Stripe.Checkout.Session,
      stripeSecret.length > 0,
    );
  }

  if (event.type === "customer.subscription.updated") {
    return await handleSubscriptionUpdated(
      admin,
      event.data.object as Stripe.Subscription,
    );
  }

  return jsonResponse({ received: true, ignored: event.type }, 200);
});

async function handleCheckoutCompleted(
  stripe: Stripe,
  admin: ReturnType<typeof createClient>,
  session: Stripe.Checkout.Session,
  canRetrieveSubscription: boolean,
): Promise<Response> {
  const userId = parseUserIdFromSession(session);
  if (!userId) {
    return jsonResponse(
      {
        error:
          "Session must include metadata.supabase_user_id or client_reference_id as user UUID.",
      },
      400,
    );
  }

  const tier = normalizeTier(session.metadata?.tier);
  const customQuota = session.metadata?.total_quota?.trim();
  const totalQuota = customQuota
    ? Math.max(0, parseInt(customQuota, 10) || 0)
    : TIER_QUOTAS[tier];

  let nextRefill: string | null = null;
  const subRef = session.subscription;
  const subId = typeof subRef === "string" ? subRef : subRef?.id;
  if (subId && canRetrieveSubscription) {
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      nextRefill = new Date(sub.current_period_end * 1000).toISOString();
    } catch (e) {
      console.warn("stripe subscription retrieve failed:", e);
    }
  }

  const { data: row } = await admin
    .from("user_quotas")
    .select("entitlements")
    .eq("id", userId)
    .maybeSingle();

  const prevEnt = (row?.entitlements ?? {}) as Record<string, unknown>;
  if (prevEnt["last_checkout_session_id"] === session.id) {
    return jsonResponse({ ok: true, duplicate: true, user_id: userId }, 200);
  }

  const entitlements: Record<string, unknown> = {
    ...prevEnt,
    stripe_checkout: true,
    checkout_session_id: session.id,
    last_checkout_session_id: session.id,
    subscription_id: subId ?? null,
  };

  const patch = {
    tier,
    total_quota: totalQuota,
    tokens_used: 0,
    entitlements,
    next_token_refill_at: nextRefill,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from("user_quotas")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin.from("user_quotas").update(patch).eq("id", userId);
    if (error) return jsonResponse({ error: error.message }, 500);
  } else {
    const { error } = await admin.from("user_quotas").insert({
      id: userId,
      ...patch,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse(
    { ok: true, user_id: userId, tier, total_quota: totalQuota },
    200,
  );
}

async function handleSubscriptionUpdated(
  admin: ReturnType<typeof createClient>,
  sub: Stripe.Subscription,
): Promise<Response> {
  const userId = parseUserIdFromSubscription(sub);
  if (!userId) {
    return jsonResponse({ received: true, ignored: "no supabase_user_id on subscription" }, 200);
  }

  const nextRefill = new Date(sub.current_period_end * 1000).toISOString();

  const { data: row, error: selErr } = await admin
    .from("user_quotas")
    .select("entitlements")
    .eq("id", userId)
    .maybeSingle();

  if (selErr) {
    return jsonResponse({ error: selErr.message }, 500);
  }
  if (!row) {
    return jsonResponse({ received: true, ignored: "no user_quotas row" }, 200);
  }

  const prev = (row.entitlements ?? {}) as Record<string, unknown>;
  const entitlements = {
    ...prev,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: nextRefill,
  };

  const { error } = await admin
    .from("user_quotas")
    .update({
      tokens_used: 0,
      next_token_refill_at: nextRefill,
      updated_at: new Date().toISOString(),
      entitlements,
    })
    .eq("id", userId);

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ ok: true, user_id: userId, refill: true }, 200);
}
