export type OpenAIChatMessage = Record<string, unknown>;

/** Normalizes messages for the upstream OpenAI chat API (tool follow-ups). */
export function sanitizeChatMessages(messages: OpenAIChatMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    if (typeof role !== "string") continue;

    if (role === "tool") {
      const content = typeof m.content === "string" ? m.content : " ";
      const tool_call_id = typeof m.tool_call_id === "string" ? m.tool_call_id : "";
      const entry: OpenAIChatMessage = {
        role: "tool",
        content: content.length ? content : " ",
        tool_call_id,
      };
      if (typeof m.name === "string") entry.name = m.name;
      out.push(entry);
      continue;
    }

    if (role !== "system" && role !== "user" && role !== "assistant") {
      continue;
    }

    const hasTools = Boolean(m.tool_calls);
    let content: string | null = typeof m.content === "string" ? m.content : null;
    if (role === "assistant" && hasTools && (content === null || content === "")) {
      const entry: OpenAIChatMessage = { role, content: null };
      entry.tool_calls = m.tool_calls;
      out.push(entry);
      continue;
    }
    const c = content ?? "";
    const entry: OpenAIChatMessage = { role, content: c.length ? c : " " };
    if (m.tool_calls) entry.tool_calls = m.tool_calls;
    if (typeof m.name === "string") entry.name = m.name;
    out.push(entry);
  }

  if (out.length === 0) {
    return [{ role: "user", content: " " }];
  }
  return out;
}
