Mirror VS Code Extension: SaaS Architecture & Implementation Plan

Role & Persona

Act as an Expert VS Code Extension Architect, Backend Strategist, and Senior React/TypeScript Developer. Your goal is to build a high-performance, visually stunning AI coding assistant extension called "Mirror", designed as a public SaaS product. You write clean, modular, and extensively commented code. You prioritize top-tier UI/UX and secure, robust architecture.

Project Overview

"Mirror" is an AI-powered VS Code extension similar to Cursor, operating on a SaaS model. We are building the core foundation today (Phase 1). The architecture MUST be designed to securely communicate with Supabase, handle user authentication directly within the extension (OAuth/JWT), seamlessly read/write to the VS Code editor, and properly structure prompts for optimal AI output.

Building Today (Phase 1 - SaaS Foundation):

VS Code Extension boilerplate with a React Webview Sidebar.

Stunning, native-feeling UI using Tailwind CSS.

Supabase Authentication: Secure native login flow using VS Code URI Handlers interacting directly with Supabase Auth.

Editor Integration: Ability to read the user's active file/highlighted text and automatically insert generated code back into the editor.

Prompt Engineering Pipeline: A localized prompt builder that reads workspace rules (e.g., .mirrorrules) and formats the user's intent.

Supabase Edge Functions: All AI requests route through Supabase Edge Functions, which inject the Master System Prompt, manage 302.ai API keys securely, and track token quotas.

Coming in the Future (Phase 2 - DO NOT BUILD LOGIC NOW, JUST STUB ARCHITECTURE):

Context Window / Codebase Indexing: Expect to receive injected context strings from local RAG/vector searches.

Terminal Access: Expect an event stream of terminal output and errors.

Architectural Rules (Strict)

Separation of Concerns: The Extension Host (Node.js) and the Webview (React) must be strictly separated. They communicate ONLY via a robust message-passing interface (postMessage).

Security & API Keys: The extension MUST NEVER contain the 302.ai API key. It only communicates with your Supabase instance using the user's secure Supabase Session Token.

Webview Security: The React webview must implement a strict Content Security Policy (CSP) and use webview.asWebviewUri to load local React build assets.

Future-Proof Services: Create empty service files/classes in the Extension Host for ContextService.ts and TerminalService.ts.

Execution Plan: Step-by-Step Chunks

User Note: Feed these chunks to Cursor's Composer or Chat one at a time. Do not move to the next chunk until the current one is fully working and bug-free.

Chunk 1: Foundation & Scaffolding

Goal: Set up the basic extension and React webview with Tailwind.
Instructions for Cursor:

Initialize a new VS Code extension project using TypeScript. Install @supabase/supabase-js.

Set up a Webview Provider that registers a sidebar panel (MirrorChatViewProvider).

Inside the Webview, set up a React application build pipeline (using esbuild or Webpack). Ensure proper configuration for VS Code (handling Webview URIs and CSP).

Install and configure Tailwind CSS for the React app. Ensure the Tailwind configuration adapts to the user's current VS Code theme.

Create placeholder files in the extension src/services/ folder: AuthService.ts, ApiService.ts, EditorService.ts, ContextService.ts, TerminalService.ts, and PromptBuilderService.ts.

Chunk 2: Top-Tier UI/UX Design (React)

Goal: Build the visual interface of the chat and login screens.
Instructions for Cursor:

Build a beautiful, modern React UI. It must feel premium—use rounded corners, subtle borders, and smooth transitions.

Create a LoginScreen component with a polished "Sign in to Mirror" button.

Create the main ChatScreen containing:

A Header component with a dropdown for Model Selection (e.g., Claude 3.5, GPT-4o) and a display showing the user's Remaining Token Quota.

A MessageList component that renders user and AI messages. Implement markdown rendering with syntax highlighting.

Crucial UI addition: Every rendered code block in the chat must have a subtle "Insert at Cursor" or "Apply" button inside its top-right corner.

An InputArea component with an auto-expanding textarea.

Ensure the UI looks perfect in both VS Code Dark and Light themes.

Chunk 3: The Communication Bridge & State

Goal: Connect the React UI to the VS Code Extension Host.
Instructions for Cursor:

Implement a robust message-passing utility. Define TypeScript interfaces for every message type (e.g., REQUIRE_LOGIN, LOGIN_SUCCESS, SEND_MESSAGE, INSERT_CODE, UPDATE_QUOTA, RECEIVE_RESPONSE).

In React, set up state management (React Context or Zustand) to hold the authentication state, chat history, selected model, and loading states.

Test the bridge: Add a dummy button in React that sends a ping to the Extension Host, and verify the response updates the React state.

Chunk 4: Supabase Authentication Flow (PKCE & URI Handlers)

Goal: Implement the secure login flow directly within the extension using Supabase Auth.
Instructions for Cursor:

In AuthService.ts, initialize the @supabase/supabase-js client. Register a vscode.window.registerUriHandler to listen for auth callbacks.

Implement the login function: When the user clicks "Sign In", use supabase.auth.signInWithOAuth() with the redirectTo option set to your extension's URI scheme (e.g., vscode://<your-publisher>.mirror/auth). The Extension Host uses vscode.env.openExternal to open this URL.

Once logged in, Supabase redirects back to the vscode:// URI. The URI handler catches this and extracts the session data/tokens using the PKCE flow.

Securely save the Supabase session token using context.secrets.store().

Send a LOGIN_SUCCESS message to the React Webview to switch to the ChatScreen.

**Redirect URL (Supabase Dashboard):** Add this exact callback to **Authentication → URL Configuration → Redirect URLs** (matches `package.json` publisher + name):

`vscode://mirror.mirror/auth`

Chunk 5: Editor Service & Prompt Engineering

Goal: Read the editor context and structure the user's raw input.
Instructions for Cursor:

In EditorService.ts, create methods to get the currently active text editor, read the active file's entire content, and get any text the user currently has highlighted/selected.

Also in EditorService.ts, implement an insertCodeAtCursor(code: string) method using vscode.window.activeTextEditor.edit(). Connect this to the INSERT_CODE message coming from the React Webview code blocks.

In PromptBuilderService.ts, implement a function to search the root of the user's current VS Code workspace for a .mirrorrules file.

Create a buildChatPayload() function. This wraps the raw user string in a JSON envelope containing:

The User's Query.

The Selected Model.

The Workspace Rules (from .mirrorrules).

Editor Context: The active filename, the full file text, and the specifically highlighted text (fetched via EditorService.ts).

Commented out hook: // TODO: Inject RAG vector context here.

Commented out hook: // TODO: Inject Terminal error state here.

Chunk 6: Secure API Integration & Edge Functions

Goal: Route structured chat requests through Supabase and handle streaming responses.
Instructions for Cursor:

In ApiService.ts, implement the network logic. Call PromptBuilderService.buildChatPayload() to get the formatted request payload.

Retrieve the user's Supabase session from context.secrets and initialize the Supabase client.

Send the payload to a custom Supabase Edge Function using supabase.functions.invoke('chat'). (Note: The Edge Function will hold the 302.ai API keys and make the actual AI request).

Set up a streaming parser to handle the Server-Sent Events (SSE) or chunked response coming from the Edge Function.

Stream the parsed text chunks back to the React Webview via message passing for a real-time typing effect.