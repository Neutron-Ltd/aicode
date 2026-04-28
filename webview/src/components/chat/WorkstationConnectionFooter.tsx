import React from "react";
import { useUltraStore } from "../../store/ultraStore";

const HINT_COPY: Record<"configure" | "unreachable" | "denied", string> = {
  configure: "Add the compute host under Settings → Build Ultra.",
  unreachable: "Ultra AI compute is not reachable right now.",
  denied: "Access was denied. Check your API key in settings.",
};

/** Private-compute reachability (neutral Ultra AI branding; no host URLs or stack text). */
export function WorkstationConnectionFooter(): React.ReactElement | null {
  const runtimeMode = useUltraStore((s) => s.runtimeMode);
  const online = useUltraStore((s) => s.workstationOnline);
  const hint = useUltraStore((s) => s.computeStatusHint);

  if (runtimeMode !== "Workstation") {
    return null;
  }

  const detail = !online && hint ? HINT_COPY[hint] : null;

  return (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px]"
      style={{
        borderColor:
          "color-mix(in srgb, var(--vscode-sideBar-border, #555) 45%, transparent)",
        color: "var(--vscode-descriptionForeground)",
      }}
      role="status"
    >
      <span className="font-medium uppercase tracking-wide">Ultra AI compute</span>
      <span className="flex min-w-0 flex-col items-end gap-0.5 text-right">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: online
                ? "rgb(34 197 94)"
                : "rgb(239 68 68)",
            }}
            aria-hidden
          />
          <span
            className="shrink-0"
            style={{
              color: online
                ? "rgb(34 197 94)"
                : "rgb(239 68 68)",
            }}
          >
            {online ? "Ready" : "Unavailable"}
          </span>
        </span>
        {detail ? (
          <span
            className="max-w-[min(100%,14rem)] text-[9px] leading-tight opacity-85"
            title={detail}
          >
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}
