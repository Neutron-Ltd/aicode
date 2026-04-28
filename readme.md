# Build Ultra — Product Requirements Document

**Implementation status (codebase audit):** ✅ done · ⚠️ partial / gap · ❌ not implemented (or not applicable yet).

---

## 1. Project Overview

✅ **Build Ultra** is a premium, high-agency VS Code extension designed to transcend the limitations of traditional chat-based coding assistants. It serves as an autonomous bridge between a developer’s local workspace and the **Ultra AI Compute Layer**—a high-performance, private infrastructure optimized for 2026-era frontier coding models.

✅ The core philosophy of Build Ultra is **Managed Privacy**. It uses a hybrid cloud-authenticated architecture where sensitive user data (authentication, billing quotas, and codebase metadata) is managed by a secure Supabase SaaS controller, while the actual heavy-compute AI reasoning can run on **operator-managed or dedicated compute** you configure—so speed and code privacy stay under your control without exposing hardware specifics in the product UI.

---

## 2. Technical Stack

### 2.1 Frontend Architecture

| Area | Choice | Status |
|------|--------|--------|
| **Framework** | React 18 with Zustand for lightweight state management | ✅ |
| **Styling** | Tailwind CSS, using `color-mix` to adapt to native VS Code theme variables (`var(--vscode-*)`) | ✅ |
| **Build** | Bundled via esbuild for performance and size | ✅ |

### 2.2 Backend SaaS Controller (Cloud)

| Area | Choice | Status |
|------|--------|--------|
| **Infrastructure** | Supabase Edge Functions (Deno runtime) | ✅ |
| **Database** | PostgreSQL with pgvector for codebase embeddings | ✅ |
| **Security** | Multi-layer JWT verification for user accounts and global “Master Prompts” | ✅ (Edge); ⚠️ Workstation chat does not use this path |

### 2.3 Ultra AI Compute Layer (Private Infrastructure)

| Area | Choice | Status |
|------|--------|--------|
| **Gateway** | Nginx reverse proxy (port 8080) enforcing `X-API-Key` and JWT validation | ⚠️ Extension sends `X-API-Key`; gateway is operator-managed |
| **Inference** | vLLM (throughput) and Ollama (flexibility) | ⚠️ Configurable URL/model only; engines not bundled |
| **Models** | Qwen 2.5 Coder (32B), DeepSeek-V3.1 Thinking, Gemini 2.5 Flash Lite | ⚠️ Defaults/strings only; not enforced in code |

---

## 3. Core Features & Requirements

### 3.1 Mandatory Auth & Quota Enforcement (Unified SaaS Model)

- ✅ **Unified access** — Local compute access requires a successful Supabase session. *(Chat only when `isLoggedIn`; `webview/src/App.tsx`. Workstation path requires JWT in `ApiService.sendWorkstationChatMessage`.)*
- ✅ **Unified quota reporting** — After streaming in Workstation mode, the extension captures `usage.total_tokens` when present or estimates via `(input + output) / 4`, then POSTs to `/functions/v1/log-usage`. *(Edge: `supabase/functions/log-usage/index.ts`; client: `ApiService.postWorkstationLogUsage` after each successful turn.)*
- ✅ **Kill-switch** — If `tokens_remaining <= 0`, the backend returns `401` / `402`, and the UI disables chat input. *(Cloud `402` → `handleChatHttpError` + `UPDATE_QUOTA` 0; Workstation preflight + `log-usage` `402`; `quotaReady` / `tokenQuota` gate `ChatScreen` `InputArea` and `sendUserMessage` in `ultraStore`.)*

### 3.2 Master Prompt Engine (The AI “Brain”)

- ✅ **Canonical source** — System prompts are fetched from the `master_prompts` table in Supabase. *(Cloud: `supabase/functions/chat/index.ts` `fetchMasterSystemPrompt`. Workstation: `AuthService.resolveDefaultMasterPrompt` uses the same query; offline/DB errors use `MASTER_SYSTEM_PROMPT_FALLBACK` in `src/chatPrompt/masterPrompt.ts`, aligned with the Edge fallback string.)*
- ✅ **Persona** — Ultra AI branding plus Chain-of-Thought (CoT) and `write_file` discipline come from the DB default row when the fetch succeeds (see seed migration). *(`.ultrarules` and editor context are still assembled via `PromptBuilderService` / `assembleMessages.ts`; see §4.3 for Tab/Edit coverage.)*
- ✅ **Query expansion** — Injects active file language, framework, and diagnostic context into vague prompts. *(Editor + diagnostics + terminal in `PromptBuilderService` / payload.)*

### 3.3 Ultra AI Chat Interface

- ✅ **Zero-jitter UX** — Streaming uses `overflow-anchor: auto` and `requestAnimationFrame` to avoid UI “shaking.” *(Scroll container in `MessageList.tsx`.)*
- ✅ **Stateful feedback** — `useDeferredValue` for smooth markdown rendering. *( `MessageList.tsx`.)*
- ✅ **Branding** — Every response is labeled “Ultra AI.” The “thinking” animation persists until the first token arrives. *(Assistant label + typing indicator in `MessageList.tsx`.)*

### 3.4 Direct File Manipulation (Autonomous Agency)

- ✅ **Recursive agentic loop** — If the model returns `tool_calls` (for example `read_file`), the extension executes them and re-invokes the model with results until an edit or final response is produced. *( `ApiService.ts` tool rounds.)*
- ✅ **One-line rule** — `write_file` must include a valid `range` (`startLine` / `endLine`, 1-based inclusive); `ToolExecutionService.writeFile` returns a tool error if it is missing or out of bounds. Whole-file rewrites use lines `1` through the document line count. Tool schemas require `range` in `openAiTools.ts` and the Edge `chat` function; default master prompt v2 is added in migration `20260428140000_master_prompt_write_file_range_v2.sql`.
- ✅ **WorkspaceEdit** — All edits go through `vscode.WorkspaceEdit` for single-action undo (Cmd+Z).

### 3.5 Codebase Indexing & Semantic Context (Cloud RAG)

- ✅ **Background scanning** — Debounced `onDidSaveTextDocument` in `extension.ts` calls `WorkspaceScannerService.indexDocumentOnSave` (Cloud mode, signed in). Incremental upsert uses `reindex: "incremental"` on the `embed` Edge function; full manual index sends `reindex: "full"`. `.gitignore` / `.buildultraignore` reuse the same ignore logic with a short TTL cache.
- ✅ **`.buildultraignore`** — Honored when collecting files for embeddings. *( `WorkspaceScannerService.ts`.)*
- ✅ **Intelligent context truncation** — Context bundle order: diagnostics → `.ultrarules` → editor (selection + active file / neighborhood) → RAG → terminal in `assembleMessages.ts`, Edge `chat/index.ts`, and `PromptBuilderService.buildToolFollowupContextBundle`. Shared char budget prunes **RAG, then active file excerpt, then rules**; diagnostics, selection, and terminal are not truncated in this pass. Large active files use a cursor neighborhood in `EditorService.getActiveFileContextForPrompt`.

### 3.6 Safety & Privacy Guardrails

- ✅ **Path blocklist** — `.env`, `.git`, `node_modules`, `dist`, and `build` path segments are blocked for tools in `toolPathGuards.ts` (`ToolExecutionService.resolvePath`).
- ✅ **Binary safety** — Shared `looksBinary.ts` and `MAX_TOOL_FILE_BYTES` for `WorkspaceScannerService` indexing and `ToolExecutionService` `read_file` (skip binary / reject oversize files).
- ✅ **Destructive protection** — Mutations go through webview tool-plan approval plus `vscode.diff` and Apply/Skip before execution. `write_file` without a valid line `range` fails with a tool error. *(**No `delete_file` tool** — destructive deletes are not exposed to the model.)*

### 3.7 Mutation Observer UI

- ✅ **Real-time visibility** — After the tool plan is confirmed, host posts `MUTATION_PROGRESS` lines from the `ApiService` tool loops (`read_file`, etc.); the webview shows them in `MutationBanner` (`webview/src/components/chat/MutationBanner.tsx`) below `ToolPlanPanel`.
- ✅ **Diff inspection** — Before `openMutationDiffAndConfirm` (`src/diffReview.ts`), the host posts `MUTATION_PROGRESS` with `diffAwaiting: true`; the banner explains the diff / Apply or Skip flow and offers **Focus editor** (`FOCUS_EDITOR_GROUPS` → `workbench.action.focusActiveEditorGroup` in `BuildUltraChatViewProvider.ts`).

### 3.8 Infrastructure Privacy

- ✅ **Zero-knowledge origin** — User-visible copy avoids infrastructure signaling: neutral **`buildUltra.computeHost`** (with legacy **`buildUltra.localIp`** fallback) in [package.json](package.json) / [buildUltraSettings.ts](src/buildUltraSettings.ts); mode **`enumDescriptions`**; no “gateway” jargon in [ApiService.ts](src/services/ApiService.ts), [WorkstationConnectionFooter.tsx](webview/src/components/chat/WorkstationConnectionFooter.tsx), or key prompts. Host console logs for indexing omit upstream response bodies ([WorkspaceScannerService.ts](src/services/WorkspaceScannerService.ts)). Stored mode values remain `Cloud` | `Workstation` for settings compatibility; chat/footer branding stays **Ultra AI** / **Ultra AI compute**.

---

## 4. Cursor-Grade Native Integration (“Magical” Layer)

### 4.1 Ultra Tab (Intelligent Autocomplete)

- ❌ **Ghost text** — `TextEditorDecorationType` for multi-line completions ahead of the cursor.
- ❌ **FIM (Fill-In-the-Middle)** — Send ~2,000 characters before and after the cursor to the local model for next-block prediction.
- ❌ **Debounced trigger** — Suggestions after ~50ms of typing idle to limit lag.

### 4.2 Ultra Edit (Cmd+K / Ctrl+K)

- ❌ **Inline input** — Floating input in the editor (native QuickInput or overlay).
- ❌ **Selection editing** — With a selection, Ultra AI produces a diff scoped to that selection.
- ❌ **Live diff** — Show proposed changes in a green/red inline diff; user **Accept** or **Reject** before apply.

### 4.3 Workspace Rules (`.ultrarules`)

- ⚠️ **Behavior injection** — Read `.ultrarules` at the repo root and inject as **system-level constraints** into every Tab and Edit request. *(Injected into **chat** context via `PromptBuilderService`; §4.1 / §4.2 features do not exist yet.)*

---

## 5. Performance & Observability

- ✅ **Telemetry** — PostHog for `tool_execution` and `user_undo_action`. *( `ToolExecutionService`, `aiUndoTelemetry.ts`, `telemetry.ts`, optional webview `posthog-js`.)*
- ✅ **Edit concurrency** — `AsyncSerialQueue` to avoid races during recursive loops. *( `toolExecutionQueue.ts`.)*

---

## 6. Future Enhancements

- ❌ **Multi-turn planning** — Visual edit plans (checklist) before execution. *(Not implemented as specified in §6; partial overlap with tool plan review only.)*
- ❌ **Terminal auto-debugging** — Capture terminal stack traces and suggest fixes automatically.

---

## 7. Remove or Replace (cleanup backlog)

Items to **delete, replace, or narrow** so the codebase matches the PRD and avoids misleading or dead surface area:

1. **Unused `ContextService`** — `src/services/ContextService.ts` is an empty stub; remove it or implement RAG/context orchestration there so the name matches behavior.
2. **Orphan / placeholder packages** — Periodically run dependency audit; remove unused npm deps and any experimental commands not registered in `package.json` / `extension.ts`.

---

*Last audited against the repository state at documentation update time.*
