#!/usr/bin/env bash
# p12-3, executed: the lead's § 4 git-env check in skills/execute/SKILL.md (extracted by its marker) and the
# engine's rendered verifier command, both run under bash AND zsh (the Bash tool's shell on macOS) with
# GIT_* set on the single invocation only. tests/git-env-scrub.test.mjs pins the rendered prompt text.
# Hermetic: every repo lives under mktemp; the caller's own GIT_DIR & co. are unset first.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# ---- the snippet, verbatim from the skill --------------------------------------------------------------
skill=skills/execute/SKILL.md
awk '/^# thread:git-env-check/{on=1; next} /^# end thread:git-env-check/{on=0} on' "$skill" > "$tmp/check.sh"
ok "$(grep -c 'git rev-parse --local-env-vars' "$tmp/check.sh")" 2 "git-env check snippet found in execute/SKILL.md"
ok "$(grep -c 'in \$vars' "$tmp/check.sh")" 0 "the snippet never iterates \$vars (zsh does not split it)"
ok "$(grep -cE '\$[0-9]' "$tmp/check.sh")" 0 "the snippet holds no positional \$N (skill arguments substitute into them)"
snip=$(cat "$tmp/check.sh")

# Placement: inside § 4, before the default-branch resolver; § 5's resume re-runs it; § 7 carries both reasons.
line() { grep -nF -- "$1" "$skill" | head -1 | cut -d: -f1; }
s4=$(line '### 4. Stamp in-progress'); chk=$(line '# thread:git-env-check'); res=$(line '# thread:default-branch-resolver'); s45=$(line '### 4.5.')
ok "$([ "$s4" -lt "$chk" ] && [ "$chk" -lt "$res" ] && [ "$res" -lt "$s45" ] && echo y)" y "the check sits in § 4, before the resolver"
sect() { awk -v a="$1" -v b="$2" 'index($0, a) == 1 {on=1} index($0, b) == 1 && on && index($0, a) != 1 {exit} on' "$skill"; }
has "$(sect '### 5. Call the Workflow' '### 6.' | grep resumeFromRunId)" "§ 4's git-env check" "§ 5's resume re-runs the git-env check"
s7=$(sect '### 7. Continuous-mode stop conditions' '### 8.')
has "$s7" 'reason="git env set in the lead session"' "§ 7 names the exit-1 reason"
has "$s7" 'reason="git-env check failed"' "§ 7 names the exit-2 reason"
s4t=$(sect '### 4. Stamp in-progress' '### 4.5.')
has "$s4t" 'reason="git env set in the lead session"' "§ 4 names the exit-1 reason"
has "$s4t" 'no stamp, no `mark-dispatched`, no Workflow call' "§ 4: a halt writes nothing"

# ---- the snippet, executed ------------------------------------------------------------------------------
mkdir -p "$tmp/nogit"
for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  run() { env "$@" $sh -c "$snip" 2>"$tmp/err" >/dev/null; }   # run <VAR=val …>; rc in $?, stderr in $tmp/err
  run; rc=$?; ok "$rc|$(cat "$tmp/err")" "0|" "$n: clean env → rc 0, silent"
  for v in GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; do
    run "$v=$tmp/nowhere"; rc=$?
    ok "$rc" 1 "$n: $v set → rc 1"
    has "$(cat "$tmp/err")" "$v" "$n: $v set → stderr names it"
  done
  run GIT_DIR=; ok "$?" 1 "$n: GIT_DIR exported empty → rc 1"
  run GIT_DIR="$tmp/nowhere"; has "$(cat "$tmp/err")" "relaunch Claude Code" "$n: GIT_DIR → the relaunch line"
  case "$(cat "$tmp/err")" in *"git -c"*) ok hint none "$n: GIT_DIR → no git -c hint";; *) ok y y "$n: GIT_DIR → no git -c hint";; esac
  run "GIT_CONFIG_PARAMETERS='core.x=1'"; rc=$?
  ok "$rc" 1 "$n: GIT_CONFIG_PARAMETERS set → rc 1"
  has "$(cat "$tmp/err")" "git -c" "$n: GIT_CONFIG_PARAMETERS → the git -c hint"
  run GIT_EDITOR=true; ok "$?" 0 "$n: GIT_EDITOR (not repo-local) → rc 0"
  run PATH="$tmp/nogit"; rc=$?
  ok "$rc" 2 "$n: git missing → rc 2 (fail closed)"
  has "$(cat "$tmp/err")" "git-env: git rev-parse --local-env-vars failed" "$n: git missing → names the failure"
done

# ---- the engine's rendered verifier, executed under an inherited GIT_DIR ---------------------------------
g init -q "$tmp/repo"; g -C "$tmp/repo" commit -q --allow-empty -m repo
g init -q "$tmp/decoy"; g -C "$tmp/decoy" commit -q --allow-empty -m decoy
cmd=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['ralphLoop'])
  const l = T.ralphLoop('git rev-parse --absolute-git-dir', 1).split('\n').find((x) => x.startsWith('- Verifier: '))
  process.stdout.write(l.slice('- Verifier: '.length))
")
has "$cmd" 'unset $(git rev-parse --local-env-vars 2>/dev/null); git rev-parse --absolute-git-dir' "the rendered verifier carries the scrub"
want=$(git -C "$tmp/repo" rev-parse --absolute-git-dir)
for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  got=$(cd "$tmp/repo" && env GIT_DIR="$tmp/decoy/.git" $sh -c "$cmd" 2>/dev/null)
  ok "$got" "$want" "$n: the rendered verifier runs against the checkout, not an inherited GIT_DIR"
  got=$(cd "$tmp/repo" && env GIT_DIR="$tmp/decoy/.git" GIT_WORK_TREE="$tmp/decoy" $sh -c "$cmd" 2>/dev/null)
  ok "$got" "$want" "$n: … nor an inherited GIT_DIR + GIT_WORK_TREE"
done

echo; [ "$fail" -eq 0 ] && echo "git-env-scrub: ALL PASS" || echo "git-env-scrub: SOME FAILED"
exit "$fail"
