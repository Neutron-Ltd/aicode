import React from "react";

export function ChatErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div
      className="shrink-0 border-b px-3 py-2"
      style={{
        borderColor:
          "color-mix(in srgb, var(--vscode-inputValidation-errorBorder) 35%, transparent)",
        backgroundColor:
          "color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 40%, transparent)",
      }}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 shrink-0 text-[var(--vscode-inputValidation-errorForeground)] opacity-90"
          aria-hidden
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </span>
        <p
          className="min-w-0 flex-1 text-[11px] leading-snug"
          style={{ color: "var(--vscode-inputValidation-errorForeground)" }}
        >
          {message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
          style={{ color: "var(--vscode-descriptionForeground)" }}
          aria-label="Dismiss"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
