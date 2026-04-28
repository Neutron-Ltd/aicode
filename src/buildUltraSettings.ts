import * as vscode from "vscode";

export const WORKSTATION_API_KEY_SECRET = "buildUltra.workstationApiKey";

const CONFIG_SECTION = "buildUltra";

const CLOUD_COMPUTE_HOST_KEY = "buildUltra.cloudPrivateCompute.host";
const CLOUD_DEFAULT_MODEL_KEY = "buildUltra.cloudPrivateCompute.defaultModel";

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

  /** Persisted after Supabase sync; cleared on logout. */
  async setCloudPrivateComputeCache(
    computeHost: string | null,
    defaultModel: string | null
  ): Promise<void> {
    await this.context.globalState.update(
      CLOUD_COMPUTE_HOST_KEY,
      computeHost?.trim() ?? ""
    );
    await this.context.globalState.update(
      CLOUD_DEFAULT_MODEL_KEY,
      defaultModel?.trim() ?? ""
    );
  }

  async clearCloudPrivateComputeCache(): Promise<void> {
    await this.setCloudPrivateComputeCache(null, null);
  }

  private getCloudComputeHostRaw(): string {
    return (this.context.globalState.get<string>(CLOUD_COMPUTE_HOST_KEY) ?? "").trim();
  }

  private getCloudDefaultModelRaw(): string {
    return (this.context.globalState.get<string>(CLOUD_DEFAULT_MODEL_KEY) ?? "").trim();
  }

  /** Host segment only; VS Code settings override account-linked host. */
  private getConfiguredComputeHost(): string {
    const preferred = this.conf.get<string>("computeHost")?.trim() ?? "";
    if (preferred) {
      return preferred;
    }
    const legacy = this.conf.get<string>("localIp")?.trim() ?? "";
    if (legacy) {
      return legacy;
    }
    return this.getCloudComputeHostRaw();
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
    const ins = this.conf.inspect<string>("localModelName");
    if (ins?.workspaceValue !== undefined && ins.workspaceValue !== null) {
      const v = String(ins.workspaceValue).trim();
      if (v.length > 0) {
        return v;
      }
    }
    if (ins?.globalValue !== undefined && ins.globalValue !== null) {
      const v = String(ins.globalValue).trim();
      if (v.length > 0) {
        return v;
      }
    }
    const cloud = this.getCloudDefaultModelRaw();
    if (cloud.length > 0) {
      return cloud;
    }
    const def = ins?.defaultValue;
    return typeof def === "string" && def.trim().length > 0 ? def.trim() : "qwen2.5-coder:32b";
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
      prompt:
        "Stored securely. Sent as X-API-Key to your compute endpoint. If your account has compute_api_key in Supabase, sign-in sync overwrites this.",
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
