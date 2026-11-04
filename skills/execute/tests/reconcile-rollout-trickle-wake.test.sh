#!/usr/bin/env bash
# p28-9: a Trickle-waiting lead re-checks sooner (skills/execute/away.md § The Trickle, *A waiting lead re-checks
# sooner*). A lead's `next` that keeps places for other rollouts (`trickle.kept`) writes one wake per kept-for rollout
# into trickle-claims.json's `woken` list, {tasksDir, rollout, at, by}, off --dry-run, under the trickle claim lock, in
# the same claims write; `at` is the later of the giver's now and the kept-for rollout's waiting record's `at`. The
# waiting lead's `trickle-wait --rollout <note>` (execute § 4.5 step 1.6), read-only and lock-free, polls the file and
# exits 0 once a wake for its rollout is at or after its baseline (its own waiting record's `at`, or its last `next`'s
# lease, `by: next`, if later; never a `record-entry`'s, and never moving back within one wait), 3 with nothing to wait
# for, 75 after --timeout, 2 on usage. The rollout's own `next`, when its write succeeds, consumes its wake. The task's
# Verify: two rollouts at N = 1, one refilling and one waiting: the kept place is taken within one trickle-wait poll of
# being kept, and the machine-wide count never passes N from a start.
#
# Each scenario pins its own lock dir ($L) and HOME ($D/home), as the share suite does. --now is pinned (a later one
# wins). Every background process is recorded by pid and killed by that pid at exit. Temp notes only.
# Usage: bash reconcile-rollout-trickle-wake.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
export THREAD_MACHINE_TIMES='{}'   # no boot or wake evidence (record-entry's and the lease's machine_times, p28-4)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # THREAD_HEAT_LEVEL=0
TMP="$(cd "$(mktemp -d)" && pwd -P)"
PIDS=()   # every background process this suite starts, killed by pid at exit if still alive
cleanup() {
  local p
  for p in ${PIDS[@]+"${PIDS[@]}"}; do kill -0 "$p" 2>/dev/null && kill "$p" 2>/dev/null; done
  chmod -R u+w "$TMP" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"   # the backstop: every call pins its scenario's own $L (header)
NOW=2026-10-02T14:05:00Z
HOUR_AGO=2026-10-02T13:05:00Z
TONIGHT=2026-10-02T22:05:00Z
ST='started: 2026-10-02T13:00+00:00'   # a counted task's § 4 stamp: served at 13:00

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }

D=""; L=""
# scen <name>: a fresh tasks dir $D (HOME $D/home, no away file) and its own lock dir $L.
scen() { D="$TMP/$1"; L="$TMP/locks-$1"; mkdir -p "$D/home"; echo "== $1"; }
# mkro <stem> <ceiling> [frontmatter lines...] — a rollout note in $D; its tasks list themselves as they are made (mkt).
mkro() {
  local s="$1" c="$2"; shift 2
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: %s\n' "$c"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nfixture\n\n## Queue\n\n'; } > "$D/$s.md"
}
# mkt <slug> <rollout> <status> [frontmatter lines...] — a task note in $D, appended to its rollout's queue list.
mkt() {
  local s="$1" ro="$2" st="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\n' "$st" "$ro"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
  [ -f "$D/$ro.md" ] && printf -- '- [[%s]]\n' "$s" >> "$D/$ro.md"
  return 0
}
# run1 <slug> <rollout> [started stamp] — a counted running task: in_progress, owner (the rollout started) and started.
run1() { mkt "$1" "$2" in_progress "owner: lead-$2" "${3:-$ST}"; }
# at <minutes> — NOW plus that many minutes (negative, fractional: seconds), as a --now value.
at() { python3 -c 'import sys
from datetime import datetime, timedelta
print((datetime.fromisoformat("2026-10-02T14:05:00+00:00") + timedelta(minutes=float(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"; }
# nx <rollout> [next flags...] — `next` on $D/<rollout>.md with this scenario's lock dir and HOME; stderr lands in $D/err.
nx() {
  local ro="$1"; shift
  THREAD_NOTE_LOCK_DIR="$L" HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/$ro.md" --tasks-dir "$D" --now "$NOW" "$@" \
    2>"$D/err"
}
# tw <rollout> [trickle-wait flags...] — the trickle wait in the foreground, stdout only (stderr in $D/tw-err); a later
# --now wins.
tw() {
  local ro="$1"; shift
  THREAD_NOTE_LOCK_DIR="$L" HOME="$D/home" python3 "$SCRIPT" trickle-wait --rollout "$D/$ro.md" --tasks-dir "$D" --now "$NOW" "$@" \
    2>"$D/tw-err"
}
# twbg <name> <rollout> [flags...] — the same wait in the background: stdout in $D/<name>.out, its pid in $BG (and PIDS).
twbg() {
  local name="$1" ro="$2"; shift 2
  THREAD_NOTE_LOCK_DIR="$L" HOME="$D/home" python3 "$SCRIPT" trickle-wait --rollout "$D/$ro.md" --tasks-dir "$D" \
    --now "$NOW" "$@" >"$D/$name.out" 2>"$D/$name.err" &
  BG=$!; PIDS+=($BG)
}
# gone <pid> <tenths> — "gone" once the process has exited, polled every 0.1 s for at most that many tenths, else "alive".
gone() { local i; for i in $(seq "$2"); do kill -0 "$1" 2>/dev/null || { echo gone; return; }; sleep 0.1; done
  if kill -0 "$1" 2>/dev/null; then echo alive; else echo gone; fi; }
# rc_of <pid> — the exit code of a background process already gone.
rc_of() { wait "$1" 2>/dev/null; echo $?; }
# rec <rollout> <now> — a heartbeat tick's record-entry (it rewrites the lease, by entry).
rec() { THREAD_NOTE_LOCK_DIR="$L" HOME="$D/home" python3 "$SCRIPT" record-entry --rollout "$D/$1.md" --by heartbeat --session s1 \
  --now "$2" >/dev/null 2>"$D/rec-err"; }
err() { cat "$D/err"; }
lines() { if [ -s "$D/err" ]; then wc -l < "$D/err" | tr -d ' '; else echo 0; fi; }
# q <json> <python-expr over d> — compact JSON of the expression ('PARSE' when stdout is not one JSON object)
q() { printf '%s' "$1" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("PARSE"); sys.exit(0)
print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
share='[d["trickle"].get("kept"), d["slotLimit"], d["start"]]'
CF() { echo "$L/trickle-claims.json"; }
sum1() { if [ -e "$1" ]; then cksum < "$1" | tr -d ' \t'; else echo none; fi; }
# under <json> <N> <label> — the Verify's other half: after a call that starts, the Mac-wide count never passes N.
under() {
  local r; r=$(q "$1" 'd["trickle"]["running"]')
  if [ "$r" -le "$2" ] 2>/dev/null; then echo "ok   - $3: trickle.running $r <= $2"; else echo "FAIL - $3: trickle.running [$r] > $2"; fail=1; fi
}
# stamp <slug> [status|-] [owner] [started] — rewrite a task note's `status:` (unless "-"), `owner:` and `started:` (each
# when given) through a temp file and os.replace, as an Edit-tool or Obsidian save lands (whole, never torn).
STAMP_PY='import os, re, sys
p, st, owner, started = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
m = re.match(r"^---\n(.*?\n)---\n(.*)$", open(p).read(), re.S)
fm = m.group(1).rstrip("\n").split("\n")
if st != "-":
    fm = [("status: " + st) if l.startswith("status:") else l for l in fm]
if owner:
    fm = [l for l in fm if not l.startswith("owner:")] + ["owner: " + owner]
if started:
    fm = [l for l in fm if not l.startswith("started:")] + ["started: " + started]
tmp = p + ".stamp.tmp"
with open(tmp, "w") as f:
    f.write("---\n" + "\n".join(fm) + "\n---\n" + m.group(2))
os.replace(tmp, p)'
stamp() { python3 -c "$STAMP_PY" "$D/$1.md" "${2:-in_progress}" "${3:-}" "${4:-}"; }
# seedk <claims> <waiting> <woken> — write $L/trickle-claims.json as {"version": 1, "claims", "waiting", "woken"}. In
# each expression: D is this tasks dir's realpath, NOW the suite's --now and WALL the real clock (both aware), m(n) n
# minutes, s(n) n seconds, w(tasksDir, rollout, since, at, served, want) one waiting record and k(tasksDir, rollout, at,
# by) one wake, each time to the second (served None stays null). A woken of "-" leaves the key out (p28-5's shape).
SEED_PY='import json, os, sys
from datetime import datetime, timedelta, timezone
D = os.path.realpath(sys.argv[2])
NOW = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00"))
WALL = datetime.now(timezone.utc)
m = lambda n: timedelta(minutes=n)
s = lambda n: timedelta(seconds=n)
iso = lambda t: t.isoformat(timespec="seconds") if isinstance(t, datetime) else t
w = lambda td, ro, since, at, served, want: {"tasksDir": td, "rollout": ro, "since": iso(since), "at": iso(at),
                                            "served": iso(served), "want": want}
k = lambda td, ro, at, by: {"tasksDir": td, "rollout": ro, "at": iso(at), "by": by}
data = {"version": 1, "claims": eval(sys.argv[4]), "waiting": eval(sys.argv[5])}
if sys.argv[6] != "-":
    data["woken"] = eval(sys.argv[6])
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
with open(sys.argv[1], "w") as f:
    json.dump(data, f)'
seedk() { python3 -c "$SEED_PY" "$(CF)" "$D" "$NOW" "$1" "$2" "$3"; }
# addwake <woken-expr> — append wakes (as seedk's k(...)) to the claims file's `woken` list, the rest as it is.
ADD_PY='import json, os, sys
from datetime import datetime, timedelta, timezone
D = os.path.realpath(sys.argv[2])
NOW = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00"))
m = lambda n: timedelta(minutes=n)
s = lambda n: timedelta(seconds=n)
iso = lambda t: t.isoformat(timespec="seconds") if isinstance(t, datetime) else t
k = lambda td, ro, at, by: {"tasksDir": td, "rollout": ro, "at": iso(at), "by": by}
d = json.load(open(sys.argv[1]))
d["woken"] = (d.get("woken") if isinstance(d.get("woken"), list) else []) + eval(sys.argv[4])
json.dump(d, open(sys.argv[1], "w"))'
addwake() { python3 -c "$ADD_PY" "$(CF)" "$D" "$NOW" "$1"; }
# rawf <python expression> — write $L/trickle-claims.json as that object (D, NOW, WALL as in seedk; m and s too).
rawf() { python3 -c 'import json, os, sys
from datetime import datetime, timedelta, timezone
D = os.path.realpath(sys.argv[2])
NOW = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00"))
WALL = datetime.now(timezone.utc)
m = lambda n: timedelta(minutes=n)
iso = lambda t: t.isoformat(timespec="seconds")
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
json.dump(eval(sys.argv[4]), open(sys.argv[1], "w"))' "$(CF)" "$D" "$NOW" "$1"; }
# woken [all] — the wakes as sorted compact JSON: [[rollout, by, HH:MM], …] for this tasks dir (UTC, HH:MM:SS off the
# minute), or with `all` [[where, rollout], …] for every wake, where "here" or its tasksDir. "none" with no file,
# "nokey" when the file has no `woken` list.
WOKEN_PY='import json, os, sys
from datetime import datetime, timezone
p, here, every = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3] == "all"
if not os.path.exists(p):
    print("none"); sys.exit(0)
d = json.load(open(p, encoding="utf-8"))
if not isinstance(d.get("woken"), list):
    print("nokey"); sys.exit(0)
def hm(v):
    t = datetime.fromisoformat(v).astimezone(timezone.utc)
    return t.strftime("%H:%M") if t.second == 0 else t.strftime("%H:%M:%S")
out = []
for e in d["woken"]:
    if every:
        out.append(["here" if e["tasksDir"] == here else e["tasksDir"], e["rollout"]])
    elif e["tasksDir"] == here:
        out.append([e["rollout"], e["by"], hm(e["at"])])
print(json.dumps(sorted(out, key=json.dumps), separators=(",", ":")))'
woken() { python3 -c "$WOKEN_PY" "$(CF)" "$D" "${1:-}"; }
# others — the claims file's claims and waiting lists, compact (to show a rewrite changed only the wakes).
others() { python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(json.dumps([d["claims"], d["waiting"]], sort_keys=True))' "$(CF)"; }
# fshape — the claims file's top-level keys in order and its version.
fshape() { python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(json.dumps([list(d), d.get("version")], separators=(",", ":")))' "$(CF)"; }
# the lease, as a lead's call writes it (p28-4): lease <stem> <written_at> [by]; leased <stem> its [rollout, written_at, by].
LEASES=home/.config/thread/leases
lease() { mkdir -p "$D/$LEASES"; printf '{"rollout": "%s", "written_at": "%s", "by": "%s"}' "$1" "$2" "${3:-next}" > "$D/$LEASES/$1.json"; }
leased() { python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(json.dumps([d["rollout"], d["written_at"], d["by"]], separators=(",", ":")))' "$D/$LEASES/$1.json"; }
# holder — hold the trickle claim lock from a background process (its pid in $HOLDER) until killed.
holder() {
  mkdir -p "$L"; rm -f "$L/ready"
  python3 -c 'import fcntl, sys, time
fh = open(sys.argv[1], "a")
fcntl.flock(fh, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(120)' "$L/trickle.lock" "$L/ready" &
  HOLDER=$!; PIDS+=($HOLDER)
  local i; for i in $(seq 100); do [ -e "$L/ready" ] && break; sleep 0.1; done
}
T='tasks running on this Mac'
WOKE='trickle wait: a place is kept for'
NONE='trickle wait: nothing to wait for:'

# ── W1, the task's Verify (fails first): N = 1, one rollout refilling and one waiting, the hand-over both ways ───────
scen w1-verify
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open
mkro ro-b 3; mkt b1 ro-b open
nx ro-a >/dev/null
J=$(nx ro-b --now "$(at 5)")
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 1/1 $T\"]" "W1: 14:10 ro-b waits on the Trickle"
twbg w1b ro-b --now "$(at 5)" --poll 0.1 --timeout 60
sleep 0.5
ok "$(kill -0 "$BG" 2>/dev/null && echo alive || echo gone)" alive "W1: ro-b's trickle wait is running (no place kept yet)"
stamp a1 review
J=$(nx ro-a --now "$(at 6)")
ok "$(q "$J" '[d["start"], d["trickle"]["kept"]]')" '[[],{"ro-b":1}]' "W1: 14:11 a1 lands: ro-a starts nothing and keeps the place for ro-b"
ok "$(woken)" '[["ro-b","ro-a","14:11"]]' "W1: … and writes ro-b's wake, by ro-a, at 14:11"
t0=$(python3 -c 'import time; print(time.monotonic())')
ok "$(gone "$BG" 30)" gone "W1: ro-b's trickle wait returns within 3 s of the wake"
t1=$(python3 -c 'import time; print(time.monotonic())')
ok "$(python3 -c "print('fast' if $t1 - $t0 < 3 else 'slow')")" fast "W1: … timed under 3 s"
ok "$(rc_of "$BG")" 0 "W1: … exit 0"
ok "$(cat "$D/w1b.out")" "$WOKE [[ro-b]] by [[ro-a]]" "W1: … with the wake line"
J=$(nx ro-b --now "$(at 6)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "W1: ro-b's turn starts b1 into the kept place"
under "$J" 1 "W1: ro-b's start"
ok "$(woken)" '[]' "W1: … and ro-b's own next consumes its wake"
# The reverse hand-over: ro-a now waits (its 14:11 record), and ro-b's next keeps the freed place for it.
twbg w1a ro-a --now "$(at 7)" --poll 0.1 --timeout 60
sleep 0.5
ok "$(kill -0 "$BG" 2>/dev/null && echo alive || echo gone)" alive "W1: ro-a's trickle wait is running"
stamp b1 review lead-ro-b 2026-10-02T14:11+00:00
J=$(nx ro-b --now "$(at 8)")
ok "$(q "$J" '[d["start"], d["trickle"]["kept"]]')" '[[],{"ro-a":1}]' "W1: 14:13 b1 lands: ro-b keeps the place for ro-a"
ok "$(woken)" '[["ro-a","ro-b","14:13"]]' "W1: … and writes ro-a's wake"
ok "$(gone "$BG" 30)" gone "W1: ro-a's trickle wait returns within 3 s"
ok "$(rc_of "$BG")" 0 "W1: … exit 0"
ok "$(cat "$D/w1a.out")" "$WOKE [[ro-a]] by [[ro-b]]" "W1: … with the wake line"
J=$(nx ro-a --now "$(at 8)")
ok "$(q "$J" 'd["start"]')" '["a2"]' "W1: ro-a's turn starts a2"
under "$J" 1 "W1: ro-a's start"
ok "$(woken)" '[]' "W1: … and its wake is consumed"

# ── W2: no wake: the wait times out (75) and the file is left byte-identical ─────────────────────────────────────────
scen w2-timeout
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[]'
before=$(sum1 "$(CF)")
out=$(tw ro-b --poll 0.1 --timeout 0.5); rc=$?
ok "$rc" 75 "W2: no wake: exit 75 after --timeout"
ok "$out" "trickle wait: no place kept for [[ro-b]] within 0.5 s" "W2: … with the timeout line"
ok "$(sum1 "$(CF)")" "$before" "W2: … and the claims file is byte-identical (it writes nothing)"
ok "$([ -e "$L/trickle.lock" ] && echo lock || echo nolock)" nolock "W2: … and takes no lock"

# ── W3: nothing to wait for → 3 ──────────────────────────────────────────────────────────────────────────────────────
scen w3-no-file
mkro ro-b 3; mkt b1 ro-b open
out=$(tw ro-b --timeout 5); rc=$?
ok "$rc" 3 "W3 (no file): exit 3"
ok "$out" "$NONE [[ro-b]] has no waiting record" "W3 (no file): … no waiting record"
scen w3-no-record
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-x", NOW - m(5), NOW - m(1), None, 1)]' '[k(D, "ro-b", NOW, "ro-a")]'
out=$(tw ro-b --timeout 5); rc=$?
ok "$rc|$out" "3|$NONE [[ro-b]] has no waiting record" "W3 (no own record): exit 3, even with a wake standing"
scen w3-lapsed
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(40), NOW - m(30), None, 1)]' '[k(D, "ro-b", NOW, "ro-a")]'
out=$(tw ro-b --timeout 5); rc=$?
ok "$rc|$out" "3|$NONE [[ro-b]] has no waiting record" "W3 (lapsed): an own record 30 minutes old by --now is none"
scen w3-elsewhere
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w("/elsewhere", "ro-b", WALL - m(5), WALL - m(1), None, 1)]' '[]'
out=$(tw ro-b --timeout 5); rc=$?
ok "$rc|$out" "3|$NONE [[ro-b]] has no waiting record" "W3 (another tasks dir): another dir's record is never this rollout's"
scen w3-version-2
mkro ro-b 3; mkt b1 ro-b open
rawf '{"version": 2, "claims": [], "waiting": []}'
out=$(tw ro-b --timeout 5); rc=$?
ok "$rc|$out" "3|$NONE trickle claims $(CF) version 2" "W3 (version 2): another version"
scen w3-not-json
mkro ro-b 3; mkt b1 ro-b open
mkdir -p "$L"; printf 'nope' > "$(CF)"
out=$(tw ro-b --timeout 5); rc=$?
ok "$rc|$out" "3|$NONE trickle claims $(CF) unreadable: not JSON" "W3 (not JSON): unreadable"
# A running wait exits 3 once its own next (everything started) removes the record, and that write drops the stale wake.
scen w3-started
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-x 3; run1 x1 ro-x
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
addwake '[k(D, "ro-b", NOW - m(5), "ro-x")]'
twbg w3s ro-b --poll 0.1 --timeout 60
sleep 0.5
ok "$(kill -0 "$BG" 2>/dev/null && echo alive || echo gone)" alive "W3 (started): a wake older than the record does not wake the wait"
stamp x1 review
J=$(nx ro-b --now "$(at 1)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "W3 (started): x1 lands and ro-b's own next starts b1"
ok "$(woken)" '[]' "W3 (started): … its write drops the stale wake"
ok "$(gone "$BG" 30)" gone "W3 (started): … and the running wait returns"
ok "$(rc_of "$BG")|$(cat "$D/w3s.out")" "3|$NONE [[ro-b]] has no waiting record" "W3 (started): … exit 3, its record gone"

# ── W4: the baseline: the own record, or the last next's lease if later; never a record-entry's ──────────────────────
scen w4-older
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[k(D, "ro-b", NOW - m(2), "ro-a")]'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W4 (older): a wake older than the own record never wakes (75)"
scen w4-equal
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[k(D, "ro-b", NOW - m(1), "ro-a")]'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc|$out" "0|$WOKE [[ro-b]] by [[ro-a]]" "W4 (equal): a wake in the record's second wakes (0)"
# The lock-failure loop guard: a waiter's next that cannot take the lock writes its lease (by next) after the wake and
# no record, so the wake it already saw never fires again.
scen w4-lock
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-x 3; run1 x1 ro-x
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
addwake '[k(D, "ro-b", NOW + m(1), "ro-a")]'
out=$(tw ro-b --now "$(at 2)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 0 "W4 (lock): the 14:06 wake wakes a wait whose lead last looked at 14:05"
holder
THREAD_NOTE_LOCK_TIMEOUT=1 nx ro-b --now "$(at 2)" >/dev/null
has "$(err)" "WARN: trickle claims $L/trickle.lock: " "W4 (lock): ro-b's next at 14:07 cannot take the lock"
kill "$HOLDER"; wait "$HOLDER" 2>/dev/null
ok "$(leased ro-b)" '["ro-b","2026-10-02T14:07:00Z","next"]' "W4 (lock): … it writes its lease, by next"
ok "$(woken)" '[["ro-b","ro-a","14:06"]]' "W4 (lock): … and neither a record nor the wake moves"
out=$(tw ro-b --now "$(at 2)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W4 (lock): the next wait reads the 14:07 lease as its baseline: the 14:06 wake never fires again (75)"
# The reviewer's case: a heartbeat tick's record-entry after the wake rewrites the lease by entry, which never counts.
scen w4-entry
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-x 3; run1 x1 ro-x
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
addwake '[k(D, "ro-b", NOW + m(1), "ro-a")]'
rec ro-b "$(at 2)"
ok "$(leased ro-b)" '["ro-b","2026-10-02T14:07:00Z","entry"]' "W4 (entry): a tick's record-entry at 14:07 rewrites the lease by entry"
out=$(tw ro-b --now "$(at 2)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc|$out" "0|$WOKE [[ro-b]] by [[ro-a]]" "W4 (entry): … the entry lease is no baseline: the 14:06 wake still wakes (0)"
# Monotone: a running wait that saw a next's lease after the wake remembers it when a record-entry rewrites it.
scen w4-monotone
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-x 3; run1 x1 ro-x
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
addwake '[k(D, "ro-b", NOW + m(1), "ro-a")]'
lease ro-b 2026-10-02T14:07:00Z next
twbg w4m ro-b --now "$(at 2)" --poll 0.1 --timeout 3
sleep 1.5   # the wait has read the next's lease (well past its start-up, even on a loaded Mac) before the entry lands
rec ro-b "$(at 3)"
ok "$(leased ro-b)" '["ro-b","2026-10-02T14:08:00Z","entry"]' "W4 (monotone): a record-entry rewrites the lease by entry mid-wait"
ok "$(gone "$BG" 50)" gone "W4 (monotone): the wait returns at its timeout"
ok "$(rc_of "$BG")" 75 "W4 (monotone): … 75: its baseline never moved back to the record's 14:05"
# A next's lease more than 5 minutes ahead of --now is no baseline; one exactly 5 minutes ahead is.
scen w4-skew
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-x 3; run1 x1 ro-x
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
addwake '[k(D, "ro-b", NOW + m(1), "ro-a")]'
lease ro-b 2026-10-02T14:10:01Z next
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 0 "W4 (skew): a lease 5 min 1 s ahead is ignored: the wake wakes (0)"
lease ro-b 2026-10-02T14:10:00Z next
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W4 (skew): one exactly 5 minutes ahead counts: no wake (75)"

# ── W5: matching ─────────────────────────────────────────────────────────────────────────────────────────────────────
scen w5-match
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[k(D, "ro-c", NOW, "ro-a")]'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W5: another rollout's wake (ro-c) never wakes ro-b"
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[k("/elsewhere", "ro-b", WALL, "ro-a")]'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W5: a wake from another tasks dir never wakes ro-b"
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[k(D, "RO-B", NOW, "ro-a")]'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc|$out" "0|$WOKE [[ro-b]] by [[ro-a]]" "W5: a case variant (RO-B) matches"
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' \
  '[5, {"tasksDir": D, "rollout": "ro-b"}, k(D, "ro-b", "nope", "ro-a"), k(D, "ro-b", NOW, "")]'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc|$(cat "$D/tw-err")" "75|" "W5: malformed wakes are dropped silently (75, no stderr)"

# ── W6: the giver's writes ───────────────────────────────────────────────────────────────────────────────────────────
scen w6-two
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a
mkro ro-b 3; mkt b1 ro-b open
mkro ro-c 3; mkt c1 ro-c open
nx ro-b >/dev/null; nx ro-c >/dev/null
stamp a1 review; stamp a2 review
J=$(nx ro-a --now "$(at 1)")
ok "$(q "$J" 'd["trickle"]["kept"]')" '{"ro-b":1,"ro-c":1}' "W6 (two): two places kept"
ok "$(woken)" '[["ro-b","ro-a","14:06"],["ro-c","ro-a","14:06"]]' "W6 (two): … two wakes"
# A repeat by a giver with no waiting record of its own, the same kept and a later --now rewrites only the wake's at.
scen w6-repeat
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; run1 a1 ro-a
mkro ro-b 3; mkt b1 ro-b open
nx ro-b --now "$(at 5)" >/dev/null
stamp a1 review
nx ro-a --now "$(at 6)" >/dev/null
ok "$(woken)" '[["ro-b","ro-a","14:11"]]' "W6 (repeat): ro-a (nothing queued) keeps the place for ro-b: a wake at 14:11"
lease ro-b 2026-10-02T14:11:30Z next
out=$(tw ro-b --now "$(at 7)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W6 (repeat): a waiter whose baseline is 14:11:30 is not woken by it"
b1sum=$(sum1 "$(CF)"); b1oth=$(others)
nx ro-a --now "$(at 7)" >/dev/null
ok "$(woken)" '[["ro-b","ro-a","14:12"]]' "W6 (repeat): ro-a's repeat at 14:12 rewrites the wake's at"
ok "$([ "$(sum1 "$(CF)")" != "$b1sum" ] && echo rewritten || echo same)" rewritten "W6 (repeat): … the file is rewritten"
ok "$(others)" "$b1oth" "W6 (repeat): … and the claims and waiting lists are unchanged"
out=$(tw ro-b --now "$(at 7)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 0 "W6 (repeat): … so the waiter whose baseline lies between the two wakes returns 0"
b2sum=$(sum1 "$(CF)")
nx ro-a --now "$(at 7)" >/dev/null
ok "$(sum1 "$(CF)")" "$b2sum" "W6 (repeat): the same repeat at the same --now leaves the file byte-identical"
# The lock-order race: a giver whose now is earlier than the waiter's record writes the wake at the record's at.
scen w6-race
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; run1 a1 ro-a
mkro ro-b 3; mkt b1 ro-b open
nx ro-b --now "$(at 5)" >/dev/null
stamp a1 review
nx ro-a --now "$(at 4)" >/dev/null
ok "$(woken)" '[["ro-b","ro-a","14:10"]]' "W6 (race): a giver at 14:09 writes the wake at ro-b's record's 14:10"
out=$(tw ro-b --now "$(at 5)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 0 "W6 (race): … so the waiter whose lead looked at 14:10 is woken"
# What writes no wake: --dry-run, a lock not taken, the heat.
scen w6-none
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; run1 a1 ro-a
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
stamp a1 review
before=$(sum1 "$(CF)")
J=$(nx ro-a --dry-run --now "$(at 1)")
ok "$(q "$J" 'd["trickle"]["kept"]')|$(sum1 "$(CF)")" "{\"ro-b\":1}|$before" "W6 (dry-run): kept, and the file byte-identical"
holder
J=$(THREAD_NOTE_LOCK_TIMEOUT=1 nx ro-a --now "$(at 1)")
kill "$HOLDER"; wait "$HOLDER" 2>/dev/null
ok "$(q "$J" 'd["trickle"]["kept"]')|$(sum1 "$(CF)")" "{\"ro-b\":1}|$before" "W6 (lock): kept, and no wake written"
J=$(THREAD_HEAT_LEVEL=2 nx ro-a --now "$(at 1)")
ok "$(q "$J" 'd["trickle"]["kept"]')|$(woken)" '{}|[]' "W6 (heat): nothing kept, no wake"
# The p28-5 shape (no woken) reads fine and is rewritten with woken.
scen w6-p28-5-shape
mkro ro-a 3
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '-'
J=$(nx ro-a)
ok "$(q "$J" 'd["trickle"]["kept"]')|$(lines)" '{"ro-b":1}|0' "W6 (p28-5 shape): a file with no woken reads fine, no WARN"
ok "$(fshape)" '[["version","claims","waiting","woken"],1]' "W6 (p28-5 shape): … rewritten with woken at version 1"
ok "$(woken)" '[["ro-b","ro-a","14:05"]]' "W6 (p28-5 shape): … holding ro-b's wake"
# A woken that is no list reads as none, silently, and the next write replaces it.
scen w6-not-a-list
mkro ro-a 3
mkro ro-b 3; mkt b1 ro-b open
rawf '{"version": 1, "claims": [], "waiting": [{"tasksDir": D, "rollout": "ro-b", "since": iso(NOW - m(5)), "at": iso(NOW - m(1)), "served": None, "want": 1}], "woken": 5}'
out=$(tw ro-b --poll 0.1 --timeout 0.3); rc=$?
ok "$rc|$(cat "$D/tw-err")" "75|" "W6 (not a list): the wait reads no wake, silently"
J=$(nx ro-a --dry-run)
ok "$(q "$J" 'd["trickle"]["kept"]')|$(lines)" '{"ro-b":1}|0' "W6 (not a list): next reads it as none, no WARN"
nx ro-a >/dev/null
ok "$(woken)" '[["ro-b","ro-a","14:05"]]' "W6 (not a list): … and the next write replaces it with a list"
# Malformed wakes are dropped silently and by the write; another tasks dir's live wake is kept by the wall clock, and a
# stale one dropped; this dir's TTL-old wake is dropped, a 29:59 one kept.
scen w6-prune
mkro ro-a 3
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' \
  '[5, {"tasksDir": D, "rollout": "ro-x"}, k(D, "ro-y", "nope", "ro-z"), k(D, "", NOW, "ro-z"), k(D, "ro-q", NOW, 7),
    k("/elsewhere", "ro-e", WALL - m(1), "ro-z"), k("/elsewhere", "ro-f", WALL - m(31), "ro-z"),
    k(D, "ro-old", NOW - m(30), "ro-z"), k(D, "ro-young", NOW - m(29) - s(59), "ro-z")]'
J=$(nx ro-a)
ok "$(lines)" 0 "W6 (prune): malformed wakes are dropped silently"
ok "$(woken)" '[["ro-b","ro-a","14:05"],["ro-young","ro-z","13:35:01"]]' \
  "W6 (prune): … by the write too, with the 30-minute-old wake; the 29:59 one is kept"
ok "$(woken all)" '[["/elsewhere","ro-e"],["here","ro-b"],["here","ro-young"]]' \
  "W6 (prune): another tasks dir's live wake is kept by the wall clock, its stale one dropped"

# ── W7: the own next consumes the wake while it still waits ──────────────────────────────────────────────────────────
scen w7-consume
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; run1 a1 ro-a
mkro ro-b 3; mkt b1 ro-b open
nx ro-b >/dev/null
addwake '[k(D, "ro-b", NOW + m(1), "ro-a")]'
J=$(nx ro-b --now "$(at 2)")
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 1/1 $T\"]" "W7: ro-b's next still holds b1"
ok "$(woken)" '[]' "W7: … and its wake is consumed"
out=$(tw ro-b --now "$(at 2)" --poll 0.1 --timeout 0.3); rc=$?
ok "$rc" 75 "W7: … so its next wait waits on"

# ── W8: the same hand-over under the Away cap ────────────────────────────────────────────────────────────────────────
scen w8-away
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 1 09:00 2
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open
mkro ro-b 3; mkt b1 ro-b open
nx ro-a >/dev/null
J=$(nx ro-b --now "$(at 5)")
ok "$(q "$J" 'd["hold"][0]["reason"]')" "\"away cap: 2/2 $T\"" "W8: ro-b waits on the Away cap"
twbg w8b ro-b --now "$(at 5)" --poll 0.1 --timeout 60
sleep 0.3
stamp a1 review
J=$(nx ro-a --now "$(at 6)")
ok "$(q "$J" '[d["start"], d["trickle"]["kept"], d["hold"][0]["reason"]]')" "[[],{\"ro-b\":1},\"away cap: 1/2 $T, 1 kept for [[ro-b]]\"]" \
  "W8: a1 lands: ro-a keeps the place for ro-b"
ok "$(gone "$BG" 30)" gone "W8: ro-b's trickle wait returns within 3 s"
ok "$(rc_of "$BG")|$(cat "$D/w8b.out")" "0|$WOKE [[ro-b]] by [[ro-a]]" "W8: … exit 0, the wake line"
J=$(nx ro-b --now "$(at 6)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "W8: ro-b starts b1"
under "$J" 2 "W8: ro-b's start"

# ── W9: usage → 2 ────────────────────────────────────────────────────────────────────────────────────────────────────
scen w9-usage
mkro ro-b 3
out=$(tw ro-nope); rc=$?
ok "$rc" 2 "W9: a missing rollout note: exit 2"
has "$(cat "$D/tw-err")" "ERROR: trickle-wait: " "W9: … with its ERROR line"
out=$(tw ro-b --poll 0); rc=$?
ok "$rc|$(head -c 21 "$D/tw-err")" "2|ERROR: trickle-wait: " "W9: --poll 0: exit 2"
out=$(tw ro-b --timeout -1); rc=$?
ok "$rc|$(head -c 21 "$D/tw-err")" "2|ERROR: trickle-wait: " "W9: --timeout -1: exit 2"
out=$(tw ro-b --poll nan); rc=$?
ok "$rc" 2 "W9: --poll nan: exit 2"

# ── W10: no mutual keep: two waiters and one free place agree who starts ─────────────────────────────────────────────
scen w10-agree
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; mkt a1 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedk '[]' '[w(D, "ro-a", NOW - m(10), NOW - m(1), "2026-10-02T13:00:00+00:00", 1), w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]' '[]'
JA=$(nx ro-a --dry-run); JB=$(nx ro-b --dry-run)
ok "$(q "$JA" "$share")" '[{"ro-b":1},0,[]]' "W10: ro-a's view: the place is ro-b's (never served)"
ok "$(q "$JB" "$share")" '[{},1,["b1"]]' "W10: ro-b's view agrees: it starts b1 and keeps nothing for ro-a"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
