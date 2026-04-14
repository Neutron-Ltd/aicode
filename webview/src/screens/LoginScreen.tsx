import React, { useCallback, useId, useState } from "react";
import { useUltraStore } from "../store/ultraStore";

export function LoginScreen(): React.ReactElement {
  const startGithubOAuth = useUltraStore((s) => s.startGithubOAuth);
  const submitLogin = useUltraStore((s) => s.submitLogin);
  const submitRegister = useUltraStore((s) => s.submitRegister);
  const signingIn = useUltraStore((s) => s.signingIn);
  const pendingAuth = useUltraStore((s) => s.pendingAuth);
  const authError = useUltraStore((s) => s.authError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const emailId = useId();
  const passwordId = useId();

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
  const oauthBusy = signingIn && pendingAuth === "oauth";
  const passwordBusy = signingIn && pendingAuth === "password";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ultra-surface">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.22), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(139, 92, 246, 0.12), transparent)",
        }}
        aria-hidden
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[22rem]">
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25 ring-1 ring-white/10">
              <svg
                className="h-5 w-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                <path d="M19 3v4M21 5h-4" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-ultra-fg sm:text-2xl">
              Welcome to Build Ultra
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ultra-muted">
              Sign in with GitHub or email. New here? Create an account below.
            </p>
          </div>

          <div className="rounded-2xl border border-ultra-border bg-ultra-input/80 p-6 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-colors duration-200">
            <div className="space-y-4">
              <button
                type="button"
                disabled={signingIn}
                onClick={() => startGithubOAuth()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-ultra-border bg-ultra-surface px-4 py-3 text-sm font-semibold text-ultra-fg shadow-sm transition-all duration-200 hover:border-ultra-muted hover:bg-ultra-surface/90 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-2 focus:ring-offset-ultra-input disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Continue with GitHub"
              >
                <svg
                  className="h-5 w-5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
                  />
                </svg>
                {oauthBusy ? "Opening browser…" : "Continue with GitHub"}
              </button>

              <div className="relative flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-ultra-border" />
                <span className="text-[11px] font-medium uppercase tracking-wide text-ultra-muted">
                  Or continue with email
                </span>
                <div className="h-px flex-1 bg-ultra-border" />
              </div>
            </div>

            <form
              onSubmit={handleLogin}
              className="mt-5 space-y-5"
              noValidate
              aria-busy={signingIn}
            >
              {authError ? (
                <p
                  className="rounded-xl border border-red-500/35 bg-red-500/[0.08] px-3.5 py-2.5 text-xs leading-relaxed text-ultra-fg"
                  role="alert"
                  aria-live="polite"
                >
                  {authError}
                </p>
              ) : null}

              <div className="space-y-2">
                <label
                  htmlFor={emailId}
                  className="block text-xs font-semibold uppercase tracking-wide text-ultra-muted"
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
                  className="w-full rounded-xl border-2 border-ultra-border bg-ultra-surface px-3.5 py-3 text-sm text-ultra-input-fg shadow-sm transition-all duration-200 placeholder:text-ultra-muted/80 hover:border-ultra-muted/50 focus:border-indigo-500/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="name@company.com"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor={passwordId}
                  className="block text-xs font-semibold uppercase tracking-wide text-ultra-muted"
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
                  className="w-full rounded-xl border-2 border-ultra-border bg-ultra-surface px-3.5 py-3 text-sm text-ultra-input-fg shadow-sm transition-all duration-200 placeholder:text-ultra-muted/80 hover:border-ultra-muted/50 focus:border-indigo-500/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Enter your password"
                />
              </div>

              <div className="flex flex-col gap-3 pt-1">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500 hover:shadow-lg hover:shadow-indigo-600/30 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-ultra-surface disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:from-indigo-600 disabled:hover:to-violet-600"
                >
                  {passwordBusy ? "Please wait…" : "Log in"}
                </button>
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={handleRegister}
                  className="w-full rounded-xl border-2 border-ultra-border bg-transparent px-4 py-3 text-sm font-semibold text-ultra-fg transition-all duration-200 hover:border-ultra-muted hover:bg-ultra-surface/80 focus:outline-none focus:ring-2 focus:ring-ultra-focus focus:ring-offset-2 focus:ring-offset-ultra-input disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-ultra-border disabled:hover:bg-transparent"
                >
                  {passwordBusy ? "Please wait…" : "Create account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
