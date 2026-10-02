#!/usr/bin/env bash
# self-rollout-check.sh <repoPath> — refuse a rollout whose repoPath is a DIRECTORY-source plugin
# marketplace checkout (skills/execute/SKILL.md § 2.6, p12-4). With a directory source Claude Code runs
# the plugin live from that checkout (${CLAUDE_PLUGIN_ROOT} is it), so every engine change merged there
# becomes the engine of the rollout's next task call. Execute calls it through the
# `# thread:self-rollout-check` wrapper; it lives in a script because Claude Code substitutes skill
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
# Exit 3: a match — the marketplace, the path and the remedy on stderr.
# Exit 2: usage error (no or empty <repoPath>), or python3 missing.
#
# self-rollout-check.sh --list-dirs — the same registry read, as a list: every directory source's path and
# installLocation, canonicalised as above, one per line, de-duplicated; exit 0. A missing registry prints
# nothing; a malformed one prints nothing plus the stderr warning. Exit 2 on python3 missing or an extra
# argument. Its caller is skills/_shared/scripts/pushed-base.sh (p12-15), which reads it to find the other
# local clones of a rollout's repo, so this file stays the one parser of the registry.
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
list=0
if [ "${1:-}" = --list-dirs ]; then
  [ $# -eq 1 ] || { echo "self-rollout-check: usage: self-rollout-check.sh --list-dirs" >&2; exit 2; }
  list=1
fi
[ "$list" = 1 ] || { [ $# -eq 1 ] && [ -n "$1" ]; } || { echo "self-rollout-check: usage: self-rollout-check.sh <repoPath>" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "self-rollout-check: python3 not found" >&2; exit 2; }
reg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json"
[ -f "$reg" ] || exit 0

canon() {  # canon <path>: ~/ expanded, trailing slashes stripped, symlinks resolved when it exists
  local p="$1"
  case "$p" in "~") p=$HOME ;; "~/"*) p="$HOME/${p#\~/}" ;; esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p=${p%/}; done
  if [ -d "$p" ]; then (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"; else printf '%s\n' "$p"; fi
}

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
    echo "self-rollout-check: clone the repo to a separate path (e.g. ~/repos/<repo>-rollout), set the rollout's Project root to that clone, then re-invoke." >&2
    exit 3
  fi
done <<EOF
$entries
EOF
exit 0
