#!/usr/bin/env bash
# The peer guard in skills/_shared/handoff-lifecycle.md § Close-out, extracted by its marker and run against
# runtime-generated fixtures (fresh, old, 23 h, 25 h, future mtime, paths with a space, a missing path, a
# failing `find` stub first on PATH, and `f` unset), under bash and under `zsh -f` when zsh is installed (the Bash tool is zsh). The snippet reads
# its one input `f` (the doc's absolute path) as a shell variable; here it comes from the environment.
# Then prose asserts: close's step 7.2 runs the guard for every consumed doc before any `git rm -f`, step 8
# carries the three kept/gone rows and the <age> expression, the lifecycle states rule (a)/(b), the K41
# no-evidence rule and the one conversation-dependent input, and ADR 0017's Status block carries the amendment.
# Hermetic: every fixture lives under mktemp. bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh

LIFECYCLE=skills/_shared/handoff-lifecycle.md
CLOSE=skills/close/SKILL.md
ADR=docs/adr/0017-a-pending-handoff-owns-the-continuation.md

# A failed mktemp must stop the run here: `cd ""` succeeds and stays put, so $tmp would be this checkout and
# the EXIT trap would rm -rf it. The trap goes in only once $tmp is proven to be a fresh directory.
tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ] || [ "$tmp" = "$(pwd -P)" ]; then echo "FAIL - mktemp gave no usable temp dir [$tmp]"; exit 1; fi
trap 'rm -rf "$tmp"' EXIT

# ---- the guard, verbatim from the lifecycle file -----------------------------------------------------
# The awk exits non-zero unless an opener is followed by its closer.
awk '/^# thread:peer-guard/{on=1; next} /^# end thread:peer-guard/{if(on) closed=1; on=0} on; END{exit !closed}' \
  "$LIFECYCLE" > "$tmp/guard.sh"; paired=$?
ok "$paired" 0 "the peer-guard marker pair is closed and in order"
open=$(grep -c '^# thread:peer-guard' "$LIFECYCLE"); close=$(grep -c '^# end thread:peer-guard' "$LIFECYCLE")
ok "$open" 1 "exactly one opening peer-guard marker"
ok "$close" 1 "exactly one closing peer-guard marker"
ok "$(grep -cF 'find "$f" -mmin -1440' "$tmp/guard.sh")" 1 "the guard's age test is find -mmin -1440"
ok "$(grep -cF '[ ! -e "$f" ]' "$tmp/guard.sh")" 1 "the guard checks existence first"
ok "$(grep -cEw 'stat' "$tmp/guard.sh")" 0 "the guard uses no stat (BSD and GNU disagree)"
if [ "$paired" != 0 ] || [ "$open" != 1 ] || [ "$close" != 1 ] || ! grep -qF 'find "$f" -mmin -1440' "$tmp/guard.sh"; then
  echo "FAIL - the # thread:peer-guard … # end thread:peer-guard pair is not exactly once, in order, in $LIFECYCLE; nothing to run"
  echo "peer-guard: SOME FAILED"
  exit 1
fi

# ---- fixtures ------------------------------------------------------------------------------------------
mkdir -p "$tmp/d"
touch "$tmp/d/fresh.md" "$tmp/d/a b.md"
touch -t 202601010000 "$tmp/d/old.md" "$tmp/d/old b.md"
touch "$tmp/d/h23.md" "$tmp/d/h25.md" "$tmp/d/future.md"
python3 - "$tmp/d" <<'PY'
import os, sys, time
d, now = sys.argv[1], time.time()
for name, delta in (("h23.md", -23 * 3600), ("h25.md", -25 * 3600), ("future.md", 3600)):
    os.utime(os.path.join(d, name), (now + delta, now + delta))
PY
# A `find` that fails (exit 1, no output), first on PATH: the guard must keep the doc, never print `delete`.
mkdir -p "$tmp/badbin"
printf '#!/bin/sh\nexit 1\n' > "$tmp/badbin/find"
chmod +x "$tmp/badbin/find"

# $1 is the shell, left unquoted so "zsh -f" splits into command and flag.
guard() { out=$(env f="$2" $1 "$tmp/guard.sh" 2>/dev/null); rc=$?; }
# guard_badfind <shell> <path>: the same, with the failing find stub ahead of the real one on PATH.
guard_badfind() { out=$(env f="$2" PATH="$tmp/badbin:$PATH" $1 "$tmp/guard.sh" 2>/dev/null); rc=$?; }

shells=("bash")
command -v zsh >/dev/null 2>&1 && shells+=("zsh -f")
for sh in "${shells[@]}"; do
  for pair in "fresh.md|keep fresh" "old.md|delete" "h23.md|keep fresh" "h25.md|delete" \
              "future.md|keep fresh" "a b.md|keep fresh" "old b.md|delete" "missing.md|keep missing"; do
    name=${pair%%|*}; want=${pair#*|}
    guard "$sh" "$tmp/d/$name"
    ok "$out" "$want" "[$sh] $name → $want"
    ok "$rc" 0 "[$sh] $name exits 0"
  done
  for name in fresh.md old.md; do
    guard_badfind "$sh" "$tmp/d/$name"
    ok "$out" "keep fresh" "[$sh] $name with a failing find → keep fresh (fails closed)"
    ok "$rc" 0 "[$sh] $name with a failing find exits 0"
  done
  out=$(env -u f $sh "$tmp/guard.sh" 2>/dev/null); rc=$?
  if [ "$rc" != 0 ]; then ok y y "[$sh] f unset → non-zero exit"; else ok "$rc" "non-zero" "[$sh] f unset → non-zero exit"; fi
  ok "$out" "" "[$sh] f unset → empty stdout"
done

# ---- the <age> expression in close's step 8 ------------------------------------------------------------
closetext=$(cat "$CLOSE")
has "$closetext" 'date -r "$f" +%s' "close's <age> reads the doc's mtime with date -r"
has "$closetext" '/ 3600 ))h' "close's <age> is whole hours"
has "$closetext" '$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h' "close carries the exact <age> expression"
has "$closetext" "run as \`f='<abs path>'; echo" "close runs <age> with f set in the same Bash call"
age=$(f="$tmp/d/h25.md"; echo "$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h")
ok "$age" "25h" "the <age> expression gives 25h for a doc marked 25 h ago"

# ---- close's step 7.2 ----------------------------------------------------------------------------------
# idx <haystack> <needle>: offset of the first occurrence, or -1.
idx() { local pre="${1%%"$2"*}"; if [ "$pre" = "$1" ]; then echo -1; else echo "${#pre}"; fi; }
step72=$(grep -E '^   2\. Handoff lifecycle' "$CLOSE")
ok "$(printf '%s\n' "$step72" | grep -c .)" 1 "close has exactly one step-7.2 line"
has "$step72" 'peer guard' "step 7.2 runs the peer guard"
has "$step72" '§ Close-out' "step 7.2 cites § Close-out"
every='For every consumed doc, including one this session marked'
has "$step72" "$every" "step 7.2 runs the guard for every consumed doc, this session's included"
rmf=$(idx "$step72" 'rm -f')
[ "$rmf" -ge 0 ] && ok y y "step 7.2 still carries git rm -f" || ok n y "step 7.2 still carries git rm -f"
e=$(idx "$step72" "$every"); k=$(idx "$step72" 'keep missing')
[ "$e" -ge 0 ] && [ "$e" -lt "$rmf" ] && ok y y "the every-doc guard precedes rm -f" || ok n y "the every-doc guard precedes rm -f"
[ "$k" -ge 0 ] && [ "$k" -lt "$rmf" ] && ok y y "keep missing is handled before rm -f" || ok n y "keep missing is handled before rm -f"
has "$step72" 'other than this one or a subagent it spawned' "step 7.2 excludes this session and its subagents from the listing"
has "$step72" 'guard kept is **not** carried' "step 7.2: the workspaces auto-commit never carries a kept doc"
has "$step72" 'Run from:' "step 7.2's listing match takes the doc's Run from directory"
has "$step72" 'matches on `<home>` alone' "step 7.2: a doc without Run from matches on <home> alone"
has "$step72" 'skips the `ListAgents` call' "step 7.2 skips ListAgents on Claude"
has "$step72" 'no cwd as of 2026-09-25' "step 7.2 states ListAgents rows carry no cwd"
has "$step72" 'this session marked it (`keep fresh` or `delete`)' "step 7.2 names the two outputs rule (a) deletes on"
case "$step72" in *'(any output)'*) ok n y "step 7.2 no longer says (any output)";; *) ok y y "step 7.2 no longer says (any output)";; esac
has "$step72" 'a doc that is both reports `left for live peer <session>`' "step 7.2: live peer wins over keep fresh in the report"

# ---- close elsewhere -----------------------------------------------------------------------------------
has "$closetext" 'left for its consumer (marked <age> ago)' "step 8 has the left-for-its-consumer row"
has "$closetext" 'left for live peer <session>' "step 8 has the live-peer row"
has "$closetext" 'already gone (removed by another close)' "step 8 has the already-gone row"
dead=$(grep -E '^- \*\*A consumed handoff doc left by a session that died' "$CLOSE")
ok "$(printf '%s' "$dead" | grep -c .)" 1 "the dead-session edge case exists"
case "$dead" in *'deleted all the same'*) ok n y "the dead-session edge no longer deletes unconditionally";; *) ok y y "the dead-session edge no longer deletes unconditionally";; esac
has "$dead" 'peer guard' "the dead-session edge defers to the peer guard"

# ---- the lifecycle file --------------------------------------------------------------------------------
life=$(cat "$LIFECYCLE")
for phrase in 'no evidence' 'K41' 'ListAgents' 'list_agents' 'whoever marked it, once the peer guard allows' \
              'other than this one or a subagent it spawned' 'three outputs' 'dormant' \
              'one conversation-dependent input' 'not its own'; do
  has "$life" "$phrase" "lifecycle says: $phrase"
done
for gone in 'nothing about that decision lives in the closing conversation' 'The consuming session'"'"'s `thread:close` deletes'; do
  case "$life" in *"$gone"*) ok n y "lifecycle no longer says: $gone";; *) ok y y "lifecycle no longer says: $gone";; esac
done
has "$(grep -F '**One doc, one consumer**' "$LIFECYCLE")" 'peer guard' "the One-doc-one-consumer line names the peer guard"
ruleb=$(grep -F -- '- **Rule (b).**' "$LIFECYCLE")
ok "$(printf '%s\n' "$ruleb" | grep -c .)" 1 "the lifecycle has exactly one Rule (b) line"
has "$ruleb" 'Run from' "rule (b) matches a cwd in the doc's Run from directory"
has "$ruleb" 'matches on `<home>` alone' "rule (b): a doc without Run from matches on <home> alone"
nocwd=$(grep -F -- '- **Listing rows with no cwd.**' "$LIFECYCLE")
has "$nocwd" 'no cwd as of 2026-09-25' "the no-cwd rule states Claude's ListAgents rows carry no cwd"
has "$nocwd" 'skips the `ListAgents` call' "the no-cwd rule: close skips ListAgents on Claude"
case "$nocwd" in *'wherever the harness does not expose cwd'*) ok n y "the no-cwd rule is no longer conditional";; *) ok y y "the no-cwd rule is no longer conditional";; esac
has "$life" 'A failed `find` keeps the doc' "lifecycle says a failed find keeps the doc"
has "$life" 'bfs' "lifecycle notes the tool shell's find is the embedded bfs"
case "$life" in *"task's two-output spec"*) ok n y "lifecycle carries no rollout-process wording";; *) ok y y "lifecycle carries no rollout-process wording";; esac

# ---- ADR 0017's Status block ---------------------------------------------------------------------------
status=$(awk '/^Status:/,/^## Context/' "$ADR")
for phrase in 'thread-skill-p2-4' 'K41' '`<home>`' '`ListAgents`' 'judged from the conversation' 'not its own' \
              '`Run from:`' 'no cwd' 'skips the call'; do
  has "$status" "$phrase" "ADR 0017 Status amendment says: $phrase"
done

[ "$fail" = 0 ] && echo "peer-guard: ALL PASS" || echo "peer-guard: SOME FAILED"
exit "$fail"
