---
name: orient-all
description: 'Orient across every project at once: the estate pass. Scans the vault, grades and ranks all open work by agent work per minute of your attention, asks your decisions within a stated time budget, then schedules rollouts and starts the executes, Legs, repairs and child orients. Triggers on "orient across everything", "where is my attention best placed", "set everything ready moving", or /thread:orient-all. One project: thread:orient.'
---

# /thread:orient-all — the estate pass

Orient at estate altitude (ADR 0041; CONTEXT.md **Estate pass**): one look across every project in the vault that
asks Lachy only what he must decide, within the minutes he gives it, then puts the ready work in motion. Scripts
scan, the model decides: the scan, the ranking, the cut to the budget, the dispatch plan and every write are script
verbs; this session grades (through agents), reads status (through agents), asks, and matches the sessions to start
against the Stage's.

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md
itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Scope

- **Reads**: the vault, the repos (only through `estate-scan.py`'s read-only probes) and the Stage's session list.
- **Writes**, only through scripts:
  - `estate-dispatch.py record`, each answer into its task note;
  - `estate-dispatch.py log`, the grades into the Grade log (never on a dry run);
  - `estate-rank.py snooze`, `unpark` and `kill`, the Unpark offer's answers;
  - `reconcile-rollout.py approve-gates --tasks`, for a gate Lachy signs in this pass, run from that task's rollout's
    engine root (§ 4's Sign-off);
  - its schedule forks (§ 6), each one `/thread:schedule` run, whose `estate-dispatch.py decided-for-you --write`
    writes the calls the grade ruled for Lachy into each task it queues (`## Decided for you`, ADR 0054).
- It runs no git of its own and writes no handoff doc: a Sign-off's `engine-snapshot.py resolve` (§ 4) reads the
  rollout note's stamps and makes read-only git calls (rev-parse, status, rev-list) in its Engine snapshot and the
  Primary checkout (ADR 0043). A started session's brief is its prompt plus the note it names
  (`skills/execute/legs.md` § Hand over).
- It is never the lead of any rollout, so its questions block only its own session. The rule that a lead never calls
  the question tool while anything it launched is live (execute § 6.5) binds the leads it starts, not this session.

## Invocation forms

```
/thread:orient-all                    # ask the budget, then the whole pass
/thread:orient-all --budget 30        # the budget given: no budget question
/thread:orient-all --dry-run          # the slate, the decision batch and the dispatch plan; nothing asked or written
/thread:orient-all --dry-run --budget 60
```

The words "dry run" in the request count as `--dry-run`.

## Process

`S` below is the pass's scratch directory (§ 2), and every script runs as
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/<script> …`; the commands name the script and its verb only.

### 1. The budget

Unless `--budget` was given, ask one AskUserQuestion: "How many minutes can you give to decisions now?", with the
options `15 minutes`, `30 minutes (Recommended)`, `60 minutes` and `No decisions now` (0). A typed Other answer is
read as whole minutes ("an hour" is 60); one that cannot be read is asked once more, in plain text. A dry run never
asks: its budget is `--budget`, else 30. The budget is his (Owner *yours*: his time,
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`).

### 2. Scan, status and grade

1. `S=$(mktemp -d -t orient-all)`.
2. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-scan.py --compact > "$S/scan.json"`, with the Bash
   tool's `timeout: 120000`. Exit 2 or 3 stops the pass with its one line. `vaultErrors` and `deadlineHit` become
   caveats for § 8, and the pass goes on.
3. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py slices --scan "$S/scan.json" --dir "$S/slices"`:
   one file per home project with gradeable tasks.
4. In one message, start every agent, each read-only:
   - one grading agent per slice file. Its brief is `${CLAUDE_PLUGIN_ROOT}/skills/_shared/readiness-grade.md`
     § The grading agents, the slice file's path, and "return only the § Output JSON";
   - one status agent per rollout in the scan's `rollouts[]`. Its brief: "run `/thread:status [[<rollout>]]` and
     return four things, writing nothing: its Recommended action line verbatim; the number (1–13) of the status § 4
     **Recommended action** rule that matched; the command that line names; and its Needs you lines".
5. Save each grading answer as `$S/grades-<NN>.json`. An answer that does not parse, or a task the ranker lists in
   `invalid[]`, is re-asked once with its errors; still invalid, it stays ungraded. A status answer with no number in
   1–13 is recorded as unread, and so is a serial chain's: its rule is one of status § 5's S rules, never a § 4 number.
6. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py rank --scan "$S/scan.json" --grades <each grades file> --compact > "$S/rank.json"`.
7. Unless this is a dry run, `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py log --rank "$S/rank.json" --scan "$S/scan.json"`:
   one line per graded task into the Grade log (CONTEXT.md **Grade log**), which the weekly Reflection reads against
   what followed each grade. A task whose note name is no slug (spaces or capitals) is skipped, named on stderr and
   counted in the outcome line (`; <k> skipped (not a slug): …`), and the rest are logged. A skip or a non-zero exit
   is a § 8 caveat, and the pass goes on.

### 3. The Ranked slate

Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py rounds --rank "$S/rank.json" --scan "$S/scan.json" --budget <N> > "$S/rounds.json"`.

Print a glance, short lines, not a wall:

- the counts (graded, ranked, held, ungraded, invalid, skipped, runs) and the minutes the round will use;
- `top[]`, each with its grade, shape, leverage and any deadline;
- each live rollout, with its status agent's Recommended action line and action number;
- the runs, with their Review load;
- the projects graded Orient, which get their own orient session whatever the budget;
- the Unpark offers;
- the warnings, and the ungraded and invalid tasks.

The glance ends with each asked sign-off (`signOffs[]` with `ask: true`), immediately before § 4's first call:

- a line `[[<slug>]] in [[<rollout>]]: gated inputs awaiting your sign-off`;
- its `gateText` verbatim: the whole `## Gated inputs (awaiting sign-off)` section, nested bullets kept;
- for a bounced one, its `bounce` verbatim under it, so Lachy reads the plan judge's feedback first (execute § 3.7,
  ADR 0038).

### 4. The One-call round

Pass each `rounds.asks[i]` to AskUserQuestion's `questions` verbatim, one call at a time. Before any call that holds
a sign-off whose `gateText` was not printed since the last call, print it (and its bounce) again in that message:
no sign-off is ever asked unseen (a gate is presented verbatim, repair § 3; ADR 0008). `index[]` maps each exact
question text to its item, and each picked label to its full option text (`texts[]`). Every question here is his
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 1): a sign-off is his authorisation (ADR 0008), a One call his by
the grade (the grade ruled every other decision), and an Unpark offer his standing call; each question carries the
Framing from the grade (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 6).

Act on each answer as it lands:

- **One call**: with `decision` the `rounds.oneCalls[]` entry's for the index entry's `slug`,
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --question <decision.question> --answer <the full option text, or his typed words> --recommended <decision.options[0]> [--fork <decision.fork>]`,
  `--fork` exactly when the decision carries one. `decision.question` is the bare question: the index text opens
  with `[[<slug>]] `, which `record` cuts too, so the note never links to itself. A refusal (the task went in flight
  since the scan, say) is reported in § 8 with the answer, unrecorded.
- **Sign-off**: `Sign off` writes to a rollout this pass does not run, so it runs from that rollout's own engine
  root, never this session's (ADR 0043; `${CLAUDE_PLUGIN_ROOT}/skills/_shared/engine-snapshot.md` § Another rollout's
  commands): first
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py resolve --rollout <the index entry's rollout>`,
  then, with `<root>` and `<rollout-note>` the `root` and `note` it prints,
  `python3 <root>/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <slug> --rollout <rollout-note>`.
  A non-zero resolve exit (3: that rollout's snapshot is gone, moved or edited) signs nothing: its stderr line, which
  carries the remedy, is reported in § 8 with the answer, unsigned. A non-zero approve-gates exit is reported, except
  that one whose stderr line starts `engine-snapshot:` (a wrong root) is first re-run once from the root it names.
  `Not now` does nothing.
- **Unpark offer**:
  - unpark: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py unpark <note>`;
  - snooze: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py snooze <note> --ready <snoozeWrite.snoozed_ready>`;
  - kill: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py kill <note>`.

An answer that defers or drops the work, rather than picking an option, is still recorded, and the task is not
decided. Sign-offs are always asked, whatever the budget.

### 5. Grill rounds

Take each `rounds.grill[]` task in order and put its `decisions[]` to Lachy one at a time, in conversation, in the
Framing (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 3): the question, its `goal`, then each option with its
`stakes`, the recommendation first with its why, and last `What would make this wrong for you?`. They are only his
decisions: the grade ruled the rest. Record each answer at once, `decision` the one just asked:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --question <decision.question> --answer <his words> --recommended <decision.options[0]> [--fork <decision.fork>]`,
`--fork` exactly when the decision carries one, so an open fork answered here gets its `orient ruling:` line and is
not asked again. His words go as he gave them: `record` folds their line breaks into spaces. Lachy's "stop" ends the
rounds. A Grill task is decided only when every one of its decisions is answered.

### 6. Schedule

1. Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py plan --rank "$S/rank.json" --scan "$S/scan.json" --decided <each decided slug> --unparked <each note unparked> --signed <each slug signed> > "$S/plan.json"`.
2. Give each `plan.schedule[]` entry one forked subagent, whose prompt is `/thread:schedule <entry.args>`, then the
   line `Under orient-all § 6: name the note with slug <entry.projectSlug>; root <entry.root>; Pre-flight: rank $S/rank.json, scan $S/scan.json, decided <each decided slug among entry.members, or none>.`
   Run batch 1's
   entries side by side, then batch 2's, and so on, never two batches at once: `plan` keeps one parallel run per
   root, and never puts two entries whose `batchKeys` meet into one batch, because schedule step 6 names its note by
   globbing for the slug's next free ordinal and then writing, which is not atomic. Serial entries come one per
   batch, after every parallel batch. With no fork in the harness, run the entries one at a time here, under the
   same answers.
3. **Schedule's questions, answered.** The list schedule's **Under orient-all.** paragraph cites. A fork asks
   nothing: the decision round authorised its member set. A `## Decided for you` bullet is an agent's call: it
   never settles a § 3.5 match (answer 8) or a decision.
   1. Step 1's count: reported, as on every run; the skips are named.
   2. schedule § 0's misfit routing: the fork routes nothing. It runs no `defer` or `open`, and never the follow-up
      `/thread:schedule --tasks <serial members>`. When session-lane misfits dominate, it stops before writing and
      returns them. In a mixed set it schedules the parallel subset, leaves each misfit unstamped and returns each
      with its outcome and the follow-up line, unrun. Each is a **fit disagreement**, and § 8 lists it.
   3. schedule § 0's target repo: the entry's `root`. The `Local:` line is read as usual when it names that repo;
      otherwise the root is "the path the user gave", and `<localPath>` is empty. § 0's clone question (exit 4): a
      rollout clone is made only on Lachy's yes (ADR 0042), which no fork holds, so the fork takes the No, stopping
      before step 1 with nothing written, and its stop line names the would-be clone and
      `/thread:schedule <entry.args>`, which asks it. Exit 0 runs `--ensure` as written.
   4. Step 2.5's verifier: as detected. A section-only CLAUDE.md is read for its one command; with none, stop before
      writing.
   5. Step 2.6's baseline: `none`, and the summary says "not captured".
   6. Step 2.7's env bootstrap: CLAUDE.md detection only, else unset.
   7. schedule § 3's body dependencies: written only between two members of this call; any other is named.
   8. schedule § 3.5's gates: a match that a recorded `## Decisions` answer settles is dismissed. Any other match drops
      its task from this rollout: named, unstamped, never `ignore_gate`.
   9. schedule § 3.6's sweep: every undismissed hit is stamped `plan_approval: required`, with no ask-ahead (ADR 0034),
      and a spend hit also gets step 7's `## Decisions (recorded <date>)` Planner line.
   10. Step 4.5's affine merges: none; the candidates are named.
   11. Step 4.7's rung offers: none.
   12. Step 5's Solo: none stamped; the proposals are named.
   13. Step 6's naming: the slug is the `projectSlug` the fork's prompt gives (the lowercase kebab form of the project
       wikilink, apostrophes dropped), never a scope slug, and a taken name is Advance.
   14. Step 8: no execute handoff, and no Start when ready.
   15. Serial S1 and S4 ask nothing, as under orient § 7; S2's `sessionLane` members are returned as answer 2's
       misfits are.
   16. schedule's Pre-flight (schedule § 1.5, and S3.5 on the serial path) takes this pass's grades and answers as they
       stand: no grading agent, no round and no Grade log line (§ 2 step 7 logged them). Its `--tasks` is the fork's
       step 1 candidates, and its `--decided` the prompt line's decided slugs among them. A member not
       decided (a One call or Grill the round never reached, or an Orient one) is left out with its Dependent closure,
       unstamped, and returned. Its queue's ruled calls are written by its `decided-for-you --write --by orient-all`
       (schedule § 1.5's orient-all form), and the fork returns their block.
4. A fork returns schedule's summary verbatim, the path of each note it wrote, its fit disagreements, its Pre-flight's
   left-out members with each one's why, or its stop line.

### 7. Start

1. Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py sessions --plan "$S/plan.json" --wrote <each note a fork wrote, in plan order> --status <rollout>=<N> > "$S/sessions.json"`,
   one `--status` per status agent's action number; an unread one is left out. It returns `items[]`, already in
   start order (execute and Leg items, then repair, then orient last), and `left[]`: every live rollout that gets no
   item, with its action and its holds. Start exactly `items[]`, never another.
2. **The allow-list.** `sessions` applies it; the table is here for the reader, and its numbers are status § 4's
   **Recommended action** rules:

   | status § 4 action | Item |
   |---|---|
   | 6, every task merged | execute (the ceremony), when `plan` holds nothing on it |
   | 7, an open escalation | repair |
   | 8, `paused` | execute only when the rollout is in `plan.reinstate[]` and `plan` holds nothing else on it (`canExecute`); a plain `paused:` (Lachy's) gets nothing |
   | 11, a drift flag or a Needs you item | repair |
   | 13, nothing started | execute, when `plan` holds nothing on it (the Start stamp is a hold: the Stage starts it) |
   | 1–5, 9, 10, 12 | nothing: lineage, version, incomplete, a drain, a live queue or room stop, and a resume status cannot check from here |

3. An orient item's cwd is the home `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/thread-placement.py home --project <note>`
   prints, else `~/Projects/<Area>/<Project>/` when it exists, else none. Every other item carries its own `cwd`.
4. **On the Chorus Stage** (the `create_thread` tool answers ToolSearch, searched for as in handoff § Success contract):
   1. Call `list_sessions` once. Each Session's state comes from the list, never from a read: running a Turn, waiting
      on the listener, a failed last Turn, or at rest, with its background work.
   2. **Candidates, by item kind.** An orient item's only candidates are Sessions named exactly the item's `title`,
      and a repair item's only Sessions named exactly its `title`: the name `create_thread` was given, `Orient: <project>`
      or `Repair: <rollout>` as `sessions` cuts it to 60 characters with `…`, so a long name never matches its uncut
      form. An execute or Leg item's candidates are the Sessions whose `list_sessions` line
      carries `leads the Rollout <rollout>` as one of its ` · `-separated parts, wherever it stands (a relay line may follow it).
      That part's slug, the whole word after `leads the Rollout`, equals the item's `rollout` (the note stem)
      exactly, case aside, never as a prefix or a part. A line naming `demo-rollout-2026-10-26-2` is no candidate for
      `demo-rollout-2026-10-26` (chorus-p89-1, Chorus ADR 0077 as amended 2026-10-27).
      A roster line makes its Session a candidate whatever the Session's name, a `Repair:` one included.
      Only when no line names the slug, the names count, for Sessions named before chorus-p89-1. A Session whose line
      carries no `leads the Rollout` part is a candidate when its name is the item's title or contains the rollout
      slug, other than `Repair:` ones. A `leads a Rollout` line names no slug, so its Session is one of these.
      For example, the item for `demo-rollout-2026-10-26` finds `Demo rollout`, whose line carries
      `leads the Rollout demo-rollout-2026-10-26`, and, that Session at rest, the pass relays the item's prompt into
      `Demo rollout` by its id and raises no card; with no such line it finds `Execute: demo-rollout-2026-10-26`.
      No other Session ever holds an orient or repair item: a running lead in the project holds neither (repair's
      live-queue mode runs beside a lead).
   3. A candidate that is running, waiting, failed, or at rest with background work running: start nothing for the
      item, and name the Session by its id, with its state, since a lead's name `<Project> rollout` is shared by the
      project's other leads. Two or more Sessions whose lines name the slug: start nothing for the item, and name
      every one by id. Two or more leads of one rollout are Lachy's to settle, and Chorus answers that slug AMBIGUOUS
      whatever their number.
   4. A candidate at rest with nothing running: a roster candidate needs no read, its line being the Stage's own
      reading. An execute or Leg candidate the names found, not named exactly the item's title, gets one
      `read_session` first, asking only whether it is that rollout's lead or Leg; if not, it is no candidate. Each
      Session is read at most once in the pass. Every candidate left (an orient or repair one, a roster one, an
      execute or Leg one named exactly the item's title, or one the read confirmed) gets `relay_session` with the
      item's prompt, the Session named by its id: a lead is named `<Project> rollout`, a name the project's other
      leads share.
   5. No candidate: `create_thread` with the item's `title`, `prompt`, `tldr` and `cwd`.
      An execute or Leg item for a rollout a Session on the Stage leads by the roster never gets `create_thread`;
      a repair item beside its lead still does. A `Raised (task_id: …)` result
      is reported as raised, never counted as started: the Stage starts the card unless it holds it. A held card stays
      open as Lachy's offer, its `unstarted` line saying why (`"<name>" leads this Rollout on the Stage: …` when a lead
      appeared after the list, or another of the Stage's holds). An error becomes a manual prompt.
   6. With `create_thread` but no `list_sessions`, only the items for notes this pass wrote are started; every other
      item becomes a paste-ready prompt.
5. **Off the Stage**: one fenced block per item, in `items[]` order: `cd <cwd>` (for a Leg, `<alias> from <folder>`),
   then the prompt, labelled `paste-ready prompt (no session started)`.
6. A `manual: true` item (a `cx-*` row 1, `skills/execute/legs.md` § Hand over, or no Project root) is always a
   labelled manual hand-over.

Child orients start after every execute, so a lead's first `next` has marked its note started before an orient could
see it, and the orient prompt's second line names the note this pass wrote for that project.

### 8. Report

One message of statements, no question:

- the grades logged: § 2 step 7's `logged`, `exists` or `completed` line, its skipped tasks as a caveat;
- the decisions recorded, and those left for the next pass: each undecided One call and Grill (`later[]`,
  `skipped[]`, a Grill stopped part-way, `plan.undecided[]`) as "waiting on your answer, so it reaches the next
  round";
- each fork's Pre-flight leavers, listed by the `why` the fork returns, as schedule step 8's left-out block lists
  them: `undecided` as "waiting on your answer, so it reaches the next round"; `orient` with its pointer,
  `/thread:orient [[<home>]]`; `dependency` as "depends on [[<via>]], which is left out"; `ungraded` as "could not be
  graded (<reason>): the next pass grades it again";
- the sign-offs, the bounced ones marked, and any left unsigned with the line that refused it (§ 4);
- the unparks, snoozes and kills;
- each schedule's note, or its stop line;
- each fork's Decided for you block (schedule step 8), the calls ruled for Lachy, and any it could not write;
- the fit disagreements: the task, the grader's shape, schedule's outcome;
- the sessions raised (title → task id: the Stage starts it unless its card says why it waits), relayed (title → the
  Session's name and id), or held (title → the Session's name, id and state; for two or more roster leads, every one
  named by id), or the prompts printed;
- `left[]`: each rollout with its action, its status line and its hold. For action 12 add "check the owner session
  `<owner tag>`, then `/thread:execute [[<rollout>]]`", the tag from `plan.rollouts[].owners`; for a plain pause,
  "paused by you: the reinstate is yours";
- the waiting runs, each with its why;
- the held and undecided members, each held one with its `blockedBy` whys (a `dependency scheduled late` one goes
  next pass; a `dependency dropped` or `dependency not found` one goes only once its `depends-on:` link changes);
- the session-lane work, listed and never started;
- the caveats.

A later Prompt that opens `[Reported back by Chorus from …` gets one statement line, `<title> reported: <outcome>`,
with no tool call and no question.

### 9. Dry run

Runs §§ 2–3 (not § 2 step 7) with the budget, then
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py plan --rank "$S/rank.json" --scan "$S/scan.json" --rounds "$S/rounds.json" --assume-answered > "$S/plan.json"`
and `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py sessions --plan "$S/plan.json" --status <rollout>=<N>`,
with no `--wrote`. It assumes every in-budget decision answered, nothing signed and nothing unparked. Then
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py decided-for-you --rank "$S/rank.json" --tasks <every plan.schedule[] member>`,
with no `--write`, lists the calls the forks would write.

It prints the slate (§ 3's glance), the decision batch (each AskUserQuestion call's questions, then the grill list,
each in the Framing of `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`), the Decided for you list and the dispatch
plan: each batch's schedule args with the execute or Leg 1 each would start, then each item with its cwd and prompt,
and `left[]`.

It asks nothing, and writes only under `$S`. It never runs `record`, `estate-dispatch.py log`, `decided-for-you --write`, `approve-gates`,
`estate-rank.py snooze`, `unpark` or `kill`, a schedule fork, `list_sessions`, `read_session`, `relay_session` or
`create_thread`.

## Don't

- Reshape a project: Orient-graded work goes to its own orient session.
- Start, relay or move a live rollout other than through `sessions`' items: never on status actions 1–5, 9, 10 or 12,
  nor on a plain `paused:`. Never start a second lead: no `create_thread` for an execute or Leg item for a rollout
  a Session on the Stage leads by the roster.
- Relay into a Session the list shows running, waiting, failed or busy with background work, or read a Session for
  its state.
- Let any Session but one named exactly the orient item's `title` hold a child orient.
- Sign a gate Lachy did not sign in this pass, or ask a sign-off whose gates he has not been shown verbatim.
- Start session-lane or parked work, other than a project unparked in this pass.
- Schedule a run that waits, run two batches at once, route a fork's misfits, or run its follow-up line.
- Supersede anything: no `--regenerate`.
- Write `start: unattended`.
- Ask past the budget, sign-offs aside.
- Call the question tool from a fork or an agent.
