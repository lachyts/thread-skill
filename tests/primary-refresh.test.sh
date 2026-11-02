#!/usr/bin/env bash
# ADR 0066, executed: skills/_shared/scripts/primary-refresh.py, the Primary refresh. A bare "origin" and clones of
# it stand for the primary and an --also checkout; the primary's own primary-hold.sh and ntfy-push.py are stubs
# committed into origin (the hold prints $HOLD_FILE's text, the push appends its message to $NTFY_LOG), so every
# arm is offline. R1-R9 are the plan's cases; N1-N3 the stuck spell; S1-S5 the self-update; I1 install's job. Every
# run goes through a copy outside any git work tree, as the installed job does, so no arm can rewrite this tree. Hermetic: HOME, XDG_STATE_HOME
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
mkdir -p "$tmp/run"; cp "$pr" "$tmp/run/primary-refresh.py"
run() { python3 "$tmp/run/primary-refresh.py" run --primary "$tmp/primary" "$@" 2>&1; }
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

# ---- R4 / N1-N3: ahead, then diverged; the stuck spell and its one notify -----------------------------------
echo local > "$tmp/primary/b.txt"; g -C "$tmp/primary" add b.txt; g -C "$tmp/primary" commit -qm local
has "$(run)" "primary: ahead 1: left to its landing route" "R4: a primary ahead of origin is left to its landing route"
land a.txt four
out=$(run --now 2026-11-01T10:00:00+11:00)
has "$out" "diverged (ahead 1, behind 1)" "R4: a diverged primary is never integrated"
ok "$(git -C "$tmp/primary" log -1 --format=%s)" "local" "R4: … its HEAD stays its own"
land a.txt five   # N1: origin moves on during the spell
run --now 2026-11-01T20:00:00+11:00 >/dev/null
ok "$(cat "$NTFY_LOG" 2>/dev/null)" "" "R4: no notify inside 24 h"
g -C "$tmp/primary" remote set-url origin "$tmp/nowhere.git"   # N2: a blip (fetch fails) mid-spell
has "$(run --now 2026-11-02T06:00:00+11:00)" "primary: fetch failed" "N2: a fetch that fails reads fetch failed"
g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"
land a.txt six
out=$(run --now 2026-11-02T10:30:00+11:00)
has "$out" "primary: notified" "N1/N2: one notify once the spell is 24 h old, though origin moved and a fetch failed within it"
has "$(cat "$NTFY_LOG")" "has not caught up with origin since 2026-11-01T10:00" "R4: … through the primary's ntfy-push.py, dated from the spell's start"
run --now 2026-11-03T10:30:00+11:00 >/dev/null
ok "$(grep -c 'has not caught up' "$NTFY_LOG")" 1 "R4: … and only once a spell"
g -C "$tmp/primary" reset -q --hard origin/master
run >/dev/null
ok "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["stuck"]))' "$XDG_STATE_HOME/thread/primary-refresh.json")" 0 \
  "R4: a checkout back to current ends its spell"
# N3: busy for a day is stuck, and a hold continues a spell: one standing a day is reported too
touch "$tmp/primary/.git/index.lock"
run --now 2026-11-04T09:00:00+11:00 >/dev/null
rm -f "$tmp/primary/.git/index.lock"
echo "[[y-rollout]] running on it" > "$HOLD_FILE"
has "$(run --now 2026-11-04T21:00:00+11:00)" "primary: held: [[y-rollout]]" "N3: a held pass reads held"
ok "$(grep -c 'has not caught up' "$NTFY_LOG")" 1 "N3: … and inside 24 h nothing is sent"
out=$(run --now 2026-11-05T09:30:00+11:00)
has "$out" "primary: notified" "N3: a spell begun busy and still held a day later notifies (a hold never restarts the clock)"
has "$(tail -1 "$NTFY_LOG")" "since 2026-11-04T09:00: held: [[y-rollout]] running on it" "N3: … dated from the spell's start, naming the holders"
rm -f "$HOLD_FILE"
run >/dev/null
ok "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["stuck"]))' "$XDG_STATE_HOME/thread/primary-refresh.json")" 0 \
  "N3: a current pass ends the spell"

# ---- R7: never a linked worktree or a Rollout clone --------------------------------------------------------
g -C "$tmp/primary" worktree add -q --detach "$tmp/wt" 2>/dev/null
has "$(python3 "$tmp/run/primary-refresh.py" run --primary "$tmp/wt")" "not a primary checkout: a linked worktree" "R7: a linked worktree is no primary"
g clone -q "$tmp/origin.git" "$tmp/primary-rollout" 2>/dev/null
has "$(python3 "$tmp/run/primary-refresh.py" run --primary "$tmp/primary-rollout")" "not a primary checkout: a Rollout clone" "R7: a Rollout clone is no primary"
has "$(python3 "$tmp/run/primary-refresh.py" run --primary "$tmp/primary/skills")" "not its own toplevel" "R7: a folder inside a checkout is no primary"

# ---- R8 / I1: install writes the copy and the job ----------------------------------------------------------
out=$(python3 "$pr" install --primary "$tmp/primary" --also "$tmp/agents" --bin-dir "$tmp/bin" --plist "$tmp/job.plist" 2>&1)
has "$out" "launchctl bootstrap gui/" "I1: install prints the bootstrap step"
ok "$(cmp -s "$pr" "$tmp/bin/primary-refresh.py" && echo same)" same "I1: the installed copy is this script"
args=$(python3 -c 'import plistlib,sys; j=plistlib.load(open(sys.argv[1],"rb")); print(j["Label"], j["StartInterval"], j["RunAtLoad"], " ".join(j["ProgramArguments"][1:]))' "$tmp/job.plist")
ok "$args" "com.thread.primary-refresh 300 True $tmp/bin/primary-refresh.py run --primary $tmp/primary --also $tmp/agents" \
  "R8: the job runs the installed copy every 300 s, with --primary and each --also"

# ---- S1-S5: the installed copy updates itself from origin's committed script ------------------------------------
job() { python3 "$tmp/bin/primary-refresh.py" run --primary "$tmp/primary" "$@" 2>&1; }
newer() {  # newer <line>: a commit on origin appending <line> to the script
  echo "$1" >> "$tmp/seed/skills/_shared/scripts/primary-refresh.py"
  g -C "$tmp/seed" commit -qam "$1"; g -C "$tmp/seed" push -q origin master 2>/dev/null
}
newer "# a newer refresh"
out=$(job)
has "$out" "now matches origin/master" "S1: a move brings the installed copy up to origin's committed script"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# a newer refresh" "S1: … with its content"
newer "# moved by another route"
g -C "$tmp/primary" fetch -q origin && g -C "$tmp/primary" merge -q --ff-only origin/master   # merge-task's refresh, say
out=$(job)
has "$out" "primary: current" "S2: a primary another route moved reads current"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S2: … and the copy still catches up"
echo "# half-written, uncommitted" >> "$tmp/primary/skills/_shared/scripts/primary-refresh.py"
job >/dev/null
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S3: an uncommitted edit in the primary never reaches the copy"
g -C "$tmp/primary" checkout -q -- skills/_shared/scripts/primary-refresh.py
newer "def broken(:"
out=$(job)
has "$out" "does not compile" "S3: a committed script that does not compile is refused"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S3: … and the copy is kept"
git -C "$tmp/seed" revert -q --no-edit HEAD >/dev/null 2>&1; g -C "$tmp/seed" push -q origin master 2>/dev/null
job >/dev/null
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S3: a revert back to a script the copy already runs changes nothing"
# S4: a primary whose HEAD is its own stale origin ref (fetched days ago), and held, never downgrades the copy
old=$(git -C "$tmp/seed" rev-parse HEAD~4)
g -C "$tmp/primary" reset -q --hard "$old"; git -C "$tmp/primary" update-ref refs/remotes/origin/master "$old"
before=$(shasum < "$tmp/bin/primary-refresh.py")
echo "[[z-rollout]] running on it" > "$HOLD_FILE"
job >/dev/null
ok "$(shasum < "$tmp/bin/primary-refresh.py")" "$before" "S4: a held primary at its stale origin ref never downgrades the copy"
rm -f "$HOLD_FILE"
has "$(job)" "primary: moved" "S4: once the hold clears the pass fetches and moves"
ok "$(shasum < "$tmp/bin/primary-refresh.py")" "$before" "S4: … and the copy, already at origin's script, stays"
# S5: only the copy install placed rewrites itself
mkdir -p "$tmp/cache/9.9.9"; cp "$pr" "$tmp/cache/9.9.9/primary-refresh.py"
python3 "$tmp/cache/9.9.9/primary-refresh.py" run --primary "$tmp/primary" >/dev/null 2>&1
ok "$(cmp -s "$pr" "$tmp/cache/9.9.9/primary-refresh.py" && echo same)" same "S5: a copy outside git with no install marker (a version cache) is never rewritten"
cp "$pr" "$tmp/src-before"; python3 "$pr" run --primary "$tmp/primary" >/dev/null 2>&1
ok "$(cmp -s "$pr" "$tmp/src-before" && echo same)" same "S5: nor is the script in this tree"

exit $fail
