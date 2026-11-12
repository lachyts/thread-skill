# 0082 — A wait on a task nobody builds starts that task

Date: 2026-11-12
Status: accepted. Written for the vault task `thread-skill-p47-4-paused-rollout-waits-on-an-unstarted-task` (Phase 47 ·
Task 4). Its one question (start or only flag) was decided for Lachy at /thread:schedule (ADR 0054): start it. Extends
ADR 0072 from a waiting rollout note to a waiting task, and narrows ADR 0011's vault-task gate to what it gates: a
task's creation, never its start.

## Context

On 2026-11-07 the lead of `animately-app-rollout-2026-11-07` found the root cause of its merge stalls in thread-skill's
merge-task and filed `thread-skill-merge-task-empty-required-checks-reads-as-some`. On Lachy's "wait until the
merge-script fix lands" it hard-paused the rollout and ended with "tell me if you want me to schedule it". `/thread:next`
and `/thread:close` then closed the session with "once the fix lands" in its Resume instructions. No session and no
rollout was building the fix. Lachy asked why it had not started: the work was technical, so it was the agent's to
start (`how-lachy-decides.md`), and the wording had said it was underway. It is logged as a Misstep on the Companion
record.

The gap: `next` step 1 and close step 2 launch prepared work only when it is a rollout note (ADR 0072). A thread or a
rollout that waits on a task, named in a paused rollout's `## Pause log`, its tasks' `depends-on:`, THREAD.md's
"once [[x]] lands", or this session's own words, got no check that anything builds that task. Close's "new vault tasks:
propose first" rule (ADR 0011) also meant a task an agent filed mid-session to unblock its own work never started.

## Decision

**d1. One read says what builds each awaited task.** `unfinished-rollout.py awaited [--rollout <slug>]... [--task
<slug>]...` reads, read-only, each task named as awaited: the `--task`s the session read (THREAD.md's Where we are, Next
steps or Resume instructions as they stood before this session's first write, a wait this session's own work names,
a task it filed to unblock itself), and per paused rollout the session leads or THREAD.md names, the links in its
`## Pause log` and its unlanded tasks' `depends-on:` / `blocked-by:` entries, its own queue left out. Each prints one
line: `missing`, `rollout`, `landed`, `scheduled` (in a live rollout, `(paused)` when that rollout is), `building`
(`in_progress` by hand), `held` (a `hold_until:` or a status other than open) or `unstarted <task> (<Project>)`.

**d2. Close starts an unstarted one.** Close step 2's **Tasks a wait names.** runs the read, and each
`unstarted <task>` with no hold goes to sub-step 7.11, which runs `/thread:schedule --tasks <task>`: a one-task
schedule, whose § 0 joins the task's project's running rollout in place, ranked first (ADR 0078 d6), or writes a
one-task note whose step 8 hands it to a fresh lead (ADR 0057). It is decided, never asked (Owner *gate*: the work is
technical and the thread already waits on it; ADR 0054). A question schedule's own steps put to him stays his, asked as
schedule asks it. 7.11 runs after 7.10, before step 8's report; `/thread:open save` and a Leg's close start nothing.

**d3. `next` starts it first, as it launches a prepared rollout.** `next` step 1 runs the same read (close step 2's
check, exactly) and step 5 runs the start before this session's own move, in the same turn, with the line opening
`Next move: start [[<task>]], then <move>, …`. While another session holds the thread, only a wait this session's own
work names is checked, since the thread's are that session's.

**d4. The holds.** Each gives close's row `waits on [[<task>]]: nothing is building it (held: <why>); say "start it" to
schedule it` (next's line names it the same way) and starts nothing:

- his "not yet" for that task: `(held: not yet)`. It carries: close step 4 writes the held wait
  `waits on [[<task>]] (held: not yet)` in place of the wait's line, and a later session reads it as that hold again.
  A "not yet" after the start undoes it the way it went: a new note's launch is withdrawn as ADR 0072's is, and a join
  is deferred out of its rollout by `/thread:repair` § 5; the wait then holds as above;
- on the Chorus Stage, `list_sessions` shows a session named for the task, or running, waiting on or resting after work
  on it: `(held: <session> may be building it)`, read fresh;
- the read's own `held` line: `(held: <its why>)`, read fresh;
- `/thread:open save`, and a Leg's close.

**d5. The wording rule.** A Resume instruction, a THREAD.md line, `next`'s line or any carrier says a task is coming
("once [[x]] lands", "waits for [[x]] to merge") only when the read printed `scheduled` (not paused) or `building` for
it, or this session started it (d2, d3). Otherwise it says `[[x]] is filed, not started`, or writes the held wait (d4).

**d6. Status shows the gap.** `/thread:status` on a paused rollout runs the read with `--rollout <slug>` and renders each
`unstarted` line as `WAITS ON [[<task>]]: nothing is building it`. It is never drift, so it routes to no repair: the
start is next's and close's (d2, d3), or his `/thread:schedule --tasks <task>`.

## Decided for him (overturnable)

- Start, never only flag: ADR 0072 already starts a prepared rollout as a decided launch, and his standing priority is
  that mechanics never wait on him. A hold still holds it.
- The start is a one-task schedule, never a bare handoff: schedule already joins a running rollout in place (ADR 0078
  d6) or hands a new note to a fresh lead (ADR 0057), and grades the task first.
- ADR 0011 stands for creating a task; starting a task already filed is no new task, so it is not gated.
- The read is a script verb beside `unstarted`, so its sources and its kinds are tested, and status and close share it.
- A task in a paused rollout reads `scheduled … (paused)`: something holds it, so close starts no second rollout for
  it, but it is no promise either, so d5's wording rule treats it as not being built.

## Considered options

- **Only a step-8 row** (`waits on [[task]]: nothing is building it; say "start it"`): rejected by the decided question.
  It is kept for a held wait only.
- **A fresh session through a handoff of the task:** rejected. Handoff launches rollouts and threads; a task has no
  launch form, and schedule's join and grading would be skipped.
- **Read every open task's `depends-on:` estate-wide:** rejected. A wait no session here named may be another
  session's; orient-all's pass and `waits-on.py`'s `## Waits on` lines (ADR 0078 d7) already show those.

## Consequences

- Close may run schedule inside its own run. Schedule's § 0 refusals (a second rollout it cannot join, an unpushed
  base) and a readiness grade that sets the task aside give the row `waits on [[<task>]]: not started (<its line>)`.
- `next` may run a start and a move in one turn, as ADR 0072 lets it run a launch and a move.
- The read never sees a wait that lives only in prose it was not given: an agent that does not pass a wait's task
  leaves it unread. d5's wording rule is the backstop: "once [[x]] lands" needs a read that says something builds x.
