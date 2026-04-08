import type { WebviewToHostMessage } from "../../src/shared/messages";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let api: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVsCodeApi(): ReturnType<typeof acquireVsCodeApi> {
  if (api === null) {
    api = acquireVsCodeApi();
  }
  return api;
}

export function postToHost(message: WebviewToHostMessage): void {
  getVsCodeApi().postMessage(message);
}
