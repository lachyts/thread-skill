---
name: orient
description: 'Pick a project back up and reshuffle it: audit a project/area after time away, re-sort its open work (bugs, brain dumps, loose tasks, unstarted phases), grill what is unclear, write phases and tasks, route parallel- and serial-shaped work to rollouts and offer to execute. One plan, design note or brain dump becomes phased tasks. Triggers on "orient me on <project>", "where is <project> at overall", "reshuffle <project>", "turn these tasks into a roadmap", "split/break this plan into numbered, phased tasks", or /thread:orient [target]. One thread: thread:next.'
---

# /thread:orient — pick a project up and reshuffle it

The project-altitude sibling of `next` (ADR 0003), and the one shaping verb (ADR 0027). `next`
answers "what's my move?" for the *current thread*; `orient` answers it for a *whole project or
area* returned to after time away. It audits the balls in the air, recommends ONE best use of
Lachy's time, then reshuffles without asking (ADR 0036 d5): `--steer` routes the work as it stands and
`--look` stops at the audit. A reshuffle re-sorts all the open work, grills what is unclear and writes
the result at one gate (`reshuffle.md`). Orient then routes by the three-way execution-fit test:
it schedules parallel-shaped phases itself, steers the serial-shaped and session-lane work (a
serial rollout, a focus item, or both) and ends with the **execute handoff**.
Pointed at a single plan, design note or brain dump, it runs a **scoped reshuffle** of that note
alone.

**Contains no route logic of its own** beyond the reshuffle: hands-on focus
dispatches to `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` (or the task's own `## Launch` block);
parallel- and serial-shaped work go to `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md`; the execute handoff runs
`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` or `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md`,
or stamps the note for the Stage. None is re-implemented here. The execution-fit test
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md`) decides the lane and shape, hard, not as a
preference.

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Runtime boundary

Orient's audit, reshuffle and steering are portable, and orient spawns no child agents: ADR 0040
retired the batches of ADR 0023. Hands-on pickup follows `open`'s contract.

Both rollout shapes go through schedule and execute's runtime gate.

## Invocation forms

```
/thread:orient Chorus                     # audit, then reshuffle (the default)
/thread:orient Chorus --steer             # audit, then steer the work as it stands (no reshaping)
/thread:orient Chorus --look              # audit only: stop after § 3 and write nothing
/thread:orient [[Chorus]]                 # explicit wikilink form
/thread:orient                            # resolve the target from the session directory
/thread:orient [[<design, phase or brain-dump note>]]   # scoped reshuffle of that note
/thread:orient ~/.claude/plans/<plan>.md  # scoped reshuffle of an approved plan file
/thread:orient "<prose describing the work>"            # scoped reshuffle of inline prose
/thread:orient Chorus --debrief           # retired (§ 10)
```

## Process

### 1. Resolve the target

**`--debrief` stops first.** When the arguments carry `--debrief`, print § 10's line and stop,
before the resolver runs: no resolver call, no question, no read and no write.

The target is one project, one area or one note (CONTEXT.md **Target**, ADR 0036), and the resolver
runs before § 2 reads anything. Quoted prose is a scoped target, as below. Anything else, with
orient's own flags (`--steer`, `--look`, and the words "steer only" or "look only") removed, goes
once to
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-target.py "<argument>"`, run from the
session directory. The argument is quoted as one word, so a `[[link]]` never meets the shell's
globbing; a bare invocation passes none. It prints one JSON object: `outcome` (`resolved`,
`candidates` or `none`), the `target`, up to three `candidates` (best first; the pick first when
resolved), a `dir_anchor` (the area the directory sits in), a one-line `reason` and a `learn_dir`.

- **Resolver failure.** If the resolver exits non-zero (2: a refused `--cwd` or a usage error; 3:
  no vault or no PyYAML), report its one `resolve-target:` line and ask in plain text for the
  target (Owner *yours*: which project he means, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`), sweeping nothing
  before an answer. His answer goes to the resolver as an argument, and a
  second failure ends the orient with that line.
- **`resolved`** → name the pick in one line and carry on:
  `Target: <name> (<kind>; <reason>) — say stop to change it`.
- **`candidates` or `none`** → ask before any § 2 read (Owner *yours*: which project he means,
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`): `AskUserQuestion` with the candidates, best
  first, then `dir_anchor` when it is not already listed, up to four options. With one option, add
  `Stop — orient nothing`, because the tool needs two. With none, ask in plain text for a project
  or area name, or stop, and end the turn. A typed answer (the plain-text one, or
  `AskUserQuestion`'s `Other`) is resolved again as an argument, and keeps the first answer's
  `learn_dir` (below).
- **A stop.** When he stops a pick, re-ask as above without the stopped pick (its Owner labelled above,
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`). A stopped pick from
  a declared directory (rung `directory`) also names its declaring note, whose `repos:` sent the
  session there.
- **A name or wikilink** (`/thread:orient Animately`, `[[Animately]]`, a sub-project note, an alias)
  → the basenames and `aliases:` of every live project and area note under
  `~/repos/obsidian/Work/Projects/`, at any depth (archived and done notes excluded). An exact,
  case-insensitive hit or a clear fuzzy winner resolves; a close call or no match asks.
- **A single-note target** → a **scoped reshuffle**: a wikilink or vault path to a note that is not
  a project or area note (a design, phase or brain-dump note), a plan file path, or quoted prose.
  The resolver reports it as kind `note` or `file`. Its project comes from
  `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § Scoped targets; the area and vault folder
  follow from that project.
- **Bare invocation** → the session directory, matched against `repos:` frontmatter across
  `~/repos/obsidian/Work/Projects/**` (the longest whole-component prefix; the git root counts; a
  linked worktree reads as the same path in its main checkout; a directory several projects declare
  asks); else a workspace or launch folder (`~/repos/workspaces/_shared/state/launch-folders.json`)
  gives its area; else the directory's own name, matched within the area its parent directories
  name.
- **Vault folder and area**, for a note matched by either route: the vault
  folder is the top-level `Work/Projects/<Folder>/` the note sits in, at any
  depth, never its parent folder. The area is the note's `area:` frontmatter,
  else that folder — the same rule as process-scan rung 3. So
  `Life (area)/Audio Intake/Audio Intake.md` gives vault folder `Life (area)`
  and area `Life`. A name that matches a top-level folder takes that folder
  as the vault folder. § 2 Vault sweeps the vault folder; § 2 Threads sweeps
  the area. The resolver applies this rule and reports both as `folder` and `area` on its target
  and every option, taking the first non-empty item of a list-valued `area:`.
- The registry row (`~/repos/workspaces/_shared/workspace-registry.md`) gives the workspace dir,
  launcher aliases, and project roots. **Areas with no workspace** (Life, 2D, …) get a vault-only
  audit.
- **The learned directory.** The `learn_dir` to hold always comes from the first answer, the
  directory's, and survives everything after it in § 1: the re-ask after he stops a `resolved`
  pick, a typed or `Other` answer, and that answer's re-resolution as an argument, whose own
  `learn_dir` is null. When he lands on a *project*, from the ask, the re-ask or a typed answer,
  hold that `learn_dir` with the project's `note` field: the picked option's, or the re-resolved
  target's `note` when a typed answer resolves to a project. The learn waits for § 4. Nothing is
  held for an area pick, a confirmed first pick, Look only (`--look`), a scoped target or a dry run,
  and a directory with no `learn_dir` is never written back.

A project or scoped target narrows § 2 to that project (§ 2 Scope); an area target keeps the area
sweep.

### 2. Audit (read-only sweep)

**Scope by target.** An area target keeps the bullets below word for word. A project target sweeps
that project, never its whole area (ADR 0036): its note and, for a folder note, every project-tagged
note in its folder at any depth (its sub-projects); tasks whose `projects:` link it or any swept
sub-project; phase notes for each swept project; its related projects; THREAD.md in each swept
project's `repos:` directories and in the directory it was resolved from, plus `_shared/threads/`;
and Drift and the slots for each swept project.

- **Next-action slots, first** (estate ADR 0008, decision 7): each project
  note's `next_task:` and that task's `next_action:` (its title when the
  line is blank), read with
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py read <project>…`
  — one `slot <project> live | blank | dead:<reason> <task> <line>` row
  each. A **dead link** (CONTEXT.md **Next task**) reads as a blank slot;
  the script decides which links are dead, never judge it by eye. The slot
  is the project's standing answer; the rest of the sweep is weighed
  against it.
- **Vault**: the area note + every sub-project note (a note whose
  frontmatter `tags:` includes `project`, never a reference, garden or
  README note) under the vault folder `Work/Projects/<Folder>/`, at any
  depth; `Work/Tasks/` frontmatter sweep (`rg` for
  `projects:` matching the area or its projects — collect `status`,
  `priority`, `scheduled`, `due`, `launch`, `phase`,
  `rollout`, `tags`, `projects`), plus one body read of those task notes for orient end lines
  (`rg -n 'orient end: run'`: the end lines § 2 Open forks reads) and a second for Lachy's fork
  rulings (`rg -n 'orient ruling: '`, the lines § 5 writes); phase notes in `Work/Phases/` for the area's projects. The reshuffle
  classifies from this sweep; it does not walk the folders again.
- **Threads**: THREAD.md state lines across the area's project dirs
  (`~/Projects/<Area>/*/THREAD.md`), in `<repo>/THREAD.md` for every repo the target's projects
  declare (a code project's thread lives in its repo, ADR 0039), and in `_shared/threads/`. Skip a
  directory `bash "${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh" --in-place <dir>`
  names (exit 0, a rollout clone, ADR 0042) and read its in-place twin's file instead: a clone's
  THREAD.md is a copy of the twin's, never a thread.
- **Drift** (ADR 0026): run the shared reconcile step as a dry run for every project in the target
  in one Bash call,
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/reconcile-project.py --project <slug> --json`,
  saving each project's output to its own file under one `mktemp -d` directory (`<dir>/<slug>.json`)
  and printing the path and the JSON. Keep its UNAMBIGUOUS and AMBIGUOUS lists and each saved path:
  § 4 binds the apply to that file. It writes nothing to the vault.
- **Placement** (ADR 0039 d5; CONTEXT.md **Placement check**): for a project or area target, run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/thread-placement.py audit --project "<note>" [--project "<note>"]…`
  once, with one `--project` per note swept (each its vault-relative path). Keep its summary line, its finding
  lines (`<kind>: <path> — <detail> · fix: <fix>`) and its `unchecked:` lines for § 3. Report-only: it writes
  nothing, and orient moves no thread on it. A scoped target runs none. A non-zero exit is one
  `thread-placement:` line in § 3, never a blocker.
- **Declared check** (ADR 0036 d6; CONTEXT.md **Declared check**): for a project target only, run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/declared-check.py run "<note>"` once, with
  § 1's vault-relative `note` field and a 300-second command timeout (`timeout: 300000`). A plain
  run changes nothing. Its first line is a JSON header; for `status: ok`, read all `bytes` of the
  check's output after it, which are its entries (a long result the Bash tool saves to a file is
  read whole from that file, never from its preview). Keep the header's `digest`, and carry the
  entries to § 3 Shape and to `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` § Declared check,
  whose gate alone runs
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/declared-check.py advance "<note>" --expect <digest>`,
  also with `timeout: 300000` (it runs the check twice).
  `undeclared` adds nothing. Any other status is its one `audit` line, and a non-zero exit its one
  `declared-check:` line: report it in § 3 and carry on, never a blocker. An area or scoped target
  runs no check.
- **Priorities card** (Chorus ADR 0110 d5; CONTEXT.md **Priorities card**): each swept project note's
  `## Priorities` section, read whole when it has one: how robust the work must be, who it is for, what matters most
  and the technical details he steers himself. Every later ask in this orient reads it (§ 3.5's own ask excepted): a
  call it answers is *priorities*, decided and listed as Decided for you, and a detail it says he steers is *yours*
  (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 1). A project target whose note has none is what § 3.5 is for.
- **Related projects**: projects the target's notes link or name, and projects linking the
  target, especially ones `status: parked` or being absorbed by it. Read their unstarted phases
  and loose tasks for overlap with the target's open work (the reshuffle may pull them in).
- **Recency**: overdue `scheduled:`/`due:` dates; note staleness
  (last-modified); `git status`/`git log -3` in each project root — dirty
  trees also surface aborted-session partial edits worth flagging.
- **In flight** (the reshuffle's reach tiers use it too): as defined once in
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/vault-grammar.md` § In flight, which also holds the
  phase/task filename pattern and the status sets this sweep reads. Report it as such; never route
  it again (§ 6) and never reshuffle it.
- **Open forks** (the one definition; §§ 3, 5, 6 and 7 use it): each fork a task's latest
  orient end line names (`fork for Lachy: <fork>`) stays open until an
  `orient ruling: <fork> → <ruling>` line in its `## Notes`, timed after that end line, rules on
  it. The end line is the one orient's retired batches (§ 8) wrote into a task's `## Notes`,
  `- <UTC ISO> orient end: run <run>, job <job>, partial: fork for Lachy: <fork>; evidence: <…>`,
  with `; fork for Lachy: <fork>; evidence: <…>` appended for each further fork. A task with any
  open fork is blocked on Lachy. A ruled fork is decided: it is never
  reported, excluded or grilled again, whatever route the task takes next. A later run's end line
  supersedes the whole set.
- **Decisions waiting**: an open task tagged `decisions` (the weekly Reflection's decision task,
  ADR 0037 d5) is Lachy's, decided at the top of a run through `/thread:reflect --decide`.

### 3. Present

A situational report written for Lachy catching up, not a log:

- **Headline** (1–2 sentences): the state of the project as a whole.
- **Balls in the air**: per-sub-project one-liners — the slot first
  (`next: <next_action> ([[<task>]])`, or `No next action`), then state,
  blocker, staleness. Group: active / in-flight / stalled /
  dormant. An open decision task (§ 2 Decisions waiting) is listed first, as
  blocked on Lachy: its rule proposals and held trades wait for his yes or no. A task with an open fork (§ 2 Open forks: named by `fork for Lachy` in its latest orient
  end line, with no `orient ruling:` line for it timed after that end line) is blocked on his
  decision: name every open fork (grill-me). A ruled fork is not listed.
- **Drift**: one line, the counts plus names, split into unambiguous (fixed next, in § 4, unless
  `--look` or a scoped target (report-only then)) and ambiguous (listed for Lachy, never applied).
  Call the line the notice for those fixes only when fixes will follow (a default or `--steer` run
  on a project or area); on a `--look` run or a scoped target, say it is report-only. Omit the line
  when both lists are empty.
- **Placement**: the § 2 audit's summary line, then one line per finding with its fix, and its
  `unchecked:` lines; or its one `thread-placement:` line. Omit the line on `placement: none`.
  Report-only: a misplaced thread is moved by project-structure-audit or by Lachy, never by this run.
- **Shape**: how much a reshuffle has to work with: loose tasks, brain dumps, unstarted phases,
  overlaps found in related projects, and any live rollout; plus the declared check's entries
  (§ 2), each a loose item until the reshuffle places it, or its one audit line.
- **ONE recommended best use of his time**, with a one-line reason — same
  single-recommendation discipline as `next`. Everything else is context, not
  competing recommendations. Frame it as a **proposal against the slot** of
  the project it belongs to, so the two never read as competing answers:
  the slot's own task → say they agree; a different item → name the slot and
  say why this beats it; a blank slot → say the recommendation would fill it.

### 3.5. The Priorities card

Asked once per project, so every later ask can be measured against it (Chorus ADR 0110 d5): when the target is a
project and its note (§ 1's `note`) has no `## Priorities` heading, put the card to him after § 3's report and
before anything else is asked or written, in one `AskUserQuestion` call of four questions, each in the Framing of
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 3 (Owner *yours*: how robust, who it is for and what matters most
are his intent, and where he steers is his by Chorus ADR 0110 d3). Each question's options come from the audit (the
project note, its thread, its ADRs and § 3's report), the recommended one first with its why, and each question ends
with "What would make this wrong for you?". It is no question about the reshuffle, which still follows without one
(§ 4):

1. **How robust** — production-ready or lightweight: what a failure would cost, and so how much testing, review and
   hardening the work gets.
2. **Who it is for** — him alone, a named few, or the public: whose use the work is judged by.
3. **What matters most** — the one quality the project trades the others for (quality over speed, say, or reach
   over polish).
4. **Where he steers** — the technical details he decides himself (GifLab's compression, for one), or none: a
   technical call there comes to him in the Framing, and everywhere else it is decided for him and listed.

**The write.** His answers go into the project note at once, as one `## Priorities` section inserted just before
the note's first `## ` heading (at its end when it has none), nothing else in the note changed. Each line carries
his pick in his own words, with his Note after it when he wrote one:

```
## Priorities

- **How robust:** <his answer>
- **Who it is for:** <his answer>
- **What matters most:** <his answer>
- **Where he steers:** <his answer, or "nowhere named: technical calls are decided for him">

Asked at orient, <YYYY-MM-DD>. A Note that corrects a line is written back here the same day.
```

A question he leaves unanswered is written `not answered (<YYYY-MM-DD>): the estate brief stands in`, so the card
exists and is never asked again. If he stops the whole ask, nothing is written, the orient carries on against the
estate brief (`~/.agents/knowledge/how-lachy-decides.md`) and the next orient puts the card again. Report the
write in one line with the note's `obsidian://` link.

**Once.** A note with a `## Priorities` heading is never asked again, whole or in part: § 2 reads it, and he
changes it by hand or through a Note. An area target and a scoped target put no card and write no new one: an
area's projects are asked at their own project orient, and a scoped target's project at its own. A card § 2 read
for either still takes his Note that corrects it (below). Only Look only and a dry run write nothing: they put no
card and write back no Note. Steer only asks it, like a default run.

**A Note corrects it.** Whatever the target, a Note of his on any later ask in this orient (the grill, R4's gate,
§ 6's steer) that corrects a line of a card this orient holds (one § 2 read, or the one just written
above) is written back into that card at once, the same day: that line takes his words, followed by
`(<YYYY-MM-DD>, from a Note)`, and the report says so in one line. A correction made in the grill is the one write
the reshuffle makes before its gate (reshuffle R3), and it stands if he stops the grill or declines the gate.

### 4. Reshuffle by default

No question (ADR 0036 d5): Lachy picked Reshuffle at every orient, so the audit flows straight into
the reshuffle (§ 5), which writes nothing before its gate but a Note's correction of a Priorities
card (§ 3.5), and whose grill he can stop at any question. The opt-outs come with the invocation
(§ Invocation forms):

- **Steer only** (`--steer`, or "steer only" in the arguments) — no reshaping: route the open work
  as it stands (§ 6), e.g. to schedule a serial rollout.
- **Look only** (`--look`, or "look only" in the arguments) — the audit was the deliverable; stop
  after § 3, with no writes of any kind: no drift fixes, no learned directory, no slot write.
- **An empty shape** (§ 3 Shape: nothing loose, unclear or unphased, and no pull-ins) — nothing to
  reshuffle, so go straight to § 6's steering.

**Drift fixes.** A default run and Steer only authorise them, as choosing Reshuffle did under ADR
0027; the § 3 Drift line is the notice, and `--look` applies none. Re-run
the reconcile step with `--apply --only <that project's saved dry-run file>` for each project whose
dry run listed unambiguous items, so the reshuffle never forms a roadmap on top of work Lachy saw
finished. `--only` writes just the items the § 2 dry run listed: a plain `--apply` recomputes and
can close work a live rollout landed between that dry run and the apply, which Lachy never saw.
Report any `New since review` items to Lachy as landed since the dry run and not applied (the next
orient lists them again), and any `Reviewed, not applied` items with their reasons:
`now ambiguous: …` needs his eye; `no longer drift (…)` is benign (closed or moved since, by the
rollout's ceremony or a mark-done). Neither is written, so both join the reshuffle's frozen
possibly-landed tier (reshuffle R1). If the saved file is gone (`--only` exits 2), re-run the dry
run, report its Drift line and apply from the new file. Ambiguous items are listed for Lachy and
never applied. A scoped target applies no drift fixes: it reshapes one note, so the § 3 Drift line
is report-only for it. It goes straight to its reshuffle (`--look` still stops it after § 3).

**The learned directory.** A default run and Steer only also run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-target.py --learn "<learn_dir>" "<note>"`
when § 1 held a `learn_dir`, where `<note>` is the vault-relative `note` field § 1 held with it (the
picked option's or the re-resolved target's; it carries a `/`, so the script resolves exactly that
file; never the bare name, which two projects can share), and report its one line; a refusal is
reported and never blocks. Look only learns nothing.

### 5. Reshuffle

Run the reshape step in `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md`: the item set by reach
tier, the clear/unclear sort and proposal, the grill of what is unclear (which Lachy can stop at
any point), the one gate, the writes. With nothing to reshape (Lachy stops the grill at once and
the gate is empty), carry straight on to § 6.

A task with an open fork (§ 2 Open forks) counts as **unclear** for R2 whatever its body says, so
R3's interview (`grill-me` or `grill-with-docs`, as R3 picks) puts each open fork and its evidence
to Lachy. His ruling is written into the task note at R5, after the gate: the respecced body
carries it, and one `## Notes` line per fork, `- <UTC ISO> orient ruling: <fork> → <ruling>`, with
`<fork>` worded as the end line words it, marks that fork decided. A fork he does not reach stays
open. Steer only skips this step, so its open forks wait for the next Reshuffle.

### 6. Route

- **Run the execution-fit test**, three-way, on each phase the reshuffle touched and on each other
  open cluster, and name its outcome: parallel-shaped, serial-shaped or session lane. Mixed sets
  split, as the fit-test doc says. Serial-shaped work on the plugin's own repo counts as session
  lane (the fit doc's ruling (c)).
- **Parallel-shaped → a parallel rollout, scheduled here.** Run
  `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--regenerate --tasks <members>`, naming
  exactly the members of the parallel-shaped phases (or clusters) on that repo: never a bare project
  run, which would also sweep up serial-shaped and session-lane phases and whatever the grill left
  unresolved. A task with an open fork (§ 2) is left out of `--tasks` until Lachy rules on it. A
  scoped target routes only the tasks its own reshuffle wrote. **At most one
  unfinished rollout per repo and project**, each project's in its own rollout clone (ADR 0064), and schedule
  § 0's unfinished-rollout check enforces it.
  `--regenerate` is orient's supersede policy: the check allows a supersede only for a paused or
  never-started rollout of this project (its unlanded tasks carry into the new one), and schedule
  § 0 finishes an interrupted supersede on its own.
  - **Schedule stopped at § 0** (one of its checks refused; for this check, another project's
    rollout on the repo, one that has run and is not paused, two at once, or a live serial chain
    that writes the repo and so owns it (ADR 0040), any project's) → schedule stamped no task and
    wrote no new rollout note, so orient must schedule nothing and touch nothing else.
    The one exception is schedule's own: a `file` move or an `interrupted` finish that § 0 made
    before the refusal stays, since it completes a supersede an earlier run confirmed (an
    `interrupted` finish stamps the incomplete note, re-points task notes to it and closes out the
    prior rollout). Orient reports any such finish from schedule's output, never as "nothing
    written". The phases are written and wait; orient reports schedule's remedy and names the next
    move: `/thread:status` (then `repair`) for a stuck rollout or a serial chain that has run,
    `status: dropped` on a never-started serial chain's note (dropping it frees its tasks) or run
    that chain, or a later `/thread:orient <project>` (`--steer` is enough) once
    the repo is free.
  - **Uncommitted grill docs.** If R3's grill left `CONTEXT.md` or `docs/adr/` changes
    uncommitted in the target repo, schedule nothing there either: every worktree branches from
    `origin`, which lacks them. Name them as the next move (land them through the repo's PR
    route), then an orient with `--steer` schedules.

  Schedule's own § 0 checks can still stop it with a named remedy, which orient reports.
  Schedule's Pre-flight (schedule § 1.5) may ask its decision round here (decisions, never a confirm) and leave
  Orient-graded or undecided tasks out with their dependants, unstamped; orient reports them from schedule's summary.
  A serial rollout never takes parallel-shaped work; orient never re-implements the
  merge engine.
- **Serial-shaped and session-lane work → steer.** If any serial-shaped or session-lane work is
  left, steer it with `AskUserQuestion`, recommended option first (informed by the audit — e.g.
  no serial-shaped cluster → recommend Hands-on), in the Framing of `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`
  (Owner *yours*: how he spends his time on the project). A Hands-on recommendation hands work back to him, so its
  description says why: no serial-shaped cluster is left for a rollout to take:
  - **Autonomous** (offered only when a serial-shaped cluster exists) — schedule the serial-shaped
    clusters as a serial rollout (§ 7) while Lachy stays focused elsewhere. This answer IS the
    scheduling authorisation: no per-cluster confirm follows. § 9's execute handoff follows any
    note written, and the session-lane work stays where the reshuffle put it.
  - **Hands-on** — he has time for this project: if the best-focus item has a THREAD.md or capture
    task, run `open`'s pickup logic; else follow the task note's `## Launch` / `## Resume prompt`.
    No ceremony beyond that. Serial-shaped clusters stay unstamped.
  - **Mixed** (offered only when a serial-shaped cluster exists) — hand him the highest-leverage
    serial-shaped or session-lane item, as Hands-on does, AND schedule the remaining serial-shaped
    members as a serial rollout (§ 7). The handed item is left out of the serial `--tasks` list,
    and it is never a task § 6 just stamped.
  - **Not now** — leave the serial-shaped and session-lane work unstamped where the reshuffle put
    it.

  With only session-lane work, the options are Hands-on and Not now.
- **The slot write** (fill-blank only — estate ADR 0008 decision 4), after the steering answer:
  in every mode but Look only or a dry run, when the recommendation is a task note that stays
  open, run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py fill <task> [--action -]`
  (the line on stdin, grain rule and targets as
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4b), naming the task by its
  post-reshuffle filename. It fills only
  a blank or dead slot and a blank `next_action:`; a set slot is never
  overwritten — only a set-down or Lachy does that; the recommendation
  stays a proposal against it. Skip the write when Hands-on
  picks the task up through `open`'s pickup and it is a capture: that
  completes the capture, so the pointer would be dead the moment it landed.
  An ordinary task stays open there and gets the fill like any other.

### 7. Autonomous: a serial rollout

Under Autonomous or Mixed, run `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with
`--tasks <members>` **once per project**: each call's members are exactly that project's
serial-shaped members of the clusters § 6 named, less Mixed's handed item. Each member goes in
exactly one call, under the first project in its `projects:` that this orient swept, so no call
spans two projects: schedule's `projects:` filter is strict, and it writes one serial rollout note
per chain (schedule § Serial path). Never a bare project run. Schedule's serial path decides chains
and surfaces (ADR 0040). The steering answer authorises every call, and § 9 follows each
note written. A project with nothing left gets no call, and orient says so. Schedule's Pre-flight (its serial
path's S3.5, schedule § Serial path) may ask its decision round here too (decisions, never a confirm) and leave
Orient-graded or undecided members out with their dependants, unstamped; orient reports them from schedule's summary.

- **Exclusions** (kept out of every `--tasks`; the fit test already sends most of them to the
  session lane): conversation-gated tasks (need Lachy's input — say so, leave them for Hands-on or
  the next reshuffle's grill). The weekly Reflection's decision task (tagged `decisions`, § 2
  Decisions waiting) is conversation-gated and never goes into a serial rollout: Lachy decides it
  at the top of a run. A task with an open fork (§ 2 Open forks: named by `fork for Lachy` in its
  latest orient end line, with no `orient ruling:` line for it timed after that end line) counts
  as conversation-gated at any age, and it stays out until Lachy rules on every open fork in a
  reshuffle grill (§ 5), which writes each ruling into the note; whatever route the task takes
  instead (Hands-on, a parallel rollout, a serial rollout, Not now), the ruling lines keep it
  decided. Also excluded: in-flight tasks (§ 2). A task whose playbook demands sign-off before
  external effects goes in with that gate declared (schedule § 3.5), so it is set aside, never run
  past (ADR 0008, ADR 0034).
- **Schedule stopped at § 0, or on its serial path's plan or surface check** (S2, S3) → handled as
  in § 6: report its line and remedy; nothing is stamped.
- **Surface overlap or session lane.** A chain refused at S3 overlaps a live chain or an unfinished
  parallel rollout: report the refusal lines and their remedy (a never-started chain's is `status:
  dropped`, which names whose note it is), and leave the members unstamped where the reshuffle put
  them; the next move is Hands-on or a later `/thread:orient <project> --steer`. Members schedule
  sends to ruling (c)'s session lane (`serial-chains.py`'s `sessionLane`) stay unstamped: name them.
- **Uncommitted grill docs.** § 6's hold applies to any repo a member writes.

### 8. Batches (retired)

ADR 0040 retired orient's child-agent batches (ADR 0023): orient spawns no child and writes no
prompt file, run journal, start claim, dispatch line or frontmatter stamp for one. `dispatched:`
stamps and orient run lines already in task notes are inert history: § 2 In flight no longer reads
them, though an end line with an open fork still counts (§ 2 Open forks). Old run directories under
`.scratch/orient/` are left alone.

### 9. The execute handoff

When § 6 or § 7 wrote a rollout note, end with the execute handoff, decided and never asked (Owner *gate*: the
reshuffle routed the work to run, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 1; ADR 0057). One handoff per
parallel note written; a serial note (`shape: serial`) gets no handoff: name it, its chain, each row's launch and Leg
1's start line, and never stamp `start: unattended` on it. For each parallel note, print
`Execute: a fresh session runs [[<slug>]] from <root> (decided: you scheduled it to run; say "not yet" to withdraw the handoff)`
(`<slug>` the note, `<root>` its Project root), then run **Fresh session** below, the decided move. Only his words
choose another of the moves: Here, Not yet or Start when ready. The one hold is a refused ladder file (schedule's
"Checklist — ladder refused" block: a settings file every call refuses, so no call could start; ADR 0048): then print
`Execute: held (the ladder file is refused, so every call would halt at its start); once it reads, say "hand it off"`
and hand nothing off. No other checklist holds it. With several notes, each gets its own handoff, and the last
handoff's closing line ends the turn.

- **Fresh session** (the decided move: a reshuffle has filled this context, and the lead runs best fresh) — run
  `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` with its usual home, never the Project root's
  default-branch checkout (handoff-home.sh reads a rollout clone as its in-place twin; a doc
  committed on the root would hold the lead's first § 2.7 entry until its landing merged), through
  handoff's **Rollout launch.**, and this continuation: start in the Project root, then
  `/thread:execute [[<rollout>]]`. The Project root is the rollout clone the note names (ADR 0042),
  and execute § 2.8 halts a lead launched anywhere else. Handoff creates the visible task where the
  harness can, and labels it a manual handoff elsewhere. Its doc carries `launches: <slug>`.
- **Here** — on his word only: run `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` on the rollout note
  in this session, when this session was launched in the Project root
  (`bash "${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh" --launch-check <Project root> <this session's launch directory>`),
  and only when that check exits 0; otherwise it stays Fresh session and says why.
- **Not yet** — on his word, or held: name the rollout note and the `/thread:execute [[<rollout>]]` line, and stop.
  Said after the handoff, it is the handoff's withdrawal (handoff § Lifecycle).
- **Start when ready** — on his word: stamp `start: unattended` as a top-level frontmatter line just below
  `status:` on the rollout note § 6 or § 7 wrote (`_shared/vault-grammar.md` § Rollout start stamp), then
  end: nothing runs here and no handoff is made. Said after the handoff, it first withdraws the launch, by
  handoff § Lifecycle's `dismiss_task` rules, so no stamp ever sits beside a live launch: `dismissed`,
  `already_dismissed` or `not_found` (or no card, off the Stage) → the launch doc is removed and its removal
  landed, then the stamp; `already_started_by_stage` or `already_started` → no stamp, and it says a lead is
  already running; `already_kept` → no stamp, and it says his Defer keeps the doc. With no stamp it ends
  there. Once stamped, print the note, the `/thread:execute [[<rollout>]]` line (still valid by hand) and one line: the Chorus Stage starts a lead in its Project root once
  the note is runnable, and that lead's first `next` clears the stamp. It suits a run nobody will be
  there to start (the evening, a landing PR still queued). Outside a Chorus Stage nothing acts on the
  stamp, so it waits like Not yet. When he names the PR the start waits on (a grill's gating PR, say),
  run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-queue --rollout <the note> --pr <owner/repo#N or its URL>`
  in place of the bare stamp, from the note's engine root (`engine-snapshot.py resolve`), and print its undo line:
  the note becomes an approved queue (`_shared/vault-grammar.md` § Approved queue), whose merge regenerates it and
  starts the new note with no confirm.

Execute's own runtime gate still applies wherever it runs. No rollout written → no handoff; § 6 or
§ 7 names why (a running or blocked rollout, uncommitted grill docs, a schedule blocker, or a surface
overlap with a live chain).

### 10. `--debrief` (retired)

`/thread:orient <target> --debrief` stops at the top of § 1, before the resolver runs or anything
is asked, and prints
`--debrief is retired (ADR 0040): orient dispatches no batches; run /thread:orient <target>`, with
`<target>` replaced by the arguments as given, less `--debrief` (nothing when no other argument was
given). It resolves, asks, reads and writes nothing.

## Don't

- **Don't turn a reported fork into a task.** A `fork for Lachy` end line is Lachy's decision
  (grill-me): § 3 surfaces it, § 5's grill puts it to him, and § 6 and § 7 hold the task back
  until he rules. Nothing spawns a task for it: his ruling, written into the note as an
  `orient ruling:` line, is what decides it.
- **Don't route in-flight work again** (§ 2). Don't stamp or write anything —
  the slot write included — in Look only or dry runs.
- **Don't reshuffle in-flight work.** Its scope, phase and body are frozen; only new members may
  join its phase (`reshuffle.md` R1).
- **Don't write before the reshuffle's gate**, drift fixes, the learned `repos:` entry (§ 4) and the
  Priorities card with the Notes that correct it (§ 3.5) aside.
- **Don't recommend more than one focus item**, and don't pad the audit —
  headline, balls in the air, drift, shape, one recommendation, then the reshuffle (§ 4).
- **Don't re-implement siblings or the engine.** Hands-on focus runs `open`'s
  logic; parallel- and serial-shaped work go to schedule (the execution-fit test
  decides, hard); execute runs only through the execute handoff.
- **Don't put parallel-shaped work in a serial rollout**, and don't schedule a bare project run (always `--tasks`).
- **Never a second unfinished parallel rollout per repo and project, never a serial chain over a live chain's
  surface, and never another rollout's lifecycle**: schedule
  § 0 supersedes only what its unfinished-rollout check allows (this project's, paused or never
  started); anything else waits (§ 6).
- **Don't use orient for a single live thread** — that's `next`.
