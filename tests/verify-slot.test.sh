#!/usr/bin/env bash
# p23-4, executed: skills/execute/scripts/verify-slot.py, the machine-wide verify slots and the guard that ends a
# killed holder's suite before its verify slot frees, with lead-integrate.py's `verify --slots N --slot-wait S` where
# an arm crosses into it.
#   V1  rc and stdout pass through, no waiting line   V2  the cap: at most N of eight runs (six `run`, two lead
#   verifies) at once, all eight ran   V3  a wrapper SIGKILLed while its TERM-ignoring command runs: the waiter
#   behind it sees no overlap   V4  a command's background leftover holds no slot and is not killed   V5  TERM to
#   `run` (holding: 143; waiting with --priority: 76, no verdict, p32-1)   V6  usage   V7  the dir chain; an unusable
#   dir fails open
#   V8  status   V9a the lead's verify goes before a waiting agent   V9b so does `run --priority`   V10 stale
#   waiter files are reaped, a locked one is not   V11 a lead verify SIGKILLed while waiting leaves a stale waiter
#   file, reaped next   V12 a kill of the wrapper's whole process group   V13 the guard SIGKILLed alone   V14
#   release is a close (a co-holder keeps the slot)   V15 a failure injected after the spawn: the slot stays held
#   until the suite's group is gone   V16 no code calls fcntl.LOCK_UN; the header's close-only contract   V17 the
#   bounded slot wait (p32-1): `--slot-wait S` (or `=S`) runs out → 76 and a no-verdict line, the command never run;
#   `--slot-wait 0` is one try, and a free slot is still taken   V18 a bad `--slot-wait` is usage (exit 2)   V19 with
#   no `--slot-wait`, `run` waits RUN_SLOT_WAIT (4800 s), reconcile-rollout.py's _slot_wait at the default 1800. The Run record
#   (p29-10, contract item 8): VR1 a suite in a task tree records its start and end (sha, load, count, failing), its
#   output still split   VR2 --priority   VR3 TERM ends it stopped, the slot free; a SIGKILL leaves no ended line
#   VR4 no task tree or no note: no record, as today   VR5 a dirty tree   VR6 a green run names no failing   VR7 a
#   TERM while suite-started walks the vault: never swallowed (76, no verdict: the suite never runs, no line, the slot
#   free)   VR7b a TERM after the suite-started line, before the spawn: 76, a stopped line with no rc, the slot free.
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
export THREAD_NOTE_LOCK_DIR="${tmp}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"                          # never the machine's real pool
export THREAD_VERIFY_SLOT_POLL=0.1
export THREAD_HEAT_LEVEL=0                                           # the Heat hold's reading, pinned (tests/verify-slot-heat.test.sh unpins it)
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
# the slot (overlap) or not (clean) in <name>.ran; its wrapper pid goes to <name>.w. The redirection creates
# <name>.ran before the check writes it, so callers wait for it to be non-empty, never merely to exist.
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
within 60 nonempty "$D/wr.ran" && s=ran || s="the waiter never ran in 60 s"
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
ok "$rc|$([ -e "$D/t3.ran" ] && echo ran || echo never)|$(nwaiters)" "76|never|0" "V5: TERM to it while waiting → 76 (no verdict, never red), the command never ran, no waiter file left"
has "$(cat "$D/t3.err")" "verify-slot: no verdict: stopped before the suite started; exit 76" "V5: … with its no-verdict line"
touch "$D/t2.go"; wait "$(w t2)"

# ======== V6: usage ========================================================================================
pool v6
for a in "--slots 0 -- true" "--slots -1 -- true" "--slots abc -- true" "--slots 1.5 -- true" "--slots +1 -- true" "--slots 1_0 -- true" "--slots 1 true" \
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
within 60 nonempty "$D/wk.ran" || echo "FAIL - V13: the waiter never ran"
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
within 60 nonempty "$D/wc.ran" && s=ran || s="the waiter never ran in 60 s"
ok "$s" ran "V15: the waiter gets the slot once the guard is done"
ok "$(cat "$D/wc.ran" 2>/dev/null)" clean "V15: … only after the TERM-ignoring command is gone: the guard kept the slot held"
ok "$(dead "$(cat "$D/c.pid")" && echo reaped || echo present)" reaped "V15: … killed and reaped by the guard"
wait "$(w wc)"
within 60 is_free 0 1 && s=free || s="still held after 60 s"
ok "$s" free "V15: … and the slot is free afterwards"

# ======== V16: no code unlocks; the header's contract ======================================================
ok "$(grep -rn 'fcntl\.LOCK_UN' skills hooks)" "" "V16: no script calls fcntl.LOCK_UN (a release is a close)"
has "$(sed -n '1,/^"""$/p' "$VS")" "Release closes the fd and never calls LOCK_UN" "V16: verify-slot.py's header states the close-only contract"

# ======== V17: the bounded slot wait (p32-1) =================================================================
# An agent's `run` bounds its own slot wait (RUN_SLOT_WAIT, 4800 s, by default): once it runs out, no verdict (76), the
# command never run. `--slot-wait 0` is one try, as lead-integrate.py's `verify --slot-wait 0`.
pool v17
hold h 1
python3 "$VS" run --slots 1 --slot-wait 1 -- touch "$D/a.ran" > /dev/null 2> "$D/a.err"; rc=$?
ok "$rc|$([ -e "$D/a.ran" ] && echo ran || echo never)" "76|never" "V17: --slot-wait 1 behind a held slot → 76, the command never ran"
has "$(cat "$D/a.err")" "verify-slot: no verdict: no verify slot within 1s; exit 76" "V17: … with its no-verdict line"
ok "$(awk '/waiting for one of 1 verify slots/{a=NR} /no verdict: no verify slot within 1s/{b=NR} END{print (a && b && a < b) ? "y" : "n"}' "$D/a.err")" y \
  "V17: … after its waiting line"
python3 "$VS" run --slots 1 --slot-wait=1 --priority -- touch "$D/b.ran" > /dev/null 2> "$D/b.err"; rc=$?
ok "$rc|$([ -e "$D/b.ran" ] && echo ran || echo never)|$(nwaiters)" "76|never|0" "V17: --slot-wait=1 --priority → 76, never ran, no waiter file left"
has "$(cat "$D/b.err")" "verify-slot: no verdict: no verify slot within 1s; exit 76" "V17: … with its no-verdict line"
python3 "$VS" run --slots 1 --slot-wait 0 -- touch "$D/c.ran" > /dev/null 2> "$D/c.err"; rc=$?
ok "$rc|$([ -e "$D/c.ran" ] && echo ran || echo never)|$(grep -c 'waiting' "$D/c.err")" "76|never|0" "V17: --slot-wait 0 behind a held slot → 76 at once, never ran, no waiting line"
has "$(cat "$D/c.err")" "verify-slot: no verdict: no verify slot within 0s; exit 76" "V17: … with its no-verdict line"
touch "$D/h.go"; wait "$(w h)"
python3 "$VS" run --slots 1 --slot-wait 0 -- sh -c 'exit 3' 2> "$D/d.err"; rc=$?
ok "$rc|$(grep -c 'no verdict' "$D/d.err")" "3|0" "V17: --slot-wait 0 with the slot free: one try takes it, the command's rc (3) passes through"

# ======== V18: --slot-wait usage =============================================================================
pool v18
# Only ASCII digits (p32-1): int() alone would take a sign, an underscore and a non-ASCII digit.
for v in -1 abc 1.5 ' 2' '2 ' '' -- +1 1_0 '٣'; do
  python3 "$VS" run --slots 1 --slot-wait "$v" -- touch "$D/ran" > /dev/null 2>&1; rc=$?
  ok "$rc|$([ -e "$D/ran" ] && echo ran || echo never)" "2|never" "V18: run --slot-wait '$v' → exit 2"
done
for a in --slot-wait= --slot-wait=-1 --slot-wait=x --slot-wait=+1 --slot-wait=1_0; do
  python3 "$VS" run --slots 1 "$a" -- touch "$D/ran" > /dev/null 2>&1; ok "$?" 2 "V18: run $a → exit 2"
done
python3 "$VS" run --slots 1 --slot-wait > /dev/null 2>&1; ok "$?" 2 "V18: run --slot-wait with no value → exit 2"

# ======== V19: run's default slot wait (p32-1) ================================================================
# The engine renders no `--slot-wait`, so RUN_SLOT_WAIT is an agent's whole bound. `run` with none waits 4800 s, which
# is the lead's `slotWait` at the default `verify_timeout` (reconcile-rollout.py's _slot_wait(1800)), so the documented
# tie cannot drift. Loaded by importlib (-B: no bytecode beside either script); _parse_run returns (slots, prio, cmd, wait).
got=$(python3 -B - "$VS" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1])
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)
rr = vs._load_reconcile()
wait = vs._parse_run(["--slots", "1", "--", "true"])[3]
print(f"{wait}|{rr._slot_wait(1800)}|{rr._slot_wait(rr.DEFAULT_VERIFY_TIMEOUT)}|{vs.RUN_SLOT_WAIT}")
PY
)
ok "$got" "4800|4800|4800|4800" "V19: run with no --slot-wait waits 4800 s, the lead's slotWait at the default verify_timeout (1800)"

# ======== VR1–VR6: a suite in a task tree records itself in the Run record (contract item 8; p29-10) ===============
# A git project R with its task tree at R/.claude/worktrees/t1, and a vault (under VH, the HOME these runs use) where t1
# is in_progress in r1, a started parallel rollout: so its suites land in r1's record, with a Mac-wide count of 1.
pool vr
VH="$D/home"; VT="$VH/repos/obsidian/Work/Tasks"; VEV="$D/events"; mkdir -p "$VT"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n## Queue\n\n- [[t1]]\n' > "$VT/r1.md"
printf -- '---\ntags: [task]\nstatus: in_progress\nowner: lead-1\nrollout: "[[r1]]"\n---\n\nt1\n' > "$VT/t1.md"
R="$D/r"; git -c init.defaultBranch=main init -q "$R"
printf 'a\n' > "$R/a.txt"; git -C "$R" add a.txt; git -C "$R" -c user.name=t -c user.email=t@t commit -q -m a
git -C "$R" worktree add -q "$R/.claude/worktrees/t1" -b t1 >/dev/null 2>&1
TREE="$R/.claude/worktrees/t1"; HEAD1=$(git -C "$TREE" rev-parse HEAD)
mkdir -p "$R/.claude/worktrees/t2"   # a task tree whose note does not exist
vrun() {  # vrun <cwd> <out> <err> [--priority] -- <cmd…>: run, with the vault's HOME and the record under VEV
  local cwd="$1" o="$2" e="$3"; shift 3
  (cd "$cwd" && HOME="$VH" THREAD_EVENTS_DIR="$VEV" exec python3 "$VS" run --slots 1 "$@") > "$o" 2> "$e"
}
recq() {  # recq <python expr over L, r1's record lines>
  python3 - "$VEV/r1.jsonl" "$1" <<'PY2'
import json, sys
try:
    L = [json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
except FileNotFoundError:
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY2
}
vrun "$TREE" "$D/vr1.out" "$D/vr1.err" -- sh -c 'echo out-line; echo "FAILED tests/a.py::t - boom"; echo err-line >&2; exit 1'; rc=$?
ok "$rc" 1 "VR1: the suite's rc passes through"
ok "$(cat "$D/vr1.out")" "out-line
FAILED tests/a.py::t - boom" "VR1: its stdout still reaches the caller's stdout, and only it"
ok "$(grep -v '^verify-slot' "$D/vr1.err")" "err-line" "VR1: its stderr still reaches the caller's stderr"
ok "$(recq '[d["kind"] for d in L]')" '["suite-started","suite-ended"]' "VR1: a suite-started and a suite-ended"
ok "$(recq '[L[0]["task"], L[0]["by"], L[0]["runner"], L[0]["sha"], L[0]["dirty"], len(L[0]["load"]), L[0]["running"] >= 1, "diff" in L[0]]')" \
  "[\"t1\",\"task\",\"agent\",\"$HEAD1\",false,3,true,false]" "VR1: started: task t1, by task, runner agent, the tree's sha, clean, the load, the running count"
ok "$(recq '[L[1]["suite"] == L[0]["suite"], L[1]["outcome"], L[1]["rc"], L[1]["failing"], isinstance(L[1]["seconds"], (int, float)), len(L[1]["load"]), "running" in L[1]]')" \
  '[true,"red",1,["tests/a.py::t"],true,3,true]' "VR1: ended: the same suite, red, rc 1, the printed failing id, its seconds, the load and the count"

: > "$VEV/r1.jsonl"
vrun "$TREE" "$D/vr2.out" "$D/vr2.err" --priority -- sh -c 'exit 0'
ok "$(recq '[d["by"] for d in L]')" '["integration","integration"]' "VR2: --priority is the integrate call's suite: by integration"

: > "$VEV/r1.jsonl"
(cd "$TREE" && HOME="$VH" THREAD_EVENTS_DIR="$VEV" exec python3 "$VS" run --slots 1 -- sh -c "echo \$\$ > '$D/vr3.pid'; sleep 3$u") > "$D/vr3.out" 2> "$D/vr3.err" &
vp=$!; pids+=($vp)
within 300 grepq suite-started "$VEV/r1.jsonl" || echo "FAIL - VR3: no suite-started within 300 s"
within 300 nonempty "$D/vr3.pid" || echo "FAIL - VR3: the suite did not start"
kill -TERM "$vp"; wait "$vp"; rc=$?
ok "$rc" 143 "VR3: TERM to run: exit 143"
ok "$(slot_state 0 1)" free "VR3: the slot is free right after the exit"
ok "$(recq '[[d["kind"], d.get("outcome"), d.get("rc"), "running" in d, "failing" in d] for d in L]')" \
  '[["suite-started",null,null,true,false],["suite-ended","stopped",143,false,false]]' "VR3: ended stopped, rc 143, no running and no failing"
: > "$VEV/r1.jsonl"
(cd "$TREE" && HOME="$VH" THREAD_EVENTS_DIR="$VEV" exec python3 "$VS" run --slots 1 -- sh -c "echo \$\$ > '$D/vr3k.pid'; sleep 3$u") > "$D/vr3k.out" 2> "$D/vr3k.err" &
vp=$!; pids+=($vp)
within 300 grepq suite-started "$VEV/r1.jsonl" || echo "FAIL - VR3: no suite-started within 300 s (SIGKILL arm)"
within 300 nonempty "$D/vr3k.pid" || echo "FAIL - VR3: the suite did not start (SIGKILL arm)"
kill -KILL "$vp"; wait "$vp" 2>/dev/null
within 60 is_free 0 1 || echo "FAIL - VR3: the guard did not free the slot after a SIGKILL"
ok "$(recq '[d["kind"] for d in L]')" '["suite-started"]' "VR3: a SIGKILL leaves a started line with no ended line"

: > "$VEV/r1.jsonl"
vrun "$D" "$D/vr4.out" "$D/vr4.err" -- sh -c 'echo plain; exit 4'; rc=$?
ok "$rc|$(cat "$D/vr4.out")" "4|plain" "VR4: outside a task tree: the rc and stdout as today"
vrun "$R/.claude/worktrees/t2" "$D/vr4b.out" "$D/vr4b.err" -- sh -c 'echo plain; exit 0'; rc=$?
ok "$rc|$(cat "$D/vr4b.out")" "0|plain" "VR4: a task tree with no note: as today"
ok "$(recq 'len(L)')" 0 "VR4: neither writes a record"

: > "$VEV/r1.jsonl"
printf 'a changed\n' > "$TREE/a.txt"
vrun "$TREE" "$D/vr5.out" "$D/vr5.err" -- sh -c 'exit 0'
ok "$(recq '[L[0]["dirty"], len(L[0].get("diff", "")), all(c in "0123456789abcdef" for c in L[0].get("diff", "x"))]')" '[true,12,true]' "VR5: a dirty tree: dirty true and a 12-hex diff"
git -C "$TREE" checkout -q -- a.txt

: > "$VEV/r1.jsonl"
vrun "$TREE" "$D/vr6.out" "$D/vr6.err" -- sh -c 'echo "FAILED tests/never.py::x"; exit 0'
ok "$(recq '[L[1]["outcome"], L[1]["rc"], "failing" in L[1]]')" '["green",0,false]' "VR6: a green run carries no failing"

# VR7: the stop lands inside suite-started's vault walk (the running count), with the slot held: a TaskStop or a hard
# pause there must end the run, never be swallowed by the walk's best-effort count and run the suite green.
: > "$VEV/r1.jsonl"
cat > "$D/vr7.py" <<'PY2'
import importlib.util, os, signal, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1])
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)
load = vs._load_reconcile
def stopped_in_the_walk():
    rr = load()
    walk = rr._note_index
    def index(tasks_dir):   # the TERM lands as suite-started walks the vault for its running count
        os.kill(os.getpid(), signal.SIGTERM)
        return walk(tasks_dir)
    rr._note_index = index
    return rr
vs._load_reconcile = stopped_in_the_walk
sys.exit(vs.main(["run", "--slots", "1", "--"] + sys.argv[2:]))
PY2
(cd "$TREE" && HOME="$VH" THREAD_EVENTS_DIR="$VEV" exec python3 "$D/vr7.py" "$VS" sh -c "touch '$D/vr7.ran'") > "$D/vr7.out" 2> "$D/vr7.err"; rc=$?
ok "$rc" 76 "VR7: a TERM in suite-started's vault walk: exit 76 (no verdict), never swallowed"
has "$(cat "$D/vr7.err")" "verify-slot: no verdict: stopped before the suite started; exit 76" "VR7: … with its no-verdict line"
ok "$([ -e "$D/vr7.ran" ] && echo ran || echo never)" never "VR7: the suite never ran"
ok "$(recq '[d["kind"] for d in L]')" '[]' "VR7: no line: no suite-started, no green suite-ended"
ok "$(slot_state 0 1)" free "VR7: the slot is free"

# VR7b (p32-1): the stop lands after suite-started is written and before the guard spawns the suite (Guarded's own
# __init__ sends it): no verdict (76), and the started line gets its ended line, `stopped` with no rc (the suite never ran).
: > "$VEV/r1.jsonl"
cat > "$D/vr7b.py" <<'PY2'
import importlib.util, os, signal, sys, time
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1])
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)
Real = vs.Guarded
class StoppedFirst(Real):
    def __init__(self, *a, **k):   # the TERM lands before the spawn; the sleep is where the stop is raised
        os.kill(os.getpid(), signal.SIGTERM)
        time.sleep(30)
        super().__init__(*a, **k)
vs.Guarded = StoppedFirst
sys.exit(vs.main(["run", "--slots", "1", "--"] + sys.argv[2:]))
PY2
(cd "$TREE" && HOME="$VH" THREAD_EVENTS_DIR="$VEV" exec python3 "$D/vr7b.py" "$VS" sh -c "touch '$D/vr7b.ran'") > "$D/vr7b.out" 2> "$D/vr7b.err"; rc=$?
ok "$rc" 76 "VR7b: a TERM after suite-started, before the spawn: exit 76 (no verdict)"
has "$(cat "$D/vr7b.err")" "verify-slot: no verdict: stopped before the suite started; exit 76" "VR7b: … with its no-verdict line"
ok "$([ -e "$D/vr7b.ran" ] && echo ran || echo never)" never "VR7b: the suite never ran"
ok "$(recq '[[d["kind"], d.get("outcome"), "rc" in d] for d in L]')" '[["suite-started",null,false],["suite-ended","stopped",false]]' \
  "VR7b: a suite-started, then a suite-ended stopped with no rc"
ok "$(slot_state 0 1)" free "VR7b: the slot is free"

echo; [ "$fail" -eq 0 ] && echo "verify-slot: ALL PASS" || echo "verify-slot: SOME FAILED"
exit "$fail"
