#!/usr/bin/env bash
# p21-3 (ADR 0037 d1): Review churn lands in the Run record. reconcile-rollout.py turns each entry of an engine row's
# reviewVerdicts (every master-review round the call judged, with its own bullets) into one review-verdict event,
# split original / regression by review-split.py: each bullet's first `path:line` blamed at the round's head, a
# regression when the blamed commit is in first-parent baseline..head (the baseline the task's first judged head).
#
# A temp git repo is the task tree: commit A on main (h1, a.py lines 1-10), then on the task's branch commit B fixes
# a.py line 5 (h2) and commit C adds b.py (h3); later a main commit touches a.py line 7 and is merged into the branch
# (h4). Each case keeps its own THREAD_EVENTS_DIR and task note (status in_progress, `rollout: [[ro]]`); HOME is an
# empty dir for every reconcile call. Covered: the main split, the stops that keep their round's bullets, the
# signed-gate resume written once (head-less and with a head), head normalisation, re-reconcile, --dry-run, a missing
# tree, first-parent, a seeded call's baseline, the rows that write nothing, a malformed entry, and score.py's
# reviewChurn over a reconciled record. Temp dirs only.
#
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR and ignores THREAD_TEST_EVENTS_DIR.
# Usage: bash reconcile-rollout-churn.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
RRPY="$HERE/../../_shared/scripts/run_record.py"
SCORE="$HERE/../../reflect/scripts/score.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
# Calls that reach rollout-settings.py read ~/.config/thread/rollouts.toml: HOME is an empty dir (p15-4's rule).
export HOME="$TMP/home"; mkdir -p "$HOME"
export THREAD_EVENTS_DIR="$TMP/events"   # the Run record (run_record.py, ADR 0032) stays in temp; each case sets its own
export GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name "churn-tests"; git config --global user.email "churn-tests@example.invalid"
V="$TMP/vault"; R="$TMP/repo"
mkdir -p "$V"
NOW=2026-10-05T10:00:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok "$1" "*$2*" "$3";; esac; }
hasnt() { case "$1" in *"$2"*) ok "$1" "no $2" "$3";; *) ok y y "$3";; esac; }

# ---- the task tree --------------------------------------------------------------------------------------------
g() { git -C "$R" "$@"; }
mkdir -p "$R"; git init -q "$R"; g symbolic-ref HEAD refs/heads/main
for i in 1 2 3 4 5 6 7 8 9 10; do echo "line $i"; done > "$R/a.py"
g add a.py; g commit -qm "A: the work as first judged"; H1=$(g rev-parse HEAD)
g checkout -qb feat
sed 's/^line 5$/line 5 fixed/' "$R/a.py" > "$R/a.tmp" && mv "$R/a.tmp" "$R/a.py"
g commit -qam "B: the r1 fix"; H2=$(g rev-parse HEAD)
echo "x = 1" > "$R/b.py"; g add b.py; g commit -qm "C: another fix"; H3=$(g rev-parse HEAD)
g checkout -q main
sed 's/^line 7$/line 7 from main/' "$R/a.py" > "$R/a.tmp" && mv "$R/a.tmp" "$R/a.py"
g commit -qam "M: another PR on main"; M7=$(g rev-parse HEAD)
g checkout -q feat; g merge -q --no-edit main >/dev/null; H4=$(g rev-parse HEAD)
ok "$(g rev-parse HEAD^1)" "$H3" "fixture: h4 is a merge of main onto the branch (first parent h3)"
ok "$(g blame -L 7,7 --porcelain "$H4" -- a.py | head -1 | cut -c1-40)" "$M7" "fixture: a.py:7 at h4 blames main's commit"

# ---- helpers --------------------------------------------------------------------------------------------------
# use <case>: a fresh events dir and task note t-<case> (in_progress, rollout ro)
use() {
  CASE=$1; T="t-$1"
  export THREAD_EVENTS_DIR="$TMP/ev-$1"
  mkt "$T" in_progress ro
}
# mkt <slug> <status> <rollout|->: a task note in $V
mkt() {
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\n' "$2"
    [ "$3" = "-" ] || printf 'rollout: "[[%s]]"\n' "$3"
    printf -- '---\n\n## Notes\n\nbody of %s\n' "$1"; } > "$V/$1.md"
}
setst() {  # setst <slug> <status>: what approve-gates' flip (or the lead's launch stamp) leaves
  python3 - "$V/$1.md" "$2" <<'PY'
import re, sys
p, st = sys.argv[1:]
t = open(p).read()
open(p, "w").write(re.sub(r"(?m)^status: .*$", "status: " + st, t, count=1))
PY
}
# row <status> <verdicts json> [extra json] [tree]: a task-call row file for $T, its path printed
row() {
  local f; f=$(mktemp "$TMP/row-$CASE.XXXXXX")
  python3 - "$f" "$T" "$1" "$2" "${3:-}" "${4-$R}" <<'PY'
import json, sys
out, slug, status, verdicts, extra, tree = sys.argv[1:]
d = {"slug": slug, "scope": "cross-cutting", "status": status, "prUrl": "https://github.com/o/r/pull/7",
     "branch": "audit-fix/x", "worktreePath": tree, "reviewRoundsUsed": 1, "planRoundsUsed": 0, "rung": "",
     "blockerDiagnosis": "", "reviewFeedback": [], "reviewHistory": [], "reviewVerdicts": json.loads(verdicts)}
d.update(json.loads(extra) if extra else {})
json.dump({"rolloutSlug": "ro", "tasks": [d]}, open(out, "w"))
PY
  echo "$f"
}
rec() { python3 "$SCRIPT" reconcile --result "$1" --tasks-dir "$V" --now "$NOW" "${@:2}"; }
# v <round> <verdict> <head> <feedback json>: one reviewVerdicts entry
v() { printf '{"round":%s,"verdict":"%s","head":"%s","feedback":%s}' "$1" "$2" "$3" "$4"; }
# rv [expr]: the case's review-verdict lines, one `rN:findings/original/regression` each (or the expr over d)
rv() {
  python3 - "$THREAD_EVENTS_DIR/ro.jsonl" "${1:-}" <<'PY'
import json, sys
path, expr = sys.argv[1:]
try:
    lines = [json.loads(l) for l in open(path) if l.strip()]
except FileNotFoundError:
    lines = []
out = []
for d in lines:
    if d.get("kind") == "review-verdict":
        out.append(str(eval(expr)) if expr else "r%d:%d/%d/%d" % (d["round"], d["findings"], d["original"], d["regression"]))
print(" ".join(out))
PY
}
lines() { if [ -f "$THREAD_EVENTS_DIR/ro.jsonl" ]; then wc -l < "$THREAD_EVENTS_DIR/ro.jsonl" | tr -d ' '; else echo 0; fi; }
# dg <verdict> <feedback json>: run_record.verdict_digest
dg() {
  python3 - "$RRPY" "$1" "$2" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.verdict_digest(sys.argv[2], json.loads(sys.argv[3])))
PY
}
# churn <rollout> [args...]: score.py's reviewChurn as `value engine.rounds engine.findings`
churn() {
  python3 "$SCORE" --rollout ro --until 2026-10-05T12:00:00Z "$@" 2>/dev/null | python3 -c '
import json, sys
c = json.load(sys.stdin)["reviewChurn"]
print(c["value"], c["engine"]["rounds"], c["engine"]["findings"])'
}

F1='["a.py:2 the empty corpus is not handled","a.py:3 the off-by-one in the loop","no cite: the README is stale"]'
F2='["a.py:5 the r1 fix drops the guard"]'
GATE='{"gatedInputs":["spend: an API - cap USD 5"],"blockerDiagnosis":"needs a gate"}'

# ---- 1. the main split ----------------------------------------------------------------------------------------
use main
out=$(rec "$(row review "[$(v 1 changes "$H1" "$F1"),$(v 2 changes "$H2" "$F2"),$(v 3 approve "$H3" '[]')]")" 2>"$TMP/err")
ok "$?" 0 "main: exit 0"
ok "$(rv)" "r1:3/2/0 r2:1/0/1 r3:0/0/0" "main: r1 two original (one bullet uncited), r2 answers r1's fix (a regression), r3 approve"
ok "$(rv 'd["head"]')" "$H1 $H2 $H3" "main: each line carries its full head"
ok "$(rv 'd["digest"]')" "$(dg changes "$F1") $(dg changes "$F2") $(dg approve '[]')" "main: digest = verdict_digest of the entry"
ok "$(rv 'd["task"]')" "t-main t-main t-main" "main: the task is the row's slug"
has "$out" "t-main: status=review" "main: stdout is the usual line"
ok "$(cat "$TMP/err")" "" "main: no warning"
cp "$THREAD_EVENTS_DIR/ro.jsonl" "$TMP/main.jsonl"
# e2e: score.py over the record plus a merged line scores churn > 0 (1 regression of 4 findings)
python3 "$RRPY" emit --rollout ro --task t-main --kind merged --json '{"pr":7}' --ts 2026-10-05T10:30:00Z
ok "$(churn --repo-slug o/r)" "0.25 3 4" "main e2e: score.py reads reviewChurn 0.25 over 3 rounds, 4 findings"

# ---- 2. the stops keep their round's bullets --------------------------------------------------------------------
use blocked
rec "$(row blocked "[$(v 1 changes "$H1" "$F1")]" '{"blockerDiagnosis":"reviser could not resolve it"}')" >/dev/null 2>&1
ok "$(rv)" "r1:3/2/0" "a reviser blocked after r1 (reviewHistory []): r1's three findings recorded"
use deadjudge
rec "$(row blocked "[$(v 1 changes "$H1" "$F1")]" '{"blockerDiagnosis":"transient infrastructure failure: re-dispatch cleanly"}')" >/dev/null 2>&1
ok "$(rv)" "r1:3/2/0" "a dead judge at r2: one event, r1, with its three findings"

# ---- 3. the signed-gate resume is written once ------------------------------------------------------------------
use gate
rec "$(row gate-pending "[$(v 1 changes '' "$F1")]" "$GATE")" >/dev/null 2>&1
ok "$(rv)" "r1:3/0/0" "gate: the gate-pending row records r1 (head-less: every finding unclassified)"
ok "$(rv '"head" in d')" "False" "gate: no head key"
setst "$T" in_progress
rec "$(row review "[$(v 1 changes '' "$F1"),$(v 2 approve '' '[]')]")" >/dev/null 2>&1
ok "$(rv)" "r1:3/0/0 r2:0/0/0" "gate: the resume's replayed r1 is skipped; r2 is written"
python3 "$RRPY" emit --rollout ro --task "$T" --kind merged --json '{"pr":7}' --ts 2026-10-05T10:30:00Z
ok "$(churn --repo-slug o/r)" "0.0 2 3" "gate e2e: score.py counts 2 rounds and 3 findings"
use gatehead
rec "$(row gate-pending "[$(v 1 changes "$H1" "$F1")]" "$GATE")" >/dev/null 2>&1
setst "$T" in_progress
rec "$(row review "[$(v 1 changes "$H1" "$F1"),$(v 2 approve "$H2" '[]')]")" >/dev/null 2>&1
ok "$(rv)" "r1:3/2/0 r2:0/0/0" "gate with a head: r1 written once"

# ---- 4. head normalisation -------------------------------------------------------------------------------------
use abbrev
rec "$(row gate-pending "[$(v 1 changes "${H1:0:7}" "$F1")]" "$GATE")" >/dev/null 2>&1
ok "$(rv 'd["head"]')" "$H1" "an abbreviated head is recorded as the full sha"
setst "$T" in_progress
rec "$(row review "[$(v 1 changes "$H1" "$F1"),$(v 2 approve "$H2" '[]')]")" >/dev/null 2>&1
ok "$(rv 'd["round"]')" "1 2" "a later row carrying the full head for r1 is skipped"
use upper
U=$(printf '%s' "$H1" | tr a-f A-F)
rec "$(row review "[$(v 1 changes "$U" "$F1")]")" >/dev/null 2>&1
ok "$(rv 'd["head"]')" "$H1" "an uppercase head is lowercased"
use unknown
rec "$(row review "[$(v 1 changes deadbee "$F1")]")" >/dev/null 2>&1
ok "$(rv '"%s %s" % (d["head"], d["findings"] - d["original"] - d["regression"])')" "deadbee 3" "an unresolvable hex head is kept as given, every finding unclassified"
use option
mkdir -p "$TMP/bin"
REAL_GIT=$(command -v git)
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexec "%s" "$@"\n' "$TMP/git.log" "$REAL_GIT" > "$TMP/bin/git"; chmod +x "$TMP/bin/git"
: > "$TMP/git.log"
out=$(PATH="$TMP/bin:$PATH" rec "$(row review "[$(v 1 changes --output=x "$F1"),$(v 2 changes "$H2" "$F2")]")" 2>"$TMP/err")
ok "$?" 0 "a non-hex head: exit 0"
ok "$(rv '"%s %s" % ("head" in d, d["findings"] - d["original"] - d["regression"])')" "False 3 True 0" "a non-hex head: recorded with no head, every finding unclassified"
ok "$(grep -c 'run_record: warning: t-option: reviewVerdicts: round 1: head' "$TMP/err")" 1 "a non-hex head: one warning"
hasnt "$(cat "$TMP/git.log")" "--output" "a non-hex head never reaches git"
has "$(cat "$TMP/git.log")" "blame" "the wrapper saw the split's git calls"
has "$out" "t-option: status=review" "a non-hex head: stdout unchanged"

# ---- 5. re-reconcile, --dry-run, a missing tree, an empty head ---------------------------------------------------
use rerun
f=$(row review "[$(v 1 changes "$H1" "$F1")]")
rec "$f" >/dev/null 2>&1; n=$(lines); rec "$f" >/dev/null 2>&1
ok "$(lines)" "$n" "a re-reconcile adds no line (the note is no longer in_progress)"
setst "$T" in_progress; rec "$f" >/dev/null 2>&1
ok "$(rv 'd["round"]')" "1" "re-reconciled while in_progress again: the key skip still writes r1 once"
use dry
rec "$(row review "[$(v 1 changes "$H1" "$F1")]")" --dry-run >/dev/null 2>&1
ok "$(lines)" 0 "--dry-run records nothing"
use notree
rec "$(row review "[$(v 1 changes "$H1" "$F1")]" '' "$TMP/gone")" >/dev/null 2>&1
ok "$(rv '"%d/%d/%d" % (d["findings"], d["original"], d["regression"])')" "3/0/0" "a missing worktreePath: the round recorded, every finding unclassified"
ok "$(rv 'd["head"]')" "$H1" "a missing worktreePath: the head kept as given"
use nohead
rec "$(row review "[$(v 1 changes '' "$F1")]")" >/dev/null 2>&1
ok "$(rv '"%s %d/%d/%d" % ("head" in d, d["findings"], d["original"], d["regression"])')" "False 3/0/0" "an empty head: no head key, every finding unclassified"

# ---- 6. first-parent and the baseline ------------------------------------------------------------------------------
use firstparent
rec "$(row review "[$(v 1 changes "$H1" "$F1"),$(v 2 changes "$H4" '["a.py:7 main moved this line","a.py:5 the r1 fix drops the guard"]')]")" >/dev/null 2>&1
ok "$(rv)" "r1:3/2/0 r2:2/1/1" "first-parent: a main line merged into the branch reads as original; the branch's fix as a regression"
use seeded
rec "$(row blocked "[$(v 1 changes "$H1" "$F1")]" '{"blockerDiagnosis":"revise: rejected at Integration re-review"}')" >/dev/null 2>&1
setst "$T" in_progress
rec "$(row review "[$(v 3 changes "$H3" "$F2"),$(v 4 approve "$H3" '[]')]")" >/dev/null 2>&1
ok "$(rv)" "r1:3/2/0 r3:1/0/1 r4:0/0/0" "a seeded call's baseline is the earlier call's first head (r3 reads a.py:5 as a regression)"
use recut
rec "$(row review "[$(v 1 changes "$M7" '["a.py:7 main moved this line"]'),$(v 2 changes "$H3" "$F2")]")" >/dev/null 2>&1
ok "$(rv)" "r1:1/1/0 r2:1/1/0" "a head that is no ancestor resets the baseline to this round's head (all original)"

# ---- 7. rows that write nothing --------------------------------------------------------------------------------------
use integrate
rec "$(row review "[$(v 1 changes "$H1" "$F1")]" '{"integration":{"outcome":"integrated","path":"integrator","anchor":{"headSha":"'"$H1"'"},"headSha":"'"$H2"'","baseSha":"'"$H1"'","triggers":[],"metrics":{}}}')" >/dev/null 2>&1
ok "$(rv)" "" "an integrate row writes no review-verdict"
use norollout
mkt "$T" in_progress -
rec "$(row review "[$(v 1 changes "$H1" "$F1")]")" >/dev/null 2>&1
ok "$(rv)" "" "a note with no rollout: nothing"
use notrunning
setst "$T" review
rec "$(row review "[$(v 1 changes "$H1" "$F1")]")" >/dev/null 2>&1
ok "$(rv)" "" "a prior status other than in_progress: nothing"
use nokey
f=$(row review '[]'); python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); del d["tasks"][0]["reviewVerdicts"]; json.dump(d, open(sys.argv[1], "w"))' "$f"
rec "$f" >/dev/null 2>"$TMP/err"
ok "$(rv)" "" "a row without the key (a pre-p21-3 engine's): nothing"
ok "$(grep -c reviewVerdicts "$TMP/err")" 0 "a row without the key: no warning"

# ---- 8. malformed input -----------------------------------------------------------------------------------------------
use malformed
BAD0='{"round":0,"verdict":"changes","head":"","feedback":[]}'
out=$(rec "$(row review "[$BAD0,$(v 2 changes "$H2" '[7]'),$(v 3 approve "$H3" '[]')]")" 2>"$TMP/err")
ok "$?" 0 "malformed entries: exit 0"
has "$out" "t-malformed: status=review" "malformed entries: stdout unchanged"
ok "$(grep -c 'run_record: warning: t-malformed: reviewVerdicts: entry [12] is malformed' "$TMP/err")" 2 "malformed entries: one warning each"
ok "$(rv)" "r3:0/0/0" "malformed entries: the well-formed one still recorded"
use notalist
out=$(rec "$(row review '{"round":1}')" 2>"$TMP/err")
ok "$?" 0 "a non-list reviewVerdicts: exit 0"
ok "$(grep -c 'run_record: warning: t-notalist: reviewVerdicts: not a list' "$TMP/err")" 1 "a non-list reviewVerdicts: one warning"
ok "$(rv)" "" "a non-list reviewVerdicts: nothing recorded"

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fi
exit "$fail"
