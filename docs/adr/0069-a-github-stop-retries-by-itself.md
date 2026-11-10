# 0069 — A GitHub stop retries by itself

Date: 2026-11-05
Status: accepted. Built in `thread-skill-p37-1-merge-task-waits-out-githubs-lazy-mergeability` (Phase 37, "a rollout never waits on a glitch"), from Lachy's ask on 2026-11-05: "how do we stop this issue from happening again? Can companion fix this by itself next time?" Amends ADR 0033 decision 8 and ADR 0048's retry classes.

*(Amended 2026-11-07 by thread-skill-merge-task-empty-required-checks-reads-as-some: the checks wait takes UNSTABLE as
it takes CLEAN. When `gh pr checks --required` reports no required check and no run is in flight on the head, a PR
GitHub reads UNSTABLE merges at once, whatever the gate read says. `animately-app-rollout-2026-11-07` stalled five of
seven approved PRs without it: Animately/optimizer's `develop` is protected with `contexts: []` and `checks: []`, so
the gate read `some`, and every PR red only on its optional review-app jobs waited for required checks that never
came, then exited 1 "never appeared". The gate read is unchanged: `protected: true` stays `some`. Decision 2 and the
last considered option carry the change.)*

*(Amended 2026-11-11 by thread-skill-integration-wait-ends-on-a-job-no-runner-will-take: a job queued with no runner
for 15 minutes (`MERGE_TASK_NO_RUNNER_LIMIT`; `queued`, no runner_id or runner_name, by its `created_at`) is "no
runner", not CI in flight. Found in compression-engine-rollout-2026-11-08: a job on a self-hosted runner that no longer
exists counted as CI in flight for about 24 hours. Only a self-hosted or custom-label job is read this way: a job whose
`labels` name a GitHub-hosted image (a label starting `ubuntu-`, `macos-` or `windows-`, such as `macos-latest` or
`ubuntu-24.04-arm`, and none `self-hosted`) is never "no runner". GitHub runs 5 macOS jobs at a time and full-suite.yml
queues 4 macOS shards on every master push, so this repo's own required macOS jobs queued 14 and 18 minutes on
2026-11-10; time alone would have set them aside. A GitHub-hosted larger runner on a custom label is the one hosted
job still read by time alone. Optional, it stops counting in `ci_runs_in_flight`, the read behind decision 2's
in-flight test (a run with any other live job still counts). A required roll-up check that `needs:` it is never
created, so the "never appeared" exit 1 names the held jobs after its usual text, still an infra retry. Required (a
pending row of `gh pr checks --required`), `--watch` would hold the lane until GitHub drops the job, so the watch is
sliced by `MERGE_TASK_NO_RUNNER_POLL` (60 s) and the job set aside at once: exit 4, `integration: no-runner: required
job "<name>" queued <n> minutes with no runner (run <r>, job <j>)`, reasonClass `no-runner`, retrying as `infra` under
decision 3's budget. A failed read, labels missing or not a list, or an unparseable timestamp is never "no runner", so
it waits as before.)*

## Context

`chorus-rollout-2026-11-04` halted at 26/27 overnight on one task, `chorus-p96-12` (PR #632), until Lachy woke:

1. merge-task exited 8 three times: GitHub's PR head lagged origin's branch after the lead's push. The automatic retry handled it.
2. Then merge-task exited 1: `required checks never appeared for PR #632 — no CI runs in flight on its head SHA, nothing is coming`. `lachyts/chorus` is a private repo on the free plan, so it can carry no branch protection and no ruleset, and no check is ever required. GitHub computes `mergeStateStatus` lazily after the base moves, and it read UNKNOWN or BLOCKED for longer than the checks wait's 10 polls of 15 s. The next morning, three reads in a row gave CLEAN.
3. The verdict filed that exit 1 as `merge-task needs a human` (H10, `autoRetry: false`). Neither the lead's automatic retry nor Chorus's Upkeep (which sends `/thread:repair` and never answers a `humanFix`) could move it.

Nothing about the task was wrong, and no person's act was needed: a re-run once GitHub settled would have merged it.

## Decision

1. **merge-task reads the default branch's required gate.** Off the CLEAN path, the state machine first reads whether the default branch can carry a required check (`required_gate`: `some`, `none` or `unknown`), at most once per run. It takes two whole-object reads, the branch percent-encoded whole, as merge-gate.py does (ADR 0068):
   - `branches/<b>`: 200 with `protected: true` is `some`, with no rules read; 200 with `protected: false` goes to the rules read; anything else is `unknown` (any 404 or 403 whatever its text, a 200 with no boolean `protected`, no answer within the read tries).
   - `rules/branches/<b>?per_page=100`: a list of under 100 rules, each of a type that never requires a check (`creation`, `update`, `deletion`, `non_fast_forward`, `required_linear_history`, `required_signatures`, and `pull_request`, whose pending review the review gate catches first), is `none`; a list with any other type is `some`; a list of 100 or more, or no list, is `unknown`. A failed read whose stderr holds `Upgrade to GitHub Pro` and `HTTP 403`, and no `rate limit`, is `none`: the free plan's private repo can hold no ruleset. Every other failure is `unknown`: a 404, a primary or secondary rate limit, an integration's 403, a 5xx.

   `none` is read only when two clean GitHub answers both deny any gate. The live reads of 2026-11-05 (read-only GETs, gh 2.43.1) set the endpoint: on `lachyts/chorus`, `branches/main` gives `protected: false` and `rules/branches/main` gives `gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)`. On `lachyts/thread-skill`, `branches/master/protection` gives `gh: Branch not protected (HTTP 404)`, yet `branches/master` gives `protected: true`, because a ruleset requires `make test (ubuntu-latest)` and `make test (macos-latest)`. A `/protection` 404 is therefore a false none on this very repo; `branches/<b>` needs only read access, so a non-admin's "Not Found" or "Must have admin rights" never arises on a readable branch.

2. **A PR GitHub has not settled is re-polled, then exits 8.** With `none`, an UNSTABLE PR merges at once (there is no required check to wait on), and a BLOCKED or UNKNOWN one is re-polled `LAZY_REPOLL_MAX` (6) times, `STATE_INTERVAL` (10 s) apart, then exits 8. With `some` or `unknown`, the required checks are waited on as before; a wait that finds no required check reported, no run in flight on the head and the PR UNSTABLE merges at once, as one that samples CLEAN already did (amended 2026-11-07). GitHub gives UNSTABLE only once every required check has passed: a pending, failing or not-yet-reported one reads BLOCKED. The in-flight test keeps a required check its CI has yet to create waited on. After that wait, UNKNOWN is re-polled the same way, as is an UNKNOWN after the no-CI recompute guard's one CLEAN sample; BLOCKED after green checks stays the non-check gate's exit 1, a gate GitHub has decided. Checks that never appear while nothing runs on the head are exit 1 under `some`, and exit 8 under `unknown`. Each of the three exit-8 texts carries `GitHub has not settled its mergeability` (`MERGE_TASK_SETTLING_MARK`). The state machine's guard is derived, `BEHIND_REPOLL_MAX + LAZY_REPOLL_MAX + 2`: a run takes at most three BEHIND passes, one checks-wait pass and six lazy re-polls before its final pass, so "did not converge" never pre-empts the settling 8.

3. **The lead retries a GitHub stop as infra.** Three routes, each bounded by the budget (`auto_retries`, the infra cool-downs of 15 then 60 minutes, then H10), and each exempt from the same-fingerprint stop, since a second identical GitHub block is no feedback an agent or Lachy can act on:
   - merge-task's exit 1 whose own cause (`_merge_task_cause`) starts `ERROR: required checks never appeared for PR` (`MERGE_TASK_INFRA`), with no red check in it, is set aside at Integration, reason `merge-task exit 1, GitHub-side: <that cause>` (execute § 4.5 step 4, row 1). No code fix clears it, so it never re-enters at its own run.
   - A third exit 8 whose message carries `MERGE_TASK_SETTLING_MARK` is `infra`. Every other `merge-task exit 8 three times` text stays `agent`.
   - A legacy note set aside at its own run with that same exit-1 cause (p96-12's shape) reads `infra` on its next `inputs` and re-enters at its own run, never `merge-task needs a human`.

   `_merge_task_infra_stop` is the one reader of the GitHub-side cause: its own cause holds a `MERGE_TASK_INFRA` text, no `MERGE_GATE_MARK` and no `fail` cell of a check table. A lead that routes a non-check gate text behind the GitHub-side opening gets `agent`, so the same-fingerprint stop still sends its second block to Lachy.

4. **It fails safe.** A false `none` cannot merge a gated PR: merge-task merges only on CLEAN, or on UNSTABLE, which GitHub gives only once the required checks pass (pending or failing required checks read BLOCKED); the squash is head-pinned, and GitHub refuses an unmet requirement with a known text (exit 1). A false `none` also needs two GitHub answers that both deny any gate. Even a PR whose red required check GitHub somehow reported as settling would cost the budget's cool-downs, then H10, never a bad merge. A GitHub reword of the plan text reads `unknown`, which is today's wait.

## Considered options

- **`branches/<b>/protection` for the gate read**, as the task note named it. Refused: it 404s on a branch a ruleset alone protects (`lachyts/thread-skill`'s master), a false none, and it needs admin rights for its full object.
- **A 403 or 404 on the protection read means none.** Refused: a rate limit, an integration's 403 and a branch not on origin read the same way, and a false none skips a real wait.
- **A longer checks wait.** Refused: GitHub stayed UNKNOWN overnight in the incident; no in-run bound covers it, and a long in-run wait holds the Integration lane from every other task.
- **The never-appeared exit 1 retried at its own run.** Refused: an own run re-implements and re-verifies a task nothing is wrong with; the Integration re-entry goes straight to merge-task on an unmoved main.
- **Every merge-task exit 8 as infra.** Refused: ADR 0048 keeps the other exit-8 texts `agent`, a tested contract; only the settling mark is GitHub's by construction.
- **Reading the protection object and rules when `protected: true`**, so a deletion-only ruleset reads none. Left out for fail-safety; a possible follow-on. Built and withdrawn on 2026-11-07, before it landed: `branches/<b>`'s `protection` object holds only `enabled` and `required_status_checks`, never a classic protection's non-check gates (conversation resolution, required deployments, a branch lock). So a protected branch with empty check lists read `none`, and a PR BLOCKED on such a gate re-polled, then exited 8 as GitHub settling and was retried as infra for about 80 minutes, not the exit 1 a decided gate gives (review round `b4e9e6a`/`b35aa0` #1, reproduced). The UNSTABLE case in the checks wait (decision 2) clears that incident without a `none` from a protected branch.

## Consequences

- A protection-less repo never waits on checks, and a PR GitHub has not settled exits 8, never 1. On such a repo, a revert PR stopped the same way gives the pending halt `origin unreachable while reverting` after a third 8, not a lasting *Did not land*.
- UNSTABLE under `none` merges at once. Before, a protection-less repo with red non-required CI waited on required checks that never came, then halted "never appeared".
- The budget can still run out first: about 60 s of re-polls in one run, backoffs of 60 s and 120 s, then infra cool-downs of 15 and 60 minutes, roughly 80 minutes before H10. `auto_retries` is Lachy's knob.
- A BEHIND on an unmoved base still exits 1 after its re-polls ("stays BEHIND", a human's text). With a strict up-to-date rule it is GitHub's stale state too; a possible follow-on.
- **Amends ADR 0033 decision 8.** merge-task's exit 1 stays an allowlist of fixable texts, but a GitHub-side exit 1 is no human's text either: it retries as `infra`.
- **Amends ADR 0048's retry classes.** `merge-task exit 8 three times` stays `agent`, except when its message carries `MERGE_TASK_SETTLING_MARK`.
