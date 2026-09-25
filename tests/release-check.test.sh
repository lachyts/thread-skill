#!/usr/bin/env bash
# `make release-check`, the real recipe, run against a temp copy of this tree and a fake config dir whose
# plugin cache is built from it. Covers the manifest contract, the cache diff over skills/ and hooks/, the
# stray check (cache files the tree does not track; .DS_Store and __pycache__/ exempt), and the
# evals/results/ refusal that runs first (files only, the same exemptions). Hermetic:
# everything lives under one mktemp, git reads an empty global config and no system config, and
# CLAUDE_CONFIG_DIR is always passed on the make command line, so the real config dir is never read.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL="$tmp/gitconfig" GIT_CONFIG_NOSYSTEM=1; : > "$GIT_CONFIG_GLOBAL"

# ---- a temp tree: this checkout's TRACKED files, working-tree content, staged (no commit needed) -------
tree="$tmp/tree"; mkdir -p "$tree"
git ls-files -z | while IFS= read -r -d '' f; do
  [ -e "$f" ] || continue   # tracked but deleted in the working tree
  mkdir -p "$tree/$(dirname "$f")"; cp -p "$f" "$tree/$f"
done
git -C "$tree" -c init.defaultBranch=main init -q
git -C "$tree" add -A -f   # -f keeps a tracked-but-gitignored file

# ---- a fake config dir whose version-keyed cache is a copy of the tree (a space in the path on purpose) -
v=$(cd "$tree" && node -p 'require("./.claude-plugin/plugin.json").version')
config="$tmp/config dir"
cache="$config/plugins/cache/thread/thread/$v"
mkdir -p "$cache"
(cd "$tree" && tar cf - --exclude .git .) | (cd "$cache" && tar xf -)

run_rc() { out=$(cd "$tree" && env -u MAKEFLAGS -u MAKELEVEL make -s release-check CLAUDE_CONFIG_DIR="$config" 2>&1); rc=$?; }
nz() { [ "$1" -ne 0 ] && echo nonzero || echo zero; }

# (a) matching cache
run_rc; ok "$rc" 0 "(a) matching cache exits 0"; has "$out" "release-check:" "(a) prints the release-check line"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"

# (b) stray nested plugin copy (the E2E's .claude/worktrees/enabler/, with a .git FILE)
mkdir -p "$cache/.claude/worktrees/enabler"
echo stray > "$cache/.claude/worktrees/enabler/README.md"
echo 'gitdir: /nonexistent' > "$cache/.claude/worktrees/enabler/.git"
run_rc; ok "$(nz "$rc")" nonzero "(b) stray files exit non-zero"
has "$out" ".claude/worktrees/enabler/README.md" "(b) names the stray README"
has "$out" ".claude/worktrees/enabler/.git" "(b) names the stray .git file"
rm -rf "$cache/.claude"

# (c) noise only: .DS_Store at the root, __pycache__ in a brand-new dir
: > "$cache/.DS_Store"; mkdir -p "$cache/skills/x/__pycache__"; : > "$cache/skills/x/__pycache__/y.pyc"
run_rc; ok "$rc" 0 "(c) .DS_Store and __pycache__/ in the cache still exit 0"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"

# (c2) a real file in that new cache dir is reported by the stray check, not the diff
echo real > "$cache/skills/x/real.md"
run_rc; ok "$(nz "$rc")" nonzero "(c2) a real file in a new cache dir exits non-zero"
has "$out" "holds files this tree does not track" "(c2) reported by the stray check"
has "$out" "skills/x/real.md" "(c2) names the file"
rm -rf "$cache/skills/x" "$cache/.DS_Store"

# (d) a cache file that differs from the tree
echo "drift" >> "$cache/skills/execute/SKILL.md"
run_rc; ok "$(nz "$rc")" nonzero "(d) a differing file exits non-zero"
has "$out" "skills/execute/SKILL.md" "(d) names the file"; has "$out" "differs from the tree" "(d) says the cache differs"
cp -p "$tree/skills/execute/SKILL.md" "$cache/skills/execute/SKILL.md"

# (d2) a tracked file missing from the cache (the tree-side Only-in line survives the filter)
rm "$cache/skills/status/SKILL.md"
run_rc; ok "$(nz "$rc")" nonzero "(d2) a file missing from the cache exits non-zero"
has "$out" "Only in skills/status: SKILL.md" "(d2) keeps the tree-side Only-in line"
cp -p "$tree/skills/status/SKILL.md" "$cache/skills/status/SKILL.md"

# (e) no version dir
mv "$cache" "$cache.aside"
run_rc; ok "$(nz "$rc")" nonzero "(e) a missing version dir exits non-zero"; has "$out" "run the plugin update" "(e) gives the plugin-update hint"
mv "$cache.aside" "$cache"

# (f) manifests disagree (also guards the contract test's name: a pattern matching nothing passes vacuously)
sed -i.bak "s/\"version\": \"$v\"/\"version\": \"0.0.0\"/" "$tree/.claude-plugin/marketplace.json"
run_rc; ok "$(nz "$rc")" nonzero "(f) disagreeing manifests exit non-zero"
has "$out" "manifest contract (same version) failed" "(f) names the manifest contract"
git -C "$tree" checkout -- .claude-plugin/marketplace.json; rm -f "$tree/.claude-plugin/marketplace.json.bak"

# (g) malformed skill front matter: node's real assertion, never a false version-mismatch claim
printf -- '---\nname status\n---\n' > "$tree/skills/status/SKILL.md"
run_rc; ok "$(nz "$rc")" nonzero "(g) malformed front matter exits non-zero"
has "$out" "unparseable frontmatter" "(g) shows the contract's own assertion"
ok "$(printf %s "$out" | grep -c 'versions disagree')" 0 "(g) makes no version-mismatch claim"
ok "$(printf %s "$out" | grep -c 'FAIL - plugin.json')" 0 "(g) no plugin.json != marketplace.json line"
git -C "$tree" checkout -- skills/status/SKILL.md

# (h) `make evals` output in the tree: refused first, count plus top-level entries, never nested files
ts=20260925T000000Z
mkdir -p "$tree/evals/results/$ts"; echo '{}' > "$tree/evals/results/$ts/run.json"
run_rc; ok "$(nz "$rc")" nonzero "(h) a non-empty evals/results/ exits non-zero"
has "$out" "record anything you need in docs/evals/ (or move evals/results out of the tree), then rm -rf evals/results" "(h) says record, then clear"
has "$out" "holds 1 file(s)" "(h) gives the file count"
has "$out" "evals/results/$ts" "(h) names the run dir"
ok "$(printf %s "$out" | grep -c 'run.json')" 0 "(h) names no nested file"
has "$out" "rm -rf \"$config/plugins/cache/thread/thread/<version>/evals/results\"" "(h) names the cache copy to delete"
ok "$(printf %s "$out" | grep -c 'bump')" 0 "(h) does not recommend a bump"
ok "$(printf %s "$out" | grep -c 'manifests agree')" 0 "(h) prints no success line"

# (h4a) the refusal runs before the manifest contract (the (h) fixture stays)
sed -i.bak "s/\"version\": \"$v\"/\"version\": \"0.0.0\"/" "$tree/.claude-plugin/marketplace.json"
run_rc; ok "$(nz "$rc")" nonzero "(h4a) results plus disagreeing manifests exit non-zero"
has "$out" "evals/results/ holds 1 file(s)" "(h4a) shows the evals refusal"
ok "$(printf %s "$out" | grep -c 'manifest contract (same version) failed')" 0 "(h4a) refuses before the manifest contract"
git -C "$tree" checkout -- .claude-plugin/marketplace.json; rm -f "$tree/.claude-plugin/marketplace.json.bak"

# (h4b) the refusal runs before the missing-cache check (the (h) fixture stays)
mv "$cache" "$cache.aside"
run_rc; ok "$(nz "$rc")" nonzero "(h4b) results plus a missing version dir exit non-zero"
has "$out" "evals/results/ holds 1 file(s)" "(h4b) shows the evals refusal"
ok "$(printf %s "$out" | grep -c 'run the plugin update')" 0 "(h4b) refuses before the missing-cache check"
mv "$cache.aside" "$cache"; rm -rf "$tree/evals/results"

# (h5) several files: the count is files, each run dir is listed once, nested names never appear, and a
# file directly under evals/results/ is itself the top-level entry, so it is listed as a path
ts2=20260925T010000Z
mkdir -p "$tree/evals/results/$ts/case/sub" "$tree/evals/results/$ts2"
echo '{}' > "$tree/evals/results/$ts/run.json"; echo '{}' > "$tree/evals/results/$ts/case/sub/t.json"
echo '{}' > "$tree/evals/results/$ts2/run.json"; echo '{}' > "$tree/evals/results/summary.json"
run_rc; ok "$(nz "$rc")" nonzero "(h5) several results files exit non-zero"
has "$out" "holds 4 file(s)" "(h5) counts files, not run dirs"
ok "$(printf '%s\n' "$out" | grep -cx "  evals/results/$ts")" 1 "(h5) lists the two-file run dir once"
ok "$(printf '%s\n' "$out" | grep -cx "  evals/results/$ts2")" 1 "(h5) lists the second run dir once"
ok "$(printf '%s\n' "$out" | grep -cx "  evals/results/summary.json")" 1 "(h5) lists a top-level file as its path"
ok "$(printf '%s\n' "$out" | grep -c '^  evals/results/')" 3 "(h5) lists exactly the three top-level entries"
ok "$(printf %s "$out" | grep -cE 'run\.json|t\.json|case|/sub')" 0 "(h5) names no nested file or dir"
rm -rf "$tree/evals/results"

# (h2) empty run dirs are not refused
mkdir -p "$tree/evals/results/$ts"
run_rc; ok "$rc" 0 "(h2) an evals/results/ holding only empty dirs exits 0"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"
rm -rf "$tree/evals/results"

# (h3) the stray check's exemptions: .DS_Store and anything under __pycache__/
mkdir -p "$tree/evals/results/$ts/__pycache__"
: > "$tree/evals/results/.DS_Store"; : > "$tree/evals/results/$ts/__pycache__/x.pyc"
run_rc; ok "$rc" 0 "(h3) .DS_Store and __pycache__/ in evals/results/ still exit 0"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"
rm -rf "$tree/evals/results"

# every case restored its state
run_rc; ok "$rc" 0 "(a) matching cache exits 0 again after every case"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"

echo; [ "$fail" -eq 0 ] && echo "release-check: ALL PASS" || echo "release-check: SOME FAILED"
exit "$fail"
