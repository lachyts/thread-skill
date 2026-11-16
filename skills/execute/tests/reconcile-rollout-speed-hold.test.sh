#!/usr/bin/env bash
# The Speed fix hold (p54-13, ADR 0084 d4; skills/_shared/vault-grammar.md § Speed fix hold): a phase whose tasks carry
# a cited `speed_fix:` holds every other queued task of its rollout through plain `depends-on:` entries on the phase's
# release, recorded on the rollout note's `## Speed fix holds` section. reconcile-rollout.py's `speed-hold apply |
# release | lift`, and the hold's writes in `join`, `next`, `defer` and `carry`, and its reading in `status`. The mark and
# its refusals (S2), the reach (one rule: S1, S8, S9, S12, S17), the record (S3, S6, S13), join (S4, S4b, S12b, S21),
# the release landing (S5), the let-go (S7), supersede and Put back (S11, S18), clean-up and defer (S19), the moving
# release (S21) and the cross-version gate (S16). Temp vaults only; no network.
# Usage: bash reconcile-rollout-speed-hold.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # away_file; THREAD_HEAT_LEVEL=0
root="$(cd "$HERE/../../.." && pwd -P)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks" TMPDIR="$TMP/tmp"
mkdir -p "$TMPDIR"
NOW=2026-11-11T12:00+00:00
STAMP=2026-11-11T12:00+00:00
MARK='speed_fix: "docs/audits/test-suite-audit-2026-11-16.md row 2"'
EH="$TMP/home"; mkdir -p "$EH"; away_file "$EH" 2026-11-11T11:00:00Z   # Away: each rollout runs to its own ceiling

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""; P=""; R=""
# scen <name>: a fresh vault ($TMP/<name>/Work/Tasks and Work/Phases), its Project root and its own Run record dir.
scen() {
  local v="$TMP/$1"; echo "== $1"
  D="$v/Work/Tasks"; P="$v/Work/Phases"; R="$v/repo"
  mkdir -p "$D" "$P" "$R"
  export THREAD_EVENTS_DIR="$v/events"
}
# mkro <name> <extra frontmatter (newline-separated, may be empty)> <slug>... — a protocol-5 parallel rollout note
# stamped on this tree's engine, its ## Queue a list of the slugs.
mkro() {
  local name="$1" extra="$2"; shift 2
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 8\n'
    printf 'engine_snapshot: "%s"\nprojects:\n  - "[[Demo]]"\n' "${ENGINE_ROOT:-$root}"
    [ -n "$extra" ] && printf '%s\n' "$extra"
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n' "$R"
    for s in "$@"; do printf -- '- [[%s]]\n' "$s"; done; } > "$D/$name.md"
}
# mkt <slug> <status> <rollout|-> [frontmatter lines...] — a task note of the Demo project.
mkt() {
  local s="$1" st="$2" ro="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\n' "$st"
    [ "$ro" = "-" ] || printf 'rollout: "[[%s]]"\n' "$ro"
    printf 'projects:\n  - "[[Demo]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
# blocked <slug> [frontmatter lines...] — a set-aside (blocked) task of ro, its Blocker diagnosis a legacy section.
blocked() {
  local s="$1"; shift
  mkt "$s" blocked ro "$@"
  printf '\n## Blocker diagnosis\n\nthe verifier stayed red after 3 iterations: test_x fails\n' >> "$D/$s.md"
}
setfm() {  # setfm <slug> <key> <value|-> — replace, add (after status:) or (with -) remove a frontmatter key
  python3 - "$D/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
head, sep, body = t[4:].partition("\n---\n")
lines = [l for l in head.split("\n") if not re.match(rf"^{re.escape(k)}:", l)]
if v != "-":
    i = next((n + 1 for n, l in enumerate(lines) if l.startswith("status:")), len(lines))
    lines.insert(i, f"{k}: {v}")
open(p, "w").write("---\n" + "\n".join(lines) + sep + body)
PY
}
# deps <slug> — the note's depends-on entries, comma-joined ("-" for none).
deps() {
  python3 - "$D/$1.md" <<'PY'
import re, sys
head = open(sys.argv[1]).read()[4:].split("\n---\n", 1)[0].split("\n")
out, on = [], False
for l in head:
    if re.match(r"^depends-on:", l):
        v = l.split(":", 1)[1].strip()
        if v:
            out += re.findall(r"\[\[([^\]|]+)", v)
            break
        on = True
        continue
    if on:
        m = re.match(r"^\s*-\s*(.*)$", l)
        if m:
            out += re.findall(r"\[\[([^\]|]+)", m.group(1)) or [m.group(1).strip()]
        elif l.strip():
            break
print(",".join(out) if out else "-")
PY
}
holdlines() { python3 - "$D/${1:-ro}.md" <<'PY'
import sys
lines, on = [], False
for l in open(sys.argv[1]).read().split("\n"):
    if l.strip() == "## Speed fix holds":
        on = True
        continue
    if on and l.startswith("## "):
        break
    if on and l.strip():
        lines.append(l.strip())
print("\n".join(lines))
PY
}
ev() {  # ev <py expr over L, the speed-hold lines of the rollout's Run record> [rollout]
  python3 - "$THREAD_EVENTS_DIR/${2:-ro}.jsonl" "$1" <<'PY'
import json, os, sys
L = []
if os.path.exists(sys.argv[1]):
    for raw in open(sys.argv[1]):
        try:
            d = json.loads(raw)
        except ValueError:
            continue
        if d.get("kind") == "speed-hold":
            L.append(d)
print(json.dumps(eval(sys.argv[2]), separators=(",", ":"), sort_keys=True))
PY
}
sums() { (cd "$D" && cksum ./*.md); }
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True))' "$2"; }
run() { HOME="$EH" python3 "$SCRIPT" "$@" > "$TMP/out" 2> "$TMP/err"; rc=$?; out=$(cat "$TMP/out"); err=$(cat "$TMP/err"); }
sh_() { local verb="$1"; shift; run speed-hold "$verb" --rollout "$D/${RO:-ro}.md" --tasks-dir "$D" --now "$NOW" "$@"; }
jn() { run join --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" "$@"; }
nxt() { run next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" "$@"; }
st() { run status --rollout "$D/${RO:-ro}.md" --tasks-dir "$D" --now "$NOW"; }
dfr() { run defer --tasks-dir "$D" "$@"; }
starts() { q "$out" 'sorted(d["start"])'; }
# hf <slug> — the set-aside task's humanFix act through the engine's own read (moving's: _retry_budget, task_inputs,
# auto_retry_verdict), or null.
hf() {
  python3 - "$SCRIPT" "$D/$1.md" "$D/ro.md" "$NOW" <<'PY'
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr_under_test", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
path, ro = Path(sys.argv[2]), m.Note(Path(sys.argv[3]))
note = m.Note(path)
budget = m._retry_budget(note, ro)
k = budget["maxReviewRounds"]["value"] if budget["maxReviewRounds"] and not budget["error"] else None
inp = m._lead().task_inputs(path, note, max_rounds=k, repo=None)
fix = m._lead().auto_retry_verdict(path, note, inp, ro, m._parse_ts(sys.argv[4]))["humanFix"]
print(json.dumps(fix and fix["act"]))
PY
}

# The standard queue: phase 9's marked x-p9-1 and x-p9-2 and unmarked x-p9-3; a and b open; c running; d awaiting
# Integration; f set aside; g done; h open on no rollout.
base() {
  mkro ro "" x-p9-1 x-p9-2 x-p9-3 a b c d f g
  mkt x-p9-1 open ro "$MARK"; mkt x-p9-2 open ro "$MARK"; mkt x-p9-3 open ro
  mkt a open ro; mkt b open ro; mkt c in_progress ro "owner: lead"
  mkt d review ro "pr: https://github.com/o/r/pull/4"; mkt f blocked ro; mkt g done ro; mkt h open -
}

# ── S1: before the verb exists, apply is an invalid choice (the red step); then a fresh apply holds a and b ──────────────
scen s1
base
before=$(cd "$D" && cksum x-p9-1.md x-p9-2.md x-p9-3.md c.md d.md f.md g.md h.md)
sh_ apply
ok "$rc" 0 "S1: speed-hold apply exits 0"
ok "$(deps a)|$(deps b)" "x-p9-2|x-p9-2" "S1: a and b gain depends-on [[x-p9-2]], the phase's highest marked task"
ok "$(cd "$D" && cksum x-p9-1.md x-p9-2.md x-p9-3.md c.md d.md f.md g.md h.md)" "$before" \
  "S1: the phase's own tasks, running, awaiting, set-aside, landed and unlinked tasks are byte-identical"
ok "$(holdlines)" "- $STAMP hold [[x-p9-2]] (p9, schedule): [[a]], [[b]]" "S1: the section's one hold line names a and b"
ok "$(ev '[[d["act"], d["release"], d["phase"], d.get("by"), d.get("held")] for d in L]')" '[["made","x-p9-2","p9","schedule",2]]' \
  "S1: one made event"
has "$out" "speed-hold made [[x-p9-2]] (p9, schedule): [[a]], [[b]]" "S1: stdout names the hold"
ok "$(printf '%s' "$out" | tail -1)" "[written: 3]" "S1: three notes written"
before=$(sums)
sh_ apply
ok "$rc|$(printf '%s' "$out" | tail -1)|$(sums)" "0|[no-change]|$before" "S1/S14: a second apply writes nothing"

scen s1b
base
printf -- '---\ntags: [phase]\nstatus: open\nspeed_fix_release: "[[x-p9-1]]"\n---\n\n# Phase 9\n' > "$P/x-p9-speed.md"
sh_ apply
ok "$(deps a)|$(deps b)|$(deps x-p9-2)" "x-p9-1|x-p9-1|-" "S1b: the phase note's speed_fix_release moves the release to x-p9-1"
ok "$(holdlines)" "- $STAMP hold [[x-p9-1]] (p9, schedule): [[a]], [[b]]" "S1b: … its hold line"

# ── S2: a mark without its evidence is refused, and the task is held like any other ──────────────────────────────────────
scen s2
mkro ro "" x-p9-2 r1 r2 r3 r4 r5 r6 k1 k2 k3 k4 k5
mkt x-p9-2 open ro "$MARK"
mkt r1 open ro 'speed_fix: true'; mkt r2 open ro 'speed_fix:'; mkt r3 open ro 'speed_fix: "faster"'
mkt r4 open ro 'speed_fix: "ADR 0084 d4"'; mkt r5 open ro 'speed_fix: "time-lost foo"'
mkt r6 open ro 'speed_fix: "time-lost tl-record-x merges"'
mkt k1 open ro "$MARK"; mkt k2 open ro 'speed_fix: "docs/audits/2026-11-12-rollout-stalls.md cause merge wait"'
mkt k3 open ro 'speed_fix: "docs/audits/x.md#cause-3"'; mkt k4 open ro 'speed_fix: "time-lost tl-record-x stalls"'
mkt k5 open ro 'speed_fix: "time-lost tl-baseline-2026-10"'
sh_ apply
has "$out" "speed-hold refuse [[r1]]: a flag (true), not a citation" "S2: true is a flag"
has "$out" "speed-hold refuse [[r2]]: empty" "S2: an empty value"
has "$out" "speed-hold refuse [[r3]]: no citation (an ADR decision or prose is no evidence)" "S2: prose"
has "$out" "speed-hold refuse [[r4]]: no citation (an ADR decision or prose is no evidence)" "S2: an ADR decision"
has "$out" "speed-hold refuse [[r5]]: time-lost foo: a tl- id (a Time-lost ledger line's)" "S2: a ledger line by no tl- id"
has "$out" "speed-hold refuse [[r6]]: merges is none of stalls, quota-bound, load, lane-bound, rework, plan-rejected" \
  "S2: a ledger class that is none of the six"
ok "$(deps r1),$(deps r2),$(deps r3),$(deps r4),$(deps r5),$(deps r6)" "x-p9-2,x-p9-2,x-p9-2,x-p9-2,x-p9-2,x-p9-2" \
  "S2: each refused task is held like any other"
ok "$(deps k1),$(deps k2),$(deps k3),$(deps k4),$(deps k5)" "-,-,-,-,-" "S2: each cited form marks its task: never held"
has "$out" "speed-hold skip [[k1]]: a Speed fix outside a phase makes no hold" "S2: a marked task outside a phase makes no hold"
hasnt "$out" "refuse [[k" "S2: no accepted form is refused"

# ── S3: two holds on one task are both recorded; each release removes only its own; a hand-written entry stays ─────────
scen s3
mkro ro "" x-p8-1 x-p9-1 a b
mkt x-p8-1 open ro "$MARK"; mkt x-p9-1 open ro; mkt a open ro; mkt b open ro 'depends-on:' '  - "[[x-p9-1]]"'
sh_ apply
ok "$(holdlines)" "- $STAMP hold [[x-p8-1]] (p8, schedule): [[a]], [[b]], [[x-p9-1]]" "S3: phase 8's hold"
setfm x-p9-1 speed_fix '"docs/audits/x.md row 4"'
sh_ apply
has "$out" "speed-hold drop [[x-p8-1]] from [[x-p9-1]]: a Speed fix now" "S3: a task that became a Speed fix leaves the hold"
ok "$(deps a)|$(deps b)|$(deps x-p9-1)" "x-p8-1,x-p9-1|x-p9-1,x-p8-1|-" "S3: a carries both entries; b's hand-written one stays as it was"
ok "$(holdlines | tail -1)" "- $STAMP hold [[x-p9-1]] (p9, schedule): [[a]]" \
  "S3: a task already held by phase 8 is recorded under phase 9's hold too; b's hand-written entry is never recorded"
sh_ release --release x-p8-1
ok "$rc|$(deps a)|$(deps b)" "0|x-p9-1|x-p9-1" "S3: releasing phase 8 removes only its own entries"
sh_ release --release x-p9-1
ok "$rc|$(deps a)|$(deps b)" "0|-|x-p9-1" "S3: releasing phase 9 empties a's list; b's hand-written entry survives"

# ── S4: a join under a standing hold holds the joined task, in the same save as its rollout: stamp ─────────────────────
scen s4
base; mkt e open -
sh_ apply
before=$(sums)
jn --tasks e --dry-run
ok "$rc|$(sums)" "0|$before" "S4: --dry-run writes nothing"
has "$out" "speed-hold [[x-p9-2]] (p9) holds [[e]]" "S4: --dry-run names what it would hold"
jn --tasks e
ok "$rc|$(deps e)" "0|x-p9-2" "S4: the joined task is held"
has "$(grep -m1 '^rollout:' "$D/e.md")" '[[ro]]' "S4: … and stamped to the rollout"
has "$out" "speed-hold [[x-p9-2]] (p9) holds [[e]]" "S4: join's stdout names it"
ok "$(holdlines | tail -1)" "- $STAMP hold [[x-p9-2]] (p9, join): [[e]]" "S4: an extension line records it"

# ── S4b: a marked join makes the hold; a write that fails after the line is finished by the same join ─────────────────
scen s4b
mkro ro "" a b c
mkt a open ro; mkt b open ro; mkt c in_progress ro "owner: lead"
mkt x-p9-1 open - "$MARK"; mkt x-p9-2 open - "$MARK"
chmod 444 "$D/a.md"
jn --tasks x-p9-1,x-p9-2
ok "$rc" 1 "S4b: a stamp that fails exits 1"
has "$err" "ERROR: join:" "S4b: … with its ERROR line"
has "$err" "a re-run of the same join finishes it" "S4b: … naming the re-run"
ok "$(holdlines)" "- $STAMP hold [[x-p9-2]] (p9, join): [[a]], [[b]]" "S4b: the hold line was written before the stamps"
ok "$(deps a)|$(deps b)" "-|x-p9-2" "S4b: b is held; a's write failed"
chmod 644 "$D/a.md"; bb=$(cksum < "$D/b.md")
jn --tasks x-p9-1,x-p9-2
ok "$rc|$(deps a)|$(cksum < "$D/b.md")" "0|x-p9-2|$bb" "S4b: the same join stamps a and leaves b unchanged"
ok "$(holdlines | grep -c ' hold ')" 1 "S4b: the section keeps exactly one hold line"
ok "$(deps c)|$(deps x-p9-1)|$(deps x-p9-2)" "-|-|-" "S4b: the running task and the phase's own tasks carry no entry"

# ── S5: the release lands: next starts the held rows, with no Speed fix write ──────────────────────────────────────────────
scen s5
base; sh_ apply
setfm x-p9-2 status done; setfm x-p9-2 merged 2026-11-11T11:00+00:00
nxt --dry-run
has "$(starts)" '"a","b"' "S5: next --dry-run starts a and b once the release landed"
hl=$(holdlines); n=$(ev 'len(L)')
nxt
has "$(starts)" '"a","b"' "S5: next starts them"
ok "$(holdlines)" "$hl" "S5: the section is unchanged"
ok "$(ev 'len(L)')|$(q "$out" 'd["speedHoldReleased"]')" "$n|[]" "S5: no speed-hold event, nothing released"

# ── S6: release removes exactly the recorded entries, keeps the list's other items, and records the release ─────────────
scen s6
base; mkt z done -; setfm a depends-on '["[[z]]"]'
sh_ apply
ok "$(deps a)" "z,x-p9-2" "S6: an inline list becomes a block list with the entry added"
sh_ release --release x-p9-2
ok "$rc|$(deps a)|$(deps b)" "0|z|-" "S6: release removes only the recorded entries"
ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): by hand" "S6: the released line"
ok "$(ev '[[d["act"], d.get("cause"), d.get("removed")] for d in L][-1]')" '["released","by-hand",2]' "S6: its event"
before=$(sums)
sh_ release --release x-p9-2
ok "$rc|$(printf '%s' "$out" | tail -1)|$(sums)" "0|[no-change]|$before" "S6: a re-run writes nothing"
sh_ release --release nosuch
ok "$rc" 2 "S6: an unknown --release exits 2"

# ── S7: a hold that cannot release lets go, with its Run record line ───────────────────────────────────────────────────────
scen s7
base; mkro ro "max_review_rounds: 3" x-p9-1 x-p9-2 x-p9-3 a b c d f g
sh_ apply
blocked x-p9-2 "$MARK" 'auto_retries: 0'
ok "$(hf x-p9-2)" '"hand back or defer"' "S7: the set-aside release's humanFix is non-null (its retries spent)"
before=$(sums)
nxt --dry-run
has "$(starts)" '"a","b"' "S7e: next --dry-run starts a and b"
ok "$(q "$out" '[[e["release"], e["cause"], e["task"]] for e in d["speedHoldReleased"]]')|$(sums)" '[["x-p9-2","set-aside","x-p9-2"]]|'"$before" \
  "S7e: … names the let-go and writes nothing"
run moving --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW"
ok "$(sums)" "$before" "S7e: moving writes nothing"
has "$(q "$out" 'sorted(d["work"]["start"])')" '"a","b"' "S7e: moving reads a and b as starting"
nxt
ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): [[x-p9-2]] set aside, its retries spent (blocked, Blocker diagnosis)" \
  "S7: next writes the released line naming the release and its label"
ok "$(deps a)|$(deps b)" "-|-" "S7: … then drops the entries"
ok "$(ev '[[d["act"], d.get("cause"), d.get("task"), d.get("removed")] for d in L][-1]')" '["released","set-aside","x-p9-2",2]' \
  "S7: the Run record line carries act released, cause set-aside"
has "$(starts)" '"a","b"' "S7: next starts a and b in the same call"
ok "$(q "$out" '[[e["cause"], e["label"], e["removed"]] for e in d["speedHoldReleased"]]')" '[["set-aside","(blocked, Blocker diagnosis)",2]]' \
  "S7: speedHoldReleased reports it"

scen s7b
mkro ro "max_review_rounds: 3" x-p9-2 u a b
mkt x-p9-2 open ro "$MARK" 'depends-on: "[[u]]"'; mkt u open ro; mkt a open ro; mkt b open ro
sh_ apply
ok "$(deps u)|$(deps a)" "-|x-p9-2" "S7b: u, upstream of the release, is never held"
blocked u 'auto_retries: 0'
nxt
ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): [[u]] set aside, its retries spent (blocked, Blocker diagnosis)" \
  "S7b: a set-aside task the release depends on lets the hold go, naming it"

scen s7c
mkro ro "max_review_rounds: 3" x-p9-2 a b
mkt x-p9-2 open ro "$MARK"; mkt a open ro; mkt b open ro
sh_ apply
blocked x-p9-2 "$MARK" 'auto_retries: 2'
printf '\n### Run 1 (2026-11-11T10:00+00:00)\n\nverifier red: test_y\n\n<!-- run 1 end sha=abcdef012345 -->\n' >> "$D/x-p9-2.md"
ok "$(hf x-p9-2)" 'null' "S7c: a set-aside release with retries left reads a null humanFix"
nxt
ok "$(holdlines | grep -c released)|$(deps a)" "0|x-p9-2" "S7c (control): the hold stands"

# S7d: the release, or a unit upstream of it, leaves the queue while linked or not: the hold lets go.
s7d() {  # s7d <label> <mutation> <expected why> — one fresh fixture per row
  scen "s7d-$1"
  mkro ro "" x-p9-2 u a b; mkro ro2 "" v
  mkt x-p9-2 open ro "$MARK" 'depends-on: "[[u]]"'; mkt u open ro; mkt a open ro; mkt b open ro
  sh_ apply
  eval "$2"
  nxt
  if [ -n "$3" ]; then
    ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): $3" "S7d: $1: the hold lets go"
    ok "$(ev '[d.get("cause") for d in L][-1]')" '"left-queue"' "S7d: $1: cause left-queue"
    has "$(starts)" '"a","b"' "S7d: $1: a and b start"
  else
    ok "$(holdlines | grep -c released)|$(deps a)" "0|x-p9-2" "S7d: $1 (control): the hold stands"
  fi
}
s7d dropped 'setfm x-p9-2 status dropped' '[[x-p9-2]] left the queue (dropped)'
s7d parked 'setfm x-p9-2 status parked' '[[x-p9-2]] left the queue (parked)'
s7d deferred 'setfm x-p9-2 rollout -' '[[x-p9-2]] left the queue (deferred)'
s7d u-dropped 'setfm u status dropped' '[[u]] left the queue (dropped)'
s7d u-deferred 'setfm u rollout -' '[[u]] left the queue (deferred)'
s7d u-elsewhere 'setfm u rollout "\"[[ro2]]\""' ''
s7d u-here 'true' ''

# ── S8: two Speed fix phases never hold each other's tasks ─────────────────────────────────────────────────────────────────
scen s8
mkro ro "" x-p8-1 x-p8-2 x-p8-3 x-p9-1 x-p9-2 x-p9-3 u
for t in x-p8-1 x-p8-2 x-p9-1 x-p9-2; do mkt "$t" open ro "$MARK"; done
mkt x-p8-3 open ro; mkt x-p9-3 open ro; mkt u open ro
sh_ apply
ok "$(deps x-p8-1),$(deps x-p8-2),$(deps x-p9-1),$(deps x-p9-2)" "-,-,-,-" "S8: no marked task gets any entry"
ok "$(deps x-p9-3)|$(deps x-p8-3)|$(deps u)" "x-p8-2|x-p9-2|x-p8-2,x-p9-2" \
  "S8: each phase's unmarked member is held only by the other phase; an unmarked task by both"

# ── S9: a red-master fix joined under a hold is not held ───────────────────────────────────────────────────────────────────
scen s9
base; sh_ apply
mkt rf open - 'completion_red_of: "[[ro-old]]"'; mkt mr open - 'master_red_since: 2026-11-10T10:00+00:00'
jn --tasks rf,mr
ok "$rc|$(deps rf)|$(deps mr)" "0|-|x-p9-2" "S9: completion_red_of: exempts it; master_red_since: does not"

# ── S10: the phase's own tasks start under its hold ────────────────────────────────────────────────────────────────────────
scen s10
base; sh_ apply
nxt --dry-run
ok "$(starts)" '["x-p9-1","x-p9-2","x-p9-3"]' "S10: next --dry-run starts the phase's own tasks, and only them"

# ── S11: a supersede lifts the hold, carry copies the record, apply on the new note puts it back ───────────────────────────
scen s11
base; sh_ apply
setfm ro paused 2026-11-11T11:30+00:00
sh_ lift
ok "$rc|$(deps a)|$(deps b)" "0|-|-" "S11: lift takes every recorded entry off"
has "$out" "speed-hold lifted [[x-p9-2]] (p9): 2 entries" "S11: … and says so"
run carry --from "$D/ro.md" --tasks-dir "$D" --dry-run
has "$out" "speed_hold [[x-p9-2]] (p9) standing, 2 recorded" "S11: the carry preview names the standing hold"
mkro ro2 'supersedes: "[[ro]]"' x-p9-1 x-p9-2 x-p9-3 a b c d f
run carry --from "$D/ro.md" --to "$D/ro2.md" --tasks-dir "$D"
ok "$rc|$(holdlines ro2)" "0|- $STAMP hold [[x-p9-2]] (p9, schedule): [[a]], [[b]]" "S11: carry --to appends the section's lines"
before=$(cksum < "$D/ro2.md")
run carry --from "$D/ro.md" --to "$D/ro2.md" --tasks-dir "$D"
ok "$(cksum < "$D/ro2.md")" "$before" "S11: a re-run writes nothing to the new note"
RO=ro2 sh_ apply
ok "$rc|$(deps a)|$(deps b)" "0|x-p9-2|x-p9-2" "S11: apply on the new note re-stamps the queued carried tasks"
has "$out" "speed-hold restamp [[x-p9-2]] on [[a]]" "S11: … naming each"

scen s11b
base; sh_ apply
setfm ro paused 2026-11-11T11:30+00:00
sh_ lift
dfr --tasks x-p9-2 --rollout "$D/ro.md"
mkro ro2 'supersedes: "[[ro]]"' x-p9-1 x-p9-3 a b c d f
run carry --from "$D/ro.md" --to "$D/ro2.md" --tasks-dir "$D"
RO=ro2 sh_ apply
ok "$(holdlines ro2 | grep released)" "- $STAMP released [[x-p9-2]] (p9): [[x-p9-2]] left the queue (deferred)" \
  "S11: a hold whose release was deferred out before the carry is released at the new note's apply"
ok "$(deps a)|$(deps b)" "-|-" "S11: … and holds nothing"

# ── S12: a task upstream of a mark is never held ───────────────────────────────────────────────────────────────────────────
scen s12
mkro ro "" x-p9-2 u v a
mkt x-p9-2 open ro "$MARK" 'depends-on: "[[u]]"'; mkt u open ro 'depends-on: "[[v]]"'; mkt v open ro; mkt a open ro
sh_ apply
ok "$(deps u)|$(deps v)|$(deps a)" "v|-|x-p9-2" "S12: u and v, upstream of the release (v transitively), are never held"

# S12b: a later join makes a held task upstream of a mark: its entry is dropped.
scen s12b
mkro ro "" x-p8-1 x-p8-2 u a
mkt x-p8-1 open ro "$MARK"; mkt x-p8-2 open ro "$MARK"; mkt u open ro; mkt a open ro
mkt x-p9-1 open - "$MARK"; mkt x-p9-2 open - "$MARK" 'depends-on: "[[u]]"'
sh_ apply
ok "$(deps u)" "x-p8-2" "S12b: phase 8 holds u"
jn --tasks x-p9-1,x-p9-2
has "$out" "speed-hold drop [[x-p8-2]] from [[u]]: upstream of [[x-p9-2]]" "S12b: join drops u's entry, upstream of the joined mark"
ok "$(deps u)|$(deps a)|$(deps x-p9-1)|$(deps x-p9-2)" "-|x-p8-2,x-p9-2|-|u" "S12b: u gets no entry; the marks get nothing"
ok "$(holdlines | tail -1)" "- $STAMP hold [[x-p9-2]] (p9, join): [[a]]" "S12b: phase 9's hold line"
st
ok "$(q "$out" '[[h["release"], h["missing"], h["outOfReach"]] for h in d["speedHolds"]]')" '[["x-p8-2",[],[]],["x-p9-2",[],[]]]' \
  "S12b: status lists u in neither missing nor outOfReach"
sh_ apply
ok "$(printf '%s' "$out" | tail -1)" "[no-change]" "S12b: a following apply writes nothing"

scen s12c
mkro ro "" x-p8-1 x-p8-2 x-p9-1 x-p9-2 u a
for t in x-p8-1 x-p8-2 x-p9-1 x-p9-2; do mkt "$t" open ro "$MARK"; done
mkt u open ro; mkt a open ro
sh_ apply
ok "$(deps u)" "x-p8-2,x-p9-2" "S12b (next): both phases hold u"
setfm x-p9-2 depends-on '"[[u]]"'
st
ok "$(q "$out" '[h["outOfReach"] for h in d["speedHolds"]]')" \
  '[[{"task":"u","why":"upstream of [[x-p9-2]]"}],[{"task":"u","why":"upstream of [[x-p9-2]]"}]]' \
  "S12b (next): status lists u out of reach of both holds"
before=$(sums)
nxt --dry-run
ok "$(sums)" "$before" "S12b (next): next --dry-run writes nothing"
has "$(starts)" '"u"' "S12b (next): … and starts u"
nxt
ok "$(deps u)" "-" "S12b (next): next drops both entries"

# ── S13: status reads the holds ────────────────────────────────────────────────────────────────────────────────────────────
scen s13
base; sh_ apply
st
ok "$(q "$out" 'd["speedHolds"]')" \
  '[{"by":"schedule","ended":null,"held":["a","b"],"lettingGo":null,"missing":[],"moved":null,"outOfReach":[],"phase":"p9","release":"x-p9-2","released":null,"standing":true}]' \
  "S13: a standing hold"
sh_ lift
st
ok "$(q "$out" '[h["missing"] for h in d["speedHolds"]]')" '[["a","b"]]' "S13: after a lift, missing names the recorded tasks"
setfm x-p9-2 depends-on '"[[b]]"'
st
ok "$(q "$out" '[h["missing"] for h in d["speedHolds"]]')" '[["a"]]' "S13: a recorded task now upstream of a mark is not missing"
sh_ apply
ok "$(deps a)|$(deps b)" "x-p9-2|-" "S13/S18: apply re-stamps only the one still in reach"
sh_ release --release x-p9-2
st
ok "$(q "$out" '[[h["standing"], h["released"]] for h in d["speedHolds"]]')" "[[false,{\"at\":\"$STAMP\",\"why\":\"by hand\"}]]" \
  "S13: after release, released"

# ── S14: the replay re-checks the task under the lock ──────────────────────────────────────────────────────────────────────
scen s14
base
python3 - "$SCRIPT" "$D/a.md" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr_under_test", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
p = Path(sys.argv[2])
note = m.Note(p)
m._speed_hold_add(note, "x-p9-2", "ro")
p.write_text(p.read_text().replace("status: open", "status: in_progress"))
note.save()
PY
ok "$(deps a)|$(grep -m1 '^status:' "$D/a.md")" "-|status: in_progress" "S14: a task that started before the save gets no entry"

# ── S15: a released hold is never re-made for the same release ─────────────────────────────────────────────────────────────
scen s15
base; sh_ apply; sh_ release --release x-p9-2
sh_ apply
ok "$(holdlines | grep -c ' hold ')|$(deps a)" "1|-" "S15: no second hold for the released x-p9-2"
has "$out" "speed-hold skip [[x-p9-2]] (p9): released (by hand)" "S15: … its skip line"

# ── S16: an engine that predates p54-13 gets no hold, and the join goes on ─────────────────────────────────────────────────
scen s16
OLDROOT="$TMP/snaps/old"; mkdir -p "$OLDROOT/skills/execute/scripts"
printf 'print("an engine before p54-13")\n' > "$OLDROOT/skills/execute/scripts/reconcile-rollout.py"
ENGINE_ROOT="$OLDROOT" mkro ro 'engine_sha: 89f5429b175c0123456789abcdef0123456789ab' a
mkt a open ro; mkt x-p9-1 open - "$MARK"; mkt x-p9-2 open - "$MARK"
jn --tasks x-p9-1,x-p9-2
ok "$rc|$(grep -c '^rollout: "\[\[ro\]\]"' "$D/x-p9-2.md")" "0|1" "S16: an old-root join writes its rows and stamps"
ok "$(holdlines)|$(deps a)" "|-" "S16: … but no section line and no entry"
ok "$(printf '%s\n' "$err" | grep -c '^WARN: speed-hold: \[\[ro\]\]: engine 89f5429b175c has no Speed fix let-go (it predates p54-13) (engine-snapshot.md § Cross-version state): no Speed fix hold made$')" 1 \
  "S16: … with one WARN line"
scen s16b
ENGINE_ROOT="$OLDROOT" mkro ro 'engine_sha: 89f5429b175c0123456789abcdef0123456789ab' x-p9-2 a
mkt x-p9-2 open ro "$MARK"; mkt a open ro "depends-on:" '  - "[[x-p9-2]]"'; mkt e open -
printf '\n## Speed fix holds\n\n- 2026-11-10T10:00+00:00 hold [[x-p9-2]] (p9, schedule): [[a]]\n' >> "$D/ro.md"
jn --tasks e
ok "$rc|$(deps e)|$(holdlines | grep -c .)" "0|-|1" "S16: a standing hold on an old root: the joined task is not held, no line"
has "$err" "WARN: speed-hold: [[ro]]:" "S16: … with the WARN"
ok "$(grep -c '^SPEED_HOLD_ENGINE = 1$' "$SCRIPT")" 1 "S16: this tree carries the marker line once"

# ── S17: folds: the release is the combined unit; a combined note is read per unit ─────────────────────────────────────────
scen s17
mkro ro "" x-p8-1 x-p9-1 cmb cm2 a
mkt x-p8-1 open ro "$MARK"; mkt x-p9-1 open ro "$MARK"
mkt x-p9-2 merged ro "$MARK" 'merged_into: "[[cmb]]"'; mkt cmb open ro
mkt x-p9-3 merged ro 'merged_into: "[[cm2]]"'; mkt xx merged ro 'merged_into: "[[cm2]]"'; mkt cm2 open ro
mkt a open ro
sh_ apply
ok "$(deps cmb)|$(deps a)|$(deps cm2)" "-|x-p8-1,cmb|x-p8-1" \
  "S17: x-p9-2 folded into cmb: cmb is the release and never held; cm2, folding x-p9-3, is exempt from p9 and held by p8"

# ── S19: clean-up: next drops a released hold's leftover entry; defer drops a deferred task's recorded entries ─────────────
scen s19
base; sh_ apply; sh_ release --release x-p9-2
setfm a depends-on '"[[x-p9-2]]"'
nxt
ok "$(deps a)" "-" "S19: next drops a released hold's leftover entry"

scen s19b
mkro ro "" x-p9-2 x-p8-1 a b h2
mkt x-p9-2 open ro "$MARK"; mkt x-p8-1 open ro "$MARK"; mkt z done -
mkt a open ro 'depends-on: ["[[x-p9-2]]", "[[z]]"]'; mkt b open ro 'depends-on:' '  - "[[x-p8-1]]"' '  - "[[x-p9-2]]"'
mkt h2 open ro 'depends-on: "[[x-p9-2]]"'
printf '\n## Speed fix holds\n\n- 2026-11-10T10:00+00:00 hold [[x-p9-2]] (p9, schedule): [[a]], [[b]]\n- 2026-11-10T10:00+00:00 hold [[x-p8-1]] (p8, schedule): [[b]]\n' >> "$D/ro.md"
cp "$D/ro.md" "$TMP/ro.s19b"
before=$(sums)
dfr --tasks a --rollout "$D/ro.md" --dry-run
ok "$rc|$(sums)" "0|$before" "S19: defer --dry-run writes nothing"
has "$out" "speed-hold dropped [[x-p9-2]] from a (deferred) (dry-run)" "S19: … and names the entry it would drop"
dfr --tasks a --rollout "$D/ro.md"
ok "$rc|$(grep -c '^rollout:' "$D/a.md")|$(grep -m1 '^depends-on:' "$D/a.md")" '0|0|depends-on: ["[[z]]"]' \
  "S19: defer clears rollout: and removes the recorded entry, keeping the inline list's other item"
has "$out" "speed-hold dropped [[x-p9-2]] from a (deferred)" "S19: … naming it"
cmp -s "$D/ro.md" "$TMP/ro.s19b"; ok "$?" 0 "S19: the rollout note is byte-identical"
dfr --tasks b,h2 --rollout "$D/ro.md"
ok "$(deps b)|$(deps h2)" "-|x-p9-2" "S19: a task held by two holds loses both; an unrecorded hand-written entry stays"
jn --tasks a
ok "$rc|$(deps a)|$(holdlines | grep -c .)" "0|z,x-p9-2|2" "S19: a later join re-stamps the recorded task with no new hold line"

scen s19c
mkro ro "" a; mkt a open ro 'depends-on: "[[z]]"'
dfr --tasks a --rollout "$D/ro.md"
ok "$out|$(deps a)" "a: deferred->open (rollout/owner and started/merged/integrating/ready/gates_signed/descope_armed/handed_back/auto_retries_used/quota_retries_used/auto_retry_sha/auto_retry_at cleared, a legacy \`wave:\` included) [written]|z" \
  "S19 (control): with no section, defer prints and writes as before"

# ── S20: a phase note naming a release that is no marked task of the phase makes no hold ───────────────────────────────────
scen s20
base
printf -- '---\ntags: [phase]\nstatus: open\nspeed_fix_release: "[[x-p9-3]]"\n---\n' > "$P/x-p9-speed.md"
sh_ apply
ok "$rc|$(deps a)|$(holdlines)" "0|-|" "S20: an unmarked member named as the release: no hold"
has "$err" "WARN: speed-hold: p9's speed_fix_release: [[x-p9-3]] is not a marked task of the phase: no hold for p9" "S20: … with its WARN"
printf -- '---\ntags: [phase]\nstatus: open\nspeed_fix_release: "[[h]]"\n---\n' > "$P/x-p9-speed.md"
sh_ apply
ok "$(deps a)|$(holdlines)" "-|" "S20: a task outside the phase named as the release: no hold"
has "$err" "speed_fix_release: [[h]] is not a marked task of the phase" "S20: … with its WARN"

# ── S21: the hold follows the phase's release at every join and apply, never at next ───────────────────────────────────────
scen s21
base; sh_ apply; mkt x-p9-4 open - "$MARK"
chmod 444 "$D/b.md"
jn --tasks x-p9-4
ok "$rc" 1 "S21: a failed stamp in a move exits 1"
ok "$(holdlines | grep -c 'released')|$(deps a)" "0|x-p9-2,x-p9-4" "S21: … before the old hold is released"
chmod 644 "$D/b.md"
jn --tasks x-p9-4
ok "$rc" 0 "S21: the re-run finishes"
ok "$(holdlines | tail -2)" "- $STAMP hold [[x-p9-4]] (p9, join): [[a]], [[b]]
- $STAMP released [[x-p9-2]] (p9): superseded by [[x-p9-4]]" "S21: the new hold line, then the old one released, each once"
ok "$(deps a)|$(deps b)" "x-p9-4|x-p9-4" "S21: a and b carry the new release only"
ok "$(ev '[[d["act"], d["release"], d.get("cause"), d.get("to")] for d in L][1:]')" '[["made","x-p9-4",null,null],["released","x-p9-2","superseded","x-p9-4"]]' \
  "S21: made for the new release, released superseded for the old"

scen s21b
base; sh_ apply
printf -- '---\ntags: [phase]\nstatus: open\nspeed_fix_release: "[[x-p9-1]]"\n---\n' > "$P/x-p9-speed.md"
cp "$D/ro.md" "$TMP/ro.s21b"
nxt
cmp -s "$D/ro.md" "$TMP/ro.s21b"; ok "$?" 0 "S21b: next never moves a hold"
st
ok "$(q "$out" '[h["moved"] for h in d["speedHolds"]]')" '["x-p9-1"]' "S21b: status shows the move to come"
sh_ apply
ok "$(deps a)|$(deps b)|$(holdlines | tail -1)" "x-p9-1|x-p9-1|- $STAMP released [[x-p9-2]] (p9): superseded by [[x-p9-1]]" \
  "S21b: apply moves the hold"

scen s21c
base; sh_ apply
setfm x-p9-1 status done
printf -- '---\ntags: [phase]\nstatus: open\nspeed_fix_release: "[[x-p9-1]]"\n---\n' > "$P/x-p9-speed.md"
sh_ apply
ok "$(deps a)|$(holdlines | grep -c released)" "x-p9-2|0" "S21c (control): a move to a landed release keeps the hold"
has "$out" "speed-hold skip [[x-p9-1]] (p9): landed; [[x-p9-2]] kept" "S21c: … with its skip line"

# ── usage: a serial note and another protocol exit 2 ───────────────────────────────────────────────────────────────────────
scen usage
mkro ro "shape: serial" a; mkt a open ro
sh_ apply
ok "$rc" 2 "usage: a serial note exits 2"
mkro ro "" a; sed -i.bak 's/^protocol_version: 5$/protocol_version: 4/' "$D/ro.md"
sh_ apply
ok "$rc" 2 "usage: protocol 4 exits 2"

exit "$fail"
