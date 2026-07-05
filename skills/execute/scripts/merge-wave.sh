#!/usr/bin/env bash
# merge-wave.sh — deterministically merge ONE wave's approved PRs into a strict-protected main.
#
# Usage:  merge-wave.sh <repoPath> <pr> [<pr> ...]
#   <repoPath>  absolute path to the target repo (origin must be a GitHub remote)
#   <pr>...     PR numbers or URLs, in the wave's recommended merge order
#
# This is the merge half of wave-execute's continuous (auto-merge) mode. The lead session calls it
# once per wave with that wave's `status: review` PRs (which already passed the Ralph verifier AND
# master review). It is the ONLY place wave-execute ever merges — the background engine never merges.
#
# Contract (keep these invariants — see wave-execute/SKILL.md "Don'ts"):
#   * Respects branch protection. Each PR is brought up to date with main (origin/giflab main is
#     `strict: true`) and its REQUIRED checks must go green before it merges.
#   * NEVER uses `--admin` (the account is a repo admin; bypassing protection would merge a red branch
#     and defeat the whole safety rationale). NEVER force-pushes.
#   * HALTS (exit 1) on any real merge conflict or red required check — never forces through. The
#     non-zero exit is the lead session's signal to STOP the rollout and report.
#   * Distinguishes a transient CI infra/setup flake (dependency-install timeout, network, runner
#     provisioning) from a genuine test failure and auto-`gh run rerun --failed`s the former up to
#     INFRA_RERUN_MAX times before halting (finding #4). FAIL-CLOSED: only a provably setup/infra-only
#     failure reruns; a real test failure (or any unrecognised step) still halts immediately.
#   * Treats an ABSENT required check as *pending* (not missing) while any workflow run is in flight on
#     the head SHA — repos whose only required check is an end-of-workflow roll-up job (e.g. giflab's
#     aggregate `Checks Complete` gate) don't even get that check run CREATED until the rest of the
#     suite finishes. "Never appeared" halts only when nothing is running at all — nothing is coming.
#   * Idempotent: already-MERGED PRs are skipped, so a re-run after a partial merge resumes cleanly
#     (this is how a cold-resumed session flushes a half-merged wave).
#   * Writes a result sentinel `<repoPath>/.claude/merge-wave.status` (`ok` / `failed:<code>`) on exit, so a
#     BACKGROUNDED caller reads the TRUE outcome instead of a trailing-command-masked exit code (finding #5).
#
# Why the REST update-branch (not `gh pr update-branch`): the installed gh (2.43.1) predates that
# subcommand (added 2.44.0) — and `gh pr update-branch --help` exits 0 on generic help, so a naive
# script wouldn't even notice it's missing. The REST endpoint is gh-version-robust.
#
# Local-branch cleanup is intentionally left to the daily worktree reaper: `gh pr merge --delete-branch`
# would try to `git branch -d` a branch that is checked out in the task's worktree, which git refuses —
# turning a SUCCESSFUL merge into a non-zero exit (a false halt). So we squash-merge without
# --delete-branch and best-effort delete only the REMOTE ref afterwards.

set -uo pipefail

# ---- tuning ----------------------------------------------------------------
SHA_POLL_MAX=60        # update-branch is async; poll up to 60 * 5s = 5 min for the new head to land
SHA_POLL_INTERVAL=5
CHECK_RETRY_MAX=10     # consecutive "no required checks AND no CI in flight" polls before halting
CHECK_INTERVAL=15      # gh pr checks --watch refresh
STATE_GUARD_MAX=8      # bound the per-PR state machine (BEHIND->checks->CLEAN is ~3 hops)
INFRA_RERUN_MAX=2      # finding #4: transient-infra reruns of a failed required job before halting

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

# Self-test hook: `merge-wave.sh --self-test-classify` runs the classifier assertions and exits. Keeps the
# fail-closed heart covered without a live repo (this script otherwise has no unit test — see the UNSTABLE
# guard comment below). Must precede the arg-count check; uses ${1:-} for `set -u` safety.
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

# ---- args ------------------------------------------------------------------
if [ "$#" -lt 2 ]; then
  echo "usage: merge-wave.sh <repoPath> <pr> [<pr> ...]" >&2
  exit 2
fi
REPO_PATH="$1"; shift
PRS=("$@")

command -v gh >/dev/null 2>&1 || { echo "ERROR: gh not found on PATH" >&2; exit 2; }
git -C "$REPO_PATH" rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: $REPO_PATH is not a git repo" >&2; exit 2; }

# ---- result sentinel (finding #5) ------------------------------------------
# A backgrounded `merge-wave.sh … & wait; echo done` wrapper reports the trailing command's exit, not the
# script's — masking a real halt as success (the documented background-exit-masking gotcha). Write an
# unambiguous status file the caller reads instead of trusting a possibly-masked exit code: `ok` ONLY on a
# clean exit 0, `failed:<code>` on any non-zero (including a trap/abort). Cleared at start so a stale file
# from a prior run can never read as success.
SENTINEL="$REPO_PATH/.claude/merge-wave.status"
mkdir -p "$REPO_PATH/.claude" 2>/dev/null || true
rm -f "$SENTINEL" 2>/dev/null || true
write_sentinel() {  # EXIT trap — $? MUST be captured first, before any other command overwrites it
  local code=$?
  if [ "$code" -eq 0 ]; then printf 'ok\n' > "$SENTINEL" 2>/dev/null || true
  else printf 'failed:%s\n' "$code" > "$SENTINEL" 2>/dev/null || true; fi
}
trap write_sentinel EXIT

ORIGIN_URL=$(git -C "$REPO_PATH" remote get-url origin 2>/dev/null) || { echo "ERROR: no 'origin' remote in $REPO_PATH" >&2; exit 2; }
SLUG=$(printf '%s' "$ORIGIN_URL" | sed -E 's#^.*github\.com[:/]+##; s#\.git$##')
OWNER="${SLUG%%/*}"; REPO="${SLUG#*/}"
if [ -z "$OWNER" ] || [ -z "$REPO" ] || [ "$OWNER" = "$SLUG" ]; then
  echo "ERROR: could not derive owner/repo from origin url '$ORIGIN_URL'" >&2; exit 2
fi

echo "== merge-wave.sh: $OWNER/$REPO — ${#PRS[@]} PR(s): ${PRS[*]} =="

# ---- per-PR primitives -----------------------------------------------------

prfield() { gh pr view "$1" -R "$OWNER/$REPO" --json "$2" -q ".$2" 2>/dev/null; }

ci_runs_in_flight() {  # $1=PR — success (0) when ≥1 workflow run on the PR's head SHA is not completed
  # "Never appeared" must mean "nothing is coming", not "hasn't appeared yet": a repo whose ONLY
  # required check is an end-of-workflow roll-up job (giflab's `Checks Complete`: `needs:` every other
  # job) doesn't get that check run CREATED until ~the whole suite has run — far longer than the
  # CHECK_RETRY_MAX appear budget (halted 3× in the 2026-07-04 giflab rollout). While this returns
  # true, wait_required_checks treats absent required checks as pending, not missing.
  # Probe WORKFLOW RUNS, not check-suites: installed apps (digitalocean, cursor) leave phantom check
  # suites permanently `queued` with 0 check runs on every commit — a check-suite probe would read
  # "in flight" forever. FAIL-CLOSED throughout: empty SHA (an empty head_sha= param is IGNORED by the
  # API and returns the repo's entire run list — a false in-flight), API error, or unparseable count
  # all return 1, so the caller falls back to the bounded appear budget exactly as before this fix.
  local PR="$1" sha n
  sha="$(prfield "$PR" headRefOid)"
  [ -z "$sha" ] && return 1
  n="$(gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$sha&per_page=100" \
       -q '[.workflow_runs[] | select(.status != "completed")] | length' 2>/dev/null)"
  case "$n" in ''|*[!0-9]*) return 1;; esac
  [ "$n" -gt 0 ]
}

update_branch() {  # $1=PR  $2=pre-update head SHA
  local PR="$1" PRE="$2" out rc i now
  echo "  PR #$PR is BEHIND main — updating branch (REST update-branch)…"
  out=$(gh api --method PUT "repos/$OWNER/$REPO/pulls/$PR/update-branch" -H "Accept: application/vnd.github+json" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then
    if printf '%s' "$out" | grep -qiE 'conflict|not mergeable'; then
      echo "ERROR: PR #$PR cannot update — MERGE CONFLICT with main." >&2
      echo "  The wave's file-overlap analysis was too coarse, or a hub file changed under it." >&2
      echo "  Next: rebase the branch onto origin/main in its worktree and resolve, OR pull this task" >&2
      echo "        out of the wave and re-plan. Do NOT force. Re-run merge-wave.sh after fixing." >&2
    else
      echo "ERROR: PR #$PR update-branch failed: $out" >&2
    fi
    return 1
  fi
  # Wait for the merge-from-main commit to actually land (head SHA changes). Gating on the SHA — not a
  # bare `gh pr checks --watch` — is what stops us latching onto STALE-GREEN pre-update checks and
  # merging a branch whose post-update checks haven't even been created yet.
  i=0
  while : ; do
    i=$((i+1)); [ "$i" -gt "$SHA_POLL_MAX" ] && { echo "ERROR: PR #$PR head SHA did not advance after update-branch" >&2; return 1; }
    sleep "$SHA_POLL_INTERVAL"
    now=$(prfield "$PR" headRefOid)
    [ -n "$now" ] && [ "$now" != "$PRE" ] && break
  done
}

infra_flake_rerun() {  # $1=PR — returns 0 if it re-ran failed jobs (caller should re-wait), 1 to HALT
  # Finding #4: inspect the failed REQUIRED runs' failing STEP names, classify infra vs genuine
  # (fail-closed), and `gh run rerun --failed` only when EVERY failed step is provably setup/infra.
  local PR="$1" sha links runs run_id steps s verdict reran=0
  sha="$(prfield "$PR" headRefOid)"
  [ -z "$sha" ] && { echo "  infra-classify: no head SHA for PR #$PR — genuine (fail-closed)." >&2; return 1; }
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

wait_required_checks() {  # $1=PR
  local PR="$1" absent=0 out rc infra_reruns=0
  echo "  PR #$PR — waiting on required checks…"
  while : ; do
    out=$(gh pr checks "$PR" -R "$OWNER/$REPO" --required --watch --fail-fast --interval "$CHECK_INTERVAL" 2>&1); rc=$?
    [ $rc -eq 0 ] && return 0
    # Required checks ABSENT — either not created YET (late roll-up check; CI still in flight on the
    # head) or genuinely never coming. While anything is running, wait — same trust semantics as
    # --watch on a visible pending check, bounded in practice by GitHub's own job timeouts. The
    # CHECK_RETRY_MAX budget only counts CONSECUTIVE polls where nothing is running anywhere.
    if printf '%s' "$out" | grep -qiE 'no checks reported|no required checks'; then
      if ci_runs_in_flight "$PR"; then
        absent=0
        echo "  PR #$PR — required checks not created yet; CI in flight on head — waiting…"
      else
        absent=$((absent+1))
        [ "$absent" -gt "$CHECK_RETRY_MAX" ] && { echo "ERROR: required checks never appeared for PR #$PR — no CI runs in flight on its head SHA, nothing is coming" >&2; return 1; }
      fi
      sleep "$CHECK_INTERVAL"; continue
    fi
    echo "ERROR: a REQUIRED check FAILED on PR #$PR (Ralph passed locally, but remote CI is red):" >&2
    printf '%s\n' "$out" | tail -6 >&2
    # Finding #4: tell a transient infra/setup flake from a genuine test failure; auto-rerun the former a
    # bounded number of times before halting. infra_flake_rerun is FAIL-CLOSED — a genuine failure halts.
    if [ "$infra_reruns" -lt "$INFRA_RERUN_MAX" ] && infra_flake_rerun "$PR"; then
      infra_reruns=$((infra_reruns+1))
      echo "  infra rerun $infra_reruns/$INFRA_RERUN_MAX triggered — re-watching required checks…" >&2
      sleep "$CHECK_INTERVAL"
      continue
    fi
    echo "  Diagnose: gh pr checks $PR -R $OWNER/$REPO — push a fix to the branch, then re-run merge-wave.sh." >&2
    return 1
  done
}

merge_pr() {  # $1=PR
  local PR="$1" br st2
  br=$(prfield "$PR" headRefName)
  echo "  PR #$PR is CLEAN — squash-merging…"
  if ! gh pr merge "$PR" -R "$OWNER/$REPO" --squash; then
    st2=$(prfield "$PR" state)
    [ "$st2" = "MERGED" ] || { echo "ERROR: gh pr merge failed for PR #$PR (state=$st2)" >&2; return 1; }
  fi
  echo "  PR #$PR merged (squash)."
  # Best-effort REMOTE branch cleanup (non-fatal). Local branch + worktree are the reaper's job.
  if [ -n "$br" ] && [ "$br" != "main" ] && [ "$br" != "master" ]; then
    if gh api --method DELETE "repos/$OWNER/$REPO/git/refs/heads/$br" >/dev/null 2>&1; then
      echo "  remote branch '$br' deleted."
    else
      echo "  (remote branch '$br' left for the reaper.)"
    fi
  fi
}

process_pr() {  # $1=PR — run the state machine until merged or halt
  local PR="$1" checks_done=0 guard=0 mss headoid
  while : ; do
    guard=$((guard+1)); [ "$guard" -gt "$STATE_GUARD_MAX" ] && { echo "ERROR: PR #$PR did not converge to a mergeable state" >&2; return 1; }
    mss=$(prfield "$PR" mergeStateStatus)
    case "$mss" in
      DIRTY)
        echo "ERROR: PR #$PR has a MERGE CONFLICT with main (mergeStateStatus=DIRTY)." >&2
        echo "  Resolve in the worktree (rebase onto origin/main) or pull this task from the wave." >&2
        echo "  Do NOT force. Re-run merge-wave.sh after fixing." >&2
        return 1 ;;
      BEHIND)
        headoid=$(prfield "$PR" headRefOid)
        update_branch "$PR" "$headoid" || return 1
        checks_done=0 ;;   # head moved — the prior green checks no longer count
      BLOCKED|UNKNOWN)
        if [ "$checks_done" -eq 1 ]; then
          echo "ERROR: PR #$PR is $mss but required checks are already green — a NON-check gate is" >&2
          echo "  blocking it (an unexpected required review or unresolved conversation). Resolve on" >&2
          echo "  GitHub: $(prfield "$PR" url)" >&2
          return 1
        fi
        wait_required_checks "$PR" || return 1
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
        # There is no unit test for this live-GitHub script, so this comment IS the guard.
        if [ "$checks_done" -eq 0 ]; then
          wait_required_checks "$PR" || return 1
          checks_done=1
        fi
        merge_pr "$PR" || return 1
        return 0 ;;
      CLEAN)
        merge_pr "$PR" || return 1
        return 0 ;;
      ""|null)
        echo "ERROR: PR #$PR — could not read mergeStateStatus (network or auth?)" >&2; return 1 ;;
      *)
        echo "ERROR: PR #$PR unexpected mergeStateStatus='$mss'" >&2; return 1 ;;
    esac
  done
}

# ---- merge each PR in order (serial: each merge advances main, flipping the next to BEHIND) -------
for raw in "${PRS[@]}"; do
  PR=$(printf '%s' "$raw" | grep -oE '[0-9]+' | tail -1)
  [ -z "${PR:-}" ] && { echo "ERROR: cannot parse a PR number from '$raw'" >&2; exit 1; }
  st=$(prfield "$PR" state) || { echo "ERROR: cannot read PR #$PR in $OWNER/$REPO" >&2; exit 1; }
  case "$st" in
    MERGED) echo "PR #$PR already merged — skipping."; continue ;;
    OPEN) ;;
    *) echo "ERROR: PR #$PR is '$st' (not OPEN/MERGED) — refusing to merge. Resolve manually." >&2; exit 1 ;;
  esac
  echo "== PR #$PR =="
  process_pr "$PR" || exit 1
done

# ---- advance the local root checkout's main (cosmetic; correctness rides on origin/main) ----------
# The wave is ALREADY landed on origin/main by here, and the next wave's worktrees branch from a
# freshly-fetched origin/main — so a stale LOCAL main is not a safety issue. Keep it tidy when easy,
# but NEVER fail the script for it (that would be a false halt after a successful merge).
echo "== all wave PRs merged — refreshing local main =="
git -C "$REPO_PATH" fetch origin main >/dev/null 2>&1 || echo "  WARN: git fetch origin main failed (non-fatal)."
cur_branch=$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$cur_branch" = "main" ]; then
  if git -C "$REPO_PATH" merge --ff-only origin/main >/dev/null 2>&1; then
    echo "  local main fast-forwarded to origin/main."
  else
    echo "  WARN: local main did not fast-forward (root checkout diverged). origin/main holds the merges;"
    echo "        next wave's worktrees branch from origin/main regardless. Tidy the root when convenient."
  fi
else
  echo "  NOTE: root checkout is on '$cur_branch', not main — skipped local fast-forward (harmless)."
fi
echo "== merge-wave.sh: wave complete. =="
