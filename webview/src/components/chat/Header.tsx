import React from "react";

const iconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_85%,transparent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)] disabled:cursor-not-allowed disabled:opacity-35";

export function Header({
  onIndexWorkspace,
  isIndexing,
  onClearChat,
  clearChatDisabled,
  onOpenSettings,
  indexWorkspaceDisabled = false,
}: {
  onIndexWorkspace: () => void;
  isIndexing: boolean;
  onClearChat: () => void;
  clearChatDisabled: boolean;
  onOpenSettings: () => void;
  /** When true (Workstation mode), indexing is unavailable. */
  indexWorkspaceDisabled?: boolean;
}): React.ReactElement {
  return (
    <header
      className="shrink-0 border-b backdrop-blur-sm transition-colors duration-200"
      style={{
        borderColor: "color-mix(in srgb, var(--vscode-sideBar-border, #555) 55%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)",
      }}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div
          className="flex min-w-0 flex-1 items-center rounded-lg border py-1.5 px-2.5 text-[11px] font-medium"
          style={{
            borderColor: "var(--vscode-sideBar-border, rgba(128,128,128,0.35))",
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
          }}
          title="Model routing is configured on the server"
        >
          <span className="truncate">Ultra AI</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onClearChat}
            disabled={clearChatDisabled}
            className={iconBtn}
            style={{ color: "var(--vscode-icon-foreground, var(--vscode-foreground))" }}
            title={clearChatDisabled ? "Cannot clear while sending" : "Clear chat"}
            aria-label="Clear chat"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onIndexWorkspace}
            disabled={isIndexing || indexWorkspaceDisabled}
            aria-busy={isIndexing}
            className={iconBtn}
            style={{ color: "var(--vscode-icon-foreground, var(--vscode-foreground))" }}
            title={
              indexWorkspaceDisabled
                ? "Indexing is available in Cloud mode only (Settings → Build Ultra)"
                : isIndexing
                  ? "Indexing workspace…"
                  : "Index workspace for richer Ultra AI context"
            }
            aria-label="Index workspace"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className={iconBtn}
            style={{ color: "var(--vscode-icon-foreground, var(--vscode-foreground))" }}
            title="Settings"
            aria-label="Settings"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
