import { create } from "zustand";
import type { HostToWebviewMessage } from "../../../src/shared/messages";
import { postToHost } from "../vscodeApi";
import { DEFAULT_CHAT_MODEL_ID, type ChatMessage } from "../types/chat";

export type PendingToolPlan = {
  planId: string;
  steps: Array<{
    id: string;
    tool: string;
    path?: string;
    summary: string;
  }>;
};

/** Live status during approved tool execution (`MUTATION_PROGRESS` from host). */
export type MutationProgressState = {
  line: string;
  diffAwaiting: boolean;
};

export interface UltraState {
  isLoggedIn: boolean;
  /** From host `RUNTIME_CONFIG`; default matches VS Code default until first message. */
  runtimeMode: "Cloud" | "Workstation";
  workstationOnline: boolean;
  workstationCheckedAt: number | null;
  /** When private compute is offline: safe hint only (no URLs or hostnames). */
  computeStatusHint: "configure" | "unreachable" | "denied" | null;
  userLabel: string | null;
  userEmail: string | null;
  signingIn: boolean;
  /** Distinguishes GitHub OAuth vs email/password for loading UI. */
  pendingAuth: "none" | "oauth" | "password";
  authError: string | null;
  /** Chat / Edge / network errors (distinct from auth). */
  chatError: string | null;
  /** Upstream LLM unavailable (`CHAT_ERROR` with `kind: "maintenance"`). */
  serviceMaintenance: boolean;
  lastPongAt: number | null;
  lastPongClientTs: number | null;
  tokenQuota: number;
  /** False until first LOGIN_SUCCESS or UPDATE_QUOTA from host. */
  quotaReady: boolean;
  isIndexing: boolean;
  messages: ChatMessage[];
  inputDraft: string;
  isSending: boolean;
  /** AI tool batch awaiting Confirm / Cancel in the webview. */
  pendingToolPlan: PendingToolPlan | null;
  /** Per-tool execution line + optional diff-review hint (after plan confirmed). */
  mutationProgress: MutationProgressState | null;

  applyHostMessage: (msg: HostToWebviewMessage) => void;
  setInputDraft: (v: string) => void;
  sendPing: () => void;
  indexWorkspace: () => void;
  startGithubOAuth: () => void;
  submitLogin: (email: string, password: string) => void;
  submitRegister: (email: string, password: string) => void;
  sendUserMessage: () => void;
  requestInsertCode: (code: string) => void;
  clearChat: () => void;
  requestLogout: () => void;
  dismissChatError: () => void;
  dismissServiceMaintenance: () => void;
  confirmToolPlan: () => void;
  cancelToolPlan: () => void;
  requestRuntimeSync: () => void;
  focusEditorGroups: () => void;
}

export const useUltraStore = create<UltraState>((set, get) => ({
  isLoggedIn: false,
  runtimeMode: "Workstation",
  workstationOnline: false,
  workstationCheckedAt: null,
  computeStatusHint: null,
  userLabel: null,
  userEmail: null,
  signingIn: false,
  pendingAuth: "none",
  authError: null,
  chatError: null,
  serviceMaintenance: false,
  lastPongAt: null,
  lastPongClientTs: null,
  tokenQuota: 0,
  quotaReady: false,
  isIndexing: false,
  messages: [],
  inputDraft: "",
  isSending: false,
  pendingToolPlan: null,
  mutationProgress: null,

  applyHostMessage: (msg: HostToWebviewMessage) => {
    switch (msg.type) {
      case "PONG":
        set({
          lastPongAt: msg.payload.ts,
          lastPongClientTs:
            msg.payload.clientTs !== undefined ? msg.payload.clientTs : null,
        });
        break;
      case "RUNTIME_CONFIG":
        set({ runtimeMode: msg.payload.mode });
        break;
      case "WORKSTATION_STATUS":
        set({
          workstationOnline: msg.payload.online,
          workstationCheckedAt: msg.payload.checkedAt,
          computeStatusHint: msg.payload.hint ?? null,
        });
        break;
      case "LOGIN_SUCCESS":
        set({
          isLoggedIn: true,
          signingIn: false,
          pendingAuth: "none",
          authError: null,
          userLabel: msg.payload.displayName,
          userEmail: msg.payload.email ?? null,
          tokenQuota: msg.payload.tokenQuotaRemaining,
          quotaReady: true,
        });
        break;
      case "AUTH_ERROR":
        set({
          signingIn: false,
          pendingAuth: "none",
          authError: msg.payload.message,
        });
        break;
      case "UPDATE_QUOTA":
        set({ tokenQuota: msg.payload.remaining, quotaReady: true });
        break;
      case "INDEX_STARTED":
        set({ isIndexing: true, chatError: null, serviceMaintenance: false });
        break;
      case "INDEX_COMPLETE":
        set({ isIndexing: false, chatError: null, serviceMaintenance: false });
        break;
      case "INDEX_ERROR":
        set({
          isIndexing: false,
          chatError: msg.payload.message,
          serviceMaintenance: false,
        });
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
          serviceMaintenance: false,
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
          serviceMaintenance: false,
          mutationProgress: null,
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
            return {
              isSending: false,
              serviceMaintenance: false,
              mutationProgress: null,
            };
          }
          return {
            isSending: false,
            serviceMaintenance: false,
            mutationProgress: null,
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
        if (msg.payload.kind === "maintenance") {
          set((s) => {
            const messages = [...s.messages];
            const last = messages[messages.length - 1];
            if (
              last?.role === "assistant" &&
              !(last.content ?? "").trim()
            ) {
              messages.pop();
            }
            return {
              isSending: false,
              chatError: null,
              serviceMaintenance: true,
              mutationProgress: null,
              messages,
            };
          });
        } else {
          set({
            isSending: false,
            chatError: msg.payload.message,
            serviceMaintenance: false,
            mutationProgress: null,
          });
        }
        break;
      case "LOGGED_OUT":
        set({
          isLoggedIn: false,
          userLabel: null,
          userEmail: null,
          signingIn: false,
          pendingAuth: "none",
          authError: null,
          chatError: null,
          serviceMaintenance: false,
          isSending: false,
          isIndexing: false,
          messages: [],
          inputDraft: "",
          pendingToolPlan: null,
          mutationProgress: null,
          workstationOnline: false,
          workstationCheckedAt: null,
          computeStatusHint: null,
          tokenQuota: 0,
          quotaReady: false,
        });
        break;
      case "TOOL_PLAN_PENDING":
        set({
          pendingToolPlan: {
            planId: msg.payload.planId,
            steps: msg.payload.steps,
          },
          mutationProgress: null,
        });
        break;
      case "TOOL_PLAN_CLEARED":
        set((s) =>
          s.pendingToolPlan?.planId === msg.payload.planId
            ? { pendingToolPlan: null }
            : {}
        );
        break;
      case "MUTATION_PROGRESS": {
        const line = msg.payload.line;
        if (line === "") {
          set({ mutationProgress: null });
        } else {
          set({
            mutationProgress: {
              line,
              diffAwaiting: Boolean(msg.payload.diffAwaiting),
            },
          });
        }
        break;
      }
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

  startGithubOAuth: () => {
    set({ signingIn: true, pendingAuth: "oauth", authError: null });
    postToHost({ type: "REQUIRE_LOGIN" });
  },

  submitLogin: (email: string, password: string) => {
    set({ signingIn: true, pendingAuth: "password", authError: null });
    postToHost({
      type: "LOGIN_REQUEST",
      payload: { email, password },
    });
  },

  submitRegister: (email: string, password: string) => {
    set({ signingIn: true, pendingAuth: "password", authError: null });
    postToHost({
      type: "REGISTER_REQUEST",
      payload: { email, password },
    });
  },

  sendUserMessage: () => {
    const { inputDraft, pendingToolPlan, quotaReady, tokenQuota } = get();
    if (pendingToolPlan) return;
    if (!quotaReady || tokenQuota <= 0) return;
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
      serviceMaintenance: false,
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
    set({
      messages: [],
      chatError: null,
      serviceMaintenance: false,
      pendingToolPlan: null,
      mutationProgress: null,
    });
  },

  requestLogout: () => {
    postToHost({ type: "LOGOUT_REQUEST" });
  },

  dismissChatError: () => set({ chatError: null }),

  dismissServiceMaintenance: () => set({ serviceMaintenance: false }),

  confirmToolPlan: () => {
    const plan = get().pendingToolPlan;
    if (!plan) return;
    postToHost({
      type: "TOOL_PLAN_CONFIRM",
      payload: { planId: plan.planId },
    });
  },

  cancelToolPlan: () => {
    const plan = get().pendingToolPlan;
    if (!plan) return;
    postToHost({
      type: "TOOL_PLAN_CANCEL",
      payload: { planId: plan.planId },
    });
  },

  requestRuntimeSync: () => {
    postToHost({ type: "REQUEST_RUNTIME_SYNC" });
  },

  focusEditorGroups: () => {
    postToHost({ type: "FOCUS_EDITOR_GROUPS" });
  },
}));
