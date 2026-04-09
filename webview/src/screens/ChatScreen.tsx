import React, { useState } from "react";
/**
 * Assistant text streams from the extension host (SSE) into the Zustand store via
 * CHAT_STREAM_DELTA — partial chunks are not applied with local useState here.
 */
import { ChatErrorBanner } from "../components/chat/ChatErrorBanner";
import { Header } from "../components/chat/Header";
import { InputArea } from "../components/chat/InputArea";
import { MessageList } from "../components/chat/MessageList";
import { SettingsPanel } from "../components/chat/SettingsPanel";
import { MODEL_OPTIONS } from "../types/chat";
import { useMirrorStore } from "../store/mirrorStore";

export function ChatScreen(): React.ReactElement {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedModelId = useMirrorStore((s) => s.selectedModelId);
  const setSelectedModelId = useMirrorStore((s) => s.setSelectedModelId);
  const tokenQuota = useMirrorStore((s) => s.tokenQuota);
  const messages = useMirrorStore((s) => s.messages);
  const inputDraft = useMirrorStore((s) => s.inputDraft);
  const setInputDraft = useMirrorStore((s) => s.setInputDraft);
  const sendUserMessage = useMirrorStore((s) => s.sendUserMessage);
  const isSending = useMirrorStore((s) => s.isSending);
  const requestInsertCode = useMirrorStore((s) => s.requestInsertCode);
  const indexWorkspace = useMirrorStore((s) => s.indexWorkspace);
  const isIndexing = useMirrorStore((s) => s.isIndexing);
  const userLabel = useMirrorStore((s) => s.userLabel);
  const userEmail = useMirrorStore((s) => s.userEmail);
  const chatError = useMirrorStore((s) => s.chatError);
  const clearChat = useMirrorStore((s) => s.clearChat);
  const requestLogout = useMirrorStore((s) => s.requestLogout);
  const dismissChatError = useMirrorStore((s) => s.dismissChatError);

  const clearChatDisabled =
    messages.length === 0 || isSending;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-mirror-surface">
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
            models={MODEL_OPTIONS}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            onIndexWorkspace={indexWorkspace}
            isIndexing={isIndexing}
            onClearChat={clearChat}
            clearChatDisabled={clearChatDisabled}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          {settingsOpen ? (
            <SettingsPanel
              userLabel={userLabel}
              userEmail={userEmail}
              tokenQuota={tokenQuota}
              onLogout={requestLogout}
              onClose={() => setSettingsOpen(false)}
            />
          ) : null}
        </div>
        {chatError ? (
          <ChatErrorBanner message={chatError} onDismiss={dismissChatError} />
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
          disabled={isSending}
        />
      </div>
    </div>
  );
}
