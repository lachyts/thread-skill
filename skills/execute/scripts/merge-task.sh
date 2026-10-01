#!/usr/bin/env bash
# merge-task.sh — merge ONE integrated PR, and only onto the base its Integration used (ADR 0030, p12-7).
#
# Usage:  merge-task.sh <repoPath> <pr> <integrated-head-sha> <integrated-base-sha>
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
#      The local refresh ran, or printed a non-fatal WARN (non-base checkout, local-only commits, a dirty
#      tree or an autostash refusal).                                    counter cleared    lead: mark-done
#   1  Definitive halt; the reason is printed (Exit 1 causes, below).   counter cleared    lead: set aside
#                                                                                          (own run or human)
#   2  Usage or environment: bad arg count; a SHA not 40-hex; <pr> neither a positive number nor a
#      github.com/<o>/<r>/pull/<N> URL; a URL whose <o>/<r> is not origin's; gh, git or python3 missing;
#      not a repo; no origin; a MERGE_TASK_* override that is not a non-negative integer (at most 9
#      digits); the counter cannot be persisted. Every one is before any GitHub call.
#                                                                        counter UNTOUCHED  lead: halt the
#                                                                                          rollout for a human
#   3  BASE MOVED: origin/<default> ≠ the integrated base. Nothing merged.
#                                                                        counter appended   lead: re-integrate
#                                                                                          on the same anchor
#   4  Set aside AT Integration. Prints `set-aside reason: integration: <why>` on stdout and stderr:
#      (a) the cap: `integration: base moved before the merge 4 times in a row after 3 re-integrations
#      (bases …)`; (b) `integration: head moved after Integration (PR head <h>, origin <b> at <r>, integrated
#      head <i>)`, only when origin's branch (ls-remote) ≠ the integrated head.
#                                                                        counter cleared    lead: mark blocked;
#      the diagnosis's first line is the text after `set-aside reason: `, which reconcile reads as
#      `setAsideAt: integration` (reconcile-rollout.py INTEGRATION_PREFIX).
#   5  Terminal RACE: MERGED, but headRefOid ≠ the integrated head, or the squash parent ≠ the integrated
#      base, or the squash has more than one parent (every read succeeded). Prints `RACE: PR #N merged as
#      <oid> on parent <p> at head <h>, not the integrated pair (head <i>, base <b>); origin/<default> holds
#      an unverified combination; re-verify it`.                         counter cleared    lead: never
#                                                                                          re-call (below)
#   6  MERGED and verified, but the local refresh failed twice (the fetch failed, or origin/<default> lacks
#      the merge commit). Never says "fast-forwarded".                   counter cleared    lead: re-run; it
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
#      merge call that failed with unrecognised text and changed nothing; or MERGED, but the head or parent
#      unreadable within the bound (`UNVERIFIED: PR #N merged as <oid or unknown>; not verifiable yet;
#      re-run to verify`).                                               counter UNTOUCHED  lead: re-run the
#                                                                                          same args after a
#                                                                                          backoff, bounded
#                                                                                          by p12-9, then pause
#   70  Abort: the run ended outside `finish` and the signal traps, i.e. a defect such as a `set -u` abort.
#      bash 3.2 exits those with 1, or (an unset name inside `$((…))`) with the last command's status, often
#      0, which would read as "merged"; the EXIT trap turns every such exit into 70. Sentinel `failed:abort`.
#                                                                        counter UNTOUCHED  lead: halt the
#                                                                                          rollout for a human
#                                                                                          (a re-run aborts
#                                                                                          again)
#   143 130 129  A signal: TERM, INT, HUP (their traps). Sentinel `failed:<rc>`.
#                                                                        counter UNTOUCHED  lead: re-run
#                                                                                          (idempotent)
#
# Exit 1 causes: the PR is off the default branch, CLOSED, or has an unexpected state or mergeStateStatus
# (DRAFT, HAS_HOOKS, anything else); a definitive not-found (`HTTP 404`, `HTTP 422`, `Could not resolve
# to a`); the PR's head branch is absent on origin while GitHub's PR head ≠ the integrated head (a
# cross-repository PR or a deleted branch); the head does not contain the base; DIRTY, or BEHIND after a
# bounded re-poll, on an unmoved base; a red required check on a genuine step; a non-check gate (checks
# green, still BLOCKED, no review pending); a merge queue is required, or `isMergeQueueEnabled` is absent
# from the schema; GitHub refused the merge with a known text (`is not mergeable|HTTP 405|HTTP 409|HTTP 422|
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
# Kept from merge-wave.sh: required checks are the gate (UNSTABLE handling, infra reruns, an absent check
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
CHECK_RETRY_MAX=10     # consecutive "no required checks AND no CI in flight" polls before halting
CHECK_INTERVAL=${MERGE_TASK_CHECK_INTERVAL:-15}          # gh pr checks --watch refresh
STATE_GUARD_MAX=8      # bound the state machine (checks -> CLEAN is ~2 hops)
STATE_INTERVAL=${MERGE_TASK_STATE_INTERVAL:-10}          # re-poll of a BEHIND state on an unmoved base
BEHIND_REPOLL_MAX=3    # BEHIND re-polls on an unmoved base before halting (within the guard)
INFRA_RERUN_MAX=2      # finding #4: transient-infra reruns of a failed required job before halting
MERGE_CONFIRM_MAX=5    # re-reads of state (after gh merge) and of mergeCommit (verify) before giving up
CONFIRM_INTERVAL=${MERGE_TASK_CONFIRM_INTERVAL:-2}
READ_TRIES=${MERGE_TASK_READ_TRIES:-3}                   # attempts per GitHub read (and per ls-remote)
READ_INTERVAL=${MERGE_TASK_READ_INTERVAL:-5}
HEAD_LAG_MAX=6         # PR re-reads while GitHub's head lags origin's branch at the integrated head
HEAD_LAG_INTERVAL=${MERGE_TASK_HEAD_LAG_INTERVAL:-5}
REINTEGRATE_MAX=${MERGE_TASK_REINTEGRATE_MAX:-3}         # re-integrations allowed; the next refusal sets aside

# ---- infra-vs-genuine failure classifier (finding #4) ----------------------
# A red REQUIRED check can be a transient CI infra/setup flake (dependency-install timeout, network blip,
# runner provisioning) rather than a genuine test failure. We rerun the former a bounded number of times;
# we NEVER rerun the latter (that would mask a flaky test as a false green). classify_failed_steps reads
# the FAILED step names (one per line, on stdin) and prints "infra" ONLY when it can prove every failed
# step is setup/provisioning; anything else — a test/lint/build step, an unrecognised step, or no steps at
# all — is "genuine". FAIL-CLOSED by construction: the burden of proof is on "infra".
# Defined up here (before arg parsing) so the --self-test-classify hook can exercise it with no live GitHub.
classify_failed_steps() {  # stdin: failed step names; stdout: "infra" | "genuine"
  local saw=0 verdict=infra line lc
  while IFS= read -r line; do
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    saw=1
    lc="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    # Denylist FIRST (fail-closed): anything that looks like the actual test/build/lint work is genuine.
    if printf '%s' "$lc" | grep -qE 'test|pytest|assert|spec|lint|mypy|type ?check|coverage|benchmark|compile|build'; then
      verdict=genuine; break
    fi
    # Allowlist: recognised setup/provisioning/network steps. An UNRECOGNISED step ⇒ genuine (fail-closed).
    if printf '%s' "$lc" | grep -qE 'install|dependenc|set ?up|checkout|cache|download|provision|restore|bootstrap|configure|pip|poetry|npm ci|npm install|yarn|apt|brew|fetch|clone'; then
      :  # infra-looking — keep scanning the rest
    else
      verdict=genuine; break
    fi
  done
  [ "$saw" -eq 1 ] || verdict=genuine   # no parseable steps ⇒ cannot prove infra ⇒ genuine
  printf '%s' "$verdict"
}

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
# One refresh attempt is `git fetch origin <base>` succeeding AND, when a SHA is given (the merge commit),
# origin/<base> containing it; two attempts. Both failing returns 6 with `NOT refreshed` and moves nothing:
# a fast-forward after a failed fetch would land the checkout on a stale ref and still claim a refresh
# (p6-7). The fast-forward never autostashes: with `merge.autoStash true` a dirty overlap would be stashed,
# applied and popped into conflict markers (or left in the stash list), so it is refused like any dirty
# overlap. Every other refusal (a non-base checkout, local-only commits, a dirty tree) is a non-fatal WARN
# and returns 0 (a false halt after a successful merge). Defined before the self-test hooks so
# --self-test-base can exercise it against a temp repo.
REPO_STATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../../close/scripts/repo-state.sh"
refresh_local_base() {  # $1=repoPath  $2=base branch ('' ⇒ unresolved)  [$3=a SHA origin/<base> must contain]
  local repo="$1" base="$2" must="${3:-}" cur ff=0 line='' raw='' why='' n before oh try fwhy=''
  if [ -z "$base" ]; then
    echo "  WARN: could not resolve the base branch — skipped local fast-forward (non-fatal)."
    return 0
  fi
  echo "== refreshing local $base =="
  for try in 1 2; do
    if ! git -C "$repo" fetch origin "$base" >/dev/null 2>&1; then
      fwhy="git fetch origin $base failed"; continue
    fi
    if [ -n "$must" ] && ! git -C "$repo" merge-base --is-ancestor "$must" "refs/remotes/origin/$base" >/dev/null 2>&1; then
      fwhy="origin/$base lacks merge $must"; continue
    fi
    fwhy=''; break
  done
  if [ -n "$fwhy" ]; then
    echo "  WARN: local $base NOT refreshed: $fwhy (twice); the checkout was not moved."
    return 6
  fi
  cur=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$cur" != "$base" ]; then
    echo "  NOTE: checkout is on '$cur', not $base — left as it is; the worktree reaper keeps zero-commit task branches until it advances."
    return 0
  fi
  before=$(git -C "$repo" rev-parse -q --verify HEAD 2>/dev/null)
  if git -C "$repo" merge --ff-only --no-autostash "origin/$base" >/dev/null 2>&1; then
    ff=1
    # A no-op fast-forward (origin/$base is behind the checkout) moved nothing: never claim it did.
    if [ "$(git -C "$repo" rev-parse -q --verify HEAD 2>/dev/null)" = "$before" ]; then
      echo "  local $base already at or ahead of origin/$base."
    else
      echo "  local $base fast-forwarded to origin/$base."
    fi
  fi
  # repo-state.sh's line for commits on $base that origin/$base lacks; anything else is no usable line.
  if [ -f "$REPO_STATE" ]; then
    raw=$(bash "$REPO_STATE" "$repo" 2>/dev/null) || { raw=''; why='the repo-state check failed'; }
  else
    why='repo-state.sh not found'
  fi
  case "$raw" in "on $base, "*" not on origin/$base"*) line=$raw ;; esac
  if [ "$ff" = 1 ]; then
    # A no-op fast-forward (origin/$base is behind): the checkout can still be ahead.
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
    echo "        origin/$base holds the merges and later tasks' worktrees branch from it; the worktree reaper keeps zero-commit task branches until it advances."
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
  n=$(git -C "$repo" rev-list --count "origin/$base..HEAD" 2>/dev/null)
  case "$n" in
    ''|*[!0-9]*) echo "  WARN: local $base did not fast-forward (checkout dirty or diverged)." ;;
    0) echo "  WARN: local $base did not fast-forward (no local-only commits: local changes in the checkout block it)." ;;
    *) echo "  WARN: local $base did not fast-forward: $n commit(s) not on origin/$base — not named ($why)." ;;
  esac
  echo "        origin/$base holds the merges and later tasks' worktrees branch from it; the worktree reaper keeps zero-commit task branches until it advances."
  return 0
}

# Self-test hook: `merge-task.sh --self-test-base` drives refresh_local_base against a throwaway repo
# whose origin default branch is `master` (no `main` anywhere): checkout on master ⇒ fast-forwarded;
# checkout on another branch ⇒ untouched; unresolved base ⇒ skipped; a local-only commit ⇒ named stranded,
# then queued once a close/… branch carries it, then split once a stranded one sits on top; a dirty
# overlap ⇒ says so; origin/HEAD unset or stale ⇒ counted, with a hint that tells the two apart; a no-op
# fast-forward ⇒ "already at or ahead", never "fast-forwarded"; merge.autoStash with a dirty overlap ⇒
# refused, file and stash list intact; a failed fetch, or an origin/master lacking the given merge ⇒ 6,
# "NOT refreshed", nothing moved. Needs git only — no GitHub.
if [ "${1:-}" = "--self-test-base" ]; then
  st_fail=0
  sb_ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected $2 got $1"; st_fail=1; fi; }
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }
  g init -q --bare "$tmp/origin.git"
  g clone -q "$tmp/origin.git" "$tmp/root" 2>/dev/null
  g -C "$tmp/root" commit -q --allow-empty -m base && g -C "$tmp/root" push -q origin master
  g clone -q "$tmp/origin.git" "$tmp/other" 2>/dev/null
  g -C "$tmp/other" commit -q --allow-empty -m wave1 && g -C "$tmp/other" push -q origin master
  landed=$(git -C "$tmp/other" rev-parse HEAD)
  out=$(refresh_local_base "$tmp/root" master)
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$landed" "root on master: fast-forwarded to origin/master"
  case "$out" in *"local master fast-forwarded to origin/master."*) sb_ok y y "reports the master fast-forward";; *) sb_ok n y "reports the master fast-forward";; esac
  g -C "$tmp/root" switch -q -c feature/test
  held=$(git -C "$tmp/root" rev-parse HEAD)
  g -C "$tmp/other" commit -q --allow-empty -m wave2 && g -C "$tmp/other" push -q origin master
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
  g -C "$tmp/other" commit -q --allow-empty -m wave3 && g -C "$tmp/other" push -q origin master
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "local-only commit: returns 0"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "local-only commit: HEAD left where it was"
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
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "dirty overlap: returns 0"
  sb_has "$out" "no local-only commits" "dirty overlap, no local commits: says local changes block it"
  # origin/HEAD unset: repo-state cannot name them, so merge-task counts them itself.
  g -C "$tmp/root" checkout -q -- f && g -C "$tmp/root" merge -q --ff-only origin/master
  g -C "$tmp/root" symbolic-ref --delete refs/remotes/origin/HEAD
  g -C "$tmp/root" commit -q --allow-empty -m local-only-2
  g -C "$tmp/other" commit -q --allow-empty -m wave4 && g -C "$tmp/other" push -q origin master
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
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "no-op fast-forward: returns 0"
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
  out=$(refresh_local_base "$tmp/root" master); rc=$?
  sb_ok "$rc" 0 "autoStash + dirty overlap: returns 0"
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
  g -C "$tmp/other" commit -q --allow-empty -m wave5 && g -C "$tmp/other" push -q origin master
  phantom=$(g -C "$tmp/root" commit-tree -p HEAD -m phantom "$(git -C "$tmp/root" rev-parse 'HEAD^{tree}')")
  out=$(refresh_local_base "$tmp/root" master "$phantom" 2>&1); rc=$?
  sb_ok "$rc" 6 "origin/master lacks the merge: returns 6"
  sb_ok "$(git -C "$tmp/root" rev-parse HEAD)" "$held" "origin/master lacks the merge: HEAD left where it was"
  sb_has "$out" "WARN: local master NOT refreshed: origin/master lacks merge $phantom (twice)" "origin/master lacks the merge: names it"
  case "$out" in *"fast-forwarded"*) sb_ok "[$out]" "no 'fast-forwarded'" "lacks the merge: never says fast-forwarded";; *) sb_ok y y "lacks the merge: never says fast-forwarded";; esac
  echo; [ "$st_fail" -eq 0 ] && echo "base: ALL PASS" || echo "base: SOME FAILED"
  exit "$st_fail"
fi

# Self-test hook: `merge-task.sh --self-test-classify` runs the classifier assertions and exits. Keeps the
# fail-closed heart covered without a live repo (the end-to-end suites drive a fake gh, never live GitHub —
# see the UNSTABLE guard comment below). Must precede the arg-count check; uses ${1:-} for `set -u` safety.
if [ "${1:-}" = "--self-test-classify" ]; then
  st_fail=0
  st() {  # st <expected> <label> ; failed step names on stdin
    local exp="$1" label="$2" got; got="$(classify_failed_steps)"
    if [ "$got" = "$exp" ]; then echo "ok   - $label ($got)"; else echo "FAIL - $label: expected $exp got $got"; st_fail=1; fi
  }
  printf 'Install dependencies\n'           | st infra   "install-deps timeout"
  printf 'Set up Python\n'                   | st infra   "set up python"
  printf 'Checkout\nInstall dependencies\n'  | st infra   "checkout + install"
  printf 'Restore cache\n'                   | st infra   "restore cache"
  printf 'Run tests\n'                       | st genuine "run tests"
  printf 'pytest (fast)\n'                   | st genuine "pytest"
  printf 'Install dependencies\nRun tests\n' | st genuine "mixed install+test => genuine"
  printf 'Lint\n'                            | st genuine "lint"
  printf 'mypy\n'                            | st genuine "mypy"
  printf 'Build wheel\n'                     | st genuine "build"
  printf 'Deploy artifact\n'                 | st genuine "unrecognised step => fail-closed"
  printf '\n'                                | st genuine "no steps => fail-closed"
  echo; [ "$st_fail" -eq 0 ] && echo "classifier: ALL PASS" || echo "classifier: SOME FAILED"
  exit "$st_fail"
fi

# ---- args, environment, sentinel (no gh call precedes the end of this block) ----------------------------
# The EXIT trap and finish come first, so every exit below, the usage ones included, goes through them.
# FINAL_RC is set only by finish, SIG_RC only by a signal trap; SENTINEL, PR and COUNTER only once known.
SENTINEL=''; FINAL_RC=''; SIG_RC=''; PR=''; COUNTER=''; tmp=''
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
[[ $IHEAD =~ $sha_re ]] || finish 2 "ERROR: integrated head '$IHEAD' is not a 40-hex SHA"
[[ $IBASE =~ $sha_re ]] || finish 2 "ERROR: integrated base '$IBASE' is not a 40-hex SHA"
for t in gh git python3; do
  command -v "$t" >/dev/null 2>&1 || finish 2 "ERROR: $t not found on PATH"
done
# Every MERGE_TASK_* override must be a plain non-negative integer of at most 9 digits. Anything else would
# make a bound's `[ -gt ]` error out as false (a non-numeric or overflowing cap never reaches 4: an endless 3)
# or abort an `$((…))` (a leading 0 reads as octal), so it is a 2 before any GitHub call.
int_re='^(0|[1-9][0-9]{0,8})$'
for v in MERGE_TASK_CHECK_INTERVAL MERGE_TASK_STATE_INTERVAL MERGE_TASK_CONFIRM_INTERVAL MERGE_TASK_READ_TRIES \
         MERGE_TASK_READ_INTERVAL MERGE_TASK_HEAD_LAG_INTERVAL MERGE_TASK_REINTEGRATE_MAX; do
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
    finish 2 "ERROR: PR URL $PR_ARG is in $u_slug, but origin is $OWNER/$REPO"
  fi
else
  finish 2 "ERROR: cannot parse a PR number from '$PR_ARG' (a positive number or a https://github.com/<o>/<r>/pull/<N> URL)"
fi
PR=$PR_NUM

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
    [ "$S_STATE" = OPEN ] || return 0          # the caller re-routes MERGED / CLOSED
    [ "$S_HEAD" = "$IHEAD" ] && return 0
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
    echo "  PR #$PR: GitHub's head $S_HEAD lags origin $S_HEADREF = the integrated head; re-reading ($round/$HEAD_LAG_MAX)…"
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
  if [ "$n" -gt "$REINTEGRATE_MAX" ]; then
    bases=$(sort -u "$COUNTER" | tr '\n' ' ' | sed 's/ $//')
    set_aside "base moved before the merge $n times in a row after $REINTEGRATE_MAX re-integrations (bases $bases)"
  fi
  finish 3 "$moved (refusal $n; set aside after the $((REINTEGRATE_MAX + 1))th)"
}
check_base() { read_base; [ "$LIVE" = "$IBASE" ] || record_base_moved "$LIVE"; }

ci_runs_in_flight() {  # success (0) when ≥1 workflow run on the integrated head is not completed
  # "Never appeared" must mean "nothing is coming", not "hasn't appeared yet": a repo whose ONLY
  # required check is an end-of-workflow roll-up job (giflab's `Checks Complete`: `needs:` every other
  # job) doesn't get that check run CREATED until ~the whole suite has run — far longer than the
  # CHECK_RETRY_MAX appear budget (halted 3× in the 2026-07-04 giflab rollout). While this returns
  # true, wait_required_checks treats absent required checks as pending, not missing.
  # Probe WORKFLOW RUNS, not check-suites: installed apps (digitalocean, cursor) leave phantom check
  # suites permanently `queued` with 0 check runs on every commit — a check-suite probe would read
  # "in flight" forever. FAIL-CLOSED throughout: API error or unparseable count return 1, so the caller
  # falls back to the bounded appear budget. The head is the pinned integrated head (already verified).
  local n
  n="$(gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$IHEAD&per_page=100" \
       -q '[.workflow_runs[] | select(.status != "completed")] | length' 2>/dev/null)"
  case "$n" in ''|*[!0-9]*) return 1;; esac
  [ "$n" -gt 0 ]
}

infra_flake_rerun() {  # returns 0 if it re-ran failed jobs (caller should re-wait), 1 to HALT
  # Finding #4: inspect the failed REQUIRED runs' failing STEP names, classify infra vs genuine
  # (fail-closed), and `gh run rerun --failed` only when EVERY failed step is provably setup/infra.
  local links runs run_id steps s verdict reran=0
  # Failed REQUIRED checks only (branch protection's definition) → their run ids via the details link.
  links="$(gh pr checks "$PR" -R "$OWNER/$REPO" --required --json state,link -q '.[] | select(.state=="FAILURE") | .link' 2>/dev/null)"
  [ -z "$links" ] && { echo "  infra-classify: no failed required-check links — genuine (fail-closed)." >&2; return 1; }
  runs="$(printf '%s\n' "$links" | grep -oE 'runs/[0-9]+' | grep -oE '[0-9]+' | sort -u)"
  [ -z "$runs" ] && { echo "  infra-classify: could not parse run ids — genuine (fail-closed)." >&2; return 1; }
  steps=""
  for run_id in $runs; do
    s="$(gh run view "$run_id" -R "$OWNER/$REPO" --json jobs -q '.jobs[] | select(.conclusion=="failure") | .steps[] | select(.conclusion=="failure") | .name' 2>/dev/null)"
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

snapshot_once() { local READ_TRIES=1; pr_snapshot "$1"; }   # one attempt (dynamic scope reaches gh_read)

WAIT_MSG=''
wait_required_checks() {  # 0 green; 8 a transient gh error with no red row (WAIT_MSG); 1 halt (printed)
  local absent=0 out rc infra_reruns=0
  echo "  PR #$PR — waiting on required checks…"
  while : ; do
    gh pr checks "$PR" -R "$OWNER/$REPO" --required --watch --fail-fast --interval "$CHECK_INTERVAL" \
      >"$tmp/checks.out" 2>"$tmp/checks.err"; rc=$?
    [ $rc -eq 0 ] && return 0
    out=$(cat "$tmp/checks.out" "$tmp/checks.err" 2>/dev/null)
    # Required checks ABSENT — either not created YET (late roll-up check; CI still in flight on the
    # head) or genuinely never coming. While anything is running, wait — same trust semantics as
    # --watch on a visible pending check, bounded in practice by GitHub's own job timeouts. The
    # CHECK_RETRY_MAX budget only counts CONSECUTIVE polls where nothing is running anywhere.
    if printf '%s' "$out" | grep -qiE 'no checks reported|no required checks'; then
      # No-CI recompute guard: after a merge advances the base, GitHub recomputes every open PR's
      # mergeability ASYNCHRONOUSLY — the state machine can sample a transient UNKNOWN/BLOCKED
      # and land here even in a repo with NO required checks configured at all (statusCheckRollup
      # empty). Without this re-poll, the loop counted absent polls while the PR quietly turned
      # CLEAN and then halted with "never appeared" — reproduced twice (narcissus-avp PRs #3, #5,
      # 2026-07-18), where an immediate re-run merged the same PR CLEAN first try. Re-poll
      # mergeStateStatus every pass (one read attempt; a failed read counts as "not CLEAN"): CLEAN means
      # branch protection has nothing left to wait for — hand back to the state machine, which re-reads
      # the state and merges. A genuinely red required check never takes this branch (gh pr checks
      # reports the failure, not absence), so BLOCKED semantics are untouched.
      if snapshot_once "$tmp/clean.json" && [ "$S_MSS" = "CLEAN" ]; then
        echo "  PR #$PR — no required checks and mergeStateStatus=CLEAN — nothing to wait for."
        return 0
      fi
      if ci_runs_in_flight; then
        absent=0
        echo "  PR #$PR — required checks not created yet; CI in flight on head — waiting…"
      else
        absent=$((absent+1))
        [ "$absent" -gt "$CHECK_RETRY_MAX" ] && { echo "ERROR: required checks never appeared for PR #$PR — no CI runs in flight on its head SHA, nothing is coming" >&2; return 1; }
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
    printf '%s\n' "$out" | tail -6 >&2
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
  guard=$((guard+1))
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
      echo "  PR #$PR reads BEHIND on an unmoved base — re-polling ($behind/$BEHIND_REPOLL_MAX)…"
      sleep "$STATE_INTERVAL" ;;
    DIRTY)
      check_base
      finish 1 "ERROR: PR #$PR has a MERGE CONFLICT with $BASE (mergeStateStatus=DIRTY) on the integrated base — nothing was merged.
  Do NOT force. Set the task aside; it re-integrates or goes back to its own run." ;;
    BLOCKED|UNKNOWN)
      review_gate
      if [ "$checks_done" -eq 1 ]; then
        finish 1 "ERROR: PR #$PR is $S_MSS but required checks are already green — a NON-check gate is
  blocking it (an unexpected required review or unresolved conversation). Resolve on
  GitHub: $S_URL"
      fi
      wait_required_checks; rc=$?
      case "$rc" in 0) ;; 8) finish 8 "$WAIT_MSG" ;; *) finish 1 ;; esac
      checks_done=1 ;;
    UNSTABLE)
      # Mergeable under branch protection, but a NON-required check is red or still pending.
      # GitHub never reports CLEAN while a non-required check is red — and this repo's main
      # legitimately carries red non-required checks (lint/mypy → baseline-red-ci, perf →
      # perf-tier-calibration, Windows ext-tools → env) that other tasks fix. Gate on REQUIRED
      # checks only — exactly what branch protection enforces — then squash-merge. A genuinely
      # failing REQUIRED check surfaces as BLOCKED, not UNSTABLE, so this never merges a red gate.
      # ⚠️ DO NOT "tidy" this back to CLEAN-only. CLEAN requires EVERY check green (required AND
      # non-required); a repo whose main carries red non-required checks would then merge NO wave of
      # any rollout — the exact failure from the 2026-06-02 giflab run (see giflab-rollout-merge-wave-
      # unstable-fix). Gating on `--required` is branch protection's own definition of mergeable.
      # The fake-gh suites cannot prove GitHub's semantics, so this comment IS the guard.
      if [ "$checks_done" -eq 0 ]; then
        wait_required_checks; rc=$?
        case "$rc" in 0) ;; 8) finish 8 "$WAIT_MSG" ;; *) finish 1 ;; esac
        checks_done=1
      fi
      merge_pr ;;
    CLEAN)
      merge_pr ;;
    *)
      finish 1 "ERROR: PR #$PR unexpected mergeStateStatus='$S_MSS' — nothing was merged." ;;
  esac
done
