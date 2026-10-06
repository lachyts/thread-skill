# thread — one system that drives work through time

Claude Code plugin, twelve skills, two lanes. The **continuity verbs** solve
"too many live agent threads, and shutting one down feels like losing context"
— every route out of a thread captures its state somewhere durable. The
**rollout verbs** run large multi-PR changes as a queue of tasks on a
convergence engine, each integrated with the latest main before it merges. One
rule connects them: the **execution-fit test** (`skills/_shared/execution-fit.md`)
decides which lane owns a cluster — hard, never as a preference. Rollout-shaped
work (one repo, PR-per-task, machine-verifiable in-run) rolls out; everything
else runs as scoped sessions.

> Until v2.0.0 the rollout verbs shipped as the separate `wave` plugin
> (`lachyts/wave-skill`, now archived). The namespace is `/thread:*`
> throughout, and since ADR 0030 a rollout is a queue.

> **Built for one setup.** This is a working reference implementation, published as-is, not a
> general-purpose plugin. The skills assume the author's machine: an Obsidian vault at
> `~/repos/obsidian` (TaskNotes tasks under `Work/Tasks/`, phases under `Work/Phases/`), a
> workspaces repo at `~/repos/workspaces` whose `_shared/` holds the note-writer specs, shared threads
> and the native-workflow exchange, and a Melbourne clock. Read it for the ideas (the execution-fit
> test, the convergence engine, the handoff lifecycle); expect to adapt paths before running it
> anywhere else. `make test` is hermetic and runs on any machine with bash, `python3` (with PyYAML, which
> the next-action script reads frontmatter with: `python3 -m pip install pyyaml`) and `node`.

## Continuity verbs

| Member | Moment | What it does |
|---|---|---|
| `/thread:open` | resume/start | Open or create a durable `THREAD.md`; also picks up a stashed/deferred task (`/thread:open [[task]]`) and auto-completes it. |
| `/thread:next` | "what's my move?" | Router/advisor: summarise where we are, recommend a move, dispatch to a sibling route. |
| `/thread:orient` | back on a project, balls in the air | The one shaping verb (ADR 0027): audit an area's open work and recommend the best use of time, then **Reshuffle** (re-sort bugs, brain dumps, loose tasks and unstarted phases; grill what is unclear; write phases and `pN-M` tasks at one gate) or **Look only**. Schedules rollout-shaped phases itself, steers the rest (background batch sessions it launches itself, ADR 0010, or a focus item via `open`), and ends with the execute offer. Pointed at one plan, design note or brain dump it runs a scoped reshuffle that turns it into phased tasks. |
| `/thread:stash` | out of time, not my focus | Self-contained vault task, **no date**. Locked in, safely dormant. |
| `/thread:defer [day]` | tomorrow's problem | Self-contained vault task **scheduled** for `[day]` (default tomorrow). Surfaces on that day's page. |
| `/thread:handoff` | fork now | Write a durable `docs/handoffs/` doc and land it (committed, then pushed or its merge queued, never waited on — ADR 0028) + paste-ready prompt (never OS temp; the consumer marks it consumed, its close deletes it — ADR 0017). In Codex Desktop also create a fresh visible sidebar task seeded with it; elsewhere label it a manual handoff. |
| `/thread:close` | done | Persist to THREAD.md + auto-commit; end-of-thread ritual; lands its close-out and its own branch (ADR 0028): the own branch is reviewed by `/fresh-review` before its merge is queued. |

Stash, defer and close are the **set-downs** (estate ADR 0008, `~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md`): each writes the task's `next_action:` and points the `next_task:` of every project note the task links (area notes skipped) at it, most recent winning — close only when the thread has a concrete next task. `orient` reads that slot first and fills it only when blank. Both go through `skills/_shared/scripts/next-action.py` (`skills/_shared/task-writer.md` § 4b).

## Rollout verbs

| Member | Role | What it does |
|---|---|---|
| `/thread:schedule` | planner | Orders the backlog into a queue (dependencies recorded in frontmatter, Solo for sweeping changes, affine same-file clusters folded into one unit) and refuses a second unfinished rollout on a repo (`--regenerate` supersedes it, carrying its unlanded tasks); writes a thin, always-dated `<slug>-rollout-<YYYY-MM-DD>.md` (data only, `protocol_version: 5`). No minimum size — shape decides, not count. |
| `/thread:execute` | executor | Runs the rollout's queue on a dynamic **Workflow**: per-task plan-gate → Ralph-style verifier retry → master review, one task per Workflow call up to `parallel_ceiling`; the lead integrates each approved task with the latest main and auto-merges it (`--gated` = a merge hold before each merge). |
| `/thread:status` | situational report | Read-only: where the rollout is, what's blocked, what drifted from GitHub reality, one recommended next action. |
| `/thread:repair` | conductor | Diagnose a stuck rollout, reconcile drift, ask only the decisions no agent can make, resume via execute — the engine keeps sole merge authority. |
| `/thread:retro` | tuner | The Retro (ADR 0032): fold the journals, score the Run record (Throughput over running time, the Guardrails against the last Retro, Slot and lane use, load, the binding constraint) and propose Tunings to `rollouts.toml`; only the ones Lachy picks are applied, by the tune script, which records every Retro in `tunings.jsonl`. Never changes anything on its own. |

## Runtime support

Orient's local read/audit and task-note debrief are portable; its automatic
batch dispatch requires a Claude Code session, a scoped `cc-*` profile and
cmux. Other harnesses can prepare manual launch prompts without marking tasks
dispatched. The rollout executor still requires its canonical Workflow runtime;
shared source and skill discovery do not provide that runtime.

## The convergence engine

`skills/execute/task.workflow.js` runs **three layers per task**,
**one task per Workflow call**; the lead fills slots up to `parallel_ceiling`,
integrates each approved task and merges it:

1. **Plan-gate** — an autonomous judge approves the implementation plan before
   code is written (skippable per rollout; a plan's declared gated inputs
   always pause for human sign-off — ADR 0008).
2. **Ralph-style verifier retry** — the implementer re-runs the rollout's
   verifier and self-corrects until green or the iteration budget is spent.
3. **Master review-and-revise** — a master-side reviewer accepts or sends the
   task back with feedback, up to `max_review_rounds`.

Worktree isolation is explicit: each task runs in
`<repoPath>/.claude/worktrees/<slug>`. Merges go **only** through
`skills/execute/scripts/merge-task.sh` — gated on *required* status checks,
never `--admin`, never force. `skills/execute/scripts/reconcile-rollout.py`
writes all per-task vault frontmatter transitions deterministically and drives
per-task resume; `skills/execute/scripts/lead-integrate.py` is the lead's side
of Integration (the clean-path merge and its bounded verify, the trouble-path
inputs and the lead's own set-aside rows).
`skills/execute/scripts/git-env-canary.py` is the lead's git-env canary: it
watches the shared checkout's default branch and bareness around every launch
and halts the queue on a change that is not a close-out (execute § 4.5).
`skills/_shared/scripts/run_record.py` is the Run record's one writer (ADR 0032):
every emitter appends its events through it, and its header is the schema.
`skills/retro/scripts/score.py` reads a record into a Retro's scores and proposals
(writing nothing), and `skills/retro/scripts/tune.py` is the only writer of
`rollouts.toml` and `tunings.jsonl`: it applies the Tunings Lachy picks and records
one line per Retro.

## Design

- `CONTEXT.md` — the domain glossary (lane, rollout-shaped, Task floor, Router,
  rollout, cursor, conductor, drift, tier, …).
- `skills/_shared/execution-fit.md` — the canonical lane rule.
- `skills/_shared/task-writer.md` — the single spec for writing + routing the
  vault task (dedup, day parsing, resume prompt, pickup auto-complete).
- `docs/adr/` — the decision record; read the directory for the current set.
  `0001`–`0003` are the continuity decisions (task floor; next is a sibling;
  orient is project-altitude next — 0003's packaging and launch conclusions
  since superseded by 0009 and 0010). `0004`–`0008` are the engine decisions
  (repair is a conductor; a phase is a plan; one-shot first pass, iteration
  escalates to Fable; a tier is a model+effort bundle; a declared gate always
  pauses). `0009` — thread absorbs wave: one plugin, one prefix, two lanes.
  `0010` — orient launches its own batches. `0011` — close saves
  autonomously; vault tasks stay gated. `0012` — process candidates flow to
  the project's METHOD.md (cross-repo interface with the `method` skill).
  `0013` — only list items declare gates. `0014` — stash and defer run the
  silent process scan. `0015` — process candidates route by altitude
  (project / seat / estate; amends 0012 and 0014; canonical design record is
  workspaces ADR 0003). `0016` — a tier ceiling caps escalation when quota is
  gone (amends 0006). `0017` — a pending handoff owns the thread's
  continuation: handoff docs are durable and self-cleaning, and close refreshes
  a pending one instead of proposing vault tasks that restate it (amends 0011).
  `0024` — the operator's top tier sets every rollout's ceiling (amends 0016;
  implementation pending, task p7-1). `0025` — master moves only by green PR,
  owner included. (0018–0023 are reserved: 0018–0022 are on the protocol 4
  branch, and 0023 belongs to orient's native-children task, p3-1.) `0030` — a
  rollout is a queue that integrates at merge (one engine, no alias).
- `docs/wave-THREAD-archive.md` — wave's full build history, verbatim.
- `docs/build-plan.md` — the approved 2026-07-14 build plan, historical.

## Install

**Stable channel** (loads every session):

```sh
claude plugin marketplace add https://github.com/lachyts/thread-skill
claude plugin install thread@thread
```

**Dev / heavy iteration** — load the working tree directly, no reinstall loop:

```sh
claude --plugin-dir ~/repos/tools/thread-skill
```

A release bumps `plugin.json` and `marketplace.json` together (BOTH, always). `master` is protected
(ADR 0025): the bump, like every other change, lands through a pull request with a green `make test`
check, and nobody pushes to `master` directly, the owner included. **Tag after the merge, on master's
merged commit**: `git fetch origin && git switch --detach origin/master`, then `claude plugin tag --push`
(detached, so it works even while local `master` holds unpushed commits). Tagging the branch before a
squash merge tags a commit that never reaches master.

## Tests

```sh
make test            # = bash tests/run.sh — the one entrypoint, and the self-rollout verifier
make evals           # behaviour evals: real model calls, a human step, never part of make test
```

`tests/run.sh` runs everything hermetically (temp `HOME` and global git config, no bytecode, and a
final check that the run wrote nothing into the tree):

- **Syntax** — `bash -n` on every shell script, `ast.parse` on every Python script, and a real parse
  of every `*.workflow.js` (`tests/lib/check-workflow-parse.sh`: the body wrapped the way the Workflow
  runtime wraps it; `node --check` silently passes broken ESM on Node 23, so it is not used).
- **Engine** — `skills/execute/tests/`: `prompt-invariants.test.mjs` guards the **resume-cache
  invariant** (optional engine features must render byte-identical Workflow `agent()` prompts when
  unset, or in-flight rollouts can't resume); `reconcile-rollout.test.sh`, `reconcile-rollout-queue.test.sh`
  (the queue verbs), `reconcile-rollout-runs.test.sh` (accumulated feedback runs), `reconcile-rollout-lead.test.sh`
  (`hand-back`, `log-integration`) and `reconcile-rollout-descope.test.sh` (the automatic-descope verb); `rollout-stop-driver.test.sh`; `tests/lead-integrate.test.sh` (the lead's
  Integration against a fake `gh` and real repos) and `tests/contracts/execute-queue.test.mjs` (the queue loop's prose);
  `merge-task.sh --self-test-classify` / `--self-test-base`, and `tests/merge-task-base.test.sh` /
  `tests/merge-task-integrated.test.sh` (one integrated PR per call, against a fake `gh` and a real bare repo).
- **Contracts** — `tests/contracts/*.test.mjs`: manifests agree, skill names and description budgets,
  `${CLAUDE_PLUGIN_ROOT}` references resolve, hooks target real files, no SKILL.md body holds a
  positional `$N` (Claude Code substitutes skill arguments into them; logic that needs one lives in a
  script), the next-action set-down write and orient's slot read (`next-action.test.mjs`), and
  `thread:handoff` as the handoff doc's one writer plus `next`'s compact recommendation
  (`handoff-one-writer.test.mjs`), and the queue as the only rollout (`queue-only.test.mjs`: retired names
  and files stay gone, and every surviving mention is a listed refusal, migration strip or history line).
- **Retro** — `tests/retro-score.test.mjs` (`score.py` on synthetic records: running time and its
  exclusions, the Slot-bound and lane-bound fixtures, each proposal's direction and cause, the baseline, load),
  `tests/retro-tune.test.mjs` (`tune.py` edits only the picked keys, records one line, and writes nothing on a
  refusal or a failed write) and `tests/contracts/retro.test.mjs` (the verb's wiring and its SKILL's order).
- **Next-action script** — `tests/next-action.test.mjs`: `next-action.py`'s set-down, fill, read and
  captures against throwaway vaults — byte-level one-line edits, YAML-safe quoting, both tag forms, the
  shared dead-link rule, and refusals that write nothing.
- **Default branch** — `tests/default-branch.test.{mjs,sh}`: `defaultBranch` keeps pre-fix bytes when
  unset, refuses unsafe names, and the resolver in `execute/SKILL.md` § 4 works against fixture remotes.
- **Release check** — `tests/release-check.test.sh`: the real `make release-check` recipe against a temp
  tree and a fake config dir (matching, stray, noise-only, differing, missing and mismatched caches,
  and a non-empty evals/results/).
- **Evals structure** — `tests/contracts/evals-structure.test.mjs` checks the `evals/` suite's shape for
  free and never runs it (case discovery, frontmatter keys and types, read-only tool grants, graders, and
  `make evals` kept out of `make test` and off the default goal). The suite itself is scored by
  `claude plugin eval` via `make evals`, a human step outside `make test`; its baseline is recorded in
  `docs/evals/`.

New suites join by filename: `tests/*.test.mjs`, `tests/contracts/*.test.mjs` and
`skills/execute/tests/*.test.mjs` run under `node --test`; `tests/*.test.sh` and
`skills/execute/tests/*.test.sh` run concurrently, output grouped per suite. `skills/execute/diagnostics/` holds paid live
diagnostics (Workflow runtime + real agents) — parse-checked, never run by `make test`.

After a release, `make release-check` confirms both manifests agree and the version-keyed plugin
cache (what `${CLAUDE_PLUGIN_ROOT}` — the engine, scripts and hook — runs from on a marketplace install)
matches the tree. It also fails on cache files the tree doesn't track (`.DS_Store` and `__pycache__/` exempt), so run it
on the released commit, right after the plugin update. It refuses first while `evals/results/` holds
`make evals` output: record what you need in `docs/evals/`, then clear it before the plugin update,
since the `./` source would copy it into the cache. If a copy already reached the cache, the refusal
names the `evals/results` dir to delete there. A directory-source install (or `--plugin-dir`) runs live from its
checkout instead, the **primary checkout**, which never moves while a rollout runs on it (ADR 0031).

## Coexistence with Orca

The rollout lane (autonomy) and **Orca** (https://www.onorca.dev/ — a GUI ADE
for supervised parallel agents) run in separate lanes: thread owns autonomous
batch rollouts; Orca owns supervised/exploratory work. They share repos and
the `.git/worktrees/` registry without colliding — Orca auto-discovers the
engine's worktrees as `external` and doubles as a **read-only window** onto a
running rollout. Rules of the road: observe, don't hand-edit mid-rollout
(repair with `/thread:repair`); the engine owns `audit-fix/*` branch names;
the 11am `daily-git-sweep` reaper only removes clean AND merged worktrees. If
you do hand-edit in Orca, commit on the existing `audit-fix/<alias>` branch,
push but never merge — the engine still merges.

## Lineage

The continuity verbs absorb three previously flat skills: `/thread`
(→ `thread:open`), `/close` (→ `thread:close`), and `/handoff`
(→ `thread:handoff`; originally from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT — attribution
retained in the skill). The rollout verbs were the `wave` plugin (v1.0.0 →
v1.4.1, merged in at thread 2.0.0 with full git history; born from a
2026-06-02 end-to-end giflab rollout — 8 waves, 14 PRs).
