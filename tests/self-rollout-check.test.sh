#!/usr/bin/env bash
# p12-4, executed: the self-rollout dispatch blocker — the `# thread:self-rollout-check` wrapper extracted
# verbatim from skills/_shared/execution-fit.md § Dispatch blockers by its markers, with `R="$1"`
# substituted for the `<repoPath>` placeholder, run under bash AND zsh (the Bash tool's shell on macOS)
# against a fixture known_marketplaces.json; then the `# thread:rollout-clone` lookup beside it, against
# fixture clones, and the schedule gate the two compose. Plus the wiring: schedule § 0 and execute § 2.6
# point at the snippet without copying it, § 2.6 and § 7 name both halt reasons, and the halt line the lead
# prints parses for the Stop hook. Hermetic: HOME, CLAUDE_CONFIG_DIR and every path live under mktemp; commits
# carry an inline identity; never the network; global/system git config is ignored.
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
ok "$(grep -cE '\$[0-9]' "$tmp/raw.sh")" 0 "the snippet holds no positional \$N (skill arguments substitute into them)"
snip=$(sed 's/^R="<repoPath>"$/R="$1"/' "$tmp/raw.sh")

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
  run() { local r="$1"; shift; env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" "$@" $sh -c "$snip" _ "$r" >/dev/null 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err"); }

  write_reg "$home/repos/plug" "$tmp/other"
  run "$home/repos/plug"; ok "$rc" 3 "$n: repoPath is a directory-source checkout → 3"
  has "$err" "make a separate clone at $home/repos/plug-rollout (" "$n: … the fix on stderr, naming <repoPath>-rollout"
  has "$err" "then run /thread:schedule <project> --regenerate, which re-roots the rollout there; never hand-edit its Project root" "$n: … through --regenerate, never a hand edit"
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
  has "$err" "make a separate clone at $pd/plugin-rollout (" "$n: … and the same fix"
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

# ---- the rollout-clone lookup: schedule § 0's sibling `<repoPath>-rollout`, verbatim from execution-fit.md --
awk '/^# thread:rollout-clone/{on=1; next} /^# end thread:rollout-clone/{on=0} on' "$ef" > "$tmp/rawc.sh"
ok "$(grep -c '^R="<repoPath>"$' "$tmp/rawc.sh")" 1 "the rollout-clone snippet is found in execution-fit.md, with its <repoPath> placeholder"
ok "$(grep -cE '\$[0-9]' "$tmp/rawc.sh")" 0 "the rollout-clone snippet holds no positional \$N"
csnip=$(sed 's/^R="<repoPath>"$/R="$1"/' "$tmp/rawc.sh")
csnip_f="$tmp/clone.sh"; printf '%s\n' "$csnip" > "$csnip_f"
snip_f="$tmp/check.sh"; printf '%s\n' "$snip" > "$snip_f"

g() { git -c init.defaultBranch=main -c user.name=t -c user.email=t@example.invalid "$@"; }
# mk <dir> <origin-url>: a clone — one empty commit on main, origin/main at it, origin/HEAD → origin/main
mk() {
  g init -q "$1" && g -C "$1" remote add origin "$2" && g -C "$1" commit -q --allow-empty -m one &&
    g -C "$1" update-ref refs/remotes/origin/main HEAD && g -C "$1" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
}
live="$home/repos/live"; sib="$live-rollout"
mk "$live" "https://github.com/Owner/Live.git"
write_reg "$live" "$tmp/other"
# The test scrubbed its own repo-local git env above, for its fixtures. Every lookup runs with a hostile one
# put back: GIT_DIR and GIT_WORK_TREE naming a decoy that is itself a usable clone of the same repo, so a
# lookup that let inherited env override -C would answer for the decoy and wrongly pass the rejections.
decoy="$tmp/decoy"; mk "$decoy" "https://github.com/owner/live.git"

for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  # look <repoPath> [VAR=val …]: rc in $rc, stdout in $out, stderr in $err
  look() { local r="$1"; shift; out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" GIT_DIR="$decoy/.git" GIT_WORK_TREE="$decoy" "$@" $sh "$csnip_f" "$r" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
  why() { has "$err" "$sib is not a usable rollout clone: $1" "$2"; }
  rm -rf "$sib" "$home/repos/nested"

  look "$live"; ok "$rc|$out" "1|" "$n: no sibling → 1, nothing printed"
  why "nothing is there; clone the repo to it (git clone <origin URL> \"$sib\")" "$n: … naming the one path to clone to"
  mk "$sib" "git@github.com:owner/live.git"
  look "$live"; ok "$rc|$out|$err" "0|$sib|" "$n: a clone of the same repo (other URL shape and case) → its path, silent"
  look "~/repos/live/"; ok "$rc|$out" "0|$sib" "$n: … from a ~/…/ Project root (trailing / stripped)"

  # Its branch, working tree and lag are no rollout's concern: the real rollout clone carries the engine's own
  # untracked scratch, and execute's worktrees branch from origin.
  g -C "$sib" commit -q --allow-empty -m two; g -C "$sib" update-ref refs/remotes/origin/main HEAD; g -C "$sib" reset -q --hard HEAD~1
  g -C "$sib" switch -q -c feature; mkdir -p "$sib/.claude"; : > "$sib/.claude/merge.status"; : > "$sib/untracked"
  look "$live"; ok "$rc|$out|$err" "0|$sib|" "$n: on another branch, untracked engine scratch, behind origin → still its path, silent"
  rm -rf "$sib"; mk "$sib" "https://github.com/owner/live.git"

  g -C "$sib" remote set-url origin "https://github.com/owner/other.git"
  look "$live"; ok "$rc|$out" "1|" "$n: a sibling of another repo → 1"
  why "its origin is owner/other, not Owner/Live" "$n: … naming both"
  g -C "$sib" remote set-url origin "$tmp/somewhere.git"
  look "$live"; ok "$rc|$out" "1|" "$n: a sibling with a path origin → 1 (land.sh --origin-slug's exit, not its stdout)"
  why "its origin does not name a GitHub <owner>/<name>" "$n: … no GitHub origin"
  g -C "$sib" remote set-url origin "https://github.com/owner/live.git"

  cat > "$reg" <<EOF
{"a": {"source": {"source": "directory", "path": "$live"}}, "b": {"source": {"source": "directory", "path": "$sib"}}}
EOF
  look "$live"; ok "$rc|$out" "1|" "$n: a sibling that is a marketplace checkout too → 1"
  why "it holds a live plugin checkout too" "$n: … saying so"
  write_reg "$live" "$tmp/other"
  # this session's plugin root inside the clone: the lookup's own self-rollout check refuses it
  plugin_copy "$sib/plug"
  look "$live" CLAUDE_PLUGIN_ROOT="$sib/plug"; ok "$rc|$out" "1|" "$n: a sibling holding \${CLAUDE_PLUGIN_ROOT} → 1"
  why "it holds a live plugin checkout too" "$n: … saying so"

  # a linked worktree of the primary shares its .git: not a separate clone
  rm -rf "$sib"; g -C "$live" worktree add -q --detach "$sib"
  look "$live"; ok "$rc|$out" "1|" "$n: a linked worktree of the primary → 1"
  why "it is a linked worktree of $live/.git, not a separate clone" "$n: … not a separate clone"
  # CDPATH must not steer the common-dir lookup (the review reproduced `cd` honouring it)
  look "$live" CDPATH="$decoy"; ok "$rc|$out" "1|" "$n: … still 1 with a hostile CDPATH"
  g -C "$live" worktree remove --force "$sib"

  mkdir -p "$sib"
  look "$live"; ok "$rc|$out" "1|" "$n: a plain directory → 1"
  why "it is not the top of a git work tree" "$n: … not a work-tree top"
  rm -rf "$sib"
  # a plain directory inside another clone of the same repo is not a clone's top
  nx="$home/repos/nested/x"
  mk "$home/repos/nested" "https://github.com/owner/live.git"; mkdir -p "$nx" "$nx-rollout"
  look "$nx"; ok "$rc|$out" "1|" "$n: a sibling inside a parent clone of the same repo → 1"
  has "$err" "not the top of a git work tree" "$n: … not a work-tree top"
  # The review's reproduction: that directory holding a git dir that ignores everything, inherited as GIT_DIR
  # (and no GIT_WORK_TREE). Unscrubbed, git takes the directory as a clean work tree of the same repo, its own
  # clone, on main, and the lookup passes it.
  mk "$nx-rollout/inner" "https://github.com/owner/live.git"; echo '*' > "$nx-rollout/inner/.git/info/exclude"
  out=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" GIT_DIR="$nx-rollout/inner/.git" $sh "$csnip_f" "$nx" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err")
  ok "$rc|$out" "1|" "$n: … still 1 under an inherited GIT_DIR inside it"
  has "$err" "not the top of a git work tree" "$n: … for the same reason"

  mk "$sib" "https://github.com/owner/live.git"
  look "$live" CLAUDE_PLUGIN_ROOT="$tmp/noplugin"; ok "$rc|$out" "2|" "$n: the script missing → 2"
  has "$err" "self-rollout-check.sh not found at $tmp/noplugin/" "$n: … with the not-found line"
done
ok "$(env GIT_DIR="$decoy/.git" bash skills/execute/scripts/self-rollout-check.sh --rollout-clone >/dev/null 2>&1; echo $?)" 2 "--rollout-clone with no path → usage error 2"

# ---- the schedule gate: the check, then (on exit 3 only) the lookup, then the first write ---------------
# gate <root>: writes the Project root it would carry to $tmp/written, or nothing; rc is the gate's exit.
gate() {
  rm -f "$tmp/written"; local r="$1" c
  env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" bash "$snip_f" "$r" 2>/dev/null; rc=$?
  if [ "$rc" = 3 ]; then   # the lookup proves the clone (its own self-rollout check included): no re-run
    r=$(env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="$root" bash "$csnip_f" "$r" 2>/dev/null) && rc=0 || { rc=3; return; }
  fi
  [ "$rc" = 0 ] && printf '%s\n' "$r" > "$tmp/written"
}
written() { [ -e "$tmp/written" ] && cat "$tmp/written" || echo "<nothing>"; }
rm -rf "$sib"
gate "$live"; ok "$rc|$(written)" "3|<nothing>" "schedule gate: the live checkout with no separate clone → refused, nothing written"
mk "$sib" "https://github.com/owner/live.git"
gate "$live"; ok "$rc|$(written)" "0|$sib" "schedule gate: the live checkout with a usable sibling clone → the clone is the Project root"
g -C "$sib" remote set-url origin "https://github.com/owner/other.git"
gate "$live"; ok "$rc|$(written)" "3|<nothing>" "schedule gate: … but one of another repo → refused, nothing written"
g -C "$sib" remote set-url origin "https://github.com/owner/live.git"
gate "$tmp/other"; ok "$rc|$(written)" "0|$tmp/other" "schedule gate: a root that is no marketplace → kept as is"

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
has "$(grep -n '^# thread:rollout-clone' "$ef")" "tests/self-rollout-check.test.sh" "execution-fit.md's rollout-clone snippet names this test"

# ---- wiring: one copy, in execution-fit.md; schedule § 0 and execute § 2.6 point at it ----------------
for f in skills/schedule/SKILL.md "$skill"; do
  ok "$(grep -c '# thread:self-rollout-check\|# thread:rollout-clone' "$f")" 0 "$f copies neither snippet"
done
has "$(tr '\n' ' ' < "$ef")" "Six blockers" "execution-fit names six blockers"
lr=$(grep -n '^\*\*Landing register\.\*\*' "$ef" | cut -d: -f1); srl=$(grep -n '^\*\*Self-rollout\.\*\*' "$ef" | cut -d: -f1); pbl=$(grep -n '^\*\*Pushed base\.\*\*' "$ef" | cut -d: -f1)
ok "$([ -n "$lr" ] && [ -n "$srl" ] && [ -n "$pbl" ] && [ "$lr" -lt "$srl" ] && [ "$srl" -lt "$pbl" ] && echo y)" y "Self-rollout sits between Landing register and Pushed base"
s26f=$(printf '%s\n' "$s26" | tr '\n' ' ')
has "$s26f" "execution-fit.md\` § Dispatch blockers (point at it; never copy the snippet here)" "execute § 2.6 points at execution-fit.md § Dispatch blockers"
has "$s26f" "Execute never swaps a root itself" "execute § 2.6 never swaps a root"

echo; [ "$fail" -eq 0 ] && echo "self-rollout-check: ALL PASS" || echo "self-rollout-check: SOME FAILED"
exit "$fail"
