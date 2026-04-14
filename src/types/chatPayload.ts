/**
 * JSON envelope for Edge Function / AI requests (Chunk 5 structure, Chunk 6 transport).
 */
export interface EditorContextPayload {
  /** Basename or display name of the active file */
  fileName: string | null;
  /** Full text of the active document */
  fullFileText: string;
  /** Currently selected / highlighted text */
  selectedText: string;
}

export interface ChatPayload {
  query: string;
  modelId: string;
  /** Raw `.ultrarules` text (workspace-specific). */
  workspaceRules: string;
  /** Formatted diagnostics for the active file (Problems panel). */
  diagnosticsSummary: string;
  terminalContext?: {
    /** Most recent terminal lines across active terminals. */
    recentLines: string[];
    /** Flattened terminal excerpt used by edge prompt assembly. */
    combinedText: string;
  };
  editorContext: EditorContextPayload;
  /**
   * When set (tool follow-up), Edge uses these OpenAI-style messages instead of
   * assembling from `query` / editor fields. Must include full conversation + tool results.
   */
  conversationOverride?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    name?: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
}
