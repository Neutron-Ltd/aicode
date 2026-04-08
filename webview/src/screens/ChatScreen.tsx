import React from "react";
import { Header } from "../components/chat/Header";
import { InputArea } from "../components/chat/InputArea";
import { MessageList } from "../components/chat/MessageList";
import { MODEL_OPTIONS } from "../types/chat";
import { useMirrorStore } from "../store/mirrorStore";

export function ChatScreen(): React.ReactElement {
  const selectedModelId = useMirrorStore((s) => s.selectedModelId);
  const setSelectedModelId = useMirrorStore((s) => s.setSelectedModelId);
  const tokenQuota = useMirrorStore((s) => s.tokenQuota);
  const messages = useMirrorStore((s) => s.messages);
  const inputDraft = useMirrorStore((s) => s.inputDraft);
  const setInputDraft = useMirrorStore((s) => s.setInputDraft);
  const sendUserMessage = useMirrorStore((s) => s.sendUserMessage);
  const isSending = useMirrorStore((s) => s.isSending);
  const requestInsertCode = useMirrorStore((s) => s.requestInsertCode);
  const sendPing = useMirrorStore((s) => s.sendPing);
  const lastPongAt = useMirrorStore((s) => s.lastPongAt);
  const userLabel = useMirrorStore((s) => s.userLabel);
  const userEmail = useMirrorStore((s) => s.userEmail);
  const chatError = useMirrorStore((s) => s.chatError);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-mirror-surface">
      <Header
        models={MODEL_OPTIONS}
        selectedModelId={selectedModelId}
        onModelChange={setSelectedModelId}
        tokenQuota={tokenQuota}
        lastPongAt={lastPongAt}
        onPing={sendPing}
        userLabel={userLabel}
        userEmail={userEmail}
      />
      {chatError ? (
        <div
          className="shrink-0 border-b px-3 py-2 text-xs"
          style={{
            color: "var(--vscode-errorForeground)",
            backgroundColor: "var(--vscode-inputValidation-errorBackground)",
            borderColor: "var(--vscode-inputValidation-errorBorder)",
          }}
          role="alert"
        >
          {chatError}
        </div>
      ) : null}
      <MessageList messages={messages} onApplyCode={requestInsertCode} />
      <InputArea
        value={inputDraft}
        onChange={setInputDraft}
        onSend={sendUserMessage}
        disabled={isSending}
      />
    </div>
  );
}
