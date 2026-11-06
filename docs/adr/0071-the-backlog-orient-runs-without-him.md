# 0071 — The Backlog orient runs without him

Date: 2026-11-06
Status: accepted. Built in `thread-skill-p40-1-orient-backlog-mode` (Phase 40, "the next move starts by itself"), from Animately ADR 0016 (grilled with Lachy on 2026-11-04: "With nothing to ask, it runs without him") and the task's two calls decided for him on 2026-11-06 (the clone is made without asking; the mode gets its own ADR). Amends ADR 0036 (R4's gate and § 6's steer become a decided record under `--backlog`), ADR 0042 and `skills/_shared/asking.md` § 1 (the rollout clone is made without the question under `--backlog`), ADR 0057 (the execute handoff becomes the decided start) and ADR 0054 (one new cited row, § B9). ADR 0040's retired batches stay retired: the mode forks schedule runs, as orient-all does.

## Context

The Pulse files Animately's findings into the Backlog and stamps a trigger file when they pile up or one turns urgent (metrics ADR 0015). Chorus starts a Routine from that stamp. What it starts had to be an orient that needs nobody present. Lachy's rules (Animately ADR 0016):

- the Pulse is not a silo: related Backlog tasks from any source join the batch;
- a task not worth a rollout on its own is parked, never closed for being small;
- a task is closed only once it stops being true;
- when it needs guidance it leads him one question at a time, and with nothing to ask it runs without him.

The default orient asks at R4's gate and at § 6's steer, and has no park. Schedule asks the rollout clone, and orient § 9 hands the lead to a fresh session. None of that can run unattended. orient-all's schedule forks are the existing no-questions pattern, but they take the estate pass's grades; this mode has no estate pass.

## Decision

1. **The mode.** `/thread:orient <area> --backlog` (and `--backlog --look`), for an area target only; a project or scoped target, or `--steer` with it, is refused in one line. Its rules live in one file, `skills/orient/backlog.md`, read as a file the way `reshuffle.md` is.
2. **The Backlog and its dispositions.**
   - The Backlog is read by the Pulse's line rules (`backlog-orient.py sweep`, porting backlog_trigger.py's Projects, Task and read_vault), so a task whose frontmatter does not parse is still a member, listed for orient § 4's mend. The area note's `backlog_excludes:` names the excluded projects as name prefixes (Animately's `["[[GifLab]]"]`, the Pulse's EXCLUDED_PROJECT_PREFIX).
   - The dispositions: batch, **park** (`status: parked` and `parked-by: backlog-orient <date>`), **reopen** (an orient park folded into a batch), **obsolete** (`status: dropped` once the task stops being true, never for size; a task's disposition, distinct from the phase **retire**, which applies unchanged), **re-home** (onto a `project`-tagged sub-project under the area), merge and unbundle. No Drop and no rename: the Pulse keys a task by its path.
   - A park without `parked-by: backlog-orient` is a **held park**: his, or made before this ADR. It is frozen: never reopened, scheduled, obsoleted or parked again.
3. **A decided record.** R4's table and § 6's steer (Autonomous) are written into the record's Decided for you section, never put to him (Owners *priorities* or *technical*). The record is a note under the area folder, `Backlog orients/<D> <Area> Backlog orient.md`, tagged `backlog-orient`, never a project target.
4. **His questions come after the start.** Each is put one at a time (§ B9), holding back only its own tasks.
   - Answers are recorded `--by schedule` (`estate-dispatch.py record`). A kept § 3.5 gate is recorded as a `## Decisions` answer, which answer 15 dismisses, so the post-question round queues it.
   - A held gate writes nothing to its task. It is listed under Held by his answer and put again at the next Backlog orient that batches it, as a standalone schedule run would.
   - A decided task the post-question round cannot queue is marked by `backlog-orient.py wait` and counted by the Pulse at its next run.
5. **Schedule's answers.** Each fork asks nothing and takes `skills/orient/backlog.md` § B6's answers. It runs schedule § 1.5's own read-only grading agents, with no round, and returns its `asks[]` for § B9.
   - The rollout clone is made without the question: a clone is local and reversible, and the standing rule "with nothing to ask, it runs without him" covers it.
   - A prior that still holds is never superseded: one he paused, signed off, launched or approved behind a PR, or one carrying a `hold_until` or an `on_merge:`.
6. **The start.**
   - Each parallel note the run writes, the post-question round's included, gets `reconcile-rollout.py stamp-start --backlog`, before the re-stamp. It is the chain's stamp less its `supersedes:` refusal, and it is refused beside a rollout hold, since a held queue starts on Lachy's word.
   - Each serial note's Leg 1 starts through `create_thread` on the Chorus Stage, or is a paste-ready prompt off it.
   - A serial note is never stamped, and `/thread:repair` is never run.
7. **The record and the write-back.**
   - **The record** is written after the last task write, then `last_orient_at` and `last_reason` are written back into the area's `backlog_trigger:` file. The write keeps the Pulse's keys in order, as investigations.atomic_write_json writes, and rounds `last_orient_at` up to the next whole second, so a write in the same second counts as seen.
   - **The guards.** It writes only when four guards pass:
     - the stamp has not moved;
     - every Backlog task written after the sweep's `read_at` is named (linked by the record outside Answered, waiting, linked from a rollout note the record's Batches links, or back-linking one by its `rollout:`);
     - `last_orient_at` is the one the run read;
     - on a re-stamp, no answered task waits.
   - **Fold once, then hold.** A guard that fails folds the new tasks in once; a second failure holds the write-back, and the stamp stays pending. After his answers, one re-stamp lands only when every decided task joined a rollout.
   - **What it departs from.** This departs from metrics ADR 0015 d2 ("the orient writes no task after `last_orient_at`") and from its d9 Baseline bullet: the answers are written after write-back #1, and when the re-stamp is skipped the Pulse counts them, at most one capped pile-up. It narrows the orient's side of metrics ADR 0015's Known race (guard 1 refuses a stamp the run never read, and guard 2 an unnamed write), without closing it: that needs a field agreed across the three halves. The follow-up is the vault task `pulse-adr-0015-records-the-backlog-orient-write-back`.

## Considered options

- **Ask first, then schedule.** Refused: every rollout would wait on his reply, the opposite of "runs without him".
- **Reuse orient-all's forks with the estate grades.** Refused: there is no estate pass here; the forks grade for themselves.
- **Hand-write the start stamp under vault-grammar § Rollout start stamp.** Refused: a script keeps the refusals (serial, run, paused, a hold) in one place, and the chain's `stamp-start` already holds them.
- **Record "it is a gate" as a `## Decisions` answer.** Refused: once the gate clears, a stale bullet would mislead later planners. Asking again matches standalone schedule.
- **Write `last_orient_at` at the end of the run.** Refused: a Pulse stamp landing meanwhile would be silenced, its tasks unread; the guards fold them or hold.

## Consequences

- Chorus's `backlog-orient` Routine is owed while `stamped_at` is newer than `last_orient_at`. A held write-back leaves the stamp pending, so the next run picks it up.
- Held parks are conservative: a park made before this ADR stays his to reopen.
- The Backlog's equality rests on two places, the Pulse's EXCLUDED_PROJECT_PREFIX and the area note's `backlog_excludes:`. Change both together.
- Guard 2 reads mtimes, which is stricter than the Pulse's fingerprints: a filer pass during the run costs one fold, and fails safe.

## Decided for him (overturnable)

1. The record's file name is `<D> <Area> Backlog orient.md`, not `<D>.md`, so no two areas' records share a basename.
2. No rename under `--backlog`: the Pulse keys a task by its path.
3. A held gate is put again at the next orient that batches it; an alternative is to freeze a task listed under the last record's Held by his answer while its note is unchanged.
4. The post-question round re-grades its members, so a kept § 3.5 task can leave again as a One call; it then goes to Questions waiting, never to a second round.
5. Launch-doc detection reads three handoff homes (the resolved path's, the shared root's and this seat's); a doc in another seat's home is missed, and its card's lead then meets `next`'s superseded backstop.
