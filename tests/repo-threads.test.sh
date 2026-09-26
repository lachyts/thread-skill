#!/usr/bin/env bash
# Repo threads (thread-skill-p2-7). Section A extracts open's § Repo-thread lookup snippet (a wrapper round
# skills/open/scripts/repo-thread-lookup.sh since p5-2) by its marker and runs it against runtime-generated
# fixtures under bash and under `zsh -f` when zsh is installed (the Bash tool is zsh): first-hit tier order (_shared, then ~/Projects, then repo threads), the basename slug of a
# THREAD.md with no front matter, the CWD tiebreak, and every exclusion (obsidian, workspaces, depth > 3,
# `*/.claude/*`), the ~/Projects walk's prunes (`_archive`, `.claude`, `node_modules`, depth > 5), and a CWD
# repo outside the hits leaving every hit in place. Two mutation checks prove the worktree exclusion is
# load-bearing twice over: the `.claude` rule alone excludes a depth-3 fixture, and dropping the depth limit
# still leaves the worktree copy out; a third proves an `_archive` copy would otherwise hide a repo thread. Section B greps the prose that wires the lookup into open, close, handoff-lifecycle.md,
# CONTEXT.md and ADR 0017.
# Hermetic: every path lives under mktemp, HOME is a temp dir per case, GIT_CEILING_DIRECTORIES stops git
# walking above the temp root, git's repo-local vars are unset, and system and global git config are
# pinned. bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
root=$(pwd -P)

# A failed mktemp must stop the run here: `cd ""` succeeds and stays put, so $tmp would be this checkout and
# the EXIT trap would rm -rf it. The trap goes in only once $tmp is proven to be a fresh directory.
tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ] || [ "$tmp" = "$root" ]; then echo "FAIL - mktemp gave no usable temp dir [$tmp]"; exit 1; fi
trap 'rm -rf "$tmp"' EXIT

OPEN=skills/open/SKILL.md
CLOSE=skills/close/SKILL.md
LIFE=skills/_shared/handoff-lifecycle.md
ADR=docs/adr/0017-a-pending-handoff-owns-the-continuation.md

# sec <file> <start ERE> <stop ERE> — the lines from the first match of start up to (excluding) the next
# match of stop.
sec() { awk -v a="$2" -v b="$3" 'on && $0 ~ b {exit} $0 ~ a {on=1} on' "$1" 2>/dev/null; }
# first <text> <prefix> — the first line of text that starts with prefix (a literal).
first() { printf '%s\n' "$1" | awk -v p="$2" '!d && index($0, p) == 1 {print; d=1}'; }
# occ <file> <literal> — the number of occurrences (not lines) of literal in file.
occ() { grep -oF -- "$2" "$1" 2>/dev/null | wc -l | tr -d ' '; }

# ==== Section A: the lookup snippet ====================================================================
awk '/^# thread:repo-thread-lookup/{on=1; next} /^# end thread:repo-thread-lookup/{if(on) closed=1; on=0} on; END{exit !closed}' \
  "$OPEN" > "$tmp/lk.sh" 2>/dev/null; paired=$?
ok "$paired" 0 "the lookup marker pair is closed and in order"
nopen=$(grep -c '^# thread:repo-thread-lookup' "$OPEN"); nclose=$(grep -c '^# end thread:repo-thread-lookup' "$OPEN")
ok "$nopen" 1 "exactly one opening lookup marker"
ok "$nclose" 1 "exactly one closing lookup marker"
# The snippet is a wrapper; the logic is the script it calls (a SKILL.md body holds no positional $N, p5-2).
LKS=skills/open/scripts/repo-thread-lookup.sh
ok "$(occ "$tmp/lk.sh" 'skills/open/scripts/repo-thread-lookup.sh')" 1 "the snippet calls repo-thread-lookup.sh, once"
ok "$(occ "$LKS" '-maxdepth 3')" 1 "the script limits find to depth 3, once"
ok "$(occ "$LKS" "-not -path '*/.claude/*'")" 1 "the script excludes */.claude/*, once"
ok "$(occ "$LKS" '-name _archive -o ')" 1 "the ~/Projects walk prunes _archive, once"
ok "$(occ "$LKS" '-maxdepth 5')" 1 "the ~/Projects walk is bounded at depth 5, once"
runA=1
if [ "$paired" != 0 ] || [ "$nopen" != 1 ] || [ "$nclose" != 1 ] || ! grep -q 'repo-thread-lookup\.sh' "$tmp/lk.sh" || ! grep -q -- '-maxdepth 3' "$LKS"; then
  echo "FAIL - the # thread:repo-thread-lookup … # end pair is not exactly once, in order, in $OPEN; Section A skipped"
  fail=1; runA=0
fi

G() { GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c init.defaultBranch=main "$@"; }
fx() { mkdir -p "$(dirname "$1")"; printf '%b' "$2" > "$1"; }   # fx <path> <printf %b content>

if [ "$runA" = 1 ]; then
  h1="$tmp/h1"; R="$h1/repos"
  fx "$R/tools/foo/THREAD.md"                        '---\nslug: foo\nstate: active\n---\n# Foo\n'
  fx "$R/tools/foo/.claude/worktrees/w/THREAD.md"    '---\nslug: foo\n---\n# Foo worktree copy\n'
  fx "$R/x/.claude/THREAD.md"                        '---\nslug: foo\n---\n# depth 3, only the .claude rule excludes it\n'
  fx "$R/obsidian/N/THREAD.md"                       '---\nslug: foo\n---\n'
  fx "$R/workspaces/seat/THREAD.md"                  '---\nslug: foo\n---\n'
  fx "$R/a/b/c/THREAD.md"                            '---\nslug: foo\n---\n# depth 4\n'
  fx "$R/tools/foo-rollout/THREAD.md"                '---\nslug: foo\n---\n# rollout clone\n'
  mkdir -p "$R/tools/foo-rollout/sub"
  fx "$R/tools/bar/THREAD.md"                        '# Bar\nslug: foo\n'
  fx "$R/tools/baz/THREAD.md"                        '---\r\nslug: "baz"\r\n---\r\n# Baz\r\n'
  fx "$R/tools/renamed/THREAD.md"                    '---\nslug: other\n---\n'
  fx "$R/tools/qux (codex)/THREAD.md"                '---\nslug: qux\n---\n'
  for d in tools/foo tools/foo/.claude/worktrees/w tools/foo-rollout tools/bar; do G init -q "$R/$d"; done
  mkdir -p "$tmp/plain"
  h2="$tmp/h2"; cp -R "$h1" "$h2"
  fx "$h2/repos/workspaces/_shared/threads/foo.md"   '---\nslug: foo\n---\n'
  fx "$h2/Projects/A/P/THREAD.md"                    '---\nslug: qux\n---\n'
  h3="$tmp/h3"; mkdir -p "$h3"
  hl="$tmp/hl"; ln -s "$h1" "$hl"
  h4="$tmp/h4"; cp -R "$h1" "$h4"
  fx "$h4/Projects/A/_archive/Old/THREAD.md"          '---\nslug: foo\n---\n# archived project\n'
  fx "$h4/Projects/A/P/.claude/worktrees/w/THREAD.md" '---\nslug: foo\n---\n# project worktree copy\n'
  fx "$h4/Projects/A/P/node_modules/x/THREAD.md"      '---\nslug: foo\n---\n'
  fx "$h4/Projects/A/P/a/b/c/THREAD.md"               '---\nslug: foo\n---\n# depth 6\n'
  fx "$h4/Projects/A/P/S/T/THREAD.md"                 '---\nslug: deep\n---\n# nested project, depth 5\n'

  # lk <snippet> <shell> <cwd> <home> <slug> — sets $out, $err, $rc. <shell> is word-split on purpose.
  # <snippet> is the extracted wrapper (CLAUDE_PLUGIN_ROOT → this checkout, or $plugin when set) or a
  # mutated copy of the script, which reads slug from the environment just the same.
  lk() {
    out=$(cd "$3" && unset XDG_CONFIG_HOME && HOME="$4" GIT_CEILING_DIRECTORIES="$tmp" \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null CLAUDE_PLUGIN_ROOT="${plugin-$root}" slug="$5" $2 "$1" 2>"$tmp/err"); rc=$?
    err=$(cat "$tmp/err" 2>/dev/null)
  }
  # rel <home> — $out with the physical <home>/ prefix removed, one path per line.
  rel() { printf '%s\n' "$out" | awk -v p="$1/" 'NF{ if (index($0, p) == 1) print substr($0, length(p) + 1); else print "OUTSIDE:" $0 }'; }
  # inl <path> — y when <path> is a whole line of $out. A case match, not `grep -q`: under pipefail an
  # early-exiting grep can SIGPIPE the printf and turn a hit into a miss.
  nl='
'
  inl() { case "$nl$out$nl" in *"$nl$1$nl"*) echo y ;; *) echo n ;; esac; }

  shells=("bash"); command -v zsh >/dev/null 2>&1 && shells+=("zsh -f")
  for sh in "${shells[@]}"; do
    L="[$sh]"
    # 1 (acc)
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" foo
    ok "$(rel "$h1")" "repos/tools/foo-rollout/THREAD.md
repos/tools/foo/THREAD.md" "$L slug=foo lists foo-rollout and foo only, C-sorted (no worktree, .claude, obsidian, workspaces or depth-4 copy)"
    ok "$err" "" "$L slug=foo from a non-repo CWD: empty stderr (the tiebreak's rev-parse is silent)"
    ok "$rc" 0 "$L slug=foo exits 0"
    # 2 (acc)
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" bar
    ok "$(rel "$h1")" "repos/tools/bar/THREAD.md" "$L a THREAD.md without front matter matches its directory name"
    # 3 (acc)
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h2" foo
    ok "$(rel "$h2")" "repos/workspaces/_shared/threads/foo.md" "$L _shared/threads/<slug>.md beats every repo thread"
    # 4
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h2" qux
    ok "$(rel "$h2")" "Projects/A/P/THREAD.md" "$L a ~/Projects front-matter slug beats a repo thread"
    # 5
    lk "$tmp/lk.sh" "$sh" "$R/tools/foo-rollout/sub" "$h1" foo
    ok "$(rel "$h1")" "repos/tools/foo-rollout/THREAD.md" "$L the CWD's repo wins among repo-thread hits"
    ok "$err" "" "$L the CWD tiebreak writes nothing to stderr"
    # 5b: a CWD repo that is not among the hits leaves every hit in place
    lk "$tmp/lk.sh" "$sh" "$R/tools/bar" "$h1" foo
    ok "$(rel "$h1")" "repos/tools/foo-rollout/THREAD.md
repos/tools/foo/THREAD.md" "$L CWD in tools/bar, slug=foo: the tiebreak keeps both foo hits"
    ok "$err" "" "$L CWD in a non-matching repo: empty stderr"
    # 5c: an _archive, .claude, node_modules or depth-6 copy under ~/Projects never beats a repo thread
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h4" foo
    ok "$(rel "$h4")" "repos/tools/foo-rollout/THREAD.md
repos/tools/foo/THREAD.md" "$L pruned ~/Projects copies do not hide the repo threads"
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h4" deep
    ok "$(rel "$h4")" "Projects/A/P/S/T/THREAD.md" "$L a nested project THREAD.md at depth 5 is still found"
    # 6
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" baz
    ok "$(rel "$h1")" "repos/tools/baz/THREAD.md" "$L a CRLF, quoted slug: matches"
    # 7
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" renamed
    ok "$out" "" "$L a front-matter slug beats the directory name (slug=renamed finds nothing)"
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" other
    ok "$(rel "$h1")" "repos/tools/renamed/THREAD.md" "$L slug=other finds tools/renamed"
    # 8
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" nope
    ok "$out|$rc" "|0" "$L an unknown slug prints nothing, rc 0"
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h3" ""
    ok "$out|$rc|$err" "|0|" "$L no ~/repos or ~/Projects, empty slug: nothing, rc 0, empty stderr"
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h3" foo
    ok "$out|$rc|$err" "|0|" "$L no ~/repos or ~/Projects, slug=foo: nothing, rc 0, empty stderr"
    # 9
    lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" ""
    ok "$(rel "$h1")" "repos/tools/bar/THREAD.md
repos/tools/baz/THREAD.md
repos/tools/foo-rollout/THREAD.md
repos/tools/foo/THREAD.md
repos/tools/qux (codex)/THREAD.md
repos/tools/renamed/THREAD.md" "$L an empty slug lists exactly the six repo threads (no .claude or worktree copy, spaced path whole)"
    ok "$err|$rc" "|0" "$L an empty slug: empty stderr, rc 0"
    # 10: rung-3 membership, under a symlinked HOME
    lk "$tmp/lk.sh" "$sh" "$hl/repos/tools/foo" "$hl" ""
    t=$(cd "$hl/repos/tools/foo" && GIT_CEILING_DIRECTORIES="$tmp" G rev-parse --show-toplevel)
    ok "$(inl "$t/THREAD.md")" y "$L rung 3: the CWD repo's toplevel THREAD.md is listed under a symlinked HOME"
    lk "$tmp/lk.sh" "$sh" "$R/tools/foo/.claude/worktrees/w" "$h1" ""
    t=$(cd "$R/tools/foo/.claude/worktrees/w" && GIT_CEILING_DIRECTORIES="$tmp" G rev-parse --show-toplevel)
    ok "$t" "$R/tools/foo/.claude/worktrees/w" "$L the worktree fixture is its own git toplevel"
    ok "$(inl "$t/THREAD.md")" n "$L rung 3: a .claude/worktrees toplevel is never listed"
    # the script unreachable: a loud exit 2, never read as "no hit"
    plugin="$tmp/nowhere"; lk "$tmp/lk.sh" "$sh" "$tmp/plain" "$h1" foo; unset plugin
    ok "$rc|$out" "2|" "$L script missing: rc 2, nothing on stdout"
    ok "${err%%:*}" "repo-thread-lookup" "$L script missing: stderr starts repo-thread-lookup:"
  done

  # 11: mutation M1 — without the .claude rule, x/.claude/THREAD.md (depth 3) appears.
  sed "s#-not -path '\*/\.claude/\*' ##" "$LKS" > "$tmp/m1.sh"
  ok "$(cmp -s "$LKS" "$tmp/m1.sh" && echo same || echo changed)" changed "M1: the mutation changed the script"
  ok "$(occ "$tmp/m1.sh" "-not -path '*/.claude/*'")" 0 "M1: exactly the .claude token was removed"
  ok "$(diff "$LKS" "$tmp/m1.sh" | grep -c '^[<>]')" 2 "M1: exactly one line differs"
  lk "$tmp/m1.sh" bash "$tmp/plain" "$h1" ""
  ok "$(inl "$R/x/.claude/THREAD.md")" y "M1: without the .claude rule the depth-3 x/.claude/THREAD.md is listed"
  # 12: mutation M2 — without the depth limit, depth 4 appears but the worktree copy stays out.
  sed 's#-maxdepth 3 ##' "$LKS" > "$tmp/m2.sh"
  ok "$(cmp -s "$LKS" "$tmp/m2.sh" && echo same || echo changed)" changed "M2: the mutation changed the script"
  ok "$(occ "$tmp/m2.sh" '-maxdepth 3')" 0 "M2: exactly the repo-tier depth token was removed"
  ok "$(diff "$LKS" "$tmp/m2.sh" | grep -c '^[<>]')" 2 "M2: exactly one line differs"
  lk "$tmp/m2.sh" bash "$tmp/plain" "$h1" ""
  ok "$(inl "$R/a/b/c/THREAD.md")" y "M2: without the depth limit the depth-4 fixture is listed (the fixture is sensitive)"
  ok "$(inl "$R/tools/foo/.claude/worktrees/w/THREAD.md")" n "M2: the worktree copy stays excluded by the .claude rule alone"
  ok "$(inl "$R/x/.claude/THREAD.md")" n "M2: x/.claude/THREAD.md stays excluded"

  # 13: mutation M3 — without the _archive prune, the archived project copy wins the ~/Projects tier.
  sed 's#-name _archive -o ##' "$LKS" > "$tmp/m3.sh"
  ok "$(occ "$tmp/m3.sh" '_archive')" 0 "M3: exactly the _archive token was removed"
  ok "$(diff "$LKS" "$tmp/m3.sh" | grep -c '^[<>]')" 2 "M3: exactly one line differs"
  lk "$tmp/m3.sh" bash "$tmp/plain" "$h4" foo
  ok "$(rel "$h4")" "Projects/A/_archive/Old/THREAD.md" "M3: without the prune the _archive copy hides the repo threads (the fixture is sensitive)"
fi

# ==== Section B: the prose =============================================================================
QOPEN='`${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Repo-thread lookup'

# open
ok "$(occ "$OPEN" 'diff-and-confirm')" 0 "open: diff-and-confirm is gone"
for s in 'Thread saved — session continues.' '## Repo threads' 'Thread identification comes first' 'missing `state:` is listed'; do
  has "$(cat "$OPEN")" "$s" "open carries: $s"
done
ok "$(grep -c '^## Repo-thread lookup$' "$OPEN")" 1 "open has a ## Repo-thread lookup heading"
has "$(sec "$OPEN" '^# /thread:open' '^## Modes')" 'effective slug' "open's intro defines the effective slug"
has "$(sec "$OPEN" '^### `/thread:open <slug>`' '^##')" '§ Repo-thread lookup' "open <slug> runs § Repo-thread lookup"
hp3=$(first "$(sec "$OPEN" '^### `/thread:open <path-to-handoff-doc>`' '^##')" '3. ')
has "$hp3" '§ Repo-thread lookup with `slug=<thread:>`' "the handoff-doc pickup's step 3 runs the lookup on thread:"
has "$(grep -F -- '- **Callers.**' "$OPEN")" "handoff-doc pickup's step 3" "the lookup's Callers names the handoff-doc pickup"
has "$(sec "$OPEN" '^### `/thread:open save`' '^##')" 'save never sets `state: done`' "open save never sets state: done"

# close
ident=$(sec "$CLOSE" '^## Identify the active thread' '^## ')
r2=$(first "$ident" '2. '); r3=$(first "$ident" '3. ')
has "$r3" "$QOPEN" "close rung 3 cites open § Repo-thread lookup by plugin path"
has "$r3" '.claude/worktrees' "close rung 3 names the .claude/worktrees exclusion"
has "$r3" 'deeper than 3' "close rung 3 credits the depth exclusion"
has "$r2" "$QOPEN" "close rung 2 cites open § Repo-thread lookup by plugin path"
has "$r2" 'never rung 3' "close rung 2 never falls to rung 3"
slugin=$(first "$(cat "$CLOSE")" '- `slug` ')
has "$slugin" 'effective slug' "close's handoff-scan slug input is the effective slug"
s71=$(grep -F 'Thread update — write THREAD.md' "$CLOSE" | head -n 1)
for s in 'rev-parse --show-toplevel' '--path-format=absolute --git-path' 'stricter form of sub-step 2' 'diff --cached --quiet --' 'check-ignore -q --' '(add failed:' 'whichever rung resolved it'; do
  has "$s71" "$s" "close step 7.1 carries: $s"
done
has "$(grep -F -- '- **Auto-execute, no asking**' "$CLOSE")" 'step 7.1' "close's Auto-execute line names the step-7.1 commit"
b=$(occ "$CLOSE" '§ Repo-thread lookup'); q=$(occ "$CLOSE" "$QOPEN")
ok "$([ "$q" -ge 4 ] && echo y || echo "n ($q)")" y "close cites open § Repo-thread lookup by plugin path at least 4 times"
ok "$b" "$q" "every close citation of § Repo-thread lookup is plugin-path qualified"

# handoff-lifecycle.md
ts=$(sec "$LIFE" '^## Thread state' '^## ')
for s in 'repo thread without front matter' 'keeps none' 'effective slug' 'Project threads and repo threads have no INDEX line'; do
  has "$ts" "$s" "handoff-lifecycle § Thread state carries: $s"
done
has "$(first "$(sec "$LIFE" '^## Front matter' '^## ')" 'thread:')" 'effective slug' "handoff-lifecycle § Front matter's thread: is the effective slug"
has "$(cat "$LIFE")" "close's tool-repo commit (step 7.1)" "handoff-lifecycle names close's tool-repo commit"
has "$ts" '`/thread:open save` that resolves that thread, from any CWD' "handoff-lifecycle: a repo thread is committed by the close that resolves it"
ok "$(occ "$LIFE" 'or `/thread:open save` in that repo')" 0 "handoff-lifecycle: the per-repo wording is gone"

# CONTEXT.md and ADR 0017
has "$(cat CONTEXT.md)" '**Repo thread**' "CONTEXT.md defines **Repo thread**"
a=$(grep -n 'thread-skill-p2-7' "$ADR" | head -n 1 | cut -d: -f1); c=$(grep -n '^## Context' "$ADR" | head -n 1 | cut -d: -f1)
ok "$([ -n "$a" ] && [ -n "$c" ] && [ "$a" -lt "$c" ] && echo y || echo n)" y "ADR 0017 carries the p2-7 amendment before ## Context"

[ "$fail" = 0 ] && echo "repo-threads: ALL PASS" || echo "repo-threads: SOME FAILED"
exit "$fail"
