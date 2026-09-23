#!/usr/bin/env bash
# The handoff scan in skills/close/SKILL.md § The handoff owns the continuation, extracted by its marker
# and run against runtime-generated fixtures (LF and CRLF) and the four <home> resolutions, under bash and
# under `zsh -f` when zsh is installed (the Bash tool is zsh). Hermetic: every path lives under mktemp,
# HOME is a temp dir per case (the precondition git calls included), GIT_CEILING_DIRECTORIES stops git
# walking above the temp root, and git's repo-local vars (GIT_DIR & co.) are unset (a git hook running
# `make test` exports them, and they would point every git call here at the outer repo).
# bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)

# pwd -P: macOS $TMPDIR is under /var, a symlink to /private/var, and git rev-parse prints the resolved path.
# A failed mktemp must stop the run here: `cd ""` succeeds and stays put, so $tmp would be this checkout, the
# fixtures and `git init` would land in it, and the EXIT trap would rm -rf it, .git included. The trap goes
# in only once $tmp is proven to be a fresh directory that is not the checkout.
tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ] || [ "$tmp" = "$(pwd -P)" ]; then echo "FAIL - mktemp gave no usable temp dir [$tmp]"; exit 1; fi
trap 'rm -rf "$tmp"' EXIT

# ---- the scan, verbatim from the skill ---------------------------------------------------------------
# The awk exits non-zero unless an opener is followed by its closer: a closer moved above the opener would
# otherwise capture from the opener to EOF, and the find line would still be in that capture.
awk '/^# thread:handoff-scan/{on=1; next} /^# end thread:handoff-scan/{if(on) closed=1; on=0} on; END{exit !closed}' \
  skills/close/SKILL.md > "$tmp/scan.sh"; paired=$?
ok "$paired" 0 "the scan marker pair is closed and in order"
open=$(grep -c '^# thread:handoff-scan' skills/close/SKILL.md); close=$(grep -c '^# end thread:handoff-scan' skills/close/SKILL.md)
ok "$open" 1 "exactly one opening scan marker"
ok "$close" 1 "exactly one closing scan marker"
ok "$(grep -c '^find "\$home/docs/handoffs"' "$tmp/scan.sh")" 1 "scan snippet found in close/SKILL.md"
# Without the closing marker, or with it above the opener, awk would capture the rest of the SKILL and the
# scans would run prose.
if [ "$paired" != 0 ] || [ "$open" != 1 ] || [ "$close" != 1 ] || ! grep -q '^find "\$home/docs/handoffs"' "$tmp/scan.sh"; then
  echo "FAIL - the # thread:handoff-scan … # end thread:handoff-scan pair is not exactly once, in order, in skills/close/SKILL.md; nothing to run"
  exit 1
fi

# scan <shell> <cwd> <home> — runs the snippet; sets $out (its stdout) and $rc (its exit code).
# <shell> is `bash` or `zsh -f`, word-split on purpose.
scan() {
  out=$(cd "$2" && HOME="$3" GIT_CEILING_DIRECTORIES="$tmp" $1 "$tmp/scan.sh"); rc=$?
}
# `<status> <path>` lines → `<status> <basename>`, sorted. The path is the rest of the line, not $2, so a
# temp dir with a space in it stays whole.
names() { printf '%s\n' "$1" | awk 'NF{s=$1; sub(/^[^ ]+ /,""); sub(/.*\//,""); print s, $0}' | LC_ALL=C sort; }

# ---- fixtures, generated at runtime (never committed, so autocrlf cannot touch them) -----------------
th="$tmp/home"; d="$th/repos/workspaces/_shared/docs/handoffs"; mkdir -p "$d/sub" "$tmp/plain"
printf -- '---\nstatus: pending\n---\nbody\n'                         > "$d/lf-pending.md"
printf -- '---\r\nstatus: pending\r\n---\r\nbody\r\n'                 > "$d/crlf-pending.md"
printf -- '---\nstatus: consumed\n---\nbody\n'                        > "$d/lf-consumed.md"
printf -- '---\r\nstatus: consumed\r\n---\r\nbody\r\n'                > "$d/crlf-consumed.md"
printf -- '---\nstatus: "Pending"\n---\nbody\n'                       > "$d/quoted-pending.md"
printf -- '# A doc\nbody\n'                                           > "$d/no-fm.md"
printf -- '---\ntitle: x\n---\nbody\n'                                > "$d/fm-no-status.md"
printf -- '---\nstatus: draft\n---\nbody\n'                           > "$d/draft.md"
printf -- '---\r\ntitle: x\r\n---\r\nstatus: pending\r\n'             > "$d/fm-no-status-body-pending.md"
printf -- '---\ntitle: x\n---\nstatus: pending\n'                     > "$d/fm-no-status-body-lf.md"
printf -- '# A doc\nstatus: pending\n'                                > "$d/no-fm-body-pending.md"
printf -- '---\nstatus: pending\r\r\n---\nbody\n'                     > "$d/crcr-pending.md"   # awk strips one CR, tr the other
printf -- '---\nstatus: pending\n---\n'                               > "$d/notes.txt"
printf -- '---\nstatus: pending\n---\n'                               > "$d/sub/nested.md"
expected="consumed crlf-consumed.md
consumed lf-consumed.md
legacy fm-no-status-body-lf.md
legacy fm-no-status-body-pending.md
legacy fm-no-status.md
legacy no-fm-body-pending.md
legacy no-fm.md
pending crcr-pending.md
pending crlf-pending.md
pending lf-pending.md
pending quoted-pending.md
unknown(draft) draft.md"
expected=$(printf '%s\n' "$expected" | LC_ALL=C sort)

# ---- <home> cases: each its own HOME, so the _shared fixtures above never leak into its output --------
tg() { HOME="$1" GIT_CONFIG_NOSYSTEM=1 git -c init.defaultBranch=main "${@:2}"; }
pend() { mkdir -p "$1/docs/handoffs" && printf -- '---\nstatus: pending\n---\n' > "$1/docs/handoffs/lf-pending.md"; }
hg="$tmp/hg"; mkdir -p "$hg" "$tmp/repo/sub"; tg "$hg" init -q "$tmp/repo"; pend "$tmp/repo"
# ~/Projects and ~/repos are git repos here, as the ~/Projects monorepo is for real: the case block must win
# over git, or every project's handoffs pool at the monorepo toplevel.
hp="$tmp/hp"; mkdir -p "$hp/Projects/Area/Proj/sub"; pend "$hp/Projects/Area/Proj"; tg "$hp" init -q "$hp/Projects"
hw="$tmp/hw"; mkdir -p "$hw/repos/workspaces/ws/sub"; pend "$hw/repos/workspaces/ws"; tg "$hw" init -q "$hw/repos"
hn="$tmp/hn"; mkdir -p "$tmp/plain2/sub"; pend "$hn/repos/workspaces/_shared"
mkdir -p "$tmp/home2/repos/workspaces/_shared"   # an _shared with no docs/handoffs/

# top <dir> <home> — git's toplevel for <dir>, under that case's temp HOME and no system gitconfig (as tg).
top() { (cd "$1" && GIT_CEILING_DIRECTORIES="$tmp" tg "$2" rev-parse --show-toplevel 2>/dev/null); }
ok "$(top "$tmp/plain2/sub" "$hn" >/dev/null; echo $?)" 128 \
  "plain2/sub is outside any git repo (precondition)"
ok "$(top "$hp/Projects/Area/Proj/sub" "$hp")" "$hp/Projects" \
  "the project dir's git toplevel is the Projects monorepo, so the case diverges from git (precondition)"
ok "$(top "$hw/repos/workspaces/ws/sub" "$hw")" "$hw/repos" \
  "the workspace dir's git toplevel is ~/repos, so the case diverges from git (precondition)"

shells=("bash"); command -v zsh >/dev/null 2>&1 && shells+=("zsh -f")
for sh in "${shells[@]}"; do
  L="${sh%% *}:"

  # the fixture matrix, from a non-git dir → <home> is $HOME/repos/workspaces/_shared
  scan "$sh" "$tmp/plain" "$th"; got=$(names "$out")
  ok "$rc" 0 "$L fixture scan exits 0"
  # one check per $expected line (a here-string, not a pipe, so ok's $fail survives the loop)
  while IFS= read -r want; do
    f="${want#* }"
    ok "$(printf '%s\n' "$got" | awk -v f="$f" '$2==f' )" "$want" "$L $f reads ${want%% *}"
  done <<< "$expected"
  ok "$got" "$expected" "$L the whole list: 12 docs, no notes.txt, no sub/nested.md"

  # missing docs/handoffs/ → nothing printed, exit 0
  scan "$sh" "$tmp/plain" "$tmp/home2"
  ok "$out" "" "$L missing docs/handoffs/ prints nothing"
  ok "$rc" 0 "$L missing docs/handoffs/ exits 0"

  # the four <home> resolutions, each run from a sub/ directory
  scan "$sh" "$tmp/repo/sub" "$hg"
  ok "$out" "pending $tmp/repo/docs/handoffs/lf-pending.md" "$L <home> is the git toplevel"
  scan "$sh" "$hp/Projects/Area/Proj/sub" "$hp"
  ok "$out" "pending $hp/Projects/Area/Proj/docs/handoffs/lf-pending.md" "$L <home> is the project dir"
  scan "$sh" "$hw/repos/workspaces/ws/sub" "$hw"
  ok "$out" "pending $hw/repos/workspaces/ws/docs/handoffs/lf-pending.md" "$L <home> is the workspace dir"
  scan "$sh" "$tmp/plain2/sub" "$hn"
  ok "$out" "pending $hn/repos/workspaces/_shared/docs/handoffs/lf-pending.md" "$L <home> falls back to _shared outside git"
done

[ "$fail" = 0 ] && echo "handoff-scan: ALL PASS" || echo "handoff-scan: SOME FAILED"
exit "$fail"
