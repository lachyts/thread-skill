#!/usr/bin/env bash
# A job queued with no runner past the limit (a self-hosted runner that no longer exists) is "no runner", not CI in
# flight: GitHub keeps it queued about 24 hours, and merge-task waited that long. Optional, it stops counting; required,
# the task is set aside at once with reason `no-runner` naming the job, exit 4, and the lane is the lead's to free
# (skills/execute/tests/reconcile-rollout-record.test.sh's mg rows: lane-freed, reasonClass no-runner). A job on a
# GitHub-hosted image (macos-latest) queues behind GitHub's own cap, never a lost runner: it is never "no runner".
# Tests 8-10 (ADR 0080): a no-runner block freed end to end by merge-settings.py and merged on a re-polled BLOCKED; the
# unreported-context probe at the never-appeared and NON-check sites (a renamed job set aside, its wait while CI runs,
# its one re-watch, transient reads as 8), the PR's own rename freed end to end, and today's exit 1 where it cannot tell.
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
# A required roll-up check its CI has yet to create reads BLOCKED: the wait's sample (the third read, after the pre-pass
# and the state machine's) is BLOCKED, so an UNSTABLE entry still reads what is in flight on the head.
unreported() { printf '%s\n' UNSTABLE UNSTABLE BLOCKED UNSTABLE > "$MT_STATE/pr/5/mergeStateStatus.seq"; }

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

# 2. The compression-engine incident's shape (PRs #151/#152): UNSTABLE, the same job not required, no required check
#    reported. The wait's UNSTABLE sample comes before any in-flight read, so it merges at once. That the held run
#    stops counting as CI in flight is tests 5 and 6's.
fresh; pair; mkpr 5 "$I" UNSTABLE
queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)"
absent
run 5 "$I" "$B"
ok "$rc" 0 "2. an optional job no runner took: merges"; ok "$(nmerge)" 1 "2. merged once"
lacks "$out" "CI in flight on head — waiting" "2. not read as CI in flight"
lacks "$(glog)" "actions/runs" "2. no in-flight read"

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
  # 4b. no required check reported, one not created yet: the job still reads as CI in flight, so it is waited on.
  fresh; pair; mkpr 5 "$I" UNSTABLE; unreported
  queued "$(job 8 "build ($lab)" "$runner" "$OLD" "$lab")"
  absent; green ci 8
  MERGE_TASK_NO_RUNNER_LIMIT=$limit run 5 "$I" "$B"
  ok "$rc" 0 "4b ($label). in flight, then merges"
  has "$out" "CI in flight on head — waiting" "4b ($label). read as CI in flight"
done

# 5. A run is held only when every job in it is no-runner: a no-runner job beside a live one, or on a jobs page that
#    lists fewer jobs than its total_count (a live job may be on the next page), leaves the run in flight. A required
#    check not created yet keeps the wait reading it.
for form in 'beside a live job' 'a partial page'; do
  fresh; pair; mkpr 5 "$I" UNSTABLE; unreported
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

# ════ 8-10: a settings block end to end, and the unreported-context probe (ADR 0080) ════════════════════════════════
# remote.origin.url reads https://github.com/o/r.git (merge-settings.py's origin) while insteadOf keeps every fetch and
# ls-remote on the local srv; merge-task's own derivation reads o/r either way.
export PYTHONUSERBASE="${PYTHONUSERBASE:-$(python3 -c 'import site; print(site.getuserbase())')}"
git -C "$tmp/repo" remote set-url origin https://github.com/o/r.git
git -C "$tmp/repo" config url."$MT_SRV".insteadOf https://github.com/o/r.git
export THREAD_NOTE_LOCK_DIR="$tmp/locks" THREAD_GIT_ENV_DIR="$tmp/git-env"
RR="$root/skills/execute/scripts/reconcile-rollout.py"; LI="$root/skills/execute/scripts/lead-integrate.py"
MS="$root/skills/execute/scripts/merge-settings.py"
TD="$tmp/tasks"
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), sort_keys=True))' "$2"; }
notes() {  # a rollout and its task t on PR #5, awaiting Integration
  rm -rf "$TD"; mkdir -p "$TD"; export THREAD_EVENTS_DIR="$tmp/events-e2e"; rm -rf "$THREAD_EVENTS_DIR"
  printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nauto_retries: 2\nmax_review_rounds: 4\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[t]]\n' \
    "$tmp/repo" > "$TD/ro.md"
  printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: https://github.com/o/r/pull/5\nintegrating: 2026-10-03T07:00+00:00\n---\n\n## Notes\n\nA task.\n' \
    > "$TD/t.md"
}
reason() { printf '%s\n' "$out" | sed -n 's/^set-aside reason: //p' | head -1; }
aside() {  # aside <reason> <now>: the lead's exit-4 set-aside, reconciled (the reason verbatim)
  printf '%s' "$1" | python3 "$LI" set-aside --note "$TD/t.md" --kind integration \
    | python3 "$RR" reconcile --result - --tasks-dir "$TD" --now "$2" >/dev/null
}
same_stop() {  # same_stop <reason>: set aside at 08:00, retried at 08:15, the same stop at 08:30 (the settings point)
  aside "$1" 2026-10-03T08:00:00Z
  python3 "$RR" auto-retry --tasks t --rollout "$TD/ro.md" --tasks-dir "$TD" --now 2026-10-03T08:15:00Z >/dev/null 2>&1 \
    || echo "FAIL - same_stop: auto-retry"
  python3 "$RR" mark-integrating --tasks t --tasks-dir "$TD" --now 2026-10-03T08:20:00Z >/dev/null 2>&1
  aside "$1" 2026-10-03T08:30:00Z
}
free_t() { PATH="$tmp/bin:$PATH" python3 "$MS" free --note "$TD/t.md" --repo "$tmp/repo" --now 2026-10-03T09:00:00Z 2>&1; }
inp_t() { python3 "$LI" inputs --note "$TD/t.md" --repo "$tmp/repo" --now 2026-10-03T09:01:00Z; }
rsc() { printf '%s\n' "$1" > "$MT_STATE/rsc.json"; }
cruns() {  # cruns <sha> <name>[:<status>[:<conclusion>[:<app>]]]…: the check runs on <sha>
  python3 -c 'import json,sys
runs = []
for a in sys.argv[2:]:
    p = a.split(":") + ["", "", ""]
    runs.append({"name": p[0], "status": p[1] or "completed", "conclusion": None if p[1] not in ("", "completed") else (p[2] or "success"),
                 "app": {"id": int(p[3] or 15368)}})
print(json.dumps({"total_count": len(runs), "check_runs": runs}))' "$@"
}
mss() { printf '%s\n' "$@" > "$MT_STATE/pr/5/mergeStateStatus.seq"; }
nrows() { awk '$0=="## Merge settings"{on=1; next} on && /^## /{exit} on && NF' "$TD/t.md"; }

# 8. A required job no runner takes, end to end: merge-task sets it aside (no-runner), the lead's set-aside and its retry
#    reach the same stop, merge-settings.py removes the check, `inputs` re-enters it once (22a), and merge-task merges
#    on the re-polled BLOCKED (S2): GitHub folds the change in lazily, never the NON-check gate's 1.
fresh; pair; mkpr 5 "$I" BLOCKED; notes
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "self-hosted (arm)", "app_id": 15368}]}'
queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)"
chk 8 "$(row 'self-hosted (arm)' pending 8)" "" 30
run 5 "$I" "$B"
ok "$rc" 4 "8. merge-task: exit 4 no-runner"
R=$(reason); has "$R" "integration: no-runner: required job \"self-hosted (arm)\"" "8. (its reason)"
same_stop "$R"
out=$(free_t); frc=$?
ok "$frc" 0 "8. merge-settings.py free: exit 0 at the settings point"
ok "$(python3 -c 'import json,sys; print([c["context"] for c in json.load(open(sys.argv[1]))["checks"]])' "$MT_STATE/rsc.json")" "['ci']" \
  "8. … the check no runner takes is removed"
ok "$(j "$(inp_t)" '[d["autoRetry"], d["settingsBlock"]["state"]]')" '[true,"changed"]' "8. inputs reads 22a"
rm -f "$MT_STATE/checks.seq" "$MT_STATE/checks.cur"; green ci 1
cruns "$I" ci 'self-hosted (arm)' > "$MT_STATE/checkruns.$I"
mss BLOCKED BLOCKED BLOCKED CLEAN
run 5 "$I" "$B"
ok "$rc|$(nmerge)" "0|1" "8. merge-task re-run on the same pair: merged once"
has "$out" "re-polling" "8. … after re-polling BLOCKED with every required check reported (S2)"
lacks "$out" "NON-check gate" "8. … never the NON-check gate"

# 8b. The S2 bound: BLOCKED for good with every required context reported is today's exit 1 after LAZY_REPOLL_MAX re-polls.
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}]}'; green ci 1; cruns "$I" ci > "$MT_STATE/checkruns.$I"
run 5 "$I" "$B"
ok "$rc|$(nmerge)|$(printf '%s\n' "$out" | grep -c 're-polling (')" "1|0|6" "8b. BLOCKED for good: exit 1 after 6 re-polls"
has "$(printf '%s\n' "$out" | grep '^ERROR:' | tail -1)" "a NON-check gate is" "8b. … the NON-check gate's text, never the settling 8"

# 9. The never-appeared site: required build, only lint reported, nothing in flight: exit 4 unreported-context, no sha.
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "build", "app_id": 15368}]}'; absent; cruns "$I" lint > "$MT_STATE/checkruns.$I"
run 5 "$I" "$B"
ok "$rc|$(sent)" "4|failed:4" "9. never appeared, a required context nothing reports: exit 4"
has "$(reason)" "integration: unreported-context: required check \"build\" is reported by no check run or status on the PR's head, and no run on it is in flight" \
  "9. … the unreported-context reason"
lacks "$(reason)" "$I" "9. … with no head sha"; lacks "$out" "never appeared" "9. … never the never-appeared exit 1"

# 9b. The NON-check site: ci passing, build unreported, nothing in flight: exit 4 naming only build.
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}]}'; green ci 1
cruns "$I" ci > "$MT_STATE/checkruns.$I"
run 5 "$I" "$B"
ok "$rc" 4 "9b. the NON-check site: exit 4"
has "$(reason)" "unreported-context: required check \"build\"" "9b. … naming build"; lacks "$(reason)" '"ci"' "9b. … and not ci"
lacks "$out" "NON-check gate" "9b. … never the NON-check gate"

# 9c. The Verify line's rename, end to end: the PR's own head renames job build to build-and-test while the rule
#     requires build. merge-task sets it aside, the same stop is freed by one PATCH that replaces build (never removes
#     it), and merge-task merges on the same pair.
fresh; notes
WK="$tmp/wk"; rm -rf "$WK"; git -c init.defaultBranch=master clone -q "$MT_SRV" "$WK" 2>/dev/null
wfput() { mkdir -p "$WK/.github/workflows"; printf 'on: [push, pull_request]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ci\n  build:\n%s    runs-on: ubuntu-latest\n    steps:\n      - run: echo b\n' "$1" > "$WK/.github/workflows/ci.yml"; }
wfput ''; gt -C "$WK" add -A; gt -C "$WK" commit -qm wf; B=$(gt -C "$WK" rev-parse HEAD); gt -C "$WK" push -q origin HEAD:master
wfput '    name: build-and-test
'; gt -C "$WK" commit -qam rename; I=$(gt -C "$WK" rev-parse HEAD)
gt -C "$WK" push -q -f origin "$I:refs/heads/audit-fix/t5" "$I:refs/pull/5/head"
printf '%s\n' "$B" > "$MT_STATE/base.seq"; mkpr 5 "$I" BLOCKED
printf '\n## Integration log\n\n2026-10-03T07:30+00:00 integrated path=integrator pr=5 anchor=%s head=%s base=%s wait=1 duration=1 triggers=- active=1\n' "$I" "$I" "$B" >> "$TD/t.md"
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}]}'
green ci 1; cruns "$I" ci build-and-test > "$MT_STATE/checkruns.$I"
run 5 "$I" "$B"
ok "$rc" 4 "9c. the PR's own rename: exit 4 unreported-context"; R=$(reason); has "$R" 'required check "build"' "9c. … naming build"
same_stop "$R"
: > "$MT_STATE/writes.log"; out=$(free_t); frc=$?
ok "$frc|$(grep -c . "$MT_STATE/writes.log")" "0|1" "9c. free: one write"
ok "$(sed -n 's/^PATCH [^ ]* //p' "$MT_STATE/writes.log")" '{"checks":[{"app_id":-1,"context":"ci"},{"app_id":15368,"context":"build-and-test"}],"strict":true}' \
  "9c. … replacing build with build-and-test, never removing it"
ok "$(j "$(inp_t)" 'd["autoRetry"]')" true "9c. inputs reads 22a"
rm -f "$MT_STATE/checks.seq" "$MT_STATE/checks.cur"
chk 0 "$(row ci pass 1)"$'\n'"$(row build-and-test pass 2)" "" 0; mss CLEAN
run 5 "$I" "$B"
ok "$rc|$(nmerge)" "0|1" "9c. merge-task on the same pair merges once"

# 9d. W1, the reviewer's case: required [ci, build], the head renames build and build-and-test is still running at the
#     NON-check site. The unreported wait holds while it runs, then the block is set aside: never the NON-check 1.
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}]}'; green ci 1
cruns "$I" ci 'build-and-test:in_progress' > "$MT_STATE/checkruns.$I"
TOTAL=1 queued "$(job 10 build-and-test 3 "$OLD" ubuntu-latest in_progress)"; rm -f "$MT_STATE/runs"
printf '%s\n' '[{"id": 7, "status": "in_progress"}]' '[{"id": 7, "status": "in_progress"}]' '[]' > "$MT_STATE/runs.seq"
run 5 "$I" "$B"
ok "$rc|$(sent)" "4|failed:4" "9d. a renamed job still running at the NON-check site: exit 4 once its runs end"
has "$(reason)" 'unreported-context: required check "build"' "9d. … naming build"; lacks "$(reason)" '"ci"' "9d. … only build"
has "$out" "not reported yet; CI in flight on head — waiting on: build-and-test (in_progress)" "9d. the unreported wait names what it waits on"
lacks "$out" "NON-check gate" "9d. never the NON-check gate"
ok "$(grep -c . "$MT_STATE/runs.seq")" 1 "9d. every runs.seq line read"

# 9e. The bound: a run in flight for good past MERGE_TASK_UNREPORTED_WAIT_MAX polls is 8, nothing merged.
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}]}'; green ci 1
cruns "$I" ci > "$MT_STATE/checkruns.$I"; echo 1 > "$MT_STATE/inflight"
MERGE_TASK_UNREPORTED_WAIT_MAX=2 run 5 "$I" "$B"
ok "$rc|$(nmerge)" "8|0" "9e. past the unreported wait's bound: exit 8, nothing merged"
has "$out" "retryable: required check build still unreported on PR #5 while CI runs on its head after 2 polls" "9e. … naming build"
lacks "$out" "NON-check gate" "9e. … never the NON-check gate"

# 9f. A transient probe read is 8 at both sites, never 1; a bad override exits 2 before any gh call.
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}]}'; green ci 1
echo 'gh: Server Error (HTTP 502)' > "$MT_STATE/err.checkruns"
run 5 "$I" "$B"
ok "$rc" 8 "9f. NON-check site, the check-runs read 5xx: exit 8"; has "$out" "retryable: cannot read the check runs" "9f. … cannot read"
lacks "$out" "NON-check gate" "9f. … never the NON-check gate"
rm -f "$MT_STATE/err.checkruns"; cruns "$I" ci > "$MT_STATE/checkruns.$I"; echo 'gh: Server Error (HTTP 502)' > "$MT_STATE/err.runs"
run 5 "$I" "$B"
ok "$rc" 8 "9f. NON-check site, the runs read fails once build is unreported: exit 8"; lacks "$out" "NON-check gate" "9f. … never the NON-check gate"
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "build", "app_id": 15368}]}'; absent
echo 'gh: Server Error (HTTP 502)' > "$MT_STATE/err.checkruns"
run 5 "$I" "$B"
ok "$rc" 8 "9f. never-appeared site, the check-runs read 5xx: exit 8"; lacks "$out" "never appeared" "9f. … never the never-appeared 1"
MERGE_TASK_UNREPORTED_WAIT_MAX=x run 5 "$I" "$B"
ok "$rc|$(glog | grep -c .)" "2|0" "9f. MERGE_TASK_UNREPORTED_WAIT_MAX=x: exit 2 before any gh call"

# 9g. A late roll-up check (W1/F18): the in-flight run creates it while the NON-check site waits; one re-watch watches it
#     to its end. Green merges; red takes the red path, never the NON-check gate.
for form in green red; do
  fresh; pair; mkpr 5 "$I" BLOCKED
  rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "rollup", "app_id": 15368}]}'
  green ci 1
  if [ "$form" = green ]; then chk 0 "$(row ci pass 1)"$'\n'"$(row rollup pass 2)" "" 0
  else chk 1 "$(row ci pass 1)"$'\n'"$(row rollup fail 2)" "" 0; fi
  { cruns "$I" ci; cruns "$I" ci rollup; } > "$MT_STATE/checkruns.$I.seq"
  printf '%s\n' '[{"id": 7, "status": "in_progress"}]' '[]' > "$MT_STATE/runs.seq"
  mss BLOCKED BLOCKED BLOCKED BLOCKED CLEAN
  run 5 "$I" "$B"
  if [ "$form" = green ]; then
    ok "$rc|$(nmerge)|$(grep -c -- '--watch' "$MT_STATE/gh.log")" "0|1|2" "9g. a late roll-up check: one re-watch, then merged once"
  else
    ok "$rc|$(nmerge)" "1|0" "9g-red. the late roll-up check red: exit 1"
    has "$out" "a REQUIRED check FAILED" "9g-red. … the red path"
  fi
  lacks "$out" "NON-check gate" "9g ($form). never the NON-check gate"
done

# 9h. The never-appeared site, the probe reading `pending`: build is required from GitHub Actions, and only a commit
#     status named build, from another source, is pending (statuses_of ignores the app), so `gh pr checks --required`
#     reports none while the probe reads it pending. They disagree, so it reads as unknown: today's exit 1, never a
#     re-wait with no bound. Run under a 60 s guard, so a wait with no bound fails (143) instead of hanging the suite.
brun() {  # brun <pr> <head> <base>: run, stopped by TERM once 60 s pass
  local pid i=0
  : > "$MT_STATE/gh.log"
  PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" "$@" > "$tmp/brun.out" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i+1)); done
  kill -0 "$pid" 2>/dev/null && kill -TERM "$pid"
  wait "$pid"; rc=$?; out=$(cat "$tmp/brun.out")
}
fresh; pair; mkpr 5 "$I" BLOCKED
rsc '{"strict": true, "checks": [{"context": "build", "app_id": 15368}]}'; absent; cruns "$I" lint > "$MT_STATE/checkruns.$I"
echo '{"total_count": 1, "statuses": [{"context": "build", "state": "pending"}]}' > "$MT_STATE/statuses.$I"
brun 5 "$I" "$B"
ok "$rc|$(nmerge)" "1|0" "9h. never-appeared site, the probe pending where gh reports none: today's exit 1, nothing merged"
has "$(printf '%s\n' "$out" | grep '^ERROR:' | tail -1)" "ERROR: required checks never appeared for PR #5" "9h. … the never-appeared text"
ok "$(grep -c 'commits/.*/check-runs' "$MT_STATE/gh.log")" 1 "9h. … after one probe, never a second wait"

# 10. Today's exit 1 at the NON-check site whenever the probe cannot tell: a check-runs 404, a page cut, a status that
#     reports build (after the re-polls), another app's context, an empty required list, a run held only by no-runner jobs.
for c in 404 page status app empty held; do
  fresh; pair; mkpr 5 "$I" BLOCKED; green ci 1
  rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}]}'
  cruns "$I" ci > "$MT_STATE/checkruns.$I"
  case "$c" in
    404) rm -f "$MT_STATE/checkruns.$I" ;;
    page) python3 -c 'import json; print(json.dumps({"total_count": 150, "check_runs": [{"name": "ci", "status": "completed", "conclusion": "success", "app": {"id": 15368}}] * 100}))' > "$MT_STATE/checkruns.$I" ;;
    status) echo '{"total_count": 1, "statuses": [{"context": "build", "state": "success"}]}' > "$MT_STATE/statuses.$I" ;;
    app) rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 777}]}' ;;
    empty) rm -f "$MT_STATE/rsc.json"; echo nochecks > "$MT_STATE/branch" ;;
    held) queued "$(job 8 'self-hosted (arm)' null "$OLD" $SH)" ;;
  esac
  run 5 "$I" "$B"
  ok "$rc|$(nmerge)" "1|0" "10 ($c). the probe cannot tell: today's exit 1"
  has "$(printf '%s\n' "$out" | grep '^ERROR:' | tail -1)" "a NON-check gate is" "10 ($c). … the NON-check gate's text"
done

echo; [ "$fail" -eq 0 ] && echo "merge-task no-runner: ALL PASS" || echo "merge-task no-runner: SOME FAILED"
exit "$fail"
