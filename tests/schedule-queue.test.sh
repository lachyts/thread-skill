#!/usr/bin/env bash
# Schedule orders a queue (ADR 0030 decision 1): skills/schedule/rollout-template.md rendered with a fixed
# placeholder map (Q1: protocol 5, a `## Queue` table, no `wave` anywhere, and born `incomplete: true`, which
# `next` refuses until schedule step 7's last write removes it), then fed to reconcile-rollout.py `next` /
# `status`, which read the `## Queue` rows as the schedule rank: three tasks on one file give one queue, no
# waves (Q2); a Solo task ranked first holds the rest (Q3); a frontmatter dependency holds its dependant
# (Q4). Temp notes only; no vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
root=$(pwd -P)
TPL="$root/skills/schedule/rollout-template.md"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
NOW=2026-10-02T14:05:00Z

D=""
scen() { D="$TMP/$1"; mkdir -p "$D"; echo "== $1"; }
# render <slug> <queue rows> <file-set lines> — the template, every placeholder substituted, as $D/<slug>.md
# (schedule step 6: the note is born `incomplete: true`)
render() {
  python3 - "$TPL" "$D/$1.md" "$D" "$2" "$3" <<'PY'
import sys
tpl, out, repo, rows, files = sys.argv[1:]
vals = {
    "PROJECT_NAME": "Demo", "DATE": "2026-10-02", "VERIFIER": "make test", "REPO_PATH": repo,
    "ROLLOUT_SLUG": out.rsplit("/", 1)[1][:-3], "THREAD_LINE": "Thread: `" + repo + "/THREAD.md`",
    "QUEUE_TABLE": "| # | Task | Scope | Mode |\n|---|---|---|---|\n" + rows,
    "QUEUE_RATIONALE": "Ordered by dependency, then by phase numbering.", "FILE_SETS": files,
    "KNOWN_BASELINE_FAILURES": "none", "POST_ROLLOUT_ITEMS": "none",
}
text = open(tpl).read()
for k, v in vals.items():
    text = text.replace("{{%s}}" % k, v)
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
nxt() { python3 "$RR" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run; }
st() { python3 "$RR" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW"; }
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
ok "$(q "$J" '[t["wave"] for t in d["tasks"]]')" '[null,null,null]' "Q2: no task carries a wave"
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

echo
if [ "$fail" -eq 0 ]; then echo "schedule-queue: ALL PASS"; else echo "schedule-queue: FAILED"; fi
exit "$fail"
