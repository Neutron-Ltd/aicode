import * as vscode from "vscode";
import type { BuildUltraPreviewProvider } from "./virtualDocumentProvider";

function previewTextAfterWrite(
  current: string,
  content: string,
  rangeSpec: { startLine?: number; endLine?: number } | undefined
): string {
  if (
    !rangeSpec ||
    typeof rangeSpec.startLine !== "number" ||
    typeof rangeSpec.endLine !== "number"
  ) {
    return content;
  }
  const lines = current.split(/\r?\n/);
  const start = Math.max(0, rangeSpec.startLine - 1);
  const end = Math.max(start, rangeSpec.endLine - 1);
  const newLines = content.split(/\r?\n/);
  const out = [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)];
  return out.join("\n");
}

/**
 * Opens side-by-side diff (current vs proposed) and asks whether to apply the edit.
 */
export async function openMutationDiffAndConfirm(params: {
  provider: BuildUltraPreviewProvider;
  title: string;
  /** Workspace-relative path for display */
  relPath: string;
  /** Current file text (empty if file does not exist yet). */
  currentText: string;
  proposedText: string;
  range?: { startLine?: number; endLine?: number };
}): Promise<boolean> {
  const { provider, title, relPath, currentText, proposedText, range } = params;
  const previewMerged = previewTextAfterWrite(currentText, proposedText, range);

  const leftKey = `left/${Date.now()}/${Math.random().toString(36).slice(2)}`;
  const rightKey = `right/${Date.now()}/${Math.random().toString(36).slice(2)}`;
  const leftUri = provider.previewUri(leftKey);
  const rightUri = provider.previewUri(rightKey);
  provider.setDocument(leftUri, currentText);
  provider.setDocument(rightUri, previewMerged);

  try {
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${title}: ${relPath}`
    );
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Build Ultra: Could not open diff — ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }

  const choice = await vscode.window.showInformationMessage(
    `Apply this change to "${relPath}" in the workspace?`,
    { modal: true },
    "Apply",
    "Skip"
  );
  return choice === "Apply";
}
