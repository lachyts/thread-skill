#!/usr/bin/env bash
# merge-task.sh's base contract, driven end to end against the shared fake `gh` (no GitHub) and a real bare
# "GitHub" repo the checkout clones: the PR must target the repo's default branch, and anything wrong — a PR
# off the base, an unreadable, missing or CLOSED PR, an unreadable default — halts before the merge (1 when
# definitive, 8 when transient). A clean PR merges into the default and a re-run takes the already-merged
# path; the local refresh names stranded and queued close-outs through a working fetch; an inherited GIT_DIR
# never reaches another repo (8a–8c); a SIGTERM never reads `ok` (9). Hermetic: temp repos, PATH shim,
# ssh disabled.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh

# 2. a PR off the default (every agent skipped the default) → halt, nothing merged
fresh; pair; mkpr 31 "$I"; echo main > "$MT_STATE/pr/31/baseRefName"
run 31 "$I" "$B"
ok "$rc" 1 "2. off-default PR exits 1"; ok "$(nmerge)" 0 "2. off-default PR: nothing merged"
has "$out" "PR #31 targets 'main', not the default branch 'master'" "2. names the off-base PR and the default"
ok "$(sent)" "failed:1" "2. sentinel records the halt"

# 3. an unreadable PR (transient) → 8, nothing merged, the counter untouched
fresh; pair; mkpr 41 "$I"; echo "error connecting to api.github.com" > "$MT_STATE/err.prview"; seed 41 "$B"
run 41 "$I" "$B"
ok "$rc" 8 "3. transiently unreadable PR exits 8"; ok "$(nmerge)" 0 "3. unreadable PR: nothing merged"
has "$out" "retryable: cannot read PR #41" "3. says it is retryable"
ok "$(ctr 41)" "$B" "3. the counter is untouched"; ok "$(sent)" "failed:8" "3. sentinel records failed:8"
# 3b. a PR GitHub cannot resolve → 1
fresh; pair
run 49 "$I" "$B"
ok "$rc" 1 "3b. a missing PR exits 1"
has "$out" "Could not resolve to a PullRequest with the number of 49" "3b. names gh's not-found"

# 4. a CLOSED PR → halt, nothing merged
fresh; pair; mkpr 53 "$I" CLEAN CLOSED
run 53 "$I" "$B"
ok "$rc" 1 "4. CLOSED PR exits 1"; ok "$(nmerge)" 0 "4. CLOSED PR: nothing merged"
has "$out" "PR #53 is 'CLOSED'" "4. names the state"

# 5. unreadable default branch: transient → 8; 5b. HTTP 404 → 1
fresh; pair; mkpr 61 "$I"; echo "error connecting to api.github.com" > "$MT_STATE/err.repo"
run 61 "$I" "$B"
ok "$rc" 8 "5. transiently unreadable default exits 8"; ok "$(nmerge)" 0 "5. unreadable default: nothing merged"
echo "gh: Not Found (HTTP 404)" > "$MT_STATE/err.repo"
run 61 "$I" "$B"
ok "$rc" 1 "5b. a 404 on the default branch exits 1"; ok "$(nmerge)" 0 "5b. nothing merged"

# 6. a clean PR → merges into the default; the same args again → the already-merged path, no second merge
fresh; pair; mkpr 21 "$I"
run 21 "$I" "$B"
ok "$rc" 0 "6. clean PR exits 0"; ok "$(nmerge)" 1 "6. merged once"
has "$out" "on the integrated base $B at the integrated head $I (verified)" "6. names the verified pair"
ok "$(sent)" "ok" "6. sentinel records success"
ok "$(gc rev-parse HEAD)" "$(srvtip)" "6. the checkout fast-forwarded to the merge"
has "$out" "local master fast-forwarded to origin/master." "6. reports the fast-forward"
run 21 "$I" "$B"
ok "$rc" 0 "6. re-run exits 0"; ok "$(nmerge)" 0 "6. re-run: no second merge"
has "$out" "PR #21 already merged" "6. re-run reports the already-merged path"; ok "$(sent)" "ok" "6. re-run: ok"

# 7. the checkout's master holds a local-only commit and origin/master moves on to the integrated base (a
#    diverged sibling): the fetch works, the fast-forward fails, and the local-only commit is named.
gc commit -q --allow-empty -m local-only
held=$(gc rev-parse HEAD)
fresh; pair; mkpr 71 "$I"
run 71 "$I" "$B"
ok "$rc" 0 "7. diverged checkout: still exits 0"
ok "$(sent)" "ok" "7. sentinel records success"
ok "$(gc rev-parse HEAD)" "$held" "7. the checkout is left where it was"
has "$out" "did not fast-forward: on master, 1 commit(s) not on origin/master — stranded" "7. names the local-only commit as stranded"
q="close/2026-09-29-t-$(printf '%s' "$held" | cut -c1-12)"
gc update-ref "refs/remotes/origin/$q" HEAD
fresh; pair; mkpr 72 "$I"
run 72 "$I" "$B"
ok "$rc" 0 "7. with a (stubbed) queued close ref: exits 0"
has "$out" "did not fast-forward: on master, 1 commit(s) not on origin/master — queued in $q" "7. names the queued close/… branch"
# 7c. the already-merged path with the checkout ahead of the merge: a no-op fast-forward, still named.
gc reset -q --hard "$(srvtip)"
gc commit -q --allow-empty -m local-only-c
q2="close/2026-09-29-t-$(gc rev-parse HEAD | cut -c1-12)"
gc update-ref "refs/remotes/origin/$q2" HEAD
run 72 "$I" "$B"
ok "$rc" 0 "7c. checkout ahead of the merge: exits 0"
has "$out" "PR #72 already merged" "7c. takes the already-merged path"
has "$out" "local master already at or ahead of origin/master." "7c. a no-op fast-forward says already at or ahead"
lacks "$out" "fast-forwarded" "7c. a no-op fast-forward never says fast-forwarded"
has "$out" "NOTE: on master, 1 commit(s) not on origin/master — queued in $q2." "7c. a no-op fast-forward still names the local-only commit"
# 7d. a stranded commit on top of the queued one, and origin/master moved on (sibling2): split, still blocked.
gc commit -q --allow-empty -m local-only-d
fresh; pair; mkpr 74 "$I"
run 74 "$I" "$B"
ok "$rc" 0 "7d. queued + stranded: exits 0"
has "$out" "did not fast-forward: on master, 2 commit(s) not on origin/master — 1 queued in $q2, 1 stranded" "7d. names the split"
has "$out" "stays blocked until they are landed or dropped" "7d. says the stranded ones keep it blocked"
gc reset -q --hard "$(srvtip)"

# 8. GIT_DIR / GIT_WORK_TREE set on the ONE merge-task.sh invocation (a git hook exports them; p12-3), never
#    exported in this shell, so the fixture setup above and the snapshots below stay on their own repos. The
#    decoy is a normal repo whose only remote is a LOCAL bare repo under a github.com/o/r.git path: the
#    script's owner/repo derivation passes, so an unscrubbed script reaches its fetch and ff-merge — against
#    the decoy and its remote instead of $tmp/repo. The decoy and its remote must come out byte-unchanged.
d="$tmp/decoy"; dr="$tmp/gh/github.com/o/r.git"
mkdecoy() {  # a fresh decoy per case, so one case's leak never masks the next case's
  rm -rf "$d" "$dr" "$tmp/scratch"
  git -c init.defaultBranch=master init -q --bare "$dr"
  git -c init.defaultBranch=master init -q "$d"
  git -c user.name=t -c user.email=t@t -C "$d" commit -q --allow-empty -m decoy-base
  git -C "$d" remote add origin "$dr"
  git -C "$d" push -q origin master 2>/dev/null
  git -C "$d" fetch -q origin
}
mkdecoy
snap() {  # the decoy's refs, its core.bare, its config bytes, and its remote's refs
  git -C "$d" for-each-ref; echo "bare=$(git -C "$d" config --get core.bare)"
  cat "$d/.git/config"; echo "-- remote"; git -C "$dr" for-each-ref
}
before=$(snap)
out=$(GIT_DIR="$d/.git" bash "$MT" --self-test-base 2>&1); rc=$?
ok "$rc" 0 "8a. --self-test-base under an inherited GIT_DIR exits 0"
has "$out" "base: ALL PASS" "8a. --self-test-base under an inherited GIT_DIR: ALL PASS"
ok "$(snap)" "$before" "8a. the decoy and its remote are unchanged"
mkdecoy; before=$(snap)
out=$(GIT_DIR="$d/.git" GIT_WORK_TREE="$d" bash "$MT" --self-test-base 2>&1); rc=$?
ok "$rc" 0 "8b. --self-test-base under GIT_DIR + GIT_WORK_TREE exits 0"
has "$out" "base: ALL PASS" "8b. --self-test-base under GIT_DIR + GIT_WORK_TREE: ALL PASS"
ok "$(snap)" "$before" "8b. the decoy and its remote are unchanged"
# 8c. a clean merge while the decoy's remote holds a commit the decoy lacks: an unscrubbed script fetches it
#     (and fast-forwards the decoy's master). $tmp/repo sits on a side branch, so its own refresh fetches but
#     fast-forwards nothing (rc 0 and sentinel ok either way, so rc is not the signal).
mkdecoy
git -c init.defaultBranch=master clone -q "$dr" "$tmp/scratch" 2>/dev/null
git -c user.name=t -c user.email=t@t -C "$tmp/scratch" commit -q --allow-empty -m remote-only
git -C "$tmp/scratch" push -q origin master
gc switch -q -c side
before=$(snap); held=$(gc rev-parse HEAD)
fresh; pair; mkpr 81 "$I"
: > "$MT_STATE/gh.log"
out=$(GIT_DIR="$d/.git" PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" 81 "$I" "$B" 2>&1); rc=$?
ok "$(snap)" "$before" "8c. a merge under an inherited GIT_DIR leaves the decoy and its remote unchanged"
lacks "$out" "fast-forwarded" "8c. nothing is fast-forwarded"
# Regression guards (green before and after the scrub):
ok "$rc" 0 "8c. (guard) the merge exits 0"
ok "$(sent)" "ok" "8c. (guard) sentinel records success"
ok "$(gc rev-parse HEAD)" "$held" "8c. (guard) \$tmp/repo is left where it was"
gc switch -q master

# 9. SIGTERM during a required-checks wait: exit 143, the sentinel never reads ok, the counter untouched.
fresh; pair; mkpr 91 "$I" BLOCKED; seed 91 "$B"
#    The checks wait lasts until the test releases it (fake gh's "until", tests/lib/handshake.sh), never a fixed
#    2 s a loaded host can outrun: the TERM always lands inside the wait, and bash runs its trap once the released
#    call returns.
printf '{"rc":0,"out":"ci\\tpass\\t1s\\thttps://github.com/o/r/actions/runs/1/job/1\\t\\n","err":"","until":"%s"}\n' "$tmp/9.release" > "$MT_STATE/checks.seq"
rm -f "$tmp/9.release" "$tmp/9.release.waiting"; : > "$MT_STATE/gh.log"
PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" 91 "$I" "$B" > "$tmp/9.out" 2>&1 &
pid=$!
hs_wait "$tmp/9.release.waiting" --pid "$pid"
kill -TERM "$pid"; touch "$tmp/9.release"; wait "$pid"; rc=$?
lacks "$(glog)" "until: never released" "9. the test released the checks wait"
ok "$rc" 143 "9. SIGTERM in a checks wait exits 143"
ok "$(sent)" "failed:143" "9. SIGTERM: the sentinel reads failed:143, never ok"
ok "$(ctr 91)" "$B" "9. SIGTERM: the counter is byte-unchanged"
ok "$(nmerge)" 0 "9. SIGTERM: nothing merged"

echo; [ "$fail" -eq 0 ] && echo "merge-task base: ALL PASS" || echo "merge-task base: SOME FAILED"
exit "$fail"
