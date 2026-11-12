#!/usr/bin/env bash
# A job queued with no runner past the limit (a self-hosted runner that no longer exists) is "no runner", not CI in
# flight: GitHub keeps it queued about 24 hours, and merge-task waited that long. Optional, it stops counting; required,
# the task is set aside at once with reason `no-runner` naming the job, exit 4, and the lane is the lead's to free
# (skills/execute/tests/reconcile-rollout-record.test.sh's mg rows: lane-freed, reasonClass no-runner). A job on a
# GitHub-hosted image (macos-latest) queues behind GitHub's own cap, never a lost runner: it is never "no runner".
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
job() {  # job <id> <name> <runner_id or null> <created_at> <label> [status] — one job of run 7 (queued by default)
  python3 -c 'import json,sys; a = sys.argv + ["queued"]; print(json.dumps({"id": int(a[1]), "name": a[2], "status": a[6],
    "runner_id": json.loads(a[3]), "runner_name": "gone" if a[3] != "null" else "", "created_at": a[4], "labels": [a[5]]}))' "$@"
}
queued() {  # queued <job json>… — run 7 unfinished on the head, holding those jobs; total_count TOTAL, else their count
  TOTAL=${TOTAL:-$#} python3 -c 'import json,os,sys; print(json.dumps({"total_count": int(os.environ["TOTAL"]),
    "jobs": [json.loads(a) for a in sys.argv[1:]]}))' "$@" > "$MT_STATE/runjobs.7"
  echo '[{"id": 7, "status": "queued"}]' > "$MT_STATE/runs"
}
SH=self-hosted

# 1. A required job queued past the limit: the watch is cut, the job read, the task set aside in this one run. A row
#    whose link names no job is matched by the job's name.
for form in link no-link; do
  r=$(row 'self-hosted (arm)' pending 8); [ "$form" = link ] || r=$(printf 'self-hosted (arm)\tpending\t1m\t\t')
  fresh; pair; mkpr 5 "$I" BLOCKED
  queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)"
  chk 8 "$r" "" 30
  run 5 "$I" "$B"
  ok "$rc" 4 "1 ($form). a required job no runner took: exit 4"
  ok "$(sent)" "failed:4" "1 ($form). failed:4"
  ok "$(nmerge)" 0 "1 ($form). nothing merged"
  has "$out" 'set-aside reason: integration: no-runner: required job "self-hosted (arm)"' "1 ($form). the reason names no-runner and the job"
  has "$out" "(run 7, job 8)" "1 ($form). names the run and the job"
  ok "$(grep -c -- '--watch' "$MT_STATE/gh.log")" 1 "1 ($form). one watch: no second wait"
done

# 2. The same job not required, and no required check reported: it stops counting as CI in flight, and an UNSTABLE PR
#    merges at once.
fresh; pair; mkpr 5 "$I" UNSTABLE
queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)"
absent
run 5 "$I" "$B"
ok "$rc" 0 "2. an optional job no runner took: merges"; ok "$(nmerge)" 1 "2. merged once"
lacks "$out" "CI in flight on head — waiting" "2. not read as CI in flight"

# 3. An optional no-runner job beside a required check still pending: the cut finds it not required, the watch goes on,
#    also when it shares the required check's name (another workflow's job: the row's link names job 8, this one is 9).
for name in optional-arm ci; do
  fresh; pair; mkpr 5 "$I" UNSTABLE
  queued "$(job 9 "$name" null "$OLD" $SH)"
  hang 'ci' 8; green 'ci' 8
  run 5 "$I" "$B"
  ok "$rc" 0 "3 ($name). a required check still pending beside the optional job: waited on, then merges"
  ok "$(grep -c -- '--watch' "$MT_STATE/gh.log")" 2 "3 ($name). the watch went on after the cut"
  lacks "$out" "no-runner" "3 ($name). never set aside"
  has "$out" "waiting on required checks: ci" "3 ($name). the cut names the required check still pending"
done

# 4. Not "no runner": a job a runner took, a job under the limit, and a job on a GitHub-hosted image queued past the
#    limit (this repo's own `make test (macos-latest)` queued 14 minutes behind GitHub's 5-macOS-job cap). Each stays
#    in flight at both reads.
for c in 'assigned|5||self-hosted' 'under the limit|null|'"$NEVER"'|self-hosted' 'GitHub-hosted|null||macos-latest'; do
  IFS='|' read -r label runner limit lab <<EOF
$c
EOF
  # 4a. required: the cut does not set it aside, the watch goes on.
  fresh; pair; mkpr 5 "$I" UNSTABLE
  queued "$(job 8 "build ($lab)" "$runner" "$OLD" "$lab")"
  hang "build ($lab)" 8; green "build ($lab)" 8
  MERGE_TASK_NO_RUNNER_LIMIT=$limit run 5 "$I" "$B"
  ok "$rc" 0 "4a ($label). required: waited on, then merges"; ok "$(nmerge)" 1 "4a ($label). merged once"
  ok "$(grep -c -- '--watch' "$MT_STATE/gh.log")" 2 "4a ($label). the watch went on after the cut"
  lacks "$out" "no-runner" "4a ($label). never set aside"
  # 4b. no required check reported: the job still reads as CI in flight, so the absent check is waited on.
  fresh; pair; mkpr 5 "$I" UNSTABLE
  queued "$(job 8 "build ($lab)" "$runner" "$OLD" "$lab")"
  absent; green ci 8
  MERGE_TASK_NO_RUNNER_LIMIT=$limit run 5 "$I" "$B"
  ok "$rc" 0 "4b ($label). in flight, then merges"
  has "$out" "CI in flight on head — waiting" "4b ($label). read as CI in flight"
done

# 5. A run is held only when every job in it is no-runner: a no-runner job beside a live one, or on a jobs page that
#    lists fewer jobs than its total_count (a live job may be on the next page), leaves the run in flight.
for form in 'beside a live job' 'a partial page'; do
  fresh; pair; mkpr 5 "$I" UNSTABLE
  if [ "$form" = 'a partial page' ]; then
    TOTAL=2 queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)"
  else
    queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)" "$(job 10 build 3 "$OLD" ubuntu-latest in_progress)"
  fi
  absent; green ci 8
  run 5 "$I" "$B"
  ok "$rc" 0 "5 ($form). in flight, then merges"
  has "$out" "CI in flight on head — waiting" "5 ($form). read as CI in flight"
  lacks "$out" "held only by jobs no runner took" "5 ($form). the run is not held"
done

# 6. No required check reported on a BLOCKED PR, its one run held only by a no-runner job (a required roll-up check
#    that `needs:` it is never created): the "never appeared" halt keeps its infra prefix and names the held job on
#    the ERROR line the lead copies as the reason.
fresh; pair; mkpr 5 "$I" BLOCKED
queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)"
absent
run 5 "$I" "$B"
ok "$rc" 1 "6. checks that never appeared, the run held: exit 1"; ok "$(nmerge)" 0 "6. nothing merged"
err=$(printf '%s\n' "$out" | grep '^ERROR:' | tail -1)
has "$err" "ERROR: required checks never appeared for PR #5 — no CI runs in flight on its head SHA, nothing is coming" \
  "6. the never-appeared text, MERGE_TASK_INFRA's"
has "$err" 'held only by jobs no runner took: job "self-hosted (arm)" queued' "6. names the held job"
has "$err" "with no runner (run 7, job 8)" "6. names its run and job"

# 7. A signal mid-wait names the wait it was in (ADR 0033 d4 as amended): the in-flight line lists each unfinished job on
#    the head, a no-runner one marked, and the run's last line is `last wait: <that line>`, the reason the lead copies.
#    No required check is reported on a BLOCKED PR and the absent read is sticky, so the run waits until TERM.
for form in a b; do
  fresh; pair; mkpr 5 "$I" BLOCKED
  queued "$(job 10 build 3 "$OLD" ubuntu-latest in_progress)" "$(job 8 alpine null "$OLD" $SH)"
  absent
  : > "$MT_STATE/gh.log"
  limit=$NEVER; [ "$form" = b ] && limit=900
  MERGE_TASK_NO_RUNNER_LIMIT=$limit PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" 5 "$I" "$B" > "$tmp/7.out" 2>&1 &
  pid=$!
  i=0; while [ "$i" -lt 300 ] && ! grep -q 'waiting on:' "$tmp/7.out" 2>/dev/null; do sleep 0.1; i=$((i+1)); done
  kill -TERM "$pid"; wait "$pid"; rc=$?
  out=$(cat "$tmp/7.out"); last=$(tail -1 "$tmp/7.out")
  ok "$rc" 143 "7$form. SIGTERM mid-wait exits 143"; ok "$(sent)" "failed:143" "7$form. failed:143"
  has "$out" "CI in flight on head — waiting on: " "7$form. the in-flight line names what it waits on"
  has "$out" "build (in_progress)" "7$form. … the live job"
  case "$last" in
    "  last wait: PR #5 — required checks not created yet; CI in flight on head — waiting on:"*) ok y y "7$form. the last line is the wait it was in" ;;
    *) ok "$last" "  last wait: PR #5 — required checks not created yet; CI in flight on head — waiting on: …" "7$form. the last line is the wait it was in" ;;
  esac
  has "$last" "alpine" "7$form. … naming the job it waited on"
  want="alpine (queued)"; [ "$form" = b ] && want="alpine (queued, no runner)"
  has "$last" "$want" "7$form. the job reads $want"
done
lacks "$out" "held only by jobs no runner took" "7b. the live build keeps the run in flight"

echo; [ "$fail" -eq 0 ] && echo "merge-task no-runner: ALL PASS" || echo "merge-task no-runner: SOME FAILED"
exit "$fail"
