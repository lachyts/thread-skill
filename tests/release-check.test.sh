#!/usr/bin/env bash
# `make release-check`, the real recipe, run against a temp copy of this tree and a fake config dir whose
# plugin cache is built from it. Covers the manifest contract, the cache diff over skills/ and hooks/ (a tree
# sub-dir missing from the working copy, symlinked dirs, dangling links, dir and link loops, a named pipe, a
# name holding `"`, `\` and `\c`, a CDPATH the caller exports), the stray check (cache files the tree does not
# track; .DS_Store and __pycache__/ exempt; a cache-only file in a symlinked dir the update copied; an
# unreadable cache dir), and the evals/results/ refusal that runs first (files only, the same exemptions).
# Every run has a `diff` first on PATH that records a call, and the last assertion is that none was made.
# RC_SHELL=/bin/dash runs the recipe under dash. Hermetic: everything lives under one mktemp, git reads an
# empty global config and no system config, and CLAUDE_CONFIG_DIR is always passed on the make command
# line, so the real config dir is never read.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)

tmp=$(mktemp -d); trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
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

run_rc() { out=$(cd "$tree" && env -u MAKEFLAGS -u MAKELEVEL PATH="$guard:$PATH" make -s release-check ${RC_SHELL:+SHELL="$RC_SHELL"} CLAUDE_CONFIG_DIR="$config" 2>&1); rc=$?; }

# A `diff` first on PATH that records any call: release-check never calls diff (the Makefile's header says why).
guard="$tmp/guard"; mkdir -p "$guard"
cat > "$guard/diff" <<EOF
#!/bin/sh
: >> "$tmp/diff-called"; exit 99
EOF
chmod +x "$guard/diff"
ok "$(PATH="$guard:$PATH"; command -v diff)" "$guard/diff" "the diff guard is first on PATH"
(PATH="$guard:$PATH"; diff /dev/null /dev/null)
ok "$?|$([ -e "$tmp/diff-called" ] && echo called)" "99|called" "the diff guard records a call"
rm -f "$tmp/diff-called"
nz() { [ "$1" -ne 0 ] && echo nonzero || echo zero; }
# looped <path>: y when $out names a loop at <path>: the recipe's own line, or (GNU find) find's loop error naming it
gnu_find=; find --version 2>/dev/null | grep -q GNU && gnu_find=1
looped() {
  if [ "$(printf '%s\n' "$out" | grep -cxF -- "Symlink loop: $1")" -ge 1 ]; then echo y
  elif [ -n "$gnu_find" ] && [ "$(printf '%s\n' "$out" | grep -E 'loop detected|part of a loop|Too many levels of symbolic links' | grep -cF -- "$1")" -ge 1 ]; then echo y
  else echo n; fi
}

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

# (d2) a tracked file missing from the cache
rm "$cache/skills/status/SKILL.md"
run_rc; ok "$(nz "$rc")" nonzero "(d2) a file missing from the cache exits non-zero"
has "$out" "Only in skills/status: SKILL.md" "(d2) names it in an Only-in line"
cp -p "$tree/skills/status/SKILL.md" "$cache/skills/status/SKILL.md"

# (d3) a whole cache sub-dir missing
mv "$cache/hooks" "$tmp/hooks.aside"
run_rc; ok "$(nz "$rc")" nonzero "(d3) a missing cache sub-dir exits non-zero"
has "$out" "No $cache/hooks" "(d3) names the missing sub-dir"
mv "$tmp/hooks.aside" "$cache/hooks"

# (d4) a tree sub-dir missing from the working copy (deleted, not committed): find's error fails the cache diff
mv "$tree/hooks" "$tmp/hooks.aside"
run_rc; ok "$(nz "$rc")" nonzero "(d4) a tree sub-dir missing from the working copy exits non-zero"
has "$out" "FAIL - cache $v differs from the tree" "(d4) reported by the cache diff"
ok "$([ "$(printf '%s\n' "$out" | grep -c 'find: .*hooks')" -ge 1 ] && echo y || echo n)" y "(d4) shows find's own error"
mv "$tmp/hooks.aside" "$tree/hooks"

# (d5) tracked edge fixtures on both sides: a symlinked dir (and one the update copied as a real dir), an identical
# dangling link, and a name holding `"`, `\` and `\c`. Run under a CDPATH whose decoy holds skills/ and hooks/: a
# recipe cd on a relative path that keeps CDPATH fails under macOS sh (and lands in the decoy under dash).
q='skills/_shared/zz/q"b\cd.md'
for side in "$tree" "$cache"; do ln -s ../hooks "$side/skills/lnk"; ln -s nowhere "$side/skills/dang"; mkdir -p "$side/skills/_shared/zz"; done
ln -s ../hooks "$tree/skills/cpy"; cp -R "$cache/hooks" "$cache/skills/cpy"
echo q > "$tree/$q"; cp -p "$tree/$q" "$cache/$q"
git -C "$tree" add skills/lnk skills/cpy skills/dang "$q"
mkdir -p "$tmp/decoy/skills" "$tmp/decoy/hooks"
CDPATH="$tmp/decoy" run_rc; ok "$rc" 0 "(d5) symlinked dirs, an identical dangling link and a quoting name exit 0, under a CDPATH"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"

# (d6) drift through each: content through a symlinked dir, a re-targeted dangling link, a missing quoting name;
# plus tree-only entries no cache can match: a named pipe, dir loops (to `..`, to `.`, and across skills/ and
# hooks/ through two links) and a link-only loop
printf 'drift\n' >> "$cache/hooks/hooks.json"
ln -sfn elsewhere "$cache/skills/dang"
rm "$cache/$q"
mkfifo "$tree/skills/_shared/zz/p"
ln -s .. "$tree/skills/_shared/zz/loop"; ln -s . "$tree/skills/_shared/zz/self"; ln -s ring "$tree/skills/_shared/zz/ring"
ln -s ../skills "$tree/hooks/back"
run_rc; ok "$(nz "$rc")" nonzero "(d6) drift exits non-zero"
has "$out" "Files $cache/skills/lnk/hooks.json and skills/lnk/hooks.json differ" "(d6) drift through a symlinked dir"
has "$out" "Files $cache/skills/dang and skills/dang differ" "(d6) a re-targeted dangling link"
has "$out" 'Only in skills/_shared/zz: q"b\cd.md' "(d6) names the whole quoting name"
has "$out" "Not a regular file: skills/_shared/zz/p" "(d6) a named pipe, never opened"
for l in skills/_shared/zz/loop skills/_shared/zz/self skills/_shared/zz/ring skills/lnk/back hooks/back/lnk; do
  ok "$(looped "$l")" y "(d6) a loop at $l"
done
cp -p "$tree/hooks/hooks.json" "$cache/hooks/hooks.json"; ln -sfn nowhere "$cache/skills/dang"; cp -p "$tree/$q" "$cache/$q"
rm "$tree/skills/_shared/zz/p" "$tree/skills/_shared/zz/loop" "$tree/skills/_shared/zz/self" "$tree/skills/_shared/zz/ring" "$tree/hooks/back"

# (d7) a cache-only file inside the symlinked dir the update copied: stray, while the copy's own files are not
echo extra > "$cache/skills/cpy/extra.md"
run_rc; ok "$(nz "$rc")" nonzero "(d7) a cache-only file in a copied symlinked dir exits non-zero"
has "$out" "holds files this tree does not track" "(d7) reported by the stray check"
ok "$(printf '%s\n' "$out" | grep -cx 'skills/cpy/extra.md')" 1 "(d7) names the extra file"
ok "$(printf '%s\n' "$out" | grep -c 'skills/cpy/hooks.json')" 0 "(d7) the copy's own files are not stray"
rm "$cache/skills/cpy/extra.md"
for side in "$tree" "$cache"; do rm -rf "$side/skills/lnk" "$side/skills/cpy" "$side/skills/dang" "$side/skills/_shared/zz"; done
git -C "$tree" rm -q --cached skills/lnk skills/cpy skills/dang "$q"

# (d8) an unreadable cache dir fails the stray check rather than passing it silently
if [ "$(id -u)" -eq 0 ]; then echo "(d8) skipped: root reads a chmod-000 dir"; else
  mkdir -p "$cache/.claude/locked"; : > "$cache/.claude/locked/f"; chmod 000 "$cache/.claude/locked"
  run_rc; ok "$(nz "$rc")" nonzero "(d8) an unreadable cache dir exits non-zero"
  has "$out" "FAIL - cannot walk the cache" "(d8) says the cache walk failed"
  ok "$([ "$(printf '%s\n' "$out" | grep -c 'find: .*locked')" -ge 1 ] && echo y || echo n)" y "(d8) shows find's own error"
  chmod 755 "$cache/.claude/locked"; rm -rf "$cache/.claude"
fi

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
# Restored from a saved copy, never `git checkout --`: skills/status/SKILL.md carries git's `ident` attribute (ADR 0043,
# .gitattributes), so a checkout rewrites its `$Id$` marker to `$Id: <blob> $` whenever the working copy held another
# form (a bare marker, or a stale id after an edit), and the tree would then differ from the cache built from it.
cp -p "$tree/skills/status/SKILL.md" "$tmp/status-SKILL.md"
printf -- '---\nname status\n---\n' > "$tree/skills/status/SKILL.md"
run_rc; ok "$(nz "$rc")" nonzero "(g) malformed front matter exits non-zero"
has "$out" "unparseable frontmatter" "(g) shows the contract's own assertion"
ok "$(printf %s "$out" | grep -c 'versions disagree')" 0 "(g) makes no version-mismatch claim"
ok "$(printf %s "$out" | grep -c 'FAIL - plugin.json')" 0 "(g) no plugin.json != marketplace.json line"
cp -p "$tmp/status-SKILL.md" "$tree/skills/status/SKILL.md"

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
ok "$([ -e "$tmp/diff-called" ] && echo called || echo never)" never "release-check never calls diff"

echo; [ "$fail" -eq 0 ] && echo "release-check: ALL PASS" || echo "release-check: SOME FAILED"
exit "$fail"
