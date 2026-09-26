#!/usr/bin/env bash
# repo-thread-lookup.sh — thread lookup by slug, and the repo-thread list (skills/open/SKILL.md
# § Repo-thread lookup is the contract: tiers, exclusions, the CWD tiebreak). Callers run it through the
# `# thread:repo-thread-lookup` wrapper there; it lives in a script because Claude Code substitutes skill
# arguments into every positional `$N` in a SKILL.md body, awk's `$0` included (p5-2).
#
# Input from the environment: slug (empty lists every repo thread).
# stdout: one physical absolute path per line, nothing when there is no hit · stderr empty · exit 0.
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
: "${slug:=}"
nl='
'
fms() { awk '{ sub(/\r$/, "") } NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^slug:/{sub(/^slug:[ \t]*/, ""); print; exit}' "$1" | tr -d "\"'\r" | sed 's/[[:space:]]*$//'; }
hits=''
if [ -n "$slug" ] && [ -f "$HOME/repos/workspaces/_shared/threads/$slug.md" ]; then
  hits="$(cd "$HOME/repos/workspaces/_shared/threads" 2>/dev/null && pwd -P)/$slug.md"
fi
if [ -n "$slug" ] && [ -z "$hits" ] && [ -d "$HOME/Projects" ]; then
  p=$(cd "$HOME/Projects" 2>/dev/null && pwd -P)
  hits=$(find "$p" -maxdepth 5 \( -name _archive -o -name .claude -o -name .git -o -name node_modules \) -prune -o -name THREAD.md -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
    if [ "$(fms "$f")" = "$slug" ]; then printf '%s\n' "$f"; fi
  done)
fi
if [ -z "$hits" ] && [ -d "$HOME/repos" ]; then
  r=$(cd "$HOME/repos" 2>/dev/null && pwd -P)
  hits=$(find "$r" -maxdepth 3 -name THREAD.md -not -path '*/.claude/*' -not -path "$r/obsidian/*" -not -path "$r/workspaces/*" 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
    s=$(fms "$f"); if [ -z "$s" ]; then d=${f%/THREAD.md}; s=${d##*/}; fi
    if [ -z "$slug" ] || [ "$s" = "$slug" ]; then printf '%s\n' "$f"; fi
  done)
  if [ -n "$slug" ] && [ -n "$hits" ] && t=$(git rev-parse --show-toplevel 2>/dev/null); then
    case "$nl$hits$nl" in *"$nl$t/THREAD.md$nl"*) hits="$t/THREAD.md" ;; esac
  fi
fi
if [ -n "$hits" ]; then printf '%s\n' "$hits"; fi
