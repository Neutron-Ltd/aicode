export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

/** Opaque model route sent with chat; upstream resolves via env when empty. */
export const DEFAULT_CHAT_MODEL_ID = "default";
