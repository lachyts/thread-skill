---
name: orient
description: 'Pick a project back up and reshuffle it: audit a project/area after time away, re-sort its open work (bugs, brain dumps, loose tasks, unstarted phases), grill what is unclear, write phases and tasks, schedule the rollout-shaped ones and offer to execute. One plan, design note or brain dump becomes phased tasks. Triggers on "orient me on <project>", "where is <project> at overall", "reshuffle <project>", "turn these tasks into a roadmap", "split/break this plan into numbered, phased tasks", "fan out background sessions on <project>", or /thread:orient [target]; --debrief sweeps batches. One thread: thread:next.'
---

# /thread:orient — pick a project up and reshuffle it

The project-altitude sibling of `next` (ADR 0003), and the one shaping verb (ADR 0027). `next`
answers "what's my move?" for the *current thread*; `orient` answers it for a *whole project or
area* returned to after time away. It audits the balls in the air, recommends ONE best use of
Lachy's time, then asks **Reshuffle, Steer only or Look only**. A reshuffle re-sorts all the open work, grills
what is unclear and writes the result at one gate (`reshuffle.md`). Orient then routes by lane:
it schedules rollout-shaped phases itself, steers the session-lane work (batches dispatched as
native child agents of this session, a focus item, or both) and ends with the **execute offer**.
Pointed at a single plan, design note or brain dump, it runs a **scoped reshuffle** of that note
alone.

**Contains no route logic of its own** beyond batching, emission and the reshuffle: hands-on focus
dispatches to `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` (or the task's own `## Launch` block);
rollout-shaped phases go to `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md`; the execute offer runs
`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` or `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md`.
None is re-implemented here. The execution-fit test
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md`) decides the lane, hard, not as a
preference.

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Runtime boundary

The project audit, reshuffle, steering and task-note debrief are shared. Autonomous batches use
the calling harness's native child tools and current account (ADR 0023: one launch model), never a
model CLI or a new cmux/Orca model session. The shared exchange at
`~/repos/workspaces/_shared/scripts/native_workflow.md` supplies journalled claims, native child
bindings and result validation. Its generic batch engine is `native_workflow_batch.workflow.js`;
it dispatches already prepared prompts and contains no project/domain workflow.

Native children inherit available tools; a target workspace path does not load another MCP
profile. Before dispatch, check every batch's required capability and account against the calling
session. If a required scoped capability is absent, retain the prompt and report that batch
blocked/undispatched. Do not silently switch harness, account or launch a broader profile. Other
independent batches may proceed. Hands-on pickup follows `open`'s contract.

Rollout-shaped work still goes through schedule and execute's runtime gate. The native exchange does
not supply execute's detached Stop-hook/heartbeat driver.

## Invocation forms

```
/thread:orient Chorus                     # audit, then Reshuffle / Steer only / Look only
/thread:orient [[Chorus]]                 # explicit wikilink form
/thread:orient                            # resolve the target from the session directory
/thread:orient [[<design, phase or brain-dump note>]]   # scoped reshuffle of that note
/thread:orient ~/.claude/plans/<plan>.md  # scoped reshuffle of an approved plan file
/thread:orient "<prose describing the work>"            # scoped reshuffle of inline prose
/thread:orient Chorus --debrief           # sweep previously dispatched batches (§ 10)
```

## Process

### 1. Resolve the target

The target is one project, one area or one note (CONTEXT.md **Target**, ADR 0036), and the resolver
runs before § 2 reads anything. Quoted prose is a scoped target, as below. Anything else, with
orient's own flags (`--debrief`) removed, goes once to
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-target.py "<argument>"`, run from the
session directory. The argument is quoted as one word, so a `[[link]]` never meets the shell's
globbing; a bare invocation passes none. It prints one JSON object: `outcome` (`resolved`,
`candidates` or `none`), the `target`, up to three `candidates` (best first; the pick first when
resolved), a `dir_anchor` (the area the directory sits in), a one-line `reason` and a `learn_dir`.

- **Resolver failure.** If the resolver exits non-zero (2: a refused `--cwd` or a usage error; 3:
  no vault or no PyYAML), report its one `resolve-target:` line and ask in plain text for the
  target, sweeping nothing before an answer. His answer goes to the resolver as an argument, and a
  second failure ends the orient with that line.
- **`resolved`** → name the pick in one line and carry on:
  `Target: <name> (<kind>; <reason>) — say stop to change it`.
- **`candidates` or `none`** → ask before any § 2 read: `AskUserQuestion` with the candidates, best
  first, then `dir_anchor` when it is not already listed, up to four options. With one option, add
  `Stop — orient nothing`, because the tool needs two. With none, ask in plain text for a project
  or area name, or stop, and end the turn. A typed answer (the plain-text one, or
  `AskUserQuestion`'s `Other`) is resolved again as an argument, and keeps the first answer's
  `learn_dir` (below).
- **A stop.** When he stops a pick, re-ask as above without the stopped pick. A stopped pick from
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
  audit; dispatch still runs, as native children with whatever the calling session carries, and
  the registry's launcher aliases are named only for a blocked batch (§ 7 Capability fit). For a
  project target both apply through its area and feed only §§ 7–8 dispatch.
- **The learned directory.** The `learn_dir` to hold always comes from the first answer, the
  directory's, and survives everything after it in § 1: the re-ask after he stops a `resolved`
  pick, a typed or `Other` answer, and that answer's re-resolution as an argument, whose own
  `learn_dir` is null. When he lands on a *project*, from the ask, the re-ask or a typed answer,
  hold that `learn_dir` with the project's `note` field: the picked option's, or the re-resolved
  target's `note` when a typed answer resolves to a project. The learn waits for § 4. Nothing is
  held for an area pick, a confirmed first pick, Look only, a scoped target, `--debrief` or a dry
  run, and a directory with no `learn_dir` is never written back.

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
  `priority`, `scheduled`, `due`, `dispatched`, `launch`, `phase`,
  `rollout`, `tags`, `projects`), plus one body read of those task notes for orient's run lines
  (`rg -n 'orient (start|dispatch|end): run'`: the start claims, dispatch lines and end lines § 8
  Double-dispatch guard writes); phase notes in `Work/Phases/` for the area's projects. The
  reshuffle classifies from this sweep; it does not walk the folders again.
- **Threads**: THREAD.md state lines across the area's project dirs
  (`~/Projects/<Area>/*/THREAD.md`) and `_shared/threads/`.
- **Drift** (ADR 0026): run the shared reconcile step as a dry run for every project in the target
  in one Bash call,
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/reconcile-project.py --project <slug> --json`,
  saving each project's output to its own file under one `mktemp -d` directory (`<dir>/<slug>.json`)
  and printing the path and the JSON. Keep its UNAMBIGUOUS and AMBIGUOUS lists and each saved path:
  § 4 binds the apply to that file. It writes nothing to the vault.
- **Related projects**: projects the target's notes link or name, and projects linking the
  target, especially ones `status: parked` or being absorbed by it. Read their unstarted phases
  and loose tasks for overlap with the target's open work (the reshuffle may pull them in).
- **Recency**: overdue `scheduled:`/`due:` dates; note staleness
  (last-modified); `git status`/`git log -3` in each project root — dirty
  trees also surface aborted-session partial edits worth flagging.
- **In flight** (the one definition; the reshuffle's reach tiers use it): a task stamped
  `rollout:` whose rollout note is still live (the link resolves to a note directly in
  `Work/Tasks/`), a `dispatched:` stamp or an orient start claim ≤7 days old unless an end line
  in the note names the same run and job, written before or after it (the Vault body read finds
  them; § 8 Double-dispatch guard, rule 1), or `status: in-progress` (TaskNotes' own spelling),
  `in_progress` or `review`; a phase with any such member. Report it as such; never re-batch it
  (§ 7) and never reshuffle it.

### 3. Present

A situational report written for Lachy catching up, not a log:

- **Headline** (1–2 sentences): the state of the project as a whole.
- **Balls in the air**: per-sub-project one-liners — the slot first
  (`next: <next_action> ([[<task>]])`, or `No next action`), then state,
  blocker, staleness. Group: active / in-flight (dispatched) / stalled /
  dormant.
- **Drift**: one line, the counts plus names, split into unambiguous (fixed on Reshuffle) and
  ambiguous (listed for Lachy, never applied). Omit the line when both lists are empty.
- **Shape**: how much a reshuffle has to work with: loose tasks, brain dumps, unstarted phases,
  overlaps found in related projects, and any live rollout.
- **ONE recommended best use of his time**, with a one-line reason — same
  single-recommendation discipline as `next`. Everything else is context, not
  competing recommendations. Frame it as a **proposal against the slot** of
  the project it belongs to, so the two never read as competing answers:
  the slot's own task → say they agree; a different item → name the slot and
  say why this beats it; a blank slot → say the recommendation would fill it.

### 4. Reshuffle, Steer only or Look only

`AskUserQuestion`, recommended option first:

- **Reshuffle** (the usual choice on pickup) — continue to § 5.
- **Steer only** — no reshaping: route the open work as it stands (§ 6), e.g. to dispatch
  batches as native child agents of this session.
- **Look only** — the audit was the deliverable; stop, no writes of any kind.

**Drift fixes.** Reshuffle and Steer only authorise them (as any steer did under ADR 0026): re-run
the reconcile step with `--apply --only <that project's saved dry-run file>` for each project whose
dry run listed unambiguous items, so the reshuffle never forms a roadmap on top of work Lachy saw
finished. `--only` writes just the items the § 2 dry run listed: a plain `--apply` recomputes and
can close work a live rollout landed between that dry run and the apply, which Lachy never saw.
Report any `New since review` items to Lachy as landed since the dry run and not applied (the next
orient lists them again), and any `Reviewed, not applied` items with their reasons:
`now ambiguous: …` needs his eye; `no longer drift (…)` is benign (closed or moved since, by the
rollout's ceremony or a mark-done). Neither is written, so both join the reshuffle's frozen
possibly-landed tier (reshuffle R1). If the saved file is gone (`--only` exits 2), re-run the dry
run and ask again. Ambiguous items are listed for Lachy and never applied. A scoped target skips
this question and applies no drift fixes: it reshapes one note, so the § 3 Drift line is
report-only for it.

**The learned directory.** Reshuffle and Steer only also run
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

### 6. Route

- **Run the execution-fit test** on each phase the reshuffle touched and on each other open
  cluster, and name its lane. Mixed sets split, as the fit-test doc says.
- **Rollout-shaped → the rollout lane, scheduled here.** Run
  `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--regenerate --tasks <members>`, naming
  exactly the members of the rollout-shaped phases (or clusters) on that repo: never a bare project
  run, which would also sweep up misfits, session-lane phases and whatever the grill left
  unresolved. A scoped target routes only the tasks its own reshuffle wrote. **At most one
  unfinished rollout per repo**, and schedule § 0's unfinished-rollout check enforces it.
  `--regenerate` is orient's supersede policy: the check allows a supersede only for a paused or
  never-started rollout of this project (its unlanded tasks carry into the new one), and schedule
  § 0 finishes an interrupted supersede on its own.
  - **Schedule stopped at § 0** (one of its checks refused; for this check, another project's
    rollout on the repo, one that has run and is not paused, or two at once) → schedule stamped
    no task and wrote no new rollout note, so orient must schedule nothing and touch nothing else.
    The one exception is schedule's own: a `file` move or an `interrupted` finish that § 0 made
    before the refusal stays, since it completes a supersede an earlier run confirmed (an
    `interrupted` finish stamps the incomplete note, re-points task notes to it and closes out the
    prior rollout). Orient reports any such finish from schedule's output, never as "nothing
    written". The phases are written and wait; orient reports schedule's remedy and names the next
    move: `/thread:status` (then `repair`) for a stuck rollout, or a later `/thread:orient <project>`
    (Steer only is enough) once the repo is free.
  - **Uncommitted grill docs.** If R3's grill left `CONTEXT.md` or `docs/adr/` changes
    uncommitted in the target repo, schedule nothing there either: every worktree branches from
    `origin`, which lacks them. Name them as the next move (land them through the repo's PR
    route), then Steer only schedules.

  Schedule's own § 0 checks can still stop it with a named remedy, which orient reports.
  Session-lane batches are never offered for rollout-shaped work; orient never re-implements the
  merge engine.
- **Everything else → the session lane.** If any session-lane work is left, steer it with
  `AskUserQuestion`, recommended option first (informed by the audit — e.g. if almost nothing is
  parallel-safe, recommend Hands-on):
  - **Autonomous** — cluster the parallelisable work into batches and dispatch them as native
    child agents of this session (§§ 7–8), which stays open as their lead until each returns;
    Lachy stays focused elsewhere. This answer IS the launch authorisation — no per-batch confirm
    follows (ADR 0023).
  - **Hands-on** — he has time for this project: if the best-focus item has a THREAD.md or capture
    task, run `open`'s pickup logic; else follow the task note's `## Launch` / `## Resume prompt`.
    No ceremony beyond that.
  - **Mixed** — dispatch the parallel-safe batches AND hand him the highest-leverage item.
  - **Not now** — leave the session-lane work where the reshuffle put it.
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

### 7. Batch (Autonomous / Mixed)

Batching is the session lane — only work that **fails** the execution-fit test
is batched here (rollout-shaped work already went to schedule in § 6). Cluster the
dispatchable open work into **parallel-safe batches**:

- **Disjoint surfaces**: no two batches may edit the same files, vault notes,
  or external surfaces (e.g. the same Webflow page/fields). A shared surface
  → same batch, or explicit ownership noted in both prompts.
- **Capability fit**: children inherit this session's tools and account, so
  match each batch's required MCP namespaces and accounts against the calling
  session. A batch missing one is **blocked**, never substituted: its prompt
  file is kept (§ 8 step 1), its tasks stay unstamped and it gets no job. The
  report names the covering alias from the workspace's
  `CLAUDE.md § Launch profiles` table or the registry (e.g. SEO work →
  `cc-animately-seo`) for a hand launch, which still runs the Twin check.
  Run orient from the narrowest covering profile, because kitchen-sink sets
  kill fan-out ("Prompt is too long"). That table + the registry are the
  only config — orient maintains no manifest of its own.
- **Exclusions**: conversation-gated tasks (need Lachy's input — say so, leave
  them for Hands-on or the next reshuffle's grill); in-flight tasks and tasks a live run covers
  (§ 8 Double-dispatch guard, rules 1 and 2), found before clustering; work
  whose playbook demands human sign-off before external effects.

### 8. Dispatch the batches

Each batch runs as a native child agent of this session (ADR 0023) through the shared exchange
(§ Runtime boundary). For each dispatch:

1. **Home, run dir and `issued:`.** Resolve the area's home, run the Double-dispatch guard's rule 2
   Ignored check from its anchor, then `mkdir -p <home>`. Pick a free run dir name (rule 2 Names);
   orient never creates the run dir. Take `issued:` once, at whole seconds:
   `date -u +%Y-%m-%dT%H:%M:%SZ` (UTC, no fraction, the form the Twin check's `touch -d` takes on
   BSD and GNU alike). Re-read every covered note against rule 1 and run rule 2's lookup, dropping
   what they catch, so nothing that landed since the audit slips in under the new `issued:`. Write
   each prompt, header first, to its unique `<home>/<YYYY-MM-DD>-<batch-slug>-prompt.txt`; a
   capability-blocked batch's prompt is kept the same way.
2. **Tier, capability and jobs.** Read the operator's ladder with
   `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py` (ADR 0029). Its last rung is
   the top, and every job names that rung's `model` and `effort`, so no child inherits a default
   silently. A refused ladder (non-zero exit) blocks every batch; report its stderr line. Run the
   capability and ownership check (§ 7 Capability fit). Assemble `args.jobs` for the supported
   batches as
   `{ key: <batch-slug>, prompt: <full prompt>, options: { model: <top model>, effort: <top effort> } }`
   and run `init` once, on the free run dir name, with `native_workflow_batch.workflow.js`, with
   `SKILL_CALLER_HARNESS`/`SKILL_CALLER_SESSION` set to this session (`$CLAUDE_CODE_SESSION_ID` on
   Claude) and config `{ "models": { "<top model>": { "model": "<native model>" } } }`.
3. **Claim, spawn, bind.** `advance`, then `claim` a pending request (the pre-spawn lock), then
   spawn a clean native child with the request's exact prompt, model and effort, then `bind` the
   returned child ID at once. The spawn must return the child's ID before the child works: on
   Claude, an Agent call with `run_in_background: true`, never a foreground call, whose ID comes
   back only after the child has run and written its end line. One spawn per message, since rule 3
   stamps before the next spawn. A harness with no such spawn cannot dispatch: every batch is
   blocked. Where the harness has no per-child effort control, the report says the effort was
   inherited. Children and all their nested agents and reviewers stay in this harness and account.
4. **Stamp after bind** (rule 3), before the next spawn. A claim without a bound child is never
   stamped. Respect available concurrency; queue excess batches without launching another model
   process.
5. **Collect and accept.** This session is the lead and stays open until every child returns:
   collect its output, `accept` its envelope, `advance`. Recover an interrupted child rather than
   clearing its claim. Report each batch as running, complete or blocked, with its native ID and
   run dir.

**Every batch prompt must carry** (the emission spec):

- **Header** — the prompt opens with one line each: `Dispatch:` (the lead's local date),
  `issued:` (step 1's UTC time, whole seconds), `Run:` (the run dir's absolute path), `Job:`
  (the batch slug), `Lead:` (`<harness> <config dir> <peer name> [<ref>]` from the lead's own
  peer-list header, or `<harness> <config dir> <session ID> (no peer ref)`; the config dir is
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` on Claude, the same expression `reconcile-rollout.py`
  uses, or `${CODEX_HOME:-$HOME/.codex}` on Codex), `Covers:` (task-note paths) and `Owns:` (repo
  paths and external surfaces, never a `Covers:` note). Times are UTC ISO with `Z` and compare as
  instants; `Dispatch:` and `dispatched:` are local dates and compare only with each other or a
  date-only progress line.
- **Execute-directly framing** — this is a worklist to run, not a plan to
  grill or re-scope. Name the concrete tasks and their notes.
- **Preflight** — verify the batch's required MCP namespaces and accounts are
  present among the tools inherited from the lead session, and make one cheap
  authenticated call each; missing/unauthenticated → STOP and report blocked
  (same guard as task-writer § 5).
- **Twin check, then reconcile — before the first edit.**
  1. Re-read every `Covers:` note.
  2. STOP and report, with no edits, on any live-twin signal in them: a start claim timed after
     `issued:`, whatever run it names; a dispatch line timed after `issued:` that names another run
     or job; a bare `dispatched:` (no dispatch line in the note) dated after `Dispatch:`; a progress
     line timed after `issued:`, or a date-only one dated after `Dispatch:`; or, where the harness
     offers a peer list (e.g. `ListAgents`), a live peer other than this child and its `Lead:` that
     names a covered task or this job. The lead's own stamp is never a signal: the dispatch line
     naming this prompt's own `Run:` and `Job:`, and the `dispatched:` written with it.
  3. Probe `Owns:` only, never a `Covers:` note (step 2 reads those, and the lead's stamp edits them
     after `issued:`). Stamp a reference file at `issued:` (`ref=$(mktemp)`, then
     `touch -d <issued:> "$ref"`) and, for each owned path that exists, run
     `find -H <path> -path '*/.git' -prune -o -newer "$ref" -print`: BSD and GNU `find` both take
     `-H` and `-newer`, where macOS `find` cannot parse `issued:` as a date. `-H` follows an owned
     path that is a symlink to a directory, which the default walk examines only as the link, and
     the prune skips `.git/`, whose index any `git status` rewrites. If that lists anything, or,
     inside a git work tree, `git status --porcelain -- <path>` shows the path deleted, or, in a
     code repository (never the Obsidian vault, whose backup sweep commits older edits late),
     `git log --all --since=<issued:> -- <path>` lists a commit, another session is live on it:
     STOP. A probe that errors (`touch`, `find` or a git probe exits non-zero) is a STOP too: a
     probe with no answer never reads as "nothing newer". Once the probes have run, STOP or not,
     `rm -f "$ref"`. A dirty owned path none of these flags was
     modified only before `issued:`: an aborted partial, which you reconcile by building on it or
     reporting it, never by `checkout`, `reset`, `clean` or `stash`.
  4. Write a one-line start claim into each `Covers:` note's `## Notes` before editing anything:
     `- <UTC ISO> orient start: run <Run:>, job <Job:>, child <your ID, or unknown>`.
- **Domain playbook gates** — staging-first, confirm-before-publish, and any
  domain-specific sign-off rules from the workspace's playbooks. No Linear
  filing unless the active profile carries a Linear server.
- **Cross-batch coordination** — name any shared surfaces and who owns them;
  check task-note progress stamps before editing anything another batch might
  own.
- **End-of-run updates** — update each covered task note per TaskNotes
  conventions (status/progress stamp, superseding `dispatched:`), so a later
  orient run or `--debrief` reads the truth from the notes, and add the
  mandatory end line
  `- <UTC ISO> orient end: run <Run:>, job <Job:>, <done | blocked: … | partial: …>` to its
  `## Notes`. It is the only record if the lead ends before collecting.
- **Execution context** — identify the canonical workspace, project and required
  authenticated tools. Native tools come from the parent session. Isolate code
  edits in worktrees where needed; do not expect a worktree to load MCP profiles.

Close the dispatch with one line per batch: native child ID, batch title, tasks
covered, the model and effort as spawned (or "effort inherited"), and
verified-running, completed or blocked.

#### Double-dispatch guard

One batch lands once (ADR 0023). Four rules hold it at both ends, orient's dispatch and each
child's preflight:

1. **In flight stays out.** A task with a `dispatched:` stamp or an orient start claim ≤7 days old
   is in flight (§ 2, whose Vault body read finds the claims) unless an end line in the note names
   the same run and job (a stamp's run and job are its dispatch line's), wherever that line sits:
   run dirs are unique and never reused, so the order the lines were written in never matters, and
   an end line written before a late stamp still settles the task. In flight, it is excluded and
   reported. It is re-dispatched only by the **override**, the one sequence used everywhere:
   1. Lachy names the task in the steering answer.
   2. Rule 2's lookup runs.
   3. If a run in flight elsewhere (b) covers the task, orient reports
      `in flight in <run dir>, lead <Lead:>, last activity <UTC>` and dispatches nothing for it.
   4. Lachy names it again.
   5. Orient dispatches it in a new run dir and writes `override of <prior run dir>` into its
      report and the dispatch line.

   With no run in flight elsewhere, naming the task once is enough. An own run (a) is recovered,
   never overridden.
2. **One unique run dir per dispatch, and a lookup before `init`.**
   - **Home.** `<workspace>/.scratch/orient/`, or
     `~/repos/workspaces/_shared/.scratch/orient/<area-slug>/` for an area with no workspace (the
     area name lowercased, other runs of characters as `-`). One home per area holds all its
     prompt files and run dirs.
   - **Ignored.** Check from the anchor, which always exists: the workspace root, or
     `~/repos/workspaces/_shared` for an area home. Never `git -C <home>`: it exits 128 while the
     home does not exist yet. If `git -C <anchor> rev-parse --is-inside-work-tree` prints `true`,
     `git -C <anchor> check-ignore -q <home below the anchor>/runs/x/run.json` must exit 0;
     otherwise every batch is blocked, the missing `.gitignore` line is named and nothing is
     written. An anchor outside a git work tree needs no check. Orient never edits `.gitignore`.
     Once the check passes, `mkdir -p <home>` for the prompt files.
   - **Names.** The run dir is `<home>/runs/<YYYY-MM-DD>-<dispatch-slug>/` and the prompt file
     `<home>/<YYYY-MM-DD>-<batch-slug>-prompt.txt`; when one already exists, append `-2`, `-3`, …
     until it does not. An existing run dir or prompt file is never reused or overwritten. Orient
     only checks that the run dir's name is free and never creates the run dir: `init` makes it
     private (mode 700) and refuses one that is not. Job keys are the batch slugs.
   - **Read.** Before `init`, read every `<home>/runs/*/run.json` as data (none while `runs/` is
     absent). A job's requests are those whose `options.label` equals its key; `requests[].key` is
     an engine path and is never matched.
   - **Request states.** A job with no request, or only `pending` ones, was never claimed;
     `claimed` or `dispatched` is live; `accepted`, `interrupted`, `blocked` or `denied` is
     settled, and a settled job never blocks.
   - **Overlap.** A run overlaps a new batch when its `status` is not `complete` and one of its
     unsettled jobs has the batch's key or a `Covers:` line (in its stored prompt) naming a task
     note the batch covers. Each overlapping run is one of three:
   - **(a) Own** (its `caller` is this harness and session): `status`, recover each ambiguous
     claim by inspecting this session's native children and binding the actual child, then
     `advance`. Never a second `init`, never a replacement spawn.
   - **(b) In flight elsewhere.** When this session has a peer list, runs under the config dir the
     run's `Lead:` line records, and that line carries a ref, the peer list decides: a listed ref
     is a live lead and the run is in flight; a missing one is gone. A peer list shows only its
     own config dir's sessions, so in every other case (no peer list, no ref, another config dir:
     a Codex lead, a pre-0023 run, another profile) the clock decides: an unsettled job is live
     and the run's newest activity (`events[].at`, plus the start claims, dispatch lines and
     progress lines in the covered notes) is ≤7 days old, or the run never claimed and its newest
     event is under an hour old. Its covered tasks are excluded and reported until rule 1's
     override.
   - **(c) Abandoned** (neither): reported, and it stops blocking. Its stamped or start-claimed
     tasks stay in flight under rule 1 for their 7 days: an abandoned verdict never frees work on
     its own before that window.

   Never call a helper on, edit, move or advance a foreign run: the exchange refuses another
   caller, and its own lead may still be collecting.
3. **Stamp right after bind.** Immediately after a batch's `bind`, before the next spawn, write in
   one edit of each covered note the frontmatter `dispatched: <YYYY-MM-DD>` (local date) and the
   `## Notes` line
   `- <UTC ISO> orient dispatch: run <Run:>, job <key>, child <ID>, lead <Lead:>, model <model>, effort <effort>`.
   A note that already holds this run and job's end line gets no stamp: its child finished first,
   and its end-of-run update stands. Stamping before the spawn would mark unlaunched work as in
   flight; the journal claim is the pre-spawn lock.
4. **Every prompt carries the Twin check** (the emission spec), so a second paste or a re-run of a
   prompt stops before its first edit.

### 9. The execute offer

When § 6 wrote a rollout note, end with `AskUserQuestion`, recommended option first:

- **Fresh session** (recommended after a reshuffle, which has filled this context) — run
  `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` with its usual home (never a commit on the
  target repo's default-branch checkout: that would diverge it from `origin` before the first
  merge) and this continuation: start in the target repo, then `/thread:execute [[<rollout>]]`.
  Handoff creates the visible task where the harness can, and labels it a manual handoff
  elsewhere.
- **Here** — run `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` on the rollout note in this
  session, when the reshuffle was small and this session was launched in the target repo.
- **Not yet** — name the rollout note and the `/thread:execute [[<rollout>]]` line, and stop.

Execute's own runtime gate still applies wherever it runs. No rollout written → no offer; § 6
names why (a running or blocked rollout, uncommitted grill docs, a schedule blocker).

### 10. `--debrief`

`/thread:orient <target> --debrief` skips the reshuffle and steering and runs the recovery sweep:

- **Runs.** Classify every run under the area's home as § 8 Double-dispatch guard rule 2 does. An
  own run (this session's ID: a lead resumed with `claude --resume <id>` keeps its ID, a
  `--fork-session` copy does not) is recovered here: `status`, recover ambiguous claims, collect
  and `accept`, `advance`. A foreign run is reported in flight or abandoned, read-only: only its
  own lead can accept its envelopes, so a dead lead's uncollected envelopes are lost and the
  children's end lines in the task notes are the record.
- **Notes.** Sweep the area's stamped and start-claimed task notes (§ 2's Vault sweep and its body
  read) and report per batch: completed, stalled or never launched. Clear a `dispatched:` stamp
  only when it is settled, meaning an end line names its dispatch line's run and job, in any order
  (rule 1), or stale: older than 7 days with no progress line, or, at any age, never launched,
  meaning its dispatch line names a run whose journal exists and records no bound child
  (`childId`) for its job. A stamp with no dispatch line, or whose named journal is missing (a hand
  launch, a pre-0023 stamp), is unknown, never "never launched", and keeps its 7 days. An
  unsettled stamp inside its 7 days stays, an abandoned run's included.

A fresh `/thread:orient` audit is the lightweight version of this.

## Don't

- **Do not pretend native children load a different profile.** Check required
  tools in the calling session; missing dependencies block that batch.
- **Don't ask a second launch confirmation.** The steering answer authorises
  the launch (ADR 0023); composing batches and firing them is mechanics.
- **Don't dispatch from a full-profile session.** The lead's profile is its
  children's profile, and kitchen-sink MCP sets kill sub-agent fan-out ("Prompt
  is too long"): run orient from the narrowest profile that covers the batches.
- **Do not substitute another harness or account.** Native child dispatch is the
  default; absent capabilities are reported instead of shelling out to a model.
- **Don't re-batch in-flight work** (§ 2, § 8 Double-dispatch guard): only the
  two-step naming override re-dispatches it. Don't stamp or write anything —
  the slot write included — in Look only or dry runs.
- **Don't adopt another session's run journal.** Read it as data; never
  `status`, `advance`, edit or move it. Don't create a run dir, or reuse or
  overwrite an existing run dir or prompt file.
- **Don't reshuffle in-flight work.** Its scope, phase and body are frozen; only new members may
  join its phase (`reshuffle.md` R1).
- **Don't write before the reshuffle's gate**, drift fixes and the learned `repos:` entry (§ 4) aside.
- **Don't recommend more than one focus item**, and don't pad the audit —
  headline, balls in the air, drift, shape, one recommendation, then the question.
- **Don't re-implement siblings or the engine.** Hands-on focus runs `open`'s
  logic; rollout-shaped work goes to schedule (the execution-fit test
  decides, hard); execute runs only through the execute offer; batch clusters never grow a merge
  engine here.
- **Don't batch a rollout-shaped cluster**, and don't schedule a bare project run (always `--tasks`).
- **Never a second unfinished rollout per repo, and never another rollout's lifecycle**: schedule
  § 0 supersedes only what its unfinished-rollout check allows (this project's, paused or never
  started); anything else waits (§ 6).
- **Don't use orient for a single live thread** — that's `next`.
