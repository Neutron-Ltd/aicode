# Fixing two common Ultra AI edits (indentation and incomplete changes)

Ultra AI picks the right **idea** yet the file sometimes still looks wrong—line columns do not match neighbors, or a symbol change leaves a stale companion (for example typography loaded in one place and consumed in another). This document explains why that happens **and concentrates on fixes**: prompt updates in Supabase, extension behavior you can tighten, and optional engineering patterns.

---

## Reference copy versus what the model reads

Root **`prompt.md` is maintained for reviewers and versioning only.** The authoritative system prompt that accompanies each inference request lives in **Supabase** (`master_prompts`, latest row wins). Operational practice:

- Whenever you revise `prompt.md`, **publish the same text** into Supabase so users actually receive those rules.

- Optionally keep **`MASTER_SYSTEM_PROMPT_FALLBACK`** in the extension loosely aligned—used only when the database row cannot be fetched (session or network edge cases).

Problems like mis-indentation or forgetting a sibling loader stem from **models plus apply-time heuristics**, not from skipping the repo file magically at runtime—they happen even when prompts are technically correct unless you reinforce behavior in both **Supabase** and **tools**.

---

## 1. Line shifted (spaces or tabs do not match neighbors)

### Cause

Mix of **model snippet style** versus **workspace style**, plus **deterministic patching** inside the VS Code integration:

1. Generated code often nests visually in ways that diverge from the exact leading whitespace siblings already maintain.

2. When a ranged overwrite keeps **matching line counts**, merging can recycle each overwritten line’s **original leading whitespace**, which heals many cases.

3. When counts **diverge**—collapsed lines, different trailing newline shape, substring path instead—or the prior algorithm path runs, tooling may align using the **first** line’s column plus shared minimum indent from the model block. That stacking can overstrike sibling alignment (typical symptom: **one declaration extra-indented inside a brace block**).

### Solutions

**Prompt engineering (publish to Supabase):** Prefer **narrow search-and-replace** anchored on **verbatim** text from `read_file` for single-slot edits inside structured regions. Reserve ranged multi-line writes when every line deliberately maps one-to-one to prior lines **after fresh read.**

**Extension code:** Maintain and extend the merge path whenever line counts coincide; widen tests around trailing-newline divergence; steer models toward tooling calls that expose fewer ambiguous ranges.

---

## 2. Typography or symbol changed—but companion loaders left stale

### Cause

`font-family` (or analogous binding) shifts without refreshing **everything that loads or names** that binding in the artifact. Minimal-edit bias on the assistant side skips obvious secondary sites.

### Solutions

**Supabase prompt:** Elevate unconditional language that before closing a task touching **symbols resolved through imports/includes**, **presentation wiring**, **remote loaders**, **mirrored manifests**, users must reconcile **every** dependent mention in scope (same artifact and obvious cross-links) in **one coherent turn**.

**Operational:** After prompt edits merge from `prompt.md` into DB, sanity-check with the example HTML/CSS task class that bit you.

---

## Consolidating authoring and shipping (engineering options)

Goals: fewer surprises offline, clearer ownership, repeatable deploy.

**A — Larger bundled fallback**

Expand `MASTER_SYSTEM_PROMPT_FALLBACK` to mirror approved Supabase text so degraded sessions resemble production.

**B — Build sync from repo to bundle**

Codegen step during `compile` emits a TypeScript literal from **`prompt.md`**, powering fallback or admin preview builds without hand-copy drift.

**C — Hybrid (strong default)**

- Supabase stays **source-of-truth** for networked chat.

- Bundle equals **explicit snapshot** regenerated when `prompt.md` changes (automate in CI/release script).

Precedence suggestion: fetch Supabase prompt when healthy; fallback to regenerated bundle—not a tiny divergent snippet.

**D — Lightweight process only**

Maintain a checklist: bump `prompt.md` → dashboard/SQL **`master_prompts`** → QA pass on indent + typography scenarios.

Pick **C** when installs must tolerate offline or flaky auth; supplement with **richer wording in Supabase** for live users.

---

## Engineering habits that complement prompts

Prefer **substring replace** sourced from authoritative buffer reads wherever one identifier or property changes.

Treat **paired edits**—loader + consumer, rename + mirrored strings—as single-turn acceptance criteria inside eval harnesses once you stabilize prompt text.

Neither replaces spotting odd layout regressions in real pages before calling a task delivered.
