/** OpenAI-compatible tool definitions (mirror of supabase/functions/chat OPENAI_TOOLS). */
export const OPENAI_TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read UTF-8 text from a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Replace a contiguous line range in an existing file. You must pass range (1-based inclusive lines). For a whole-file rewrite use startLine 1 and endLine equal to the file's line count (read_file first). For brand-new paths use create_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          range: {
            type: "object",
            properties: {
              startLine: { type: "integer", description: "1-based inclusive" },
              endLine: { type: "integer", description: "1-based inclusive" },
            },
            required: ["startLine", "endLine"],
          },
        },
        required: ["path", "content", "range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List non-hidden entries in a directory under the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path" },
        },
        required: ["path"],
      },
    },
  },
];
