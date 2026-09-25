#!/usr/bin/env bash
# repo-state.sh [<dir>] — thread:close step 2's branch check: is the repo at <dir> (default: the CWD)
# sitting on a feature branch with commits its default branch does not have?
#
# Prints nothing, or exactly one line on stdout:
#   on <branch>, <N> commit(s) unmerged to <default>
#   on <branch>, default branch unresolved — unmerged check skipped
# Nothing on a detached HEAD, an unborn branch, a bare repo, outside git, on the default branch, or with
# 0 unmerged commits.
#
# The default branch comes from the local refs/remotes/origin/HEAD symref only: no remote is contacted,
# no configured init default is read and no branch name is ever assumed. When that symref is unset or
# dangling, the unresolved line is printed (close's report gives the one-time fix). Commits are counted against refs/remotes/origin/<default>, else the local
# refs/heads/<default>, else the line is the unresolved one.
#
# No network, never writes: no ref, no file, no index, no temp file. Every git call is
# `git -C "$dir" …` with git's own stderr discarded, so the only stderr is a `repo-state:` line.
#
# Exit: 0 on every clean path (stderr empty) · 2 usage error or missing directory · 3 a git failure
# (a repo git refuses to open, a probe failing with anything but its normal "no" status).
# bash 3.2-compatible (macOS).
set -uo pipefail

# A caller's GIT_DIR, GIT_WORK_TREE & co. (a git hook exports them) would override -C and read another
# repo. Unset git's own list of repo-local vars, except the two config channels: they cannot move the
# repo, and GIT_CONFIG_COUNT carries config a caller sets on purpose.
for v in $(git rev-parse --local-env-vars); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done
export LC_ALL=C   # stable git messages for the "not a git repository" match below

[ $# -le 1 ] || { echo "repo-state: usage: repo-state.sh [<dir>]" >&2; exit 2; }
dir=${1:-$PWD}
[ -d "$dir" ] || { echo "repo-state: no such directory: $dir" >&2; exit 2; }
fail() { echo "repo-state: $*" >&2; exit 3; }

# 1. A work tree? Outside git is silent; a repo git refuses to open (dubious ownership, unreadable .git)
#    is a failure, never silence.
inside=$(git -C "$dir" rev-parse --is-inside-work-tree 2>/dev/null)
if [ $? -ne 0 ]; then
  why=$(git -C "$dir" rev-parse --is-inside-work-tree 2>&1 >/dev/null | head -n 1)
  case $why in
    *"not a git repository"*) exit 0 ;;
    *) fail "git cannot open $dir: $why" ;;
  esac
fi
[ "$inside" = true ] || exit 0   # a bare repo prints false

# 2. The branch. rc 1 = detached HEAD. Full refnames throughout, stripped here: `--short` prints
#    heads/<br> when a tag shares the branch's name, and remotes/origin/<x> when a local branch is named
#    origin/<x>.
head=$(git -C "$dir" symbolic-ref -q HEAD 2>/dev/null); rc=$?
[ "$rc" -eq 1 ] && exit 0
[ "$rc" -eq 0 ] || fail "symbolic-ref HEAD failed (rc $rc)"
case $head in refs/heads/?*) br=${head#refs/heads/} ;; *) exit 0 ;; esac

# 3. Unborn branch (no commit yet): rc 1.
git -C "$dir" rev-parse -q --verify HEAD >/dev/null 2>&1; rc=$?
[ "$rc" -eq 1 ] && exit 0
[ "$rc" -eq 0 ] || fail "rev-parse HEAD failed (rc $rc)"

# 4. The default branch, from the local origin/HEAD symref only. rc 1 = missing or not a symref.
def=''
ref=$(git -C "$dir" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ]; then
  case $ref in refs/remotes/origin/?*) def=${ref#refs/remotes/origin/} ;; esac
elif [ "$rc" -ne 1 ]; then
  fail "symbolic-ref origin/HEAD failed (rc $rc)"
fi

unresolved() { echo "on $br, default branch unresolved — unmerged check skipped"; exit 0; }

# 5. Unresolved applies on the default branch too.
[ -n "$def" ] || unresolved
# 6. On the default branch: nothing to flag.
[ "$br" = "$def" ] && exit 0

# 7. The base: the remote-tracking ref, else the local branch. Full refnames, no guessing.
base=''
for cand in "refs/remotes/origin/$def" "refs/heads/$def"; do
  git -C "$dir" rev-parse -q --verify "$cand" >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then base=$cand; break; fi
  [ "$rc" -eq 1 ] || fail "rev-parse $cand failed (rc $rc)"
done
[ -n "$base" ] || unresolved

# 8. The count.
n=$(git -C "$dir" rev-list --count "$base..HEAD" 2>/dev/null) || fail "rev-list failed ($base)"
if [ "$n" -gt 0 ] 2>/dev/null; then echo "on $br, $n commit(s) unmerged to $def"; fi
exit 0
