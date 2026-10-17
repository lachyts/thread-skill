# Behaviour evals — 2026-10-17, the close lifecycle fixtures (p19-10)

Claude Code 2.1.302. The skills under test are those of `11e5c98` on
`audit-fix/skill-p19-10-eval-close-consumed-fixture`, at manifest version 4.0.0, in every round. Round 1 ran
on the unchanged tree. Round 2 ran on the same commit with the first review round's fixture edits in the
working tree. Round 3 ran on `a7dae47`, which holds those edits and the second review round's rubric
narrowing (§ What changed). No skill file changed. Every run used `--runs 3 --model opus --judge-model opus
--ablation none --no-publish --threshold 0 --max-cost-usd 4 --trust-plugin`, with `--output-dir`, `--report`
and `--json` pointed at a scratch directory outside the tree; rounds 1 and 2 also passed `--keep-temp`. The
CLI applies only the last `--case`, so each round was two invocations, one per case, run side by side: six
invocations in all.

The CLI's cost for a run includes that run's judge calls (it also reports the judge's share on its own, as
`judgeCostUsd`), so its figures are the whole spend. Total spend $8.41, $0.68 of it judge calls, against the
task's 20 USD cap.

## Runs

| # | started (UTC) | tree | `--case` | runs | time | cost, judge included | judge share |
|---|---|---|---|---|---|---|---|
| 1a | 2026-10-17 23:00 | `11e5c98` | `close-deletes-consumed-keeps-legacy` | 3 | 171 s | $1.458 | $0.14 |
| 1b | 2026-10-17 23:00 | `11e5c98` | `close-pending-doc-owns-continuation` | 3 | 148 s | $1.384 | $0.10 |
| 2a | 2026-10-17 23:04 | `11e5c98` + fixture edits | `close-deletes-consumed-keeps-legacy` | 3 | 165 s | $1.374 | $0.11 |
| 2b | 2026-10-17 23:04 | `11e5c98` + fixture edits | `close-pending-doc-owns-continuation` | 3 | 147 s | $1.392 | $0.11 |
| 3a | 2026-10-17 23:19 | `a7dae47` | `close-deletes-consumed-keeps-legacy` | 3 | 136 s | $1.385 | $0.10 |
| 3b | 2026-10-17 23:19 | `a7dae47` | `close-pending-doc-owns-continuation` | 3 | 167 s | $1.418 | $0.12 |
| | | | | | total | $8.411 | $0.68 |

Every run took 3 turns and made one Skill call, to `thread:close`.

## Scores

| case | round | score | `lifecycle` judge votes, runs 1 / 2 / 3 | tool and regex graders |
|---|---|---|---|---|
| close-deletes-consumed-keeps-legacy | 1 (before) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-pending-doc-owns-continuation | 1 (before) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-deletes-consumed-keeps-legacy | 2 (fixture edits) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-pending-doc-owns-continuation | 2 (fixture edits) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-deletes-consumed-keeps-legacy | 3 (narrowed rubric) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-pending-doc-owns-continuation | 3 (narrowed rubric) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |

The JSON holds the votes and the graded last message, but no judge rationale.

## Diagnosis

### Close has not regressed

The baseline already scored 1.00 under the Opus judge, as the 4.0.0 record's single run did. Reading the six
baseline last messages against the rubrics found no run breaking a close rule: each deleted the consumed doc,
left the legacy doc alone, kept and refreshed the pending doc, proposed no task for the JSON writer or the
release, and asked no approval for commits or memory. The five PRs the brief names all merged between the
2026-09-28 run, on the `feat/orient-reshuffle` tree, and the 2026-10-10 one. Read against each, the six
baseline messages show:

- **#38** (handoff docs have one writer; close's scope rule). The three pending-case runs refreshed the doc
  in place and wrote no second one: the schema moved to Done and verified, What remains and the Paste-ready
  prompt's next move were rewritten, `refreshed: 2026-10-18` was added and `status: pending` kept. Each
  applied the scope rule: the JSON writer and the 1.4 release stayed in the doc as continuation, and the
  README fix reached the task menu as a loose end. The consumed case has no pending doc to refresh.
- **#39** (close flips a finished task). No run flipped a task, because no vault task was worked this
  session. The three consumed-case runs each weighed a task the doc's prompt might link and applied the
  flip's guard to it (PR #42 merged, `make test` green after the last change). They differed only on whether
  the prompt's description proves the test run, so two would flip such a task and one would offer a mark-done
  option. Neither rubric grades this.
- **#46** (close's close-out landing). All six described one land.sh call for the repo, committing THREAD.md
  and the doc change together by pathspec, then pushing or queueing a `landing` PR without waiting. That is
  today's rule; it is defect 2 below.
- **#49** (close lands its own branch). All six found the session on master, with the PR's branch merged and
  not checked out, so there was no own branch and sub-step 7.9 did not run.
- **#98** (land.sh takes consumed review-doc deletions). The fixture has no `docs/reviews/`, so it does not
  apply. The two runs that raised it (consumed run 2, pending run 1) would hand a consumed review doc only if
  one existed, and expected none.

So `skills/close/SKILL.md` is unchanged.

### Two fixture defects

The same six messages show two fixture defects, each of which leaves a judge room to vote FAIL. The judges
that did vote FAIL on the old fixtures were Haiku, three votes of three, in the 3.0.0 record (the consumed
case) and in runs 1 to 3 of the 3.1.0 record (both cases), and Opus once, in the 3.1.0 record's run 5 (the
consumed case, PASS PASS FAIL).

1. **No thread file in either prompt.** Both prompts named `exports-migration` but described no THREAD.md,
   and the sandbox's cwd is not under `~/repos`, so close's rung 2 finds nothing and goes to rung 4. All six
   baseline runs hedged: they described the thread update as conditional on a lookup hit, and two offered to
   create the thread instead (one saying a "no" skips the thread update). Both rubrics grade the thread
   file's content, so whether such a run passes is down to the judge. The 3.1.0 record's run 5 shows the
   slack is not Haiku's alone: an Opus judge cast a FAIL vote on the old consumed fixture too.
2. **The consumed-case rubric predates #46.** It required the deletion "committed by pathspec as its own
   file", the pre-#46 one-file-per-commit shape. Since #46 the deletion goes to land.sh, which makes one
   commit per repo holding THREAD.md and the deletion together. All six baseline runs described that one
   landing commit, which is what today's skill says, and which a literal reading of the old bullet fails.

### Why each case dropped

**The consumed case** scored 1.00 on 2026-09-28 and 0.75 on 2026-10-10 and on 2026-10-15, and all three were
Haiku-judged: none passed `--judge-model`, and `claude plugin eval` defaults to `haiku`. So the judge model
does not tell the brief's two readings apart. The timing does. Defect 1 was present at all three runs, since
the case dates from #13 (2026-09-25), which is why it alone does not explain the drop. Defect 2 is what changed
in between: #46 (`6da0713`) merged on 2026-09-29, after the 1.00 and before the first 0.75, and made close's
output the one landing commit that a literal reading of "as its own file" fails. The other four PRs, which
merged in the same window, changed nothing this rubric grades (§ Close has not regressed). The record
concludes that the consumed case dropped because of defect 2, with defect 1 giving the judge further room,
and not because close regressed.

**The pending case** scored 1.00 on 2026-10-10 and 0.75 on 2026-10-15, both on the default model with a Haiku
judge, one run each. Its rubric never had the "own file" wording, so #46 cannot explain it. Neither case's
fixture changed between the two trees (`f0257cb` and `8030672`), and close's changes there touch none of
what this rubric grades (the refresh, the task proposals, the Resume pointer): #123's plugin-root rule,
#127's capture-marker wording in the task row, and #133's half-applied guard shared by 7.1 and 7.2. The
record concludes defect 1 plus single-run judge variance. The same fixture, with no change to anything its
rubric grades, passed under a Haiku judge on 2026-10-10 and drew FAIL×3 on 2026-10-15. Defect 1 is what
gives a judge two readings to choose between: the Resume-pointer bullet grades a THREAD.md the prompt never
described, so a run can only hedge about it. This is the likeliest reading, not a proven one: neither record
kept the transcript or a judge rationale, and neither recorded the model id under test.

## What changed

- Both prompts now say the thread file is the repo's top-level THREAD.md with `slug: exports-migration`,
  that the repo-thread lookup prints it, what its Where we are says, and that its Resume instructions are an
  absolute pointer at the case's handoff doc (written as `<current directory>/docs/handoffs/…`, so the
  prompts carry no home marker).
- The consumed-case rubric accepts the deletion in a commit of its own or in the repo's one landing commit
  with THREAD.md; the pending-case rubric says the same of the refreshed doc. Both add a "Not graded" bullet
  for whether the close-out is pushed, queued or committed only. No FAIL criterion changed, and the deletion
  or refresh must still be committed by pathspec.
- Both rubrics stop excusing an offer to create the thread file (the second review round, `a7dae47`). With
  the thread file in the prompt, close's rung 2 resolves it, so offering to create it (rung 4) is now wrong
  behaviour, and the carve-out would let a regressed thread resolution pass. The consumed-case PASS bullet
  "Apart from vault tasks and any offer to create the thread file, it proposes nothing" now reads "Apart
  from vault tasks, it proposes nothing", and both rubrics' "Not graded" bullet now covers only where the
  thread file lives, no longer "whether the run updates an existing one, creates one or offers to create
  one".

After the fixture edits, all six round-2 runs updated THREAD.md directly (`<cwd>/THREAD.md` resolved by the
lookup), with no create-or-skip branch. The consumed-case runs replaced the Resume pointer at the deleted doc
with real instructions; the pending-case runs kept the pointer at the pending doc. The six round-3 runs,
judged on the narrowed rubrics, did the same, with no offer to create the thread, and scored PASS×3 on every
run.

p19-5's `--runs 3` baseline will run on these new fixtures. The 4.0.0 record's 1.00 for both cases was on the
old text.

## Tidy

`git status --porcelain --ignored` was empty before round 1, unchanged across round 2 (the fixture edits
only), empty again before round 3 at `a7dae47` and unchanged across it; `evals/results/` never appeared.
Results, reports and JSON went to the scratch directory. `--keep-temp` left rounds 1 and 2's twelve run
directories in the system temp directory; round 3 ran without it and left none. All were removed afterwards.
