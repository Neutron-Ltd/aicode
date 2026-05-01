import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { recordPreEditSnapshot } from "../aiUndoTelemetry";
import { captureTelemetryEvent } from "../telemetry";
import { isBlockedRelativePath } from "../tooling/toolPathGuards";
import { looksBinary, MAX_TOOL_FILE_BYTES } from "../tooling/looksBinary";
import { AsyncSerialQueue } from "./toolExecutionQueue";
import { appendProblemsSectionToMessage } from "./postEditDiagnostics";
import { formatFileWithLineNumbers } from "../tooling/searchReplaceWithinLines";
import { mergeWriteReplacementWithDocumentIndents } from "../tooling/writeFileIndent";

export type ToolCallWire = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** Result of a tool run; `editReview` triggers post-apply Approve/Undo UI in the host. */
export type ToolExecutionResult = {
  tool_call_id: string;
  content: string;
  name: string;
  aborted?: string;
  editReview?: { relativePath: string; highlightRange: vscode.Range };
  /** After a successful mutating workspace edit — next tools in same round should see this baseline. */
  postApplyVersion?: { relativePath: string; version: number };
};

/**
 * Runs `read_file`, `write_file`, `search_replace`, `create_file`, `list_directory` from chat tool_calls.
 * Enforces workspace scope and blocks `.env` / `.git` paths.
 * All tool executions are serialized (global queue) to avoid overlapping workspace edits.
 */
export class ToolExecutionService {
  private readonly queue = new AsyncSerialQueue();

  constructor(private readonly getWorkspaceRoot: () => vscode.Uri | null) {}

  /** Exposed for diff preview / plan UI (same rules as tool execution). */
  resolveAllowedPath(rel: string): vscode.Uri | null {
    return this.resolvePath(rel);
  }

  private resolvePath(rel: string): vscode.Uri | null {
    const workspaceRoot = this.getWorkspaceRoot();
    if (!workspaceRoot) return null;
    const clean = rel.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (clean === "" || clean === ".") {
      if (isBlockedRelativePath(".")) return null;
      return workspaceRoot;
    }
    if (isBlockedRelativePath(clean)) {
      return null;
    }
    const joined = vscode.Uri.joinPath(
      workspaceRoot,
      ...clean.split("/").filter(Boolean)
    );
    const rootPath = workspaceRoot.path.endsWith("/")
      ? workspaceRoot.path
      : workspaceRoot.path + "/";
    if (!joined.path.startsWith(rootPath) && joined.path !== workspaceRoot.path) {
      return null;
    }
    return joined;
  }

  /**
   * Match leading indentation of the replaced region: strip common leading whitespace
   * from the model snippet, then prefix every non-empty line with the file line's indent.
   */
  private normalizeReplacementIndent(firstLineOfRangeText: string, modelContent: string): string {
    const lead = firstLineOfRangeText.match(/^[\t ]*/);
    const baseIndent = lead ? lead[0] : "";
    const lines = modelContent.split(/\r?\n/);
    if (lines.length === 0) {
      return modelContent;
    }
    let minLead = Infinity;
    for (const line of lines) {
      if (line.length === 0) continue;
      const m = line.match(/^[\t ]*/);
      const n = m ? m[0].length : 0;
      minLead = Math.min(minLead, n);
    }
    if (!Number.isFinite(minLead)) {
      minLead = 0;
    }
    return lines
      .map((line) => {
        if (line.length === 0) {
          return "";
        }
        const body = minLead > 0 && line.length >= minLead ? line.slice(minLead) : line;
        return baseIndent + body;
      })
      .join("\n");
  }

  private parseWriteFileRange(
    rangeUnknown: unknown,
    lineCount: number
  ): { startLineIdx: number; endLineIdx: number } | null {
    if (rangeUnknown === null || rangeUnknown === undefined || typeof rangeUnknown !== "object") {
      return null;
    }
    const r = rangeUnknown as { startLine?: unknown; endLine?: unknown };
    const sl = r.startLine;
    const el = r.endLine;
    if (typeof sl !== "number" || typeof el !== "number") {
      return null;
    }
    if (!Number.isInteger(sl) || !Number.isInteger(el)) {
      return null;
    }
    if (sl < 1 || el < sl || el > lineCount) {
      return null;
    }
    return { startLineIdx: sl - 1, endLineIdx: el - 1 };
  }

  /**
   * Optional `within_lines` / `withinLines` object for search_replace (1-based inclusive).
   */
  private parseWithinLines(
    wl: unknown,
    docLineCount: number
  ): { start_line: number; end_line: number } | undefined {
    if (wl === null || wl === undefined) {
      return undefined;
    }
    if (typeof wl !== "object") {
      return undefined;
    }
    const o = wl as Record<string, unknown>;
    const sl = o.start_line ?? o.startLine;
    const el = o.end_line ?? o.endLine;
    if (typeof sl !== "number" || typeof el !== "number") {
      return undefined;
    }
    if (!Number.isInteger(sl) || !Number.isInteger(el)) {
      return undefined;
    }
    if (sl < 1 || el < sl || sl > docLineCount || el > docLineCount) {
      return undefined;
    }
    return { start_line: sl, end_line: el };
  }

  /** Non-overlapping occurrences of `needle` in `haystack` (forward scan). */
  private findAllOccurrences(haystack: string, needle: string): number[] {
    if (needle.length === 0) {
      return [];
    }
    const out: number[] = [];
    let i = 0;
    while (i <= haystack.length - needle.length) {
      const j = haystack.indexOf(needle, i);
      if (j === -1) break;
      out.push(j);
      i = j + needle.length;
    }
    return out;
  }

  async executeOne(
    call: ToolCallWire,
    /** Expected document version before write (from model); mismatch aborts. */
    expectedVersions: Map<string, number>
  ): Promise<ToolExecutionResult> {
    return this.queue.runExclusive(async () => {
      const result = await this.executeOneUnqueued(call, expectedVersions);
      this.emitToolTelemetry(result);
      return result;
    });
  }

  private emitToolTelemetry(result: {
    name: string;
    content: string;
    aborted?: string;
  }): void {
    const c = result.content;
    const looksFailed =
      c.startsWith("Error:") ||
      c === "Invalid JSON in tool arguments." ||
      c.includes("Path is blocked") ||
      c === "applyEdit failed." ||
      c.startsWith("Unknown tool:");
    const success = !result.aborted && !looksFailed;
    captureTelemetryEvent("tool_execution", {
      tool: result.name,
      success,
      aborted: result.aborted ?? null,
    });
  }

  private async executeOneUnqueued(
    call: ToolCallWire,
    expectedVersions: Map<string, number>
  ): Promise<ToolExecutionResult> {
    const id = call.id;
    const name = call.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return {
        tool_call_id: id,
        name,
        content: "Invalid JSON in tool arguments.",
      };
    }

    try {
      switch (name) {
        case "read_file":
          return await this.readFile(id, name, args);
        case "write_file":
          return await this.writeFile(id, name, args, expectedVersions);
        case "search_replace":
          return await this.searchReplace(id, name, args, expectedVersions);
        case "create_file":
          return await this.createFile(id, name, args);
        case "list_directory":
          return await this.listDir(id, name, args);
        default:
          return { tool_call_id: id, name, content: `Unknown tool: ${name}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { tool_call_id: id, name, content: `Error: ${msg}` };
    }
  }

  private async readFile(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<{ tool_call_id: string; content: string; name: string }> {
    const rel = typeof args.path === "string" ? args.path : "";
    const uri = this.resolvePath(rel);
    if (!uri) {
      return {
        tool_call_id: id,
        name,
        content: "Path is blocked or outside workspace.",
      };
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_TOOL_FILE_BYTES) {
      return {
        tool_call_id: id,
        name,
        content: `File is larger than ${MAX_TOOL_FILE_BYTES} bytes; read a smaller region or use another approach.`,
      };
    }
    if (looksBinary(bytes)) {
      return {
        tool_call_id: id,
        name,
        content: "File appears binary or non-text (skipped for safety).",
      };
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    let content = doc.getText();
    const wantLineNumbers =
      args.line_numbers === true || args.lineNumbers === true;
    if (wantLineNumbers) {
      content = formatFileWithLineNumbers(content);
    }
    return {
      tool_call_id: id,
      name,
      content,
    };
  }

  private async writeFile(
    id: string,
    name: string,
    args: Record<string, unknown>,
    expectedVersions: Map<string, number>
  ): Promise<ToolExecutionResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    let replacement = typeof args.content === "string" ? args.content : "";
    const uri = this.resolvePath(rel);
    if (!uri) {
      return {
        tool_call_id: id,
        name,
        content: "Path is blocked or outside workspace.",
      };
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const textBefore = doc.getText();
    const expected = expectedVersions.get(rel);
    if (expected !== undefined && doc.version !== expected) {
      return {
        tool_call_id: id,
        name,
        content:
          `Document version mismatch (was ${expected}, now ${doc.version}). Re-read the file and retry.`,
        aborted: "version_mismatch",
      };
    }

    const lineCount = doc.lineCount;
    const rangeParsed = this.parseWriteFileRange(args.range, lineCount);
    if (!rangeParsed) {
      return {
        tool_call_id: id,
        name,
        content:
          `Error: write_file requires range: { "startLine": number, "endLine": number } (1-based inclusive). ` +
          `This file has ${lineCount} line(s). Call read_file first, then set range to the lines to replace. ` +
          `For a whole-file rewrite use startLine: 1 and endLine: ${lineCount}.`,
      };
    }
    const { startLineIdx, endLineIdx } = rangeParsed;
    const firstLineText = doc.lineAt(startLineIdx).text;
    const existingLinesInRange: string[] = [];
    for (let i = startLineIdx; i <= endLineIdx; i++) {
      existingLinesInRange.push(doc.lineAt(i).text);
    }
    const merged = mergeWriteReplacementWithDocumentIndents(existingLinesInRange, replacement);
    replacement =
      merged !== null ? merged : this.normalizeReplacementIndent(firstLineText, replacement);

    const edit = new vscode.WorkspaceEdit();
    const startPos = new vscode.Position(startLineIdx, 0);
    const endLineObj = doc.lineAt(endLineIdx);
    const endPos = new vscode.Position(endLineIdx, endLineObj.text.length);
    edit.replace(uri, new vscode.Range(startPos, endPos), replacement);

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      return { tool_call_id: id, name, content: "applyEdit failed." };
    }
    recordPreEditSnapshot(uri, textBefore);
    const afterDoc =
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString()) ??
      (await vscode.workspace.openTextDocument(uri));
    const newLineCount = replacement.split(/\r?\n/).length;
    const endIdx = Math.min(
      startLineIdx + Math.max(0, newLineCount) - 1,
      afterDoc.lineCount - 1
    );
    const lastLine = afterDoc.lineAt(Math.max(startLineIdx, endIdx));
    const highlightRange = new vscode.Range(
      startLineIdx,
      0,
      Math.max(startLineIdx, endIdx),
      lastLine.text.length
    );
    const msg = `Wrote ${rel}. New document version: ${afterDoc.version}.`;
    const toolContent = await appendProblemsSectionToMessage(uri, rel, msg);
    return {
      tool_call_id: id,
      name,
      content: toolContent,
      editReview: { relativePath: rel, highlightRange },
      postApplyVersion: { relativePath: rel, version: afterDoc.version },
    };
  }

  private async searchReplace(
    id: string,
    name: string,
    args: Record<string, unknown>,
    expectedVersions: Map<string, number>
  ): Promise<ToolExecutionResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const old_string = typeof args.old_string === "string" ? args.old_string : "";
    const new_string = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = args.replace_all === true;
    let aroundNormalized: number | undefined;
    const rawAround = args.around_line ?? args.aroundLine;
    if (typeof rawAround === "number" && Number.isInteger(rawAround) && rawAround >= 1) {
      aroundNormalized = rawAround;
    }

    if (old_string.length === 0 || /^\s+$/.test(old_string)) {
      return {
        tool_call_id: id,
        name,
        content:
          "Error: search_replace requires non-empty old_string (copy the exact text from the latest read_file). Whitespace-only old_string is not allowed.",
      };
    }

    const uri = this.resolvePath(rel);
    if (!uri) {
      return {
        tool_call_id: id,
        name,
        content: "Path is blocked or outside workspace.",
      };
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_TOOL_FILE_BYTES) {
      return {
        tool_call_id: id,
        name,
        content: `File is larger than ${MAX_TOOL_FILE_BYTES} bytes; use a different approach.`,
      };
    }
    if (looksBinary(bytes)) {
      return {
        tool_call_id: id,
        name,
        content: "File appears binary or non-text (skipped for safety).",
      };
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const textBefore = doc.getText();
    const expected = expectedVersions.get(rel);
    if (expected !== undefined && doc.version !== expected) {
      return {
        tool_call_id: id,
        name,
        content:
          `Document version mismatch (was ${expected}, now ${doc.version}). Re-read the file and retry.`,
        aborted: "version_mismatch",
      };
    }

    const wlUnknown = args.within_lines ?? args.withinLines;
    let matches = this.findAllOccurrences(textBefore, old_string);
    if (
      wlUnknown !== undefined &&
      wlUnknown !== null &&
      (typeof wlUnknown !== "object" || Array.isArray(wlUnknown))
    ) {
      return {
        tool_call_id: id,
        name,
        content:
          "Error: within_lines must be an object like { \"start_line\": number, \"end_line\": number } (1-based inclusive lines). Omit the field when unused.",
      };
    }
    const parsedWithin =
      wlUnknown === undefined || wlUnknown === null
        ? undefined
        : this.parseWithinLines(wlUnknown, doc.lineCount);
    if (wlUnknown !== undefined && wlUnknown !== null && parsedWithin === undefined) {
      return {
        tool_call_id: id,
        name,
        content:
          `Error: Invalid within_lines. Use start_line and end_line within 1..${doc.lineCount} with start_line <= end_line. Re-call read_file with line_numbers true and copy line numbers.`,
      };
    }

    if (matches.length === 0) {
      return {
        tool_call_id: id,
        name,
        content:
          "Error: old_string not found in file. Call read_file on this path and copy the exact text (including indentation and line endings as returned).",
      };
    }
    if (parsedWithin !== undefined) {
      matches = matches.filter((off) => {
        const lastIdx = off + old_string.length - 1;
        const startLn = doc.positionAt(off).line + 1;
        const endLn = doc.positionAt(lastIdx).line + 1;
        return (
          startLn >= parsedWithin.start_line &&
          endLn <= parsedWithin.end_line
        );
      });
    }
    if (matches.length === 0 && parsedWithin !== undefined) {
      return {
        tool_call_id: id,
        name,
        content:
          `Error: old_string occurs in the file but not fully within lines ${parsedWithin.start_line}–${parsedWithin.end_line}. Widen within_lines or use more specific old_string. Re-read with line_numbers true.`,
      };
    }

    if (!replaceAll && matches.length > 1) {
      if (aroundNormalized === undefined) {
        return {
          tool_call_id: id,
          name,
          content:
            `Error: old_string matched ${matches.length} times inside the allowed span. Narrow old_string so it matches once, set replace_all to true, pass around_line (1-based) to choose the occurrence nearest that line, or tighten within_lines.`,
        };
      }
      const picks = matches.map((offset) => ({
        offset,
        line: doc.positionAt(offset).line + 1,
      }));
      const chosen = picks.reduce((best, cur) => {
        const da = Math.abs(cur.line - aroundNormalized);
        const db = Math.abs(best.line - aroundNormalized);
        if (da < db) return cur;
        if (da === db && cur.offset < best.offset) return cur;
        return best;
      });
      matches = [chosen.offset];
    }
    const norms: string[] = [];
    for (const st of matches) {
      const lineIdx = doc.positionAt(st).line;
      const firstLineText = doc.lineAt(lineIdx).text;
      norms.push(this.normalizeReplacementIndent(firstLineText, new_string));
    }

    let highlightEnd = matches[0];
    for (let i = 0; i < matches.length; i++) {
      const norm = norms[i];
      if (i === 0) {
        highlightEnd = matches[0] + norm.length;
      } else {
        highlightEnd += matches[i] - matches[i - 1] - old_string.length + norm.length;
      }
    }
    const highlightStart = matches[0];

    const edit = new vscode.WorkspaceEdit();
    const sortedIdx = [...matches.keys()].sort((a, b) => matches[b] - matches[a]);
    for (const ki of sortedIdx) {
      const st = matches[ki];
      const end = st + old_string.length;
      const norm = norms[ki];
      edit.replace(
        uri,
        new vscode.Range(doc.positionAt(st), doc.positionAt(end)),
        norm
      );
    }

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      return { tool_call_id: id, name, content: "applyEdit failed." };
    }
    recordPreEditSnapshot(uri, textBefore);

    const afterDoc =
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString()) ??
      (await vscode.workspace.openTextDocument(uri));

    const startPos = afterDoc.positionAt(Math.min(highlightStart, afterDoc.getText().length));
    const endOffset = Math.min(highlightEnd, afterDoc.getText().length);
    const endPos = afterDoc.positionAt(endOffset);
    const highlightRange = new vscode.Range(startPos, endPos);

    const countLabel = matches.length === 1 ? "1 occurrence" : `${matches.length} occurrences`;
    const msg = `Updated ${rel} (${countLabel}). New document version: ${afterDoc.version}.`;
    const toolContent = await appendProblemsSectionToMessage(uri, rel, msg);
    return {
      tool_call_id: id,
      name,
      content: toolContent,
      editReview: { relativePath: rel, highlightRange },
      postApplyVersion: { relativePath: rel, version: afterDoc.version },
    };
  }

  private async createFile(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    const rel = typeof args.path === "string" ? args.path : "";
    const fileBody = typeof args.content === "string" ? args.content : "";
    const uri = this.resolvePath(rel);
    if (!uri) {
      return {
        tool_call_id: id,
        name,
        content: "Path is blocked or outside workspace.",
      };
    }
    let textBefore = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      textBefore = new TextDecoder("utf-8").decode(bytes);
    } catch {
      textBefore = "";
    }
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    const enc = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, enc.encode(fileBody));
    recordPreEditSnapshot(uri, textBefore);
    const afterDoc = await vscode.workspace.openTextDocument(uri);
    const lastIdx = Math.max(0, afterDoc.lineCount - 1);
    const lastLine = afterDoc.lineAt(lastIdx);
    const highlightRange = new vscode.Range(0, 0, lastIdx, lastLine.text.length);
    const msg = `Created ${rel}.`;
    const toolContent = await appendProblemsSectionToMessage(uri, rel, msg);
    return {
      tool_call_id: id,
      name,
      content: toolContent,
      editReview: { relativePath: rel, highlightRange },
      postApplyVersion: { relativePath: rel, version: afterDoc.version },
    };
  }

  private async listDir(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<{ tool_call_id: string; content: string; name: string }> {
    const rel = typeof args.path === "string" ? args.path : ".";
    const uri = this.resolvePath(rel);
    if (!uri) {
      return {
        tool_call_id: id,
        name,
        content: "Path is blocked or outside workspace.",
      };
    }
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const lines = entries.map(([n, t]) => `${t === vscode.FileType.Directory ? "dir" : "file"}\t${n}`);
    return {
      tool_call_id: id,
      name,
      content: lines.join("\n") || "(empty)",
    };
  }
}
