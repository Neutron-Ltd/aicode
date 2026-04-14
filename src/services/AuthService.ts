import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as vscode from "vscode";
import {
  ULTRA_OAUTH_PROVIDER,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "../config";
import type { HostToWebviewMessage } from "../shared/messages";

/** Must match package.json `publisher` + `name` → vscode://mirror.build-ultra/... */
export const BUILD_ULTRA_URI_AUTHORITY = "mirror.build-ultra";
export const BUILD_ULTRA_AUTH_PATH = "/auth";

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
  provider: string;
} {
  const url = SUPABASE_URL.trim();
  const key = SUPABASE_ANON_KEY.trim();
  const provider = ULTRA_OAUTH_PROVIDER.trim() || "github";
  return { url, key, provider };
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly postToWebview: (msg: HostToWebviewMessage) => void
  ) {
    this.storage = new BlobSecretStorage(context.secrets);
  }

  /** OAuth redirect URI — add this exact URL to Supabase Auth → Redirect URLs. */
  getRedirectUriString(): string {
    return `vscode://${BUILD_ULTRA_URI_AUTHORITY}${BUILD_ULTRA_AUTH_PATH}`;
  }

  /** Same client used for OAuth — session lives in SecretStorage. */
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
   * GitHub OAuth (see `ULTRA_OAUTH_PROVIDER` in config) is a **primary** sign-in path:
   * {@link startOAuthLogin} with PKCE and `vscode://…/auth` callback. Enable the provider
   * in Supabase Auth and add the redirect URL there.
   *
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

    this.postLoginSuccess(user);
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
      this.postLoginSuccess(data.session.user);
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

  async startOAuthLogin(): Promise<void> {
    const client = this.getOrCreateClient();
    const { provider } = getUltraSupabaseConfig();
    if (!client) {
      const msg = "Build Ultra is not configured. Backend URL and key are missing in the extension build.";
      void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
      this.postToWebview({
        type: "AUTH_ERROR",
        payload: { message: msg },
      });
      return;
    }

    const redirectTo = this.getRedirectUriString();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: provider as never,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      void vscode.window.showErrorMessage(`Build Ultra sign-in: ${error.message}`);
      this.postToWebview({
        type: "AUTH_ERROR",
        payload: { message: error.message },
      });
      return;
    }

    if (!data.url) {
      const msg = "No OAuth URL returned.";
      void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
      this.postToWebview({ type: "AUTH_ERROR", payload: { message: msg } });
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(data.url));
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== "vscode") return;
    if (uri.authority !== BUILD_ULTRA_URI_AUTHORITY) return;
    if (!uri.path.includes("auth")) return;

    const client = this.getOrCreateClient();
    if (!client) {
      void vscode.window.showErrorMessage(
        "Build Ultra: not configured. Backend URL and key are missing in the extension build."
      );
      return;
    }

    const params = new URLSearchParams(uri.query);
    const oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      void vscode.window.showErrorMessage(`Build Ultra auth: ${oauthError}`);
      this.postToWebview({
        type: "AUTH_ERROR",
        payload: { message: oauthError },
      });
      return;
    }

    const code = params.get("code");
    if (!code) {
      void vscode.window.showErrorMessage(
        "Build Ultra: OAuth callback missing code. Check redirect URLs for this app."
      );
      this.postToWebview({
        type: "AUTH_ERROR",
        payload: { message: "Missing OAuth code in callback." },
      });
      return;
    }

    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      void vscode.window.showErrorMessage(`Build Ultra: ${error.message}`);
      this.postToWebview({
        type: "AUTH_ERROR",
        payload: { message: error.message },
      });
      return;
    }

    const user = data.session?.user;
    if (!user) {
      const msg = "No user session after OAuth.";
      void vscode.window.showErrorMessage(`Build Ultra: ${msg}`);
      this.postToWebview({ type: "AUTH_ERROR", payload: { message: msg } });
      return;
    }

    this.postLoginSuccess(user);
  }

  /** If a session exists in secrets, notify webview (e.g. after reload). */
  async tryRestoreSession(): Promise<void> {
    const client = this.getOrCreateClient();
    if (!client) return;

    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) return;

    this.postLoginSuccess(session.user);
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
    this.postToWebview({ type: "LOGGED_OUT" });
  }

  private postLoginSuccess(user: {
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  }): void {
    const displayName = displayNameFromUser(user);
    this.postToWebview({
      type: "LOGIN_SUCCESS",
      payload: {
        displayName,
        email: user.email ?? undefined,
      },
    });
  }
}
