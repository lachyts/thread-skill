# wave

A Claude Code plugin for running large, multi-PR changes as a **wave-by-wave convergence
rollout**. Two skills:

- **`/wave:plan`** — the *planner*. Reads a backlog of related Obsidian tasks under one project,
  computes wave structure from file-overlap + dependency analysis, auto-merges affine same-file
  task clusters, and writes a thin `<project-slug>-rollout.md` note (data only) with
  `protocol_version: 3` frontmatter + rollout-level config defaults.
- **`/wave:execute`** — the *executor*. Reads that rollout note, resolves per-task config, and
  hands the convergence work to a dynamic **Workflow** script. In continuous mode it auto-merges
  each wave before launching the next (zero-touch); `--gated` is the manual-merge escape hatch.

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

`/wave:plan <Project>` to build a rollout, then `/wave:execute [[<slug>-rollout]]` (or natural
language: `execute Wave 1 of [[<slug>-rollout]]`). The executor only runs `protocol_version: 3`
rollouts and prompts for regeneration via `/wave:plan --regenerate` on older notes.

## Layout

```
.claude-plugin/{plugin.json, marketplace.json}
skills/
  plan/      SKILL.md, rollout-template.md
  execute/   SKILL.md, wave-execute.workflow.js, subagent-prompt-template.md,
             scripts/{merge-wave.sh, reconcile-wave.py},
             tests/{prompt-invariants.test.mjs, reconcile-wave.test.sh, edit-noop-repro.workflow.js}
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
