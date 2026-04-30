import React from "react";

export function EditReviewBanner({
  relativePath,
  onApprove,
  onUndo,
}: {
  relativePath: string;
  onApprove: () => void;
  onUndo: () => void;
}): React.ReactElement {
  return (
    <div
      className="shrink-0 border-b px-3 py-2.5"
      style={{
        borderColor:
          "color-mix(in srgb, var(--vscode-focusBorder) 45%, transparent)",
        backgroundColor:
          "color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground) 55%, transparent)",
      }}
      role="region"
      aria-label="Review AI file edit"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="min-w-0 flex-1 text-[11px] leading-snug"
          style={{ color: "var(--vscode-foreground)" }}
        >
          Edited <span className="font-mono">{relativePath}</span>. Undo restores the
          previous file; Approve clears highlights.
        </p>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: "var(--vscode-button-secondaryForeground)",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
            }}
            onClick={onUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
            }}
            onClick={onApprove}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
