#!/usr/bin/env bash
# Accumulated feedback (p6-4): reconcile keeps every run's feedback under one heading as numbered runs,
# a re-reconcile of the same result is a no-op, an agent's same-run copy is adopted in place, and nothing
# already written is deleted or rewritten. Temp notes only.
# Usage: bash reconcile-rollout-runs.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
NOW=2026-10-02T14:05:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
cnt() { grep -cF -- "$2" "$D/$1.md"; }                           # cnt <slug> <fixed string>
cntx() { grep -cx -- "$2" "$D/$1.md"; }                          # cntx <slug> <whole line>
lineno() { grep -nF -m1 -- "$2" "$D/$1.md" | cut -d: -f1; }      # lineno <slug> <fixed string>
before() { local a b; a=$(lineno "$1" "$2"); b=$(lineno "$1" "$3"); [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ] && echo y || echo n; }
runblock() {  # runblock <slug> <n>: the Run n block, heading through its end marker
  awk -v n="$2" 'index($0, "### Run " n " (") == 1 {on=1} on {print} on && index($0, "<!-- run " n " end") == 1 {exit}' "$D/$1.md"
}
sha12() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])' "$1"; }

cat > "$D/ro.md" <<'EOF'
---
tags: [task, rollout]
status: open
protocol_version: 3
---

## Notes
EOF
mkt() {  # mkt <slug> [body-tail]: an in_progress task linked to ro; body-tail is appended verbatim
  printf -- '---\ntags: [task]\nstatus: in_progress\nrollout: "[[ro]]"\n---\n\n## Notes\n\nbody %s\n%s' "$1" "${2:-}" > "$D/$1.md"
}
res() {  # res <slug> <status> [field=<json>]...: the one-row workflow result in $D/res.json
  python3 - "$D/res.json" "$@" <<'PY'
import json, sys
out, slug, status, *kv = sys.argv[1:]
row = {"slug": slug, "status": status, "prUrl": "", "reviewRoundsUsed": 1, "planRoundsUsed": 0}
for item in kv:
    k, v = item.split("=", 1)
    row[k] = json.loads(v)
json.dump({"rolloutSlug": "ro", "tasks": [row]}, open(out, "w"))
PY
}
rec() { python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now "$NOW"; }

echo "== two diagnoses accumulate as runs under one heading"
mkt d1
res d1 blocked 'blockerDiagnosis="verifier red: missing fixture"'; rec >/dev/null
res d1 blocked 'blockerDiagnosis="verifier red: import cycle in b.py"'; rec >/dev/null
ok "$(cnt d1 '## Blocker diagnosis')|$(cnt d1 '### Run 1 (')|$(cnt d1 '### Run 2 (')" "1|1|1" "one heading, Run 1 and Run 2"
ok "$(runblock d1 1)" "### Run 1 (2026-10-02T14:05+00:00)

verifier red: missing fixture

<!-- run 1 end sha=$(sha12 'verifier red: missing fixture') -->" "Run 1's exact block format"
ok "$(before d1 'missing fixture' 'import cycle')" y "Run 2 follows Run 1"
c=$(cksum < "$D/d1.md")
out=$(rec)
ok "$(cksum < "$D/d1.md")" "$c" "a same-result re-reconcile changes no byte"
case "$out" in *"[no-change]"*) ok y y "… and reports [no-change]";; *) ok n y "… and reports [no-change]";; esac
res d1 blocked 'blockerDiagnosis=""'; rec >/dev/null
ok "$(cksum < "$D/d1.md")" "$c" "empty feedback writes nothing"

echo "== prefix case: a run that is a prefix of an earlier run is appended"
mkt p1
H1='[{"round":1,"feedback":["add test for parser"]},{"round":2,"feedback":["fix the null guard"]}]'
res p1 review-blocked 'prUrl="https://github.com/o/r/pull/1"' "reviewHistory=$H1"; rec >/dev/null
r1=$(runblock p1 1)
res p1 review-blocked 'prUrl="https://github.com/o/r/pull/1"' 'reviewHistory=[{"round":1,"feedback":["add test for parser"]}]'; rec >/dev/null
ok "$(cnt p1 '### Run 2 (')" 1 "run 2 = run 1's Round 1 block only -> appended"
ok "$(runblock p1 1)" "$r1" "Run 1 is byte-identical"
ok "$(runblock p1 2 | sed -n '3,4p')" "Round 1:
- add test for parser" "Run 2 holds the new content"

echo "== A/B/A appends A again; the latest run decides setAsideAt"
mkt aba
A="integration: conflict in a.py"
res aba blocked "blockerDiagnosis=\"$A\""; rec >/dev/null
res aba blocked 'blockerDiagnosis="verifier red: flaky"'; rec >/dev/null
res aba blocked "blockerDiagnosis=\"$A\""; rec >/dev/null
ok "$(cnt aba '### Run 3 (')|$(runblock aba 3 | sed -n 3p)" "1|$A" "Run 3 equals A"
J=$(python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW")
ok "$(printf '%s' "$J" | python3 -c 'import json,sys; t=[t for t in json.load(sys.stdin)["tasks"] if t["slug"]=="aba"][0]; print(t["setAsideAt"], "|", t["blockerSummary"])')" \
  "integration | $A" "status: setAsideAt integration, blockerSummary is the latest run"
J=$(python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run)
ok "$(printf '%s' "$J" | python3 -c 'import json,sys; print([s["setAsideAt"] for s in json.load(sys.stdin)["setAside"] if s["slug"]=="aba"])')" \
  "['integration']" "next: setAsideAt integration"
res aba blocked 'blockerDiagnosis="verifier red: flaky"'; rec >/dev/null
J=$(python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW")
ok "$(printf '%s' "$J" | python3 -c 'import json,sys; print([t["setAsideAt"] for t in json.load(sys.stdin)["tasks"] if t["slug"]=="aba"][0])')" \
  "run" "status: a later ordinary run reads as set aside at run"

echo "== an agent's same-run copy is adopted in place"
mkt ag1 $'\n## Blocker diagnosis\n\nline one  \nline two\n'
res ag1 blocked 'blockerDiagnosis="line one\nline two"'; rec >/dev/null
ok "$(cnt ag1 '### Run 1 (')|$(cntx ag1 'line one  ')|$(cnt ag1 'line two')|$(cnt ag1 '<!-- run 1 end sha=')" "1|1|1|1" \
  "an equal agent paragraph becomes Run 1, once, bytes unchanged (trailing spaces kept)"
ok "$(before ag1 '### Run 1 (' 'line one')" y "… the heading goes before it"
c=$(cksum < "$D/ag1.md"); rec >/dev/null
ok "$(cksum < "$D/ag1.md")" "$c" "… and a re-reconcile is a no-op"

mkt ag2 $'\n## Blocker diagnosis\n\nagent says X\n'
res ag2 blocked 'blockerDiagnosis="verifier says Y"'; rec >/dev/null
ok "$(cntx ag2 'agent says X')|$(before ag2 'agent says X' '### Run 1 (')|$(before ag2 '### Run 1 (' 'verifier says Y')" "1|y|y" \
  "a differing agent paragraph is kept verbatim and Run 1 follows it"

mkt ag3
res ag3 blocked 'blockerDiagnosis="first diagnosis"'; rec >/dev/null
r1=$(runblock ag3 1)
printf '\nsecond diagnosis, agent copy\n' >> "$D/ag3.md"
res ag3 blocked 'blockerDiagnosis="second diagnosis, agent copy"'; rec >/dev/null
ok "$(cnt ag3 '### Run 2 (')|$(cnt ag3 'second diagnosis, agent copy')|$(before ag3 '### Run 2 (' 'second diagnosis')" "1|1|y" \
  "agent text after Run 1's end marker that equals the new content becomes Run 2"
ok "$(runblock ag3 1)" "$r1" "… and Run 1 is byte-identical"

echo "== review-blocked: two multi-round runs sharing a finding"
mkt rb
res rb review-blocked 'prUrl="https://github.com/o/r/pull/2"' "reviewHistory=$H1"; rec >/dev/null
r1=$(runblock rb 1)
res rb review-blocked 'prUrl="https://github.com/o/r/pull/2"' 'reviewHistory=[{"round":1,"feedback":["add test for parser"]},{"round":2,"feedback":["rename the helper"]}]'; rec >/dev/null
ok "$(runblock rb 1)" "$r1" "Run 1 is byte-identical"
ok "$(cnt rb '- add test for parser')|$(cnt rb '### Run 2 (')|$(cnt rb '- rename the helper')" "2|1|1" "Run 2 carries both rounds"

echo "== legacy reviewFeedback bullets"
mkt lg
res lg review-blocked 'prUrl="https://github.com/o/r/pull/3"' 'reviewFeedback=["bound assertion is a no-op","missed sibling site"]'; rec >/dev/null
ok "$(cnt lg '### Run 1 (')|$(cntx lg '- missed sibling site')" "1|1" "the bullets fallback is Run 1"
c=$(cksum < "$D/lg.md"); rec >/dev/null
ok "$(cksum < "$D/lg.md")|$(cnt lg '### Run 2 (')" "$c|0" "… and its re-run is a no-op"

echo "== legacy and orphan sections"
mkt lp $'\n## Plan-blocked feedback\n\nold plan feedback from v2\n'
res lp plan-blocked 'blockerDiagnosis="plan not approved: new feedback"'; rec >/dev/null
ok "$(cntx lp 'old plan feedback from v2')|$(before lp 'old plan feedback' '### Run 1 (')|$(cnt lp 'new feedback')" "1|y|1" \
  "a legacy section keeps its text; Run 1 is appended"

mkt or $'\n## Blocker diagnosis\n\nimplement escalated: verifier red on opus\n'
res or review 'prUrl="https://github.com/o/r/pull/11"'; rec >/dev/null
ok "$(cnt or '### Run')" 0 "an approval leaves the escalated run's orphan section alone"
res or blocked 'blockerDiagnosis="verifier red: env mismatch"'; rec >/dev/null
ok "$(cntx or 'implement escalated: verifier red on opus')|$(before or 'implement escalated' '### Run 1 (')|$(cnt or 'env mismatch')" "1|y|1" \
  "… a later block puts Run 1 after it"

echo "== ceiling history"
mkt ce
res ce review 'prUrl="https://github.com/o/r/pull/12"' 'approvedAtCeiling=true' 'reviewHistory=[{"round":1,"feedback":["tighten the guard"]}]'
rec >/dev/null; rec >/dev/null
ok "$(cnt ce '## Review history (approved at ceiling)')|$(cnt ce '### Run 1 (')|$(cnt ce '### Run 2 (')" "1|1|0" "a ceiling history reconciled twice is one run"
res ce review 'prUrl="https://github.com/o/r/pull/12"' 'approvedAtCeiling=true' 'reviewHistory=[{"round":1,"feedback":["tighten the guard"]},{"round":2,"feedback":["integration dropped a hunk"]}]'
rec >/dev/null
ok "$(cnt ce '### Run 2 (')" 1 "a second ceiling approval is Run 2"

echo "== a hand-deleted end marker"
mkt hm
res hm blocked 'blockerDiagnosis="first"'; rec >/dev/null
python3 - "$D/hm.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write("\n".join(l for l in t.split("\n") if not l.startswith("<!-- run 1 end")))
PY
c=$(cksum < "$D/hm.md"); rec >/dev/null
ok "$(cksum < "$D/hm.md")" "$c" "the extent hash still sees an equal latest run"
res hm blocked 'blockerDiagnosis="second"'; rec >/dev/null
ok "$(cnt hm '### Run 2 (')|$(cntx hm 'first')|$(cntx hm 'second')" "1|1|1" "a different result appends Run 2"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-runs: ALL PASS"; else echo "reconcile-rollout-runs: FAILED"; fi
exit "$fail"
