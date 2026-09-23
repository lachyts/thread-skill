#!/usr/bin/env bash
# Pins the protocol 3 behaviour that makes repair § 3c necessary, and the status/repair guidance built on
# it (E2E 2026-09-23 verbs 6 + 7):
#   (a) a task at in_progress/open whose PR already merged has no sanctioned path to done — `resolve`
#       and `mark-done` refuse it, while `resume-filter` would re-dispatch it;
#   (c) in the race window (task in_progress + owner, wave not yet stamped dispatched) the status JSON
#       carries the wave with dispatched/merged null and no `owner` key — status must grep the note;
#   (b) status renders an in-flight wave and routes stranded merges to repair, and repair stops and
#       escalates a stranded merge instead of handing it to execute's resume.
# When protocol 4 lets resolve accept a verified-merged in_progress task this fails — lift the interim
# guard and update this test. (Likewise if protocol 4 adds `owner` to the status JSON: part (c) fails on
# purpose, and status can read the owner from there instead.)
set -uo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
SCRIPT=skills/execute/scripts/reconcile-wave.py
STATUS=skills/status/SKILL.md
REPAIR=skills/repair/SKILL.md
fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok n y "$3";; esac; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
statusline() { grep -m1 '^status:' "$tmp/$1.md"; }

# ── (a) characterisation pins: the engine has no path from in_progress/open + MERGED to done ──
echo "== (a) engine pins"
cat > "$tmp/sm-prog.md" <<EOF
---
tags: [task, Demo]
status: in_progress
owner: execute-test
pr: 2
---

body sm-prog
EOF
cat > "$tmp/sm-open.md" <<EOF
---
tags: [task, Demo]
status: open
---

body sm-open
EOF

for s in sm-prog sm-open; do
  before=$(statusline "$s")
  err=$(python3 "$SCRIPT" resolve --tasks "$s" --tasks-dir "$tmp" 2>&1 >/dev/null); rc=$?
  ok "$([ "$rc" -ne 0 ] && echo nz || echo 0)" nz "resolve refuses $s (non-zero exit)"
  has "$err" "refusing to resolve" "resolve names the refusal for $s"
  ok "$(statusline "$s")" "$before" "resolve leaves $s's status line unchanged"
done

before=$(statusline sm-prog)
python3 "$SCRIPT" mark-done --tasks sm-prog --tasks-dir "$tmp" >/dev/null 2>&1; rc=$?
ok "$([ "$rc" -ne 0 ] && echo nz || echo 0)" nz "mark-done refuses an in_progress task"
ok "$(statusline sm-prog)" "$before" "mark-done leaves sm-prog's status line unchanged"

out=$(python3 "$SCRIPT" resume-filter --tasks sm-prog,sm-open --tasks-dir "$tmp" 2>/dev/null)
has "$out" "sm-prog" "resume-filter would re-dispatch the in_progress task"
has "$out" "sm-open" "resume-filter would re-dispatch the open task"

# ── (c) race-window pin: the data status's hedged in-flight signal relies on ──
echo "== (c) race-window status JSON"
cat > "$tmp/ro.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 3
merged_through_wave: 1
wave_1_dispatched: 2026-09-23T10:00:00+10:00
wave_1_merged: 2026-09-23T10:30:00+10:00
---

## Notes
EOF
cat > "$tmp/rw1.md" <<EOF
---
tags: [task, Demo]
status: done
wave: 1
rollout: "[[ro]]"
---

body rw1
EOF
cat > "$tmp/rw2.md" <<EOF
---
tags: [task, Demo]
status: in_progress
owner: execute-test
wave: 2
rollout: "[[ro]]"
---

body rw2
EOF
json=$(python3 "$SCRIPT" status --rollout "$tmp/ro.md" --tasks-dir "$tmp")
res=$(printf '%s' "$json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
tl = d.get("timeline") or {}
w2 = [w for w in tl.get("waves", []) if w.get("wave") == 2]
print("w2=" + ("null-null" if w2 and w2[0].get("dispatched") is None and w2[0].get("merged") is None else "other"))
t = [x for x in d["tasks"] if x["slug"] == "rw2"]
print("rw2=" + (t[0]["status"] if t else "missing"))
print("owner=" + ("absent" if all("owner" not in x for x in d["tasks"]) else "present"))
')
has "$res" "w2=null-null" "timeline has a wave-2 entry with dispatched and merged null"
has "$res" "rw2=in_progress" "the race-window task reports in_progress"
has "$res" "owner=absent" "no task entry carries an owner key (status must grep the note)"

# ── (b) text assertions on the skills ──
echo "== (b) skill text"
region() {  # region <file> <start-regex> <end-regex>: lines from start up to (not incl.) end
  awk -v s="$2" -v e="$3" '$0 ~ s {on=1; print; next} on && $0 ~ e {exit} on {print}' "$1"
}
yn() { if [ "$1" -eq 0 ]; then echo y; else echo n; fi; }

r2=$(region "$REPAIR" '^### 2\.' '^### 3\.')
printf '%s\n' "$r2" | grep '^|' | grep 'in_progress' | grep 'MERGED' | grep -qi 'stop'
ok "$(yn $?)" y "repair § 2: a table row classifies in_progress + MERGED with a STOP"
r1=$(region "$REPAIR" '^### 1\.' '^### 2\.')
has "$r1" "/workflows" "repair § 1 mentions /workflows"
has "$r1" "owner" "repair § 1 names the owner session"
printf '%s\n' "$r1" | grep -i 'stranded' | grep -q '3c'
ok "$(yn $?)" y "repair § 1: a stranded-merged task is escalated (3c)"
printf '%s\n' "$r1" | grep '^- `paused:` stamp' -A3 | tr '\n' ' ' | grep -q 'stranded.*escalate'
ok "$(yn $?)" y "repair § 1: the paused bullet escalates a stranded merge instead of pointing at reinstate"
has "$r1" "points at neither reinstate nor resume" "repair § 1: no reinstate or resume while a stranded merge remains"
r3=$(region "$REPAIR" '^### 3\.' '^### 4\.')
has "$r3" "merge-base --is-ancestor" "repair § 3c: checks the merge commit is on the default branch"
has "$r3" "log -p" "repair § 3c: shows the vault note's git history as evidence"
has "$r3" "never writes that task's status" "repair § 3c: never writes the stranded task's status"
has "$r3" "## Notes" "repair § 3c: records the escalation in the rollout note's ## Notes"
r4=$(region "$REPAIR" '^### 4\.' '^### 5\.')
has "$r4" "stranded" "repair § 4 is gated on stranded merges"
r6=$(region "$REPAIR" "^### 6\\." "^## Don'ts")
has "$r6" "stranded" "repair § 6 is gated on stranded merges"
printf '%s\n' "$r6" | grep -q 'escalat'
ok "$(yn $?)" y "repair § 6 logs escalations"
has "$r6" "## Notes" "repair § 6 copies escalations from the 3c ## Notes records"
grep -q 'protocol 4' "$REPAIR"
ok "$(yn $?)" y "repair names the protocol 4 fix that lifts the guard"

s3=$(region "$STATUS" '^### 3\.' '^### 4\.')
printf '%s\n' "$s3" | grep 'in_progress' | grep -q 'MERGED'
ok "$(yn $?)" y "status § 3 flags in_progress + MERGED"
grep -q 'possibly in flight' "$STATUS"
ok "$(yn $?)" y "status names the hedged 'possibly in flight' state"

# The recommended-action list: items start with "- ", continuations with two spaces; first blank line
# after an item ends it. Emit one item per line (continuations joined).
items=$(awk '
  /Then \*\*one\*\* recommended next action/ {on=1; next}
  !on {next}
  /^- / {if (cur != "") print cur; cur=$0; n++; next}
  /^  / && cur != "" {cur = cur " " $0; next}
  /^[[:space:]]*$/ {if (n > 0) {print cur; cur=""; exit} next}
  {if (cur != "") {print cur; cur=""}; exit}
  END {if (cur != "") print cur}
' "$STATUS")
idx() { printf '%s\n' "$items" | grep -n -m1 -- "$1" | cut -d: -f1; }
P=$(idx '^- `paused`'); F=$(idx 'in flight'); S=$(idx '^- any stranded'); C=$(idx 'cursor behind')
echo "     (list indexes: paused=$P in-flight=$F stranded=$S cursor-behind=$C)"
if [ -n "$P" ] && [ -n "$F" ] && [ -n "$S" ] && [ -n "$C" ] && [ "$P" -lt "$F" ] && [ "$F" -lt "$S" ] && [ "$S" -lt "$C" ]; then
  ok y y "status list order: paused < in flight < stranded < cursor behind"
else
  ok n y "status list order: paused < in flight < stranded < cursor behind"
fi
itemP=$( [ -n "$P" ] && printf '%s\n' "$items" | sed -n "${P}p")
itemF=$( [ -n "$F" ] && printf '%s\n' "$items" | sed -n "${F}p")
itemS=$( [ -n "$S" ] && printf '%s\n' "$items" | sed -n "${S}p")
has "$itemF" "owner" "the in-flight item names the owner session"
has "$itemF" "/workflows" "the in-flight item points at /workflows"
has "$itemS" "/thread:repair" "the stranded item routes to /thread:repair"
# Precedence: the earlier paused and in-flight items must not send a stranded merge to execute.
printf '%s\n' "$itemP" | grep -q 'stranded merge.*/thread:repair'
ok "$(yn $?)" y "the paused item routes a stranded merge to /thread:repair, not reinstate"
printf '%s\n' "$itemF" | grep -q 'stranded merge.*/thread:repair'
ok "$(yn $?)" y "the in-flight item's no-run branch routes a stranded merge to /thread:repair"
has "$itemF" "offline" "the in-flight item carries the offline caveat"
prec=$(awk '/^The list is first-match/ {on=1} on && /^[[:space:]]*$/ {exit} on {print}' "$STATUS" | tr '\n' ' ')
has "$prec" "stranded merge" "the first-match note carries the stranded-merge precedence rule"
has "$prec" "/thread:repair" "the precedence rule routes to /thread:repair"
s4=$(region "$STATUS" '^### 4\.' '^## Loopable')
has "$s4" "In continuous mode" "the owner-session qualifier scopes the heartbeat to continuous mode"
printf '%s\n' "$s4" | grep -q 'never needs to'
ok "$(yn $?)" n "the owner-session qualifier no longer says another session never needs to resume"
printf '%s\n' "$s4" | grep -q '<tasks-dir>'
ok "$(yn $?)" n "status § 4 uses no undefined <tasks-dir>"
printf '%s\n' "$s4" | grep -q 'stranded merge; /thread:repair escalates'
ok "$(yn $?)" y "the example Drift block carries a stranded-merge sample line"

echo
if [ "$fail" -eq 0 ]; then echo "repair-stranded-merged: ALL PASS"; else echo "repair-stranded-merged: FAILED"; fi
exit "$fail"
