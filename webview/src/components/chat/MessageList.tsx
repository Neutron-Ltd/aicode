import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../../types/chat";
import { MarkdownMessage } from "./MarkdownMessage";

export function MessageList({
  messages,
  onApplyCode,
  isSending,
}: {
  messages: ChatMessage[];
  onApplyCode: (code: string) => void;
  isSending: boolean;
}): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  const showTypingIndicator =
    isSending &&
    messages.length > 0 &&
    (() => {
      const last = messages[messages.length - 1];
      if (last.role === "user") return true;
      if (last.role === "assistant" && last.content === "") return true;
      return false;
    })();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showTypingIndicator]);

  if (messages.length === 0) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            background:
              "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(99, 102, 241, 0.08), transparent)",
          }}
          aria-hidden
        />
        <div
          className="relative h-px w-12 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in srgb, var(--vscode-descriptionForeground) 35%, transparent), transparent)",
          }}
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto bg-transparent px-3 py-4">
      {messages.map((m) => {
        if (m.role === "assistant" && m.content === "" && isSending) {
          return null;
        }
        if (m.role === "user") {
          return (
            <div key={m.id} className="flex justify-end pl-8">
              <div
                className="max-w-[min(100%,26rem)] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--vscode-editor-foreground) 6%, transparent)",
                  color: "var(--vscode-sideBar-foreground)",
                }}
              >
                <MarkdownMessage content={m.content} onApplyCode={onApplyCode} variant="inline" />
              </div>
            </div>
          );
        }
        return (
          <div key={m.id} className="min-w-0 pr-2">
            <MarkdownMessage content={m.content} onApplyCode={onApplyCode} variant="flush" />
          </div>
        );
      })}
      {showTypingIndicator ? (
        <div className="flex justify-start pr-8" role="status" aria-live="polite">
          <span className="text-[12px] italic" style={{ color: "var(--vscode-descriptionForeground)" }}>
            …
          </span>
        </div>
      ) : null}
      <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
    </div>
  );
}
