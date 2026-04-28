import * as vscode from "vscode";
import { BuildUltraSettings } from "./buildUltraSettings";
import { ApiService } from "./services/ApiService";
import { AuthService } from "./services/AuthService";
import { EditorService } from "./services/EditorService";
import { PromptBuilderService } from "./services/PromptBuilderService";
import { TerminalService } from "./services/TerminalService";
import { WorkspaceScannerService } from "./services/WorkspaceScannerService";
import { ToolExecutionService } from "./services/ToolExecutionService";
import { BuildUltraChatViewProvider } from "./BuildUltraChatViewProvider";
import { registerAiUndoTelemetry } from "./aiUndoTelemetry";
import { initExtensionTelemetry, shutdownExtensionTelemetry } from "./telemetry";
import { BuildUltraPreviewProvider } from "./virtualDocumentProvider";

export function activate(context: vscode.ExtensionContext): void {
  initExtensionTelemetry(context);
  const ultraSettings = new BuildUltraSettings(context);
  const editorService = new EditorService();
  const terminalService = new TerminalService();
  const promptBuilder = new PromptBuilderService(editorService, terminalService);

  const provider = new BuildUltraChatViewProvider(context, ultraSettings);
  const auth = new AuthService(
    context,
    (msg) => provider.postHostMessage(msg),
    ultraSettings,
    () => provider.refreshRuntimeAndWorkstationStatus()
  );
  const toolExecution = new ToolExecutionService(
    () => vscode.workspace.workspaceFolders?.[0]?.uri ?? null
  );
  const previewProvider = new BuildUltraPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "buildultra-preview",
      previewProvider
    )
  );
  const api = new ApiService(
    ultraSettings,
    auth,
    promptBuilder,
    toolExecution,
    previewProvider,
    (msg) => provider.postHostMessage(msg)
  );
  const scanner = new WorkspaceScannerService(
    auth,
    (msg) => provider.postHostMessage(msg),
    ultraSettings
  );
  provider.setAuthService(auth);
  provider.setApiService(api);
  provider.setWorkspaceScannerService(scanner);
  provider.setEditorService(editorService);
  provider.setPromptBuilderService(promptBuilder);

  const saveDebounceMs = 2500;
  const saveDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  context.subscriptions.push({
    dispose: () => {
      for (const t of saveDebounceTimers.values()) {
        clearTimeout(t);
      }
      saveDebounceTimers.clear();
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const key = doc.uri.toString();
      const prev = saveDebounceTimers.get(key);
      if (prev) {
        clearTimeout(prev);
      }
      const handle = setTimeout(() => {
        saveDebounceTimers.delete(key);
        void scanner.indexDocumentOnSave(doc);
      }, saveDebounceMs);
      saveDebounceTimers.set(key, handle);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildUltra.setWorkstationApiKey", () =>
      ultraSettings.promptAndStorePrivateComputeApiKey()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("buildUltra.linkWorkstationHost", () =>
      void auth.linkPrivateComputeToAccount()
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("buildUltra")) {
        provider.refreshRuntimeAndWorkstationStatus();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BuildUltraChatViewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );
  context.subscriptions.push(terminalService);
  context.subscriptions.push(registerAiUndoTelemetry());
}

export function deactivate(): Thenable<void> | void {
  return shutdownExtensionTelemetry();
}
