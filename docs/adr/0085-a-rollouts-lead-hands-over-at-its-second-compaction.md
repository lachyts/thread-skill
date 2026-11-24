# 0085 — A rollout's lead hands over at its second compaction

Date: 2026-11-24
Status: accepted, built (p55-2 to p55-5; the Stage opening a handed-over rollout's fresh lead is the Chorus task's). Lachy's rulings of 2026-11-18, on the two questions of the grill note
`thread-skill-grill-a-rollout-lead-hands-over-before-compaction-costs`; the technical calls were decided for him at the
orient grill of 2026-11-24 (ADR 0054) and are listed last, each overturnable. Written by Phase 55 · Task 1
(`thread-skill-p55-1-adr-0085-a-rollouts-lead-hands-over-at-its-second-compaction`); p55-2 to p55-5 and one Chorus
task build it, and each records what it built back into this Status. Amends ADR 0076: its d3, which says what is on
the list ("An unfinished serial note with `start: unattended`, no open Leg and no stop that needs Lachy is on the
list; no other store holds it"), its Decided for Lachy 4, and d4's last sentence ("Parallel rollouts keep one lead
each, started as today"), since once p55-5 builds it a parallel rollout whose lead has handed over waits on the
Waiting list. Leaves ADR 0043, ADR 0057 and handoff's
**Invocation gate.** as they are. Extends ADR 0030 decision 5's drain, and gives `paused_for:` a third value beside
`sign-off` (ADR 0034) and `catch-up` (ADR 0084 d5).

Built so far: item 7, by p55-2 (`thread-skill-p55-2-one-command-builds-an-integrate-calls-whole-args`).
`lead-integrate.py call` prints an integrate call's whole args, and `call --revise` a seeded revise's, each read from disk
only (the rollout note, the task note, prepare's record, the ladder file and the rollout settings), and execute § 4.5
names it as the only way to build either launch. A task-level round-budget stamp that is not an integer >= 1 is `call`'s
`budgetError` (exit 0, `args: null`, the lead's own set-aside row, ADR 0048); a fault of the rollout or the machine is its
exit 2. `call` joins the Engine snapshot guard, since its args carry paths built from its own root.

Built so far: item 8, by p55-3 (`thread-skill-p55-3-a-stop-the-lead-caused-is-the-leads-to-redo`), and the three
lead-caused halts *Left to the build* named become Lead errors (execute § 4.5 **Lead error (ADR 0085 d8).**):
- **D1, the sites.** (a) an *Args refusal*; (b) § 4's pre-check mismatch (`args.verifySlot`, `args.securityCheck`),
  only when a second `verify-timeout` still prints the entry's line (a moved line is an operator's edit: today's halt,
  no line); (c) an integrate row whose merge step STOPped on the value it was passed while naming another (the three
  `merge_stop` texts `anchor mismatch`, `carries a merge — ANCHOR_RECIPE gives` and `is not merge-base`, held to the
  row's `integration.anchor`, the named sha 40 hex and another), read by `reconcile` itself; (d) a loop command that
  never ran, by four signatures on the lead's own command: S1 exit 2 with `usage:`, S2 exit 2 with `can't open file`,
  S3 the shell's 126 or 127, S4 `set-aside`'s `lead error:`. Never one: an `engine-snapshot:` exit 2, or `verify`
  once its `<out>.rc` exists. A Lead error is read before any route the skill gives a command's exit.
- **D2, the three halts.** The *Args refusal* halt and § 4's two pre-check halts are Lead errors, a halt only at the
  bound.
- **D3, the redo, in place.** Record it, re-read the step, then: (a) loop step 1; (b) the args rebuilt and checked
  again; (c) step 1, where step 1.4's `prepare` then `call` builds the launch; (d) the command as the step writes it.
  No set-aside row, no retry counter, no halt, no `## Needs you` item.
- **D4, the bound.** `LEAD_ERROR_BOUND` = 3 per task per lead session (`CLAUDE_CODE_SESSION_ID`), a taskless one under
  the rollout. Every Lead error writes its line; from the third it reads `over: true`, there is no redo, and until
  p55-5 wires the hand-over the stop takes its site's route from before: the § 7 halt for (a) and (b), the engine's
  set-aside row for (c), the exit's own route for (d).
- **D5, the line.** One Run record `lead-error` line per Lead error, {site, n, bound, over?, session?, call?,
  evidence?, row?, passed?, named?} (run_record.py), written by `reconcile-rollout.py lead-error` (sites (a), (b) and
  (d), the lead's call) and by `reconcile` (site (c)); the weekly Reflection lists each (`lead-error` friction), never
  alerted.
- **D6, merge-task's reason is the engine's.** `lead-integrate.py set-aside --repo <repoPath> --merge-task <F>`
  reads the code from merge-task's sentinel and cuts the reason from `<F>`, merge-task's own output, with
  `reconcile-rollout.py`'s constants; every mistake of the lead's typing is a `lead error:` line, exit 2. The stdin
  form stays for every other lead-written set-aside.
- **D7, a row is recorded once.** Site (c) is keyed on the integrate row's `metrics.startedAt` and `finishedAt`: a
  replay writes no second line and never sets the task aside, finishing only a first pass cut short.

Built so far: items 3 and 4's count, and the re-entry at execute § 1 after a compaction, by p55-4
(`thread-skill-p55-4-a-compaction-is-counted-on-disk-and-re-enters-the-rules`; execute § 1.5 *After a compaction*).
The count of two and the hand-over stay p55-5's: nothing routes on the count yet.
- **The event.** `SessionStart` with matcher `compact`, chosen from the harness's hooks reference at the build: its
  sources are `startup`, `resume`, `clear`, `compact` and `fork`, and `compact` is an automatic or a manual
  compaction. Its `additionalContext` is added to the session's context, which is how the hook orders the lead.
  `PreCompact`'s output becomes summary instructions and `PostCompact` has no decision control, so neither can order
  it. The incident lead's transcript holds three `compact_boundary` marks and three `SessionStart:compact` hook
  attachments of this shape.
- **The output.** Exactly `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "<one line
  per rollout>"}}`. `hookEventName` is required: without it the harness drops the context as a non-blocking error.
- **The hook.** `hooks/rollout-compaction.py`, thin and fail-open: every error is swallowed, nothing reaches stderr
  and the exit is 0. It acts on a main session's compaction only (no `agent_id`, no `agent-*.jsonl` transcript;
  `agent_type` alone is a lead started with `--agent`, and counts). Its logic is `reconcile-rollout.py`'s
  `lead_compactions`, loaded in-process from the Primary checkout, which reads each rollout note under its own try, so
  one unreadable note or record never turns the hook off.
- **The count file.** `~/.config/thread/compactions/<rollout stem>/<session id>.json`, `{version: 1, rollout, session,
  count, corrected, told, at, by}`, one per (rollout, session), written through a temp file and a rename. `corrected`
  is how many the backstop added, `by` the last writer (`hook` or `heartbeat`), and `told` how many counted
  compactions have had their re-entry ordered with no stop standing, or taken at the entry that ended the stop. It is cross-version state (engine-snapshot.md §
  Cross-version state) and only widens: a reader takes `count` only under `version: 1`, a writer rewrites the object
  it read, and a file of another version is never overwritten.
- **The unit.** A compaction of the session while it was the rollout's lead. The hook reads that when it fires (the
  Run record's latest `lead-entry` names the session). The backstop reads history: a transcript mark counts when its
  time falls in a span that opens at a `lead-entry` of the session and closes at the next `lead-entry` of anything
  else, so a compaction from before the session led, or while another session did, is never counted.
- **The four lines, and the stops that defer.** Every line starts `ROLLOUT-COMPACTION <slug>: compaction <N> of this
  lead session, counted on disk (ADR 0085).` and names the engine root's `skills/execute/SKILL.md` to read as a file.
  With no stop standing it orders the re-entry at § 1 before the next launch, and the hook writes `told = count`.
  Under his pause, a standing room stop or an open halt the line says to start nothing now and to take the entry that
  ends the stop from § 1 of that text; the count rises and `told` stays, so the order is deferred, never dropped. A
  soft pause's drain, an Engine catch-up's pause and (p55-5) a Lead hand-over's own pause are no stop.
- **A deferred order is given once.** The entry that ends the stop takes the order when it is the session's own,
  its `--by` is not `heartbeat` and it is dated after the hook's write (the file's `by: hook` and `at`): the first
  tick after it writes `told = count` and reads `reenter: false`, so the skill file is read once. Otherwise that
  tick gives the order: for a deferral the backstop made itself (it raised the count, so no line was printed) and
  for one no such entry followed.
- **A halt at the heartbeat.** Clause (1) stops a tick at the halted line it can see. When a compaction cut that
  line, clause (2b)'s `record-entry --by heartbeat` closes the open halt just before (2e) runs, so (2e) reads no
  stop and orders the deferred re-entry at that same tick. No guard is added: clause (7) would re-enter such a
  rollout from the summary anyway, and the order makes that re-entry read its rules first. The verb's `halt` stop
  therefore holds for the hook, and for the verb only where no entry ran between the halt and the call.
- **The gate rule.** A compaction's re-entry is no entry point: it runs § 1.5's `resolve`, § 2's lines and
  `record-entry --by heartbeat`, § 2.5 and § 2.6, and never § 2.7 or § 2.8, so a local default branch ahead of origin
  never halts an unattended run at a compaction. An entry someone else opens after a compaction under a stop keeps its
  opener's rules.
- **`--gated`.** The line, clause (2e) and § 1.5 say the re-entry continues the run with the flags it was started
  with, and that a `--gated` run stays gated. The mode itself is on no disk (no stamp and no Run record line carries
  it), so after a compaction it lives only in the summary: a residual, which a stamp for the mode would close.
- **The backstop.** The heartbeat's clause (2e) runs `reconcile-rollout.py compactions` after (2b)'s `record-entry`.
  It raises the count to the transcript's marks and never lowers it, and its `reenter: true` (owed above zero, no
  stop standing and no entry that took the order) orders the re-entry, naming the file to read. A mark with no usable
  timestamp is never counted and is reported `undated`; a count above the marks is left as it is, with one
  `WARN: compactions:` line each tick, the only signal of a compaction counted that was not the lead's.
- **`next`.** Its JSON carries `compactions: {session, count, file}` right after `startCleared`: the caller's
  session's count for the rollout. No step routes on it; p55-5 is its first consumer.
- **Residuals.** Codex fires no hook and keeps no `~/.claude/projects` transcript, so a session-driven Codex lead's
  compactions are neither counted nor ordered. The hook matches dated rollout names only, so a legacy undated
  `<project>-rollout` note is counted and ordered by clause (2e) alone. A lead on a snapshot older than this change
  gets the hook's count and line but has no clause (2e). And with no stop standing the hook writes `told = count` on
  the strength of its print: a line the harness then fails to deliver, or one the lead reads and does not follow,
  leaves nothing owed on disk, and no test reaches the harness's own delivery. The heartbeat's lapse re-entry out of
  a room stop is `--by heartbeat`, which a tick's own liveness line is too, so it never takes a deferred order:
  after a compaction under a room stop that lapses, the lead reads the skill file at the lapse re-entry (the hook's
  line) and once more at the next tick's order, a second read of a 453 KB file (about 110k tokens) that brings the
  next compaction closer. An entry that takes the order does so on its Run record line alone: nothing checks that
  the lead read the file at it.

Built so far: items 3's line, 5, 6 and 9, and the hand-over at a Lead error's bound, by p55-5
(`thread-skill-p55-5-at-its-second-compaction-the-lead-drains-and-hands-over`; execute § 4.5 **Lead hand-over (ADR 0085
d3, d5, d6, d9).**):
- **D1, the line.** `LEAD_HANDOVER_COMPACTIONS = 2` in `reconcile-rollout.py`, named in execute SKILL.md and bound to it
  by a contract test. No setting.
- **D2, `next` starts it.** Off `--dry-run`, at the caller's count of 2 or more, or at D10's cause, with no pause of any
  kind standing and an unlanded row to hand, `next` stamps `pause_requested: true` and `paused_for: hand-over`, appends
  `- <stamp> hand-over: draining (<cause>; session <id | none>; count <n>)` to the `## Pause log` in the same save, and
  writes a Run record `hand-over` line (outcome drain). The soft pause's drain follows: nothing starts or restarts,
  hold reason `hand-over: draining (a Lead hand-over)`, idle reason `hand-over-drain`. Drained, it stamps `paused:`,
  keeps `paused_for`, writes `paused` mode hand-over and reports `halt: hand-over`. Its JSON carries `handOver` {due,
  cause, state, at, count, session, since, open, held, stop, why}. `--dry-run` never stamps and never lifts.
- **D3, the bound.** `HAND_OVER_DRAIN_MINUTES = 160` from the open `draining` line. Past it with work in flight `next`
  stamps `paused:`, writes one `hand-over: bound after <m> min: stopping <slug> (<runId>), …; lane <slug>` line (the
  Pause log entry hard-pause step 1 names, written by the engine), a `hand-over` line (outcome bound), and a hard stop's
  record (each `in_progress` Slot `slot-freed outcome=stopped`, the lane freed), through the helper `record-pause`
  shares; `halt` is `hand-over` at once with `state: bound` and `stop`. The bound never lifts the drain.
- **D4, calls the lead may no longer know** (this ADR's open point in item 5). From the first `next` that reports the
  hand-over, step 1.1's `--running` is every task call and seeded revise of the rollout /workflows lists in flight; a
  call the summary lost is reconciled on its return and starts nothing (nothing restarts in a hand-over); step 5's
  `hand-over` arm finishes only when /workflows lists none and no background Integration command is unreported, else
  ends `waiting` with `reason="lead hand-over: <n> still in flight"`; at the bound it stops them (TaskStop) and
  finishes. `handOver.open` names the calls the Run record still shows in flight that `--running` and the lane do not
  account for, with their runIds. The engine does not block `paused:` on `open`.
- **D5, the finish.** On the Stage `reconcile-rollout.py stamp-start --hand-over [--gated]` stamps `start: unattended`,
  appends `hand-over: listed[ (gated)]` and prints a `state=done` line; off it `hand-over --manual [--gated]` stamps
  nothing, appends `hand-over: manual[ (gated)]` and prints the needs-you start line and a `state=halted` line; then
  `CronDelete`. The first finish logged inside the open hand-over (the Pause log lines after its last `draining` line)
  wins; a repeat writes nothing and prints the logged lines again.
- **D6.** `STATUS_RE` is not edited: both closing lines and the arm's `waiting` line already match, and under `halted`
  the Stop hook records no halt because `paused:` stands.
- **D7, the spent session never reinstates itself.** `clear-pause` under `paused_for: hand-over` called by the handing
  session (D14's strict match) writes nothing, prints `HAND-OVER-OWED: …` and exits 4; any other caller clears and
  appends `hand-over: taken by session <id | none>`. A `next` under the hand-over's `paused:` keeps `start: unattended`.
- **D8, a drain no lead owns.** A `next` of a session that strictly differs from the drain's (both known) lifts it
  (`hand-over: lifted (another session leads)`, outcome not-handed) and goes on in the same call. A null never lifts.
- **D9, his pause takes over.** `hand-over --abort --why "his pause"` removes the stamps and a listing's `start:
  unattended`, appends `hand-over: not handed over (<why>)`, writes `resumed` when the open paused line is the
  hand-over's and outcome not-handed. It consumes neither the count nor a Lead error's cause.
- **D10, a Lead error at its bound hands over.** A `lead-error` line at `over: true` carries `handOver: true` while the
  task's total over every session (this line included) is below `LEAD_ERROR_HANDOVER_TOTAL` (6, twice the bound), else
  `handOver: false` and the site's old route stands. `next` reads such a line of the caller's session after the
  record's last `hand-over` handed line as cause `lead-error`; under it the drain is the surface wait's rule (what is
  in flight goes on to its end, nothing new begins): an awaiting row and an `integrating:` row are held
  (`handOver.held`) unless the Run record's lane is held on it, and `mark-integrating` refuses them with exit 5 and one
  `HAND-OVER:` line; the lane's holder stays in the drain whatever its stamp (awaiting between its integrate call and
  its merge). Site (c) at the bound with `handOver` is taken as below it (no set-aside).
- **D11, the Waiting list row.** `unfinished-rollout.py waiting` gains a top-level `leads` list after `next`: [{slug,
  cwd, title, prompt, harness, since}] for each root parallel note with `paused:`, `paused_for: hand-over`, `start:
  unattended` and a Project root that no fresh lead has opened (a `lead-entry` after its open `paused` line whose
  session is not the handing session; the handing session's own entries never open it). `waiting[]`, `next`, `room`
  and `running` are unchanged.
- **D12.** Readers that must not call it his pause: record-entry's gap stop `hand-over`; join accepts and carry refuses;
  the `when: paused` and regenerate gates read it as running; `catch-up` says a Lead hand-over stands; `unfinished-rollout.py`
  reads `handing over since <stamp>`, never eligible, its Project root kept; estate-dispatch holds `handing over`;
  `moving` judges the drain as work, an unfinished or opened `paused:` by silence (cause `hand-over`), a listed and
  unopened one `waiting hand-over` until `paused:` plus 45 minutes, then `waiting you`, and a manual one `waiting you`.
- **D13, the Time-lost ledger.** Two `other` causes, `hand-over` (the `paused` mode hand-over .. `resumed` span) and
  `hand-over-drain` (the drain's idle Slots), held to the reading's window; the pause stays in `own` for every
  subtraction.
- **D14, the identity rule.** The open hand-over is read from the Pause log alone (`_hand_over_open`); two sessions are
  the same only when both are valid ids and equal, so a session-less lead (Codex) is refused nothing and lifts
  nothing, and can reinstate itself: a stated residual. No hand-over line holds a wikilink.
- **D15, the carrier.** `unfinished-rollout.py needs-you` lists one `hand-over` item per handed-over note no fresh lead
  opened: a manual one at once, a listed or unfinished one once `paused:` is 45 minutes old (HAND_OVER_UNOPENED_MINUTES,
  the lease lapse), until a fresh lead enters. The Stage's machinery line already shows every needs-you item.
- **D16, nothing to hand.** No hand-over starts on a superseded note, nor where the verdict would be `empty`, `done` or
  `complete`; a drain whose last row merges is lifted (`hand-over: lifted (nothing left to hand)`).
- **D17.** Under the hand-over's `paused:`, `halt` is `hand-over` right after the whole git-env and main-red verdicts,
  ahead of `regenerate` and the rest. A hand-over is no run mark of an Approved queue (`_approved_marks`: its stamps
  while it stands, its Pause log lines always), so a queue that has not run keeps its hold and `on_merge:` through
  it, and the fresh lead's `next` regenerates after its `clear-pause`; while it stands `approved_unrun` still reads
  the queue as run, so `carry` refuses it and schedule joins it.

**For the Chorus task** (`chorus-the-stage-opens-a-handed-over-rollouts-fresh-lead`, item 11). The interface is
`waiting`'s `leads`: each row {slug, cwd (the Project root), title, prompt (`/thread:execute [[<slug>]]`, plus
` --gated` when logged), harness (`claude`), since (its `paused:`)}, listed until a fresh lead's `lead-entry` follows
its open `paused` line. A row the Stage opened must not be opened twice before it drops (its fresh lead's first
`record-entry` drops it). Until that task lands, nothing opens a listed hand-over: `needs-you`'s `hand-over` item is
the carrier, on the Stage's machinery line after 45 minutes, a manual one at once. What the Stage still owns:
(1) opening a `leads` row, once; (2) its own pause (`_stamp_pause`) takes over an Engine catch-up only, so a pause he
makes through the Stage during a hand-over's drain is absorbed by it until the Stage runs `hand-over --abort` first
(typed to the lead, it takes over); (3) `needs-you-board` has no card rule for source `hand-over`; (4) the Stage reads
any `paused:` as his pause and a `done` line as an ended lead, so no resume of the spent session is counted on.
Residuals of this build: the /workflows gate is prose the lead follows (no script reads /workflows); the bound costs
the in-flight context of at most `parallel_ceiling` tasks past 160 minutes; `--gated` rests on the lead's recall
(p55-4's residual); a session-less lead has no identity; past 45 minutes a listed hand-over asks him to start a session
even when the Stage only waits for room.

## Context

One lead session (`22a01d17`) led `thread-skill-rollout-2026-11-12` from 12 Nov 11:16 to 17 Nov 22:31 AEDT: five and a
half days, a 34 MB transcript, three context compactions (13 Nov 09:47, 15 Nov 11:07 and 17 Nov 05:39) and several
respawns (Login switches, a Mac restart).

- **The error that cost.** 24 minutes after the third compaction the lead rebuilt the Integration launch of p54-6 from
  its summary's description of the recipe. It passed the PR head as `integration.headSha`, where `prepare`'s `anchor`
  belongs. The engine's merge step refused it (`anchor … carries a merge — ANCHOR_RECIPE gives <sha>`), so nothing was
  damaged.
- **What it cost.** The set-aside that followed landed on a task whose automatic retries were already spent (2 of 2),
  so the lead's own launch error became a question for Lachy. p54-6 waited on him for 16 h 26 m (06:05 to 22:31), with
  p54-8 and 30 queued tasks behind it, and the rollout halted `stuck` at 17:42.
- **Five more errors of the same cause**, each caught by an exit code: a set-aside reason written as the lead's
  summary, where merge-task's own `ERROR:` text was needed (the retry rule read it as a human's); `ladder.py` looked
  for in the wrong directory; `gate-pricer` run as the wrong script; `bind-run` and `stamp` given flags they do not
  take; `next --running` given a count where slugs belong.

All six errors followed the third compaction. His words of 17 Nov 2026:

> Sessions should have a limit to how many times they compress the context and that sort of thing. We should unpack
> this so that this doesn't happen again.

What already existed, and did not hold:

- **A compaction is already a § 1 entry, in prose only.** execute § 1.5 says "At § 1 entries only (an invocation, and
  again after a compaction)", and `skills/_shared/engine-snapshot.md` (*When resolve runs*) says the same. No script
  enforces it: `hooks/hooks.json` holds two PreToolUse hooks and one Stop hook, and none runs on a compaction. After
  each compaction the lead carried on from its summary and never re-read SKILL.md from its engine root. The grill also
  found that the harness cuts the skill text in context at a compaction.
- **The anchor has since moved into a script.** The incident's lead ran Engine snapshot `89f5429b175c` (the rollout
  note's reinstate line of 2026-11-12; the note moved to `302490ba440a` at 2026-11-17T22:34+11:00, after the
  incident). That snapshot predates p47-11 (`8aea414`, #407, 15 Nov), which added `lead-integrate.py call`. Today
  `call` prints the integrate call's `integration` object whole, and a hand-altered sha is an *Args refusal* before
  anything dispatches. The lead still assembles the rest of the call by hand: § 4's args, the task object, the ladder
  and `mode: 'integrate'` (execute § 4.5, **The integrate call**).
- **A set-aside's reason is typed by the lead.** `lead-integrate.py set-aside` reads its reason on stdin. For a
  merge-task stop, § 4.5 step 4's row 1 asks for `merge-task: <its output from its last ERROR: line to the end>`, the
  cause `reconcile-rollout.py`'s `_merge_task_cause` cuts. Nothing held the lead to that text.
- **A serial rollout already has the answer for its shape.** A Leg closes and hands the rest to a fresh Leg. On the
  Chorus Stage that hand-over is `leg.py handed --listed`: the chain is listed on the Waiting list, with no handoff
  doc and no `create_thread` (legs.md § Hand over; ADR 0076 d4 as P44-4 amends it). A parallel rollout's lead has no
  such hand-over.
- **Two standing rules say a session never starts its own handoff:** handoff's **Invocation gate.** ("Never
  self-initiate a handoff because the session feels long or the context is filling") and the Stage's own rule for
  `create_thread`. So a lead cannot simply fork itself to a fresh session.

## Decision

1. **A parallel rollout's lead hands over to a fresh session by itself.** Ruled by Lachy, 18 Nov 2026:

   > Automatic at a fixed compaction count, set in the skill, so limits don't depend on memory.

   The hand-over is automatic, its line is a count of compactions, and the count lives in the skill, never in the
   lead's recall.
2. **A lead's own mistake never reaches him.** Decided for him on 18 Nov 2026 from his priorities, and standing: the
   lead redoes its own launch error, and the redo spends none of the task's retries. Why: rollouts run without him
   knowing, and a wait is never his.

How each is built is technical, and is the list under *Decided for him (overturnable)*, items 3 to 11.

## Considered options

- **The four lines of the grill's first question:** the first compaction, a count of them, a number of tasks landed,
  or a number of days. His ruling takes the count of compactions; tasks landed and days were not taken.
- **A count of three:** rejected. It leaves no margin: all six errors of the incident followed the third compaction.
- **A count of one:** rejected. It costs a drain at every compaction, when the § 1 re-entry already covers the first.
- **An ADR that amends handoff's Invocation gate for a rollout's lead:** rejected. The seam a Leg already uses exists
  (item 6), so no session needs leave to start its own handoff.
- **An operator setting for the count:** rejected by his words, "set in the skill".

## Consequences

- A hand-over costs one drain, about every second compaction of a lead.
- A signed-gate handle goes at the compaction, before the hand-over. A gate-pending task's handle lives only in the
  lead's session, and "compaction or a new session loses it" (execute § 3.7, **The signed-gate handle.**). So the
  hand-over costs no handle its compaction had not already cost; only a handle a call returns during the drain ends
  with the old lead's session. After his sign-off the task takes a fresh call (§ 3.7, *Can no longer resume*), as it
  does after any compaction or new session.
- p55-4's hook will run from the session's plugin root, while `next` runs from the rollout's Engine snapshot. So the
  count's file will be cross-version state (engine-snapshot.md § Cross-version state): once written, its form only
  widens.
- The fresh lead's entry will be execute's reinstate path (§ 4.5 *Reinstate*: `clear-pause`, then the cold resume).
  The hand-over's pause will be the engine's own, and the move rule as it stands (`engine-snapshot.py`'s header) reads
  any `paused_for:` value but `catch-up` as the engine's own pause, never a move. So the Engine snapshot will not move
  at a hand-over, as a handed-off Leg moves nothing for a stamped chain (ADR 0043). A waiting engine Speed fix will
  still be taken, by an Engine catch-up at the fresh lead's first loop entry, with nothing running.
- **Left to the build.** Named here and not decided; the task that builds each records it back into this ADR's Status:
  - the hook's event, the count file's shape and the heartbeat backstop (p55-4; built, its Status above);
  - the drain's bound and what follows it, the Run record's lines and the Time-lost ledger's cause (p55-5; built, its
    Status above);
  - a Lead error's Run record line and the bound on repeats; whether the lead-caused halts that stand today (item 8's
    *In the code* note: the *Args refusal* halt and § 4's two pre-check halts) become Lead errors; and the rewording of
    execute's "a lead bug" at those sites (§ 4.5's **Args refusal (p32-1)** and § 7's halt list), a wording
    CONTEXT.md's **Lead error** entry lists under _Avoid_ (p55-3; built, its Status above);
  - at a Lead error's bound (its line's `over: true`) the lead hands over in place of the interim route p55-3 left
    (the site's old halt, set-aside or exit route), and `lead-error`'s `total` (every session's count) stops a
    hand-over loop on a refusal every fresh lead repeats (p55-5; built, its Status above: `handOver` on the `over`
    line, LEAD_ERROR_HANDOVER_TOTAL);
  - ADR 0076's in-place amendment note (its d3, d4 and Decided for Lachy 4) and CONTEXT.md's **Waiting list** wording,
    when p55-5 builds the row (built by p55-5).
- The hand-over runs since p55-5: CONTEXT.md's **Lead hand-over** entry says the count and the § 1 re-entry are
  p55-4's and the hand-over p55-5's, and its **Waiting list** entry holds the `leads` row. Its **Lead error** entry
  is built (p55-3) and hands over at its bound (p55-5). The Stage opening a listed hand-over is the Chorus task's.

## Decided for him (overturnable)

Technical calls made in his place at the orient grill of 2026-11-24 (ADR 0054). Each stands unless the code shows it
wrong, and he can overturn any. The numbers carry on from the Decision's two rulings. None of it is built: each item's
*In the code* note says what stands today and which task builds the rest. (Each note is as the orient grill wrote it; p55-2 to
p55-5 have since built items 3 to 9, and the Status above records what each built.)

3. **The count is two.** After its first compaction a lead will re-enter execute § 1 from its engine root; at its
   second it will hand over. Why: all six launch errors of the incident followed the third compaction, so two leaves
   one compaction of margin, and a hand-over costs one drain. *In the code:* the count and the re-entry after each
   compaction are built by p55-4 (Status above): the hook counts and orders the re-entry, and the heartbeat's clause
   (2e) backs both up. The line at two, and the hand-over there, are p55-5's.
4. **The count lives on disk and in the engine.** A hook on the harness's compaction event will count it, per session
   and rollout; `next` will read the count and return the hand-over. The number will be a constant in the engine,
   named in `skills/execute/SKILL.md`; it is no operator setting, and the lead never counts from recall. Why: his
   ruling, "so limits don't depend on memory". *In the code:* built by p55-4 (Status above): the hook is
   `hooks/rollout-compaction.py` on `SessionStart` with matcher `compact`, the count is a file per session and rollout
   under `~/.config/thread/compactions/`, and `next` reports it as `compactions`. A Run record `lead-entry` line
   carries `{by, session?, stop?}`, its session defaulting to `CLAUDE_CODE_SESSION_ID`: that is how the hook tells
   which session is a rollout's lead. `next` returns no hand-over yet, and the engine holds no constant for the
   number: both are p55-5's.
5. **The hand-over is a drain, then the Waiting list.** It will drain as an Engine catch-up drains (CONTEXT.md
   **Engine catch-up**): no new start, the calls in flight finish, and the drain is bounded. Then the note will be
   paused with `paused_for: hand-over` and listed on the Waiting list; the Chorus Stage will open a fresh lead in the
   Project root, and that lead's § 1 entry will be the Reinstate. Off the Stage it will be one needs-you line with the
   `/thread:execute [[<rollout>]]` start line. Why: a drain cuts no task mid-step, and the Waiting list is where a
   chain with no session already waits for one. *In the code:* all of it is p55-5's to build. An Engine catch-up's
   drain is `pause_requested` with `paused_for: catch-up`, bounded at 160 minutes; this ADR gives the hand-over's
   bound no number. "The calls in flight finish" needs the lead to still know its calls, and a hand-over's drain
   starts right after a compaction, unlike an Engine catch-up's. The lost-handle rule is what stands today (execute
   § Room stop item 10, **A lost handle.**): a compaction can lose a session's run handles, a task call or seeded
   revise whose handle is lost is listed by `next` in `restart`, and an integrate call whose handle is lost frees the
   lane. How the drain treats such a call is p55-5's, under *Left to the build*'s "the drain's bound and what follows
   it". `paused_for:` has two values today, `sign-off` and `catch-up`. The Waiting list holds serial chains only
   (CONTEXT.md **Waiting list**, `unfinished-rollout.py waiting`, ADR 0076 d3 and Decided for Lachy 4): a parallel
   note's `start: unattended` is **Start when ready**'s, and `reconcile-rollout.py stamp-start` refuses a paused note
   and one that has run. So listing a handed-over parallel rollout needs a new writer and a new row.
6. **No session starts its own handoff.** The hand-over will write no handoff doc and call no `create_thread`:
   handoff's Invocation gate and the Stage's own rule stand unchanged. It is the seam a Leg already uses
   (`leg.py handed --listed`, ADR 0076 d4). Why: the seam exists, so neither rule needs an exception. *In the code:*
   legs.md § Hand over is the Leg's copy, and it is not edited; the lead's own writer is p55-5's.
7. **One command builds an integrate call's whole args**, so no lead assembles them by hand. Why: the incident's
   launch was rebuilt from a summary's description of the recipe, and a command leaves nothing to rebuild. *In the
   code:* p47-11's `lead-integrate.py call` already prints the `integration` object, so a lead that runs `call` types
   no sha. A retyped one is refused before anything dispatches (execute § 4.5, **Args refusal (p32-1)**), and is no
   longer a set-aside: no set-aside row is written and no retry is spent. That much of the p54-6 error is closed on a
   current snapshot, and no more: an Args refusal halts the whole rollout (execute § 7,
   `state=halted reason="engine refused the args of [[<slug>]]"`, kept under *Threatens every task*), so a lead that
   rebuilds the call from a summary still stops the queue. What p55-2 builds is the rest: § 4's args, the task object,
   the ladder and `mode: 'integrate'`. Built by p55-2: the whole args are now `call`'s, printed as one `args` object the
   lead passes verbatim, and a seeded revise's whole args are `call --revise`'s, its `task.resume` and plan included
   (execute § 4.5 steps 3 and 1.2). A task's own call is still built by the lead (§ 4).
8. **A stop the lead caused is a Lead error.** It is redone from the values the engine names, with no retry spent and
   never a set-aside; and a set-aside's reason is always the engine's own text, never the lead's summary. Why: ruling
   2, and the retry rule read a lead's summary as a human's. *In the code:* built by p55-3 (Status above). A Lead error
   is execute § 4.5's **Lead error (ADR 0085 d8).**: its four sites, its signatures, its redo in place and its bound
   (`LEAD_ERROR_BOUND`, 3 per task per lead session), each recorded as one Run record `lead-error` line. The three
   lead-caused § 7 halts (the *Args refusal*'s `engine refused the args of [[<slug>]]` and § 4's two pre-check halts)
   are Lead errors, a halt only at the bound, and execute no longer calls them "a lead bug". A merge-task set-aside's
   reason is the engine's own text: `lead-integrate.py set-aside --merge-task` cuts it from merge-task's output; the
   lead still types the reason of every other set-aside it writes (`prepare`'s, a dead call's, a decline's, the RACE
   landing tail's), on stdin.
9. **His pause takes over** a hand-over's drain, as it does an Engine catch-up's. Why: the drain is the engine's own,
   never a pause he made. *In the code:* execute § Pausing's paragraph **His pause over an Engine catch-up.**
   (`catch-up --abort --why "his pause"`) is the rule today; p55-5 gives the hand-over's drain the same.
10. **A serial chain is unchanged.** A Leg already hands over, so this ADR adds nothing to legs.md or `leg.py`. *In
    the code:* legs.md § Hand over and `leg.py handed --listed` stand as they are, and no task here edits them.
11. **The Chorus half is its own task**, `chorus-the-stage-opens-a-handed-over-rollouts-fresh-lead`: the Stage opening
    the fresh lead, and whether any Session gets a compaction limit. Why: sessions are the Stage's to open and to
    limit, as Legs' sessions already are (ADR 0076 Decided for Lachy 2). *In the code:* nothing in this repo: the
    Stage's opener is Chorus's.
