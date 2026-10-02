#!/usr/bin/env bash
# pushed-base.sh [--also <dir>]… <repoPath> <defaultBranch> [<cited-path>…] — the pushed-base dispatch
# blocker (skills/_shared/execution-fit.md § Dispatch blockers, p12-15). Rollout worktrees branch from a
# freshly fetched origin/<default>, and agents read only the task note, the rollout note and the repo (never
# THREAD.md), so anything that exists only in a local clone is invisible to them. Called only through the
# `# thread:pushed-base-check` snippet there (schedule § 0 and step 2, execute § 2.7); it lives in a script
# because Claude Code substitutes skill arguments into every positional `$N` in a SKILL.md body (p5-2).
#
# The clone set: <repoPath>'s toplevel first, then every candidate that is a work tree whose raw
# remote.origin.url (not `remote get-url`, which applies insteadOf) normalises to the same owner/name the
# merge-task way, de-duplicated by `pwd -P` toplevel. Candidates come from each `--also <dir>` (the project
# note's `Local:` path; an empty <dir> is a no-op, a non-clone is noted and skipped) and from every
# directory-source plugin marketplace in known_marketplaces.json, read through
# skills/execute/scripts/self-rollout-check.sh --list-dirs so that file stays the one registry parser (a
# registry entry for another repo is skipped silently). execute § 2.6 forces a separate rollout clone exactly
# when repoPath is a directory-source marketplace, so the registry names the primary checkout exactly then.
#
# Every member is fetched with --prune (`origin/<b>` and `origin/close/*`, remote-tracking refs only; any
# failure is exit 2), then:
#   Block — a member whose local <b> is ahead of origin/<b> blocks (exit 3) when some of that content is not
#     on origin/<b>, with its `log --oneline` and a remedy built from close's repo-state.sh line when that
#     member's HEAD is <b> (queued / stranded / split, merge-task's three patterns), else a generic one; both
#     name the reset that drops the local copies once landed. Ahead commits whose content is already on
#     origin/<b> (`git cherry` all `-`, or no touched file differs: a squash or cherry-picked PR) are a note
#     naming that reset; ahead commits touching only THREAD.md are a note. An ahead set touching no file blocks.
#   Warn — each cited path on its own (never batched): a relative path in every member, an absolute or ~/
#     one in the member containing it (else a note). Per (member, path): `diff HEAD` + `diff --cached`
#     (uncommitted), `diff origin/<b>...HEAD` three-dot AND `diff origin/<b> HEAD` two-dot (committed on the
#     checked-out branch and still different from origin, so a squash-merged branch is silent) and
#     `ls-files --others --exclude-standard` (untracked). The work tree is never diffed against origin/<b>,
#     so a checkout behind origin stays silent. A git failure marks only that (member, path) pair. Branches
#     that are not checked out are not read (local <b> is covered by the block). THREAD.md is dropped.
#
# stdout: `pushed` on exit 0, else nothing · stderr: notes, WARN lines, the block report.
# Exit 0 pushed · 3 a local <b> ahead in some member · 2 usage error or the check failed.
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
set -uo pipefail

# A caller's GIT_DIR & co. (a git hook exports them) would override -C and read another repo (p12-3).
for v in $(git rev-parse --local-env-vars 2>/dev/null); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done
export LC_ALL=C

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_STATE="$here/../../close/scripts/repo-state.sh"
SELF_CHECK="$here/../../execute/scripts/self-rollout-check.sh"

usage() { echo "pushed-base: usage: pushed-base.sh [--also <dir>]… <repoPath> <defaultBranch> [<cited-path>…]" >&2; exit 2; }
note() { echo "pushed-base: note: $*" >&2; }
expand() { case "$1" in "~") printf '%s\n' "$HOME" ;; "~/"*) printf '%s\n' "$HOME/${1#\~/}" ;; *) printf '%s\n' "$1" ;; esac; }

also=()
while [ $# -gt 0 ] && [ "$1" = --also ]; do
  [ $# -ge 2 ] || usage
  [ -z "$2" ] || also+=("$2")
  shift 2
done
[ $# -ge 2 ] || usage
R=$1; b=$2; shift 2
[ -n "$R" ] && [ -n "$b" ] || usage
R=$(expand "$R")
[ "$(git -C "$R" rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || { echo "pushed-base: $R is not a git work tree" >&2; exit 2; }
t=$(git -C "$R" rev-parse --show-toplevel 2>/dev/null) && top=$(cd "$t" 2>/dev/null && pwd -P) \
  || { echo "pushed-base: cannot resolve the toplevel of $R" >&2; exit 2; }

id_of() {  # id_of <clone>: owner/name from the raw origin URL, lowercased; nothing when it does not normalise
  local u
  u=$(git -C "$1" config --get remote.origin.url 2>/dev/null) || return 0
  case "$u" in *github.com:*) u=${u#*github.com:} ;; *github.com/*) u=${u#*github.com/} ;; *) return 0 ;; esac
  u=${u%/}; u=${u%.git}
  case "$u" in ?*/?*) printf '%s\n' "$u" | tr '[:upper:]' '[:lower:]' ;; esac
}
id=$(id_of "$top")

# ---- the clone set ------------------------------------------------------------------------------------
members=("$top")
candidate() {  # candidate <path> <also|registry>
  local p c t m
  p=$(expand "$1")
  if [ -d "$p" ] && t=$(git -C "$p" rev-parse --show-toplevel 2>/dev/null) && [ -n "$t" ] \
     && c=$(cd "$t" 2>/dev/null && pwd -P) && [ "$(id_of "$c")" = "$id" ]; then
    for m in "${members[@]}"; do [ "$m" = "$c" ] && return 0; done
    members+=("$c")
  elif [ "$2" = also ]; then
    note "$1 is not a clone of $id: skipped"
  fi
}
if [ -z "$id" ]; then
  [ ${#also[@]} -eq 0 ] || note "origin of $top does not name a GitHub owner/name: other clones not checked"
else
  for a in ${also[@]+"${also[@]}"}; do candidate "$a" also; done
  if [ -f "$SELF_CHECK" ]; then
    dirs=$(bash "$SELF_CHECK" --list-dirs); lrc=$?
    if [ "$lrc" -ne 0 ]; then
      note "self-rollout-check.sh --list-dirs exited $lrc: clones in the plugin marketplace registry not checked"
    elif [ -n "$dirs" ]; then
      while IFS= read -r d; do [ -n "$d" ] && candidate "$d" registry; done <<EOF
$dirs
EOF
    fi
  else
    note "self-rollout-check.sh not found at $SELF_CHECK: clones in the plugin marketplace registry not checked"
  fi
fi

# ---- fetch every member: origin/<b> and origin/close/* (remote-tracking refs only) ---------------------
# --prune with explicit refspecs touches only those destinations: a close/… branch deleted on origin (its
# landing PR merged or closed) drops its tracking ref, so repo-state never reads its commits as queued.
for c in "${members[@]}"; do
  if ! e=$(git -C "$c" fetch -q --prune origin "+refs/heads/$b:refs/remotes/origin/$b" "+refs/heads/close/*:refs/remotes/origin/close/*" 2>&1); then
    echo "pushed-base: fetch failed in $c: $(printf '%s\n' "$e" | head -n 1)" >&2
    exit 2
  fi
done

# ---- block: a member's local <b> ahead of origin/<b> --------------------------------------------------
# Ancestry alone over-counts: a commit landed by a squash or cherry-picked PR stays "ahead" for ever. So an
# ahead member blocks only when some of its content is not on origin/<b>: `git cherry` marks every ahead
# commit `-` (patch-equivalent upstream), or no file the ahead commits touch differs between origin/<b> and
# local <b> (a multi-commit squash). THREAD.md is set aside first. An ahead set that touches no file (empty
# commits, net-zero changes) still blocks: there is no content to compare, so the gate stays conservative.
blocked=0 broken=0
up="refs/remotes/origin/$b"
reset_hint() {  # reset_hint <member>: the command that drops local <b>'s landed commits
  if [ "$(git -C "$1" symbolic-ref -q HEAD 2>/dev/null)" = "refs/heads/$b" ]; then
    printf 'git -C %q reset --keep origin/%s' "$1" "$b"
  else
    printf 'git -C %q branch -f %s origin/%s' "$1" "$b" "$b"
  fi
}
for c in "${members[@]}"; do
  git -C "$c" rev-parse -q --verify "refs/heads/$b" >/dev/null 2>&1 || continue
  n=$(git -C "$c" rev-list --count "$up..refs/heads/$b" 2>&1) || {
    echo "pushed-base: cannot count $b against origin/$b in $c: $(printf '%s\n' "$n" | head -n 1)" >&2; broken=1; continue; }
  [ "$n" -gt 0 ] 2>/dev/null || continue
  # Every ahead commit patch-equivalent to one on origin/<b>: landed by a cherry-pick or one-commit squash.
  if ch=$(git -C "$c" cherry "$up" "refs/heads/$b" 2>/dev/null) && [ -n "$ch" ] \
     && ! printf '%s\n' "$ch" | grep -q '^+'; then
    note "local $b in $c is $n commit(s) ahead of origin/$b, but each is already on origin/$b by content (landed by a squash or cherry-picked PR): not a blocker; drop them with \`$(reset_hint "$c")\`"
    continue
  fi
  # The files the ahead commits touch (merge-base..<b>), and which of them differ from origin/<b> now.
  touched=() differ=() other=0
  while IFS= read -r -d '' f; do touched+=("$f"); done < <(git -C "$c" diff --no-renames --name-only -z "$up...refs/heads/$b" 2>/dev/null)
  if [ ${#touched[@]} -gt 0 ]; then
    # --quiet first: its exit status is the answer (0 same, 1 differs, else a failure, which blocks).
    git -C "$c" --literal-pathspecs diff --quiet --no-renames "$up" "refs/heads/$b" -- "${touched[@]}" >/dev/null 2>&1; drc=$?
    if [ "$drc" = 1 ]; then
      while IFS= read -r -d '' f; do differ+=("$f"); done < <(git -C "$c" --literal-pathspecs diff --no-renames --name-only -z "$up" "refs/heads/$b" -- "${touched[@]}" 2>/dev/null)
      [ ${#differ[@]} -gt 0 ] || other=1
      for f in ${differ[@]+"${differ[@]}"}; do [ "${f##*/}" = THREAD.md ] || other=1; done
    elif [ "$drc" != 0 ]; then
      other=1
    fi
  fi
  if [ ${#touched[@]} -gt 0 ] && [ "$other" = 0 ]; then
    only_thread=1
    for f in "${touched[@]}"; do [ "${f##*/}" = THREAD.md ] || only_thread=0; done
    if [ "$only_thread" = 1 ]; then
      note "local $b in $c is $n commit(s) ahead of origin/$b, touching only THREAD.md: not a blocker (agents never read THREAD.md)"
    elif [ ${#differ[@]} -gt 0 ]; then
      note "local $b in $c is $n commit(s) ahead of origin/$b, but beyond THREAD.md their content is already on origin/$b (landed by a squash or cherry-picked PR): not a blocker (agents never read THREAD.md)"
    else
      note "local $b in $c is $n commit(s) ahead of origin/$b, but their content is already on origin/$b (landed by a squash or cherry-picked PR): not a blocker; drop them with \`$(reset_hint "$c")\`"
    fi
    continue
  fi
  blocked=1
  rh=$(reset_hint "$c")
  echo "pushed-base: local $b in $c is $n commit(s) ahead of origin/$b: rollout worktrees branch from origin/$b, so agents will not see them:" >&2
  git -C "$c" log --oneline --no-decorate "$up..refs/heads/$b" 2>&1 | sed 's/^/  /' >&2
  line=''
  if [ "$(git -C "$c" symbolic-ref -q HEAD 2>/dev/null)" = "refs/heads/$b" ] && [ -f "$REPO_STATE" ]; then
    raw=$(bash "$REPO_STATE" "$c" 2>/dev/null) || raw=''
    case "$raw" in "on $b, "*" not on origin/$b"*) line=$raw ;; esac
  fi
  if [ -n "$line" ]; then
    echo "pushed-base: $line" >&2
    case "$line" in
      *"queued in"*", "*" stranded") echo "pushed-base: remedy: wait for the landing PR for the queued ones; land the stranded ones on origin/$b by PR (ADR 0025), then re-run; once their content is on origin/$b (a squash merge included), \`$rh\` drops the local copies" >&2 ;;
      *"queued in"*) echo "pushed-base: remedy: a close/… landing PR already carries them: wait for GitHub to merge it, then re-run; do not open a second PR" >&2 ;;
      *) echo "pushed-base: remedy: land them on origin/$b by PR first ($b is PR-only, ADR 0025), then re-run; once their content is on origin/$b (a squash merge included), \`$rh\` drops the local copies" >&2 ;;
    esac
  else
    echo "pushed-base: remedy: land them on origin/$b by PR first (ADR 0025); if a close/… landing PR already carries them (git branch -r --contains <sha>), wait for it to merge and re-run instead; once their content is on origin/$b (a squash merge included), \`$rh\` drops the local copies" >&2
  fi
done
[ "$blocked" = 0 ] || exit 3
[ "$broken" = 0 ] || exit 2

# ---- warn: each cited path on its own ------------------------------------------------------------------
resolve() {  # resolve <absolute path>: the deepest existing ancestor through `pwd -P`, plus the rest as written
  local p="$1" rest='' d
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  while [ -n "$p" ] && [ ! -d "$p" ]; do rest="/${p##*/}$rest"; p=${p%/*}; done
  [ -n "$p" ] || p=/
  d=$(cd "$p" 2>/dev/null && pwd -P) || d=$p
  [ "$d" = / ] && d=''
  printf '%s%s\n' "$d" "$rest"
}
within() {  # within <member> <resolved path>: prints the path relative to the member, or fails
  case "$2" in
    "$1") printf '.\n' ;;
    "$1"/*) case "/${2#"$1"/}/" in */../*) return 1 ;; esac; printf '%s\n' "${2#"$1"/}" ;;
    *) return 1 ;;
  esac
}
warns=''
cant() {  # cant <path> <loc> <git output>: that (member, path) pair only
  warns="$warns
pushed-base: WARN: $1$2: could not compare ($(printf '%s\n' "$3" | head -n 1))"
}
keep_in() {  # keep_in <lines> <allowed lines>: the non-empty lines of the first that appear in the second
  K="$2" awk 'BEGIN { n = split(ENVIRON["K"], a, "\n"); for (i = 1; i <= n; i++) if (a[i] != "") k[a[i]] = 1 }
              $0 != "" && ($0 in k)' <<EOF
$1
EOF
}
compare() {  # compare <member> <relpath>
  local m="$1" p="$2" loc='' o o2 br f kind what
  [ "$m" = "$top" ] || loc=" in $m"
  br=$(git -C "$m" symbolic-ref -q --short HEAD 2>/dev/null) || br='(detached HEAD)'
  for kind in head cached branch untracked; do
    case $kind in
      head)      o=$(git -C "$m" -c core.quotePath=false diff --no-renames --name-only HEAD -- "$p" 2>&1) ;;
      cached)    o=$(git -C "$m" -c core.quotePath=false diff --no-renames --name-only --cached -- "$p" 2>&1) ;;
      branch)    # committed on the branch (three-dot) AND still different from origin/<b> (two-dot): a branch
                 # whose PR was squash-merged, like a checkout merely behind, stays silent
                 o2=''
                 o=$(git -C "$m" -c core.quotePath=false diff --no-renames --name-only "$up...HEAD" -- "$p" 2>&1) \
                   && { o2=$(git -C "$m" -c core.quotePath=false diff --no-renames --name-only "$up" HEAD -- "$p" 2>&1) || { o=$o2; false; }; } \
                   && o=$(keep_in "$o" "$o2") ;;
      untracked) o=$(git -C "$m" -c core.quotePath=false ls-files --others --exclude-standard -- "$p" 2>&1) ;;
    esac || { cant "$p" "$loc" "$o"; return 0; }
    [ -n "$o" ] || continue
    while IFS= read -r f; do
      [ "${f##*/}" = THREAD.md ] && continue
      case $kind in
        head|cached) what='uncommitted change' ;;
        branch)      what="committed on the checked-out branch $br but not on origin/$b" ;;
        untracked)   what='untracked' ;;
      esac
      warns="$warns
pushed-base: WARN: $f$loc: $what: agents see origin/$b's copy, not this one"
    done <<EOF
$o
EOF
  done
}
for raw in "$@"; do
  [ -n "$raw" ] || continue
  q=$raw; while [ "${#q}" -gt 1 ] && [ "${q%/}" != "$q" ]; do q=${q%/}; done
  [ "${q##*/}" = THREAD.md ] && continue
  p=$(expand "$raw")
  case "$p" in
    /*)
      full=$(resolve "$p"); hit=0
      for m in "${members[@]}"; do
        if rel=$(within "$m" "$full"); then compare "$m" "$rel"; hit=1; break; fi
      done
      [ "$hit" = 1 ] || note "$raw is outside every known clone of ${id:-$top}: not compared" ;;
    *)
      for m in "${members[@]}"; do
        if rel=$(within "$m" "$(resolve "$m/$p")"); then compare "$m" "$rel"
        else note "$raw escapes $m: not compared"; fi
      done ;;
  esac
done
[ -z "$warns" ] || printf '%s\n' "$warns" | sed '/^$/d' | sort -u >&2
echo pushed
exit 0
