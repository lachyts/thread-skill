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

# 7-12 (p47-10): a step cut at its job's time limit beside another red check. gh exits 1 on the `fail` row, so the red
# path's infra classifier reads it: run 7 failed on setup, run 9's e2e job was cancelled with no failed step. A cancelled
# job its check run's annotations prove hit its time limit is re-run once with the setup failure; a second cut of it is
# a genuine red naming the timeout; an unproven cancellation and a real red stay genuine, with no re-run.
cjob() {  # cjob <run> <job> <conclusion> — run's jobs: e2e, its `Run make test` step concluded the same way
  printf '{"jobs": [{"databaseId": %s, "name": "e2e", "status": "completed", "conclusion": "%s", "steps": [{"name": "Run make test", "status": "completed", "conclusion": "%s"}]}]}\n' \
    "$2" "$3" "$3" > "$MT_STATE/jobs.$1"
}
limit() { printf '[{"message": "The job has exceeded the maximum execution time of 55m0s"}, {"message": "The operation was canceled."}]\n' > "$MT_STATE/annotations.$1"; }
RED2="$(printf '%s\n%s' "$(row ci fail 7 8)" "$(row e2e fail 9 10)")"
GREEN2="$(printf '%s\n%s' "$(row ci pass 7 8)" "$(row e2e pass 9 10)")"
red2() { fresh; pair; mkpr 5 "$I" UNSTABLE; echo "Set up job" > "$MT_STATE/steps.7"; : > "$MT_STATE/steps.9"; cjob 9 10 cancelled; limit 10; }
reruns() { grep -c "^run rerun $1 --failed" "$MT_STATE/gh.log"; }
gate() {  # gate <merge-task output> — "<merge-gate> <ci-timeout>" for the lead's own-run reason
  python3 - "$RR" "$1" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
reason = "merge-task: " + m._merge_task_cause(sys.argv[2]).replace("\n", " ")
print(m._merge_gate_stop(reason), m._merge_task_ci_timeout(reason))
PY
}
TL="cut at its job's time limit"; AGAIN="TIMED OUT again at its job's time limit"

# 7. the timeout is classed infra beside the setup failure: both runs re-run once, then green merges.
red2; chk 1 "$RED2"; chk 0 "$GREEN2"
run 5 "$I" "$B"
ok "$rc" 0 "7. a step cut at its time limit beside a setup failure: re-run, then merges"; ok "$(nmerge)" 1 "7. merged once"
ok "$(reruns 7)" 1 "7. run 7 re-run once"; ok "$(reruns 9)" 1 "7. run 9 re-run once"
has "$out" "e2e: Run make test" "7. names the timed-out step"; has "$out" "$TL" "7. says it was cut at its time limit"
has "$(glog)" "api repos/o/r/check-runs/10/annotations" "7. reads the job's annotations for the proof"

# 8. cut again after its one re-run: a genuine red naming the timeout (merge-gate, never ci-timeout), one re-run only.
red2; chk 1 "$RED2"; chk 1 "$RED2"
run 5 "$I" "$B"
ok "$rc" 1 "8. cut at its time limit again: exits 1"; ok "$(reruns 9)" 1 "8. run 9 re-run once only"
has "$out" "a REQUIRED check FAILED on PR #5" "8. the red required check's path"
has "$out" "$AGAIN" "8. names the second timeout"; has "$out" "e2e: Run make test" "8. names its step"
ok "$(gate "$out")" "True False" "8. reconcile reads a red required check (merge-gate), never ci-timeout"
ok "$(nmerge)" 0 "8. nothing merged"

# 9. fail-closed: a cancellation no annotation proves hit the time limit (another stop, an unreadable read) stays
#    genuine, with no re-run.
for a in other unreadable; do
  red2; chk 1 "$RED2"
  if [ "$a" = other ]; then echo '[{"message": "The operation was canceled."}]' > "$MT_STATE/annotations.10"
  else echo "HTTP 502: Bad Gateway" > "$MT_STATE/err.annotations"; fi
  run 5 "$I" "$B"
  ok "$rc" 1 "9 ($a). an unproven cancellation exits 1"; has "$out" "run 9 has no failed step to classify" "9 ($a). names run 9"
  lacks "$(glog)" "run rerun" "9 ($a). no re-run"; lacks "$out" "$TL" "9 ($a). never read as a timeout"
done

# 10. a real red is unchanged: a failed test step beside the timeout halts with no re-run.
red2; echo "Run tests" > "$MT_STATE/steps.7"; chk 1 "$RED2"
run 5 "$I" "$B"
ok "$rc" 1 "10. a real red beside a timeout exits 1"; lacks "$(glog)" "run rerun" "10. no re-run"
has "$out" "a genuine (non-infra) step failed" "10. the genuine verdict"; lacks "$out" "$AGAIN" "10. never a second timeout"

# 11. one re-run per timeout across both paths: the cancelled path's re-run, then a red with the timeout again, is the
#     second timeout (11a); the red path's re-run, then the check cancelled alone, is cancelled again (11b).
red2; chk 0 "$(row e2e fail 9 10)"; chk 1 "$RED2"
run 5 "$I" "$B"
ok "$rc" 1 "11a. cancelled, then cut again beside a setup failure: exits 1"; has "$out" "$AGAIN" "11a. the second timeout"
ok "$(reruns 9)" 1 "11a. run 9 re-run once only"; lacks "$(glog)" "run rerun 7" "11a. run 7 never re-run"
red2; chk 1 "$RED2"; chk 0 "$(row e2e fail 9 10)"
run 5 "$I" "$B"
ok "$rc" 1 "11b. re-run as a timeout, then cancelled alone: exits 1"; has "$out" "cancelled again" "11b. cancelled again"
has "$out" "$CANCELLED" "11b. the cancelled cause"; ok "$(reruns 9)" 1 "11b. run 9 re-run once only"
# The re-run is the job's, never spent by another job's: lint (run 11) cancelled alone and re-run, then e2e's first cut
# beside a setup failure is a first one (11c); e2e re-run as a timeout, then lint cancelled alone takes its own (11d).
LINT="$(row lint pass 11 12)"; LINTX="$(row lint fail 11 12)"
red2; jobs 11 12 cancelled; chk 0 "$(printf '%s\n%s' "$GREEN2" "$LINTX")"
chk 1 "$(printf '%s\n%s' "$RED2" "$LINT")"; chk 0 "$(printf '%s\n%s' "$GREEN2" "$LINT")"
run 5 "$I" "$B"
ok "$rc" 0 "11c. lint re-run as cancelled, then e2e cut at its time limit: re-run, then merges"; ok "$(nmerge)" 1 "11c. merged once"
ok "$(reruns 11)" 1 "11c. run 11 re-run once"; ok "$(reruns 9)" 1 "11c. run 9 re-run once"; lacks "$out" "$AGAIN" "11c. never a second timeout"
red2; jobs 11 12 cancelled; chk 1 "$(printf '%s\n%s' "$RED2" "$LINT")"
chk 0 "$(printf '%s\n%s' "$GREEN2" "$LINTX")"; chk 0 "$(printf '%s\n%s' "$GREEN2" "$LINT")"
run 5 "$I" "$B"
ok "$rc" 0 "11d. e2e re-run as a timeout, then lint cancelled alone: re-run, then merges"; ok "$(nmerge)" 1 "11d. merged once"
ok "$(reruns 9)" 1 "11d. run 9 re-run once"; ok "$(reruns 11)" 1 "11d. run 11 re-run once"; lacks "$out" "cancelled again" "11d. never cancelled again"

# 12. fail-closed: run 9's failed-step read errors (HTTP 502) while its job read still serves e2e proven cut at its time
#     limit beside a test job's real red. The read proves nothing, so the cut is never read and nothing is re-run.
red2; echo "HTTP 502: Bad Gateway" > "$MT_STATE/steps.9.err"
printf '{"jobs": [{"databaseId": 13, "name": "test", "status": "completed", "conclusion": "failure", "steps": [{"name": "Run tests", "status": "completed", "conclusion": "failure"}]}, {"databaseId": 10, "name": "e2e", "status": "completed", "conclusion": "cancelled", "steps": [{"name": "Run make test", "status": "completed", "conclusion": "cancelled"}]}]}\n' > "$MT_STATE/jobs.9"
chk 1 "$RED2"; chk 0 "$GREEN2"
run 5 "$I" "$B"
ok "$rc" 1 "12. a failed-step read that errors beside a proven cut exits 1"; ok "$(nmerge)" 0 "12. nothing merged"
lacks "$(glog)" "run rerun" "12. no re-run"; has "$out" "run 9's failed steps could not be read" "12. names run 9's read"
lacks "$(glog)" "check-runs/10/annotations" "12. never reads the cut's proof"

# 13-18 (p54-11): a required check that is a roll-up over three shards (`make test (ubuntu-latest)`: `needs: shard`,
# `if: always()`) concludes `failure` whichever shard failed or was cut, and its own step (`every shard passed`) reads as
# genuine. merge-task reads it through its shards: a shard's setup failure is re-run as infra, a shard cut alone takes
# the cancelled path, a cut beside a setup failure the red path's timeout re-run, and a genuine shard failure stays red.
# The head's tree holds the workflow, fetched into the clone as Integration's head is in production.
SWF='name: test
on: [pull_request]
jobs:
  shard:
    name: make test (ubuntu-latest, shard ${{ matrix.shard }}/3)
    strategy:
      matrix:
        shard: [1, 2, 3]
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - run: make test-fast
  test:
    name: make test (ubuntu-latest)
    needs: shard
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: every shard passed
        run: test "${{ needs.shard.result }}" = success
'
wfpr() {  # wfpr <workflow> [nofetch] — fresh state; I := a head whose tree holds test.yml; PR 5 on it (UNSTABLE), fetched
  local blob t1 t2 t3
  fresh; pair
  blob=$(printf '%s' "$1" | git --git-dir "$MT_SRV" hash-object -w --stdin)
  t1=$(printf '100644 blob %s\ttest.yml\n' "$blob" | git --git-dir "$MT_SRV" mktree)
  t2=$(printf '040000 tree %s\tworkflows\n' "$t1" | git --git-dir "$MT_SRV" mktree)
  t3=$(printf '040000 tree %s\t.github\n' "$t2" | git --git-dir "$MT_SRV" mktree)
  I=$(gt --git-dir "$MT_SRV" commit-tree "$t3" -p "$B" -m head)
  echo head > "$MT_STATE/squash.tree"
  mkpr 5 "$I" UNSTABLE
  [ "${2:-}" = nofetch ] || git -C "$tmp/repo" fetch -q origin audit-fix/t5
}
srun() {  # srun <shard 1> <shard 2> <shard 3> [<docs>] — run 7's jobs: each `<conclusion>[:<step>]`; the roll-up (70) failed
  python3 - "$MT_STATE/run.7.json" "$@" <<'PY'
import json, sys
out, specs = sys.argv[1], sys.argv[2:]
jobs = []
for i, spec in enumerate(specs[:3], 1):
    c, _, step = spec.partition(":")
    jobs.append({"databaseId": 70 + i, "name": "make test (ubuntu-latest, shard %d/3)" % i, "status": "completed",
                 "conclusion": c, "steps": [{"name": step or "Run make test-fast", "status": "completed", "conclusion": c}]})
if len(specs) > 3:
    jobs.append({"databaseId": 74, "name": "docs", "status": "completed", "conclusion": specs[3], "steps": []})
jobs.append({"databaseId": 70, "name": "make test (ubuntu-latest)", "status": "completed", "conclusion": "failure",
             "steps": [{"name": "every shard passed", "status": "completed", "conclusion": "failure"}]})
json.dump({"workflowName": "test", "jobs": jobs}, open(out, "w"))
PY
}
ROLL="$(row "make test (ubuntu-latest)" fail 7 70)"; ROLLOK="$(row "make test (ubuntu-latest)" pass 7 70)"
WFR="jobs,workflowName"

# 13. shard 2 fails on `Set up job`: re-run as infra, then merges. The roll-up's own `every shard passed` (in today's
#     step read) never reaches the classifier.
wfpr "$SWF"; srun success "failure:Set up job" success; printf 'Set up job\nevery shard passed\n' > "$MT_STATE/steps.7"
chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc" 0 "13. a shard's setup failure behind the roll-up: re-run as infra, then merges"; ok "$(nmerge)" 1 "13. merged once"
ok "$(reruns 7)" 1 "13. run 7 re-run once"; has "$out" "shard 2/3" "13. names the shard"; has "$out" "Set up job" "13. names its step"
lacks "$out" "a genuine (non-infra) step failed" "13. never genuine"

# 14. shard 2 cut alone: the roll-up's `failure` is the cut it stands for, the cancelled path's (gh 2.43.1's table).
wfpr "$SWF"; srun success cancelled success; chk 1 "$ROLL"; chk 1 "$ROLL"
run 5 "$I" "$B"
ok "$rc" 1 "14a. a shard cut alone, cut again after its re-run: exits 1"; has "$out" "$CANCELLED" "14a. the cancelled cause"
has "$out" "make test (ubuntu-latest) through make test (ubuntu-latest, shard 2/3) (run 7)" "14a. names the check through its cut shard"
ok "$(reruns 7)" 1 "14a. one re-run"; lacks "$out" "a REQUIRED check FAILED" "14a. never a red required check"
ok "$(reads "$out")" "True True" "14a. reconcile reads it as GitHub's stop, a CI timeout"
wfpr "$SWF"; srun success cancelled success; chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc|$(reruns 7)|$(nmerge)" "0|1|1" "14b. a shard cut alone, then green: one re-run, merged"
# 14c. a gh with `pr checks --json` (its `fail` bucket read through), and a needed job skipped by its path filter: neutral.
wfpr "${SWF/needs: shard/needs: [shard, docs]}
  docs:
    runs-on: ubuntu-latest
    steps:
      - run: true
"; touch "$MT_STATE/checks.json"; srun success cancelled success skipped; chk 1 "$ROLL"; chk 1 "$ROLL"
run 5 "$I" "$B"
ok "$rc" 1 "14c. --json gh, a skipped docs job beside the cut: exits 1"; has "$out" "$CANCELLED" "14c. the cancelled cause"
has "$out" "through make test (ubuntu-latest, shard 2/3) (run 7)" "14c. the cut shard alone, never the skipped job"
has "$(glog)" "pr checks 5 -R o/r --required --json name,bucket,link" "14c. reads the buckets"
ok "$(reruns 7)" 1 "14c. one re-run"; ok "$(reads "$out")" "True True" "14c. GitHub's stop, a CI timeout"

# 15. shard 2 cut at its time limit beside shard 3's setup failure: never a cancellation (a failure is in the set); the
#     red path re-runs the cut once as infra (p47-10), and a second cut of the same shard is a genuine red.
wfcut() { wfpr "$SWF"; srun success cancelled "failure:Set up job"; printf 'Set up job\nevery shard passed\n' > "$MT_STATE/steps.7"
  printf '[{"message": "The job has exceeded the maximum execution time of 20m0s"}]\n' > "$MT_STATE/annotations.72"; }
wfcut; chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc|$(reruns 7)|$(nmerge)" "0|1|1" "15a. a shard cut at its limit beside a setup failure: one re-run, merged"
has "$out" "make test (ubuntu-latest, shard 2/3): Run make test-fast: $TL" "15a. names shard 2 cut at its time limit"
lacks "$out" "$CANCELLED" "15a. never the cancelled cause"
wfcut; chk 1 "$ROLL"; chk 1 "$ROLL"
run 5 "$I" "$B"
ok "$rc|$(reruns 7)" "1|1" "15b. cut again after its re-run: exits 1, one re-run only"; has "$out" "$AGAIN" "15b. the second timeout"
ok "$(gate "$out")" "True False" "15b. a red required check (merge-gate), never ci-timeout"

# 16. a genuine test failure in shard 1 stays red: no re-run.
wfpr "$SWF"; srun "failure:Run make test-fast" success success
printf 'Run make test-fast\nevery shard passed\n' > "$MT_STATE/steps.7"; chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc|$(nmerge)" "1|0" "16. a shard's genuine test failure: exits 1, nothing merged"; lacks "$(glog)" "run rerun" "16. no re-run"
has "$out" "a genuine (non-infra) step failed" "16. the genuine verdict"; has "$out" "Run make test-fast" "16. names its step"

# 17. fail-closed: (a) every shard passed, so the roll-up's red is its own (its step genuine); (b) the head is not in the
#     clone, so no roll-up is read and nothing new is asked; (c) run 7 cannot be read.
wfpr "$SWF"; srun success success success; echo "every shard passed" > "$MT_STATE/steps.7"; chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc" 1 "17a. every shard passed, the roll-up failed: exits 1"; lacks "$(glog)" "run rerun" "17a. no re-run"
has "$out" "a genuine (non-infra) step failed" "17a. genuine"; lacks "$out" "$CANCELLED" "17a. never cancelled"
wfpr "$SWF" nofetch; srun success "failure:Set up job" success; printf 'Set up job\nevery shard passed\n' > "$MT_STATE/steps.7"
chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc" 1 "17b. the head not in the clone: exits 1, the reads as before"; lacks "$(glog)" "run rerun" "17b. no re-run"
lacks "$(glog)" "$WFR" "17b. never reads a run whole for its shards"
wfpr "$SWF"; srun success "failure:Set up job" success; echo "HTTP 502: Bad Gateway" > "$MT_STATE/run.7.err"
chk 1 "$ROLL"; chk 0 "$ROLLOK"
run 5 "$I" "$B"
ok "$rc" 1 "17c. run 7 unreadable: exits 1"; lacks "$(glog)" "run rerun" "17c. no re-run"
has "$out" "run 7's jobs could not be read" "17c. names run 7"

# 18. no roll-up, a workflow file present: `ci` needs `setup` with no if: (a, b), or under a false-positive
#     `${{ !cancelled() }}` with setup passed, which falls back to itself (c, d). A setup failure is still re-run and
#     merged; a cut alone still takes the cancelled path; (a, b) never read a run whole for shards.
NWF='name: test
on: [pull_request]
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: true
  ci:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - run: make test
'
cjobs() {  # cjobs <ci conclusion> [<its step>] — run 7: setup (6) success, ci (8)
  printf '{"workflowName": "test", "jobs": [{"databaseId": 6, "name": "setup", "status": "completed", "conclusion": "success", "steps": []}, {"databaseId": 8, "name": "ci", "status": "completed", "conclusion": "%s", "steps": [{"name": "%s", "status": "completed", "conclusion": "%s"}]}]}\n' \
    "$1" "${2:-Run make test}" "$1" > "$MT_STATE/run.7.json"
}
wfpr "$NWF"; cjobs failure "Set up job"; echo "Set up job" > "$MT_STATE/steps.7"
chk 1 "$(row ci fail 7 8)"; chk 0 "$(row ci pass 7 8)"
run 5 "$I" "$B"
ok "$rc|$(reruns 7)|$(nmerge)" "0|1|1" "18a. needs, no if:, a setup failure: re-run once, merged"; lacks "$(glog)" "$WFR" "18a. no shards read"
wfpr "$NWF"; jobs 7 8 cancelled; chk 0 "$(row ci fail 7 8)"; chk 0 "$(row ci fail 7 8)"
run 5 "$I" "$B"
ok "$rc|$(reruns 7)" "1|1" "18b. needs, no if:, cut alone: exits 1 after one re-run"; has "$out" "$CANCELLED" "18b. the cancelled cause"
ok "$(reads "$out")" "True True" "18b. GitHub's stop, a CI timeout"; lacks "$(glog)" "$WFR" "18b. no shards read"
FWF='name: test
on: [pull_request]
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: true
  ci:
    needs: setup
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - run: make test
'
for c in setup cut; do
  wfpr "$FWF"
  if [ "$c" = setup ]; then
    cjobs failure "Set up job"; echo "Set up job" > "$MT_STATE/steps.7"; chk 1 "$(row ci fail 7 8)"; chk 0 "$(row ci pass 7 8)"
    run 5 "$I" "$B"
    ok "$rc|$(reruns 7)|$(nmerge)" "0|1|1" "18c. a false-positive aggregator's own setup failure: re-run once, merged"
    has "$(glog)" "run view 7 -R o/r --json $WFR" "18c. read as a roll-up, then as itself (setup passed)"
  else
    cjobs cancelled; chk 0 "$(row ci fail 7 8)"; chk 0 "$(row ci fail 7 8)"
    run 5 "$I" "$B"
    ok "$rc|$(reruns 7)" "1|1" "18d. a false-positive aggregator cut alone: exits 1 after one re-run"
    has "$out" "$CANCELLED: a CI timeout" "18d. the cancelled cause"; has "$out" "ci (run 7)" "18d. names the check itself"
    ok "$(reads "$out")" "True True" "18d. GitHub's stop, a CI timeout"
  fi
done

echo; [ "$fail" -eq 0 ] && echo "merge-task cancelled: ALL PASS" || echo "merge-task cancelled: SOME FAILED"
exit "$fail"
