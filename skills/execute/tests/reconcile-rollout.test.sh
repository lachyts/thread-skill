#!/usr/bin/env bash
# Unit test for reconcile-rollout.py — runs against temp task notes, no vault/GitHub needed.
# Usage: bash reconcile-rollout.test.sh   (exit 0 = pass)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# An absent parallel_ceiling resolves through rollout-settings.py (~/.config/thread/rollouts.toml, p15-4): every
# call that reaches it runs with HOME=$EH, an empty dir, so only the built-in applies and the operator's file never does.
EH="$TMP/settings-home"; mkdir -p "$EH"
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp

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
  { "slug": "task-approved",     "scope": "single-file",  "status": "review",         "prUrl": "https://github.com/o/r/pull/1", "reviewRoundsUsed": 1, "planRoundsUsed": 0, "startRung": "", "rung": "", "climbs": [], "rungDrift": "", "ran": [] },
  { "slug": "task-revised",      "scope": "cross-cutting","status": "review",         "prUrl": "https://github.com/o/r/pull/2", "reviewRoundsUsed": 3, "planRoundsUsed": 2, "startRung": "opus-high", "rung": "opus-xhigh", "climbs": [{ "stage": "review", "from": "opus-high", "to": "opus-xhigh" }], "rungDrift": "", "ran": [] },
  { "slug": "task-reviewblocked","scope": "single-file",  "status": "review-blocked", "prUrl": "https://github.com/o/r/pull/3", "reviewRoundsUsed": 4, "reviewFeedback": ["bound assertion is a no-op", "missed sibling site in foo.py"] },
  { "slug": "task-blocked",      "scope": "single-file",  "status": "blocked",        "prUrl": "", "blockerDiagnosis": "verifier never went green after 3 tries; root cause is an env mismatch.", "startRung": "opus-xhigh", "rung": "opus-xhigh", "climbs": [{ "stage": "implement", "from": "opus-xhigh", "to": "opus-xhigh" }], "rungDrift": "gone" },
  { "slug": "task-planblocked",  "scope": "cross-cutting","status": "plan-blocked",   "prUrl": "", "blockerDiagnosis": "plan not approved after 3 rounds. Accumulated feedback: ..." }
] }
EOF

# task-blocked carries a drifted rung: from an earlier stamp the ladder no longer has
python3 - "$TMP/task-blocked.md" <<'PY2'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
p.write_text(p.read_text().replace("priority: normal\n", "priority: normal\nrung: gone\nmodel: fable\ntier_capped: review\n", 1))
PY2

echo "== reconcile =="
out=$(python3 "$SCRIPT" reconcile --result "$TMP/result.json" --tasks-dir "$TMP" 2>&1) || { echo "FAIL - reconcile exited non-zero"; fail=1; }
printf '%s\n' "$out"

check "approved: status review"         "status: review"                              "$TMP/task-approved.md"
check "approved: pr unquoted"           "pr: https://github.com/o/r/pull/1"            "$TMP/task-approved.md"
check "approved: review_rounds_used"    "review_rounds_used: 1"                        "$TMP/task-approved.md"
refute "approved: no plan_rounds (0)"   "plan_rounds_used"                             "$TMP/task-approved.md"
check "approved: pr after owner"        "owner: execute-test"                          "$TMP/task-approved.md"

check "revised: status review"          "status: review"                              "$TMP/task-revised.md"
check "revised: review_rounds_used 3"   "review_rounds_used: 3"                        "$TMP/task-revised.md"
check "revised: plan_rounds_used 2"     "plan_rounds_used: 2"                          "$TMP/task-revised.md"
check "revised: the reached rung stamped on a landed task" "rung: opus-xhigh"          "$TMP/task-revised.md"
refute "revised: never a model stamp"            "model:"                             "$TMP/task-revised.md"
refute "approved: an empty rung stamps nothing"  "rung:"                              "$TMP/task-approved.md"
refute "approved: no model stamp"                "model:"                             "$TMP/task-approved.md"
case "$out" in *"task-revised: status=review pr=https://github.com/o/r/pull/2 rung=opus-xhigh from=opus-high climbs=review:opus-high->opus-xhigh [written]"*) echo "ok   - revised: the line shows the rung, where it started and the climb" ;;
  *) echo "FAIL - revised: reconcile line (got: $out)"; fail=1 ;; esac
case "$out" in *"task-approved: status=review pr=https://github.com/o/r/pull/1 [written]"*) echo "ok   - approved: no rung on the line" ;;
  *) echo "FAIL - approved: reconcile line (got: $out)"; fail=1 ;; esac

check "review-blocked: status"          "status: review-blocked"                       "$TMP/task-reviewblocked.md"
check "review-blocked: pr"              "pr: https://github.com/o/r/pull/3"            "$TMP/task-reviewblocked.md"
check "review-blocked: heading"         "## Review-blocked feedback"                   "$TMP/task-reviewblocked.md"
check "review-blocked: bullet"          "- missed sibling site in foo.py"              "$TMP/task-reviewblocked.md"

check "blocked: status"                 "status: blocked"                              "$TMP/task-blocked.md"
check "blocked: heading"                "## Blocker diagnosis"                         "$TMP/task-blocked.md"
check "blocked: content"                "env mismatch"                                 "$TMP/task-blocked.md"
refute "blocked: no pr written (empty)" "pr:"                                          "$TMP/task-blocked.md"
check "blocked: the drifted rung: is overwritten with the reached rung" "rung: opus-xhigh" "$TMP/task-blocked.md"
refute "blocked: the drifted name is gone"       "rung: gone"                         "$TMP/task-blocked.md"
check "blocked: a stale model: stamp is left alone (a supersede's carry maps it)" "model: fable" "$TMP/task-blocked.md"
check "blocked: a stale tier_capped: stamp is left alone"  "tier_capped: review"      "$TMP/task-blocked.md"
case "$out" in *"task-blocked: status=blocked rung=opus-xhigh climbs=implement:opus-xhigh->opus-xhigh rung-drift=gone [written]"*) echo "ok   - blocked: the line shows the no-op climb and the drift, no from= when the call never left its rung" ;;
  *) echo "FAIL - blocked: reconcile line (got: $out)"; fail=1 ;; esac

check "plan-blocked: status"            "status: plan-blocked"                         "$TMP/task-planblocked.md"
check "plan-blocked: heading"           "## Plan-blocked feedback"                     "$TMP/task-planblocked.md"

echo "== a malformed rung name is an ERROR and stamps nothing =="
mknote task-badrung in_progress
for bad in '"Opus-XHigh"' '"yes"' '["opus-high"]' '"opus high"'; do
  printf '{"rolloutSlug":"t","tasks":[{"slug":"task-badrung","scope":"single-file","status":"blocked","prUrl":"","blockerDiagnosis":"x","rung":%s}]}' "$bad" > "$TMP/bad.json"
  if berr=$(python3 "$SCRIPT" reconcile --result "$TMP/bad.json" --tasks-dir "$TMP" 2>&1 >/dev/null); then
    echo "FAIL - bad rung $bad: reconcile exited 0"; fail=1
  else
    case "$berr" in *"ERROR: task-badrung: rung "*"is not a rung name"*) echo "ok   - bad rung $bad: an ERROR naming it, exit 1" ;;
      *) echo "FAIL - bad rung $bad: stderr (got: $berr)"; fail=1 ;; esac
  fi
  refute "bad rung $bad: no rung: stamped" "rung:" "$TMP/task-badrung.md"
done
check "bad rung: the rest of the row is still written" "status: blocked" "$TMP/task-badrung.md"

echo "== a pre-3.0.0 row (tier flags, no rung) maps an escalation to the ladder's top rung =="
# A call started on the tier engine can finish there (a Lost-call resume re-passes its old scriptPath). Its
# row carries model/escalated/tierCapped and no rung record. HOME is pinned so ladder.py reads this test's
# ladder file, never the operator's.
LH="$TMP/legacy-home"; mkdir -p "$LH"
mknote task-legacy-esc in_progress
mknote task-legacy-cap in_progress
mknote task-legacy-flat in_progress
cat > "$TMP/legacy.json" <<'EOF'
{ "rolloutSlug": "t", "tasks": [
  { "slug": "task-legacy-esc",  "scope": "single-file", "status": "blocked", "prUrl": "", "blockerDiagnosis": "red after the fable takeover", "model": "fable", "escalated": true, "escalatedAt": "implement", "tierCapped": false, "tierCappedAt": "" },
  { "slug": "task-legacy-cap",  "scope": "single-file", "status": "review", "prUrl": "https://github.com/o/r/pull/9", "reviewRoundsUsed": 1, "model": "opus", "escalated": false, "escalatedAt": "", "tierCapped": true, "tierCappedAt": "implement" },
  { "slug": "task-legacy-flat", "scope": "single-file", "status": "review", "prUrl": "https://github.com/o/r/pull/8", "reviewRoundsUsed": 1, "model": "opus", "escalated": false, "escalatedAt": "", "tierCapped": false, "tierCappedAt": "" }
] }
EOF
lout=$(HOME="$LH" python3 "$SCRIPT" reconcile --result "$TMP/legacy.json" --tasks-dir "$TMP" 2>"$TMP/legacy.err"); lrc=$?
lerr=$(cat "$TMP/legacy.err")
[ "$lrc" -eq 0 ] && echo "ok   - legacy: a mappable legacy row is a warning, exit 0" || { echo "FAIL - legacy: exit $lrc ($lerr)"; fail=1; }
check  "legacy escalated: stamped the built-in ladder's top rung" "rung: opus-xhigh"   "$TMP/task-legacy-esc.md"
check  "legacy tier-capped: stamped the top rung too"             "rung: opus-xhigh"   "$TMP/task-legacy-cap.md"
refute "legacy, no climb: nothing stamped"                        "rung:"              "$TMP/task-legacy-flat.md"
refute "legacy: never a model stamp"                              "model:"             "$TMP/task-legacy-esc.md"
refute "legacy: never a tier_capped stamp"                        "tier_capped:"       "$TMP/task-legacy-cap.md"
check  "legacy: the rest of the row is written"                   "status: blocked"    "$TMP/task-legacy-esc.md"
case "$lerr" in *"WARNING: task-legacy-esc: a pre-3.0.0 row (escalated, no rung) — stamped rung: opus-xhigh, the top rung of the ladder (built-in)"*) echo "ok   - legacy escalated: a WARNING naming the slug and the rung" ;;
  *) echo "FAIL - legacy escalated: WARNING (got: $lerr)"; fail=1 ;; esac
case "$lerr" in *"WARNING: task-legacy-cap: a pre-3.0.0 row (tier-capped, no rung)"*) echo "ok   - legacy tier-capped: a WARNING naming the slug" ;;
  *) echo "FAIL - legacy tier-capped: WARNING (got: $lerr)"; fail=1 ;; esac
case "$lerr" in *task-legacy-flat*) echo "FAIL - legacy, no climb: warned (got: $lerr)"; fail=1 ;; *) echo "ok   - legacy, no climb: no warning" ;; esac
case "$lout" in *"task-legacy-esc: status=blocked rung=opus-xhigh (pre-3.0.0 row, escalated) [written]"*) echo "ok   - legacy escalated: the line shows the mapped rung" ;;
  *) echo "FAIL - legacy escalated: reconcile line (got: $lout)"; fail=1 ;; esac
# The operator's ladder file decides the top rung.
mkdir -p "$LH/.config/thread"
cat > "$LH/.config/thread/ladder.toml" <<'EOF'
[[rung]]
name = "opus-high"
model = "opus"
effort = "high"
judge = "high"
review = "xhigh"

[[rung]]
name = "fable-high"
model = "fable"
effort = "high"
judge = "xhigh"
review = "max"
EOF
mknote task-legacy-esc in_progress
HOME="$LH" python3 "$SCRIPT" reconcile --result "$TMP/legacy.json" --tasks-dir "$TMP" >/dev/null 2>&1 || { echo "FAIL - legacy (file): exit"; fail=1; }
check "legacy escalated: the ladder file's top rung" "rung: fable-high" "$TMP/task-legacy-esc.md"
# A refused ladder file: an ERROR naming the slug, exit 1, nothing stamped.
printf '[[rung]]\nname = "Opus"\n' > "$LH/.config/thread/ladder.toml"
mknote task-legacy-esc in_progress
if berr=$(HOME="$LH" python3 "$SCRIPT" reconcile --result "$TMP/legacy.json" --tasks-dir "$TMP" 2>&1 >/dev/null); then
  echo "FAIL - legacy (refused ladder): reconcile exited 0"; fail=1
else
  case "$berr" in *"ERROR: task-legacy-esc: a pre-3.0.0 row (escalated, no rung) — the ladder could not be read ($LH/.config/thread/ladder.toml:1: rung 1: "*) echo "ok   - legacy (refused ladder): an ERROR naming the slug and the file's <path>:<line>: <reason>, exit 1" ;;
    *) echo "FAIL - legacy (refused ladder): stderr (got: $berr)"; fail=1 ;; esac
fi
refute "legacy (refused ladder): no rung: stamped" "rung:" "$TMP/task-legacy-esc.md"
check  "legacy (refused ladder): the rest of the row is written" "status: blocked" "$TMP/task-legacy-esc.md"

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

JSON=$(HOME="$EH" python3 "$SCRIPT" status --rollout "$TMP/st-rollout.md" --tasks-dir "$TMP")
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
JSON=$(HOME="$EH" python3 "$SCRIPT" status --rollout "$TMP/pz-rollout.md" --tasks-dir "$TMP")
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
JSON=$(HOME="$EH" python3 "$SCRIPT" status --rollout "$TMP/pz-pending.md" --tasks-dir "$TMP")
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

echo "== approved plan (p14-2: the row's plan upserts / removes / leaves ## Approved plan) =="
LEAD="$HERE/../scripts/lead-integrate.py"
LEAD_IN='The last approved plan, kept as a record for Integration. Not authoritative: a plan in your prompt supersedes it; with no plan in your prompt, the brief is the contract.'
planrow() {  # planrow <slug> <status> <plan-json> -> a one-row result on stdout
  printf '{ "rolloutSlug": "test-rollout", "tasks": [ { "slug": "%s", "scope": "cross-cutting", "status": "%s", "prUrl": "https://github.com/o/r/pull/30", "reviewRoundsUsed": 1, "blockerDiagnosis": "d", "gatedInputs": ["spend: x — cap $1"], "plan": %s } ] }\n' "$1" "$2" "$3"
}
nplan() { python3 "$LEAD" plan --note "$TMP/$1.md" | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin)["plan"])'; }
shaof() { python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
pcheck() {  # pcheck <label> <python-condition over t (the note text)> <slug>
  if python3 -c "import sys; t=open(sys.argv[1]).read(); sys.exit(0 if ($2) else 1)" "$TMP/$3.md"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi
}
mknote task-plan in_progress
planrow task-plan review '"Planned on: abc\n### Files to modify\n- x\n\n### Gated inputs\nNone"' > "$TMP/plan1.json"
python3 "$SCRIPT" reconcile --result "$TMP/plan1.json" --tasks-dir "$TMP" >/dev/null || { echo "FAIL - plan reconcile exit"; fail=1; }
pcheck "plan: heading, blank, the pinned lead-in, blank, the quote" \
  "'\n## Approved plan\n\n$LEAD_IN\n\n> Planned on: abc\n> ### Files to modify\n> - x\n>\n> ### Gated inputs\n> None\n' in t" task-plan
[ "$(nplan task-plan)" = "$(printf 'Planned on: abc\n### Files to modify\n- x\n\n### Gated inputs\nNone')" ] \
  && echo "ok   - plan: lead-integrate plan reads it back exactly" || { echo "FAIL - plan: read-back differs"; fail=1; }
s1=$(shaof "$TMP/task-plan.md")
out=$(python3 "$SCRIPT" reconcile --result "$TMP/plan1.json" --tasks-dir "$TMP" 2>&1)
case "$out" in *"[no-change]"*) echo "ok   - plan: a re-reconcile is [no-change]" ;; *) echo "FAIL - plan: re-reconcile wrote ($out)"; fail=1 ;; esac
[ "$(shaof "$TMP/task-plan.md")" = "$s1" ] && echo "ok   - plan: re-reconcile byte-identical" || { echo "FAIL - plan: re-reconcile changed bytes"; fail=1; }
planrow task-plan review '"PLAN TWO"' > "$TMP/plan2.json"
python3 "$SCRIPT" reconcile --result "$TMP/plan2.json" --tasks-dir "$TMP" >/dev/null
pcheck "plan: a new plan replaces the old under one heading" \
  "t.count('## Approved plan') == 1 and '> PLAN TWO' in t and 'Planned on: abc' not in t" task-plan
s2=$(shaof "$TMP/task-plan.md")
for v in null; do
  planrow task-plan review "$v" > "$TMP/plan-null.json"
  python3 "$SCRIPT" reconcile --result "$TMP/plan-null.json" --tasks-dir "$TMP" >/dev/null
  [ "$(shaof "$TMP/task-plan.md")" = "$s2" ] && echo "ok   - plan: null leaves the note byte-identical" || { echo "FAIL - plan: null changed it"; fail=1; }
done
python3 - "$TMP/plan-null.json" "$TMP/plan-absent.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); del d["tasks"][0]["plan"]; json.dump(d, open(sys.argv[2], "w"))
PY
python3 "$SCRIPT" reconcile --result "$TMP/plan-absent.json" --tasks-dir "$TMP" >/dev/null
[ "$(shaof "$TMP/task-plan.md")" = "$s2" ] && echo "ok   - plan: an absent key leaves the note byte-identical" || { echo "FAIL - plan: absent key changed it"; fail=1; }
# a blocked, plan-blocked or gate-pending row with a string plan follows the same rule
for st in blocked plan-blocked gate-pending; do
  planrow task-plan "$st" "\"PLAN $st\"" > "$TMP/plan-st.json"
  python3 "$SCRIPT" reconcile --result "$TMP/plan-st.json" --tasks-dir "$TMP" >/dev/null
  pcheck "plan: a $st row upserts too" "t.count('## Approved plan') == 1 and '> PLAN $st\n' in t" task-plan
done
# a non-string, non-null plan: ERROR, exit 1, the section untouched, the rest of the row written
s3=$(shaof "$TMP/task-plan.md")
for bad in 5 '{}'; do
  planrow task-plan review "$bad" > "$TMP/plan-bad.json"
  python3 - "$TMP/task-plan.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("status: gate-pending", "status: in_progress", 1))
PY
  err=$(python3 "$SCRIPT" reconcile --result "$TMP/plan-bad.json" --tasks-dir "$TMP" 2>&1 >/dev/null); rc=$?
  [ "$rc" -eq 1 ] && grep -qF "task-plan: plan is not a string or null" <<<"$err" \
    && echo "ok   - plan: $bad is an ERROR, exit 1" || { echo "FAIL - plan: $bad (rc $rc: $err)"; fail=1; }
  pcheck "plan: $bad leaves the section, the row still written" "'> PLAN gate-pending\n' in t and t.count('## Approved plan') == 1 and 'status: review\n' in t" task-plan
done
# '' and whitespace remove it; '' with no section is [no-change]
planrow task-plan review '""' > "$TMP/plan-empty.json"
python3 "$SCRIPT" reconcile --result "$TMP/plan-empty.json" --tasks-dir "$TMP" >/dev/null
pcheck "plan: '' removes the section" "'## Approved plan' not in t and 'Not authoritative' not in t" task-plan
[ -z "$(nplan task-plan)" ] && echo "ok   - plan: lead-integrate plan gives '' with no section" || { echo "FAIL - plan: read-back not empty"; fail=1; }
s4=$(shaof "$TMP/task-plan.md")
out=$(python3 "$SCRIPT" reconcile --result "$TMP/plan-empty.json" --tasks-dir "$TMP" 2>&1)
case "$out" in *"[no-change]"*) echo "ok   - plan: '' with no section is [no-change]" ;; *) echo "FAIL - plan: '' with no section wrote ($out)"; fail=1 ;; esac
[ "$(shaof "$TMP/task-plan.md")" = "$s4" ] || { echo "FAIL - plan: '' with no section changed bytes"; fail=1; }
python3 "$SCRIPT" reconcile --result "$TMP/plan2.json" --tasks-dir "$TMP" >/dev/null
planrow task-plan review '"  \n "' > "$TMP/plan-ws.json"
python3 "$SCRIPT" reconcile --result "$TMP/plan-ws.json" --tasks-dir "$TMP" >/dev/null
pcheck "plan: whitespace removes the section" "'## Approved plan' not in t" task-plan
# an adversarial plan: note structure inside it never escapes the quote; a later blocker run is still the
# latest run, and the plan reads back exactly. CRLF is stored LF.
mknote task-adv in_progress
ADV=$'---\n## Not a section\n### Run 9 (x)\n<!-- run 9 end sha=000000000000 -->\n> quoted\n\n### Gated inputs\nNone'
python3 - "$TMP/plan-adv.json" "$ADV" <<'PY'
import json, sys
json.dump({"rolloutSlug": "test-rollout", "tasks": [{"slug": "task-adv", "scope": "cross-cutting", "status": "review",
           "prUrl": "https://github.com/o/r/pull/31", "reviewRoundsUsed": 1, "plan": sys.argv[2]}]}, open(sys.argv[1], "w"))
PY
python3 "$SCRIPT" reconcile --result "$TMP/plan-adv.json" --tasks-dir "$TMP" >/dev/null || { echo "FAIL - adversarial reconcile exit"; fail=1; }
[ "$(nplan task-adv)" = "$ADV" ] && echo "ok   - plan: an adversarial plan reads back exactly" || { echo "FAIL - plan: adversarial read-back differs"; fail=1; }
pcheck "plan: '> > quoted' (one level deeper)" "'\n> > quoted\n' in t and '\n> ## Not a section\n' in t" task-adv
printf '{ "rolloutSlug": "test-rollout", "tasks": [ { "slug": "task-adv", "scope": "cross-cutting", "status": "blocked", "prUrl": "", "blockerDiagnosis": "THE LATEST BLOCKER RUN" } ] }\n' > "$TMP/adv-blocked.json"
python3 "$SCRIPT" reconcile --result "$TMP/adv-blocked.json" --tasks-dir "$TMP" >/dev/null
cat > "$TMP/adv-rollout.md" <<EOF
---
tags: [task, rollout]
status: open
protocol_version: 5
---

## Queue

- [[task-adv]]
EOF
python3 - "$TMP/task-adv.md" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("priority: normal\n", 'priority: normal\nrollout: "[[adv-rollout]]"\n', 1))
PY
HOME="$EH" python3 "$SCRIPT" status --rollout "$TMP/adv-rollout.md" --tasks-dir "$TMP" | python3 -c '
import json, sys
t = [x for x in json.load(sys.stdin)["tasks"] if x["slug"] == "task-adv"][0]
sys.exit(0 if t["blockerSummary"] == "THE LATEST BLOCKER RUN" else 1)' \
  && echo "ok   - plan: a later Blocker diagnosis run is the blockerSummary" || { echo "FAIL - plan: blockerSummary wrong"; fail=1; }
[ "$(nplan task-adv)" = "$ADV" ] && echo "ok   - plan: still reads back exactly after the run" || { echo "FAIL - plan: read-back after the run differs"; fail=1; }
mknote task-crlf in_progress
printf '{ "rolloutSlug": "test-rollout", "tasks": [ { "slug": "task-crlf", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/32", "reviewRoundsUsed": 1, "plan": "line one\\r\\nline two\\r\\n" } ] }\n' > "$TMP/plan-crlf.json"
python3 "$SCRIPT" reconcile --result "$TMP/plan-crlf.json" --tasks-dir "$TMP" >/dev/null
pcheck "plan: CRLF stored as LF" "'> line one\n> line two\n' in t and '\r' not in t" task-crlf
[ "$(nplan task-crlf)" = "$(printf 'line one\nline two')" ] && echo "ok   - plan: CRLF reads back LF" || { echo "FAIL - plan: CRLF read-back"; fail=1; }
python3 "$LEAD" plan --note "$TMP/no-such-note.md" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && echo "ok   - plan: a missing note exits 2" || { echo "FAIL - plan: missing note rc $rc"; fail=1; }

echo "== verify-timeout (p14-2: the rollout's Integration verify timeout, read-only) =="
mkvt() {  # mkvt <frontmatter line or ''> -> $TMP/vt-rollout.md
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n'; [ -n "$1" ] && printf '%s\n' "$1"; printf -- '---\n\n## Notes\n'; } > "$TMP/vt-rollout.md"
}
vt_ok() {  # vt_ok <label> <frontmatter line> <expected stdout>
  mkvt "$2"; local before after got rc; before=$(shaof "$TMP/vt-rollout.md")
  got=$(python3 "$SCRIPT" verify-timeout --rollout "$TMP/vt-rollout.md" 2>/dev/null); rc=$?
  after=$(shaof "$TMP/vt-rollout.md")
  if [ "$rc" -eq 0 ] && [ "$got" = "$3" ] && [ "$before" = "$after" ]; then echo "ok   - verify-timeout: $1"
  else echo "FAIL - verify-timeout: $1 (rc $rc, got $got)"; fail=1; fi
}
vt_bad() {  # vt_bad <label> <frontmatter line> <raw repr in the message>
  mkvt "$2"; local before after got err rc; before=$(shaof "$TMP/vt-rollout.md")
  got=$(python3 "$SCRIPT" verify-timeout --rollout "$TMP/vt-rollout.md" 2>"$TMP/vt.err"); rc=$?
  err=$(cat "$TMP/vt.err"); after=$(shaof "$TMP/vt-rollout.md")
  if [ "$rc" -eq 1 ] && [ -z "$got" ] && [ "$before" = "$after" ] \
     && [ "$err" = "ERROR: verify_timeout must be an integer from 1 to 6600, got $3" ]; then echo "ok   - verify-timeout: $1"
  else echo "FAIL - verify-timeout: $1 (rc $rc, out '$got', err '$err')"; fail=1; fi
}
vt_ok "absent -> 1800" '' '{"verifyTimeout": 1800, "harnessTimeoutMs": 2400000}'
vt_ok "3600 -> 4200000" 'verify_timeout: 3600' '{"verifyTimeout": 3600, "harnessTimeoutMs": 4200000}'
vt_ok "6600 -> 7200000 (the harness maximum)" 'verify_timeout: 6600' '{"verifyTimeout": 6600, "harnessTimeoutMs": 7200000}'
vt_ok "1 is the floor" 'verify_timeout: 1' '{"verifyTimeout": 1, "harnessTimeoutMs": 601000}'
vt_ok 'a quoted "1800"' 'verify_timeout: "1800"' '{"verifyTimeout": 1800, "harnessTimeoutMs": 2400000}'
vt_ok "a trailing comment" 'verify_timeout: 1800 # note' '{"verifyTimeout": 1800, "harnessTimeoutMs": 2400000}'
vt_ok "a commented-out key is absent" '# verify_timeout: 99' '{"verifyTimeout": 1800, "harnessTimeoutMs": 2400000}'
vt_bad "0" 'verify_timeout: 0' "'0'"
vt_bad "-1" 'verify_timeout: -1' "'-1'"
vt_bad "6601" 'verify_timeout: 6601' "'6601'"
vt_bad "2.5" 'verify_timeout: 2.5' "'2.5'"
vt_bad "true" 'verify_timeout: true' "'true'"
vt_bad "null" 'verify_timeout: null' "'null'"
vt_bad "empty" 'verify_timeout:' "''"
vt_bad "abc" 'verify_timeout: abc' "'abc'"
got=$(python3 "$SCRIPT" verify-timeout --rollout "$TMP/no-such-rollout.md" 2>"$TMP/vt.err"); rc=$?
[ "$rc" -eq 1 ] && [ -z "$got" ] && grep -qF "ERROR: rollout note not found" "$TMP/vt.err" \
  && echo "ok   - verify-timeout: a missing note exits 1" || { echo "FAIL - verify-timeout: missing note (rc $rc)"; fail=1; }

echo
if [ "$fail" -eq 0 ]; then echo "ALL PASS"; else echo "SOME FAILED"; fail=1; fi
exit $fail
