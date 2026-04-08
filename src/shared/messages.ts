/**
 * Typed webview ↔ extension host protocol (Chunk 3).
 * Keep payloads JSON-serializable (structured clone).
 */

export type WebviewToHostMessage =
  | { type: "PING"; payload: { clientTs?: number } }
  /** Legacy: opens browser OAuth (optional). */
  | { type: "REQUIRE_LOGIN" }
  | { type: "LOGIN_REQUEST"; payload: { email: string; password: string } }
  | { type: "REGISTER_REQUEST"; payload: { email: string; password: string } }
  | { type: "SEND_MESSAGE"; payload: { text: string; modelId: string } }
  | { type: "INDEX_WORKSPACE" }
  | { type: "INSERT_CODE"; payload: { code: string } }
  | { type: "LOGOUT_REQUEST" };

export type HostToWebviewMessage =
  | { type: "PONG"; payload: { ts: number; clientTs?: number } }
  | {
      type: "LOGIN_SUCCESS";
      payload: { displayName: string; email?: string };
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
  /** Stream finished successfully. */
  | { type: "CHAT_STREAM_END"; payload: { id: string } }
  /** Chat / Edge / network failure (distinct from AUTH_ERROR). */
  | { type: "CHAT_ERROR"; payload: { message: string } }
  | { type: "INDEX_STARTED" }
  | { type: "INDEX_COMPLETE"; payload: { files: number; chunks: number } }
  | { type: "INDEX_ERROR"; payload: { message: string } }
  /** Session cleared after sign-out. */
  | { type: "LOGGED_OUT" };

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
    case "REQUIRE_LOGIN":
      return { type: "REQUIRE_LOGIN" };
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
      return { type: "LOGIN_SUCCESS", payload: { displayName, email } };
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
      return { type: "CHAT_ERROR", payload: { message } };
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
    default:
      return null;
  }
}
