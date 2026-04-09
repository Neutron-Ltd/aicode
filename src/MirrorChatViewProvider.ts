import * as vscode from "vscode";
import type { ApiService } from "./services/ApiService";
import type { AuthService } from "./services/AuthService";
import type { EditorService } from "./services/EditorService";
import type { PromptBuilderService } from "./services/PromptBuilderService";
import type { WorkspaceScannerService } from "./services/WorkspaceScannerService";
import {
  parseWebviewMessage,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from "./shared/messages";

/**
 * Sidebar webview for Mirror chat UI (React + Tailwind build in /media).
 */
export class MirrorChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "mirror.chat";

  private _webview: vscode.Webview | undefined;
  private _auth: AuthService | undefined;
  private _editorService: EditorService | undefined;
  /** Used by ApiService in Chunk 6. */
  private _promptBuilder: PromptBuilderService | undefined;
  private _api: ApiService | undefined;
  private _workspaceScanner: WorkspaceScannerService | undefined;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  /** Wired after construction so AuthService can post via this method. */
  setAuthService(auth: AuthService): void {
    this._auth = auth;
  }

  setEditorService(editor: EditorService): void {
    this._editorService = editor;
  }

  setPromptBuilderService(service: PromptBuilderService): void {
    this._promptBuilder = service;
  }

  setApiService(api: ApiService): void {
    this._api = api;
  }

  setWorkspaceScannerService(scanner: WorkspaceScannerService): void {
    this._workspaceScanner = scanner;
  }

  /** Post a host→webview protocol message (e.g. LOGIN_SUCCESS from OAuth). */
  postHostMessage(msg: HostToWebviewMessage): void {
    void this._webview?.postMessage(msg);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    const { webview } = webviewView;
    this._webview = webview;

    const extensionUri = this._context.extensionUri;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    };

    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "media", "webview.css")
    );

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    webview.html = getHtmlForWebview(csp, nonce, scriptUri, styleUri);

    this._context.subscriptions.push(
      webview.onDidReceiveMessage((raw: unknown) => {
        const msg = parseWebviewMessage(raw);
        if (msg) {
          this._handleWebviewMessage(msg);
        }
      })
    );

    void this._auth?.tryRestoreSession();
  }

  private _handleWebviewMessage(msg: WebviewToHostMessage): void {
    const w = this._webview;
    if (!w) return;

    switch (msg.type) {
      case "PING":
        void w.postMessage({
          type: "PONG",
          payload: {
            ts: Date.now(),
            clientTs: msg.payload.clientTs,
          },
        });
        break;
      case "REQUIRE_LOGIN":
        void this._auth?.startOAuthLogin();
        break;
      case "LOGIN_REQUEST": {
        const auth = this._auth;
        if (!auth) {
          void w.postMessage({
            type: "AUTH_ERROR",
            payload: { message: "Auth service not ready." },
          });
          break;
        }
        const { email, password } = msg.payload;
        void auth.loginUser(email, password).catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Sign-in failed.";
          void w.postMessage({ type: "AUTH_ERROR", payload: { message } });
        });
        break;
      }
      case "REGISTER_REQUEST": {
        const auth = this._auth;
        if (!auth) {
          void w.postMessage({
            type: "AUTH_ERROR",
            payload: { message: "Auth service not ready." },
          });
          break;
        }
        const { email, password } = msg.payload;
        void auth.registerUser(email, password).catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Registration failed.";
          void w.postMessage({ type: "AUTH_ERROR", payload: { message } });
        });
        break;
      }
      case "SEND_MESSAGE": {
        const api = this._api;
        if (!api) {
          const message = "Chat API not ready.";
          void vscode.window.showErrorMessage(`Mirror AI: ${message}`);
          void w.postMessage({ type: "CHAT_ERROR", payload: { message } });
          break;
        }
        const { text, modelId } = msg.payload;
        void api.sendChatMessage(text, modelId).catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Chat request failed.";
          void w.postMessage({ type: "CHAT_ERROR", payload: { message } });
        });
        break;
      }
      case "INSERT_CODE":
        void this._insertCodeAtCursor(msg.payload.code);
        break;
      case "LOGOUT_REQUEST": {
        const auth = this._auth;
        if (!auth) {
          void w.postMessage({
            type: "AUTH_ERROR",
            payload: { message: "Auth service not ready." },
          });
          break;
        }
        void auth.logout().catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Sign out failed.";
          void w.postMessage({ type: "AUTH_ERROR", payload: { message } });
        });
        break;
      }
      case "INDEX_WORKSPACE": {
        const scanner = this._workspaceScanner;
        if (!scanner) {
          void w.postMessage({
            type: "INDEX_ERROR",
            payload: { message: "Workspace scanner not ready." },
          });
          break;
        }
        void scanner.indexWorkspace().catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Workspace indexing failed.";
          void w.postMessage({ type: "INDEX_ERROR", payload: { message } });
        });
        break;
      }
    }
  }

  private async _insertCodeAtCursor(code: string): Promise<void> {
    const editorService = this._editorService;
    if (!editorService) {
      void vscode.window.showWarningMessage("Mirror AI: Editor service not ready.");
      return;
    }

    const ok = await editorService.applyCodeFromChat(code);
    if (!ok) {
      void vscode.window.showWarningMessage(
        "Mirror AI: No active editor — open a file to insert code."
      );
    }
  }
}

function getHtmlForWebview(
  csp: string,
  nonce: string,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Mirror AI</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
