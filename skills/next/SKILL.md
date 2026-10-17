---
name: next
description: 'The undecided moment — "what''s my next move?" for the current thread. Summarises where the work is, recommends ONE move (keep going / defer / stash / handoff / close), then dispatches to the chosen sibling route. Triggers on "what''s my next move", "what should I do with this thread", "where are we — what now", "should I keep going or close this", "next steps?", or explicit /thread:next. If the intent is already decisive ("stash this", "defer to friday"), skip this router and invoke that route directly.'
---

# /thread:next — what's my next move?

The router for the undecided moment. A sibling of the decisive routes, not their parent (ADR 0002): when Lachy already knows what he wants, the decisive verb is faster and can't be second-guessed. `next` exists for "I don't know what to do with this thread" — it reads the situation, recommends, and dispatches.

**Contains no route logic of its own.** Executing a chosen route means running that sibling's SKILL.md logic (`${CLAUDE_PLUGIN_ROOT}/skills/<route>/SKILL.md`), so every behaviour lives in exactly one place.

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Process

1. **Read the situation**:
   - The live conversation — what's been done, what's mid-flight, what's blocked.
   - The active `THREAD.md`, if any (identify per `close`'s "Identify the active thread" chain).
   - Open vault tasks whose `projects:` match this project (`rg` across `~/repos/obsidian/Work/Tasks/`) — existing commitments shape the recommendation.
   - **Whether the work continues in another session** — it does when a handoff doc this session wrote now reads `status: consumed` in its front matter, or is gone because its consumer's close deleted it (this session did not withdraw it), or when another live session holds this thread: the Chorus Stage's session list shows it, or the handoff itself started the successor (the Chorus Stage, or the native task in Codex Desktop), whatever its doc still reads. Nothing else counts, so a doc still `pending` whose successor the handoff never started (a manual handoff whose prompt nobody has opened yet) does not. When there is a handoff doc, also note for the archive menu's close option (step 4) whether its `**Run from:**` line is this checkout.
   - **This session's own branch** — whether the checkout is on a branch close would land as this session's own (close § The own branch). Every menu's close option names that landing (step 4), the normal menu's as well as the archive menu's.

2. **Summarise "where we are"** — a headline (1–2 sentences) plus the single most important open question. Written for Lachy catching up, not a log.

3. **Recommend ONE move**, with a one-line reason:
   - **Keep going** — name the next concrete step in *this* session. Right when energy + context are live and the step is clear.
   - **`defer [day]`** — the work should continue on a known day. Right when it's day-shaped ("tomorrow's problem").
   - **`stash`** — not the current focus, no known return date. Right when the honest answer is "not now, don't lose it".
   - **`handoff`** — the work continues *right now*, in a fresh session: the next phase is unrelated to this one, a spec is ready to execute, or the task deserves a fresh head. "New thread / new prompt" = this route.
   - **`close`** — the work is genuinely done for now; log this session into the thread's THREAD.md and commit. The THREAD.md's `state:` is unchanged (it stays active) unless Lachy says the thread is finished; with no THREAD.md, close saves the session's memory, knowledge and commits instead.
   - **Archive this session** — the work already continues in another session (step 1). Not a route: nothing is written, no sibling runs, the THREAD.md's `state:` stays active and the thread lives on in that session, and only Lachy archives this session (on the Chorus Stage, from its row). Recommend it whenever step 1 finds the work continuing elsewhere.

   **Compact, within keep going.** In Claude Code, when the work continues in this session, the context is heavy (for example the statusline ctx % is high), the work sits at a phase boundary, and the history is still worth keeping, the keep-going recommendation adds compacting with a `/compact <focus>` line, which step 5 prints. Build `<focus>` from the thread's state: the active THREAD.md's scope and next step, else the conversation's goal, the next step and the files in play; one line, no shell quoting. `next` never runs `/compact` itself: it is a user-typed command that runs only between turns, so only Lachy can type it, and `next` never dispatches, schedules or simulates it. A **correction loop** (the same fix corrected twice or more) gets `/rewind` ("Summarize from here" over the failed span) or a fresh start instead, never compact, because compacting carries the failed attempts forward in the summary. An unrelated next phase, a spec ready to execute, or a task that needs a fresh head is the `handoff` route, not compact. `/compact` and `/rewind` are Claude Code commands, so a Codex session gets no compact or rewind line: where Claude Code would recommend compact or `/rewind`, a Codex session recommends a fresh start through `handoff`. Compact is a recommendation inside keep going, not a route: the step-4 menu gains no compact option.

   **While another session holds the thread.** Keep going, handoff, stash and defer drop from the recommendation and the menu: keep going and handoff would put two sessions on the same work and the same THREAD.md, and stash and defer would set its `state:` to parked or paused and file a capture for work that is live elsewhere. Close stays on the menu because it declares nothing false: it leaves `state:` unchanged (`handoff-lifecycle.md` § Thread state's close row) and prepends one session-log line. It still writes to what the other session holds, so Archive stays the recommendation: close step 4 rewrites the Resume instructions when the handoff doc they point at is consumed or missing, its close-out commit lands on the checkout's current branch, and sub-step 7.9 reviews this session's own branch and queues its merge, which the other session may still be building on (close § The own branch). The close option's description names that landing whenever close would run it (step 4).

4. **Offer the routes via `AskUserQuestion`** — recommended option first with "(Recommended)", the other viable routes after (drop any that plainly don't apply; keep ≤4). Option descriptions say what each route would *do to this specific thread* ("task on tomorrow's page", "committed handoff doc + prompt to paste into a fresh session"), not generic definitions.

   **Session and thread, in the menu.** In wording Lachy reads (option labels and descriptions) say **session** for this chat and **thread** for the durable work its THREAD.md records, the user-facing convention in CONTEXT.md's **Thread** entry; agent-facing prose, this file's included, keeps that entry's two senses. Never offer a bare "Leave it" or "Keep thread", which leave him guessing what happens to the session and to the THREAD.md. Every close option says what close writes: the log into the thread, which stays active (with no THREAD.md, what close saves instead), and this session's own branch when close would land it.

   **The archive menu.** When step 1 finds the work continuing in another session, the menu is exactly two options, in this order:
   - label `Archive this session (Recommended)`, description "Nothing is written. The thread stays active in <the other session>; archive this chat on the Stage." Off the Stage the last clause names the host's own act: "archive this task in the sidebar" in Codex Desktop, "end this session" elsewhere. When the other session has itself closed, name where the thread was last logged instead of a live session.
   - label `Close`, description "Log this session into the thread (it stays active)." When close would land this session's own branch `<B>` (step 1), add "Also reviews `<B>` and queues its merge", plus ", which <the other session> is building on" when the doc's `**Run from:**` line is this checkout. With no THREAD.md, the description names what close saves instead (memory, knowledge, commits).

5. **Dispatch.** Run the chosen sibling's logic in full — task-writer capture for stash/defer, the committed `docs/handoffs/` doc + paste-ready prompt for handoff (plus the native task in Codex Desktop), the complete persist-and-commit ritual for close. "Keep going" means exactly that: state the next step and continue working, no ceremony. When compact was recommended, print the `/compact <focus>` line once, for Lachy to type, and end the turn, never run it: `/compact` runs only between turns, so working on would keep filling the context it relieves. The focus already names the next step, so work resumes after Lachy compacts.

   **Archive this session, dispatched.** Write nothing and run no sibling. Say where the work now continues (the other session, by its name) and that the thread stays active there, say Lachy can archive this session (on the Chorus Stage, from its row; elsewhere by the host's own act), and end the turn. `next` never archives a session itself: only Lachy does.

## Don't

- Don't recommend more than one move. The whole point is answering the question, not restating the options.
- Don't pad the summary — headline + top open question, then the menu.
- Don't re-implement any route inline. Dispatch means running the sibling skill's logic as written.
- Don't run `/compact`, `/rewind` or `/clear` yourself, don't keep working after printing a `/compact` line, and don't offer compact as a route.
- Don't invoke this router when the user was already decisive — "stash this" is `thread:stash`, not a `next` conversation.
- Don't label an option "Leave it" or "Keep thread", and don't say "thread" for this chat in the menu: name the session and the thread apart (step 4).
- Don't recommend or offer keep going, handoff, stash or defer while another session holds the thread, and don't archive a session yourself: only Lachy does.
