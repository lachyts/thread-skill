---
tags:
  - task
  - rollout
status: open
incomplete: true  # every rollout note is born with this; /thread:schedule step 7 removes it as its last write, once every task is stamped. Until then reconcile-rollout.py next refuses the note (SKILL.md steps 6-7).
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
max_iterations: {{MAX_ITERATIONS}}
max_review_rounds: {{MAX_REVIEW_ROUNDS}}
max_plan_rounds: {{MAX_PLAN_ROUNDS}}  # 2 was insufficient for cross-cutting plan-gates; 3-with-accumulated-feedback converges (thread:execute item 1)
plan_approval: scope-gated  # off | scope-gated | required
parallel_ceiling: {{PARALLEL_CEILING}}
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

The contract lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` — three-layer convergence (plan-gate → Ralph-style agent-side verifier retry → master-side review-and-revise loop). The rollout-level defaults in this note's frontmatter (`verifier`, `max_iterations`, `max_review_rounds`, `plan_approval`, `max_plan_rounds`, `parallel_ceiling`) are inherited by every task; per-task overrides go in the task's own frontmatter.

`plan_approval: scope-gated` (the default) makes the plan-gate fire only for `scope: cross-cutting` tasks — single-file + read-only tasks skip it. Set to `off` for legacy behaviour (no plan-gate); `required` to gate every task. The plan-gate inserts one review round before Ralph: the planner returns a structured plan and an autonomous plan judge approves it or sends it back, up to `max_plan_rounds`; only an approved plan reaches the implementer.

## Queue

Tasks run in parallel up to `parallel_ceiling`, each branching from the `main` of its start; only a dependency (`depends-on:`/`blocked-by:`) or a Solo task holds one back, never a shared file. Every approved task goes through Integration (the latest `main` merged in, the verifier re-run) before its merge. When a slot frees, the next task is chosen by `priority:`, then least file overlap with what is running (`## File-sets`), then its row order here: the row is the task's schedule rank. A queued Solo task whose dependencies are met holds every task whose row is below it, whatever its `priority:`.

The table's **Mode** column reads `solo` for a Solo task (nothing new starts beside it until it merges or is set aside), `sequential-merged (one agent/PR)` for a unit `/thread:schedule` folded from an affine same-file cluster (one agent works its sub-tasks in sequence on one branch/PR), `carried (<queue state>)` for a task carried from the rollout this one supersedes, and `—` for every other task.

{{QUEUE_TABLE}}

### Why this order

{{QUEUE_RATIONALE}}

## Resource budget

`parallel_ceiling` is the value `/thread:schedule` step 2.8 resolved from the operator's `~/.config/thread/rollouts.toml` (its `[repo."owner/name"]` table for this repo, then `[defaults]`), or the built-in 4 when the file sets none; the figure is a Retro output (ADR 0032), so a Retro (`/thread:retro [[<rollout-slug>]]`) proposes changes to the file rather than this note being edited by feel. The Workflow tool's agent cap (10 on the M2 Max, 12 cores) limits the agents inside one call; `parallel_ceiling` counts concurrent task calls, each its own Workflow call, so that cap does not bound it. How many calls can safely run at once is still open: ADR 0032 leaves it to the first Retro. Tasks that load large models (e.g. LPIPS ≈ 500 MB / 30s startup) still argue for a lower ceiling; light tasks (config edits, validation, small fixes) can fan wider.

**Two-layer convergence multiplies wall-clock, not memory.** Worst-case per task is `max_iterations × verifier-time × max_review_rounds`. With the built-in values (`max_iterations` 3 × verifier × `max_review_rounds` 4; this note's frontmatter holds the values this rollout resolved), a 5-minute verifier means up to ~60 min per task in the worst case. Lower `max_review_rounds` per-rollout (here in frontmatter) or per-task if the queue is dominated by cross-cutting long-verifier work. **A task whose implement stage starts on the ladder's top rung costs more there, not less**: its first pass on the top rung is terminal, so it runs the full `max_iterations`, and the same-rung retry then adds a fixed 2 (the engine's `CAPPED_RETRY_ITERATIONS`). That task (one stamped `rung:` at the top, or one whose plan stage already climbed it there) spends `max_iterations + 2` on implement, against `1 + max_iterations` for a task that climbs to the top during implement (one one-shot pass below, then the full loop). Note this covers the IMPLEMENT layer only: each review-loop reviser runs its own full `max_iterations` Ralph loop on any rung, so a top-rung-start task that only converges at the review ceiling costs `max_iterations + 2 + (max_review_rounds − 1) × max_iterations`. Budget such a task from that, not from the headline formula.

**Two costs the per-task budget above does NOT model — add them for deep cross-cutting tasks:**
- **Plan-block re-dispatch.** A `scope: cross-cutting` task that exhausts `max_plan_rounds` is set aside and re-dispatches with the judge's feedback — a *full extra* plan→implement→review cycle. On the 2026-06-02 giflab run 3/3 cross-cutting tasks plan-blocked once each, then converged on the next round; budget those as elevated re-dispatch risk (this is why the built-in `max_plan_rounds` is 3, and why a rollout heavy in cross-cutting tasks keeps it ≥ 3).
- **Serial Integration (continuous mode).** Integrations run one at a time: each merges the latest `main` in, re-runs the verifier unless `main` has not moved, re-reviews when needed, and waits on the PR's required checks before the squash. Budget ≈ (merge-in + verifier + any re-review + required checks + squash) per approved task, **sequentially**, on top of the convergence time above.

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
4. Append a `## Completion log`: dispatch dates, tasks → PRs (links + merge dates), convergence stats (plan/review rounds per task), phase closure, the disposition of each post-rollout item, and the Retro line `Retro: offered as /thread:retro [[<rollout-slug>]], not run (a Retro needs Lachy's picks, so the ceremony never runs one, attended or not)`. Then offer it in chat: `Retro: /thread:retro [[<rollout-slug>]]`.
5. Close out any associated thread (run `/thread:close`) — or record here why it stays open.
6. Move this note to `Work/Tasks/Archive/Rollouts/` and commit the vault. Obsidian wikilinks resolve by filename, so `[[<slug>]]` references and the task notes' `rollout:` backlinks survive the move.

Rollout-specific items (audit re-runs etc.) go here:

{{POST_ROLLOUT_ITEMS}}
