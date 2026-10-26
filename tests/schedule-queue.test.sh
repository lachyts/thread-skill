#!/usr/bin/env bash
# Schedule orders a queue (ADR 0030 decision 1): skills/schedule/rollout-template.md rendered with a fixed
# placeholder map (Q1: protocol 5, a `## Queue` table, no `wave` anywhere, and born `incomplete: true`, which
# `next` refuses until schedule step 7's last write removes it), then fed to reconcile-rollout.py `next` /
# `status`, which read the `## Queue` rows as the schedule rank: three tasks on one file give one queue, no
# waves (Q2); a Solo task ranked first holds the rest (Q3); a frontmatter dependency holds its dependant
# (Q4); a head Solo pair at `normal` starts ahead of `high` tasks (Q5). A project's `Named re-run:` stamped as step 6
# says (Q6) reads back through the lead's own `verify-timeout` as `namedRerun`, and the lead's Flake check runs with it;
# none leaves the line commented and no key; one the lead would refuse is step 6's exit 2. `cited` lists the paths
# the not-yet-merged tasks cite, for execute § 2.7's pushed-base scoping (ADR 0042). Temp notes only; no vault, no
# network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
. tests/lib/rollout-fixtures.sh   # away_file
root=$(pwd -P)
TPL="$root/skills/schedule/rollout-template.md"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
# An absent parallel_ceiling resolves through rollout-settings.py (~/.config/thread/rollouts.toml, p15-4): every
# call that reaches it runs with HOME=$EH, an empty dir, so only the built-in applies and the operator's file never does.
# Its one fresh Away file (p28-1, execute away.md) runs each rollout to its own ceiling, never the Trickle.
EH="$TMP/settings-home"; mkdir -p "$EH"; away_file "$EH" 2026-10-02T00:00:00Z
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
NOW=2026-10-02T14:05:00Z

D=""
scen() { D="$TMP/$1"; mkdir -p "$D"; echo "== $1"; }
# render <slug> <queue rows> <file-set lines> — the template, every placeholder substituted, as $D/<slug>.md
# (schedule step 6: the note is born `incomplete: true`). The four rollout settings come from schedule step 2.8's
# real path: rollout-settings.py --repo <the Project root>, under HOME=$RH (default: an empty dir, so the
# built-ins) with the Project root $RREPO (default $D). NAMED=<cmd> stamps the project's `Named re-run:` as step 6
# does: the whole `# named_rerun:` line becomes `named_rerun: "<cmd>"`, single-quoted when it holds a " or a \.
RS="$root/skills/_shared/scripts/rollout-settings.py"
render() {
  local rh="${RH:-$TMP/render-home}" repo="${RREPO:-$D}" settings
  mkdir -p "$rh"
  settings=$(HOME="$rh" python3 "$RS" --repo "$repo") || { echo "FAIL - render: rollout-settings.py refused"; fail=1; return 1; }
  python3 - "$TPL" "$D/$1.md" "$repo" "$2" "$3" "$settings" <<'PY'
import json, sys
tpl, out, repo, rows, files, settings = sys.argv[1:]
resolved = {k: str(v["value"]) for k, v in json.loads(settings)["settings"].items()}
vals = {
    "MAX_ITERATIONS": resolved["max_iterations"], "MAX_REVIEW_ROUNDS": resolved["max_review_rounds"],
    "MAX_PLAN_ROUNDS": resolved["max_plan_rounds"], "PARALLEL_CEILING": resolved["parallel_ceiling"],
    "PROJECT_NAME": "Demo", "DATE": "2026-10-02", "VERIFIER": "make test", "REPO_PATH": repo,
    "ROLLOUT_SLUG": out.rsplit("/", 1)[1][:-3], "THREAD_LINE": "Thread: `" + repo + "/THREAD.md`",
    "QUEUE_TABLE": "| # | Task | Scope | Mode |\n|---|---|---|---|\n" + rows,
    "QUEUE_RATIONALE": "Ordered by dependency, then by phase numbering.", "FILE_SETS": files,
    "KNOWN_BASELINE_FAILURES": "none", "POST_ROLLOUT_ITEMS": "none",
}
text = open(tpl).read()
for k, v in vals.items():
    text = text.replace("{{%s}}" % k, v)
import os, re
named = os.environ.get("NAMED")
if named is not None:
    q = "'" if ('"' in named or "\\" in named) else '"'
    text, n = re.subn(r"(?m)^# named_rerun:.*$", lambda _m: f"named_rerun: {q}{named}{q}", text)
    assert n == 1, "the template has no # named_rerun: line"
open(out, "w").write(text)
PY
}
# step7end <slug> — schedule step 7's last write, once every task is stamped: the `incomplete: true` line removed
step7end() { grep -v '^incomplete:' "$D/$1.md" > "$D/$1.tmp" && mv "$D/$1.tmp" "$D/$1.md"; }
# mkt <slug> <status> [frontmatter lines...] — a task note linked to the rollout `ro`
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[ro]]"\n' "$st"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
nxt() { HOME="$EH" python3 "$RR" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run; }
st() { HOME="$EH" python3 "$RR" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW"; }
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True))' "$2"; }
row() { printf '| %s | [[%s\\|%s]] | single-file | %s |' "$1" "$2" "$2" "$3"; }

# ── Q1: the rendered template ─────────────────────────────────────────────────────────────────────────
scen q1
render ro "$(row 1 a —)" "- a: src/hub.py"
ok "$(grep -c '{{' "$D/ro.md")" 0 "Q1: every placeholder is substituted"
ok "$(grep -c '^protocol_version: 5$' "$D/ro.md")" 1 "Q1: protocol_version: 5"
ok "$(grep -c '^parallel_ceiling: 4$' "$D/ro.md")" 1 "Q1: parallel_ceiling: 4"
ok "$(grep -c '^## Queue$' "$D/ro.md")" 1 "Q1: a ## Queue heading"
ok "$(grep -ci 'wave' "$D/ro.md")" 0 "Q1: no wave anywhere, Post-rollout included"
ok "$(grep -c '^## File-sets$' "$D/ro.md")" 1 "Q1: the ## File-sets block stays (the overlap tiebreak)"
ok "$(grep -c '^incomplete: true' "$D/ro.md")" 1 "Q1: the note is born incomplete: true"
mkt a open
nxt > "$D/out" 2> "$D/err"; rc=$?
ok "$rc|$(cat "$D/out")" "1|" "Q1: next refuses the note until step 7 ends"
has "$(cat "$D/err")" "is incomplete: it carries incomplete: true" "Q1: … naming the stamp"
step7end ro
ok "$(grep -c '^incomplete:' "$D/ro.md")" 0 "Q1: step 7's last write removes the stamp"
ok "$(q "$(nxt)" 'd["start"]')" '["a"]' "Q1: … and next then runs the queue"
ok "$(grep -c '^max_iterations: 3$' "$D/ro.md")|$(grep -c '^max_review_rounds: 4$' "$D/ro.md")|$(grep -c '^max_plan_rounds: 3  #' "$D/ro.md")" "1|1|1" \
  "Q1: with no rollouts.toml the built-in max_iterations 3, max_review_rounds 4, max_plan_rounds 3 are stamped"

# ── Q1b: schedule stamps the operator's rollouts.toml values (p15-4) ─────────────────────────────────────
scen q1b
RH="$D/home"; mkdir -p "$RH/.config/thread"
printf '%s\n' '[defaults]' 'max_review_rounds = 5' '[repo."o/r"]' 'parallel_ceiling = 6' > "$RH/.config/thread/rollouts.toml"
RREPO="$D/clone"; git init -q "$RREPO"; git -C "$RREPO" remote add origin git@github.com:O/R.git
render ro "$(row 1 a —)
$(row 2 b —)
$(row 3 c —)
$(row 4 d —)
$(row 5 e —)
$(row 6 f —)
$(row 7 g —)" ""
unset RH RREPO
ok "$(grep -c '^parallel_ceiling: 6$' "$D/ro.md")|$(grep -c '^max_review_rounds: 5$' "$D/ro.md")|$(grep -c '^max_iterations: 3$' "$D/ro.md")" "1|1|1" \
  "Q1b: the repo table's parallel_ceiling 6 (matched ignoring case over SSH) and [defaults]' max_review_rounds 5 are stamped"
step7end ro
for s in a b c d e f g; do mkt "$s" open; done
ok "$(q "$(nxt)" 'd["start"]')" '["a","b","c","d","e","f"]' "Q1b: next honours the stamped ceiling (6 of 7 start)"

# ── Q2: three tasks on one file give one queue, no waves ─────────────────────────────────────────────
scen q2
render ro "$(row 1 c —)
$(row 2 a —)
$(row 3 b —)" "- c: src/hub.py
- a: src/hub.py
- b: src/hub.py"
mkt a open; mkt b open; mkt c open; step7end ro
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["c","a","b"]' "Q2: all three on src/hub.py start in one call, in the table's order"
ok "$(q "$J" 'd["hold"]')" '[]' "Q2: a shared file holds nothing back"
J=$(st)
ok "$(q "$J" '[t["slug"] for t in d["tasks"]]')" '["c","a","b"]' "Q2: status lists them in queue order"
ok "$(cat "$D"/a.md "$D"/b.md "$D"/c.md | grep -ci 'wave')" 0 "Q2: no task note mentions a wave"

# ── Q3: a Solo task ranked first holds the rest ──────────────────────────────────────────────────────
scen q3
render ro "$(row 1 s solo)
$(row 2 a —)
$(row 3 b —)" "- s: src/hub.py
- a: src/hub.py
- b: src/hub.py"
mkt s open 'solo: true'; mkt a open; mkt b open; step7end ro
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["s"]' "Q3: the Solo task starts alone"
ok "$(q "$J" '{h["slug"]: h["reason"] for h in d["hold"]}')" '{"a":"behind solo [[s]]","b":"behind solo [[s]]"}' "Q3: the others wait behind it"
sed -i.bak 's/^status: open$/status: done/' "$D/s.md"; rm -f "$D/s.md.bak"
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a","b"]' "Q3: once it merges, both same-file tasks start"

# ── Q4: a frontmatter dependency holds its dependant ─────────────────────────────────────────────────
scen q4
render ro "$(row 1 a —)
$(row 2 b —)
$(row 3 c —)" "- a: src/x.py"
mkt a open; mkt b open 'depends-on:' '  - "[[a]]"'; mkt c open; step7end ro
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a","c"]' "Q4: a and c start"
ok "$(q "$J" '{h["slug"]: h["reason"] for h in d["hold"]}')" '{"b":"depends on [[a]] (open)"}' "Q4: b waits on its dependency"

# ── Q5: a head Solo pair at normal starts ahead of high tasks ranked below it (p17-2) ───────────────────
scen q5
render ro "$(row 1 p1 solo)
$(row 2 p2 solo)
$(row 3 h1 —)
$(row 4 h2 —)
$(row 5 h3 —)" "- p1: src/stage.js
- p2: src/stage.js
- h1: src/stage.js
- h2: src/stage.js
- h3: src/stage.js"
mkt p1 open 'solo: true'; mkt p2 open 'solo: true'
mkt h1 open 'priority: high'; mkt h2 open 'priority: high'; mkt h3 open 'priority: high'; step7end ro
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["p1"]' "Q5: the first Solo row starts alone, ahead of three high tasks"
ok "$(q "$J" '{h["slug"]: h["reason"] for h in d["hold"]}')" \
  '{"h1":"behind solo [[p1]]","h2":"behind solo [[p1]]","h3":"behind solo [[p1]]","p2":"behind solo [[p1]]"}' "Q5: … the rest wait behind it"
sed -i.bak 's/^status: open$/status: done/' "$D/p1.md"; rm -f "$D/p1.md.bak"
ok "$(q "$(nxt)" 'd["start"]')" '["p2"]' "Q5: once it merges the second Solo row starts"
sed -i.bak 's/^status: open$/status: done/' "$D/p2.md"; rm -f "$D/p2.md.bak"
ok "$(q "$(nxt)" 'd["start"]')" '["h1","h2","h3"]' "Q5: once both merge the high tasks start"

# ── Q6: the project's Named re-run reaches the lead (schedule steps 2.5 and 6, ADR 0050) ──────────────────────────
# vt <note>: the lead's entry check, which step 6's *Check the stamped commands* runs on the note just written.
vt() { HOME="$EH" python3 "$RR" verify-timeout --rollout "$1" > "$D/vt.out" 2> "$D/vt.err"; vrc=$?; }
scen q6
render ro "$(row 1 a —)" ""
ok "$(grep -c '^# named_rerun: ' "$D/ro.md")|$(grep -c '^named_rerun:' "$D/ro.md")" "1|0" "Q6: no Named re-run → the template's line stays commented out"
vt "$D/ro.md"
ok "$vrc|$(q "$(cat "$D/vt.out")" '"namedRerun" in d')" "0|false" "Q6: … and verify-timeout prints no namedRerun (the lead's red stays red)"
NAMED='scripts/test -n0 {tests}' render ro "$(row 1 a —)" ""
ok "$(grep -c '^named_rerun: "scripts/test -n0 {tests}"$' "$D/ro.md")|$(grep -c '^# named_rerun:' "$D/ro.md")" "1|0" "Q6: a Named re-run → stamped double-quoted, the commented line replaced"
vt "$D/ro.md"
ok "$vrc|$(q "$(cat "$D/vt.out")" 'd["namedRerun"]')" '0|"scripts/test -n0 {tests}"' "Q6: … verify-timeout reads it back as namedRerun"
NAMED='sh -c "exit 0" x {tests} # kept' render ro "$(row 1 a —)" ""
ok "$(grep -cF "named_rerun: 'sh -c \"exit 0\" x {tests} # kept'" "$D/ro.md")" 1 "Q6: one holding a \" → single-quoted, its # kept inside the quotes"
vt "$D/ro.md"
ok "$vrc|$(q "$(cat "$D/vt.out")" 'd["namedRerun"]')" '0|"sh -c \"exit 0\" x {tests} # kept"' "Q6: … read back byte for byte"
# The lead's Flake check runs with what schedule stamped: namedRerun passed as --named-rerun (execute's verify line).
G="$D/repo"; git init -q "$G"; mkdir -p "$G/tests"; echo t > "$G/tests/test_a.py"; echo s > "$G/src.py"
git -C "$G" add . && git -C "$G" -c user.name=t -c user.email=t@t commit -q -m base; GB=$(git -C "$G" rev-parse HEAD)
echo task > "$G/src.py"; git -C "$G" -c user.name=t -c user.email=t@t commit -q -am task
VER='n=$(( $(cat ../n 2>/dev/null || echo 0) + 1 )); echo $n > ../n; [ $n -gt 1 ] || { echo "FAILED tests/test_a.py::test_t"; exit 1; }'
NRCMD=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["namedRerun"])' "$D/vt.out")
python3 "$root/skills/execute/scripts/lead-integrate.py" verify --tree "$G" --out "$D/int/v" --timeout 60 --verifier "$VER" \
  --diff-base "$GB" --named-rerun "$NRCMD" > /dev/null 2>&1
ok "$(cat "$D/int/v.rc" 2>/dev/null)|$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["verdict"], d["flakes"])' "$D/int/v.flake.json" 2>/dev/null)" \
  "0|flake ['tests/test_a.py::test_t']" "Q6: … and the lead's Flake check runs with it: an out-of-diff red its named re-run and confirming run clear is a Flake"
has "$(cat "$D/int/v.log")" "== named re-run: sh -c \"exit 0\" x tests/test_a.py::test_t # kept" "Q6: … the named re-run is the stamped command, {tests} filled"
NAMED='scripts/test -n0' render ro "$(row 1 a —)" ""
vt "$D/ro.md"
ok "$vrc|$(cat "$D/vt.out")" "2|" "Q6: a stamp with no {tests} → verify-timeout exit 2, no stdout: step 6's check stops the run"
has "$(cat "$D/vt.err")" "named_rerun:" "Q6: … its ERROR line names the key"
NAMED='r {tests} {tests}' render ro "$(row 1 a —)" ""
vt "$D/ro.md"
ok "$vrc" 2 "Q6: … as does one holding {tests} twice"

# ── cited: the paths the not-yet-merged tasks cite, for execute § 2.7's pushed-base scoping (ADR 0042) ───────
scen cited
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n## Queue\n' > "$D/ro.md"
ct() {  # ct <slug> <status> <body> [frontmatter line] — a task note linked to `ro`
  printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[ro]]"\n%s\n---\n%s\n' "$2" "${4:-}" "$3" > "$D/$1.md"
}
ct q open 'Read ADR 0031 and `docs/adr/0042-x.md`; keep THREAD.md and `src/THREAD.md` current.' 'touches: [a/b.py, THREAD.md]'
ct r in_progress 'Update CONTEXT.md and ~/.claude/settings.json:170 (the hook block).'
ct v review 'Run it in ~/repos/workspaces. Then ADR-0031 again.' 'pr: https://github.com/o/r/pull/7'
ct d done 'Landed: ADR 0099, ~/landed/x.md and docs/CONTEXT.md.' 'touches: [z/landed.py]'
ct x dropped 'Dropped: ADR 0098 and ~/dropped/y.md.'
out=$(python3 "$RR" cited --rollout "$D/ro.md" --tasks-dir "$D" 2>"$TMP/err"); rc=$?
ok "$out" "CONTEXT.md
a/b.py
docs/adr/0031-*.md
docs/adr/0042-*.md
~/.claude/settings.json
~/repos/workspaces" "cited: queued, running and awaiting-Integration tasks' touches:, ADR globs, CONTEXT.md and ~/ paths, sorted, never THREAD.md, never a done or dropped task's"
ok "$rc|$(cat "$TMP/err")" "0|" "cited: exit 0, silent"
ct s blocked 'A set-aside task still cites tools/CONTEXT.md and ADR 0007.'
out=$(python3 "$RR" cited --rollout "$D/ro.md" --tasks-dir "$D" 2>/dev/null)
has "$out" "tools/CONTEXT.md" "cited: a set-aside task's relative …/CONTEXT.md is cited"
has "$out" "docs/adr/0007-*.md" "cited: … and its ADR"
python3 "$RR" cited --rollout "$D/missing.md" --tasks-dir "$D" >/dev/null 2>&1; ok "$?" 2 "cited: a missing rollout note → 2"
python3 "$RR" cited --tasks-dir "$D" >/dev/null 2>&1; ok "$?" 2 "cited: no --rollout → usage error 2"

echo
if [ "$fail" -eq 0 ]; then echo "schedule-queue: ALL PASS"; else echo "schedule-queue: FAILED"; fi
exit "$fail"
