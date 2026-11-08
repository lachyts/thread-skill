#!/usr/bin/env bash
# ADR 0073 d4: a required check CANCELLED (a CI timeout: its job hit `timeout-minutes`, no test failed) is a stop on
# GitHub's side. gh 2.43.1's `gh pr checks --required --watch` exits 0 on a CANCELLED required check and prints it as
# `fail` in its table, so merge-task read the wait as green and then the still-BLOCKED PR as "a NON-check gate", a
# human's (PRs #324 and #326, thread-skill-rollout-2026-11-06). merge-task now reads each red required check's
# conclusion: CANCELLED gets one re-run of its failed jobs, then exit 1 with its own cause, which reconcile reads as a
# GitHub-side stop (`MERGE_TASK_INFRA`, the infra retry) under its own reasonClass `ci-timeout`.
# Driven against the shared fake gh (tests/fixtures/merge-task/fake-gh.py): gh 2.43.1's table, then a gh with
# `pr checks --json` (its `cancel` bucket). Hermetic: temp repos, PATH shim, ssh disabled, every interval 0.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
# reads() imports reconcile-rollout.py: run alone (outside tests/run.sh) it must leave no __pycache__ in the tree,
# which the no-bytecode checks read as a failure.
export HOME="$tmp/home" PYTHONDONTWRITEBYTECODE=1; mkdir -p "$HOME"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
chk() {  # chk <rc> <stdout> — append one `pr checks --watch` result
  python3 -c 'import json,sys; print(json.dumps({"rc": int(sys.argv[1]), "out": sys.argv[2], "err": ""}))' "$@" >> "$MT_STATE/checks.seq"
}
row() { printf '%s\t%s\t40m\thttps://github.com/o/r/actions/runs/%s/job/%s\t' "$1" "$2" "$3" "$4"; }
jobs() {  # jobs <run> <job> <conclusion> — what `gh run view <run> --json jobs` reads for that run
  printf '{"jobs": [{"databaseId": %s, "name": "ci", "status": "completed", "conclusion": "%s", "steps": []}]}\n' \
    "$2" "$3" > "$MT_STATE/jobs.$1"
}
CANCELLED="a REQUIRED check was CANCELLED on PR #5"
# reconcile's reading of merge-task's own output, as the lead hands it on (execute § 4.5 step 4, row 1): the stop on
# GitHub's side, its reasonClass and its retry class.
reads() {  # reads <merge-task output> — "<infra stop> <ci timeout>" for the lead's GitHub-side reason
  python3 - "$RR" "$1" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cause = m._merge_task_cause(sys.argv[2])
reason = "merge-task exit 1, GitHub-side: " + cause.replace("\n", " ")
print(m._merge_task_infra_stop(reason), m._merge_task_ci_timeout(reason))
PY
}

# 1. gh 2.43.1: the required check is cancelled (its watch exits 0, the row reads `fail`), re-run once, cancelled
#    again: exit 1 with the cancelled cause, never the NON-check gate, and only the cancelled run is re-run.
fresh; pair; mkpr 5 "$I" BLOCKED
chk 0 "$(printf '%s\n%s' "$(row ci fail 7 8)" "$(row lint pass 3 4)")"
chk 0 "$(printf '%s\n%s' "$(row ci fail 7 8)" "$(row lint pass 3 4)")"
jobs 7 8 cancelled
run 5 "$I" "$B"
ok "$rc" 1 "1. gh 2.43.1: a cancelled required check, cancelled again after its re-run: exits 1"
has "$out" "$CANCELLED" "1. names the cancelled required check as its cause"
has "$out" "ci (run 7)" "1. names the check and its run"
lacks "$out" "NON-check gate" "1. never the NON-check gate"
lacks "$out" "a REQUIRED check FAILED" "1. never a red required check"
ok "$(grep -c '^run rerun 7 --failed' "$MT_STATE/gh.log")" 1 "1. one re-run of the cancelled run's failed jobs"
lacks "$(glog)" "run rerun 3" "1. never the passing check's run"
has "$(glog)" "run view 7 -R o/r --json jobs" "1. reads the job's conclusion"
ok "$(nmerge)" 0 "1. nothing merged"; ok "$(sent)" "failed:1" "1. failed:1"
ok "$(reads "$out")" "True True" "1. reconcile reads the cause as GitHub's stop, a CI timeout"

# 2. gh 2.43.1, UNSTABLE (a red non-required check beside it): cancelled, then its re-run passes: merges.
fresh; pair; mkpr 5 "$I" UNSTABLE
chk 0 "$(row ci fail 7 8)"; chk 0 "$(row ci pass 7 8)"
jobs 7 8 cancelled
run 5 "$I" "$B"
ok "$rc" 0 "2. a cancelled required check whose re-run passes: merges"
ok "$(grep -c '^run rerun 7 --failed' "$MT_STATE/gh.log")" 1 "2. one re-run"; ok "$(nmerge)" 1 "2. merged once"

# 3. a gh with `pr checks --json`: the `cancel` bucket is read directly, no job read and no table read.
fresh; pair; mkpr 5 "$I" BLOCKED; touch "$MT_STATE/checks.json"
chk 0 "$(row ci cancel 7 8)"; chk 0 "$(row ci cancel 7 8)"
run 5 "$I" "$B"
ok "$rc" 1 "3. --json gh: cancelled again after its re-run exits 1"; has "$out" "$CANCELLED" "3. the cancelled cause"
lacks "$out" "NON-check gate" "3. never the NON-check gate"
has "$(glog)" "pr checks 5 -R o/r --required --json name,bucket,link" "3. reads the buckets"
ok "$(grep -cx 'pr checks 5 -R o/r --required' "$MT_STATE/gh.log")" 0 "3. never the table"
lacks "$(glog)" "run view" "3. no job read"
ok "$(grep -c '^run rerun 7 --failed' "$MT_STATE/gh.log")" 1 "3. one re-run"
ok "$(reads "$out")" "True True" "3. reconcile reads it as GitHub's stop, a CI timeout"

# 4. the re-run cannot start: set aside at once with the same cause, no second wait.
fresh; pair; mkpr 5 "$I" BLOCKED
chk 0 "$(row ci fail 7 8)"; jobs 7 8 cancelled; touch "$MT_STATE/rerun.fail"
run 5 "$I" "$B"
ok "$rc" 1 "4. a re-run that cannot start exits 1"; has "$out" "$CANCELLED" "4. the cancelled cause"
has "$out" "its re-run could not start" "4. says the re-run could not start"
ok "$(grep -c -- '--watch' "$MT_STATE/gh.log")" 1 "4. one wait only"
ok "$(reads "$out")" "True True" "4. reconcile reads it as GitHub's stop, a CI timeout"

# 5. fail-closed: a `fail` row on a 0 exit whose job is no cancellation (or whose conclusion is unreadable) is the red
#    path, never a re-run as a timeout.
for c in failure unreadable; do
  fresh; pair; mkpr 5 "$I" BLOCKED
  chk 0 "$(row ci fail 7 8)"
  [ "$c" = failure ] && jobs 7 8 failure
  run 5 "$I" "$B"
  ok "$rc" 1 "5 ($c). a red row that is no proven cancellation exits 1"
  has "$out" "a REQUIRED check FAILED on PR #5" "5 ($c). the red required check's path"
  lacks "$out" "$CANCELLED" "5 ($c). never the cancelled cause"
  lacks "$(glog)" "run rerun" "5 ($c). no re-run"
done

# 6. a green wait reads no conclusion (no extra call), and a real non-check gate still reads as one.
fresh; pair; mkpr 5 "$I" BLOCKED
run 5 "$I" "$B"
ok "$rc" 1 "6. BLOCKED, green checks, no review pending: exits 1"; has "$out" "NON-check gate" "6. the NON-check gate"
lacks "$out" "$CANCELLED" "6. never the cancelled cause"
ok "$(grep -c '^pr checks' "$MT_STATE/gh.log")" 1 "6. one checks call: the green wait reads nothing more"

echo; [ "$fail" -eq 0 ] && echo "merge-task cancelled: ALL PASS" || echo "merge-task cancelled: SOME FAILED"
exit "$fail"
