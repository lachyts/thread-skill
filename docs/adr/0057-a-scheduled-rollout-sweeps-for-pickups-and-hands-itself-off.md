# 0057 — A scheduled rollout sweeps for pickups and hands itself off

Date: 2026-10-28
Status: accepted. Written for the vault task `thread-skill-p30-9-schedule-ends-with-pickup-sweep-and-execute-handoff`
(Phase 30 · Task 9); its plan was judged over three runs before the build. Removes ADR 0054's two p30-9 follow-up rows
(the execute offer's ask at orient § 9 and schedule's **Start when ready.**). Amends ADR 0027's decision 5 (the
execute offer becomes the execute handoff) and ADR 0017 (a Rollout launch's doc is no continuation).

## Context

On 2026-10-20 a narcissus-avp session scheduled `narcissus-avp-rollout-2026-10-20`, said "execute from a fresh
thread" in its summary, then ran `/thread:close`. Close landed everything and printed its banner, but nothing handed
the rollout off, so Lachy had to come back and ask for it. A quick backlog scan afterwards found three more tasks on
the same repo that could have run in it (the sim-loop, ShaderGraph `.usda` and Attended Run tasks): schedule takes
only the tasks it is given (`--tasks`). His words: "that rollout handoff should have been offered … I wonder if we
should do an orient on the project to see if we can pick up other tasks."

ADR 0054 already ruled the execute offer's question at orient § 9, and schedule's **Start when ready.** answer, Owner
*gate*: he scheduled the work to run, so asking again whether to run it is a confirm of a decision he made. It left
both as follow-up rows owned by this task.

## Decision

**d1. The Pickup sweep.** A standalone parallel `--tasks` run of schedule runs step 1.2 before its Pre-flight:
`unfinished-rollout.py pickups` reads the same repo's other open tasks on the named tasks' projects and prints which
may join. Its pool, order (priority, then phase, then slug), Repo rule, gate rule, dependency fixpoint and cap (5
extras; a task a named task needs is uncapped) are deterministic and live in the script's header. The agent judges
fit only on what would join, in a bounded loop (`--misfit` for each misfit, then only the newly joined), so the walk
costs about the cap plus the needed tasks plus the misfits, never the whole project. The joined tasks are ordinary
candidates from then on: graded, gated, ordered and stamped like any other. A project run, the serial path, an
orient-all fork, the chain and orient § 6's call never sweep.

**d2. The execute handoff, decided.** Orient § 9's ask becomes a decided move (Owner *gate*,
`skills/_shared/asking.md` § 1): when a session wrote a parallel rollout note, it prints one `Execute:` line and runs
orient § 9's **Fresh session**, handoff's **Rollout launch.**, by default. A standalone schedule's step 8 runs the same
move. Only his words choose Here, Not yet or Start when ready; said after the fact, "not yet" is the handoff's
withdrawal (handoff § Lifecycle).

**d3. One hold.** A refused ladder file holds the handoff (`Execute: held …; once it reads, say "hand it off"`): it is
a settings file every call refuses at its start, the one kind of cause ADR 0048 lets hold a whole rollout. No other
checklist holds it: a kept gate, a capture-shaped note or a local copy threatens one task, which the engine sets
aside, never the rollout.

**d4. A launch doc is no continuation.** A Rollout launch's doc carries `launches: <slug>` in its front matter. It
briefs the rollout's lead, never this thread: handoff skips its **Open captures.** and its **Thread state.** row,
close's scan reads it as `launch` (never refreshed, never the Resume pointer, never suppressing a task proposal), and
`next` never counts it, or the lead it started, as this thread continuing elsewhere. The launch is a dispatch, as a
router's is, so the turn ends on handoff's own closing line.

**d5. Close names a rollout left unstarted.** Close step 2 checks each rollout note this session wrote. A handover in
the transcript (handoff's output, a `relay_session` of `/thread:execute`, or Here) settles it; Not yet, a held line and
step 8's by-hand lines do not, and a handoff withdrawn later in the session is no handover (the latest of a note's
handoffs and withdrawals decides). With no handover, `unfinished-rollout.py unstarted` reads the vault, the Run record
and the scanned handoff docs; only `unstarted` prints the statement row `rollout not started: [[<slug>]]; say "hand it
off" …`. The row never blocks the close and asks nothing, so the Stage still archives the Session.

**d6. Words.** The **execute offer** is the **execute handoff** everywhere (CONTEXT.md; its `_Avoid_` keeps the old
name). The checklists that said "before executing" now say what a lead starting in the same turn means: a kept gate
is cleared while its task is still queued, or its call sets it aside for his answer or sign-off; a local copy landed
later reaches only the task calls that start after it lands; a ladder fix ends "once it reads, say "hand it off"".

## Decided for him (overturnable)

- The sweep runs only on a standalone parallel `--tasks` run; a project run already took the project's tasks.
- The cap is 5 extras, counted at the sweep: an extra that leaves at the Pre-flight frees no slot.
- The order is priority, then phase (an unparseable phase last), then slug.
- An umbrella project widens the pool, as `check`'s project rule does; the Repo rule filters it.
- A task with no `## Launch` **Repo:** line, or on another repo, is counted, never read and never named: `counted` is
  two integers.
- A missing Repo path is left alone and named, since its origin cannot be read.
- Any gate-sweep hit (spend, credential, irreversible) leaves a pool task alone, never dismissed: spend he never named
  joins nothing.
- A pickup a named task needs is asked in the Pre-flight round; an extra is never asked, so an extra that needs a
  decision leaves undecided.
- A pickup with a § 3.5 match, or whose cited path stops the pushed-base re-run, leaves; it is never put to him.
- The overturn route is step 8's **Pickup sweep.** block and its `Picked up for you` group, then `/thread:repair` § 5's
  defer while the pickup is still queued, or stopping it once started. No ranking holds pickups back.
- The handoff is decided (Owner *gate*), its one hold the ladder file.
- Several notes get one handoff each; the last closing line ends the turn.
- The launch doc is marked by front matter (`launches:`), not by its prompt's text.
- Close counts a compaction summary's handover as a handover (a false row risks a second lead) and a compaction
  summary's write as a write.
- A withdrawal is matched by doc path or card `task_id`; `already_started_by_stage`, `already_started` and
  `already_kept` are no withdrawal.
- `unstarted` reads a Run record `lead-entry` as started, so a lead waiting on `hold_until` with no `owner:` gets no
  row.
- The close row offers only "hand it off" (a Rollout launch), never "start when ready": nothing may stamp
  `start: unattended` after close.
- Orient's and schedule's skill descriptions are left as they are in this task (§ Follow-ups).

## Considered options

- **Keep the offer as a question:** rejected by ADR 0054's ruling: the question is a gate on a decision he made.
- **Hold the handoff on every checklist (gates, capture shapes, local copies):** rejected. A capture-shaped note holds
  almost every run, so the default would be held; and ADR 0048 lets only a cause that threatens every task hold the
  rollout.
- **Sweep with a full `/thread:orient`:** rejected as too costly for the question; a whole-project reshuffle stays
  orient's.
- **Sweep the whole project and judge every task by hand:** rejected. A real pool runs to dozens of notes for at most
  five extras; the script narrows it and the agent judges only what would join.
- **Treat a spend hit on a pickup as recorded, as for a named task:** rejected. "Recorded, never asked" covers tasks he
  chose; a swept-in task with spend would be paid work he never named.
- **Rank pickups after the named tasks as an overturn window:** rejected. The lead applies `priority:` at every start
  and the ceiling starts most tasks at once, so a ranking holds nothing back.
- **Key the launch doc on its prompt's `/thread:execute` line:** rejected for a front-matter key both scripts read the
  same way.
- **Offer "start when ready" on close's row:** rejected: no writer may stamp `start: unattended` after close.

## Consequences

- ADR 0054's two p30-9 rows are gone, and orient § 9's unit is one `cited` *gate* row (§ Sites now holds 66 rows).
- ADR 0027's decision 5 now ends a reshuffle with the execute handoff; ADR 0017's continuation rule excepts a launch
  doc.
- A standalone schedule starts a lead in the same turn. "Not yet" said after it is a withdrawal or a stop, not a
  cancel; his words in the request are the before-the-fact override.
- The grading agents read up to 5 more tasks, plus the needed ones.
- `unstarted` reads run_record.py's `lead-entry` kind (ADR 0051), so a lead on a pre-ADR-0051 snapshot cannot run a
  note this engine wrote.
- [[thread-skill-p27-5-handoff-ends-with-next]] (open) will make handoff run `next` for the parent session. A Rollout
  launch is a dispatch, as a router's is: p27-5's next-for-the-parent step skips it, and the turn ends on handoff's
  own closing line.

## Follow-ups

- A description trim for orient (its "offer to execute") and schedule (its Scope line, which omits the handoff). Both
  descriptions now under-describe this change. The Makefile requires a scored eval baseline before any description
  changes (`make evals`, `--max-cost-usd 30`, a spend gate this task does not hold), and the trim must stay inside the
  7950 description ratchet. The lead files it at Integration from this section, as ADR 0054 did for p30-10.
