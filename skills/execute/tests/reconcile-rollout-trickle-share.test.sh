#!/usr/bin/env bash
# p28-5: the fair share (skills/execute/away.md § The Trickle, *A fair share*). Off --dry-run a lead whose final holds
# include a waiting row (`trickle:`, `away cap:` or `heat:`), or whose seeded revise (execute § 4.5 step 1.2) waits on
# slotLimit, records its rollout as waiting in trickle-claims.json's `waiting` list, under the trickle claim lock:
# {tasksDir, rollout, since, at, served, want}. Every lead's `next` then
# gives the free places on the Mac out one at a time, each to the contender with the fewest places held, then served
# least recently (never served first), then waiting longest, and `slotLimit` leaves out the places it keeps for waiting
# rollouts: a held row reads `…, <k> kept for [[<rollout>]]` and `trickle.kept` reports them. A record lives 30 minutes
# from its `at`. The task's Verify: a waiting rollout gets in within the bound, and a start never takes the Mac past N.
#
# Each scenario pins its own lock dir ($L), as the claim suite does: tests/run.sh shares one THREAD_NOTE_LOCK_DIR across
# every suite, and a record this suite reads across calls must live in a dir no other suite writes. HOME is pinned per
# scenario with no away file (N = 2) unless one is named. Task notes that count carry `owner:` and `started:`. Temp
# notes only.
# Usage: bash reconcile-rollout-trickle-share.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # THREAD_HEAT_LEVEL=0
TMP="$(cd "$(mktemp -d)" && pwd -P)"
PIDS=()   # every background process this suite starts, killed by pid at exit if still alive
cleanup() {
  local p
  for p in ${PIDS[@]+"${PIDS[@]}"}; do kill -0 "$p" 2>/dev/null && kill "$p" 2>/dev/null; done
  chmod -R u+w "$TMP" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"   # the backstop: every nx call pins its scenario's own $L (header)
NOW=2026-10-02T14:05:00Z
HOUR_AGO=2026-10-02T13:05:00Z
TONIGHT=2026-10-02T22:05:00Z
ST='started: 2026-10-02T13:00+00:00'   # a counted task's § 4 stamp: served at 13:00

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
starts() { case "$1" in "$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$1] does not start [$2]"; fail=1;; esac; }

D=""; L=""
# scen <name>: a fresh tasks dir $D (HOME $D/home, no away file) and its own lock dir $L.
scen() { D="$TMP/$1"; L="$TMP/locks-$1"; mkdir -p "$D/home"; echo "== $1"; }
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
  [ -f "$D/$ro.md" ] && printf -- '- [[%s]]\n' "$s" >> "$D/$ro.md"
  return 0
}
# run1 <slug> <rollout> [started stamp] — a counted running task: in_progress, owner (the rollout started) and started.
run1() { mkt "$1" "$2" in_progress "owner: lead-$2" "${3:-$ST}"; }
# rev1 <slug> <rollout> <max_review_rounds> [frontmatter lines...] — a task Integration rejected, set aside for its seeded
# revise (execute § 4.5 step 1.2): blocked at its run, its `## Blocker diagnosis` the engine's revise marker with one
# Integration round, its Integration log's last line `rejected`, a PR URL and the round budget given (with 3,
# lead-integrate.py inputs reads autoRevise true; with 1, its one round is spent). Served at 12:00 by its started: stamp.
rev1() {
  local s="$1" ro="$2" k="$3"; shift 3
  mkt "$s" "$ro" blocked "owner: lead-$ro" 'started: 2026-10-02T12:00+00:00' 'pr: https://github.com/o/r/pull/7' \
    "max_review_rounds: $k" "$@"
  printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-02T13:40+00:00)\n\n%s\n\nRound 1 (Integration) rejection:\n- the merge dropped the retry guard\n\n<!-- run 1 end sha=0123456789ab -->\n\n## Integration log\n\n2026-10-02T13:30+00:00 rejected path=judge-only pr=7 anchor=- head=- base=- wait=- duration=- triggers=-\n' \
    'revise: rejected at Integration re-review — revise on the branch, then re-integrate' >> "$D/$s.md"
}
# at <minutes> — NOW plus that many minutes (negative, fractional: seconds), as a --now value.
at() { python3 -c 'import sys
from datetime import datetime, timedelta
print((datetime.fromisoformat("2026-10-02T14:05:00+00:00") + timedelta(minutes=float(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"; }
# nx <rollout> [next flags...] — `next` on $D/<rollout>.md with this scenario's lock dir and HOME; stderr lands in
# $NXERR, else $D/err. A later --now wins over the pinned one.
nx() {
  local ro="$1"; shift
  THREAD_NOTE_LOCK_DIR="$L" HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/$ro.md" --tasks-dir "$D" --now "$NOW" "$@" \
    2>"${NXERR:-$D/err}"
}
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
share='[d["trickle"].get("kept"), d["slotLimit"], d["start"]]'
CF() { echo "$L/trickle-claims.json"; }
nofile() { if [ -e "$(CF)" ]; then echo "file"; else echo "none"; fi; }
sum1() { if [ -e "$1" ]; then cksum < "$1" | tr -d ' \t'; else echo none; fi; }
# under <json> <N> <label> — the Verify's other half: after a call that starts, the Mac-wide count never passes N.
under() {
  local r; r=$(q "$1" 'd["trickle"]["running"]')
  if [ "$r" -le "$2" ] 2>/dev/null; then echo "ok   - $3: trickle.running $r <= $2"; else echo "FAIL - $3: trickle.running [$r] > $2"; fail=1; fi
}

# stamp <slug> [status|-] [owner] [started] — rewrite a task note's `status:` (unless "-"), `owner:` and `started:` (each
# when given) through a temp file and os.replace, as an Edit-tool or Obsidian save lands (whole, never torn).
STAMP_PY='import os, re, sys
p, st, owner, started = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
m = re.match(r"^---\n(.*?\n)---\n(.*)$", open(p).read(), re.S)
fm = m.group(1).rstrip("\n").split("\n")
if st != "-":
    fm = [("status: " + st) if l.startswith("status:") else l for l in fm]
if owner:
    fm = [l for l in fm if not l.startswith("owner:")] + ["owner: " + owner]
if started:
    fm = [l for l in fm if not l.startswith("started:")] + ["started: " + started]
tmp = p + ".stamp.tmp"
with open(tmp, "w") as f:
    f.write("---\n" + "\n".join(fm) + "\n---\n" + m.group(2))
os.replace(tmp, p)'
stamp() { python3 -c "$STAMP_PY" "$D/$1.md" "${2:-in_progress}" "${3:-}" "${4:-}"; }
# setfm <note> <from> <to> — one literal replacement in a note.
setfm() { python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); assert sys.argv[2] in t, sys.argv[2]; open(p, "w").write(t.replace(sys.argv[2], sys.argv[3], 1))' "$D/$1.md" "$2" "$3"; }
# seedw <claims-expr> <waiting-expr> — write $L/trickle-claims.json as {"version": 1, "claims": …, "waiting": …}. In
# each expression: D is this tasks dir's realpath, NOW the suite's --now and WALL the real clock (both aware datetimes),
# m(n) n minutes, s(n) n seconds, c(tasksDir, rollout, slug, at) one claim and w(tasksDir, rollout, since, at, served,
# want) one waiting record, each time to the second (served None stays null).
SEED_PY='import json, os, sys
from datetime import datetime, timedelta, timezone
D = os.path.realpath(sys.argv[2])
NOW = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00"))
WALL = datetime.now(timezone.utc)
m = lambda n: timedelta(minutes=n)
s = lambda n: timedelta(seconds=n)
iso = lambda t: t.isoformat(timespec="seconds") if isinstance(t, datetime) else t
c = lambda td, ro, slug, at: {"tasksDir": td, "rollout": ro, "slug": slug, "at": iso(at)}
w = lambda td, ro, since, at, served, want: {"tasksDir": td, "rollout": ro, "since": iso(since), "at": iso(at),
                                            "served": iso(served), "want": want}
data = {"version": 1, "claims": eval(sys.argv[4]), "waiting": eval(sys.argv[5])}
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
with open(sys.argv[1], "w") as f:
    json.dump(data, f)'
seedw() { python3 -c "$SEED_PY" "$(CF)" "$D" "$NOW" "$1" "$2"; }
# rawf <python expression> — write $L/trickle-claims.json as that object (D, NOW as in seedw).
rawf() { python3 -c 'import json, os, sys
from datetime import datetime
D = os.path.realpath(sys.argv[2])
NOW = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00"))
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
json.dump(eval(sys.argv[4]), open(sys.argv[1], "w"))' "$(CF)" "$D" "$NOW" "$1"; }
# waiting [all] — the waiting records as sorted compact JSON: [[rollout, want, since, served-or-null], …] for this tasks
# dir (times in UTC, HH:MM, or HH:MM:SS off the minute), or with `all` [[where, rollout], …] for every record, where
# "here" or its tasksDir. "none" with no file, "nokey" when the file has no `waiting` list.
WAIT_PY='import json, os, sys
from datetime import datetime, timezone
p, here, every = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3] == "all"
if not os.path.exists(p):
    print("none"); sys.exit(0)
d = json.load(open(p, encoding="utf-8"))
if not isinstance(d.get("waiting"), list):
    print("nokey"); sys.exit(0)
def hm(v):
    if v is None:
        return None
    t = datetime.fromisoformat(v).astimezone(timezone.utc)
    return t.strftime("%H:%M") if t.second == 0 else t.strftime("%H:%M:%S")
out = []
for e in d["waiting"]:
    if every:
        out.append(["here" if e["tasksDir"] == here else e["tasksDir"], e["rollout"]])
    elif e["tasksDir"] == here:
        out.append([e["rollout"], e["want"], hm(e["since"]), hm(e["served"])])
print(json.dumps(sorted(out, key=json.dumps), separators=(",", ":")))'
waiting() { python3 -c "$WAIT_PY" "$(CF)" "$D" "${1:-}"; }
# fshape — the claims file's top-level keys in order and its version.
fshape() { python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(json.dumps([list(d), d.get("version")], separators=(",", ":")))' "$(CF)"; }
T='tasks running on this Mac'

# ── F1, the task's Verify (fails first): one rollout refilling, one waiting ─────────────────────────────────────────
scen f1-verify
mkro ro-a 4; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open; mkt a4 ro-a open
mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open
J=$(nx ro-a)
ok "$(q "$J" 'd["start"]')" '[]' "F1: ro-a at the Trickle starts nothing"
ok "$(waiting)" '[["ro-a",2,"14:05","13:00"]]' "F1: … and records ro-a waiting (want 2, since now, served 13:00 by its stamps)"
J=$(nx ro-b --now "$(at 1)")
ok "$(q "$J" '[d["start"], d["halt"]]')" '[[],null]' "F1: ro-b (never started) starts nothing, no halt"
ok "$(waiting)" '[["ro-a",2,"14:05","13:00"],["ro-b",2,"14:06",null]]' "F1: … and records ro-b waiting, never served"
stamp a1 review
J=$(nx ro-a --now "$(at 2)")
ok "$(q "$J" 'd["start"]')" '[]' "F1: a1 lands; ro-a does not refill the freed place"
ok "$(q "$J" '[d["hold"][0]["slug"], d["hold"][0]["reason"]]')" "[\"a3\",\"trickle: 1/2 $T, 1 kept for [[ro-b]]\"]" \
  "F1: … a3 reads the place kept for ro-b"
ok "$(q "$J" '[d["trickle"]["kept"], d["slotLimit"]]')" '[{"ro-b":1},1]' "F1: … trickle.kept {ro-b: 1} and slotLimit 1"
# p28-4's `lapsed` follows `elsewhere`; `kept` stays last.
ok "$(q "$J" 'list(d["trickle"])')" '["away","file","why","limit","awayCap","until","morning","elsewhere","lapsed","running","kept"]' \
  "F1: … kept is the trickle block's last key"
J=$(nx ro-b --now "$(at 20)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "F1: ro-b's next tick (+20m) starts b1 into the kept place"
under "$J" 2 "F1: ro-b's start"
ok "$(q "$J" "$holds")" "{\"b2\":\"trickle: 2/2 $T\"}" "F1: … b2 waits on the Trickle, nothing kept"
stamp b1 in_progress lead-b 2026-10-02T14:25+00:00
stamp a2 review
J=$(nx ro-a --now "$(at 21)")
ok "$(q "$J" 'd["start"]')" '["a3"]' "F1: a2 lands: ro-a (holding 0) beats ro-b (holding 1) and starts a3"
under "$J" 2 "F1: ro-a's start"

# ── F2b: N = 1, the refiller's record is older; the waiter still gets in, then the refiller's turn comes back ─────────
scen f2b-refiller
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 1
mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open; mkt a3 ro-a open
mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open
nx ro-a >/dev/null
ok "$(waiting)" '[["ro-a",2,"14:05","13:00"]]' "F2b: ro-a records waiting since now"
nx ro-b --now "$(at 5)" >/dev/null
stamp a1 review
J=$(nx ro-a --now "$(at 6)")
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 0/1 $T, 1 kept for [[ro-b]]\"]" \
  "F2b: a1 lands: ro-a starts nothing, the place kept for never-served ro-b"
J=$(nx ro-b --now "$(at 25)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "F2b: ro-b's tick starts b1"
under "$J" 1 "F2b: ro-b's start"
stamp b1 review
J=$(nx ro-b --now "$(at 27)")
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 0/1 $T, 1 kept for [[ro-a]]\"]" \
  "F2b: b1 lands and ro-b refills first: the place is kept for ro-a, served longer ago"
J=$(nx ro-a --now "$(at 28)")
ok "$(q "$J" 'd["start"]')" '["a2"]' "F2b: ro-a's call starts a2"
under "$J" 1 "F2b: ro-a's start"

# ── F2: three rollouts, N = 2: each never-served waiter gets in within two frees ─────────────────────────────────────
scen f2-three
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open
mkro ro-b 2; mkt b1 ro-b open; mkt b2 ro-b open
mkro ro-c 2; mkt c1 ro-c open; mkt c2 ro-c open
nx ro-a >/dev/null
nx ro-b --now "$(at 1)" >/dev/null
nx ro-c --now "$(at 2)" >/dev/null
ok "$(waiting)" '[["ro-a",1,"14:05","13:00"],["ro-b",2,"14:06",null],["ro-c",2,"14:07",null]]' "F2: three rollouts wait"
stamp a1 review
J=$(nx ro-a --now "$(at 3)")
ok "$(q "$J" "$share")" '[{"ro-b":1},1,[]]' "F2: free 1: ro-a keeps it for ro-b, waiting longest of the never-served"
J=$(nx ro-c --now "$(at 4)")
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 1/2 $T, 1 kept for [[ro-b]]\"]" \
  "F2: … ro-c's own call holds with the place kept for ro-b"
J=$(nx ro-b --now "$(at 5)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "F2: … ro-b starts b1"
under "$J" 2 "F2: ro-b's start"
stamp b1 in_progress lead-b 2026-10-02T14:10+00:00
stamp a2 review
J=$(nx ro-a --now "$(at 6)")
ok "$(q "$J" '[d["trickle"]["kept"], d["start"], d["hold"][0]["reason"]]')" \
  "[{\"ro-c\":1},[],\"trickle: 1/2 $T, 1 kept for [[ro-c]]\"]" \
  "F2: free 2: ro-a holds 0 but was served at 13:00; ro-c, never served, has it"
J=$(nx ro-c --now "$(at 7)")
ok "$(q "$J" 'd["start"]')" '["c1"]' "F2: … ro-c starts c1, within two frees"
under "$J" 2 "F2: ro-c's start"

# ── F3: a record lives 30 minutes from its at (a dead lead) ─────────────────────────────────────────────────────────
scen f3-ttl
mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open; mkt a3 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(40), NOW - m(30) + s(1), None, 1)]'
J=$(nx ro-a --dry-run)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,[]]' "F3: a record 29:59 old still keeps a place"
seedw '[]' '[w(D, "ro-b", NOW - m(40), NOW - m(30), None, 1)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{},2,["a2"]]' "F3: at 30:00 it has lapsed: ro-a starts a2"
ok "$(waiting all)" '[["here","ro-a"]]' "F3: … and the write drops it (ro-a's own record stands for a3)"

# ── F4: what a record keeps a place for ─────────────────────────────────────────────────────────────────────────────
# f4 <name>: ro-a (ceiling 3) runs a1, a2 and a3 queued: one free place, ro-a served at 13:00.
f4() { scen "f4$1"; mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open; mkt a3 ro-a open; }
f4_none() {  # f4_none <label>: the record keeps nothing; ro-a starts a2, stderr empty
  J=$(nx ro-a --dry-run)
  ok "$(q "$J" "$share")" '[{},2,["a2"]]' "F4 ($1): keeps nothing; ro-a starts a2"
  ok "$(lines)" 0 "F4 ($1): … with empty stderr"
}
wb='[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]'
f4 a-paused; mkro ro-b 3 'paused: 2026-10-02T13:00+00:00'; mkt b1 ro-b open; seedw '[]' "$wb"; f4_none paused
f4 b-done; mkro ro-b 3; setfm ro-b 'status: open' 'status: done'; mkt b1 ro-b open; seedw '[]' "$wb"; f4_none done
f4 c-serial; mkro ro-b 3 'shape: serial'; mkt b1 ro-b open; seedw '[]' "$wb"; f4_none serial
f4 d-archived; mkdir -p "$D/Archive"; mkro ro-b 3; mkt b1 ro-b open; mv "$D/ro-b.md" "$D/Archive/ro-b.md"
seedw '[]' "$wb"; f4_none archived
f4 e-untagged; mkro ro-b 3; setfm ro-b 'tags: [task, rollout]' 'tags: [task]'; mkt b1 ro-b open; seedw '[]' "$wb"; f4_none untagged
f4 f-other-dir; mkro ro-b 3; mkt b1 ro-b open; mkdir -p "$TMP/elsewhere"
seedw '[]' "[w(os.path.realpath('$TMP/elsewhere'), 'ro-b', WALL - m(5), WALL - m(1), None, 1)]"; f4_none 'another tasks dir'
nx ro-a >/dev/null
ok "$(waiting all)" "[[\"$TMP/elsewhere\",\"ro-b\"],[\"here\",\"ro-a\"]]" "F4 (another tasks dir): … the write keeps it (live by the real clock)"
f4 g-absent
seedw '[]' '[w(D, "ro-gone", NOW - m(5), NOW - m(1), None, 1)]'
J=$(nx ro-a --dry-run)
ok "$(q "$J" "$share")" '[{"ro-gone":1},1,[]]' "F4 (absent): a record whose rollout note is missing keeps its place"
ok "$(q "$J" 'd["hold"][0]["reason"]')" "\"trickle: 1/2 $T, 1 kept for [[ro-gone]]\"" "F4 (absent): … under its recorded name"
J=$(nx ro-a --now "$(at 29)" --dry-run)
ok "$(q "$J" "$share")" '[{},2,["a2"]]' "F4 (absent): … until the TTL (at 30:00 old it has lapsed)"
f4 h-malformed; mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 0), w(D, "ro-b", NOW - m(5), NOW - m(1), None, True),
            w(D, "ro-b", NOW, NOW - m(1), None, 1), w(D, "ro-b", NOW - m(5), NOW - m(1), NOW, 1),
            w(D, "ro-b", "yesterday", NOW - m(1), None, 1), w(D, "ro-b", NOW - m(5), "0001-01-01T00:00:00", None, 1),
            {"tasksDir": D, "rollout": "ro-b", "since": (NOW - m(5)).isoformat(), "at": (NOW - m(1)).isoformat(), "want": 1},
            w(D, "ro-b", NOW - m(5), NOW - m(1), 7, 1), w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1.5), 42]'
f4_none 'malformed: want 0 or true or 1.5, since or served after at, a bad timestamp, a missing key, a non-object'
nx ro-a >/dev/null
ok "$(waiting all)" '[["here","ro-a"]]' "F4 (malformed): … and the write drops every one"
scen f4i-spelling; mkro ro-a 3; mkt a0 ro-a done 'owner: lead-a' "$ST"; mkt a1 ro-a open
mkro ro-b 3; run1 b1 ro-b; mkt b2 ro-b open
seedw '[]' '[w(D, "RO-B", NOW - m(5), NOW - m(1), None, 1)]'
J=$(nx ro-a --dry-run)
ok "$(q "$J" "$share")" '[{},1,["a1"]]' "F4 (i): a record spelled RO-B is held under ro-b's lowercased stem (1): ro-a, holding 0, starts"
scen f4j-spelling; mkro ro-a 3; mkt a0 ro-a done 'owner: lead-a' "$ST"; mkt a1 ro-a open; mkt a2 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "RO-B", NOW - m(5), NOW - m(1), None, 1)]'
J=$(nx ro-a --dry-run)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,["a1"]]' "F4 (ii): ro-b holding 0, never served, has one place: kept under the walked spelling"
ok "$(q "$J" "$holds")" "{\"a2\":\"trickle: 1/2 $T, 1 kept for [[ro-b]]\"}" "F4 (ii): … and the suffix names [[ro-b]]"

# ── F5: a waiter's want bounds what is kept for it; the caller's demand is bounded by its startable rows ─────────────
scen f5-want
mkro ro-a 3; mkt a1 ro-a open; mkt a2 ro-a open; mkt a3 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,["a1"]]' "F5: a want-1 waiter and two places free: ro-a starts one and keeps one"
under "$J" 2 "F5: ro-a's start"
scen f5b-want-cap
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 4
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open; mkt a4 ro-a open; mkt a5 ro-a open
mkro ro-c 3; run1 c1 ro-c; run1 c2 ro-c; mkt c3 ro-c open 'depends-on: ["[[c1]]"]'
J=$(nx ro-a)
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 4/4 $T\"]" "F5b: ro-a (ceiling 3, two running) at the cap"
ok "$(waiting)" '[["ro-a",1,"14:05","13:00"]]' "F5b: … its record's want is 1, its ceiling's room, not its 3 queued rows"
stamp c1 review; stamp c2 review
J=$(nx ro-c --now "$(at 1)")
ok "$(q "$J" "$share")" '[{"ro-a":1},1,[]]' "F5b: two places free and no candidate of ro-c's: only 1 is kept for ro-a"
scen f5c-caller-demand
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 4
mkro ro-b 3; run1 b1 ro-b; run1 b2 ro-b; mkt b3 ro-b open
mkro ro-a 3; mkt a1 ro-a open; mkt a2 ro-a open 'depends-on: ["[[a1]]"]'
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), "2026-10-02T13:00:00+00:00", 1)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,["a1"]]' "F5c: ro-a's demand is its one ready row: the second place is kept for ro-b"
under "$J" 4 "F5c: ro-a's start"
scen f5d-solo-lone
mkro ro-a 3; mkt s1 ro-a open 'solo: true'
mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 2)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,["s1"]]' "F5d: a head Solo's lone start with nothing started is a demand of 1: s1 starts"
scen f5d-solo-behind
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 3
mkro ro-a 3; run1 a1 ro-a; mkt s1 ro-a open 'solo: true'
mkro ro-b 3; run1 b1 ro-b 'started: 2026-10-02T13:30+00:00'; mkt b2 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), "2026-10-02T13:30:00+00:00", 1)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,[]]' "F5d: a head Solo behind a running task is no demand: the free place is kept for ro-b"
starts "$(q "$J" 'd["hold"][0]["reason"]')" '"solo: waits for 1 started task(s)' "F5d: … s1 waits on its own started task"
ok "$(waiting)" '[["ro-b",1,"14:00","13:30"]]' "F5d: … and ro-a records nothing (no waiting row)"

# ── F6: the rollout's own record ────────────────────────────────────────────────────────────────────────────────────
scen f6-own
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open; mkt a4 ro-a open
nx ro-a >/dev/null
nx ro-a --now "$(at 10)" >/dev/null
ok "$(waiting)" '[["ro-a",1,"14:05","13:00"]]' "F6: since carries across calls inside the TTL"
stamp a1 review
J=$(nx ro-a --now "$(at 11)")
ok "$(q "$J" 'd["start"]')" '["a3"]' "F6: a1 lands, ro-a starts a3"
ok "$(waiting)" '[["ro-a",1,"14:05","14:16"]]' "F6: … served moves to now, since stays"
stamp a2 review; stamp a3 in_progress lead-a
J=$(nx ro-a --now "$(at 12)")
ok "$(q "$J" '[d["start"], d["hold"]]')" '[["a4"],[]]' "F6: everything left starts"
ok "$(waiting)" '[]' "F6: … and the record is removed"
# f6x <name> <label> <change...>: ro-a at the cap records waiting; the change then removes its record.
f6x() {
  local name="$1" label="$2"; shift 2
  scen "f6-$name"; mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open
  nx ro-a >/dev/null
  ok "$(waiting)" '[["ro-a",1,"14:05","13:00"]]' "F6 ($label): ro-a records waiting"
  "$@"
  J=$(nx ro-a --gh-bin "$D/bin/gh")
  ok "$(waiting)" '[]' "F6 ($label): … and the record is removed"
}
mkgh() {
  mkdir -p "$D/bin"
  printf '#!/usr/bin/env bash\necho %s\n' "'{\"state\":\"OPEN\",\"mergedAt\":null,\"url\":\"https://github.com/o/r/pull/202\"}'" > "$D/bin/gh"
  chmod +x "$D/bin/gh"
}
f6x pause 'a pause request' setfm ro-a 'parallel_ceiling: 3' $'parallel_ceiling: 3\npause_requested: true'
hold_ro() { mkgh; setfm ro-a 'parallel_ceiling: 3' $'parallel_ceiling: 3\nhold_until: {pr: o/r#202}'; }
f6x hold 'a rollout hold_until' hold_ro
gitenv_ro() { printf '\n## Git-env log\n\n- 2026-10-02T10:00+00:00 git-env trip [[a1]] task: core.bare false→true; repo /x\n' >> "$D/ro-a.md"; }
f6x git-env 'a whole-rollout git-env hold' gitenv_ro
red_ro() { printf '\n## Race log\n\n- 2026-10-02T10:00+00:00 [[a3]] revert did not land: conflict in a.py\n' >> "$D/ro-a.md"; }
f6x main-red 'main red' red_ro
# The TTL runs before the own entry: a lapsed or future own record is never read, so since restarts and served comes
# from the started: stamps.
f6ttl() {  # f6ttl <name> <at-expr> <served-expr>
  scen "f6-ttl-$1"
  away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 2
  mkro ro-b 3; run1 b1 ro-b
  mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open
  seedw '[]' "[w(D, 'ro-a', NOW.replace(hour=12, minute=0), $2, $3, 1)]"
}
f6ttl past 'NOW - m(30)' None
J=$(nx ro-a)
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 2/2 $T\"]" "F6 (TTL past): a2 waits on the Trickle"
ok "$(waiting)" '[["ro-a",1,"14:05","13:00"]]' "F6 (TTL past): an own record 30:00 old is dropped: since is now, served its stamp"
f6ttl future 'NOW + m(30)' None
nx ro-a >/dev/null
ok "$(waiting)" '[["ro-a",1,"14:05","13:00"]]' "F6 (TTL future): one 30:00 ahead is dropped the same way"
f6ttl control 'NOW - m(30) + s(1)' '"2026-10-02T13:30:00+00:00"'
nx ro-a >/dev/null
ok "$(waiting)" '[["ro-a",1,"12:00","13:30"]]' "F6 (TTL control): one 29:59 old is read: since and served (13:30, after a1's 13:00) carry"

# ── F7: failure handling ────────────────────────────────────────────────────────────────────────────────────────────
scen f7-dry-run
mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]'
before=$(sum1 "$(CF)")
J=$(nx ro-a --dry-run)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,[]]' "F7 (dry-run): --dry-run reads the record"
ok "$(sum1 "$(CF)")" "$before" "F7 (dry-run): … and leaves the file byte-identical"
scen f7-lock-held
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open
mkdir -p "$L"
python3 -c 'import fcntl, sys, time
fh = open(sys.argv[1], "a")
fcntl.flock(fh, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(120)' "$L/trickle.lock" "$L/ready" &
holder=$!; PIDS+=($holder)
for _ in $(seq 100); do [ -e "$L/ready" ] && break; sleep 0.1; done
J=$(THREAD_NOTE_LOCK_TIMEOUT=1 nx ro-a); rc=$?
ok "$rc" 0 "F7 (lock): a held lock: next exits 0"
ok "$(q "$J" '[d["start"], d["hold"][0]["reason"]]')" "[[],\"trickle: 2/2 $T\"]" "F7 (lock): … a3 waits on the Trickle"
ok "$(lines)" 1 "F7 (lock): … one stderr line"
starts "$(err)" "WARN: trickle claims $L/trickle.lock: " "F7 (lock): … the lock WARN"
ok "$(nofile)" none "F7 (lock): … and no waiting record is written"
kill "$holder"; wait "$holder" 2>/dev/null
scen f7-not-a-list
mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open
mkro ro-b 3; mkt b1 ro-b open
rawf '{"version": 1, "claims": [], "waiting": 5}'
J=$(nx ro-a --dry-run)
ok "$(q "$J" "$share")" '[{},2,["a2"]]' "F7 (not a list): a waiting that is no list reads as none"
ok "$(lines)" 0 "F7 (not a list): … with no WARN"
nx ro-a >/dev/null
ok "$(waiting)" '[]' "F7 (not a list): … and the next write replaces it with a list"
scen f7-p28-3-shape
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open
rawf '{"version": 1, "claims": [{"tasksDir": D, "rollout": "ro-x", "slug": "x1", "at": NOW.isoformat(timespec="seconds")}]}'
J=$(nx ro-a)
ok "$(q "$J" '[d["start"], d["trickle"]["elsewhere"]]')" '[[],{"ro-x":1}]' "F7 (p28-3 shape): a file with no waiting list reads fine"
ok "$(lines)" 0 "F7 (p28-3 shape): … with no WARN"
ok "$(fshape)" '[["version","claims","waiting"],1]' "F7 (p28-3 shape): … and is rewritten in the new shape at version 1"
ok "$(waiting)" '[["ro-a",1,"14:05","13:00"]]' "F7 (p28-3 shape): … holding ro-a's record"
scen f7-version-2
mkro ro-a 3; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open
rawf '{"version": 2, "claims": [], "waiting": []}'
before=$(sum1 "$(CF)")
nx ro-a >/dev/null
ok "$(err)" "WARN: trickle claims $(CF) version 2 — read as none, left for its writer" "F7 (version 2): the version WARN"
ok "$(sum1 "$(CF)")" "$before" "F7 (version 2): … and the file is left as it was"

# ── F8: a seeded revise contends in the fair share; a blocked row that is no revise does not ─────────────────────────
# f8 <name> <ro-b's served, a python expr>: ro-x runs x1 with no record (Mac 1/2); ro-b holds no place and waits for one
# with that served; ro-c (ceiling 2) is made by the caller. One place is free.
f8() {
  scen "f8-$1"; mkro ro-x 3; run1 x1 ro-x; mkro ro-b 3; mkt b1 ro-b open
  seedw '[]' "[w(D, 'ro-b', NOW - m(5), NOW - m(1), $2, 1)]"
  mkro ro-c 2
}
f8 no-revise '"2026-10-02T13:00:00+00:00"'; mkt c1 ro-c blocked 'owner: lead-c'
J=$(nx ro-c)
ok "$(q "$J" "$share")" '[{"ro-b":1},0,[]]' "F8: ro-c's only row blocked with no revise shape: it contends nothing, the place kept for ro-b"
ok "$(waiting)" '[["ro-b",1,"14:00","13:00"]]' "F8: … and ro-c records nothing"
f8 revise-first '"2026-10-02T13:00:00+00:00"'; rev1 c1 ro-c 3
J=$(nx ro-c)
ok "$(q "$J" "$share")" '[{},1,[]]' "F8 (revise): c1 owed a seeded revise is ro-c's demand: served 12:00 before ro-b's 13:00, it has the place"
ok "$(q "$J" '[d["halt"], [e["slug"] for e in d["setAside"]]]')" '["stuck",["c1"]]' \
  "F8 (revise): … still no row of next's (stuck: the lead's halt guard waits while step 1.2 launches it)"
ok "$(waiting)" '[["ro-b",1,"14:00","13:00"]]' "F8 (revise): … the revise has its place, so ro-c records nothing"
f8 revise-waits None; rev1 c1 ro-c 3
J=$(nx ro-c)
ok "$(q "$J" "$share")" '[{"ro-b":1},0,[]]' "F8 (revise waits): ro-b, never served, goes first: slotLimit 0"
ok "$(waiting)" '[["ro-b",1,"14:00",null],["ro-c",1,"14:05","12:00"]]' \
  "F8 (revise waits): … and ro-c records waiting for its revise (want 1, served 12:00 by c1's stamp)"
f8 rounds-spent '"2026-10-02T13:00:00+00:00"'; rev1 c1 ro-c 1
J=$(nx ro-c)
ok "$(q "$J" "$share")" '[{"ro-b":1},0,[]]' "F8 (rounds spent): max_review_rounds 1 = lastRound: no seeded revise, ro-c contends nothing"
ok "$(waiting)" '[["ro-b",1,"14:00","13:00"]]' "F8 (rounds spent): … and records nothing"
f8 pause '"2026-10-02T13:00:00+00:00"'; rev1 c1 ro-c 3; setfm ro-c 'parallel_ceiling: 2' $'parallel_ceiling: 2\npause_requested: true'
J=$(nx ro-c)
ok "$(q "$J" "$share")" '[{"ro-b":1},0,[]]' "F8 (pause): under a pause request step 1.2 launches no revise: ro-c contends nothing"
ok "$(waiting)" '[["ro-b",1,"14:00","13:00"]]' "F8 (pause): … and records nothing"
f8 main-red '"2026-10-02T13:00:00+00:00"'; rev1 c1 ro-c 3
printf '\n## Race log\n\n- 2026-10-02T10:00+00:00 [[c0]] revert did not land: conflict in a.py\n' >> "$D/ro-c.md"
J=$(nx ro-c)
ok "$(q "$J" "[d['halt'], $share]")" '["race",[{"ro-b":1},0,[]]]' "F8 (main red): step 1.1 halts before step 1.2: ro-c contends nothing"
ok "$(waiting)" '[["ro-b",1,"14:00","13:00"]]' "F8 (main red): … and records nothing"
scen f8-ceiling
mkro ro-b 3; run1 b1 ro-b
mkro ro-c 1; run1 c0 ro-c; rev1 c1 ro-c 3
J=$(nx ro-c)
ok "$(q "$J" '[d["slotLimit"], d["slotsInUse"], d["trickle"]["running"]]')" '[1,1,2]' "F8 (ceiling): ro-c (ceiling 1) runs c0: its revise waits on the ceiling"
ok "$(nofile)" none "F8 (ceiling): … which is never waited for: no record (no file written)"

# ── F9: the same share under the Away cap ───────────────────────────────────────────────────────────────────────────
scen f9-away
away_file "$D/home" "$HOUR_AGO" true "$TONIGHT" 2 09:00 3
mkro ro-a 4; run1 a1 ro-a; run1 a2 ro-a; mkt a3 ro-a open; mkt a4 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{"ro-b":1},2,[]]' "F9: Away cap 3, ro-a running 2: the third place is kept for ro-b"
ok "$(q "$J" "$holds")" "{\"a3\":\"away cap: 2/3 $T, 1 kept for [[ro-b]]\",\"a4\":\"away cap: 2/3 $T, 1 kept for [[ro-b]]\"}" \
  "F9: … the rows read the Away cap with the suffix"

# ── F10: the heat keeps a rollout's place in line and keeps nothing for anyone ──────────────────────────────────────
scen f10-heat
mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open
mkro ro-a 3; run1 a1 ro-a; mkt a2 ro-a open
J=$(THREAD_HEAT_LEVEL=2 nx ro-b)
ok "$(q "$J" "$holds")" '{"b1":"heat: the Mac is hot (heavy)","b2":"heat: the Mac is hot (heavy)"}' "F10: hot: ro-b's rows read heat:"
J=$(THREAD_HEAT_LEVEL=2 nx ro-a --now "$(at 1)")
ok "$(q "$J" "$share")" '[{},0,[]]' "F10: … ro-a, hot, keeps nothing and slotLimit is 0"
ok "$(q "$J" "$holds")" '{"a2":"heat: the Mac is hot (heavy)"}' "F10: … a2 reads heat: with no suffix"
THREAD_HEAT_LEVEL=2 nx ro-b --now "$(at 10)" >/dev/null
ok "$(waiting)" '[["ro-a",1,"14:06","13:00"],["ro-b",2,"14:05",null]]' "F10: … ro-b's record keeps its since through the hot spell"
J=$(nx ro-a --now "$(at 11)")
ok "$(q "$J" '[d["trickle"]["kept"], d["start"], d["hold"][0]["reason"]]')" \
  "[{\"ro-b\":1},[],\"trickle: 1/2 $T, 1 kept for [[ro-b]]\"]" "F10: cool again: the free place goes to ro-b"
J=$(nx ro-b --now "$(at 12)")
ok "$(q "$J" 'd["start"]')" '["b1"]' "F10: … and ro-b starts b1"

# ── F11: a rollout held only by the fair share never halts ───────────────────────────────────────────────────────────
scen f11-no-halt
mkro ro-x 3; run1 x1 ro-x
mkro ro-a 3; mkt a1 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]'
EV11="$D/events"
J=$(THREAD_EVENTS_DIR="$EV11" nx ro-a)
ok "$(q "$J" '[d["halt"], d["start"], d["hold"][0]["reason"]]')" "[null,[],\"trickle: 1/2 $T, 1 kept for [[ro-b]]\"]" \
  "F11: ro-a held only by the place kept for ro-b: halt null"
ok "$(python3 -c 'import json,sys; print(json.dumps([r["reason"] for r in map(json.loads, open(sys.argv[1])) if r["kind"] == "idle-slots"]))' "$EV11/ro-a.jsonl")" \
  '["hold-trickle"]' "F11: … and idle-slots records hold-trickle"

# ── F12: true concurrency: four leads at once, records seeded for ro-3 and ro-4 ──────────────────────────────────────
isnum() { case "$1" in [0-9]) echo json;; *) echo "$1";; esac; }   # one digit: a parsed len(start)
for k in 1 2 3 4 5; do
  scen "f12-run$k"
  for i in 1 2 3 4; do mkro "ro-$i" 2; mkt "t$i-x" "ro-$i" open; mkt "t$i-y" "ro-$i" open; done
  seedw '[]' '[w(D, "ro-3", NOW - m(5), NOW - m(1), None, 2), w(D, "ro-4", NOW - m(5), NOW - m(1), None, 2)]'
  pids=()
  for i in 1 2 3 4; do
    ( while [ ! -e "$D/go" ]; do sleep 0.01; done
      NXERR="$D/err-$i"; nx "ro-$i" --running "" >"$D/out-$i"; echo $? >"$D/rc-$i"
      python3 -c 'import json, os, re, sys
d, out, owner = sys.argv[1], sys.argv[2], sys.argv[3]
for slug in json.load(open(out))["start"]:
    p = os.path.join(d, slug + ".md")
    m = re.match(r"^---\n(.*?\n)---\n(.*)$", open(p).read(), re.S)
    fm = [("status: in_progress" if l.startswith("status:") else l) for l in m.group(1).rstrip("\n").split("\n")]
    with open(p + ".stamp.tmp", "w") as f:
        f.write("---\n" + "\n".join(fm + ["owner: " + owner]) + "\n---\n" + m.group(2))
    os.replace(p + ".stamp.tmp", p)' "$D" "$D/out-$i" "lead-$i"
      echo $? >"$D/stamp-rc-$i" ) &
    pids+=($!); PIDS+=($!)
  done
  touch "$D/go"
  wait "${pids[@]}"
  total=0; per=""
  for i in 1 2 3 4; do
    ok "$(cat "$D/rc-$i" 2>/dev/null)" 0 "F12 run $k: lead $i's next exits 0"
    ok "$(if [ -s "$D/err-$i" ]; then cat "$D/err-$i"; else echo empty; fi)" empty "F12 run $k: lead $i's stderr is empty"
    n=$(q "$(cat "$D/out-$i")" 'len(d["start"])')
    ok "$(isnum "$n")" json "F12 run $k: lead $i's output is one JSON object"
    ok "$(cat "$D/stamp-rc-$i" 2>/dev/null)" 0 "F12 run $k: lead $i's stamps land"
    [ "$(isnum "$n")" = json ] && total=$((total + n)) && per="$per$n"
  done
  ok "$total" 2 "F12 run $k: the four leads start exactly 2 tasks between them"
  ok "$per" 0011 "F12 run $k: … one each for ro-3 and ro-4, the waiting rollouts"
  ok "$(grep -l '^status: in_progress$' "$D"/*.md | wc -l | tr -d ' ')" 2 "F12 run $k: exactly 2 notes read in_progress"
done

# ── F13: a restart is exempt: it waits on the ceiling alone while a place is kept ───────────────────────────────────
scen f13-restart
mkro ro-a 2; run1 a1 ro-a; mkt a2 ro-a open
mkro ro-b 3; mkt b1 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), None, 1)]'
J=$(nx ro-a --running "")
ok "$(q "$J" '[d["restart"], d["start"], d["trickle"]["kept"], d["slotLimit"]]')" '[["a1"],[],{"ro-b":1},1]' \
  "F13: a1, stalled, restarts within the ceiling while the place is kept for ro-b"
ok "$(q "$J" "$holds")" "{\"a2\":\"trickle: 1/2 $T, 1 kept for [[ro-b]]\"}" "F13: … and a2 waits"

# ── F14: served survives a lost record, through the started: stamps ─────────────────────────────────────────────────
scen f14-served
away_file "$D/home" "$HOUR_AGO" false "$TONIGHT" 3
mkro ro-a 3; run1 a1 ro-a 'started: 2026-10-02T13:30+00:00'; mkt a2 ro-a open
mkro ro-b 3; run1 b1 ro-b; mkt b2 ro-b open
seedw '[]' '[w(D, "ro-b", NOW - m(5), NOW - m(1), "2026-10-02T13:00:00+00:00", 1)]'
J=$(nx ro-a)
ok "$(q "$J" "$share")" '[{"ro-b":1},1,[]]' "F14: ro-a, with no record, reads served 13:30 from a1's stamp: ro-b (13:00) goes first"
ok "$(waiting)" '[["ro-a",1,"14:05","13:30"],["ro-b",1,"14:00","13:00"]]' "F14: … and ro-a records served 13:30"

# ── F14b: a start no record saw still moves served (a call that could not take the lock writes none) ────────────────
# ro-w recorded never served at 14:05, then started w1 at 14:07 in a call that could not take the trickle claim lock, so
# no record was written. Its next record reads served 14:07 (its started: stamp, later than the carried null), so once
# w1 lands, ro-v (served 13:00) goes first, where a carried null would keep ro-w first ahead of every served waiter.
scen f14b-served-lock
mkro ro-x 3; run1 x1 ro-x; run1 x2 ro-x
mkro ro-v 3; mkt v1 ro-v open
mkro ro-w 3; mkt w1 ro-w open; mkt w2 ro-w open; mkt w3 ro-w open
seedw '[]' '[w(D, "ro-v", NOW - m(5), NOW - m(1), "2026-10-02T13:00:00+00:00", 1)]'
nx ro-w >/dev/null
ok "$(waiting)" '[["ro-v",1,"14:00","13:00"],["ro-w",3,"14:05",null]]' "F14b: ro-w at the Trickle records waiting, never served"
stamp x1 review
mkdir -p "$L"
python3 -c 'import fcntl, sys, time
fh = open(sys.argv[1], "a")
fcntl.flock(fh, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(120)' "$L/trickle.lock" "$L/ready" &
holder=$!; PIDS+=($holder)
for _ in $(seq 100); do [ -e "$L/ready" ] && break; sleep 0.1; done
J=$(THREAD_NOTE_LOCK_TIMEOUT=1 nx ro-w --now "$(at 2)")
ok "$(q "$J" 'd["start"]')" '["w1"]' "F14b: x1 lands; ro-w, never served, starts w1 in a call that cannot take the lock"
starts "$(err)" "WARN: trickle claims $L/trickle.lock: " "F14b: … the lock WARN"
ok "$(waiting)" '[["ro-v",1,"14:00","13:00"],["ro-w",3,"14:05",null]]' "F14b: … so no record moves: ro-w's still reads null"
kill "$holder"; wait "$holder" 2>/dev/null
stamp w1 in_progress lead-ro-w 2026-10-02T14:07+00:00
nx ro-w --now "$(at 5)" >/dev/null
ok "$(waiting)" '[["ro-v",1,"14:00","13:00"],["ro-w",2,"14:05","14:07"]]' \
  "F14b: ro-w's next record reads served 14:07, its w1 stamp, not the carried null"
stamp w1 review
J=$(nx ro-w --now "$(at 6)")
ok "$(q "$J" "$share")" '[{"ro-v":1},0,[]]' "F14b: w1 lands: ro-v (served 13:00) goes first, ahead of ro-w (14:07)"

# ── F15: a revise-only rollout gets in within the bound while two deep-queue rollouts refill (N = 2) ────────────────
# ro-r's only work is r1's seeded revise; ro-w1 runs one task with a deep queue; ro-w2 has never started and waits with
# a deep queue. Before p28-5's revise demand, ro-r wrote no record and kept nothing, so ro-w1 and ro-w2 took turns
# refilling every freed place and ro-r's tick read slotLimit 0 for as long as either queue lasted.
scen f15-revise
mkro ro-r 2; rev1 r1 ro-r 3
mkro ro-w1 2; run1 w1a ro-w1; for x in b c d e f; do mkt "w1$x" ro-w1 open; done
mkro ro-w2 2; for x in a b c d e f; do mkt "w2$x" ro-w2 open; done
seedw '[]' '[w(D, "ro-w2", NOW - m(5), NOW - m(1), None, 2)]'
J=$(nx ro-r)
ok "$(q "$J" "$share")" '[{"ro-w2":1},0,[]]' "F15: 14:05 ro-r: one place free, kept for never-served ro-w2"
ok "$(q "$J" '[d["halt"], [e["slug"] for e in d["setAside"]]]')" '["stuck",["r1"]]' "F15: … r1 set aside, stuck (the lead's halt guard waits)"
ok "$(waiting)" '[["ro-r",1,"14:05","12:00"],["ro-w2",2,"14:00",null]]' "F15: … and ro-r records waiting for its revise"
J=$(nx ro-w2 --now "$(at 1)")
ok "$(q "$J" 'd["start"]')" '["w2a"]' "F15: 14:06 ro-w2's tick starts w2a: the one freed place ro-r is passed over by (bound R - 1 = 2)"
under "$J" 2 "F15: ro-w2's start"
stamp w2a in_progress lead-ro-w2 2026-10-02T14:06+00:00
stamp w1a review
J=$(nx ro-w1 --now "$(at 5)")
ok "$(q "$J" "$share")" '[{"ro-r":1},0,[]]' "F15: 14:10 w1a lands: ro-w1 (served 13:00) keeps the place for ro-r (12:00), no refill"
ok "$(q "$J" 'd["hold"][0]["reason"]')" "\"trickle: 1/2 $T, 1 kept for [[ro-r]]\"" "F15: … its rows read the place kept for ro-r"
J=$(nx ro-w2 --now "$(at 6)")
ok "$(q "$J" "$share")" '[{"ro-r":1},1,[]]' "F15: 14:11 ro-w2 (holding 1) re-runs: the place stays kept for ro-r"
J=$(nx ro-r --now "$(at 20)")
ok "$(q "$J" "$share")" '[{},1,[]]' "F15: 14:25 ro-r's next tick: slotLimit 1, so step 1.2 launches r1's revise (15 minutes after the place freed)"
ok "$(waiting)" '[["ro-w1",2,"14:10","13:00"],["ro-w2",1,"14:00","14:06"]]' "F15: … and ro-r's record goes (its revise has its place)"
stamp r1 in_progress
J=$(nx ro-r --now "$(at 20)" --running r1)
ok "$(q "$J" '[d["running"], d["slotsInUse"]]')" '[["r1"],1]' "F15: the revise runs (step 1.2 re-runs next)"
under "$J" 2 "F15: ro-r's revise"
J=$(nx ro-w1 --now "$(at 21)")
ok "$(q "$J" '[d["start"], d["trickle"]["running"]]')" '[[],2]' "F15: 14:26 ro-w1 finds the Mac at 2/2: nothing starts"
under "$J" 2 "F15: ro-w1's next"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
