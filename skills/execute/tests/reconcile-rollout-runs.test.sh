#!/usr/bin/env bash
# Accumulated feedback (p6-4): reconcile keeps every run's feedback under one heading as numbered runs,
# a re-reconcile of the same result is a no-op (headings or run markers inside the content included), an
# agent's same-run copy is adopted in place, and nothing already written is deleted or rewritten. Also the
# `## Integration log` (p12-16): one line per Integration row, its dedupe and its place in the body. Temp
# notes only.
# Usage: bash reconcile-rollout-runs.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
# An absent parallel_ceiling resolves through rollout-settings.py (~/.config/thread/rollouts.toml, p15-4): every
# call that reaches it runs with HOME=$EH, an empty dir, so only the built-in applies and the operator's file never does.
EH="$D/.settings-home"; mkdir -p "$EH"
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
json() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }   # json <text>: a JSON string

cat > "$D/ro.md" <<'EOF'
---
tags: [task, rollout]
status: open
protocol_version: 5
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
    if v == "DEL":
        row.pop(k, None)      # a key the row omits
    else:
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
J=$(HOME="$EH" python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW")
ok "$(printf '%s' "$J" | python3 -c 'import json,sys; t=[t for t in json.load(sys.stdin)["tasks"] if t["slug"]=="aba"][0]; print(t["setAsideAt"], "|", t["blockerSummary"])')" \
  "integration | $A" "status: setAsideAt integration, blockerSummary is the latest run"
J=$(HOME="$EH" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run)
ok "$(printf '%s' "$J" | python3 -c 'import json,sys; print([s["setAsideAt"] for s in json.load(sys.stdin)["setAside"] if s["slug"]=="aba"])')" \
  "['integration']" "next: setAsideAt integration"
res aba blocked 'blockerDiagnosis="verifier red: flaky"'; rec >/dev/null
J=$(HOME="$EH" python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW")
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

echo "== headings in the content never end the section"
# Implementer diagnoses are free LLM text: a `## ` line in a run would end its section for every reader,
# so the next reconcile would insert Run 2 inside Run 1 and duplicate it.
mkt hd
HD=$'summary line\n\n## Root cause\n\nenv mismatch'
res hd blocked "blockerDiagnosis=$(json "$HD")"; rec >/dev/null
c=$(cksum < "$D/hd.md"); out=$(rec)
ok "$(cksum < "$D/hd.md")" "$c" "a ## line in the content: a same-result re-reconcile changes no byte"
case "$out" in *"[no-change]"*) ok y y "… and reports [no-change]";; *) ok n y "… and reports [no-change]";; esac
ok "$(cnt hd '### Run 2 (')|$(cntx hd '## Root cause')|$(cntx hd '##### Root cause')" "0|0|1" \
  "… one run, its ## heading written three levels down"
ok "$(runblock hd 1 | tail -1)" "<!-- run 1 end sha=$(sha12 "$HD") -->" "… the sha is over the content as given"
res hd blocked 'blockerDiagnosis="second diagnosis"'; rec >/dev/null
ok "$(cnt hd '### Run 2 (')|$(before hd '##### Root cause' '### Run 2 (')|$(before hd '### Run 2 (' 'second diagnosis')" "1|y|y" \
  "… and a later run follows the whole of Run 1"

mkt qr
QR=$'retrying after\n# Earlier attempt\n### Run 1 (2026-10-01T09:00+00:00)\n<!-- run 1 end sha=0123456789ab -->\nstill red'
res qr blocked "blockerDiagnosis=$(json "$QR")"; rec >/dev/null
c=$(cksum < "$D/qr.md"); rec >/dev/null
ok "$(cksum < "$D/qr.md")" "$c" "a quoted run heading and end marker: a re-reconcile changes no byte"
ok "$(grep -c '^### Run' "$D/qr.md")|$(grep -c '^<!-- run' "$D/qr.md")|$(cntx qr '#### Earlier attempt')" "1|1|1" \
  "… one run heading, one end marker, an H1 pushed down to H4"

mkt ah $'\n## Blocker diagnosis\n\n# Verifier\nred on main\n'
res ah blocked "blockerDiagnosis=$(json $'# Verifier\nred on main')"; rec >/dev/null
ok "$(cntx ah '# Verifier')|$(cntx ah '#### Verifier')|$(before ah '# Verifier' '### Run 1 (')" "1|1|y" \
  "an equal agent copy holding a heading is kept and Run 1 appended, never adopted with the heading"
c=$(cksum < "$D/ah.md"); rec >/dev/null
ok "$(cksum < "$D/ah.md")" "$c" "… and a re-reconcile is a no-op"

mkt gp
res gp gate-pending "blockerDiagnosis=$(json "$HD")"; rec >/dev/null
c=$(cksum < "$D/gp.md"); rec >/dev/null
ok "$(cksum < "$D/gp.md")" "$c" "gate-pending: a ## line in the fallback diagnosis, re-upserted, changes no byte"
ok "$(cntx gp '## Gated inputs (awaiting sign-off)')|$(cnt gp 'env mismatch')" "1|1" "… one section, the content once"

echo "== the Integration log (p12-16)"
# One line per Integration call, from the row's `integration` field: 10 space-separated tokens, `-` for
# a missing value. A line with a startedAt is skipped when it appears anywhere in the section; a `-` line
# only when it equals the section's last line.
A40=$(printf 'a%.0s' {1..40}); C40=$(printf 'c%.0s' {1..40}); D40=$(printf 'd%.0s' {1..40}); X40=$(printf 'e%.0s' {1..40})
T1=2026-10-02T13:30+00:00; T2=2026-10-02T15:00+00:00; T3=2026-10-02T16:30+00:00
PR7='prUrl="https://github.com/o/r/pull/7"'
integ() {  # integ [path=<json>|path=DEL]...: an integration object (default: integrated at $T1) as JSON
  python3 - "$A40" "$C40" "$D40" "$T1" "$@" <<'PY2'
import json, sys
a, c, d, t1, *kv = sys.argv[1:]
I = {"outcome": "integrated", "path": "integrator", "anchor": {"headSha": a, "taskBase": "b" * 40},
     "headSha": d, "baseSha": c, "mergeCommit": d, "triggers": ["conflict"], "reReviewed": True,
     "feedback": [], "reason": "", "agents": [],
     "metrics": {"readyAt": "2026-10-02T13:00+00:00", "startedAt": t1, "finishedAt": "2026-10-02T13:45:00Z",
                 "waitMinutes": 30, "durationMinutes": 15}}
for item in kv:
    k, v = item.split("=", 1)
    *parents, leaf = k.split(".")
    node = I
    for p in parents:
        node = node[p]
    if v == "DEL":
        node.pop(leaf, None)
    else:
        node[leaf] = json.loads(v)
print(json.dumps(I))
PY2
}
SA=(outcome='"set-aside"' headSha='""' baseSha='""' mergeCommit='""' triggers='[]' metrics.durationMinutes=null)
logsec() { awk '$0=="## Integration log"{on=1; next} on && /^## /{exit} on && NF {print}' "$D/$1.md"; }   # the section's non-blank lines
nlog() { logsec "$1" | grep -c .; }

mkt il1
res il1 review "$PR7" "integration=$(integ)"; rec >/dev/null
ok "$(nlog il1)|$(cntx il1 "$T1 integrated path=integrator pr=7 anchor=$A40 head=$D40 base=$C40 wait=30 duration=15 triggers=conflict")" "1|1" \
  "integrated: one line, every field"
mkt il2
res il2 blocked "$PR7" "integration=$(integ outcome='"rejected"')"; rec >/dev/null
ok "$(nlog il2)|$(cntx il2 "$T1 rejected path=integrator pr=7 anchor=$A40 head=$D40 base=$C40 wait=30 duration=15 triggers=conflict")" "1|1" \
  "rejected: one line, every field"
mkt il3
res il3 blocked "$PR7" "integration=$(integ "${SA[@]}" metrics.waitMinutes=null)"; rec >/dev/null
ok "$(nlog il3)|$(cntx il3 "$T1 set-aside path=integrator pr=7 anchor=$A40 head=- base=- wait=- duration=- triggers=-")" "1|1" \
  "set-aside before the merge: empty head/base, null minutes and no triggers write -"
ok "$(before il3 '## Notes' '## Integration log')" y "… the section is appended to the body"

mkt il4
res il4 review 'prUrl="#7"' "integration=$(integ metrics.waitMinutes=0 metrics.durationMinutes=0 triggers='["shared-file","committed"]' metrics.startedAt=DEL)"; rec >/dev/null
ok "$(logsec il4)" "- integrated path=integrator pr=7 anchor=$A40 head=$D40 base=$C40 wait=0 duration=0 triggers=shared-file,committed" \
  "zero minutes write 0, triggers keep their order, a missing startedAt leads with -, prUrl #7 is pr=7"
mkt il5
res il5 review 'prUrl="7"' "integration=$(integ metrics.waitMinutes=true metrics.durationMinutes='"15"')"; rec >/dev/null
ok "$(logsec il5)" "$T1 integrated path=integrator pr=7 anchor=$A40 head=$D40 base=$C40 wait=- duration=- triggers=conflict" \
  "prUrl 7 is pr=7; a bool or string metric writes -"
for v in '"not-a-pr"' '""' DEL; do
  mkt il6
  res il6 review "prUrl=$v" "integration=$(integ)"; rec >/dev/null
  ok "$(logsec il6 | cut -d' ' -f4)" "pr=-" "prUrl $v writes pr=-"
done
mkt il7
res il7 review "$PR7" "integration=$(integ path='"judge only"' triggers='["a b","c\td"]' metrics.startedAt='"## evil\nx"')"; rec >/dev/null
ok "$(logsec il7)" "- integrated path=judge_only pr=7 anchor=$A40 head=$D40 base=$C40 wait=30 duration=15 triggers=a_b,c_d" \
  "whitespace inside a value becomes _; a startedAt that is not an ISO stamp writes -"
ok "$(logsec il7 | awk '{print NF}')|$(cnt il7 'evil')" "10|0" "… so the line has 10 tokens and the bad startedAt is dropped"

# startedAt is the one token with no `key=` prefix, so it alone decides how the line starts: only the
# engine's ISO_STAMP shape is written, anything else is `-`, so the line can never open a section, an H1,
# a code fence or a quote (and a second row still lands as the section's last line).
hd() { grep -cE '^(#|```|~~~|>)' "$D/$1.md"; }   # lines that open a heading, fence or quote
for v in '"##"' '"#"' '"```"' '">"' '"~~~"' '"2026-10-02"' '"2026-10-02T13:30"' '"x2026-10-02T13:30+00:00"'; do
  mkt il9
  h0=$(hd il9)
  res il9 review "$PR7" "integration=$(integ metrics.startedAt=$v)"; rec >/dev/null
  ok "$(nlog il9)|$(logsec il9 | awk '{print NF}')|$(logsec il9 | cut -d' ' -f1)|$(hd il9)" "1|10|-|$((h0 + 1))" \
    "startedAt $v: one 10-token line led by -, no heading but the log's own"
  res il9 blocked "$PR7" "integration=$(integ outcome='"rejected"' metrics.startedAt="\"$T2\"")"; rec >/dev/null
  ok "$(nlog il9)|$(logsec il9 | tail -1 | cut -d' ' -f1,2)|$(hd il9)" "2|$T2 rejected|$((h0 + 1))" \
    "… a second row still lands as the section's last line"
done
for v in 2026-10-02T13:30:00Z 2026-10-02T13:30:00.250+1000 2026-10-02T13:30-0230; do
  mkt il10
  res il10 review "$PR7" "integration=$(integ metrics.startedAt="\" $v \"")"; rec >/dev/null
  ok "$(logsec il10 | cut -d' ' -f1)" "$v" "startedAt $v (ISO_STAMP's other forms) is written, trimmed"
done

mkt il8
res il8 review "$PR7" "integration=$(integ)"; rec >/dev/null
res il8 blocked "$PR7" "integration=$(integ outcome='"rejected"' metrics.startedAt="\"$T2\"")"; rec >/dev/null
res il8 blocked "$PR7" "integration=$(integ "${SA[@]}" metrics.startedAt="\"$T3\"")"; rec >/dev/null
ok "$(cnt il8 '## Integration log')|$(nlog il8)|$(logsec il8 | cut -d' ' -f1,2 | tr '\n' ';')" \
  "1|3|$T1 integrated;$T2 rejected;$T3 set-aside;" "three rows: three lines, in order, under one heading"

mkt d1
res d1 blocked "$PR7" "integration=$(integ outcome='"rejected"')"; rec >/dev/null
cp "$D/d1.md" "$D/d1.before"
python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now 2026-10-03T09:00:00Z >/dev/null
cmp -s "$D/d1.md" "$D/d1.before"; ok "$?" 0 "D1: the same row re-reconciled at another --now is byte-identical"

mkt d2
res d2 blocked "$PR7" "integration=$(integ outcome='"rejected"')"; rec >/dev/null
RA=$(cat "$D/res.json")
res d2 blocked "$PR7" "integration=$(integ "${SA[@]}" metrics.startedAt="\"$T2\"")"; rec >/dev/null
cp "$D/d2.md" "$D/d2.before"
printf '%s' "$RA" > "$D/res.json"; rec >/dev/null
cmp -s "$D/d2.md" "$D/d2.before"; ok "$?" 0 "D2: an older row replayed after a newer one is byte-identical"
ok "$(nlog d2)|$(logsec d2 | tail -1 | cut -d' ' -f1,2)" "2|$T2 set-aside" "… two lines, the newer one last"

NOSTART=(metrics.startedAt=DEL metrics.waitMinutes=null metrics.durationMinutes=null)   # today's default: no startedAt
S=$(integ "${SA[@]}" "${NOSTART[@]}")
mkt d3
res d3 blocked "$PR7" "integration=$S"; rec >/dev/null
res d3 review "$PR7" "integration=$(integ "${NOSTART[@]}" headSha="\"$X40\"")"; rec >/dev/null
res d3 blocked "$PR7" "integration=$S"; rec >/dev/null
ok "$(nlog d3)|$(logsec d3 | sed -n 2p | cut -d' ' -f1,2)|$(logsec d3 | tail -1 | cut -d' ' -f1,2)" "3|- integrated|- set-aside" \
  "D3: S, I, S' with no startedAt: three lines, the latest truthful"
cp "$D/d3.md" "$D/d3.before"; rec >/dev/null
cmp -s "$D/d3.md" "$D/d3.before"; ok "$?" 0 "… and S' re-reconciled is byte-identical"

mkt d4
res d4 blocked "$PR7" "integration=$S"; rec >/dev/null
res d4 blocked "$PR7" 'reviewRoundsUsed=2' "integration=$S"; rec >/dev/null
ok "$(nlog d4)" 1 "D4: back-to-back identical - lines collapse to one (the interim trade-off)"

mkt d5
for ts in "$T1" "$T2" "$T1"; do
  res d5 blocked "$PR7" "integration=$(integ "${SA[@]}" metrics.startedAt="\"$ts\"")"; rec >/dev/null
done
ok "$(nlog d5)|$(logsec d5 | cut -d' ' -f1 | tr '\n' ';')" "2|$T1;$T2;" \
  "D5: lines differing only by startedAt are kept; a non-adjacent repeat is skipped"

mkt ls $'\n## Integration log\n\nhand-written note\n\n## Blocker diagnosis\n\nold diagnosis\n'
res ls review "$PR7" "integration=$(integ "${NOSTART[@]}")"; rec >/dev/null
res ls blocked "$PR7" 'blockerDiagnosis="integration: conflict in a.py"' "integration=$S"; rec >/dev/null
ok "$(logsec ls | cut -d' ' -f1,2 | tr '\n' ';')" "hand-written note;- integrated;- set-aside;" \
  "a mid-body section keeps hand-written text and appends after it"
ok "$(awk '/^## Blocker diagnosis$/{print prev2 "|" prev; exit} {prev2=prev; prev=$0}' "$D/ls.md" | cut -c1-14)" "- set-aside pa" \
  "… one blank line before the next section"
ok "$(awk '/^## Blocker diagnosis$/{print prev; exit} {prev=$0}' "$D/ls.md")|$(before ls '## Blocker diagnosis' '### Run 1 (')|$(before ls 'old diagnosis' '### Run 1 (')" \
  "|y|y" "… and the next run still lands in its own section"
c=$(cksum < "$D/ls.md"); rec >/dev/null
ok "$(cksum < "$D/ls.md")" "$c" "… a re-reconcile is a no-op"

mkt le $'\n## Integration log\n\nhand-written last line\n'
res le blocked "$PR7" "integration=$S"; rec >/dev/null
ok "$(logsec le | cut -d' ' -f1,2 | tr '\n' ';')|$(tail -c1 "$D/le.md" | od -An -c | tr -d ' ')" "hand-written last;- set-aside;|\\n" \
  "a section at EOF: the line is appended, the file still ends in a newline"

mkt ln
res ln review "$PR7"; rec >/dev/null
res ln review "$PR7" 'integration=null'; rec >/dev/null
ok "$(cnt ln '## Integration log')" 0 "a row with no integration, or integration null, writes no log"
mkt lx
res lx review "$PR7" 'integration="x"'
python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now "$NOW" >/dev/null 2>"$D/err"; rc=$?
ok "$rc|$(grep -c 'lx' "$D/err")|$(cnt lx '## Integration log')|$(cnt lx 'status: review')" "1|1|0|1" \
  "integration not an object: exit 1 naming the slug, no log, the rest of the row written"
mkt ld
res ld review "$PR7" "integration=$(integ)"
c=$(cksum < "$D/ld.md")
python3 "$SCRIPT" reconcile --result "$D/res.json" --tasks-dir "$D" --now "$NOW" --dry-run >/dev/null
ok "$(cksum < "$D/ld.md")" "$c" "--dry-run writes no log"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-runs: ALL PASS"; else echo "reconcile-rollout-runs: FAILED"; fi
exit "$fail"
