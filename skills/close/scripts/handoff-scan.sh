#!/usr/bin/env bash
# handoff-scan.sh — thread:close's handoff scan (skills/close/SKILL.md § The handoff owns the continuation,
# which is the contract: inputs, output lines, ownership and failure paths). Close calls it through the
# `# thread:handoff-scan` wrapper there; it lives in a script because Claude Code substitutes skill
# arguments into every positional `$N` in a SKILL.md body, awk's `$0` included (p5-2).
#
# Inputs from the environment, each defaulting to empty: slug, shared, pointer.
# stdout: `<status> <path>` lines only · stderr: `# scanned <dir>` and `handoff-scan:` notes.
# Exit 0, or 2 when the <home> resolver is missing or prints nothing (then stdout is empty).
# Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
: "${slug:=}" "${shared:=}" "${pointer:=}"
hh="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/_shared/scripts/handoff-home.sh"   # skills/_shared, beside this skill
if [ ! -f "$hh" ]; then echo "handoff-scan: resolver not found at $hh" >&2; exit 2; fi
if [ -n "$shared" ]; then home="$(bash "$hh" --shared)" || home=''; else home="$(bash "$hh")" || home=''; fi
shd="$(bash "$hh" --shared-root)" || shd=''
if [ -z "$home" ] || [ -z "$shd" ]; then echo "handoff-scan: no <home> (resolver failed)" >&2; exit 2; fi
thr() { awk '{ sub(/\r$/, "") } NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^thread:/{sub(/^thread:[ \t]*/, ""); print; exit}' "$1" | tr -d "\"'\r" | sed 's/[[:space:]]*$//'; }
mine() { if [ -n "$slug" ] && [ "$(dirname "$1")" = "$shd/docs/handoffs" ] && [ "$(thr "$1")" != "$slug" ]; then return 1; fi; }
cls() {
  s="$(awk '{ sub(/\r$/, "") } NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^status:/{print $2; exit}' "$1" | tr -d "\"'\r" | tr '[:upper:]' '[:lower:]')"
  case "$s" in pending|consumed) ;; "") s=legacy ;; *) s="unknown($s)" ;; esac
  echo "$s $1"
}
scan_one() {
  echo "# scanned $1" >&2
  find "$1" -maxdepth 1 -name '*.md' 2>/dev/null | while IFS= read -r f; do
    if mine "$f"; then cls "$f"; fi
  done
}
scan_one "$home/docs/handoffs"
sd=''
if [ -n "$shared" ] && [ -n "$slug" ] && [ "$home" != "$shd" ]; then sd="$shd/docs/handoffs"; scan_one "$sd"; fi
if [ -n "$pointer" ]; then
  p="$pointer"
  if [ "${p%"${p#??}"}" = '~/' ]; then p="$HOME/${p#??}"; fi
  if [ "${p#/}" = "$p" ]; then echo "handoff-scan: pointer not absolute ($p) — not classified" >&2
  elif [ ! -f "$p" ]; then echo "handoff-scan: pointer missing ($p)" >&2
  else
    pf="$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"
    if { [ "$(dirname "$pf")" = "$home/docs/handoffs" ] || [ "$(dirname "$pf")" = "$sd" ]; } && [ "${pf%.md}" != "$pf" ] && mine "$pf"; then :; else cls "$pf"; fi
  fi
fi
