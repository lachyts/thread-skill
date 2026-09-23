#!/usr/bin/env bash
# The one test entrypoint (`make test`, and the self-rollout's verifier). bash 3.2-compatible (macOS).
#
# Hermetic by construction: HOME and the global git config point into a temp dir, so any stray default
# (reconcile-wave.py's vault Tasks dir, the Stop hook's ~/.claude/wave-driver, a git identity) lands in
# temp instead of the real vault or ~/.claude. PYTHONDONTWRITEBYTECODE keeps __pycache__ out of the tree.
#
# Discovery is by explicit globs, not bare `node --test` (which walks the whole tree): node:test files
# and plain exit-code scripts both run under `node --test`; shell suites and the merge-wave self-tests
# run concurrently; output is printed grouped per suite in the original order. New suites join by
# filename — including the protocol 4 branch's, unchanged.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
shopt -s nullglob

export PYTHONDONTWRITEBYTECODE=1
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT

# Pin the real interpreters BEFORE swapping HOME: version-manager shims (asdf, mise, pyenv) resolve the
# global version under $HOME and fail inside the temp one. Their resolved dirs go first on PATH.
node_bin=$(node -p 'process.execPath' 2>/dev/null) || { echo "make test: node not found"; exit 1; }
py_bin=$(python3 -c 'import sys; print(sys.executable)' 2>/dev/null) || { echo "make test: python3 not found"; exit 1; }
export PATH="$(dirname "$node_bin"):$(dirname "$py_bin"):$PATH"

export HOME="$scratch/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$scratch/gitconfig"
# A git hook running `make test` exports GIT_DIR & co. (and `git -c ...` exports GIT_CONFIG_PARAMETERS);
# left set, every git call below and every suite's temp-repo git call (commits, pushes included) would land
# on this checkout's repo and its real remote instead. git's own list of repo-local vars, so none is missed;
# it prints even under a bogus GIT_DIR. Scrubbed before the first git call so the whole runner runs clean.
unset $(git rev-parse --local-env-vars)
git config --global user.name "thread-tests"; git config --global user.email "thread-tests@example.invalid"
git config --global init.defaultBranch main

# Every file the run creates or modifies anywhere in the checkout (untracked dirs and already-dirty files
# included) is newer than this stamp. Finder's .DS_Store churn is the one exemption. The sleep only
# matters where mtimes are whole seconds (APFS and ext4 store nanoseconds, so it is skipped there).
stamp="$scratch/stamp"; : > "$stamp"
python3 -c 'import os,sys; sys.exit(os.stat(sys.argv[1]).st_mtime_ns % 10**9 == 0)' "$stamp" || sleep 1

fail=0
failed=""
step() {  # step <label> <cmd...>
  local label="$1"; shift
  echo "== $label"
  if "$@"; then :; else fail=1; failed="$failed
  - $label"; fi
}

n=0; labels=()
spawn() {  # spawn <label> <cmd...> — run in background, capture output + exit code by index
  local label="$1"; shift
  labels[$n]=$label
  { "$@" > "$scratch/$n.out" 2>&1; echo $? > "$scratch/$n.rc"; } &
  n=$((n+1))
}
report() {  # report <i> — print that suite's block; a non-zero or missing rc fails the run
  local i="$1" rc
  echo "== ${labels[$i]}"
  cat "$scratch/$i.out" 2>/dev/null
  rc=$(cat "$scratch/$i.rc" 2>/dev/null || echo missing)
  [ "$rc" = 0 ] || { fail=1; failed="$failed
  - ${labels[$i]}"; }
}

sh_files=(skills/*/scripts/*.sh hooks/*.sh tests/*.sh tests/lib/*.sh)
py_files=(skills/*/scripts/*.py hooks/*.py)
wf_files=(skills/*/*.workflow.js skills/*/diagnostics/*.workflow.js)
node_tests=(skills/execute/tests/*.test.mjs tests/*.test.mjs tests/contracts/*.test.mjs)
sh_tests=(skills/execute/tests/*.test.sh tests/*.test.sh)

syntax_sh() { local f r=0; for f in "$@"; do bash -n "$f" || r=1; done; return $r; }
syntax_py() { python3 -c 'import ast, sys
for p in sys.argv[1:]:
    ast.parse(open(p).read(), p)' "$@"; }

step "bash syntax (${#sh_files[@]} files)"     syntax_sh "${sh_files[@]}"
step "python syntax (${#py_files[@]} files)"   syntax_py "${py_files[@]}"
step "workflow parse (${#wf_files[@]} files)"  bash tests/lib/check-workflow-parse.sh "${wf_files[@]}"
# Independent suites run concurrently (each builds under its own mktemp); node runs once they finish.
spawn "merge-wave classifier self-test"        bash skills/execute/scripts/merge-wave.sh --self-test-classify
spawn "merge-wave base self-test"              bash skills/execute/scripts/merge-wave.sh --self-test-base
for t in "${sh_tests[@]}"; do spawn "$t" bash "$t"; done
wait
report 0; report 1
step "node tests (${#node_tests[@]} files)"    node --test "${node_tests[@]}"
i=2; while [ "$i" -lt "$n" ]; do report "$i"; i=$((i+1)); done

# A run must leave the checkout exactly as it found it (no bytecode, no stray state files).
tree_unchanged() {
  # .git is git's; .claude holds other sessions' worktrees and merge-wave's sentinel, not this run's output.
  local w; w=$(find "$root" \( -path "$root/.git" -o -path "$root/.claude" \) -prune -o -newer "$stamp" -type f ! -name .DS_Store -print)
  [ -z "$w" ] || { echo "written during the run:"; echo "$w"; return 1; }
}
step "run wrote nothing into the checkout" tree_unchanged

echo
if [ "$fail" -eq 0 ]; then echo "make test: ALL PASS"; else echo "make test: FAILED$failed"; fi
exit "$fail"
