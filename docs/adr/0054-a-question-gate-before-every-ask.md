# 0054 — A question gate before every ask

Date: 2026-10-27
Status: accepted. Written for the vault task `thread-skill-p30-1-a-question-gate-before-every-ask` (Phase 30 · Task 1),
from the 2026-10-25 loop audit and Chorus ADR 0110; its plan was judged over two runs before the build. Amends ADR
0041's decision round and ADR 0047's Pre-flight round: both now ask only Lachy's own decisions.

## Context

The loop audit of 21–25 Oct read every question the thread skills put to Lachy. Most were not his to answer: a
"next move?" or a confirm of a queue he had already approved (a gate), a fork the code or an ADR could settle (a
technical call), or a call his stated priorities already answer. Several recommendations handed work back to him or
traded quality for cost without saying why (Q13, Q46, Q74), and the grading agents put technical forks to him as One
calls and Grills, so his decision budget went on questions an agent could have settled. Chorus ADR 0110 rules the
estate side: ask him only his questions, in a Framing he can answer well, and list the rest as decided for him.

## Decision

**d1. One gate, cited at every ask that stands.** `skills/_shared/asking.md` is the rule every verb follows before an
AskUserQuestion, a plain-text question, a grill question or a recommendation: label the Owner (*yours*, *priorities*,
*technical* or *gate*); ask only *yours*, in the Framing (plain words, the goal, each option's gains and costs, the
pick against his priorities, a Note invited); decide the rest and list it as Decided for you. Every ask that stands in
`skills/` (a `cited` or `listed` row of § Sites) cites the file in its own paragraph or list item; a `follow-up` ask is
one its owner task removes.

**d2. The grade carries an `owner` on each decision** (readiness-grade § Each decision; `estate-rank.py`):
- a decision with no `owner` reads as *yours*, with a warning; an unknown value warns and reads as *yours*;
- `gate` is never a grade decision's owner (a process gate is no fork in the task's work), so it warns and reads as
  *yours*;
- a decision that answers an open `fork` reads as *yours*, whatever its owner;
- at low (or missing) confidence a *priorities* decision reads as *yours*, and a *technical* one is dropped: it is
  left to the executing session (grill-fit 2(a)), never ruled;
- a decision about a credential, an irreversible step (an external publish included) or any sign-off (ADR 0008) is
  *yours*. The brief says so, and `estate-rank.py` backs it: a ruled decision on a task gated `credential` or
  `irreversible` whose text the gate sweep (`gated_inputs.py`) hits for that same kind reads as *yours*, with a
  warning;
- a fork about spend alone is *priorities* (Chorus ADR 0108 d4: spend is never asked), its gate in `gates[]`;
- a One call or a Grill with no decision of his is invalid, never lowered: a task whose every decision is ruled is
  graded Ready.

Only his decisions count toward the implied grade, the raise, the decision minutes and the leverage; the rest are
ruled now and listed as `decidedForYou`.

**d3. The record.** A ruled decision is written into its task note under `## Decided for you (<date>)`, with a
preamble saying what it is, and never under `## Decisions`: it is no recorded human decision, and none signs a gated
input (ADR 0008). The planner, the plan judge's brief exclusion (`BRIEF_EXCLUDE`), schedule § 4.5's combined note and
the Engine snapshot's carry read it on purpose. Descope's recorded-decision reader, schedule § 3.5's and orient-all
§ 6's settling and the Reflection's ask-ahead reader keep it out on purpose: an agent's call never settles a gate.

**d4. Where it is written.** `estate-dispatch.py decided-for-you --write` writes a pass's ruled decisions for the
tasks a schedule run queues (schedule § 1.5, in both its own form and the orient-all form), and reshuffle R5.2 writes
the grill's through `record --owner`. A task left out later keeps its bullets; it is graded again next time.

**d5. The grills.** Reshuffle R3 passes the gate to the personal grill skills through the Skill call's `args`, the
only lever it has, and collects their closing Decided for you list for R4's footer and R5.2. R4's table is *yours*:
it is the roadmap (ADR 0036).

**d6. The ungraded question keeps `Leave it out` recommended**, now with its reason: nobody could read the task for a
decision of his, and queued unread it can build the wrong thing. Whether to decide it rather than ask is p30-10's.

**d7. The inventory.** § Sites below lists every ask unit in `skills/` with its Owner and disposition;
`tests/contracts/question-gate.test.mjs` holds each anchor to exactly one unit, every ask unit (one naming
AskUserQuestion, or one matching its plain-ask pattern) to exactly one row, and every `cited` or `listed` row's unit to
the cite. The Grade log's `decisions` and `low` count only his decisions (owner yours) from this ADR on, so lines
before it are not comparable with lines after it.

**d8. The Framing in script-built rounds.** `estate-dispatch.py`'s `rounds` and `preflight` build the questions the
leads pass on verbatim, so the grade carries their Framing: `goal` (one sentence tying the fork to the project's goal)
and `stakes` (one line per option, what it gains and costs), both required with an explicit `owner: yours`, each
option's description its stakes line and the recommended one's ending ` Recommended: <why>`. A legacy decision with no
owner is warned and asked as built, without them. Every question the scripts build ends with `NOTE_INVITE`, "What
would make this wrong for you?". A sign-off and an Unpark offer carry no pick, on purpose: the authorisation is his
(ADR 0008), and parking is his standing call (ADR 0041). `asking.md` § 6's table names, kind by kind, which of the
five Framing points each script-built question carries and why.

## Sites

Each row is one ask unit (a paragraph, list item or table row) in `skills/`, found by its anchor, a phrase only that
unit holds. Dispositions: `cited` (the ask stands and its unit cites `_shared/asking.md`), `listed` (a pointer at an
ask another unit holds, whose Owner it shares: it cites `_shared/asking.md` too), `follow-up` (an ask the gate
removes, left to the owner task named in Task and put in the Framing until it lands), `no ask` (the unit names an ask
only to forbid it) and `designed out` (this build removed it, so its anchor appears nowhere). The table holds 68
rows: 41 cited, 15 follow-up (p30-9 2, p30-10 13), 2 listed, 7 no ask, 3 designed out. That is form N1:
p30-5 (PR #226) is on main, its step 4 cited in three units. p30-4 (the approved queue) removed its 14 rows. Orient
§ 3.5's Priorities card (p30-6, Chorus ADR 0110 d5) added one `cited` row.

| File | § | Anchor | Owner | Disposition | Task |
| --- | --- | --- | --- | --- | --- |
| skills/_shared/readiness-grade.md | § Each decision | `` orient-all asks the One calls (only his) through AskUserQuestion `` | *yours* | cited | — |
| skills/_shared/task-writer.md | § 1 | `` else `AskUserQuestion` offering those matches `` | *yours* | cited | — |
| skills/_shared/task-writer.md | § 1 | `` **Still ambiguous** → ask via `AskUserQuestion` `` | *yours* | cited | — |
| skills/close/SKILL.md | § Identify the active thread | `` **Conversation explicitly references a thread by slug** `` | *yours* | cited | — |
| skills/close/SKILL.md | § Process | `` collect approval via `AskUserQuestion` `` | *yours* (ADR 0011) | cited | — |
| skills/execute/SKILL.md | § 1 | `` **list the matches and ask which** (the question tool only with nothing live `` | *yours* | cited | — |
| skills/handoff/SKILL.md | § Handoff document | `` ask Lachy for an absolute directory `` | *yours* | cited | — |
| skills/open/SKILL.md | § `/thread:open <slug>` | `` otherwise list labels and paths and ask `` | *yours* | cited | — |
| skills/open/SKILL.md | § `/thread:open <slug>` | `` his answer is the go-ahead `` | *yours* | cited | — |
| skills/open/SKILL.md | § Repo-thread lookup | `` list them as `<label> — <abs path>` and ask `` | *yours* | cited | — |
| skills/orient/SKILL.md | § 1 | `` report its one `resolve-target:` line and ask in plain text for the target `` | *yours* | cited | — |
| skills/orient/SKILL.md | § 1 | `` **`candidates` or `none`** → ask before any § 2 read `` | *yours* | cited | — |
| skills/orient/SKILL.md | § 3.5 | `` in one `AskUserQuestion` call of four questions `` | *yours* | cited | — |
| skills/orient/SKILL.md | § 6 | `` steer it with `AskUserQuestion` `` | *yours* | cited | — |
| skills/orient/reshuffle.md | R3 | `` Ask Lachy only the questions he owns `` | *yours* | cited | — |
| skills/orient/reshuffle.md | R4 | `` Print the final disposition table and get a y/n `` | *yours* (ADR 0036) | cited | — |
| skills/orient-all/SKILL.md | § 1 | `` ask one AskUserQuestion: "How many minutes can you give to decisions now?" `` | *yours* | cited | — |
| skills/orient-all/SKILL.md | § 4 | `` Pass each `rounds.asks[i]` to AskUserQuestion's `questions` verbatim `` | *yours* | cited | — |
| skills/orient-all/SKILL.md | § 5 | `` put its `decisions[]` to Lachy one at a time `` | *yours* | cited | — |
| skills/orient-all/SKILL.md | § 9 | `` each AskUserQuestion call's questions, then the grill list `` | *yours* | cited | — |
| skills/reflect/SKILL.md | § 1 | `` Several matches for a loose name: list them and ask which `` | *yours* | cited | — |
| skills/reflect/SKILL.md | § 5 | `` Then ask which proposals to apply `` | *yours* | cited | — |
| skills/reflect/SKILL.md | § 7 | `` re-ask Lachy once and run the corrected `--pick` `` | *yours* | cited | — |
| skills/repair/SKILL.md | § 3 | `` **Ask.** `AskUserQuestion` with the specific decision its block needs `` | *yours* | cited | — |
| skills/repair/SKILL.md | § 3 | `` Then offer (`AskUserQuestion` `` | *yours* (ADR 0008) | cited | — |
| skills/repair/SKILL.md | § 3 | `` Ping the user only here and for the other decisions no agent can `` | *yours* | cited | — |
| skills/repair/SKILL.md | § 3 | `` Ask the question verbatim, quoting the latest feedback `` | *yours* (ADR 0033) | cited | — |
| skills/repair/SKILL.md | § 3 | `` so Lachy decides with it on screen `` | *yours* | cited | — |
| skills/repair/SKILL.md | § 3 | `` show it again and ask again `` | *yours* | cited | — |
| skills/repair/SKILL.md | § 3 | `` whether the cause is fixed and the lane may run again `` | *yours* (ADR 0048) | cited | — |
| skills/repair/SKILL.md | § 7 | `` `AskUserQuestion` quoting `setAside.summary` `` | *yours* | cited | — |
| skills/repair/SKILL.md | § 7 | `` present each of its `setAside.gates` verbatim `` | *yours* (ADR 0008) | cited | — |
| skills/repair/SKILL.md | § Don'ts | `` refuses a second block after a restart (exit 3): ask Lachy then `` | *yours* | cited | — |
| skills/schedule/SKILL.md | § 1.5 | `` **The round.** Pass each `asks[i]` to AskUserQuestion's `` | *yours* | cited | — |
| skills/schedule/SKILL.md | § 1.5 | `` An ungraded task's answer is never recorded `` | *yours* | cited | — |
| skills/schedule/SKILL.md | § 3.5 | `` Put each gate to the user in the confirm batch `` | *yours* | cited | — |
| skills/schedule/SKILL.md | § 3.6 | `` **Ask ahead (ADR 0034) `` | *yours* | cited | — |
| skills/status/SKILL.md | § 1 | `` **list the matches and ask which**: don't assume `` | *yours* | cited | — |
| skills/next/SKILL.md | § Process | `` **An open question this session left** `` | *yours* (step 3 decides the rest) | cited | — |
| skills/next/SKILL.md | § Process | `` **Decide the move, and say so in one line.** `` | *gate* | cited | — |
| skills/next/SKILL.md | § Process | `` **The menu, when the move is not clear.** `` | *yours* | cited | — |
| skills/orient/SKILL.md | § 9 | `` end with `AskUserQuestion`, recommended option first, one offer per parallel note `` | *gate* | follow-up | p30-9 |
| skills/schedule/SKILL.md | § 8 | `` **Start when ready.** When Lachy answers a standalone run's summary `` | *gate* | follow-up | p30-9 |
| skills/schedule/SKILL.md | § 0 | `` ask one AskUserQuestion, "Create the rollout clone `` | *technical* (ADR 0042 holds it) | follow-up | p30-10 |
| skills/close/SKILL.md | § Identify the active thread | `` offer to create one via `thread:open `` | *gate* | follow-up | p30-10 |
| skills/close/SKILL.md | § Edge cases | `` rung 4 (offer to create), never rung 3 `` | *gate* | follow-up | p30-10 |
| skills/close/SKILL.md | § Edge cases | `` Offer to create a thread if the conversation `` | *gate* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 3 | `` also asks the raise `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 3 | `` On Lachy's confirmation that the PR is this task's `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 4 | `` **The raise, on Lachy's word** `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 4 | `` **A CLOSED PR or a missing branch** `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 5 | `` **Has dependants** → **ask** `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 7 | `` Some → ask: *"[[B]], [[C]] depend on [[A]] `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 7 | `` A dependant a Leg holds `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 7 | `` for each `leg_base` top of that task. Ask. `` | *technical* | follow-up | p30-10 |
| skills/repair/SKILL.md | § 7 | `` an id the Stage does not show) → ask Lachy `` | *technical* | follow-up | p30-10 |
| skills/open/SKILL.md | § `/thread:open save` | `` Thread identification comes first and may ask `` | *yours* | listed | — |
| skills/orient/SKILL.md | § 1 | `` When he stops a pick, re-ask as above without the stopped pick `` | *yours* | listed | — |
| skills/execute/SKILL.md | § 6.5 | `` the lead never calls the question tool `` | *gate* | no ask | — |
| skills/execute/SKILL.md | § Don'ts | `` Never call the question tool (`AskUserQuestion` `` | *gate* | no ask | — |
| skills/execute/legs.md | § Needs you | `` A Leg never calls the question tool `` | *gate* | no ask | — |
| skills/handoff/SKILL.md | § Build the handoff prompt | `` the closing words never ask Lachy to start or open it `` | *gate* | no ask | — |
| skills/repair/SKILL.md | § 2 | `` never escalate it or ask Lachy mid-re-verify `` | *gate* | no ask | — |
| skills/repair/SKILL.md | § 3 | `` `left`: report it, and ask nothing `` | *gate* | no ask | — |
| skills/schedule/SKILL.md | § 4.5 | `` don't ask the user which clusters to merge `` | *technical* | no ask | — |
| skills/open/SKILL.md | § `/thread:open <slug>` | `` confirm with the user, ask for the scope `` | *gate* | designed out | — |
| skills/orient/reshuffle.md | R3 | `` start a `CONTEXT.md` for `` | *technical* | designed out | — |
| skills/orient/reshuffle.md | R3 | `` still ambiguous → ask `` | *technical* | designed out | — |

## Follow-ups

Each owner task removes its rows' asks (answering each as orient-all § 6 step 3 answers schedule's questions, listed
as Decided for you) and deletes its rows; q5 fails a row whose ask is gone, so a landed task cannot leave one behind.

- [[thread-skill-p30-9-schedule-ends-with-pickup-sweep-and-execute-handoff]] (p30-9): 2 rows, the execute offer at
  orient § 9 and schedule's **Start when ready.**
- [[thread-skill-p30-10-the-asks-the-gate-leaves-standing]] (p30-10): 13 rows. Filed by the lead at this task's
  Integration, before `mark-done`, from this brief:
  - title "The asks the gate leaves standing", `phase: 30`,
    `depends-on: [[thread-skill-p30-1-a-question-gate-before-every-ask]]`, a **Phase 30 · Task 10** line;
  - its items: its 13 rows; the rollout clone question (schedule § 0's exit 4: decide the clone rather than ask, an
    ADR 0042 amendment); close's rung-4 offers to create a thread (design them out); repair's technical pings, put
    in an `(automatic)` `## Repair input` form as ADR 0033 does for agent-fixable set-asides; and whether to decide
    schedule § 1.5's ungraded question rather than ask it (d6);
  - **Verify:** no § Sites row names p30-10, and `tests/contracts/question-gate.test.mjs` q5 passes.

## Decided for him (overturnable)

- A separate `## Decided for you (<date>)` heading, never `## Decisions`, so no reader of a human decision takes an
  agent's call for one.
- The verb is `decided-for-you`, beside `record --owner`.
- The low-confidence rule: a *technical* guess is left to the executing session, a *priorities* one is asked.
- A decision answering an open fork reads as *yours*, and `gate` is never a grade decision's owner.
- Spend forks are *priorities* (Chorus ADR 0108 d4), a departure from the plan review's wording, which predated it.
- The sign-off backstop looks only at the kinds the task is gated by (`credential`, `irreversible`), so an LLM token
  count on an ungated task stays ruled.
- `goal` and `stakes` are strict only on an explicit `owner: yours`, so a grade written before this ADR still ranks.
- `NOTE_INVITE` ends every script-built question; sign-offs and Unpark offers carry no pick.
- `record --by orient` is allowed only with `--owner` (reshuffle R5.2's write), and `--owner` refuses `--fork` and
  `--recommended` (exit 2, nothing written).
- The Grade log's `decisions` and `low`, and the leverage, count his decisions only.
- Step 8's and R4's Decided for you lists stop at eight lines, the less sure first.
- The preamble's text, and the ungraded question's reason.
- The follow-up rows' owner tasks (p30-4, p30-5, p30-9, p30-10).
- One anchor per ask unit, and the plain-ask pattern narrowed past "had to ask" and "used to ask" (narrative).
- The two pointer units (open § save, orient § 1's re-ask) stay `listed`: each cites the gate, and shares the Owner
  of the ask it points at.
- The rollout clone question is *technical*, kept a question by ADR 0042 until p30-10, never *yours*.
- p30-4's standalone schedule applies the affine merges step 4.5 picks (its row 8) and stamps the Solo calls step 5
  judges (row 11), each listed in step 8's Decided for you, where orient-all's answers 10 and 12 apply none: both are
  technical calls the step already makes, so a listed call he can undo beats a confirm. Its rung offers go (row 9),
  as orient-all's answer 11 has it, against ADR 0029's consequence that schedule offers a starting rung: a hard task
  starts on the bottom rung and the engine climbs on evidence, and a rung he names is still stamped.
- Next's form (N1 or N2) is read from the tree at build time.
- Schedule's Scope line is left alone: its "writes to `~/repos/obsidian/Work/Tasks/`" covers the new write.

## Considered options

- **The agent's calls under `## Decisions`**: every reader of that heading takes it for Lachy's own decision, so
  descope would ask him about an agent's call and § 3.5's settling could clear a gate on it. Rejected for the separate
  heading.
- **A gate in each verb's own words**: twenty sites drift apart. Rejected for one cited file and the § Sites table.
- **Strict `goal` and `stakes` on every decision**: every grade written before this ADR would go invalid. Rejected for
  the explicit-`yours` switch.

## Consequences

- The decision round shrinks to his questions; the rest reach him as Decided for you lines he can overturn.
- A later task that adds an ask unit, or rewords an anchor, goes red on q2, q5 or q6 until it labels the Owner and
  adds (or deletes) its row.
- Grade log lines before and after this ADR count decisions differently.
