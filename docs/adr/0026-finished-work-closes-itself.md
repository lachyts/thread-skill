# 0026 — finished work closes itself

Date: 2026-09-27
Status: accepted (amends ADR 0011's vault-task gate for one case)

## Context

Nothing closed a phase note. On Chorus, 11 of 17 phase notes still said `status: open` with no
open task left, so the phased-task view kept a group for every finished phase. The 2026-09-26
Chorus gather archived them by hand. Phases closed only when a rollout lead happened to do it,
which it did for a single-phase rollout and forgot for one spanning eleven. Work landed in an
ordinary session had the same gap one level down: Chorus `p4-3` was built as Chorus ADR 0043 on
2026-09-21 and its task stayed `open` for five days, because close only ever proposes *new* vault
tasks and never changes an existing one. Orient's audit read task and phase status but compared
it with nothing, so a project could look busier than it was indefinitely. Lachy expected orient
to notice.

## Decision

Grilled 2026-09-27. One detector, three writers:

1. **Detect in one place.** A shared reconcile step finds project-level Drift: a phase note open
   whose tasks have all landed, a task open whose PR has merged or whose rollout completion log
   records it as landed, and a superseded rollout note outside `Archive/Rollouts/`. It is a dry
   run unless a writer applies it.
2. **Execute closes the phases it finishes.** Its completion ceremony, after the tasks are marked
   `done`, sets `status: done` and `completed:` on every phase the rollout touched whose tasks
   have all landed. The daily sweep moves them to the archive, as it already does for tasks.
3. **Orient fixes on any steer except Report-only.** Its report carries the drift list. Autonomous,
   Hands-on and Mixed apply the unambiguous items as part of routing; the steering answer
   authorises them, as it authorises a batch launch (ADR 0010). Report-only stays write-free.
   Anything ambiguous is listed for Lachy, never applied. Gather runs the same step first, as a
   backstop, so a roadmap is never formed on top of finished phases.
4. **Close flips a finished task itself, within a guard.** This amends ADR 0011, whose vault-task
   gate existed to keep junk tasks off the agenda; closing a finished one removes agenda noise
   instead of adding it. Close marks an existing task `done` without asking only when all three
   hold: the session was explicitly working that task (opened from it, or named in THREAD.md);
   the work is on the default branch, or the task is not a code task; and the task's own Verify
   line ran green. Anything that fails a condition goes into the approval question close already
   asks. Every flip is reported with a one-line reason.

## Considered options

- **Orient detects only; gather and execute fix.** The audit's first recommendation. Rejected:
  it keeps orient strictly read-only, but the place Lachy looks for the state of a project would
  keep showing finished work until he ran a second verb.
- **Orient fixes even in Report-only.** Rejected: Report-only is the one steer promised to write
  nothing, and dry runs rely on it.
- **Close flips any task it judges finished, unguarded.** Rejected: the three failure modes are
  real. A partly-landed task looks finished (Chorus `p10-12`, one item on PR #58, rightly open);
  work on an unmerged branch has not landed; and a session working near a task can match the
  wrong note.
- **Close proposes every completion.** Rejected: a session that opened a task, merged it and
  passed its Verify line has already answered the question.
