#!/usr/bin/env bash
# live-checkout.sh — the one primitive for "fast-forward a live checkout" (ADR 0066's 2026-11-05 amendment, p37-7):
# what a half-applied operation is, the ssh rule, origin's default branch, the one-branch fetch, the dirty-overlap check
# and the guarded fast-forward. land.sh (S1, S4, O1, O4, O9; its `bounded` wraps lc_bounded), self-rollout-check.sh
# (--ensure, --refresh, --refresh-in-place: lc_fetch under lc_bounded since p39-16) and merge-task.sh's
# refresh_local_base (lc_op, lc_ssh_rule, lc_fetch under lc_bounded, lc_ff; ADR 0066's 2026-11-06 amendment, p39-4)
# source it; primary-refresh.py runs it, `bash live-checkout.sh <mode> …`, and
# parses what it prints; leg.py's ff_primary runs its overlap mode before its own fast-forward to a local branch.
#
# The target (ADR 0084 d1, p54-6): a live checkout of a repo that publishes a Green tip moves to it and never past it
# (skills/_shared/scripts/green-tip.py decides which commit). So lc_overlap, lc_ff, lc_check and the check, ff and
# content modes take an optional <target>, a commit (a run mode's is 40 or 64 hex), against which they read and move.
# With none it is refs/remotes/origin/<d>, as before. <target> is always origin/<d> or an ancestor of it.
#
# One rule came with it and holds for every caller, with a target or none (land.sh S4 and O9, merge-task.sh's
# refresh_local_base, self-rollout-check.sh's --ensure, --refresh and --refresh-in-place, primary-refresh.py):
# lc_landed. A dirty or staged THREAD.md whose copy is a blob a commit of HEAD..origin/<d> holds at that path (a landed
# close-out's copy) is no overlap, and lc_ff writes the target's copy over it when the target holds that commit (with
# no target, always). Before it, such a copy held the move back unless it was origin's own. The widening loses
# nothing: the copy replaced is one origin's history holds, and, once moved, HEAD's; a copy no such commit holds is an
# overlap as before. LC13 pins it, (h) with no target.
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
#   lc_bounded <secs> <argv…>  <argv> run directly (no shell) in a fresh process group with stdin from /dev/null, and
#                              that whole group killed at <secs> (a missing, non-integer or zero <secs> reads as 1):
#                              exit 142. Otherwise the child's rc (128 + N when a signal ended it, 127 when it cannot
#                              exec), and the group is killed after a normal exit too, so a leftover descendant
#                              cannot hold a pipe open. A TERM, INT or HUP to lc_bounded kills the group, then exits
#                              143, 130 or 129, so a signal to the caller's group never orphans the call unbounded (the
#                              child sits in its own group and never sees that signal). A KILL cannot be caught, and a
#                              signal in the instant between the fork and the child's setpgrp misses the group. Its
#                              perl is inline, so sourcing still sets only _lc_dir. land.sh's `bounded`, and
#                              merge-task.sh's and self-rollout-check.sh's fetch runner.
#   lc_fetch <repo> <d> [<runner>]
#                              `[<runner>] git -C <repo> fetch --quiet --no-tags --no-write-fetch-head origin
#                              +refs/heads/<d>:refs/remotes/origin/<d>`, git's rc: one branch, never a tag, so an
#                              unrelated ref conflict (a stale origin/feat against origin's feat/x) never fails it.
#                              <runner>, one command word, is land.sh's `bounded`, merge-task.sh's `refresh_bounded`
#                              or self-rollout-check.sh's `fetch_bounded`.
#   lc_overlap_ref <repo> <ref>
#                              the paths a fast-forward to the full ref <ref> would overwrite, `, `-joined, cut to 200
#                              characters, or nothing. Changed C: `diff --no-renames --name-only HEAD <ref>`; dirty P:
#                              the same form for the index against HEAD and the working tree against the index, plus
#                              `ls-files --others --exclude-standard` (an ignored file is git's to overwrite), every
#                              list under core.quotePath=false so both sides quote a path alike. c meets p when c = p,
#                              c starts `p/` or p starts `c/`. A listing that fails (a <ref> that does not resolve
#                              included) prints nothing: the merge is still the guard. A case-only collision on a
#                              case-insensitive filesystem slips past it, and git's own refusal (which rewrites
#                              ORIG_HEAD) catches it; so does an index.lock, which the overlap never reads.
#   lc_overlap_list <repo> <ref>
#                              lc_overlap_ref's paths, one a line and whole, for a caller that reads them one by one.
#   lc_same <repo> <ref> <path>
#                              rc 0 when the checkout already holds <ref>'s copy of <path>: a regular file with <ref>'s
#                              blob (`git hash-object --path`, so filters apply), or gone from both. A fast-forward
#                              loses nothing there.
#   lc_doc <repo> <ref> <path> rc 0 when <path> is a handoff doc (a regular file directly under docs/handoffs/ or
#                              */docs/handoffs/) that <ref> holds too. Whatever differs is the doc's own lifecycle (its
#                              pickup's mark, a refresh at close), and the fast-forward keeps this copy.
#   lc_landed <repo> <d> <path>
#                              rc 0, printing the commit, when <path> is a landed close-out's THREAD.md: THREAD.md or
#                              */THREAD.md, a regular file (no symlink), its index entry absent, HEAD's or its own blob,
#                              and one of the newest 200 commits of `rev-list --full-history HEAD..refs/remotes/origin/<d>
#                              -- <path>` holding that blob at <path> (newest first). The default branch already holds
#                              that copy, so a move that replaces it loses nothing. It is how a checkout that waits on the
#                              Green tip keeps the close-out's THREAD.md land.sh leaves on disk (its settle_handed)
#                              without that copy ever holding a move back; it holds with no target too (the header).
#                              Any other path, or a copy no such commit holds, or a staged entry of some third blob, is
#                              rc 1 (an overlap as before).
#   lc_overlap <repo> <d> [<target>]
#                              the fast-forward's overlap: lc_overlap_ref's paths against <target> (refs/remotes/origin/
#                              <d> by default), less every lc_same or lc_doc path against <target>, and every lc_landed
#                              path (ADR 0078 d3: a landed close-out's own copy and a handoff doc left on disk never hold
#                              the checkout back). lc_doc and lc_landed lose nothing: the copy on disk stays or is a copy
#                              origin already holds. lc_overlap_ref, leg.py's overlap mode and _reset's, stays strict.
#   lc_busy <repo> <d>         why the checkout must not be moved, on stdout, rc 0, else rc 1: `index.lock present`, a
#                              half-applied operation in words (`a rebase in progress`, a merge, cherry-pick, revert,
#                              bisect, or `a cherry-pick or revert sequence in progress`), `HEAD detached`, or `on
#                              <cur>, not <d>`, in that order. lc_check's busy form and the content mode's.
#   lc_ahead_content <repo> <up> <ref>
#                              the content test (ADR 0078 d4; pushed-base.sh's block runs it too): whether the commits
#                              <ref> has over <up> are already on <up> by content. NUL-terminated records on stdout, in
#                              order: `T<path>` for each file those commits touch (`diff --no-renames <up>...<ref>`),
#                              `D<path>` for each of them that differs between <up> and <ref>, and last `=<rc>`: 0 no
#                              touched file differs (`diff --quiet`), 1 some do, 3 the commits touch no file, any other a
#                              git failure. Ancestry alone over-counts: a commit landed by a squash or cherry-pick stays
#                              "ahead" for ever. rc 0 always; the result is the last record. An ahead set that touches no
#                              file, or a failure, is never "on origin".
#   lc_ff <repo> <d> [<target>]
#                              the overlap first (lc_overlap against <target>): one prints its paths and returns 3,
#                              running nothing, so ORIG_HEAD is never rewritten (a refused `merge --ff-only` writes it).
#                              Then each lc_landed path whose commit <target> holds (and <target> has the path) gets
#                              <target>'s copy, `git restore --source=<target> --staged --worktree` (close-outs are built
#                              on origin's tip, so that copy holds it). <target>'s blob is staged for every other overlap
#                              path still on disk (git's two-way merge keeps an index entry that matches the target and
#                              refuses an untracked or unstaged copy; a doc, or a landed THREAD.md the target does not yet
#                              hold, that differs from it stays dirty, as it did when it was committed on HEAD). Every
#                              path written is unstaged again if the merge is refused (a restored one keeps <target>'s
#                              copy on disk, itself a landed blob). Then `git merge -q --ff-only --no-autostash
#                              <target>`: rc 0, or rc 1 with git's output (its `hint:` lines dropped) on one line of at
#                              most 200 characters.
#   lc_check <repo> <d> [<target>]
#                              exactly one line, the first form that holds (tips and heads 40-hex, counts integers).
#                              <tip> is the target (origin's tip with none) in every form; ahead and diverged count
#                              against origin/<d>, the rest against the target:
#                                unreadable <why>            HEAD, the target or refs/remotes/origin/<d> names no
#                                                            commit, or a count failed
#                                current <tip>               HEAD is the target (on any branch, detached included)
#                                ahead <tip> <a>             origin's tip is an ancestor of HEAD
#                                diverged <tip> <a> <b>      neither HEAD nor origin's tip is an ancestor of the other
#                                past <tip> <n>              a target only: HEAD is on origin/<d> (no commit ahead of
#                                                            it) but is origin's tip itself or not the target's
#                                                            ancestor; <n> counts target..HEAD. Never moved back.
#                                busy <tip> <why>            behind, and `index.lock present`, `a rebase in progress` (or
#                                                            a merge, cherry-pick, revert, bisect, cherry-pick or revert
#                                                            sequence), `HEAD detached`, or `on <cur>, not <d>`
#                                overlap <tip> <b> <paths>   behind, and lc_overlap names paths
#                                behind <tip> <b> <head>     behind, and free to fast-forward
#
# Run modes, `bash live-checkout.sh <mode> <repo> [<d> [<target>] | <ref>]`, scrub the caller's repo-local git env (git's own list,
# the two config channels kept) and unset CDPATH first. Their output and exit codes are a contract: default, fetch,
# check, ff and content are primary-refresh.py's, which parses them strictly (anything else reads as `broken:` there, never as
# current or moved), and overlap is leg.py's (ff_primary reads anything else as broken, WARNs, and lets git's own
# refusal guard its merge), so change each together with its reader:
#   default <repo>   lc_default_local, else lc_ssh_rule and lc_default: the branch on stdout, exit 0; exit 1 when
#                    neither the local refs nor origin answer.
#   fetch <repo> <d> lc_ssh_rule, then lc_fetch: git's stderr passes through, and the exit is git fetch's own rc, so a
#                    failed fetch never exits 0.
#   check <repo> <d> [<target>]
#                    lc_check's one line, exit 0 (a target that does not resolve reads unreadable).
#   ff <repo> <d> [<target>]
#                    exactly one line, exit 0: `moved <old40> <new40>`, `overlap <paths>` or `refused <why>` (a target
#                    that does not resolve is `refused <target> names no commit`).
#   content <repo> <d> [<target>]
#                    primary-refresh.py's repair read of a diverged checkout (ADR 0078 d4), exactly one line, exit 0, the
#                    first that holds: `busy <why>` (lc_busy, so HEAD is on <d> after it), `unreadable <why>` (git failed,
#                    or said differs and listed nothing, or the target names no commit), `untouched` (the commits ahead
#                    touch no file), `pending <n>` (a target that is not origin's tip only: no file of the <n> they touch
#                    differs from origin/<d>, but the target does not hold them yet), `landed <n>` (no file of the <n>
#                    they touch differs from origin/<d>, nor from the target when one is given) or `unlanded <k>
#                    <paths>` (<k> of them differ, `, `-joined and cut to 200 characters).
#   overlap <repo> <ref>
#                    <ref> a full ref (it starts `refs/`) or a commit id (40 or 64 hex): exactly one line, exit 0,
#                    `overlap <paths>` (lc_overlap_ref's) or `clear`. A <ref> that does not resolve reads `clear`,
#                    lc_overlap's fail-open rule.
# A <target> that is not 40 or 64 lowercase hex is a usage error.
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

lc_bounded() {
  perl -e '
my $t=shift; $t=1 unless defined $t && $t=~/^\d+$/ && $t>=1;
my $pid;
my %sn=(TERM=>15, INT=>2, HUP=>1);
for my $s (keys %sn) { my $n=$sn{$s}; $SIG{$s}=sub { kill "KILL",-$pid if $pid; exit 128+$n } }
$pid=fork; defined $pid or exit 127;
if(!$pid){ $SIG{$_}="DEFAULT" for keys %sn; setpgrp(0,0); exec { $ARGV[0] } @ARGV; exit 127 }
$SIG{ALRM}=sub{ kill "KILL",-$pid; waitpid($pid,0); exit 142 };
alarm $t; waitpid($pid,0); my $st=$?; alarm 0;
kill "KILL",-$pid;
exit($st & 127 ? 128+($st & 127) : $st >> 8)' "$@" </dev/null
}

lc_fetch() {
  ${3:+"$3"} git -C "${1:-}" fetch --quiet --no-tags --no-write-fetch-head origin \
    "+refs/heads/${2:-}:refs/remotes/origin/${2:-}"
}

lc_overlap_list() {
  local _lc_c _lc_p _lc_q _lc_u
  _lc_c=$(git -C "${1:-}" -c core.quotePath=false diff --no-renames --name-only HEAD "${2:-}" -- \
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
        if ($0 == p[i] || index($0, p[i] "/") == 1 || index(p[i], $0 "/") == 1) { print; break }
      }
    }' || :
  return 0
}

_lc_join() { awk '$0 != "" { out = out (out == "" ? "" : ", ") $0 } END { if (out != "") print substr(out, 1, 200) }'; }

lc_overlap_ref() { lc_overlap_list "${1:-}" "${2:-}" | _lc_join; }

lc_same() {
  local _lc_t _lc_h
  _lc_t=$(git -C "${1:-}" rev-parse -q --verify "${2:-}:${3:-}" 2>/dev/null) || _lc_t=
  if [ -z "$_lc_t" ]; then
    [ ! -e "${1:-}/${3:-}" ] && [ ! -L "${1:-}/${3:-}" ]
    return
  fi
  [ -f "${1:-}/${3:-}" ] && [ ! -L "${1:-}/${3:-}" ] || return 1
  _lc_h=$(git -C "${1:-}" hash-object --path="${3:-}" -- "${3:-}" 2>/dev/null) || return 1
  [ "$_lc_h" = "$_lc_t" ]
}

lc_doc() {
  local _lc_n
  case "${3:-}" in
    docs/handoffs/*) _lc_n=${3#docs/handoffs/} ;;
    */docs/handoffs/*) _lc_n=${3##*/docs/handoffs/} ;;
    *) return 1 ;;
  esac
  case "$_lc_n" in ''|*/*) return 1 ;; esac
  [ -f "${1:-}/${3:-}" ] && [ ! -L "${1:-}/${3:-}" ] || return 1
  git -C "${1:-}" rev-parse -q --verify "${2:-}:${3:-}" >/dev/null 2>&1
}

lc_landed() {
  local _lc_p=${3:-} _lc_h _lc_i _lc_hd _lc_cs _lc_ob _lc_c
  case "$_lc_p" in THREAD.md|*/THREAD.md) ;; *) return 1 ;; esac
  [ -f "${1:-}/$_lc_p" ] && [ ! -L "${1:-}/$_lc_p" ] || return 1
  _lc_h=$(git -C "${1:-}" hash-object --path="$_lc_p" -- "$_lc_p" 2>/dev/null) && [ -n "$_lc_h" ] || return 1
  _lc_i=$(git -C "${1:-}" rev-parse -q --verify ":$_lc_p" 2>/dev/null) || _lc_i=
  if [ -n "$_lc_i" ] && [ "$_lc_i" != "$_lc_h" ]; then
    _lc_hd=$(git -C "${1:-}" rev-parse -q --verify "HEAD:$_lc_p" 2>/dev/null) || _lc_hd=
    [ "$_lc_i" = "$_lc_hd" ] || return 1
  fi
  _lc_cs=$(git -C "${1:-}" rev-list --full-history --max-count=200 "HEAD..refs/remotes/origin/${2:-}" -- "$_lc_p" \
    2>/dev/null) || return 1
  [ -n "$_lc_cs" ] || return 1
  _lc_ob=$(printf '%s\n' "$_lc_cs" | while IFS= read -r _lc_c; do printf '%s:%s\n' "$_lc_c" "$_lc_p"; done \
    | git -C "${1:-}" cat-file --batch-check='%(objectname)' 2>/dev/null) || return 1
  _lc_c=$(_LC_CS=$_lc_cs _LC_OB=$_lc_ob awk -v h="$_lc_h" 'BEGIN {
    n = split(ENVIRON["_LC_CS"], c, "\n"); split(ENVIRON["_LC_OB"], o, "\n")
    for (i = 1; i <= n; i++) if (o[i] == h) { print c[i]; exit }
  }')
  [ -n "$_lc_c" ] || return 1
  printf '%s\n' "$_lc_c"
}

lc_overlap() {
  local _lc_x _lc_r="${3:-refs/remotes/origin/${2:-}}"
  lc_overlap_list "${1:-}" "$_lc_r" | while IFS= read -r _lc_x; do
    [ -n "$_lc_x" ] || continue
    lc_same "${1:-}" "$_lc_r" "$_lc_x" || lc_doc "${1:-}" "$_lc_r" "$_lc_x" \
      || lc_landed "${1:-}" "${2:-}" "$_lc_x" >/dev/null || printf '%s\n' "$_lc_x"
  done | _lc_join
}

lc_busy() {
  local _lc_l _lc_m _lc_cur
  _lc_l=$(git -C "${1:-}" rev-parse --path-format=absolute --git-path index.lock 2>/dev/null) || _lc_l=
  if [ -n "$_lc_l" ] && [ -e "$_lc_l" ]; then echo "index.lock present"; return 0; fi
  if _lc_m=$(lc_op "${1:-}"); then
    case "$_lc_m" in
      rebase-merge|rebase-apply) _lc_m="a rebase" ;;
      MERGE_HEAD) _lc_m="a merge" ;;
      CHERRY_PICK_HEAD) _lc_m="a cherry-pick" ;;
      REVERT_HEAD) _lc_m="a revert" ;;
      BISECT_LOG) _lc_m="a bisect" ;;
      *) _lc_m="a cherry-pick or revert sequence" ;;
    esac
    echo "$_lc_m in progress"; return 0
  fi
  _lc_cur=$(git -C "${1:-}" symbolic-ref -q --short HEAD 2>/dev/null) || { echo "HEAD detached"; return 0; }
  if [ "$_lc_cur" != "${2:-}" ]; then echo "on $_lc_cur, not ${2:-}"; return 0; fi
  return 1
}

lc_ahead_content() {
  local _lc_f _lc_rc
  local -a _lc_t=()
  while IFS= read -r -d '' _lc_f; do
    _lc_t+=("$_lc_f"); printf 'T%s\0' "$_lc_f"
  done < <(git -C "${1:-}" diff --no-renames --name-only -z "${2:-}...${3:-}" 2>/dev/null)
  if [ ${#_lc_t[@]} -eq 0 ]; then
    # No records is a commit set that touches nothing, or a listing that failed (its stderr is dropped above).
    git -C "${1:-}" diff --no-renames --name-only "${2:-}...${3:-}" >/dev/null 2>&1 && _lc_rc=0 || _lc_rc=$?
    if [ "$_lc_rc" != 0 ]; then printf '=%s\0' "$_lc_rc"; return 0; fi
    printf '=3\0'; return 0
  fi
  # --quiet first: its exit status is the answer (0 same, 1 differs, else a failure).
  git -C "${1:-}" --literal-pathspecs diff --quiet --no-renames "${2:-}" "${3:-}" -- "${_lc_t[@]}" >/dev/null 2>&1 \
    && _lc_rc=0 || _lc_rc=$?
  if [ "$_lc_rc" = 1 ]; then
    while IFS= read -r -d '' _lc_f; do
      printf 'D%s\0' "$_lc_f"
    done < <(git -C "${1:-}" --literal-pathspecs diff --no-renames --name-only -z "${2:-}" "${3:-}" -- "${_lc_t[@]}" 2>/dev/null)
  fi
  printf '=%s\0' "$_lc_rc"
}

lc_ff() {
  local _lc_o _lc_x _lc_b _lc_m _lc_c _lc_added= _lc_r="${3:-refs/remotes/origin/${2:-}}"
  _lc_o=$(lc_overlap "${1:-}" "${2:-}" ${3:+"$3"})
  if [ -n "$_lc_o" ]; then printf '%s\n' "$_lc_o"; return 3; fi
  while IFS= read -r _lc_x; do
    [ -n "$_lc_x" ] || continue
    _lc_c=$(lc_landed "${1:-}" "${2:-}" "$_lc_x") || continue
    git -C "${1:-}" rev-parse -q --verify "$_lc_r:$_lc_x" >/dev/null 2>&1 || continue
    git -C "${1:-}" merge-base --is-ancestor "$_lc_c" "$_lc_r" 2>/dev/null || continue
    if git -C "${1:-}" restore --source="$_lc_r" --staged --worktree -- "$_lc_x" 2>/dev/null; then
      _lc_added="$_lc_added$_lc_x
"
    fi
  done <<_LC_EOF
$(lc_overlap_list "${1:-}" "$_lc_r")
_LC_EOF
  while IFS= read -r _lc_x; do
    [ -n "$_lc_x" ] && [ -e "${1:-}/$_lc_x" ] || continue
    _lc_b=$(git -C "${1:-}" rev-parse -q --verify "$_lc_r:$_lc_x" 2>/dev/null) || continue
    [ "$(git -C "${1:-}" rev-parse -q --verify ":$_lc_x" 2>/dev/null)" != "$_lc_b" ] || continue
    _lc_m=$(git -C "${1:-}" ls-tree "$_lc_r" -- "$_lc_x" 2>/dev/null | awk '{ print $1; exit }')
    if [ -n "$_lc_m" ] && git -C "${1:-}" update-index --add --cacheinfo "$_lc_m,$_lc_b,$_lc_x" 2>/dev/null; then
      _lc_added="$_lc_added$_lc_x
"
    fi
  done <<_LC_EOF
$(lc_overlap_list "${1:-}" "$_lc_r")
_LC_EOF
  if _lc_o=$(git -C "${1:-}" merge -q --ff-only --no-autostash "$_lc_r" 2>&1); then return 0; fi
  printf '%s' "$_lc_added" | while IFS= read -r _lc_x; do
    [ -z "$_lc_x" ] || git -C "${1:-}" reset -q -- "$_lc_x" 2>/dev/null || :
  done
  _lc_o=$(printf '%s\n' "$_lc_o" | tr '\t\r' '  ' \
    | awk '$1 != "hint:" && NF { $1 = $1; s = s (s == "" ? "" : " ") $0 } END { print s }')
  printf '%s\n' "$(printf '%s' "${_lc_o:-git merge --ff-only failed}" | cut -c1-200)"
  return 1
}

lc_check() {
  local _lc_h _lc_t _lc_a _lc_b _lc_m _lc_o _lc_rc _lc_r="${3:-refs/remotes/origin/${2:-}}"
  _lc_h=$(git -C "${1:-}" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) \
    || { echo "unreadable HEAD names no commit"; return 0; }
  _lc_t=$(git -C "${1:-}" rev-parse -q --verify "$_lc_r^{commit}" 2>/dev/null) \
    || { echo "unreadable $_lc_r names no commit"; return 0; }
  if [ -n "${3:-}" ]; then
    git -C "${1:-}" rev-parse -q --verify "refs/remotes/origin/${2:-}^{commit}" >/dev/null 2>&1 \
      || { echo "unreadable refs/remotes/origin/${2:-} names no commit"; return 0; }
  fi
  if [ "$_lc_h" = "$_lc_t" ]; then echo "current $_lc_t"; return 0; fi
  _lc_a=$(git -C "${1:-}" rev-list --count "refs/remotes/origin/${2:-}..HEAD" 2>/dev/null) || _lc_a=
  _lc_b=$(git -C "${1:-}" rev-list --count "HEAD..refs/remotes/origin/${2:-}" 2>/dev/null) || _lc_b=
  case "$_lc_a" in ''|*[!0-9]*) _lc_a= ;; esac
  case "$_lc_b" in ''|*[!0-9]*) _lc_b= ;; esac
  if [ -z "$_lc_a" ] || [ -z "$_lc_b" ]; then
    echo "unreadable cannot count HEAD against refs/remotes/origin/${2:-}"; return 0
  fi
  if [ "$_lc_a" != 0 ]; then
    if [ "$_lc_b" = 0 ]; then echo "ahead $_lc_t $_lc_a"; return 0; fi
    echo "diverged $_lc_t $_lc_a $_lc_b"; return 0
  fi
  if [ -n "${3:-}" ]; then
    # On origin (no commit ahead of it): past the target when HEAD is origin's tip or not the target's ancestor.
    _lc_rc=0
    [ "$_lc_b" = 0 ] || { git -C "${1:-}" merge-base --is-ancestor HEAD "$_lc_t" 2>/dev/null || _lc_rc=$?; }
    [ "$_lc_b" = 0 ] && _lc_rc=1
    if [ "$_lc_rc" = 1 ]; then
      _lc_a=$(git -C "${1:-}" rev-list --count "$_lc_t..HEAD" 2>/dev/null) || _lc_a=
      case "$_lc_a" in ''|*[!0-9]*) echo "unreadable cannot count HEAD against $_lc_t"; return 0 ;; esac
      echo "past $_lc_t $_lc_a"; return 0
    fi
    [ "$_lc_rc" = 0 ] || { echo "unreadable cannot compare HEAD with $_lc_t (git merge-base exit $_lc_rc)"; return 0; }
    _lc_b=$(git -C "${1:-}" rev-list --count "HEAD..$_lc_t" 2>/dev/null) || _lc_b=
    case "$_lc_b" in ''|*[!0-9]*) echo "unreadable cannot count HEAD against $_lc_t"; return 0 ;; esac
  fi
  if _lc_m=$(lc_busy "${1:-}" "${2:-}"); then echo "busy $_lc_t $_lc_m"; return 0; fi
  _lc_o=$(lc_overlap "${1:-}" "${2:-}" ${3:+"$3"})
  if [ -n "$_lc_o" ]; then echo "overlap $_lc_t $_lc_b $_lc_o"; return 0; fi
  echo "behind $_lc_t $_lc_b $_lc_h"
}

# _lc_hex <s>: a full commit id, 40 or 64 lowercase hex (a run mode's optional target).
_lc_hex() {
  case "${1:-}" in ''|*[!0-9a-f]*) return 1 ;; esac
  [ ${#1} -eq 40 ] || [ ${#1} -eq 64 ]
}

lc_loaded() { :; }

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  for _lc_v in $(git rev-parse --local-env-vars 2>/dev/null); do
    case $_lc_v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$_lc_v" ;; esac
  done
  unset CDPATH
  _lc_usage="live-checkout: usage: live-checkout.sh default <repo> | fetch <repo> <branch> | check <repo> <branch> [<target>] | ff <repo> <branch> [<target>] | content <repo> <branch> [<target>] | overlap <repo> <refs/… | target>"
  case "${1:-}" in
    default)
      [ $# -eq 2 ] && [ -n "$2" ] || { echo "$_lc_usage" >&2; exit 2; }
      lc_default_local "$2" && exit 0
      lc_ssh_rule "$2"
      _lc_b=$(lc_default "$2") && [ -n "$_lc_b" ] || exit 1
      printf '%s\n' "$_lc_b"; exit 0 ;;
    fetch|check|ff)
      { [ $# -eq 3 ] || { [ $# -eq 4 ] && [ "$1" != fetch ] && _lc_hex "$4"; }; } && [ -n "$2" ] && [ -n "$3" ] \
        || { echo "$_lc_usage" >&2; exit 2; }
      case "$1" in
        fetch) lc_ssh_rule "$2"; lc_fetch "$2" "$3"; exit $? ;;
        check) lc_check "$2" "$3" ${4:+"$4"}; exit 0 ;;
      esac
      _lc_old=$(git -C "$2" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) \
        || { echo "refused HEAD names no commit"; exit 0; }
      if [ -n "${4:-}" ] && ! git -C "$2" rev-parse -q --verify "$4^{commit}" >/dev/null 2>&1; then
        echo "refused $4 names no commit"; exit 0
      fi
      _lc_o=$(lc_ff "$2" "$3" ${4:+"$4"}); _lc_rc=$?
      case $_lc_rc in
        0) _lc_new=$(git -C "$2" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null) \
             || { echo "refused HEAD names no commit after the merge"; exit 0; }
           echo "moved $_lc_old $_lc_new" ;;
        3) echo "overlap $_lc_o" ;;
        *) echo "refused ${_lc_o:-git merge --ff-only failed}" ;;
      esac
      exit 0 ;;
    content)
      { [ $# -eq 3 ] || { [ $# -eq 4 ] && _lc_hex "$4"; }; } && [ -n "$2" ] && [ -n "$3" ] \
        || { echo "$_lc_usage" >&2; exit 2; }
      if _lc_w=$(lc_busy "$2" "$3"); then echo "busy $_lc_w"; exit 0; fi
      if [ -n "${4:-}" ] && ! git -C "$2" rev-parse -q --verify "$4^{commit}" >/dev/null 2>&1; then
        echo "unreadable $4 names no commit"; exit 0
      fi
      _lc_n=0 _lc_k=0 _lc_ps= _lc_rc=
      while IFS= read -r -d '' _lc_r; do
        case "$_lc_r" in
          T*) _lc_n=$((_lc_n + 1)) ;;
          D*) _lc_k=$((_lc_k + 1)); _lc_ps="$_lc_ps${_lc_ps:+, }${_lc_r#D}" ;;
          =*) _lc_rc=${_lc_r#=} ;;
        esac
      done < <(lc_ahead_content "$2" "refs/remotes/origin/$3" "refs/heads/$3")
      if [ "$_lc_rc" = 0 ] && [ -n "${4:-}" ] \
         && [ "$(git -C "$2" rev-parse -q --verify "$4^{commit}" 2>/dev/null)" != "$(git -C "$2" rev-parse -q --verify "refs/remotes/origin/$3^{commit}" 2>/dev/null)" ]; then
        # On origin by content: the target holds it too (landed), or not yet (pending: the target is behind it).
        _lc_t=
        while IFS= read -r -d '' _lc_r; do case "$_lc_r" in =*) _lc_t=${_lc_r#=} ;; esac; done \
          < <(lc_ahead_content "$2" "$4" "refs/heads/$3")
        case "$_lc_t" in
          0) ;;
          1|3) echo "pending $_lc_n"; exit 0 ;;
          *) echo "unreadable git diff failed against $4 (${_lc_t:-no result})"; exit 0 ;;
        esac
      fi
      case "$_lc_rc" in
        0) echo "landed $_lc_n" ;;
        3) echo "untouched" ;;
        1) if [ "$_lc_k" -gt 0 ]; then echo "unlanded $_lc_k $(printf '%s' "$_lc_ps" | tr '\t\n' '  ' | cut -c1-200)"
           else echo "unreadable git said the files differ and listed none"; fi ;;
        *) echo "unreadable git diff failed (${_lc_rc:-no result})" ;;
      esac
      exit 0 ;;
    overlap)
      [ $# -eq 3 ] && [ -n "$2" ] || { echo "$_lc_usage" >&2; exit 2; }
      case "$3" in refs/?*) ;; *) _lc_hex "$3" || { echo "$_lc_usage" >&2; exit 2; } ;; esac
      _lc_o=$(lc_overlap_ref "$2" "$3")
      if [ -n "$_lc_o" ]; then echo "overlap $_lc_o"; else echo clear; fi
      exit 0 ;;
    *) echo "$_lc_usage" >&2; exit 2 ;;
  esac
fi
