#!/usr/bin/env bash
# self-rollout-check.sh <repoPath> — refuse a rollout whose repoPath holds the plugin's own live checkout
# (skills/_shared/execution-fit.md § Dispatch blockers, p12-4). With a directory-source marketplace, or a
# `--plugin-dir` session, Claude Code runs the plugin live from that checkout (${CLAUDE_PLUGIN_ROOT} is it),
# so every engine change merged there becomes the engine of the rollout's next task call. Execute § 2.6
# (this mode) and schedule § 0 (--resolve, below) call it through the `# thread:self-rollout-check` wrapper
# there; it lives in a script because Claude Code substitutes skill arguments into every positional `$N` in
# a SKILL.md body (p5-2).
#
# Two sources, each compared with <repoPath> by CONTAINMENT (a path equal to <repoPath> or nested inside it,
# `<repoPath>/…`, a monorepo with the plugin in a subdirectory, matches, because merge-task.sh fast-forwards
# the whole checkout), every path with `~/` expanded, trailing slashes stripped and, when the directory
# exists, `pwd -P` applied (so a symlink matches its target; a path that does not exist yet compares as a
# string):
#   1. ${CLAUDE_PLUGIN_ROOT}, when set: the plugin root this session is running from, which also covers a
#      `--plugin-dir` session the registry never lists;
#   2. ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json: every entry whose source.source
#      is "directory", its source.path and installLocation.
#
# Exit 0: no match. A missing registry is 0; a malformed one or an unknown shape is 0 with a stderr
#         warning (fail open: the registry format belongs to Claude Code, not this plugin).
# Exit 3: a match: what matched and the path on stderr, then the fix (refuse() below is its one statement).
# Exit 2: usage error (no or empty <repoPath>), or python3 missing.
#
# self-rollout-check.sh --resolve <repoPath> — schedule § 0 only: the Project root a rollout of <repoPath>
# runs from. Exit 0 prints it: <repoPath> itself, exactly as given, when nothing matches, or the
# separate clone <repoPath>-rollout (<repoPath> canonicalised, then `-rollout` appended: a convention, not
# a setting) when <repoPath> matches and that clone is usable, which is when ALL hold, checked in this order:
#   1. it is a directory;
#   2. it is the top of a git work tree (`rev-parse --show-toplevel`, canonicalised, is it);
#   3. it is its own clone, not a linked worktree: its `--git-common-dir` (`--path-format=absolute`) is
#      inside it;
#   4. `land.sh --origin-slug` exits 0 for <repoPath> and for it, and the two <owner>/<name> match
#      (case-insensitively), so both origins are GitHub remotes of the same repository;
#   5. it holds no live plugin checkout itself (the match above finds nothing in it).
# Nothing else is asked of it: its branch, its working tree and how far it is behind origin are not a
# rollout's concern, since execute's worktrees branch from a freshly fetched origin/<default>, and the
# pushed-base check fetches every clone and blocks a local default branch that is ahead. Exit 3 is a match
# with no usable clone: the match lines, one `self-rollout-check: <clone> is not a usable rollout clone:
# <reason>` line naming the first condition that failed, and the fix, on stderr, nothing on stdout. Exit 2
# is the check unable to run (usage, python3 or land.sh missing). It never clones, fetches or writes.
# Repo-local git env inherited from a caller (a hook's GIT_DIR) is dropped first, so -C always wins (p12-3).
#
# self-rollout-check.sh --list-dirs — the registry read alone, as a list: every directory source's path and
# installLocation, canonicalised as above, one per line, de-duplicated; exit 0. A missing registry prints
# nothing; a malformed one prints nothing plus the stderr warning. Exit 2 on python3 missing or an extra
# argument. Its caller is skills/_shared/scripts/pushed-base.sh (p12-15), which reads it to find the other
# local clones of a rollout's repo, so this file stays the one parser of the registry.
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
usage() { echo "self-rollout-check: usage: self-rollout-check.sh <repoPath> | --resolve <repoPath> | --list-dirs" >&2; exit 2; }
mode=check
case "${1:-}" in
  --list-dirs) [ $# -eq 1 ] || usage; mode=list ;;
  --resolve) [ $# -eq 2 ] && [ -n "$2" ] || usage; mode=resolve; shift ;;
  *) [ $# -eq 1 ] && [ -n "$1" ] || usage ;;
esac

canon() {  # canon <path>: ~/ expanded, trailing slashes stripped, symlinks resolved when it exists
  local p="$1"
  case "$p" in "~") p=$HOME ;; "~/"*) p="$HOME/${p#\~/}" ;; esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  if [ -d "$p" ]; then (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"; else printf '%s\n' "$p"; fi
}

# load: the registry, parsed once into $entries ("<name><TAB><path>" lines, one per directory-source path).
# Warnings go to stderr, never a non-zero exit; python3 missing exits the script 2.
loaded=0; entries=
load() {
  [ "$loaded" = 1 ] && return 0; loaded=1
  command -v python3 >/dev/null 2>&1 || { echo "self-rollout-check: python3 not found" >&2; exit 2; }
  local reg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json"
  [ -f "$reg" ] || return 0
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
}

if [ "$mode" = list ]; then
  load
  [ -n "$entries" ] || exit 0
  while IFS="$(printf '\t')" read -r name p; do
    [ -n "$p" ] && canon "$p"
  done <<EOF | awk '!seen[$0]++'
$entries
EOF
  exit 0
fi

# live <canon path>: 0 with $what set to what matched when a live plugin root is that path or inside it,
# else 1. It returns rather than exits, so --resolve can ask it about the clone too.
live() {
  local want="$1" name p
  inside() { case "$1" in "$want"|"${want%/}/"*) return 0 ;; *) return 1 ;; esac; }
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && inside "$(canon "$CLAUDE_PLUGIN_ROOT")"; then
    what="the root this session runs the plugin from (\${CLAUDE_PLUGIN_ROOT} = $CLAUDE_PLUGIN_ROOT)"; return 0
  fi
  load
  while IFS="$(printf '\t')" read -r name p; do
    [ -n "$p" ] || continue
    inside "$(canon "$p")" && { what="the directory-source checkout of plugin marketplace '$name' ($p)"; return 0; }
  done <<EOF
$entries
EOF
  return 1
}

raw="$1"; R=$(canon "$1")
live "$R" || { [ "$mode" = resolve ] && printf '%s\n' "$1"; exit 0; }
match="$what"

# refuse [<reason>]: the match lines, the clone's reason line (when --resolve gave one), then the fix; exit 3.
refuse() {
  echo "self-rollout-check: $raw is, or contains, $match." >&2
  echo "self-rollout-check: the plugin runs live from it, so every engine change merged there becomes the engine of the rollout's next task call." >&2
  [ -z "${1:-}" ] || echo "self-rollout-check: $C is not a usable rollout clone: $1" >&2
  echo "self-rollout-check: make a separate clone at $R-rollout (git clone <origin URL> \"$R-rollout\"), then run /thread:schedule <project> --regenerate, which re-roots the rollout there; never hand-edit its Project root." >&2
  exit 3
}
[ "$mode" = resolve ] || refuse

# Unset git's own list of repo-local vars, except the two config channels, which cannot move the repo.
for v in $(git rev-parse --local-env-vars 2>/dev/null); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done
C="$R-rollout"
[ -d "$C" ] || refuse "nothing is there"
C=$(canon "$C")
t=$(git -C "$C" rev-parse --show-toplevel 2>/dev/null) && [ -n "$t" ] && [ "$(canon "$t")" = "$C" ] \
  || refuse "it is not the top of a git work tree"
gc=$(git -C "$C" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [ -n "$gc" ] && gc=$(canon "$gc")
case "$gc" in "$C"/*) ;; *) refuse "it is a linked worktree of ${gc:-another repository}, not a separate clone" ;; esac
lb="$(cd "$(dirname "$0")" && pwd -P)/../../_shared/scripts/land.sh"
[ -f "$lb" ] || { echo "self-rollout-check: land.sh not found at $lb" >&2; exit 2; }
a=$(bash "$lb" --origin-slug "$R") && [ -n "$a" ] || refuse "the origin of $R does not name a GitHub <owner>/<name>"
b=$(bash "$lb" --origin-slug "$C") && [ -n "$b" ] || refuse "its origin does not name a GitHub <owner>/<name>"
[ "$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$b" | tr '[:upper:]' '[:lower:]')" ] \
  || refuse "its origin is $b, not $a"
live "$C" && refuse "it holds a live plugin checkout too: $what"
printf '%s\n' "$C"
