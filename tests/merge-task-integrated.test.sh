#!/usr/bin/env bash
# merge-task.sh merges ONE integrated PR, and only onto the base its Integration used (ADR 0030, p12-7). Driven
# end to end against the shared fake gh (tests/fixtures/merge-task/fake-gh.py, gh 2.43.1 behaviour) and a real
# bare "GitHub" repo the checkout clones, so the fetch, the containment check and ls-remote run for real.
# Each fixture asserts the exit code, the sentinel, the merge calls in gh.log and the base-moved counter.
# Hermetic: temp repos, PATH shim, ssh disabled, every interval 0, two tries per read.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)

tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
anchor() { gc update-ref "refs/integration-anchor/audit-fix/t$1" "$(gc rev-parse HEAD)"; }
has_anchor() { gc rev-parse -q --verify "refs/integration-anchor/audit-fix/t$1" >/dev/null 2>&1 && echo yes || echo no; }
cdir="$tmp/repo/.claude/merge-task"

# 1. usage and PR normalisation: exit 2 with zero gh calls; a pre-seeded counter is byte-unchanged
fresh; pair; mkpr 5 "$I"
: > "$MT_STATE/gh.log"
out=$(PATH="$tmp/bin:$PATH" bash "$MT" "$tmp/repo" 5 "$I" 2>&1); rc=$?
ok "$rc" 2 "1. three args exits 2"; ok "$(glog)" "" "1. three args: zero gh calls"
run 5 "zz${I#??}" "$B"; ok "$rc" 2 "1. a non-hex head exits 2"; ok "$(glog)" "" "1. non-hex head: zero gh calls"
run 5 "$I" "${B:0:12}"; ok "$rc" 2 "1. a short base exits 2"; ok "$(glog)" "" "1. short base: zero gh calls"
ok "$(sent)" "failed:2" "1. a SHA exit 2 writes failed:2"
seed 5 "$B"
run "https://github.com/x/y/pull/5" "$I" "$B"
ok "$rc" 2 "1. a foreign-repo URL exits 2"; has "$out" "PR URL https://github.com/x/y/pull/5 is in x/y, but origin is o/r" "1. names both repos"
ok "$(sent)" "failed:2" "1. foreign URL: failed:2"; ok "$(glog)" "" "1. foreign URL: zero gh calls"
ok "$(ctr 5)" "$B" "1. foreign URL: the counter is byte-unchanged"
for a in https://github.com/o/r/issues/5 05 0 5x https://www.github.com/o/r/pull/5; do
  run "$a" "$I" "$B"
  ok "$rc" 2 "1. '$a' exits 2"; ok "$(glog)" "" "1. '$a': zero gh calls"
done
has "$out" "cannot parse a PR number from" "1. says it cannot parse the PR"
ok "$(ctr 5)" "$B" "1. the counter is still byte-unchanged"

# 2. a clean CLEAN merge, called with a case-different URL with a /files suffix
fresh; pair; mkpr 5 "$I"; seed 5 "$(mk "" stale)"; anchor 5
run "https://github.com/O/R/pull/5/files" "$I" "$B"
ok "$rc" 0 "2. clean merge exits 0"; ok "$(sent)" "ok" "2. sentinel ok"
has "$(glog)" "pr merge 5 -R o/r --squash --match-head-commit $I" "2. the merge is head-pinned, by number"
ok "$(nmerge)" 1 "2. one merge call"
lacks "$(glog)" "--admin" "2. never --admin"
lacks "$(glog)" "https://" "2. no gh call carries the URL"
has "$out" "(verified)" "2. the squash commit is verified"
ok "$(has_anchor 5)" no "2. the anchor ref is deleted"
ok "$(ctr 5)" "" "2. the counter is cleared"

# 3. base moved at the pre-check, URL form, then number form with another refused base: one counter file
fresh; pair; mkpr 5 "$I"; X=$(mk "$B" moved); echo "$X" > "$MT_STATE/base.seq"
run "https://github.com/o/r/pull/5" "$I" "$B"
ok "$rc" 3 "3. base moved exits 3"; ok "$(nmerge)" 0 "3. nothing merged"; ok "$(sent)" "failed:3" "3. failed:3"
has "$out" "BASE MOVED: origin/master is $X, not the integrated base $B" "3. names both bases"
ok "$(ls -A "$cdir")" "5.base-moved" "3. exactly one counter file, by number"
ok "$(ctr 5)" "$B" "3. one line"
I2=$(mk "$X" head2); Y=$(mk "$X" moved2); echo "$I2" > "$MT_STATE/pr/5/headRefOid"
git --git-dir "$MT_SRV" update-ref refs/heads/audit-fix/t5 "$I2"; echo "$Y" > "$MT_STATE/base.seq"
run 5 "$I2" "$X"
ok "$rc" 3 "3. number form, another refused base: exits 3"
ok "$(ls -A "$cdir")" "5.base-moved" "3. still the only counter file"
ok "$(ctr 5 | wc -l | tr -d ' ')" 2 "3. the same file has 2 lines"

# 4. the base moves between the pre-check and the pre-merge re-check
fresh; pair; mkpr 5 "$I"; X=$(mk "$B" moved); printf '%s\n%s\n' "$B" "$X" > "$MT_STATE/base.seq"
run 5 "$I" "$B"
ok "$rc" 3 "4. base moved before the merge exits 3"
ok "$(grep -c 'git/ref/heads/master' "$MT_STATE/gh.log")" 2 "4. exactly 2 base reads"
ok "$(nmerge)" 0 "4. nothing merged"

# 5. BEHIND: a moved base is a re-integration (3), never update-branch; an unmoved one halts after re-polls
fresh; pair; mkpr 5 "$I" BEHIND; X=$(mk "$B" moved); printf '%s\n%s\n' "$B" "$X" > "$MT_STATE/base.seq"
run 5 "$I" "$B"
ok "$rc" 3 "5. BEHIND on a moved base exits 3"; ok "$(nmerge)" 0 "5. moved: nothing merged"
lacks "$(glog)" "update-branch" "5. never update-branch"
fresh; pair; mkpr 5 "$I" BEHIND
run 5 "$I" "$B"
ok "$rc" 1 "5. BEHIND on an unmoved base exits 1 after the re-poll"; ok "$(nmerge)" 0 "5. unmoved: nothing merged"
has "$out" "stays BEHIND" "5. says it stays BEHIND"
lacks "$(glog)" "update-branch" "5. unmoved: never update-branch"

# 6. the cap: three re-integrations allowed, the fourth distinct refusal sets aside; repeats count once
b() { printf '%040d' "$1"; }
fresh; pair; mkpr 5 "$I"
rcs=''; for k in 1 2 3 4; do run 5 "$I" "$(b "$k")"; rcs="$rcs$rc "; done
ok "$rcs" "3 3 3 4 " "6. distinct b1..b4: 3, 3, 3, 4"
has "$out" "set-aside reason: integration: base moved before the merge 4 times in a row after 3 re-integrations" "6. the 4th names the cap"
ok "$(ctr 5)" "" "6. exit 4 clears the counter"
rcs=''; for k in 1 1 2 3; do run 5 "$I" "$(b "$k")"; rcs="$rcs$rc "; done
ok "$rcs" "3 3 3 3 " "6. b1, b1, b2, b3: 3, 3, 3, 3"
ok "$(ctr 5 | wc -l | tr -d ' ')" 3 "6. a repeated base counts once (3 lines)"
run 5 "$I" "$B"
ok "$rc" 0 "6. a later success merges"; ok "$(ctr 5)" "" "6. a success clears the counter"
fresh; pair; mkpr 6 "$I" CLEAN CLOSED; seed 6 "$(b 1)" "$(b 2)"
run 6 "$I" "$B"
ok "$rc" 1 "6. an exit-1 halt"; ok "$(ctr 6)" "" "6. an exit-1 halt clears the counter"
fresh; pair; mkpr 7 "$I"
run 7 "$I" "$(b 1)"; ok "$rc" 3 "6. refusal 1"
echo "error connecting to api.github.com" > "$MT_STATE/err.prview"
run 7 "$I" "$(b 2)"; ok "$rc" 8 "6. an exit-8 call between refusals"; rm -f "$MT_STATE/err.prview"
ok "$(ctr 7)" "$(b 1)" "6. exit 8 leaves the counter intact"
run 7 "$I" "${I:0:39}"; ok "$rc" 2 "6. an exit-2 call between refusals"
ok "$(ctr 7)" "$(b 1)" "6. exit 2 leaves the counter intact"
run 7 "$I" "$(b 2)"; ok "$rc" 3 "6. refusal 2 counts on"
run 7 "$I" "$(b 3)"; ok "$rc" 3 "6. refusal 3 counts on"
run 7 "$I" "$(b 4)"; ok "$rc" 4 "6. refusal 4 after an 8 and a 2 sets aside"

# 7. the cap fails closed: an unpersistable counter is 2, never an endless 3 (skipped as root)
if [ "$(id -u)" != 0 ]; then
  fresh; pair; mkpr 5 "$I"; mkdir -p "$cdir"; chmod 555 "$cdir"
  run 5 "$I" "$B"
  ok "$rc" 2 "7. an unwritable counter dir exits 2"; has "$out" "cannot persist" "7. says it cannot persist"
  ok "$(glog)" "" "7. unwritable dir: zero gh calls"
  chmod 755 "$cdir"
  X=$(mk "$B" moved); echo "$X" > "$MT_STATE/base.seq"; seed 5 "$(b 9)"; chmod 444 "$cdir/5.base-moved"
  run 5 "$I" "$B"
  ok "$rc" 2 "7. a read-only counter file and a moved base exits 2, not 3"
  ok "$(ctr 5)" "$(b 9)" "7. the read-only counter file is unchanged"
  chmod 644 "$cdir/5.base-moved"
else
  echo "ok   - 7. skipped as root"
fi

# 8. the head pin: origin's branch (ls-remote) decides between a moved head (4) and GitHub lag (8)
# (a) a true move at the pre-pass
fresh; pair; N=$(mk "$B" newer); mkpr 5 "$N"; seed 5 "$(b 1)"
run 5 "$I" "$B"
ok "$rc" 4 "8a. a moved head exits 4"; ok "$(nmerge)" 0 "8a. nothing merged"
has "$out" "set-aside reason: integration: head moved after Integration (PR head $N, origin audit-fix/t5 at $N, integrated head $I)" "8a. the integration: reason"
ok "$(ctr 5)" "" "8a. exit 4 clears the counter"
# (b) a push between the pre-check and the merge
fresh; pair; mkpr 5 "$I"; N=$(mk "$B" pushed); echo "$N" > "$MT_STATE/merge.push"
run 5 "$I" "$B"
ok "$rc" 4 "8b. a push before the merge exits 4"; ok "$(nmerge)" 1 "8b. exactly one merge call"
has "$out" "Head branch was modified" "8b. gh's refusal is shown"
has "$out" "head moved after Integration (PR head $N, origin audit-fix/t5 at $N" "8b. origin's branch confirms the move"
# (c) GitHub's PR head lags origin's branch at the pre-pass, then catches up
fresh; pair; O=$(mk "$B" old); mkpr 5 "$I"; printf '%s\n%s\n' "$O" "$I" > "$MT_STATE/pr/5/headRefOid.seq"
run 5 "$I" "$B"
ok "$rc" 0 "8c. a lagging PR head that catches up merges"; ok "$(sent)" "ok" "8c. ok"
ok "$(awk '/^pr merge/{exit} /^pr view/{n++} END{print n+0}' "$MT_STATE/gh.log" | awk '{print ($1 >= 2) ? "y" : "n"}')" y "8c. at least 2 PR reads before the merge"
lacks "$out" "set-aside reason" "8c. never a set-aside"
# (d) the lag never resolves
fresh; pair; O=$(mk "$B" old); mkpr 5 "$I"; echo "$O" > "$MT_STATE/pr/5/headRefOid"; seed 5 "$(b 1)"
run 5 "$I" "$B"
ok "$rc" 8 "8d. a lag that never resolves exits 8"; has "$out" "still lags" "8d. says it still lags"
ok "$(sent)" "failed:8" "8d. failed:8"; ok "$(nmerge)" 0 "8d. nothing merged"; ok "$(ctr 5)" "$(b 1)" "8d. the counter is untouched"
# (e) GitHub refuses with "Head branch was modified" while both reads are the integrated head
fresh; pair; mkpr 5 "$I"; seed 5 "$(b 1)"
echo "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)" > "$MT_STATE/merge.refuse"
run 5 "$I" "$B"
ok "$rc" 8 "8e. head-modified with an unmoved head exits 8"; has "$out" "GitHub was behind" "8e. says GitHub was behind"
ok "$(sent)" "failed:8" "8e. failed:8"; ok "$(nmerge)" 1 "8e. exactly one merge call"; ok "$(ctr 5)" "$(b 1)" "8e. the counter is untouched"
rm -f "$MT_STATE/merge.refuse"
run 5 "$I" "$B"
ok "$rc" 0 "8e. a re-run merges"; ok "$(sent)" "ok" "8e. re-run: ok"
# (f) the head branch is not on origin
fresh; pair; O=$(mk "$B" old); mkpr 5 "$I"; echo "$O" > "$MT_STATE/pr/5/headRefOid"
git --git-dir "$MT_SRV" update-ref -d refs/heads/audit-fix/t5
run 5 "$I" "$B"
ok "$rc" 1 "8f. a head branch absent on origin exits 1"; has "$out" "is not on origin" "8f. says so"
ok "$(nmerge)" 0 "8f. nothing merged"
# (g) origin unreachable
fresh; pair; O=$(mk "$B" old); mkpr 5 "$I"; echo "$O" > "$MT_STATE/pr/5/headRefOid"; seed 5 "$(b 1)"
gc remote set-url origin "$tmp/nowhere/github.com/o/r.git"
run 5 "$I" "$B"
gc remote set-url origin "$MT_SRV"
ok "$rc" 8 "8g. an unreachable origin exits 8"; has "$out" "cannot read origin" "8g. says it cannot read origin"
ok "$(ctr 5)" "$(b 1)" "8g. the counter is untouched"

# 9. the head does not contain the base
for st in behind diverged; do
  fresh; pair; mkpr 5 "$I"; echo "$st" > "$MT_STATE/compare"
  run 5 "$I" "$B"
  ok "$rc" 1 "9. compare $st exits 1"; has "$out" "does not contain the integrated base" "9. compare $st: not an integrated pair"
done
fresh; pair; mkpr 5 "$I"; echo "gh: Not Found (HTTP 404)" > "$MT_STATE/err.compare"
run 5 "$I" "$B"; ok "$rc" 1 "9. compare 404 exits 1"
fresh; pair; mkpr 5 "$I"; echo "gh: HTTP 502: Bad Gateway" > "$MT_STATE/err.compare"; seed 5 "$(b 1)"
run 5 "$I" "$B"; ok "$rc" 8 "9. compare transient exits 8"; ok "$(ctr 5)" "$(b 1)" "9. transient: the counter is untouched"

# 10. RACE on a fresh merge: the squash parent is not the integrated base
fresh; pair; mkpr 5 "$I"; X=$(mk "$B" sibling); echo "$X" > "$MT_STATE/squash-parent"; anchor 5
run 5 "$I" "$B"
ok "$rc" 5 "10. a fresh merge on the wrong parent exits 5"; ok "$(sent)" "failed:5" "10. failed:5"
has "$out" "RACE: PR #5 merged as" "10. prints the RACE line"
has "$out" "on parent $X at head $I, not the integrated pair (head $I, base $B)" "10. names the parent and the pair"
ok "$(has_anchor 5)" no "10. the anchor ref is still deleted"
# 11. RACE is terminal: the same args again take the already-merged path and exit 5 again
run 5 "$I" "$B"
ok "$rc" 5 "11. a RACE re-run exits 5 again"; ok "$(nmerge)" 0 "11. no merge call"
ok "$(sent)" "failed:5" "11. never ok"

# 12. the review gate (p6-6): a pending review halts at once with 7, never a checks wait, never a bypass
fresh; pair; mkpr 5 "$I" BLOCKED; echo REVIEW_REQUIRED > "$MT_STATE/pr/5/reviewDecision"
export MERGE_TASK_CHECK_INTERVAL=5
t0=$(date +%s); run 5 "$I" "$B"; t1=$(date +%s)
export MERGE_TASK_CHECK_INTERVAL=0
ok "$rc" 7 "12a. BLOCKED + REVIEW_REQUIRED exits 7"
has "$out" "review required: approve PR #5 (https://github.com/o/r/pull/5)" "12a. names the PR and its URL"
has "$out" "never bypasses protection" "12a. says it never bypasses protection"
ok "$(nmerge)" 0 "12a. no merge call"; lacks "$(glog)" "pr checks" "12a. no checks wait"
lacks "$(glog)" "branches/" "12a. no protection read"; lacks "$(glog)" "rules/" "12a. no rules read"
ok "$([ $((t1 - t0)) -lt 5 ] && echo fast || echo slow)" fast "12a. halts in under one CHECK_INTERVAL"
fresh; pair; mkpr 5 "$I" BLOCKED; echo CHANGES_REQUESTED > "$MT_STATE/pr/5/reviewDecision"
run 5 "$I" "$B"; ok "$rc" 7 "12b. BLOCKED + CHANGES_REQUESTED exits 7"
fresh; pair; mkpr 5 "$I" BLOCKED
run 5 "$I" "$B"
ok "$rc" 1 "12c. BLOCKED, no review pending, green checks exits 1"; has "$out" "NON-check gate" "12c. names the non-check gate"
ok "$(sent)" "failed:1" "12c. failed:1, never 8"
ok "$(awk '/^pr checks/{c=1} c && /^pr view/{v=1} END{print v ? "y" : "n"}' "$MT_STATE/gh.log")" y "12c. the PR is re-read after the checks wait"
lacks "$(glog)" "--admin" "12c. no --admin in any argv"
fresh; pair; mkpr 5 "$I" BLOCKED
fo=$(MT_STATE="$MT_STATE" "$tmp/bin/gh" pr merge 5 -R o/r --squash 2>&1); frc=$?
ok "$frc" 1 "12d. (fake fidelity) BLOCKED without --admin is refused"
has "$fo" "the base branch policy prohibits the merge" "12d. (fake fidelity) with gh's text"
"$tmp/bin/gh" pr merge 5 -R o/r --squash --admin >/dev/null 2>&1; ok "$?" 0 "12d. (fake fidelity) BLOCKED with --admin merges"
fresh; pair; mkpr 5 "$I" DIRTY
fo=$("$tmp/bin/gh" pr merge 5 -R o/r --squash --admin 2>&1); frc=$?
ok "$frc" 1 "12d. (fake fidelity) DIRTY is refused even with --admin"
has "$fo" "the merge commit cannot be cleanly created" "12d. (fake fidelity) DIRTY text"

# 13. merge queues and "gh says 0"
fresh; pair; mkpr 5 "$I"; echo true > "$MT_STATE/mq"
run 5 "$I" "$B"; ok "$rc" 1 "13a. a required merge queue exits 1"; ok "$(nmerge)" 0 "13a. nothing merged"
has "$out" "merge queue required on master" "13a. says why"
fresh; pair; mkpr 5 "$I"; rm -f "$MT_STATE/mq"
run 5 "$I" "$B"; ok "$rc" 1 "13b. isMergeQueueEnabled absent from the schema exits 1"; has "$out" "isMergeQueueEnabled" "13b. names the field"
fresh; pair; mkpr 5 "$I"; echo "error connecting to api.github.com" > "$MT_STATE/err.graphql"
run 5 "$I" "$B"; ok "$rc" 8 "13c. a transient graphql read exits 8"
fresh; pair; mkpr 5 "$I"; touch "$MT_STATE/merge.queue"
run 5 "$I" "$B"
ok "$rc" 1 "13d. a queued merge exits 1"; has "$out" "not confirmed merged" "13d. not confirmed merged"
has "$(glog)" "pr merge 5 -R o/r --disable-auto" "13d. auto-merge is disabled"
has "$out" "auto-merge disable ok" "13d. says the disable worked"
lacks "$out" "RACE:" "13d. no RACE"; lacks "$(glog)" "commits/" "13d. no commit read"
fresh; pair; mkpr 5 "$I"; touch "$MT_STATE/merge.noop"
run 5 "$I" "$B"
ok "$rc" 1 "13e. gh 0 with nothing merged and no auto-merge exits 1, never 8"
has "$out" "auto-merge disable n/a" "13e. auto-merge disable n/a"
lacks "$(glog)" "--disable-auto" "13e. no --disable-auto call"; ok "$(sent)" "failed:1" "13e. failed:1"

# 14. late confirmation
fresh; pair; mkpr 5 "$I"; echo 2 > "$MT_STATE/merge.lag"; echo 1 > "$MT_STATE/pr/5/mergeCommit.lag"
run 5 "$I" "$B"
ok "$rc" 0 "14a. MERGED after 2 reads, mergeCommit after one more: exits 0"; ok "$(sent)" "ok" "14a. ok"
fresh; pair; mkpr 5 "$I"; echo 100 > "$MT_STATE/pr/5/mergeCommit.lag"; seed 5 "$(b 1)"
run 5 "$I" "$B"
ok "$rc" 8 "14b. mergeCommit null for the whole bound exits 8"; has "$out" "UNVERIFIED:" "14b. prints UNVERIFIED"
ok "$(sent)" "failed:8" "14b. failed:8"; ok "$(ctr 5)" "$(b 1)" "14b. the counter is untouched"
rm -f "$MT_STATE/pr/5/mergeCommit.lag"
run 5 "$I" "$B"
ok "$rc" 0 "14b. a re-run with mergeCommit populated exits 0"; ok "$(sent)" "ok" "14b. re-run: ok"; ok "$(nmerge)" 0 "14b. re-run: no merge call"

# 15. a transient merge call: nothing claimed, the re-run merges
fresh; pair; mkpr 5 "$I"; touch "$MT_STATE/merge.neterr"
run 5 "$I" "$B"
ok "$rc" 8 "15. a network error on the merge exits 8"; has "$out" "nothing changed" "15. says nothing changed"
rm -f "$MT_STATE/merge.neterr"
run 5 "$I" "$B"; ok "$rc" 0 "15. the re-run merges"

# 16. the kept required-checks logic
row() { printf '%s\t%s\t1m\thttps://github.com/o/r/actions/runs/7/job/8\t' "$1" "$2"; }
chk() {  # chk <rc> <stdout> <stderr> — append one `pr checks --watch` result
  python3 -c 'import json,sys; print(json.dumps({"rc": int(sys.argv[1]), "out": sys.argv[2], "err": sys.argv[3]}))' "$@" >> "$MT_STATE/checks.seq"
}
fresh; pair; mkpr 5 "$I" UNSTABLE
run 5 "$I" "$B"; ok "$rc" 0 "16a. UNSTABLE with required checks green merges"; ok "$(nmerge)" 1 "16a. merged"
fresh; pair; mkpr 5 "$I" UNSTABLE; echo 1 > "$MT_STATE/inflight"
chk 1 "" "no checks reported on the 'audit-fix/t5' branch"; chk 0 "$(row ci pass)" ""
run 5 "$I" "$B"
ok "$rc" 0 "16b. an absent check with CI in flight waits, then merges"
has "$out" "CI in flight on head — waiting" "16b. reads the absent check as pending"
has "$(glog)" "actions/runs?head_sha=$I" "16b. probes runs on the integrated head"
fresh; pair; mkpr 5 "$I" BLOCKED; seed 5 "$(b 1)"
chk 1 "$(row ci fail)" ""; echo "https://github.com/o/r/actions/runs/7/job/8" > "$MT_STATE/links"; echo "Run tests" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16c. a red required check on a genuine step exits 1"; lacks "$(glog)" "run rerun" "16c. no rerun"
fresh; pair; mkpr 5 "$I" BLOCKED; seed 5 "$(b 1)"
chk 1 "$(row ci pending)" "error connecting to api.github.com"
run 5 "$I" "$B"
ok "$rc" 8 "16d. a transient checks error with no red row exits 8"; has "$out" "retryable: gh pr checks failed" "16d. says so"
lacks "$(glog)" "run rerun" "16d. no rerun"; ok "$(nmerge)" 0 "16d. nothing merged"; ok "$(ctr 5)" "$(b 1)" "16d. the counter is untouched"
fresh; pair; mkpr 5 "$I" BLOCKED
chk 1 "$(row integration-timeout fail)" ""; echo "https://github.com/o/r/actions/runs/7/job/8" > "$MT_STATE/links"
echo "Run integration tests" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16e. a red check named integration-timeout exits 1"; lacks "$(glog)" "run rerun" "16e. no rerun"
fresh; pair; mkpr 5 "$I" BLOCKED
chk 1 "$(row integration-timeout fail)" "timed out"; echo "https://github.com/o/r/actions/runs/7/job/8" > "$MT_STATE/links"
echo "Run integration tests" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16f. a red row with 'timed out' on stderr still exits 1"

# 17. already merged, verified: no merge call, the anchor ref deleted
fresh; pair; M=$(mk "$B" squash); git --git-dir "$MT_SRV" update-ref refs/heads/master "$M"
mkpr 5 "$I" CLEAN MERGED; echo "$M" > "$MT_STATE/pr/5/mergeCommit"; anchor 5
run 5 "$I" "$B"
ok "$rc" 0 "17. already merged and verified exits 0"; ok "$(sent)" "ok" "17. ok"
ok "$(nmerge)" 0 "17. no merge call"; ok "$(has_anchor 5)" no "17. the anchor ref is deleted"

# 18. the fetch fails after the merge: 6, never "fast-forwarded"; the re-run takes the already-merged path
fresh; pair; mkpr 5 "$I"
echo "git -C '$tmp/repo' remote set-url origin '$tmp/nowhere/github.com/o/r.git'" > "$MT_STATE/merge.hook"
run 5 "$I" "$B"
ok "$rc" 6 "18. a failed fetch after the merge exits 6"; ok "$(sent)" "failed:6" "18. failed:6"
lacks "$out" "fast-forwarded" "18. never says fast-forwarded"
gc remote set-url origin "$MT_SRV"
run 5 "$I" "$B"
ok "$rc" 0 "18. the re-run exits 0"; ok "$(sent)" "ok" "18. re-run: ok"
ok "$(gc rev-parse HEAD)" "$(srvtip)" "18. the checkout is at the merge"

# 19. static guard: no bypass, no update-branch, no single-field read, no unanchored PR-number parse
code=$(grep -v '^[[:space:]]*#' "$MT")
ok "$(printf '%s\n' "$code" | grep -cE -- '--admin|update-branch|prfield')" 0 "19. no --admin, update-branch or prfield in code"
ok "$(printf '%s\n' "$code" | grep -E 'gh (pr|repo) view' | grep -cE -- ' -q |--jq|--template')" 0 "19. no -q/--jq/--template on gh pr/repo view"
ok "$(printf '%s\n' "$code" | grep -cF "grep -oE '[0-9]+' | tail -1")" 0 "19. no unanchored PR-number parse"

# 20. already MERGED at a head that is not the integrated head (parents match): RACE, terminal
fresh; pair; O=$(mk "$B" other); M=$(mk "$B" squash); git --git-dir "$MT_SRV" update-ref refs/heads/master "$M"
mkpr 5 "$O" CLEAN MERGED; echo "$M" > "$MT_STATE/pr/5/mergeCommit"
run 5 "$I" "$B"
ok "$rc" 5 "20. merged at another head exits 5"; has "$out" "RACE:" "20. prints RACE"; ok "$(nmerge)" 0 "20. no merge call"
run 5 "$I" "$B"; ok "$rc" 5 "20. a re-run exits 5 again"

# 21. GitHub says merged, but origin/master lacks the merge commit: 6, no fast-forward
fresh; pair; mkpr 5 "$I"; touch "$MT_STATE/merge.nosrv"
held=$(gc rev-parse HEAD)
run 5 "$I" "$B"
ok "$rc" 6 "21. origin/master lacking the merge exits 6"; has "$out" "lacks merge" "21. says origin/master lacks it"
lacks "$out" "fast-forwarded" "21. never says fast-forwarded"; ok "$(gc rev-parse HEAD)" "$held" "21. no fast-forward"

echo; [ "$fail" -eq 0 ] && echo "merge-task integrated: ALL PASS" || echo "merge-task integrated: SOME FAILED"
exit "$fail"
