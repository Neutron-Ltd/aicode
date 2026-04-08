import { useEffect, useState } from "react";

/**
 * Prefer Prism theme aligned with the VS Code webview (sidebar) background luminance,
 * not only OS dark mode — keeps code blocks readable when the editor theme differs from the OS.
 */
function sidebarLooksDark(): boolean {
  if (typeof document === "undefined") return true;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--vscode-sideBar-background")
    .trim();
  if (!raw) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  const m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m) {
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance < 0.45;
  }
  if (raw.startsWith("rgb")) {
    const parts = raw.match(/\d+/g);
    if (parts && parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return luminance < 0.45;
    }
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(sidebarLooksDark);

  useEffect(() => {
    setDark(sidebarLooksDark());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setDark(sidebarLooksDark());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return dark;
}
