import { create } from "zustand";
import type { HostToWebviewMessage } from "../../../src/shared/messages";
import { postToHost } from "../vscodeApi";
import { DEFAULT_CHAT_MODEL_ID, type ChatMessage } from "../types/chat";

export interface UltraState {
  isLoggedIn: boolean;
  userLabel: string | null;
  userEmail: string | null;
  signingIn: boolean;
  authError: string | null;
  /** Chat / Edge / network errors (distinct from auth). */
  chatError: string | null;
  lastPongAt: number | null;
  lastPongClientTs: number | null;
  tokenQuota: number;
  isIndexing: boolean;
  messages: ChatMessage[];
  inputDraft: string;
  isSending: boolean;

  applyHostMessage: (msg: HostToWebviewMessage) => void;
  setInputDraft: (v: string) => void;
  sendPing: () => void;
  indexWorkspace: () => void;
  submitLogin: (email: string, password: string) => void;
  submitRegister: (email: string, password: string) => void;
  sendUserMessage: () => void;
  requestInsertCode: (code: string) => void;
  clearChat: () => void;
  requestLogout: () => void;
  dismissChatError: () => void;
}

export const useUltraStore = create<UltraState>((set, get) => ({
  isLoggedIn: false,
  userLabel: null,
  userEmail: null,
  signingIn: false,
  authError: null,
  chatError: null,
  lastPongAt: null,
  lastPongClientTs: null,
  tokenQuota: 142_000,
  isIndexing: false,
  messages: [],
  inputDraft: "",
  isSending: false,

  applyHostMessage: (msg: HostToWebviewMessage) => {
    switch (msg.type) {
      case "PONG":
        set({
          lastPongAt: msg.payload.ts,
          lastPongClientTs:
            msg.payload.clientTs !== undefined ? msg.payload.clientTs : null,
        });
        break;
      case "LOGIN_SUCCESS":
        set({
          isLoggedIn: true,
          signingIn: false,
          authError: null,
          userLabel: msg.payload.displayName,
          userEmail: msg.payload.email ?? null,
        });
        break;
      case "AUTH_ERROR":
        set({ signingIn: false, authError: msg.payload.message });
        break;
      case "UPDATE_QUOTA":
        set({ tokenQuota: msg.payload.remaining });
        break;
      case "INDEX_STARTED":
        set({ isIndexing: true, chatError: null });
        break;
      case "INDEX_COMPLETE":
        set({ isIndexing: false, chatError: null });
        break;
      case "INDEX_ERROR":
        set({ isIndexing: false, chatError: msg.payload.message });
        break;
      case "RECEIVE_RESPONSE":
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: msg.payload.id,
              role: "assistant" as const,
              content: msg.payload.content,
            },
          ],
          isSending: false,
          chatError: null,
        }));
        break;
      case "CHAT_STREAM_START":
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: msg.payload.id,
              role: "assistant" as const,
              content: "",
            },
          ],
          chatError: null,
        }));
        break;
      case "CHAT_STREAM_DELTA":
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === msg.payload.id
              ? { ...m, content: m.content + msg.payload.delta }
              : m
          ),
        }));
        break;
      case "CHAT_STREAM_END":
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          const emptyAssistant =
            last?.role === "assistant" &&
            (last.content ?? "").trim().length === 0;
          if (!emptyAssistant) {
            return { isSending: false };
          }
          return {
            isSending: false,
            messages: s.messages.map((m, idx) =>
              idx === s.messages.length - 1 && m.role === "assistant"
                ? {
                    ...m,
                    content:
                      "Ultra AI returned an empty response. Please try again.",
                  }
                : m
            ),
          };
        });
        break;
      case "CHAT_ERROR":
        set({
          isSending: false,
          chatError: msg.payload.message,
        });
        break;
      case "LOGGED_OUT":
        set({
          isLoggedIn: false,
          userLabel: null,
          userEmail: null,
          signingIn: false,
          authError: null,
          chatError: null,
          isSending: false,
          isIndexing: false,
          messages: [],
          inputDraft: "",
        });
        break;
    }
  },

  setInputDraft: (v: string) => set({ inputDraft: v }),

  sendPing: () => {
    postToHost({ type: "PING", payload: { clientTs: Date.now() } });
  },

  indexWorkspace: () => {
    set({ isIndexing: true, chatError: null });
    postToHost({ type: "INDEX_WORKSPACE" });
  },

  submitLogin: (email: string, password: string) => {
    set({ signingIn: true, authError: null });
    postToHost({
      type: "LOGIN_REQUEST",
      payload: { email, password },
    });
  },

  submitRegister: (email: string, password: string) => {
    set({ signingIn: true, authError: null });
    postToHost({
      type: "REGISTER_REQUEST",
      payload: { email, password },
    });
  },

  sendUserMessage: () => {
    const { inputDraft } = get();
    const text = inputDraft.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      inputDraft: "",
      isSending: true,
      chatError: null,
    }));

    postToHost({
      type: "SEND_MESSAGE",
      payload: { text, modelId: DEFAULT_CHAT_MODEL_ID },
    });
  },

  requestInsertCode: (code: string) => {
    postToHost({ type: "INSERT_CODE", payload: { code } });
  },

  clearChat: () => {
    set({ messages: [], chatError: null });
  },

  requestLogout: () => {
    postToHost({ type: "LOGOUT_REQUEST" });
  },

  dismissChatError: () => set({ chatError: null }),
}));
