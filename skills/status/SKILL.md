---
name: status
description: 'Use to see the present situation of a rollout queue — a read-only situational report. Triggers on "rollout status of [[rollout]]", "where is [[rollout]] / this rollout", "what state is the rollout in", "what''s left on [[rollout]]", "is [[rollout]] done", or pointing at a rollout note and asking what''s happening. Reads the rollout note + every linked task note (merged, integrating, running, queued or set aside), cross-checks live GitHub PRs + git worktrees, flags drift, and recommends the next action. NEVER writes the vault or merges anything. Read-only sibling of /thread:repair. Scope: Obsidian + read-only gh/git.'
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
target repo (plus, for a RACE task, a plain read of its local verdict file, § 3). § 2's status read also
reads the operator's local ladder file (`~/.config/thread/ladder.toml`), and, for a rollout note with no
`parallel_ceiling:`, the operator's rollout settings (`~/.config/thread/rollouts.toml`). Status itself runs
`rollout-settings.py` for a task whose `max_review_rounds` is absent at both levels (§ 2), and
`lead-integrate.py inputs` resolves `auto_retries` the same way, inside its own read, for a set-aside task whose
notes lack it. Either read of the settings file runs land.sh's `--origin-slug` read, and so one local
`git remote get-url origin` in the Project root, when the file holds a repo table: no network. Writes nothing. Obsidian + GitHub read access only.

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

A pure read, no network (a note with no `parallel_ceiling:` resolves its ceiling through
`rollout-settings.py`, whose only git call is a local `git remote get-url origin`): **every** task carrying `rollout: [[<slug>]]` (glob-by-backlink, so read-only tasks
are included), sorted by schedule order (each task's first wikilink on a list-item or table-row line of the
rollout body, i.e. the `## Queue` table; unlisted tasks after). Status reads these keys and no others:

- top level: `paused` (the pause stamp; null when not paused), `pause_requested` (a soft pause is draining:
  execute → *Pausing + reinstating a rollout*), `incomplete` (§ 1), `counts` (`setAsideAtIntegration`
  included), `progress`, `timeline` and `ladder`, plus `gitEnvHold` (the unacked git-env trips, each
  `{slug, kind, line}`; § 3's Git-env trip flag), `ceilingError` (why `ceiling` is null: an invalid
  `parallel_ceiling`, or an absent one `rollout-settings.py` could not resolve; null otherwise) and
  `ceilingCause` (what that error needs: `stamp`, `file`, `root` or `resolver`; null otherwise), both for § 3's
  Ceiling unresolved flag;
- per task: `slug`, `status`, `queueState`, `setAsideAt`, `pr`, `solo`, `started`, `merged`, `integrating`,
  `waitingOn`, `blockerSummary`, `rung` and `rungDrift`. A set-aside task whose note holds a `## Needs you`
  question (a gate included) also carries `needsHuman`: that question, normalised; the key is absent otherwise.

Each task's `queueState` is one of the six in the count (`merged`, `running`, `integrating`,
`awaiting-integration`, `queued`, `set-aside`) or one of two outside it: `folded` (an affine tombstone) and
`other` (dropped, parked). **Integrating is a durable stamp**: execute's lead writes `integrating:` on a
`review` note with a `pr:` when its Integration begins, so a separate status session reads it too; a `review`
+ `pr:` note without it awaits Integration. A set-aside task's `setAsideAt` is `integration` (its latest
`## Blocker diagnosis` run starts `integration:`), `gate` (gate-pending) or `run`. `waitingOn` lists a queued
task's unmet dependencies; `blockerSummary` is the latest run of the feedback section matching the note's
status.

**Rungs (ADR 0029).** `ladder` is `{source, rungs, error}`: the operator's ladder as the status read found it,
`source` the file's path or `built-in`, `rungs` its rung names bottom first. A refused file gives `rungs: []`,
`source` the path it read and `error` the reason (`<path>:<line>: <reason>`), and status still exits 0. Each
task's `rung` is its `rung:` stamp (null when it has none). Its `rungDrift` is that stamp when a readable ladder
lacks it and the task is unlanded (`queueState` queued, running, awaiting-integration, integrating or
set-aside), else empty: a merged, folded or other task keeps the rung it reached as a record, so a ladder edit
since is no drift, and under a refused file no task drifts.

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

K is the task's `max_review_rounds`, resolved task → rollout → rollouts.toml / built-in, as in execute § 3. For
a key absent at both levels, status runs `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py
--repo <Project root>` (a local file read, no network) and reads `settings.max_review_rounds.value`; on its exit 2
or 3, omit the flag and flag "rollout settings refused: <its stderr line>" on the task (§ 3's Rollout settings
refused flag). When K is not an integer
≥ 1, omit the flag (so `autoRevise` reads false) and flag "invalid round budget" on the task. The call writes
nothing (`--repo` only computes a path). Status reads `branch`, `worktreePath`, `readyAt`, `resumeAt`,
`autoRevise`, `lastRound` and `lastIntegration` from it, and the automatic retry's verdict (ADR 0033): `autoRetry`,
`autoRetryWhy`, `autoRetryAfter`, `autoRetryError`, `autoRetryClass`, `autoRetryBudget`, `autoRetriesUsed`,
`quotaRetriesUsed` and `fingerprint`, plus `prUrlError`. A non-empty `autoRetryError` flags
"invalid round budget: <it>" on the task (execute § 3's round-budget halt). `lastIntegration` is the `## Integration log`'s LAST
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

**A RACE has three states.** Merge-task's exit 5 means the PR merged, but as a combination nobody
verified. Execute's RACE procedure (execute § 4.5) appends the `## Race log` line first, then re-verifies the
merge commit in the background for up to 40 minutes with the lane held: green → `mark-done`; red, rc 124 or a
missing rc → a halt with `reason="RACE: origin/<default> fails the verifier"`. Its verdict file is
`<repoPath>/.claude/integration/race-<slug>.rc`, written last, so an absent one means unfinished. A task that a
`## Race log` line names and that is not done is in the first of these states that matches:

- **Decided:** a dated `## Notes` line on the rollout note records `repair: [[<slug>]] RACE decided: …`. If
  the merge stands, the task reads as merged, never marked; if it does not, repair defers it.
- **In flight:** it still reads `integrating` with an `owner:` whose session is not known to have ended, no
  `paused:` stamp stands (a hard pause stops the re-verify), and its verdict file is absent or reads `0`. That
  is the lead's own procedure, not drift. Render `RACE re-verify in flight` on its Integrating line, flag
  nothing, and treat it as the live queue (§ 4's actions 9 and 10: wait, and check the owner session). It
  turns undecided once that session shows the `RACE: …` halt or no run, or has ended. From any other session,
  status cannot tell which, so say so. It turns undecided too once a `## Race log` line naming it carries
  `git-env halt` (readable from any session), or once that session shows a git-env halt (`git-env trip: the
  shared checkout changed` or `git-env canary failed`, execute § 4.5 *Git-env canary*): the lead never acts on
  a re-verify after a git-env halt, so a `0` verdict there was never acted on.
- **Undecided:** anything else. That is an open escalation, the flag below.

Flag **drift**, one line each in the Drift block. The first three flags are first-match, in this order: a RACE
or UNVERIFIED task's PR is MERGED too, so it is never also flagged merged, never marked, and a RACE in flight
takes none of them.

- **RACE / UNVERIFIED:** a RACE that is undecided (above), or a set-aside task whose reason
  (`blockerSummary`) carries `UNVERIFIED:` and has no `repair: [[<slug>]] RACE decided: …` line (a
  set-aside is never in flight). Main's state is Lachy's call, and until it is recorded the task cannot land:
  `resume` skips it (a `HOLD:` line, exit 3), `hand-back` refuses it (exit 2), and execute halts on a RACE
  once its lane is free and holds an UNVERIFIED task set aside (execute § 4.5). The flag reads only the vault
  and that local verdict file, so it holds offline too.
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
- **Rung drift:** only for a task whose `queueState` is queued, running, awaiting-integration, integrating or
  set-aside, with a non-empty `rungDrift`: "`rung: <x>` is not on the ladder (<ladder.source>): its next call
  starts on the top rung <top>, and reconcile overwrites the stamp". It needs no write: the engine reads it as the
  top rung. A re-stamp to a listed rung, or restoring that rung in `~/.config/thread/ladder.toml`, clears it; a
  re-stamp or a ladder edit is Lachy's choice, and no route sends it to repair (repair § 2). A merged, folded or
  other task is never flagged. The flag reads only the
  vault and a local file, so it holds offline too.
- **Ladder refused:** `ladder.error` is set. Execute halts `ladder file refused` at each call's start until the
  file reads, and the fix is Lachy's edit to `<ladder.source>` (<ladder.error>). The flag reads only the vault
  and a local file, so it holds offline too.
- **Ceiling unresolved:** `ceilingError` is set. Render it verbatim: it ends with its own remedy. Until it
  resolves `next` exits 1, so nothing starts. The fix follows `ceilingCause`, and each is Lachy's:
  - `stamp`: the rollout note's own `parallel_ceiling:` is invalid (`0`, a word, a fraction): fix that stamp
    to an integer >= 1. No settings file is involved.
  - `file`: `~/.config/thread/rollouts.toml` was refused: fix it at the line `ceilingError` names, or stamp
    `parallel_ceiling:` on the rollout note.
  - `root`: the note's Project root is gone (or its origin cannot be read), whether or not a rollouts.toml
    exists: stamp `parallel_ceiling:` on the rollout note (or correct its Project root line).
  - `resolver`: `rollout-settings.py` would not run: stamp `parallel_ceiling:` on the rollout note.

  The flag reads only the vault and local files, so it holds offline too.
- **Rollout settings refused:** a task carries § 2's "rollout settings refused" re-entry flag: its K is
  unknown, so its re-entry is not automatic. Render the stderr line verbatim. When it names
  `~/.config/thread/rollouts.toml` (`rollout-settings: <path>:<line>: …`), the fix is Lachy's edit at that
  line, or a `max_review_rounds:` stamp on the task or rollout note; when it names `--repo` (the Project root
  is gone or its origin unreadable), the fix is that stamp. The flag reads only the vault and local files, so
  it holds offline too.
- **Git-env trip:** `gitEnvHold` is non-empty: execute's git-env canary (execute § 4.5 *Git-env canary*) saw
  the shared checkout's `refs/heads/<default>` or its bareness change during a window, and logged one
  `git-env trip` line per tripped window on the rollout note's `## Git-env log` that no later `git-env ack`
  line names. Render each line verbatim. The whole queue is held: `next` reports `halt: "git-env"`, every
  canary verb exits 3, and `carry` refuses the rollout until `/thread:repair` (its git-env step, 3e) shows the evidence and records
  Lachy's ack. It reads only the vault, so it holds offline too.

**Offline.** `--offline` skips this step: say the report is vault-only, and every resume or reinstate
recommendation it makes carries the caveat "drift is invisible offline; re-run with the live check before
resuming". It skips the live reads only: the RACE / UNVERIFIED, Rung drift and Ladder refused flags still
render, from § 2's data and the local files. The Ceiling unresolved and Rollout settings refused flags render
offline too, from the same local reads. The Git-env trip flag reads only the vault, so it renders
offline too.

### 4. Render the situational report

**Headline.** `[[<rollout>]] — <progress>`, with `progress` verbatim, plus `PAUSED since <stamp>`,
`pause pending (draining)`, `INCOMPLETE: <reason>`, `GIT-ENV HOLD: [[a]], [[b]]` (each slug `gitEnvHold`
names, once) or the lineage (`supersedes [[<prior>]]`,
`superseded by [[<successor>]]`, or § 1's reverse lineage: `superseded by [[N]], close-out interrupted` or
`superseded by [[N]], supersede interrupted`) when they apply.

**The queue-state table.** One group per in-count `queueState`, in this order, each task on one line:

| `queueState` | Group | Each task shows |
|---|---|---|
| `merged` | **Merged** | its PR and `durationMinutes` from `timeline` |
| `integrating` | **Integrating** | the lane: its PR and live state, the time since `integrating:`, and the outcome of `lastIntegration`, or `RACE re-verify in flight` (§ 3) |
| `awaiting-integration` | **Awaiting Integration** | its PR and `ready:` (`inputs.readyAt`) |
| `running` | **Running** | the `owner:` tag; no `owner:` means it was handed back and restarts at the lead's next step; no `started` means it is starting; `auto-retry <autoRetriesUsed>` when above 0 (the verdict sets the counters before its first refusal, so `inputs` carries them for a running note too) |
| `queued` | **Queued** | `waitingOn`, else "behind solo [[x]]" when a started task x carries `solo`, or when x is the first queued task in rank order that carries `solo` and has no `waitingOn` and ranks above this one (`next` holds every task below such a Solo task, whatever its `priority:`; a Solo task with a `waitingOn` holds nothing), else "next free slot" |
| `set-aside` | **Set aside** | where it re-enters (below), the first line of `blockerSummary`, and its automatic retry's count and cool-down (**Automatic retry first**, below) |

**Rungs.** Every task line also shows `rung <name>` when its note has one (§ 2's `rung`).

**Outside the count.** `folded` (an affine tombstone) and `other` (dropped, parked) get no group and no row:
they render as one footer sentence below the groups, outside the count, e.g.
`Outside the count: 1 folded, 1 other.`

**Running: the owner.** The status JSON carries no `owner:`, so read it from the note:
`grep -m1 '^owner:' ~/repos/obsidian/Work/Tasks/<slug>.md`. Render the tag verbatim (it is free-form, never
parsed), and list every distinct tag.

**Automatic retry first (ADR 0033).** A set-aside task's line also shows its automatic retry, from its `inputs`.
A count shows only when `autoRetryBudget` is non-null (the verdict reached the budget), and the first matching form
wins: `auto-retry off` when `autoRetryBudget.autoRetries.value` is 0 (every retry off, quota included);
`quota <quotaRetriesUsed>/5` when `autoRetryClass` is `quota` (a quota block spends no budget); otherwise
`auto-retry <autoRetriesUsed>/<autoRetryBudget.autoRetries.value>`. A null counter (malformed: the verdict fails
closed) shows no count, and `autoRetryClass` alone never shows a count: it is set for every set-aside past the
verdict's first rule, a refused one included. `auto-retry <autoRetriesUsed>/?` shows only when `autoRetryBudget` is
null and `autoRetryWhy` starts `auto_retries unresolved`; any other null budget (a question, a human cause, a
plan-block after a descope, the seeded revise's own, a gate) shows no count, and its reason is in the Needs you
block (below). A cool-down adds `cooling until <autoRetryAfter>`. The route: the live lead (execute § 4.5 step 1.2's
*Automatic retry*) re-enters a set-aside task at its run or at Integration while `inputs` reads `autoRetry: true`,
or once its `autoRetryAfter` ends; an `autoRevise: true` row is the seeded revise's, and a gate is never retried. A
`plan-blocked` one is judged for a descope first (the lead's step 1.2, or repair § 3): a refused descope writes
nothing, so its verdict can still read `autoRetry: true` while the lead skips it, and only repair asks it. The
Re-entry column below is the route once the task is Lachy's.

**Set-aside re-entry.** Where a set-aside task goes back in, keyed on `setAsideAt` plus its `inputs`:

| `setAsideAt` | `resumeAt` | `autoRevise` | The note | Re-entry |
|---|---|---|---|---|
| `integration` | `integration` | `false` | `blocked`, its latest `## Blocker diagnosis` run starts `integration:` | after the automatic retry: Lachy's decision (repair § 3), then `hand-back` retries Integration only: its branch, plan and review stand; with no `pr:` `hand-back` refuses it: repair's restore or recut |
| `run` | `revise` | `true` | `blocked`, a plain rejection: the revise marker, no `revise stopped:`, the last log line `rejected` | none: the lead launches the seeded revise itself (execute § 4.5); a non-empty `prUrlError` waits for Lachy's fix of the note's `pr:` (repair § 3) |
| `run` | `revise` | `false` | `blocked` with `revise stopped:` | after the automatic retry: Lachy's decision (repair § 3), then `hand-back`, then a seeded revise |
| `run` | `revise` | `false` | `review-blocked`, the last log line `rejected` | after the automatic retry (which raises one round itself): Lachy's decision (repair § 3), a one-round raise on his word, then `hand-back`, then a seeded revise |
| `run` | `own` | `false` | `blocked`, `review-blocked` with no `rejected` line, or a code-writing `review` with no `pr:` | after the automatic retry (never for a code-writing `review` with no `pr:`): Lachy's decision (repair § 3), then `hand-back`, then its own call |
| `run` | `own` | `false` | `plan-blocked`, no `## Scope decision (automatic)` (or one whose `descope_armed:` still stands) | when the notes settle it (an optional part, or work a later task owns), `descope` once (the live lead itself, or repair § 3), then `hand-back`, then its own call; otherwise the automatic retry, then Lachy's decision (repair § 3), then `hand-back`, then its own call |
| `run` | `own` | `false` | `plan-blocked` with a `## Scope decision (automatic)` and no `descope_armed:` (blocked again after an automatic descope) | Lachy's decision (repair § 3), then `hand-back`, then its own call; never a silent hand-back, never a second descope |
| `gate` | `own` or `integration` | `false` | `gate-pending` | Lachy's sign-off (and the answer to its `needsHuman` question, if any), then `approve-gates` (execute § 3.7); never `hand-back` |

**Descoped.** A task whose note has a `## Scope decision (automatic)` section was descoped automatically (by the
live lead, execute § 4.5, or repair § 3). Its line also shows that section's first entry, read with
`grep -m1 '^- descoped (automatic)' ~/repos/obsidian/Work/Tasks/<slug>.md` (a read, so still no command that
writes), e.g. `descoped "a canary" → follow-up [[proj-followup-canary]]`, so Lachy sees every automatic descope,
and any wrong owner, without opening the note. Undoing one is repair's (its § 3), on his word, and removes every
record the verb wrote: on the task note, the `## Scope decision (automatic)` section (its entry and its
`<!-- descope run=… -->` marker), the brief pointer or pointer line, the `(automatic)` `## Repair input` line and
`descope_armed:` if it still stands; the follow-up note set to `status: dropped`; and the rollout's `## Notes`
`descope:` line removed (or rewritten as `descope undone:`). A marker left behind makes the next block read as a
second one; a `descope:` line left behind keeps the undone descope in every report and the Completion log.

**Needs you.** One line per decision that is Lachy's and that no Drift line already routes, read from the same
data (§ 2's per-task keys and each task's `inputs`), so it renders offline too. The block sits under a
`Needs you (<n>)` header between the footer and `Drift:`; with no items there is no block. Its items:

- each gate-pending gate, verbatim: `[[<slug>]] sign off gated input: <gate>`, with its `needsHuman` question,
  verbatim, on a `→ asks:` line beneath it when it carries one;
- each set-aside task at `run` or `integration` whose `inputs` reads `autoRetry: false`, no `autoRetryAfter` and
  `autoRevise: false` (or `autoRevise: true` with a non-empty `prUrlError`), a code-writing `review` with no `pr:`
  included: `[[<slug>]] set aside <where> (<status>): <reason> → /thread:repair [[<rollout>]]`, where `<reason>` is
  `autoRetryWhy`, or `prUrlError` for an `autoRevise: true` row (its why names the seeded revise), with its
  `needsHuman` question on a `→ asks:` line beneath it. The line reads `[[<slug>]] answered: awaiting /thread:repair`
  instead when its `## Repair input` already answers its current block (repair § 3's *Answer already recorded*,
  whatever was asked): `inputs`' `fingerprint` is non-null, and
  `grep -F '(block <fingerprint>)' ~/repos/obsidian/Work/Tasks/<slug>.md` prints an entry whose stamp (its first
  word after `- `) is later than every stamp that
  `grep -E '^(### Run [0-9]+ \(|auto_retry_at:|- descoped \(automatic\) )' ~/repos/obsidian/Work/Tasks/<slug>.md`
  prints (a run heading's in its parentheses, `auto_retry_at:`'s value, an automatic descope entry's word after
  `(automatic)`): a run recorded, an automatic retry made or an automatic descope recorded after the answer means
  the task was re-entered since, so an earlier block's text that comes back is a fresh ask. A hand-back leaves no
  such stamp, so the entry is spent before it (repair § 3, and execute's "retry [[task]]": its key becomes
  `(block <fingerprint>; handed back <stamp>)`), which the `-F` read never prints: an identical re-block after it,
  which writes no new run, is a fresh ask. An entry recorded since the last re-entry counts whatever the verdict's
  why, a `same feedback as the block last re-entered` block included. A `-` entry never counts, so a set-aside with no fingerprint (a code-writing `review`
  with no `pr:`) shows as a fresh ask after a pause. The greps are reads, not commands;
- each task whose `inputs` failed, with its failure line.

A set-aside task the RACE / UNVERIFIED, Merged into another base, Merged never marked, PR CLOSED or Possible
PR-less merge flag names is no item: its Drift line routes it to `/thread:repair` (action 7 or 11; under a live
queue, action 10 adds it). A Rung drift excludes nothing: it routes nothing. Offline, only the RACE / UNVERIFIED
flag renders, so only it excludes (the other four read the live check): a CLOSED-PR set-aside is an item there. A
merge hold is no item: the Review required flag routes it (action 10). A cooling task is no item, nor an
`autoRetry: true` one (a `plan-blocked` one included: action 11 routes it).

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
session. The lead's background Integration commands (a verify, a RACE re-verify, the merge step, a backoff)
are not Workflow runs, so there a run means either. While one is in flight, that session's last
`ROLLOUT-STATUS` line reads `state=waiting`. "No run in `/workflows`" counts as evidence of a stall only when
it was checked **in that owner session**, or that session is known to have ended (every owner session, when
there are several tags). From any other session, status cannot tell live from stalled: say so, and recommend
checking the owner session first. While the owner session is alive, its heartbeat re-enters *Cold resume* on a
genuine stall (execute § 8); a closed terminal stops it, and another session resumes only once the owner
session has ended. **The RACE exception:** with a RACE re-verify in flight (§ 3), the owner session's answer
never leads to `/thread:execute`. If that session shows the `RACE: …` halt or no run, or has ended, the RACE
is undecided, and the next step is `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`:
`/thread:execute`'s *Cold resume* would only halt on the RACE (`RACE undecided`) once its lane is free.

**Example report** (the live check on):

```
[[proj-rollout-2026-10-01]] — progress: 1/12 merged, 1 running, 1 integrating, 1 awaiting integration, 1 queued, 7 set aside (1 at Integration) — 5h 5m elapsed, ~32m remaining (rough)

Merged (1)
  [[proj-merged]]           PR #1 (32m) · rung gone
Integrating (1)
  [[proj-integrating]]      PR #3 (open) · 15m in the lane · no Integration logged yet
Awaiting Integration (1)
  [[proj-awaiting]]         PR #4 · ready 2026-10-02T13:30+00:00 · rung opus-xhigh
Running (1)
  [[proj-running]]          owner execute-2026-10-02-ab12cd34
Queued (1)
  [[proj-queued]]           depends on [[proj-at-integration]] (blocked) · rung gone
Set aside (7)
  [[proj-at-integration]]   at Integration → the lead's automatic retry · integration: conflict in a.js cannot be resolved · auto-retry 0/2
  [[proj-rejected]]         revise (automatic) → the lead launches it · revise: rejected at Integration re-review
  [[proj-revise-stopped]]   revise stopped → your decision, then hand-back, then a seeded revise · revise stopped: red after three iterations · auto-retry 2/2
  [[proj-review-blocked]]   review-blocked, rejected → the lead's automatic retry (one round raised) · Round 1: · auto-retry 1/2
  [[proj-plan-blocked]]     own run → your decision, then hand-back, then its own call · the plan judge wants the schema decided first
  [[proj-gate]]             gate → your sign-off, then approve-gates · spend: a paid API — cap USD 5
  [[proj-no-pr]]            own run (approved without a PR) → your decision, then hand-back, then its own call
Outside the count: 1 folded, 1 other.

Needs you (4)
  [[proj-gate]] sign off gated input: spend: a paid API — cap USD 5
  [[proj-revise-stopped]] set aside at its run (blocked): budget: 2/2 used → /thread:repair [[proj-rollout-2026-10-01]]
  [[proj-plan-blocked]] set aside at its run (plan-blocked): needs a human: the note's ## Needs you question → /thread:repair [[proj-rollout-2026-10-01]]
    → asks: Which schema version does the export target?
  [[proj-no-pr]] set aside at its run (review): approved without a PR: a code-writing review note with no pr: is repair's call → /thread:repair [[proj-rollout-2026-10-01]]

Drift:
  ⚠ [[proj-awaiting]] PR #4 is MERGED but the note says review → merged, never marked; /thread:repair runs resume
  ⚠ [[proj-running]] possible PR-less merge: PR #12 (head audit-fix/running) merged after its started: → /thread:repair escalates it
  ⚠ [[proj-queued]] rung drift: `rung: gone` is not on the ladder (built-in): its next call starts on the top rung opus-xhigh, and reconcile overwrites the stamp

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
   `RACE decided:` line: main holds a combination nobody verified, and the queue would only run around the
   held task. A possible PR-less merge gets a confirmed `pr:` only when no lead is live or under a
   stamped pause; while a lead is live repair records it only. A RACE re-verify in flight (§ 3) is not an
   open escalation: the lead decides it itself, so it waits under 9 or 10, and nobody asks Lachy mid-re-verify.
   An unacked git-env trip (§ 3's Git-env trip flag) is an open escalation too → `/thread:repair [[<rollout>]]`,
   ahead of every reinstate or resume: only its § 3e ack, on Lachy's word, lifts the hold.
8. `paused` → "reinstate with `/thread:execute [[<rollout>]]`". For drift independent of the pause, add
   `/thread:repair [[<rollout>]]`, which under a pause only records escalations and decisions and defers: it
   never hands back.
9. `pause_requested` → "the live lead drains it; nothing to do." Repair may only record escalations and
   decisions, or defer. Check `/workflows` in the owner session (`<owner tag>`): if no run shows there, that
   session has ended, or no task carries an `owner:`, nothing is draining it, and
   `/thread:execute [[<rollout>]]` resumes the drain (*Cold resume*: its `next` integrates what awaits,
   starts nothing and stamps `paused:`). The RACE exception (the owner-session qualifier): if a RACE
   re-verify was in flight, the same answer makes it undecided, so the next step is
   `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`.
10. A live queue → "wait for the run; don't resume from here." Check `/workflows` in the owner session
    (`<owner tag>`): if no run shows there, or that session has ended, `/thread:execute [[<rollout>]]` resumes
    (*Cold resume*). Checked from any other session, "no run" proves nothing. A RACE re-verify in flight
    (§ 3) waits here too, as the lead's own procedure. The RACE exception (the owner-session qualifier)
    applies to it: once the owner session shows the `RACE: …` halt or no run, or has ended, the next step is
    `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`. A merge hold (the Review
    required flag) waits on you, not the run: "approve PR #N", and the lead merges on its next tick.
    Meanwhile, the live lead re-enters a set-aside task by itself only when `inputs` reads `autoRevise: true` (the
    seeded revise), `autoRetry: true` or a pending `autoRetryAfter` (its automatic retry, now or once the
    cool-down ends), or when it descopes a `plan-blocked` task the notes settle, once (execute § 4.5), and restarts
    it. Every other set-aside task is never re-entered by the live lead itself: it is a Needs you item, or a Drift
    line routes it. A `plan-blocked` one whose descope the verb refused (exit 3) is repair's too: the refusal
    writes nothing, so its verdict can still read `autoRetry: true` while the lead skips it. One plan-blocked again
    after an automatic descope (a `## Scope decision (automatic)`, no `descope_armed:`) is always Lachy's decision,
    never a silent hand-back. So, with a Needs you item, a set-aside task the Needs you block leaves to its Drift
    line, or a `plan-blocked` set-aside, add `/thread:repair [[<rollout>]]`: its live-queue mode asks you those
    and hands each back on your answer, records a gate sign-off and asks the descope the verb refused or the block
    after a descope, without touching the run.
11. Any drift flag but a Rung drift, a refused ladder, an unresolved ceiling or refused rollout settings, or a
    set-aside task that is a Needs you item or a `plan-blocked` one (repair § 3 judges its descope first) →
    `/thread:repair [[<rollout>]]`.
12. Awaiting Integration, a handed-back running task (no `owner:`), an `autoRevise: true` set-aside, an
    `autoRetry: true` or cooling set-aside (the lead's automatic retry re-enters it; a `plan-blocked` one is
    action 11's), or a free slot, with no lead live → `/thread:execute [[<rollout>]]`.
13. Nothing started → `/thread:execute [[<rollout>]]` to start.

**A refused ladder.** The Ladder refused flag reorders nothing: whichever action matches, from 7 to 13, gets
the fix first: "fix `<ladder.source>` (<ladder.error>) first: execute halts `ladder file refused` at each call's
start until it reads". Status never routes a refused ladder to `/thread:repair` on its own account, because
repair never edits the file; another flag still sends the rollout there under action 11, carrying the fix.
An unresolved ceiling and refused rollout settings are handled the same way: they reorder nothing, add their
fix ahead (§ 3's fix for the flag's cause: the note's stamp, the file at its named line, or a stamp because the
Project root is gone), are never routed to `/thread:repair` on their own account, because repair edits neither
the rollout note's settings nor the file, and action 11 skips them.

**Precedence.** The order is the precedence, with no override on top of it. Lineage (1, 2) comes before the
version (3, 4): a supersede is how a legacy rollout migrates, so a legacy note that a successor's `supersedes:`
names needs its close-out, and `--regenerate` would only meet schedule's refusal again. An open escalation (7)
comes before every reinstate, wait and resume (8 to 13), so status never sends an undecided RACE to
`/thread:execute`. A RACE re-verify in flight is not yet undecided, so it waits (9, 10) instead of escalating.
The RACE exception routes it to repair, never to a resume, once it turns undecided. A refused ladder adds its
fix ahead of whichever action matches and moves none of them, and so do an unresolved ceiling and refused
rollout settings. Offline, every resume or reinstate
recommendation carries § 3's caveat.

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
  `hand-back` or any other; `reconcile-rollout.py status`, `lead-integrate.py inputs` and `rollout-settings.py`
  (§ 2, a read) are the only Python scripts status runs, and `default-branch.sh` the only shell one (besides
  the `land.sh --origin-slug` that `rollout-settings.py` runs itself). Never `lead-integrate.py prepare`,
  `set-aside`, `push` or `undo`, `merge-task.sh`, a `gh pr close`, `merge` or `reopen`, a `git push`, `fetch`
  or `update-ref`: of `gh` and `git`, only § 3's reads.
- **Respect the § 3 budget.** One `worktree list`, one local `remote get-url` (plus the local one
  `rollout-settings.py` makes per resolve when rollouts.toml holds a repo table, § 2), one `gh pr view` per PR'd task
  that has not landed, at most one guarded default-branch read and at most one guarded `gh pr list`. Status is
  a glance; keep it cheap.
- **Don't parse the `## Queue` table** for the task list: use the `status` subcommand's glob-by-backlink (it
  catches tasks the table omits).
- **Don't recommend a resume against a live queue** unless its owner session, checked there, shows no run or
  has ended. Offline, qualify any resume with § 3's caveat.
- **Don't send an undecided RACE / UNVERIFIED to `/thread:execute`.** No reinstate and no resume until its
  `RACE decided:` line is recorded: § 4's action 7 comes first, and repair records the decision in any mode.
  Don't escalate a RACE re-verify in flight either: it is the lead's own procedure until its owner session
  shows the `RACE: …` halt or no run, or has ended (§ 3).
