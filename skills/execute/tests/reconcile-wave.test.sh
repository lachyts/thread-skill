#!/usr/bin/env bash
# Unit test for reconcile-wave.py — runs against temp task notes, no vault/GitHub needed.
# Usage: bash reconcile-wave.test.sh   (exit 0 = pass)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-wave.py"
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
owner: wave-execute-test
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

cat > "$TMP/rollout.md" <<EOF
---
tags:
  - task
  - rollout
status: open
protocol_version: 3
parallel_ceiling: 4
merged_through_wave: 0
---

## Notes
EOF

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
check "approved: pr after owner"        "owner: wave-execute-test"                     "$TMP/task-approved.md"

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

echo "== cursor =="
python3 "$SCRIPT" cursor --rollout "$TMP/rollout.md" --wave 2 || { echo "FAIL - cursor exit"; fail=1; }
check "cursor advanced"                 "merged_through_wave: 2"                       "$TMP/rollout.md"
refute "cursor: old value gone"         "merged_through_wave: 0"                       "$TMP/rollout.md"

echo "== resume-filter (#7: landed tasks excluded) =="
# task-approved is now status: review (landed); mark one done; the blocked ones must come back.
python3 - "$TMP" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]) / "task-approved.md"
t = p.read_text().replace("status: review", "status: done", 1)
p.write_text(t)
PY
OUT=$(python3 "$SCRIPT" resume-filter --tasks "task-approved,task-revised,task-blocked,task-planblocked" --tasks-dir "$TMP")
echo "$OUT" | grep -qx "task-blocked"      && echo "ok   - blocked re-dispatched"      || { echo "FAIL - blocked missing"; fail=1; }
echo "$OUT" | grep -qx "task-planblocked"  && echo "ok   - plan-blocked re-dispatched" || { echo "FAIL - plan-blocked missing"; fail=1; }
if echo "$OUT" | grep -qx "task-approved"; then echo "FAIL - done task re-dispatched"; fail=1; else echo "ok   - done task excluded"; fi
if echo "$OUT" | grep -qx "task-revised"; then echo "FAIL - review task re-dispatched"; fail=1; else echo "ok   - review task excluded"; fi

echo "== mark-done (post-merge review->done flip) =="
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

echo "== status / resolve / defer (rollout-scoped, /wave:status + /wave:repair) =="
cat > "$TMP/st-rollout.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 3
merged_through_wave: 1
---

## Notes
EOF
mklinked() {  # mklinked <slug> <status> <wave> <pr-or-empty>
  cat > "$TMP/$1.md" <<EOF
---
tags: [task, Demo]
status: $2
wave: $3
rollout: "[[st-rollout]]"
$( [ -n "$4" ] && echo "pr: \"$4\"" )
---

body $1
EOF
}
mklinked st-a  review         1 "https://github.com/o/r/pull/10"
mklinked st-ro review         1 ""                                  # read-only style, no pr
mklinked st-b  review-blocked 2 "https://github.com/o/r/pull/11"
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
echo "$JSON" | grep -q '"merged_through_wave": 1' && echo "ok   - status: cursor read"             || { echo "FAIL - status cursor"; fail=1; }
echo "$JSON" | grep -q '"slug": "st-ro"'          && echo "ok   - status: read-only task included" || { echo "FAIL - read-only missing"; fail=1; }
echo "$JSON" | grep -q '"slug": "st-b"'           && echo "ok   - status: blocked task included"   || { echo "FAIL - blocked missing"; fail=1; }
if echo "$JSON" | grep -q '"slug": "st-foreign"'; then echo "FAIL - foreign rollout leaked"; fail=1; else echo "ok   - status: foreign rollout excluded"; fi
echo "$JSON" | grep -q 'supplied out-of-band'     && echo "ok   - status: blockerSummary extracted" || { echo "FAIL - blockerSummary missing"; fail=1; }
echo "$JSON" | grep -q '"total_waves": 2'         && echo "ok   - status: total_waves computed"     || { echo "FAIL - total_waves"; fail=1; }

# resolve: drift gap-closer (blocked -> done), refuses a non-blocked note
python3 "$SCRIPT" resolve --tasks "st-b" --tasks-dir "$TMP" || { echo "FAIL - resolve exit"; fail=1; }
check  "resolve: review-blocked -> done" "status: done"   "$TMP/st-b.md"
if python3 "$SCRIPT" resolve --tasks "st-a" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - resolve accepted a review task"; fail=1
else echo "ok   - resolve refuses non-blocked (review)"; fi
check  "resolve: review task untouched"  "status: review" "$TMP/st-a.md"

# defer: pop to backlog (clears wave/rollout), refuses a cross-rollout note
python3 "$SCRIPT" defer --tasks "st-ro" --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP" || { echo "FAIL - defer exit"; fail=1; }
check  "defer: status open"   "status: open" "$TMP/st-ro.md"
refute "defer: wave cleared"    "wave:"      "$TMP/st-ro.md"
refute "defer: rollout cleared" "rollout:"   "$TMP/st-ro.md"
if python3 "$SCRIPT" defer --tasks "st-foreign" --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - defer accepted a foreign-rollout task"; fail=1
else echo "ok   - defer refuses cross-rollout"; fi

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fail=1; fi
exit $fail
