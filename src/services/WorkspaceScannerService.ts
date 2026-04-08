import * as vscode from "vscode";
import { getMirrorSupabaseConfig } from "./AuthService";
import type { AuthService } from "./AuthService";
import type { HostToWebviewMessage } from "../shared/messages";

type WorkspaceChunk = {
  file_path: string;
  content: string;
  chunk_index: number;
};

const HARD_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build"]);
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".7z",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);
const MAX_FILE_BYTES = 512_000;
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 120;

/**
 * Scans workspace files, chunks text content, and sends chunks to the embed Edge Function.
 */
export class WorkspaceScannerService {
  constructor(
    private readonly auth: AuthService,
    private readonly postToWebview?: (msg: HostToWebviewMessage) => void
  ) {}

  async indexWorkspace(): Promise<{ files: number; chunks: number }> {
    this.postToWebview?.({ type: "INDEX_STARTED" });
    try {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        throw new Error("Open a workspace folder before indexing.");
      }

      const { url, key } = getMirrorSupabaseConfig();
      if (!url || !key) {
        throw new Error(
          "Set mirror.supabaseUrl and mirror.supabaseAnonKey in Settings."
        );
      }
      const token = await this.auth.getSessionAccessToken();
      if (!token) {
        throw new Error("Sign in to index your workspace.");
      }

      const chunks: WorkspaceChunk[] = [];
      let files = 0;

      for (const folder of folders) {
        const ignore = await this.loadGitignorePatterns(folder.uri);
        const filesInFolder = await this.collectFiles(folder.uri, ignore);
        files += filesInFolder.length;
        for (const file of filesInFolder) {
          const fileChunks = await this.readAndChunkFile(folder.uri, file);
          chunks.push(...fileChunks);
        }
      }

      if (chunks.length === 0) {
        this.postToWebview?.({
          type: "INDEX_COMPLETE",
          payload: { files, chunks: 0 },
        });
        return { files, chunks: 0 };
      }

      const embedUrl = `${url.replace(/\/$/, "")}/functions/v1/embed`;
      const response = await fetch(embedUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chunks }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`Indexing failed (${response.status}): ${detail.slice(0, 500)}`);
      }

      const result = { files, chunks: chunks.length };
      this.postToWebview?.({ type: "INDEX_COMPLETE", payload: result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.postToWebview?.({ type: "INDEX_ERROR", payload: { message } });
      throw err;
    }
  }

  private async collectFiles(
    root: vscode.Uri,
    ignorePatterns: string[]
  ): Promise<vscode.Uri[]> {
    const out: vscode.Uri[] = [];
    const walk = async (dir: vscode.Uri): Promise<void> => {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(dir, name);
        const rel = this.relativePath(root, child);
        if (!rel) continue;
        if (this.isIgnored(rel, name, type, ignorePatterns)) continue;

        if (type === vscode.FileType.Directory) {
          await walk(child);
        } else if (type === vscode.FileType.File) {
          out.push(child);
        }
      }
    };
    await walk(root);
    return out;
  }

  private isIgnored(
    relPath: string,
    name: string,
    type: vscode.FileType,
    ignorePatterns: string[]
  ): boolean {
    if (type === vscode.FileType.Directory && HARD_IGNORED_DIRS.has(name)) {
      return true;
    }
    const lower = name.toLowerCase();
    for (const ext of BINARY_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
    const normalized = relPath.replace(/\\/g, "/");
    return ignorePatterns.some((p) => this.matchGitignorePattern(normalized, p));
  }

  private async loadGitignorePatterns(root: vscode.Uri): Promise<string[]> {
    const ignoreUri = vscode.Uri.joinPath(root, ".gitignore");
    try {
      const bytes = await vscode.workspace.fs.readFile(ignoreUri);
      const text = new TextDecoder("utf-8").decode(bytes);
      return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
    } catch {
      return [];
    }
  }

  private matchGitignorePattern(path: string, pattern: string): boolean {
    const p = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (!p) return false;

    // Simple wildcard support: "*"
    const regex = new RegExp(
      "^" +
        p
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*") +
        "($|/)"
    );
    if (regex.test(path)) return true;

    // Also treat plain names as "segment contains"
    return path.split("/").includes(p);
  }

  private async readAndChunkFile(
    root: vscode.Uri,
    file: vscode.Uri
  ): Promise<WorkspaceChunk[]> {
    const bytes = await vscode.workspace.fs.readFile(file);
    if (bytes.byteLength > MAX_FILE_BYTES) return [];
    if (this.looksBinary(bytes)) return [];

    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!text.trim()) return [];

    const filePath = this.relativePath(root, file);
    if (!filePath) return [];
    return this.chunkText(filePath, text, DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP);
  }

  private looksBinary(bytes: Uint8Array): boolean {
    const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
    for (const b of sample) {
      if (b === 0) return true;
    }
    return false;
  }

  private chunkText(
    filePath: string,
    text: string,
    chunkSize: number,
    overlap: number
  ): WorkspaceChunk[] {
    const chunks: WorkspaceChunk[] = [];
    const safeOverlap = Math.max(0, Math.min(overlap, chunkSize - 1));
    let index = 0;
    let start = 0;
    while (start < text.length) {
      const end = Math.min(text.length, start + chunkSize);
      const content = text.slice(start, end);
      if (content.trim()) {
        chunks.push({ file_path: filePath, content, chunk_index: index++ });
      }
      if (end >= text.length) break;
      start = end - safeOverlap;
      if (start < 0) start = end;
    }
    return chunks;
  }

  private relativePath(root: vscode.Uri, child: vscode.Uri): string | null {
    const rootPath = root.path.endsWith("/") ? root.path : `${root.path}/`;
    if (!child.path.startsWith(rootPath)) return null;
    return child.path.slice(rootPath.length);
  }
}

