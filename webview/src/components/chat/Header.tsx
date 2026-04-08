import React from "react";
import type { ModelOption } from "../../types/chat";

export function Header({
  models,
  selectedModelId,
  onModelChange,
  tokenQuota,
  lastPongAt,
  onPing,
  onIndexWorkspace,
  isIndexing,
  userLabel,
  userEmail,
}: {
  models: ModelOption[];
  selectedModelId: string;
  onModelChange: (id: string) => void;
  tokenQuota: number;
  lastPongAt: number | null;
  onPing: () => void;
  onIndexWorkspace: () => void;
  isIndexing: boolean;
  userLabel: string | null;
  userEmail: string | null;
}): React.ReactElement {
  const formatted = new Intl.NumberFormat(undefined).format(tokenQuota);
  const pongLabel =
    lastPongAt !== null
      ? new Date(lastPongAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "—";

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-mirror-border bg-mirror-surface/95 backdrop-blur-sm transition-colors duration-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="sr-only">Model</span>
          <select
            value={selectedModelId}
            onChange={(e) => onModelChange(e.target.value)}
            className="max-w-full cursor-pointer rounded-lg border border-mirror-border bg-mirror-input py-1.5 pl-2 pr-8 text-xs font-medium text-mirror-input-fg shadow-sm transition-all duration-200 ease-out hover:border-mirror-focus focus:outline-none focus:ring-2 focus:ring-mirror-focus"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div
          className="shrink-0 text-right text-[11px] leading-tight text-mirror-muted transition-colors duration-200"
          title="Remaining quota"
        >
          <span className="font-mono text-[12px] font-semibold tabular-nums text-mirror-fg">
            {formatted}
          </span>
          <span className="ml-1">tokens left</span>
        </div>
      </div>
      {(userLabel || userEmail) && (
        <div className="truncate border-t border-mirror-border/60 px-1 py-1 text-[10px] text-mirror-muted">
          <span className="font-medium text-mirror-fg">{userLabel}</span>
          {userEmail ? (
            <span className="ml-2 opacity-80">{userEmail}</span>
          ) : null}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-mirror-border/60 px-1 py-1.5">
        <span className="truncate font-mono text-[10px] text-mirror-muted">
          PONG: <span className="text-mirror-fg">{pongLabel}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onIndexWorkspace}
            disabled={isIndexing}
            aria-busy={isIndexing}
            aria-label="Index workspace"
            className="shrink-0 rounded-md border border-mirror-border px-2 py-0.5 text-[10px] font-medium text-mirror-fg transition-colors duration-200 hover:bg-mirror-input focus:outline-none focus:ring-2 focus:ring-mirror-focus disabled:cursor-not-allowed disabled:opacity-60"
            title={isIndexing ? "Indexing workspace..." : "Index Workspace"}
          >
            {isIndexing ? "Indexing..." : "Index Workspace"}
          </button>
          <button
            type="button"
            onClick={onPing}
            className="shrink-0 rounded-md border border-mirror-border px-2 py-0.5 text-[10px] font-medium text-mirror-fg transition-colors duration-200 hover:bg-mirror-input focus:outline-none focus:ring-2 focus:ring-mirror-focus"
          >
            Ping
          </button>
        </div>
      </div>
    </header>
  );
}
