# Mirror

**Mirror** is an AI coding assistant for Visual Studio Code. It pairs a **TypeScript extension host** with a **React + Tailwind** sidebar webview, authenticates users with **Supabase Auth** (email and password in the extension UI), and routes chat requests through a **Supabase Edge Function** so upstream API keys (for example **302.ai**) never ship inside the extension.

**Version:** 0.0.1 · **Publisher ID:** `mirror` (see `package.json`)

---

## Features

- **Chat sidebar** — Multi-model selection, markdown replies with syntax highlighting, and a **Remaining tokens** display in the header (placeholder until your backend drives `UPDATE_QUOTA`).
- **Streaming replies** — Assistant text streams in via typed `postMessage` events (`CHAT_STREAM_*`) for a live typing effect.
- **Editor context** — Prompts include the active file name, full document text, and current selection (see `PromptBuilderService` / `EditorService`).
- **Insert at Cursor** — Each fenced code block in assistant messages exposes an **Insert at Cursor** control that sends code to the active editor.
- **Workspace rules** — If `.mirrorrules` exists at the **workspace root**, its contents are included in the chat payload.
- **Secure by design** — Only the Supabase **anon** key is configured in VS Code settings; the user **JWT** is sent with Edge requests. **302.ai** (or other upstream) keys belong in Edge Function secrets / environment only.

---

## Architecture

```text
┌─────────────────────┐     postMessage      ┌──────────────────────────┐
│  Extension Host     │ ◄──────────────────► │  React webview (sidebar)  │
│  AuthService        │   typed protocol     │  Zustand + Tailwind       │
│  ApiService         │   (messages.ts)      │  LoginScreen / ChatScreen │
│  EditorService      │                      └──────────────────────────┘
│  PromptBuilderService
└──────────┬──────────┘
           │ HTTPS + JWT + apikey
           ▼
┌──────────────────────────┐      ┌─────────────────────────────┐
│  Supabase Auth           │      │  Edge Function `chat`       │
│  (session in secrets)    │      │  SSE stream, upstream AI keys │
└──────────────────────────┘      └─────────────────────────────┘
```

- **Bridge:** All webview ↔ host traffic uses the discriminated union types in [`src/shared/messages.ts`](src/shared/messages.ts).
- **Chat transport:** [`src/services/ApiService.ts`](src/services/ApiService.ts) calls `POST {supabaseUrl}/functions/v1/chat` with `Authorization: Bearer <access_token>` and `apikey: <anon key>`, then parses **SSE** (`data: {"delta":"..."}`) or falls back to non-streaming JSON.

---

## Requirements

- **VS Code** `^1.85.0` (see `engines` in `package.json`)
- **Node.js** 18+ and npm (for development and packaging)

---

## Installation

### From source (development)

1. Clone this repository.
2. `npm install`
3. `npm run compile` — compile the extension (`out/`)
4. `npm run build:webview` — build the webview bundle and CSS into `media/`
5. In VS Code, **Run → Start Debugging** (or F5) with the **Launch Extension** configuration to open an Extension Development Host with Mirror loaded.

### VSIX (local or CI)

```bash
npm run vscode:prepublish   # compile + build:webview
npx @vscode/vsce package
```

Install the generated `.vsix` via **Extensions → … → Install from VSIX…**.

### Marketplace

When published, install **Mirror** from the VS Code Marketplace (publisher: `mirror`). *(Update this section with the marketplace link once available.)*

---

## Configuration

Open **Settings** and search for **Mirror**, or edit `settings.json`:

| Setting | Description |
|--------|-------------|
| `mirror.supabaseUrl` | Supabase project URL (**Settings → API → Project URL**). |
| `mirror.supabaseAnonKey` | Supabase **anon (public)** key — never use the `service_role` key in the client. |
| `mirror.authProvider` | OAuth provider id (e.g. `github`) used only if you invoke the legacy OAuth flow from code; the default login UI uses **email/password**. |

---

## Supabase setup

### 1. Create a project

Create a project in [Supabase](https://supabase.com) and copy the **Project URL** and **anon public** key into the Mirror settings above.

### 2. Enable Email auth

In the Supabase dashboard: **Authentication → Providers → Email**. Enable the email provider so users can sign up and sign in from the extension’s login form.

- If **email confirmation** is required, new users may need to confirm by email before a session is issued; the extension surfaces the message returned by Supabase.

### 3. Deploy the `chat` Edge Function

The repository includes a deployable stub at [`supabase/functions/chat/index.ts`](supabase/functions/chat/index.ts).

```bash
# From your machine, with Supabase CLI linked to this project
supabase functions deploy chat
```

The function expects:

- **`SUPABASE_URL`** and **`SUPABASE_ANON_KEY`** — provided automatically in the Edge runtime when deployed on Supabase.
- Optional **`AI_UPSTREAM_KEY`** — for wiring a real **302.ai** (or other) call server-side; **do not** put this key in the extension.

**Contract (summary):**

- **Request:** `POST`, JSON body matching [`src/types/chatPayload.ts`](src/types/chatPayload.ts) (`query`, `modelId`, `workspaceRules`, `editorContext`).
- **Response:** `text/event-stream` with SSE lines `data: {"delta":"..."}` and optional `data: [DONE]`.

See the file header in `supabase/functions/chat/index.ts` for the full contract.

### 4. Optional: OAuth redirect (legacy)

If you still use **OAuth** via `signInWithOAuth` and the URI handler, add this redirect URL in Supabase **Authentication → URL Configuration → Redirect URLs**:

`vscode://mirror.mirror/auth`

---

## Usage

1. Set **`mirror.supabaseUrl`** and **`mirror.supabaseAnonKey`**.
2. Open the **Mirror** view from the activity bar (**Mirror** icon → **Mirror Chat**).
3. **Log In** or **Create Account** with email and password.
4. Choose a **model** in the header, type a message, and send. Use **Insert at Cursor** on code blocks to paste into the active editor.

**`.mirrorrules`:** Place a file named `.mirrorrules` in the **root of the first workspace folder** (UTF-8 text). Content is appended to the structured payload sent to the Edge Function.

---

## Development

| Script | Purpose |
|--------|---------|
| `npm run compile` | TypeScript compile for `src/` → `out/` |
| `npm run watch` | Watch mode for the extension |
| `npm run build:webview` | esbuild bundle + Tailwind CSS → `media/` |
| `npm run watch:webview` | Watch webview build |
| `npm run vscode:prepublish` | Prepublish: compile + webview build |

**Layout:**

- `src/` — Extension host (services, `MirrorChatViewProvider`, shared message types)
- `webview/src/` — React app
- `media/` — Built webview assets (generated)
- `supabase/functions/chat/` — Edge Function source

---

## Security and privacy

- **Passwords** are sent only from the webview to the extension host over the internal bridge and to Supabase for `signInWithPassword` / `signUp`; they are not stored in extension source or in a custom plaintext file.
- **Session material** is persisted through the Supabase client’s storage adapter backed by **`vscode.SecretStorage`** (see `AuthService`).
- **Upstream API keys** (302.ai, etc.) must live **only** in Supabase Edge secrets or environment — never in the VS Code workspace or extension package.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| “Set mirror.supabaseUrl…” | Fill both URL and anon key in Settings. |
| Auth errors | Email provider enabled; correct keys; email confirmation settings in Supabase. |
| Chat / network errors | Edge Function `chat` deployed; user is logged in; function logs in Supabase dashboard. |
| Insert at Cursor does nothing | Open a text editor and place the cursor where code should go. |

---

## Roadmap

Phase 2 ideas (from the product plan): richer **RAG / codebase indexing**, **terminal** context, and server-driven **token quota** updates via `UPDATE_QUOTA`.

---

## Disclaimer

AI-generated code can be incorrect or unsafe. You are responsible for reviewing and testing anything inserted into your project. Mirror is provided as-is, without warranty.

---

## Contributing

Issues and pull requests are welcome once a public repository and license are published. *(Add repository URL and contribution guidelines as needed.)*

---

## License

This repository does not yet include a `LICENSE` file. Add an explicit license (for example MIT or Apache-2.0) before publishing to the Marketplace or redistributing the extension.
