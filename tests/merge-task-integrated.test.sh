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

# 1. usage and PR normalisation: exit 2 with zero gh calls; a pre-seeded counter is byte-unchanged. The previous
#    call's `ok` (PR 5 merged) never survives a malformed next call: the sentinel is cleared before the arg count.
fresh; pair; mkpr 5 "$I"
mkdir -p "$tmp/repo/.claude"; printf 'ok\n' > "$tmp/repo/.claude/merge-task.status"
: > "$MT_STATE/gh.log"
out=$(PATH="$tmp/bin:$PATH" bash "$MT" "$tmp/repo" 6 "$I" 2>&1); rc=$?
ok "$rc" 2 "1. three args exits 2"; ok "$(glog)" "" "1. three args: zero gh calls"
ok "$(sent)" "failed:2" "1. three args after an ok: the previous call's ok is replaced by failed:2"
printf 'ok\n' > "$tmp/repo/.claude/merge-task.status"
out=$(PATH="$tmp/bin:$PATH" bash "$MT" "$tmp/repo" 6 "$I" "$B" extra 2>&1); rc=$?
ok "$rc" 2 "1. five args exits 2"; ok "$(sent)" "failed:2" "1. five args after an ok: failed:2"
mkdir -p "$tmp/plain/.claude"; printf 'ok\n' > "$tmp/plain/.claude/merge-task.status"
out=$(PATH="$tmp/bin:$PATH" bash "$MT" "$tmp/plain" 6 "$I" "$B" 2>&1); rc=$?
ok "$rc" 2 "1. not a repo exits 2"; has "$out" "is not a git repo" "1. says it is not a git repo"
case "$out" in *"merge-task args:"*) ok y n "1. not a repo is the environment, never merge-task args: (p29-7)";; *) ok y y "1. not a repo is the environment, never merge-task args: (p29-7)";; esac
ok "$(cat "$tmp/plain/.claude/merge-task.status")" "failed:2" "1. not a repo: an earlier ok there is replaced by failed:2"
run 5 "zz${I#??}" "$B"; ok "$rc" 2 "1. a non-hex head exits 2"; ok "$(glog)" "" "1. non-hex head: zero gh calls"
has "$out" "ERROR: merge-task args: integrated head" "1. a non-hex head is the task's own argument: merge-task args: (p29-7)"
run 5 "$I" "${B:0:12}"; ok "$rc" 2 "1. a short base exits 2"; ok "$(glog)" "" "1. short base: zero gh calls"
has "$out" "ERROR: merge-task args: integrated base" "1. a short base: merge-task args:"
ok "$(sent)" "failed:2" "1. a SHA exit 2 writes failed:2"
seed 5 "$B"
run "https://github.com/x/y/pull/5" "$I" "$B"
ok "$rc" 2 "1. a foreign-repo URL exits 2"; has "$out" "PR URL https://github.com/x/y/pull/5 is in x/y, but origin is o/r" "1. names both repos"
has "$out" "ERROR: merge-task args: PR URL" "1. a foreign-repo URL: merge-task args:"
ok "$(sent)" "failed:2" "1. foreign URL: failed:2"; ok "$(glog)" "" "1. foreign URL: zero gh calls"
ok "$(ctr 5)" "$B" "1. foreign URL: the counter is byte-unchanged"
for a in https://github.com/o/r/issues/5 05 0 5x https://www.github.com/o/r/pull/5; do
  run "$a" "$I" "$B"
  ok "$rc" 2 "1. '$a' exits 2"; ok "$(glog)" "" "1. '$a': zero gh calls"
done
has "$out" "cannot parse a PR number from" "1. says it cannot parse the PR"
has "$out" "ERROR: merge-task args: cannot parse" "1. an unparseable PR: merge-task args:"
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
#     "No checks wait" is proven by the record, not the clock: a `sleep` stub first on PATH logs each call and
#     returns at once, and CHECK_INTERVAL is a distinctive 7, so a halt that sleeps one CHECK_INTERVAL leaves a
#     `7`. 16b, run under the same stub, is the positive control that the stub sees merge-task's sleeps.
fresh; pair; mkpr 5 "$I" BLOCKED; echo REVIEW_REQUIRED > "$MT_STATE/pr/5/reviewDecision"
mkdir -p "$tmp/sleepbin"; : > "$tmp/sleeps"
printf '#!/bin/sh\necho "$*" >> "%s/sleeps"\n' "$tmp" > "$tmp/sleepbin/sleep"; chmod +x "$tmp/sleepbin/sleep"
MERGE_TASK_CHECK_INTERVAL=7 PATH="$tmp/sleepbin:$PATH" run 5 "$I" "$B"
ok "$rc" 7 "12a. BLOCKED + REVIEW_REQUIRED exits 7"
has "$out" "review required: approve PR #5 (https://github.com/o/r/pull/5)" "12a. names the PR and its URL"
has "$out" "never bypasses protection" "12a. says it never bypasses protection"
ok "$(nmerge)" 0 "12a. no merge call"; lacks "$(glog)" "pr checks" "12a. no checks wait"
lacks "$(glog)" "branches/" "12a. no protection read"; lacks "$(glog)" "rules/" "12a. no rules read"
ok "$(grep -cx 7 "$tmp/sleeps")" 0 "12a. never sleeps one CHECK_INTERVAL before halting (sleep calls: $(tr '\n' ' ' < "$tmp/sleeps"))"
fresh; pair; mkpr 5 "$I" BLOCKED; echo CHANGES_REQUESTED > "$MT_STATE/pr/5/reviewDecision"
run 5 "$I" "$B"; ok "$rc" 7 "12b. BLOCKED + CHANGES_REQUESTED exits 7"
fresh; pair; mkpr 5 "$I" BLOCKED
run 5 "$I" "$B"
ok "$rc" 1 "12c. BLOCKED, no review pending, green checks exits 1"; has "$out" "NON-check gate" "12c. names the non-check gate"
ok "$(sent)" "failed:1" "12c. failed:1, never 8"
ok "$(awk '/^pr checks/{c=1} c && /^pr view/{v=1} END{print v ? "y" : "n"}' "$MT_STATE/gh.log")" y "12c. the PR is re-read after the checks wait"
lacks "$(glog)" "--admin" "12c. no --admin in any argv"
ok "$(grep -c '^api repos/o/r/branches/master$' "$MT_STATE/gh.log")" 1 "12c. one required-gate read (ADR 0069): protected, so some"
lacks "$(glog)" "rules/" "12c. protected needs no rules read"
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
fresh; pair; mkpr 5 "$I" UNSTABLE
run 5 "$I" "$B"; ok "$rc" 0 "16a. UNSTABLE with required checks green merges"; ok "$(nmerge)" 1 "16a. merged"
# 16b. the wait's sample reads BLOCKED (a required check its CI has yet to create), so the absent check is waited on
#      through the in-flight read. Every mergeStateStatus.seq counts the pre-pass's read first.
fresh; pair; mkpr 5 "$I" UNSTABLE; echo 1 > "$MT_STATE/inflight"
printf '%s\n' UNSTABLE UNSTABLE BLOCKED UNSTABLE > "$MT_STATE/pr/5/mergeStateStatus.seq"
chk 1 "" "no checks reported on the 'audit-fix/t5' branch"; chk 0 "$(row ci pass)" ""
: > "$tmp/sleeps"; MERGE_TASK_CHECK_INTERVAL=7 PATH="$tmp/sleepbin:$PATH" run 5 "$I" "$B"
ok "$rc" 0 "16b. an absent check with CI in flight waits, then merges"
ok "$(grep -cx 7 "$tmp/sleeps")" 1 "16b. (12a's control) the wait is one CHECK_INTERVAL through the sleep stub"
has "$out" "CI in flight on head — waiting" "16b. reads the absent check as pending"
has "$(glog)" "actions/runs?head_sha=$I" "16b. probes runs on the integrated head"
# 16c. a gh with --json on pr checks (checks.json): the --json path reads a genuine step and halts. 16e and 16f
#      read the same verdict from gh 2.43.1's table.
fresh; pair; mkpr 5 "$I" BLOCKED; seed 5 "$(b 1)"; touch "$MT_STATE/checks.json"
chk 1 "$(row ci fail)" ""; echo "https://github.com/o/r/actions/runs/7/job/8" > "$MT_STATE/links"; echo "Run tests" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16c. --json gh: a red required check on a genuine step exits 1"; lacks "$(glog)" "run rerun" "16c. no rerun"
ok "$(grep -cx 'pr checks 5 -R o/r --required' "$MT_STATE/gh.log")" 0 "16c. read --json, never the table"
fresh; pair; mkpr 5 "$I" BLOCKED; seed 5 "$(b 1)"
chk 1 "$(row ci pending)" "error connecting to api.github.com"
run 5 "$I" "$B"
ok "$rc" 8 "16d. a transient checks error with no red row exits 8"; has "$out" "retryable: gh pr checks failed" "16d. says so"
lacks "$(glog)" "run rerun" "16d. no rerun"; ok "$(nmerge)" 0 "16d. nothing merged"; ok "$(ctr 5)" "$(b 1)" "16d. the counter is untouched"
fresh; pair; mkpr 5 "$I" BLOCKED
chk 1 "$(row integration-timeout fail)" ""
echo "Run integration tests" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16e. a red check named integration-timeout exits 1"; lacks "$(glog)" "run rerun" "16e. no rerun"
fresh; pair; mkpr 5 "$I" BLOCKED
chk 1 "$(row integration-timeout fail)" "timed out"
echo "Run integration tests" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16f. a red row with 'timed out' on stderr still exits 1"
# 16g. gh 2.43.1 (the fake's default) refuses `pr checks --json`: the infra re-run reads the failed required
#      checks from the plain table instead (p37-2), so an infra-only red is re-run, not set aside as genuine.
#      Only the failing row's run is re-run; the passing row's run is left alone.
fresh; pair; mkpr 5 "$I" UNSTABLE
chk 1 "$(printf '%s\n%s' "$(row ci fail)" "lint	pass	1m	https://github.com/o/r/actions/runs/3/job/4	")" ""
chk 0 "$(row ci pass)" ""
echo "Set up job" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 0 "16g. gh 2.43.1: an infra-only red is re-run, then merges"; ok "$(nmerge)" 1 "16g. merged"
has "$(glog)" "pr checks 5 -R o/r --required --json" "16g. tried --json first"
ok "$(grep -cx 'pr checks 5 -R o/r --required' "$MT_STATE/gh.log")" 1 "16g. read the plain table once"
has "$(glog)" "run rerun 7 --failed" "16g. re-ran the failing row's run"
lacks "$(glog)" "run rerun 3" "16g. never the passing row's run"
has "$out" "re-ran failed jobs of run 7" "16g. says so"
# 16h. a gh with --json on pr checks reads the links from it and never the table.
fresh; pair; mkpr 5 "$I" UNSTABLE; touch "$MT_STATE/checks.json"
chk 1 "$(row ci fail)" ""; chk 0 "$(row ci pass)" ""
echo "https://github.com/o/r/actions/runs/7/job/8" > "$MT_STATE/links"; echo "Set up job" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 0 "16h. --json gh: an infra-only red is re-run, then merges"; has "$(glog)" "run rerun 7 --failed" "16h. re-ran run 7"
ok "$(grep -cx 'pr checks 5 -R o/r --required' "$MT_STATE/gh.log")" 0 "16h. never the plain table"
# 16i. gh 2.43.1 and a red row with no run link: nothing to re-run, genuine (fail-closed).
fresh; pair; mkpr 5 "$I" BLOCKED
chk 1 "ext-status	fail	0	https://example.com/status	" ""; echo "Set up job" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 1 "16i. a red row with no run link exits 1"; lacks "$(glog)" "run rerun" "16i. no rerun"
# 16j. two failed required runs: run 7 failed on setup, run 9 (cancelled, timed out or errored) holds no failed step.
#      The per-run guard stops as genuine on run 9 before any re-run, so run 7's setup failure never re-runs
#      run 9. gh 2.43.1's table (whose `fail` holds CANCELLED too), then a --json gh's buckets: the same verdict.
for j in table json; do
  fresh; pair; mkpr 5 "$I" BLOCKED
  [ "$j" = json ] && { touch "$MT_STATE/checks.json"
    printf '%s\n' https://github.com/o/r/actions/runs/7/job/8 https://github.com/o/r/actions/runs/9/job/10 > "$MT_STATE/links"; }
  chk 1 "$(printf '%s\n%s' "$(row ci fail)" "e2e	fail	1m	https://github.com/o/r/actions/runs/9/job/10	")" ""
  echo "Set up job" > "$MT_STATE/steps.7"; : > "$MT_STATE/steps.9"
  run 5 "$I" "$B"
  ok "$rc" 1 "16j ($j). a selected run with no failed step exits 1"; lacks "$(glog)" "run rerun" "16j ($j). no rerun"
  has "$out" "run 9 has no failed step to classify" "16j ($j). names run 9"
  if [ "$j" = json ]; then ok "$(grep -cx 'pr checks 5 -R o/r --required' "$MT_STATE/gh.log")" 0 "16j (json). never the table"
    has "$(glog)" 'select(.bucket=="fail" or .bucket=="cancel")' "16j (json). selects the table's rows: the fail and cancel buckets"
  else ok "$(grep -cx 'pr checks 5 -R o/r --required' "$MT_STATE/gh.log")" 1 "16j (table). read the plain table once"; fi
done
# 16k. gh 2.43.1, a fail row whose description is a URL: column 4 is the link, so run 7 is re-run, never skipped.
fresh; pair; mkpr 5 "$I" UNSTABLE
chk 1 "ci	fail	1m	https://github.com/o/r/actions/runs/7/job/8	https://status.example.com/incident" ""
chk 0 "$(row ci pass)" ""
echo "Set up job" > "$MT_STATE/steps"
run 5 "$I" "$B"
ok "$rc" 0 "16k. a URL description never hides the link: re-run, then merges"; has "$(glog)" "run rerun 7 --failed" "16k. re-ran run 7"

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

# 22. a bad MERGE_TASK_* override exits 2 before any GitHub call: the cap never fails open. The first case is
#     the review's repro (a non-numeric cap and a moved base once aborted in `$((…))` and exited 0).
fresh; pair; mkpr 5 "$I"; X=$(mk "$B" moved); echo "$X" > "$MT_STATE/base.seq"; seed 5 "$(b 1)"
MERGE_TASK_REINTEGRATE_MAX=three run 5 "$I" "$B"
ok "$rc" 2 "22. MERGE_TASK_REINTEGRATE_MAX=three exits 2"; ok "$(glog)" "" "22. three: zero gh calls"
has "$out" "MERGE_TASK_REINTEGRATE_MAX='three' is not a non-negative integer" "22. names the override"
ok "$(sent)" "failed:2" "22. three: failed:2"; ok "$(ctr 5)" "$(b 1)" "22. three: the counter is byte-unchanged"
for v in -1 08 1.5 ' 3' 9999999999 99999999999999999999; do
  MERGE_TASK_REINTEGRATE_MAX="$v" run 5 "$I" "$B"
  ok "$rc" 2 "22. MERGE_TASK_REINTEGRATE_MAX='$v' exits 2"; ok "$(glog)" "" "22. '$v': zero gh calls"
done
for e in CHECK_INTERVAL STATE_INTERVAL CONFIRM_INTERVAL READ_TRIES READ_INTERVAL HEAD_LAG_INTERVAL FETCH_TIMEOUT; do
  out=$(env "MERGE_TASK_$e=x" PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" 5 "$I" "$B" 2>&1); rc=$?
  ok "$rc" 2 "22. MERGE_TASK_$e=x exits 2"; has "$out" "MERGE_TASK_$e='x'" "22. names MERGE_TASK_$e"
done
ok "$(ctr 5)" "$(b 1)" "22. the counter is still byte-unchanged"
MERGE_TASK_REINTEGRATE_MAX=0 run 5 "$I" "$B"
ok "$rc" 4 "22. a valid MERGE_TASK_REINTEGRATE_MAX=0 sets aside on the first new refusal"

# 23. an abort never exits 0 and never reads ok. A gh that dies in a `set -u` abort, injected through BASH_ENV:
#     the arithmetic form keeps $? (0 here: bash 3.2 then exited 0), the plain form exits 1 (read as a halt).
printf 'gh() { : $((MT_ABORT_UNSET + 1)); }\n' > "$tmp/abort-arith.sh"
printf 'gh() { : "$MT_ABORT_UNSET"; }\n' > "$tmp/abort-plain.sh"
unset MT_ABORT_UNSET
for f in arith plain; do
  fresh; pair; mkpr 5 "$I"; seed 5 "$(b 1)"; printf 'ok\n' > "$tmp/repo/.claude/merge-task.status"
  : > "$MT_STATE/gh.log"
  out=$(BASH_ENV="$tmp/abort-$f.sh" PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" 5 "$I" "$B" 2>&1); rc=$?
  ok "$rc" 70 "23. a $f abort exits 70, never 0"; ok "$(sent)" "failed:abort" "23. $f abort: failed:abort, never ok"
  ok "$(ctr 5)" "$(b 1)" "23. $f abort: the counter is byte-unchanged"; ok "$(nmerge)" 0 "23. $f abort: nothing merged"
done

# 24. a permanent merge refusal is definitive (1), never a retryable 8 the lead re-runs to its bound
for t in "GraphQL: Squash merges are not allowed on this repository. (mergePullRequest)" \
         "GraphQL: Repository rule violations found (mergePullRequest)"; do
  fresh; pair; mkpr 5 "$I"; seed 5 "$(b 1)"; printf '%s\n' "$t" > "$MT_STATE/merge.refuse"
  run 5 "$I" "$B"
  ok "$rc" 1 "24. '$t' exits 1"; ok "$(sent)" "failed:1" "24. failed:1"; ok "$(nmerge)" 1 "24. exactly one merge call"
  has "$out" "GitHub refused to merge PR #5" "24. says GitHub refused"; lacks "$out" "nothing changed" "24. never the retryable text"
done

# 25. GitHub's lazy mergeability (ADR 0069): the default branch's required gate (branches/<b>, then rules/branches/<b>)
#     reads some, none or unknown; with none a PR never waits on checks, and one GitHub has not settled (UNKNOWN or
#     BLOCKED with nothing required, or UNKNOWN once its checks went green) is re-polled, then exits 8, never 1. Every
#     mergeStateStatus.seq counts the pre-pass's read (`before the merge`) first.
SETTLE="GitHub has not settled its mergeability"
mss() { printf '%s\n' "$@" > "$MT_STATE/pr/5/mergeStateStatus.seq"; }
nlog() { grep -c -- "$1" "$MT_STATE/gh.log" 2>/dev/null; }
# (a) lachyts/chorus's shape (protected false, rulesets need GitHub Pro): UNKNOWN re-polled until CLEAN, no checks wait
fresh; pair; mkpr 5 "$I"; echo unprotected > "$MT_STATE/branch"; echo 403-plan > "$MT_STATE/rules"
mss UNKNOWN UNKNOWN UNKNOWN CLEAN
run 5 "$I" "$B"
ok "$rc" 0 "25a. chorus shape: UNKNOWN re-polled until CLEAN merges"; ok "$(sent)" "ok" "25a. ok"; ok "$(nmerge)" 1 "25a. one merge"
lacks "$(glog)" "pr checks" "25a. no checks wait"
ok "$(nlog '^api repos/o/r/branches/master$')" 1 "25a. the branch read once across the re-polls"
ok "$(nlog '^api repos/o/r/rules/branches/master')" 1 "25a. the rules read once across the re-polls"
has "$out" "nothing required on master" "25a. says nothing is required"
# (b) a protection-less repo never waits on checks: UNSTABLE merges at once
fresh; pair; mkpr 5 "$I" UNSTABLE; echo unprotected > "$MT_STATE/branch"
run 5 "$I" "$B"
ok "$rc" 0 "25b. unprotected, no rules, UNSTABLE: merges"; ok "$(nmerge)" 1 "25b. one merge"
lacks "$(glog)" "pr checks" "25b. a protection-less repo never waits on checks"
# (c) the incident (chorus PR #632): UNKNOWN sticky, no check reported, nothing in flight → 8, never "never appeared"
fresh; pair; mkpr 5 "$I" UNKNOWN; echo unprotected > "$MT_STATE/branch"; echo 403-plan > "$MT_STATE/rules"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"; seed 5 "$(b 1)"
run 5 "$I" "$B"
ok "$rc" 8 "25c. the incident's shape exits 8"; ok "$(sent)" "failed:8" "25c. failed:8"; ok "$(nmerge)" 0 "25c. nothing merged"
ok "$(ctr 5)" "$(b 1)" "25c. the counter is untouched"; has "$out" "$SETTLE" "25c. carries the settling mark"
lacks "$(glog)" "pr checks" "25c. no checks wait"; lacks "$out" "never appeared" "25c. never 'never appeared'"
# (d) chorus shape, BLOCKED with no review pending: re-polled, then 8, never the NON-check gate
fresh; pair; mkpr 5 "$I" BLOCKED; echo unprotected > "$MT_STATE/branch"; echo 403-plan > "$MT_STATE/rules"
run 5 "$I" "$B"
ok "$rc" 8 "25d. chorus shape, BLOCKED: exits 8"; has "$out" "$SETTLE" "25d. the settling mark"
has "$out" "stays BLOCKED with nothing required on master" "25d. says it stays BLOCKED with nothing required"
lacks "$out" "NON-check gate" "25d. never the NON-check gate"
# (e) unprotected, but a ruleset requires a check: some, today's wait and 12c's exit 1
fresh; pair; mkpr 5 "$I" BLOCKED; echo unprotected > "$MT_STATE/branch"
echo '[{"type":"deletion"},{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"ci"}]}}]' > "$MT_STATE/rules"
run 5 "$I" "$B"
ok "$rc" 1 "25e. a required_status_checks rule: exits 1 (12c)"; has "$out" "NON-check gate" "25e. NON-check gate"
has "$(glog)" "pr checks" "25e. waits on the required checks"
# (e2) thread-skill's shape: protected by a ruleset (classic protection off): some, with no rules read
fresh; pair; mkpr 5 "$I" BLOCKED; echo ruleset > "$MT_STATE/branch"
run 5 "$I" "$B"
ok "$rc" 1 "25e2. protected by a ruleset: exits 1 (12c)"; has "$(glog)" "pr checks" "25e2. waits on the required checks"
lacks "$(glog)" "rules/" "25e2. protected true needs no rules read"
# (e3) Animately/optimizer's develop (the 2026-11-07 incident): protected with `contexts: []` and `checks: []`, so the
#      gate reads some (branches/<b> cannot show a non-check gate). An UNSTABLE PR (red only on optional checks) with no
#      required check reported merges on the checks wait's first pass, never 'never appeared', with no in-flight read.
fresh; pair; mkpr 5 "$I" UNSTABLE; echo nochecks > "$MT_STATE/branch"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 0 "25e3. protected with empty contexts, UNSTABLE: merges"; ok "$(sent)" "ok" "25e3. ok"; ok "$(nmerge)" 1 "25e3. one merge"
has "$out" "required gate: some" "25e3. the gate stays some"; lacks "$out" "never appeared" "25e3. never 'never appeared'"
has "$out" "no required checks and mergeStateStatus=UNSTABLE — nothing to wait for" "25e3. the wait's sample takes UNSTABLE"
lacks "$(glog)" "actions/runs" "25e3. no in-flight read"
ok "$(nlog '^pr checks')" 1 "25e3. one checks wait, no absent-poll budget spent"
# (e4) the same with the gate unreadable (a 502 on the branch read): UNSTABLE with no required check still merges
fresh; pair; mkpr 5 "$I" UNSTABLE; echo "gh: Server Error (HTTP 502)" > "$MT_STATE/err.branch"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 0 "25e4. unknown gate, UNSTABLE, no required check: merges"; ok "$(nmerge)" 1 "25e4. one merge"
lacks "$out" "$SETTLE" "25e4. never the settling 8"
# (e5) the guard's sample reads BLOCKED (a required check GitHub has not reported yet): never merged by the guard;
#      absent checks with nothing in flight stay 25g's exit 1
fresh; pair; mkpr 5 "$I"; echo nochecks > "$MT_STATE/branch"; mss UNSTABLE UNSTABLE BLOCKED
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 1 "25e5. the guard reads BLOCKED: exits 1"; ok "$(nmerge)" 0 "25e5. nothing merged"
has "$out" "required checks never appeared for PR #5" "25e5. the never-appeared text"
# (e6) the compression-engine incident (PRs #151/#152): UNSTABLE, no required check reported, an optional run still
#      going on the head (or parked on a deployment approval). The wait's UNSTABLE sample is taken before any in-flight
#      read, so it merges at once and never holds the Integration lane on an optional run.
fresh; pair; mkpr 5 "$I" UNSTABLE; echo nochecks > "$MT_STATE/branch"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; chk 0 "$(row ci pass)"; echo 1 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 0 "25e6. UNSTABLE with an optional run in flight: merges"; ok "$(nmerge)" 1 "25e6. one merge"
ok "$(nlog '^pr checks')" 1 "25e6. one checks wait: never waits on the optional run"
lacks "$out" "CI in flight on head — waiting" "25e6. the optional run is never waited on"
lacks "$(glog)" "actions/runs" "25e6. no in-flight read: a probe error cannot decide the merge"
# (e7) a BLOCKED entry whose wait samples UNSTABLE once (a flap: BLOCKED, BLOCKED, UNSTABLE, BLOCKED) does not trust it:
#      the base's wait, ending in the never-appeared exit 1 (retried as GitHub-side infra), never the NON-check gate's.
fresh; pair; mkpr 5 "$I"; echo nochecks > "$MT_STATE/branch"; mss BLOCKED BLOCKED UNSTABLE BLOCKED
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 1 "25e7. a BLOCKED entry flapping to UNSTABLE: exits 1"; ok "$(nmerge)" 0 "25e7. nothing merged"
has "$out" "required checks never appeared for PR #5" "25e7. the never-appeared text, an infra retry"
lacks "$out" "NON-check gate" "25e7. never the NON-check gate's human stop"
# (e8) a BLOCKED entry that settles UNSTABLE: the never-appeared exit 1, then its infra retry enters from UNSTABLE and
#      merges.
fresh; pair; mkpr 5 "$I"; echo nochecks > "$MT_STATE/branch"; mss BLOCKED BLOCKED UNSTABLE
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 1 "25e8. a BLOCKED entry, the wait reading UNSTABLE: exits 1"; ok "$(nmerge)" 0 "25e8. nothing merged"
has "$out" "required checks never appeared for PR #5" "25e8. the never-appeared text"
run 5 "$I" "$B"
ok "$rc" 0 "25e8. the infra retry enters from UNSTABLE: merges"; ok "$(nmerge)" 1 "25e8. one merge on the retry"
# (e9) an UNSTABLE entry whose wait sample fails (an empty mergeStateStatus fails the read; one try) never merges on
#      the state machine's stale UNSTABLE: it counts an absent pass and merges on the next pass's UNSTABLE sample.
fresh; pair; mkpr 5 "$I"; echo nochecks > "$MT_STATE/branch"; mss UNSTABLE UNSTABLE "" UNSTABLE
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 0 "25e9. a failed wait sample, then UNSTABLE: merges"; ok "$(nmerge)" 1 "25e9. one merge"
ok "$(nlog '^pr checks')" 2 "25e9. the failed sample fell through: a second checks pass"
# (f) the branch read fails transiently: unknown, so today's wait; checks absent with nothing in flight → 8, not 1
fresh; pair; mkpr 5 "$I" BLOCKED; echo "gh: Server Error (HTTP 502)" > "$MT_STATE/err.branch"
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 8 "25f. an unreadable gate and absent checks exit 8"; has "$out" "retryable:" "25f. retryable"
has "$out" "$SETTLE" "25f. the settling mark"; lacks "$out" "never appeared" "25f. never 'never appeared'"
ok "$(nlog '^api repos/o/r/branches/master$')" 2 "25f. the branch read tried READ_TRIES (2) times"
lacks "$(glog)" "rules/" "25f. no rules read"; has "$(glog)" "pr checks" "25f. waits on the required checks"
# (g) the control: something is required (the fake's default), checks absent with nothing in flight → 1
fresh; pair; mkpr 5 "$I" BLOCKED
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 1 "25g. required checks that never appeared while something is required: exit 1"
has "$out" "required checks never appeared for PR #5" "25g. the never-appeared text"
# (h) a branch read that is no clean answer reads unknown: today's wait, and 12c's exit 1
for v in 404-notfound 404-branch 403-integration 403-rate noflag; do
  fresh; pair; mkpr 5 "$I" BLOCKED; echo "$v" > "$MT_STATE/branch"
  run 5 "$I" "$B"
  has "$(glog)" "pr checks" "25h. branch $v reads unknown: waits on the required checks"
  ok "$rc" 1 "25h. branch $v: exits 1"; has "$out" "NON-check gate" "25h. branch $v: NON-check gate"
done
# (h-rules) a rules read that is rate-limited or not found reads unknown, never none
for v in 403-rate 404; do
  fresh; pair; mkpr 5 "$I" BLOCKED; echo unprotected > "$MT_STATE/branch"; echo "$v" > "$MT_STATE/rules"
  run 5 "$I" "$B"
  has "$(glog)" "pr checks" "25h-rules. rules $v reads unknown: waits on the required checks"
  ok "$rc" 1 "25h-rules. rules $v: exits 1"; lacks "$out" "$SETTLE" "25h-rules. rules $v: never none"
done
# (i) the review gate fires before the gate read: 12a asserts no branches/ and no rules/ read.
# (j) UNKNOWN once the required checks went green is re-polled, never the NON-check gate (12c keeps BLOCKED's exit 1)
fresh; pair; mkpr 5 "$I"; mss UNKNOWN UNKNOWN UNKNOWN CLEAN
run 5 "$I" "$B"
ok "$rc" 0 "25j. UNKNOWN after green checks, then CLEAN: merges"; ok "$(nmerge)" 1 "25j. one merge"
lacks "$out" "NON-check gate" "25j. never the NON-check gate"
# (k) the recompute guard's CLEAN sample, then UNKNOWN again: re-polled, never the NON-check gate
fresh; pair; mkpr 5 "$I"; mss UNKNOWN UNKNOWN CLEAN UNKNOWN CLEAN
chk 1 "" "no required checks reported on the 'audit-fix/t5' branch"; echo 0 > "$MT_STATE/inflight"
run 5 "$I" "$B"
ok "$rc" 0 "25k. the guard's CLEAN, then UNKNOWN, then CLEAN: merges"; ok "$(nmerge)" 1 "25k. one merge"
lacks "$out" "NON-check gate" "25k. never the NON-check gate"
# (l) UNKNOWN that never settles after green checks: 8 after LAZY_REPOLL_MAX (6) re-polls
fresh; pair; mkpr 5 "$I" UNKNOWN
run 5 "$I" "$B"
ok "$rc" 8 "25l. UNKNOWN for good after green checks: exits 8"; has "$out" "$SETTLE" "25l. the settling mark"
lacks "$out" "NON-check gate" "25l. never the NON-check gate"; lacks "$out" "did not converge" "25l. never 'did not converge'"
ok "$(nlog '^pr view')" 9 "25l. 9 PR reads: the pre-pass, the wait pass, 6 re-polls and the read that exits"
# (m) the state guard never pre-empts the settling 8: three BEHIND re-polls, the wait, six lazy re-polls
fresh; pair; mkpr 5 "$I"; mss UNKNOWN BEHIND BEHIND BEHIND UNKNOWN
run 5 "$I" "$B"
ok "$rc" 8 "25m. BEHIND three times, then UNKNOWN for good: exits 8"; has "$out" "$SETTLE" "25m. the settling mark"
lacks "$out" "did not converge" "25m. never 'did not converge' (the guard is derived)"

echo; [ "$fail" -eq 0 ] && echo "merge-task integrated: ALL PASS" || echo "merge-task integrated: SOME FAILED"
exit "$fail"
