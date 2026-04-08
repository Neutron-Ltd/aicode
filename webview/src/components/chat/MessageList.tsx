import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../../types/chat";
import { MarkdownMessage } from "./MarkdownMessage";

export function MessageList({
  messages,
  onApplyCode,
}: {
  messages: ChatMessage[];
  onApplyCode: (code: string) => void;
}): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-sm text-mirror-muted transition-colors duration-200">
          No messages yet. Ask Mirror anything about your code.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
      {messages.map((m) => (
        <div
          key={m.id}
          className={
            m.role === "user"
              ? "ml-4 flex justify-end"
              : "mr-4 flex justify-start"
          }
        >
          <div
            className={
              m.role === "user"
                ? "max-w-[min(100%,28rem)] rounded-2xl border border-mirror-border bg-mirror-bubble-user px-3 py-2 text-mirror-bubble-user-fg shadow-mirror transition-all duration-200 ease-out"
                : "max-w-[min(100%,28rem)] rounded-2xl border border-mirror-border bg-mirror-bubble-ai px-3 py-2 text-mirror-bubble-ai-fg shadow-mirror transition-all duration-200 ease-out"
            }
          >
            <MarkdownMessage
              content={m.content}
              onApplyCode={onApplyCode}
            />
          </div>
        </div>
      ))}
      <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
    </div>
  );
}
