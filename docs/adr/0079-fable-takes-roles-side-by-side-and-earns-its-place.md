# 0079 — Fable plans every task and tops the ladder; further roles earn their place side by side

Date: 2026-11-12
Status: accepted, not built (two sittings with Lachy on 2026-11-12: Chorus's thirtieth orient, recorded as Chorus
ADR 0119, and a `/thread:orient Thread Skill` reshuffle; builds as Phase 46). Amends ADR 0029 decisions 1 (a rung
may name a plan model, and a role its own), 4 (the plan judge rides with the planner) and 7 (the record gains
arms). ADR 0029 decisions 2, 3, 5 and 6 and ADR 0037 stand as written. Within rollouts it overturns Chorus ADR 0119
decision 9 ("everything else stays on Opus"), on his later word. Nothing here runs until Lachy edits
`~/.agents/AGENTS.md` § Model tier by hand: that section is the Opus lock, and one wording for both ADRs is proposed
at the end.

## Context

ADR 0029 kept Fable off the built-in ladder and said a replay of hard rollout tasks would decide whether it joins.
That replay was dropped on 2026-10-09 and never ran. Fable 5.2 shipped on 2026-11-09, and on 2026-11-12 Lachy ruled
on it twice.

**At Chorus's orient** (Chorus ADR 0119 decisions 1 and 2, his): Fable shapes every plan, in a Session and in a
rollout, and is the top gear when Opus fights. That ADR names the rollout half as this repo's.

**At this repo's orient, later the same day.** A first draft here made Fable a rung reached only when a task was
about to be set aside. He rejected it: *"I don't want to use it just as a last resort. I want it to be part of the
many tools that we use … Where do we think the rollout and thread system would benefit from Fable? … we can earn
the right of using it more, log it, and see the effectiveness of it."* Offered three widths, he picked the widest:
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
- **The engine.** A Rung holds one model for every role, so "Fable plans, Opus builds" cannot be said. A
  model-allowance refusal reads as a transient failure, which stalled two rollouts in September 2026.

## Decision

His, at Chorus's orient (the rollout half of Chorus ADR 0119):

1. **Fable plans every task.** A Rung may name a plan model. The planner, the plan reviser and the plan judge run on
   it, at `high`, on every rung; the judge rides with the planner. A climb at the plan stage moves the task's rung
   and leaves the plan model as it is.
2. **Fable tops the ladder.** The operator's file gains a third rung, every role on Fable at `high`. A task that
   fights reaches it by ADR 0029's Escalation, unchanged: one rung, once per stage.

His, at this repo's orient:

3. **Further roles run side by side and earn their place.** A **Role** may name its own model, and four start in
   two **Arms**, Opus and Fable: the final review, building a hard task, the blocked-task investigator, and leading
   a rollout. A task is hard when its `work_depth` is deep, its starting rung is above the bottom, or its `scope` is
   cross-cutting. A task falls in an arm for a role by a draw fixed by its name, a rollout's lead by a draw fixed
   by the rollout's name, and each role draws on its own. Nothing picks an arm by how hard the work looks. The arm
   drawn is stamped on the task note, as its rung is, so a resume or a later dispatch keeps it.
4. **Both arms run under the same rules:** the same review rule, round budgets, gates and Escalation. A task that
   climbs to the Fable rung leaves the comparison from that call on, and the record says so.
5. **Session-run work records what ran, and has no arm yet.** Orient, the estate pass, schedule's grading, repair
   and audits run on the model Chorus's footing gives their Session (Chorus ADR 0119) and record it. Nothing
   measures their outcome today, so nothing here widens or shrinks them. The weekly Reflection stays on Opus at
   `xhigh` (ADR 0037 decision 4): the judge of the trial stays outside it.
6. **The Fable share is paced to the allowance.** Per Login, the share of work drawn into Fable arms follows what
   is left, so that the Fable window and the general window run down together through the week. It need not be
   exact, and allowance left over at the week's end is fine. Nothing is held in reserve for hand sessions. The rule
   takes any number of Logins. Planning (decision 1) is outside the share: it takes Fable whenever there is room.
7. **Nothing locks.** When a Login's Fable allowance is spent, a call that would run on Fable (a plan, the top rung,
   a Fable arm) runs on Opus, the Run record says so, and that task is left out of the comparison. An allowance
   refusal is its own outcome, never a transient failure and never a stop. A lead cannot change its own model
   mid-run, so the leading arm opens last, once Chorus restarts a lead whose Login has reached Fable's line (filed
   there).
8. **The Run record carries the measure:** for each role of each task call, the model and effort that ran, its
   tokens, its outcome and, for a drawn role, its arm.
9. **The weekly Reflection reads each drawn role's two arms** inside its window: rejected plans, the first review's
   verdict, review rounds, Escapes, tokens per merge and the Hands-off rate. A change of share is a Tuning and lands
   by ADR 0037 decision 5: three Reflections agree and no Guardrail is breached, tokens per merge among them. A
   trade (ADR 0037 decision 1) goes to Lachy's decision task. The same reading says when another Login would have
   carried Fable work that fell back to Opus.
10. **The built-in ladder is unchanged** (ADR 0029 decision 2): with no operator file, every role runs on Opus.

Considered:

- *A last-resort rung* (this repo's first draft, rejected by Lachy): it uses Fable least where it may help most.
- *Planning as a drawn arm* (this repo's second draft): he had already ruled, at Chorus's orient, that Fable shapes
  every plan.
- *Switching the further roles to Fable outright and comparing weeks:* rollouts differ too much week to week for a
  before and after to mean anything.
- *One draw per task for all its roles:* it cannot tell a better review from a better build.
- *A reserve for hand sessions* (offered to Lachy, turned down): capacity is his to add, and a reserve leaves
  allowance idle by design.
- *The blind replay ADR 0029 named:* a taste test of a few plans. The Run record gives counts over hundreds of
  tasks instead.

## Consequences

- Planning has no Opus arm, so nothing here measures it against Opus. The count of rejected plans before and after
  is all the Reflection can say, and it should say that plainly.
- The prompts a Fable role runs are checked against Anthropic's Fable 5.2 guidance before any of this is switched
  on: a "never" rule carries its scope and its reason, steps that need no approval are named, and no line tells the
  model to think less.
- Chorus builds the Session half as its Phase 104 (ADR 0119): the conductor's Fable gears and the Login pick that
  reads Fable's window. Two things are filed there from this ADR: a lead drawn into the Fable arm opens on Fable,
  and ADR 0119 decision 9 and the lock's wording are brought into line with this one.
- CONTEXT.md gains **Role**, **Arm**, **Fable share** and **Shaping session**; **Rung** names the plan model.

## Proposed wording for `~/.agents/AGENTS.md` § Model tier (Lachy's hand edit, one wording for both ADRs)

> **Opus 5.5 is the default tier. Fable 5.2 takes the plan, the grill (on trial) and the fights** (Chorus ADR
> 0119). **In thread rollouts it also runs in measured arms beside Opus** (thread-skill ADR 0079): the final review,
> hard builds, the blocked-task investigator and the lead. A role keeps or widens its Fable arm on the weekly
> Reflection's numbers. Everything else stays on Opus.

## Decided for him (overturnable)

- Fable's effort → `high` everywhere (technical: Anthropic says most of the gain arrives by `high`; Chorus ADR 0119
  decision 7 says the same).
- The plan judge → rides with the planner (technical, from Chorus ADR 0119: a weaker judge second-guessing a
  stronger planner costs rounds).
- The draw → fixed by the task's name, one per role, stamped on the note (technical: choosing by feel flatters
  whichever model gets the hard-looking work, and a stamp keeps a resumed task in its arm).
- Session-run work → recorded, no arm yet (technical: nothing measures its outcome, so an arm would decide
  nothing).
- The Reflection → stays on Opus (technical: it rules on the trial).
- The pacing rule → per Login, Fable and general allowance run down together (priorities: his words, "balanced",
  "not locked", "doesn't have to be perfect").
- Who changes a share → three agreeing Reflections inside the Guardrails; a trade is his (technical: ADR 0037
  decisions 1 and 5 already draw that line).
- The order → the allowance-refusal outcome and the prompt check land before anything is switched on (technical:
  the refusal stalled two rollouts in September).
