/**
 * Build Ultra — ship-time configuration.
 * Supabase URL and anon key are injected at compile time from `.env` via `scripts/gen-config.mjs`.
 */
export { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.generated";

/** PostHog project API key for the extension host. Empty string disables telemetry. */
export const POSTHOG_API_KEY = "";

/** PostHog ingest host (US cloud default). */
export const POSTHOG_HOST = "https://us.i.posthog.com";
