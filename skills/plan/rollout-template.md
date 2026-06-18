---
tags:
  - task
  - rollout
status: open
priority: high
work_depth: shallow
projects:
  - "[[{{PROJECT_NAME}}]]"
contexts: []
scheduled: 
due: 
captured: {{DATE}}
protocol_version: 3
verifier: {{VERIFIER}}
max_iterations: 3
max_review_rounds: 4
max_plan_rounds: 3  # 2 was insufficient for cross-cutting plan-gates; 3-with-accumulated-feedback converges (wave:execute item 1)
plan_approval: scope-gated  # off | scope-gated | required
parallel_ceiling: 4
model: fable  # fable | opus — default for every task's agents; wave:plan stamps `model: opus` per-task on easy (single-file + shallow) tasks. Judges always run fable.
# env_bootstrap:   # optional: shell cmd wave:execute runs once per worktree before the verifier (e.g. poetry env use 3.11 && poetry install). Uncomment when the env needs setup — wave:plan step 2.7
merged_through_wave: 0  # wave:execute continuous-mode cursor: highest wave merged to main (0 = none yet)
# supersedes: "[[<prior-rollout-slug>]]"   # add only when --regenerate replaces an earlier rollout (see SKILL.md step 6)
---

## Notes

Parallel-rollout plan for landing the open backlog of `[[{{PROJECT_NAME}}]]` tasks. Each wave fans out across worktree-isolated subagents; the `/wave:execute` skill owns the dispatch + convergence contract.

Project root: `{{REPO_PATH}}`
{{THREAD_LINE}}

## How to execute

From any session:

```
execute Wave 1 of [[{{ROLLOUT_SLUG}}]]      # single wave
execute [[{{ROLLOUT_SLUG}}]]                # full-rollout continuous mode
execute [[{{ROLLOUT_SLUG}}]] --gated        # full-rollout, pause between waves
```

The contract lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` — three-layer convergence (plan-gate → Ralph-style agent-side verifier retry → master-side review-and-revise loop). The rollout-level defaults in this note's frontmatter (`verifier`, `max_iterations`, `max_review_rounds`, `plan_approval`, `max_plan_rounds`, `parallel_ceiling`, `model`) are inherited by every task; per-task overrides go in the task's own frontmatter.

`plan_approval: scope-gated` (the default) makes the plan-gate fire only for `scope: cross-cutting` tasks — single-file + read-only tasks skip it. Set to `off` for legacy behaviour (no plan-gate); `required` to gate every task. The plan-gate inserts one review round before Ralph: the subagent posts a structured plan under `## Plan (round N)` in the task note, the lead session reviews, and only after approval does the implementer phase begin.

## Wave structure

Tasks scheduled so that same-file tasks never share a wave (and dependencies follow their blockers). Within a wave, agents run in parallel via git worktree isolation. Between waves (single-wave mode), the previous wave's PRs must land first.

The table's **Mode** column reads `parallel` for tasks that fan out within a wave, `solo` for a cross-cutting task alone in its wave, and `sequential-merged (one agent/PR)` for a unit `/wave:plan` folded from an affine same-file cluster — one agent works its sub-tasks in sequence on one branch/PR.

{{WAVE_TABLE}}

### Why this order

{{WAVE_RATIONALE}}

## Resource budget

On Lachy's M3 96GB, the safe parallel ceiling is **3-4 agents per wave** when tasks load large models (e.g. LPIPS ≈ 500 MB / 30s startup). Light tasks (config edits, validation, small fixes) can fan wider.

**Two-layer convergence multiplies wall-clock, not memory.** Worst-case per task is `max_iterations × verifier-time × max_review_rounds`. With this rollout's defaults (3 × verifier × 4 review rounds), a 5-minute verifier means up to ~60 min per task in the worst case. Lower `max_review_rounds` per-rollout (here in frontmatter) or per-task if a wave is dominated by cross-cutting long-verifier work.

**Two costs the per-task budget above does NOT model — add them for deep cross-cutting waves:**
- **Plan-block re-dispatch.** A `scope: cross-cutting` task that exhausts `max_plan_rounds` halts and re-dispatches with the judge's feedback — a *full extra* plan→implement→review cycle. On the 2026-06-02 giflab run 3/3 cross-cutting tasks plan-blocked once each, then converged on the next round; budget those as elevated re-dispatch risk (this is why `max_plan_rounds` defaults to 3 for cross-cutting).
- **Serial merge into a `strict`-protected main (continuous mode only).** Merges can't be parallelised — each merge advances `main`, so the next PR must update-branch and re-run its required checks. Budget ≈ (update-branch + required-checks runtime + squash) per approved PR, **sequentially**, on top of the convergence time above.

If a wave has more tasks than the budget allows, the executor dispatches in two sub-batches within the same wave.

## Tasks by wave

{{TASKS_BY_WAVE}}

## File-sets

<!-- Machine-readable: wave:execute's continuous auto-merge reads this for the blocked-task smart-halt.
     Authored by wave:plan from the confirmed step-2 file-sets (unioned for merged units). One line per
     EDITING task; read-only tasks omitted. This is rollout-note data, NOT task-frontmatter `touches:`. -->

{{FILE_SETS}}

## Known baseline failures

<!-- Machine-readable: wave:execute threads this into every agent so they don't re-diagnose tests that
     already fail on a clean `main` for environmental reasons. The engine's green criterion shifts to "no
     NEW failures beyond this set" — it keeps running the full verifier and never --deselects them (that
     would hide a real regression). One line per failing test: `- <test_id> — <one-line reason>`. This is a
     point-in-time snapshot (no liveness guarantee); re-capture on --regenerate. Write `none` when clean
     `main` is fully green ⇒ wave:execute then behaves exactly as before (verifier exit 0 = pass). -->

{{KNOWN_BASELINE_FAILURES}}

## Post-rollout

When every wave's PRs have merged, run the **completion ceremony** (`/wave:execute` performs this as its final step in continuous mode — see its §4.5 step 5; do it manually if the run ended early or in gated/single-wave mode):

1. Mark this rollout `status: done` and stamp `completed: <YYYY-MM-DD>` in the frontmatter.
2. File any follow-on work (validation re-runs, audits, deferred items) as **new open tasks** in `Work/Tasks/` and rewrite the items below as thin pointers to them. Never leave live work as checklist prose inside a done note — the moment `status: done` lands, every Bases view filters this note out and the work goes invisible.
3. Append a `## Completion log`: dispatch dates, waves → PRs (links + merge dates), convergence stats (plan/review rounds per task), and the disposition of each post-rollout item.
4. Close out any associated thread (see `~/.claude/skills/thread/SKILL.md`) — or record here why it stays open.
5. Move this note to `Work/Tasks/Archive/Rollouts/` and commit the vault. Obsidian wikilinks resolve by filename, so `[[<slug>]]` references and the task notes' `rollout:` backlinks survive the move.

Rollout-specific items (audit re-runs etc.) go here:

{{POST_ROLLOUT_ITEMS}}
