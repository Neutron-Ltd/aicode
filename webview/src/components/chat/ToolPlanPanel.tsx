import React from "react";
import type { PendingToolPlan } from "../../store/ultraStore";

export function ToolPlanPanel({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: PendingToolPlan;
  onConfirm: () => void;
  onCancel: () => void;
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
      aria-label="Pending AI tool plan"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--vscode-descriptionForeground)" }}
        >
          Review tool plan
        </p>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: "var(--vscode-button-secondaryForeground)",
              backgroundColor: "var(--vscode-button-secondaryBackground)",
            }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: "var(--vscode-button-foreground)",
              backgroundColor: "var(--vscode-button-background)",
            }}
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
      <ol className="max-h-40 list-decimal space-y-1.5 overflow-y-auto pl-4 text-[11px] leading-snug">
        {plan.steps.map((step) => (
          <li
            key={step.id}
            className="break-words"
            style={{ color: "var(--vscode-foreground)" }}
          >
            <span className="font-mono text-[10px] opacity-80">{step.tool}</span>
            {step.path ? (
              <span className="ml-1 opacity-90">{step.path}</span>
            ) : null}
            <div
              className="mt-0.5 font-normal opacity-85"
              style={{ color: "var(--vscode-descriptionForeground)" }}
            >
              {step.summary}
            </div>
          </li>
        ))}
      </ol>
      <p
        className="mt-2 text-[10px] leading-tight"
        style={{ color: "var(--vscode-descriptionForeground)" }}
      >
        File writes open a diff in the editor before applying.
      </p>
    </div>
  );
}
