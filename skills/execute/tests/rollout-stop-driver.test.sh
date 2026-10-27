#!/usr/bin/env bash
# Tests for hooks/rollout-stop-driver.py — the Stop-hook queue driver (ADR 0030, p12-9). It reads the lead's
# `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=<…>` line; progress is `merged` alone.
# Style mirrors reconcile-rollout.test.sh: ok/FAIL lines, ALL PASS at the end.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$HERE/../../../hooks/rollout-stop-driver.py"
RRPY="$HERE/../../_shared/scripts/run_record.py"
TMP="$(mktemp -d)"
export ROLLOUT_DRIVER_STATE_DIR="$TMP/state"
unset ROLLOUT_DRIVER_DEBUG
# p29-10: a halted line is recorded in the rollout's Run record, its note resolved in the vault under HOME: both temp.
export HOME="$TMP/home" PYTHONDONTWRITEBYTECODE=1 THREAD_MACHINE_TIMES='{}'
export THREAD_EVENTS_DIR="$TMP/events"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
VAULT="$HOME/repos/obsidian/Work/Tasks"; mkdir -p "$VAULT"
FAILURES=0

ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILURES=$((FAILURES+1)); }

# assistant_line <text> — emit a transcript JSONL line with an assistant text block
assistant_line() {
  python3 -c 'import json,sys; print(json.dumps({"type":"assistant","message":{"content":[{"type":"text","text":sys.argv[1]}]}}))' "$1"
}
# user_line <text> — a user/tool-result line (must be ignored by the driver)
user_line() {
  python3 -c 'import json,sys; print(json.dumps({"type":"user","message":{"content":[{"type":"text","text":sys.argv[1]}]}}))' "$1"
}

# run_driver <transcript> <session_id> — stdout captured in $OUT (no last_assistant_message: fallback path)
run_driver() {
  OUT="$(printf '{"transcript_path": "%s", "session_id": "%s", "stop_hook_active": false}' "$1" "$2" | python3 "$DRIVER")"
}

# run_driver_msg <last_assistant_message> <transcript> <session_id> — payload-primary path
run_driver_msg() {
  OUT="$(python3 -c 'import json,sys; print(json.dumps({"last_assistant_message": sys.argv[1], "transcript_path": sys.argv[2], "session_id": sys.argv[3], "stop_hook_active": False}))' "$1" "$2" "$3" | python3 "$DRIVER")"
}

# --- 0. the hook exists under its new name, with no alias ---
[ -f "$DRIVER" ] && ok "hooks/rollout-stop-driver.py exists" || fail "hooks/rollout-stop-driver.py is missing"

# --- 1. no ROLLOUT-STATUS anywhere → allow (empty output) ---
T="$TMP/t1.jsonl"
assistant_line "just a normal turn" > "$T"
run_driver "$T" s1
[ -z "$OUT" ] && ok "no status line: allows stop" || fail "no status line: expected empty, got: $OUT"

# --- 2. state=waiting → allow, with and without a gated: hold reason ---
T="$TMP/t2.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=1/3 running=2 state=waiting" > "$T"
run_driver "$T" s2
[ -z "$OUT" ] && ok "waiting: allows stop" || fail "waiting: expected empty, got: $OUT"
T="$TMP/t2b.jsonl"
assistant_line 'ROLLOUT-STATUS: demo merged=1/3 running=0 state=waiting reason="gated: awaiting merge approval for [[demo-a]] (PR #5)"' > "$T"
run_driver "$T" s2b
[ -z "$OUT" ] && ok "waiting on a gated: hold allows stop" || fail "gated hold: expected empty, got: $OUT"
# p28-1: a Trickle wait (execute §4.5 step 1.6) is a waiting turn like any other: its reason is no hold.
T="$TMP/t2c.jsonl"
assistant_line 'ROLLOUT-STATUS: demo merged=1/3 running=0 state=waiting reason="trickle: 3/2 tasks running on this Mac"' > "$T"
run_driver "$T" s2c
[ -z "$OUT" ] && ok "waiting on a Trickle wait allows stop" || fail "Trickle wait: expected empty, got: $OUT"
# p28-2: a last-starts wait (execute §4.5 step 1.6) is a waiting turn too.
T="$TMP/t2d.jsonl"
assistant_line 'ROLLOUT-STATUS: demo merged=1/3 running=0 state=waiting reason="last start: held until the Morning at 09:00"' > "$T"
run_driver "$T" s2d
[ -z "$OUT" ] && ok "waiting on a last-starts wait allows stop" || fail "last-starts wait: expected empty, got: $OUT"

# --- 3. state=running → block, naming the next steps of the queue loop ---
T="$TMP/t3.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=1/3 running=1 state=running" > "$T"
run_driver "$T" s3
echo "$OUT" | grep -q '"decision": "block"' && ok "running: blocks stop" || fail "running: expected block, got: $OUT"
echo "$OUT" | grep -q 'ROLLOUT-DRIVER: \[\[demo\]\]' && ok "running: reason names the rollout" || fail "running: reason missing slug: $OUT"
for w in "merged 1/3" "reconcile" "Integration" "merge-task.sh" "next" "Trickle" "last start" "Do not end the turn while state=running"; do
  echo "$OUT" | grep -qF "$w" && ok "running: reason names $w" || fail "running: reason lacks [$w]: $OUT"
done
echo "$OUT" | grep -q "cursor" && fail "running: reason still names a cursor: $OUT" || ok "running: no cursor in the reason"

# --- 4. cap: 3 blocks without merge progress, then release with systemMessage ---
for i in 2 3; do run_driver "$T" s3; done
echo "$OUT" | grep -q '"decision": "block"' && ok "cap: 3rd consecutive block still blocks" || fail "cap: 3rd block missing, got: $OUT"
run_driver "$T" s3
if [ -n "$OUT" ] && ! echo "$OUT" | grep -q '"decision"'; then
  echo "$OUT" | grep -q "systemMessage" && ok "cap: 4th releases with systemMessage" || fail "cap: release lacks systemMessage: $OUT"
  echo "$OUT" | grep -q "rollout-driver: released" && ok "cap: the release names rollout-driver" || fail "cap: release lacks rollout-driver: $OUT"
  echo "$OUT" | grep -q "without merge progress" && ok "cap: the release says without merge progress" || fail "cap: release wording: $OUT"
else
  fail "cap: expected release on 4th stop, got: $OUT"
fi

# --- 5. merged advancing resets the counter; a change in running alone does not ---
T="$TMP/t5.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=2/3 running=1 state=running" > "$T"
run_driver "$T" s3
echo "$OUT" | grep -q '"decision": "block"' && ok "progress: merged advancing blocks again" || fail "progress: expected block after merged advance, got: $OUT"
T="$TMP/t5b.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=0/3 running=1 state=running" > "$T"
for i in 1 2 3; do run_driver "$T" s5; done
T="$TMP/t5c.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=0/3 running=3 state=running" > "$T"
run_driver "$T" s5
if [ -n "$OUT" ] && ! echo "$OUT" | grep -q '"decision"'; then
  ok "progress: a change in running alone does not reset the count"
else
  fail "progress: running 1 -> 3 reset the count, got: $OUT"
fi

# --- 6. state=done → allow + state entry cleared, under ROLLOUT_DRIVER_STATE_DIR ---
[ -f "$ROLLOUT_DRIVER_STATE_DIR/s3.json" ] && ok "state lands under ROLLOUT_DRIVER_STATE_DIR" || fail "no state file under ROLLOUT_DRIVER_STATE_DIR"
python3 -c "
import json,sys
d=json.load(open('$ROLLOUT_DRIVER_STATE_DIR/s3.json'))
sys.exit(0 if d.get('demo', {}).get('merged') == 2 and 'cursor' not in d['demo'] else 1)
" && ok "state is per slug {merged, blocks}" || fail "state shape: $(cat "$ROLLOUT_DRIVER_STATE_DIR/s3.json")"
T="$TMP/t6.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=3/3 running=0 state=done" > "$T"
run_driver "$T" s3
[ -z "$OUT" ] && ok "done: allows stop" || fail "done: expected empty, got: $OUT"
python3 -c "
import json,sys
d=json.load(open('$ROLLOUT_DRIVER_STATE_DIR/s3.json'))
sys.exit(1 if 'demo' in d else 0)
" && ok "done: driver state cleared" || fail "done: state entry not cleared"

# --- 7. ROLLOUT-STATUS only in a user/tool-result line → ignored ---
T="$TMP/t7.jsonl"
user_line "docs excerpt: ROLLOUT-STATUS: demo merged=0/3 running=1 state=running" > "$T"
run_driver "$T" s7
[ -z "$OUT" ] && ok "non-assistant line: ignored" || fail "non-assistant line: expected empty, got: $OUT"

# --- 8. latest assistant line wins ---
T="$TMP/t8.jsonl"
{ assistant_line "ROLLOUT-STATUS: demo merged=1/3 running=1 state=running"
  assistant_line "ROLLOUT-STATUS: demo merged=1/3 running=1 state=waiting"; } > "$T"
run_driver "$T" s8
[ -z "$OUT" ] && ok "latest wins: waiting after running allows stop" || fail "latest wins: expected empty, got: $OUT"

# --- 9. halted → allow + clear ---
T="$TMP/t9.jsonl"
assistant_line 'ROLLOUT-STATUS: demo merged=1/3 running=0 state=halted reason="nothing can start: 2 set aside"' > "$T"
run_driver "$T" s9
[ -z "$OUT" ] && ok "halted: allows stop" || fail "halted: expected empty, got: $OUT"

# --- 10. placeholder/template text never matches ---
T="$TMP/t10.jsonl"
assistant_line 'template: ROLLOUT-STATUS: <rollout-slug> merged=<K>/<N> running=<R> state=<running|waiting|halted|done>' > "$T"
run_driver "$T" s10
[ -z "$OUT" ] && ok "template placeholders: ignored" || fail "template placeholders: matched, got: $OUT"

# --- 11. a cursor-shaped line, and a line with no running=, are ignored ---
T="$TMP/t11.jsonl"
assistant_line "ROLLOUT-STATUS: demo cursor=1/3 state=running" > "$T"
run_driver "$T" s11
[ -z "$OUT" ] && ok "a cursor-shaped line: ignored" || fail "cursor-shaped line: matched, got: $OUT"
T="$TMP/t11b.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=1/3 state=running" > "$T"
run_driver "$T" s11b
[ -z "$OUT" ] && ok "a line with no running=: ignored" || fail "no running=: matched, got: $OUT"

# --- 12. payload-primary: last_assistant_message running blocks, even with empty transcript ---
T="$TMP/t12.jsonl"; : > "$T"
run_driver_msg "ROLLOUT-STATUS: demo2 merged=0/4 running=2 state=running" "$T" s12
echo "$OUT" | grep -q '"decision": "block"' && ok "payload msg: running blocks (no transcript needed)" || fail "payload msg: expected block, got: $OUT"

# --- 13. payload-primary beats stale transcript: msg=waiting, transcript=running → allow ---
T="$TMP/t13.jsonl"
assistant_line "ROLLOUT-STATUS: demo2 merged=0/4 running=2 state=running" > "$T"
run_driver_msg "ROLLOUT-STATUS: demo2 merged=0/4 running=2 state=waiting" "$T" s13
[ -z "$OUT" ] && ok "payload msg: waiting overrides transcript running" || fail "payload override: expected empty, got: $OUT"

# --- 14. forgetting net: msg has no status line but transcript says running → block ---
T="$TMP/t14.jsonl"
assistant_line "ROLLOUT-STATUS: demo2 merged=0/4 running=2 state=running" > "$T"
run_driver_msg "task 1 merged, all good" "$T" s14
echo "$OUT" | grep -q '"decision": "block"' && ok "forgetting net: transcript running still blocks" || fail "forgetting net: expected block, got: $OUT"

# --- 15. p29-10: a halted line from the payload records the halt in the Run record ---
# mkro <stem> [frontmatter lines…]: a rollout note in the vault; halts <stem>: how many halt lines its record holds
mkro() {
  local s=$1; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Queue\n\n'; } > "$VAULT/$s.md"
}
halts() { python3 -c 'import json,sys
try: L = [json.loads(x) for x in open(sys.argv[1]) if x.strip()]
except FileNotFoundError: L = []
print(sum(d.get("kind") == "stopped" and d.get("cause") == "halt" for d in L))' "$THREAD_EVENTS_DIR/$1.jsonl"; }
halted() { printf 'ROLLOUT-STATUS: %s merged=0/2 running=1 state=halted reason="%s"' "$1" "$2"; }
T="$TMP/t15.jsonl"; : > "$T"
mkro hr
python3 "$RRPY" emit --rollout hr --kind lead-entry --json '{"by":"stage"}' --ts 2026-10-26T10:00:00Z
python3 "$RRPY" emit --rollout hr --task a --kind slot-taken --json '{"settings":{"parallel_ceiling":2}}' --ts 2026-10-26T10:01:00Z
run_driver_msg "$(halted hr "RACE undecided: [[hr-a]]")" "$T" s15
[ -z "$OUT" ] && ok "halt record: stdout unchanged (empty)" || fail "halt record: stdout changed: $OUT"
[ "$(halts hr)" = 1 ] && ok "halt record: one stopped halt" || fail "halt record: expected 1 halt, got $(halts hr)"
python3 -c 'import json,sys
d = [json.loads(x) for x in open(sys.argv[1])][-1]
ok = d["kind"] == "stopped" and d["inferred"] is False and d["reason"] == "RACE undecided: [[hr-a]]" and d["calls"] == [{"task": "a"}]
sys.exit(0 if ok else 1)' "$THREAD_EVENTS_DIR/hr.jsonl" && ok "halt record: live, with its reason and the calls in flight" || fail "halt record: fields: $(tail -1 "$THREAD_EVENTS_DIR/hr.jsonl")"
run_driver_msg "$(halted hr "RACE undecided: [[hr-a]]")" "$T" s15
[ "$(halts hr)" = 1 ] && ok "halt record: the same reason again writes none" || fail "halt record: a duplicate halt was written"
run_driver_msg "$(halted hr "rollout settings refused")" "$T" s15
[ "$(halts hr)" = 2 ] && ok "halt record: a new reason is a new halt" || fail "halt record: expected 2 halts, got $(halts hr)"
mkro hp "paused: 2026-10-26T10:30+00:00"
run_driver_msg "$(halted hp "paused at user request")" "$T" s15
[ "$(halts hp)" = 0 ] && ok "halt record: none while the note's paused: stands" || fail "halt record: a halt under a pause stamp"
mkro hq
python3 "$RRPY" emit --rollout hq --kind paused --json '{"mode":"soft"}' --ts 2026-10-26T10:30:00Z
run_driver_msg "$(halted hq "paused at user request")" "$T" s15
[ "$(halts hq)" = 0 ] && ok "halt record: none while the record's pause is open (no stamp)" || fail "halt record: a halt under an open record pause"
mkro hs "shape: serial"
run_driver_msg "ROLLOUT-STATUS: hs merged=1/3 running=0 state=halted reason=\"leg stopped: the chain's next task is blocked\"" "$T" s15
[ "$(halts hs)" = 0 ] && ok "halt record: none for a serial rollout's Leg" || fail "halt record: a Leg's halt was recorded"
run_driver_msg "$(halted nonote "x")" "$T" s15
[ ! -e "$THREAD_EVENTS_DIR/nonote.jsonl" ] && ok "halt record: none with no note" || fail "halt record: a record for a note that does not exist"
mkro hf
T="$TMP/t15f.jsonl"
assistant_line "$(halted hf "an old halt")" > "$T"
run_driver "$T" s15f
[ "$(halts hf)" = 0 ] && ok "halt record: none from the transcript fallback" || fail "halt record: the transcript fallback recorded a halt"
mkro hu
OUT_OK="$(python3 -c 'import json,sys; print(json.dumps({"last_assistant_message": sys.argv[1], "session_id": "s15u"}))' "$(halted hu "x")" \
  | THREAD_EVENTS_DIR="$VAULT/hu.md/events" python3 "$DRIVER" 2>"$TMP/hu.err")"; rc=$?
[ "$rc" = 0 ] && [ -z "$OUT_OK" ] && [ ! -s "$TMP/hu.err" ] && ok "halt record: an unwritable record changes no output" || fail "halt record: rc=$rc out=[$OUT_OK] err=[$(cat "$TMP/hu.err")]"

rm -rf "$TMP"
if [ "$FAILURES" -eq 0 ]; then echo; echo "ALL PASS"; else echo; echo "$FAILURES FAILURE(S)"; exit 1; fi
