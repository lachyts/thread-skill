#!/usr/bin/env bash
# The one handoff <home> resolver, skills/_shared/scripts/handoff-home.sh (handoff-lifecycle.md § Home),
# run against runtime-built temp HOMEs: every rule, --dir, --shared, --shared-root, a symlinked HOME, the
# known workspaces/docs oddity and the error exits. Then grep asserts that the skills call it instead of
# resolving <home> by hand, and carry the Run from:, open-captures and withdrawal contracts.
#
# Hermetic: every path lives under mktemp, HOME is a temp dir, GIT_CEILING_DIRECTORIES stops git walking
# above the temp root, git's repo-local vars (GIT_DIR & co.) are unset, and the resolver's own environment
# pins the system config, the global config, XDG_CONFIG_HOME and core.excludesFile, so a real
# ~/.config/git/ignore or global excludes file can never turn "not ignored" into "ignored". The poison
# case proves that pin. bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
root=$(pwd -P)
script="$root/skills/_shared/scripts/handoff-home.sh"

# A failed mktemp must stop the run here: `cd ""` succeeds and stays put, so $tmp would be this checkout,
# and the EXIT trap would rm -rf it. The trap goes in only once $tmp is proven fresh and not the checkout.
tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ] || [ "$tmp" = "$root" ]; then echo "FAIL - mktemp gave no usable temp dir [$tmp]"; exit 1; fi
trap 'rm -rf "$tmp"' EXIT

# hh <home> <cwd> [args] — runs the resolver; sets $out (stdout), $err (stderr) and $rc (exit code).
hh() {
  out=$(cd "$2" && unset XDG_CONFIG_HOME && HOME="$1" GIT_CEILING_DIRECTORIES="$tmp" \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0=/dev/null \
    bash "$script" "${@:3}" 2>"$tmp/err"); rc=$?
  err=$(cat "$tmp/err" 2>/dev/null)
}
tg() { GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c init.defaultBranch=main "$@"; }

# ---- fixtures -------------------------------------------------------------------------------------------
h="$tmp/h"; P="$h/Projects"; W="$h/repos/workspaces"; S="$W/_shared"; T="$h/repos/tools/tool"
mkdir -p "$P/Area/Proj/sub" "$P/Tutorials/X/sub" "$W/ws/sub" "$S/sub" "$W/docs/sub" "$T/sub" "$tmp/plain/sub"
tg init -q "$P"; printf 'Tutorials/\n' > "$P/.gitignore"   # ~/Projects is a monorepo that ignores Tutorials/
tg init -q "$W"                                            # ~/repos/workspaces is a repo too
tg init -q "$T"
ln -s "$h" "$tmp/hlink"                                    # a symlinked HOME (macOS /var → /private/var)
mkdir -p "$tmp/xdg/git"; printf 'docs/\n' > "$tmp/xdg/git/ignore"
printf '[core]\n\texcludesFile = %s\n' "$tmp/xdg/git/ignore" > "$tmp/poison"

# ---- the resolver -----------------------------------------------------------------------------------------
if [ -f "$script" ]; then ok y y "resolver exists"; else ok n y "resolver exists"; fi
if [ -f "$script" ]; then
  hh "$h" "$P/Area/Proj/sub"
  ok "$out" "$P/Area/Proj" "rule 1: a project subdirectory resolves to the project, not the Projects monorepo"
  ok "$rc" 0 "rule 1 exits 0"
  hh "$h" "$W/ws/sub";            ok "$out" "$W/ws" "rule 3: a seat subdirectory resolves to the seat"
  hh "$h" "$W/ws/sub" --shared;   ok "$out" "$S"    "rule 2: --shared from a seat resolves to _shared"
  hh "$h" "$W";                   ok "$out" "$S"    "rule 2: the workspaces root resolves to _shared"
  hh "$h" "$S/sub";               ok "$out" "$S"    "rule 2: a directory under _shared resolves to _shared"
  hh "$h" "$T/sub";               ok "$out" "$T"    "rule 4: a tool-repo subdirectory resolves to its toplevel"
  hh "$h" "$T/sub" --shared;      ok "$out" "$T"    "rule 4: --shared from a tool repo still resolves to its toplevel"
  hh "$h" "$tmp/plain/sub";       ok "$out" "$S"    "rule 5: a directory outside git resolves to _shared"
  hh "$h" "$P/Tutorials/X/sub";   ok "$out" "$S"    "rule 6: a project the monorepo ignores resolves to _shared"
  hh "$h" "$tmp/plain/sub" --dir "$P/Area/Proj/sub"
  ok "$out" "$P/Area/Proj" "--dir overrides \$PWD"
  hh "$tmp/hlink" "$tmp/hlink/Projects/Area/Proj/sub"
  ok "$out" "$P/Area/Proj" "a symlinked HOME resolves to the physical project path"
  hh "$h" "$tmp/plain/sub" --shared-root; ok "$out" "$S" "--shared-root prints _shared"
  hh "$h" "$W/docs/sub"
  ok "$out" "$W/docs" "known oddity (§ Home): workspaces/docs/… reads as a seat, per rule 3 as written"

  hh "$h" "$T/sub" --bogus
  ok "$rc" 2 "an unknown flag exits 2"
  ok "${err%%:*}" "handoff-home" "an unknown flag's stderr starts handoff-home:"
  ok "$out" "" "an unknown flag prints nothing on stdout"
  hh "$h" "$T/sub" --dir
  ok "$rc" 2 "--dir with no path exits 2"
  ok "${err%%:*}" "handoff-home" "--dir with no path: stderr starts handoff-home:"
  hh "$h" "$T/sub" --dir "$tmp/no-such-dir"
  ok "$rc" 2 "--dir naming a missing directory exits 2"
  ok "${err%%:*}" "handoff-home" "--dir naming a missing directory: stderr starts handoff-home:"

  # Poison: an outer XDG_CONFIG_HOME and global config that both ignore docs/. Unpinned, rule 6 would send
  # the tool repo to _shared (the control proves the poison bites); pinned, it stays at the toplevel.
  ctl=$(cd "$T/sub" && HOME="$h" GIT_CEILING_DIRECTORIES="$tmp" GIT_CONFIG_NOSYSTEM=1 \
    XDG_CONFIG_HOME="$tmp/xdg" GIT_CONFIG_GLOBAL="$tmp/poison" bash "$script" 2>/dev/null)
  ok "$ctl" "$S" "poison control: unpinned, a global docs/ ignore sends the tool repo to _shared (precondition)"
  out=$(XDG_CONFIG_HOME="$tmp/xdg" GIT_CONFIG_GLOBAL="$tmp/poison" hh "$h" "$T/sub"; printf '%s' "$out")
  ok "$out" "$T" "poison: the pinned environment keeps the tool repo at its toplevel"
fi

# ---- the skills call it -----------------------------------------------------------------------------------
# sect <file> <start-ERE> <stop-ERE> — from the first line matching start to the next matching stop.
# The patterns go through ENVIRON, not -v, which would eat their backslashes.
sect() { A="$2" B="$3" awk 'on && $0 ~ ENVIRON["B"] {exit} $0 ~ ENVIRON["A"] {on=1} on' "$1"; }
# fence <text> — the first fenced block inside it.
fence() { printf '%s\n' "$1" | awk '/^```/{n++; next} n==1'; }
# para <file> <label> — the bold-labelled paragraph, up to the next bold label, heading or blank line.
para() { A="^\\*\\*$2\\*\\*" awk 'on && (/^\*\*[A-Z]/ || /^#/ || /^$/) {exit} $0 ~ ENVIRON["A"] {on=1} on' "$1"; }

C=skills/close/SKILL.md; H=skills/handoff/SKILL.md; O=skills/open/SKILL.md; L=skills/_shared/handoff-lifecycle.md
cite='${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh'
ok "$(grep -c 'case "$PWD"' "$C")" 0 "close carries no case \"\$PWD\" resolver"
ok "$(grep -c 'case "$PWD"' "$H")" 0 "handoff carries no case \"\$PWD\" resolver"
has "$(cat "$C")" "$cite" "close cites the resolver by plugin path"
has "$(cat "$H")" "$cite" "handoff cites the resolver by plugin path"

has "$(fence "$(sect "$H" '^## Build the handoff prompt' '^## ')")" "Run from:" "handoff's prompt template carries Run from:"
has "$(para "$H" 'Shape\.')" "Run from:" "handoff's **Shape.** paragraph carries Run from:"
has "$(sect "$O" '^### `/thread:open <path-to-handoff-doc>`' '^### ')" "Run from" "open's handoff-doc pickup checks Run from"
has "$(sect "$O" '^### `/thread:open <slug>`' '^### ')" "Run from" "open's <slug> resume checks Run from"

ok "$(grep -c '^## Home$' "$L")" 1 "handoff-lifecycle.md has a ## Home section"
home_sec=$(sect "$L" '^## Home$' '^## ')
has "$home_sec" "thread:" "§ Home states ownership in _shared by thread:"
has "$home_sec" "workspaces/docs" "§ Home records the workspaces/docs oddity"
has "$(sect "$L" '^## Thread state' '^## ' | grep '^| `handoff`')" "captures" "§ Thread state's handoff row names the open captures"

oc=$(sect "$H" '^\*\*Open captures\.\*\*' '^(\*\*[A-Z]|## )')
has "$oc" "Superseded by handoff" "handoff's **Open captures.** writes Superseded by handoff"
has "$oc" '**Thread:**' "handoff's **Open captures.** matches on the **Thread:** link"
has "$oc" "left open" "handoff's **Open captures.** leaves a fuzzy-only match open"
lc=$(para "$H" 'Lifecycle\.')
has "$lc" "reopen" "handoff's withdrawal reopens the superseded captures"
has "$lc" "Superseded by handoff" "handoff's withdrawal finds them by Superseded by handoff"
wd=$(sect "$L" '^## Withdrawn' '^## ')
has "$wd" "reopen" "§ Withdrawn reopens the superseded captures"
has "$wd" "Superseded by handoff" "§ Withdrawn finds them by Superseded by handoff"

has "$(cat "$H")" "handoff: resolver failed" "handoff reports a failed resolver, never a guessed home"
has "$(cat "$C")" "handoff: scan failed" "close reports a failed scan"
has "$(cat "$C")" "handoff: none in" "close reports a scan that ran and found nothing"
own=$(sect "$C" '^A \*\*handoff doc\*\* is' '^$')
has "$own" 'ownership is by `thread:`' "close's ownership paragraph: in _shared, ownership is by thread:"

[ "$fail" = 0 ] && echo "handoff-home: ALL PASS" || echo "handoff-home: SOME FAILED"
exit "$fail"
