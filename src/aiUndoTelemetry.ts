import * as vscode from "vscode";
import { captureTelemetryEvent } from "./telemetry";

const UNDO_WINDOW_MS = 30_000;

/** Pending pre-edit snapshots keyed by document URI (last AI write wins per file). */
const pendingPreEdit = new Map<
  string,
  { textBefore: string; recordedAt: number }
>();

export function recordPreEditSnapshot(uri: vscode.Uri, textBefore: string): void {
  pendingPreEdit.set(uri.toString(), {
    textBefore,
    recordedAt: Date.now(),
  });
}

/**
 * If document text returns to the pre-AI snapshot within UNDO_WINDOW_MS, emit `user_undo_action`.
 * Heuristic: matches full-document undo (or manual restore to identical text).
 */
export function registerAiUndoTelemetry(): vscode.Disposable {
  return vscode.workspace.onDidChangeTextDocument((e) => {
    const key = e.document.uri.toString();
    const rec = pendingPreEdit.get(key);
    if (!rec) {
      return;
    }
    if (Date.now() - rec.recordedAt > UNDO_WINDOW_MS) {
      pendingPreEdit.delete(key);
      return;
    }
    if (e.document.getText() === rec.textBefore) {
      captureTelemetryEvent("user_undo_action", {
        path_kind: e.document.uri.scheme,
      });
      pendingPreEdit.delete(key);
    }
  });
}
