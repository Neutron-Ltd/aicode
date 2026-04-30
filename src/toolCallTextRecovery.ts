import type { ToolCallWire } from "./services/ToolExecutionService";

const ALLOWED_TOOLS = new Set([
  "read_file",
  "write_file",
  "search_replace",
  "create_file",
  "list_directory",
]);

function unwrapCodeFences(s: string): string {
  return s.replace(/```(?:json)?\s*\n?([\s\S]*?)```/gi, (_, inner: string) => inner.trim());
}

/** End index inclusive of closing brace, or null if unbalanced. */
function findBalancedBraceEnd(s: string, start: number): number | null {
  if (s[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

function findBalancedBracketEnd(
  s: string,
  start: number,
  open: string,
  close: string
): number | null {
  if (s[start] !== open) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

function wireFromShorthand(
  obj: Record<string, unknown>,
  index: number
): ToolCallWire | null {
  const name = obj.name;
  if (typeof name !== "string" || !ALLOWED_TOOLS.has(name)) return null;
  const argsRaw = obj.arguments;
  let argsStr: string;
  if (typeof argsRaw === "string") {
    try {
      JSON.parse(argsRaw);
    } catch {
      return null;
    }
    argsStr = argsRaw;
  } else if (argsRaw !== null && typeof argsRaw === "object") {
    argsStr = JSON.stringify(argsRaw);
  } else {
    return null;
  }
  return {
    id: `content-recovery-${index}`,
    type: "function",
    function: { name, arguments: argsStr },
  };
}

function wiresFromParsed(parsed: unknown): ToolCallWire[] | null {
  if (Array.isArray(parsed)) {
    const wires: ToolCallWire[] = [];
    for (const el of parsed) {
      if (!el || typeof el !== "object" || Array.isArray(el)) continue;
      const w = wireFromShorthand(el as Record<string, unknown>, wires.length);
      if (w) wires.push(w);
    }
    return wires.length > 0 ? wires : null;
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const w = wireFromShorthand(parsed as Record<string, unknown>, 0);
    return w ? [w] : null;
  }
  return null;
}

type SpanMatch = { start: number; end: number; wires: ToolCallWire[] };

function collectSpanMatches(work: string): SpanMatch[] {
  const out: SpanMatch[] = [];

  const trimmed = work.trim();
  if (trimmed.length > 0) {
    try {
      const parsed = JSON.parse(trimmed);
      const wires = wiresFromParsed(parsed);
      if (wires) {
        const start = work.indexOf(trimmed);
        if (start >= 0) {
          out.push({ start, end: start + trimmed.length, wires });
        }
      }
    } catch {
      /* scan below */
    }
  }

  for (let i = 0; i < work.length; i++) {
    if (work[i] === "{") {
      const end = findBalancedBraceEnd(work, i);
      if (end === null) continue;
      const slice = work.slice(i, end + 1);
      try {
        const parsed = JSON.parse(slice);
        const wires = wiresFromParsed(parsed);
        if (wires) out.push({ start: i, end: end + 1, wires });
      } catch {
        /* skip */
      }
    } else if (work[i] === "[") {
      const end = findBalancedBracketEnd(work, i, "[", "]");
      if (end === null) continue;
      const slice = work.slice(i, end + 1);
      try {
        const parsed = JSON.parse(slice);
        const wires = wiresFromParsed(parsed);
        if (wires) out.push({ start: i, end: end + 1, wires });
      } catch {
        /* skip */
      }
    }
  }

  return out;
}

/**
 * When the model prints tool intent as assistant text instead of OpenAI `tool_calls`,
 * parse a strict subset into `ToolCallWire[]` and return prose-only `displayText`.
 */
export function tryRecoverToolCallsFromAssistantText(text: string): {
  toolCalls: ToolCallWire[];
  displayText: string;
} {
  const work = unwrapCodeFences(text);
  const matches = collectSpanMatches(work);
  if (matches.length === 0) {
    return { toolCalls: [], displayText: text };
  }

  const last = matches.reduce((a, b) => (a.end > b.end ? a : b));
  const before = work.slice(0, last.start).trimEnd();
  const after = work.slice(last.end).trimStart();
  let displayText = [before, after].filter((p) => p.length > 0).join("\n\n").trim();

  if (!displayText && work.trim() === work.slice(last.start, last.end).trim()) {
    displayText = "";
  }

  return { toolCalls: last.wires, displayText };
}