#!/usr/bin/env bash
# p28-3: the Trickle claim (skills/execute/away.md § The Trickle, *Trickle claims*). Off --dry-run `next` takes the
# machine-wide trickle claim lock (trickle.lock in the note-lock dir), walks --tasks-dir afresh, counts every other
# lead's live claims beside the notes, and records one claim per start in trickle-claims.json beside the lock, so two
# leads never both start into one free place in the Trickle. A task's § 4 stamp consumes its claim once the note-based
# count counts the task; a claim no stamp consumes lapses 20 minutes after its `at`. --dry-run reads claims, takes no
# lock and writes nothing.
#
# Why each scenario pins its own lock dir ($L, R7): tests/run.sh shares one THREAD_NOTE_LOCK_DIR across every suite, and
# every `next` off --dry-run prunes the claims of other tasks dirs by the real clock, so a claim this suite reads across
# calls must live in a dir no other suite (and no other scenario here) writes. The suite-wide export below is only the
# backstop. HOME is pinned per scenario with no away file, so the Trickle is 2. Temp notes only.
# Usage: bash reconcile-rollout-trickle-claim.test.sh   (exit 0 = pass)
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
CF() { echo "$L/trickle-claims.json"; }
nofile() { if [ -e "$(CF)" ]; then echo "file"; else echo "none"; fi; }
sum1() { if [ -e "$1" ]; then cksum < "$1" | tr -d ' \t'; else echo none; fi; }

# stamp <slug> [status|-] [owner] — rewrite a task note's `status:` (unless "-") and `owner:` (when given) through a
# temp file and os.replace, as an Edit-tool or Obsidian save lands (whole, never torn).
STAMP_PY='import os, re, sys
p, st, owner = sys.argv[1], sys.argv[2], sys.argv[3]
m = re.match(r"^---\n(.*?\n)---\n(.*)$", open(p).read(), re.S)
fm = m.group(1).rstrip("\n").split("\n")
if st != "-":
    fm = [("status: " + st) if l.startswith("status:") else l for l in fm]
if owner:
    fm = [l for l in fm if not l.startswith("owner:")] + ["owner: " + owner]
tmp = p + ".stamp.tmp"
with open(tmp, "w") as f:
    f.write("---\n" + "\n".join(fm) + "\n---\n" + m.group(2))
os.replace(tmp, p)'
stamp() { python3 -c "$STAMP_PY" "$D/$1.md" "${2:-in_progress}" "${3:-}"; }
# seed <python list expression> — write $L/trickle-claims.json as {"version": 1, "claims": <expr>}. In the expression:
# D is this tasks dir's realpath, NOW the suite's --now and WALL the real clock (both aware datetimes), m(n) n minutes,
# s(n) n seconds, and c(tasksDir, rollout, slug, at) one entry with `at` to the second.
SEED_PY='import json, os, sys
from datetime import datetime, timedelta, timezone
D = os.path.realpath(sys.argv[2])
NOW = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00"))
WALL = datetime.now(timezone.utc)
m = lambda n: timedelta(minutes=n)
s = lambda n: timedelta(seconds=n)
c = lambda td, ro, slug, at: {"tasksDir": td, "rollout": ro, "slug": slug, "at": at.isoformat(timespec="seconds")}
claims = eval(sys.argv[4])
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
with open(sys.argv[1], "w") as f:
    json.dump({"version": 1, "claims": claims}, f)'
seed() { python3 -c "$SEED_PY" "$(CF)" "$D" "$NOW" "$1"; }
# claims [all] — the claims file's entries as sorted compact JSON: [[rollout, slug], …] for this tasks dir, or with
# `all` [[where, rollout, slug], …] for every entry, where "here" or the entry's tasksDir; a malformed entry reads
# ["malformed", <repr>]. "none" with no file, "unreadable" when it is not JSON.
CLAIMS_PY='import json, os, sys
p, here, every = sys.argv[1], os.path.realpath(sys.argv[2]), sys.argv[3] == "all"
if not os.path.exists(p):
    print("none"); sys.exit(0)
try:
    d = json.load(open(p, encoding="utf-8"))
except ValueError:
    print("unreadable"); sys.exit(0)
out = []
for e in d["claims"]:
    if not isinstance(e, dict) or not all(k in e for k in ("tasksDir", "rollout", "slug")):
        out.append(["malformed", repr(e)]); continue
    if every:
        out.append(["here" if e["tasksDir"] == here else e["tasksDir"], e["rollout"], e["slug"]])
    elif e["tasksDir"] == here:
        out.append([e["rollout"], e["slug"]])
print(json.dumps(sorted(out), separators=(",", ":")))'
claims() { python3 -c "$CLAIMS_PY" "$(CF)" "$D" "${1:-}"; }
# Two rollouts, each ceiling 3 with three queued tasks: the task's first fixture.
ab() { mkro ro-a 3; mkt a1 ro-a open; mkt a2 ro-a open; mkt a3 ro-a open
       mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open; mkt b3 ro-b open; }
T22='trickle: 2/2 tasks running on this Mac'

# ── C1, the failing-first interleaving: lead A's next returns, lead B's next runs before A stamps anything ────────────
scen c1-interleave
ab
J=$(nx ro-a); rc=$?
ok "$rc" 0 "C1: ro-a's next exits 0"
ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C1: ro-a starts a1 and a2 (the Trickle's two)"
ok "$(claims)" '[["ro-a","a1"],["ro-a","a2"]]' "C1: … and claims both"
J=$(nx ro-b); rc=$?
ok "$rc" 0 "C1: ro-b's next exits 0"
ok "$(q "$J" 'd["start"]')" '[]' "C1: ro-b starts nothing: ro-a's unstamped starts hold the Trickle"
ok "$(q "$J" "$holds")" "{\"b1\":\"$T22\",\"b2\":\"$T22\",\"b3\":\"$T22\"}" "C1: b1, b2 and b3 are held on the Trickle"
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["trickle"]["running"], d["halt"]]')" '[{"ro-a":2},2,null]' \
  "C1: trickle.elsewhere counts ro-a's two claims, running 2, halt null"
ok "$(lines)" 0 "C1: no stderr"

# ── C2: the § 4 stamp consumes the claim, never dropping it and never counting a task twice ──────────────────────────
stamp a1 in_progress lead-a
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "C2: a1 stamped: a1 by its note, a2 by its claim"
stamp a2 in_progress lead-a
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "C2: a2 stamped too: both by their notes"
ok "$(claims)" '[]' "C2: both claims are consumed at the next write"
scen c2b-status-first
ab
nx ro-a >/dev/null
stamp a1 in_progress
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' \
  "C2b: a status-only stamp (ro-a never started, no owner anywhere) keeps a1's claim counting"
stamp a1 - lead-a
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "C2b: … the owner then lands: still 2, never 3"
scen c2c-owner-first
ab
nx ro-a >/dev/null
stamp a1 - lead-a
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "C2c: owner first, status still open: still 2"

# ── C3: a crashed claim expires 20 minutes after its at, to the second ───────────────────────────────────────────────
scen c3-expiry
ab
nx ro-a >/dev/null
stamp a1 in_progress lead-a
J=$(nx ro-b --now 2026-10-02T14:24:59Z)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "C3: at 19:59 a2's claim still counts"
J=$(nx ro-b --now 2026-10-02T14:25:00Z)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":1},["b1"]]' "C3: at 20:00 it has lapsed: b1 starts"

# ── C4: a rollout's own claims never count against it, and each call replaces them ──────────────────────────────────
scen c4-own
ab
J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C4: ro-a starts a1 and a2"
J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C4: … and again (its own claims never count against it)"
ok "$(claims)" '[["ro-a","a1"],["ro-a","a2"]]' "C4: the claims read exactly a1 and a2"
stamp a1 done
J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '["a2","a3"]' "C4: a1 done: ro-a starts a2 and a3"
ok "$(claims)" '[["ro-a","a2"],["ro-a","a3"]]' "C4: … and its claims are rewritten to exactly those"

# ── C5: --dry-run reads claims, takes no lock and writes nothing ─────────────────────────────────────────────────────
scen c5-dry-run
ab
J=$(nx ro-a --dry-run)
ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C5: ro-a --dry-run starts a1 and a2"
ok "$(ls -A "$L" 2>/dev/null | wc -l | tr -d ' ')" 0 "C5: … and leaves no file in the lock dir"
J=$(nx ro-b); ok "$(q "$J" 'd["start"]')" '["b1","b2"]' "C5: ro-b starts b1 and b2"
before=$(sum1 "$(CF)")
J=$(nx ro-a --dry-run)
ok "$(q "$J" '[d["start"], d["trickle"]["elsewhere"]]')" '[[],{"ro-b":2}]' "C5: ro-a --dry-run now counts ro-b's claims"
ok "$(sum1 "$(CF)")" "$before" "C5: … and the claims file is byte-identical"

isnum() { case "$1" in [0-9]) echo json;; *) echo "$1";; esac; }   # one digit: a parsed len(start)
# ── C6: true concurrency, the task's Verify: four leads' next + stamp at once never take the Mac past the Trickle ────
for k in 1 2 3 4 5; do
  scen "c6-run$k"
  for i in 1 2 3 4; do mkro "ro-$i" 2; mkt "t$i-x" "ro-$i" open; mkt "t$i-y" "ro-$i" open; done
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
  total=0
  for i in 1 2 3 4; do
    ok "$(cat "$D/rc-$i" 2>/dev/null)" 0 "C6 run $k: lead $i's next exits 0"
    ok "$(if [ -s "$D/err-$i" ]; then cat "$D/err-$i"; else echo empty; fi)" empty "C6 run $k: lead $i's stderr is empty"
    n=$(q "$(cat "$D/out-$i")" 'len(d["start"])')
    ok "$(isnum "$n")" json "C6 run $k: lead $i's output is one JSON object"
    ok "$(cat "$D/stamp-rc-$i" 2>/dev/null)" 0 "C6 run $k: lead $i's stamps land"
    [ "$(isnum "$n")" = json ] && total=$((total + n))
  done
  ok "$total" 2 "C6 run $k: the four leads start exactly 2 tasks between them"
  ok "$(grep -l '^status: in_progress$' "$D"/*.md | wc -l | tr -d ' ')" 2 "C6 run $k: exactly 2 notes read in_progress"
done

# ── C7: a held lock fails open: one WARN, the count without the lock, nothing claimed ────────────────────────────────
scen c7-lock-held
ab
mkdir -p "$L"
python3 -c 'import fcntl, sys, time
fh = open(sys.argv[1], "a")
fcntl.flock(fh, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(120)' "$L/trickle.lock" "$L/ready" &
holder=$!; PIDS+=($holder)
for _ in $(seq 100); do [ -e "$L/ready" ] && break; sleep 0.1; done
J=$(THREAD_NOTE_LOCK_TIMEOUT=1 nx ro-a); rc=$?
ok "$rc" 0 "C7: a held lock: next still exits 0"
ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C7: … starts a1 and a2 from the count without the lock"
ok "$(lines)" 1 "C7: … prints exactly one stderr line"
starts "$(err)" "WARN: trickle claims $L/trickle.lock: " "C7: … a WARN naming the lock"
has "$(err)" "— counted without the lock; this call's starts are not claimed" "C7: … that says it counted without the lock"
ok "$(nofile)" none "C7: … and writes no claims file"
kill "$holder"; wait "$holder" 2>/dev/null
J=$(nx ro-a)
ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C7: the lock freed, ro-a starts a1 and a2"
ok "$(claims)" '[["ro-a","a1"],["ro-a","a2"]]' "C7: … and claims them"
ok "$(lines)" 0 "C7: … with empty stderr"

# ── C8: an unreadable claims file reads as none with one WARN; another version is left for its writer ────────────────
WU="WARN: trickle claims"
scen c8a-garbage
ab
mkdir -p "$L"; printf '\377\376 not json' > "$(CF)"
before=$(sum1 "$(CF)")
J=$(nx ro-b --dry-run)
ok "$(q "$J" 'd["start"]')" '["b1","b2"]' "C8 (a): garbage bytes read as no claims"
ok "$(lines)" 1 "C8 (a): … one stderr line, --dry-run included"
starts "$(err)" "$WU $(CF) unreadable: " "C8 (a): … the unreadable WARN"
has "$(err)" "— read as none" "C8 (a): … saying how it reads"
ok "$(sum1 "$(CF)")" "$before" "C8 (a): … and --dry-run leaves the file as it was"
J=$(nx ro-b)
ok "$(lines)" 1 "C8 (a): off --dry-run, one WARN"
ok "$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$(CF)" 2>/dev/null)" 1 \
  "C8 (a): … and the file is replaced by a valid version-1 file"
ok "$(claims)" '[["ro-b","b1"],["ro-b","b2"]]' "C8 (a): … holding ro-b's claims"
scen c8b-oversize
ab
seed '[c(D, "ro-a", "a1", NOW)] + [c("/pad", "ro-pad", "p%d" % i, NOW) for i in range(5000)]'
ok "$([ "$(wc -c < "$(CF)")" -gt 262144 ] && echo over)" over "C8 (b): the seeded file is over 256 KiB"
J=$(nx ro-b --dry-run)
ok "$(q "$J" '[d["start"], d["trickle"]["elsewhere"]]')" '[["b1","b2"],{}]' "C8 (b): valid JSON over 256 KiB reads as none"
ok "$(lines)" 1 "C8 (b): … one stderr line"
starts "$(err)" "$WU $(CF) unreadable: " "C8 (b): … the unreadable WARN"
scen c8c-version
ab
mkdir -p "$L"
python3 -c 'import json, sys; json.dump({"version": 2, "claims": [{"tasksDir": sys.argv[2], "rollout": "ro-a", "slug": "a1", "at": "2026-10-02T14:05:00+00:00"}]}, open(sys.argv[1], "w"))' \
  "$(CF)" "$D"
before=$(sum1 "$(CF)")
J=$(nx ro-b)
ok "$(q "$J" 'd["start"]')" '["b1","b2"]' "C8 (c): a version-2 file reads as none (its live ro-a claim uncounted)"
ok "$(lines)" 1 "C8 (c): … one stderr line"
ok "$(err)" "$WU $(CF) version 2 — read as none, left for its writer" "C8 (c): … the version WARN"
ok "$(sum1 "$(CF)")" "$before" "C8 (c): … and an off---dry-run call leaves it byte-identical"

# ── C9: scoping: what a claim counts for, and what each write keeps ──────────────────────────────────────────────────
# c9 <name>: a fresh scenario with ro-b (ceiling 3, b1-b3 queued); the sub-case adds the rest and seeds one claim at NOW.
c9() { scen "c9$1"; mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open; mkt b3 ro-b open; }
cnt() { q "$(nx ro-b --dry-run)" '[d["trickle"]["elsewhere"], d["start"]]'; }
c9 a-other-dir
mkro ro-a 3; mkt a1 ro-a open
mkdir -p "$TMP/elsewhere"
seed "[c(os.path.realpath('$TMP/elsewhere'), 'ro-a', 'a1', NOW)]"
ok "$(cnt)" '[{},["b1","b2"]]' "C9 (a): a claim for another tasks dir never counts here"
c9 b-carried
mkro ro-a 3; mkro ro-c 3; mkt a1 ro-c open
seed '[c(D, "ro-a", "a1", NOW)]'
ok "$(cnt)" '[{},["b1","b2"]]' "C9 (b): a claim whose task now names another rollout counts nothing"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-b","b1"],["ro-b","b2"]]' "C9 (b): … and goes at the next write"
c9 c-task-missing
mkro ro-a 3; mkt a1 ro-a open
seed '[c(D, "ro-a", "a9", NOW)]'
ok "$(cnt)" '[{"ro-a":1},["b1"]]' "C9 (c): a claim whose task note is missing from the walk still counts"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-a","a9"],["ro-b","b1"]]' "C9 (c): … and is kept"
c9 d-rollout-missing
seed '[c(D, "ro-gone", "g1", NOW)]'
ok "$(cnt)" '[{"ro-gone":1},["b1"]]' "C9 (d): a claim whose rollout note is missing counts under the stem it recorded"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-b","b1"],["ro-gone","g1"]]' "C9 (d): … and is kept until it expires"
c9 e-rollout-torn
mkro ro-a 3; mkt a1 ro-a open; mkt a2 ro-a open; mkt a3 ro-a open
J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C9 (e): ro-a claims a1 and a2"
cp "$D/ro-a.md" "$D/ro-a.whole"
python3 -c 'import os, sys; p = sys.argv[1]; t = "".join(open(p).readlines()[:3]); open(p + ".tmp", "w").write(t); os.replace(p + ".tmp", p)' "$D/ro-a.md"
ok "$(head -c 4 "$D/ro-a.md"; wc -l < "$D/ro-a.md" | tr -d ' ')" '---
3' "C9 (e): ro-a.md is torn inside its frontmatter (3 lines, no closing ---)"
ok "$(cnt)" '[{"ro-a":2},[]]' "C9 (e): a torn rollout note's claims still count"
J=$(nx ro-b); ok "$(q "$J" 'd["start"]')" '[]' "C9 (e): … off --dry-run too"
ok "$(claims)" '[["ro-a","a1"],["ro-a","a2"]]' "C9 (e): … and the write keeps them"
python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$D/ro-a.whole" "$D/ro-a.md"
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":2},[]]' "C9 (e): ro-a.md restored: still 2"
c9 f-rollout-closed
mkro ro-c 3 ; mkt c1 ro-c open
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("\nstatus: open\n", "\nstatus: done\n", 1))' "$D/ro-c.md"
seed '[c(D, "ro-c", "c1", NOW)]'
ok "$(cnt)" '[{},["b1","b2"]]' "C9 (f): a claim of a closed rollout counts nothing"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-b","b1"],["ro-b","b2"]]' "C9 (f): … and goes at the next write"
c9 g-rollout-archived
mkro ro-c 3; mkt c1 ro-c open
mkdir -p "$D/Archive"; mv "$D/ro-c.md" "$D/Archive/ro-c.md"
seed '[c(D, "ro-c", "c1", NOW)]'
ok "$(cnt)" '[{},["b1","b2"]]' "C9 (g): a claim of a rollout under Archive/ counts nothing"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-b","b1"],["ro-b","b2"]]' "C9 (g): … and goes at the next write"
c9 h-task-blocked
mkro ro-a 3; mkt a1 ro-a blocked
seed '[c(D, "ro-a", "a1", NOW)]'
ok "$(cnt)" '[{},["b1","b2"]]' "C9 (h): a claim whose task left the queue another way (blocked) counts nothing"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-b","b1"],["ro-b","b2"]]' "C9 (h): … and goes at the next write"
c9 i-rollout-paused
mkro ro-a 3 "paused: 2026-10-02T14:05+00:00"; mkt a1 ro-a open
seed '[c(D, "ro-a", "a1", NOW)]'
ok "$(cnt)" '[{},["b1","b2"]]' "C9 (i): a claim of a paused rollout counts nothing"
nx ro-b >/dev/null
ok "$(claims)" '[["ro-b","b1"],["ro-b","b2"]]' "C9 (i): … and goes at the next write"

# ── C10: a call that starts nothing (git-env, pause, a rollout hold, the heat) clears its rollout's claims ───────────
c10() {  # c10 <name>: ro-a claims a1 and a2; the caller then changes ro-a and runs it again
  scen "c10$1"; ab
  J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '["a1","a2"]' "C10 ($1): ro-a claims a1 and a2"
}
c10_after() {  # c10_after <label>: ro-a's entries are gone, and ro-b starts into the room
  ok "$(claims)" '[]' "C10 ($1): ro-a's call leaves no ro-a entry"
  J=$(nx ro-b); ok "$(q "$J" 'd["start"]')" '["b1","b2"]' "C10 ($1): … so ro-b starts b1 and b2"
}
c10 a-git-env
printf '\n## Git-env log\n\n- 2026-10-02T10:00+00:00 git-env trip [[a1]] task: refs/heads/main a->b; repo /x\n' >> "$D/ro-a.md"
J=$(nx ro-a); ok "$(q "$J" '[d["halt"], d["start"]]')" '["git-env",[]]' "C10 (a-git-env): a git-env trip halts git-env"
c10_after a-git-env
c10 b-pause
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("parallel_ceiling: 3\n", "parallel_ceiling: 3\npause_requested: true\n", 1))' "$D/ro-a.md"
J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '[]' "C10 (b-pause): pause_requested starts nothing"
c10_after b-pause
c10 c-hold
mkdir -p "$D/bin"
printf '#!/usr/bin/env bash\necho %s\n' "'{\"state\":\"OPEN\",\"mergedAt\":null,\"url\":\"https://github.com/o/r/pull/202\"}'" > "$D/bin/gh"
chmod +x "$D/bin/gh"
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("parallel_ceiling: 3\n", "parallel_ceiling: 3\nhold_until: {pr: o/r#202}\n", 1))' "$D/ro-a.md"
J=$(nx ro-a --gh-bin "$D/bin/gh"); ok "$(q "$J" '[d["halt"], d["start"]]')" '["held",[]]' "C10 (c-hold): an OPEN rollout hold starts nothing"
c10_after c-hold
c10 d-heat
J=$(THREAD_HEAT_LEVEL=3 nx ro-a); ok "$(q "$J" '[d["heat"]["level"], d["start"]]')" '[3,[]]' "C10 (d-heat): a hot Mac starts nothing"
c10_after d-heat

# ── C11: each write prunes: another dir's expired entries (by the real clock), malformed, consumed and expired ones ──
scen c11-prune
mkro ro-a 3; mkt a1 ro-a in_progress 'owner: lead-a'; mkt a2 ro-a open
mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open; mkt b3 ro-b open
seed '[c("/other/tasks", "ro-x", "x1", WALL - m(21)), c("/other/tasks", "ro-y", "y1", WALL - m(1)),
       {"tasksDir": D, "rollout": "ro-a", "at": NOW.isoformat()}, 42,
       c(D, "ro-a", "a1", NOW), c(D, "ro-a", "a2", NOW - m(20))]'
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":1},["b1"]]' \
  "C11: a1 counts once (its note; its claim consumed), a2's expired claim not at all"
ok "$(lines)" 0 "C11: … with empty stderr"
ok "$(claims all)" '[["/other/tasks","ro-y","y1"],["here","ro-b","b1"]]' \
  "C11: the file keeps only another dir's live entry and ro-b's new claim"

# ── C12: a failed rollout-note save claims nothing ───────────────────────────────────────────────────────────────────
scen c12-failed-save
ab
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("parallel_ceiling: 3\n", "parallel_ceiling: 3\nstart: unattended\n", 1))' "$D/ro-a.md"
chmod 444 "$D/ro-a.md"
J=$(nx ro-a); rc=$?
chmod 644 "$D/ro-a.md"
ok "$rc" 1 "C12: a read-only rollout note with start: unattended exits 1"
ok "$(claims)" none "C12: … and claims nothing (no claims file at all)"
J=$(nx ro-a); rc=$?
ok "$rc" 0 "C12: writable again: exit 0"
ok "$(q "$J" '[d["startCleared"], d["start"]]')" '[true,["a1","a2"]]' "C12: … the stamp clears and a1 and a2 start"
ok "$(claims)" '[["ro-a","a1"],["ro-a","a2"]]' "C12: … and are claimed"

# ── C13: the head Solo task's lone start is claimed too ──────────────────────────────────────────────────────────────
scen c13-solo
mkro ro-a 3; mkt s1 ro-a open 'solo: true'
mkro ro-b 3; mkt b1 ro-b open; mkt b2 ro-b open; mkt b3 ro-b open
J=$(nx ro-a); ok "$(q "$J" 'd["start"]')" '["s1"]' "C13: ro-a starts its head Solo task s1"
J=$(nx ro-b)
ok "$(q "$J" '[d["trickle"]["elsewhere"], d["start"]]')" '[{"ro-a":1},["b1"]]' "C13: ro-b counts s1's claim: b1 starts alone"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
