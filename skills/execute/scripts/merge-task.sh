#!/usr/bin/env bash
# merge-task.sh — merge ONE integrated PR, and only onto the base its Integration used (ADR 0030, p12-7).
#
# Usage:  merge-task.sh <repoPath> <pr> <integrated-head-sha> <integrated-base-sha>
#         merge-task.sh --classify-steps < <failed step names>   the classifier's verdict alone (land-carrier.py)
#   <repoPath>   absolute path to the target repo (origin must be a github.com remote).
#   <pr>         a positive PR number, or a https://github.com/<o>/<r>/pull/<N> URL (an optional /…, ?… or #…
#                suffix is fine) in origin's repo, compared case-insensitively: the lead passes the row's `pr`
#                URL as-is. It is normalised to <N> before any use, so one PR has exactly one counter file,
#                and every message and every gh call uses the number. A leading zero, `0`, an issue URL,
#                another host (GHES, www.) or another repo's URL exits 2 with zero gh calls.
#   <integrated-head-sha> <integrated-base-sha>
#                40 lowercase hex each: the `integrate` row's integration.headSha and integration.baseSha
#                (task.workflow.js, "The lead contract for Integration": hand them to p12-7; the integrated
#                head, not the anchor), or the lead's own clean-path merge, or on a cold resume the last
#                `integrated` line of the task's `## Integration log`.
#
# The merge half of a queued rollout. The lead calls it once per integrated task; it is the ONLY place a
# rollout merges (the engine, task.workflow.js, never merges). It merges the PR only when origin/<default>
# still equals the integrated base and the PR head still equals the integrated head, pins the merge to that
# head (`gh pr merge --squash --match-head-commit`), confirms the merge by re-reading the PR, and verifies
# the squash commit: head = integrated head and exactly one parent, the integrated base.
#
# Exit codes (single source for p12-9; "counter" is the base-moved cap state, see Cap):
#   0  Merged, or already merged; verified (head = integrated head, one squash parent = integrated base).
#      The local refresh ran, or printed a non-fatal WARN or NOTE (non-base checkout, a half-applied
#      operation, local-only commits, a dirty tree or an autostash refusal, git's own refusal, a
#      live-checkout.sh that cannot be loaded), and the in-place checkout's refresh line (a clone root only,
#      ADR 0042; it never changes the exit). Every merged path (0, 5, 6 and an UNVERIFIED 8) first records each
#      required job's CI headroom (ADR 0073 d5: lead-integrate.py ci-headroom, best-effort, never an exit).
#                                                                        counter cleared    lead: mark-done
#   1  Definitive halt; the reason is printed (Exit 1 causes, below).   counter cleared    lead: set aside
#                                                                                          (own run, or at
#                                                                                          Integration when
#                                                                                          GitHub-side)
#   2  Usage or environment: bad arg count; a SHA not 40-hex; <pr> neither a positive number nor a
#      github.com/<o>/<r>/pull/<N> URL; a URL whose <o>/<r> is not origin's; gh, git or python3 missing;
#      not a repo; no origin; a MERGE_TASK_* override that is not a non-negative integer (at most 9
#      digits); the counter cannot be persisted; the Engine snapshot guard (ADR 0043: a live task note
#      names the PR and its rollout runs on another Engine snapshot than this script's root, or a live
#      one whose snapshot is unusable: engine-snapshot.py guard-pr's `engine-snapshot: ` line, so the lead
#      re-runs this same call from the root that line names, never a halt). Every one is before any
#      GitHub call.
#                                                                        counter UNTOUCHED  lead, by its stderr
#      line (ADR 0048, p29-7): `engine-snapshot:` → re-run from the root it names; `ERROR: merge-task args:` (a
#      SHA not 40-hex, a <pr> it cannot parse, a URL in another repo: this task's own arguments) → set this task
#      aside at its own run; anything else (the environment) → hold the Integration lane for a human (execute
#      § 4.5 *Lane hold*). A revert PR's 2 still halts the rollout (it protects main).
#   3  BASE MOVED: origin/<default> ≠ the integrated base. Nothing merged. Each newly counted refusal (the cap's
#      4th included, never "this base was already counted") records why main moved in the task's Run record
#      (lead-integrate.py base-moved, p29-10: the movers base..main and whether only Inert paths moved).
#                                                                        counter appended   lead: re-integrate
#                                                                                          on the same anchor
#      (the lead's `lead-integrate.py prepare` may then route `skip`: when main moved only in the repo's Inert
#      paths and the Inert proof holds on the new merge, the green run stands and no verifier re-runs, ADR 0045;
#      the cap below still counts each base move)
#   4  Set aside AT Integration. Prints `set-aside reason: integration: <why>` on stdout and stderr:
#      (a) the cap: `integration: base moved before the merge 4 times in a row after 3 re-integrations
#      (bases …)`; (b) `integration: head moved after Integration (PR head <h>, origin <b> at <r>, integrated
#      head <i>)`, only when origin's branch (ls-remote) ≠ the integrated head; (c) `integration: no-runner: required
#      job "<name>" queued <n> minutes with no runner (run <r>, job <j>)` (No runner, below).
#                                                                        counter cleared    lead: mark blocked;
#      the diagnosis's first line is the text after `set-aside reason: `, which reconcile reads as
#      `setAsideAt: integration` (reconcile-rollout.py INTEGRATION_PREFIX).
#   5  Terminal RACE: MERGED, but headRefOid ≠ the integrated head, or the squash parent ≠ the integrated
#      base, or the squash has more than one parent (every read succeeded). Prints `RACE: PR #N merged as
#      <oid> on parent <p> at head <h>, not the integrated pair (head <i>, base <b>); origin/<default> holds
#      an unverified combination; re-verify it`.                         counter cleared    lead: never
#                                                                                          re-call (below)
#   6  MERGED and verified, but the local refresh failed twice (on each try the fetch failed or timed out
#      after MERGE_TASK_FETCH_TIMEOUT seconds, or origin/<default> lacked the merge commit).
#      Never says "fast-forwarded".                                      counter cleared    lead: re-run; it
#                                                                                          takes the already-
#                                                                                          merged path → 0
#   7  Review required: BLOCKED or UNKNOWN with reviewDecision REVIEW_REQUIRED or CHANGES_REQUESTED. Prints
#      `review required: approve PR #N (<url>); merge-task never bypasses protection`. Nothing merged.
#                                                                        counter cleared    lead: pause for a
#                                                                                          human approval,
#                                                                                          then re-run
#   8  Retryable, nothing decided: a GitHub read failed transiently after MERGE_TASK_READ_TRIES; origin's
#      head branch unreadable; GitHub's PR head still lags origin's branch (which holds the integrated head)
#      after HEAD_LAG_MAX reads; GitHub refused with `Head branch was modified` while the PR head and
#      origin's branch both read the integrated head; a transient `gh pr checks` error with no red row; a
#      merge call that failed with unrecognised text and changed nothing; GitHub has not settled the PR's
#      mergeability (ADR 0069 d2; each such text carries `GitHub has not settled its mergeability`): it stays
#      UNKNOWN or BLOCKED with nothing required on the default branch, or UNKNOWN after its required checks
#      went green, for LAZY_REPOLL_MAX re-polls, or no required check is reported and nothing runs on its
#      head while the default branch's gate is unreadable, and the wait never samples CLEAN, nor UNSTABLE when
#      entered from UNSTABLE; or MERGED, but the head or parent unreadable within the bound (`UNVERIFIED: PR
#      #N merged as <oid or unknown>; not verifiable yet; re-run to verify`).
#                                                                        counter UNTOUCHED  lead: re-run the
#                                                                                          same args after a
#                                                                                          backoff, bounded
#                                                                                          by p12-9, then pause
#   70  Abort: the run ended outside `finish` and the signal traps, i.e. a defect such as a `set -u` abort.
#      bash 3.2 exits those with 1, or (an unset name inside `$((…))`) with the last command's status, often
#      0, which would read as "merged"; the EXIT trap turns every such exit into 70. Sentinel `failed:abort`.
#                                                                        counter UNTOUCHED  lead: hold the
#                                                                                          Integration lane
#                                                                                          for a human (a
#                                                                                          re-run aborts
#                                                                                          again; ADR 0048)
#      A revert PR's 70 still halts the rollout (it protects main).
#   143 130 129  A signal: TERM, INT, HUP (their traps). Sentinel `failed:<rc>`. When it cut a wait, the last line is
#      `  last wait: <the wait it was in>` (LAST_WAIT: the head-lag re-read, the required-checks wait and its pending
#      checks, the in-flight wait and the jobs it waits on, a settling or BEHIND re-poll), on stdout: the lead's
#      `signalled twice` reason copies it, so a kill reads as what it was waiting on (ADR 0033 d4 as amended
#      2026-11-12). A KILL skips the trap; then the last line is the wait line itself, which names its wait by one of
#      reconcile-rollout.py's MERGE_TASK_WAIT_WORDS (`waiting`, `re-polling`, `re-reading`).
#                                                                        counter UNTOUCHED  lead: re-run
#                                                                                          (idempotent)
#
# Exit 1 causes: the PR is off the default branch, CLOSED, or has an unexpected state or mergeStateStatus
# (DRAFT, HAS_HOOKS, anything else); a definitive not-found (`HTTP 404`, `HTTP 422`, `Could not resolve
# to a`); the PR's head branch is absent on origin while GitHub's PR head ≠ the integrated head (a
# cross-repository PR or a deleted branch); the head does not contain the base; DIRTY, or BEHIND after a
# bounded re-poll, on an unmoved base; a red required check on a genuine step; required checks that never
# appeared while something is required, and the wait never sampled CLEAN, nor UNSTABLE when entered from
# UNSTABLE (the lead sets it aside at Integration and retries it as GitHub-side infra: no code fix clears it,
# ADR 0069 d3); a required check CANCELLED (a CI timeout or another stop on GitHub's side, no test
# failed) again after one re-run of its failed jobs, or whose re-run cannot start (GitHub-side too, its own
# reasonClass ci-timeout, ADR 0073 d4; gh exits 0 on it, so a 0 with a red cell is never read as green); a
# non-check gate (checks green, still BLOCKED, no review pending); a merge queue
# is required, or `isMergeQueueEnabled` is absent from the schema; GitHub refused the merge with a known
# text (`is not mergeable|HTTP 405|HTTP 409|HTTP 422|
# Required status check|protected branch|merges are not allowed|Repository rule violations found`: a repo
# that disallows squash merges, or a ruleset, refuses every re-run alike; `Head branch was modified` is NOT
# in this list: origin's branch decides it); gh returned 0 but the PR was not confirmed MERGED.
#
# 8 vs 1. A read is retried MERGE_TASK_READ_TRIES times; it is definitive (1) only when its last attempt
# failed with `HTTP 404`, `HTTP 422`, `Could not resolve to a` or `doesn't exist on type` on stderr (on a
# private repo a 404 can also mean no access: a human fix). Anything else, including rc 0 with a required
# field missing, is 8. Legitimately empty fields are never required: reviewDecision is "" on a repo with no
# review rule, autoMergeRequest is null unless auto-merge is on, mergeCommit is null before the merge. Every
# GitHub read takes the whole --json object (never a single-field -q read) and pulls fields out of it.
#
# Exit 5 procedure. merge-task never verifies a combination it did not pin, so 5 is terminal for the
# script: the lead never re-calls it for that PR, including the cold-resume flush. The lead 1. records the
# RACE line as a Lead action; 2. runs the rollout verifier on the merge commit; 3. on green, mark-dones the
# task itself, keeping the RACE line; 4. on red, pauses the rollout for a human. On every MERGED path the
# exit precedence is 5 > 8 > 6 > 0, and the refresh WARN is printed regardless, so the cold-resume flush can
# never turn a RACE or an UNVERIFIED into `ok`.
#
# The head pin. GitHub's PR record (headRefOid) can lag a push the lead just made; origin's branch, read
# with `git ls-remote` (the same read Integration verifies its push with: task.workflow.js pushedSha), is
# the authority. When headRefOid ≠ the integrated head, origin's branch decides: absent → 1 (merge-task
# merges only a same-repo head); unreadable → 8; ≠ the integrated head → 4 (`head moved after
# Integration`); = the integrated head → GitHub lag: re-read the PR up to HEAD_LAG_MAX times,
# MERGE_TASK_HEAD_LAG_INTERVAL apart, then 8. ls-remote is spent only on a mismatch or after a `Head branch
# was modified` refusal. The merge itself is pinned (--match-head-commit), so GitHub either merges exactly
# the integrated head or refuses.
#
# The base. origin/<default> is read before the state machine and again immediately before the merge; a
# moved base is 3 (the cap below), never an update: no REST update-branch, ever. Integration replaces it
# (ADR 0030): a stale branch is re-integrated on the same anchor by the lead, and merge-task is called again
# with the new pair. Where the repo enforces an up-to-date base GitHub refuses a race after the re-check
# (BEHIND, or a refusal whose re-read shows the moved base: 3); without that protection a race merges and
# the verification flags it (5). A required merge queue is refused (1): merge-task cannot pin the base it
# merges onto. The compare check (head contains the base) refuses a pair that was never integrated.
#
# Merge confirmation. gh's exit 0 is never trusted as "merged" (a merge queue or auto-merge also exits 0):
# the PR is re-read until MERGED, MERGE_CONFIRM_MAX times MERGE_TASK_CONFIRM_INTERVAL apart. Never MERGED →
# auto-merge is disabled when it is set (best effort) and the exit is 1, "not confirmed merged"; a later
# landing is verified by the re-run's already-merged path. A failed merge call is decided by re-reads, in
# order: MERGED → verify; base moved → 3; head ≠ integrated head → the head pin; `Head branch was
# modified` → origin's branch (4, 1, 8); review pending → 7; a known refusal → 1; else 8 (safe: a re-run is
# head-pinned and takes the already-merged path if the merge did land).
#
# Cap. What "after 3 in a row" counts is re-integrations: Integration, refusal 1, re-int 1, refusal 2,
# re-int 2, refusal 3, re-int 3, refusal 4 → exit 4 (MERGE_TASK_REINTEGRATE_MAX, default 3). The state is
# <repoPath>/.claude/merge-task/<N>.base-moved, one refused integrated base per line. The append and the
# compare run inline before `exit` (record_base_moved): a base already recorded (the same attempt called
# again) is 3 without appending; otherwise append and check it landed (a failed append is 2: the cap fails
# closed, never an endless 3); more distinct bases than the cap is 4, else 3. The EXIT trap only deletes or
# keeps the file, and only when the exit went through `finish`: 0, 1, 4, 5, 6 and 7 delete it (a failed
# delete is a WARN: a stale counter can only set a task aside sooner, the safe direction); 2, 3, 8, a
# signal and an abort keep it, so an interrupted or transient run neither resets nor consumes the budget.
# A write probe right after the PR parse makes an unpersistable counter a 2 before any GitHub call.
#
# Review gate (p6-6). gh refuses a BLOCKED PR client-side unless --admin is passed, and a raw API merge
# would bypass every unmet requirement for an admin account. So a PR whose only gate is a pending review
# halts at once with 7 instead of burning the checks-wait budget; merge-task never passes the bypass flag.
# A per-rollout opt-in for review-gate-only repos is Lachy's call, not built.
#
# Sentinel `<repoPath>/.claude/merge-task.status` (finding #5): a backgrounded `merge-task.sh … & wait; echo
# done` wrapper reports the trailing command's exit, not the script's, masking a real halt as success. The
# lead calls once per PR, so the previous call's `ok` is always on disk: the file is cleared as soon as $1
# resolves to a git repo, before the arg count is checked (a $1 that no longer resolves, git missing or a
# broken checkout, has an existing sentinel there cleared too). It is written by the EXIT trap: `ok` only
# when $? is 0 AND the exit went through `finish 0`; `failed:<code>` for every other finish (every exit 2
# included) and for a signal; `failed:abort` for 70. TERM, INT and HUP traps exit 143, 130 and 129, so a
# killed run never reads `ok` (bash 3.2 reaches the EXIT trap with $?=0 after a SIGTERM during a foreground
# child).
#
# GitHub's lazy mergeability (ADR 0069). GitHub recomputes mergeStateStatus lazily after the base moves, and can
# read UNKNOWN or BLOCKED for hours on a PR nothing gates. Off the CLEAN path the state machine first reads the
# default branch's required gate once (required_gate: some, none or unknown). With none (two clean GitHub answers
# deny any gate) an UNSTABLE PR merges at once, and a BLOCKED or UNKNOWN one is re-polled LAZY_REPOLL_MAX times,
# then exits 8; with some or unknown the required checks are waited on; a wait that finds no required check
# reported hands back on a CLEAN sample, and merges on an UNSTABLE sample when the state machine entered from
# UNSTABLE, before any in-flight read. After that wait, UNKNOWN is re-polled the same way, while BLOCKED stays the
# non-check gate's 1. Checks that never appear while the gate is unreadable are 8, never 1.
#
# No runner (ADR 0069, amended 2026-11-11). A job GitHub queued that no runner took (a self-hosted runner that no longer
# exists) stays queued about 24 hours, and read as CI in flight the whole time. A job is "no runner" when it is `queued`
# with neither a runner_id nor a runner_name, `created_at` at least MERGE_TASK_NO_RUNNER_LIMIT seconds ago (900, 15
# minutes), and its `labels` place it on a self-hosted or custom-label runner. A job whose labels name a GitHub-hosted
# image (a label starting `ubuntu-`, `macos-` or `windows-`: macos-latest, ubuntu-24.04-arm) and none `self-hosted` is
# never "no runner": GitHub runs 5 macOS jobs at a time, so this repo's own required macOS jobs queue past 15 minutes
# behind full-suite.yml's shards. Only a GitHub-hosted larger runner on a custom label is still read by time alone.
# no_runner_read reads it, job by job, on the integrated head; a read that fails, labels missing or not a list of
# strings, or a field that does not parse is never "no runner", so a bad read waits as before. Optional, it stops
# counting: ci_runs_in_flight drops a run held only by such jobs (a run with any other live job, or whose jobs page
# lists fewer than its total_count, still counts); a required roll-up check that `needs:` one is never created, so
# "never appeared" names the held jobs. Required (a pending row of `gh pr checks --required` whose link names that job,
# or, a row with no job link, the job's name): the watch is cut every MERGE_TASK_NO_RUNNER_POLL seconds to look, and
# exit 4 sets the task aside at Integration at once, because `--watch` would otherwise hold the lane until GitHub drops
# the job. A live-checkout.sh that cannot be loaded leaves the watch uncut, today's wait. While CI is in flight the wait
# line names what it waits on (NR_LIVE): each unfinished job on the head as `<name> (<status>)`, a no-runner one
# `(queued, no runner)`, deduped and capped at 8 plus `+N more`, no minutes or ids (an unread jobs page adds nothing,
# and none read leaves today's line). Each cut slice names the required checks still pending, once per change.
#
# Carried over from the earlier merger: required checks are the gate (UNSTABLE handling, infra reruns, an absent check
# read as pending while CI is in flight, the CLEAN re-poll); the squash merge; the best-effort REMOTE branch
# delete (`gh pr merge --delete-branch` would `git branch -d` a branch checked out in the task's worktree,
# which git refuses, turning a successful merge into a non-zero exit; local cleanup is the reaper's). Never
# --admin, never a force-push. `finish` sets FINAL_RC and exits; it never runs inside $(…) or a pipeline.

set -uo pipefail

# A caller's GIT_DIR, GIT_WORK_TREE & co. (a git hook exports them) would override -C: the fetch and the
# fast-forward would move another repo's refs, and the self-test's pushes would reach its remote (p12-3).
# Unset git's own list of repo-local vars, except the two config channels, which cannot move the repo.
# Before both --self-test-* hooks and the main path (so ls-remote reads <repoPath>'s origin).
for v in $(git rev-parse --local-env-vars 2>/dev/null); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done

# ---- tuning (the MERGE_TASK_* overrides exist for the hermetic tests; validated before any GitHub call) ----
CHECK_RETRY_MAX=10     # consecutive "no required checks AND no CI in flight" polls before halting (1), or exit 8
                       # when the gate is unreadable
CHECK_INTERVAL=${MERGE_TASK_CHECK_INTERVAL:-15}          # gh pr checks --watch refresh
NO_RUNNER_LIMIT=${MERGE_TASK_NO_RUNNER_LIMIT:-900}       # seconds queued with no runner before a job reads as "no runner"
NO_RUNNER_POLL=${MERGE_TASK_NO_RUNNER_POLL:-60}          # seconds per watch slice between no-runner reads (0 reads as 1)
STATE_INTERVAL=${MERGE_TASK_STATE_INTERVAL:-10}          # re-poll of a BEHIND state on an unmoved base, and of a
                                                         # PR GitHub has not settled
BEHIND_REPOLL_MAX=3    # BEHIND re-polls on an unmoved base before halting (within the guard)
LAZY_REPOLL_MAX=6      # re-polls of a PR GitHub has not settled (ADR 0069 d2), STATE_INTERVAL apart: ~60 s, then 8
# Bound the state machine. A run takes at most BEHIND_REPOLL_MAX BEHIND passes, one checks-wait pass and
# LAZY_REPOLL_MAX lazy re-polls before its final pass, so "did not converge" never pre-empts the settling 8.
STATE_GUARD_MAX=$((BEHIND_REPOLL_MAX + LAZY_REPOLL_MAX + 2))
INFRA_RERUN_MAX=2      # finding #4: transient-infra reruns of a failed required job before halting
CANCEL_RERUN_MAX=1     # ADR 0073 d4: re-runs of a CANCELLED required check's failed jobs before its GitHub-side exit 1
MERGE_CONFIRM_MAX=5    # re-reads of state (after gh merge) and of mergeCommit (verify) before giving up
CONFIRM_INTERVAL=${MERGE_TASK_CONFIRM_INTERVAL:-2}
READ_TRIES=${MERGE_TASK_READ_TRIES:-3}                   # attempts per GitHub read (and per ls-remote)
READ_INTERVAL=${MERGE_TASK_READ_INTERVAL:-5}
HEAD_LAG_MAX=6         # PR re-reads while GitHub's head lags origin's branch at the integrated head
HEAD_LAG_INTERVAL=${MERGE_TASK_HEAD_LAG_INTERVAL:-5}
REINTEGRATE_MAX=${MERGE_TASK_REINTEGRATE_MAX:-3}         # re-integrations allowed; the next refusal sets aside
FETCH_TIMEOUT=${MERGE_TASK_FETCH_TIMEOUT:-60}            # seconds per try of the local refresh's fetch (0 reads as 1)

# ---- infra-vs-genuine failure classifier (finding #4) ----------------------
# A red REQUIRED check can be a transient CI infra/setup flake (dependency-install timeout, network blip,
# runner provisioning) rather than a genuine test failure. We rerun the former a bounded number of times;
# we NEVER rerun the latter (that would mask a flaky test as a false green). classify_failed_steps reads
# the FAILED step names (one per line, on stdin) and prints "infra" ONLY when it can prove every failed
# step is setup/provisioning; anything else — a test/lint/build step, an unrecognised step, or no steps at
# all — is "genuine". FAIL-CLOSED by construction: the burden of proof is on "infra".
# Defined up here (before arg parsing) so the --self-test-classify hook can exercise it with no live GitHub.
classify_failed_steps() (  # stdin: failed step names; stdout: "infra" | "genuine"
  local saw=0 verdict=infra line words
  # Plain [[ =~ ]] (an unquoted variable is an ERE on bash 3.2 too) under nocasematch, scoped by the
  # subshell body: no per-line fork.
  # The denylist stays a SUBSTRING match on the raw line: a false hit only makes a step genuine, so the
  # wider match is the fail-closed side ("unittest", "e2etests", "rebuild" all stay genuine). verif/validat
  # catch verification steps whose other words look like setup ("Restore and verify DB snapshot").
  local deny='test|pytest|assert|spec|lint|mypy|type ?check|coverage|benchmark|compile|build|verif|validat'
  # The allowlist is the proof of "infra", so it matches WHOLE WORDS only: a token inside another word
  # proves nothing ("pip" in "pipeline", "apt" in "adapter"/"capture", "fetch" in "prefetch"). Portable word
  # boundaries (\b and [[:<:]] differ between GNU and BSD regex): every non-alphanumeric becomes a space and
  # the line is padded with spaces, so each token is matched as " token ". Inflections are spelled out:
  # every setup VERB carries its -s/-ed/-ing forms (an unlisted form would silently classify genuine).
  # Nouns and tool names (checkout, setup, pip, poetry, yarn, apt, brew, npm ci) stay bare. There is no
  # "npm install" token: its "install" word already matches, so one would be dead and untestable.
  # KNOWN GAP (follow-up, out of scope here): ONE whole-word allowlist hit still makes the WHOLE line
  # infra, however much real work the rest of the step names. "Restore DB snapshot and check integrity",
  # "Download fixtures and compare golden output", "Configure and run e2e", "yarn jest" and "pip-audit"
  # all classify infra today; verif/validat in the denylist covers only the "verify" wording. Likely fix:
  # a word-bounded denylist of work verbs (check, compare, diff, e2e, smoke, audit) where "check" must
  # not match "checkout".
  local allow=' (install(s|ed|ing)?|dependenc(y|ies)|set *up|checkout|cach(e|es|ed|ing)|download(s|ed|ing)?|provision(s|ed|ing)?|restor(e|es|ed|ing)|bootstrap(s|ped|ping)?|configur(e|es|ed|ing)|pip|poetry|npm +ci|yarn|apt|brew|fetch(es|ed|ing)?|clon(e|es|ed|ing)) '
  shopt -s nocasematch
  while IFS= read -r line; do
    [[ $line =~ ^[[:space:]]*$ ]] && continue
    saw=1
    # Denylist FIRST (fail-closed): anything that looks like the actual test/build/lint work is genuine.
    if [[ $line =~ $deny ]]; then
      verdict=genuine; break
    fi
    # Allowlist: recognised setup/provisioning/network steps. An UNRECOGNISED step ⇒ genuine (fail-closed).
    words=" ${line//[^[:alnum:]]/ } "
    if [[ $words =~ $allow ]]; then
      :  # infra-looking — keep scanning the rest
    else
      verdict=genuine; break
    fi
  done
  [ "$saw" -eq 1 ] || verdict=genuine   # no parseable steps ⇒ cannot prove infra ⇒ genuine
  printf '%s' "$verdict"
)

# `merge-task.sh --classify-steps`: classify_failed_steps on stdin's failed step names, its verdict on one line (infra |
# genuine), exit 0. The landing carrier's rerun rule (land-carrier.py, ADR 0078 d2) reads this, the one copy of the
# classifier. Before any other top-level code, so it needs no argument, repo, gh or GitHub.
if [ "${1:-}" = "--classify-steps" ]; then classify_failed_steps; echo; exit 0; fi

# ---- local base refresh --------------------------------------------------------------------------------
# After the PR lands, fast-forward the checkout at repoPath — only when it is on the base branch; a
# checkout on any other branch is left exactly as it is. No agent reads this checkout any more: every
# task has its own tree cut from a freshly fetched origin/<base> (ADR 0030, p12-4; execute SKILL.md
# § Worktree lifecycle). The refresh stays for three reasons: operator convenience; it is where stranded
# close-outs get named; and the worktree reaper depends on it — prune_worktrees measures `ahead` against
# this LOCAL base branch, so a zero-commit task branch (a plan-blocked or gate-pending task's tree) is
# reaped only after it advances. A checkout left behind is therefore still reported. Local-only commits on the
# base (a close-out whose landing PR is queued, or one no close/… branch carries) are named with close's
# own repo-state.sh line — one source for the wording — so they are never stranded silently.
# Every git step runs through skills/_shared/scripts/live-checkout.sh, the one primitive for a live checkout (ADR
# 0066's amendments, p37-7 and p39-4), loaded here lazily; one that cannot be loaded is a WARN, rc 0, with nothing
# fetched or moved. Every ref is the full refs/remotes/origin/<base>: the short origin/<base> would name a local
# branch of that name first. In order:
#   1. Two fetch tries. One try is lc_ssh_rule, then lc_fetch (one branch, no tags, no FETCH_HEAD) under lc_bounded
#      (FETCH_TIMEOUT seconds; a TERM, INT or HUP to this script kills the fetch's group too), inside its own subshell
#      so the ssh rule's two exports never reach this shell (refresh_in_place's twin reads its own core.sshCommand),
#      AND, when a SHA is given (the merge commit), origin/<base> containing it. Both failing (`… failed`, `… timed out
#      after <t>s`, `origin/<base> lacks merge <sha>`, the last one named) returns 6 with `NOT refreshed` and moves
#      nothing: a fast-forward after a failed fetch would land the checkout on a stale ref and still claim a refresh
#      (p6-7).
#   2. A half-applied operation (lc_op: a rebase, merge, cherry-pick, revert, bisect or sequence) is a WARN that names
#      it, before the branch is read, so a rebase's detached HEAD never reads as "on 'HEAD'".
#   3. A checkout on another branch is the non-base NOTE.
#   4. No merge runs unless HEAD is strictly behind origin/<base>: git 2.47 writes ORIG_HEAD on an equal no-op, an
#      ahead no-op and a diverged ff-only, so equal or ahead says "already at or ahead" and diverged goes to the
#      naming below, ORIG_HEAD untouched. Strictly behind is lc_ff: the overlap first (a dirty or untracked path
#      origin's commits would overwrite is refused with its paths, no merge run), then `merge --ff-only
#      --no-autostash` (with `merge.autoStash true` a dirty overlap would be stashed, applied and popped into
#      conflict markers). A refusal the overlap cannot see (an index.lock, a case-only collision) is git's, with
#      git's reason, and rewrites ORIG_HEAD: the residual.
# Every refusal but the fetch's (a non-base checkout, an operation, local-only commits, a dirty tree, git's own) is a
# non-fatal WARN or NOTE and returns 0 (a false halt after a successful merge). Defined before the self-test hooks so
# --self-test-base can exercise it against a temp repo. For a rollout clone (every rollout scheduled after ADR 0042)
# repoPath is the clone, so refresh_in_place (below) then fast-forwards its in-place twin.
REPO_STATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../../close/scripts/repo-state.sh"
LIVE_CHECKOUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../../_shared/scripts/live-checkout.sh"
refresh_bounded() { lc_bounded "$FETCH_TIMEOUT" "$@"; }   # lc_fetch's runner: one command word
refresh_local_base() {  # $1=repoPath  $2=base branch ('' ⇒ unresolved)  [$3=a SHA origin/<base> must contain]
  local repo="$1" base="$2" must="${3:-}" cur ff=0 line='' raw='' why='' n before tip oh try frc fwhy='' t m o='' orc=''
  local reaper="        origin/$base holds the merges and later tasks' worktrees branch from it; the worktree reaper keeps zero-commit task branches until it advances."
  if [ -z "$base" ]; then
    echo "  WARN: could not resolve the base branch — skipped local fast-forward (non-fatal)."
    return 0
  fi
  echo "== refreshing local $base =="
  [ "$(type -t lc_loaded)" = function ] || . "$LIVE_CHECKOUT" 2>/dev/null
  if [ "$(type -t lc_loaded)" != function ]; then
    echo "  WARN: local $base not refreshed (non-fatal): cannot load $LIVE_CHECKOUT; nothing was fetched or moved."
    return 0
  fi
  t=$FETCH_TIMEOUT; case "$t" in ''|*[!0-9]*|0) t=1 ;; esac   # lc_bounded's own reading of the budget
  for try in 1 2; do
    ( lc_ssh_rule "$repo"; lc_fetch "$repo" "$base" refresh_bounded ) >/dev/null 2>&1; frc=$?
    if [ "$frc" -eq 142 ]; then fwhy="git fetch origin $base timed out after ${t}s"; continue; fi
    if [ "$frc" -ne 0 ]; then fwhy="git fetch origin $base failed"; continue; fi
    if [ -n "$must" ] && ! git -C "$repo" merge-base --is-ancestor "$must" "refs/remotes/origin/$base" >/dev/null 2>&1; then
      fwhy="origin/$base lacks merge $must"; continue
    fi
    fwhy=''; break
  done
  if [ -n "$fwhy" ]; then
    echo "  WARN: local $base NOT refreshed: $fwhy (twice); the checkout was not moved."
    return 6
  fi
  if m=$(lc_op "$repo"); then
    echo "  WARN: local $base did not fast-forward: a half-applied operation ($m) is in progress; the checkout was left as it is."
    echo "$reaper"
    return 0
  fi
  cur=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$cur" != "$base" ]; then
    echo "  NOTE: checkout is on '$cur', not $base — left as it is; the worktree reaper keeps zero-commit task branches until it advances."
    return 0
  fi
  before=$(git -C "$repo" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null)
  tip=$(git -C "$repo" rev-parse -q --verify "refs/remotes/origin/$base^{commit}" 2>/dev/null)
  if [ -n "$before" ] && [ -n "$tip" ]; then
    if [ "$before" = "$tip" ] || git -C "$repo" merge-base --is-ancestor "$tip" "$before" >/dev/null 2>&1; then
      # Equal or ahead: nothing to move, and no merge runs (a no-op ff-only would still rewrite ORIG_HEAD).
      ff=1
      echo "  local $base already at or ahead of origin/$base."
    elif git -C "$repo" merge-base --is-ancestor "$before" "$tip" >/dev/null 2>&1; then
      o=$(lc_ff "$repo" "$base"); orc=$?
      if [ "$orc" -eq 0 ]; then
        ff=1
        # Re-read HEAD: never claim a move that did not happen.
        if [ "$(git -C "$repo" rev-parse -q --verify HEAD 2>/dev/null)" = "$before" ]; then
          echo "  local $base already at or ahead of origin/$base."
        else
          echo "  local $base fast-forwarded to origin/$base."
        fi
      fi
    fi   # diverged: no merge; the naming below says why
  fi
  # repo-state.sh's line for commits on $base that origin/$base lacks; anything else is no usable line.
  if [ -f "$REPO_STATE" ]; then
    raw=$(bash "$REPO_STATE" "$repo" 2>/dev/null) || { raw=''; why='the repo-state check failed'; }
  else
    why='repo-state.sh not found'
  fi
  case "$raw" in "on $base, "*" not on origin/$base"*) line=$raw ;; esac
  if [ "$ff" = 1 ]; then
    # Already at or ahead: the checkout can still be ahead.
    [ -n "$line" ] && echo "  NOTE: $line."
    return 0
  fi
  if [ -n "$line" ]; then
    echo "  WARN: local $base did not fast-forward: $line."
    case "$line" in
      *"queued in"*", "*" stranded") echo "        No close-out branch carries the stranded ones, so the checkout stays blocked until they are landed or dropped, even once GitHub merges that PR." ;;
      *"queued in"*) echo "        It fast-forwards once GitHub merges the landing PR (every one, if several are open)." ;;
      *) echo "        No close-out branch carries them." ;;
    esac
    echo "$reaper"
    return 0
  fi
  # No usable line (origin/HEAD unset or stale, the script missing or failing): count them here. $base comes
  # from GitHub, repo-state's default from the local origin/HEAD: a stale one (a master → main rename)
  # names another branch, so "unset" is said only when it is unset.
  if [ -z "$why" ]; then
    oh=$(git -C "$repo" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null); oh=${oh#refs/remotes/origin/}
    if [ -n "$oh" ] && [ "$oh" != "$base" ]; then
      why="origin/HEAD points at origin/$oh, not $base: git remote set-head origin --auto"
    elif [ -z "$oh" ] && [ "$raw" = "on $base, default branch unresolved — unmerged check skipped" ]; then
      why='origin/HEAD unset: git remote set-head origin --auto'
    else
      why="repo-state gave no line for $base"
    fi
  fi
  n=$(git -C "$repo" rev-list --count "refs/remotes/origin/$base..HEAD" 2>/dev/null)
  case "$n" in
    ''|*[!0-9]*) echo "  WARN: local $base did not fast-forward (checkout dirty or diverged)." ;;
    0) case "$orc" in
         3) echo "  WARN: local $base did not fast-forward (no local-only commits: local changes in the checkout block it: $o)." ;;
         1) echo "  WARN: local $base did not fast-forward (no local-only commits: git refused the fast-forward: $o)." ;;
         *) echo "  WARN: local $base did not fast-forward (no local-only commits)." ;;
       esac ;;
    *) echo "  WARN: local $base did not fast-forward: $n commit(s) not on origin/$base — not named ($why)." ;;
  esac
  echo "$reaper"
  return 0
}

# ---- the in-place checkout's refresh (ADR 0042) --------------------------------------------------------------
# A rollout scheduled after P26 runs from its rollout clone, so refresh_local_base moves the clone, and nothing else
# would give the in-place twin (the checkout Lachy's sessions work in) the rollout's merges. After every merge,
# `self-rollout-check.sh --refresh-in-place <repoPath>` fast-forwards the twin when it can (fetch, then
# `merge --ff-only --no-autostash`, never a merge commit, held while the twin is the primary checkout under a running
# rollout, ADR 0031) and prints one line, indented here; for an in-place root (a rollout scheduled before ADR 0042) it
# prints nothing, and this prints nothing either. It never changes merge-task's exit, and costs one fetch per merge,
# only for a clone root.
SELF_ROLLOUT_CHECK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/self-rollout-check.sh"
refresh_in_place() {  # $1=repoPath
  local line
  [ -f "$SELF_ROLLOUT_CHECK" ] || return 0
  line=$(bash "$SELF_ROLLOUT_CHECK" --refresh-in-place "$1" 2>/dev/null) || return 0
  [ -n "$line" ] || return 0
  echo "== refreshing the in-place checkout =="
  printf '%s\n' "$line" | sed 's/^/  /'
  return 0
}

# Self-test hook: `merge-task.sh --self-test-base` drives refresh_local_base against a throwaway repo
# whose origin default branch is `master` (no `main` anywhere): checkout on master ⇒ fast-forwarded;
# checkout on another branch ⇒ untouched; unresolved base ⇒ skipped; a local-only commit ⇒ named stranded,
# then queued once a close/… branch carries it, then split once a stranded one sits on top; a dirty
# overlap ⇒ says so, naming its paths; origin/HEAD unset or stale ⇒ counted, with a hint that tells the two apart; a
# no-op fast-forward ⇒ "already at or ahead", never "fast-forwarded"; merge.autoStash with a dirty overlap ⇒
# refused, file and stash list intact; a failed fetch, or an origin/master lacking the given merge ⇒ 6,
# "NOT refreshed", nothing moved. p39-4: every refusal and no-op (diverged, ahead, equal, an overlap, a half-applied
# operation) leaves ORIG_HEAD absent: no merge ran (g); a local branch named origin/master never stands in for
# refs/remotes/origin/master (d); an index.lock is git's own refusal, in its words (h); rebase-merge/ on master, or
# with a detached HEAD, is the half-applied WARN, never the non-base NOTE (i); an unloadable live-checkout.sh is a
# WARN, rc 0 (j); a hung ssh times out on both tries, 6, every ssh gone (e); the ssh rule runs per try, BatchMode and
# no prompt, nothing exported into the caller (f). Needs git only — no GitHub.
if [ "${1:-}" = "--self-test-base" ]; then
  st_fail=0
  sb_ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected $2 got $1"; st_fail=1; fi; }
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }
  # ORIG_HEAD (p39-4): a refused or no-op `merge --ff-only` writes it, so every refusal below starts with it removed and
  # asserts it is still absent: no merge ran.
  oh() { git -C "${1:-$tmp/root}" rev-parse --path-format=absolute --git-path ORIG_HEAD; }
  noh() { rm -f "$(oh "$@")"; }
  ohgone() { [ -e "$(oh "${2:-}")" ] && sb_ok "written" "absent" "$1: ORIG_HEAD untouched (no merge ran)" || sb_ok y y "$1: ORIG_HEAD untouched (no merge ran)"; }
  g init -q --bare "$tmp/origin.git"
  g clone -q "$tmp/origin.git" "$tmp/root" 2>/dev/null
  g -C "$tmp/root" commit -q --allow-empty -m base && g -C "$tmp/root" push -q origin master
  g clone -q "$tmp/origin.git" "$tmp/other" 2>/dev/null
  g -C "$tmp/other" commit -q --allow-empty -m landed1 && g -C "$tmp/other" push -q origin master
  landed=$(git -C "$tmp/other" rev-parse HEAD)
  out=$(refresh_local_base "$tmp/root" master)
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$landed" "root on master: fast-forwarded to origin/master"
  case "$out" in *"local master fast-forwarded to origin/master."*) sb_ok y y "reports the master fast-forward";; *) sb_ok n y "reports the master fast-forward";; esac
  g -C "$tmp/root" switch -q -c feature/test
  held=$(git -C "$tmp/root" rev-parse HEAD)
  g -C "$tmp/other" commit -q --allow-empty -m landed2 && g -C "$tmp/other" push -q origin master
  out=$(refresh_local_base "$tmp/root" master)
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "checkout on another branch: left untouched"
  case "$out" in *"left as it is"*) sb_ok y y "reports the non-base skip";; *) sb_ok n y "reports the non-base skip";; esac
  out=$(refresh_local_base "$tmp/root" "")
  case "$out" in *"could not resolve"*) sb_ok y y "unresolved base: skipped, non-fatal";; *) sb_ok n y "unresolved base: skipped, non-fatal";; esac
  # Local-only commits block the fast-forward: named by repo-state.sh, stranded or queued in close/….
  sb_has() { case "$1" in *"$2"*) sb_ok y y "$3";; *) sb_ok "[$1]" "…$2…" "$3";; esac; }
  g -C "$tmp/root" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
  g -C "$tmp/root" switch -q master
  g -C "$tmp/root" commit -q --allow-empty -m local-only
  held=$(git -C "$tmp/root" rev-parse HEAD)
  g -C "$tmp/other" commit -q --allow-empty -m landed3 && g -C "$tmp/other" push -q origin master
  noh; out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "local-only commit: returns 0"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "local-only commit: HEAD left where it was"
  ohgone "(g) local-only commit (diverged)"
  sb_has "$out" "did not fast-forward: on master, 1 commit(s) not on origin/master — stranded" "local-only commit, no close ref: named stranded"
  qb="close/2026-09-29-t-$(git -C "$tmp/root" rev-parse HEAD | cut -c1-12)"
  g -C "$tmp/root" push -q origin "HEAD:refs/heads/$qb"
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "queued close-out: returns 0"
  sb_has "$out" "did not fast-forward: on master, 1 commit(s) not on origin/master — queued in $qb" "local-only commit pushed to close/…: named queued in it"
  sb_has "$out" "fast-forwards once GitHub merges the landing PR" "queued: says when it fast-forwards"
  # A second local-only commit on top of the queued one: split, and the stranded one keeps it blocked.
  g -C "$tmp/root" commit -q --allow-empty -m local-only-b
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "queued + stranded: returns 0"
  sb_has "$out" "did not fast-forward: on master, 2 commit(s) not on origin/master — 1 queued in $qb, 1 stranded" "queued + stranded: named split"
  sb_has "$out" "stays blocked until they are landed or dropped, even once GitHub merges that PR" "queued + stranded: never promises a fast-forward"
  case "$out" in *"fast-forwards once"*) sb_ok "[$out]" "no fast-forward promise" "queued + stranded: no queued-only wording";; *) sb_ok y y "queued + stranded: no queued-only wording";; esac
  # A dirty file that overlaps origin's change, no local commits: the local changes are what block it.
  g -C "$tmp/root" reset -q --hard origin/master
  echo a > "$tmp/other/f" && g -C "$tmp/other" add f && g -C "$tmp/other" commit -q -m f1 && g -C "$tmp/other" push -q origin master
  refresh_local_base "$tmp/root" master >/dev/null
  echo dirty > "$tmp/root/f"
  echo b > "$tmp/other/f" && g -C "$tmp/other" commit -q -am f2 && g -C "$tmp/other" push -q origin master
  noh; out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "dirty overlap: returns 0"
  sb_has "$out" "no local-only commits" "dirty overlap, no local commits: says local changes block it"
  sb_has "$out" "(no local-only commits: local changes in the checkout block it: f)." "dirty overlap: names the path in the way"
  ohgone "dirty overlap"
  # origin/HEAD unset: repo-state cannot name them, so merge-task counts them itself.
  g -C "$tmp/root" checkout -q -- f && g -C "$tmp/root" merge -q --ff-only origin/master
  g -C "$tmp/root" symbolic-ref --delete refs/remotes/origin/HEAD
  g -C "$tmp/root" commit -q --allow-empty -m local-only-2
  g -C "$tmp/other" commit -q --allow-empty -m landed4 && g -C "$tmp/other" push -q origin master
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "origin/HEAD unset: returns 0"
  sb_has "$out" "1 commit(s) not on origin/master — not named (origin/HEAD unset: git remote set-head origin --auto)" "origin/HEAD unset: counted, with the set-head hint"
  # origin/HEAD stale (set, but at another branch — a default rename): never called unset.
  g -C "$tmp/root" update-ref refs/remotes/origin/trunk refs/remotes/origin/master
  g -C "$tmp/root" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "origin/HEAD stale: returns 0"
  sb_has "$out" "not named (origin/HEAD points at origin/trunk, not master: git remote set-head origin --auto)" "origin/HEAD stale: names where it points"
  case "$out" in *"unset"*) sb_ok "[$out]" "no 'unset'" "origin/HEAD stale: never says unset";; *) sb_ok y y "origin/HEAD stale: never says unset";; esac
  # A no-op fast-forward (origin/master behind the checkout): never claims it fast-forwarded.
  g -C "$tmp/root" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
  g -C "$tmp/root" reset -q --hard origin/master
  g -C "$tmp/root" commit -q --allow-empty -m local-only-3
  noh; out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "no-op fast-forward: returns 0"
  ohgone "(g) no-op fast-forward (ahead)"
  sb_has "$out" "local master already at or ahead of origin/master." "no-op fast-forward: says already at or ahead"
  case "$out" in *"fast-forwarded"*) sb_ok "[$out]" "no 'fast-forwarded'" "no-op fast-forward: never says fast-forwarded";; *) sb_ok y y "no-op fast-forward: never says fast-forwarded";; esac
  sb_has "$out" "NOTE: on master, 1 commit(s) not on origin/master — stranded." "no-op fast-forward: names the local-only commit"
  # (a) merge.autoStash true with a dirty overlap: the fast-forward is refused (--no-autostash), never
  #     stashed, applied and popped into conflict markers; the file and the stash list stay as they were.
  g -C "$tmp/root" reset -q --hard origin/master
  g -C "$tmp/root" config merge.autoStash true
  printf 'dirty\n' > "$tmp/root/f"
  echo c > "$tmp/other/f" && g -C "$tmp/other" commit -q -am f3 && g -C "$tmp/other" push -q origin master
  held=$(git -C "$tmp/root" rev-parse HEAD)
  noh; out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "autoStash + dirty overlap: returns 0"
  ohgone "autoStash + dirty overlap"
  sb_has "$out" "(no local-only commits: local changes in the checkout block it: f)." "autoStash + dirty overlap: names the path in the way"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "autoStash + dirty overlap: HEAD left where it was"
  sb_ok "$(cat "$tmp/root/f")" "dirty" "autoStash + dirty overlap: the dirty file is byte-unchanged (no markers)"
  sb_ok "$(git -C "$tmp/root" stash list)" "" "autoStash + dirty overlap: nothing left in the stash list"
  sb_has "$out" "no local-only commits" "autoStash + dirty overlap: says local changes block it"
  g -C "$tmp/root" checkout -q -- f
  g -C "$tmp/root" config --unset merge.autoStash
  # (b) the fetch fails while a stale origin/master is ahead (the p6-7 defect): no fast-forward to the
  #     stale ref, never "fast-forwarded", rc 6.
  g -C "$tmp/root" fetch -q origin
  held=$(git -C "$tmp/root" rev-parse HEAD)
  ou=$(git -C "$tmp/root" remote get-url origin)
  g -C "$tmp/root" remote set-url origin "$tmp/missing.git"
  out=$(refresh_local_base "$tmp/root" master 2>&1); rc=$?
  sb_ok "$rc" 6 "failed fetch, stale origin/master ahead: returns 6"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "failed fetch: HEAD left where it was"
  sb_has "$out" "WARN: local master NOT refreshed: git fetch origin master failed (twice)" "failed fetch: says NOT refreshed"
  case "$out" in *"fast-forwarded"*) sb_ok "[$out]" "no 'fast-forwarded'" "failed fetch: never says fast-forwarded";; *) sb_ok y y "failed fetch: never says fast-forwarded";; esac
  g -C "$tmp/root" remote set-url origin "$ou"
  # (c) the fetch works but origin/master lacks the merge commit it was handed: no fast-forward, rc 6.
  g -C "$tmp/other" commit -q --allow-empty -m landed5 && g -C "$tmp/other" push -q origin master
  phantom=$(g -C "$tmp/root" commit-tree -p HEAD -m phantom "$(git -C "$tmp/root" rev-parse 'HEAD^{tree}')")
  out=$(refresh_local_base "$tmp/root" master "$phantom" 2>&1); rc=$?
  sb_ok "$rc" 6 "origin/master lacks the merge: returns 6"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "origin/master lacks the merge: HEAD left where it was"
  sb_has "$out" "WARN: local master NOT refreshed: origin/master lacks merge $phantom (twice)" "origin/master lacks the merge: names it"
  case "$out" in *"fast-forwarded"*) sb_ok "[$out]" "no 'fast-forwarded'" "lacks the merge: never says fast-forwarded";; *) sb_ok y y "lacks the merge: never says fast-forwarded";; esac
  # (g) equal: HEAD is origin's tip, so no merge runs (git writes ORIG_HEAD even on an "Already up to date" ff-only).
  g -C "$tmp/root" merge -q --ff-only refs/remotes/origin/master
  noh; out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "(g) equal: returns 0"
  sb_has "$out" "local master already at or ahead of origin/master." "(g) equal: says already at or ahead"
  ohgone "(g) equal"
  # (d) a local branch named origin/master, at the old HEAD: the short name would resolve to it first, so every read and
  #     the merge use refs/remotes/origin/master.
  g -C "$tmp/root" branch origin/master 2>/dev/null
  g -C "$tmp/other" commit -q --allow-empty -m landed6 && g -C "$tmp/other" push -q origin master
  out=$(refresh_local_base "$tmp/root" master 2>&1); rc=$?
  sb_ok "$rc" 0 "(d) a local branch named origin/master: returns 0"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$(git -C "$tmp/other" rev-parse HEAD)" "(d) … fast-forwarded to refs/remotes/origin/master"
  sb_has "$out" "local master fast-forwarded to origin/master." "(d) … and says so"
  g -C "$tmp/root" branch -q -D origin/master
  # (h) an index.lock while strictly behind: the overlap cannot see it, git refuses, and the WARN gives git's own reason
  #     (never "local changes"). ORIG_HEAD is not asserted: git's refusal rewrites it (the documented residual).
  g -C "$tmp/other" commit -q --allow-empty -m landed7 && g -C "$tmp/other" push -q origin master
  held=$(git -C "$tmp/root" rev-parse HEAD); : > "$tmp/root/.git/index.lock"
  out=$(refresh_local_base "$tmp/root" master 2>&1); rc=$?
  rm -f "$tmp/root/.git/index.lock"
  sb_ok "$rc" 0 "(h) index.lock while behind: returns 0"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "(h) … HEAD left where it was"
  sb_has "$out" "(no local-only commits: git refused the fast-forward: " "(h) … says git refused it"
  sb_has "$out" "index.lock" "(h) … in git's own words"
  case "$out" in *"local changes"*) sb_ok "[$out]" "no 'local changes'" "(h) … never blames local changes";; *) sb_ok y y "(h) … never blames local changes";; esac
  # (i) a half-applied operation on the base while behind: a WARN naming it, before the non-base NOTE, so a rebase's
  #     detached HEAD reads half-applied, never "on 'HEAD'".
  mkdir "$tmp/root/.git/rebase-merge"
  noh; out=$(refresh_local_base "$tmp/root" master 2>&1); rc=$?
  sb_ok "$rc" 0 "(i) rebase-merge/ on master while behind: returns 0"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "(i) … HEAD left where it was"
  sb_has "$out" "WARN: local master did not fast-forward: a half-applied operation (rebase-merge) is in progress; the checkout was left as it is." "(i) … names the operation"
  ohgone "(i) rebase-merge/"
  rmdir "$tmp/root/.git/rebase-merge"; g -C "$tmp/root" checkout -q --detach; mkdir "$tmp/root/.git/rebase-merge"
  out=$(refresh_local_base "$tmp/root" master 2>&1); rc=$?
  sb_ok "$rc" 0 "(i) rebase-merge/ with a detached HEAD: returns 0"
  sb_has "$out" "a half-applied operation (rebase-merge) is in progress" "(i) … the half-applied WARN"
  case "$out" in *"on 'HEAD'"*) sb_ok "[$out]" "no 'on HEAD'" "(i) … never the non-base NOTE";; *) sb_ok y y "(i) … never the non-base NOTE";; esac
  rmdir "$tmp/root/.git/rebase-merge"; g -C "$tmp/root" checkout -q master
  # (j) the primitive cannot be loaded: a WARN with rc 0, nothing fetched or moved.
  out=$( unset -f lc_loaded; LIVE_CHECKOUT=$tmp/none.sh; refresh_local_base "$tmp/root" master 2>&1; echo "rc $?" )
  sb_has "$out" "WARN: local master not refreshed (non-fatal): cannot load $tmp/none.sh; nothing was fetched or moved." "(j) unloadable primitive: the WARN"
  sb_has "$out" "rc 0" "(j) … rc 0"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "(j) … HEAD left where it was"
  # (e) a hung ssh: each try is bounded (FETCH_TIMEOUT=1), so two timeouts give 6 in about 2 s, and every ssh is gone.
  #     The fake ssh redirects only stderr: its stdout is git's ssh pipe (not a capture pipe, refresh_local_base sends
  #     the fetch to /dev/null), and closing it would make git read EOF and fail fast instead of hanging.
  g init -q "$tmp/sshroot"; g -C "$tmp/sshroot" commit -q --allow-empty -m base
  g -C "$tmp/sshroot" remote add origin git@github.com:o/r.git
  g -C "$tmp/sshroot" update-ref refs/remotes/origin/master HEAD; held=$(git -C "$tmp/sshroot" rev-parse HEAD)
  printf '#!/bin/sh\necho $$ >> "%s"\nexec sleep 30 2>/dev/null\n' "$tmp/ssh.pids" > "$tmp/hang-ssh"; chmod +x "$tmp/hang-ssh"
  : > "$tmp/ssh.pids"; s0=$SECONDS
  out=$( export GIT_SSH_COMMAND="$tmp/hang-ssh" GIT_SSH_VARIANT=ssh GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
         FETCH_TIMEOUT=1; refresh_local_base "$tmp/sshroot" master 2>&1 ); rc=$?
  sb_ok "$rc" 6 "(e) a hung ssh: returns 6"
  sb_has "$out" "WARN: local master NOT refreshed: git fetch origin master timed out after 1s (twice)" "(e) … timed out, twice"
  sb_ok "$(git -C "$tmp/sshroot" rev-parse HEAD)" "$held" "(e) … HEAD left where it was"
  sb_ok "$([ $((SECONDS - s0)) -le 20 ] && echo bounded)" bounded "(e) … within the bound, not the hang"
  sb_ok "$(grep -c . "$tmp/ssh.pids")" 2 "(e) … one ssh per try"
  for p in $(cat "$tmp/ssh.pids"); do
    i=0; while kill -0 "$p" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i+1)); done
    kill -0 "$p" 2>/dev/null && { sb_ok alive gone "(e) ssh $p is gone"; kill "$p" 2>/dev/null; } || sb_ok y y "(e) ssh $p is gone"
  done
  # (f) the ssh rule: with no ssh command set, each try runs under BatchMode and no prompt, inside its own subshell, so
  #     nothing is exported into the caller (refresh_in_place's twin reads its own core.sshCommand).
  mkdir -p "$tmp/fakebin"
  printf '#!/bin/sh\nprintf "%%s|%%s\\n" "${GIT_TERMINAL_PROMPT-unset}" "$*" >> "%s"\nexit 255\n' "$tmp/ssh.log" > "$tmp/fakebin/ssh"
  chmod +x "$tmp/fakebin/ssh"; : > "$tmp/ssh.log"
  r=$( unset GIT_SSH_COMMAND GIT_SSH GIT_TERMINAL_PROMPT GIT_SSH_VARIANT
       export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 PATH="$tmp/fakebin:$PATH"
       refresh_local_base "$tmp/sshroot" master > "$tmp/f.out" 2>&1
       echo "$?|${GIT_SSH_COMMAND-unset}|${GIT_TERMINAL_PROMPT-unset}" )
  sb_ok "$r" "6|unset|unset" "(f) the ssh rule: 6, and nothing exported into the caller"
  sb_ok "$(grep -c . "$tmp/ssh.log")|$(grep -c '^0|.*-o BatchMode=yes' "$tmp/ssh.log")" "2|2" "(f) … both tries ran ssh under BatchMode with no prompt"
  echo; [ "$st_fail" -eq 0 ] && echo "base: ALL PASS" || echo "base: SOME FAILED"
  exit "$st_fail"
fi

# Self-test hook: `merge-task.sh --self-test-classify` runs the classifier assertions and exits. Keeps the
# fail-closed heart covered without a live repo (the end-to-end suites drive a fake gh, never live GitHub —
# see the UNSTABLE guard comment below). Must precede the arg-count check; uses ${1:-} for `set -u` safety.
if [ "${1:-}" = "--self-test-classify" ]; then
  st_fail=0
  # st <expected> <label> <steps>: <steps> is a printf %b string (\n separates failed step names). The steps
  # go in as an argument, never piped into st: `printf … | st` ran st in a pipeline subshell, so its
  # st_fail=1 was lost and a failing case still printed "ALL PASS" with exit 0.
  st() {
    local exp="$1" label="$2" got; got="$(printf '%b' "$3" | classify_failed_steps)"
    if [ "$got" = "$exp" ]; then echo "ok   - $label ($got)"; else echo "FAIL - $label: expected $exp got $got"; st_fail=1; fi
  }
  st infra   "install-deps timeout" 'Install dependencies\n'
  st infra   "set up python" 'Set up Python\n'
  st infra   "checkout + install" 'Checkout\nInstall dependencies\n'
  st infra   "restore cache" 'Restore cache\n'
  st genuine "run tests" 'Run tests\n'
  st genuine "pytest" 'pytest (fast)\n'
  st genuine "mixed install+test => genuine" 'Install dependencies\nRun tests\n'
  st genuine "lint" 'Lint\n'
  st genuine "mypy" 'mypy\n'
  st genuine "build" 'Build wheel\n'
  st genuine "unrecognised step => fail-closed" 'Deploy artifact\n'
  st genuine "no steps => fail-closed" '\n'
  st genuine "blank-only steps => fail-closed" '  \t\n'
  st infra   "blank lines skipped, case ignored" '\n  INSTALL DEPENDENCIES  \n\n'
  st genuine "upper-case test => genuine" 'RUN TESTS\n'
  # Word match, not substring: an allowlist token buried inside another word proves nothing.
  st genuine "pip inside pipeline => genuine" 'Run pipeline checks\n'
  st genuine "apt inside adapter => genuine" 'Adapter contract check\n'
  st genuine "apt inside capture => genuine" 'Capture screenshots\n'
  st genuine "fetch inside prefetch => genuine" 'Verify prefetch manifest\n'
  st genuine "restore + verify => genuine" 'Restore and verify DB snapshot\n'
  st infra   "punctuation splits words (checkout)" 'actions/checkout@v4\n'
  st infra   "apt-get => apt word" 'Run apt-get update\n'
  st infra   "setup-python => setup word" 'setup-python\n'
  # Inflections: in each case the inflected form is the ONLY allowlist token on the line, so a typo in its
  # suffix group turns the suite red (other words on the line are deliberately not allowlisted).
  st infra   "dependency word alone" 'Resolve dependency\n'
  st infra   "dependencies word alone" 'Dependencies\n'
  st infra   "installing" 'Installing deps\n'
  st infra   "installed" 'Installed deps\n'
  st infra   "downloaded" 'Downloaded artifacts\n'
  st infra   "downloading" 'Downloading artifacts\n'
  st infra   "provisioning" 'Provisioning runner\n'
  st infra   "configured" 'Configured runner\n'
  st infra   "configuring" 'Configuring runner\n'
  st infra   "caching" 'Caching deps\n'
  st infra   "restoring" 'Restoring deps\n'
  st infra   "bootstrapping" 'Bootstrapping\n'
  st infra   "bootstrapped" 'Bootstrapped runner\n'
  st infra   "fetching" 'Fetching submodules\n'
  st infra   "fetched" 'Fetched submodules\n'
  st infra   "cloning" 'Cloning submodules\n'
  st infra   "cloned" 'Cloned submodules\n'
  # Base forms, each the only allowlist token on its line. 'Install dependencies' and 'Restore cache' above
  # do NOT pin them: the two tokens on those lines mask each other.
  st infra   "install alone" 'Install toolchain\n'
  st infra   "download alone" 'Download artifacts\n'
  st infra   "provision alone" 'Provision runner\n'
  st infra   "configure alone" 'Configure runner\n'
  st infra   "cache alone" 'Cache deps\n'
  st infra   "restore alone" 'Restore deps\n'
  st infra   "bootstrap alone" 'Bootstrap runner\n'
  st infra   "fetch alone" 'Fetch submodules\n'
  st infra   "clone alone" 'Clone submodules\n'
  # Every form of every setup verb (9 verbs x base/-s/-ed/-ing = 36), each as '<form> runner' so it is the
  # only allowlist token. This list is written out by hand, NOT derived from $allow, so dropping a base
  # form, a suffix or a `?` from any verb group turns the suite red.
  for st_w in install installs installed installing \
              download downloads downloaded downloading \
              provision provisions provisioned provisioning \
              configure configures configured configuring \
              cache caches cached caching \
              restore restores restored restoring \
              bootstrap bootstraps bootstrapped bootstrapping \
              fetch fetches fetched fetching \
              clone clones cloned cloning; do
    st infra "form: $st_w" "$st_w runner\n"
  done
  # Bare tool tokens and nouns, each the only allowlist token on its line ('npm  ci' pins the ` +`).
  # Together with the cases above, deleting any allowlist token, or dropping any base form, suffix, `?`,
  # ` *` or ` +` from one, turns the suite red.
  st infra   "pip alone" 'pip freeze\n'
  st infra   "poetry alone" 'poetry lock\n'
  st infra   "yarn alone" 'yarn\n'
  st infra   "brew alone" 'brew update\n'
  st infra   "npm ci alone" 'npm ci\n'
  st infra   "npm  ci (two spaces)" 'npm  ci\n'
  st infra   "setup one word alone" 'setup\n'
  st infra   "npm install via the install word" 'npm install\n'
  echo; [ "$st_fail" -eq 0 ] && echo "classifier: ALL PASS" || echo "classifier: SOME FAILED"
  exit "$st_fail"
fi

# ---- args, environment, sentinel (no gh call precedes the end of this block) ----------------------------
# The EXIT trap and finish come first, so every exit below, the usage ones included, goes through them.
# FINAL_RC is set only by finish, SIG_RC only by a signal trap; SENTINEL, PR and COUNTER only once known. LAST_WAIT is
# the wait the run is in (wait_line), cleared once that wait ends: a signal's last line names it.
SENTINEL=''; FINAL_RC=''; SIG_RC=''; LAST_WAIT=''; PR=''; COUNTER=''; tmp=''
ABORT_RC=70   # an exit outside finish and the signal traps: a defect, never 0 and never a table code
on_exit() {  # EXIT trap — $? MUST be captured first, before any other command overwrites it
  local code=$? out
  if [ -n "$FINAL_RC" ] && [ "$FINAL_RC" = "$code" ]; then out=$code   # a deliberate exit, through finish
  elif [ -n "$SIG_RC" ]; then out=$SIG_RC                               # TERM, INT or HUP
  else out=$ABORT_RC; fi   # a `set -u` abort: bash 3.2 exits it with 1, or with the last status (often 0)
  if [ -n "$SENTINEL" ]; then
    case "$out" in
      0) printf 'ok\n' > "$SENTINEL" 2>/dev/null || true ;;
      "$ABORT_RC") printf 'failed:abort\n' > "$SENTINEL" 2>/dev/null || true ;;
      *) printf 'failed:%s\n' "$out" > "$SENTINEL" 2>/dev/null || true ;;
    esac
  fi
  # The counter rule: only an exit that went through finish (FINAL_RC = $?) with a parsed PR touches it.
  if [ "$out" = "$FINAL_RC" ] && [ "$out" = "$code" ] && [ -n "$PR" ] && [ -n "$COUNTER" ]; then
    case "$out" in
      0|1|4|5|6|7)
        rm -f "$COUNTER" 2>/dev/null
        [ -e "$COUNTER" ] && echo "WARN: could not delete $COUNTER (a stale counter only sets the task aside sooner)." >&2 ;;
    esac
  fi
  [ -n "$tmp" ] && rm -rf "$tmp"
  # A signal's last line is the wait it cut, never the signal (ADR 0033 d4 as amended 2026-11-12): the lead's reason is
  # `merge-task signalled twice (<code>): <its last line>`. On stdout, which no function call's redirection holds when
  # a trap runs (bash runs a trap inside the redirection of a function call the signal cut, so checks_watch runs its
  # redirected slice in a subshell); in a subshell, so a closed stdout's SIGPIPE ends only it.
  if [ -n "$SIG_RC" ] && [ "$out" = "$SIG_RC" ] && [ -n "$LAST_WAIT" ]; then
    ( printf '  last wait: %s\n' "$LAST_WAIT" ) 2>/dev/null || true
  fi
  exit "$out"
}
trap on_exit EXIT
trap 'SIG_RC=143; exit 143' TERM; trap 'SIG_RC=130; exit 130' INT; trap 'SIG_RC=129; exit 129' HUP

finish() {  # finish <rc> [message…] — every deliberate exit; never call it inside $(…) or a pipeline
  FINAL_RC="$1"; shift
  if [ "$#" -gt 0 ]; then
    if [ "$FINAL_RC" = 0 ]; then printf '%s\n' "$*"; else printf '%s\n' "$*" >&2; fi
  fi
  exit "$FINAL_RC"
}

wait_line() {  # wait_line <the wait> — print a wait this run is in, and keep it as LAST_WAIT until the wait ends
  LAST_WAIT="$1"
  echo "  $LAST_WAIT"
}

# The result sentinel (see the header), cleared before the arg count: one call per PR means the previous
# call's `ok` is always sitting there, so no exit may leave it standing. A $1 that is no longer a repo (git
# missing, a broken checkout) still has an existing sentinel there replaced.
REPO_PATH=${1:-}; IS_REPO=0
if [ -n "$REPO_PATH" ] && git -C "$REPO_PATH" rev-parse --git-dir >/dev/null 2>&1; then
  IS_REPO=1; SENTINEL="$REPO_PATH/.claude/merge-task.status"
  mkdir -p "$REPO_PATH/.claude" 2>/dev/null || true
elif [ -n "$REPO_PATH" ] && [ -f "$REPO_PATH/.claude/merge-task.status" ]; then
  SENTINEL="$REPO_PATH/.claude/merge-task.status"
fi
[ -z "$SENTINEL" ] || rm -f "$SENTINEL" 2>/dev/null || true

[ "$#" -eq 4 ] || finish 2 "usage: merge-task.sh <repoPath> <pr> <integrated-head-sha> <integrated-base-sha>"
PR_ARG="$2"; IHEAD="$3"; IBASE="$4"
if [ "$IS_REPO" != 1 ]; then
  command -v git >/dev/null 2>&1 || finish 2 "ERROR: git not found on PATH"
  finish 2 "ERROR: $REPO_PATH is not a git repo"
fi

sha_re='^[0-9a-f]{40}$'
# The four task-argument exits print `merge-task args:` (p29-7): execute sets that one task aside at its own run,
# while every other exit 2 (the environment) holds the Integration lane.
[[ $IHEAD =~ $sha_re ]] || finish 2 "ERROR: merge-task args: integrated head '$IHEAD' is not a 40-hex SHA"
[[ $IBASE =~ $sha_re ]] || finish 2 "ERROR: merge-task args: integrated base '$IBASE' is not a 40-hex SHA"
for t in gh git python3; do
  command -v "$t" >/dev/null 2>&1 || finish 2 "ERROR: $t not found on PATH"
done
# Every MERGE_TASK_* override must be a plain non-negative integer of at most 9 digits. Anything else would
# make a bound's `[ -gt ]` error out as false (a non-numeric or overflowing cap never reaches 4: an endless 3)
# or abort an `$((…))` (a leading 0 reads as octal), so it is a 2 before any GitHub call.
int_re='^(0|[1-9][0-9]{0,8})$'
for v in MERGE_TASK_CHECK_INTERVAL MERGE_TASK_STATE_INTERVAL MERGE_TASK_CONFIRM_INTERVAL MERGE_TASK_READ_TRIES \
         MERGE_TASK_READ_INTERVAL MERGE_TASK_HEAD_LAG_INTERVAL MERGE_TASK_REINTEGRATE_MAX MERGE_TASK_FETCH_TIMEOUT \
         MERGE_TASK_NO_RUNNER_LIMIT MERGE_TASK_NO_RUNNER_POLL; do
  val=${!v:-}
  [ -z "$val" ] || [[ $val =~ $int_re ]] \
    || finish 2 "ERROR: $v='$val' is not a non-negative integer (at most 9 digits) — nothing was read or merged."
done

ORIGIN_URL=$(git -C "$REPO_PATH" remote get-url origin 2>/dev/null) || finish 2 "ERROR: no 'origin' remote in $REPO_PATH"
SLUG=$(printf '%s' "$ORIGIN_URL" | sed -E 's#^.*github\.com[:/]+##; s#\.git$##')
OWNER="${SLUG%%/*}"; REPO="${SLUG#*/}"
if [ -z "$OWNER" ] || [ -z "$REPO" ] || [ "$OWNER" = "$SLUG" ]; then
  finish 2 "ERROR: could not derive owner/repo from origin url '$ORIGIN_URL'"
fi

# <pr> → a number. bash 3.2 has no ${x,,}: lower-case with tr for the repo match.
num_re='^[1-9][0-9]*$'
url_re='^https?://github\.com/([^/]+)/([^/]+)/pull/([1-9][0-9]*)([/?#].*)?$'
if [[ $PR_ARG =~ $num_re ]]; then
  PR_NUM=$PR_ARG
elif [[ $PR_ARG =~ $url_re ]]; then
  u_slug="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"; PR_NUM=${BASH_REMATCH[3]}
  if [ "$(printf '%s' "$u_slug" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$OWNER/$REPO" | tr '[:upper:]' '[:lower:]')" ]; then
    finish 2 "ERROR: merge-task args: PR URL $PR_ARG is in $u_slug, but origin is $OWNER/$REPO"
  fi
else
  finish 2 "ERROR: merge-task args: cannot parse a PR number from '$PR_ARG' (a positive number or a https://github.com/<o>/<r>/pull/<N> URL)"
fi
PR=$PR_NUM

# The Engine snapshot guard (ADR 0043; skills/_shared/engine-snapshot.md): a PR that a live task note names, whose
# rollout runs on an Engine snapshot, merges only from that snapshot's copy of this script. engine-snapshot.py
# guard-pr (this tree's) exits 2 with its `engine-snapshot: ` line for a wrong root: that is this script's exit 2,
# before any GitHub call or counter. Any other failure of the guard is a WARN, and the merge goes on.
ES_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../../_shared/scripts/engine-snapshot.py"
# Why main moved (p29-10, ADR 0051): record_base_moved's Run-record line, through lead-integrate.py base-moved; and
# land_and_finish's CI headroom lines (ADR 0073 d5), through lead-integrate.py ci-headroom.
LI_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lead-integrate.py"
ES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
gp_err=$(python3 "$ES_PY" guard-pr --pr-url "https://github.com/$OWNER/$REPO/pull/$PR" --root "$ES_ROOT" \
  --script skills/execute/scripts/merge-task.sh 2>&1 >/dev/null); gp_rc=$?
if [ "$gp_rc" != 0 ]; then
  case "$gp_err" in
    engine-snapshot:*) [ "$gp_rc" = 2 ] && finish 2 "$gp_err" ;;
  esac
  echo "WARN: engine-snapshot.py guard-pr exited $gp_rc (${gp_err%%$'\n'*}): merging without the Engine snapshot guard" >&2
fi

# Cap pre-flight: an unpersistable counter fails closed (2) before any GitHub call.
CDIR="$REPO_PATH/.claude/merge-task"
COUNTER="$CDIR/$PR.base-moved"
if ! mkdir -p "$CDIR" 2>/dev/null || ! { : > "$CDIR/.probe"; } 2>/dev/null || ! rm -f "$CDIR/.probe" 2>/dev/null; then
  finish 2 "ERROR: cannot persist the base-moved counter under $CDIR — nothing was read or merged (the re-integration cap fails closed)."
fi
tmp=$(mktemp -d) || finish 2 "ERROR: mktemp failed"

echo "== merge-task.sh: $OWNER/$REPO PR #$PR — integrated head $IHEAD, base $IBASE =="

# ---- reads ---------------------------------------------------------------------------------------------
READ_ERR=''
jcheck() {  # jcheck <file> <comma,separated,dotted.paths> — 0 when the file is a JSON object carrying each path, not null or ""
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
for path in [p for p in sys.argv[2].split(',') if p]:
    v = d
    for k in path.split('.'):
        if not isinstance(v, dict) or k not in v:
            sys.exit(1)
        v = v[k]
    if v is None or v == '':
        sys.exit(1)
PY
}
jf() {  # jf <file> <dotted.path> — a scalar: "" for null or missing, true/false, "set" for a non-null object or list
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    v = json.load(open(sys.argv[1]))
except Exception:
    v = None
for k in sys.argv[2].split('.'):
    v = v.get(k) if isinstance(v, dict) else None
if v is None:
    print('')
elif isinstance(v, bool):
    print('true' if v else 'false')
elif isinstance(v, (dict, list)):
    print('set')
else:
    print(v)
PY
}
jparents() {  # jparents <commit.json> — the parent SHAs, one per line
  python3 - "$1" <<'PY'
import json, sys
for p in json.load(open(sys.argv[1])).get('parents') or []:
    print(p.get('sha', ''))
PY
}
snap_vars() {  # snap_vars <snapshot.json> — shell assignments for the S_* snapshot fields (eval'd)
  python3 - "$1" <<'PY'
import json, shlex, sys
d = json.load(open(sys.argv[1]))
def s(v):
    return '' if v is None else str(v)
mc = d.get('mergeCommit')
out = {
    'S_STATE': s(d.get('state')), 'S_BASEREF': s(d.get('baseRefName')), 'S_HEAD': s(d.get('headRefOid')),
    'S_HEADREF': s(d.get('headRefName')), 'S_MSS': s(d.get('mergeStateStatus')),
    'S_REVIEW': s(d.get('reviewDecision')), 'S_URL': s(d.get('url')),
    'S_AUTO': 'set' if d.get('autoMergeRequest') else '',
    'S_MC': s(mc.get('oid')) if isinstance(mc, dict) else '',
}
for k, v in out.items():
    print('%s=%s' % (k, shlex.quote(v)))
PY
}

gh_read() {  # gh_read <out> <label> <required,paths> -- <cmd…> — 0 ok; 1 definitive; 8 otherwise. Never exits.
  local out="$1" label="$2" req="$3" try=0 rc
  shift 3; [ "${1:-}" = "--" ] && shift
  while : ; do
    try=$((try+1))
    "$@" >"$out" 2>"$tmp/read.err"; rc=$?
    if [ "$rc" -eq 0 ] && jcheck "$out" "$req"; then READ_ERR=''; return 0; fi
    if [ "$rc" -ne 0 ]; then
      READ_ERR=$(head -1 "$tmp/read.err" 2>/dev/null); [ -n "$READ_ERR" ] || READ_ERR="$label: gh exited $rc"
    else
      READ_ERR="$label: gh exited 0 without $req"
    fi
    if [ "$try" -ge "$READ_TRIES" ]; then
      if [ "$rc" -ne 0 ] && grep -qE "HTTP 404|HTTP 422|Could not resolve to a|doesn't exist on type" "$tmp/read.err" 2>/dev/null; then
        return 1
      fi
      return 8
    fi
    sleep "$READ_INTERVAL"
  done
}

SNAP_FIELDS=state,baseRefName,headRefOid,headRefName,mergeStateStatus,reviewDecision,url,autoMergeRequest,mergeCommit
S_STATE=''; S_BASEREF=''; S_HEAD=''; S_HEADREF=''; S_MSS=''; S_REVIEW=''; S_URL=''; S_AUTO=''; S_MC=''
pr_snapshot() {  # pr_snapshot <file> — the whole PR object; sets S_* on success; returns 0, 1 or 8
  local f="$1" rc
  gh_read "$f" "PR #$PR" state,baseRefName,headRefOid,headRefName,mergeStateStatus,url -- \
    gh pr view "$PR" -R "$OWNER/$REPO" --json "$SNAP_FIELDS"; rc=$?
  [ "$rc" -eq 0 ] && eval "$(snap_vars "$f")"
  return "$rc"
}
snap_or_finish() {  # snap_or_finish <file> <when> — pr_snapshot; a failed read finishes 1 (definitive) or 8
  local rc
  pr_snapshot "$1"; rc=$?
  case "$rc" in
    0) return 0 ;;
    1) finish 1 "ERROR: cannot read PR #$PR in $OWNER/$REPO ($READ_ERR) $2 — nothing was merged." ;;
    *) finish 8 "retryable: cannot read PR #$PR ($READ_ERR) $2; nothing merged; re-run" ;;
  esac
}

RH=''
remote_head() {  # remote_head <branch> — 0 with RH set; 2 absent (deterministic, no retry); 8 unreadable (READ_ERR)
  local b="$1" try=0 rc
  while : ; do
    try=$((try+1))
    git -C "$REPO_PATH" ls-remote --exit-code origin "refs/heads/$b" >"$tmp/lsr.out" 2>"$tmp/lsr.err"; rc=$?
    if [ "$rc" -eq 0 ]; then
      RH=$(awk -v r="refs/heads/$b" '$2 == r { print $1; exit }' "$tmp/lsr.out")
      [ -n "$RH" ] && return 0
      return 2
    fi
    [ "$rc" -eq 2 ] && return 2
    READ_ERR=$(head -1 "$tmp/lsr.err" 2>/dev/null); [ -n "$READ_ERR" ] || READ_ERR="git ls-remote exited $rc"
    [ "$try" -ge "$READ_TRIES" ] && return 8
    sleep "$READ_INTERVAL"
  done
}

set_aside() {  # set_aside <why> — exit 4 with the reconcile-routable reason on stdout and stderr
  local line="set-aside reason: integration: $1"
  printf '%s\n' "$line"
  finish 4 "$line"
}

pin_head() {  # pin_head <snapshot-file> — 0 once GitHub's head is the integrated head (or the state left OPEN)
  local f="$1" round=0 rc
  while : ; do
    [ "$S_STATE" = OPEN ] || { LAST_WAIT=''; return 0; }          # the caller re-routes MERGED / CLOSED
    [ "$S_HEAD" = "$IHEAD" ] && { LAST_WAIT=''; return 0; }       # the head-lag wait, if any, is over
    round=$((round+1))
    if [ "$round" -gt "$HEAD_LAG_MAX" ]; then
      finish 8 "retryable: GitHub's PR #$PR head $S_HEAD still lags origin $S_HEADREF = integrated head $IHEAD after $HEAD_LAG_MAX reads; nothing merged; re-run"
    fi
    remote_head "$S_HEADREF"; rc=$?
    case "$rc" in
      0) ;;
      2) finish 1 "ERROR: PR #$PR's head branch $S_HEADREF is not on origin (PR head $S_HEAD): merge-task merges only a same-repo head" ;;
      *) finish 8 "retryable: cannot read origin $S_HEADREF ($READ_ERR) to tell a moved head from GitHub lag; nothing merged" ;;
    esac
    [ "$RH" = "$IHEAD" ] || set_aside "head moved after Integration (PR head $S_HEAD, origin $S_HEADREF at $RH, integrated head $IHEAD)"
    wait_line "PR #$PR: GitHub's head $S_HEAD lags origin $S_HEADREF = the integrated head; re-reading ($round/$HEAD_LAG_MAX)…"
    sleep "$HEAD_LAG_INTERVAL"
    snap_or_finish "$f" "while GitHub's head caught up with origin $S_HEADREF"
  done
}

LIVE=''
read_base() {  # read_base — LIVE = origin/<default> as GitHub has it; a failed read finishes 1 or 8
  local rc
  gh_read "$tmp/ref.json" "origin/$BASE" object.sha -- gh api "repos/$OWNER/$REPO/git/ref/heads/$BASE"; rc=$?
  case "$rc" in
    0) LIVE=$(jf "$tmp/ref.json" object.sha) ;;
    1) finish 1 "ERROR: cannot read origin/$BASE in $OWNER/$REPO ($READ_ERR) — nothing was merged." ;;
    *) finish 8 "retryable: cannot read origin/$BASE ($READ_ERR); nothing merged; re-run" ;;
  esac
}

record_base_moved() {  # record_base_moved <live> — the cap, inline before exit: finishes 3, 4 or 2
  local live="$1" n bases
  local moved="BASE MOVED: origin/$BASE is $live, not the integrated base $IBASE — nothing merged. Re-integrate PR #$PR on the same anchor, then call merge-task.sh with the new pair."
  if [ -f "$COUNTER" ] && grep -qx "$IBASE" "$COUNTER" 2>/dev/null; then
    finish 3 "$moved (this base was already counted)"
  fi
  if ! printf '%s\n' "$IBASE" >> "$COUNTER" 2>/dev/null || ! grep -qx "$IBASE" "$COUNTER" 2>/dev/null; then
    finish 2 "ERROR: cannot persist the base-moved counter $COUNTER — nothing merged (the re-integration cap fails closed)."
  fi
  n=$(sort -u "$COUNTER" | grep -c .)
  # The Run record's base-moved line (p29-10): what moved main and whether only Inert paths, once per newly counted
  # refusal (the cap's included), best-effort: its output is dropped and it never changes this exit.
  python3 "$LI_PY" base-moved --repo "$REPO_PATH" --pr "$PR" --base "$IBASE" --main "$live" --default "$BASE" \
    --refusal "$n" >/dev/null 2>&1 || true
  if [ "$n" -gt "$REINTEGRATE_MAX" ]; then
    bases=$(sort -u "$COUNTER" | tr '\n' ' ' | sed 's/ $//')
    set_aside "base moved before the merge $n times in a row after $REINTEGRATE_MAX re-integrations (bases $bases)"
  fi
  finish 3 "$moved (refusal $n; set aside after the $((REINTEGRATE_MAX + 1))th)"
}
check_base() { read_base; [ "$LIVE" = "$IBASE" ] || record_base_moved "$LIVE"; }

NR_RUNS=0; NR_HELD=0; NR_ROWS=''; NR_LIVE=''
no_runner_scan() {  # no_runner_scan <runs.json> <jobs-file prefix> <limit> — shell assignments for the NR_* fields (eval'd)
  python3 - "$1" "$2" "$3" <<'PY'
import json, shlex, sys, time
from datetime import datetime
runs_path, prefix, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
now = time.time()
def load(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return None
HOSTED = ("ubuntu-", "macos-", "windows-")
def github_hosted(job):
    """Whether the job waits in GitHub's own queue, never a lost runner's: a label names a GitHub-hosted image (prefix
    HOSTED: macos-latest, ubuntu-24.04-arm) and none is `self-hosted`. Labels missing, empty or not a list of strings
    read as hosted too: a job that cannot be placed is never "no runner", as a bad read."""
    labels = job.get("labels")
    if not isinstance(labels, list) or not labels or not all(isinstance(l, str) for l in labels):
        return True
    low = [l.lower() for l in labels]
    return "self-hosted" not in low and any(l.startswith(HOSTED) for l in low)
def queued_for(job):
    """Seconds a job has sat queued with no runner, past the limit; None when it is anything else, runs on a
    GitHub-hosted image (a macOS job can queue 15 minutes behind GitHub's concurrency cap), or does not parse."""
    if job.get("status") != "queued" or job.get("runner_id") or job.get("runner_name") or github_hosted(job):
        return None
    try:
        at = datetime.fromisoformat(str(job.get("created_at")).replace("Z", "+00:00"))
    except ValueError:
        return None
    if at.tzinfo is None:
        return None
    age = now - at.timestamp()
    return age if age >= limit else None
runs = (load(runs_path) or {}).get("workflow_runs")
if not isinstance(runs, list):
    sys.exit(1)
unfinished = [r for r in runs if isinstance(r, dict) and r.get("status") != "completed"]
held = 0
rows = []
live_names = []   # NR_LIVE: each unfinished job on the head, `<name> (<status>)`, a no-runner one `(queued, no runner)`
for r in unfinished:
    body = load("%s%s" % (prefix, r.get("id")))
    jobs = body.get("jobs") if isinstance(body, dict) else None
    if not isinstance(jobs, list):
        continue                        # its jobs unread: the run stays in flight
    live = [j for j in jobs if isinstance(j, dict) and j.get("status") != "completed"]
    stuck = 0
    for j in live:
        age = queued_for(j)
        name = " ".join(str(j.get("name") or "").replace("\t", " ").splitlines())   # one row, four cells
        live_names.append("%s (%s)" % (name, "queued, no runner" if age is not None else
                                        " ".join(str(j.get("status") or "?").split())))
        if age is not None:
            stuck += 1
            rows.append("\t".join((name, str(r.get("id")), str(j.get("id")), str(int(age // 60)))))
    # Every unfinished job no-runner, on a page that holds them all (a longer run may hide a live job).
    if live and stuck == len(live) and len(jobs) >= int(body.get("total_count") or 0):
        held += 1
# Deduped (a matrix's twins), capped at 8 plus `+N more`; no minutes or ids, so the wait line reads the same each poll.
names = list(dict.fromkeys(live_names))
waits_on = ", ".join(names[:8]) + (", +%d more" % (len(names) - 8) if len(names) > 8 else "")
print("NR_RUNS=%d NR_HELD=%d NR_ROWS=%s NR_LIVE=%s" % (len(unfinished), held, shlex.quote("\n".join(rows)),
                                                       shlex.quote(waits_on)))
PY
}
no_runner_read() {  # sets NR_RUNS, NR_HELD, NR_ROWS (`<name>\t<run>\t<job>\t<minutes>`) and NR_LIVE; 0 read, 1 the runs list unreadable
  local id assigns
  NR_RUNS=0; NR_HELD=0; NR_ROWS=''; NR_LIVE=''   # a failed read holds nothing: never an earlier poll's jobs
  gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$IHEAD&per_page=100" >"$tmp/nr.runs" 2>/dev/null || return 1
  for id in $(python3 -c 'import json,sys
for r in json.load(open(sys.argv[1])).get("workflow_runs") or []:
    if r.get("status") != "completed": print(r.get("id"))' "$tmp/nr.runs" 2>/dev/null); do
    case "$id" in ''|*[!0-9]*) continue ;; esac
    gh api "repos/$OWNER/$REPO/actions/runs/$id/jobs?per_page=100" >"$tmp/nr.jobs.$id" 2>/dev/null || : >"$tmp/nr.jobs.$id"
  done
  assigns=$(no_runner_scan "$tmp/nr.runs" "$tmp/nr.jobs." "$NO_RUNNER_LIMIT") || return 1
  eval "$assigns"
}

no_runner_match() {  # no_runner_match <`pr checks --required` table> <NR_ROWS> — the reason for each no-runner job a pending row holds
  python3 - "$1" "$2" <<'PY'
import re, sys
names, ids = set(), set()
for line in open(sys.argv[1]).read().split("\n"):
    cells = line.split("\t")
    if len(cells) > 1 and cells[1] == "pending":
        # A row whose link names its job is that job alone: another workflow's job of the same name is not this check.
        m = re.search(r"/job/([0-9]+)", cells[3] if len(cells) > 3 else "")
        if m:
            ids.add(m.group(1))
        else:
            names.add(cells[0])
out = []
for row in sys.argv[2].split("\n"):
    name, run, job, minutes = row.split("\t")
    if job in ids or name in names:
        out.append('required job "%s" queued %s minutes with no runner (run %s, job %s)' % (name, minutes, run, job))
print("; ".join(out))
PY
}

NR_WHY=''
no_runner_required() {  # 0 when a required job has no runner (NR_WHY names each); 1 when none is, or that cannot be read
  NR_WHY=''
  no_runner_read && [ -n "$NR_ROWS" ] || return 1
  gh pr checks "$PR" -R "$OWNER/$REPO" --required >"$tmp/nr.required" 2>/dev/null   # its exit says only pending or red
  NR_WHY=$(no_runner_match "$tmp/nr.required" "$NR_ROWS")
  [ -n "$NR_WHY" ]
}

ci_runs_in_flight() {  # success (0) when ≥1 workflow run on the integrated head is not completed and is not held only by no-runner jobs
  # "Never appeared" must mean "nothing is coming", not "hasn't appeared yet": a repo whose ONLY
  # required check is an end-of-workflow roll-up job (giflab's `Checks Complete`: `needs:` every other
  # job) doesn't get that check run CREATED until ~the whole suite has run — far longer than the
  # CHECK_RETRY_MAX appear budget (halted 3× in the 2026-07-04 giflab rollout). While this returns
  # true, wait_required_checks treats absent required checks as pending, not missing.
  # Probe WORKFLOW RUNS, not check-suites: installed apps (digitalocean, cursor) leave phantom check
  # suites permanently `queued` with 0 check runs on every commit — a check-suite probe would read
  # "in flight" forever. FAIL-CLOSED throughout: API error or unparseable count return 1, so the caller
  # falls back to the bounded appear budget. The head is the pinned integrated head (already verified).
  # A run held only by jobs no runner took stops counting (No runner, the header).
  no_runner_read || return 1
  [ "$NR_RUNS" -gt 0 ] || return 1
  if [ "$NR_HELD" -gt 0 ]; then
    echo "  PR #$PR — $NR_HELD of $NR_RUNS run(s) on head held only by jobs no runner took for ${NO_RUNNER_LIMIT}s: not counted as CI in flight."
  fi
  [ "$NR_HELD" -lt "$NR_RUNS" ]
}

infra_flake_rerun() {  # returns 0 if it re-ran failed jobs (caller should re-wait), 1 to HALT
  # Finding #4: inspect the failed REQUIRED runs' failing STEP names, classify infra vs genuine
  # (fail-closed), and `gh run rerun --failed` only when EVERY failed step is provably setup/infra.
  local links runs run_id steps s verdict reran=0
  # Failed REQUIRED checks only (branch protection's definition) → their run ids via the details link. Either read
  # selects the same rows, gh's `fail` and `cancel` buckets: `fail` holds ERROR, FAILURE, TIMED_OUT and
  # ACTION_REQUIRED, `cancel` holds CANCELLED. A gh with `pr checks --json` reads them by bucket. gh 2.43.1 (this
  # Mac's gh, p37-2) has no --json there ("unknown flag: --json", rc 1): then read the plain table. Off a TTY its
  # tab-separated columns are name, state, elapsed, link, description, and its state is the bucket with `cancel`
  # printed as `fail` (pass | fail | pending | skipping), so its `fail` rows are the same ERROR/FAILURE/TIMED_OUT/
  # ACTION_REQUIRED/CANCELLED set. Keep column 4 of each `fail` row: the link, never a URL-like description.
  # That set is wider than "a step failed": a cancelled, timed-out or errored run can hold no failed step, and
  # would add nothing to the classification. The per-run guard below stops as genuine on any selected run with no
  # failed step, before any re-run, so another run's setup failure never re-runs it on any gh (fail-closed).
  # The check-runs API is no fallback: it cannot tell a required check from the rest, and a red non-required
  # check would then read as genuine. Any gh: a failed read leaves no links, which is genuine (fail-closed).
  if ! links="$(gh pr checks "$PR" -R "$OWNER/$REPO" --required --json bucket,link -q '.[] | select(.bucket=="fail" or .bucket=="cancel") | .link' 2>/dev/null)"; then
    links="$(gh pr checks "$PR" -R "$OWNER/$REPO" --required 2>/dev/null \
      | awk -F'\t' '$2=="fail" && $4 ~ /^https?:\/\// {print $4}')"
  fi
  [ -z "$links" ] && { echo "  infra-classify: no failed required-check links — genuine (fail-closed)." >&2; return 1; }
  runs="$(printf '%s\n' "$links" | grep -oE 'runs/[0-9]+' | grep -oE '[0-9]+' | sort -u)"
  [ -z "$runs" ] && { echo "  infra-classify: could not parse run ids — genuine (fail-closed)." >&2; return 1; }
  steps=""
  for run_id in $runs; do
    s="$(gh run view "$run_id" -R "$OWNER/$REPO" --json jobs -q '.jobs[] | select(.conclusion=="failure") | .steps[] | select(.conclusion=="failure") | .name' 2>/dev/null)" || s=""
    # The per-run guard: a selected run with no failed step (cancelled, timed out, errored, or its read failed)
    # cannot be proven setup, and re-running it could turn a hang or a flaky test green.
    case "$s" in
      *[![:space:]]*) ;;
      *) echo "  infra-classify: run $run_id has no failed step to classify — genuine (fail-closed)." >&2; return 1 ;;
    esac
    steps="$(printf '%s\n%s' "$steps" "$s")"
  done
  verdict="$(printf '%s\n' "$steps" | classify_failed_steps)"
  if [ "$verdict" != "infra" ]; then
    echo "  infra-classify: a genuine (non-infra) step failed — HALTING (fail-closed). Failed steps:" >&2
    printf '%s\n' "$steps" | sed '/^[[:space:]]*$/d; s/^/    - /' >&2
    return 1
  fi
  echo "  infra-classify: only setup/infra steps failed — transient flake. Re-running failed jobs:" >&2
  printf '%s\n' "$steps" | sed '/^[[:space:]]*$/d; s/^/    - /' >&2
  for run_id in $runs; do
    if gh run rerun "$run_id" --failed -R "$OWNER/$REPO" >/dev/null 2>&1; then
      echo "    re-ran failed jobs of run $run_id." >&2; reran=1
    else
      echo "    WARN: gh run rerun $run_id --failed failed — HALTING (fail-closed)." >&2; return 1
    fi
  done
  [ "$reran" -eq 1 ] && return 0 || return 1
}

# ---- a CANCELLED required check (ADR 0073 d4) --------------------------------------------------------------------
# gh exits 0 from `pr checks --required --watch` when a required check is CANCELLED (its `cancel` bucket counts neither
# as failed nor as pending), and gh 2.43.1's table prints that row as `fail`. A cancelled required check is a CI timeout
# (its job hit `timeout-minutes`: PRs #324 and #326 at 40 minutes) or another stop on GitHub's side (a person's cancel,
# a newer run in its concurrency group); no test failed in any of them, and merge-task cannot tell them apart without
# the run's annotations. So a 0 from the wait with a red cell is never green: cancelled_required reads each red
# required check's conclusion. A gh with `pr checks --json` gives it as the bucket (`cancel`); gh 2.43.1 has no --json
# there, so its table's red rows are read by their job: `gh run view <run> --json jobs`, the job its link names, its
# conclusion `cancelled`. Fail-closed: a red row that is no proven cancellation (a `fail` bucket, a job concluded any
# other way, a link that names no run and job, a read that failed) is the red path's, never a timeout's.
CANCEL_RUNS=''; CANCEL_NAMES=''; CANCEL_WHY=''
red_rows() {  # red_rows <json|table> <file> — `<bucket>\t<run>\t<job>\t<name>` per red row, or NONE; exit 1 = not proven
  python3 - "$1" "$2" <<'PY'
import json, re, sys
mode, path = sys.argv[1:]
try:
    text = open(path).read()
except Exception:
    sys.exit(1)
if mode == "json":
    try:
        rows = [(r.get("bucket"), r.get("link") or "", r.get("name") or "") for r in json.loads(text)]
    except Exception:
        sys.exit(1)
else:
    rows = [(c[1], c[3] if len(c) > 3 else "", c[0]) for c in (l.split("\t") for l in text.split("\n")) if len(c) > 1]
    if not rows:
        sys.exit(1)  # nothing read: no proof either way
out = []
for bucket, link, name in rows:
    if bucket not in ("fail", "cancel"):
        continue
    if mode == "json" and bucket == "fail":
        sys.exit(1)  # FAILURE, ERROR, TIMED_OUT or ACTION_REQUIRED: a red check, never a cancellation
    m = re.search(r"/runs/([0-9]+)(?:/job/([0-9]+))?", link)
    if not m or (bucket == "fail" and not m.group(2)):
        sys.exit(1)  # no run to re-run, or no job whose conclusion would tell
    out.append("%s\t%s\t%s\t%s" % (bucket, m.group(1), m.group(2) or "-", name.replace("\t", " ") or "-"))
print("\n".join(out) if out else "NONE")
PY
}
job_conclusion() {  # job_conclusion <run view jobs json> <job id> — that job's conclusion, lowercased ("" if absent)
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    jobs = json.load(open(sys.argv[1])).get("jobs") or []
except Exception:
    jobs = []
print(next((str(j.get("conclusion") or "").lower() for j in jobs
            if isinstance(j, dict) and str(j.get("databaseId")) == sys.argv[2]), ""))
PY
}
cancelled_required() {  # 0 every red required check is CANCELLED (CANCEL_RUNS, CANCEL_NAMES); 1 not proven; 2 none red
  local rows b run jid name
  CANCEL_RUNS=''; CANCEL_NAMES=''
  if gh pr checks "$PR" -R "$OWNER/$REPO" --required --json name,bucket,link >"$tmp/req.out" 2>/dev/null; then
    rows=$(red_rows json "$tmp/req.out") || return 1
  else
    gh pr checks "$PR" -R "$OWNER/$REPO" --required >"$tmp/req.out" 2>/dev/null   # gh 2.43.1: its exit says nothing
    rows=$(red_rows table "$tmp/req.out") || return 1
  fi
  [ "$rows" = NONE ] && return 2
  while IFS=$'\t' read -r b run jid name; do
    [ -n "$run" ] || continue
    if [ "$b" = fail ]; then
      gh run view "$run" -R "$OWNER/$REPO" --json jobs >"$tmp/jobs.json" 2>/dev/null || return 1
      [ "$(job_conclusion "$tmp/jobs.json" "$jid")" = cancelled ] || return 1
    fi
    case " $CANCEL_RUNS " in *" $run "*) ;; *) CANCEL_RUNS="${CANCEL_RUNS:+$CANCEL_RUNS }$run" ;; esac
    CANCEL_NAMES="${CANCEL_NAMES:+$CANCEL_NAMES, }$name (run $run)"
  done <<EOF
$rows
EOF
  [ -n "$CANCEL_RUNS" ] || return 1
  return 0
}
rerun_cancelled() {  # `gh run rerun --failed` per cancelled run (GitHub re-runs its cancelled jobs too); 1 if one failed
  local run
  for run in $CANCEL_RUNS; do
    if ! gh run rerun "$run" --failed -R "$OWNER/$REPO" >/dev/null 2>"$tmp/rerun.err"; then
      CANCEL_WHY="its re-run could not start (gh run rerun $run --failed: $(head -1 "$tmp/rerun.err" 2>/dev/null))"
      return 1
    fi
    echo "    re-ran the failed jobs of run $run." >&2
  done
  return 0
}

snapshot_once() { local READ_TRIES=1; pr_snapshot "$1"; }   # one attempt (dynamic scope reaches gh_read)

# ---- the default branch's required gate (ADR 0069 d1) ------------------------------------------------------
# Whether $BASE can carry a required check at all: `some` (protected by branch protection or a ruleset, or a ruleset
# with a rule beyond RULES_NOT_CHECKS), `none` (two clean GitHub answers both deny any gate) or `unknown` (anything
# else). Read at most once per run, and only off the CLEAN path. Two whole-object reads, the branch percent-encoded
# whole (merge-gate.py's reads, ADR 0068):
#   1. branches/<b>: 200 `protected: true` → some, with no rules read; 200 `protected: false` → read 2; anything else
#      (any 404 or 403 whatever its text, a 200 with no boolean `protected`, no answer in READ_TRIES) → unknown.
#      Not branches/<b>/protection: that 404s on a branch a ruleset alone protects (lachyts/thread-skill's master,
#      2026-11-05), a false none; branches/<b> needs only read access.
#   2. rules/branches/<b>?per_page=100: 200, a list of under 100 rules each of a RULES_NOT_CHECKS type → none; a
#      list with any other type → some; 100 or more, or no list → unknown. A failed read whose stderr holds
#      `Upgrade to GitHub Pro` and `HTTP 403` and no `rate limit` → none (a private repo on the free plan, which can
#      hold no ruleset: lachyts/chorus, 2026-11-05); every other failure (404, a rate limit, an integration's 403, a
#      5xx) → unknown.
# A false none cannot merge a gated PR: merge-task merges only on CLEAN, or on UNSTABLE, which GitHub gives only once
# the required checks pass, and the squash is head-pinned (ADR 0069 d4).
REQ_GATE=''; REQ_WHY=''; GATE_ERR=''
gate_read() {  # gate_read <out> <endpoint> — 0 on rc 0; 1 on an HTTP 4xx answer (final, GATE_ERR); 8 after READ_TRIES
  local out="$1" ep="$2" try=0 rc
  while : ; do
    try=$((try+1))
    gh api "$ep" >"$out" 2>"$tmp/gate.err"; rc=$?
    if [ "$rc" -eq 0 ]; then GATE_ERR=''; return 0; fi
    GATE_ERR=$(head -1 "$tmp/gate.err" 2>/dev/null); [ -n "$GATE_ERR" ] || GATE_ERR="gh api exited $rc"
    grep -qE 'HTTP 4[0-9][0-9]' "$tmp/gate.err" 2>/dev/null && return 1
    [ "$try" -ge "$READ_TRIES" ] && return 8
    sleep "$READ_INTERVAL"
  done
}
gate_body() {  # gate_body <branches|rules> <file> — what a 200 body says: some | none | open (read the rules) | unknown
  python3 - "$1" "$2" <<'PY'
import json, sys
# Rule types that never require a check: the branch's lifecycle, its history, signatures, and pull_request, whose
# pending review the review gate catches first (exit 7).
RULES_NOT_CHECKS = {"creation", "update", "deletion", "non_fast_forward", "required_linear_history",
                    "required_signatures", "pull_request"}
kind, path = sys.argv[1:]
try:
    d = json.load(open(path))
except Exception:
    d = None
if kind == "branches":
    p = d.get("protected") if isinstance(d, dict) else None
    print("unknown" if not isinstance(p, bool) else "some" if p else "open")
elif not isinstance(d, list) or len(d) >= 100:
    print("unknown")
elif all(isinstance(r, dict) and r.get("type") in RULES_NOT_CHECKS for r in d):
    print("none")
else:
    print("some")
PY
}
required_gate() {  # sets REQ_GATE (some | none | unknown) and REQ_WHY, once per run; never exits
  [ -n "$REQ_GATE" ] && return 0
  local enc rc g
  enc=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$BASE")
  gate_read "$tmp/gate-branch.json" "repos/$OWNER/$REPO/branches/$enc"; rc=$?
  g=unknown
  [ "$rc" -eq 0 ] && g=$(gate_body branches "$tmp/gate-branch.json")
  case "$g" in
    some) REQ_GATE=some; REQ_WHY="$BASE is protected" ;;
    open)
      gate_read "$tmp/gate-rules.json" "repos/$OWNER/$REPO/rules/branches/$enc?per_page=100"; rc=$?
      if [ "$rc" -eq 0 ]; then
        REQ_GATE=$(gate_body rules "$tmp/gate-rules.json")
        case "$REQ_GATE" in
          none) REQ_WHY="not protected, and no ruleset rule requires a check" ;;
          some) REQ_WHY="not protected, but a ruleset rule may require a check" ;;
          *) REQ_GATE=unknown; REQ_WHY="rules/branches/$BASE: not a whole list of rules" ;;
        esac
      elif [ "$rc" -eq 1 ] && grep -q 'Upgrade to GitHub Pro' "$tmp/gate.err" 2>/dev/null \
           && grep -q 'HTTP 403' "$tmp/gate.err" 2>/dev/null && ! grep -qi 'rate limit' "$tmp/gate.err" 2>/dev/null; then
        REQ_GATE=none; REQ_WHY="not protected, and this plan holds no rulesets"
      else
        REQ_GATE=unknown; REQ_WHY="rules/branches/$BASE: $GATE_ERR"
      fi ;;
    *)
      REQ_GATE=unknown
      if [ "$rc" -eq 0 ]; then REQ_WHY="branches/$BASE: no protected flag"; else REQ_WHY="branches/$BASE: $GATE_ERR"; fi ;;
  esac
  echo "  $BASE's required gate: $REQ_GATE ($REQ_WHY)."
}

checks_watch() {  # one slice of the required-checks watch: gh's rc, or 142 once NO_RUNNER_POLL cut it
  [ "$(type -t lc_loaded)" = function ] || . "$LIVE_CHECKOUT" 2>/dev/null
  if [ "$(type -t lc_bounded)" = function ]; then
    # In a subshell: lc_bounded is a function, so its redirection would hold this shell's stdout while the slice runs,
    # and a signal's trap, run once the slice returns, would write on_exit's `last wait:` line into checks.out.
    ( lc_bounded "$NO_RUNNER_POLL" gh pr checks "$PR" -R "$OWNER/$REPO" --required --watch --fail-fast \
      --interval "$CHECK_INTERVAL" >"$tmp/checks.out" 2>"$tmp/checks.err" )
  else
    gh pr checks "$PR" -R "$OWNER/$REPO" --required --watch --fail-fast --interval "$CHECK_INTERVAL" \
      >"$tmp/checks.out" 2>"$tmp/checks.err"
  fi
}

pending_checks() {  # the required checks pending at the watch slice's last refresh, `, `-joined; nothing when it does not parse
  # Off a TTY `--watch` appends one tab-separated table per refresh (name, state, elapsed, link, description), so a
  # check's last row is its state as it stands. A line with no tab (gh's own notices) is no row.
  awk -F'\t' 'NF >= 2 && $1 != "" { if (!($1 in st)) order[++n] = $1; st[$1] = $2 }
    END { for (i = 1; i <= n; i++) if (st[order[i]] == "pending") printf "%s%s", (k++ ? ", " : ""), order[i] }' \
    "$tmp/checks.out" 2>/dev/null
}

WAIT_MSG=''
wait_required_checks() {  # wait_required_checks <the state machine's mergeStateStatus> — 0 green; 8 a transient gh error with no red row (WAIT_MSG); 1 halt (printed); a required job no runner took exits 4 here
  # The entry state is captured here, because each snapshot_once below overwrites S_MSS.
  local from="$1" absent=0 rc infra_reruns=0 cancel_reruns=0 mss crc held pending seen=''
  wait_line "PR #$PR — waiting on required checks…"
  while : ; do
    checks_watch; rc=$?
    if [ "$rc" -eq 142 ]; then
      # The slice ended with a required check still pending. A required job no runner took would hold the watch until
      # GitHub drops it, about 24 hours: set the task aside now, and free the lane (No runner, the header).
      no_runner_required && set_aside "no-runner: $NR_WHY"
      # Otherwise name what the wait is on, once per change, so a kill mid-wait names it (on_exit's `last wait:`).
      pending=$(pending_checks)
      if [ -n "$pending" ] && [ "$pending" != "$seen" ]; then
        seen=$pending
        wait_line "PR #$PR — waiting on required checks: $pending"
      fi
      continue
    fi
    if [ $rc -eq 0 ]; then
      # A 0 with no red cell is green. A 0 with one is a CANCELLED required check (above): one re-run of its failed
      # jobs, then the GitHub-side exit 1 the lead sets aside at Integration and the infra retry takes (ADR 0073 d4),
      # never green and never "a NON-check gate". A red row that is no proven cancellation takes the red path below.
      awk -F'\t' '{for(i=1;i<=NF;i++) if($i=="fail" || $i=="cancel") f=1} END{exit !f}' "$tmp/checks.out" || return 0
      cancelled_required; crc=$?
      [ "$crc" -eq 2 ] && return 0   # no red row as they stand: the red cell was an earlier refresh of the watch
      if [ "$crc" -eq 0 ]; then
        echo "  PR #$PR — required check CANCELLED, a CI timeout or another stop on GitHub's side: $CANCEL_NAMES." >&2
        if [ "$cancel_reruns" -lt "$CANCEL_RERUN_MAX" ]; then
          if rerun_cancelled; then
            cancel_reruns=$((cancel_reruns+1))
            echo "  cancelled-check rerun $cancel_reruns/$CANCEL_RERUN_MAX triggered — re-watching required checks…" >&2
            sleep "$CHECK_INTERVAL"
            continue
          fi
        else
          CANCEL_WHY="cancelled again after $CANCEL_RERUN_MAX re-run of its failed jobs"
        fi
        echo "ERROR: a REQUIRED check was CANCELLED on PR #$PR: a CI timeout or another stop on GitHub's side, no test failed; $CANCEL_WHY: $CANCEL_NAMES. Nothing was merged (ADR 0073 d4: GitHub-side, the automatic retry takes it)." >&2
        return 1
      fi
    fi
    # Required checks ABSENT — either not created YET (late roll-up check; CI still in flight on the
    # head) or genuinely never coming. While anything is running, wait — same trust semantics as
    # --watch on a visible pending check, bounded in practice by GitHub's own job timeouts. The
    # CHECK_RETRY_MAX budget only counts CONSECUTIVE polls where nothing is running anywhere.
    if grep -qiE 'no checks reported|no required checks' "$tmp/checks.out" "$tmp/checks.err" 2>/dev/null; then
      # No-CI recompute guard: after a merge advances the base, GitHub recomputes every open PR's
      # mergeability ASYNCHRONOUSLY — the state machine can sample a transient UNKNOWN/BLOCKED
      # and land here even in a repo with NO required checks configured at all (statusCheckRollup
      # empty). Without this re-poll, the loop counted absent polls while the PR quietly turned
      # CLEAN and then halted with "never appeared" — reproduced twice (narcissus-avp PRs #3, #5,
      # 2026-07-18), where an immediate re-run merged the same PR CLEAN first try. Re-poll
      # mergeStateStatus every pass (one read attempt; a failed read counts as neither CLEAN nor UNSTABLE, and
      # never falls back on the state machine's S_MSS): CLEAN means branch protection has nothing left to wait
      # for — hand back to the state machine, which re-reads the state and merges. A genuinely red required check
      # never takes this branch (gh pr checks reports the failure, not absence), so BLOCKED semantics are
      # untouched. One CLEAN sample is not GitHub settled: when the state machine's next read is UNKNOWN again,
      # it re-polls it lazily (settle_repoll, ADR 0069 d2), never the NON-check gate's exit 1.
      # UNSTABLE ⇒ every required check passed (the one statement of it; ADR 0069 d2 and d4): GitHub gives UNSTABLE
      # only once every required check has passed (a pending, failing or not-yet-reported required check reads
      # BLOCKED); only a non-required check is red or pending. So an UNSTABLE sample with no required check reported
      # merges, and both the state machine's UNSTABLE case and this sample lean on it. It is trusted only when the
      # state machine entered this wait from UNSTABLE: from BLOCKED or UNKNOWN one UNSTABLE sample in a flap would
      # set checks_done and turn the next BLOCKED read into the NON-check gate's exit 1, a human's stop, so that
      # entry keeps the absent count below. The sample is taken BEFORE the in-flight read, so neither an optional
      # run still going nor one parked on a deployment approval holds the Integration lane (compression-engine-
      # rollout-2026-11-08, PRs #151/#152: an optional job on a dead runner), and a probe error cannot decide it. A
      # required check its CI has yet to create reads BLOCKED, so it is still waited on through the in-flight
      # read (16b). Without the sample a protected base requiring no check (Animately/optimizer's develop:
      # `contexts: []`, `checks: []`) held every PR red only on optional jobs here until "never appeared"
      # (animately-app-rollout-2026-11-07, five of seven PRs). The gate read stays `some` for any protected base:
      # branches/<b> never shows a classic protection's non-check gates (conversation resolution, deployments, a
      # lock), so a BLOCKED PR there exits 1 `required checks never appeared` below: MERGE_TASK_INFRA, retried once
      # as GitHub-side infra and then Lachy's (ADR 0033 d4 as amended 2026-11-12), never the NON-check gate's
      # exit 1 (ADR 0069, amended 2026-11-07 and 2026-11-12).
      mss=''
      snapshot_once "$tmp/clean.json" && mss=$S_MSS
      if [ "$mss" = CLEAN ] || { [ "$mss" = UNSTABLE ] && [ "$from" = UNSTABLE ]; }; then
        echo "  PR #$PR — no required checks and mergeStateStatus=$mss — nothing to wait for."
        return 0
      fi
      if ci_runs_in_flight; then
        absent=0
        wait_line "PR #$PR — required checks not created yet; CI in flight on head — waiting${NR_LIVE:+ on: $NR_LIVE}…"
      else
        absent=$((absent+1))
        if [ "$absent" -gt "$CHECK_RETRY_MAX" ]; then
          # Nothing is coming. Whether that is a halt depends on the gate: with something required it is (1, which
          # the lead sets aside at Integration as GitHub-side, ADR 0069 d3); with the gate unreadable it is GitHub's
          # not yet, never a decision (8).
          if [ "$REQ_GATE" = unknown ]; then
            WAIT_MSG="retryable: no required check is reported for PR #$PR and nothing runs on its head, but $BASE's gate is unreadable ($REQ_WHY): GitHub has not settled its mergeability yet; nothing merged; re-run"
            return 8
          fi
          # A required roll-up check that `needs:` a job no runner took is never created: name those jobs on this
          # line, which the lead copies as the reason. ci_runs_in_flight just read nothing in flight, so with
          # NR_HELD > 0 every unfinished run is held and NR_ROWS holds only held jobs. The prefix stays
          # MERGE_TASK_INFRA's, an infra retry.
          held=''
          [ "$NR_HELD" -gt 0 ] && held=$(printf '%s\n' "$NR_ROWS" | awk -F'\t' 'NF == 4 {
            printf "%sjob \"%s\" queued %s minutes with no runner (run %s, job %s)", (n++ ? "; " : ""),
                   $1, $4, $2, $3 }')
          echo "ERROR: required checks never appeared for PR #$PR — no CI runs in flight on its head SHA, nothing is coming${held:+; held only by jobs no runner took: $held}" >&2
          return 1
        fi
      fi
      sleep "$CHECK_INTERVAL"; continue
    fi
    # A transient gh error (stderr only, never the check table) with no red row is retryable: nothing is
    # decided. Any `fail` row keeps the fail-closed red path below, whatever stderr says.
    if grep -qiE 'error connecting|i/o timeout|timeout|timed out|HTTP 5[0-9][0-9]|could not resolve host|connection reset|TLS handshake|unexpected EOF|API rate limit' "$tmp/checks.err" 2>/dev/null \
       && ! awk -F'\t' '{for(i=1;i<=NF;i++) if($i=="fail") f=1} END{exit !f}' "$tmp/checks.out"; then
      WAIT_MSG="retryable: gh pr checks failed ($(head -1 "$tmp/checks.err")); nothing merged"
      return 8
    fi
    echo "ERROR: a REQUIRED check FAILED on PR #$PR (Ralph passed locally, but remote CI is red):" >&2
    cat "$tmp/checks.out" "$tmp/checks.err" 2>/dev/null | tail -6 >&2
    # Finding #4: tell a transient infra/setup flake from a genuine test failure; auto-rerun the former a
    # bounded number of times before halting. infra_flake_rerun is FAIL-CLOSED — a genuine failure halts.
    if [ "$infra_reruns" -lt "$INFRA_RERUN_MAX" ] && infra_flake_rerun; then
      infra_reruns=$((infra_reruns+1))
      echo "  infra rerun $infra_reruns/$INFRA_RERUN_MAX triggered — re-watching required checks…" >&2
      sleep "$CHECK_INTERVAL"
      continue
    fi
    echo "  Diagnose: gh pr checks $PR -R $OWNER/$REPO — push a fix to the branch, re-integrate, then re-run merge-task.sh." >&2
    return 1
  done
}

# ---- the MERGED paths -------------------------------------------------------------------------------------
M=''; VERDICT=''; VMSG=''
verify_merged() {  # sets M and VERDICT (ok | race | unverified) with VMSG; reads only, never exits
  local i=0 rc parents np p1
  M="$S_MC"
  while [ -z "$M" ]; do
    i=$((i+1)); [ "$i" -gt "$MERGE_CONFIRM_MAX" ] && break
    sleep "$CONFIRM_INTERVAL"
    pr_snapshot "$tmp/snap.json" || break
    M="$S_MC"
  done
  if [ -z "$M" ]; then
    VERDICT=unverified; VMSG="UNVERIFIED: PR #$PR merged as unknown; not verifiable yet; re-run to verify"
    return 0
  fi
  gh_read "$tmp/commit.json" "commit $M" parents -- gh api "repos/$OWNER/$REPO/commits/$M"; rc=$?
  if [ "$rc" -ne 0 ]; then
    VERDICT=unverified; VMSG="UNVERIFIED: PR #$PR merged as $M; not verifiable yet ($READ_ERR); re-run to verify"
    return 0
  fi
  parents=$(jparents "$tmp/commit.json")
  np=$(printf '%s\n' "$parents" | grep -c .)
  p1=$(printf '%s\n' "$parents" | grep . | tr '\n' ',' | sed 's/,$//')
  if [ "$S_HEAD" = "$IHEAD" ] && [ "$np" -eq 1 ] && [ "$p1" = "$IBASE" ]; then
    VERDICT=ok; VMSG="PR #$PR merged as $M on the integrated base $IBASE at the integrated head $IHEAD (verified)."
  else
    VERDICT=race
    VMSG="RACE: PR #$PR merged as $M on parent ${p1:-none} at head $S_HEAD, not the integrated pair (head $IHEAD, base $IBASE); origin/$BASE holds an unverified combination; re-verify it"
  fi
}

anchor_cleanup() {  # p12-6's anchor lifecycle: the ref goes once the PR merges; guarded by its old value
  local ref x
  [ -n "$S_HEADREF" ] || return 0
  ref="refs/integration-anchor/$S_HEADREF"
  x=$(git -C "$REPO_PATH" rev-parse -q --verify "$ref" 2>/dev/null) || return 0
  if git -C "$REPO_PATH" update-ref -d "$ref" "$x" >/dev/null 2>&1; then
    echo "  anchor ref $ref deleted."
  else
    echo "  WARN: could not delete $ref (it changed since read); the lead deletes it."
  fi
}

land_and_finish() {  # land_and_finish <fresh 1|0> — verify, clean up, refresh; exit by 5 > 8 > 6 > 0
  local fresh="$1" rrc br
  if [ "$fresh" = 1 ]; then echo "  PR #$PR merged (squash) — verifying the squash commit…"
  else echo "PR #$PR already merged — verifying it against the integrated pair…"; fi
  verify_merged
  anchor_cleanup
  br="$S_HEADREF"
  # Best-effort REMOTE branch cleanup after this run's merge (non-fatal). Local branch + worktree are the reaper's job.
  if [ "$fresh" = 1 ] && [ -n "$br" ] && [ "$br" != "$BASE" ] && [ "$br" != "main" ] && [ "$br" != "master" ]; then
    if gh api --method DELETE "repos/$OWNER/$REPO/git/refs/heads/$br" >/dev/null 2>&1; then
      echo "  remote branch '$br' deleted."
    else
      echo "  (remote branch '$br' left for the reaper.)"
    fi
  fi
  if [ -n "$M" ]; then refresh_local_base "$REPO_PATH" "$BASE" "$M"; rrc=$?
  else refresh_local_base "$REPO_PATH" "$BASE"; rrc=$?; fi
  refresh_in_place "$REPO_PATH"
  # CI headroom (ADR 0073 d5): each required job's time, conclusion and time limit, one Run-record line per job, through
  # lead-integrate.py ci-headroom (bounded reads, no live poll; a job already recorded is never written twice, so a
  # re-run on the already-merged path adds none). Best-effort: its output is dropped and it never changes this exit.
  python3 "$LI_PY" ci-headroom --repo "$REPO_PATH" --pr "$PR" --head "$IHEAD" ${M:+--merge "$M"} >/dev/null 2>&1 || true
  case "$VERDICT" in
    race) printf '%s\n' "$VMSG"; finish 5 "$VMSG" ;;
    unverified) finish 8 "$VMSG" ;;
  esac
  [ "$rrc" -eq 6 ] && finish 6 "ERROR: PR #$PR merged and verified as $M, but the local refresh failed twice; re-run merge-task.sh with the same args (it takes the already-merged path)."
  finish 0 "$VMSG"
}

route_not_open() {  # a snapshot whose state is not OPEN: MERGED → the already-merged path; else 1
  [ "$S_STATE" = MERGED ] && land_and_finish 0
  finish 1 "ERROR: PR #$PR is '$S_STATE' (not OPEN/MERGED) — nothing was merged. Resolve manually."
}

review_gate() {  # 7 at once when a review is what blocks the PR: never a checks wait, never a bypass
  case "$S_REVIEW" in
    REVIEW_REQUIRED|CHANGES_REQUESTED)
      finish 7 "review required: approve PR #$PR ($S_URL); merge-task never bypasses protection (reviewDecision $S_REVIEW, mergeStateStatus $S_MSS). Nothing merged; re-run once approved." ;;
  esac
}

lazy=0
settle_repoll() {  # settle_repoll <why> — one re-poll of a PR GitHub has not settled (ADR 0069 d2); past the bound, 8
  lazy=$((lazy+1))
  if [ "$lazy" -gt "$LAZY_REPOLL_MAX" ]; then
    finish 8 "retryable: PR #$PR stays $1 after $LAZY_REPOLL_MAX re-polls: GitHub has not settled its mergeability yet; nothing merged; re-run"
  fi
  wait_line "PR #$PR reads $1 — GitHub has not settled its mergeability; re-polling ($lazy/$LAZY_REPOLL_MAX)…"
  sleep "$STATE_INTERVAL"
}

# ---- the merge ---------------------------------------------------------------------------------------------
confirm_merged() {  # gh pr merge returned 0: re-read until MERGED; never trust the exit code alone
  local i=0 dis=n/a
  while : ; do
    pr_snapshot "$tmp/snap.json" || finish 8 "retryable: gh pr merge returned 0 but PR #$PR is unreadable ($READ_ERR); re-run to verify (it takes the already-merged path if the merge landed)"
    [ "$S_STATE" = MERGED ] && land_and_finish 1
    i=$((i+1)); [ "$i" -ge "$MERGE_CONFIRM_MAX" ] && break
    sleep "$CONFIRM_INTERVAL"
  done
  if [ "$S_AUTO" = set ]; then
    if gh pr merge "$PR" -R "$OWNER/$REPO" --disable-auto >/dev/null 2>&1; then dis=ok; else dis=failed; fi
  fi
  finish 1 "ERROR: gh reported success but PR #$PR is not confirmed merged (queued or auto-merge?); auto-merge disable $dis; a re-run takes the already-merged path if it lands later"
}

merge_pr() {  # base re-check, the head-pinned squash merge, then confirmation or the refusal order
  local rc err
  check_base
  echo "  PR #$PR is $S_MSS — squash-merging at the integrated head ${IHEAD}…"
  gh pr merge "$PR" -R "$OWNER/$REPO" --squash --match-head-commit "$IHEAD" >"$tmp/merge.out" 2>"$tmp/merge.err"; rc=$?
  cat "$tmp/merge.out" "$tmp/merge.err" 2>/dev/null | sed 's/^/  gh: /'
  [ "$rc" -eq 0 ] && confirm_merged
  err=$(head -3 "$tmp/merge.err" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
  # The refusal order: decided by re-reads, never by the error text alone.
  snap_or_finish "$tmp/snap.json" "after gh pr merge failed ($err)"
  [ "$S_STATE" = MERGED ] && land_and_finish 1
  read_base
  [ "$LIVE" = "$IBASE" ] || record_base_moved "$LIVE"
  [ "$S_STATE" = OPEN ] || route_not_open
  if [ "$S_HEAD" != "$IHEAD" ]; then
    pin_head "$tmp/snap.json"
    [ "$S_STATE" = OPEN ] || route_not_open
  fi
  if grep -q 'Head branch was modified' "$tmp/merge.err" 2>/dev/null; then
    remote_head "$S_HEADREF"; rc=$?
    case "$rc" in
      2) finish 1 "ERROR: PR #$PR's head branch $S_HEADREF is not on origin (PR head $S_HEAD): merge-task merges only a same-repo head" ;;
      8) finish 8 "retryable: cannot read origin $S_HEADREF ($READ_ERR) to tell a moved head from GitHub lag; nothing merged" ;;
    esac
    [ "$RH" = "$IHEAD" ] || set_aside "head moved after Integration (PR head $S_HEAD, origin $S_HEADREF at $RH, integrated head $IHEAD)"
    finish 8 "retryable: GitHub refused PR #$PR with \"Head branch was modified\", but PR head and origin $S_HEADREF both read the integrated head $IHEAD: GitHub was behind; nothing merged; re-run"
  fi
  case "$S_MSS" in BLOCKED) review_gate ;; esac
  if grep -qE 'is not mergeable|HTTP 405|HTTP 409|HTTP 422|Required status check|protected branch|merges are not allowed|Repository rule violations found' "$tmp/merge.err" 2>/dev/null; then
    finish 1 "ERROR: GitHub refused to merge PR #$PR: $err — nothing was merged."
  fi
  finish 8 "retryable: gh pr merge failed for PR #$PR ($err) and nothing changed (state $S_STATE, base and head unmoved); re-run"
}

# ---- pre-pass: default branch, PR, head pin, merge queue, base in head, live base ------------------------
gh_read "$tmp/repo.json" "default branch" defaultBranchRef.name -- gh repo view "$OWNER/$REPO" --json defaultBranchRef; rc=$?
case "$rc" in
  0) BASE=$(jf "$tmp/repo.json" defaultBranchRef.name) ;;
  1) finish 1 "ERROR: cannot read the default branch of $OWNER/$REPO ($READ_ERR) — nothing was merged." ;;
  *) finish 8 "retryable: cannot read the default branch of $OWNER/$REPO ($READ_ERR); nothing merged; re-run" ;;
esac
snap_or_finish "$tmp/snap.json" "before the merge"
[ "$S_STATE" = OPEN ] || route_not_open
if [ "$S_BASEREF" != "$BASE" ]; then
  finish 1 "ERROR: PR #$PR targets '$S_BASEREF', not the default branch '$BASE' — nothing was merged.
  Retarget it (gh pr edit $PR --base $BASE) or set the task aside."
fi
pin_head "$tmp/snap.json"
[ "$S_STATE" = OPEN ] || route_not_open

gh_read "$tmp/mq.json" "isMergeQueueEnabled" data.repository.pullRequest.isMergeQueueEnabled -- \
  gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){isMergeQueueEnabled}}}' \
  -f o="$OWNER" -f r="$REPO" -F n="$PR"; rc=$?
case "$rc" in
  0) [ "$(jf "$tmp/mq.json" data.repository.pullRequest.isMergeQueueEnabled)" = true ] \
       && finish 1 "ERROR: merge queue required on $BASE: merge-task cannot pin the base — nothing was merged." ;;
  1) finish 1 "ERROR: cannot read isMergeQueueEnabled for PR #$PR ($READ_ERR): merge-task cannot tell whether a merge queue is required — nothing was merged." ;;
  *) finish 8 "retryable: cannot read isMergeQueueEnabled for PR #$PR ($READ_ERR); nothing merged; re-run" ;;
esac

gh_read "$tmp/cmp.json" "compare" status -- gh api "repos/$OWNER/$REPO/compare/$IBASE...$IHEAD"; rc=$?
case "$rc" in
  0) cmp=$(jf "$tmp/cmp.json" status)
     case "$cmp" in
       ahead|identical) ;;
       *) finish 1 "ERROR: PR head $IHEAD does not contain the integrated base $IBASE (compare: $cmp): not an integrated pair — nothing was merged." ;;
     esac ;;
  1) finish 1 "ERROR: cannot compare $IBASE...$IHEAD in $OWNER/$REPO ($READ_ERR) — nothing was merged." ;;
  *) finish 8 "retryable: cannot compare $IBASE...$IHEAD ($READ_ERR); nothing merged; re-run" ;;
esac

check_base

# ---- the state machine (up to STATE_GUARD_MAX passes; each takes a snapshot and pins the head) --------------
guard=0; checks_done=0; behind=0
while : ; do
  guard=$((guard+1)); LAST_WAIT=''   # a pass ends the wait the last one printed (a re-poll's sleep)
  [ "$guard" -gt "$STATE_GUARD_MAX" ] && finish 1 "ERROR: PR #$PR did not converge to a mergeable state"
  snap_or_finish "$tmp/snap.json" "in the state machine"
  [ "$S_STATE" = OPEN ] || route_not_open
  pin_head "$tmp/snap.json"
  [ "$S_STATE" = OPEN ] || route_not_open
  case "$S_MSS" in
    BEHIND)
      # Never an update: a moved base is a re-integration (3); an unmoved one is GitHub's stale state.
      check_base
      behind=$((behind+1))
      [ "$behind" -gt "$BEHIND_REPOLL_MAX" ] && finish 1 "ERROR: PR #$PR stays BEHIND although origin/$BASE is still the integrated base $IBASE — nothing was merged. Inspect it on GitHub: $S_URL"
      wait_line "PR #$PR reads BEHIND on an unmoved base — re-polling ($behind/$BEHIND_REPOLL_MAX)…"
      sleep "$STATE_INTERVAL" ;;
    DIRTY)
      check_base
      finish 1 "ERROR: PR #$PR has a MERGE CONFLICT with $BASE (mergeStateStatus=DIRTY) on the integrated base — nothing was merged.
  Do NOT force. Set the task aside; it re-integrates or goes back to its own run." ;;
    BLOCKED|UNKNOWN)
      review_gate
      if [ "$checks_done" -eq 1 ]; then
        # Checks green, still BLOCKED: a gate GitHub has decided (1). Still UNKNOWN: GitHub has not decided yet, so
        # re-poll it (ADR 0069 d2), as after the recompute guard's one CLEAN sample.
        if [ "$S_MSS" = UNKNOWN ]; then
          settle_repoll "UNKNOWN after its required checks went green"
        else
          finish 1 "ERROR: PR #$PR is $S_MSS but required checks are already green — a NON-check gate is
  blocking it (an unexpected required review or unresolved conversation). Resolve on
  GitHub: $S_URL"
        fi
      else
        required_gate
        if [ "$REQ_GATE" = none ]; then
          # Nothing can be required on $BASE, so no check is coming: BLOCKED or UNKNOWN is GitHub's lazy recompute.
          settle_repoll "$S_MSS with nothing required on $BASE ($REQ_WHY)"
        else
          wait_required_checks "$S_MSS"; rc=$?; LAST_WAIT=''
          case "$rc" in 0) ;; 8) finish 8 "$WAIT_MSG" ;; *) finish 1 ;; esac
          checks_done=1
        fi
      fi ;;
    UNSTABLE)
      # Mergeable under branch protection, but a NON-required check is red or still pending.
      # GitHub never reports CLEAN while a non-required check is red — and this repo's main
      # legitimately carries red non-required checks (lint/mypy → baseline-red-ci, perf →
      # perf-tier-calibration, Windows ext-tools → env) that other tasks fix. Gate on REQUIRED
      # checks only — exactly what branch protection enforces — then squash-merge. A genuinely
      # failing REQUIRED check surfaces as BLOCKED, not UNSTABLE, so this never merges a red gate.
      # ⚠️ DO NOT "tidy" this back to CLEAN-only. CLEAN requires EVERY check green (required AND
      # non-required); a repo whose main carries red non-required checks would then merge NOTHING in
      # any rollout — the exact failure from the 2026-06-02 giflab run. Gating on `--required` is branch
      # protection's own definition of mergeable.
      # The fake-gh suites cannot prove GitHub's semantics, so this comment IS the guard.
      # With nothing required on $BASE (REQ_GATE none, ADR 0069 d1) there is no required check to wait on: merge.
      if [ "$checks_done" -eq 0 ]; then
        required_gate
        if [ "$REQ_GATE" != none ]; then
          wait_required_checks UNSTABLE; rc=$?; LAST_WAIT=''
          case "$rc" in 0) ;; 8) finish 8 "$WAIT_MSG" ;; *) finish 1 ;; esac
        fi
        checks_done=1
      fi
      merge_pr ;;
    CLEAN)
      merge_pr ;;
    *)
      finish 1 "ERROR: PR #$PR unexpected mergeStateStatus='$S_MSS' — nothing was merged." ;;
  esac
done
