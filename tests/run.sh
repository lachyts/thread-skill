#!/usr/bin/env bash
# The one test entrypoint (`make test`, and the self-rollout's verifier). bash 3.2-compatible (macOS).
#
# Hermetic by construction: HOME and the global git config point into a temp dir, so any stray default
# (reconcile-wave.py's vault Tasks dir, the Stop hook's ~/.claude/wave-driver, a git identity) lands in
# temp instead of the real vault or ~/.claude. PYTHONDONTWRITEBYTECODE keeps __pycache__ out of the tree.
#
# Discovery is by explicit globs, not bare `node --test` (which walks the whole tree): node:test files
# and plain exit-code scripts both run under `node --test`, shell suites run one by one. New suites
# join by filename — including the protocol 4 branch's, unchanged.
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
git config --global user.name "thread-tests"; git config --global user.email "thread-tests@example.invalid"
git config --global init.defaultBranch main

# Every file the run creates or modifies anywhere in the checkout (untracked dirs and already-dirty files
# included) is newer than this stamp. Finder's .DS_Store churn is the one exemption.
stamp="$scratch/stamp"; : > "$stamp"; sleep 1

fail=0
failed=""
step() {  # step <label> <cmd...>
  local label="$1"; shift
  echo "== $label"
  if "$@"; then :; else fail=1; failed="$failed
  - $label"; fi
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
step "merge-wave classifier self-test"         bash skills/execute/scripts/merge-wave.sh --self-test-classify
step "merge-wave base self-test"               bash skills/execute/scripts/merge-wave.sh --self-test-base
step "node tests (${#node_tests[@]} files)"    node --test "${node_tests[@]}"
for t in "${sh_tests[@]}"; do
  step "$t" bash "$t"
done

# A run must leave the checkout exactly as it found it (no bytecode, no stray state files).
tree_unchanged() {
  local w; w=$(find "$root" -path "$root/.git" -prune -o -newer "$stamp" -type f ! -name .DS_Store -print)
  [ -z "$w" ] || { echo "written during the run:"; echo "$w"; return 1; }
}
step "run wrote nothing into the checkout" tree_unchanged

echo
if [ "$fail" -eq 0 ]; then echo "make test: ALL PASS"; else echo "make test: FAILED$failed"; fi
exit "$fail"
