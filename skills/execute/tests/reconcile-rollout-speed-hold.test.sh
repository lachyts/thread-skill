#!/usr/bin/env bash
# The Speed fix hold (p54-13, ADR 0084 d4; skills/_shared/vault-grammar.md § Speed fix hold): a phase whose tasks carry
# a cited `speed_fix:` holds every other queued task of its rollout through plain `depends-on:` entries on the phase's
# release, recorded on the rollout note's `## Speed fix holds` section. reconcile-rollout.py's `speed-hold apply |
# release | lift`, and the hold's writes in `join`, `next`, `defer` and `carry`, and its reading in `status`. The mark and
# its refusals (S2, S2b), the release (the phase's last task, or the one its note names: S1, S1b, S1c, S1d, S20), the reach
# (one rule: S1, S8, S8b, S9, S12, S17, S22), the record (S3, S6, S13), join (S2, S4, S4b, S4c, S4d, S4e, S8b, S12b, S21,
# S21d), the release landing (S5, S6b), the let-go (S7, S17b), supersede and Put back (S11, S18), clean-up and defer
# (S19), the moving release (S21) and the cross-version gate (S16). Temp vaults only; no network.
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
# jn_late <join args...>: join in process, the rollout note made read-only once the rows' save and the stamps are
# written (as _speed_join_rest, the hold's writes, begins), so the hold line's save fails as a lock timeout would.
jn_late() {
  HOME="$EH" python3 - "$SCRIPT" "$D/ro.md" join --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" "$@" \
    > "$TMP/out" 2> "$TMP/err" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("rr_under_test", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
ro, rest = sys.argv[2], m._speed_join_rest
def late(*a, **k):
    os.chmod(ro, 0o444)
    return rest(*a, **k)
m._speed_join_rest = late
sys.argv = [sys.argv[1]] + sys.argv[3:]
sys.exit(m.main())
PY
  rc=$?; out=$(cat "$TMP/out"); err=$(cat "$TMP/err")
}
st() { run status --rollout "$D/${RO:-ro}.md" --tasks-dir "$D" --now "$NOW"; }
dfr() { run defer --tasks-dir "$D" "$@"; }
starts() { q "$out" 'sorted(d["start"])'; }
# hf <slug> — the set-aside task's humanFix act through the engine's own read (moving's: _retry_budget, task_inputs,
# auto_retry_verdict); with a null humanFix, `take-out` or `overtime` when its normal budget is spent (p39-14), else null.
hf() {
  HOME="$EH" python3 - "$SCRIPT" "$D/$1.md" "$D/ro.md" "$NOW" <<'PY'
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr_under_test", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
path, ro = Path(sys.argv[2]), m.Note(Path(sys.argv[3]))
note = m.Note(path)
budget = m._retry_budget(note, ro)
k = budget["maxReviewRounds"]["value"] if budget["maxReviewRounds"] and not budget["error"] else None
inp = m._lead().task_inputs(path, note, max_rounds=k, repo=None)
v = m._lead().auto_retry_verdict(path, note, inp, ro, m._parse_ts(sys.argv[4]))
fix = v["humanFix"]
print(json.dumps(fix["act"] if fix else ("take-out" if v["takeOut"] else "overtime" if v["overtime"] else None)))
PY
}

# The standard queue: phase 9's unmarked x-p9-1 and marked x-p9-2, its last task and so its release; a and b open; c
# running; d awaiting Integration; f set aside; g done; h open on no rollout.
base() {
  mkro ro "" x-p9-1 x-p9-2 a b c d f g
  mkt x-p9-1 open ro; mkt x-p9-2 open ro "$MARK"
  mkt a open ro; mkt b open ro; mkt c in_progress ro "owner: lead"
  mkt d review ro "pr: https://github.com/o/r/pull/4"; mkt f blocked ro; mkt g done ro; mkt h open -
}

# ── S1: a fresh apply holds a and b ────────────────────────────────────────────────────────────────────────────────────────
scen s1
base
before=$(cd "$D" && cksum x-p9-1.md x-p9-2.md c.md d.md f.md g.md h.md)
sh_ apply
ok "$rc" 0 "S1: speed-hold apply exits 0"
ok "$(deps a)|$(deps b)" "x-p9-2|x-p9-2" "S1: a and b gain depends-on [[x-p9-2]], the phase's last task"
ok "$(cd "$D" && cksum x-p9-1.md x-p9-2.md c.md d.md f.md g.md h.md)" "$before" \
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
ok "$(deps a)|$(deps b)|$(deps x-p9-2)" "x-p9-1|x-p9-1|-" \
  "S1b: the phase note's speed_fix_release names an earlier member, unmarked x-p9-1: the release"
ok "$(holdlines)" "- $STAMP hold [[x-p9-1]] (p9, schedule): [[a]], [[b]]" "S1b: … its hold line"

# S1c: the phase's last task is unmarked: it is the release, so the hold stands once the marked task lands.
scen s1c
mkro ro "" x-p9-1 x-p9-2 a
mkt x-p9-1 open ro "$MARK"; mkt x-p9-2 open ro; mkt a open ro
sh_ apply
ok "$(deps a)|$(deps x-p9-1)|$(deps x-p9-2)" "x-p9-2|-|-" "S1c: an unmarked last task is the release, and is never held"
setfm x-p9-1 status done
nxt --dry-run
ok "$(starts)" '["x-p9-2"]' "S1c: the marked task landed: next starts the release only, a waits on it"

# S1d: a task number that starts with digits (`1b`, as the vault's chorus-p105-2b-… is named) is a phase member, its
# leading digits ordering it and the whole number breaking a tie: 1 < 1b < 2.
scen s1d
mkro ro "" x-p9-1 x-p9-1b x-p9-2 a
mkt x-p9-1 open ro "$MARK"; mkt x-p9-1b open ro; mkt x-p9-2 open ro; mkt a open ro
sh_ apply
ok "$(holdlines)" "- $STAMP hold [[x-p9-2]] (p9, schedule): [[a]]" "S1d: x-p9-1b is p9's own: never held by p9's hold"
ok "$(deps a)|$(deps x-p9-1)|$(deps x-p9-1b)|$(deps x-p9-2)" "x-p9-2|-|-|-" "S1d: … only a carries the entry"
scen s1d-tie
mkro ro "" x-p9-1 x-p9-1b a
mkt x-p9-1 open ro "$MARK"; mkt x-p9-1b open ro; mkt a open ro
sh_ apply
ok "$(holdlines)" "- $STAMP hold [[x-p9-1b]] (p9, schedule): [[a]]" "S1d: 1b comes after 1, so it is the phase's release"
scen s1d-alone
mkro ro "" y-p3-1b a
mkt y-p3-1b open ro "$MARK"; mkt a open ro
sh_ apply
ok "$(holdlines)|$(deps a)|$(deps y-p3-1b)" "- $STAMP hold [[y-p3-1b]] (p3, schedule): [[a]]|y-p3-1b|-" \
  "S1d: a marked y-p3-1b is its phase's release and holds the queue"
hasnt "$out" "outside a phase" "S1d: … it is no Speed fix outside a phase"

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
# A join under the hold names its own refused task's mark, never again those of the tasks already on the queue.
mkt e open -; mkt r7 open - 'speed_fix: true'
jn --tasks e,r7
ok "$rc|$(deps e)|$(deps r7)" "0|x-p9-2|x-p9-2" "S2: a join under the hold holds the joined tasks"
has "$out" "speed-hold refuse [[r7]]: a flag (true), not a citation" "S2: … names the joined task's refused mark"
hasnt "$out" "speed-hold refuse [[r1]]" "S2: … and not the refusal of a task already on the queue"

# S2b: a join of a task whose mark is refused, on a rollout with no hold, still names the refusal and makes nothing.
scen s2b
mkro ro "" a; mkt a open ro; mkt r1 open - 'speed_fix: true'
jn --tasks r1
ok "$rc|$(deps r1)|$(holdlines)" "0|-|" "S2b: the join goes on, with no hold"
has "$out" "speed-hold refuse [[r1]]: a flag (true), not a citation" "S2b: … and prints the joined task's refusal"

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

# ── S4c: the phase's release joins a rollout its marked task is already on: the join makes the phase's hold ─────────────
# Schedule step 8 leaves a waiting task out and schedules it once its blocker lands; on a join, the join is the only
# Speed fix step, so the hold is read whenever a Speed fix is in play, not only when the joining task is marked.
scen s4c
mkro ro "" x-p9-1 a b
mkt x-p9-1 open ro "$MARK"; mkt a open ro; mkt b open ro; mkt x-p9-2 open -
sh_ apply
has "$out" "speed-hold skip [[x-p9-2]] (p9): not on [[ro]]" "S4c: apply skips the phase whose release is on no rollout"
ok "$(holdlines)" "" "S4c: … and writes no section"
jn --tasks x-p9-2
ok "$rc" 0 "S4c: the release's join exits 0"
has "$out" "speed-hold made [[x-p9-2]] (p9, join): [[a]], [[b]]" "S4c: joining the phase's unmarked release makes its hold"
ok "$(holdlines)" "- $STAMP hold [[x-p9-2]] (p9, join): [[a]], [[b]]" "S4c: … its hold line"
ok "$(deps a)|$(deps b)|$(deps x-p9-1)|$(deps x-p9-2)" "x-p9-2|x-p9-2|-|-" "S4c: a and b carry the entry; the phase's own carry none"
nxt --dry-run
ok "$(starts)" '["x-p9-1","x-p9-2"]' "S4c: next starts only the phase's own tasks"
sh_ apply
ok "$(printf '%s' "$out" | tail -1)" "[no-change]" "S4c: a following apply agrees with the join's hold"

# S4c (control): a phased task whose phase has no mark joins as before: no section, no speed-hold line.
scen s4c-control
mkro ro "" x-p7-1 a
mkt x-p7-1 open ro; mkt a open ro; mkt x-p7-2 open -
jn --tasks x-p7-2
ok "$rc|$(holdlines)|$(deps a)|$(deps x-p7-1)" "0||-|-" "S4c (control): an unmarked phase's join writes no hold"
hasnt "$out$err" "speed-hold" "S4c (control): … and prints no speed-hold line"

# S4d: a mark added by hand after the schedule (no section yet) is followed at the next join, of any task.
scen s4d
mkro ro "" x-p9-1 x-p9-2 a b
mkt x-p9-1 open ro; mkt x-p9-2 open ro; mkt a open ro; mkt b open ro; mkt e open -
sh_ apply
ok "$(holdlines)|$(printf '%s' "$out" | tail -1)" "|[no-change]" "S4d: with no mark, apply writes nothing"
setfm x-p9-1 speed_fix '"docs/audits/x.md row 4"'
jn --tasks e
ok "$rc" 0 "S4d: an unrelated task's join exits 0"
has "$out" "speed-hold made [[x-p9-2]] (p9, join): [[a]], [[b]], [[e]]" "S4d: the join makes the hand-marked phase's hold"
ok "$(deps a)|$(deps b)|$(deps e)|$(deps x-p9-1)|$(deps x-p9-2)" "x-p9-2|x-p9-2|x-p9-2|-|-" \
  "S4d: the queue's other tasks, the joined one included, are held"

# S4e: the rollout note turns read-only after the rows' save and the stamps, so the hold line's save fails: join exits 1
# with its ERROR line naming what it wrote, never a traceback, and the same join, re-run, makes the hold.
scen s4e
mkro ro "" x-p9-1 a b
mkt x-p9-1 open ro "$MARK"; mkt a open ro; mkt b open ro; mkt x-p9-2 open -
jn_late --tasks x-p9-2
ok "$rc" 1 "S4e: a hold line whose save fails exits 1"
has "$err" "ERROR: join: cannot write: " "S4e: … with join's ERROR line"
has "$err" "(written so far: [[ro]]'s rows, [[x-p9-2]]'s rollout: stamp; a re-run of the same join finishes it)" \
  "S4e: … naming the rows and the stamp already written, and the re-run"
hasnt "$err" "Traceback" "S4e: … and no traceback"
ok "$(holdlines)|$(deps a)|$(deps b)" "|-|-" "S4e: no hold line and no entry was written"
chmod 644 "$D/ro.md"
jn --tasks x-p9-2
ok "$rc|$(holdlines)" "0|- $STAMP hold [[x-p9-2]] (p9, join): [[a]], [[b]]" "S4e: the same join, re-run, makes the hold"
ok "$(deps a)|$(deps b)" "x-p9-2|x-p9-2" "S4e: … and its entries"

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

# S6b: a hold whose release landed ended by itself: a hand release names it and writes nothing.
scen s6b
base; sh_ apply
setfm x-p9-2 status done
hl=$(holdlines); n=$(ev 'len(L)'); before=$(sums)
for how in "--release x-p9-2" "--all"; do
  sh_ release $how
  ok "$rc|$(printf '%s' "$out" | tail -1)|$(sums)|$(holdlines)|$(ev 'len(L)')" "0|[no-change]|$before|$hl|$n" \
    "S6b: release $how on an ended hold writes no line, no drop and no event"
  has "$out" "speed-hold ended [[x-p9-2]] (p9): its release landed; nothing released" "S6b: … and names it ended"
done

# ── S7: a hold that cannot release lets go, with its Run record line ───────────────────────────────────────────────────────
scen s7
base; mkro ro "max_review_rounds: 3" x-p9-1 x-p9-2 a b c d f g
sh_ apply
blocked x-p9-2 "$MARK" 'auto_retries: 0'
ok "$(hf x-p9-2)" '"take-out"' "S7: the set-aside release reads a take-out (its retries spent, ADR 0070)"
before=$(sums)
nxt --dry-run
has "$(starts)" '"a","b"' "S7e: next --dry-run starts a and b"
ok "$(q "$out" '[[e["release"], e["cause"], e["task"]] for e in d["speedHoldReleased"]]')|$(sums)" '[["x-p9-2","set-aside","x-p9-2"]]|'"$before" \
  "S7e: … names the let-go and writes nothing"
run moving --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW"
ok "$(sums)" "$before" "S7e: moving writes nothing"
has "$(q "$out" 'sorted(d["work"]["start"])')" '"a","b"' "S7e: moving reads a and b as starting"
nxt
ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): [[x-p9-2]] set aside, its retries spent (blocked, Blocker diagnosis; take-out pending)" \
  "S7: next writes the released line naming the release and its label"
ok "$(deps a)|$(deps b)" "-|-" "S7: … then drops the entries"
ok "$(ev '[[d["act"], d.get("cause"), d.get("task"), d.get("removed")] for d in L][-1]')" '["released","set-aside","x-p9-2",2]' \
  "S7: the Run record line carries act released, cause set-aside"
has "$(starts)" '"a","b"' "S7: next starts a and b in the same call"
ok "$(q "$out" '[[e["cause"], e["label"], e["removed"]] for e in d["speedHoldReleased"]]')" '[["set-aside","(blocked, Blocker diagnosis; take-out pending)",2]]' \
  "S7: speedHoldReleased reports it"

# S7g (p39-14, ADR 0070): a release whose budget is spent enters Overtime: the hold lets go then, not at the take-out.
scen s7g
mkro ro "max_review_rounds: 3" x-p9-2 a b
mkt x-p9-2 open ro "$MARK"; mkt a open ro; mkt b open ro
sh_ apply
blocked x-p9-2 "$MARK" 'auto_retries: 1' 'auto_retries_used: 1'
ok "$(hf x-p9-2)" '"overtime"' "S7g: the release reads an Overtime run, a null humanFix"
nxt
ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): [[x-p9-2]] set aside, its retries spent (blocked, Blocker diagnosis; overtime 0/3 used)" \
  "S7g: next lets the hold go, its label naming the Overtime"

scen s7b
mkro ro "max_review_rounds: 3" x-p9-2 u a b
mkt x-p9-2 open ro "$MARK" 'depends-on: "[[u]]"'; mkt u open ro; mkt a open ro; mkt b open ro
sh_ apply
ok "$(deps u)|$(deps a)" "-|x-p9-2" "S7b: u, upstream of the release, is never held"
blocked u 'auto_retries: 0'
nxt
ok "$(holdlines | tail -1)" "- $STAMP released [[x-p9-2]] (p9): [[u]] set aside, its retries spent (blocked, Blocker diagnosis; take-out pending)" \
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

# S7f: a gate-pending release waits on a sign-off, not on spent retries (a gate has none): the hold stands through next.
scen s7f
mkro ro "max_review_rounds: 3" x-p9-2 a b
mkt x-p9-2 open ro "$MARK"; mkt a open ro; mkt b open ro
sh_ apply
setfm x-p9-2 status gate-pending
printf '\n## Gated inputs\n\n- spend: a paid run — cap USD 5\n' >> "$D/x-p9-2.md"
ok "$(hf x-p9-2)" '"sign off gated input"' "S7f: the gate-pending release's humanFix is non-null"
nxt
ok "$(holdlines | grep -c released)|$(deps a)|$(deps b)" "0|x-p9-2|x-p9-2" "S7f: next keeps the hold: no released line, no drop"
ok "$(q "$out" 'd["speedHoldReleased"]')|$(starts)" "[]|[]" "S7f: … nothing released and nothing started"

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

# ── S8: two Speed fix phases joined to one queue hold no task of each other's ──────────────────────────────────────────────
# Each phase: a marked x-pN-1, an unmarked x-pN-2 and its unmarked last task x-pN-3, the release.
scen s8
mkro ro "" x-p8-1 x-p8-2 x-p8-3 x-p9-1 x-p9-2 x-p9-3 u
for t in x-p8-1 x-p9-1; do mkt "$t" open ro "$MARK"; done
for t in x-p8-2 x-p8-3 x-p9-2 x-p9-3; do mkt "$t" open ro; done
mkt u open ro
sh_ apply
ok "$(deps x-p8-1)|$(deps x-p8-2)|$(deps x-p8-3)|$(deps x-p9-1)|$(deps x-p9-2)|$(deps x-p9-3)" "-|-|-|-|-|-" \
  "S8: no member of p8 carries a p9 entry, and no member of p9 a p8 one"
ok "$(deps u)" "x-p8-3,x-p9-3" "S8: the unmarked task outside both is held by both"
nxt --dry-run
ok "$(starts)" '["x-p8-1","x-p8-2","x-p8-3","x-p9-1","x-p9-2","x-p9-3"]' "S8: no deadlock: every member of both phases starts"

# S8b: the second phase joins a queue whose first phase's hold already stamped one of its members: the join drops it.
scen s8b
mkro ro "" x-p8-1 x-p8-2 x-p8-3 x-p9-2 u
mkt x-p8-1 open ro "$MARK"; mkt x-p8-2 open ro; mkt x-p8-3 open ro; mkt x-p9-2 open ro; mkt u open ro
mkt x-p9-1 open - "$MARK"; mkt x-p9-3 open -
sh_ apply
ok "$(deps x-p9-2)|$(deps u)" "x-p8-3|x-p8-3" "S8b: with p9 unmarked, p8's hold stamps x-p9-2"
jn --tasks x-p9-1,x-p9-3
ok "$rc" 0 "S8b: the join exits 0"
has "$out" "speed-hold drop [[x-p8-3]] from [[x-p9-2]]: a member of p9" "S8b: p8's entry on x-p9-2 is dropped as out of reach"
ok "$(deps x-p9-1)|$(deps x-p9-2)|$(deps x-p9-3)|$(deps x-p8-2)|$(deps u)" "-|-|-|-|x-p8-3,x-p9-3" \
  "S8b: no member of either phase carries the other's entry; u is held by both"
ok "$(holdlines | tail -1)" "- $STAMP hold [[x-p9-3]] (p9, join): [[u]]" "S8b: p9's hold holds u alone"

# ── S9: a red-master fix joined under a hold is not held ───────────────────────────────────────────────────────────────────
scen s9
base; sh_ apply
mkt rf open - 'completion_red_of: "[[ro-old]]"'; mkt mr open - 'master_red_since: 2026-11-10T10:00+00:00'
# p54-7's red-master fix, as master-runs files it (_master_task): `master_red:` beside its other master_red_* keys.
mkt mm open - 'master_red: "o/r"' 'master_red_kind: suites' 'master_red_since: none'
jn --tasks rf,mr,mm
ok "$rc|$(deps rf)|$(deps mr)|$(deps mm)" "0|-|x-p9-2|-" \
  "S9: completion_red_of: and master_red: each exempt it; master_red_since: alone does not"

# ── S10: the phase's own tasks start under its hold ────────────────────────────────────────────────────────────────────────
scen s10
base; sh_ apply
nxt --dry-run
ok "$(starts)" '["x-p9-1","x-p9-2"]' "S10: next --dry-run starts the phase's own tasks, and only them"

# ── S11: a supersede lifts the hold, carry copies the record, apply on the new note puts it back ───────────────────────────
scen s11
base; sh_ apply
setfm ro paused 2026-11-11T11:30+00:00
sh_ lift
ok "$rc|$(deps a)|$(deps b)" "0|-|-" "S11: lift takes every recorded entry off"
has "$out" "speed-hold lifted [[x-p9-2]] (p9): 2 entries" "S11: … and says so"
run carry --from "$D/ro.md" --tasks-dir "$D" --dry-run
has "$out" "speed_hold [[x-p9-2]] (p9) standing, 2 recorded" "S11: the carry preview names the standing hold"
mkro ro2 'supersedes: "[[ro]]"' x-p9-1 x-p9-2 a b c d f
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
mkro ro2 'supersedes: "[[ro]]"' x-p9-1 a b c d f
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
mkro ro "" x-p8-1 cmb cm2 a
mkt x-p8-1 open ro "$MARK"
mkt x-p9-2 merged ro "$MARK" 'merged_into: "[[cmb]]"'; mkt cmb open ro
mkt x-p9-1 merged ro 'merged_into: "[[cm2]]"'; mkt xx merged ro 'merged_into: "[[cm2]]"'; mkt cm2 open ro
mkt a open ro
sh_ apply
ok "$(deps cmb)|$(deps a)|$(deps cm2)" "-|x-p8-1,cmb|-" \
  "S17: x-p9-2 folded into cmb: cmb is the release and never held; cm2, folding x-p9-1, is p9's: held by neither phase"

# S17b: the release is folded into a live combined unit after the hold is made: the hold stands, and apply moves it.
scen s17b
mkro ro "" x-p9-2 a cmb
mkt x-p9-2 open ro "$MARK"; mkt a open ro
sh_ apply
setfm x-p9-2 status merged; setfm x-p9-2 merged_into '"[[cmb]]"'; mkt cmb open ro
nxt
ok "$(holdlines | grep -c released)|$(deps a)|$(q "$out" 'd["speedHoldReleased"]')" "0|x-p9-2|[]" \
  "S17b: next keeps the hold on the folded release: its unit is still queued"
ok "$(starts)" '["cmb"]' "S17b: … and starts the combined unit only"
sh_ apply
ok "$(deps a)|$(holdlines | tail -1)" "cmb|- $STAMP released [[x-p9-2]] (p9): superseded by [[cmb]]" \
  "S17b: the next apply moves the hold to the combined unit"

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
ok "$rc|$(deps a)|$(holdlines | grep -c 'hold \[\[x-p9-2\]\]')" "0|z,x-p8-1,x-p9-2|1" \
  "S19: a later join re-stamps the recorded task with no new x-p9-2 hold line"
ok "$(holdlines | tail -1)" "- $STAMP hold [[x-p8-1]] (p8, join): [[a]]" "S19: … and phase 8's standing hold extends to it"

scen s19c
mkro ro "" a; mkt a open ro 'depends-on: "[[z]]"'
before=$(cksum < "$D/ro.md")
dfr --tasks a --rollout "$D/ro.md"
ok "$rc|$(printf '%s\n' "$out" | grep -c .)|$(printf '%s' "$out" | grep -c '^a: deferred->open (.*) \[written\]$')|$(deps a)|$(cksum < "$D/ro.md")" \
  "0|1|1|z|$before" "S19 (control): with no section, defer prints its one line and writes as before"

# ── S20: a phase note naming a release that is no member of the phase makes no hold ────────────────────────────────────────
scen s20
base
printf -- '---\ntags: [phase]\nstatus: open\nspeed_fix_release: "[[h]]"\n---\n' > "$P/x-p9-speed.md"
sh_ apply
ok "$rc|$(deps a)|$(holdlines)" "0|-|" "S20: a task outside the phase named as the release: no hold"
has "$err" "WARN: speed-hold: p9's speed_fix_release: [[h]] is not a member of the phase: no hold for p9" "S20: … with its WARN"

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

# S21d: the phase's new last task joins unmarked: it is the release now, so the join moves the hold to it.
scen s21d
base; sh_ apply; mkt x-p9-3 open -
jn --tasks x-p9-3
ok "$rc|$(deps a)|$(deps b)|$(deps x-p9-3)" "0|x-p9-3|x-p9-3|-" "S21d: an unmarked last task joining takes the hold, and is never held"
ok "$(holdlines | tail -2)" "- $STAMP hold [[x-p9-3]] (p9, join): [[a]], [[b]]
- $STAMP released [[x-p9-2]] (p9): superseded by [[x-p9-3]]" "S21d: … the new hold line, then the old one superseded"

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

# ── S22: a standing hold whose release lost its mark still never holds what its release depends on ─────────────────────────
scen s22
mkro ro "" x-p9-2 u a
mkt x-p9-2 open ro "$MARK" 'depends-on: "[[u]]"'; mkt u open ro; mkt a open ro
sh_ apply
setfm x-p9-2 speed_fix -
sh_ apply
ok "$rc|$(deps u)|$(deps a)" "0|-|x-p9-2" "S22: with the phase's mark gone, apply stamps nothing upstream of the standing release"
nxt --dry-run
ok "$(starts)|$(q "$out" 'd["halt"]')" '["u"]|null' "S22: next starts u, no halt"
setfm u depends-on '"[[x-p9-2]]"'
printf -- '- 2026-11-10T10:00+00:00 hold [[x-p9-2]] (p9, schedule): [[u]]\n' >> "$D/ro.md"
st
ok "$(q "$out" '[h["outOfReach"] for h in d["speedHolds"]]')" '[[{"task":"u","why":"upstream of [[x-p9-2]]"}]]' \
  "S22: an entry already on u is out of reach"
nxt
ok "$(deps u)|$(starts)" '-|["u"]' "S22: next drops it and starts u"

# ── usage: a serial note and another protocol exit 2 ───────────────────────────────────────────────────────────────────────
scen usage
mkro ro "shape: serial" a; mkt a open ro
sh_ apply
ok "$rc" 2 "usage: a serial note exits 2"
mkro ro "" a; sed -i.bak 's/^protocol_version: 5$/protocol_version: 4/' "$D/ro.md"
sh_ apply
ok "$rc" 2 "usage: protocol 4 exits 2"

exit "$fail"
