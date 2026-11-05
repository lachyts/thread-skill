#!/usr/bin/env bash
# p31-4, executed (estate ADR 0009 d5): the Heat hold in skills/execute/scripts/verify-slot.py (`run`) and in
# lead-integrate.py's `verify --slots N --slot-wait W`. At heavy (2) no slot is free; at trapping or sleeping (3+) a
# running slotted suite is stopped through its guard and put back in line, to restart from the beginning once the level
# falls below heavy. A heat stop is never red: `run` exits 76 only when stopped while the Mac is hot, and verify's
# no-verdict word is `heat` (exit 76), its total wait bounded by --slot-wait.
#   R0  the reading (the pin, notifyutil, fail-open)   R1  pinned heavy: never starts; a TERM exits 76   R2  heavy
#   mid-run never stops a suite   R3  trapping mid-run stops it, back in line, restart once cool   R4  a TERM back in
#   line exits 76   R5  a restarted suite's own red is the verdict   R6  the exit race (a unit harness on watch)
#   R7  a SlotDirError at the re-acquire runs the restart unslotted and unwatched   R8  pinned heavy with `--slot-wait 1`
#   (and `=1`): no slot within it → 76, never started, its no-verdict line names the heat   R9  one total deadline across
#   a heat stop (p32-1): a re-queue with no time left makes no try, so no heat wait line after the stop, 76; its control
#   (`--slot-wait 600`) waits after the stop and restarts once cool
#   L1  verify pinned heavy: rc heat, exit 76   L2  … with --outcome   L3  a held slot at nominal is still noslot
#   L4  trapping during the verifier: back in line, restart green   L5  … with --slot-wait 0: heat, one start
#   L6  a heat stop in the env_bootstrap: a clean restart, the outcome file has no stale key   L7  a SlotDirError at the
#   re-acquire: unslotted, unwatched, green.
#   The Run record (p29-10, ADR 0051): HR1 a recorded `run` in a task tree, its output piped: a heat stop ends its suite
#   heat (no rc) and the restart is a fresh suite, green   HR1b R9 in a task tree (p32-1): a heat stop past `--slot-wait 1`
#   ends the suite heat and makes no try, 76, no second suite   HR2 verify --rollout: the same as HR1 for the lead's
#   suite (its step named)   HR3 verify --rollout pinned heavy: only a suite-ended heat with its wait.
#   The Flake check (p29-9, ADR 0050): L8 a heat stop in its named re-run: back in line, every step reruns, the Flake and
#   the flake record the last pass's.
#   The Capacity stop (p36-10, ADR 0067 d8; verify-slot.py contract 7): a fresh capacity.json whose `signals.stop_suites`
#   is JSON true holds and stops slotted suites as the Heat hold does. M0 the reading (capacity_stop(), capacity.py's
#   read() and suite_stop(), fail-open)   M1 a fresh stop: never starts; a TERM exits 76   M2 a fresh stop mid-run stops
#   it, back in line, restart once clear (a fresh green file runs it)   M3 a stale stop stops nothing   M4 a fresh stop
#   with `--slot-wait 1`: 76, never started   M5 heat first: at trapping the heat lines win   MW the stop's unit harness
#   on Guarded.watch   MH1 the Run record: a capacity stop ends its suite heat (no rc), the restart a fresh suite
#   ML1 lead-integrate verify: a capacity stop during the verifier, back in line, restart green   ML2 … pinned stop with
#   --slot-wait 1: rc heat, exit 76.
# Structural, never a stopwatch (p22-1): holders hold until a `.go` file appears; the stub notifyutil reads the level
# from <arm>/out and appends one line per read to <arm>/reads, so "N more reads" is the clock; every wait is a
# `within <s>` poll whose bound only slows a real failure. Every background pid is recorded and stopped only by it.
# Hermetic: every pool lives under mktemp (THREAD_VERIFY_SLOTS_DIR), the heat is pinned at 0 (THREAD_HEAT_LEVEL) but
# where an arm unsets it to read its own stub, and HOME is a temp dir with no capacity.json but where an arm writes its
# own (so a standalone run never reads the Mac's real Capacity).
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd -P)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export PYTHONDONTWRITEBYTECODE=1

tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P)
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$tmp/events}"   # the Run record stays in temp
export THREAD_NOTE_LOCK_DIR="${tmp}/note-locks"                      # the note save lock stays in temp too
export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"                          # never the machine's real pool
export THREAD_VERIFY_SLOT_POLL=0.1
export THREAD_HEAT_LEVEL=0                                           # never the Mac's real heat, but where an arm reads its stub
export HOME="$tmp/home"; mkdir -p "$HOME"                            # never the Mac's real capacity.json, but where an arm writes its own
H0=$HOME
VS="$root/skills/execute/scripts/verify-slot.py"
LI="$root/skills/execute/scripts/lead-integrate.py"
PY=$(command -v python3)

pids=()
cleanup() {
  local p
  touch "$tmp"/*/*.go 2>/dev/null
  for p in "${pids[@]}"; do kill -TERM "$p" 2>/dev/null; done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null; done
  rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -p "$tmp/bin" "$tmp/empty"
cat > "$tmp/bin/notifyutil" <<'SH'
#!/bin/sh
echo r >> "$HEAT_D/reads"
cat "$HEAT_D/out" 2>/dev/null
exit "$(cat "$HEAT_D/rc" 2>/dev/null || echo 0)"
SH
chmod +x "$tmp/bin/notifyutil"

within() { local end=$((SECONDS + $1)); shift; until "$@" 2>/dev/null; do [ "$SECONDS" -ge "$end" ] && return 1; sleep 0.1; done; }
alive() { local s; kill -0 "$1" 2>/dev/null && s=$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ') && [ -n "$s" ] && [ "${s#Z}" = "$s" ]; }
gone() { ! alive "$1"; }
nonempty() { [ -s "$1" ]; }
grepq() { grep -q -- "$1" "$2"; }
lacks() { case "$1" in *"$2"*) ok "[$1]" "no '$2'" "$3";; *) ok y y "$3";; esac; }
count() { if [ -s "$1" ]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }
atleast() { [ "$(count "$1")" -ge "$2" ]; }

# arm <name>: a fresh arm dir D, its own pool, the stub at nominal.
arm() { echo "== $1"; D="$tmp/$1"; mkdir -p "$D"; export THREAD_VERIFY_SLOTS_DIR="$D/slots"; level 0; }
# level <out>: what the stub prints next (a bare number becomes notifyutil's line), written atomically.
level() {
  case "$1" in [0-9]|-[0-9]) printf 'com.apple.system.thermalpressurelevel %s\n' "$1" > "$D/out.tmp";; *) printf '%s\n' "$1" > "$D/out.tmp";; esac
  mv "$D/out.tmp" "$D/out"
}
# hot <cmd…>: <cmd> reading the stub (the pin unset), with the arm's dir for it. Foreground only: a backgrounded
# command runs `env …` itself, so $! is its own pid, never a subshell's.
hot() { env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" "$@"; }
# more <n>: wait for n more stub reads (the clock).
more() { local want=$(( $(count "$D/reads") + $1 )); within 120 atleast "$D/reads" "$want"; }
js() { python3 -c 'import json,sys; d=json.loads(sys.argv[2]); print(eval(sys.argv[1]))' "$1" "$2"; }
st() { python3 "$VS" status "$@"; }
is_free() { [ "$(js "d['slots'][0]['state']" "$(st --slots 1)")" = free ]; }
# HOLD: a command that records each start in <arm>/starts, its pid in <arm>/c.pid, and holds until <arm>/c.go.
hold_cmd() { printf "echo x >> '%s/starts'; echo \$\$ > '%s/c.pid'; until [ -e '%s/c.go' ]; do sleep 0.1; done" "$D" "$D" "$D"; }
# runbg <cmd> [run flags…]: a `run --slots 1 [flags…] -- sh -c <cmd>` in the background reading the stub; its pid in $W
# and pids.
runbg() { local c="$1"; shift; env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$VS" run --slots 1 "$@" -- sh -c "$c" > "$D/out.txt" 2> "$D/err" & W=$!; pids+=($W); }
started() { within 120 atleast "$D/starts" "$1"; }
# ticker: an unslotted run reads no heat, so R7 and L7 clock on a ticker of their own that runs the stub every 0.1 s:
# 12 more reads are more than two of a watch's 0.5 s heat polls.
tick() { ( while :; do HEAT_D="$D" "$tmp/bin/notifyutil" > /dev/null; sleep 0.1; done ) & TK=$!; pids+=($TK); }
untick() { kill "$TK" 2>/dev/null; wait "$TK" 2>/dev/null; }

# ======== R0: the reading ===================================================================================
arm r0
cat > "$tmp/rd.py" <<'PY2'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
print(vs.heat_level())
PY2
rd() { "$PY" "$tmp/rd.py" "$VS"; }
level 1
ok "$(THREAD_HEAT_LEVEL=3 PATH="$tmp/bin:$PATH" HEAT_D="$D" "$PY" "$tmp/rd.py" "$VS")|$(count "$D/reads")" "3|0" "R0: a pin of 3 reads 3, and notifyutil is never run"
for p in x 5 -1 ''; do
  ok "$(THREAD_HEAT_LEVEL="$p" PATH="$tmp/bin:$PATH" HEAT_D="$D" "$PY" "$tmp/rd.py" "$VS")" 1 "R0: a pin of '$p' is ignored: the stub's 1 is read"
done
ok "$(count "$D/reads")" 4 "R0: … each ignored pin ran notifyutil once"
level 2; ok "$(hot "$PY" "$tmp/rd.py" "$VS")" 2 "R0: notifyutil's level 2 reads 2"
level garbage; ok "$(hot "$PY" "$tmp/rd.py" "$VS")" 0 "R0: output it cannot parse reads 0 (fail open)"
level 3; echo 1 > "$D/rc"; ok "$(hot "$PY" "$tmp/rd.py" "$VS")" 0 "R0: a non-zero exit reads 0"
rm -f "$D/rc"
level 7; ok "$(hot "$PY" "$tmp/rd.py" "$VS")" 4 "R0: 7 is clamped to 4"
level -2; ok "$(hot "$PY" "$tmp/rd.py" "$VS")" 0 "R0: a negative level is clamped to 0"
ok "$(env -u THREAD_HEAT_LEVEL PATH="$tmp/empty" "$PY" -c 'import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
vs.NOTIFYUTIL = sys.argv[2]
print(vs.heat_level())' "$VS" "$D/absent")" 0 "R0: no notifyutil on PATH and the fallback absent reads 0"
ok "$(env -u THREAD_HEAT_LEVEL "$PY" -c 'import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
vs.shutil.which = lambda *a, **k: sys.argv[2]
print(vs.heat_level())' "$VS" "$D/absent")" 0 "R0: a notifyutil that cannot be started reads 0"
printf '#!/bin/sh\nexec sleep 30\n' > "$D/slow"; chmod +x "$D/slow"
t0=$SECONDS
ok "$(env -u THREAD_HEAT_LEVEL "$PY" -c 'import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
vs.shutil.which = lambda *a, **k: sys.argv[2]
print(vs.heat_level())' "$VS" "$D/slow")" 0 "R0: a notifyutil that hangs reads 0 (its timeout)"
ok "$([ $((SECONDS - t0)) -lt 20 ] && echo bounded || echo "took $((SECONDS - t0)) s")" bounded "R0: … bounded well under the hang"
ok "$(THREAD_HEAT_LEVEL=3 "$PY" -c 'import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
print([vs.heat_name(n) for n in range(5)], vs.HEAT_HOLD, vs.HEAT_STOP, vs.HEAT_EXIT)' "$VS")" \
  "['nominal', 'moderate', 'heavy', 'trapping', 'sleeping'] 2 3 76" "R0: the names, the hold at 2, the stop at 3, exit 76"

# ======== R1: pinned heavy: no slot; a TERM exits 76 ======================================================
arm r1
THREAD_HEAT_LEVEL=2 python3 "$VS" run --slots 1 -- sh -c "echo x >> '$D/starts'" > /dev/null 2> "$D/err" &
W=$!; pids+=($W)
within 120 grepq 'verify-slot: waiting (heat: heavy)' "$D/err" && s=waiting || s="no heat line in 120 s"
ok "$s" waiting "R1: pinned heavy, run waits with a 'waiting (heat: heavy)' line"
J=$(THREAD_HEAT_LEVEL=2 python3 "$VS" status --slots 1)
ok "$(js "d['slots'][0]['state'], d['heat']" "$J")" "('free', {'level': 2, 'name': 'heavy'})" "R1: status shows the slot free and heat 2 heavy"
kill -TERM "$W"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "76|0" "R1: a TERM while heat-held exits 76, the command never run"
has "$(cat "$D/err")" "verify-slot: no verdict: stopped while the Mac was hot (heat: heavy); exit 76" "R1: … with its no-verdict line"
ok "$(grep -c 'waiting (heat: heavy)' "$D/err")" 1 "R1: the heat line is said once while the reason holds"
J=$(python3 "$VS" status --slots 1)
ok "$(js "d['heat']" "$J")" "{'level': 0, 'name': 'nominal'}" "R1: status's heat key follows the reading (pinned 0)"

# ======== R2: heavy mid-run never stops a suite ===========================================================
arm r2
runbg "$(hold_cmd)"
started 1 || echo "FAIL - R2: the command did not start"
level 2; more 3
ok "$(alive "$(cat "$D/c.pid")" && echo alive || echo gone)" alive "R2: heavy for 3 more reads: the running suite is not stopped"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "0|1" "R2: it finishes: exit 0, one start"
lacks "$(cat "$D/err")" "heat stop" "R2: … no heat stop"

# ======== R3: trapping mid-run stops it; back in line; restart once cool ==================================
arm r3
runbg "$(hold_cmd)"
started 1 || echo "FAIL - R3: the command did not start"
p1=$(cat "$D/c.pid")
level 3
within 120 gone "$p1" && s=gone || s="alive after 120 s"
ok "$s" gone "R3: trapping: the running suite is ended"
within 120 grepq 'waiting (heat: trapping)' "$D/err" || echo "FAIL - R3: no waiting line"
ok "$(is_free && echo free || echo held)" free "R3: … its verify slot is free while it waits"
E=$(cat "$D/err")
has "$E" "verify-slot: heat stop (trapping): ended the suite after" "R3: stderr names the heat stop"
has "$E" "no verdict, never red: back in line to restart from the beginning once the Mac cools" "R3: … no verdict, back in line"
ok "$(awk '/heat stop \(trapping\)/{a=NR} /waiting \(heat: trapping\)/{b=NR} END{print (a && b && a < b) ? "y" : "n"}' "$D/err")" y "R3: the heat stop, then the heat wait"
level 2; more 3
ok "$(count "$D/starts")" 1 "R3: heavy still holds the restart"
level 1
started 2 && s=restarted || s="no restart in 120 s"
ok "$s" restarted "R3: below heavy the suite restarts from the beginning"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "0|2" "R3: the restart's exit is the verdict: 0, two starts"

# ======== R4: a TERM back in line after a heat stop exits 76 ==============================================
arm r4
runbg "$(hold_cmd)"
started 1 || echo "FAIL - R4: the command did not start"
level 3
within 120 grepq 'waiting (heat: trapping)' "$D/err" || echo "FAIL - R4: no waiting line"
kill -TERM "$W"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "76|1" "R4: TERM back in line after a heat stop exits 76, no restart"
has "$(cat "$D/err")" "no verdict: stopped while the Mac was hot (heat: trapping); exit 76" "R4: … with its no-verdict line"
ok "$(is_free && echo free || echo held)" free "R4: … and the slot is free"

# ======== R5: heat never masks a verdict ==================================================================
arm r5
runbg "echo x >> '$D/starts'; [ -e '$D/second' ] && exit 3; echo \$\$ > '$D/c.pid'; until [ -e '$D/c.go' ]; do sleep 0.1; done"
started 1 || echo "FAIL - R5: the command did not start"
touch "$D/second"; level 3
within 120 grepq 'heat stop (trapping)' "$D/err" || echo "FAIL - R5: no heat stop"
level 0
wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "3|2" "R5: the restarted suite's red (3) is the exit"

# ======== R6: the exit race, a unit harness on Guarded.watch ===============================================
arm r6
ok "$(THREAD_HEAT_LEVEL=3 THREAD_VERIFY_SLOT_POLL=0.1 python3 -c 'import importlib.util, subprocess, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
class P:
    def __init__(self, waits):
        self.waits = list(waits)
    def wait(self, timeout=None):
        w = self.waits.pop(0)
        if w is None:
            raise subprocess.TimeoutExpired("guard", timeout)
        return w
class G(vs.Guarded):
    def __init__(self, waits):
        self.proc, self._death, self.group, self.stops = P(waits), None, None, 0
    def stop(self):
        self.stops += 1
        return 143
a = G([None, 3])
ra = a.watch()
b = G([None, None])
rb = b.watch()
print(ra, a.stops, rb is vs.HEAT_STOPPED, b.stops)' "$VS")" "3 0 True 1" \
  "R6: a guard that exits inside the settle window keeps its rc (3), stop never called; one still there is stopped once"

# ======== R7: a SlotDirError at the re-acquire: unslotted, unwatched =====================================
arm r7
runbg "$(hold_cmd)"
started 1 || echo "FAIL - R7: the command did not start"
mv "$D/slots" "$D/slots.aside"; : > "$D/slots"
level 3
started 2 && s=restarted || s="no restart in 120 s"
ok "$s" restarted "R7: after the heat stop the re-acquire fails and the restart runs at once"
has "$(cat "$D/err")" "verify-slot: WARN $D/slots" "R7: … behind the WARN naming the dir"
has "$(cat "$D/err")" "running unslotted" "R7: … that says it runs unslotted"
tick; more 12; untick
ok "$(alive "$(cat "$D/c.pid")" && echo alive || echo gone)" alive "R7: still trapping, the unslotted restart is never stopped"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")|$(grep -c 'heat stop' "$D/err")" "0|2|1" "R7: exit 0, two starts, one heat stop"

# ======== R8: pinned heavy with a bounded slot wait (p32-1) ===============================================
arm r8
for f in "--slot-wait 1" "--slot-wait=1"; do
  : > "$D/err"
  THREAD_HEAT_LEVEL=2 python3 "$VS" run --slots 1 $f -- sh -c "echo x >> '$D/starts'" > /dev/null 2> "$D/err"; rc=$?
  ok "$rc|$(count "$D/starts")" "76|0" "R8 ($f): heavy for the whole wait: exit 76, the command never started"
  ok "$(grep -c 'verify-slot: waiting (heat: heavy)' "$D/err")" 1 "R8 ($f): … one heat wait line"
  has "$(cat "$D/err")" "verify-slot: no verdict: no verify slot within 1s (heat: heavy); exit 76" "R8 ($f): … then its no-verdict line naming the heat"
done

# ======== R9: one total deadline across a heat stop (p32-1) ================================================
# The suite runs for more than the 1 s wait (5 more stub reads: at least 4 of watch's heat polls, 0.5 s apart), then a
# heat stop puts it back in line with no time left: it makes no try, so it prints no heat wait line after the stop (a
# deadline fresh per pass would print one at its first miss, since acquire says it before its max_wait return). No
# timing upper bound: the line's absence tells the two apart, and the control below shows it is not vacuous.
after_stop() { awk '/heat stop \(trapping\)/{s=1; next} s && /waiting \(heat: trapping\)/{n++} END{print n+0}' "$1"; }
arm r9
runbg "$(hold_cmd)" --slot-wait 1
started 1 || echo "FAIL - R9: the command did not start"
more 5
level 3
within 120 grepq 'heat stop (trapping)' "$D/err" || echo "FAIL - R9: no heat stop"
wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "76|1" "R9: a heat stop past the 1 s wait: exit 76, one start, no restart"
has "$(cat "$D/err")" "verify-slot: no verdict: no verify slot within 1s (heat: trapping); exit 76" "R9: … its no-verdict line names the heat stop"
ok "$(after_stop "$D/err")" 0 "R9: … and no heat wait line after the stop (one total deadline: no try with no time left)"
ok "$(is_free && echo free || echo held)" free "R9: … the slot is free"
arm r9c
runbg "$(hold_cmd)" --slot-wait 600
started 1 || echo "FAIL - R9 control: the command did not start"
more 5
level 3
within 120 grepq 'waiting (heat: trapping)' "$D/err" && s=waiting || s="no heat wait line in 120 s"
ok "$s|$(after_stop "$D/err")" "waiting|1" "R9 control: with time left (--slot-wait 600) the re-queue waits, its heat wait line after the stop"
level 0
started 2 || echo "FAIL - R9 control: no restart"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "0|2" "R9 control: … and restarts once cool: exit 0, two starts"

# ======== L1, L2: verify pinned heavy ======================================================================
arm l1
mkdir -p "$D/tree"
THREAD_HEAT_LEVEL=2 python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 60 --slots 1 --slot-wait 1 --verifier "touch '$D/ran'" > "$D/stdout" 2>&1
rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$([ -e "$D/ran" ] && echo ran || echo never)" "76|heat|never" "L1: heavy for the whole --slot-wait: exit 76, rc heat, the verifier never ran"
has "$(cat "$D/o.log")" "verify: no verdict: the Mac was too hot (heat: heavy) within 1s; verifier not run to a verdict (rc heat)" "L1: … the log says why"
has "$(cat "$D/o.log")" "verify: waiting (heat: heavy)" "L1: … after its heat wait line"
lacks "$(cat "$D/o.log")" "== verifier:" "L1: … no step started"
arm l2
mkdir -p "$D/tree"
THREAD_HEAT_LEVEL=2 python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 60 --slots 1 --slot-wait 1 --outcome --verifier true > /dev/null 2>&1
rc=$?
ok "$rc|$([ -e "$D/o.rc" ] && echo rc || echo none)" "76|none" "L2: --outcome: exit 76, no O.rc"
ok "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["ended"], d["rc"], sorted(d))' "$D/o.outcome.json")" \
  "heat heat ['ended', 'id', 'rc', 'sha', 'v']" "L2: outcome.json {v, id, sha, ended: heat, rc: heat}"

# ======== L3: a held slot at nominal is still noslot =====================================================
arm l3
mkdir -p "$D/tree"
python3 "$VS" run --slots 1 -- sh -c "echo \$\$ > '$D/h.pid'; until [ -e '$D/h.go' ]; do sleep 0.1; done" > /dev/null 2>&1 &
hp=$!; pids+=($hp)
within 120 nonempty "$D/h.pid" || echo "FAIL - L3: the holder did not start"
python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 60 --slots 1 --slot-wait 1 --verifier true > /dev/null 2>&1
ok "$?|$(cat "$D/o.rc" 2>/dev/null)" "75|noslot" "L3: a slot held by another at nominal: noslot, exit 75"
lacks "$(cat "$D/o.log")" "too hot" "L3: … never read as heat"
touch "$D/h.go"; wait "$hp"

# ======== L4: trapping during the verifier: back in line, restart green ====================================
vcmd() { printf "echo x >> '%s/starts'; echo \$\$ > '%s/c.pid'; until [ -e '%s/c.go' ]; do sleep 0.1; done" "$D" "$D" "$D"; }
arm l4
mkdir -p "$D/tree"
env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 600 --slots 1 --slot-wait 600 --verifier "$(vcmd)" > /dev/null 2>&1 &
W=$!; pids+=($W)
started 1 || echo "FAIL - L4: the verifier did not start"
level 3
within 120 grepq 'verify: heat stop (trapping) during the verifier: stopped its process group, no verdict; back in line' "$D/o.log" && s=stopped || s="no heat stop in 120 s"
ok "$s" stopped "L4: trapping during the verifier: the heat stop is logged"
within 120 grepq 'verify: waiting (heat: trapping)' "$D/o.log" || echo "FAIL - L4: no heat wait line"
ok "$(is_free && echo free || echo held)|$(count "$D/starts")" "free|1" "L4: … its slot freed while it waits, one start"
level 0
started 2 || echo "FAIL - L4: no restart"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$(count "$D/starts")" "0|0|2" "L4: the restart is green: exit 0, O.rc 0, two starts"

# ======== L5: trapping with --slot-wait 0: heat, one start ===============================================
arm l5
mkdir -p "$D/tree"
env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 600 --slots 1 --slot-wait 0 --verifier "$(vcmd)" > /dev/null 2>&1 &
W=$!; pids+=($W)
started 1 || echo "FAIL - L5: the verifier did not start"
level 3
wait "$W"; rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$(count "$D/starts")" "76|heat|1" "L5: --slot-wait 0: the heat stop spends the budget: exit 76, rc heat, one start"
has "$(cat "$D/o.log")" "verify: no verdict: the Mac was too hot (heat: trapping) within 0s" "L5: … the log says why"

# ======== L6: a heat stop in the env_bootstrap; the restart starts clean ===================================
arm l6
mkdir -p "$D/tree"
env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 600 --slots 1 --slot-wait 300 --outcome \
  --bootstrap "echo b >> '$D/boots'; until [ -e '$D/boot.go' ]; do sleep 0.1; done" --verifier "echo v >> '$D/vruns'" > /dev/null 2>&1 &
W=$!; pids+=($W)
within 120 atleast "$D/boots" 1 || echo "FAIL - L6: the bootstrap did not start"
level 3
within 120 grepq 'verify: heat stop (trapping) during the env_bootstrap' "$D/o.log" && s=stopped || s="no heat stop in 120 s"
ok "$s" stopped "L6: trapping during the env_bootstrap: the heat stop is logged"
level 0; touch "$D/boot.go"
wait "$W"; rc=$?
ok "$rc|$(count "$D/boots")|$(count "$D/vruns")" "0|2|1" "L6: the restart reruns the bootstrap (twice) and the verifier once: exit 0"
ok "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sorted(d), d["ended"], d["rc"])' "$D/o.outcome.json")" \
  "['ended', 'id', 'rc', 'sha', 'v'] done 0" "L6: outcome.json is {v, id, sha, ended: done, rc: 0}: no stale step or signal"

# ======== L7: a SlotDirError at the re-acquire: unslotted, unwatched, green ==============================
arm l7
mkdir -p "$D/tree"
env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 600 --slots 1 --slot-wait 600 --verifier "$(vcmd)" > /dev/null 2>&1 &
W=$!; pids+=($W)
started 1 || echo "FAIL - L7: the verifier did not start"
mv "$D/slots" "$D/slots.aside"; : > "$D/slots"
level 3
started 2 && s=restarted || s="no restart in 120 s"
ok "$s" restarted "L7: after the heat stop the re-acquire fails and the restart runs at once"
has "$(cat "$D/o.log")" "verify: WARN $D/slots" "L7: the log has the WARN"
has "$(cat "$D/o.log")" "running unslotted" "L7: … running unslotted"
tick; more 12; untick
ok "$(alive "$(cat "$D/c.pid")" && echo alive || echo gone)" alive "L7: still trapping, the unslotted restart is never stopped"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$(grep -c 'heat stop' "$D/o.log")" "0|0|1" "L7: green: exit 0, O.rc 0, one heat stop"

# ======== HR1–HR3: the Heat hold in the Run record (p29-10, ADR 0051; verify-slot.py contract items 7 and 8) ======
# recq <events dir> <rollout> <python expr over L, its record lines>
recq() {
  python3 - "$1/$2.jsonl" "$3" <<'PY2'
import json, sys
try:
    L = [json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
except FileNotFoundError:
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY2
}
# gitrepo <dir>: a git tree with one commit (tree_state reads its sha; a tree with none records nothing).
gitrepo() { git -c init.defaultBranch=main init -q "$1" && git -C "$1" -c user.name=t -c user.email=t@t commit -q --allow-empty -m a; }
PAIRS='[[d["kind"], d.get("outcome"), d.get("rc"), d.get("step")] for d in L]'
IDS='[L[0]["suite"] == L[1]["suite"], L[2]["suite"] == L[3]["suite"], L[0]["suite"] != L[2]["suite"]]'

# HR1: an agent's suite in a task tree (vault under HOME, t1 in_progress in r1), stdout and stderr to files: the pump.
arm hr1
VH="$D/home"; VT="$VH/repos/obsidian/Work/Tasks"; VEV="$D/events"; mkdir -p "$VT"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n## Queue\n\n- [[t1]]\n' > "$VT/r1.md"
printf -- '---\ntags: [task]\nstatus: in_progress\nowner: lead-1\nrollout: "[[r1]]"\n---\n\nt1\n' > "$VT/t1.md"
gitrepo "$D/r"; git -C "$D/r" worktree add -q "$D/r/.claude/worktrees/t1" -b t1 >/dev/null 2>&1
(cd "$D/r/.claude/worktrees/t1" && exec env -u THREAD_HEAT_LEVEL HOME="$VH" THREAD_EVENTS_DIR="$VEV" PATH="$tmp/bin:$PATH" HEAT_D="$D" \
  python3 "$VS" run --slots 1 -- sh -c "echo out-line; $(hold_cmd)") > "$D/out.txt" 2> "$D/err" &
W=$!; pids+=($W)
started 1 || echo "FAIL - HR1: the suite did not start"
level 3
within 120 grepq 'waiting (heat: trapping)' "$D/err" || echo "FAIL - HR1: no heat stop and wait"
ok "$(recq "$VEV" r1 "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,null]]' \
  "HR1: the heat stop ends the suite heat, no rc, before the run waits for the heat"
level 0
started 2 || echo "FAIL - HR1: no restart"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(grep -c out-line "$D/out.txt")" "0|2" "HR1: the restart is green, exit 0; both runs' output reached stdout through the pump"
ok "$(recq "$VEV" r1 "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,null],["suite-started",null,null,null],["suite-ended","green",0,null]]' \
  "HR1: the restart is a suite of its own: started, then green with rc 0"
ok "$(recq "$VEV" r1 "$IDS")" '[true,true,true]' "HR1: each run pairs its own suite id"

# HR1b (p32-1): R9's task-tree twin, the one total slot-wait deadline on the recorded path every agent suite takes. In
# HR1's tree with `--slot-wait 1`, the suite runs past the wait (5 more stub reads), then a heat stop ends it heat; the
# re-queue has no time left, so it makes no try: 76, one start, no second suite-started, no heat wait line after the stop.
T1="$D/r/.claude/worktrees/t1"
arm hr1b
(cd "$T1" && exec env -u THREAD_HEAT_LEVEL HOME="$VH" THREAD_EVENTS_DIR="$D/events" PATH="$tmp/bin:$PATH" HEAT_D="$D" \
  python3 "$VS" run --slots 1 --slot-wait 1 -- sh -c "$(hold_cmd)") > "$D/out.txt" 2> "$D/err" &
W=$!; pids+=($W)
started 1 || echo "FAIL - HR1b: the suite did not start"
more 5
level 3
within 120 grepq 'heat stop (trapping)' "$D/err" || echo "FAIL - HR1b: no heat stop"
within 120 gone "$W" || touch "$D/c.go"   # a restart (a fresh deadline, or a fall-through unslotted) holds on c.go
wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "76|1" "HR1b: a heat stop past the 1 s wait in a task tree: exit 76, one start, no restart"
has "$(cat "$D/err")" "verify-slot: no verdict: no verify slot within 1s (heat: trapping); exit 76" "HR1b: … its no-verdict line names the heat stop"
ok "$(after_stop "$D/err")" 0 "HR1b: … and no heat wait line after the stop (no try with no time left)"
ok "$(recq "$D/events" r1 "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,null]]' \
  "HR1b: the record is the stopped suite only: started, then ended heat with no rc, and no second suite-started"
ok "$(is_free && echo free || echo held)" free "HR1b: … the slot is free"

# HR2: the lead's Integration suite (verify --rollout --slug), trapping during the verifier.
arm hr2
gitrepo "$D/tree"; mkdir -p "$D/v"; : > "$D/v/ro.md"
env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" THREAD_EVENTS_DIR="$D/events" python3 "$LI" verify --tree "$D/tree" --out "$D/o" \
  --timeout 600 --slots 1 --slot-wait 600 --rollout "$D/v/ro.md" --slug t1 --verifier "$(vcmd)" > /dev/null 2>&1 &
W=$!; pids+=($W)
started 1 || echo "FAIL - HR2: the verifier did not start"
level 3
within 120 grepq 'verify: waiting (heat: trapping)' "$D/o.log" || echo "FAIL - HR2: no heat stop and wait"
ok "$(recq "$D/events" ro "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,"verifier"]]' \
  "HR2: the heat stop ends the lead's suite heat, no rc, its step the verifier"
level 0
started 2 || echo "FAIL - HR2: no restart"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)" "0|0" "HR2: the restart is green: exit 0, O.rc 0"
ok "$(recq "$D/events" ro "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,"verifier"],["suite-started",null,null,null],["suite-ended","green",0,null]]' \
  "HR2: the re-queued pass is a suite of its own, green"
ok "$(recq "$D/events" ro "$IDS + [L[0]['task'], L[0]['by'], L[0]['runner']]")" '[true,true,true,"t1","integration","lead"]' \
  "HR2: each pass pairs its own suite id, by integration, runner lead"

# HR3: pinned heavy for the whole --slot-wait: no suite starts; one suite-ended heat with its wait and no rc.
arm hr3
gitrepo "$D/tree"; mkdir -p "$D/v"; : > "$D/v/ro.md"
THREAD_HEAT_LEVEL=2 THREAD_EVENTS_DIR="$D/events" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 60 --slots 1 --slot-wait 1 \
  --rollout "$D/v/ro.md" --slug t1 --verifier "touch '$D/ran'" > /dev/null 2>&1
rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)" "76|heat" "HR3: heavy for the whole --slot-wait: exit 76, rc heat"
ok "$(recq "$D/events" ro '[[d["kind"], d["outcome"], d["seconds"], d["waited"] >= 0.9, "rc" in d] for d in L]')" '[["suite-ended","heat",0,true,false]]' \
  "HR3: only a suite-ended heat, with its wait and no rc"

# ======== L8: a heat stop in the Flake check's named re-run (p29-9 beside p31-4) ================================
# verify --diff-base --rollout: the first run fails on an out-of-diff test and trapping lands during its named re-run: no
# verdict, back in line, its suite ended heat (step verifier). The restart reruns every step from a clean result: its
# first run fails another test, whose named re-run and confirming run are green, so the Flake is the last pass's only.
arm l8
gitrepo "$D/tree"; mkdir -p "$D/tree/tests" "$D/v"; : > "$D/v/ro.md"
printf 'x\n' > "$D/tree/tests/test_a.py"; printf 'x\n' > "$D/tree/tests/test_b.py"
git -C "$D/tree" add tests && git -C "$D/tree" -c user.name=t -c user.email=t@t commit -q -m tests
L8B=$(git -C "$D/tree" rev-parse HEAD)
cat > "$D/v.sh" <<'SH'
d=$1; n=$(( $(cat "$d/v.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/v.count"
case $n in 1) echo 'FAILED tests/test_a.py::t - boom'; exit 1;; 2) echo 'FAILED tests/test_b.py::t - boom'; exit 1;; esac
exit 0
SH
cat > "$D/r.sh" <<'SH'
d=$1; shift; n=$(( $(cat "$d/r.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/r.count"
printf '%s\n' "$@" > "$d/r.$n.args"
if [ "$n" = 1 ]; then echo x >> "$d/starts"; until [ -e "$d/r.go" ]; do sleep 0.1; done; fi
exit 0
SH
env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" THREAD_EVENTS_DIR="$D/events" python3 "$LI" verify --tree "$D/tree" --out "$D/o" \
  --timeout 600 --slots 1 --slot-wait 600 --rollout "$D/v/ro.md" --slug t1 --verifier "bash '$D/v.sh' '$D'" \
  --diff-base "$L8B" --named-rerun "bash '$D/r.sh' '$D' {tests}" > /dev/null 2>&1 &
W=$!; pids+=($W)
started 1 || echo "FAIL - L8: the named re-run did not start"
level 3
within 120 grepq 'verify: heat stop (trapping) during the named re-run: stopped its process group, no verdict; back in line' "$D/o.log" && s=stopped || s="no heat stop in 120 s"
ok "$s" stopped "L8: trapping during the named re-run: the heat stop is logged"
within 120 grepq 'verify: waiting (heat: trapping)' "$D/o.log" || echo "FAIL - L8: no heat wait line"
level 0
wait "$W"; rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$(count "$D/starts")|$(cat "$D/v.count")|$(cat "$D/r.count")|$(cat "$D/r.2.args")" "0|0|1|3|2|tests/test_b.py::t" \
  "L8: the restart reruns every step: green, the verifier three times, the named re-run twice, the second for the new test"
ok "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["verdict"], d["why"], d["failing"], d["flakes"])' "$D/o.flake.json")" \
  "flake  ['tests/test_b.py::t'] ['tests/test_b.py::t']" "L8: the flake record is the last pass's: a Flake of its first run's test only"
ok "$(recq "$D/events" ro "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,"verifier"],["suite-started",null,null,null],["suite-ended","green",0,null]]' \
  "L8: the heat-stopped pass ends its suite heat (step verifier); the re-queued pass is a suite of its own, green"

# ======== M0–ML2: the Capacity stop (p36-10, ADR 0067 d8; verify-slot.py contract 7) =============================
# capjson <home> <stop_suites JSON> [memory JSON] [age in minutes]: <home>'s capacity.json, written atomically (a temp
# file and a rename), its written_at now (or <age> minutes ago: 20 is stale), capacity 4 (above --slots 1: no lowering).
capjson() {
  local h=$1 stop=$2 mem=${3:-4} age=${4:-0} at
  at=$(python3 -c 'import sys, datetime as d; print((d.datetime.now(d.timezone.utc) - d.timedelta(minutes=int(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$age")
  mkdir -p "$h/.config/thread"
  printf '{"capacity": 4, "written_at": "%s", "signals": {"stop_suites": %s, "memory": %s}}\n' "$at" "$stop" "$mem" > "$h/.config/thread/capacity.json.tmp"
  mv "$h/.config/thread/capacity.json.tmp" "$h/.config/thread/capacity.json"
}
caprm() { rm -f "$1/.config/thread/capacity.json"; }
after_cap() { awk '/capacity stop \(memory: critical\)/{s=1; next} s && /waiting \(memory: critical\)/{n++} END{print n+0}' "$1"; }

# M0: the reading.
arm m0
export HOME="$D/home"; mkdir -p "$HOME"
cat > "$tmp/cs.py" <<'PY2'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
if len(sys.argv) > 2:
    vs.SCRIPT = sys.argv[2]   # capacity.py is loaded from SCRIPT's dir
print(vs.capacity_stop())
PY2
cs() { "$PY" "$tmp/cs.py" "$VS" "$@"; }
ok "$(cs)" None "M0: no capacity.json: no stop"
mkdir -p "$HOME/.config/thread"; printf 'not json' > "$HOME/.config/thread/capacity.json"
ok "$(cs)" None "M0: an unreadable capacity.json: no stop"
capjson "$HOME" true 4 20; ok "$(cs)" None "M0: a stale stop (20 minutes old): no stop"
capjson "$HOME" false; ok "$(cs)" None "M0: stop_suites false: no stop"
for v in '"true"' 1 null; do
  capjson "$HOME" "$v"; ok "$(cs)" None "M0: stop_suites $v (not JSON true): no stop"
done
capjson "$HOME" true 4; ok "$(cs)" "memory: critical" "M0: stop_suites true with memory 4: memory: critical"
capjson "$HOME" true 1; ok "$(cs)" "capacity: stop_suites" "M0: stop_suites true with memory 1 (Chorus's thermal trapping): capacity: stop_suites"
capjson "$HOME" true true; ok "$(cs)" "capacity: stop_suites" "M0: … a bool memory is no level"
capjson "$HOME" true 4
mkdir -p "$D/broken" "$D/lacks"
printf 'def (\n' > "$D/broken/capacity.py"
ok "$(cs "$D/broken/verify-slot.py")" None "M0: a capacity.py that will not load: no stop (fail open)"
printf 'def read(now):\n    return {"file": "fresh", "signals": {"stop_suites": True}}\n' > "$D/lacks/capacity.py"
ok "$(cs "$D/lacks/verify-slot.py")" None "M0: a capacity.py with no suite_stop: no stop (fail open)"
CP="$root/skills/execute/scripts/capacity.py"
cr() { "$PY" -c 'import importlib.util, sys, datetime as d
spec = importlib.util.spec_from_file_location("cap", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
r = m.read(d.datetime.now(d.timezone.utc))
print(r["file"], r["signals"], m.suite_stop(r))' "$CP"; }
capjson "$HOME" true 4; ok "$(cr)" "fresh {'stop_suites': True, 'memory': 4} memory: critical" "M0: capacity.py read() carries a fresh file's signals"
capjson "$HOME" true 4 20; ok "$(cr)" "stale {} None" "M0: … and none from a stale one"
ok "$("$PY" -c 'import importlib.util, sys
spec = importlib.util.spec_from_file_location("cap", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.suite_stop(None), m.suite_stop({"file": "fresh", "signals": "x"}), m.CAPACITY_STOP_KEY, m.CAPACITY_MEMORY_CRITICAL)' "$CP")" \
  "None None stop_suites 4" "M0: suite_stop never raises on an ill-shaped reading; the key and the critical level"
export HOME="$H0"

# M1: a fresh stop: no slot; a TERM exits 76.
arm m1
export HOME="$D/home"; capjson "$HOME" true 4
runbg "echo x >> '$D/starts'"
within 120 grepq 'verify-slot: waiting (memory: critical)' "$D/err" && s=waiting || s="no capacity line in 120 s"
ok "$s" waiting "M1: a fresh stop_suites: run waits with a 'waiting (memory: critical)' line"
J=$(st --slots 1)
ok "$(js "d['slots'][0]['state'], d['capacityStop']" "$J")" "('free', 'memory: critical')" "M1: status shows the slot free and capacityStop 'memory: critical'"
kill -TERM "$W"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "76|0" "M1: a TERM while held by the Capacity exits 76, the command never run"
has "$(cat "$D/err")" "verify-slot: no verdict: stopped while the Capacity stopped suites (memory: critical); exit 76" "M1: … with its no-verdict line"
ok "$(grep -c 'waiting (memory: critical)' "$D/err")" 1 "M1: the Capacity line is said once while the reason holds"
capjson "$HOME" false
ok "$(js "d['capacityStop']" "$(st --slots 1)")" None "M1: status's capacityStop is null for a fresh green file"
export HOME="$H0"

# M2: a fresh stop mid-run stops it; back in line; restart once clear. A fresh green file runs it.
arm m2
export HOME="$D/home"; capjson "$HOME" false
runbg "$(hold_cmd)"
started 1 || echo "FAIL - M2: a fresh green file did not run the command"
p1=$(cat "$D/c.pid")
capjson "$HOME" true 4
within 120 gone "$p1" && s=gone || s="alive after 120 s"
ok "$s" gone "M2: a fresh stop_suites: the running suite is ended"
within 120 grepq 'waiting (memory: critical)' "$D/err" || echo "FAIL - M2: no waiting line"
ok "$(is_free && echo free || echo held)" free "M2: … its verify slot is free while it waits"
has "$(cat "$D/err")" "verify-slot: capacity stop (memory: critical): ended the suite after" "M2: stderr names the capacity stop"
ok "$(after_cap "$D/err")" 1 "M2: the capacity stop, then the Capacity wait"
lacks "$(cat "$D/err")" "heat stop" "M2: … never a heat stop"
more 3
ok "$(count "$D/starts")" 1 "M2: the stop still holds the restart"
capjson "$HOME" false
started 2 && s=restarted || s="no restart in 120 s"
ok "$s" restarted "M2: once the stop clears the suite restarts from the beginning"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "0|2" "M2: the restart's exit is the verdict: 0, two starts"
export HOME="$H0"

# M3: a stale stop stops nothing.
arm m3
export HOME="$D/home"; capjson "$HOME" true 4 20
runbg "$(hold_cmd)"
started 1 || echo "FAIL - M3: a stale stop held the start"
more 3
ok "$(alive "$(cat "$D/c.pid")" && echo alive || echo gone)" alive "M3: a stale stop_suites for 3 more reads: the running suite is not stopped"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(count "$D/starts")" "0|1" "M3: it finishes: exit 0, one start"
lacks "$(cat "$D/err")" "capacity stop" "M3: … no capacity stop"
lacks "$(cat "$D/err")" "memory: critical" "M3: … and no Capacity wait"
export HOME="$H0"

# M4: a fresh stop with a bounded slot wait: 76, never started.
arm m4
export HOME="$D/home"; capjson "$HOME" true 4
hot python3 "$VS" run --slots 1 --slot-wait 1 -- sh -c "echo x >> '$D/starts'" > /dev/null 2> "$D/err"; rc=$?
ok "$rc|$(count "$D/starts")" "76|0" "M4: a fresh stop for the whole wait: exit 76, the command never started"
has "$(cat "$D/err")" "verify-slot: no verdict: no verify slot within 1s (memory: critical); exit 76" "M4: … its no-verdict line names the Capacity stop"
export HOME="$H0"

# M5: heat first. Trapping stops the suite (a heat stop), then a fresh stop file: the hold reads the heat, never the label.
arm m5
export HOME="$D/home"; capjson "$HOME" false
runbg "$(hold_cmd)"
started 1 || echo "FAIL - M5: the command did not start"
level 3
within 120 grepq 'heat stop (trapping)' "$D/err" || echo "FAIL - M5: no heat stop"
capjson "$HOME" true 4
more 3
within 120 grepq 'waiting (heat: trapping)' "$D/err" || echo "FAIL - M5: no heat wait line"
kill -TERM "$W"; wait "$W"; rc=$?
E=$(cat "$D/err")
ok "$rc|$(count "$D/starts")" "76|1" "M5: a TERM back in line: exit 76, one start"
has "$E" "verify-slot: no verdict: stopped while the Mac was hot (heat: trapping); exit 76" "M5: … the heat's no-verdict line"
lacks "$E" "memory: critical" "M5: at trapping the lines never name the Capacity"
hot python3 "$VS" run --slots 1 --slot-wait 1 -- true > /dev/null 2> "$D/err2"; rc=$?
ok "$rc" 76 "M5: at trapping with a fresh stop and --slot-wait 1: exit 76"
has "$(cat "$D/err2")" "no verify slot within 1s (heat: trapping); exit 76" "M5: … naming the heat, never the Capacity"
export HOME="$H0"

# MW: the stop's unit harness on Guarded.watch (R6's): a capacity stop below trapping, heat first at trapping.
arm mw
export HOME="$D/home"; capjson "$HOME" true 4
mw() { THREAD_HEAT_LEVEL=$1 python3 -c 'import importlib.util, subprocess, sys
spec = importlib.util.spec_from_file_location("vs", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
class P:
    def __init__(self, waits):
        self.waits = list(waits)
    def wait(self, timeout=None):
        w = self.waits.pop(0)
        if w is None:
            raise subprocess.TimeoutExpired("guard", timeout)
        return w
class G(vs.Guarded):
    def __init__(self, waits):
        self.proc, self._death, self.group, self.stops, self.heat = P(waits), None, None, 0, None
    def stop(self):
        self.stops += 1
        return 143
a = G([None, 3])
ra = a.watch()
b = G([None, None])
rb = b.watch()
print(ra, a.stops, rb is vs.HEAT_STOPPED, b.stops, repr(b.heat), vs.stop_words(b.heat), vs.hold_why(b.heat))' "$VS"; }
ok "$(mw 2)" "3 0 True 1 'memory: critical' capacity stop (memory: critical) memory: critical" \
  "MW: below trapping a fresh stop stops a guard still there (its label kept), keeps the rc of one that exits in the settle"
ok "$(mw 3)" "3 0 True 1 3 heat stop (trapping) heat: trapping" "MW: at trapping the heat is read first: a heat stop, its level kept"
export HOME="$H0"

# MH1: the Run record on the recorded path (HR1's task tree, its vault under VH): a capacity stop ends its suite heat.
arm mh1
capjson "$VH" false
(cd "$T1" && exec env -u THREAD_HEAT_LEVEL HOME="$VH" THREAD_EVENTS_DIR="$D/events" PATH="$tmp/bin:$PATH" HEAT_D="$D" \
  python3 "$VS" run --slots 1 -- sh -c "echo out-line; $(hold_cmd)") > "$D/out.txt" 2> "$D/err" &
W=$!; pids+=($W)
started 1 || echo "FAIL - MH1: the suite did not start"
capjson "$VH" true 4
within 120 grepq 'waiting (memory: critical)' "$D/err" || echo "FAIL - MH1: no capacity stop and wait"
has "$(cat "$D/err")" "verify-slot: capacity stop (memory: critical): ended the suite after" "MH1: the pump's capacity stop is named"
ok "$(recq "$D/events" r1 "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,null]]' \
  "MH1: the capacity stop ends the suite heat, no rc, before the run waits"
capjson "$VH" false
started 2 || echo "FAIL - MH1: no restart"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc" 0 "MH1: the restart is green, exit 0"
ok "$(recq "$D/events" r1 "$PAIRS")" '[["suite-started",null,null,null],["suite-ended","heat",null,null],["suite-started",null,null,null],["suite-ended","green",0,null]]' \
  "MH1: the restart is a suite of its own: started, then green with rc 0"
caprm "$VH"

# ML1: lead-integrate verify: a capacity stop during the verifier; back in line; restart green.
arm ml1
mkdir -p "$D/tree"; capjson "$D/home" false
env -u THREAD_HEAT_LEVEL HOME="$D/home" PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 600 --slots 1 --slot-wait 600 --verifier "$(vcmd)" > /dev/null 2>&1 &
W=$!; pids+=($W)
started 1 || echo "FAIL - ML1: the verifier did not start"
capjson "$D/home" true 4
within 120 grepq 'verify: capacity stop (memory: critical) during the verifier: stopped its process group, no verdict; back in line' "$D/o.log" && s=stopped || s="no capacity stop in 120 s"
ok "$s" stopped "ML1: a fresh stop during the verifier: the capacity stop is logged"
within 120 grepq 'verify: waiting (memory: critical)' "$D/o.log" || echo "FAIL - ML1: no Capacity wait line"
ok "$(is_free && echo free || echo held)|$(count "$D/starts")" "free|1" "ML1: … its slot freed while it waits, one start"
capjson "$D/home" false
started 2 || echo "FAIL - ML1: no restart"
touch "$D/c.go"; wait "$W"; rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$(count "$D/starts")" "0|0|2" "ML1: the restart is green: exit 0, O.rc 0, two starts"

# ML2: verify with a pinned fresh stop and --slot-wait 1: rc heat, exit 76.
arm ml2
mkdir -p "$D/tree"; capjson "$D/home" true 4
HOME="$D/home" python3 "$LI" verify --tree "$D/tree" --out "$D/o" --timeout 60 --slots 1 --slot-wait 1 --verifier "touch '$D/ran'" > /dev/null 2>&1
rc=$?
ok "$rc|$(cat "$D/o.rc" 2>/dev/null)|$([ -e "$D/ran" ] && echo ran || echo never)" "76|heat|never" "ML2: a fresh stop for the whole --slot-wait: exit 76, rc heat, the verifier never ran"
has "$(cat "$D/o.log")" "verify: no verdict: the Capacity stopped suites (memory: critical) within 1s; verifier not run to a verdict (rc heat)" "ML2: … the log says why"
has "$(cat "$D/o.log")" "verify: waiting (memory: critical)" "ML2: … after its Capacity wait line"

echo; [ "$fail" -eq 0 ] && echo "verify-slot-heat: ALL PASS" || echo "verify-slot-heat: SOME FAILED"
exit "$fail"
