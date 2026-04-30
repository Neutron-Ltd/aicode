import * as vscode from "vscode";
import type { ChatPayload } from "../types/chatPayload";
import type { EditorService } from "./EditorService";
import { formatDiagnosticsSummary } from "./postEditDiagnostics";
import type { TerminalService } from "./TerminalService";

/** Matches Edge `buildContextUserMessage` — RAG omitted on tool follow-ups. */
const RAG_OMITTED_NOTE =
  "(Indexed codebase omitted on tool follow-up; refer to the first request context.)";

/**
 * `.ultrarules` and chat payload envelope: strict separation of rules, context, and user query.
 */
export class PromptBuilderService {
  constructor(
    private readonly editor: EditorService,
    private readonly terminal: TerminalService
  ) {}

  /**
   * Reads `.ultrarules` from the first workspace folder root.
   */
  async loadWorkspaceRules(): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return "";
    }

    const rulesUri = vscode.Uri.joinPath(folder.uri, ".ultrarules");
    try {
      const data = await vscode.workspace.fs.readFile(rulesUri);
      return new TextDecoder("utf-8").decode(data);
    } catch {
      return "";
    }
  }

  /**
   * Problems / diagnostics for the active editor file (compact text for the Edge prompt).
   */
  async getDiagnosticsSummaryForActiveFile(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return "";
    }
    return formatDiagnosticsSummary(editor.document.uri, { maxItems: 40 });
  }

  /**
   * Builds the structured payload for a chat request (used by ApiService).
   */
  async buildChatPayload(query: string, modelId: string): Promise<ChatPayload> {
    const workspaceRules = await this.loadWorkspaceRules();
    const diagnosticsSummary = await this.getDiagnosticsSummaryForActiveFile();
    const terminalContext = this.terminal.getRecentTerminalContext();
    const fileCtx = this.editor.getActiveFileContextForPrompt();
    const fullFileText =
      fileCtx.excerptNote && fileCtx.excerptNote.length > 0
        ? `${fileCtx.excerptNote}\n\n${fileCtx.text}`
        : fileCtx.text;

    const payload: ChatPayload = {
      query,
      modelId,
      workspaceRules,
      diagnosticsSummary,
      terminalContext,
      editorContext: {
        fileName: this.editor.getActiveFileName(),
        fullFileText,
        selectedText: this.editor.getSelectedText(),
      },
    };

    return payload;
  }

  /**
   * Structured context block for `conversationOverride` (must stay aligned with Edge `buildContextUserMessage`).
   */
  buildToolFollowupContextBundle(payload: ChatPayload): string {
    const { workspaceRules, editorContext, terminalContext, diagnosticsSummary } = payload;
    const { fileName, fullFileText, selectedText } = editorContext;
    const rulesBlock = (workspaceRules ?? "").trim()
      ? `## Workspace rules (.ultrarules)\n${workspaceRules.trim()}`
      : "(No workspace rules file.)";
    const diag = (diagnosticsSummary ?? "").trim()
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
      fullFileText ?? "",
      "```",
      "",
      "## Indexed codebase (RAG)",
      RAG_OMITTED_NOTE,
      "",
      "## Terminal",
      terminalContext?.combinedText?.trim()
        ? terminalContext.combinedText
        : "(no terminal output)",
    ].join("\n");
  }

  /** Refreshes editor/diagnostics/rules for follow-up rounds. */
  async refreshPayloadForToolRound(modelId: string, query: string): Promise<ChatPayload> {
    return this.buildChatPayload(query, modelId);
  }
}
