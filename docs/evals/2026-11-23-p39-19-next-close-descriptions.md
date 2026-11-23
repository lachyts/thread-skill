# Behaviour evals — 2026-11-23, the next and close descriptions name the launch (p39-19)

Claude Code 2.1.330. The whole suite through `make evals` at `--runs 3`, once on the descriptions as master has
them (pre-edit) and once on the edited ones (post-edit). The edit names, in the `description:` of `skills/next/SKILL.md`
and `skills/close/SKILL.md`, that each verb can start a prepared rollout's lead (ADR 0072). The Makefile asks for a
scored baseline in docs/evals/ before any description changes, and no scored record covers the suite as it stands:
`2026-10-22-release-5-0.md` ran 24 cases at `--runs 1`, and six lifecycle cases were added after it. Two of them,
`next-clear-close-no-ask` and `next-sweep-keeps-open-confirm`, had never been scored in docs/evals, so their pre-edit
result here is their first baseline.

Every invocation went through `make evals`, so the recipe line's locks (`--ablation none --model opus --judge-model
opus --no-publish --keep-temp`) came last and held. Everything below was passed in `EVAL_ARGS` on the command line, and
no file in the tree gained a flag:

- `--runs 3 --max-cost-usd 45`: the CLI keeps a repeated option's last value, so these replace the recipe's `--runs 1
  --max-cost-usd 30` defaults. 45 USD is the per-invocation ceiling the approved plan set inside the task note's spend
  gate (`## Approved gates`, 2026-11-23: "cap 110 USD"). The CLI checks it before each launch, so an invocation's worst
  case is the ceiling plus up to three runs in flight, about 49 USD.
- `--trust-plugin`: an agent's `claude plugin eval` is refused in an untrusted directory without it (precedents:
  `2026-10-18-p19-5-description-trim.md`, `2026-11-06-next-starts-a-prepared-rollout.md`).
- `--concurrency 3`: 90 runs in sequence would take well over half an hour.
- `--output-dir`, `--report` and `--json` pointed at a `mktemp -d` scratch directory outside the tree.

## Runs

| # | side | started (UTC) | tree | cases | time | cost |
|---|---|---|---|---|---|---|
| 1 | pre-edit | 2026-11-23 07:43 | `07dcbfa` (origin/master), nothing modified or untracked | 30 of 30 (90 runs) | 954 s | $42.92 |

Invocation 1 ended `partial: false`, and every one of its 90 runs ended with `error: null` and
`skippedPaidGraders: false`, so every case is complete (3 runs, each scored on every grader) and the pre-edit side is
one invocation, with nothing to assemble. It cost 95% of its ceiling.

## Resolved model id

The result JSON records the requested alias only (`suite.modelOverride` and `suite.judgeModel`, both `opus`) and
`claudeVersion` 2.1.330. Each kept trace's `init` event records the case model: `claude-opus-5-5` in all 90 pre-edit
runs, and on all 657 of their assistant messages. Every sandbox's `init` listing loaded `thread` 5.0.0 as
`thread@inline` from the task worktree, the only thread plugin. The CLI does not capture the judge's resolved id.

## Descriptions

Lengths as `tests/contracts/manifest.test.mjs` parses them (the single-quoted value with `''` unescaped, counted in
UTF-16 code units). The other eleven descriptions are unchanged.

| skill | before | after |
|---|---|---|
| next | 507 | |
| close | 657 | |
| total | 7942 | |

## Scores

Per run, in run order. A routing case's score is the share of its Skill-call graders that passed; a judge grader
passes a run when at least 2 of its 3 votes are PASS.

| suite | case | pre-edit runs | pre-edit mean |
|---|---|---|---|
| lifecycle | close-deletes-consumed-keeps-legacy | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | close-launches-unstarted-rollout | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | close-pending-doc-owns-continuation | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | handoff-ends-with-next | 1.00 / 1.00 / 0.80 | 0.93 |
| lifecycle | handoff-manual-dry-run | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | handoff-router-dispatch-skips-next | 1.00 / 0.67 / 0.67 | 0.78 |
| lifecycle | next-clear-close-no-ask | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | next-launches-unstarted-rollout | 1.00 / 1.00 / 1.00 | 1.00 |
| lifecycle | next-sweep-keeps-open-confirm | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | close-work-finished | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | defer-to-friday | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | handoff-fork-now | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | handoff-note-for-a-person | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | long-context-is-not-a-handoff | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | next-undecided-what-now | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | orient-all-across-every-project | 1.00 / 1.00 / 1.00 | 1.00 |
| routing/continuity | orient-look-only-flag | 1.00 / 1.00 / 1.00 | 1.00 |
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

Pre-edit `aggregates.overallScore` 0.990, `overallPassRate` 0.967, 30 of 30 cases passed at `--threshold 0`.

The three sub-1.00 pre-edit runs, from their kept traces (the results keep each judge grader's vote tally, never its
rationale):

- `handoff-router-dispatch-skips-next` runs 2 and 3 failed `ends-on-the-handoff` (FAIL FAIL FAIL each). Each called
  `thread:next`, which decided the handoff in one line and showed the pending doc and the manual-handoff prompt, as the
  case asks. Each then ended on a line about this session: "When you've pasted it, you can end this session" (run 2),
  "You'd paste the prompt into a new session and archive this one when you're ready" (run 3). The grader fails a
  message that "says this session can be ended or archived".
- `handoff-ends-with-next` run 3 failed `parent-next` (FAIL FAIL FAIL). It called `thread:handoff`, printed the doc and
  the prompt in one message, then called `thread:next`, whose last message reads "Next move: keep going. You're fixing
  the README's Python 3.9 install line yourself in this session …" followed by a "Before the real run" list (a branch
  it read as `main`, three steps it could not run). Runs 1 and 2 ended on one message holding the doc, the prompt and
  the move. No rationale is kept, so which bullet the judge applied is not recorded.

## Spend

The CLI's cost for an invocation includes its judge calls.

| invocation | `costUsd` | running total | gate |
|---|---|---|---|
| 1 (pre-edit) | $42.92 | $42.92 | 110 USD |

The dearest single run was `execute-run-the-rollout`'s first, at $1.62. Before invocation 1 the total was $0 and its
worst case about $49. Invocation 2 may run only while the total plus 49 stays within 110: $42.92 + 49 = $91.92.

## Tidy

`git status --porcelain --ignored` was empty before and after invocation 1, and `evals/results/` never appeared.
Results, report and JSON went to the scratch directory. Invocation 1 started with no `/private/tmp/e-<id>` sandbox on
disk and left 90, exactly the `tracePath` set of its result JSON. The kept directories are read-only, so each was
made writable (`chmod -R u+rwx`) and removed by its literal path once the model ids and the sub-1.00 runs were read.

## Status

- **Pre-edit side recorded** before any description was changed: 30 of 30 cases complete at 3 runs, one invocation.
