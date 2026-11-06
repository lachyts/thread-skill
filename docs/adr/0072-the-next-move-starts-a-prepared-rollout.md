# 0072 — The next move starts a prepared rollout

Date: 2026-11-06
Status: accepted. Written for the vault task `thread-skill-p40-2-next-starts-a-prepared-handoff-itself` (Phase 40 ·
Task 2, "the next move starts by itself"); its plan was judged over two rounds before the build. Amends ADR 0057 d5
and its "the close row offers only hand it off" item: the row survives, for a held note only.

## Context

ADR 0057 made orient § 9 and schedule step 8 end with the execute handoff, decided and never asked. Two ways out of a
session still left a written rollout note with no lead. A session that schedules and is then cut (its turn ended
before schedule's step 8), or whose close runs before anything hands the note off, ended on close's
`rollout not started:` row: a statement, so the Stage archived the Session, and the rollout waited for Lachy to come
back and say "hand it off". And `next`, asked "what's my next move?" in that state, had no move for it: it closed, and
nothing was started. His words, on the task:

> when I ask, "Use the next skill from Thread," rather than automatically closing it out, if there's a very clear next
> action to do (which is a handoff), that should automatically be done as well or at least offered. If we're in a
> situation where we've planned out a bunch of work, done some ADRs, and planned out a rollout but that rollout hasn't
> been executed, we're always wanting to move towards getting rollouts started. It doesn't make sense to close it out
> and then have no next session given to me as a suggestion or automatically started. The priority is to get as many
> rollouts started as possible and to remove the friction of having them started.

And, merged in from a Chorus note: "The session should automatically roll into the next action without me saying
that." The orient reshuffle of 2026-11-03 decided for him: auto-start the clear next move rather than offer it, and he
can still say not yet (his Thread Skill card: "runs without me").

## Decision

**d1. `next` launches first, then makes its own move.** Step 1 finds a parallel rollout note that is written and that
no lead runs: one this session wrote, or one the active THREAD.md names (d4). It checks each read-only, exactly as
close step 2 does. Only `unstarted <slug> <root>` with no hold (d3) counts. Step 3 decides its execute handoff (Owner
*gate*: he scheduled the work to run; ADR 0054, ADR 0057 d2), never asked, and the launch is no move of this
session's. Step 5 runs handoff's **Rollout launch.** for each such note first, with orient § 9's Fresh session
continuation, and then, in the same turn, dispatches this session's own move, recommended as if no rollout waited:
keep going, defer, stash, a handoff of this thread, close, or the archive line. When that move is not clear, the launch
runs before the menu is asked. With close as the move, close step 2 reads the launch as a handover and launches nothing
more. Every carrier the own move writes (a capture's resume prompt, the thread handoff doc's What remains, THREAD.md)
names the rollout as handed to a fresh lead, never as a `/thread:execute` step left to do. While another session holds
the thread, a note this session wrote launches all the same, since only this session knows it waits (step 3's decided
act whose inputs only this session holds), and the archive line follows; a note only THREAD.md names is that other
session's, so it is not checked. Step 4's line opens `Next move: hand [[<slug>]] to a fresh lead, then <move>, …` and
says "not yet" withdraws the handoff.

**d2. Close ends with the launch.** A new sub-step 7.10 runs the Rollout launch for each note step 2 found `unstarted`
with no hold, after every commit and after 7.9, before step 8's report. Handoff lands its own doc, and that landing row
counts in step 9's banner choice. The statement row `rollout handed off: [[<slug>]] · <doc> · starting on the Stage
(task_id …)`, or `· manual handoff: its prompt is above; run it from <root>`, replaces handoff's Chorus closing line,
so close's banner stays last. A manual handoff's labelled prompt prints fenced, just above the report. A resolver
failure asks nothing and gives the `rollout not started: … (launch failed: …)` row; a `create_thread` error is handoff
§ Fail closed.

**d3. The holds.** Each gives close's `rollout not started:` row with a `(held: <why>)` suffix, and `next` names the
note in its line; nothing is launched:

- his "not yet" for that note: Not yet's line, or a withdrawal of its launch (of a note's handoffs and withdrawals the
  latest decides, as ADR 0057 d5 has it);
- `ladder.py` exits non-zero, read fresh (ADR 0057 d3); a held `Execute:` line from schedule or orient is no hold by
  itself;
- `unstarted` prints `(no Project root line)`;
- orient-all § 7 left the note: its `left[]`, or a pick he did not tick;
- a THREAD.md-named note fails its guard (d4), or the handoff scan failed;
- `/thread:open save`, and a Leg's close.

**d4. THREAD.md-named notes.** A note counts when the active THREAD.md's Where we are, Next steps or Resume
instructions, as they stood before this session's first write to it, carry a `[[<project-slug>-rollout-<YYYY-MM-DD>[-N]]]`
link or a `/thread:execute [[<slug>]]` line naming it as the waiting or next step, never only as history. Only
`unstarted <slug> <root>` from `unfinished-rollout.py` makes one launchable, and only when all three hold: THREAD.md's
own lines record no handover for it; on the Chorus Stage, `list_sessions` shows no session on it; and `unstarted` was
also run with the Project root's handoff home (`handoff-home.sh --dir <root>`'s `docs/handoffs`). Otherwise close
prints the row, or `next` prints the line, and nothing is launched.

**d5. THREAD.md records the handover.** Close step 4 records the launch 7.10 will run as `close hands [[<slug>]] to a
fresh lead (see the step-8 row)`, which stays true if the launch fails, and logs a handover already in the transcript
as `handed [[<slug>]] to a fresh lead`. It never keeps a bare `/thread:execute [[<slug>]]` step for either. A later
session's guard (d4) reads those lines as a recorded handover, so it prints a row and never starts a second lead.

## Decided for him (overturnable)

- Launch first, then the own move, in one turn: the own move is never lost, and on the Stage the launch never reads as
  this session ending.
- Close's launch runs after its commits and 7.9, never before: the lead starts after close's work lands, never beside
  the held primary checkout mid-close.
- The launch doc's landing row counts in close's banner choice like any landing row (`stuck:` → C, `queued` or
  `landed` → B).
- A manual 7.10 handoff is a follow-up for the Stage's flag read (its prompt is his to open); a raised card is not.
- The ladder is read fresh at the launch; a held `Execute:` line printed earlier holds nothing by itself.
- A THREAD.md-named note is launched only behind the three-part guard (d4); a recorded handover with `unstarted` still
  gets a row, never a launch, and he says "hand it off" when no lead runs.
- Orient-all's `left[]` is a hold, and a note this thread's own handoff doc names as its consumer's step is a handover:
  close never overrides another verb's choice.
- A plan whose next step is a fresh session needs no new rule: next's step-3 handoff route and step-4 **Clear** clause
  ("a spec is ready to execute (handoff)") already decide it, and close's **Wrong route?** dispatches handoff for work
  that continues now. The evidence is `evals/lifecycle/handoff-router-dispatch-skips-next`, scored in
  docs/evals/2026-10-28-handoff-ends-with-next.md: every run of invocations 2 and 6 decided "Next move: handoff,
  because … its spec is ready to run" in one line, with no question.
- Skill descriptions for next and close are left as they are in this task (§ Follow-ups).

## Considered options

- **Keep the offer** (close's row, next's silence): rejected by ADR 0054 and ADR 0057: asking whether to run what he
  scheduled to run is a confirm of a decision he made.
- **The launch ends the turn, and the line names the own move:** rejected. The own move is lost, and on the Stage
  handoff's closing line reads as the session done.
- **Launch only when the session is close-shaped:** rejected. A stash, defer or keep-going session leaves the note just
  as unstarted.
- **Launch inside close before its commits:** rejected. The lead would start before close's work lands, beside the
  held primary checkout.
- **Launch any unstarted rollout in the vault:** rejected. A note no session here wrote or named may be another
  session's, or one he set aside.
- **No THREAD.md source:** rejected. A fresh session that opens the thread would never start a note its predecessor
  wrote and was cut before handing off.

## Consequences

- ADR 0057 d5 is amended: close's `rollout not started:` row now names a held note only; an unheld one is launched at
  7.10. Its "the close row offers only hand it off" item still holds for that row. ADR 0057 d3 stays the only hold at
  orient § 9 and schedule step 8.
- `next` may run a dispatch and a move in one turn. Handoff's Invocation gate, **Rollout launch.**, **Skipped on a
  dispatch.**, **Failure path.** and § Build name close 7.10 and next step 5, so § Next for this session never runs a
  second `next`.
- A double lead stays possible for a THREAD.md-named note in one window: an orient-all § 7 card that waits, or a
  launch doc in a third home, with no `lead-entry` yet, nothing in THREAD.md, and the session off the Stage (or a
  waiting card `list_sessions` does not list). Execute's per-task `owner:` stamps and claims keep one task from
  starting twice.
- On the Stage the launched lead starts at once while the own move goes on here; under close as that move, close's
  commits land after the lead starts.

## Follow-ups

- A description trim for next and close, whose descriptions do not mention the launch. The Makefile requires a scored
  eval baseline before any description changes (`make evals`), and the trim must stay inside the 7950 description
  ratchet.
- README's next and close rows, which still describe the moves without the launch.
