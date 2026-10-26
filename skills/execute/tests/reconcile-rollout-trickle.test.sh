#!/usr/bin/env bash
# p28-1 (Chorus ADR 0104 d2, d6) and p29-8 (ADR 0049): `next` counts the tasks running across every open Rollout on
# the Mac and starts nothing past the Mac-wide cap: the Trickle while Lachy is not Away (T-cases), the Away cap while he
# is (A-cases); each Rollout's own parallel_ceiling still bounds its share. The Away state is
# ~/.config/thread/away.json (execute away.md): missing, stale or unreadable reads not Away at Trickle 2 (Away cap 4),
# and a stale or unreadable file prints one WARN line on stderr. The T-cases' Away files carry an Away cap of 99,
# which never binds, so they read each Rollout's own ceiling as before. Every `next` call pins HOME to its scenario's own dir, so
# the operator's file never reaches an assertion, and captures stdout and stderr apart. Temp notes only.
# Usage: bash reconcile-rollout-trickle.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
NOW=2026-10-02T14:05:00Z
HOUR_AGO=2026-10-02T13:05:00Z
TONIGHT=2026-10-02T22:05:00Z
WARN_STALE='WARN: ~/.config/thread/away.json stale: '
WARN_UNREADABLE='WARN: ~/.config/thread/away.json unreadable: '

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
starts() { case "$1" in "$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$1] does not start [$2]"; fail=1;; esac; }

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/home"; echo "== $1"; }
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
  printf -- '- [[%s]]\n' "$s" >> "$D/$ro.md"
}
# restatus <note> <status>: its `status:` line; retag <note>: its tags without `rollout`.
restatus() { python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("\nstatus: open\n", "\nstatus: %s\n" % sys.argv[2], 1))' "$D/$1.md" "$2"; }
retag() { python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("tags: [task, rollout]", "tags: [task]", 1))' "$D/$1.md"; }
# nx <rollout> [next flags...] — `next` on $D/<rollout>.md, HOME pinned to $D/home; stderr lands in $D/err.
nx() { local ro="$1"; shift; HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/$ro.md" --tasks-dir "$D" --now "$NOW" "$@" 2>"$D/err"; }
err() { cat "$D/err"; }
lines() { if [ -s "$D/err" ]; then wc -l < "$D/err" | tr -d ' '; else echo 0; fi; }
# q <json> <python-expr over d> — compact JSON of the expression ('PARSE' when stdout is not one JSON object)
q() { printf '%s' "$1" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("PARSE"); sys.exit(0)
print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
holds='{h["slug"]: h["reason"] for h in d["hold"]}'
tk='[d["trickle"][k] for k in ("away", "file", "limit", "elsewhere", "running")]'
tka='[d["trickle"][k] for k in ("away", "file", "limit", "awayCap", "elsewhere", "running")]'  # p29-8: the Away cap too
away_raw() { mkdir -p "$D/home/.config/thread"; printf '%s' "$1" > "$D/home/.config/thread/away.json"; }
BASE='{"away": true, "until": "2099-01-01T00:00:00Z", "morning": "09:00", "trickle": 2, "away_cap": 99, "written_at": "2026-10-02T13:05:00Z"}'
# mod <python statement over d>: BASE with one change, as JSON
mod() { python3 -c 'import json,sys; d = json.loads(sys.argv[1]); exec(sys.argv[2]); print(json.dumps(d))' "$BASE" "$1"; }
# two_rollouts: the task's first fixture. ro-a (ceiling 3) runs a1 and a2, a3 queued; ro-b (ceiling 4) runs b1
# (owner: marks it started, so it counts for ro-a), b2 and b3 queued. Three tasks run on the Mac.
two_rollouts() {
  mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'; mkt a3 ro-a open
  mkro ro-b 4; mkt b1 ro-b in_progress 'owner: lead-b'; mkt b2 ro-b open; mkt b3 ro-b open
}
sums() { cksum "$D"/*.md | awk '{print $1 $2}' | tr '\n' ' '; }

# ── T1: two Rollouts with 3 running tasks and no file start nothing ────────────────────────────────────────────
scen t1-no-file
two_rollouts
J=$(nx ro-b); rc=$?
ok "$rc" 0 "T1: next exits 0"
ok "$(q "$J" 'd["start"]')" '[]' "T1: ro-b starts nothing past the Trickle"
ok "$(q "$J" "$holds")" '{"b2":"trickle: 3/2 tasks running on this Mac","b3":"trickle: 3/2 tasks running on this Mac"}' \
  "T1: b2 and b3 are held on the Trickle"
ok "$(q "$J" '[d["halt"], d["slotsInUse"], d["slotLimit"], d["ceiling"]]')" '[null,1,0,4]' \
  "T1: halt null, slotsInUse 1, slotLimit 0, ceiling still 4"
ok "$(q "$J" "$tk")" '[false,"missing",2,{"ro-a":2},3]' "T1: trickle: not Away, file missing, limit 2, elsewhere ro-a 2, running 3"
ok "$(q "$J" '[d["trickle"]["until"], d["trickle"]["morning"], d["trickle"]["why"] is not None]')" '[null,null,true]' \
  "T1: until and morning null without a fresh file; why says the file is missing"
ok "$(lines)" 0 "T1: a missing file prints no WARN"
J=$(nx ro-a)
ok "$(q "$J" 'd["start"]')" '[]' "T1: ro-a starts nothing either"
ok "$(q "$J" "$holds")" '{"a3":"trickle: 3/2 tasks running on this Mac"}' "T1: a3 is held on the Trickle"
ok "$(q "$J" 'd["trickle"]["elsewhere"]')" '{"ro-b":1}' "T1: ro-a counts ro-b's one running task"
before=$(sums)
nx ro-b --dry-run >/dev/null; nx ro-a --dry-run >/dev/null
ok "$(sums)" "$before" "T1: --dry-run leaves every note byte-identical"

# ── T2: Away with a fresh file whose Away cap (99) never binds, each Rollout to its own ceiling ────────────────
scen t2-away
two_rollouts
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["hold"]]')" '[["b2","b3"],4,[]]' "T2: Away, ro-b starts b2 and b3 (slotLimit 4)"
ok "$(q "$J" "$tk")" '[true,"fresh",2,{"ro-a":2},5]' "T2: trickle reads the fresh file, still counting elsewhere"
ok "$(q "$J" '[d["trickle"]["until"], d["trickle"]["morning"], d["trickle"]["why"]]')" "[\"$TONIGHT\",\"09:00\",null]" \
  "T2: until and morning come from the fresh file, why null"
ok "$(lines)" 0 "T2: a fresh file prints no WARN"
J=$(nx ro-a)
ok "$(q "$J" '[d["start"], d["slotLimit"]]')" '[["a3"],3]' "T2: Away, ro-a starts a3 (slotLimit 3)"

# ── T3: a stale file reads not Away ─────────────────────────────────────────────────────────────────────────────
scen t3-stale
two_rollouts
stale() {  # stale <label> <cause word> <away_file args...>
  local label="$1" cause="$2"; shift 2
  away_file "$D/home" "$@"
  J=$(nx ro-b)
  ok "$(q "$J" '[d["start"], d["trickle"]["file"], d["trickle"]["away"], d["trickle"]["limit"], d["slotLimit"]]')" \
    '[[],"stale",false,2,0]' "T3 $label: stale, not Away, Trickle 2, nothing starts"
  has "$(q "$J" 'd["trickle"]["why"]')" "$cause" "T3 $label: why names $cause"
  ok "$(q "$J" '[d["trickle"]["until"], d["trickle"]["morning"]]')" '[null,null]' "T3 $label: until and morning null"
  ok "$(lines)" 1 "T3 $label: exactly one stderr line"
  starts "$(err)" "$WARN_STALE" "T3 $label: the WARN line names the file and stale"
  has "$(err)" "read as not Away, Trickle 2" "T3 $label: the WARN line says how it reads"
}
stale "(a) until passed" until "$HOUR_AGO" true 2026-10-02T14:04:00Z
stale "(b) written_at 25 h old" written_at 2026-10-01T13:05:00Z true
stale "(c) written_at 10 min ahead" written_at 2026-10-02T14:15:00Z true
stale "(e) not Away, until passed, its own trickle ignored" until "$HOUR_AGO" false 2026-10-02T14:04:00Z 4
away_file "$D/home" 2026-10-02T14:05:00Z true 2026-10-02T14:05:00Z
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["trickle"]["file"]]')" '[[],"stale"]' "T3: an until equal to now has passed"
away_file "$D/home" 2026-10-01T14:05:00Z true
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["trickle"]["file"], d["trickle"]["away"]]')" '[["b2","b3"],"fresh",true]' \
  "T3 (d): a written_at exactly 24 h old is still fresh, and Away"
ok "$(lines)" 0 "T3 (d): no WARN"
away_file "$D/home" 2026-10-02T14:10:00Z true
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["trickle"]["file"]]')" '[["b2","b3"],"fresh"]' "T3: a written_at exactly 5 minutes ahead is still fresh"
away_file "$D/home" 2026-10-01T13:05:00Z true
J=$(nx ro-b --dry-run)
ok "$(lines)" 1 "T3: --dry-run prints the WARN too"

# ── T4: unreadable files read not Away, with a WARN ─────────────────────────────────────────────────────────────
scen t4-unreadable
two_rollouts
unreadable() {  # unreadable <label>: the file is already written
  J=$(nx ro-b)
  ok "$(q "$J" '[d["start"], d["trickle"]["file"], d["trickle"]["away"], d["trickle"]["limit"]]')" '[[],"unreadable",false,2]' \
    "T4 $1: unreadable, not Away, Trickle 2, nothing starts"
  ok "$(q "$J" 'bool(d["trickle"]["why"])')" 'true' "T4 $1: why is set"
  ok "$(lines)" 1 "T4 $1: exactly one stderr line"
  starts "$(err)" "$WARN_UNREADABLE" "T4 $1: the WARN line names the file and unreadable"
}
away_raw '{"away": true,'; unreadable "invalid JSON"
away_raw '[]'; unreadable "a JSON array"
away_raw ''; unreadable "an empty file"
printf '\377\376{"away": true}' > "$D/home/.config/thread/away.json"; unreadable "not UTF-8"
for k in away until morning trickle written_at; do away_raw "$(mod "del d['$k']")"; unreadable "no $k"; done
away_raw "$(mod 'd["away"] = "true"')"; unreadable 'away "true"'
away_raw "$(mod 'd["trickle"] = 0')"; unreadable "trickle 0"
away_raw "$(mod 'd["trickle"] = True')"; unreadable "trickle true"
away_raw "$(mod 'd["trickle"] = 2.5')"; unreadable "trickle 2.5"
away_raw "$(mod 'd["trickle"] = "2"')"; unreadable 'trickle "2"'
away_raw "$(mod 'd["until"] = "2099-01-01T00:00:00"')"; unreadable "a naive until"
away_raw "$(mod 'd["written_at"] = "yesterday"')"; unreadable "a garbage written_at"
away_raw "$(mod 'd["morning"] = "9:00"')"; unreadable "morning 9:00"
away_raw "$(mod 'd["morning"] = "24:00"')"; unreadable "morning 24:00"
away_raw "$(mod 'd["pad"] = "x" * 70000')"; unreadable "over 64 KiB"
rm -f "$D/home/.config/thread/away.json"; mkdir -p "$D/home/.config/thread/away.json"; unreadable "a directory at the path"
rm -rf "$D/home/.config/thread/away.json"
away_raw "$(mod 'd["note"] = "a later field"')"
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["trickle"]["file"]]')" '[["b2","b3"],"fresh"]' "T4: extra keys are ignored"
# Missing, every way: no file, ~/.config/thread a plain file, a dangling symlink. None warns.
rm -f "$D/home/.config/thread/away.json"
ln -s "$D/home/nowhere.json" "$D/home/.config/thread/away.json"
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["trickle"]["file"]]')" '[[],"missing"]' "T4: a dangling symlink reads missing"
ok "$(lines)" 0 "T4: a dangling symlink prints no WARN"
rm -rf "$D/home/.config"; mkdir -p "$D/home"; : > "$D/home/.config"
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["trickle"]["file"]]')" '[[],"missing"]' "T4: ~/.config a plain file reads missing"
ok "$(lines)" 0 "T4: … with no WARN"

# ── T5: fresh, not Away, trickle 4 ──────────────────────────────────────────────────────────────────────────────
scen t5-trickle-4
two_rollouts
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 4
J=$(nx ro-b)
ok "$(q "$J" '[d["start"], d["slotLimit"]]')" '[["b2"],2]' "T5: Trickle 4 less ro-a's 2 leaves slotLimit 2: b2 starts"
ok "$(q "$J" "$holds")" '{"b3":"trickle: 4/4 tasks running on this Mac"}' "T5: b3 is held on the Trickle"
ok "$(q "$J" "$tk")" '[false,"fresh",4,{"ro-a":2},4]' "T5: the fresh file's trickle is the limit"

# ── T6: with one task running elsewhere, exactly one starts ────────────────────────────────────────────────────
scen t6-one-elsewhere
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'
mkro ro-e 3; mkt e1 ro-e open; mkt e2 ro-e open; mkt e3 ro-e open
J=$(nx ro-e)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["trickle"]["elsewhere"]]')" '[["e1"],1,{"ro-a":1}]' "T6: exactly one task starts"

# ── T7: the ceiling binds first ────────────────────────────────────────────────────────────────────────────────
scen t7-ceiling-first
mkro ro-c 1; mkt c1 ro-c in_progress 'owner: lead-c'; mkt c2 ro-c open
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 5
J=$(nx ro-c)
ok "$(q "$J" "$holds")" '{"c2":"ceiling: 1/1 slots in use"}' "T7: ceiling 1 under Trickle 5 reads the ceiling hold"

# ── T8: what never counts ──────────────────────────────────────────────────────────────────────────────────────
scen t8-exclusions
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open
mkro ro-done 3; restatus ro-done done; mkt d1 ro-done in_progress 'owner: l'
mkro ro-dropped 3; restatus ro-dropped dropped; mkt d2 ro-dropped in_progress 'owner: l'
mkro ro-paused 3 'paused: 2026-10-02T10:00+00:00'; mkt d3 ro-paused in_progress 'owner: l'
mkro ro-serial 3 'shape: serial'; mkt d4 ro-serial in_progress 'owner: l'
mkro ro-fresh 3; mkt d5 ro-fresh in_progress; mkt d6 ro-fresh in_progress
mkro ro-arch 3; mkt d7 ro-arch in_progress 'owner: l'
mkdir -p "$D/Archive/Rollouts"; mv "$D/ro-arch.md" "$D/Archive/Rollouts/ro-arch.md"
mkro ro-untagged 3; retag ro-untagged
mkt d8 ro-untagged in_progress 'owner: l'
mkro ro-int 3; mkt d9 ro-int review 'pr: https://github.com/o/r/pull/9' 'integrating: 2026-10-02T13:00+00:00' 'owner: l'
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{},["x1","x2"]]' \
  "T8: done, dropped, paused, serial, never-started, archived and untagged rollouts and an integrating note never count"

# ── T9: a rollout draining a soft pause still counts ───────────────────────────────────────────────────────────
scen t9-pause-requested
mkro ro-p 3 'pause_requested: true'; mkt p1 ro-p in_progress
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-p":1},["x1"]]' "T9: a pause_requested rollout's running task counts"

# ── T10: an undecided RACE holds no Slot; once decided, it counts again ───────────────────────────────────────
scen t10-race
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'
printf '\n## Race log\n\n- 2026-10-02T10:00+00:00 [[a2]] RACE: origin/main fails the verifier\n' >> "$D/ro-a.md"
mkro ro-b 4; mkt b1 ro-b open; mkt b2 ro-b open; mkt b3 ro-b open
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":1},["b1"]]' "T10: a RACE-held task holds no Slot: one starts"
python3 - "$D/ro-a.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write(t.replace("## Notes\n\n", "## Notes\n\nrepair: [[a2]] RACE decided: land it\n\n", 1))
PY
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "T10: once decided it counts again"

# ── T11: a restart waits on the ceiling alone; this rollout's stalled rows count toward its starts ─────────────
# A restart takes back a task every other lead already counts (its note stays in_progress), so only the ceiling bounds
# it (execute away.md § The Trickle); a new start counts every in_progress row of this rollout, live or stalled.
scen t11-restart
mkro ro-r 4; mkt r1 ro-r in_progress 'owner: gone'; mkt r2 ro-r in_progress 'owner: gone'; mkt r3 ro-r in_progress 'owner: gone'
mkt r4 ro-r open
J=$(nx ro-r --running "")
ok "$(q "$J" '[d["restart"], d["start"], d["halt"], d["slotsInUse"], d["slotLimit"]]')" '[["r1","r2","r3"],[],null,3,2]' \
  "T11: all three stalled tasks restart past a Trickle of 2, within the ceiling of 4"
ok "$(q "$J" "$holds")" '{"r4":"trickle: 3/2 tasks running on this Mac"}' "T11: the queued r4 is held on the Trickle"
scen t11b-restart-ceiling
mkro ro-r 2; mkt r1 ro-r in_progress 'owner: gone'; mkt r2 ro-r in_progress 'owner: gone'; mkt r3 ro-r in_progress 'owner: gone'
J=$(nx ro-r --running "")
ok "$(q "$J" '[d["restart"], d["start"], d["halt"]]')" '[["r1","r2"],[],null]' "T11b: the ceiling of 2 still bounds the restarts"
ok "$(q "$J" "$holds")" '{"r3":"ceiling: 2/2 slots in use"}' "T11b: the third stalled task is held on the ceiling, never the Trickle"
ok "$(q "$J" 'd["trickle"]["running"]')" '3' "T11b: trickle.running counts the held stalled note too, as every other lead does"
scen t11c-stalled-counts
mkro ro-r 4; mkt r1 ro-r in_progress 'owner: gone'; mkt r2 ro-r open; mkt r3 ro-r open
J=$(nx ro-r --running "")
ok "$(q "$J" '[d["restart"], d["start"], d["slotsInUse"], d["slotLimit"], d["trickle"]["running"]]')" '[["r1"],["r2"],1,2,2]' \
  "T11c: the stalled r1 restarts and counts: one start fills the Trickle of 2"
ok "$(q "$J" "$holds")" '{"r3":"trickle: 2/2 tasks running on this Mac"}' "T11c: r3 is held on the Trickle"

# ── T12: a head Solo while the Trickle is full ─────────────────────────────────────────────────────────────────
scen t12-solo
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'
mkro ro-s 4; mkt s1 ro-s open 'solo: true'; mkt s2 ro-s open
J=$(nx ro-s --running "")
ok "$(q "$J" '[d["start"], d["halt"]]')" '[[],null]' "T12: the head Solo does not start past the Trickle, and no halt"
ok "$(q "$J" "$holds")" '{"s1":"trickle: 2/2 tasks running on this Mac","s2":"behind solo [[s1]]"}' \
  "T12: the Solo is held on the Trickle, the row below it behind it"
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT"
J=$(nx ro-s --running "")
ok "$(q "$J" '[d["start"], d["hold"]]')" '[["s1"],[{"reason":"behind solo [[s1]]","slug":"s2"}]]' "T12: Away, the Solo starts alone"

# ── T13: over the Trickle, nothing starts and nothing is stopped ──────────────────────────────────────────────
scen t13-over
mkro ro-o 4; mkt o1 ro-o in_progress 'owner: l'; mkt o2 ro-o in_progress 'owner: l'; mkt o3 ro-o in_progress 'owner: l'
mkt o4 ro-o open
J=$(nx ro-o)
ok "$(q "$J" '[d["start"], d["restart"], d["running"], d["slotsInUse"], d["slotLimit"], d["halt"]]')" \
  '[[],[],["o1","o2","o3"],3,2,null]' "T13: three live over a Trickle of 2: nothing starts, all three keep running"
ok "$(q "$J" "$holds")" '{"o4":"trickle: 3/2 tasks running on this Mac"}' "T13: o4 is held on the Trickle"

# ── T14: the Run record's idle-slots reason ────────────────────────────────────────────────────────────────────
scen t14-record
two_rollouts
EV14="$D/events"   # this case reads the record, so it keeps its own dir
ev() { python3 -c 'import json,sys
try:
    rows = [json.loads(l) for l in open(sys.argv[1])]
except FileNotFoundError:
    rows = []
print(json.dumps([[r["reason"], r["free"]] for r in rows if r["kind"] == "idle-slots"], separators=(",", ":")))' "$EV14/ro-b.jsonl"; }
THREAD_EVENTS_DIR="$EV14" nx ro-b --dry-run >/dev/null
ok "$(ev)" '[]' "T14: --dry-run records nothing"
THREAD_EVENTS_DIR="$EV14" nx ro-b >/dev/null
ok "$(ev)" '[["hold-trickle",3]]' "T14: off --dry-run, idle-slots records hold-trickle (free is the ceiling's)"

# ── T15, T16: a git-env trip and a pause beat the Trickle ─────────────────────────────────────────────────────
scen t15-git-env
two_rollouts
printf '\n## Git-env log\n\n- 2026-10-02T10:00+00:00 git-env trip [[b1]] task: refs/heads/main a->b; repo /x\n' >> "$D/ro-b.md"
J=$(nx ro-b --running "")
ok "$(q "$J" '[d["halt"], d["start"], d["restart"]]')" '["git-env",[],[]]' "T15: a git-env trip halts git-env"
ok "$(q "$J" "$holds")" '{"b1":"git-env hold: /thread:repair","b2":"git-env hold: /thread:repair","b3":"git-env hold: /thread:repair"}' \
  "T15: every row is held on the git-env hold, none on the Trickle"
scen t16-pause
two_rollouts
python3 - "$D/ro-b.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write(t.replace("parallel_ceiling: 4\n", "parallel_ceiling: 4\npause_requested: true\n", 1))
PY
J=$(nx ro-b)
ok "$(q "$J" "$holds")" '{"b2":"pause requested: draining","b3":"pause requested: draining"}' "T16: a soft pause holds its rows, never the Trickle"

# ── T17: nothing of this rollout in flight, every row held on the Trickle: no halt ────────────────────────────
scen t17-no-halt
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'
mkro ro-c 3; mkt c1 ro-c open; mkt c2 ro-c open; mkt c3 ro-c open
J=$(nx ro-c --running "" --dry-run)
ok "$(q "$J" '[d["start"], d["restart"], d["halt"]]')" '[[],[],null]' "T17: nothing starts, and the rollout is neither stuck nor halted"
ok "$(q "$J" "$holds")" '{"c1":"trickle: 2/2 tasks running on this Mac","c2":"trickle: 2/2 tasks running on this Mac","c3":"trickle: 2/2 tasks running on this Mac"}' \
  "T17: every row is held on the Trickle"
ok "$(q "$J" '[d["slotsInUse"], d["slotLimit"], d["trickle"]["elsewhere"]]')" '[0,0,{"ro-a":2}]' "T17: slotsInUse 0, slotLimit 0, elsewhere ro-a 2"
EV14="$D/events"
THREAD_EVENTS_DIR="$EV14" nx ro-c --running "" >/dev/null
ok "$(python3 -c 'import json,sys; print(json.dumps([[r["reason"], r["free"]] for r in map(json.loads, open(sys.argv[1])) if r["kind"] == "idle-slots"], separators=(",", ":")))' "$EV14/ro-c.jsonl")" \
  '[["hold-trickle",3]]' "T17: off --dry-run, idle-slots records hold-trickle with free 3"

# ── T17b: the Trickle never masks a real halt ──────────────────────────────────────────────────────────────────
scen t17b-real-halt
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'
mkro ro-d 3; mkt d1 ro-d gate-pending; mkt d2 ro-d open 'depends-on: ["[[d1]]"]'
J=$(nx ro-d --running "" --dry-run)
ok "$(q "$J" "$holds")" '{"d2":"depends on [[d1]] (gate-pending)"}' "T17b: only the dependency holds d2"
ok "$(q "$J" '[d["halt"], [w["slug"] for w in d["awaitingSignOff"]]]')" '["awaiting-sign-off",["d1","d2"]]' \
  "T17b: the gate still halts awaiting-sign-off with the Trickle full"

# ── T19: two respawned leads both restart their stalled tasks (round-1 review, a deadlock regression) ─────────────
# A Login switch or a usage-limit respawn ends every background call, so each lead's Cold resume runs `next --running ""`
# over its own stalled notes, which every other lead counts. Neither may wait on the other's: both restart, and only
# the queued rows wait on the Trickle.
scen t19-respawn
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'; mkt a3 ro-a open
mkro ro-b 3; mkt b1 ro-b in_progress 'owner: lead-b'; mkt b2 ro-b in_progress 'owner: lead-b'; mkt b3 ro-b open
for ro in a b; do
  J=$(nx ro-$ro --running "")
  ok "$(q "$J" '[d["restart"], d["start"], d["halt"], d["slotsInUse"], d["slotLimit"]]')" "[[\"${ro}1\",\"${ro}2\"],[],null,2,0]" \
    "T19: ro-$ro restarts both its stalled tasks, with slotLimit 0"
  ok "$(q "$J" "$holds")" "{\"${ro}3\":\"trickle: 4/2 tasks running on this Mac\"}" "T19: ro-$ro holds only its queued row on the Trickle"
done
# Once both run again, a landing frees no room past the Trickle: ro-a still counts ro-b's two.
J=$(nx ro-a --running "a1,a2")
ok "$(q "$J" '[d["restart"], d["start"], d["running"], d["halt"]]')" '[[],[],["a1","a2"],null]' "T19: with both live, ro-a starts nothing more"

# ── T20: a blocked row with the Trickle full reads stuck; the lead's halt guard waits on it ───────────────────────
# `next` cannot tell a seeded revise (lead-integrate.py inputs' autoRevise) from any other block, so ro-c's only row,
# c1 blocked at its run, reads `stuck` with slotLimit 0 and no hold. These are the values execute § 4.5 step 1.5's
# Trickle clause reads to end the turn `waiting` (reason="trickle: 2/2 tasks running on this Mac") instead of halting.
scen t20-blocked-revise
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'
mkro ro-c 3; mkt c1 ro-c blocked 'owner: lead-c'
J=$(nx ro-c --running "" --dry-run)
ok "$(q "$J" '[d["halt"], d["slotsInUse"], d["slotLimit"], d["ceiling"], d["hold"], [e["slug"] for e in d["setAside"]]]')" \
  '["stuck",0,0,3,[],["c1"]]' "T20: stuck, slotsInUse 0, slotLimit 0 below the ceiling 3, no hold, c1 set aside"
ok "$(q "$J" '[d["trickle"]["running"], d["trickle"]["limit"]]')" '[2,2]' "T20: trickle.running and trickle.limit give the wait's reason"

# ── T18: a refused call reads no file and prints no WARN ───────────────────────────────────────────────────────
scen t18-refused
mkro ro-z 0; mkt z1 ro-z open
away_file "$D/home" 2026-10-01T00:00:00Z
J=$(nx ro-z); rc=$?
ok "$rc" 1 "T18: parallel_ceiling 0 is refused"
ok "$(grep -c '^WARN: ~/.config/thread/away.json' "$D/err")" 0 "T18: the refusal prints no WARN"

# ════ The Away cap (p29-8, ADR 0049): while Lachy is Away, the Mac-wide cap is `away_cap`, never each ceiling ═══════
# by_two <stem> <n> [<stem> <n>...]: started rollouts (ceiling 3) each running n tasks, so they count elsewhere.
by_two() {
  while [ $# -gt 0 ]; do
    mkro "$1" 3; local i=1
    while [ "$i" -le "$2" ]; do mkt "$1-t$i" "$1" in_progress "owner: lead-$1"; i=$((i + 1)); done
    shift 2
  done
}
# fmline <note> <line>: one more frontmatter line on a note, after its status line.
fmline() { python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); i = t.index("\nstatus: "); j = t.index("\n", i + 1); open(p, "w").write(t[:j + 1] + sys.argv[2] + "\n" + t[j + 1:])' "$D/$1.md" "$2"; }
AC4='away cap: 4/4 tasks running on this Mac'

# ── A1: Away, the Away cap at N and N tasks running across other rollouts: nothing starts ───────────────────────
scen a1-cap-full
by_two ro-a 2 ro-c 2
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-x)
ok "$(q "$J" '[d["start"], d["restart"], d["slotsInUse"], d["slotLimit"], d["ceiling"], d["halt"]]')" '[[],[],0,0,4,null]' \
  "A1: Away cap 4 with 4 running elsewhere: nothing starts, slotLimit 0 under the ceiling 4, no halt"
ok "$(q "$J" "$holds")" "{\"x1\":\"$AC4\",\"x2\":\"$AC4\",\"x3\":\"$AC4\"}" "A1: every row is held on the Away cap"
ok "$(q "$J" "$tka")" '[true,"fresh",2,4,{"ro-a":2,"ro-c":2},4]' "A1: trickle reports Away, the Trickle's N 2 and the Away cap 4"
ok "$(q "$J" 'list(d["trickle"])')" '["away","file","why","limit","awayCap","until","morning","elsewhere","running"]' \
  "A1: awayCap follows limit, every other trickle key unchanged"
ok "$(lines)" 0 "A1: a fresh file prints no WARN"

# ── A2: partial room: starts fill up to the Away cap less the count elsewhere ────────────────────────────────────
scen a2-cap-room
by_two ro-a 3
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 5
J=$(nx ro-x)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["trickle"]["running"]]')" '[["x1","x2"],2,5]' "A2: Away cap 5 less 3 elsewhere: two start"
ok "$(q "$J" "$holds")" '{"x3":"away cap: 5/5 tasks running on this Mac"}' "A2: the third is held on the Away cap"

# ── A3: each rollout's parallel_ceiling still bounds its share under the Away cap ────────────────────────────────
scen a3-ceiling-share
mkro ro-x 2; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open; mkt x4 ro-x open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 8
J=$(nx ro-x)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["trickle"]["awayCap"]]')" '[["x1","x2"],2,8]' "A3: Away cap 8, ceiling 2: two start"
ok "$(q "$J" "$holds")" '{"x3":"ceiling: 2/2 slots in use","x4":"ceiling: 2/2 slots in use"}' "A3: the rest wait on the ceiling, never the Away cap"

# ── A4: the key absent: the built-in default, lifted above a high Trickle ────────────────────────────────────────
scen a4-default
by_two ro-a 2 ro-c 1
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open; mkt x4 ro-x open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 -
ok "$(grep -c away_cap "$D/home/.config/thread/away.json")" 0 "A4: the fixture's file has no away_cap"
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["file"], d["trickle"]["awayCap"], d["slotLimit"], d["start"]]')" '["fresh",4,1,["x1"]]' \
  "A4: no key: the Away cap is the built-in 4, so one starts beside 3 elsewhere"
ok "$(q "$J" "$holds")" "{\"x2\":\"$AC4\",\"x3\":\"$AC4\",\"x4\":\"$AC4\"}" "A4: the rest are held on the default Away cap"
ok "$(lines)" 0 "A4: an absent key prints no WARN"
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 3 09:00 -
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["limit"], d["trickle"]["awayCap"]]')" '[3,4]' "A4: Trickle 3 with no key: the Away cap stays 4"
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 5 09:00 -
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["limit"], d["trickle"]["awayCap"], d["slotLimit"], d["start"]]')" '[5,6,3,["x1","x2","x3"]]' \
  "A4: Trickle 5 with no key: the default lifts to 6, above the Trickle"
ok "$(q "$J" "$holds")" '{"x4":"away cap: 6/6 tasks running on this Mac"}' "A4: … and binds at 6"

# ── A5: not Away, the Trickle binds as today, the Away cap reported but unused ───────────────────────────────────
scen a5-not-away
by_two ro-a 1
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 2 09:00 6
J=$(nx ro-x)
ok "$(q "$J" '[d["start"], d["slotLimit"]]')" '[["x1"],1]' "A5: not Away, Trickle 2 less 1 elsewhere: one starts"
ok "$(q "$J" "$holds")" '{"x2":"trickle: 2/2 tasks running on this Mac","x3":"trickle: 2/2 tasks running on this Mac"}' \
  "A5: the rest are held on the Trickle, never the Away cap"
ok "$(q "$J" "$tka")" '[false,"fresh",2,6,{"ro-a":1},2]' "A5: the Away cap 6 is reported, unused"

# ── A6: a stale file behaves as today, its own away_cap ignored ─────────────────────────────────────────────────
scen a6-stale
by_two ro-a 1
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open
away_file "$D/home" "$HOUR_AGO" true 2026-10-02T14:04:00Z 2 09:00 6
J=$(nx ro-x)
ok "$(q "$J" "$tka")" '[false,"stale",2,4,{"ro-a":1},2]' "A6: stale: not Away, Trickle 2, the built-in Away cap 4"
ok "$(q "$J" '[d["start"], d["slotLimit"]]')" '[["x1"],1]' "A6: the Trickle binds"
ok "$(q "$J" "$holds")" '{"x2":"trickle: 2/2 tasks running on this Mac","x3":"trickle: 2/2 tasks running on this Mac"}' "A6: trickle: holds"
ok "$(lines)" 1 "A6: exactly one stderr line"
starts "$(err)" "$WARN_STALE" "A6: the WARN line names the file and stale"
has "$(err)" "— read as not Away, Trickle 2" "A6: … and ends with how it reads"

# ── A7: a bad away_cap makes the file unreadable, the five keys checked first ───────────────────────────────────
scen a7-bad-cap
two_rollouts
badcap() {  # badcap <label> <python statement over d, BASE's copy>
  away_raw "$(mod "$2")"
  J=$(nx ro-b)
  ok "$(q "$J" '[d["start"], d["trickle"]["file"], d["trickle"]["away"], d["trickle"]["limit"], d["trickle"]["awayCap"]]')" \
    '[[],"unreadable",false,2,4]' "A7 $1: unreadable, not Away, Trickle 2, Away cap 4, nothing starts"
  starts "$(q "$J" 'd["trickle"]["why"]')" '"`away_cap` ' "A7 $1: why names away_cap"
  ok "$(lines)" 1 "A7 $1: exactly one stderr line"
  starts "$(err)" "${WARN_UNREADABLE}\`away_cap\` " "A7 $1: the WARN line names the file, unreadable and away_cap"
}
badcap "away_cap 0" 'd["away_cap"] = 0'
badcap "away_cap true" 'd["away_cap"] = True'
badcap "away_cap 2.5" 'd["away_cap"] = 2.5'
badcap 'away_cap "4"' 'd["away_cap"] = "4"'
badcap "away_cap null" 'd["away_cap"] = None'
badcap "away_cap equal to trickle" 'd["away_cap"] = d["trickle"]'
has "$(q "$J" 'd["trickle"]["why"]')" 'is not above `trickle`' "A7: an away_cap equal to the Trickle is not above it"
badcap "away_cap below trickle" 'd["trickle"] = 3; d["away_cap"] = 2'
away_raw "$(mod 'del d["written_at"]; d["away_cap"] = 0')"
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["file"], d["trickle"]["why"]]')" '["unreadable","no `written_at`"]' \
  "A7: a missing written_at beside a bad away_cap names written_at first (key-table order)"

# ── A8: a restart waits on the ceiling alone under the Away cap ─────────────────────────────────────────────────
scen a8-restart
by_two ro-a 2
mkro ro-r 4; mkt r1 ro-r in_progress 'owner: gone'; mkt r2 ro-r in_progress 'owner: gone'; mkt r3 ro-r in_progress 'owner: gone'
mkt r4 ro-r open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 3
J=$(nx ro-r --running "")
ok "$(q "$J" '[d["restart"], d["start"], d["halt"], d["slotsInUse"], d["slotLimit"]]')" '[["r1","r2","r3"],[],null,3,1]' \
  "A8: all three stalled tasks restart past an Away cap of 3, within the ceiling of 4"
ok "$(q "$J" "$holds")" '{"r4":"away cap: 5/3 tasks running on this Mac"}' "A8: the queued r4 is held on the Away cap"

# ── A9: a head Solo under a full Away cap ───────────────────────────────────────────────────────────────────────
scen a9-solo
by_two ro-a 2 ro-c 2
mkro ro-s 4; mkt s1 ro-s open 'solo: true'; mkt s2 ro-s open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-s --running "")
ok "$(q "$J" '[d["start"], d["halt"]]')" '[[],null]' "A9: the head Solo does not start past the Away cap, and no halt"
ok "$(q "$J" "$holds")" "{\"s1\":\"$AC4\",\"s2\":\"behind solo [[s1]]\"}" "A9: the Solo is held on the Away cap, the row below it behind it"

# ── A10: a rollout the Away cap alone holds is a meant wait: no halt, idle-slots hold-away-cap ─────────────────
scen a10-meant-wait
by_two ro-a 2 ro-b 2
mkro ro-c 3; mkt c1 ro-c open; mkt c2 ro-c open; mkt c3 ro-c open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-c --running "" --dry-run)
ok "$(q "$J" '[d["start"], d["restart"], d["halt"], d["slotsInUse"], d["slotLimit"]]')" '[[],[],null,0,0]' \
  "A10: nothing of ro-c in flight, nothing starts, and the rollout is neither stuck nor halted"
ok "$(q "$J" "$holds")" "{\"c1\":\"$AC4\",\"c2\":\"$AC4\",\"c3\":\"$AC4\"}" "A10: every row is held on the Away cap"
EVA="$D/events"
THREAD_EVENTS_DIR="$EVA" nx ro-c --running "" --dry-run >/dev/null
ok "$(ls "$EVA" 2>/dev/null | wc -l | tr -d ' ')" 0 "A10: --dry-run records nothing"
THREAD_EVENTS_DIR="$EVA" nx ro-c --running "" >/dev/null
ok "$(python3 -c 'import json,sys; print(json.dumps([[r["reason"], r["free"]] for r in map(json.loads, open(sys.argv[1])) if r["kind"] == "idle-slots"], separators=(",", ":")))' "$EVA/ro-c.jsonl")" \
  '[["hold-away-cap",3]]' "A10: off --dry-run, idle-slots records hold-away-cap with free 3"
scen a10b-real-halt
by_two ro-a 2 ro-b 2
mkro ro-d 3; mkt d1 ro-d gate-pending; mkt d2 ro-d open 'depends-on: ["[[d1]]"]'
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-d --running "" --dry-run)
ok "$(q "$J" "$holds")" '{"d2":"depends on [[d1]] (gate-pending)"}' "A10b: only the dependency holds d2"
ok "$(q "$J" '[d["halt"], [w["slug"] for w in d["awaitingSignOff"]]]')" '["awaiting-sign-off",["d1","d2"]]' \
  "A10b: the gate still halts awaiting-sign-off with the Away cap full"

# ── A11: a dead lead's running notes count against the Away cap until it is paused ──────────────────────────────
scen a11-dead-lead
mkro ro-dead 3; mkt g1 ro-dead in_progress 'owner: gone'; mkt g2 ro-dead in_progress 'owner: gone'; mkt g3 ro-dead in_progress 'owner: gone'
mkro ro-x 4; mkt x1 ro-x open; mkt x2 ro-x open; mkt x3 ro-x open; mkt x4 ro-x open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"], d["slotLimit"]]')" '[{"ro-dead":3},["x1"],1]' \
  "A11: a dead lead's three in_progress notes hold Away-cap room: one starts"
fmline ro-dead 'pause_requested: true'
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-dead":3},["x1"]]' "A11: a pause_requested rollout still counts"
fmline ro-dead 'paused: 2026-10-02T14:00+00:00'
J=$(nx ro-x)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"], d["slotLimit"]]')" '[{},["x1","x2","x3","x4"],4]' \
  "A11: once Lachy stamps it paused:, it leaves the count and ro-x fills to min(ceiling, Away cap)"

# ── A12: a git-env trip and a pause beat the Away cap ───────────────────────────────────────────────────────────
scen a12-git-env
by_two ro-a 2 ro-c 2
mkro ro-b 4; mkt b1 ro-b in_progress 'owner: lead-b'; mkt b2 ro-b open; mkt b3 ro-b open
printf '\n## Git-env log\n\n- 2026-10-02T10:00+00:00 git-env trip [[b1]] task: refs/heads/main a->b; repo /x\n' >> "$D/ro-b.md"
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-b --running "")
ok "$(q "$J" '[d["halt"], d["start"], d["restart"]]')" '["git-env",[],[]]' "A12: a git-env trip halts git-env"
ok "$(q "$J" "$holds")" '{"b1":"git-env hold: /thread:repair","b2":"git-env hold: /thread:repair","b3":"git-env hold: /thread:repair"}' \
  "A12: every row is held on the git-env hold, none on the Away cap"
scen a12b-pause
by_two ro-a 2 ro-c 2
mkro ro-b 4 'pause_requested: true'; mkt b1 ro-b in_progress 'owner: lead-b'; mkt b2 ro-b open; mkt b3 ro-b open
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 4
J=$(nx ro-b)
ok "$(q "$J" "$holds")" '{"b2":"pause requested: draining","b3":"pause requested: draining"}' "A12b: a soft pause holds its rows, never the Away cap"

# ── A13: the key written while an older-snapshot rollout, a paused one included, is live ───────────────────────
# An engine snapshot from before p29-8 (ADR 0043) reads the file with p28-1's reader, frozen in
# tests/fixtures/away-state/p28-1-reader.py: the Stage's file (the five keys, away_cap, by) reads fresh and Away, and
# that rollout runs to its own ceiling, as it did. The live reader takes the same file, an unknown later key added, on a
# paused rollout without a refusal or a WARN.
scen a13-older-snapshot
CHORUS='{"away": true, "until": "2026-10-02T22:05:00Z", "morning": "09:00", "trickle": 2, "away_cap": 4, "written_at": "2026-10-02T13:05:00Z", "by": "chorus: the Evening"}'
away_raw "$CHORUS"
OLD=$(HOME="$D/home" python3 "$HERE/../../../tests/fixtures/away-state/p28-1-reader.py" --now "$NOW" --ceiling 6 --elsewhere 5 2>"$D/err"); rc=$?
ok "$rc" 0 "A13: the p28-1 reader exits 0 on the Stage's file"
ok "$(q "$OLD" 'd')" '{"away":true,"file":"fresh","limit":2,"slotLimit":6}' \
  "A13: the p28-1 reader ignores away_cap: fresh, Away, slotLimit the ceiling 6 with 5 elsewhere"
ok "$(lines)" 0 "A13: … with no stderr"
away_raw "$(python3 -c 'import json,sys; d = json.loads(sys.argv[1]); d["evening"] = "18:00"; print(json.dumps(d))' "$CHORUS")"
mkro ro-p 3 'paused: 2026-10-02T10:00+00:00'; mkt p1 ro-p in_progress 'owner: lead-p'; mkt p2 ro-p open
J=$(nx ro-p --running ""); rc=$?
ok "$rc" 0 "A13: the live next on a paused rollout exits 0 with the key written"
ok "$(lines)" 0 "A13: … with empty stderr"
ok "$(q "$J" '[d["halt"], d["trickle"]["file"], d["trickle"]["away"], d["trickle"]["awayCap"]]')" '["paused","fresh",true,4]' \
  "A13: halt paused, the file fresh, its away_cap read and the unknown key ignored"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
