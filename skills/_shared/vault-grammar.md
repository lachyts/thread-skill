# The vault grammar — phase and task names, statuses, in flight

The one definition of how a vault note's filename places it in a phase and how its `status:` reads,
a rollout's start stamp, a hold the engine can read, and an approved queue.
`reconcile-project.py`'s drift detector, execute's phase-close ceremony, orient § 2's sweep and the
reshuffle's R1 all read the vault through it, so they classify the same note the same way (§ Readers
lists every reader). A reader that needs a pattern or a set cites the section here instead of
restating it; the scripts that cannot cite a doc keep a literal copy that
`tests/contracts/vault-grammar.test.mjs` pins to this file.

## Phase and task filenames

- **Phase number** `<N>`: whole or fractional with a literal dot, `PHASE_N` = `\d+(?:\.\d+)?`
  (`3`, `19`, `3.5`). A fractional phase is written with a dot, never a hyphen: `p3-5-` is task 5 of
  phase 3 (`add-phase.md`, the vault's phase writer).
- **Phase note**: `Work/Phases/<slug>-p<N>-<desc>.md`. **Task note**: `Work/Tasks/<slug>-p<N>-<M>-<desc>.md`,
  `<M>` its ordinal (digits). A task's **short id** is `p<N>-<M>` (`p8-1`, `p3.5-2`).
- **Membership** is by the literal prefix `<slug>-p<N>-`: `-p1-` never reaches `-p10-`, `-p3-` never
  reaches `-p3.5-`, and a sibling project `<slug>-plugin` never matches. A name whose number does not
  fit `PHASE_N` (`p3.`, `p.5`, `p3.5.1`) is no phase member.
- **Comparing and ordering**: the whole part is compared numerically (`p03` is `p3`), the fractional
  part literally (`p3.5` and `p3.50` are distinct). Phases sort numerically: `1, 2, 3, 3.5, 5, 10`.

## Statuses

A `status:` is read lower-cased, with `-` read as `_`: TaskNotes' own spelling `in-progress` is
`in_progress`. Anything outside the sets below (`in progress` with a space, say) is a hold.

- **Landed**: `done`, `merged`, `dropped`.
- **Active**: `open`, `in_progress`.
- **Review**: `review`.
- **Hold**: any other status (`parked`, `blocked`, …): a deliberate hold, not drift.

## In flight

A task stamped `rollout:` whose rollout note is still live (CONTEXT.md **Live rollout**: the link
resolves to a note directly in `Work/Tasks/`), or `status: in-progress` (TaskNotes' own spelling),
`in_progress` or `review`; a phase with any such member.

The one exception, at schedule's Pre-flight on a supersede (schedule § 1.5, ADR 0047): a carried task still
queued, at `open` with its `rollout:` naming the rollout being superseded, is read as not in flight, so it is graded
and its answers written; one that has started stays in flight. It is read through estate-scan's `still_to_start`.

## Rollout start stamp

A rollout note asks the Chorus Stage to start its lead with `start: unattended` (*Start when ready*,
CONTEXT.md **Start when ready**). The key is `start`, read on the first top-level `start:` line of
the frontmatter, its scalar lower-cased with quotes and an inline ` # comment` dropped:
`start: unattended`, `start: "Unattended"` and `start: unattended  # by the offer` are the stamp. Any
other value (`start: manual`, an empty `start:`), a `start:` nested under another key, and a body line are
no stamp; `started:` and `started_unattended:` are other keys.

- **Writers**: the execute offer, on the rollout note just written and never started, on a parallel
  note only (the Stage starts a lead in a note's Project root; a serial note has none): orient § 9's
  Start when ready answer, and schedule step
  8's **Start when ready.** on a standalone run. `reconcile-rollout.py approve-queue`, on Lachy's words
  naming the queue and the PR its start waits on (§ Approved queue), and `reconcile-rollout.py
  stamp-start`, schedule step 8's under the chain, on the note an approved queue's regenerate wrote. And
  schedule § 0's **Put back**, which only restores to a prior the exact line its Supersede prep removed,
  when the run stops before step 6 writes its note.
- **Readers**: the Chorus Stage (`src/stage/unattended.py` in the Chorus repo, Chorus ADR 0052 d6 as
  amended). It starts one lead (`/thread:execute [[<rollout>]]`) in the note's Project root, the
  rollout clone for every rollout scheduled after P26 (ADR 0042), so its launch passes execute § 2.8,
  once the note is runnable, and replaces the stamp in place with its own record,
  `started_unattended: <stamp>`, which thread-skill never writes or clears. And `/thread:status`
  (§ 1's **Start stamp**), which reports a stamped note nothing has started as waiting for the Stage
  (its § 4 action 13). And `/thread:orient-all`'s `estate-dispatch.py plan`, through
  reconcile-rollout's `_start_unattended`, loaded: a stamped note it neither starts nor relays (the
  Stage starts it).
- **Clearers**: `reconcile-rollout.py next`, on every call off `--dry-run` that exits 0 (the lead's,
  execute § 4.5 step 1), which removes every top-level `start:` line reading `unattended` and reports
  `startCleared`, so a running rollout clears it; a refused `next` (exit 1) writes nothing, so the stamp
  waits. And schedule's **Supersede prep**, which removes it from a prior it is about to supersede
  (and step 1's report names the clear).

## Hold until

A hold the engine honours is frontmatter, never a sentence in the note: no script reads a sentence, so a lead
had to ask Lachy whether one still stood (the 2026-10-25 loop audit's Q50). The key is `hold_until`, read on
the first top-level `hold_until:` line of the frontmatter, written `hold_until: {pr: lachyts/thread-skill#202,
merged: true}`.

- **Two scopes.** On a parallel rollout note it holds the whole queue (rollout scope): no task starts or
  restarts until the PR merges, while live calls and Integration carry on. On a task note it holds that task's
  new calls only (task scope): its start, restart or re-entry; its dependants wait on it as on any open
  dependency.
- **Parallel-only.** `reconcile-rollout.py next` refuses a `shape: serial` note before it reads one, and a
  serial chain's Legs (execute `legs.md`) never read the key, so a serial note's `hold_until` is read by nothing
  and is never written there.
- **Two forms.** The flow form above, with an optional trailing ` # comment`, and the block form Obsidian
  re-serialises it to: `hold_until:` followed by indented `pr:` and `merged:` lines.
- **`pr`** is required: `owner/repo#N` (read through `https://github.com/owner/repo/pull/N`, since gh takes
  no `owner/repo#N`), a PR URL, or a bare `N` or a quoted `"#N"`, read in the rollout's `Project root:` as
  `resume` reads a bare `pr:`. An unquoted ` #N` is a YAML comment, so it reads as empty.
- **`merged`** is optional and defaults to `true`; any other value is unreadable.
- **Unreadable**: an unknown key, a repeated key, an empty value, `null`, a missing `pr`, a `pr` of no form
  above, or a bare number with no Project root directory. It fails closed: it holds, waits on Lachy, makes no
  gh call and never clears itself.
- **Writers**: any agent, or Lachy, holding a note on a PR, as this key on the note it holds; the rollout
  template's commented `# hold_until:` line shows the form. And `reconcile-rollout.py approve-queue`, which writes
  it with § Approved queue's `on_merge:`. A hold is never a sentence in the note.
- **Readers**: `reconcile-rollout.py next` (the lead's, execute § 4.5 step 1), which reads each hold's PR
  with `gh pr view <url|N> --json state,mergedAt,url`: MERGED releases it; OPEN, or a gh error or timeout,
  holds and waits on the merge, read again at the next call; CLOSED holds and waits on Lachy. It reports each
  as `holdUntil`, and `halt: "held"` once nothing else moves. `reconcile-rollout.py status` (the parsed hold,
  no gh call) and `/thread:status` (its § 2 and § 3, which read the PR's state live). And the Chorus Stage,
  whose own reader (`src/stage/unattended.py` in the Chorus repo) copies this section; until it does, a lead
  the Stage starts on a held rollout waits on the merge (execute § 4.5 step 1.5) rather than asking.
- **Clearer**: `next`, off `--dry-run`, on MERGED: it removes the `hold_until:` line and its indented lines
  only while they still read as it read them (a compare-and-swap under the note's lock, so a hold rewritten
  meanwhile stays, and `next` reports it not cleared); a save that fails leaves the hold for the next call,
  and the hold still releases for that call. The one exception is an approved queue (§ Approved queue): its
  verdict at the merge keeps the hold standing while it waits or regenerates, and clears it only when it
  releases as a plain hold, its `on_merge:` lines with it in the same compare-and-swap, so a hold added by hand
  later is a plain hold.
- **Supersede**: a rollout-scope hold survives a supersede: `reconcile-rollout.py carry` (schedule step 6)
  copies the prior's lines verbatim into the note that supersedes it. A task-scope hold rides on its task
  note, which the carry never edits there.

## Approved queue

A queue Lachy has already approved, start and all, never waits on a confirm at its gating PR's merge (the loop
audit's Q54 sat 19 hours and was dropped). The key is `on_merge: regenerate`, read on the first top-level
`on_merge:` line of a parallel rollout note nothing has run that also carries a rollout-scope `hold_until`
(§ Hold until), its scalar lower-cased with quotes and an inline ` # comment` dropped, as § Rollout start stamp
reads `start:`: `regenerate` is the only value, in any case (`Regenerate`, `"REGENERATE"`). `on_merge` on a task
note, on a serial note or on a note with no rollout `hold_until` is read by nothing.

- **Writer**: `reconcile-rollout.py approve-queue --rollout <note> --pr <owner/repo#N | PR URL>`, run on Lachy's
  words naming the queue and its gating PR (execute § Invocation forms' `start [[<rollout>]] when <owner/repo>#<N>
  merges`, orient § 9's and schedule step 8's Start when ready). In one locked save it writes the hold, `on_merge:
  regenerate` right after it and `start: unattended` below `status:` (unless the Stage's `started_unattended:`
  stands), and prints one undo line. The line names `hold_until` only when this run wrote it, so following it never
  drops a hold he wrote; a bare-number hold (`{pr: 202}`, read in the Project root) is refused with "rewrite it as
  owner/repo#N first". It refuses a note that has run, his pause included, and writes nothing then.
  Lachy's own hand edit is the other writer; the template's commented `# on_merge:` line shows the form.
- **Reader**: `reconcile-rollout.py next`, the verdict, once the hold reads MERGED: it keeps the hold standing and
  reports `halt: "regenerate"` with the members (`onMerge`), and execute § 4.5's **Approved queue** route runs
  `/thread:schedule --regenerate --tasks <members>` under the chain, whose step 8 runs `stamp-start` on the new note.
  The members are this note's unlanded linked tasks, a successor's when an interrupted chain's carry already moved
  them, and the open siblings filed since in the same phases (schedule step 1's skip rule kept); the project filter
  keeps only those carrying this note's first project. With no linked member left it releases as a plain hold.
- **Clearer**: `next`, on a plain release (the verdict's `released`: it has run, or nothing of its own is left; or
  a done or dropped note): it removes the `on_merge:` line with the hold (§ Hold until's Clearer), in the hold's one
  compare-and-swap, so a hold Lachy adds by hand later for another PR is a plain hold and never brings back an
  approval he gave for this one. A hold rewritten meanwhile keeps its `on_merge:` too. A verdict that keeps the
  hold standing (waits, regenerate, an unreadable value) clears neither.
- **What counts as having run** (`_approved_marks`, the approved queue's own read): a room stop is no run mark. The
  Chorus Stage's room-stop lines (execute § Room stop; step-boundary.py's, one regex) are never Lachy's run, so a
  queue whose only marks are room stops, each one ended, reads as unrun to the verdict, to `approve-queue`, to
  `carry` and to unfinished-rollout.py, all through `approved_unrun`. A room stop that stands makes the verdict
  wait (`waits: room-stop`), and the next loop entry's `end` closes it. His own `paused:` or `pause_requested`, a
  `## Pause log` line that is no room stop, `completed:`, a `## Completion log` or `## Leg log`, and a task's
  `owner:` still read as run: the verdict then releases it as a plain hold, with one `WARN: on_merge:` line the
  lead relays as a needs-you item. A task's `integrating:` is an Integration in flight, and the verdict waits for
  it (`waits: integration`); one with no Integration in flight reads as run.
- **Never carried.** `carry` copies only the `hold_until` block: the new note keeps a plain hold, released at its
  first `next`. A plain `--regenerate` of an approved queue drops the approval.
- **Fails closed, only at the merge.** While the PR is open an unreadable `on_merge` waits as any hold does, and
  only `/thread:status` flags it; at the merge it holds and waits on Lachy (`waits: you`).
- **`status`** reports `onMerge` ({value, error}) and `chainStart` ({prior, pr} on a chain's new note whose start
  was never stamped).
- **The chain and its windows.** A crash or a stop before step 7.5 closes the prior out leaves the hold standing,
  so a re-entry runs the chain again: before step 6 writes, from the start; after the carry (the I8 window) the
  prior links nothing, but its `next` still reads `regenerate` with the successor's tasks, and execute § 2's lineage
  lets the run go on to schedule's `interrupted` finish. Once step 7.5 has closed the prior out, a re-entry on it
  ends `superseded` and never regenerates: a crash, or a stop (`stamp-start` exiting 1), before the new note is
  stamped leaves it unstamped, which `/thread:status` flags (`chainStart`, its **Approved queue, unstamped:**
  flag), and that stop halts with an (e) item whose act is `/thread:execute [[<new>]]` (execute § 4.5's
  **Approved queue** route). Two crashes in a row lose only the start intent: the new note runs
  when he starts it. A late heartbeat tick on the closed prior ends at its clause (1), and `next` on a superseded
  note halts `superseded`.

## Readers

- `skills/_shared/scripts/reconcile-project.py`: `PHASE_N`, `LANDED`, `ACTIVE`, `phase_key` and
  `phase_sort` (the canonical form and the order) and `Rec.status` (the normalised read); its docstring
  cites this file.
- `skills/execute/scripts/reconcile-rollout.py` `touched-phases`: `PHASED_STEM_RE`, `_phase_key` and
  `_phase_sort`, which feed `--phases` to reconcile-project in execute's phase-close ceremony.
- `skills/_shared/scripts/next-action.py`: `DEAD_STATUSES` (Landed) and `OPEN_STATUSES` (Active).
- orient § 2 (the sweep's in-flight report) and the reshuffle's R1 (the item set and its reach tiers).
- `skills/reflect/scripts/reflect.py` `bug`, `decide`, `close` and `moot`: reconcile-project.py's `LANDED` and its
  status read (`Rec.status`), loaded, so an open task and a done one are told apart as everywhere else; decide and
  close count only done and merged as deciding a held trade (`DECIDED`, LANDED less dropped).
- `skills/reflect/scripts/grades.py` (the Grade log's reader): Landed through reconcile-project.py's `LANDED` and
  `Rec.status`, loaded, not copied: `done` and `merged` land a graded task and `dropped` drops it; any other status
  leaves its latest grade open.
- `skills/close/scripts/repo-track.sh`: `active` (Active), read as reconcile-project's `Rec.status` reads
  it (a matched `'…'` or `"…"` pair stripped, as `_unq` does, then lower-cased with `-` as `_`). Close
  step 2's tracked-task search prose and its edge-case bullet (`skills/close/SKILL.md`) read Active the
  same way: `review` and `blocked` are never tracked.
- close's candidate statuses (`skills/close/SKILL.md` § A finished task closes itself, **Candidates.**):
  Active and Review, read per § Statuses.
- `skills/execute/scripts/reconcile-rollout.py` carry's `SHORT_ID_RE` and `_order_hints`' short-id match:
  `p<PHASE_N>-<M>`, the phase matched literally.
- `skills/execute/scripts/reconcile-rollout.py` `next`: `START_KEY` and `START_UNATTENDED` (the stamp
  above), read as `_scalar` reads a frontmatter value, and reported as `startUnattended`.
- `skills/execute/scripts/reconcile-rollout.py` `next`, `status` and `carry`: `HOLD_KEY` (§ Hold until's
  key) and `HOLD_UNTIL_PREFIX` (every hold reason's opening), parsed by `_hold_until`, the one reader of both
  forms.
- `skills/execute/scripts/reconcile-rollout.py` `next`, `status`, `approve-queue`, `stamp-start` and `carry`:
  `ON_MERGE_KEY` and `ON_MERGE_REGENERATE` (§ Approved queue's key and value), read by `_on_merge`; and
  `approved_unrun`, loaded by `skills/_shared/scripts/unfinished-rollout.py`.
- `skills/status/SKILL.md` § 1's **Start stamp** and § 4 action 13: the stamp above, read straight from the
  frontmatter.
- `skills/_shared/scripts/estate-scan.py` (the estate scan): Landed and Active through `DEAD_STATUSES`,
  `OPEN_STATUSES` and `status_of`, loaded from the next-action script rather than copied; Review through its pinned
  literal `REVIEW_STATUSES`; § In flight, for each open task's `inFlight`, through its module-level `first_link`,
  `link_live` and `in_flight`, the rule's one statement in code, and its exception's, `still_to_start`; and § Phase and task filenames'
  membership for each phase's `openTasks`: the open tasks named with the phase note's literal prefix
  `<slug>-p<N>-`, never by a task's `phase:` key, with reconcile-project.py's `PHASE_N` loaded rather than copied.
- `skills/_shared/scripts/estate-dispatch.py` `record` (the estate pass's and schedule's Pre-flight's decision
  write): Active through next-action's `OPEN_STATUSES` and `status_of`, and § In flight through estate-scan's
  `in_flight` and `link_live`, all loaded rather than copied. It writes only into an Active task that is not in
  flight, the exception (`record --superseding`) read through estate-scan's `still_to_start`. Its `plan` reads
  whether a dependency outside the scan has landed through reconcile-rollout's `_dep_status` and `_fold_unit`,
  loaded, so it holds a member exactly as long as a rollout row would wait on that dependency.
- `skills/_shared/scripts/estate-rank.py` `rank --superseding` and estate-dispatch.py's `slices --superseding`
  (schedule's Pre-flight): § In flight's exception, read through estate-scan's `still_to_start`, loaded, so a
  carried task still queued is gradeable and one that has started stays in flight.
- `tests/contracts/vault-grammar.test.mjs` pins every literal copy above to this file, and checks both
  scripts' key and sort helpers against the examples under § Phase and task filenames.
