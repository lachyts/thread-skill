#!/usr/bin/env bash
# p36-7 (ADR 0067 d8): one Mac-wide Capacity sets the starts. `next` reads ~/.config/thread/capacity.json
# (skills/execute/scripts/capacity.py; execute away.md § Capacity): while a fresh reading is in force, C =
# min(max(capacity, 1), capacity_max) takes the Trickle's (or the Away cap's) number; a missing, stale or unreadable
# reading, or a capacity_max that will not resolve, falls back to today's Trickle and Away cap exactly, never to open.
# While in force, Legs count behind their Leg lease (a dead Leg's lease lapses), and a lead whose Login is inside its
# line starts nothing new (the quota hold). A Mac fault (ADR 0083 d2: a non-empty `signals.fault`) is one stderr line
# from `next` and `trickle.capacity.fault` from `next` and `status`, and holds nothing (C14). Every call pins HOME to
# its scenario's own dir and --now, and reads stdout and stderr apart; the Login's env is unset unless a case sets it.
# Temp notes only.
# Usage: bash reconcile-rollout-capacity.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
export THREAD_MACHINE_TIMES='{}'   # no boot or wake evidence unless a case gives it (a lease's lapse)
export THREAD_HEAT_LEVEL=0         # the Heat hold's reading, pinned (C7 sets its own)
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR CLAUDE_ACCOUNT_PINNED XDG_STATE_HOME CODEX_THREAD_ID

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"            # the Run record stays in temp (C8 reads its idle-slots)
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"     # the note locks and the Trickle claims file stay in temp too
NOW=2026-10-02T14:05:00Z
HOUR_AGO=2026-10-02T13:05:00Z
MIN_AGO=2026-10-02T14:04:00Z
WARN_CAP='WARN: ~/.config/thread/capacity.json '

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/home"; echo "== $1"; }
# mkro <stem> <ceiling> [frontmatter lines...] — a parallel rollout note in $D; its tasks list themselves (mkt).
mkro() {
  local s="$1" c="$2"; shift 2
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: %s\n' "$c"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nfixture\n\n## Queue\n\n'; } > "$D/$s.md"
}
# mkserial <stem>: a serial rollout note in $D (a chain's, read only for the Leg count).
mkserial() {
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nshape: serial\n---\n\n## Queue\n\n' > "$D/$1.md"
}
# mkt <slug> <rollout> <status> [frontmatter lines...] — a task note in $D, appended to its rollout's queue list.
mkt() {
  local s="$1" ro="$2" st="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\n' "$st" "$ro"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
  printf -- '- [[%s]]\n' "$s" >> "$D/$ro.md"
}
# nx <rollout> [next flags...] — `next` on $D/<rollout>.md, HOME pinned to $D/home; stderr lands in $D/err.
nx() { local ro="$1"; shift; HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/$ro.md" --tasks-dir "$D" --now "${XNOW:-$NOW}" "$@" 2>"$D/err"; }
st() { local ro="$1"; shift; HOME="$D/home" python3 "$SCRIPT" status --rollout "$D/$ro.md" --tasks-dir "$D" --now "${XNOW:-$NOW}" "$@" 2>"$D/err"; }
err() { cat "$D/err"; }
lines() { if [ -s "$D/err" ]; then wc -l < "$D/err" | tr -d ' '; else echo 0; fi; }
q() { printf '%s' "$1" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("PARSE"); sys.exit(0)
print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
holds='{h["slug"]: h["reason"] for h in d["hold"]}'
capof='{k: d["trickle"]["capacity"][k] for k in ("file", "limit", "max", "maxSource")}'
cap_raw() { mkdir -p "$D/home/.config/thread"; printf '%s' "$1" > "$D/home/.config/thread/capacity.json"; }
# cap <capacity> <written_at> [extra JSON members]: a capacity.json as Chorus writes it.
cap() { cap_raw "{\"capacity\": $1, \"written_at\": \"$2\"${3:+, $3}}"; }
LEASES=home/.config/thread/leases
lease_raw() { mkdir -p "$D/$LEASES"; printf '%s' "$2" > "$D/$LEASES/$1.json"; }
leglease() { lease_raw "$1" "{\"rollout\": \"$1\", \"written_at\": \"$2\", \"by\": \"leg\"${3:+, $3}}"; }
sums() { cksum "$D"/*.md | awk '{print $1 $2}' | tr '\n' ' '; }
claims() { python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
except FileNotFoundError:
    print("none"); sys.exit(0)
print(json.dumps(eval(sys.argv[2]), separators=(",", ":"), sort_keys=True))' "$THREAD_NOTE_LOCK_DIR/trickle-claims.json" "$1"; }
six() { mkro ro 8; for t in r1 r2 r3 r4 r5 r6; do mkt "$t" ro open; done; }
# The removals, each by a guarded path.
uncap() { rm -f "${D:?}/home/.config/thread/capacity.json"; }
untoml() { rm -f "${D:?}/home/.config/thread/rollouts.toml"; }
unlease() { rm -f "${D:?}/home/.config/thread/leases/${1:?}.json"; }
unclaims() { rm -f "${THREAD_NOTE_LOCK_DIR:?}/trickle-claims.json"; }

# ── C1: a fresh Capacity of 5 lets 5 starts through and holds the sixth ──────────────────────────────────────────
scen c1-five
six
cap 5 "$MIN_AGO"
J=$(nx ro); rc=$?
ok "$rc" 0 "C1: next exits 0"
ok "$(q "$J" 'd["start"]')" '["r1","r2","r3","r4","r5"]' "C1: five start under a Capacity of 5"
ok "$(q "$J" "$holds")" '{"r6":"trickle: 5/5 tasks running on this Mac"}' "C1: the sixth waits on the Capacity, as the Trickle's hold"
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["limit"], d["halt"]]')" '[5,5,null]' "C1: slotLimit 5, trickle.limit 5, no halt"
ok "$(q "$J" "$capof")" '{"file":"fresh","limit":5,"max":6,"maxSource":"built-in"}' "C1: trickle.capacity reads fresh, C 5, max 6 built-in"
ok "$(lines)" 0 "C1: a fresh reading prints no WARN"
ok "$(q "$J" 'd["trickle"]["capacity"]["budget"]')" null "C1: a file with no budget reports none (p53-2)"

# ── C2: no file reads the Trickle of 2, silently ─────────────────────────────────────────────────────────────────
scen c2-missing
six
J=$(nx ro)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["trickle"]["limit"], d["trickle"]["awayCap"]]')" '[["r1","r2"],2,2,4]' "C2: no file: two start, the Trickle 2 and the Away cap 4 as before"
ok "$(q "$J" 'sorted(set(h["reason"] for h in d["hold"]))')" '["trickle: 2/2 tasks running on this Mac"]' "C2: the other four wait on the Trickle"
ok "$(q "$J" '[d["trickle"]["capacity"][k] for k in ("file", "inForce", "limit")]')" '["missing",false,null]' "C2: trickle.capacity reads missing, not in force"
ok "$(lines)" 0 "C2: a missing file prints no WARN"

# ── C3: stale and unreadable readings fall back to the Trickle, each with one WARN ───────────────────────────────
scen c3-fallback
six
fallback() {  # fallback <label> <expected why fragment>
  J=$(nx ro --dry-run)
  ok "$(q "$J" '[d["start"], d["slotLimit"], d["trickle"]["capacity"]["inForce"]]')" '[["r1","r2"],2,false]' "C3: $1 reads the Trickle 2"
  ok "$(lines)" 1 "C3: $1 prints one WARN"; has "$(err)" "$2" "C3: … naming it"
  has "$(err)" " — read as the Trickle" "C3: … read as the Trickle"
}
cap 5 2026-10-02T13:54:00Z; fallback "11 minutes old" "${WARN_CAP}stale: written_at 2026-10-02T13:54:00Z is over 10 minutes old"
cap 5 2026-10-02T14:11:00Z; fallback "6 minutes ahead" "${WARN_CAP}stale: written_at 2026-10-02T14:11:00Z is more than 5 minutes ahead"
cap_raw 'not json'; fallback "not JSON" "${WARN_CAP}unreadable: not JSON"
cap_raw '[5]'; fallback "an array" "${WARN_CAP}unreadable: not a JSON object"
cap 0 "$MIN_AGO"; fallback "capacity 0" 'unreadable: `capacity` is not a JSON integer of at least 1'
cap true "$MIN_AGO"; fallback "capacity true" 'unreadable: `capacity` is not a JSON integer'
cap 2.5 "$MIN_AGO"; fallback "capacity 2.5" 'unreadable: `capacity` is not a JSON integer'
cap '"5"' "$MIN_AGO"; fallback "capacity a string" 'unreadable: `capacity` is not a JSON integer'
cap_raw '{"capacity": 5}'; fallback "no written_at" 'unreadable: no `written_at`'
cap 5 2026-10-02T14:04:00; fallback "a naive stamp" 'unreadable: `written_at` is naive'
cap 5 garbage; fallback "a garbage stamp" 'unreadable: `written_at` is not an ISO 8601 stamp'
cap_raw "$(python3 -c 'import json; print(json.dumps({"capacity": 5, "written_at": "2026-10-02T14:04:00Z", "pad": "x" * 70000}))')"
fallback "over 64 KiB" "unreadable: over 64 KiB"
printf '\377\376' > "$D/home/.config/thread/capacity.json"; fallback "not UTF-8" "unreadable: not UTF-8"
cap 5 "$MIN_AGO" '"logins": []'; fallback "logins a list" 'unreadable: `logins` is not a JSON object'
cap 5 "$MIN_AGO" '"logins": {"a": {"inside_line": "yes"}}'; fallback "an inside_line string" 'unreadable: `logins` ["a"] has no JSON boolean'
uncap; mkdir -p "$D/home/.config/thread/capacity.json"; fallback "a directory at the path" "unreadable: cannot read it"
rmdir "$D/home/.config/thread/capacity.json"
ln -s "$D/nowhere.json" "$D/home/.config/thread/capacity.json"; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["file"]]')|$(lines)" '[2,"missing"]|0' "C3: a dangling symlink reads missing, silently"
uncap
cap 5 2026-10-02T13:55:00Z; J=$(nx ro --dry-run)
ok "$(q "$J" 'd["slotLimit"]')|$(lines)" "5|0" "C3: exactly 10:00 old is still fresh (C 5, no WARN)"
cap 5 2026-10-02T14:10:00Z; J=$(nx ro --dry-run)
ok "$(q "$J" 'd["slotLimit"]')|$(lines)" "5|0" "C3: exactly 5:00 ahead is still fresh"
cap 5 "$MIN_AGO" '"signals": {"load": 3}, "extra": 1, "logins": {"a": {"inside_line": false, "why": "ok"}}'; J=$(nx ro --dry-run)
ok "$(q "$J" 'd["slotLimit"]')|$(lines)" "5|0" "C3: signals, logins and an extra key read fresh"

# ── C4: the clamp, and capacity_max ──────────────────────────────────────────────────────────────────────────────
scen c4-clamp
six
cap 50 "$MIN_AGO"; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], len(d["start"])]')|$(q "$J" "$capof")" '[6,6]|{"file":"fresh","limit":6,"max":6,"maxSource":"built-in"}' "C4: a Capacity of 50 is clamped to the built-in maximum 6"
mkdir -p "$D/home/.config/thread"; printf 'schema = 4\n\n[defaults]\ncapacity_max = 3\n' > "$D/home/.config/thread/rollouts.toml"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["max"], d["trickle"]["capacity"]["maxSource"]]')" '[3,3,"file:defaults"]' "C4: [defaults] capacity_max = 3 reads C 3"
printf '[defaults]\ncapacity_max = 0\n' > "$D/home/.config/thread/rollouts.toml"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["inForce"], d["trickle"]["capacity"]["max"]]')" '[2,false,null]' "C4: a refused rollouts.toml falls back to the Trickle 2"
ok "$(lines)" 1 "C4: … with one WARN"; has "$(err)" "${WARN_CAP}capacity_max unresolved: " "C4: … naming capacity_max"
printf 'schema = 4\n\n[defaults]\ncapacity_max = 1\n' > "$D/home/.config/thread/rollouts.toml"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["limit"]]')" '[1,1]' "C4: capacity_max 1 gives C 1"
untoml

# ── C5: Away: the Capacity takes the Away cap's number; no file reads the Away cap as before ──────────────────────
scen c5-away
six
away_file "$D/home" "$HOUR_AGO" true 2026-10-02T22:05:00Z 2 09:00
cap 3 "$MIN_AGO"; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["start"], d["trickle"]["away"], d["trickle"]["awayCap"]]')" '[["r1","r2","r3"],true,3]' "C5: Away with a Capacity of 3: three start"
ok "$(q "$J" 'sorted(set(h["reason"] for h in d["hold"]))')" '["away cap: 3/3 tasks running on this Mac"]' "C5: … the rest read away cap: 3/3"
uncap; J=$(nx ro --dry-run)
ok "$(q "$J" '[len(d["start"]), d["trickle"]["awayCap"], d["hold"]]')" '[6,99,[]]' "C5: Away with no Capacity reads the file's Away cap 99"

# ── C6: Legs count behind their Leg lease, only while Capacity is in force ────────────────────────────────────────
scen c6-legs
six
mkserial chain; mkt c1 chain in_progress 'owner: leg-1' 'leg: 1'; mkt c2 chain open
cap 5 "$MIN_AGO"
leglease chain "$MIN_AGO"; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["slotLimit"], len(d["start"])]')" '[{"chain":1},4,4]' "C6: a Leg claim with a fresh Leg lease counts (chain 1): four start"
ok "$(q "$J" 'sorted(set(h["reason"] for h in d["hold"]))')" '["trickle: 5/5 tasks running on this Mac"]' "C6: … the rest wait on the Capacity"
leglease chain 2026-10-02T12:35:00Z; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["trickle"]["lapsed"]]')" '[{"chain":1},{}]' "C6: a Leg lease 90:00 old still counts"
leglease chain 2026-10-02T12:34:59Z; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["trickle"]["lapsed"], d["slotLimit"]]')" '[{},{"chain":1},5]' "C6: at 90:01 it is lapsed and named"
leglease chain 2026-10-02T11:06:00Z '"waiting": true'; J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":1}' "C6: a waiting Leg lease 179 min old counts"
leglease chain 2026-10-02T11:05:00Z '"waiting": true'; J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":1}' "C6: … exactly 180:00 old still counts"
leglease chain 2026-10-02T11:04:59Z '"waiting": true'; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["trickle"]["lapsed"]]')" '[{},{"chain":1}]' "C6: … at 180:01 it is lapsed"
leglease chain 2026-10-02T12:00:00Z
J=$(THREAD_MACHINE_TIMES='{"wake": "2026-10-02T13:00:00Z"}' nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":1}' "C6: a wake after the write restarts its 90-minute window"
lease_raw chain '{"rollout": "chain", "written_at": "2026-10-02T14:20:00Z", "by": "leg"}'; J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":1}' "C6: a Leg lease more than 5 min ahead reads unreadable and counts"
unlease chain; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["trickle"]["lapsed"]]')" '[{},{}]' "C6: no Leg lease holds nothing (an older Leg writes none)"
leglease chain "$MIN_AGO"; uncap; J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["slotLimit"]]')" '[{},2]' "C6: with no Capacity the Leg is not counted (today's Trickle)"

# ── C7: the Heat hold still holds every start under a Capacity ───────────────────────────────────────────────────
scen c7-heat
six
cap 5 "$MIN_AGO"; J=$(THREAD_HEAT_LEVEL=2 nx ro --dry-run)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["halt"]]')" '[[],0,null]' "C7: heavy heat: nothing starts, slotLimit 0, no halt"
ok "$(q "$J" 'sorted(set(h["reason"] for h in d["hold"]))')" '["heat: the Mac is hot (heavy)"]' "C7: … every row reads heat:"

# ── C8: the quota hold ───────────────────────────────────────────────────────────────────────────────────────────
scen c8-quota
mkro ro 8; mkt r0 ro in_progress 'owner: lead-ro'; for t in r1 r2 r3; do mkt "$t" ro open; done
IN='"logins": {"login-a": {"inside_line": true, "why": "5h window at 92%"}, "dummy": {"inside_line": false}}'
cap 5 "$MIN_AGO" "$IN"
here=$(cd "$D" && pwd -P)
mkdir -p "$THREAD_NOTE_LOCK_DIR"
printf '{"version": 1, "claims": [], "waiting": [{"tasksDir": "%s", "rollout": "ro", "since": "2026-10-02T14:00:00+00:00", "at": "2026-10-02T14:04:00+00:00", "served": null, "want": 2}], "woken": []}\n' "$here" > "$THREAD_NOTE_LOCK_DIR/trickle-claims.json"
QA="quota: login-a is inside its line"
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-a nx ro --running none)
ok "$(q "$J" '[d["start"], d["restart"], d["slotLimit"], d["halt"]]')" '[[],["r0"],0,null]' "C8: inside its line: nothing new starts, the stalled r0 still restarts, no halt"
ok "$(q "$J" "$holds")" "{\"r1\":\"$QA\",\"r2\":\"$QA\",\"r3\":\"$QA\"}" "C8: every queued row reads the quota hold"
ok "$(claims '[w["rollout"] for w in d["waiting"]]')" '[]' "C8: no waiting record of its own (the earlier one is removed)"
ok "$(python3 -c 'import json,sys; print([json.loads(l)["reason"] for l in open(sys.argv[1]) if json.loads(l).get("kind") == "idle-slots"][-1])' "$THREAD_EVENTS_DIR/ro.jsonl")" hold-quota "C8: idle-slots reads hold-quota"
ok "$(q "$J" 'd["trickle"]["capacity"]["quota"]')" '{"inside":true,"login":"login-a","why":"5h window at 92%"}' "C8: trickle.capacity.quota names the Login"
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_CONFIG_DIR=/x/profiles/login-a/ nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["hold"][0]["reason"]]')" "[0,\"$QA\"]" "C8: no pin: CLAUDE_CONFIG_DIR's basename names login-a"
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=' login-a ' nx ro --dry-run)
ok "$(q "$J" 'd["slotLimit"]')" 0 "C8: a pin with whitespace is stripped"
cap 5 "$MIN_AGO" '"logins": {"dummy": {"inside_line": true}}'
J=$(CLAUDE_CODE_SESSION_ID=s1 nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["hold"][0]["reason"]]')" '[0,"quota: dummy is inside its line"]' "C8: neither set reads the primary Login, dummy"
cap 5 "$MIN_AGO" "$IN"
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-b nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], len(d["start"])]')" '[5,3]' "C8: another Login is not held"
J=$(CLAUDE_ACCOUNT_PINNED=login-a nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["quota"]]')" '[5,null]' "C8: no CLAUDE_CODE_SESSION_ID (Codex, a terminal): never held"
J=$(THREAD_HEAT_LEVEL=3 CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-a nx ro --dry-run)
ok "$(q "$J" 'sorted(set(h["reason"] for h in d["hold"]))')" '["heat: the Mac is hot (trapping)"]' "C8: quota and heat read heat:"
uncap
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-a nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["start"]]')" '[2,["r1"]]' "C8: with no Capacity no quota hold (the Trickle 2: r0 and one start)"

# ── C9: a waiting Leg keeps its place in line: its session's, once (ADR 0076 d3), else a kept one ────────────────────
scen c9-share
six; mkserial chain; mkt c1 chain open
cap 3 "$MIN_AGO"
here=$(cd "$D" && pwd -P)
wait_rec() { printf '{"version": 1, "claims": [], "waiting": [{"tasksDir": "%s", "rollout": "chain", "since": "2026-10-02T14:00:00+00:00", "at": "2026-10-02T14:04:00+00:00", "served": null, "want": 1}], "woken": []}\n' "$here" > "$THREAD_NOTE_LOCK_DIR/trickle-claims.json"; }
mkdir -p "$THREAD_NOTE_LOCK_DIR"; wait_rec; leglease chain "$MIN_AGO"
J=$(nx ro)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["elsewhere"], d["trickle"]["kept"], len(d["start"])]')" '[2,{"chain":1},{},2]' "C9: a waiting Leg with a fresh lease holds its place through its session (chain 1), never a kept place on top: slotLimit 2"
ok "$(q "$J" 'd["hold"][0]["reason"]')" '"trickle: 3/3 tasks running on this Mac"' "C9: … its hold counts the Leg's session and keeps nothing"
ok "$(claims '[[w["rollout"], w["by"]] for w in d["woken"]]')" '[]' "C9: … and writes no wake (the place is already its own)"
six; wait_rec; lease_raw chain '{"rollout": "chain", "written_at": "2026-10-02T14:20:00Z", "by": "leg"}'
J=$(nx ro)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["elsewhere"], d["trickle"]["kept"], len(d["start"])]')" '[2,{},{"chain":1},2]' "C9: an unreadable Leg lease holds no session place, so the lead keeps 1 for [[chain]] in line and lowers slotLimit"
ok "$(q "$J" 'd["hold"][0]["reason"]')" '"trickle: 2/3 tasks running on this Mac, 1 kept for [[chain]]"' "C9: … its hold names it"
ok "$(claims '[[w["rollout"], w["by"]] for w in d["woken"]]')" '[["chain","ro"]]' "C9: … and writes chain a wake"
six; wait_rec; leglease chain 2026-10-02T11:00:00Z
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["kept"]]')" '[3,{}]' "C9: a lapsed Leg lease keeps nothing"
leglease chain "$MIN_AGO"; uncap
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["kept"]]')" '[2,{}]' "C9: with no Capacity a serial record keeps nothing (the Trickle 2)"

# ── C10: --dry-run writes nothing ────────────────────────────────────────────────────────────────────────────────
scen c10-dry
six; cap 5 "$MIN_AGO"; unclaims
before=$(sums)
J=$(nx ro --dry-run)
ok "$(q "$J" 'len(d["start"])')|$(sums)" "5|$before" "C10: --dry-run reads the Capacity and leaves every note byte-identical"
ok "$([ -e "$D/$LEASES/ro.json" ] && echo lease || echo none)|$(claims 'd')" "none|none" "C10: … no lease and no claims file"

# ── C11: status reports the Capacity and counts the Leg ──────────────────────────────────────────────────────────
scen c11-status
six; mkserial chain; mkt c1 chain in_progress 'owner: leg-2'
cap 5 "$MIN_AGO"; leglease chain "$MIN_AGO"
J=$(CLAUDE_CODE_SESSION_ID=s1 st ro)
ok "$(q "$J" '[d["trickle"]["limit"], d["trickle"]["elsewhere"], d["trickle"]["capacity"]["file"], d["trickle"]["capacity"]["quota"]]')" '[5,{"chain":1},"fresh",null]' "C11: status reads C 5, counts the Leg and reads no quota"
ok "$(lines)" 0 "C11: status prints no WARN"

# ── C12: an open Leg counts its session, and only a live Leg claim adds to it (ADR 0076 d3) ───────────────────────
scen c12-window
six; mkserial chain
mkt c1 chain done 'owner: leg-1'; mkt c2 chain in_progress 'owner: lead-x'; mkt c3 chain blocked 'owner: leg-1'
cap 5 "$MIN_AGO"; leglease chain "$MIN_AGO"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["slotLimit"]]')" '[{"chain":1},4]' "C12: a done, a lead-owned and a set-aside row add no claim: the open Leg counts 1, its session"
mkt c4 chain in_progress 'owner: leg-1'
mkdir -p "$D/Archive"; mkserial old; mv "$D/old.md" "$D/Archive/old.md"
printf -- '---\ntags: [task]\nstatus: in_progress\nowner: leg-1\nrollout: "[[old]]"\n---\n' > "$D/o1.md"
leglease old "$MIN_AGO"
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":1}' "C12: one Leg claim counts once, in its session's place; an archived chain never counts"
mkt c5 chain in_progress 'owner: leg-2'
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":2}' "C12: two Leg claims count 2, the session adding nothing on top"

# ── C13: the lead's lease names its Login; --quota-login (moving's dry run) reads a named Login ──────────────────────
scen c13-login
mkro ro 8; for t in r1 r2; do mkt "$t" ro open; done
cap 5 "$MIN_AGO" '"logins": {"login-a": {"inside_line": true}}'
leaseof() { python3 -c 'import json, sys
d = json.load(open(sys.argv[1]))
print(json.dumps([d.get("by"), d.get("login")], separators=(",", ":")))' "$D/$LEASES/ro.json"; }
CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-b nx ro >/dev/null
ok "$(leaseof)" '["next","login-b"]' "C13: next off --dry-run names the caller's Login in its lease"
nx ro >/dev/null
ok "$(leaseof)" '["next",null]' "C13: … a caller that is no Claude Code session names none"
J=$(nx ro --dry-run --quota-login login-a)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["quota"]["login"], d["hold"][0]["reason"]]')" \
  '[0,"login-a","quota: login-a is inside its line"]' "C13: --quota-login login-a reads that Login's line, the caller no session at all"
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-a nx ro --dry-run --quota-login "")
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["quota"]]')" '[5,null]' "C13: --quota-login \"\" reads no quota, the caller's own Login inside its line"
J=$(CLAUDE_CODE_SESSION_ID=s1 CLAUDE_ACCOUNT_PINNED=login-a nx ro --dry-run --quota-login login-b)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["capacity"]["quota"]["inside"]]')" '[5,false]' "C13: --quota-login login-b reads login-b's line, never the caller's"
before=$(cat "$D/$LEASES/ro.json")
J=$(nx ro --quota-login login-a); rc=$?
ok "$rc|$J|$(cat "$D/$LEASES/ro.json")" "2||$before" "C13: --quota-login without --dry-run: exit 2, no stdout, the lease untouched"
has "$(err)" "--quota-login is read only with --dry-run" "C13: … naming why"

# ── C14: a Mac fault is said, never obeyed (ADR 0083 d2, p53-1) ──────────────────────────────────────────────────
scen c14-fault
six
FAULT_LINE="${WARN_CAP}fault: memory (held by fseventsd) — a Mac fault, never waited on"
FAULT='{"holder":{"mem_gb":86.0,"name":"fseventsd"},"signals":["memory"]}'
FAULT_SIGNALS='"signals": {"fault": ["memory"], "holder": {"name": "fseventsd", "mem_gb": 86.0}, "memory": 2, "freeze": []}'
cap 5 "$MIN_AGO" "$FAULT_SIGNALS"
J=$(nx ro)
ok "$(q "$J" 'd["start"]')" '["r1","r2","r3","r4","r5"]' "C14: a memory fault holds nothing: five start under a Capacity of 5"
ok "$(q "$J" "$holds")" '{"r6":"trickle: 5/5 tasks running on this Mac"}' "C14: the sixth waits on the Capacity alone"
ok "$(q "$J" 'any("fault" in h["reason"] for h in d["hold"])')" 'false' "C14: no hold reason names the fault"
ok "$(lines)|$(err)" "1|$FAULT_LINE" "C14: next prints one line naming the fault and its holder"
ok "$(q "$J" 'd["trickle"]["capacity"]["fault"]')" "$FAULT" "C14: trickle.capacity.fault reports it"
J=$(nx ro --dry-run)
ok "$(lines)|$(err)" "1|$FAULT_LINE" "C14: --dry-run prints it too"
cap 5 "$MIN_AGO" '"signals": {"fault": ["thermal", "memory"], "holder": {"mem_gb": 3}}'
J=$(nx ro --dry-run)
ok "$(err)" "${WARN_CAP}fault: thermal, memory — a Mac fault, never waited on" "C14: two faults, in the file's order; a holder with no name is not named"
cap 5 "$MIN_AGO" '"signals": {"fault": [], "memory": 2, "freeze": []}'
J=$(nx ro --dry-run)
ok "$(lines)|$(q "$J" 'd["trickle"]["capacity"]["fault"]')" "0|null" "C14: fault [] prints nothing and reports null"
cap 5 2026-10-02T13:54:00Z "$FAULT_SIGNALS"
J=$(nx ro --dry-run)
ok "$(lines)|$(q "$J" 'd["trickle"]["capacity"]["fault"]')" "1|null" "C14: a stale file's fault is not read: one line, null"
has "$(err)" "${WARN_CAP}stale: " "C14: … that line the stale WARN"
cap 5 "$MIN_AGO" "$FAULT_SIGNALS"
J=$(st ro)
ok "$(q "$J" 'd["trickle"]["capacity"]["fault"]')|$(lines)" "$FAULT|0" "C14: status reports trickle.capacity.fault, silently"

# ── C15: the budget is reported, fresh and well-typed only (p53-2, ADR 0083 d4) ──────────────────────────────────────
scen c15-budget
six
cap 5 "$MIN_AGO" '"budget": {"mem_gb": 12.0, "cores": 8}'
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["capacity"]["budget"]')" '{"cores":8,"mem_gb":12.0}' "C15: next reports trickle.capacity.budget"
cap 5 "$MIN_AGO" '"budget": {"mem_gb": 12.0, "cores": 0}'
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["capacity"]["budget"], d["trickle"]["capacity"]["limit"]]')|$(lines)" '[null,5]|0' \
  "C15: an ill-typed budget (cores 0) reads none, silently, and the Capacity stays in force"

# ── C16: capacity.py's peak() and read()'s budget, case by case, in one process (p53-2) ─────────────────────────────
# peak(tree, since, ref, now) against a fixed Slot taken 13:00, its call ending 14:00 (ref), read at 14:05 (now): each
# case rewrites slot-peaks.json, and the process prints every case whose result is not the one it expects.
scen c16-peak
mkdir -p "$D/tree" "$D/home/.config/thread"; ln -s "$D/tree" "$D/link"
C16=$(cd "$D" && HOME="$D/home" python3 - "$HERE/../scripts/capacity.py" "$D" <<'PY2'
import importlib.util, json, os, sys
from datetime import datetime, timedelta, timezone
spec = importlib.util.spec_from_file_location("capacity", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
D = sys.argv[2]
TREE, LINK = D + "/tree", D + "/link"
PEAKS = os.path.join(D, "home", m.SLOT_PEAKS_FILE_REL)
CAP = os.path.join(D, "home", m.CAPACITY_FILE_REL)
SINCE = datetime(2026, 10, 2, 13, 0, tzinfo=timezone.utc)
REF = datetime(2026, 10, 2, 14, 0, tzinfo=timezone.utc)
NOW = REF + timedelta(minutes=5)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
FRESH, LAST = iso(REF - timedelta(minutes=1)), iso(REF - timedelta(minutes=2))
PEAK = {"mem_gb": 3.1, "cores": 2.4}

def clear(p):
    if os.path.isdir(p) and not os.path.islink(p):
        os.rmdir(p)
    elif os.path.lexists(p):
        os.remove(p)

def put(p, content):
    clear(p)
    if content is None:
        return
    if content == "DIR":
        os.mkdir(p)
        return
    data = content if isinstance(content, bytes) else (content if isinstance(content, str) else json.dumps(content)).encode()
    open(p, "wb").write(data)

def doc(slots, written=FRESH, **extra):
    return {"written_at": written, "by": "chorus-stage", "slots": slots, **extra}

def entry(**over):
    e = {"mem_gb": 3.1, "cores": 2.4, "since": iso(SINCE), "last": LAST}
    e.update(over)
    return {k: v for k, v in e.items() if v is not None}

PEAK_CASES = [
    ("missing", None, None),
    ("a directory", "DIR", None),
    ("over 256 KiB", doc({TREE: entry()}, pad="x" * (256 * 1024)), None),
    ("not UTF-8", b"\xff\xfe{}", None),
    ("not JSON", "not json", None),
    ("a list", [doc({TREE: entry()})], None),
    ("written_at naive", doc({TREE: entry()}, written="2026-10-02T13:59:00"), None),
    ("written_at missing", {"slots": {TREE: entry()}}, None),
    ("slots a list", doc([entry()]), None),
    ("10:01 before the call's end: stale", doc({TREE: entry()}, written=iso(REF - timedelta(minutes=10, seconds=1))), None),
    ("10:00 before the call's end: fresh", doc({TREE: entry()}, written=iso(REF - timedelta(minutes=10))), PEAK),
    ("5:01 ahead of now: stale", doc({TREE: entry()}, written=iso(NOW + timedelta(minutes=5, seconds=1))), None),
    ("5:00 ahead of now: fresh", doc({TREE: entry()}, written=iso(NOW + timedelta(minutes=5))), PEAK),
    ("no entry for the tree", doc({D + "/other": entry()}), None),
    ("mem_gb a bool", doc({TREE: entry(mem_gb=True)}), None),
    ("cores negative", doc({TREE: entry(cores=-0.5)}), None),
    ("mem_gb NaN", json.dumps(doc({TREE: entry(mem_gb=float("nan"))})), None),
    ("last missing", doc({TREE: {"mem_gb": 3.1, "cores": 2.4}}), None),
    ("last naive", doc({TREE: entry(last="2026-10-02T13:58:00")}), None),
    ("last before the Slot was taken", doc({TREE: entry(last=iso(SINCE - timedelta(seconds=1)))}), None),
    ("last at the Slot's take: carried", doc({TREE: entry(last=iso(SINCE))}), PEAK),
    ("a relative key is skipped", doc({"tree": entry()}), None),
    ("a symlinked key, int values and an extra key", doc({LINK: entry(mem_gb=3, cores=2, x=1)}), {"mem_gb": 3, "cores": 2}),
    ("~ and a trailing slash", doc({"~/../tree/": entry()}), PEAK),
    ("an exact key wins over a real-path match", doc({LINK: entry(mem_gb=9.0), TREE: entry()}), PEAK),
    ("zeros carried", doc({TREE: entry(mem_gb=0, cores=0.0)}), {"mem_gb": 0, "cores": 0.0}),
]
bad = []
for label, content, want in PEAK_CASES:
    put(PEAKS, content)
    got = m.peak(TREE, SINCE, REF, NOW)
    if got != want or (got is not None and list(got) != ["mem_gb", "cores"]):
        bad.append(["peak", label, got, want])
clear(PEAKS)
# read()'s budget: a fresh, well-typed one is its two keys; anything else is None and the file stays fresh
B = {"mem_gb": 12.0, "cores": 8}
BUDGET_CASES = [
    ("well-typed", {"mem_gb": 12.0, "cores": 8}, B),
    ("an extra key dropped", {"mem_gb": 12.0, "cores": 8, "x": 1}, B),
    ("cores 0", {"mem_gb": 12.0, "cores": 0}, None),
    ("a bool", {"mem_gb": True, "cores": 8}, None),
    ("a string", {"mem_gb": "12", "cores": 8}, None),
    ("a missing key", {"mem_gb": 12.0}, None),
    ("NaN", "NaN", None),
    ("absent", "ABSENT", None),
]
for label, budget, want in BUDGET_CASES:
    body = {"capacity": 5, "written_at": iso(NOW - timedelta(minutes=1))}
    text = json.dumps(body)
    if budget == "NaN":
        text = text[:-1] + ', "budget": {"mem_gb": NaN, "cores": 8}}'
    elif budget != "ABSENT":
        text = json.dumps({**body, "budget": budget})
    put(CAP, text)
    r = m.read(NOW)
    if r["budget"] != want or r["file"] != "fresh":
        bad.append(["budget", label, r["budget"], r["file"]])
put(CAP, json.dumps({"capacity": 5, "written_at": iso(NOW - timedelta(minutes=11)), "budget": B}))
r = m.read(NOW)
if r["budget"] is not None or r["file"] != "stale":
    bad.append(["budget", "a stale file", r["budget"], r["file"]])
print(json.dumps(bad))
PY2
)
ok "$C16" "[]" "C16: every peak() and budget case reads as expected"

# ── C17 (p53-4, ADR 0083 d4, DfL 11, 13, 14): while a fresh reading carries a budget, a start fits by its Weight ──────
# Each scenario keeps its own Run record (events) and a rollouts.toml with capacity_max 8 (the hard count behind the
# budget); its Weights are measured from planted slot-freed peaks (3 done tasks per kind under an archived rollout of
# project Demo), so no land.sh runs. Kinds (each its `scope:`): light 1.5 GB / 1 core, heavy 4 / 2, huge 16 / 2, cpu
# 2 / 5, both 4 / 5, tenth 1.2 / 1. The budget is 12 GB and 16 cores over a Capacity of 4. The peaks are slot-freed
# lines appended to old-ro's record as the Run record writes them (the reader reads the lines, never the validator).
cat > "$TMP/wpeaks.py" <<'PY2'
import json, os, sys
ev, D = sys.argv[1], sys.argv[2]
os.makedirs(ev, exist_ok=True)
os.makedirs(os.path.join(D, "Archive", "Rollouts"), exist_ok=True)
rn = os.path.join(D, "Archive", "Rollouts", "old-ro.md")
if not os.path.exists(rn):
    open(rn, "w").write('---\ntags: [task, rollout]\nstatus: done\nprotocol_version: 5\nprojects: ["[[Demo]]"]\n---\n')
for kspec in sys.argv[3:]:
    kind, mem, cores = kspec.split(":")
    for i in (1, 2, 3):
        slug = "%s-past%d" % (kind, i)
        open(os.path.join(D, "Archive", slug + ".md"), "w").write(
            '---\ntags: [task]\nstatus: done\nscope: %s\nrollout: "[[old-ro]]"\n---\n' % kind)
        with open(os.path.join(ev, "old-ro.jsonl"), "a") as f:
            f.write(json.dumps({"ts": "2026-10-01T12:00:00.000Z", "rollout": "old-ro", "task": slug, "kind": "slot-freed",
                                "outcome": "ready", "peak": {"mem_gb": float(mem), "cores": float(cores)}}) + "\n")
PY2
BUDGET='"budget": {"mem_gb": 12, "cores": 16}'
wtoml() { mkdir -p "$D/home/.config/thread"; printf 'schema = 4\n\n[defaults]\ncapacity_max = %s\n' "${1:-8}" > "$D/home/.config/thread/rollouts.toml"; }
wscen() {
  scen "$1"; export THREAD_EVENTS_DIR="$D/events"; wtoml 8
  python3 "$TMP/wpeaks.py" "$THREAD_EVENTS_DIR" "$D" light:1.5:1 heavy:4:2 huge:16:2 cpu:2:5 both:4:5 tenth:1.2:1
  cap 4 "$MIN_AGO" "$BUDGET"
}
# wro <stem> [ceiling] [frontmatter…]: a parallel rollout of project Demo; wt <slug> <rollout> <kind> [status] [fm…]: a task.
wro() { local s="$1" c="${2:-8}"; shift; [ $# -gt 0 ] && shift; mkro "$s" "$c" 'projects: ["[[Demo]]"]' "$@"; }
wt() { local s="$1" ro="$2" k="$3" st="${4:-open}"; shift 3; [ $# -gt 0 ] && shift; mkt "$s" "$ro" "$st" "scope: $k" "$@"; }
idle() { python3 -c 'import json,sys
d = [json.loads(l) for l in open(sys.argv[1]) if json.loads(l).get("kind") == "idle-slots"][-1]
print(json.dumps({k: d.get(k) for k in ("reason", "bound")}, separators=(",", ":"), sort_keys=True))' "$THREAD_EVENTS_DIR/$1.jsonl"; }
W='d["trickle"]["capacity"]["weight"]'

# C17a: eight light tasks start where three heavy ones fill the budget
wscen c17a-light
wro ro 10; for i in 1 2 3 4 5 6 7 8 9; do wt "l$i" ro light; done
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["start"]')" '["l1","l2","l3","l4","l5","l6","l7","l8"]' "C17a: eight light tasks (8 x 1.5 GB) all start in 12 GB, past C 4"
ok "$(q "$J" "$holds")" '{"l9":"trickle: 8/8 tasks running on this Mac"}' "C17a: … the ninth waits on capacity_max 8, the hard count, in the count's words"
ok "$(q "$J" '[d["trickle"]["limit"], d["trickle"]["awayCap"], d["slotLimit"]]')" '[8,8,8]' "C17a: trickle.limit and awayCap read capacity_max under the budget"
wscen c17a-heavy
wro ro; for i in 1 2 3 4; do wt "h$i" ro heavy; done
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["start"]')" '["h1","h2","h3"]' "C17a: three heavy tasks (3 x 4 GB) fill the budget"
wscen c17a2-tenth
wtoml 10; wro ro 10; for i in 1 2 3 4 5 6 7 8 9 10 11; do wt "e$i" ro tenth; done
J=$(nx ro --dry-run)
ok "$(q "$J" 'len(d["start"])')|$(q "$J" "$W"'["running"]')" '10|{"cores":10.0,"mem_gb":12.0}' "C17a2: ten tasks at 1.2 GB fill 12 GB exactly (fits compared to 2 places)"

# wrec <rollout>@<since>[@<weight-json>]…: the claims file holds exactly these waiting records (want 1, at MIN_AGO, never
# served); wclaim <rollout> <slug> [weight-json]: a live start claim (at MIN_AGO) added to it.
wrec() { mkdir -p "$THREAD_NOTE_LOCK_DIR"; python3 - "$THREAD_NOTE_LOCK_DIR/trickle-claims.json" "$D" "$@" <<'PY2'
import json, os, sys
path, tasks, *recs = sys.argv[1:]
w = []
for r in recs:
    parts = r.split("@")
    e = {"tasksDir": os.path.realpath(tasks), "rollout": parts[0], "since": parts[1], "at": "2026-10-02T14:04:00+00:00",
         "served": None, "want": 1}
    if len(parts) > 2:
        e["weight"] = json.loads(parts[2])
    w.append(e)
json.dump({"version": 1, "claims": [], "waiting": w, "woken": []}, open(path, "w"))
PY2
}
wclaim() { python3 - "$THREAD_NOTE_LOCK_DIR/trickle-claims.json" "$D" "$@" <<'PY2'
import json, os, sys
path, tasks, ro, slug, *w = sys.argv[1:]
try:
    d = json.load(open(path))
except FileNotFoundError:
    d = {"version": 1, "claims": [], "waiting": [], "woken": []}
e = {"tasksDir": os.path.realpath(tasks), "rollout": ro, "slug": slug, "at": "2026-10-02T14:04:00+00:00"}
if w:
    e["weight"] = json.loads(w[0])
d["claims"].append(e)
json.dump(d, open(path, "w"))
PY2
}
# slot <rollout> <task> <mem> <cores>: a slot-taken line carrying cap.weight, appended to the rollout's Run record as is.
slot() { mkdir -p "$THREAD_EVENTS_DIR"; printf '{"kind": "slot-taken", "rollout": "%s", "task": "%s", "cap": {"away": false, "n": 4, "file": "missing", "weight": {"mem_gb": %s, "cores": %s}}}\n' "$1" "$2" "$3" "$4" >> "$THREAD_EVENTS_DIR/$1.jsonl"; }
woke() { claims '[[w["rollout"], w["by"]] for w in d["woken"]]'; }

# C17b: one task always fits, on an empty Mac only, and only when nothing is kept for another
wscen c17b-always
wro ro; wt h1 ro huge; wt h2 ro huge
J=$(nx ro)
ok "$(q "$J" 'd["start"]')|$(q "$J" "$W"'["alwaysFits"]')|$(q "$J" 'd["halt"]')" '["h1"]|true|null' "C17b(1): a 16 GB task with nothing running starts past the 12 GB budget (one task always fits)"
ok "$(q "$J" "$holds")" '{"h2":"trickle: 1 task on this Mac holds 16/12 GB and 2/16 cores: memory short for [[h2]] (16 GB, 2 cores)"}' \
  "C17b(1): … a second heavy one waits, its hold line naming memory"
ok "$(idle ro)" '{"bound":"memory","reason":"hold-trickle"}' "C17b(1): … idle-slots keeps hold-trickle and adds bound memory"
ok "$(claims '[[c["slug"], c.get("weight")] for c in d["claims"]]')" '[["h1",{"cores":2.0,"mem_gb":16.0}]]' "C17b(1): … its claim carries its Weight"
ok "$(claims '[[w["rollout"], w["want"], w.get("weight")] for w in d["waiting"]]')" '[["ro",1,{"cores":2.0,"mem_gb":16.0}]]' "C17b(1): … and the waiting record h2's"
wscen c17b-waiter-ahead
wro ro; wt h1 ro huge; wro w; wt w1 w heavy
wrec "w@2026-10-02T14:00:00+00:00@{\"mem_gb\": 4, \"cores\": 2}"
J=$(nx ro)
ok "$(q "$J" '[d["start"], d["trickle"]["kept"], '"$W"'["alwaysFits"]]')" '[[],{"w":1},false]' "C17b(2): an empty Mac with W waiting ahead: W has the empty grant, so the caller's 16 GB task waits"
ok "$(q "$J" "$holds")" '{"h1":"trickle: 0 tasks on this Mac hold 0/12 GB and 0/16 cores: memory short for [[h1]] (16 GB, 2 cores), 1 kept for [[w]]"}' "C17b(2): … its line names what is kept for W"
ok "$(woke)" '[["w","ro"]]' "C17b(2): … and W is woken"
wscen c17b-caller-ahead
wro ro; wt h1 ro huge; wro w; wt w1 w heavy
wrec "ro@2026-10-02T13:50:00+00:00" "w@2026-10-02T14:00:00+00:00@{\"mem_gb\": 4, \"cores\": 2}"
J=$(nx ro)
ok "$(q "$J" '[d["start"], '"$W"'["alwaysFits"], '"$W"'["reserve"]]')" '[["h1"],true,"w"]' "C17b(3): the caller ahead of W takes the empty grant: its 16 GB task starts, W reserved next"
ok "$(woke)" '[]' "C17b(3): … and W, only reserved, is not woken"
wscen c17b-idle-leg
wro ro; wt h1 ro huge; mkserial chain; mkt c1 chain open; leglease chain "$MIN_AGO"
J=$(nx ro --dry-run)
ok "$(q "$J" "$holds")" '{"h1":"trickle: 1 task on this Mac holds 3/12 GB and 2/16 cores: memory short for [[h1]] (16 GB, 2 cores)"}' \
  "C17b(4): an idle Leg session makes the Mac non-empty: the 16 GB task waits (the session at the built-in)"

# C17c: the fourth heavy task waits, naming memory, cores or both; the count can bind first
wscen c17c-short
wro ro; for i in 1 2 3 4; do wt "h$i" ro heavy; done
J=$(nx ro)
H4="trickle: 3 tasks on this Mac hold 12/12 GB and 6/16 cores: memory short for [[h4]] (4 GB, 2 cores)"
ok "$(q "$J" "$holds")" "{\"h4\":\"$H4\"}" "C17c: the fourth heavy task waits on memory"
ok "$(q "$J" "$W"'["why"]')|$(q "$J" "$W"'["short"]')" "\"$H4\"|\"memory\"" "C17c: … weight.why is its hold line, short memory"
ok "$(claims '[w.get("weight") for w in d["waiting"]]')" '[{"cores":2.0,"mem_gb":4.0}]' "C17c: … the waiting record carries h4's Weight"
ok "$(idle ro)" '{"bound":"memory","reason":"hold-trickle"}' "C17c: … bound memory"
wscen c17c-cores
wro ro; for i in 1 2 3 4; do wt "c$i" ro cpu; done
J=$(nx ro)
ok "$(q "$J" "$holds")" '{"c4":"trickle: 3 tasks on this Mac hold 6/12 GB and 15/16 cores: cores short for [[c4]] (2 GB, 5 cores)"}' "C17c: cores short"
ok "$(idle ro)" '{"bound":"cores","reason":"hold-trickle"}' "C17c: … bound cores"
wscen c17c-both
wro ro; for i in 1 2 3 4; do wt "b$i" ro both; done
J=$(nx ro)
ok "$(q "$J" "$holds")" '{"b4":"trickle: 3 tasks on this Mac hold 12/12 GB and 15/16 cores: memory and cores short for [[b4]] (4 GB, 5 cores)"}' "C17c: both short"
ok "$(idle ro)" '{"bound":"memory and cores","reason":"hold-trickle"}' "C17c: … bound memory and cores"
wscen c17c-count
wtoml 3; wro ro; for i in 1 2 3 4; do wt "l$i" ro light; done
J=$(nx ro)
ok "$(q "$J" "$holds")|$(q "$J" "$W"'["why"]')" '{"l4":"trickle: 3/3 tasks running on this Mac"}|null' "C17c: capacity_max 3 binds before the weight: the count's line, no weight why"
ok "$(idle ro)" '{"bound":"count","reason":"hold-trickle"}' "C17c: … bound count"
wscen c17c-nopack
wro ro; wt h1 ro heavy; wt h2 ro heavy; wt x1 ro huge; wt l1 ro light
J=$(nx ro --dry-run)
X1="trickle: 2 tasks on this Mac hold 8/12 GB and 4/16 cores: memory short for [[x1]] (16 GB, 2 cores)"
ok "$(q "$J" 'd["start"]')|$(q "$J" "$holds")" "[\"h1\",\"h2\"]|{\"l1\":\"$X1\",\"x1\":\"$X1\"}" \
  "C17c: no packing: x1 (16 GB) stops the loop, so l1 (1.5 GB, it would fit) waits on x1's line"

# C17d: another lead's live claim holds the Weight it carries (else the built-in); a consumed claim weighs it too
wscen c17d-claims
wro ro; for i in 1 2 3; do wt "h$i" ro heavy; done; wro oth; wt o1 oth heavy
wrec; wclaim oth o1 '{"mem_gb": 10, "cores": 2}'
J=$(nx ro --dry-run)
H1D="trickle: 1 task on this Mac holds 10/12 GB and 2/16 cores: memory short for [[h1]] (4 GB, 2 cores)"
ok "$(q "$J" 'd["start"]')|$(q "$J" 'd["hold"][0]["reason"]')" "[]|\"$H1D\"" "C17d: another lead's live 10 GB claim holds the room: no heavy task fits beside it"
wrec; wclaim oth o1
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["start"]')|$(q "$J" 'd["hold"][0]["reason"]')" '["h1","h2"]|"trickle: 3 tasks on this Mac hold 11/12 GB and 6/16 cores: memory short for [[h3]] (4 GB, 2 cores)"' \
  "C17d: a claim with no weight holds the built-in 3 GB and 2 cores"
wrec; wclaim oth o1 '{"mem_gb": 10, "cores": 2}'
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("status: open", "status: in_progress\nowner: lead-oth", 1))' "$D/o1.md"
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["hold"][0]["reason"]')|$(q "$J" "$W"'["elsewhere"]')" "\"$H1D\"|{\"oth\":{\"cores\":2.0,\"mem_gb\":10.0}}" \
  "C17d: o1 stamped, its claim consumed before its slot-taken lands: it weighs the claim's 10 GB"

# C17e: the weighted share keeps room for a reachable waiter, passes over an unreachable one, and keeps a waiting
# Leg's room with held 0
wscen c17e-reserve
wro ro; mkt r1 ro in_progress 'owner: lead-ro'; mkt r2 ro in_progress 'owner: lead-ro'; wt l1 ro light
wro w; wt w1 w heavy
wrec "w@2026-10-02T14:00:00+00:00@{\"mem_gb\": 8, \"cores\": 2}"
J=$(nx ro)
ok "$(q "$J" "$holds")" '{"l1":"trickle: 2 tasks on this Mac hold 6/12 GB and 4/16 cores: memory short for [[l1]] (1.5 GB, 1 core), 1 kept for [[w]]"}' \
  "C17e(1): a reachable 8 GB W ahead: the light caller waits, room kept for W"
ok "$(q "$J" '[d["trickle"]["kept"], '"$W"'["reserve"], '"$W"'["kept"]]')" '[{"w":1},"w",{"w":{"cores":2.0,"mem_gb":6.0}}]' "C17e(1): … W reserved with one place, its room clamped to what is free"
ok "$(woke)" '[]' "C17e(1): … and not woken (its room is not free yet)"
mkserial chain; mkt c1 chain open; leglease chain "$MIN_AGO"
wrec "w@2026-10-02T14:00:00+00:00@{\"mem_gb\": 10, \"cores\": 2}"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["start"], d["trickle"]["kept"], '"$W"'["reserve"]]')" '[["l1"],{},null]' \
  "C17e(2): W at 10 GB, above the budget less a live chain's 3 GB floor: passed over, so the light caller starts"
wscen c17e-leg
wro ro; for i in 1 2 3 4; do mkt "p$i" ro in_progress 'owner: lead-ro'; slot ro "p$i" 1.5 1; done; wt p5 ro light
mkserial a; mkt a1 a open; leglease a "$MIN_AGO"
wrec "a@2026-10-02T14:00:00+00:00@{\"mem_gb\": 10, \"cores\": 2}"
J=$(nx ro)
ok "$(q "$J" "$holds")" '{"p5":"trickle: 5 tasks on this Mac hold 9/12 GB and 6/16 cores: memory short for [[p5]] (1.5 GB, 1 core), 1 kept for [[a]]"}' \
  "C17e(3): a waiting Leg A (10 GB beyond its 3 GB session) ahead: P's fifth light task waits, room kept for A"
ok "$(q "$J" '[d["trickle"]["kept"], '"$W"'["kept"]]')|$(woke)" '[{},{"a":{"cores":0.0,"mem_gb":3.0}}]|[]' \
  "C17e(3): … A takes no place (weight-only), its room clamped to the 3 GB free, and is not woken"
for i in 2 3 4; do rm -f "$D/p$i.md"; done
wrec "a@2026-10-02T14:00:00+00:00@{\"mem_gb\": 10, \"cores\": 2}"
J=$(nx ro)
ok "$(q "$J" "$holds")|$(woke)" '{"p5":"trickle: 2 tasks on this Mac hold 4.5/12 GB and 3/16 cores: memory short for [[p5]] (1.5 GB, 1 core), 1 kept for [[a]]"}|[["a","ro"]]' \
  "C17e(3): with P at 1 running, A's 7 GB fits: granted and woken, P waits behind it"
wscen c17e-held0
wro ro; wt p1 ro light; mkt p0 ro done 'owner: lead-ro' 'started: 2026-10-02T14:00+00:00'
mkserial a; mkt a1 a open; leglease a "$MIN_AGO"
wrec "a@2026-10-02T14:00:00+00:00@{\"mem_gb\": 15, \"cores\": 2}"
J=$(nx ro --dry-run)
ok "$(q "$J" "$holds")" '{"p1":"trickle: 1 task on this Mac holds 3/12 GB and 2/16 cores: memory short for [[p1]] (1.5 GB, 1 core), 1 kept for [[a]]"}' \
  "C17e(4): A at 15 GB, never served, holds 0 in the share: P (served at 14:00) waits behind it"

# C17f: what a task elsewhere weighs
wscen c17f-weights
wro ro; wt l1 ro light; wro oth; mkt o1 oth in_progress 'owner: lead-oth'
J=$(nx ro --dry-run)
ok "$(q "$J" "$W"'["elsewhere"]')" '{"oth":{"cores":2.0,"mem_gb":3.0}}' "C17f: a running task elsewhere with no slot-taken weighs the built-in"
slot oth o1 6 1
J=$(nx ro --dry-run)
ok "$(q "$J" "$W"'["elsewhere"]')" '{"oth":{"cores":1.0,"mem_gb":6.0}}' "C17f: … its latest slot-taken cap.weight once it has one"
mkserial chain; mkt c1 chain in_progress 'owner: leg-1'; leglease chain "$MIN_AGO" '"weight": {"mem_gb": 5, "cores": 2}'
J=$(nx ro --dry-run)
ok "$(q "$J" "$W"'["elsewhere"]["chain"]')|$(q "$J" "$W"'["floors"]')" '{"cores":2.0,"mem_gb":5.0}|{"chain":{"cores":2.0,"mem_gb":3.0}}' "C17f: a Leg with a claim weighs its lease's weight; its floor stays the built-in"
mkt c1 chain done 'owner: leg-1'; leglease chain "$MIN_AGO" '"weight": {"mem_gb": 15, "cores": 2}'
J=$(nx ro --dry-run)
ok "$(q "$J" "$W"'["elsewhere"]["chain"]')" '{"cores":2.0,"mem_gb":3.0}' "C17f: an idle Leg weighs the built-in, never its lease's last weight (15 GB)"

# C17g: seeded revises fit by Weight too: slotLimit is the fitting prefix, and the record weighs the first held item
wrev() {   # wrev <slug> <rollout> <kind>: a task owed a seeded revise (execute § 4.5 step 1.2)
  mkt "$1" "$2" blocked "owner: lead-$2" "scope: $3" 'started: 2026-10-02T12:00+00:00' 'pr: https://github.com/o/r/pull/7' 'max_review_rounds: 3'
  printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-02T13:40+00:00)\n\n%s\n\nRound 1 (Integration) rejection:\n- the merge dropped the retry guard\n\n<!-- run 1 end sha=0123456789ab -->\n\n## Integration log\n\n2026-10-02T13:30+00:00 rejected path=judge-only pr=7 anchor=- head=- base=- wait=- duration=- triggers=-\n' \
    'revise: rejected at Integration re-review — revise on the branch, then re-integrate' >> "$D/$1.md"
}
wscen c17g-prefix
wro ro; mkt r1 ro in_progress 'owner: lead-ro'; wrev v1 ro heavy; wrev v2 ro heavy; wrev v3 ro heavy
J=$(nx ro)
ok "$(q "$J" '[d["slotsInUse"], d["slotLimit"]]')" '[1,3]' "C17g: 3 GB running, revises of 4 GB each: two fit, so slotLimit is slotsInUse + 2"
ok "$(claims '[[c["slug"], c.get("kind"), c.get("weight")] for c in d["claims"]]')" '[["v1","revise",{"cores":2.0,"mem_gb":4.0}],["v2","revise",{"cores":2.0,"mem_gb":4.0}]]' \
  "C17g: … only the fitting prefix is claimed, kind revise, with its Weight"
wscen c17g-always
wro ro; wrev v1 ro huge; wrev v2 ro heavy; wt q1 ro huge
J=$(nx ro)
ok "$(q "$J" '[d["slotLimit"], '"$W"'["alwaysFits"], d["start"]]')" '[1,true,[]]' "C17g: on an empty Mac the first revise takes one task always fits (16 GB), and no start does"
V2="trickle: 1 task on this Mac holds 16/12 GB and 2/16 cores: memory short for [[v2]] (4 GB, 2 cores)"
ok "$(q "$J" "$W"'["why"]')|$(claims '[[w["want"], w.get("weight")] for w in d["waiting"]]')" "\"$V2\"|[[2,{\"cores\":2.0,\"mem_gb\":4.0}]]" \
  "C17g: … the first held item in launch order is v2: weight.why and the waiting record name it"
wscen c17g-revise-first
python3 "$TMP/wpeaks.py" "$THREAD_EVENTS_DIR" "$D" big:8:2
wro ro; wrev v1 ro big; wt q1 ro big
J=$(nx ro)
ok "$(q "$J" '[d["start"], d["slotsInUse"], d["slotLimit"]]')|$(q "$J" "$W"'["running"]')|$(q "$J" "$W"'["mine"]')" \
  '[[],0,1]|{"cores":2.0,"mem_gb":8.0}|{"cores":2.0,"mem_gb":8.0}' \
  "C17g: an 8 GB revise and an 8 GB start on 12 GB: the revise, first in launch order, goes alone; running and mine count it"
ok "$(q "$J" "$holds")|$(claims '[c["slug"] for c in d["claims"]]')" \
  '{"q1":"trickle: 1 task on this Mac holds 8/12 GB and 2/16 cores: memory short for [[q1]] (8 GB, 2 cores)"}|["v1"]' \
  "C17g: … q1's line holds the revise's 8 GB, and only v1 is claimed"
wscen c17g-always-light
wro ro; wrev v1 ro huge; wt l1 ro light
J=$(nx ro)
ok "$(q "$J" '[d["start"], d["slotLimit"], '"$W"'["alwaysFits"]]')|$(q "$J" "$W"'["running"]')" \
  '[[],1,true]|{"cores":2.0,"mem_gb":16.0}' \
  "C17g: a 16 GB revise takes one task always fits on an empty Mac: a light start gets no room beside it"
ok "$(q "$J" "$holds")" '{"l1":"trickle: 1 task on this Mac holds 16/12 GB and 2/16 cores: memory short for [[l1]] (1.5 GB, 1 core)"}' \
  "C17g: … l1 waits on the revise's 16 GB"

# C17h: a stale reading with a budget falls back to the Trickle 2 (Away, the Away cap)
wscen c17h-stale
wro ro; for i in 1 2 3 4; do wt "h$i" ro huge; done
cap 4 2026-10-02T13:54:00Z "$BUDGET"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["start"], d["slotLimit"], "weight" in d["trickle"]["capacity"]]')|$(lines)" '[["h1","h2"],2,false]|1' "C17h: stale: the Trickle 2 by count, one WARN, no weight block"
away_file "$D/home" "$HOUR_AGO" true 2026-10-02T22:05:00Z 2 09:00 3
J=$(nx ro --dry-run)
ok "$(q "$J" '[len(d["start"]), d["trickle"]["awayCap"]]')" '[3,3]' "C17h: … Away, the Away cap 3"

# C17i: an ill-typed budget is no budget: byte-identical output, and claims of today's keys only
wscen c17i-ill
wro ro; for i in 1 2 3 4 5; do wt "h$i" ro huge; done
cap 4 "$MIN_AGO" '"budget": {"mem_gb": 12, "cores": 0}'; A=$(nx ro --dry-run)
cap 4 "$MIN_AGO"; B=$(nx ro --dry-run)
ok "$([ "$A" = "$B" ] && echo same || echo differ)" same "C17i: next with an ill-typed budget is byte-identical to no budget"
cap 4 "$MIN_AGO" '"budget": {"mem_gb": 12, "cores": 0}'; nx ro >/dev/null
ok "$(claims 'sorted(set(k for c in d["claims"] for k in c))')|$(claims 'sorted(set(k for w in d["waiting"] for k in w))')" \
  '["at","rollout","slug","tasksDir"]|["at","rollout","served","since","tasksDir","want"]' "C17i: … its claims and waiting record carry today's keys only"
ok "$(idle ro)" '{"bound":null,"reason":"hold-trickle"}' "C17i: … and idle-slots no bound"

# C17j: status reads the budget as next does
wscen c17j-status
wro ro; mkt d1 ro done 'owner: lead-ro' 'started: 2026-10-02T10:00+00:00' 'merged: 2026-10-02T11:00+00:00'
for i in 1 2 3; do wt "q$i" ro heavy; done
wro oth; for i in 1 2 3 4; do mkt "o$i" oth in_progress 'owner: lead-oth'; done
J=$(st ro)
ok "$(q "$J" '[d["timeline"]["etaWidth"], d["timeline"]["etaBy"]]')" '[1,"memory"]' "C17j: 12 GB held elsewhere: the ETA's width floors at 1, by memory"
ok "$(q "$J" 'd["trickle"]["capacity"]["weight"]["running"]')|$(q "$J" '[d["trickle"]["limit"], d["trickle"]["awayCap"]]')" '{"cores":8.0,"mem_gb":12.0}|[8,8]' \
  "C17j: status reports the Weight held and capacity_max in limit and awayCap"
N=$(nx ro --dry-run)
ok "$(q "$N" '[d["trickle"]["limit"], d["trickle"]["awayCap"]]')" '[8,8]' "C17j: … equal to next's"
away_file "$D/home" "$HOUR_AGO" true 2026-10-02T22:05:00Z 2 09:00 3
ok "$(q "$(st ro)" '[d["trickle"]["limit"], d["trickle"]["awayCap"]]')|$(q "$(nx ro --dry-run)" '[d["trickle"]["limit"], d["trickle"]["awayCap"]]')" '[8,8]|[8,8]' "C17j: … Away too"
cap 4 "$MIN_AGO"
ok "$(q "$(st ro)" '[d["trickle"]["limit"], d["trickle"]["awayCap"], "weight" in d["trickle"]["capacity"]]')" '[4,4,false]' "C17j: with no budget both read C, and no weight block"

# C17k: _slot_weights reads each task's latest slot-taken, from the record's tail only
wscen c17k-slot
C17K=$(HOME="$D/home" python3 - "$SCRIPT" "$THREAD_EVENTS_DIR" <<'PY2'
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)
ev = sys.argv[2]; os.makedirs(ev, exist_ok=True)
def line(task, mem, kind="slot-taken"):
    return json.dumps({"kind": kind, "task": task, "cap": {"weight": {"mem_gb": mem, "cores": 1}}}) + "\n"
open(os.path.join(ev, "k1.jsonl"), "w").write(line("a", 2) + line("b", 7) + line("a", 5) + line("a", 9, "slot-freed")
                                              + "not json\n")
got = rr._slot_weights("k1")
bad = []
if got != {"b": {"mem_gb": 7.0, "cores": 1.0}, "a": {"mem_gb": 5.0, "cores": 1.0}}:
    bad.append(["latest", got])
early = line("early", 6)
pad = "".join(json.dumps({"kind": "lead-entry", "n": i}) + "\n" for i in range(8))
late = line("late", 4)
open(os.path.join(ev, "k2.jsonl"), "w").write(early + pad + late)
rr.SLOT_WEIGHTS_MAX_BYTES = 300
got = rr._slot_weights("k2")
if got != {"late": {"mem_gb": 4.0, "cores": 1.0}}:
    bad.append(["tail", got])
rr.SLOT_WEIGHTS_MAX_BYTES = len(late)       # the tail starts exactly at late's line: kept whole
if rr._slot_weights("k2") != {"late": {"mem_gb": 4.0, "cores": 1.0}}:
    bad.append(["boundary", rr._slot_weights("k2")])
rr.SLOT_WEIGHTS_MAX_BYTES = len(late) - 1   # one byte short: late's line is torn, so skipped
if rr._slot_weights("k2") != {}:
    bad.append(["torn", rr._slot_weights("k2")])
rr.SLOT_WEIGHTS_MAX_BYTES = 10 ** 6
if rr._slot_weights("k2") != {"early": {"mem_gb": 6.0, "cores": 1.0}, "late": {"mem_gb": 4.0, "cores": 1.0}}:
    bad.append(["control", rr._slot_weights("k2")])
if rr._slot_weights("missing") != {}:
    bad.append(["missing"])
print(json.dumps(bad))
PY2
)
ok "$C17K" "[]" "C17k: the last slot-taken wins; past the byte cap only the tail is read (a torn first line skipped)"
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-capacity: ALL PASS"; else echo "reconcile-rollout-capacity: FAILED"; fi
exit "$fail"
