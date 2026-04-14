import * as path from "node:path";

/** Reject AI access to secrets and VCS metadata. */
export function isBlockedRelativePath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = n.split("/").filter(Boolean);
  if (segments.some((s) => s === ".git")) return true;
  const base = path.basename(n).toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (n.includes("/.git/") || n.endsWith("/.git")) return true;
  return false;
}
