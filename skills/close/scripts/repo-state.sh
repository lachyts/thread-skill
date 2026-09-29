#!/usr/bin/env bash
# repo-state.sh [<dir>] — thread:close step 2's branch check: is the repo at <dir> (default: the CWD)
# sitting on a feature branch with commits its default branch does not have, or on its default branch
# with commits origin/<default> does not have?
#
# Prints nothing, or exactly one line on stdout:
#   on <branch>, <N> commit(s) unmerged to <default>
#   on <default>, <N> commit(s) not on origin/<default> — queued in close/<…>
#   on <default>, <N> commit(s) not on origin/<default> — stranded
#   on <default>, <N> commit(s) not on origin/<default> — <Q> queued in close/<…>, <S> stranded
#   on <branch>, default branch unresolved — unmerged check skipped
# Nothing on a detached HEAD, an unborn branch, a bare repo, outside git, on the default branch when it
# is not ahead, or with 0 unmerged commits.
#
# Queued vs stranded is local evidence only. Landing (land.sh) sends a protected repo's close-outs to a
# close/<cdate>-<slug>-<sha12> branch on origin, which leaves a refs/remotes/origin/close/<…> tracking
# ref in this clone; that branch is the head of the `landing` PR. A commit reachable from such a ref is
# queued, any other is stranded. The newest close ref that carries at least one of them is the one named.
# A ref from a merged PR carries nothing ahead and is ignored; one whose PR closed unmerged still reads
# queued (close's § Edge cases).
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

# 6. On the default branch: commits origin/<default> does not have, queued in a close/… ref or stranded.
#    Without origin/<default> (a dangling origin/HEAD) the line is the unresolved one.
if [ "$br" = "$def" ]; then
  up="refs/remotes/origin/$def"
  git -C "$dir" rev-parse -q --verify "$up" >/dev/null 2>&1; rc=$?
  [ "$rc" -eq 1 ] && unresolved
  [ "$rc" -eq 0 ] || fail "rev-parse $up failed (rc $rc)"
  n=$(git -C "$dir" rev-list --count "$up..HEAD" 2>/dev/null) || fail "rev-list failed ($up)"
  [ "$n" -gt 0 ] 2>/dev/null || exit 0
  line="on $def, $n commit(s) not on origin/$def"
  # One call counts the stranded ones: ahead commits no close ref reaches.
  s=$(git -C "$dir" rev-list --count HEAD --not "$up" --glob='refs/remotes/origin/close/*' 2>/dev/null) \
    || fail "rev-list failed (refs/remotes/origin/close/*)"
  if [ "$s" -ge "$n" ]; then echo "$line — stranded"; exit 0; fi
  # Name the carrier: the newest close ref that reaches at least one ahead commit. Refnames hold no
  # whitespace or glob characters, so the unquoted list splits safely.
  refs=$(git -C "$dir" for-each-ref --sort=-committerdate --format='%(refname)' refs/remotes/origin/close/ 2>/dev/null) \
    || fail "for-each-ref failed (refs/remotes/origin/close/)"
  carrier=''
  for r in $refs; do
    m=$(git -C "$dir" rev-list --count HEAD --not "$up" "$r" 2>/dev/null) || fail "rev-list failed ($r)"
    if [ "$m" -lt "$n" ]; then carrier=${r#refs/remotes/origin/}; break; fi
  done
  [ -n "$carrier" ] || fail "no close ref carries the $((n - s)) queued commit(s)"
  if [ "$s" -eq 0 ]; then echo "$line — queued in $carrier"
  else echo "$line — $((n - s)) queued in $carrier, $s stranded"; fi
  exit 0
fi

# 7. On a feature branch. The base: the remote-tracking ref, else the local branch. Full refnames, no guessing.
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
