import React from "react";
import { ChatScreen } from "./screens/ChatScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { useUltraStore } from "./store/ultraStore";

export function App(): React.ReactElement {
  const isLoggedIn = useUltraStore((s) => s.isLoggedIn);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {isLoggedIn ? <ChatScreen /> : <LoginScreen />}
    </div>
  );
}
