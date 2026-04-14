import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { PostHog } from "posthog-node";
import { POSTHOG_API_KEY, POSTHOG_HOST } from "./config";

const DISTINCT_KEY = "buildUltra.posthogDistinctId";

let client: PostHog | null = null;

/**
 * PostHog for the extension host. Disabled when `POSTHOG_API_KEY` is empty.
 * Telemetry is opt-in via configuration (set keys before shipping).
 */
export function initExtensionTelemetry(context: vscode.ExtensionContext): void {
  const key = POSTHOG_API_KEY.trim();
  if (!key) {
    return;
  }

  let distinctId = context.globalState.get<string>(DISTINCT_KEY);
  if (!distinctId) {
    distinctId = randomUUID();
    void context.globalState.update(DISTINCT_KEY, distinctId);
  }

  client = new PostHog(key, { host: POSTHOG_HOST.trim() || "https://us.i.posthog.com" });
  client.capture({ distinctId, event: "extension_activated" });
}

export async function shutdownExtensionTelemetry(): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.flush();
  } finally {
    client = null;
  }
}
