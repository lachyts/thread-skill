#!/usr/bin/env bash
# p36-7 (ADR 0067 d8): one Mac-wide Capacity sets the starts. `next` reads ~/.config/thread/capacity.json
# (skills/execute/scripts/capacity.py; execute away.md § Capacity): while a fresh reading is in force, C =
# min(max(capacity, 1), capacity_max) takes the Trickle's (or the Away cap's) number; a missing, stale or unreadable
# reading, or a capacity_max that will not resolve, falls back to today's Trickle and Away cap exactly, never to open.
# While in force, Legs count behind their Leg lease (a dead Leg's lease lapses), and a lead whose Login is inside its
# line starts nothing new (the quota hold). Every call pins HOME to its scenario's own dir and --now, and reads stdout
# and stderr apart; the Login's env is unset unless a case sets it. Temp notes only.
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

# ── C9: a waiting Leg keeps its place in line ────────────────────────────────────────────────────────────────────
scen c9-share
six; mkserial chain; mkt c1 chain open
cap 3 "$MIN_AGO"
here=$(cd "$D" && pwd -P)
wait_rec() { printf '{"version": 1, "claims": [], "waiting": [{"tasksDir": "%s", "rollout": "chain", "since": "2026-10-02T14:00:00+00:00", "at": "2026-10-02T14:04:00+00:00", "served": null, "want": 1}], "woken": []}\n' "$here" > "$THREAD_NOTE_LOCK_DIR/trickle-claims.json"; }
mkdir -p "$THREAD_NOTE_LOCK_DIR"; wait_rec; leglease chain "$MIN_AGO"
J=$(nx ro)
ok "$(q "$J" '[d["slotLimit"], d["trickle"]["kept"], len(d["start"])]')" '[2,{"chain":1},2]' "C9: the lead keeps 1 for [[chain]] and lowers slotLimit"
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

# ── C12: only a live Leg claim adds to the count ─────────────────────────────────────────────────────────────────
scen c12-window
six; mkserial chain
mkt c1 chain done 'owner: leg-1'; mkt c2 chain in_progress 'owner: lead-x'; mkt c3 chain blocked 'owner: leg-1'
cap 5 "$MIN_AGO"; leglease chain "$MIN_AGO"
J=$(nx ro --dry-run)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["slotLimit"]]')" '[{},5]' "C12: a done, a lead-owned and a set-aside row add nothing"
mkt c4 chain in_progress 'owner: leg-1'
mkdir -p "$D/Archive"; mkserial old; mv "$D/old.md" "$D/Archive/old.md"
printf -- '---\ntags: [task]\nstatus: in_progress\nowner: leg-1\nrollout: "[[old]]"\n---\n' > "$D/o1.md"
leglease old "$MIN_AGO"
J=$(nx ro --dry-run)
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"chain":1}' "C12: one Leg claim counts once; an archived chain never counts"

if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-capacity: ALL PASS"; else echo "reconcile-rollout-capacity: FAILED"; fi
exit "$fail"
