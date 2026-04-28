import * as vscode from "vscode";

export const WORKSTATION_API_KEY_SECRET = "buildUltra.workstationApiKey";

const CONFIG_SECTION = "buildUltra";

export type UltraRunMode = "Cloud" | "Workstation";

export class BuildUltraSettings {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get conf(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  getMode(): UltraRunMode {
    const m = this.conf.get<string>("mode");
    return m === "Cloud" ? "Cloud" : "Workstation";
  }

  isWorkstation(): boolean {
    return this.getMode() === "Workstation";
  }

  /** Host segment only; prefers `computeHost`, then legacy `localIp`. */
  private getConfiguredComputeHost(): string {
    const preferred = this.conf.get<string>("computeHost")?.trim() ?? "";
    if (preferred) {
      return preferred;
    }
    return this.conf.get<string>("localIp")?.trim() ?? "";
  }

  /** Base `http://host:8080` — no trailing slash. */
  getLocalBaseUrl(): string {
    const raw = this.getConfiguredComputeHost();
    if (!raw) {
      return "";
    }
    const host = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `http://${host}:8080`;
  }

  getChatCompletionsUrl(): string {
    const base = this.getLocalBaseUrl();
    return base ? `${base}/v1/chat/completions` : "";
  }

  getModelsUrl(): string {
    const base = this.getLocalBaseUrl();
    return base ? `${base}/v1/models` : "";
  }

  getLocalModelName(): string {
    return this.conf.get<string>("localModelName")?.trim() || "qwen2.5-coder:32b";
  }

  /**
   * When `modelId` from the webview is empty or `default`, use configured local model name.
   */
  getEffectiveModel(modelId: string): string {
    const t = modelId.trim();
    if (t && t !== "default") return t;
    return this.getLocalModelName();
  }

  async getWorkstationApiKey(): Promise<string> {
    const fromSecret = await this.context.secrets.get(WORKSTATION_API_KEY_SECRET);
    if (fromSecret?.trim()) return fromSecret.trim();
    return this.conf.get<string>("localApiKey")?.trim() ?? "";
  }

  async promptAndStorePrivateComputeApiKey(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: "Build Ultra — Private compute API key",
      prompt: "Stored securely. Sent as X-API-Key to your configured compute endpoint.",
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined) return;
    await this.context.secrets.store(WORKSTATION_API_KEY_SECRET, value.trim());
    void vscode.window.showInformationMessage(
      "Build Ultra: API key saved."
    );
  }
}
