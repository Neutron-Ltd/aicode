# Product Requirements Document: Build Ultra

*Last reviewed against codebase: Section 3 PRD alignment pass (Apr 2026).*

### How to read status labels

- **✅ Yes** — The behavior exists in the repo and matches or closely matches the requirement.
- **❌ No** — Not implemented as specified, or missing entirely.
- **⚠️ Partial** — Something related exists, but it does not fully satisfy the requirement.

Each feature below starts with a plain-language explanation. **Technical reference** blocks list where things live in the repository (files, notable symbols). You can skip those blocks if you only care about *what* the product is meant to do.

------------------------------------------------------------------------------------------

## 1. Project overview

### 1.1 Vision

Build Ultra is a VS Code extension that connects your **local workspace** (open files, text selection, and optionally indexed code) to **AI models** through a **backend** (Supabase Edge Functions). The long-term vision is not just chat in isolation: the assistant should eventually help **change files** and reason about the whole project from natural language, with guardrails around safety and quotas.

------------------------------------------------------------------------------------------

## 2. Technical stack

These are the technologies the PRD expects versus what this repository actually uses.

### 2.1 Frontend: React and Tailwind in a VS Code webview

The sidebar chat and login UI are built with React and Tailwind and run inside a **webview** (a small embedded browser panel), not as native VS Code UI widgets everywhere.

**Status:** ✅ Yes

**Technical reference**

- UI source: `webview/src/`
- Bundled with **esbuild** (`webview/esbuild.mjs`). The PRD sometimes mentions Vite; this repo uses esbuild.

------------------------------------------------------------------------------------------

### 2.2 Backend: Supabase Edge Functions as the AI gateway

AI requests from the extension go to your Supabase project’s **Edge Functions** (server-side Deno code). That layer can call upstream AI APIs and the database so **secrets stay off the client machine**.

**Status:** ✅ Yes

**Technical reference**

- `supabase/functions/chat/index.ts`
- `supabase/functions/embed/index.ts`

------------------------------------------------------------------------------------------

### 2.3 Authentication: Supabase Auth ✅ Done

Users sign in (email/password and/or OAuth); the session yields JWTs used when calling Edge Functions.

**Status:** ✅ Yes

GitHub OAuth is a **primary** path (prominent **Continue with GitHub** on the login screen) alongside email/password. The webview sends `REQUIRE_LOGIN` → host `startOAuthLogin()` (PKCE + `vscode://mirror.build-ultra/auth` callback).

**Technical reference**

- `webview/src/screens/LoginScreen.tsx` (GitHub + email flows)
- `webview/src/store/ultraStore.ts` (`startGithubOAuth`, `REQUIRE_LOGIN`)
- `src/services/AuthService.ts` (`signInWithOAuth`, `handleUri`)

------------------------------------------------------------------------------------------

### 2.4 Database: PostgreSQL and pgvector ✅ Done

User data and **vector embeddings** for retrieval live in Postgres. The `pgvector` extension supports similarity search over embedded chunks.

**Status:** ✅ Yes

Includes a **`master_prompts`** table (`id`, `name`, `content`, `version`) and **`user_quotas`** extensions (`tier`, `entitlements` jsonb) for billing integration—see migration below.

**Technical reference**

- Migrations: `supabase/migrations/` — e.g. `20260414120000_master_prompts_and_quotas_tier.sql` (`master_prompts` + quota columns)
- RAG uses RPC `match_documents` from `supabase/functions/chat/index.ts` (around line 490).

------------------------------------------------------------------------------------------

### 2.5 Billing: Stripe and webhooks (test) ⚠️ Partial

Paid tiers, checkout, and webhooks that update quotas or entitlements in Supabase.

**Status:** ⚠️ Partial

**Done in repo:** Edge Function `stripe-webhook` verifies Stripe signatures, handles `checkout.session.completed`, and updates `user_quotas` (`tier`, `entitlements`, `total_quota`) using `SUPABASE_SERVICE_ROLE_KEY`. Configure Checkout sessions with `metadata.supabase_user_id` (or `client_reference_id` as UUID).

**Not in repo:** Stripe Checkout creation UI, Price wiring, or customer portal—that remains product-side.

**Technical reference**

- `supabase/functions/stripe-webhook/index.ts`
- `[functions.stripe-webhook]` in `supabase/config.toml` (`verify_jwt = false`)

------------------------------------------------------------------------------------------

### 2.6 AI provider: Cursor APIs via backend proxy ✅ Done

The PRD describes the Edge layer talking to **Cursor’s** APIs, with the extension never seeing Cursor URLs or keys.

**Status:** ✅ Yes (proxy model)

There is no public Cursor REST contract in code; the Edge layer sends **OpenAI-compatible** JSON to URLs you configure. The extension still only talks to Supabase Functions—upstream URLs and keys stay in Edge env. Optional `BUILD_ULTRA_UPSTREAM_FORMAT` defaults to `openai` (other values log a warning until a custom mapper exists).

**Technical reference**

- Chat upstream URL: `BUILD_ULTRA_UPSTREAM_CHAT_URL` in `supabase/functions/chat/index.ts` (`resolveUpstreamPayloadFormat`, `buildUpstreamChatRequestBody`).
- Embeddings URL: `BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL` in `supabase/functions/embed/index.ts`.

------------------------------------------------------------------------------------------

### 2.7 Extension host: VS Code Extension API

The extension “main” process uses Node, TypeScript, and VS Code APIs for commands, the webview, and editor integration.

**Status:** ✅ Yes

**Technical reference**

- Entry: `src/extension.ts`
- Webview provider: `src/BuildUltraChatViewProvider.ts`

------------------------------------------------------------------------------------------

### 2.8 Observability: PostHog ✅ Done

Product analytics and event tracking (usage, funnels).

**Status:** ✅ Yes (opt-in)

**Extension host:** `posthog-node` in `src/telemetry.ts`, initialized from `src/extension.ts` when `POSTHOG_API_KEY` is set in `src/config.ts`. **Webview:** `posthog-js` via `webview/src/initPosthog.ts` and `main.tsx` when `POSTHOG_WEBVIEW_KEY` is set in `webview/src/posthogConfig.ts`. Empty keys = **no** telemetry (opt-in). CSP `connect-src` in `BuildUltraChatViewProvider` allows PostHog hosts.

**Technical reference**

- `src/telemetry.ts`, `src/config.ts` (`POSTHOG_API_KEY`, `POSTHOG_HOST`)
- `webview/src/initPosthog.ts`, `webview/src/posthogConfig.ts`
- `src/BuildUltraChatViewProvider.ts` (CSP)

------------------------------------------------------------------------------------------

## 3. Core features and requirements

### 3.1 Authentication and token mechanism

How people sign in, how tokens are sent to the backend, where refresh material is stored, and how tiers relate to usage limits.

#### 3.1.1 Secure login (Build Ultra screen)

A dedicated login and registration screen inside the extension, not only “open the browser and hope.”

**Status:** ✅ Yes

**Technical reference**

- `webview/src/screens/LoginScreen.tsx`

------------------------------------------------------------------------------------------

#### 3.1.2 Access token (JWT) for Edge calls

Authenticated calls to Edge Functions include a short-lived JWT (`Authorization: Bearer …`).

**Status:** ✅ Yes

**Technical reference**

- Chat and API calls: `src/services/ApiService.ts` (bearer token from Supabase session).

------------------------------------------------------------------------------------------

#### 3.1.3 Refresh and session in SecretStorage

Refresh material and session data are stored in VS Code’s **SecretStorage** (OS keychain / credential manager), not plain browser `localStorage`.

**Status:** ✅ Yes

**Technical reference**

- `src/services/AuthService.ts` — `BlobSecretStorage`, see roughly lines 14–22 and 96.

------------------------------------------------------------------------------------------

#### 3.1.4 Tiered accounts (Free / Pro / Ultra), token sync, monthly refills

Named tiers, live quota display, and monthly token top-ups (usually tied to billing).

**Status:** ⚠️ Partial

**Done in repo:** `stripe-webhook` maps tiers to `TIER_QUOTAS`, updates `total_quota`, resets `tokens_used` on checkout/subscription events, stores `next_token_refill_at` / billing metadata in `entitlements`, and idempotency via checkout session id. Schema includes `next_token_refill_at` where migrated.

**Gap vs ideal “monthly refill”:** refill timing is driven by Stripe subscription/checkout events, not a separate calendar cron—document as v1.

**Technical reference**

- `supabase/functions/stripe-webhook/index.ts`
- `user_quotas` usage and deduction: `supabase/functions/chat/index.ts`

------------------------------------------------------------------------------------------

### 3.2 Master prompt engine (system prompt)

How system instructions are assembled—optimization, reasoning rules, edit constraints, and whether a “master” prompt lives in the database vs only on the server.

#### 3.2.1 Prompt optimization (pre-process)

Optionally rewriting or enriching the user message before it hits the model for clarity and structure.

**Status:** ⚠️ Partial

Context is structured on the client (`ChatPayload`: rules, editor, terminal, diagnostics); Edge assembles **system** (DB master prompt) + **context user** + **query user**. There is still no separate optimizer LLM pass.

**Technical reference**

- `src/services/PromptBuilderService.ts`, `src/types/chatPayload.ts`
- `supabase/functions/chat/index.ts` — `assembleChatMessages`

------------------------------------------------------------------------------------------

#### 3.2.2 Query expansion, implicit requirements, enforced chain-of-thought

Automatically expanding vague requests and forcing step-by-step reasoning in the model.

**Status:** ✅ Yes (via DB master prompt)

The seeded `master_prompts` default row instructs step-by-step reasoning before code; there is no separate query-expansion model.

**Technical reference**

- `supabase/migrations/20260415140001_seed_default_master_prompt.sql`
- `supabase/functions/chat/index.ts` — `fetchMasterSystemPrompt`

------------------------------------------------------------------------------------------

#### 3.2.3 Constraint: no full-file rewrites for tiny edits

For small fixes, the model should change only what’s needed instead of dumping entire files.

**Status:** ⚠️ Partial

**Done in repo:** Master prompt + `write_file` tool schema emphasize **line `range`** for small edits; host-side `ToolExecutionService` can refuse risky full-file replaces and prompts the user when replacing **>50 lines** without a range.

**Still true:** Markdown **Apply** on fenced blocks is a separate path that inserts/replaces selection—not a ranged diff.

**Technical reference**

- `supabase/functions/chat/index.ts` — `OPENAI_TOOLS`, `assembleChatMessages`
- `src/services/ToolExecutionService.ts`

------------------------------------------------------------------------------------------

#### 3.2.4 Master prompt in the database, injected only on the server

The canonical system prompt is stored in Supabase and never shipped inside the VSIX; only Edge injects it.

**Status:** ✅ Yes

Edge loads `master_prompts` (`name = 'default'`, latest `version`) with the user JWT (RLS allows `authenticated` read). System message = DB content only; context/query are separate user turns.

**Technical reference**

- `supabase/functions/chat/index.ts` — `fetchMasterSystemPrompt`, `assembleChatMessages`
- Migrations: RLS policy + seed for `master_prompts`

------------------------------------------------------------------------------------------

### 3.3 Ultra AI chat interface

Streaming behavior, loading states, and how assistant output is labeled.

#### 3.3.1 Streaming UI: scroll anchoring (`overflow-anchor: auto`)

While tokens stream in, the message list should not jump erratically—CSS scroll anchoring and follow logic help.

**Status:** ✅ Yes

**Technical reference**

- `webview/src/components/chat/MessageList.tsx` — `overflow-anchor`, follow-bottom, `requestAnimationFrame` (see ~line 95 and nearby).

------------------------------------------------------------------------------------------

#### 3.3.2 “Ultra AI is thinking…” pulsing UI

A clear loading state before the first token arrives.

**Status:** ✅ Yes

**Technical reference**

- Same file, skeleton and label roughly lines 128–137.

------------------------------------------------------------------------------------------

#### 3.3.3 “Ultra AI” label on every assistant response

Each assistant message should visibly show that it came from Ultra AI (for example a header chip).

**Status:** ✅ Yes

Each assistant bubble has a small **“Ultra AI”** label above the markdown body (in addition to the “thinking” skeleton).

**Technical reference**

- `webview/src/components/chat/MessageList.tsx`

------------------------------------------------------------------------------------------

### 3.4 Direct file manipulation and tool-calling

Structured tools (JSON) for file operations versus free-form chat; safe concurrent edits; undo model.

#### 3.4.1 Tool JSON: read_file, write_file, create_file, list_directory

The model returns parseable tool calls and the extension runs them in an agent loop.

**Status:** ✅ Yes

Edge sends OpenAI-style `tools`; SSE emits finalized `tool_calls`; `ApiService` executes tools via `ToolExecutionService` and posts follow-up requests with `conversationOverride` (multi-round cap).

**Technical reference**

- `supabase/functions/chat/index.ts` — `OPENAI_TOOLS`, stream finalize
- `src/services/ApiService.ts`, `src/services/ToolExecutionService.ts`

------------------------------------------------------------------------------------------

#### 3.4.2 write_file with ranges, TextDocument.version, and AST

Partial updates with line ranges, using document version and AST so edits stay correct if the user types during a stream.

**Status:** ⚠️ Partial

**Done:** `write_file` accepts optional **1-based line `range`**; `ToolExecutionService` applies `WorkspaceEdit` and can compare `TextDocument.version` when an expected version is supplied in the tool protocol (host passes a version map where applicable).

**Gap:** No AST-based merge layer; version alignment depends on tool args / follow-up state, not a full IDE AST pipeline.

**Technical reference**

- `src/services/ToolExecutionService.ts`

------------------------------------------------------------------------------------------

#### 3.4.3 Undo via WorkspaceEdit

AI edits should use `vscode.WorkspaceEdit` so undo/redo behaves consistently.

**Status:** ✅ Yes

Chat “Apply” inserts/replaces via `WorkspaceEdit` + `applyEdit`. Tool-driven writes also use `WorkspaceEdit` in `ToolExecutionService`.

**Technical reference**

- `src/services/EditorService.ts` — `applyCodeFromChat`
- `src/services/ToolExecutionService.ts`

------------------------------------------------------------------------------------------

#### 3.4.4 User-triggered Apply on code blocks

The user clicks **Apply** on a fenced code block to insert or merge code into the editor (a lighter-weight alternative to full agent tools).

**Status:** ✅ Yes

**Technical reference**

- `webview/src/components/chat/CodeBlock.tsx` → message `INSERT_CODE` → `src/BuildUltraChatViewProvider.ts` → `EditorService.applyCodeFromChat` in `src/services/EditorService.ts`

------------------------------------------------------------------------------------------

### 3.5 Codebase indexing and semantic context

Searchable index of the repo, embeddings, retrieval-augmented prompts, editor context, and size limits.

#### 3.5.1 Background indexing and `.buildultraignore`

The index updates continuously or on save, with ignore rules including a project-specific file.

**Status:** ⚠️ Partial

Indexing remains **manual** (“Index Workspace”). **`.buildultraignore`** is loaded and merged with `.gitignore` patterns for the scanner walk.

**Technical reference**

- `webview/src/store/ultraStore.ts`
- `src/services/WorkspaceScannerService.ts` — `loadBuildUltraIgnorePatterns`, `loadGitignorePatterns`

------------------------------------------------------------------------------------------

#### 3.5.2 Embeddings on the backend (batching)

Heavy embedding work runs on Edge, not on the user’s CPU inside the extension.

**Status:** ✅ Yes

**Technical reference**

- Chunks sent to `/functions/v1/embed`: `supabase/functions/embed/index.ts`

------------------------------------------------------------------------------------------

#### 3.5.3 Model `text-embedding-3-small`

A specific embedding model name for vectors (OpenAI-compatible).

**Status:** ✅ Yes

**Technical reference**

- `supabase/functions/embed/index.ts` — line ~11.

------------------------------------------------------------------------------------------

#### 3.5.4 Semantic search (RAG)

Retrieve the most relevant code chunks for the user query and add them to the prompt.

**Status:** ✅ Yes

**Technical reference**

- `match_documents` in `supabase/functions/chat/index.ts`

------------------------------------------------------------------------------------------

#### 3.5.5 Context: active file and selection

The prompt includes the current file and highlighted text when available.

**Status:** ✅ Yes

**Technical reference**

- `src/services/PromptBuilderService.ts` — `editorContext`

------------------------------------------------------------------------------------------

#### 3.5.6 Diagnostics in context

Errors and warnings from VS Code language services are included in the prompt.

**Status:** ✅ Yes

`PromptBuilderService` reads `vscode.languages.getDiagnostics` for the active file and sends a compact `diagnosticsSummary` in `ChatPayload`; Edge includes it in the context user message.

**Technical reference**

- `src/services/PromptBuilderService.ts` — `getDiagnosticsSummaryForActiveFile`
- `supabase/functions/chat/index.ts` — `buildContextUserMessage`

------------------------------------------------------------------------------------------

#### 3.5.7 Token window (for example tiktoken)

Truncate or prioritize by **token** count to respect model limits.

**Status:** ⚠️ Partial

**Done:** `truncateContextParts` trims **RAG first**, then active file text, under `MAX_CONTEXT_CHARS`; `estimateTokens` uses a **length/4** approximation and prompt size is logged—not full **tiktoken** WASM.

**Technical reference**

- `supabase/functions/chat/index.ts` — `estimateTokens`, `truncateContextParts`, `MAX_EDITOR_FILE_CHARS`

------------------------------------------------------------------------------------------

### 3.6 Safety and privacy guardrails

Blocking sensitive paths and safe deletion behavior.

#### 3.6.1 Block AI read/write to `.env`, `.git`, and similar

Secrets and VCS internals should not be sent to the model or overwritten blindly.

**Status:** ⚠️ Partial

**Done:** Tool paths are checked with `src/tooling/toolPathGuards.ts` (blocks `.git/**`, `.env*`, etc.) before read/write. Scanner still hard-ignores `.git` and similar.

**Gap:** If the user **opens** a sensitive file as the **active editor**, that content can still be included in the chat context bundle—tool blocklist does not strip editor payload.

**Technical reference**

- `src/tooling/toolPathGuards.ts`, `src/services/ToolExecutionService.ts`
- `src/services/WorkspaceScannerService.ts` — `HARD_IGNORED_DIRS`

------------------------------------------------------------------------------------------

#### 3.6.2 Deletion protection (over 50 lines)

Deleting large files should require explicit confirmation.

**Status:** ⚠️ Partial

**Done:** Full-file `write_file` without a line `range` on files with **>50 lines** opens a **modal** confirmation before applying the edit.

**Gap:** No dedicated **delete_file** tool; no webview `TOOL_CONFIRM_REQUEST` / `TOOL_CONFIRM_RESPONSE` protocol (plan optional)—confirmation is host modal only.

**Technical reference**

- `src/services/ToolExecutionService.ts`

------------------------------------------------------------------------------------------

### 3.7 Security and abuse prevention

Key handling, hiding upstream providers, JWT checks, and rate limits.

#### 3.7.1 All API keys in vault or secrets—never on the client

Provider secrets must not ship in the VSIX; service keys stay in Edge environment variables.

**Status:** ✅ Yes (as designed for Supabase anon)

Upstream AI keys stay in Edge env only. **`SUPABASE_URL` / `SUPABASE_ANON_KEY`** are compiled from **`.env`** via `scripts/gen-config.mjs` → `src/config.generated.ts` (not hand-edited literals in `config.ts`). The anon key remains in the VSIX by design (public client key); **service role** never ships to the extension.

**Technical reference**

- `scripts/gen-config.mjs`, `.env.example`, `src/config.ts`, `src/config.generated.ts`

------------------------------------------------------------------------------------------

#### 3.7.2 Client only talks to Supabase functions; opaque upstream

The extension should not know the final LLM vendor—only your `…/functions/v1/…` endpoints.

**Status:** ✅ Yes

The extension calls Supabase Functions only. Upstream chat/embed URLs are configured via Edge secrets (`BUILD_ULTRA_UPSTREAM_*`); the client bundle does not contain vendor endpoints.

**Technical reference**

- `supabase/functions/chat/index.ts`, `supabase/functions/embed/index.ts`

------------------------------------------------------------------------------------------

#### 3.7.3 JWT validated on Edge

Each function verifies the user JWT before doing work.

**Status:** ✅ Yes

**Technical reference**

- `supabase.auth.getUser(jwt)` in chat (~line 417) and embed (~lines 131–135).

------------------------------------------------------------------------------------------

#### 3.7.4 `verify_jwt = false` on chat and embed with manual JWT

Sometimes platform JWT middleware is turned off and validation happens in code.

**Status:** ✅ Yes

`verify_jwt = false` is set for **`[functions.chat]`**, **`[functions.stripe-webhook]`**, and **`[functions.embed]`**; JWT/user checks occur inside each function handler.

**Technical reference**

- `supabase/config.toml`

------------------------------------------------------------------------------------------

#### 3.7.5 Rate limiting (token bucket) in Edge

Per-user throttling to protect APIs beyond quota accounting.

**Status:** ✅ Yes (DB-backed)

Per-user requests per rolling minute bucket are tracked in Postgres (`chat_rate_counters`); over limit returns **429**. This is separate from token **quota** accounting.

**Technical reference**

- `supabase/functions/chat/index.ts` — `enforceRateLimit`
- Related migration: `chat_rate_counters` (see `supabase/migrations/`)

------------------------------------------------------------------------------------------

## 4. Backend configuration

Deployment shape, failure behavior, and quota accounting.

### 4.1 Edge as the primary proxy

All AI traffic goes through Supabase Functions, not direct browser-to-vendor calls.

**Status:** ✅ Yes

**Technical reference**

- `chat` and `embed` functions under `supabase/functions/`.

------------------------------------------------------------------------------------------

### 4.2 Multi-region Edge

Run functions in multiple regions for lower latency.

**Status:** ❌ Not expressed in application source

This is a Supabase project / hosting setting, not something the repo encodes.

------------------------------------------------------------------------------------------

### 4.3 Graceful degradation and maintenance notice

When upstream AI is down, show a clear maintenance-style message instead of failing silently.

**Status:** ⚠️ Partial

Generic HTTP and SSE errors; no dedicated maintenance payload or schema.

------------------------------------------------------------------------------------------

### 4.4 Quota deduction

After a completed stream, subtract estimated usage from the user’s quota in the database.

**Status:** ✅ Yes

**Technical reference**

- `user_quotas` updates in `supabase/functions/chat/index.ts` after streaming.

------------------------------------------------------------------------------------------

## 5. Performance, stability, and observability

UI behavior during streaming, edit ordering, and product analytics.

### 5.1 Throttled, smooth streaming UI

Avoid React thrashing when tokens arrive very quickly.

**Status:** ⚠️ Partial

`MessageList` uses `requestAnimationFrame` and follow logic; there is no explicit React 18 batching or scheduler API usage called out for this.

**Technical reference**

- `webview/src/components/chat/MessageList.tsx`

------------------------------------------------------------------------------------------

### 5.2 Queue file edits (concurrency)

Serialize AI-driven edits so they do not race each other.

**Status:** ❌ No

Apply runs on user click; no shared edit queue.

------------------------------------------------------------------------------------------

### 5.3 PostHog telemetry

Events for tools, reasoning failures, undo-after-AI, and similar.

**Status:** ❌ No

------------------------------------------------------------------------------------------

## 6. Future enhancements

Planned UX that is **not** implemented in this pass.

### 6.1 Multi-turn planning UI

Show a plan of edits before executing several steps.

**Status:** ❌ No

------------------------------------------------------------------------------------------

### 6.2 Side-by-side diff overlay

Review diffs in the editor before applying.

**Status:** ❌ No

------------------------------------------------------------------------------------------

## 7. Extra behaviors in the codebase (not covered above or diverging from the PRD)

These are real behaviors worth knowing about; they are **not** claims that earlier PRD rows are fully satisfied.

**Section 7 cleanup (done):** Env-based upstream URLs, opaque model routing (no vendor catalog in UI or `MODEL_302_*` on Edge), `.ultrarules` only, and **`BUILD_ULTRA_DEFAULT_CHAT_MODEL` only** (legacy `MIRROR_DEFAULT_CHAT_MODEL` removed). Items below use **Status** lines: ✅ **Done** = updated by that pass; ✅ **Kept** = intentionally unchanged (SSE, apply, scanner, CORS).

### 7.1 Upstream OpenAI-compatible URLs on Edge ✅ Done

Chat and embeddings call configurable upstream endpoints (no hardcoded vendor base URLs in source).

**Status:** ✅ Done — `BUILD_ULTRA_UPSTREAM_CHAT_URL` / `BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL` in Edge env.

**Technical reference**

- `supabase/functions/chat/index.ts`
- `supabase/functions/embed/index.ts`

------------------------------------------------------------------------------------------

### 7.2 Opaque model routing (no UI catalog) ✅ Done

The webview sends a fixed opaque `modelId`; the Edge function passes it through or falls back to `BUILD_ULTRA_DEFAULT_CHAT_MODEL`.

**Status:** ✅ Done — no model dropdown / `MODEL_OPTIONS`; no `MODEL_302_BY_*` in `chat`.

**Technical reference**

- `webview/src/types/chat.ts` (`DEFAULT_CHAT_MODEL_ID`)
- `webview/src/components/chat/Header.tsx`
- `supabase/functions/chat/index.ts` (`resolveUpstreamModel`)

------------------------------------------------------------------------------------------

### 7.3 Streaming protocol (SSE) ✅ Kept

The extension host parses server-sent events and forwards stream messages to the webview.

**Status:** ✅ Kept — SSE parsing in `ApiService` unchanged by the cleanup pass.

**Technical reference**

- `src/services/ApiService.ts`
- `webview/src/store/ultraStore.ts`

------------------------------------------------------------------------------------------

### 7.4 Apply behavior ✅ Kept

Inserts code or replaces the current selection depending on context; requires an explicit **Apply** click.

**Status:** ✅ Kept — behavior unchanged; implementation uses `WorkspaceEdit` + `applyEdit` for consistent undo semantics.

**Technical reference**

- `EditorService.applyCodeFromChat` in `src/services/EditorService.ts`

------------------------------------------------------------------------------------------

### 7.5 Workspace rules files (`.ultrarules` only) ✅ Done

Prompt builder reads **only** `.ultrarules` at the workspace root.

**Status:** ✅ Done — legacy `.mirrorrules` fallback removed.

**Technical reference**

- `src/services/PromptBuilderService.ts`
- Edge context assembly in `supabase/functions/chat/index.ts` (`assembleChatMessages`, `buildContextUserMessage`)

------------------------------------------------------------------------------------------

### 7.6 Scanner heuristics ✅ Kept

Binary extensions, chunk sizes, and ignore logic live in the workspace scanner.

**Status:** ✅ Kept — blocklists/chunking unchanged.

**Technical reference**

- `src/services/WorkspaceScannerService.ts`

------------------------------------------------------------------------------------------

### 7.7 CORS ✅ Kept

Edge responses include OPTIONS handling and CORS headers for cross-origin clients.

**Status:** ✅ Kept — `corsHeaders` + OPTIONS unchanged.

------------------------------------------------------------------------------------------

### 7.8 Default model environment variable ✅ Done

**Status:** ✅ Done — only `BUILD_ULTRA_DEFAULT_CHAT_MODEL` (plus in-code fallback `"default"` when unset); `MIRROR_DEFAULT_CHAT_MODEL` removed.

**Technical reference**

- `supabase/functions/chat/index.ts`

------------------------------------------------------------------------------------------

### Legend

- ✅ = implemented or substantially present in repository source.
- ❌ = not found or not implemented as specified.
- ⚠️ **Partial** = some related behavior exists but does not meet the full requirement.
