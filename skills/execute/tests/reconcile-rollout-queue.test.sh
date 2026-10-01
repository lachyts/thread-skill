#!/usr/bin/env bash
# The queue side of reconcile-rollout.py (ADR 0030 decisions 1 and 4, and its no-cursor consequence):
# `next` (which tasks start), the per-task `started:` / `merged:` / `integrating:` / `ready:` stamps, `status`
# (queue states, the timeline and the progress line) and `resume` (a merged PR whose note was never
# marked, p6-8) against a stub gh. Temp notes only; no vault, no network.
# Usage: bash reconcile-rollout-queue.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"   # physical: the stub gh logs the cwd gh ran in (macOS /var -> /private/var)
trap 'rm -rf "$TMP"' EXIT
NOW=2026-10-02T14:05:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/repo"; echo "== $1"; }
# mkro <body> [frontmatter lines...] — the rollout note $D/ro.md; <body> is its schedule order and blocks.
mkro() {
  local body="$1"; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 3\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n%s\n' "$D/repo" "$body"; } > "$D/ro.md"
}
# mkt <slug> <status|-> [frontmatter lines...] — a task note linked to ro ("-" writes no status line).
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\n'
    [ "$st" = "-" ] || printf 'status: %s\n' "$st"
    printf 'rollout: "[[ro]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
# setkey <slug> <key> <value> — replace or add one frontmatter line; delkey <slug> <key> removes it.
setkey() {
  python3 - "$D/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
head, rest = t.split("\n---\n", 1)
lines = head.split("\n")
new = f"{k}: {v}"
for i, l in enumerate(lines):
    if re.match(rf"^{re.escape(k)}:", l):
        lines[i] = new
        break
else:
    lines.append(new)
open(p, "w").write("\n".join(lines) + "\n---\n" + rest)
PY
}
delkey() { python3 - "$D/$1.md" "$2" <<'PY'
import re, sys
p, k = sys.argv[1:]
t = open(p).read()
head, rest = t.split("\n---\n", 1)
head = "\n".join(l for l in head.split("\n") if not re.match(rf"^{re.escape(k)}:", l))
open(p, "w").write(head + "\n---\n" + rest)
PY
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }   # fm <slug> <key> — the frontmatter line
nxt() { python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" "$@"; }
st() { python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "${2:-$NOW}"; }
# q <json> <python-expr over d> — compact JSON of the expression
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
holds='{h["slug"]: h["reason"] for h in d["hold"]}'

# ── dependency wait ──────────────────────────────────────────────────────────────────────────────
scen dep-wait
mkro $'- [[a]]\n- [[b]]'
mkt a open
mkt b open 'depends-on:' '  - "[[a]]"'
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a"]' "next: dependency wait starts only the free task"
ok "$(q "$J" "$holds")" '{"b":"depends on [[a]] (open)"}' "next: the dependant is held on its open dependency"
ok "$(q "$J" 'd["halt"]')" 'null' "next: no halt while something starts"
setkey a status done
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["b"]' "next: once the dependency is done the dependant starts"

# ── a set-aside task frees its slot; its dependants wait ─────────────────────────────────────────
scen set-aside
mkro $'- [[a]]\n- [[b]]\n- [[c]]' 'parallel_ceiling: 1'
mkt a blocked
mkt b open 'depends-on: ["[[a]]"]'
mkt c open
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["c"]' "next: a set-aside task frees its slot (ceiling 1, c starts)"
ok "$(q "$J" "$holds")" '{"b":"depends on [[a]] (blocked)"}' "next: the set-aside task's dependant waits"
ok "$(q "$J" 'd["setAside"]')" '[{"setAsideAt":"run","slug":"a","status":"blocked"}]' "next: the set-aside list names it"
ok "$(q "$J" 'd["slotsInUse"]')" '0' "next: a set-aside task holds no slot"

# ── dependencies outside the rollout, archived notes and the root-copy preference ────────────────
scen outside
mkro $'- [[b]]\n- [[c]]\n- [[e]]'
mkdir -p "$D/Archive/2026"
printf -- '---\ntags: [task]\nstatus: done\n---\n\nx\n' > "$D/Archive/2026/x.md"
printf -- '---\ntags: [task]\nstatus: open\n---\n\ny root\n' > "$D/y.md"
printf -- '---\ntags: [task]\nstatus: done\n---\n\ny archived\n' > "$D/Archive/2026/y.md"
mkt b open 'blocked-by: x'
mkt c open 'blocked-by: "[[y]]"'
mkt e open 'depends-on: [x, "[[y]]"]'
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["b"]' "next: a dependency on an archived done note outside the rollout is satisfied"
ok "$(q "$J" "$holds")" '{"c":"depends on [[y]] (open)","e":"depends on [[y]] (open)"}' "next: the root copy wins over an archived one (a mixed inline list too)"

# ── a dependency link with a heading or block anchor names its note ──────────────────────────────
scen dep-anchor
mkro $'- [[a]]\n- [[b]]\n- [[c]]\n- [[d]]\n- [[e]]'
mkt a done; mkt e open
mkt b open 'depends-on:' '  - "[[a#Notes]]"'
mkt c open 'blocked-by: "[[a#^blk|alias]]"'
mkt d open 'depends-on: [[e#Plan (round 1)]]'
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["b","c","e"]' "next: [[a#Notes]] and [[a#^blk|alias]] resolve to a (done)"
ok "$(q "$J" "$holds")" '{"d":"depends on [[e]] (open)"}' "next: [[e#Plan (round 1)]] waits on e, not on a missing note"

# ── affine tombstones ────────────────────────────────────────────────────────────────────────────
scen tombstone
mkro $'- [[u]]\n- [[b]]\n- [[b2]]\n- [[b3]]'
mkt t merged 'merged_into: "[[u]]"'
mkt u open
mkt b open 'depends-on:' '  - t'
printf -- '---\ntags: [task]\nstatus: merged\nmerged_into: "[[gone]]"\n---\n\nt2\n' > "$D/t2.md"
mkt b2 open 'depends-on: [[t2]]'
mkt b3 open 'depends-on: [missing-note]'
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["u"]' "next: the combined unit starts"
ok "$(q "$J" "$holds")" '{"b":"depends on [[t]] (folded into [[u]] (open))","b2":"depends on [[t2]] (folded into [[gone]] (note not found))","b3":"depends on [[missing-note]] (note not found)"}' \
  "next: a tombstone dependency waits for its unit; a missing target or note holds"
setkey u status done
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["b"]' "next: once the combined unit is done the tombstone's dependant starts"
J=$(st)
ok "$(q "$J" '[d["counts"]["folded"], d["counts"]["total"]]')" '[1,4]' "status: a linked tombstone is folded, outside N"

# ── the parallel ceiling ─────────────────────────────────────────────────────────────────────────
scen ceiling
mkro $'- [[a]]\n- [[b]]\n- [[c]]\n- [[d]]' 'parallel_ceiling: 2'
mkt a open; mkt b open; mkt c open; mkt d open
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a","b"]' "next: ceiling 2 starts two"
ok "$(q "$J" "$holds")" '{"c":"ceiling: 2/2 slots in use","d":"ceiling: 2/2 slots in use"}' "next: the rest are held for the ceiling"
setkey a status in_progress
J=$(nxt)
ok "$(q "$J" '[d["start"], d["running"], d["slotsInUse"]]')" '[["b"],["a"],1]' "next: one in_progress task leaves one slot"
mkro $'- [[a]]\n- [[b]]\n- [[c]]\n- [[d]]' 'parallel_ceiling: 0'
python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" >/dev/null 2>"$D/err"; rc=$?
ok "$rc" 1 "next: parallel_ceiling 0 is an error (exit 1)"
has "$(cat "$D/err")" "parallel_ceiling" "next: the error names parallel_ceiling"

# ── a priority change between calls reorders the live queue ──────────────────────────────────────
scen priority
mkro $'- [[p]]\n- [[q]]' 'parallel_ceiling: 1'
mkt p open 'priority: normal'
mkt q open 'priority: low  # not urgent'
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["p"]' "next: schedule order breaks a priority tie (p first)"
setkey q priority high
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["q"]' "next: q edited to priority high starts first on the next call"
setkey q priority medium
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["p"]' "next: medium reads as normal"

# ── schedule rank: list items and table rows rank, prose never does ──────────────────────────────
# The template's wave table escapes its alias pipe (`[[slug\|alias]]`), and a lead's note can mention a
# later task above the list. Neither may reorder the queue.
scen rank
mkro $'**Wave 5 re-run:** [[c]] was re-planned, see [[c#Notes]].\n\n| Wave | Task |\n|---|---|\n| 1 | [[a\\|A]] |\n| 2 | [[b#Plan\\|B]] |\n\n```\n- [[d]]\n```\n\n- [[c]]\n1. [[d]]' 'parallel_ceiling: 1'
mkt a open; mkt b open; mkt c open; mkt d open
J=$(st)
ok "$(q "$J" '[t["slug"] for t in d["tasks"]]')" '["a","b","c","d"]' "status: rank from table rows and list items, never prose or a code block"
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a"]' "next: the first table row starts first"

# ── overlap tiebreak (in flight and within one call) ─────────────────────────────────────────────
scen overlap
mkro $'- [[r]]\n- [[x]]\n- [[y]]\n\n## File-sets\n\n- r (wave 1): src/f1.py\n- x (wave 2): src/f1.py\n- y: src/f2.py' 'parallel_ceiling: 2'
mkt r in_progress; mkt x open; mkt y open
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["y"]' "next: y (no overlap with running r) beats earlier-ranked x"
ok "$(q "$J" "$holds")" '{"x":"ceiling: 2/2 slots in use"}' "next: x is held for the ceiling"
setkey r status open
setkey r priority high
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["r","y"]' "next: the greedy pick re-sorts within one call (y's overlap 0 beats x's 1)"
scen overlap-glob
mkro $'- [[r]]\n- [[x]]\n- [[y]]\n\n## File-sets\n\n- r: docs/*.md\n- x: docs/a.md\n- y: lib/b.py' 'parallel_ceiling: 2'
mkt r in_progress; mkt x open; mkt y open
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["y"]' "next: a glob in File-sets overlaps by fnmatch"

# ── Solo ─────────────────────────────────────────────────────────────────────────────────────────
scen solo-alone
mkro $'- [[s]]\n- [[a]]'
mkt s open 'solo: true'; mkt a open
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["s"]' "next: a Solo task with nothing started starts alone"
ok "$(q "$J" "$holds")" '{"a":"behind solo [[s]]"}' "next: the rest wait behind it"

scen solo-second
mkro $'- [[a]]\n- [[s]]\n- [[c]]'
mkt a open 'priority: high'; mkt s open 'solo: true'; mkt c open
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a"]' "next: Solo second in order: a starts"
ok "$(q "$J" "$holds")" '{"c":"behind solo [[s]]","s":"solo: waits for 1 started task(s) to merge or be set aside"}' \
  "next: picking stops at the Solo task with slots left"
setkey a status in_progress
J=$(nxt)
ok "$(q "$J" '[d["start"], d["hold"][0]["slug"]]')" '[[],"s"]' "next: while a runs nothing more starts"
setkey a status done
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["s"]' "next: after a merges the Solo task starts"
ok "$(q "$J" "$holds")" '{"c":"behind solo [[s]]"}' "next: c still waits behind it"
setkey s status in_progress
J=$(nxt)
ok "$(q "$J" '[d["start"], d["hold"]]')" '[[],[{"reason":"behind solo [[s]]","slug":"c"}]]' "next: nothing starts beside a running Solo task"
setkey s status done
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["c"]' "next: after the Solo task merges the queue resumes"

scen solo-integration
mkro $'- [[a]]\n- [[s]]'
mkt a review 'pr: https://github.com/o/r/pull/1'; mkt s open 'solo: yes'
J=$(nxt)
ok "$(q "$J" '[d["start"], d["awaitingIntegration"]]')" '[[],["a"]]' "next: a Solo task waits for the Integration line"
setkey a integrating 2026-10-02T13:00+00:00
J=$(nxt)
ok "$(q "$J" '[d["start"], d["integrating"]]')" '[[],["a"]]' "next: … and for a task integrating"
setkey a status done
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["s"]' "next: once a is done the Solo task starts"

# ── --running: the default counts every in_progress note as live ─────────────────────────────────
scen running
mkro $'- [[x]]\n- [[y]]' 'parallel_ceiling: 1'
mkt x in_progress; mkt y open
J=$(nxt)
ok "$(q "$J" '[d["running"], d["restart"], d["start"], d["slotsInUse"]]')" '[["x"],[],[],1]' "next: by default an in_progress note holds a slot"
J=$(nxt --running '')
ok "$(q "$J" '[d["running"], d["restart"], d["start"], d["slotsInUse"]]')" '[[],["x"],[],1]' "next: --running '' lists the stalled note in restart, within the slots"
J=$(nxt --running x,bogus 2>"$D/err")
ok "$(q "$J" 'd["running"]')" '["x"]' "next: --running x keeps x live"
has "$(cat "$D/err")" "bogus" "next: a listed slug that is not in_progress gets a WARN"
mkro $'- [[x]]\n- [[y]]' 'parallel_ceiling: 2'
J=$(nxt --running '')
ok "$(q "$J" '[d["restart"], d["start"]]')" '[["x"],["y"]]' "next: restarts come first, new starts fill the rest"

# ── soft pause drains ────────────────────────────────────────────────────────────────────────────
scen pause
mkro $'- [[x]]\n- [[y]]' 'pause_requested: true'
mkt x in_progress; mkt y open
J=$(nxt)
ok "$(q "$J" '[d["start"], d["pauseRequested"], d["pausedNow"], d["halt"]]')" '[[],true,false,null]' "next: a pause request starts nothing while x runs"
ok "$(q "$J" "$holds")" '{"y":"pause requested: draining"}' "next: … holding y as draining"
ok "$(grep -c '^paused:' "$D/ro.md")" 0 "next: no paused stamp while draining"
setkey x status done
cp "$D/ro.md" "$D/ro.before"
J=$(nxt --dry-run)
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "next --dry-run writes nothing"
J=$(nxt)
ok "$(q "$J" '[d["pausedNow"], d["halt"], d["paused"]]')" '[true,"paused","2026-10-02T14:05+00:00"]' "next: drained, it stamps the pause and halts paused"
ok "$(fm ro paused)" "paused: 2026-10-02T14:05+00:00" "next: paused stamp written"
ok "$(fm ro pause_requested)" "<none>" "next: pause_requested removed"
J=$(nxt)
ok "$(q "$J" '[d["pausedNow"], d["halt"], d["start"]]')" '[false,"paused",[]]' "next: a paused rollout stays paused"
ok "$(q "$J" "$holds")" '{"y":"paused"}' "next: … holding y as paused"

# ── halt ─────────────────────────────────────────────────────────────────────────────────────────
scen halt-complete
mkro $'- [[a]]'
mkt a done
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["progress"]]')" '["complete","progress: 1/1 merged — rollout complete"]' "next: halt complete"
scen halt-stuck
mkro $'- [[a]]\n- [[b]]'
mkt a blocked; mkt b open 'depends-on: [[a]]'
J=$(nxt)
ok "$(q "$J" 'd["halt"]')" '"stuck"' "next: a set-aside task and its dependant halt as stuck"
scen halt-awaiting
mkro $'- [[a]]\n- [[b]]'
mkt a review 'pr: https://github.com/o/r/pull/1'; mkt b open 'depends-on: [[a]]'
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["awaitingIntegration"]]')" '[null,["a"]]' "next: no halt while a task awaits Integration"
scen halt-empty
mkro $'nothing linked'
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["progress"]]')" '["empty","progress: 0/0 merged"]' "next: halt empty with N = 0"

# ── a read-only task is done on approval ─────────────────────────────────────────────────────────
scen read-only
mkro $'- [[r]]\n- [[b]]\n- [[w]]\n- [[z]]'
mkt r in_progress 'scope: read-only' 'started: 2026-10-02T13:05+00:00'
mkt b open 'depends-on: [[r]]'
mkt w review 'scope: read-only'
mkt z review 'scope: cross-cutting'
printf '{"rolloutSlug":"ro","tasks":[{"slug":"r","status":"review","prUrl":"","reviewRoundsUsed":0,"planRoundsUsed":0}]}' > "$D/res.json"
python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now "$NOW" >/dev/null || { echo "FAIL - reconcile exit"; fail=1; }
ok "$(fm r status)" "status: done" "reconcile: a read-only review row with no PR is written done"
ok "$(fm r merged)" "merged: 2026-10-02T14:05+00:00" "reconcile: … stamped merged: at its approval (its completion time)"
python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now 2026-10-02T16:00:00Z >/dev/null
ok "$(fm r merged)" "merged: 2026-10-02T14:05+00:00" "reconcile: … a re-reconcile keeps the first stamp"
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["b"]' "next: its dependant starts"
ok "$(q "$J" 'd["setAside"]')" '[{"setAsideAt":"run","slug":"z","status":"review"}]' "next: review without a PR on another scope is set aside"
J=$(st)
ok "$(q "$J" '{t["slug"]: t["queueState"] for t in d["tasks"]}')" '{"b":"queued","r":"merged","w":"merged","z":"set-aside"}' "status: a legacy read-only review counts as merged"
ok "$(q "$J" '[d["timeline"]["tasks"], d["timeline"]["avgTaskMinutes"], d["timeline"]["lastMerged"]]')" \
  '[[{"durationMinutes":60,"merged":"2026-10-02T14:05+00:00","slug":"r","started":"2026-10-02T13:05+00:00"}],60.0,"2026-10-02T14:05+00:00"]' \
  "status: the read-only task's duration counts in the timeline"

# ── stamps ───────────────────────────────────────────────────────────────────────────────────────
scen stamps
mkro $'- [[a]]\n- [[b]]\n- [[c]]\n- [[g]]'
mkt a in_progress 'integrating: 2026-10-01T09:00+00:00'
mkt b done
mkt c review 'pr: https://github.com/o/r/pull/3' 'ready: 2026-10-02T12:00+00:00'
mkt g open
out=$(python3 "$SCRIPT" mark-started --tasks a,b,g --tasks-dir "$D" --now "$NOW" --rollout "$D/ro.md" 2>"$D/err"); rc=$?
ok "$rc" 1 "mark-started: refusing a done note exits 1"
has "$(cat "$D/err")" "b:" "mark-started: the refusal names the note"
ok "$(fm a started)" "started: 2026-10-02T14:05+00:00" "mark-started: exact stamp"
fm a started | grep -Eq '^started: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$'
ok "$?" 0 "mark-started: offset-bearing minute format"
ok "$(fm g started)" "started: 2026-10-02T14:05+00:00" "mark-started: still processes the rest"
ok "$(fm b started)" "<none>" "mark-started: the done note is untouched"
ok "$(fm a integrating)" "<none>" "mark-started: removes integrating:"
has "$out" "progress: 1/4 merged" "mark-started --rollout prints the progress line"
python3 "$SCRIPT" mark-started --tasks a --tasks-dir "$D" --now 2026-10-02T16:00:00Z >/dev/null
ok "$(fm a started)" "started: 2026-10-02T14:05+00:00" "mark-started: the first start wins"
python3 "$SCRIPT" mark-integrating --tasks c --tasks-dir "$D" --now 2026-10-02T15:10:00Z >/dev/null; rc=$?
ok "$rc" 0 "mark-integrating: a review note with a PR"
ok "$(fm c integrating)" "integrating: 2026-10-02T15:10+00:00" "mark-integrating: exact stamp"
python3 "$SCRIPT" mark-integrating --tasks c --tasks-dir "$D" --now 2026-10-02T15:30:00Z >/dev/null
ok "$(fm c integrating)" "integrating: 2026-10-02T15:10+00:00" "mark-integrating: the first wins"
python3 "$SCRIPT" mark-integrating --tasks g --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1; rc=$?
ok "$rc" 1 "mark-integrating: refuses a note that is not review with a PR"
ok "$(fm g integrating)" "<none>" "mark-integrating: … and writes nothing there"
out=$(python3 "$SCRIPT" mark-done --tasks c --tasks-dir "$D" --now 2026-10-02T15:45:00Z --rollout "$D/ro.md"); rc=$?
ok "$rc" 0 "mark-done: review -> done"
ok "$(fm c status)" "status: done" "mark-done: status done"
ok "$(fm c merged)" "merged: 2026-10-02T15:45+00:00" "mark-done: exact merged stamp on a PR task"
ok "$(fm c integrating)" "<none>" "mark-done: removes integrating:"
has "$out" "progress: 2/4 merged" "mark-done --rollout prints the progress line"
python3 "$SCRIPT" defer --tasks a,c --tasks-dir "$D" >/dev/null
ok "$(fm a started)|$(fm c merged)|$(fm c integrating)|$(fm c ready)" "<none>|<none>|<none>|<none>" "defer clears started:, merged:, integrating: and ready:"

# ── ready: when a task joined the Integration queue (p12-16) ─────────────────────────────────────
# Stamped on a move to review from another status, for a non-read-only row that carries no
# `integration` (readyAt is when the approving own or seeded revise call returned); a re-reconcile and
# an Integration row never move it.
scen ready-stamp
mkro $'- [[a]]\n- [[n]]\n- [[r1]]\n- [[r2]]\n- [[r3]]'
mkt a in_progress 'scope: cross-cutting'
mkt n -
mkt r1 in_progress 'scope: read-only'
mkt r2 in_progress
mkt r3 in_progress 'scope: read-only'
rrow() { printf '{"rolloutSlug":"ro","tasks":[%s]}' "$1" > "$D/res.json"; }   # rrow <row json>
rrec() { python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now "$1" >/dev/null; }   # rrec <now>
IJ='"integration":{"outcome":"%s","path":"integrator","anchor":{"headSha":"a","taskBase":"b"},"headSha":"d","baseSha":"c","triggers":[],"metrics":{"startedAt":"%s"}}'
PRA='"prUrl":"https://github.com/o/r/pull/1"'
rrow "{\"slug\":\"a\",\"status\":\"review\",\"scope\":\"cross-cutting\",$PRA,\"reviewRoundsUsed\":1,\"planRoundsUsed\":0}"
rrec 2026-10-02T14:05:00Z
ok "$(fm a status)|$(fm a ready)" "status: review|ready: 2026-10-02T14:05+00:00" "reconcile: in_progress -> review stamps ready:"
fm a ready | grep -Eq '^ready: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$'
ok "$?" 0 "reconcile: ready: has the offset-bearing minute format"
cp "$D/a.md" "$D/a.before"
rrec 2026-10-02T16:00:00Z
cmp -s "$D/a.md" "$D/a.before"; ok "$?" 0 "reconcile: review -> review at a later --now is byte-identical"
rrow "{\"slug\":\"a\",\"status\":\"blocked\",\"scope\":\"cross-cutting\",$PRA,$(printf "$IJ" rejected 2026-10-02T16:10+00:00)}"
rrec 2026-10-02T16:30:00Z
ok "$(fm a status)|$(fm a ready)" "status: blocked|ready: 2026-10-02T14:05+00:00" "reconcile: an Integration rejection leaves ready: alone"
rrow "{\"slug\":\"a\",\"status\":\"review\",\"scope\":\"cross-cutting\",$PRA,\"reviewRoundsUsed\":2,\"planRoundsUsed\":0}"
rrec 2026-10-02T17:00:00Z
ok "$(fm a status)|$(fm a ready)" "status: review|ready: 2026-10-02T17:00+00:00" "reconcile: the seeded revise's approval overwrites ready:"
rrow "{\"slug\":\"a\",\"status\":\"blocked\",\"scope\":\"cross-cutting\",$PRA,$(printf "$IJ" set-aside 2026-10-02T17:10+00:00)}"
rrec 2026-10-02T17:30:00Z
rrow "{\"slug\":\"a\",\"status\":\"review\",\"scope\":\"cross-cutting\",$PRA,\"reviewRoundsUsed\":2,\"planRoundsUsed\":0,$(printf "$IJ" integrated 2026-10-02T18:00+00:00)}"
rrec 2026-10-02T19:00:00Z
ok "$(fm a status)|$(fm a ready)" "status: review|ready: 2026-10-02T17:00+00:00" "reconcile: an integrated row re-entering review from a set-aside does not stamp ready:"
rrow '{"slug":"n","status":"review","prUrl":"https://github.com/o/r/pull/2","reviewRoundsUsed":1,"planRoundsUsed":0}'
rrec 2026-10-02T14:05:00Z
ok "$(fm n status)|$(fm n ready)" "status: review|ready: 2026-10-02T14:05+00:00" "reconcile: a note with no status: line moving to review is stamped"
rrow '{"slug":"r1","status":"review","scope":"read-only","prUrl":"","reviewRoundsUsed":1,"planRoundsUsed":0}'
rrec 2026-10-02T14:05:00Z
ok "$(fm r1 status)|$(fm r1 ready)" "status: done|<none>" "reconcile: read-only with no PR is done, never stamped ready:"
rrow '{"slug":"r2","status":"review","scope":"read-only","prUrl":"https://github.com/o/r/pull/4","reviewRoundsUsed":1,"planRoundsUsed":0}'
rrec 2026-10-02T14:05:00Z
ok "$(fm r2 status)|$(fm r2 ready)" "status: review|<none>" "reconcile: read-only with a PR stays review, never stamped ready:"
rrow '{"slug":"r3","status":"review","prUrl":"https://github.com/o/r/pull/5","reviewRoundsUsed":1,"planRoundsUsed":0}'
rrec 2026-10-02T14:05:00Z
ok "$(fm r3 status)|$(fm r3 ready)" "status: review|<none>" "reconcile: a row with no scope on a read-only note is never stamped"
python3 "$SCRIPT" defer --tasks a,n --tasks-dir "$D" >/dev/null
ok "$(fm a ready)|$(fm n ready)" "<none>|<none>" "defer clears ready:"

# ── status: queue states, timeline and progress line ─────────────────────────────────────────────
scen status
mkro $'- [[s-a]]\n- [[s-b]]\n- [[s-c]]\n- [[s-d]]\n- [[s-e]]\n- [[s-f]]' 'parallel_ceiling: 4'
mkt s-a done 'started: 2026-10-02T10:00+00:00' 'merged: 2026-10-02T10:30+00:00' 'pr: https://github.com/o/r/pull/1'
mkt s-b done 'started: 2026-10-02T10:15+00:00' 'merged: 2026-10-02T11:15+00:00' 'pr: https://github.com/o/r/pull/2'
mkt s-c in_progress 'started: 2026-10-02T11:00+00:00' 'owner: execute-test'
mkt s-d review 'started: 2026-10-02T10:20+00:00' 'pr: https://github.com/o/r/pull/4'
mkt s-e blocked 'started: 2026-10-02T10:40+00:00' 'priority: high'
printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-02T11:00+00:00)\n\nverifier red: flaky fixture\n\n<!-- run 1 end sha=000000000000 -->\n' >> "$D/s-e.md"
mkt s-f open 'depends-on: [[s-e]]' 'solo: true'
mkt s-t merged 'merged_into: "[[s-a]]"'
mkt s-x dropped
J=$(st "" 2026-10-02T12:00:00Z)
ok "$(q "$J" 'd["counts"]')" '{"awaitingIntegration":1,"folded":1,"integrating":0,"merged":2,"other":1,"queued":1,"running":1,"setAside":1,"setAsideAtIntegration":0,"total":6}' "status: counts"
ok "$(q "$J" 'd["progress"]')" '"progress: 2/6 merged, 1 running, 1 awaiting integration, 1 queued, 1 set aside — 2h elapsed, ~45m remaining (rough)"' "status: exact progress line"
ok "$(q "$J" 'd["timeline"]')" '{"avgTaskMinutes":45.0,"complete":false,"durationsUsed":2,"elapsedLabel":"2h","elapsedMinutes":120,"firstStarted":"2026-10-02T10:00+00:00","lastMerged":"2026-10-02T11:15+00:00","remainingEstimateMinutes":45,"remainingLabel":"~45m (rough)","tasks":[{"durationMinutes":30,"merged":"2026-10-02T10:30+00:00","slug":"s-a","started":"2026-10-02T10:00+00:00"},{"durationMinutes":60,"merged":"2026-10-02T11:15+00:00","slug":"s-b","started":"2026-10-02T10:15+00:00"},{"durationMinutes":null,"merged":null,"slug":"s-d","started":"2026-10-02T10:20+00:00"},{"durationMinutes":null,"merged":null,"slug":"s-e","started":"2026-10-02T10:40+00:00"},{"durationMinutes":null,"merged":null,"slug":"s-c","started":"2026-10-02T11:00+00:00"}]}' "status: exact timeline"
ok "$(q "$J" '[t["slug"] for t in d["tasks"]]')" '["s-a","s-b","s-c","s-d","s-e","s-f","s-t","s-x"]' "status: tasks sorted by schedule rank"
ok "$(q "$J" '{t["slug"]: [t["queueState"], t["setAsideAt"]] for t in d["tasks"]}')" '{"s-a":["merged",null],"s-b":["merged",null],"s-c":["running",null],"s-d":["awaiting-integration",null],"s-e":["set-aside","run"],"s-f":["queued",null],"s-t":["folded",null],"s-x":["other",null]}' "status: queue states"
ok "$(q "$J" '[t for t in d["tasks"] if t["slug"] == "s-f"][0]')" '{"blockerSummary":"","integrating":null,"merged":null,"pr":null,"priority":"normal","queueState":"queued","setAsideAt":null,"slug":"s-f","solo":true,"started":null,"status":"open","waitingOn":["depends on [[s-e]] (blocked)"],"wave":null}' "status: a queued task's row"
ok "$(q "$J" '[[t["blockerSummary"], t["priority"]] for t in d["tasks"] if t["slug"] == "s-e"][0]')" '["verifier red: flaky fixture","high"]' "status: blockerSummary is the latest run"
ok "$(q "$J" 'sorted(set(k for t in d["tasks"] for k in t)) + sorted(k for k in d if k in ("merged_through_wave", "total_waves"))')" \
  '["blockerSummary","integrating","merged","pr","priority","queueState","setAsideAt","slug","solo","started","status","waitingOn","wave"]' "status: no owner key, no wave cursor"
setkey s-d integrating 2026-10-02T11:50+00:00
printf '\n### Run 2 (2026-10-02T11:30+00:00)\n\nIntegration: conflict in a.py\n\n<!-- run 2 end sha=111111111111 -->\n' >> "$D/s-e.md"
J=$(st "" 2026-10-02T12:00:00Z)
ok "$(q "$J" 'd["progress"]')" '"progress: 2/6 merged, 1 running, 1 integrating, 1 queued, 1 set aside (1 at Integration) — 2h elapsed, ~45m remaining (rough)"' "status: integrating and set aside at Integration shown apart"
ok "$(q "$J" '[d["counts"]["integrating"], d["counts"]["setAsideAtIntegration"], d["counts"]["awaitingIntegration"]]')" '[1,1,0]' "status: integrating counts"
J=$(nxt --now 2026-10-02T12:00:00Z)
ok "$(q "$J" '[d["integrating"], d["setAside"]]')" '[["s-d"],[{"setAsideAt":"integration","slug":"s-e","status":"blocked"}]]' "next: integrating and setAsideAt integration"

scen status-complete
mkro $'- [[a]]\n- [[b]]'
mkt a done 'started: 2026-10-02T10:00+00:00' 'merged: 2026-10-02T10:30+00:00'
mkt b done 'started: 2026-10-02T10:10+00:00' 'merged: 2026-10-02T11:00+00:00'
J=$(st "" 2026-10-02T12:00:00Z)
ok "$(q "$J" '[d["progress"], d["timeline"]["complete"], d["timeline"]["elapsedMinutes"], d["timeline"]["remainingEstimateMinutes"]]')" \
  '["progress: 2/2 merged — rollout complete in 1h",true,60,null]' "status: complete measures elapsed to the last merge"
delkey a started; delkey a merged; delkey b started; delkey b merged
J=$(st "" 2026-10-02T12:00:00Z)
ok "$(q "$J" '[d["progress"], d["timeline"]]')" '["progress: 2/2 merged — rollout complete",null]' "status: no stamps -> timeline null"
python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" > "$D/st.json"; ok "$?" 0 "status runs without --now"

# ── resume: a merged PR whose note was never marked (p6-8), against a stub gh ────────────────────
scen resume
mkro $'- [[r-merged]]'
mkdir -p "$D/bin" "$D/gh"
cat > "$D/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$PWD|$*" >> "$GHLOG"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
case "$1 $2" in
  "pr view")   f="$GHDIR/pr-$(key "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1 ;;
  "repo view") if [ "$3" = "--json" ]; then f="$GHDIR/default-cwd"; else f="$GHDIR/default-$(key "$3")"; fi
               [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no repo" >&2; exit 1 ;;
esac
exit 2
EOF
chmod +x "$D/bin/gh"
export GHLOG="$D/gh.log" GHDIR="$D/gh"
pr() { printf '{"state":"%s","mergedAt":%s,"baseRefName":"%s","url":"%s"}\n' "$2" "$3" "$4" "$5" > "$D/gh/pr-$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_').json"; }
U=https://github.com/o/r/pull
echo main > "$D/gh/default-o_r"; echo main > "$D/gh/default-cwd"
mkt r-merged in_progress "pr: $U/1" 'owner: execute-test';  pr "$U/1" MERGED '"2026-10-01T03:24:56Z"' main "$U/1"
mkt r-nopr in_progress
mkt r-wrongbase in_progress "pr: $U/2";                     pr "$U/2" MERGED '"2026-10-01T04:00:00Z"' release "$U/2"
mkt r-open review "pr: \"$U/3\"";                           pr "$U/3" OPEN null main "$U/3"
mkt r-rb review-blocked "pr: $U/5" 'merged: 2026-09-30T01:00+00:00'; pr "$U/5" MERGED '"2026-10-01T05:00:00Z"' main "$U/5"
mkt r-bare review 'pr: 7' 'integrating: 2026-10-01T02:00+00:00'; pr 7 MERGED '"2026-10-01T06:00:00Z"' main "https://github.com/o/r/pull/7"
mkt r-fail review "pr: $U/9"
mkt r-done done "pr: $U/10"
sums() { for f in "$D"/r-*.md; do cksum < "$f"; done; }
before=$(sums)
python3 "$SCRIPT" resume --rollout "$D/ro.md" --tasks-dir "$D" --gh-bin "$D/bin/gh" --now "$NOW" --dry-run >/dev/null 2>&1; rc=$?
ok "$rc" 1 "resume --dry-run: a gh failure still exits 1"
ok "$(sums)" "$before" "resume --dry-run writes nothing"
: > "$GHLOG"
out=$(python3 "$SCRIPT" resume --rollout "$D/ro.md" --tasks-dir "$D" --gh-bin "$D/bin/gh" --now "$NOW" 2>"$D/err"); rc=$?
ok "$rc" 1 "resume: a gh failure exits 1"
has "$(cat "$D/err")" "r-fail" "resume: the ERROR names the failing note"
ok "$(fm r-merged status)|$(fm r-merged merged)" "status: done|merged: 2026-10-01T03:24+00:00" "resume (p6-8): in_progress + MERGED on the default base -> done, merged: from mergedAt"
ok "$(fm r-nopr status)" "status: in_progress" "resume: in_progress with no pr: is untouched"
ok "$(fm r-wrongbase status)" "status: in_progress" "resume: merged into another base -> unchanged"
has "$out" "r-wrongbase" "resume: … with a line for it"
ok "$(fm r-open status)" "status: review" "resume: OPEN -> unchanged"
ok "$(fm r-rb status)|$(fm r-rb merged)" "status: done|merged: 2026-09-30T01:00+00:00" "resume: review-blocked + MERGED -> done, existing merged: kept"
ok "$(fm r-bare status)|$(fm r-bare integrating)" "status: done|<none>" "resume: a bare pr: number resolves; integrating: removed"
ok "$(grep -c "^$D/repo|pr view 7 " "$GHLOG")|$(grep -c "^$D/repo|repo view --json" "$GHLOG")" "1|1" "resume: a bare pr: runs gh in the Project root"
ok "$(grep -c 'repo view o/r ' "$GHLOG")" 1 "resume: the default branch is looked up once per repo"
hasnt "$(cat "$GHLOG")" "pull/10" "resume: a done note is not queried"
has "$out" "progress: " "resume prints the progress line"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-queue: ALL PASS"; else echo "reconcile-rollout-queue: FAILED"; fi
exit "$fail"
