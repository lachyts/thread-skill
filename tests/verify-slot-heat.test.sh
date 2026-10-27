#!/usr/bin/env bash
# p31-4, executed (estate ADR 0009 d5): the Heat hold in skills/execute/scripts/verify-slot.py (`run`) and in
# lead-integrate.py's `verify --slots N --slot-wait W`. At heavy (2) no slot is free; at trapping or sleeping (3+) a
# running slotted suite is stopped through its guard and put back in line, to restart from the beginning once the level
# falls below heavy. A heat stop is never red: `run` exits 76 only when stopped while the Mac is hot, and verify's
# no-verdict word is `heat` (exit 76), its total wait bounded by --slot-wait.
#   R0  the reading (the pin, notifyutil, fail-open)   R1  pinned heavy: never starts; a TERM exits 76   R2  heavy
#   mid-run never stops a suite   R3  trapping mid-run stops it, back in line, restart once cool   R4  a TERM back in
#   line exits 76   R5  a restarted suite's own red is the verdict   R6  the exit race (a unit harness on watch)
#   R7  a SlotDirError at the re-acquire runs the restart unslotted and unwatched
#   L1  verify pinned heavy: rc heat, exit 76   L2  … with --outcome   L3  a held slot at nominal is still noslot
#   L4  trapping during the verifier: back in line, restart green   L5  … with --slot-wait 0: heat, one start
#   L6  a heat stop in the env_bootstrap: a clean restart, the outcome file has no stale key   L7  a SlotDirError at the
#   re-acquire: unslotted, unwatched, green.
# Structural, never a stopwatch (p22-1): holders hold until a `.go` file appears; the stub notifyutil reads the level
# from <arm>/out and appends one line per read to <arm>/reads, so "N more reads" is the clock; every wait is a
# `within <s>` poll whose bound only slows a real failure. Every background pid is recorded and stopped only by it.
# Hermetic: every pool lives under mktemp (THREAD_VERIFY_SLOTS_DIR), the heat is pinned at 0 (THREAD_HEAT_LEVEL) but
# where an arm unsets it to read its own stub.
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
# runbg <cmd…>: a `run --slots 1 -- sh -c <cmd>` in the background reading the stub; its pid in $W and pids.
runbg() { env -u THREAD_HEAT_LEVEL PATH="$tmp/bin:$PATH" HEAT_D="$D" python3 "$VS" run --slots 1 -- sh -c "$1" > "$D/out.txt" 2> "$D/err" & W=$!; pids+=($W); }
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
J=$(python3 "$VS" status)
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

echo; [ "$fail" -eq 0 ] && echo "verify-slot-heat: ALL PASS" || echo "verify-slot-heat: SOME FAILED"
exit "$fail"
