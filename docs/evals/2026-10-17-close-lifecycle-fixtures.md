# Behaviour evals — 2026-10-17, the close lifecycle fixtures (p19-10)

Claude Code 2.1.302. The skills under test are those of `11e5c98` on
`audit-fix/skill-p19-10-eval-close-consumed-fixture`, at manifest version 4.0.0. Invocation 1 ran on the
unchanged tree; invocation 2 ran on the same commit with this change's fixture edits in the working tree (no
skill file changed). Every run used `--runs 3 --model opus --judge-model opus --ablation none --no-publish
--threshold 0 --max-cost-usd 4 --trust-plugin --keep-temp`, with `--output-dir`, `--report` and `--json`
pointed at a scratch directory outside the tree. There was one invocation per case, because the CLI applies
only the last `--case`; the two cases of each round ran side by side. Total spend $5.61 as the CLI reports it
(judge calls $0.46 of the runs' figures, or $6.07 if they are counted on top), against the task's 20 USD cap.

## Runs

| # | started (UTC) | tree | `--case` | runs | time | cost |
|---|---|---|---|---|---|---|
| 1a | 2026-10-17 23:00 | `11e5c98` | `close-deletes-consumed-keeps-legacy` | 3 | 171 s | $1.46 |
| 1b | 2026-10-17 23:00 | `11e5c98` | `close-pending-doc-owns-continuation` | 3 | 148 s | $1.38 |
| 2a | 2026-10-17 23:04 | `11e5c98` + fixture edits | `close-deletes-consumed-keeps-legacy` | 3 | 165 s | $1.37 |
| 2b | 2026-10-17 23:04 | `11e5c98` + fixture edits | `close-pending-doc-owns-continuation` | 3 | 147 s | $1.39 |

Every run took 3 turns and made one Skill call, to `thread:close`.

## Scores

| case | invocation | score | `lifecycle` judge votes, runs 1 / 2 / 3 | tool and regex graders |
|---|---|---|---|---|
| close-deletes-consumed-keeps-legacy | 1 (before) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-pending-doc-owns-continuation | 1 (before) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-deletes-consumed-keeps-legacy | 2 (after) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |
| close-pending-doc-owns-continuation | 2 (after) | 1.00 | PASS×3 / PASS×3 / PASS×3 | all pass, every run |

The JSON holds the votes and the graded last message, but no judge rationale.

## Diagnosis

The baseline already scored 1.00 under the Opus judge, as the 4.0.0 record's single run did. The 0.75s of
the 3.0.0 and 3.1.0 records were Haiku-judged. Reading the six baseline last messages against the rubrics
found no run breaking a close rule: each deleted the consumed doc, left the legacy doc alone, kept and
refreshed the pending doc, proposed no task for the JSON writer or the release, and asked no approval for
commits or memory. So close itself has not regressed, and `skills/close/SKILL.md` is unchanged.

The same six messages show the two fixture defects that leave a stricter judge room to vote FAIL:

1. **No thread file in either prompt.** Both prompts named `exports-migration` but described no THREAD.md,
   and the sandbox's cwd is not under `~/repos`, so close's rung 2 finds nothing and goes to rung 4. All six
   baseline runs hedged: they described the thread update as conditional on a lookup hit, and two offered to
   create the thread instead (one saying a "no" skips the thread update). Both rubrics grade the thread
   file's content, so whether such a run passes is down to the judge.
2. **The consumed-case rubric predates #46.** It required the deletion "committed by pathspec as its own
   file", the pre-#46 one-file-per-commit shape. Since #46 the deletion goes to land.sh, which makes one
   commit per repo holding THREAD.md and the deletion together. All six baseline runs described that one
   landing commit, which is what today's skill says, and which a literal reading of the old bullet fails.

## What changed

- Both prompts now say the thread file is the repo's top-level THREAD.md with `slug: exports-migration`,
  that the repo-thread lookup prints it, what its Where we are says, and that its Resume instructions are an
  absolute pointer at the case's handoff doc (written as `<current directory>/docs/handoffs/…`, so the
  prompts carry no home marker).
- The consumed-case rubric accepts the deletion in a commit of its own or in the repo's one landing commit
  with THREAD.md; the pending-case rubric says the same of the refreshed doc. Both add a "Not graded" bullet
  for whether the close-out is pushed, queued or committed only. No FAIL criterion changed, and the deletion
  or refresh must still be committed by pathspec.

After the change, all six runs updated THREAD.md directly (`<cwd>/THREAD.md` resolved by the lookup), with no
create-or-skip branch. The consumed-case runs replaced the Resume pointer at the deleted doc with real
instructions; the pending-case runs kept the pointer at the pending doc.

p19-5's `--runs 3` baseline will run on these new fixtures. The 4.0.0 record's 1.00 for both cases was on the
old text.

## Tidy

`git status --porcelain --ignored` was empty before invocation 1 and unchanged across invocation 2 (the
fixture edits only), and `evals/results/` never appeared. Results, reports and JSON went to the scratch
directory; `--keep-temp` left the twelve run directories in the system temp directory. Both were removed
afterwards.
