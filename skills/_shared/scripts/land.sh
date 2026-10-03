#!/usr/bin/env bash
# land.sh — the one shared landing route (ADR 0028 as amended: queue and finish). It commits the handed
# close-out paths on the repo's current branch, then lands them by the repo's own rules, synchronously:
# no background process, no lock, no polling, no waiting for a merge.
#
#   land.sh [--slug <s>] [-F <msgfile>] [--commit-only] [--] <repo> [<path>…]
#   land.sh --origin-slug <repo>      prints <owner>/<name> for a GitHub origin, else exit 4, stdout empty
#
# <repo> is any path inside the repo, a directory `git rm -f` just removed included: it resolves through
# its nearest existing ancestor. Each <path> must be THREAD.md, */THREAD.md, or a file directly under
# docs/handoffs/ or */docs/handoffs/, inside the repo. With no -F the message is `📝 docs(thread): close-out`.
#
# stdout is exactly one line, printed by the parent process after the body exits:
#   landed · queued <url> · queued: needs merge <url> · not landed: <reason> · stuck: <reason>
# Exit 0 for all but stuck (1). A usage error exits 2 with stdout empty.
# stderr carries `land: …` lines: `land: commit <sha40>` (this run's commit, final SHA after any rebase)
# or `land: nothing committed`, `land: carried <N> earlier close-out commit(s)`, `land: nothing to land`,
# `land: dropped <rel> (…)`, `land: ff refused: …`, `land: label failed: …`, `land: update-branch failed: …`,
# `land: skipped <step>: deadline`, `land: held the primary checkout at <sha>, …: <why>`, and git's or gh's
# own diagnostics.
#
# Route (landing-register.py decides may-push; the repo's branch protection decides how):
#   commit-only · swept by the daily sweep · listed on the landing register · no GitHub origin · a
#   checkout not on origin's default branch  →  commit only, `not landed: <reason>`, no network call
#   (a non-default checkout may need one ls-remote to learn the default when origin/HEAD is unset).
#   Unprotected default branch → push it (a diverged origin: one rebase in a scratch worktree, then the
#   branch moves by a two-tree read-tree, which keeps non-overlapping local changes exactly).
#   The primary checkout (the checkout this plugin runs from, live) never moves while a rollout runs on it
#   (ADR 0031): S4 skips its fast-forward, and a diverged unprotected origin gets the rebased tip pushed
#   without moving the branch. A protected landing is unaffected: its PR merges on GitHub.
#   Protected → push HEAD unchanged to close/<cdate>-<slug>-<sha12>, open the PR over REST, label it
#   `landing`, queue `gh pr merge --auto --merge`, and update-branch once when origin/<d> moved on.
#
# Own-branch mode (ADR 0028 §§ 1–3, 5; close's § Land the own branch) lands the session's own branch <B>:
#
#   land.sh --own-branch --branch <B> [--queue --reviewed <sha> | --hold -F <diagnosis>] [--] <repo>
#
# It never commits, never forces, never rebases and never deletes <B>; <B> moves only forward (a fast-forward
# to origin/<B>, or a merge commit over update-branch's merges, made in a scratch worktree). One call:
# preflight (the checkout must be on <B>) · route (S2) · <B> is not the default · fetch origin/<d> and
# origin/<B> (`land: base <sha>`, `land: head <sha>`) · push.default upstream|tracking is stuck · nothing
# ahead is `landed` · push access · the newest same-repo PR headed <B> (another author's: not landed; closed
# unmerged: stuck; merged with HEAD in its head: landed) · auto-merge switched off on every call but --queue
# · --queue only: every commit after --reviewed touches docs/reviews/ alone · push <B> to itself · open and
# label the `landing` PR · then the action:
#   plain    point <B>'s upstream at origin/<d> (the review base), print `land: upstream origin/<d> (was …)`
#            and the tree line, `land: tree dirty: <paths>` or `land: digest <diff6>` (fresh-review's
#            Step 1 digest, byte for byte); result `pr open <url>`
#   --hold   comment `Landing held (thread:close, ADR 0028 § 3)` plus the diagnosis; result `held <url>`
#   --queue  read protection, then ONE snapshot of check-runs and status on R (--reviewed) and HEAD. A
#            `failure` on either (HEAD's own pass for that name supersedes R's) is `ci failed: <name>
#            (failure: <title>) <url>` and no merge. The merge decision reads HEAD alone: pending, infra
#            (cancelled, timed_out, startup_failure, action_required, stale, status error), green, or none.
#            No checks on HEAD is pending when CI exists (a workflow file in HEAD, or checks on origin/<d>'s
#            tip), and green only when there is no CI at all. Protected: auto-merge (`queued <url>`), or a
#            direct merge when that is refused and HEAD is green (`landed`), else `queued: needs merge`;
#            update-branch once when queued and behind. Unprotected: pending or infra is `queued: needs
#            merge` with no merge call; green is a direct merge, `landed`.
# Every own-branch result but usage errors, preflight errors and the plain call's `pr open` ends by pointing
# <B>'s upstream back at origin/<B> (`land: upstream origin/<B> (was origin/<d>)`), when it is at origin/<d>.
# Results: pr open <url> · held <url> · queued <url> · queued: needs merge <url> · ci failed: … · landed ·
# not landed: <reason> · stuck: <reason>. Exit 0 but stuck (1) and usage (2).
#
# Every network call runs under `bounded` (LAND_TIMEOUT seconds each, default 30; LAND_DEADLINE seconds
# overall, default 450). The body runs in a subshell whose fd 1 is stderr, so no child — a hook that
# daemonizes, git's own maintenance — can ever hold the caller's stdout; git's auto-gc and
# auto-maintenance are switched off for every git call here. bash 3.2-compatible (macOS); deliberately no
# `set -u`/`set -e`: every rc is checked, and every array expansion is guarded.
set -o pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)

# ---- environment -----------------------------------------------------------------------------------------
# A caller's GIT_DIR, GIT_WORK_TREE & co. (a git hook exports them) would override -C. Unset git's own list
# of repo-local vars, except the two config channels, which cannot move the repo.
for v in $(git rev-parse --local-env-vars 2>/dev/null); do
  case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac
done
# gc guard: no git call here may start a detached `gc --auto` / `maintenance run --auto` that outlives the
# run. Appended after any caller-set keys, which keep applying.
land_cfg_n=${GIT_CONFIG_COUNT:-0}
[[ $land_cfg_n =~ ^[0-9]+$ ]] || land_cfg_n=0
land_cfg_n=$((10#$land_cfg_n))
export "GIT_CONFIG_KEY_$land_cfg_n=gc.auto" "GIT_CONFIG_VALUE_$land_cfg_n=0"
land_cfg_n=$((land_cfg_n + 1))
export "GIT_CONFIG_KEY_$land_cfg_n=maintenance.auto" "GIT_CONFIG_VALUE_$land_cfg_n=false"
export GIT_CONFIG_COUNT=$((land_cfg_n + 1))
export LC_ALL=C GIT_TERMINAL_PROMPT=0 GH_PROMPT_DISABLED=1 GCM_INTERACTIVE=never

# ---- bounded: one network call, killed with its whole process group at the budget ----------------------
# The deadline check and the budget are one read of SECONDS. 124: the deadline passed, nothing ran.
# 142: the call timed out. perl execs the argv directly (no shell) in a fresh process group, and kills
# that group after a normal exit too, so a leftover descendant cannot hold a pipe open.
read -r -d '' LAND_BOUNDED_PL <<'PL'
my $t=shift; $t=1 unless defined $t && $t=~/^\d+$/ && $t>=1;
my $pid=fork; defined $pid or exit 127;
if(!$pid){ setpgrp(0,0); exec { $ARGV[0] } @ARGV; exit 127 }
$SIG{ALRM}=sub{ kill 'KILL',-$pid; waitpid($pid,0); exit 142 };
alarm $t; waitpid($pid,0); my $st=$?; alarm 0;
kill 'KILL',-$pid;
exit($st & 127 ? 128+($st & 127) : $st >> 8)
PL

bounded() {
  local rem=$((LAND_DEADLINE - SECONDS)) t=$LAND_TIMEOUT
  [ "$rem" -lt 1 ] && return 124          # deadline: nothing run
  [ "$rem" -lt "$t" ] && t=$rem
  perl -e "$LAND_BOUNDED_PL" "$t" "$@" </dev/null
}

# net_rc <rc> <step> required|optional <errfile> [git] — classify a bounded call's rc. 0 ok; 124 the
# deadline (an optional step prints its skip note); 1 a failure, with NET_ERR its first line (`timed out`
# on 142), or with `git` its git_line.
net_rc() {
  local rc=$1 step=$2 kind=$3 ef=$4 pick=first_line
  [ "${5:-}" = git ] && pick=git_line
  NET_ERR=
  [ "$rc" = 0 ] && return 0
  if [ "$rc" = 124 ]; then
    NET_ERR="deadline passed before $step"
    [ "$kind" = optional ] && echo "land: skipped $step: deadline"
    return 124
  fi
  [ -n "$ef" ] && [ -s "$ef" ] && cat "$ef"
  if [ "$rc" = 142 ]; then NET_ERR="timed out"; else NET_ERR=$($pick "$ef"); [ -n "$NET_ERR" ] || NET_ERR="rc $rc"; fi
  return 1
}

first_line() { [ -f "$1" ] && sed -n '/[^[:space:]]/{s/^[[:space:]]*//;p;q;}' "$1" | cut -c1-200; }

# git_line <errfile>: the line of a git network call's stderr that says why — the first ` ! [<status>]`
# ref line, `remote: error…` or `error:` line, trimmed (git pads sideband lines) and squeezed — else
# first_line. A push's first line is its `To <url>` header, and a transport failure's own first line
# beats git's generic `fatal:`.
git_line() {
  local l
  [ -f "$1" ] || return 0
  l=$(grep -m 1 -E '^ ! \[|^remote: error|^error:' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[[:space:]][[:space:]]*/ /g' | cut -c1-200)
  [ -n "$l" ] && { printf '%s\n' "$l"; return 0; }
  first_line "$1"
}

result() { printf '%s\n' "$1" > "$LAND_RES"; }

usage() { echo "land: usage: land.sh [--slug <s>] [-F <msgfile>] [--commit-only] [--] <repo> [<path>…] | land.sh --origin-slug <repo> | land.sh --own-branch --branch <B> [--queue --reviewed <sha> | --hold -F <diagnosis>] [--] <repo>"; exit 2; }

# phys <path>: PHYS_ANC is the nearest existing directory, physical; PHYS_TAIL the missing rest ('' or
# /a/b). PHYS is both joined. A `.` or `..` in the missing tail cannot be resolved, so it fails.
phys() {
  local p=$1 tail=
  case $p in /*) ;; *) p="$PWD/$p" ;; esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  if [ ! -d "$p" ]; then tail="/${p##*/}"; p=${p%/*}; [ -n "$p" ] || p=/; fi
  while [ ! -d "$p" ]; do tail="/${p##*/}$tail"; p=${p%/*}; [ -n "$p" ] || p=/; done
  PHYS_ANC=$(cd "$p" 2>/dev/null && pwd -P) || return 1
  [ "$PHYS_ANC" = / ] && PHYS_ANC=
  PHYS_TAIL=$tail
  PHYS="$PHYS_ANC$tail"
  [ -n "$PHYS_ANC" ] || PHYS_ANC=/
  case "$tail/" in */./*|*/../*|*//*) return 2 ;; esac
  return 0
}

# origin_slug <url> → <owner>/<name> for the three GitHub URL forms landing-register.py accepts.
origin_slug() {
  local u=$1 rest
  case $u in
    https://github.com/*) rest=${u#https://github.com/} ;;
    git@github.com:*) rest=${u#git@github.com:} ;;
    ssh://git@github.com/*) rest=${u#ssh://git@github.com/} ;;
    *) return 1 ;;
  esac
  rest=${rest%/}; rest=${rest%.git}
  [[ $rest =~ ^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+$ ]] || return 1
  case ${rest#*/} in *[!.]*) ;; *) return 1 ;; esac
  printf '%s\n' "$rest"
}

# closeout_shaped <rel>: THREAD.md, */THREAD.md, or a file directly under (*/)docs/handoffs/.
closeout_shaped() {
  local r=$1 f=
  case $r in
    THREAD.md|*/THREAD.md) return 0 ;;
    docs/handoffs/*) f=${r#docs/handoffs/} ;;
    */docs/handoffs/*) f=${r##*/docs/handoffs/} ;;
    *) return 1 ;;
  esac
  [ -n "$f" ] || return 1
  case $f in */*) return 1 ;; esac
  return 0
}

# The fixed swept list mirrors daily-sweep.sh, test included: the sweep commits and pushes an entry only
# when it holds a .git directory (a .git file, a linked worktree, is skipped there and so here). Every
# $HOME/repos/concepts/<c>/ with a .git directory joins.
swept() {
  local t=$1 e p
  for e in "$HOME/repos/workspaces" "$HOME/repos/obsidian" "$HOME/.claude" "$HOME/.agents" "$HOME/Projects" \
           "$HOME/Projects/Life/audio-archive" "$HOME/Projects/Life/grandma-shirleys-book" \
           "$HOME/Projects/Narcissus/narcissus-echo" "$HOME"/repos/concepts/*/; do
    [ -d "${e%/}/.git" ] || continue
    p=$(cd "$e" 2>/dev/null && pwd -P) || continue
    [ "$p" = "$t" ] && return 0
  done
  return 1
}

# The whole flow. It runs in a subshell whose fd 1 is stderr; its one result goes through result().
main() {
  SECONDS=0
  [[ ${LAND_TIMEOUT:-} =~ ^[1-9][0-9]*$ ]] || LAND_TIMEOUT=30
  [[ ${LAND_DEADLINE:-} =~ ^[0-9]+$ ]] || LAND_DEADLINE=450
  LAND_TIMEOUT=$((10#$LAND_TIMEOUT)); LAND_DEADLINE=$((10#$LAND_DEADLINE))

  if [ "${1:-}" = --own-branch ]; then shift; own_main "$@"; exit 1; fi

  local slug_arg= msgfile= commit_only= repo made= pending= class= reason= b= bref= d= top slug
  local -a paths=() rels=() list=()

  if [ "${1:-}" = --origin-slug ]; then
    [ $# -eq 2 ] && [ -n "$2" ] || usage
    phys "$2"; [ $? = 1 ] && exit 4
    slug=$(origin_slug "$(git -C "$PHYS_ANC" remote get-url origin 2>/dev/null)") || exit 4
    result "$slug"; exit 0
  fi
  while [ $# -gt 0 ]; do
    case $1 in
      --slug) [ $# -ge 2 ] || usage; slug_arg=$2; shift 2 ;;
      -F) [ $# -ge 2 ] && [ -n "$2" ] || usage; msgfile=$2; shift 2 ;;
      --commit-only) commit_only=1; shift ;;
      --) shift; break ;;
      -*) usage ;;
      *) break ;;
    esac
  done
  [ $# -ge 1 ] && [ -n "$1" ] || usage
  repo=$1; shift
  paths=("$@")
  if [ -n "$msgfile" ]; then
    [ -f "$msgfile" ] && [ -r "$msgfile" ] || { echo "land: message file not readable: $msgfile"; exit 2; }
  fi

  tmpd=$(mktemp -d "${TMPDIR:-/tmp}/land.XXXXXX") || { result "stuck: cannot create temp dir"; echo "land: nothing committed"; exit 1; }
  trap 'rm -rf "$tmpd"' EXIT
  if [ -z "$msgfile" ]; then msgfile=$tmpd/msg; printf '%s\n' '📝 docs(thread): close-out' > "$msgfile"; fi

  # stuck_early <reason>: stuck before any commit.  finish <line> <rc>: the one way out after S5.
  stuck_early() { result "stuck: $1"; echo "land: nothing committed"; exit 1; }
  finish() {
    [ -n "$made" ] && echo "land: commit $made"
    result "$1"; exit "$2"
  }

  # ---- S1. Local preflight ----------------------------------------------------------------------------
  phys "$repo"; [ $? = 1 ] && stuck_early "cannot resolve $repo"
  top=$(git -C "$PHYS_ANC" rev-parse --show-toplevel 2>"$tmpd/top.err") && [ -n "$top" ] \
    || stuck_early "not a git work tree: $(first_line "$tmpd/top.err")"
  top=$(cd "$top" && pwd -P) || stuck_early "cannot enter $top"
  local p rel
  for p in ${paths[@]+"${paths[@]}"}; do
    phys "$p" || stuck_early "path outside $top: $p"
    case $PHYS in "$top"/?*) rel=${PHYS#"$top"/} ;; *) stuck_early "path outside $top: $p" ;; esac
    closeout_shaped "$rel" || stuck_early "not a close-out path: $rel"
    rels+=("$rel")
  done
  cd "$top" || stuck_early "cannot enter $top"
  bref=$(git symbolic-ref -q HEAD) || stuck_early "detached HEAD"
  b=${bref#refs/heads/}
  local m
  for m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
    [ -e "$(git rev-parse --path-format=absolute --git-path "$m")" ] && stuck_early "half-applied operation ($m)"
  done
  if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -z "${GIT_SSH:-}" ] && [ -z "$(git config core.sshCommand 2>/dev/null)" ]; then
    export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
  fi

  # ---- S2. Route class, local only --------------------------------------------------------------------
  if [ -n "$commit_only" ]; then
    class=deferred; reason=commit-only
  elif swept "$top"; then
    class=deferred; reason="swept by the daily sweep"
  else
    local reg reg_rc
    reg=$(python3 "$here/landing-register.py" check "$top" 2>"$tmpd/reg.err"); reg_rc=$?
    [ -s "$tmpd/reg.err" ] && cat "$tmpd/reg.err"
    case $reg_rc in
      0) class=landable ;;
      3) class=deferred; reason=$reg ;;
      4) class=deferred; reason="no GitHub origin" ;;
      *) class=pending; pending="landing register: $(first_line "$tmpd/reg.err")" ;;
    esac
  fi

  # ---- S3. Default branch, landable class only ----------------------------------------------------------
  local out rc
  if [ "$class" = landable ]; then
    d=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) && d=${d#refs/remotes/origin/}
    if [ -z "$d" ]; then
      out=$(bounded git ls-remote --symref origin HEAD 2>"$tmpd/lsr.err"); rc=$?
      net_rc "$rc" ls-remote required "$tmpd/lsr.err" git; rc=$?
      if [ "$rc" = 0 ]; then
        d=$(printf '%s\n' "$out" | awk '/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }')
        [ -n "$d" ] || { class=pending; pending="default branch unresolved: origin sent no HEAD symref"; }
      elif [ "$rc" = 124 ]; then class=pending; pending=$NET_ERR
      else class=pending; pending="default branch unresolved: $NET_ERR"
      fi
    fi
    if [ "$class" = landable ] && [ "$b" != "$d" ]; then class=deferred; reason="on $b, not $d"; fi
  fi

  # ---- S4. Refresh: only a landable repo on its default branch ------------------------------------------
  if [ "$class" = landable ] && [ "$b" = "$d" ]; then
    bounded git fetch --no-tags --no-write-fetch-head origin "+refs/heads/$d:refs/remotes/origin/$d" 2>"$tmpd/fetch.err"; rc=$?
    net_rc "$rc" fetch required "$tmpd/fetch.err" git; rc=$?
    if [ "$rc" = 124 ]; then class=pending; pending=$NET_ERR
    elif [ "$rc" != 0 ]; then class=pending; pending="cannot fetch origin/$d: $NET_ERR"
    elif ! git rev-parse -q --verify HEAD >/dev/null; then
      git rev-parse -q --verify "refs/remotes/origin/$d" >/dev/null \
        && stuck_early "local branch has no common history with origin/$d"
    elif [ "$(git rev-parse HEAD)" != "$(git rev-parse "refs/remotes/origin/$d")" ] \
         && git merge-base --is-ancestor HEAD "refs/remotes/origin/$d"; then
      if primary_hold; then
        echo "land: held the primary checkout at $(git rev-parse --short HEAD), not fast-forwarded: $HOLD"
      elif ! git merge --ff-only --no-autostash -q "refs/remotes/origin/$d" >"$tmpd/ff.err" 2>&1; then
        echo "land: ff refused: $(first_line "$tmpd/ff.err")"
      fi
    fi
  fi

  # ---- S5. Stage and commit the handed paths ----------------------------------------------------------
  for rel in ${rels[@]+"${rels[@]}"}; do
    if [ -e "$rel" ] || [ -L "$rel" ]; then
      if ! git add -- "$rel" 2>"$tmpd/add.err"; then
        git check-ignore -q -- "$rel" && stuck_early "ignored: $rel"
        stuck_early "add failed: $rel: $(first_line "$tmpd/add.err")"
      fi
      list+=("$rel")
    elif git cat-file -e "HEAD:$rel" 2>/dev/null; then
      git rm -q --cached --ignore-unmatch -- "$rel" 2>"$tmpd/rm.err" \
        || stuck_early "add failed: $rel: $(first_line "$tmpd/rm.err")"
      list+=("$rel")
    elif git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
      git rm -q --cached -- "$rel" 2>"$tmpd/rm.err" || stuck_early "add failed: $rel: $(first_line "$tmpd/rm.err")"
      echo "land: dropped $rel (not on disk, index-only; unstaged)"
    else
      echo "land: dropped $rel (not on disk, never tracked)"
    fi
  done
  local commit_failed=
  commit_paths() {
    [ "${#list[@]}" -gt 0 ] || { echo "land: nothing committed"; return 0; }
    if git diff --cached --quiet -- "${list[@]}"; then echo "land: nothing committed"; return 0; fi
    git commit -q -F "$msgfile" -- "${list[@]}" 2>"$tmpd/commit.err" || { commit_failed=1; return 1; }
    made=$(git rev-parse HEAD)
  }
  if ! commit_paths; then
    [ -s "$tmpd/commit.err" ] && cat "$tmpd/commit.err"
    stuck_early "commit failed: $(first_line "$tmpd/commit.err")"
  fi
  [ -s "$tmpd/commit.err" ] && cat "$tmpd/commit.err"

  # ---- S6. The deferred classes, and stuck results pending from S2–S4 -----------------------------------
  [ "$class" = deferred ] && finish "not landed: $reason" 0
  [ "$class" = pending ] && finish "stuck: $pending" 1

  # ---- S7. The ahead set A = origin/<d>..HEAD ---------------------------------------------------------
  local od="refs/remotes/origin/$d" ahead count
  ahead=$(git rev-list "$od..HEAD" 2>"$tmpd/rl.err") || finish "stuck: cannot list commits ahead of origin/$d: $(first_line "$tmpd/rl.err")" 1
  count=$(printf '%s' "$ahead" | grep -c .)
  if [ "$count" = 0 ]; then
    [ -z "$made" ] && echo "land: nothing to land"
    finish landed 0
  fi

  # ---- S8. Push access --------------------------------------------------------------------------------
  slug=$(origin_slug "$(git remote get-url origin 2>/dev/null)") || finish "stuck: origin is not a GitHub slug" 1
  out=$(bounded gh api "repos/$slug" --jq '.permissions.push | tostring' 2>"$tmpd/acc.err"); rc=$?
  net_rc "$rc" "push access" required "$tmpd/acc.err"; rc=$?
  [ "$rc" = 124 ] && finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || finish "stuck: cannot read push access: $NET_ERR" 1
  case $out in
    true) ;;
    false) finish "not landed: no push access" 0 ;;
    *) finish "stuck: push access unknown (token lacks permissions)" 1 ;;
  esac

  # ---- S9. Ahead-set validation: only close-out commits are carried ------------------------------------
  git merge-base HEAD "$od" >/dev/null 2>&1 || finish "stuck: local branch has no common history with origin/$d" 1
  local c ps f bad=() nbad=0 has_merge= subj
  for c in $ahead; do
    ps=$(git rev-list --parents -n 1 "$c"); set -- $ps; shift
    if [ $# -gt 1 ]; then
      has_merge=1; shift
      for p in "$@"; do git merge-base --is-ancestor "$p" "$od" || { bad+=("$c"); break; }; done
    else
      while IFS= read -r -d '' f; do
        closeout_shaped "$f" || { bad+=("$c"); break; }
      done < <(git diff-tree --no-commit-id --name-only -r -z --root "$c")
    fi
  done
  nbad=${#bad[@]}
  if [ "$nbad" -gt 0 ]; then
    subj=; local i=0
    for c in ${bad[@]+"${bad[@]}"}; do
      [ "$i" -ge 3 ] && break
      subj="$subj${subj:+; }$(git log -1 --format=%s "$c")"; i=$((i + 1))
    done
    [ "$nbad" -gt 3 ] && subj="$subj (+$((nbad - 3)) more)"
    finish "stuck: local commits not from a close-out: $subj" 1
  fi
  local carried=$count
  [ -n "$made" ] && carried=$((count - 1))
  [ "$carried" -gt 0 ] && echo "land: carried $carried earlier close-out commit(s)"

  # ---- S10. Protection --------------------------------------------------------------------------------
  out=$(bounded gh api "repos/$slug/branches/$d" --jq .protected 2>"$tmpd/prot.err"); rc=$?
  net_rc "$rc" protection required "$tmpd/prot.err"; rc=$?
  [ "$rc" = 124 ] && finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || finish "stuck: cannot read branch protection: $NET_ERR" 1
  case $out in
    false) land_unprotected ;;
    true) land_protected ;;
    *) finish "stuck: cannot read branch protection: got '$out'" 1 ;;
  esac
}

# primary_hold: true when this checkout is the primary checkout and a rollout runs on it (ADR 0031), with
# the reason in $HOLD. Asked lazily, once, only where the checkout would move; primary-hold.sh is its one copy.
# A timed-out check holds, as a failed one does: holding only skips moving the checkout.
HOLD= HOLD_ASKED=
primary_hold() {
  local rc
  if [ -z "$HOLD_ASKED" ]; then
    HOLD_ASKED=1
    HOLD=$(bounded bash "$here/primary-hold.sh" "$top" 2>/dev/null); rc=$?
    [ "$rc" = 0 ] || HOLD="the running-rollout check did not answer (rc $rc)"
  fi
  [ -n "$HOLD" ]
}

# ---- S11. Unprotected: push the default branch, rebasing once in a scratch worktree if origin moved -------
land_unprotected() {
  local od="refs/remotes/origin/$d" old N rc
  if git merge-base --is-ancestor "$od" HEAD; then
    bounded git push origin "HEAD:refs/heads/$d" 2>"$tmpd/push.err"; rc=$?
    net_rc "$rc" push required "$tmpd/push.err" git; rc=$?
    [ "$rc" = 124 ] && finish "stuck: $NET_ERR" 1
    [ "$rc" = 0 ] || finish "stuck: push refused: $NET_ERR" 1
    finish landed 0
  fi
  [ -n "$has_merge" ] && finish "stuck: local merge commit on $d; not rebased" 1
  [ $((LAND_DEADLINE - SECONDS)) -ge 1 ] || finish "stuck: deadline passed before rebase" 1
  old=$(git rev-parse HEAD)
  scratch_rebase "$old" "$od"; rc=$?
  if [ "$rc" != 0 ]; then
    [ "$rc" = 1 ] && finish "stuck: rebase conflict" 1
    finish "stuck: rebase failed: $(first_line "$tmpd/wt.err")" 1
  fi
  N=$(cat "$tmpd/rebased")
  if primary_hold; then
    # The rebase ran in a scratch worktree; only move_branch would touch the primary checkout. Push the
    # rebased tip and leave the branch where it is (its commits are on origin by content once pushed).
    echo "land: held the primary checkout at $(git rev-parse --short HEAD), pushed the rebased tip without moving it: $HOLD"
  else
    move_branch "$old" "$N" "land: rebase onto origin/$d"; rc=$?
    [ "$rc" = 1 ] && finish "stuck: rebase refused: $MOVE_ERR" 1
    [ "$rc" = 0 ] || finish "stuck: branch moved during landing" 1
  fi
  [ -n "$made" ] && made=$N
  if [ "$N" = "$(git rev-parse "$od")" ]; then
    echo "land: nothing to land"
    finish landed 0
  fi
  bounded git push origin "$N:refs/heads/$d" 2>"$tmpd/push.err"; rc=$?
  net_rc "$rc" push required "$tmpd/push.err" git; rc=$?
  [ "$rc" = 124 ] && finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || finish "stuck: push refused: $NET_ERR" 1
  finish landed 0
}

# move_branch <old> <new> <reflog msg>: move the checked-out branch $b from <old> to <new>. Two-tree checkout
# semantics refuse only when a changed path is dirty, staged or an untracked file in the way, and then change
# nothing; non-overlapping local changes are kept exactly. The ref moves by compare-and-swap. 0 moved; 1 the
# tree move was refused (MOVE_ERR says why); 2 the branch moved underneath, tree rolled back.
move_branch() {
  MOVE_ERR=
  if ! git read-tree -m -u "$1" "$2" 2>"$tmpd/rt.err"; then
    cat "$tmpd/rt.err"
    MOVE_ERR=$(first_line "$tmpd/rt.err")
    return 1
  fi
  if ! git update-ref -m "$3" "refs/heads/$b" "$2" "$1" 2>"$tmpd/ur.err"; then
    git read-tree -m -u "$2" "$1"
    return 2
  fi
  return 0
}

# scratch_rebase <old> <onto>: rebase <old>'s commits onto <onto> once, in a detached scratch worktree, so
# the main tree, index and branch are untouched. Writes the new tip to $tmpd/rebased. 1 = conflict.
scratch_rebase() (
  wtroot=$(mktemp -d "${TMPDIR:-/tmp}/land-wt.XXXXXX") || exit 3
  wt=$wtroot/wt
  trap 'git worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$wtroot"; git worktree prune >/dev/null 2>&1' EXIT
  GIT_LFS_SKIP_SMUDGE=1 git -c core.hooksPath=/dev/null worktree add -q --detach "$wt" "$1" 2>"$tmpd/wt.err" || exit 3
  if ! git -C "$wt" -c core.hooksPath=/dev/null rebase -q --no-autostash --no-update-refs "$2" >"$tmpd/rb.err" 2>&1; then
    cat "$tmpd/rb.err"
    git -C "$wt" rebase --abort >/dev/null 2>&1
    exit 1
  fi
  git -C "$wt" rev-parse HEAD > "$tmpd/rebased" || exit 3
  exit 0
)

# ---- S12. Protected: push HEAD unchanged to close/…, open or reuse the PR, label it, queue auto-merge ------
LAND_PR_FILTER='import json, sys
sha12, head, phase = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    prs = json.load(sys.stdin)
except Exception:
    sys.exit(2)
if not isinstance(prs, list):
    sys.exit(2)
def mine(p):
    n = p.get("headRefName") or ""
    return (p.get("isCrossRepository") is False and n.startswith("close/")
            and (n.endswith("-" + sha12) or p.get("headRefOid") == head))
hits = [p for p in prs if isinstance(p, dict) and mine(p)]
order = ["OPEN"] if phase == "open" else ["OPEN", "MERGED", "CLOSED"]
for s in order:
    for p in hits:
        if p.get("state") == s:
            print("%s\t%s\t%s" % (s, p.get("number"), p.get("url")))
            sys.exit(0)'

# pr_lookup open|all → PR_HIT "<STATE>\t<n>\t<url>" or empty; 1 on any failure (message in NET_ERR).
pr_lookup() {
  local out rc
  out=$(bounded gh pr list -R "$slug" --state "$1" --limit 200 --json number,url,state,headRefName,headRefOid,isCrossRepository 2>"$tmpd/list.err"); rc=$?
  net_rc "$rc" "PR lookup" required "$tmpd/list.err"; rc=$?
  [ "$rc" = 124 ] && return 124
  [ "$rc" = 0 ] || return 1
  PR_HIT=$(printf '%s' "$out" | python3 -c "$LAND_PR_FILTER" "$sha12" "$head" "$1") || { NET_ERR="bad JSON from the PR list"; return 1; }
  return 0
}

# label_landing <n>: add the `landing` label to PR <n> over REST, creating the label once when it is missing.
# Optional throughout: a failure prints `land: label failed: …` and the landing goes on.
label_landing() {
  local out rc lerr ef=$tmpd/label.err
  out=$(bounded gh api --method POST "repos/$slug/issues/$1/labels" -f 'labels[]=landing' 2>&1 >/dev/null) ; rc=$?
  printf '%s\n' "$out" > "$ef"
  net_rc "$rc" label optional "$ef"; rc=$?
  [ "$rc" = 1 ] || return 0
  lerr=$NET_ERR
  out=$(bounded gh api --method POST "repos/$slug/labels" -f name=landing -f color=0e8a16 \
        -f description='thread close-out landing PR' 2>&1); rc=$?
  printf '%s\n' "$out" > "$tmpd/lc.err"
  case $out in *already_exists*) rc=0 ;; esac
  net_rc "$rc" "label create" optional "$tmpd/lc.err"; rc=$?
  if [ "$rc" = 124 ]; then
    echo "land: skipped label retry: deadline"
  else
    out=$(bounded gh api --method POST "repos/$slug/issues/$1/labels" -f 'labels[]=landing' 2>&1 >/dev/null); rc=$?
    printf '%s\n' "$out" > "$ef"
    net_rc "$rc" "label retry" optional "$ef"; rc=$?
    [ "$rc" = 1 ] && lerr=$NET_ERR
  fi
  [ "$rc" = 0 ] || echo "land: label failed: $lerr"
}

land_protected() {
  local head sha12 cdate s branch n url state rc out body title
  head=$(git rev-parse HEAD); sha12=$(printf '%s' "$head" | cut -c1-12)
  cdate=$(git log -1 --format=%cd --date=short HEAD)
  s=$(printf '%s' "$slug_arg" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9-][^a-z0-9-]*/-/g' -e 's/^-*//' -e 's/-*$//' | cut -c1-40 | sed -e 's/-*$//')
  [ -n "$s" ] || s=$(basename "$top" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9-][^a-z0-9-]*/-/g' -e 's/^-*//' -e 's/-*$//' | cut -c1-40 | sed -e 's/-*$//')
  [ -n "$s" ] || s=close-out
  branch="close/$cdate-$s-$sha12"

  # Lookup, two-phase: open PRs first, then every state. Any failure is stuck, never a blind push.
  PR_HIT=
  pr_lookup open; rc=$?
  if [ "$rc" = 0 ] && [ -z "$PR_HIT" ]; then pr_lookup all; rc=$?; fi
  [ "$rc" = 124 ] && finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || finish "stuck: cannot look up landing PR: $NET_ERR" 1
  IFS=$'\t' read -r state n url <<EOF
$PR_HIT
EOF
  case $state in
    OPEN) ;;
    MERGED) finish "stuck: close-out PR $url merged but $sha12 is not on origin/$d" 1 ;;
    CLOSED) finish "stuck: close-out PR $url was closed unmerged" 1 ;;
    *)
      bounded git push origin "HEAD:refs/heads/$branch" 2>"$tmpd/push.err"; rc=$?
      net_rc "$rc" push required "$tmpd/push.err" git; rc=$?
      [ "$rc" = 124 ] && finish "stuck: $NET_ERR" 1
      [ "$rc" = 0 ] || finish "stuck: push refused: $NET_ERR" 1
      title=$(git log -1 --format=%s HEAD)
      body=$tmpd/body
      printf '%s\n\n%s\n' "Close-out landing for \`$sha12\` (thread:close, ADR 0028)." \
        "Queued with auto-merge as a merge commit, so the close-out SHA stays an ancestor of $d." > "$body"
      out=$(bounded gh api --method POST "repos/$slug/pulls" -f "title=$title" -f "head=$branch" -f "base=$d" \
            -F "body=@$body" --jq '[.number,.html_url]|@tsv' 2>"$tmpd/create.err"); rc=$?
      net_rc "$rc" "PR create" required "$tmpd/create.err"; rc=$?
      if [ "$rc" = 0 ]; then
        IFS=$'\t' read -r n url <<EOF
$out
EOF
      else
        local cerr=$NET_ERR
        PR_HIT=
        pr_lookup open; rc=$?
        IFS=$'\t' read -r state n url <<EOF
$PR_HIT
EOF
        [ "$rc" = 0 ] && [ "$state" = OPEN ] || finish "stuck: pr create failed: $cerr" 1
      fi
      [ -n "$n" ] && [ -n "$url" ] || finish "stuck: pr create failed: no PR number in the reply" 1
      ;;
  esac

  # Label (REST; a missing label is created once), queue, update the branch once. Each is optional.
  label_landing "$n"

  local res="queued: needs merge $url"
  bounded gh pr merge "$n" -R "$slug" --auto --merge 2>"$tmpd/merge.err"; rc=$?
  net_rc "$rc" merge optional "$tmpd/merge.err"; rc=$?
  [ "$rc" = 0 ] && res="queued $url"

  if ! git merge-base --is-ancestor "refs/remotes/origin/$d" HEAD; then
    bounded gh api --method PUT "repos/$slug/pulls/$n/update-branch" >/dev/null 2>"$tmpd/ub.err"; rc=$?
    net_rc "$rc" update-branch optional "$tmpd/ub.err"; rc=$?
    [ "$rc" = 1 ] && echo "land: update-branch failed: $NET_ERR"
  fi
  finish "$res" 0
}

# ==== own-branch mode (ADR 0028 §§ 1–3: close lands the session's own branch) ==============================
# Everything from here to `end own-branch mode` serves `--own-branch` only; the close-out route above never
# calls into it. It shares bounded, net_rc, the route helpers, move_branch and label_landing.

# Own-branch mode's python helpers print their fields joined by US (\x1f), never a tab: bash's `read` folds
# a run of whitespace IFS characters into one, so an empty field (a null check title, a status with no
# description, a deleted author's login) would shift every later field left. US is not whitespace, so
# `IFS=$'\x1f' read` keeps an empty field empty.
# The newest same-repo PR whose head is exactly $B: "<STATE>US<n>US<url>US<author>US<auto 0|1>", or nothing.
LAND_OWN_PR_FILTER='import json, sys
b = sys.argv[1]
try:
    prs = json.load(sys.stdin)
except Exception:
    sys.exit(2)
if not isinstance(prs, list):
    sys.exit(2)
hits = [p for p in prs if isinstance(p, dict) and p.get("isCrossRepository") is False and p.get("headRefName") == b]
if hits:
    p = max(hits, key=lambda p: p.get("number") or 0)
    a = (p.get("author") or {}).get("login") or ""
    print("\x1f".join(str(x) for x in (p.get("state"), p.get("number"), p.get("url"), a, 1 if p.get("autoMergeRequest") else 0)))'

# The CI snapshot: argv is HEAD check-runs, HEAD status, then R check-runs, R status ("" "" when R is HEAD).
# Prints `FAIL US <name> US <title> US <url>` (US-joined; <title> and <url> may be empty) for the first failure by name (R's failure superseded by HEAD's own
# completed success, neutral or skipped for that name; HEAD's failed entry preferred), else an optional
# `INFRA US <name> (<conclusion>)[, …]` and `STATE US <empty|pending|infra|green>`, read from HEAD alone.
LAND_CHECKS_PY='import json, sys
INFRA = ("cancelled", "timed_out", "startup_failure", "action_required", "stale", "error")
PASS = ("success", "neutral", "skipped")
def one(s):
    return " ".join(str(s or "").split())
def load(cr, st):
    out = {}
    if not cr:
        return out
    a = json.load(open(cr))
    b = json.load(open(st))
    runs = a.get("check_runs") if isinstance(a, dict) else None
    sts = b.get("statuses") if isinstance(b, dict) else None
    if not isinstance(runs, list) or not isinstance(sts, list):
        raise ValueError("unexpected checks JSON")
    for r in sorted(runs, key=lambda r: r.get("id") or 0):
        out[one(r.get("name")) or "?"] = {"done": r.get("status") == "completed", "c": r.get("conclusion") or "",
                                          "t": one((r.get("output") or {}).get("title")), "u": r.get("html_url") or ""}
    for s in sts:
        n = one(s.get("context")) or "?"
        st = s.get("state") or ""
        if n not in out:
            out[n] = {"done": st != "pending", "c": "" if st == "pending" else st,
                      "t": one(s.get("description")), "u": s.get("target_url") or ""}
    return out
try:
    h = load(sys.argv[1], sys.argv[2])
    r = load(sys.argv[3], sys.argv[4])
except Exception as e:
    sys.stderr.write("land: checks JSON: %s\n" % e)
    sys.exit(2)
fails = dict((n, e) for n, e in h.items() if e["c"] == "failure")
for n, e in r.items():
    x = h.get(n)
    if n in fails or e["c"] != "failure" or (x and x["done"] and x["c"] in PASS):
        continue
    fails[n] = e
if fails:
    n = sorted(fails)[0]
    print("\x1f".join(("FAIL", n, fails[n]["t"], fails[n]["u"])))
    sys.exit(0)
infra = ["%s (%s)" % (n, e["c"]) for n, e in sorted(h.items()) if e["done"] and e["c"] in INFRA]
if infra:
    print("INFRA\x1f" + ", ".join(infra))
state = "empty" if not h else "pending" if [n for n, e in h.items() if not e["done"]] else "infra" if infra else "green"
print("STATE\x1f" + state)'

# Does the base tip carry any check at all? argv: its check-runs and status files. Prints 1 or 0.
LAND_BASE_PY='import json, sys
try:
    a = json.load(open(sys.argv[1]))
    b = json.load(open(sys.argv[2]))
    print(1 if (a.get("total_count") or 0) > 0 or (b.get("statuses") or []) else 0)
except Exception:
    sys.exit(2)'

# own_finish <line> <rc>: the one way out once preflight passed. Restores <B>'s upstream first.
own_finish() {
  [ -n "$own_restore" ] && restore_upstream
  result "$1"; exit "$2"
}

# up_name: <B>'s upstream as <remote>/<branch>, or none.
up_name() {
  local r m
  r=$(git config "branch.$B.remote"); m=$(git config "branch.$B.merge")
  if [ -n "$r" ] && [ -n "$m" ]; then printf '%s/%s\n' "$r" "${m#refs/heads/}"; else echo none; fi
}

# restore_upstream: undo the plain call's review base. Only an upstream at origin/<d> is touched.
restore_upstream() {
  [ -n "$d" ] && [ "$B" != "$d" ] || return 0
  [ "$(git config "branch.$B.remote")" = origin ] && [ "$(git config "branch.$B.merge")" = "refs/heads/$d" ] || return 0
  git config "branch.$B.merge" "refs/heads/$B" && echo "land: upstream origin/$B (was origin/$d)"
}

# own_pr_list <state>: OWN_HIT from one bounded lookup; 1 on failure (NET_ERR), 124 on the deadline.
own_pr_list() {
  local out rc
  out=$(bounded gh pr list -R "$slug" --state "$1" --head "$B" --limit 30 --json number,url,state,headRefName,headRefOid,isCrossRepository,author,autoMergeRequest 2>"$tmpd/list.err"); rc=$?
  net_rc "$rc" "PR lookup" required "$tmpd/list.err"; rc=$?
  [ "$rc" = 124 ] && return 124
  [ "$rc" = 0 ] || return 1
  OWN_HIT=$(printf '%s' "$out" | python3 -c "$LAND_OWN_PR_FILTER" "$B") || { NET_ERR="bad JSON from the PR list"; return 1; }
  return 0
}

# ck_get <sha> <tag>: <sha>'s check-runs and combined status into $tmpd/<tag>.cr and .st. 1 on failure.
ck_get() {
  local out rc
  out=$(bounded gh api "repos/$slug/commits/$1/check-runs?per_page=100" 2>"$tmpd/ck.err"); rc=$?
  net_rc "$rc" checks required "$tmpd/ck.err" || return 1
  printf '%s\n' "$out" > "$tmpd/$2.cr"
  out=$(bounded gh api "repos/$slug/commits/$1/status" 2>"$tmpd/ck.err"); rc=$?
  net_rc "$rc" checks required "$tmpd/ck.err" || return 1
  printf '%s\n' "$out" > "$tmpd/$2.st"
}

# own_digest: fresh-review's Step 1 diff6, byte for byte, with @{upstream} as the plain call just set it.
own_digest() {
  local up
  local -a fmt
  up="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)"
  fmt=(-c '%n %s %Y'); stat -c %n -- "$top" >/dev/null 2>&1 || fmt=(-f '%N %z %m')
  { git -C "$top" diff HEAD -- . ':!docs/reviews'
    [ -n "$up" ] && git -C "$top" diff "$up...HEAD" -- . ':!docs/reviews'
    git -C "$top" ls-files --others --exclude-standard -z -- . ':!docs/reviews' \
      | (cd "$top" && xargs -0 -r stat ${fmt[@]+"${fmt[@]}"} --) \
      | LC_ALL=C sort
  } | shasum -a 1 | cut -c1-6
}

# tree_line: `land: tree dirty: <up to 5 paths>` for any change or untracked file outside docs/reviews/
# (ignored files never count), else `land: digest <diff6>`.
tree_line() {
  local st paths n
  st=$(git status --porcelain --untracked-files=all -- . ':!docs/reviews' 2>"$tmpd/st.err") \
    || { echo "land: tree dirty: (git status failed: $(first_line "$tmpd/st.err"))"; return 0; }
  if [ -n "$st" ]; then
    n=$(printf '%s\n' "$st" | grep -c .)
    paths=$(printf '%s\n' "$st" | head -n 5 | cut -c4- | awk 'NR > 1 { printf ", " } { printf "%s", $0 }')
    [ "$n" -gt 5 ] && paths="$paths (+$((n - 5)) more)"
    echo "land: tree dirty: $paths"
  else
    echo "land: digest $(own_digest)"
  fi
}

# scratch_merge <old> <theirs>: merge <theirs> into <old> once with a merge commit, in a detached scratch
# worktree with hooks off, so the main tree, index and branch are untouched. Writes the tip to
# $tmpd/merged. 1 = conflict.
scratch_merge() (
  wtroot=$(mktemp -d "${TMPDIR:-/tmp}/land-wt.XXXXXX") || exit 3
  wt=$wtroot/wt
  trap 'git worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$wtroot"; git worktree prune >/dev/null 2>&1' EXIT
  GIT_LFS_SKIP_SMUDGE=1 git -c core.hooksPath=/dev/null worktree add -q --detach "$wt" "$1" 2>"$tmpd/wt.err" || exit 3
  if ! git -C "$wt" -c core.hooksPath=/dev/null merge -q --no-ff --no-edit "$2" >"$tmpd/mg.err" 2>&1; then
    cat "$tmpd/mg.err"
    git -C "$wt" merge --abort >/dev/null 2>&1
    exit 1
  fi
  git -C "$wt" rev-parse HEAD > "$tmpd/merged" || exit 3
  exit 0
)

# subjects <rev>…: the first three commit subjects, `; `-joined, with (+N more).
subjects() {
  local c s= i=0
  for c in "$@"; do
    [ "$i" -ge 3 ] && break
    s="$s${s:+; }$(git log -1 --format=%s "$c")"; i=$((i + 1))
  done
  [ "$#" -gt 3 ] && s="$s (+$(($# - 3)) more)"
  printf '%s\n' "$s"
}

own_main() {
  local B= act= rev= note= repo top b bref d= slug tmpd out rc m od ob own_restore= own_ref= reg reg_rc
  local state n= url= login auto me R H st infra res prot wf
  while [ $# -gt 0 ]; do
    case $1 in
      --branch) [ $# -ge 2 ] && [ -n "$2" ] || usage; B=$2; shift 2 ;;
      --queue|--hold) [ -z "$act" ] || usage; act=$1; shift ;;
      --reviewed) [ $# -ge 2 ] && [ -n "$2" ] || usage; rev=$2; shift 2 ;;
      -F) [ $# -ge 2 ] && [ -n "$2" ] || usage; note=$2; shift 2 ;;
      --) shift; break ;;
      -*) usage ;;
      *) break ;;
    esac
  done
  [ $# -eq 1 ] && [ -n "$1" ] && [ -n "$B" ] || usage
  case $B in -*) usage ;; esac
  repo=$1
  case $act in
    --queue) [ -n "$rev" ] && [ -z "$note" ] || usage ;;
    --hold) [ -n "$note" ] && [ -z "$rev" ] || usage ;;
    *) [ -z "$rev" ] && [ -z "$note" ] || usage ;;
  esac
  if [ -n "$note" ]; then
    [ -f "$note" ] && [ -r "$note" ] || { echo "land: diagnosis file not readable: $note"; exit 2; }
  fi

  tmpd=$(mktemp -d "${TMPDIR:-/tmp}/land.XXXXXX") || { result "stuck: cannot create temp dir"; exit 1; }
  trap 'rm -rf "$tmpd"; [ -z "$own_ref" ] || git update-ref -d "$own_ref" >/dev/null 2>&1' EXIT

  # ---- O1. Preflight, local only; no upstream is touched on these ---------------------------------------
  phys "$repo"; [ $? = 1 ] && { result "stuck: cannot resolve $repo"; exit 1; }
  top=$(git -C "$PHYS_ANC" rev-parse --show-toplevel 2>"$tmpd/top.err") && [ -n "$top" ] \
    || { result "stuck: not a git work tree: $(first_line "$tmpd/top.err")"; exit 1; }
  top=$(cd "$top" && pwd -P) && cd "$top" || { result "stuck: cannot enter $top"; exit 1; }
  bref=$(git symbolic-ref -q HEAD) || { result "stuck: detached HEAD"; exit 1; }
  b=${bref#refs/heads/}
  for m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
    [ -e "$(git rev-parse --path-format=absolute --git-path "$m")" ] && { result "stuck: half-applied operation ($m)"; exit 1; }
  done
  [ "$b" = "$B" ] || { result "stuck: checkout moved: on $b, not $B"; exit 1; }
  git rev-parse -q --verify HEAD >/dev/null || { result "stuck: $B has no commits"; exit 1; }
  if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -z "${GIT_SSH:-}" ] && [ -z "$(git config core.sshCommand 2>/dev/null)" ]; then
    export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
  fi
  own_restore=1
  d=$(git symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) && d=${d#refs/remotes/origin/}

  # ---- O2. Route, local only ------------------------------------------------------------------------------
  swept "$top" && own_finish "not landed: swept by the daily sweep" 0
  reg=$(python3 "$here/landing-register.py" check "$top" 2>"$tmpd/reg.err"); reg_rc=$?
  [ -s "$tmpd/reg.err" ] && cat "$tmpd/reg.err"
  case $reg_rc in
    0) ;;
    3) own_finish "not landed: $reg" 0 ;;
    4) own_finish "not landed: no GitHub origin" 0 ;;
    *) own_finish "stuck: landing register: $(first_line "$tmpd/reg.err")" 1 ;;
  esac
  slug=$(origin_slug "$(git remote get-url origin 2>/dev/null)") || own_finish "stuck: origin is not a GitHub slug" 1

  # ---- O3. The default branch; the own branch is never it -----------------------------------------------
  if [ -z "$d" ]; then
    out=$(bounded git ls-remote --symref origin HEAD 2>"$tmpd/lsr.err"); rc=$?
    net_rc "$rc" ls-remote required "$tmpd/lsr.err" git; rc=$?
    [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
    [ "$rc" = 0 ] || own_finish "stuck: default branch unresolved: $NET_ERR" 1
    d=$(printf '%s\n' "$out" | awk '/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }')
    [ -n "$d" ] || own_finish "stuck: default branch unresolved: origin sent no HEAD symref" 1
  fi
  [ "$B" = "$d" ] && own_finish "not landed: on $d, the default branch" 0
  od="refs/remotes/origin/$d"; ob="refs/remotes/origin/$B"

  # ---- O4. Refresh origin/<d> and origin/<B> --------------------------------------------------------------
  bounded git fetch --no-tags --no-write-fetch-head origin "+refs/heads/$d:$od" 2>"$tmpd/fetch.err"; rc=$?
  net_rc "$rc" fetch required "$tmpd/fetch.err" git; rc=$?
  [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || own_finish "stuck: cannot fetch origin/$d: $NET_ERR" 1
  out=$(bounded git ls-remote origin "refs/heads/$B" 2>"$tmpd/lsb.err"); rc=$?
  net_rc "$rc" ls-remote required "$tmpd/lsb.err" git; rc=$?
  [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || own_finish "stuck: cannot read origin/$B: $NET_ERR" 1
  if [ -n "$out" ]; then
    bounded git fetch --no-tags --no-write-fetch-head origin "+refs/heads/$B:$ob" 2>"$tmpd/fetch.err"; rc=$?
    net_rc "$rc" fetch required "$tmpd/fetch.err" git; rc=$?
    [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
    [ "$rc" = 0 ] || own_finish "stuck: cannot fetch origin/$B: $NET_ERR" 1
  elif git rev-parse -q --verify "$ob" >/dev/null; then
    git update-ref -d "$ob"
  fi
  echo "land: base $(git rev-parse "$od")"
  echo "land: head $(git rev-parse HEAD)"

  # ---- O5. A bare `git push` must never send <B> to <d> while the review base is origin/<d> ---------------
  m=$(git config push.default)
  case $m in upstream|tracking) own_finish "stuck: push.default=$m would push $B to $d" 1 ;; esac

  # ---- O6. Anything to land? ----------------------------------------------------------------------------
  git merge-base HEAD "$od" >/dev/null 2>&1 || own_finish "stuck: $B has no common history with origin/$d" 1
  if [ -z "$(git rev-list -n 1 "$od..HEAD")" ]; then
    echo "land: nothing to land"
    own_finish landed 0
  fi

  # ---- O7. Push access (S8) -------------------------------------------------------------------------------
  out=$(bounded gh api "repos/$slug" --jq '.permissions.push | tostring' 2>"$tmpd/acc.err"); rc=$?
  net_rc "$rc" "push access" required "$tmpd/acc.err"; rc=$?
  [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || own_finish "stuck: cannot read push access: $NET_ERR" 1
  case $out in
    true) ;;
    false) own_finish "not landed: no push access" 0 ;;
    *) own_finish "stuck: push access unknown (token lacks permissions)" 1 ;;
  esac

  # ---- O8. The PR for <B>: the newest same-repo PR with exactly that head decides --------------------------
  OWN_HIT=
  own_pr_list all; rc=$?
  [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || own_finish "stuck: cannot look up the PR for $B: $NET_ERR" 1
  IFS=$'\x1f' read -r state n url login auto <<EOF
$OWN_HIT
EOF
  case $state in
    OPEN)
      out=$(bounded gh api user --jq .login 2>"$tmpd/me.err"); rc=$?
      net_rc "$rc" "user lookup" required "$tmpd/me.err"; rc=$?
      [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
      [ "$rc" = 0 ] || own_finish "stuck: cannot read the GitHub login: $NET_ERR" 1
      me=$out
      [ -n "$login" ] && [ "$login" = "$me" ] || own_finish "not landed: PR $url belongs to ${login:-an unknown author}" 0
      if [ "$auto" = 1 ] && [ "$act" != --queue ]; then
        bounded gh pr merge "$n" -R "$slug" --disable-auto 2>"$tmpd/dis.err"; rc=$?
        net_rc "$rc" "auto-merge off" required "$tmpd/dis.err"; rc=$?
        [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
        [ "$rc" = 0 ] || own_finish "stuck: cannot switch auto-merge off on $url: $NET_ERR" 1
        echo "land: auto-merge off"
      fi
      ;;
    MERGED)
      own_ref=refs/land/pr-head
      bounded git fetch --no-tags --no-write-fetch-head origin "+refs/pull/$n/head:$own_ref" 2>"$tmpd/fetch.err"; rc=$?
      net_rc "$rc" fetch required "$tmpd/fetch.err" git; rc=$?
      [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
      [ "$rc" = 0 ] || own_finish "stuck: cannot fetch the head of $url: $NET_ERR" 1
      if git merge-base --is-ancestor HEAD "$own_ref"; then
        echo "land: merged in $url"
        own_finish landed 0
      fi
      n=; url=
      ;;
    CLOSED) own_finish "stuck: PR $url for $B was closed unmerged" 1 ;;
    *) n=; url= ;;
  esac

  # ---- O9. Reconcile with origin/<B>: fast-forward, or merge update-branch's commits; never force ----------
  if git rev-parse -q --verify "$ob" >/dev/null && ! git merge-base --is-ancestor "$ob" HEAD; then
    if git merge-base --is-ancestor HEAD "$ob"; then
      git merge --ff-only --no-autostash -q "$ob" >"$tmpd/ff.err" 2>&1 \
        || { cat "$tmpd/ff.err"; own_finish "stuck: ff refused: $(first_line "$tmpd/ff.err")" 1; }
    else
      out=$(git rev-list --no-merges "HEAD..$ob" "^$od")
      if [ -n "$out" ]; then
        own_finish "stuck: origin/$B has commits this checkout lacks: $(subjects $out)" 1
      fi
      H=$(git rev-parse HEAD)
      [ $((LAND_DEADLINE - SECONDS)) -ge 1 ] || own_finish "stuck: deadline passed before the merge" 1
      scratch_merge "$H" "$ob"; rc=$?
      [ "$rc" = 1 ] && own_finish "stuck: merge conflict with origin/$B" 1
      [ "$rc" = 0 ] || own_finish "stuck: merge failed: $(first_line "$tmpd/wt.err")" 1
      move_branch "$H" "$(cat "$tmpd/merged")" "land: merge origin/$B"; rc=$?
      [ "$rc" = 1 ] && own_finish "stuck: merge refused: $MOVE_ERR" 1
      [ "$rc" = 0 ] || own_finish "stuck: branch moved during landing" 1
    fi
    echo "land: head $(git rev-parse HEAD) (reconciled with origin/$B)"
  fi

  # ---- O10. --queue: every commit after the reviewed one touches only docs/reviews/ ------------------------
  if [ "$act" = --queue ]; then
    R=$(git rev-parse -q --verify "$rev^{commit}") || own_finish "stuck: reviewed commit $rev not found" 1
    git merge-base --is-ancestor "$R" HEAD || own_finish "stuck: reviewed commit $(printf '%s' "$R" | cut -c1-7) is not on $B" 1
    local c f bad=
    for c in $(git rev-list --no-merges "$R..HEAD" "^$od"); do
      while IFS= read -r -d '' f; do
        case $f in docs/reviews/*) ;; *) bad="$bad $c"; break ;; esac
      done < <(git diff-tree --no-commit-id --name-only -r -z --root "$c")
    done
    [ -z "$bad" ] || own_finish "stuck: unreviewed commits after $(printf '%s' "$R" | cut -c1-7): $(subjects $bad)" 1
  fi

  # ---- O11. Push <B> to itself: never forced, never setting an upstream -----------------------------------
  bounded git push origin "refs/heads/$B:refs/heads/$B" 2>"$tmpd/push.err"; rc=$?
  net_rc "$rc" push required "$tmpd/push.err" git; rc=$?
  [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || own_finish "stuck: push refused: $NET_ERR" 1

  # ---- O12. Open the PR when there is none, and label it --------------------------------------------------
  if [ -z "$n" ]; then
    local title body=$tmpd/body cerr
    title=$(git log --reverse --no-merges --format=%s "$od..HEAD" | head -n 1)
    printf '%s\n' "Own-branch landing for \`$B\` (thread:close, ADR 0028 § 2): reviewed by /fresh-review before its merge is queued." > "$body"
    out=$(bounded gh api --method POST "repos/$slug/pulls" -f "title=$title" -f "head=$B" -f "base=$d" \
          -F "body=@$body" --jq '[.number,.html_url]|@tsv' 2>"$tmpd/create.err"); rc=$?
    net_rc "$rc" "PR create" required "$tmpd/create.err"; rc=$?
    if [ "$rc" = 0 ]; then
      IFS=$'\t' read -r n url <<EOF
$out
EOF
    else
      cerr=$NET_ERR; OWN_HIT=
      own_pr_list open; rc=$?
      IFS=$'\x1f' read -r state n url login auto <<EOF
$OWN_HIT
EOF
      [ "$rc" = 0 ] && [ "$state" = OPEN ] || own_finish "stuck: pr create failed: $cerr" 1
    fi
    [ -n "$n" ] && [ -n "$url" ] || own_finish "stuck: pr create failed: no PR number in the reply" 1
  fi
  label_landing "$n"

  # ---- O13. The action --------------------------------------------------------------------------------------
  case $act in
    --hold)
      { printf '%s\n\n' 'Landing held (thread:close, ADR 0028 § 3)'; cat "$note"; } > "$tmpd/hold"
      out=$(bounded gh api --method POST "repos/$slug/issues/$n/comments" -F "body=@$tmpd/hold" 2>&1 >/dev/null); rc=$?
      printf '%s\n' "$out" > "$tmpd/cm.err"
      net_rc "$rc" comment optional "$tmpd/cm.err"; rc=$?
      [ "$rc" = 0 ] || echo "land: comment failed: $NET_ERR"
      own_finish "held $url" 0
      ;;
    --queue) ;;
    *)
      m=$(up_name)
      git config "branch.$B.remote" origin && git config "branch.$B.merge" "refs/heads/$d" \
        || own_finish "stuck: review base unresolved (git config failed)" 1
      [ "$(git rev-parse --symbolic-full-name "$B@{upstream}" 2>/dev/null)" = "$od" ] \
        || own_finish "stuck: review base unresolved" 1
      echo "land: upstream origin/$d (was $m)"
      own_restore=
      tree_line
      own_finish "pr open $url" 0
      ;;
  esac

  # --queue: protection (S10), then one snapshot of R and HEAD. No polling, no waiting.
  out=$(bounded gh api "repos/$slug/branches/$d" --jq .protected 2>"$tmpd/prot.err"); rc=$?
  net_rc "$rc" protection required "$tmpd/prot.err"; rc=$?
  [ "$rc" = 124 ] && own_finish "stuck: $NET_ERR" 1
  [ "$rc" = 0 ] || own_finish "stuck: cannot read branch protection: $NET_ERR" 1
  case $out in true|false) prot=$out ;; *) own_finish "stuck: cannot read branch protection: got '$out'" 1 ;; esac

  H=$(git rev-parse HEAD)
  ck_get "$H" h || own_finish "stuck: cannot read checks: $NET_ERR" 1
  local rf= rs=
  if [ "$R" != "$H" ]; then
    ck_get "$R" r || own_finish "stuck: cannot read checks: $NET_ERR" 1
    rf=$tmpd/r.cr; rs=$tmpd/r.st
  fi
  echo "land: checks read R $(printf '%s' "$R" | cut -c1-7) H $(printf '%s' "$H" | cut -c1-7)"
  out=$(python3 -c "$LAND_CHECKS_PY" "$tmpd/h.cr" "$tmpd/h.st" "$rf" "$rs") || own_finish "stuck: cannot read checks: bad JSON" 1
  st=; infra=
  local k v1 v2 v3
  while IFS=$'\x1f' read -r k v1 v2 v3; do
    case $k in
      FAIL) own_finish "ci failed: $v1 (failure${v2:+: $v2})${v3:+ $v3}" 0 ;;
      INFRA) infra=$v1 ;;
      STATE) st=$v1 ;;
    esac
  done <<EOF
$out
EOF
  [ -n "$infra" ] && echo "land: checks infra: $infra"
  if [ "$st" = empty ]; then
    wf=$(git ls-tree -r --name-only HEAD -- .github/workflows | grep -cE '\.ya?ml$')
    if [ "${wf:-0}" -gt 0 ]; then
      echo "land: checks none yet (ci: workflows)"; st=pending
    else
      ck_get "$(git rev-parse "$od")" base || own_finish "stuck: cannot read checks: $NET_ERR" 1
      out=$(python3 -c "$LAND_BASE_PY" "$tmpd/base.cr" "$tmpd/base.st") || own_finish "stuck: cannot read checks: bad JSON" 1
      if [ "$out" = 1 ]; then echo "land: checks none yet (ci: base)"; st=pending
      else echo "land: checks none (no ci)"; st=none
      fi
    fi
  fi

  res="queued: needs merge $url"
  if [ "$prot" = true ]; then
    bounded gh pr merge "$n" -R "$slug" --auto --merge 2>"$tmpd/merge.err"; rc=$?
    net_rc "$rc" merge optional "$tmpd/merge.err"; rc=$?
    if [ "$rc" = 0 ]; then
      res="queued $url"
    elif [ "$st" = green ] || [ "$st" = none ]; then
      own_direct_merge
    fi
    if ! git merge-base --is-ancestor "$od" HEAD; then
      bounded gh api --method PUT "repos/$slug/pulls/$n/update-branch" >/dev/null 2>"$tmpd/ub.err"; rc=$?
      net_rc "$rc" update-branch optional "$tmpd/ub.err"; rc=$?
      [ "$rc" = 1 ] && echo "land: update-branch failed: $NET_ERR"
    fi
    own_finish "$res" 0
  fi
  case $st in
    pending|infra) echo "land: checks $st"; own_finish "$res" 0 ;;
  esac
  own_direct_merge
  own_finish "$res" 0
}

# own_direct_merge: merge the PR now, as a merge commit. Success ends the run `landed`; a failure leaves
# $res at `queued: needs merge` with the reason on stderr.
own_direct_merge() {
  local rc
  bounded gh pr merge "$n" -R "$slug" --merge 2>"$tmpd/direct.err"; rc=$?
  net_rc "$rc" "direct merge" optional "$tmpd/direct.err"; rc=$?
  [ "$rc" = 0 ] && own_finish landed 0
  echo "land: merge failed: $NET_ERR"
}
# ==== end own-branch mode ====================================================================================

# ---- parent: run the body with fd 1 on stderr, then print its one result line ----------------------------
land_out=; land_rc=1
if LAND_RES=$(mktemp "${TMPDIR:-/tmp}/land-res.XXXXXX"); then
  trap 'rm -f "$LAND_RES"' EXIT
  ( exec 1>&2; main "$@" )
  land_rc=$?
  IFS= read -r land_out < "$LAND_RES"
  if [ -z "$land_out" ] && [ "$land_rc" != 2 ] && [ "${1:-}" != --origin-slug ]; then
    land_out="stuck: land.sh failed (no result, rc $land_rc)"; land_rc=1
  fi
else
  land_out="stuck: cannot create temp file"
fi
[ -n "$land_out" ] && printf '%s\n' "$land_out"
exit "$land_rc"
