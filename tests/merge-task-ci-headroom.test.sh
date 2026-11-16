#!/usr/bin/env bash
# ADR 0073 d5: each merge's Run record holds each required job's CI headroom. merge-task.sh's land_and_finish runs
# lead-integrate.py ci-headroom on every merged path, which writes one ci-headroom line per required Actions job into
# the task's rollout record: the job's name, seconds, conclusion and time limit (`timeout-minutes` read from the
# workflow file at the integrated head, GitHub's 360 when the job declares none). A check that is no Actions job writes
# none; a re-run on the already-merged path writes no second line, but fills the jobs of a run gh could not read; a PR
# no task note names writes none and reads no run; recording never changes an exit or a line of output. Driven end to
# end against the shared fake gh (gh 2.43.1's `run view --json` fields only) and a real bare "GitHub" repo
# (tests/lib/merge-task-env.sh); the vault and the record live in temp.
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
{"workflowName": "test", "jobs": [
 {"databaseId": 101, "name": "make test (ubuntu-latest)", "conclusion": "success", "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:31:02Z"},
 {"databaseId": 102, "name": "make test (macos-latest)", "conclusion": "success", "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:48:00Z"},
 {"databaseId": 103, "name": "lint", "conclusion": "success", "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:00:20Z"}]}
JSON
}
onejob() {  # onejob <run> <job id> <name>: one more required Actions job in checks()'s table and in run.<run>.json
  python3 - "$MT_STATE" "$@" <<'PY'
import json, os, sys
st, run, job, name = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
cur = json.load(open(os.path.join(st, "checks.cur")))
cur["out"] += f"{name}\tpass\t1m\thttps://github.com/o/r/actions/runs/{run}/job/{job}\t\n"
for f in ("checks.cur", "checks.seq"):
    json.dump(cur, open(os.path.join(st, f), "w"))
rp = os.path.join(st, f"run.{run}.json")
d = json.load(open(rp)) if os.path.exists(rp) else {"workflowName": "test", "jobs": []}
d["jobs"].append({"databaseId": job, "name": name, "conclusion": "success",
                  "startedAt": "2026-11-08T01:00:00Z", "completedAt": "2026-11-08T01:01:00Z"})
json.dump(d, open(rp, "w"))
PY
}
LI="$root/skills/execute/scripts/lead-integrate.py"
li() {  # li <pr> <repo>: lead-integrate.py ci-headroom straight (as merge-task calls it), its JSON line in $j
  : > "$MT_STATE/gh.log"
  j=$(PATH="$tmp/bin:$PATH" python3 "$LI" ci-headroom --repo "$2" --pr "$1" --head "$I" --tasks-dir "$VT")
}
jf() {  # jf <python expr over J, li's JSON line>
  python3 -c 'import json, sys; print(json.dumps(eval(sys.argv[2], {"J": json.loads(sys.argv[1])}), separators=(",", ":")))' "$j" "$1"
}

# 1. a merge: one line per required Actions job, its seconds, conclusion and limit; the external status writes none.
#    The fake gh refuses a `run view --json` field gh 2.43.1 lacks (rc 1, as the real one does), so this pins the call.
fresh; pair; wfhead; mkpr 5 "$I"; checks
run 5 "$I" "$B"
ok "$rc" 0 "1. merged: exit 0"
ok "$(rec '[[d["task"], d["pr"], d["repo"], d["job"], d["seconds"], d["conclusion"], d["timeoutMinutes"], d["limitSource"], d["runId"], d["workflow"]] for d in L]')" \
  '[["t5",5,"o/r","make test (ubuntu-latest)",1862,"success",60,"workflow",11,"test"],["t5",5,"o/r","make test (macos-latest)",2880,"success",60,"workflow",11,"test"],["t5",5,"o/r","lint",20,"success",360,"default",11,"test"]]' \
  "1. three lines: the matrix jobs at their own 60, lint at GitHub's 360; none for deploy/preview"
ok "$(glog | grep -c '^run view 11 ')" 1 "1. run 11 read once, for all three jobs"
ok "$(glog | grep '^run view 11 ')" "run view 11 -R o/r --json jobs,workflowName" "1. … asking only fields gh 2.43.1 serves"

# 2. the same PR again, on the already-merged path: no second line, and no run read (each of its jobs is recorded)
run 5 "$I" "$B"
ok "$rc" 0 "2. already merged: exit 0"
ok "$(rec 'len(L)')" 3 "2. no job recorded twice"
ok "$(glog | grep -c '^run view')" 0 "2. … and no run read again"

# 3. an unwritable record changes no exit and no line of output. The same merge from the same state (a snapshot of the
#    fake GitHub, its bare repo and the clone, restored between the two, every commit date pinned so each sha matches),
#    run once with a writable record and once with an unwritable one, prints the same output, ignoring nothing.
fresh; pair; wfhead; mkpr 5 "$I"; checks
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
export GIT_AUTHOR_DATE='2026-11-08T00:00:00Z' GIT_COMMITTER_DATE='2026-11-08T00:00:00Z'
snap="$tmp/snap"; mkdir -p "$snap"; cp -a "$MT_STATE" "$snap/st"; cp -a "$MT_SRV" "$snap/srv"; cp -a "$tmp/repo" "$snap/repo"
run 5 "$I" "$B"; rc_w=$rc; out_w=$out; sent_w=$(sent)
ok "$rc_w|$sent_w|$(rec 'len(L)')" "0|ok|3" "3. the writable run: exit 0, ok, its three jobs recorded"
rm -rf "$MT_STATE" "$MT_SRV" "$tmp/repo"
cp -a "$snap/st" "$MT_STATE"; cp -a "$snap/srv" "$MT_SRV"; cp -a "$snap/repo" "$tmp/repo"
: > "$tmp/not-a-dir"
THREAD_EVENTS_DIR="$tmp/not-a-dir/events" run 5 "$I" "$B"
unset GIT_AUTHOR_DATE GIT_COMMITTER_DATE
ok "$rc|$(sent)" "$rc_w|$sent_w" "3. an unwritable record: the same exit and status"
ok "$out" "$out_w" "3. … and the same output, line for line"
has "$out" "merged" "3. … which reports the merge"

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
has "$out" "merged" "5. (the output names the merge)"

# 6. a run gh cannot read writes no line for its jobs (each named in why), so the re-run on the already-merged path,
#    which reads it, writes each line once
fresh; pair; wfhead; mkpr 5 "$I"; checks
echo 'HTTP 502: Bad Gateway (https://api.github.com/repos/o/r/actions/runs/11)' > "$MT_STATE/run.11.err"
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
run 5 "$I" "$B"
ok "$rc|$(rec 'len(L)')" "0|0" "6. run 11 unread (gh rc 1): merged, exit 0, no line"
li 5 "$tmp/repo"
ok "$(jf '[J["written"], J["jobs"]]')" '[0,[]]' "6. … ci-headroom itself writes none"
has "$(jf 'J["why"]')" "3 required job(s) of an unread run not recorded" "6. … and says so"
has "$(jf 'J["why"]')" "lint (run 11: gh rc 1)" "6. … naming each job and why its run was not read"
rm -f "$MT_STATE/run.11.err"
run 5 "$I" "$B"
ok "$rc" 0 "6. the re-run, on the already-merged path: exit 0"
ok "$(rec '[[d["job"], d["seconds"], d["conclusion"]] for d in L]')" \
  '[["make test (ubuntu-latest)",1862,"success"],["make test (macos-latest)",2880,"success"],["lint",20,"success"]]' \
  "6. … writes each job once, timed, now its run is read"
run 5 "$I" "$B"
ok "$(rec 'len(L)')" 3 "6. a third run adds none"

# 7. a run past CI_MAX_RUNS (4) is not read: its job writes no line and is named in why, and the next pass, which reads
#    no run whose jobs are all recorded, reads it
fresh; pair; wfhead; mkpr 5 "$I"; checks
for r in 12 13 14 15; do onejob "$r" "$((r * 10))" "job $r"; done
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
li 5 "$tmp/repo"
ok "$(rec '[d["job"] for d in L if d["runId"] != 11]')" '["job 12","job 13","job 14"]' \
  "7. runs 11 to 14 read; run 15's job writes none"
ok "$(glog | grep -c '^run view 15 ')" 0 "7. … run 15 never asked for"
has "$(jf 'J["why"]')" "job 15 (run 15: past CI_MAX_RUNS (4))" "7. … and named in why"
li 5 "$tmp/repo"
ok "$(glog | grep '^run view' | cut -d' ' -f1-3)" "run view 15" "7. the next pass reads run 15 alone"
ok "$(rec '[d["job"] for d in L if d["runId"] != 11]')|$(jf 'J["why"]')" '["job 12","job 13","job 14","job 15"]|""' \
  "7. … and writes its job, with nothing left unread"

# 8. a required check named past CI_JOB_MAX (200) is stored cut to it, and the re-run compares the cut name: one line
fresh; pair; wfhead; mkpr 5 "$I"; checks
LONG="$(printf 'a very long required check name %.0s' 1 2 3 4 5 6 7 8)"; LONG="${LONG% }"
onejob 11 104 "$LONG"
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
run 5 "$I" "$B"
run 5 "$I" "$B"
ok "$(rec '[len(d["job"]) for d in L if d["job"].startswith("a very long")]')" '[200]' \
  "8. a ${#LONG}-character check: one line over two runs, its name cut to 200"

# 9. an origin that is no github.com remote: nothing read and no gh call (nor a vault walk, which with no owner/repo
#    could match another repo's PR URL of the same number)
plain="$tmp/plain"; git init -q "$plain"; git -C "$plain" remote add origin https://gitlab.com/o/r.git
li 5 "$plain"
ok "$(jf '[J["written"], J["why"]]')" '[0,"no GitHub origin"]' "9. no GitHub origin: nothing written"
ok "$(glog | wc -l | tr -d ' ')" 0 "9. … and no gh call"

# 10-13 (p54-11): a required check that is a roll-up (a job that `needs:` others under `if: always()` or `!cancelled()`)
# records the slowest of the jobs it needs, against that job's own limit, and `shard` names it. A plain `needs:` job and
# a false-positive aggregator that is itself the slowest keep their own line, and a job named only by an expression no
# longer lends its limit to every check after it (compression-engine's `${{ matrix.toolchain }}`).
wftree() {  # wftree <file> <content> [<file> <content>…] — I := a head on B whose .github/workflows/ holds them; PR 5 on it, fetched
  local entries='' blob t1 t2 t3
  while [ "$#" -ge 2 ]; do
    blob=$(printf '%s' "$2" | git --git-dir "$MT_SRV" hash-object -w --stdin)
    entries="$entries$(printf '100644 blob %s\t%s' "$blob" "$1")"$'\n'
    shift 2
  done
  t1=$(printf '%s' "$entries" | git --git-dir "$MT_SRV" mktree)
  t2=$(printf '040000 tree %s\tworkflows\n' "$t1" | git --git-dir "$MT_SRV" mktree)
  t3=$(printf '040000 tree %s\t.github\n' "$t2" | git --git-dir "$MT_SRV" mktree)
  I=$(gt --git-dir "$MT_SRV" commit-tree "$t3" -p "$B" -m head)
  mkpr 5 "$I"; git -C "$tmp/repo" fetch -q origin audit-fix/t5
}
runjobs() {  # runjobs <file> <workflowName> <id|name|conclusion[|seconds]>… — a `gh run view --json jobs,workflowName` object
  python3 - "$@" <<'PY'
import json, sys
out, wf, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
jobs = []
for s in specs:
    jid, name, c, *secs = s.split("|")
    j = {"databaseId": int(jid), "name": name, "status": "completed", "conclusion": c}
    if secs:
        j.update(startedAt="2026-11-08T01:00:00Z", completedAt="2026-11-08T%02d:%02d:%02dZ" % (
            1 + int(secs[0]) // 3600, int(secs[0]) % 3600 // 60, int(secs[0]) % 60))
    jobs.append(j)
json.dump({"workflowName": wf, "jobs": jobs}, open(out, "w"))
PY
}
reqrows() {  # reqrows <name|run|job>… — the required checks gh's table prints
  python3 - "$MT_STATE/checks.cur" "$@" <<'PY'
import json, sys
rows = ["%s\tpass\t1m\thttps://github.com/o/r/actions/runs/%s/job/%s\t" % tuple(r.split("|")) for r in sys.argv[2:]]
json.dump({"rc": 0, "out": "\n".join(rows) + "\n"}, open(sys.argv[1], "w"))
PY
}
HWF='name: test
on: [pull_request]
jobs:
  build:
    name: ${{ matrix.toolchain }}
    strategy:
      matrix:
        toolchain: [gcc-12]
    timeout-minutes: ${{ matrix.minutes }}
    runs-on: ubuntu-latest
    steps:
      - run: make
  linux-gcc-threads:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - run: make
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
        run: true
  setup:
    runs-on: ubuntu-latest
    timeout-minutes: 7
    steps:
      - run: true
  ci:
    needs: setup
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - run: make test
  prep:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - run: true
  fp:
    needs: prep
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - run: make e2e
'
UB="make test (ubuntu-latest)"; S="make test (ubuntu-latest, shard"
HROWS=("$UB|21|70" "ci|21|80" "fp|21|90" "linux-gcc-threads|21|95")
HJOBS=("60|gcc-12|success|50" "95|linux-gcc-threads|success|100" "71|$S 1/3)|success|600" "72|$S 2/3)|success|1500"
       "73|$S 3/3)|success|900" "70|$UB|success|10" "81|setup|success|60" "80|ci|success|300" "91|prep|success|30"
       "90|fp|success|1200")
LINE='[[d["job"], d["seconds"], d["timeoutMinutes"], d["limitSource"], d["conclusion"], d.get("shard")] for d in J["jobs"]]'

# 10. the roll-up over three shards records shard 2/3's 1500 s against its 20; `ci` (needs, no if:) and `fp` (a
#     `!cancelled()` false positive, itself the slowest) keep their own line with no shard; linux-gcc-threads reads its own 20.
fresh; pair; wftree test.yml "$HWF"; reqrows "${HROWS[@]}"; runjobs "$MT_STATE/run.21.json" test "${HJOBS[@]}"
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
li 5 "$tmp/repo"
ok "$(jf "$LINE")" \
  "[[\"$UB\",1500,20,\"workflow\",\"success\",\"$S 2/3)\"],[\"ci\",300,30,\"workflow\",\"success\",null],[\"fp\",1200,45,\"workflow\",\"success\",null],[\"linux-gcc-threads\",100,20,\"workflow\",\"success\",null]]" \
  "10. the roll-up records its slowest shard against the shard's limit; the rest their own line"
ok "$(rec '[[d["job"], d["shard"]] for d in L if "shard" in d]')" "[[\"$UB\",\"$S 2/3)\"]]" \
  "10. … the record takes the roll-up's line, the one that carries shard"

# 11. a roll-up whose shard jobs the run does not hold proves nothing: seconds and limit null, unread, its own conclusion.
fresh; pair; wftree test.yml "$HWF"; reqrows "$UB|22|70"; runjobs "$MT_STATE/run.22.json" test "70|$UB|failure|10"
rm -f "$THREAD_EVENTS_DIR/ro.jsonl"
li 5 "$tmp/repo"
ok "$(jf "$LINE")" "[[\"$UB\",null,null,\"unread\",\"failure\",null]]" "11. shards the run lacks: null, unread"

# 12. shards --check prints the roll-ups at the head: needs + always(), a flow list with a comment + !cancelled(), a block
#     list at the same indent and one deeper (a quoted item); never needs alone, a name that is only an expression, a
#     step's if:, a name two aggregators share, or a flow list that never closes.
SHAPES='name: shapes
on: [pull_request]
jobs:
  lint:
    runs-on: x
  shard:
    runs-on: x
  setup:
    runs-on: x
  a:
    name: A
    needs: shard
    if: always()
  b:
    name: B
    needs: [lint, shard]  # c
    if: ${{ !cancelled() }}
  c:
    name: C
    if: "always()"
    needs:
    - lint
    - shard
    runs-on: x
  d:
    name: D
    needs:
      - lint
      - '"'"'shard'"'"'
    if: always() && !failure()
  e:
    name: E
    needs: setup
  f:
    name: ${{ matrix.any }}
    needs: setup
    if: always()
  g:
    name: G
    needs: setup
    steps:
    - if: always()
      run: true
  h1:
    name: H
    needs: setup
    if: always()
  h2:
    name: H
    needs: lint
    if: always()
  i:
    name: I
    needs: [lint, shard
    if: always()
'
fresh; pair; wftree shapes.yml "$SHAPES"
ok "$(python3 "$LI" shards --repo "$tmp/repo" --head "$I" --check A B C D E "anything at all" G H I | tr '\n' ' ')" "A B C D " \
  "12. --check prints the four aggregator shapes, and none of the five that are not"
ok "$(python3 "$LI" shards --repo "$tmp/repo" --head 0000000000000000000000000000000000000000 --check A; echo "rc $?")" "rc 0" \
  "12. … a head the repo lacks: nothing printed, exit 0"

# 13. shards --jobs: what a run's required job ids stand for.
WA='name: A
on: [pull_request]
jobs:
  plan:
    runs-on: x
  shard:
    name: shard ${{ matrix.n }}
    needs: plan
  roll:
    name: R
    needs: shard
    if: always()
  c1:
    needs: c2
  c2:
    needs: c1
  cyc:
    name: C
    needs: c1
    if: always()
  callee:
    runs-on: x
  gone:
    name: G
    needs: callee
    if: always()
  X:
    needs: plan
    if: always()
'
WB='name: B
on: [pull_request]
jobs:
  plan:
    runs-on: x
  X:
    needs: plan
'
shj() {  # shj <run json> <args…> — shards --jobs at I: "<rc> <the names it prints, ,-joined>"; its stderr in $tmp/sh.err
  local f="$1" r
  shift
  sout=$(python3 "$LI" shards --repo "$tmp/repo" --head "$I" --jobs "$f" "$@" 2>"$tmp/sh.err"); r=$?
  echo "$r $(printf '%s' "$sout" | python3 -c 'import json, sys; t = sys.stdin.read()
print(",".join(j["name"] for j in json.loads(t)["jobs"]) if t.strip() else "-")')"
}
fresh; pair; wftree a.yml "$WA" b.yml "$WB"; R1="$tmp/r1.json"
runjobs "$R1" A "1|plan|success" "2|shard 1|failure" "3|shard 2|success" "5|lint|success" "4|R|failure"
ok "$(shj "$R1" --job-id 4)" "0 plan,shard 1,shard 2" "13. a roll-up stands for its two-level closure, never itself"
has "$(cat "$tmp/sh.err")" "shards: R (job 4) stands for: plan (success), shard 1 (failure), shard 2 (success)" \
  "13. … and one stderr line names them"
ok "$(shj "$R1" --job-id 4 5)" "0 plan,shard 1,shard 2,lint" "13. a plain required id stands for itself, in run order"
ok "$(shj "$R1" --whole --job-id 4)" "0 plan,shard 1,shard 2,lint" "13. --whole keeps every other job, drops only the roll-up"
ok "$(shj "$R1" --job-id 5)" "3 lint" "13. only a plain id: exit 3"
ok "$(python3 "$LI" shards --repo "$tmp/repo" --head 0000000000000000000000000000000000000000 --jobs "$R1" --job-id 4 \
  >/dev/null 2>&1; echo $?)" 3 "13. a head the repo lacks: exit 3"
runjobs "$tmp/r2.json" A "10|c1|cancelled" "11|c2|success" "12|C|failure"
ok "$(shj "$tmp/r2.json" --job-id 12)" "0 c1,c2" "13. a needs: cycle ends, and holds both jobs"
runjobs "$tmp/r3.json" A "20|G|failure"
ok "$(shj "$tmp/r3.json" --job-id 20)" "1 -" "13. a needed job the run lacks: exit 1, not proven"
echo nope > "$tmp/r0.json"
ok "$(shj "$tmp/r0.json" --job-id 4)" "1 -" "13. unreadable JSON: exit 1"
runjobs "$tmp/r4.json" A "1|plan|success" "2|shard 1|skipped" "3|shard 2|success" "4|R|failure"
ok "$(shj "$tmp/r4.json" --job-id 4)" "3 R" "13. every needed job success or skipped: the roll-up stands for itself, exit 3"
runjobs "$tmp/r5.json" A "1|plan|failure" "2|X|failure"; runjobs "$tmp/r6.json" B "1|plan|failure" "2|X|failure"
ok "$(shj "$tmp/r5.json" --job-id 2)|$(shj "$tmp/r6.json" --job-id 2)" "0 plan|3 X" \
  "13. workflowName picks the file: X a roll-up in A, a plain job in B"

echo; [ "$fail" -eq 0 ] && echo "merge-task-ci-headroom: ALL PASS" || echo "merge-task-ci-headroom: SOME FAILED"
exit "$fail"
