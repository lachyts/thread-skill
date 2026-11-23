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
| 2 | post-edit | 2026-11-23 08:02 | `252f47f`, nothing modified or untracked | 30 of 30 (90 runs) | 916 s | $40.65 |

Both invocations ended `partial: false`, and every one of their 180 runs ended with `error: null` and
`skippedPaidGraders: false`, so every case is complete on both sides (3 runs from one invocation, each scored on
every grader) and neither side was assembled. Invocation 1 cost 95% of its ceiling, invocation 2 90%.

`252f47f` differs from `07dcbfa` by two commits: `ab09450` adds this record's pre-edit side, and `252f47f` changes the
two `description:` lines and the contract test's ratchet. `claude plugin eval .` loads neither docs/ nor tests/, so of
the plugin's loaded surfaces (`skills/`, `hooks/`, `evals/`, `.claude-plugin/`) only the two descriptions changed
between the sides.

## Resolved model id

The result JSON records the requested alias only (`suite.modelOverride` and `suite.judgeModel`, both `opus`), and
both sides read `claudeVersion` 2.1.330 (`claude --version` printed the same before each invocation). Each kept
trace's `init` event records the case model: `claude-opus-5-5` in all 90 pre-edit runs and all 90 post-edit runs, and
on every assistant message (657 pre-edit, 642 post-edit). Every sandbox's `init` listing loaded `thread` 5.0.0 as
`thread@inline` from the task worktree, the only thread plugin. The CLI does not capture the judge's resolved id. No
version or model drift between the sides, so no paired check ran.

## Descriptions

Lengths as `tests/contracts/manifest.test.mjs` parses them (the single-quoted value with `''` unescaped, counted in
UTF-16 code units). The other eleven descriptions are unchanged.

| skill | before | after |
|---|---|---|
| next | 507 | 513 |
| close | 657 | 649 |
| total | 7942 | 7940 |

`DESCRIPTION_TOTAL_RATCHET` goes 7950→7940. The edits:

- next: ", then dispatches to the chosen sibling route." became " and dispatches it, first starting a prepared
  rollout's lead.", and "or explicit /thread:next" became "or /thread:next".
- close: ", and starts a prepared rollout's lead" was added after "files review follow-ups itself". "Use when the work
  is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it's being set
  down for later use thread:stash or thread:defer." became "Use when the work is FINISHED for now; if it continues
  elsewhere use thread:handoff, if set down for later thread:stash or thread:defer."

Neither fallback wording of the plan (F2, F3) was needed, so every post-edit score ran on this text.

## Scores

Per run, in run order. A routing case's score is the share of its Skill-call graders that passed; a judge grader
passes a run when at least 2 of its 3 votes are PASS. Δ mean is the post-edit mean less the pre-edit mean.

| suite | case | pre-edit runs | pre-edit mean | post-edit runs | post-edit mean | Δ mean |
|---|---|---|---|---|---|---|
| lifecycle | close-deletes-consumed-keeps-legacy | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | close-launches-unstarted-rollout | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | close-pending-doc-owns-continuation | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | handoff-ends-with-next | 1.00 / 1.00 / 0.80 | 0.93 | 1.00 / 0.60 / 1.00 | 0.87 | -0.07 |
| lifecycle | handoff-manual-dry-run | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | handoff-router-dispatch-skips-next | 1.00 / 0.67 / 0.67 | 0.78 | 1.00 / 1.00 / 1.00 | 1.00 | +0.22 |
| lifecycle | next-clear-close-no-ask | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | next-launches-unstarted-rollout | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| lifecycle | next-sweep-keeps-open-confirm | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | close-work-finished | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | defer-to-friday | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | handoff-fork-now | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | handoff-note-for-a-person | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | long-context-is-not-a-handoff | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | next-undecided-what-now | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | orient-all-across-every-project | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 1.00 / 1.00 | 1.00 | 0.00 |
| routing/continuity | orient-look-only-flag | 1.00 / 1.00 / 1.00 | 1.00 | 1.00 / 0.67 / 0.67 | 0.78 | -0.22 |
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

Pre-edit `aggregates.overallScore` 0.990; post-edit 0.988. `overallPassRate` 0.967 on both sides, 30 of 30 cases
passed at `--threshold 0`.

The results keep each judge grader's vote tally, never its rationale, so each miss below is read from its kept trace.

The three sub-1.00 pre-edit runs:

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

The three sub-1.00 post-edit runs:

- `orient-look-only-flag` runs 2 and 3 called no skill (`routes-to-orient` failed; `not-next` and `not-orient-all`
  passed). Each declined `thread:orient` because it "would re-sort and write tasks" (run 2) or "re-sorts tasks and
  writes phases" (run 3), searched the sandbox for Palette with Glob and Grep, found nothing and said so. This is the
  no-skill shape `2026-10-18-p19-5-description-trim.md` recorded on both of its sides (two pre-trim runs, one
  post-trim), its reason paraphrases orient's own description, which this task did not change, and neither run called
  `thread:next` or `thread:close`.
- `handoff-ends-with-next` run 2 failed `runs-next-once` (no `thread:next` call) and `parent-next` (PASS FAIL FAIL).
  It called `thread:handoff` alone, printed the doc and the prompt, and ended on "**Next for this session:** the README
  Python 3.9 fix you said you'd do here … (The skill normally calls `thread:next` as its last step to pick this
  session's move; you've already chosen it, so I skipped that call.)". It skipped handoff's own § Next for this
  session step on its reading of the prompt, and called neither next nor close.

Every other post-edit run scored 1.00. Each post-edit run's Skill calls, from its trace: every next and close case
called its own target in all three runs; `execute-run-the-rollout` called `thread:execute` and `repair-stuck-rollout`
called `thread:repair` in all three; no case outside the close ones called `thread:close`; and
`long-context-is-not-a-handoff` run 2 called `thread:next` and scored 1.00 (its one grader is `not-handoff`, and
handoff's description sends a long context to next: "recommend thread:next instead"). The pre-edit sandboxes were
removed before this listing was taken, so the pre-edit side's Skill calls on passing runs are not recorded.

## Pass rule

The plan's rule: a case regresses when its post-edit mean is more than 0.34 below its pre-edit mean, or when a
post-edit miss on a case whose target is not next or close called `thread:next` or `thread:close`.

- **Mean drop.** The largest is `orient-look-only-flag`'s 0.22 (two runs at 0.67, below the 0.34 bar),
  then `handoff-ends-with-next`'s 0.07. No case is a regression on this count.
- **This change's own pull.** None of the three post-edit misses called `thread:next` or `thread:close`. No case is a
  regression on this count.
- **The cases most at risk held 1.00 in every run on both sides:** `close-work-finished`, `next-undecided-what-now`,
  the three close lifecycle cases and the three next lifecycle cases (`next-clear-close-no-ask`,
  `next-launches-unstarted-rollout`, `next-sweep-keeps-open-confirm`), and `execute-run-the-rollout` and
  `repair-stuck-rollout`, the two the launch clause could pull.
- **Pre-existing.** `handoff-ends-with-next` is below 1.00 on both sides with a different miss each side (pre-edit: a
  judge FAIL on next's last message; post-edit: next skipped), so neither side's miss is this change's. Its target is
  handoff, whose description this task did not change.

## Spend

The CLI's cost for an invocation includes its judge calls.

| invocation | `costUsd` | running total | gate |
|---|---|---|---|
| 1 (pre-edit) | $42.92 | $42.92 | 110 USD |
| 2 (post-edit) | $40.65 | $83.57 | 110 USD |

Before invocation 1 the total was $0 and its worst case about $49. Before invocation 2 the total was $42.92, and
$42.92 + 49 = $91.92 stayed within 110. No case regressed, so the 12 USD reserve was not spent: no one-case
invocation, fallback re-run or paired drift check ran. The dearest single run was `execute-run-the-rollout`'s first
pre-edit run, at $1.62; post-edit it was the same case's third, at $1.57.

## Tidy

`git status --porcelain --ignored` was empty before and after each invocation, and `evals/results/` never appeared.
Results, report and JSON went to the scratch directory. Each invocation started with no `/private/tmp/e-<id>` sandbox
on disk and left 90, exactly the `tracePath` set of its result JSON. The kept directories are read-only, so each was
made writable (`chmod -R u+rwx`) and removed by its literal path once the model ids and the sub-1.00 runs were read,
the pre-edit set before invocation 2 and the post-edit set after it. The scratch directory was removed with them.

## Status

- **Pre-edit side recorded** before any description was changed (`ab09450`): 30 of 30 cases complete at 3 runs, one
  invocation.
- **No case regressed** under the plan's pass rule, and no fallback wording was applied. 27 of 30 cases scored 1.00
  in all six runs, among them `close-work-finished`, `next-undecided-what-now` and the six next and close lifecycle
  cases.
- **Below 1.00 on either side, none from this change:** `handoff-router-dispatch-skips-next` (0.78 pre-edit, 1.00
  post-edit), `orient-look-only-flag` (1.00, then 0.78: no skill called, its known shape) and
  `handoff-ends-with-next` (0.93, then 0.87, below 1.00 on both sides with a different miss each). At three runs per
  case a one- or two-run difference is inside the variance earlier records show, so this reads as the edit costing no
  routing.
- **First baselines:** `next-clear-close-no-ask` and `next-sweep-keeps-open-confirm` scored 1.00 in all six runs.
- **Like for like:** both sides ran Claude Code 2.1.330 with `claude-opus-5-5` as the case model in every run, the
  same 30 cases, the same runs and the same flags, ceiling included, and neither hit its ceiling.
