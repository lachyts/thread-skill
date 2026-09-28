---
name: next
description: 'The undecided moment — "what''s my next move?" for the current thread. Summarises where the work is, recommends ONE move (keep going / defer / stash / handoff / close), then dispatches to the chosen sibling route. Triggers on "what''s my next move", "what should I do with this thread", "where are we — what now", "should I keep going or close this", "next steps?", or explicit /thread:next. If the intent is already decisive ("stash this", "defer to friday"), skip this router and invoke that route directly.'
---

# /thread:next — what's my next move?

The router for the undecided moment. A sibling of the decisive routes, not their parent (ADR 0002): when Lachy already knows what he wants, the decisive verb is faster and can't be second-guessed. `next` exists for "I don't know what to do with this thread" — it reads the situation, recommends, and dispatches.

**Contains no route logic of its own.** Executing a chosen route means running that sibling's SKILL.md logic (`${CLAUDE_PLUGIN_ROOT}/skills/<route>/SKILL.md`), so every behaviour lives in exactly one place.

## Process

1. **Read the situation**:
   - The live conversation — what's been done, what's mid-flight, what's blocked.
   - The active `THREAD.md`, if any (identify per `close`'s "Identify the active thread" chain).
   - Open vault tasks whose `projects:` match this project (`rg` across `~/repos/obsidian/Work/Tasks/`) — existing commitments shape the recommendation.

2. **Summarise "where we are"** — a headline (1–2 sentences) plus the single most important open question. Written for Lachy catching up, not a log.

3. **Recommend ONE move**, with a one-line reason:
   - **Keep going** — name the next concrete step in *this* session. Right when energy + context are live and the step is clear.
   - **`defer [day]`** — the work should continue on a known day. Right when it's day-shaped ("tomorrow's problem").
   - **`stash`** — not the current focus, no known return date. Right when the honest answer is "not now, don't lose it".
   - **`handoff`** — the work continues *right now*, in a fresh session: the next phase is unrelated to this one, a spec is ready to execute, or the task deserves a fresh head. "New thread / new prompt" = this route.
   - **`close`** — the work is genuinely done for now; persist and commit.

   **Compact, within keep going.** In Claude Code, when the work continues in this session, the context is heavy (for example the statusline ctx % is high), the work sits at a phase boundary, and the history is still worth keeping, the keep-going recommendation adds compacting with a `/compact <focus>` line, which step 5 prints. Build `<focus>` from the thread's state: the active THREAD.md's scope and next step, else the conversation's goal, the next step and the files in play; one line, no shell quoting. `next` never runs `/compact` itself: it is a user-typed command that runs only between turns, so only Lachy can type it, and `next` never dispatches, schedules or simulates it. A **correction loop** (the same fix corrected twice or more) gets `/rewind` ("Summarize from here" over the failed span) or a fresh start instead, never compact, because compacting carries the failed attempts forward in the summary. An unrelated next phase, a spec ready to execute, or a task that needs a fresh head is the `handoff` route, not compact. `/compact` and `/rewind` are Claude Code commands, so a Codex session gets no compact or rewind line: where Claude Code would recommend compact or `/rewind`, a Codex session recommends a fresh start through `handoff`. Compact is a recommendation inside keep going, not a route: the step-4 menu gains no compact option.

4. **Offer the routes via `AskUserQuestion`** — recommended option first with "(Recommended)", the other viable routes after (drop any that plainly don't apply; keep ≤4). Option descriptions say what each route would *do to this specific thread* ("task on tomorrow's page", "committed handoff doc + prompt to paste into a fresh session"), not generic definitions.

5. **Dispatch.** Run the chosen sibling's logic in full — task-writer capture for stash/defer, the committed `docs/handoffs/` doc + paste-ready prompt for handoff (plus the native task in Codex Desktop), the complete persist-and-commit ritual for close. "Keep going" means exactly that: state the next step and continue working, no ceremony. When compact was recommended, print the `/compact <focus>` line once, for Lachy to type, and end the turn, never run it: `/compact` runs only between turns, so working on would keep filling the context it relieves. The focus already names the next step, so work resumes after Lachy compacts.

## Don't

- Don't recommend more than one move. The whole point is answering the question, not restating the options.
- Don't pad the summary — headline + top open question, then the menu.
- Don't re-implement any route inline. Dispatch means running the sibling skill's logic as written.
- Don't run `/compact`, `/rewind` or `/clear` yourself, don't keep working after printing a `/compact` line, and don't offer compact as a route.
- Don't invoke this router when the user was already decisive — "stash this" is `thread:stash`, not a `next` conversation.
