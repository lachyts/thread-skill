# Behaviour evals — 2026-10-28, a handoff ends by running next for this session (p27-5)

Claude Code 2.1.311 (`claudeVersion` in every `run.json`). The skills under test are those of the task branch
`audit-fix/skill-p27-5-handoff-ends-with-next`, cut from origin/master `eecb90e`, at four commits:

- `d1b47f5`: the feature and its tests, as first committed;
- `faa4d37`: that, plus the B1 fix to handoff § Next for this session (Decision, below);
- `35e4aba`: that, plus the B2 change to one grader of `handoff-router-dispatch-skips-next`. The skill text is
  byte-identical to `faa4d37`, and the case run on it (invocation 5) does not use that grader.
- `fcaf386`: that, plus the first version of this record. The skill and eval text is byte-identical to `35e4aba`;
  invocation 6 scored the amended grader on it.

**After scoring, not re-scored.** Five commits followed invocation 6, and no invocation ran on any of them:

- `52f07c7`: this record's invocation-6 update. The skill and eval text is byte-identical to `fcaf386`.
- `b18d0e7`: skill text, from the master review. After this session's own handoff, next prints no step-2 summary
  and no open question, only its one line or its menu (next step 1, **After this session's own handoff**, and step
  2), and handoff § Build points at that rule. A handoff that next's step 5 dispatched ends its turn on handoff's
  own output, with no word after it on this session's move and none on ending or archiving this session (handoff
  § Next for this session, **Skipped on a dispatch.**).
- `2aa2550`: grader text. `handoff-router-dispatch-skips-next/graders/ends-on-the-handoff.md` gains a FAIL bullet
  for a message that says this session can be ended or archived, or that the thread already continues in another
  session. `handoff-ends-with-next/graders/parent-next.md` gains the same words, plus a FAIL for a question outside
  a menu of moves in next's part of the message.
- `c9a97b3`: skill text, from the master review's second round. handoff's **Skipped on a dispatch.** bullet now reads
  "with nothing after it that recommends, offers or asks about a move for this session" in place of `b18d0e7`'s
  "with no word after it on this session's move", and adds that the note on how Lachy can overturn next's decision
  is no second move, wherever it sits. That is the B2 ruling and `ends-on-the-handoff.md`'s own test, so run 3 of
  invocation 2, which repeated the note after the prompt, breaks no rule of it.
- `b6c4179`: skill text. next § Don't's "headline + top open question" adds "(none after this session's own handoff,
  step 2)", as step 2 already says.

The commit that adds this paragraph changes this record only. Re-scoring any of them needs a new spend gate, and
none is signed, so the scores below measure the skill text of `faa4d37` and the graders as `35e4aba` left them.

Each sandbox loaded `thread` 5.0.0 from the task worktree, the only thread plugin. The case and the judge ran on the
`opus` alias. The kept traces record the case model as `claude-opus-5-5`, in the init event and on every assistant
message; the CLI does not capture the judge's resolved id. Total spend $9.06 under two approved gates
(`## Approved gates`, both 2026-10-28): $7.80 for invocations 1 to 5 against the first gate's 15 USD cap, and
$1.26 for invocation 6 against the second gate's 3 USD cap.

Every invocation went through `make evals`, so the recipe line's locks (`--ablation none --model opus --judge-model
opus --no-publish`) came last and held. Everything below was passed in `EVAL_ARGS` on the command line, and no file
in the tree gained a flag:

- `--case <name> --runs <R> --max-cost-usd 5`: the CLI keeps a repeated option's last value, so these replace the
  recipe's `--runs 1 --max-cost-usd 30` defaults. `--case` takes one glob, so each case had its own invocation.
  Invocation 6 passed `--max-cost-usd 3`, its gate's cap.
- `--trust-plugin`: an agent's `claude plugin eval` is refused in an untrusted directory without it. The precedents
  are `2026-10-15-reflect-routing.md` (p21-1) and `2026-10-17-handoff-manual-dry-run.md` (p19-11).
  `FORBIDDEN_FLAGS` in `tests/contracts/evals-structure.test.mjs` checks only the Makefile's `EVAL_ARGS ?=` default.
- `--keep-temp`: the reading below needed each run's trace (which Skill and Read calls ran, and in what order).
- `--concurrency 3`: three runs of a 300 s case in sequence could outlast the 600 s Bash call each invocation ran
  in. In parallel, the wall time is about one run's.
- `--output-dir`, `--report` and `--json` pointed at a `mktemp -d` scratch directory outside the tree.

## Runs

| # | started (UTC) | tree | case | runs | time | cost |
|---|---|---|---|---|---|---|
| 1 | 2026-10-28 00:52 | `d1b47f5` | `handoff-ends-with-next` | 3 | 67 s | $1.36 |
| 2 | 2026-10-28 00:55 | `faa4d37` | `handoff-router-dispatch-skips-next` | 3 | 58 s | $1.30 |
| 3 | 2026-10-28 00:57 | `faa4d37` | `handoff-manual-dry-run` | 3 | 79 s | $3.50 |
| 4 | 2026-10-28 00:58 | `faa4d37` | `handoff-fork-now` | 1 | 15 s | $0.20 |
| 5 | 2026-10-28 01:14 | `35e4aba` | `handoff-ends-with-next` (the reserve re-run) | 3 | 54 s | $1.43 |
| 6 | 2026-10-28 11:54 | `fcaf386` | `handoff-router-dispatch-skips-next` (the second gate) | 3 | 43 s | $1.26 |

Before each of invocations 1 to 5 the running total plus that invocation's estimate stayed under the first cap:
the largest estimate, before invocation 3, was $3.90 (the plan's figure for the trace judge) on a total of $2.66.
Invocation 6 ran alone under the second gate, estimated at $1.30 (invocation 2's cost) against its 3 USD cap. Every
run ended with `error: null` and `skippedPaidGraders: false`, and no invocation was `partial`.

**Order.** The plan's order was invocations 1 to 4, then one decision. Invocation 1 showed a reply that broke a
shipped rule (B1, below), so the fix (`faa4d37`) landed before invocations 2 to 4. They therefore measure
`faa4d37`'s skill text, which invocations 5 and 6 ran on too, at the same spend.

## Scores

A judge grader passes a run when at least 2 of its 3 votes are PASS. Tool sequences are each kept trace's own
`tool_use` calls in order. "Messages" counts the trace's user and assistant messages, against the trace judge's
24-message window: none came near it.

### `handoff-ends-with-next`, invocation 1 (`d1b47f5`): 0.73, pass rate 0

| run | sandbox | score | turns | messages | cost (judge) | doc-path | routes-to-handoff | runs-next-once | not-close | parent-next |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `e-HHfMbT` | 0.80 | 5 | 11 | $0.49 ($0.15) | matched | 1 call | **0 calls** | 0 calls | PASS PASS PASS |
| 2 | `e-jXpTJh` | 0.80 | 5 | 11 | $0.46 ($0.13) | matched | 1 call | **0 calls** | 0 calls | PASS PASS PASS |
| 3 | `e-ALrk0V` | 0.60 | 5 | 11 | $0.41 ($0.07) | matched | 1 call | **0 calls** | 0 calls | **FAIL FAIL FAIL** |

Each run: `Skill(thread:handoff)` → `Read(handoff-lifecycle.md)` → `Read(grill-fit.md)`, then the last message. No
run called `thread:next`. Each last message ended with a described next instead: "`thread:next after-handoff <doc
path>` would run once … it would most likely say one line: keep going here and fix the README" (run 1); "Step 7:
Next move for this session … Its likely pick is to keep going here" (run 3). Run 3 then added a "Before a real run"
section after that move.

### `handoff-router-dispatch-skips-next`, invocation 2 (`faa4d37`): 0.78, pass rate 0.33

| run | sandbox | score | turns | messages | cost (judge) | routes-to-next | not-close | ends-on-the-handoff |
|---|---|---|---|---|---|---|---|---|
| 1 | `e-2Voo4c` | 1.00 | 5 | 12 | $0.42 ($0.10) | 1 call | 0 calls | PASS PASS PASS |
| 2 | `e-Yj3oDv` | 0.67 | 5 | 12 | $0.46 ($0.11) | 1 call | 0 calls | **FAIL FAIL FAIL** |
| 3 | `e-YrJEJ2` | 0.67 | 5 | 12 | $0.42 ($0.07) | 1 call | 0 calls | **FAIL FAIL FAIL** |

Each run: `Skill(thread:next)` → `Read(skills/handoff/SKILL.md)` (next's dispatch by a read) → one `Read` or `Grep`
of `handoff-lifecycle.md`, then the last message. No run called `thread:next` a second time or ran `close`. Each
decided handoff in one line with no question ("Next move: handoff, because the next phase is unrelated and its spec
is ready to run"), showed a pending doc under `docs/handoffs/` and the paste-ready prompt, and said it was a manual
handoff. No last message holds a question mark outside a code block. Two runs said why no second next ran: "The
handoff's usual final step, re-running 'what's next' for this session, is skipped because 'what's next' itself
started the handoff" (run 1), "The handoff's own 'what next for this session' step doesn't run here, since this
route already chose that move" (run 3).

The CLI records the vote tally only, never the judge's rationale. The implementer's reading of the two FAILs:

- Run 3 ends, after the prompt, on next's overturn note again: "To overturn this, say 'close' instead: that logs
  this session into THREAD.md". The grader's FAIL bullet "After the handoff's output it gives a further move for this
  session: keep going, stash, defer, close or archive" reads that as a second move.
- Run 2 gives its overturn note in the decided line, before the doc ("Say close instead if you'd rather just log
  this session into the thread"), and ends "That's the end. Since you started this from 'what's my next move',
  nothing runs afterwards." No bullet is plainly breached. The same overturn note is the likeliest reading, and it
  is unconfirmed.

### `handoff-manual-dry-run`, invocation 3 (`faa4d37`): 1.00, pass rate 1

| run | sandbox | score | turns | messages | cost (judge) | doc-path (trace) | routes-to-handoff | not-close | lifecycle (trace) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `e-glmGiE` | 1.00 | 7 | 15 | $1.40 ($0.97) | matched | 1 call | 0 calls | PASS PASS PASS |
| 2 | `e-xV1Hyi` | 1.00 | 7 | 15 | $1.27 ($0.83) | matched | 1 call | 0 calls | PASS PASS PASS |
| 3 | `e-UpoA88` | 1.00 | 7 | 15 | $0.83 ($0.44) | matched | 1 call | 0 calls | PASS PASS PASS |

Each run: `Skill(thread:handoff)` → `Read(handoff-lifecycle.md)` → `Read(grill-fit.md)` → `Skill(thread:next)` with
args `after-handoff <the doc's absolute path>`, then the last message, which ends on one move for this session:
"Next move: keep going, because you're updating the changelog for waves 1 and 2 in this session and the handoff
doesn't cover it" (run 1), and the same move in runs 2 and 3. This case now has 4 graders, not 6, and a residual line
in its prompt, so its scale changed: one judge FAIL is 0.75 (it was 0.83 with 6). Its earlier records are not
comparable on the score. The two removed regexes' checks (`status: pending`, "manual handoff") live on in
`graders/lifecycle.md`.

### `handoff-fork-now`, invocation 4 (`faa4d37`): 1.00

| run | sandbox | score | turns | messages | cost | routes-to-handoff | not-close |
|---|---|---|---|---|---|---|---|
| 1 | `e-WEjciJ` | 1.00 | 6 | 13 | $0.20 | 1 call | 0 calls |

`Skill(thread:handoff)` → `Grep(csv)` → `Glob(**/*)` → `ToolSearch(create_thread bash write)`, then a last message
that wrote no doc: the empty sandbox held nothing to brief ("There's no CSV writer work to carry forward"), and no
write tool was granted. No doc was handed to landing, so § Next for this session's first condition never held and
`next` did not run. That is consistent with the rule. 6 turns, under the new `max_turns: 15` (the old cap was 8).

### `handoff-ends-with-next`, invocation 5, the reserve (`35e4aba`): 1.00, pass rate 1

| run | sandbox | score | turns | messages | cost (judge) | doc-path | routes-to-handoff | runs-next-once | not-close | parent-next |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `e-MPuvIR` | 1.00 | 7 | 15 | $0.49 ($0.09) | matched | 1 call | 1 call | 0 calls | PASS PASS PASS |
| 2 | `e-89FzFy` | 1.00 | 7 | 15 | $0.48 ($0.08) | matched | 1 call | 1 call | 0 calls | PASS PASS PASS |
| 3 | `e-QCwfcf` | 1.00 | 7 | 16 | $0.46 ($0.06) | matched | 1 call | 1 call | 0 calls | PASS PASS PASS |

Each run: `Skill(thread:handoff)` → `Read(handoff-lifecycle.md)` → `Read(grill-fit.md)` → `Skill(thread:next)` with
args `after-handoff <the doc's absolute path>` and a dry-run note. Runs 1 and 2 put the handoff and next's move in
the one last message, the move after the doc and the prompt ("Next move: keep going in this session, because
what's left here is your README install-section fix (Python 3.9). The JSON writer now belongs to the handoff doc.").
Run 3 printed the handoff in a message of its own before the `thread:next` call, so its last message is next's
alone: one move, keep going on the README fix.

### `handoff-router-dispatch-skips-next`, invocation 6, the second gate (`fcaf386`): 1.00, pass rate 1

| run | sandbox | score | turns | messages | cost (judge) | routes-to-next | not-close | ends-on-the-handoff |
|---|---|---|---|---|---|---|---|---|
| 1 | `e-zpBbp1` | 1.00 | 6 | 14 | $0.39 ($0.07) | 1 call | 0 calls | PASS PASS PASS |
| 2 | `e-78TWoD` | 1.00 | 5 | 12 | $0.47 ($0.12) | 1 call | 0 calls | PASS PASS PASS |
| 3 | `e-bmP5K0` | 1.00 | 5 | 12 | $0.39 ($0.05) | 1 call | 0 calls | PASS PASS PASS |

Run 1: `Skill(thread:next)` → `Read(skills/handoff/SKILL.md)` → `Grep(handoff-lifecycle.md)` →
`Read(handoff-lifecycle.md)`. Runs 2 and 3: `Skill(thread:next)` → `Read(skills/handoff/SKILL.md)` →
`Read(handoff-lifecycle.md)`. Each `thread:next` call's args carried only a dry-run note, never `after-handoff`. No
run called `thread:next` a second time or ran `close`. Each last message decided handoff in one line with no
question ("Next move: handoff, because the next phase is unrelated, its spec is ready to run, and this session's
context is full of CSV debugging", run 1), then showed a `status: pending` doc under `docs/handoffs/` and the
paste-ready prompt, and said no new session was opened: "manual handoff" in runs 1 and 2, "it can't open the new
session for you. You'd open it yourself and paste this" in run 3. No last message holds a question mark outside a
code block.

How each ends, after the prompt:

- Run 1: "The router's usual follow-up step for this session is skipped because the router itself sent this
  handoff. This session's work ends here."
- Run 2: "That's the end of the handoff. The thread now continues in the fresh session, and you can end this one."
  "End this session" is next step 4's off-Stage wording for the archive part, and next step 1 does not count a
  manual handoff's unopened prompt as the thread continuing elsewhere. All three votes passed it: it follows a
  router-dispatched handoff, with nothing left in the session and no move marked recommended. After scoring,
  `b18d0e7` made such words a breach of handoff's rule, and `2aa2550` added a FAIL bullet that names them. Neither
  is scored.
- Run 3: on a note that `<spec path>` and `<toplevel>` are placeholders. Its overturn note ("Say "close" instead if
  you'd rather just log this session into the thread and stop") sits in the decided line, before the doc.

## Decision

A-clean (plan step 6, **(A) Record only.**), after invocation 6 under the second gate: both new cases and
`handoff-manual-dry-run` score 1.00 over 3 runs on the skill text of `faa4d37` (invocations 5, 6 and 3),
`handoff-fork-now` scores 1.00 under its `max_turns`, and every run has `error: null` and
`skippedPaidGraders: false`, with nothing partial. That decision covers the text as scored. The skill and grader
commits after invocation 6 (`b18d0e7`, `2aa2550`, `c9a97b3`, `b6c4179`; **After scoring, not re-scored**, above) were
not re-scored.

- **B1, `faa4d37`: handoff § Next for this session.** Invocation 1 broke the plan's "next missing after a dry run"
  rule. The shipped sentence "A dry run ends with this step too, described as next would run it" read as "describe
  it in place of running it" in all three runs. It now reads "A dry run ends with this step too, and still makes
  the call, since loading `next` writes nothing: only what its move would write is described, never done." After
  the fix, all six dry-run handoffs that reached the step called `thread:next` once (invocations 3 and 5), and no
  reply breached a rule of the text they ran on (`faa4d37`'s; the rules added since are under **After scoring, not
  re-scored**, above, and **Not measured**, below).
- **B2, `35e4aba`: `handoff-router-dispatch-skips-next/graders/ends-on-the-handoff.md`.** The replies kept every
  rule of the text they ran on (`faa4d37`'s; the rules added since are under **After scoring, not re-scored**,
  above): next ran once, decided handoff in one line (next step 4, **Clear**), and dispatched it, and handoff's
  step was skipped (handoff § Next for this session, **Skipped on a dispatch.**; next step 5). The grader read next's
  overturn note, which next step 4's **The line.** puts in every decided line ("What it leaves behind, so he can
  overturn it"), as a second move once it was repeated after the prompt. The grader now lists that note under Not
  graded, wherever it sits, and its FAIL bullet counts a further move beyond it. Invocation 6 scored that version:
  1.00 over 3 runs, every vote PASS. The FAIL bullet `2aa2550` added later is unscored.
- **The reserve went to `handoff-ends-with-next`.** It is the case the B1 fix affected and the Verify's first half,
  and it scored 1.00 over 3 runs. The first gate allows one reserve re-run of one case, so the router case waited
  for the second gate (one invocation at `--runs 3`, cap 3 USD), signed 2026-10-28, and scored 1.00 there
  (invocation 6). That gate holds no reserve, and none was needed.

## Status

- **Measured, not proven stable.** Three runs per case, one scored invocation each on the skill text of
  `faa4d37` (the two cases measured twice were re-run after a change: B1 for `handoff-ends-with-next`, B2 for the
  router case), one configuration.
- **The Verify's first half, measured on `faa4d37`'s skill text:** an explicit handoff ends with exactly one `next`
  move for this session, 1.00 over 3 runs (invocation 5), and `handoff-manual-dry-run` showed the same handoff →
  next shape in 3 of 3 runs.
- **The Verify's second half, measured on `faa4d37`'s skill text:** a handoff that `next` dispatched runs no
  second `next`, 1.00 over 3 runs on the grader as `35e4aba` amended it (invocation 6), and `routes-to-next`
  counted 1 call in all six router-case runs (invocations 2 and 6).
- **Not measured:** the skill text of `b18d0e7`, `c9a97b3` and `b6c4179`, and `2aa2550`'s two FAIL bullets. No spend
  gate covers a re-score, so none ran, and there was no spend after invocation 6. Of the scored replies, run 2 of
  invocation 6 says what the new router FAIL bullet names. Whether the replies of invocations 3 and 5 held a step-2
  summary or open question was not recorded, and their traces are gone.
- **`make test`** passed on `d1b47f5`. On `faa4d37`, every suite passed, and the run failed only its "run wrote
  nothing into the checkout" check: the B2 grader edit was made in the worktree while that run was going. On
  `fcaf386` it passed with the tree untouched, before invocation 6: 2601 tests, 2600 passed and 1 skipped (the
  optional CHORUS_SRC cross-check). On `2aa2550` (the review-round-1 head, tree untouched) it passed with the same
  counts. The heads after it are verified in PR #246's body.
- **Tidy:** the sixteen kept sandboxes (`/private/tmp/e-HHfMbT`, `e-jXpTJh`, `e-ALrk0V`, `e-2Voo4c`, `e-Yj3oDv`,
  `e-YrJEJ2`, `e-glmGiE`, `e-xV1Hyi`, `e-UpoA88`, `e-WEjciJ`, `e-MPuvIR`, `e-89FzFy`, `e-QCwfcf`, `e-zpBbp1`,
  `e-78TWoD`, `e-bmP5K0`) were removed by their literal paths after the reading, then each scratch directory.
  `evals/results/` did not exist before or after the invocations, and `git status --porcelain --ignored` was empty
  before them and unchanged by them, apart from this record.
