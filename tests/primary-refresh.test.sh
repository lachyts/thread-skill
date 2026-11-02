#!/usr/bin/env bash
# ADR 0066, executed: skills/_shared/scripts/primary-refresh.py, the Primary refresh. A bare "origin" and clones of
# it stand for the primary and an --also checkout; the primary's own primary-hold.sh and ntfy-push.py are stubs
# committed into origin (the hold prints $HOLD_FILE's text, the push appends its message to $NTFY_LOG), so every
# arm is offline. R1-R9 are the plan's cases; S1 the self-update, I1 install's job. Hermetic: HOME, XDG_STATE_HOME
# and every path live under mktemp; commits carry an inline identity; global/system git config is ignored.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
pr="$root/skills/_shared/scripts/primary-refresh.py"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tmp=$(cd "$tmp" && pwd -P)
export HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" HOLD_FILE="$tmp/hold" NTFY_LOG="$tmp/ntfy.log"
mkdir -p "$HOME"
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }

# ---- fixtures -------------------------------------------------------------------------------------------
g init -q --bare "$tmp/origin.git"
g clone -q "$tmp/origin.git" "$tmp/seed" 2>/dev/null
mkdir -p "$tmp/seed/skills/_shared/scripts" "$tmp/seed/skills/execute/scripts"
cat > "$tmp/seed/skills/_shared/scripts/primary-hold.sh" <<'EOF'
[ -f "$HOLD_FILE" ] && cat "$HOLD_FILE"
exit 0
EOF
cat > "$tmp/seed/skills/execute/scripts/ntfy-push.py" <<'EOF'
import os, sys
open(os.environ["NTFY_LOG"], "a").write(sys.stdin.read())
EOF
cp "$pr" "$tmp/seed/skills/_shared/scripts/primary-refresh.py"
echo one > "$tmp/seed/a.txt"
g -C "$tmp/seed" add -A && g -C "$tmp/seed" commit -qm one && g -C "$tmp/seed" push -q origin master 2>/dev/null
g clone -q "$tmp/origin.git" "$tmp/primary" 2>/dev/null
g clone -q "$tmp/origin.git" "$tmp/agents" 2>/dev/null
# land <file> <text>: a commit on origin through the seed
land() { echo "$2" > "$tmp/seed/$1"; g -C "$tmp/seed" add -A; g -C "$tmp/seed" commit -qm "$2"; g -C "$tmp/seed" push -q origin master 2>/dev/null; }
run() { python3 "$pr" run --primary "$tmp/primary" "$@" 2>&1; }
head_of() { git -C "$1" rev-parse HEAD; }
tip() { git -C "$tmp/seed" rev-parse HEAD; }

# ---- R3: up to date ---------------------------------------------------------------------------------------
has "$(run)" "primary: current" "R3: a primary at origin's tip reads current"

# ---- R1: the hold stands ----------------------------------------------------------------------------------
land a.txt two
echo "[[x-rollout]] running on it" > "$HOLD_FILE"
before=$(head_of "$tmp/primary")
out=$(run)
has "$out" "held: [[x-rollout]] running on it" "R1: the primary's own primary-hold.sh output holds it"
ok "$(head_of "$tmp/primary")" "$before" "R1: … and nothing moved"

# R1 fails closed: a hold check that errors, or none in the primary, holds too
printf 'exit 3\n' > "$tmp/primary/skills/_shared/scripts/primary-hold.sh"
has "$(run)" "held: the hold check exited 3" "R1: a hold check that exits non-zero holds"
mv "$tmp/primary/skills/_shared/scripts/primary-hold.sh" "$tmp/hold.bak"
has "$(run)" "held: no skills/_shared/scripts/primary-hold.sh in the primary" "R1: a primary with no hold script holds"
mv "$tmp/hold.bak" "$tmp/primary/skills/_shared/scripts/primary-hold.sh"
g -C "$tmp/primary" checkout -q -- skills/_shared/scripts/primary-hold.sh
ok "$(head_of "$tmp/primary")" "$before" "R1: … and nothing moved"

# ---- R9: an --also checkout moves while the primary is held ----------------------------------------------
out=$(run --also "$tmp/agents")
has "$out" "agents: moved" "R9: an --also checkout behind origin is fast-forwarded while the primary's hold stands"
ok "$(head_of "$tmp/agents")" "$(tip)" "R9: … to origin's tip"

# ---- R2: clear and behind ---------------------------------------------------------------------------------
rm -f "$HOLD_FILE"
out=$(run --dry-run)
has "$out" "would move" "R2: --dry-run says it would move"
ok "$(head_of "$tmp/primary")" "$before" "R2: … and moves nothing"
out=$(run)
has "$out" "primary: moved" "R2: a clear, behind primary is fast-forwarded"
ok "$(head_of "$tmp/primary")" "$(tip)" "R2: … to origin's tip"

# ---- R5: busy -----------------------------------------------------------------------------------------------
land a.txt three
touch "$tmp/primary/.git/index.lock"
has "$(run)" "busy: index.lock present" "R5: an index.lock skips the pass"
rm -f "$tmp/primary/.git/index.lock"
touch "$tmp/primary/.git/MERGE_HEAD"
has "$(run)" "busy: a merge in progress" "R5: a merge in progress skips the pass"
rm -f "$tmp/primary/.git/MERGE_HEAD"
g -C "$tmp/primary" checkout -q -b side
has "$(run)" "busy: on side, not master" "R5: a primary off its default branch is left alone"
g -C "$tmp/primary" checkout -q master

# ---- R6: an uncommitted edit origin would overwrite --------------------------------------------------------
echo mine > "$tmp/primary/a.txt"
before=$(head_of "$tmp/primary")
out=$(run)
has "$out" "primary: refused:" "R6: a dirty file origin changes refuses the fast-forward"
ok "$(head_of "$tmp/primary")" "$before" "R6: … and HEAD stays"
ok "$(cat "$tmp/primary/a.txt")" "mine" "R6: … and the edit is untouched"
g -C "$tmp/primary" checkout -q -- a.txt
echo note > "$tmp/primary/untouched.txt"
has "$(run)" "primary: moved" "R6: an uncommitted file origin never touches does not stop a move"
rm -f "$tmp/primary/untouched.txt"

# ---- R4: ahead, then diverged; one notify after 24 h -------------------------------------------------------
echo local > "$tmp/primary/b.txt"; g -C "$tmp/primary" add b.txt; g -C "$tmp/primary" commit -qm local
has "$(run)" "primary: ahead 1: left to its landing route" "R4: a primary ahead of origin is left to its landing route"
land a.txt four
out=$(run --now 2026-11-01T10:00:00+11:00)
has "$out" "diverged (ahead 1, behind 1)" "R4: a diverged primary is never integrated"
ok "$(git -C "$tmp/primary" log -1 --format=%s)" "local" "R4: … its HEAD stays its own"
run --now 2026-11-01T20:00:00+11:00 >/dev/null
ok "$(cat "$NTFY_LOG" 2>/dev/null)" "" "R4: no notify inside 24 h"
out=$(run --now 2026-11-02T10:30:00+11:00)
has "$out" "primary: notified" "R4: one notify once it stays diverged 24 h"
has "$(cat "$NTFY_LOG")" "cannot fast-forward to origin" "R4: … through the primary's ntfy-push.py"
run --now 2026-11-03T10:30:00+11:00 >/dev/null
ok "$(grep -c 'cannot fast-forward' "$NTFY_LOG")" 1 "R4: … and only once for the same HEAD and tip"
g -C "$tmp/primary" reset -q --hard origin/master
run >/dev/null
ok "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["stuck"]))' "$XDG_STATE_HOME/thread/primary-refresh.json")" 0 \
  "R4: a checkout back to current drops its entry"

# ---- R7: never a linked worktree or a Rollout clone --------------------------------------------------------
g -C "$tmp/primary" worktree add -q --detach "$tmp/wt" 2>/dev/null
has "$(python3 "$pr" run --primary "$tmp/wt")" "not a primary checkout: a linked worktree" "R7: a linked worktree is no primary"
g clone -q "$tmp/origin.git" "$tmp/primary-rollout" 2>/dev/null
has "$(python3 "$pr" run --primary "$tmp/primary-rollout")" "not a primary checkout: a Rollout clone" "R7: a Rollout clone is no primary"
has "$(python3 "$pr" run --primary "$tmp/primary/skills")" "not its own toplevel" "R7: a folder inside a checkout is no primary"

# ---- R8 / I1: install writes the copy and the job ----------------------------------------------------------
out=$(python3 "$pr" install --primary "$tmp/primary" --also "$tmp/agents" --bin-dir "$tmp/bin" --plist "$tmp/job.plist" 2>&1)
has "$out" "launchctl bootstrap gui/" "I1: install prints the bootstrap step"
ok "$(cmp -s "$pr" "$tmp/bin/primary-refresh.py" && echo same)" same "I1: the installed copy is this script"
args=$(python3 -c 'import plistlib,sys; j=plistlib.load(open(sys.argv[1],"rb")); print(j["Label"], j["StartInterval"], j["RunAtLoad"], " ".join(j["ProgramArguments"][1:]))' "$tmp/job.plist")
ok "$args" "com.thread.primary-refresh 300 True $tmp/bin/primary-refresh.py run --primary $tmp/primary --also $tmp/agents" \
  "R8: the job runs the installed copy every 300 s, with --primary and each --also"

# ---- S1: a move brings the installed copy up to the primary's -----------------------------------------------
echo "# a newer refresh" >> "$tmp/seed/skills/_shared/scripts/primary-refresh.py"
g -C "$tmp/seed" commit -qam newer; g -C "$tmp/seed" push -q origin master 2>/dev/null
out=$(run --bin-dir "$tmp/bin")
has "$out" "now matches the primary's" "S1: after a move the installed copy is replaced by the primary's"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# a newer refresh" "S1: … with its content"

exit $fail
