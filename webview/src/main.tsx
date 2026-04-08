import React from "react";
import { createRoot } from "react-dom/client";
import { initHostMessageBridge } from "./bridge/initHostBridge";
import { App } from "./App";

initHostMessageBridge();

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
