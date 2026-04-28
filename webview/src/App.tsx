import React, { useEffect } from "react";
import { ChatScreen } from "./screens/ChatScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { useUltraStore } from "./store/ultraStore";

export function App(): React.ReactElement {
  const isLoggedIn = useUltraStore((s) => s.isLoggedIn);
  const requestRuntimeSync = useUltraStore((s) => s.requestRuntimeSync);
  const sendPing = useUltraStore((s) => s.sendPing);

  const showChat = isLoggedIn;

  useEffect(() => {
    sendPing();
    requestRuntimeSync();
  }, [sendPing, requestRuntimeSync]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {showChat ? <ChatScreen /> : <LoginScreen />}
    </div>
  );
}
