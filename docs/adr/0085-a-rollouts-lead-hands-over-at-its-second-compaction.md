# 0085 — A rollout's lead hands over at its second compaction

Date: 2026-11-24
Status: accepted, not built. Lachy's rulings of 2026-11-18, on the two questions of the grill note
`thread-skill-grill-a-rollout-lead-hands-over-before-compaction-costs`; the technical calls were decided for him at the
orient grill of 2026-11-24 (ADR 0054) and are listed last, each overturnable. Written by Phase 55 · Task 1
(`thread-skill-p55-1-adr-0085-a-rollouts-lead-hands-over-at-its-second-compaction`); p55-2 to p55-5 and one Chorus
task build it, and each records what it built back into this Status. Amends ADR 0076: its Decided for Lachy 4, and
d4's last sentence ("Parallel rollouts keep one lead each, started as today"), since once p55-5 builds it a parallel
rollout whose lead has handed over waits on the Waiting list. Leaves ADR 0043, ADR 0057 and handoff's
**Invocation gate.** as they are. Extends ADR 0030 decision 5's drain, and gives `paused_for:` a third value beside
`sign-off` (ADR 0034) and `catch-up` (ADR 0084 d5).

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
- A gate-pending task's signed-gate handle ends with the old lead's session. After his sign-off the task takes a fresh
  call (execute § 3.7, *Can no longer resume*), as it does after any new session.
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
  - a Lead error's Run record line and the bound on repeats (p55-3);
  - ADR 0076's in-place amendment note and CONTEXT.md's **Waiting list** wording, when p55-5 builds the row.
- Until those tasks land, nothing here runs: CONTEXT.md's **Lead hand-over** and **Lead error** entries say "not yet
  built", and its **Waiting list** entry still reads as serial chains only.

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
   bound no number. `paused_for:` has two values today, `sign-off` and `catch-up`. The Waiting list holds serial
   chains only (CONTEXT.md **Waiting list**, `unfinished-rollout.py waiting`, ADR 0076 Decided for Lachy 4): a parallel
   note's `start: unattended` is **Start when ready**'s, and `reconcile-rollout.py stamp-start` refuses a paused note
   and one that has run. So listing a handed-over parallel rollout needs a new writer and a new row.
6. **No session starts its own handoff.** The hand-over will write no handoff doc and call no `create_thread`:
   handoff's Invocation gate and the Stage's own rule stand unchanged. It is the seam a Leg already uses
   (`leg.py handed --listed`, ADR 0076 d4). Why: the seam exists, so neither rule needs an exception. *In the code:*
   legs.md § Hand over is the Leg's copy, and it is not edited; the lead's own writer is p55-5's.
7. **One command builds an integrate call's whole args**, so no lead assembles them by hand. Why: the incident's
   launch was rebuilt from a summary's description of the recipe, and a command leaves nothing to rebuild. *In the
   code:* p47-11's `lead-integrate.py call` already prints the `integration` object, so the p54-6 error itself is
   closed on a current snapshot. What p55-2 builds is the rest: § 4's args, the task object, the ladder and
   `mode: 'integrate'`.
8. **A stop the lead caused is a Lead error.** It is redone from the values the engine names, with no retry spent and
   never a set-aside; and a set-aside's reason is always the engine's own text, never the lead's summary. Why: ruling
   2, and the retry rule read a lead's summary as a human's. *In the code:* the lead types a set-aside's reason today
   (`lead-integrate.py set-aside`, on stdin); p55-3 builds the Lead error and the engine's own reason text.
9. **His pause takes over** a hand-over's drain, as it does an Engine catch-up's. Why: the drain is the engine's own,
   never a pause he made. *In the code:* execute § Pausing's paragraph **His pause over an Engine catch-up.**
   (`catch-up --abort --why "his pause"`) is the rule today; p55-5 gives the hand-over's drain the same.
10. **A serial chain is unchanged.** A Leg already hands over, so this ADR adds nothing to legs.md or `leg.py`.
11. **The Chorus half is its own task**, `chorus-the-stage-opens-a-handed-over-rollouts-fresh-lead`: the Stage opening
    the fresh lead, and whether any Session gets a compaction limit. Why: sessions are the Stage's to open and to
    limit, as Legs' sessions already are (ADR 0076 Decided for Lachy 2).
