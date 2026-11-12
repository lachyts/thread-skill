#!/usr/bin/env bash
# A classic protection that requires no status check can still gate a PR on something else (conversation resolution,
# a required deployment, lock_branch), and branches/<b>'s `protection` object never shows those gates: it holds only
# `enabled` and `required_status_checks`, so the gate reads `some`. A PR GitHub reads BLOCKED there, with no review
# pending and nothing reported or in flight, exits 1 `required checks never appeared` (MERGE_TASK_INFRA): the lead
# retries it once as GitHub-side infra, then hands it to Lachy as the same stop (ADR 0033 d4 as amended 2026-11-12).
# It is no "decided gate" (the NON-check gate's exit 1 needs checks already green), and never the settling exit 8,
# which is exempt from the same-stop rule and so retried through the whole budget, about 80 minutes. Review rounds
# 2026-11-07-b4e9e6a-b35aa0 #1, a2ec81e/a194f8 #1 and c781add/f304a3 #4.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh

# Animately/optimizer's develop shape (protected, contexts: [], checks: []), no ruleset; the PR stays BLOCKED on a
# gate branches/<b> cannot show (an unresolved conversation), approved, no required check reported, nothing in flight.
fresh; pair; mkpr 5 "$I" BLOCKED; echo nochecks > "$MT_STATE/branch"; echo APPROVED > "$MT_STATE/pr/5/reviewDecision"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 1 "a check-less protected branch, BLOCKED by a non-check gate: exits 1 (never appeared), never 8"
has "$out" "required checks never appeared for PR #5" "the never-appeared cause, retried once as GitHub-side infra"
lacks "$out" "NON-check gate" "never the NON-check gate's exit 1"
lacks "$out" "GitHub has not settled its mergeability" "never retried as GitHub settling"
ok "$(nmerge)" 0 "nothing merged"

echo; [ "$fail" -eq 0 ] && echo "merge-task bare blocked: ALL PASS" || echo "merge-task bare blocked: SOME FAILED"
exit "$fail"
