/**
 * Build Ultra — ship-time configuration.
 * Supabase URL and anon key are injected at compile time from `.env` via `scripts/gen-config.mjs`.
 */
export { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.generated";

/** OAuth provider id when using `signInWithOAuth` (e.g. github, google). */
export const ULTRA_OAUTH_PROVIDER = "github";

/** PostHog project API key for the extension host. Empty string disables telemetry. */
export const POSTHOG_API_KEY = "";

/** PostHog ingest host (US cloud default). */
export const POSTHOG_HOST = "https://us.i.posthog.com";
