#!/usr/bin/env bash
# p15-2: every Slot and Integration-lane transition of a rollout lands in its Run record as it happens
# (ADR 0032). A fixture rollout `ro` (parallel_ceiling 2, the three round caps stamped) is driven through
# start -> reconcile -> integrate -> merge, a set-aside, a live ceiling edit, merge and race holds, a Lost-call
# resume, the integrate-call path, a hand-back, a signed gate, a quota stall, a read-only approval, `resume`,
# `defer` and the halts; side rollouts cover the pauses, a carry and the idle-slots reasons. Each leg asserts
# the `kind:task` sequence it appended and the key fields; the last legs check that --dry-run records nothing
# (each verb then runs without it and must record), that an unwritable events dir changes no verb's exit, stdout or non-record stderr, and run the pairing
# checker (run_record.py's reader rules) over the whole record. Temp dirs only.
#
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR and ignores THREAD_TEST_EVENTS_DIR (the
# knob tests/run.sh honours to run every other suite against an unwritable events dir).
# Usage: bash reconcile-rollout-record.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
# Calls that reach rollout-settings.py read ~/.config/thread/rollouts.toml: HOME is an empty dir (p15-4's rule).
export HOME="$TMP/home"; mkdir -p "$HOME"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR
EV="$TMP/events"
export THREAD_EVENTS_DIR="$EV"   # the Run record (run_record.py, ADR 0032) stays in temp
V="$TMP/vault"; J="$TMP/journals"
mkdir -p "$V" "$J" "$EV"
NOW=2026-10-05T10:00:00Z
PR=https://github.com/o/r/pull
A40=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; B40=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; C40=cccccccccccccccccccccccccccccccccccccccc

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok "$1" "*$2*" "$3";; esac; }

# mkro <stem> [frontmatter lines...] — a rollout note in $V
mkro() {
  local s=$1; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n' "$TMP/no-repo"; } > "$V/$s.md"
}
# mkt <slug> <rollout> <status> [frontmatter lines...] — a task note in $V
mkt() {
  local s=$1 ro=$2 st=$3; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\n' "$st"
    [ "$ro" = "-" ] || printf 'rollout: "[[%s]]"\n' "$ro"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody of %s\n' "$s"; } > "$V/$s.md"
  [ "$ro" = "-" ] || printf -- '- [[%s]]\n' "$s" >> "$V/$ro.md"
}
# section <rollout> <text>: insert a body section above `## Queue` (mkt appends queue lines at the end)
section() {
  python3 - "$V/$1.md" "$2" <<'PY'
import sys
p, text = sys.argv[1:]
t = open(p).read()
open(p, "w").write(t.replace("## Queue\n", text.rstrip("\n") + "\n\n## Queue\n", 1))
PY
}
fm() { grep -m1 "^$2:" "$V/$1.md" || echo "<none>"; }
setfm() {  # setfm <note> <key> <value>: replace or add a frontmatter line
  python3 - "$V/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
head, body = t.split("\n---\n", 1)
lines = head.split("\n")
pat = re.compile(r"^%s:" % re.escape(k))
idx = [i for i, l in enumerate(lines) if pat.match(l)]
if idx:
    lines[idx[0]] = "%s: %s" % (k, v)
else:
    lines.append("%s: %s" % (k, v))
open(p, "w").write("\n".join(lines) + "\n---\n" + body)
PY
}
rrs() { python3 "$SCRIPT" "$@"; }
recf() { echo "$EV/$1.jsonl"; }
cnt() { if [ -f "$(recf "$1")" ]; then wc -l < "$(recf "$1")" | tr -d ' '; else echo 0; fi; }
# since <rollout> <n> [py expr over d]: the events appended after line n, one `kind:task` (or the expr) each
since() {
  python3 - "$(recf "$1")" "$2" "${3:-}" <<'PY'
import json, sys
path, n, expr = sys.argv[1], int(sys.argv[2]), sys.argv[3]
try:
    lines = open(path).read().splitlines()
except FileNotFoundError:
    lines = []
out = []
for raw in lines[n:]:
    d = json.loads(raw)
    out.append(json.dumps(eval(expr), separators=(",", ":"), sort_keys=True) if expr else "%s:%s" % (d["kind"], d["task"] or "-"))
print(" ".join(out))
PY
}
# row <file>: reconcile a result JSON file
row() { rrs reconcile --result "$1" --tasks-dir "$V" --now "${2:-$NOW}"; }
# lead <slug> <kind> <reason>: the lead's own set-aside row, reconciled
lead() { printf '%s' "$3" | python3 "$LI" set-aside --note "$V/$1.md" --kind "$2" | rrs reconcile --result - --tasks-dir "$V" --now "$NOW"; }
irow() {  # irow <slug> <status> <outcome> <path> <triggers json> <startedAt> [diag]: an integrate-call row file
  python3 - "$TMP/row-$1.json" "$@" <<'PY'
import json, sys
out, slug, status, outcome, path, triggers, started = sys.argv[1:8]
diag = sys.argv[8] if len(sys.argv) > 8 else ""
row = {"slug": slug, "status": status, "prUrl": "https://github.com/o/r/pull/7", "reviewRoundsUsed": 1, "rung": "",
       "blockerDiagnosis": diag,
       "integration": {"outcome": outcome, "path": path, "anchor": {"headSha": "a" * 40}, "headSha": "b" * 40,
                       "baseSha": "c" * 40, "triggers": json.loads(triggers),
                       "metrics": {"startedAt": started, "waitMinutes": 3, "durationMinutes": 2}}}
json.dump({"rolloutSlug": "ro", "tasks": [row]}, open(out, "w"))
PY
  echo "$TMP/row-$1.json"
}
trow() {  # trow <slug> <json fields>: a task-call row file
  python3 -c 'import json, sys; d = {"slug": sys.argv[2], "rung": ""}; d.update(json.loads(sys.argv[3])); json.dump({"rolloutSlug": "ro", "tasks": [d]}, open(sys.argv[1], "w"))' \
    "$TMP/trow-$1.json" "$1" "$2"
  echo "$TMP/trow-$1.json"
}

mkro ro "parallel_ceiling: 2" "max_review_rounds: 4" "max_iterations: 3" "max_plan_rounds: 3"

echo "== 1. next starts a and b; mark-started records slot-taken; bind-run records run-bound"
mkt a ro open; mkt b ro open
out=$(rrs next --rollout "$V/ro.md" --tasks-dir "$V" --running "" --now "$NOW" 2>&1)
ok "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["start"])')" "['a', 'b']" "next starts a and b"
ok "$(cnt ro)" 0 "next records nothing with no free slot"
setfm a status in_progress; setfm b status in_progress
M=$(cnt ro)
rrs mark-started --tasks a,b --rollout "$V/ro.md" --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since ro "$M")" "slot-taken:a slot-taken:b" "two slot-taken"
ok "$(since ro "$M" 'd["settings"]')" \
  '{"max_iterations":3,"max_plan_rounds":3,"max_review_rounds":4,"parallel_ceiling":2} {"max_iterations":3,"max_plan_rounds":3,"max_review_rounds":4,"parallel_ceiling":2}' \
  "settings: the ceiling and the three caps"
ok "$(since ro "$M" 'd["start"]')" '"start" "start"' "start=start"
ok "$(since ro "$M" 'd["ts"]')" '"2026-10-05T10:00:00.000Z" "2026-10-05T10:00:00.000Z"' "ts is --now"
M=$(cnt ro)
ok "$(rrs bind-run --tasks a --run-id wf_a1 --call task --journal-dir "$J" --tasks-dir "$V" --now "$NOW" >/dev/null; echo $?)" 0 "bind-run exits 0"
ok "$(since ro "$M")" "run-bound:a" "run-bound"
ok "$(since ro "$M" '[d["runId"], d["journalDir"], d["call"], "resumedFrom" in d]')" "[\"wf_a1\",\"$J\",\"task\",false]" "run-bound fields"

echo "== 2. reconcile a (review + PR) -> slot-freed(ready), ready(pr)"
M=$(cnt ro)
ra='{"status":"review","prUrl":"'"$PR/1"'","reviewRoundsUsed":1}'   # bash 3.2: no escaped quotes inside "$(...)"
row "$(trow a "$ra")" 2026-10-05T10:05:00Z >/dev/null
ok "$(since ro "$M")" "slot-freed:a ready:a" "slot-freed, ready"
ok "$(since ro "$M" '[d.get("outcome"), d.get("pr")]')" "[\"ready\",null] [null,\"$PR/1\"]" "outcome ready, pr"
M=$(cnt ro)
row "$TMP/trow-a.json" 2026-10-05T10:06:00Z >/dev/null
ok "$(since ro "$M")" "" "a re-reconcile records nothing"

echo "== 3. the lead's clean path: lane-taken, a merge hold, mark-done -> lane-freed(merge), merged"
M=$(cnt ro)
rrs mark-integrating --tasks a --tasks-dir "$V" --now 2026-10-05T10:10:00Z >/dev/null
rrs log-integration --tasks a --started 2026-10-05T10:10+00:00 --anchor $A40 --head $B40 --base $C40 --tasks-dir "$V" --now 2026-10-05T10:15:00Z >/dev/null
o1=$(rrs hold --tasks a --hold merge --state start --tasks-dir "$V"); o2=$(rrs hold --tasks a --hold merge --state start --tasks-dir "$V")
ok "$o1|$o2" "a: hold-started merge [written]|a: hold-started merge [no-change]" "a second start is skipped"
rrs hold --tasks a --hold merge --state end --tasks-dir "$V" >/dev/null
ok "$(rrs hold --tasks a --hold merge --state end --tasks-dir "$V")" "a: hold-ended merge [no-change]" "an end with no open hold is skipped"
rrs mark-done --tasks a --tasks-dir "$V" --now 2026-10-05T10:20:00Z >/dev/null
ok "$(since ro "$M")" "lane-taken:a hold-started:a hold-ended:a lane-freed:a merged:a" "lane, hold, merge"
ok "$(since ro "$((M+3))" '[d.get("release"), d.get("path"), d.get("triggers"), d.get("conflict"), d.get("pr")]')" \
  "[\"merge\",\"lead\",[],false,null] [null,null,null,null,\"$PR/1\"]" "lane-freed(merge, path lead, triggers [], conflict false), merged pr"
M=$(cnt ro)
rrs mark-done --tasks a --tasks-dir "$V" >/dev/null
ok "$(since ro "$M")" "" "a repeated mark-done records nothing"

echo "== 4. reconcile b blocked -> slot-freed(set-aside), set-aside(implement, blocked, run)"
M=$(cnt ro)
row "$(trow b '{"status":"blocked","blockerDiagnosis":"the tests fail on X"}')" >/dev/null
ok "$(since ro "$M")" "slot-freed:b set-aside:b" "slot-freed, set-aside"
ok "$(since ro "$M" '[d.get("outcome"), d.get("stage"), d.get("reasonClass"), d.get("setAsideAt")]')" \
  '["set-aside",null,null,null] [null,"implement","blocked","run"]' "set-aside fields"

echo "== 5. a live ceiling edit 2 -> 3: slot-taken and idle-slots carry it"
setfm ro parallel_ceiling 3
mkt c ro in_progress
M=$(cnt ro)
rrs mark-started --tasks c --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since ro "$M" 'd["settings"]["parallel_ceiling"]')" "3" "slot-taken reads ceiling 3"
M=$(cnt ro)
rrs next --rollout "$V/ro.md" --tasks-dir "$V" --running c --now "$NOW" >/dev/null
ok "$(since ro "$M")" "idle-slots:-" "next records idle-slots"
ok "$(since ro "$M" '[d["reason"], d["free"], d["settings"]["parallel_ceiling"]]')" '["awaiting-hand-back",2,3]' "awaiting-hand-back, 2 free, ceiling 3"

echo "== 6. a Lost-call resume, then a dead call"
mkt d ro in_progress
rrs mark-started --tasks d --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
rrs bind-run --tasks d --run-id wf_d1 --call task --journal-dir "$J" --tasks-dir "$V" >/dev/null
rrs bind-run --tasks d --run-id wf_d2 --call task --resumed-from wf_d1 --journal-dir "$J" --tasks-dir "$V" >/dev/null
ok "$(since ro "$M" '[d["runId"], d.get("resumedFrom")]')" '["wf_d1",null] ["wf_d2","wf_d1"]' "run-bound resumedFrom"
M=$(cnt ro)
lead d own 'workflow call failed: no result row' >/dev/null
ok "$(since ro "$M")" "slot-freed:d set-aside:d" "dead call: slot-freed, set-aside"
ok "$(since ro "$M" '[d.get("outcome"), d.get("stage"), d.get("reasonClass"), d.get("setAsideAt")]')" \
  '["lost",null,null,null] [null,"implement","call-failed","run"]' "lost; implement, call-failed, run"

echo "== 7. the integrate-call path: the lane is held through the integrated row to the merge"
mkt e ro review "pr: $PR/7" "ready: 2026-10-05T09:00+00:00"
M=$(cnt ro)
rrs mark-integrating --tasks e --tasks-dir "$V" --now "$NOW" >/dev/null
rrs bind-run --tasks e --run-id wf_e1 --call integrate --journal-dir "$J" --tasks-dir "$V" >/dev/null
row "$(irow e review integrated integrator '["conflict"]' 2026-10-05T10:01:00Z)" >/dev/null
ok "$(fm e integrating)" "<none>" "the integrated row removed integrating:"
ok "$(rrs hold --tasks e --hold merge --state start --tasks-dir "$V")" "e: hold-started merge [written]" "a merge hold is accepted after the integrated row"
rrs hold --tasks e --hold merge --state end --tasks-dir "$V" >/dev/null
rrs mark-done --tasks e --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since ro "$M")" "lane-taken:e run-bound:e hold-started:e hold-ended:e lane-freed:e merged:e" "integrate path"
ok "$(since ro "$((M+4))" '[d.get("release"), d.get("path"), d.get("triggers"), d.get("conflict")]' | cut -d' ' -f1)" \
  '["merge","integrator",["conflict"],true]' "lane-freed(merge, integrator, [conflict], conflict true)"

echo "== 8. free-lane after an integrated row; free-lane on a non-holder"
mkt f ro review "pr: $PR/8" "ready: 2026-10-05T09:00+00:00"
M=$(cnt ro)
rrs mark-integrating --tasks f --tasks-dir "$V" --now "$NOW" >/dev/null
row "$(irow f review integrated integrator '[]' 2026-10-05T10:01:00Z)" >/dev/null
ok "$(rrs free-lane --tasks f --tasks-dir "$V" >/dev/null; echo $?)" 0 "free-lane exits 0"
ok "$(since ro "$M")" "lane-taken:f lane-freed:f" "lane-freed"
ok "$(since ro "$((M+1))" 'd["release"]')" '"halt"' "release halt"
M=$(cnt ro)
ok "$(rrs free-lane --tasks b --tasks-dir "$V" 2>/dev/null; echo $?)" 1 "free-lane on a non-holder exits 1"
ok "$(since ro "$M")" "" "and records nothing"

echo "== 9. an integrate call's Lost-call resume binds as integrate"
mkt x ro review "pr: $PR/9" "ready: 2026-10-05T09:00+00:00"
rrs mark-integrating --tasks x --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
rrs bind-run --tasks x --run-id wf_r1 --call integrate --journal-dir "$J" --tasks-dir "$V" >/dev/null
ok "$(rrs bind-run --tasks x --run-id wf_r2 --call integrate --resumed-from wf_r1 --journal-dir "$J" --tasks-dir "$V" >/dev/null; echo $?)" 0 "the resume binds"
ok "$(since ro "$M" '[d["runId"], d["call"], d.get("resumedFrom")]')" '["wf_r1","integrate",null] ["wf_r2","integrate","wf_r1"]' "call integrate, resumedFrom wf_r1"
M=$(cnt ro)
ok "$(rrs bind-run --tasks b --run-id wf_b9 --call integrate --journal-dir "$J" --tasks-dir "$V" 2>/dev/null; echo $?)" 1 "bind-run integrate on a non-holder exits 1"
ok "$(rrs bind-run --tasks x --run-id wf_x9 --call task --journal-dir "$J" --tasks-dir "$V" 2>/dev/null; echo $?)" 1 "bind-run task on a note not in_progress exits 1"
ok "$(rrs bind-run --tasks x --run-id run_1 --call integrate --journal-dir "$J" --tasks-dir "$V" 2>/dev/null; echo $?)" 2 "a runId without wf_ is usage (exit 2)"
ok "$(rrs bind-run --tasks x --run-id wf_a..b --call integrate --journal-dir "$J" --tasks-dir "$V" 2>/dev/null; echo $?)" 2 "a runId with .. is usage"
ok "$(rrs bind-run --tasks x --run-id wf_r3 --call integrate --tasks-dir "$V" 2>/dev/null; echo $?)" 1 "no session id and no --journal-dir: exit 1"
mkdir -p "$TMP/cfg/projects/-proj"; : > "$TMP/cfg/projects/-proj/sess-1.jsonl"
ok "$(CLAUDE_CONFIG_DIR="$TMP/cfg" CLAUDE_CODE_SESSION_ID=sess-1 rrs bind-run --tasks x --run-id wf_r3 --call integrate --tasks-dir "$V" --dry-run)" \
  "x: run-bound wf_r3 call=integrate journalDir=$TMP/cfg/projects/-proj/sess-1/workflows (dry-run)" "journalDir derived from the session's transcript"
ok "$(since ro "$M")" "" "refusals and a dry-run record nothing"

echo "== 10. a rejected integrate row -> lane-freed(reject) only"
M=$(cnt ro)
row "$(irow x blocked rejected integrator '["red"]' 2026-10-05T10:30:00Z $'revise: rejected at Integration re-review \xe2\x80\x94 revise on the branch, then re-integrate\n\nRound 1 (Integration) rejection:\n- fix y')" >/dev/null
ok "$(since ro "$M")" "lane-freed:x" "lane-freed only"
ok "$(since ro "$M" '[d["release"], d["path"], d["triggers"], d["conflict"]]')" '["reject","integrator",["red"],false]' "release reject"

echo "== 10b. a rejected integrate row that ends review-blocked -> lane-freed(reject), set-aside(integrate, review-rounds, run)"
mkt xb ro review "pr: $PR/10" "ready: 2026-10-05T09:00+00:00"
rrs mark-integrating --tasks xb --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
row "$(irow xb review-blocked rejected integrator '["red"]' 2026-10-05T10:31:00Z 'out of review rounds')" >/dev/null
ok "$(since ro "$M")" "lane-freed:xb set-aside:xb" "lane-freed, then set-aside: no seeded revise follows"
ok "$(since ro "$M" '[d.get("release"), d.get("stage"), d.get("reasonClass"), d.get("setAsideAt")]')" \
  '["reject",null,null,null] [null,"integrate","review-rounds","run"]' "release reject; integrate, review-rounds, run"

echo "== 11. merge-task exit 1 (--kind own on a lane holder) -> lane-freed(set-aside), set-aside(integrate, merge-task, run)"
mkt m ro review "pr: $PR/11" "ready: 2026-10-05T09:00+00:00"
rrs mark-integrating --tasks m --tasks-dir "$V" --now "$NOW" >/dev/null
rrs log-integration --tasks m --started 2026-10-05T10:10+00:00 --anchor $A40 --head $B40 --base $C40 --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
lead m own 'merge-task: PR is CLOSED' >/dev/null
ok "$(since ro "$M")" "lane-freed:m set-aside:m" "lane-freed, set-aside, no slot-freed"
ok "$(since ro "$M" '[d.get("release"), d.get("stage"), d.get("reasonClass"), d.get("setAsideAt")]')" \
  '["set-aside",null,null,null] [null,"integrate","merge-task","run"]' "stage integrate, merge-task, setAsideAt run"
ok "$(since ro "$M" '[d.get("path"), d.get("triggers"), d.get("conflict")]' | cut -d' ' -f1)" '["lead",[],false]' \
  "a lead row's lane-freed reads path, triggers and conflict from the Integration log"

echo "== 12. a gated decline after an integrate call: hold end before the set-aside row"
mkt n ro review "pr: $PR/12" "ready: 2026-10-05T09:00+00:00"
rrs mark-integrating --tasks n --tasks-dir "$V" --now "$NOW" >/dev/null
row "$(irow n review integrated integrator '["red","conflict"]' 2026-10-05T10:01:00Z)" >/dev/null
M=$(cnt ro)
rrs hold --tasks n --hold merge --state start --tasks-dir "$V" >/dev/null
rrs hold --tasks n --hold merge --state end --tasks-dir "$V" >/dev/null
lead n integration 'merge declined at the --gated hold' >/dev/null
ok "$(since ro "$M")" "hold-started:n hold-ended:n lane-freed:n set-aside:n" "start, end, then the row's events"
ok "$(since ro "$((M+3))" '[d["stage"], d["reasonClass"], d["setAsideAt"]]')" '["integrate","declined","integration"]' "reasonClass declined"
ok "$(since ro "$((M+2))" '[d.get("release"), d.get("path"), d.get("triggers"), d.get("conflict")]' | cut -d' ' -f1)" '["set-aside","integrator",["red","conflict"],true]' \
  "the decline's lane-freed carries the integrated line's path, triggers and conflict"

echo "== 13. a hand-back restart and a signed gate"
rrs hand-back --tasks b --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(fm b handed_back)" "handed_back: 2026-10-05T10:00+00:00" "hand-back stamps handed_back:"
M=$(cnt ro)
rrs mark-started --tasks b --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since ro "$M" '[d["kind"], d["start"]]')" '["slot-taken","hand-back"]' "start hand-back"
ok "$(fm b handed_back)" "<none>" "mark-started consumed the marker"
for g in g g2; do
  mkt $g ro gate-pending "pr: $PR/13"
  printf '\n## Gated inputs (awaiting sign-off)\n\n- spend: one test call — cap $1\n' >> "$V/$g.md"
  rrs approve-gates --tasks $g --tasks-dir "$V" --now "$NOW" >/dev/null
done
ok "$(fm g status)|$(fm g gates_signed)" "status: in_progress|gates_signed: 2026-10-05T10:00+00:00" "approve-gates: in_progress + gates_signed"
M=$(cnt ro)
rrs mark-started --tasks g --start resume --tasks-dir "$V" --now "$NOW" >/dev/null
rrs mark-started --tasks g2 --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since ro "$M" '[d["task"], d["start"]]')" '["g","resume"] ["g2","hand-back"]' "--start resume beats gates_signed:; without it, hand-back"

echo "== 15. RACE: hold race start needs the Race log; mark-done ends it"
mkt k ro review "pr: $PR/15" "ready: 2026-10-05T09:00+00:00"
rrs mark-integrating --tasks k --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
ok "$(rrs hold --tasks k --hold race --state start --tasks-dir "$V" 2>/dev/null; echo $?)" 1 "refused without a Race log line"
section ro $'## Race log\n\n- 2026-10-05T11:00+00:00 [[k]] RACE: PR #15 merged as x on parent y; re-verify it\n'
ok "$(rrs hold --tasks k --hold race --state start --tasks-dir "$V")" "k: hold-started race [written]" "accepted with one"
rrs mark-done --tasks k --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since ro "$M")" "hold-started:k hold-ended:k lane-freed:k merged:k" "race hold ends at mark-done"
ok "$(since ro "$((M+1))" 'd.get("hold") or d.get("release") or "-"')" '"race" "merge" "-"' "hold-ended race, lane-freed merge"

echo "== 16. a usage-limit dead call -> quota-stall"
mkt q ro in_progress
rrs mark-started --tasks q --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
lead q own "workflow call failed: You've hit your usage limit" >/dev/null
ok "$(since ro "$M")" "slot-freed:q set-aside:q quota-stall:q" "slot-freed, set-aside, quota-stall"
ok "$(since ro "$((M+1))" '[d.get("reasonClass"), d.get("stage")]')" '["quota","implement"] [null,"implement"]' "reasonClass quota; quota-stall stage"
has "$(since ro "$((M+2))" 'd["detail"]')" "usage limit" "quota-stall detail"

echo "== 17. a read-only approval -> slot-freed(completed), merged(readOnly)"
mkt r ro in_progress "scope_note: x"
setfm r scope read-only
rrs mark-started --tasks r --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
row "$(trow r '{"status":"review","prUrl":"","scope":"read-only","reviewRoundsUsed":1}')" >/dev/null
ok "$(since ro "$M")" "slot-freed:r merged:r" "completed, merged"
ok "$(since ro "$M" '[d.get("outcome"), d.get("readOnly")]')" '["completed",null] [null,true]' "outcome completed, readOnly"

echo "== 18. resume flips a merged PR done -> lane-freed(merge), merged"
mkt s ro review "pr: $PR/18" "ready: 2026-10-05T09:00+00:00"
rrs mark-integrating --tasks s --tasks-dir "$V" --now "$NOW" >/dev/null
GH="$TMP/gh"
cat > "$GH" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"pr view"*pull/18*) echo '{"state":"MERGED","mergedAt":"2026-10-05T12:00:00Z","baseRefName":"main","url":"u"}';;
  *"pr view"*) echo '{"state":"OPEN","mergedAt":null,"baseRefName":"main","url":"u"}';;
  *"repo view"*) echo main;;
esac
SH
chmod +x "$GH"
M=$(cnt ro)
ok "$(rrs resume --rollout "$V/ro.md" --tasks-dir "$V" --gh-bin "$GH" --now "$NOW" >/dev/null; echo $?)" 0 "resume exits 0"
ok "$(since ro "$M")" "lane-freed:s merged:s" "lane-freed, merged"
ok "$(since ro "$M" 'd.get("release") or d.get("pr")')" "\"merge\" \"$PR/18\"" "release merge, pr"

echo "== 18b. resume flips a running (in_progress) note done -> slot-freed(completed), merged"
mkt s2 ro in_progress "pr: $PR/28"
rrs mark-started --tasks s2 --tasks-dir "$V" --now "$NOW" >/dev/null
GHS2="$TMP/gh-s2"
cat > "$GHS2" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"pr view"*pull/28*) echo '{"state":"MERGED","mergedAt":"2026-10-05T12:00:00Z","baseRefName":"main","url":"u"}';;
  *"pr view"*) echo '{"state":"OPEN","mergedAt":null,"baseRefName":"main","url":"u"}';;
  *"repo view"*) echo main;;
esac
SH
chmod +x "$GHS2"
M=$(cnt ro)
rrs resume --rollout "$V/ro.md" --tasks-dir "$V" --gh-bin "$GHS2" --now "$NOW" >/dev/null
ok "$(fm s2 status)" "status: done" "resume flipped the running note done"
ok "$(since ro "$M")" "slot-freed:s2 merged:s2" "slot-freed before merged"
ok "$(since ro "$M" 'd.get("outcome") or d.get("pr")')" "\"completed\" \"$PR/28\"" "outcome completed, pr"

echo "== 19. defer records the frees before rollout: is cleared"
mkt u ro in_progress
rrs mark-started --tasks u --tasks-dir "$V" --now "$NOW" >/dev/null
mkt v ro review "pr: $PR/19"
rrs mark-integrating --tasks v --tasks-dir "$V" --now "$NOW" >/dev/null
M=$(cnt ro)
rrs defer --tasks u,v --rollout "$V/ro.md" --tasks-dir "$V" >/dev/null
ok "$(since ro "$M")" "slot-freed:u lane-freed:v" "slot-freed u, lane-freed v"
ok "$(since ro "$M" 'd.get("outcome") or d.get("release")')" '"stopped" "halt"' "stopped, halt"
ok "$(fm u rollout)|$(fm v rollout)" "<none>|<none>" "rollout: cleared"

echo "== 22. --dry-run records nothing; the same call without it records"
# Each verb runs on a note it would record for: n is set aside at Integration with a pr: (hand-back's Integration
# arm), g3 is gate-pending with a pr: and a last `set-aside` Integration log line (approve-gates' Integration arm),
# z2 is a review + PR note the stub reports MERGED (resume), and the ceiling is raised so `next` leaves free Slots.
mkt y ro in_progress; mkt z ro review "pr: $PR/22"; mkt z2 ro review "pr: $PR/222"
mkt g3 ro gate-pending "pr: $PR/223"
printf '\n## Integration log\n\n2026-10-05T10:00+00:00 set-aside path=integrator pr=223 anchor=%s head=%s base=%s wait=- duration=- triggers=-\n\n## Gated inputs (awaiting sign-off)\n\n- spend: x — cap $1\n' \
  $A40 $B40 $C40 >> "$V/g3.md"
GH22="$TMP/gh22"
cat > "$GH22" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"pr view"*pull/222*) echo '{"state":"MERGED","mergedAt":"2026-10-05T12:00:00Z","baseRefName":"main","url":"u"}';;
  *"pr view"*) echo '{"state":"OPEN","mergedAt":null,"baseRefName":"main","url":"u"}';;
  *"repo view"*) echo main;;
esac
SH
chmod +x "$GH22"
# dry <expected kind:task list> <verb args...>: the call with --dry-run records nothing; without it, the list
dry() {
  local want=$1; shift; local m; m=$(cnt ro)
  rrs "$@" --dry-run >/dev/null 2>&1
  ok "$(since ro "$m")" "" "$1 --dry-run records nothing"
  rrs "$@" >/dev/null 2>&1
  ok "$(since ro "$m")" "$want" "$1 without --dry-run records"
}
dry "slot-taken:y" mark-started --tasks y --tasks-dir "$V" --now "$NOW"
dry "lane-taken:z" mark-integrating --tasks z --tasks-dir "$V" --now "$NOW"
dry "lane-freed:z merged:z" mark-done --tasks z --tasks-dir "$V" --now "$NOW"
dry "slot-freed:y set-aside:y" reconcile --result "$(trow y '{"status":"blocked","blockerDiagnosis":"x"}')" --tasks-dir "$V" --now "$NOW"
ok "$(rrs next --rollout "$V/ro.md" --tasks-dir "$V" --running "" --now "$NOW" | python3 -c 'import json,sys; print([e["setAsideAt"] for e in json.load(sys.stdin)["setAside"] if e["slug"] == "n"])')" \
  "['integration']" "n is set aside at Integration"
dry "ready:n" hand-back --tasks n --tasks-dir "$V" --now "$NOW"
dry "ready:g3" approve-gates --tasks g3 --tasks-dir "$V" --now "$NOW"
ok "$(fm g3 status)" "status: review" "approve-gates took the Integration arm"
dry "merged:z2" resume --rollout "$V/ro.md" --tasks-dir "$V" --gh-bin "$GH22" --now "$NOW"
dry "run-bound:c" bind-run --tasks c --run-id wf_c1 --call task --journal-dir "$J" --tasks-dir "$V"
setfm ro parallel_ceiling 9
dry "idle-slots:-" next --rollout "$V/ro.md" --tasks-dir "$V" --running c,b,g,g2 --now "$NOW"
setfm ro parallel_ceiling 3
dry "hold-started:f" hold --tasks f --hold merge --state start --tasks-dir "$V"
dry "hold-ended:f" hold --tasks f --hold merge --state end --tasks-dir "$V"
dry "lane-freed:f" free-lane --tasks f --tasks-dir "$V"
dry "slot-freed:c" defer --tasks c --tasks-dir "$V"

echo "== end of ro: the open Slots are deferred"
M=$(cnt ro)
rrs defer --tasks b,g,g2 --rollout "$V/ro.md" --tasks-dir "$V" >/dev/null
ok "$(since ro "$M")" "slot-freed:b slot-freed:g slot-freed:g2" "three slot-freed"

echo "== 14. pauses (rollout pz)"
mkro pz "parallel_ceiling: 2" "pause_requested: true"
mkt pa pz done
rrs next --rollout "$V/pz.md" --tasks-dir "$V" --running "" --now "$NOW" >/dev/null
ok "$(since pz 0 '[d["kind"], d.get("mode")]' | cut -d' ' -f1)" '["paused","soft"]' "next stamps the soft pause: paused(soft)"
M=$(cnt pz)
rrs clear-pause --rollout "$V/pz.md" >/dev/null
ok "$(since pz "$M")" "resumed:-" "clear-pause: resumed"
mkt h pz in_progress; mkt i pz review "pr: $PR/14"
rrs mark-started --tasks h --tasks-dir "$V" --now "$NOW" >/dev/null
rrs mark-integrating --tasks i --tasks-dir "$V" --now "$NOW" >/dev/null
setfm pz paused 2026-10-05T13:00+00:00
M=$(cnt pz)
ok "$(rrs record-pause --rollout "$V/pz.md" --tasks-dir "$V" --dry-run)" "pz: hard pause recorded (slot h, lane i) (dry-run)" "record-pause --dry-run"
ok "$(since pz "$M")" "" "records nothing on --dry-run"
rrs record-pause --rollout "$V/pz.md" --tasks-dir "$V" >/dev/null
ok "$(since pz "$M")" "paused:- slot-freed:h lane-freed:i" "paused(hard), slot-freed h, lane-freed i"
ok "$(since pz "$M" '[d.get("mode"), d.get("outcome"), d.get("release")]')" '["hard",null,null] [null,"stopped",null] [null,null,"halt"]' "hard, stopped, halt"
ok "$(since pz "$M" 'd["ts"]' | cut -d' ' -f1)" '"2026-10-05T13:00:00.000Z"' "paused(hard) at the stamp"
M=$(cnt pz)
ok "$(rrs record-pause --rollout "$V/pz.md" --tasks-dir "$V")" "pz: pause already recorded [no-change]" "a second run is a no-change"
rrs clear-pause --rollout "$V/pz.md" >/dev/null
ok "$(since pz "$M")" "resumed:-" "clear-pause after record-pause: resumed only"
ok "$(rrs record-pause --rollout "$V/pz.md" --tasks-dir "$V" 2>/dev/null; echo $?)" 1 "record-pause with no stamp exits 1"
setfm pz paused 2026-10-05T14:00+00:00
M=$(cnt pz)
rrs clear-pause --rollout "$V/pz.md" --dry-run >/dev/null
ok "$(since pz "$M")" "" "clear-pause --dry-run records nothing"
rrs clear-pause --rollout "$V/pz.md" >/dev/null
ok "$(since pz "$M" '[d["kind"], d.get("mode"), d["ts"][:16]]' | cut -d' ' -f1)" '["paused","hard","2026-10-05T14:00"]' "catch-up: paused(hard) at the stamp"
ok "$(since pz "$M")" "paused:- resumed:-" "then resumed"
M=$(cnt pz)
setfm pz pause_requested true
rrs clear-pause --rollout "$V/pz.md" >/dev/null
ok "$(since pz "$M")" "" "removing only pause_requested records nothing"

echo "== 20. a carry frees the stalled Slot in the old record and carries it to the new"
mkro cr "parallel_ceiling: 2" "pause_requested: true"
mkt w cr in_progress
rrs mark-started --tasks w --rollout "$V/cr.md" --tasks-dir "$V" --now "$NOW" >/dev/null
rrs next --rollout "$V/cr.md" --tasks-dir "$V" --running "" --now "$NOW" >/dev/null
ok "$(fm cr paused | cut -c1-7)" "paused:" "a paused next --running \"\" stamps past the stalled note"
mkro nw "parallel_ceiling: 2" 'supersedes: "[[cr]]"'
M=$(cnt cr)
rrs carry --from "$V/cr.md" --to "$V/nw.md" --tasks-dir "$V" --dry-run >/dev/null
ok "$(since cr "$M")" "" "carry --dry-run records nothing"
rrs carry --from "$V/cr.md" --to "$V/nw.md" --tasks-dir "$V" >/dev/null
ok "$(since cr "$M")" "slot-freed:w carried:w" "old record: slot-freed(stopped), carried"
ok "$(since cr "$M" 'd.get("outcome") or [d["from"], d["to"], d["rollout"]]')" '"stopped" ["cr","nw","cr"]' "stopped; carried cr -> nw"
ok "$(since nw 0)" "carried:w" "new record: carried"
rrs mark-started --tasks w --rollout "$V/nw.md" --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since nw 1 '[d["kind"], d.get("carriedFrom"), d["start"]]')" '["slot-taken","cr","restart"]' "slot-taken carriedFrom cr"
rrs mark-started --tasks w --rollout "$V/nw.md" --tasks-dir "$V" --now "$NOW" >/dev/null
ok "$(since nw 2 '"carriedFrom" in d')" "false" "a later slot-taken carries no carriedFrom"

echo "== 21. idle-slots reasons"
# idle <rollout> [next flags...]: the reason of the last idle-slots line next appends ('-' for none)
idle() {
  local ro=$1; shift; local m; m=$(cnt "$ro")
  rrs next --rollout "$V/$ro.md" --tasks-dir "$V" --now "$NOW" "$@" >/dev/null 2>&1
  local got; got=$(since "$ro" "$m" 'd["reason"] if d["kind"] == "idle-slots" else None' | tr ' ' '\n' | grep -v null | tail -1)
  echo "${got:--}"
}
mkro i1 "parallel_ceiling: 2"; mkt p0 - open; mkt p1 i1 open 'depends-on: ["[[p0]]"]'
ok "$(idle i1 --running "")" '"dependency"' "dependency"
mkro i2 "parallel_ceiling: 2"; mkt s1 i2 in_progress "solo: true"; mkt s2 i2 open
ok "$(idle i2)" '"solo"' "solo"
mkro i3 "parallel_ceiling: 2"; mkt t1 i3 blocked; mkt t2 i3 open
ok "$(idle i3 --running "")" '"awaiting-hand-back"' "awaiting-hand-back while t2 starts in the same next"
mkro i4 "parallel_ceiling: 2"; mkt u1 i4 in_progress
ok "$(idle i4 --dry-run)" "-" "none on --dry-run"
ok "$(idle i4)" '"queue-tail"' "queue-tail"
mkro i5 "parallel_ceiling: 2" "pause_requested: true"; mkt v1 i5 in_progress
ok "$(idle i5)" '"pause-drain"' "pause-drain"
mkro i6 "parallel_ceiling: 2"; mkt w1 i6 open
printf '\n## Git-env log\n\n- 2026-10-05T10:00+00:00 git-env trip [[w1]] task: refs/heads/main a→b; repo /x\n' >> "$V/i6.md"
ok "$(idle i6 --running "")" '"hold-git-env"' "hold-git-env"
mkro i7 "parallel_ceiling: 2"; mkt rc i7 review "pr: $PR/21"
printf '\n## Race log\n\n- 2026-10-05T10:00+00:00 [[rc]] RACE: unverified\n' >> "$V/i7.md"
ok "$(idle i7 --running "")" '"hold-race"' "hold-race"
mkro i8 "parallel_ceiling: 2"; mkt d1 i8 done
ok "$(idle i8 --running "")" "-" "none at halt complete"

echo "== 23. an unwritable events dir changes no exit, stdout or non-record stderr"
S="$TMP/s23"
# scenario <events dir> <transcript>: a fresh vault at the same path, every verb once, each call's rc and stdout
# and its stderr without run_record: lines appended to the transcript
scenario() {
  local ev=$1 tr=$2
  rm -rf "$S" && mkdir -p "$S"
  : > "$tr"; : > "$tr.rr"
  local V="$S/v"; mkdir -p "$V"
  run() { local o e rc; o=$(THREAD_EVENTS_DIR="$ev" "$@" 2>"$S/err"); rc=$?
          e=$(grep -v '^run_record: ' "$S/err"); printf '%s\n%s\n%s\n--\n' "$rc" "$o" "$e" >> "$tr"
          grep '^run_record: ' "$S/err" >> "$tr.rr"; }
  vv() { python3 "$SCRIPT" "$@"; }
  mkro ro "parallel_ceiling: 2" "max_review_rounds: 4" "max_iterations: 3" "max_plan_rounds: 3"
  mkt a ro open; mkt b ro open
  run vv next --rollout "$V/ro.md" --tasks-dir "$V" --running "" --now "$NOW"
  setfm a status in_progress; setfm b status in_progress
  run vv mark-started --tasks a,b --rollout "$V/ro.md" --tasks-dir "$V" --now "$NOW"
  run vv bind-run --tasks a --run-id wf_a1 --call task --journal-dir "$J" --tasks-dir "$V"
  run vv reconcile --result "$(trow a "$ra")" --tasks-dir "$V" --now "$NOW"
  run vv mark-integrating --tasks a --tasks-dir "$V" --now "$NOW"
  run vv log-integration --tasks a --started 2026-10-05T10:10+00:00 --anchor $A40 --head $B40 --base $C40 --tasks-dir "$V" --now "$NOW"
  run vv hold --tasks a --hold merge --state start --tasks-dir "$V"
  run vv hold --tasks a --hold merge --state end --tasks-dir "$V"
  run vv mark-done --tasks a --tasks-dir "$V" --now "$NOW"
  run vv reconcile --result "$(trow b '{"status":"blocked","blockerDiagnosis":"x"}')" --tasks-dir "$V" --now "$NOW"
  mkt e ro review "pr: $PR/7" "ready: 2026-10-05T09:00+00:00"
  run vv mark-integrating --tasks e --tasks-dir "$V" --now "$NOW"
  run vv reconcile --result "$(irow e review integrated integrator '[]' 2026-10-05T10:01:00Z)" --tasks-dir "$V" --now "$NOW"
  run vv free-lane --tasks e --tasks-dir "$V"
  mkt m ro review "pr: $PR/11"
  run vv mark-integrating --tasks m --tasks-dir "$V" --now "$NOW"
  run sh -c "printf 'merge-task: PR is CLOSED' | python3 '$LI' set-aside --note '$V/m.md' --kind own | python3 '$SCRIPT' reconcile --result - --tasks-dir '$V' --now $NOW"
  run vv hand-back --tasks b --tasks-dir "$V" --now "$NOW"
  run vv mark-started --tasks b --tasks-dir "$V" --now "$NOW"
  mkt g ro gate-pending; printf '\n## Gated inputs (awaiting sign-off)\n\n- spend: x — cap $1\n' >> "$V/g.md"
  run vv approve-gates --tasks g --tasks-dir "$V" --now "$NOW"
  run vv mark-started --tasks g --start resume --tasks-dir "$V" --now "$NOW"
  mkt d ro in_progress
  run vv mark-started --tasks d --tasks-dir "$V" --now "$NOW"
  run sh -c "printf \"workflow call failed: You've hit your usage limit\" | python3 '$LI' set-aside --note '$V/d.md' --kind own | python3 '$SCRIPT' reconcile --result - --tasks-dir '$V' --now $NOW"
  mkt k ro review "pr: $PR/15"
  run vv mark-integrating --tasks k --tasks-dir "$V" --now "$NOW"
  section ro $'## Race log\n\n- 2026-10-05T11:00+00:00 [[k]] RACE: x\n'
  run vv hold --tasks k --hold race --state start --tasks-dir "$V"
  run vv mark-done --tasks k --tasks-dir "$V" --now "$NOW"
  mkt s ro review "pr: $PR/18"
  run vv mark-integrating --tasks s --tasks-dir "$V" --now "$NOW"
  run vv resume --rollout "$V/ro.md" --tasks-dir "$V" --gh-bin "$GH" --now "$NOW"
  run vv defer --tasks b --rollout "$V/ro.md" --tasks-dir "$V"
  run vv next --rollout "$V/ro.md" --tasks-dir "$V" --running g --now "$NOW"
  mkro pz "parallel_ceiling: 2" "pause_requested: true"
  run vv next --rollout "$V/pz.md" --tasks-dir "$V" --running "" --now "$NOW"
  run vv clear-pause --rollout "$V/pz.md"
  mkt h pz in_progress
  run vv mark-started --tasks h --tasks-dir "$V" --now "$NOW"
  setfm pz paused 2026-10-05T13:00+00:00
  run vv record-pause --rollout "$V/pz.md" --tasks-dir "$V"
  run vv clear-pause --rollout "$V/pz.md"
  mkro cr "parallel_ceiling: 2" "paused: 2026-10-05T13:00+00:00"; mkt w cr in_progress
  mkro nw "parallel_ceiling: 2" 'supersedes: "[[cr]]"'
  run vv carry --from "$V/cr.md" --to "$V/nw.md" --tasks-dir "$V"
  run vv mark-started --tasks w --tasks-dir "$V" --now "$NOW"
}
scenario "$TMP/w23/events" "$TMP/t-ok"
[ -s "$TMP/w23/events/ro.jsonl" ] && ok y y "the writable run wrote ro.jsonl" || ok n y "the writable run wrote ro.jsonl"
: > "$TMP/file"
scenario "$TMP/file/events" "$TMP/t-bad"
ok "$(diff "$TMP/t-ok" "$TMP/t-bad" >/dev/null && echo same || diff "$TMP/t-ok" "$TMP/t-bad" | head -20)" same "every exit, stdout and non-record stderr is identical"
ok "$(grep -c . "$TMP/t-ok" | awk '{print ($1 > 100)}')" 1 "the transcript is not empty"
ok "$(grep -c 'Traceback' "$TMP/t-ok")" 0 "no verb crashed"
ok "$(grep -c . "$TMP/t-ok.rr")" 0 "the writable run printed no run_record line"
ok "$(grep -vc '^run_record: warning: ' "$TMP/t-bad.rr")|$(grep -c 'cannot write' "$TMP/t-bad.rr" | awk '{print ($1 > 20)}')" "0|1" \
  "the unwritable run printed only run_record warnings, one per event"
ok "$(THREAD_EVENTS_DIR="$TMP/file/events" python3 "$SCRIPT" mark-integrating --tasks s --tasks-dir "$S/v" 2>&1 >/dev/null | grep -c '^run_record: warning: cannot write')" 0 \
  "a refused verb (s is done) never reaches the writer"
mkt zz ro review "pr: $PR/23"
ok "$(THREAD_EVENTS_DIR="$TMP/file/events" python3 "$SCRIPT" mark-integrating --tasks zz --tasks-dir "$V" 2>&1 >/dev/null | grep -c '^run_record: warning: cannot write')" 1 \
  "an unwritable dir is one run_record warning"
rrs defer --tasks zz --tasks-dir "$V" >/dev/null 2>&1

echo "== 24. the pairing checker over ro's whole record"
ok "$(head -10 "$(recf ro)" | python3 -c 'import json,sys; print(" ".join(json.loads(l)["kind"] for l in sys.stdin))')" \
  "slot-taken slot-taken run-bound slot-freed ready lane-taken hold-started hold-ended lane-freed merged" "legs 1-3 in order"
check() {  # check <rollout>: run_record.py's reader rules; prints each unmatched or flagged item, or "paired"
  python3 - "$(recf "$1")" <<'PY'
import json, sys
slots, lane, holds, paused, flags = {}, None, set(), False, []
for n, raw in enumerate(open(sys.argv[1]), 1):
    d = json.loads(raw)
    k, t = d["kind"], d.get("task")
    if k == "slot-taken":
        slots.setdefault(t, n)
    elif k == "slot-freed":
        slots.pop(t, None)
    elif k == "lane-taken":
        if lane not in (None, t):
            flags.append("lane %s ended unrecorded at line %d" % (lane, n))
        lane = t
    elif k == "lane-freed":
        if lane == t:
            lane = None
        holds.discard(("merge", t))
    elif k == "hold-started":
        holds.add((d["hold"], t))
    elif k == "hold-ended":
        holds.discard((d["hold"], t))
    elif k == "paused":
        paused = True
    elif k == "resumed":
        paused = False
    elif k == "carried" and d["rollout"] == d["from"]:
        slots.pop(t, None)
        lane = None if lane == t else lane
        holds = {h for h in holds if h[1] != t}
flags += ["slot %s open" % s for s in sorted(slots)] + (["lane %s open" % lane] if lane else [])
flags += ["hold %s %s open" % h for h in sorted(holds)] + (["pause open"] if paused else [])
print("; ".join(flags) or "paired")
PY
}
ok "$(check ro)" "paired" "ro: every lane-taken, slot-taken and hold-started is closed"
ok "$(check cr)" "pause open" "cr: the carried Slot is closed; only the superseded rollout's pause stays open"
ok "$(check pz)" "paired" "pz: the hard pause freed h's Slot and i's lane"

echo
[ "$fail" -eq 0 ] && echo "reconcile-rollout-record: all pass" || echo "reconcile-rollout-record: FAILURES"
exit "$fail"
