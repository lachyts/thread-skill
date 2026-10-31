#!/usr/bin/env bash
# p34-1, executed: what skills/execute/scripts/verify-slot.py does for itself (its header: contract items 3, 5 and 6, and
# the `run` and `status` paragraphs).
#   O1  the guard starts isolated (`-I`): a shadowing json.py on PYTHONPATH, or a bogus PYTHONHOME, no longer stops
#       `run`, and the command still gets both
#   O2  the marker: a command in a held slot sees VERIFY_SLOT_HELD=1, a reparented one too, and so does
#       lead-integrate.py's slotted step; an unslotted (fail-open) run does not
# Structural, never a stopwatch (p22-1): holders hold until a `.go` file appears; every wait is a `within <s>` poll
# whose bound only slows a real failure. Every background pid is recorded and stopped only by that pid.
# Hermetic: every pool lives under mktemp (THREAD_VERIFY_SLOTS_DIR), the Run record too.
# The gate's own slot marker is unset at top level, so a suite run inside a slot reads as one that is not.
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

echo; [ "$fail" -eq 0 ] && echo "verify-slot-own: ALL PASS" || echo "verify-slot-own: SOME FAILED"
exit "$fail"
