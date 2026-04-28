import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { recordPreEditSnapshot } from "../aiUndoTelemetry";
import { captureTelemetryEvent } from "../telemetry";
import { isBlockedRelativePath } from "../tooling/toolPathGuards";
import { looksBinary, MAX_TOOL_FILE_BYTES } from "../tooling/looksBinary";
import { AsyncSerialQueue } from "./toolExecutionQueue";

export type ToolCallWire = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Runs `read_file`, `write_file`, `create_file`, `list_directory` from chat tool_calls.
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
   * Validates 1-based inclusive line range for write_file; returns 0-based line indices or null.
   */
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

  async executeOne(
    call: ToolCallWire,
    /** Expected document version before write (from model); mismatch aborts. */
    expectedVersions: Map<string, number>
  ): Promise<{ tool_call_id: string; content: string; name: string; aborted?: string }> {
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
  ): Promise<{ tool_call_id: string; content: string; name: string; aborted?: string }> {
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
    return {
      tool_call_id: id,
      name,
      content: new TextDecoder("utf-8").decode(bytes),
    };
  }

  private async writeFile(
    id: string,
    name: string,
    args: Record<string, unknown>,
    expectedVersions: Map<string, number>
  ): Promise<{ tool_call_id: string; content: string; name: string; aborted?: string }> {
    const rel = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
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
    const edit = new vscode.WorkspaceEdit();
    const startPos = new vscode.Position(startLineIdx, 0);
    const endLineObj = doc.lineAt(endLineIdx);
    const endPos = new vscode.Position(endLineIdx, endLineObj.text.length);
    edit.replace(uri, new vscode.Range(startPos, endPos), content);

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      return { tool_call_id: id, name, content: "applyEdit failed." };
    }
    recordPreEditSnapshot(uri, textBefore);
    const after = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    return {
      tool_call_id: id,
      name,
      content: `Wrote ${rel}. New document version: ${after?.version ?? "?"}.`,
    };
  }

  private async createFile(
    id: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<{ tool_call_id: string; content: string; name: string }> {
    const rel = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
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
    await vscode.workspace.fs.writeFile(uri, enc.encode(content));
    recordPreEditSnapshot(uri, textBefore);
    return { tool_call_id: id, name, content: `Created ${rel}.` };
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
