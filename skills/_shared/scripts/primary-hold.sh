#!/usr/bin/env bash
# primary-hold.sh <repo> — ADR 0031's hold, its one copy. The primary checkout is the git checkout this
# plugin runs from, live: the plugin root (three levels above this script) when it is <repo>'s toplevel.
# Running from the version cache, no repo's toplevel is the plugin root, and nothing holds. <repo> holds
# when it is the primary checkout and unfinished-rollout.py lists a running rollout.
#
# ADR 0043 (skills/_shared/engine-snapshot.md, engine-snapshot.py's git_primary(), the same test): the plugin root
# counts only when it is its own work tree's toplevel (unchanged: a version-cache copy, even one nested in another
# repo such as ~/.claude's, holds nothing). A root that is a linked worktree (`--git-dir` differs from
# `--git-common-dir`: an Engine snapshot) stands for its main checkout, dirname(common), when that common dir is a
# `.git` and dirname(common) is its own toplevel, so a lead running from a snapshot still holds the Primary for an
# older rollout. And `running` lists only rollouts with no `engine_snapshot:` stamp: a snapshotted rollout never runs
# on the Primary, so this hold covers only rollouts scheduled before P29 (retire it once none is live).
#
# stdout: one line saying why it holds, or nothing. Exit 0, or 2 on a usage error. A failed running check
# holds (holding only skips moving the checkout); a missing vault is no rollout, so nothing holds.
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
[ $# -eq 1 ] && [ -n "$1" ] || { echo "primary-hold: usage: primary-hold.sh <repo>" >&2; exit 2; }
# A caller's GIT_DIR & co. (a git hook exports them) would override -C and answer for another repo (p12-3).
for v in $(git rev-parse --local-env-vars 2>/dev/null); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
proot=$(cd "$here/../../.." && pwd -P) || exit 0
# A snapshot (a linked worktree that is its own toplevel) stands for its main checkout.
pt=$(git -C "$proot" rev-parse --show-toplevel 2>/dev/null) && pt=$(cd "$pt" && pwd -P) && [ "$pt" = "$proot" ] && {
  gd=$(git -C "$proot" rev-parse --path-format=absolute --git-dir 2>/dev/null) && gd=$(cd "$gd" && pwd -P) \
    && gc=$(git -C "$proot" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && gc=$(cd "$gc" && pwd -P) \
    && [ "$gd" != "$gc" ] && [ "$(basename "$gc")" = .git ] && {
      main=$(dirname "$gc")
      mt=$(git -C "$main" rev-parse --show-toplevel 2>/dev/null) && mt=$(cd "$mt" && pwd -P) && [ "$mt" = "$main" ] && proot=$main
    }
}
t=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) && t=$(cd "$t" && pwd -P) || exit 0
[ "$t" = "$proot" ] || exit 0

out=$(python3 "$here/unfinished-rollout.py" running 2>/dev/null); rc=$?
if [ "$rc" != 0 ]; then echo "the running-rollout check failed (rc $rc)"; exit 0; fi
[ "$out" = none ] && exit 0
echo "$(printf '%s\n' "$out" | sed 's/^running \(.*\)/[[\1]]/' | paste -sd ' ' -) running on it"
