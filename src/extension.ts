import * as vscode from "vscode";
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

export function activate(context: vscode.ExtensionContext): void {
  initExtensionTelemetry(context);
  const editorService = new EditorService();
  const terminalService = new TerminalService();
  const promptBuilder = new PromptBuilderService(editorService, terminalService);

  const provider = new BuildUltraChatViewProvider(context);
  const auth = new AuthService(context, (msg) => provider.postHostMessage(msg));
  const toolExecution = new ToolExecutionService(
    () => vscode.workspace.workspaceFolders?.[0]?.uri ?? null
  );
  const api = new ApiService(auth, promptBuilder, toolExecution, (msg) =>
    provider.postHostMessage(msg)
  );
  const scanner = new WorkspaceScannerService(auth, (msg) =>
    provider.postHostMessage(msg)
  );
  provider.setAuthService(auth);
  provider.setApiService(api);
  provider.setWorkspaceScannerService(scanner);
  provider.setEditorService(editorService);
  provider.setPromptBuilderService(promptBuilder);

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri: vscode.Uri) => auth.handleUri(uri),
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
