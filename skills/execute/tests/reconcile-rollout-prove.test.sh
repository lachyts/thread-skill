#!/usr/bin/env bash
# skills/execute/scripts/reconcile-rollout.py: a fix is done only once Proven (ADR 0078 d1; vault-grammar § Proven).
#   P1-P6   the brief's fixtures: a watched landing stays carried (review + merged:) and its dependant starts; merged but
#           not Live stays carried; Live with no clears: is done + proven; a [[rollout]] item that moved after live:
#   P2-P3   unwatched: no clears: is today's done, byte for byte, with no walk; clears: is carried with live: = merged:
#   P7-P12  the items: a task item, superseded_by: followed, a link that cannot move (on Lachy's word), a plain line by
#           --seen, --seen while not Live, --item
#   P13     the clears: grammar (block, flow and scalar forms, quoted escapes)
#   P14-P17 the repo key (PR_URL_RE's group 1 for a pr:, ORIGIN_SLUG_RE only for an origin), the live file, the merge
#           commit and gh's bound, a RACE revert
#   P18-P19 the queue reads a carried fix as landed; every verb that would undo or re-run a landing refuses it; resume
#   P20-P22 the --all walk (root carried fixes judged, Archive carry-back candidates carried back), carry-back's move,
#           a serial chain out of scope
#   P23-P25 --land's three outcomes, the dependants gate (_carry_readers) and an unstamped rollout's real engine (a
#           Primary stand-in without the marker), the JSON and carried-fixes.json
#   P26     reconcile's read-only approval lands through _land_outcome: a fix (clears:) carried, never done
#   P27     --seen on a note whose carry-back waits, or that the re-check turns owed: exit 1, nothing recorded
#   P28     carry-back reopens the done phase over a fix it leaves carried (root and Archive/), never another phase, and
#           never a phase over a fix it proves in the same pass
# Every row runs a seeded engine Primary's copy ($T/P, a main checkout holding this tree's files), never this tree's, so
# an unstamped rollout's engine (git_primary) is a known one wherever the suite runs. Hermetic: HOME, the global git
# config, the vaults, the events dir, the note locks and the live files are temp; gh is a stub; no network.
# bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/../../.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID XDG_STATE_HOME GIT_SSH_COMMAND
root=$(pwd -P)

T=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
T=$(cd "$T" && pwd -P)
trap 'chmod -R u+rwX "$T" 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$T/events}" THREAD_NOTE_LOCK_DIR="$T/note-locks"
export THREAD_GIT_ENV_DIR="$T/git-env" TMPDIR="$T/tmp" THREAD_HEAT_LEVEL=0
mkdir -p "$TMPDIR" "$T/bin" "$T/gh"
NOW=2026-11-11T12:00+00:00

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
# seed <dir>: this tree's plugin files, tracked and new (never ignored), as they are on disk; no __pycache__
# (engine-snapshot.test.sh's seed, copied).
seed() {
  local d="$1"
  mkdir -p "$d"
  if git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$root" ls-files -z --cached --others --exclude-standard -- skills hooks .claude-plugin .gitattributes \
      | (cd "$root" && python3 -c 'import os, shutil, sys
for p in sys.stdin.buffer.read().split(b"\0"):
    p = p.decode()
    if not p or not os.path.isfile(p) or "__pycache__" in p.split("/"):
        continue
    dst = os.path.join(sys.argv[1], p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(p, dst)' "$d")
  else
    local p; for p in skills hooks .claude-plugin .gitattributes; do [ -e "$root/$p" ] && cp -R "$root/$p" "$d/"; done
    find "$d" -name __pycache__ -prune -exec rm -rf {} +
  fi
}
# The engine Primary: a main checkout of this tree's files, so git_primary($T/P) is $T/P (it holds the marker).
git init -q "$T/P"; seed "$T/P"; git -C "$T/P" add -A; git -C "$T/P" commit -qm seed
RR="$T/P/skills/execute/scripts/reconcile-rollout.py"
RP="$T/P/skills/_shared/scripts/reconcile-project.py"

# The watched code checkout: its origin a github URL (no network), three commits: base, m1, m2.
git init -q "$T/target"; git -C "$T/target" remote add origin git@github.com:o/r.git
for c in base m1 m2; do git -C "$T/target" commit -q --allow-empty -m "$c"; done
M1=$(git -C "$T/target" rev-parse HEAD~1); M2=$(git -C "$T/target" rev-parse HEAD); BASE=$(git -C "$T/target" rev-parse HEAD~2)

# The stub gh: `pr view <ref>` prints $T/gh/pr-<key>.json (exec sleep 30 when $T/gh/sleep-<key> exists), `repo view`
# prints master; every call logged to $GHLOG.
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$PWD|$*" >> "$GHLOG"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
case "$1 $2" in
  "pr view") [ -f "$GHDIR/sleep-$(key "$3")" ] && exec sleep 30
             f="$GHDIR/pr-$(key "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1 ;;
  "repo view") echo master; exit 0 ;;
esac
exit 2
EOF
chmod +x "$T/bin/gh"
export GHLOG="$T/gh.log" GHDIR="$T/gh"; : > "$GHLOG"
gkey() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
# ghpr <ref> <json>: the stub's answer for one PR
ghpr() { printf '%s\n' "$2" > "$T/gh/pr-$(gkey "$1").json"; }
# A git that logs each call to $GITLOG, for the rows that count prove's reads.
REALGIT=$(command -v git); mkdir -p "$T/gitbin"
printf '#!/bin/sh\necho "$*" >> "$GITLOG"\nexec "%s" "$@"\n' "$REALGIT" > "$T/gitbin/git"; chmod +x "$T/gitbin/git"
export GITLOG="$T/git.log"
U=https://github.com/o/r/pull

# scen <name>: a fresh vault $V (Work/Tasks $TK, Work/Phases $PH) and live file $L (absent until live() writes it)
scen() { echo "== $1"; V="$T/$1"; TK="$V/Work/Tasks"; PH="$V/Work/Phases"; L="$V/live.json"; mkdir -p "$TK/Archive/Rollouts" "$PH"; }
# mk <path under $TK> [frontmatter lines...]: a task note; $BODY after its heading
mk() { local f="$TK/$1"; shift; mkdir -p "$(dirname "$f")"
  { printf -- '---\ntags: [task]\n'; local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n# %s\n%s' "$(basename "$f" .md)" "${BODY:-}"; } > "$f"; }
# ro <path under $TK> [frontmatter lines...]: a rollout note, Project root $T/target, $RBODY after its Notes
ro() { local f="$TK/$1"; shift; mkdir -p "$(dirname "$f")"
  { printf -- '---\ntags: [task, rollout]\nprotocol_version: 5\nparallel_ceiling: 3\n'; local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n%s' "$T/target" "${RBODY:-}"; } > "$f"; }
# live <head> [origin] [primary 0|1]: the live file $L, one entry for $T/target
live() { python3 -c 'import json, sys
f, h, o, p, k = sys.argv[1:6]
json.dump({"v": 1, "live": {k: {"origin": o, "head": h, "branch": "master", "since": "2026-11-11T00:00:00+00:00",
                               "primary": p == "1"}}}, open(f, "w"))' "$L" "$1" "${2:-git@github.com:o/r.git}" "${3:-0}" "$T/target"; }
# rr <args...> → $out $err $rc: the seeded Primary's reconcile-rollout.py
rr() { PATH="$T/bin:$PATH" python3 "$RR" "$@" > "$T/out" 2> "$T/err" < /dev/null; rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); }
# rrx <dir> <args...>: the same from another engine root
rrx() { local r="$1"; shift; PATH="$T/bin:$PATH" python3 "$r/skills/execute/scripts/reconcile-rollout.py" "$@" > "$T/out" 2> "$T/err" < /dev/null
  rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); }
md() { rr mark-done --tasks "$1" --tasks-dir "$TK" --live-file "$L" --now "${2:-$NOW}"; }
pv() { rr prove --tasks-dir "$TK" --live-file "$L" --now "$NOW" --gh-bin "$T/bin/gh" "$@"; }
# fm <path under $TK> <key>: a frontmatter value as written, or <none>
fm() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$TK/$1" "$2"; }
# j <python expr over d>: from the JSON on $out
j() { printf '%s' "$out" | python3 -c 'import json, sys
try:
    d = json.load(sys.stdin)
    v = eval(sys.argv[1], {"d": d})
except Exception as e:
    print("<%s>" % type(e).__name__); sys.exit(0)
print(v if isinstance(v, str) else json.dumps(v, sort_keys=True))' "$1"; }
# hx <python code> [args...]: run code with `mod`, the seeded Primary's module (its main never runs)
hx() { python3 -c 'import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
from pathlib import Path
exec(sys.argv[2], {"mod": mod, "Path": Path, "argv": sys.argv[3:]})' "$RR" "$@" 2>&1; }
proof() { sed -n '/^## Proof log$/,$p' "$TK/$1" | grep '^- ' ; }
sums() { local f; for f in "$@"; do cksum < "$f"; done; }
# A stamped snapshot without the marker (~/snaps/old) and one with it (~/snaps/new), under the hermetic HOME.
mkdir -p "$HOME/snaps/old/skills/execute/scripts" "$HOME/snaps/new/skills/execute/scripts"
printf 'print("an engine before ADR 0078")\n' > "$HOME/snaps/old/skills/execute/scripts/reconcile-rollout.py"
printf 'PROVEN_ENGINE = 1\n' > "$HOME/snaps/new/skills/execute/scripts/reconcile-rollout.py"
OLD='engine_snapshot: "~/snaps/old"'; OLDSHA='engine_sha: abc123def4567890abc123def4567890abc12345'
NEW='engine_snapshot: "~/snaps/new"'

# ════ P1: a watched repo, no clears: → mark-done writes the carried form; the queue reads it landed ═══════════════
scen p1
live "$M2"
RBODY=$'## Queue\n\n- [[p1-fix]]\n- [[p1-dep]]\n' ro p1-ro.md 'status: open'
mk p1-fix.md 'status: review' 'rollout: "[[p1-ro]]"' "pr: $U/1" 'integrating: 2026-11-11T11:00+00:00'
mk p1-dep.md 'status: open' 'rollout: "[[p1-ro]]"' 'depends-on:' '  - "[[p1-fix]]"'
md p1-fix
ok "$rc" 0 "P1: mark-done on a watched landing exits 0"
has "$out" "p1-fix: landed, carried (status: review; o/r is watched; done once Live)" "P1: … printed landed, carried"
ok "$(fm p1-fix.md status)|$(fm p1-fix.md merged)|$(fm p1-fix.md live)|$(fm p1-fix.md integrating)" \
   "review|$NOW|<none>|<none>" "P1: … review + merged:, no live: yet, integrating: removed"
has "$(proof p1-fix.md)" "landed, carried: o/r is watched" "P1: … a Proof log line"
has "$(grep -rh 'p1-fix' "$THREAD_EVENTS_DIR" 2>/dev/null | grep -c '"merged"')" "1" "P1: … the landing events fire (merged)"
rr next --rollout "$TK/p1-ro.md" --tasks-dir "$TK" --now "$NOW" --dry-run
ok "$(j 'd["start"]')" '["p1-dep"]' "P1: next reads it as merged: its dependant starts"
ok "$(j '[t for t in d.get("awaitingIntegration", [])]')" '[]' "P1: … and nothing awaits Integration"

# ════ P4 / P5 / P6: merged not live; live with no clears:; live with a moved [[rollout]] item ════════════════════
scen p456
live "$M1"
mk p4.md 'status: review' "pr: $U/4" 'merged: 2026-11-11T10:00+00:00' "merge_commit: $M2"
pv --tasks p4
ok "$rc|$(fm p4.md status)|$(fm p4.md live)" "0|review|<none>" "P4: merged, not live → stays review, no live:"
has "$out" "p4: landed, carried (not live: target at ${M1:0:12} lacks ${M2:0:12})" "P4: … not live: names the head and merge"
live "$M2"
mk p5.md 'status: review' "pr: $U/5" 'merged: 2026-11-11T10:00+00:00' "merge_commit: $M1"
pv --tasks p5
ok "$(fm p5.md status)|$(fm p5.md proven)|$(fm p5.md live)" "done|2026-11-11|$NOW" "P5: live, no clears: → done + proven + live:"
has "$out" "p5: proven (done; proven: 2026-11-11)" "P5: … proven line"
has "$(proof p5.md)" "live: target at ${M2:0:12} holds ${M1:0:12}" "P5: … the Live line in the Proof log"
ok "$(fm p5.md completed)" "<none>" "P5: … no completed: (prove writes none)"
ro p6-ro.md 'status: open'
mk p6-t.md 'status: in_progress' 'rollout: "[[p6-ro]]"' 'started: 2026-11-11T09:30+00:00'
mk p6.md 'status: review' "pr: $U/6" 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "[[p6-ro]]"'
mk p6c.md 'status: review' "pr: $U/6" 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T10:00+00:00' 'clears:' '  - "[[p6-ro]]"'
pv --tasks p6,p6c
ok "$(fm p6.md status)|$(fm p6.md proven)" "done|2026-11-11" "P6: its [[rollout]] item's task started after live: → done + proven"
ok "$(fm p6c.md status)|$(fm p6c.md proven)" "review|<none>" "P6: control: the task started before live: → stays carried"
has "$out" 'p6c: landed, carried (item 1 [[p6-ro]]: not moved since live)' "P6: … the control's wait names the item"

# ════ P2 / P3: unwatched ═══════════════════════════════════════════════════════════════════════════════════════
scen p23
live "$M2" git@github.com:o/other.git
mk p2.md 'status: review' "pr: $U/2" 'integrating: 2026-11-11T11:00+00:00'
printf -- '---\ntags: [task]\nstatus: done\nmerged: %s\npr: %s/2\n---\n\n# p2\n' "$NOW" "$U" > "$V/p2.expected"
WALKS=$(hx 'import sys
n = [0]
class W(mod._Walk):
    def __init__(self, *a):
        n[0] += 1; super().__init__(*a)
mod._Walk = W
sys.argv = ["rr", "mark-done", "--tasks", "p2", "--tasks-dir", argv[0], "--live-file", argv[1], "--now", argv[2]]
rc = mod.main()
print("WALKS=%d rc=%d" % (n[0], rc))' "$TK" "$L" "$NOW" | grep '^WALKS=')
ok "$WALKS" "WALKS=0 rc=0" "P2: unwatched, no clears: → done with no walk taken"
cmp -s "$TK/p2.md" "$V/p2.expected"; ok "$?" 0 "P2: … byte-identical to today's done write (status, merged:, integrating: gone)"
mk p3.md 'status: review' "pr: $U/3" 'clears:' '  - "[[p3-t]]"'
mk p3-t.md 'status: in_progress' 'started: 2026-11-11T10:30+00:00'
md p3 2026-11-11T10:00+00:00
ok "$(fm p3.md status)|$(fm p3.md merged)|$(fm p3.md live)" "review|2026-11-11T10:00+00:00|2026-11-11T10:00+00:00" \
   "P3: unwatched with clears: → carried, live: = merged:"
pv --tasks p3
ok "$(fm p3.md status)|$(fm p3.md proven)" "done|2026-11-11" "P3: … a move between merged: and the first prove counts"

# ════ P7 / P8: a task item; superseded_by: followed ════════════════════════════════════════════════════════════
scen p78
mk p7-t.md 'status: review' 'ready: 2026-11-11T10:00+00:00'
mk p7-d.md 'status: done' 'completed: 2026-11-11'
mk p7.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "[[p7-t]]"'
mk p7d.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "[[p7-d]]"'
pv --tasks p7,p7d
ok "$(fm p7.md status)" "done" "P7: a [[task]] item with ready: after live: → proven"
ok "$(fm p7d.md status)" "review" "P7: a date-only completed: on live:'s own Melbourne date does not count"
has "$out" "p7d: landed, carried (item 1 [[p7-d]]: cannot move (finished with nothing after live)" "P7: … and it reads cannot move"
ro p8-r1.md 'status: open' 'superseded_by: "[[p8-r2]]"'
ro p8-r2.md 'status: open'
mk p8-t.md 'status: in_progress' 'rollout: "[[p8-r2]]"' 'started: 2026-11-11T10:00+00:00'
mk p8.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "[[p8-r1]]"'
pv --tasks p8
ok "$(fm p8.md status)" "done" "P8: superseded_by: is followed to the successor's task"

# ════ P9 / P10 / P11 / P12: on his word, plain lines, not Live, --item ═════════════════════════════════════════
scen p9
mk Archive/p9-t.md 'status: done' 'completed: 2026-11-10'
mk p9.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "[[p9-t]]"'
pv --tasks p9
has "$out" "item 1 [[p9-t]]: cannot move (finished with nothing after live): record it on Lachy's word (/thread:repair)" \
    "P9: a link item that finished before live: waits on Lachy's word"
before=$(sums "$TK/p9.md")
pv --tasks p9 --seen "he saw it run" --item 1
ok "$rc|$(sums "$TK/p9.md")" "1|$before" "P9: … --seen on a link item without --on-his-word → exit 1, nothing written"
pv --tasks p9 --seen "Lachy: the chain ran clean" --item 1 --on-his-word
ok "$rc|$(fm p9.md status)" "0|done" "P9: … --on-his-word records it and proves it"
has "$(proof p9.md)" 'seen item 1 [[p9-t]]: Lachy: the chain ran clean (Lachy)' "P9: … the seen line names his word"
mk p10.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "the Stage shows it, cleanly"'
pv --tasks p10
ok "$(fm p10.md status)" "review" "P10: a plain line waits until --seen"
pv --tasks p10 --seen "status showed the line at 12:00"
ok "$rc|$(fm p10.md status)" "0|done" "P10: … --seen records it and proves it"
has "$(proof p10.md)" 'seen item 1 "the Stage shows it, cleanly": status showed the line at 12:00 (agent)' "P10: … the evidence in the Proof log"
live "$M1"
mk p11.md 'status: review' "pr: $U/11" 'merged: 2026-11-11T10:00+00:00' "merge_commit: $M2" 'clears:' '  - "a line"'
before=$(sums "$TK/p11.md")
pv --tasks p11 --seen "x"
ok "$rc|$(sums "$TK/p11.md")" "1|$before" "P11: --seen while not Live → exit 1, nothing recorded"
has "$out" "p11: not live yet: nothing recorded" "P11: … says not live yet"
mk p12.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T09:00+00:00' 'clears:' '  - "one"' '  - "two"'
pv --tasks p12 --seen "x"; ok "$rc" 2 "P12: several items and no --item → exit 2"
pv --tasks p12 --seen "x" --item 3; ok "$rc" 2 "P12: --item out of range → exit 2"
pv --tasks p12 --seen "$(printf 'a\tb')" --item 1; ok "$rc" 2 "P12: evidence with a control character → exit 2"

# ════ P13: the clears: grammar ═════════════════════════════════════════════════════════════════════════════════
echo "== p13"
P13=$(hx 'import json
rows = [
    "clears:\n  - \"fixes reading as done while landed but not live (P41, P42, 2026-11-07 to 2026-11-10)\"\n  - \"a, b\"",
    "clears:\n  - \"15 leftover rollout Leg sessions (e.g. \\\"Method Skill rollout · Leg 1\\\", \\\"Animately App\\\" beside)\"",
    "clears:\n  - \"[[x]]\"\n  - [[y]] and more",
    "clears: [\"[[x]]\", \"a, b\"]",
    "clears: a, b",
    "clears: []",
    "clears:",
    "clears:\n- \"[[z|alias]]\"\n- \x27it\x27\x27s\x27",
]
for fm in rows:
    n = mod.Note(Path("x.md"), "---\ntags: [task]\n" + fm + "\nstatus: review\n---\nbody\n")
    print(json.dumps(mod._clears(n), ensure_ascii=False))')
ok "$(echo "$P13" | sed -n 1p)" '[["line", "fixes reading as done while landed but not live (P41, P42, 2026-11-07 to 2026-11-10)"], ["line", "a, b"]]' \
   "P13: a block list of two quoted lines → two line items, commas kept"
ok "$(echo "$P13" | sed -n 2p)" '[["line", "15 leftover rollout Leg sessions (e.g. \"Method Skill rollout · Leg 1\", \"Animately App\" beside)"]]' \
   "P13: chorus-p102-2's escaped quotes → one line item holding plain quotes"
ok "$(echo "$P13" | sed -n 3p)" '[["link", "x"], ["line", "[[y]] and more"]]' "P13: a block \"[[x]]\" is a link; [[y]] and more is a line"
ok "$(echo "$P13" | sed -n 4p)" '[["link", "x"], ["line", "a, b"]]' "P13: a flow list → a link and one line a, b"
ok "$(echo "$P13" | sed -n 5p)" '[["line", "a, b"]]' "P13: a scalar is one line, never split at commas"
ok "$(echo "$P13" | sed -n 6p)|$(echo "$P13" | sed -n 7p)" '[]|[]' "P13: clears: [] and a bare clears: → no items"
ok "$(echo "$P13" | sed -n 8p)" '[["link", "z"], ["line", "it'"'"'s"]]' "P13: column-0 dashes, an alias, a single-quoted '' escape"
scen p13
live "$M2" git@github.com:o/other.git
mk p13e.md 'status: review' "pr: $U/13" 'clears: []'
md p13e
ok "$(fm p13e.md status)" "done" "P13: unwatched with clears: [] → done (done once Live)"

# ════ P14: the repo key: a real PR URL against ssh, ssh:// and https origins ═══════════════════════════════════
scen p14
for o in git@github.com:o/r.git ssh://git@github.com/O/R https://github.com/o/r.git; do
  live "$M2" "$o"; mk p14.md 'status: review' 'pr: https://github.com/O/R/pull/12'
  md p14; ok "$(fm p14.md status)" "review" "P14: pr: …/O/R/pull/12 against origin $o → watched → carried"
done
live "$M2" git@github.com:o/other.git; mk p14.md 'status: review' 'pr: https://github.com/O/R/pull/12'
md p14; ok "$(fm p14.md status)" "done" "P14: origin o/other → unwatched → done"
live "$M2"; mk p14f.md 'status: review' "pr: $U/12/files"
md p14f; ok "$(fm p14f.md status)" "review" "P14: pr: …/pull/12/files with a live entry → carried (fail closed)"
pv --tasks p14f
has "$out" "p14f: landed, carried (waits: repo unread (pr: $U/12/files is not a PR URL))" "P14: … prove waits: repo unread"
ro p14-ro.md 'status: done'
mk p14b.md 'status: review' 'pr: 12' 'rollout: "[[p14-ro]]"'
md p14b; ok "$(fm p14b.md status)" "review" "P14: a bare pr: 12 whose Project root origin is o/r → carried"
printf -- '---\ntags: [task]\nstatus: review\npr: https://github.com/O/R/pull/12\n---\n' > "$V/p14m.md"
MUT=$(hx 'n = mod.Note(Path(argv[0]))
live, _ = mod._live_read(argv[1])
print(mod._land_outcome(n, Path(argv[2]), live)[0])
mod._note_repo = lambda note, td: (mod._repo_key(mod._pr(note)), None)
print(mod._repo_key(mod._pr(n)), mod._land_outcome(n, Path(argv[2]), live)[0])' "$V/p14m.md" "$L" "$TK")
ok "$MUT" "$(printf 'carried\npull/12 done')" "P14: mutation control: an origin parser on the pr: reads pull/12 → done, so the rows above go red"

# ════ P15: no live file; a corrupt one ══════════════════════════════════════════════════════════════════════════
scen p15
mk p15.md 'status: review' "pr: $U/15"
md p15; ok "$(fm p15.md status)" "done" "P15: no live file → nothing watched → done"
printf '{not json' > "$L"; mk p15c.md 'status: review' "pr: $U/15"
md p15c; ok "$(fm p15c.md status)" "review" "P15: a corrupt live file → carried (fail closed)"
has "$err" "WARN: mark-done:" "P15: … with one WARN"

# ════ P16: the merge commit: read and stamped; a gh failure and a hung gh wait, the next note still judged ════════
scen p16
live "$M2"
mk p16-a.md 'status: review' "pr: $U/161" 'merged: 2026-11-11T10:00+00:00'
mk p16-b.md 'status: review' "pr: $U/162" 'merged: 2026-11-11T10:00+00:00'
mk p16-c.md 'status: review' "pr: $U/163" 'merged: 2026-11-11T10:00+00:00'
: > "$T/gh/sleep-$(gkey "$U/162")"; ghpr "$U/163" "{\"mergeCommit\": {\"oid\": \"$M1\"}}"
: > "$GHLOG"
pv --all --gh-timeout 1
has "$out" "p16-a: landed, carried (waits: merge commit unread (no PR $U/161))" "P16: a gh failure → waits"
has "$out" "p16-b: landed, carried (waits: merge commit unread (" "P16: a gh past its bound → waits"
ok "$(fm p16-c.md merge_commit)|$(fm p16-c.md status)" "$M1|done" "P16: … the next note is still judged: merge_commit: stamped, proven"
pv --tasks p16-a --no-gh
has "$out" "waits: merge commit not read (no gh)" "P16: --no-gh → merge commit not read"
rm -f "$T/gh/sleep-"*

# ════ P17: a RACE revert is never Live; a missing rollout note has no Race log ═════════════════════════════════
scen p17
live "$M2"
RBODY=$'## Race log\n\n- 2026-11-11T09:00+00:00 [[p17]] reverted on main: abc1234 PR #17\x27s merge\n' ro p17-ro.md 'status: open'
mk p17.md 'status: review' "pr: $U/17" 'rollout: "[[p17-ro]]"' 'merged: 2026-11-11T08:00+00:00' "merge_commit: $M1"
mk p17m.md 'status: review' "pr: $U/171" 'rollout: "[[p17-gone]]"' 'merged: 2026-11-11T08:00+00:00' "merge_commit: $M1"
pv --tasks p17,p17m
has "$out" "p17: landed, carried (reverted: its merge was reverted on main; re-land it (/thread:repair))" "P17: reverted on main → never Live"
ok "$(fm p17.md live)|$(fm p17m.md status)" "<none>|done" "P17: … no live:; a missing rollout note is judged (no Race log)"

# ════ P18: the queue reads a carried fix as landed; the verbs that would undo or re-run it refuse ════════════════
scen p18
RBODY=$'## Queue\n\n- [[p18]]\n\n## Race log\n\n- 2026-11-11T09:00+00:00 [[p18]] RACE: PR #18 merged as aaa\n' ro p18-ro.md 'status: open'
ro p18-to.md 'status: open' 'supersedes: "[[p18-ro]]"'
BODY=$'\n## Integration log\n\n2026-11-11T09:00+00:00 integrated lead - - - - - - - -\n' \
  mk p18.md 'status: review' "pr: $U/18" 'rollout: "[[p18-ro]]"' 'merged: 2026-11-11T10:00+00:00' 'ready: 2026-11-11T08:00+00:00'
Q=$(hx 'n = mod.Note(Path(argv[0])); ro = mod.Note(Path(argv[1]))
print(mod._queue_state(n)[0], mod._landed(n), mod._holds_lane(n), sorted(mod._race_marks(ro, [(n.path, n)])))' "$TK/p18.md" "$TK/p18-ro.md")
ok "$Q" "merged True False []" "P18: _queue_state merged, _landed, no lane despite an integrated last line, no RACE mark"
before=$(sums "$TK/p18.md")
for v in hand-back mark-integrating mark-started; do
  rr "$v" --tasks p18 --tasks-dir "$TK" --now "$NOW"; ok "$rc|$(sums "$TK/p18.md")" "1|$before" "P18: $v refuses a carried fix, nothing written"
done
has "$err" "landed, carried: its PR merged" "P18: … mark-started names it landed, carried"
rr log-integration --tasks p18 --started 2026-11-11T09:00:00+00:00 --anchor "$M1" --head "$M2" --base "$BASE" --tasks-dir "$TK" --now "$NOW"
ok "$rc|$(sums "$TK/p18.md")" "1|$before" "P18: log-integration refuses it"
rr origin-wait --tasks p18 --tasks-dir "$TK" --timeout 0
ok "$rc" 1 "P18: origin-wait refuses it"
rr defer --tasks p18 --tasks-dir "$TK"
ok "$rc|$(fm p18.md merged)|$(fm p18.md rollout)" "1|2026-11-11T10:00+00:00|\"[[p18-ro]]\"" "P18: defer refuses it: merged: and rollout: kept"
: > "$GHLOG"
rr resume --rollout "$TK/p18-ro.md" --tasks-dir "$TK" --gh-bin "$T/bin/gh" --now "$NOW"
ok "$(cat "$GHLOG")|$(sums "$TK/p18.md")" "|$before" "P18: resume skips it before any gh call"
has "$out" "p18: landed, carried [no-change]" "P18: … landed, carried [no-change]"
md p18; has "$out" "p18: already landed, carried [no-change]" "P18: mark-done prints no change"
mk p18-q.md 'status: open' 'rollout: "[[p18-ro]]"'
rr carry --from "$TK/p18-ro.md" --to "$TK/p18-to.md" --tasks-dir "$TK"
ok "$rc|$(fm p18-q.md rollout)|$(fm p18.md rollout)" '0|"[[p18-to]]"|"[[p18-ro]]"' "P18: carry carries the queued task and leaves the carried fix alone"

# ════ P19: resume ═══════════════════════════════════════════════════════════════════════════════════════════════
scen p19
live "$M2"
RBODY=$'## Queue\n\n- [[p19w]]\n' ro p19-ro.md 'status: open'
mk p19w.md 'status: review' "pr: $U/191" 'rollout: "[[p19-ro]]"'
ghpr "$U/191" "{\"state\": \"MERGED\", \"mergedAt\": \"2026-11-11T09:00:00Z\", \"baseRefName\": \"master\", \"url\": \"$U/191\", \"mergeCommit\": {\"oid\": \"$M1\"}}"
rr resume --rollout "$TK/p19-ro.md" --tasks-dir "$TK" --gh-bin "$T/bin/gh" --live-file "$L" --now "$NOW"
ok "$(fm p19w.md status)|$(fm p19w.md merge_commit)|$(fm p19w.md merged)" "review|$M1|2026-11-11T09:00+00:00" "P19: resume, watched → carried with merge_commit:"
has "$out" "p19w: status=review->review: landed, carried (PR $U/191 merged into master" "P19: … its line says landed, carried"
live "$M2" git@github.com:o/other.git
mk p19w.md 'status: review' "pr: $U/191" 'rollout: "[[p19-ro]]"'
rr resume --rollout "$TK/p19-ro.md" --tasks-dir "$TK" --gh-bin "$T/bin/gh" --live-file "$L" --now "$NOW"
ok "$(fm p19w.md status)" "done" "P19: resume, unwatched → done"
has "$out" "p19w: status=review->done (PR $U/191 merged into master)" "P19: … today's line"

# ════ P20: --all: root carried fixes judged, Archive carry-back candidates carried back, nothing else read ═══════
scen p20
live "$M2"
ro Archive/Rollouts/p20-old.md 'status: done'
mk p20-root.md 'status: review' "pr: $U/201" 'merged: 2026-11-11T10:00+00:00'
mk Archive/2026/p20-arch-carried.md 'status: review' "pr: $U/202" 'merged: 2026-11-11T10:00+00:00'
mk Archive/p20-cand.md 'status: done' "pr: $U/203" 'merged: 2026-11-11T10:00+00:00' 'rollout: "[[p20-old]]"' 'clears:' '  - "a line"'
mk Archive/p20-done.md 'status: done' "pr: $U/204" 'merged: 2026-11-11T10:00+00:00'
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 proven: Live, with no clears: item\n' \
  mk Archive/p20-proved.md 'status: done' "pr: $U/205" 'merged: 2026-11-11T08:00+00:00' 'proven: 2026-11-11' 'clears:' '  - "x"'
mk Archive/Rollouts/p20-ro-task.md 'status: review' "pr: $U/206" 'merged: 2026-11-11T10:00+00:00'
for n in 201 203; do ghpr "$U/$n" "{\"mergeCommit\": {\"oid\": \"$M1\"}}"; done
keep="$TK/Archive/p20-done.md $TK/Archive/p20-proved.md $TK/Archive/Rollouts/p20-ro-task.md $TK/Archive/Rollouts/p20-old.md $TK/Archive/2026/p20-arch-carried.md"
before=$(sums $keep)
: > "$GHLOG"; : > "$GITLOG"
PATH="$T/gitbin:$T/bin:$PATH" python3 "$RR" prove --all --tasks-dir "$TK" --live-file "$L" --now "$NOW" --gh-bin "$T/bin/gh" > "$T/out" 2> "$T/err"; rc=$?; out=$(cat "$T/out")
ok "$rc" 0 "P20: prove --all exits 0"
ok "$(sed 's/^.*pr view //; s/ --json.*$//' "$GHLOG" | sort | tr '\n' ' ')" "$U/201 $U/203 " "P20: gh reads only the root carried fix and the carried-back candidate"
ok "$(grep -c 'merge-base' "$GITLOG")" 2 "P20: … and git reads only those two"
has "$out" "p20-arch-carried: archived while carried: not judged (move it back to Work/Tasks/ to resume its proof)" "P20: an archived carried fix is reported, not judged"
has "$out" "p20-cand: carried back from Archive/ (status: review)" "P20: the Archive candidate is carried back"
ok "$(sums $keep)" "$before" "P20: archived non-candidates, the carried archive note and the Rollouts notes are byte-identical"
ok "$([ -f "$TK/p20-cand.md" ] && echo root)|$([ -f "$TK/Archive/p20-cand.md" ] && echo still || echo gone)" "root|gone" "P20: … it is moved back to Work/Tasks/"
has "$out" "prove: 1 carried, 1 proven, 1 carried back, 0 owed, 0 waiting carry-back" "P20: … the summary line"

# ════ P21: carry-back ═══════════════════════════════════════════════════════════════════════════════════════════
scen p21
ro Archive/Rollouts/p21-old.md 'status: done'
mk Archive/demo-p1-fix.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'completed: 2026-11-11' 'rollout: "[[p21-old]]"' \
   'projects:' '  - "[[Demo]]"' 'clears:' '  - "a line"'
printf -- '---\ntags: [phase]\nstatus: open\n---\n\n# Phase 1\n' > "$PH/demo-p1-a-phase.md"
F="$TK/Archive/demo-p1-fix.md"
python3 -c 'import os, sys; os.utime(sys.argv[1], (1000000000, 1000000000))' "$F"
XA=no; if command -v xattr >/dev/null 2>&1 && xattr -w com.example.tag red "$F" 2>/dev/null; then XA=yes; fi
birth() { python3 -c 'import os, sys; print(int(getattr(os.stat(sys.argv[1]), "st_birthtime", 0)))' "$1"; }
B0=$(birth "$F")
pv --tasks demo-p1-fix --dry-run
has "$out" "demo-p1-fix: would carry back from Archive/" "P21: --dry-run → would carry back from Archive/"
ok "$([ -f "$F" ] && echo still)" still "P21: … nothing moved"
pv --tasks demo-p1-fix
ok "$([ -f "$F" ] && echo still || echo gone)|$(fm demo-p1-fix.md status)|$(fm demo-p1-fix.md completed)" "gone|review|<none>" \
   "P21: an archived, done candidate is moved back to Work/Tasks/ at review, completed: removed"
has "$(proof demo-p1-fix.md)" "carried back: landed at status: done, never Proven (ADR 0078 d1); from Archive/; completed: 2026-11-11 removed" \
    "P21: … the Proof log line"
ok "$(birth "$TK/demo-p1-fix.md")" "$B0" "P21: … its created time kept"
[ "$XA" = yes ] && ok "$(xattr -p com.example.tag "$TK/demo-p1-fix.md" 2>/dev/null)" red "P21: … its tag kept"
has "$out" 'demo-p1-fix: landed, carried (item 1 "a line": not seen since live' "P21: … and judged in the same pass"
python3 "$RP" --project demo --vault "$V" --kinds phase --no-gh --json > "$T/out" 2>&1; out=$(cat "$T/out")
ok "$(j '[i["slug"] for i in d["unambiguous"] + d["ambiguous"]]')" '[]' "P21: reconcile-project then reads its phase QUIET, not archived but review"
mk Archive/p21-clash.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
mk p21-clash.md 'status: open'
before=$(sums "$TK/Archive/p21-clash.md" "$TK/p21-clash.md")
pv --all --dry-run
pv --all
has "$out" "p21-clash: landed, carry-back waits, archived (Work/Tasks/p21-clash.md exists)" "P21: a root note of the same name → waits"
ok "$(sums "$TK/Archive/p21-clash.md" "$TK/p21-clash.md")" "$before" "P21: … both files byte-identical"
mk Archive/p21-tagged.md 'tags: [task, archived]' 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
sed -i.bak '2d' "$TK/Archive/p21-tagged.md"; rm -f "$TK/Archive/p21-tagged.md.bak"
before=$(sums "$TK/Archive/p21-tagged.md"); pv --all
ok "$(sums "$TK/Archive/p21-tagged.md")" "$before" "P21: an archived candidate with the archived tag is untouched"
for s in old new gone; do
  case $s in old) e="$OLD";; new) e="$NEW";; gone) e='engine_snapshot: "~/snaps/missing"';; esac
  ro "p21-$s-ro.md" 'status: open' "$e"
  mk "Archive/p21-$s.md" 'status: done' 'merged: 2026-11-11T08:00+00:00' "rollout: \"[[p21-$s-ro]]\"" 'clears:' '  - "x"'
done
pv --all
has "$out" "p21-old: landed, carry-back waits, archived (engine old reads a carried fix as awaiting Integration)" "P21: a live rollout stamped ~/snaps/old (no marker) → waits"
has "$out" "p21-new: carried back from Archive/" "P21: … stamped ~/snaps/new (the marker) → carried back (~ expanded)"
has "$out" "p21-gone: landed, carry-back waits, archived (engine $HOME/snaps/missing unreadable)" "P21: … a missing path → an unreadable wait"
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carried: x\n- 2026-11-11T10:00+00:00 seen item 1 "x": y (agent)\n' \
  mk p21-seen.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carry-back owed: engine x; status: done written for that engine (ADR 0078 d1)\n' \
  mk p21-owed.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
pv --tasks p21-seen,p21-owed
ok "$(fm p21-seen.md status)|$(fm p21-owed.md status)" "done|review" "P21: a last seen line is never carried back; a last owed line is"

# ════ P22: a serial chain is out of scope, checked before any engine read ══════════════════════════════════════
scen p22
live "$M2"
mk p22-t1.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p22-live]]"' 'clears:' '  - "x"'
ro p22-live.md 'status: open' 'shape: serial' "$OLD"
mk Archive/p22-t2.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p22-fin]]"' 'clears:' '  - "x"'
ro Archive/Rollouts/p22-fin.md 'status: done' 'shape: serial'
mk p22-t3.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p22-new]]"' 'clears:' '  - "x"'
ro p22-new.md 'status: open' 'shape: serial' "$NEW"
pv --all --json
ok "$(j '[e["slug"] for e in d["carryBack"] + d["owed"] + d["carried"]]')" '[]' "P22: a serial chain's done task is no candidate: live, finished and archived, or with the marker"
ok "$(fm p22-t1.md status)|$(fm p22-t3.md status)|$([ -f "$TK/Archive/p22-t2.md" ] && echo kept)" "done|done|kept" "P22: … nothing carried back"
MUT=$(hx 'w = mod._walk_of(Path(argv[0])); p = Path(argv[0]) / "Archive" / "p22-t2.md"; n = w.notes[p]
print(mod._carry_back_candidate(p, n, Path(argv[0]), w))
mod._serial_chain = lambda note: False
print(mod._carry_back_candidate(p, n, Path(argv[0]), w))' "$TK")
ok "$MUT" "$(printf 'False\nTrue')" "P22: mutation control: with the finished check alone the archived chain's task is carried back"
mk p22-w.md 'status: review' "pr: $U/221" 'rollout: "[[p22-live]]"'
ghpr "$U/221" "{\"state\": \"MERGED\", \"mergedAt\": \"2026-11-11T09:00:00Z\", \"baseRefName\": \"master\", \"mergeCommit\": {\"oid\": \"$M1\"}}"
pv --tasks p22-w --land --pr "$U/221" --json
ok "$rc|$(fm p22-w.md status)|$(j 'd["landed"]["outcome"]')" "0|done|done" "P22: --land on a watched fix in a live serial chain (no marker) → done"
ok "$(proof p22-w.md | wc -l | tr -d ' ')" 0 "P22: … no Proof log line"
pv --all --json; ok "$(j '[e["slug"] for e in d["carryBack"] + d["owed"] + d["carried"]]')" '[]' "P22: … and the next prove --all lists nothing for it"
ro p22-par.md 'status: open'
mk Archive/p22-par-t.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p22-par]]"' 'clears:' '  - "x"'
mk Archive/p22-none.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
pv --all
has "$out" "p22-par-t: carried back from Archive/" "P22: an unstamped live parallel rollout → carried back"
has "$out" "p22-none: carried back from Archive/" "P22: no rollout → carried back"

# ════ P23: --land ═══════════════════════════════════════════════════════════════════════════════════════════════
scen p23
live "$M2"
ghm() { ghpr "$1" "{\"state\": \"$2\", \"mergedAt\": \"2026-11-11T09:00:00Z\", \"baseRefName\": \"${3:-master}\", \"mergeCommit\": {\"oid\": \"$M1\"}}"; }
mk p23w.md 'status: in_progress'; ghm "$U/231" MERGED
pv --tasks p23w --land --pr "$U/231" --json
ok "$(j 'd["landed"]["outcome"]')|$(fm p23w.md pr)|$(fm p23w.md merge_commit)" "proven|$U/231|$M1" "P23: --land by PR, watched → carried, then judged Live and proven in the same call"
mk p23u.md 'status: in_progress' 'pr: https://github.com/o/other/pull/232'; ghpr https://github.com/o/other/pull/232 "{\"state\": \"MERGED\", \"mergedAt\": \"2026-11-11T09:00:00Z\", \"baseRefName\": \"master\"}"
pv --tasks p23u --land --json; ok "$(j 'd["landed"]["outcome"]')|$(fm p23u.md status)" "done|done" "P23: --land, unwatched, no clears: → done"
mk p23o.md 'status: in_progress'; ghm "$U/233" OPEN
before=$(sums "$TK/p23o.md"); pv --tasks p23o --land --pr "$U/233"; ok "$rc|$(sums "$TK/p23o.md")" "1|$before" "P23: not merged → exit 1, nothing written"
ghm "$U/234" MERGED release; pv --tasks p23o --land --pr "$U/234"; ok "$rc|$(sums "$TK/p23o.md")" "1|$before" "P23: merged into another branch → exit 1"
mk p23c.md 'status: in_progress'
pv --tasks p23c --land --commit "$M1" --repo "$T/target" --json
ok "$(fm p23c.md status)|$(fm p23c.md merge_repo)|$(fm p23c.md merge_commit)" "done|o/r|$M1" "P23: --commit stamps merge_repo: (watched → Live → judged)"
mk p23n.md 'status: open' 'clears:' '  - "x"'
pv --tasks p23n --land --no-code --json
ok "$(j 'd["landed"]["outcome"]')|$(fm p23n.md status)|$(fm p23n.md live)" "carried|review|$NOW" "P23: --no-code → carried, live: = merged: = now"
RBODY=$'## Queue\n\n- [[p23-own]]\n- [[p23-dep]]\n' ro p23-ro.md 'status: open' "$OLD" "$OLDSHA"
mk p23-own.md 'status: review' "pr: $U/235" 'rollout: "[[p23-ro]]"'; ghm "$U/235" MERGED
mk p23-dep.md 'status: open' 'rollout: "[[p23-ro]]"' 'depends-on:' '  - "[[p23-own]]"'
pv --tasks p23-own --land --json
ok "$rc|$(j 'd["landed"]["outcome"]')|$(fm p23-own.md status)|$(fm p23-own.md merged)" "0|owed|done|2026-11-11T09:00+00:00" \
   "P23: owed by its own rollout (stamped, no marker) → status: done + merged:, exit 0"
has "$(proof p23-own.md)" "landed, carry-back owed: engine abc123def456 reads a carried fix as awaiting Integration; status: done written for that engine (ADR 0078 d1)" \
    "P23: … the owed Proof log line"
NX=$(hx 'import io, json, contextlib, sys
a = mod._parser().parse_args(["next", "--rollout", argv[0], "--tasks-dir", argv[1], "--now", argv[2], "--dry-run"])
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    a.func(a)
d = json.loads(buf.getvalue()); print(d["start"], d.get("restart", []))' "$TK/p23-ro.md" "$TK" "$NOW")
ok "$NX" "['p23-dep'] []" "P23: … next reads it landed: its dependant starts and it is never re-dispatched"
python3 - "$TK" <<'PY'
import os, sys, re
tk = sys.argv[1]
p = os.path.join(tk, "p23-ro.md"); t = open(p).read().replace("status: open", "status: done", 1); open(p, "w").write(t)
os.rename(p, os.path.join(tk, "Archive", "Rollouts", "p23-ro.md"))
os.rename(os.path.join(tk, "p23-own.md"), os.path.join(tk, "Archive", "p23-own.md"))
PY
pv --all
has "$out" "p23-own: carried back from Archive/ (status: review)" "P23: once its rollout is done and archived, prove --all carries it back from Archive/"
ok "$(fm p23-own.md status)" "done" "P23: … and judges it (Live, no clears: → proven)"

# ════ P24: the dependants gate (_carry_readers (b)) ══════════════════════════════════════════════════════════════
scen p24
live "$M2" git@github.com:o/other.git
ro p24-own.md 'status: open'
ro p24-old.md 'status: open' "$OLD" "$OLDSHA"
ro p24-new.md 'status: open' "$NEW"
ro Archive/Rollouts/p24-fin.md 'status: done' "$OLD"
ro p24-ser.md 'status: open' 'shape: serial' "$OLD"
ro p24-sern.md 'status: open' 'shape: serial' "$NEW"
fix() { mk "$1.md" 'status: review' "pr: $U/24" 'rollout: "[[p24-own]]"' 'clears:' '  - "x"'; }
dep() { mk "$1.md" "status: $2" "rollout: \"[[$3]]\"" "${4:-depends-on}:" "  - \"[[$5]]\""; }
fix f1; dep d1 open p24-old depends-on f1; md f1
ok "$(fm f1.md status)" "done" "P24: a dependant queued in a live rollout without the marker → owed (status: done)"
has "$out" "f1: landed, carry-back owed (status: done; dependant [[d1]] in [[p24-old]]: engine abc123def456 reads a carried fix as awaiting Integration)" "P24: … the dependant's why"
fix f2; dep d2 open p24-old blocked-by f2; md f2; ok "$(fm f2.md status)" "done" "P24: … through blocked-by: → owed"
fix f3; mk f3m.md 'status: merged' 'merged_into: "[[f3]]"'; dep d3 open p24-old depends-on f3m; md f3
ok "$(fm f3.md status)" "done" "P24: … through a folded member tombstone → owed"
fix f4; dep d4 blocked p24-old depends-on f4; md f4; ok "$(fm f4.md status)" "done" "P24: a set-aside dependant → owed"
fix f5; dep d5 in_progress p24-old depends-on f5; md f5; ok "$(fm f5.md status)" "review" "P24: a running dependant → carried (not checked)"
fix f6; dep d6 done p24-old depends-on f6; md f6; ok "$(fm f6.md status)" "review" "P24: a landed dependant → carried"
fix f7; dep d7 open p24-fin depends-on f7; md f7; ok "$(fm f7.md status)" "review" "P24: the dependant's rollout finished → carried"
fix f8; dep d8 open p24-new depends-on f8; md f8; ok "$(fm f8.md status)" "review" "P24: its snapshot has the marker → carried"
fix f9; mk d9.md 'status: open' 'depends-on:' '  - "[[f9]]"'; md f9; ok "$(fm f9.md status)" "review" "P24: a dependant with no rollout: → carried"
fix fa; dep da open p24-ser depends-on fa; md fa; ok "$(fm fa.md status)" "done" "P24: in a live serial chain without the marker → owed"
fix fb; dep db open p24-sern depends-on fb; md fb; ok "$(fm fb.md status)" "review" "P24: … with the marker → carried"
ro Archive/Rollouts/p24-gone.md 'status: done'
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carry-back owed: x; status: done written for that engine (ADR 0078 d1)\n' \
  mk fc.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p24-gone]]"' 'clears:' '  - "x"'
dep dc open p24-old depends-on fc
pv --tasks fc
has "$out" "fc: landed, carry-back waits (dependant [[dc]] in [[p24-old]]: engine abc123def456" "P24: carry-back waits on a queued dependant in an old rollout"
dep dc in_progress p24-old depends-on fc
pv --tasks fc; ok "$(fm fc.md status)" "review" "P24: … once the dependant starts, the next pass carries it back"
mk fd.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
dep dd open p24-old depends-on fd
before=$(sums "$TK/fd.md")
pv --all --dry-run --json
has "$(j '[e["slug"] for e in d["owed"]]')" '"fd"' "P24: re-check --dry-run lists it owed"
ok "$(sums "$TK/fd.md")" "$before" "P24: … and writes nothing"
pv --all --dry-run; has "$out" "fd: would write landed, carry-back owed" "P24: … would write landed, carry-back owed"
pv --all --json
ok "$(fm fd.md status)|$(j '"fd" in [e["slug"] for e in d["owed"]]')" "done|true" "P24: prove's re-check writes the owed form and lists it owed"
has "$(proof fd.md)" "landed, carry-back owed: dependant [[dd]] in [[p24-old]]" "P24: … with its owed line"

# ════ P24 (clause 3): an unstamped rollout reads its real engine, under a Primary stand-in without the marker ══════
echo "== p24-stand-in"
git clone -q "$T/P" "$T/Q"; git -C "$T/Q" worktree add -q --detach "$T/Q-run" HEAD
python3 - "$T/Q/skills/execute/scripts/reconcile-rollout.py" <<'PY'
import sys
p = sys.argv[1]; t = open(p).read()
assert t.count("\nPROVEN_ENGINE = 1\n") == 1
open(p, "w").write(t.replace("\nPROVEN_ENGINE = 1\n", "\n", 1))
PY
mkdir -p "$T/cache"; cp -R "$T/P" "$T/cache/plug"; rm -rf "$T/cache/plug/.git"
scen p24q
ro p24q-un.md 'status: open'
mk qf.md 'status: in_progress' 'clears:' '  - "x"'
mk qd.md 'status: open' 'rollout: "[[p24q-un]]"' 'depends-on:' '  - "[[qf]]"'
cp "$TK/qf.md" "$V/qf.orig"
rrx "$T/Q-run" prove --tasks qf --land --no-code --json --tasks-dir "$TK" --live-file "$L" --now "$NOW"
ok "$rc|$(j 'd["landed"]["outcome"]')|$(fm qf.md status)" "0|owed|done" "P24: an unstamped dependant rollout under a Primary without the marker → owed"
has "$(j 'd["owed"][0]["why"]')" "dependant [[qd]] in [[p24q-un]]: engine $T/Q (the Primary checkout) reads a carried fix as awaiting Integration" \
    "P24: … the why names the Primary checkout"
cp "$V/qf.orig" "$TK/qf.md"
rrx "$T/P" prove --tasks qf --land --no-code --json --tasks-dir "$TK" --live-file "$L" --now "$NOW"
ok "$(j 'd["landed"]["outcome"]')" "carried" "P24: control: the same from \$T/P (the marker) → carried"
cp "$V/qf.orig" "$TK/qf.md"
rrx "$T/cache/plug" prove --tasks qf --land --no-code --json --tasks-dir "$TK" --live-file "$L" --now "$NOW"
ok "$(j 'd["landed"]["outcome"]')" "carried" "P24: a version-cache copy (no git Primary) reads its own copy → carried"
rm "$TK/qd.md"
mk qo.md 'status: in_progress' 'rollout: "[[p24q-un]]"' 'clears:' '  - "x"'
rrx "$T/Q-run" prove --tasks qo --land --no-code --json --tasks-dir "$TK" --live-file "$L" --now "$NOW"
ok "$(j 'd["landed"]["outcome"]')" "owed" "P24: its own rollout unstamped and live, no dependant, from Q-run → owed"
has "$(j 'd["owed"][0]["why"]')" "engine $T/Q (the Primary checkout) reads a carried fix as awaiting Integration" "P24: … the own-rollout why"
ro Archive/Rollouts/p24q-fin.md 'status: done'
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carry-back owed: x; status: done written for that engine (ADR 0078 d1)\n' \
  mk qc.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p24q-fin]]"' 'clears:' '  - "x"'
mk qcd.md 'status: open' 'rollout: "[[p24q-un]]"' 'depends-on:' '  - "[[qc]]"'
rrx "$T/Q-run" prove --tasks qc --tasks-dir "$TK" --live-file "$L" --now "$NOW"
has "$out" "qc: landed, carry-back waits (dependant [[qcd]] in [[p24q-un]]: engine $T/Q (the Primary checkout)" "P24: carry-back from Q-run waits on the unstamped dependant"
rrx "$T/P" prove --tasks qc --tasks-dir "$TK" --live-file "$L" --now "$NOW"
ok "$(fm qc.md status)" "review" "P24: … the same pass from \$T/P carries it back"
cp "$V/qf.orig" "$TK/qf.md"; mk qd.md 'status: open' 'rollout: "[[p24q-un]]"' 'depends-on:' '  - "[[qf]]"'
MUT=$(PATH="$T/bin:$PATH" python3 -c 'import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
from pathlib import Path
n = mod.Note(Path(sys.argv[2]) / "qf.md")
print(mod._land_outcome(n, Path(sys.argv[2]), {}, no_code=True)[0])
mod._unstamped_engine = lambda path: (True, None)
mod._UNSTAMPED_ENGINE.clear()
print(mod._land_outcome(n, Path(sys.argv[2]), {}, no_code=True)[0])' "$T/Q-run/skills/execute/scripts/reconcile-rollout.py" "$TK")
ok "$MUT" "$(printf 'owed\ncarried')" "P24: mutation control: clause 3 read as True turns the judge's row carried"

# ════ P25: the JSON, --dry-run and carried-fixes.json ═══════════════════════════════════════════════════════════
scen p25
live "$M1"
ro p25-old.md 'status: open' "$OLD" "$OLDSHA"
ro Archive/Rollouts/p25-fin.md 'status: done'
mk p25-c.md 'status: review' "pr: $U/251" 'merged: 2026-11-11T10:00+00:00' "merge_commit: $M2" 'projects:' '  - "[[Demo]]"'
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carry-back owed: x; status: done written for that engine (ADR 0078 d1)\n' \
  mk Archive/p25-o.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p25-fin]]"'
mk p25-od.md 'status: open' 'rollout: "[[p25-old]]"' 'depends-on:' '  - "[[p25-o]]"'
mk p25-w.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p25-old]]"' 'clears:' '  - "x"'
manifest() { find "$V" -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(cksum < "$f")"; done; }
before=$(manifest)
pv --all --dry-run --json
ok "$(manifest)" "$before" "P25: --dry-run writes nothing (no note, no carried-fixes.json)"
pv --all --json
ok "$(j 'sorted(d)')" '["carried", "carriedBack", "carryBack", "errors", "owed", "proven"]' "P25: --all's JSON keys (landed only under --land)"
ok "$(j '[len(d["carried"]), len(d["owed"]), len(d["carryBack"])]')" '[1, 1, 1]' "P25: one carried, one owed, one waiting carry-back"
ok "$(j 'd["owed"][0]["archived"]')|$(j 'd["carryBack"][0]["archived"]')" "true|false" "P25: … archived flags"
ok "$(j 'sorted(d["carried"][0])')" '["items", "live", "merged", "project", "rollout", "slug", "waits"]' "P25: a carried entry's keys"
CF="$V/carried-fixes.json"
ok "$(python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); print(sorted(d), [sorted(d[k][0]) for k in ("carried", "owed", "carryBack")], d["carried"][0]["project"])' "$CF")" \
   "['carried', 'carryBack', 'owed', 'v'] [['live', 'merged', 'project', 'rollout', 'slug', 'waits'], ['archived', 'merged', 'project', 'rollout', 'slug', 'why'], ['archived', 'merged', 'project', 'rollout', 'slug', 'waits']] Demo" \
   "P25: carried-fixes.json holds all three lists, each entry with slug, project and rollout"
python3 -c 'import os, sys; os.utime(sys.argv[1], (1000000000, 1000000000))' "$CF"
pv --all
ok "$(python3 -c 'import os, sys; print(int(os.stat(sys.argv[1]).st_mtime))' "$CF")" 1000000000 "P25: … rewritten only when it changes"
# ════ P26: reconcile's read-only approval lands through _land_outcome (no code: never watched) ════════════════════
scen p26
RBODY=$'## Queue\n\n- [[p26-fix]]\n- [[p26-plain]]\n- [[p26-dep]]\n' ro p26-ro.md 'status: open'
ro p26-old.md 'status: open' "$OLD" "$OLDSHA"
mk p26-fix.md 'status: in_progress' 'scope: read-only' 'rollout: "[[p26-ro]]"' 'clears:' '  - "the audit names the stuck task"'
mk p26-plain.md 'status: in_progress' 'scope: read-only' 'rollout: "[[p26-ro]]"'
mk p26-dep.md 'status: open' 'rollout: "[[p26-ro]]"' 'depends-on:' '  - "[[p26-fix]]"'
# row <slug>...: one read-only approval row per slug, the engine's shape
row() { python3 -c 'import json, sys
json.dump({"rolloutSlug": "p26-ro", "tasks": [{"slug": s, "status": "review", "scope": "read-only", "prUrl": "", "rung": "",
           "reviewRoundsUsed": 1, "planRoundsUsed": 0} for s in sys.argv[2:]]}, open(sys.argv[1], "w"))' "$V/row.json" "$@"; }
merges() { grep -rh "\"$1\"" "$THREAD_EVENTS_DIR" 2>/dev/null | grep -c '"merged"'; }
row p26-fix p26-plain
rr reconcile --result "$V/row.json" --tasks-dir "$TK" --now "$NOW"
ok "$rc" 0 "P26: reconcile of two read-only approvals exits 0"
ok "$(fm p26-fix.md status)|$(fm p26-fix.md merged)|$(fm p26-fix.md live)" "review|$NOW|$NOW" \
   "P26: a read-only approval of a fix (clears:) lands review + merged: + live:, never done"
has "$out" "p26-fix: status=review (read-only, approved; landed, carried: unwatched: Live at merge; done once its 1 clears: item moved) merged=$NOW" \
    "P26: … its line says landed, carried"
has "$(proof p26-fix.md)" "landed, carried: unwatched: Live at merge" "P26: … with its Proof log line"
ok "$(merges p26-fix)" 1 "P26: … its landing's merged event fires"
ok "$(fm p26-plain.md status)|$(fm p26-plain.md merged)|$(proof p26-plain.md | wc -l | tr -d ' ')" "done|$NOW|0" \
   "P26: control: a read-only approval with no clears: is today's done, no Proof log"
has "$out" "p26-plain: status=done (read-only, approved) merged=$NOW" "P26: … today's line"
rr next --rollout "$TK/p26-ro.md" --tasks-dir "$TK" --now "$NOW" --dry-run
ok "$(j 'd["start"]')" '["p26-dep"]' "P26: next reads the carried fix landed: its dependant starts"
before=$(sums "$TK/p26-fix.md")
rr reconcile --result "$V/row.json" --tasks-dir "$TK" --now 2026-11-11T13:00+00:00
ok "$rc|$(sums "$TK/p26-fix.md")|$(merges p26-fix)" "0|$before|1" "P26: a re-reconcile is no change and fires no second merged"
has "$out" "p26-fix: status=review (read-only, approved; already landed, carried) [no-change]" "P26: … its line says already landed, carried"
mk p26-owed.md 'status: in_progress' 'scope: read-only' 'rollout: "[[p26-ro]]"' 'clears:' '  - "x"'
mk p26-od.md 'status: open' 'rollout: "[[p26-old]]"' 'depends-on:' '  - "[[p26-owed]]"'
row p26-owed; rr reconcile --result "$V/row.json" --tasks-dir "$TK" --now "$NOW"
ok "$(fm p26-owed.md status)|$(fm p26-owed.md merged)" "done|$NOW" "P26: a dependant queued in an old rollout → owed (status: done + merged:)"
has "$out" "p26-owed: status=done (read-only, approved; landed, carry-back owed: dependant [[p26-od]] in [[p26-old]]: engine abc123def456" \
    "P26: … its line says landed, carry-back owed"
has "$(proof p26-owed.md)" "landed, carry-back owed: dependant [[p26-od]] in [[p26-old]]" "P26: … with the owed Proof log line"

# ════ P27: --seen on a note whose carry-back waits, or that the re-check turns owed ═════════════════════════════
scen p27
ro p27-old.md 'status: open' "$OLD" "$OLDSHA"
BODY=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carry-back owed: x; status: done written for that engine (ADR 0078 d1)\n' \
  mk p27-w.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
mk p27-wd.md 'status: open' 'rollout: "[[p27-old]]"' 'depends-on:' '  - "[[p27-w]]"'
mk p27-n.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'rollout: "[[p27-old]]"' 'clears:' '  - "x"'
before=$(sums "$TK/p27-w.md" "$TK/p27-n.md")
pv --tasks p27-w --seen "the stuck work moved"
ok "$rc" 1 "P27: --seen on an owed note whose carry-back waits → exit 1"
has "$err" "ERROR: prove: p27-w: not a carried fix (landed, carry-back waits: dependant [[p27-wd]] in [[p27-old]]: engine abc123def456 reads a carried fix as awaiting Integration): nothing recorded" \
    "P27: … the ERROR names the wait"
pv --tasks p27-n --seen "the stuck work moved"
ok "$rc" 1 "P27: --seen on a note done before Proven under its own old engine → exit 1"
has "$err" "ERROR: prove: p27-n: not a carried fix (landed, carry-back waits: engine abc123def456" "P27: … the ERROR names its own engine"
ok "$(sums "$TK/p27-w.md" "$TK/p27-n.md")" "$before" "P27: … nothing recorded on either"
mk p27-c.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
mk p27-cd.md 'status: open' 'rollout: "[[p27-old]]"' 'depends-on:' '  - "[[p27-c]]"'
pv --tasks p27-c --seen "the stuck work moved"
ok "$rc|$(fm p27-c.md status)" "1|done" "P27: --seen on a carried fix the re-check turns owed → owed written, exit 1"
has "$err" "ERROR: prove: p27-c: not a carried fix (landed, carry-back owed: dependant [[p27-cd]] in [[p27-old]]" "P27: … the ERROR names it owed"
hasnt "$(proof p27-c.md)" "seen item" "P27: … and no seen item is recorded"
mk Archive/Rollouts/p27-r.md 'status: review' 'merged: 2026-11-11T08:00+00:00' 'live: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
before=$(sums "$TK/Archive/Rollouts/p27-r.md"); pv --tasks p27-r --seen "x"
ok "$rc|$(sums "$TK/Archive/Rollouts/p27-r.md")" "1|$before" "P27: --seen on a note under Archive/Rollouts/ → exit 1, nothing recorded"
has "$err" "ERROR: prove: p27-r: not a carried fix (filed under Archive/Rollouts/): nothing recorded" "P27: … the ERROR says where it is"

# ════ P28: carry-back reopens the done phase over its fix ═══════════════════════════════════════════════════════
scen p28
OWEDB=$'\n## Proof log\n\n- 2026-11-11T09:00+00:00 landed, carry-back owed: x; status: done written for that engine (ADR 0078 d1)\n'
phase() { mkdir -p "$(dirname "$PH/$1")"; printf -- '---\ntags:\n  - phase\nstatus: %s\n%s---\n\n# %s\n' "$2" "${3:-}" "$(basename "$1" .md)" > "$PH/$1"; }
pfm() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$PH/$1" "$2"; }
phase demo-p1-fixes.md done $'completed: 2026-11-10\n'
phase demo-p10-other.md done $'completed: 2026-11-10\n'
phase demox-p1-other.md done $'completed: 2026-11-10\n'
BODY="$OWEDB" mk demo-p1-1-fix.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
pv --tasks demo-p1-1-fix --dry-run
has "$out" "demo-p1-1-fix: would carry back (status: review; phase [[demo-p1-fixes]] reopened)" "P28: --dry-run names the phase it would reopen"
ok "$(pfm demo-p1-fixes.md status)" "done" "P28: … and writes nothing"
pv --tasks demo-p1-1-fix
ok "$(fm demo-p1-1-fix.md status)|$(pfm demo-p1-fixes.md status)|$(pfm demo-p1-fixes.md completed)" "review|open|<none>" \
   "P28: a done phase over a carried-back fix is reopened: status: open, completed: removed"
has "$(proof demo-p1-1-fix.md)" "carried back: landed at status: done, never Proven (ADR 0078 d1); phase [[demo-p1-fixes]] reopened" \
    "P28: … the Proof log line names it"
ok "$(pfm demo-p10-other.md status)|$(pfm demox-p1-other.md status)" "done|done" "P28: … never p10 (-p1- is literal) or another project's p1"
python3 "$RP" --project demo --vault "$V" --kinds phase --phases 1 --no-gh --json > "$T/out" 2>&1; out=$(cat "$T/out")
ok "$(j '[i["slug"] for i in d["unambiguous"] + d["ambiguous"]]')" '[]' "P28: … reconcile-project then reads the reopened phase QUIET"
phase Archive/demo-p2-fixes.md done $'completed: 2026-11-10\n'
mk Archive/demo-p2-1-fix.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'completed: 2026-11-10' 'clears:' '  - "x"'
pv --all
ok "$([ -f "$PH/demo-p2-fixes.md" ] && echo root)|$([ -f "$PH/Archive/demo-p2-fixes.md" ] && echo still || echo gone)|$(pfm demo-p2-fixes.md status)|$(pfm demo-p2-fixes.md completed)" \
   "root|gone|open|<none>" "P28: a phase the sweep archived is moved back to Work/Phases/ and reopened"
has "$(proof demo-p2-1-fix.md)" "; from Archive/; completed: 2026-11-10 removed; phase [[demo-p2-fixes]] reopened from Archive/" "P28: … its clause says from Archive/"
phase Archive/demo-p3-fixes.md done $'completed: 2026-11-10\n'
phase demo-p3-fixes.md open
BODY="$OWEDB" mk demo-p3-1-fix.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "x"'
before=$(sums "$PH/Archive/demo-p3-fixes.md" "$PH/demo-p3-fixes.md")
pv --tasks demo-p3-1-fix
ok "$(fm demo-p3-1-fix.md status)|$(sums "$PH/Archive/demo-p3-fixes.md" "$PH/demo-p3-fixes.md")" "review|$before" \
   "P28: a root phase note of the same name leaves both phase notes as they are; the task is still carried back"
has "$(proof demo-p3-1-fix.md)" "phase [[demo-p3-fixes]] not reopened: Work/Phases/demo-p3-fixes.md exists" "P28: … its clause says why"
# An owed note with no clears:, unwatched: carried back and proven in the same pass, so its done phase is never touched.
phase demo-p4-fixes.md done $'completed: 2026-11-10\n'
BODY="$OWEDB" mk demo-p4-1-fix.md 'status: done' 'merged: 2026-11-11T08:00+00:00'
before=$(sums "$PH/demo-p4-fixes.md")
pv --tasks demo-p4-1-fix --dry-run
ok "$(printf '%s\n' "$out" | grep '^demo-p4-1-fix: ')" "$(printf 'demo-p4-1-fix: would carry back (status: review)\ndemo-p4-1-fix: would prove (done; proven: 2026-11-11)')" \
   "P28: --dry-run of a carry-back the judge proves names no phase"
pv --tasks demo-p4-1-fix
ok "$(fm demo-p4-1-fix.md status)|$(fm demo-p4-1-fix.md proven)|$(sums "$PH/demo-p4-fixes.md")" "done|2026-11-11|$before" \
   "P28: a carry-back proven in the same pass leaves its done phase byte-identical (completed: kept)"
hasnt "$(proof demo-p4-1-fix.md)" "phase [[" "P28: … and its Proof log names no phase"
# A --seen refused after the carry-back (two items, no --item): the item is not recorded, the carry-back and its reopen are.
phase demo-p5-fixes.md done $'completed: 2026-11-10\n'
BODY="$OWEDB" mk demo-p5-1-fix.md 'status: done' 'merged: 2026-11-11T08:00+00:00' 'clears:' '  - "a"' '  - "b"'
pv --tasks demo-p5-1-fix --seen "it moved"
ok "$rc|$(fm demo-p5-1-fix.md status)|$(pfm demo-p5-fixes.md status)" "2|review|open" \
   "P28: a --seen refused after a carry-back → exit 2; the note is carried back and its phase reopened"
has "$(proof demo-p5-1-fix.md)" "carried back: landed at status: done, never Proven (ADR 0078 d1); phase [[demo-p5-fixes]] reopened" \
    "P28: … its carry-back line names the phase"
hasnt "$(proof demo-p5-1-fix.md)" "seen item" "P28: … and no seen item is recorded"
MUT=$(hx 'print(mod._reopen_phases("demo-p9-1-fix", Path(argv[0]), True))
f = Path(argv[1]) / "demo-p9-x.md"
f.write_text("---\ntags: [phase]\nstatus: dropped\n---\n")
print(mod._reopen_phases("demo-p9-1-fix", Path(argv[0]), True))
f.write_text("---\ntags: [phase]\nstatus: done\n---\n")
print(mod._reopen_phases("demo-p9-1-fix", Path(argv[0]), True))' "$TK" "$PH")
ok "$MUT" "$(printf "[]\n[]\n['phase [[demo-p9-x]] reopened']")" "P28: no phase, or a dropped one, is never reopened (control: a done one is)"

exit $fail
