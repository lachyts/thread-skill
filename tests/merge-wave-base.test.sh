#!/usr/bin/env bash
# merge-wave.sh's base contract, driven end to end against a fake `gh` on PATH (no GitHub): every open
# PR in a wave must target the repo's default branch, and anything wrong — a PR off the base, a mixed
# wave, an unreadable or CLOSED PR, an unreadable default — halts BEFORE the first merge. A clean wave
# merges in order into the default and names it. Hermetic: temp repo, PATH shim, ssh disabled.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/prs"
git -c init.defaultBranch=master init -q "$tmp/repo"
git -C "$tmp/repo" remote add origin git@github.com:o/r.git

# Fake gh. `repo view` prints $tmp/default (empty file ⇒ unreadable). `pr view N … --json F[,G]` prints
# the stored field(s) — "STATE BASE" for the combined pre-pass read. `pr merge N` logs and marks MERGED.
cat > "$tmp/bin/gh" <<EOF
#!/usr/bin/env bash
case "\$1 \$2" in
  "repo view") cat "$tmp/default" ;;
  "pr view")
    n=\$3; f=\$(printf '%s\n' "\$@" | grep -A1 -- '--json' | tail -1)
    [ -f "$tmp/prs/\$n.state" ] || exit 1
    if [ "\$f" = "state,baseRefName" ]; then echo "\$(cat "$tmp/prs/\$n.state") \$(cat "$tmp/prs/\$n.baseRefName")"
    else cat "$tmp/prs/\$n.\$f" 2>/dev/null; fi ;;
  "pr merge") echo "merge \$3" >> "$tmp/merges"; echo "MERGED" > "$tmp/prs/\$3.state" ;;
  *) : ;;
esac
EOF
chmod +x "$tmp/bin/gh"
pr() { printf '%s\n' "$2" > "$tmp/prs/$1.state"; printf '%s\n' "$3" > "$tmp/prs/$1.baseRefName"
       printf 'CLEAN\n' > "$tmp/prs/$1.mergeStateStatus"; printf 'audit-fix/t%s\n' "$1" > "$tmp/prs/$1.headRefName"; }
run() { rm -f "$tmp/merges"; PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$root/skills/execute/scripts/merge-wave.sh" "$tmp/repo" "$@" 2>&1; }
merges() { cat "$tmp/merges" 2>/dev/null | tr '\n' ' '; }
echo master > "$tmp/default"

# 1. mixed bases → halt, nothing merged
pr 11 OPEN master; pr 12 OPEN main
out=$(run 11 12); rc=$?
ok "$rc" 1 "mixed wave exits 1"; ok "$(merges)" "" "mixed wave merges nothing"
has "$out" "PR #12 targets 'main', not the default branch 'master'" "names the off-base PR and the default"
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "failed:1" "sentinel records the halt"

# 2. a single PR off the default (every agent skipped the default) → halt, nothing merged
pr 31 OPEN main
out=$(run 31); ok "$?" 1 "single off-base PR exits 1"; ok "$(merges)" "" "single off-base PR merges nothing"

# 3. an unreadable PR after a good one → halt before the good one merges
pr 41 OPEN master
out=$(run 41 49); ok "$?" 1 "unreadable PR exits 1"; ok "$(merges)" "" "unreadable PR: nothing merged (fails closed)"
has "$out" "cannot read PR #49" "names the unreadable PR"

# 4. a CLOSED PR last in the list → halt before the earlier ones merge
pr 51 OPEN master; pr 52 OPEN master; pr 53 CLOSED master
out=$(run 51 52 53); ok "$?" 1 "CLOSED PR exits 1"; ok "$(merges)" "" "CLOSED PR: nothing merged"

# 5. unreadable default branch → halt
: > "$tmp/default"; pr 61 OPEN master
out=$(run 61); ok "$?" 1 "unreadable default exits 1"; ok "$(merges)" "" "unreadable default: nothing merged"
echo master > "$tmp/default"

# 6. a clean wave → merges in order into the default; an already-MERGED PR is skipped
pr 21 OPEN master; pr 22 OPEN master; pr 23 MERGED main
out=$(run 21 22 23); rc=$?
ok "$rc" 0 "clean wave exits 0"; ok "$(merges)" "merge 21 merge 22 " "merges in the given order, skips the merged one"
has "$out" "== PR #21 (into master) ==" "names the base per PR"
has "$out" "PR #23 already merged — skipping." "reports the skip"
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "ok" "sentinel records success"

# 7. the checkout's master holds a local-only commit and origin/master has moved on (a diverged sibling):
#    the fetch fails (ssh disabled), the fast-forward fails, and the local-only commit is named.
gc() { git -c user.name=t -c user.email=t@t -C "$tmp/repo" "$@"; }
gc commit -q --allow-empty -m base
tree=$(gc rev-parse 'HEAD^{tree}')
gc update-ref refs/remotes/origin/master "$(gc commit-tree -p HEAD -m sibling "$tree")"
gc symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
gc commit -q --allow-empty -m local-only
held=$(gc rev-parse HEAD)
pr 71 OPEN master
out=$(run 71); rc=$?
ok "$rc" 0 "7. diverged checkout: the wave still exits 0"
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "ok" "7. sentinel records success"
ok "$(gc rev-parse HEAD)" "$held" "7. the checkout is left where it was"
has "$out" "did not fast-forward: on master, 1 commit(s) not on origin/master — stranded" "7. names the local-only commit as stranded"
q="close/2026-09-29-t-$(printf '%s' "$held" | cut -c1-12)"
gc update-ref "refs/remotes/origin/$q" HEAD
pr 72 OPEN master
out=$(run 72); rc=$?
ok "$rc" 0 "7. with a (stubbed) queued close ref: exits 0"
has "$out" "did not fast-forward: on master, 1 commit(s) not on origin/master — queued in $q" "7. names the queued close/… branch"
# 7c. origin/master behind the checkout (the fetch failed): the fast-forward is a no-op, still named.
gc update-ref refs/remotes/origin/master HEAD~1
pr 73 OPEN master
out=$(run 73); rc=$?
ok "$rc" 0 "7c. checkout ahead of a stale origin/master: exits 0"
has "$out" "local master already at or ahead of origin/master." "7c. a no-op fast-forward says already at or ahead"
case "$out" in *"fast-forwarded"*) ok "[$out]" "no 'fast-forwarded'" "7c. a no-op fast-forward never says fast-forwarded";; *) ok y y "7c. a no-op fast-forward never says fast-forwarded";; esac
has "$out" "NOTE: on master, 1 commit(s) not on origin/master — queued in $q." "7c. a no-op fast-forward still names the local-only commit"
# 7d. a stranded commit on top of the queued one: split, and the checkout stays blocked.
gc update-ref refs/remotes/origin/master "$(gc commit-tree -p HEAD~1 -m sibling2 "$tree")"
gc commit -q --allow-empty -m local-only-2
pr 74 OPEN master
out=$(run 74); rc=$?
ok "$rc" 0 "7d. queued + stranded: exits 0"
has "$out" "did not fast-forward: on master, 2 commit(s) not on origin/master — 1 queued in $q, 1 stranded" "7d. names the split"
has "$out" "stays blocked until they are landed or dropped" "7d. says the stranded ones keep it blocked"

# 8. GIT_DIR / GIT_WORK_TREE set on the ONE merge-wave.sh invocation (a git hook exports them; p12-3), never
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
out=$(GIT_DIR="$d/.git" bash "$root/skills/execute/scripts/merge-wave.sh" --self-test-base 2>&1); rc=$?
ok "$rc" 0 "8a. --self-test-base under an inherited GIT_DIR exits 0"
has "$out" "base: ALL PASS" "8a. --self-test-base under an inherited GIT_DIR: ALL PASS"
ok "$(snap)" "$before" "8a. the decoy and its remote are unchanged"
mkdecoy; before=$(snap)
out=$(GIT_DIR="$d/.git" GIT_WORK_TREE="$d" bash "$root/skills/execute/scripts/merge-wave.sh" --self-test-base 2>&1); rc=$?
ok "$rc" 0 "8b. --self-test-base under GIT_DIR + GIT_WORK_TREE exits 0"
has "$out" "base: ALL PASS" "8b. --self-test-base under GIT_DIR + GIT_WORK_TREE: ALL PASS"
ok "$(snap)" "$before" "8b. the decoy and its remote are unchanged"
# 8c. a clean one-PR wave while the decoy's remote holds a commit the decoy lacks: an unscrubbed script
#     fetches it and fast-forwards the decoy's master (rc 0 and sentinel ok either way, so rc is not the signal).
mkdecoy
git -c init.defaultBranch=master clone -q "$dr" "$tmp/scratch" 2>/dev/null
git -c user.name=t -c user.email=t@t -C "$tmp/scratch" commit -q --allow-empty -m remote-only
git -C "$tmp/scratch" push -q origin master
before=$(snap); held=$(gc rev-parse HEAD)
pr 81 OPEN master
out=$(rm -f "$tmp/merges"; GIT_DIR="$d/.git" PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$root/skills/execute/scripts/merge-wave.sh" "$tmp/repo" 81 2>&1); rc=$?
ok "$(snap)" "$before" "8c. a wave under an inherited GIT_DIR leaves the decoy and its remote unchanged"
case "$out" in *"fast-forwarded"*) ok "[$out]" "no 'fast-forwarded'" "8c. nothing is fast-forwarded";; *) ok y y "8c. nothing is fast-forwarded";; esac
# Regression guards (green before and after the scrub):
ok "$rc" 0 "8c. (guard) the wave exits 0"
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "ok" "8c. (guard) sentinel records success"
ok "$(gc rev-parse HEAD)" "$held" "8c. (guard) \$tmp/repo is left where it was"

echo; [ "$fail" -eq 0 ] && echo "merge-wave base: ALL PASS" || echo "merge-wave base: SOME FAILED"
exit "$fail"
