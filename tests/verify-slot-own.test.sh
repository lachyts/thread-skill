#!/usr/bin/env bash
# p34-1, executed: what skills/execute/scripts/verify-slot.py does for itself (its header: contract items 3, 5 and 6, and
# the `run` and `status` paragraphs).
#   O1  the guard starts isolated (`-I`): a shadowing json.py on PYTHONPATH, or a bogus PYTHONHOME, no longer stops
#       `run`, and the command still gets both
#   O2  the marker: a command in a held slot sees VERIFY_SLOT_HELD=1, a reparented one too, and so does
#       lead-integrate.py's slotted step; an unslotted (fail-open) run does not
#   O3  its own slots: `run` and `status` take --slots from rollouts.toml `verify_slots`, in process or, on a python
#       with no tomllib, through the resolver's CLI under a python >= 3.11; no file is the built-in 2; a refused file, no
#       python that can read it, a load failure or a CLI answer of the wrong shape is the built-in 2 with a WARN, never
#       rc 1; a TERM while `run` resolves is 76, no verdict, its resolver child gone
#   O6b lead-integrate.py's lone --slot-wait: a TERM while it resolves is rc 143, its resolver child gone
#   O4  the line: ordinary runs take a freed slot in arrival order, after the Integration waiters; a stale entry is
#       reaped; an asleep one (a stopped waiter) is passed over and kept, and back in its place once it wakes;
#       _probe_entry reads a name only while it names the inode it opened
#   O5  status lists the line, oldest first, with asleep flags, and reaps stale entries
# Structural, never a stopwatch (p22-1): holders hold until a `.go` file appears; every wait is a `within <s>` poll
# whose bound only slows a real failure. Every background pid is recorded and stopped only by that pid.
# Hermetic: every pool lives under mktemp (THREAD_VERIFY_SLOTS_DIR), the Run record too.
# The gate's own slot marker is unset at top level, so a suite run inside a slot reads as one that is not.
# Every call that can reach the resolver (`run` or `status` with no --slots, a lone --slot-wait) pins HOME on its own
# command line (tests/run.sh's rule).
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd -P)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export PYTHONDONTWRITEBYTECODE=1
# The gate and the lead's Integration verify run this whole suite inside a verify slot, so its marker is set here.
unset VERIFY_SLOT_HELD
ok "${VERIFY_SLOT_HELD-unset}" unset "O2-0: the marker starts unset here, even when the suite runs inside a slot"

tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P)
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$tmp/events}"   # the Run record stays in temp
export THREAD_NOTE_LOCK_DIR="${tmp}/note-locks"                      # the note save lock stays in temp too
export THREAD_VERIFY_SLOTS_DIR="$tmp/slots"                          # never the machine's real pool
export THREAD_VERIFY_SLOT_POLL=0.1
export THREAD_HEAT_LEVEL=0                                           # the Heat hold's reading, pinned
VS="$root/skills/execute/scripts/verify-slot.py"

pids=()
stopped=()   # pids an arm SIGSTOPped: the cleanup CONTs them before it stops them
cleanup() {
  local p
  for p in ${stopped[@]+"${stopped[@]}"}; do kill -CONT "$p" 2>/dev/null; done
  touch "$tmp"/*/*.go 2>/dev/null
  for p in ${pids[@]+"${pids[@]}"}; do kill -TERM "$p" 2>/dev/null; done
  for p in ${pids[@]+"${pids[@]}"}; do wait "$p" 2>/dev/null; done
  rm -rf "$tmp"
}
trap cleanup EXIT

lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
# within <s> <cmd…>: poll <cmd> every 0.1 s until it succeeds (0) or <s> s of wall clock pass (1).
within() { local end=$((SECONDS + $1)); shift; until "$@" 2>/dev/null; do [ "$SECONDS" -ge "$end" ] && return 1; sleep 0.1; done; }
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
exists() { [ -e "$1" ]; }
nonempty() { [ -s "$1" ]; }
grepq() { grep -q -- "$1" "$2"; }
js() { python3 -c 'import json,sys; d=json.loads(sys.argv[2]); print(eval(sys.argv[1]))' "$1" "$2"; }
# pool <name>: a fresh arm dir D and its own pool SL.
pool() { echo "== $1"; D="$tmp/$1"; mkdir -p "$D"; SL="$D/slots"; export THREAD_VERIFY_SLOTS_DIR="$SL"; }

# ======== O1: the guard starts isolated ========================================================================
pool o1
mkdir -p "$D/shadow"; printf 'raise ImportError("a shadowing json.py")\n' > "$D/shadow/json.py"
out=$(PYTHONPATH="$D/shadow" python3 -I "$VS" run --slots 1 -- sh -c 'echo ran; echo "PP=$PYTHONPATH"' 2> "$D/a.err"); rc=$?
ok "$rc|$out" "0|ran
PP=$D/shadow" "O1a: a shadowing json.py on PYTHONPATH no longer stops run (rc 0), and the command keeps its PYTHONPATH"
lacks "$(cat "$D/a.err")" "Traceback" "O1a: … no traceback"
out=$(PYTHONHOME="$D/bogus" python3 -I "$VS" run --slots 1 -- sh -c 'echo "PH=$PYTHONHOME"' 2> "$D/b.err"); rc=$?
ok "$rc|$out" "0|PH=$D/bogus" "O1b: a bogus PYTHONHOME no longer stops run (rc 0), and the command keeps it"

# ======== O2: the marker =======================================================================================
LI="$root/skills/execute/scripts/lead-integrate.py"
pool o2
out=$(python3 "$VS" run --slots 1 -- sh -c 'echo "${VERIFY_SLOT_HELD-unset}"' 2> "$D/a.err"); rc=$?
ok "$rc|$out" "0|1" "O2a: a command run in a held slot sees VERIFY_SLOT_HELD=1"
: > "$D/file"
out=$(THREAD_VERIFY_SLOTS_DIR="$D/file/slots" python3 "$VS" run --slots 1 -- sh -c 'echo "${VERIFY_SLOT_HELD-unset}"' 2> "$D/b.err"); rc=$?
ok "$rc|$out" "0|unset" "O2b: an unslotted (fail-open) run holds no slot, so its command gets no marker"
has "$(cat "$D/b.err")" "running unslotted" "O2b: … behind its WARN"
python3 "$VS" run --slots 1 -- sh -c '( sh -c '"'"'sleep 0.3; echo "${VERIFY_SLOT_HELD-unset}" > "$1"'"'"' sh "$0" & ); exit 0' "$D/bg" \
  > /dev/null 2> "$D/c.err"; rc=$?
ok "$rc" 0 "O2c: a command that leaves a reparented background child exits 0"
within 30 nonempty "$D/bg" && s=$(cat "$D/bg") || s="no file in 30 s"
ok "$s" 1 "O2c: … and the reparented child still sees VERIFY_SLOT_HELD=1"
mkdir -p "$D/tree"
python3 "$LI" verify --tree "$D/tree" --out "$D/li" --timeout 60 --slots 1 --slot-wait 60 \
  --verifier 'echo "H=${VERIFY_SLOT_HELD-unset}"' > /dev/null 2>&1; rc=$?
ok "$rc|$(cat "$D/li.rc" 2>/dev/null)" "0|0" "O2d: lead-integrate.py verify --slots 1 --slot-wait 60 is green"
has "$(cat "$D/li.log")" "H=1" "O2d: … and its slotted verifier sees VERIFY_SLOT_HELD=1"
THREAD_VERIFY_SLOTS_DIR="$D/file/slots" python3 "$LI" verify --tree "$D/tree" --out "$D/lu" --timeout 60 --slots 1 --slot-wait 60 \
  --verifier 'echo "H=${VERIFY_SLOT_HELD-unset}"' > /dev/null 2>&1; rc=$?
ok "$rc|$(cat "$D/lu.rc" 2>/dev/null)" "0|0" "O2d: unslotted (an unusable slots dir), verify is still green"
has "$(cat "$D/lu.log")" "H=unset" "O2d: … and its step gets no marker"

# ======== O3: its own slots ====================================================================================
unset THREAD_TOML_PYTHONS   # the resolver's candidate list: each arm that needs one names it on its own command line
RS="$root/skills/_shared/scripts/rollout-settings.py"
PY=$(python3 -c 'import sys; print(sys.executable)')
# hold <name> <N>: a `run --slots N` whose command records its pid in <name>.pid and holds until <name>.go exists; the
# wrapper's pid goes to <name>.w and into pids. Waits until the command runs.
hold() {
  python3 "$VS" run --slots "$2" -- sh -c "echo \$\$ > '$D/$1.pid'; until [ -e '$D/$1.go' ]; do sleep 0.1; done" \
    > "$D/$1.out" 2> "$D/$1.err" &
  echo $! > "$D/$1.w"; pids+=($!)
  within 300 nonempty "$D/$1.pid" || echo "FAIL - $1: its command did not start within 300 s"
}
w() { cat "$D/$1.w"; }
count() { ls -A "$SL" 2>/dev/null | grep -cE "$1"; }
# The tomllib block: a meta-path finder that refuses tomllib, so this python reads as one with none (python 3.9's
# /usr/bin/python3, on any runner). `python3 notoml_shim.py SCRIPT ARGS…` runs SCRIPT as __main__ under it.
cat > "$tmp/notoml_shim.py" <<'PY'
import runpy, sys
class NoToml:
    def find_spec(self, name, path=None, target=None):
        if name == "tomllib" or name.startswith("tomllib."):
            raise ModuleNotFoundError("No module named 'tomllib' (blocked by the test)", name="tomllib")
        return None
sys.meta_path.insert(0, NoToml())
sys.modules.pop("tomllib", None)
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
PY
# A rollouts.toml under a HOME of its own: home <dir> <toml body…>.
home() { local h="$1"; shift; mkdir -p "$h/.config/thread"; printf '%s\n' "$@" > "$h/.config/thread/rollouts.toml"; }
H3="$tmp/h3"; home "$H3" '[defaults]' 'verify_slots = 3'
HR="$tmp/hr"; home "$HR" '[defaults]' 'verify_slots = 0'
H1="$tmp/h1"; home "$H1" '[defaults]' 'verify_slots = 1'
HE="$tmp/he"; mkdir -p "$HE"
# slowpy: a resolver candidate that never answers (it records its pid, then sleeps in place).
printf '#!/bin/sh\necho $$ > "$SLOWPID"\nexec sleep 300\n' > "$tmp/slowpy"; chmod +x "$tmp/slowpy"
# shapepy: a resolver candidate that exits 0 with $SHAPE on stdout.
printf '#!/bin/sh\nprintf "%%s\\n" "$SHAPE"\n' > "$tmp/shapepy"; chmod +x "$tmp/shapepy"
slotsof() { js "[(s['index'], s['state']) for s in d['slots']]" "$1"; }
pool o3
J=$(HOME="$H3" python3 "$VS" status 2> "$D/a.err"); rc=$?
ok "$rc|$(slotsof "$J")|$(js "d['verify_slots']" "$J")" "0|[(0, 'free'), (1, 'free'), (2, 'free')]|{'value': 3, 'source': 'file:defaults'}" \
  "O3a: status with no --slots under verify_slots = 3 (in process, python >= 3.11): three slots, from file:defaults"
ok "$(cat "$D/a.err")" "" "O3a: … no WARN"
if [ -x /usr/bin/python3 ] && ! /usr/bin/python3 -I -c 'import tomllib' 2>/dev/null; then
  J=$(HOME="$H3" /usr/bin/python3 -I "$VS" status 2> "$D/b.err"); rc=$?
  ok "$rc|$(slotsof "$J")|$(js "d['verify_slots']" "$J")" "0|[(0, 'free'), (1, 'free'), (2, 'free')]|{'value': 3, 'source': 'file:defaults'}" \
    "O3b: /usr/bin/python3 (no tomllib) -I: three slots, read through the CLI under a python >= 3.11"
  ok "$(cat "$D/b.err")" "" "O3b: … no WARN"
else
  echo "SKIP - O3b: /usr/bin/python3 has tomllib here (or is missing); O3c covers the CLI path"
fi
J=$(HOME="$H3" THREAD_TOML_PYTHONS="$PY" python3 -I "$tmp/notoml_shim.py" "$VS" status 2> "$D/c.err"); rc=$?
ok "$rc|$(slotsof "$J")|$(js "d['verify_slots']" "$J")" "0|[(0, 'free'), (1, 'free'), (2, 'free')]|{'value': 3, 'source': 'file:defaults'}" \
  "O3c: no tomllib in process, THREAD_TOML_PYTHONS names this same python: tried verbatim under -I, three slots"
ok "$(cat "$D/c.err")" "" "O3c: … no WARN"
J=$(HOME="$H3" THREAD_TOML_PYTHONS= python3 -I "$tmp/notoml_shim.py" "$VS" status 2> "$D/d.err"); rc=$?
ok "$rc|$(slotsof "$J")|$(js "d['verify_slots']" "$J")" "0|[(0, 'free'), (1, 'free')]|{'value': 2, 'source': 'fallback'}" \
  "O3d: no tomllib and an empty candidate list: exit 0, the built-in 2, source fallback"
has "$(cat "$D/d.err")" "verify-slot: WARN no python >= 3.11 could read $H3/.config/thread/rollouts.toml (tried: none); using the built-in 2 verify slots" \
  "O3d: … with a WARN naming the file"
J=$(HOME="$HR" python3 "$VS" status 2> "$D/e.err"); rc=$?
ok "$rc|$(slotsof "$J")|$(js "d['verify_slots']['source']" "$J")" "0|[(0, 'free'), (1, 'free')]|fallback" \
  "O3e: a refused rollouts.toml (verify_slots = 0): exit 0, the built-in 2"
has "$(cat "$D/e.err")" "verify-slot: WARN rollout-settings: $HR/.config/thread/rollouts.toml:2: " "O3e: … with a WARN naming the file and line"
has "$(cat "$D/e.err")" "; using the built-in 2 verify slots" "O3e: … and the count it uses"
hold fa 3; hold fb 3; hold fc 3
HOME="$H3" python3 "$VS" run -- sh -c "echo ran > '$D/f.ran'" > /dev/null 2> "$D/f.err" &
fp=$!; pids+=($fp)
within 300 grepq 'waiting for one of 3 verify slots' "$D/f.err" && s=queued || s="no waiting line in 300 s"
ok "$s" queued "O3f: run with no --slots under verify_slots = 3, slots 0-2 held: a fourth waits for one of 3"
touch "$D/fa.go"
within 300 nonempty "$D/f.ran" && s=ran || s="never ran in 300 s"
ok "$s" ran "O3f: … and runs once one frees"
wait "$fp"; ok "$?" 0 "O3f: … exit 0"
touch "$D/fb.go" "$D/fc.go"; wait "$(w fa)"; wait "$(w fb)"; wait "$(w fc)"
J=$(HOME="$HE" python3 "$VS" status 2> "$D/g.err")
ok "$(js "d['verify_slots']" "$J")|$(cat "$D/g.err")" "{'value': 2, 'source': 'built-in'}|" "O3g: no rollouts.toml: the built-in 2, no WARN"
python3 - "$SL/slot-2.lock" "$D/h.go" <<'PY' &
import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o644); fcntl.flock(fd, fcntl.LOCK_EX)
open(sys.argv[2] + ".ready", "w").close()
while not os.path.exists(sys.argv[2]): time.sleep(0.1)
PY
hp=$!; pids+=($hp)
within 300 exists "$D/h.go.ready" || echo "FAIL - O3h: the slot-2 holder did not start"
J=$(HOME="$H1" python3 "$VS" status)
ok "$(js "d['verify_slots']['value']" "$J")|$(js "[(s['index'], s['state']) for s in d['slots'] if s['index'] == 2]" "$J")" "1|[(2, 'held')]" \
  "O3h: under verify_slots = 1, a held slot-2.lock still shows with no --slots"
touch "$D/h.go"; wait "$hp"
mkdir -p "$D/bin"; ln -s "$PY" "$D/bin/python3"
got=$(env -u THREAD_TOML_PYTHONS PATH="$D/bin:$PATH" "$PY" -B - "$VS" "$D/bin/python3" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
c = vs._toml_pythons()
me = os.path.realpath(sys.executable)
print(sys.argv[2] in c, any(os.path.realpath(p) == me for p in c), len(c) == len(set(os.path.realpath(p) for p in c)))
PY
)
ok "$got" "False False True" "O3i: the default list skips a PATH python3 that is this python (by realpath), and holds no duplicate"
got=$(THREAD_TOML_PYTHONS="$D/bin/python3:$D/bin/python3" "$PY" -B - "$VS" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
print(vs._toml_pythons())
PY
)
ok "$got" "['$D/bin/python3', '$D/bin/python3']" "O3i: THREAD_TOML_PYTHONS is used verbatim (no dedupe, no self-skip)"
# O3j: a TERM while `run` resolves (the plain path): its resolver child (slowpy) is killed and reaped, no suite runs.
cat > "$D/j.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
vs.RESOLVE_TIMEOUT = 120
sys.exit(vs.main(["run", "--", "sh", "-c", "touch ran"]))
PY
HJ="$tmp/hj"; home "$HJ" '[defaults]' 'verify_slots = 3'
(cd "$D" && HOME="$HJ" THREAD_TOML_PYTHONS="$tmp/slowpy" SLOWPID="$D/j.slow" exec python3 "$tmp/notoml_shim.py" "$D/j.py" "$VS") \
  > "$D/j.out" 2> "$D/j.err" &
jp=$!; pids+=($jp)
within 30 nonempty "$D/j.slow" && s=started || s="slowpy never started in 30 s"
ok "$s" started "O3j: run with no --slots, no tomllib: its resolver candidate (slowpy) started"
kill -TERM "$jp"; wait "$jp"; rc=$?
ok "$rc" 76 "O3j: a TERM while run resolves → 76 (no verdict)"
ok "$(grep '^verify-slot: ' "$D/j.err" | tail -2)" "verify-slot: no verdict: stopped before the suite started; exit 76
verify-slot: exit 76 (run $jp)" "O3j: … its no-verdict line, then its exit line"
ok "$([ -e "$D/ran" ] && echo ran || echo never)" never "O3j: … the suite never ran"
within 30 gone "$(cat "$D/j.slow")" && s=gone || s="slowpy alive after 30 s"
ok "$s" gone "O3j: … and the resolver child is gone"
ok "$(count '^\.?(waiter|queue)-')" 0 "O3j: … no waiter or queue file"
# O3k: a load failure or a CLI answer of the wrong shape is the built-in 2 with a WARN, rc 0, never 1.
pool o3k   # a fresh pool: no slot file above slot 1, so a status lists exactly the count it read
cat > "$D/k1.py" <<'PY'
import importlib.util, os, shutil, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
os.makedirs(sys.argv[3], exist_ok=True)
vs.SETTINGS_PY = shutil.copy(sys.argv[2], os.path.join(sys.argv[3], "rollout-settings.py"))   # no ladder.py beside it
sys.exit(vs.main(["run", "--", "sh", "-c", "echo ran"] if sys.argv[4] == "run" else ["status"]))
PY
out=$(cd "$D" && HOME="$H3" python3 "$D/k1.py" "$VS" "$RS" "$D/rsbroken" run 2> "$D/k1.err"); rc=$?
ok "$rc|$out" "0|ran" "O3k1: rollout-settings.py that will not load (no ladder.py): run still runs, rc 0"
has "$(cat "$D/k1.err")" "verify-slot: WARN cannot read verify_slots (FileNotFoundError: " "O3k1: … behind a WARN naming the exception"
has "$(cat "$D/k1.err")" "; using the built-in 2 verify slots" "O3k1: … and the built-in 2"
J=$(cd "$D" && HOME="$H3" python3 "$D/k1.py" "$VS" "$RS" "$D/rsbroken" status 2> "$D/k1s.err"); rc=$?
ok "$rc|$(slotsof "$J")|$(js "d['verify_slots']['source']" "$J")" "0|[(0, 'free'), (1, 'free')]|fallback" "O3k1: … status: rc 0, two slots, fallback"
for shape in '[]' '{}' '{"settings":{"verify_slots":{"value":true,"source":"file:defaults"}}}' 'not json'; do
  J=$(HOME="$H3" THREAD_TOML_PYTHONS="$tmp/shapepy" SHAPE="$shape" python3 -I "$tmp/notoml_shim.py" "$VS" status 2> "$D/k2.err"); rc=$?
  ok "$rc|$(slotsof "$J" 2>/dev/null)|$(js "d['verify_slots']['source']" "$J" 2>/dev/null)" "0|[(0, 'free'), (1, 'free')]|fallback" \
    "O3k2: a CLI answer $shape (exit 0): status rc 0, two slots, fallback"
  has "$(cat "$D/k2.err")" "verify-slot: WARN cannot read verify_slots (" "O3k2: … with a WARN ($shape)"
done
out=$(cd "$D" && HOME="$H3" THREAD_TOML_PYTHONS="$tmp/shapepy" SHAPE='[]' python3 -I "$tmp/notoml_shim.py" "$VS" run -- sh -c 'echo ran' 2> "$D/k2r.err"); rc=$?
ok "$rc|$out" "0|ran" "O3k2: run under the [] answer: rc 0, the command ran"
got=$(python3 -B - "$VS" "$RS" <<'PY'
import importlib.util, sys
def load(name, p):
    spec = importlib.util.spec_from_file_location(name, p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
vs, rs = load("verify_slot", sys.argv[1]), load("thread_rollout_settings", sys.argv[2])
print(vs.BUILT_IN_SLOTS, rs.BUILT_IN["verify_slots"], vs.BUILT_IN_SLOTS == rs.BUILT_IN["verify_slots"])
PY
)
ok "$got" "2 2 True" "O3k3: verify-slot.py's BUILT_IN_SLOTS is rollout-settings.py's built-in verify_slots"

# ======== O6b: lead-integrate.py's lone --slot-wait, a TERM while it resolves ===================================
pool o6b
mkdir -p "$D/tree"
cat > "$D/li.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("lead_integrate", sys.argv[1]); li = importlib.util.module_from_spec(spec); spec.loader.exec_module(li)
li.VS.RESOLVE_TIMEOUT = 120
sys.exit(li.main(sys.argv[2:]))
PY
H6="$tmp/h6b"; home "$H6" '[defaults]' 'verify_slots = 3'
HOME="$H6" THREAD_TOML_PYTHONS="$tmp/slowpy" SLOWPID="$D/slow" python3 "$tmp/notoml_shim.py" "$D/li.py" "$LI" verify --tree "$D/tree" \
  --out "$D/o" --timeout 60 --slot-wait 60 --verifier "touch '$D/ran'" > /dev/null 2>&1 &
lp=$!; pids+=($lp)
within 30 nonempty "$D/slow" && s=started || s="slowpy never started in 30 s"
ok "$s" started "O6b: verify with a lone --slot-wait, no tomllib: its resolver candidate (slowpy) started"
kill -TERM "$lp"; wait "$lp"
ok "$(cat "$D/o.rc" 2>/dev/null)" 143 "O6b: a TERM while verify resolves → rc 143"
has "$(cat "$D/o.log" 2>/dev/null)" "verify: stopped by signal 15" "O6b: … its log says so"
ok "$([ -e "$D/ran" ] && echo ran || echo never)" never "O6b: … the verifier never ran"
within 30 gone "$(cat "$D/slow")" && s=gone || s="slowpy alive after 30 s"
ok "$s" gone "O6b: … and the resolver child is gone"

# ======== O4: the line =========================================================================================
nqueue() { count '^queue-.*\.wait$'; }
nwaiters() { count '^waiter-.*\.wait$'; }
queued() { [ "$(nqueue)" -ge "$1" ]; }
has_waiter() { [ "$(nwaiters)" -ge 1 ]; }
# entry <name> <file in SL> <seq|-> <touch|stale|still>: a live line or waiter entry held LOCK_EX until <name>.go, its
# record {pid, cwd, since, kind, poll 0.1[, seq]}; touch: its mtime refreshed every 0.2 s (an awake waiter); stale: set
# 60 s back once and never touched (a stopped one); still: never touched.
cat > "$tmp/entry.py" <<'PY'
import fcntl, json, os, sys, time
path, go, seq, mode = sys.argv[1:5]
os.makedirs(os.path.dirname(path), exist_ok=True)
fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
fcntl.flock(fd, fcntl.LOCK_EX)
rec = {"pid": os.getpid(), "cwd": os.path.dirname(go), "since": "2026-01-01T00:00:00+00:00", "kind": "run", "poll": 0.1}
if seq != "-":
    rec["seq"] = int(seq)
os.ftruncate(fd, 0)
os.pwrite(fd, (json.dumps(rec) + "\n").encode(), 0)
if mode == "stale":
    t = time.time() - 60
    os.utime(fd, (t, t))
open(go + ".ready", "w").close()
while not os.path.exists(go):
    if mode == "touch":
        os.utime(fd)
    time.sleep(0.2)
PY
entry() {
  python3 "$tmp/entry.py" "$SL/$2" "$D/$1.go" "$3" "$4" > /dev/null 2>&1 &
  echo $! > "$D/$1.w"; pids+=($!)
  within 300 exists "$D/$1.go.ready" || echo "FAIL - $1: the entry helper did not start within 300 s"
}
pool o4a
entry qa "queue-1-a.wait" 1 touch
python3 "$VS" run --slots 1 --slot-wait 2 -- touch "$D/a.ran" > /dev/null 2> "$D/a.err"; rc=$?
ok "$rc|$([ -e "$D/a.ran" ] && echo ran || echo never)" "76|never" "O4a: a free slot with an awake run ahead in line: --slot-wait 2 → 76, never ran"
has "$(cat "$D/a.err")" "verify-slot: no verdict: no verify slot within 2s; exit 76" "O4a: … its no-verdict line"
has "$(cat "$D/a.err")" "1 run(s) ahead in line" "O4a: … its waiting line names the run ahead"
ok "$(nqueue)" 1 "O4a: … and its own entry is gone (only the helper's is left)"
touch "$D/qa.go"; wait "$(w qa)"

pool o4b
mkdir -p "$SL"; printf '{"pid": 99999, "seq": 1}\n' > "$SL/queue-99999-x.wait"; : > "$SL/.queue-99998-y.tmp"
python3 "$VS" run --slots 1 --slot-wait 2 -- true 2> "$D/b.err"; rc=$?
ok "$rc|$(grep -c waiting "$D/b.err")" "0|0" "O4b: a stale line entry (nobody holds it) holds no run off"
ok "$(count queue)" 0 "O4b: … the stale .wait and .tmp are reaped"

pool o4c
hold h 1
python3 "$VS" run --slots 1 -- sh -c "echo A >> '$D/order'; until [ -e '$D/A.go' ]; do sleep 0.1; done" > /dev/null 2> "$D/A.err" &
echo $! > "$D/A.w"; pids+=($!)
within 300 queued 1 || echo "FAIL - O4c: A never joined the line"
python3 "$VS" run --slots 1 -- sh -c "echo B >> '$D/order'" > /dev/null 2> "$D/B.err" &
echo $! > "$D/B.w"; pids+=($!)
within 300 queued 2 || echo "FAIL - O4c: B never joined the line"
touch "$D/h.go"
within 300 nonempty "$D/order" && s=$(head -1 "$D/order") || s="nobody ran in 300 s"
ok "$s" A "O4c: the freed slot goes to A, first in line"
has "$(cat "$D/B.err")" "1 run(s) ahead in line" "O4c: … B's waiting line names the run ahead of it"
touch "$D/A.go"
wait "$(w A)"; wait "$(w B)"; wait "$(w h)"
ok "$(tr '\n' ' ' < "$D/order")" "A B " "O4c: A, then B"
ok "$(nqueue)" 0 "O4c: no line entry left"

pool o4d
hold h 1
python3 "$VS" run --slots 1 -- sh -c "echo A >> '$D/order'" > /dev/null 2> "$D/A.err" &
echo $! > "$D/A.w"; pids+=($!)
within 300 queued 1 || echo "FAIL - O4d: A never joined the line"
python3 "$VS" run --slots 1 --priority -- sh -c "echo P >> '$D/order'" > /dev/null 2> "$D/P.err" &
echo $! > "$D/P.w"; pids+=($!)
within 300 has_waiter || echo "FAIL - O4d: P never registered"
touch "$D/h.go"
wait "$(w P)"; wait "$(w A)"; wait "$(w h)"
ok "$(tr '\n' ' ' < "$D/order")" "P A " "O4d: a --priority run takes the freed slot before the line"

pool o4e
entry qe "queue-1-e.wait" 1 stale
python3 "$VS" run --slots 1 --slot-wait 20 -- true 2> "$D/e.err"; rc=$?
ok "$rc" 0 "O4e: an asleep entry ahead (not touched for 60 s) is passed over: rc 0"
J=$(python3 "$VS" status --slots 1)
ok "$(js "[(q['pid'], q['asleep']) for q in d['queue']]" "$J")" "[($(w qe), True)]" "O4e: … status lists it asleep"
ok "$([ -e "$SL/queue-1-e.wait" ] && echo kept || echo reaped)" kept "O4e: … and it is not reaped (its flock is held)"
touch "$D/qe.go"; wait "$(w qe)"

pool o4f
hold h 1
python3 "$VS" run --slots 1 -- sh -c "echo A >> '$D/order'" > /dev/null 2> "$D/A.err" &
ap=$!; echo "$ap" > "$D/A.w"; pids+=($ap)
within 300 queued 1 || echo "FAIL - O4f: A never joined the line"
kill -STOP "$ap"; stopped+=($ap)
touch "$D/h.go"; wait "$(w h)"
python3 "$VS" run --slots 1 --slot-wait 120 -- sh -c "echo C >> '$D/order'" > /dev/null 2> "$D/C.err" &
cp=$!; pids+=($cp)
within 60 gone "$cp" && s=done || s="C still waiting after 60 s"
ok "$s" done "O4f: a stopped run ahead in line goes asleep and C takes the slot"
wait "$cp"; ok "$?" 0 "O4f: … C exits 0"
kill -CONT "$ap"
wait "$ap"; ok "$?" 0 "O4f: once A wakes it takes its place again and runs: rc 0"
ok "$(tr '\n' ' ' < "$D/order")" "C A " "O4f: C, then A"

pool o4g
python3 "$VS" run --slots 1 -- true 2> /dev/null
L0=$(ls -A "$SL")
python3 "$VS" run --slots 1 -- true 2> "$D/g.err"
ok "$(ls -A "$SL")|$(grep -c waiting "$D/g.err")" "$L0|0" "O4g: an uncontended run leaves the slots dir as it found it (no line entry)"

pool o4h
entry qh "queue-1-h.wait" 5 touch
got=$(python3 -B - "$VS" "$SL/queue-1-h.wait" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("verify_slot", sys.argv[1]); vs = importlib.util.module_from_spec(spec); spec.loader.exec_module(vs)
path = sys.argv[2]
before = "read" if vs._probe_entry(path) is not None else "skipped"
real = os.stat
def swap(p, *a, **k):   # the name is reaped and recreated (a new inode) between the probe's open and its stat
    os.stat = real
    os.unlink(path)
    with open(path, "w") as f:
        f.write('{"pid": 1, "seq": 99}\n')
    os.utime(path, (1, 1))
    return real(p, *a, **k)
os.stat = swap
got = vs._probe_entry(path)
os.stat = real
print(before, "read" if got is not None else "skipped", "kept" if os.path.exists(path) else "gone")
PY
)
ok "$got" "read skipped kept" "O4h: _probe_entry reads a held entry, and skips a name replaced between its open and its stat"
touch "$D/qh.go"; wait "$(w qh)"

# ======== O5: status lists the line ============================================================================
pool o5
entry q5 "queue-1-five.wait" 5 touch
entry q3 "queue-1-three.wait" 3 stale
mkdir -p "$SL"; printf '{"pid": 99999, "seq": 1}\n' > "$SL/queue-99999-x.wait"; : > "$SL/.queue-99998-y.tmp"
J=$(python3 "$VS" status --slots 1)
ok "$(js "[(q['pid'], q['asleep']) for q in d['queue']]" "$J")" "[($(w q3), True), ($(w q5), False)]" "O5: status lists the line oldest first, with asleep flags"
ok "$(js "sorted(d['queue'][0])" "$J")" "['asleep', 'cwd', 'kind', 'pid', 'since']" "O5: … each entry {pid, cwd, since, kind, asleep}"
ok "$(count '99999|99998')" 0 "O5: … and reaps a stale queue-*.wait and .queue-*.tmp"
touch "$D/q5.go" "$D/q3.go"; wait "$(w q5)"; wait "$(w q3)"

echo; [ "$fail" -eq 0 ] && echo "verify-slot-own: ALL PASS" || echo "verify-slot-own: SOME FAILED"
exit "$fail"
