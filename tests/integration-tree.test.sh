#!/usr/bin/env bash
# p12-6 (ADR 0030 decision 3), executed: the steps the Integration call renders — branchTreeSetup (the
# integrator's, the judge's and the seeded reviser's tree entry, the last with its fast-forward),
# integrationMergeStep (the integrator's merge step), integrationJudgeCheck (the judge's first step),
# integrationMergeReads (the judge's read of every merge since the anchor) and ANCHOR_RECIPE (the lead's
# anchor) — run under bash AND zsh -f (the Bash tool's shell on macOS) against fixture origins.
# skills/execute/tests/integrate.test.mjs pins the prompt text and the engine's handling of the results;
# this runs the commands. Hermetic: every repo lives under mktemp, the global git config is /dev/null, the
# identity comes from env vars, and the caller's GIT_DIR & co. are unset first.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
root=$(pwd -P)
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c init.defaultBranch=master "$@"; }
BR=audit-fix/task-a
SLUG=proj-task-a
REF="refs/integration-anchor/$BR"

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# render <what> <repo> [A TB [M HD BS]]: one rendered step, as the engine renders it for task $SLUG on a
# `master` repo. what: setup (with the env bootstrap ENVB when set), setup-nb (the judge's: no bootstrap),
# setup-ff (the seeded reviser's: bootstrap and the fast-forward to origin/$BR), merge, judge, reads (A..HD),
# recipe. A setup block is its indented command lines, as an agent runs them.
render() {
  node --input-type=module -e "
    import { loadEngine } from './tests/lib/engine.mjs'
    const T = loadEngine(['branchTreeSetup', 'integrationMergeStep', 'integrationJudgeCheck', 'integrationMergeReads', 'ANCHOR_RECIPE'])
    const [what, repo, A, TB, M, HD, BS] = process.argv.slice(1)
    const a = { repoPath: repo, defaultBranch: 'master', ...(process.env.ENVB ? { envBootstrap: process.env.ENVB } : {}) }
    const task = { slug: '$SLUG', scope: 'cross-cutting' }
    let out
    if (what === 'setup' || what === 'setup-nb' || what === 'setup-ff') {
      const l = T.branchTreeSetup(a, task, what !== 'setup-nb', what === 'setup-ff').split('\n').slice(1)
      out = l.slice(0, l.findIndex((x) => !x.startsWith('  '))).join('\n')
    } else if (what === 'merge') out = T.integrationMergeStep(a, task, { headSha: A, taskBase: TB })
    else if (what === 'judge') out = T.integrationJudgeCheck(a, task, { headSha: A, taskBase: TB }, { mergeCommit: M || '', headSha: HD, baseSha: BS })
    else if (what === 'reads') out = T.integrationMergeReads(a, task, { headSha: A }, { headSha: HD })
    else out = T.ANCHOR_RECIPE
    process.stdout.write(out + '\n')
  " "$@"
}

suite() {
  local sh="$1" n base
  n=$(basename "${sh%% *}"); base="$tmp/$n"; mkdir -p "$base"
  local F R wt TB H0 B out rc M M1 M2 RH LH JR XS A17 A18 P Bm MOWN HA NH OH before

  # mk <name>: a fresh fixture — origin o.git (master: base.txt, a.txt), a pusher clone p, the task branch
  # $BR (one commit on a.txt) pushed, and the project's checkout R with no local $BR. TB is the task's base,
  # H0 its approved head; wt is the task tree's path.
  mk() {
    F="$base/$1"; mkdir -p "$F"; F=$(cd "$F" && pwd -P)
    g init -q --bare "$F/o.git"
    g clone -q "$F/o.git" "$F/p" 2>/dev/null
    printf 'base\n' > "$F/p/base.txt"; printf 'l1\nl2\nl3\n' > "$F/p/a.txt"
    g -C "$F/p" add . && g -C "$F/p" commit -q -m base && g -C "$F/p" push -q origin master
    TB=$(git -C "$F/p" rev-parse HEAD)
    g -C "$F/p" checkout -q -b "$BR"
    printf 'l1\nl2 task\nl3\n' > "$F/p/a.txt"; g -C "$F/p" commit -qam task; g -C "$F/p" push -q origin "$BR"
    H0=$(git -C "$F/p" rev-parse HEAD)
    g -C "$F/p" checkout -q master
    g clone -q "$F/o.git" "$F/repo" 2>/dev/null; R=$(cd "$F/repo" && pwd -P)
    wt="$R/.claude/worktrees/$SLUG"
  }
  # main <file> <content>: a commit on origin's master; B is its new tip.
  main() { g -C "$F/p" checkout -q master; printf '%s\n' "$2" > "$F/p/$1"; g -C "$F/p" add "$1"; g -C "$F/p" commit -q -m "main $1"; g -C "$F/p" push -q origin master; B=$(git -C "$F/p" rev-parse HEAD); }
  # bcommit <file> <content>: a commit on origin's $BR (a repair or revise), made from the pusher.
  bcommit() { g -C "$F/p" fetch -q origin; g -C "$F/p" checkout -q -B "$BR" "origin/$BR"; printf '%s\n' "$2" > "$F/p/$1"; g -C "$F/p" add "$1"; g -C "$F/p" commit -q -m "branch $1"; g -C "$F/p" push -q origin "$BR"; g -C "$F/p" checkout -q master; }
  # run <script> [VAR=val …]: run from outside the repo as a direct child of this shell (so $PPID is this
  # test's live pid); stdout+stderr in $out, exit status in $rc.
  run() { local s="$1"; shift; cd "$base" && env "$@" $sh -c "$s" > "$base/out" 2>&1; rc=$?; cd "$root"; out=$(cat "$base/out"); }
  setup() { run "$(render setup "$R")"; }
  setupff() { run "$(render setup-ff "$R")"; }
  reads() { run "$(render reads "$R" "$1" "" "" "$2")"; }
  merge() { run "$(render merge "$R" "$1" "$2")"; }
  recipe() { run "WT=\"$1\"; BR=\"$BR\"; D=origin/master; git -C \"$1\" fetch -q origin; H=\$(git -C \"$1\" rev-parse \"origin/$BR\"); $(render recipe)"; }
  lockpid() { grep -oE 'pid [0-9]+' "$R/.git/worktrees/$SLUG/locked" 2>/dev/null | grep -oE '[0-9]+' | head -1; }
  hasref() { git -C "$R" rev-parse -q --verify "$REF" 2>/dev/null || echo none; }
  hd() { git -C "$wt" rev-parse HEAD; }
  toplevel() { printf '%s\n' "$out" | tail -1; }

  # ---- branchTreeSetup ---------------------------------------------------------------------------------

  # 2. no local $BR: the --track arm puts the tree on $BR at origin's head, tracking it, locked live
  mk s2; setup
  ok "$(git -C "$wt" symbolic-ref -q --short HEAD)|$(hd)" "$BR|$H0" "$n 2: the --track arm creates the tree on $BR at origin/$BR"
  ok "$(git -C "$wt" rev-parse --abbrev-ref '@{u}')" "origin/$BR" "$n 2: … tracking origin/$BR"
  ok "$(toplevel)" "$wt" "$n 2: … the toplevel line prints the tree"
  has "$out" "tree head: $H0" "$n 2: … and prints tree head:"
  ok "$(lockpid)" "$$" "$n 2: … locked with the live pid"
  ok "$(git -C "$R" rev-parse --abbrev-ref HEAD)" master "$n 2: … the main checkout stays on master (never a branch cut from it)"

  # 1. self-heal: a locked tree deleted by hand is unlocked, pruned and re-attached from the local branch
  rm -rf "$wt"
  out=$(git -C "$R" worktree add "$wt" "$BR" 2>&1); has "$out" "missing but locked" "$n 1: a bare worktree add fails on the deleted locked tree (the hazard)"
  setup
  ok "$(toplevel)|$(git -C "$wt" symbolic-ref -q --short HEAD)|$(hd)" "$wt|$BR|$H0" "$n 1: the setup self-heals and re-attaches the local $BR"
  ok "$(lockpid)" "$$" "$n 1: … locked again"

  # 4. a detached tree (or one on another branch) is put back on $BR
  git -C "$wt" checkout -q --detach; setup
  ok "$(git -C "$wt" symbolic-ref -q --short HEAD)" "$BR" "$n 4: a detached tree goes back onto $BR"
  git -C "$wt" checkout -q -b other; setup
  ok "$(git -C "$wt" symbolic-ref -q --short HEAD)" "$BR" "$n 4: … and so does a tree on another branch"

  # 3. neither $BR nor origin/$BR: STOP, no tree, no branch cut from master
  mk s3; git -C "$F/o.git" branch -q -D "$BR"; git -C "$R" update-ref -d "refs/remotes/origin/$BR"; setup
  has "$out" "tree NOT attached: neither $BR nor origin/$BR exists — STOP" "$n 3: neither branch → the STOP line"
  ok "$([ -e "$wt" ] && echo tree)|$(git -C "$R" show-ref --verify --quiet "refs/heads/$BR" && echo branch)" "|" "$n 3: … no tree and no branch created"
  lacks "$out" "tree head:" "$n 3: … and no tree head line"

  # 5. the env bootstrap runs inside the guard only, last; the judge's setup never runs it
  mk s5
  run "$(ENVB='touch BOOTSTRAP' render setup "$R")"
  ok "$([ -e "$wt/BOOTSTRAP" ] && echo yes)|$(find "$F" -name BOOTSTRAP | grep -vc "^$wt/")" "yes|0" "$n 5: the bootstrap runs in the task tree and nowhere else"
  ok "$(lockpid)" "$$" "$n 5: … with the live-pid lock taken first"
  rm -f "$wt/BOOTSTRAP"
  run "$(ENVB='touch BOOTSTRAP' render setup-nb "$R")"
  ok "$(find "$F" -name BOOTSTRAP | wc -l | tr -d ' ')" 0 "$n 5: the judge's setup (no bootstrap) never runs it"
  mkdir -p "$R/.claude/worktrees/plain"
  run "$(ENVB='touch BOOTSTRAP' render setup "$R" | sed "s|worktrees/$SLUG|worktrees/plain|")"
  ok "$(find "$F" -name BOOTSTRAP | wc -l | tr -d ' ')" 0 "$n 5: a stale plain dir → no bootstrap anywhere"

  # ---- integrationMergeStep -------------------------------------------------------------------------------

  # 6. an unmoved base: merge: up-to-date, no commit, the anchor recorded
  mk m6; setup; merge "$H0" "$TB"
  ok "$rc" 0 "$n 6: up-to-date exits 0"
  has "$out" "merge: up-to-date" "$n 6: merge: up-to-date"
  has "$out" "anchor: $H0 base $TB" "$n 6: … the anchor: line"
  has "$out" "task head: $H0" "$n 6: … task head:"
  has "$out" "integration base: $TB" "$n 6: … integration base: is the task's base"
  has "$out" "task file: a.txt" "$n 6: … task file: a.txt"
  ok "$(hd)" "$H0" "$n 6: … and no commit"
  ok "$(hasref)" "$H0" "$n 6: the first run records the anchor ref"

  # 7. main moved: merge: merged <M> with parents (H, B) and the Integration subject; main file: lines
  main m.txt m1; merge "$H0" "$TB"
  M=$(hd)
  has "$out" "merge: merged $M" "$n 7: merge: merged <M>"
  ok "$(git -C "$wt" rev-parse "$M^1") $(git -C "$wt" rev-parse "$M^2")" "$H0 $B" "$n 7: … parents (H, B)"
  ok "$(git -C "$wt" log -1 --format=%s "$M")" "Merge origin/master into $BR (Integration)" "$n 7: … the Integration subject"
  has "$out" "main file: m.txt" "$n 7: … main file: m.txt"
  lacks "$out" "task file: m.txt" "$n 14: task file: never lists main's files"

  # 16. a rerun with A passes; a rerun with A = M is an anchor mismatch, and the ref is unchanged
  git -C "$wt" push -q origin "$BR"
  merge "$H0" "$TB"
  has "$out" "merge: already-merged $M" "$n 16: a rerun with the recorded anchor passes (already-merged M)"
  merge "$M" "$TB"
  ok "$rc" 3 "$n 16: A = the merge commit exits 3"
  has "$out" "merge step STOP: anchor mismatch: recorded $H0, passed $M — pass the recorded anchor" "$n 16: … anchor mismatch, naming the recorded value"
  ok "$(hasref)" "$H0" "$n 16: … and the ref is unchanged"

  # 19. after a merge plus a revise commit: the revise file is a task file; main file: = TB..B
  bcommit r.txt revise; merge "$H0" "$TB"
  has "$out" "task file: r.txt" "$n 19: a revise commit's file appears in task file:"
  ok "$(printf '%s\n' "$out" | grep '^main file: ' | sed 's/^main file: //' | sort | tr '\n' ' ')" "$(git -C "$wt" diff --name-only "$TB" "$B" | sort | tr '\n' ' ')" "$n 19: main file: lines are exactly TB..B"

  # 12. a pushed repair commit is fast-forwarded into the tree
  bcommit fix.txt repair; RH=$(git -C "$F/o.git" rev-parse "$BR")
  merge "$H0" "$TB"
  ok "$(hd)" "$RH" "$n 12: a pushed repair commit is fast-forwarded"
  has "$out" "task head: $RH" "$n 12: … and is the task head"

  # 9. already-merged: the newest first-parent merge whose second parent is in B
  main m2.txt m2; merge "$H0" "$TB"; M2=$(hd); git -C "$wt" push -q origin "$BR"
  merge "$H0" "$TB"
  has "$out" "merge: already-merged $M2" "$n 9: already-merged picks the newest qualifying merge (M2, not M)"

  # 20. ANCHOR_RECIPE: the ref when present; with no ref (a fresh checkout), the commit before the oldest merge
  recipe "$wt"; ok "$out" "anchor $H0" "$n 20: with the ref present the recipe prints it"
  g clone -q "$F/o.git" "$F/fresh" 2>/dev/null
  recipe "$F/fresh"; ok "$out" "anchor $H0" "$n 20: with no ref, after a merge plus a revise, it prints the commit before the oldest merge"
  mk m20; recipe "$R"; ok "$out" "anchor $H0" "$n 20: with no merge it prints the head"

  # 21. the judge check: ok when everything is readable; FAIL on a missing object, a mismatch or a stale ref
  mk j21; g clone -q "$F/o.git" "$F/j" 2>/dev/null; JR=$(cd "$F/j" && pwd -P)
  setup; main m.txt m1; merge "$H0" "$TB"; M=$(hd); git -C "$wt" push -q origin "$BR"
  run "$(render judge "$R" "$H0" "$TB" "$M" "$M" "$B")"
  ok "$out" "judge check: ok" "$n 21: judge check: ok when every object is present"
  run "$(render judge "$R" "$H0" "$TB" "$M" "$M" "$(printf 'd%.0s' $(seq 40))")"
  has "$out" "judge check: FAIL cannot read the integration commits: $(printf 'd%.0s' $(seq 40))" "$n 21: FAIL when an object is missing after the fetch"
  run "$(render judge "$R" "$TB" "$TB" "$M" "$M" "$B")"
  has "$out" "judge check: FAIL anchor mismatch: recorded $H0, passed $TB" "$n 21: FAIL on an anchor mismatch"
  ok "$(git -C "$JR" cat-file -e "$M^{commit}" 2>/dev/null && echo has)" "" "$n 21: (an older checkout lacks the merge commit)"
  run "$(render judge "$JR" "$H0" "$TB" "$M" "$M" "$B" | sed "s|$JR/.claude/worktrees/$SLUG|$JR|")"
  ok "$out|$(git -C "$JR" rev-parse -q --verify "$REF" || echo none)" "judge check: ok|none" "$n 21: a checkout without the objects fetches them, and the check never writes the ref"
  XS=$(g -C "$R" commit-tree -p "$TB" -m off-branch "$TB^{tree}")
  git -C "$R" update-ref "$REF" "$XS" "$H0"
  run "$(render judge "$R" "$H0" "$TB" "$M" "$M" "$B")"
  has "$out" "judge check: FAIL stale anchor ref $XS is not on $BR" "$n 21: FAIL on a stale ref"

  # 8. a conflict: the conflict: lines, MERGE_HEAD kept
  mk m8; setup; main a.txt 'l1
l2 main
l3'; merge "$H0" "$TB"
  ok "$rc" 0 "$n 8: a conflict exits 0 (the integrator resolves it)"
  has "$out" "merge: conflict" "$n 8: merge: conflict"
  has "$out" "conflict: a.txt" "$n 8: … conflict: a.txt"
  ok "$(git -C "$wt" rev-parse -q --verify MERGE_HEAD)" "$B" "$n 8: … MERGE_HEAD is kept"

  # 10. a merge left in progress is aborted before anything else
  merge "$H0" "$TB"
  has "$out" "aborted: a merge left in progress" "$n 10: a merge left in progress is aborted"
  has "$out" "merge: conflict" "$n 10: … and the step runs on"

  # 11. tracked changes a dead integrator left behind: stashed (never discarded), and the step runs on — so
  #     neither the in-run retry nor a re-entry wedges on them
  git -C "$wt" merge --abort; echo dirty >> "$wt/base.txt"
  merge "$H0" "$TB"
  ok "$rc|$(hd)" "0|$H0" "$n 11: tracked leftovers → exit 0, HEAD unchanged"
  has "$out" "stashed: integration leftovers $H0" "$n 11: … the stashed: line names the head"
  has "$out" "merge: conflict" "$n 11: … and the step runs on to its merge line"
  lacks "$out" "merge step STOP" "$n 11: … with no STOP"
  ok "$(git -C "$wt" stash list -n 1 --format=%s)" "On $BR: integration leftovers $H0" "$n 11: … the leftovers are in the stash"
  has "$(git -C "$wt" stash show -p 'stash@{0}')" "+dirty" "$n 11: … with their content"
  ok "$(grep -c dirty "$wt/base.txt")" 0 "$n 11: … and gone from the tree"
  git -C "$wt" merge --abort

  # 13. a diverged branch: STOP, never a force
  g -C "$wt" commit -q --allow-empty -m local; LH=$(hd)
  bcommit d.txt other
  merge "$H0" "$TB"
  ok "$rc|$(hd)" "3|$LH" "$n 13: a diverged branch → exit 3, HEAD unchanged"
  has "$out" "merge step STOP: $BR has diverged from origin/$BR" "$n 13: … and the STOP line"

  # 15. a task base that is not merge-base(A, B): STOP (18: an older one too)
  mk m15; setup; main m.txt m1
  merge "$H0" "$B"
  ok "$rc" 3 "$n 15: TB later on main (not an ancestor of A) → exit 3"
  has "$out" "merge step STOP: taskBase $B is not merge-base($H0, origin/master) = $TB" "$n 15: … naming the real merge-base"
  ok "$(hasref)" none "$n 15: … and no ref is written"
  # 18: a TB older than the task's base — the task branch is rebuilt on a later master
  mk m18; main pre.txt pre; g -C "$F/p" checkout -q -B "$BR" master; echo t > "$F/p/t.txt"; g -C "$F/p" add t.txt; g -C "$F/p" commit -qm task2; g -C "$F/p" push -q -f origin "$BR"
  A18=$(git -C "$F/p" rev-parse HEAD); g -C "$F/p" checkout -q master; setup
  merge "$A18" "$TB"
  ok "$rc" 3 "$n 18: TB older than merge-base(A, B) → exit 3"
  has "$out" "is not merge-base($A18, origin/master) = $B" "$n 18: … naming the real merge-base"

  # 17. no ref, and an anchor that holds a merge: STOP, no ref written
  mk m17; main m.txt m1; g -C "$F/p" checkout -q "$BR"; g -C "$F/p" merge -q --no-ff -m "own merge" master; g -C "$F/p" push -q origin "$BR"
  A17=$(git -C "$F/p" rev-parse HEAD); g -C "$F/p" checkout -q master; setup
  merge "$A17" "$B"
  ok "$rc" 3 "$n 17: an anchor holding a merge → exit 3"
  has "$out" "merge step STOP: anchor $A17 carries a merge — ANCHOR_RECIPE gives $H0" "$n 17: … the STOP names the recipe's anchor"
  ok "$(hasref)" none "$n 17: … and no ref is written"

  # 22. the task's own run merged main: the recipe gives P (the commit before that merge); passing the
  #     approved head STOPs naming P; passing (P, merge-base(P, B)) records the ref and reports already-merged
  mk m22; P=$H0; main m.txt m1; Bm=$B
  g -C "$F/p" checkout -q "$BR"; g -C "$F/p" merge -q --no-ff -m "own merge" master; MOWN=$(git -C "$F/p" rev-parse HEAD)
  echo c2 > "$F/p/c2.txt"; g -C "$F/p" add c2.txt; g -C "$F/p" commit -qm c2; g -C "$F/p" push -q origin "$BR"
  HA=$(git -C "$F/p" rev-parse HEAD); g -C "$F/p" checkout -q master; setup
  recipe "$wt"; ok "$out" "anchor $P" "$n 22: the recipe prints P, the commit before the own-run merge"
  merge "$HA" "$Bm"
  ok "$rc" 3 "$n 22: passing the approved head → exit 3"
  has "$out" "anchor $HA carries a merge — ANCHOR_RECIPE gives $P" "$n 22: … naming R = P"
  ok "$(hasref)" none "$n 22: … and writes no ref"
  merge "$P" "$TB"
  ok "$rc" 0 "$n 22: passing (P, merge-base(P, B)) passes"
  has "$out" "merge: already-merged $MOWN" "$n 22: … already-merged <M_own> while main is unmoved"
  ok "$(hasref)" "$P" "$n 22: … and records the ref"
  main m3.txt m3; merge "$P" "$TB"
  has "$out" "merge: merged $(hd)" "$n 22: … merged once main has moved"

  # 23. the branch is recut with the old ref left behind: STOP stale anchor ref; the recipe says stale-ref;
  #     after deleting the ref the recipe gives the new head and the merge step passes
  mk m23; setup; merge "$H0" "$TB"; ok "$(hasref)" "$H0" "$n 23: the ref is recorded"
  g -C "$F/p" checkout -q -B "$BR" master; echo recut > "$F/p/recut.txt"; g -C "$F/p" add recut.txt; g -C "$F/p" commit -qm recut
  g -C "$F/p" push -q -f origin "$BR"; NH=$(git -C "$F/p" rev-parse HEAD); g -C "$F/p" checkout -q master
  git -C "$wt" fetch -q origin; git -C "$wt" reset -q --hard "origin/$BR"
  merge "$NH" "$TB"
  ok "$rc" 3 "$n 23: a recut branch with the old ref → exit 3"
  has "$out" "merge step STOP: stale anchor ref $H0 is not on $BR (branch recut or rewritten) — delete it: git update-ref -d $REF $H0" "$n 23: … the stale-ref STOP naming the fix"
  ok "$(hasref)" "$H0" "$n 23: … and the ref is unchanged"
  recipe "$wt"; ok "$out" "stale-ref $H0" "$n 23: the recipe prints stale-ref <X>"
  git -C "$R" update-ref -d "$REF" "$H0"
  recipe "$wt"; ok "$out" "anchor $NH" "$n 23: after deleting the ref the recipe prints the new head"
  merge "$NH" "$TB"
  ok "$rc" 0 "$n 23: … and the merge step passes"
  ok "$(hasref)" "$NH" "$n 23: … recording the new anchor"

  # 24. two merges: Integration 1 resolves a conflict and pushes M1 (its judge then dies); main moves and the
  #     re-entry merges M2 on top. The judge's reads list BOTH merges from the anchor, each with its own
  #     resolution (show --cc) and its remerge diff, not only the newest
  mk r24; setup; main a.txt 'l1
l2 main
l3'; merge "$H0" "$TB"
  printf 'l1\nl2 task main\nl3\n' > "$wt/a.txt"; git -C "$wt" add a.txt; git -C "$wt" commit -q --no-edit
  M1=$(hd); git -C "$wt" push -q origin "$BR"
  main m.txt m1; merge "$H0" "$TB"; M2=$(hd); git -C "$wt" push -q origin "$BR"
  has "$out" "merge: merged $M2" "$n 24: (the re-entry merges M2 on top of M1)"
  reads "$H0" "$M2"
  has "$out" "=== merge $M2" "$n 24: the reads list the newest merge M2"
  has "$out" "=== merge $M1" "$n 24: … and the earlier, unjudged M1"
  has "$out" "=== 2 first-parent merge(s) in $H0..$M2" "$n 24: … two merges in all"
  has "$out" "diff --cc a.txt" "$n 24: … M1's own resolution (show --cc)"
  has "$out" "=== remerge diff $M1" "$n 24: … and its remerge diff"
  has "$out" "-<<<<<<<" "$n 24: … against git's automatic merge, conflict markers and all"
  reads "$H0" "$M1"
  ok "$(printf '%s\n' "$out" | grep -c '^=== merge ')|$(printf '%s\n' "$out" | tail -1)" "1|=== 1 first-parent merge(s) in $H0..$M1" "$n 24: a range ending at M1 lists M1 alone"
  reads "$TB" "$H0"
  ok "$out" "=== 0 first-parent merge(s) in $TB..$H0" "$n 24: no merge in the range → the count line only"

  # 25. the seeded reviser's setup fast-forwards to origin/$BR; a divergence STOPs; the integrator's never moves
  mk r25; setup; bcommit int.txt integrated; OH=$(git -C "$F/o.git" rev-parse "$BR")
  setup
  ok "$(hd)" "$H0" "$n 25: the integrator's setup leaves a reused tree where it was (its merge step fast-forwards)"
  lacks "$out" "fast-forwarded" "$n 25: … and prints no fast-forward line"
  setupff
  ok "$(hd)" "$OH" "$n 25: the seeded reviser's setup fast-forwards to origin/$BR"
  has "$out" "tree head: $OH" "$n 25: … and tree head: is the new head"
  lacks "$out" "STOP" "$n 25: … with no STOP"
  g -C "$wt" commit -q --allow-empty -m unpushed; LH=$(hd); setupff
  ok "$(hd)" "$LH" "$n 25: local commits origin lacks (a dead reviser's unpushed work) stay"
  lacks "$out" "STOP" "$n 25: … with no STOP"
  bcommit d.txt other; setupff
  ok "$(hd)" "$LH" "$n 25: a diverged branch is left as it was"
  has "$out" "tree NOT fast-forwarded: $BR has diverged from origin/$BR — never rebase or force-push; STOP" "$n 25: … and the STOP line"

  # 26. (p14-3) a modified tracked file the fast-forward would touch is never autostashed: under
  #     merge.autoStash=true a bare `merge --ff-only` stashes it, moves the tree and re-applies it on top
  #     (cleanly here: the edit is l3, origin's is l1), so the seeded reviser would build on a tree that
  #     silently carried the change across. --no-autostash makes git refuse: the STOP line, the tree where
  #     it was, the edit in place and no stash entry.
  mk r26; setup; bcommit a.txt "$(printf 'l1 integrated\nl2 task\nl3')"; OH=$(git -C "$F/o.git" rev-parse "$BR")
  printf 'l1\nl2 task\nl3 dirty\n' > "$wt/a.txt"; git -C "$wt" config merge.autoStash true
  setupff
  has "$out" "tree NOT fast-forwarded to origin/$BR: local changes in the way — STOP" "$n 26: a dirty tracked file under merge.autoStash → the STOP line"
  ok "$(hd)" "$H0" "$n 26: … the tree is not moved"
  ok "$(cat "$wt/a.txt")" "$(printf 'l1\nl2 task\nl3 dirty')" "$n 26: … the modified file is left in place, unmerged"
  ok "$(git -C "$wt" stash list | wc -l | tr -d ' ')" 0 "$n 26: … and nothing was stashed"
  git -C "$wt" checkout -q -- a.txt; setupff
  ok "$(hd)" "$OH" "$n 26: once the change is gone the same setup fast-forwards"
  lacks "$out" "STOP" "$n 26: … with no STOP"

  # GIT_DIR inherited: the merge step's scrub keeps a decoy untouched
  mk e1; setup; g init -q "$F/decoy"; g -C "$F/decoy" commit -q --allow-empty -m decoy
  before=$(git -C "$F/decoy" for-each-ref; git -C "$F/decoy" config --get core.bare)
  run "$(render merge "$R" "$H0" "$TB")" GIT_DIR="$F/decoy/.git"
  ok "$(git -C "$F/decoy" for-each-ref; git -C "$F/decoy" config --get core.bare)" "$before" "$n e1: an inherited GIT_DIR never reaches the decoy"
  has "$out" "merge: up-to-date" "$n e1: … and the step ran on the task tree"
}

for sh in "${shells[@]}"; do suite "$sh"; done

# The rendered steps never force anything.
all=$(render setup /r; render setup-ff /r; render reads /r "$(printf 'a%.0s' $(seq 40))" "" "" "$(printf 'c%.0s' $(seq 40))"; render merge /r "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))"; render judge /r "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" "$(printf 'c%.0s' $(seq 40))" "$(printf 'c%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))"; render recipe)
ok "$(printf '%s\n' "$all" | grep -cE -- '--force|force-with-lease|push +-f\b|\+refs/|\+HEAD')" 0 "no force flag in any rendered step"

echo; [ "$fail" -eq 0 ] && echo "integration-tree: ALL PASS" || echo "integration-tree: SOME FAILED"
exit "$fail"
