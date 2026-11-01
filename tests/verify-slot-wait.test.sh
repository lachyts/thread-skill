#!/usr/bin/env bash
# p31-3, executed: an agent waits for its slotted verifier's verdict inside its turn. skills/execute/scripts/verify-slot.py
# `run` frames its output (a start line that names its pid and the exact wait command, an exit line last, on every
# return), and `wait --log FILE [--pid P] [--for S]` reads that output file and reports the run's verdict, bounded so one
# call fits the harness's 600000 ms foreground cap (contract item 9).
#   W1  the run frames its output (the path from F_GETPATH on macOS, /proc/self/fd/2 on Linux)   W1b a pipe: the
#   placeholder   W1c a usage error still gets both lines   W1d the Run-record path: the same lines, the record unchanged
#   W2  wait on finished logs: the run's rc   W3  a run still queued: 75, then its rc   W4  nested verify-slot lines are
#   ignored   W5  a killed run: 76, no verdict   W6  usage; no start line yet   W7  wait holds nothing, and a cut wait
#   leaves the run alone   W8  the heat: 75, then the run's 76   W9  a trailer after the exit line, and a suite whose last
#   output had no newline   W10 a crash: the traceback, then `exit 1`   W11 two runs in one log   W12 the prompt
#   (SLOT_TEXT) and the script name the same lines.
# Structural, never a stopwatch (p22-1): holders hold until a `.go` file appears; every wait is a `within <s>` poll
# whose bound (60 to 300 s) only slows a real failure; a pid is "alive" only when `kill -0` succeeds AND its `ps`
# state is not Z (an unreaped zombie runs nothing). Every background pid is recorded and stopped only by that pid.
# Hermetic: every pool lives under mktemp (THREAD_VERIFY_SLOTS_DIR), the Run record too. Every `run` starts from its
# arm dir under mktemp, so no task tree is found and the plain path runs; W1d alone builds a Run-record fixture.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd -P)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export PYTHONDONTWRITEBYTECODE=1

tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P)
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$tmp/events}"   # the Run record stays in temp
export THREAD_NOTE_LOCK_DIR="${tmp}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"                          # never the machine's real pool
export THREAD_VERIFY_SLOT_POLL=0.1
export THREAD_HEAT_LEVEL=0                                           # the Heat hold's reading, pinned (W8 pins it heavy for one run)
VS="$root/skills/execute/scripts/verify-slot.py"
EN="$root/skills/execute/task.workflow.js"

pids=()
cleanup() {
  local p
  touch "$tmp"/*/*.go 2>/dev/null
  for p in "${pids[@]}"; do kill -TERM "$p" 2>/dev/null; done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null; done
  rm -rf "$tmp"
}
trap cleanup EXIT

# within <s> <cmd…>: poll <cmd> every 0.1 s until it succeeds (0) or <s> s of wall clock pass (1).
within() { local end=$((SECONDS + $1)); shift; until "$@" 2>/dev/null; do [ "$SECONDS" -ge "$end" ] && return 1; sleep 0.1; done; }
# alive <pid>: running, i.e. kill -0 succeeds and ps shows a state that is not Z.
cat > "$tmp/alive.sh" <<'SH'
p=$1
[ -n "$p" ] || exit 1
kill -0 "$p" 2>/dev/null || exit 1
s=$(ps -o stat= -p "$p" 2>/dev/null | tr -d ' ')
[ -n "$s" ] || exit 1
case "$s" in Z*) exit 1;; esac
exit 0
SH
alive() { sh "$tmp/alive.sh" "$1"; }
gone() { ! alive "$1"; }
nonempty() { [ -s "$1" ]; }
grepq() { grep -q -- "$1" "$2"; }

# pool <name>: a fresh arm dir D and its own pool.
pool() { echo "== $1"; D="$tmp/$1"; mkdir -p "$D"; export THREAD_VERIFY_SLOTS_DIR="$D/slots"; }
# hold <name> <N>: a `run --slots N`, started from D, whose command records its pid in <name>.pid and holds until
# <name>.go exists; its output file is <name>.err; the wrapper's pid goes to <name>.w and into pids. Waits until the
# command runs.
hold() {
  local name="$1" n="$2"
  (cd "$D" && exec python3 "$VS" run --slots "$n" -- sh -c "echo \$\$ > '$D/$name.pid'; until [ -e '$D/$name.go' ]; do sleep 0.1; done") \
    > "$D/$name.out" 2> "$D/$name.err" &
  echo $! > "$D/$name.w"; pids+=($!)
  within 300 nonempty "$D/$name.pid" || echo "FAIL - $name: its command did not start within 300 s"
}
w() { cat "$D/$1.w"; }
st() { python3 "$VS" status "$@"; }
js() { python3 -c 'import json,sys; d=json.loads(sys.argv[2]); print(eval(sys.argv[1]))' "$1" "$2"; }
slot_state() { js "d['slots'][$1]['state']" "$(st --slots "$2")"; }
is_free() { [ "$(slot_state "$1" "$2")" = free ]; }
# run_in <out-file> <run args…>: `run` from D, its stderr to <out-file> (stdout dropped); returns its rc.
run_in() { local f="$1"; shift; (cd "$D" && exec python3 "$VS" run "$@") > /dev/null 2> "$f"; }
# startpid <file> [n]: the pid of the n-th (default first) `verify-slot: run <pid> started` line in <file>.
startpid() { sed -n 's/^verify-slot: run \([0-9][0-9]*\) started; .*/\1/p' "$1" | sed -n "${2:-1}p"; }
realp() { python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
# vwait <out-file> <wait args…>: `wait`, its stdout and stderr to <out-file>; returns its rc.
vwait() { local f="$1"; shift; python3 "$VS" wait "$@" > "$f" 2>&1; }
lacks() { case "$1" in *"$2"*) ok "[$1]" "no '$2'" "$3";; *) ok y y "$3";; esac; }

# ======== W1: the run frames its output ========================================================================
pool w1
W1F="$D/F"
run_in "$W1F" --slots 1 -- sh -c 'exit 3'; rc=$?
ok "$rc" 3 "W1: the command's rc passes through"
W1P=$(startpid "$W1F")
ok "$([ -n "$W1P" ] && echo named)" named "W1: the first line names the run's pid"
ok "$(head -1 "$W1F")" "verify-slot: run $W1P started; wait for its verdict with: python3 '$VS' wait --log '$(realp "$W1F")' --pid $W1P" \
  "W1: the first line is the start line, with the exact wait command (the output file's real path, $(uname -s))"
ok "$(tail -1 "$W1F")" "verify-slot: exit 3 (run $W1P)" "W1: the last line is the exit line, the run's rc and pid"
ok "$(wc -l < "$W1F" | tr -d ' ')" 2 "W1: a free slot: nothing between them"
lacks "$(sed "s|'[^']*'||g" "$W1F")" "waiting" "W1: neither line says waiting (the slot-wait line's word), its quoted paths aside"

# ======== W1b: a pipe: the placeholder ========================================================================
pool w1b
(cd "$D" && exec python3 "$VS" run --slots 1 -- true) 2>&1 | cat > "$D/P"
p=$(startpid "$D/P")
ok "$(head -1 "$D/P")" "verify-slot: run $p started; wait for its verdict with: python3 '$VS' wait --log '<its output file>' --pid $p" \
  "W1b: stderr to a pipe: the start line names the placeholder, never a path it cannot prove"
ok "$(tail -1 "$D/P")" "verify-slot: exit 0 (run $p)" "W1b: … and the exit line is last"

# ======== W1c: a usage error still gets both lines =============================================================
pool w1c
run_in "$D/F" --slots 0 -- true; rc=$?
ok "$rc" 2 "W1c: run --slots 0 → exit 2"
p=$(startpid "$D/F")
ok "$([ -n "$p" ] && head -1 "$D/F" | grep -c '^verify-slot: run .* started; wait for its verdict with: ')" 1 "W1c: the start line first"
ok "$(grep -c '^usage: verify-slot.py run \[--slots N\]' "$D/F")" 1 "W1c: then the usage text"
ok "$(tail -1 "$D/F")" "verify-slot: exit 2 (run $p)" "W1c: the exit line last"

# ======== W1d: the Run-record path ============================================================================
# A reduced copy of verify-slot.test.sh VR1's fixture: a git project R with its task tree at R/.claude/worktrees/t1, and
# a vault (under VH, the HOME this run uses) where t1 is in_progress in r1.
pool w1d
VH="$D/home"; VT="$VH/repos/obsidian/Work/Tasks"; VEV="$D/events"; mkdir -p "$VT"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n## Queue\n\n- [[t1]]\n' > "$VT/r1.md"
printf -- '---\ntags: [task]\nstatus: in_progress\nowner: lead-1\nrollout: "[[r1]]"\n---\n\nt1\n' > "$VT/t1.md"
R="$D/r"; git -c init.defaultBranch=main init -q "$R"
printf 'a\n' > "$R/a.txt"; git -C "$R" add a.txt; git -C "$R" -c user.name=t -c user.email=t@t commit -q -m a
git -C "$R" worktree add -q "$R/.claude/worktrees/t1" -b t1 >/dev/null 2>&1
TREE="$R/.claude/worktrees/t1"
(cd "$TREE" && HOME="$VH" THREAD_EVENTS_DIR="$VEV" exec python3 "$VS" run --slots 1 -- \
  sh -c 'echo out-line; echo "FAILED tests/a.py::t - boom"; echo err-line >&2; exit 1') > "$D/o" 2> "$D/F"; rc=$?
ok "$rc" 1 "W1d: a suite in a task tree: its rc passes through"
p=$(startpid "$D/F")
ok "$(head -1 "$D/F")" "verify-slot: run $p started; wait for its verdict with: python3 '$VS' wait --log '$(realp "$D/F")' --pid $p" "W1d: the same start line"
ok "$(tail -1 "$D/F")" "verify-slot: exit 1 (run $p)" "W1d: the same exit line"
ok "$(sed '1d;$d' "$D/F")" "err-line" "W1d: the suite's own stderr between them"
ok "$(cat "$D/o")" "out-line
FAILED tests/a.py::t - boom" "W1d: its stdout as before"
ok "$(python3 - "$VEV/r1.jsonl" <<'PY'
import json, sys
L = [json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
print([d["kind"] for d in L], L[1].get("outcome"), L[1].get("failing"))
PY
)" "['suite-started', 'suite-ended'] red ['tests/a.py::t']" "W1d: the record still holds started and ended, red, its failing name (_failing_from unaffected)"

# ======== W2: wait on finished logs ===========================================================================
pool w2
run_in "$D/G" --slots 1 -- true
gp=$(startpid "$D/G")
vwait "$D/w" --log "$D/G"; rc=$?
ok "$rc" 0 "W2: wait on a green run's log exits 0"
ok "$(tail -1 "$D/w")" "verify-slot: exit 0 (run $gp)" "W2: … and prints its exit line last"
ok "$(head -1 "$D/w")" "verify-slot: wait up to 540s for the verdict of run $gp in $D/G; give this call a timeout over 540s, and a call cut before a verdict line is no verdict: run it again" \
  "W2: its opening line names the bound and the run it watches"
lacks "$(cat "$D/w")" "waiting" "W2: its output never says waiting"
vwait "$D/w3" --log "$W1F"; rc=$?
ok "$rc|$(tail -1 "$D/w3")" "3|verify-slot: exit 3 (run $W1P)" "W2: on W1's red log it exits 3, the run's rc"
vwait "$D/w4" --log "$W1F" --pid "$W1P" --for 5; rc=$?
ok "$rc|$(head -1 "$D/w4")" "3|verify-slot: wait up to 5s for the verdict of run $W1P in $W1F; give this call a timeout over 5s, and a call cut before a verdict line is no verdict: run it again" \
  "W2: the start line's own command (--pid), with --for 5"

# ======== W3: a run still queued =============================================================================
pool w3
hold h 1
(cd "$D" && exec python3 "$VS" run --slots 1 -- sh -c 'exit 6') > /dev/null 2> "$D/F2" &
r2=$!; pids+=($r2)
within 300 grepq 'waiting for one of 1' "$D/F2" && s=queued || s="no waiting line in 300 s"
ok "$s" queued "W3: a second run queues behind the held slot"
vwait "$D/w" --log "$D/F2" --for 1; rc=$?
ok "$rc" 75 "W3: wait --for 1 on the queued run exits 75"
W3OUT=$(cat "$D/w")
has "$W3OUT" "verify-slot: still running after 1s (run $r2; last: verify-slot: waiting for one of 1" "W3: … still running, quoting its last verify-slot line (the slot wait)"
has "$W3OUT" "): run this wait again" "W3: … and says to run the wait again"
touch "$D/h.go"
vwait "$D/w2" --log "$D/F2"; rc=$?
ok "$rc|$(tail -1 "$D/w2")" "6|verify-slot: exit 6 (run $r2)" "W3: once the slot frees, wait exits with the run's rc"
wait "$r2"; wait "$(w h)"

# ======== W4: nested verify-slot lines are ignored ============================================================
pool w4
run_in "$D/F" --slots 1 -- sh -c 'echo "verify-slot: run 1 started; wait for its verdict with: x" >&2; echo "verify-slot: exit 0 (run 1)" >&2; exit 5'
op=$(startpid "$D/F")
ok "$(grep -c '^verify-slot: exit' "$D/F")|$([ "$op" != 1 ] && echo outer)" "2|outer" "W4: the log holds a nested run's lines after the outer start line"
vwait "$D/w" --log "$D/F"; rc=$?
ok "$rc|$(tail -1 "$D/w")" "5|verify-slot: exit 5 (run $op)" "W4: wait reports the outer run (its first start line), never the nested exit 0"
vwait "$D/w2" --log "$D/F" --pid "$op"; rc=$?
ok "$rc|$(tail -1 "$D/w2")" "5|verify-slot: exit 5 (run $op)" "W4: … and so with --pid"

# ======== W5: a killed run: no verdict ========================================================================
pool w5
(cd "$D" && exec python3 "$VS" run --slots 1 -- sh -c "echo \$\$ > '$D/s.pid'; until [ -e '$D/s.go' ]; do sleep 0.1; done") > /dev/null 2> "$D/F" &
p=$!; pids+=($p)
within 300 nonempty "$D/s.pid" || echo "FAIL - W5: the suite did not start"
ok "$(startpid "$D/F")" "$p" "W5: the start line's pid is the run's own (the pid to stop it by)"
kill -KILL "$p"; wait "$p" 2>/dev/null   # reaped first: no zombie reads as alive
within 60 gone "$(cat "$D/s.pid")" && s=gone || s="alive after 60 s"
ok "$s" gone "W5: the guard ended the suite"
vwait "$D/w" --log "$D/F" --for 5; rc=$?
ok "$rc" 76 "W5: wait on a SIGKILLed run exits 76"
has "$(cat "$D/w")" "verify-slot: no verdict: run $p ended with no exit line (stopped or killed); exit 76" "W5: … with its no-verdict line"

# ======== W6: usage; no start line yet ========================================================================
pool w6
printf 'some output\n' > "$D/E"
for a in "--log $D/absent" "" "--log" "--log $D/E --for 0" "--log $D/E --for 591" "--log $D/E --for x" "--log $D/E --for 1.5" "--log $D/E --for +5" "--log $D/E --pid 1_0" \
         "--log $D/E --pid 0" "--log $D/E --pid x" "--log $D/E --pid" "--log $D/E --bogus" "--log $D"; do
  python3 "$VS" wait $a > "$D/u" 2>&1; rc=$?
  ok "$rc|$(grep -c '^verify-slot: wait: ' "$D/u")|$(grep -c '^usage: verify-slot.py run' "$D/u")" "2|1|1" "W6: wait $a → exit 2, its why and the usage"
done
has "$(grep '^usage:' "$D/u")" "wait --log FILE [--pid P] [--for S]" "W6: the usage names wait"
vwait "$D/w" --log "$D/E" --for 1; rc=$?
ok "$rc" 75 "W6: a log with no start line (and no --pid) exits 75 at its bound"
has "$(cat "$D/w")" "no verify-slot: run line in $D/E yet: check the path" "W6: … saying to check the path"
ok "$(head -1 "$D/w")" "verify-slot: wait up to 1s for the verdict of run (not started yet) in $D/E; give this call a timeout over 1s, and a call cut before a verdict line is no verdict: run it again" \
  "W6: … its opening line names no run yet"

# ======== W7: wait holds nothing, and a cut wait leaves the run alone ==========================================
pool w7
hold r 1
R=$(w r)
J0=$(st --slots 1); L0=$(ls -A "$THREAD_VERIFY_SLOTS_DIR")
python3 "$VS" wait --log "$D/r.err" > /dev/null 2> "$D/wait.err" &
WP=$!; pids+=($WP)
within 60 grepq 'verify-slot: wait up to 540s for the verdict of run' "$D/wait.err" && s=opened || s="no opening line in 60 s"
ok "$s" opened "W7: the wait prints its opening line"
J1=$(st --slots 1); L1=$(ls -A "$THREAD_VERIFY_SLOTS_DIR")
ok "$(js "d['slots'][0]['holder']['pid'], d['waiters']" "$J0")" "($R, [])" "W7: before the wait: the run holds slot 0, no waiters"
ok "$(js "d['slots'][0]['holder']['pid'], d['waiters']" "$J1")" "($R, [])" "W7: during the wait: the same holder, still no waiters"
ok "$L1" "$L0" "W7: … and nothing new in the slots dir"
kill -TERM "$WP"; wait "$WP"; rc=$?
ok "$rc" 143 "W7: TERM to the wait → 143"
has "$(cat "$D/wait.err")" "verify-slot: wait cut by a signal after " "W7: … with its wait cut line"
has "$(cat "$D/wait.err")" "(run $R): no verdict; run this wait again" "W7: … naming the run, no verdict"
ok "$(alive "$R" && alive "$(cat "$D/r.pid")" && echo alive || echo gone)" alive "W7: the run and its suite are untouched"
touch "$D/r.go"; wait "$R"; rc=$?
ok "$rc" 0 "W7: the run ends 0"
vwait "$D/w" --log "$D/r.err"; rc=$?
ok "$rc|$(tail -1 "$D/w")" "0|verify-slot: exit 0 (run $R)" "W7: a fresh wait reports it"

# ======== W8: the heat ========================================================================================
pool w8
(cd "$D" && export THREAD_HEAT_LEVEL=2 && exec python3 "$VS" run --slots 1 -- true) > /dev/null 2> "$D/F" &
P=$!; pids+=($P)
within 120 grepq 'verify-slot: waiting (heat: heavy)' "$D/F" && s=held || s="no heat line in 120 s"
ok "$s" held "W8: pinned heavy, the run waits on the heat"
vwait "$D/w" --log "$D/F" --for 1; rc=$?
ok "$rc" 75 "W8: wait --for 1 exits 75"
has "$(cat "$D/w")" "(run $P; last: verify-slot: waiting (heat: heavy))" "W8: … quoting the heat line"
kill -TERM "$P"; wait "$P"; rc=$?
ok "$rc" 76 "W8: a TERM while heat-held: the run exits 76"
has "$(cat "$D/F")" "verify-slot: no verdict: stopped while the Mac was hot (heat: heavy); exit 76" "W8: … with its no-verdict line"
vwait "$D/w2" --log "$D/F"; rc=$?
ok "$rc|$(tail -1 "$D/w2")" "76|verify-slot: exit 76 (run $P)" "W8: wait then reports exit 76, no verdict"

# ======== W9: what surrounds the exit line ===================================================================
pool w9
run_in "$D/G" --slots 1 -- true
gp=$(startpid "$D/G")
printf 'late leftover output\nverify-slot: exit 9 (run 1)\n[exited with code 0]\n' >> "$D/G"
vwait "$D/w" --log "$D/G"; rc=$?
ok "$rc|$(tail -1 "$D/w")" "0|verify-slot: exit 0 (run $gp)" "W9a: a trailer and leftover output after the exit line are ignored"
(cd "$D" && exec python3 "$VS" run --slots 1 -- sh -c 'printf partial; exit 4') > "$D/H" 2>&1
hp=$(startpid "$D/H")
ok "$(tail -1 "$D/H")" "partialverify-slot: exit 4 (run $hp)" "W9b: a suite whose last output had no newline: the exit line shares its line"
vwait "$D/w2" --log "$D/H"; rc=$?
ok "$rc|$(tail -1 "$D/w2")" "4|verify-slot: exit 4 (run $hp)" "W9b: … and wait still reads the verdict at the line's end"

# ======== W10: a crash: the traceback, then `exit 1` ==========================================================
pool w10
cat > "$D/harness.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
def boom(*a, **k):
    raise RuntimeError("W10 injected")
vs.Guarded = boom
sys.exit(vs.main(["run", "--slots", "1", "--", "true"]))
PY
(cd "$D" && exec python3 "$D/harness.py" "$VS") > /dev/null 2> "$D/F"; rc=$?
ok "$rc" 1 "W10: an unexpected exception in run → exit 1"
cp=$(startpid "$D/F")
ok "$(sed '$d' "$D/F" | grep -c '^Traceback')|$(sed '$d' "$D/F" | grep -c 'RuntimeError: W10 injected')" "1|1" "W10: the traceback, naming it, before the last line"
ok "$(tail -1 "$D/F")" "verify-slot: exit 1 (run $cp)" "W10: the last line is still the exit line"
ok "$(is_free 0 1 && echo free || echo held)" free "W10: the slot is free"
vwait "$D/w" --log "$D/F"; rc=$?
ok "$rc" 1 "W10: wait reports 1, never 76"

# ======== W11: two runs in one log ============================================================================
pool w11
run_in "$D/L" --slots 1 -- sh -c 'exit 3'
(cd "$D" && exec python3 "$VS" run --slots 1 -- true) > /dev/null 2>> "$D/L"
a=$(startpid "$D/L" 1); b=$(startpid "$D/L" 2)
ok "$([ -n "$a" ] && [ -n "$b" ] && [ "$a" != "$b" ] && echo two)" two "W11: the log holds two runs' start lines"
vwait "$D/w" --log "$D/L"; rc=$?
ok "$rc|$(tail -1 "$D/w")" "3|verify-slot: exit 3 (run $a)" "W11: without --pid, the first start line's run"
vwait "$D/w2" --log "$D/L" --pid "$b"; rc=$?
ok "$rc|$(tail -1 "$D/w2")" "0|verify-slot: exit 0 (run $b)" "W11: with --pid, that run"

# ======== W12: the prompt (SLOT_TEXT) and the script name the same lines ======================================
echo "== w12"
for s in 'verify-slot: run <pid> started; wait for its verdict with:' 'verify-slot: still running' 'verify-slot: exit <rc> (run <pid>)'; do
  ok "$(grep -cF -- "$s" "$EN" | awk '{print ($1 >= 1) ? "named" : "absent"}')" named "W12: task.workflow.js (SLOT_TEXT) names \`$s\`"
done
has "$(head -1 "$W1F")" "verify-slot: run $W1P started; wait for its verdict with:" "W12: … and W1's start line is that shape"
ok "$(tail -1 "$W1F")" "verify-slot: exit 3 (run $W1P)" "W12: … W1's exit line too"
has "$W3OUT" "verify-slot: still running" "W12: … and W3's wait printed the still-running shape"

echo; [ "$fail" -eq 0 ] && echo "verify-slot-wait: ALL PASS" || echo "verify-slot-wait: SOME FAILED"
exit "$fail"
