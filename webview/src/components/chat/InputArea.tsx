import React, { useCallback, useEffect, useRef } from "react";

const MAX_HEIGHT_PX = 160;

export function InputArea({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}): React.ReactElement {
  const taRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback((): void => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        onSend();
      }
    }
  };

  return (
    <div
      className="shrink-0 px-3 pb-3 pt-2"
      style={{ backgroundColor: "var(--vscode-sideBar-background)" }}
    >
      <div
        className="flex items-end gap-2 rounded-xl border px-2 py-1.5 transition-[box-shadow] duration-200 ease-out focus-within:ring-1 focus-within:ring-[var(--vscode-focusBorder)]"
        style={{
          borderColor: "color-mix(in srgb, var(--vscode-input-border, #555) 70%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--vscode-input-background) 92%, transparent)",
        }}
      >
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "Message…"}
          onChange={(e) => {
            onChange(e.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          className="min-h-[2.25rem] max-h-40 flex-1 resize-none bg-transparent px-1.5 py-2 text-[13px] leading-snug text-[var(--vscode-input-foreground)] placeholder:[color:color-mix(in_srgb,var(--vscode-input-foreground)_42%,transparent)] focus:outline-none disabled:opacity-45"
        />
        <button
          type="button"
          disabled={disabled || !value.trim()}
          onClick={onSend}
          className="mb-0.5 shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-opacity duration-200 ease-out hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)] disabled:cursor-not-allowed disabled:opacity-35"
          style={{
            backgroundColor: "var(--vscode-button-background)",
            color: "var(--vscode-button-foreground)",
          }}
        >
          Send
        </button>
      </div>
      <p className="mt-1.5 px-0.5 text-[10px] opacity-60" style={{ color: "var(--vscode-descriptionForeground)" }}>
        Enter to send · Shift+Enter newline
      </p>
    </div>
  );
}
