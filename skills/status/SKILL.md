---
name: status
description: 'Use to see the present situation of a wave rollout — a read-only situational report. Triggers on "wave status of [[rollout]]", "where is [[rollout]] / this rollout", "what state is the rollout in", "what''s left on [[rollout]]", "is [[rollout]] done", or pointing at a rollout note and asking what''s happening. Reads the rollout note + every linked task note and cross-checks live GitHub PRs + git worktrees, flags drift, and recommends the next action. NEVER writes the vault or merges anything. Read-only sibling of /thread:repair. Scope: Obsidian + read-only gh/git.'
---

# /thread:status — the present situation of a rollout

`/thread:status [[rollout]]` answers one question: **where is this rollout's queue right now?** It reads the
rollout note and every task carrying `rollout: [[<slug>]]`, cross-checks them against live GitHub PR state +
git worktrees, flags any **drift**, and prints a single recommended next action.

It is **read-only**: it never stamps frontmatter, never merges, never starts or hands back a task. To *act* on
what it finds, that's `/thread:repair` (the conductor) or `/thread:execute` (the queue's lead). This skill is
the diagnosis; those are the treatment.

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` (older undated `<slug>-rollout` notes
still resolve, see step 1) + its linked task notes, and makes **read-only** `gh`/`git` calls against the
target repo. Writes nothing. Obsidian + GitHub read access only.

## Invocation forms

```
/thread:status [[giflab-rollout]]            # full situational report (live cross-check, the default)
status of [[giflab-rollout]]               # natural language — same thing
/thread:status [[giflab-rollout]] --offline  # vault-only: skip the gh/git cross-check (instant)
```

## Skill flow

### 1. Resolve the rollout note

Resolve `[[<slug>]]` → `~/repos/obsidian/Work/Tasks/<slug>.md`. If several dated/ordinal notes match an
ambiguous name (e.g. "today's giflab rollout"), **list the matches and ask which**: don't assume. Read the
body's `Project root: \`<repoPath>\`` line: it's the repo for the live checks.

**Lineage first, then the version.** A supersede carries a rollout's unlanded tasks to its successor whatever
the prior's `protocol_version` (a legacy rollout is exactly what a supersede migrates), so status reads the
lineage before the version, and a lineage match decides the recommendation (§ 4, actions 1 and 2) before any
version check can. Under a `superseded_by:` or a reverse-lineage match the report is the headline and § 2's
`progress` line, whatever the version, and no queue: the successor holds the unlanded tasks.

**Lineage.** Read `supersedes:` and `superseded_by:` from the rollout frontmatter. A `superseded_by:` means a
supersede carried this rollout's unlanded tasks to the successor: headline it and point at the successor's
status. A `supersedes:` goes in the headline.

**Reverse lineage.** With no `superseded_by:` here, look for a rollout whose `supersedes:` names this one, read
as `unfinished-rollout.py` reads the link (case-insensitive, an aliased `[[<slug>|…]]` included):
`grep -rliE '^supersedes: *"?\[\[<slug>([|][^]]*)?\]\]' ~/repos/obsidian/Work/Tasks/ --include='*.md'`. A
match `[[N]]` means a supersede carried this rollout's unlanded tasks to N and died before schedule step 7.5
closed this note out, so this rollout must never be reinstated or resumed: its tasks are N's. Read N's
`incomplete` from `reconcile-rollout.py status --rollout <N's path>` (the same pure read as § 2):

- non-null → N never ran: headline `superseded by [[N]], supersede interrupted`. Schedule's § 0 pairs the two
  as `interrupted`, and `/thread:schedule <project> --regenerate` finishes it.
- null → N has run: headline `superseded by [[N]], close-out interrupted`. This note, still open, is why
  schedule refuses the repo (`<this> is named by the supersedes: of <N>, which has since run`), and
  `/thread:repair [[<this>]]` finishes step 7.5's close-out on Lachy's confirmation. That holds for a legacy
  note too: `--regenerate` would only meet the same refusal.

**Protocol version.** With no lineage match, read it from the note (the status JSON does not carry it):
`grep -m1 '^protocol_version:' ~/repos/obsidian/Work/Tasks/<slug>.md`.

- `protocol_version: 5` → § 2.
- Absent, `2` or `3` → the rollout predates the queue (ADR 0030). Report it with execute § 2's remedy: if a
  session is running it, hard-pause it (execute → *Pausing + reinstating a rollout*), then
  `/thread:schedule <project> --regenerate`, whose supersede carries every unlanded task into a
  `protocol_version: 5` queue. Render no queue.
- Any other value → report "unsupported protocol version <N>; the queue reads protocol_version: 5", render no
  queue, and recommend nothing runnable.

**Incomplete.** After § 2, read the JSON's `incomplete`: non-null means the rollout must not run as written
(`next` refuses it), so headline it with its reason and the remedy, `/thread:schedule <project> --regenerate`.

### 2. Gather the vault state (deterministic)

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py status --rollout <rollout-note>
```

A pure read, no network: **every** task carrying `rollout: [[<slug>]]` (glob-by-backlink, so read-only tasks
are included), sorted by schedule order (each task's first wikilink on a list-item or table-row line of the
rollout body, i.e. the `## Queue` table; unlisted tasks after). Status reads these keys and no others:

- top level: `paused` (the pause stamp; null when not paused), `pause_requested` (a soft pause is draining:
  execute → *Pausing + reinstating a rollout*), `incomplete` (§ 1), `counts` (`setAsideAtIntegration`
  included), `progress` and `timeline`;
- per task: `slug`, `status`, `queueState`, `setAsideAt`, `pr`, `solo`, `started`, `merged`, `integrating`,
  `waitingOn` and `blockerSummary`.

Each task's `queueState` is one of the six in the count (`merged`, `running`, `integrating`,
`awaiting-integration`, `queued`, `set-aside`) or one of two outside it: `folded` (an affine tombstone) and
`other` (dropped, parked). **Integrating is a durable stamp**: execute's lead writes `integrating:` on a
`review` note with a `pr:` when its Integration begins, so a separate status session reads it too; a `review`
+ `pr:` note without it awaits Integration. A set-aside task's `setAsideAt` is `integration` (its latest
`## Blocker diagnosis` run starts `integration:`), `gate` (gate-pending) or `run`. `waitingOn` lists a queued
task's unmet dependencies; `blockerSummary` is the latest run of the feedback section matching the note's
status.

`timeline` is the progress/ETA block, computed from the per-task `started:` / `merged:` stamps: per-task
`{ slug, started, merged, durationMinutes }` sorted by start, plus `elapsedLabel`, `avgTaskMinutes`,
`remainingLabel` (always a `~… (rough)` figure: the mean task duration × the ceiling-sized chunks of running +
queued tasks) and `complete`. The stamps are durable frontmatter, so it renders **without any workflow run
being alive**. `null` when no task has a `started:` stamp. `progress` is the one-line summary the lead
relays, e.g. `progress: 2/6 merged, 1 running, 1 awaiting integration, 1 queued, 1 set aside — 2h elapsed,
~45m remaining (rough)`.

**Re-entry inputs.** One read-only, local call per task whose `queueState` is `running`, `integrating`,
`awaiting-integration` or `set-aside`, plus any other unmerged task that has `started` and no `pr`:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py inputs --note <task note> --max-review-rounds <K> --repo <repoPath>
```

K is the task's `max_review_rounds`, resolved task → rollout → 4 as in execute § 3. When K is not an integer
≥ 1, omit the flag (so `autoRevise` reads false) and flag "invalid round budget" on the task. The call writes
nothing (`--repo` only computes a path). Status reads `branch`, `worktreePath`, `readyAt`, `resumeAt`,
`autoRevise`, `lastRound` and `lastIntegration` from it. `lastIntegration` is the `## Integration log`'s LAST
line as fields, never a search or a count: null when the note has no log, and a field is null where the line
has `-`. If `inputs` exits 2 (an unreadable note), render "inputs failed: <stderr>" for that task and carry
on.

### 3. Live cross-check (default; `--offline` skips)

The vault is the source of truth, but status is exactly the moment you suspect it's stale. The budget, and
nothing more:

- one `git -C <repoPath> worktree list --porcelain`;
- one local `git -C <repoPath> remote get-url origin` (for its `<owner/name>`);
- one `gh pr view <pr> --json state,mergedAt,mergeCommit,baseRefName,reviewDecision,statusCheckRollup` per
  PR'd task that has not landed;
- at most one default-branch read, and only when one of those PRs reads MERGED: execute § 4's resolver,
  `bash ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/default-branch.sh <repoPath>` (a read-only
  `ls-remote` of origin's HEAD; when it exits non-zero, render "default branch unresolved" and flag each
  MERGED PR as merged, never marked with "base unchecked": `resume` checks the base itself);
- at most one `gh pr list --repo <owner/name> --state merged --limit 200 --json number,url,headRefName,baseRefName,mergedAt`,
  and only when a task with `started` has no `pr`.

Flag **drift**, one line each in the Drift block. The first three flags are first-match, in this order: a RACE
or UNVERIFIED task's PR is MERGED too, so it is never also flagged merged, never marked.

- **RACE / UNVERIFIED:** a `## Race log` line on the rollout note names a task that is not done, or a
  set-aside reason (`blockerSummary`) carries `UNVERIFIED:`, and no dated `## Notes` line on the rollout note
  records `repair: [[<slug>]] RACE decided: …`. Main's state is Lachy's call, and until it is recorded no
  `resume` may run: it would flip the task done on an unverified main. Once it is, the task reads as merged,
  never marked. The flag reads only the vault, so it holds offline too.
- **Merged into another base:** a MERGED PR whose `baseRefName` is not the default branch (the resolver's
  answer). That is the test `resume` applies: it leaves such a task alone, so it is escalated, never flipped:
  `/thread:repair` shows the evidence and leaves the call to Lachy.
- **Merged, never marked:** a note that is not done whose PR is MERGED into the default branch. `resume` is
  the sanctioned path: it checks the state and the default base and flips the note done, and execute's
  *Cold resume* runs it first. `/thread:repair` runs it when no lead is live.
- **PR CLOSED:** an awaiting-Integration, integrating or set-aside-at-Integration task whose PR is CLOSED
  unmerged. `prepare` never reads the PR state, so the loop would integrate it only for merge-task to set it
  aside at its own run. Input-gated: repair offers restore, recut, defer or leave.
- **Review required:** the integrating task's PR reads `reviewDecision: REVIEW_REQUIRED` or
  `CHANGES_REQUESTED`. That is merge-task's exit-7 merge hold: Lachy approves PR #N, and the lead merges on
  its next tick.
- **Possible PR-less merge:** a merged PR from that list whose `headRefName` equals the task's
  `inputs.branch` and whose `mergedAt` is after its `started:`, on a task with no `pr:`. The work may have
  landed while the note never learnt its PR (p12-8's R1 gap); only Lachy can confirm the PR is this task's.
- **Two `integrating:` stamps:** more than one task reads `integrating`, but the lane holds one.
- **A missing tree:** a running task with an `owner:` whose `inputs.worktreePath` is not in the worktree list.
  (A set-aside task's reaped tree is not drift: its re-entry recreates the tree from its branch.)

**Offline.** `--offline` skips this step: say the report is vault-only, and every resume or reinstate
recommendation it makes carries the caveat "drift is invisible offline; re-run with the live check before
resuming".

### 4. Render the situational report

**Headline.** `[[<rollout>]] — <progress>`, with `progress` verbatim, plus `PAUSED since <stamp>`,
`pause pending (draining)`, `INCOMPLETE: <reason>` or the lineage (`supersedes [[<prior>]]`,
`superseded by [[<successor>]]`, or § 1's reverse lineage: `superseded by [[N]], close-out interrupted` or
`superseded by [[N]], supersede interrupted`) when they apply.

**The queue-state table.** One group per in-count `queueState`, in this order, each task on one line:

| `queueState` | Group | Each task shows |
|---|---|---|
| `merged` | **Merged** | its PR and `durationMinutes` from `timeline` |
| `integrating` | **Integrating** | the lane: its PR and live state, the time since `integrating:`, and the outcome of `lastIntegration` |
| `awaiting-integration` | **Awaiting Integration** | its PR and `ready:` (`inputs.readyAt`) |
| `running` | **Running** | the `owner:` tag; no `owner:` means it was handed back and restarts at the lead's next step; no `started` means it is starting |
| `queued` | **Queued** | `waitingOn`, else "behind solo [[x]]" when a started task carries `solo`, else "next free slot" |
| `set-aside` | **Set aside** | where it re-enters (below) and the first line of `blockerSummary` |

**Outside the count.** `folded` (an affine tombstone) and `other` (dropped, parked) get no group and no row:
they render as one footer sentence below the groups, outside the count, e.g.
`Outside the count: 1 folded, 1 other.`

**Running: the owner.** The status JSON carries no `owner:`, so read it from the note:
`grep -m1 '^owner:' ~/repos/obsidian/Work/Tasks/<slug>.md`. Render the tag verbatim (it is free-form, never
parsed), and list every distinct tag.

**Set-aside re-entry.** Where a set-aside task goes back in, keyed on `setAsideAt` plus its `inputs`:

| `setAsideAt` | `resumeAt` | `autoRevise` | The note | Re-entry |
|---|---|---|---|---|
| `integration` | `integration` | `false` | `blocked`, its latest `## Blocker diagnosis` run starts `integration:` | `hand-back` retries Integration only: its branch, plan and review stand |
| `run` | `revise` | `true` | `blocked`, a plain rejection: the revise marker, no `revise stopped:`, the last log line `rejected` | none: the lead launches the seeded revise itself (execute § 4.5) |
| `run` | `revise` | `false` | `blocked` with `revise stopped:` | `hand-back`, then a seeded revise |
| `run` | `revise` | `false` | `review-blocked`, the last log line `rejected` | repair's one-round raise, then `hand-back`, then a seeded revise |
| `run` | `own` | `false` | `blocked`, `plan-blocked`, `review-blocked` with no `rejected` line, or a code-writing `review` with no `pr:` | `hand-back`, then its own call |
| `gate` | `own` or `integration` | `false` | `gate-pending` | Lachy's sign-off, then `approve-gates` (execute § 3.7); never `hand-back` |

**Timing.** It comes from `timeline`, and the estimate is always rough: render it exactly as labelled
(`~50m remaining (rough)`), never as a precise figure. With no merged task yet (`avgTaskMinutes` null) show
elapsed only; `complete: true` → show the total instead ("completed in 2h 10m"); `timeline: null` → no timing
line at all.

**Pauses.** A paused rollout renders as paused, not stalled. `paused` → headline `PAUSED since <stamp>`, list
what's left as usual, and skip the stalled framing: the pause is intentional, so unlanded tasks are "waiting
for reinstate", not blockers. `pause_requested` → `pause pending (draining)`: running task calls finish,
approved tasks integrate and merge, nothing new starts, and once nothing runs, awaits Integration or
integrates, the lead's next step stamps `paused:`.

**Owner-session qualifier.** It applies to a live queue: a running or integrating task with an `owner:`. A
Workflow run is listed in `/workflows` only in the session that launched it, and the `owner:` tag names that
session. "No run in `/workflows`" counts as evidence of a stall only when it was checked **in that owner
session**, or that session is known to have ended (every owner session, when there are several tags). From
any other session, status cannot tell live from stalled: say so, and recommend checking the owner session
first. While the owner session is alive, its heartbeat re-enters *Cold resume* on a genuine stall
(execute § 8); a closed terminal stops it, and another session resumes only once the owner session has ended.

**Example report** (the live check on):

```
[[proj-rollout-2026-10-01]] — progress: 1/12 merged, 1 running, 1 integrating, 1 awaiting integration, 1 queued, 7 set aside (1 at Integration) — 5h 5m elapsed, ~32m remaining (rough)

Merged (1)
  [[proj-merged]]           PR #1 (32m)
Integrating (1)
  [[proj-integrating]]      PR #3 (open) · 15m in the lane · no Integration logged yet
Awaiting Integration (1)
  [[proj-awaiting]]         PR #4 · ready 2026-10-02T13:30+00:00
Running (1)
  [[proj-running]]          owner execute-2026-10-02-ab12cd34
Queued (1)
  [[proj-queued]]           depends on [[proj-at-integration]] (blocked)
Set aside (7)
  [[proj-at-integration]]   at Integration → hand-back retries Integration only · integration: conflict in a.js cannot be resolved
  [[proj-rejected]]         revise (automatic) → the lead launches it · revise: rejected at Integration re-review
  [[proj-revise-stopped]]   revise stopped → hand-back, then a seeded revise · revise stopped: red after three iterations
  [[proj-review-blocked]]   review-blocked, rejected → the raise, then hand-back · Round 1:
  [[proj-plan-blocked]]     own run → hand-back, then its own call · the plan judge wants the schema decided first
  [[proj-gate]]             gate → your sign-off, then approve-gates · spend: a paid API — cap USD 5
  [[proj-no-pr]]            own run (approved without a PR) → hand-back, then its own call
Outside the count: 1 folded, 1 other.

Drift:
  ⚠ [[proj-awaiting]] PR #4 is MERGED but the note says review → merged, never marked; /thread:repair runs resume
  ⚠ [[proj-running]] possible PR-less merge: PR #12 (head audit-fix/running) merged after its started: → /thread:repair escalates it

Recommended next action: /thread:repair [[proj-rollout-2026-10-01]] (an open escalation, the possible PR-less merge, comes before waiting on the live queue)
```

Keep the whole report scannable: it's a glance, not a wall of text.

**Recommended action** — exactly one, the first that matches:

1. `superseded_by:` → `/thread:status [[<successor>]]`: the successor holds the unlanded tasks.
2. Named by another rollout's `supersedes:` (§ 1's reverse lineage) → never reinstate or resume it. The
   successor never ran: `/thread:schedule <project> --regenerate` finishes the supersede. It has run:
   `/thread:repair [[<rollout>]]`, which finishes schedule step 7.5's close-out on your confirmation. Both
   hold whatever this note's `protocol_version`.
3. Predates the queue (`protocol_version` absent, `2` or `3`) → execute § 2's remedy: hard-pause it if a
   session is running it, then `/thread:schedule <project> --regenerate`.
4. Unsupported protocol version → report it; nothing runnable to recommend.
5. `incomplete` → `/thread:schedule <project> --regenerate`.
6. Every task merged → "rollout complete: run the completion ceremony through `/thread:execute [[<rollout>]]`"
   (or "already archived").
7. An open escalation, an undecided RACE / UNVERIFIED or a possible PR-less merge →
   `/thread:repair [[<rollout>]]`, whatever the pause or the queue: repair records Lachy's decision in every
   mode (its § 1). Never reinstate or resume with `/thread:execute` until each RACE / UNVERIFIED task has its
   `RACE decided:` line: a reinstate and a *Cold resume* run `resume` first, and it would flip that task done
   on an unverified main. A possible PR-less merge gets a confirmed `pr:` only when no lead is live or under a
   stamped pause; while a lead is live repair records it only.
8. `paused` → "reinstate with `/thread:execute [[<rollout>]]`". For drift independent of the pause, add
   `/thread:repair [[<rollout>]]`, which under a pause only records escalations and decisions and defers: it
   never hands back.
9. `pause_requested` → "the live lead drains it; nothing to do." Repair may only record escalations and
   decisions, or defer. Check `/workflows` in the owner session (`<owner tag>`): if no run shows there, that
   session has ended, or no task carries an `owner:`, nothing is draining it, and
   `/thread:execute [[<rollout>]]` resumes the drain (*Cold resume*: its `next` integrates what awaits,
   starts nothing and stamps `paused:`).
10. A live queue → "wait for the run; don't resume from here." Check `/workflows` in the owner session
    (`<owner tag>`): if no run shows there, or that session has ended, `/thread:execute [[<rollout>]]` resumes
    (*Cold resume*). Checked from any other session, "no run" proves nothing. A merge hold (the Review
    required flag) waits on you, not the run: "approve PR #N", and the lead merges on its next tick.
    Meanwhile, a set-aside task other than an `autoRevise: true` one is never re-entered by the live lead
    itself (a revise stopped, a rejected review-blocked task, an own run, an at-Integration one or a gate), so
    add `/thread:repair [[<rollout>]]`: its live-queue mode hands those back, applies the raise or records a
    gate sign-off without touching the run.
11. Any drift flag, or a set-aside task other than an `autoRevise: true` one → `/thread:repair [[<rollout>]]`.
12. Awaiting Integration, a handed-back running task (no `owner:`), an `autoRevise: true` set-aside, or a free
    slot, with no lead live → `/thread:execute [[<rollout>]]`.
13. Nothing started → `/thread:execute [[<rollout>]]` to start.

**Precedence.** The order is the precedence, with no override on top of it. Lineage (1, 2) comes before the
version (3, 4): a supersede is how a legacy rollout migrates, so a legacy note that a successor's `supersedes:`
names needs its close-out, and `--regenerate` would only meet schedule's refusal again. An open escalation (7)
comes before every reinstate, wait and resume (8 to 13), so status never sends an undecided RACE to
`/thread:execute`. Offline, every resume or reinstate recommendation carries § 3's caveat.

## Loopable

Status is read-only, so it's safe to run under the built-in `/loop` as a rollout watchdog:
`/loop 45m /thread:status [[<rollout>]]` during a long rollout catches drift and merged-never-marked tasks
early instead of days later. When a looped status finds the rollout `done`/archived, say so and stop the loop
(a dynamic loop ends by not rescheduling; a fixed loop needs `/loop stop`): don't keep polling a finished
rollout. The loop watches and recommends; it never triggers `/thread:repair` or `/thread:execute` on its own.
See execute's §8 (*Unattended driving*) for the full pattern set.

## Don'ts

- **Don't write anything.** No frontmatter edits, no merges, no task starts: that's `/thread:repair` /
  `/thread:execute`. If you find yourself wanting to fix something, stop and recommend the repair verb.
- **There is no cursor: the task notes are the progress.** Don't re-scan GitHub for progress; the live PR
  check is only for drift flags.
- **Never call a writer.** Not `reconcile-rollout.py next` (it stamps `paused:` on a drained pause), `resume`,
  `hand-back` or any other; `reconcile-rollout.py status` and `lead-integrate.py inputs` are the only Python
  scripts status runs, and `default-branch.sh` the only shell one. Never `lead-integrate.py prepare`,
  `set-aside`, `push` or `undo`, `merge-task.sh`, a `gh pr close`, `merge` or `reopen`, a `git push`, `fetch`
  or `update-ref`: of `gh` and `git`, only § 3's reads.
- **Respect the § 3 budget.** One `worktree list`, one local `remote get-url`, one `gh pr view` per PR'd task
  that has not landed, at most one guarded default-branch read and at most one guarded `gh pr list`. Status is
  a glance; keep it cheap.
- **Don't parse the `## Queue` table** for the task list: use the `status` subcommand's glob-by-backlink (it
  catches tasks the table omits).
- **Don't recommend a resume against a live queue** unless its owner session, checked there, shows no run or
  has ended. Offline, qualify any resume with § 3's caveat.
- **Don't send an undecided RACE / UNVERIFIED to `/thread:execute`.** No reinstate and no resume until its
  `RACE decided:` line is recorded: § 4's action 7 comes first, and repair records the decision in any mode.
