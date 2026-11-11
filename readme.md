# Build Ultra

Build Ultra is an AI coding assistant delivered as a VS Code extension. It provides a sidebar chat (**Ultra AI**) that can run in two ways: through a hosted cloud backend (with account sign-in, optional codebase indexing, and usage limits) or against **private compute**—an OpenAI-compatible language-model server you configure and run yourself. The companion Supabase project supplies edge functions, embeddings, quotas, and billing hooks when you use the cloud path.

---

## Getting started

Requirements: Node.js 20+, npm, and VS Code 1.85 or newer.

```bash
git clone https://github.com/Neutron-Ltd/aicode.git
cd aicode
npm install
cp .env.example .env   # optional: your own Supabase URL and anon key
npm run compile
npm run build:webview
```

Open the folder in VS Code and press **F5** to launch an Extension Development Host with the sidebar loaded.

- **Private compute only:** no `.env` is needed. Leave it empty, then point the extension at any OpenAI-compatible server from the sidebar settings.
- **Cloud mode:** requires your own Supabase project; see below. This repository does not ship credentials for any hosted backend.

To package a `.vsix`, run `npx vsce package`. The `vscode:prepublish` script runs both builds.

## Self-hosting the backend

The cloud path (sign-in, codebase indexing, quotas, billing) runs on [Supabase](https://supabase.com). To run your own:

1. Create a Supabase project and enable the `vector` extension (the first migration also does this).
2. Link and push the schema:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   Before exposing the project to users, review the Row-Level Security policies in `supabase/migrations/`.
3. Set the Edge Function secrets. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by Supabase.

   | Secret | Required | Purpose |
   |---|---|---|
   | `AI_UPSTREAM_KEY` | Yes | API key for your OpenAI-compatible upstream (`THREETW_AI_API_KEY` is accepted as a legacy alias) |
   | `BUILD_ULTRA_UPSTREAM_CHAT_URL` | Yes | Full URL of the upstream `/v1/chat/completions` endpoint |
   | `BUILD_ULTRA_UPSTREAM_EMBEDDINGS_URL` | For indexing | Full URL of the upstream `/v1/embeddings` endpoint |
   | `BUILD_ULTRA_DEFAULT_CHAT_MODEL` | No | Model used when the client does not pick one |
   | `BUILD_ULTRA_UPSTREAM_FORMAT` | No | Request format; only `openai` is currently supported |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | For billing | Used by `stripe-webhook` to map subscriptions to quota tiers |

   ```bash
   supabase secrets set AI_UPSTREAM_KEY=... BUILD_ULTRA_UPSTREAM_CHAT_URL=...
   ```
4. Deploy the functions: `supabase functions deploy` (JWT verification settings are in `supabase/config.toml`; each function validates the caller itself).
5. Put your project URL and **publishable/anon** key in `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and rebuild with `npm run compile`. Never put the `service_role` key in `.env`; it would be bundled into the extension.

The system prompt sent with each cloud request is read from the `master_prompts` table. `prompt.md` is a human-readable reference copy and is not loaded automatically.

## Contributing, security, and license

- Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Released under the [MIT License](LICENSE).

---

## Repository tree

Excludes generated lockfiles, packaged `node_modules`, local Supabase CLI cache (`.temp`), and source maps. Files marked _(generated)_ are produced by the build and not committed.

```
.
├── .env.example
├── .gitignore
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── .vscodeignore
├── CONTRIBUTING.md
├── LICENSE
├── SECURITY.md
├── media/
│   ├── icon.svg
│   ├── index.js          (generated)
│   └── webview.css       (generated)
├── package.json
├── postcss.config.js
├── prompt.md
├── readme.md
├── scripts/
│   └── gen-config.mjs
├── src/
│   ├── aiUndoTelemetry.ts
│   ├── buildUltraSettings.ts
│   ├── BuildUltraChatViewProvider.ts
│   ├── chatPrompt/
│   │   ├── assembleMessages.ts
│   │   ├── masterPrompt.ts
│   │   ├── openAiTools.ts
│   │   ├── sanitizeMessages.ts
│   │   └── workstationRequest.ts
│   ├── config.generated.ts   (generated)
│   ├── config.ts
│   ├── diffReview.ts
│   ├── extension.ts
│   ├── mutationHighlight.ts
│   ├── openAiCompatibleStream.ts
│   ├── services/
│   │   ├── ApiService.ts
│   │   ├── AuthService.ts
│   │   ├── ContextService.ts
│   │   ├── EditorService.ts
│   │   ├── postEditDiagnostics.ts
│   │   ├── PromptBuilderService.ts
│   │   ├── TerminalService.ts
│   │   ├── toolExecutionQueue.ts
│   │   ├── ToolExecutionService.ts
│   │   └── WorkspaceScannerService.ts
│   ├── shared/
│   │   └── messages.ts
│   ├── telemetry.ts
│   ├── tooling/
│   │   ├── looksBinary.ts
│   │   ├── searchReplaceWithinLines.test.ts
│   │   ├── searchReplaceWithinLines.ts
│   │   └── toolPathGuards.ts
│   ├── toolCallTextRecovery.ts
│   ├── toolPlanParse.ts
│   ├── types/
│   │   └── chatPayload.ts
│   └── virtualDocumentProvider.ts
├── supabase/
│   ├── config.toml
│   ├── functions/
│   │   ├── chat/
│   │   │   └── index.ts
│   │   ├── embed/
│   │   │   └── index.ts
│   │   ├── get-private-compute-credentials/
│   │   │   └── index.ts
│   │   ├── log-usage/
│   │   │   └── index.ts
│   │   └── stripe-webhook/
│   │       └── index.ts
│   └── migrations/
│       ├── 20240101_init_vector.sql
│       ├── 20240409_create_user_quotas.sql
│       ├── 20260414120000_master_prompts_and_quotas_tier.sql
│       ├── 20260415140000_prd_section3_quotas_rate_master_rls.sql
│       ├── 20260415140001_seed_default_master_prompt.sql
│       ├── 20260428140000_master_prompt_write_file_range_v2.sql
│       ├── 20260428180000_user_private_compute.sql
│       └── 20260428200000_user_private_compute_api_key.sql
├── tailwind.config.js
├── tsconfig.json
├── webview/
│   ├── esbuild.mjs
│   ├── tsconfig.json
│   └── src/
│       ├── App.tsx
│       ├── bridge/
│       │   └── initHostBridge.ts
│       ├── components/
│       │   └── chat/
│       │       ├── ChatErrorBanner.tsx
│       │       ├── CodeBlock.tsx
│       │       ├── EditReviewBanner.tsx
│       │       ├── Header.tsx
│       │       ├── InputArea.tsx
│       │       ├── MarkdownMessage.tsx
│       │       ├── MessageList.tsx
│       │       ├── MutationBanner.tsx
│       │       ├── SettingsPanel.tsx
│       │       ├── ToolPlanPanel.tsx
│       │       └── WorkstationConnectionFooter.tsx
│       ├── hooks/
│       │   └── usePrefersDark.ts
│       ├── index.css
│       ├── initPosthog.ts
│       ├── main.tsx
│       ├── posthogConfig.ts
│       ├── screens/
│       │   ├── ChatScreen.tsx
│       │   └── LoginScreen.tsx
│       ├── store/
│       │   └── ultraStore.ts
│       ├── types/
│       │   └── chat.ts
│       └── vscodeApi.ts
```

---

## What lives where

These notes describe **purpose**, not exhaustive exports.

- **`src/extension.ts`** — Registers the sidebar webview provider, bundles services (auth, API, indexer, prompt builder), subscribes to workspace save events for incremental indexing hooks, exposes command handlers, applies configuration watchers, wires telemetry teardown.
- **`src/BuildUltraChatViewProvider.ts`** — Builds offline HTML for the webview with a strict content-security policy; bridges host ↔ UI messages (login, send chat, logout, indexing, inserts, workstation reachability pings); pushes runtime mode updates to React.
- **`src/buildUltraSettings.ts`** — Reads and writes VS Code workspace or user settings plus extension-held cache for workstation host and default model; resolves URLs for completions and catalog endpoints; persists private compute secrets via secure storage helpers.
- **`src/config.ts` / `src/config.generated.ts`** — Static and generated Supabase URLs and anon key for bundled builds. `config.generated.ts` is written from `.env` by `scripts/gen-config.mjs` on every compile and is not committed.
- **`src/shared/messages.ts`** — Typed payloads for ping/pong, auth outcomes, quota updates, chat streaming events, indexing results, tooling progress, staged edit-review state, obsolete tool-plan handshakes the UI may still deserialize.
- **`src/services/`** — **Auth**: Supabase PKCE sessions in secret-backed storage, login/register/logout, quota fetch after login, master prompt prefetch, cloud-held workstation linkage sync. **API**: streaming chat orchestration for cloud versus workstation targets, repeated tool-call rounds, edit-review bookkeeping, assistant markdown injection. **Prompt builder**: assembles payloads with rules file, diagnostics, editor buffer and selection plus terminal placeholder. **Tools**: guarded filesystem operations in a serialized queue with version stamping and indentation helpers for ranged writes. **Editor / terminal helpers**: caret context and insert-at-selection behavior versus empty selection; terminal context stub mirroring Marketplace constraints. **Indexer**: chunked walks with ignore-pattern merging, incremental embed payloads. **Supporting**: diagnostic formatting appended after edits, telemetry hooks for undo snapshots, bounded search-replace within line regions.
- **`src/chatPrompt/`** — Truncating context bundles to approximate token budgets mirroring backend rules; sanitizing conversational wire format for upstream calls; workstation JSON bodies aligned with streaming clients; mirrored tool definitions consumed where the extension assembles completions locally.
- **`src/tooling/`** — Binary sniffing byte caps and disallowed folders for tools; guarded path predicates shared with indexer; line-bounded substring replacement utilities and their unit tests.
- **`src/openAiCompatibleStream.ts` / `src/toolCallTextRecovery.ts`** — Parsing server-sent-event frames for deltas, errors, tooling directives, quota hints; resurrecting malformed tool intents from conversational Markdown.
- **`src/mutationHighlight.ts` / `src/aiUndoTelemetry.ts` / `src/telemetry.ts`** — Decorative ranges after edits; pre-edit snapshots for undo; aggregated extension-level analytics events.
- **`src/types/chatPayload.ts`** — Shape of payloads crossing from editor context into cloud workloads.
- **`src/toolPlanParse.ts`** — Utility work around parsing narrated tooling plans where still referenced.
- **`src/diffReview.ts` / `src/virtualDocumentProvider.ts`** — **Dormant in this checkout:** definitions for preview/virtual diff flows are not registered from activation; retained for future experimentation.
- **`media/`** — Compiled web bundles and Tailwind-derived stylesheet referenced by URI from the sidebar webview, generated by `npm run build:webview` and not committed (`icon.svg` for activity bar branding is the only tracked asset).
- **`webview/src/`** — React entry screens (login versus chat shell), centralized Zustand store applying host patches, Markdown rendering with fenced code insertion actions, overlays for errors, quotas, workstation status, editable review ribbons, Tailwind typography.
- **`webview/esbuild.mjs` / Tailwind tooling** (`tailwind.config.js`, `postcss.config.js`, root `package.json`) — Build pipeline for SPA assets plus extension compile script.
- **`prompt.md`** (repository root) — Human-authored system prompt prose in plain text; not automatically wired to hosted chat (see database-backed master prompts in cloud migrations).
- **`supabase/functions/chat/`** — Authenticated routing to upstream gateways, quotas, embeddings-driven retrieval budgeting, sanitized maintenance responses, streamed tooling metadata.
- **`supabase/functions/embed/`** — Validated ingestion of chunk batches feeding vector search with incremental replace semantics.
- **`supabase/functions/stripe-webhook/`** — Validates signed billing events then maps subscription tiers onto stored monthly token ceilings and refill cadences.
- **`supabase/functions/log-usage/`** — Accepts summarized token totals from workstation sessions so allotment accounting stays coherent.
- **`supabase/functions/get-private-compute-credentials/`** — Returns masked-or scoped workstation metadata keyed to authenticated users rather than widening table policies.
- **`supabase/migrations/`** — Vector storage, quotas, tiers, seeded master directives, writable prompt revisions, workstation columns, Row-Level Security and rate scaffolding.
- **`.vscode/`** — Debugging and task definitions for iterating the extension.
- **`.env.example`** — Hint file for embedding Supabase anon URL keys into generated config during CI or local publishes.

---

## Features

_Product behavior only: no paths, filenames, identifiers, configuration keys, database object names, or wire-format spellings._

### Editor integration and shell

- **Sidebar presence** — A dedicated container in the VS Code activity bar hosts the branded chat surface beside your files.
- **Single primary view** — The assistant UI loads as one webview sidebar entry focused on conversational coding assistance.
- **Retained DOM when hidden** — Switching editors or collapsing the sidebar keeps the SPA alive so streamed history and drafts are usually preserved without a full reload.
- **Restricted script and style sourcing** — The HTML declares a CSP that trusts only hashed inline bootstrappers and bundled static assets plus optional analytics egress when keys exist.
- **Bidirectional scripting bridge** — The React layer posts structured intents upward; native code answers with streamed tokens, bookkeeping events, heartbeat replies, quota refreshes, and authentication outcomes.
- **Focus handoff** — A dedicated gesture asks the IDE to emphasize the ordinary code editor pane after acting on snippets from chat.

### Account and authentication

- **Email and password authentication** — Sign-in submits credentials to hosted auth; registrations follow the provider’s signup semantics.
- **Post-register flows** — If instant session issuance is withheld pending mailbox confirmation, the operator sees explanatory copy rather than a silent failure.
- **Session durability** — Auth tokens hydrate from encrypted secret storage blobs so reloading the IDE generally keeps you logged in.
- **Immediate restore on pane focus** — On webview readiness a background pass looks for persisted sessions before choosing login chrome versus conversation chrome.
- **Logout hygiene** — Ending session clears synced workstation cache fields, wipes stored secrets for compute keys bundled with logout, resets prompt caches tied to profiles, notifies the SPA to purge chat affordances and counters.
- **Operator messaging** — Missing bundled backend URL or anon key surfaces explicit configuration errors rather than opaque crashes.

### Runtime modes

- **Cloud mode** — End-user requests traverse remote edge layers that can orchestrate quotas, embeddings, and upstream gateways while keys stay outside the workstation.
- **Workstation mode** — The desktop extension chats directly against operator-run inference gateways on a predetermined local-network port pairing, still honoring tooling execution entirely on-disk.
- **Runtime toggling** — Flipping editors’ packaged mode updates the SPA immediately plus changes whether periodic reachability pings run versus remain idle.
- **Private compute probing** — Periodic reachability checks against the inference catalog on the configured local pairing run on a timer and whenever relevant settings flip; surfaced statuses communicate misconfiguration versus outage versus authorization failures without dumping raw connection strings into the sidebar.
- **Hint taxonomy** — “Configure” communicates missing linkage; “unreachable” distinguishes network outage; “denied” calls out probable credential mismatch.

### Conversation experience inside the SPA

- **Multiline drafting** — A textarea expands up to a comfort cap so longer prompts wrap naturally.
- **Keyboard ergonomics** — Plain Enter sends when non-empty; Shift+Enter commits literal newlines; inline hint reminds users.
- **Send button gating** — The button activates only once trimmed text exists, mirroring keyboard logic.
- **Streaming assistant deltas** — Incrementally streamed payload chunks append to an assistant bubble so partial answers appear live.
- **Model streaming phase flag** — Distinguishes “assistant still receiving tokens” from later steps where tools churn without locking the UX identically everywhere.
- **Typing affordance** — When the newest bubble is awaiting content or the user spoke last, a subdued indicator conveys background work.
- **Empty completion fallback** — If a stream terminates with no assistant characters, conversational copy substitutes a courteous retry plea.
- **Error ribbon** — Transient outage or malformed exchange surfaces dismissible explanatory text outside the threaded transcript itself.
- **Maintenance ribbon** — Distinguishable card-style warning when gateways intentionally return degraded metadata so messaging stays brand-safe versus raw provider traces.
- **Scroll coupling** — Autoscrolling tracks growth while the patron sits near the bottom; manual scroll-away suspends pinning until another user send restarts chasing.
- **Rendering performance** — The chat UI runtime defers heavyweight Markdown reconciliation during bursty deltas to lessen jank inside constrained webviews.

### Readable assistant output

- **Markdown pipeline** — Headings, lists, emphasis, and pipe-style tables render faithfully with typography tuned to editor themes.
- **Syntax-highlighted code fences** — Language-tagged snippets pick palette styles aligned to common highlighters bundled for offline use.
- **Insert-from-snippet hooks** — Each fence may expose inserting raw text straight into whichever editor pane is active according to caret or selection precedence.
- **Clear transcript** — Header icon wipes history while blocking concurrency with an in-flight turn to avoid orphaned server work confusing the patron.
- **Branded affordances versus raw structured payloads** — Status lines narrate intangible operations (“Reading…” / “Updating…”) referencing relative paths politely.

### Workspace awareness forwarded to brains

- **Optional rules dossier** — A plaintext norms file anchored at workspace root is ingested verbatim when readable; omission yields an explicit sentinel line so models know conventions are absent rather than undisclosed.
- **Active-file awareness** — Basename labeling plus either total buffer extraction or excerpt windows centered on caret with narrated numeric line ranges preserves orientation on huge repositories.
- **Selection capture** — Exact highlighted spans ride alongside full buffer context whenever something is actively selected versus collapsed caret.
- **Diagnostics digest** — A bounded bullet digest summarizing severity-sorted Problems entries for whichever document last had editor focus complements code itself.
- **Terminal snapshot placeholder** — The payload retains structural room for multiplexed terminals; published builds leave this empty owing to Experimental API gates on Marketplace channels (document honestly as dormant rather than falsely claiming live tailing).

### Exclusive cloud-side indexing workflows

- **Manual full sweep** — A header control kicks off crawling every workspace folder, refused only when workstation mode is active—with reason surfaced to change modes first.
- **Multi-root honor** — Each opened folder merges ignore recipes before enumeration.
- **Ignore fusion** — Version-control exclusion lists combine with additive extension-defined ignore snippets per root.
- **Hard-skipped subtrees** — Certain heavy vendor trees always bypass embedding for safety and turnaround.
- **Binary and media filtering** — Long rosters of immutable asset extensions plus odd names like Finder metadata blobs never leave the workstation for embedding.
- **Chunking knobs** — Text splits into overlapping windows capped by configurable character extents before upload batches.
- **Indexing upload discipline** — Chunks obey server-enforced cardinality and text encoding limits when sent for embedding; invalid batches bubble up as actionable editor notifications.
- **Incremental save hook** — Saves debounced a couple seconds recompute embeddings only for altered relative paths silently so living documents stay searchable without redoing planetary scans.
- **Failure isolation** — Background incremental passes log quietly without spamming the SPA when networks blip whereas explicit manual runs announce failure banners.

### Retrieval-augmented reasoning (hosted path only)

- **Query vectorization** — Each fresh user-authored turn may embed conversational text through the same embeddings stack as codebase chunks whenever hosted routing allows.
- **Similarity-ranked snippets** — Vector distance ranking injects explanatory extracts into synthesized system-user bundles before hitting gateways.
- **Character budgeting** — A generous but finite textual budget caps combined rules, codebase hints, and file excerpts simultaneously; truncation drops lowest-valence blocks first while annotating truncation with bracketed placeholders so models infer missing tail context was budgeted away rather than hallucinated absent.
- **Follow-up caveat** — After tool executions the contextual summary explicitly states indexed-codebase sections are omitted intentionally to coerce reliance on freshest tool-returned excerpts.

### Tooling and grounded filesystem actions

Permitted conversational tools include:

1. **Read text** — Decodes human-readable text files under arbitrary relative paths respecting workspace roots; rejects above byte ceilings and binary-like octet patterns with polite explanations.
2. **Replace line ranges** — Accepts inclusive one-based spans to overwrite interior sections and supports whole-document replacement when extents equal measured line totals per prior read discipline.
3. **Exact textual substitution** — Optional global replacement flags or positional disambiguation when duplicate substrings collide; mandates verbatim whitespace fidelity to last read payloads.
4. **Create anew** — Materializes absent relative files with deterministic parent folder creation semantics as allowed by tooling implementation.
5. **Directory inventory** — Non-hidden filenames within relative directories return as listings for orientation.

Operational guarantees:

- **Workspace confinement** — Paths cannot symlink-escape upward beyond root folders resolved by tooling.
- **Sensitive path blocking** — Secret env filenames, DVCS internals, heavyweight dependency trees, mirrored between indexer exclusions and tooling guardrails remain unreachable.
- **Single-flight mutation queue** — A globally serialized queue avoids overlapping edits from parallel tool intents racing each other.
- **Semantic document versions** — Ranged writes stash expected textual document generations; divergence aborts stale writes urging re-read reconciliation.
- **Indent harmonization helpers** — When substituting modeled multi-line payloads into differently indented originals, tooling may align leading whitespace referencing first-line context.
- **Post-edit diagnostics append** — After mutating edits, tooling responses may concatenate newly surfaced Problems excerpts so iterative repair loops see fresh lint states.
- **Human-readable progress lines** — Inline italic status rows narrate which relative path is being touched per operation class.
- **Telemetry classification** — Each tool exit records coarse success versus failure without shipping entire buffers outward.

### Review, undo, and visual feedback after automated edits

- **Changed-range decoration** — Successful mutating operations may highlight altered spans until acknowledged.
- **Snapshot undo** — Before irreversible apply, buffer snapshots record pre-image bytes enabling full-file restoration when canceling from chat.
- **Approve path** — Accepting changes clears highlights and forgets snapshots while leaving edits committed.
- **Undo path** — The rollback flow reopens affected documents when needed, wholesale replaces edited text using the buffered snapshot, then clears highlights and dismissed review ribbons.
- **Collapsing duplicate reviews** — Fresh automation on the same path supersedes earlier pending review banners and highlight handles.
- **Markdown presentation hardening** — Sanitization trims riskier constructs from assistant-authored markup before the chat renders it.

### Resilience when models mis-emit structure

- **Fence unwrapping** — Structured tool-call arguments echoed inside fenced code blocks can still be salvaged despite streaming jitter.
- **Balanced-brace scanning** — Heuristics walk strings respecting escapes to recover argument objects from streaming glitches.
- **Allowed-name allowlists** — Only sanctioned tool labels become resurrected wire calls; everything else stays conversational text.
- **Duplicate failure suppression** — Fingerprints of arguments that just failed are skipped once on the immediate next round to dampen thrash loops.

### Multi-step agentic turns

- **Bounded loops** — Configurable maximum count of consecutive model↔tool cycles prevents infinite ping-pong on pathological outputs.
- **Conversation overrides** — Later completions traffic may abandon the simplistic first-turn envelope in favor of a full multimessage transcript that includes synthesized tool narration so gateways stay authoritative.
- **Assistant markdown interleaving** — Besides raw streaming tokens, host may push consolidated Markdown segments after tool phases to keep UI polished.

### Quotas, usage, and commercial plumbing (cloud)

- **Preflight balance checks** — Hosted chat refuses to forward when remaining monthly-style allotments are exhausted, returning payment-needed semantics to clients.
- **Post-call accounting** — Successful completions deduct measured token tallies; missing usage metadata falls back to conservative estimation so ledgers still move.
- **Live balance mirroring** — Successful auth pushes remaining headroom into account drawer UI; mid-session updates can refresh counts after calls.
- **Tiered ceilings** — Webhook listeners map commercial product handles onto large numeric monthly budgets with separate rungs for free, mid, and premium analogs.
- **Subscription lifecycle** — Checkout completion may reset burn counters and lift ceilings; subscription renewals can zero usage counters and schedule next refill timestamps when payment provider metadata is available.

### Workstation usage accounting

- **Optional quota relay** — After local inference completes, clients may voluntarily report aggregate token consumption so hosted ledgers decrement identically to cloud-routed chats, preserving one subscription ledger.

### Private compute onboarding and secrets

- **Secret storage preference** — Sensitive API material should live in OS-backed secret storage with interactive prompts; legacy plaintext settings remain as backward-compatible inferior fallback readers only.
- **Cloud-provisioned workstation fields** — Linking workflows push hostnames, friendly default model labels, and sometimes server-hosted API blobs down to workstations post-login automatically.
- **Palette commands** — One command stores private keys; another walks linking host plus optional defaults into cloud profile tables mirrored locally.
- **Priority chain** — Editor-level overrides beat cloud-synchronized placeholders when patrons intentionally diverge machines.
- **Logout secret purge** — Session end strips mirrored secrets so shared machines regain safety.

### Security, rate, and resilience notes on edge

- **Cross-origin allowances** — Handlers allow browser and desktop clients to preflight and call from expected origins without ad-hoc widening.
- **Credential validation** — Public application keys paired with authenticated user sessions must satisfy policy before any database-backed step runs.
- **Per-minute throttle** — A lightweight counter rejects abusive burst traffic before incurring inference spend.
- **Maintenance facade** — When upstream connectors fail gracefully, callers receive an opaque standardized maintenance envelope instead of raw stack traces leaking vendor internals.

### Build, packaging, compatibility

- **Single compile graph** — Host extension bytecode and sidebar UI bundles are emitted from coordinated root scripts so publishes stay repeatable.
- **Generated constants** — Environment-provided URLs and keys are folded into generated sources at compile time rather than edited by hand before packaging.
- **CSS extraction** — Utility-first authoring compiles down to one minified stylesheet shipped beside the scripted bundle.
- **Engine floor** — The extension manifest advertises the minimum editor host generation required so modern DOM-dependent UI can rely on baseline capabilities.

### Optional analytics

- **Webview instantiation beacon** — If keys exist, SPA startup fires one capture event with memory-only persistence, autocapture suppressed, replay disabled respecting privacy norms.
- **Extension lifecycle hooks** — Registration subscribes diagnostic listeners for undone AI edits unrelated to conversational loop but useful for roadmap metrics.

### Scaffolding noted but not user-facing in this build

- **Batch tool-plan preview component** — A standalone confirmation drawer and matching host messages exist for multi-step tooling batches, yet the shipped chat chrome never mounts them and host-side confirmation handlers are deliberately inactive—potential future UX without exposing behavior today.
- **Virtual diff preview modules** — Code for virtual document previews survives in-tree but activation never wires it—no surfaced command binds end users today.

---

_End note: the numbered feature catalog avoids implementation identifiers; paired sections above the horizontal rule map concrete files to roles._