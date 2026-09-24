#!/usr/bin/env bash
# handoff-home.sh — the one handoff <home> resolver (skills/_shared/handoff-lifecycle.md § Home).
# thread:handoff calls it to place a doc, thread:close's handoff scan calls it to find one; nothing else
# resolves <home>. Always run as `bash "<path>"`. bash 3.2-compatible (macOS), no network.
#
# Usage: handoff-home.sh [--shared] [--dir <path>]   prints the absolute <home> for <path> (default $PWD)
#        handoff-home.sh --shared-root                prints $HOME/repos/workspaces/_shared
# Exit 0 with one stdout line; exit 2 with a stderr line starting "handoff-home:" on a usage error.
#
# Rules, on physical paths, first hit wins:
#   1. under $HOME/Projects/<Area>/<Project>/            → that project directory
#   2. $HOME/repos/workspaces itself, anything under its _shared/, or --shared under a seat → _shared
#   3. under $HOME/repos/workspaces/<ws>/                → that seat
#   4. inside a git repo                                  → its toplevel
#   5. otherwise                                          → _shared
#   6. last: when <home>'s repo ignores docs/handoffs/ (check-ignore exits 0) → _shared
set -euo pipefail

die() { echo "handoff-home: $*" >&2; exit 2; }
shared=0; root_only=0; dir=''
while [ $# -gt 0 ]; do
  case "$1" in
    --shared)      shared=1; shift ;;
    --shared-root) root_only=1; shift ;;
    --dir)         [ $# -ge 2 ] || die "--dir needs a path"; dir=$2; shift 2 ;;
    *)             die "unknown argument: $1 (usage: [--shared] [--dir <path>] | --shared-root)" ;;
  esac
done

# phys <path> — the physical path when it exists (macOS /var → /private/var), else the path as given.
phys() { if [ -d "$1" ]; then (cd "$1" && pwd -P); else printf '%s' "$1"; fi; }
h=$(phys "$HOME")
projects=$(phys "$h/Projects")
ws=$(phys "$h/repos/workspaces")
shared_root=$(phys "$ws/_shared")

if [ "$root_only" = 1 ]; then printf '%s\n' "$shared_root"; exit 0; fi

start=${dir:-$PWD}
[ -d "$start" ] || die "no such directory: $start"
d=$(cd "$start" && pwd -P)

case "$d/" in
  "$projects"/*/*/*)
    rest=${d#"$projects"/}; area=${rest%%/*}; rest=${rest#*/}; proj=${rest%%/*}
    home="$projects/$area/$proj" ;;
  "$ws/" | "$shared_root/"*)
    home=$shared_root ;;
  "$ws"/*/*)
    if [ "$shared" = 1 ]; then home=$shared_root
    else rest=${d#"$ws"/}; home="$ws/${rest%%/*}"; fi ;;
  *)
    if top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && [ -n "$top" ]; then home=$top
    else home=$shared_root; fi ;;
esac

# Rule 6: only exit 0 means ignored; 1 (not ignored) and 128 (outside git) leave <home> as it is.
if [ "$home" != "$shared_root" ] && git -C "$home" check-ignore -q docs/handoffs/x.md 2>/dev/null; then
  home=$shared_root
fi

printf '%s\n' "$home"
