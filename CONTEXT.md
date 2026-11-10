# Thread — domain glossary

The ubiquitous language of the `thread:*` plugin: one system that drives work
through time, from attention to merged PRs. Terms only — no implementation.

## The system

- **Lane** — one of the two dispatch surfaces every cluster of open work gets
  exactly one of: the **rollout lane** (unattended work run from a rollout
  note, as a **Parallel rollout** or a **Serial rollout**) or the **session
  lane** (work that needs Lachy present or waits on a date: `defer`, or a
  task's `## Launch` block via `open`).
- **Execution-fit test** — the single rule deciding a cluster's lane and, in
  the rollout lane, its shape (`skills/_shared/execution-fit.md`): parallel-shaped,
  serial-shaped, or session-lane. Decides hard, never as a preference.
- **Parallel-shaped** — passes the fit test's parallel step: converges on ONE
  code repo, lands as a PR per task, verifies machine-checkably inside the run,
  with no external publish and no tool or launch profile the lead lacks.
  Runs as a Parallel rollout. Shape only — count is never a criterion
  (ADR 0009). _Avoid_: rollout-shaped (its name until 2026-10-19, when
  "rollout" came to cover both shapes).
- **Serial-shaped** — work an agent can finish without Lachy present that is
  not parallel-shaped: no PR per task (vault notes, several repos), no machine
  check inside the run, an external publish, or an external tool or launch
  profile the lead lacks; a shared surface makes work serial-shaped only
  alongside one of these. Runs as a Serial rollout.
- **Task floor** — the invariant: every stash/defer writes a self-contained
  vault task routed to the right project. The guarantee that makes shutting an
  agent down feel safe. The Task is also the shared atom of both ladders:
  planning (project → phase → task) and execution (rollout → task, run as a
  Queue since ADR 0030).

## Estate (all projects)

- **Estate pass** — orient at estate altitude, run by `orient-all`: one look
  across every project in the vault that sweeps up the work needing little of
  Lachy's thinking and puts it in motion (ADR 0061). It grades open work,
  batches a **Small project**'s decisions, starts its rollouts, and offers
  any project that needs real design thinking, and every **Big project**, on
  the **Pick list**. It never reshapes a project itself. `orient` is the same
  act at project altitude; a project ticked on the pick list gets its own
  `orient` session. _Avoid_: rally, global orient, portfolio review, triage
  (alone).
- **Big project** — a project with its own design record, which keeps its own
  session (ADR 0061): the estate pass grades its work but asks none of its
  decisions, schedules none of its rollouts and starts none of its work
  unless Lachy ticks it on the **Pick list**; its own orient session asks and
  schedules them, and a repair started beside it asks its pending sign-offs
  (orient has no sign-off step). The test (`estate-scan.py`'s `ownSession`): the project
  note's `orient:` key, `own` or `sweep`, wins; else a declared repo holding a
  `CONTEXT.md` file and a `docs/adr/` directory with an ADR in it. A bare
  THREAD.md is no signal. _Avoid_: large project, main project.
- **Small project** — every project that is not a **Big project**: list-style
  work (admin, a queue, an apartment, contacts) whose quick calls the estate
  pass asks and whose ready work it schedules and starts. Anything needing his
  hands, money or a message still waits for his yes. _Avoid_: side project.
- **Pick list** — the estate pass's one question at its end (orient-all § 7,
  ADR 0061): every **Big project** with idle ready work, decisions, sign-offs
  or a held rollout item waiting on its own session, and every small project
  with an Orient task, ranked by what waits on it, the top three asked beside
  `Not now`. Lachy ticks which to open, or types any name on it; only those
  start, each orienting and scheduling in its own session, a big project's
  pending sign-offs asked by a repair started beside it. _Avoid_:
  shortlist.
- **Estate scan** — the estate pass's deterministic first pass
  (`skills/_shared/scripts/estate-scan.py`), with no model calls: every
  project not done, parked ones marked; its open tasks; its repos and their
  dispatch blockers (schedule § 0's checks, plus the verifier); the deadlines;
  and every live rollout's status. Scripts scan, the model decides: the
  grading and ranking come after it. _Avoid_: audit, for the scan alone.
- **Readiness grade** — what a task needs from Lachy before an agent can
  finish it, given by the estate pass's per-project grading agents after the
  Estate scan: **Ready** (an agent can finish it without inventing a decision
  nothing records), **One call** (a single decision, offered with a
  recommendation), **Grill** (a few low-level decisions an agent with the
  project's thread, ADRs and code can recommend on), or **Orient** (the
  decisions shape the project, so it needs a full-context session). Only
  Lachy's own decisions count: a fork the grader settles with evidence, a
  technical or priorities call, is ruled now and written as Decided for you,
  never asked (ADR 0054). A decision of his the agent cannot recommend on with
  confidence raises the grade one step. Each grade is kept in the Grade log
  (§ Run record and tuning).
  _Avoid_: tier 1/2/3, traffic lights.
- **Owner** — who a question belongs to, labelled before anything is asked
  (`skills/_shared/asking.md` § 1): *yours* (intent, importance, robustness,
  taste, an authorisation an ADR keeps as his), asked; *priorities* (his
  stated priorities answer it) and *technical* (the code or research settles
  it), decided and listed as Decided for you; *gate* (a process step such as
  "next move?"), never asked. A gated input (ADR 0008) is always *yours*.
  _Avoid_: question type.
- **Decided for you** — a call an agent made for Lachy instead of asking,
  one line with its reason, written where he reads it and can overturn it: a
  task note's `## Decided for you (<date>)` section (never `## Decisions`,
  which records his own answers), an ADR's Decided for him (overturnable)
  list, or a report. It settles no gate and signs no gated input (ADR 0054).
  _Avoid_: assumption, default.
- **The Framing** — the shape of every question Lachy owns
  (`skills/_shared/asking.md` § 3): plain words, the goal it ties to, what
  each option gains and costs, the pick against his priorities, and a Note
  invited ("What would make this wrong for you?"). Script-built rounds take
  it from the grade's `goal` and `stakes` (ADR 0054 d8). _Avoid_: template.
- **Priorities card** — a project note's `## Priorities` section: how robust
  the work must be (production-ready or lightweight), who it is for, what
  matters most, and the technical details Lachy steers himself. Orient asks it
  once, at the first project orient that finds none (orient § 3.5), and every
  later ask reads it: a call it answers is *priorities*, decided and listed; a
  detail it says he steers is *yours*. A Note that corrects it is written back
  the same day (Chorus ADR 0110 d5). _Avoid_: project brief (the estate brief is
  `~/.agents/knowledge/how-lachy-decides.md`).
- **Pre-flight** — schedule's pass over a rollout's tasks before it is
  written: each task still to start gets its **Readiness grade**, One call
  and Grill tasks first get a **Decision round** with Lachy, and Orient tasks
  and tasks whose note does not parse stay out with their Dependent closure;
  it runs no plan gate (ADR 0047). Not
  schedule step 8's "Checklist —" report blocks (called "Pre-flight —"
  before ADR 0047), nor a Leg's preflight.
  _Avoid_: preflight check, dry run.
- **Pickup sweep** — schedule step 1.2, on a standalone parallel `--tasks` run
  only (ADR 0057): before the **Pre-flight** it reads the same repo's other
  open tasks on the named tasks' projects (`unfinished-rollout.py pickups`)
  and joins those that fit, each one a named task needs (uncapped) and up to
  five others, by priority, then phase. A misfit, a gate hit or a dependency it
  cannot meet stays out, named; a task on another repo, or with no `## Launch`
  **Repo:** line, is only counted. A whole-project reshuffle stays orient's.
  _Avoid_: backlog scan.
- **Unpark offer** — the estate pass's question about a parked project with
  ready work: unpark it (it becomes queued), snooze it (asked again only after
  a fortnight or when its ready work grows), or kill it (done and archived).
- **Review load** — the attention a rollout hands back to Lachy once it runs:
  PRs to read, sign-offs, eye-checks. Shown beside the work the estate pass
  queues, because his attention is spent twice, once deciding and once
  reviewing.
- **Ranked slate** — the estate pass's ranking of graded open work by agent
  work per minute of Lachy's attention (deciding plus reviewing), its
  leverage: parked projects last; work due within a fortnight (overdue
  included) above everything else; then crowned projects; then leverage.
  Grouped into candidate runs with their Review load, work held by an open
  dependency set apart, beside the One call and Grill decisions in asking
  order, the **Pick list**'s candidates, and the Unpark offers
  (`skills/_shared/readiness-grade.md`). _Avoid_: backlog, priority list.
- **Decision round** — the estate pass's questions, within the time budget
  Lachy states: only his questions, each in the Framing, and only a **Small
  project**'s (a big project's sign-offs, One calls, Grills and Unpark offer
  wait on its own session, ADR 0061). First the One-call
  round: pending sign-offs always, each after its gates are shown verbatim,
  then One calls, then Unpark offers, batched through AskUserQuestion. Then
  Grill rounds, in conversation, while time remains. Each answer is written into its task's `## Decisions (asked
  ahead <date>)` (`skills/orient-all/SKILL.md`). Schedule's **Pre-flight**
  holds the same round for one rollout's tasks (ADR 0047). _Avoid_: triage
  round.
- **Dispatch plan** — what the estate pass starts once the decisions are in:
  a schedule per candidate run whose decided, unheld members are clear of
  dispatch blockers, each with every dependency it needs scheduled in the
  same pass (one held only because its dependency was scheduled late goes
  next pass), in batches; then one visible session per new parallel
  execute (on the Stage each new serial chain is listed on the **Waiting
  list**: its Leg item runs `stamp-start`, never opened as a session), per
  live rollout that status sends to a ceremony, a start, a signed reinstate or
  a repair, and per child orient of a project ticked on the **Pick list**
  (paste-ready prompts off the Stage, a serial Leg 1's among them); nothing of
  a **Big project** unticked. _Avoid_: launch list.

## Continuity (threads and attention)

- **Thread** — a live agent conversation carrying working context. Ephemeral;
  dies with the session. (Deliberately overloaded with the file below — the
  plugin name trades on the overlap, but the two must never be confused in
  skill prose.) In wording Lachy reads (a router's line, its menu options
  and their descriptions) the convention is user-facing: **session** names
  the live conversation and **thread** the durable work its THREAD.md
  records, because that is how he reads the word. Agent-facing prose keeps
  the two senses above.
- **THREAD.md** — the durable state-of-play *file* a thread can be persisted
  into. A code project's thread is its **Repo thread**: the repo's own
  toplevel `<repo>/THREAD.md` under `~/repos`, found by `open`'s repo-thread
  lookup; its slug is its front-matter `slug:`, else the repo directory's
  name, and the lookup matches either. Project-side
  (`~/Projects/<Area>/<Project>/THREAD.md`) is for a project with no code
  repo; shared (`~/repos/workspaces/_shared/threads/<slug>.md`) for
  cross-workspace or meta work. One live thread per project, always named
  THREAD.md: a finished arc moves out, never to a sibling `THREAD-<name>.md`
  (ADR 0039). Agent-facing.
- **Thread home** — where a project's one live thread lives: the first
  qualifying repo its note's `repos:` declares (a main checkout at most three
  directories below `~/repos`, outside obsidian, workspaces, `.claude` and
  `_archive`), else its `~/Projects` folder. A workspace seat's subfolder is
  never one (ADR 0039 d1, d3).
- **Placement check** — the audit (`thread-placement.py`) of where every
  thread sits against its thread home. Its kinds are `split-home` (not the
  retired reshuffle verb *split*, ADR 0027: a `~/Projects` folder's thread
  whose project's home is a repo, or a thread in a repo its project lists
  after another), `misnamed`, `undeclared`, `no-slug`, `behind`,
  `side-branch` and `workspace`. A repo-tier finding is reported once per
  thread identity, at its main checkout's path, never once per copy
  (ADR 0039 d5). Report-only: orient shows it, close warns with it.
- **Route** — a decisive member (`stash`, `defer`, `handoff`, `close`) that
  disposes of the current thread with known intent.
- **Router (`next`)** — the undecided sibling. Answers "what's my next move?"
  then dispatches to a route. A sibling, not a parent. "Next move?" is a gate
  (Chorus ADR 0110): when its recommendation is clear, `next` decides it and says
  so in one line, asking only when the pick turns on what only Lachy knows, and it
  never drops an open confirm (a gate, technical or priorities question is
  decided by the rule; his question, and any act the action policy reserves
  for him, is carried). Its *keep going* may
  carry a **compact recommendation**, which only Lachy acts on: compact is a
  recommendation inside keep going, never a route. When the work already
  continues in another session it recommends **archive this session** instead,
  which writes nothing and is never a route either. A rollout note written and
  waiting with no lead gets its **execute handoff** first, before the move
  (ADR 0072).
- **Orient** — the one shaping verb, at project altitude: audits a whole
  project/area (not one thread), then reshuffles it without asking (ADR 0036),
  unless told to steer it as it stands or just look. It schedules parallel-shaped
  work itself and, when Lachy steers Autonomous or Mixed, serial-shaped work as
  a serial rollout; it routes the rest by the execution-fit test and ends with the
  **execute handoff** (a fresh session by default; here, not yet or start when
  ready on his word).
  Pointed at a single plan, design note or brain dump it runs a **scoped
  reshuffle** of that note alone. Absorbs the former `split` and `gather` verbs
  (ADR 0027).
- **Target** — what an orient picks up: one project, one area, or one note.
  It is resolved before anything is read: from the argument (a name, alias or
  link), else from the session's directory. A directory a project declares, an
  exact name or alias, or a clear best match goes ahead; a close call or no
  match asks Lachy first (ADR 0036). A project target audits that project,
  never its whole area; `--backlog` takes an area only (ADR 0071). _Avoid_: inferring the area.
- **Backlog orient** — `/thread:orient <area> --backlog`, the orient that needs
  nobody present (ADR 0071; `skills/orient/backlog.md`): it reads the area's whole
  Backlog by the Pulse's line rules, decides each task's **Backlog disposition**
  and the rest as a decided record, forks schedule runs per batch and starts their
  rollouts, then puts his questions to him one at a time, each holding back only its
  own tasks. A gate he holds writes nothing to its task and is put again at the next
  Backlog orient that batches it. It writes `last_orient_at` back into the Pulse's
  trigger file once its forks' writes are done, and re-stamps it once after his
  answers unless that first write was held, each only while its guards pass.
  _Avoid_: auto-orient, unattended reshuffle.
- **Backlog disposition** — what a Backlog orient does with one task: batch it, or
  **park** it (`status: parked`, `parked-by: backlog-orient <date>`: not worth a
  rollout yet, never for being small or unclear), **reopen** an orient park its batch
  takes, **obsolete** it (`status: dropped` once it stops being true, never for size;
  not the phase **retire**, which empties an unstarted phase), **re-home** it onto
  the area's sub-project, or mark it **wait** (answered, but its rollout already
  runs). A **held park** is any park without `parked-by: backlog-orient` (his own, or
  older than ADR 0071): frozen, never reopened, scheduled, obsoleted or parked again.
- **Declared check** — a command a project names for orient to run in its
  audit. It prints what is new since its own record, and the record moves on
  only once Lachy has passed those items at the gate, so it says what he has
  seen. The check owns its record (ADR 0036).
- **Batch** — a parallel-safe cluster of open work (disjoint files/surfaces)
  that orient dispatched as child agents of its own session. Retired
  2026-10-19: serial-shaped work runs as a **Serial rollout**, with chains
  side by side when its surfaces are disjoint. _Avoid_: batch, for any
  current dispatch unit.
- **Dispatch artefact** — a batch's durable contract: the prompt file under
  `<workspace>/.scratch/orient/`. Retired 2026-10-19 (ADR 0040) with orient's
  batches; existing prompt files are inert history, read by nothing.
- **`dispatched:` stamp** — `dispatched: YYYY-MM-DD` task frontmatter orient
  wrote when it dispatched a batch. Retired 2026-10-19 (ADR 0040) with
  orient's batches; existing stamps are inert history, read by nothing.
- **Thread-worthy** — passes the thread-shape test (8+ substantive turns,
  deferred decisions, artefacts produced). Only thread-worthy work earns a
  THREAD.md.
- **Stash** — dispose dormant, no date. "Not my focus, lock it in."
- **Defer** — dispose onto a specific day (`scheduled:`). "Tomorrow's problem."
- **Handoff** — fork the working context to a fresh agent *now*; work continues
  immediately there, and this session then runs `next` for its own move
  (skipped when `next` or a Rollout launch dispatched the handoff). Always
  produces a **handoff doc** (below) and a paste-ready prompt; in Codex Desktop
  or a Chorus Session also a visible native task. Model-invocable on explicit
  fork intent (or router dispatch) only — never self-initiated because the
  context feels long; that recommendation belongs to `next`.
- **Handoff doc** — the durable brief `thread:handoff`, its only writer, writes
  on explicit fork intent only (Lachy's ask, or a router's dispatch; never
  self-initiated) to `<home>/docs/handoffs/<date>-<slug>.md` and commits
  and lands (pushed, merge queued, never waited on) —
  `<home>` the unit directory: the project dir under `~/Projects/`, the
  workspace dir under `~/repos/workspaces/`, else the git toplevel.
  Lifecycle `pending → consumed → deleted`: marked `status: consumed` at
  pickup, deleted in the consumer's close-out commit; git history is the
  archive, so the working tree lists only in-flight handoffs. One doc, one
  consumer. Never OS temp, never the vault (ADR 0017). A doc with no `status:`
  front matter is **legacy** — listed by `close`, never touched. _Avoid_: temp
  doc, compaction file, handoff note.
- **Continuation** — the part of a thread's follow-up that the next session,
  working from a pending handoff doc, would do. While the doc is pending,
  `close` routes it to the doc (refreshing it in place) and never to a vault
  task. Its complement is a **loose end** — work outside the thread's scope
  line — which reaches the task menu as before (ADR 0017). _Avoid_: next
  steps (ambiguous), remaining work.
- **Capture** — the self-contained vault task `stash` or `defer` writes to set
  a thread's next move down, marked as a capture by its writer
  (`capture: continuation` in its frontmatter). Only a marked capture is
  superseded when the thread continues elsewhere; an unmarked one is left open
  and reported. A loose end filed at
  `close` may link the same thread and is still never a capture. _Avoid_:
  thread task (any task can link a thread), backlog item.
- **Close** — the work is finished; persist + commit, end-of-thread ritual.
  For vault tasks close only proposes, with one exception: it marks a task
  this session explicitly worked `done` without asking when the work is on
  the default branch (or is not code) and its Verify line ran green; a task
  short of that becomes a mark-done question (ADR 0026). Close also lands
  what it can: it pushes the close-out and queues its merge, and reviews the
  session's own branch before queuing its merge.
- **Landing** — taking a session's committed work all the way to a merged
  default branch and a clean checkout: push, PR, review, fixes, CI retries,
  merge, cleanup. Agents own it end to end and take as long as it needs;
  Lachy is asked only for a decision no agent can make. _Avoid_: shipping
  (a release), publishing, admin.
- **Landing register** — the one estate-wide list of repos agents must never
  push to on their own. Any repo Lachy can push to lands unless the register
  names it. _Avoid_: allow-list (it is a deny-list), push list.
- **Own branch** — the feature branch whose work this session did. Close may
  push, review and merge it; a branch close can't prove is its own is only
  reported. _Avoid_: current branch (it may be another session's), my branch.
- **Blocking finding** — a review finding the **Checker** reproduced, that
  the change introduced or worsened, and whose failure scenario is a crash,
  hang or wrong result on a path the branch ships for normal use, data loss or
  a security hole on any path it ships (on an error path only with an ordinary
  trigger or one the change causes), or the named test failing. Only a
  blocking finding holds an own-branch landing; the rest are filed in its
  follow-up task (an unconfirmed one too) or rejected, and a clean round is
  one with none, unless it returned its cap or more, which earns one more code
  round first. A landing has three code rounds; one still open on the third
  is fixed until its reproduction passes, with no further review (ADR 0058,
  ADR 0065). _Avoid_: accepted finding, must-fix, high (the reviewer grades no
  severity).
- **Checker** — fresh-review's confirm step (its ADR 0001): a second fresh
  agent that gives each finding of a round its verdict (`blocking`,
  `unconfirmed`, `filed` or `rejected`) and writes a failing test, its
  **reproduction**, for each blocking one, which is committed with that
  finding's fix. It adds no findings, so it is not a second review. Close and
  a Leg take its verdicts and grade nothing (ADR 0065). _Avoid_: verifier
  (the rollout engine's), grader, judge.
- **Close-out PR** — the pull request carrying close's own bookkeeping
  (THREAD.md, handoff-doc refreshes and deletions). Its merge is queued at
  close and happens on green, with no review. _Avoid_: docs PR, thread PR.
- **Pickup** — resuming a stashed/deferred thread from its task, or a handed-off
  thread from its handoff doc. Pickup auto-completes the capture — the task is
  marked done, the handoff doc consumed: the capture's job ends the moment the
  thread is live again.
- **Set-down** — any route that puts a thread's work down: `stash`, `defer`,
  or `close` when the thread has a concrete next task (`/thread:open save` is
  not one). The only agent writer that overwrites the two next-action fields;
  the most recent set-down wins, and Lachy may edit either field any time.
  Defined estate-wide in `~/repos/workspaces/_shared/CONTEXT.md` § Next action
  (estate ADR 0008). _Avoid_: park (a project status), save.
- **Next action** — a task's `next_action:` (estate ADR 0008): one line,
  verb-first, one physical action. A set-down takes it from the resume
  prompt's `Next move`, or close from the next step it writes into THREAD.md.
  _Avoid_: next step (vague), todo.
- **Next task** — a project note's `next_task:` (estate ADR 0008): one
  wikilink naming the task that is up; the project shows that task's next
  action and holds no text of its own. A set-down points it at its task
  (stash and defer: the capture; close: its concrete next task); `orient`
  fills it only when blank. Area notes carry none. A link to a done, merged,
  dropped, archived or missing task is a **dead link**: read as blank
  everywhere, and no sweep or pickup clears it — it stays until the next
  set-down, a fill-blank writer or Lachy replaces it. A live link whose task
  note cannot be read reads *unparseable*, with its why, and is never filled
  over. A parse error's why carries its line and key, and orient mends one
  whose cause is a plain value (an unquoted `: `, say); an unclosed or
  non-mapping frontmatter, or an unreadable file, carries neither and is left
  for Lachy. _Avoid_: up next, focus task.
- **Now** — a project note's `## Now` section: the few current lines of the
  thread it names, opening `As of <date>, from the thread:`, above its
  closing Next task / Thread / History line. Lachy writes it by hand too;
  close's Now refresh is its only agent writer (`task-writer.md` § 4b,
  Close's Now, through `next-action.py now`). The refresh replaces only the
  run from that dated opener, never a hand line that merely opens `As of `,
  and only when the lines it keeps (the closing Thread link, in practice)
  name the closing thread's file; it never adds a Now to a note that lacks
  one. _Avoid_: status, Now / Next.

## Memory capture (close-side)

- **Four-verb triage** — the save-time resolution of every memory candidate
  against existing memory: `ADD`, `UPDATE <file>`, `SUPERSEDE <file>`, or
  `NOOP`. NOOP is a success state, never a failure to capture.
  _Avoid_: save/skip, dedupe pass.
- **Provisional** — an auto-saved memory not yet corroborated; the curator
  promotes it to active on a later recall and archives it if none comes.
  _Avoid_: draft, pending, tentative.
- **Provenance** — who initiated a memory: `close-inferred`, `user-explicit`,
  or `legacy`. Sets the prune bar (explicit saves are harder to cull).
  _Avoid_: source, origin.
- **Recall** — a live session Reading a memory topic file; the usage signal,
  harvested daily from session transcripts. Index loads never count.
  _Avoid_: hit, access, view.
- **Curator** — the weekly autonomous pass holding sole destructive authority
  over memory (promote, expire, decay-archive, merge, demote, rebuild
  indexes). Lives outside this repo; close only writes what it reads.
  _Avoid_: garbage collector, janitor, cleanup job.
- **Permanent** — the exemption class never recency-culled: identity, health,
  hard constraints. _Avoid_: pinned, sticky.
- **Demotion** — the curator verb moving a global memory to the one workspace
  whose sessions actually recall it. _Avoid_: downgrade, relocation.
- **Seat** — the workspace altitude of a METHOD ledger,
  `~/repos/workspaces/<workspace>/knowledge/METHOD.md`; defined in
  `~/repos/workspaces/_shared/CONTEXT.md` § Method. _Avoid_: workspace method.
- **Estate** — the everywhere altitude,
  `~/repos/workspaces/_shared/knowledge/METHOD.md`; defined in
  `~/repos/workspaces/_shared/CONTEXT.md` § Method. _Avoid_: global method,
  org method.
- **Process observation** — the category-7 scan (close, stash and defer): a
  stage-shift, pivot, reusable move, revealing failure, or cross-workstream
  effect in *how* a project is being made. Stage-gated; routed by altitude
  (project / seat / estate) via the method skill's routing test. _Avoid_:
  learning, insight, retro item.
- **METHOD.md / Candidates** — the per-altitude surface (ADR 0012, 0015; owned
  by the `method` skill in agents-config) the category-7 scan (close, stash and
  defer) appends process observations to. Candidate rows carry their own
  six-token status vocabulary
  (`[provisional]`/`[confirmed]`/`[rejected]`/`[deferred]`/
  `[contradicted]`/`[correction]`, the last an annotation on another row — not
  an observation, never clustered) — deliberately distinct from the memory
  frontmatter's provisional/active/superseded, which describes memory files,
  not candidate rows. Those writers write candidates only: nothing enters the
  gate-protected `## Method` section, at any altitude, without an interactive
  `/method` apply Lachy has ruled on. _Correction 2026-09-15 (evening)_: a
  `/method` pass under the skill's working agreement — routine curation automatic,
  scheduled headless from the daily sweep, only consequential exceptions ruled by
  Lachy in the pass's vault task (workspaces ADR 0003, second amendment); the
  candidates-only rule for these writers is unchanged. _Avoid_: process ledger,
  retro doc, processes.md.

## Planning structure (rollout lane)

- **Task** — one PR-sized, independently-shippable unit, written as a single
  Obsidian task note (`Work/Tasks/<project>-p<N>-<M>-<desc>`,
  `tags: [task, …]`). _Avoid_: ticket, item, story, step.
- **Phase** — a project's roadmap tier: an ordered milestone (P1, P2, …) whose
  tasks carry `phase: N`. A human planning concept only: phases order meaning,
  the queue orders runs, and the engine never reads `phase:`. One phase = one
  rollout by convention. A phase is a plan, never a task (ADR 0005).
  _Avoid_: stage, iteration.
- **Vault grammar** — the phase/task filename pattern (whole or fractional phase
  numbers, `p3`, `p3.5`) and the status sets (landed, active, review, hold, in
  flight) the vault's readers classify by, defined once in
  `skills/_shared/vault-grammar.md` (its § Readers lists every reader).
  _Avoid_: naming scheme.
- **Reshuffle** — the usual reason a project is picked up after time away:
  re-examine *all* its open work (stray bugs, brain dumps, loose tasks and
  unstarted phases alike), rethink what the next steps are, and leave it
  shaped for the lanes (cluster proposal → grilled meaning → mechanical
  writes). Scoped to one note, it turns a single plan or design into tasks.
  A bare look-around with no reshaping is the rarer case. Replaces the former
  gather (loose tasks → phases, existing roadmap fixed) and split (plan →
  tasks) passes. _Avoid_: gather, split, re-plan, re-triage, backlog grooming.
- **Clear / unclear item** — a reshuffle's first sort of every open item.
  Clear ones (the body already says what to do) go straight to the gate;
  unclear ones (brain dumps, one-liners) are grilled, cluster by cluster,
  highest value first. The grill may stop at any point: what is resolved is
  written, the rest stays loose for the next reshuffle. _Avoid_: triage.
- **Brain dump** — a loose task note holding raw, unspecced intent, often
  several ideas at once. A reshuffle **unbundles** it: one task per idea, each
  grilled into a real body. _Avoid_: capture (that is stash/defer's task).
- **Reach tiers** — what a reshuffle may change, by an item's state: **in
  flight** and other **frozen** items (possibly landed, thread captures, decision tasks) are
  context only (schedule may still re-queue an in-flight task when a
  superseding rollout takes it over); **unstarted** phased work is movable; **loose** work is fully
  open, including re-homing and pull-ins across projects. Defined in
  `skills/orient/reshuffle.md` R1. _Avoid_: locked, pinned.

## Rollout structure

- **Rollout** — a backlog of related tasks landed as one coordinated effort,
  described by one always-dated Obsidian note
  (`<slug>-rollout-<YYYY-MM-DD>`) whose **Shape** is parallel or serial. At
  most one parallel rollout is **unfinished** per repo and project, each
  project's in its own **Rollout clone** (ADR 0064), and none rooted in place
  in a checkout a live serial chain works, whose index and HEAD it would share
  (ADR 0042, ADR 0067); new parallel-shaped work of the same project
  supersedes it rather than running beside it (schedule § 0, ADR 0027, ADR
  0030). Serial rollouts are
  ordered by **Surface**s, not by repo (ADR 0040, ADR 0067 d4): one chain per
  note; a chain sharing a live chain's surface is scheduled and takes turns
  with it, and only an unfinished parallel rollout's root refuses one. A clash
  is only two runs editing the same file or note, in either shape; sharing a
  repo, a monorepo or the vault never blocks a schedule. While a fresh reading
  is in force, **Capacity** is the limit (ADR 0067 d8); the **Trickle** and
  the **Away cap** are its fallback.
  _Avoid_: batch, run, campaign.
- **Shape** — whether a rollout runs in parallel or in serial; the one word
  that tells the two kinds apart. Every rollout verb (schedule, execute,
  status, repair, reflect) takes either shape. A rollout note says it with its
  `shape:` key, `parallel` or `serial`; a note with no `shape:` key (every note
  before p24-2) reads as parallel. A supersede never crosses shapes. _Avoid_:
  mode, lane (a lane holds both shapes).
- **Parallel rollout** — a rollout run as a **Queue**: each task in its own
  worktree-isolated agent, landed as its own PR through Integration. Every
  rollout before 2026-10-19 is one.
- **Serial rollout** — a rollout run as a chain of **Legs**: visible,
  interactive sessions that each work tasks themselves, close, and hand the
  rest to a fresh successor. No task worktrees (leg.py's transient scratch
  revert, and the completion verify's detached verify tree outside the
  checkout, only; each repo's **Chain copy** is the chain's, never a task's),
  and no subagents but each task's clean-room review. One chain
  per note (schedule § Serial path): its `surfaces:` predicts the **Surface**s
  the chain writes, and each `## Queue` row names the launch its Leg opens in, so a
  launch change between two rows is a Leg boundary. A row that writes a
  checkout never opens in the vault, and a row commits only to the checkout
  it launches from: one whose `repo:` surfaces name another checkout, or an
  alias-less one naming two, is refused (ADR 0059, ADR 0074 d3), since a Leg
  finishes only its own checkout's commits and its review cannot leave the
  Session's cwd. Each repo it writes is worked in its own **Chain copy**
  (ADR 0067 d2: `chain_copies:` on the note, which schedule stamps on every
  note it writes, ADR 0075 d4; only a note written before that, without it,
  works in place), whose commits `leg.py land` puts on the primary checkout's
  default branch task by task, after each `done` and at each close (ADR 0067
  d3).
  execute runs its Legs
  (`skills/execute/legs.md`). A serial note is never paused: a Leg stops through
  `leg.py close --outcome stopped`. status reads it as a chain (`leg.py status`:
  its Legs, its chain state, a **Stalled chain**), repair restarts it, and its
  Complete scores it into one close line (serial-score.py). Its Complete runs
  a declared `completion_verifier:` on the chain checkout's HEAD (ADR 0055).
  _Avoid_: relay
  (Chorus's word for sending a command to a session).
- **Serial chain** — the rows of one serial rollout note, worked in order by
  its Legs. ADR 0074 d1 makes it one per project per schedule run: a
  project's serial members (by their first `projects:` link) share one chain
  whatever their surfaces, worked by one Leg at a time; a member with no
  project is grouped by surface and dependency alone; a set-aside row never
  holds the rows that do not depend on it; and two projects' chains still run
  side by side (ADR 0067 d4, d9). ADR 0074 d3 (proposed, to be built by Phase
  42) also refuses any row that commits to a checkout other than the one it
  launches from, read-only reach still allowed; until it lands, only the
  refusals **Serial rollout** names apply.
- **Leg** — one session's part of a serial rollout (`skills/execute/legs.md`).
  In order: execute's git-env check, `leg.py begin`, the preflight (the
  launch's required tools answer), the smoke test (the Verify line of every
  finished task no later Leg has checked yet: the previous Leg's, and a lost
  or stopped Leg's unchecked list), any task its predecessor left claimed, the
  fix tasks, then new tasks claimed one at a time: up to five fresh claims, the
  inherited task aside, fewer when its context grows heavy or a task proves
  large, and never closing mid-task. Each code-writing task gets one clean-room
  review before it is done. Its close ritual lands its close-outs commit-only,
  then hands the rest on (legs.md § Hand over): on the Chorus Stage it opens no
  successor but lists the chain on the **Waiting list** (`leg.py handed
  --listed`), and the Stage opens the next Leg when there is room; Codex
  Desktop starts it as a task, and anywhere else it is a labelled manual
  hand-over. It ends on a `ROLLOUT-STATUS:` line. A Leg whose Close reads
  *closed* reports to the origin (Leg 1, started by hand or from a card),
  but a Leg the Stage opens from the Waiting list is no card's and reports
  nowhere (a listed hand-over's Close archives), and off the Stage none
  reports (legs.md § Report). A Leg whose Session died is taken over, or its
  stalled chain restarted, by `/thread:repair`, which never runs a Leg itself:
  on the Stage it lists the chain (`leg.py restarted --listed`) for the Stage
  to open, and only a take-over, Codex Desktop, a run off the Stage or an
  engine snapshot from before `--listed` starts the next Leg as a new Session
  (repair § 7 (e)). _Avoid_: shift, stint, iteration (one task in a Ralph
  loop), batch.
- **Stalled chain** — a serial chain with claimed work and no Leg open: a task
  in progress for a Leg that closed (stopped, or halted and since cleared) or
  never began, and nothing starts the Leg that inherits it. `leg.py status`
  sets its `stall` field; its chain state reads `stalled` only when no earlier
  state matches, so a Leg that stopped holding a claim reads `stopped` (and a
  standing halt `halted`), the `stall` set beside it. `/thread:repair`
  restarts it once nothing shows a Session still holding it: on the Chorus
  Stage by listing it on the **Waiting list** (`leg.py restarted --listed`),
  elsewhere by starting the next Leg as a new Session (repair § 7 (e)). An
  open Leg whose Session died reads live, never
  stalled, until a take-over closes it `lost`: leg.py never reads the Stage,
  so repair's `list_sessions` check is what finds that Session gone. _Avoid_:
  hung, frozen.
- **Surface** — a place a serial chain is predicted to write, written as a
  token in a serial note's `surfaces:` (and in a task's own, optional
  `surfaces:`). Six kinds: `repo:<toplevel>//<path in it>` (a file in a git
  checkout, or a folder with a trailing `/`; the toplevel is the in-place
  twin's, so it reads the same from any copy), `repo:<absolute path>` (bare: a
  whole checkout or a path in none, overlapping on equality or containment at
  a `/`; a bare `repo:<toplevel>` covers every file under it), `vault:<path>`
  (vault-relative; overlaps on a segment-boundary prefix), `vault` (the whole
  vault; overlaps every vault token), `ext:<name>` (an external system such as
  a CMS or DNS zone; case-folded equality) and `any` (overlaps every token).
  Two file or folder tokens meet only in one checkout, when one path contains
  the other, so sibling files never clash; all compare case-folded. Kinds
  never overlap one another, save `any`. A path becomes a token by
  `serial-chains.py`'s claim, at its own depth, declared or derived: the vault
  is a note space, so a path in it claims `vault:<rel>`; a path inside a git
  checkout claims that file or folder, and its toplevel the bare token; a path
  in no checkout is claimed path-only. Reach is not prediction (ADR 0067 d4):
  a member's launch folder, its launch commands' `--add-dir` and `cd` paths
  (fenced or not), its first project's `Local:` and the value of a `## Launch`
  where-label such as `**Repo:**`, at any depth, only name the checkout it
  works (its `works`), and predict nothing there; one that only reaches a
  checkout claims its own task note, with a WARN. A member's predictions are
  its declared `surfaces:` (its whole claim), else the other paths its
  `## Launch` names below a toplevel and its `touches:`; a surface added at
  schedule unions in. A member whose path is the vault root, or that reaches
  no checkout and has no
  other claim, claims its first project's place (a folder note's folder, else
  the note and the folder it would become) and its own task note, never the
  whole vault. Bookkeeping is never a claim: a path under `Work/Tasks` (ADR
  0059) and the ledgers every run appends to, `_shared/state/thread-events/`
  and `docs/reviews/` (ADR 0067 d5). With no project and no path, `vault`
  alone (the default, with a WARN). The guarantee and its limit: a member
  claims what it names (reach aside), never
  its launch profile's other Working roots (a workspace launcher's
  `add_dirs`), another project's `Local:` or a project's `repos:`, nor a repo
  or external system it writes but names nowhere: declare `surfaces:` for
  those. A `## Launch` path that is `/` or the home directory is never
  claimed (it would contain every repo; a WARN names it). Two checkouts of one
  origin are two surfaces, and containment parts across a checkout nested
  inside another by path (a separate repo with its own index), unless the outer
  path is in no checkout. Predicted surfaces group, order and wait, and never
  refuse a schedule: two chains predicting one place both run, the first to
  begin going first. Two chains in their own **Chain copy**s meet only file
  to file (a bare `repo:<toplevel>` cell in one stands only an in-place
  peer, never another copied chain's begin, ADR 0075 d4), while a chain
  that works a checkout in place (no `chain_copies:`) still takes its checkout turn: the one that comes first (the first to
  begin, else by slug) lands every unlanded row it has there before the other
  begins a Leg in it (ADR 0067 d4). A stuck chain holds only
  its unlanded rows' surfaces (**Unfinished rollout**, ADR 0060), and works
  no checkout. The files a Leg actually committed are its actual **Claim**s,
  checked before it lands (ADR 0067 d4); a vault project's place is a
  prediction, and two runs in one note are a **Note overlap**. _Avoid_:
  footprint, file-set.
- **Claim** — a place a run writes, as a **Surface** token. Predicted claims
  are made at schedule (the declared `surfaces:` and the paths a task names)
  and group, order and wait, never refusing a schedule. Actual claims are the
  files a Leg's `Task:` commits touched since `leg_base`: `leg.py done` stamps
  them on the task as `leg_claims:` (`repo:<primary toplevel>//<path>`,
  bookkeeping aside), and `leg.py land` checks them against other live
  chains' unlanded files before it lands, the earlier chain going first (ADR
  0067 d4). The backstop is git's merge at the land plus the re-run Verify
  lines, which catch a clash across files. Not `leg.py claim`, which takes a
  task. _Avoid_: lock, reservation.
- **Chain copy** — a serial chain's own working copy of a repo it writes (a git
  worktree of the primary checkout on `chain/<rollout-slug>`, at
  `~/.local/state/thread/chains/<repo-name>-<rollout-slug>/`, outside `~/repos`
  and `~/Projects`), so two chains in one repo share no index or HEAD (ADR 0067
  d2). Schedule's S5 makes it with `leg.py copies` and records it on the note
  as `chain_copies:`; `leg.py begin` remakes a deleted one on its branch and
  fast-forwards a clean one to the primary's default branch on a fresh Leg,
  whatever the primary has checked out.
  It links the primary's gitignored `.mcp.json` and
  `.claude/settings.local.json`, and each Leg-facing folder (begin's launch
  check, the hand-over, repair's restart) maps into it. A note with no
  `chain_copies:` (one written before copies) works each checkout in place.
  `leg.py land` merges the primary's default branch into
  `chain/<rollout-slug>` after each `done` and at each close (never a
  rebase), then fast-forwards the primary to it, never stashing, under a
  per-repo lock (ADR 0067 d3); after Complete, `leg.py land --retire` removes
  the copy and deletes its branch with `-d`, never `-D`.
  Never a **Rollout clone** (a parallel rollout's) and never read as a thread.
  _Avoid_: chain clone, chain worktree, sandbox.
- **Note overlap** — two live runs editing the same vault note while both
  tasks are unfinished. The later edit is never held or refused: its agent is
  warned which run is in the note and to re-read it first, and every overlap
  is recorded for the weekly Reflection (ADR 0067 d6). The plugin's
  PreToolUse hook (`hooks/vault-note-overlap.py`) records each run's writes
  and gives the warning; each warning is a `note-overlap` line in the Run
  record's `overlaps.jsonl`, and the weekly reading's `noteOverlaps` reports
  the week's, or `none`. Another run is another rollout (decided, ADR 0067's
  Decided for Lachy 9): two tasks of one rollout in one note are not warned.
  Best-effort, and these misses are accepted: a script's, a shell's or a Codex
  Leg's write, and an edit by a session that is no run's task (an interactive
  session, a lead's own thread, a subagent a task agent spawns). _Avoid_: Note
  wait, note lock, lease (alone).
- **Estate rank** — the place `/thread:orient-all` gives a rollout note it
  dispatches, stamped as `estate_rank: <n>` and `estate_rank_at: "<pass time>"`
  by `estate-dispatch.py rank-stamp` (ADR 0067 d9). Each pass re-stamps every
  live rollout in its current order, then its own new ones by their best
  member's grade rank, 1..K under one pass time: a later pass ranks above an
  earlier one, a live run keeps its place ahead of a pass's dispatches, and a
  full pass never flips a live pair. A re-stamp that cannot write a note stops
  there, so the order still stands (a stamped prefix carrying the newest pass,
  an untouched suffix keeping its old keys), and orient-all runs it once more.
  It leads leg.py's `order_key`, after the tier of whether a chain has begun: a
  chain that has begun before one that has not, then the estate rank (a stamp
  before none, a later pass, the lower n), then the first to begin, or for a
  never-begun chain the earlier `captured:`, then slug. A standalone schedule
  is unstamped, below every stamped rollout in its tier. Aging never enters it.
  _Avoid_: priority, grade (the readiness grade is another thing).
- **Rank wait** — two serial chains in Chain copies meeting on a code file at
  `leg.py claim`, wait-die by rank (ADR 0067 d9; leg.py's *The rank*). A chain
  that ranks above a running holder of the file waits for that task to finish
  and land, then goes first (`next` is `wait` of kind wait); one that ranks
  below sets its row aside to retry, keeping its rank, and claims another (kind
  retry); a chain whose own unlanded row would stand behind an earlier chain
  that is landing waits for that land (kind land). `leg.py wait` logs a `rank
  wait:` or `rank retry:` line, which stands until the task's claim or the
  Leg's close: a standing line reserves its task's file (a lower-ranked claim
  there dies) and ages its chain, lifted a place per hour. A holder with no
  open Leg is not running and is never waited on: it sets the row aside when it
  ranks above (a chain left with only such rows closes stopped, and its next
  begin waits on that holder), and holds nothing when it ranks below. Every wait
  is bounded at 180 minutes. Nobody is stopped mid-task. Only code files and
  `any` rank-wait: the vault and `ext:` never do (d6). _Avoid_: lock, lease,
  preemption.
- **Begin wait** — a Leg that cannot begin yet, waiting (ADR 0075 d1 as ADR
  0076 d2 amends it; built by P41-3). Two causes: a surface re-check left
  unanswered on a busy Mac (60 s, then once more at 180 s), and another
  rollout's hold on a place this Leg would write (a surface stand, ADR 0060).
  `leg.py begin` ends `state=waiting reason="begin wait: …"` (exit 3,
  `beginWait`) with nothing written, never `halted`. No session polls the
  check and no marker records it. A chain the **Waiting list** lists once
  begin has written nothing (begin's `listed`: stamped `start: unattended`, a
  chain state on the list, no Leg session standing) stays on it (ADR 0076
  d2). A listed begin wait, of either cause, ends that session (P44-3): its
  turn ends on the `waiting` line and it runs nothing more, holding no Leg and
  no place in the room, and the Stage begins the chain again, in a fresh
  session, from the list once its way is clear. Any other begin wait is a
  needs-you item, its `unlisted` saying why: a chain with no
  `start: unattended` or in a state off the list, one whose Leg session
  still stands (the successor of a started hand-over, a standing
  restart `pending` or `started`, a take-over's open Leg), which `waiting`
  keeps off the list and counts against the room (ADR 0076 d3), or one whose
  last Leg handed over by hand (P44-4). It waits on
  `/thread:execute [[<slug>]]` instead. A listed restart (repair's
  `restarted --listed`) holds no session: its chain stays on the list. A Leg never begins without a
  passing check: a check still unanswered after its longer retry reads
  `unanswered`, never a pass and never a refusal. Every other begin refusal
  stays a halt, a check that fails included. Parallel execute's version is a
  **Surface wait**. Not a **Rank wait** (two begun chains meeting at a claim).
  _Avoid_: begin halt, surface halt, retry loop.
- **Surface wait** — a parallel rollout whose own Surface re-check (execute §
  4.5) refused (exit 3: a serial chain, or another project's rollout in its
  clone, now holds its Project root) or went unanswered (exit 4: the check's
  240 s deadline cut it), waiting instead of halting (P41-3; ADR 0060 d5 as
  P41-3 amends it). Its marker,
  `~/.config/thread/leases/<rollout>.surface-wait.json`, is written and
  deleted only by that check (`unfinished-rollout.py check --surface-wait`),
  which needs `--running`, the lead's live calls (without it, exit 2 and the
  marker untouched). It never lapses: a rollout with one launches nothing, so
  a dead lead's marker holds only what it already held, until the next entry's
  check. While it stands, `next` holds every start, restart, seeded revise and
  Integration not yet begun (`surface wait: <why>`), and `mark-started` and
  `mark-integrating` refuse them in the engine; only the calls in flight and
  an Integration already begun (`integrating:`) go on. A pause still wins. On
  the **Origin lane**, its task not yet integrating neither holds the lane nor
  waits in it. A parallel rollout idle in a surface wait (no call in flight
  that its marker lists, no task integrating) holds no Project root against
  serial chains that read the marker: it launches nothing until its own
  Surface re-check passes, so no cycle forms. A serial chain stamped with an
  engine snapshot from before P41-3 keeps it until one of its Legs closes
  `stopped:` (ADR 0043's move rule), and reads no surface-wait marker
  meanwhile: every serial resume read of such a chain (begin's re-check,
  `check --resume`, the Waiting list) reads each parallel rollout by the old
  rule, never the marker's release. So while such a chain reaches a parallel
  rollout's Project root, that rollout's Surface re-check halts on a refusal
  as it did before (exit 5, `surface held: …`, § 7) instead of waiting, and
  the old rule skips a halted, idle rollout: no cycle forms. A check cut by
  its deadline (exit 4) reads no chain, so it writes the marker whatever chain
  reaches the root: the Waiting list then holds a chain on an engine snapshot
  from before P41-3 that reaches it, so the Stage never starts one, and one
  begun by hand halts at begin (`surface held: [[<rollout>]] holds <token>`),
  as it would have while the rollout ran, until Lachy begins it again. Before
  P41-3 an unanswered check halted the rollout (exit 2), so such a chain
  skipped it and began; now it waits for the rollout's next answered check,
  which passes, or refuses and, while that chain still reaches the root, halts
  (exit 5). `moving` reads it `waiting surface-wait`, judged by silence.
  _Avoid_: surface halt, surface hold (a pre-P41-3 halt).
- **Live rollout** — a rollout note directly in `Work/Tasks/` (not under
  `Archive/`), whatever its status. Location only: reconcile-project.py's
  `resolve_rollout` and close's owner exclusion read a task's rollout as live
  this way. _Avoid_: active rollout.
- **Unfinished rollout** — a live rollout that is neither `done` nor `dropped`
  and still has a task not merged (or no task yet): the one parallel rollout a
  repo may hold at a time for each project, each project's in its own
  **Rollout clone** (ADR 0064), which schedule § 0's unfinished-rollout check
  enforces. A serial rollout is unfinished the same way, and both shapes meet
  in the same check: a parallel run rooted in place in a checkout an
  unfinished serial chain works is refused, and so is a serial chain whose
  **Surface** or checkout meets an unfinished parallel rollout's Project root;
  a chain whose surface overlaps a live chain's is scheduled and takes turns
  with it (schedule § Serial path, ADR 0067 d4). Vault chains in different
  project places never overlap, so they run side by side (ADR 0059). What an unfinished rollout holds narrows while it
  waits on Lachy (ADR 0060). A stuck chain (no Leg open, nothing claimable:
  every unlanded row set aside or held behind one) holds only its unlanded
  rows' surfaces, and releases the rest, its done rows' included; it works no
  checkout, since it uses no index or HEAD. A parallel
  rollout awaiting sign-off, or halted with nothing able to start, holds no
  Project root against serial chains, nor does one idle in a **Surface wait**
  (against a chain that reads the marker), though it is still its project's one
  unfinished parallel rollout on the repo. Each reclaims its whole claim on resume, and
  waits its turn for a place another rollout took meanwhile: whoever released
  a place yields it to a chain free to run (ADR 0067 d4's order, rank-led by
  d9, breaks the rest, so no wait closes a cycle). It is narrower than live: a superseded
  note stamped done but not yet moved is live but not unfinished, and so is a rollout whose
  every task merged before its completion ceremony ran. `--regenerate`
  supersedes this project's unfinished rollout when it is paused or never
  started. _Avoid_: live (for this meaning), active, open.
- **Supersede** — a new rollout taking over an unfinished one: every unlanded
  task carries over (a `review` task with an open PR awaits Integration, an
  open one is queued, a running or set-aside one keeps its state), and merged
  tasks stay with the old note. The old note closes last, after the new
  rollout's tasks are stamped, with `superseded_by:`, and is filed in
  `Archive/Rollouts/`. A protocol-3 rollout in flight migrates this way, once
  hard-paused (ADR 0030). Same shape only: a serial run supersedes nothing
  (p24-2), and a parallel run never takes a serial note. _Avoid_: migrate
  (alone), replace.
- **Incomplete rollout** — a never-started rollout that must not run as
  written. Either it carries `incomplete: true`, which every rollout note is
  born with (schedule step 6, or S5 on § Serial path) until step 7's last
  write (S6's) removes it once every task is stamped, and which schedule § 0
  stamps on the note an interrupted supersede wrote; or its `supersedes:`
  names a rollout still unfinished beside it. The queue refuses to start it.
  Once its run has stopped, the stamp on a parallel note needs a supersede to
  end it, and the stamp on a serial note, which a supersede never takes, ends
  only by `status: dropped`; closing out the `supersedes:` target ends the
  other reason. A task taken out of a rollout never makes it incomplete.
  _Avoid_: half-written, broken.
- **Wave** — a set of tasks safe to run together because none shares a file
  (ADR 0009). Retired by ADR 0030: see **Queue**. Its fit-test adjective
  **Wave-shaped** is now **Parallel-shaped**. _Avoid_: round, phase, stage.
- **Queue** — how a parallel rollout runs: tasks in parallel, each from its
  start's `main`, up to the parallel ceiling, held back only by dependencies
  or a **Solo** task and, by day, the **Trickle**, never a shared file
  (ADR 0030); Away, by the **Away cap** instead of the Trickle (ADR 0049),
  and, toward the Morning, the **Last starts**; and all of them by a bare
  checkout's **Git-env hold** (ADR 0046) and a hot Mac's **Heat hold**.
  _Avoid_: batch (the session lane's).
- **Slot** — one task's own run (a start, a restart or a seeded revise) in a
  Queue, held from its launch until its result is reconciled. Integration
  holds none. _Avoid_: worker, agent (a slot's run holds many agents).
- **Parallel ceiling** — the most Slots a Queue holds at once, set per
  rollout. Not the retired model-tier **Ceiling** (see **Top rung**).
  _Avoid_: bare "ceiling", concurrency, max agents.
- **Capacity** — the most Rollout tasks, Leg task claims and full suites that
  run across the whole Mac at once, rising and falling on its own with heat,
  memory, load and each Login's quota: Chorus writes the reading
  (`~/.config/thread/capacity.json`) and `next`, `leg.py` and the verify slots
  read it, clamped to `capacity_max`. While it is in force it takes the
  **Trickle**'s and the **Away cap**'s number, Legs count behind their
  **Lease**, and a lead or Leg whose Login is inside its line starts nothing
  new (the quota hold); a missing, stale or unreadable reading falls back to
  them, never to open (ADR 0067 d8; execute away.md § Capacity). A fresh
  reading's `stop_suites` (memory critical) also holds and stops slotted
  suites, as the **Heat hold** does, and a stopped suite restarts only once
  memory falls below warning. A Leg's wait for room is a `wait` of
  kind `capacity` (or `quota`), never a **Rank wait**. _Avoid_: governor (the
  mechanism), throttle.
- **Waiting list** — the one estate-wide list of serial chains that are ready
  to run but have no Leg session yet, because **Capacity** has no room or
  another rollout holds their files. A chain on it has no session on the Stage;
  it gets one only when it reaches the front and there is room, best
  **Estate rank** first. He sees it as one quiet line on the Stage (how many
  wait, which is next, how much room) that opens into the ordered list with a
  click, never as a command or a notification. A serial note's
  `start: unattended` is its place on the list, never cleared while the chain
  is unfinished. Only a writer on the Chorus Stage lists a chain (P44-4, ADR
  0076 d4): schedule S7 on a standalone run; the parent's `stamp-start` under
  orient, orient-all and the **Backlog orient**; a Leg's `handed --listed`;
  repair's `restarted --listed`. Off the Stage nothing lists it, and Leg 1 is
  a paste-ready prompt. A chain is listed or has a paste-ready prompt, never
  both, so a manual hand-over or a manual restart keeps it off the list, and
  a closing Leg (closed with a handoff, no hand-over line yet) keeps its chain
  off the list until its hand-over. Ruled with Lachy 2026-11-08,
  after `orient-all` left about 30 chains open as idle or stopped sessions
  with room for 2. _Avoid_:
  begin queue, backlog, queue (a parallel rollout's **Queue** is another
  thing).
- **Trickle** — while Lachy is not **Away**, the most Rollout tasks that run
  across the whole Mac at once, whatever the number of Rollouts: 2, unless
  Chorus sets another (Chorus ADR 0104 d2); while **Capacity** is in force its
  C takes the Trickle's number (ADR 0067 d8). _Avoid_: global ceiling, throttle.
- **Away** — Lachy has told Chorus he is away from the Mac (the Evening, an
  Away block, the Lunch restart; Chorus ADR 0104 d1); then the **Away cap**
  bounds Rollout tasks Mac-wide (ADR 0049), each Rollout still within its own
  **Parallel ceiling** (Chorus ADR 0104 d3). Never a reading of whether he is
  at the Mac. _Avoid_: idle, night mode.
- **Away cap** — while Lachy is **Away**, the most Rollout tasks that run
  across the whole Mac at once: a knob larger than the Trickle, sized so
  suites do not contend, tuned from the Run record (ADR 0049). Each
  rollout's **Parallel ceiling** still bounds its own share, and while
  **Capacity** is in force its C takes the Away cap's number (ADR 0067 d8).
  _Avoid_: night ceiling, global ceiling.
- **Lease** — a lead's stamp that keeps its Rollout's running tasks in the
  Mac-wide count (the **Trickle**, the **Away cap**), rewritten at its every
  `next` and loop entry: it lapses 45 minutes after its last write, or after
  the Mac's latest boot or wake if later, unless a room stop stands under its
  6 h bound, and a Rollout with no lease still counts (ADR 0049, amended). A
  serial chain's **Leg lease** (`by: leg`, ADR 0067 d8) keeps its Leg's claims
  in the count while **Capacity** is in force, and an open Leg counts at least
  one from its session's start, before its first claim (ADR 0076 d3). Its Leg
  rewrites the lease at its own leg.py verbs; the lease lapses 90 minutes
  after its last write (180 after a waiting turn end), and a Leg with no
  lease, or a closed one, holds nothing, so a dead Leg drops out. _Avoid_:
  heartbeat file, lock.
- **Trickle claim** — the room a lead's `next` holds in the **Trickle** (or
  the **Away cap**) for a start, or a seeded revise, it has picked but not yet
  stamped, so every other lead counts it. The stamp consumes it, and it lapses
  after 20 minutes. _Avoid_: bare "claim" (a Leg's task claim and a
  **Surface** claim use it).
- **Fair share** — the place a lead's `next` keeps free in the **Trickle** (or
  the **Away cap**) for the waiting rollout that holds fewest, then was served
  least recently, so a rollout that refills the moment its call returns never
  keeps a waiting one out. A lead the Trickle (or the Away cap) holds runs a
  **trickle wait** (`trickle-wait`, read-only), which returns within a
  20-second poll once another lead keeps it a place; one the **Heat hold**
  holds runs none, so it re-checks only at its heartbeat's tick or a call's
  return. _Avoid_: quota, per-rollout Trickle.
- **Last starts** — toward the Morning, a queued task starts only if its
  kind's usual length (the median of that kind's past runs in the project,
  its kind its note's `scope:`) ends it by the Morning's hour; with fewer than
  three past runs, nothing of that kind starts in the last two hours (Chorus
  ADR 0104 d4). They apply only while **Away** runs to the Morning, never to
  a daytime Away block or the Lunch restart. Running tasks finish: a restart,
  a hand-back or a seeded revise is never held, and the hold never halts the
  rollout. _Avoid_: curfew, cut-off.
- **Night record** — per Morning, the **Last starts**' held starts and the
  tasks still running at the Morning, written into each rollout's **Run
  record** and keyed by that Morning, so a **Reflection** can tune the
  two-hour fallback and the **Trickle** (Chorus ADR 0104's Consequences): it
  tells a fallback overrun (a kind with under three past runs) from an
  underestimate (a kind whose usual length let it start). _Avoid_: night log.
- **Heat hold** — while the Mac's thermal pressure reads heavy or worse, no
  new Rollout task starts, Away included, and no **Verify slot** is free; at
  trapping or sleeping a running slotted suite is stopped and put back in
  line, to restart once the Mac cools (estate ADR 0009 d5; execute
  `away.md` § Heat). A restart still waits on the ceiling alone, and the hold
  never halts a rollout: a heat stop or a wait it outlasts is no verdict,
  never red. _Avoid_: thermal throttle, cooldown (a retry's).
- **Solo** — a task in a Queue that runs with nothing else in flight: a
  sweeping change every concurrent task would otherwise redo its work around
  (ADR 0030). Queued with its dependencies met, it holds every task whose row
  is below it, whatever their `priority:`. _Avoid_: barrier, exclusive.
- **Integration** — the serial step between a task's approval and its merge:
  the latest `main` merged in, the verifier re-run and, when needed, a short
  re-review (ADR 0030). In plain English, a **merge queue** (GitHub's merge
  queue, bors, the 'not rocket science' rule): one approved change at a time,
  re-verified on the latest `main` before it merges; run by the lead, never
  GitHub's own merge queue, which merge-task refuses. _Avoid_: update-branch
  (GitHub's merge-in, which re-verifies nothing without CI), rebase.
- **Integration lane** — the one-at-a-time Integration step itself, held by one
  approved task at a time until it is released (a merge, a set-aside, a
  rejection or a halt); a rollout's merges can never outpace it. Execute's prose shortens it
  to "the lane". A **Git-env hold** that is not a bare checkout, an
  undecided RACE and a **Lane hold** hold the lane only (`next`'s `laneHold`,
  ADR 0046, ADR 0048): nothing integrates or merges while task calls go on. Across rollouts it is passed through
  the **Origin lane**. Not a **Lane** (rollout vs session). _Avoid_: merge queue
  (Integration's gloss: the whole step, never the lane alone).
- **Origin lane** — one Integration at a time per GitHub origin across rollouts
  (ADR 0064): two projects' parallel rollouts on one repo, each in its own
  **Rollout clone**, take turns. `mark-integrating` takes a rollout's
  **Integration lane** only while no other rollout on the origin holds its own
  (a fresh lease, its Run-record lane open on a task that holds the lane, no
  merge hold, no open halt, no `paused:` stamp, and, in a **Surface wait**, only
  while that task's Integration has begun (`integrating:`)), and passes it in
  turn to the rollout that has waited longest (its waiting list,
  `origin-lane.json`, where a rollout in a **Surface wait** waits only for an
  Integration already begun); a
  refused lead yields its own lane (`lane-freed release=origin`), and its
  **origin wait** (`origin-wait`, read-only) re-checks until its turn. A merge
  hold frees it; merge-task's base pin keeps every merge correct where two
  rollouts overlap. _Avoid_: merge train (ADR 0044's, never built).
- **Active Integration time** — an Integration's wall time less the **Stops**
  inside it that stop its calls (all but a halt, which carries them on): an
  `## Integration log` line's `active=`, beside its wall `duration=`. A Mac
  sleep the Run record does not hold yet (its line comes at the next `next`)
  is read from the Mac and comes off too. Where the Run record logs no stop
  inside it, the integrate call's journal gaps come off as well; a resumed
  call's replayed (`cached`) agents place no time, so its earlier run reads as
  stall, and a journal that places no live agent writes `active=-`. A
  Reflection prices the Integration lane by it, so a usage-limit stall is
  never lane work (p29-13). _Avoid_: duration (that is wall time).
- **Integration queue** — the approved tasks waiting for the Integration lane,
  in `next`'s order: a task a queued task depends on, directly or through a
  folded member (`merged_into:`), first, then the oldest `ready:`, then schedule
  order. _Avoid_: the lane (that is the step, not the line).
- **Inert path** — a file a repo's verifier provably never reads, listed per
  repo in the **Rollout settings** (`inert_paths`, git pathspec globs) and
  re-proven on the tree being merged at every skip: a `main` that moved only
  in inert paths, prose only (`.md .markdown .rst .adoc .org`, never
  `.txt`), since a green run leaves that run standing, and Integration
  re-runs nothing (ADR 0045). _Avoid_: doc-only, ignored path.
- **Inert proof** — the static check that nothing in the tree being merged
  reads a glob: no non-prose file or step names its deepest literal segment;
  no walk (a copy or archive of the tree included) whose root is not
  provably outside the repo (a path that is the repo, inside it or an
  ancestor of it counts) covers it; no markdown tool, link parse, symlink
  into the glob or submodule. It fails closed (ADR 0045): any error in it
  means a re-run. skills/_shared/scripts/inert-paths.py's
  header holds its rules. _Avoid_: the docs check.
- **Integration conflict** — Integration's merge of the latest `main`
  conflicted and the integrator could not keep both intents, so it aborted
  the merge and pushed nothing (Vibe Kanban's 'rebase conflicts'). The note is
  set aside at Integration under the marker
  `integration: conflict unresolved in <paths>`, with a resolution brief for
  the next integrator beneath it (the paths, theirs, ours, the integrator's
  account); status reads it as `integrationBlock: conflict` and the Run record
  as reasonClass `integration-conflict`. Distinct from a verifier red at
  Integration (`integration: verifier red: …`, `integration-red`); it
  re-enters at Integration like any set-aside there (p27-4). _Avoid_: rebase
  conflict, merge failure; a conflict Integration resolved is only a
  re-review trigger.
- **Flake** — a named test that failed any verifier run in a rollout, sits
  outside the task's diff, and passed when re-run by name and then when the
  full suite ran once more on the same tree: the verify counts green, and the
  Flake is logged and filed for its repo, never fixed inside the task
  (ADR 0050). "Outside the diff" is read by test file: the test is placed in
  a test file the task's diff does not change (a RACE re-verify's diff is the
  merged task's); a red that names no test, a test that cannot be placed in a
  file, or one in the diff is red at once, with no re-run. The named re-run
  comes first (any red again is red), then exactly one confirming full run.
  Each Flake is a `flake` Run-record event and a line in the `## Flake log` of
  one follow-up per (repo, test); a test logged as a Flake twice is the repo's
  to fix. Never a known baseline failure (schedule § 2.6: a test already
  red on a clean `main`, which execute's green criterion already allows
  for), nor a remote CI step merge-task's `infra_flake_rerun` re-runs.
  _Avoid_: flaky failure, quarantined test.
- **Named re-run** — the Flake check's first step: only a red's failing tests,
  re-run alone by name on the same tree before the one confirming full run
  (ADR 0050). At the lead's Integration verify and RACE re-verify it is the
  rollout's `named_rerun:` command, `{tests}` replaced by the tests, which
  schedule stamps from the project `CLAUDE.md`'s `Named re-run:` line; with no
  `named_rerun:` the lead's red stays red. An agent (an implementer, a
  reviser, an integrator) uses the repo's own test runner. It takes no verify
  slot of its own and never counts as an iteration. _Avoid_: retry, targeted
  run.
- **Verify base** — the `--diff-base` commit that `lead-integrate.py verify`
  exports to every step it runs (the env bootstrap, the verifier, the named
  re-run and the confirming run) as `THREAD_VERIFY_BASE`, resolved to its
  sha: `<mainSha>` at Integration and the merge commit's first parent at a
  RACE re-verify; it is never set at completion. A project whose verifier is
  a fast tier with a reach reads it as its base, so the reach is the task's
  diff even after merge-task refreshed `origin/<default>` (ADR 0062).
  _Avoid_: reach base, origin/main.
- **Completion verifier** — a rollout note's optional `completion_verifier:`,
  the full suite of a project whose `verifier:` is its declared fast tier
  (estate ADR 0009 d6): the completion ceremony runs it once on merged main,
  before the note reads done, under its own `completion_timeout:` (never the
  fast tier's `verify_timeout`). One process owns each attempt end to end
  (ADR 0052), and each run is classified from verify's structured outcome,
  never its log's text. A red is re-run once on the same tree:
  green there is a Flake, recorded with no task; red again, or verify's own
  deadline in the suite, files one fix task for the project, and the rollout
  completes either way, since its tasks merged green at their own Integration.
  A run with no verdict (no verify slot, verify never got going or was
  stopped, the bootstrap never let the suite run, the Mac was too hot for
  it) waits for the next tick, and three in a row halt (a deliberate stop
  and a **Heat hold** never count). A git-env trip
  inside its window gives no verdict either: the rollout halts on the
  git-env trip, or, when the trip was already acked, waits like the rest. A
  serial chain's runs on its one checkout's HEAD, in a detached tree outside
  the checkout, with no origin read and no git-env window (ADR 0055), and
  completes either way too, since each task passed its own Leg verify.
  A note with none completes as before. _Avoid_: final verify, post-merge suite.
- **Merge gate** — the checks a PR must pass before GitHub merges it into the
  default branch: the required contexts of branch protection and rulesets
  (ADR 0068, giflab ADR 0012 d4). Schedule step 2.5 reads it through
  `merge-gate.py` and sets it against the rollout's `verifier:`. A context's
  **closure** is the job it names, that job's transitive `needs:`, and the
  jobs of the local reusable workflow it calls. A **job class** is what a
  job's steps run: a lint or format check, a type check, a test tier, a
  build. A context is **compared** only when every counted job in its
  closure was read, with no read gap the script names; a partly read or
  unread one (another app's status, a remote reusable workflow, a cut step)
  is never covered, and only a compared context is ever called covered. A
  PR that converged on the verifier and then stops at merge on a red
  required check is set aside with reasonClass `merge-gate`, distinct from
  `integration-red` (a red of the verifier at Integration). _Avoid_: CI
  green, CLEAN.
- **Verify slot** — one of the machine's `verify_slots` places a verifier
  suite runs in, shared by every rollout on the machine (p23-4,
  `scripts/verify-slot.py`): the lead's Integration and RACE verifies and
  every agent's engine-rendered verifier take one, and a further suite waits
  rather than piling on; `run` and `status` with no `--slots` read
  `verify_slots` from rollouts.toml themselves (p34-1). Each slotted suite
  runs under a guard that ends a killed holder's suite before its verify slot
  frees, and a command in a verify slot sees `VERIFY_SLOT_HELD=1` (p34-1), so
  a suite it starts never queues for a second one. The Integration priority:
  the lead's Integration and RACE verifies, and the integrate call's own
  verifier runs (`run --priority`), go before any task call's agent, except a
  run at the head of the line for 15 minutes, which then waits beside them,
  and other runs wait in arrival order (p34-1). An agent waits for its suite's
  verdict inside its turn (`verify-slot.py wait`, p31-3), never by ending it.
  Not a **Slot** (a task's run in a Queue). _Avoid_: bare "slot", lock,
  semaphore.
- **Checkpoint** — one of the two moments per task where the rollout's
  `verifier:` runs (the full suite, or a project's declared **Fast tier**): a
  code-writing agent's last check before it opens or updates its PR (the
  implementer's, and each reviser's), and Integration before the merge (estate
  ADR 0009 d1; the estate's own `CONTEXT.md` § The Mac's load). The engine
  renders the verifier there, and elsewhere only when a task brief asks for a
  full-suite run (under a Fast tier this renders the tier). Not the **Cursor**
  (a saved position). _Avoid_: final run, full check.
- **Touched tests** — the test files that reach what a change touched, run
  between Checkpoints: each Ralph try of an implementer or a reviser (touched
  tests, then the verifier once before it hands back), a reviewer's own check
  and a planner's or investigator's observation (estate ADR 0009 d1). An agent
  finds them by the rollout's optional `touched:` pattern (`{module}` for each
  changed module), else the repo's `CLAUDE.md`/`AGENTS.md` Tests line when it
  says how to run one file's or module's tests (a line naming only the full
  suite falls through), else the test files importing the changed modules.
  They take no **Verify slot**. _Avoid_: quick tests, smoke tests, partial
  suite.
- **Fast tier** — the part of a project's suite its rollouts verify at each
  merge, declared as the rollout's `verifier:`: the tests a change reaches from
  its **Verify base**, plus a small set that always runs, and the full suite
  whenever a change cannot be placed. The full suite then runs as the
  **Completion verifier** and on the default branch's own runs, so a break only
  the slow tests catch, in code the change did not reach, is found there and
  filed, not at its merge (estate ADR 0009 d6, ADR 0073). Not **Touched
  tests**, which an agent runs between Checkpoints. _Avoid_: quick suite,
  smoke tests, partial verify.
- **Suite budget** — how long a project's suite may take, read on the week's
  median, never one run: an Integration verify within 5 minutes and a full
  suite within 20 unless the project sets its own (a looser one only with its
  reason stated; estate ADR 0011 d2). A breach files that project's suite
  audit. _Avoid_: test timeout, `verify_timeout` (a deadline, not a budget).
- **CI headroom** — how far a required GitHub check's job runs below its time
  limit (`timeout-minutes`), per merge and on the week's median. A job whose
  week's median runs past 80 % of its limit is a finding; a job cancelled at
  its limit is a CI timeout, a stop on GitHub's side, never a red check and
  never a gate for Lachy (ADR 0073). Each merge records one `ci-headroom`
  Run-record line per required job (merge-task, through lead-integrate.py
  ci-headroom); the weekly Reflection reads them in span's `suite` block, and a
  breach on Thread Skill's repo files its suite audit (`reflect.py
  suite-audit`). _Avoid_: CI timeout (the event, not the margin), runner speed.
- **Security check** — the opt-in scan a rollout's hand-set
  `security_checks: true` turns on (execute § 3): once the verifier is green
  and before its PR, a code-writing agent runs `security-check.py scan` over
  the task's own commits since their merge base, each merge's resolution
  included (secrets, by gitleaks), and the dependencies its diff adds or
  changes outside test fixtures (advisories, by OSV), and the review judge
  runs it again. Integration scans too: the integrator before its push and
  the Integration judge after, over Integration's own commits and merge
  resolutions since the anchor, every finding there Lachy's question. A red
  the agent can fix fails the try like a verifier red; one no commit can clear
  (a pushed secret, a secret in Integration's commits, a change to the
  scanner's own config, an advisory with no fixed release) is Lachy's
  question, and his answer clears it only as a `security-accept <kind>:<key>`
  token the scan reads from the task note's `## Repair input`. Integration's
  scan reads secrets and the scanner config only, not dependencies
  ([[thread-skill-security-check-integration-dependencies]]). A serial
  chain's Leg runs it too, on each task with commits, before any review and
  again before `leg.py done`: in a Chain copy it rewrites a secret out of its
  own unpushed commits (one it cannot rewrite halts the chain for Lachy's own
  rewrite), and a secret in a primary checkout's history reverts the task,
  sets it aside and halts the chain; on a serial chain his answer to it is
  the rotation and the hand-back, whose re-entry starts after the revert. A
  Leg's close-out commits between tasks and `leg.py land`'s merges are not
  scanned. _Avoid_: secret scan (alone), audit, CI check.
- **Cursor** — the durable record of rollout progress, the single source of
  truth for "where was I": in a Queue, the rollout's task notes, a task
  marked done being a task merged (ADR 0030).
  _Avoid_: checkpoint (a **Checkpoint** is a full-suite moment), pointer, progress marker.
- **Primary checkout** — the git checkout the plugin runs from, live (a
  directory-source install, or `--plugin-dir`): sessions render their skills
  and run their hooks from it, but no **Engine snapshot** is cut from it, so
  no lead runs its engine from it. For thread-skill it is also the
  **In-place checkout**, which merge-task fast-forwards after each merge of a
  self-rollout. It is free to move (ADR 0043): ADR 0031's hold covers only a
  **Running rollout** with no Engine snapshot. The plugin root counts only as
  its own work tree's toplevel: a version-cache copy, even inside another repo
  (~/.claude's config repo), has none, and a snapshot stands for the checkout
  it was cut from (`engine-snapshot.py`'s git_primary). What moves it is the
  **Primary refresh** (ADR 0066), and land.sh S4 and merge-task's in-place
  refresh whenever the hold is clear. Not the engine's "main
  checkout", which is a rollout's own repo. _Avoid_: live checkout, installed
  copy.
- **Primary refresh** — the background job that keeps the **Primary checkout**
  current with origin: every few minutes it fast-forwards it whenever ADR
  0031's hold is clear, and keeps the other checkouts sessions load live from
  (`~/.agents`, which holds /fresh-review) current the same way, with no hold.
  Fast-forward only: a diverged checkout, or one with an uncommitted edit
  origin would overwrite, is left as it is (an edit origin never touches rides
  along; `refused` only once the hold is clear). One that stays unable to
  catch up, a rollout's hold included, stays in the job's state file and sends
  no notice (ADR 0075 d2): `/thread:status`'s Primary refresh line reads the
  job's last recorded state there (`primary-refresh.py stuck`), naming a
  checkout once it has stood a day, or at once when it timed out. It runs an
  installed bundle that updates itself only after a smoke run with the job's
  own argv and a real fetch, and it records a launchd job an update left stale
  in the same state file, read on the same line. _Avoid_: auto-update, plugin
  update (Claude Code's own verb).
- **Engine snapshot** — a frozen copy of the plugin at origin's tip of its
  default branch, fetched fresh when schedule writes the rollout note (never
  the **Primary checkout**'s working state) and named on it: the
  lead's scripts, Workflow engine and skill prose all come from it for the
  whole run, as do status's and repair's for that rollout, whichever session
  runs them, so the Primary checkout can move under a **Running rollout**. A
  rollout moves to a newer snapshot only at its **Reinstate** (ADR 0043); a
  note that names none is stamped at its next Reinstate or Leg begin. A
  session's rendered prose is followed only when its git `ident` prose id is
  the snapshot's own; otherwise the snapshot's SKILL.md is read as a file
  (`skills/_shared/engine-snapshot.md`). _Avoid_: pinned root, frozen plugin,
  engine version.
- **Engine root** — the root every command acting on one rollout runs from:
  its **Engine snapshot**; for a note that names none, the **Primary
  checkout** when there is one; otherwise the session's plugin root (a
  version-cache install). `engine-snapshot.py resolve` prints it, and the
  guarded scripts refuse to write from any other (ADR 0043). _Avoid_: plugin
  root (the session's, which may differ), engine version.
- **Rollout clone** — a repo's second full clone, `<toplevel>-rollout`, beside
  its toplevel and never nested inside it: the Project root of every parallel
  rollout scheduled after P26 (ADR 0042); a second project's parallel rollout on
  the same repo has its own, `<toplevel>-<project-slug>-rollout` (ADR 0064: one
  clone per (repo, project), named by `unfinished-rollout.py clone`), so peer sessions' commits to the
  **In-place checkout** never reach a rollout's windows. Schedule § 0 makes it
  (`self-rollout-check.sh --ensure`, after Lachy's yes), execute § 2.7 and
  merge-task keep it current, and only merge-task moves its default branch:
  no session commits there, and its THREAD.md copy is never a thread
  (`--in-place` reads a directory in it as the twin's). _Avoid_: mirror, fork,
  separate clone.
- **In-place checkout** — the checkout Lachy's sessions and the daily sweep
  work in, the **Rollout clone**'s twin: the repo's toplevel itself. A
  clone-rooted rollout never runs there; its threads, handoff homes, consumed
  review docs and ledgers live there, and merge-task fast-forwards it after
  every merge when it can (`--refresh-in-place`: ff-only, never a merge commit;
  held while it is the **Primary checkout** under ADR 0031's hold). A commit
  in it blocks a rollout only when it touches a path a not-yet-merged task
  cites. _Avoid_: main checkout, shared checkout.
- **Running rollout** — a live, started rollout at the current protocol,
  neither `done` nor `dropped` and not hard-paused: one a lead may be running.
  Only one with no **Engine snapshot** holds the **Primary checkout** (ADR
  0031's hold, narrowed by ADR 0043), and never a serial chain that is stuck
  with no Leg open (ADR 0060's stuck, ADR 0066's 2026-11-05 amendment).
  It differs from unfinished both ways: it leaves out paused, never-started
  and protocol-3 rollouts, and keeps one whose every task merged but whose
  completion ceremony has not run. _Avoid_: active, in flight.
- **Execute handoff** — how a session that wrote a parallel rollout note ends
  (orient § 9, schedule step 8; ADR 0057): decided and never asked, it hands
  the note to a fresh session through handoff's **Rollout launch.**, whose doc
  carries `launches:` and briefs the rollout's lead, never this thread. Only his
  words choose here, not yet or start when ready instead, and at orient § 9 and
  schedule step 8 only a refused ladder file holds it. For a note this session
  wrote, or its THREAD.md names, that no lead runs, `next` runs it first, before
  this session's own move, and close ends with it (ADR 0072); only his not yet
  or a hold close step 2 names leaves close's `rollout not started:` row
  instead. _Avoid_: execute offer.
- **Start when ready** — the execute handoff's fourth move, on his word
  (orient § 9, schedule step 8): it stamps `start: unattended` on the rollout note just
  written and ends, running nothing. Said after the handoff, it withdraws the
  launch first, and stamps nothing when a lead already runs. The Chorus Stage starts the lead in the
  note's Project root, the **Rollout clone** (ADR 0042), once the note is runnable, and that lead's first `next`
  clears the stamp, so no second lead starts (vault grammar § Rollout start
  stamp). Outside a Chorus Stage nothing acts on it, so it waits like not yet.
  The **Backlog orient** stamps each parallel note it wrote this way itself, as its
  decided start (`stamp-start --backlog`, ADR 0071), never beside a hold.
  When he names the PR the start waits on, it is an **Approved queue**
  instead. A serial note takes the same stamp as its place on the **Waiting
  list** (P44-4, ADR 0076 d4), written only on the Chorus Stage and never
  cleared while the chain is unfinished: the Stage opens each Leg from the
  list, not a lead. _Avoid_: auto-start, scheduled start.
- **Git-env canary** — the lead's check that the shared checkout (a rollout's
  `Project root`, its **Rollout clone** since ADR 0042) kept its
  `refs/heads/<default>` and its bareness across each **Window** (execute § 4.5,
  ADR 0030). The **In-place checkout** is never armed: a peer's commit or
  push there, and its fast-forward by `--refresh-in-place`, never trip it. A local commit not on
  `origin/<default>` is benign only when every one is a non-merge commit
  touching only close-out paths (land.sh's `closeout_shaped`) or deleting a
  review doc directly under `docs/reviews/` (`closeout_change`), stricter than
  land.sh S9: a merge or an empty commit trips. Anything else trips. _Avoid_:
  verifier wrapper, git guard.
- **Window** — the span from a launch's canary `arm` to its `check`: a
  Workflow call, a resume, the lead's Integration verify or a RACE re-verify.
  A window can only be open while its vault owner holds (`in_progress` for a
  task call, the Integration lane (`integrating:` or a current `integrated`
  log line) for the rest); `arm` refuses a window whose owner does not hold;
  an orphan is compared once and closed. A task call's window is
  armed by `mark-started` itself (p26-3), so a start, restart or seeded
  revise never launches unarmed. _Avoid_: watch, session.
- **Git-env hold** — the unacked trip lines on a rollout note's
  `## Git-env log`: while one stands, nothing integrates or merges and `carry`
  refuses the rollout, while task calls keep starting and running (the
  **Integration lane** held: `laneHold`, the canary's exit 9); a bare
  checkout holds the whole rollout (each entry's `scope`; ADR 0046, ADR 0048).
  Only a **Git-env ack** lifts it. _Avoid_: git-env halt (the lead's stop, not the hold).
- **Lane hold** — a cause that reaches every merge (merge-task's abort or its
  environment exit 2, a `lead-integrate.py` exit 2 on the task holding the
  lane, the Integration verify's third `noslot`) held on the **Integration
  lane** alone: one `## Lane log` line (`lane-hold`), read by `next` as a
  `lane` entry in `laneHold`, so nothing integrates or merges and `carry`
  refuses the rollout while task calls go on, and `halt: lane` once nothing
  else moves (ADR 0048). Only Lachy's ack,
  through `/thread:repair` (its lane-hold step, 3g, `lane-ack`), releases it.
  _Avoid_: lane halt (the lead's stop, not the hold).
- **Git-env ack** — the recorded acceptance of the tripped windows, naming
  exactly the set shown and the ref shown (`--ref`). Lachy's, through
  `/thread:repair` (its git-env step, 3e), after an optional `restore`; never
  an agent's (ADR 0046). A window that tripped and is still open at the
  ack keeps running, but its run gives no verdict: a verify or an
  integrate call is done again, while a task call's work is taken as it
  stands (ADR 0053). _Avoid_: clear, reset.
- **Hold until** — a PR hold the engine reads: a `hold_until: {pr:
  <owner/repo>#<N>, merged: true}` frontmatter key. On a parallel rollout
  note it holds every start and restart until that PR merges (live calls and
  Integration carry on); on a task note it holds that task's new calls.
  `next` reads the PR through gh, reports `holdUntil` and `halt: held`,
  releases the hold on the merge and clears the key itself, so the lead
  waits instead of asking; a CLOSED or unreadable hold is Lachy's to edit.
  A supersede's `carry` copies a rollout's hold to its successor. A hold kept
  as a sentence in the note is read by nothing (the 2026-10-25 audit's Q50;
  `skills/_shared/vault-grammar.md` § Hold until). Beside `on_merge:
  regenerate` it is an **Approved queue**'s, which its merge keeps standing.
  _Avoid_: a hold sentence.
- **Approved queue** — a parallel rollout note nothing has run whose start
  Lachy approved together with the PR it waits on: `approve-queue` writes its
  `hold_until`, `on_merge: regenerate` and `start: unattended`, and prints one
  undo line. At the merge `next` keeps the hold and halts `regenerate`, and
  the lead's route runs `/thread:schedule --regenerate` on its members under
  the chain, whose last act is `stamp-start` on the new note: no confirm, one
  undo line (the 2026-10-25 audit's Q54). His own pause still counts as a run
  and releases it as a plain hold, `on_merge` cleared with the hold; a Room
  stop is no run mark for it. `skills/_shared/vault-grammar.md` § Approved
  queue. _Avoid_:
  auto-regenerate, pre-approved rollout.
- **Durable trigger** — a "when X, then Y" step written on a rollout or task
  note as a `when:` entry, so it survives any session (ADR 0078 d5): `on` is
  `merged <owner/repo#N>`, `paused` or `landed [[task]]`, and `do` is
  `regenerate`, `regenerate --tasks a,b`, `schedule [[task]]` or
  `reset-primary`. `reconcile-rollout.py triggers due` lists what is due with
  no lead; `triggers fire <id>` runs one and records it once, as `fired:` on
  the entry, handing a model step's command back to its caller. A fired
  regenerate or schedule is an attended run: its Session can stop at
  schedule's questions and wait on Lachy. It extends **Hold until** and
  **Approved queue** and replaces neither. `skills/_shared/vault-grammar.md`
  § When. _Avoid_: a watcher for a follow-up, a follow-up sentence.
- **Bookkeeping miss** — a window the canary could not read (`record
  missing`, `record unreadable`, `record not armed`): it observed nothing, so
  it never trips. It is logged (a `git-env miss` line) with the checkout's
  state, read there and then (not bare, no tracked changes, `<default>` an
  ancestor of origin's tip by `ls-remote` and by the tracking ref after a
  fetch), holds nothing, and only a failing state check trips (ADR 0046).
  _Avoid_: false trip, automatic ack.
- **RACE revert** — a RACE whose re-verify stays red after the Flake check is
  reverted on `main` through a revert PR merged only through merge-task
  (`lead-integrate.py revert`; never a force-push), its task set aside for
  Lachy. The lane frees only when `main`'s tree is restored, by tree or but
  for proven Inert paths (ADR 0045); a revert that did not land holds the
  whole rollout (main red, `next`'s `mainRed`) until Lachy decides (ADR
  0046). _Avoid_: rollback, force-revert.
- **Dependent closure** — the set of tasks transitively depending on a task
  via `depends-on:` / `blocked-by:` (schedule § 3) — the blast radius that
  must move together if it's deferred, and the tasks a set-aside task holds
  back in a Queue. _Avoid_: dependency tree, downstream.

## Task lifecycle (rollout lane)

- **Landed** — work final on `main` (`status: done`, or a `review`/`merged`
  task whose PR has merged, awaiting confirmation). Never re-dispatched on
  resume. Landed is not **Live**, and a landed fix is not yet **Proven**.
  _Avoid_: finished, complete, shipped.
- **Live** — landed work that the sessions actually load: in the installed
  plugin or checkout they run from, not only on origin. From 7 to 9 Nov 2026
  P41, P42, P43 and P44-1/2 were landed and not live, because the
  **Primary checkout** had diverged. _Avoid_: deployed, installed (alone).
- **Proven** — a fix whose purpose, the stuck work or failure it was filed
  to clear, has been seen to move with the fix **Live**. Only a proven fix is
  done (Lachy, 2026-11-09: "the stuck work moved"); until then it is a
  **Carried fix**, and he is never told it is done. A task filed to clear
  nothing in particular is done once live. _Avoid_: fixed, done (alone),
  resolved, target (orient's **Target** is another thing).
- **Carried fix** — a fix that has landed but is not yet **Proven**: the
  system keeps carrying it (making it live, then watching for what it was
  filed to clear to move) and repairs what stands in the way unseen. He sees
  carried fixes, and any stuck machinery, on the quiet Stage line that opens
  with a click; one the system cannot move within a day is a stop the
  Companion leads him to (Lachy, 2026-11-09). _Avoid_: pending fix, open fix.
- **Blocked** — the umbrella for a task that did not land: `blocked` (verifier
  never green), `plan-blocked` (plan never approved), or `review-blocked`
  (open PR, review rejected). In a Queue a blocked task is **set aside**: its
  slot frees, its dependants wait, and the queue runs on (ADR 0030).
  _Avoid_: failed, stuck, errored.
- **Input-gated block** — a block needing a human decision no agent can
  supply; the decision must be written into the note before re-dispatch.
  _Avoid_: manual block, human block.
- **Gated input** — a human authorisation a task's plan declares up front
  (API spend with a cap, credentials, an irreversible action). Sets its task
  aside for sign-off, never the rollout (ADR 0008, ADR 0034). Once signed, the task
  resumes its gate-pending call on the signed plan while the lead holds its
  handle; a stop at Integration rejoins the Integration queue; otherwise it
  takes a fresh call behind a warning (execute § 3.7).
  _Avoid_: approval item, spend gate, pre-approval.
- **Cap** — the one USD ceiling a spend Gated input names on its own line,
  `spend: <what> — cap N USD`, optionally with `total`, a month, or a
  per-Login count across K Logins (`per Login per month across 3 Logins`). It
  is a promise the task keeps; how the spend splits goes in nested sub-bullets
  under the line, which are commentary and never priced (ADR 0038). While the
  Standing approval is on, the plan judge prices the line and sends a Cap that
  does not price back to its planner once, without a climb; one still unpriced
  then goes to Lachy, never to the Standing approval (ADR 0038).
  _Avoid_: budget, limit (the Standing approval's limit is another thing).
- **Standing approval** — Lachy's one-off sign-off for every spend Gated input
  whose **total exposure** is at most the operator's limit (US$200 on Lachy's
  Mac): the cap summed across Logins, a recurring cap counted per month, the
  limit itself included. It also holds a month line (ADR 0034's 2026-10-27
  amendment; spend is never asked ahead): a gate passes only while this
  calendar month's standing approvals, summed from every rollout note's
  `## Needs-you log`, stay at most the operator's limit with it. The limit is
  the Rollout settings key `spend_approval_usd` (a task may carry its own,
  a limit Lachy named; built-in 0, which is off). Exposure counts every USD
  amount the gate names; a shape it cannot price, even from its cap alone,
  asks (p37-4: a readable cap prices a gate the full reading refuses). Such a
  gate passes
  without him (`approve-gates --standing`, run by the lead) and is recorded
  in `## Approved gates` with `(approved <date> under the standing approval:
  total exposure …)`, the task's ceiling, never a target; irreversible gates
  never pass under it (ADR 0034), and a credential gate only as a declared
  Test credential (ADR 0063) or Test Login (p37-4), nor does any gate on a
  plan the plan judge bounced (ADR 0038).
  _Avoid_: spend envelope, auto-approve limit.
- **Test credential** — a test-mode, staging or sandbox key a repo declares in
  its test-credential class: the Rollout settings key `test_credentials`, one
  line in its `[repo."owner/name"]` table of `~/.config/thread/rollouts.toml`
  (schema 3), naming a file and each key's name with its prefix (`sk_test_`)
  or Supabase project. A credential Gated input that names only such keys,
  with a test-mode word and no live, production or secret word, signs itself
  under the Standing approval once each key is proved present in that file
  and the rollout's `env_bootstrap` copies the file with a plain `cp`
  (ADR 0063); a key missing from it is asked at the stop. The class is its
  own switch, at any spend limit, and only Lachy writes it. Schedule and
  orient record such a credential, never ask it ahead; a Leg never signs one
  (a Test Login is machine-wide).
  _Avoid_: safe key, dev key.
- **Test Login** — a Claude Login the operator declares a test Login (Lachy's
  dummy Login): the Rollout settings key `test_logins`, one line under
  `[defaults]` of `~/.config/thread/rollouts.toml` (schema 5), machine-wide.
  A credential Gated input that names only such Logins, with no deny word,
  env key, other credential word, `@` address or conjunction joining a
  second thing beside them, signs itself under the Standing approval with no
  limit, ledger or month line (p37-4, ADR 0034's 2026-11-05 amendment); a
  serial Leg signs one too. A second thing named in plain prose with none of
  those is not seen, and signs (a residual). Only Lachy writes it. Schedule
  and orient record such a gate, never ask it ahead, on a serial chain too.
  _Avoid_: dummy account, test account.
- **Human fix** — the one stated act that moves a set-aside task no agent may
  move (sign a gate, decide a refused descope, restore an Integration with no
  PR), with its detail: `lead-integrate.py inputs`' `humanFix` ({act, detail,
  handBack, label, raise}; `raise` names the budget a spent block may raise).
  Execute, status and repair print it; none re-derives it (ADR 0035).
  _Avoid_: human cause, manual step.
- **Recorded answer** — Lachy's answer to one set-aside block, a `## Repair
  input` entry keyed on the block's fingerprint and written only by
  `reconcile-rollout.py record-answer`, the entry last: `hand-back` (a bare
  hand-back is all that is left, so the live lead hands it back itself once
  nothing is paused), `awaiting repair` (repair still has work first) or
  `left` (answered, left set aside). `inputs`' `answerRecorded` is its one
  read; a re-entry since, a later answer (which supersedes it) or a hand-back
  (which spends it) ends it, and an answered block is never retried (ADR
  0035). _Avoid_: answer key by hand, spend by hand.
- **Needs-you item** — a decision in a running rollout that is Lachy's alone:
  a gate sign-off, an undecided RACE or UNVERIFIED, a set-aside only a person
  moves on, a merge hold's release, or a halt. The lead lists it in the
  report's `Needs you:` block and in the rollout note, for a sitting Lachy
  chooses, and never pushes it (ADR 0075 d2): no rollout notifies him. Every
  open needs-you item across all rollouts is also gathered into one list he
  can open with a click from the quiet Stage line, and work through as one
  board in a sitting; he never has to visit rollout notes one by one to find
  them (2026-11-10: seven stops sat in seven notes with nothing collecting
  them). Only a
  halt that stops the whole rollout can lead anywhere, and only through
  Chorus's Companion while he is at the Stage, when Chorus reads it as his
  (d3); a single set-aside stays listed. The rollout note's
  `## Needs-you log` is the Standing approval's ledger: its
  `signed under the standing approval:` lines, the month line's ledger; the
  push lines an earlier engine wrote there are inert history. That log is
  never the task note's `## Needs you` (p16-3), which holds the question the
  engine stopped on; an item whose entry carries
  one shows it on its detail line. The lead never puts an item through the
  question tool while anything the session launched is in flight, and the
  queue runs on without the answer (execute § 6.5).
  _Avoid_: pending question, ask item, open question.
- **Agent-fixable block** — a block a re-dispatched agent can resolve alone.
  The live lead re-enters these itself through `reconcile-rollout.py
  auto-retry`, up to `auto_retries` times (default 2; an infra block after a
  short cool-down, while a quota block waits out a longer one free, ADR 0033);
  repair keeps the ones that need a human (a spent
  budget, a repeated feedback fingerprint, a `## Needs you` question). _Avoid_:
  auto-block, soft block.
- **Automatic descope** — a plan-block the notes already settle, dropped from
  the task without asking: the feedback centres on a part the note marks
  optional (a follow-up task is filed) or on work a later task in the same
  rollout owns. The live lead (execute § 4.5) and repair run one guarded
  verb, `reconcile-rollout.py descope`, which records the scope decision and
  re-dispatches the task through `hand-back`; Lachy is told afterwards. It
  asks instead when the part is required scope, touches an ADR or a recorded
  decision, or the task plan-blocks again after one. _Avoid_: auto-drop,
  scope cut.
- **Drift** — divergence between the vault's recorded state and live
  GitHub/git reality. Within a rollout, `status` flags it and `repair`
  reconciles it. Across a project it is finished work still marked open: a
  phase whose tasks have all landed, or a task whose PR has merged. `orient`
  flags it and fixes the unambiguous items on a default or `--steer` run,
  never a look-only one or a scoped target, its audit's Drift line being the
  notice (ADR 0026, 0036). _Avoid_: desync, staleness, mismatch.
- **Clean defer** — taking a task out of a rollout back to the open backlog
  (clearing `rollout:`/`owner:`), permitted only when nothing in the rollout
  depends on it. _Avoid_: drop, cancel, skip.

## Convergence engine

- **Convergence** — the per-task loop driving a task to mergeable: plan-gate →
  verifier retry → master review. Owned by `execute`.
  _Avoid_: the pipeline, the build, processing.
- **Engine** — the component that *does* convergence (`execute` and its
  Workflow script). Spawns agents, runs the verifier, merges PRs.
  _Avoid_: runner, executor (as a generic term).
- **Accumulated feedback** — the by-round history of judge rejections,
  threaded into every later reviser and judge in both gated loops (plan and
  review). In the review loop the latest round is the reviser's work order
  and earlier rounds are anti-regression constraints; the judge carries an
  anti-goalpost discipline. _Avoid_: feedback log, memory (alone).
- **Step-back round** — the round-3+ revision round, triggered by two
  accumulated rejections: the reviser stops patching and is licensed to
  restructure the approach — deviations from the approved plan permitted but
  always declared. The re-planning lever without re-entering the plan gate.
  _Avoid_: re-plan round, redesign.
- **Ceiling approval** — an approval on the final review round with real
  rejection history; always leaves an auditable `## Review history` record
  on the task note. _Avoid_: barely-passed, last-chance approval.
- **Conductor** — a component that *orchestrates* the engine without
  re-implementing it (`repair`). Diagnoses, captures decisions, reconciles
  drift, hands off to the engine's resume — never merges or converges
  (ADR 0004). _Avoid_: orchestrator, controller, wrapper.
- **Situational report** — the read-only output of `status`: cursor, per-task
  queue state (ADR 0030), blockers, drift flags, whether the rollout is moving
  (its Moving line, `reconcile-rollout.py moving`: the reading a **Watchdog**
  acts on, ADR 0048), one recommended next action.
  _Avoid_: dashboard, summary, snapshot.
- **Repair bridge** — the path by which a blocked task is fixed and re-landed
  while the engine keeps sole merge authority. _Avoid_: handoff, recovery.
- **Pause** — stopping a rollout run without losing its place. Soft: a
  `pause_requested` flag (start nothing new, let what is running integrate
  and merge, exit paused; ADR 0030).
  Hard: stop now; worktrees keep the work. _Avoid_: suspend, halt, abort.
- **Stop** — the run halting for a cause other than Lachy's **Pause**: a
  usage limit, a dead lead, a Mac restart or sleep, a § 7 halt, a Watchdog
  recovery. The Run record keeps each as its own kind, never a pause: logged
  live when a process saw it begin, else inferred by the resume that finds
  it, with the calls in flight at its start (ADR 0051). _Avoid_: pause, halt
  (alone).
- **Reinstate** — resuming a paused rollout: plain `execute` on the rollout
  note. No separate resume command. It moves the rollout onto a fresh
  **Engine snapshot** at origin's tip (ADR 0043); for a serial chain, which is
  never paused, it is the first Leg begun after a Leg closed `stopped`; never
  a **Sign-off pause**'s reinstate. An unstamped note is stamped at it, and an
  unstamped chain also at its first Leg or the first Leg begun after any close
  (ADR 0043, as amended). _Avoid_: restart, relaunch, unpause.
- **Room stop** — on the Chorus Stage, at a Login's line: the lead starts
  nothing, stops each Workflow call at a step boundary (just after its running
  agent's result line), and resumes every stopped call by `resumeFromRunId` on
  the Stage's re-send (Chorus ADR 0071; execute § Room stop). It stands from
  its `## Pause log` line to `room stop ended`, and it never stamps `paused:`.
  The line is the week's alone: the spread (Chorus ADR 0109) and the 5-hour
  line retired with Chorus ADR 0111.
  A held one (its signal says no Login has room) stands past its 6 h bound
  while the Stage lives, up to a week (execute § Room stop item 11).
  On an Approved queue it is no run mark.
  _Avoid_: drain (Chorus's signal calls it "a drain, not a pause"; here the
  soft pause is the drain), pause, hard pause, handoff.
- **Sign-off pause** — the pause execute's sign-off form stamps (`paused:`
  with `paused_for: sign-off`) once only gate-pending tasks and their queued
  dependants remain: the run finished everything else and closed, and the
  rest waits on Lachy's sign-off (ADR 0034). It keeps the repo's one
  unfinished rollout until each gate is signed or deferred; its Reinstate
  runs the Standing approval again and refuses while a gate is unsigned. It
  never moves the Engine snapshot: it is the engine's pause, not Lachy's
  moment, so its signed-gate handles keep their cache replay (ADR 0043).
  _Avoid_: stuck, gate hold.
- **Stalled rollout** — a rollout with work it could do and nothing moving:
  its lead, session or Mac stopped, or a hold froze more than it threatens
  (ADR 0048): a recorded halt narrower than the work beside it. A wait that is
  meant is not a stall: a pause or Room stop (status § Pauses, § Room stop),
  the Trickle or the Away cap, the Heat hold, a cool-down. But a wait only the
  lead's own heartbeat ends (a merge hold) is a stall once its life signs stop.
  Not a **Stalled chain** (a serial chain's). _Avoid_: stuck, hung, idle (a
  Slot can be idle in a moving rollout).
- **Watchdog** — what acts on a Stalled rollout from outside its session,
  reading it from the **Situational report** (`reconcile-rollout.py moving`):
  Chorus's Companion, alone (ADR 0048, ADR 0075 d5). It recovers without
  asking and sends no push (ADR 0075 d2); its only signal to Lachy is the
  Companion's lead at the Stage, which is Chorus's reading (d3). It also
  watches a serial note's waiting Leg (an open Leg whose Leg lease reads
  `waiting`: a review in flight, a Capacity or quota wait, a completion
  verify in flight or a room stop; a chain on the **Waiting list** has no
  Leg and stays `skip`), `waiting leg-wait` while fresh and `stalled` once
  its session is gone or it goes stale (ADR 0075 d5, P41-4), and a
  parallel **Surface wait** reads `waiting surface-wait`. Its
  `stalled` is a reason to look, never by itself a reason to start a second
  lead. With Chorus not running nothing watches, and a stall
  is read when Lachy runs `/thread:status`.
  Never the rollout's own heartbeat, which stops with its session, nor a
  looped `/thread:status` (status § Loopable), which only recommends.
  _Avoid_: monitor, heartbeat.

## Run record and tuning

- **Run record** — the append-only events a rollout's Slots and
  Integration lane leave as they run, with the settings in force at each
  Slot start, written by scripts, never by a model (ADR 0032). It also
  carries every **Stop** and resume, every suite with the load around it,
  and why main moved at each base-moved refusal: what the Time-lost ledger
  needs (ADR 0051). _Avoid_: telemetry, metrics, log (a task note's
  `## Integration log` is a different thing).
- **Throughput** — merges per running hour, a Guardrail: a Tuning may not
  slow a run past its bound, since an overnight rollout must still finish by
  morning. Running time leaves out pauses, halts and waits on Lachy.
  _Avoid_: speed, wall-clock (it counts nights and sign-offs).
- **Hands-off rate** — the share of a rollout's tasks that land with no act
  from Lachy once the run has started: no Human fix, Recorded answer,
  sign-off, merge hold or repair run. One of a Reflection's two headlines, beside
  Quality. Questions belong before the run starts, so every mid-run ask counts
  against it; a gate passed under the Standing approval does not.
  _Avoid_: autonomy score, automation rate.
- **Grade log** — `grades.jsonl` beside the Run record: one line per task
  each estate pass or schedule Pre-flight grades (every schedule run but an
  orient-all fork, whose estate pass logged them), written by
  `estate-dispatch.py log`. The weekly
  reading joins each grade to what followed until the task's next grade or
  its close, and reports each grade's hands-off share (of the work it sent
  that landed hands-off, bounced back to Lachy, was regraded or dropped;
  work done by hand or never dispatched is reported beside the rate). A
  miss is traced to the grading rules and never tuned as a knob. A line's
  `decisions` and `low` count his decisions (owner yours) only since ADR 0054:
  a decision ruled for him is never counted, so lines before ADR 0054 are not
  comparable with lines after it. _Avoid_: grade history, calibration log.
- **Quality** — the other headline: how few Escapes a rollout's landed work
  produces. _Avoid_: correctness, polish.
- **Escape** — landed work that later needs a fix it should not have needed:
  a follow-up fix task traced to it by its `fixes:` key, a revert, or a later review finding
  against its lines. A Leg's fix task names the task whose Verify failed in `verifies:`, which is
  never an Escape; its `fixes:` names the chain task whose work caused the failure, if any. Counted against the rollout that landed it, so it is
  known only after the run: each weekly reading counts the ones that surfaced
  that week against the rollout that landed them, however old (ADR 0037 d4).
  _Avoid_: bug (alone), regression (a review round's word).
- **Review churn** — review rounds whose findings only answer the previous
  round's fix rather than the original work, in the engine's review loop and
  in `/fresh-review` alike. A Guardrail every Reflection reports. Measured as
  regression findings over all findings, by the review ledger's blame split,
  reported beside rounds per landed task (master-review rounds; Integration
  re-reviews not counted). _Avoid_: review waste, ping-pong.
- **Guardrail** — a measure a Tuning must not worsen past its bound to buy
  either headline: Throughput, tokens per merge, set-aside rate, conflict
  rate, quota stalls, Review churn.
  Its bounds sit in the operator's rollout settings.
- **Reflection** — the pass that reads one rollout's Run record by hand, or
  every rollout's since the last one in the weekly reading (ADR 0037 d3–d4)
  (and the records of any rollout that overlapped each, so shared load shows), scores
  it on the two headlines, Hands-off rate and Quality, and the Guardrails,
  traces what cost them to the rule that produced it, names what bound the
  run (Slots, the Integration lane, quota, dependencies) and proposes
  Tunings. The same word and shape as Chorus's Reflection over the
  Companion's record. Its verb is `/thread:reflect`. A serial rollout is read
  from its Leg log instead (serial-score.py): running time, the Hands-off rate
  and a Quality from `fixes:` alone, with no load, binding or proposal.
  The weekly reading also reports each Readiness grade's hands-off share
  from the **Grade log**.
  _Avoid_: retro, review (the engine's).
- **Tuning** — one proposed change at one
  of three altitudes, as in Chorus: a **knob** (a value in the operator's
  rollout settings: a repo's Parallel ceiling, a round cap, read by the next
  schedule); a **rule** (how a skill or the engine behaves: a grill and an
  ADR before a build); a **bug** (the engine or a skill did not do what its
  rule says: a task). By hand Lachy picks the ones that land; the weekly
  reading lands some unasked under ADR 0037 d5 (a bug filed, a knob three
  Reflections agree on, the revert of one that breaches a Guardrail); a rule
  never lands unasked. Each by-hand Reflection appends one line to `tunings.jsonl`
  beside the record, with its headline scores (the next Reflection's
  baseline) and the Tunings applied (decision 5's tally). Each rollout's
  close (its completion ceremony or its supersede) appends one scored line
  of its own through the same tune script (ADR 0037 d4). The weekly reading
  writes a line there only when it lands or reverts a knob, never a close
  line, and records its Watches, proposals and close in `reflections.jsonl`.
  A serial rollout's close line carries `shape: serial` and no repo: it moves
  no key and is never a baseline. _Avoid_: tweak, auto-tune.
- **Watch** — a pattern a Reflection saw in one rollout and would not yet
  propose a rule for: named, written to the record and carried into the next
  Reflection. It becomes a rule proposal when a later rollout shows the same
  thing again, or at once when Lachy confirms it. Lachy's no closes it too:
  it comes back only when two later rollouts show it again. A Watch the
  Time-lost ledger opens on a class, or the circling detector on its rule
  (**Circling**), counts readings instead of rollouts. Knobs need no Watch.
  _Avoid_: candidate, hunch.
- **Time-lost ledger** — the hours each cause class cost (stalls by cause,
  usage limits, machine load, the Integration lane, Integration rework, plan
  blocks, named from the Run record's own values where one fits), summed by
  a script across every rollout a weekly reading reads (a serial chain's
  aside: its Legs record no Slots or stops) and trended week on
  week; a class that tops it twice running opens a **Watch** on that class,
  and a load-topped ledger holds a Parallel ceiling raise (ADR 0051). Waits
  on Lachy (a gate, a question, a hand-back) are priced as stalls; only his
  own pause is unranked. Its lines are `time-lost` lines in
  `reflections.jsonl`, written by `reflect.py ledger`. Ranks causes, never
  rollouts. _Avoid_: time budget, cost report.
- **Monthly audit** — the pass once a month that reads past the Run record
  (transcripts, suite logs, pause logs, the Mac's history), writes into the
  Time-lost ledger and names what the record should have carried: an extra
  step of the month's first weekly reading, whatever its cadence, run beside
  the trace (ADR 0051). Its gaps go in the decision task and never change
  whether the reading is quiet. _Avoid_: retro, deep dive.
- **Attention ledger** — what the weekly reading reads past the Run record
  about Lachy's attention and the work that waits on it: the **Question
  ledger**, the **Review trails**, each rollout's **Wait to start** and
  **Circling**, read by a script from the session transcripts,
  `reviews.jsonl`, read-only git and the vault, and kept as one `attention`
  line per reading in `reflections.jsonl`, written by `reflect.py attention`
  with the reading's Owner label for each question (ADR 0056). _Avoid_: loop
  ledger; attention minutes; Review load (the estate pass's forecast of the
  attention a rollout will take, above).
- **Question ledger** — every question put to Lachy through the question
  tool in a reading's window, read from the session transcripts' main chain:
  its outcome (answered, dismissed, dropped or open; a call he never saw is
  failed and never counted as asked), the recommended option and whether he
  picked it, his own words or note, the hours it held work, and its Owner by
  `skills/_shared/asking.md` § 1, labelled by the reading (an `unknown`
  remainder never blocks the close). _Avoid_: ask log.
- **Review trail** — one PR's run of /fresh-review rounds, keyed by its
  landing merge, else its branch, else a run of rounds in one checkout: its
  rounds and code rounds, their findings and regressions, and whether the PR
  changed docs alone. Its STOP entries and the stops handed to Lachy retired
  with the ledger's stop rule (ADR 0065).
  _Avoid_: review loop (the engine's convergence of plan, verify and review
  rounds, above); chain (`review-ledger.py`'s, narrower).
- **Wait to start** — a rollout's time from Lachy's ask (the earliest
  `captured:` of the tasks its queue links) and from its scheduling (its own
  `captured:`) to its first Slot. _Avoid_: lead time.
- **Circling** — work touched and not merged: a work item (a task with
  `phase:`, `pr:` or `rollout:`) three or more Sessions named while no
  rollout held it, before its dispatch or once set aside (W1), or a rollout
  open 48 hours with nothing merged (W2). Each opens a **Watch** counted in
  readings; a reading's own Sessions never count as touches (ADR 0056).
  _Avoid_: loop; stuck item; stall or **Stalled rollout** (one with nothing
  moving; circling work moves without landing).
- **Quiet Reflection** — one that finds no new Watch (one first seen in this
  reading; a declined one seen again is not new), no rule proposal, no
  bug and no Guardrail breach. Three in a row move the reading from weekly
  to fortnightly; one that is not quiet moves it back (ADR 0037). The
  reading falls due on the Thursday Reflection Routine's morning, made by
  Chorus's weekly Runner (ADR 0051).
  _Avoid_: clean run, empty retro.
- **Decision task** — the one open vault task tagged `decisions` that the
  weekly reading writes, unscheduled, when it has a rule proposal
  or a held trade (a knob ADR 0037 d1 leaves to Lachy; ADR 0037 d5): Lachy
  decides it at Chorus's Thursday Reflection Routine
  (`/thread:reflect --decide`); schedule
  (either shape) and the reshuffle never take it. _Avoid_: inbox, review
  queue.
- **Rollout settings** — the operator's `~/.config/thread/rollouts.toml`,
  `ladder.toml`'s sibling: `[defaults]`, the `[guardrails]` bounds and
  per-repo `[repo."owner/name"]` tables (keyed by the GitHub origin),
  resolved by `rollout-settings.py` and stamped into each rollout note by
  schedule, except `auto_retries` and the Standing approval's
  `spend_approval_usd`, which the execute verbs resolve themselves and
  schedule never stamps, and `verify_slots`, which is machine-wide
  (`[defaults]` only), never stamped, and read by execute's `verify-timeout`
  at each loop entry. That read validates the whole file, so a refused file
  halts every rollout on the machine at its next entry; the file carries its
  schema version, and a snapshot ignores a key newer than itself while still
  refusing a typo (ADR 0043). The `[notify]` table is retired by ADR 0075 d2:
  it is tolerated with one warning, ignored and never refused.
  _Avoid_: hardcoded defaults, config.

## Model ladder

- **Ladder** — the operator's ordered list of named **Rungs**, bottom first, in
  one file outside any rollout; absent, the built-in ladder applies. Changing
  models or efforts is an edit to it, never a release (ADR 0029). _Avoid_:
  matrix, tier list, config (alone).
- **Rung** — one step of the Ladder: a model plus the efforts its roles run
  at. A task is on one rung at any moment, and its judges run on it too
  (ADR 0029). _Avoid_: tier, model level, grade, model (alone).
- **Top rung** — the Ladder's last rung, the ceiling for every task and every
  Integration (ADR 0029). _Avoid_: top tier, ceiling, max tier, default model.
- **Starting rung** — the planning-time choice to start a hard task above the
  bottom rung, from its shape alone (ADR 0029). _Avoid_: escalation (that's
  run-time), upgrade, effort override.
- **Escalation** — the run-time, evidence-driven climb of one rung, at most
  once per stage (plan, implement, review), at that stage's first sign of
  hardness. One-way and sticky, never past the Top rung (ADR 0006, ADR
  0029). _Avoid_: fallback, retry, promotion.
- **Tier**, **Top tier**, **Ceiling**, **Step-up** — the (model + effort)
  bundle a task ran on, the operator's cap on it and its planning-time
  assignment (ADR 0007, 0016, 0024). Retired by ADR 0029: see **Rung**,
  **Top rung** and **Starting rung**.
