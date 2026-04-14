import React, { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../../types/chat";
import { useUltraStore } from "../../store/ultraStore";
import { MarkdownMessage } from "./MarkdownMessage";

/** Pixels from bottom to consider "following" the stream (auto-scroll). */
const NEAR_BOTTOM_THRESHOLD_PX = 100;

export function MessageList({
  messages,
  onApplyCode,
  isSending,
}: {
  messages: ChatMessage[];
  onApplyCode: (code: string) => void;
  isSending: boolean;
}): React.ReactElement {
  const serviceMaintenance = useUltraStore((s) => s.serviceMaintenance);
  const dismissServiceMaintenance = useUltraStore(
    (s) => s.dismissServiceMaintenance
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** When true, new content scrolls the list to the bottom (instant, rAF). */
  const followBottomRef = useRef(true);
  const scrollRafRef = useRef(0);

  const showTypingIndicator =
    isSending &&
    messages.length > 0 &&
    (() => {
      const last = messages[messages.length - 1];
      if (last.role === "user") return true;
      if (last.role === "assistant" && last.content === "") return true;
      return false;
    })();

  const updateFollowFromScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= NEAR_BOTTOM_THRESHOLD_PX) {
      followBottomRef.current = true;
    } else {
      followBottomRef.current = false;
    }
  }, []);

  /** User sent a message — resume following the reply stream. */
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      followBottomRef.current = true;
    }
  }, [messages]);

  /** Throttled scroll-to-bottom: only if following; instant scroll (no smooth) to avoid jitter. */
  useEffect(() => {
    if (messages.length === 0) return;

    if (!followBottomRef.current) return;

    cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el && followBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });

    return () => cancelAnimationFrame(scrollRafRef.current);
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
    <div
      ref={scrollContainerRef}
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto bg-transparent px-3 py-4"
      style={{ overflowAnchor: "auto" }}
      onScroll={updateFollowFromScroll}
    >
      {serviceMaintenance ? (
        <div
          role="alert"
          aria-live="polite"
          className="flex shrink-0 flex-col gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="text-[13px] font-semibold leading-snug"
                style={{ color: "var(--vscode-editorWarning-foreground)" }}
              >
                Service Temporarily Unavailable
              </p>
              <p
                className="mt-1 text-[12px] leading-relaxed"
                style={{
                  color: "color-mix(in srgb, var(--vscode-foreground) 88%, transparent)",
                }}
              >
                The AI service cannot be reached right now. Please try again in
                a few minutes.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded px-2 py-1 text-[11px] font-medium"
              style={{
                color: "var(--vscode-textLink-foreground)",
                background:
                  "color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent)",
              }}
              onClick={() => dismissServiceMaintenance()}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
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
          <div key={m.id} className="flex min-w-0 flex-col gap-1 pr-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{
                color:
                  "color-mix(in srgb, rgb(196 181 253) 80%, var(--vscode-descriptionForeground))",
              }}
            >
              Ultra AI
            </span>
            <MarkdownMessage content={m.content} onApplyCode={onApplyCode} variant="flush" />
          </div>
        );
      })}
      {showTypingIndicator ? (
        <div
          className="flex flex-col gap-2 pr-8"
          role="status"
          aria-live="polite"
          aria-label="Ultra AI is thinking"
        >
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{
              color:
                "color-mix(in srgb, rgb(196 181 253) 75%, var(--vscode-descriptionForeground))",
            }}
          >
            Ultra AI is thinking…
          </span>
          <div className="flex max-w-[min(100%,20rem)] flex-col gap-2 rounded-lg border border-violet-500/15 bg-gray-700/50 p-3 shadow-sm animate-pulse ring-1 ring-violet-500/10">
            <div
              className="h-2.5 w-[88%] rounded-md"
              style={{
                background:
                  "color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent)",
              }}
            />
            <div
              className="h-2.5 w-[62%] rounded-md"
              style={{
                background:
                  "color-mix(in srgb, var(--vscode-editor-foreground) 8%, transparent)",
              }}
            />
            <div
              className="h-2.5 w-[40%] rounded-md"
              style={{
                background:
                  "color-mix(in srgb, var(--vscode-editor-foreground) 6%, transparent)",
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="h-px shrink-0" aria-hidden />
    </div>
  );
}
