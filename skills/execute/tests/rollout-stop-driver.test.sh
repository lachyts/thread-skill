#!/usr/bin/env bash
# Tests for hooks/rollout-stop-driver.py — the Stop-hook queue driver (ADR 0030, p12-9). It reads the lead's
# `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=<…>` line; progress is `merged` alone.
# Style mirrors reconcile-rollout.test.sh: ok/FAIL lines, ALL PASS at the end.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$HERE/../../../hooks/rollout-stop-driver.py"
TMP="$(mktemp -d)"
export ROLLOUT_DRIVER_STATE_DIR="$TMP/state"
unset ROLLOUT_DRIVER_DEBUG
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
[ ! -e "$HERE/../../../hooks/wave-stop-driver.py" ] && ok "no wave-stop-driver.py alias" || fail "hooks/wave-stop-driver.py still exists"

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

# --- 3. state=running → block, naming the next steps of the queue loop ---
T="$TMP/t3.jsonl"
assistant_line "ROLLOUT-STATUS: demo merged=1/3 running=1 state=running" > "$T"
run_driver "$T" s3
echo "$OUT" | grep -q '"decision": "block"' && ok "running: blocks stop" || fail "running: expected block, got: $OUT"
echo "$OUT" | grep -q 'ROLLOUT-DRIVER: \[\[demo\]\]' && ok "running: reason names the rollout" || fail "running: reason missing slug: $OUT"
for w in "merged 1/3" "reconcile" "Integration" "merge-task.sh" "next" "Do not end the turn while state=running"; do
  echo "$OUT" | grep -qF "$w" && ok "running: reason names $w" || fail "running: reason lacks [$w]: $OUT"
done
echo "$OUT" | grep -q "cursor\|wave" && fail "running: reason still names a cursor or wave: $OUT" || ok "running: no cursor or wave in the reason"

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
[ ! -e "$HOME/.claude/wave-driver/s3.json" ] && ok "nothing written to the old wave-driver dir" || fail "state written under ~/.claude/wave-driver"

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

# --- 11. the old wave line, and a line with no running=, are ignored ---
T="$TMP/t11.jsonl"
assistant_line "WAVE-STATUS: demo cursor=1/3 state=running" > "$T"
run_driver "$T" s11
[ -z "$OUT" ] && ok "an old WAVE-STATUS line: ignored" || fail "old WAVE-STATUS: matched, got: $OUT"
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

rm -rf "$TMP"
if [ "$FAILURES" -eq 0 ]; then echo; echo "ALL PASS"; else echo; echo "$FAILURES FAILURE(S)"; exit 1; fi
