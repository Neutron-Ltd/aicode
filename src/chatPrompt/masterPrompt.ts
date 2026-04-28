/**
 * Offline / DB-failure fallback — must stay aligned with
 * `fetchMasterSystemPrompt` in `supabase/functions/chat/index.ts`.
 */
export const MASTER_SYSTEM_PROMPT_FALLBACK =
  "You are Ultra AI, a coding assistant for Build Ultra in VS Code.";
