#!/usr/bin/env bash
# p28-1 (Chorus ADR 0104 d2, d3, d6): `next` counts the tasks running across every open Rollout on the Mac and, while
# Lachy is not Away, starts nothing past the Trickle; Away, each Rollout keeps its own parallel_ceiling. The Away state
# is ~/.config/thread/away.json (execute away.md): missing, stale or unreadable reads not Away at Trickle 2, and a
# stale or unreadable file prints one WARN line on stderr. Every `next` call pins HOME to its scenario's own dir, so
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
away_raw() { mkdir -p "$D/home/.config/thread"; printf '%s' "$1" > "$D/home/.config/thread/away.json"; }
BASE='{"away": true, "until": "2099-01-01T00:00:00Z", "morning": "09:00", "trickle": 2, "written_at": "2026-10-02T13:05:00Z"}'
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

# ── T2: Away with a fresh file, each Rollout to its own ceiling ────────────────────────────────────────────────
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

# ── T11: restarts fit the Trickle ──────────────────────────────────────────────────────────────────────────────
scen t11-restart
mkro ro-r 4; mkt r1 ro-r in_progress 'owner: gone'; mkt r2 ro-r in_progress 'owner: gone'; mkt r3 ro-r in_progress 'owner: gone'
J=$(nx ro-r --running "")
ok "$(q "$J" '[d["restart"], d["start"], d["halt"]]')" '[["r1","r2"],[],null]' "T11: only two of three stalled tasks restart"
ok "$(q "$J" "$holds")" '{"r3":"trickle: 2/2 tasks running on this Mac"}' "T11: the third is held on the Trickle"

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

# ── T18: a refused call reads no file and prints no WARN ───────────────────────────────────────────────────────
scen t18-refused
mkro ro-z 0; mkt z1 ro-z open
away_file "$D/home" 2026-10-01T00:00:00Z
J=$(nx ro-z); rc=$?
ok "$rc" 1 "T18: parallel_ceiling 0 is refused"
ok "$(grep -c '^WARN: ~/.config/thread/away.json' "$D/err")" 0 "T18: the refusal prints no WARN"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
