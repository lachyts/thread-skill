#!/usr/bin/env bash
# A classic protection that requires no status check can still gate a PR on something else (conversation resolution,
# a required deployment, lock_branch), and branches/<b>'s `protection` object never shows those gates: it holds only
# `enabled` and `required_status_checks`. A PR GitHub reads BLOCKED there, with no review pending and nothing required
# or in flight, is a non-check gate GitHub has decided: a halt (exit 1), never GitHub's lazy settling (exit 8), which
# the lead retries as GitHub-side infra for about 80 minutes. Review round 2026-11-07-b4e9e6a-b35aa0 finding #1.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
chk() { python3 -c 'import json,sys; print(json.dumps({"rc": int(sys.argv[1]), "out": sys.argv[2], "err": sys.argv[3]}))' "$@" >> "$MT_STATE/checks.seq"; }

# Animately/optimizer's develop shape (protected, contexts: [], checks: []), no ruleset; the PR stays BLOCKED on a
# gate branches/<b> cannot show (an unresolved conversation), approved, no required check reported, nothing in flight.
fresh; pair; mkpr 5 "$I" BLOCKED; echo nochecks > "$MT_STATE/branch"; echo APPROVED > "$MT_STATE/pr/5/reviewDecision"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 1 "a check-less protected branch, BLOCKED by a non-check gate: exits 1 (a decided gate), never 8"
lacks "$out" "GitHub has not settled its mergeability" "never retried as GitHub settling"
ok "$(nmerge)" 0 "nothing merged"

echo; [ "$fail" -eq 0 ] && echo "merge-task bare blocked: ALL PASS" || echo "merge-task bare blocked: SOME FAILED"
exit "$fail"
