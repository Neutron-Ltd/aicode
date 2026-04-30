/** OpenAI-compatible tool definitions (ultra of supabase/functions/chat OPENAI_TOOLS). */
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
      name: "search_replace",
      description:
        "Replace exact text in an existing file. Prefer this for small or copy-pastable edits: copy old_string verbatim from the latest read_file (unique match, or set replace_all). Use write_file when you have fresh 1-based line ranges for a whole block. For new paths use create_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          old_string: {
            type: "string",
            description:
              "Exact substring to replace (non-empty). Must match the file text exactly—including indentation and line breaks as returned by read_file.",
          },
          new_string: {
            type: "string",
            description: "Replacement text (may be empty to delete old_string).",
          },
          replace_all: {
            type: "boolean",
            description:
              "If true, replace every occurrence of old_string. If false (default), old_string must occur exactly once.",
          },
        },
        required: ["path", "old_string", "new_string"],
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
