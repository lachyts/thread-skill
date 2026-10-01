#!/usr/bin/env bash
# p12-4 (ADR 0030), executed: the task-tree setup the engine renders for the read-only agents
# (taskTreeSetup), run under bash AND zsh (the Bash tool's shell on macOS) against a fixture origin.
# tests/pinned-tree.test.mjs pins the prompt text; this runs the commands. Every case checks what the tree
# is left on (branch or detached, which commit), what the setup printed, and the reaper lock it wrote.
# Hermetic: every repo lives under mktemp, the global git config is /dev/null, identity is passed per
# command, and the caller's GIT_DIR & co. are unset first.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export GIT_CONFIG_GLOBAL=/dev/null
root=$(pwd -P)

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# render <repo> <kind> <scope> <slug> [envBootstrap]: the command lines of one setup block, as the engine
# renders them. kind: refresh (planner, investigator), judge (plan judge, plan reviser), impl (the
# implementer's worktreeSetup). The block is every indented line from the first (the scrub) on: the
# MUST-print toplevel line, and the env bootstrap wherever the engine puts it.
render() {
  node --input-type=module -e "
    import { loadEngine } from './tests/lib/engine.mjs'
    const T = loadEngine(['taskTreeSetup', 'worktreeSetup'])
    const [repo, kind, scope, slug, envBootstrap] = process.argv.slice(1)
    const a = { repoPath: repo, defaultBranch: 'master', ...(envBootstrap ? { envBootstrap } : {}) }
    const task = { slug, scope }
    const out = kind === 'impl' ? T.worktreeSetup(a, task) : T.taskTreeSetup(a, task, kind === 'refresh')
    const l = out.split('\n').slice(1)
    const end = l.findIndex((x) => !x.startsWith('  '))
    process.stdout.write(l.slice(0, end).join('\n') + '\n')
  " "$@"
}

suite() {
  local sh="$1" n d R out tip wt head before pid
  n=$(basename "${sh%% *}"); d="$tmp/$n"; mkdir -p "$d"
  # run <script> [VAR=val …]: run a rendered setup from outside the repo, as a direct child of this
  # shell (so its $PPID is this test's live pid); output in $out. runat <dir> <script> runs it from <dir>.
  runat() { local at="$1" s="$2"; cd "$at" && $sh -c "$s" > "$d/out" 2>&1; cd "$root"; out=$(cat "$d/out"); }
  run() { local s="$1"; shift; cd "$d" && env "$@" $sh -c "$s" > "$d/out" 2>&1; cd "$root"; out=$(cat "$d/out"); }
  advance() { echo "$1" > "$d/pusher/$1.txt"; g -C "$d/pusher" add "$1.txt"; g -C "$d/pusher" commit -q -m "$1"; g -C "$d/pusher" push -q origin master; tip=$(git -C "$d/pusher" rev-parse HEAD); }
  toplevel() { printf '%s\n' "$out" | tail -1; }
  lockpid() { grep -oE 'pid [0-9]+' "$R/.git/worktrees/$1/locked" 2>/dev/null | grep -oE '[0-9]+' | head -1; }

  g init -q --bare "$d/o.git"
  g clone -q "$d/o.git" "$d/pusher" 2>/dev/null
  echo base > "$d/pusher/f.txt"; g -C "$d/pusher" add f.txt; g -C "$d/pusher" commit -q -m base; g -C "$d/pusher" push -q origin master
  tip=$(git -C "$d/pusher" rev-parse HEAD)
  g clone -q "$d/o.git" "$d/repo"; R=$(cd "$d/repo" && pwd -P)

  # 1. the code-writing planner creates the branch tree at origin's tip, locked with a live pid
  wt="$R/.claude/worktrees/proj-task-a"
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(git -C "$wt" symbolic-ref -q HEAD)" refs/heads/audit-fix/task-a "$n 1: the planner puts the tree on audit-fix/<alias>"
  ok "$(git -C "$wt" rev-parse HEAD)" "$tip" "$n 1: … at origin's tip"
  ok "$(toplevel)" "$wt" "$n 1: the toplevel line prints the tree"
  has "$out" "tree base: $tip" "$n 1: prints tree base: <tip>"
  case1=$tip
  pid=$(lockpid proj-task-a)
  ok "$pid" "$$" "$n 1: the lock names the reaper's pid N, the setup shell's parent"
  ok "$(ps -p "${pid:-0}" >/dev/null 2>&1 && echo live)" live "$n 1: … a live process"

  # 2. the implementer's byte-frozen worktreeSetup reuses the same tree at the same HEAD
  run "$(render "$R" impl cross-cutting proj-task-a)"
  ok "$(toplevel)|$(git -C "$wt" rev-parse HEAD)" "$wt|$tip" "$n 2: the implementer reuses the planner's tree"

  # 3. origin advances: the planner's refresh fast-forwards, silently
  advance c3
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)" "$tip" "$n 3: refresh fast-forwards to the new tip"
  ok "$(git -C "$wt" symbolic-ref -q HEAD)" refs/heads/audit-fix/task-a "$n 3: … still on its branch"
  case "$out" in *"NOT refreshed"*) ok "$out" "no NOT-refreshed line" "$n 3: no NOT-refreshed line" ;; *) ok y y "$n 3: no NOT-refreshed line" ;; esac

  # 4. a commit of its own: never moved, and says so
  g -C "$wt" commit -q --allow-empty -m own; head=$(git -C "$wt" rev-parse HEAD)
  advance c4
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)" "$head" "$n 4: own commits → HEAD unchanged"
  has "$out" "tree NOT refreshed: own commits; 1 behind origin/master as last fetched" "$n 4: … and the own-commits line"
  git -C "$wt" reset -q --hard origin/master

  # 5. a tracked modification: never moved, and says so
  echo dirty >> "$wt/f.txt"; head=$(git -C "$wt" rev-parse HEAD)
  advance c5
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)" "$head" "$n 5: tracked change → HEAD unchanged"
  has "$out" "tree NOT refreshed: dirty (tracked changes); 1 behind origin/master" "$n 5: … and the dirty line"
  git -C "$wt" checkout -q -- f.txt

  # 5b. untracked, non-ignored files (a venv, a verifier artefact) do not block the refresh
  mkdir -p "$wt/.venv"; echo x > "$wt/.venv/x"; echo log > "$wt/artefact.log"
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)" "$tip" "$n 5b: untracked files → still fast-forwarded"
  ok "$(cat "$wt/.venv/x")|$(cat "$wt/artefact.log")" "x|log" "$n 5b: … and they survive"
  case "$out" in *"NOT refreshed"*) ok "$out" "no NOT-refreshed line" "$n 5b: no NOT-refreshed line" ;; *) ok y y "$n 5b: no NOT-refreshed line" ;; esac

  # 5c. an untracked file in the way of the fast-forward: git refuses, the file is intact, it says so
  echo mine > "$wt/clash.txt"; head=$(git -C "$wt" rev-parse HEAD)
  advance clash
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)|$(cat "$wt/clash.txt")" "$head|mine" "$n 5c: a colliding untracked file → HEAD unchanged, file intact"
  has "$out" "tree NOT refreshed: fast-forward refused" "$n 5c: … and the refused line"
  rm -f "$wt/clash.txt"

  # 5d. a failed fetch skips every later check and says so
  run "$(render "$R" refresh cross-cutting proj-task-a)"; head=$(git -C "$wt" rev-parse HEAD)
  advance c5d
  git -C "$R" remote set-url origin "$d/missing.git"
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  git -C "$R" remote set-url origin "$d/o.git"
  ok "$(git -C "$wt" rev-parse HEAD)" "$head" "$n 5d: fetch failure → HEAD unchanged"
  has "$out" "tree NOT refreshed: fetch failed; 0 behind origin/master as last fetched" "$n 5d: … and the fetch-failed line"

  # 6. the ungated investigator creates a detached tree at the tip; a re-run after origin advances moves it
  local ro="$R/.claude/worktrees/proj-task-ro"
  run "$(render "$R" refresh read-only proj-task-ro)"
  ok "$(git -C "$ro" symbolic-ref -q HEAD || echo detached)|$(git -C "$ro" rev-parse HEAD)" "detached|$tip" "$n 6: read-only → detached tree at the tip"
  ok "$(lockpid proj-task-ro)" "$$" "$n 6: … locked too"
  advance c6
  run "$(render "$R" refresh read-only proj-task-ro)"
  ok "$(git -C "$ro" symbolic-ref -q HEAD || echo detached)|$(git -C "$ro" rev-parse HEAD)" "detached|$tip" "$n 6: … refreshed to the new tip, still detached"

  # 6b. plan-gated read-only: the planner's tree is the one the judge and investigator reuse
  local rog="$R/.claude/worktrees/proj-task-rog" count
  run "$(render "$R" refresh read-only proj-task-rog)"
  count=$(git -C "$R" worktree list --porcelain | grep -c '^worktree ')
  advance c6b
  run "$(render "$R" judge read-only proj-task-rog)"
  ok "$(git -C "$rog" rev-parse HEAD)" "$(git -C "$d/pusher" rev-parse HEAD~1)" "$n 6b: the judge reuses the planner's tree without moving it"
  run "$(render "$R" refresh read-only proj-task-rog)"
  ok "$(git -C "$R" worktree list --porcelain | grep -c '^worktree ')" "$count" "$n 6b: the investigator adds no second tree"
  ok "$(git -C "$rog" symbolic-ref -q HEAD || echo detached)|$(git -C "$rog" rev-parse HEAD)" "detached|$tip" "$n 6b: … and refreshes the same detached tree"

  # 6c. read-only → code-writing: the planner attaches the detached tree to audit-fix/<alias>
  run "$(render "$R" refresh cross-cutting proj-task-ro)"
  ok "$(git -C "$ro" symbolic-ref -q HEAD)|$(git -C "$ro" rev-parse HEAD)" "refs/heads/audit-fix/task-ro|$tip" "$n 6c: read-only → code: attached to the branch at the tip"

  # 6d. … when audit-fix/<alias> already exists: that branch is checked out, its commits kept
  local rd="$R/.claude/worktrees/proj-task-rd" own
  run "$(render "$R" refresh read-only proj-task-rd)"
  own=$(g -C "$R" commit-tree -p origin/master -m own "origin/master^{tree}")
  git -C "$R" branch audit-fix/task-rd "$own"
  run "$(render "$R" refresh cross-cutting proj-task-rd)"
  ok "$(git -C "$rd" symbolic-ref -q HEAD)|$(git -C "$rd" rev-parse HEAD)" "refs/heads/audit-fix/task-rd|$own" "$n 6d: the existing branch is checked out, its commit kept"
  has "$out" "tree NOT refreshed: own commits" "$n 6d: … and its own commits are reported"

  # 6e. code-writing → read-only: a branch tree stays on its branch and is fast-forwarded, never detached
  local ce="$R/.claude/worktrees/proj-task-ce"
  run "$(render "$R" refresh cross-cutting proj-task-ce)"
  advance c6e
  run "$(render "$R" refresh read-only proj-task-ce)"
  ok "$(git -C "$ce" symbolic-ref -q HEAD || echo detached)|$(git -C "$ce" rev-parse HEAD)" "refs/heads/audit-fix/task-ce|$tip" "$n 6e: code → read-only: still on its branch, fast-forwarded"

  # 7. the judge never moves the tree and prints no refresh line
  head=$(git -C "$wt" rev-parse HEAD)
  advance c7
  run "$(render "$R" judge cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)" "$head" "$n 7: the judge leaves HEAD where it was"
  case "$out" in *"NOT refreshed"*) ok "$out" "no refresh line" "$n 7: no refresh line" ;; *) ok y y "$n 7: no refresh line" ;; esac
  has "$out" "tree base: $head" "$n 7: … and prints its tree base"

  # 7b. the tree is reaped (locked, so -f -f; the reaper deletes the branch too) and origin advances: the
  #     judge recreates it at the new tip, and its tree base differs from the planner's
  git -C "$R" worktree remove -f "$wt" >/dev/null 2>&1; ok "$([ -d "$wt" ] && echo kept)" kept "$n 7b: a single -f refuses the locked tree"
  git -C "$R" worktree remove -f -f "$wt"; git -C "$R" branch -q -D audit-fix/task-a
  advance c7b
  run "$(render "$R" judge cross-cutting proj-task-a)"
  ok "$(git -C "$wt" rev-parse HEAD)" "$tip" "$n 7b: the judge recreates the tree at the new tip"
  has "$out" "tree base: $tip" "$n 7b: … and its tree base is the new tip"
  ok "$([ "$tip" != "$case1" ] && echo differs)" differs "$n 7b: … which differs from the planner's case-1 base"

  # 8. a stale plain directory at $WT: nothing reaches the main checkout
  local plain="$R/.claude/worktrees/proj-task-plain" mainhead mainbr
  mkdir -p "$plain"; mainhead=$(git -C "$R" rev-parse HEAD); mainbr=$(git -C "$R" symbolic-ref -q HEAD)
  run "$(render "$R" refresh cross-cutting proj-task-plain)"
  ok "$(git -C "$R" rev-parse HEAD)|$(git -C "$R" symbolic-ref -q HEAD)" "$mainhead|$mainbr" "$n 8: plain dir → the main checkout's HEAD and branch are unchanged"
  ok "$([ -e "$R/.git/locked" ] || [ -e "$R/.git/worktrees/proj-task-plain" ] && echo written || echo none)" none "$n 8: … no lock or admin dir written"
  ok "$(toplevel)" "$R" "$n 8: … and the toplevel line prints the main checkout (the agent stops)"
  case "$out" in *"tree base:"*) ok "$out" "no tree base" "$n 8: no tree base line" ;; *) ok y y "$n 8: no tree base line" ;; esac

  # 9. under an inherited GIT_DIR, the decoy and its remote are untouched
  g init -q --bare "$d/decoy-remote.git"
  g clone -q "$d/decoy-remote.git" "$d/decoy" 2>/dev/null
  g -C "$d/decoy" commit -q --allow-empty -m decoy && g -C "$d/decoy" push -q origin master
  snap() { git -C "$d/decoy" for-each-ref; echo "bare=$(git -C "$d/decoy" config --get core.bare)"; cat "$d/decoy/.git/config"; git -C "$d/decoy" worktree list --porcelain; ls "$d/decoy/.git/worktrees" 2>/dev/null; echo "-- remote"; git -C "$d/decoy-remote.git" for-each-ref; }
  before=$(snap)
  run "$(render "$R" refresh cross-cutting proj-task-env)" GIT_DIR="$d/decoy/.git"
  run "$(render "$R" refresh read-only proj-task-envro)" GIT_DIR="$d/decoy/.git" GIT_WORK_TREE="$d/decoy"
  ok "$(snap)" "$before" "$n 9: the decoy and its remote are unchanged"
  ok "$(git -C "$R/.claude/worktrees/proj-task-env" symbolic-ref -q HEAD)" refs/heads/audit-fix/task-env "$n 9: … and the tree landed under repoPath"

  # 10. a stale lock is replaced by the live pid
  git -C "$R" worktree unlock "$wt"; git -C "$R" worktree lock --reason "pid 999999 stale" "$wt"
  run "$(render "$R" refresh cross-cutting proj-task-a)"
  ok "$(lockpid proj-task-a)" "$$" "$n 10: re-running the setup replaces a stale lock with the live pid"

  # 12. the env bootstrap runs in the task tree, last, after tree base:
  local bs="$R/.claude/worktrees/proj-task-bs"
  runat "$R" "$(render "$R" refresh read-only proj-task-bs 'touch BOOTSTRAP')"
  ok "$([ -e "$bs/BOOTSTRAP" ] && echo yes)|$([ -e "$R/BOOTSTRAP" ] && echo leaked)" "yes|" "$n 12: a created tree runs the bootstrap inside it"
  rm -f "$bs/BOOTSTRAP"

  # 12b. a stale plain directory at $WT: the bootstrap never runs (not in it, not in the main checkout)
  local bp="$R/.claude/worktrees/proj-task-bsplain"
  mkdir -p "$bp"
  run "$(render "$R" refresh cross-cutting proj-task-bsplain 'touch BOOTSTRAP')"
  ok "$(find "$d" -name BOOTSTRAP | sed "s|^$d/||")" "" "$n 12b: plain dir → no bootstrap side effect anywhere"
  rm -rf "$bp"

  # 12c. the create arm's fetch fails, run from the main checkout: the bootstrap does not land there
  git -C "$R" remote set-url origin "$d/missing.git"
  for sc in read-only cross-cutting; do
    runat "$R" "$(render "$R" refresh "$sc" "proj-task-bsfail-$sc" 'touch BOOTSTRAP')"
    ok "$(find "$d" -name BOOTSTRAP | sed "s|^$d/||")|$([ -e "$R/.claude/worktrees/proj-task-bsfail-$sc" ] && echo tree)" "|" "$n 12c ($sc): fetch failure → no tree, no bootstrap side effect anywhere"
    case "$out" in *"tree base:"*) ok "$out" "no tree base" "$n 12c ($sc): no tree base line" ;; *) ok y y "$n 12c ($sc): no tree base line" ;; esac
  done
  git -C "$R" remote set-url origin "$d/o.git"

  # 13. a locked tree deleted by hand (rm -rf, no worktree remove) is recovered by re-running the setup
  for sc in read-only cross-cutting; do
    local hw="$R/.claude/worktrees/proj-task-rm-$sc"
    run "$(render "$R" refresh "$sc" "proj-task-rm-$sc")"
    ok "$(lockpid "proj-task-rm-$sc")" "$$" "$n 13 ($sc): the tree is locked"
    rm -rf "$hw"
    out=$(git -C "$R" worktree add --detach "$hw" origin/master 2>&1); has "$out" "missing but locked" "$n 13 ($sc): … a bare worktree add now fails (the hazard)"
    run "$(render "$R" refresh "$sc" "proj-task-rm-$sc")"
    ok "$(toplevel)|$(git -C "$hw" rev-parse HEAD)" "$hw|$tip" "$n 13 ($sc): re-running the setup recreates it at the tip"
    ok "$(lockpid "proj-task-rm-$sc")" "$$" "$n 13 ($sc): … locked again"
  done
  ok "$(git -C "$R/.claude/worktrees/proj-task-rm-cross-cutting" symbolic-ref -q HEAD)" refs/heads/audit-fix/task-rm-cross-cutting "$n 13: … the code-writing tree back on its branch"
}

for sh in "${shells[@]}"; do suite "$sh"; done

# 11. the only tree remover the skills run tolerates the lock
ok "$(grep -c 'worktree remove -f -f' skills/repair/SKILL.md)" 1 "repair's clean defer removes a locked tree (-f -f)"
ok "$(grep -c 'worktree remove --force' skills/repair/SKILL.md)" 0 "… and no single --force remains"

echo; [ "$fail" -eq 0 ] && echo "pinned-tree: ALL PASS" || echo "pinned-tree: SOME FAILED"
exit "$fail"
