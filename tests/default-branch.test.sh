#!/usr/bin/env bash
# The default-branch resolver in skills/execute/SKILL.md § 4 (a wrapper round
# skills/execute/scripts/default-branch.sh since p5-2), extracted by its marker and run against
# fixture remotes, plus the engine's rendered worktree setup executed against a `master`-only origin.
# Hermetic: every repo lives under mktemp; git identity is passed per command; the caller's GIT_DIR & co.
# are unset — exported (as inside a git hook), they turn every `git -C "$tmp/..."` below into a commit,
# HEAD switch and `push origin` against the outer repo and its real remote.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch="${GB:-master}" "$@"; }

# ---- the resolver, verbatim from the skill -----------------------------------------------------------
awk '/^# thread:default-branch-resolver/{on=1; next} /^# end thread:default-branch-resolver/{on=0} on' \
  skills/execute/SKILL.md | sed 's#^R="<repoPath>"$#R="$1"#' > "$tmp/resolve.sh"
ok "$(grep -c 'R="$1"' "$tmp/resolve.sh")" 1 "resolver snippet found in execute/SKILL.md"
# The snippet is a wrapper; the logic is default-branch.sh (a SKILL.md body holds no positional $N, p5-2).
ok "$(grep -c 'skills/execute/scripts/default-branch\.sh' "$tmp/resolve.sh")" 1 "the resolver snippet calls default-branch.sh"
root=$(pwd -P)
resolve() { CLAUDE_PLUGIN_ROOT="$root" bash "$tmp/resolve.sh" "$1" 2>/dev/null; }

# 1. a clone
g init -q --bare "$tmp/m.git"
g clone -q "$tmp/m.git" "$tmp/seed" 2>/dev/null
g -C "$tmp/seed" commit -q --allow-empty -m base && g -C "$tmp/seed" push -q origin master
g clone -q "$tmp/m.git" "$tmp/clone"
ok "$(resolve "$tmp/clone")" master "clone → master"

# 2. the repo that pushed (no local origin/HEAD at all)
ok "$(git -C "$tmp/seed" symbolic-ref -q refs/remotes/origin/HEAD || echo unset)" unset "seed has no origin/HEAD (precondition)"
ok "$(resolve "$tmp/seed")" master "pushed repo without origin/HEAD → master"

# 2b. the remote's default moves; the clone's cached origin/HEAD goes stale — the remote must win
g clone -q "$tmp/m.git" "$tmp/stale"
g -C "$tmp/stale" push -q origin master:main && git -C "$tmp/m.git" symbolic-ref HEAD refs/heads/main
g -C "$tmp/stale" fetch -q --prune
ok "$(git -C "$tmp/stale" symbolic-ref --short refs/remotes/origin/HEAD)" origin/master "stale clone still caches origin/master (precondition)"
ok "$(resolve "$tmp/stale")" main "stale local origin/HEAD → the remote's main wins"
git -C "$tmp/m.git" symbolic-ref HEAD refs/heads/master

# 2c. a repo path with a space
g clone -q "$tmp/m.git" "$tmp/my repo"
ok "$(resolve "$tmp/my repo")" master "repo path with a space"

# 3. a main origin still resolves to main
GB=main g init -q --bare "$tmp/n.git"
GB=main g clone -q "$tmp/n.git" "$tmp/nseed" 2>/dev/null
GB=main g -C "$tmp/nseed" commit -q --allow-empty -m base && g -C "$tmp/nseed" push -q origin main
ok "$(resolve "$tmp/nseed")" main "main origin → main"

# 4. no remote: the resolver stops rather than assuming main
g init -q "$tmp/lonely"
resolve "$tmp/lonely" >/dev/null; ok "$?" 1 "no remote → exit 1, never a guessed main"

# 5. the script unreachable: exit 2, a stop like exit 1
out=$(CLAUDE_PLUGIN_ROOT="$tmp/nowhere" bash "$tmp/resolve.sh" "$tmp/clone" 2>"$tmp/err"); rc=$?
ok "$rc|$out" "2|" "script missing → exit 2, nothing on stdout"
ok "$(cut -d: -f1 "$tmp/err")" "default-branch" "script missing → stderr starts default-branch:"
bash skills/execute/scripts/default-branch.sh >/dev/null 2>&1; ok "$?" 2 "no <repoPath> → usage exit 2"
(cd "$tmp/clone" && bash "$root/skills/execute/scripts/default-branch.sh" "" >/dev/null 2>&1); ok "$?" 2 "empty <repoPath> → usage exit 2, never the CWD's repo"

# ---- the engine's rendered setup, executed ----------------------------------------------------------
setup=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['worktreeSetup'])
  const out = T.worktreeSetup({ repoPath: process.argv[1], defaultBranch: 'master' }, { slug: 'e2e-task' })
  process.stdout.write(out.split('\n').slice(1, 6).join('\n') + '\n')
" "$tmp/seed")
has "$setup" 'origin/master && cd "$WT"; fi' "rendered setup branches from origin/master"
g -C "$tmp/clone" commit -q --allow-empty -m wave1 && g -C "$tmp/clone" push -q origin master
top=$(cd "$tmp" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t bash -c "$setup" 2>/dev/null | tail -1)
wt="$tmp/seed/.claude/worktrees/e2e-task"
ok "$([ -d "$wt" ] && echo y)" y "setup created the task worktree"
ok "${top:-<empty>}" "$(cd "$wt" 2>/dev/null && pwd -P || echo '<no worktree>')" "setup lands in the task worktree"
ok "$(git -C "$wt" rev-parse HEAD 2>/dev/null)" "$(git -C "$tmp/clone" rev-parse HEAD)" "fresh worktree is at the freshly-fetched origin/master"

# ---- nothing shipped assumes main ----------------------------------------------------------------------
ok "$(grep -c 'origin/main' skills/execute/scripts/merge-wave.sh)" 0 "merge-wave.sh has no origin/main"
ok "$(grep -c 'origin/main' skills/execute/diagnostics/edit-noop-repro.workflow.js)" 0 "edit-noop-repro diagnostic has no origin/main"

echo; [ "$fail" -eq 0 ] && echo "default-branch: ALL PASS" || echo "default-branch: SOME FAILED"
exit "$fail"
