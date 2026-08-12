---
name: handoff
description: 'Fork the current conversation to a fresh agent NOW — compact it into an inline copy-paste prompt (plus an optional temp doc) so a new session continues this exact task immediately. Use when the context window is filling up, when forking into a separate session, or when handing a task to another agent mid-stream. Distinct from thread:open/thread:close (persistent continuity) and thread:stash/thread:defer (set down for later) — this is a one-shot compaction for resuming THIS task right now.'
argument-hint: "What will the next session focus on?"
disable-model-invocation: true
author: Matt Pocock
license: MIT
source: https://github.com/mattpocock/skills (skills/productivity/handoff) — adapted under MIT
---

# /thread:handoff — fork this thread to a fresh agent

Compact the current conversation so a fresh agent can continue the work *immediately*. The primary output is an **inline copy-paste prompt** printed in the response; a temp-file handoff doc is the optional deep-context companion.

## Output 1 — the inline prompt (always)

Print a fenced block Lachy can paste straight into a new session:

```
You're continuing "<task title>" mid-stream — a live handoff, not a cold pickup.
Context: <2–5 lines: goal, state of play, what's built/decided, what's blocked.>
Read first: <handoff doc path if written; key file paths / artefact links>
Suggested skills: <skills the next agent should invoke>
Next move: <the single concrete next step>
```

Keep it tight — the doc (below) carries the depth; the prompt carries the momentum.

## Output 2 — the handoff doc (when the context is too rich for a prompt)

Write a handoff document summarising the conversation and save it to the temporary directory of the OS — not the current workspace or the vault. Skip it when the inline prompt alone is genuinely sufficient.

Include a **"Suggested skills"** section that names the skills the next agent should invoke to continue.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs, THREAD.md). Reference them by path or URL instead.

Redact any sensitive information — API keys, passwords, tokens, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor both outputs accordingly.

When done, print the inline prompt, then the absolute path of the handoff file (if written) so it can be opened or passed to the next session.

## Relationship to the other thread:* routes

This is **not** a replacement for the rest of the family:

- `thread:open` + `thread:close` = persistent, durable continuity for ongoing work that spans many sessions.
- `thread:stash` / `thread:defer` = the work stops *for now*; a self-contained vault task guarantees it isn't lost.
- `thread:handoff` = the work continues *right now*, in a new head. A throwaway compaction of this one conversation — it lives in temp, not the vault.

If the work is an ongoing project that should be remembered, use `thread:close` instead. Use `thread:handoff` for the live "carry this task to a new agent" moment.
