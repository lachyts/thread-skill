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

- `--runs 3 --max-cost-usd 22` (run 1) and `--runs 3 --max-cost-usd 25` (run 2): the CLI keeps a repeated
  option's last value, so these replace the recipe's `--runs 1 --max-cost-usd 30` defaults. 22 USD is the
  per-run ceiling the plan set inside the task's 50 USD spend gate. Run 1 cost $20.75, 94% of it, so a
  second run at 22 could have aborted partial and left the comparison incomplete. Run 2's ceiling was 25:
  the CLI checks it before each launch, so an overrun is bounded by the up to three runs in flight (the
  dearest run 1 run was $0.85), which puts run 2's worst case near $27.6 and the task's total under the
  gate. The ceiling changes no score unless it is hit, and run 2 did not hit it ($19.77, `partial: false`).
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
| 2 | post-trim | 2026-10-18 08:15 | `14e7ee8` | `make evals EVAL_ARGS="--runs 3 --max-cost-usd 25 --trust-plugin --concurrency 3 --keep-temp --output-dir … --report … --json …"` | 23 of 23 (69 runs) | 1024 s | $19.77 |

Run 1's tree differs from `7c0e1c8` only in the contract test, which `claude plugin eval .` does not load:
the plugin's loaded surfaces (`skills/`, `hooks/`, `evals/`, `.claude-plugin/`) are those of `7c0e1c8`.
Run 2's tree was `14e7ee8` with nothing modified or untracked: from `7c0e1c8` it differs in the three trimmed
`description:` lines, the contract test and the run 1 record, so of the loaded surfaces only the three
descriptions changed. On both runs `partial: false`, and every run ended with `error: null` and
`skippedPaidGraders: false`. Run 2 took longer than run 1 under machine load (load average 36 at launch,
128 mid-run); no run errored or hit a case's `timeout_seconds`.

## Resolved model id

The 2.1.302 result JSON records the requested alias only (`suite.modelOverride` and `suite.judgeModel`,
both `opus`) and no resolved id. Each kept trace's `init` event records the case model: `claude-opus-5-5` in
all 69 pre-trim runs and in all 69 post-trim runs (and on every assistant message of the post-trim traces).
Both sides' result JSON reads `claudeVersion` 2.1.302. The CLI does not capture the judge's resolved id.

## Descriptions

Lengths as `tests/contracts/manifest.test.mjs` parses them (the single-quoted value with `''` unescaped,
counted in UTF-16 code units). Only these three were over 700; the other nine are unchanged.

| skill | before | after |
|---|---|---|
| close | 979 | 659 |
| handoff | 887 | 683 |
| reflect | 1066 | 664 |
| total | 8455 | 7529 |

`DESCRIPTION_TOTAL_RATCHET` goes 8600→7600.

## Scores

Per run, in run order. A routing case's score is the share of its Skill-call graders that passed. Δ mean is
the post-trim mean less the pre-trim mean.

| suite | case | pre-trim runs | pre-trim mean | post-trim runs | post-trim mean | Δ mean |
|---|---|---|---|---|---|---|
| lifecycle | close-deletes-consumed-keeps-legacy | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | close-pending-doc-owns-continuation | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | handoff-manual-dry-run | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | close-work-finished | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | defer-to-friday | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | handoff-fork-now | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | handoff-note-for-a-person | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | long-context-is-not-a-handoff | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | next-undecided-what-now | 1.00 / 0.50 / 1.00 | 0.83 | 0.50 / 1.00 / 1.00 | 0.83 | 0.00 |
| routing/continuity | orient-look-only-flag | 0.50 / 1.00 / 0.50 | 0.67 | 1.00 / 1.00 / 0.50 | 0.83 | +0.17 |
| routing/continuity | orient-project-after-time-away | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | stash-no-particular-day | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | companion-reflect-is-not-the-rollout | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | execute-run-the-rollout | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | reflect-score-the-run | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | reflect-the-week | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | repair-stuck-rollout | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | reshuffle-loose-tasks-into-roadmap | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | schedule-plan-the-waves | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | scoped-reshuffle-plan-into-tasks | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | status-how-is-it-doing | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/rollout | status-whats-left | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| smoke | open-resumes-thread | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |

Pre-trim `aggregates.overallScore` 0.978; post-trim 0.986 (`overallPassRate` 0.971, 23 of 23 cases passed
at `--threshold 0`). Every lifecycle judge vote was PASS on both sides (27 of 27 each).

The three sub-1.00 pre-trim runs, from their kept traces:

- `next-undecided-what-now` run 2 called `thread:stash` instead of `thread:next` (`routes-to-next` failed,
  `not-orient` passed).
- `orient-look-only-flag` runs 1 and 3 called no skill: each searched the sandbox for the Palette project
  with Glob and Grep, found nothing and said so (`routes-to-orient` failed, `not-next` passed).

Neither case's skill (next, orient) is one this task trims, so these are the pre-trim side's own routing
variance.

The two sub-1.00 post-trim runs, from their kept traces:

- `next-undecided-what-now` run 1 called `thread:defer` instead of `thread:next` (`routes-to-next` failed,
  `not-orient` passed). It made the call itself in its first message ("My call is to defer it to tomorrow",
  since the tests were green and two call sites were left) and invoked `thread:defer` with "tomorrow",
  rather than handing the undecided moment to the router. The pre-trim miss on this case was the same shape
  with `thread:stash`.
- `orient-look-only-flag` run 3 called no skill (`routes-to-orient` failed, `not-next` passed). It declined
  `thread:orient` in its first message ("since that skill re-sorts and writes tasks"), searched the sandbox
  for Palette with Glob and Grep, found nothing and said so. This is the pre-trim misses' shape, and the
  reason it gave paraphrases orient's own description, which this task did not change.

Neither misroute went to a trimmed skill, and neither case's target (next, orient) or the skill picked
instead (defer, none) is one this task trims.

## Spend

The CLI's cost for a run includes its judge calls.

| run | `costUsd` | running total | gate |
|---|---|---|---|
| 1 (pre-trim) | $20.75 | $20.75 | 50 USD |
| 2 (post-trim) | $19.77 | $40.52 | 50 USD |

The dearest single run in run 1 was `execute-run-the-rollout`'s third, at $0.85; in run 2 it was the same
case's third, at $0.79. No case was re-run.

## Tidy

`git status --porcelain --ignored` was the same before and after run 1 (the contract-test edit only), and
`evals/results/` never appeared. Results, report and JSON went to the scratch directory. `--keep-temp` left
69 sandboxes, one per run, each under `/private/tmp/e-<id>`; all 69 were removed after the model id and the
sub-1.00 runs were read.

Run 2 started with no `/private/tmp/e-<id>` sandbox on disk and left 69, exactly the `tracePath` set of its
result JSON. `git status --porcelain --ignored` was empty before and after it, and `evals/results/` never
appeared. All 69 sandboxes were removed one path at a time after the model ids and the sub-1.00 runs were
read, and the scratch directory was removed with them.

## Status

- **Pre-trim side recorded** before any description was trimmed.
- **No case dropped below its pre-trim mean.** 21 of 23 cases scored 1.00 in all six runs.
  `next-undecided-what-now` held at 0.83 (one miss on each side, to a different sibling: stash pre-trim,
  defer post-trim) and `orient-look-only-flag` went from 0.67 to 0.83 (one no-skill run instead of two).
  At three runs per case a one-run difference is inside the variance both sides show, so this reads as the
  trim costing no routing, not as the trim improving orient.
- **The cases that measure the trimmed skills held 1.00 in every run on both sides:** close
  (`close-work-finished`, the two close lifecycle cases), handoff (`handoff-fork-now`,
  `handoff-note-for-a-person`, `long-context-is-not-a-handoff`, `handoff-manual-dry-run`) and reflect
  (`reflect-score-the-run`, `reflect-the-week`, `companion-reflect-is-not-the-rollout`). No routing clause
  was restored and no case was re-run.
- **Like for like:** both sides ran Claude Code 2.1.302 with `claude-opus-5-5` as the case model in every
  run, the same cases, runs and flags, except the cost ceiling (22 against 25), which neither run hit.
  Run 2 ran under heavier machine load, which slowed it (1024 s against 636 s) and caused no error or
  timeout.
