# 0068 — Schedule reads the merge gate

Date: 2026-11-03
Status: accepted. Built in `wave-ralph-verifier-lint-gap` (rescoped 2026-11-03 from the retired wave plugin's "close the lint gap in the convergence loop"), on the decision Lachy gave ahead that day: "Switch, and tell me". It is thread-skill's side of giflab ADR 0012 d4.

## Context

A rollout's `verifier:` can be weaker than the repo's required merge checks. Ralph and the master review then converge on green, and the PR halts at merge on a check the verifier never ran. It has happened twice on giflab:

- 2026-07-06, `giflab-rollout-2026-07-05`: PR #7 halted on CI's pinned formatter.
- 2026-11-02, `giflab-rollout-2026-11-02`: all four PRs (#127–#130) halted on lint debt that had built up on `main` while CI was dark. `make test` ran no lint at all.

giflab fixed its side with a local gate (`make check` per task and `make check-full` at completion, giflab ADR 0012). It declares both in its root `CLAUDE.md` as `Verifier:` and `Completion verifier:`. giflab ADR 0012 d4 asks the rollout tool to check a rollout's verifier against the repo's merge gate at schedule time, so no other repo hits the same trap.

The task's rule is repo-agnostic. The plugin hardcodes no linter, and a gate command only ever comes from the project's `CLAUDE.md` `Verifier:` line.

## Decision

1. **The facts come from a read-only script.** `skills/_shared/scripts/merge-gate.py` makes two `gh api` GETs, `repos/<o>/<n>/branches/<b>` and `repos/<o>/<n>/rules/branches/<b>`. They give the required contexts of branch protection and rulesets. The script then reads `.github/workflows/` at `origin/<default>`, never the working tree, and prints one JSON line. It reports `none` only when both reads return 200, the protection is visible, and nothing is required. A branch read that is not 200 is `unreadable`: a 404 is also a private repo this gh account cannot see, or a branch not on origin. So is a missing gh, a logged-out gh, a timeout or an origin error. A rules read that fails alone gives `partial`, and so does a protection object this account cannot see. It never stops a schedule: anything it did not expect reads `unreadable`, with exit 0.

2. **What counts, and what is covered.**
   - A required context's **closure** is the job it names, that job's transitive `needs:`, and the jobs of the local reusable workflow it calls. Every output job carries `contexts`: each context whose closure holds it.
   - A job **counts** when it can run on a task's PR, read from its triggers, their filters and its `if:`. An expanded callee job is counted by its caller's triggers and its caller job's `if:`, together with its own `if:`. A callee's own `on: workflow_call` never excludes it.
   - A job is **read** when the script named no read gap on it and each step shows what it runs. The read gaps are a remote or nested reusable workflow, a local action it did not expand, a step, matrix or env cut at 2000 characters, and a closure cut at 64 jobs. No read by hand clears one.
   - An entry is **compared** only when it is not cut, has a counted job, and every counted job in its closure is read. Only a compared context is ever called "covered". With nothing compared, the statement is `merge gate: not read (…)`.
   - The **job classes** (a lint or format check, a type check, a test tier the verifier's runner never collects, a build) come from what the steps run, never from a tool list.

3. **Switch to the declared `Verifier:` when it strictly shrinks the gap, and tell (Lachy, 2026-11-03).** When the verifier in hand was user-provided rather than the project's declared `Verifier:`, and the declared command's own gap is a strict subset of the in-hand one's, schedule switches to it. It says so in the confirm batch and in step 8 (`verifier switched: …`). The switched command is the verifier from then on: steps 2.6, 2.9, 6 and 8. Every other case is a statement, never a question or a stop:
   - a class the declared `Completion verifier:` runs is noted as run at completion (estate ADR 0009 d6);
   - any class left is named, with the remedy: declare a covering `Verifier:` in the repo's `CLAUDE.md`, then `--regenerate`.

4. **The `merge-gate` reasonClass, read off the stop's own cause.** A converged PR whose merge then stops on a red required check is set aside at its own run with reasonClass `merge-gate`. It is recorded only when merge-task's red-check text (`MERGE_GATE_MARK`) is on the reason's last `ERROR:` line, or anywhere in a reason with no `ERROR:` line. merge-task.sh prints that text before each infra rerun, so a mark followed by a rerun and then a different `ERROR:` line stays `merge-task`. The lead's reason for merge-task's exit 1 is its output from the last `ERROR:` line to the end. Both readers take that one reason: the record's class and the automatic retry's `MERGE_TASK_FIXABLE`. Reflect § 11 traces a `merge-gate` set-aside to schedule § 2.5 as a schedule-time miss when the failed check runs a class the verifier never runs. Otherwise it reads it as drift between CI and the local run.

## Considered options

- **A tool list** (a known set of linters to look for in CI steps). Refused: it is not repo-agnostic, and it goes stale with every new tool.
- **Deriving the gate command from CI's steps.** Refused: the verifier is the project's to declare, and a CI step runs in CI's environment, not a worktree's.
- **Stopping, or asking, on a gap.** Refused: it is a technical call, decided for Lachy, and a stop would hold back every task, most of which never touch the gap.
- **Matching the red-check mark anywhere in the reason.** Refused: merge-task.sh prints the mark before each infra rerun, so a later, different stop would read as a red check.
- **A boolean field on the set-aside event.** Refused: `reasonClass` is an open string, and every reader (score, ledger, reflect, attention) already traces by class.

## Consequences

- A repo whose merge gate runs a class its verifier skips is named at schedule time, in the confirm batch and step 8, with its remedy. A covering declared `Verifier:` replaces a weaker user-provided one by itself.
- The script reads with whatever gh account is logged in. An account with fewer rights gives `partial` or `not read`: a noisier statement, never a wrong one.
- The class judgement and the reading of filters and `if:` stay the schedule agent's, so they are not deterministic. The facts, closures and read gaps are deterministic, and every error leans to "unread" or a gap, never a false "covered".
- GitHub reports a required job that a red `needs:` skipped as passing. That is not reimplemented: such a needs job is still counted, so the error is a spurious gap, never a false "covered".
- New Run records shift some `merge-task` tallies to `merge-gate`. Old lines keep their class.
- A repeat of `merge-gate` on one repo is the Reflection's cue to revisit that repo's verifier split, as giflab ADR 0012's revisit trigger asks.
