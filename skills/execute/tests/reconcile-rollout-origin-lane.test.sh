#!/usr/bin/env bash
# p33-4 (ADR 0064 d5, d6, d12): the origin lane. Integration stays serial per GitHub origin across rollouts, passed in
# turn: `reconcile-rollout.py mark-integrating` refuses (exit 4) while another rollout on the same origin holds the origin
# lane, or while a valid waiter from another rollout has waited longer; a refusal frees the caller's own Run-record lane
# (lane-freed release=origin) and records it on origin-lane.json's waiting list; `origin-wait` re-reads the grant rule,
# read-only. Cases:
#   L1-L11  holders: a holder refuses; lapsed, none, unreadable and room-stop leases never hold, nor a freed record lane,
#           a merge hold, an open halt, a `paused:` stamp or an unreadable record; another origin never waits; a yield
#           frees the caller's lane and keeps `integrating:`; mark-done passes the lane; no Project root is today's
#           behaviour; --dry-run writes nothing; two concurrent calls take it once; serial, done and dropped rollouts
#           never hold; exit precedence 1 > 4.
#   L12-L19 waiters: the lane passes in turn by `since`; an invalid waiter is pruned; a valid waiter wins a concurrent
#           race; origin-wait; a merge-hold release re-enters with no check (D12); malformed, non-JSON and other-version
#           files; another tasksDir's entries.
#   L20     an older Engine snapshot's rollout holds while it integrates (its lease and lane-taken read alike).
# Temp vault and local repos whose origin URLs name github.com/o/r (only `git remote get-url` reads them); a pinned HOME
# with lease files written directly; each scenario its own THREAD_EVENTS_DIR and THREAD_NOTE_LOCK_DIR. No network.
# Usage: bash reconcile-rollout-origin-lane.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1 THREAD_MACHINE_TIMES='{}'

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
RECORD="$HERE/../../_shared/scripts/run_record.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # THREAD_HEAT_LEVEL=0
unset $(git rev-parse --local-env-vars)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
TMP="$(cd "$(mktemp -d)" && pwd -P)"
PIDS=()   # every background process this suite starts, killed by pid at exit if still alive
cleanup() {
  local p
  for p in ${PIDS[@]+"${PIDS[@]}"}; do kill -0 "$p" 2>/dev/null && kill "$p" 2>/dev/null; done
  rm -rf "$TMP"
}
trap cleanup EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"   # the backstop: each scenario pins its own
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
NOW=2026-10-02T14:05:00Z; T1=2026-10-02T14:10:00Z; T2=2026-10-02T14:15:00Z; T3=2026-10-02T14:20:00Z
FRESH=2026-10-02T14:00:00Z; STALE=2026-10-02T12:00:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

S=""; D=""; L=""; EV=""
# scen <name>: a fresh tasks dir $D, HOME $S/home (leases), lock dir $L, record dir $EV, and repos ra, rb (origin o/r)
# and rq (origin o/q).
scen() {
  S="$TMP/$1"; D="$S/vault/Work/Tasks"; L="$S/locks"; EV="$S/events"; mkdir -p "$D" "$S/home" "$L" "$EV"
  local r o
  for r in ra:o/r rb:o/r rc:o/r rq:o/q; do
    o=${r#*:}; r=${r%%:*}
    git -c init.defaultBranch=main init -q "$S/$r" && git -C "$S/$r" remote add origin "$TMP/srv/github.com/$o.git"
  done
  echo "== $1"
}
# mkro <stem> <root | -> [frontmatter lines...] — a parallel rollout note in $D with its Project root line
mkro() {
  local s="$1" rp="$2"; shift 2
  { printf -- '---\ntags: [task, rollout]\nstatus: %s\nprotocol_version: 5\n' "${ST:-open}"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n'
    [ "$rp" = "-" ] || printf 'Project root: `%s`\n' "$rp"
    printf '\n%s\n' "${BODY:-}"; } > "$D/$s.md"
}
# mkt <slug> <rollout> [status] [frontmatter lines...] — a task note; default status review with a pr:
mkt() {
  local s="$1" ro="$2" st="${3:-review}"; shift; shift; [ $# -gt 0 ] && shift
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\npr: https://github.com/o/r/pull/%s\nready: 2026-10-02T13:00+00:00\n' "$st" "$ro" "${#s}"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
lease() { mkdir -p "$S/home/.config/thread/leases"; printf '{"rollout": "%s", "written_at": "%s", "by": "next"}\n' "$1" "${2:-$FRESH}" > "$S/home/.config/thread/leases/$1.json"; }
noleases() { rm -rf "$S/home/.config/thread/leases"; }
em() { THREAD_EVENTS_DIR="$EV" python3 "$RECORD" emit --rollout "$1" --kind "$2" --task "$3" --json "${4:-{\}}" --ts "${5:-$FRESH}" > /dev/null || { echo "FAIL - emit $2"; fail=1; }; }
emr() { THREAD_EVENTS_DIR="$EV" python3 "$RECORD" emit --rollout "$1" --kind "$2" --json "$3" --ts "${4:-$FRESH}" > /dev/null || { echo "FAIL - emit $2"; fail=1; }; }
env_() { env THREAD_EVENTS_DIR="$EV" THREAD_NOTE_LOCK_DIR="$L" HOME="$S/home" "$@"; }
# mi <tasks> [flags...] -> rc, out, err: mark-integrating at --now $AT (default $NOW)
mi() { local t="$1"; shift; out=$(env_ python3 "$SCRIPT" mark-integrating --tasks "$t" --tasks-dir "$D" --now "${AT:-$NOW}" "$@" 2>"$S/err"); rc=$?; err=$(cat "$S/err"); }
md() { env_ python3 "$SCRIPT" mark-done --tasks "$1" --tasks-dir "$D" --now "${AT:-$NOW}" >/dev/null 2>&1; }
ow() { local t="$1"; shift; out=$(env_ python3 "$SCRIPT" origin-wait --tasks "$t" --tasks-dir "$D" --now "${AT:-$NOW}" "$@" 2>"$S/err"); rc=$?; err=$(cat "$S/err"); }
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
lanes() { [ -f "$EV/$1.jsonl" ] || { echo 0; return; }; grep -c "\"kind\":\"$2\"" "$EV/$1.jsonl" | tr -d ' '; }
lastline() { [ -f "$EV/$1.jsonl" ] && tail -1 "$EV/$1.jsonl"; }
F() { echo "$L/origin-lane.json"; }
entries() {  # entries -> "<rollout>:<task>:<since>" per waiting entry, sorted; "none" without a file
  [ -f "$(F)" ] || { echo none; return; }
  python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(" ".join(sorted("%s:%s:%s" % (e["rollout"], e["task"], e["since"]) for e in d["waiting"])) or "-")' "$(F)"
}
sum1() { if [ -e "$1" ]; then cksum < "$1" | tr -d ' \t'; else echo none; fi; }
HOLDER="ORIGIN LANE: [[ra-rollout]]'s [[a1]] integrates on o/r"
# two rollouts on o/r: A in ra, B in rb, each with its lease fresh; a1, a2, b1 at review with PRs
ab() { mkro ra-rollout "$S/ra"; mkro rb-rollout "$S/rb"; mkt a1 ra-rollout; mkt a2 ra-rollout; mkt b1 rb-rollout
  lease ra-rollout; lease rb-rollout; }

# ---- holders ------------------------------------------------------------------------------------------------------
scen l1; ab
mi a1; ok "$rc" 0 "L1: A's a1 takes the lane: nothing holds the origin"
ok "$(lanes ra-rollout lane-taken)" 1 "L1: … lane-taken in A's record"
mi b1; ok "$rc" 4 "L1: B's b1 exits 4 while A holds a1"
has "$err" "$HOLDER (lane taken " "L1: … with the holder line"
has "$err" "its lead's lease fresh until 2026-10-02T14:45:00Z): [[b1]] waits its turn (ADR 0064)" "L1: … naming A's lease and the waiting task"
ok "$(fm b1 integrating)" "<none>" "L1: b1 is unchanged (no integrating:)"
ok "$(lanes rb-rollout lane-taken)|$(lanes rb-rollout lane-freed)" "0|0" "L1: B's record has no lane-taken (and nothing to free)"
ok "$(entries)" "rb-rollout:b1:2026-10-02T14:05:00+00:00" "L1: … and B's waiting entry is written"

for c in lapsed none unreadable room-stop; do
  scen "l2-$c"; ab
  mi a1 >/dev/null
  case $c in
    lapsed) lease ra-rollout "$STALE" ;;
    none) rm -f "$S/home/.config/thread/leases/ra-rollout.json" ;;
    unreadable) echo 'not json' > "$S/home/.config/thread/leases/ra-rollout.json" ;;
    room-stop) lease ra-rollout "$STALE"; BODY=$'## Pause log\n\n- 2026-10-02T13:30:00Z room stop: the Stage' mkro ra-rollout "$S/ra" ;;
  esac
  mi b1; ok "$rc" 0 "L2: A's lease $c: B takes the lane"
done

for c in freed merge-hold halt paused unreadable; do
  scen "l3-$c"; ab
  mi a1 >/dev/null
  case $c in
    freed) em ra-rollout lane-freed a1 '{"release":"halt"}' "$NOW" ;;
    merge-hold) em ra-rollout hold-started a1 '{"hold":"merge"}' "$NOW" ;;
    halt) emr ra-rollout lead-entry '{"by":"heartbeat","session":"S"}' "$NOW"
          emr ra-rollout stopped '{"cause":"halt","inferred":false,"calls":[],"reason":"lane hold"}' "$NOW" ;;
    paused) mkro ra-rollout "$S/ra" 'paused: 2026-10-02T14:00+00:00' ;;
    unreadable) mv "$EV/ra-rollout.jsonl" "$EV/x"; mkdir -p "$EV/ra-rollout.jsonl" ;;
  esac
  mi b1; ok "$rc" 0 "L3: A $c: B takes the lane"
  [ "$c" = unreadable ] && has "$err" "WARN: origin lane: [[ra-rollout]]'s Run record is unreadable: it holds nothing" "L3: … with a WARN"
done

scen l4; ab; mkro rq-rollout "$S/rq"; mkt q1 rq-rollout; lease rq-rollout
mi a1 >/dev/null; mi q1
ok "$rc" 0 "L4: a rollout on another origin (o/q) never waits on o/r's holder"
hasnt "$err" "ORIGIN LANE" "L4: … silently"

scen l5; ab
mi b1 >/dev/null; ok "$(lanes rb-rollout lane-taken)" 1 "L5: setup: B's b1 holds"
mkt a1 ra-rollout review 'integrating: 2026-10-02T14:06+00:00'; em ra-rollout lane-taken a1 '{}' 2026-10-02T14:06:00Z
AT=$T1 mi b1; ok "$rc" 4 "L5: b1's Base-moved re-run while A holds a1 (an overlap) exits 4: no caller is exempt"
has "$err" "$HOLDER" "L5: … with the holder line"
has "$(lastline rb-rollout)" '"kind":"lane-freed"' "L5: B's record frees its lane on b1"
has "$(lastline rb-rollout)" '"release":"origin"' "L5: … release=origin"
has "$(lastline rb-rollout)" '"origin":"o/r"' "L5: … origin=o/r"
ok "$(fm b1 integrating)" "integrating: 2026-10-02T14:05+00:00" "L5: b1 keeps integrating:"
ok "$(entries)" "rb-rollout:b1:2026-10-02T14:10:00+00:00" "L5: B's entry written"

scen l6; ab
mi a1 >/dev/null; mi b1 >/dev/null; ok "$rc" 4 "L6: setup: b1 waits"
md a1
AT=$T1 mi b1; ok "$rc" 0 "L6: after A's mark-done (the lane frees on the merge), B takes the lane"
ok "$(entries)" "-" "L6: … and its entry clears"

scen l7; mkro nr-rollout -; mkt n1 nr-rollout
mi n1; ok "$rc|$err" "0|" "L7: no Project root: today's behaviour, silent"
ok "$([ -e "$L/origin-lane.lock" ] || [ -e "$(F)" ] && echo made || echo none)" none "L7: … neither origin-lane.lock nor origin-lane.json is created"
mkro nr-rollout "$S/nowhere"; mkt n2 nr-rollout
mi n2; ok "$rc|$err" "0|" "L7: a Project root missing here: the same"

scen l8; ab
mi a1 >/dev/null; before="$(sum1 "$EV/rb-rollout.jsonl")|$(sum1 "$(F)")|$(sum1 "$D/b1.md")"
mi b1 --dry-run; ok "$rc" 4 "L8: --dry-run exits 4 while A holds"
has "$err" "$HOLDER" "L8: … with the holder line"
ok "$(sum1 "$EV/rb-rollout.jsonl")|$(sum1 "$(F)")|$(sum1 "$D/b1.md")" "$before" "L8: … and writes nothing (record, file and note bytes unchanged)"
mi a2 --dry-run; ok "$rc" 0 "L8: A's own a2 --dry-run: A is the holder, no waiter: 0"

scen l9; ab
env_ python3 "$SCRIPT" mark-integrating --tasks a1 --tasks-dir "$D" --now "$NOW" >/dev/null 2>"$S/ea" & pa=$!; PIDS+=("$pa")
env_ python3 "$SCRIPT" mark-integrating --tasks b1 --tasks-dir "$D" --now "$NOW" >/dev/null 2>"$S/eb" & pb=$!; PIDS+=("$pb")
wait "$pa"; ra=$?; wait "$pb"; rb=$?
ok "$(printf '%s\n' "$ra" "$rb" | sort | tr '\n' ' ')" "0 4 " "L9: two concurrent calls with no holder or waiter: exactly one exits 0 and one 4"
ok "$(( $(lanes ra-rollout lane-taken) + $(lanes rb-rollout lane-taken) ))" 1 "L9: … one lane-taken between them"

for c in serial done dropped; do
  scen "l10-$c"; ab
  mi a1 >/dev/null
  case $c in serial) mkro ra-rollout "$S/ra" 'shape: serial' ;; *) ST=$c mkro ra-rollout "$S/ra" ;; esac
  mi b1; ok "$rc" 0 "L10: a $c rollout never holds"
done

scen l11; ab
mi a1 >/dev/null; mi b1,nosuch; ok "$rc" 1 "L11: a refusal plus a not-found slug exits 1 (1 > 4)"
has "$err" "ERROR: nosuch: task note not found" "L11: … naming it"

# ---- waiters ------------------------------------------------------------------------------------------------------
scen l12; ab
mi a1 >/dev/null; mi b1 >/dev/null; ok "$rc" 4 "L12: setup: b1 refused at t0 (B's entry since t0)"
AT=$T1 md a1
AT=$T1 mi a2; ok "$rc" 4 "L12: A's a2 then yields to B, which waited first"
has "$err" "ORIGIN LANE: [[rb-rollout]] waits on o/r since 2026-10-02T14:05:00+00:00 (its [[b1]]): [[a2]] yields its turn (ADR 0064)" "L12: … with the yield line naming B"
ok "$(entries)" "ra-rollout:a2:2026-10-02T14:10:00+00:00 rb-rollout:b1:2026-10-02T14:05:00+00:00" "L12: the file holds B's entry (t0) and A's (t1)"
AT=$T2 mi b1; ok "$rc" 0 "L13: b1 takes the lane, first in line"
ok "$(entries)" "ra-rollout:a2:2026-10-02T14:10:00+00:00" "L13: … B's entry gone, A's keeps its since"
AT=$T2 mi a2; ok "$rc" 4 "L13: a2 is refused while B holds"
has "$err" "ORIGIN LANE: [[rb-rollout]]'s [[b1]] integrates on o/r" "L13: … naming B the holder"
ok "$(entries)" "ra-rollout:a2:2026-10-02T14:10:00+00:00" "L13: … A's since kept"
AT=$T3 md b1
AT=$T3 mi a2; ok "$rc" 0 "L13: after B's mark-done, a2 takes the lane"
ok "$(entries)" "-" "L13: … and the waiting list empties"

for c in lapsed none room-stop blocked done carried paused halt aged; do
  scen "l14-$c"; ab
  mi a1 >/dev/null; mi b1 >/dev/null
  AT=$T1 md a1
  case $c in
    lapsed) lease rb-rollout "$STALE" ;;
    none) rm -f "$S/home/.config/thread/leases/rb-rollout.json" ;;
    room-stop) lease rb-rollout "$STALE"; BODY=$'## Pause log\n\n- 2026-10-02T14:00:00Z room stop: the Stage' mkro rb-rollout "$S/rb" ;;
    blocked) mkt b1 rb-rollout blocked ;;
    done) mkt b1 rb-rollout done ;;
    carried) mkt b1 rc-rollout ;;
    paused) mkro rb-rollout "$S/rb" 'paused: 2026-10-02T14:06+00:00' ;;
    halt) emr rb-rollout lead-entry '{"by":"heartbeat","session":"S"}' "$NOW"
          emr rb-rollout stopped '{"cause":"halt","inferred":false,"calls":[],"reason":"x"}' "$NOW" ;;
  esac
  if [ "$c" = aged ]; then AT=2026-10-02T14:35:00Z mi a2; else AT=$T1 mi a2; fi
  ok "$rc" 0 "L14: B's entry invalid ($c): A's a2 takes the lane"
  ok "$(entries)" "-" "L14: … and the write prunes B's entry ($c)"
done

scen l15
for i in 1 2 3 4 5; do
  rm -rf "$D" "$EV" "$L" "$S/home"; mkdir -p "$D" "$EV" "$L" "$S/home"; ab
  printf '{"version": 1, "waiting": [{"tasksDir": "%s", "origin": "o/r", "rollout": "rb-rollout", "task": "b1", "since": "2026-10-02T14:00:00+00:00", "at": "2026-10-02T14:00:00+00:00"}]}\n' "$(cd "$D" && pwd -P)" > "$(F)"
  env_ python3 "$SCRIPT" mark-integrating --tasks a2 --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1 & pa=$!; PIDS+=("$pa")
  env_ python3 "$SCRIPT" mark-integrating --tasks b1 --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1 & pb=$!; PIDS+=("$pb")
  wait "$pa"; ra=$?; wait "$pb"; rb=$?
  ok "$ra|$rb" "4|0" "L15: round $i: a valid waiter and nothing holding, a2 and b1 at once: B exits 0, A exits 4"
done

scen l16; ab
mi a1 >/dev/null
ow b1 --timeout 1 --poll 0.2; ok "$rc" 75 "L16: origin-wait with a holder: exit 75 after --timeout"
has "$out" "$HOLDER" "L16: … printing the holder line"
ok "$(entries)" "none" "L16: … and writes nothing (no waiting list)"
mi b1 >/dev/null; AT=$T1 md a1
AT=$T1 ow b1 --timeout 30 --poll 0.2; ok "$rc|$out" "0|origin lane: [[b1]]'s turn on o/r" "L16: first in line: exit 0 within one poll"
AT=$T1 mi a2 >/dev/null
AT=$T1 ow a2 --timeout 0.5 --poll 0.2; ok "$rc" 75 "L16: second in line: exit 75"
has "$out" "ORIGIN LANE: [[rb-rollout]] waits on o/r since" "L16: … with the yield line"
mkt b1 rb-rollout done
AT=$T1 ow b1 --timeout 1; ok "$rc" 0 "L16: the task left the Integration queue: exit 0"
has "$out" "origin lane: nothing to wait for: [[b1]] left the Integration queue" "L16: … nothing to wait for"
mkro nr-rollout -; mkt n1 nr-rollout
ow n1 --timeout 1; ok "$rc" 0 "L16: no Project root: exit 0"
has "$out" "nothing to wait for" "L16: … nothing to wait for"
before=$(sum1 "$(F)")
AT=$T1 ow a2 --timeout 0.3 --poll 0.1 >/dev/null; ok "$(sum1 "$(F)")" "$before" "L16: origin-wait writes nothing"
ow a1,a2; ok "$rc" 2 "L16: two slugs: usage exit 2"
ow nosuch; ok "$rc" 2 "L16: no such note: usage exit 2"
ow a2 --poll 0; ok "$rc" 2 "L16: --poll 0: usage exit 2"

scen l17; ab; mkro rc-rollout "$S/rc"; mkt c1 rc-rollout; lease rc-rollout
mi a1 >/dev/null
env_ python3 "$SCRIPT" hold --tasks a1 --hold merge --state start --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
mi b1; ok "$rc" 0 "L17: A's merge hold frees the origin lane: B takes it"
env_ python3 "$SCRIPT" hold --tasks a1 --hold merge --state end --tasks-dir "$D" --now "$T1" >/dev/null 2>&1
AT=$T1 mi c1 --dry-run; ok "$rc" 4 "L17: A's release (hold --state end, no mark-integrating) re-enters: C's dry run sees a holder"
has "$err" "$HOLDER" "L17: … A holds again (D12: the base pin covers the overlap)"
ok "$(lanes ra-rollout lane-taken)" 1 "L17: … and A's record holds exactly one lane-taken"

scen l18; ab
mi a1 >/dev/null
printf '{"version": 1, "waiting": [7, {"rollout": "x"}, {"tasksDir": "%s", "origin": "o/r", "rollout": "zz", "task": "z", "since": "nope", "at": "nope"}]}\n' "$(cd "$D" && pwd -P)" > "$(F)"
mi b1; ok "$rc" 4 "L18: malformed entries: still the holder's refusal"
hasnt "$err" "WARN" "L18: … malformed entries dropped silently"
ok "$(entries)" "rb-rollout:b1:2026-10-02T14:05:00+00:00" "L18: … and pruned by the write"
echo 'not json' > "$(F)"
mi b1; has "$err" "WARN: origin lane: $(F) unreadable: not JSON — read as none" "L18: a non-JSON file WARNs"
ok "$(entries)" "rb-rollout:b1:2026-10-02T14:05:00+00:00" "L18: … and the next write replaces it"
echo '{"version": 2, "waiting": []}' > "$(F)"; before=$(sum1 "$(F)")
mi b1; has "$err" "WARN: origin lane: $(F) version 2 — read as none, left for its writer" "L18: a version 2 file WARNs"
ok "$(sum1 "$(F)")" "$before" "L18: … and is never written"

scen l19; ab
wall=$(date -u +%Y-%m-%dT%H:%M:%SZ); old=$(python3 -c 'import datetime as d; print((d.datetime.now(d.timezone.utc) - d.timedelta(minutes=40)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
printf '{"version": 1, "waiting": [{"tasksDir": "/elsewhere/Tasks", "origin": "o/r", "rollout": "xr", "task": "x1", "since": "2026-10-01T00:00:00Z", "at": "%s"}, {"tasksDir": "/elsewhere/Tasks", "origin": "o/r", "rollout": "yr", "task": "y1", "since": "2026-10-01T00:00:00Z", "at": "%s"}]}\n' "$wall" "$old" > "$(F)"
mi a1; ok "$rc" 0 "L19: another tasksDir's earlier waiter never counts"
ok "$(entries)" "xr:x1:2026-10-01T00:00:00Z" "L19: … it is kept while under 30 minutes by the wall clock; the older one is dropped"

# ---- L20: an older Engine snapshot's rollout holds while it integrates ----------------------------------------------
scen l20; ab
mkro ra-rollout "$S/ra" 'engine_snapshot: "~/repos/tools/plug-snapshots/0123456789ab"' "engine_sha: $(printf '1%.0s' $(seq 40))"
mkt a1 ra-rollout review 'integrating: 2026-10-02T14:01+00:00'
em ra-rollout lane-taken a1 '{}' 2026-10-02T14:01:00Z
mi b1; ok "$rc" 4 "L20: A on an older snapshot, its lease fresh and its record lane open on a1: B waits"
has "$err" "$HOLDER (lane taken 2026-10-02T14:01+00:00" "L20: … the holder line names A"
rm -f "$S/home/.config/thread/leases/ra-rollout.json"
AT=$T1 mi b1; ok "$rc" 0 "L20 control: the same A with no lease (an engine older than leases) holds nothing"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-origin-lane: ALL PASS"; else echo "reconcile-rollout-origin-lane: FAILED"; fi
exit "$fail"
