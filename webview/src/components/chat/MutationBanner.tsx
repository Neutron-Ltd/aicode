import React from "react";
import type { MutationProgressState } from "../../store/ultraStore";

export function MutationBanner({
  progress,
}: {
  progress: MutationProgressState;
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
      role="status"
      aria-live="polite"
      aria-label="Tool execution status"
    >
      <p
        className="text-[11px] leading-snug"
        style={{ color: "var(--vscode-foreground)" }}
      >
        {progress.line}
      </p>
    </div>
  );
}
