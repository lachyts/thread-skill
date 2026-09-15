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
2. **Process scan, silent** (ADR 0014, 0015) — run the scan on every stash: `close`'s category-7 process-observation scan per the method skill's capture contract (stage-gated — pivots, reusable moves, revealing failures, cross-workstream effects; never iteration churn). NOOP is the expected outcome and produces **no output**. A hit routes per the section `close` cites — `~/.agents/skills/method/SKILL.md` § Which ledger a row goes to; no second definition of the test lives here. A project ledger is a destination only when `close`'s § Project directory resolution yields a directory; otherwise the routing test skips its project step. On Windows (no `~/.agents` tree — the method contract and template are not shipped there) the category-7 scan NOOPs at every altitude; never hand-roll a row or a ledger. Create the file from `~/.agents/skills/method/METHOD-template.md` if absent, then commit the append immediately by pathspec in its containing repo per `close` § Commit hygiene — the one place the form, the index pre-scan and the failure branch live. Then one line in the confirmation.
3. **Confirm** per § 7: `→ [[<slug>]] stashed (no date) — resurfaces in /weekly's Stashed threads. <Project>.` — with a clickable task link. Then state plainly that the session is safe to end.

## Don't

- Don't ask clarifying questions when the routing is resolvable — stash is invoked at low-energy, end-of-rope moments; be fast and decisive. Ask only if the project is genuinely ambiguous (task-writer § 1.4).
- Don't run the full `thread:close` triage (memory, knowledge, commits) — stash is the lightweight exit; the silent process scan (§ 2) is the one deliberate exception (ADR 0014). If the conversation obviously also produced durable decisions worth persisting, say so in one line and offer `thread:close` as a follow-up, but never block the stash on it.
- Don't schedule it. A stash with a date is a defer — dispatch to `thread:defer` if a day is mentioned.
