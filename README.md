# Mirror AI

**Mirror AI** is an AI coding assistant for Visual Studio Code. It combines a **TypeScript extension host** with a **React + Tailwind** sidebar webview, uses **Supabase Auth** for native in-extension login, and routes AI calls through **Supabase Edge Functions** so provider keys (e.g. 302.ai) never ship in the extension.

**Version:** `0.0.1`  
**Publisher ID:** `mirror` (from `package.json`)

---

## What’s implemented

- Native **email/password auth** in the webview (Supabase).
- Streaming chat with typed host/webview protocol.
- **Smart scrolling** in the chat list: auto-follows the stream only while you are near the bottom; scrolling up to read pauses follow until you scroll back down or send a new message (reduces jitter during long replies).
- Editor integration:
  - active file + selection context
  - **Apply** on each fenced code block: **replaces the current selection** if any, otherwise **inserts at the cursor** (undoable with Cmd/Ctrl+Z).
- Prompt enrichment:
  - `.mirrorrules` support
  - rolling terminal context capture.
- Quota flow:
  - enforced in edge (`public.user_quotas`)
  - updates sent back to webview header via `UPDATE_QUOTA`.
- RAG foundation:
  - pgvector migration (`workspace_documents`, RLS, `match_documents`)
  - workspace scanner + chunker
  - `embed` edge function for embeddings storage
  - `chat` edge retrieval injection (`## Codebase Context`).
- UI indexing integration:
  - **Index Workspace** button
  - loading state while indexing
  - index status/error events wired through the same message bridge.

---

## Architecture (current)

```text
┌──────────────────────────────┐      postMessage       ┌─────────────────────────────┐
│ Extension Host (TypeScript)  │ ◄────────────────────► │ React Webview (Sidebar)     │
│ - AuthService                │   typed protocol       │ - LoginScreen / ChatScreen  │
│ - ApiService                 │   (src/shared/messages)│ - Zustand store             │
│ - PromptBuilderService       │                        │ - Header + MessageList       │
│ - EditorService              │                        │ - Index Workspace button     │
│ - TerminalService            │                        └─────────────────────────────┘
│ - WorkspaceScannerService    │
└───────────────┬──────────────┘
                │ HTTPS + JWT + anon key
                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ Supabase                                                                     │
│ - Auth (session in SecretStorage adapter)                                    │
│ - Postgres + pgvector (`workspace_documents`, `match_documents`)             │
│ - Edge Functions:                                                             │
│    /chat  -> retrieval + streamed LLM response + quota deduction             │
│    /embed -> chunk embeddings + vector persistence                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Chat & model selection** in the sidebar header (defaults and labels are defined in `webview/src/types/chat.ts`; upstream IDs are mapped in the `chat` Edge Function for **302.ai**).
- **Token quota display** with live updates from edge responses.
- **Markdown + syntax-highlighted replies**.
- **Apply** button on code blocks (see *What’s implemented*).
- **Terminal-aware prompting** (recent terminal output).
- **Workspace indexing workflow**:
  - scans workspace recursively
  - respects `.gitignore`
  - hard-skips heavy dirs (`.git`, `node_modules`, `dist`, `build`)
  - chunks files with overlap
  - sends chunks to `/functions/v1/embed`.
- **RAG retrieval in chat**:
  - embeds incoming query
  - fetches top matches from `match_documents`
  - injects snippets into prompt as codebase context.

---

## Requirements

- **VS Code** `^1.85.0`
- **Node.js** 18+ and npm
- Supabase project with Edge Functions enabled

---

## Installation

### From source

1. Clone repo
2. `npm install`
3. `npm run compile`
4. `npm run build:webview`
5. Launch extension in VS Code via **Run/Debug** (F5)

### Package as VSIX

```bash
npm run vscode:prepublish
npx @vscode/vsce package
```

Install via **Extensions → … → Install from VSIX…**.

---

## Configuration

Configure in VS Code settings:

| Setting | Description |
|---|---|
| `mirror.supabaseUrl` | Supabase project URL |
| `mirror.supabaseAnonKey` | Supabase anon public key (never use service_role in client) |
| `mirror.authProvider` | Legacy OAuth provider id (optional/legacy path) |

---

## Supabase setup

### 1) Auth

- Enable **Email** provider in Supabase Auth.
- Extension uses native email/password forms.
- (Legacy optional) OAuth redirect: `vscode://mirror.mirror/auth`.

### 2) Database migration (pgvector + RLS)

Apply migration:

- [`supabase/migrations/20240101_init_vector.sql`](supabase/migrations/20240101_init_vector.sql)

It creates:

- `public.workspace_documents` with `embedding vector(1536)`
- strict RLS policies (`user_id = auth.uid()`)
- `public.match_documents(query_embedding, match_threshold, match_count)`.

### 3) Edge Functions

Set the **302.ai** API key as a Supabase secret (either name is supported by the `chat` function):

```bash
supabase secrets set THREETW_AI_API_KEY=<your_302_ai_key>
# or
supabase secrets set AI_UPSTREAM_KEY=<your_302_ai_key>
```

The **`embed`** function still expects **`AI_UPSTREAM_KEY`** for embeddings unless you align it separately.

Deploy both functions:

```bash
supabase functions deploy embed
supabase functions deploy chat
```

Optional override for the default chat model (otherwise the app default applies):

```bash
supabase secrets set MIRROR_DEFAULT_CHAT_MODEL=<302_model_id>
```

#### `embed` function

- File: [`supabase/functions/embed/index.ts`](supabase/functions/embed/index.ts)
- Input: `{ chunks: [{ file_path, content, chunk_index }] }`
- Behavior:
  - verifies JWT
  - batches embedding requests to `https://api.302.ai/v1/embeddings` (`text-embedding-3-small`)
  - persists vectors to `workspace_documents` under RLS user scope.

#### `chat` function

- File: [`supabase/functions/chat/index.ts`](supabase/functions/chat/index.ts)
- Behavior:
  - verifies JWT
  - checks quota in `public.user_quotas`
  - embeds user query and retrieves relevant docs via `match_documents`
  - injects `Codebase Context` into prompt
  - maps UI model ids to **302.ai** `model` strings for `https://api.302.ai/v1/chat/completions`
  - for some provider models, sends a **minimal** JSON body (no extra fields that can trigger gateway errors); others include `temperature` and `stream_options.include_usage` where supported
  - streams response as SSE to the extension
  - parses usage totals and deducts quota
  - emits `remaining_tokens` SSE payload for UI updates.

---

## Usage

1. Set `mirror.supabaseUrl` and `mirror.supabaseAnonKey`.
2. Open **Mirror AI** from the activity bar (sidebar view **Mirror AI**).
3. Log in (or create account).
4. Click **Index Workspace** to build/update vector index.
5. Send chat prompts; use **Apply** on a code block to insert or replace the selection in the active editor.

Prompt inputs include:

- `.mirrorrules` (workspace root)
- editor context (file + selection)
- terminal context
- retrieved codebase context (if indexed docs are available).

---

## Development

| Script | Purpose |
|---|---|
| `npm run compile` | Compile extension host TS (`src` → `out`) |
| `npm run watch` | Compile host in watch mode |
| `npm run build:webview` | Build webview JS/CSS into `media` |
| `npm run watch:webview` | Watch webview build |
| `npm run vscode:prepublish` | Prepublish build pipeline |

Project layout:

- `src/` — extension host and services
- `webview/src/` — React UI
- `media/` — built webview assets
- `supabase/migrations/` — SQL migrations
- `supabase/functions/chat/` — chat edge function
- `supabase/functions/embed/` — embeddings edge function

---

## Security notes

- User passwords are only used for Supabase auth and not stored as plaintext in project files.
- Session persistence uses VS Code `SecretStorage` via the Supabase storage adapter.
- Upstream provider keys (`THREETW_AI_API_KEY` / `AI_UPSTREAM_KEY` for chat; `AI_UPSTREAM_KEY` for `embed` as implemented) must remain server-side in Supabase secrets.
- DB reads/writes for indexing and retrieval rely on JWT + RLS isolation.

---

## Troubleshooting

| Issue | Check |
|---|---|
| Missing Supabase config | Set both `mirror.supabaseUrl` and `mirror.supabaseAnonKey` |
| Login fails | Email provider enabled and project keys correct |
| Indexing fails | `embed` deployed, `AI_UPSTREAM_KEY` set, user authenticated |
| Chat without RAG context | Ensure workspace indexed and vectors exist for current user |
| Quota errors | Check `public.user_quotas` row exists and has remaining tokens |
| Apply does nothing | Ensure an active text editor; selection/cursor target is valid |

---

## Disclaimer

AI output may be incorrect or unsafe. Always review and test generated code before applying in production.

---

## License

No `LICENSE` file is currently included. Add one (e.g. MIT/Apache-2.0) before wider distribution.
