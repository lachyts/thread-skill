# Behaviour evals — 2026-11-06, the next move starts a prepared rollout (p40-2)

Claude Code 2.1.318 (`claudeVersion` in every `run.json`). The skills under test are those of the task branch
`audit-fix/skill-p40-2-next-starts-a-prepared-handoff-itself`, cut from origin/master `380d8c6`, at `ef416bf`: the
feature (ADR 0072), its contract tests and the two new lifecycle cases, as first committed. The commit that adds this
record changes this record only, so the scores below measure the skill and eval text of `ef416bf`.

Each sandbox loaded `thread` 5.0.0 from the task worktree, the only thread plugin. The case and the judge ran on the
`opus` alias. The kept traces record the case model as `claude-opus-5-5` on every assistant message; the CLI does not
capture the judge's resolved id. Total spend $3.77 under the task note's approved gate (`## Approved gates`,
2026-11-06: "cap 12 USD", three invocations at most, each at `--max-cost-usd 4`). Two invocations ran; the reserve
re-run was not needed.

Every invocation went through `make evals`, so the recipe line's locks (`--ablation none --model opus --judge-model
opus --no-publish`) came last and held. Everything below was passed in `EVAL_ARGS` on the command line, and no file
in the tree gained a flag:

- `--case <name> --runs 3 --max-cost-usd 4`: these replace the recipe's `--runs 1 --max-cost-usd 30` defaults, one
  case per invocation.
- `--trust-plugin`: an agent's `claude plugin eval` is refused in an untrusted directory without it (precedents:
  `2026-10-15-reflect-routing.md`, `2026-10-28-handoff-ends-with-next.md`).
- `--concurrency 3`: the three runs of a 420 s case in parallel, inside one 600 s Bash call.
- `--output-dir`, `--report` and `--json` pointed at a `mktemp -d` scratch directory outside the tree.
- `--keep-temp` (the recipe's own): the reading below needed each run's trace.

## Runs

| # | started (UTC) | tree | case | runs | time | cost |
|---|---|---|---|---|---|---|
| 1 | 2026-11-06 04:34 | `ef416bf` | `next-launches-unstarted-rollout` | 3 | 60 s | $1.43 |
| 2 | 2026-11-06 04:35 | `ef416bf` | `close-launches-unstarted-rollout` | 3 | 71 s | $2.34 |

Before invocation 1 the total was $0 and its cap $4; before invocation 2 the total was $1.43 and its cap $4, so
$5.43 against the 12 USD gate. Every run ended with `error: null` and `skippedPaidGraders: false`, and no invocation
was `partial`. A case passes when at least 2 of its 3 runs pass every grader; both passed 3 of 3.

## Scores

A judge grader passes a run when at least 2 of its 3 votes are PASS. Tool sequences are each kept trace's own
`tool_use` calls in order. "Messages" counts the trace's user and assistant messages.

### `next-launches-unstarted-rollout`, invocation 1: 1.00, pass rate 1

| run | sandbox | score | turns | messages | cost (judge) | routes-to-next | not-close | names-execute | launches-then-keeps-going |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `e-hrp3wa` | 1.00 | 5 | 12 | $0.47 ($0.12) | 1 call | 0 calls | matched | PASS PASS PASS |
| 2 | `e-FWBARJ` | 1.00 | 6 | 15 | $0.48 ($0.14) | 1 call | 0 calls | matched | PASS PASS PASS |
| 3 | `e-izDiHo` | 1.00 | 6 | 15 | $0.49 ($0.15) | 1 call | 0 calls | matched | PASS PASS PASS |

Run 1: `Skill(thread:next)` → `Read(skills/handoff/SKILL.md)` (next step 5's launch, by a read) → one `Grep` of
`handoff-lifecycle.md`. Runs 2 and 3: `Skill(thread:next)` → `Grep(Rollout launch)` over handoff's SKILL.md →
`Read(skills/handoff/SKILL.md)` → `Grep(## Front matter)` over `handoff-lifecycle.md`. No run
called `thread:next` a second time or ran `close`. Each decided the move in one line with no question, the launch
first and this session's own move after it, on step 4's **The launch, first in the line.** template: "Next move: hand
[[exports-rollout-2026-11-05]] to a fresh lead, then keep going on the README fix, because the rollout's note is
written and nothing is running it, and the README fix is a one-line change I already said I'd make next. A fresh
session runs `/thread:execute [[exports-rollout-2026-11-05]]` from …; say "not yet" to withdraw the handoff" (run 2).
Each then showed the Rollout launch doc with `launches: exports-rollout-2026-11-05`, its Run from line at the Project
root and a manual-handoff prompt ending `Next move: /thread:execute [[exports-rollout-2026-11-05]]`, and went on to
the README install-section fix as this session's next step. No run said this session was finished or could be
archived.

### `close-launches-unstarted-rollout`, invocation 2: 1.00, pass rate 1

| run | sandbox | score | turns | messages | cost (judge) | routes-to-close | names-execute | ends-with-the-launch |
|---|---|---|---|---|---|---|---|---|
| 1 | `e-cEg4QY` | 1.00 | 3 | 6 | $0.76 ($0.17) | 1 call | matched | PASS PASS PASS |
| 2 | `e-AyXcFr` | 1.00 | 3 | 6 | $0.81 ($0.22) | 1 call | matched | PASS PASS PASS |
| 3 | `e-diV6wG` | 1.00 | 3 | 6 | $0.77 ($0.19) | 1 call | matched | PASS PASS PASS |

Each run: `Skill(thread:close)` alone, then the last message: close described handoff's Rollout launch from close's
own sub-step 7.10 text without reading handoff's SKILL.md (a dry run, so nothing was dispatched). Each walked step 2
to "the note goes to sub-step 7.10 to be launched" (run 1: "Holds: none apply. You never said "not yet", `ladder.py`
exits 0, the note has a Project root line …"), wrote `close hands [[exports-rollout-2026-11-06]] to a fresh lead (see
the step-8 row)` into THREAD.md's Where we are with no bare `/thread:execute` step, ran 7.10 after 7.1 and 7.2's
landing (7.9 skipped: no own branch), printed the fenced manual prompt above the report, and gave the row
`rollout handed off: [[exports-rollout-2026-11-06]] · <root>/docs/handoffs/<doc>.md · manual handoff: its prompt is
above; run it from <root>` with no `rollout not started:` row, ending on banner B. Run 1 also named close's own step-6
mark-done option for a possible JSON-writer task (Owner *yours*, ADR 0011); no run asked or offered anything about
starting the rollout.

## Decision

Both cases pass on their first invocation, so the task's Verify ("`next` dispatches the handoff with the execute
continuation and no AskUserQuestion; `close` ends with the same handoff; the evals pass") is met at `ef416bf`. No
grader or skill fix followed, and the reserve invocation was not spent.

Review rounds 2 and 3 then changed skill text these cases read, after `ef416bf`: next steps 4 and 5 (the overturn
sentence before a menu, the held-note reply, the archive line's qualifiers), close sub-step 7.10 and step 8 (the Codex
Desktop row), and close step 2's guard and holds, step 4's held step and the Edge cases (a hold that carries into every
later session). Neither case nor any grader changed. Those edits are not re-scored here: neither fixture holds a note,
and the gate leaves one invocation of one case.

The six kept sandboxes (`/private/tmp/e-hrp3wa`, `e-FWBARJ`, `e-izDiHo`, `e-cEg4QY`, `e-AyXcFr`, `e-diV6wG`) and the
scratch directory were removed by their literal paths once this record had read them.
