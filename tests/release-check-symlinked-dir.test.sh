#!/usr/bin/env bash
# `make release-check` against a temp tree + cache: an identical symlink to a directory in both tree and
# cache must not be reported as differing (cmp on a directory exits 2).
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

# (2) an identical symlink to a directory in both tree and cache
ln -s ../hooks "$tree/skills/lnk"; ln -s ../hooks "$cache/skills/lnk"; git -C "$tree" add skills/lnk
run_rc; ok "$rc" 0 "(2) an identical symlinked dir in tree and cache exits 0"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"
rm "$tree/skills/lnk" "$cache/skills/lnk"; git -C "$tree" rm -q --cached skills/lnk

echo; [ "$fail" -eq 0 ] && echo "release-check-symlinked-dir: ALL PASS" || echo "release-check-symlinked-dir: SOME FAILED"
exit "$fail"
