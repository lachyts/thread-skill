# 0041 — orient-all runs the estate pass

Date: 2026-10-19
Status: proposed. Grilled with Lachy on 2026-10-19, after a hand-run audit on 2026-10-18 started eight new rollouts in about an hour. To be built as P25, after P24.

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

Rulings made while P25 is built. No build grill ran for P25, so each bullet is a plan's reading of the Decision above, dated and naming its canonical file. The first awaits Lachy's confirmation.

- **How the slate ranks** (the p25-2 plan, 2026-10-20; `skills/_shared/readiness-grade.md` is canonical).
  - *The key, an interpretation for Lachy to confirm.* The Decision says crowned projects come first, parked ones last, and deadlines rank above leverage. This reading also puts deadlines above the crowned set: the key is parked last, then work due within a fortnight (overdue included), then crowned projects, then leverage, and a parked project's work stays last whatever its deadlines. The literal alternative (crowned above deadlines) would bury every overdue task under the crowned project's whole backlog. Flipping it is one tuple in `estate-rank.py`.
  - *Crowned* means `status: crowned`, never a `crowned:` date, which queued projects carry too.
  - *The raise.* The decision count implies a grade (none is Ready, one is One call, two or more is Grill), and a task takes the higher of that and the agent's grade; then any decision the agent cannot recommend on with confidence raises it one step. A One call or Grill with no decision is invalid, and every decision offers 2 to 4 options with the recommendation among them.
  - *Holds.* Only `depends-on:` and `blocked-by:` hold a task, as in the queue. A dependency that is in flight, or graded Ready and not held (and not in another, parked project), does not hold; anything else does, transitively. A hold never moves a rank: it sets the task apart in its run and keeps it out of the Unpark count.
  - *Parked work waits on its Unpark offer.* A parked project's One calls and Grills stay out of the decision rounds and its Orient tasks out of `orient[]`, so the pass starts no session on a shelved project.
  - *The snooze record* is two keys in the project note's frontmatter, `snoozed_until` and `snoozed_ready`, written only by `estate-rank.py snooze`, beside the `status: parked` the unpark and kill writes change. Those writes clear it first (`snooze --clear`), so a snooze never outlives an unpark or kill made through the offer to hide the project when it is parked again.
  - *The constants* (agent minutes per size, Lachy's minutes per decision and per review item, the fortnight) are starting values, pinned between the doc and the script, for the grade log and the weekly Reflection to tune.
