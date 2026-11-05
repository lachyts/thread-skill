#!/usr/bin/env bash
# live-checkout.sh — the one primitive for "fast-forward a live checkout" (ADR 0066's 2026-11-05 amendment, p37-7):
# what a half-applied operation is, the ssh rule, origin's default branch, the one-branch fetch, the dirty-overlap check
# and the guarded fast-forward. land.sh (S1, S4, O1, O4) and self-rollout-check.sh (--ensure, --refresh,
# --refresh-in-place) source it; primary-refresh.py runs it, `bash live-checkout.sh <mode> …`, and parses what it prints.
#
# Sourced, it sets one variable, _lc_dir (this file's directory, physical), and defines the lc_* functions below. It
# never runs set or shopt, never scrubs the environment and never unsets anything; every function variable is local and
# _lc_-prefixed, results come back on stdout and in the return code (no result globals), and every expansion is
# guarded, so it reads the same under `set -euo pipefail` as under none. lc_loaded is the last function defined: a
# caller sources the file, then tests `[ "$(type -t lc_loaded)" = function ]`, so a source that stopped partway fails
# closed (an undefined lc_op would return 127, which reads as "no operation in progress").
#
#   lc_op <repo>               the first half-applied operation's marker on stdout and rc 0, else rc 1. Markers, in
#                              order: rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG
#                              sequencer, each at `git rev-parse --path-format=absolute --git-path <m>` (a linked
#                              worktree's own). sequencer/ is a multi-pick cherry-pick or revert whose stopped pick was
#                              committed by hand: no CHERRY_PICK_HEAD, still mid-sequence.
#   lc_ssh_rule <repo>         land.sh's rule: export GIT_TERMINAL_PROMPT=0, and GIT_SSH_COMMAND='ssh -o BatchMode=yes'
#                              unless GIT_SSH_COMMAND, GIT_SSH or <repo>'s own core.sshCommand is set.
#   lc_default <repo>…         the first local refs/remotes/origin/HEAD symref among the repos, else origin's answer
#                              (skills/execute/scripts/default-branch.sh <first repo>: one ls-remote).
#   lc_default_local <repo>    no network: the symref, else refs/remotes/origin/master, else main, each read with
#                              `rev-parse -q --verify <ref>^{commit}`; rc 1 when none resolves.
#   lc_fetch <repo> <d> [<runner>]
#                              `[<runner>] git -C <repo> fetch --quiet --no-tags --no-write-fetch-head origin
#                              +refs/heads/<d>:refs/remotes/origin/<d>`, git's rc: one branch, never a tag, so an
#                              unrelated ref conflict (a stale origin/feat against origin's feat/x) never fails it.
#                              <runner> is land.sh's `bounded`.
#   lc_overlap <repo> <d>      the paths a fast-forward to refs/remotes/origin/<d> would overwrite, `, `-joined, cut to
#                              200 characters, or nothing. Changed C: `diff --no-renames --name-only HEAD
#                              refs/remotes/origin/<d>`; dirty P: the same form for the index against HEAD and the
#                              working tree against the index, plus `ls-files --others --exclude-standard` (an ignored
#                              file is git's to overwrite), every list under core.quotePath=false so both sides quote a
#                              path alike. c meets p when c = p, c starts `p/` or p starts `c/`. A listing that fails
#                              prints nothing: the merge is still the guard. A case-only collision on a case-insensitive
#                              filesystem slips past it, and git's own refusal (which rewrites ORIG_HEAD) catches it.
#   lc_ff <repo> <d>           the overlap first: one prints its paths and returns 3, running nothing, so ORIG_HEAD is
#                              never rewritten (a refused `merge --ff-only` writes it). Else `git merge -q --ff-only
#                              --no-autostash refs/remotes/origin/<d>`: rc 0, or rc 1 with git's output (its `hint:`
#                              lines dropped) on one line of at most 200 characters.
#   lc_check <repo> <d>        exactly one line, the first form that holds (tips and heads 40-hex, counts integers):
#                                unreadable <why>            HEAD or refs/remotes/origin/<d> names no commit, or a count
#                                                            failed
#                                current <tip>               HEAD is origin's tip (on any branch, detached included)
#                                ahead <tip> <a>             origin's tip is an ancestor of HEAD
#                                diverged <tip> <a> <b>      neither is an ancestor of the other
#                                busy <tip> <why>            behind, and `index.lock present`, `a rebase in progress` (or
#                                                            a merge, cherry-pick, revert, bisect, cherry-pick or revert
#                                                            sequence), `HEAD detached`, or `on <cur>, not <d>`
#                                overlap <tip> <b> <paths>   behind, and lc_overlap names paths
#                                behind <tip> <b> <head>     behind, and free to fast-forward
#
# Run modes, `bash live-checkout.sh <mode> <repo> [<d>]`, scrub the caller's repo-local git env (git's own list, the two
# config channels kept) and unset CDPATH first. Their output and exit codes are a contract that primary-refresh.py
# parses strictly (anything else reads as `broken:` there, never as current or moved), so change both together:
#   default <repo>   lc_default_local, else lc_ssh_rule and lc_default: the branch on stdout, exit 0; exit 1 when
#                    neither the local refs nor origin answer.
#   fetch <repo> <d> lc_ssh_rule, then lc_fetch: git's stderr passes through, and the exit is git fetch's own rc, so a
#                    failed fetch never exits 0.
#   check <repo> <d> lc_check's one line, exit 0.
#   ff <repo> <d>    exactly one line, exit 0: `moved <old40> <new40>`, `overlap <paths>` or `refused <why>`.
# A usage error in any mode prints `live-checkout: usage: …` on stderr and exits 2. bash 3.2-compatible (macOS).

_lc_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

lc_op() {
  local _lc_m _lc_p
  for _lc_m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do
    _lc_p=$(git -C "${1:-}" rev-parse --path-format=absolute --git-path "$_lc_m" 2>/dev/null) || continue
    if [ -n "$_lc_p" ] && [ -e "$_lc_p" ]; then printf '%s\n' "$_lc_m"; return 0; fi
  done
  return 1
}

lc_ssh_rule() {
  export GIT_TERMINAL_PROMPT=0
  if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -z "${GIT_SSH:-}" ] \
     && [ -z "$(git -C "${1:-.}" config core.sshCommand 2>/dev/null)" ]; then
    export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
  fi
}

lc_default() {
  local _lc_r _lc_d
  for _lc_r in "$@"; do
    _lc_d=$(git -C "$_lc_r" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) || continue
    _lc_d=${_lc_d#refs/remotes/origin/}
    if [ -n "$_lc_d" ]; then printf '%s\n' "$_lc_d"; return 0; fi
  done
  bash "$_lc_dir/../../execute/scripts/default-branch.sh" "${1:-}" 2>/dev/null
}

lc_default_local() {
  local _lc_d _lc_b
  if _lc_d=$(git -C "${1:-}" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null); then
    _lc_d=${_lc_d#refs/remotes/origin/}
    if [ -n "$_lc_d" ] && git -C "${1:-}" rev-parse -q --verify "refs/remotes/origin/$_lc_d^{commit}" >/dev/null 2>&1; then
      printf '%s\n' "$_lc_d"; return 0
    fi
  fi
  for _lc_b in master main; do
    if git -C "${1:-}" rev-parse -q --verify "refs/remotes/origin/$_lc_b^{commit}" >/dev/null 2>&1; then
      printf '%s\n' "$_lc_b"; return 0
    fi
  done
  return 1
}

lc_fetch() {
  ${3:+"$3"} git -C "${1:-}" fetch --quiet --no-tags --no-write-fetch-head origin \
    "+refs/heads/${2:-}:refs/remotes/origin/${2:-}"
}

lc_overlap() {
  local _lc_c _lc_p _lc_q _lc_u
  _lc_c=$(git -C "${1:-}" -c core.quotePath=false diff --no-renames --name-only HEAD "refs/remotes/origin/${2:-}" -- \
    2>/dev/null) || return 0
  [ -n "$_lc_c" ] || return 0
  _lc_p=$(git -C "${1:-}" -c core.quotePath=false diff --cached --no-renames --name-only HEAD -- 2>/dev/null) || return 0
  _lc_q=$(git -C "${1:-}" -c core.quotePath=false diff --no-renames --name-only -- 2>/dev/null) || return 0
  _lc_u=$(git -C "${1:-}" -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null) || return 0
  _lc_p="$_lc_p
$_lc_q
$_lc_u"
  printf '%s\n' "$_lc_c" | _LC_P=$_lc_p awk '
    BEGIN { n = split(ENVIRON["_LC_P"], p, "\n") }
    $0 != "" {
      for (i = 1; i <= n; i++) {
        if (p[i] == "") continue
        if ($0 == p[i] || index($0, p[i] "/") == 1 || index(p[i], $0 "/") == 1) {
          out = out (out == "" ? "" : ", ") $0; break
        }
      }
    }
    END { if (out != "") print substr(out, 1, 200) }' || :
  return 0
}

lc_ff() {
  local _lc_o
  _lc_o=$(lc_overlap "${1:-}" "${2:-}")
  if [ -n "$_lc_o" ]; then printf '%s\n' "$_lc_o"; return 3; fi
  if _lc_o=$(git -C "${1:-}" merge -q --ff-only --no-autostash "refs/remotes/origin/${2:-}" 2>&1); then return 0; fi
  _lc_o=$(printf '%s\n' "$_lc_o" | tr '\t\r' '  ' \
    | awk '$1 != "hint:" && NF { $1 = $1; s = s (s == "" ? "" : " ") $0 } END { print s }')
  printf '%s\n' "$(printf '%s' "${_lc_o:-git merge --ff-only failed}" | cut -c1-200)"
  return 1
}

lc_check() {
  local _lc_h _lc_t _lc_a _lc_b _lc_m _lc_cur _lc_o _lc_l
  _lc_h=$(git -C "${1:-}" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) \
    || { echo "unreadable HEAD names no commit"; return 0; }
  _lc_t=$(git -C "${1:-}" rev-parse -q --verify "refs/remotes/origin/${2:-}^{commit}" 2>/dev/null) \
    || { echo "unreadable refs/remotes/origin/${2:-} names no commit"; return 0; }
  if [ "$_lc_h" = "$_lc_t" ]; then echo "current $_lc_t"; return 0; fi
  _lc_a=$(git -C "${1:-}" rev-list --count "refs/remotes/origin/${2:-}..HEAD" 2>/dev/null) || _lc_a=
  _lc_b=$(git -C "${1:-}" rev-list --count "HEAD..refs/remotes/origin/${2:-}" 2>/dev/null) || _lc_b=
  case "$_lc_a" in ''|*[!0-9]*) _lc_a= ;; esac
  case "$_lc_b" in ''|*[!0-9]*) _lc_b= ;; esac
  if [ -z "$_lc_a" ] || [ -z "$_lc_b" ]; then
    echo "unreadable cannot count HEAD against refs/remotes/origin/${2:-}"; return 0
  fi
  if [ "$_lc_b" = 0 ]; then echo "ahead $_lc_t $_lc_a"; return 0; fi
  if [ "$_lc_a" != 0 ]; then echo "diverged $_lc_t $_lc_a $_lc_b"; return 0; fi
  _lc_l=$(git -C "${1:-}" rev-parse --path-format=absolute --git-path index.lock 2>/dev/null) || _lc_l=
  if [ -n "$_lc_l" ] && [ -e "$_lc_l" ]; then echo "busy $_lc_t index.lock present"; return 0; fi
  if _lc_m=$(lc_op "${1:-}"); then
    case "$_lc_m" in
      rebase-merge|rebase-apply) _lc_m="a rebase" ;;
      MERGE_HEAD) _lc_m="a merge" ;;
      CHERRY_PICK_HEAD) _lc_m="a cherry-pick" ;;
      REVERT_HEAD) _lc_m="a revert" ;;
      BISECT_LOG) _lc_m="a bisect" ;;
      *) _lc_m="a cherry-pick or revert sequence" ;;
    esac
    echo "busy $_lc_t $_lc_m in progress"; return 0
  fi
  _lc_cur=$(git -C "${1:-}" symbolic-ref -q --short HEAD 2>/dev/null) || { echo "busy $_lc_t HEAD detached"; return 0; }
  if [ "$_lc_cur" != "${2:-}" ]; then echo "busy $_lc_t on $_lc_cur, not ${2:-}"; return 0; fi
  _lc_o=$(lc_overlap "${1:-}" "${2:-}")
  if [ -n "$_lc_o" ]; then echo "overlap $_lc_t $_lc_b $_lc_o"; return 0; fi
  echo "behind $_lc_t $_lc_b $_lc_h"
}

lc_loaded() { :; }

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  for _lc_v in $(git rev-parse --local-env-vars 2>/dev/null); do
    case $_lc_v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$_lc_v" ;; esac
  done
  unset CDPATH
  _lc_usage="live-checkout: usage: live-checkout.sh default <repo> | fetch <repo> <branch> | check <repo> <branch> | ff <repo> <branch>"
  case "${1:-}" in
    default)
      [ $# -eq 2 ] && [ -n "$2" ] || { echo "$_lc_usage" >&2; exit 2; }
      lc_default_local "$2" && exit 0
      lc_ssh_rule "$2"
      _lc_b=$(lc_default "$2") && [ -n "$_lc_b" ] || exit 1
      printf '%s\n' "$_lc_b"; exit 0 ;;
    fetch|check|ff)
      [ $# -eq 3 ] && [ -n "$2" ] && [ -n "$3" ] || { echo "$_lc_usage" >&2; exit 2; }
      case "$1" in
        fetch) lc_ssh_rule "$2"; lc_fetch "$2" "$3"; exit $? ;;
        check) lc_check "$2" "$3"; exit 0 ;;
      esac
      _lc_old=$(git -C "$2" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) \
        || { echo "refused HEAD names no commit"; exit 0; }
      _lc_o=$(lc_ff "$2" "$3"); _lc_rc=$?
      case $_lc_rc in
        0) _lc_new=$(git -C "$2" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) \
             || { echo "refused HEAD names no commit after the merge"; exit 0; }
           echo "moved $_lc_old $_lc_new" ;;
        3) echo "overlap $_lc_o" ;;
        *) echo "refused ${_lc_o:-git merge --ff-only failed}" ;;
      esac
      exit 0 ;;
    *) echo "$_lc_usage" >&2; exit 2 ;;
  esac
fi
