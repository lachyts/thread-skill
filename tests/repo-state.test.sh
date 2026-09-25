#!/usr/bin/env bash
# skills/close/scripts/repo-state.sh and its two snippets in skills/close/SKILL.md step 2.
# Section A runs the script against fixture repos cloned from a local bare origin made with `-b master`,
# under a pinned `init.defaultBranch=main` (passed through GIT_CONFIG_COUNT, the channel the script keeps):
# the script must still say `master`, never guess `main`, never touch the network, never write a ref.
# Section B greps close's prose (step 2, 6, 8, § Guardrails, § Edge cases). Section C extracts the
# `# thread:repo-state` and `# thread:repo-track` snippets by their markers and runs them under bash and,
# when zsh is installed, under `zsh -f` (the Bash tool is zsh).
# Hermetic: every repo and task fixture lives under mktemp, HOME is a temp dir, the caller's GIT_DIR & co.
# are unset, and no global or system git config is read. bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)

root=$(pwd -P)
script=$root/skills/close/scripts/repo-state.sh
CLOSE=skills/close/SKILL.md

# A failed mktemp must stop the run here: `cd ""` succeeds and stays put, so $tmp would be this checkout and
# the EXIT trap would rm -rf it. The trap goes in only once $tmp is proven to be a fresh directory.
tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ] || [ "$tmp" = "$(pwd -P)" ]; then echo "FAIL - mktemp gave no usable temp dir [$tmp]"; exit 1; fi
trap 'chmod -R u+rwX "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
mkdir -p "$tmp/h"

# Fixture git: no global or system config, `main` as the init default, a throwaway identity.
g() { GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c init.defaultBranch=main -c user.name=t -c user.email=t@t "$@"; }
commits() { local d=$1 n=$2 i=1; while [ "$i" -le "$n" ]; do g -C "$d" commit -q --allow-empty -m "c$i" || return 1; i=$((i+1)); done; }

# The environment every script run gets: temp HOME, no global/system config, and `main` as the init
# default through GIT_CONFIG_COUNT (tests/run.sh's `init.defaultBranch main` would otherwise be discarded
# by GIT_CONFIG_GLOBAL=/dev/null).
base_env=(HOME="$tmp/h" GIT_CEILING_DIRECTORIES="$tmp" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
          GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=main)

# rs <cwd> [VAR=value …] [-- args …] → $out, $err, $rc.
rs() {
  local cwd=$1; shift
  local extra=() args=()
  while [ $# -gt 0 ]; do
    if [ "$1" = -- ]; then shift; args=("$@"); break; fi
    extra+=("$1"); shift
  done
  out=$(cd "$cwd" && env "${base_env[@]}" ${extra[@]+"${extra[@]}"} bash "$script" ${args[@]+"${args[@]}"} 2>"$tmp/err"); rc=$?
  err=$(cat "$tmp/err")
}
first() { printf '%s\n' "$1" | head -n 1; }
starts() { case "$(first "$1")" in "$2"*) ok y y "$3";; *) ok "$(first "$1")" "$2…" "$3";; esac; }
clean0() {  # clean0 <expected stdout> <label>: exit-0 path, exact stdout, empty stderr
  ok "$out" "$1" "$2: stdout"
  ok "$err" "" "$2: stderr empty"
  ok "$rc" 0 "$2: rc 0"
}

unres() { echo "on $1, default branch unresolved — unmerged check skipped"; }

# ==== Section A: the script ===============================================================================
if [ ! -f "$script" ]; then
  ok missing present "script exists at skills/close/scripts/repo-state.sh"
  echo "SKIP - Section A (no script)"
else
  ok present present "script exists at skills/close/scripts/repo-state.sh"
  ok "$([ -x "$script" ] && echo y)" y "the script is executable"

  # ---- harness self-check: the script's own scrub keeps the GIT_CONFIG_COUNT channel ----------------------
  scrub=$(grep -E '^for v in \$\(git rev-parse --local-env-vars\)' "$script")
  ok "$(printf '%s\n' "$scrub" | grep -c .)" 1 "the script has exactly one scrub line"
  pinned=$(cd "$tmp" && env "${base_env[@]}" bash -c "$scrub
git config init.defaultBranch" 2>/dev/null)
  ok "$pinned" main "after the script's scrub, init.defaultBranch is still main (the pin reaches the script)"

  # ---- fixtures -------------------------------------------------------------------------------------------
  g init -q --bare -b master "$tmp/o.git"
  g clone -q "$tmp/o.git" "$tmp/seed" 2>/dev/null
  g -C "$tmp/seed" symbolic-ref HEAD refs/heads/master
  commits "$tmp/seed" 1 && g -C "$tmp/seed" push -q origin master 2>/dev/null
  ok "$(g -C "$tmp/seed" symbolic-ref -q refs/remotes/origin/HEAD || echo unset)" unset "seed has no origin/HEAD (precondition)"
  g -C "$tmp/seed" branch main
  g -C "$tmp/seed" checkout -q -b feat/y && commits "$tmp/seed" 1
  ok "$(g -C "$tmp/seed" show-ref --verify -q refs/heads/main && echo y)" y "seed has a stray local main (precondition)"

  g clone -q "$tmp/o.git" "$tmp/work"
  ok "$(g -C "$tmp/work" symbolic-ref -q refs/remotes/origin/HEAD)" refs/remotes/origin/master "work's origin/HEAD → origin/master (precondition)"
  g -C "$tmp/work" checkout -q -b feat/x && commits "$tmp/work" 2
  mkdir -p "$tmp/work/sub"
  for c in w1 w4 w6 w7 w13 wa wb wc "my repo"; do g clone -q "$tmp/o.git" "$tmp/$c"; done
  mkdir -p "$tmp/plain"

  snap() { g -C "$1" for-each-ref --format='%(refname) %(objectname) %(symref)'; }
  work_before=$(snap "$tmp/work"); seed_before=$(snap "$tmp/seed")

  L2="on feat/x, 2 commit(s) unmerged to master"

  # 1. on master
  rs "$tmp/w1"; clean0 "" "1. on master → nothing"

  # 2. a feature branch with 2 commits
  rs "$tmp/work"; clean0 "$L2" "2. feat/x with 2 commits"

  # 3. the [<dir>] argument
  rs "$tmp" -- "$tmp/work"; clean0 "$L2" "3a. cwd outside git, the repo as the argument"
  rs "$tmp/work/sub"; clean0 "$L2" "3b. cwd a subdirectory, no argument"

  # 4. a stray local main
  g -C "$tmp/w4" branch main
  g -C "$tmp/w4" checkout -q -b feat/z && commits "$tmp/w4" 1
  rs "$tmp/w4"; clean0 "on feat/z, 1 commit(s) unmerged to master" "4. a stray local main still says master"

  # 5. no origin/HEAD (seed, on feat/y since its fixture, also has a stray local main)
  rs "$tmp/seed"; clean0 "$(unres feat/y)" "5a. no origin/HEAD and a stray local main, on a feature branch → unresolved, never main"
  g -C "$tmp/seed" checkout -q master
  rs "$tmp/seed"; clean0 "$(unres master)" "5b. no origin/HEAD, on master → unresolved too"
  g -C "$tmp/seed" checkout -q feat/y

  # 6. a dangling origin/HEAD
  g -C "$tmp/w6" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
  g -C "$tmp/w6" checkout -q -b feat/v && commits "$tmp/w6" 1
  rs "$tmp/w6"; clean0 "$(unres feat/v)" "6. origin/HEAD → a missing origin/trunk → unresolved"

  # 7. origin/<default> gone, local <default> present
  g -C "$tmp/w7" update-ref -d refs/remotes/origin/master
  ok "$(g -C "$tmp/w7" symbolic-ref -q refs/remotes/origin/HEAD)" refs/remotes/origin/master "w7 keeps origin/HEAD (precondition)"
  g -C "$tmp/w7" checkout -q -b feat/w && commits "$tmp/w7" 3
  rs "$tmp/w7"; clean0 "on feat/w, 3 commit(s) unmerged to master" "7. counted against local master"

  # 8. merged and pushed (its own origin, so o.git never changes)
  g init -q --bare -b master "$tmp/o8.git"
  g clone -q "$tmp/o8.git" "$tmp/s8" 2>/dev/null
  g -C "$tmp/s8" symbolic-ref HEAD refs/heads/master
  commits "$tmp/s8" 1 && g -C "$tmp/s8" push -q origin master 2>/dev/null
  g clone -q "$tmp/o8.git" "$tmp/w8"
  g -C "$tmp/w8" checkout -q -b feat/m && commits "$tmp/w8" 1
  g -C "$tmp/w8" checkout -q master
  g -C "$tmp/w8" merge -q --no-ff -m merge feat/m
  g -C "$tmp/w8" push -q origin master 2>/dev/null
  g -C "$tmp/w8" checkout -q feat/m
  rs "$tmp/w8"; clean0 "" "8. feat/m merged and pushed → nothing"

  # 9. detached HEAD
  g -C "$tmp/w1" checkout -q --detach
  rs "$tmp/w1"; clean0 "" "9. detached HEAD → nothing"
  g -C "$tmp/w1" checkout -q master

  # 10. nothing to report: outside git, unborn, bare
  rs "$tmp/plain"; clean0 "" "10a. outside git → nothing (git's fatal does not leak)"
  g init -q "$tmp/unborn"
  rs "$tmp/unborn"; clean0 "" "10b. unborn branch → nothing"
  rs "$tmp" -- "$tmp/o.git"; clean0 "" "10c. a bare repo → nothing"

  # 11. a missing path
  rs "$tmp" -- "$tmp/nope"
  ok "$rc" 2 "11. a missing path → rc 2"; ok "$out" "" "11. stdout empty"
  starts "$err" "repo-state: no such directory" "11. stderr names the missing directory"

  # 12. two arguments
  rs "$tmp" -- "$tmp/work" "$tmp/seed"
  ok "$rc" 2 "12. two arguments → rc 2"; ok "$out" "" "12. stdout empty"
  starts "$err" "repo-state: usage:" "12. stderr is the usage line"

  # 13. a ref to a missing object: rev-list fails → exit 3, one line of our own
  g -C "$tmp/w13" checkout -q -b feat/u && commits "$tmp/w13" 1
  mkdir -p "$tmp/w13/.git/refs/remotes/origin"
  echo deadbeefdeadbeefdeadbeefdeadbeefdeadbeef > "$tmp/w13/.git/refs/remotes/origin/master"
  rs "$tmp/w13"
  ok "$rc" 3 "13. a missing object → rc 3"; ok "$out" "" "13. stdout empty"
  ok "$(printf '%s\n' "$err" | grep -c .)" 1 "13. stderr is exactly one line"
  starts "$err" "repo-state: rev-list failed (refs/remotes/origin/master)" "13. that line is repo-state's own"

  # 14. a path with a space
  g -C "$tmp/my repo" checkout -q -b feat/s && commits "$tmp/my repo" 1
  rs "$tmp/my repo"; clean0 "on feat/s, 1 commit(s) unmerged to master" "14. a repo path with a space"
  rs "$tmp" -- "$tmp/my repo"; clean0 "on feat/s, 1 commit(s) unmerged to master" "14. the same, as the argument"

  # 19. ambiguous short names: `symbolic-ref --short` would print heads/<br> or remotes/origin/<default>
  g -C "$tmp/wa" tag master && commits "$tmp/wa" 1
  ok "$(g -C "$tmp/wa" symbolic-ref -q --short HEAD)" heads/master "wa: a tag named master makes the short name ambiguous (precondition)"
  rs "$tmp/wa"; clean0 "" "19a. on master with a tag named master and a local commit ahead → nothing"
  g -C "$tmp/wb" checkout -q -b feat/a && commits "$tmp/wb" 1 && g -C "$tmp/wb" tag feat/a
  rs "$tmp/wb"; clean0 "on feat/a, 1 commit(s) unmerged to master" "19b. feat/a with a same-named tag → no heads/ prefix"
  g -C "$tmp/wc" branch origin/master 2>/dev/null
  g -C "$tmp/wc" checkout -q -b feat/x && commits "$tmp/wc" 2
  ok "$(g -C "$tmp/wc" symbolic-ref -q --short refs/remotes/origin/HEAD)" remotes/origin/master "wc: a local branch origin/master makes origin/HEAD's short name ambiguous (precondition)"
  rs "$tmp/wc"; clean0 "$L2" "19c. a local branch named origin/master → still resolves master"

  # Can this git fake a dubious-ownership repo? (16c and 17a need it.)
  dubious=n
  env "${base_env[@]}" GIT_TEST_ASSUME_DIFFERENT_OWNER=1 git -C "$tmp/work" rev-parse >/dev/null 2>&1 || dubious=y

  # 16. the scrub
  rs "$tmp/work" GIT_DIR="$tmp/seed/.git" GIT_WORK_TREE="$tmp/seed"
  clean0 "$L2" "16a. exported GIT_DIR/GIT_WORK_TREE are scrubbed; cwd decides"
  rs "$tmp/seed" GIT_DIR="$tmp/seed/.git" GIT_WORK_TREE="$tmp/seed" -- "$tmp/work"
  clean0 "$L2" "16b. exported GIT_DIR/GIT_WORK_TREE are scrubbed; the argument decides"
  # 16c. GIT_CONFIG_PARAMETERS is kept: a caller's safe.directory (protected, command-line config) lets the
  #      script open a repo git would otherwise refuse (17a's dubious ownership). Scrubbed, it would exit 3.
  if [ "$dubious" = y ]; then
    rs "$tmp/work" GIT_TEST_ASSUME_DIFFERENT_OWNER=1 GIT_CONFIG_PARAMETERS="'safe.directory'='*'"
    clean0 "$L2" "16c. a kept GIT_CONFIG_PARAMETERS safe.directory opens a dubious-ownership repo"
  else
    echo "SKIP - 16c: this git ignores GIT_TEST_ASSUME_DIFFERENT_OWNER"
  fi

  # 17. real git failures are exit 3, not silence
  if [ "$dubious" = y ]; then
    rs "$tmp/work" GIT_TEST_ASSUME_DIFFERENT_OWNER=1
    ok "$rc" 3 "17a. a repo git refuses to open (dubious ownership) → rc 3"; ok "$out" "" "17a. stdout empty"
    starts "$err" "repo-state: git cannot open" "17a. stderr says git cannot open it"
  else
    echo "SKIP - 17a: this git ignores GIT_TEST_ASSUME_DIFFERENT_OWNER (exit 3 stays covered by 13 and 17b)"
  fi
  cp -R "$tmp/work" "$tmp/c17"
  echo garbage > "$tmp/c17/.git/refs/remotes/origin/HEAD"
  rs "$tmp/c17"
  ok "$rc" 3 "17b. a garbage origin/HEAD → rc 3"; ok "$out" "" "17b. stdout empty"
  starts "$err" "repo-state: symbolic-ref origin/HEAD failed" "17b. stderr names the failed probe"

  # 18. static asserts on the script
  ok "$(grep -cE 'ls-remote|fetch|pull|push|set-head|remote update' "$script")" 0 "18. no network verb in the script"
  ok "$(grep -cw main "$script")" 0 "18. the word main appears nowhere in the script"
  ok "$(grep -c '\^{commit}' "$script")" 0 "18. no ^{commit} peel"
  # A git invocation is `git ` in command position: at the start of a line, or after `$(`, `;`, `|` or `&`.
  calls=$(grep -E '(^|[;|&(])[[:space:]]*git ' "$script" | grep -vE '^[[:space:]]*#' | grep -vF 'git rev-parse --local-env-vars')
  ok "$(printf '%s\n' "$calls" | grep -c .)" "$(printf '%s\n' "$calls" | grep -cF 'git -C "$dir"')" "18. every git call is git -C \"\$dir\""
  ok "$(printf '%s\n' "$calls" | grep -F 'git -C "$dir"' | grep -vc '2>')" 0 "18. every git -C \"\$dir\" call redirects git's stderr"
  ok "$(grep -cF 'GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS)' "$script")" 1 "18. the scrub keeps GIT_CONFIG_COUNT and GIT_CONFIG_PARAMETERS"
fi

# ==== Section B: close SKILL.md ==========================================================================
closetext=$(cat "$CLOSE")
rsline='rs="${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/repo-state.sh"'
ok "$(grep -cF "$rsline" "$CLOSE")" 1 "close cites the script as $rsline, exactly once"
has "$closetext" '-f "$rs"' "close guards the script with -f \"\$rs\""
step2=$(awk '/^2\. \*\*Check git state/{on=1} /^3\. /{on=0} on' "$CLOSE")
for phrase in 'check failed' 'never read as "no feature branch"' 'tracking unknown' 'command grep -rlF' 'in_progress'; do
  has "$step2" "$phrase" "step 2 says: $phrase"
done
step6=$(grep -E '^6\. ' "$CLOSE")
for phrase in 'Merge or retire' '§ The handoff owns the continuation' 'rule 1' '§ What remains' 'continuation' 'loose end' \
              'the unresolved line, `check failed` and `tracking unknown` are report-only and never a candidate'; do
  has "$step6" "$phrase" "step 6 says: $phrase"
done
step8=$(grep -E '^8\. \*\*Print the "What landed" report' "$CLOSE")
has "$step8" '— no `origin` remote, check skipped' "step 8 says: the no-origin row drops the set-head hint"
for phrase in 'Repo state: check failed (' '— tracked by [[' '— not tracked by any open task' 'continuation in' \
              '— tracking unknown (' 'git remote set-head origin --auto'; do
  has "$step8" "$phrase" "step 8 says: $phrase"
done
guard=$(awk '/^## Guardrails/{on=1; next} /^## /{on=0} on' "$CLOSE")
has "$guard" 'never merges, pushes, rebases or deletes a branch' "§ Guardrails: close never merges, pushes, rebases or deletes a branch"
edges=$(awk '/^## Edge cases/{on=1; next} /^## /{on=0} on' "$CLOSE")
for phrase in 'squash' 'unmerged to <default>' 'dubious ownership' 'tracking unknown' 'no `origin` remote' "No such remote 'origin'"; do
  has "$edges" "$phrase" "§ Edge cases says: $phrase"
done

# ==== Section C: the snippets, run =======================================================================
# extract <name> <outfile>: the indented fenced snippet between `# thread:<name>` and `# end thread:<name>`,
# dedented. Returns non-zero unless exactly one opener is followed by its closer.
extract() {
  local n=$1 o c
  o=$(grep -cE "^[[:space:]]*# thread:$n( |\$)" "$CLOSE"); c=$(grep -cE "^[[:space:]]*# end thread:$n\$" "$CLOSE")
  ok "$o" 1 "exactly one opening $n marker"; ok "$c" 1 "exactly one closing $n marker"
  awk -v n="$n" '
    { l=$0; sub(/^[ \t]+/, "", l) }
    l ~ ("^# thread:" n "( |$)") { on=1; ind=substr($0, 1, length($0)-length(l)); next }
    l == ("# end thread:" n) { if (on) closed=1; on=0 }
    on { if (index($0, ind) == 1) print substr($0, length(ind)+1); else print $0 }
    END { exit !closed }' "$CLOSE" > "$2"
  local paired=$?
  ok "$paired" 0 "the $n marker pair is closed and in order"
  [ "$paired" = 0 ] && [ "$o" = 1 ] && [ "$c" = 1 ]
}

shells=("bash")
command -v zsh >/dev/null 2>&1 && shells+=("zsh -f")

if extract repo-state "$tmp/snip-rs.sh" && [ -f "$script" ]; then
  # snip <shell> <cwd> [VAR=value …] → $out, $err, $rc; $1 is unquoted so "zsh -f" splits.
  snip() {
    local sh=$1 cwd=$2; shift 2
    out=$(cd "$cwd" && env "${base_env[@]}" "$@" $sh "$tmp/snip-rs.sh" 2>"$tmp/err"); rc=$?
    err=$(cat "$tmp/err")
  }
  for sh in "${shells[@]}"; do
    snip "$sh" "$tmp/work" CLAUDE_PLUGIN_ROOT="$root"; clean0 "$L2" "[$sh] repo-state snippet from work"
    snip "$sh" "$tmp/work" CLAUDE_PLUGIN_ROOT="$tmp/nowhere"
    ok "$rc" 2 "[$sh] repo-state snippet, script missing → rc 2"; ok "$out" "" "[$sh] script missing → stdout empty"
    starts "$err" "repo-state: script not found" "[$sh] script missing → stderr says so"
    out=$(cd "$tmp/work" && env -u CLAUDE_PLUGIN_ROOT "${base_env[@]}" $sh "$tmp/snip-rs.sh" 2>/dev/null); rc=$?
    ok "$rc" 2 "[$sh] repo-state snippet, CLAUDE_PLUGIN_ROOT unset → rc 2"
  done
else
  echo "SKIP - the repo-state snippet run (markers or script missing)"
fi

if extract repo-track "$tmp/snip-rt.sh"; then
  T="$tmp/h/repos/obsidian/Work/Tasks"
  mkdir -p "$T/Archive" "$tmp/h2"
  task() { printf -- '---\nstatus: %s\n---\n\n%s\n' "$2" "$3" > "$T/$1"; }
  task b-open.md open 'Branch `feat/x` holds the work.'
  task d-prog.md in_progress 'Pushed as origin/feat/x for review.'
  task a-sub.md open 'The follow-up lives on feat/x-2 only.'
  task c-done.md done 'Merged feat/x already.'
  task Archive/e.md open 'Nothing about branches here.'
  printf 'No front matter, but it names feat/x.\n' > "$T/f.md"
  task g-dot.md open 'The work sits on feat/p.'
  task h-ver.md open 'Release feat/q.1 shipped; see feat/q..'
  # The Claude Code Bash tool's grep is a shell-snapshot function (ugrep honouring .gitignore): the snippet
  # must bypass any grep function. A poisoned copy defines one that fails; `command grep` never calls it.
  { echo 'grep() { echo "poisoned grep" >&2; return 2; }'; cat "$tmp/snip-rt.sh"; } > "$tmp/snip-rt-fn.sh"
  # track <shell> [VAR=value …] → $out, $err, $rc
  track() {
    local sh=$1; shift
    out=$(cd "$tmp" && env HOME="$tmp/h" "$@" $sh "$tmp/snip-rt.sh" 2>"$tmp/err"); rc=$?
    err=$(cat "$tmp/err")
  }
  for sh in "${shells[@]}"; do
    track "$sh" br=feat/x;   ok "$out" b-open "[$sh] br=feat/x → b-open (sorted first; done, feat/x-2-only and no-front-matter excluded)"; ok "$rc" 0 "[$sh] br=feat/x → rc 0"
    track "$sh" br=feat/x-2; ok "$out" a-sub "[$sh] br=feat/x-2 → a-sub"; ok "$rc" 0 "[$sh] br=feat/x-2 → rc 0"
    track "$sh" br=feat/zz;  ok "$out" "" "[$sh] br=feat/zz → empty"; ok "$rc" 0 "[$sh] br=feat/zz → rc 0"
    track "$sh" br=feat/p;   ok "$out" g-dot "[$sh] br=feat/p → g-dot (a sentence-final period is a boundary)"; ok "$rc" 0 "[$sh] br=feat/p → rc 0"
    track "$sh" br=feat/q;   ok "$out" "" "[$sh] br=feat/q → empty (feat/q.1 and feat/q.. are other tokens)"; ok "$rc" 0 "[$sh] br=feat/q → rc 0"
    out=$(cd "$tmp" && env HOME="$tmp/h" br=feat/x $sh "$tmp/snip-rt-fn.sh" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err")
    clean0 b-open "[$sh] a grep shell function is bypassed"
    track "$sh" HOME="$tmp/h2" br=feat/x
    ok "$rc" 2 "[$sh] no task directory → rc 2"; ok "$out" "" "[$sh] no task directory → stdout empty"
    starts "$err" "repo-track: no task directory" "[$sh] no task directory → stderr says so"
    track "$sh"; ok "$rc" 2 "[$sh] br unset → rc 2"
    chmod 000 "$T/c-done.md"
    if [ -r "$T/c-done.md" ]; then
      echo "SKIP - [$sh] unreadable task file (running as a user who can read mode 000)"
    else
      track "$sh" br=feat/x
      ok "$rc" 2 "[$sh] an unreadable task file → rc 2"; ok "$out" "" "[$sh] unreadable → stdout empty"
      ok "$(first "$err")" "repo-track: grep failed (rc 2)" "[$sh] unreadable → our line first, no grep noise"
    fi
    chmod 644 "$T/c-done.md"
  done
else
  echo "SKIP - the repo-track snippet run (markers missing)"
fi

# ==== 15. read-only proof (after every case that touches work or seed) ===================================
if [ -f "$script" ]; then
  ok "$(snap "$tmp/work")" "$work_before" "15. work's refs are unchanged by every run"
  ok "$(snap "$tmp/seed")" "$seed_before" "15. seed's refs are unchanged by every run"
  ok "$(g -C "$tmp/seed" symbolic-ref -q refs/remotes/origin/HEAD || echo unset)" unset "15. seed still has no origin/HEAD"
fi

echo; [ "$fail" -eq 0 ] && echo "repo-state: ALL PASS" || echo "repo-state: SOME FAILED"
exit "$fail"
