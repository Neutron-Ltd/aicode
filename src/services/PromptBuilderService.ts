import * as vscode from "vscode";
import type { ChatPayload } from "../types/chatPayload";
import type { EditorService } from "./EditorService";
import type { TerminalService } from "./TerminalService";

/**
 * .mirrorrules and chat payload envelope (Chunk 5).
 */
export class PromptBuilderService {
  constructor(
    private readonly editor: EditorService,
    private readonly terminal: TerminalService
  ) {}

  /**
   * Reads `.mirrorrules` from the first workspace folder root, if present.
   */
  async loadWorkspaceRules(): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return "";
    }

    const rulesUri = vscode.Uri.joinPath(folder.uri, ".mirrorrules");
    try {
      const data = await vscode.workspace.fs.readFile(rulesUri);
      return new TextDecoder("utf-8").decode(data);
    } catch {
      return "";
    }
  }

  /**
   * Builds the structured payload for a chat request (used by ApiService in Chunk 6).
   */
  async buildChatPayload(query: string, modelId: string): Promise<ChatPayload> {
    const workspaceRules = await this.loadWorkspaceRules();

    // TODO: Inject RAG vector context here.

    const terminalContext = this.terminal.getRecentTerminalContext();

    const payload: ChatPayload = {
      query,
      modelId,
      workspaceRules,
      terminalContext,
      editorContext: {
        fileName: this.editor.getActiveFileName(),
        fullFileText: this.editor.getActiveDocumentText(),
        selectedText: this.editor.getSelectedText(),
      },
    };

    return payload;
  }
}
