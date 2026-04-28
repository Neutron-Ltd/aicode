import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as vscode from "vscode";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import { MASTER_SYSTEM_PROMPT_FALLBACK } from "../chatPrompt/masterPrompt";
import {
  type BuildUltraSettings,
  WORKSTATION_API_KEY_SECRET,
} from "../buildUltraSettings";
import type { HostToWebviewMessage } from "../shared/messages";

const STORAGE_BLOB_KEY = "build-ultra.supabase.auth.storage.v1";

/**
 * Single JSON blob in SecretStorage — implements Supabase auth storage keys.
 */
class BlobSecretStorage {
  private cache: Record<string, string> | null = null;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getItem(key: string): Promise<string | null> {
    await this.ensureLoaded();
    return this.cache![key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.ensureLoaded();
    this.cache![key] = value;
    await this.persist();
  }

  async removeItem(key: string): Promise<void> {
    await this.ensureLoaded();
    delete this.cache![key];
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache !== null) return;
    const raw = await this.secrets.get(STORAGE_BLOB_KEY);
    if (!raw) {
      this.cache = {};
      return;
    }
    try {
      this.cache = JSON.parse(raw) as Record<string, string>;
    } catch {
      this.cache = {};
    }
  }

  private async persist(): Promise<void> {
    await this.secrets.store(STORAGE_BLOB_KEY, JSON.stringify(this.cache));
  }
}

/** Shared Supabase URL/key from bundled config (also used by ApiService). */
export function getUltraSupabaseConfig(): {
  url: string;
  key: string;
} {
  const url = SUPABASE_URL.trim();
  const key = SUPABASE_ANON_KEY.trim();
  return { url, key };
}

function displayNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): string {
  const meta = user.user_metadata;
  const full =
    meta && typeof meta["full_name"] === "string"
      ? (meta["full_name"] as string)
      : undefined;
  const name =
    meta && typeof meta["name"] === "string" ? (meta["name"] as string) : undefined;
  return full || name || user.email?.split("@")[0] || "User";
}

export class AuthService {
  private readonly storage: BlobSecretStorage;
  private client: SupabaseClient | null = null;
  private lastUrl = "";
  private lastKey = "";
  /** Latest `master_prompts` row for `name=default`; cleared on logout. */
  private masterPromptContentCache: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly postToWebview: (msg: HostToWebviewMessage) => void,
    private readonly ultraSettings: BuildUltraSettings,
    private readonly onPrivateComputeCacheUpdated: () => void
  ) {
    this.storage = new BlobSecretStorage(context.secrets);
  }

  /** Reload `user_private_compute` from Supabase and refresh workstation ping. */
  async refreshPrivateComputeFromCloud(): Promise<void> {
    await this.syncPrivateComputeFromCloud();
    this.onPrivateComputeCacheUpdated();
  }

  /**
   * Save workstation host (and optional default model) to Supabase for the signed-in user.
   */
  async linkPrivateComputeToAccount(): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) {
      void vscode.window.showErrorMessage(
        "Build Ultra: not configured. Backend URL and key are missing in the extension build."
      );
      return;
    }
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      void vscode.window.showInformationMessage("Build Ultra: Sign in first.");
      return;
    }
    const hostInput = await vscode.window.showInputBox({
      title: "Build Ultra — Link workstation host",
      prompt:
        "Host or IP only (no http://). Port 8080 is assumed. Saved to your account for all devices.",
      placeHolder: "e.g. 10.0.0.5 or gpu.example.com",
      ignoreFocusOut: true,
    });
    if (hostInput === undefined) {
      return;
    }
    const host = hostInput.replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0]?.trim() ?? "";
    const modelInput = await vscode.window.showInputBox({
      title: "Build Ultra — Default model (optional)",
      prompt:
        "Ollama model id when chat uses the default model. Leave empty to keep only VS Code / account clearing behavior.",
      placeHolder: "qwen2.5-coder:32b",
      ignoreFocusOut: true,
    });
    if (modelInput === undefined) {
      return;
    }
    const defaultModel = modelInput.trim();
    const { error } = await client.from("user_private_compute").upsert(
      {
        id: session.user.id,
        compute_host: host.length > 0 ? host : null,
        default_model: defaultModel.length > 0 ? defaultModel : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      void vscode.window.showErrorMessage(`Build Ultra: ${error.message}`);
      return;
    }
    await this.ultraSettings.setCloudPrivateComputeCache(
      host.length > 0 ? host : null,
      defaultModel.length > 0 ? defaultModel : null
    );
    this.onPrivateComputeCacheUpdated();
    void vscode.window.showInformationMessage(
      "Build Ultra: Workstation host saved to your account."
    );
  }

  /** Same client used for sign-in — session lives in SecretStorage. */
  getSupabaseClient(): SupabaseClient | null {
    return this.getOrCreateClient();
  }

  async getSessionAccessToken(): Promise<string | null> {
    const client = this.getOrCreateClient();
    if (!client) return null;
    const {
      data: { session },
    } = await client.auth.getSession();
    return session?.access_token ?? null;
  }

  /**
   * Same logical prompt as Cloud chat (`master_prompts` / Edge `fetchMasterSystemPrompt`).
   * Cached for the signed-in session; not persisted across logout.
   */
  async resolveDefaultMasterPrompt(): Promise<string> {
    if (this.masterPromptContentCache !== null) {
      return this.masterPromptContentCache;
    }
    const client = this.getOrCreateClient();
    if (!client) {
      return MASTER_SYSTEM_PROMPT_FALLBACK;
    }
    const { data, error } = await client
      .from("master_prompts")
      .select("content")
      .eq("name", "default")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      void vscode.window.showWarningMessage(
        `Build Ultra: Could not load master prompt.${error.message ? ` ${error.message}` : ""}`.slice(
          0,
          220
        )
      );
    }
    const raw =
      data && typeof (data as { content?: unknown }).content === "string"
        ? (data as { content: string }).content.trim()
        : "";
    if (raw) {
      this.masterPromptContentCache = raw;
      return raw;
    }
    return MASTER_SYSTEM_PROMPT_FALLBACK;
  }

  /**
   * Email/password sign-in. Session tokens are persisted by the Supabase client via
   * {@link BlobSecretStorage} → `context.secrets` (no separate manual JWT store).
   */
  async loginUser(email: string, password: string): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) {
      const msg = "Build Ultra is not configured. Backend URL and key are missing in the extension build.";
      void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
      this.postAuthError(msg);
      return;
    }

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      void vscode.window.showErrorMessage(`Build Ultra: ${error.message}`);
      this.postAuthError(error.message);
      return;
    }

    const user = data.user ?? data.session?.user;
    if (!user) {
      const msg = "No user returned after sign-in.";
      void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
      this.postAuthError(msg);
      return;
    }

    await this.postLoginSuccess(user);
  }

  /**
   * Registers a new user. If Supabase returns a session immediately, it is stored the same
   * way as {@link loginUser}. If email confirmation is required, session may be null — user
   * sees a message to check email.
   */
  async registerUser(email: string, password: string): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) {
      const msg = "Build Ultra is not configured. Backend URL and key are missing in the extension build.";
      void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
      this.postAuthError(msg);
      return;
    }

    const { data, error } = await client.auth.signUp({ email, password });

    if (error) {
      void vscode.window.showErrorMessage(`Build Ultra: ${error.message}`);
      this.postAuthError(error.message);
      return;
    }

    if (data.session?.user) {
      await this.postLoginSuccess(data.session.user);
      return;
    }

    if (data.user) {
      const msg =
        "Account created. Check your email to confirm, then sign in.";
      void vscode.window.showInformationMessage(`Build Ultra: ${msg}`);
      this.postAuthError(msg);
      return;
    }

    const msg = "Sign up did not return a user. Try again.";
    void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
    this.postAuthError(msg);
  }

  private postAuthError(message: string): void {
    this.postToWebview({ type: "AUTH_ERROR", payload: { message } });
  }

  private getOrCreateClient(): SupabaseClient | null {
    const { url, key } = getUltraSupabaseConfig();
    if (!url || !key) {
      return null;
    }
    if (this.client && this.lastUrl === url && this.lastKey === key) {
      return this.client;
    }
    this.lastUrl = url;
    this.lastKey = key;
    this.client = createClient(url, key, {
      auth: {
        flowType: "pkce",
        storage: this.storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    return this.client;
  }

  /** If a session exists in secrets, notify webview (e.g. after reload). */
  async tryRestoreSession(): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) return;

    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) return;

    await this.postLoginSuccess(session.user);
  }


  /** End session and notify the webview. */
  async logout(): Promise<void> {
    const client = this.getOrCreateClient();
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) {
        void vscode.window.showErrorMessage(`Build Ultra: ${error.message}`);
        this.postToWebview({
          type: "AUTH_ERROR",
          payload: { message: error.message },
        });
        return;
      }
    }
    this.client = null;
    this.lastUrl = "";
    this.lastKey = "";
    this.masterPromptContentCache = null;
    await this.ultraSettings.clearCloudPrivateComputeCache();
    await this.context.secrets.delete(WORKSTATION_API_KEY_SECRET);
    this.onPrivateComputeCacheUpdated();
    this.postToWebview({ type: "LOGGED_OUT" });
  }

  private async fetchQuotaRemaining(): Promise<number> {
    const client = this.getOrCreateClient();
    if (!client) {
      return 0;
    }
    const {
      data: { session },
    } = await client.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      return 0;
    }
    const { data, error } = await client
      .from("user_quotas")
      .select("tokens_used, total_quota")
      .eq("id", uid)
      .maybeSingle();
    if (error || !data) {
      void vscode.window.showWarningMessage(
        `Build Ultra: Could not load token quota.${error ? ` ${error.message}` : ""}`.slice(0, 220)
      );
      return 0;
    }
    const tokensUsed = typeof data.tokens_used === "number" ? data.tokens_used : 0;
    const totalQuota = typeof data.total_quota === "number" ? data.total_quota : 0;
    return Math.max(0, totalQuota - tokensUsed);
  }

  private async syncPrivateComputeFromCloud(): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) {
      await this.ultraSettings.clearCloudPrivateComputeCache();
      return;
    }
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user || !session.access_token) {
      await this.ultraSettings.clearCloudPrivateComputeCache();
      return;
    }

    const { url, key } = getUltraSupabaseConfig();
    if (url && key) {
      const fnUrl = `${url.replace(/\/$/, "")}/functions/v1/get-private-compute-credentials`;
      try {
        const res = await fetch(fnUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: key,
          },
        });
        if (res.ok) {
          const body = (await res.json()) as {
            computeHost?: unknown;
            defaultModel?: unknown;
            apiKey?: unknown;
          };
          const host =
            typeof body.computeHost === "string" ? body.computeHost.trim() : "";
          const model =
            typeof body.defaultModel === "string" ? body.defaultModel.trim() : "";
          const apiKeyRaw =
            typeof body.apiKey === "string" ? body.apiKey.trim() : "";
          await this.ultraSettings.setCloudPrivateComputeCache(
            host.length > 0 ? host : null,
            model.length > 0 ? model : null
          );
          if (apiKeyRaw.length > 0) {
            await this.context.secrets.store(WORKSTATION_API_KEY_SECRET, apiKeyRaw);
          }
          return;
        }
      } catch {
        /* fall back to direct table read */
      }
    }

    await this.syncPrivateComputeFromCloudDirect(client, session.user.id);
  }

  /** When the Edge Function is unreachable or not deployed yet. */
  private async syncPrivateComputeFromCloudDirect(
    client: SupabaseClient,
    userId: string
  ): Promise<void> {
    const { data, error } = await client
      .from("user_private_compute")
      .select("compute_host, default_model, compute_api_key")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      void vscode.window.showWarningMessage(
        `Build Ultra: Could not load account workstation settings.${error.message ? ` ${error.message}` : ""}`.slice(
          0,
          220
        )
      );
      return;
    }
    const row = data as {
      compute_host?: unknown;
      default_model?: unknown;
      compute_api_key?: unknown;
    } | null;
    const host =
      row && typeof row.compute_host === "string" ? row.compute_host.trim() : "";
    const model =
      row && typeof row.default_model === "string" ? row.default_model.trim() : "";
    const apiKey =
      row && typeof row.compute_api_key === "string"
        ? row.compute_api_key.trim()
        : "";
    await this.ultraSettings.setCloudPrivateComputeCache(
      host.length > 0 ? host : null,
      model.length > 0 ? model : null
    );
    if (apiKey.length > 0) {
      await this.context.secrets.store(WORKSTATION_API_KEY_SECRET, apiKey);
    }
  }

  private async postLoginSuccess(user: {
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.syncPrivateComputeFromCloud();
    const remaining = await this.fetchQuotaRemaining();
    const displayName = displayNameFromUser(user);
    this.postToWebview({
      type: "LOGIN_SUCCESS",
      payload: {
        displayName,
        email: user.email ?? undefined,
        tokenQuotaRemaining: remaining,
      },
    });
    this.onPrivateComputeCacheUpdated();
  }
}
