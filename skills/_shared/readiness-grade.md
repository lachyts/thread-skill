# The Readiness grade — grading and ranking the estate's open work

The estate pass's second step (ADR 0041; CONTEXT.md § Estate). After the Estate scan, one grading agent per project
gives each of its open tasks a **Readiness grade**, and `estate-rank.py` ranks the graded work into the **Ranked
slate**: candidate runs with their **Review load**, the decision rounds, the projects that need their own orient, and
the **Unpark offer** for each parked project with ready work. Scripts scan, the model decides: the grade is the
model's half, and everything after it is the script's. This file is the grading agents' brief and the ranking's prose
contract; the script's docstring holds its output schema. The lead that runs both is `orient-all`
(`${CLAUDE_PLUGIN_ROOT}/skills/orient-all/SKILL.md`).

**Plugin root.** This spec is read as a file, never rendered: run its commands by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Gradeable tasks

A task is gradeable when its row in the scan's `tasks[]` has `statusClass: active`, `inFlight: false` and at least
one live project. Its **home** is its first live project (`projects[0]`): the task is graded, ranked and run once,
there, whatever else it links. Every other open task is skipped with the first reason that fits, in this order:

- `unhomed`: no live project;
- `in flight`: in progress, in review, or in a live rollout (`_shared/vault-grammar.md` § In flight). In-flight work
  is never graded or routed again;
- `hold`: any other status.

## The grading agents

The lead runs one read-only agent per home project with gradeable tasks, side by side. Each agent gets:

- its project's scan row, its gradeable task rows, and the scan rows of the repos the project declares;
- today's date;
- this file.

Each agent returns one JSON object (§ Output). The lead saves each answer to a scratch file and runs the ranker over
all of them (§ The ranking). An answer that does not parse, or a task the ranker lists in `invalid[]`, gets one
re-ask that names its errors; anything still invalid after that is shown as ungraded, never guessed. The agent
writes nothing: no vault edit, no repo or git write, no fetch, and it asks Lachy nothing.

## What the agent reads

- The project's thread, at its thread home (CONTEXT.md **Thread home**; ADR 0039 d1). For a project with no code repo
  the thread is the only record of its decisions, so it is always looked for:
  - `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/thread-placement.py home --project <note>` prints the home
    repo when the project declares a qualifying one, and that repo's `THREAD.md` is the thread.
  - When it prints nothing, the project has no code repo, and its thread is its `~/Projects/<Area>/<Project>/THREAD.md`,
    or `_shared/threads/<slug>.md` for cross-workspace work (`${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Creating
    a new thread). Find it by slug with open's § Repo-thread lookup, `slug=<the project's slug>`, whose first two tiers
    are these homes (`_shared/threads/<slug>.md`, then each `~/Projects` THREAD.md by its `slug:`; a repo-tier hit is
    no home of a project without a qualifying repo). With no hit there, find it by directory name: the `THREAD.md` in
    the project's own folder, `~/Projects/<Area>/<Project>/` named like the project note (never under `_archive`).
    Only when neither finds one has the project no thread, and the grade rests on the rest of this list.
- The home repo's `docs/adr/` and `CONTEXT.md`, when there is a home repo.
- Each task note in full, and the notes its `depends-on:` names.
- The code each task names.
- The gate sweep, `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/gated_inputs.py sweep <note>...`: its hits
  are the recall floor for `gates`, never the verdict. A hit whose context names nothing the task pays for or
  authorises is dismissed.

## The grade

One grade per task, as CONTEXT.md **Readiness grade** words it:

- **Ready**: an agent can finish it without inventing a decision nothing records.
- **One call**: a single decision, offered with a recommendation.
- **Grill**: a few low-level decisions, each with a recommendation drawn from the project's thread, ADRs and code.
- **Orient**: the decisions shape the project, so it needs a full-context session of its own.

What counts as a decision is defined elsewhere, and used as it stands. A decision is a fork in the sense of
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/grill-fit.md` steps 1 and 2: a fork the executing session can resolve from code
or data (grill-fit.md step 2(a)) is not a decision, and a genuine Lachy decision (step 2(b)) is one. A fork that an
orient end line names as `fork for Lachy` and that is still open (orient § 2 Open forks; grill-fit.md § How a fork
comes back) is a decision. One that an `orient ruling:` line, a `## Decisions` section or an ADR has ruled on is not.

## Shape

The shape is the three-way test in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md`, applied hard, with its
rulings (ruling (c) included: serial-shaped work for the plugin's own repo is session lane): `parallel`, `serial` or
`session`. Read the test as if every decision the grade names were already answered. A task whose only need for
Lachy is those decisions is not conversation-gated, because the decision round answers them before anything starts.
A dispatch blocker (`execution-fit.md` § Dispatch blockers) never changes the shape: the scan reports it on the repo,
and the run carries it. A `parallel` task names its `repo`, one of the project's declared `repos:` entries as written.

## Each decision

Every decision, in every grade, carries:

- `question`: the fork, in one line Lachy can answer.
- `options`: required, 2 to 4 distinct short labels, the answers Lachy would choose between.
- `recommendation`: always given, and always one of the options; when unsure, the best guess, with `confidence: low`.
- `confidence`: `high`, `medium` or `low`.
- `why`: the evidence for the recommendation (a file and line, an ADR, a thread line).
- `fork`: optional. When the decision answers an open fork (§ The grade), the fork worded exactly as its orient end
  line words it, so the answer is recorded as that fork's ruling too.

The ranker checks each one and puts the recommendation first among the options, in the option's own spelling, so the
lead always has labels to ask with. orient-all asks the One calls through AskUserQuestion with the first option marked
as recommended, and the Grills in conversation, in the same shape. orient-all asks a label over 40 characters behind a
short numbered label, its full text in the option's description: keep labels short.

## The raise

ADR 0041: when the agent cannot recommend with confidence, the task's grade goes up. The ranker applies it in two
steps, over the order Ready, One call, Grill, Orient:

1. **Decisions.** The decision count implies a grade (0 is Ready, 1 is One call, 2 or more is Grill), and the task
   takes the higher of that and the agent's grade.
2. **Confidence.** If any decision's confidence is `low` (or missing), the grade rises one step. Orient stays Orient.

So a Ready task with one `low` decision becomes One call, then Grill. A One call or a Grill with no decision at all is
invalid, never raised: there would be nothing to ask. The output keeps the agent's grade (`agentGrade`), the result
(`grade`) and each step (`raised[]`), which the Grade log keeps (CONTEXT.md **Grade log**: `estate-dispatch.py log`
writes it, `skills/reflect/scripts/grades.py` reads it against outcomes). A doubt that a task is Ready is written as the
decision it may hide, with `confidence: low`.

## Size, deadlines and review

- `size`: `S` (under an hour of agent work), `M` (a few hours) or `L` (a day or more). A missing or unknown size reads
  as M, with a warning.
- `deadline`: `{date, why}` for an event or season about to pass that the agent finds (a launch, a festival, a
  booking window): today or later. One before today has already passed and cannot be met, so the ranker drops it
  with a warning. A task's `due:` comes from the scan, and an overdue `due:` still counts; the earlier of the two
  counts.
- `gates`: the kinds of gated input (ADR 0008) the task will need: `spend`, `credential` or `irreversible`. An
  external publish is `irreversible`, per execution-fit.md's ruling (a).
- `eyeCheck`: `true` when only Lachy can judge the result (how it looks, sounds, reads or feels).

Together they are the task's Review load: a parallel task's PR to read, a sign-off for its gates, an eye-check.

## Output

One object per project, holding every gradeable task of the project once:

```json
{
  "project": "<the home project's name>",
  "tasks": [
    {
      "slug": "<task slug>",
      "grade": "Ready | One call | Grill | Orient",
      "shape": "parallel | serial | session",
      "repo": "<a declared repos: entry; parallel tasks only>",
      "size": "S | M | L",
      "decisions": [
        {
          "question": "<the fork>",
          "options": ["<label>", "<label>"],
          "recommendation": "<one of the options>",
          "confidence": "high | medium | low",
          "why": "<the evidence>",
          "fork": "<optional: the open fork it answers, as its orient end line words it>"
        }
      ],
      "deadline": {"date": "YYYY-MM-DD", "why": "<the event>"},
      "gates": ["spend | credential | irreversible"],
      "eyeCheck": false,
      "why": "<one line: the evidence for the grade and the shape>"
    }
  ]
}
```

Leave `repo` off a task that is not parallel, `deadline` off when there is none, and `fork` off a decision that
answers no open fork; `decisions` is `[]` for a Ready task. Grades are read case-insensitively, with `-` and `_` as spaces (`one-call` is One call), and always written
back in the canonical spelling.

## Dependencies

A task's `depends-on:` and `blocked-by:` (the scan's `dependsOn`) are the only holds, as in the queue (schedule § 3).
Each entry is matched to an open scan task by slug, case-insensitively, a `[[Work/Tasks/x|alias]]` read as `x`. An
entry that matches no open task is satisfied: it landed, it is archived, or it is no task.

A matched dependency holds a graded task that is not Orient, unless:

- it is in flight: it lands without Lachy, and the queue holds the task until it merges; or
- it is graded Ready, is not held itself, and is not in a parked project other than the task's home. A dependency in
  the same parked project does not hold: unparking releases both.

Each holding dependency is listed in the task's `blockedBy[] {slug, why}`, and the why is one of:

- `One call`, `Grill` or `Orient`: its grade, after the raise;
- `ungraded` or `invalid`: it has no usable grade;
- `hold` or `unhomed`: it is skipped for that reason (§ Gradeable tasks);
- `parked`: it is Ready, in another project that is parked;
- `held`: it is Ready but held itself, so holds are transitive;
- `cycle`: it depends on the task, directly or through others (a task that depends on itself included).

A hold never moves a rank. It changes three things: a held member of a run is listed as `blocked`, outside the run's
sums, and a run with no member that can start or wait on a decision has no rank; a held task never counts toward an
Unpark offer; and a held One call or Grill stays in `decisions[]` with its `blockedBy`, since a hold by a One call or
Grill clears in the same round (the lead may skip one held by anything else). Ordering inside a run stays schedule's
(`depends-on:` in the queue).

## The ranking

Once every answer is saved, the lead runs:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py rank --scan <scan.json> --grades <file>...
```

It validates the grades (an invalid task is listed with every error, never guessed; a soft field that is missing or
unknown warns and takes its default), applies the raise, flags the holds and prints one JSON object (schema 1, in the
script's docstring). It writes nothing.

**The key.** The graded tasks other than Orient are ranked from 1, compared in order:

1. **Parked homes last**: a task whose home's standing is `parked` comes after every other, whatever its deadline.
2. **Due soon first**: a deadline within `DUE_SOON_DAYS` of today, overdue included, ranks first, the earliest
   first. A deadline further off counts for nothing here.
3. **Crowned homes first**: crowned means the home's standing is `crowned` (`status: crowned`),
   never the `crowned:` date, which queued projects carry too.
4. **Leverage**, highest first.
5. **Home standing**: crowned, active, queued, parked, other, none (estate-scan.py's `STANDING_RANK`).
6. **Home name, then slug**, so the order is total and a rerun is byte-equal.

Orient tasks have no rank. They follow the ranked tasks, by home and slug, and `orient[]` lists them by project, each
project for its own `orient` session whatever the budget. A parked project is never listed there: its Orient tasks
stay in `tasks[]` and wait on its Unpark offer, as its One calls and Grills do (**decisions[]** below), so the pass
starts no session on a shelved project. A parked project with no Ready work gets no offer and stays shelved; once
unparked, by an offer or by hand, the next pass lists its Orient tasks.

**Leverage** is agent work per minute of Lachy's attention: `SIZE_MINUTES[size]` over the larger of
`ATTENTION_FLOOR` and the attention minutes. Attention is deciding plus reviewing: `DECISION_MINUTES[grade]` per
decision (none for Ready), plus the Review load at `REVIEW_MINUTES` per item (a parallel task's PR, a sign-off when it
has gates, an eye-check when `eyeCheck` is set). A gate of any kind costs the sign-off, `spend` included: the ranker
sees a gate's kind, never its price, the standing approval's limit or the month line, so a spend gate the standing
approval would sign is still charged (ADR 0034's 2026-10-27 amendment, residual (x)). A session task adds its whole
agent time, since Lachy is there throughout.

**Runs.** The candidate runs group the ranked parallel and serial tasks by home, shape and root:

- A parallel run's root is the scan's repo row for the task's `repo`, or the home's only declared repo. Otherwise it
  has none, and its why is `repo unknown` (two or more repos and no `repo`, or a repo the home does not declare) or
  `no repo declared`. Other parallel runs on the same root are named in `sameRoot`: a repo holds one unfinished
  parallel rollout at a time (schedule § 0).
- A serial run has no root: it is one candidate chain per project, which schedule's serial path splits.
- Session-lane and Orient tasks are in no run.

Each run lists its members in rank order as `ready`, `waiting` (One call and Grill) and `blocked` (held). It sums the
agent minutes, decision minutes and Review load of its ready and waiting members, carries its repo row's `blockers`
and `unchecked` verbatim (unchecked never means clear), and takes the best rank among its ready and waiting members,
or none when every member is blocked. The runs are listed in rank order, the unranked last.

**decisions[].** The One call tasks first (round `one-call`), then the Grill tasks (round `grill`), each in rank order,
each with its `minutes` and the `cumulativeMinutes` so far, so the lead can stop at Lachy's stated budget. The tasks
of parked projects wait on their Unpark offer and are left out.

**The constants** are starting values. tests/contracts/readiness-grade.test.mjs pins this table to the script, so a
change the weekly Reflection's grade accuracy calls for lands in both together; they are never operator settings. The
Grade log measures the grades and, through Slot hours per size, `SIZE_MINUTES`; `DECISION_MINUTES`, `REVIEW_MINUTES` and
the fortnight have no measure in the record (reflect § What the record cannot show).

| Constant | Value | What it sets |
| --- | --- | --- |
| `GRADES` | `["Ready", "One call", "Grill", "Orient"]` | the grades, in raise order |
| `SHAPES` | `["parallel", "serial", "session"]` | the shapes |
| `SIZE_MINUTES` | `{"S": 30, "M": 120, "L": 480}` | agent minutes per size |
| `DECISION_MINUTES` | `{"One call": 1, "Grill": 2}` | Lachy's minutes per decision |
| `REVIEW_MINUTES` | `{"pr": 2, "signOff": 1, "eyeCheck": 3}` | Lachy's minutes per review item |
| `ATTENTION_FLOOR` | `1` | the least attention a task is charged |
| `OPTIONS_MIN` | `2` | the fewest options a decision offers |
| `OPTIONS_MAX` | `4` | the most options a decision offers |
| `DUE_SOON_DAYS` | `14` | the deadline tier's window, in days |
| `SNOOZE_DAYS` | `14` | a snooze's length, in days |
| `SNOOZE_KEYS` | `["snoozed_until", "snoozed_ready"]` | the snooze record's keys |
| `GATE_KINDS` | `["spend", "credential", "irreversible"]` | the gate kinds, gated_inputs.py's sweep keys |
| `CONFIDENCE` | `["high", "medium", "low"]` | the confidence levels |

**Failures.** Exit 2 is a refusal with one `estate-rank:` line (a scan or grades file that is not JSON, a scan schema
other than 1): fix the input and run it again. Exit 3 is no vault, no PyYAML, or a sibling script that will not
load. A `python3` error naming a missing script (`can't open file '/skills/…'`) is an empty plugin root, not the
script's failure: `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md` rule 4's re-run.

## The Unpark offer

A parked project (standing `parked`) with at least one home task graded Ready after the raise and not held gets one
row in `unpark[]`: its ready count and tasks, and the offer CONTEXT.md **Unpark offer** words. Unpark it (it becomes
`status: queued`), snooze it, or kill it (done and archived). The snooze record has one writer, and the unpark and
kill writes are its siblings, so orient-all makes all three through this script:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py snooze <project> --ready <n>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py snooze <project> --clear
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py unpark <project>
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py kill <project>
```

`--ready` writes two keys on the project note, beside its `status: parked`: `snoozed_until`, today plus `SNOOZE_DAYS`
(a fortnight), and `snoozed_ready`, the ready count it was snoozed at. Each row's `snoozeWrite` holds both values. It
refuses (exit 2, nothing written) anything but a live project the scan would read as parked, and any frontmatter it
cannot edit cleanly.

`--clear` removes both keys. **The unpark and kill writes clear both keys in the same save as their status write**:
a snooze outlives the parking it was given for, so a project unparked, then parked again before its `snoozed_until`,
would otherwise come back still snoozed and hide its Unpark offer. `--clear` takes any live project, parked or not
(a project unparked by hand), and a note with neither key is left untouched (`no snooze on <note>`, exit 0); it
refuses (exit 2, nothing written) a dead project and any frontmatter it cannot cut cleanly.

`unpark` sets `status: queued`; `kill` is Mark done (`done: true` and `completed:` today, any `crowned:` stamp
dropped), so the nightly sweep archives the note. Both refuse (exit 2, nothing written) anything but a live project
the scan would read as parked, and any frontmatter they cannot edit cleanly; `kill` also refuses an umbrella (a
folder note) with a live sub-project, since archiving a done folder note moves its whole folder. An unparked
project's Ready, unheld work starts in this same pass; its One calls, Grills and Orient tasks wait for the next.

The record is read only on a parked project, and cleared whenever the project leaves parked through the offer. A
project unparked by hand keeps its keys, and if it is parked again, the old snooze hides the offer for at most what is
left of its fortnight. A snoozed project is not offered again (`offer: false`, with the date and both counts in its
`why`) while today is before `snoozed_until` and its ready count, the Ready tasks not held, is at most
`snoozed_ready`. It is offered again once the fortnight is over or its ready work grows. A `snoozed_until` that is not
a date is a warning and no snooze; with no `snoozed_ready` the snooze is date-only, and the project is offered again
only when the date passes.
