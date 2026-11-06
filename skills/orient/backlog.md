# The Backlog orient — `/thread:orient <area> --backlog`

Orient's mode that needs nobody present (ADR 0071; Animately ADR 0016's rules). It reads an area's whole Backlog
(every open and parked task, from any source), folds related work into batches, parks what is not worth a rollout
yet, schedules and starts the rollouts, and only then puts to Lachy the questions that are his, one at a time. With
nothing to ask, it runs without him. Chorus's `backlog-orient` Routine starts it when the Pulse stamps a pile-up or an
urgent task (metrics ADR 0015's trigger file); he can run it by hand too. This file holds the mode's only copy of
its rules: orient's SKILL.md and `reshuffle.md` point here, one paragraph per section.

**Plugin root.** This file is read as a file, never rendered: run its commands by
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

**The order.** B1 → B2 → orient § 4's writes under `--backlog` → B3 → B4 → B5 (the forks, answered by B6) → B7 →
B8 → B9. `--look` stops at B10 instead. The default orient path is unchanged by any of it.

**Write surface.** Task notes through `backlog-orient.py`'s verbs and orient § 4's `next-action.py mend`, the
`estate-dispatch.py record` answers, the forks' own schedule writes, the record note
(`Work/Projects/<Folder>/Backlog orients/<D> <Area> Backlog orient.md`), the trigger file through `trigger --write`
only, and the start stamp through `stamp-start --backlog`. A merge, an unbundle and a phase retire write by reshuffle
R5.4. Never git or gh of its own.

## B1. Scope and flags

- **An area only.** The target must resolve to an area (orient § 1). A project or scoped target with `--backlog`
  prints one line, `--backlog takes an area: <name> is a <kind>; run /thread:orient <area> --backlog`, and nothing
  is read. `--steer` with `--backlog` is refused the same way: the mode steers by its own rules (B4).
- **A resolver that does not resolve stops.** `candidates`, `none` or a resolver failure ends the run with the
  resolver's line and the `/thread:orient <area> --backlog` line to run by hand; nobody is there to pick.
- **No card, no learn.** § 3.5's Priorities card is never put (an area puts none anyway), and no learned directory
  is held.
- **`--look`** combines with it: `/thread:orient <area> --backlog --look` runs B1, B2 and B10 only.

## B2. The Backlog read

1. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py sweep --area <§ 1's note> --json` returns
   the rows and `read_at`. Membership follows the Pulse's line rules (backlog_trigger.py's Projects, Task and
   read_vault; the script's header holds the one copy), never PyYAML, so a task whose frontmatter does not parse is
   still a member. A member is a note in `Work/Tasks/*.md` (never `Archive/`), at status `open` or `parked`, not
   tagged `rollout`, naming in `projects:` the area note or any `.md` under the area folder at any depth, by stem or
   by `aliases:`. It is out when a link name, or the stem that name resolves to, casefolded, starts with a name the
   area note's `backlog_excludes:` lists (Animately's: `["[[GifLab]]"]`, the Pulse's own exclusion).
2. Each row carries its kind (open, an **orient park**, `parked-by: backlog-orient`, or a **held park**: any other
   park), whether it is area-only or homed, whether it is in flight (vault-grammar § In flight), its frozen kind
   (thread, decisions, not a task, or `unparseable:<why>`), and whether the trigger's `urgent[]` or `tasks` name it.
3. `projects[]` holds only the `project`-tagged notes under the area folder outside the excludes, and `excluded[]` the
   notes the excludes drop. A record note (tagged `backlog-orient`), a status log or a reference note is never in
   `projects[]`. orient § 2's slots, drift, placement, threads and related projects run over `projects[]` only.
4. `backlog-orient.py trigger --area <note> --read --json` returns the stamp (`stamped_at`), whether it is pending,
   its `tasks`, its `urgent[]` entries and `last_orient_at`. With no `backlog_trigger:` on the area note it prints
   `trigger: none declared on [[<area>]]`, and the record says so. The run's reason is the stamp's `reason` when it is
   pending, else `manual` (the read's `runReason`).
5. **The unparseable rows.** Under `--backlog`, orient § 4 mends each `unparseable` row with
   `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py mend <task>`, as its **Unparseable slots**
   paragraph does, and names each result in the record's Drift fixes and mends. Then `sweep` runs once more, and its
   rows and `read_at` replace this step's. A row that still reads `unparseable` is frozen and listed for him.

## B3. Dispositions

R1 and R2 under `--backlog`. The item set is `sweep`'s rows, never a walk of the folders.

- **Frozen**, listed and never touched: in flight; possibly landed (reshuffle R1); thread; decisions; not a task; an
  unparseable row the mend could not fix.
- **A held park is frozen context.** Listed under Held parks, and never reopened, scheduled, obsoleted or parked
  again: he parked it, or it was parked before ADR 0071, and a strategy deferral is his to lift. Its row may say
  `looks no longer true: <why>`, for him to act on.
- **The dispositions:**
  - **batch** — the members of one schedule call (B5);
  - **park** — a lone task that is not urgent, not `priority: high` and not `work_depth: deep`, whose batch is not
    worth a rollout now, listed with its why (Owner *priorities*, Animately ADR 0016). Parked never for being unclear
    and never for size alone; an urgent task is never parked;
  - **reopen** — only an orient park folded into a batch this run schedules;
  - **obsolete** — `status: dropped` only once the task stops being true, `--fixed-by` other work or `--gone`, never
    for size. It is a task's disposition, distinct from the phase **retire** below;
  - **re-home** — an area-only task onto the `project`-tagged sub-project under the area folder whose `repos:` holds
    its files (Owner *technical*); with none, it stays a loose misfit and is listed;
  - **merge** — two tasks that are one change; the survivor keeps its path;
  - **unbundle** — a brain dump into new loose tasks with no `phase:`, named by `add-task.md`.
- **Not under `--backlog`:** no **Drop**, no move between phases, no new phase note, no rename and no pull-in rename
  (the Pulse keys a task by its path). Phase **retire** applies unchanged, by reshuffle R5.4.
- Unclear items and open forks go to B9's grill, after the start; they hold back only their own tasks.

## B4. The decided record

- R4's table goes into the record's Decided for you section and is never put to him (Owners *priorities* or
  *technical*; under `--backlog` this amends ADR 0036's gate).
- R3's technical calls are written by `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --owner <technical|priorities> --question <fork> --answer <call> --why <reason> --by orient`.
- § 6's steer is decided as Autonomous (a serial rollout for the serial-shaped clusters), and the session-lane work is
  listed under Session lane and misfits.

## B5. Writes and routing

- orient § 4's writes run first: the drift fixes and B2's mends.
- **R5 under `--backlog`.** Park, reopen, obsolete and re-home run through
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py park|reopen|obsolete|rehome …`, never a
  hand edit; a refusal is listed, never written by hand. A merge, an unbundle and a phase retire run by reshuffle
  R5.4. R5.1 and R5.3 write nothing (no new phase, no rename).
- **The fit test.** The three-way execution-fit test runs on each batch, as in orient § 6.
- **The forks.** Each parallel batch gets one forked subagent per (repo, project), with the prompt
  `/thread:schedule --regenerate --tasks <members>` and then the line
  `Under the Backlog orient: <area>; name the note with slug <projectSlug>; root <the home project's first repos: entry>; decided none`.
  Serial-shaped members get one fork per project, `/thread:schedule --tasks <members>`, with the line
  `Under the Backlog orient: <area>; decided none`.
- **Batches**, by orient-all § 6.2's rule: no two parallel forks in one batch share an origin
  (`bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh --origin-slug <root>`) or a project slug; urgent
  members' forks go in batch 1; serial forks run one per batch, after every parallel batch; batch 1's forks run side
  by side, then batch 2's, never two batches at once. With no fork in the harness, the forks run one at a time here,
  under the same answers.
- **A fork returns** schedule's summary verbatim and each note's path; its misfits; Pre-flight's `out[]` with each
  why, and its `asks[]` and `index[]` verbatim; its § 3.5 drops, each with its matched words; its Decided for you
  block; its stop line; and **touched**, every task note it wrote.
- A reopened task whose fork stopped is parked again with the reason `its batch waits: <stop line>`.
- Uncommitted grill docs hold that repo, as in orient § 6.

## B6. Schedule's answers

A fork asks nothing: each question schedule would put takes its answer here, and schedule's **Under the Backlog
orient.** paragraph cites this list. A `## Decided for you` bullet is an agent's call: it settles no § 3.5 match.

1. Step 1's count: reported, with the skips named.
2. schedule § 0's misfit routing: the fork routes nothing (no `defer`, no `open`, never the follow-up line). When
   session-lane misfits dominate, it stops before writing. In a mixed set it schedules the parallel subset and returns
   each misfit with its outcome.
3. schedule § 0's target repo: the prompt's `root`. The `Local:` line is read when it names that repo; otherwise the
   root is the path the user gave, and `<localPath>` is empty.
4. schedule § 0's clone (exit 4): Yes, without the question (ADR 0071). `--ensure` runs with `timeout: 600000`, and
   step 8 lists `Decided for you: create the rollout clone <C> → yes (technical: the Backlog orient runs without him, ADR 0071)`.
   A `nested in <P>` line is settled by the clone step's own ignore probe, which creates nothing when `<P>` would
   track it. `--ensure` exit 3, 5 or 2, or `clone` exit 3, stops the fork with its stderr verbatim.
5. schedule § 0's remote, landing-register and pushed-base checks: as written. A stop is returned.
6. schedule § 0's unfinished-rollout check: its `file` and `interrupted` finishes run as written, and `none` goes on.
   At `supersede <prior>`, before the Supersede prep, the fork reads two things:
   - `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py unstarted --rollout <prior>`, with one
     `--handoffs` for each of
     `$(bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh --dir <§ 0's resolved path>)/docs/handoffs`,
     `$(bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh --shared-root)/docs/handoffs` and
     `$(bash ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh)/docs/handoffs`;
   - `reconcile-rollout.py status --rollout <prior>`, run from the prior's root (schedule § 0's *The prior's root*), for its
     top-level `holdUntil` and `onMerge`.

   It goes on only when `unstarted` prints `unstarted …`, `incomplete …` or `stamped <prior> (start: unattended)`,
   and both `holdUntil` and `onMerge` are null. Every other line stops the fork before the prep, with nothing written:
   `started …` (his pause, a sign-off's, a pause request, a lead's entry), `stamped … (started_unattended: …)`,
   `launched …`, `closed …` and `serial …`, any rollout hold, readable or not, and an `on_merge:`. Its stop line is
   `waits on [[<prior>]]: <the unstarted line | hold_until <pr> | on_merge>; it stands (/thread:status [[<prior>]])`.
   Any other final line of the check stops the fork with its stderr.
7. schedule § 1.2's pickup sweep: not run (the call names its members on purpose).
8. schedule § 1.5's Pre-flight (and S3.5), as under the chain's item 4: its own read-only grading agents, `log` and
   `decided-for-you --write --by schedule` run as written; there is no round and no `record`; the final `preflight`
   passes `--decided` only for the prompt line's slugs among its candidates. A One call, a Grill or an ungraded member
   leaves with its Dependent closure, unstamped, and its `asks[]` and `index[]` are returned for B9.
9. Step 2.5's verifier and merge gate: stated, never asked. With no verifier, the fork stops before writing.
10. Step 2.6's baseline: `none`.
11. Step 2.7's env bootstrap: CLAUDE.md detection only, else unset.
12. Step 2.8's settings: as written. A non-zero exit stops the fork.
13. Step 2.9's Inert paths: `drop` runs; a `proposed` entry is named and never recorded.
14. schedule § 3's body dependencies: as written; one outside the candidates is named.
15. schedule § 3.5: a match that a recorded `## Decisions` answer settles is dismissed (B9 records a kept gate in
    exactly that form). Any other match drops its task, named and unstamped, never `ignore_gate`; the fork returns it
    with its matched words, and B9 puts § 3.5's question.
16. schedule § 3.6: every undismissed hit is stamped `plan_approval: required`, with no ask-ahead. A spend or a
    test-credential hit gets its Planner line. A gate sets aside its task, never the rollout (ADR 0008, ADR 0034).
17. Step 4.5's merges: none, with the candidates named (the Pulse keys a task by its path).
18. Step 4.7's rungs: none, with the hard tasks named.
19. Step 5's order, Solo and Branch check: as written; Solo is listed in step 8's Decided for you.
20. Step 6's name: the prompt's `projectSlug`; a taken name advances.
21. Steps 7 and 7.5: as written.
22. Step 8: no To-execute block, no handoff and no Start when ready, because B8 owns the start. The summary is
    returned.
23. The serial path: S1 and S4 ask nothing. S2's `sessionLane` members are returned as answer 2's misfits are. S3.5
    is answer 8, and S4's gates are answers 15 and 16. S7 is returned, and no Leg is started.

## B7. The record, then write-back #1

1. After every task write, B5's and the forks', write the record:
   `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py record --area <note> --date <D> < <json>`,
   its `read_at` the sweep's, its `trigger_stamp` and `seen_orient_at` the trigger read's `stamped_at` and
   `last_orient_at`, its Trigger rows every task the stamp names, its Batches rows each note a fork wrote (with its
   prior), and `touched` every task this run and its forks wrote. Its sections: Trigger, Batches, Rollouts started,
   Parks, Reopens, Obsoletes, Re-homes, Merges and unbundles, Held parks, Session lane and misfits, Left out, Drift
   fixes and mends, Decided for you, Questions asked, Held by his answer, Questions waiting, Answered, waiting,
   Folded, Write-back and Touched.
2. Then `backlog-orient.py trigger --area <note> --write --reason <B2's reason> --record <path>`. Its guards: the
   stamp has not moved; every Backlog task written after `read_at` is named (linked by the record outside Answered,
   waiting, linked from the body of a rollout note the record's Batches links, or holding its own `rollout:` that
   links one); `last_orient_at` is the one B2 read. Exit 0: its line goes in the record.
3. **Exit 4: one fold.**
   1. Each `unread` task is read, disposed by B3 and scheduled. A batch it joins re-forks with `--regenerate` over
      this run's own never-started note, which answer 6 supersedes because nothing has stamped it yet; otherwise it
      gets a new fork under B5's rule.
   2. Each `seen` task is only appended to the Trigger section. The one exception is a `seen … urgent` task that reads
      `parked-by: backlog-orient`: it is reopened and scheduled in batch 1.
   3. `record --append --note <path>` adds the fold's rows (Folded), the new forks' touched and Batches rows, the
      Trigger rows and the new `trigger_stamp`.
   4. The write runs once more.
4. A second exit 4, or guard 3 (another orient wrote `last_orient_at` meanwhile), **holds the write-back**: the
   record names it, and the stamp stays pending for the next Backlog orient.
5. Exit 2 (a corrupt file, or none declared): named, and the file is left untouched. With no declaration there is no
   write-back.

## B8. The start, over a set of notes

- **Which notes.** B8 is a step run over a set of notes, called twice: first from the main flow, with every note
  standing after B7, each note B5's forks or B7's fold wrote, less one the fold superseded (`stamp-start` refuses a
  superseded note anyway); then from B9, with each note its post-question round wrote.
- **A parallel note with no stop line** gets
  `python3 <root>/skills/execute/scripts/reconcile-rollout.py stamp-start --backlog --rollout <note>`, `<root>` what
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py resolve --rollout <note>` prints, exported
  by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md` rule 2 (this amends ADR 0057's execute handoff: the Chorus
  Stage starts the lead). It prints one undo line for the record. No stamp is written after a "Checklist — ladder
  refused". A refusal (exit 1: serial, a hold, paused, run, and the rest) goes in the record with
  `/thread:execute [[<note>]]`.
- **A serial note is never stamped.** On the Chorus Stage (`create_thread` answers ToolSearch): call `list_sessions`
  once per call of B8; a Session carrying `leads the Rollout <slug>` means nothing is started, and that Session is
  named; otherwise `create_thread` with the title `Leg 1: <slug>`, the prompt `/thread:execute [[<slug>]]` and its
  brief line, and as cwd row 1's launch folder in its Chain copy (`leg.py status`'s `restart.launch`). A `cx-*` row 1,
  or no folder, gets a labelled manual hand-over. A `Raised` result is reported as raised.
- **Off the Stage** the stamps wait like Not yet, and each Leg 1 is a paste-ready prompt in the record.
- Every result is a Rollouts started row. Never `/thread:repair`, run or relayed.

## B9. The questions, last

The run puts each of his questions through AskUserQuestion, one at a time, after the start (Owner *yours*, each in
the Framing of `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`, the recommendation first). In order: each fork's
`asks[i]`, verbatim; then one § 3.5 question per task a fork dropped at answer 15, worded
`§ 3.5 gate: does "<the matched words>" hold this task out of a rollout?`, with the options
`No: keep it, it holds nothing` and `Yes: keep it out, it is a gate` (No recommended when the note only quotes or
describes the words, schedule § 3.5's no-gate reading, else Yes); then R3's grill, invoked by name with R3's `args`,
cluster by cluster. Each question holds only its tasks.

**After each answer**, written at once:

- **One call or Grill** → `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --question <decision.question> --answer <text> --recommended <index.recommended> [--fork <f>] --by schedule`.
  The task is decided on exit 0 (a Grill once every decision is recorded).
- **§ 3.5 No**, or typed words that keep the task →
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --question '§ 3.5 gate: does "<the matched words>" hold this task out of a rollout?' --answer '<the option text, or "No: " + his words>' --recommended '<the recommended option text>' --by schedule`.
  It writes the bullet under `## Decisions (asked ahead <D>)` that answer 15 dismisses (schedule § 3.5's first keep
  path, deciding the open question in the note). On exit 0 the task is decided and joins the post-question round. A
  refusal (exit 2: the task went in flight or left Active) is listed as unrecorded, and the task is held.
- **§ 3.5 Yes** → nothing is written to the task. It stays out, listed under `## Held by his answer` with its words,
  with no `wait` line and no `## Answered, waiting` row, so it never holds back the re-stamp. The next Backlog orient
  that batches it puts the question again, as every standalone schedule run does for a gate nobody has cleared.
- **Ungraded** → never recorded. "Queue it as it stands" decides it; "Leave it out" puts it under Held by his answer.
- **An answer that defers or drops the work** → recorded, and the task stays undecided, under Held by his answer.
- **A grilled item** → respecced by R5.2, its Decided for you lines through `record --owner … --by orient`, then
  decided.
- Every answer then gets `record --append` of its Questions asked row. Questions left open (his "stop", or no reply)
  go under Questions waiting; the rollouts already run.

**Then one post-question round** over the decided tasks: B5's grouping and batch rule, without `--regenerate`, with
the line `Under the Backlog orient: <area>; name the note with slug <projectSlug>; root <root>; decided <slugs>`
(serial: `Under the Backlog orient: <area>; decided <slugs>`).

- **A fork that wrote a note** → `record --append` of its Batches row and its touched; then § B8 on that note; then its
  Rollouts started row. Each decided member that note does not queue gets
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/backlog-orient.py wait --task <slug> --why "<its why>"` and an
  `## Answered, waiting` row.
- **A fork that stopped** (usually § 0's one-rollout-per-project refusal, because B8 just started that project's
  note) → `wait` for each decided member, and an `## Answered, waiting` row each.
- New `asks[]` or § 3.5 drops from this round go to Questions waiting. There is no second round.

**Then one re-stamp, last:** `backlog-orient.py trigger --area <note> --write --reason <reason> --record <path>`. It
lands only when guards 1–4 pass: no stamp moved, every Backlog task written after `read_at` is named, `last_orient_at`
is unchanged, and `## Answered, waiting` is empty. In words: every decided task joined a rollout, and a task his
answer holds out waits on nothing the Pulse should count. Exit 4 → a `re-stamp skipped: <line>` row under Write-back;
the Pulse then counts those writes, at most one capped pile-up.

## B10. `--look`

`--backlog --look` prints the rows by disposition; the re-homes, the held parks and the parks; the batches, with
their prompt lines and batch numbers; the trigger read; the unparseable rows; and the questions it can already see.
It writes nothing of any kind: no mend, no drift apply, no learn, no script write verb, no record, no fork, no stamp,
no `create_thread` and no write-back.

## Don'ts

- **Never stamp a serial note, or a note beside a hold**, and never run or relay `/thread:repair`.
- **Never reopen, schedule or obsolete a held park.**
- **Never supersede a prior that answer 6 stops on.**
- **Never park for size alone, or close a task for being small**: a task closes only once it stops being true.
- **Never rename a task**: the Pulse keys it by its path.
- **Never write the trigger file except through `trigger --write`**, and never before the last task write.
- **Never put a question before the start**, and never leave a note the post-question round wrote unstarted.
