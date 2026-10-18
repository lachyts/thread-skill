# Behaviour evals — 2026-10-18, the description trim at 3 runs (p19-5)

Claude Code 2.1.302. Two runs of the whole suite through `make evals`, one on the untrimmed descriptions
(pre-trim) and one on the trimmed ones (post-trim), in the configuration of the approved baseline
`2026-10-16-release-4-0.md` but at `--runs 3`. Every case and every LLM grader ran on the `opus` alias, and
the manifest read 4.0.0 in every sandbox's init listing (`thread@inline` at the task worktree, the only
thread plugin). The previous scored record of the whole suite is `2026-10-16-release-4-0.md` (one run per
case, every case 1.00). Its lifecycle fixtures changed after it (`2026-10-17-close-lifecycle-fixtures.md`),
so this task runs its own pre-trim side rather than comparing against it.

Both runs went through `make evals`, so the recipe line's locks (`--ablation none --model opus --judge-model
opus --no-publish`) came last and held. Everything below was passed in `EVAL_ARGS` on the command line, and
no file in the tree gained a flag:

- `--runs 3 --max-cost-usd 22`: the CLI keeps a repeated option's last value, so these replace the recipe's
  `--runs 1 --max-cost-usd 30` defaults. 22 USD is the per-run ceiling the plan set inside the task's 50 USD
  spend gate.
- `--trust-plugin`: an agent's `claude plugin eval` is refused in an untrusted directory without it. The
  precedents are `2026-10-15-reflect-routing.md` and `2026-10-17-handoff-manual-dry-run.md`.
- `--concurrency 3`: 69 runs in sequence would take about half an hour.
- `--keep-temp`: the result JSON records the requested alias only, so the resolved model id had to come from
  each run's kept trace.
- `--output-dir`, `--report` and `--json` pointed at a scratch directory outside the tree.

## Runs

| # | side | started (UTC) | tree | command | cases | time | cost |
|---|---|---|---|---|---|---|---|
| 1 | pre-trim | 2026-10-18 01:39 | `7c0e1c8` + the working-tree edit to `tests/contracts/manifest.test.mjs`; skills as `7c0e1c8` | `make evals EVAL_ARGS="--runs 3 --max-cost-usd 22 --trust-plugin --concurrency 3 --keep-temp --output-dir … --report … --json …"` | 23 of 23 (69 runs) | 636 s | $20.75 |

Run 1's tree differs from `7c0e1c8` only in the contract test, which `claude plugin eval .` does not load:
the plugin's loaded surfaces (`skills/`, `hooks/`, `evals/`, `.claude-plugin/`) are those of `7c0e1c8`.
`partial: false`, and every run ended with `error: null` and `skippedPaidGraders: false`.

## Resolved model id

The 2.1.302 result JSON records the requested alias only (`suite.modelOverride` and `suite.judgeModel`,
both `opus`) and no resolved id. Each kept trace's `init` event records the case model: `claude-opus-5-5` in
all 69 pre-trim runs. The CLI does not capture the judge's resolved id.

## Scores

Per run, in run order. A routing case's score is the share of its Skill-call graders that passed.

| suite | case | pre-trim runs | pre-trim mean |
|---|---|---|---|
| lifecycle | close-deletes-consumed-keeps-legacy | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | close-pending-doc-owns-continuation | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | handoff-manual-dry-run | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | close-work-finished | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | defer-to-friday | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | handoff-fork-now | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | handoff-note-for-a-person | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | long-context-is-not-a-handoff | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | next-undecided-what-now | 1.00 / 0.50 / 1.00 | 0.83 |
| routing/continuity | orient-look-only-flag | 0.50 / 1.00 / 0.50 | 0.67 |
| routing/continuity | orient-project-after-time-away | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | stash-no-particular-day | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | companion-reflect-is-not-the-rollout | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | execute-run-the-rollout | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | reflect-score-the-run | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | reflect-the-week | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | repair-stuck-rollout | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | reshuffle-loose-tasks-into-roadmap | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | schedule-plan-the-waves | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | scoped-reshuffle-plan-into-tasks | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | status-how-is-it-doing | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/rollout | status-whats-left | 1.00 / 1.00 / 1.00 | 1.00 |
| smoke | open-resumes-thread | 1.00 / 1.00 / 1.00 | 1.00 |

Pre-trim `aggregates.overallScore` 0.978. Every lifecycle judge vote was PASS (27 of 27).

The three sub-1.00 pre-trim runs, from their kept traces:

- `next-undecided-what-now` run 2 called `thread:stash` instead of `thread:next` (`routes-to-next` failed,
  `not-orient` passed).
- `orient-look-only-flag` runs 1 and 3 called no skill: each searched the sandbox for the Palette project
  with Glob and Grep, found nothing and said so (`routes-to-orient` failed, `not-next` passed).

Neither case's skill (next, orient) is one this task trims, so these are the pre-trim side's own routing
variance.

## Spend

The CLI's cost for a run includes its judge calls.

| run | `costUsd` | running total | gate |
|---|---|---|---|
| 1 (pre-trim) | $20.75 | $20.75 | 50 USD |

The dearest single run in run 1 was `execute-run-the-rollout`'s third, at $0.85.

## Tidy

`git status --porcelain --ignored` was the same before and after run 1 (the contract-test edit only), and
`evals/results/` never appeared. Results, report and JSON went to the scratch directory. `--keep-temp` left
69 sandboxes, one per run, each under `/private/tmp/e-<id>`; all 69 were removed after the model id and the
sub-1.00 runs were read.

## Status

- **Pre-trim side recorded** before any description was trimmed.
