import posthog from "posthog-js";
import { POSTHOG_WEBVIEW_HOST, POSTHOG_WEBVIEW_KEY } from "./posthogConfig";

export function initWebviewPosthog(): void {
  const key = POSTHOG_WEBVIEW_KEY.trim();
  if (!key) {
    return;
  }

  posthog.init(key, {
    api_host: POSTHOG_WEBVIEW_HOST,
    persistence: "memory",
    autocapture: false,
    disable_session_recording: true,
  });
  posthog.capture("webview_loaded");
}
