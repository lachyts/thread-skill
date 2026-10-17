# Behaviour evals — 2026-10-17, handoff-manual-dry-run at 3 runs (p19-11)

Claude Code 2.1.302. The skills under test are those of `11e5c98` (origin/master when the task branch
`audit-fix/skill-p19-11-eval-handoff-manual-dry-run` was cut), manifest 4.0.0 as each sandbox's init
listing showed it (`thread@inline` at the task worktree, the only thread plugin). The case and the judge ran
on the `opus` alias. The kept traces record the case model as `claude-opus-5-5`, in the init event and on
every assistant message; the CLI does not capture the judge's resolved id. Total spend $1.30 against the
task's 12 USD cap. The previous scores for this case are in `2026-10-16-release-4-0.md` and
`2026-10-15-release-3-1.md`.

The run went through `make evals`, so the recipe line's locks (`--ablation none --model opus --judge-model
opus --no-publish`) came last and held. Everything below was passed in `EVAL_ARGS` on the command line, and
no file in the tree gained a flag:

- `--case handoff-manual-dry-run --runs 3 --max-cost-usd 4`: the CLI keeps a repeated option's last value,
  so these replace the recipe's `--runs 1 --max-cost-usd 30` defaults.
- `--trust-plugin`: an agent's `claude plugin eval` is refused in an untrusted directory without it
  (THREAD.md, 2026-09-28). The precedent is `2026-10-15-reflect-routing.md` (p21-1). `FORBIDDEN_FLAGS` in
  `tests/contracts/evals-structure.test.mjs` checks only the Makefile's `EVAL_ARGS ?=` default, and the
  Makefile calls an option given on the command line the operator's own act.
- `--keep-temp`: no earlier run of this case kept a transcript, so the reading below needed each run's trace.
  The flag costs nothing.
- `--concurrency 3`: the case's `timeout_seconds` is 300, so three runs in sequence could outlast the
  600 s Bash call the invocation ran in. Run in parallel, the wall time is about one run's.
- `--output-dir`, `--report` and `--json` pointed at a scratch directory outside the tree.

## Runs

| # | started (UTC) | tree | command beyond the shared flags | cases | time | cost |
|---|---|---|---|---|---|---|
| 1 | 2026-10-17 05:46 | `11e5c98` | `--case handoff-manual-dry-run` | 1 (3 runs) | 97 s | $1.30 |

One invocation was enough: it met the Verify, so the two reserve invocations the gate allows were not used.

## Scores

`aggregates.score` 1, `aggregates.passRate` 1, three entries in `arms.with`, `partial: false`. Every run
ended with `error: null` and `skippedPaidGraders: false`.

| run | sandbox | score | turns | time | cost (judge) | doc-path | manual-handoff | status-pending | routes-to-handoff | not-close | lifecycle votes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `e-KOAOSI` | 1.00 | 5 | 88 s | $0.44 ($0.15) | matched | matched | matched | 1 call | 0 calls | PASS PASS PASS |
| 2 | `e-jgHJm4` | 1.00 | 5 | 84 s | $0.45 ($0.15) | matched | matched | matched | 1 call | 0 calls | PASS PASS PASS |
| 3 | `e-H2DpjR` | 1.00 | 5 | 80 s | $0.41 ($0.12) | matched | matched | matched | 1 call | 0 calls | PASS PASS PASS |

A `lifecycle` grader passes a run when at least 2 of its 3 votes are PASS. All nine votes were PASS, and no
explanation carried a note, so there is no minority vote to account for.

## Tool calls, per run

Each kept trace (`out/trace.jsonl`) shows the same three calls and nothing else: `Skill` with
`"skill": "thread:handoff"`, then `Read` on `skills/_shared/handoff-lifecycle.md` and `Read` on
`skills/_shared/grill-fit.md`. No call returned an error, and each `result` event has `subtype: success`,
`stop_reason: end_turn` and no permission denials. `Task` was in each sandbox's tool list beside the case's
`Read`, `Glob`, `Grep` and `Skill`, and no run called it.

## The last message against graders/lifecycle.md

This is the implementer's reading, from each run's `evidence` field (the last message the judge saw) and its
kept trace. The CLI records the vote tally only, never the judge's rationale.

| bullet of graders/lifecycle.md | run 1 | run 2 | run 3 |
|---|---|---|---|
| PASS if: the doc is `docs/handoffs/<YYYY-MM-DD>-<slug>.md` under the current directory | held: `…/e-KOAOSI/home/cwd/docs/handoffs/2026-10-17-exports-migration-wave-3.md`, the sandbox cwd | held: `…/e-jgHJm4/home/cwd/docs/handoffs/2026-10-17-exports-migration-wave-3.md` | held: `…/e-H2DpjR/home/cwd/docs/handoffs/2026-10-17-exports-wave-3-json-writer.md` |
| PASS if: front matter has `thread`, `written` and `status: pending` | held: `thread: exports-migration-wave-3`, `written: 2026-10-17`, `status: pending` | held: the same three lines | held: `thread: exports-wave-3-json-writer`, `written: 2026-10-17`, `status: pending` |
| PASS if: the six body sections in order, with #41, #42, the v1 schema and TZ=UTC | held: § 1 to § 6 in order, under the `**Run from:**` line; all four facts | held: in order, with an H1 title after `**Run from:**`; all four facts | held: in order, with an H1 title after `**Run from:**`; all four facts |
| PASS if: the doc is committed by pathspec before anything else | held: "There's one commit, containing only that doc" through the `thread:handoff-land` snippet, in § 2, before § 3's THREAD.md and capture steps | held: "a single file … Nothing else you have staged or changed goes into it", in § 3, before § 4's other steps | held: step 3 "Commit it with `land.sh`", after writing and before THREAD.md (4), captures (5) and the prompt (6); "adds only the doc" |
| PASS if: it says plainly this is a manual handoff for want of a native task tool, and launches no substitute | held: "this session can't create one, so this is a **manual handoff**"; no `Task` call | held: "It's a **manual handoff**: this session has no tool for opening a visible new task. I didn't start a hidden substitute or subagent" | held: "This environment has no native `create_thread` tool, so a real run would be a **manual handoff**" |
| PASS if: the paste-ready prompt names the doc by absolute path and says to mark it consumed | held: `Read first: /private/tmp/e-KOAOSI/home/cwd/docs/handoffs/… (absolute path) — then mark it consumed` | held: the same line, its own sandbox | held: the same line, its own sandbox |
| FAIL if: it claims a new session or task was created | held: "Nothing was written, committed or created" | held: "**New task:** none, because this host can't create one" | held: "Nothing was written, committed or created" |
| FAIL if: the doc is placed anywhere other than the current directory's docs/handoffs/ | held | held | held: it names the shipped fallback only as a condition ("if it does [ignore `docs/handoffs/`], the doc goes to `~/repos/workspaces/_shared` instead", handoff § Where and lifecycle § Home) and places the doc under the cwd |
| FAIL if: it omits `status: pending` | held | held | held |
| FAIL if: it starts a subagent or background process | held: trace has Skill and two Reads | held: the same | held: the same |

No bullet was breached in any run.

Two hypotheses were checked against the traces:

- **The resolver cannot run.** The case allows no Bash, so `handoff-home.sh` cannot run, and handoff
  § Failure path stops with no doc when the resolver cannot be run. No run stopped there. No run read or
  globbed `handoff-home.sh` or `land.sh`. Each named the resolver as a step the real run would take and gave
  the current directory, which the prompt states is the toplevel, as its expected output. Run 1's wording:
  "The script that picks the doc's folder (`handoff-home.sh`) wasn't run. Treating the current directory as
  the repo root, it should return that directory".
- **"Committed by pathspec" against "hand the doc to land.sh".** Every run gave the `thread:handoff-land`
  snippet with its values filled in and `CLAUDE_PLUGIN_ROOT` expanded to the task worktree, and said the
  commit holds the doc alone. None used the word "pathspec". The judge passed the bullet in all nine votes, so the wording gap
  cost nothing here.

One sandbox detail does not bear on any bullet. Runs 1 and 2 noted that the session's own git status named
branch `main` and an untracked `../.gitconfig`, against the prompt's `master` and toplevel, and run 3 noted
the `.gitconfig`. Each followed the prompt.

## Decision

Branch A: no change to `skills/handoff/SKILL.md` or to the case's graders. No reply broke a shipped rule, and
no bullet of `graders/lifecycle.md` contradicts one. The bullets map to the shipped rules as follows:

- the path: lifecycle § Home, with the grader's temp-folder exemption;
- the front matter: lifecycle § Front matter;
- the section order: handoff § Shape, sections 1 to 6;
- committed first: handoff § Commit it, where land.sh commits by pathspec;
- the manual handoff with no substitute: handoff § Fail closed;
- the absolute path and the mark-consumed line: handoff § Build the handoff prompt.

## Status

- **The cause of the earlier misses is unconfirmed.** The recorded misses (2026-09-28, 2026-10-10, and the
  3.1.0 record's default-model runs, where this case ran in run 1) happened only under the default model with
  Haiku judging. Under the Opus lock the case scored 1.00 over 3 runs on 2026-10-17. Whether the default
  model's replies or the judge caused the misses is unconfirmed, by design of the lock: confirming it would
  need a non-Opus model or judge, which the operator's Opus lock forbids.
- **This is the first measurement of the Verify at 3 runs under the Opus lock**, after the two `--runs 1`
  passes (3.1.0 run 4 and `2026-10-16-release-4-0.md`). p19-5 can cite it as this case's 3-run baseline, and
  `2026-10-16-release-4-0.md` stays the whole-suite `--runs 1` baseline.
- **1.00 over 3 runs on 2026-10-17**, one configuration, one invocation. That is a measurement, not a fix:
  nothing changed, and three runs do not prove the case stable.
- **The close cases' misses belong to p19-10** (`thread-skill-p19-10-eval-close-consumed-fixture`).
- **Tidy:** the three kept sandboxes (`/private/tmp/e-KOAOSI`, `/private/tmp/e-jgHJm4`,
  `/private/tmp/e-H2DpjR`) were removed after the reading. `evals/results/` did not exist before or after
  the invocation, and `git status --porcelain --ignored` was unchanged by it.
