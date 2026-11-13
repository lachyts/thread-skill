#!/usr/bin/env bash
# fold-journals (p15-3): the rollout's Workflow journals fold into its Run record as call-journal lines,
# through run_record.emit (ADR 0032), and (p46-2, case 11) each terminal journal segment as one role-call line per role,
# only into the record of a rollout whose engine reads the kind (11g: an old-root fixture writes none). The record's
# run-bound lines name each call's runId and journal dir;
# a fold is idempotent, skips a runId already folded with a terminal status (so a journal cleaned up after
# ~30 days never warns), warns and continues on anything missing or malformed, and never writes outside
# run_record.py. Also pins execute SKILL §4.5 step 5's ceremony bullet. Temp dirs only.
# Usage: bash reconcile-rollout-fold.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
RR="$HERE/../../_shared/scripts/run_record.py"
SKILL="$HERE/../SKILL.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
WF="$TMP/wf"
mkdir -p "$WF" "$THREAD_EVENTS_DIR"

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
rec() { echo "$THREAD_EVENTS_DIR/$1.jsonl"; }
bind() {  # bind <rollout> <task> <json fields>: one run-bound line through the real writer
  python3 "$RR" emit --kind run-bound --rollout "$1" --task "$2" --json "$3" || { echo "FAIL - seed run-bound $2"; fail=1; }
}
journal() {  # journal <runId> <status> <tokens json> [mode] [path override]: a trimmed real-shape journal
  python3 - "${5:-$WF/$1.json}" "$1" "$2" "$3" "${4:-}" <<'PY'
import json, sys
path, run_id, status, tokens, mode = sys.argv[1:]
args = {"task": {"slug": "x"}}
if mode:
    args["mode"] = mode
d = {"runId": run_id, "status": status, "totalTokens": json.loads(tokens), "durationMs": 61000,
     "agentCount": 4, "startTime": 1759600000000, "args": args, "script": "...", "logs": []}
json.dump(d, open(path, "w"))
PY
}
TK="$TMP/tasks"; mkdir -p "$TK"   # the role-call gate's rollout notes (11g); a slug with no note here reads True
fold() { python3 "$SCRIPT" fold-journals --tasks-dir "$TK" "$@" 2>"$TMP/err" >"$TMP/out"; echo $?; }
cj() {  # cj <rollout> <py expr over the list of call-journal dicts L>
  python3 - "$(rec "$1")" "$2" <<'PY'
import json, sys
L = []
for raw in open(sys.argv[1]):
    try:
        d = json.loads(raw)
    except ValueError:
        continue
    if isinstance(d, dict) and d.get("kind") == "call-journal":
        L.append(d)
print(eval(sys.argv[2]))
PY
}
warns() { grep -c '^WARN:' "$TMP/err"; }
sha() { shasum "$1" 2>/dev/null | cut -d' ' -f1; }

echo "== seed: three bound calls, two journals"
bind fold-r t1 "{\"runId\":\"wf_aaa\",\"journalDir\":\"$WF\"}"
bind fold-r t2 "{\"runId\":\"wf_bbb\",\"journalDir\":\"$WF\",\"call\":\"integrate\"}"
bind fold-r t3 "{\"runId\":\"wf_ccc\",\"journalDir\":\"$WF\"}"
journal wf_aaa completed 1234
journal wf_bbb completed 5678 integrate

echo "== 1. first fold: two call-journal lines, one WARN for the in-flight call"
ok "$(fold --rollout fold-r)" 0 "exit 0"
ok "$(cj fold-r 'len(L)')" 2 "two call-journal lines"
ok "$(cj fold-r '[(d["task"], d["runId"], d["mode"], d["status"], d["tokens"], d["durationMs"], d["agents"], d["startTime"]) for d in L]')" \
  "[('t1', 'wf_aaa', 'task', 'completed', 1234, 61000, 4, 1759600000000), ('t2', 'wf_bbb', 'integrate', 'completed', 5678, 61000, 4, 1759600000000)]" \
  "fields: task, mode (task / integrate), status, tokens, durationMs, agents, startTime"
ok "$(warns)" 1 "exactly one WARN"
ok "$(grep -c 'wf_ccc' "$TMP/err")" 1 "the WARN names wf_ccc"
ok "$(grep -c 'no journal at' "$TMP/err")" 1 "the WARN says no journal"
ok "$(tail -1 "$TMP/out")" "fold-journals: fold-r: 2 folded, 0 already folded, 0 unchanged, 1 warnings" "summary line"
ok "$(grep -c '^folded wf_aaa \[\[t1\]\] task status=completed tokens=1234 durationMs=61000 agents=4$' "$TMP/out")" 1 "folded line"

echo "== 1b. mode precedence: the bound call, then the journal's args.mode, then task"
bind mode-r m1 "{\"runId\":\"wf_mode_j\",\"journalDir\":\"$WF\"}"
journal wf_mode_j completed 10 integrate
bind mode-r m2 "{\"runId\":\"wf_mode_c\",\"journalDir\":\"$WF\",\"call\":\"revise\"}"
journal wf_mode_c completed 20 integrate
ok "$(fold --rollout mode-r)" 0 "exit 0"
ok "$(cj mode-r '[(d["runId"], d["mode"]) for d in L]')" "[('wf_mode_j', 'integrate'), ('wf_mode_c', 'revise')]" \
  "no call: the journal's args.mode wins over task; a bound call wins over the journal's args.mode"

echo "== 2. idempotent"
before=$(sha "$(rec fold-r)")
ok "$(fold --rollout fold-r)" 0 "re-run exit 0"
ok "$(sha "$(rec fold-r)")" "$before" "record byte-identical"
ok "$(grep -c '^already folded' "$TMP/out")" 2 "already folded twice"
ok "$(warns)" 1 "still one WARN (wf_ccc)"
ok "$(tail -1 "$TMP/out")" "fold-journals: fold-r: 0 folded, 2 already folded, 0 unchanged, 1 warnings" "re-run summary"

echo "== 3. the 30-day cleanup: a folded journal deleted never warns"
rm -f "$WF/wf_aaa.json"
ok "$(fold --rollout fold-r)" 0 "exit 0"
ok "$(grep -c 'wf_aaa' "$TMP/err")" 0 "no WARN for wf_aaa"
ok "$(sha "$(rec fold-r)")" "$before" "record unchanged"

echo "== 4. in flight, then terminal"
journal wf_ccc running 100
ok "$(fold --rollout fold-r)" 0 "exit 0"
ok "$(cj fold-r 'len([d for d in L if d["runId"] == "wf_ccc"])')" 1 "running call folds once"
ok "$(warns)" 0 "no WARN once the journal exists"
before=$(sha "$(rec fold-r)")
fold --rollout fold-r >/dev/null
ok "$(sha "$(rec fold-r)")" "$before" "re-run of a running call adds nothing"
ok "$(grep -c '^unchanged wf_ccc' "$TMP/out")" 1 "re-run prints unchanged"
journal wf_ccc completed 900
fold --rollout fold-r >/dev/null
ok "$(cj fold-r '[(d["status"], d["tokens"]) for d in L if d["runId"] == "wf_ccc"]')" "[('running', 100), ('completed', 900)]" \
  "the terminal fold adds exactly one more line"
before=$(sha "$(rec fold-r)")
fold --rollout fold-r >/dev/null
ok "$(sha "$(rec fold-r)")" "$before" "a further run adds nothing"
ok "$(grep -c '^already folded wf_ccc' "$TMP/out")" 1 "wf_ccc already folded"

echo "== 5. --dry-run writes nothing"
bind dry-r t1 "{\"runId\":\"wf_ddd\",\"journalDir\":\"$WF\"}"
journal wf_ddd completed 7
before=$(sha "$(rec dry-r)")
ok "$(fold --rollout dry-r --dry-run)" 0 "dry-run exit 0"
ok "$(sha "$(rec dry-r)")" "$before" "dry-run leaves the record"
ok "$(grep -c '^would fold wf_ddd' "$TMP/out")" 1 "dry-run prints would fold"

echo "== 6. --rollout takes a note path and a wikilink"
ok "$(fold --rollout "$TMP/Work/Tasks/dry-r.md")" 0 "note path exit 0 (the note need not exist)"
ok "$(cj dry-r 'len(L)')" 1 "note path resolves to dry-r"
ok "$(fold --rollout '[[dry-r]]')" 0 "wikilink exit 0"
ok "$(grep -c '^already folded wf_ddd' "$TMP/out")" 1 "wikilink resolves to dry-r"

echo "== 7. no record file"
ok "$(fold --rollout none-r)" 0 "exit 0"
ok "$(grep -c '^fold-journals: none-r: no run record at ' "$TMP/out")" 1 "no run record line"
ok "$(test -e "$(rec none-r)" && echo y || echo n)" n "nothing created"

echo "== 7b. exit codes: a bad slug is 2, an unresolvable events dir is 1"
ok "$(fold --rollout 'Bad Slug!')" 2 "bad slug exit 2"
ok "$(grep -c '^ERROR: Refused' "$TMP/err")" 1 "bad slug ERROR line"
ok "$(THREAD_EVENTS_DIR=relative/events fold --rollout fold-r)" 1 "relative events dir exit 1"
ok "$(grep -c '^ERROR: cannot resolve the events directory' "$TMP/err")" 1 "events dir ERROR line"

ok "$(fold --rollout reviews)" 2 "the reserved reviews slug exit 2"
ok "$(grep -c "^ERROR: Refused: rollout 'reviews' is reserved" "$TMP/err")" 1 "reviews ERROR line"
ok "$(fold --rollout '[[reviews]]')" 2 "[[reviews]] exit 2 too"
ok "$(test -e "$(rec reviews)" && echo y || echo n)" n "nothing created for reviews"
bind unread-r u1 "{\"runId\":\"wf_unread\",\"journalDir\":\"$WF\"}"
chmod 000 "$(rec unread-r)"
if cat "$(rec unread-r)" >/dev/null 2>&1; then
  echo "ok   - (skipped: the unreadable-record check needs a non-root user)"
else
  ok "$(fold --rollout unread-r)" 1 "an unreadable record exit 1"
  ok "$(grep -c '^ERROR: cannot read the run record' "$TMP/err")" 1 "unreadable record ERROR line"
  ok "$(grep -c 'Traceback' "$TMP/err")" 0 "unreadable record: no traceback"
fi
chmod 644 "$(rec unread-r)"

echo "== 8. robustness"
mkdir -p "$TMP/wf2" "$TMP/outside"
W2="$TMP/wf2"
bind rob-r t1 "{\"runId\":\"wf_corrupt\",\"journalDir\":\"$W2\"}"
printf '{"runId": "wf_corrupt", "status":' > "$W2/wf_corrupt.json"
printf 'not json at all\n' >> "$(rec rob-r)"
bind rob-r t2 "{\"runId\":\"../outside/wf_x\",\"journalDir\":\"$W2\"}"
bind rob-r t3 "{\"runId\":\"wf..up\",\"journalDir\":\"$W2\"}"
journal wf_x completed 1 "" "$TMP/outside/wf_x.json"
bind rob-r t4 "{\"runId\":\"wf_other\",\"journalDir\":\"$W2\"}"
journal wf_mismatch completed 1 "" "$W2/wf_other.json"
bind rob-r t5 "{\"runId\":\"wf_negtok\",\"journalDir\":\"$W2\"}"
journal wf_negtok completed -5 "" "$W2/wf_negtok.json"
bind rob-r t6 "{\"runId\":\"wf_strtok\",\"journalDir\":\"$W2\"}"
journal wf_strtok completed '"12"' "" "$W2/wf_strtok.json"
bind rob-r t7 "{\"runId\":\"wf_rel\",\"journalDir\":\"relative/dir\"}"
ok "$(fold --rollout rob-r)" 0 "exit 0 through every malformed input"
ok "$(grep -c 'rob-r.jsonl:2: the record line does not parse' "$TMP/err")" 1 "garbled record line warned"
ok "$(grep -c 'wf_corrupt' "$TMP/err")" 1 "corrupt journal warned"
ok "$(grep -c 'outside/wf_x' "$TMP/err")" 1 "a runId with / warned"
ok "$(grep -c 'wf\.\.up' "$TMP/err")" 1 "a runId with .. warned"
ok "$(grep -c 'wf_other' "$TMP/err")" 1 "mismatched journal runId warned"
ok "$(grep -c 'wf_negtok.*totalTokens' "$TMP/err")" 1 "negative totalTokens warned"
ok "$(grep -c 'wf_strtok.*totalTokens' "$TMP/err")" 1 "string totalTokens warned"
ok "$(grep -c 'wf_rel' "$TMP/err")" 1 "relative journalDir warned"
ok "$(grep -c 'Traceback' "$TMP/err")" 0 "no crash"
ok "$(cj rob-r 'sorted(d["runId"] for d in L)')" "['wf_negtok', 'wf_strtok']" "only the two bad-token journals fold"
ok "$(cj rob-r '[("tokens" in d, d["durationMs"]) for d in L]')" "[(False, 61000), (False, 61000)]" \
  "a bad totalTokens is dropped, the rest folds"

echo "== 8b. a non-object journal, and a journal with no status: one WARN each, and the fold goes on"
one_bad() {  # one_bad <rollout> <label> <bad journal text>: the bad runId first, a good one bound after it
  bind "$1" b1 "{\"runId\":\"wf_${1}_bad\",\"journalDir\":\"$W2\"}"
  printf '%s' "$3" > "$W2/wf_${1}_bad.json"
  bind "$1" b2 "{\"runId\":\"wf_${1}_good\",\"journalDir\":\"$W2\"}"
  journal "wf_${1}_good" completed 3 "" "$W2/wf_${1}_good.json"
  ok "$(fold --rollout "$1")" 0 "$2: exit 0"
  ok "$(warns)" 1 "$2: exactly one WARN"
  ok "$(grep -c "wf_${1}_bad" "$TMP/err")" 1 "$2: the WARN names the bad runId"
  ok "$(grep -c 'Traceback' "$TMP/err")" 0 "$2: no traceback"
  ok "$(cj "$1" '[d["runId"] for d in L]')" "['wf_${1}_good']" "$2: the good runId bound after it still folds"
}
one_bad arr-r "a JSON array journal" '[1]'
ok "$(grep -c 'is not a JSON object' "$TMP/err")" 1 "a JSON array journal: the not-an-object WARN"
one_bad nost-r "a journal with no status" '{"runId": "wf_nost-r_bad", "totalTokens": 1}'
ok "$(grep -c 'has no status' "$TMP/err")" 1 "a journal with no status: the no-status WARN"
one_bad empst-r "a journal with an empty status" '{"runId": "wf_empst-r_bad", "status": ""}'
ok "$(grep -c 'has no status' "$TMP/err")" 1 "a journal with an empty status: the no-status WARN"

echo "== 8c. a journalDir in ~ form expands against HOME"
mkdir -p "$TMP/home/wf3"
bind tilde-r t1 '{"runId":"wf_tilde","journalDir":"~/wf3"}'
journal wf_tilde completed 77 "" "$TMP/home/wf3/wf_tilde.json"
ok "$(HOME="$TMP/home" fold --rollout tilde-r)" 0 "exit 0"
ok "$(warns)" 0 "no WARN"
ok "$(cj tilde-r '[(d["runId"], d["tokens"]) for d in L]')" "[('wf_tilde', 77)]" "the ~/ journalDir folds from \$HOME/wf3"

echo "== 9. a superseded rollout folds into its own file"
bind old-r t9 "{\"runId\":\"wf_old\",\"journalDir\":\"$WF\"}"
journal wf_old completed 42
newbefore=$(sha "$(rec fold-r)")
ok "$(fold --rollout old-r)" 0 "exit 0"
ok "$(cj old-r '[(d["rollout"], d["runId"], d["tokens"]) for d in L]')" "[('old-r', 'wf_old', 42)]" "folds into old-r.jsonl"
ok "$(sha "$(rec fold-r)")" "$newbefore" "nothing lands in another rollout's file"

echo "== 10. execute SKILL §4.5 step 5 runs the fold before the phases close and the note moves"
# step 5: from `5. **Completion.**` to the first blank line (its bullets hold no blank line, as
# tests/contracts/execute-phase-close.test.mjs slices it)
awk '/^5\. \*\*Completion\.\*\*/ {on=1} on && /^[[:space:]]*$/ {exit} on {print}' "$SKILL" > "$TMP/step5"
lno() { grep -nF -- "$1" "$TMP/step5" | head -1 | cut -d: -f1; }
f=$(lno 'reconcile-rollout.py fold-journals --rollout <rollout-note>')
c=$(lno '**Close the phases')
m=$(lno 'Move the rollout note')
ok "$([ -n "$f" ] && echo y || echo n)" y "step 5 carries the fold-journals command"
ok "$([ -n "$f" ] && [ -n "$c" ] && [ "$f" -lt "$c" ] && echo y || echo n)" y "fold before Close the phases"
ok "$([ -n "$f" ] && [ -n "$m" ] && [ "$f" -lt "$m" ] && echo y || echo n)" y "fold before Move the rollout note"

echo "== 11. (p46-2) role-call: one line per role per journal segment"
# rjournal <path> <runId> <seg1|seg2|seg3> [status]: a real-shape journal with args (ladder, task.arms), result.tasks[0]
# (status, ran, climbs), workflowProgress and startTime. seg1 is the call's first run; seg2 the same journal rewritten
# by a resume: a new startTime, seg1's agents replayed (cached, an alias model, no tokens), two fresh agents after them;
# seg3 a second resume, seg2's shape at a later startTime.
rjournal() {
  python3 - "$1" "$2" "$3" "${4:-completed}" <<'PY'
import json, sys
path, run_id, seg, status = sys.argv[1:]
L = {"source": "/l.toml", "rungs": [
    {"name": "opus-high", "model": "opus", "effort": "high", "judge": "high", "review": "xhigh"},
    {"name": "fable-high", "model": "fable", "effort": "high", "judge": "high", "review": "max"}]}
ran = [("plan:x", "opus-high", "opus", "high"), ("plan-judge:x r1", "opus-high", "opus", "high"),
       ("implement:x", "opus-high", "opus", "high"), ("implement:x@fable-high", "fable-high", "fable", "high"),
       ("review:x r1", "fable-high", "fable", "max")]
agents = [("plan:x", "claude-opus-5-5", 100), ("plan-judge:x r1", "claude-opus-5-5", 50),
          ("implement:x", "claude-opus-5-5", 300), ("implement:x@fable-high", "claude-opus-5-5", 200),
          ("review:x r1", "claude-fable-5-2", 80)]
prog = [{"type": "workflow_phase", "index": 1, "title": "Plan-gate"}]
if seg == "seg1":
    start = 1794000000000
    prog += [{"type": "workflow_agent", "label": a, "model": m, "tokens": t, "state": "done"} for a, m, t in agents]
else:
    start = {"seg2": 1794000900000, "seg3": 1794001800000}[seg]
    ran += [("revise:x r2", "fable-high", "fable", "high"), ("review:x r2", "fable-high", "fable", "max")]
    prog += [{"type": "workflow_agent", "label": a, "model": m.split("-")[1], "state": "done", "cached": True} for a, m, _ in agents]
    prog += [{"type": "workflow_agent", "label": "revise:x r2", "model": "claude-fable-5-2", "tokens": 400, "state": "done"},
             {"type": "workflow_agent", "label": "review:x r2", "model": "claude-fable-5-2", "tokens": 90, "state": "done"}]
row = {"slug": "x", "status": "review", "ran": [{"label": a, "rung": g, "model": m, "effort": e} for a, g, m, e in ran],
       "climbs": [{"stage": "implement", "from": "opus-high", "to": "fable-high"}]}
d = {"runId": run_id, "status": status, "totalTokens": 730, "durationMs": 61000, "agentCount": len(prog) - 1,
     "startTime": start, "args": {"ladder": L, "task": {"slug": "x", "arms": {"master-review": "fable", "builder": "none"}}},
     "result": {"rolloutSlug": "rc-r", "tasks": [row]}, "workflowProgress": prog, "script": "...", "logs": []}
json.dump(d, open(path, "w"))
PY
}
rc() {  # rc <rollout> <py expr over the list of role-call dicts L>
  python3 - "$(rec "$1")" "$2" <<'PY'
import json, sys
L = [d for d in (json.loads(x) for x in open(sys.argv[1]) if x.strip()) if d.get("kind") == "role-call"]
print(eval(sys.argv[2]))
PY
}
W5="$TMP/wf5"; mkdir -p "$W5"
bind rc-r x "{\"runId\":\"wf_rc\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rc.json" wf_rc seg1
ok "$(fold --rollout rc-r)" 0 "11a: exit 0"
ok "$(warns)" 0 "11a: no WARN"
ok "$(rc rc-r '[d["role"] for d in L]')" "['planner', 'plan-judge', 'builder', 'master-review']" "11a: one line per role, in order"
ok "$(rc rc-r '[(d["task"], d["runId"], d["startTime"], d["call"], d["outcome"]) for d in L][0]')" \
  "('x', 'wf_rc', 1794000000000, 'task', 'review')" "11a: task, runId, the segment's startTime, call, outcome"
ok "$(rc rc-r '[(d["role"], d["model"], d["effort"], d["dispatches"], d["tokens"], d["fresh"]) for d in L]')" \
  "[('planner', 'opus', 'high', 1, 100, 1), ('plan-judge', 'opus', 'high', 1, 50, 1), ('builder', 'opus', 'high', 2, 500, 2), ('master-review', 'fable', 'max', 1, 80, 1)]" \
  "11a: model and effort from the first ran entry, dispatches counted, tokens summed per role"
ok "$(rc rc-r '[(d["role"], d.get("arm")) for d in L]')" \
  "[('planner', None), ('plan-judge', None), ('builder', None), ('master-review', 'fable')]" "11a: an arm on master-review only (builder=none)"
ok "$(rc rc-r '[(d["role"], d.get("fellBack"), d.get("climbs"), d.get("fableRung")) for d in L]')" \
  "[('planner', None, None, True), ('plan-judge', None, None, True), ('builder', True, 1, True), ('master-review', None, None, True)]" \
  "11a: fellBack where ran asked fable and claude-opus ran; climbs per stage; fableRung on every line of the call"
ok "$(rc rc-r '[d["models"] for d in L]')" "[['claude-opus-5-5'], ['claude-opus-5-5'], ['claude-opus-5-5'], ['claude-fable-5-2']]" "11a: the model ids that ran"
ok "$(rc rc-r 'sum("replayed" in d or "tokensPartial" in d for d in L)')" 0 "11a: no replay, nothing partial"
ok "$(grep -c '^role-call wf_rc \[\[x\]\] 4 roles (segment 1794000000000)$' "$TMP/out")" 1 "11a: one line for the segment"
ok "$(tail -1 "$TMP/out")" "fold-journals: rc-r: 1 folded, 0 already folded, 0 unchanged, 0 warnings" "11a: the summary line keeps its bytes and stays last"
before=$(sha "$(rec rc-r)")
fold --rollout rc-r >/dev/null
ok "$(sha "$(rec rc-r)")" "$before" "11a: a re-run writes none"

echo "== 11b. a resume rewrites the journal: the next fold writes a second set, call-journal as it was"
rjournal "$W5/wf_rc.json" wf_rc seg2
bind rc-r x "{\"runId\":\"wf_rc\",\"journalDir\":\"$W5\",\"call\":\"task\",\"resumedFrom\":\"wf_rc\"}"
ok "$(fold --rollout rc-r)" 0 "11b: exit 0"
ok "$(grep -c '^already folded wf_rc' "$TMP/out")" 1 "11b: call-journal is already folded"
ok "$(cj rc-r 'len(L)')" 1 "11b: call-journal stays one line"
ok "$(grep -c '^role-call wf_rc \[\[x\]\] 4 roles (segment 1794000900000)$' "$TMP/out")" 1 "11b: the resume's segment written"
ok "$(rc rc-r '[(d["role"], d["dispatches"], d["tokens"], d["fresh"], d.get("replayed"), d.get("tokensPartial")) for d in L if d["startTime"] == 1794000900000]')" \
  "[('planner', 1, 0, 0, 1, None), ('plan-judge', 1, 0, 0, 1, None), ('builder', 3, 400, 1, 2, None), ('master-review', 2, 90, 1, 1, None)]" \
  "11b: replayed matches, tokens are the fresh agents only, nothing partial"
ok "$(rc rc-r '[d["models"] for d in L if d["startTime"] == 1794000900000 and d["role"] == "builder"]')" "[['claude-fable-5-2']]" \
  "11b: a replayed agent's alias is no model id that ran"
ok "$(rc rc-r '[d.get("fellBack") for d in L if d["startTime"] == 1794000900000]')" "[None, None, None, None]" \
  "11b: a replayed fallback is the first segment's, not this one's"
before=$(sha "$(rec rc-r)")
fold --rollout rc-r >/dev/null
ok "$(sha "$(rec rc-r)")" "$before" "11b: a further fold writes none"

echo "== 11c. no fold between the segments: a journal first seen at its second segment is partial"
bind rcp-r x "{\"runId\":\"wf_rcp\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rcp.json" wf_rcp seg2
fold --rollout rcp-r >/dev/null
ok "$(rc rcp-r '[(d["role"], d.get("replayed"), d.get("tokensPartial")) for d in L]')" \
  "[('planner', 1, True), ('plan-judge', 1, True), ('builder', 2, True), ('master-review', 1, True)]" \
  "11c: one set, every role with replayed agents marked tokensPartial (the limit, pinned)"

echo "== 11d. a terminal call never resumed is never read again: its journal corrupted, no write, no WARN"
bind rcq-r q "{\"runId\":\"wf_rcq\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rcq.json" wf_rcq seg1
fold --rollout rcq-r >/dev/null
printf 'not json' > "$W5/wf_rcq.json"
before=$(sha "$(rec rcq-r)")
fold --rollout rcq-r >/dev/null
ok "$(sha "$(rec rcq-r)")" "$before" "11d: nothing written"
ok "$(warns)" 0 "11d: no WARN"

echo "== 11d2. a third resume, bound after the last role-call: its journal is read silently"
bind rc-r x "{\"runId\":\"wf_rc\",\"journalDir\":\"$W5\",\"call\":\"task\",\"resumedFrom\":\"wf_rc\"}"
printf '{"runId": "wf_rc", ' > "$W5/wf_rc.json"
before=$(sha "$(rec rc-r)")
ok "$(fold --rollout rc-r)" 0 "11d2: a resumed call's corrupted journal: exit 0"
ok "$(sha "$(rec rc-r)")" "$before" "11d2: its record unchanged"
ok "$(warns)" 0 "11d2: and no WARN (the role-call pass reads silently)"
rm -f "$W5/wf_rc.json"
ok "$(fold --rollout rc-r)" 0 "11d2: its journal deleted: exit 0"
ok "$(sha "$(rec rc-r)")" "$before" "11d2: its record unchanged"
ok "$(warns)" 0 "11d2: and no WARN"
rjournal "$W5/wf_rc.json" wf_rc seg3 running
fold --rollout rc-r >/dev/null
ok "$(sha "$(rec rc-r)")" "$before" "11d2: the resumed journal still running: nothing written"
ok "$(warns)" 0 "11d2: and no WARN"
rjournal "$W5/wf_rc.json" wf_rc seg3
fold --rollout rc-r >/dev/null
ok "$(grep -c '^role-call wf_rc \[\[x\]\] 4 roles (segment 1794001800000)$' "$TMP/out")" 1 "11d2: terminal, the next fold writes its segment"
ok "$(rc rc-r '[d["role"] for d in L if d["startTime"] == 1794001800000]')" "['planner', 'plan-judge', 'builder', 'master-review']" \
  "11d2: once, a line per role"
ok "$(cj rc-r 'len(L)')" 1 "11d2: call-journal stays one line"
before=$(sha "$(rec rc-r)")
fold --rollout rc-r >/dev/null
ok "$(sha "$(rec rc-r)")" "$before" "11d2: a further fold writes none"

echo "== 11e. a journal with no result, or no workflowProgress, or a running one, writes no role-call"
ok "$(rc fold-r 'len(L)')" 0 "11e: the trimmed journals of 1-9 (no result, no progress) wrote none"
bind rcn-r n "{\"runId\":\"wf_rcn\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rcn.json" wf_rcn seg1 running
fold --rollout rcn-r >/dev/null
ok "$(rc rcn-r 'len(L)')" 0 "11e: a running journal writes no role-call"
ok "$(cj rcn-r '[d["status"] for d in L]')" "['running']" "11e: its call-journal folds in flight"
python3 - "$W5/wf_rcn.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["status"] = "completed"; d.pop("workflowProgress")
json.dump(d, open(sys.argv[1], "w"))
PY
fold --rollout rcn-r >/dev/null
ok "$(cj rcn-r '[d["status"] for d in L]')" "['running', 'completed']" "11e: the terminal call-journal lands"
ok "$(rc rcn-r 'len(L)')" 0 "11e: with no workflowProgress, no role-call"

echo "== 11f. --dry-run names the role-call it would write, and writes nothing"
bind rcd-r d "{\"runId\":\"wf_rcd\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rcd.json" wf_rcd seg1
before=$(sha "$(rec rcd-r)")
fold --rollout rcd-r --dry-run >/dev/null
ok "$(sha "$(rec rcd-r)")" "$before" "11f: nothing written"
ok "$(grep -c '^would write role-call wf_rcd \[\[d\]\] 4 roles (segment 1794000000000)$' "$TMP/out")" 1 "11f: the would-write line"

echo "== 11g. the gate: role-call only into the record of a rollout whose engine reads the kind"
# An old-root fixture: a snapshot whose reconcile-rollout.py has no ROLE_CALL_ENGINE line (p46-2's marker), as
# 89f5429b175c has none; and this tree, which has it.
OLDROOT="$TMP/snaps/old"; mkdir -p "$OLDROOT/skills/execute/scripts"
printf 'print("an engine before p46-2")\n' > "$OLDROOT/skills/execute/scripts/reconcile-rollout.py"
NEWROOT="$(cd "$HERE/../../.." && pwd)"
ok "$(grep -c '^ROLE_CALL_ENGINE = 1$' "$NEWROOT/skills/execute/scripts/reconcile-rollout.py")" 1 "11g: this tree carries the marker line once"
ronote() {  # ronote <path> <status> <engine root>: a rollout note stamped on that root
  mkdir -p "$(dirname "$1")"
  printf -- '---\ntags: [task, rollout]\nstatus: %s\nprotocol_version: 5\nengine_snapshot: "%s"\nengine_sha: 89f5429b175c0123456789abcdef0123456789ab\n---\n\n## Queue\n\n' \
    "$2" "$3" > "$1"
}
ronote "$TK/rco-r.md" open "$OLDROOT"
bind rco-r o "{\"runId\":\"wf_rco\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rco.json" wf_rco seg1
ok "$(fold --rollout rco-r)" 0 "11g: a live rollout on the old root: exit 0"
ok "$(rc rco-r 'len(L)')" 0 "11g: no role-call written"
ok "$(cj rco-r '[d["status"] for d in L]')" "['completed']" "11g: its call-journal still folds"
ok "$(warns)" 0 "11g: no WARN"
ok "$(grep -c '^no role-call for 1 segment: engine 89f5429b175c reads a role-call line as live (it predates p46-2) (engine-snapshot.md § Cross-version state)$' "$TMP/out")" 1 \
  "11g: one line names why"
ok "$(tail -1 "$TMP/out")" "fold-journals: rco-r: 1 folded, 0 already folded, 0 unchanged, 0 warnings" "11g: the summary stays last"
bind rco-r o2 "{\"runId\":\"wf_rco2\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rco2.json" wf_rco2 seg1
before=$(sha "$(rec rco-r)")
fold --rollout rco-r --dry-run >/dev/null
ok "$(grep -c '^would write role-call' "$TMP/out")" 0 "11g: --dry-run names no role-call either"
ok "$(sha "$(rec rco-r)")" "$before" "11g: and writes nothing"
ok "$(python3 "$SCRIPT" fold-journals --rollout "$TK/rco-r.md" 2>/dev/null | grep -c '^no role-call for 1 segment: engine 89f5429b175c')" 1 \
  "11g: a note path, no --tasks-dir: the gate reads the same note"
ok "$(rc rco-r 'len(L)')" 0 "11g: still no role-call"
echo "== 11g2. the rollout moves to this tree: a resume's segment is written, the segments folded before are lost"
ronote "$TK/rco-r.md" open "$NEWROOT"
rjournal "$W5/wf_rco.json" wf_rco seg2
bind rco-r o "{\"runId\":\"wf_rco\",\"journalDir\":\"$W5\",\"call\":\"task\",\"resumedFrom\":\"wf_rco\"}"
fold --rollout rco-r >/dev/null
ok "$(rc rco-r 'sorted({(d["runId"], d["startTime"]) for d in L})')" "[('wf_rco', 1794000900000)]" \
  "11g2: wf_rco's resumed segment alone; wf_rco2, folded on the old root and never resumed, has none"
ok "$(grep -c '^no role-call' "$TMP/out")" 0 "11g2: no held line"
echo "== 11g3. a finished rollout reads the kind, whatever its root"
ronote "$TK/rcf-r.md" done "$OLDROOT"
bind rcf-r f "{\"runId\":\"wf_rcf\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rcf.json" wf_rcf seg1
fold --rollout rcf-r >/dev/null
ok "$(rc rcf-r 'len(L)')" 4 "11g3: status done on the old root: its role-call lines written"
ronote "$TK/Archive/Rollouts/rca-r.md" open "$OLDROOT"
bind rca-r a "{\"runId\":\"wf_rca\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rca.json" wf_rca seg1
python3 "$SCRIPT" fold-journals --rollout "$TK/Archive/Rollouts/rca-r.md" >/dev/null 2>&1
ok "$(rc rca-r 'len(L)')" 4 "11g3: a note path filed under Archive/Rollouts/ is finished: written"
ronote "$TK/rcm-r.md" open "$TMP/snaps/gone"
bind rcm-r m "{\"runId\":\"wf_rcm\",\"journalDir\":\"$W5\",\"call\":\"task\"}"
rjournal "$W5/wf_rcm.json" wf_rcm seg1
fold --rollout rcm-r >/dev/null
ok "$(rc rcm-r 'len(L)')" 0 "11g3: a live rollout whose snapshot is gone fails closed"
ok "$(grep -c "^no role-call for 1 segment: engine $TMP/snaps/gone unreadable" "$TMP/out")" 1 "11g3: and says so"

[ "$fail" = 0 ] && echo "PASS" || echo "FAILED"
exit "$fail"
