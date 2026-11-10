#!/usr/bin/env bash
# A job queued with no runner past the limit (a self-hosted runner that no longer exists) is "no runner", not CI in
# flight: GitHub keeps it queued about 24 hours, and merge-task waited that long. Optional, it stops counting; required,
# the task is set aside at once with reason `no-runner` naming the job, exit 4, and the lane is the lead's to free
# (skills/execute/tests/reconcile-rollout-record.test.sh's mg rows: lane-freed, reasonClass no-runner).
# Hermetic on the shared fake gh (tests/fixtures/merge-task/fake-gh.py); a watch slice is 1 s, so each cut costs 1 s.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
export MERGE_TASK_NO_RUNNER_POLL=1

OLD=2026-01-01T00:00:00Z   # past the default 15-minute limit on any run; NEVER below lifts the limit over it
NEVER=999999999
chk() {  # chk <rc> <stdout> <stderr> <sleep> — append one `pr checks --watch` result
  python3 -c 'import json,sys; print(json.dumps({"rc": int(sys.argv[1]), "out": sys.argv[2], "err": sys.argv[3], "sleep": float(sys.argv[4])}))' "$@" >> "$MT_STATE/checks.seq"
}
row() { printf '%s\t%s\t1m\thttps://github.com/o/r/actions/runs/7/job/%s\t' "$1" "$2" "$3"; }
hang() { chk 8 "$(row "$1" pending "$2")" "" 30; }        # the watch a required queued job holds open
green() { chk 0 "$(row "$1" pass "$2")" "" 0; }
absent() { chk 1 "" "no required checks reported on the 'audit-fix/t5' branch" 0; }
job() {  # job <id> <name> <runner_id or null> — one queued job of run 7, created at OLD
  python3 -c 'import json,sys; print(json.dumps({"id": int(sys.argv[1]), "name": sys.argv[2], "status": "queued",
    "runner_id": json.loads(sys.argv[3]), "runner_name": "gone" if sys.argv[3] != "null" else "", "created_at": sys.argv[4]}))' "$@"
}
queued() {  # queued <job json>… — run 7 unfinished on the head, holding exactly those jobs
  python3 -c 'import json,sys; print(json.dumps({"total_count": len(sys.argv)-1, "jobs": [json.loads(a) for a in sys.argv[1:]]}))' "$@" > "$MT_STATE/runjobs.7"
  echo '[{"id": 7, "status": "queued"}]' > "$MT_STATE/runs"
}

# 1. A required job queued past the limit: the watch is cut, the job read, the task set aside in this one run.
fresh; pair; mkpr 5 "$I" BLOCKED
queued "$(job 8 'self-hosted (arm)' null "$OLD")"
hang 'self-hosted (arm)' 8
run 5 "$I" "$B"
ok "$rc" 4 "1. a required job no runner took: exit 4"
ok "$(sent)" "failed:4" "1. failed:4"
ok "$(nmerge)" 0 "1. nothing merged"
has "$out" 'set-aside reason: integration: no-runner: required job "self-hosted (arm)"' "1. the reason names no-runner and the job"
has "$out" "(run 7, job 8)" "1. names the run and the job"
ok "$(grep -c -- '--watch' "$MT_STATE/gh.log")" 1 "1. one watch: no second wait"

# 2. The same job not required, and no required check reported: it stops counting as CI in flight, and an UNSTABLE PR
#    merges at once.
fresh; pair; mkpr 5 "$I" UNSTABLE
queued "$(job 8 'self-hosted (arm)' null "$OLD")"
absent
run 5 "$I" "$B"
ok "$rc" 0 "2. an optional job no runner took: merges"; ok "$(nmerge)" 1 "2. merged once"
lacks "$out" "CI in flight on head — waiting" "2. not read as CI in flight"

# 3. An optional no-runner job beside a required check still pending: the cut finds it not required, the watch goes on.
fresh; pair; mkpr 5 "$I" UNSTABLE
queued "$(job 9 'optional-arm' null "$OLD")"
hang 'ci' 8; green 'ci' 8
run 5 "$I" "$B"
ok "$rc" 0 "3. a required check still pending beside the optional job: waited on, then merges"
ok "$(grep -c -- '--watch' "$MT_STATE/gh.log")" 2 "3. the watch went on after the cut"
lacks "$out" "no-runner" "3. never set aside"

# 4. Not "no runner": a job a runner took, and a job under the limit. Each stays in flight at both reads.
for c in 'assigned|5|' 'under the limit|null|'"$NEVER"; do
  IFS='|' read -r label runner limit <<EOF
$c
EOF
  # 4a. required: the cut does not set it aside, the watch goes on.
  fresh; pair; mkpr 5 "$I" UNSTABLE
  queued "$(job 8 'self-hosted (arm)' "$runner" "$OLD")"
  hang 'self-hosted (arm)' 8; green 'self-hosted (arm)' 8
  MERGE_TASK_NO_RUNNER_LIMIT=$limit run 5 "$I" "$B"
  ok "$rc" 0 "4a ($label). required: waited on, then merges"
  lacks "$out" "no-runner" "4a ($label). never set aside"
  # 4b. no required check reported: the job still reads as CI in flight, so the absent check is waited on.
  fresh; pair; mkpr 5 "$I" UNSTABLE
  queued "$(job 8 'self-hosted (arm)' "$runner" "$OLD")"
  absent; green ci 8
  MERGE_TASK_NO_RUNNER_LIMIT=$limit run 5 "$I" "$B"
  ok "$rc" 0 "4b ($label). in flight, then merges"
  has "$out" "CI in flight on head — waiting" "4b ($label). read as CI in flight"
done

echo; [ "$fail" -eq 0 ] && echo "merge-task no-runner: ALL PASS" || echo "merge-task no-runner: SOME FAILED"
exit "$fail"
