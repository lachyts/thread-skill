#!/usr/bin/env bash
# p23-4, executed: skills/execute/scripts/verify-slot.py, the machine-wide verify slots and the guard that ends a
# killed holder's suite before its verify slot frees, with lead-integrate.py's `verify --slots N --slot-wait S` where
# an arm crosses into it.
#   V1  rc and stdout pass through, no waiting line   V2  the cap: at most N of eight runs (six `run`, two lead
#   verifies) at once, all eight ran   V3  a wrapper SIGKILLed while its TERM-ignoring command runs: the waiter
#   behind it sees no overlap   V4  a command's background leftover holds no slot and is not killed   V5  TERM to
#   `run` (holding, or waiting with --priority)   V6  usage   V7  the dir chain; an unusable dir fails open
#   V8  status   V9a the lead's verify goes before a waiting agent   V9b so does `run --priority`   V10 stale
#   waiter files are reaped, a locked one is not   V11 a lead verify SIGKILLed while waiting leaves a stale waiter
#   file, reaped next   V12 a kill of the wrapper's whole process group   V13 the guard SIGKILLed alone   V14
#   release is a close (a co-holder keeps the slot)   V15 a failure injected after the spawn: the slot stays held
#   until the suite's group is gone   V16 no code calls fcntl.LOCK_UN; the header's close-only contract.
# Structural, never a stopwatch (p22-1): holders hold until a `.go` file appears; every wait is a `within <s>` poll
# whose bound (60 to 300 s) only slows a real failure; a pid is "alive" only when `kill -0` succeeds AND its `ps`
# state is not Z (an unreaped zombie runs nothing). Every background pid is recorded and stopped only by that pid.
# Hermetic: every pool lives under mktemp (THREAD_VERIFY_SLOTS_DIR), the Run record too.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd -P)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export PYTHONDONTWRITEBYTECODE=1

tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P)
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$tmp/events}"   # the Run record stays in temp
export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"                          # never the machine's real pool
export THREAD_VERIFY_SLOT_POLL=0.1
VS="$root/skills/execute/scripts/verify-slot.py"
LI="$root/skills/execute/scripts/lead-integrate.py"
u=$(printf %07d $$)

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
# alive <pid>: running, i.e. kill -0 succeeds and ps shows a state that is not Z. The same check as a file for the
# waiters' own `sh -c`.
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
dead() { ! kill -0 "$1" 2>/dev/null; }
exists() { [ -e "$1" ]; }
nonempty() { [ -s "$1" ]; }
grepq() { grep -q -- "$1" "$2"; }

# pool <name>: a fresh arm dir D and its own pool.
pool() { echo "== $1"; D="$tmp/$1"; mkdir -p "$D"; export THREAD_VERIFY_SLOTS_DIR="$D/slots"; }
# hold <name> <N> [--priority] [--ignore-term]: a `run --slots N` whose command records its pid in <name>.pid and
# holds until <name>.go exists; the wrapper's pid goes to <name>.w and into pids. Waits until the command runs.
hold() {
  local name="$1" n="$2" prio="" trp="" o
  shift 2
  for o in "$@"; do case "$o" in --priority) prio=--priority;; --ignore-term) trp="trap '' TERM; ";; esac; done
  python3 "$VS" run --slots "$n" $prio -- sh -c "${trp}echo \$\$ > '$D/$name.pid'; until [ -e '$D/$name.go' ]; do sleep 0.1; done" \
    > "$D/$name.out" 2> "$D/$name.err" &
  echo $! > "$D/$name.w"; pids+=($!)
  within 300 nonempty "$D/$name.pid" || echo "FAIL - $name: its command did not start within 300 s"
}
w() { cat "$D/$1.w"; }
st() { python3 "$VS" status "$@"; }
js() { python3 -c 'import json,sys; d=json.loads(sys.argv[2]); print(eval(sys.argv[1]))' "$1" "$2"; }
slot_state() { js "d['slots'][$1]['state']" "$(st --slots "$2")"; }
is_free() { [ "$(slot_state "$1" "$2")" = free ]; }
nwaiters() { ls "$THREAD_VERIFY_SLOTS_DIR" 2>/dev/null | grep -c '^waiter-.*\.wait$'; }
has_waiter() { [ "$(nwaiters)" -ge 1 ]; }
# waiter <name> <pidfile>: a `run --slots 1` that records whether <pidfile>'s process was still alive when it got
# the slot (overlap) or not (clean) in <name>.ran; its wrapper pid goes to <name>.w.
waiter() {
  python3 "$VS" run --slots 1 -- sh -c "if sh '$tmp/alive.sh' \"\$(cat '$2')\"; then echo overlap; else echo clean; fi > '$D/$1.ran'" \
    > "$D/$1.out" 2> "$D/$1.err" &
  echo $! > "$D/$1.w"; pids+=($!)
}

# ======== V1: rc and stdout pass through; no waiting line ==================================================
pool v1
for i in 1 2; do
  out=$(python3 "$VS" run --slots 2 -- sh -c 'echo out; exit 3' 2> "$D/err$i"); rc=$?
  ok "$rc|$out" "3|out" "V1 #$i: the command's rc and stdout pass through"
  ok "$(grep -c 'waiting' "$D/err$i")" 0 "V1 #$i: a free slot → no waiting line"
done

# ======== V2: the cap ======================================================================================
pool v2
M="$D/in"; mkdir -p "$M" "$D/tree"
CHILD="mkdir '$M/\$\$'; ls '$M' | wc -l >> '$D/peaks'; sleep 0.5; ls '$M' | wc -l >> '$D/peaks'; rmdir '$M/\$\$'; echo x >> '$D/ran'"
v2=()
for i in 1 2 3 4 5 6; do python3 "$VS" run --slots 2 -- sh -c "$CHILD" > /dev/null 2>&1 & v2+=($!); pids+=($!); done
for i in 1 2; do
  python3 "$LI" verify --tree "$D/tree" --out "$D/li$i" --timeout 600 --slots 2 --slot-wait 600 --verifier "$CHILD" > /dev/null 2>&1 &
  v2+=($!); pids+=($!)
done
for p in "${v2[@]}"; do wait "$p"; done
peak=$(sort -n "$D/peaks" | tail -1 | tr -d ' ')
ok "$([ "${peak:-9}" -le 2 ] && echo y || echo "peak $peak")" y "V2: at most 2 of the 8 commands ran at once (verify_slots 2)"
ok "$(wc -l < "$D/ran" | tr -d ' ')" 8 "V2: … and all eight ran (six run, two lead verifies)"
ok "$(cat "$D/li1.rc")|$(cat "$D/li2.rc")" "0|0" "V2: … the two lead verifies green"

# ======== V3: the wrapper SIGKILLed: no overlap ============================================================
pool v3
hold h 1 --ignore-term
waiter wr "$D/h.pid"
within 300 grepq 'waiting for one of 1' "$D/wr.err" && s=queued || s="no waiting line in 300 s"
ok "$s" queued "V3: a second run waits behind the held slot (its waiting line on stderr)"
kill -KILL "$(w h)"
within 60 exists "$D/wr.ran" && s=ran || s="the waiter never ran in 60 s"
ok "$s" ran "V3: after the wrapper's SIGKILL the waiter gets the slot"
ok "$(cat "$D/wr.ran" 2>/dev/null)" clean "V3: … only once its TERM-ignoring command is gone (the guard's KILL and reap)"
ok "$(dead "$(cat "$D/h.pid")" && echo reaped || echo present)" reaped "V3: … and that command is reaped (kill -0 fails: no zombie window)"
wait "$(w wr)"; wait "$(w h)" 2>/dev/null

# ======== V4: a background leftover holds no slot and is not killed ========================================
pool v4
python3 "$VS" run --slots 1 -- sh -c "sleep 3191.$u > /dev/null 2>&1 & echo \$! > '$D/sleeper'" > /dev/null 2>&1
ok "$?" 0 "V4: a command that leaves a background sleeper exits 0"
python3 "$VS" run --slots 1 -- true 2> "$D/err"
ok "$(grep -c waiting "$D/err")" 0 "V4: … and frees its slot (the next run has no waiting line)"
sp=$(cat "$D/sleeper")
ok "$(alive "$sp" && echo alive || echo gone)" alive "V4: … its leftover is not killed (as before the slot)"
kill -KILL "$sp" 2>/dev/null

# ======== V5: TERM to run ==================================================================================
pool v5
hold t 1
kill -TERM "$(w t)"; wait "$(w t)"; rc=$?
ok "$rc" 143 "V5: TERM to a holding run → 143"
within 60 gone "$(cat "$D/t.pid")" && s=gone || s="still alive after 60 s"
ok "$s" gone "V5: … its command is gone"
python3 "$VS" run --slots 1 -- true 2> "$D/err"
ok "$(grep -c waiting "$D/err")" 0 "V5: … and its slot is free"
hold t2 1
python3 "$VS" run --slots 1 --priority -- touch "$D/t3.ran" > /dev/null 2> "$D/t3.err" &
p=$!; pids+=($p)
within 300 has_waiter && s=registered || s="no waiter file in 300 s"
ok "$s" registered "V5: a waiting run --priority registers a waiter file"
kill -TERM "$p"; wait "$p"; rc=$?
ok "$rc|$([ -e "$D/t3.ran" ] && echo ran || echo never)|$(nwaiters)" "143|never|0" "V5: TERM to it while waiting → 143, the command never ran, no waiter file left"
touch "$D/t2.go"; wait "$(w t2)"

# ======== V6: usage ========================================================================================
pool v6
for a in "--slots 0 -- true" "--slots -1 -- true" "--slots abc -- true" "--slots 1.5 -- true" "--slots 1 true" \
         "--slots 1 --" "--priority -- true" "--slots 1 --prio -- true" "-- true"; do
  python3 "$VS" run $a > /dev/null 2>&1; ok "$?" 2 "V6: run $a → exit 2"
done
python3 "$VS" > /dev/null 2>&1; ok "$?" 2 "V6: no verb → exit 2"
python3 "$VS" run --slots 1 --priority -- true; rc=$?
ok "$rc|$(nwaiters)" "0|0" "V6: run --slots 1 --priority -- true → 0, no waiter file left"
ok "$(python3 "$VS" run --slots 1 -- sh -c 'echo "$1"' sh --priority)" "--priority" "V6: a --priority after -- reaches the command"

# ======== V7: the dir chain; an unusable dir fails open ===================================================
pool v7
mkdir -p "$D/h"
dirof() { python3 -c 'import json,sys; print(json.load(sys.stdin)["dir"])'; }
ok "$(THREAD_VERIFY_SLOTS_DIR="$D/ov" python3 "$VS" status | dirof)" "$D/ov" "V7: THREAD_VERIFY_SLOTS_DIR wins"
ok "$(THREAD_VERIFY_SLOTS_DIR= XDG_STATE_HOME="$D/xdg" HOME="$D/h" python3 "$VS" status | dirof)" "$D/xdg/thread/verify-slots" "V7: an empty override is unset; then XDG_STATE_HOME"
ok "$(THREAD_VERIFY_SLOTS_DIR= XDG_STATE_HOME=rel HOME="$D/h" python3 "$VS" status | dirof)" "$D/h/.local/state/thread/verify-slots" "V7: a relative XDG_STATE_HOME is ignored"
ok "$(env -u THREAD_VERIFY_SLOTS_DIR -u XDG_STATE_HOME HOME="$D/h" python3 "$VS" status | dirof)" "$D/h/.local/state/thread/verify-slots" "V7: else HOME/.local/state"
: > "$D/file"
out=$(THREAD_VERIFY_SLOTS_DIR="$D/file/slots" python3 "$VS" run --slots 1 -- sh -c 'echo ran; exit 5' 2> "$D/err"); rc=$?
ok "$rc|$out" "5|ran" "V7: an unusable slots dir (a file in its path): the command still runs, its rc passes through"
has "$(cat "$D/err")" "verify-slot: WARN $D/file/slots" "V7: … behind a WARN naming the dir"
has "$(cat "$D/err")" "running unslotted" "V7: … that says it runs unslotted"

# ======== V8: status ========================================================================================
pool v8
hold s 2
J=$(st --slots 2)
ok "$(js "d['slots'][0]['state'], d['slots'][1]['state']" "$J")" "('held', 'free')" "V8: status shows slot 0 held and slot 1 free"
ok "$(js "d['slots'][0]['holder']['pid']" "$J")" "$(w s)" "V8: … the holder's pid is the wrapper's"
ok "$(js "d['slots'][0]['holder']['group']" "$J")" "$(cat "$D/s.pid")" "V8: … its group is the command's own (pgid = the command's pid)"
ok "$(kill -0 -- "-$(js "d['slots'][0]['holder']['group']" "$J")" 2>/dev/null && echo live)" live "V8: … a live process group"
ok "$(kill -0 "$(js "d['slots'][0]['holder']['guard']" "$J")" 2>/dev/null && echo live)" live "V8: … and a live guard"
ok "$(js "d['slots'][0]['holder']['cwd'], d['slots'][0]['holder']['kind'], d['waiters']" "$J")" "('$root', 'run', [])" "V8: … its cwd and kind run; no waiters"
ok "$(js "d['dir']" "$J")" "$D/slots" "V8: … and the dir"
touch "$D/s.go"; wait "$(w s)"

# ======== V9a: the lead's verify goes before a waiting agent ===============================================
for arm in a b; do
  pool "v9$arm"
  mkdir -p "$D/tree"
  hold A 2; hold B 2
  if [ "$arm" = a ]; then
    python3 "$LI" verify --tree "$D/tree" --out "$D/lead" --slots 2 --slot-wait 600 --timeout 60 --verifier "echo lead >> '$D/order'" > /dev/null 2>&1 &
    first=lead; kind=verify
  else
    python3 "$VS" run --slots 2 --priority -- sh -c "echo integrator >> '$D/order'" > /dev/null 2>&1 &
    first=integrator; kind=run
  fi
  lp=$!; pids+=($lp)
  waiterkind() { [ "$(js "[x['kind'] for x in d['waiters']]" "$(st --slots 2)")" = "['$kind']" ]; }
  within 300 waiterkind && s=one || s="no single $kind waiter in 300 s"
  ok "$s" one "V9$arm: status shows one Integration waiter, of kind $kind"
  python3 "$VS" run --slots 2 -- sh -c "echo agent >> '$D/order'" > /dev/null 2> "$D/agent.err" &
  ap=$!; pids+=($ap)
  within 300 grepq 'waiting for one of 2' "$D/agent.err" && s=queued || s="no waiting line in 300 s"
  ok "$s" queued "V9$arm: a non-priority run waits too"
  has "$(cat "$D/agent.err")" "1 Integration waiter(s) ahead" "V9$arm: … and its waiting line names the Integration waiter ahead"
  touch "$D/A.go"
  firstline() { [ "$(head -1 "$D/order" 2>/dev/null)" = "$first" ]; }
  within 300 firstline && s=first || s="order: $(tr '\n' ' ' < "$D/order" 2>/dev/null)"
  ok "$s" first "V9$arm: the freed slot goes to the $first, not the agent"
  touch "$D/B.go"
  wait "$lp"; wait "$ap"; wait "$(w A)"; wait "$(w B)"
  ok "$(tr '\n' ' ' < "$D/order")" "$first agent " "V9$arm: $first, then agent"
  ok "$(nwaiters)" 0 "V9$arm: no waiter file left"
done

# ======== V10: stale waiter files ==========================================================================
pool v10
SL="$THREAD_VERIFY_SLOTS_DIR"; mkdir -p "$SL"
printf '{"pid": 99999, "cwd": "/x", "since": "2026-01-01T00:00:00+00:00", "kind": "verify"}\n' > "$SL/waiter-99999-x.wait"
: > "$SL/.waiter-99998-y.tmp"
python3 -c 'import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); fcntl.flock(fd, fcntl.LOCK_EX); open(sys.argv[2] + ".ready", "w").close()
while not os.path.exists(sys.argv[2]): time.sleep(0.1)' "$SL/.waiter-99997-z.tmp" "$D/lk.go" &
lk=$!; pids+=($lk)
within 300 exists "$D/lk.go.ready" || echo "FAIL - V10: the lock helper did not start"
python3 "$VS" run --slots 1 -- true 2> "$D/err"
ok "$(grep -c waiting "$D/err")" 0 "V10: a stale .wait (unlocked) holds no agent off: no waiting line"
ok "$([ -e "$SL/waiter-99999-x.wait" ] && echo left || echo reaped)|$([ -e "$SL/.waiter-99998-y.tmp" ] && echo left || echo reaped)" "reaped|reaped" "V10: … the unlocked .wait and .tmp are reaped"
ok "$([ -e "$SL/.waiter-99997-z.tmp" ] && echo kept || echo reaped)" kept "V10: … a locked .tmp (its waiter still registering) is kept"
touch "$D/lk.go"; wait "$lk"
printf '{"pid": 99996}\n' > "$SL/waiter-99996-w.wait"
J=$(st --slots 1)
ok "$(js "d['waiters']" "$J")|$(ls -A "$SL" | grep -c waiter)" "[]|0" "V10: status reaps a stale .wait and the now-unlocked .tmp: waiters []"

# ======== V11: a lead verify SIGKILLed while waiting ======================================================
pool v11
mkdir -p "$D/tree"
hold k11 1
python3 "$LI" verify --tree "$D/tree" --out "$D/lead" --slots 1 --slot-wait 600 --timeout 60 --verifier true > /dev/null 2>&1 &
lp=$!; pids+=($lp)
within 300 has_waiter && s=registered || s="no waiter file in 300 s"
ok "$s" registered "V11: the waiting lead verify registers a waiter file"
kill -KILL "$lp"; wait "$lp" 2>/dev/null
ok "$(nwaiters)|$([ -e "$D/lead.rc" ] && echo rc || echo none)" "1|none" "V11: SIGKILLed while waiting: its .wait is left (stale), no rc"
touch "$D/k11.go"; wait "$(w k11)"
python3 "$VS" run --slots 1 -- true 2> "$D/err"
ok "$(grep -c waiting "$D/err")|$(nwaiters)" "0|0" "V11: the next run reaps it and waits for nothing"

# ======== V12: a kill of the wrapper's whole process group =================================================
pool v12
python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' \
  python3 "$VS" run --slots 1 -- sh -c "echo \$\$ > '$D/g.pid'; exec sleep 3192.$u" > /dev/null 2>&1 &
gp=$!; pids+=($gp)
within 300 nonempty "$D/g.pid" || echo "FAIL - V12: the command did not start"
kill -KILL -- "-$gp"
wait "$gp" 2>/dev/null
within 60 gone "$(cat "$D/g.pid")" && s=gone || s="alive after 60 s"
ok "$s" gone "V12: kill -9 of the wrapper's process group: the guard (its own session) still ends the command"
within 60 is_free 0 1 && s=free || s="still held after 60 s"
ok "$s" free "V12: … and the slot frees"

# ======== V13: the guard SIGKILLed alone ===================================================================
pool v13
hold k 1
waiter wk "$D/k.pid"
within 300 grepq 'waiting for one of 1' "$D/wk.err" || echo "FAIL - V13: the waiter never queued"
guard=$(js "d['slots'][0]['holder']['guard']" "$(st --slots 1)")
kill -KILL "$guard"
within 60 dead "$(w k)" || echo "FAIL - V13: the wrapper did not exit within 60 s"
wait "$(w k)"; rc=$?
ok "$rc" 137 "V13: the guard SIGKILLed alone → the wrapper exits 137"
within 60 gone "$(cat "$D/k.pid")" && s=gone || s="alive after 60 s"
ok "$s" gone "V13: … after killing the reported group itself"
within 60 exists "$D/wk.ran" || echo "FAIL - V13: the waiter never ran"
ok "$(cat "$D/wk.ran" 2>/dev/null)" clean "V13: … before it released: the waiter sees no overlap"
wait "$(w wk)"

# ======== V14: release is a close ==========================================================================
pool v14
python3 -c 'import importlib.util, subprocess, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
slot = vs.acquire(1)
child = subprocess.Popen(["sh", "-c", "until [ -e \"$1\" ]; do sleep 0.1; done", "sh", sys.argv[2]], pass_fds=(slot.fd,))
slot.release()
open(sys.argv[2] + ".ready", "w").close()
sys.exit(child.wait())' "$VS" "$D/c.go" &
hp=$!; pids+=($hp)
within 300 exists "$D/c.go.ready" || echo "FAIL - V14: the harness did not start"
ok "$(slot_state 0 1)" held "V14: after release() a live co-holder of the same description keeps the slot held (a close, not LOCK_UN)"
touch "$D/c.go"
within 60 is_free 0 1 && s=free || s="still held after 60 s"
ok "$s" free "V14: … and it frees once the co-holder exits"
wait "$hp"

# ======== V15: a failure injected after the spawn ===========================================================
pool v15
cat > "$D/harness.py" <<'PY'
import importlib.util, os, sys, time
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
d = sys.argv[2]
def bad(slot, rec):
    end = time.monotonic() + 300
    while time.monotonic() < end and not (os.path.exists(os.path.join(d, "c.pid")) and os.path.exists(os.path.join(d, "c.gate"))):
        time.sleep(0.05)
    raise OSError("injected")
vs.write_holder = bad
sys.exit(vs.main(["run", "--slots", "1", "--", "sh", "-c", "trap '' TERM; echo $$ > c.pid; until [ -e c.go ]; do sleep 0.1; done"]))
PY
(cd "$D" && exec python3 "$D/harness.py" "$VS" "$D") > /dev/null 2> "$D/harness.err" &
hp=$!; pids+=($hp)
within 300 nonempty "$D/c.pid" || echo "FAIL - V15: the command did not start"
waiter wc "$D/c.pid"
within 300 grepq 'waiting for one of 1' "$D/wc.err" && s=queued || s="no waiting line in 300 s"
ok "$s" queued "V15: a waiter queues behind the run"
touch "$D/c.gate"
wait "$hp"; rc=$?
ok "$rc" 1 "V15: the injected OSError after the spawn → the wrapper exits 1"
has "$(cat "$D/harness.err")" "injected" "V15: … naming it"
within 60 exists "$D/wc.ran" && s=ran || s="the waiter never ran in 60 s"
ok "$s" ran "V15: the waiter gets the slot once the guard is done"
ok "$(cat "$D/wc.ran" 2>/dev/null)" clean "V15: … only after the TERM-ignoring command is gone: the guard kept the slot held"
ok "$(dead "$(cat "$D/c.pid")" && echo reaped || echo present)" reaped "V15: … killed and reaped by the guard"
wait "$(w wc)"
within 60 is_free 0 1 && s=free || s="still held after 60 s"
ok "$s" free "V15: … and the slot is free afterwards"

# ======== V16: no code unlocks; the header's contract ======================================================
ok "$(grep -rn 'fcntl\.LOCK_UN' skills hooks)" "" "V16: no script calls fcntl.LOCK_UN (a release is a close)"
has "$(sed -n '1,/^"""$/p' "$VS")" "Release closes the fd and never calls LOCK_UN" "V16: verify-slot.py's header states the close-only contract"

echo; [ "$fail" -eq 0 ] && echo "verify-slot: ALL PASS" || echo "verify-slot: SOME FAILED"
exit "$fail"
