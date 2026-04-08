/**
 * JSON envelope for Edge Function / AI requests (Chunk 5 structure, Chunk 6 transport).
 */
export interface ChatPayload {
  query: string;
  modelId: string;
  workspaceRules: string;
  editorContext: {
    /** Basename or display name of the active file */
    fileName: string | null;
    /** Full text of the active document */
    fullFileText: string;
    /** Currently selected / highlighted text */
    selectedText: string;
  };
}
