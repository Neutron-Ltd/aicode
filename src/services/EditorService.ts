import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Active editor, selection, and insert-at-cursor (Chunk 5).
 */
export class EditorService {
  getActiveTextEditor(): vscode.TextEditor | undefined {
    return vscode.window.activeTextEditor;
  }

  /** Full document text of the active editor, or empty string if none. */
  getActiveDocumentText(): string {
    const editor = this.getActiveTextEditor();
    if (!editor) return "";
    return editor.document.getText();
  }

  /** Basename of the active file, or `null` if no active editor. */
  getActiveFileName(): string | null {
    const editor = this.getActiveTextEditor();
    if (!editor) return null;
    return path.basename(editor.document.uri.fsPath);
  }

  /** Primary selection text (highlighted), or empty string if none/collapsed. */
  getSelectedText(): string {
    const editor = this.getActiveTextEditor();
    if (!editor) return "";
    return editor.document.getText(editor.selection);
  }

  /**
   * Applies code from chat: replaces the primary selection when non-empty, otherwise
   * inserts at the cursor. Single undo step. Returns false if there is no active editor.
   */
  async applyCodeFromChat(code: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }

    const { selection } = editor;

    return editor.edit((editBuilder) => {
      if (!selection.isEmpty) {
        editBuilder.replace(selection, code);
      } else {
        editBuilder.insert(selection.active, code);
      }
    });
  }

  /**
   * @deprecated Prefer {@link applyCodeFromChat} for chat-driven inserts.
   */
  async insertCodeAtCursor(code: string): Promise<boolean> {
    return this.applyCodeFromChat(code);
  }
}
