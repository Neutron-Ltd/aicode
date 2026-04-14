import type { ToolCallWire } from "./services/ToolExecutionService";

export type ToolPlanStepWire = {
  id: string;
  tool: string;
  path?: string;
  summary: string;
};

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Builds human-readable steps for the webview plan panel (from streamed tool_calls). */
export function buildToolPlanSteps(toolCalls: ToolCallWire[]): ToolPlanStepWire[] {
  return toolCalls.map((tc, i) => {
    const id = `step-${i}`;
    const tool = tc.function.name;
    let path: string | undefined;
    let summary = tool;
    try {
      const args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      if (typeof args.path === "string") {
        path = args.path;
        summary = `${tool}: ${args.path}`;
      }
      if (typeof args.content === "string" && args.content.length > 0) {
        summary += ` — ${truncate(args.content, 120)}`;
      }
    } catch {
      summary = tool;
    }
    return { id, tool, path, summary };
  });
}
