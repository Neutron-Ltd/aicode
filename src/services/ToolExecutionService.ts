import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { isBlockedRelativePath } from "../tooling/toolPathGuards";

export type ToolCallWire = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Runs `read_file`, `write_file`, `create_file`, `list_directory` from chat tool_calls.
 * Enforces workspace scope and blocks `.env` / `.git` paths.
 */
export class ToolExecutionService {
  constructor(private readonly getWorkspaceRoot: () => vscode.Uri | null) {}

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

  async executeOne(
    call: ToolCallWire,
    /** Expected document version before write (from model); mismatch aborts. */
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

    const rangeSpec = args.range as
      | { startLine?: number; endLine?: number }
      | undefined;
    const edit = new vscode.WorkspaceEdit();
    if (
      rangeSpec &&
      typeof rangeSpec.startLine === "number" &&
      typeof rangeSpec.endLine === "number"
    ) {
      const start = Math.max(0, rangeSpec.startLine - 1);
      const end = Math.max(start, rangeSpec.endLine - 1);
      const startPos = new vscode.Position(start, 0);
      const endLine = doc.lineAt(Math.min(end, doc.lineCount - 1));
      const endPos = new vscode.Position(end, endLine.text.length);
      edit.replace(uri, new vscode.Range(startPos, endPos), content);
    } else {
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length)
      );
      const lineCount = doc.lineCount;
      if (lineCount > 50) {
        const ok = await vscode.window.showWarningMessage(
          `Replace all ${lineCount} lines in "${rel}"?`,
          { modal: true },
          "Replace"
        );
        if (ok !== "Replace") {
          return {
            tool_call_id: id,
            name,
            content: "User declined full-file replace.",
            aborted: "user_declined",
          };
        }
      }
      edit.replace(uri, fullRange, content);
    }

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      return { tool_call_id: id, name, content: "applyEdit failed." };
    }
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
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    const enc = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, enc.encode(content));
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
