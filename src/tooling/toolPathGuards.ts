import * as path from "node:path";

/** Aligns with indexer `HARD_IGNORED_DIRS` — block tool access under these path segments. */
const BLOCKED_TOOL_PATH_SEGMENTS = new Set(["node_modules", "dist", "build"]);

/** Reject AI access to secrets, VCS metadata, and heavyweight/build dirs. */
export function isBlockedRelativePath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = n.split("/").filter(Boolean);
  if (segments.some((s) => s === ".git" || BLOCKED_TOOL_PATH_SEGMENTS.has(s))) {
    return true;
  }
  const base = path.basename(n).toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (n.includes("/.git/") || n.endsWith("/.git")) return true;
  return false;
}
