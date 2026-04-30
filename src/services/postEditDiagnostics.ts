import * as vscode from "vscode";

const DEFAULT_MAX_LINES = 40;
const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_SETTLE_MS = 400;
const DEFAULT_TIMEOUT_MS = 2500;

export type FormatDiagnosticsOptions = {
  maxItems?: number;
  errorsAndWarningsOnly?: boolean;
};

/**
 * Compact diagnostics lines for tool results / prompts ([error|warning|info] line:col message).
 */
export function formatDiagnosticsSummary(
  uri: vscode.Uri,
  options: FormatDiagnosticsOptions = {}
): string {
  const maxItems = options.maxItems ?? DEFAULT_MAX_LINES;
  const errorsOnly = options.errorsAndWarningsOnly ?? false;
  const diags = vscode.languages.getDiagnostics(uri);
  const filtered = errorsOnly
    ? diags.filter(
        (d) =>
          d.severity === vscode.DiagnosticSeverity.Error ||
          d.severity === vscode.DiagnosticSeverity.Warning
      )
    : diags;
  if (filtered.length === 0) {
    return "";
  }
  const lines: string[] = [];
  for (const d of filtered.slice(0, maxItems)) {
    const start = d.range.start;
    const loc = `${start.line + 1}:${start.character + 1}`;
    const sev =
      d.severity === vscode.DiagnosticSeverity.Error
        ? "error"
        : d.severity === vscode.DiagnosticSeverity.Warning
          ? "warning"
          : "info";
    lines.push(`- [${sev}] ${loc} ${d.message.replace(/\s+/g, " ").trim()}`);
  }
  if (filtered.length > maxItems) {
    lines.push(`- … and ${filtered.length - maxItems} more diagnostic(s).`);
  }
  return lines.join("\n");
}

export type WaitDiagnosticsOptions = {
  timeoutMs?: number;
  debounceMs?: number;
  settleMs?: number;
};

/**
 * Wait for language services to report diagnostics after a document change.
 * Resolves when diagnostics are quiet for `settleMs` or after `timeoutMs`.
 */
export function waitForPostEditDiagnostics(
  uri: vscode.Uri,
  options: WaitDiagnosticsOptions = {}
): Promise<vscode.Diagnostic[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

  return new Promise((resolve) => {
    const uriStr = uri.toString();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      sub.dispose();
      clearTimeout(hardCap);
      resolve(vscode.languages.getDiagnostics(uri));
    };

    const scheduleSettle = () => {
      if (settleTimer !== undefined) clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, settleMs);
    };

    const onActivity = () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scheduleSettle, debounceMs);
    };

    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (e.uris.some((u) => u.toString() === uriStr)) {
        onActivity();
      }
    });

    const hardCap = setTimeout(finish, timeoutMs);
    onActivity();
  });
}

/**
 * VS Code problems summary for tool output; omit section when there are no error/warning diagnostics.
 */
export async function appendProblemsSectionToMessage(
  uri: vscode.Uri,
  relativePath: string,
  baseMessage: string
): Promise<string> {
  await waitForPostEditDiagnostics(uri);
  const body = formatDiagnosticsSummary(uri, { errorsAndWarningsOnly: true });
  if (!body) {
    return baseMessage;
  }
  return `${baseMessage}\n\n## Problems (${relativePath})\n${body}`;
}
