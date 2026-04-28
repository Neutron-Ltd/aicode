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
   * Full document text for small files; for larger files, a line window around the caret.
   */
  getActiveFileContextForPrompt(): { text: string; excerptNote?: string } {
    const editor = this.getActiveTextEditor();
    if (!editor) {
      return { text: "" };
    }
    const doc = editor.document;
    const lineCount = doc.lineCount;
    const maxLinesFull = 220;
    const radius = 60;
    if (lineCount <= maxLinesFull) {
      return { text: doc.getText() };
    }
    const anchor = editor.selection.active.line;
    const start = Math.max(0, anchor - radius);
    const end = Math.min(lineCount - 1, anchor + radius);
    const lines: string[] = [];
    for (let i = start; i <= end; i++) {
      lines.push(doc.lineAt(i).text);
    }
    return {
      text: lines.join("\n"),
      excerptNote: `Lines ${start + 1}-${end + 1} of ${lineCount} (neighborhood around cursor).`,
    };
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

    const { selection, document } = editor;
    const edit = new vscode.WorkspaceEdit();
    if (!selection.isEmpty) {
      edit.replace(document.uri, selection, code);
    } else {
      edit.insert(document.uri, selection.active, code);
    }
    return vscode.workspace.applyEdit(edit);
  }

  /**
   * @deprecated Prefer {@link applyCodeFromChat} for chat-driven inserts.
   */
  async insertCodeAtCursor(code: string): Promise<boolean> {
    return this.applyCodeFromChat(code);
  }
}
