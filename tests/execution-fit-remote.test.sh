#!/usr/bin/env bash
# The remote-check snippet in skills/_shared/execution-fit.md § Dispatch blockers, extracted by its markers
# and run against fixture remotes, plus the pointers that wire it in: schedule § 0 runs it (without copying
# it) and stops before any write; execute § 5 carries the scratchpad fallback for a refused engine path.
# Hermetic: every repo lives under mktemp; no commits (so no identity); never gh, never the network. The
# caller's GIT_DIR & co. are unset, and global/system git config is ignored so a user `url.*.insteadOf`
# rule can't rewrite what `git remote get-url` prints when this runs standalone.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c init.defaultBranch=main "$@"; }

# ---- the snippet, verbatim from execution-fit.md ---------------------------------------------------------
awk '/^# thread:remote-check/{on=1; next} /^# end thread:remote-check/{on=0} on' \
  skills/_shared/execution-fit.md | sed 's#^R="<repoPath>"$#R="$1"#' > "$tmp/check.sh"
ok "$(grep -c 'R="$1"' "$tmp/check.sh")" 1 "remote-check snippet found in execution-fit.md"

# run <repo> → sets out (stdout), err (stderr), rc (exit code)
run() { out=$(bash "$tmp/check.sh" "$1" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
repo() { g init -q "$1" && { [ -z "${2:-}" ] || g -C "$1" remote add origin "$2"; }; }  # repo <dir> [origin-url]

# 1. no origin at all (a fresh git init, a filter-repo seed)
repo "$tmp/lonely"
run "$tmp/lonely"
ok "$rc" 1 "no origin → exit 1"
has "$err" "gh repo create" "no origin → the gh repo create remedy"
ok "${out:-<empty>}" "<empty>" "no origin → nothing on stdout"

# 2. origin is a local path (a clone of the live checkout)
g init -q --bare "$tmp/m.git"
repo "$tmp/pathorigin" "$tmp/m.git"
run "$tmp/pathorigin"
ok "$rc" 1 "path origin → exit 1"
has "$err" "not a GitHub remote" "path origin → not a GitHub remote"

# 3. origin is a file:// URL
repo "$tmp/fileorigin" "file://$tmp/m.git"
run "$tmp/fileorigin"
ok "$rc" 1 "file:// origin → exit 1"
has "$err" "not a GitHub remote" "file:// origin → not a GitHub remote"

# 4. origin on another host
repo "$tmp/gitlab" "https://gitlab.com/o/r.git"
run "$tmp/gitlab"
ok "$rc" 1 "other-host origin → exit 1"
has "$err" "not a GitHub remote" "other-host origin → not a GitHub remote"

# 5-7. the GitHub URL shapes pass and print the URL exactly
for u in "https://github.com/o/r.git" "git@github.com:o/r.git" "ssh://git@github.com/o/r.git"; do
  d="$tmp/gh-$(printf %s "$u" | tr -c 'A-Za-z0-9' _)"
  repo "$d" "$u"
  run "$d"
  ok "$rc" 0 "$u → exit 0"
  ok "$out" "$u" "$u → prints the URL"
done

# 8. a repo path with a space, GitHub origin
repo "$tmp/my repo" "https://github.com/o/r.git"
run "$tmp/my repo"
ok "$rc" 0 "repo path with a space → exit 0"
ok "$out" "https://github.com/o/r.git" "repo path with a space → prints the URL"

# 9. a repo path with a space, no origin: the remedy names the whole path
repo "$tmp/no remote here"
run "$tmp/no remote here"
ok "$rc" 1 "spaced path, no origin → exit 1"
has "$err" "--source \"$tmp/no remote here\"" "spaced path, no origin → remedy quotes the whole path"

# ---- the wiring --------------------------------------------------------------------------------------------
# Every phrase below is one only this change's text carries, so each check fails on the docs before it.
ef=$(tr '\n' ' ' < skills/_shared/execution-fit.md)   # one line, so a phrase may wrap
engine=$(awk '/^\*\*Engine path\.\*\*/{on=1} on && /^$/{on=0} on' skills/_shared/execution-fit.md | tr '\n' ' ')
has "$engine" "**Engine path.**" "execution-fit names the engine-path blocker"
has "$engine" "execute § 5 carries the scratchpad fallback" "engine-path blocker cites execute § 5"
has "$ef" "schedule § 0 runs these checks" "execution-fit names schedule § 0 as the gate"

s0=$(awk '/^### 0\./{on=1} /^### 1\./{on=0} on' skills/schedule/SKILL.md)
has "$s0" "execution-fit.md\` § Dispatch blockers" "schedule § 0 points at execution-fit.md § Dispatch blockers"
has "$s0" "stop before step 1" "schedule § 0 stops before step 1"
has "$s0" "no task stamped" "schedule § 0 stamps no task"
has "$s0" "no rollout note" "schedule § 0 writes no rollout note"
has "$s0" "no heartbeat" "schedule § 0 registers no heartbeat"
ok "$(grep -c '# thread:remote-check' skills/schedule/SKILL.md)" 0 "schedule does not copy the snippet"

s5=$(awk '/^### 5\./{on=1} /^### 6\./{on=0} on' skills/execute/SKILL.md)
for w in scratchpad cmp "Never edit"; do
  has "$s5" "$w" "execute § 5 fallback mentions $w"
done
has "$s5" "scriptPath\` the run started with" "execute § 5 resume re-passes the scriptPath the run started with"

echo; [ "$fail" -eq 0 ] && echo "execution-fit-remote: ALL PASS" || echo "execution-fit-remote: SOME FAILED"
exit "$fail"
