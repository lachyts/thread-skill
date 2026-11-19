#!/usr/bin/env bash
# skills/_shared/scripts/live-checkout.sh, executed (ADR 0066's 2026-11-05 amendment, p37-7): the one primitive land.sh,
# self-rollout-check.sh and primary-refresh.py share for "fast-forward a live checkout". Every arm runs under bash on
# PATH and under /bin/bash (3.2 on macOS). LC1 lc_op's seven markers; LC2 the ssh rule; LC3 the default branch, local
# first; LC4 the one-branch fetch; LC5 the overlap; LC6 lc_ff; LC7 every lc_check form against primary-refresh.py's own
# regexes; LC8 sourcing changes nothing of the caller's; LC9 the run modes' exit codes, the overlap mode's included
# (leg.py's ff_primary, p39-4); LC10 lc_bounded: the child's rc, the budget's 142, a normal exit kills the whole group,
# and so does a TERM or HUP to it or an INT to its caller's group (143, 129, 130), which also stops a caller the signal
# reached; LC11 the content mode, each form against primary-refresh.py's regexes,
# and lc_ahead_content's records. Origins are
# git@github.com:<o>/<r>.git, served from $SRV/<o>/<r>.git by tests/fixtures/land/fake-ssh.sh on PATH as `ssh`, with
# GIT_SSH_COMMAND unset, so the ssh rule is what reaches it. Hermetic: HOME and every path live under mktemp; commits
# carry an inline identity; global/system git config is ignored; never the network.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
. tests/lib/proc-group.sh
unset $(git rev-parse --local-env-vars)
unset GIT_SSH_COMMAND GIT_SSH CDPATH
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
LC="$root/skills/_shared/scripts/live-checkout.sh"
PR="$root/skills/_shared/scripts/primary-refresh.py"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tmp=$(cd "$tmp" && pwd -P)
export HOME="$tmp/home"; mkdir -p "$HOME" "$tmp/sshbin" "$tmp/srv"
cp tests/fixtures/land/fake-ssh.sh "$tmp/sshbin/ssh"; chmod +x "$tmp/sshbin/ssh"
export PATH="$tmp/sshbin:$PATH" SRV="$tmp/srv" LOG_SSH="$tmp/ssh.log"; : > "$LOG_SSH"
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

# srv <name> [branch]: a bare server o/<name> with one commit (a.txt) on <branch> (master), and its seed clone
srv() {
  local b=${2:-master}
  g init -q --bare -b "$b" "$SRV/o/$1.git"; g clone -q "$SRV/o/$1.git" "$tmp/seed-$1" 2>/dev/null
  g -C "$tmp/seed-$1" checkout -q -b "$b" 2>/dev/null
  echo base > "$tmp/seed-$1/a.txt"; g -C "$tmp/seed-$1" add -A; g -C "$tmp/seed-$1" commit -qm base
  g -C "$tmp/seed-$1" push -q origin "$b" 2>/dev/null
}
# push <name> <file> <text>: a commit on the server through its seed
push() {
  mkdir -p "$(dirname "$tmp/seed-$1/$2")"; printf '%s\n' "$3" > "$tmp/seed-$1/$2"
  g -C "$tmp/seed-$1" add -A; g -C "$tmp/seed-$1" commit -qm "srv: $2"
  g -C "$tmp/seed-$1" push -q origin "$(git -C "$tmp/seed-$1" symbolic-ref --short HEAD)" 2>/dev/null
}
tipof() { git --git-dir "$SRV/o/$1.git" rev-parse "refs/heads/${2:-master}"; }
cl() { g clone -q "git@github.com:o/$1.git" "$2" 2>/dev/null; }   # a clone over the fake ssh, origin/HEAD set
fetchall() { git -C "$1" fetch -q origin 2>/dev/null; }

for SH in "$(command -v bash)" /bin/bash; do
  [ -x "$SH" ] || { echo "SKIP - $SH is not here"; continue; }
  n=$("$SH" -c 'echo "bash ${BASH_VERSION%%(*}"')
  rm -rf "$tmp/w" "$SRV/o" "$tmp"/seed-*; mkdir -p "$tmp/w" "$SRV/o"
  src() { "$SH" -c '. "$1"; shift; "$@"' _ "$LC" "$@"; }   # src <fn> <args…>: one call of a sourced function
  mode() { "$SH" "$LC" "$@"; }                               # mode <mode> <args…>: a run mode

  # ---- LC1: lc_op finds each of the seven markers, a linked worktree's own included -------------------------------
  srv r1; c="$tmp/w/r1"; cl r1 "$c"
  ok "$(src lc_op "$c"; echo "rc $?")" "rc 1" "LC1 $n: a quiet checkout: no marker, rc 1"
  for m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do
    case $m in rebase-*|sequencer) mkdir "$c/.git/$m" ;; *) : > "$c/.git/$m" ;; esac
    ok "$(src lc_op "$c"; echo "rc $?")" "$m
rc 0" "LC1 $n: $m is named, rc 0"
    rm -rf "${c:?}/.git/$m"
  done
  g -C "$c" worktree add -q -b side "$tmp/w/r1-wt" 2>/dev/null
  : > "$(git -C "$tmp/w/r1-wt" rev-parse --path-format=absolute --git-dir)/MERGE_HEAD"
  ok "$(src lc_op "$tmp/w/r1-wt")" MERGE_HEAD "LC1 $n: a linked worktree's own MERGE_HEAD is named"
  ok "$(src lc_op "$c"; echo "rc $?")" "rc 1" "LC1 $n: … and never read as its main checkout's"

  # ---- LC2: the ssh rule -----------------------------------------------------------------------------------------
  rule() { (cd "$1" && "$SH" -c '. "$1"; lc_ssh_rule "$2"; printf "%s|%s" "${GIT_SSH_COMMAND:-}" "${GIT_TERMINAL_PROMPT:-}"' _ "$LC" "$2"); }
  ok "$(rule "$tmp" "$c")" "ssh -o BatchMode=yes|0" "LC2 $n: nothing set: BatchMode exported, and no prompt"
  git -C "$c" config core.sshCommand myssh
  ok "$(rule "$tmp" "$c")" "|0" "LC2 $n: the repo's core.sshCommand is left alone"
  g init -q "$tmp/w/plain"
  ok "$(rule "$c" "$tmp/w/plain")" "ssh -o BatchMode=yes|0" "LC2 $n: the target repo's config is read, not the current directory's"
  ok "$(rule "$tmp/w/plain" "$c")" "|0" "LC2 $n: … either way round"
  git -C "$c" config --unset core.sshCommand
  ok "$(GIT_SSH_COMMAND=mine rule "$tmp" "$c")" "mine|0" "LC2 $n: a caller's GIT_SSH_COMMAND is left alone"
  ok "$(GIT_SSH=/x/ssh rule "$tmp" "$c")" "|0" "LC2 $n: … and so is a caller's GIT_SSH"

  # ---- LC3: the default branch, local first ----------------------------------------------------------------------
  git -C "$c" remote set-head origin -d; : > "$LOG_SSH"
  ok "$(mode default "$c"; echo "rc $?")" "master
rc 0" "LC3 $n: origin/HEAD deleted: master is read locally"
  ok "$(cat "$LOG_SSH")" "" "LC3 $n: … and origin is never asked"
  ok "$(src lc_default_local "$c")" master "LC3 $n: lc_default_local reads origin/master"
  srv tr trunk; cl tr "$tmp/w/tr"; git -C "$tmp/w/tr" remote set-head origin -d; : > "$LOG_SSH"
  ok "$(src lc_default_local "$tmp/w/tr"; echo "rc $?")" "rc 1" "LC3 $n: only origin/trunk: no local answer, rc 1"
  ok "$(mode default "$tmp/w/tr"; echo "rc $?")" "trunk
rc 0" "LC3 $n: … so origin is asked, and answers trunk"
  has "$(cat "$LOG_SSH")" "-o BatchMode=yes" "LC3 $n: … over ssh with -o BatchMode=yes"
  g init -q "$tmp/w/none"; git -C "$tmp/w/none" remote add origin git@github.com:o/nowhere.git
  ok "$(mode default "$tmp/w/none" 2>/dev/null; echo "rc $?")" "rc 1" "LC3 $n: an unreachable server and no local refs: exit 1, nothing printed"
  git -C "$c" remote set-head origin master
  ok "$(src lc_default "$tmp/w/none" "$c")" master "LC3 $n: lc_default takes the first repo with a local origin/HEAD"

  # ---- LC4: one branch, no tags, no FETCH_HEAD -------------------------------------------------------------------
  git -C "$c" update-ref refs/remotes/origin/feat HEAD
  g -C "$tmp/seed-r1" push -q origin HEAD:refs/heads/feat/x 2>/dev/null
  g -C "$tmp/seed-r1" tag v1; g -C "$tmp/seed-r1" push -q origin v1 2>/dev/null
  push r1 b.txt two
  ok "$(git -C "$c" fetch -q origin >/dev/null 2>&1; echo "rc $?")" "rc 1" "LC4 $n: (fixture) a plain fetch fails on the stale origin/feat against origin's feat/x"
  git -C "$c" tag -d v1 >/dev/null 2>&1; rm -f "$c/.git/FETCH_HEAD"
  ok "$(src lc_fetch "$c" master; echo "rc $?")" "rc 0" "LC4 $n: the one-branch fetch does not fail on it"
  ok "$(git -C "$c" rev-parse refs/remotes/origin/master)" "$(tipof r1)" "LC4 $n: … and moves origin/master to the server's tip"
  ok "$(git -C "$c" tag -l)" "" "LC4 $n: … no tag is fetched"
  ok "$([ -e "$c/.git/FETCH_HEAD" ] && echo written)" "" "LC4 $n: … no FETCH_HEAD is written"
  ok "$(src lc_fetch "$c" master echo)" "git -C $c fetch --quiet --no-tags --no-write-fetch-head origin +refs/heads/master:refs/remotes/origin/master" \
    "LC4 $n: a runner prefixes the very argv (land.sh's bounded)"
  git -C "$c" update-ref -d refs/remotes/origin/feat

  # ---- LC5: the overlap --------------------------------------------------------------------------------------------
  srv o5; c5="$tmp/w/o5"; cl o5 "$c5"
  push o5 a.txt origin; fetchall "$c5"; echo mine > "$c5/a.txt"
  ok "$(src lc_overlap "$c5" master)" "a.txt" "LC5 $n: a dirty tracked file origin changes"
  git -C "$c5" branch -q -f lb5 refs/remotes/origin/master
  ok "$(src lc_overlap_ref "$c5" refs/heads/lb5)" "a.txt" "LC5 $n: lc_overlap_ref against a local branch at origin's tip: the same paths"
  ok "$(src lc_overlap_ref "$c5" refs/heads/nowhere)" "" "LC5 $n: … a ref that does not resolve: nothing (the merge is still the guard)"
  git -C "$c5" add a.txt
  ok "$(src lc_overlap "$c5" master)" "a.txt" "LC5 $n: … staged too"
  git -C "$c5" reset -q --hard origin/master
  push o5 new.txt added; fetchall "$c5"; echo mine > "$c5/new.txt"
  ok "$(src lc_overlap "$c5" master)" "new.txt" "LC5 $n: an untracked file origin adds"
  rm -f "$c5/new.txt"; git -C "$c5" reset -q --hard origin/master
  push o5 "my file.txt" sp; push o5 "café.txt" acc; fetchall "$c5"
  echo mine > "$c5/my file.txt"; echo mine > "$c5/café.txt"
  ok "$(src lc_overlap "$c5" master)" "café.txt, my file.txt" "LC5 $n: a space and a non-ASCII name, printed unquoted"
  rm -f "$c5/my file.txt" "$c5/café.txt"; git -C "$c5" reset -q --hard origin/master
  push o5 d/x.txt dir; fetchall "$c5"; echo mine > "$c5/d"
  ok "$(src lc_overlap "$c5" master)" "d/x.txt" "LC5 $n: an untracked file where origin makes a directory"
  rm -f "$c5/d"; git -C "$c5" reset -q --hard origin/master
  push o5 a.txt again; fetchall "$c5"; echo note > "$c5/untouched.txt"; echo mine >> "$c5/sub.txt"
  ok "$(src lc_overlap "$c5" master)" "" "LC5 $n: a dirty file origin never touches: nothing"
  rm -f "$c5/untouched.txt" "$c5/sub.txt"

  # A copy already holding origin's bytes is no overlap for a fast-forward (ADR 0078 d3); lc_overlap_ref stays strict.
  srv s5; s5="$tmp/w/s5"; cl s5 "$s5"
  push s5 new.txt same; fetchall "$s5"; printf 'same\n' > "$s5/new.txt"
  ok "$(src lc_overlap "$s5" master)" "" "LC5 $n: an untracked file with origin's bytes: no overlap"
  ok "$(src lc_overlap_ref "$s5" refs/remotes/origin/master)" "new.txt" "LC5 $n: … lc_overlap_ref, leg.py's overlap mode, still names it"
  ok "$(mode overlap "$s5" refs/remotes/origin/master)" "overlap new.txt" "LC5 $n: … and the overlap run mode too"
  rm -f "$s5/new.txt"; printf 'other\n' > "$s5/new.txt"
  ok "$(src lc_overlap "$s5" master)" "new.txt" "LC5 $n: … other bytes still overlap"
  rm -f "$s5/new.txt"; g -C "$s5" merge -q --ff-only origin/master
  push s5 new.txt edited; fetchall "$s5"; printf 'edited\n' > "$s5/new.txt"
  ok "$(src lc_overlap "$s5" master)" "" "LC5 $n: a dirty tracked file with origin's bytes: no overlap"
  g -C "$s5" add new.txt
  ok "$(src lc_overlap "$s5" master)" "" "LC5 $n: … staged too"
  g -C "$s5" reset -q --hard HEAD; g -C "$tmp/seed-s5" rm -q new.txt; g -C "$tmp/seed-s5" commit -qm gone; g -C "$tmp/seed-s5" push -q origin master 2>/dev/null; fetchall "$s5"
  rm -f "$s5/new.txt"
  ok "$(src lc_overlap "$s5" master)" "" "LC5 $n: gone from both: no overlap"
  echo mine > "$s5/new.txt"
  ok "$(src lc_overlap "$s5" master)" "new.txt" "LC5 $n: … but a copy here that origin deletes is still one"

  # A handoff doc origin holds is no overlap, whatever differs (ADR 0078 d3): one row per reading.
  srv m5; m5="$tmp/w/m5"; cl m5 "$m5"; fm='---\nthread: t\nstatus: %s\n---\nbody\n'
  origin=$(printf -- "$fm" 'pending  # pending -> consumed, set by the session that picks it up')
  push m5 docs/handoffs/h.md "$origin"; push m5 notes/h.md "$origin"; fetchall "$m5"; mkdir -p "$m5/docs/handoffs" "$m5/notes"
  while IFS='|' read -r file status tail want why; do
    { printf -- "$fm" "$status"; printf '%s' "$tail"; } > "$m5/$file"
    ok "$(src lc_overlap "$m5" master)" "$want" "LC5 $n: $why"
    rm -f "$m5/$file"
  done <<'EOF'
docs/handoffs/h.md|consumed|||the consumed mark alone: no overlap, whatever the line's comment
notes/h.md|consumed||notes/h.md|the same copy off docs/handoffs/: still an overlap
EOF
  git -C "$m5" merge -q --ff-only origin/master; g -C "$tmp/seed-m5" rm -q docs/handoffs/h.md
  g -C "$tmp/seed-m5" commit -qm del; g -C "$tmp/seed-m5" push -q origin master 2>/dev/null; fetchall "$m5"
  echo edited > "$m5/docs/handoffs/h.md"
  ok "$(src lc_overlap "$m5" master)" "docs/handoffs/h.md" "LC5 $n: … but a copy of a doc origin deleted is one (git would refuse the merge)"

  # ---- LC6: lc_ff ------------------------------------------------------------------------------------------------
  srv f6; c6="$tmp/w/f6"; cl f6 "$c6"; old6=$(git -C "$c6" rev-parse HEAD)
  push f6 a.txt origin; fetchall "$c6"; echo mine > "$c6/a.txt"; rm -f "$c6/.git/ORIG_HEAD"
  git -C "$c6" config merge.autoStash true
  ok "$(src lc_ff "$c6" master; echo "rc $?")" "a.txt
rc 3" "LC6 $n: an overlap returns rc 3 with its paths"
  ok "$([ -e "$c6/.git/ORIG_HEAD" ] && echo written)|$(git -C "$c6" rev-parse HEAD)|$(cat "$c6/a.txt")" "|$old6|mine" \
    "LC6 $n: … no merge ran: ORIG_HEAD absent, HEAD and the edit untouched"
  git -C "$c6" checkout -q -- a.txt; echo note > "$c6/untouched.txt"
  ok "$(src lc_ff "$c6" master; echo "rc $?")" "rc 0" "LC6 $n: a tree clean of overlaps returns rc 0"
  ok "$(git -C "$c6" rev-parse HEAD)|$(git -C "$c6" stash list)|$(cat "$c6/untouched.txt")" "$(tipof f6)||note" \
    "LC6 $n: … at origin's tip, under merge.autoStash with the stash list empty and the untracked file kept"
  g -C "$c6" commit -q --allow-empty -m local; push f6 b.txt more; fetchall "$c6"
  out=$(src lc_ff "$c6" master); rc=$?
  ok "$rc|$(printf '%s\n' "$out" | wc -l | tr -d ' ')" "1|1" "LC6 $n: a merge git refuses (diverged): rc 1, one line"
  has "$out" "Not possible to fast-forward" "LC6 $n: … git's own reason"

  # A same-bytes copy never holds the fast-forward back, staged or not, and a refused merge unstages it again.
  srv g6; g6="$tmp/w/g6"; cl g6 "$g6"
  push g6 d.txt doomed; push g6 e.txt old; fetchall "$g6"; g -C "$g6" merge -q --ff-only origin/master
  g -C "$tmp/seed-g6" rm -q d.txt; g -C "$tmp/seed-g6" commit -qm rm; push g6 e.txt new; push g6 n.txt fresh; push g6 m.txt staged; fetchall "$g6"
  rm -f "$g6/d.txt"; printf 'new\n' > "$g6/e.txt"; printf 'fresh\n' > "$g6/n.txt"; printf 'staged\n' > "$g6/m.txt"; g -C "$g6" add m.txt
  ok "$(src lc_ff "$g6" master; echo "rc $?")" "rc 0" "LC6 $n: a deletion, a dirty copy, an untracked copy and a staged copy, all origin's bytes: rc 0"
  ok "$(git -C "$g6" rev-parse HEAD)|$(git -C "$g6" status --porcelain)|$(cat "$g6/n.txt" "$g6/e.txt")" "$(tipof g6)||fresh
new" "LC6 $n: … at origin's tip, clean, every copy as it was"
  g -C "$g6" commit -q --allow-empty -m local; push g6 z.txt zed; fetchall "$g6"; printf 'zed\n' > "$g6/z.txt"
  out=$(src lc_ff "$g6" master); rc=$?
  ok "$rc|$(git -C "$g6" status --porcelain)" "1|?? z.txt" "LC6 $n: a merge git refuses (diverged) unstages the copy it staged"

  # A handoff doc keeps its copy through the fast-forward, mark and refresh alike, and stays dirty on the tracked doc.
  srv h6; h6="$tmp/w/h6"; cl h6 "$h6"; mkdir -p "$h6/docs/handoffs"
  push h6 docs/handoffs/h.md "$(printf -- '---\nstatus: pending\n---\nbody')"; fetchall "$h6"
  printf -- '---\nstatus: consumed\n---\nbody\n' > "$h6/docs/handoffs/h.md"
  ok "$(src lc_ff "$h6" master; echo "rc $?")" "rc 0" "LC6 $n: a marked handoff doc does not hold the fast-forward back"
  ok "$(git -C "$h6" rev-parse HEAD)|$(git -C "$h6" status --porcelain)|$(sed -n 2p "$h6/docs/handoffs/h.md")" "$(tipof h6)| M docs/handoffs/h.md|status: consumed" \
     "LC6 $n: … at origin's tip, tracked, the mark kept and dirty"
  push h6 docs/handoffs/r.md "$(printf -- '---\nstatus: pending\n---\nv1')"; fetchall "$h6"
  printf -- '---\nstatus: pending\n---\nv2\n' > "$h6/docs/handoffs/r.md"
  ok "$(src lc_ff "$h6" master; echo "rc $?")|$(tail -n 1 "$h6/docs/handoffs/r.md")" "rc 0|v2" "LC6 $n: a refreshed doc does not either, and keeps its refresh"

  # ---- LC7: every lc_check form, each one primary-refresh.py's regex accepts --------------------------------------
  srv k7; c7="$tmp/w/k7"; cl k7 "$c7"; forms=
  form() { printf '%s\n' "$1" >> "$tmp/forms"; forms="$forms ${1%% *}"; }
  : > "$tmp/forms"
  form "$(src lc_check "$c7" master)"
  g -C "$c7" commit -q --allow-empty -m local; form "$(src lc_check "$c7" master)"
  push k7 b.txt more; fetchall "$c7"; form "$(src lc_check "$c7" master)"
  g -C "$c7" reset -q --hard HEAD~1; : > "$c7/.git/index.lock"; form "$(src lc_check "$c7" master)"
  rm -f "$c7/.git/index.lock"; echo mine > "$c7/b.txt"; form "$(src lc_check "$c7" master)"
  rm -f "$c7/b.txt"; form "$(src lc_check "$c7" master)"
  g init -q "$tmp/w/unborn"; form "$(src lc_check "$tmp/w/unborn" master)"
  ok "$forms" " current ahead diverged busy overlap behind unreadable" "LC7 $n: the seven forms, in their order"
  ok "$(python3 - "$PR" "$tmp/forms" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("pr", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
bad = [l for l in open(sys.argv[2]).read().splitlines() if not m.CHECK_FORMS[l.split(" ", 1)[0]].match(l)]
print(bad or "all")
PY
)" all "LC7 $n: … each matching primary-refresh.py's CHECK_FORMS regex"
  ok "$(src lc_check "$c7" master)" "behind $(tipof k7) 1 $(git -C "$c7" rev-parse HEAD)" "LC7 $n: behind names origin's tip, the count and HEAD"
  : > "$c7/.git/MERGE_HEAD"
  ok "$(src lc_check "$c7" master)" "busy $(tipof k7) a merge in progress" "LC7 $n: an operation reads busy, in words"
  rm -f "$c7/.git/MERGE_HEAD"; git -C "$c7" checkout -q --detach
  ok "$(src lc_check "$c7" master)" "busy $(tipof k7) HEAD detached" "LC7 $n: a detached HEAD behind origin reads busy"
  git -C "$c7" checkout -q -b side
  ok "$(src lc_check "$c7" master)" "busy $(tipof k7) on side, not master" "LC7 $n: another branch reads busy"
  git -C "$c7" checkout -q --detach "$(tipof k7)"
  ok "$(src lc_check "$c7" master)" "current $(tipof k7)" "LC7 $n: a detached HEAD at origin's tip reads current"

  # ---- LC8: sourcing changes nothing of the caller's ---------------------------------------------------------------
  out=$("$SH" -c '
    set -euo pipefail
    here=H d=D m=M e=E out=O rc=R
    o0=$(set -o); s0=$(shopt -p); v0=$(compgen -v | LC_ALL=C sort)
    . "$1"
    v1=$(compgen -v | LC_ALL=C sort)
    printf "new:%s\n" "$(LC_ALL=C comm -13 <(printf "%s\n" "$v0") <(printf "%s\n" "$v1") | grep -v "^_$" | tr "\n" " ")"
    lc_op "$2" >/dev/null || :; lc_ssh_rule "$2"; lc_default "$2" >/dev/null || :; lc_default_local "$2" >/dev/null || :
    lc_fetch "$2" master >/dev/null 2>&1 || :; lc_overlap "$2" master >/dev/null || :; lc_ff "$2" master >/dev/null 2>&1 || :
    lc_check "$2" master >/dev/null || :; lc_overlap_ref "$2" refs/remotes/origin/master >/dev/null || :
    lc_bounded 5 true || :; lc_loaded
    printf "vals:%s\n" "$here $d $m $e $out $rc"
    [ "$(set -o)" = "$o0" ] && echo "set -o: same"; [ "$(shopt -p)" = "$s0" ] && echo "shopt: same"
    v2=$(compgen -v | LC_ALL=C sort)
    printf "after:%s\n" "$(LC_ALL=C comm -13 <(printf "%s\n" "$v0") <(printf "%s\n" "$v2") | grep -v "^_$" | tr "\n" " ")"
  ' _ "$LC" "$c7" 2>&1)
  has "$out" "new:_lc_dir " "LC8 $n: sourcing sets only _lc_dir"
  has "$out" "vals:H D M E O R" "LC8 $n: every function called under set -euo pipefail leaves here d m e out rc as they were"
  has "$out" "set -o: same" "LC8 $n: … and set -o"
  has "$out" "shopt: same" "LC8 $n: … and shopt -p"
  has "$out" "after:GIT_SSH_COMMAND GIT_TERMINAL_PROMPT _lc_dir " "LC8 $n: … the only names it adds are _lc_dir and the ssh rule's two exports"

  # ---- LC9: the run modes' exit codes --------------------------------------------------------------------------------
  srv m9; c9="$tmp/w/m9"; cl m9 "$c9"
  out=$(FAKE_SSH=fail mode fetch "$c9" master 2>"$tmp/err"); rc=$?
  ok "$rc|$out" "128|" "LC9 $n: fetch against an unreachable origin exits git's 128, nothing on stdout"
  has "$(cat "$tmp/err")" "fatal: " "LC9 $n: … git's fatal line on stderr"
  push m9 b.txt more
  ok "$(mode fetch "$c9" master 2>&1; echo "rc $?")" "rc 0" "LC9 $n: a fetch that succeeds exits 0"
  ok "$(mode check "$c9" master | wc -l | tr -d ' ')|$(mode check "$c9" master >/dev/null; echo $?)" "1|0" "LC9 $n: check: one line, exit 0"
  old9=$(git -C "$c9" rev-parse HEAD)
  ok "$(mode ff "$c9" master; echo "rc $?")" "moved $old9 $(tipof m9)
rc 0" "LC9 $n: ff: moved <old> <new>, exit 0"
  push m9 a.txt origin; mode fetch "$c9" master; echo mine > "$c9/a.txt"
  ok "$(mode ff "$c9" master; echo "rc $?")" "overlap a.txt
rc 0" "LC9 $n: ff: overlap <paths>, exit 0"
  git -C "$c9" checkout -q -- a.txt; g -C "$c9" commit -q --allow-empty -m local
  out=$(mode ff "$c9" master); rc=$?
  ok "$rc|${out%% *}|$(printf '%s\n' "$out" | wc -l | tr -d ' ')" "0|refused|1" "LC9 $n: ff: refused <why>, one line, exit 0"
  ok "$(mode default "$tmp/w/none" 2>/dev/null; echo "rc $?")" "rc 1" "LC9 $n: default with nothing resolvable exits 1"
  git -C "$c9" reset -q --hard HEAD~1; push m9 a.txt again; mode fetch "$c9" master; echo mine > "$c9/a.txt"
  ok "$(mode overlap "$c9" refs/remotes/origin/master; echo "rc $?")" "overlap a.txt
rc 0" "LC9 $n: overlap: overlap <paths>, exit 0"
  git -C "$c9" checkout -q -- a.txt
  ok "$(mode overlap "$c9" refs/remotes/origin/master; echo "rc $?")" "clear
rc 0" "LC9 $n: overlap: clear, exit 0"
  ok "$(mode overlap "$c9" refs/heads/nowhere; echo "rc $?")" "clear
rc 0" "LC9 $n: overlap: a ref that does not resolve reads clear"
  g -C "$c9" commit -q --allow-empty -m local   # diverged again, for the GIT_DIR case below
  for args in "" "default" "fetch $c9" "check $c9" "ff $c9" "check $c9 master extra" "bogus $c9 master" \
              "overlap $c9" "overlap $c9 master" "overlap $c9 refs/heads/x extra"; do
    out=$(mode $args 2>"$tmp/err"); rc=$?
    ok "$rc|$out" "2|" "LC9 $n: usage '${args:-<none>}' exits 2, stdout empty"
    has "$(cat "$tmp/err")" "live-checkout: usage: " "LC9 $n: … with the usage line"
  done
  g init -q "$tmp/w/decoy"; g -C "$tmp/w/decoy" commit -q --allow-empty -m decoy
  ok "$(GIT_DIR="$tmp/w/decoy/.git" mode check "$c9" master | cut -d' ' -f1)" "diverged" "LC9 $n: a caller's GIT_DIR is scrubbed: the named repo is read"

  # ---- LC11: the content mode (ADR 0078 d4): a diverged checkout, read for its repair --------------------------------
  srv m11; c11="$tmp/w/m11"; cl m11 "$c11"; contents=
  content() { printf '%s\n' "$1" >> "$tmp/content.forms"; contents="$contents ${1%% *}"; }
  : > "$tmp/content.forms"
  git -C "$c11" checkout -q -b side; content "$(mode content "$c11" master)"; git -C "$c11" checkout -q master
  content "$(mode content "$c11" master)"                      # no commit ahead: untouched
  echo same > "$c11/s.txt"; g -C "$c11" add -A; g -C "$c11" commit -qm local-s; push m11 s.txt same; fetchall "$c11"
  content "$(mode content "$c11" master)"                      # landed
  echo other > "$c11/t.txt"; g -C "$c11" add -A; g -C "$c11" commit -qm local-t
  content "$(mode content "$c11" master)"                      # unlanded
  ok "$contents" " busy untouched landed unlanded" "LC11 $n: the forms read in order"
  ok "$(python3 - "$PR" "$tmp/content.forms" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("pr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for line in open(sys.argv[2]):
    line = line.rstrip("\n")
    rx = m.CONTENT_FORMS.get(line.split(" ", 1)[0])
    if not (rx and rx.match(line)):
        print(repr(line)); break
else:
    print("all")
PY
)" all "LC11 $n: … each matching primary-refresh.py's CONTENT_FORMS regex"
  ok "$(mode content "$c11" master)" "unlanded 1 t.txt" "LC11 $n: unlanded names what differs, not what matches"
  # Run under set -euo pipefail, as the header promises: a differing file is rc 1 from git, which must not end the function.
  strict() { "$SH" -c 'set -euo pipefail; . "$1"; shift; "$@"' _ "$LC" "$@"; }
  ok "$(strict lc_ahead_content "$c11" refs/remotes/origin/master refs/heads/master | tr '\0' ' ')" "Ts.txt Tt.txt Dt.txt =1 " \
    "LC11 $n: lc_ahead_content's records under set -euo pipefail: every touched file, each differing one, then the result"
  ok "$(strict lc_ahead_content "$c11" refs/remotes/origin/nowhere refs/heads/master | tr '\0' ' ')" "=128 " \
    "LC11 $n: a ref git cannot read is its failure, never =3 (touches no file)"
  git -C "$c11" reset -q --hard origin/master
  ok "$(src lc_ahead_content "$c11" refs/remotes/origin/master refs/heads/master | tr '\0' ' ')" "=3 " \
    "LC11 $n: nothing ahead: nothing touched, =3"
  ok "$(mode content "$c11" master >/dev/null; echo "rc $?")" "rc 0" "LC11 $n: content exits 0"
  git -C "$c11" update-ref -d refs/remotes/origin/master
  ok "$(mode content "$c11" master)" "unreadable git diff failed (128)" "LC11 $n: … and an unreadable ref reads unreadable, never untouched"
  for args in "content" "content $c11" "content $c11 master extra"; do
    out=$(mode $args 2>"$tmp/err"); rc=$?
    ok "$rc|$out" "2|" "LC11 $n: usage '$args' exits 2, stdout empty"
  done

  # ---- LC12: the target (p54-6): a live checkout moves to the Green tip, never past it --------------------------------
  srv t12; c12="$tmp/w/t12"; cl t12 "$c12"; B12=$(tipof t12)
  push t12 b.txt two; G12=$(tipof t12); push t12 c.txt three; O12=$(tipof t12); fetchall "$c12"; : > "$tmp/forms12"
  f12() { printf '%s\n' "$1" >> "$tmp/forms12"; printf '%s\n' "$1"; }
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "behind $G12 1 $B12" "LC12 $n: behind a target: the target first, counted against it"
  ok "$(src lc_check "$c12" master)" "behind $O12 2 $B12" "LC12 $n: … with none, origin's tip as before"
  printf 'two\n' > "$c12/b.txt"
  ok "$(src lc_overlap "$c12" master "$G12")|$(src lc_overlap "$c12" master)" "|" "LC12 $n: a copy with the target's bytes: no overlap against it (lc_same against the target)"
  printf 'mine\n' > "$c12/b.txt"
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "overlap $G12 1 b.txt" "LC12 $n: … other bytes: an overlap against the target"
  rm -f "$c12/b.txt"; : > "$c12/.git/index.lock"
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "busy $G12 index.lock present" "LC12 $n: busy names the target"
  rm -f "$c12/.git/index.lock"
  ok "$(mode ff "$c12" master "$G12")" "moved $B12 $G12" "LC12 $n: ff with a target moves to it, not to origin's tip"
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "current $G12" "LC12 $n: at the target: current"
  g -C "$c12" merge -q --ff-only origin/master
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "past $G12 1" "LC12 $n: pulled to origin's tip by hand: past the target by 1, never moved back"
  ok "$(mode ff "$c12" master "$G12" >/dev/null; git -C "$c12" rev-parse HEAD)" "$O12" "LC12 $n: … and ff to the target leaves HEAD where it is (never back)"
  g -C "$c12" commit -q --allow-empty -m local
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "ahead $G12 1" "LC12 $n: ahead counts against origin, the target first"
  push t12 d.txt four; fetchall "$c12"
  ok "$(f12 "$(src lc_check "$c12" master "$G12")")" "diverged $G12 1 1" "LC12 $n: diverged counts against origin too"
  ok "$(f12 "$(src lc_check "$c12" master 0000000000000000000000000000000000000000)")" "unreadable 0000000000000000000000000000000000000000 names no commit" \
    "LC12 $n: a target that does not resolve reads unreadable"
  ok "$(python3 - "$PR" "$tmp/forms12" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("pr", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
bad = [l for l in open(sys.argv[2]).read().splitlines() if not m.CHECK_FORMS[l.split(" ", 1)[0]].match(l)]
print(bad or "all")
PY
)" all "LC12 $n: every form with a target, past included, matches primary-refresh.py's CHECK_FORMS"
  ok "$(mode check "$c12" master "$G12" >/dev/null; echo $?)|$(mode check "$c12" master abc 2>/dev/null; echo $?)|$(mode ff "$c12" master HEAD 2>/dev/null; echo $?)" "0|2|2" \
    "LC12 $n: the run modes take a 40-hex target; anything else is a usage error"
  ok "$(mode ff "$c12" master 0000000000000000000000000000000000000000)" "refused 0000000000000000000000000000000000000000 names no commit" "LC12 $n: ff to a target that does not resolve refuses"
  ok "$(mode overlap "$c12" "$G12")" "clear" "LC12 $n: the overlap mode takes a commit id"
  # content against a target: on origin by content, but the target does not hold it yet (pending), or does (landed)
  srv u12; u12="$tmp/w/u12"; cl u12 "$u12"; push u12 x.txt x0; GU=$(tipof u12); fetchall "$u12"; g -C "$u12" merge -q --ff-only origin/master
  echo same > "$u12/s.txt"; g -C "$u12" add -A; g -C "$u12" commit -qm local-s; push u12 s.txt same; NU=$(tipof u12); push u12 y.txt y; fetchall "$u12"
  ok "$(mode content "$u12" master "$GU")" "pending 1" "LC12 $n: content with a target behind the landed commit: pending"
  ok "$(mode content "$u12" master "$NU")|$(mode content "$u12" master)" "landed 1|landed 1" "LC12 $n: … a target that holds it, and none: landed"
  ok "$(mode content "$u12" master 0000000000000000000000000000000000000000)" "unreadable 0000000000000000000000000000000000000000 names no commit" "LC12 $n: … a target that does not resolve: unreadable"

  # ---- LC13: lc_landed: a landed close-out's THREAD.md never holds a move back ------------------------------------------
  thr() { srv "$1"; push "$1" THREAD.md t0 >/dev/null; T="$tmp/w/$1"; cl "$1" "$T"; }
  thr l13a; push l13a THREAD.md n; Na=$(tipof l13a); push l13a THREAD.md n2; N2a=$(tipof l13a); push l13a o.txt o; fetchall "$T"
  printf 'n\n' > "$T/THREAD.md"
  ok "$(src lc_landed "$T" master THREAD.md)" "$Na" "LC13 $n (a): a THREAD.md equal to a commit's on origin: lc_landed names it"
  ok "$(src lc_overlap "$T" master "$N2a")" "" "LC13 $n (a): … no overlap against a target past it that changed it again"
  ok "$(src lc_ff "$T" master "$N2a"; echo "rc $?")" "rc 0" "LC13 $n (a): … lc_ff goes through"
  ok "$(git -C "$T" rev-parse HEAD)|$(cat "$T/THREAD.md")|$(git -C "$T" status --porcelain)" "$N2a|n2|" "LC13 $n (a): … at the target, its copy written, the tree clean"
  thr l13b; push l13b THREAD.md b; Bb=$(tipof l13b); push l13b THREAD.md n; push l13b o.txt o; fetchall "$T"
  printf 'n\n' > "$T/THREAD.md"
  ok "$(src lc_ff "$T" master "$Bb"; echo "rc $?")" "rc 0" "LC13 $n (b): a target before the landed commit that changed THREAD.md: no overlap"
  ok "$(git -C "$T" rev-parse HEAD)|$(cat "$T/THREAD.md")|$(git -C "$T" status --porcelain)" "$Bb|n| M THREAD.md" "LC13 $n (b): … moved to it, the landed copy kept, dirty"
  thr l13c; g -C "$tmp/seed-l13c" checkout -q -b side; push l13c THREAD.md n >/dev/null; g -C "$tmp/seed-l13c" checkout -q master
  push l13c THREAD.md b >/dev/null; g -C "$T" fetch -q origin side master 2>/dev/null; printf 'n\n' > "$T/THREAD.md"
  ok "$(src lc_overlap "$T" master)" "THREAD.md" "LC13 $n (c): the same copy held only by a side branch, not origin/<d>: an overlap"
  thr l13d; push l13d THREAD.md n >/dev/null; push l13d THREAD.md n2 >/dev/null; fetchall "$T"; printf 'mine\n' > "$T/THREAD.md"
  ok "$(src lc_overlap "$T" master)" "THREAD.md" "LC13 $n (d): a THREAD.md no commit holds: an overlap"
  printf 'x\n' > "$T/THREAD.md"; g -C "$T" add THREAD.md; printf 'n\n' > "$T/THREAD.md"
  ok "$(src lc_overlap "$T" master)" "THREAD.md" "LC13 $n (e): a landed copy over a staged third blob: an overlap"
  thr l13f; push l13f notes.md n >/dev/null; push l13f notes.md n2 >/dev/null; fetchall "$T"; printf 'n\n' > "$T/notes.md"
  ok "$(src lc_overlap "$T" master)" "notes.md" "LC13 $n (f): a non-THREAD.md file equal to a landed blob: still an overlap"
  thr l13g; push l13g THREAD.md n >/dev/null; push l13g THREAD.md n2; N2g=$(tipof l13g); fetchall "$T"
  g -C "$T" commit -q --allow-empty -m local; printf 'n\n' > "$T/THREAD.md"
  ok "$(src lc_ff "$T" master "$N2g" >/dev/null; echo "rc $?")" "rc 1" "LC13 $n (g): a merge git refuses after the restore: rc 1"
  ok "$(git -C "$T" diff --cached --name-only)|$(cat "$T/THREAD.md")" "|n2" "LC13 $n (g): … THREAD.md unstaged, its copy the target's"
  thr l13h; push l13h THREAD.md n >/dev/null; push l13h THREAD.md n2; N2h=$(tipof l13h); fetchall "$T"; printf 'n\n' > "$T/THREAD.md"
  ok "$(mode ff "$T" master | cut -d' ' -f1)|$(git -C "$T" rev-parse HEAD)|$(cat "$T/THREAD.md")|$(git -C "$T" status --porcelain)" "moved|$N2h|n2|" \
    "LC13 $n (h): no target, origin's tip: the same, through the ff mode"

  # ---- LC10: lc_bounded: the child's rc, the budget, and a signal or a normal exit kills the whole group -----------
  # gone <pgid> (tests/lib/proc-group.sh): no process of the group is left, under a 30 s liveness bound
  ok "$(src lc_bounded 5 sh -c 'exit 3'; echo "rc $?")" "rc 3" "LC10 $n: the child's own rc"
  ok "$(src lc_bounded 5 true; echo "rc $?")" "rc 0" "LC10 $n: … and 0"
  ok "$(src lc_bounded x true; echo "rc $?")" "rc 0" "LC10 $n: a non-integer budget reads as 1 s"
  ok "$(src lc_bounded 5 "$tmp/no-such-command" 2>/dev/null; echo "rc $?")" "rc 127" "LC10 $n: an argv that cannot exec: 127"
  rm -f "$tmp/g10"; s0=$SECONDS
  ok "$(src lc_bounded 1 sh -c 'echo $$ > "$1"; exec sleep 300' _ "$tmp/g10"; echo "rc $?")" "rc 142" "LC10 $n: over the budget: 142"
  ok "$([ $((SECONDS - s0)) -lt 60 ] && echo cut)" cut "LC10 $n: … cut by its 1 s budget, never the child's own 300 s"
  ok "$(gone "$(cat "$tmp/g10" 2>/dev/null)")" gone "LC10 $n: … and the child's group is gone"
  rm -f "$tmp/g10"
  ok "$(src lc_bounded 5 sh -c 'echo $$ > "$1"; sleep 300 >/dev/null 2>&1 & exit 0' _ "$tmp/g10"; echo "rc $?")" "rc 0" \
    "LC10 $n: a child that exits 0 and leaves a descendant: 0"
  ok "$(gone "$(cat "$tmp/g10" 2>/dev/null)")" gone "LC10 $n: … and the descendant is killed with the group"
  # <signal>:<rc>:<sent to>:<the caller's next command>. A TERM or HUP to lc_bounded alone, or an INT to its caller's
  # whole group (a Ctrl-C): lc_bounded kills the child's group, then dies of that signal. The caller, a script in its
  # own group with the three at their default (a `&` job inherits INT ignored), goes on with the rc when only
  # lc_bounded was signalled, and stops when the INT reached it too: bash stops only once its child died of the INT.
  for row in TERM:143:lc_bounded:ran HUP:129:lc_bounded:ran INT:130:group:never; do
    IFS=: read -r sig want to next <<< "$row"
    rm -f "$tmp/g10" "$tmp/g10.next"
    NEXT="$tmp/g10.next" perl -e '$SIG{$_}="DEFAULT" for qw(INT HUP TERM); setpgrp(0,0); exec @ARGV' \
      "$SH" -c '. "$1"; shift; "$@"; r=$?; echo ran > "$NEXT"; exit "$r"' _ "$LC" \
      lc_bounded 30 sh -c 'echo "$PPID $$" > "$1.t"; mv "$1.t" "$1"; sleep 300 | cat' _ "$tmp/g10" >/dev/null 2>&1 &
    bg=$!; i=0; while [ ! -s "$tmp/g10" ] && kill -0 "$bg" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i+1)); done
    pp= pg=; read -r pp pg < "$tmp/g10" 2>/dev/null
    case $to in
      group) to="its caller's group"; kill -"$sig" -- "-$bg" ;;
      *) [ -n "$pp" ] && kill -"$sig" "$pp" ;;
    esac; wait "$bg"; rc=$?
    ok "$rc|$(cat "$tmp/g10.next" 2>/dev/null || echo never)" "$want|$next" \
      "LC10 $n: $sig to $to: rc $want, the caller's next command $next"
    ok "$(gone "$pg")" gone "LC10 $n: … and kills the child's group (sleep 300 | cat) first"
  done
done

exit $fail
