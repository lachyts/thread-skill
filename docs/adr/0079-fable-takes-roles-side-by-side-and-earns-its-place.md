# 0079 — Fable shapes every plan and tops the ladder; further roles earn their place side by side

Date: 2026-11-12
Status: accepted, not built (two sittings with Lachy on 2026-11-12: Chorus's thirtieth orient, recorded as Chorus
ADR 0119, and a `/thread:orient Thread Skill` reshuffle; builds as Phase 46). Amends ADR 0029 decisions 1 (a rung
may name a plan model, and a role its own), 4 (the plan judge rides with the planner), 5 (Integration never runs on
an all-Fable rung) and 7 (the record gains arms), and ADR 0037 decision 4 (the weekly Reflection's model). ADR 0029
decision 3 stands, but a plan-stage climb no longer changes the plan's model or effort; its decisions 2 and 6 and
ADR 0037's other decisions stand as written. Within rollouts it overturns Chorus ADR 0119 decision 9 ("everything
else stays on Opus"), on his later word. The lock (`~/.agents/AGENTS.md` § Model tier) was amended on 2026-11-12
and names this ADR (its wording as applied is at the end); what still gates Fable in a rollout is the operator's
ladder file (task p46-7), written once Phase 46 has landed.

*(Amended 2026-11-12 by thread-skill-p46-8: the 15 findings of review round 45adf20/cdf93d are settled in the
decisions and the Decided list, each marked "review #N", and the lock's edit later the same day outdated the
Status, decision 5 and the wording section, which now say what holds.)*

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
- **The lock, later the same day.** `~/.agents/AGENTS.md` § Model tier was amended on Lachy's word by an agent
  (his answer to the plan: "can you do this edit yourself?"; `~/.agents` commit `6051214`, workspaces ADR 0014
  decision 5). It now names this ADR, and puts reflections on Fable.

## Decision

His, at Chorus's orient (the rollout half of Chorus ADR 0119):

1. **Fable shapes every plan the engine drafts.** A Rung may name a plan model. The planner, the plan reviser and
   the plan judge run on it, at `high`, on every rung; the judge rides with the planner. A task whose
   `plan_approval` gives it no plan gate stays without a plan: this ADR changes no `plan_approval` default
   (review #1). A plan-stage climb no longer strengthens planning: it moves the task's rung, so the later stages
   start higher, and changes neither the plan's model nor its effort. A plan still rejected after its rounds is set
   aside as today, and the Overrun (PR lachyts/thread-skill#312) and task p39-21 take it from there (review #2). On
   a ladder that names no plan model, the built-in one among them, planning runs on the rung and climbs with it as
   before.
2. **Fable tops the ladder.** The operator's file gains a third rung, every role on Fable at `high`. A task that
   fights reaches it by ADR 0029's Escalation, unchanged: one rung, once per stage. Integration never runs on this
   all-Fable rung: it runs on the highest rung below it, whatever rung the task reached (this amends ADR 0029
   decision 5; review #4).

His, at this repo's orient:

3. **Further roles run side by side and earn their place.** A **Role** may name its own model, and four start in
   two **Arms**, Opus and Fable, under the engine's names (review #12): the master review (every round), the
   builder of a hard task, the investigator (the agent of a `scope: read-only` task) and the lead of a rollout. A
   task is hard when its `work_depth` is deep or its `scope` is cross-cutting (schedule § 4.7's two marks), read
   once at its first dispatch and stamped with its arm. A reached `rung:` never makes a task hard (review #15). A
   task falls in an arm for a role by a draw fixed by its name, a rollout's lead by a draw fixed by the rollout's
   name, and each role draws on its own. Nothing picks an arm by how hard the work looks. The arm drawn is stamped
   on the task note, as its rung is, so a resume or a later dispatch keeps it.
4. **Both arms run under the same rules:** the same review rule, round budgets, gates and Escalation. Which model a
   role runs on (review #3): on a rung where every role is Fable, the rung's model wins for every role; below it, a
   role's own model wins. A role in its Fable arm has no stronger pass to climb to, so its climbs are recorded as
   no-ops, and the Reflection reports climbs per arm so the difference is visible. A task that climbs to the Fable
   rung leaves the comparison from that call on, and the record says so.
5. **Session-run work records what ran, and has no arm yet.** Orient, the estate pass, schedule's grading, repair
   and audits run on the model Chorus's footing gives their Session (Chorus ADR 0119) and record it. Nothing
   measures their outcome today, so nothing here widens or shrinks them. The weekly Reflection runs on the model
   the lock gives it (reflections are Fable's under workspaces ADR 0014), though Fable is one of the arms it
   judges: the comparison of arms is computed by script, and a ceiling changes only by ADR 0037 decision 5 (three
   agreeing Reflections, no Guardrail breached), so the reader's model decides nothing.
   *(Amended 2026-11-12: this read "stays on Opus at `xhigh`" until the lock's edit.)*
6. **The Fable share is paced to the allowance, under a ceiling.** Per Login, pacing moves the live share of work
   drawn into Fable arms with what is left, so that the Fable window and the general window run down together
   through the week, never above the role's ceiling. The ceiling is a rollout setting, one per drawn role. One
   mechanism each: pacing moves the live share, and only the ceiling is a Tuning (decision 9; review #7). It need
   not be exact, and allowance left over at the week's end is fine. Nothing is held in reserve for hand sessions.
   The rule takes any number of Logins. Pacing governs the drawn arms only: plans (decision 1), the Fable rung
   (decision 2) and ADR 0081's first reviewer take Fable first, whenever there is room, and the arms get what is
   left (review #4).
7. **Nothing locks.** When a Login's Fable allowance is spent, a call that would run on Fable (a plan, the top rung,
   a Fable arm) runs on Opus, the Run record says so, and that task is left out of the comparison. An allowance
   refusal is its own outcome, never a transient failure and never a stop. A lead cannot change its own model
   mid-run, so the leading arm opens last, once Chorus restarts a lead whose Login has reached Fable's line (filed
   there).
8. **The Run record carries the measure:** for each role of each task call, the model and effort that ran, its
   tokens, its outcome and, for a drawn role, its arm.
9. **The weekly Reflection reads each drawn role's two arms** inside its window: rejected plans, the first review's
   verdict, review rounds, climbs (review #3), Escapes, tokens per merge and the Hands-off rate. It also reports
   Fable calls by kind (plans, the Fable rung, ADR 0081's first reviewer and each drawn role), so what took Fable
   first is visible beside the arms (review #4). A change of a role's ceiling is a Tuning and lands by ADR 0037
   decision 5: three Reflections agree and no Guardrail is breached, tokens per merge among them. Pacing's moves
   are no Tuning (review #7). A trade (ADR 0037 decision 1) goes to Lachy's decision task. The same reading says
   when another Login would have carried Fable work that fell back to Opus.
10. **The built-in ladder is unchanged** (ADR 0029 decision 2): with no operator file, every role runs on Opus.

Considered:

- *A last-resort rung* (this repo's first draft, rejected by Lachy): it uses Fable least where it may help most.
- *Planning as a drawn arm* (this repo's second draft): he had already ruled, at Chorus's orient, that Fable shapes
  every plan.
- *A plan for every task* (this ADR's first text, "Fable plans every task"): a plan on every one-file task would add
  a judge round to each, and his ruling was about plans (review #1).
- *Switching the further roles to Fable outright and comparing weeks:* rollouts differ too much week to week for a
  before and after to mean anything.
- *One draw per task for all its roles:* it cannot tell a better review from a better build.
- *Hardness read from the reached `rung:`* (this ADR's first text): it picks tasks by their own failure, so the
  arms would differ by the work they drew (review #15).
- *Integration on the Fable top rung, as ADR 0029 decision 5 read:* every Integration would move to Fable, and pacing
  only the share could not then balance the windows (review #4).
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
- Chorus builds the Session half as its Phase 104 (Chorus ADR 0119): the conductor's Fable gears and the Login pick that
  reads Fable's window. Two things are filed there from this ADR: a lead drawn into the Fable arm opens on Fable,
  and Chorus ADR 0119 decision 9 and the lock's wording are brought into line with this one.
- fresh-review draws its own lead and checker Opus or Fable for hand sessions only (workspaces ADR 0014), and
  rollouts keep this ADR's draw, so no change is drawn twice. That comparison is read in the weekly Reflection too
  (task p46-9).
- CONTEXT.md gains **Role**, **Arm**, **Fable share** and **Shaping session**; **Rung** names the plan model and
  the two judges that do not ride with it, and **Top rung** no longer carries an Integration when it is all-Fable.

## The lock's wording, as applied (`~/.agents/AGENTS.md` § Model tier)

This ADR proposed a wording for Lachy's hand edit. On 2026-11-12 an agent applied one on his word (`~/.agents`
commit `6051214`, workspaces ADR 0014 decision 5). Its Thread line, as it stands:

> - **Thread rollouts** (thread-skill ADR 0079): measured arms beside Opus, by Role: the final review, hard builds,
>   the blocked-task investigator and the lead. A Role keeps or widens its Fable arm on the weekly Reflection's
>   numbers.

Where it differs from what this ADR proposed:

- (a) One wording serves three ADRs (this one, Chorus ADR 0119 and workspaces ADR 0014), not two.
- (b) It says "the final review" and "the blocked-task investigator", which this ADR reads as the master review and
  the investigator (decision 3, review #12). The lock is his file and is not edited from here.
- (c) It names Fable's plan and top rung only on its Chorus line (Chorus ADR 0119), which covers a rollout's plan
  and its last rung.
- (d) "Everything else stays on Opus" is gone: workspaces ADR 0014 names further places.

The wording this ADR proposed, for the record:

> **Opus 5.5 is the default tier. Fable 5.2 takes the plan, the grill (on trial) and the fights** (Chorus ADR
> 0119). **In thread rollouts it also runs in measured arms beside Opus** (thread-skill ADR 0079): the final review,
> hard builds, the blocked-task investigator and the lead. A role keeps or widens its Fable arm on the weekly
> Reflection's numbers. Everything else stays on Opus.

## Decided for him (overturnable)

- Fable's effort → `high` everywhere (technical: Anthropic says most of the gain arrives by `high`; Chorus ADR 0119
  decision 7 says the same).
- The plan judge → rides with the planner (technical, from Chorus ADR 0119: a weaker judge second-guessing a
  stronger planner costs rounds).
- Which tasks get a plan → those `plan_approval` gives a plan gate, as before (technical, review #1: his ruling was
  about plans, and a plan for every one-file task would add a judge round to each).
- A plan-stage climb → moves the task's rung, never the plan's model or effort (technical, review #2: the plan
  already runs on the strongest model; a plan still rejected is set aside, and the Overrun takes it from there).
- Role model against rung model → the rung's on an all-Fable rung, the role's below it; a Fable arm's climbs are
  recorded no-ops, read per arm (technical, review #3).
- Integration → the highest rung below the all-Fable one; pacing governs the drawn arms only, and the rest take
  Fable first (technical, review #4: a Fable top rung moved every Integration to Fable, and pacing only the share
  could not balance the windows).
- The share → pacing moves it under a per-role ceiling, and only the ceiling is a Tuning (technical, review #7: two
  mechanisms setting one number would fight).
- The drawn roles → the engine's names: the master review, the builder of a hard task, the investigator and the
  lead (technical, review #12).
- Hardness → `work_depth: deep` or `scope: cross-cutting`, read once at first dispatch and stamped with the arm
  (technical, review #15: a reached rung picks tasks by their own failure).
- The draw → fixed by the task's name, one per role, stamped on the note (technical: choosing by feel flatters
  whichever model gets the hard-looking work, and a stamp keeps a resumed task in its arm).
- Session-run work → recorded, no arm yet (technical: nothing measures its outcome, so an arm would decide
  nothing).
- The Reflection → runs on the model the lock gives it (technical: the comparison is computed by script and a
  ceiling moves only by ADR 0037 decision 5, so the reader's model decides nothing).
- The pacing rule → per Login, Fable and general allowance run down together (priorities: his words, "balanced",
  "not locked", "doesn't have to be perfect").
- Who changes a ceiling → three agreeing Reflections inside the Guardrails; a trade is his (technical: ADR 0037
  decisions 1 and 5 already draw that line).
- The order → the allowance-refusal outcome and the prompt check land before anything is switched on (technical:
  the refusal stalled two rollouts in September).
