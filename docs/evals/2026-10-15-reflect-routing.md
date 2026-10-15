# Behaviour evals — 2026-10-15, the reflect routing cases (p21-1)

Claude Code 2.1.299. The skills under test are those of `127ea53` on
`audit-fix/skill-p21-1-rename-retro-to-reflection` (the rename to `/thread:reflect`, ADR 0037 d2). Every run
used `--runs 3 --model opus --judge-model opus --ablation none --no-publish --threshold 0 --max-cost-usd 2
--trust-plugin`, with `--output-dir`, `--report` and `--json` pointed at a scratch directory outside the tree.
There was one invocation per case, because the CLI applies only the last `--case`. No case has an LLM grader,
so the judge model was never called. Total spend $1.49 against the task's 8 USD cap. The baseline for every
other case is `2026-10-15-release-3-1.md`.

## Runs

| # | started (UTC) | tree | command beyond the shared flags | cases | time | cost |
|---|---|---|---|---|---|---|
| 1 | 2026-10-15 06:33 | `127ea53` | `--case reflect-score-the-run` | 1 (3 runs) | 42 s | $0.43 |
| 2 | 2026-10-15 06:34 | `127ea53` | `--case status-how-is-it-doing --keep-temp` | 1 (3 runs) | 42 s | $0.82 |
| 3 | 2026-10-15 06:35 | `127ea53` | `--case companion-reflect-is-not-the-rollout --keep-temp` | 1 (3 runs) | 26 s | $0.25 |

Runs 2 and 3 added `--keep-temp` so the shadowing check below could read each run's trace. The flag costs
nothing.

## Scores

| suite | case | score | graders, each of the 3 runs |
|---|---|---|---|
| routing/rollout | reflect-score-the-run (new) | 1.00 | routes-to-reflect: 1 call; not-status: 0 calls |
| routing/rollout | status-how-is-it-doing (new) | 1.00 | routes-to-status: 1 call; not-reflect: 0 calls |
| routing/rollout | companion-reflect-is-not-the-rollout (new) | 1.00 | not-thread-reflect: 0 calls |

## Skill calls, per run

- **reflect-score-the-run** (runs 1 to 3 of invocation 1): each run made one Skill call matching
  `"skill":"thread:reflect"` and none naming status, so the Skill call itself was correct in every run. The
  CLI deletes traces unless `--keep-temp` is passed, so these counts come from `result.json`'s grader
  verdicts. They are 5, 6 and 5 turns at $0.14 each.
- **status-how-is-it-doing** (invocation 2): each run's only Skill call was
  `{"skill": "thread:status", "args": "[[palette-rollout-2026-09-23]]"}`, followed by Glob and Read on the
  rollout note. The Skill call was correct in every run.
- **companion-reflect-is-not-the-rollout** (invocation 3): no run made a Skill call. Each ran one Grep or Glob
  for a Companion record in its sandbox home, then answered that reviewing the Companion is Chorus's `/reflect`,
  which is not installed in the sandbox, and that `thread:reflect` is the wrong skill because its own
  description says so.

## Shadowing check

The 3.1.0 plugin installed in this account still carries the old verb. Kept traces exist for invocations 2 and 3,
and in every one the sandbox's init listing held one thread plugin: `thread@inline` at the task worktree. That
is the tree under test, at manifest version 3.1.0 because this change does not bump the version. The listing
showed `thread:reflect` and no old verb, and it held no user-level skills: neither the installed 3.1.0 cache
nor Chorus's `reflect` was visible. No `result.json` and no kept trace mentions the old verb. Outcome: no cache
shadowing, and every run's Skill call was correct.

Chorus's `reflect` is not in the sandbox, so the companion case tests only that `thread:reflect` does not fire
on a Companion prompt. The description's "Not for Chorus's Companion record" clause carries that, as the
three answers above show. The case cannot show Chorus's skill being chosen.

## Verify grep

The task's Verify grep (the old verb, or the old skill's `skills/` path, over the whole tree) gives 14 lines in
5 files, all history:

- `THREAD.md`: 7 lines, all dated history:
  - three in past Where we are entries (2026-10-13, 2026-10-09 and 2026-10-06);
  - two in What's been built / decided, one of them ADR 0037's naming decision itself;
  - two in superseded Resume instructions.
- `docs/e2e/2026-10-13-3-0-0.md`: 4.
- `docs/adr/0037-reflections-run-on-their-own-and-tune-for-hands-off-quality.md`: 1.
- `docs/evals/2026-10-10-release-3-0.md` and `docs/evals/2026-10-15-release-3-1.md`: 1 each.

There are no hits in skills/, tests/, evals/, README.md or .claude-plugin/. THREAD.md and docs/e2e are accepted
history residue beside the ADR and the eval records. The word-bounded noun grep gives 0 hits over skills/,
hooks/, evals/ and .claude-plugin/, and 1 in README.md: ADR 0032's title in the ADR list. This record leaves
out the old verb's literal, so it adds no hit.

## Tidy

`evals/results/` was empty before and after the three invocations, and `git status --porcelain --ignored`
was empty both times. Results, reports and JSON went to the scratch directory, and the kept trace directories
were removed after the check.
