# 0041 — orient-all runs the estate pass

Date: 2026-10-19
Status: proposed. Grilled with Lachy on 2026-10-19, after a hand-run audit on 2026-10-18 started eight new rollouts in about an hour. To be built as P25, after P24.
*(Amended by ADR 0054, 2026-10-27: the decision round asks only his own decisions (owner `yours`), in the Framing of
`skills/_shared/asking.md`, and only those count toward the grade, the raise, the decision minutes and the Grade log;
the calls the grade rules for him go to the task note's `## Decided for you (<date>)`, never asked.)*

## Context

Lachy's scarcest resource is attention, not usage limits. The question he wants answered, often, is "where is my attention best placed to get the most work moving?", asked across every project in the vault. Orient answers it for one project. The 2026-10-18 audit did it across the whole vault, by hand.

## Decision

**`/thread:orient-all` is orient at estate altitude.** Bare `orient` and `orient-all` are one act at two altitudes; orient is not renamed. orient-all never reshapes a project itself.

- **It reads live state first.** It runs `status` on every unfinished rollout and asks a running session before relaying anything to it. Pending sign-offs join the decision round, and a stalled rollout gets a `repair` session.
- **It grades every open task in a cheap scan-only pass,** with one **Readiness grade**:
  - **Ready:** an agent can finish it without inventing a decision nothing records.
  - **One call:** a single decision, offered with a recommendation.
  - **Grill:** a few low-level decisions.
  - **Orient:** the decisions shape the project.

  Recommendations come from a per-project agent that has read that project's thread, ADRs and code. When that agent can't recommend with confidence, the task's grade goes up.
- **It ranks by agent work per minute of Lachy's attention.** Crowned projects come first and parked ones last. Deadlines (a `due:` date, or an event or season about to pass) rank above leverage.
- **Each parked project with ready work gets an Unpark offer:** unpark it (it becomes queued), snooze it for a fortnight unless its ready work grows, or kill it.
- **It spends Lachy's stated time budget.**
  1. One-call decisions, batched.
  2. Grills, in this session, while time remains.
  3. Orient-graded projects get their own child `orient` session, whatever the budget.

  The **Review load** each run will hand back is shown beside it.
- **It starts everything itself.** In Chorus it starts parallel rollout executes, serial rollout Legs, repairs and child orients as visible sessions. Anywhere else, it ends with one paste-ready prompt per session.
- **It logs each grade against the task's outcome** (merged, set aside, bounced back to Lachy). The weekly Reflection reads that log to tune the grading.

## Considered options

- **A mode of orient (`--estate`):** rejected. It would weigh down a SKILL.md built for deep, single-project reshuffles.
- **Rollouts only:** rejected. Most of the vault is serial-shaped, which ADR 0040 now covers.
- **"rally", or a renamed pair (regroup/rally):** rejected for orient / orient-all. The pair makes the altitude relationship plain and needs no migration.
- **Stop at the ranked slate, or raise Execute cards for Lachy to start:** rejected for auto-start. Lachy chose fewer clicks over a final look; each started session is still visible and steerable.
- **Auto-start the executes only:** rejected. Child orients and repairs start too, even though they wait on Lachy.

## Consequences

- No surveyed tool ranks across projects (research 2026-10-19). These pieces were borrowed:
  - Devin's ready / has-questions / human tiers;
  - BMAD's readiness wording;
  - ccpm's deterministic scan with the model reserved for decisions;
  - WSJF's time-criticality term;
  - GTD's Someday/Maybe review behind the Unpark offer.
- Auto-start opens several sessions at once, and the child orients wait on Lachy. The time budget bounds the parent's questions, not the children's.

## Build rulings

Rulings made while P25 is built. No build grill ran for P25, so each bullet is a plan's reading of the Decision above, dated and naming its canonical file. Each awaits Lachy's confirmation.

- **How the slate ranks** (the p25-2 plan, 2026-10-20; `skills/_shared/readiness-grade.md` is canonical).
  - *The key, an interpretation for Lachy to confirm.* The Decision says crowned projects come first, parked ones last, and deadlines rank above leverage. This reading also puts deadlines above the crowned set: the key is parked last, then work due within a fortnight (overdue included), then crowned projects, then leverage, and a parked project's work stays last whatever its deadlines. The literal alternative (crowned above deadlines) would bury every overdue task under the crowned project's whole backlog. Flipping it is one tuple in `estate-rank.py`.
  - *Crowned* means `status: crowned`, never a `crowned:` date, which queued projects carry too.
  - *The raise.* The decision count implies a grade (none is Ready, one is One call, two or more is Grill), and a task takes the higher of that and the agent's grade; then any decision the agent cannot recommend on with confidence raises it one step. A One call or Grill with no decision is invalid, and every decision offers 2 to 4 options with the recommendation among them.
  - *Holds.* Only `depends-on:` and `blocked-by:` hold a task, as in the queue. A dependency that is in flight, or graded Ready and not held (and not in another, parked project), does not hold; anything else does, transitively. A hold never moves a rank: it sets the task apart in its run and keeps it out of the Unpark count.
  - *Parked work waits on its Unpark offer.* A parked project's One calls and Grills stay out of the decision rounds and its Orient tasks out of `orient[]`, so the pass starts no session on a shelved project.
  - *The snooze record* is two keys in the project note's frontmatter, `snoozed_until` and `snoozed_ready`, written only by `estate-rank.py snooze`, beside the `status: parked` the unpark and kill writes change. Those writes clear it in the same save as their status write, so a snooze never outlives an unpark or kill made through the offer to hide the project when it is parked again.
  - *The constants* (agent minutes per size, Lachy's minutes per decision and per review item, the fortnight) are starting values, pinned between the doc and the script. The weekly Reflection changes them as rule Tunings, never as knobs. The Grade log measures only the agent minutes per size (through Slot hours); the rest have no measure in the record (amended by the p25-4 plan, 2026-10-20).
- **How the pass asks and starts work** (the p25-3 plan, 2026-10-20; `skills/orient-all/SKILL.md` is canonical). Interpretations of the Decision, for Lachy to confirm:
  - *The budget order.* Pending sign-offs are asked first and always, whatever the budget; then the One calls, then the Unpark offers, then the Grills, each in rank order, until the first that does not fit the minutes left.
  - *A sign-off is asked only after its gates are shown verbatim*, the plan judge's bounce under them, and the `Sign off` answer lists exactly the lines `approve-gates` will sign.
  - *Schedules run through forks that ask and route nothing.* Each fork answers schedule's questions as orient-all § 6 lists them, returns its misfits unrouted, and forks for names that could meet on one note slug run one at a time.
  - *Only decided, unheld members are scheduled*, each only when every dependency it needs is scheduled too (a rollout row waits until its dependency lands, and an unscheduled, dropped or missing one never would), one parallel run per root, and nothing is superseded: a run that waits names why. A member whose dependency cannot go whatever the root contest decides is held before the contest, so a root goes to the best-ranked run that can use it. One held after the contest stays held for the pass, so the plan never flips back: its why names a dependency as not scheduled only when no scheduled run holds it, and otherwise says `dependency scheduled late`, and it goes next pass.
  - *An unpark dispatches now*: the unparked project's Ready, unheld work starts in the same pass.
  - *Kill is Mark done*: `done: true` and `completed:`, as the vault's own Mark done writes it.
  - *Live rollouts get sessions only on status's actions 6, 7, 8 (a sign-off signed in this pass, and no other hold), 11 and 13*, behind the plan's holds, and never on 9, 10, 12 or a plain pause, so no second lead is ever started.
  - *Child orients are held only by a Session named exactly the orient item's title* (`Orient: <project>`, cut as `create_thread` was given it), start after every execute, and name the note the pass wrote for their project.
  - *Execute and Leg items are found by the roster's slug* (p34-7, 2026-10-31): a Session whose `list_sessions` line carries `leads the Rollout <slug>`, that slug equal to the item's rollout exactly (case aside, never a prefix), is the item's candidate whatever its name, and is relayed by id, unread; the old names count only when no line names the slug, and only for a Session whose line names no slug (`leads a Rollout` included); a led rollout's execute or Leg item never gets `create_thread` (a repair item beside its lead still does), and a raise is reported as raised, never counted as started (chorus-p89-1, Chorus ADR 0077 as amended 2026-10-27).
  - *Session-lane work is listed, never started.*
- **How grades are logged and joined** (the p25-4 plan, 2026-10-20; `skills/reflect/scripts/grades.py` is canonical). Interpretations of the Decision's grade log, for Lachy to confirm:
  - *Logged after the rank.* `estate-dispatch.py log` writes one line per graded task per pass, Orient included, into `grades.jsonl` beside the Run record, right after `estate-rank.py rank`; a dry run never logs. A task whose note name is no slug (spaces or capitals) has no line: the Run record keys tasks by slug, so it is skipped and reported as a caveat, and the rest of the pass is logged.
  - *Joined at read time.* No close path writes anything: the weekly reading joins each grade to the Run record and the task's note when it reads them.
  - *Every grade is scored over its own episode*, from its line to the task's next grade or its close, so a miss that sends a task back stays against the grade that missed, and the next grade is scored on its own.
  - *One outcome rule and one denominator.* An episode is hands-off, bounced (any act from Lachy, whatever the end), regraded or dropped once dispatched, and those four make each grade's hands-off rate; work done by hand, never dispatched, still open or whose note is gone is reported beside the rate, never in it.
  - *The acts are ADR 0037's.* A sign-off on a grade that named its gates is foreseen Review load, kept out of the bounce whenever it is signed.
  - *Report only.* A miss is traced to the grading rules and becomes a Watch or a rule proposal, never a knob.
