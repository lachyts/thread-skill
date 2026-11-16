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
  Review includes a carried fix (a review note with a valued merged stamp, § Proven), which a queue reads as Landed.
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

## Proven

ADR 0078 d1: a fix is done only once Proven. CONTEXT.md's **Live**, **Proven** and **Carried fix** are the terms.

**`clears:`** names what a fix task is filed to clear. Its items are read by reconcile-rollout.py's `_clears`
through the note's frontmatter block: a block list (`clears:` then `- <item>` lines, the form every vault note
uses), a flow list `[...]` split at its commas outside quotes (`_flow_items`), or a scalar on the `clears:` line,
one item. A block or scalar item is never split at commas. A double-quoted item is read up to its closing unescaped
`"`, its `\"` and `\\` decoded; a single-quoted one with `''` decoded. An item that is exactly one `[[link]]` is a
link item (a rollout, chain or task note); anything else is a line item. Empty items are dropped, so `clears: []` or a
bare `clears:` has none.

**The carried-fix test.** A carried fix is a task note at `status: review` with a valued `merged:` (`_valued`: not
empty, `null` or `~`): `_carried_fix`, the rule's one copy. The queue reads it as Landed (`_landed`, `_queue_state`
`merged`), so its dependants start; it is not done until `prove` stamps `proven:`.

**The stamps.** `merged:` the landing (the first stamp wins); `merge_commit:` the merge commit (gh's, or `--land
--commit`'s); `merge_repo:` the lowercased `<owner>/<name>` a `--land --commit --repo DIR` landing went to;
`live:` the moment it was Live (the first stamp stays: prove never un-lives a note); `proven:` the date it was
proven. `## Proof log` holds one dated `- <stamp> …` line per landing, carry-back, Live read, seen item and proof.

**Live.** A landing's repo is watched when an entry of the Primary refresh's live file
(`${XDG_STATE_HOME:-~/.local/state}/thread/primary-live.json`, `{v: 1, live: {<checkout>: {origin, head, branch,
since, primary}}}`) has its key. The two key readers: a `pr:` PR URL gives `PR_URL_RE`'s group 1, lowercased (a bare
`pr: #N` reads its rollout's Project root origin); an origin URL gives `ORIGIN_SLUG_RE`, lowercased, only ever an
origin, never a `pr:` value. A watched landing is Live once a live entry's head holds its merge commit (`git
merge-base --is-ancestor`), and `live:` is then stamped; an unwatched landing is Live at merge (`live:` = `merged:`).
A missing live file watches nothing; an unreadable one watches everything (fail closed), and so does a repo that
cannot be read while the file has any entry. A RACE revert (`reverted on main:`) is never Live.

**The items.** Each item moves only strictly after `live:`: a `[[rollout]]` or `[[chain]]` item, followed through
`superseded_by:` (at most 10 hops), when a note of any rollout on that chain has `started:`, `ready:`,
`integrating:` or `merged:` after it, or a serial `## Leg log` has a `began:`, `done` or `closed:` line after it (a
fix to the engine's own repo counts only on a rollout whose engine holds the merge); a `[[task]]` item on
`started:`, `ready:`, `integrating:`, `merged:` or `completed:` after it; a date-only stamp only on a later
Melbourne date. A line item moves only by a Proof log `seen item <N> "<text>": <evidence> (agent|Lachy)` line
recorded at or after `live:` (`prove --seen`), and so does a link item that cannot move (missing, or finished with
nothing after `live:`), on Lachy's word only (`--on-his-word`). Live with every item moved, or none: `status: done`
and `proven: <date>`, with no `completed:` and no phase write.

**The three landing outcomes**, one verdict for every landing caller (`_land_outcome`: mark-done, resume,
reconcile's read-only approval (no code, so never watched), `prove --land`, and reconcile-project's apply, whose dry
run names the same verdict as each task's action):

- `done`: today's write, for a landing unwatched with no `clears:` item, or one whose own rollout is a serial chain;
- `carried`: the carried form (`status: review`, `merged:`, `- <stamp> landed, carried: <why>`), when it is watched
  or has `clears:`, and every engine that reads the note reads carried fixes;
- `owed`: the old engine's own landed form, which every engine reads as landed (`status: done`, `merged:`, `- <stamp>
  landed, carry-back owed: <why>; status: done written for that engine (ADR 0078 d1)`), when it would be carried but
  an engine that reads it would read a carried fix as awaiting Integration. Every surface calls it `landed, carry-back
  owed`, never done.

**The serial-chain scope.** A serial chain (`shape: serial`, whatever its status, finished or archived included) is
out of scope, and both checks read it before any engine read: at landing, its task lands `done`; at carry-back, its
task is never a candidate and never listed.

**`_carry_readers`**: every engine that reads this note reads carried fixes: the note's own rollout, and the rollout
of each dependant still to start (a `depends-on:` or `blocked-by:` naming it, through a folded member too, whose queue
state is queued or set-aside); a running or landed dependant is not checked. Each rollout's engine is read by
`_engine_reads_carried`, its four clauses in this order:

1. no `rollout:`, or no note: reads carried fixes;
2. finished (status done or dropped, under `Archive/`, or a valued `superseded_by:`): reads them, since it runs no
   queue;
3. unstamped (no valued `engine_snapshot:`): the marker in the engine an unstamped note runs on, the Primary
   checkout's copy (found through `git_primary`, engine-snapshot.py's `engine_root`), else the running plugin root,
   and never read as current by default: a held or diverged Primary is an old engine like any snapshot;
4. stamped: the marker in the `~`-expanded `engine_snapshot:` path's copy, a missing file failing closed.

The marker is reconcile-rollout.py's line `PROVEN_ENGINE = 1`.

**carried-fixes.json** (`prove --all` writes it beside the live file, only when it changes): `{v: 1, carried, owed,
carryBack}`, one split behind all three, each entry with `slug`, `project` and `rollout`: `carried` every root carried
fix still unproven; `owed` every note at done whose Proof log's last entry is the owed line, in the root or `Archive/`;
`carryBack` every other carry-back candidate whose carry-back waits. `prove --json`, status's Carried line and reflect
§ 17 use the same split.

**Carry-back.** A note landed at `status: done` and never Proven goes back to review: a candidate is in the root or
`Archive/` (never `Archive/Rollouts/`, never a serial chain's), at `status: done` with a valued `merged:`, no valued
`proven:` and no `archived` tag, and has either a non-empty `clears:` with no `## Proof log`, or a Proof log whose last
entry holds `landed, carry-back owed`. Once `_carry_readers` reads True, prove moves an archived candidate back to the
root first (a hard link, then a fresh read saved through `Note.save`, which keeps its created time and Finder tags),
then writes `status: review`, removes `completed:` and logs `carried back: landed at status: done, never Proven (ADR
0078 d1)[; from Archive/][; completed: <v> removed][; phase [[<p>]] reopened[ from Archive/]]`, and judges it in the
same pass. A root note of the same name makes it wait.

**The phase a carry-back reopens.** A phase note at `status: done` whose literal prefix `<slug>-p<N>-` starts the
carried-back task's name (§ Phase and task filenames) is a done over a fix that is not: once the judge leaves the fix
carried, the carry-back (`_reopen_phases`) writes it `status: open` with `completed:` removed, moving it back from
`Work/Phases/Archive/` first when the daily sweep filed it there (a root note of the same name leaves it as it is,
its clause `phase [[<p>]] not reopened: <why>`), so the sweep's PHASE CLOSE closes it again once its last fix is
proven. A fix the judge proves in the same pass leaves its phase as it is, `completed:` kept: that done is no lie.
A phase the completion ceremony or reconcile-project closed over an old engine's done or an owed landing is reopened
this way. prove never closes a phase.

**The hook's mirror.** hooks/vault-note-overlap.py reads a review writer live only with a `pr:` and an unvalued
`merged:`, `_valued` mirrored literally (`v.lower() not in ("", "null", "~")` after `_scalar`), since loading
reconcile-rollout.py would spend its budget.

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
  schedule regenerates no running rollout: it joins its queue, `--regenerate` not applied (ADR 0078 d6). So a successor
  is never touched by the prior's merge, whether the entry sits on the prior or on a carried task, and one written on a
  successor's own rollout note fires as any other. A `regenerate` written against a rollout that runs to its end lapses
  at its close, listed under `waiting`. `fire` runs the same reading.
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
`rollout:` links no live rollout. `<Project>` is its first project, or `no project`.

A **held line** has the same form, for a task schedule's Pre-flight left out because it waits on a task nobody is
building (schedule § 3: `waits`, and each dependant out through one), which no `rollout:` links to the note: `<x>` is
then any task, of its project or another. Schedule passes it as `waits-on.py write --rollout <note> --held <task>=<x>`
(with an empty queue, only when § 0 named this project's live rollout: schedule § 1.5's **An empty queue.**). Every
later rewrite re-reads each line whose dependant the note does not link, and keeps it while it is still true: the task
is open on no live rollout, and `<x>` has not landed and is not in flight. That is a held line, and also a linked task's
own line once a defer (schedule step 6's, or repair's dependency-aware one) clears its `rollout:`, so a task deferred
out of a rollout keeps its line there while it still waits. A rewrite that meets another writer's change replays its
edit on the fresh note, re-reading these lines there, so a held line written meanwhile is never lost.
`waits-on.py write` is the section's one writer: schedule step 7 (and § 1.5 at an empty queue), § Serial path S6 and
orient-all § 2 run it, and it rewrites the section on every
live rollout note as it stands, one line per unit a dependant waits on, removing it when nothing waits. `estate-scan.py` reads the lines back for each live rollout (`rollouts[].waitsOn[]`, each kept
only while its dependant is still open and its dependency is still an open task on no live rollout) and orient-all
lists them (§ 3, § 8).

## Speed fix hold

A **Speed fix** (CONTEXT.md; ADR 0084 d4) goes first by itself: its phase holds every other queued task of its
rollout until the phase's release lands, and the hold releases by itself (p54-13). The mark is the task-note key
`speed_fix`, its value the citation of the measured cause, in one of three evidence forms (task-writer § 4 and the
reshuffle's R5.2 use the same words):

- `docs/audits/<file>.md row <N>`: a suite audit's ranked change.
- `docs/audits/<file>.md cause <words>` or `docs/audits/<file>.md#<anchor>`: a stall audit's cause.
- `time-lost <id> [<class>]`: a Time-lost ledger line by its `id` (`tl-…`, run_record.py's `TL_ID_RE`); its class,
  when named, is one of run_record.py's `TIME_LOST_CLASSES`.

- **The mark.** Read as a list (a scalar is a one-item list); the task is marked when any item cites. Anything else is
  refused, its why the first that applies: `empty`, `a flag (<v>), not a citation`, `time-lost <x>: a tl- id (a
  Time-lost ledger line's)`, `<c> is none of stalls, quota-bound, load, lane-bound, rework, plan-rejected`, `no
  citation (an ADR decision or prose is no evidence)`. A refused mark makes an ordinary task: held like any other,
  never stopped, never asked about, its note never edited. A combined note is read per unit: a unit is marked when its
  own key cites or a task folded into it (`merged_into:`) carries one that does.
- **The release.** A phase's members are its tasks named with its literal prefix `<slug>-p<N>-` and a task number that
  starts with digits (`2`, and `2b` too), at any status but `dropped` (a unit a member folds into is a member too). A
  phase is a Speed fix phase while any member is marked. Its release is its last task, unless the phase names another
  (ADR 0084 d4): the phase note in `Work/Phases/` may name it, `speed_fix_release: "[[x]]"`, where x is any member of
  the phase, marked or not, else a `WARN` and no hold for the phase, with no fallback. Otherwise the release is the
  phase's last member, marked or not, landed ones included: the highest number by the task number's leading digits, the
  whole task number breaking a tie (`1` before `1b` before `2`). The release R is that task's unit; a release that is no
  Speed fix itself is still never held (the reach's arm 5). A hold is made only while R has not landed, is linked to the
  rollout (or is being joined), has no let-go cause and has no `released` line. The hold follows its phase's release at
  every apply and every join, never at `next`: when R moves to R' and R' can hold, the new hold's line and entries come
  first, then `released [[R]] (p<N>): superseded by [[R']]` and R's entries dropped; when R' cannot hold, the hold on R
  is kept with a `speed-hold skip` line. A standing hold whose phase has no marked member left keeps standing, still
  never holding its release or anything upstream of it, until R lands or `speed-hold release` ends it. A marked task
  outside any phase makes no hold, and is still never held.
- **The reach.** One rule: a hold on R for phase P stamps a task only when (1) it is linked to the rollout (or being
  joined) and queued, the fix's own project's queue only; (2) its unit carries no valid mark; (3) it is no red-master
  fix (below); (4) its unit is not a member of P (so P's unmarked members other than its release are held by every other
  Speed fix phase's hold, never by P's); (5) it is neither a root nor upstream (`depends-on:` / `blocked-by:`,
  transitively) of one, the roots being every unlanded marked unit linked to the rollout or being joined, every standing
  hold's release, and the release of every phase with such a mark while it is unlanded and linked; (6) R is not already
  among its `depends-on:` or `blocked-by:` by hand (an entry a recorded hold wrote is not a hand-written one, and a
  hand-written entry is never recorded). **Out of reach**: a recorded task that carries R's entry but now fails "linked"
  or (2) to (5) loses that entry at the next join, apply or `next`, why `left the rollout`, `a Speed fix now`, `a
  red-master fix`, `a member of p<N>`, `a Speed fix release` or `upstream of [[M]]`. So no hold ever holds a release,
  directly or transitively: two Speed fix phases never deadlock, and a held queue always has its phase's own tasks
  startable.
- **Red-master.** The key `master_red:` or `completion_red_of:` alone exempts a task, either one non-empty: never
  held, joined under a hold or not. `master_red:` marks the red-master fix `reconcile-rollout.py master-runs` files and
  joins first (p54-7, CONTEXT.md **Red-master fix**), and `completion_red_of:` the completion verifier's fix task; a
  key beside them (`master_red_since:` alone) exempts nothing.
- **The entry.** A held task's `depends-on:` gains `- "[[R]]"` (an inline list becomes a block list, its items kept;
  the key inserted after `status:` when absent), released by itself once R lands, as any dependency is.
- **The record.** The rollout note's `## Speed fix holds` section, append-only, two line forms:
  `- <stamp> hold [[R]] (p<N>, schedule|join): [[a]], [[b]]` (or `: none`, so a later join is still held; a later line
  names only the tasks it adds), and `- <stamp> released [[R]] (p<N>): <why>`, its why one of `by hand`, `[[X]] set
  aside, its retries spent (<humanFix label>)`, `[[X]] left the queue (<why>)` and `superseded by [[R']]`. A hold
  **stands** while it has a hold line, no released line, and R has not landed; a released hold is never re-made for
  the same R, so a reading never depends on line order and carry's union is safe. A recorded task later given the same
  R by hand loses that entry at a release or a defer.
- **The let-go.** A standing hold lets go when R, or an unlanded unit upstream of it, leaves the queue (no note; a
  status outside the carried states, such as `dropped` or `parked`; R unlinked, `deferred` or `moved to [[ro]]`; an
  upstream unit on no live rollout, `deferred` or `[[ro]] closed`) or is linked, set aside at `run` or `integration`
  and its retries spent (a non-null humanFix, read as needs-you reads it). R is read through its tombstone first: a
  release folded into a live combined unit keeps its hold, which the next apply or join moves to the unit; only an
  unresolved tombstone leaves the queue. A `gate-pending` task never lets a hold go: a gate has no automatic retries,
  and the Standing approval may still sign it. So a gate-pending release, or a unit upstream of it, is the one wait on
  Lachy the hold keeps: the queue waits until he or the Standing approval signs the gate, or he defers the task (which
  leaves the queue and lets the hold go).
- **Write orders.** A new hold: its line, then its entries. A join of unmarked tasks under a hold: the extension line
  in the rows' save, then each task's `rollout:` and its entry in one save. A join that makes or moves a hold (a joined
  Speed fix, or a joined task that is a Speed fix phase's release, marked or not): the stamps, the out-of-reach drops,
  then the hold line, then its entries. A let-go, a release or a move's old hold: the released line, then the drops,
  then one Run record line (`speed-hold`). A lift: drops only, no line.
- **Writers**: `reconcile-rollout.py speed-hold apply` (schedule step 7; § 0's Put back), `speed-hold release` (by
  hand, any note, an archived one included; a hold whose R landed ended by itself, so it is only named `ended`, with no
  line, no drop and no event), `speed-hold lift` (schedule step 1, on a supersede, from the prior's root), `join` (read
  whenever a Speed fix is in play: the note records a hold, or an unlanded marked unit is linked to the rollout or
  being joined; its extension, new or moved hold, made or moved by a joined Speed fix or by a joined task that is a
  Speed fix phase's release, marked or not, its out-of-reach drops and re-stamps; a joined task's refused mark is named
  even on a rollout with no hold), `next` (the let-go and the clean-up, never a stamp), `defer` (a deferred task's
  recorded entries, in the save that clears `rollout:`) and `carry` (the section's lines, a union).
- **Readers**: `reconcile-rollout.py status` (`speedHolds`, rendered by status § 4), the carry preview's `speed_hold`
  lines (schedule step 1), repair § 5 step 1 (a hold entry is no dependency) and every dependency reader, through
  the entries themselves.
- **Cross-version.** The entries are read by every protocol-5 engine; the section's lines by engines carrying the
  `SPEED_HOLD_ENGINE` line. join and apply write either only when the rollout's engine has it
  (engine-snapshot.md § Cross-version state); the line forms change only by migration.

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
- `skills/execute/scripts/reconcile-rollout.py` `speed-hold`, `join`, `next`, `defer`, `status` and `carry`:
  `SPEED_FIX_KEY`, `SPEED_FIX_RELEASE_KEY`, `MASTER_RED_KEY`, `COMPLETION_RED_KEY` and `SPEED_HOLD_SECTION` (§ Speed fix
  hold's keys and section), read by `_speed_fix_mark`, `_speed_release`, `_red_master_fix` and `_speed_holds`, the one
  reader of the record's line forms; the phase by `_speed_phase` on `PHASED_STEM_RE`.
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
- § Proven's readers: `skills/execute/scripts/reconcile-rollout.py` `prove` (the judge, carry-back with its phase
  reopen, and the two files), its five changed readers (`_landed`, `_queue_state`, `_holds_lane`, `_race_marks`,
  `_origin_waiter_valid`), `mark-done`, `resume` and `reconcile`'s read-only approval (through `_land_outcome`);
  `skills/_shared/scripts/reconcile-project.py` (rule 1's QUIET carried fix and its phase left open over a carried
  landing, rule 2's action and apply through `_land_outcome`, loaded); orient § 3 and § 4 (the dry run's actions, the
  `landed, carried` rows and the `left open` lines); `hooks/vault-note-overlap.py` (its literal mirror);
  close (`skills/close/SKILL.md` § A finished task closes itself), status (§ 4's Carried line) and reflect (§ 17's
  carried read), each running `prove` from the session's own root.
- **The vault's daily sweep** (`~/repos/workspaces/_shared/scripts/archive-completed-vault-items.py`, run by
  daily-sweep.sh): its task move keys on the Landed statuses (§ Statuses) or the `archived` tag, so a carried fix stays in the
  root and a done-before-Proven or owed note is archived. It never pulls a note out of `Archive/`: prove's carry-back is
  the only writer that does, for the task and for the done phase it reopens (§ Proven, **The phase a carry-back
  reopens**), which it moves back to `Work/Phases/` because PHASE CLOSE reads that root only. Its PHASE CLOSE keys on
  the same statuses, so a carried fix keeps its phase open; once prove proves the last fix, it is the only closer of a
  fix phase, since the completion ceremony's `--kinds phase` run left that phase open (rule 1 reads it QUIET), or the
  carry-back reopened it. No second phase closer belongs in prove.
- **Chorus's copy of `_queue_state`** (`~/repos/tools/chorus/src/stage/rollout.py`'s `queue_state`): it must read
  `review` with a valued `merged:` as `merged`, checked before its `pr:` branch, with `_valued`'s literal set. Until it
  does, the Stage's rollout page, the morning report's per-rollout `merged` count and, through `merged`, the awake read
  and the stop line read a carried fix as awaiting Integration: the Chorus follow-up the rollout's lead files.
- **`carried-fixes.json`**, the engine-independent surface (§ Proven): beside the live file, its three keys `carried`,
  `owed` and `carryBack`, read by the Chorus Stage line. On an old-snapshot rollout status shows no Carried line (that
  snapshot's prose has none), so this file, reflect § 17 and close's rows show that rollout's carried, owed and waiting
  notes.
- `skills/_shared/scripts/waits-on.py` (§ Waits on's one writer) and `skills/_shared/scripts/estate-scan.py`'s
  `WAITS_ON` (its one reader), which carries each line still true to `rollouts[].waitsOn[]` for orient-all.
- `tests/contracts/vault-grammar.test.mjs` pins every literal copy above to this file, and checks both
  scripts' key and sort helpers against the examples under § Phase and task filenames.
