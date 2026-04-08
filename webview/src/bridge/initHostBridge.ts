import { parseHostMessage } from "../../../src/shared/messages";
import { useMirrorStore } from "../store/mirrorStore";

let bridgeInitialized = false;

/**
 * Single subscription to `window.message` (host → webview). Safe under React StrictMode.
 */
export function initHostMessageBridge(): void {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = parseHostMessage(event.data);
    if (msg) {
      useMirrorStore.getState().applyHostMessage(msg);
    }
  });
}
