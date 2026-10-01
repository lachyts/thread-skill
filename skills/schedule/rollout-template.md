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
# saved as: <slug>-rollout-<YYYY-MM-DD>.md — always dated (a 2nd same-day rollout gets a -N suffix); legacy undated <slug>-rollout notes keep their names, the rollout readers resolve both. See schedule SKILL.md step 6.
protocol_version: 5
verifier: {{VERIFIER}}
max_iterations: 3
max_review_rounds: 4
max_plan_rounds: 3  # 2 was insufficient for cross-cutting plan-gates; 3-with-accumulated-feedback converges (thread:execute item 1)
plan_approval: scope-gated  # off | scope-gated | required
parallel_ceiling: 4
model: opus  # opus | fable — default (mechanical execution). thread:schedule stamps `model: fable` on structural (cross-cutting) or deep tasks; a fable task runs end-to-end incl. its judges.
# max_tier: opus   # optional CEILING. `opus` is the ONLY value that caps anything — `fable` is the
#             uncapped default, so `max_tier: fable` is a no-op. Set it ONLY when the fable quota is
#             exhausted, never as a cost preference. It clamps the seed, suppresses escalation (a capped
#             tier is terminal, so it runs the FULL loop at the higher tier's effort) and clamps a
#             judgeModel pin. Uncomment the line AS WRITTEN, with the value: a bare `max_tier:` parses
#             as null, which reads as ABSENT and runs UNCAPPED with no warning line. Omit ⇒
#             byte-identical to an uncapped run. ADR 0016; execute SKILL.md § "3. Resolve effective
#             config per task".
# env_bootstrap:   # optional: shell cmd thread:execute runs once per worktree before the verifier (e.g. poetry env use 3.11 && poetry install). Uncomment when the env needs setup — thread:schedule step 2.7
# No rollout cursor: progress lives on the task notes' started:/merged: stamps (ADR 0030; reconcile-rollout.py).
# supersedes: "[[<prior-rollout-slug>]]"   # add only when § 0 printed `supersede` (see SKILL.md steps 6 and 7.5)
---

## Notes

Parallel-rollout plan for landing the open backlog of `[[{{PROJECT_NAME}}]]` tasks, run as a queue: up to `parallel_ceiling` tasks at once, each in its own worktree-isolated subagent; the `/thread:execute` skill owns the dispatch + convergence contract.

Project root: `{{REPO_PATH}}`
{{THREAD_LINE}}

## How to execute

From any session:

```
execute [[{{ROLLOUT_SLUG}}]]                # continuous: the queue runs and merges to the end
execute [[{{ROLLOUT_SLUG}}]] --gated        # pause for a human before each merge
```

The contract lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` — three-layer convergence (plan-gate → Ralph-style agent-side verifier retry → master-side review-and-revise loop). The rollout-level defaults in this note's frontmatter (`verifier`, `max_iterations`, `max_review_rounds`, `plan_approval`, `max_plan_rounds`, `parallel_ceiling`, `model`) are inherited by every task; per-task overrides go in the task's own frontmatter.

`plan_approval: scope-gated` (the default) makes the plan-gate fire only for `scope: cross-cutting` tasks — single-file + read-only tasks skip it. Set to `off` for legacy behaviour (no plan-gate); `required` to gate every task. The plan-gate inserts one review round before Ralph: the subagent posts a structured plan under `## Plan (round N)` in the task note, the lead session reviews, and only after approval does the implementer phase begin.

## Queue

Tasks run in parallel up to `parallel_ceiling`, each branching from the `main` of its start; only a dependency (`depends-on:`/`blocked-by:`) or a Solo task holds one back, never a shared file. Every approved task goes through Integration (the latest `main` merged in, the verifier re-run) before its merge. When a slot frees, the next task is chosen by `priority:`, then least file overlap with what is running (`## File-sets`), then its row order here: the row is the task's schedule rank.

The table's **Mode** column reads `solo` for a Solo task (nothing new starts beside it until it merges or is set aside), `sequential-merged (one agent/PR)` for a unit `/thread:schedule` folded from an affine same-file cluster (one agent works its sub-tasks in sequence on one branch/PR), `carried (<queue state>)` for a task carried from the rollout this one supersedes, and `—` for every other task.

{{QUEUE_TABLE}}

### Why this order

{{QUEUE_RATIONALE}}

## Resource budget

On Lachy's M3 96GB, the safe parallel ceiling is **3-4 agents at once (`parallel_ceiling`)** when tasks load large models (e.g. LPIPS ≈ 500 MB / 30s startup). Light tasks (config edits, validation, small fixes) can fan wider.

**Two-layer convergence multiplies wall-clock, not memory.** Worst-case per task is `max_iterations × verifier-time × max_review_rounds`. With this rollout's defaults (3 × verifier × 4 review rounds), a 5-minute verifier means up to ~60 min per task in the worst case. Lower `max_review_rounds` per-rollout (here in frontmatter) or per-task if the queue is dominated by cross-cutting long-verifier work. **Under `max_tier` the implement layer costs more, not less**: the capped first pass is terminal so it spends the full `max_iterations`, and the same-tier retry then spends a fixed 2 more — exactly `max_iterations + 2` against an uncapped run's `1 + max_iterations`, i.e. one extra iteration at every setting. Note this covers the IMPLEMENT layer only: each review-loop reviser renders its own full `max_iterations` Ralph loop regardless of the cap, so a capped task that only converges at the review ceiling costs `max_iterations + 2 + (max_review_rounds − 1) × max_iterations`. Budget a capped task from that, not from the headline formula.

**Two costs the per-task budget above does NOT model — add them for deep cross-cutting tasks:**
- **Plan-block re-dispatch.** A `scope: cross-cutting` task that exhausts `max_plan_rounds` is set aside and re-dispatches with the judge's feedback — a *full extra* plan→implement→review cycle. On the 2026-06-02 giflab run 3/3 cross-cutting tasks plan-blocked once each, then converged on the next round; budget those as elevated re-dispatch risk (this is why `max_plan_rounds` defaults to 3 for cross-cutting).
- **Serial Integration (continuous mode).** Integrations run one at a time: each merges the latest `main` in, re-runs the verifier unless `main` has not moved, and re-reviews when needed. Budget ≈ (merge-in + verifier + any re-review + squash) per approved task, **sequentially**, on top of the convergence time above.

## File-sets

<!-- Machine-readable: `reconcile-rollout.py next` reads this block for its overlap tiebreak (a freed slot goes
     to the task with the least file overlap with what is running). Best-effort, from thread:schedule step 2
     (`touches:` or the paths the task body names, unioned for merged units); nothing halts on it. One line per
     EDITING task, `- <slug>: a, b`; read-only tasks omitted. This is rollout-note data, NOT task-frontmatter
     `touches:`. -->

{{FILE_SETS}}

## Known baseline failures

<!-- Machine-readable: thread:execute threads this into every agent so they don't re-diagnose tests that
     already fail on a clean `main` for environmental reasons. The engine's green criterion shifts to "no
     NEW failures beyond this set" — it keeps running the full verifier and never --deselects them (that
     would hide a real regression). One line per failing test: `- <test_id> — <one-line reason>`. This is a
     point-in-time snapshot (no liveness guarantee); re-capture on --regenerate. Write `none` when clean
     `main` is fully green ⇒ thread:execute then behaves exactly as before (verifier exit 0 = pass). -->

{{KNOWN_BASELINE_FAILURES}}

## Post-rollout

When every task has merged, run the **completion ceremony** (`/thread:execute` performs this as its final step in continuous mode — see its §4.5 step 5; do it manually if the run ended early or in gated mode):

1. Close the phases this rollout finished (ADR 0026): run the `touched-phases` → `reconcile-project.py <line> --kinds phase --apply` commands from execute §4.5 step 5, one reconcile-project run per line `touched-phases` prints, and record each touched phase as closed, already closed (its phase note already reads `status: done`), ambiguous, failed (including every phase on a line that exited 2 or crashed) or left open in the Completion log. On a non-zero exit from either command, file (or append to) the follow-on open task `Work/Tasks/phase-close-followup-<rollout-slug>.md` (`close phase <slug>-pN: <command> exited <code>: <msg>`), with the re-run command pointing `--rollout` at the post-move path `Work/Tasks/Archive/Rollouts/<rollout-slug>.md`, and carry on; a failure it already lists gets a `still failing <date>` annotation in place, never a second line. On a later re-run, mark each line resolved once its failure clears and, once every line is resolved, set it done.
2. Mark this rollout `status: done` and stamp `completed: <YYYY-MM-DD>` in the frontmatter.
3. File any follow-on work (validation re-runs, audits, deferred items) as **new open tasks** in `Work/Tasks/` and rewrite the items below as thin pointers to them. Never leave live work as checklist prose inside a done note — the moment `status: done` lands, every Bases view filters this note out and the work goes invisible.
4. Append a `## Completion log`: dispatch dates, tasks → PRs (links + merge dates), convergence stats (plan/review rounds per task), phase closure, and the disposition of each post-rollout item.
5. Close out any associated thread (run `/thread:close`) — or record here why it stays open.
6. Move this note to `Work/Tasks/Archive/Rollouts/` and commit the vault. Obsidian wikilinks resolve by filename, so `[[<slug>]]` references and the task notes' `rollout:` backlinks survive the move.

Rollout-specific items (audit re-runs etc.) go here:

{{POST_ROLLOUT_ITEMS}}
