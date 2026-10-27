#!/usr/bin/env bash
# p29-10 (ADR 0051): the Run record's stops and resumes. reconcile-rollout.py record-entry, the lead's loop entry, writes
# every stop the record does not hold yet and one lead-entry; step-boundary.py begin and the Stop-hook driver write the
# live stops; `next` writes a sleep no entry follows. The stop model is run_record.py's docstring. Each case builds its
# own rollout's record (run_record.py emit with --ts for the past), and THREAD_MACHINE_TIMES stands in for the Mac's
# kern.boottime, kern.waketime and pmset log, so nothing reads this machine's history.
#   E1 a first entry   E2 a heartbeat's plain entry   E3 a room stop and its resume   E3b --cause with nothing open
#   E4 a session change: dead-lead   E5 a boot after the last live line: mac-restart   E5b a sleep with lines after it
#   E5c a sleep before the first live line   E5d two sleeps, in at order   E6 --cause owns a later boot   E7 a pause
#   owns a later boot   E7b a boot before the pause is written first   E8 an open halt, then a plain entry   E8b the
#   hook's halt after a boot: both stops   E8c a sleep inside a halt   E9 next's sleep, once   E9b next writes no sleep
#   with an open stop, a pause or no entry yet   E10 --dry-run   E10b an unwritable record   E11 the guard   E12 the
#   skips   E13 --by watchdog   E14 another session's entry, then the live lead's heartbeat: one dead-lead, never a
#   second   E14b a heartbeat in a session other than the last entry's infers no dead-lead   P1 sleep_spans on a
#   pmset-shaped log, and machine_times' kern.sleeptime fallback.
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR and ignores THREAD_TEST_EVENTS_DIR.
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
SB="$HERE/../scripts/step-boundary.py"
DRIVER="$HERE/../../../hooks/rollout-stop-driver.py"
RRPY="$HERE/../../_shared/scripts/run_record.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
V="$HOME/repos/obsidian/Work/Tasks"   # reconcile-rollout.py's DEFAULT_TASKS_DIR: the Stop hook resolves notes here
mkdir -p "$V"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR
EV="$TMP/events"
export THREAD_EVENTS_DIR="$EV"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export ROLLOUT_DRIVER_STATE_DIR="$TMP/driver"
export THREAD_MACHINE_TIMES='{}'
S='{"parallel_ceiling":2}'

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok "$1" "*$2*" "$3";; esac; }

mkro() {  # mkro <stem> [frontmatter lines...]: a parallel rollout note in $V
  local s=$1; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n## Queue\n\n'; } > "$V/$s.md"
}
em() {  # em <ro> <kind> <task|-> <json> <ts>: one past line, through the one writer
  if [ "$3" = - ]; then python3 "$RRPY" emit --rollout "$1" --kind "$2" --json "$4" --ts "$5"
  else python3 "$RRPY" emit --rollout "$1" --kind "$2" --task "$3" --json "$4" --ts "$5"; fi || { echo "FAIL - emit $2 refused"; fail=1; }
}
ent() { local ro=$1; shift; python3 "$SCRIPT" record-entry --rollout "$V/$ro.md" "$@"; }
q() {  # q <ro> <python expr over L, the record's lines>: its JSON
  python3 - "$EV/$1.jsonl" "$2" <<'PY'
import json, sys
try:
    L = [json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
except FileNotFoundError:
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY
}
# the record as one token per line: kind, then cause or stop, inferred and at
seq() { q "$1" '[d["kind"] + ":" + str(d.get("cause") or d.get("stop") or "-") + (":inf" if d.get("inferred") else "") for d in L]'; }

echo "== E1. a first entry: one lead-entry, no stop"
mkro e1
out=$(ent e1 --by stage --session A --now 2026-10-26T10:00:00Z); rc=$?
ok "$rc" 0 "E1: exit 0"
ok "$out" "e1: lead-entry by=stage" "E1: one line naming what it wrote"
ok "$(q e1 '[[d["kind"], d["by"], d["session"], d.get("stop")] for d in L]')" '[["lead-entry","stage","A",null]]' "E1: one lead-entry, by and session, no stop"

echo "== E2. a heartbeat tick in the same session: a second plain lead-entry, always written"
ent e1 --by heartbeat --session A --now 2026-10-26T10:20:00Z >/dev/null
ok "$(seq e1)" '["lead-entry:-","lead-entry:-"]' "E2: two plain lead-entries"

echo "== E3. a room stop: begin writes the live stop with its calls; the Stage's resume closes it"
mkro e3
em e3 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T09:00:00Z
em e3 slot-taken a "{\"settings\":$S}" 2026-10-26T09:01:00Z
em e3 run-bound a '{"runId":"wf_a1","journalDir":"/j","call":"task"}' 2026-10-26T09:01:05Z
em e3 slot-taken b "{\"settings\":$S}" 2026-10-26T09:02:00Z
em e3 run-bound b '{"runId":"wf_b1","journalDir":"/j","call":"revise"}' 2026-10-26T09:02:05Z
em e3 slot-taken c "{\"settings\":$S}" 2026-10-26T09:03:00Z
em e3 slot-freed c '{"outcome":"ready"}' 2026-10-26T09:04:00Z
out=$(printf '%s\n' "Login at its 5-hour line; stopping at a step boundary: wf_a1 a (task), wf_b1 b (revise); lane: none" \
  | python3 "$SB" begin --rollout "$V/e3.md"); rc=$?
ok "$rc" 0 "E3: begin exits 0"
has "$out" "room stop: Login at its 5-hour line" "E3: begin's line"
ok "$(q e3 '[d for d in L if d["kind"] == "stopped"][0]["calls"]')" '[{"task":"a","runId":"wf_a1","call":"task"},{"task":"b","runId":"wf_b1","call":"revise"}]' "E3: the stop names the two calls in flight, a freed Slot not"
ok "$(q e3 '[[d["cause"], d["inferred"], "at" in d, d["reason"][:24]] for d in L if d["kind"] == "stopped"]')" '[["usage-limit",false,false,"Login at its 5-hour line"]]' "E3: a live usage-limit stop with its reason"
out=$(ent e3 --by stage --cause usage-limit --session B); rc=$?
ok "$rc" 0 "E3: the resume's record-entry exits 0"
ok "$out" "e3: lead-entry by=stage stop=usage-limit" "E3: the open stop is the gap stop (--cause and the session change ignored)"
ok "$(seq e3 | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)[-2:]))')" '["stopped:usage-limit", "lead-entry:usage-limit"]' "E3: the stop and its resume, no second stopped"
ok "$(q e3 '[d["by"] for d in L if d["kind"] == "lead-entry"][-1]')" '"stage"' "E3: the resume names the restarter"
printf '%s\n' "again" | python3 "$SB" begin --rollout "$V/e3.md" >/dev/null
ok "$(q e3 'sum(d["kind"] == "stopped" for d in L)')" 1 "E3: begin while the room stop stands writes no second stop"

echo "== E3b. --cause usage-limit with nothing open: an inferred stop at the last live line, with its calls"
mkro e3b
em e3b lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T09:00:00Z
em e3b slot-taken a "{\"settings\":$S}" 2026-10-26T09:05:00Z
em e3b run-bound a '{"runId":"wf_a1","journalDir":"/j","call":"task"}' 2026-10-26T09:06:00Z
ent e3b --by stage --cause usage-limit --session A --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e3b '[[d["kind"], d.get("cause") or d.get("stop"), d.get("inferred"), d.get("at"), d.get("calls")] for d in L[3:]]')" \
  '[["stopped","usage-limit",true,"2026-10-26T09:06:00.000Z",[{"task":"a","runId":"wf_a1","call":"task"}]],["lead-entry","usage-limit",null,null,null]]' \
  "E3b: stopped usage-limit inferred at L with its call, then the lead-entry"
ok "$(q e3b 'L[3]["ts"]')" '"2026-10-26T12:00:00.000Z"' "E3b: an inferred line's ts is its write time, never backdated"

echo "== E4. a new session after A's heartbeat, no Mac evidence: a dead lead found only at the resume"
mkro e4
ent e4 --by stage --session A --now 2026-10-26T10:00:00Z >/dev/null
ent e4 --by heartbeat --session A --now 2026-10-26T10:20:00Z >/dev/null
ent e4 --by stage --session B --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e4 '[[d["kind"], d.get("cause") or d.get("stop"), d.get("at")] for d in L[2:]]')" \
  '[["stopped","dead-lead","2026-10-26T10:20:00.000Z"],["lead-entry","dead-lead",null]]' "E4: dead-lead at A's last heartbeat, inferred"
ok "$(q e4 'L[2]["inferred"]')" true "E4: marked inferred"

echo "== E5. a boot after the last live line: mac-restart with its boot, no dead-lead despite the session change"
mkro e5
em e5 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
em e5 slot-taken a "{\"settings\":$S}" 2026-10-26T10:05:00Z
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T11:00:00Z"}' ent e5 --by stage --session B --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e5 '[[d["kind"], d.get("cause") or d.get("stop"), d.get("at"), d.get("boot"), d.get("calls")] for d in L[2:]]')" \
  '[["stopped","mac-restart","2026-10-26T10:05:00.000Z","2026-10-26T11:00:00.000Z",[{"task":"a"}]],["lead-entry","mac-restart",null,null,null]]' \
  "E5: mac-restart at the last live line, its boot named, the Slot's call"
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T11:00:00Z"}' ent e5 --by heartbeat --session B --now 2026-10-26T12:20:00Z >/dev/null
ok "$(seq e5 | python3 -c 'import json,sys; print(json.load(sys.stdin)[-1])')" "lead-entry:-" "E5: the same boot again is named: a plain entry"

echo "== E5b. a sleep with lines after its wake: the sleep is found, the entry resumes nothing"
mkro e5b
em e5b lead-entry - '{"by":"heartbeat","session":"A"}' 2026-10-26T10:00:00Z
em e5b suite-started a '{"suite":"s-0123456789abcdef","by":"task","runner":"agent","sha":"abc","dirty":false}' 2026-10-26T11:40:00Z
em e5b run-bound a '{"runId":"wf_a1","journalDir":"/j","call":"task"}' 2026-10-26T11:41:00Z
THREAD_MACHINE_TIMES='{"sleeps":[["2026-10-26T10:30:00Z","2026-10-26T11:30:00Z"]]}' ent e5b --by heartbeat --session A --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e5b '[[d["kind"], d.get("cause") or d.get("stop"), d.get("at"), d.get("wake")] for d in L[3:]]')" \
  '[["stopped","mac-sleep","2026-10-26T10:30:00.000Z","2026-10-26T11:30:00.000Z"],["lead-entry",null,null,null]]' \
  "E5b: mac-sleep at S with its wake W; the lead-entry carries no stop"

echo "== E5c. a sleep before the record's first live line is not this rollout's"
mkro e5c
em e5c slot-taken a "{\"settings\":$S}" 2026-10-26T10:00:00Z
THREAD_MACHINE_TIMES='{"sleeps":[["2026-10-26T08:00:00Z","2026-10-26T09:00:00Z"]]}' ent e5c --by lachy --now 2026-10-26T12:00:00Z >/dev/null
ok "$(seq e5c)" '["slot-taken:-","lead-entry:-"]' "E5c: no stop"

echo "== E5d. two sleeps since the last entry: two mac-sleep lines, in at order"
mkro e5d
em e5d lead-entry - '{"by":"stage"}' 2026-10-26T10:00:00Z
THREAD_MACHINE_TIMES='{"sleeps":[["2026-10-26T11:00:00Z","2026-10-26T11:30:00Z"],["2026-10-26T10:15:00Z","2026-10-26T10:45:00Z"]]}' \
  ent e5d --by heartbeat --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e5d '[d.get("at") for d in L[1:]]')" '["2026-10-26T10:15:00.000Z","2026-10-26T11:00:00.000Z",null]' "E5d: both sleeps, earliest first, then the entry"

echo "== E6. --cause names the gap stop; a boot after its start is inside it, so not written"
mkro e6
em e6 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T11:00:00Z"}' ent e6 --by stage --cause dead-lead --session A --now 2026-10-26T12:00:00Z >/dev/null
ok "$(seq e6)" '["lead-entry:-","stopped:dead-lead:inf","lead-entry:dead-lead"]' "E6: dead-lead only"

echo "== E7. a hard pause stands and a boot follows it: the pause owns the gap"
mkro e7 "paused: 2026-10-26T10:30+00:00"
em e7 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
em e7 paused - '{"mode":"hard"}' 2026-10-26T10:30:00Z
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T11:00:00Z"}' ent e7 --by lachy --session B --now 2026-10-26T12:00:00Z >/dev/null
ok "$(seq e7)" '["lead-entry:-","paused:-","lead-entry:pause"]' "E7: lead-entry stop: pause, no stopped line, no dead-lead"

echo "== E7b. a boot after the last entry and before the pause's start is written first"
mkro e7b "paused: 2026-10-26T10:30+00:00"
em e7b lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
em e7b slot-taken a "{\"settings\":$S}" 2026-10-26T10:05:00Z
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T10:20:00Z"}' ent e7b --by lachy --session A --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e7b '[[d["kind"], d.get("cause") or d.get("stop"), d.get("at"), d.get("boot")] for d in L[2:]]')" \
  '[["stopped","mac-restart","2026-10-26T10:05:00.000Z","2026-10-26T10:20:00.000Z"],["lead-entry","pause",null,null]]' "E7b: mac-restart at L_B, then the pause's entry"

echo "== E8. an open halt: the entry resumes it; a re-run is a plain entry"
mkro e8
em e8 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
em e8 stopped - '{"cause":"halt","inferred":false,"calls":[],"reason":"RACE undecided"}' 2026-10-26T10:30:00Z
ent e8 --by lachy --session A --now 2026-10-26T12:00:00Z >/dev/null
ent e8 --by heartbeat --session A --now 2026-10-26T12:20:00Z >/dev/null
ok "$(seq e8)" '["lead-entry:-","stopped:halt","lead-entry:halt","lead-entry:-"]' "E8: stop: halt, then a plain lead-entry"

echo "== E8b. a boot, then the hook's halt (an open live stop), then the entry: both stops"
mkro e8b
em e8b lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
em e8b slot-taken a "{\"settings\":$S}" 2026-10-26T10:05:00Z
printf '%s' '{"session_id":"s1","last_assistant_message":"done.\nROLLOUT-STATUS: e8b merged=0/2 running=1 state=halted reason=\"engine snapshot unusable\""}' \
  | python3 "$DRIVER" >"$TMP/e8b.out"; rc=$?
ok "$rc|$(cat "$TMP/e8b.out")" "0|" "E8b: the hook exits 0 and prints nothing on halted"
ok "$(q e8b '[[d["cause"], d["inferred"], d["reason"], d["calls"]] for d in L if d["kind"] == "stopped"]')" '[["halt",false,"engine snapshot unusable",[{"task":"a"}]]]' "E8b: the hook's halt, live, with its reason and calls"
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T10:30:00Z"}' ent e8b --by lachy --session A >/dev/null
ok "$(seq e8b)" '["lead-entry:-","slot-taken:-","stopped:halt","stopped:mac-restart:inf","lead-entry:halt"]' "E8b: the halt masks nothing: the restart is written, then the entry resumes the halt"
ok "$(q e8b '[[d.get("at"), d.get("boot")] for d in L if d.get("cause") == "mac-restart"]')" '[["2026-10-26T10:05:00.000Z","2026-10-26T10:30:00.000Z"]]' "E8b: the restart at L_B, before its boot"
ok "$(q e8b 'min(d["ts"] for d in L if d.get("cause") == "halt") > [d["at"] for d in L if d.get("cause") == "mac-restart"][0]')" true "E8b: the restart's at is before the halt's ts"

echo "== E8c. a sleep after a halt began is inside the halt"
mkro e8c
em e8c lead-entry - '{"by":"stage"}' 2026-10-26T10:00:00Z
em e8c stopped - '{"cause":"halt","inferred":false,"calls":[]}' 2026-10-26T10:30:00Z
THREAD_MACHINE_TIMES='{"sleeps":[["2026-10-26T11:00:00Z","2026-10-26T11:30:00Z"]]}' ent e8c --by lachy --now 2026-10-26T12:00:00Z >/dev/null
ok "$(seq e8c)" '["lead-entry:-","stopped:halt","lead-entry:halt"]' "E8c: no mac-sleep"

echo "== E9. next writes a sleep no entry follows, once"
mkro e9
em e9 lead-entry - '{"by":"stage"}' 2026-10-26T10:00:00Z
em e9 suite-started a '{"suite":"s-0123456789abcdef","by":"task","runner":"agent","sha":"abc","dirty":false}' 2026-10-26T11:40:00Z
nx() { python3 "$SCRIPT" next --rollout "$V/$1.md" --tasks-dir "$V" --running "" --now 2026-10-26T12:00:00Z >/dev/null 2>&1; }
export THREAD_MACHINE_TIMES='{"sleeps":[["2026-10-26T10:30:00Z","2026-10-26T11:30:00Z"]]}'
nx e9
ok "$(q e9 '[[d.get("cause"), d.get("at"), d.get("wake"), d.get("calls")] for d in L if d["kind"] == "stopped"]')" '[["mac-sleep","2026-10-26T10:30:00.000Z","2026-10-26T11:30:00.000Z",[]]]' "E9: next writes the mac-sleep"
nx e9
ent e9 --by heartbeat --now 2026-10-26T12:20:00Z >/dev/null
ok "$(q e9 'sum(d["kind"] == "stopped" for d in L)')" 1 "E9: a second next and the next entry write no second one"
ok "$(q e9 '[d.get("stop") for d in L if d["kind"] == "lead-entry"]')" '[null,null]' "E9: next writes no lead-entry; the entry resumes nothing"

echo "== E9b. next writes no sleep with an open stop, a pause standing, or no lead-entry yet"
mkro e9b1
em e9b1 lead-entry - '{"by":"stage"}' 2026-10-26T10:00:00Z
em e9b1 stopped - '{"cause":"halt","inferred":false,"calls":[]}' 2026-10-26T10:10:00Z
mkro e9b2 "paused: 2026-10-26T10:10+00:00"
em e9b2 lead-entry - '{"by":"stage"}' 2026-10-26T10:00:00Z
mkro e9b3
em e9b3 slot-taken a "{\"settings\":$S}" 2026-10-26T10:00:00Z
for r in e9b1 e9b2 e9b3; do nx "$r"; done
ok "$(for r in e9b1 e9b2 e9b3; do q $r 'sum(d.get("cause") == "mac-sleep" for d in L)'; done | tr '\n' ' ')" "0 0 0 " "E9b: none of the three"
export THREAD_MACHINE_TIMES='{}'

echo "== E10. --dry-run writes nothing"
mkro e10
em e10 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
out=$(THREAD_MACHINE_TIMES='{"boot":"2026-10-26T11:00:00Z"}' ent e10 --by stage --session B --now 2026-10-26T12:00:00Z --dry-run)
ok "$out" "e10: stopped mac-restart (inferred, at 2026-10-26T10:00:00.000Z); lead-entry by=stage stop=mac-restart (dry-run)" "E10: it says what it would write"
ok "$(seq e10)" '["lead-entry:-"]' "E10: nothing written"

echo "== E10b. an unwritable record: exit 0 with a warning"
if [ "$(id -u)" != 0 ]; then
  mkro e10b
  em e10b lead-entry - '{"by":"stage"}' 2026-10-26T10:00:00Z
  chmod 555 "$EV"; chmod 444 "$EV/e10b.jsonl"
  out=$(ent e10b --by heartbeat --now 2026-10-26T12:00:00Z 2>"$TMP/e10b.err"); rc=$?
  chmod 755 "$EV"; chmod 644 "$EV/e10b.jsonl"
  ok "$rc" 0 "E10b: exit 0"
  has "$(cat "$TMP/e10b.err")" "run_record: warning: cannot write" "E10b: run_record's warning"
  ok "$(seq e10b)" '["lead-entry:-"]' "E10b: nothing written"
  out=$(THREAD_EVENTS_DIR="$V/e1.md/events" ent e1 --by heartbeat --now 2026-10-26T12:00:00Z 2>"$TMP/e10c.err"); rc=$?
  ok "$rc" 0 "E10b: an unreadable record (the dir under a file): exit 0"
  has "$(cat "$TMP/e10c.err")" "cannot be read; nothing recorded" "E10b: … with its warning"
else
  echo "ok   - E10b: skipped as root"
fi

echo "== E11. the Engine snapshot guard: a stamped rollout from another root"
mkro e11 'engine_snapshot: "/nonexistent/plug-snapshots/000000000000"' "engine_sha: $(printf '0%.0s' $(seq 40))"
out=$(ent e11 --by stage --now 2026-10-26T12:00:00Z 2>&1); rc=$?
ok "$rc" 2 "E11: exit 2"
has "$out" "engine-snapshot: " "E11: the guard's line"
ok "$(seq e11)" '[]' "E11: nothing written"

echo "== E12. a serial, superseded or done note: [skip], nothing written"
mkro e12a "shape: serial"; mkro e12b 'superseded_by: "[[e1]]"'; mkro e12c; sed -i.bak 's/^status: open/status: done/' "$V/e12c.md"; rm -f "$V/e12c.md.bak"
for r in e12a e12b e12c; do
  out=$(ent $r --by stage --now 2026-10-26T12:00:00Z); rc=$?
  ok "$rc" 0 "E12: $r exits 0"
  has "$out" "[skip] $r: " "E12: $r says [skip]"
  ok "$(seq $r)" '[]' "E12: $r: nothing written"
done
ok "$(ent nope --by stage 2>&1; echo "rc=$?")" "ERROR: record-entry: rollout note not found at $V/nope.md
rc=1" "E12: no note: exit 1, an ERROR line"
ok "$(ent e1 --by cron 2>/dev/null; echo $?)" 2 "E12: a bad --by is a usage error"

echo "== E13. --by watchdog, the same session, no evidence: a Watchdog recovery at L"
mkro e13
em e13 lead-entry - '{"by":"stage","session":"A"}' 2026-10-26T10:00:00Z
em e13 lane-taken t '{}' 2026-10-26T10:10:00Z
ent e13 --by watchdog --session A --now 2026-10-26T12:00:00Z >/dev/null
ok "$(q e13 '[[d["kind"], d.get("cause") or d.get("stop"), d.get("at")] for d in L[2:]]')" '[["stopped","watchdog","2026-10-26T10:10:00.000Z"],["lead-entry","watchdog",null]]' "E13: watchdog at L, then its resume"

echo "== E14. another session's entry while lead A lives, then A's heartbeat tick: the tick infers no second dead-lead"
mkro e14
ent e14 --by stage --session A --now 2026-10-26T10:00:00Z >/dev/null
ent e14 --by lachy --session B --now 2026-10-26T10:30:00Z >/dev/null
ent e14 --by heartbeat --session A --now 2026-10-26T10:40:00Z >/dev/null
ent e14 --by heartbeat --session A --now 2026-10-26T11:00:00Z >/dev/null
ok "$(seq e14)" '["lead-entry:-","stopped:dead-lead:inf","lead-entry:dead-lead","lead-entry:-","lead-entry:-"]' \
  "E14: B's entry infers its dead-lead (by lachy); A's ticks after it are plain entries"
ok "$(q e14 '[d.get("session") for d in L if d["kind"] == "lead-entry"]')" '["A","B","A","A"]' "E14: each entry names its own session"

echo "== E14b. a heartbeat in a session other than the last entry's: a plain entry, the other stops still inferred"
mkro e14b
ent e14b --by stage --session A --now 2026-10-26T10:00:00Z >/dev/null
out=$(ent e14b --by heartbeat --session B --now 2026-10-26T10:20:00Z)
ok "$out" "e14b: lead-entry by=heartbeat" "E14b: no dead-lead from the session change"
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T10:30:00Z"}' ent e14b --by heartbeat --session A --now 2026-10-26T10:40:00Z >/dev/null
ok "$(seq e14b)" '["lead-entry:-","lead-entry:-","stopped:mac-restart:inf","lead-entry:mac-restart"]' "E14b: a heartbeat still infers a Mac restart"

echo "== P1. sleep_spans reads a pmset log shaped like this Mac's; machine_times falls back to kern.sleeptime"
cat > "$TMP/pmset.txt" <<'LOG'
2026-10-26 09:03:56 +1100 Assertions          	PID 111(powerd) Created InternalPreventSleep "com.apple.powermanagement.wakeschedule" 00:00:00
2026-10-26 17:38:52 +1100 Wake                	DarkWake to FullWake from Deep Idle [CDNVAP] : due to Notification Using AC (Charge:100%)
2026-10-26 18:22:03 +1100 Sleep               	Entering Sleep state due to 'Idle Sleep':TCPKeepAlive=active Using AC (Charge:100%) 63 secs
2026-10-26 18:22:30 +1100 Wake Requests       	[*process=dasd request=SleepService deltaSecs=1035 wakeAt=2026-10-26 18:40:00 info="x"]
2026-10-26 18:40:00 +1100 DarkWake            	DarkWake from Deep Idle [CDNP] : due to NUB.SPMI0Sw3IRQ rtc/SleepService Using BATT (Charge:91%) 2 secs
2026-10-26 18:40:00 +1100 WakeDetails         	DriverReason:NUB.SPMI0Sw3IRQ - DriverDetails:
2026-10-26 18:40:00 +1100 WakeTime            	WakeTime: 0.133 sec
2026-10-26 18:40:02 +1100 Sleep               	Entering Sleep state due to 'Sleep Service Back to Sleep':TCPKeepAlive=active 1043 secs
2026-10-26 22:30:59 +1100 Wake Requests       	[*process=dasd request=SleepService deltaSecs=1036 wakeAt=2026-10-26 22:48:15]
2026-10-26 22:31:35 +1100 DarkWake            	DarkWake from Deep Idle [CDNP] : due to smc.sysState.Wake(0x70070000) USB-C_plug Using BATT (Charge:89%) 0 secs
2026-10-26 22:31:35 +1100 Wake                	DarkWake to FullWake from Deep Idle [CDNVAP] : due to Notification Using AC (Charge:89%)
LOG
P1=$(python3 - "$SCRIPT" "$TMP/pmset.txt" <<'PY'
import importlib.util, json, os, subprocess, sys, types
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
text = open(sys.argv[2]).read()
z = lambda dt: dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
W = datetime(2026, 10, 26, 11, 31, 35, 20570, timezone.utc)          # kern.waketime: the full wake, to the usec
one = m.sleep_spans(text, None, W)
two_text = text + ("2026-10-26 23:00:00 +1100 Sleep               \tEntering Sleep state due to 'Idle Sleep'\n"
                   "2026-10-26 23:30:00 +1100 Wake                \tWake from Deep Idle [CDNVA] : due to lid\n")
two = m.sleep_spans(two_text, None, None)
since = m.sleep_spans(two_text, datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc), None)
garbage = m.sleep_spans("not a pmset log\n2026-10-26 22:31:35 +1100 WakeDetails \tx\n", None, W)
# machine_times with the Mac's reads stubbed: pmset finds no span, so kern.sleeptime's one sleep stands
os.environ.pop("THREAD_MACHINE_TIMES", None)
S = datetime(2026, 10, 26, 11, 30, 59, tzinfo=timezone.utc)
m._sysctl_times = lambda: (None, W, S)
m.subprocess = types.SimpleNamespace(run=lambda *a, **k: types.SimpleNamespace(returncode=0, stdout="garbage\n"),
                                     SubprocessError=subprocess.SubprocessError)
fb = m.machine_times(None, None)["sleeps"]
gate = m.machine_times(W, None)["sleeps"]
print(json.dumps({"one": [[z(s), z(w)] for s, w in one], "two": [[z(s), z(w)] for s, w in two],
                  "since": [[z(s), z(w)] for s, w in since], "garbage": garbage, "fallback": [[z(s), z(w)] for s, w in fb],
                  "gate": gate}))
PY
)
ok "$(printf '%s' "$P1" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["one"]))')" '[["2026-10-26T07:22:03.000Z", "2026-10-26T11:31:35.020Z"]]' "P1: one span from the first Sleep after the full Wake to kern's wake (the DarkWake cycles and Wake Requests inside it)"
ok "$(printf '%s' "$P1" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["two"]))')" '[["2026-10-26T07:22:03.000Z", "2026-10-26T11:31:35.000Z"], ["2026-10-26T12:00:00.000Z", "2026-10-26T12:30:00.000Z"]]' "P1: two full cycles give two spans"
ok "$(printf '%s' "$P1" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["since"]))')" '[["2026-10-26T12:00:00.000Z", "2026-10-26T12:30:00.000Z"]]' "P1: a span whose wake is not after since is dropped"
ok "$(printf '%s' "$P1" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["garbage"]))')" '[]' "P1: garbage gives []"
ok "$(printf '%s' "$P1" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["fallback"]))')" '[["2026-10-26T11:30:59.000Z", "2026-10-26T11:31:35.020Z"]]' "P1: machine_times falls back to kern.sleeptime"
ok "$(printf '%s' "$P1" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["gate"]))')" '[]' "P1: a wake not after since reads no sleep (the cheap gate)"

echo
[ "$fail" -eq 0 ] && echo "reconcile-rollout-stops: ALL PASS" || echo "reconcile-rollout-stops: SOME FAILED"
exit "$fail"
