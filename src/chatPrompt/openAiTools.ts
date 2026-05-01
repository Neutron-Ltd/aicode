/** OpenAI-compatible tool definitions (ultra of supabase/functions/chat OPENAI_TOOLS). */
export const OPENAI_TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read UTF-8 text from a workspace file. Before editing an existing file, call with line_numbers true so you get stable 1-based line anchors for within_lines on search_replace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          line_numbers: {
            type: "boolean",
            description:
              "If true, prefix each line as N|... (omit the prefix when building old_string). Strongly recommended before any edit.",
          },
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
        "Replace a contiguous line range in an existing file. You must pass range (1-based inclusive lines). Align startLine/endLine with a fresh read_file (line_numbers true); re-read after any prior edit. For a whole-file rewrite use startLine 1 and endLine equal to line count. Prefer search_replace for small edits. Brand-new paths: create_file.",
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
        "Replace exact text in an existing file. Copy old_string from file text only—not from numbered read_file prefixes. Use within_lines when the same substring could appear elsewhere. Prefer single-line edits for single-property changes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from workspace root" },
          old_string: {
            type: "string",
            description:
              "Exact substring to replace (non-empty). Must match the file text exactly—including indentation and line breaks—never include read_file line number prefixes.",
          },
          new_string: {
            type: "string",
            description: "Replacement text (may be empty to delete old_string).",
          },
          replace_all: {
            type: "boolean",
            description:
              "If true, replace every occurrence of old_string. If false (default), old_string must occur exactly once unless you pass around_line.",
          },
          within_lines: {
            type: "object",
            properties: {
              start_line: { type: "integer", description: "1-based inclusive (from numbered read_file)" },
              end_line: { type: "integer", description: "1-based inclusive boundary for the enclosing block" },
            },
            description:
              "Optional. Limits matches to occurrences fully contained inside this line span. Use numbers from read_file with line_numbers true.",
            required: ["start_line", "end_line"],
          },
          around_line: {
            type: "integer",
            description:
              "Optional 1-based line number. When multiple matches remain (after within_lines filter) and replace_all is false, the occurrence nearest this line wins.",
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
