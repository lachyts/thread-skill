#!/usr/bin/env bash
# fold-journals (p15-3): the rollout's Workflow journals fold into its Run record as call-journal lines,
# through run_record.emit (ADR 0032). The record's run-bound lines name each call's runId and journal dir;
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
fold() { python3 "$SCRIPT" fold-journals "$@" 2>"$TMP/err" >"$TMP/out"; echo $?; }
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

[ "$fail" = 0 ] && echo "PASS" || echo "FAILED"
exit "$fail"
