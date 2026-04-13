import React from "react";

export function SettingsPanel({
  userLabel,
  userEmail,
  tokenQuota,
  onLogout,
  onClose,
}: {
  userLabel: string | null;
  userEmail: string | null;
  tokenQuota: number;
  onLogout: () => void;
  onClose: () => void;
}): React.ReactElement {
  const formatted = new Intl.NumberFormat(undefined).format(tokenQuota);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-30 cursor-default bg-black/10"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div
        className="absolute right-2 top-full z-40 mt-1 w-[min(17rem,calc(100vw-1rem))] overflow-hidden rounded-xl border shadow-lg"
        style={{
          borderColor: "var(--vscode-sideBar-border, var(--vscode-contrastBorder))",
          backgroundColor: "var(--vscode-sideBar-background)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ultra-settings-title"
      >
        <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--vscode-sideBar-border, rgba(128,128,128,0.2))" }}>
          <h2
            id="ultra-settings-title"
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--vscode-descriptionForeground)" }}
          >
            Account
          </h2>
        </div>
        <div className="space-y-3 px-3 py-3 text-xs">
          <div>
            <p className="mb-0.5 text-[10px] uppercase tracking-wide" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Signed in as
            </p>
            <p className="truncate font-medium" style={{ color: "var(--vscode-sideBar-foreground)" }}>
              {userLabel ?? "—"}
            </p>
            {userEmail ? (
              <p className="mt-2 truncate text-[11px] opacity-80" style={{ color: "var(--vscode-sideBar-foreground)" }}>
                {userEmail}
              </p>
            ) : null}
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--vscode-sideBar-border, rgba(128,128,128,0.2))" }}>
            <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--vscode-descriptionForeground)" }}>
              Token quota
            </span>
            <span className="font-mono text-[12px] tabular-nums" style={{ color: "var(--vscode-sideBar-foreground)" }}>
              {formatted}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onLogout();
              onClose();
            }}
            className="w-full rounded-lg border px-3 py-2 text-[11px] font-medium transition-colors duration-200 hover:opacity-90"
            style={{
              borderColor: "var(--vscode-input-border)",
              color: "var(--vscode-foreground)",
              backgroundColor: "transparent",
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}
