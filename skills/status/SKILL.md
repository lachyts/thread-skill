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

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` (older undated `<slug>-rollout` notes
still resolve, see step 1) + its linked task notes, and makes **read-only** `gh`/`git` calls against the
target repo (plus, for a RACE task, a plain read of its local verdict file, § 3). § 2's status read also
reads the operator's local ladder file (`~/.config/thread/ladder.toml`), and, for a rollout note with no
`parallel_ceiling:`, the operator's rollout settings (`~/.config/thread/rollouts.toml`), and the Away state file
(`~/.config/thread/away.json`, a read inside `reconcile-rollout.py status`, for § 4's Trickle line and the ETA's
width; never through `next`), with the leads' leases (`~/.config/thread/leases/*.json`, the same read, p28-4) and,
only when a lease would lapse, the Mac's kern.boottime and kern.waketime (a read-only `sysctl`). Status itself runs
`rollout-settings.py` for a task whose `max_review_rounds` is absent at both levels (§ 2), and
`lead-integrate.py inputs` resolves `auto_retries` the same way, inside its own read, for a set-aside task whose
notes lack it. Either read of the settings file runs land.sh's `--origin-slug` read, and so one local
`git remote get-url origin` in the Project root, when the file holds a repo table: no network. It also runs
execute's `step-boundary.py stands`, a read of the rollout note's `## Pause log` (§ 2's *Room stop*). On a
`shape: serial` note its one read is `leg.py status` (§ 5): the note's `## Leg log`, its Queue and its task notes,
read with no lock, no network and no `gh` or `git` call. § 1's `engine-snapshot.py resolve` reads the note's stamps and makes read-only git calls (rev-parse, status, rev-list) in its Engine snapshot and the Primary checkout (ADR 0043). Writes nothing. Obsidian + GitHub read access only.

## Invocation forms

```
/thread:status [[giflab-rollout]]            # full situational report (live cross-check, the default)
status of [[giflab-rollout]]               # natural language — same thing
/thread:status [[giflab-rollout]] --offline  # vault-only: skip the gh/git cross-check (instant)
```

## Skill flow

### 1. Resolve the rollout note

Resolve `[[<slug>]]` → `~/repos/obsidian/Work/Tasks/<slug>.md`, else `Work/Tasks/Archive/Rollouts/<slug>.md`: a
rollout whose completion ceremony already ran (a serial chain's Complete moves its note there itself). The path it
resolves is `<rollout-note>` in every read below. If several dated/ordinal notes match an ambiguous name (e.g.
"today's giflab rollout"), **list the matches and ask which**: don't assume (Owner *yours*: which rollout he means, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`). Read the body's `Project root: \`<repoPath>\`` line: it's the repo for the live checks (a serial
note has none: § 5).

**Engine snapshot first (ADR 0043).** Whichever session runs it, status takes its scripts and prose from the rollout's own engine root (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/engine-snapshot.md`). This text's prose id: `$Id$` (git `ident`, engine-snapshot.md): pass its hex as `--prose-id`; when it shows no hex, pass none. Before any other read, run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py resolve --rollout <rollout-note> --verb status --prose-id <id>`.
Its `root` is the engine root for every command below, and the hand-over is execute § 1.5's: when `prose.identical` is true keep following this text with `<root>` in place of the rendered root, else read `<root>/skills/status/SKILL.md` as a file and follow it from § 1 (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`). Status never moves anything: its `move` field is only reported. Exit 3 (the snapshot is gone, moved or edited) → report `ENGINE SNAPSHOT UNUSABLE: <why>` (its stderr line) in the headline and go on from the session root. Exit 2 (a usage error, such as a `--prose-id` given no value, or no note at that path), or any other exit but 0 and 3, prints no `root`: report `ENGINE SNAPSHOT RESOLVE FAILED: <its stderr line>` and stop, with nothing read from the rendered root. A reverse-lineage rollout's reads run from that rollout's own `resolve` root.

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
  as `interrupted`, and `/thread:schedule <project> --regenerate` finishes it. On an approved queue (this note
  carries `on_merge: regenerate` beside a rollout `hold_until`, `_shared/vault-grammar.md` § Approved queue) it is
  the chain's I8 window instead: `/thread:execute [[<this>]]` regenerates again (execute § 2 lets it go on), and
  its schedule run finishes the pair as `interrupted`.
- null → N has run: headline `superseded by [[N]], close-out interrupted`. This note, still open, is why
  schedule refuses the repo (`<this> is named by the supersedes: of <N>, which has since run`), and
  `/thread:repair [[<this>]]` finishes step 7.5's close-out on Lachy's confirmation. That holds for a legacy
  note too: `--regenerate` would only meet the same refusal.

**Protocol version.** With no lineage match, read it from the note (the status JSON does not carry it):
`grep -m1 '^protocol_version:' <rollout-note>`, the path resolved above (`Work/Tasks/<slug>.md`, or its
`Archive/Rollouts/` copy: every completed serial chain is read there).

- `protocol_version: 5` → § 2.
- Absent, `2` or `3` → the rollout predates the queue (ADR 0030). Report it with execute § 2's remedy: if a
  session is running it, hard-pause it (execute → *Pausing + reinstating a rollout*), then
  `/thread:schedule <project> --regenerate`, whose supersede carries every unlanded task into a
  `protocol_version: 5` queue. Render no queue.
- Any other value → report "unsupported protocol version <N>; the queue reads protocol_version: 5", render no
  queue, and recommend nothing runnable.

**Shape.** Then read `shape:` from the note as the version is read (`grep -m1 '^shape:' <rollout-note>`, the
same resolved path; no key reads as parallel). `shape: serial` → § 5 instead of §§ 2–4: a
serial rollout is a chain of Legs, not a queue, so the status JSON, the live cross-check and the queue report do not
apply to it. Any other value is parallel: § 2.

**Incomplete.** After § 2, read the JSON's `incomplete`: non-null means the rollout must not run as written
(`next` refuses it), so headline it with its reason and the remedy, `/thread:schedule <project> --regenerate`. On
a `shape: serial` note (read from the note, as the protocol version is) the remedy is instead `status: dropped`,
then `/thread:schedule --tasks <its tasks>`: a serial run supersedes nothing, so `--regenerate` never ends its stamp
(schedule § Serial path).

**Start stamp.** Read the rollout frontmatter's first top-level `start:` line straight from the note, as
Lineage reads `supersedes:`, by `_shared/vault-grammar.md` § Rollout start stamp (its scalar lower-cased, quotes
and an inline ` # comment` dropped): `unattended` is the stamp (*Start when ready*), any other value or none is
no stamp. Only § 4's action 13 reads it.

### 2. Gather the vault state (deterministic)

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py status --rollout <rollout-note>
```

A pure read, no network (a note with no `parallel_ceiling:` resolves its ceiling through
`rollout-settings.py`, whose only git call is a local `git remote get-url origin`): **every** task carrying `rollout: [[<slug>]]` (glob-by-backlink, so read-only tasks
are included), sorted by schedule order (each task's first wikilink on a list-item or table-row line of the
rollout body, i.e. the `## Queue` table; unlisted tasks after). Status reads these keys and no others:

- top level: `paused` (the pause stamp; null when not paused), `pause_requested` (a soft pause is draining:
  execute → *Pausing + reinstating a rollout*), `pausedFor` (`sign-off` under execute § 4.5 step 5's sign-off
  pause, ADR 0034: the run finished everything else and only gates wait on Lachy; null otherwise), `incomplete` (§ 1), `counts` (`setAsideAtIntegration`
  included), `progress`, `timeline` and `ladder`, plus `gitEnvHold` (the unacked git-env trips, each
  `{slug, kind, line, scope}`, `scope` `rollout` for a bare checkout, else `lane`; § 3's Git-env trip flag), `mainRed`
  (`{slug, why, stamp}` per RACE whose revert did not land and that no `RACE decided:` line lifts; § 3's Main red), `holdUntil` (the rollout's own PR hold, its `hold_until:`
  as parsed, `{pr, url, error}`, null when it has none: `_shared/vault-grammar.md` § Hold until; § 3's Hold
  until flag), `onMerge` (an approved queue's `on_merge:` as read, `{value, error}`, null on a note with no rollout
  hold or none: `_shared/vault-grammar.md` § Approved queue; § 3's Hold until flag), `chainStart` (`{prior, pr}`
  when this note is a chain's new note whose start was never stamped, else null; § 3's **Approved queue,
  unstamped:** flag), `trickle` (the Mac-wide cap, § 4's Trickle line; below), `ceilingError` (why `ceiling` is null: an invalid
  `parallel_ceiling`, or an absent one `rollout-settings.py` could not resolve; null otherwise) and
  `ceilingCause` (what that error needs: `stamp`, `file`, `root` or `resolver`; null otherwise), both for § 3's
  Ceiling unresolved flag;
- per task: `slug`, `status`, `queueState`, `setAsideAt`, `pr`, `solo`, `started`, `merged`, `integrating`,
  `waitingOn`, `blockerSummary`, `rung` and `rungDrift`. Each also carries `holdUntil`: the task's own PR hold,
  the same shape as the rollout's, or null, reported whatever the task's state. A set-aside task whose note holds a `## Needs you`
  question (a gate included) also carries `needsHuman`: that question, normalised; the key is absent otherwise.
  A task set aside at Integration whose latest run opens a named marker also carries `integrationBlock`:
  `conflict` (an **Integration conflict**, `integration: conflict unresolved in …`, its resolution brief beneath)
  or `red` (a verifier red at Integration, `integration: verifier red: …`); the key is absent otherwise.

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
`remainingLabel` (always a `~… (rough)` figure: the mean task duration × the chunks of running + queued tasks at
the rollout's limit: its ceiling, or the Trickle's (the Away cap's) room left on this Mac, at least 1: `etaWidth`,
`etaBy` `ceiling`, `trickle` or `away cap`) and `complete`. The stamps are durable frontmatter, so it renders **without any workflow run
being alive**. `null` when no task has a `started:` stamp. `progress` is the one-line summary the lead
relays, e.g. `progress: 2/6 merged, 1 running, 1 awaiting integration, 1 queued, 1 set aside — 2h elapsed,
~45m remaining (rough)`.

`trickle` is the Mac-wide cap read from the notes only (`skills/execute/away.md` § The ETA), read silently (no
WARN: only `next` prints it): `{away, file, why, limit, awayCap, until, morning, elsewhere, lapsed, here, running,
lease}`. `file` is `fresh`, `missing`, `stale` or `unreadable` (`why` says how, null only when fresh; anything but
fresh reads not Away at Trickle 2), `limit` the Trickle N, `awayCap` the Away cap, `until` the file's (fresh only),
`elsewhere` `{<rollout>: n}` the other open, started, parallel rollouts' running tasks whose lead's lease has not
lapsed, `lapsed` the same shape for those whose lease has (left out of the count, `skills/execute/away.md` § The
Trickle), `here` this rollout's own as they count it (0 when paused, closed, never started, not directly in the
tasks dir, or its own lease lapsed), `running` elsewhere plus here, and `lease` this rollout's own lead's lease
(p28-4): `{state, writtenAt, lapsesAt}`, `state` `fresh`, `lapsed`, `room-stop` (lapsed, but a room stop stands, so
it counts), `none` (no lease file: an older snapshot, still counted) or `unreadable` (still counted), `writtenAt` its
last write and `lapsesAt` when it lapses (or lapsed), both UTC and null where they do not apply. Status writes no
lease. `elsewhere` and `running` count notes only, never `next`'s Trickle claims (`skills/execute/away.md` § The
Trickle, *Trickle claims*), so they can trail `next`'s count by up to 20 minutes of unstamped claims (a claim's
life): while another lead's starts are claimed but not yet stamped, `status` shows room on the Mac that `next` still
holds as `trickle: N/N`. Nor do they read the fair share (`skills/execute/away.md` § The Trickle, *A fair
share*): `status` counts notes only, so a place `next` keeps for a waiting rollout shows as room.

**Room stop.** One more read-only, local call, once per report: whether a Chorus room stop stands on the
rollout (execute § Room stop), read from the note's `## Pause log`, the one durable record of it:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/step-boundary.py stands --rollout <rollout-note>
```

It writes nothing. Exit 0: a room stop stands, and stdout names its stamp (`room stop stands since <stamp>`);
exit 4: it has lapsed (`room stop since <stamp> has lapsed: …`, at or past its 6 h bound); exit 5: none stands.
Exit 1 or 2 renders `room stop unreadable: <its stderr line>` under the headline and reads as none. § 4's
*Room stop* renders it.

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
`quotaRetriesUsed` and `fingerprint`, plus `prUrlError`, `humanFix` and `answerRecorded` (ADR 0035). `humanFix` is the
one act that moves a block only Lachy may move ({act, detail, handBack, label, raise}), named by the script, so status
never re-derives a cause; it ignores K. `answerRecorded` is the live answer to the task's current block ({stamp, kind,
form, line}), the one read status shares with execute and repair. `autoRetryWhy` is read only by § 4's count rule
(`auto_retries unresolved`), never as Lachy's reason. A non-empty `autoRetryError` flags
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
  and only when a task with `started` has no `pr`;
- one `gh pr view <url|N> --json state,mergedAt,url` per PR hold whose `error` is null, carried by the rollout
  (§ 2's top-level `holdUntil`) or by a queued, running or set-aside (at its run or at a gate) task (its row's
  `holdUntil`), the holds `next` reads: its `url` as written, or a bare `N` run in the Project root.

**A RACE has six states.** Merge-task's exit 5 means the PR merged, but as a combination nobody
verified. Execute's RACE procedure (execute § 4.5) appends the `## Race log` line first, then re-verifies the
merge commit in the background for up to two hours, a verify-slot wait included, with the lane held: green →
`mark-done`; red, rc 124 or a missing rc → the RACE revert (execute § 4.5 *The RACE revert*, ADR 0046: a revert PR
merged through merge-task, its `revert started:`, `revert opened:`, `reverted on main:` or `revert did not land:`
lines in the `## Race log`, the task then set aside for Lachy), its red
the one the re-verify's Flake check left (ADR 0050: an out-of-diff red its named re-run and confirming run clear
reads green, its Flakes logged by `record-verify`). Its
verdict file is `<repoPath>/.claude/integration/race-<slug>.rc`, written last, so an absent one means unfinished. A
`noslot` verdict file reads like an absent one: the re-verify has not run (no verify slot came in time), and the
lead re-runs it with the lane held. A `heat` verdict file reads the same way: the Mac was too hot to run it (the Heat
hold, `skills/execute/away.md` § Heat), no verdict, never red. A task that a
`## Race log` line names and that is not done is in the first of these states that matches:

- **Decided:** a dated `## Notes` line on the rollout note records `repair: [[<slug>]] RACE decided: …`. If
  the merge stands, the task reads as merged, never marked; if it does not, repair defers it.
- **In flight:** it still reads `integrating` with an `owner:` whose session is not known to have ended, no
  `paused:` stamp stands (a hard pause stops the re-verify), and its verdict file is absent or reads `0`. That
  is the lead's own procedure, not drift (no `revert started:` line names it yet). Render `RACE re-verify in flight` on its Integrating line, flag
  nothing, and treat it as the live queue (§ 4's actions 9 and 10: wait, and check the owner session). It
  turns undecided once that session shows the `RACE: …` halt or no run, or has ended. From any other session,
  status cannot tell which, so say so. It turns undecided too once a `## Race log` line naming it carries
  `git-env halt` (readable from any session), or once that session shows a git-env halt (`git-env trip: the
  shared checkout changed` or `git-env canary failed`, execute § 4.5 *Git-env canary*): the lead never acts on
  a re-verify after a git-env halt, so a `0` verdict there was never acted on.
- **Revert in flight:** a `revert started:` line names it, no `revert did not land:` line does, and it still
  reads `integrating`: the lead's RACE revert (its revert PR opening, merging through merge-task, or its landing
  tail), which step 1.4 of any entry resumes. Render `RACE revert in flight (PR #R)` on its Integrating line (#R
  from its `revert opened:` line; `PR #?` before one), flag nothing, and treat it as the live queue, as for a
  re-verify in flight.
- **Main red:** a `revert did not land:` line names it (§ 2's `mainRed`). Render `RACE: revert did not land (main
  red)` with the line's reason, flag it (RACE / UNVERIFIED, below), and say that the whole rollout is held:
  nothing starts, restarts or retries, and execute halts at once on every entry until Lachy's `RACE decided:`
  line, since `main` is red and every new start would branch from it.
- **Reverted:** a `reverted on main:` line names it and it no longer reads `integrating` (the landing tail's
  set-aside row ran): its merge is undone on `main` and the task is set aside for Lachy. Render `RACE reverted on
  main (<sha12>)` with the line's `main back at …`, `… but for Inert paths` or `main not re-verified (lane held)`,
  and flag it: the decision is about the task alone (re-land it through a new `pr:`, or defer it), and a `main not
  re-verified` one still holds the Integration lane.
- **Undecided:** anything else. That is an open escalation, the flag below.

Flag **drift**, one line each in the Drift block. The first three flags are first-match, in this order: a RACE
or UNVERIFIED task's PR is MERGED too, so it is never also flagged merged, never marked, and a RACE in flight
takes none of them, nor does a RACE revert in flight.

- **RACE / UNVERIFIED:** a RACE that is undecided (above), main red or reverted, or a set-aside task whose reason
  (`blockerSummary`) carries `UNVERIFIED:` and has no `repair: [[<slug>]] RACE decided: …` line (a
  set-aside is never in flight). Main's state is Lachy's call, and until it is recorded the task cannot land:
  `resume` skips it (a `HOLD:` line, exit 3), `hand-back` refuses it (exit 2), and an undecided RACE holds the
  Integration lane, never a start (ADR 0046), until it is reverted with `main` restored: execute halts `race`
  once nothing else moves. A main-red one holds the whole rollout: execute halts at once on every entry. An
  UNVERIFIED task is held set aside (execute § 4.5). A reverted RACE's PR never re-enters: `resume`, `hand-back`
  and the automatic retry leave it until a new `pr:` re-lands it. The flag reads only the vault
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
  the shared checkout's `refs/heads/<default>` or its bareness change during a window, or a Bookkeeping miss's
  state check fail, and logged one `git-env trip` line per tripped window on the
  rollout note's `## Git-env log` that no later `git-env ack` line names (a `git-env miss` line holds
  nothing). Render each line verbatim. It holds what it threatens (ADR 0046), by each entry's `scope`: a bare checkout (`rollout`) holds the whole rollout:
  `next` reports `halt: "git-env"` at once, every canary verb exits 3 and nothing new starts; any other trip
  (`lane`) holds the Integration lane only (`next`'s `laneHold`, the canary's exit 9), while task calls go on.
  `carry` refuses the rollout under either until `/thread:repair` (its git-env step, 3e) shows the evidence and records
  Lachy's ack. It reads only the vault, so it holds offline too.
- **Hold until:** a non-null `holdUntil`, the rollout's or a task's (`_shared/vault-grammar.md` § Hold until),
  read with the `gh pr view` above. Render `HELD until <pr> merges (<state>)` while the PR reads OPEN (or the
  read fails: `(state unread: <its line>)`), `HELD until <pr> merges (CLOSED): remove or fix hold_until on [[<note>]]`
  once it reads CLOSED, `hold released: <pr> merged` once it reads MERGED (the lead's next `next` clears it),
  and `HOLD_UNTIL UNREADABLE: <why>` for a non-null `error`, with no gh call. Offline it renders `HELD until <pr>
  merges (state unchecked offline)`. A rollout hold holds every start; a task's holds that task. On an approved
  queue (a non-null `onMerge` with a null `error`) the OPEN line adds `; then regenerates and starts the new note`,
  and MERGED reads `merged: the lead regenerates [[<note>]]` (`/thread:execute [[<note>]]` when no lead is live),
  never `hold released`: its verdict keeps the hold standing. A non-null `onMerge.error` renders `ON_MERGE
  UNREADABLE: <why>`, waiting silently while the PR is open and holding on Lachy at the merge. A hold is never
  drift: the lead waits on its merge and `next` releases and clears it itself, and a CLOSED or unreadable one is
  Lachy's edit to the note, so status never routes a hold to `/thread:repair`.
- **Approved queue, unstamped:** a non-null `chainStart`: an approved queue's regenerate wrote this note and
  closed `[[<prior>]]` out when `<pr>` merged, and its lead died, or its `stamp-start` stopped, before the start
  stamp, so the Chorus Stage will not start it. Render `APPROVED QUEUE, UNSTAMPED: superseded [[<prior>]] when <pr>
  merged; start it by hand` (§ 4, action 13). It reads only the vault, so it holds offline too.

**Offline.** `--offline` skips this step: say the report is vault-only, and every resume or reinstate
recommendation it makes carries the caveat "drift is invisible offline; re-run with the live check before
resuming". It skips the live reads only: the RACE / UNVERIFIED, Rung drift and Ladder refused flags still
render, from § 2's data and the local files. The Ceiling unresolved and Rollout settings refused flags render
offline too, from the same local reads. The Git-env trip flag reads only the vault, so it renders
offline too, and so does the Hold until flag, its state unchecked.

### 4. Render the situational report

**Headline.** `[[<rollout>]] — <progress>`, with `progress` verbatim, plus `PAUSED since <stamp>` (or, with
`pausedFor: sign-off`, `AWAITING SIGN-OFF since <stamp>: [[a]], [[b]]`, the tasks set aside at `gate`),
`pause pending (draining)`, `ROOM STOP since <stamp>: awaiting the Stage's resume` or
`room stop since <stamp> lapsed: the owner's heartbeat re-enters` (§ 2's *Room stop*, exit 0 or 4),
`INCOMPLETE: <reason>`, `GIT-ENV HOLD: [[a]], [[b]]` (each slug `gitEnvHold`
names, once, then ` — lane only`, or ` — whole rollout` when an entry reads `scope: rollout`), `MAIN RED: [[x]]
(revert did not land)` (each `mainRed` slug: § 3's Main red), `HELD until <pr> merges (<state>)` or `HOLD_UNTIL UNREADABLE: <why>` (the rollout's own
`holdUntil`, § 3's Hold until flag: the lead waits on the merge and releases itself), `ENGINE SNAPSHOT UNUSABLE: <why>` (§ 1) or the lineage (`supersedes [[<prior>]]`,
`superseded by [[<successor>]]`, or § 1's reverse lineage: `superseded by [[N]], close-out interrupted` or
`superseded by [[N]], supersede interrupted`) when they apply.

**The engine line**, right under the headline, from § 1's resolve: `Engine: snapshot <sha12> (<a> ahead, <b> behind the Primary checkout at <head12>)` (its `sha`, `ahead`, `behind` and `primaryHead`: the counts are the snapshot's own, its commits the Primary's HEAD lacks and the Primary's commits it lacks, so a snapshot one commit behind a pulled Primary reads `0 ahead, 1 behind`), `Engine: Primary checkout (no snapshot)` for an unstamped note with a git Primary, or `Engine: plugin cache <root> (no snapshot)` with none (`primary` null).

**The Trickle line**, right under the engine line, from `trickle` (execute away.md: one Mac-wide cap, its value by
Away state). Not Away: `Trickle: not Away · N <limit> · <running>/<limit> tasks running on this Mac (<here> here[,
<n> in [[<r>]]…]) · away.json <fresh until <until> | missing: the default | stale: <why>, read as not Away, Trickle
2 | unreadable: <why>, read as not Away, Trickle 2>`. Away: `Trickle: Away until <until> · the Away cap <awayCap>
holds (N <limit> by day) · <running>/<awayCap> tasks running on this Mac (…) · away.json fresh`. When `running`
reaches the cap in force (`limit` not Away, `awayCap` Away) the count adds `: full, new starts wait (a meant wait,
never stalled)`: a row held on `trickle:` or `away cap:` is the cap at work, never a blocker. The lease (p28-4)
appends, in this order: `· not counted (lease lapsed): <n> in [[<r>]]…` when `lapsed` is non-empty; `· this lead's
lease lapsed at <lapsesAt>: its in_progress tasks hold no room` when `lease.state` is `lapsed`; `· lease held by the
room stop` when it is `room-stop`. A fresh, absent or unreadable lease adds nothing.

**The queue-state table.** One group per in-count `queueState`, in this order, each task on one line:

| `queueState` | Group | Each task shows |
|---|---|---|
| `merged` | **Merged** | its PR and `durationMinutes` from `timeline` |
| `integrating` | **Integrating** | the lane: its PR and live state, the time since `integrating:`, and the outcome of `lastIntegration`, or `RACE re-verify in flight` or `RACE revert in flight (PR #R)` (§ 3) |
| `awaiting-integration` | **Awaiting Integration** | its PR and `ready:` (`inputs.readyAt`) |
| `running` | **Running** | the `owner:` tag; no `owner:` means it was handed back and restarts at the lead's next step; no `started` means it is starting; `auto-retry <autoRetriesUsed>` when above 0 (the verdict sets the counters before its first refusal, so `inputs` carries them for a running note too) |
| `queued` | **Queued** | `held until <pr> merges` while the rollout's `holdUntil` holds (§ 3), else `waitingOn`, else `held until <pr> merges` for its own held `holdUntil`, else "behind solo [[x]]" when a started task x carries `solo`, or when x is the first queued task in rank order that carries `solo` and has no `waitingOn` and ranks above this one (`next` holds every task below such a Solo task, whatever its `priority:`; a Solo task with a `waitingOn` holds nothing), else "next free slot" |
| `set-aside` | **Set aside** | where it re-enters (below), the first line of `blockerSummary`, its automatic retry's count and cool-down (**Automatic retry first**, below), and `answered: …` for an answered one (**Needs you**, below); a task set aside at Integration names its `integrationBlock`: `Integration conflict → …` in place of `at Integration → …` for `conflict`, `at Integration, verifier red → …` for `red` |

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
plan-block after a descope, the seeded revise's own, a gate) shows no count, and its `humanFix` is in the Needs you
block (below). A cool-down adds `cooling until <autoRetryAfter>`. The route: the live lead (execute § 4.5 step 1.2's
*Automatic retry*) re-enters a set-aside task at its run or at Integration while `inputs` reads `autoRetry: true`,
or once its `autoRetryAfter` ends; an `autoRevise: true` row is the seeded revise's, and a gate is never retried. A
`plan-blocked` one is judged for a descope first (the lead's step 1.2, or repair § 3): a refused descope is
recorded: its verdict reads `autoRetry: false` and its `humanFix` reads `decide scope or defer`, and only repair asks
it. An answered block is never retried (`answerRecorded`). The Re-entry column below is the route once the task is
Lachy's.

**Set-aside re-entry.** Where a set-aside task goes back in, keyed on `setAsideAt` plus its `inputs`:

| `setAsideAt` | `resumeAt` | `autoRevise` | The note | Re-entry |
|---|---|---|---|---|
| `integration` | `integration` | `false` | `blocked`, its latest `## Blocker diagnosis` run starts `integration:` | after the automatic retry: Lachy's decision (repair § 3), then `hand-back` retries Integration only: its branch, plan and review stand; with no `pr:` `hand-back` refuses it: restore, recut or defer (repair § 4; a MERGED PR is § 3c's) |
| `run` | `revise` | `true` | `blocked`, a plain rejection: the revise marker, no `revise stopped:`, the last log line `rejected` | none: the lead launches the seeded revise itself (execute § 4.5); a non-empty `prUrlError` waits for Lachy's fix of the note's `pr:` (repair § 3) |
| `run` | `revise` | `false` | `blocked` with `revise stopped:` | after the automatic retry: Lachy's decision (repair § 3), then `hand-back`, then a seeded revise |
| `run` | `revise` | `false` | `review-blocked`, the last log line `rejected` | after the automatic retry (which raises one round itself): Lachy's decision (repair § 3), a one-round raise on his word, then `hand-back`, then a seeded revise |
| `run` | `own` | `false` | `blocked`, `review-blocked` with no `rejected` line, or a code-writing `review` with no `pr:` | after the automatic retry (never for a code-writing `review` with no `pr:`): Lachy's decision (repair § 3), then `hand-back`, then its own call |
| `run` | `own` | `false` | `plan-blocked`, no `## Scope decision (automatic)` (or one whose `descope_armed:` still stands) | when the notes settle it (an optional part, or work a later task owns), `descope` once (the live lead itself, or repair § 3), then `hand-back`, then its own call; a refused descope is recorded and is Lachy's (`decide scope or defer`; never while `descope_armed:` stands, whose armed descope is re-run and handed back); otherwise the automatic retry, then Lachy's decision (repair § 3), then `hand-back`, then its own call |
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
- each set-aside task at `run` or `integration` whose `inputs` reads a non-null `humanFix` and a null
  `answerRecorded` (ADR 0035: the script names the one act that moves it, so status never re-derives a cause), a
  code-writing `review` with no `pr:` included:
  `[[<slug>]] set aside <where> <humanFix.label>: <humanFix.act> → /thread:repair [[<rollout>]]`, `<where>`
  `at Integration` or `at its run` (a task with an `integrationBlock` names it:
  `at Integration (Integration conflict)` for `conflict`, `at Integration (verifier red)` for `red`), with
  `→ <humanFix.detail>` beneath it and its `needsHuman` question on a `→ asks:` line (for `answer the question` the
  detail is the question itself, so it shows once, as `→ asks:`). A null `humanFix` is the lead's own re-entry (its
  seeded revise, its automatic retry now or after a cool-down, its automatic descope, or a recorded `hand-back`
  answer it hands back), so it is no item;
- each answered set-aside, read from `answerRecorded` alone: an `awaiting repair` answer, or a `hand-back` one whose
  `humanFix` is non-null, reads `[[<slug>]] answered: awaiting /thread:repair` (repair still has work to do before
  the hand-back: its `humanFix` is `finish the recorded answer`); a `left` answer reads
  `[[<slug>]] answered: left set aside → /thread:repair [[<rollout>]]`. A `hand-back` answer whose `humanFix` is null is no item: its Set aside line reads `answered: the
  lead hands it back`, or `answered: at the reinstate` under `paused` or `pause_requested` (the lead's *Recorded
  answer* waits for it). An answer counts only while `answerRecorded` reads it: a re-entry since (a run, an automatic
  retry, an automatic descope, a new `started:`) or a hand-back, which spends it, makes the block a fresh ask, and its
  label's `ask <k>` tells it apart;
- each task whose `inputs` failed, with its failure line.

A set-aside task the RACE / UNVERIFIED, Merged into another base, Merged never marked, PR CLOSED or Possible
PR-less merge flag names is no item: its Drift line routes it to `/thread:repair` (action 7 or 11; under a live
queue, action 10 adds it). A Rung drift excludes nothing: it routes nothing. Offline, only the RACE / UNVERIFIED
flag renders, so only it excludes (the other four read the live check): a CLOSED-PR set-aside is an item there. A
merge hold is no item: the Review required flag routes it (action 10). A cooling task is no item, nor an
`autoRetry: true` one (a `plan-blocked` one included: action 11 routes it).

**Timing.** It comes from `timeline`, and the estimate is always rough: render it exactly as labelled
(`~50m remaining (rough)`), never as a precise figure. Its chunks are the rollout's limit (`etaWidth`, by
`etaBy`): by day under the Trickle that can be narrower than the ceiling. With no merged task yet (`avgTaskMinutes` null) show
elapsed only; `complete: true` → show the total instead ("completed in 2h 10m"); `timeline: null` → no timing
line at all.

**Pauses.** A paused rollout renders as paused, not stalled. `paused` → headline `PAUSED since <stamp>`, list
what's left as usual, and skip the stalled framing: the pause is intentional, so unlanded tasks are "waiting
for reinstate", not blockers. With `pausedFor: sign-off` the headline is `AWAITING SIGN-OFF since <stamp>` with
the waiting tasks (each gate-pending task, its pending gates verbatim; its queued dependants "waiting on it"):
the run finished everything else and closed, and the rest is Lachy's sign-off. `pause_requested` → `pause pending (draining)`: running task calls finish,
approved tasks integrate and merge, nothing new starts, and once nothing runs, awaits Integration or
integrates, the lead's next step stamps `paused:`.

**Room stop.** A standing room stop (§ 2's `stands`, exit 0) renders as a room stop, not a stall: headline
`ROOM STOP since <stamp>: awaiting the Stage's resume`, what's left listed as usual, and no stalled framing.
On the Chorus Stage the lead stopped each Workflow call at a step boundary for a Login at its line, or nearing it
in a spread (execute § Room stop), so its owner session (the lead that wrote it, which the tasks' `owner:` tags
name) shows no run in `/workflows` by design. Its tasks need not read running or integrating either: a call whose
row came in before its stop was reconciled, and the signal can come in a cool-down's `waiting` turn with nothing
in flight, so they may all await Integration, sit set aside or wait queued. While that session is alive (not
known to have ended) the room stop is a live queue whatever its tasks read and whatever `/workflows` shows:
action 10 matches it ahead of drift and every resume (11 to 13), and the Stage owes it the resume, so the
recommendation is to wait for it, never `/thread:execute` from here, because any loop entry, whoever opens it,
ends the room stop and resumes the stopped calls on a Login still at its line, and the Stage then sends nothing,
since its resume skips a lead that has launched work since. A lapsed one (exit 4) renders `room stop since
<stamp> lapsed: the owner's heartbeat re-enters`: it is a live queue the same way, and the owner session's
heartbeat re-enters *Cold resume* on its next tick, which ends it and resumes the stopped calls by handle, so
wait for that too. Under either, once the owner session has ended (the owner-session qualifier), nothing owes the
resume and the room stop is no live queue: action 10's or 12's resume applies as usual, and that *Cold resume*
ends it. A stamped pause comes first (action 8): the Stage's resume skips a paused lead, so the reinstate is
yours, and it ends the room stop as any loop entry does.

**Owner-session qualifier.** It applies to a live queue: a running or integrating task with an `owner:`, or a
room stop, standing or lapsed, whatever its tasks read (*Room stop* above). A Workflow run is listed in
`/workflows` only in the session that launched it, and the `owner:` tag names that session. The lead's
background Integration commands (a verify, a RACE re-verify, the merge step, a backoff) are not Workflow runs,
so there a run means either. While one is in flight, that session's last `ROLLOUT-STATUS` line reads
`state=waiting`. "No run in `/workflows`" counts as evidence of a stall only when it was checked **in that owner
session**, or that session is known to have ended (every owner session, when there are several tags); under a
room stop only the session's end counts, since its run is gone by design. From any other session, status cannot
tell live from stalled: say so, and recommend checking the owner session first. A lapsed lease (`trickle.lease`,
§ 2) means no entry, tick or `next` for 45 minutes after its last write, or after the Mac's latest boot or wake if
later: evidence the lead stopped, never proof the session ended. While the owner session is alive, its heartbeat re-enters *Cold resume* on a
genuine stall (execute § 8); a closed terminal stops it, and another session resumes only once the owner
session has ended. **The RACE exception:** with a RACE re-verify in flight (§ 3), the owner session's answer
never leads to `/thread:execute`. If that session shows the `RACE: …` halt or no run, or has ended, the RACE
is undecided, and the next step is `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`:
`/thread:execute`'s *Cold resume* would only hold the lane on the RACE and halt `race` (`RACE undecided`) once
nothing else moves. A RACE revert in flight (§ 3) is the lead's own work too: the owner session finishes it, and
any entry's step 1.4 resumes it.

**Example report** (the live check on):

```
[[proj-rollout-2026-10-01]] — progress: 1/12 merged, 1 running, 1 integrating, 1 awaiting integration, 1 queued, 7 set aside (1 at Integration) — 5h 5m elapsed, ~32m remaining (rough)
Engine: snapshot 0123456789ab (0 ahead, 0 behind the Primary checkout at 0123456789ab)
Trickle: not Away · N 2 · 2/2 tasks running on this Mac (1 here, 1 in [[other-rollout-2026-10-01]]): full, new starts wait (a meant wait, never stalled) · away.json fresh until 2026-10-02T18:00:00Z

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
  [[proj-at-integration]]   Integration conflict → the lead's automatic retry · integration: conflict unresolved in a.js · auto-retry 0/2
  [[proj-rejected]]         revise (automatic) → the lead launches it · revise: rejected at Integration re-review
  [[proj-revise-stopped]]   revise stopped → your decision, then hand-back, then a seeded revise · revise stopped: red after three iterations · auto-retry 2/2
  [[proj-review-blocked]]   review-blocked, rejected → the lead's automatic retry (one round raised) · Round 1: · auto-retry 1/2
  [[proj-plan-blocked]]     own run → your decision, then hand-back, then its own call · the plan judge wants the schema decided first
  [[proj-gate]]             gate → your sign-off, then approve-gates · spend: a paid API — cap USD 5
  [[proj-no-pr]]            own run (approved without a PR) → your decision, then hand-back, then its own call
Outside the count: 1 folded, 1 other.

Needs you (4)
  [[proj-gate]] sign off gated input: spend: a paid API — cap USD 5
  [[proj-revise-stopped]] set aside at its run (blocked, Blocker diagnosis run 1): hand back or defer → /thread:repair [[proj-rollout-2026-10-01]]
    → budget: 2/2 used
  [[proj-plan-blocked]] set aside at its run (plan-blocked, Plan-blocked feedback run 1): answer the question → /thread:repair [[proj-rollout-2026-10-01]]
    → asks: Which schema version does the export target?
  [[proj-no-pr]] set aside at its run (review, no PR): hand back or defer → /thread:repair [[proj-rollout-2026-10-01]]
    → approved without a PR: a code-writing review note with no pr: is repair's call

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
5. `incomplete` → `/thread:schedule <project> --regenerate`; on a `shape: serial` note, stamp it `status: dropped`,
   then `/thread:schedule --tasks <its tasks>` (§ 1's **Incomplete**).
6. Every task merged → "rollout complete: run the completion ceremony through `/thread:execute [[<rollout>]]`"
   (or "already archived"). When the note declares `completion_verifier:`, also print a `Completion verify:` line
   from the note's `## Completion verify log` (execute § 4.5 step 5): its last line, or `not run yet` with none.
   A `-> green`, `-> flake` or `-> red` line is decided; any other (`rerun` or a no-verdict one) is the ceremony
   waiting on the suite, which the lead's own `--run` owns while its turn reads `completion verify in flight`; a halt whose reason starts `completion verify` → `/thread:repair [[<rollout>]]`
   (its § 3f).
7. An open escalation, an undecided RACE / UNVERIFIED or a possible PR-less merge →
   `/thread:repair [[<rollout>]]`, whatever the pause or the queue: repair records Lachy's decision in every
   mode (its § 1). Never reinstate or resume with `/thread:execute` until each RACE / UNVERIFIED task has its
   `RACE decided:` line: main holds a combination nobody verified, and the queue would only run around the
   held task. A possible PR-less merge gets a confirmed `pr:` only when no lead is live or under a
   stamped pause; while a lead is live repair records it only. A RACE re-verify in flight (§ 3) is not an
   open escalation: the lead decides it itself, so it waits under 9 or 10, and nobody asks Lachy mid-re-verify.
   Nor is a RACE revert in flight (§ 3): the lead finishes it, so it waits the same way.
   An unacked git-env trip (§ 3's Git-env trip flag) is an open escalation too → `/thread:repair [[<rollout>]]`,
   ahead of every reinstate or resume: only its § 3e ack, on Lachy's word, lifts the hold.
8. `paused` → "reinstate with `/thread:execute [[<rollout>]]`". For drift independent of the pause, add
   `/thread:repair [[<rollout>]]`, which under a pause only records escalations and decisions and defers: it
   never hands back. With `pausedFor: sign-off` → "sign off each waiting gate (or /thread:repair to defer),
   then /thread:execute [[<rollout>]]; until then it is this repo's one unfinished rollout" (execute's
   *Reinstate* runs the standing approval first, then `clear-pause`, which refuses while a gate is unsigned).
9. `pause_requested` → "the live lead drains it; nothing to do." Repair may only record escalations and
   decisions, or defer. Check `/workflows` in the owner session (`<owner tag>`): if no run shows there, that
   session has ended, or no task carries an `owner:`, nothing is draining it, and
   `/thread:execute [[<rollout>]]` resumes the drain (*Cold resume*: its `next` integrates what awaits,
   starts nothing and stamps `paused:`). Under a room stop, standing or lapsed (§ 4's *Room stop*), "no run" is
   no evidence while its owner session is alive: a standing one waits for the Stage's resume, which drains it, and
   a lapsed one for the owner's heartbeat, whose *Cold resume* drains it; never `/thread:execute`. The RACE
   exception (the owner-session qualifier): if a RACE
   re-verify was in flight, the same answer makes it undecided, so the next step is
   `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`.
10. A live queue → "wait for the run; don't resume from here." A room stop, standing or lapsed, is one while
    its owner session is alive, whatever its tasks read and whatever `/workflows` shows, even when no task reads
    running or integrating (§ 4's *Room stop*): a standing one → "wait for the Stage's resume", never `/thread:execute`,
    which would end the room stop on a Login still at its line; a lapsed one waits for the owner's heartbeat.
    Otherwise check `/workflows` in the owner session
    (`<owner tag>`): if no run shows there, or that session has ended, `/thread:execute [[<rollout>]]` resumes
    (*Cold resume*). Checked from any other session, "no run" proves nothing. A RACE re-verify in flight
    (§ 3) waits here too, as the lead's own procedure. The RACE exception (the owner-session qualifier)
    applies to it: once the owner session shows the `RACE: …` halt or no run, or has ended, the next step is
    `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`. A merge hold (the Review
    required flag) waits on you, not the run: "approve PR #N", and the lead merges on its next tick.
    Meanwhile, the live lead re-enters a set-aside task by itself only when `inputs` reads `autoRevise: true` (the
    seeded revise), `autoRetry: true` or a pending `autoRetryAfter` (its automatic retry, now or once the
    cool-down ends), when it descopes a `plan-blocked` task the notes settle, once, or when `answerRecorded` holds
    a `hand-back` answer and `humanFix` is null (its *Recorded answer*, execute § 4.5), and restarts it. Every other
    set-aside task is never re-entered by the live lead itself, except a recorded `hand-back` answer (`humanFix`
    null), which its *Recorded answer* hands back: it is a Needs you item, or a Drift line routes it. A `plan-blocked`
    one whose descope the verb refused (exit 3) is repair's too: the refusal is recorded, so its verdict reads
    `autoRetry: false` and its `humanFix` reads `decide scope or defer`. One plan-blocked again
    after an automatic descope (a `## Scope decision (automatic)`, no `descope_armed:`) is always Lachy's decision,
    never a silent hand-back. So, with a Needs you item, a set-aside task the Needs you block leaves to its Drift
    line, or a `plan-blocked` set-aside, add `/thread:repair [[<rollout>]]`: its live-queue mode asks you those
    and hands each back on your answer, records a gate sign-off and asks the descope the verb refused or the block
    after a descope, without touching the run.
11. Any drift flag but a Rung drift, a refused ladder, an unresolved ceiling or refused rollout settings, or a
    set-aside task that is a Needs you item (a non-null `humanFix`, an `awaiting repair` or `left` answer included)
    or a `plan-blocked` one (repair § 3 judges its descope first) → `/thread:repair [[<rollout>]]`.
12. Awaiting Integration, a handed-back running task (no `owner:`), an `autoRevise: true` set-aside, an
    `autoRetry: true` or cooling set-aside (the lead's automatic retry re-enters it; a `plan-blocked` one is
    action 11's), a recorded `hand-back` answer whose `humanFix` is null (`answerRecorded`: the lead's *Recorded
    answer* hands it back), a free slot, or a PR hold that waits on its merge (§ 3's Hold until: the lead waits and
    releases it itself), with no lead live → `/thread:execute [[<rollout>]]`. A CLOSED or unreadable hold is
    Lachy's edit to the note's `hold_until`, named ahead of this resume, never routed to `/thread:repair`. A room stop,
    standing or lapsed, whose owner session is alive is a live lead whatever its tasks read (§ 4's *Room stop*):
    action 10 matches it first, so this resume never runs under one; a standing one waits for the Stage's resume,
    a lapsed one for the owner's heartbeat.
13. Nothing started → `/thread:execute [[<rollout>]]` to start. Under § 1's **Start stamp** (the
    frontmatter's first top-level `start:` reads `unattended`) → "waiting for the Chorus Stage (Start when
    ready): it starts the lead in the Project root once the note is runnable", and name
    `/thread:execute [[<rollout>]]` only as the way to start it by hand now. Outside a Chorus Stage nothing
    acts on the stamp, so the note waits as Not yet does. A rollout `holdUntil` that holds does not stop the
    start: the lead it starts waits on the merge (`HELD until <pr> merges`) and releases itself. An approved
    queue (§ 3's Hold until, a non-null `onMerge`) is started the same way, and its lead regenerates it at the
    merge. Under § 3's **Approved queue, unstamped:** flag → `/thread:execute [[<rollout>]]`: the chain that
    wrote it died or stopped before its start stamp.

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
The RACE exception routes it to repair, never to a resume, once it turns undecided. A room stop needs no
override either: while its owner session is alive it is a live queue (10) whatever its tasks read, so it waits
ahead of drift and every resume (11 to 13), a drain under it waits too (9), and only an open escalation (7) and
a stamped pause's reinstate (8) come before it. A refused ladder adds its
fix ahead of whichever action matches and moves none of them, and so do an unresolved ceiling and refused
rollout settings. Offline, every resume or reinstate
recommendation carries § 3's caveat.

### 5. A serial chain

A `shape: serial` note (§ 1's **Shape**) is a chain of **Legs** (CONTEXT.md, ADR 0040), not a queue: §§ 2–4 do not
apply, and nothing here is cross-checked live (a chain has no PRs, no worktrees and no lead). Its one read, a pure
read with no lock, no network and no git:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/leg.py status --rollout <rollout-note>
```

leg.py's header defines every key it prints: the chain states, the stall, the restart and its blocker, and the
dependants. Exit 1 means the note is gone or not serial: report its `error`. Render the report from that JSON alone:

- **Headline.** `[[<rollout>]] — serial chain <chain>: <progress.done>/<progress.total> done`, plus `Leg <openLeg>
  open`, `HALTED at Leg <halt.leg>: <halt.reason>`, `INCOMPLETE: <note.incomplete>`, `superseded by
  [[<note.supersededBy>]]` or `archived` (`note.archived`) when they apply.
- **Legs.** One line per `legs` entry: `Leg <n> <alias> from <folder>`, `<began>` to its `closedStamp` (or `open`),
  its `outcome`, its done and set-aside tasks, `took over from Leg <tookOver>` and its `handover` when set. A lost
  Leg shows its `lastAt`, its own last line.
- **Queue.** The `rows`, one line each, grouped: **Done** (`state` done, with its `leg`); **Claimed** (`state`
  running, with its `owner`; none means a hand-back's re-entry, which the next Leg claims); **Queued** (`state`
  queued, with `held` when set, else "next"); **Set aside** (`state` set-aside, with `setAside.status`,
  `setAside.summary`, where it re-enters (a gate: Lachy's sign-off; a block: a hand-back or a defer, both
  `/thread:repair`'s § 7 (b)) and its `dependants`, "[[b]], [[c]] wait on it"). A footer sentence lists the rows
  outside the count: each `deferred` row (deferred out of the chain, live or archived) and each `missing` one (its
  note not found, held), e.g. `Outside the count: [[x]] deferred, [[y]] missing.`
- **Smoke list.** The `smoke` entries: the next Leg re-runs each one's Verify, and `why` says why. With none, no
  block.
- **Needs you.** `needsYou`, verbatim, one per line under `Needs you (<n>)`; with none, no block.
- **Stall.** When `stall` is set: each claimed task with its owner and its Leg's outcome, then `stall.why`.
- **Restart.** When `restart` is set: `Leg <restart.leg>` in `restart.launch` (or "any launch, from
  `restart.cwd`" when `restart.anyLaunch`), its `task`, "take-over" when `restart.takeOver`, and "blocked by
  `<restart.blockedBy>`" when set. Its `prompt` is printed, fenced, only where an action below hands it to Lachy.

A terminal chain (`complete`, `dropped`, `superseded` or `incomplete`: `begin` refuses each) has no Leg to act next,
so leg.py prints it no `restart`, no `next` and an empty `smoke`: its report has no Restart and no Smoke list.

**Recommended action** for a serial chain: exactly one, the first whose `chain` matches.

- S1 `complete` → "chain complete" (or "already archived"): nothing to run.
- S2 `dropped` or `superseded` → nothing runs it; a superseded one → `/thread:status [[<note.supersededBy>]]`.
- S3 `incomplete` → stamp it `status: dropped`, then `/thread:schedule --tasks <its tasks>` (§ 1's **Incomplete**).
- S4 `paused` → "a serial note is never paused: delete its `paused:` (and `pause_requested:`) line, then
  `/thread:execute [[<rollout>]]`". Report only.
- S5 `halted` → `/thread:repair [[<rollout>]]`: the halt's evidence, and its clearing on Lachy's word.
- S6 `restarting` → by `restarted.how`: `pending` → wait, a repair is starting Leg `<restarted.leg>`; `started` →
  wait for that Session (`restarted.started`); `manual` → paste `restart.prompt` in `restart.launch`, or any launch
  from `restart.cwd` when `restart.anyLaunch`. From another session, check the Chorus Stage first, and only if that
  session is gone run `/thread:repair [[<rollout>]]`.
- S7 `live` → "Leg `<openLeg>` is live: check that session first; if it is gone, `/thread:repair [[<rollout>]]` takes
  it over".
- S8 `awaiting-successor` → by the last Leg's `handover`: `started <id>` → wait for that Session, or check it;
  `manual …` → paste `restart.prompt` in `restart.launch` (or any launch from `restart.cwd` when
  `restart.anyLaunch`), or `/thread:repair [[<rollout>]]`, which asks whether it was pasted; no hand-over line →
  `/thread:repair [[<rollout>]]`.
- S9 `completable` → "`/thread:execute [[<rollout>]]` from `restart.cwd` (the last Leg's folder), or any folder but
  this plugin's own checkout (begin refuses it, ADR 0040): a Complete Leg works no row".
- S10 `stopped` → `/thread:execute [[<rollout>]]` as `restart.launch` when you want it to go on (with no `restart`,
  only set-aside rows are left: S12's repair). A `stall` here is the stopped Leg's claim: that Leg's `begin`
  inherits it, so its needs-you item's `/thread:repair` would start the same Leg.
- S11 `stalled` → `/thread:repair [[<rollout>]]`.
- S12 `stuck` → `/thread:repair [[<rollout>]]`: sign each gate, hand back a block, or defer it with its dependants.
- S13 `not-started` or `ready` → `/thread:execute [[<rollout>]]` as `restart.launch`.

The order is the precedence, as § 4's is: a lineage or an incomplete note stops everything, a halt comes before any
restart, and a Session that may still be live (a pending or started restart, an open Leg, a started hand-over) is
checked before anything starts another, so two Legs never run one chain.

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
- **Never call a writer.** Not `reconcile-rollout.py next` (it stamps `paused:` on a drained pause, clears a merged
  `hold_until` and clears a
  `start: unattended` stamp), `resume`,
  `hand-back` or any other, and never `step-boundary.py begin` or `step-boundary.py end`;
  `reconcile-rollout.py status`, `step-boundary.py stands` (§ 2's *Room stop*), `leg.py status` (§ 5, a serial
  note's one read), `lead-integrate.py inputs` and `rollout-settings.py`
  (§ 2, a read) are the only Python scripts status runs, and `default-branch.sh` the only shell one (besides
  the `land.sh --origin-slug` that `rollout-settings.py` runs itself). Never `lead-integrate.py prepare`,
  `set-aside`, `push` or `undo`, `merge-task.sh`, a `gh pr close`, `merge` or `reopen`, a `git push`, `fetch`
  or `update-ref`: of `gh` and `git`, only § 3's reads.
- **Respect the § 3 budget.** One `worktree list`, one local `remote get-url` (plus the local one
  `rollout-settings.py` makes per resolve when rollouts.toml holds a repo table, § 2), one `gh pr view` per PR'd task
  that has not landed, one `gh pr view` per readable PR hold `next` would read, at most one guarded default-branch
  read and at most one guarded `gh pr list`. Status is
  a glance; keep it cheap.
- **Don't parse the `## Queue` table** for the task list: use the `status` subcommand's glob-by-backlink (it
  catches tasks the table omits). A serial chain's Queue is read by `leg.py status` alone (§ 5).
- **Don't run a serial chain's other `leg.py` verbs.** Not `begin`, `restarted` or `clear-halt` (`/thread:repair`'s
  § 7 runs the last two, on Lachy's word where it asks), and never a `## Leg log` edit: § 5 only reads, and
  recommends.
- **Don't recommend a resume against a live queue** unless its owner session, checked there, shows no run or
  has ended, and never under a room stop, standing or lapsed, while its owner session is alive, whatever
  `/workflows` shows and whatever its tasks read (§ 4's *Room stop*), a stamped pause's reinstate excepted
  (action 8). Offline, qualify any resume with § 3's caveat.
- **Don't send an undecided RACE / UNVERIFIED to `/thread:execute`.** No reinstate and no resume until its
  `RACE decided:` line is recorded: § 4's action 7 comes first, and repair records the decision in any mode.
  Don't escalate a RACE re-verify in flight either: it is the lead's own procedure until its owner session
  shows the `RACE: …` halt or no run, or has ended (§ 3).
