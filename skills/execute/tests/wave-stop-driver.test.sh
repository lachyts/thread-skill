#!/usr/bin/env bash
# Tests for hooks/wave-stop-driver.py — the Stop-hook rollout driver.
# Style mirrors reconcile-wave.test.sh: ok/FAIL lines, ALL PASS at the end.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$HERE/../../../hooks/wave-stop-driver.py"
TMP="$(mktemp -d)"
export WAVE_DRIVER_STATE_DIR="$TMP/state"
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

# --- 1. no WAVE-STATUS anywhere → allow (empty output) ---
T="$TMP/t1.jsonl"
assistant_line "just a normal turn" > "$T"
run_driver "$T" s1
[ -z "$OUT" ] && ok "no status line: allows stop" || fail "no status line: expected empty, got: $OUT"

# --- 2. state=waiting → allow ---
T="$TMP/t2.jsonl"
assistant_line "WAVE-STATUS: demo cursor=1/3 state=waiting" > "$T"
run_driver "$T" s2
[ -z "$OUT" ] && ok "waiting: allows stop" || fail "waiting: expected empty, got: $OUT"

# --- 3. state=running → block ---
T="$TMP/t3.jsonl"
assistant_line "WAVE-STATUS: demo cursor=1/3 state=running" > "$T"
run_driver "$T" s3
echo "$OUT" | grep -q '"decision": "block"' && ok "running: blocks stop" || fail "running: expected block, got: $OUT"
echo "$OUT" | grep -q 'demo' && ok "running: reason names the rollout" || fail "running: reason missing slug"

# --- 4. cap: 3 blocks without progress, then release with systemMessage ---
for i in 2 3; do run_driver "$T" s3; done
echo "$OUT" | grep -q '"decision": "block"' && ok "cap: 3rd consecutive block still blocks" || fail "cap: 3rd block missing, got: $OUT"
run_driver "$T" s3
if [ -n "$OUT" ] && ! echo "$OUT" | grep -q '"decision"'; then
  echo "$OUT" | grep -q "systemMessage" && ok "cap: 4th releases with systemMessage" || fail "cap: release lacks systemMessage: $OUT"
else
  fail "cap: expected release on 4th stop, got: $OUT"
fi

# --- 5. cursor progress resets the counter ---
T="$TMP/t5.jsonl"
assistant_line "WAVE-STATUS: demo cursor=2/3 state=running" > "$T"
run_driver "$T" s3
echo "$OUT" | grep -q '"decision": "block"' && ok "progress: advanced cursor blocks again" || fail "progress: expected block after cursor advance, got: $OUT"

# --- 6. state=done → allow + state entry cleared ---
T="$TMP/t6.jsonl"
assistant_line "WAVE-STATUS: demo cursor=3/3 state=done" > "$T"
run_driver "$T" s3
[ -z "$OUT" ] && ok "done: allows stop" || fail "done: expected empty, got: $OUT"
python3 -c "
import json,sys
d=json.load(open('$WAVE_DRIVER_STATE_DIR/s3.json'))
sys.exit(1 if 'demo' in d else 0)
" && ok "done: driver state cleared" || fail "done: state entry not cleared"

# --- 7. WAVE-STATUS only in a user/tool-result line → ignored ---
T="$TMP/t7.jsonl"
user_line "docs excerpt: WAVE-STATUS: demo cursor=0/3 state=running" > "$T"
run_driver "$T" s7
[ -z "$OUT" ] && ok "non-assistant line: ignored" || fail "non-assistant line: expected empty, got: $OUT"

# --- 8. latest assistant line wins ---
T="$TMP/t8.jsonl"
{ assistant_line "WAVE-STATUS: demo cursor=1/3 state=running"
  assistant_line "WAVE-STATUS: demo cursor=1/3 state=waiting"; } > "$T"
run_driver "$T" s8
[ -z "$OUT" ] && ok "latest wins: waiting after running allows stop" || fail "latest wins: expected empty, got: $OUT"

# --- 9. halted → allow ---
T="$TMP/t9.jsonl"
assistant_line 'WAVE-STATUS: demo cursor=1/3 state=halted reason="merge conflict"' > "$T"
run_driver "$T" s9
[ -z "$OUT" ] && ok "halted: allows stop" || fail "halted: expected empty, got: $OUT"

# --- 10. placeholder/template text never matches ---
T="$TMP/t10.jsonl"
assistant_line 'template: WAVE-STATUS: <rollout-slug> cursor=<K>/<N> state=<running|waiting|halted|done>' > "$T"
run_driver "$T" s10
[ -z "$OUT" ] && ok "template placeholders: ignored" || fail "template placeholders: matched, got: $OUT"

# --- 11. payload-primary: last_assistant_message running blocks, even with empty transcript ---
T="$TMP/t11.jsonl"; : > "$T"
run_driver_msg "WAVE-STATUS: demo2 cursor=0/4 state=running" "$T" s11
echo "$OUT" | grep -q '"decision": "block"' && ok "payload msg: running blocks (no transcript needed)" || fail "payload msg: expected block, got: $OUT"

# --- 12. payload-primary beats stale transcript: msg=waiting, transcript=running → allow ---
T="$TMP/t12.jsonl"
assistant_line "WAVE-STATUS: demo2 cursor=0/4 state=running" > "$T"
run_driver_msg "WAVE-STATUS: demo2 cursor=0/4 state=waiting" "$T" s12
[ -z "$OUT" ] && ok "payload msg: waiting overrides transcript running" || fail "payload override: expected empty, got: $OUT"

# --- 13. forgetting net: msg has no status line but transcript says running → block ---
T="$TMP/t13.jsonl"
assistant_line "WAVE-STATUS: demo2 cursor=0/4 state=running" > "$T"
run_driver_msg "wave 1 merged, all good" "$T" s13
echo "$OUT" | grep -q '"decision": "block"' && ok "forgetting net: transcript running still blocks" || fail "forgetting net: expected block, got: $OUT"

rm -rf "$TMP"
if [ "$FAILURES" -eq 0 ]; then echo; echo "ALL PASS"; else echo; echo "$FAILURES FAILURE(S)"; exit 1; fi
