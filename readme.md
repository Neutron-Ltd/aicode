# Build Ultra — Product Requirements Document

**Status legend:** ✅ shipped in this repo · ⚠️ partial / depends on config or path · ❌ not implemented.

---

## 1. Project overview

- ✅ **Positioning** — VS Code extension that bridges the local workspace to an **Ultra AI** compute layer (cloud-hosted or private OpenAI-compatible endpoint).
- ✅ **Managed privacy** — Hybrid architecture: **Supabase** for auth, quotas, prompts, embeddings metadata, and billing-related state; heavy inference can run on **operator-managed** hardware without baking infra details into the UI copy.

---

## 2. Technical stack

### 2.1 Frontend architecture

- ✅ **React 18** + **Zustand** for webview state (`webview/src`).
- ✅ **Tailwind CSS** with `color-mix` against `var(--vscode-*)`.
- ✅ **esbuild** webview bundle + TypeScript extension host (`npm run compile`, `npm run build:webview`).

### 2.2 Backend SaaS controller (cloud)

- ✅ **Supabase Edge Functions** — `chat`, `embed`, `log-usage`, `get-private-compute-credentials`, `stripe-webhook` under `supabase/functions/`.
- ✅ **PostgreSQL + pgvector** — migrations under `supabase/migrations/` (e.g. embeddings storage, `master_prompts`, `user_quotas`, `user_private_compute`).
- ✅ **JWT** — User session for Cloud calls and for workstation quota reporting; anon key + user JWT on function calls where implemented.
- ⚠️ **“Master prompts” on Edge** — Enforced on the `chat` path; **Workstation** chat hits private HTTP directly and uses DB/fallback prompts client-side (`AuthService.resolveDefaultMasterPrompt`).

### 2.3 Ultra AI compute layer (private infrastructure)

- ⚠️ **Gateway** — Extension assumes **`http://{host}:8080`** and **`X-API-Key`**; **nginx (or equivalent) is operator-managed** and not defined in this repo.
- ⚠️ **Inference engines** — **Ollama / vLLM** implied by OpenAI-compatible API; nothing bundled in-repo.
- ⚠️ **Models** — Defaults/strings in settings (e.g. `qwen2.5-coder:32b`); actual model list comes from upstream.

---

## 3. Core features and requirements

### 3.1 Auth and quota enforcement (unified SaaS model)

- ✅ **Signed-in gate** — Chat flow expects Supabase session (`isLoggedIn` in webview; workstation still uses session for `log-usage` and prompts).
- ✅ **`/functions/v1/log-usage`** after Workstation turns — `ApiService.postWorkstationLogUsage` with usage estimate or `usage.total_tokens`.
- ✅ **Kill-switch** — Cloud and `log-usage` can return **401/402**; UI gates input via quota state (`ultraStore` / `ChatScreen`).
- ✅ **Email/password sign-in and registration** — `AuthService.loginUser` / `registerUser`; session in Secret Storage via Supabase client (**no** GitHub OAuth or `vscode://` auth callback in this extension).

### 3.2 Master prompt engine (“brain”)

- ✅ **`master_prompts` table** — Cloud `chat` and workstation `resolveDefaultMasterPrompt` read **`name=default`**; fallback constant in `src/chatPrompt/masterPrompt.ts`.
- ⚠️ **Persona** — Driven by DB content when fetch succeeds; not every edge case re-validated in UI.
- ✅ **Query expansion** — `PromptBuilderService` / `assembleMessages`-style payloads include editor, diagnostics, terminal, RAG when Cloud path assembles them.

### 3.3 Ultra AI chat interface

- ✅ **Stable streaming scroll** — `overflowAnchor: "auto"` + **`requestAnimationFrame`** scroll in `MessageList.tsx`.
- ✅ **`useDeferredValue`** — defers heavy markdown during streaming (`MessageList.tsx`).
- ✅ **Branding** — “Ultra AI” labels and thinking state in `MessageList` / `Header`; footer **Ultra AI compute** in `WorkstationConnectionFooter`.

### 3.4 Direct file manipulation (agentic editing)

- ✅ **Tool loop** — `ApiService` recursive rounds with `read_file`, `write_file`, `create_file`, `list_directory` (`openAiTools.ts`); **no `delete_file`** tool in codebase.
- ✅ **Line range for `write_file`** — Schema + `ToolExecutionService` enforcement.
- ✅ **`vscode.WorkspaceEdit`** — Edits for undo consistency.

### 3.5 Codebase indexing and semantic context (cloud RAG)

- ✅ **Save debounce → index** — `extension.ts` → `WorkspaceScannerService.indexDocumentOnSave` (Cloud mode + signed-in checks in scanner).
- ✅ **`.buildultraignore`** — honored in scanner collection.
- ✅ **Context truncation policy** — implemented in `assembleMessages`, Edge `chat`, and tool follow-up bundling (ordering: diagnostics → rules → editor → RAG → terminal with pruning rules as coded).

### 3.6 Safety and privacy guardrails

- ✅ **Path blocklist** — `toolPathGuards` / `ToolExecutionService.resolvePath` (`.env`, `.git`, `node_modules`, `dist`, `build`, etc.).
- ✅ **Binary / size** — `tooling/looksBinary.ts` (16 KiB sample, NUL / control ratio), `MAX_TOOL_FILE_BYTES`.
- ✅ **Destructive scope** — Tool plan + diff review flows (`diffReview.ts`, mutation banner); **`write_file`** without valid range fails.

### 3.7 Mutation observer UI

- ✅ **Progress lines** — `MUTATION_PROGRESS` to webview; `MutationBanner` component.
- ✅ **Diff flow** — `diffAwaiting`, Apply/Skip, focus editor command from webview message.

### 3.8 Infrastructure privacy (product tone)

- ✅ **Neutral copy** — `computeHost` / `localIp` settings; workstation footer avoids raw URLs; `ApiService` comments avoid “gateway” in user strings.

### 3.9 (Implicit) Account-linked workstation settings

- ✅ **`user_private_compute`** — host, default model, optional `compute_api_key` (migrations); RLS per user.
- ✅ **Edge `get-private-compute-credentials`** — optional fast path; PostgREST fallback in `AuthService.syncPrivateComputeFromCloud`.
- ✅ **Palette** — **Build Ultra: Link Workstation Host to Account**; **Set Private Compute API Key**; logout clears synced workstation secret from Secret Storage.

---

## 4. Cursor-grade native integration (“magical” layer)

### 4.1 Ultra Tab (inline autocomplete)

- ❌ **Ghost text / FIM / debounced inline triggers** — no `TextEditorDecorationType` or inline-completion provider found in `src/`.

### 4.2 Ultra Edit (Cmd+K / Ctrl+K)

- ❌ **Inline prompt, selection-scoped inline diff, accept/reject in editor** — not present; editing is chat + tool loop driven.

### 4.3 Workspace rules (`.ultrarules`)

- ⚠️ **Tab/Edit injection** — ❌ not applicable (features absent).
- ✅ **Chat** — `.ultrarules` fed via `PromptBuilderService` into chat payloads where implemented.

---

## 5. Performance and observability

- ⚠️ **PostHog** — `telemetry.ts` + `captureTelemetryEvent` for `tool_execution` and `user_undo_action`; **disabled when `POSTHOG_API_KEY` is empty** in bundled `config` (default empty).
- ✅ **Edit concurrency** — `toolExecutionQueue` / `AsyncSerialQueue` pattern for tool rounds.

---

## 6. Future enhancements

- ❌ **Multi-turn visual planning** — checklist UI before execution (beyond current tool-plan review).
- ❌ **Terminal auto-debug** — automatic trace capture and fix suggestions.

---

## 7. Extra pieces that exist in code (but aren’t the main PRD story)

Sections 1–6 describe the product. This section is a **plain-English map** of important plumbing so you aren’t surprised when you open the repo.

**Why sign-in says “not configured”**  
The extension does **not** read Supabase from your database at startup. It only knows your project if you create a **`.env`** file with **`SUPABASE_URL`** and **`SUPABASE_ANON_KEY`**, then run **`npm run compile`**. A small script (`scripts/gen-config.mjs`) writes **`src/config.generated.ts`**. No `.env` (or empty values) means login cannot work in a dev build.

**Where the extension boots**  
**`src/extension.ts`** is the main switchboard: it creates settings, auth, the chat webview, the API layer, the workspace indexer, tool execution, registers save handlers, and your command-palette commands.

**How the sidebar chat talks to TypeScript**  
The webview and the extension don’t call each other ad hoc—they use a **typed message list** in **`src/shared/messages.ts`**. The big class that owns the webview and forwards those messages is **`BuildUltraChatViewProvider`**.

**Preview tabs when you review a diff**  
When the flow needs a read-only “preview” document (for example while inspecting an AI-suggested edit), the code uses a custom URI scheme **`buildultra-preview:`** via **`BuildUltraPreviewProvider`** (**`virtualDocumentProvider.ts`**). VS Code treats it like a temporary document.

**Stripe**  
There is a Supabase Edge function **`stripe-webhook`** for payment events. The main feature sections don’t walk through billing UI or flows—that’s separate surface area.

**`ContextService`**  
There is a file **`ContextService.ts`** that is basically an **empty placeholder** for future “context orchestration.” It doesn’t do anything yet; don’t expect behavior from it.

**IDs you’ll see in `package.json`**  
Publisher (**`ultra`** in this repo), the Ultra AI sidebar view id **`buildUltra.chat`**, and registered commands such as **Build Ultra: Set Private Compute API Key** and **Build Ultra: Link Workstation Host to Account** are all defined there—useful when tracing bugs or writing docs.

---

## 8. Starting the Workstation API after a restart

The extension talks to **`http://{computeHost}:8080/v1/*`** (see `buildUltraSettings.getLocalBaseUrl`). Whatever you run on the GPU/Linux box (**Ollama** + **nginx** on 8080 is the common pattern) must be up after reboot.

### Typical stack (systemd: Ollama + nginx)

```bash
sudo systemctl status ollama nginx --no-pager

sudo systemctl start ollama
sudo systemctl start nginx

# Enable on boot if needed
sudo systemctl enable ollama nginx

# After editing nginx only
sudo nginx -t && sudo systemctl reload nginx
```

### Smoke test on the workstation

```bash
curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" \
  -H "X-API-Key: YOUR_KEY" \
  http://127.0.0.1:8080/v1/models
```

Expect **HTTP 200**. If you use a **proxy / VPN**, ensure the machine still listens on the address clients use (`compute_host` in Supabase or VS Code settings).

### Docker-based inference

If Ollama or a gateway runs in containers, start your usual stack (`docker compose up -d`, `docker start`, etc.) so something is listening on **8080** with the same **`X-API-Key`** contract as before.

### Client-side

After the service is healthy, in VS Code use **Request runtime sync** (or sign out/in) so the footer re-pings **Ultra AI compute**; then retry chat.

---

*Aligned with repository inspection; re-run when behavior changes materially.*
