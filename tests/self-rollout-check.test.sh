#!/usr/bin/env bash
# p12-4 and p26-2, executed: skills/execute/scripts/self-rollout-check.sh, the rollout clone's one script (ADR 0042).
# The `# thread:self-rollout-check` wrapper is extracted verbatim from skills/_shared/execution-fit.md § Dispatch
# blockers by its markers, with `R="$1"` and `M="$2"` substituted for the `<repoPath>` and `<mode>` placeholders.
# The plain check (execute § 2.6, `<mode>` empty) runs under bash AND zsh (the Bash tool's shell on macOS) against a
# fixture known_marketplaces.json; `--resolve` (schedule § 0) runs its full matrix against fixture clones under bash,
# and one pass, one rejection, one exit 4 and one exit 2 under zsh, the only shell-dependent part being the wrapper.
# `--ensure`, `--refresh` and `--refresh-in-place` run offline against bare "GitHub" servers through a fake ssh
# (tests/fixtures/land/fake-ssh.sh), the route-aware diverged-twin remedy included; then `--launch-check`,
# `--in-place`, and execute § 2.8's `# thread:launch-dir-check` snippet under bash and zsh. Plus the wiring: schedule
# § 0 and execute § 2.6 point at the snippet without copying it, §§ 2.6, 2.8 and 7 name their halt reasons, and the
# halt lines the lead prints parse for the Stop hook. Hermetic: HOME, CLAUDE_CONFIG_DIR and every path live under
# mktemp; commits carry an inline identity; never the network; global/system git config is ignored.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
skill=skills/execute/SKILL.md
ef=skills/_shared/execution-fit.md

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tmp=$(cd "$tmp" && pwd -P)

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# ---- the snippet, verbatim from the skill --------------------------------------------------------------
awk '/^# thread:self-rollout-check/{on=1; next} /^# end thread:self-rollout-check/{on=0} on' "$ef" > "$tmp/raw.sh"
ok "$(grep -c '^R="<repoPath>"$' "$tmp/raw.sh")" 1 "the self-rollout snippet is found in execution-fit.md, with its <repoPath> placeholder"
ok "$(grep -c '^M="<mode>"$' "$tmp/raw.sh")" 1 "… and its <mode> placeholder"
ok "$(grep -cE '\$[0-9]' "$tmp/raw.sh")" 0 "the snippet holds no positional \$N (skill arguments substitute into them)"
snip=$(sed -e 's/^R="<repoPath>"$/R="$1"/' -e 's/^M="<mode>"$/M="$2"/' "$tmp/raw.sh")
snip_f="$tmp/snippet.sh"; printf '%s\n' "$snip" > "$snip_f"

# ---- fixtures -------------------------------------------------------------------------------------------
home="$tmp/home"; cfg="$tmp/cfg"; mkdir -p "$home/repos/plug" "$home/repos/mono/tools/plug" "$home/repos/plugin2" "$tmp/other" "$cfg/plugins" "$tmp/noplugin"
ln -s "$home/repos/plug" "$tmp/link"
# plugin_copy <dir>: a plugin root the snippet can run from (the check and the land.sh its lookup calls)
plugin_copy() {
  mkdir -p "$1/skills/execute/scripts" "$1/skills/_shared/scripts"
  cp "$root/skills/execute/scripts/self-rollout-check.sh" "$1/skills/execute/scripts/"
  cp "$root/skills/_shared/scripts/land.sh" "$1/skills/_shared/scripts/"
}
pd="$home/repos/pd"; plugin_copy "$pd/plugin"; mkdir -p "$pd-x"; ln -s "$pd" "$tmp/pdlink"
reg="$cfg/plugins/known_marketplaces.json"
write_reg() {  # write_reg <directory path> <github installLocation>
  cat > "$reg" <<EOF
{
  "official": {"source": {"source": "github", "repo": "o/official"}, "installLocation": "$2"},
  "thread": {"source": {"source": "directory", "path": "$1"}, "installLocation": "$1"}
}
EOF
}

for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  # run <repoPath> [VAR=val …]: rc in $rc, stderr in $err
  run() { local r="$1"; shift; env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" "$@" $sh "$snip_f" "$r" "" >/dev/null 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err"); }

  write_reg "$home/repos/plug" "$tmp/other"
  run "$home/repos/plug"; ok "$rc" 3 "$n: repoPath is a directory-source checkout → 3"
  has "$err" "run it from its rollout clone at $home/repos/plug-rollout (" "$n: … the fix on stderr, naming <repoPath>-rollout"
  has "$err" "/thread:schedule <project> --regenerate makes the clone when it is missing and re-roots the rollout there (ADR 0042); never hand-edit its Project root" "$n: … through --regenerate, never a hand edit"
  has "$err" "'thread'" "$n: … naming the marketplace"
  run "$tmp/link"; ok "$rc" 3 "$n: via a symlink to it → 3"
  run "$home/repos/plug/"; ok "$rc" 3 "$n: with a trailing / → 3"
  run "~/repos/plug"; ok "$rc" 3 "$n: as ~/… → 3"
  write_reg "~/repos/plug/" "$tmp/other"
  run "$home/repos/plug"; ok "$rc" 3 "$n: a registry path written as ~/…/ → 3"
  write_reg "$home/repos/not-yet" "$tmp/other"
  run "$home/repos/not-yet"; ok "$rc" 3 "$n: a path that does not exist yet compares as a string → 3"

  # containment: a marketplace nested inside repoPath (a monorepo) is just as live
  write_reg "$home/repos/mono/tools/plug" "$tmp/other"
  run "$home/repos/mono"; ok "$rc" 3 "$n: a marketplace nested inside repoPath → 3"
  has "$err" "'thread'" "$n: … naming the marketplace"
  run "$home/repos/mono/"; ok "$rc" 3 "$n: … with a trailing / on repoPath → 3"
  run "$home/repos/mono/tools/plug/sub"; ok "$rc|$err" "0|" "$n: repoPath nested inside the marketplace, not containing it → 0"
  write_reg "$home/repos/plugin2" "$tmp/other"
  run "$home/repos/plug"; ok "$rc|$err" "0|" "$n: a sibling sharing a name prefix (plug vs plugin2) → 0"

  write_reg "$home/repos/plug" "$tmp/other"
  run "$tmp/other"; ok "$rc|$err" "0|" "$n: a github source whose installLocation matches → 0, silent"
  run "$home/repos/elsewhere"; ok "$rc|$err" "0|" "$n: a different path → 0, silent"

  rm -f "$reg"
  run "$home/repos/plug"; ok "$rc|$err" "0|" "$n: no registry → 0, silent"
  echo '{ not json' > "$reg"
  run "$home/repos/plug"; ok "$rc" 0 "$n: a malformed registry → 0 (fail open)"
  has "$err" "WARN" "$n: … with a warning"
  echo '[1, 2]' > "$reg"
  run "$home/repos/plug"; ok "$rc" 0 "$n: an unknown registry shape → 0"
  has "$err" "WARN" "$n: … with a warning"

  write_reg "$home/repos/plug" "$tmp/other"
  run ""; ok "$rc" 2 "$n: an empty repoPath → 2"
  run "$home/repos/plug" CLAUDE_PLUGIN_ROOT="$tmp/noplugin"; ok "$rc" 2 "$n: the script missing → 2"
  has "$err" "self-rollout-check.sh not found at $tmp/noplugin/" "$n: … with the not-found line"

  # ${CLAUDE_PLUGIN_ROOT}: a `--plugin-dir` session the registry never lists. No registry at all here.
  rm -f "$reg"
  run "$pd/plugin" CLAUDE_PLUGIN_ROOT="$pd/plugin"; ok "$rc" 3 "$n: repoPath is \${CLAUDE_PLUGIN_ROOT}, no registry → 3"
  has "$err" "the root this session runs the plugin from" "$n: … naming the plugin root"
  has "$err" "run it from its rollout clone at $pd/plugin-rollout (" "$n: … and the same fix"
  run "$pd" CLAUDE_PLUGIN_ROOT="$pd/plugin"; ok "$rc" 3 "$n: repoPath contains \${CLAUDE_PLUGIN_ROOT} → 3"
  run "$tmp/pdlink" CLAUDE_PLUGIN_ROOT="$pd/plugin/"; ok "$rc" 3 "$n: … via a symlink to repoPath, a trailing / on the root → 3"
  run "$pd/plugin/skills" CLAUDE_PLUGIN_ROOT="$pd/plugin"; ok "$rc|$err" "0|" "$n: repoPath inside \${CLAUDE_PLUGIN_ROOT}, not containing it → 0"
  run "$pd-x" CLAUDE_PLUGIN_ROOT="$pd/plugin"; ok "$rc|$err" "0|" "$n: a sibling sharing a name prefix → 0"
done

# ---- --list-dirs: the registry's directory sources, for skills/_shared/scripts/pushed-base.sh (p12-15) -----
sc="$root/skills/execute/scripts/self-rollout-check.sh"
# ld [VAR=val …]: rc in $rc, stdout in $out, stderr in $err
ld() { out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" "$@" bash "$sc" --list-dirs 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
rm -f "$reg"
ld; ok "$rc|$out|$err" "0||" "--list-dirs: no registry → nothing, exit 0"
write_reg "$tmp/link/" "$tmp/other"
ld; ok "$rc|$out|$err" "0|$home/repos/plug|" "--list-dirs: a directory and a github source → only the directory path, canonicalised and deduplicated"
write_reg "~/repos/plugin2" "$tmp/other"
ld; ok "$rc|$out" "0|$home/repos/plugin2" "--list-dirs: a ~/ path is expanded"
echo '{ not json' > "$reg"
ld; ok "$rc|$out" "0|" "--list-dirs: a malformed registry → nothing, exit 0"
has "$err" "WARN" "--list-dirs: … with the warning"
ld_extra=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" bash "$sc" --list-dirs extra >/dev/null 2>&1; echo $?)
ok "$ld_extra" 2 "--list-dirs with an extra argument → usage error 2"

# ---- --resolve: schedule § 0's Project root, through the same snippet with <mode> = --resolve ---------------
# Every parallel rollout runs from its rollout clone <toplevel>-rollout (ADR 0042): --resolve maps every git
# Local: to C[/<sub>], read-only. Exit 4 is "no clone yet" (the would-be path on stdout), 5 is no GitHub origin,
# 3 a refusal, 2 the check unable to run.
g() { git -c init.defaultBranch=main -c user.name=t -c user.email=t@example.invalid "$@"; }
# mk <dir> <origin-url>: a clone — one empty commit on main, origin/main at it, origin/HEAD → origin/main
mk() {
  g init -q "$1" && g -C "$1" remote add origin "$2" && g -C "$1" commit -q --allow-empty -m one &&
    g -C "$1" update-ref refs/remotes/origin/main HEAD && g -C "$1" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
}
lacks() { case "$1" in *"$2"*) ok y n "$3" ;; *) ok n n "$3" ;; esac; }
live="$home/repos/live"; sib="$live-rollout"
mk "$live" "https://github.com/Owner/Live.git"
write_reg "$live" "$tmp/other"
# The test scrubbed its own repo-local git env above, for its fixtures. Every resolve runs with a hostile one
# put back: GIT_DIR and GIT_WORK_TREE naming a decoy that is itself a usable clone of the same repo, so a
# script that let inherited env override -C would answer for the decoy and wrongly pass the rejections.
decoy="$tmp/decoy"; mk "$decoy" "https://github.com/owner/live.git"
# res <sh> <Local:> [VAR=val …]: rc in $rc, stdout in $out, stderr in $err
res() { local sh="$1" r="$2"; shift 2; out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" GIT_DIR="$decoy/.git" GIT_WORK_TREE="$decoy" "$@" $sh "$snip_f" "$r" --resolve 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
# no <reason> <label> [<clone>]: exit 3, nothing on stdout, the clone's reason line on stderr
no() {
  ok "$rc|$out" "3|" "$2 → 3, nothing printed"
  has "$err" "${3:-$sib} is not a usable rollout clone: $1" "$2: … '$1'"
}
bash_sh=$(command -v bash)
rm -rf "$sib"

# 1. The first failing test: workspaces, the repo that motivated ADR 0042, with no clone yet.
ws="$home/repos/workspaces"; mk "$ws" "git@github.com:owner/live.git"; mkdir -p "$ws/ops-workspace"
res "$bash_sh" "$ws"; ok "$rc|$out" "4|$ws-rollout" "resolve: ~/repos/workspaces, no clone → 4, the would-be ~/repos/workspaces-rollout on stdout"
has "$err" "git@github.com:owner/live.git" "resolve: … stderr names the origin URL"
lacks "$err" "nested in" "resolve: … a toplevel under no other work tree is not nested"
res "$bash_sh" "$ws/ops-workspace"; ok "$rc|$out" "4|$ws-rollout/ops-workspace" "resolve: a sub-path Local: maps to the same sub-path of the clone"

# 2. The matrix.
res "$bash_sh" "$tmp/other"; ok "$rc|$out" "3|" "resolve: a Local: outside git → 3, nothing printed"
has "$err" "$tmp/other has no rollout clone: it is not in a git work tree" "resolve: … it is not in a git work tree"
res "$bash_sh" "$tmp/nowhere"; ok "$rc|$out" "3|" "resolve: a Local: that does not exist → 3"
res "$bash_sh" "$live"; ok "$rc|$out" "4|$sib" "resolve: no clone yet (the plugin's own checkout included) → 4 with the clone path"
mk "$sib" "git@github.com:owner/live.git"
res "$bash_sh" "$live"; ok "$rc|$out|$err" "0|$sib|" "resolve: a clone of the same repo (other URL shape and case) → the clone, silent"
res "$bash_sh" "~/repos/live/"; ok "$rc|$out" "0|$sib" "resolve: … from a ~/…/ path (trailing / stripped)"
res "$bash_sh" "$sib"; ok "$rc|$out" "0|$sib" "resolve: Local: naming the clone resolves to itself"
mkdir -p "$live/sub" "$sib/sub" "$live/only"
res "$bash_sh" "$live/sub"; ok "$rc|$out" "0|$sib/sub" "resolve: a sub-path maps to <clone>/<sub>"
res "$bash_sh" "$sib/sub"; ok "$rc|$out" "0|$sib/sub" "resolve: … and the clone's own sub-path names itself"
res "$bash_sh" "$live/only"; ok "$rc|$out" "3|" "resolve: a sub-path the clone lacks → 3"
has "$err" "land only first" "resolve: … land <sub> first"
rmdir "$live/only"

# Its branch, working tree and lag are no rollout's concern: the real rollout clone carries the engine's own
# untracked scratch, and execute's worktrees branch from origin.
g -C "$sib" commit -q --allow-empty -m two; g -C "$sib" update-ref refs/remotes/origin/main HEAD; g -C "$sib" reset -q --hard HEAD~1
g -C "$sib" switch -q -c feature; mkdir -p "$sib/.claude"; : > "$sib/.claude/merge.status"; : > "$sib/untracked"
res "$bash_sh" "$live"; ok "$rc|$out|$err" "0|$sib|" "resolve: a clone on another branch, with untracked engine scratch, behind origin → still the clone, silent"
rm -rf "$sib"; mk "$sib" "https://github.com/owner/live.git"

g -C "$sib" remote set-url origin "https://github.com/owner/other.git"
res "$bash_sh" "$live"; no "its origin is owner/other, not Owner/Live" "resolve: a clone of another repo"
g -C "$sib" remote set-url origin "$tmp/somewhere.git"
res "$bash_sh" "$live"; no "its origin does not name a GitHub <owner>/<name>" "resolve: a clone with a path origin (land.sh --origin-slug's exit, not its stdout)"
g -C "$sib" remote set-url origin "https://github.com/owner/live.git"
g -C "$live" remote set-url origin "$tmp/somewhere.git"
res "$bash_sh" "$live"; ok "$rc|$out" "5|" "resolve: no GitHub origin (a path origin) → 5, stdout empty"
has "$err" "no GitHub origin in $live: run the remote check (execution-fit.md § Dispatch blockers, GitHub origin)" "resolve: … naming the remote check"
g -C "$live" remote set-url origin "https://gitlab.com/owner/live.git"
res "$bash_sh" "$live"; ok "$rc|$out" "5|" "resolve: a gitlab origin → 5, stdout empty"
g -C "$live" remote remove origin
res "$bash_sh" "$live"; ok "$rc|$out" "5|" "resolve: no origin at all → 5, stdout empty"
g -C "$live" remote add origin "https://github.com/Owner/Live.git"

cat > "$reg" <<EOF
{"a": {"source": {"source": "directory", "path": "$live"}}, "b": {"source": {"source": "directory", "path": "$sib"}}}
EOF
res "$bash_sh" "$live"; no "it holds a live plugin checkout" "resolve: a clone that is a marketplace checkout"
write_reg "$live" "$tmp/other"
# this session's plugin root inside the clone: the clone's own match refuses it
plugin_copy "$sib/plug"
res "$bash_sh" "$live" CLAUDE_PLUGIN_ROOT="$sib/plug"; no "it holds a live plugin checkout" "resolve: a clone holding \${CLAUDE_PLUGIN_ROOT}"
rm -rf "$sib/plug"

# a linked worktree of the primary shares its .git: not a separate clone
rm -rf "$sib"; g -C "$live" worktree add -q --detach "$sib"
res "$bash_sh" "$live"; no "it is a linked worktree of $live/.git, not its own clone" "resolve: a linked worktree of the primary at the clone's place"
# CDPATH must not steer the common-dir lookup (the review reproduced `cd` honouring it)
res "$bash_sh" "$live" CDPATH="$decoy"; ok "$rc|$out" "3|" "resolve: … still 3 with a hostile CDPATH"
# Local: naming a linked worktree: point it at the main checkout
res "$bash_sh" "$sib"; ok "$rc|$out" "3|" "resolve: a Local: inside a linked worktree → 3"
has "$err" "point Local: at the main checkout" "resolve: … point Local: at the main checkout"
g -C "$live" worktree remove --force "$sib"

mkdir -p "$sib"
res "$bash_sh" "$live"; no "it is not the top of a git work tree" "resolve: a plain directory at the clone's place"
# The review's reproduction: that directory holding a git dir that ignores everything, inherited as GIT_DIR
# (and no GIT_WORK_TREE). Unscrubbed, git takes the directory as a clean work tree of the same repo, its own
# clone, on main, and the script passes it.
mk "$sib/inner" "https://github.com/owner/live.git"; echo '*' > "$sib/inner/.git/info/exclude"
out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" GIT_DIR="$sib/inner/.git" bash "$snip_f" "$live" --resolve 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err")
ok "$rc|$out" "3|" "resolve: … still 3 under an inherited GIT_DIR inside it"
has "$err" "not the top of a git work tree" "resolve: … for the same reason"
rm -rf "$sib"; : > "$sib"
res "$bash_sh" "$live"; no "it is not a directory" "resolve: a file at the clone's place"
rm -f "$sib"

# a *-rollout toplevel with no same-origin sibling gets its own clone
fr="$home/repos/foo-rollout"; mk "$fr" "https://github.com/o/foo.git"
res "$bash_sh" "$fr"; ok "$rc|$out" "4|$fr-rollout" "resolve: foo-rollout with no same-origin sibling → foo-rollout-rollout"
mk "$home/repos/foo" "https://github.com/o/other.git"
res "$bash_sh" "$fr"; ok "$rc|$out" "4|$fr-rollout" "resolve: … and with a sibling of another origin"

# ~/Projects is never a Project root (Q12)
pj="$home/Projects"; mk "$pj" "https://github.com/o/projects.git"; mkdir -p "$pj/A/P"
res "$bash_sh" "$pj"; ok "$rc|$out" "3|" "resolve: ~/Projects → 3"
has "$err" "~/Projects is a text-only monorepo of project directories, never a Project root" "resolve: … with the reason"
has "$err" "give the code its own repo" "resolve: … and the remedy"
res "$bash_sh" "$pj/A/P"; ok "$rc|$out" "3|" "resolve: a project directory in ~/Projects → 3"

# a nested repo under a work tree: 4 plus `nested in`; an existing clone P tracks → 3; ignored → 0
nest="$pj/N/nest"; mk "$nest" "git@github.com:o/nest.git"
res "$bash_sh" "$nest"; ok "$rc|$out" "4|$nest-rollout" "resolve: a nested repo, no clone → 4"
has "$err" "nested in $pj: $pj must ignore N/nest-rollout/; --ensure checks that before it clones" "resolve: … plus the nested-in line"
mk "$nest-rollout" "https://github.com/o/nest.git"
res "$bash_sh" "$nest"; no "$pj would track it (its ignore rules do not cover N/nest-rollout/)" "resolve: an existing nested clone the parent would track" "$nest-rollout"
printf '/N/nest/\n/N/nest-rollout/\n' > "$pj/.gitignore"
res "$bash_sh" "$nest"; ok "$rc|$out|$err" "0|$nest-rollout|" "resolve: … with the ignore line → 0"
res "$bash_sh" "$nest-rollout"; ok "$rc|$out" "0|$nest-rollout" "resolve: … and from the nested clone itself"

mk "$sib" "https://github.com/owner/live.git"
res "$bash_sh" "$live" CLAUDE_PLUGIN_ROOT="$tmp/noplugin"; ok "$rc|$out" "2|" "resolve: the script missing → 2"
has "$err" "self-rollout-check.sh not found at $tmp/noplugin/" "resolve: … with the not-found line"
usage() { env GIT_DIR="$decoy/.git" bash skills/execute/scripts/self-rollout-check.sh "$@" >/dev/null 2>&1; echo $?; }
for m in --resolve --ensure --refresh --refresh-in-place --in-place; do
  ok "$(usage $m)" 2 "$m with no path → usage error 2"
  ok "$(usage $m "")" 2 "$m with an empty path → usage error 2"
  ok "$(usage $m a b)" 2 "$m with an extra argument → usage error 2"
done
ok "$(usage --launch-check a)" 2 "--launch-check with one path → usage error 2"
ok "$(usage --launch-check a "")" 2 "--launch-check with an empty launch dir → usage error 2"

# zsh: the wrapper is the only shell-dependent part, so one pass, one rejection and one exit 2
if [ -n "$zsh_bin" ]; then
  res "$zsh_bin -f" "$live"; ok "$rc|$out|$err" "0|$sib|" "zsh: resolve names the usable clone"
  rm -rf "$sib"
  res "$zsh_bin -f" "$live"; ok "$rc|$out" "4|$sib" "zsh: resolve with no clone → 4 and the clone path"
  mkdir -p "$sib"
  res "$zsh_bin -f" "$live"; ok "$rc|$out" "3|" "zsh: resolve with a plain directory at the clone's place → 3"
  has "$err" "$sib is not a usable rollout clone: it is not the top of a git work tree" "zsh: … with the reason line"
  res "$zsh_bin -f" "$live" CLAUDE_PLUGIN_ROOT="$tmp/noplugin"; ok "$rc|$out" "2|" "zsh: resolve with the script missing → 2"
  rm -rf "$sib"
fi

# ---- --ensure, --refresh, --refresh-in-place: offline, against bare "GitHub" servers ------------------------
# Origins are git@github.com:<o>/<r>.git, served from $SRV/<o>/<r>.git by tests/fixtures/land/fake-ssh.sh through
# GIT_SSH_COMMAND (as tests/land.test.sh). Every call runs the script directly with HOME and the registry pinned.
mkdir -p "$tmp/bin" "$tmp/srv" "$tmp/t"
cp tests/fixtures/land/fake-ssh.sh "$tmp/bin/fake-ssh"; chmod +x "$tmp/bin/fake-ssh"
export SRV="$tmp/srv" LOG_SSH="$tmp/ssh.log"; : > "$LOG_SSH"
SSHENV="GIT_SSH_COMMAND=$tmp/bin/fake-ssh GIT_SSH_VARIANT=ssh"
sc="$root/skills/execute/scripts/self-rollout-check.sh"
rm -f "$reg"
# srv <o/r>: a bare server with one commit on master (a.txt, sub/x.txt)
srv() {
  local s="$SRV/$1.git" w="$tmp/t/seed-${1//\//-}"
  g init -q --bare -b master "$s"; g clone -q "$s" "$w" 2>/dev/null
  mkdir -p "$w/sub"; echo base > "$w/a.txt"; echo x > "$w/sub/x.txt"; echo 'ignored*' > "$w/.gitignore"
  g -C "$w" add -A && g -C "$w" commit -qm base && g -C "$w" push -q origin master
}
# push <o/r> <file> <content>: a commit on the server's master from its seed clone
push() {
  local w="$tmp/t/seed-${1//\//-}"
  g -C "$w" pull -q origin master 2>/dev/null; mkdir -p "$(dirname "$w/$2")"; printf '%s\n' "$3" > "$w/$2"
  g -C "$w" add -A && g -C "$w" commit -qm "srv: $2" && g -C "$w" push -q origin master
}
srvtip() { git --git-dir "$SRV/$1.git" rev-parse refs/heads/master; }
# cl <o/r> <dir>: a clone over fake ssh (origin git@github.com:<o>/<r>.git, origin/HEAD set)
cl() { env $SSHENV git clone -q "git@github.com:$1.git" "$2" 2>/dev/null; }
# sr <mode> <path> [VAR=val …]: the script directly; rc, out, err
sr() { local m="$1" p="$2"; shift 2; out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" $SSHENV "$@" bash "${SC:-$sc}" "$m" "$p" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }

# 3. --ensure: create, reuse, fast-forward; a note when it cannot move; the local-state notes; the launch WARN.
srv o/e1; e1="$home/repos/e1"; cl o/e1 "$e1"
sr --ensure "$e1"; ok "$rc|$out" "0|$e1-rollout" "ensure: no clone → made, the clone on stdout"
ok "$(git -C "$e1-rollout" config --get remote.origin.url)" "git@github.com:o/e1.git" "ensure: … a full clone of the twin's raw origin URL"
ok "$([ -d "$e1-rollout/.git" ] && echo dir)" dir "ensure: … its own clone (a .git directory)"
has "$err" "cloned git@github.com:o/e1.git into $e1-rollout" "ensure: … says it cloned"
sr --ensure "$e1"; ok "$rc|$out" "0|$e1-rollout" "ensure: run again → the same clone, reused"
lacks "$err" "cloned" "ensure: … nothing cloned the second time"
has "$err" "already at origin/master" "ensure: … already at origin/master"
sr --ensure "$e1/sub"; ok "$rc|$out" "0|$e1-rollout/sub" "ensure: a sub-path Local: → <clone>/<sub>"
push o/e1 b.txt one
sr --ensure "$e1"; ok "$rc" 0 "ensure: origin moved → 0"
has "$err" "refreshed $e1-rollout: fast-forwarded to origin/master" "ensure: … the clone fast-forwarded"
ok "$(git -C "$e1-rollout" rev-parse HEAD)" "$(srvtip o/e1)" "ensure: … to the server's tip"
# a dirty overlap: the clone's a.txt edited, origin changes a.txt → a note, the file intact, HEAD unmoved
echo dirty > "$e1-rollout/a.txt"; push o/e1 a.txt upstream; held=$(git -C "$e1-rollout" rev-parse HEAD)
sr --ensure "$e1"; ok "$rc|$out" "0|$e1-rollout" "ensure: a dirty overlap → still 0 and the clone"
has "$err" "not refreshed: local changes overlap origin/master" "ensure: … a note"
ok "$(cat "$e1-rollout/a.txt")|$(git -C "$e1-rollout" rev-parse HEAD)" "dirty|$held" "ensure: … the file intact, HEAD unmoved"
git -C "$e1-rollout" checkout -q -- a.txt
git -C "$e1-rollout" switch -q -c side
sr --ensure "$e1"; has "$err" "not refreshed: on 'side', not master" "ensure: the clone on another branch → a note"
ok "$(git -C "$e1-rollout" rev-parse HEAD)" "$held" "ensure: … unmoved"
git -C "$e1-rollout" switch -q master
# local state: the twin's gitignored files and local git config, never copied
mkdir -p "$e1/.claude" "$e1/sub"; : > "$e1/.claude/settings.local.json"; : > "$e1/CLAUDE.local.md"; : > "$e1/.env"
: > "$e1/sub/.envrc"; echo '{}' > "$e1/.mcp.json"; git -C "$e1" config user.email peer@example.invalid
sr --ensure "$e1/sub"; ok "$rc" 0 "ensure: local state in the twin → still 0"
for f in .claude/settings.local.json CLAUDE.local.md .env; do
  has "$err" "note: $e1-rollout lacks $f, which $e1 has" "ensure: … a note for $f"
done
has "$err" "note: $e1-rollout/sub lacks .envrc, which $e1/sub has" "ensure: … checked at the root's sub-path too"
has "$err" "lacks the untracked .mcp.json that $e1 has" "ensure: … a note for the untracked .mcp.json"
has "$err" "lacks the local git config user.email that $e1 sets" "ensure: … a note for the local git config"
ok "$([ -e "$e1-rollout/.env" ] && echo copied || echo absent)" absent "ensure: … nothing copied"
push o/e1 sub/.workspace-launch.json '{}'
sr --ensure "$e1/sub"; has "$err" "WARN: $e1-rollout/sub/.workspace-launch.json has no .mcp.json beside it" "ensure: a launch marker with no .mcp.json → WARN"
# a failed clone: nothing left behind
e2="$home/repos/e2"; mk "$e2" "git@github.com:o/missing.git"
sr --ensure "$e2"; ok "$rc|$out" "2|" "ensure: a failed clone → 2, nothing printed"
has "$err" "git clone of git@github.com:o/missing.git into $e2-rollout failed" "ensure: … naming the clone"
ok "$([ -e "$e2-rollout" ] && echo left || echo gone)" gone "ensure: … nothing left behind"
sr --ensure "$tmp/other"; ok "$rc" 3 "ensure: outside git → 3 (resolve's refusal passes through)"
g -C "$e2" remote set-url origin "$tmp/x.git"; sr --ensure "$e2"; ok "$rc|$out" "5|" "ensure: no GitHub origin → 5"
# nested: refused, nothing left, the parent's status unchanged; then created once the parent ignores it
pn="$tmp/pn"; g init -q "$pn"; mkdir -p "$pn/N"; printf '/N/n3/\n' > "$pn/.gitignore"; g -C "$pn" add -A; g -C "$pn" commit -qm p
srv o/n3; cl o/n3 "$pn/N/n3"
before=$(git -C "$pn" status --porcelain)
sr --ensure "$pn/N/n3"; ok "$rc|$out" "3|" "ensure: nested, the parent would track the clone → 3"
has "$err" "$pn would track $pn/N/n3-rollout (its ignore rules do not cover it)" "ensure: … naming the parent"
has "$err" "add /N/n3-rollout/ to $pn's .gitignore beside the line that ignores N/n3" "ensure: … and the ignore line to add"
ok "$([ -e "$pn/N/n3-rollout" ] && echo left || echo gone)" gone "ensure: … the probe directory removed"
ok "$(git -C "$pn" status --porcelain)" "$before" "ensure: … the parent's status unchanged"
printf '/N/n3/\n/N/n3-rollout/\n' > "$pn/.gitignore"
sr --ensure "$pn/N/n3"; ok "$rc|$out" "0|$pn/N/n3-rollout" "ensure: nested with the ignore line → made"

# 4. --refresh: a clone root only
push o/e1 c.txt two
before=$(git -C "$e1" rev-parse HEAD)
sr --refresh "$e1"; ok "$rc|$out|$err" "0||" "refresh: a root that is no clone → 0, silent"
ok "$(git -C "$e1" rev-parse HEAD)" "$before" "refresh: … and not moved"
sr --refresh "$e1-rollout"; ok "$rc|$out" "0|" "refresh: a clone root → 0"
has "$err" "refreshed $e1-rollout: fast-forwarded to origin/master" "refresh: … fast-forwarded"
lacks "$err" "WARN" "refresh: … an unrelated change, no relaunch WARN"
ok "$(git -C "$e1-rollout" rev-parse HEAD)" "$(srvtip o/e1)" "refresh: … to the server's tip"
push o/e1 CLAUDE.md rules
sr --refresh "$e1-rollout"; has "$err" "WARN: the refresh changed the lead's own config (CLAUDE.md)" "refresh: CLAUDE.md changed → relaunch WARN"
push o/e1 .claude/settings.json '{}'
sr --refresh "$e1-rollout/sub"; has "$err" "WARN: the refresh changed the lead's own config (.claude/settings.json)" "refresh: an ancestor's .claude/ changed → WARN"
push o/e1 sub/AGENTS.md a
sr --refresh "$e1-rollout/sub"; has "$err" "(sub/AGENTS.md)" "refresh: the root's own AGENTS.md → WARN"
push o/e1 other/CLAUDE.md o
sr --refresh "$e1-rollout/sub"; lacks "$err" "WARN" "refresh: a sibling directory's CLAUDE.md → no WARN"
sr --refresh "$e1-rollout" FAKE_SSH=fail; ok "$rc" 0 "refresh: a failed fetch → still 0"
has "$err" "not refreshed: fetch failed" "refresh: … a note"

# 5. --refresh-in-place: the twin gets the rollout's merges
r5="$home/repos/r5"; srv o/r5; cl o/r5 "$r5"; cl o/r5 "$r5-rollout"
sr --refresh-in-place "$r5"; ok "$rc|$out|$err" "0||" "in-place: a root that is no clone → no output, 0"
sr --refresh-in-place "$r5-rollout"; ok "$rc|$out" "0|in-place: $r5 already at origin/master" "in-place: level → already at"
push o/r5 b.txt 1; old=$(git -C "$r5" rev-parse HEAD)
sr --refresh-in-place "$r5-rollout"
ok "$rc|$out" "0|in-place: $r5 fast-forwarded to origin/master (${old:0:7}..$(srvtip o/r5 | cut -c1-7))" "in-place: behind → fast-forwarded"
ok "$(git -C "$r5" rev-parse HEAD)" "$(srvtip o/r5)" "in-place: … to the server's tip"
g -C "$r5" commit -q --allow-empty -m local-only; held=$(git -C "$r5" rev-parse HEAD)
sr --refresh-in-place "$r5-rollout"; ok "$rc" 0 "in-place: ahead only → 0"
has "$out" "in-place: $r5 ahead: on master, 1 commit(s) not on origin/master — stranded" "in-place: … ahead, with repo-state's line"
ok "$(git -C "$r5" rev-parse HEAD)" "$held" "in-place: … unmoved"
g -C "$r5" reset -q --hard origin/master
g -C "$r5" switch -q -c side; push o/r5 c.txt 2
sr --refresh-in-place "$r5-rollout"; ok "$out" "in-place: $r5 not moved: on 'side', not master" "in-place: another branch → not moved"
g -C "$r5" switch -q master
echo dirty > "$r5/a.txt"; push o/r5 a.txt up; held=$(git -C "$r5" rev-parse HEAD); git -C "$r5" config merge.autoStash true
sr --refresh-in-place "$r5-rollout"; ok "$out" "in-place: $r5 not moved: local changes overlap origin/master" "in-place: a dirty overlap under merge.autoStash → not moved"
ok "$(cat "$r5/a.txt")|$(git -C "$r5" rev-parse HEAD)|$(git -C "$r5" stash list)" "dirty|$held|" "in-place: … the file intact, HEAD unmoved, the stash list empty"
git -C "$r5" checkout -q -- a.txt; git -C "$r5" config --unset merge.autoStash
sr --refresh-in-place "$r5-rollout" FAKE_SSH=fail; ok "$rc" 0 "in-place: a failed fetch → 0"
has "$out" "in-place: $r5 not moved: fetch failed" "in-place: … fetch failed"
: > "$r5/.git/MERGE_HEAD"
sr --refresh-in-place "$r5-rollout"; ok "$out" "in-place: $r5 not moved: an operation is in progress" "in-place: an operation in progress → not moved"
rm -f "$r5/.git/MERGE_HEAD"
# held: the twin is the plugin's primary checkout (this script runs from its own copy) while a rollout runs on it
. tests/lib/rollout-fixtures.sh
rh="$home/repos/rh"; srv o/rh
w="$tmp/t/seed-o-rh"; cp -R "$root/skills" "$w/skills"; g -C "$w" add -A; g -C "$w" commit -qm plugin; g -C "$w" push -q origin master
cl o/rh "$rh"; cl o/rh "$rh-rollout"; push o/rh b.txt 1; held=$(git -C "$rh" rev-parse HEAD)
prollout "$home/repos/obsidian/Work/Tasks"
SC="$rh/skills/execute/scripts/self-rollout-check.sh" sr --refresh-in-place "$rh-rollout"
ok "$out" "in-place: $rh held: [[demo-rollout-2026-10-03]] running on it (ADR 0031)" "in-place: the primary checkout while a rollout runs → held"
ok "$(git -C "$rh" rev-parse HEAD)" "$held" "in-place: … unmoved"
sed -i.bak 's/^status: open$/status: done/' "$home/repos/obsidian/Work/Tasks/demo-rollout-2026-10-03.md"; rm -f "$home/repos/obsidian/Work/Tasks/"*.bak
SC="$rh/skills/execute/scripts/self-rollout-check.sh" sr --refresh-in-place "$rh-rollout"
has "$out" "in-place: $rh fast-forwarded to origin/master" "in-place: … stamped done → fast-forwarded"
rm -rf "$home/repos/obsidian"
# Diverged, route-aware: never a merge commit, never moved, exit 0 (R4-3)
# diverge <twin>: one local-only commit in the twin, and origin one ahead of it
diverge() { g -C "$1" commit -q --allow-empty -m local-only; push "$2" "d-$RANDOM.txt" d; }
nomerge() {  # nomerge <twin> <held> <label>
  ok "$(git -C "$1" rev-parse HEAD)|$([ -e "$1/.git/MERGE_HEAD" ] && echo merging)" "$2|" "$3: HEAD unchanged, no MERGE_HEAD"
}
h2="$tmp/h2"; mkdir -p "$h2/repos"
srv o/ws; cl o/ws "$h2/repos/workspaces"; cl o/ws "$h2/repos/workspaces-rollout"
diverge "$h2/repos/workspaces" o/ws; held=$(git -C "$h2/repos/workspaces" rev-parse HEAD)
sr --refresh-in-place "$h2/repos/workspaces-rollout" HOME="$h2"; ok "$rc" 0 "diverged (a) swept: exit 0"
has "$out" "in-place: $h2/repos/workspaces not moved: diverged: 1 local-only commit(s) (on master, 1 commit(s) not on origin/master — stranded), 1 behind origin/master; " "diverged (a): the diverged line with repo-state's"
has "$out" "is commit-only (swept by the daily sweep)" "diverged (a): … commit-only, swept"
has "$out" "git -C $h2/repos/workspaces merge --no-edit origin/master" "diverged (a): … the merge advice"
nomerge "$h2/repos/workspaces" "$held" "diverged (a)"
r6="$home/repos/r6"; srv o/r6; cl o/r6 "$r6"; cl o/r6 "$r6-rollout"; diverge "$r6" o/r6; held=$(git -C "$r6" rev-parse HEAD)
printf -- '- o/r6 — shared team repo\n' > "$tmp/register.md"
sr --refresh-in-place "$r6-rollout" LANDING_REGISTER="$tmp/register.md"; ok "$rc" 0 "diverged (b) registered: exit 0"
has "$out" "is commit-only (listed o/r6: shared team repo)" "diverged (b): … the register's reason"
has "$out" "git -C $r6 merge --no-edit origin/master" "diverged (b): … the merge advice"
nomerge "$r6" "$held" "diverged (b)"
: > "$tmp/register.md"
g -C "$r6" update-ref refs/remotes/origin/close/x HEAD
sr --refresh-in-place "$r6-rollout" LANDING_REGISTER="$tmp/register.md"; ok "$rc" 0 "diverged (c) landable, queued: exit 0"
has "$out" "(on master, 1 commit(s) not on origin/master — queued in close/x)" "diverged (c): … repo-state's queued line"
has "$out" "$r6 lands by PR: once its queued landing PR merges, the next merge-task or land.sh S4 fast-forwards it" "diverged (c): … lands by PR"
lacks "$out" "merge --no-edit" "diverged (c): … no merge advice"
lacks "$out" "stranded" "diverged (c): … nothing stranded"
nomerge "$r6" "$held" "diverged (c)"
g -C "$r6" commit -q --allow-empty -m stranded-one; held=$(git -C "$r6" rev-parse HEAD)
sr --refresh-in-place "$r6-rollout" LANDING_REGISTER="$tmp/register.md"
has "$out" "lands by PR" "diverged (d) landable, stranded: … lands by PR"
has "$out" "; 1 stranded commit(s) are in no close/ branch: the next /thread:close in $r6 carries close-out commits, anything else is its owner's to land" "diverged (d): … the stranded addendum"
nomerge "$r6" "$held" "diverged (d)"
rm -f "$tmp/register.md"; ln -s "$tmp/nowhere.md" "$tmp/register.md"
sr --refresh-in-place "$r6-rollout" LANDING_REGISTER="$tmp/register.md"; ok "$rc" 0 "diverged (e) unreadable register: exit 0"
has "$out" "$r6's landing route is unknown (landing register: landing-register: " "diverged (e): … landing route is unknown"
nomerge "$r6" "$held" "diverged (e)"
rm -f "$tmp/register.md"

# 8. --launch-check: at the root, an ancestor within the toplevel, the toplevel; never elsewhere
lc() { out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" $SSHENV bash "$sc" --launch-check "$1" "$2" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
mkdir -p "$e1-rollout/sub/deep/er" "$e1-rollout/other"
lc "$e1-rollout/sub/deep" "$e1-rollout/sub/deep"; ok "$rc|$err" "0|" "launch: at the root → 0"
lc "$e1-rollout/sub/deep" "$e1-rollout/sub"; ok "$rc|$err" "0|" "launch: at an ancestor within the toplevel → 0"
lc "$e1-rollout/sub/deep" "$e1-rollout"; ok "$rc|$err" "0|" "launch: at the toplevel → 0"
lc "$e1-rollout/sub/deep" "$home/repos"; ok "$rc" 3 "launch: above the toplevel → 3"
has "$err" "start a session in $e1-rollout/sub/deep, then /thread:execute" "launch: … with the remedy"
lc "$e1-rollout/sub/deep" "$e1-rollout/sub/deep/er"; ok "$rc" 3 "launch: at a descendant → 3"
lc "$e1-rollout/sub/deep" "$e1-rollout/other"; ok "$rc" 3 "launch: at a sibling → 3"
lc "$e1-rollout/sub/deep" "$e1/sub"; ok "$rc" 3 "launch: at the in-place checkout → 3"
lc "$e1/sub" "$home"; ok "$rc" 0 "launch: a root that is no clone → 0"
has "$err" "WARN: $e1/sub is not a rollout clone" "launch: … with a WARN"
sp="$home/repos/s p"; srv o/sp; cl o/sp "$sp"; cl o/sp "$sp-rollout"
lc "$sp-rollout/sub" "$sp-rollout"; ok "$rc|$err" "0|" "launch: a path with a space → 0"
lc "$sp-rollout/sub" "$sp/sub"; ok "$rc" 3 "launch: … and its in-place checkout → 3"

# 9. --in-place: exit 0 prints the twin, 1 is no rollout clone
ip() { out=$(env HOME="$home" bash "$sc" --in-place "$1" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
mix="$home/repos/mix"; mk "$mix" "https://github.com/Own/Mix.git"; mk "$mix-rollout" "git@github.com:own/mix.git"
mkdir -p "$mix/a/b" "$mix-rollout/a/b" "$mix-rollout/only"
ip "$mix-rollout"; ok "$rc|$out" "0|$mix" "in-place: an https/ssh pair with mixed case, at the root → the twin"
ip "$mix-rollout/a/b"; ok "$rc|$out" "0|$mix/a/b" "in-place: … at a sub-path → the same sub-path of the twin"
ip "$mix-rollout/only"; ok "$rc|$out" "0|$mix" "in-place: … a sub-path the twin lacks → the twin's toplevel"
ip "$mix"; ok "$rc|$out" "1|" "in-place: the twin itself → 1"
g -C "$mix-rollout" remote set-url origin "https://github.com/other/mix.git"
ip "$mix-rollout"; ok "$rc|$out" "1|" "in-place: another owner → 1"
g -C "$mix-rollout" remote set-url origin "https://gitlab.com/own/mix.git"
ip "$mix-rollout"; ok "$rc|$out" "1|" "in-place: a non-GitHub origin → 1"
g -C "$mix-rollout" remote remove origin
ip "$mix-rollout"; ok "$rc|$out" "1|" "in-place: no origin → 1"
wt="$home/repos/wt"; mk "$wt" "https://github.com/o/wt.git"; g -C "$wt" worktree add -q --detach "$wt-rollout"
ip "$wt-rollout"; ok "$rc|$out" "1|" "in-place: a linked worktree named x-rollout → 1"
pl="$home/repos/pl-rollout"; mk "$pl" "https://github.com/o/pl.git"; mkdir -p "$home/repos/pl"
ip "$pl"; ok "$rc|$out" "1|" "in-place: a plain directory as the sibling → 1"
ws2="$home/repos/ws2"; mk "$tmp/ws2main" "https://github.com/o/ws2.git"; g -C "$tmp/ws2main" worktree add -q --detach "$ws2"
mk "$ws2-rollout" "https://github.com/o/ws2.git"
ip "$ws2-rollout"; ok "$rc|$out" "1|" "in-place: a worktree as the sibling → 1"
ip "$tmp/nowhere"; ok "$rc|$out" "1|" "in-place: a missing path → 1"
ip "$tmp/other"; ok "$rc|$out" "1|" "in-place: outside git → 1"

# ---- execute § 2.8: the launch-directory gate's snippet, verbatim, under bash and zsh -----------------------
ex=skills/execute/SKILL.md
awk '/^# thread:launch-dir-check/{on=1; next} /^# end thread:launch-dir-check/{on=0} on' "$ex" > "$tmp/lraw.sh"
ok "$(grep -c '^R="<repoPath>"$' "$tmp/lraw.sh")" 1 "the launch-dir snippet is found in execute § 2.8, with its <repoPath> placeholder"
ok "$(grep -c '^D="<launchDir>"$' "$tmp/lraw.sh")" 1 "… and its <launchDir> placeholder"
ok "$(grep -cE '\$[0-9]' "$tmp/lraw.sh")" 0 "the launch-dir snippet holds no positional \$N"
sed -e 's/^R="<repoPath>"$/R="$1"/' -e 's/^D="<launchDir>"$/D="$2"/' "$tmp/lraw.sh" > "$tmp/lsnip.sh"
for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  out=$(env HOME="$home" CLAUDE_PLUGIN_ROOT="$root" $sh "$tmp/lsnip.sh" "$e1-rollout/sub" "$e1-rollout" 2>"$tmp/err"); rc=$?
  ok "$rc" 0 "$n: § 2.8 snippet: launched at an ancestor within the toplevel → 0"
  out=$(env HOME="$home" CLAUDE_PLUGIN_ROOT="$root" $sh "$tmp/lsnip.sh" "~/repos/e1-rollout/sub" "$e1/sub" 2>"$tmp/err"); rc=$?
  ok "$rc" 3 "$n: § 2.8 snippet: a ~/ root, launched in the in-place checkout → 3"
  out=$(env HOME="$home" CLAUDE_PLUGIN_ROOT="$tmp/noplugin" $sh "$tmp/lsnip.sh" "$e1-rollout" "$e1-rollout" 2>"$tmp/err"); rc=$?
  ok "$rc" 2 "$n: § 2.8 snippet: the script missing → 2"
done

# ---- wiring: § 2.6 and § 7 name both reasons; the halt line parses for the Stop hook --------------------
sect() { awk -v a="$1" -v b="$2" 'index($0, a) == 1 {on=1} index($0, b) == 1 && on && index($0, a) != 1 {exit} on' "$skill"; }
s26=$(sect '### 2.6. Self-rollout gate' '### 2.7.')
s7=$(sect '### 7. Continuous-mode stop conditions' '### 8.')
for r in 'reason="repoPath is a live plugin marketplace checkout"' 'reason="self-rollout check failed"'; do
  has "$s26" "$r" "§ 2.6 names $r"
  has "$s7" "$r" "§ 7 names $r"
done
has "$s26" "Pausing is exempt" "§ 2.6: pausing is exempt"
has "$s26" "**Any other non-zero exit**" "§ 2.6: an undefined non-zero exit halts too (fails closed)"
ok "$(printf '%s\n%s\n' "$s26" "$s7" | python3 -c '
import re, sys
vals = re.findall(r"reason=\"([^`]*)\"", sys.stdin.read())
print("ok" if vals and all("\"" not in v for v in vals) else "bad: %r" % vals)')" ok "every § 2.6 / § 7 reason value is quote-free"
ok "$(python3 - "$root/hooks/rollout-stop-driver.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rsd", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
line = 'ROLLOUT-STATUS: proj-rollout merged=0/3 running=0 state=halted reason="repoPath is a live plugin marketplace checkout"'
hit = m.STATUS_RE.search(line)
print("ok" if hit and hit.group("state") == "halted" else "no match")
PY
)" ok "the § 2.6 halt line matches the Stop hook's STATUS_RE"
has "$(grep -n '^# thread:self-rollout-check' "$ef")" "tests/self-rollout-check.test.sh" "execution-fit.md's snippet names this test"

# ---- wiring: execute § 2.8, the launch-directory gate (ADR 0042) ----------------------------------------------
s28=$(sect '### 2.8. Launch-directory gate' '### 3.')
a=$(grep -nF '### 2.7. Pushed-base gate' "$skill" | cut -d: -f1); b=$(grep -nF '### 2.8. Launch-directory gate' "$skill" | cut -d: -f1); c=$(grep -nF '### 3. ' "$skill" | head -1 | cut -d: -f1)
ok "$([ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ] && [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ] && echo y)" y "execute § 2.8 sits between § 2.7 and § 3"
for w in 'reason="launched outside the Project root"' "Pausing is exempt" "Entry points only" "--launch-check" "primary working directory" "never \`pwd\`" "WARN"; do
  has "$s28" "$w" "§ 2.8 names $w"
done
has "$s7" 'reason="launched outside the Project root"' "§ 7 names the launch-directory halt"
ok "$(python3 - "$root/hooks/rollout-stop-driver.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rsd", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
line = 'ROLLOUT-STATUS: proj-rollout merged=0/3 running=0 state=halted reason="launched outside the Project root"'
hit = m.STATUS_RE.search(line)
print("ok" if hit and hit.group("state") == "halted" else "no match")
PY
)" ok "the § 2.8 halt line matches the Stop hook's STATUS_RE"

# ---- wiring: one copy, in execution-fit.md; schedule § 0 and execute § 2.6 point at it ----------------
for f in skills/schedule/SKILL.md "$skill"; do
  ok "$(grep -c '# thread:self-rollout-check' "$f")" 0 "$f does not copy the snippet"
done
srl=$(grep -n '^\*\*Self-rollout\.\*\*' "$ef" | cut -d: -f1); gol=$(grep -n '^\*\*GitHub `origin`\.\*\*' "$ef" | cut -d: -f1)
ok "$([ -n "$srl" ] && [ -n "$gol" ] && [ "$srl" -lt "$gol" ] && echo y)" y "Self-rollout is listed first, ahead of GitHub origin (execute § 2.6 runs it first)"
s26f=$(printf '%s\n' "$s26" | tr '\n' ' ')
has "$s26f" "execution-fit.md\` § Dispatch blockers (point at it; never copy the snippet here), with \`<mode>\` empty" "execute § 2.6 points at execution-fit.md § Dispatch blockers, plain mode"
has "$s26f" "Execute never swaps a root itself" "execute § 2.6 never swaps a root"

echo; [ "$fail" -eq 0 ] && echo "self-rollout-check: ALL PASS" || echo "self-rollout-check: SOME FAILED"
exit "$fail"
