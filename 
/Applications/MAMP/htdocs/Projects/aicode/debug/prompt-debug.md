# Prompt debug — same reply vs. raw JSON tool text

This note ties your **screenshot** to **`debug/prompt.md`** and to how **Build Ultra** turns model output into chat text vs. real file edits.

---

## 1. Why four different questions got the *same* answer

In `debug/prompt.md`, **§1 Human-Like Interactions** tells the model exactly how to handle greetings:

- For *“Hello”* or *“Hi”*, use a **single concrete example**:  
  *“Hello! How can I help you with your code today?”*

That is useful as a pattern, but many models **over-fit** that line:

- They treat *any* short, conversational message that is **not** clearly an edit request as “small talk” and snap back to the **one phrase** they were given as the approved template.
- *“What can you do?”*, *“How are you?”*, and *“Stop”* do **not** get their own instructions in the prompt—so there is no competing signal. The easiest compliant output is still that same greeting-style line.

So the behavior is less “a random bug” and more a **prompt + model** effect:

| What you asked | How the model often classifies it | What the prompt nudges toward |
|----------------|-----------------------------------|------------------------------|
| Hello | Greeting | Use the example sentence (exact match to screenshot) |
| What can you do? | Vague / conversational | Same safe opener (no § telling it to list capabilities) |
| How are you? | Small talk | Same opener |
| Stop | Ambiguous; not tied to tools or tone in §1 | Same opener |

**Ways to improve it (prompt side):** Add explicit rules, for example: answer “what can you do?” with a **short capability list**; answer “how are you?” briefly; treat “stop” as “acknowledge and wait.” Give **different** examples so one line is not the only anchor. **§9 Tone** already says to avoid a “broken robot”—tightening §1 so the example is *one option among many*, not the default for every non-code turn, reduces copy-paste replies.

---

## 2. Why the title-tag request showed **JSON** and **did not** update `index.html`

Two different channels exist in the OpenAI-style API:

1. **Normal assistant text** — streamed as `choices[0].delta.content`. Build Ultra shows every chunk in the chat as the message you see.
2. **Real tool calls** — streamed as `choices[0].delta.tool_calls` (fragments that the app merges into a full `write_file` / `read_file` / … call).

Build Ultra’s Workstation path **only runs tools** when the **second** channel is populated. The streaming logic **does not** parse JSON out of the assistant’s visible text and turn it into a tool run.

Your screenshot shows something like:

```json
{"name": "write_file", "arguments": {"path": "index.html", "content": "...", "range": {...}}}
```

That shape is **tool-like**, but if it arrived as **plain `content`** (normal message text), the extension will:

- Stream it into the bubble (what you saw).
- After the stream ends, see **`tool_calls.length === 0`**.
- **Exit the tool loop** without opening the tool-plan UI or calling `write_file` — so **the file is never updated**.

So the issue is usually **not** “Build Ultra ignored a legal tool call,” but **“the compute stack never sent a native `tool_calls` stream; the model only *typed* JSON as chat.”** That commonly happens with:

- Models or servers that **don’t** expose reliable OpenAI-style function calling over SSE.
- A stack that returns tools in a **different JSON shape** than the client accumulates.
- The model **imitating** a tool call in text instead of using the API’s tool channel.

**What to verify on the inference side:** The upstream must emit **streaming `delta.tool_calls`** (with `id`, `function.name`, `function.arguments` pieces) for `write_file`, not only free-form JSON in the assistant string. After that, Build Ultra can show the plan, run the tool, and apply the edit.

---

## Summary

| Observation | Likely explanation |
|-------------|-------------------|
| Same canned line for Hello / What can you do? / How are you? / Stop | §1 anchors a **single example** greeting; the model generalizes it to all light conversational inputs. |
| JSON in chat, file unchanged | Model printed a tool as **text**; extension only executes **native `tool_calls`** in the SSE stream, not JSON inside `content`. |
