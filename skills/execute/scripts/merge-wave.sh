#!/usr/bin/env bash
# merge-wave.sh — deterministically merge ONE wave's approved PRs into the repository's protected target branch.
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
#   * Respects branch protection. Each PR targets the expected base; required checks and GitHub protection still apply.
#     A branch update invalidates head approval and stops for reapproval before merging.
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
#     suite finishes. "Never appeared" halts only when nothing is running at all — nothing is coming —
#     AND the PR has not turned CLEAN/UNSTABLE: after each merge advances main, GitHub recomputes mergeability
#     asynchronously, so in a repo with NO CI configured the next PR transiently reads UNKNOWN/BLOCKED
#     and lands in the wait path with no checks ever coming. The wait loop re-polls mergeStateStatus
#     each pass and returns as soon as protection permits it (narcissus-avp 2026-07-18 false-halt fix).
#   * Idempotent: already-MERGED PRs with matching head/base and merge-commit evidence are skipped, so a re-run after a partial merge resumes cleanly
#     (this is how a cold-resumed session flushes a half-merged wave).
#   * Writes a result sentinel `<repoPath>/.claude/merge-wave.status` (`ok` / `pending:3` / `failed:<code>`) on exit, so a
#     BACKGROUNDED caller reads the TRUE outcome instead of a trailing-command-masked exit code (finding #5).
#
# Why the REST update-branch (not `gh pr update-branch`): the installed gh (2.43.1) predates that
# subcommand (added 2.44.0) — and `gh pr update-branch --help` exits 0 on generic help, so a naive
# script wouldn't even notice it's missing. The REST endpoint is gh-version-robust.
#
# Branch cleanup is intentionally left to the daily worktree reaper: `gh pr merge --delete-branch`
# would try to `git branch -d` a branch that is checked out in the task's worktree, which git refuses —
# turning a SUCCESSFUL merge into a non-zero exit (a false halt). So we squash-merge without
# --delete-branch. Remote refs are also left to the reaper to avoid deleting a newly advanced head.

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
# fail-closed heart covered without a live repo (offline CLI regression coverage lives in ../tests/merge-wave.test.sh). Must precede the arg-count check; uses ${1:-} for `set -u` safety.
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

# ---- arguments and durable result contract ---------------------------------
# Legacy: merge-wave.sh <repoPath> <pr> [<pr> ...]
# Reviewed callers: add --expected-base <branch> and repeat --expected-head <pr>=<40-char-sha>.
# A bare --expected-head <sha> is accepted only for a single PR. Without an explicit head, v3
# captures every PR's current head before doing any checks or mutations. Every merge binds that
# head with --match-head-commit. A changed head (including update-branch) requires reapproval.
# --json writes exactly one JSON result to stdout; progress goes to stderr. The same result is
# always saved to .claude/merge-wave.result.json. Exit 0 = all verified merged; 3 = queued/pending
# (STOP this serial wave and resume later); 1 = blocked; 2 = invalid input/environment. The legacy
# sentinel remains ok / failed:<code>, with pending:3 added for an accepted but unmerged request.
if [ "$#" -lt 1 ]; then
  echo "usage: merge-wave.sh <repoPath> [--expected-base BRANCH] [--expected-head PR=SHA] [--json] <pr> ..." >&2
  exit 2
fi
REPO_PATH="$1"; shift
PRS=(); HEAD_ARGS=(); REVIEWED_HEADS=(); JSON_MODE=0; BASE=""; SLUG=""; REASON=""
# Select the output channel before validation so invalid retries replace stale success evidence.
for token in "$@"; do [ "$token" != '--json' ] || JSON_MODE=1; done
command -v python3 >/dev/null 2>&1 || { echo 'ERROR: python3 not found on PATH' >&2; exit 2; }
case "$REPO_PATH" in /*) ;; *) echo 'ERROR: repoPath must be absolute' >&2; exit 2;; esac
git -C "$REPO_PATH" rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: $REPO_PATH is not a git repo" >&2; exit 2; }

# JSON is handled by Python's standard library; no jq executable or shell evaluation is needed.
json_tool() {
  python3 - "$@" <<'PYJSON'
import json, os, pathlib, re, sys
mode, *a = sys.argv[1:]
def fail(message):
    print('ERROR: '+message, file=sys.stderr)
    sys.exit(1)
def pr_number(raw, slug):
    if re.fullmatch(r'[1-9][0-9]*', raw): return raw
    match = re.fullmatch(r'https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([1-9][0-9]*)/?', raw, re.I)
    if not match or match[1].lower() != slug.lower():
        fail('PR must be a number or a pull URL in '+slug+': '+raw)
    return match[2]
def write(path, value):
    path=pathlib.Path(path)
    tmp=path.with_name(path.name+'.'+str(os.getpid())+'.tmp')
    tmp.write_text(json.dumps(value, indent=2)+'\n')
    tmp.replace(path)
try:
    if mode == 'origin':
        match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?', a[0], re.I)
        if not match: fail('origin must be a GitHub repository URL')
        print(match[1])
    elif mode == 'pr': print(pr_number(*a))
    elif mode == 'sha':
        if not re.fullmatch(r'[0-9a-fA-F]{40}', a[0]): fail('expected head must be a full 40-character commit SHA')
        print(a[0].lower())
    elif mode == 'snapshot':
        raw, slug, number = a
        data=json.loads(raw)
        if str(data.get('number')) != number or pr_number(data.get('url',''),slug) != number:
            fail('PR response identity does not match the requested repository and number')
        state=data['state']; head=data['headRefOid']; base=data['baseRefName']; mss=data['mergeStateStatus']
        if state not in ('OPEN','CLOSED','MERGED') or not re.fullmatch(r'[0-9a-f]{40}', head): fail('invalid PR state/head evidence')
        if not isinstance(base,str) or not base or any(c in base for c in '\r\n\t'): fail('invalid PR base evidence')
        if not isinstance(mss,str) or any(c in mss for c in '\r\n\t'): fail('invalid merge-state evidence')
        commit=(data.get('mergeCommit') or {}).get('oid') or '-'
        if commit != '-' and not re.fullmatch(r'[0-9a-f]{40}',commit): fail('invalid merge commit evidence')
        print('\t'.join((state,mss or 'UNKNOWN',head,base,commit,data['url'])))
    elif mode == 'init': write(a[0], {'schemaVersion':1,'outcome':'blocked','repository':'','base':'','results':[]})
    elif mode == 'meta':
        data=json.loads(pathlib.Path(a[0]).read_text()); data.update(repository=a[1],base=a[2]); write(a[0],data)
    elif mode == 'record':
        path,number,outcome,reviewed,reason,raw=a
        data=json.loads(pathlib.Path(path).read_text()); snap=json.loads(raw)
        data['results'].append({'pr':int(number),'outcome':outcome,'state':snap.get('state'),
            'repository':data['repository'],'base':snap.get('baseRefName'),'expectedBase':data['base'],
            'url':snap.get('url'),'reviewedHead':reviewed,'head':snap.get('headRefOid'),
            'mergeStateStatus':snap.get('mergeStateStatus'),
            'mergeCommit':(snap.get('mergeCommit') or {}).get('oid'),'reason':reason})
        write(path,data)
    elif mode == 'finish':
        path,code,reason=a; code=int(code)
        data=json.loads(pathlib.Path(path).read_text())
        data.update(outcome='merged' if code == 0 else 'pending' if code == 3 else 'blocked', exitCode=code, reason=reason)
        write(path,data)
except (ValueError, KeyError, TypeError, AttributeError, OSError) as exc:
    fail('invalid or unavailable merge evidence: '+str(exc))
PYJSON
}

SENTINEL="$REPO_PATH/.claude/merge-wave.status"
RESULT="$REPO_PATH/.claude/merge-wave.result.json"
mkdir -p "$REPO_PATH/.claude" || exit 2
rm -f "$SENTINEL" || exit 2
json_tool init "$RESULT" || exit 2
# Keep a dedicated stdout only for the opt-in machine response.
exec 3>&1
[ "$JSON_MODE" -eq 0 ] || exec 1>&2
write_sentinel() {
  local code=$?
  trap - EXIT
  if ! json_tool finish "$RESULT" "$code" "$REASON"; then code=1; fi
  case "$code" in
    0) printf 'ok\n' > "$SENTINEL" || code=1 ;;
    3) printf 'pending:3\n' > "$SENTINEL" || code=1 ;;
    *) printf 'failed:%s\n' "$code" > "$SENTINEL" || true ;;
  esac
  [ "$JSON_MODE" -eq 0 ] || cat "$RESULT" >&3
  exit "$code"
}
trap write_sentinel EXIT
trap 'REASON="interrupted"; exit 130' INT
trap 'REASON="terminated"; exit 143' TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) JSON_MODE=1; shift ;;
    --expected-base)
      [ "$#" -ge 2 ] && [ -n "${2:-}" ] && [ -z "$BASE" ] || { REASON='--expected-base requires one nonempty branch'; echo "ERROR: $REASON" >&2; exit 2; }
      BASE="$2"; shift 2 ;;
    --expected-head)
      [ "$#" -ge 2 ] || { REASON='--expected-head requires PR=SHA'; echo "ERROR: $REASON" >&2; exit 2; }
      HEAD_ARGS+=("$2"); shift 2 ;;
    --*) REASON="unknown option $1"; echo "ERROR: $REASON" >&2; exit 2 ;;
    *) PRS+=("$1"); shift ;;
  esac
done
[ "${#PRS[@]}" -gt 0 ] || { REASON='at least one PR is required'; echo "ERROR: $REASON" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || { REASON='gh not found on PATH'; echo "ERROR: $REASON" >&2; exit 2; }

ORIGIN_URL=$(git -C "$REPO_PATH" remote get-url origin 2>/dev/null) || { REASON='no origin remote'; exit 2; }
SLUG=$(json_tool origin "$ORIGIN_URL") || { REASON='invalid origin repository'; exit 2; }
OWNER="${SLUG%%/*}"; REPO="${SLUG#*/}"
json_tool meta "$RESULT" "$SLUG" "$BASE" || exit 1
# Validate the ENTIRE request before the first mutation, including later PRs and approval bindings.
for ((i=0; i<${#PRS[@]}; i++)); do
  PRS[$i]=$(json_tool pr "${PRS[$i]}" "$SLUG") || { REASON='invalid PR identity'; exit 2; }
  for ((j=0; j<i; j++)); do
    [ "${PRS[$j]}" != "${PRS[$i]}" ] || { REASON='duplicate PR input'; echo "ERROR: $REASON" >&2; exit 2; }
  done
  REVIEWED_HEADS[$i]=""
done
for ((binding_index=0; binding_index<${#HEAD_ARGS[@]}; binding_index++)); do
  binding="${HEAD_ARGS[$binding_index]}"
  case "$binding" in
    *=*) number="${binding%%=*}"; sha="${binding#*=}" ;;
    *) [ "${#PRS[@]}" -eq 1 ] || { REASON='bare expected head needs exactly one PR'; exit 2; }
       number="${PRS[0]}"; sha="$binding" ;;
  esac
  number=$(json_tool pr "$number" "$SLUG") || { REASON='invalid expected-head PR'; exit 2; }
  sha=$(json_tool sha "$sha") || { REASON='invalid expected-head SHA'; exit 2; }
  found=0
  for ((i=0; i<${#PRS[@]}; i++)); do
    if [ "${PRS[$i]}" = "$number" ]; then
      [ -z "${REVIEWED_HEADS[$i]}" ] || { REASON='duplicate expected head'; exit 2; }
      REVIEWED_HEADS[$i]="$sha"; found=1
    fi
  done
  [ "$found" -eq 1 ] || { REASON='expected head does not name a requested PR'; exit 2; }
done
if [ -z "$BASE" ]; then
  BASE=$(gh repo view "$SLUG" --json defaultBranchRef -q '.defaultBranchRef.name') || { REASON='could not resolve default branch'; exit 1; }
fi
[ -n "$BASE" ] && [ "$BASE" != 'null' ] && git check-ref-format --branch "$BASE" >/dev/null 2>&1 || { REASON='invalid target base branch'; exit 2; }
json_tool meta "$RESULT" "$SLUG" "$BASE" || exit 1
echo "== merge-wave.sh: $SLUG → $BASE — ${#PRS[@]} PR(s): ${PRS[*]} =="

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
  echo "  PR #$PR is BEHIND $BASE — updating branch (REST update-branch)…"
  out=$(gh api --method PUT "repos/$OWNER/$REPO/pulls/$PR/update-branch" -H "Accept: application/vnd.github+json" -f "expected_head_sha=$PRE" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then
    if printf '%s' "$out" | grep -qiE 'conflict|not mergeable'; then
      echo "ERROR: PR #$PR cannot update — MERGE CONFLICT with $BASE." >&2
      echo "  The wave's file-overlap analysis was too coarse, or a hub file changed under it." >&2
      echo "  Next: rebase the branch onto origin/$BASE in its worktree and resolve, OR pull this task" >&2
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
  local PR="$1" absent=0 out rc infra_reruns=0 mss_now
  echo "  PR #$PR — waiting on required checks…"
  while : ; do
    out=$(gh pr checks "$PR" -R "$OWNER/$REPO" --required --watch --fail-fast --interval "$CHECK_INTERVAL" 2>&1); rc=$?
    [ $rc -eq 0 ] && return 0
    # Required checks ABSENT — either not created YET (late roll-up check; CI still in flight on the
    # head) or genuinely never coming. While anything is running, wait — same trust semantics as
    # --watch on a visible pending check, bounded in practice by GitHub's own job timeouts. The
    # CHECK_RETRY_MAX budget only counts CONSECUTIVE polls where nothing is running anywhere.
    if printf '%s' "$out" | grep -qiE 'no checks reported|no required checks'; then
      # No-CI recompute guard: after the PREVIOUS merge advances main, GitHub recomputes every open
      # PR's mergeability ASYNCHRONOUSLY — the state machine can sample a transient UNKNOWN/BLOCKED
      # and land here even in a repo with NO required checks configured at all (statusCheckRollup
      # empty). Without this re-poll, the loop counted absent polls while the PR quietly turned
      # CLEAN and then halted with "never appeared" — reproduced twice (narcissus-avp PRs #3, #5,
      # 2026-07-18), where an immediate re-run merged the same PR CLEAN first try. Re-poll
      # mergeStateStatus every pass: CLEAN means branch protection has nothing left to wait for —
      # hand back to the state machine, which re-reads the state and merges. A genuinely red
      # required check never takes this branch (gh pr checks reports the failure, not absence), so
      # BLOCKED semantics are untouched.
      mss_now=$(prfield "$PR" mergeStateStatus)
      if [ "$mss_now" = "CLEAN" ] || [ "$mss_now" = "UNSTABLE" ]; then
        echo "  PR #$PR — no required checks and mergeStateStatus=$mss_now — nothing to wait for."
        return 0
      fi
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

# Read identity, state, base and head together rather than joining separate API observations.
load_snapshot() {
  local fields
  CURRENT_JSON='{}'
  CURRENT_JSON=$(gh pr view "$PR" -R "$SLUG" --json number,url,state,baseRefName,headRefOid,mergeStateStatus,mergeCommit 2>/dev/null) || {
    CURRENT_JSON='{}'; REASON='could not read PR evidence'; return 1;
  }
  fields=$(json_tool snapshot "$CURRENT_JSON" "$SLUG" "$PR") || { CURRENT_JSON='{}'; REASON='invalid PR identity or evidence'; return 1; }
  IFS=$'\t' read -r STATE MSS HEAD ACTUAL_BASE MERGE_COMMIT PR_URL <<< "$fields"
}

assert_binding() {
  [ "$ACTUAL_BASE" = "$BASE" ] || { REASON="base changed or differs from approved base $BASE"; return 1; }
  [ "$HEAD" = "$EXPECTED_HEAD" ] || { REASON='head changed; reapproval required'; return 1; }
  case "$STATE" in OPEN|MERGED) ;; *) REASON="PR is $STATE, not OPEN/MERGED"; return 1;; esac
}

verify_merged() {
  [ "$STATE" = 'MERGED' ] && [ "$MERGE_COMMIT" != '-' ] || { REASON='MERGED state and merge commit evidence are required'; return 1; }
  REASON='verified merged with matching reviewed head'
  echo "  PR #$PR merged at $MERGE_COMMIT (reviewed head $EXPECTED_HEAD)."
}

merge_pr() {
  local rc
  # Re-read immediately before mutation; --match-head-commit closes the head-update race at GitHub.
  load_snapshot && assert_binding || return 1
  if [ "$STATE" = 'MERGED' ]; then verify_merged; return $?; fi
  echo "  PR #$PR — requesting squash merge of reviewed head ${EXPECTED_HEAD}…"
  gh pr merge "$PR" -R "$SLUG" --squash --match-head-commit "$EXPECTED_HEAD"
  rc=$?
  # A zero CLI exit can mean queued/auto-merge enabled. Only observable MERGED counts as complete.
  load_snapshot && assert_binding || return 1
  if [ "$STATE" = 'MERGED' ]; then verify_merged; return $?; fi
  if [ "$rc" -eq 0 ] && [ "$STATE" = 'OPEN' ]; then
    REASON='merge request accepted but PR remains OPEN; queued or pending'
    echo "  PR #$PR — $REASON."
    return 3
  fi
  REASON="merge request failed (exit $rc, state $STATE)"
  return 1
  # Branch deletion belongs to the reaper, including after a verified merge. A branch can advance
  # again while GitHub processes the request; deleting its ref here could remove newer work.
}

process_pr() {
  local checks_done=0 guard=0
  while : ; do
    guard=$((guard+1))
    [ "$guard" -le "$STATE_GUARD_MAX" ] || { REASON='PR did not converge to a mergeable state'; return 1; }
    load_snapshot && assert_binding || return 1
    if [ "$STATE" = 'MERGED' ]; then verify_merged; return $?; fi
    case "$MSS" in
      DIRTY)
        REASON="merge conflict with $BASE; resolve and reapprove the changed head"
        return 1 ;;
      BEHIND)
        update_branch "$PR" "$EXPECTED_HEAD" || { REASON='branch update failed or did not become observable'; return 1; }
        # Updating a branch creates a different commit: green checks do not replace head approval.
        load_snapshot || return 1
        REASON='branch updated; changed head requires reapproval'
        return 1 ;;
      BLOCKED|UNKNOWN)
        if [ "$checks_done" -eq 1 ]; then
          REASON="PR is $MSS after required checks; a non-check gate or mergeability computation remains"
          return 1
        fi
        wait_required_checks "$PR" || { REASON='required checks failed or unavailable'; return 1; }
        checks_done=1 ;;
      UNSTABLE)
        # Optional red checks do not become requirements. GitHub still enforces branch protection.
        if [ "$checks_done" -eq 0 ]; then
          wait_required_checks "$PR" || { REASON='required checks failed or unavailable'; return 1; }
          checks_done=1
        fi
        merge_pr; return $? ;;
      CLEAN) merge_pr; return $? ;;
      *) REASON="unexpected mergeStateStatus: $MSS"; return 1 ;;
    esac
  done
}

# Capture all implicit v3 heads up front, and validate all explicit bindings before any mutation.
for ((i=0; i<${#PRS[@]}; i++)); do
  PR="${PRS[$i]}"; EXPECTED_HEAD="${REVIEWED_HEADS[$i]}"
  if ! load_snapshot; then
    json_tool record "$RESULT" "$PR" blocked "$EXPECTED_HEAD" "$REASON" "$CURRENT_JSON" || true
    exit 1
  fi
  [ -n "$EXPECTED_HEAD" ] || EXPECTED_HEAD="$HEAD"
  REVIEWED_HEADS[$i]="$EXPECTED_HEAD"
  if ! assert_binding; then
    echo "ERROR: PR #$PR — $REASON" >&2
    json_tool record "$RESULT" "$PR" blocked "$EXPECTED_HEAD" "$REASON" "$CURRENT_JSON" || true
    exit 1
  fi
done

# Serial: a pending request stops the wave just as a block does. Never advance on queue acceptance.
for ((i=0; i<${#PRS[@]}; i++)); do
  PR="${PRS[$i]}"; EXPECTED_HEAD="${REVIEWED_HEADS[$i]}"; REASON=''
  echo "== PR #$PR =="
  process_pr; rc=$?
  case "$rc" in 0) outcome=merged;; 3) outcome=pending;; *) outcome=blocked;; esac
  json_tool record "$RESULT" "$PR" "$outcome" "$EXPECTED_HEAD" "$REASON" "$CURRENT_JSON" || exit 1
  if [ "$rc" -ne 0 ]; then
    echo "PR #$PR: $outcome — $REASON" >&2
    exit "$rc"
  fi
done

# Local checkout refresh is cosmetic and only occurs after every merge has been verified.
echo "== all wave PRs merged — refreshing local $BASE =="
git -C "$REPO_PATH" fetch origin "$BASE" >/dev/null 2>&1 || echo "  WARN: fetch of $BASE failed (non-fatal)."
cur_branch=$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$cur_branch" = "$BASE" ]; then
  git -C "$REPO_PATH" merge --ff-only "origin/$BASE" >/dev/null 2>&1 || echo "  WARN: local $BASE did not fast-forward (non-fatal)."
fi
REASON='all PRs verified merged'
echo '== merge-wave.sh: wave complete. =='
