#!/usr/bin/env bash
# hooks/primary-commit-guard.py — the PreToolUse hook on Bash that refuses a command making a commit on the Primary
# checkout's default branch (ADR 0078 d3). The hook's docstring holds every rule; this pins them on a fixture Primary
# (a clone of a local bare origin with the hook and the two engine scripts it reads copied in at their own paths), a
# linked worktree, a snapshot and a second clone, with payloads built by json.dumps. Temp dirs only.
# Usage: bash tests/primary-commit-guard.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
root="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
unset $(git rev-parse --local-env-vars)
mkdir -p "$HOME"
. "$root/tests/lib/assert.sh"
git config --global user.name t; git config --global user.email t@example.invalid

install() {  # install <plugin root> — the hook and what it loads, at their own paths
  mkdir -p "$1/hooks" "$1/skills/_shared/scripts" "$1/skills/execute/scripts"
  cp "$root/hooks/primary-commit-guard.py" "$1/hooks/"
  cp "$root/skills/_shared/scripts/engine-snapshot.py" "$1/skills/_shared/scripts/"
  cp "$root/skills/execute/scripts/default-branch.sh" "$1/skills/execute/scripts/"
}

O="$T/origin.git"; P="$T/primary"; OTHER="$T/other"; WT="$T/wt"; S="$T/snap"; PLAIN="$T/plain"
git init -q --bare -b master "$O"
git clone -q "$O" "$T/seed" 2>/dev/null
git -C "$T/seed" checkout -q -b master 2>/dev/null
echo a > "$T/seed/a"; git -C "$T/seed" add a; git -C "$T/seed" commit -q -m seed; git -C "$T/seed" push -q origin master
git -C "$T/seed" push -q origin master:only-on-origin
git clone -q "$O" "$P"
git clone -q "$O" "$OTHER"
install "$P"
HOOK="$P/hooks/primary-commit-guard.py"
git -C "$P" worktree add -q -b in-worktree "$WT"
git -C "$P" branch -q feature
git -C "$P" tag t1
mkdir -p "$P/sub/dir" "$PLAIN"

cat > "$T/h.py" <<'PY'
import json, sys
if sys.argv[1] == "payload":
    # payload <cwd or -> <tool> <command>
    cwd, tool, command = sys.argv[2:5]
    p = {"session_id": "s", "transcript_path": "/x.jsonl", "hook_event_name": "PreToolUse", "tool_name": tool,
         "tool_input": {"command": command}}
    if cwd != "-":
        p["cwd"] = cwd
    print(json.dumps(p))
else:
    # get <file> <python expression over d>
    raw = open(sys.argv[2], encoding="utf-8").read()
    d = json.loads(raw) if raw.strip() else None
    print(eval(sys.argv[3], {"d": d}))
PY
H() { python3 "$T/h.py" "$@"; }

# run <cwd or -> <command> [<hook path> [<tool>]] — sets rc, out, err; v is deny or allow
run() {
  local p
  p=$(H payload "$1" "${4:-Bash}" "$2")
  printf '%s' "$p" | python3 "${3:-$HOOK}" > "$T/out" 2> "$T/err"
  rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err")
  v=allow; [ -n "$out" ] && v=$(H get "$T/out" 'd["hookSpecificOutput"]["permissionDecision"]')
}
deny() { run "$1" "$2" "${4:-}"; ok "$rc|$v|$err" "0|deny|" "deny: $3"; }
allow() { run "$1" "$2" "${4:-}"; ok "$rc|$v|$out|$err" "0|allow||" "allow: $3"; }

# ── 1. the task's Verify: on master in the Primary, a branch, a worktree, any other repo ─────────────────────────
deny "$P" 'git commit -m x' "git commit in the Primary on its default branch"
ok "$(H get "$T/out" 'd["hookSpecificOutput"]["hookEventName"]')" PreToolUse "the output is PreToolUse's hookSpecificOutput"
why=$(H get "$T/out" 'd["hookSpecificOutput"]["permissionDecisionReason"]')
has "$why" "ADR 0078" "the refusal cites the decision"
has "$why" "git commit" "the refusal names the command it refused"
has "$why" "master" "the refusal names the branch"
has "$why" "$P" "the refusal names the Primary"
has "$why" "branch" "the refusal names the remedy: a branch"
has "$why" "land.sh" "the refusal names the remedy: land.sh"
git -C "$P" checkout -q feature
allow "$P" 'git commit -m x' "git commit in the Primary on another branch"
git -C "$P" checkout -q master
allow "$WT" 'git commit -m x' "git commit in a linked worktree of the Primary's repo"
allow "$OTHER" 'git commit -m x' "git commit on the default branch of any other repo"
allow "$PLAIN" 'git commit -m x' "git commit outside any repo"
deny "$P/sub/dir" 'git commit -m x' "git commit from a subdirectory of the Primary"

# ── 2. the command's text: what it runs, and where. One process over plan(), the layer that reads it ───────────────
cat > "$T/table.py" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("guard", sys.argv[1]); g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
H = os.path.expanduser("~")
def ops(cwd, text):
    s = g.Scan(text); s.words(None)
    return g.plan(s.out, cwd)
C = ["commit"]
VERBS = [  # the command, in cwd /c, and the verbs it counts as committing
    # every command that makes a commit; the forms that make none
    ("git commit --amend --no-edit", C), ("git merge feature", ["merge"]), ("git merge --no-ff feature", ["merge"]),
    ("git cherry-pick abc123", ["cherry-pick"]), ("git am x.patch", ["am"]), ("git rebase origin/master", ["rebase"]),
    ("git revert HEAD", ["revert"]), ("git pull", ["pull"]), ("git pull --rebase", ["pull"]),
    ("git pull --no-ff origin master", ["pull"]), ("git merge --continue", ["merge"]),
    ("git cherry-pick --continue", ["cherry-pick"]), ("git rebase --continue", ["rebase"]),
    ("git pull --ff-only", []), ("git pull --ff-only origin master", []), ("git merge --ff-only origin/master", []),
    ("git merge --abort", []), ("git merge --quit", []), ("git rebase --abort", []), ("git rebase --quit", []),
    ("git cherry-pick --abort", []), ("git am --abort", []), ("git revert --abort", []), ("git cherry-pick -n abc123", []),
    ("git revert --no-commit HEAD", []), ("git merge --no-commit feature", []), ("git merge --squash feature", []),
    ("git commit --dry-run", []), ("git commit --help", []), ("git rebase --show-current-patch=diff", []),
    ("git merge-base HEAD origin/master", []), ("git commit-tree HEAD^{tree}", []), ("git status", []),
    ("git log --grep=commit", []), ("git show merge", []), ("git diff rebase", []), ("git fetch origin", []),
    ("git branch -d merge", []), ("git stash push -m commit", []),
    ('git commit -m "--dry-run: a fix" -- a', C), ("git commit -m x -- --dry-run", C),
    # only a git the shell would run
    ("unset $(git rev-parse --local-env-vars 2>/dev/null); git commit -m x", C), ("git add a && git commit -m x", C),
    ("false || git commit -m x", C), ("echo x | git commit -F -", C), ("sleep 1 & git commit -m x", C),
    ("git add a\ngit commit -m x", C), ("git add a \\\n  && git \\\n  commit -m x", C), ("FOO=bar git commit -m x", C),
    ("env FOO=bar git commit -m x", C), ("command git commit -m x", C), ("if true; then git commit -m x; fi", C),
    ("for i in 1; do git commit -m x; done", C), ("{ git commit -m x; }", C), ("/usr/bin/git commit -m x", C),
    ("git -c user.name=x --no-pager commit -m x", C), ("git commit -m x 2>&1 | tail -1", C),
    ("git commit -m x >/dev/null 2>&1", C), ("2>/dev/null git commit -m x", C), ("x=$(git commit -m x)", C),
    ("echo `git commit -m x`", C), ('git commit -m "$(cat <<\'EOF\'\nIt\'s a "quoted" fix (really)\nEOF\n)"', C),
    ("cat > f <<'EOF'\nit's\nEOF\ngit commit -m x", C), ("cat <<-EOF > f\n\tbody\n\tEOF\ngit commit -m x", C),
    ('git commit -m x; echo "unterminated', C), ("&>/dev/null git commit -m x", C),
    ("echo git commit -m x", []), ('echo "git commit -m x"', []), ("grep -n 'git merge' a", []),
    ('python3 -c "print(1); git commit"', []), ("# git commit -m x", []), ("ls # then git commit -m x", []),
    ("cat > f <<'EOF'\ngit commit -m x\nEOF", []), ("cat > f <<EOF\ngit rebase x\nEOF\nls", []), ("git add commit", []),
    ("gh pr merge 1", []), ("make commit", []), ("gitk commit", []), ("ls >git commit", []),
    ('x="git commit"; echo "$x"', []),
]
DIRS = [  # cwd, the command, the directories its one call runs in
    ("/o", "cd /p && git commit -m x", ["/p"]), ("/o", "git -C /p commit -m x", ["/p"]),
    ("/t", "git -C primary commit -m x", ["/t/primary"]), ("/p/sub", "git -C .. commit -m x", ["/p"]),
    ("/o", "git -C /t -C primary commit -m x", ["/t/primary"]), ("/o", "cd /t; cd primary; git commit -m x", ["/t/primary"]),
    ("/p", "(cd /o && git status); cd /o; git commit -m x", ["/o"]), ("/o", "(cd /q && git status); cd /p; git commit -m x", ["/p"]),
    ("/p", "(cd /o); git commit -m x", ["/p"]), ("/p", "(cd /o; git commit -m x)", ["/o"]),
    ("/o", "cd ~/x && git commit -m x", [H + "/x"]), ("/o", "cd $HOME/x && git commit -m x", [H + "/x"]),
    ("/o", 'cd "${HOME}/x" && git commit -m x', [H + "/x"]), ("/o", 'cd "~/x" && git commit -m x', ["/o/~/x"]),
    ("/p", 'cd "$WT" && git commit -m x', [None]), ("/p", 'git -C "$WT" commit -m x', [None]),
    ("/p", 'cd "$(git worktree list | tail -1)" && git commit -m x', [None]), ("/o", 'cd "$WT"; cd /p; git commit -m x', ["/p"]),
    ("/p", "cd - && git commit -m x", [None]), ("/p", "popd; git commit -m x", [None]), ("/p", "pushd /o; git commit -m x", ["/o"]),
    ("/p", "cd; git commit -m x", [H]), ("/p", "cd -P /o; git commit -m x", ["/o"]),
    (None, "git commit -m x", [None]), (None, "git -C /p commit -m x", ["/p"]),
    ("/p", "GIT_DIR=/x/.git git commit -m x", []), ("/p", "git --git-dir=/x/.git commit -m x", []),
    ("/p", "git --work-tree /x commit -m x", []),
]
bad = [repr(r) for r in VERBS if [o[1] for o in ops("/c", r[0])] != r[1]]
bad += [repr(r) for r in DIRS if [o[0] for o in ops(r[0], r[1])] != r[2]]
print("\n".join(bad))
PY
ok "$(python3 "$T/table.py" "$HOOK" 2>&1)" "" "every row of the text table reads as declared"

# ── 3. the same reading, whole: the hook on a real checkout ───────────────────────────────────────────────────────
deny "$OTHER" "cd '$P' && git commit -m x" "cd into the Primary"
deny "$OTHER" "git -C '$P' commit -m x" "git -C the Primary"
allow "$P" "cd '$WT' && git commit -m x" "cd out of the Primary into a worktree"
allow "$P" "git -C '$OTHER' commit -m x" "git -C another repo"
mkdir -p "$HOME/repos"; ln -s "$P" "$HOME/repos/prim"
deny "$OTHER" 'cd ~/repos/prim && git commit -m x' "a tilde path, through a symlink"
allow "$P" 'cd "$WT" && git commit -m x' "a cd through a variable cannot be read: let through"
allow "$P" 'GIT_DIR=/x/.git git commit -m x' "GIT_DIR on the command moves the repo: let through"
deny "$P" $'git commit -m "$(cat <<\'EOF\'\nIt\'s a "quoted" fix (really)\nEOF\n)"' "the heredoc commit message form"
allow "$P" 'echo "git commit -m x"' "a quoted string"
allow "$P" 'git pull --ff-only' "a fast-forward"
deny "$P" 'git pull' "a pull that may merge"

# ── 4. which branch: the command's own switch ─────────────────────────────────────────────────────────────────────
allow "$P" 'git checkout -b fix && git commit -m x' "the remedy: checkout -b, then commit"
allow "$P" 'git switch -c fix && git commit -m x' "the remedy: switch -c, then commit"
allow "$P" 'git switch feature; git commit -m x' "switch to an existing branch first"
allow "$P" 'git checkout feature && git merge master' "checkout an existing branch first"
allow "$P" 'git checkout --detach && git commit -m x' "detached first"
allow "$P" 'git checkout t1 && git commit -m x' "checkout a tag (detached)"
allow "$P" 'git checkout only-on-origin && git commit -m x' "checkout a branch only origin has: git creates it"
allow "$P" 'git checkout "$B" && git commit -m x' "a branch through a variable: let through"
deny "$P" 'git checkout a && git commit -m x' "git checkout <a file> moves no branch"
deny "$P" 'git checkout -- a && git commit -m x' "git checkout -- <path> moves no branch"
deny "$P" 'git checkout feature -- a && git commit -m x' "git checkout <rev> -- <path> moves no branch"
git -C "$P" checkout -q feature
deny "$P" 'git checkout master && git commit -m x' "from a branch, checkout master, then commit"
deny "$P" 'git switch master; git merge feature' "from a branch, switch master, then merge"
allow "$P" 'git rebase origin/master' "rebase of the branch it is on"
deny "$P" 'git rebase origin/master master' "rebase naming the default branch"
deny "$P" 'git rebase --onto origin/master a1 master' "rebase --onto naming the default branch"
git -C "$P" checkout -q master
allow "$P" 'git rebase origin/master feature' "rebase naming another branch, from master"
allow "$P" 'git rebase origin/master "$B"' "rebase naming a branch through a variable: let through"
deny "$P" 'git rebase -s ort origin/master' "a value of rebase's -s is not its branch"
deny "$P" 'git rebase --root' "rebase --root"
allow "$P" 'git rebase --root feature' "rebase --root naming another branch"
git -C "$P" checkout -q --detach
allow "$P" 'git commit -m x' "a detached HEAD is no default branch"
git -C "$P" checkout -q master

# ── 5. the Primary is the plugin's: a snapshot stands for it, a cache install has none ─────────────────────────────
git -C "$P" worktree add -q --detach "$S"
install "$S"
deny "$P" 'git commit -m x' "from a hook in a snapshot of the Primary" "$S/hooks/primary-commit-guard.py"
allow "$S" 'git commit -m x' "in the snapshot itself" "$S/hooks/primary-commit-guard.py"
mkdir -p "$T/cache"; install "$T/cache"
allow "$P" 'git commit -m x' "a version-cache install has no Primary" "$T/cache/hooks/primary-commit-guard.py"
install "$OTHER"
deny "$OTHER" 'git commit -m x' "a hook run from another checkout guards that checkout" "$OTHER/hooks/primary-commit-guard.py"
allow "$P" 'git commit -m x' "… and not this one" "$OTHER/hooks/primary-commit-guard.py"

# ── 6. the default branch: origin's, read locally first ───────────────────────────────────────────────────────────
git -C "$P" remote set-head origin -d
deny "$P" 'git commit -m x' "no origin/HEAD: the remote is asked"
git -C "$P" remote set-url origin "$T/nowhere.git"
allow "$P" 'git commit -m x' "no origin/HEAD and no remote: nothing can name the default, let through"
git -C "$P" remote set-url origin "$O"
git -C "$P" remote set-head origin master
git -C "$P" checkout -q feature; git -C "$P" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/feature
deny "$P" 'git commit -m x' "the default is origin's, whatever its name"
git -C "$P" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
git -C "$P" checkout -q master
GIT_DIR="$OTHER/.git" run "$P" 'git commit -m x'
ok "$v" deny "an exported GIT_DIR does not move the checkout the hook reads"

# ── 7. robustness: it never fails the call, never speaks on stderr ─────────────────────────────────────────────────
quiet() { ok "$rc|$out|$err" "0||" "robust: $1"; }
printf 'not json' | python3 "$HOOK" > "$T/out" 2> "$T/err"; rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); quiet "stdin that is not JSON"
printf '[1]' | python3 "$HOOK" > "$T/out" 2> "$T/err"; rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); quiet "a payload that is no object"
printf '{"tool_name": "Bash"}' | python3 "$HOOK" > "$T/out" 2> "$T/err"; rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); quiet "no tool_input"
printf '{"tool_name": "Bash", "tool_input": {"command": 7}}' | python3 "$HOOK" > "$T/out" 2> "$T/err"; rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); quiet "a command that is no string"
run "$P" 'git commit -m x' "" Edit; quiet "another tool"
run "$T/gone" 'git commit -m x'; quiet "a cwd that does not exist"
run "$P" "cd '$T/gone' && git commit -m x"; quiet "a cd into a directory that does not exist yet"
run "$P" 'echo "unterminated'; quiet "an unterminated quote"
run "$P" "$(python3 -c 'print("(" * 1100)') git commit"; quiet "nesting past the interpreter's limit"
deny "$P" 'git commit -m x; echo "unterminated' "a commit before an unterminated quote is still read"
ok "$([ -e "$P/hooks/__pycache__" ] || [ -e "$P/skills/_shared/scripts/__pycache__" ] && echo y || echo n)" n "no bytecode is written into the plugin"

# ── 8. wiring and floor ───────────────────────────────────────────────────────────────────────────────────────────
ok "$(python3 -c '
import json, sys
h = json.load(open(sys.argv[1]))["hooks"]["PreToolUse"]
e = [x for x in h if "primary-commit-guard.py" in json.dumps(x)]
x = e[0]["hooks"][0] if len(e) == 1 else {}
print(e[0].get("matcher"), x.get("timeout", 99) <= 10, "onFailure" in json.dumps(e), x.get("command"))' "$root/hooks/hooks.json")" \
  'Bash True False python3 "${CLAUDE_PLUGIN_ROOT}/hooks/primary-commit-guard.py"' \
  "hooks.json: the PreToolUse entry's matcher, a timeout of 10 s or less, no onFailure"
ok "$(python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9)); print("ok")' "$root/hooks/primary-commit-guard.py" 2>&1)" ok \
  "floor: the hook parses as python 3.9"

echo
if [ "$fail" -eq 0 ]; then echo "primary-commit-guard: ALL PASS"; else echo "primary-commit-guard: FAILED"; fi
exit "$fail"
