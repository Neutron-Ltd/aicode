import type { ChatPayload } from "../types/chatPayload";
import type { OpenAIChatMessage } from "./sanitizeMessages";

/** Align with supabase/functions/chat/index.ts */
const MAX_EDITOR_FILE_CHARS = 120_000;
/** Budget for RAG + active file excerpt + `.ultrarules` only (diagnostics & terminal not pruned here). */
const MAX_CONTEXT_CHARS = 100_000;

/** Rough token estimate for logging (optional). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Prune lowest-priority context first: RAG, then active file text, then workspace rules.
 * Diagnostics and terminal are built outside this budget.
 */
function truncateRagFileRules(
  codebaseContext: string,
  fileBody: string,
  workspaceRules: string,
  maxChars: number
): { rag: string; file: string; rules: string } {
  let rag = codebaseContext.trim();
  let file = fileBody;
  let rules = workspaceRules.trim();
  let total = rag.length + file.length + rules.length;
  if (total <= maxChars) {
    return { rag, file, rules };
  }

  let over = total - maxChars;
  if (rag.length >= over) {
    rag =
      rag.slice(0, Math.max(0, rag.length - over)) +
      "\n\n[… RAG context truncated for token budget …]";
    return { rag, file, rules };
  }
  over -= rag.length;
  rag =
    rag.slice(0, Math.max(0, rag.length - Math.floor(rag.length * 0.5))) +
    "\n\n[… RAG truncated …]";
  total = rag.length + file.length + rules.length;
  if (total <= maxChars) {
    return { rag, file, rules };
  }
  over = total - maxChars;

  if (file.length >= over) {
    file =
      file.slice(0, Math.max(0, file.length - over)) +
      "\n\n[… active file truncated for token budget …]";
    return { rag, file, rules };
  }
  over -= file.length;
  file =
    file.slice(0, Math.max(0, file.length - Math.floor(file.length * 0.5))) +
    "\n\n[… active file truncated …]";
  total = rag.length + file.length + rules.length;
  if (total <= maxChars) {
    return { rag, file, rules };
  }
  over = total - maxChars;

  if (rules.length >= over) {
    rules =
      rules.slice(0, Math.max(0, rules.length - over)) +
      "\n\n[… rules truncated …]";
    return { rag, file, rules };
  }
  rules =
    rules.slice(0, Math.max(0, rules.length - Math.max(over, 0))) +
    "\n\n[… rules truncated …]";
  return { rag, file, rules };
}

export function buildContextUserMessage(
  payload: ChatPayload,
  rag: string,
  fileBody: string
): string {
  const { workspaceRules, editorContext, terminalContext, diagnosticsSummary } =
    payload;
  const { fileName, selectedText } = editorContext;
  const rulesBlock =
    (workspaceRules ?? "").trim().length > 0
      ? `## Workspace rules (.ultrarules)\n${workspaceRules.trim()}`
      : "(No workspace rules file.)";
  const diag =
    (diagnosticsSummary ?? "").trim().length > 0
      ? `## Diagnostics (active file)\n${diagnosticsSummary.trim()}`
      : "(No diagnostics for the active file.)";
  return [
    "## Context bundle (not the user question)",
    "",
    diag,
    "",
    rulesBlock,
    "",
    "## Editor",
    `- Active file: ${fileName ?? "(none)"}`,
    "### Selection",
    selectedText?.trim() ? selectedText : "(empty)",
    "",
    "### Active file text",
    "```text",
    fileBody,
    "```",
    "",
    "## Indexed codebase (RAG)",
    rag.trim() ? rag : "(no relevant chunks)",
    "",
    "## Terminal",
    terminalContext?.combinedText?.trim()
      ? terminalContext.combinedText
      : "(no terminal output)",
  ].join("\n");
}

/**
 * @param codebaseContext — Empty in Workstation mode (no Edge RAG).
 */
export function assembleChatMessages(
  masterSystem: string,
  payload: ChatPayload,
  codebaseContext: string
): OpenAIChatMessage[] {
  if (payload.conversationOverride?.length) {
    return [
      { role: "system", content: masterSystem },
      ...payload.conversationOverride.map((m) => {
        const o: OpenAIChatMessage = { role: m.role };
        if (m.role === "tool") {
          o.content = typeof m.content === "string" && m.content.length ? m.content : " ";
          if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
          if (m.name) o.name = m.name;
          return o;
        }
        if (m.tool_calls) {
          o.tool_calls = m.tool_calls;
          if (m.content === null || m.content === undefined) {
            o.content = null;
          } else {
            o.content = m.content;
          }
        } else {
          o.content = m.content ?? "";
        }
        if (m.name) o.name = m.name;
        return o;
      }),
    ];
  }

  let fileBody = payload.editorContext.fullFileText ?? "";
  if (fileBody.length > MAX_EDITOR_FILE_CHARS) {
    fileBody =
      fileBody.slice(0, MAX_EDITOR_FILE_CHARS) + "\n\n[... file truncated ...]";
  }
  const rulesRaw = (payload.workspaceRules ?? "").trim();
  const { rag, file, rules } = truncateRagFileRules(
    codebaseContext,
    fileBody,
    rulesRaw,
    MAX_CONTEXT_CHARS
  );
  const contextPack = buildContextUserMessage(
    {
      ...payload,
      workspaceRules: rules,
      editorContext: { ...payload.editorContext, fullFileText: file },
    },
    rag,
    file
  );

  return [
    { role: "system", content: masterSystem },
    { role: "user", content: contextPack },
    { role: "user", content: payload.query.trim() },
  ];
}
