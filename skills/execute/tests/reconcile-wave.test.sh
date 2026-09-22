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

echo "== status / resolve / defer (rollout-scoped, /thread:status + /thread:repair) =="
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

# resume-filter must NOT auto-redispatch a task awaiting human sign-off (nothing may bypass the gate)
OUT=$(python3 "$SCRIPT" resume-filter --tasks "task-gated,task-blocked" --tasks-dir "$TMP" 2>/dev/null)
if echo "$OUT" | grep -qx "task-gated"; then echo "FAIL - gate-pending re-dispatched"; fail=1; else echo "ok   - gate-pending excluded from resume"; fi
echo "$OUT" | grep -qx "task-blocked" && echo "ok   - blocked still re-dispatched alongside" || { echo "FAIL - blocked missing (gate arm)"; fail=1; }

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
OUT=$(python3 "$SCRIPT" resume-filter --tasks "task-gated" --tasks-dir "$TMP")
echo "$OUT" | grep -qx "task-gated" && echo "ok   - approved task re-dispatchable" || { echo "FAIL - approved task still excluded"; fail=1; }
if python3 "$SCRIPT" approve-gates --tasks "task-planblocked" --tasks-dir "$TMP" >/dev/null 2>&1; then
  echo "FAIL - approve-gates accepted a non-gated note"; fail=1
else echo "ok   - approve-gates refuses non-gate-pending"; fi

echo "== pause / reinstate (soft pause honoured at the cursor step; clear-pause reinstates) =="
cat > "$TMP/pz-rollout.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 3
merged_through_wave: 1
pause_requested: true
---

## Notes
EOF
CUROUT=$(python3 "$SCRIPT" cursor --rollout "$TMP/pz-rollout.md" --wave 2) || { echo "FAIL - pause cursor exit"; fail=1; }
check  "pause: cursor still advances"        "merged_through_wave: 2" "$TMP/pz-rollout.md"
check  "pause: paused stamp written"         "paused: "               "$TMP/pz-rollout.md"
refute "pause: pause_requested cleared"      "pause_requested"        "$TMP/pz-rollout.md"
echo "$CUROUT" | grep -q "paused=" && echo "ok   - pause: cursor output signals the pause" \
  || { echo "FAIL - pause: no paused= line in cursor output"; fail=1; }

# no pending request → cursor must NOT stamp or signal anything (byte-stable default path)
cat > "$TMP/pz-plain.md" <<EOF
---
tags: [task, rollout]
status: open
merged_through_wave: 0
---

## Notes
EOF
CUROUT=$(python3 "$SCRIPT" cursor --rollout "$TMP/pz-plain.md" --wave 1) || { echo "FAIL - plain cursor exit"; fail=1; }
refute "no request: nothing stamped"         "paused"                 "$TMP/pz-plain.md"
if echo "$CUROUT" | grep -q "paused="; then echo "FAIL - no request: spurious paused= output"; fail=1
else echo "ok   - no request: no pause signal"; fi

# status surfaces the honoured pause (timestamp set, no pending request)
JSON=$(python3 "$SCRIPT" status --rollout "$TMP/pz-rollout.md" --tasks-dir "$TMP")
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('paused') else 1)" \
  && echo "ok   - status: paused surfaced" || { echo "FAIL - status: paused missing"; fail=1; }
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('pause_requested') is False else 1)" \
  && echo "ok   - status: pause_requested false after honour" || { echo "FAIL - status: pause_requested wrong"; fail=1; }

# a pending (not yet honoured) request also surfaces via status
cat > "$TMP/pz-pending.md" <<EOF
---
tags: [task, rollout]
status: open
merged_through_wave: 0
pause_requested: true
---

## Notes
EOF
JSON=$(python3 "$SCRIPT" status --rollout "$TMP/pz-pending.md" --tasks-dir "$TMP")
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('pause_requested') is True and not d.get('paused') else 1)" \
  && echo "ok   - status: pending request surfaced" || { echo "FAIL - status: pending request missing"; fail=1; }

# clear-pause: reinstate removes the stamp (cursor untouched); idempotent on re-run
python3 "$SCRIPT" clear-pause --rollout "$TMP/pz-rollout.md" || { echo "FAIL - clear-pause exit"; fail=1; }
refute "reinstate: paused cleared"           "paused"                 "$TMP/pz-rollout.md"
check  "reinstate: cursor untouched"         "merged_through_wave: 2" "$TMP/pz-rollout.md"
python3 "$SCRIPT" clear-pause --rollout "$TMP/pz-rollout.md" >/dev/null \
  && echo "ok   - reinstate: idempotent (exit 0)" || { echo "FAIL - reinstate: second run errored"; fail=1; }
# clear-pause also clears a pending request (hard-pause-before-honour edge)
python3 "$SCRIPT" clear-pause --rollout "$TMP/pz-pending.md" >/dev/null || { echo "FAIL - clear-pause pending exit"; fail=1; }
refute "reinstate: pending request cleared"  "pause_requested"        "$TMP/pz-pending.md"

# the `reconcile --wave` convenience arm honours the flag too (cmd_reconcile -> _set_cursor ->
# _print_pause_honoured) — the OTHER cursor call site, must behave exactly like the standalone subcommand
cat > "$TMP/pz-conv.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 3
merged_through_wave: 2
pause_requested: true
---

## Notes
EOF
mknote pz-conv-task in_progress
cat > "$TMP/pz-conv-result.json" <<EOF
{ "rolloutSlug": "pz-conv", "tasks": [
  { "slug": "pz-conv-task", "scope": "single-file", "status": "review", "prUrl": "https://github.com/o/r/pull/12", "reviewRoundsUsed": 1, "planRoundsUsed": 0 }
] }
EOF
RECOUT=$(python3 "$SCRIPT" reconcile --result "$TMP/pz-conv-result.json" --tasks-dir "$TMP" --rollout "$TMP/pz-conv.md" --wave 3) \
  || { echo "FAIL - reconcile --wave pause exit"; fail=1; }
check  "reconcile --wave: task reconciled"         "status: review"         "$TMP/pz-conv-task.md"
check  "reconcile --wave: cursor advanced"         "merged_through_wave: 3" "$TMP/pz-conv.md"
check  "reconcile --wave: paused stamp written"    "paused: "               "$TMP/pz-conv.md"
refute "reconcile --wave: pause_requested cleared" "pause_requested"        "$TMP/pz-conv.md"
echo "$RECOUT" | grep -q "paused=" && echo "ok   - reconcile --wave: output signals the pause" \
  || { echo "FAIL - reconcile --wave: no paused= line in output"; fail=1; }

# wave-0 pause honour (SKILL §4.5 step 4: pause pending on a partially-landed wave 1 → cursor
# re-run with --wave 0): wave 0 was never dispatched or merged, so the cursor must NOT write a
# junk wave_0_merged stamp or claim "wave 0 merged" progress — but the paused= signal still fires
cat > "$TMP/pz-w0.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 3
merged_through_wave: 0
pause_requested: true
wave_1_dispatched: 2026-07-18T10:00:00+10:00
---

## Notes
EOF
CUROUT=$(python3 "$SCRIPT" cursor --rollout "$TMP/pz-w0.md" --wave 0 --tasks-dir "$TMP") \
  || { echo "FAIL - wave-0 cursor exit"; fail=1; }
refute "wave-0: no junk wave_0_merged stamp" "wave_0_merged"  "$TMP/pz-w0.md"
if echo "$CUROUT" | grep -q "progress:"; then echo "FAIL - wave-0: false progress claim: $CUROUT"; fail=1
else echo "ok   - wave-0: no progress line (nothing merged)"; fi
echo "$CUROUT" | grep -q "paused=" && echo "ok   - wave-0: paused= signal still fires" \
  || { echo "FAIL - wave-0: paused= signal missing: $CUROUT"; fail=1; }
check  "wave-0: paused stamp written"        "paused: "        "$TMP/pz-w0.md"
refute "wave-0: pause_requested cleared"     "pause_requested" "$TMP/pz-w0.md"

echo "== progress / ETA (wave-boundary timestamps: mark-dispatched + cursor stamps, rough estimate) =="
cat > "$TMP/eta-rollout.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 3
parallel_ceiling: 2
merged_through_wave: 0
---

## Notes
EOF
mketa() {  # mketa <slug> <wave> — a task linked to eta-rollout (drives per-wave task counts)
  cat > "$TMP/$1.md" <<EOF
---
tags: [task, Demo]
status: in_progress
wave: $2
rollout: "[[eta-rollout]]"
---

body $1
EOF
}
mketa eta-t1a 1; mketa eta-t1b 1; mketa eta-t2a 2; mketa eta-t2b 2; mketa eta-t3a 3

# mark-dispatched stamps the launch boundary and prints a progress line (no estimate yet — no basis)
OUT=$(python3 "$SCRIPT" mark-dispatched --rollout "$TMP/eta-rollout.md" --wave 1 --tasks-dir "$TMP") \
  || { echo "FAIL - mark-dispatched exit"; fail=1; }
check "eta: wave_1_dispatched stamped"  "wave_1_dispatched: "  "$TMP/eta-rollout.md"
echo "$OUT" | grep -q "wave 1/3 dispatched" && echo "ok   - eta: dispatch progress line (wave 1/3)" \
  || { echo "FAIL - eta: dispatch progress line missing: $OUT"; fail=1; }
if echo "$OUT" | grep -q "remaining"; then echo "FAIL - eta: estimate offered with no completed wave"; fail=1
else echo "ok   - eta: no estimate before any completed wave (elapsed only)"; fi

# first dispatch wins: a resume re-dispatch must NOT reset the wave clock
python3 - "$TMP" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]) / "eta-rollout.md"
p.write_text(re.sub(r"wave_1_dispatched: .*", "wave_1_dispatched: 2026-07-18T10:00:00+10:00", p.read_text()))
PY
python3 "$SCRIPT" mark-dispatched --rollout "$TMP/eta-rollout.md" --wave 1 --tasks-dir "$TMP" >/dev/null \
  || { echo "FAIL - mark-dispatched re-run exit"; fail=1; }
check "eta: re-dispatch keeps the first stamp" "wave_1_dispatched: 2026-07-18T10:00:00+10:00" "$TMP/eta-rollout.md"

# hand-complete wave 1 with a known 30m duration so the estimate arithmetic is deterministic:
# 2 tasks / ceiling 2 = 1 chunk -> avg task 30m; remaining waves 2+3 = 2 chunks -> ~1h
python3 - "$TMP" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "eta-rollout.md"
t = p.read_text().replace("merged_through_wave: 0", "merged_through_wave: 1")
t = t.replace("wave_1_dispatched: 2026-07-18T10:00:00+10:00",
              "wave_1_dispatched: 2026-07-18T10:00:00+10:00\nwave_1_merged: 2026-07-18T10:30:00+10:00")
p.write_text(t)
PY
OUT=$(python3 "$SCRIPT" mark-dispatched --rollout "$TMP/eta-rollout.md" --wave 2 --tasks-dir "$TMP") \
  || { echo "FAIL - mark-dispatched w2 exit"; fail=1; }
check "eta: wave_2_dispatched stamped"  "wave_2_dispatched: "  "$TMP/eta-rollout.md"
echo "$OUT" | grep -q "wave 2/3 dispatched" && echo "ok   - eta: w2 dispatch progress line" \
  || { echo "FAIL - eta: w2 dispatch line missing: $OUT"; fail=1; }
echo "$OUT" | grep -q "elapsed" && echo "ok   - eta: elapsed rendered" \
  || { echo "FAIL - eta: no elapsed in: $OUT"; fail=1; }
echo "$OUT" | grep -q -- "~1h remaining (rough)" && echo "ok   - eta: rough estimate (~1h, labelled rough)" \
  || { echo "FAIL - eta: estimate missing/unlabelled: $OUT"; fail=1; }

# cursor stamps the merge boundary and prints the merged progress line
OUT=$(python3 "$SCRIPT" cursor --rollout "$TMP/eta-rollout.md" --wave 2 --tasks-dir "$TMP") \
  || { echo "FAIL - eta cursor exit"; fail=1; }
check "eta: wave_2_merged stamped"      "wave_2_merged: "      "$TMP/eta-rollout.md"
echo "$OUT" | grep -q "wave 2/3 merged" && echo "ok   - eta: merged progress line" \
  || { echo "FAIL - eta: merged line missing: $OUT"; fail=1; }
echo "$OUT" | grep -q "remaining (rough)" && echo "ok   - eta: merged line carries the rough estimate" \
  || { echo "FAIL - eta: merged estimate missing: $OUT"; fail=1; }
# cursor re-run keeps the first merge stamp (no duplicate, no rewrite)
python3 "$SCRIPT" cursor --rollout "$TMP/eta-rollout.md" --wave 2 --tasks-dir "$TMP" >/dev/null \
  || { echo "FAIL - eta cursor re-run exit"; fail=1; }
n=$(grep -c "wave_2_merged" "$TMP/eta-rollout.md")
[ "$n" -eq 1 ] && echo "ok   - eta: merge stamp not duplicated on re-run" \
  || { echo "FAIL - eta: merge stamp duplicated ($n)"; fail=1; }

# status renders the timeline durably from the note (no run alive)
JSON=$(python3 "$SCRIPT" status --rollout "$TMP/eta-rollout.md" --tasks-dir "$TMP")
echo "$JSON" | python3 -c "
import json, sys
tl = json.load(sys.stdin).get('timeline')
assert tl, 'timeline missing'
w1 = [w for w in tl['waves'] if w['wave'] == 1][0]
assert w1['durationMinutes'] == 30, w1
assert w1['tasks'] == 2, w1
assert tl['totalWaves'] == 3, tl
assert tl['elapsedMinutes'] and tl['elapsedMinutes'] > 0, tl
assert tl['avgTaskMinutes'] is not None, tl
assert tl['remainingEstimateMinutes'] and tl['remainingEstimateMinutes'] > 0, tl
assert tl['remainingLabel'].startswith('~') and 'rough' in tl['remainingLabel'], tl
" && echo "ok   - eta: status timeline (duration/elapsed/rough estimate)" \
  || { echo "FAIL - eta: status timeline wrong"; fail=1; }

# a rollout with no stamps reports timeline null (pre-feature rollouts stay renderable)
JSON=$(python3 "$SCRIPT" status --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP")
echo "$JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('timeline') is None else 1)" \
  && echo "ok   - eta: stampless rollout -> timeline null" \
  || { echo "FAIL - eta: stampless rollout timeline not null"; fail=1; }

# a stampless cursor stays byte-stable: no progress line without a dispatch anchor
OUT=$(python3 "$SCRIPT" cursor --rollout "$TMP/rollout.md" --wave 3 --tasks-dir "$TMP") || { echo "FAIL - stampless cursor exit"; fail=1; }
if echo "$OUT" | grep -q "progress:"; then echo "FAIL - stampless cursor emitted a progress line"; fail=1
else echo "ok   - eta: no progress line without a dispatch stamp"; fi

# the reconcile --wave convenience arm (the OTHER cursor call site) stamps + reports completion
cat > "$TMP/eta-result.json" <<EOF
{ "rolloutSlug": "eta-rollout", "tasks": [] }
EOF
RECOUT=$(python3 "$SCRIPT" reconcile --result "$TMP/eta-result.json" --tasks-dir "$TMP" --rollout "$TMP/eta-rollout.md" --wave 3) \
  || { echo "FAIL - eta reconcile --wave exit"; fail=1; }
check "eta: wave_3_merged stamped via reconcile --wave" "wave_3_merged: " "$TMP/eta-rollout.md"
echo "$RECOUT" | grep -q "rollout complete in" && echo "ok   - eta: final wave reports total duration" \
  || { echo "FAIL - eta: completion line missing: $RECOUT"; fail=1; }

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


echo "== reconciliation safety regressions =="
python3 - "$SCRIPT" "$TMP" <<'PYTEST' || fail=1
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT, ROOT = sys.argv[1:]
sys.argv = [sys.argv[0]]

class ReconciliationSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT)
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.note = self.root / 'task.md'
        self.note.write_text('---\nstatus: in_progress\nrollout: "[[rollout]]"\nwave: 1\n---\n\nBody.\n')
        (self.root / 'rollout.md').write_text('---\nstatus: open\nprotocol_version: 3\n---\n')

    def cli(self, *args):
        return subprocess.run([sys.executable, SCRIPT, *args, '--tasks-dir', str(self.root)],
                              text=True, capture_output=True)

    def reconcile(self, status='blocked', generation=None, attempt='attempt-1', run='run-1', **fields):
        task = {'slug': 'task', 'status': status, **fields}
        data = {'rolloutSlug': 'rollout', 'tasks': [task]}
        if generation is not None:
            data.update(runId=run, attemptId=attempt, generation=generation)
        path = self.root / 'result.json'
        path.write_text(json.dumps(data))
        return self.cli('reconcile', '--result', str(path))

    def accepted(self, **kwargs):
        result = self.reconcile(**kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.note.read_text()

    def test_resume_parses_quoted_statuses_and_inline_comments(self):
        for value in ['"gate-pending"', "'gate-pending' # awaiting sign-off", '"done"', "'review'", '"merged" # landed']:
            with self.subTest(value=value):
                self.note.write_text(f'---\nstatus: {value}\n---\n')
                result = self.cli('resume-filter', '--tasks', 'task')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), '')

    def test_blocked_and_gated_results_keep_their_pr(self):
        for status in ['blocked', 'plan-blocked', 'gate-pending']:
            with self.subTest(status=status):
                text = self.accepted(status=status, prUrl='https://github.com/o/r/pull/44')
                self.assertIn('pr: https://github.com/o/r/pull/44', text)

    def test_quoted_rollout_with_comment_accepts_its_own_result(self):
        self.note.write_text('---\nstatus: in_progress\nrollout: "[[rollout]]" # current\n---\n')
        self.accepted(generation=1, blockerDiagnosis='owned by current rollout')

    def test_deferred_task_is_excluded_from_stale_resume_list(self):
        result = self.cli('defer', '--tasks', 'task', '--rollout', str(self.root / 'rollout.md'))
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.cli('resume-filter', '--tasks', 'task')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '')

    def test_explicit_rescheduling_keeps_ordering_and_allows_new_result(self):
        self.accepted(generation=1, blockerDiagnosis='old diagnosis')
        result = self.cli('defer', '--tasks', 'task', '--rollout', str(self.root / 'rollout.md'))
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.note.read_bytes()
        args = ['reschedule', '--tasks', 'task', '--rollout', str(self.root / 'rollout.md'), '--wave', '2']
        result = self.cli(*args, '--dry-run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.note.read_bytes(), before)
        result = self.cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = self.note.read_text()
        self.assertNotIn('reconcile_deferred:', text)
        self.assertIn('reconcile_generation: 1', text)
        self.assertIn('wave: 2', text)
        self.assertIn('rollout: "[[rollout]]"', text)
        self.assertIn('status: open', text)
        before = self.note.read_bytes()
        self.assertEqual(self.cli(*args).returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)
        result = self.accepted(generation=2, attempt='attempt-2', blockerDiagnosis='rescheduled diagnosis')
        self.assertIn('rescheduled diagnosis', result)
        self.assertIn('old diagnosis', result)

    def test_reschedule_requires_a_real_rollout_and_positive_wave(self):
        self.cli('defer', '--tasks', 'task', '--rollout', str(self.root / 'rollout.md'))
        before = self.note.read_bytes()
        (self.root / 'rollout-v4.md').write_text('---\nstatus: open\nprotocol_version: 4\n---\n')
        for rollout, wave in [('missing.md', '1'), ('rollout.md', '0'), ('rollout.md', '-1'), ('rollout-v4.md', '1')]:
            with self.subTest(rollout=rollout, wave=wave):
                result = self.cli('reschedule', '--tasks', 'task', '--rollout', str(self.root / rollout), '--wave', wave)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.note.read_bytes(), before)

    def test_reschedule_refuses_non_open_or_unmarked_tasks_and_foreign_membership(self):
        fixtures = ['status: done\nreconcile_deferred: true',
                    'status: in_progress\nreconcile_deferred: true',
                    'status: open',
                    'status: open\nreconcile_deferred: true\nrollout: "[[other-rollout]]"']
        for fields in fixtures:
            with self.subTest(fields=fields):
                self.note.write_text(f'---\n{fields}\n---\n')
                before = self.note.read_bytes()
                result = self.cli('reschedule', '--tasks', 'task', '--rollout', str(self.root / 'rollout.md'), '--wave', '1')
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.note.read_bytes(), before)

    def test_cli_identity_can_upgrade_existing_v3_without_rewriting_protocol(self):
        self.accepted(blockerDiagnosis='legacy diagnosis')
        path = self.root / 'result.json'
        path.write_text(json.dumps({'rolloutSlug': 'rollout', 'tasks': [
            {'slug': 'task', 'status': 'blocked', 'blockerDiagnosis': 'ordered diagnosis'}]}))
        args = ['reconcile', '--result', str(path), '--run-id', 'run-cli', '--attempt-id', 'retry-cli', '--generation', '1']
        result = self.cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.note.read_bytes()
        self.assertIn(b'ordered diagnosis', before)
        self.assertIn('protocol_version: 3', (self.root / 'rollout.md').read_text())
        self.assertEqual(self.cli(*args).returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)

    def test_ambiguous_identity_does_not_advance_cursor(self):
        self.accepted(generation=2, blockerDiagnosis='latest diagnosis')
        path = self.root / 'result.json'
        path.write_text(json.dumps({'runId': 'old-run', 'generation': 1, 'rolloutSlug': 'rollout', 'tasks': [
            {'slug': 'task', 'status': 'review'}]}))
        before = (self.root / 'rollout.md').read_bytes()
        result = self.cli('reconcile', '--result', str(path), '--wave', '1', '--rollout', str(self.root / 'rollout.md'))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / 'rollout.md').read_bytes(), before)

    def test_legacy_changed_feedback_is_preserved_and_replays_are_idempotent(self):
        self.accepted(blockerDiagnosis='first diagnosis')
        second = self.accepted(blockerDiagnosis='second diagnosis')
        self.assertIn('first diagnosis', second)
        self.assertIn('second diagnosis', second)
        self.assertEqual(second.count('## Blocker diagnosis'), 1)
        self.assertEqual(self.accepted(blockerDiagnosis='second diagnosis'), second)
        self.assertEqual(self.accepted(blockerDiagnosis='first diagnosis'), second)

    def test_legacy_same_payload_retry_restores_blocked_status_after_dispatch_stamp(self):
        for status, feedback in [('blocked', {'blockerDiagnosis':'unchanged transient diagnosis'}),
                                 ('plan-blocked', {'blockerDiagnosis':'unchanged planning diagnosis'}),
                                 ('review-blocked', {'reviewFeedback':['unchanged review diagnosis']})]:
            with self.subTest(status=status):
                self.note.write_text('---\nstatus: in_progress\nrollout: "[[rollout]]"\n---\n')
                self.accepted(status=status, **feedback)
                self.note.write_text(self.note.read_text().replace(f'status: {status}', 'status: in_progress'))
                retried = self.accepted(status=status, **feedback)
                self.assertIn(f'status: {status}\n', retried)
                diagnosis = feedback.get('blockerDiagnosis') or feedback['reviewFeedback'][0]
                self.assertEqual(retried.count(diagnosis), 1)

    def test_identified_replay_does_not_rewrite_a_new_dispatch_status(self):
        self.accepted(generation=1, blockerDiagnosis='accepted diagnosis')
        self.note.write_text(self.note.read_text().replace('status: blocked', 'status: in_progress'))
        before = self.note.read_bytes()
        self.accepted(generation=1, blockerDiagnosis='accepted diagnosis')
        self.assertEqual(self.note.read_bytes(), before)

    def test_legacy_replay_cannot_reopen_terminal_task_or_approved_gate(self):
        self.accepted(blockerDiagnosis='already resolved diagnosis')
        self.note.write_text(self.note.read_text().replace('status: blocked', 'status: done'))
        before = self.note.read_bytes()
        self.accepted(blockerDiagnosis='already resolved diagnosis')
        self.assertEqual(self.note.read_bytes(), before)
        self.note.write_text('---\nstatus: in_progress\nrollout: "[[rollout]]"\n---\n')
        self.accepted(status='gate-pending', gatedInputs=['spend: cap AUD 10'])
        result = self.cli('approve-gates', '--tasks', 'task')
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.note.read_bytes()
        self.accepted(status='gate-pending', gatedInputs=['spend: cap AUD 10'])
        self.assertEqual(self.note.read_bytes(), before)

    def test_distinct_attempts_keep_even_identical_feedback(self):
        self.accepted(generation=1, blockerDiagnosis='still failing')
        text = self.accepted(generation=2, attempt='attempt-2', blockerDiagnosis='still failing')
        self.assertEqual(text.count('still failing'), 2)
        self.assertEqual(text.count('## Blocker diagnosis'), 1)
        self.assertEqual(self.accepted(generation=2, attempt='attempt-2', blockerDiagnosis='still failing'), text)

    def test_review_history_is_appended_for_each_distinct_result(self):
        self.accepted(status='review-blocked', generation=1, reviewHistory=[{'round': 1, 'feedback': ['first issue']}])
        text = self.accepted(status='review-blocked', generation=2, attempt='attempt-2',
                             reviewHistory=[{'round': 1, 'feedback': ['second issue']}])
        self.assertIn('- first issue', text)
        self.assertIn('- second issue', text)

    def test_stale_ordered_delivery_cannot_overwrite_newer_result(self):
        self.accepted(generation=3, blockerDiagnosis='current diagnosis', prUrl='https://github.com/o/r/pull/50')
        before = self.note.read_bytes()
        result = self.reconcile(status='review', generation=2, prUrl='https://github.com/o/r/pull/49')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)

    def test_generation_collision_is_rejected_without_losing_feedback(self):
        self.accepted(generation=1, blockerDiagnosis='current diagnosis')
        before = self.note.read_bytes()
        result = self.reconcile(generation=1, blockerDiagnosis='new feedback with ambiguous order')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)
        self.assertIn('generation', result.stderr)

    def test_legacy_result_cannot_overwrite_identity_bearing_state(self):
        self.accepted(generation=1, blockerDiagnosis='identified diagnosis')
        before = self.note.read_bytes()
        result = self.reconcile(blockerDiagnosis='unidentified late delivery')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)

    def test_partial_identity_fails_closed(self):
        path = self.root / 'result.json'
        path.write_text(json.dumps({'runId': 'run-1', 'tasks': [{'slug': 'task', 'status': 'blocked'}]}))
        before = self.note.read_bytes()
        result = self.cli('reconcile', '--result', str(path))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)

    def test_terminal_status_cannot_be_reopened(self):
        for value in ['done', '"done"', 'merged', 'deferred']:
            with self.subTest(value=value):
                self.note.write_text(f'---\nstatus: {value}\n---\nuntouched\n')
                before = self.note.read_bytes()
                result = self.reconcile(blockerDiagnosis='late failure')
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.note.read_bytes(), before)

    def test_late_result_cannot_reopen_deferred_backlog_task(self):
        self.accepted(generation=1, blockerDiagnosis='old diagnosis')
        result = self.cli('defer', '--tasks', 'task', '--rollout', str(self.root / 'rollout.md'))
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.note.read_bytes()
        result = self.reconcile(generation=2, status='review')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)

    def test_foreign_rollout_result_cannot_overwrite_task(self):
        self.note.write_text('---\nstatus: in_progress\nrollout: "[[new-rollout]]"\n---\n')
        before = self.note.read_bytes()
        result = self.reconcile(generation=1, blockerDiagnosis='old rollout failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.note.read_bytes(), before)

    def test_tier_cap_stays_until_higher_tier_is_explicitly_observed(self):
        self.accepted(generation=1, tierCapped=True, tierCappedAt='implement', model='opus')
        text = self.accepted(generation=2, attempt='attempt-2', blockerDiagnosis='unknown capability')
        self.assertIn('tier_capped: implement', text)
        text = self.accepted(generation=3, attempt='attempt-3', tierCapped=False, model='opus')
        self.assertIn('tier_capped: implement', text)
        text = self.accepted(generation=4, attempt='attempt-4', tierCapped=False, model='fable')
        self.assertNotIn('tier_capped:', text)

    def test_next_model_recommendation_is_not_executed_model_provenance(self):
        text = self.accepted(status='review-blocked', generation=1, model='opus', escalated=False,
                             nextModel='fable', nextModelReason='Final review round rejected.')
        self.assertIn('next_model: fable', text)
        self.assertIn('next_model_reason:', text)
        self.assertNotIn('\nmodel: fable\n', text)
        result = self.cli('status', '--rollout', str(self.root / 'rollout.md'))
        self.assertEqual(result.returncode, 0, result.stderr)
        task = json.loads(result.stdout)['tasks'][0]
        self.assertEqual(task.get('next_model'), 'fable')
        self.assertEqual(task.get('next_model_reason'), 'Final review round rejected.')
        text = self.accepted(generation=2, attempt='attempt-2', blockerDiagnosis='Transient environment failure')
        self.assertIn('next_model: fable', text)
        text = self.accepted(generation=3, attempt='attempt-3', model='fable', blockerDiagnosis='Higher tier actually ran')
        self.assertNotIn('next_model:', text)
        self.assertNotIn('next_model_reason:', text)

    def test_status_exposes_tier_cap_and_normalises_status(self):
        self.note.write_text('---\nstatus: "blocked" # diagnosis\nrollout: "[[rollout]]"\nwave: 1\ntier_capped: "implement"\n---\n')
        result = self.cli('status', '--rollout', str(self.root / 'rollout.md'))
        self.assertEqual(result.returncode, 0, result.stderr)
        task = json.loads(result.stdout)['tasks'][0]
        self.assertEqual(task['status'], 'blocked')
        self.assertEqual(task.get('tier_capped'), 'implement')

    def test_identified_result_dry_run_does_not_claim_delivery(self):
        path = self.root / 'result.json'
        path.write_text(json.dumps({'runId': 'run-1', 'attemptId': 'attempt-1', 'generation': 1,
                                   'tasks': [{'slug': 'task', 'status': 'blocked', 'blockerDiagnosis': 'dry run diagnosis'}]}))
        before = self.note.read_bytes()
        result = self.cli('reconcile', '--result', str(path), '--dry-run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.note.read_bytes(), before)
        result = self.cli('reconcile', '--result', str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.note.read_text().count('dry run diagnosis'), 1)

unittest.main(verbosity=2)
PYTEST

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fail=1; fi
exit $fail
