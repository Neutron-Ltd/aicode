import * as vscode from "vscode";

/**
 * In-memory documents for `vscode.diff` right-hand side (and empty left for new files).
 */
export class BuildUltraPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly content = new Map<string, string>();

  setDocument(uri: vscode.Uri, text: string): void {
    this.content.set(uri.toString(), text);
  }

  deleteDocument(uri: vscode.Uri): void {
    this.content.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? "";
  }

  previewUri(segment: string): vscode.Uri {
    return vscode.Uri.parse(`buildultra-preview:/${encodeURIComponent(segment)}`);
  }
}
