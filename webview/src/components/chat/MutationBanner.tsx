import React from "react";
import type { MutationProgressState } from "../../store/ultraStore";

export function MutationBanner({
  progress,
  onFocusEditor,
}: {
  progress: MutationProgressState;
  onFocusEditor: () => void;
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
      <div className="flex flex-col gap-1.5">
        <p
          className="text-[11px] leading-snug"
          style={{ color: "var(--vscode-foreground)" }}
        >
          {progress.line}
        </p>
        {progress.diffAwaiting ? (
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="min-w-0 flex-1 text-[10px] leading-tight"
              style={{ color: "var(--vscode-descriptionForeground)" }}
            >
              A diff tab should be open in the editor. Use{" "}
              <span className="font-medium">Apply</span> or{" "}
              <span className="font-medium">Skip</span> in the host dialog when
              you are ready.
            </p>
            <button
              type="button"
              className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
              style={{
                color: "var(--vscode-button-secondaryForeground)",
                backgroundColor: "var(--vscode-button-secondaryBackground)",
              }}
              onClick={onFocusEditor}
            >
              Focus editor
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
