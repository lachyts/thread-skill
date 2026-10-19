#!/usr/bin/env bash
# self-rollout-check.sh — the rollout clone's one script (ADR 0042, built by p26-2; p12-4 before it). Every
# parallel rollout scheduled after P26 runs from its rollout clone `<toplevel>-rollout`, a second full clone of
# the repository beside its toplevel, never nested inside it. The checkout Lachy's sessions work in is its
# in-place twin. Modes:
#
#   <repoPath>                            execute § 2.6: is <repoPath> the plugin's live checkout?
#   --resolve <Local:>                    schedule § 0 and estate-scan.py: the Project root, read-only
#   --ensure <Local:>                     schedule § 0: the Project root, its clone made or refreshed
#   --refresh <Project root>              execute § 2.7: fast-forward a clone root at an entry point
#   --refresh-in-place <Project root>     merge-task.sh and the completion ceremony: fast-forward its twin
#   --launch-check <Project root> <dir>   execute § 2.8, repair § 4 and orient § 9: the lead's launch directory
#   --in-place <path>                     is <path> inside a rollout clone, and what is its twin
#   --list-dirs                           pushed-base.sh: the registry's directory sources
#
# Always run as `bash "<path>"`; it lives in a script because Claude Code substitutes skill arguments into every
# positional `$N` in a SKILL.md body (p5-2). Repo-local git env inherited from a caller (a hook's GIT_DIR) is
# dropped first, so -C always wins (p12-3), and CDPATH is unset. bash 3.2-compatible (macOS).
#
# ---- <repoPath> (plain): refuse a Project root that holds the plugin's own live checkout (execution-fit.md
# § Dispatch blockers, Self-rollout). With a directory-source marketplace, or a `--plugin-dir` session, Claude Code
# runs the plugin live from that checkout (${CLAUDE_PLUGIN_ROOT} is it), so every engine change merged there
# becomes the engine of the rollout's next task call. Two sources, each compared with <repoPath> by CONTAINMENT (a
# path equal to <repoPath> or nested inside it, `<repoPath>/…`, a monorepo with the plugin in a subdirectory,
# matches, because merge-task.sh fast-forwards the whole checkout), every path with `~/` expanded, trailing slashes
# stripped and, when the directory exists, `pwd -P` applied (so a symlink matches its target; a path that does not
# exist yet compares as a string):
#   1. ${CLAUDE_PLUGIN_ROOT}, when set: the plugin root this session is running from, which also covers a
#      `--plugin-dir` session the registry never lists;
#   2. ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json: every entry whose source.source
#      is "directory", its source.path and installLocation.
# Exit 0: no match. A missing registry is 0; a malformed one or an unknown shape is 0 with a stderr warning (fail
# open: the registry format belongs to Claude Code, not this plugin). Exit 3: a match: what matched and the path
# on stderr, then the fix. Exit 2: usage error (no or empty <repoPath>), or python3 missing.
#
# ---- --in-place <path>: the one statement of "is this inside a rollout clone, and what is its twin". Exit 0 prints
# the twin when ALL hold: T, the canonical toplevel of <path>, is named `<S>-rollout`; `T/.git` is a directory (its
# own clone, never a linked worktree); `dirname(T)/<S>/.git` is a directory (the twin is a main checkout); and
# `land.sh --origin-slug` exits 0 for both, the two <owner>/<name> equal case-insensitively. The twin printed is
# `dirname(T)/<S>` plus <path>'s sub-path below T when the twin holds that sub-path, else the twin's toplevel.
# Exit 1: not inside a rollout clone (a missing path, outside git, a plain `foo-rollout` with no same-origin
# sibling). Exit 2: the check cannot run (usage, land.sh missing).
#
# ---- --resolve <Local:>: read-only; its callers are schedule § 0 and estate-scan.py. In order:
#   1. <Local:> is not in a git work tree: exit 3, `<L> has no rollout clone: it is not in a git work tree`.
#   2. Its toplevel T is a linked worktree (`--git-dir` differs from `--git-common-dir`; a submodule passes):
#      exit 3, "point Local: at the main checkout".
#   3. T is the ~/Projects monorepo: exit 3 (a text-only monorepo of project directories, never a Project root).
#   4. T's origin is missing or not a GitHub <owner>/<name> (`land.sh --origin-slug` fails): exit 5, stdout empty,
#      stderr `no GitHub origin in <T>: run the remote check (execution-fit.md § Dispatch blockers, GitHub origin)`.
#   5. The clone C is T itself when `--in-place T` exits 0, else `<T>-rollout`; <Local:> maps to `C[/<sub>]`, its
#      sub-path below T kept, never to a nested clone.
#   6. C absent: exit 4. stdout carries the would-be `C[/<sub>]`, stderr names the origin URL, and, when
#      dirname(C) is inside another work tree P, `nested in <P>: <P> must ignore <rel>/; --ensure checks that
#      before it clones`.
#   7. C present must be usable, else exit 3 with `<C> is not a usable rollout clone: <reason>`. Usable means, in
#      this order: a directory; the top of a git work tree; its own clone (its `--git-common-dir` inside it); the
#      same GitHub <owner>/<name> as T; no live plugin checkout in it (the plain mode's match); and, when it sits
#      inside a work tree P, `git -C P check-ignore -q -- <rel>/` exits 0 (P never tracks it). Its branch, working
#      tree and lag are not asked: execute's worktrees branch from a freshly fetched origin/<default>.
#   8. Exit 0 prints `C[/<sub>]`. A `<sub>` missing from C is no refusal here: --resolve never fetches, so C may
#      only be behind origin (a seat pushed since the clone was made). It adds a stderr `note:` that C has no <sub>
#      yet, and --ensure, which fast-forwards C first, is the one that refuses when C still lacks it.
# Exit 2 is the check unable to run (usage, python3 or land.sh missing). It never clones, fetches or writes.
#
# ---- --ensure <Local:>: schedule § 0 only, after the remote, gh and landing-register checks and Lachy's yes to the
# clone (exit 4 above). In order: --resolve's steps 1-5 (exits 3, 5 and 2 pass through); C absent and dirname(C)
# inside a work tree P: `mkdir C`, then `git -C P check-ignore -q -- <rel>/`, and when that is not 0, `rmdir C` and
# exit 3 (P would track the clone: its next `git add -A`, the daily sweep's, would embed it as a gitlink); C absent:
# one `git clone -- <raw remote.origin.url of T> <C>` with GIT_TERMINAL_PROMPT=0 and `ssh -o BatchMode=yes` unless
# the operator set an ssh command (land.sh's rule), a failed clone exiting 2 with git's first line and the probe
# directory removed; the usable-clone checks, re-run on every invocation; the clone refresh (below); the local-state
# notes (below); then `C[/<sub>]` on stdout, or exit 3 when C still lacks `<sub>` after the refresh: "land <sub>
# first" when origin/<default> lacks it too, else that the clone could not move to it (the refresh's note says why).
# Exits: 0, 2, 3, 5.
#   Local-state notes. A fresh clone lacks only gitignored state, and nothing is copied: one `note:` per item on a
#   fixed list that the in-place checkout has and the clone lacks, at the toplevel and at the root's sub-path, on
#   every run: `.claude/settings.local.json`, `CLAUDE.local.md`, `.env`, `.env.local`, `.envrc`, an untracked
#   `.mcp.json`, and the local git config keys user.name, user.email and core.hooksPath. A `WARN:` for a
#   `.workspace-launch.json` with no `.mcp.json` beside it in the clone: the Chorus Stage refuses a Session there.
#
# ---- The clone refresh (--ensure; --refresh <Project root>, execute § 2.7 at entry points only, just before
# pushed-base): `git fetch origin <default>`, then, with the default branch checked out,
# `git merge --ff-only --no-autostash origin/<default>`. A clone that cannot move (another branch, an operation in
# progress, local commits, a dirty overlap) gets a `note:` and stays put, and so does a failed fetch. --refresh does
# nothing on a root `--in-place` does not name (a pre-P26 in-place root, which merge-task already moves), and a
# refresh that changes CLAUDE.md, AGENTS.md, CLAUDE.local.md, .mcp.json or anything under .claude/, at the root or
# an ancestor of it up to the toplevel, prints a relaunch `WARN:`: the lead loaded the old copy. It never halts:
# every line goes to stderr, exit 0 (2 on usage).
#
# ---- --refresh-in-place <Project root>: the in-place twin gets the rollout's merges (merge-task.sh after every
# merge; the completion ceremony once, after its `status: done` stamp). Nothing for a root `--in-place` does not
# name. A twin that is the plugin's primary checkout while a rollout runs is held (primary-hold.sh, ADR 0031).
# Otherwise it fetches origin/<default> in the twin (land.sh's ssh and prompt rule) and runs only
# `git merge --ff-only --no-autostash`: never a merge commit, a rebase or an autostash, never during an operation.
# One stdout line, `in-place: <twin> …`, or nothing:
#   held: <primary-hold line> (ADR 0031) · not moved: fetch failed: <first line> · not moved: on '<b>', not <d> ·
#   not moved: an operation is in progress · fast-forwarded to origin/<d> (<old7>..<new7>) · not moved: local
#   changes overlap origin/<d> · ahead: <repo-state.sh line> · already at origin/<d> ·
#   not moved: diverged: <N> local-only commit(s) (<repo-state.sh line>), <M> behind origin/<d>; <remedy>
# The diverged remedy follows the twin's landing route, `land.sh --route <twin>`: `commit-only: <reason>` (swept by
# the daily sweep, listed on the landing register) gives the `git -C <twin> merge --no-edit origin/<d>` advice;
# `landable` waits for its queued landing PR, which the next merge-task or land.sh S4 fast-forwards, plus a
# stranded addendum when repo-state.sh counts stranded commits; `unknown: <reason>` names no route. Exit 0 always;
# 2 only on a usage error, so it never changes merge-task's exit.
#
# ---- --launch-check <Project root> <launch dir>: a lead's tools reset any `cd` outside its launch directory, so it
# must launch at the Project root, or at an ancestor of it at or below the root's toplevel. Exit 0 passes; exit 3
# fails with the remedy on stderr. A root `--in-place` does not name (a rollout scheduled before ADR 0042) passes
# with a stderr `WARN:`. Exit 2 on usage.
#
# ---- --list-dirs: the registry read alone, as a list: every directory source's path and installLocation,
# canonicalised as above, one per line, de-duplicated; exit 0. A missing registry prints nothing; a malformed one
# prints nothing plus the stderr warning. Exit 2 on python3 missing or an extra argument. Its caller is
# skills/_shared/scripts/pushed-base.sh (p12-15), so this file stays the one parser of the registry.
usage() { echo "self-rollout-check: usage: self-rollout-check.sh <repoPath> | --resolve <Local:> | --ensure <Local:> | --refresh <Project root> | --refresh-in-place <Project root> | --launch-check <Project root> <launch dir> | --in-place <path> | --list-dirs" >&2; exit 2; }
mode=check
case "${1:-}" in
  --list-dirs) [ $# -eq 1 ] || usage; mode=list ;;
  --resolve|--ensure|--refresh|--refresh-in-place|--in-place) [ $# -eq 2 ] && [ -n "$2" ] || usage; mode=${1#--}; shift ;;
  --launch-check) [ $# -eq 3 ] && [ -n "$2" ] && [ -n "$3" ] || usage; mode=launch-check; shift ;;
  *) [ $# -eq 1 ] && [ -n "$1" ] || usage ;;
esac

unset CDPATH
# Unset git's own list of repo-local vars, except the two config channels, which cannot move the repo.
for v in $(git rev-parse --local-env-vars 2>/dev/null); do case $v in GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS) ;; *) unset "$v" ;; esac; done
here=$(cd "$(dirname "$0")" && pwd -P)
LAND="$here/../../_shared/scripts/land.sh"
REPO_STATE="$here/../../close/scripts/repo-state.sh"
HOLD_SH="$here/../../_shared/scripts/primary-hold.sh"
SR=self-rollout-check

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
  command -v python3 >/dev/null 2>&1 || { echo "$SR: python3 not found" >&2; exit 2; }
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

# live <canon path>: 0 with $what set to what matched when a live plugin root is that path or inside it, else 1.
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

if [ "$mode" = check ]; then
  raw="$1"; R=$(canon "$1")
  live "$R" || exit 0
  echo "$SR: $raw is, or contains, $what." >&2
  echo "$SR: the plugin runs live from it, so every engine change merged there becomes the engine of the rollout's next task call." >&2
  echo "$SR: run it from its rollout clone at $R-rollout (git clone <origin URL> \"$R-rollout\"): /thread:schedule <project> --regenerate makes the clone when it is missing and re-roots the rollout there (ADR 0042); never hand-edit its Project root." >&2
  exit 3
fi

# ---- shared helpers for the clone modes ----------------------------------------------------------------------
need_land() { [ -f "$LAND" ] || { echo "$SR: land.sh not found at $LAND" >&2; exit 2; }; }
slug_of() { bash "$LAND" --origin-slug "$1" 2>/dev/null; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
toplevel() {  # toplevel <dir>: its canonical git toplevel, or fail
  local t
  t=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) && [ -n "$t" ] && canon "$t"
}
first() { printf '%s\n' "$1" | sed -n '/[^[:space:]]/{s/^[[:space:]]*//;p;q;}' | cut -c1-200; }
ssh_rule() {  # land.sh's rule: never prompt, and batch ssh unless the operator set an ssh command
  export GIT_TERMINAL_PROMPT=0
  if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -z "${GIT_SSH:-}" ] && [ -z "$(git config core.sshCommand 2>/dev/null)" ]; then
    export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
  fi
}
in_op() {  # in_op <repo>: 0 when a half-applied operation is in progress (close 7.1(c)'s list)
  local m
  for m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
    [ -e "$(git -C "$1" rev-parse --path-format=absolute --git-path "$m" 2>/dev/null)" ] && return 0
  done
  return 1
}
default_of() {  # default_of <repo>…: the first local origin/HEAD symref among them, else origin's answer
  local r d
  for r in "$@"; do
    d=$(git -C "$r" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null) && d=${d#refs/remotes/origin/} && [ -n "$d" ] \
      && { printf '%s\n' "$d"; return 0; }
  done
  bash "$here/default-branch.sh" "$1" 2>/dev/null
}

# in_place <path>: 0 with TWIN (the twin path for <path>) and TWIN_TOP (the twin's toplevel) set, else 1.
in_place() {
  local p d t s a b sub
  p=$(canon "$1")
  if [ -d "$p" ]; then d=$p
  elif [ -e "$p" ]; then d=$(canon "$(dirname "$p")"); p="$d/${p##*/}"
  else return 1; fi
  t=$(toplevel "$d") || return 1
  case "${t##*/}" in ?*-rollout) ;; *) return 1 ;; esac
  s=${t%-rollout}
  [ -d "$t/.git" ] && [ ! -L "$t/.git" ] && [ -d "$s/.git" ] || return 1
  a=$(slug_of "$t") && [ -n "$a" ] || return 1
  b=$(slug_of "$s") && [ -n "$b" ] || return 1
  [ "$(lower "$a")" = "$(lower "$b")" ] || return 1
  case "$p" in "$t") sub='' ;; "$t"/*) sub=${p#"$t"/} ;; *) sub='' ;; esac
  TWIN_TOP=$s
  if [ -n "$sub" ] && [ -e "$s/$sub" ]; then TWIN="$s/$sub"; else TWIN=$s; fi
  return 0
}

if [ "$mode" = in-place ]; then
  need_land
  in_place "$1" || exit 1
  printf '%s\n' "$TWIN"
  exit 0
fi

# resolve_root <Local:>: --resolve's steps 1-5. Sets L, T, SUB, C, IP (the in-place checkout), URL, P and REL
# (the work tree dirname(C) sits in, and C below it), or exits 3, 5 or 2.
resolve_root() {
  local raw="$1" gd gcd pt
  L=$(canon "$raw")
  if [ ! -d "$L" ] || ! T=$(toplevel "$L"); then
    echo "$SR: $raw has no rollout clone: it is not in a git work tree" >&2; exit 3
  fi
  gd=$(git -C "$L" rev-parse --path-format=absolute --git-dir 2>/dev/null)
  gcd=$(git -C "$L" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ -z "$gd" ] || [ -z "$gcd" ] || [ "$(canon "$gd")" != "$(canon "$gcd")" ]; then
    echo "$SR: $raw has no rollout clone: $T is a linked worktree of ${gcd:-another repository}, not a main checkout: point Local: at the main checkout" >&2
    exit 3
  fi
  if [ "$T" = "$(canon "$HOME/Projects")" ]; then
    echo "$SR: $raw has no rollout clone: ~/Projects is a text-only monorepo of project directories, never a Project root" >&2
    echo "$SR: give the code its own repo (a nested repo listed in ~/Projects/.gitignore, or one under ~/repos) and point Local: there; work with no machine check is serial-shaped (schedule § Serial path)" >&2
    exit 3
  fi
  need_land
  slug_of "$T" >/dev/null || {
    echo "$SR: no GitHub origin in $T: run the remote check (execution-fit.md § Dispatch blockers, GitHub origin)" >&2; exit 5; }
  TSLUG=$(slug_of "$T")
  case "$L" in "$T") SUB='' ;; "$T"/*) SUB=${L#"$T"/} ;; *) SUB='' ;; esac
  if in_place "$T"; then C=$T; IP=$TWIN_TOP; else C="$T-rollout"; IP=$T; fi
  URL=$(git -C "$T" config --get remote.origin.url 2>/dev/null)
  P=''; REL=''
  if pt=$(toplevel "$(dirname "$C")"); then P=$pt; REL=${C#"$P"/}; fi
}
out_path() { if [ -n "$SUB" ]; then printf '%s/%s\n' "$C" "$SUB"; else printf '%s\n' "$C"; fi; }
not_usable() {
  echo "$SR: $C is not a usable rollout clone: $1" >&2
  echo "$SR: a rollout clone's place is a convention, not a setting: fix or move aside what is at $C, then re-run /thread:schedule" >&2
  exit 3
}
usable() {  # the usable-clone checks, in order; exits 3 naming the first that fails
  local t gc b
  [ -d "$C" ] || not_usable "it is not a directory"
  C=$(canon "$C")
  t=$(toplevel "$C") && [ "$t" = "$C" ] || not_usable "it is not the top of a git work tree"
  gc=$(git -C "$C" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [ -n "$gc" ] && gc=$(canon "$gc")
  case "$gc" in "$C"/*) ;; *) not_usable "it is a linked worktree of ${gc:-another repository}, not its own clone" ;; esac
  b=$(slug_of "$C") && [ -n "$b" ] || not_usable "its origin does not name a GitHub <owner>/<name>"
  [ "$(lower "$b")" = "$(lower "$TSLUG")" ] || not_usable "its origin is $b, not $TSLUG"
  live "$C" && not_usable "it holds a live plugin checkout: $what"
  if [ -n "$P" ] && ! git -C "$P" check-ignore -q -- "$REL/" 2>/dev/null; then
    not_usable "$P would track it (its ignore rules do not cover $REL/), so its next git add -A (the daily sweep's) would embed it as a gitlink: add /$REL/ to $P's .gitignore"
  fi
}
sub_missing() { [ -n "$SUB" ] && [ ! -d "$C/$SUB" ]; }
sub_present() {  # --ensure only, after the refresh: exits 3 when C still lacks <sub>
  local d
  sub_missing || return 0
  d=$(default_of "$C") || d=''
  if [ -n "$d" ] && [ "$(git -C "$C" cat-file -t "refs/remotes/origin/$d:$SUB" 2>/dev/null)" = tree ]; then
    echo "$SR: $C has no $SUB, though origin/$d has it: the clone could not fast-forward to origin/$d (the note above says why), so fix that in $C, then re-run /thread:schedule" >&2
  else
    echo "$SR: $C has no $SUB: the rollout clone holds only what origin holds, so land $SUB first (commit it and land it on origin's default branch), then re-run /thread:schedule" >&2
  fi
  exit 3
}

# refresh_clone <clone> <root sub-path> <warn 1|0>: fetch, then a fast-forward on the default branch. stderr only.
refresh_clone() {
  local c="$1" sub="$2" warn="$3" d cur old new e f a pfx changed=''
  d=$(default_of "$c") || d=''
  [ -n "$d" ] || { echo "$SR: note: $c not refreshed: origin's default branch is unresolved" >&2; return 0; }
  ssh_rule
  if ! e=$(git -C "$c" fetch -q origin "$d" 2>&1); then
    echo "$SR: note: $c not refreshed: fetch failed: $(first "$e")" >&2; return 0
  fi
  cur=$(git -C "$c" symbolic-ref -q --short HEAD 2>/dev/null)
  [ "$cur" = "$d" ] || { echo "$SR: note: $c not refreshed: on '${cur:-a detached HEAD}', not $d" >&2; return 0; }
  in_op "$c" && { echo "$SR: note: $c not refreshed: an operation is in progress" >&2; return 0; }
  old=$(git -C "$c" rev-parse -q --verify HEAD 2>/dev/null)
  if git -C "$c" merge-base --is-ancestor "refs/remotes/origin/$d" HEAD 2>/dev/null; then
    if [ "$(git -C "$c" rev-parse -q --verify "refs/remotes/origin/$d")" = "$old" ]; then
      echo "$SR: refreshed $c: already at origin/$d" >&2
    else
      echo "$SR: note: $c is ahead of origin/$d ($(bash "$REPO_STATE" "$c" 2>/dev/null)): nothing in a rollout commits on a clone's default branch, so pushed-base names them" >&2
    fi
    return 0
  fi
  if ! git -C "$c" merge-base --is-ancestor HEAD "refs/remotes/origin/$d" 2>/dev/null; then
    echo "$SR: note: $c not refreshed: diverged from origin/$d ($(bash "$REPO_STATE" "$c" 2>/dev/null))" >&2; return 0
  fi
  if ! git -C "$c" merge -q --ff-only --no-autostash "refs/remotes/origin/$d" >/dev/null 2>&1; then
    echo "$SR: note: $c not refreshed: local changes overlap origin/$d" >&2; return 0
  fi
  new=$(git -C "$c" rev-parse -q --verify HEAD 2>/dev/null)
  echo "$SR: refreshed $c: fast-forwarded to origin/$d (${old:0:7}..${new:0:7})" >&2
  [ "$warn" = 1 ] || return 0
  # The lead's own config: CLAUDE.md, AGENTS.md, CLAUDE.local.md, .mcp.json or .claude/ at the root or an ancestor.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    a=$sub
    while :; do
      if [ -n "$a" ]; then pfx="$a/"; else pfx=''; fi
      case "$f" in "${pfx}CLAUDE.md"|"${pfx}AGENTS.md"|"${pfx}CLAUDE.local.md"|"${pfx}.mcp.json"|"${pfx}.claude/"*)
        changed="$changed $f"; break ;; esac
      [ -n "$a" ] || break
      case "$a" in */*) a=${a%/*} ;; *) a='' ;; esac
    done
  done <<EOF
$(git -C "$c" -c core.quotePath=false diff --no-renames --name-only "$old" "$new" 2>/dev/null)
EOF
  [ -z "$changed" ] || echo "$SR: WARN: the refresh changed the lead's own config ($(printf '%s' "$changed" | sed 's/^ //; s/ /, /g')): this session loaded the old copy, so start a fresh session in $c${sub:+/$sub}, then /thread:execute the rollout again to pick it up" >&2
}

# local_notes: the gitignored state the in-place checkout has and the clone lacks; nothing is copied. Checked at the
# toplevel and at the root's sub-path.
notes_at() {  # notes_at <in-place dir> <clone dir> <sub-path prefix, '' or 'sub/'>
  local ip="$1" c="$2" rel="$3" f
  [ -d "$ip" ] && [ -d "$c" ] || return 0
  for f in .claude/settings.local.json CLAUDE.local.md .env .env.local .envrc; do
    if [ -e "$ip/$f" ] && [ ! -e "$c/$f" ]; then
      echo "$SR: note: $c lacks $f, which $ip has: gitignored local state is never copied; copy it by hand if the lead needs it" >&2
    fi
  done
  if [ -e "$ip/.mcp.json" ] && [ ! -e "$c/.mcp.json" ] && ! git -C "$IP" ls-files --error-unmatch -- "${rel}.mcp.json" >/dev/null 2>&1; then
    echo "$SR: note: $c lacks the untracked .mcp.json that $ip has: its local MCP servers are not there; copy or regenerate it if the lead needs them" >&2
  fi
  if [ -e "$c/.workspace-launch.json" ] && [ ! -e "$c/.mcp.json" ]; then
    echo "$SR: WARN: $c/.workspace-launch.json has no .mcp.json beside it: the Chorus Stage refuses a Session there (launch.py LaunchRefused) until one is generated or copied in" >&2
  fi
}
local_notes() {
  local k
  notes_at "$IP" "$C" ''
  [ -z "$SUB" ] || notes_at "$IP/$SUB" "$C/$SUB" "$SUB/"
  for k in user.name user.email core.hooksPath; do
    if [ -n "$(git -C "$IP" config --local --get "$k" 2>/dev/null)" ] && [ -z "$(git -C "$C" config --local --get "$k" 2>/dev/null)" ]; then
      echo "$SR: note: $C lacks the local git config $k that $IP sets: set it with git -C $C config $k <value> if the lead needs it" >&2
    fi
  done
}

case "$mode" in
  resolve)
    resolve_root "$1"
    if [ ! -e "$C" ] && [ ! -L "$C" ]; then
      out_path
      echo "$SR: no rollout clone at $C yet: --ensure makes it with one git clone of ${URL:-origin}" >&2
      [ -z "$P" ] || echo "$SR: nested in $P: $P must ignore $REL/; --ensure checks that before it clones" >&2
      exit 4
    fi
    usable
    if sub_missing; then
      echo "$SR: note: $C has no $SUB yet: --resolve never fetches, so the clone may only be behind origin; --ensure fast-forwards it first and refuses only if it still lacks $SUB" >&2
    fi
    out_path
    exit 0 ;;

  ensure)
    resolve_root "$1"
    if [ ! -e "$C" ] && [ ! -L "$C" ]; then
      if [ -n "$P" ]; then
        mkdir "$C" 2>/dev/null || { echo "$SR: cannot create $C" >&2; exit 2; }
        if ! git -C "$P" check-ignore -q -- "$REL/" 2>/dev/null; then
          rmdir "$C" 2>/dev/null
          echo "$SR: $P would track $C (its ignore rules do not cover it), so its next git add -A (the daily sweep's) would embed it as a gitlink: add /$REL/ to $P's .gitignore beside the line that ignores ${T#"$P"/}, land that, then re-run /thread:schedule" >&2
          exit 3
        fi
      fi
      ssh_rule
      if ! e=$(git clone -q -- "$URL" "$C" 2>&1); then
        rm -rf "$C"
        echo "$SR: git clone of $URL into $C failed: $(first "$e")" >&2
        exit 2
      fi
      echo "$SR: note: cloned $URL into $C (the rollout clone; ADR 0042)" >&2
    fi
    usable
    refresh_clone "$C" "$SUB" 0
    local_notes
    sub_present
    out_path
    exit 0 ;;

  refresh)
    need_land
    in_place "$1" || exit 0
    R=$(canon "$1")
    C=$(toplevel "$R") || exit 0
    case "$R" in "$C"/*) sub=${R#"$C"/} ;; *) sub='' ;; esac
    refresh_clone "$C" "$sub" 1
    exit 0 ;;

  refresh-in-place)
    [ -f "$LAND" ] || exit 0
    in_place "$1" || exit 0
    tw=$TWIN_TOP; root=$(toplevel "$(canon "$1")") || root=$(canon "$1")
    h=$(bash "$HOLD_SH" "$tw" 2>/dev/null)
    if [ -n "$h" ]; then echo "in-place: $tw held: $h (ADR 0031)"; exit 0; fi
    d=$(default_of "$root" "$tw") || d=''
    [ -n "$d" ] || { echo "in-place: $tw not moved: origin's default branch is unresolved"; exit 0; }
    ssh_rule
    if ! e=$(git -C "$tw" fetch -q origin "$d" 2>&1); then
      echo "in-place: $tw not moved: fetch failed: $(first "$e")"; exit 0
    fi
    cur=$(git -C "$tw" symbolic-ref -q --short HEAD 2>/dev/null)
    [ "$cur" = "$d" ] || { echo "in-place: $tw not moved: on '${cur:-a detached HEAD}', not $d"; exit 0; }
    in_op "$tw" && { echo "in-place: $tw not moved: an operation is in progress"; exit 0; }
    up="refs/remotes/origin/$d"
    ahead=$(git -C "$tw" rev-list --count "$up..HEAD" 2>/dev/null) || ahead=''
    behind=$(git -C "$tw" rev-list --count "HEAD..$up" 2>/dev/null) || behind=''
    case "$ahead$behind" in ''|*[!0-9]*) echo "in-place: $tw not moved: cannot compare HEAD with origin/$d"; exit 0 ;; esac
    if [ "$ahead" = 0 ] && [ "$behind" = 0 ]; then echo "in-place: $tw already at origin/$d"; exit 0; fi
    rs=$(bash "$REPO_STATE" "$tw" 2>/dev/null) || rs=''
    [ -n "$rs" ] || rs="on $d, $ahead commit(s) not on origin/$d"
    if [ "$ahead" = 0 ]; then
      old=$(git -C "$tw" rev-parse -q --verify HEAD)
      if git -C "$tw" merge -q --ff-only --no-autostash "$up" >/dev/null 2>&1; then
        new=$(git -C "$tw" rev-parse -q --verify HEAD)
        echo "in-place: $tw fast-forwarded to origin/$d (${old:0:7}..${new:0:7})"
      else
        echo "in-place: $tw not moved: local changes overlap origin/$d"
      fi
      exit 0
    fi
    if [ "$behind" = 0 ]; then echo "in-place: $tw ahead: $rs"; exit 0; fi
    line="in-place: $tw not moved: diverged: $ahead local-only commit(s) ($rs), $behind behind origin/$d; "
    route=$(bash "$LAND" --route "$tw" 2>/dev/null)
    case "$route" in
      "commit-only: "*)
        line="$line$tw is commit-only (${route#commit-only: }), so integrate it there: git -C $tw merge --no-edit origin/$d keeps the local shas a review doc cites, and its pushes are refused until then" ;;
      landable)
        line="$line$tw lands by PR: once its queued landing PR merges, the next merge-task or land.sh S4 fast-forwards it"
        s=''
        case "$rs" in
          *" queued in "*", "*" stranded") s=${rs##*, }; s=${s%% stranded} ;;
          *" — stranded") s=$ahead ;;
        esac
        [ -z "$s" ] || line="$line; $s stranded commit(s) are in no close/ branch: the next /thread:close in $tw carries close-out commits, anything else is its owner's to land" ;;
      "unknown: "*)
        line="$line$tw's landing route is unknown (${route#unknown: }): integrate it by the repo's own rules" ;;
      *)
        line="$line$tw's landing route is unknown (land.sh --route gave no answer): integrate it by the repo's own rules" ;;
    esac
    echo "$line"
    exit 0 ;;

  launch-check)
    need_land
    R=$(canon "$1"); D=$(canon "$2")
    if ! in_place "$R"; then
      echo "$SR: WARN: $R is not a rollout clone (a rollout scheduled before ADR 0042): its launch directory is not checked" >&2
      exit 0
    fi
    T=$(toplevel "$R") || T=$R
    if [ "$D" = "$R" ]; then exit 0; fi
    case "$R/" in "$D/"*) case "$D/" in "$T/"*) exit 0 ;; esac ;; esac
    echo "$SR: this session was launched in $D, outside the Project root $R: a lead's tools reset every cd outside its launch directory, so the lead must launch at the Project root, or at an ancestor of it within $T" >&2
    echo "$SR: start a session in $R, then /thread:execute the rollout" >&2
    exit 3 ;;
esac
usage
