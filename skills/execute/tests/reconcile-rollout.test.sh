#!/usr/bin/env bash
# Unit test for reconcile-rollout.py — runs against temp task notes, no vault/GitHub needed.
# Usage: bash reconcile-rollout.test.sh   (exit 0 = pass)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() {  # check <label> <expected-substring> <file>
  if grep -qF -- "$2" "$3"; then echo "ok   - $1"; else echo "FAIL - $1 (missing: $2)"; fail=1; fi
}
refute() {  # refute <label> <substring> <file>
  if grep -qF -- "$2" "$3"; then echo "FAIL - $1 (unexpected: $2)"; fail=1; else echo "ok   - $1"; fi
}

mknote() {  # mknote <slug> <status>
  cat > "$TMP/$1.md" <<EOF
---
tags:
  - task
status: $2
owner: execute-test
priority: normal
captured: 2026-06-04
---

## Notes

Body of $1.
EOF
}

mknote task-approved in_progress
mknote task-revised in_progress
mknote task-reviewblocked in_progress
mknote task-blocked in_progress
mknote task-planblocked in_progress

cat > "$TMP/result.json" <<EOF
{ "rolloutSlug": "test-rollout", "tasks": [
  { "slug": "task-approved",     "scope": "single-file",  "status": "review",         "prUrl": "https://github.com/o/r/pull/1", "reviewRoundsUsed": 1, "planRoundsUsed": 0 },
  { "slug": "task-revised",      "scope": "cross-cutting","status": "review",         "prUrl": "https://github.com/o/r/pull/2", "reviewRoundsUsed": 3, "planRoundsUsed": 2, "model": "fable", "escalated": true, "escalatedAt": "review" },
  { "slug": "task-reviewblocked","scope": "single-file",  "status": "review-blocked", "prUrl": "https://github.com/o/r/pull/3", "reviewRoundsUsed": 4, "reviewFeedback": ["bound assertion is a no-op", "missed sibling site in foo.py"] },
  { "slug": "task-blocked",      "scope": "single-file",  "status": "blocked",        "prUrl": "", "blockerDiagnosis": "verifier never went green after 3 tries; root cause is an env mismatch.", "model": "fable", "escalated": true, "escalatedAt": "implement" },
  { "slug": "task-planblocked",  "scope": "cross-cutting","status": "plan-blocked",   "prUrl": "", "blockerDiagnosis": "plan not approved after 3 rounds. Accumulated feedback: ..." }
] }
EOF

echo "== reconcile =="
python3 "$SCRIPT" reconcile --result "$TMP/result.json" --tasks-dir "$TMP" || { echo "FAIL - reconcile exited non-zero"; fail=1; }

check "approved: status review"         "status: review"                              "$TMP/task-approved.md"
check "approved: pr unquoted"           "pr: https://github.com/o/r/pull/1"            "$TMP/task-approved.md"
check "approved: review_rounds_used"    "review_rounds_used: 1"                        "$TMP/task-approved.md"
refute "approved: no plan_rounds (0)"   "plan_rounds_used"                             "$TMP/task-approved.md"
check "approved: pr after owner"        "owner: execute-test"                          "$TMP/task-approved.md"

check "revised: status review"          "status: review"                              "$TMP/task-revised.md"
check "revised: review_rounds_used 3"   "review_rounds_used: 3"                        "$TMP/task-revised.md"
check "revised: plan_rounds_used 2"     "plan_rounds_used: 2"                          "$TMP/task-revised.md"
check "revised: escalation stamped on landed task" "model: fable"                     "$TMP/task-revised.md"
refute "approved: no model stamp (not escalated)"  "model:"                           "$TMP/task-approved.md"

check "review-blocked: status"          "status: review-blocked"                       "$TMP/task-reviewblocked.md"
check "review-blocked: pr"              "pr: https://github.com/o/r/pull/3"            "$TMP/task-reviewblocked.md"
check "review-blocked: heading"         "## Review-blocked feedback"                   "$TMP/task-reviewblocked.md"
check "review-blocked: bullet"          "- missed sibling site in foo.py"              "$TMP/task-reviewblocked.md"

check "blocked: status"                 "status: blocked"                              "$TMP/task-blocked.md"
check "blocked: heading"                "## Blocker diagnosis"                         "$TMP/task-blocked.md"
check "blocked: content"                "env mismatch"                                 "$TMP/task-blocked.md"
refute "blocked: no pr written (empty)" "pr:"                                          "$TMP/task-blocked.md"
check "blocked: escalation stamped (re-dispatch starts at fable)" "model: fable"      "$TMP/task-blocked.md"

check "plan-blocked: status"            "status: plan-blocked"                         "$TMP/task-planblocked.md"
check "plan-blocked: heading"           "## Plan-blocked feedback"                     "$TMP/task-planblocked.md"

echo "== idempotency (re-run must not duplicate sections) =="
python3 "$SCRIPT" reconcile --result "$TMP/result.json" --tasks-dir "$TMP" >/dev/null
n=$(grep -c "## Review-blocked feedback" "$TMP/task-reviewblocked.md")
if [ "$n" -eq 1 ]; then echo "ok   - section not duplicated"; else echo "FAIL - section duplicated ($n)"; fail=1; fi
refute "same result: no second run"     "### Run 2 ("                                  "$TMP/task-reviewblocked.md"
refute "same result: no second run (blocked)" "### Run 2 ("                            "$TMP/task-blocked.md"

echo "== mark-done (post-merge review->done flip) =="
# task-approved is marked done first (its merge confirmed elsewhere); mark-done on it is then a no-op.
python3 - "$TMP" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]) / "task-approved.md"
t = p.read_text().replace("status: review", "status: done", 1)
p.write_text(t)
PY
# State here: task-approved=done, task-revised=review, task-blocked=blocked.
python3 "$SCRIPT" mark-done --tasks "task-revised" --tasks-dir "$TMP" || { echo "FAIL - mark-done exit"; fail=1; }
check "review task flipped to done"     "status: done"                                 "$TMP/task-revised.md"
refute "review status gone"             "status: review"                               "$TMP/task-revised.md"
python3 "$SCRIPT" mark-done --tasks "task-approved" --tasks-dir "$TMP" >/dev/null \
  && echo "ok   - already-done is a no-op (exit 0)" || { echo "FAIL - already-done errored"; fail=1; }
if python3 "$SCRIPT" mark-done --tasks "task-blocked" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - blocked task accepted"; fail=1
else echo "ok   - blocked task refused (exit 1)"; fi
check "blocked status untouched"        "status: blocked"                              "$TMP/task-blocked.md"
# Mixed call: the refusal must not stop the valid flip (read-only task at review, no pr).
mknote task-readonly review
if python3 "$SCRIPT" mark-done --tasks "task-readonly,task-planblocked" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - mixed call with a non-review slug exited 0"; fail=1
else echo "ok   - mixed call reports the error (exit 1)"; fi
check "read-only flipped despite mixed" "status: done"                                 "$TMP/task-readonly.md"
check "plan-blocked untouched"          "status: plan-blocked"                         "$TMP/task-planblocked.md"

echo "== status / defer (rollout-scoped, /thread:status + /thread:repair) =="
cat > "$TMP/st-rollout.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 5
---

## Notes
EOF
mklinked() {  # mklinked <slug> <status> <pr-or-empty> [frontmatter line]
  cat > "$TMP/$1.md" <<EOF
---
tags: [task, Demo]
status: $2
rollout: "[[st-rollout]]"
$( [ -n "$3" ] && echo "pr: \"$3\"" )
$( [ -n "${4:-}" ] && echo "$4" )
---

body $1
EOF
}
mklinked st-a  review         "https://github.com/o/r/pull/10"
# st-ro: read-only style (no pr), and it still carries a legacy wave: line that defer strips.
mklinked st-ro review         ""                                  'wave: 1'
mklinked st-b  review-blocked "https://github.com/o/r/pull/11"
printf '\n## Review-blocked feedback\n\n- needs the value supplied out-of-band\n' >> "$TMP/st-b.md"
cat > "$TMP/st-foreign.md" <<EOF
---
tags: [task, Demo]
status: open
rollout: "[[other-rollout]]"
---

nope
EOF

JSON=$(python3 "$SCRIPT" status --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP")
grep -q '"slug": "st-ro"' <<<"$JSON"          && echo "ok   - status: read-only task included" || { echo "FAIL - read-only missing"; fail=1; }
grep -q '"slug": "st-b"' <<<"$JSON"           && echo "ok   - status: blocked task included"   || { echo "FAIL - blocked missing"; fail=1; }
if grep -q '"slug": "st-foreign"' <<<"$JSON"; then echo "FAIL - foreign rollout leaked"; fail=1; else echo "ok   - status: foreign rollout excluded"; fi
grep -q 'supplied out-of-band' <<<"$JSON"     && echo "ok   - status: blockerSummary extracted" || { echo "FAIL - blockerSummary missing"; fail=1; }
echo "$JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['counts']['total'] == 3 and d['counts']['awaitingIntegration'] == 1 and d['counts']['setAside'] == 2, d['counts']
" && echo "ok   - status: counts" || { echo "FAIL - status: counts"; fail=1; }

# defer: pop to backlog (clears rollout:), refuses a cross-rollout note
python3 "$SCRIPT" defer --tasks "st-ro" --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP" || { echo "FAIL - defer exit"; fail=1; }
check  "defer: status open"   "status: open" "$TMP/st-ro.md"
refute "defer: a legacy wave: cleared" "wave:" "$TMP/st-ro.md"
refute "defer: rollout cleared" "rollout:"   "$TMP/st-ro.md"
if python3 "$SCRIPT" defer --tasks "st-foreign" --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - defer accepted a foreign-rollout task"; fail=1
else echo "ok   - defer refuses cross-rollout"; fi

echo "== gated inputs (ADR 0008: gate-pending reconcile + approve-gates sign-off) =="
mknote task-gated in_progress
cat > "$TMP/gate-result.json" <<EOF
{ "rolloutSlug": "test-rollout", "tasks": [
  { "slug": "task-gated", "scope": "cross-cutting", "status": "gate-pending", "prUrl": "",
    "gatedInputs": ["spend: Replicate API — cap USD 30", "credential: PROD_API_KEY (read-only)"],
    "blockerDiagnosis": "gated inputs await human sign-off", "planRoundsUsed": 1 }
] }
EOF
python3 "$SCRIPT" reconcile --result "$TMP/gate-result.json" --tasks-dir "$TMP" || { echo "FAIL - gate reconcile exit"; fail=1; }
check  "gate: status gate-pending"      "status: gate-pending"                       "$TMP/task-gated.md"
check  "gate: pending section written"  "## Gated inputs (awaiting sign-off)"        "$TMP/task-gated.md"
check  "gate: gate bullet carries cap"  "- spend: Replicate API — cap USD 30"        "$TMP/task-gated.md"
refute "gate: no pr written"            "pr:"                                        "$TMP/task-gated.md"

# a refreshed declaration REPLACES the pending section (no duplicates, no stale gates)
cat > "$TMP/gate-result2.json" <<EOF
{ "rolloutSlug": "test-rollout", "tasks": [
  { "slug": "task-gated", "scope": "cross-cutting", "status": "gate-pending", "prUrl": "",
    "gatedInputs": ["spend: Replicate API — cap USD 45"], "blockerDiagnosis": "gated inputs await human sign-off", "planRoundsUsed": 1 }
] }
EOF
python3 "$SCRIPT" reconcile --result "$TMP/gate-result2.json" --tasks-dir "$TMP" >/dev/null || { echo "FAIL - gate reconcile 2 exit"; fail=1; }
check  "gate: refreshed cap present"    "cap USD 45"                                 "$TMP/task-gated.md"
refute "gate: stale cap replaced"       "cap USD 30"                                 "$TMP/task-gated.md"
n=$(grep -c "## Gated inputs (awaiting sign-off)" "$TMP/task-gated.md")
[ "$n" -eq 1 ] && echo "ok   - gate: pending section not duplicated" || { echo "FAIL - pending section duplicated ($n)"; fail=1; }

# approve-gates: pending -> approved (gate + cap + sign-off date), status back to in_progress
python3 "$SCRIPT" approve-gates --tasks "task-gated" --tasks-dir "$TMP" --date 2026-07-18 || { echo "FAIL - approve-gates exit"; fail=1; }
check  "approve: approved section"      "## Approved gates"                          "$TMP/task-gated.md"
check  "approve: gate + cap + sign-off" "- spend: Replicate API — cap USD 45 (approved 2026-07-18)" "$TMP/task-gated.md"
refute "approve: pending section gone"  "awaiting sign-off"                          "$TMP/task-gated.md"
check  "approve: status in_progress"    "status: in_progress"                        "$TMP/task-gated.md"
python3 "$SCRIPT" approve-gates --tasks "task-gated" --tasks-dir "$TMP" >/dev/null \
  && echo "ok   - approve: idempotent re-run (exit 0)" || { echo "FAIL - approve re-run errored"; fail=1; }
if python3 "$SCRIPT" approve-gates --tasks "task-planblocked" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - approve-gates accepted a non-gated note"; fail=1
else echo "ok   - approve-gates refuses non-gate-pending"; fi

echo "== pause / reinstate (status surfaces the pause; clear-pause reinstates) =="
# The drain that stamps `paused:` is `next`'s (reconcile-rollout-queue.test.sh); here the stamp is written
# by hand, as a hard pause writes it.
cat > "$TMP/pz-rollout.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 5
paused: 2026-07-18T10:00+10:00
---

## Notes
EOF

# status surfaces the pause (timestamp set, no pending request)
JSON=$(python3 "$SCRIPT" status --rollout "$TMP/pz-rollout.md" --tasks-dir "$TMP")
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('paused') == '2026-07-18T10:00+10:00' else 1)" \
  && echo "ok   - status: paused surfaced" || { echo "FAIL - status: paused missing"; fail=1; }
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('pause_requested') is False else 1)" \
  && echo "ok   - status: pause_requested false" || { echo "FAIL - status: pause_requested wrong"; fail=1; }

# a pending (not yet honoured) request also surfaces via status
cat > "$TMP/pz-pending.md" <<EOF
---
tags: [task, rollout]
status: open
pause_requested: true
---

## Notes
EOF
JSON=$(python3 "$SCRIPT" status --rollout "$TMP/pz-pending.md" --tasks-dir "$TMP")
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('pause_requested') is True and not d.get('paused') else 1)" \
  && echo "ok   - status: pending request surfaced" || { echo "FAIL - status: pending request missing"; fail=1; }

# clear-pause: reinstate removes the stamp; idempotent on re-run
python3 "$SCRIPT" clear-pause --rollout "$TMP/pz-rollout.md" || { echo "FAIL - clear-pause exit"; fail=1; }
refute "reinstate: paused cleared"           "paused"                 "$TMP/pz-rollout.md"
check  "reinstate: the rest of the note kept" "protocol_version: 5"   "$TMP/pz-rollout.md"
python3 "$SCRIPT" clear-pause --rollout "$TMP/pz-rollout.md" >/dev/null \
  && echo "ok   - reinstate: idempotent (exit 0)" || { echo "FAIL - reinstate: second run errored"; fail=1; }
# clear-pause also clears a pending request (hard-pause-before-honour edge)
python3 "$SCRIPT" clear-pause --rollout "$TMP/pz-pending.md" >/dev/null || { echo "FAIL - clear-pause pending exit"; fail=1; }
refute "reinstate: pending request cleared"  "pause_requested"        "$TMP/pz-pending.md"

# the retired verbs are gone with no alias (ADR 0030: no stored cursor; resolve and resume-filter lost their
# last skill reader with the queue)
for verb in cursor mark-dispatched resolve resume-filter; do
  out=$(python3 "$SCRIPT" "$verb" --tasks task-blocked --tasks-dir "$TMP" 2>&1); rc=$?
  if [ "$rc" -ne 0 ] && grep -q "invalid choice" <<<"$out"; then echo "ok   - no $verb verb"
  else echo "FAIL - the $verb verb still exists (rc $rc)"; fail=1; fi
done

echo "== review-loop memory (ceiling approvals auditable; review-blocked carries full history) =="
# (the task-reviewblocked case above, whose result has NO reviewHistory, already proves the legacy
# fallback to final-round reviewFeedback bullets — pre-2.0.3 engine results stay reconcilable)
mknote task-ceiling in_progress
mknote task-easyland in_progress
mknote task-histblocked in_progress
cat > "$TMP/mem-result.json" <<EOF
{ "rolloutSlug": "test-rollout", "tasks": [
  { "slug": "task-ceiling", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/20",
    "reviewRoundsUsed": 3, "planRoundsUsed": 0, "approvedAtCeiling": true,
    "reviewHistory": [ { "round": 1, "feedback": ["tighten the null guard"] }, { "round": 2, "feedback": ["cover the empty-list case"] } ] },
  { "slug": "task-easyland", "scope": "single-file", "status": "review", "prUrl": "https://github.com/o/r/pull/21",
    "reviewRoundsUsed": 2, "planRoundsUsed": 0, "approvedAtCeiling": false,
    "reviewHistory": [ { "round": 1, "feedback": ["rename the helper"] } ] },
  { "slug": "task-histblocked", "scope": "single-file", "status": "review-blocked", "prUrl": "https://github.com/o/r/pull/22",
    "reviewRoundsUsed": 2, "reviewFeedback": ["final-round bullet"],
    "reviewHistory": [ { "round": 1, "feedback": ["first-round bullet"] }, { "round": 2, "feedback": ["final-round bullet"] } ] }
] }
EOF
python3 "$SCRIPT" reconcile --result "$TMP/mem-result.json" --tasks-dir "$TMP" || { echo "FAIL - memory reconcile exit"; fail=1; }
check  "ceiling: history section written"   "## Review history (approved at ceiling)" "$TMP/task-ceiling.md"
check  "ceiling: rounds grouped"            "Round 1:"                                "$TMP/task-ceiling.md"
check  "ceiling: round-2 bullet"            "- cover the empty-list case"             "$TMP/task-ceiling.md"
check  "ceiling: review_rounds_used"        "review_rounds_used: 3"                   "$TMP/task-ceiling.md"
refute "non-ceiling: no history section"    "## Review history"                       "$TMP/task-easyland.md"
check  "non-ceiling: still lands clean"     "status: review"                          "$TMP/task-easyland.md"
check  "hist-blocked: heading"              "## Review-blocked feedback"              "$TMP/task-histblocked.md"
check  "hist-blocked: earlier round kept"   "- first-round bullet"                    "$TMP/task-histblocked.md"
check  "hist-blocked: grouped by round"     "Round 2:"                                "$TMP/task-histblocked.md"
python3 "$SCRIPT" reconcile --result "$TMP/mem-result.json" --tasks-dir "$TMP" >/dev/null || { echo "FAIL - memory re-reconcile exit"; fail=1; }
n=$(grep -c "## Review history (approved at ceiling)" "$TMP/task-ceiling.md")
[ "$n" -eq 1 ] && echo "ok   - ceiling: history section not duplicated on re-run" || { echo "FAIL - ceiling section duplicated ($n)"; fail=1; }

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fail=1; fi
exit $fail
