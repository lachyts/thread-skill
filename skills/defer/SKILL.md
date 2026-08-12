---
name: defer
description: 'Set the current thread down onto a specific day — writes a self-contained Obsidian task SCHEDULED for that day (default tomorrow), routed to the right project, carrying a summary + copy-paste resume prompt. The task surfaces on that day''s page via /morning and the TaskNotes agenda. Triggers on "defer this", "pick this up tomorrow/monday", "put this on tomorrow", "come back to this friday", "this is tomorrow''s problem", or explicit /thread:defer [day]. For "no particular day, just don''t lose it" use thread:stash instead.'
argument-hint: "[day — tomorrow if omitted: monday | fri | next tue | 2026-07-20]"
---

# /thread:defer [day] — set this thread down for a day

The decisive "this is <day>'s problem" route. Same capture as `thread:stash`, plus a date that puts it on a day page.

## Do

1. **Resolve the day** — task-writer § 3, deterministic, `Australia/Melbourne`:
   - No argument → tomorrow (`TZ="Australia/Melbourne" date -v +1d "+%Y-%m-%d"`).
   - Named day → next *future* occurrence, never today (`defer monday` on a Monday = +7).
   - Explicit date → as given; refuse past dates.
2. **Write the capture task** — follow `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` exactly: § 1 routing, § 2 dedup (re-deferring an open capture = move its `scheduled:`, don't duplicate), § 3b **day-page To do line** (the visible surface), § 4 frontmatter **with `scheduled: <resolved date>`**, § 5 self-contained body, § 6 THREAD.md upgrade only if thread-worthy.
3. **Confirm** per § 7, always echoing the resolved date: `→ [[<slug>]] scheduled **Mon 20 Jul** — on that day page's To do list. <Project>.` — clickable task link, then state plainly that the session is safe to end.

**The day page is the visible surface — frontmatter alone is not enough.** Always run task-writer § 3b: add the `- [ ] [[<slug>|<title>]]` line to the target day note's `## To do` (creating the note from the Day template if needed). `/morning`'s `rg "^scheduled: $TODAY"` and the TaskNotes agenda are secondary discovery, not the surface Lachy sees.

## Don't

- Don't silently reinterpret an ambiguous day — the echoed date in the confirmation is the contract; if parsing was genuinely uncertain ("next tue" said on a Monday), state the interpretation in the confirmation rather than asking first.
- Don't run the full `thread:close` triage — defer is the lightweight exit (same rule as stash: offer `thread:close` in one line if the session clearly produced durable decisions, never block on it).
- Don't write a dateless task. A defer without a resolvable day is a stash — dispatch to `thread:stash`.
