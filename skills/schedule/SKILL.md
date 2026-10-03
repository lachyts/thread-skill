---
name: schedule
description: 'Use when planning a parallel rollout of Obsidian tasks under a single project — produces a thin rollout note (data only) that `/thread:execute` runs as a queue on the Workflow engine. Reads tasks from ~/repos/obsidian/Work/Tasks/, orders the queue (dependencies recorded in frontmatter, Solo proposed for sweeping changes), auto-merges affine same-file task clusters (same change, artificially split) into one dispatch unit, refuses a second unfinished rollout on a repo (--regenerate supersedes this project''s paused or unstarted one, carrying its unlanded tasks), and writes an always-dated <project-slug>-rollout-<YYYY-MM-DD>.md with `protocol_version: 5` + config defaults. Scope: Obsidian only.'
---

# /thread:schedule — turn a backlog of Obsidian tasks into a rollout note

A **rollout** orders a backlog of related Obsidian tasks into a queue that one Claude Code session runs across worktree-isolated subagents.

This skill is the **planner**. The rollout note it produces is a data artefact — the dispatch + convergence contract lives in the sibling **`/thread:execute`** skill (`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`).

## Scope

**Obsidian only**, plus § 0's remote, landing-register and pushed-base probes of the target repo; the pushed-base probe runs `git fetch --prune` of `origin/<default>` and `origin/close/*` in the target repo and its known clones, moving or pruning only remote-tracking refs; § 0's unfinished-rollout check reads `git remote get-url` in each rollout note's Project root; a supersede's `reconcile-rollout.py resume` makes read-only `gh pr view`/`gh repo view` calls; a supersede's `git-env-canary.py check-all` and `retire` (steps 1 and 6) read the prior's Project root with read-only git calls and write only the prior note's `## Git-env log` and the canary's own records, kept outside the repo; § 4.7 reads the operator's ladder file through `ladder.py` (a local file, no network); and step 7.5 moves a superseded rollout note with a plain `mv`. Reads from and writes to `~/repos/obsidian/Work/Tasks/`. Not for Linear, GitHub issues, or any other backlog source.

## Invocation forms

```
/thread:schedule GifLab                       # default: all open tasks linked to [[GifLab]]
/thread:schedule [[GifLab]]                   # explicit wikilink form
/thread:schedule GifLab --regenerate          # supersede this project's unfinished rollout on the repo (paused or never started), carrying its unlanded tasks
/thread:schedule --tasks task-a,task-b,task-c # explicit set instead of project filter
```

The argument resolves to a project-note slug (the thing the task's `projects:` frontmatter list contains). Strip `[[...]]` wrappers and case-fold for comparison.

## Skill flow

### 0. Execution-fit gate

Run the execution-fit test (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` — the
canonical definition). Rollouts are for **rollout-shaped** work: tasks that converge on ONE
code repo, land as a PR each, and verify machine-checkably inside the run (tests / build /
greps). Before computing anything, scan the candidate set for misfits — tasks whose core action
is an external publish (CMS / live site / DNS / config console), whose ordering constraint is a
measurement window or calendar date rather than file overlap, or whose verification only
arrives days later (impact measures). If misfits dominate, **stop and route the set to the
session lane** (`defer` for `scheduled:`-date dispatch, `open` via the task's `## Launch`
block) instead of forcing a rollout: the engine's parallelism is forbidden by isolation
windows, every externally-publishing task pauses at the human gate (ADR 0008; execute § 3.7), and
the queue cannot see a window or calendar constraint. A mixed set is fine if
the rollout-shaped subset can roll out while the misfits stay unstamped — name them in the gate.

After the misfit scan, check the dispatch blockers for the target repo, i.e. the project root the
rollout note will carry. Resolve it from the project note's `Local:` line; if there is none, ask
the user for the path (step 6 writes this resolved path as `{{REPO_PATH}}`). Then run the remote
check in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` § Dispatch blockers against it (point at
it; never copy the snippet here), followed by its `gh repo view` confirmation. Then run the
landing register check from the same § Dispatch blockers against the same resolved path (again a
pointer, never a copy): a rollout never pushes to or merges into a repo on the landing register
(ADR 0028 § Decision). Then run the pushed-base check from the same § Dispatch blockers (a pointer,
never a copy) with the resolved path, `<localPath>` set to the project note's `Local:` path (empty if
the user gave the path), and no cited paths: rollout worktrees branch from `origin/<default>`, so a
local default branch ahead of it (in this clone or a known sibling clone) hides those commits from
the agents. Last, run the unfinished-rollout check against the same resolved path, passing
`--regenerate` exactly when this run has it:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --repo <resolved path> (--project <target> | --tasks <this run's --tasks list>) [--regenerate]`.
A repo holds at most one unfinished rollout (one directly in `Work/Tasks/`, neither `done` nor
`dropped`, with a task not yet merged). The check prints exactly one stdout line:

- `none` → go on.
- `supersede <prior>` → this run supersedes `<prior>`: run the **Supersede prep** below.
- `file <slug> <path>` → an earlier supersede stamped `<slug>` but died before its move. Run step
  7.5's move for it now: `mkdir -p` `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`, then a plain
  `mv` of `~/repos/obsidian/Work/Tasks/<path>` into it. Report it, then re-run only the check. A
  failed `mv` stops the run with its error.
- `interrupted <prior> <new>` (printed only with `--regenerate`, and only when those two notes are
  the repo's whole unfinished set) → an earlier supersede wrote `<new>` and died before step 7.5
  closed out `<prior>`, so `<new>`'s tasks may be unstamped. Finish that supersede:
  1. Stamp `incomplete: true` in `<new>`'s frontmatter, just below its `status:` line. It is usually
     still there: `<new>` was born with it (step 6), and only the end of its own run's step 7 removes
     it. This run never removes it (step 7 clears only the note this run writes), so only a later
     supersede of `<new>` ends it, by closing the note out (step 7.5). Until then
     `reconcile-rollout.py next` refuses `<new>`, so a cancelled run never leaves it runnable once
     `<prior>` is closed.
  2. Step 6's carry: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py carry --from ~/repos/obsidian/Work/Tasks/<prior>.md --to ~/repos/obsidian/Work/Tasks/<new>.md`.
     It also maps each carried task's legacy stamps to a rung (step 1's `restamp` lines; a re-run maps
     nothing twice). A non-zero exit stops the run with its stderr.
  3. Step 7.5's close-out of `<prior>`: the stamps, then the move.
  4. Print the pinned report: "**[[<new>]] is incomplete**: the run that wrote it died before closing out [[<prior>]], so its tasks may be unstamped and its queue can name tasks `next` and `status` never see; it must be superseded with `--regenerate` (this run goes on to do that; a cancelled run leaves it stamped `incomplete: true`, which `next` refuses, for the next `--regenerate`), never `/thread:execute`d as written."
  5. Re-run only the check. It prints `supersede <new>`.
- **Loop guard.** Each finish removes the note it names from the next check, so a second `file`
  or `interrupted` line naming the same note stops the run with that line.
- `refuse …` (exit 3) or exit 2 → a failure, below.
- `WARN:` lines (stderr, on any exit) → carry them to step 8's pre-flight.

On any failure **stop before step 1**: no task stamped, no rollout note, no heartbeat, with one
exception: a `file` move or an `interrupted` finish that § 0 made before a later refusal stays,
since it completes a supersede an earlier run confirmed. Print the snippet's remedy line verbatim
(or gh's error); for a listed repo that is the `listed <owner/name>: <reason>` line with its remedy,
since unlisting is Lachy's call, for the pushed-base check's exit 3 it is the whole stderr (the
ahead commits and the land-by-PR or wait-for-the-landing-PR remedy), and for the unfinished-rollout
check's refusal or exit 2 it is the whole stderr (each unfinished rollout with its remedy). The
cluster is still rollout-shaped; don't re-route it to the session lane.

**Supersede prep.** Only once every § 0 check has passed and the unfinished-rollout check printed
`supersede <prior>` (directly, or on the re-run after an `interrupted` finish), run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout ~/repos/obsidian/Work/Tasks/<prior>.md`
before step 1 (an unfinished note always sits directly in `Work/Tasks/`, so the path is exact). It
flips done any prior task whose PR already merged, so step 1's preview and step 6's carry never take
a landed task. Exit 3 (an undecided RACE or UNVERIFIED on the prior) is a stop: before step 1 and
before this run writes anything, print its `HOLD:` lines and point at `/thread:repair [[<prior>]]`,
which records Lachy's decision (step 6's carry would refuse the prior anyway). Any other non-zero exit
(a gh failure) is no stop: carry its `ERROR:` lines into step 1's confirm and go on. A task it could
not resolve carries at its recorded status, and execute's resume asks GitHub again.

There is no minimum size: shape decides, not count. A rollout-shaped cluster of one still rolls
out — the plan gate, verifier retry, master review, and auto-merge are the point. For N ≤ 2,
note that the ceremony is thin and proceed.

### 1. Discover tasks

Walk `~/repos/obsidian/Work/Tasks/*.md`. Filter:

- `status: open` (default — `--include-done` to override)
- `projects:` contains the target wikilink
- `tags:` **contains** `task` — phase notes (`tags: [phase]`, see ADR 0005) and any other non-task
  note linked to the project are never dispatched
- `tags:` does **not** contain `rollout` (rollouts aren't tasks)
- Skip a task whose `rollout:` links a rollout note directly in `Work/Tasks/` that is neither `done` nor `dropped`: it belongs to that rollout, and only a supersede may take it. Name each skipped task and its rollout in the count report.
- Skip tasks with `status: merged` — step 4.5 folded these into a combined note; their `merged_into:` target carries the work and gets dispatched in their place

On `supersede <prior>` (§ 0), first run the git-env canary's `check-all` on the prior (execute § 4.5 *Git-env canary*): `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout ~/repos/obsidian/Work/Tasks/<prior>.md`. It compares the prior's windows left open (a hard pause's TaskStop'd calls) before its tasks move. A non-zero exit stops the run before this run writes a rollout note or a task stamp: print its stderr verbatim (exit 3 → `/thread:repair [[<prior>]]`, which shows the evidence and records Lachy's ack). This preview may append a trip line to the prior rollout note's `## Git-env log` before you confirm anything. That write is intended: it records evidence that a window changed. The decision to accept it stays with `/thread:repair`. Then preview the carry: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py carry --from ~/repos/obsidian/Work/Tasks/<prior>.md --dry-run`. It writes nothing and prints one line per task linked to the prior rollout. Its `carry <slug> <state>` lines join the candidate set (deduplicated, whatever their status: a carried `review`, `in_progress` or set-aside task keeps its place in the queue). Its `keep <slug> <state>` lines (merged, folded, or another status such as `dropped` or `parked`) stay with the prior rollout. After a carried task's line it prints `restamp <slug> rung=<name|kept|-> drop=<keys|->` when carry will map that task's legacy stamps (ADR 0029): `rung=<name>` is the ladder's top rung it writes (a `model: fable`, or an `effort: xhigh` or `max`), `kept` its own `rung:` staying, `-` none; `drop=` the legacy keys it removes. § 4.7 reads these lines and never lowers the rung they name.

A non-zero preview exit stops the run before this run writes a rollout note or a task stamp: print its stderr verbatim. Exit 2 is a refusal, for one of two causes: an undecided RACE or UNVERIFIED on the prior (`/thread:repair [[<prior>]]` records Lachy's decision), or a refused ladder file when a carried task needs the top rung (`ERROR: carry: ladder file refused: <path>:<line>: <reason>`). The refused ladder's remedy is Lachy's edit to `~/.config/thread/ladder.toml` at the line named, then `--regenerate` again.

Report the count and let the user confirm before proceeding. The confirm lists the candidates, each skipped task with its rollout and, on a supersede, both the carried and the kept lists (the carried list with its `restamp` lines and any `WARN: carry:` line for a value carry left in place), any `ERROR:` lines from § 0's `resume`, the check's `WARN: <prior> is incomplete` line when it printed one, and, after an `interrupted` finish, § 0's pinned report.

### 2. Extract file scope per task — best effort

File-sets are best-effort. For each task:

1. **If the task's frontmatter has `touches: [...]`** — use that as authoritative. No further detection needed.
2. **Otherwise — read the paths the body names**:
   - Inline code: `` `src/foo/bar.py` ``
   - Fenced code blocks: paths inside ```python … ``` blocks
   - Bare paths in prose: `src/...`, repo-root-relative paths
   - Common patterns: `src/giflab/<module>.py`, `tests/<layer>/<name>.py`

There is no confirmation turn and no agent sweep. A file-set only breaks queue-order ties (`reconcile-rollout.py next` prefers the task with the least overlap with what is running) and feeds step 4.5's affine merge. It never keeps two tasks apart: Integration (ADR 0030 decision 3) merges the latest `main` into each approved task and re-runs the verifier before its merge, which is what makes two tasks on one file safe. So a missed file costs a little ordering, never a dropped change.

If a task touches zero files after both passes, classify it as `scope: read-only` (see step 4).

After detection, re-run the pushed-base check (§ 0's pointer, same path and `<localPath>`) with
cited paths: the detected file-sets plus every repo path the task bodies name (`docs/adr/NNNN-*.md`
as a git glob, `CONTEXT.md`, any `~/…` path as written; do not pre-filter them), never THREAD.md.
Its `pushed-base: WARN:` lines name local copies the agents won't see (an uncommitted change, a
commit only on the checked-out branch, an untracked file); carry them to step 8's pre-flight. Show
its notes here. An exit 3 or 2 stops exactly as in § 0; nothing has been written yet, except
`resume`'s done flips (§ 0's Supersede prep) and a § 0 `file` or `interrupted` finish.

### 2.5. Detect the project's verifier

Resolve the rollout-level default verifier — the shell command(s) `/thread:execute` will run inside each subagent's worktree to decide pass/fail. Detection order:

1. Project's `CLAUDE.md` — look for a line like `Verifier: \`<cmd>\`` or a "Verification" / "Testing" section that names a single canonical command
2. Project's `Makefile` at repo root — presence of a `test` target → `make test`
3. `pyproject.toml` with `[tool.poetry]` → `poetry run pytest`
4. `package.json` with a `test` script → `npm test`
5. Fall back to no detection → surface to user, ask them to provide one (or proceed without; `/thread:execute` will refuse to dispatch without a verifier)

Print the detected command and ask the user to confirm or override before continuing. Store it for step 6.

### 2.6. Capture known baseline failures

Some repos carry tests that already fail on a clean `main` for environmental / pre-existing reasons (an ImageMagick 0-byte quirk, a perf ratio over a hardcoded ceiling, a Windows-only tool gap). Without a manifest, **every** dispatched agent independently re-diagnoses the same reds and burns tool-calls proving they're out of scope (14× in the first giflab run). Capture them once here so `/thread:execute` can thread them into every agent and treat "only these fail" as green.

- **Declare by default** — ask the user for the known baseline failures as `<test_id> — <one-line reason>` lines.
- **Opt-in detection** — offer to run the verifier once on a clean `main` (clean checkout, run `{{VERIFIER}}`, collect the failing test ids) and present the set for the user to confirm + annotate with reasons.
- If clean `main` is fully green, record `none`.

**Honesty constraint** (per the project's `CLAUDE.md`): the manifest is a **comparison reference, not a mute button** — `/thread:execute` keeps running the full verifier and only ignores these exact reds; it never `--deselect`s them (that would hide a real regression in them). The manifest is a point-in-time snapshot with no liveness guarantee — re-capture on `--regenerate`.

Store the confirmed lines for step 6's `{{KNOWN_BASELINE_FAILURES}}` block.

### 2.7. Detect the env-bootstrap command (optional)

If the verifier needs a one-time environment setup before it runs in a **fresh** worktree — the recurring "wrong Python / no editable install" friction where each agent independently rediscovers `poetry env use 3.11 && poetry install` — capture it once as the rollout's `env_bootstrap`. `/thread:execute` then runs it once per worktree right after the agent enters it, so no agent has to rediscover it. Detection:

1. Project's `CLAUDE.md` — a line like `Env bootstrap: \`<cmd>\`` or a documented "set up the worktree env" command.
2. Otherwise ask the user (the common shapes are `poetry env use <ver> && poetry install`, `npm ci`, `uv sync`), or leave it unset.

Leave it unset when the verifier works in a bare checkout — the worktree setup then renders byte-identically to before. Store the command for step 6 (it becomes the rollout frontmatter's `env_bootstrap:` line).

### 3. Extract dependencies

Look for:

- `blocked-by:` or `depends-on:` in frontmatter (list of task slugs or wikilinks) — the only thing that holds a task back in the queue
- `[[other-task]]` wikilinks in the body that match tasks in the discovered set — soft order hints for step 5's tiebreak, never recorded
- Body phrases like "gated on", "after X lands", "depends on" — surface them in the confirm batch (step 5) when the dependant is in the `queued` state (step 5 says why); a confirmed one is written into the dependant's frontmatter `depends-on:` at step 7, so the queue holds it back

### 3.5. Detect human/release gates

Some task notes carry a **human/release gate** in prose — "don't action until a release ships", "hold for sign-off", "gated on the next deploy". A `/thread:execute` agent reads the note and may refuse mid-dispatch when it hits one, so a buried gate is unreliable either way. Scan each task body for gate language (`don't action until`, `do not action until`, `hold for`, `until a release`, `until the next release`, `gated on a release`, `human sign-off`, `wait for sign-off`). Collect any matches and put each to the user in the confirm batch: keep the task (and clear the gate before executing: `ignore_gate: true` on the task overrides it for the run, or remove the gate text) or drop it from this rollout. A task dropped here leaves the candidate set before step 6, so it gets no `## Queue` row, no `## File-sets` line and no `rollout:` stamp. A carried task (step 1) is the exception: step 6's carry takes every unlanded task of the prior rollout, so its drop waits for step 8's pre-flight, which takes it out whole. Each kept gate becomes step 8's pre-flight. Don't bury the gate in the body and hope the agent honours it.

### 3.6. Sweep for gated-input smell (advisory — ADR 0008)

Distinct from 3.5's release/hold gates: **gated inputs** are human *authorisations* — API spend, credentials, irreversible actions. Scan each task body for spend smell (`credits`, `paid API`, `$`, `budget`, `billable`, `API cost`), credential smell (`API key`, `token`, `secret`, `credential`, `prod access`), and irreversibility smell (`irreversible`, `cannot be undone`, `delete production`, `wipe`). Tasks that match get **`plan_approval: required`** stamped in step 7 (user-confirmed in the confirm batch), so they always produce a plan whose required `### Gated inputs` declaration the engine can pause on. Like every step-7 stamp, it is proposed only for a task in the `queued` state: step 7 writes nothing to a carried task that has started.

**Advisory only — the plan's declaration is authoritative** (ADR 0008): only the implementer's plan reliably knows the task needs 30 USD of Replicate credits, so the engine pauses on the *declaration*, never on this sweep. The stamp merely guarantees the gate surfaces predictively at the plan-gate rather than reactively mid-implementation (a missed smell still stops — every code-writing agent carries the same stop rule). List the stamped tasks in step 8's summary as **expected to gate**, so the pause reads as designed when it happens.

### 4. Classify scope per task

Look for a `scope:` frontmatter field. Valid values:

- `single-file` — touches 1 file, no cross-cutting effects
- `cross-cutting` — touches >1 file OR modifies aggregation/composite logic that other tasks may have changed
- `read-only` — investigation / audit / no source edits

If `scope:` is absent, infer:

- 1 file detected → `single-file`
- >5 files detected → `cross-cutting`
- 0 files detected + the body mentions "investigate" / "characterise" / "audit" → `read-only`
- Otherwise leave it `single-file` but flag for user review

### 4.5. Detect and merge affine same-file clusters

Same-file tasks run side by side in the queue, and each pays for it at merge: its Integration merges the latest `main` in, re-runs the verifier, and re-reviews when a landed PR shares a file with it. When several small tasks all edit one hot file and are really **the same change, artificially split** (the recurring shape of audit-fix backlogs), every split piece pays its own plan-gate, review and Integration for what is one change, and each later piece integrates against the earlier ones. Consolidating them saves those Integrations. This step finds those clusters and folds each into **one task** before the queue is ordered.

Do this **automatically** — don't ask the user which clusters to merge. The judgement lives in the task bodies; your job is to read them carefully and apply the heuristic + guards below the same way every run. (You still confirm the *result* before authoring — see the end of this step.)

**A cluster qualifies only if BOTH hold:**

1. **Shared file** — the members' resolved file-sets (from step 2) overlap on ≥1 file.
2. **Affinity** — they are the *same kind of change*, not merely the same file. Require **≥1 strong** signal, or **≥2 weak**:
   - *Strong* — a body literally invites the fold: "consider folding X into the same Y", "same DRY-up", "shared `_helper()`", "treat as in-scope for the same PR". (Conditional phrasing — "if X is still in flight, fold it in" — still counts: once both are in one unit, the condition is moot.)
   - *Strong* — same source audit doc **and** same fix-shape verb (all "replace sentinel → NaN + NaN-aware aggregation"; all "add classifier + lossy ceiling").
   - *Weak* — mutual `[[cross-reference]]` wikilinks between the members.
   - *Weak* — shared `parent:` frontmatter, or near-identical acceptance-criteria structure.

**Never merge — even when same-file — if any of these fire (hard blocks):**

These are the guardrails on "trust Claude's read." A human who split tasks deliberately is handing you information — don't overrule it.

- **Explicit independence** — a body calls another member "independent changes to different callsites", lists it under "Out of scope", or otherwise scopes it out. The split was on purpose.
- **Dependency** — one blocks or gates the other → keep them ordered in the queue, don't fuse.
- **Mismatched review depth** — don't fold a `read-only` audit into a `cross-cutting` fix; they want different scrutiny.
- **Too big to review well** — if the merged file-set exceeds ~6 files, or you'd be fusing two `deep` (`work_depth`) tasks, the cost of reviewing one giant PR defeats the time saved. Keep them separate.
- **A carried task that has started** — never fold a task carried from a superseded rollout (step 1) whose queue state is anything but `queued`: it already has a branch, a PR or an Integration of its own.

Same-file tasks that share a file but *fail* the affinity test — three *different* fixes to one module — are the normal case. Leave them as separate queue entries; Integration serialises their merges. **Merging is the exception, not the default.**

**A merged cluster is ONE dispatch unit.** One agent, one branch, one PR, sub-tasks done *in sequence* in a single worktree. "Merge" must never mean "two same-file agents in parallel": a merged unit is still one agent, one branch, one PR. Representing the cluster as a single task (below) keeps the executor ignorant of clusters, which is why we consolidate at plan time instead of teaching the executor about them.

**How to represent it — author one combined note, tombstone the members.**

For each confirmed cluster, author a new task note at `~/repos/obsidian/Work/Tasks/<descriptive-cluster-slug>.md`, named after the *change* (e.g. `giflab-metrics-nan-sentinel-hardening.md` — pick a basename nothing else uses). Give it normal Task frontmatter:

- `tags: [task, <area>]`, `status: open`, `priority`, `projects:` (copied from the members)
- `scope: cross-cutting` — a merge always crosses the members' concerns, so the plan-gate + rigorous review apply
- `touches:` = the **union** of the members' own `touches:`, only when every member has one — the one sanctioned place the planner writes `touches:` (see Don'ts): a union of authoritative sets, not a fresh guess. Otherwise leave it unset: the union of the members' detected file-sets lives only in the rollout's `## File-sets` (step 6).

In the body, aggregate every member's acceptance criteria under one `## Acceptance criteria` (the implementer must satisfy all of them, in sequence), and link each original with an unpathed `[[wikilink]]` under a `## Folded-in tasks` heading so the per-task detail stays discoverable.

Then turn each member into a **tombstone** — don't delete it (backlinks to it must keep resolving, and a wrong merge has to stay trivially reversible):

- set `status: merged`
- add `merged_into: "[[<combined-note-slug>]]"`
- clear any legacy `wave:` — tombstones are never dispatched, and step 1 skips them on re-plans

`merged` is a configured TaskNotes status (`isCompleted: true`, `autoArchive: true`), so tombstones auto-archive into `Work/Tasks/Archive/` and leave the active list — their backlinks (and the combined note's `## Folded-in tasks` links) still resolve, since wikilinks are unpathed. See `obsidian-schema.md` § Task.

The rollout then references only the combined note, as an ordinary `cross-cutting` task — so `/thread:execute` and its engine need to know nothing about merging.

**Confirm the result before writing.** Show the user each proposed merge (members → combined note, plus the affinity signal that fired) and — just as important — the same-file pairs you deliberately *kept apart* and the guard that fired for each. This is where a misread gets caught. Get a y/n before authoring anything.

### 4.7. Offer a starting rung per task

Every task starts on the **bottom rung** of the operator's ladder (ADR 0029), and the engine climbs one rung at a stage's first evidence of hardness (see `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` § Climbing the ladder). No task needs a stamp to reach the top rung: a starting rung only saves a task judged hard the cheap first pass below it. Read the rung names, bottom first, from `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py` (one JSON line; a local file, no network).

Offer `rung: <name>` only for a task in the `queued` state that is hard:

- **`work_depth: deep`** — flagged deep/design-heavy (algorithm choice, subtle interactions, long-horizon investigation), **or**
- **`scope: cross-cutting`** that needs real design judgement, merged units from step 4.5 included.

The default offer is the rung just above the bottom (the top rung on the built-in ladder). Lachy may name any listed rung instead; refuse an unlisted name at offer time. A one-rung ladder gets no offers. Veto a rote cross-cutting task (e.g. a mechanical rename across files) back to the bottom rung: it gets no stamp. A borderline task stays on the bottom rung, unstamped: the engine climbs on evidence, so a wrong call costs one cheap first pass, not a blocked rollout.

**§ 4.7 never lowers a rung.** It makes no offer for a task that already has a non-empty `rung:`, for one step 1's preview lists as `restamp <slug> rung=<name>` (a name, not `-` or `kept`: carry writes that rung), or for a non-carried candidate whose legacy stamps map to the top rung (step 7). Show each such task in the confirm batch as `<slug>: rung <name> (kept)`. Only Lachy explicitly naming a different listed rung changes it: no default and no batch "y" ever writes a lower rung over it.

Present the offers in the confirm batch, beside step 5's Solo and dependency proposals and the gates of § 3.5 and § 3.6: "these N are hard → rung <name>: …", one line of justification each, and get a y/n (or per-task veto) before step 7 stamps them. Never stamp a rung by default, and never add `rung:` to the rollout note: it is per-task only. When `ladder.py` exits non-zero (the file is refused), make no offers: step 7's fallback leaves a top-mapping legacy stamp for execute, and step 8's "Pre-flight — ladder refused" block shows the file's error.

### 5. Order the queue

The rollout is a queue (ADR 0030 decision 1): tasks run in parallel up to `parallel_ceiling`, each from the `main` of its start, and only a dependency or a Solo task holds one back. Schedule decides the order, written as the `## Queue` table's rows (step 6): a task's row is its schedule rank.

Solo and dependency proposals apply only to tasks in the `queued` state, and the confirm batch offers them for no other task. Step 7 writes nothing to a carried task that has started (running, awaiting or in Integration, or set aside), so a confirmed `solo: true` or `depends-on:` on one would be silently dropped, and a started task can't be held back anyway. Such a task keeps its place in the order (1. below) all the same.

1. **Order.** Topological by `depends-on:` / `blocked-by:` (step 3), so a task never ranks above one it depends on. A dependency cycle stays a Don't: surface it and ask. Ties are broken by step 3's soft hints (a task another body links ranks before the task linking it), then by `-p<N>-<M>-` numbering, then by slug. `priority:` is ignored here: the lead applies it at every start, then least file overlap with what is running, then this order (`reconcile-rollout.py next`), so a `priority:` edit in the vault reorders a live queue.
2. **Solo.** Propose `solo: true` for a `queued` task whose sweeping change every concurrent task would otherwise redo its work around (a rename across the tree, a hub-file restructure, a shared-module move). When a Solo task is next to start, nothing new starts until every started task has merged or been set aside, and the queue resumes once it merges or is set aside. Give each proposal one line of justification, in the confirm batch, beside § 4.7's rung offers, and place a Solo task where the sweep should land, usually ahead of the work it reshapes.
3. **Dependencies.** The body dependencies the user confirmed (step 3), each on a `queued` dependant, are recorded in the dependant's frontmatter at step 7, so the queue holds it back.

No step here keeps same-file tasks apart or places them by file overlap: Integration keeps two tasks on one file intact.

### 6. Write the rollout note

Location: `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` — **always dated** (slug = the lowercase kebab form of the project wikilink, or a natural scope slug when the batch has one; date = today, the day you write the note — e.g. `[[GifLab]]` on 2026-07-18 → `giflab-rollout-2026-07-18.md`). The date is mandatory: an undated `<slug>-rollout` name collides with the project's next rollout, so it is **never emitted**. Legacy undated notes keep their names — no migration; the readers (`/thread:execute`, `/thread:status`, `/thread:repair`) still resolve both forms. This is the canonical rule in CONTEXT.md § Rollout.

**Dated-note naming — handles more than one rollout per day.** The filename is `<slug>-rollout-<YYYY-MM-DD>.md` for the **first** rollout of a given day, and `<slug>-rollout-<YYYY-MM-DD>-<N>.md` (N≥2) for each **subsequent** rollout that same day. Resolve N deterministically: glob `<slug>-rollout-<YYYY-MM-DD>*.md` — nothing matches → bare date (no `-N`); only the bare-date note exists → `-2`; otherwise → one past the highest existing ordinal. The first-of-day note never carries `-1` (kept bare, backward-compatible with every existing dated rollout). So a day's sequence reads `…-2026-06-09.md`, `…-2026-06-09-2.md`, `…-2026-06-09-3.md`. **Never overwrite or reuse an existing dated note** — always advance to the next free ordinal. When today's name is taken, offer only **Advance** or **Cancel**, never **Overwrite**: Advance writes the next free ordinal. A note you just wrote in error is unfinished, so § 0 already supersedes it (`--regenerate`, which writes a new note: `carry` refuses to run from a note into itself) or refuses. Any other same-day note is finished, and reusing its slug would attach its tasks' `rollout:` backlinks to the new note and lose its record, `## Completion log` included. Substitute the resolved slug into `{{ROLLOUT_SLUG}}` everywhere downstream — the note's own filename, the per-task `rollout:` stamps (step 7), the summary (step 8), and any `supersedes:` / `superseded_by:` links.

**Supersede: write, then carry.** When § 0 printed `supersede <prior-slug>`, stamp `supersedes: "[[<prior-slug>]]"` in this note's frontmatter (the template's commented line, uncommented). Once this note is written, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py carry --from ~/repos/obsidian/Work/Tasks/<prior-slug>.md --to ~/repos/obsidian/Work/Tasks/<this-slug>.md`. Right before it, run step 1's canary `check-all` on the prior again (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md`; a non-zero exit stops the run with its stderr, exit 3 → `/thread:repair [[<prior-slug>]]`), and once carry exits 0 run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py retire --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md`, which removes the prior's canary records (a retire failure is a `WARN:` carried to step 8's pre-flight, never a stop). It re-points every unlanded task of the prior rollout to this note, clears its `owner:`, `integrating:` and legacy `wave:`, and maps its legacy stamps to a rung (step 1's `restamp` lines); it never writes the prior note. A non-zero exit stops the run with its stderr: the prior note is still open, so the next run's § 0 pairs the two notes as `interrupted` and finishes the supersede. Step 7 then stamps every task, and step 7.5 closes out the prior rollout.

Use the template at `${CLAUDE_PLUGIN_ROOT}/skills/schedule/rollout-template.md`. Substitute:
- `{{PROJECT_NAME}}` — display name (e.g. `GifLab`)
- `{{ROLLOUT_SLUG}}` — the resolved dated rollout slug, no extension (e.g. `giflab-rollout-2026-07-18`)
- `{{DATE}}` — today's date (YYYY-MM-DD)
- `{{VERIFIER}}` — the verifier command detected in step 2.5 (or user-provided)
- `{{REPO_PATH}}` — the repo path § 0 resolved and checked (the project note's `Local:` line, or the path the user gave)
- `{{THREAD_LINE}}` — the whole line `` Thread: `<path to the thread file>` ``, naming the project's THREAD.md or its shared thread file when one exists (e.g. `` Thread: `~/repos/tools/chorus/THREAD.md` ``); otherwise delete the line entirely — no blank placeholder line
- `{{QUEUE_TABLE}}` — the rendered `## Queue` table, header row `| # | Task | Scope | Mode |` included, one row per task in schedule order (step 5): `| <n> | [[<full-slug>\|<alias>]] | <scope> | <mode> |`. Mode is `solo` (a confirmed Solo task), `sequential-merged (one agent/PR)` (a merged unit from step 4.5: one agent does the folded sub-tasks in sequence), `carried (<queue state>)` (a task carried from the superseded rollout, with its state from step 1's preview) or `—`. The row is the task's rank (`reconcile-rollout.py next` reads a task's first wikilink on a table row or list item), so nothing above the table lists a task.
- `{{QUEUE_RATIONALE}}` — short prose explaining the order (dependencies, Solo placement, ties)
- `{{FILE_SETS}}` — a **machine-readable** per-task file-set block, one line per *editing* task: `- <full-slug>: a, b`, from step 2's best-effort file-sets (`touches:` or the paths the body names, unioned for merged units). Omit read-only tasks (no edits). `reconcile-rollout.py next` reads it only for its overlap tiebreak, and nothing halts on it. This is **rollout-note data**, distinct from the task-frontmatter `touches:` Don't (it lives in the rollout note, never stamped onto the individual tasks).
- `{{KNOWN_BASELINE_FAILURES}}` — the `## Known baseline failures` block from step 2.6: one `- <test_id> — <reason>` line per test already red on a clean `main`, or `none`. `/thread:execute` reads this block, threads it into every agent, and shifts the Ralph green criterion to "no NEW failures beyond this set" (never `--deselect`). Like `{{FILE_SETS}}`, this is rollout-note data the executor reads, never task frontmatter.
- `{{POST_ROLLOUT_ITEMS}}` — rollout-specific post-completion items (audit re-runs, downstream unblocks, validation sweeps), one numbered/bulleted line each, or `none`. These slot under the template's fixed completion-ceremony steps; at completion the ceremony (execute SKILL §4.5 step 5) converts each into a new open task + thin pointer, so phrase them as work descriptions, not instructions to leave in place.

The template's frontmatter carries `incomplete: true`: keep it as written. Step 7 removes it as its last write, once every task is stamped, and until then `reconcile-rollout.py next` refuses the note, so a run that stops between here and there (a crash, a cancel, a failed carry) never leaves a note `/thread:execute` would run with tasks unstamped. It also carries `protocol_version: 5` plus rollout-level convergence defaults (`max_iterations: 3`, `max_review_rounds: 4`, `max_plan_rounds: 3`, `plan_approval: scope-gated`, `parallel_ceiling: 4`). These are inherited by every task in the rollout; per-task overrides go in the task's own frontmatter. When step 2.7 detected an env-bootstrap command, uncomment the template's `env_bootstrap:` line and set it (`/thread:execute` runs it once per worktree); leave it commented out when none. `plan_approval: scope-gated` means the plan-gate fires only for `scope: cross-cutting` tasks (other values: `off`, `required`) — see `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` for the gate semantics. (`completion_sentinel` is gone as of protocol 3 — the Workflow engine returns validated structured output instead of parsing sentinel strings.)

Render each task reference in the queue table as `[[<full-slug>|<short-alias>]]` for readability (escaping the alias pipe as `\|` inside the table).

### 7. Update each task's frontmatter

For each task in the rollout:

- Add `rollout: "[[<rollout-slug>]]"` backlink (a carried task already has it)
- Remove a legacy `wave:`, and a stale `owner:` on an open task (an open task has no live owner)
- Add `scope:` if not already set (single-file / cross-cutting / read-only — see step 4) — `/thread:execute` uses this to route master-review depth
- For `scope: read-only` tasks specifically, also add `max_iterations: 1` (nothing to retry)
- For tasks the user confirmed as Solo in step 5, add `solo: true`
- For the body dependencies the user confirmed in step 3, append `depends-on:` entries (`- "[[<slug>]]"`) to the dependant; never drop an existing entry
- For a task whose § 4.7 offer the user confirmed, or whose rung the user named explicitly, add `rung: <name>` (a rung the ladder lists) — never by default, and never on the rollout note
- For a non-carried `queued` candidate that still has a legacy stamp (a `model:`, an `effort:` or the stale cap stamp), apply carry's mapping (`reconcile-rollout.py carry`): with no non-empty `rung:` of its own, a `model: fable` or an `effort: xhigh` or `max` (trimmed, any case) becomes `rung: <the ladder's top rung>`; then remove each recognised key (`model:` at fable, opus or empty; `effort:` at low, medium, high, xhigh, max or empty; the cap stamp at any value) and leave an unrecognised value in place, listing it in step 8's "Pre-flight — legacy values left in place" block. When `ladder.py` refused at schedule time, still remove the drop-only keys (they need no rung name, as in carry), but leave a top-mapping legacy stamp in place, unmapped: execute's compat read (execute SKILL.md, *Legacy stamps*) maps it at runtime once the file reads, and execute halts `ladder file refused` until then. List each such task in step 8's "Pre-flight — ladder refused" block
- For tasks the §3.6 sweep flagged (user-confirmed), add `plan_approval: required` — advisory: it guarantees a plan-gate exists where the plan's own `### Gated inputs` declaration (the authoritative signal, ADR 0008) can pause for sign-off
- Preserve all other frontmatter fields verbatim

A carried task that has started (any queue state but `queued` in step 1's preview) keeps the frontmatter `carry` left it: step 7 writes nothing to it. A carried `queued` task is stamped like any other.

The combined notes authored in step 4.5 are stamped here like any other task (`rollout:`, `scope: cross-cutting`). Their folded-in members are **not** stamped — they already carry `status: merged` + `merged_into:` from step 4.5 and are never dispatched.

Use the same YAML field ordering the file already has; insert the new fields just below the existing `status:` line.

**Do NOT stamp `verifier:` / `max_iterations:` / `max_review_rounds:` on individual tasks by default, and never stamp a `model:` or an `effort:` at all.** The first three are rollout-level defaults — tasks inherit them automatically. Only set them per-task if the user explicitly asks to override the rollout default for a specific task during the confirm-batch step. `model:` and `effort:` are legacy stamps the engine never dispatches at: step 7 only maps and removes them. The sanctioned exceptions are read-only's `max_iterations: 1`, the user-confirmed `rung:` from § 4.7 (a rung offer confirmed, or a rung named explicitly; per-task only, it has no rollout-level form), and the §3.6 sweep's `plan_approval: required` on gated-input-smelling tasks — all deliberate per-task decisions, not defaults.

**Then clear this note's stamp.** Once every task above has its stamps (a carried task that has started keeps what `carry` wrote), remove the `incomplete: true` line from this rollout note's frontmatter: it is step 7's last write, after every task stamp and before step 7.5's close-out. A run that stops anywhere earlier leaves the stamp, so `reconcile-rollout.py next` refuses the note and § 0 offers it to the next `--regenerate`. Remove only the stamp on the note this run wrote: one § 0 put on an interrupted supersede's note ends only when a supersede closes that note.

### 7.5. Close out a superseded rollout

**Superseding a prior rollout.** Close out the prior rollout last, after step 7 has stamped this rollout's tasks, so an interrupted run always leaves the prior note open for § 0 to pair with this one. Step 6 stamped `supersedes: "[[<prior-slug>]]"` in this note's frontmatter and carried the prior note's unlanded tasks here. Now set `status: done` + `superseded_by: "[[<this-slug>]]"` on the prior note, stamps first and then the move. This note is always a new file (step 6 never offers **Overwrite**), so the prior note is never the note this run wrote. Then move it with a plain `mv` into `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`, running `mkdir -p` on that folder first if it is absent. The move is explicit because a note left in `Work/Tasks/` at `status: done` is filed into `Work/Tasks/Archive/` by the daily sweep (`_shared/scripts/daily-sweep.sh`), which is the wrong folder for a rollout. Find the prior note wherever it now sits: `Work/Tasks/<prior-slug>.md` is the normal case; at `Work/Tasks/Archive/<prior-slug>.md` the daily sweep already filed it (a run that died between the stamps and the move, which § 0's `file` line finishes, or a note superseded under older wording), so move it on from there; already in `Work/Tasks/Archive/Rollouts/`, leave it where it is. Never overwrite a same-named file already in `Archive/Rollouts/`: on a collision skip only the move, report the collision and continue the run; meanwhile the daily sweep files the stamped note into `Work/Tasks/Archive/`, and ADR 0026's shared reconcile step flags it as drift until someone resolves the collision. Schedule leaves the commit to the daily sweep, which commits the move with the rest of this run's vault writes (the planner runs no git, per the Don'ts). Wikilinks resolve by filename, so `supersedes:`, `superseded_by:` and the tasks' `rollout:` backlinks survive the move. As a backstop, ADR 0026's shared reconcile step reports a superseded rollout note outside `Archive/Rollouts/` as drift. Landed tasks stay linked to the prior note; carried ones now belong here.

### 8. Print summary

```
Queue for {{PROJECT_NAME}} written to [[{{ROLLOUT_SLUG}}]] — N tasks (K carried from [[<prior>]], S solo).
filed [[<P>]] into Archive/Rollouts/                     # one line per § 0 `file` finish
finished the interrupted supersede of [[<P>]]; [[<N>]] was incomplete and is superseded here   # per `interrupted` finish
Verifier: <detected command>
Default review rounds: 4

Open in Obsidian to review. To execute:
  execute [[{{ROLLOUT_SLUG}}]]                # continuous: the queue runs and merges to the end
  execute [[{{ROLLOUT_SLUG}}]] --gated        # pause for a human before each merge

The thread:execute skill at ${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md reads this note and runs the three-layer convergence engine (plan-gate → Ralph retry → master review) via the Workflow tool.
```

**Pre-flight — gated tasks.** If the user kept any of step 3.5's human/release-gated tasks, list them above the summary so the user clears them before executing (an unaddressed gate makes the agent refuse mid-run):

```
⚠️ Pre-flight — these tasks carry a human/release gate. Clear each before executing, or they'll refuse mid-dispatch:
  - [[task-x]] — "don't action until the v0.5 release ships"
To run one anyway, set `ignore_gate: true` on its task note (overrides the gate for the run). To drop one after all, take it out whole: clear its `rollout:` and delete its `## Queue` row and its `## File-sets` line from this note.
```

**Pre-flight — local copies agents won't see.** If step 2's pushed-base re-run printed any WARN
lines, list them verbatim above the summary, so the user commits and lands those files (or accepts
GitHub's copy) before executing:

```
⚠️ Pre-flight — local copies agents won't see (agents read origin/<default>'s copy):
  pushed-base: WARN: docs/adr/0031-x.md: uncommitted change: agents see origin/master's copy, not this one
```

**Pre-flight — ladder refused.** If `ladder.py` exited non-zero at § 4.7 (so no rung was offered), show its stderr line verbatim above the summary, then one line per task whose top-mapping legacy stamp step 7 left in place, then the remedy:

```
⚠️ Pre-flight — ladder refused (execute halts `ladder file refused` at each call's start until it reads):
  ladder: /Users/<you>/.config/thread/ladder.toml:11: rung 2 ("opus-xhigh"): effort "huge" is not one of low, medium, high, xhigh, max
  - [[task-z]] — model: fable left for execute's compat read
Fix: edit the named line of ~/.config/thread/ladder.toml, then execute.
```

**Pre-flight — legacy values left in place.** If step 7 left an unrecognised legacy value on a non-carried candidate, list one line per value above the summary, in carry's own `WARN: carry:` format with `schedule` in its place, so the two read alike (a carried task's lines already showed in step 1's confirm):

```
⚠️ Pre-flight — legacy values left in place (no rung was mapped from them; correct or remove each by hand):
  WARN: schedule: task-w: effort: banana unrecognised, left in place
```

**Pre-flight — unfinished-rollout warnings.** List the `WARN:` lines § 0's unfinished-rollout check printed (a Project root matched on its path only, a rollout left out for want of a Project root line, a complete rollout whose ceremony never ran, a superseded note it could not file, an incomplete rollout this run superseded) verbatim above the summary, so the user can resolve each.

The detected file-sets (step 2) are listed as information, never as a question: they only break queue-order ties.

Likewise list the §3.6 gated-input stamps so the eventual pause reads as designed (ADR 0008 — these will stop at their plan-gate for your sign-off even in continuous mode; `ignore_gate` does NOT override a gated input):

```
Expected to gate (will pause for your sign-off at their plan-gate):
  - [[task-y]] — smells of API spend ("~30 USD of Replicate credits") → plan_approval: required
```

## Execution lives in `/thread:execute`

This skill does not execute anything. The rollout note it produces is read by the sibling **`/thread:execute`** skill (`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`), which resolves per-task config and calls the **Workflow** tool with `task.workflow.js` — the convergence engine (plan-gate → Ralph retry → master review). The engine is not duplicated into individual rollout notes; improvements to the script reach every rollout immediately.

## Don'ts

- Don't refuse small rollouts — shape decides, not count (`skills/_shared/execution-fit.md`). A one-task rollout-shaped rollout is valid; note the ceremony is thin and proceed.
- Don't auto-merge dependency cycles silently — if A depends on B and B depends on A, surface and ask. (This is about *dependency* cycles — distinct from the affinity-cluster consolidation in step 4.5, which is a sanctioned auto-merge of same-*change* tasks.)
- Never overwrite or reuse an existing rollout note: step 6's naming prompt offers only Advance or Cancel.
- Never remove `incomplete: true` from a rollout note except as step 7's last write on the note this run wrote: a stamp on any other note (§ 0's on an interrupted supersede's note, or one a stopped run left) ends only when a supersede closes that note out.
- Don't touch tasks outside the target project (the `projects:` filter is strict).
- Don't fill in `touches:` on tasks where you regex-detected files — that promotes a guess into authoritative metadata. Only the user does that. The **one** exception is the combined note authored in step 4.5: when every member has its own `touches:`, its `touches:` is their union, so it's a derivation, not a fresh guess. (Separately, the `## File-sets` block in the **rollout note** — step 6 — records the best-effort file-sets, but that's rollout-note data the executor reads, never task frontmatter, so it doesn't touch this rule.)
- Don't run `git` operations or open PRs from the planner — the planner only reads/writes vault files, except § 0's remote, register, pushed-base and unfinished-rollout checks (`git remote get-url`, `gh repo view`, `landing-register.py check`, `git fetch --prune` of `origin/<default>` and `origin/close/*` (pushed-base check), which moves or prunes only remote-tracking refs, and `unfinished-rollout.py check`'s `git rev-parse --local-env-vars` and `git remote get-url`), a supersede's `reconcile-rollout.py resume`, whose `gh pr view` / `gh repo view` calls are read-only, and a supersede's `git-env-canary.py check-all` and `retire`, whose git calls are read-only.
- Never write a second unfinished rollout on a repo, and never supersede one that § 0 did not print as `supersede`.
- Never move a rollout note except by step 7.5's move (which § 0 also runs for `file` and `interrupted`).

## Verification

End-to-end test against an existing backlog (e.g. GifLab):

1. `/thread:schedule GifLab` from any Claude Code session
2. § 0's unfinished-rollout check prints `none` (or `supersede <prior>` on `--regenerate`), then it confirms ~9 open tasks and prints the detected file-sets as information, with no confirm turn for them
3. Step 2.5 detects `make test` (or whatever GifLab's CLAUDE.md prescribes) — prints it and asks to confirm
4. Orders the queue (dependencies first, Solo proposals and § 4.7's rung offers in the confirm batch)
5. Writes the always-dated note `giflab-rollout-<YYYY-MM-DD>.md` (advancing to the next `-N` ordinal if today's already exists), its `## Queue` table in schedule order.
6. Rollout note carries no `incomplete:` line (step 7's last write removed the one it was born with), and carries `protocol_version: 5`, `verifier:`, `max_iterations: 3`, `max_review_rounds: 4`, `max_plan_rounds: 3`, `plan_approval: scope-gated`, `parallel_ceiling: 4` in frontmatter, plus a commented-out `env_bootstrap:` line (set only when the run needs it). No inline execution playbook — the rollout body is data only.
7. Stamps `rollout: "[[...]]"` and `scope:` on each task, and removes any legacy `wave:`
8. Prints summary pointing the user toward `/thread:execute`

Then from a fresh session: paste `execute [[giflab-rollout-<YYYY-MM-DD>]]` (the dated note just written) — the `/thread:execute` skill should pick it up, gate on `protocol_version: 5`, resolve per-task config, and call the Workflow tool with `task.workflow.js` to run the three-layer convergence engine per task (visible live via `/workflows`).

### Merge regression (step 4.5)

The GifLab backlog is a good fixture because it exercises both a merge and a deliberate non-merge in one run. Against the open backlog, `/thread:schedule GifLab --regenerate` should:

- **MERGE → "metrics.py sentinel → NaN hardening":** `giflab-dry-ssimulacra2-fallback-dict` + `giflab-lpips-fallback-nan-sentinel` + `giflab-per-frame-exception-nan-sentinel`. All replace fabricated sentinels with `float("nan")` + NaN-aware aggregation in `metrics.py` error paths, and the LPIPS task literally says *"consider folding LPIPS into the same DRY-up… shared `_nan_fallback_dict(keys)`"* (strong signal). 3 Integrations → 1.
- **MERGE → "content-classifier lossy ceiling":** `giflab-data-viz-animation-lossy-guard` + `giflab-photographic-content-lossy-ceiling`. Both build the same pre-compression classifier + `lossy_max` machinery; only the heuristic differs. 2 → 1.
- **KEEP SEPARATE (guard fires):** the `composite_quality` trio `giflab-composite-quality-bare-vs-mean-key-mismatch` + `giflab-composite-quality-nan-guard` + `giflab-temporal-consistency-composite-quality-fix`. They share `enhanced_metrics.py`, but the nan-guard task calls the per-frame task *"independent changes to different callsites"* and scopes the temporal task out — explicit-independence hard block. Kept apart; Integration serialises their merges.
- Members of the two merges end up `status: merged` + `merged_into:`, any legacy `wave:` cleared; a second `--regenerate` skips them (step 1).
- The queue drops from ~9 entries to ~6 (the two merges save three Integrations).
