#!/usr/bin/env bash
# self-rollout-check.sh <repoPath> — refuse a rollout whose repoPath is a DIRECTORY-source plugin
# marketplace checkout (skills/_shared/execution-fit.md § Dispatch blockers, p12-4). With a directory
# source Claude Code runs the plugin live from that checkout (${CLAUDE_PLUGIN_ROOT} is it), so every engine
# change merged there becomes the engine of the rollout's next task call. Schedule § 0 and execute § 2.6
# call it through the `# thread:self-rollout-check` wrapper there (and the `# thread:rollout-clone` lookup
# runs it on the sibling clone it finds); it lives in a script because Claude Code substitutes skill
# arguments into every positional `$N` in a SKILL.md body (p5-2).
#
# Reads ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json. For every entry whose
# source.source is "directory", source.path and installLocation are compared with <repoPath>, each side
# with `~/` expanded, trailing slashes stripped and, when the directory exists, `pwd -P` applied (so a
# symlink matches its target); a path that does not exist yet compares as a string. The comparison is by
# CONTAINMENT: a marketplace path equal to <repoPath> or nested inside it (`<repoPath>/…`, a monorepo with
# the marketplace in a subdirectory) matches, because merge-task.sh fast-forwards the whole checkout.
#
# Exit 0: no match. A missing registry is 0; a malformed one or an unknown shape is 0 with a stderr
#         warning (fail open: the registry format belongs to Claude Code, not this plugin).
# Exit 3: a match — the marketplace, the path and the remedy (a separate clone at <repoPath>-rollout,
#         canonicalised: the path --rollout-clone below looks for) on stderr.
# Exit 2: usage error (no or empty <repoPath>), or python3 missing.
#
# self-rollout-check.sh --list-dirs — the same registry read, as a list: every directory source's path and
# installLocation, canonicalised as above, one per line, de-duplicated; exit 0. A missing registry prints
# nothing; a malformed one prints nothing plus the stderr warning. Exit 2 on python3 missing or an extra
# argument. Its caller is skills/_shared/scripts/pushed-base.sh (p12-15), which reads it to find the other
# local clones of a rollout's repo, so this file stays the one parser of the registry.
#
# self-rollout-check.sh --rollout-clone <repoPath> — schedule § 0's lookup after a match (exit 3 above): the
# separate clone a rollout of <repoPath> may run from instead. The candidate is always <repoPath>-rollout
# (<repoPath> canonicalised as above, then `-rollout` appended), the same path the match's remedy names.
# It prints that path (exit 0) only when ALL hold, checked in this order:
#   1. it is a directory;
#   2. it is the top of a git work tree (`rev-parse --show-toplevel`, canonicalised, is it);
#   3. it is its own clone, not a linked worktree: its `--git-common-dir` resolves inside it;
#   4. `land.sh --origin-slug` exits 0 for <repoPath> and for it, and the two <owner>/<name> match
#      (case-insensitively), so both origins are GitHub remotes of the same repository;
#   5. it is not itself a directory-source marketplace checkout (this script's own check exits 0 on it);
#   6. its default branch is known locally (`refs/remotes/origin/HEAD`; no network) and HEAD is on it;
#   7. its working tree is clean (`git status --porcelain`, untracked files included).
# Being behind its last-fetched origin/<default> is fine and only noted on stderr: execute's worktrees
# branch from origin/<default>, and the pushed-base check fetches every clone first. Any failed condition
# is exit 1 with one `self-rollout-check: <path> is not a usable rollout clone: <reason>` line on stderr
# and nothing on stdout; exit 2 is a usage error or land.sh missing. It never clones, fetches or writes.
# Repo-local git env inherited from a caller (a hook's GIT_DIR) is dropped first, so -C always wins (p12-3).
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
canon() {  # canon <path>: ~/ expanded, trailing slashes stripped, symlinks resolved when it exists
  local p="$1"
  case "$p" in "~") p=$HOME ;; "~/"*) p="$HOME/${p#\~/}" ;; esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  if [ -d "$p" ]; then (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"; else printf '%s\n' "$p"; fi
}

if [ "${1:-}" = --rollout-clone ]; then
  [ $# -eq 2 ] && [ -n "$2" ] || { echo "self-rollout-check: usage: self-rollout-check.sh --rollout-clone <repoPath>" >&2; exit 2; }
  # Unset git's own list of repo-local vars, except the two config channels, which cannot move the repo.
  for v in $(git rev-parse --local-env-vars 2>/dev/null); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done
  lb="$(cd "$(dirname "$0")" && pwd -P)/../../_shared/scripts/land.sh"
  [ -f "$lb" ] || { echo "self-rollout-check: land.sh not found at $lb" >&2; exit 2; }
  R=$(canon "$2"); C="$R-rollout"
  no() { echo "self-rollout-check: $C is not a usable rollout clone: $*" >&2; exit 1; }
  [ -d "$C" ] || no "nothing is there; clone the repo to it (git clone <origin URL> \"$C\"), then re-invoke"
  C=$(canon "$C")
  t=$(git -C "$C" rev-parse --show-toplevel 2>/dev/null) && [ -n "$t" ] && [ "$(canon "$t")" = "$C" ] \
    || no "it is not the top of a git work tree"
  gc=$(cd "$C" && d=$(git rev-parse --git-common-dir 2>/dev/null) && [ -n "$d" ] && cd "$d" && pwd -P)
  case "$gc" in "$C"/*) ;; *) no "it is a linked worktree of ${gc:-another repository}, not a separate clone" ;; esac
  a=$(bash "$lb" --origin-slug "$R") && [ -n "$a" ] || no "the origin of $R does not name a GitHub <owner>/<name>"
  b=$(bash "$lb" --origin-slug "$C") && [ -n "$b" ] || no "its origin does not name a GitHub <owner>/<name>"
  [ "$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$b" | tr '[:upper:]' '[:lower:]')" ] \
    || no "its origin is $b, not $a"
  bash "$0" "$C" >/dev/null 2>&1; rc=$?
  [ "$rc" = 0 ] || { [ "$rc" = 3 ] && no "it is a directory-source plugin marketplace checkout too"; no "the self-rollout check failed on it (exit $rc)"; }
  ob=$(git -C "$C" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); db=${ob#origin/}
  [ -n "$ob" ] && [ "$db" != "$ob" ] && [ -n "$db" ] \
    || no "its default branch is unknown (no refs/remotes/origin/HEAD): run git -C \"$C\" remote set-head origin --auto"
  hb=$(git -C "$C" symbolic-ref --quiet --short HEAD 2>/dev/null)
  [ "$hb" = "$db" ] || no "it is on ${hb:-a detached HEAD}, not its default branch $db: run git -C \"$C\" switch $db"
  st=$(git -C "$C" status --porcelain 2>/dev/null) || no "git status failed in it"
  [ -z "$st" ] || no "its working tree is not clean ($(printf '%s\n' "$st" | wc -l | tr -d ' ') changed or untracked path(s)): commit, stash or remove them"
  if git -C "$C" rev-parse --verify --quiet "refs/remotes/origin/$db" >/dev/null && git -C "$C" rev-parse --verify --quiet HEAD >/dev/null; then
    n=$(git -C "$C" rev-list --count "HEAD..refs/remotes/origin/$db" 2>/dev/null)
    [ "${n:-0}" -gt 0 ] && echo "self-rollout-check: note: $C is $n commit(s) behind its last-fetched origin/$db; that is fine: execute's worktrees branch from origin/$db, and the pushed-base check fetches it" >&2
  fi
  printf '%s\n' "$C"
  exit 0
fi

list=0
if [ "${1:-}" = --list-dirs ]; then
  [ $# -eq 1 ] || { echo "self-rollout-check: usage: self-rollout-check.sh --list-dirs" >&2; exit 2; }
  list=1
fi
[ "$list" = 1 ] || { [ $# -eq 1 ] && [ -n "$1" ]; } || { echo "self-rollout-check: usage: self-rollout-check.sh <repoPath>" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "self-rollout-check: python3 not found" >&2; exit 2; }
reg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json"
[ -f "$reg" ] || exit 0

# One "<name><TAB><path>" line per directory-source path; warnings go to stderr, never a non-zero exit.
entries=$(python3 - "$reg" <<'PY'
import json, sys
path = sys.argv[1]
def warn(msg):
    print("self-rollout-check: WARN: %s in %s; check skipped for it" % (msg, path), file=sys.stderr)
try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    warn("unreadable registry (%s)" % e.__class__.__name__)
    sys.exit(0)
if not isinstance(data, dict):
    warn("unknown registry shape")
    sys.exit(0)
for name, entry in data.items():
    src = entry.get("source") if isinstance(entry, dict) else None
    if not isinstance(src, dict):
        warn("unknown shape for marketplace %r" % name)
        continue
    if src.get("source") != "directory":
        continue
    for p in (src.get("path"), entry.get("installLocation")):
        if isinstance(p, str) and p and "\n" not in p and "\t" not in p and "\t" not in name:
            print("%s\t%s" % (name, p))
PY
)
[ -n "$entries" ] || exit 0
if [ "$list" = 1 ]; then
  while IFS="$(printf '\t')" read -r name p; do
    [ -n "$p" ] && canon "$p"
  done <<EOF | awk '!seen[$0]++'
$entries
EOF
  exit 0
fi
want=$(canon "$1")
while IFS="$(printf '\t')" read -r name p; do
  [ -n "$p" ] || continue
  c=$(canon "$p")
  case "$c" in "$want"|"${want%/}/"*) hit=1 ;; *) hit=0 ;; esac
  if [ "$hit" = 1 ]; then
    echo "self-rollout-check: $1 is, or contains, the directory-source checkout of plugin marketplace '$name' ($p)." >&2
    echo "self-rollout-check: the plugin runs live from it, so every engine change merged there becomes the engine of the rollout's next task call." >&2
    echo "self-rollout-check: clone the repo to the separate path $want-rollout, set the rollout's Project root to that clone, then re-invoke (schedule § 0 takes that clone on its own)." >&2
    exit 3
  fi
done <<EOF
$entries
EOF
exit 0
