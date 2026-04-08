Act as an Expert VS Code Extension Architect and Supabase PostgreSQL Database Administrator. 

We are building the final major feature of our SaaS AI coding assistant ("Mirror"): **Codebase Indexing (RAG) using Supabase pgvector**.

Phase 1 and the Phase 2 Quota/Terminal updates are fully working. **DO NOT** modify the existing Auth flow, the UI scaffolding, the `TerminalService`, or the core `postMessage` bridge. 

Your goal is to build a highly secure, multi-tenant RAG pipeline. 

**Task 1: Supabase Database Migration (Vector Setup)**
Write a new SQL file in `supabase/migrations/` (e.g., `20240101_init_vector.sql`) that does the following:
1. Enables the `vector` extension.
2. Creates a `workspace_documents` table with columns: `id` (uuid), `user_id` (uuid, FK to auth.users), `file_path` (text), `content` (text), and `embedding` (vector(1536)).
3. Enables strict Row-Level Security (RLS) so users can ONLY select/insert/update/delete rows where `user_id = auth.uid()`.
4. Creates a PostgreSQL function (e.g., `match_documents`) that takes a query embedding and a match threshold, and returns the most similar documents for the currently authenticated user.

**Task 2: Workspace Scanner (Extension Host)**
Create a new service: `src/services/WorkspaceScannerService.ts`.
1. Implement a method to recursively read the user's current VS Code workspace folders.
2. **Crucial:** It MUST respect `.gitignore` and hard-ignore heavy folders (`node_modules`, `.git`, `dist`, `build`).
3. Implement a chunking utility to split large files into manageable text blocks (e.g., ~1000 tokens/characters per chunk with slight overlap) while retaining the `file_path`.
4. Create an `indexWorkspace()` method that takes these chunks and sends them securely to a new Supabase Edge Function (see Task 3).

**Task 3: Edge Functions (Embedding & Retrieval)**
1. Create a new Edge Function: `supabase/functions/embed/index.ts`. This function must take the workspace chunks from Task 2, call the upstream embedding API (e.g., OpenAI `text-embedding-3-small` via the 302.ai API key), and insert the resulting vectors into the `workspace_documents` table using the user's JWT.
2. **Update existing `chat` Edge Function:** Before calling the upstream LLM for the chat stream, embed the user's incoming `query`. Call the `match_documents` Postgres function to retrieve the top 3-5 relevant code chunks.
3. Inject these retrieved chunks into the `system` prompt as "Codebase Context" alongside the existing `terminalContext` and `workspaceRules`.

**Task 4: UI Integration (React)**
1. In the React Webview header, add a subtle, stylish "Index Workspace" button (perhaps an icon).
2. Wire this button to send an `INDEX_WORKSPACE` message to the Extension Host to trigger `WorkspaceScannerService.indexWorkspace()`.
3. Show a loading state/spinner on the button while indexing is in progress.

Please review the current codebase, acknowledge this architecture, and execute Tasks 1 through 4 sequentially. Write clean, heavily commented code.