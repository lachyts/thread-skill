# 0079 — Fable takes roles side by side, and each role earns its place

Date: 2026-11-12
Status: accepted, not built (grilled with Lachy 2026-11-12 at a `/thread:orient Thread Skill` reshuffle; builds as
Phase 46; amends ADR 0029 decisions 1, 4 and 5). Nothing here runs until Lachy edits `~/.agents/AGENTS.md` § Model
tier by hand: that section is the Opus lock, and the wording proposed for it is at the end.

## Context

ADR 0029 kept Fable off the built-in ladder and said a replay of hard rollout tasks would decide whether it joins.
That replay was dropped on 2026-10-09 and never ran. Fable 5.2 shipped on 2026-11-09, and Lachy asked where it fits.

A first draft made Fable a rung reached only when a task was about to be set aside. He rejected it: *"I don't want
to use it just as a last resort. I want it to be part of the many tools that we use … we can earn the right of
using it more, log it, and see the effectiveness of it."* Asked how wide to start, he picked the widest option:
*everything, now.* On the weekly allowance: *"I have four different accounts and if I need to get more accounts,
I'm happy to get more … using them in a way that feels balanced so that we're not burning all the Fable credit
(and then we have this Opus credit that we could be using) … I don't want to have this stuff locked … that doesn't
have to be perfect either."*

What was known on 2026-11-12:

- **Published.** Anthropic's own results put Fable 5.2 ahead of Opus 5.5 on agentic coding (FrontierSWE v2 69.9%
  to 62.3%, FrontierCode 2.0 49.1% to 45.5%) and on long jobs (Remote Labor Index 41.3% to 21.3%), and report Fable
  at `high` matching Opus at `max` for about half the cost per task. The one independent number is Artificial
  Analysis's index, 62 at `high` against 59. Nothing independent measures coding, and nothing at all measures
  orchestration, plan judging or review. Anthropic's guidance: start at `high`; gains above it are uneven. The
  token price is twice Opus's.
- **Behaviour.** Anthropic's prompting guide says Fable 5.2 follows "never" rules to the letter, that cautions pile
  up where several agents work together so it holds back routine steps, that it makes changes nobody asked for when
  told it owns the code, and that its summaries leave small changes out.
- **The Run record,** from mid-October: 860 tasks merged across 90 rollouts; 111 were set aside because no plan
  passed its judge on the top Opus rung, 28 blocked in implementation and 7 spent their review rounds; the first
  review asked for changes on 436 of 683 tasks. The weekly Reflection of 2026-11-09 traced Escapes in four rollouts
  to the master review passing code a later review flagged.
- **Allowance.** Each Claude Login has its own weekly Fable window beside its general one, and all four Fable
  windows read 0% used. Whether Fable use also draws down the general window was not confirmed.
- **The engine.** A Rung holds one model for every role, so "Fable plans, Opus builds" cannot be said. Escalation
  climbs once per stage, so a third rung is not reached by a stage that already climbed. A model-allowance refusal
  reads as a transient failure, which stalled two rollouts in September 2026.

## Decision

1. **Fable is assigned by Role, never by its place on the Ladder.** A Role may name its own model. The roles that
   start: shaping (orient, orient-all, schedule's readiness grading), planning, plan judging, building a task whose
   `work_depth` is deep, the final review, diagnosis (repair, the blocked-task investigator, the weekly Reflection,
   audits) and leading a rollout. Routine builds and Integration stay on Opus.
2. **Every role starts side by side.** Each role has two **Arms**, Opus and Fable. A task falls in one arm for a
   role by a draw fixed by its name, a rollout's lead by a draw fixed by the rollout's name, and each role draws on
   its own. Nothing picks an arm by how hard the work looks.
3. **Both arms run under the same rules:** the same review rule, the same round budgets, the same gates. A Fable
   role runs at `high` on every rung.
4. **The Fable share is paced to the allowance.** Per Login, the share of work drawn into Fable arms follows what
   is left, so that the Fable window and the general window run down together through the week. It need not be
   exact, and allowance left over at the week's end is fine. Nothing is held in reserve for hand sessions. The rule
   takes any number of Logins.
5. **Nothing locks.** When a Login's Fable allowance is spent, a role drawn into the Fable arm runs on Opus, the
   Run record says so, and that task is left out of the comparison. An allowance refusal is its own outcome, never a
   transient failure and never a stop.
6. **The Run record carries the measure:** for each role of each task, its arm, the model and effort that ran, its
   tokens and its outcome.
7. **The weekly Reflection reads each role's two arms** inside its window: rejected plans, the first review's
   verdict, review rounds, Escapes, tokens per merge and the Hands-off rate. A role whose Fable arm wins on Quality
   without costing the Hands-off rate widens on its own, and the Reflection says so. A trade (ADR 0037 decision 1)
   goes to Lachy's decision task. A role that loses shrinks to nothing. The same reading says when another Login
   would have carried Fable work that fell back to Opus.
8. **The built-in ladder is unchanged** (ADR 0029 decision 2 stands): with no operator file, every role runs on
   Opus. Fable roles are named in the operator's file.

Considered:

- *A last-resort rung* (the first draft, rejected by Lachy): it uses Fable least where it may help most, and one
  climb per stage would rarely reach it.
- *An ordinary third rung:* it puts every role of a hard task on one model, and says nothing about planning or
  review on an easy one.
- *Switching roles to Fable outright and comparing weeks:* rollouts differ too much week to week for a before and
  after to mean anything.
- *One draw per task for all its roles:* it cannot tell a better plan from a better review.
- *A reserve for hand sessions* (offered to Lachy, turned down): capacity is his to add, and a reserve leaves
  allowance idle by design.
- *The blind replay ADR 0029 named:* a taste test of a few plans. The Run record gives counts over hundreds of
  tasks instead.

## Consequences

- A Fable plan may be judged by an Opus judge, and the other way round, since each role draws on its own. A plan
  passing its judge is therefore not the measure of the planning arm: what lands, and what Escapes, is.
- The prompts a Fable role runs are checked against Anthropic's Fable 5.2 guidance before its arm opens: a "never"
  rule carries its scope and its reason, steps that need no approval are named, and no line tells the model to
  think less.
- Three changes are Chorus's and are filed there: the conductor opens a Shaping session, and a lead drawn into the
  Fable arm, on Fable 5.2 (its grid offers Opus alone and its fallback default names Fable 5.1); the Companion's
  spread of Rollouts across Logins reads the Fable window beside the general one; and the Stage's benchmark reader
  has failed on every read.
- CONTEXT.md gains **Role**, **Arm**, **Fable share** and **Shaping session**; **Rung** names the exception.

## Proposed wording for `~/.agents/AGENTS.md` § Model tier (Lachy's hand edit)

> **Carve-out (Lachy, 2026-11-12): Fable 5.2 works beside Opus in Thread.** In thread rollouts and shaping
> sessions, a role may run on Fable 5.2 at `high` in a measured arm beside its Opus arm (thread-skill ADR 0079):
> shaping, planning, plan judging, hard builds, the final review, diagnosis and leading a rollout. Routine builds
> and Integration stay on Opus. A role keeps or widens its Fable arm on the weekly Reflection's numbers. Outside
> Thread, Opus stays the top tier.

## Decided for him (overturnable)

- Fable roles' effort → `high` on every rung (technical: Anthropic says most of the gain arrives by `high`).
- The draw → fixed by the task's name, one per role (technical: choosing by feel flatters whichever model gets the
  hard-looking work, and one draw per task cannot tell roles apart).
- The review rule and budgets → the same in both arms (technical: otherwise the comparison is unfair).
- "Hard" for building → `work_depth: deep` (technical: the one hardness mark a task note already carries).
- The pacing rule → per Login, Fable and general allowance run down together (priorities: his words, "balanced",
  "not locked", "doesn't have to be perfect").
- A spent allowance → the Opus arm, logged and left out of the comparison (priorities: runs without him).
- Who widens a role → the Reflection on a clean win; a trade is his (technical: ADR 0037 decision 1 already draws
  that line).
- The order → the allowance-refusal outcome and the prompt check land before any arm opens (technical: the refusal
  stalled two rollouts in September).
