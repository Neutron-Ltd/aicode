import React from "react";
import { createRoot } from "react-dom/client";
import { initHostMessageBridge } from "./bridge/initHostBridge";
import { initWebviewPosthog } from "./initPosthog";
import { App } from "./App";

initHostMessageBridge();
initWebviewPosthog();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
