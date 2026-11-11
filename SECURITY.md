# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, report them privately through GitHub's [private vulnerability reporting](https://github.com/Neutron-Ltd/aicode/security/advisories/new), or by email to **info@neutron.com.bd** with "SECURITY" in the subject line.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The affected component (VS Code extension, webview, or a specific Supabase edge function or migration)

We will acknowledge your report, keep you informed while we investigate, and credit you in the fix unless you prefer to stay anonymous.

## Scope

In scope:

- The VS Code extension and webview code in this repository
- The Supabase edge functions in `supabase/functions/`
- The database migrations and Row-Level Security policies in `supabase/migrations/`

Out of scope:

- Vulnerabilities in third-party dependencies (please report those upstream)
- Self-hosted deployments that have been modified or misconfigured, such as exposing a `service_role` key to clients

## Handling secrets

Never commit real credentials. The only values that belong in the extension build are the Supabase project URL and the **publishable/anon** key, supplied through `.env`. All upstream AI, Stripe, and `service_role` keys must live only in Supabase Edge Function secrets.
