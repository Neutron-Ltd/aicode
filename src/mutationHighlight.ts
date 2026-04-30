import * as vscode from "vscode";

const changedLineDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
  overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const editorsByUri = new Map<string, vscode.TextEditor>();

/**
 * Show changed-line highlights on the real workspace editor after an AI write.
 */
export async function showChangedRangeHighlight(
  uri: vscode.Uri,
  range: vscode.Range
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    preserveFocus: true,
    preview: false,
  });
  const key = uri.toString();
  editorsByUri.set(key, editor);
  editor.setDecorations(changedLineDecoration, [range]);
}

export function clearHighlight(uri: vscode.Uri): void {
  const key = uri.toString();
  const editor = editorsByUri.get(key);
  if (editor) {
    editor.setDecorations(changedLineDecoration, []);
    editorsByUri.delete(key);
  }
}

export function clearAllMutationHighlights(): void {
  for (const editor of editorsByUri.values()) {
    editor.setDecorations(changedLineDecoration, []);
  }
  editorsByUri.clear();
}

export function disposeMutationHighlightDecorations(): void {
  changedLineDecoration.dispose();
}
