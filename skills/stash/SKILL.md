---
name: stash
description: 'Lock the current thread away dormant — out of time, not the current focus, but must not be lost. Writes a self-contained Obsidian task (NO scheduled date) routed to the right project, carrying a summary + copy-paste resume prompt, so the session can be shut down safely. Triggers on "stash this thread", "lock this in", "park this", "I''m out of time — save this", "not my focus right now, don''t lose it", or explicit /thread:stash. For "pick it up on <day>" use thread:defer instead; for "work continues right now in a new session" use thread:handoff.'
---

# /thread:stash — lock this thread in, dormant

The decisive "I'm done here *for now*, and I don't know when I'll be back" route. One job: make shutting this session down feel safe.

## Do

1. **Write the capture task** — follow `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` exactly:
   - § 1 project routing (never orphaned, never `_Inbox`).
   - § 2 dedup (an open capture for this thread → update it, don't duplicate; if it had a `scheduled:` date, remove it — stash means dateless).
   - § 4 frontmatter with **no `scheduled:` line** — that's what makes it a stash.
   - § 5 body: summary, resume prompt (first instruction closes the capture), THREAD.md link if one exists.
   - § 6 THREAD.md upgrade only if the work is thread-worthy — never manufactured.
2. **Confirm** per § 7: `→ [[<slug>]] stashed (no date) — resurfaces in /weekly's Stashed threads. <Project>.` — with a clickable task link. Then state plainly that the session is safe to end.

## Don't

- Don't ask clarifying questions when the routing is resolvable — stash is invoked at low-energy, end-of-rope moments; be fast and decisive. Ask only if the project is genuinely ambiguous (task-writer § 1.4).
- Don't run the full `thread:close` triage (memory, knowledge, commits) — stash is the lightweight exit. If the conversation obviously also produced durable decisions worth persisting, say so in one line and offer `thread:close` as a follow-up, but never block the stash on it.
- Don't schedule it. A stash with a date is a defer — dispatch to `thread:defer` if a day is mentioned.
