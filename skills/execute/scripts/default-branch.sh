#!/usr/bin/env bash
# default-branch.sh <repoPath> — origin's default branch for the repo at <repoPath>, asked of the remote
# (skills/execute/SKILL.md § 4, "Resolve defaultBranch"). Execute calls it through the
# `# thread:default-branch-resolver` wrapper there; it lives in a script because Claude Code substitutes
# skill arguments into every positional `$N` in a SKILL.md body, awk's `$2` included (p5-2).
#
# stdout: the branch name · Exit 0, or 1 with a stderr line when the remote does not answer (never a
# guessed `main`), or 2 on a usage error. Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
[ $# -eq 1 ] || { echo "default-branch: usage: default-branch.sh <repoPath>" >&2; exit 2; }
R=$1
b=$(git -C "$R" ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }')
[ -n "$b" ] || { echo "cannot resolve origin's default branch for $R" >&2; exit 1; }
echo "$b"
