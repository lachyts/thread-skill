# The vault grammar — phase and task names, statuses, in flight

The one definition of how a vault note's filename places it in a phase and how its `status:` reads,
a rollout's start stamp, a hold the engine can read, an approved queue, and a durable trigger.
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

- **Writers**: the execute handoff's Start when ready, on the rollout note just written and never started, whose
  launch was never made or was withdrawn first (handoff § Lifecycle's `dismiss_task` rules; a lead already running
  gets no stamp), a parallel note's (the Stage starts a lead in a note's Project root): orient § 9's
  Start when ready move, on his word, and schedule step
  8's **Start when ready.** on a standalone run. `reconcile-rollout.py approve-queue`, on Lachy's words
  naming the queue and the PR its start waits on (§ Approved queue), and `reconcile-rollout.py
  stamp-start`, schedule step 8's under the chain, on the note an approved queue's regenerate wrote. And
  `reconcile-rollout.py stamp-start --backlog`, the Backlog orient's decided start (`skills/orient/backlog.md` § B8),
  on each parallel note its forks wrote, its post-question round's included, never a held one. And
  schedule § 0's **Put back**, which only restores to a prior the exact line its Supersede prep removed,
  when the run stops before step 6 writes its note. On a serial note (P44-4, ADR 0076 d4: the stamp is its chain's
  place on the Waiting list), the writers run only on the Chorus Stage (Chorus's `list_sessions` answers):
  `reconcile-rollout.py stamp-start` on a never-begun chain, from schedule § Serial path S7 (a standalone run),
  orient § 9, orient-all § 7's Leg item and the Backlog orient B8 (`stamp-start --backlog`); and, on a running chain,
  a Leg's `leg.py handed --listed` and repair's `leg.py restarted --listed`.
  Off the Stage nothing stamps a serial note: its Leg 1 is a paste-ready prompt.
- **Readers**: the Chorus Stage (`src/stage/unattended.py` in the Chorus repo, Chorus ADR 0052 d6 as
  amended). It starts one lead (`/thread:execute [[<rollout>]]`) in the note's Project root, the
  rollout clone for every rollout scheduled after P26 (ADR 0042), so its launch passes execute § 2.8,
  once the note is runnable, and replaces the stamp in place with its own record,
  `started_unattended: <stamp>`, which thread-skill never writes or clears. And `/thread:status`
  (§ 1's **Start stamp**), which reports a stamped note nothing has started as waiting for the Stage
  (its § 4 action 13). And `/thread:orient-all`'s `estate-dispatch.py plan`, through
  reconcile-rollout's `_start_unattended`, loaded: a stamped note it neither starts nor relays (the
  Stage starts it). And, on a serial note, `unfinished-rollout.py waiting` (leg.py's `waiting_listed`, the Waiting
  list's one rule), which lists the chain, and the Stage's start of that list's `next` (Chorus ADR 0115).
- **Clearers**: `reconcile-rollout.py next`, on every call off `--dry-run` that exits 0 (the lead's,
  execute § 4.5 step 1), which removes every top-level `start:` line reading `unattended` and reports
  `startCleared`, so a running rollout clears it; a refused `next` (exit 1) writes nothing, so the stamp
  waits. And schedule's **Supersede prep**, which removes it from a prior it is about to supersede
  (and step 1's report names the clear). None on a serial note: its stamp stands until the chain is done or dropped,
  with `started_unattended:` beside it once the Stage has started a Leg (Chorus ADR 0115 R1).

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
- **Never carried.** Of an approved queue's keys, `carry` copies only the `hold_until` block: the new note keeps a plain hold, released at its
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

## When

A "when X, then Y" step that only a session holds dies with the session (the follow-ups lost with a session's watchers,
2026-11-08/09; ADR 0078 d5). So it is frontmatter on the note, never a sentence: the key is `when`, read on the first
top-level `when:` line of a rollout or task note, one `{on, do}` entry or a list of them, written `when: {on: "merged
lachyts/thread-skill#361", do: regenerate}`. It extends the form of § Hold until and § Approved queue and replaces
neither: a hold blocks starts, and an approved queue's verdict has outcomes a trigger does not.

- **Six forms read**, each giving the same id: the flow mapping above; the block mapping Obsidian re-serialises it to
  (`when:` then indented `on:` and `do:` lines); a flow list item `  - {on: "…", do: "…"}`; a block list item
  `  - on: …` over `    do: …`; and either list item at column 0. A flow value holding a comma or a wikilink must be
  quoted, or it is not valid YAML. An optional trailing ` # comment` stays. A whole `when: […]` flow list is unreadable.
- **`on`** is one of `merged <owner/repo#N | PR URL>` (read as § Hold until reads a PR: MERGED is due; OPEN, CLOSED or a
  gh error or timeout waits; a bare number is unreadable, since a trigger fires with no lead and a bare number needs a
  repo to be read in), `paused` (a valued `paused:` on the note, or on the rollout a task note's `rollout:` links, and
  only while that note is not closed or superseded; `pause_requested` and a room stop do not count, a sign-off pause
  does) and `landed [[task]]` (as a dependency lands, `_dep_status`, so a merged tombstone and Archive resolve).
- **`do`** is one of `regenerate`, `regenerate --tasks a,b` (slugs or wikilinks), `schedule [[task]]`, `reset-primary`.
  A `do` target that is not found keeps the trigger waiting, and so does a list whose every target is closed (done,
  dropped or a merged tombstone); a partly landed `--tasks` list still fires, since schedule's skip rule drops the
  landed ones.
- **`id`** is the first 12 hex of sha256 over the note's stem (lower-cased) and the normalised `on` and `do`: stable when
  sibling entries move and unchanged by `fired`. An edit to the `on` or `do` of an unfired entry makes a new id.
- **Writers**: any agent, or Lachy, instead of a background watcher: a follow-up that must outlive the session goes here,
  on the note it belongs to. The rollout template's commented `# when:` line shows the form.
- **Readers**: `reconcile-rollout.py triggers due`, read-only and needing no lead, which prints `{due, waiting,
  unreadable, fired}`; `reconcile-rollout.py triggers fire <id>`, which runs one and records it. The Chorus Stage fires
  due ones (the Chorus task `chorus-stage-shows-machinery-health-and-fires-triggers`); until it does, no automation calls
  them. The scan reads every note under the tasks dir, Archive included, the root copy preferred; a `status: dropped`
  note is inert, and a done or archived note still fires `schedule` and `reset-primary`.
- **The record.** `fire` writes `fired: "<stamp>"` on the entry where it stands, in the entry's own form, and rewrites
  nothing else: before a flow entry's closing `}`, or as one new line after a block entry's last line, at its first key's
  column. The dash column and the `when:` line never change, and a single mapping stays one. An entry already fired is a
  no-op; an edit to a fired entry stays fired, and deleting `fired:` re-arms it. `fired:` on a hand-written entry reads as
  fired; an empty one is unreadable. Only `fresh: true` tells a caller to act on the row's `command`.
- **A model step is recorded once and its command handed back.** `reconcile-rollout.py` starts no session: `fire` records
  `regenerate` or `schedule` and prints `/thread:schedule [[<project>]] --regenerate`, `/thread:schedule --regenerate
  --tasks a,b` or `/thread:schedule --tasks <slug>`. The command carries no `Under the chain:` line (§ Approved queue
  alone defines it, and it says Lachy approved the queue and its start), so **a fired regenerate or schedule is an
  attended run that can wait on Lachy**: the Session the Stage starts can stop at schedule's questions. A caller that dies between
  `fire` and starting the Session loses the step: `fired:` is the audit, and deleting it re-arms.
- **Regenerate's gate**, both `regenerate` forms, because `/thread:schedule --regenerate` acts on whatever is unfinished
  for the project now. Its anchor is the note when tagged `rollout`, else the rollout its `rollout:` links; a task note's
  own status does not count. In order: a `shape: serial` anchor is unreadable (a serial rollout supersedes nothing); no
  anchor waits; a valued `superseded_by:` waits; on a task note, an anchor with a valued `supersedes:` waits, because
  `carry` moves a task's `rollout:` and leaves its `when:`, and an entry written against the prior cannot be told from
  one written since; a done or dropped anchor waits; one neither paused nor never started (`approved_unrun`) waits, since
  schedule refuses a regenerate on a running rollout. So a successor is never touched by the prior's merge, whether the
  entry sits on the prior or on a carried task, and one written on a successor's own rollout note fires as any other. A
  `regenerate` written against a rollout that runs to its end lapses at its close, listed under `waiting`. `fire` runs
  the same reading.
- **Where a command runs.** A command row has a `projectRoot`, read on the trigger's own note for `regenerate` and on the
  target task for `schedule [[U]]` (the note schedule § 0 resolves). The first present decides: the note's own `Project
  root:` line, the `Project root:` of the rollout its `rollout:` links, then the first project, in `projects:` order,
  whose note under `Work/Projects/**` (outside Archive first) carries a `` Local: `<path>` `` line. None present, or the one
  that decides is not a directory, keeps the row waiting and `fire` exits 1 with nothing written, so `fired:` is never
  spent on a command the Stage cannot place. No fall-through past a dead path, which could place a Session in the wrong
  repo. A `script` row needs none.
- **`reset-primary`** runs one `skills/_shared/scripts/primary-refresh.py run` pass in place (ADR 0078 Decided 3: a second
  reset path would bypass its rule). `run` exits 0 whatever it finds, so `fire` reads the pass's outcome line, and records
  only an outcome that read the checkout to a standing verdict (`current`, `ahead`, `moved`, `repaired:`, `diverged`,
  `held:`, `refused:`; RESET_PRIMARY_RECORDED). `repaired: reset <head12> to origin/<b> at <tip12> (…)` is the refresh's
  repair of a diverged Primary whose commits are already on origin, and ends the stuck spell as `current` does. On the
  Primary every other `diverged (ahead a, behind b): …` line is that repair's too (`repair waits (…)`, `repair held: …`,
  `repair refused: …`, `carried: …`, `not carried (…)`), recorded under the `diverged` prefix: the job keeps passing, and
  a repair blocked for a day shows on /thread:status. `never integrated here` is an `--also` checkout's line, never the
  Primary's. Every other outcome (`not a primary checkout:`, `fetch failed:`, `broken:`, `unreadable:`, `timed out:`,
  `busy:`, a dry pass's `would …`; RESET_PRIMARY_RETRIED), no line, an outcome in neither list and a non-zero exit are not
  recorded: `fire` exits 1, due again next tick, and its ERROR names an outcome in neither list as one it does not know.
  tests/contracts/vault-grammar.test.mjs classifies every outcome a pass can return into one list or the other, so a new
  or renamed outcome fails there. It blocks on the pass, up to about 15 minutes, so its caller runs it off the 5-minute
  tick.
- **Fails closed.** An unknown key, a missing `on` or `do`, a verb outside the lists above, a bad `regenerate` argument, a
  duplicate of an entry above, an empty `fired:`, a bare `regenerate` whose rollout names no project, or a `regenerate`
  on a serial rollout lists under `unreadable`, is never due and never hides a good sibling; a block whose items sit at
  two dash columns, already invalid YAML, is one unreadable row. A trigger that cannot be read today shows only in
  `triggers due`.
- **Never carried.** `carry` copies no `when:`, so a superseded note's unfired `paused` or `regenerate` lapses, listed under
  `waiting` for good; to keep one, write it again on the successor. A carried task keeps its own `when:` and links the
  successor: its `regenerate` lapses the same way (Regenerate's gate), and its other entries go on, a `paused` read on the
  successor; to keep the `regenerate`, write it on the successor's rollout note.

## Waits on

A rollout note's `## Waits on` section, at the note's end, holds one line per dependency that no rollout will land for
a dependant on that note (ADR 0078 d7):

`- [[<dependant>]] waits on [[<x>]] (<Project>, not scheduled)`

`<x>` is another project's task (it shares no `projects:` entry with the dependant) that has not landed and whose
`rollout:` links no live rollout. `<Project>` is its first project, or `no project`. `waits-on.py write` is the
section's one writer: schedule step 7, § Serial path S6 and orient-all § 2 run it, and it rewrites the section on every
live rollout note as it stands, one line per unit a dependant waits on, removing it when nothing waits. `estate-scan.py` reads the lines back for each live rollout (`rollouts[].waitsOn[]`, each kept
only while its dependant is still open and its dependency is still an open task on no live rollout) and orient-all
lists them (§ 3, § 8).

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
  above), read as `_scalar` reads a frontmatter value, and reported as `startUnattended`. Its `stamp-start`,
  `skills/execute/scripts/leg.py` (`handed --listed`, `restarted --listed`, `waiting_listed`) and
  `skills/_shared/scripts/unfinished-rollout.py` (`waiting`, `unstarted`) read and write it on a serial note too,
  through `_start_unattended` and those two constants, loaded (P44-4).
- `skills/execute/scripts/reconcile-rollout.py` `next`, `status` and `carry`: `HOLD_KEY` (§ Hold until's
  key) and `HOLD_UNTIL_PREFIX` (every hold reason's opening), parsed by `_hold_until`, the one reader of both
  forms.
- `skills/execute/scripts/reconcile-rollout.py` `next`, `status`, `approve-queue`, `stamp-start` and `carry`:
  `ON_MERGE_KEY` and `ON_MERGE_REGENERATE` (§ Approved queue's key and value), read by `_on_merge`; and
  `approved_unrun`, loaded by `skills/_shared/scripts/unfinished-rollout.py`.
- `skills/execute/scripts/reconcile-rollout.py` `triggers due` and `triggers fire`: `WHEN_KEY` (§ When's key), read by
  `_when`, the one reader of its forms and of `on` and `do`; a target's status through `FINISHED_STATUSES`; and
  `LOCAL_RE`, a literal copy of `skills/_shared/scripts/serial-chains.py`'s, pinned by this file's contract test.
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
- `skills/_shared/scripts/waits-on.py` (§ Waits on's one writer) and `skills/_shared/scripts/estate-scan.py`'s
  `WAITS_ON` (its one reader), which carries each line still true to `rollouts[].waitsOn[]` for orient-all.
- `tests/contracts/vault-grammar.test.mjs` pins every literal copy above to this file, and checks both
  scripts' key and sort helpers against the examples under § Phase and task filenames.
