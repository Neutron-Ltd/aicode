import React, { useState } from "react";
/**
 * Assistant text streams from the extension host (SSE) into the Zustand store via
 * CHAT_STREAM_DELTA (Ultra AI) — partial chunks are not applied with local useState here.
 */
import { ChatErrorBanner } from "../components/chat/ChatErrorBanner";
import { Header } from "../components/chat/Header";
import { InputArea } from "../components/chat/InputArea";
import { MessageList } from "../components/chat/MessageList";
import { MutationBanner } from "../components/chat/MutationBanner";
import { SettingsPanel } from "../components/chat/SettingsPanel";
import { EditReviewBanner } from "../components/chat/EditReviewBanner";
import { WorkstationConnectionFooter } from "../components/chat/WorkstationConnectionFooter";
import { useUltraStore } from "../store/ultraStore";

export function ChatScreen(): React.ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tokenQuota = useUltraStore((s) => s.tokenQuota);
  const quotaReady = useUltraStore((s) => s.quotaReady);
  const messages = useUltraStore((s) => s.messages);
  const inputDraft = useUltraStore((s) => s.inputDraft);
  const setInputDraft = useUltraStore((s) => s.setInputDraft);
  const sendUserMessage = useUltraStore((s) => s.sendUserMessage);
  const isSending = useUltraStore((s) => s.isSending);
  const requestInsertCode = useUltraStore((s) => s.requestInsertCode);
  const indexWorkspace = useUltraStore((s) => s.indexWorkspace);
  const isIndexing = useUltraStore((s) => s.isIndexing);
  const userLabel = useUltraStore((s) => s.userLabel);
  const userEmail = useUltraStore((s) => s.userEmail);
  const chatError = useUltraStore((s) => s.chatError);
  const clearChat = useUltraStore((s) => s.clearChat);
  const requestLogout = useUltraStore((s) => s.requestLogout);
  const dismissChatError = useUltraStore((s) => s.dismissChatError);
  const mutationProgress = useUltraStore((s) => s.mutationProgress);
  const pendingEditReview = useUltraStore((s) => s.pendingEditReview);
  const approveEditReview = useUltraStore((s) => s.approveEditReview);
  const undoEditReview = useUltraStore((s) => s.undoEditReview);
  const runtimeMode = useUltraStore((s) => s.runtimeMode);

  const clearChatDisabled =
    messages.length === 0 || isSending;

  const inputDisabled =
    !quotaReady || (quotaReady && tokenQuota <= 0) || isSending;

  const inputPlaceholder =
    !quotaReady
      ? "Loading quota…"
      : tokenQuota <= 0
        ? "Token quota exhausted."
        : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ultra-surface">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.22), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(139, 92, 246, 0.12), transparent)",
        }}
        aria-hidden
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="relative z-20 shrink-0">
          <Header
            onIndexWorkspace={indexWorkspace}
            isIndexing={isIndexing}
            onClearChat={clearChat}
            clearChatDisabled={clearChatDisabled}
            onOpenSettings={() => setSettingsOpen(true)}
            indexWorkspaceDisabled={runtimeMode === "Workstation"}
          />
          {settingsOpen ? (
            <SettingsPanel
              userLabel={userLabel}
              userEmail={userEmail}
              tokenQuota={tokenQuota}
              onLogout={requestLogout}
              onClose={() => setSettingsOpen(false)}
              showCloudQuota={true}
            />
          ) : null}
        </div>
        {chatError ? (
          <ChatErrorBanner message={chatError} onDismiss={dismissChatError} />
        ) : null}
        {mutationProgress ? (
          <MutationBanner progress={mutationProgress} />
        ) : null}
        {pendingEditReview ? (
          <EditReviewBanner
            relativePath={pendingEditReview.relativePath}
            onApprove={approveEditReview}
            onUndo={undoEditReview}
          />
        ) : null}
        <MessageList
          messages={messages}
          onApplyCode={requestInsertCode}
          isSending={isSending}
        />
        <InputArea
          value={inputDraft}
          onChange={setInputDraft}
          onSend={sendUserMessage}
          disabled={inputDisabled}
          placeholder={inputPlaceholder}
        />
        <WorkstationConnectionFooter />
      </div>
    </div>
  );
}
