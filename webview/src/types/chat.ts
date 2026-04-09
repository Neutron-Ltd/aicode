export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.4-nano", label: "GPT 5.4 Nano (Default)" },
  { id: "grok-code-fast", label: "Grok Code Fast" },
  { id: "qwen-3.5", label: "Qwen 3.5" },
  { id: "doubao", label: "DuoBao" },
];
