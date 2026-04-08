import React, { useCallback, useId, useState } from "react";
import { useMirrorStore } from "../store/mirrorStore";

export function LoginScreen(): React.ReactElement {
  const submitLogin = useMirrorStore((s) => s.submitLogin);
  const submitRegister = useMirrorStore((s) => s.submitRegister);
  const sendPing = useMirrorStore((s) => s.sendPing);
  const lastPongAt = useMirrorStore((s) => s.lastPongAt);
  const signingIn = useMirrorStore((s) => s.signingIn);
  const authError = useMirrorStore((s) => s.authError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const emailId = useId();
  const passwordId = useId();

  const pongLabel =
    lastPongAt !== null
      ? new Date(lastPongAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "—";

  const handleLogin = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = email.trim();
      if (!trimmed || !password) return;
      submitLogin(trimmed, password);
    },
    [email, password, submitLogin]
  );

  const handleRegister = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const trimmed = email.trim();
      if (!trimmed || !password) return;
      submitRegister(trimmed, password);
    },
    [email, password, submitRegister]
  );

  const canSubmit = Boolean(email.trim() && password) && !signingIn;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-mirror-surface px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl border border-mirror-border bg-mirror-input p-6 shadow-mirror transition-all duration-200 ease-out">
        <div className="mb-6 text-center">
          <h1 className="mb-1 text-xl font-semibold tracking-tight text-mirror-fg">
            Mirror
          </h1>
          <p className="text-sm leading-relaxed text-mirror-muted">
            Sign in with your Supabase account. Enable Email auth in your Supabase
            project (Authentication → Providers).
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-4"
          noValidate
          aria-busy={signingIn}
        >
          {authError ? (
            <p
              className="rounded-lg border border-mirror-border bg-mirror-surface px-3 py-2 text-xs text-mirror-muted"
              role="alert"
              aria-live="polite"
            >
              {authError}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <label
              htmlFor={emailId}
              className="block text-xs font-medium text-mirror-fg"
            >
              Email
            </label>
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={signingIn}
              className="w-full rounded-xl border border-mirror-border bg-mirror-surface px-3 py-2.5 text-sm text-mirror-input-fg shadow-sm transition-colors duration-200 ease-out placeholder:text-mirror-muted focus:border-mirror-focus focus:outline-none focus:ring-2 focus:ring-mirror-focus disabled:opacity-60"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={passwordId}
              className="block text-xs font-medium text-mirror-fg"
            >
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={signingIn}
              className="w-full rounded-xl border border-mirror-border bg-mirror-surface px-3 py-2.5 text-sm text-mirror-input-fg shadow-sm transition-colors duration-200 ease-out placeholder:text-mirror-muted focus:border-mirror-focus focus:outline-none focus:ring-2 focus:ring-mirror-focus disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-xl border border-transparent bg-[var(--vscode-button-background)] px-4 py-3 text-sm font-semibold text-[var(--vscode-button-foreground)] shadow-sm transition-all duration-200 ease-out hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-mirror-focus focus:ring-offset-2 focus:ring-offset-mirror-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signingIn ? "Please wait…" : "Log In"}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleRegister}
              className="flex-1 rounded-xl border border-mirror-border bg-mirror-surface px-4 py-3 text-sm font-semibold text-mirror-fg shadow-sm transition-all duration-200 ease-out hover:bg-mirror-input focus:outline-none focus:ring-2 focus:ring-mirror-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create Account
            </button>
          </div>
        </form>

        <div className="mt-4 rounded-xl border border-mirror-border/80 bg-mirror-surface/40 p-3 text-[11px] leading-snug text-mirror-muted transition-colors duration-200">
          Configure{" "}
          <code className="rounded bg-mirror-code-bg px-1 py-0.5 font-mono text-[10px] text-mirror-code-fg">
            mirror.supabaseUrl
          </code>{" "}
          and{" "}
          <code className="rounded bg-mirror-code-bg px-1 py-0.5 font-mono text-[10px] text-mirror-code-fg">
            mirror.supabaseAnonKey
          </code>{" "}
          in Settings.
        </div>

        <details className="mt-4 rounded-xl border border-mirror-border/60 bg-mirror-surface/30 transition-colors duration-200">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-mirror-muted">
            Bridge test
          </summary>
          <div className="border-t border-mirror-border/60 px-3 pb-3 pt-2">
            <button
              type="button"
              onClick={() => sendPing()}
              className="w-full rounded-lg border border-mirror-border bg-mirror-surface px-3 py-2 text-xs font-medium text-mirror-fg transition-colors duration-200 ease-out hover:bg-mirror-input focus:outline-none focus:ring-2 focus:ring-mirror-focus"
            >
              Ping extension host
            </button>
            <p className="mt-2 text-center font-mono text-[11px] text-mirror-muted">
              Last PONG: <span className="text-mirror-fg">{pongLabel}</span>
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
