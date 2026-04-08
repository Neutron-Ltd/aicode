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
    <div className="shrink-0 border-t border-mirror-border bg-mirror-surface p-2 transition-all duration-200">
      <div className="flex items-end gap-2 rounded-xl border border-mirror-border bg-mirror-input p-2 shadow-sm transition-all duration-200 ease-out focus-within:border-mirror-focus focus-within:ring-1 focus-within:ring-mirror-focus">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "Message Mirror…"}
          onChange={(e) => {
            onChange(e.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          className="min-h-[2.25rem] max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-snug text-mirror-input-fg placeholder:text-mirror-muted focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || !value.trim()}
          onClick={onSend}
          className="mb-0.5 shrink-0 rounded-lg bg-[var(--vscode-button-background)] px-3 py-1.5 text-xs font-semibold text-[var(--vscode-button-foreground)] shadow-sm transition-opacity duration-200 ease-out hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-mirror-focus disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
      <p className="mt-1 px-0.5 text-[10px] text-mirror-muted">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
