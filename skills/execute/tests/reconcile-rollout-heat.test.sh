#!/usr/bin/env bash
# p31-4 (estate ADR 0009 d5): the Heat hold in `next`. At heavy (2) or worse the Mac's thermal pressure holds every
# new start, Away included (`slotLimit` 0); a restart still waits on the ceiling alone; a held row reads `heat: the Mac
# is hot (<name>)`, which never halts the rollout, and `next` reports a `heat` key. The level comes from verify-slot.py's
# heat_level(), pinned per call by THREAD_HEAT_LEVEL (H11 reads it through a PATH-stub notifyutil instead). Every call
# pins HOME to its scenario's own dir, so the operator's Away file never reaches an assertion. Temp notes only.
# Usage: bash reconcile-rollout-heat.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
export THREAD_HEAT_LEVEL=0                        # the Heat hold's reading, pinned (each arm sets its own per call)
NOW=2026-10-02T14:05:00Z
HOUR_AGO=2026-10-02T13:05:00Z
TONIGHT=2026-10-02T22:05:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }

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
# nx <level> <rollout> [next flags...] — `next` on $D/<rollout>.md at heat <level>, HOME pinned to $D/home.
nx() { local lv="$1" ro="$2"; shift 2; THREAD_HEAT_LEVEL="$lv" HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/$ro.md" --tasks-dir "$D" --now "$NOW" "$@" 2>"$D/err"; }
# q <json> <python-expr over d> — compact JSON of the expression ('PARSE' when stdout is not one JSON object)
q() { printf '%s' "$1" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("PARSE"); sys.exit(0)
print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
holds='{h["slug"]: h["reason"] for h in d["hold"]}'
sums() { cksum "$D"/*.md | awk '{print $1 $2}' | tr '\n' ' '; }
idle() { python3 -c 'import json,sys
try:
    rows = [json.loads(l) for l in open(sys.argv[1])]
except FileNotFoundError:
    rows = []
print(json.dumps([[r["reason"], r["free"]] for r in rows if r["kind"] == "idle-slots"], separators=(",", ":")))' "$1"; }
# one: a rollout with Trickle room (nothing running anywhere) and three queued rows.
one() { mkro ro-b 4; mkt b1 ro-b open; mkt b2 ro-b open; mkt b3 ro-b open; }
HOT='heat: the Mac is hot (heavy)'

# ── H0: nominal and moderate change nothing ────────────────────────────────────────────────────────────────────
scen h0-cool
one
for lv in 0 1; do
  J=$(nx "$lv" ro-b)
  ok "$(q "$J" '[d["start"], d["hold"], d["slotLimit"], d["halt"]]')" '[["b1","b2"],[{"reason":"trickle: 2/2 tasks running on this Mac","slug":"b3"}],2,null]' \
    "H0 level $lv: two start within the Trickle, the third waits on it as before"
done
ok "$(q "$(nx 0 ro-b --dry-run)" 'd["heat"]')" '{"level":0,"name":"nominal"}' "H0: heat is {level, name}: 0 nominal"
ok "$(q "$(nx 1 ro-b --dry-run)" 'd["heat"]')" '{"level":1,"name":"moderate"}' "H0: … 1 moderate"
ok "$(q "$(nx 0 ro-b --dry-run)" 'list(d).index("heat") == list(d).index("lastStarts") + 1')" 'true' "H0: heat comes right after lastStarts (which follows trickle)"

# ── H1: heavy, not Away, with Trickle room: nothing starts ────────────────────────────────────────────────────
scen h1-heavy
one
J=$(nx 2 ro-b --dry-run)
ok "$(q "$J" '[d["start"], d["restart"], d["slotLimit"], d["halt"]]')" '[[],[],0,null]' "H1: heavy: nothing starts, slotLimit 0, halt null"
ok "$(q "$J" "$holds")" "{\"b1\":\"$HOT\",\"b2\":\"$HOT\",\"b3\":\"$HOT\"}" "H1: every row reads the heat hold"
ok "$(q "$J" 'd["heat"]')" '{"level":2,"name":"heavy"}' "H1: heat reads 2 heavy"
ok "$(q "$J" '[d["trickle"]["away"], d["trickle"]["limit"], d["ceiling"]]')" '[false,2,4]' "H1: the trickle block and the ceiling are reported as they are"

# ── H2: heavy while Away: slotLimit 0, not the ceiling ─────────────────────────────────────────────────────────
scen h2-away
one
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00
ok "$(q "$(nx 0 ro-b --dry-run)" '[d["start"], d["slotLimit"]]')" '[["b1","b2","b3"],4]' "H2: Away and cool, all three start (slotLimit the ceiling)"
J=$(nx 2 ro-b --dry-run)
ok "$(q "$J" '[d["start"], d["slotLimit"], d["halt"], d["trickle"]["away"]]')" '[[],0,null,true]' "H2: Away and heavy: nothing starts, slotLimit 0, no halt"
ok "$(q "$J" "$holds")" "{\"b1\":\"$HOT\",\"b2\":\"$HOT\",\"b3\":\"$HOT\"}" "H2: every row reads the heat hold, Away too"

# ── H3: trapping and sleeping name themselves ─────────────────────────────────────────────────────────────────
scen h3-names
one
for p in "3 trapping" "4 sleeping"; do
  set -- $p
  J=$(nx "$1" ro-b --dry-run)
  ok "$(q "$J" '[d["heat"], d["slotLimit"], d["start"]]')" "[{\"level\":$1,\"name\":\"$2\"},0,[]]" "H3: level $1 reads $2 and holds"
  ok "$(q "$J" 'd["hold"][0]["reason"]')" "\"heat: the Mac is hot ($2)\"" "H3: … the reason names $2"
done

# ── H4: a restart waits on the ceiling alone, heat or not ─────────────────────────────────────────────────────
scen h4-restart
mkro ro-r 4; mkt r1 ro-r in_progress 'owner: gone'; mkt r2 ro-r in_progress 'owner: gone'; mkt r3 ro-r open
J=$(nx 2 ro-r --running "" --dry-run)
ok "$(q "$J" '[d["restart"], d["start"], d["slotsInUse"], d["slotLimit"], d["halt"]]')" '[["r1","r2"],[],2,0,null]' \
  "H4: heavy: both stalled rows restart within the ceiling, nothing new starts"
ok "$(q "$J" "$holds")" "{\"r3\":\"$HOT\"}" "H4: the queued r3 is held on the heat"

# ── H5: nothing in flight, every row heat-held: no halt; idle-slots hold-heat ────────────────────────────────
scen h5-no-halt
mkro ro-c 3; mkt c1 ro-c open; mkt c2 ro-c open
J=$(nx 2 ro-c --running "" --dry-run)
ok "$(q "$J" '[d["start"], d["restart"], d["running"], d["halt"]]')" '[[],[],[],null]' "H5: nothing in flight and nothing starts: halt null, never stuck"
EV="$D/events"
THREAD_EVENTS_DIR="$EV" nx 2 ro-c --running "" --dry-run >/dev/null
ok "$(idle "$EV/ro-c.jsonl")" '[]' "H5: --dry-run records nothing"
THREAD_EVENTS_DIR="$EV" nx 2 ro-c --running "" >/dev/null
ok "$(idle "$EV/ro-c.jsonl")" '[["hold-heat",3]]' "H5: off --dry-run, idle-slots records hold-heat with free the ceiling's (3)"
mkro ro-t 3; mkt t1 ro-t open
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a in_progress 'owner: lead-a'
THREAD_EVENTS_DIR="$EV" nx 2 ro-t --running "" >/dev/null
ok "$(idle "$EV/ro-t.jsonl")" '[["hold-heat",3]]' "H5: heat with the Trickle full too records hold-heat, never hold-trickle"

# ── H6: a head Solo held by the heat ──────────────────────────────────────────────────────────────────────────
scen h6-solo
mkro ro-s 4; mkt s1 ro-s open 'solo: true'; mkt s2 ro-s open
J=$(nx 2 ro-s --running "" --dry-run)
ok "$(q "$J" '[d["start"], d["halt"]]')" '[[],null]' "H6: the head Solo does not start while hot, and no halt"
ok "$(q "$J" "$holds")" "{\"s1\":\"$HOT\",\"s2\":\"behind solo [[s1]]\"}" "H6: the Solo reads heat:, the row below it behind solo"

# ── H7: a full ceiling reads ceiling: ─────────────────────────────────────────────────────────────────────────
scen h7-ceiling
mkro ro-c 1; mkt c1 ro-c in_progress 'owner: l'; mkt c2 ro-c open
J=$(nx 2 ro-c --dry-run)
ok "$(q "$J" "$holds")" '{"c2":"ceiling: 1/1 slots in use"}' "H7: heavy with the ceiling full: the ceiling names the hold"

# ── H8, H9: a git-env hold and a pause beat the heat ──────────────────────────────────────────────────────────
scen h8-git-env
one
printf '\n## Git-env log\n\n- 2026-10-02T10:00+00:00 git-env trip [[b1]] task: refs/heads/main a->b; repo /x\n' >> "$D/ro-b.md"
J=$(nx 2 ro-b --running "" --dry-run)
ok "$(q "$J" '[d["halt"], d["start"]]')" '["git-env",[]]' "H8: a git-env trip halts git-env, heat or not"
ok "$(q "$J" "$holds")" '{"b1":"git-env hold: /thread:repair","b2":"git-env hold: /thread:repair","b3":"git-env hold: /thread:repair"}' \
  "H8: every row reads the git-env hold, none the heat"
scen h9-pause
mkro ro-b 4 'pause_requested: true'; mkt b0 ro-b in_progress 'owner: l'; mkt b1 ro-b open; mkt b2 ro-b open
J=$(nx 2 ro-b --dry-run)
ok "$(q "$J" "$holds")" '{"b1":"pause requested: draining","b2":"pause requested: draining"}' "H9: a soft pause holds its rows, never the heat"

# ── H10: --dry-run leaves every note byte-identical ───────────────────────────────────────────────────────────
scen h10-dry
one
before=$(sums)
nx 2 ro-b --dry-run >/dev/null; nx 3 ro-b --dry-run >/dev/null
ok "$(sums)" "$before" "H10: --dry-run leaves every note byte-identical"

# ── H11: the shared reading, through notifyutil ───────────────────────────────────────────────────────────────
scen h11-notifyutil
one
mkdir -p "$D/bin"
printf '#!/bin/sh\necho "com.apple.system.thermalpressurelevel 2"\n' > "$D/bin/notifyutil"; chmod +x "$D/bin/notifyutil"
J=$(env -u THREAD_HEAT_LEVEL PATH="$D/bin:$PATH" HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/ro-b.md" --tasks-dir "$D" --now "$NOW" --dry-run 2>"$D/err")
ok "$(q "$J" '[d["heat"], d["slotLimit"], d["start"]]')" '[{"level":2,"name":"heavy"},0,[]]' "H11: next reads notifyutil's level through the shared heat reading"
printf '#!/bin/sh\nexit 1\n' > "$D/bin/notifyutil"
J=$(env -u THREAD_HEAT_LEVEL PATH="$D/bin:$PATH" HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/ro-b.md" --tasks-dir "$D" --now "$NOW" --dry-run 2>"$D/err")
ok "$(q "$J" '[d["heat"], d["start"]]')" '[{"level":0,"name":"nominal"},["b1","b2"]]' "H11: a failing notifyutil reads nominal (fail open)"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
