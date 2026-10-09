#!/usr/bin/env bash
# Schedule orders a queue (ADR 0030 decision 1): skills/schedule/rollout-template.md rendered with a fixed
# placeholder map (Q1: protocol 5, a `## Queue` table, no `wave` anywhere, and born `incomplete: true`, which
# `next` refuses until schedule step 7's last write removes it), then fed to reconcile-rollout.py `next` /
# `status`, which read the `## Queue` rows as the schedule rank: three tasks on one file give one queue, no
# waves (Q2); a Solo task ranked first holds the rest (Q3); a frontmatter dependency holds its dependant
# (Q4); a head Solo pair at `normal` starts ahead of `high` tasks (Q5). Temp notes only; no vault, no
# network. bash 3.2-compatible (macOS).
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
# An absent parallel_ceiling resolves through rollout-settings.py (~/.config/thread/rollouts.toml, p15-4): every
# call that reaches it runs with HOME=$EH, an empty dir, so only the built-in applies and the operator's file never does.
EH="$TMP/settings-home"; mkdir -p "$EH"
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
NOW=2026-10-02T14:05:00Z

D=""
scen() { D="$TMP/$1"; mkdir -p "$D"; echo "== $1"; }
# render <slug> <queue rows> <file-set lines> — the template, every placeholder substituted, as $D/<slug>.md
# (schedule step 6: the note is born `incomplete: true`). The four rollout settings come from schedule step 2.8's
# real path: rollout-settings.py --repo <the Project root>, under HOME=$RH (default: an empty dir, so the
# built-ins) with the Project root $RREPO (default $D).
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

echo
if [ "$fail" -eq 0 ]; then echo "schedule-queue: ALL PASS"; else echo "schedule-queue: FAILED"; fi
exit "$fail"
