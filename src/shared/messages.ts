/**
 * Typed webview ↔ extension host protocol (Chunk 3).
 * Keep payloads JSON-serializable (structured clone).
 */

export type WebviewToHostMessage =
  | { type: "PING"; payload: { clientTs?: number } }
  | { type: "LOGIN_REQUEST"; payload: { email: string; password: string } }
  | { type: "REGISTER_REQUEST"; payload: { email: string; password: string } }
  | { type: "SEND_MESSAGE"; payload: { text: string; modelId: string } }
  | { type: "INDEX_WORKSPACE" }
  | { type: "INSERT_CODE"; payload: { code: string } }
  | { type: "LOGOUT_REQUEST" }
  | { type: "TOOL_PLAN_CONFIRM"; payload: { planId: string } }
  | { type: "TOOL_PLAN_CANCEL"; payload: { planId: string } }
  | { type: "EDIT_REVIEW_APPROVE"; payload: { reviewId: string } }
  | { type: "EDIT_REVIEW_UNDO"; payload: { reviewId: string } }
  | { type: "REQUEST_RUNTIME_SYNC" }
  /** Bring keyboard focus to editor / diff area (mutation review). */
  | { type: "FOCUS_EDITOR_GROUPS" };

export type HostToWebviewMessage =
  | { type: "PONG"; payload: { ts: number; clientTs?: number } }
  | {
      type: "LOGIN_SUCCESS";
      payload: {
        displayName: string;
        email?: string;
        /** Remaining SaaS token quota after RLS read of `user_quotas`. */
        tokenQuotaRemaining: number;
      };
    }
  | { type: "AUTH_ERROR"; payload: { message: string } }
  | { type: "UPDATE_QUOTA"; payload: { remaining: number } }
  | {
      type: "RECEIVE_RESPONSE";
      payload: { id: string; content: string };
    }
  /** Start assistant message shell (Chunk 6 streaming). */
  | { type: "CHAT_STREAM_START"; payload: { id: string } }
  /** Append token/text to the assistant message with the given id. */
  | { type: "CHAT_STREAM_DELTA"; payload: { id: string; delta: string } }
  /** Replace full assistant message content (e.g. after stripping recovered tool JSON from streamed text). */
  | { type: "CHAT_ASSISTANT_CONTENT"; payload: { id: string; content: string } }
  /** Stream finished successfully. */
  | { type: "CHAT_STREAM_END"; payload: { id: string } }
  /** Chat / Edge / network failure (distinct from AUTH_ERROR). */
  | {
      type: "CHAT_ERROR";
      payload: { message: string; kind?: "maintenance" };
    }
  | { type: "INDEX_STARTED" }
  | { type: "INDEX_COMPLETE"; payload: { files: number; chunks: number } }
  | { type: "INDEX_ERROR"; payload: { message: string } }
  /** Session cleared after sign-out. */
  | { type: "LOGGED_OUT" }
  /** AI tool batch awaiting user confirmation in the webview. */
  | {
      type: "TOOL_PLAN_PENDING";
      payload: {
        planId: string;
        steps: Array<{
          id: string;
          tool: string;
          path?: string;
          summary: string;
        }>;
      };
    }
  /** Host cleared the plan banner (confirmed path or cancelled). */
  | { type: "TOOL_PLAN_CLEARED"; payload: { planId: string } }
  /** Live line during autonomous tool execution; empty `line` clears the banner. */
  | {
      type: "MUTATION_PROGRESS";
      payload: { line: string; diffAwaiting?: boolean };
    }
  | {
      type: "EDIT_REVIEW_PENDING";
      payload: { reviewId: string; relativePath: string };
    }
  | { type: "EDIT_REVIEW_CLEARED"; payload: { reviewId: string } }
  | {
      type: "RUNTIME_CONFIG";
      payload: {
        mode: "Cloud" | "Workstation";
      };
    }
  | {
      type: "WORKSTATION_STATUS";
      payload: {
        online: boolean;
        checkedAt: number;
        /** User-safe hint when `online` is false (no raw host/API details). */
        hint?: "configure" | "unreachable" | "denied";
      };
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseWebviewMessage(raw: unknown): WebviewToHostMessage | null {
  if (!isRecord(raw)) return null;
  const t = raw.type;
  if (typeof t !== "string") return null;

  switch (t) {
    case "PING": {
      const p = raw.payload;
      let clientTs: number | undefined;
      if (isRecord(p) && typeof p.clientTs === "number") clientTs = p.clientTs;
      return { type: "PING", payload: { clientTs } };
    }
    case "LOGIN_REQUEST": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const email =
        typeof p.email === "string" ? p.email.trim() : "";
      const password = typeof p.password === "string" ? p.password : "";
      if (!email || !password) return null;
      return { type: "LOGIN_REQUEST", payload: { email, password } };
    }
    case "REGISTER_REQUEST": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const email =
        typeof p.email === "string" ? p.email.trim() : "";
      const password = typeof p.password === "string" ? p.password : "";
      if (!email || !password) return null;
      return { type: "REGISTER_REQUEST", payload: { email, password } };
    }
    case "INDEX_WORKSPACE":
      return { type: "INDEX_WORKSPACE" };
    case "SEND_MESSAGE": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const text = p.text;
      const modelId = p.modelId;
      if (typeof text !== "string" || typeof modelId !== "string") return null;
      return { type: "SEND_MESSAGE", payload: { text, modelId } };
    }
    case "INSERT_CODE": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const code = p.code;
      if (typeof code !== "string") return null;
      return { type: "INSERT_CODE", payload: { code } };
    }
    case "LOGOUT_REQUEST":
      return { type: "LOGOUT_REQUEST" };
    case "TOOL_PLAN_CONFIRM": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const planId = p.planId;
      if (typeof planId !== "string") return null;
      return { type: "TOOL_PLAN_CONFIRM", payload: { planId } };
    }
    case "TOOL_PLAN_CANCEL": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const planId = p.planId;
      if (typeof planId !== "string") return null;
      return { type: "TOOL_PLAN_CANCEL", payload: { planId } };
    }
    case "EDIT_REVIEW_APPROVE": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const reviewId = p.reviewId;
      if (typeof reviewId !== "string") return null;
      return { type: "EDIT_REVIEW_APPROVE", payload: { reviewId } };
    }
    case "EDIT_REVIEW_UNDO": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const reviewId = p.reviewId;
      if (typeof reviewId !== "string") return null;
      return { type: "EDIT_REVIEW_UNDO", payload: { reviewId } };
    }
    case "REQUEST_RUNTIME_SYNC":
      return { type: "REQUEST_RUNTIME_SYNC" };
    case "FOCUS_EDITOR_GROUPS":
      return { type: "FOCUS_EDITOR_GROUPS" };
    default:
      return null;
  }
}

export function parseHostMessage(raw: unknown): HostToWebviewMessage | null {
  if (!isRecord(raw)) return null;
  const t = raw.type;
  if (typeof t !== "string") return null;

  switch (t) {
    case "PONG": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const ts = p.ts;
      if (typeof ts !== "number") return null;
      let clientTs: number | undefined;
      if (typeof p.clientTs === "number") clientTs = p.clientTs;
      return { type: "PONG", payload: { ts, clientTs } };
    }
    case "LOGIN_SUCCESS": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const displayName = p.displayName;
      if (typeof displayName !== "string") return null;
      let email: string | undefined;
      if (typeof p.email === "string") email = p.email;
      let tokenQuotaRemaining = 0;
      if (typeof p.tokenQuotaRemaining === "number" && Number.isFinite(p.tokenQuotaRemaining)) {
        tokenQuotaRemaining = Math.max(0, Math.floor(p.tokenQuotaRemaining));
      }
      return {
        type: "LOGIN_SUCCESS",
        payload: { displayName, email, tokenQuotaRemaining },
      };
    }
    case "AUTH_ERROR": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const message = p.message;
      if (typeof message !== "string") return null;
      return { type: "AUTH_ERROR", payload: { message } };
    }
    case "UPDATE_QUOTA": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const remaining = p.remaining;
      if (typeof remaining !== "number") return null;
      return { type: "UPDATE_QUOTA", payload: { remaining } };
    }
    case "RECEIVE_RESPONSE": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const id = p.id;
      const content = p.content;
      if (typeof id !== "string" || typeof content !== "string") return null;
      return { type: "RECEIVE_RESPONSE", payload: { id, content } };
    }
    case "CHAT_STREAM_START": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const id = p.id;
      if (typeof id !== "string") return null;
      return { type: "CHAT_STREAM_START", payload: { id } };
    }
    case "CHAT_STREAM_DELTA": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const id = p.id;
      const delta = p.delta;
      if (typeof id !== "string" || typeof delta !== "string") return null;
      return { type: "CHAT_STREAM_DELTA", payload: { id, delta } };
    }
    case "CHAT_ASSISTANT_CONTENT": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const id = p.id;
      const content = p.content;
      if (typeof id !== "string" || typeof content !== "string") return null;
      return { type: "CHAT_ASSISTANT_CONTENT", payload: { id, content } };
    }
    case "CHAT_STREAM_END": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const id = p.id;
      if (typeof id !== "string") return null;
      return { type: "CHAT_STREAM_END", payload: { id } };
    }
    case "CHAT_ERROR": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const message = p.message;
      if (typeof message !== "string") return null;
      const kind = p.kind;
      if (kind !== undefined && kind !== "maintenance") return null;
      return {
        type: "CHAT_ERROR",
        payload:
          kind === "maintenance"
            ? { message, kind: "maintenance" }
            : { message },
      };
    }
    case "INDEX_STARTED":
      return { type: "INDEX_STARTED" };
    case "INDEX_COMPLETE": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const files = p.files;
      const chunks = p.chunks;
      if (typeof files !== "number" || typeof chunks !== "number") return null;
      return { type: "INDEX_COMPLETE", payload: { files, chunks } };
    }
    case "INDEX_ERROR": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const message = p.message;
      if (typeof message !== "string") return null;
      return { type: "INDEX_ERROR", payload: { message } };
    }
    case "LOGGED_OUT":
      return { type: "LOGGED_OUT" };
    case "TOOL_PLAN_PENDING": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const planId = p.planId;
      const steps = p.steps;
      if (typeof planId !== "string" || !Array.isArray(steps)) return null;
      const out: Array<{
        id: string;
        tool: string;
        path?: string;
        summary: string;
      }> = [];
      for (const s of steps) {
        if (!isRecord(s)) return null;
        const id = s.id;
        const tool = s.tool;
        const summary = s.summary;
        if (typeof id !== "string" || typeof tool !== "string" || typeof summary !== "string") {
          return null;
        }
        let path: string | undefined;
        if (typeof s.path === "string") path = s.path;
        out.push({ id, tool, path, summary });
      }
      return { type: "TOOL_PLAN_PENDING", payload: { planId, steps: out } };
    }
    case "TOOL_PLAN_CLEARED": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const planId = p.planId;
      if (typeof planId !== "string") return null;
      return { type: "TOOL_PLAN_CLEARED", payload: { planId } };
    }
    case "MUTATION_PROGRESS": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const line = p.line;
      if (typeof line !== "string") return null;
      const diffAwaiting = p.diffAwaiting === true;
      return { type: "MUTATION_PROGRESS", payload: { line, diffAwaiting } };
    }
    case "EDIT_REVIEW_PENDING": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const reviewId = p.reviewId;
      const relativePath = p.relativePath;
      if (typeof reviewId !== "string" || typeof relativePath !== "string") return null;
      return { type: "EDIT_REVIEW_PENDING", payload: { reviewId, relativePath } };
    }
    case "EDIT_REVIEW_CLEARED": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const reviewId = p.reviewId;
      if (typeof reviewId !== "string") return null;
      return { type: "EDIT_REVIEW_CLEARED", payload: { reviewId } };
    }
    case "RUNTIME_CONFIG": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const mode = p.mode;
      if (mode !== "Cloud" && mode !== "Workstation") return null;
      return { type: "RUNTIME_CONFIG", payload: { mode } };
    }
    case "WORKSTATION_STATUS": {
      const p = raw.payload;
      if (!isRecord(p)) return null;
      const online = p.online;
      const checkedAt = p.checkedAt;
      if (typeof online !== "boolean" || typeof checkedAt !== "number") return null;
      const rawHint = p.hint;
      let hint: "configure" | "unreachable" | "denied" | undefined;
      if (rawHint === "configure" || rawHint === "unreachable" || rawHint === "denied") {
        hint = rawHint;
      }
      return {
        type: "WORKSTATION_STATUS",
        payload: { online, checkedAt, hint },
      };
    }
    default:
      return null;
  }
}
