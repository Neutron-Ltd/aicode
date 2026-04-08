import * as vscode from "vscode";

const DEFAULT_MAX_LINES = 80;
const MAX_LINE_LENGTH = 400;
const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

type TerminalRecord = {
  lines: string[];
  pending: string;
  updatedAt: number;
};

/**
 * Captures a rolling excerpt of terminal output to enrich chat prompts.
 */
export class TerminalService implements vscode.Disposable {
  private readonly records = new Map<string, TerminalRecord>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly maxLines: number = DEFAULT_MAX_LINES) {
    for (const t of vscode.window.terminals) {
      this.records.set(this.keyForTerminal(t), this.newRecord());
    }

    const maybeWrite = (
      vscode.window as unknown as {
        onDidWriteTerminalData?: (
          listener: (e: { terminal: vscode.Terminal; data: string }) => void
        ) => vscode.Disposable;
      }
    ).onDidWriteTerminalData;

    if (maybeWrite) {
      this.disposables.push(
        maybeWrite((e: { terminal: vscode.Terminal; data: string }) => {
          const key = this.keyForTerminal(e.terminal);
          const rec = this.records.get(key) ?? this.newRecord();
          this.records.set(key, rec);
          this.appendChunk(rec, e.data);
        })
      );
    }

    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        this.records.set(this.keyForTerminal(terminal), this.newRecord());
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        this.records.delete(this.keyForTerminal(terminal));
      })
    );
  }

  /**
   * Returns most recent lines across terminals (oldest→newest).
   */
  getRecentTerminalContext(): { recentLines: string[]; combinedText: string } {
    const all = [...this.records.values()]
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .flatMap((r) => r.lines);
    const recentLines = all.slice(-this.maxLines);
    return {
      recentLines,
      combinedText: recentLines.join("\n"),
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.records.clear();
  }

  private newRecord(): TerminalRecord {
    return { lines: [], pending: "", updatedAt: Date.now() };
  }

  private keyForTerminal(t: vscode.Terminal): string {
    return `${t.creationOptions.name ?? t.name}-${t.processId ?? "pid-unknown"}`;
  }

  private appendChunk(rec: TerminalRecord, chunk: string): void {
    if (!chunk) return;
    rec.updatedAt = Date.now();
    const cleaned = chunk.replace(ANSI_ESCAPE_RE, "");
    rec.pending += cleaned;

    const parts = rec.pending.split(/\r?\n/);
    rec.pending = parts.pop() ?? "";

    for (const p of parts) {
      this.pushLine(rec, p);
    }
    if (rec.pending.length > MAX_LINE_LENGTH * 2) {
      this.pushLine(rec, rec.pending);
      rec.pending = "";
    }
  }

  private pushLine(rec: TerminalRecord, raw: string): void {
    const line = raw.replace(/\r/g, "").trim();
    if (!line) return;
    const compact = line.length > MAX_LINE_LENGTH
      ? `${line.slice(0, MAX_LINE_LENGTH)} ...`
      : line;
    rec.lines.push(compact);
    if (rec.lines.length > this.maxLines) {
      rec.lines.splice(0, rec.lines.length - this.maxLines);
    }
  }
}
