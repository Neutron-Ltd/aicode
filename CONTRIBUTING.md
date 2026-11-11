# Contributing to Build Ultra

Thanks for your interest in improving Build Ultra. This guide covers how to get a working development setup and how to send changes.

## Development setup

Requirements: Node.js 20+, npm, and VS Code 1.85 or newer.

```bash
git clone https://github.com/Neutron-Ltd/aicode.git
cd aicode
npm install
cp .env.example .env   # optional: fill in your own Supabase URL and anon key
npm run compile        # generates src/config.generated.ts and compiles the extension
npm run build:webview  # bundles the React sidebar into media/
```

Then open the folder in VS Code and press **F5** ("Run Extension"). The `build-all` task runs both builds before launching.

For iterative work, run the `watch-all` task (or `npm run watch` and `npm run watch:webview` in two terminals).

Without a `.env`, the extension still builds, but cloud sign-in is disabled. You can still use **private compute** mode against any OpenAI-compatible server. See [Self-hosting the backend](readme.md#self-hosting-the-backend) to run your own Supabase project.

### Generated files

These files are produced by the build and are not committed:

- `src/config.generated.ts` (from `.env` via `scripts/gen-config.mjs`)
- `media/index.js`, `media/index.js.map`, `media/webview.css` (from `webview/`)

Edit the sources, not the generated output.

## Tests

```bash
npm test
```

This compiles the project and runs the unit tests in `src/tooling/*.test.ts` using Node's built-in test runner.

## Sending changes

1. Fork the repository and create a branch from `main`.
2. Keep each pull request focused on one change, and describe what it does and why.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) style messages, e.g. `fix(chat): handle empty upstream response`.
4. Make sure `npm run compile`, `npm run build:webview`, and `npm test` pass.
5. If you change the system prompt, update both `prompt.md` and the corresponding Supabase migration.

## Reporting bugs and security issues

Open a [GitHub issue](https://github.com/Neutron-Ltd/aicode/issues) for bugs and feature requests. For security vulnerabilities, **do not open a public issue**; follow [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
