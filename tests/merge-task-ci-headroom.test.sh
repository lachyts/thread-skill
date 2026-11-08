#!/usr/bin/env bash
# ADR 0073 d5: each merge's Run record holds each required job's CI headroom. merge-task.sh's land_and_finish runs
# lead-integrate.py ci-headroom on every merged path, which writes one ci-headroom line per required Actions job into
# the task's rollout record: the job's name, seconds, conclusion and time limit (`timeout-minutes` read from the
# workflow file at the integrated head, GitHub's 360 when the job declares none). A check that is no Actions job writes
# none; a re-run on the already-merged path writes no second line; a PR no task note names writes none and reads no
# run; recording never changes an exit or a line of output. Driven end to end against the shared fake gh and a real
# bare "GitHub" repo (tests/lib/merge-task-env.sh); the vault and the record live in temp.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)

tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
export THREAD_EVENTS_DIR="$tmp/events"   # this suite reads the record, so it keeps its own (not THREAD_TEST_EVENTS_DIR)
export HOME="$tmp/home" PYTHONDONTWRITEBYTECODE=1 THREAD_NOTE_LOCK_DIR="$tmp/note-locks"
VT="$HOME/repos/obsidian/Work/Tasks"; mkdir -p "$VT"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n## Queue\n\n- [[t5]]\n' > "$VT/ro.md"
printf -- '---\ntags: [task]\nstatus: review\nrollout: "[[ro]]"\npr: https://github.com/o/r/pull/5\n---\n\nt5\n' > "$VT/t5.md"
rec() {  # rec <python expr over L, ro's ci-headroom lines>
  python3 - "$THREAD_EVENTS_DIR/ro.jsonl" "$1" <<'PY'
import json, sys
try:
    L = [d for d in (json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()) if d["kind"] == "ci-headroom"]
except (FileNotFoundError, NotADirectoryError):
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY
}
# The workflow the run ran: a matrix job with its own limit (the names GitHub shows carry the matrix value) and a job
# that declares none (GitHub's 360); a step's timeout-minutes is deeper, so never read as a job's.
WF='name: test
on: [pull_request]
jobs:
  test:
    name: make test (${{ matrix.os }})
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 60   # headroom
    steps:
      - run: make test
        timeout-minutes: 5
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: true
'
wfhead() {  # I := a head on B whose tree holds .github/workflows/test.yml ($WF); the squash keeps the head's tree
  local blob t1 t2 t3
  blob=$(printf '%s' "$WF" | git --git-dir "$MT_SRV" hash-object -w --stdin)
  t1=$(printf '100644 blob %s\ttest.yml\n' "$blob" | git --git-dir "$MT_SRV" mktree)
  t2=$(printf '040000 tree %s\tworkflows\n' "$t1" | git --git-dir "$MT_SRV" mktree)
  t3=$(printf '040000 tree %s\t.github\n' "$t2" | git --git-dir "$MT_SRV" mktree)
  I=$(gt --git-dir "$MT_SRV" commit-tree "$t3" -p "$B" -m head)
  echo head > "$MT_STATE/squash.tree"
}
checks() {  # the required checks as gh's table prints them off a TTY: three Actions jobs of run 11 and one external status
  python3 - "$MT_STATE/checks.cur" <<'PY'
import json, sys
rows = ["make test (ubuntu-latest)\tpass\t31m2s\thttps://github.com/o/r/actions/runs/11/job/101\t",
        "make test (macos-latest)\tpass\t48m0s\thttps://github.com/o/r/actions/runs/11/job/102\t",
        "lint\tpass\t20s\thttps://github.com/o/r/actions/runs/11/job/103\t",
        "deploy/preview\tpass\t0\thttps://example.com/status/1\t"]
json.dump({"rc": 0, "out": "\n".join(rows) + "\n"}, open(sys.argv[1], "w"))
PY
  cp "$MT_STATE/checks.cur" "$MT_STATE/checks.seq"
  cat > "$MT_STATE/run.11.json" <<'JSON'
{"workflowName": "test", "attempt": 2, "jobs": [
 {"databaseId": 101, "name": "make test (ubuntu-latest)", "conclusion": "success", "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:31:02Z"},
 {"databaseId": 102, "name": "make test (macos-latest)", "conclusion": "success", "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:48:00Z"},
 {"databaseId": 103, "name": "lint", "conclusion": "success", "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:00:20Z"}]}
JSON
}

# 1. a merge: one line per required Actions job, its seconds, conclusion and limit; the external status writes none
fresh; pair; wfhead; mkpr 5 "$I"; checks
run 5 "$I" "$B"
ok "$rc" 0 "1. merged: exit 0"
ok "$(rec '[[d["task"], d["pr"], d["repo"], d["job"], d["seconds"], d["conclusion"], d["timeoutMinutes"], d["limitSource"], d["runId"], d["attempt"], d["workflow"]] for d in L]')" \
  '[["t5",5,"o/r","make test (ubuntu-latest)",1862,"success",60,"workflow",11,2,"test"],["t5",5,"o/r","make test (macos-latest)",2880,"success",60,"workflow",11,2,"test"],["t5",5,"o/r","lint",20,"success",360,"default",11,2,"test"]]' \
  "1. three lines: the matrix jobs at their own 60, lint at GitHub's 360; none for deploy/preview"
ok "$(glog | grep -c '^run view 11 ')" 1 "1. run 11 read once, for all three jobs"
OUT1=$out

# 2. the same PR again, on the already-merged path: no second line
run 5 "$I" "$B"
ok "$rc" 0 "2. already merged: exit 0"
ok "$(rec 'len(L)')" 3 "2. no job recorded twice"

# 3. an unwritable record: the same exit and the same output
fresh; pair; wfhead; mkpr 5 "$I"; checks
: > "$tmp/not-a-dir"
THREAD_EVENTS_DIR="$tmp/not-a-dir/events" run 5 "$I" "$B"
ok "$rc|$(sent)" "0|ok" "3. an unwritable record: still exit 0, ok"
has "$out" "merged" "3. … and the merge is reported"

# 4. a PR no task note names (a RACE revert's PR): no line, and no run read
fresh; pair; wfhead; mkpr 9 "$I"; checks
n0=$(rec 'len(L)')
run 9 "$I" "$B"
ok "$rc" 0 "4. a PR no note names: merged, exit 0"
ok "$(rec 'len(L)')" "$n0" "4. … no ci-headroom line"
ok "$(glog | grep -c '^run view')" 0 "4. … and no run read"

# 5. the limit is unread when the run's workflow is no file at the head (a job named nowhere): null, unread
fresh; pair; wfhead; mkpr 5 "$I"; checks
python3 - "$MT_STATE/run.11.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["workflowName"] = "elsewhere"; json.dump(d, open(sys.argv[1], "w"))
PY
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
run 5 "$I" "$B"
ok "$(rec '[[d["timeoutMinutes"], d["limitSource"]] for d in L]')" '[[null,"unread"],[null,"unread"],[null,"unread"]]' \
  "5. no workflow file named elsewhere: each limit null, unread"
has "$OUT1" "merged" "5. (the output names the merge)"

echo; [ "$fail" -eq 0 ] && echo "merge-task-ci-headroom: ALL PASS" || echo "merge-task-ci-headroom: SOME FAILED"
exit "$fail"
