import * as vscode from "vscode";

/**
 * Placeholder for terminal output context. Terminal capture via
 * `onDidWriteTerminalData` is a proposed API and cannot ship on the public
 * Marketplace; this stub keeps {@link PromptBuilderService} and payloads stable.
 */
export class TerminalService implements vscode.Disposable {
  getRecentTerminalContext(): { recentLines: string[]; combinedText: string } {
    return { recentLines: [], combinedText: "" };
  }

  dispose(): void {}
}
