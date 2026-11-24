# 0085 — A rollout's lead hands over at its second compaction

Date: 2026-11-24
Status: accepted, not built. Lachy's rulings of 2026-11-18, on the two questions of the grill note
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
  - the hook's event, the count file's shape and the heartbeat backstop (p55-4);
  - the drain's bound and what follows it, the Run record's lines and the Time-lost ledger's cause (p55-5);
  - a Lead error's Run record line and the bound on repeats; whether the lead-caused halts that stand today (item 8's
    *In the code* note: the *Args refusal* halt and § 4's two pre-check halts) become Lead errors; and the rewording of
    execute's "a lead bug" at those sites (§ 4.5's **Args refusal (p32-1)** and § 7's halt list), a wording
    CONTEXT.md's **Lead error** entry lists under _Avoid_ (p55-3; built, its Status above);
  - at a Lead error's bound (its line's `over: true`) the lead hands over in place of the interim route p55-3 left
    (the site's old halt, set-aside or exit route), and `lead-error`'s `total` (every session's count) stops a
    hand-over loop on a refusal every fresh lead repeats (p55-5; the seam is `over`, `total` and
    `reconcile-rollout.py`'s `_lead_errors()`);
  - ADR 0076's in-place amendment note (its d3, d4 and Decided for Lachy 4) and CONTEXT.md's **Waiting list** wording,
    when p55-5 builds the row.
- Until those tasks land, nothing here runs: CONTEXT.md's **Lead hand-over** entry says "not yet built", and its
  **Waiting list** entry still reads as serial chains only. Its **Lead error** entry is built (p55-3).

## Decided for him (overturnable)

Technical calls made in his place at the orient grill of 2026-11-24 (ADR 0054). Each stands unless the code shows it
wrong, and he can overturn any. The numbers carry on from the Decision's two rulings. None of it is built: each item's
*In the code* note says what stands today and which task builds the rest.

3. **The count is two.** After its first compaction a lead will re-enter execute § 1 from its engine root; at its
   second it will hand over. Why: all six launch errors of the incident followed the third compaction, so two leaves
   one compaction of margin, and a hand-over costs one drain. *In the code:* the first compaction's re-entry is
   today's prose rule (execute § 1.5), which no script enforces, and nothing counts a compaction; p55-4 builds both.
4. **The count lives on disk and in the engine.** A hook on the harness's compaction event will count it, per session
   and rollout; `next` will read the count and return the hand-over. The number will be a constant in the engine,
   named in `skills/execute/SKILL.md`; it is no operator setting, and the lead never counts from recall. Why: his
   ruling, "so limits don't depend on memory". *In the code:* the plugin has no hook on a compaction, so the hook is
   new and p55-4 builds it; this ADR names no event, and p55-4 chooses it from the harness's current hooks reference.
   A Run record `lead-entry` line carries `{by, session?, stop?}`, its session defaulting to
   `CLAUDE_CODE_SESSION_ID`: that is how p55-4 can tell which session is a rollout's lead.
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
