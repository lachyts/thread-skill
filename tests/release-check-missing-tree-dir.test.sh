#!/usr/bin/env bash
# `make release-check` against a temp tree + cache: a tree sub-dir missing from the working copy (deleted,
# not committed) must fail the cache diff (a find error must not read as a clean walk).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL="$tmp/gitconfig" GIT_CONFIG_NOSYSTEM=1; : > "$GIT_CONFIG_GLOBAL"
tree="$tmp/tree"; mkdir -p "$tree"
git ls-files -z | while IFS= read -r -d '' f; do
  [ -e "$f" ] || continue
  mkdir -p "$tree/$(dirname "$f")"; cp -p "$f" "$tree/$f"
done
git -C "$tree" -c init.defaultBranch=main init -q
git -C "$tree" add -A -f
v=$(cd "$tree" && node -p 'require("./.claude-plugin/plugin.json").version')
config="$tmp/config dir"; cache="$config/plugins/cache/thread/thread/$v"; mkdir -p "$cache"
(cd "$tree" && tar cf - --exclude .git .) | (cd "$cache" && tar xf -)
run_rc() { out=$(cd "$tree" && env -u MAKEFLAGS -u MAKELEVEL make -s release-check CLAUDE_CONFIG_DIR="$config" 2>&1); rc=$?; }
nz() { [ "$1" -ne 0 ] && echo nonzero || echo zero; }

run_rc; ok "$rc" 0 "(a) matching cache exits 0"

# (1) the tree's hooks/ deleted from the working copy (still in the index); the cache still holds it
mv "$tree/hooks" "$tmp/hooks.aside"
run_rc; ok "$(nz "$rc")" nonzero "(1) a tree sub-dir missing from the working copy fails the cache diff"
[ "$rc" -ne 0 ] || printf '%s\n' "$out"
mv "$tmp/hooks.aside" "$tree/hooks"

echo; [ "$fail" -eq 0 ] && echo "release-check-missing-tree-dir: ALL PASS" || echo "release-check-missing-tree-dir: SOME FAILED"
exit "$fail"
