# wave

A Claude Code plugin for running large, multi-PR changes as a **wave-by-wave convergence
rollout**. The pipeline:

- **`/wave:split`** — the *decomposer*. Turns a plan or design into numbered, phased, PR-sized
  Obsidian task notes.
- **`/wave:gather`** — the *roadmap-former*, split's inverse. Turns a project's loose, unphased
  Obsidian tasks into a phased roadmap: cluster proposal → grilled meaning (via the user's
  grill-with-docs / grill-me skills) → phase notes + `pN-M` renames + project-note surfacing.
  Converges on `/wave:schedule`.
- **`/wave:schedule`** — the *planner*. Reads a backlog of related tasks under one project, computes
  wave structure from file-overlap + dependency analysis, auto-merges affine same-file task clusters,
  and writes a thin, always-dated `<project-slug>-rollout-<YYYY-MM-DD>.md` note (data only) with `protocol_version: 3` frontmatter.
- **`/wave:execute`** — the *executor*. Reads that rollout note, resolves per-task config, and hands
  the convergence work to a dynamic **Workflow** script. Continuous mode auto-merges each wave before
  launching the next (zero-touch); `--gated` is the manual-merge escape hatch.

And two operational verbs for a rollout already in flight (see **Status & repair** below):

- **`/wave:status`** — read-only situational report: where the rollout is, what's blocked, what each
  blocker needs, what drifted from GitHub reality, and the recommended next action.
- **`/wave:repair`** — the *conductor*: diagnose a stuck rollout, reconcile drift, ask only the
  decisions no agent can make, and resume via execute — wave keeps sole merge authority.

The plan is a data artefact; the dispatch + convergence contract lives entirely in the executor.

## The convergence engine

`skills/execute/wave-execute.workflow.js` runs **three layers per task**, converging tasks
**in parallel within each wave** (a task can be in master-review while a wave-mate is still
implementing):

1. **Plan-gate** — an autonomous judge approves the implementation plan before code is written
   (skippable per rollout).
2. **Ralph-style verifier retry** — the implementer agent re-runs the rollout's verifier command
   (`make test`, `pytest`, …) and self-corrects until it passes or the iteration budget is spent.
3. **Master review-and-revise** — a master-side reviewer accepts or sends the task back with
   feedback, up to `max_review_rounds`.

Worktree isolation is explicit: each task runs in `<repoPath>/.claude/worktrees/<slug>` (not the
session repo). Merges go **only** through `scripts/merge-wave.sh` — gated on *required* status
checks, never `--admin`, never force — which writes a `<repoPath>/.claude/merge-wave.status`
sentinel and distinguishes genuine test failures from CI infra/setup flakes (auto-rerunning only
the latter, fail-closed). `scripts/reconcile-wave.py` writes back all the per-task vault
frontmatter transitions deterministically and drives per-task resume.

## Install

**Stable channel** (loads every session):

```sh
claude plugin marketplace add https://github.com/lachyts/wave-skill
claude plugin install wave@wave
```

**Dev / heavy iteration** — load the working tree directly, live, with no reinstall loop:

```sh
claude --plugin-dir /path/to/wave-skill
```

Cut a versioned release with `claude plugin tag` once `plugin.json` + `marketplace.json` agree.

## Invocation

Two entry points feed the planner: a plan or design → `/wave:split`; a loose, unphased backlog →
`/wave:gather <Project>`. Then `/wave:schedule <Project>` to build a rollout, then `/wave:execute [[<slug>-rollout]]` (or natural
language: `execute Wave 1 of [[<slug>-rollout]]`). The executor only runs `protocol_version: 3`
rollouts and prompts for regeneration via `/wave:schedule --regenerate` on older notes.

## Status & repair

Once a rollout is running, two verbs operate on the **whole rollout**, not a single task:

- **`/wave:status [[<slug>-rollout]]`** — read-only. Reads the rollout + every linked task note and
  cross-checks live GitHub PRs + git worktrees, flags **drift** (e.g. a `review-blocked` task whose PR
  actually merged out-of-band), and prints one recommended next action. `--offline` skips the network.
- **`/wave:repair [[<slug>-rollout]]`** — the *conductor*. Runs the status scan, then: reconciles drift
  to `done`, auto-retries agent-fixable blocks (cap one per run), asks you the **input-gated** decisions
  and writes them into the notes, dependency-aware-**defers** wedged tasks, and hands off to execute's
  resume to finish. It never re-implements merge/convergence (it reuses execute's idempotent resume —
  see `docs/adr/0001-repair-is-a-conductor-not-an-engine.md`), so **wave keeps sole merge authority**.

Both are rollout-scoped: you point at the rollout and ask "where is it?" / "sort it out" — never a task.

## Layout

```
.claude-plugin/{plugin.json, marketplace.json}
CONTEXT.md            glossary — the domain language (rollout, wave, conductor, drift, …)
docs/adr/             architecture decision records
skills/
  split/     SKILL.md
  gather/    SKILL.md
  schedule/  SKILL.md, rollout-template.md
  execute/   SKILL.md, wave-execute.workflow.js, subagent-prompt-template.md,
             scripts/{merge-wave.sh, reconcile-wave.py},
             tests/{prompt-invariants.test.mjs, reconcile-wave.test.sh, edit-noop-repro.workflow.js}
  status/    SKILL.md
  repair/    SKILL.md
```

Skills reference their own bundled files via `${CLAUDE_PLUGIN_ROOT}` so they relocate cleanly.

## Tests

```sh
node --check        skills/execute/wave-execute.workflow.js
bash -n             skills/execute/scripts/merge-wave.sh
bash                skills/execute/scripts/merge-wave.sh --self-test-classify
python3 -m py_compile skills/execute/scripts/reconcile-wave.py
bash                skills/execute/tests/reconcile-wave.test.sh
node                skills/execute/tests/prompt-invariants.test.mjs
```

`prompt-invariants.test.mjs` guards the **resume-cache invariant**: optional engine features must
render byte-identical Workflow `agent()` prompts when unset, or in-flight rollouts can't resume.

## Provenance

Born from a 2026-06-02 end-to-end giflab rollout (8 waves, 14 PRs). The findings ledger lives in
the Obsidian vault at `Work/Tasks/wave-execute-e2e-test-giflab`; the per-iteration narrative is in
`THREAD.md`.

## Coexistence with Orca

**wave** (autonomy) and **Orca** (https://www.onorca.dev/ — a GUI ADE / human-in-the-loop cockpit
for parallel agents) run in **separate lanes**: wave owns autonomous batch rollouts; Orca owns
supervised/exploratory work — babysitting one task, fan-N-agents-pick-winner (which wave
structurally can't do), design-mode, multi-provider. They share the same repos and the same
`.git/worktrees/` registry without colliding: wave's worktrees register via standard
`git worktree add`, and Orca auto-discovers them (`git worktree list`), classifies them `external`,
and shows them when external-worktree visibility is on. So Orca doubles as a **read-only window**
onto a running rollout's worktrees — free, no integration code, wave doesn't know Orca exists.

**Rules of the road:**

- **Observe, don't hand-edit** wave's worktrees mid-rollout. Repair a stuck rollout with
  `/wave:repair` (below); use Orca as the read-only window onto what it's doing.
- **Branch hygiene** — wave owns `audit-fix/*`; keep Orca hand-work on other branch names.
- **The reaper is structurally safe.** The 11am `daily-git-sweep` removes a worktree only when it
  is **clean AND merged**; in-flight worktrees, blocked tasks you're repairing, and anything with
  uncommitted edits are never touched. Don't `git worktree lock` one to "protect" it — the sweep
  unlocks any lock that doesn't name a live PID.

**Repair bridge — `/wave:repair` keeps merge authority.** When a rollout stalls (`/wave:execute`
reports `review-blocked` / `blocked` / `plan-blocked`, or a PR drifts), the systematic fix is
**`/wave:repair [[<slug>-rollout]]`**: Claude does the mechanics — reconcile drift, re-dispatch
agent-fixable blocks, dependency-aware-defer wedged ones — and asks you only the decisions no agent can
make. You supply *decisions*, not worktree edits. It resumes via `/wave:execute`, so `merge-wave.sh`
stays the sole merger and the cursor + smart-halt + file-set invariants never drift.

Orca's role is the **read-only window** — watch the blocked task's worktree/diff while `/wave:repair`
works. If you *do* choose to hand-edit a worktree in Orca instead, commit on the existing
`audit-fix/<alias>` branch, **push but never merge there**, then re-run `/wave:execute` (or
`/wave:repair`) to land it — wave still merges.
