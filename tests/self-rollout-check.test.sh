#!/usr/bin/env bash
# p12-4, executed: execute's § 2.6 self-rollout gate — the `# thread:self-rollout-check` wrapper extracted
# verbatim from skills/execute/SKILL.md by its markers, with `R="$1"` substituted for the `<repoPath>`
# placeholder, run under bash AND zsh (the Bash tool's shell on macOS) against a fixture
# known_marketplaces.json. Plus the wiring: § 2.6 and § 7 name both halt reasons, and the halt line the
# lead prints parses for the Stop hook. Hermetic: HOME, CLAUDE_CONFIG_DIR and every path live under mktemp.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
root=$(pwd -P)
skill=skills/execute/SKILL.md

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tmp=$(cd "$tmp" && pwd -P)

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# ---- the snippet, verbatim from the skill --------------------------------------------------------------
awk '/^# thread:self-rollout-check/{on=1; next} /^# end thread:self-rollout-check/{on=0} on' "$skill" > "$tmp/raw.sh"
ok "$(grep -c '^R="<repoPath>"$' "$tmp/raw.sh")" 1 "the § 2.6 snippet is found, with its <repoPath> placeholder"
ok "$(grep -cE '\$[0-9]' "$tmp/raw.sh")" 0 "the snippet holds no positional \$N (skill arguments substitute into them)"
snip=$(sed 's/^R="<repoPath>"$/R="$1"/' "$tmp/raw.sh")

# ---- fixtures -------------------------------------------------------------------------------------------
home="$tmp/home"; cfg="$tmp/cfg"; mkdir -p "$home/repos/plug" "$home/repos/mono/tools/plug" "$home/repos/plugin2" "$tmp/other" "$cfg/plugins" "$tmp/noplugin"
ln -s "$home/repos/plug" "$tmp/link"
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
  has "$err" "clone the repo to a separate path" "$n: … the remedy on stderr"
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
ok "$(python3 - "$root/hooks/wave-stop-driver.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("wsd", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
line = 'WAVE-STATUS: proj-rollout cursor=0/3 state=halted reason="repoPath is a live plugin marketplace checkout"'
hit = m.STATUS_RE.search(line)
print("ok" if hit and hit.group("state") == "halted" else "no match")
PY
)" ok "the § 2.6 halt line matches the Stop hook's STATUS_RE"
has "$(grep -n 'self-rollout-check' "$skill")" "tests/self-rollout-check.test.sh" "SKILL.md's snippet names this test"

echo; [ "$fail" -eq 0 ] && echo "self-rollout-check: ALL PASS" || echo "self-rollout-check: SOME FAILED"
exit "$fail"
