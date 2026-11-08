#!/usr/bin/env bash
# ADR 0066 as amended 2026-11-05 (p37-7) and by ADR 0075 d2 (P41-5: no notice is ever sent), executed:
# skills/_shared/scripts/primary-refresh.py, the Primary refresh. A bare "origin" and clones of it stand for the primary
# and an --also checkout. The seed commits the real bundle files (primary-refresh.py bundle's table) plus a stub
# primary-hold.sh (it prints $HOLD_FILE's text). install runs first, into $tmp/bin, and job() runs the plist's own
# ProgramArguments (read with plistlib, so --log and --job-shape are in it) plus each arm's flags, outside any work tree,
# as launchd does; run() is a checkout copy (no install marker) at its repo path, with background_job.py beside it. A
# stuck spell is read by the `stuck` verb (/thread:status's Primary refresh line); no pass prints `notified` or
# `would notify`.
#   install   I1 I5 R8 I4 (the job's flags and env pinned beside JOB_SHAPE) I3 I2, I7 I7b I7c I8 (background_job.py:
#             a copy that cannot load it, and `bundle`, which never loads it), Q1-Q4 (the prune at install)
#   a pass    R1-R9, R4/N1-N3, F1 B1 D1 (the fetch and the ssh rule), O1 O2 (the overlap), X1 (the helper's contract)
#   spells    P0-P2 (since, kindSince, outcome), U1 (an entry from before p37-7), M1 H1 N5, T1 T2 (timeouts and a TERM),
#             K1 L1 J1
#   stuck     ST1-ST7 (the read-only verb: its due rule, its line, no write, no freshness check)
#   self-update  S1-S5, S6a-S6j (the smoke; S6j a candidate whose own background_job.py is broken), S7 (the
#             transition), S8 S9, S10a-S10c (the candidate's table), I6 (the frozen contract)
# Origins over ssh are git@github.com:o/origin.git, served by tests/fixtures/land/fake-ssh.sh on PATH as `ssh`. Every pid
# an arm records is checked gone (`gone`). Hermetic: HOME, XDG_STATE_HOME and every path live under mktemp; commits carry
# an inline identity; global/system git config is ignored; no server runs.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset GIT_SSH_COMMAND GIT_SSH SMOKE_MARK SMOKE_ARGV HANG_PIDS STUB
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 NO_PROXY=127.0.0.1 no_proxy=127.0.0.1
root=$(pwd -P)
pr="$root/skills/_shared/scripts/primary-refresh.py"
SELF=skills/_shared/scripts/primary-refresh.py
LCR=skills/_shared/scripts/live-checkout.sh

tmp=$(mktemp -d); tmp=$(cd "$tmp" && pwd -P)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
export HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" HOLD_FILE="$tmp/hold"
export SRV="$tmp/srv" LOG_SSH="$tmp/ssh.log" HOOK_PID="$tmp/hook.pid"
mkdir -p "$HOME/.config/thread" "$tmp/out" "$tmp/sshbin" "$tmp/countbin" "$SRV/o"; : > "$LOG_SSH"
DS="$XDG_STATE_HOME/thread/primary-refresh.json"   # the default state file: the job's, and install's prune's
cp tests/fixtures/land/fake-ssh.sh "$tmp/sshbin/ssh"; chmod +x "$tmp/sshbin/ssh"
export PATH="$tmp/sshbin:$PATH"
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
gone() {  # gone <pid> <label>: the pid is gone within 5 s (reaping included); no pid recorded is a FAIL, never a pass
  [ -n "$1" ] || { ok "no pid recorded" gone "$2"; return; }
  local i=0
  while kill -0 "$1" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
  ok "$(kill -0 "$1" 2>/dev/null && echo alive || echo gone)" gone "$2"
}
# at <minutes>: T0 plus that many minutes, ISO
T0=2026-11-10T10:00:00+11:00
at() { python3 -c 'import sys, datetime as d; print((d.datetime.fromisoformat(sys.argv[1]) + d.timedelta(minutes=int(sys.argv[2]))).isoformat())' "$T0" "$1"; }
# sv <state file> <key> <field>: one field of one entry (None when absent)
sv() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["stuck"].get(sys.argv[2], {}).get(sys.argv[3]))' "$@" 2>/dev/null; }
skeys() { python3 -c 'import json,sys; print(" ".join(sorted(json.load(open(sys.argv[1]))["stuck"])))' "$1" 2>/dev/null; }
# stk <stuck args>: the `stuck` verb's whole output; sline: its line alone (None when null)
stk() { python3 "$pr" stuck "$@" 2>&1; }
sline() { python3 "$pr" stuck "$@" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["line"])'; }
mode_of() { python3 -c 'import os,stat,sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode))[2:].zfill(4))' "$1"; }

# ---- fixtures -------------------------------------------------------------------------------------------------------
g init -q --bare "$tmp/origin.git"; ln -s "$tmp/origin.git" "$SRV/o/origin.git"
g clone -q "$tmp/origin.git" "$tmp/seed" 2>/dev/null
python3 "$pr" bundle > "$tmp/table"
while read -r m rel irel; do mkdir -p "$tmp/seed/$(dirname "$rel")"; cp -p "$root/$rel" "$tmp/seed/$rel"; done < "$tmp/table"
printf '[ -f "$HOLD_FILE" ] && cat "$HOLD_FILE"\nexit 0\n' > "$tmp/seed/skills/_shared/scripts/primary-hold.sh"
echo one > "$tmp/seed/a.txt"
g -C "$tmp/seed" add -A && g -C "$tmp/seed" commit -qm one && g -C "$tmp/seed" push -q origin master 2>/dev/null
g clone -q "$tmp/origin.git" "$tmp/primary" 2>/dev/null
g clone -q "$tmp/origin.git" "$tmp/agents" 2>/dev/null
# land <file> <text>: a commit on origin through the seed
land() { mkdir -p "$(dirname "$tmp/seed/$1")"; echo "$2" > "$tmp/seed/$1"; g -C "$tmp/seed" add -A; g -C "$tmp/seed" commit -qm "$2"; g -C "$tmp/seed" push -q origin master 2>/dev/null; }
# edit <seed file> <old> <new>: replace the one occurrence; commit <msg>: commit and push the seed
edit() {
  python3 - "$tmp/seed/$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1:]
t = open(p).read()
assert t.count(old) == 1, f"{p}: {old!r} occurs {t.count(old)} times"
open(p, "w").write(t.replace(old, new))
PY
}
commit() { g -C "$tmp/seed" add -A; g -C "$tmp/seed" commit -qm "$1"; g -C "$tmp/seed" push -q origin master 2>/dev/null; }
# real: the seed's bundle files back to this tree's
real() { while read -r m rel irel; do cp -p "$root/$rel" "$tmp/seed/$rel"; done < "$tmp/table"; }
# run()'s copy sits at its repo path in a mini plugin root that holds background_job.py and no other helper, so
# live-checkout.sh still comes from the primary.
RUNC="$tmp/run/skills/_shared/scripts"; mkdir -p "$RUNC"; cp "$pr" "$root/skills/_shared/scripts/background_job.py" "$RUNC/"
run() { (cd "$tmp/out" && python3 "$RUNC/primary-refresh.py" run --primary "$tmp/primary" "$@") 2>&1; }
head_of() { git -C "$1" rev-parse HEAD; }
tip() { git -C "$tmp/seed" rev-parse HEAD; }
same() { cmp -s "$1" "$2" && echo same || echo differs; }

# ---- I1 / I5 / R8 / I4: install writes the bundle and the job ---------------------------------------------------------
out=$(python3 "$pr" install --primary "$tmp/primary" --also "$tmp/agents" --bin-dir "$tmp/bin" --plist "$tmp/job.plist" --log "$tmp/job.log" 2>&1)
has "$out" "launchctl bootstrap gui/" "I1: install prints the bootstrap step"
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")" same "I1: the installed copy is this script"
bad=; while read -r m rel irel; do
  [ "$(same "$root/$rel" "$tmp/bin/$irel")|$(mode_of "$tmp/bin/$irel")" = "same|$m" ] || bad="$bad $irel"
done < "$tmp/table"
ok "${bad:-none}" none "I1: an empty bin directory gets every bundle file, byte for byte, with its mode"
ok "$(cd "$tmp/bin" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | tr '\n' ' ')" \
  "$( (cut -d' ' -f3 "$tmp/table"; echo primary-refresh.installed) | LC_ALL=C sort | tr '\n' ' ')" \
  "I5: … exactly the table's install-rels plus the marker"
ok "$(wc -l < "$tmp/table" | tr -d ' ')|$(grep -cE '^0[0-7]{3} [A-Za-z0-9._/-]+ [A-Za-z0-9._/-]+$' "$tmp/table")" "6|6" \
  "I5: primary-refresh.py bundle prints six lines in the strict form"
lacks "$(cat "$tmp/table")" "ntfy-push" "I5: … and no ntfy-push.py row (ADR 0075 d2: a self-update removes the installed copy)"
has "$(head -1 "$tmp/table")" "0755 skills/_shared/scripts/primary-refresh.py primary-refresh.py" "I5: … the copy's own row first"
JOB=(); while IFS= read -r -d '' a; do JOB+=("$a"); done < <(python3 -c 'import plistlib,sys; sys.stdout.write("\0".join(plistlib.load(open(sys.argv[1],"rb"))["ProgramArguments"]) + "\0")' "$tmp/job.plist")
args=$(python3 -c 'import plistlib,sys; j=plistlib.load(open(sys.argv[1],"rb")); print(j["Label"], j["StartInterval"], j["RunAtLoad"], " ".join(j["ProgramArguments"][1:]))' "$tmp/job.plist")
ok "$args" "com.thread.primary-refresh 300 True $tmp/bin/primary-refresh.py run --primary $tmp/primary --also $tmp/agents --log $tmp/job.log --job-shape 1" \
  "R8: the job runs the installed copy every 300 s, with --primary, each --also, --log and --job-shape"
ok "$(python3 - "$tmp/job.plist" "$pr" <<'PY'
import importlib.util, plistlib, sys
sys.dont_write_bytecode = True
j = plistlib.load(open(sys.argv[1], "rb"))
spec = importlib.util.spec_from_file_location("pr", sys.argv[2]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
flags = [a for a in j["ProgramArguments"][2:] if a == "run" or a.startswith("--")]
print(m.JOB_SHAPE, " ".join(flags), " ".join(sorted(j["EnvironmentVariables"])))
PY
)" "1 run --primary --also --log --job-shape PATH" \
  "I4: the job's flags and env keys are pinned beside JOB_SHAPE 1: change either and bump JOB_SHAPE with this pin"
job() { (cd "$tmp/out" && "${JOB[@]}" "$@") 2>&1; }
JOB0=(); for a in "${JOB[@]}"; do JOB0+=("$a"); done; JOB0=("${JOB0[@]:0:$((${#JOB0[@]}-2))}")   # less --job-shape 1
job0() { (cd "$tmp/out" && "${JOB0[@]}" "$@") 2>&1; }

# ---- R3 / R1 / R9 / R2 / R5 / R6: one pass ---------------------------------------------------------------------------
has "$(job)" "primary: current" "R3: a primary at origin's tip reads current"
land a.txt two
echo "[[x-rollout]] running on it" > "$HOLD_FILE"
before=$(head_of "$tmp/primary")
out=$(job)
has "$out" "held: [[x-rollout]] running on it" "R1: the primary's own primary-hold.sh output holds it"
has "$out" "agents: moved" "R9: an --also checkout behind origin is fast-forwarded while the primary's hold stands"
ok "$(head_of "$tmp/agents")" "$(tip)" "R9: … to origin's tip"
ok "$(head_of "$tmp/primary")" "$before" "R1: … and nothing moved"
printf 'exit 3\n' > "$tmp/primary/skills/_shared/scripts/primary-hold.sh"
has "$(job)" "held: the hold check exited 3" "R1: a hold check that exits non-zero holds"
mv "$tmp/primary/skills/_shared/scripts/primary-hold.sh" "$tmp/hold.bak"
has "$(job)" "held: no skills/_shared/scripts/primary-hold.sh in the primary" "R1: a primary with no hold script holds"
mv "$tmp/hold.bak" "$tmp/primary/skills/_shared/scripts/primary-hold.sh"
g -C "$tmp/primary" checkout -q -- skills/_shared/scripts/primary-hold.sh
ok "$(head_of "$tmp/primary")" "$before" "R1: … and nothing moved"
has "$(job)" "agents: current" "R9: … and current after"
rm -f "$HOLD_FILE"
has "$(job --dry-run)" "would move" "R2: --dry-run says it would move"
ok "$(head_of "$tmp/primary")" "$before" "R2: … and moves nothing"
has "$(job)" "primary: moved" "R2: a clear, behind primary is fast-forwarded"
ok "$(head_of "$tmp/primary")" "$(tip)" "R2: … to origin's tip"
land a.txt three
touch "$tmp/primary/.git/index.lock"
has "$(job)" "busy: index.lock present" "R5: an index.lock skips the pass"
rm -f "$tmp/primary/.git/index.lock"
touch "$tmp/primary/.git/MERGE_HEAD"
has "$(job)" "busy: a merge in progress" "R5: a merge in progress skips the pass"
rm -f "$tmp/primary/.git/MERGE_HEAD"; mkdir "$tmp/primary/.git/sequencer"
has "$(job)" "busy: a cherry-pick or revert sequence in progress" "R5: … and so does a sequencer with no CHERRY_PICK_HEAD"
rm -rf "$tmp/primary/.git/sequencer"
g -C "$tmp/primary" checkout -q -b side
has "$(job)" "busy: on side, not master" "R5: a primary off its default branch is left alone"
g -C "$tmp/primary" checkout -q master
echo mine > "$tmp/primary/a.txt"; before=$(head_of "$tmp/primary")
has "$(job)" "primary: refused: local changes overlap origin/master (a.txt)" "R6: a dirty file origin changes refuses the fast-forward, naming it"
ok "$(head_of "$tmp/primary")|$(cat "$tmp/primary/a.txt")" "$before|mine" "R6: … HEAD stays and the edit is untouched"
g -C "$tmp/primary" checkout -q -- a.txt
echo note > "$tmp/primary/untouched.txt"
has "$(job)" "primary: moved" "R6: an uncommitted file origin never touches does not stop a move"
rm -f "$tmp/primary/untouched.txt"

# ---- R4 / N1-N3: ahead, then diverged; the spell and its reading ---------------------------------------------------------
echo local > "$tmp/primary/b.txt"; g -C "$tmp/primary" add b.txt; g -C "$tmp/primary" commit -qm local
has "$(job)" "primary: ahead 1: left to its landing route" "R4: a primary ahead of origin is left to its landing route"
land a.txt four
echo "[[r-rollout]] running on it" > "$HOLD_FILE"
has "$(job --now 2026-11-01T10:00:00+11:00)" "diverged (ahead 1, behind 1)" "R4: a diverged primary is never integrated, and reads diverged even while held"
rm -f "$HOLD_FILE"
ok "$(git -C "$tmp/primary" log -1 --format=%s)" "local" "R4: … its HEAD stays its own"
land a.txt five   # N1: origin moves on during the spell
out=$(job --now 2026-11-01T20:00:00+11:00)
ok "$(sline --now 2026-11-01T20:00:00+11:00)" None "R4: inside 24 h the stuck read names nothing"
ok "$(sv "$DS" "$tmp/primary" since)|$(sv "$DS" "$tmp/primary" kind)" "2026-11-01T10:00:00+11:00|diverged" "R4: … the spell dated from its first diverged pass"
g -C "$tmp/primary" remote set-url origin "$tmp/nowhere.git"   # N2: a blip (the fetch fails) mid-spell
has "$(job --now 2026-11-02T06:00:00+11:00)" "primary: fetch failed: " "N2: a fetch that fails reads fetch failed"
ok "$(sv "$DS" "$tmp/primary" since)|$(sv "$DS" "$tmp/primary" kind)|$(sv "$DS" "$tmp/primary" kindSince)" \
  "2026-11-01T10:00:00+11:00|fetch-failed|2026-11-02T06:00:00+11:00" "N2: … its since kept, its kind and kindSince the new kind's"
g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"
land a.txt six
out=$(job --now 2026-11-02T10:30:00+11:00)
lacks "$out" "notif" "N1: no pass notifies, nor says it would"
ok "$(sline --now 2026-11-02T10:30:00+11:00)" \
  "Primary refresh: primary: diverged (ahead 1, behind 3): never integrated here (stuck since 2026-11-01T10:00; git -C $tmp/primary status)" \
  "N1/N2: once the spell is 24 h old the stuck read names it, though origin moved and a fetch failed within it: outcome first, then dated from the spell's start"
g -C "$tmp/primary" reset -q --hard origin/master
job >/dev/null
ok "$(skeys "$DS")" "" "R4: a checkout back to current ends its spell"
touch "$tmp/primary/.git/index.lock"; echo "[[w-rollout]] running on it" > "$HOLD_FILE"
has "$(job --now 2026-11-03T12:00:00+11:00)" "primary: current" "N3: a primary at origin's tip reads current, lock and hold or not"
job --now 2026-11-04T13:00:00+11:00 >/dev/null
ok "$(skeys "$DS")" "" "N3: … so a day at origin's tip under a hold starts no spell"
rm -f "$HOLD_FILE"; land a.txt seven
has "$(job --now 2026-11-04T09:00:00+11:00)" "primary: busy: index.lock present" "N3: behind origin with an index.lock reads busy"
rm -f "$tmp/primary/.git/index.lock"; echo "[[y-rollout]] running on it" > "$HOLD_FILE"
has "$(job --now 2026-11-04T21:00:00+11:00)" "primary: held: [[y-rollout]]" "N3: a held pass reads held"
ok "$(sline --now 2026-11-04T21:00:00+11:00)" None "N3: … and inside 24 h the stuck read names nothing"
lacks "$(job --now 2026-11-05T09:30:00+11:00)" "notif" "N3: a day later the pass notifies nothing"
has "$(sline --now 2026-11-05T09:30:00+11:00)" "Primary refresh: primary: held: [[y-rollout]] running on it (stuck since 2026-11-04T09:00" \
  "N3: … and the stuck read names the then-current kind and its holders, dated from the busy pass (a new kind never restarts the 24 h)"
rm -f "$HOLD_FILE"; job >/dev/null
ok "$(skeys "$DS")" "" "N3: a current pass ends the spell"

# ---- R7: never a linked worktree or a Rollout clone -----------------------------------------------------------------
g -C "$tmp/primary" worktree add -q --detach "$tmp/wt" 2>/dev/null
has "$(run --primary "$tmp/wt" --state "$tmp/s-r7.json")" "not a primary checkout: a linked worktree" "R7: a linked worktree is no primary"
g clone -q "$tmp/origin.git" "$tmp/primary-rollout" 2>/dev/null
has "$(run --primary "$tmp/primary-rollout" --state "$tmp/s-r7.json")" "not a primary checkout: a Rollout clone" "R7: a Rollout clone is no primary"
has "$(run --primary "$tmp/primary/skills" --state "$tmp/s-r7.json")" "not its own toplevel" "R7: a folder inside a checkout is no primary"
g -C "$tmp/primary" worktree remove --force "$tmp/wt"

# ---- P0-P2: the spell's since, kindSince and outcome ------------------------------------------------------------------------
# P0: a fresh spell that changes kind keeps its since; its kindSince and outcome are the new kind's
S="$tmp/s-p.json"
land p0.txt p0; echo "[[x-rollout]] running on it" > "$HOLD_FILE"
has "$(job --state "$S" --now "$(at 0)")" "primary: held:" "P0: held at T0"
rm -f "$HOLD_FILE"; land p.txt "origin p"; echo mine > "$tmp/primary/p.txt"
has "$(job --state "$S" --now "$(at 120)")" "primary: refused: local changes overlap origin/master (p.txt)" "P0: … refused at T0+2h"
ok "$(sv "$S" "$tmp/primary" since)|$(sv "$S" "$tmp/primary" kind)|$(sv "$S" "$tmp/primary" kindSince)|$(sv "$S" "$tmp/primary" outcome)" \
  "$(at 0)|refused|$(at 120)|refused: local changes overlap origin/master (p.txt)" "P0: … since kept at T0, kindSince the refusal's, outcome the latest"
out=$(job --state "$S" --now "$(at 180)")
lacks "$out" "notif" "P0: … and at T0+3h nothing notifies"
ok "$(sv "$S" "$tmp/primary" kindSince)" "$(at 120)" "P0: … a pass of the same kind keeps kindSince"
ok "$(sv "$S" "$tmp/primary" notifiedKinds)" None "P0: … and a spell holds no notifiedKinds"
rm -f "$tmp/primary/p.txt"; job --state "$S" >/dev/null
# P1: held for a day, named by the stuck read; refused once the hold clears, named as refused at once (the spell is old)
S="$tmp/s-p1.json"
land p1a p1a; echo "[[x-rollout]] running on it" > "$HOLD_FILE"
job --state "$S" --now "$(at 0)" >/dev/null
lacks "$(job --state "$S" --now "$(at 1440)")" "notif" "P1: held from T0: at T0+24h no pass notifies"
has "$(sline --state "$S" --now "$(at 1440)")" "Primary refresh: primary: held: [[x-rollout]] running on it (stuck since $(at 0 | cut -c1-16)" "P1: … and the stuck read names it"
rm -f "$HOLD_FILE"; land p1.txt "origin p1"; echo mine > "$tmp/primary/p1.txt"
has "$(job --state "$S" --now "$(at 1800)")" "primary: refused: local changes overlap origin/master (p1.txt)" "P1: the hold clears at T0+30h, and the overlap reads refused"
has "$(sline --state "$S" --now "$(at 1800)")" "Primary refresh: primary: refused: local changes overlap origin/master (p1.txt) (stuck since $(at 0 | cut -c1-16)" \
  "P1: … the stuck read names the refusal at once, dated from the spell's start"
# P2: back to held, then busy: each pass's outcome is the latest; since never moves
echo "[[x-rollout]] running on it" > "$HOLD_FILE"
has "$(job --state "$S" --now "$(at 1920)")" "primary: held:" "P2: back to held at T0+32h"
rm -f "$HOLD_FILE"; touch "$tmp/primary/.git/index.lock"
has "$(job --state "$S" --now "$(at 2100)")" "primary: busy: index.lock present" "P2: busy at T0+35h"
ok "$(sv "$S" "$tmp/primary" since)|$(sv "$S" "$tmp/primary" kind)|$(sv "$S" "$tmp/primary" kindSince)|$(sv "$S" "$tmp/primary" outcome)" \
  "$(at 0)|busy|$(at 2100)|busy: index.lock present" "P2: … since still T0, the kind, kindSince and outcome the busy pass's"
rm -f "$tmp/primary/.git/index.lock" "$tmp/primary/p1.txt"
has "$(job --state "$S")" "primary: moved" "P2: cleared, the primary moves"
ok "$(skeys "$S")" "" "P2: … and the spell ends"

# ---- U1: an entry in the shape before p37-7, and one an earlier copy notified -------------------------------------------------
S="$tmp/s-u1.json"
printf '{"v": 1, "stuck": {"%s": {"since": "%s", "notified": "%s"}}}\n' "$tmp/primary" "$(at 0)" "$(at 1440)" > "$S"
has "$(sline --state "$S" --now "$(at 1450)")" "Primary refresh: primary: stuck (kind not yet read) (stuck since $(at 0 | cut -c1-16); git -C $tmp/primary status)" \
  "U1: an old entry with no kind is named at 24 h as stuck (kind not yet read)"
land u1a u1a; echo "[[x-rollout]] running on it" > "$HOLD_FILE"
lacks "$(job --state "$S" --now "$(at 1500)")" "notif" "U1: its held pass at T0+25h notifies nothing"
ok "$(sv "$S" "$tmp/primary" kind)|$(sv "$S" "$tmp/primary" kindSince)|$(sv "$S" "$tmp/primary" notified)|$(sv "$S" "$tmp/primary" since)|$(sv "$S" "$tmp/primary" notifiedKinds)" \
  "held|$(at 1500)|$(at 1440)|$(at 0)|None" "U1: … it takes that pass's kind, its since kept, its old notified kept exactly, no notifiedKinds written"
has "$(sline --state "$S" --now "$(at 1500)")" "Primary refresh: primary: held: [[x-rollout]] running on it (stuck since $(at 0 | cut -c1-16)" "U1: … and the stuck read names it by its kind now"
rm -f "$HOLD_FILE"; job --state "$S" >/dev/null
ok "$(skeys "$S")" "" "U1: a current pass ends it"

# ---- M1: the five-holder spell keeps every holder ---------------------------------------------------------------------------
mkdir -p "$tmp/m1"; g clone -q "$tmp/origin.git" "$tmp/m1/thread-skill" 2>/dev/null
land m1 m1; S="$tmp/s-m1.json"
hs=""; for d in 2026-10-29 2026-10-30 2026-10-31 2026-11-01 2026-11-02; do hs="$hs[[mac-data-mcp-rollout-$d]] "; done
echo "${hs}running on it" > "$HOLD_FILE"
job --primary "$tmp/m1/thread-skill" --state "$S" --now "$(at 0)" >/dev/null
job --primary "$tmp/m1/thread-skill" --state "$S" --now "$(at 1440)" >/dev/null
m=$(sline --state "$S" --now "$(at 1440)")
has "$m" "Primary refresh: thread-skill: held: [[mac-data-mcp-rollout-2026-10-29]]" "M1: a five-holder hold is named at 24 h, outcome first"
ok "$(printf '%s' "$m" | grep -o '\[\[mac-data-mcp-rollout-[0-9-]*\]\]' | grep -c .)" 5 "M1: … all five holders whole, with no cut"
has "$m" "running on it (stuck since $(at 0 | cut -c1-16); git -C $tmp/m1/thread-skill status)" "M1: … and its tail"
rm -f "$HOLD_FILE"

# ---- H1: a multi-line hold error is one line ----------------------------------------------------------------------------------
S="$tmp/s-h1.json"
printf 'echo "line one" >&2\necho "line two" >&2\nexit 3\n' > "$tmp/primary/skills/_shared/scripts/primary-hold.sh"
land h1 h1
has "$(job --state "$S" --now "$(at 0)")" "primary: held: the hold check exited 3: line one line two" "H1: two stderr lines and exit 3 read as one held: line"
ok "$(sline --state "$S" --now "$(at 1440)" | grep -c .)" 1 "H1: … and the stuck read's line is one line"
has "$(sline --state "$S" --now "$(at 1440)")" "primary: held: the hold check exited 3: line one line two (stuck since" "H1: … naming it"
g -C "$tmp/primary" checkout -q -- skills/_shared/scripts/primary-hold.sh; job --state "$S" >/dev/null

# ---- N5: a primary that has gone is still named --------------------------------------------------------------------------------
S="$tmp/s-n5.json"
mv "$tmp/primary" "$tmp/primary.away"
has "$(job --state "$S" --now "$(at 0)")" "primary: not a primary checkout: not a git checkout" "N5: a primary moved away reads not a primary checkout"
ok "$(sline --state "$S" --now "$(at 1439)")" None "N5: … not named before 24 h"
has "$(sline --state "$S" --now "$(at 1440)")" "Primary refresh: primary: not a primary checkout: not a git checkout (stuck since" "N5: … and named at 24 h"
mv "$tmp/primary.away" "$tmp/primary"; job --state "$S" >/dev/null

# ---- T1: the fast-forward is bounded, and its timeout is named at once ---------------------------------------------------------
printf '#!/bin/sh\necho $$ > "$HOOK_PID"\nexec sleep 60\n' > "$tmp/primary/.git/hooks/post-merge"; chmod +x "$tmp/primary/.git/hooks/post-merge"
S="$tmp/s-t1.json"; land t1 t1; rm -f "$HOOK_PID"
out=$(job --state "$S" --now "$(at 0)" --ff-timeout 2)
has "$out" "primary: timed out: git merge --ff-only ran past 2 s and was stopped: the working tree may be partly updated (git -C $tmp/primary status)" "T1: a hung merge is stopped at --ff-timeout"
lacks "$out" "notif" "T1: … and nothing is sent"
has "$(sline --state "$S" --now "$(at 0)")" "Primary refresh: primary: timed out: git merge --ff-only ran past 2 s" "T1: … the stuck read names a timed-out spell at once"
gone "$(cat "$HOOK_PID")" "T1: … the hook it ran is gone"
S="$tmp/s-t1b.json"; land t1b t1b; echo "[[x-rollout]] running on it" > "$HOLD_FILE"
job --state "$S" --now "$(at 0)" >/dev/null
rm -f "$HOLD_FILE" "$HOOK_PID"
has "$(job --state "$S" --now "$(at 5)" --ff-timeout 2)" "primary: timed out:" "T1: a spell held 5 minutes, then the hold clears and the merge hangs"
has "$(sline --state "$S" --now "$(at 5)")" "primary: timed out: git merge --ff-only ran past 2 s and was stopped: the working tree may be partly updated (git -C $tmp/primary status) (stuck since $(at 0 | cut -c1-16)" \
  "T1: … named at once, dated from the spell's start"
gone "$(cat "$HOOK_PID")" "T1: … the hook is gone"
job --state "$S" >/dev/null

# ---- T2: a TERM to a pass stops its live child -------------------------------------------------------------------------------
land t2 t2; rm -f "$HOOK_PID"
(cd "$tmp/out" && exec "${JOB[@]}" --state "$tmp/s-t2.json" > "$tmp/t2.out" 2>&1) & ppid=$!
i=0; while [ ! -s "$HOOK_PID" ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done
ok "$([ -s "$HOOK_PID" ] && echo started || echo 'not started in 30 s')" started "T2: the merge's post-merge hook started (the TERM lands mid-merge)"
t0=$SECONDS; kill -TERM "$ppid"; wait "$ppid"; rc=$?; dt=$((SECONDS - t0))
ok "$rc" 143 "T2: a TERM mid-merge: the pass exits 143"
ok "$([ "$dt" -le 7 ] && echo fast || echo "slow ${dt}s")" fast "T2: … within KILL_GRACE + 2 s"
gone "$(cat "$HOOK_PID")" "T2: … the hook it ran is gone"
has "$(cat "$tmp/t2.out")" "stopped by signal 15" "T2: … and says so"
rm -f "$tmp/primary/.git/hooks/post-merge"
has "$(job --state "$tmp/s-t2.json")" "primary: current" "T2: the next pass reads current"

# ---- K1: a corrupt state is one WARN, never a traceback, and rewritten valid ---------------------------------------------------
S="$tmp/s-k1.json"
for c in bytes list since5 sincex; do
  case $c in
    bytes) printf '\377\376{' > "$S" ;;
    list) echo '[]' > "$S" ;;
    since5) echo '{"v": 1, "stuck": {"x": {"since": 5}}}' > "$S" ;;
    sincex) echo '{"v": 1, "stuck": {"x": {"since": "x"}}}' > "$S" ;;
  esac
  out=$(job --state "$S")
  ok "$(printf '%s\n' "$out" | grep -c '^WARN: primary-refresh: state')|$(printf '%s\n' "$out" | grep -c Traceback)" "1|0" "K1 $c: one WARN, no traceback"
  has "$out" "primary: current" "K1 $c: … the pass completes"
  ok "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["v"], d["stuck"])' "$S")" "1 {}" "K1 $c: … and the state is rewritten valid"
done
# K1b: a stored self-update spell whose notifiedKinds is no list, on a pass whose fetch fails (so nothing touches it)
S="$tmp/s-k1b.json"
printf '{"v": 1, "stuck": {"self-update": {"since": "%s", "kind": "refused", "kindSince": "%s", "outcome": "x", "notifiedKinds": 5, "tip": "%s", "tipAt": "%s"}}}\n' \
  "$(at 0)" "$(at 0)" "$(tip)" "$(at 0)" > "$S"
g -C "$tmp/primary" remote set-url origin "$tmp/nowhere.git"
out=$(job --state "$S" --now "$(at 1500)")
lacks "$out" "Traceback" "K1b: a malformed notifiedKinds on a spell this pass never touched is no traceback"
lacks "$out" "WARN" "K1b: … and no WARN: an old notice field is never read"
ok "$(sv "$S" self-update notifiedKinds)|$(sv "$S" self-update since)" "5|$(at 0)" "K1b: … the entry kept as read"
has "$(sline --state "$S" --now "$(at 1500)")" "primary-refresh self-update: x (stuck since $(at 0 | cut -c1-16))" "K1b: … and the stuck read names it at 24 h"
g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"
# K1c: old notice fields, malformed or not, are never a reason to rewrite: a pass that changes nothing leaves the file as it was
S="$tmp/s-k1c.json"
printf '{"v": 1, "stuck": {"%s": {"since": "%s", "kind": "held", "kindSince": "%s", "outcome": "x", "notifiedKinds": 5, "notified": "not a time", "notifyFailed": 7, "notifyWhy": "w"}}}\n' \
  "$tmp/gone" "$(at 0)" "$(at 0)" > "$S"
cp -p "$S" "$tmp/k1c.before"
has "$(job --state "$S")" "primary: current" "K1c: (a pass that reads current)"
ok "$(same "$tmp/k1c.before" "$S")" same "K1c: … leaves a file holding old notify fields byte for byte"

# ---- L1: the log rotates at 1 MiB, never under --dry-run ------------------------------------------------------------------------
L="$tmp/big.log"; head -c 1048577 /dev/zero | tr '\0' x > "$L"
job --log "$L" --dry-run >/dev/null
ok "$(wc -c < "$L" | tr -d ' ')|$([ -e "$L.1" ] && echo rotated)" "1048577|" "L1: a --dry-run pass never rotates"
(cd "$tmp/out" && "${JOB[@]}" --log "$L" >> "$L" 2>&1)
ok "$(wc -c < "$L.1" | tr -d ' ')" 1048577 "L1: a log over 1 MiB moves to .1"
has "$(cat "$L")" "primary-refresh $tmp/primary: current" "L1: … and the pass writing to it carries on in a fresh log"
mkdir -p "$tmp/nolog"; rmdir "$tmp/nolog"
lacks "$(job --log "$tmp/nolog/x.log")" "Traceback" "L1: a missing log directory skips rotation"

# ---- J1: a job older than the copy is recorded, and named at 24 h -----------------------------------------------------------------
S="$tmp/s-j1.json"
has "$(job0 --state "$S" --now "$(at 0)")" "primary: job: the launchd job predates this copy (job shape 0, wants 1): re-run primary-refresh.py install and the launchctl line it prints" \
  "J1: the installed copy run without --job-shape logs the job line"
lacks "$(job0 --state "$S" --now "$(at 60)")" "job: the launchd job" "J1: … on its first pass only"
ok "$(sline --state "$S" --now "$(at 60)")" None "J1: … and the stuck read names nothing inside 24 h"
out=$(job0 --state "$S" --now "$(at 1440)")
lacks "$out" "job: the launchd job" "J1: no pass logs it again, a day on"
lacks "$out" "notif" "J1: … and nothing is sent"
ok "$(sline --state "$S" --now "$(at 1440)")" \
  "Primary refresh: primary-refresh job: the launchd job predates this copy (job shape 0, wants 1): re-run primary-refresh.py install and the launchctl line it prints (stuck since $(at 0 | cut -c1-16))" \
  "J1: the stuck read names the job at 24 h, with no git tail"
has "$(job --state "$S" --now "$(at 1500)")" "primary: job: current" "J1: a pass with the plist's argv clears it"
ok "$(skeys "$S")" "" "J1: … the spell gone"
has "$(job0 --state "$tmp/s-j1b.json" --dry-run)" "job: the launchd job predates" "J1: --dry-run only prints"
ok "$([ -e "$tmp/s-j1b.json" ] && echo written)" "" "J1: … and writes no state"
lacks "$(run --state "$tmp/s-j1c.json")" "job:" "J1: the checkout copy (no marker) never checks the job"

# ---- ST1-ST7: the stuck read (status's Primary refresh line): read-only, point in time --------------------------------------------
mkdir -p "$tmp/st"; S="$tmp/st/s-st.json"; rm -f "$S"
out=$(stk --state "$S"); rc=$?
ok "$rc|$(printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["stuck"], d["line"])')" "0|[] None" "ST1: an absent file reads no spell and a null line, exit 0"
ok "$([ -e "$S" ] && echo written)" "" "ST1: … and writes none"
seed() {  # seed <file> <key> <since> <kind> <outcome>: one entry
  python3 - "$@" <<'PY'
import json, sys
p, key, since, kind, outcome = sys.argv[1:]
try:
    d = json.load(open(p))
except (OSError, ValueError):
    d = {"v": 1, "stuck": {}}
d["stuck"][key] = {"since": since, "kind": kind, "kindSince": since, "outcome": outcome}
json.dump(d, open(p, "w"))
PY
}
seed "$S" "$tmp/primary" "$(at 0)" held "held: [[q-rollout]] running on it"
ok "$(sline --state "$S" --now "$(at 1380)")" None "ST2: a spell 23 h old is not named"
ok "$(sline --state "$S" --now "$(at 1500)")" "Primary refresh: primary: held: [[q-rollout]] running on it (stuck since $(at 0 | cut -c1-16); git -C $tmp/primary status)" \
  "ST2: … at 25 h it is, with its git tail"
S3="$tmp/s-st3.json"; rm -f "$S3"
seed "$S3" "$tmp/agents" "$(at 0)" timed-out "timed out: git merge --ff-only ran past 600 s and was stopped"
has "$(sline --state "$S3" --now "$(at 1)")" "Primary refresh: agents: timed out:" "ST3: a timed-out spell 1 minute old is named at once"
ok "$(sline --state "$S3" --now "$(at -60)")" None "ST3: … a since in the future is not due, timed-out or not"
# order and names: oldest first; self-update and job named as the copy's, no git tail; any other key as itself
seed "$S" self-update "$(at -600)" refused "origin's bundle at abc failed its smoke run (x): the installed copy is kept"
seed "$S" job "$(at -300)" stale-job "the launchd job predates this copy"
seed "$S" junk "$(at -100)" held "h"
ok "$(sline --state "$S" --now "$(at 1500)")" \
  "Primary refresh: primary-refresh self-update: origin's bundle at abc failed its smoke run (x): the installed copy is kept (stuck since $(at -600 | cut -c1-16)) · primary-refresh job: the launchd job predates this copy (stuck since $(at -300 | cut -c1-16)) · junk: h (stuck since $(at -100 | cut -c1-16)) · primary: held: [[q-rollout]] running on it (stuck since $(at 0 | cut -c1-16); git -C $tmp/primary status)" \
  "ST3: spells oldest first, joined with ' · '; the copy's own named as such with no git tail; a junk key named as itself"
ok "$(stk --state "$S" --now "$(at 1500)" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(d), [s["key"] for s in d["stuck"]], sorted(d["stuck"][0]))')" \
  "['line', 'state', 'stuck'] ['self-update', 'job', 'junk', '$tmp/primary'] ['key', 'kind', 'name', 'outcome', 'since']" \
  "ST7: the JSON's keys are exactly state, stuck and line, each spell {key, name, kind, since, outcome}"
S4="$tmp/s-st4.json"; printf '{not json' > "$S4"
out=$(stk --state "$S4" --now "$(at 1500)"); rc=$?
ok "$rc|$(printf '%s\n' "$out" | grep -c '^WARN: ')|$(printf '%s\n' "$out" | grep -c Traceback)" "0|1|0" "ST4: a corrupt file is one WARN, no traceback, exit 0"
has "$out" '"line": null' "ST4: … and a null line"
ok "$(cat "$S4")" "{not json" "ST4: … the file left as it was"
out=$(stk --state "$S" --now yesterday); rc=$?
ok "$rc" 2 "ST5: a bad --now exits 2"
has "$out" "ERROR: primary-refresh stuck: usage: --now 'yesterday' is not an ISO timestamp" "ST5: … with a usage ERROR"
out=$(run --ntfy-server x --state "$tmp/s-st5.json"); rc=$?
ok "$rc" 2 "ST5: run --ntfy-server is no longer an option (exit 2)"
cp -p "$S" "$tmp/st6.before"; ls -a "$(dirname "$S")" > "$tmp/st6.ls.before"
stk --state "$S" --now "$(at 1500)" >/dev/null
ok "$(same "$tmp/st6.before" "$S")" same "ST6: stuck leaves the state file byte for byte"
ls -a "$(dirname "$S")" > "$tmp/st6.ls.after"
ok "$(same "$tmp/st6.ls.before" "$tmp/st6.ls.after")" same "ST6: … and no temp file beside it"
S7="$tmp/s-st7.json"; rm -f "$S7"
old=$(python3 -c 'import datetime as d; print((d.datetime.now().astimezone() - d.timedelta(days=30)).isoformat(timespec="seconds"))')
seed "$S7" "$tmp/agents" "$old" diverged "diverged (ahead 1, behind 9): never integrated here"
touch -t "$(python3 -c 'import datetime as d; print((d.datetime.now() - d.timedelta(days=30)).strftime("%Y%m%d%H%M"))')" "$S7"
has "$(sline --state "$S7")" "Primary refresh: agents: diverged (ahead 1, behind 9): never integrated here (stuck since ${old:0:16}" \
  "ST7: a 30-day-old spell in a file last written 30 days ago is still named: no window, no freshness check"
grep -q "no freshness check" "$pr"; ok "$?" 0 "ST7: the docstring says the read has no freshness check"

# ---- F1 / B1 / D1: the fetch -----------------------------------------------------------------------------------------------------
git -C "$tmp/primary" update-ref refs/remotes/origin/feat HEAD; g -C "$tmp/seed" push -q origin HEAD:refs/heads/feat/x 2>/dev/null
land f1 f1
out=$(job)
lacks "$out" "fetch failed" "F1: a stale origin/feat against origin's feat/x is no fetch failure (one branch fetched)"
has "$out" "primary: moved" "F1: … the primary moves"
git -C "$tmp/primary" update-ref -d refs/remotes/origin/feat; g -C "$tmp/seed" push -q origin :refs/heads/feat/x 2>/dev/null
g -C "$tmp/primary" remote set-url origin git@github.com:o/origin.git; land b1 b1; : > "$LOG_SSH"
has "$(job)" "primary: moved" "B1: an ssh origin fetches"
has "$(cat "$LOG_SSH")" "-o BatchMode=yes" "B1: … with -o BatchMode=yes, the operator having set no ssh command"
git -C "$tmp/primary" config core.sshCommand "$tmp/sshbin/ssh"; land b1b b1b; : > "$LOG_SSH"
has "$(job)" "primary: moved" "B1: with the primary's core.sshCommand set it fetches"
ok "$(grep -c . "$LOG_SSH")|$(grep -c BatchMode "$LOG_SSH")" "1|0" "B1: … through it, never BatchMode"
git -C "$tmp/primary" config --unset core.sshCommand; g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"
git -C "$tmp/primary" remote set-head origin -d; land d1 d1
out=$(job)
has "$out" "primary: moved" "D1: origin/HEAD deleted: master is read locally, and the pass moves"
git -C "$tmp/primary" update-ref -d refs/remotes/origin/master; g -C "$tmp/primary" remote set-url origin "$tmp/nowhere.git"
out=$(job)
has "$out" "primary: fetch failed: cannot resolve origin's default branch" "D1: no default branch to read, origin unreachable: fetch failed"
lacks "$out" "busy" "D1: … never busy"
g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"; git -C "$tmp/primary" fetch -q origin; git -C "$tmp/primary" remote set-head origin master
has "$(job)" "primary: current" "D1: (restored)"

# ---- O1 / O2: the overlap -----------------------------------------------------------------------------------------------------------
printf 'x\n' > "$tmp/seed/my file.txt"; printf 'x\n' > "$tmp/seed/café.txt"; commit "o1"
echo mine > "$tmp/primary/my file.txt"; echo mine > "$tmp/primary/café.txt"; rm -f "$tmp/primary/.git/ORIG_HEAD"
has "$(job)" "primary: refused: local changes overlap origin/master (café.txt, my file.txt)" "O1: a space and a non-ASCII name, named unquoted"
job >/dev/null
ok "$([ -e "$tmp/primary/.git/ORIG_HEAD" ] && echo written)" "" "O1: … and after two passes ORIG_HEAD was never written"
echo "[[x-rollout]] running on it" > "$HOLD_FILE"
has "$(job)" "primary: held: [[x-rollout]] running on it" "O2: held and an overlap reads held: the hold is read first"
rm -f "$HOLD_FILE" "$tmp/primary/my file.txt" "$tmp/primary/café.txt"
has "$(job)" "primary: moved" "O1: (cleared)"

# ---- X1: the helper's contract: anything it does not promise is broken, never current or moved -----------------------------------
B="$tmp/bin/$LCR"; export REAL_LC="$tmp/primary/$LCR" CHECK_MARK="$tmp/check.mark"
stub() {
  cat > "$B" <<'EOF'
#!/usr/bin/env bash
case "$1:${STUB:-}" in
  check:hello) : > "$CHECK_MARK"; echo hello; exit 0 ;;
  check:exit1) : > "$CHECK_MARK"; exit 1 ;;
  ff:lie) echo "moved $(git -C "$2" rev-parse HEAD) $(git -C "$2" rev-parse "refs/remotes/origin/$3")"; exit 0 ;;
  fetch:fail) echo "fatal: x" >&2; exit 1 ;;
  check:*) : > "$CHECK_MARK" ;;
esac
exec bash "$REAL_LC" "$@"
EOF
  chmod 0755 "$B"
}
S="$tmp/s-x1.json"
for c in hello exit1 lie fail; do
  land "x1-$c" "$c"; stub; rm -f "$CHECK_MARK"; before=$(head_of "$tmp/primary")
  out=$(STUB=$c job --state "$S")
  case $c in
    hello) has "$out" "primary: broken: live-checkout.sh check: unrecognised output \"hello\"" "X1 (a): a check that prints hello reads broken" ;;
    exit1) has "$out" "primary: broken: live-checkout.sh check: exit 1" "X1 (b): a check that exits 1 with no output reads broken" ;;
    lie) has "$out" "primary: broken: live-checkout.sh ff: said moved to $(tip | cut -c1-12), HEAD is ${before:0:12}" "X1 (c): an ff that says moved without moving reads broken" ;;
    fail) has "$out" "primary: fetch failed: fatal: x" "X1 (d): a fetch that exits 1 reads fetch failed"
          ok "$([ -e "$CHECK_MARK" ] && echo ran)" "" "X1 (d): … and nothing after it runs on the stale refs" ;;
  esac
  ok "$(head_of "$tmp/primary")" "$before" "X1 $c: HEAD unmoved"
  lacks "$out" "primary: current" "X1 $c: … no line reads current"
  lacks "$out" "primary: moved" "X1 $c: … nor moved"
  case $c in fail) want=fetch-failed ;; *) want=broken ;; esac
  ok "$(sv "$S" "$tmp/primary" kind)" "$want" "X1 $c: … the spell's kind is $want"
  if [ "$c" = fail ]; then
    lacks "$out" "self-update" "X1 (d): no fetch, no self-update"
    cp -p "$root/$LCR" "$B"
  else
    has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed $LCR)" "X1 $c: … and the same pass's self-update restores the real helper"
  fi
  ok "$(same "$root/$LCR" "$B")|$(mode_of "$B")" "same|0755" "X1 $c: … the helper is the real one again"
done
has "$(job --state "$S")" "primary: moved" "X1: (healed, the primary moves)"

# ---- S1-S5: the installed copy updates itself through its smoke run -------------------------------------------------------------------
newer() { echo "$1" >> "$tmp/seed/$SELF"; commit "$1"; }
newer "# a newer refresh"
out=$(job)
has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed primary-refresh.py)" "S1: origin's committed script is staged, smoked and installed"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# a newer refresh" "S1: … with its content"
ok "$(ls -a "$tmp/bin" | grep -c '^\.stage-')" 0 "S1: … and no stage is left behind"
newer "# moved by another route"
g -C "$tmp/primary" fetch -q origin && g -C "$tmp/primary" merge -q --ff-only origin/master
out=$(job)
has "$out" "primary: current" "S2: a primary another route moved reads current"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S2: … and the copy still catches up"
echo "# half-written, uncommitted" >> "$tmp/primary/$SELF"
job >/dev/null
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S3: an uncommitted edit in the primary never reaches the copy"
g -C "$tmp/primary" checkout -q -- "$SELF"
newer "def broken(:"
out=$(job)
has "$out" "does not compile" "S3: a committed script that does not compile is refused"
ok "$(tail -1 "$tmp/bin/primary-refresh.py")" "# moved by another route" "S3: … and the copy is kept"
g -C "$tmp/seed" revert --no-edit HEAD >/dev/null 2>&1; g -C "$tmp/seed" push -q origin master 2>/dev/null
out=$(job)
lacks "$out" "self-update" "S3: a revert back to the script the copy runs is current: no line"
ok "$(skeys "$XDG_STATE_HOME/thread/primary-refresh.json")" "" "S3: … and the refusal's spell is cleared"
# S4: fetch first: a primary whose origin ref is stale and whose fetch fails never self-updates from the stale ref
old=$(git -C "$tmp/seed" rev-parse HEAD~4)
g -C "$tmp/primary" reset -q --hard "$old"; git -C "$tmp/primary" update-ref refs/remotes/origin/master "$old"
g -C "$tmp/primary" remote set-url origin "$tmp/nowhere.git"; before=$(shasum < "$tmp/bin/primary-refresh.py")
out=$(job)
has "$out" "primary: fetch failed:" "S4: an unreachable origin reads fetch failed"
lacks "$out" "self-update" "S4: … with no self-update line"
ok "$(shasum < "$tmp/bin/primary-refresh.py")" "$before" "S4: … and the copy is unchanged"
g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"
out=$(job)
has "$out" "primary: moved" "S4: once origin answers the pass fetches its real tip and moves"
lacks "$out" "self-update" "S4: … whose bundle is the copy's: no smoke, no line"
ok "$(shasum < "$tmp/bin/primary-refresh.py")" "$before" "S4: … and the copy is unchanged"
# S5: only the copy install placed rewrites itself
mkdir -p "$tmp/cache/9.9.9"; cp "$pr" "$tmp/cache/9.9.9/primary-refresh.py"
(cd "$tmp/out" && python3 "$tmp/cache/9.9.9/primary-refresh.py" run --primary "$tmp/primary" --state "$tmp/s-s5.json" >/dev/null 2>&1)
ok "$(same "$pr" "$tmp/cache/9.9.9/primary-refresh.py")" same "S5: a copy outside git with no install marker (a version cache) is never rewritten"
g init -q "$tmp/devtree"; mkdir -p "$tmp/devtree/s"; cp "$pr" "$tmp/devtree/s/primary-refresh.py"
(cd "$tmp/out" && python3 "$tmp/devtree/s/primary-refresh.py" run --primary "$tmp/primary" --state "$tmp/s-s5.json" >/dev/null 2>&1)
ok "$(same "$pr" "$tmp/devtree/s/primary-refresh.py")" same "S5: nor is a copy inside a git work tree (a checkout's own script)"
real; commit "real again"; job >/dev/null
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")" same "S5: (the copy is this tree's script again)"

# ---- S6a-S6d: a candidate that fails its smoke run is refused once per tip, and reported at 24 h ---------------------------------------
S="$tmp/s-s6.json"; export SMOKE_MARK="$tmp/smoke.mark"; : > "$SMOKE_MARK"
edit "$SELF" 'def main(argv=None):' 'if "bundle" not in sys.argv:
    if os.environ.get("SMOKE_MARK"):
        open(os.environ["SMOKE_MARK"], "a").write("x\n")
    raise RuntimeError("s6a: broken at run time")


def main(argv=None):'
commit s6a; t6a=$(tip | cut -c1-12)
out=$(job --state "$S" --now "$(at 0)")
has "$out" "self-update: origin's bundle at $t6a failed its smoke run (exit 1: RuntimeError: s6a: broken at run time): the installed copy is kept" "S6a: a candidate that raises at run time is refused by its smoke run"
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")|$(grep -c . "$SMOKE_MARK")" "same|1" "S6a: … the copy unchanged, the candidate run once"
ok "$(sv "$S" self-update kind)|$(sv "$S" self-update tip | cut -c1-12)" "refused|$t6a" "S6a: … the self-update spell records the refused tip"
lacks "$(job --state "$S" --now "$(at 60)")" "self-update" "S6a: a second pass on the same tip prints no self-update line"
ok "$(grep -c . "$SMOKE_MARK")" 1 "S6a: … and smokes nothing"
real; edit "$SELF" '    me = Path(__file__).resolve()
    t12 = tip[:12]
    rc, src, _ = git(' '    raise RuntimeError("s6b")
    me = Path(__file__).resolve()
    t12 = tip[:12]
    rc, src, _ = git('
commit s6b; t6b=$(tip | cut -c1-12)
has "$(job --state "$S" --now "$(at 120)")" "self-update: origin's bundle at $t6b failed its smoke run (no self-update: current line)" "S6b: a candidate whose self_update raises is refused"
real; edit "$SELF" '    if frc != 0:' '    if frc == 0:'
commit s6c; t6c=$(tip | cut -c1-12)
out=$(job --state "$S" --now "$(at 180)")
has "$out" "self-update: origin's bundle at $t6c failed its smoke run (fetch failed: exit 0)" "S6c: a candidate whose fetch parse is broken is refused, though the parent's fetch passed"
has "$out" "primary: moved" "S6c: … (the parent's own pass moved)"
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")" same "S6c: … the copy unchanged"
job --state "$S" --now "$(at 1380)" >/dev/null
ok "$(sline --state "$S" --now "$(at 1380)")" None "S6d: a refusal standing since+23h is not named"
lacks "$(job --state "$S" --now "$(at 1440)")" "notif" "S6d: … at since+24h no pass notifies"
ok "$(sline --state "$S" --now "$(at 1440)")" "Primary refresh: primary-refresh self-update: origin's bundle at $t6c failed its smoke run (fetch failed: exit 0): the installed copy is kept (stuck since $(at 0 | cut -c1-16))" \
  "S6d: … and the stuck read names the bundle and the spell's start"
real; edit "$SELF" '    if frc != 0:' '    if frc == 0:'; echo "# s6d, a second refused tip" >> "$tmp/seed/$SELF"; commit s6d
has "$(job --state "$S" --now "$(at 1500)")" "failed its smoke run" "S6d: a second refused tip in the spell is refused"
ok "$(sv "$S" self-update since)" "$(at 0)" "S6d: … and the spell keeps its since"
real; echo "# s6d fixed" >> "$tmp/seed/$SELF"; commit "s6d fixed"
has "$(job --state "$S" --now "$(at 1680)")" "self-update: the installed bundle now matches" "S6d: a fixed bundle installs"
ok "$(sv "$S" self-update kind)" None "S6d: … and the self-update entry is removed"
unset SMOKE_MARK
real; commit "real again"; job >/dev/null

# ---- S6e / S6f: the smoke fetches for real, through the candidate's own helper ------------------------------------------------------------
S="$tmp/s-s6e.json"
edit "$LCR" '"+refs/heads/${2:-}:refs/remotes/origin/${2:-}"' '"+refs/heads/nope-${2:-}:refs/remotes/origin/${2:-}"'
commit s6e; t6e=$(tip | cut -c1-12)
out=$(job --state "$S")
has "$out" "self-update: origin's bundle at $t6e failed its smoke run (fetch failed: fatal: couldn't find remote ref refs/heads/nope-master)" "S6e: a staged helper whose fetch fails refuses the candidate"
has "$out" "primary: moved" "S6e: … while the parent, on the installed helper, moves"
ok "$(same "$root/$LCR" "$B")" same "S6e: … and the installed helper is kept"
real; commit "real again"; job --state "$S" >/dev/null
cat > "$tmp/countbin/ssh" <<EOF
#!/usr/bin/env bash
n=\$(( \$(cat "\$SSH_COUNT" 2>/dev/null || echo 0) + 1 )); echo \$n > "\$SSH_COUNT"
[ "\$n" -le "\${SSH_OK:-1}" ] || { echo "count-ssh: connection \$n refused" >&2; exit 255; }
exec "$tmp/sshbin/ssh" "\$@"
EOF
chmod +x "$tmp/countbin/ssh"; export SSH_COUNT="$tmp/ssh.count"
g -C "$tmp/primary" remote set-url origin git@github.com:o/origin.git
S="$tmp/s-s6f.json"; echo "# s6f" >> "$tmp/seed/$SELF"; commit s6f; t6f=$(tip | cut -c1-12)
rm -f "$SSH_COUNT"; out=$(PATH="$tmp/countbin:$PATH" SSH_OK=1 job --state "$S" --now "$(at 0)")
has "$out" "primary: moved" "S6f: origin over ssh: the parent's fetch passes"
has "$out" "self-update: origin's bundle at $t6f failed its smoke run (fetch failed: " "S6f: … the smoke's own fetch fails, so the candidate is refused"
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")|$(sv "$S" self-update kind)" "same|refused" "S6f: … the copy unchanged, the spell refused"
rm -f "$SSH_COUNT"; out=$(PATH="$tmp/countbin:$PATH" SSH_OK=1 job --state "$S" --now "$(at 60)")
lacks "$out" "self-update" "S6f: the next pass on the same tip smokes nothing"
ok "$(cat "$SSH_COUNT")" 1 "S6f: … its one connection the parent's fetch"
rm -f "$SSH_COUNT"; out=$(PATH="$tmp/countbin:$PATH" SSH_OK=2 job --state "$S" --now "$(at 1440)")
has "$out" "self-update: the installed bundle now matches origin/master at $t6f" "S6f: at tipAt+24h, origin answering, it smokes again and installs"
ok "$(sv "$S" self-update kind)" None "S6f: … and the spell is cleared"
g -C "$tmp/primary" remote set-url origin "$tmp/origin.git"
real; commit "real again"; job >/dev/null

# ---- S6g / S6h: the smoke runs the job's own argv --------------------------------------------------------------------------------------
S="$tmp/s-s6g.json"
edit "$SELF" '    r.add_argument("--job-shape", type=int, default=0, help="the shape install wrote into the job (absent: 0)")
' ''
commit s6g; t6g=$(tip | cut -c1-12)
out=$(job --state "$S")
has "$out" "self-update: origin's bundle at $t6g failed its smoke run (exit 2: primary-refresh.py: error: unrecognized arguments: --job-shape 1)" \
  "S6g: a candidate whose parser drops --job-shape, which the plist passes, is refused"
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")" same "S6g: … the copy unchanged"
real; edit "$SELF" 'def cmd_run(args):
    global _STAMP
' 'def cmd_run(args):
    global _STAMP
    if os.environ.get("SMOKE_ARGV"):
        open(os.environ["SMOKE_ARGV"], "wb").write("\0".join(sys.argv[1:]).encode())
'
commit s6h; export SMOKE_ARGV="$tmp/argv"
has "$(job)" "self-update: the installed bundle now matches" "S6h: a candidate that records its argv passes its smoke"
argv_is() { python3 -c 'import sys; print(" ".join(open(sys.argv[1], "rb").read().decode().split("\0")))' "$SMOKE_ARGV"; }
got=$(argv_is); stage=$(printf '%s\n' "$got" | sed -n 's|.* --log \([^ ]*\)/smoke\.log .*|\1|p')
has "$stage" "$tmp/bin/.stage-" "S6h: (the stage is beside the copy)"
ok "$got" "${JOB[*]:2:5} --log $stage/smoke.log --job-shape 1 --state $stage/smoke-state.json --dry-run" \
  "S6h: … its argv is the plist's own, --log replaced in place, --state and --dry-run added, nothing else changed"
echo "# s6h, with --now" >> "$tmp/seed/$SELF"; commit "s6h now"
job --now 2026-11-12T10:00:00+11:00 >/dev/null
got=$(argv_is); stage=$(printf '%s\n' "$got" | sed -n 's|.* --log \([^ ]*\)/smoke\.log .*|\1|p')
ok "$got" "${JOB[*]:2:5} --log $stage/smoke.log --job-shape 1 --now 2026-11-12T10:00:00+11:00 --state $stage/smoke-state.json --dry-run" \
  "S6h: a run with --now carries the pass's stamp in its place"
unset SMOKE_ARGV; real; commit "real again"; job >/dev/null
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")" same "S6h: (the copy is this tree's script again)"

# ---- S6i: a smoke stopped at its bound stops what its candidate started -----------------------------------------------------------------
S="$tmp/s-s6i.json"
edit "$LCR" '    default)
      [ $# -eq 2 ]' '    default)
      if [ -n "${HANG_PIDS:-}" ]; then sleep 600 & echo "$$ $!" > "$HANG_PIDS"; wait; fi
      [ $# -eq 2 ]'
commit s6i; t6i=$(tip | cut -c1-12); rm -f "$tmp/hang.pids"
t0=$SECONDS; out=$(HANG_PIDS="$tmp/hang.pids" job --state "$S" --smoke-timeout 3); dt=$((SECONDS - t0))
has "$out" "primary: moved" "S6i: the parent's pass, on the installed helper, is unaffected"
has "$out" "self-update: origin's bundle at $t6i failed its smoke run (ran past 3 s and was stopped)" "S6i: a candidate whose staged helper hangs is stopped at --smoke-timeout"
ok "$([ "$dt" -le 15 ] && echo bounded || echo "slow ${dt}s")" bounded "S6i: … the pass done within 3 + SMOKE_GRACE + 2 s"
ok "$(wc -w < "$tmp/hang.pids" 2>/dev/null | tr -d ' ')" 2 "S6i: the candidate's helper recorded itself and its sleep"
for p in $(cat "$tmp/hang.pids"); do gone "$p" "S6i: … the candidate's helper and its sleep are gone ($p)"; done
ok "$(same "$root/$LCR" "$B")" same "S6i: … and the installed helper is unchanged"
real; echo "# s6i fixed" >> "$tmp/seed/$LCR"; commit "s6i fixed"
has "$(job --state "$S")" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed $LCR)" "S6i: a fixed tip then installs"
real; commit "real again"; job >/dev/null

# ---- S6j: a candidate whose own background_job.py is broken is refused, though the held primary's is good --------------
# The primary is held, so it keeps the good module: a load that fell back to it on a broken file would pass this smoke
# (held: is no denied outcome) and install the broken file into the bin.
S="$tmp/s-s6j.json"; BJR=skills/_shared/scripts/background_job.py; echo "[[x-rollout]] running on it" > "$HOLD_FILE"
echo 'raise RuntimeError("s6j")' >> "$tmp/seed/$BJR"; commit s6j; t6j=$(tip | cut -c1-12)
out=$(job --state "$S")
has "$out" "primary: held: [[x-rollout]] running on it" "S6j: the primary is held, so it is not moved"
ok "$(same "$root/$BJR" "$tmp/primary/$BJR")" same "S6j: … and keeps the good background_job.py (the arm's precondition)"
has "$out" "self-update: origin's bundle at $t6j failed its smoke run (exit 1: ERROR: primary-refresh run: cannot load skills/_shared/scripts/backgroun): the installed copy is kept" \
  "S6j: the candidate's own broken module is its ERROR, never the primary's good one, so the smoke refuses it"
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")|$(same "$root/$BJR" "$tmp/bin/$BJR")" "same|same" "S6j: … the copy and the bin's module unchanged"
ok "$(sv "$S" self-update kind)" refused "S6j: … the self-update spell refused"
rm -f "$HOLD_FILE"; real; commit "real again"; job >/dev/null

# ---- S7 / S8 / S9: the transition, a held primary, and an install that fails partway --------------------------------------------------
rm -rf "$tmp/bin/skills"; land s7 s7
out=$(job)
has "$out" "primary: moved" "S7: a copy with no helpers beside it runs the primary's live-checkout.sh"
has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed $(cut -d' ' -f3 "$tmp/table" | sed 1d | paste -sd, - | sed 's/,/, /g'))" \
  "S7: … then installs every bundle file"
bad=; while read -r m rel irel; do [ "$(same "$root/$rel" "$tmp/bin/$irel")|$(mode_of "$tmp/bin/$irel")" = "same|$m" ] || bad="$bad $irel"; done < "$tmp/table"
ok "${bad:-none}" none "S7: … each with its parents made and its mode"
echo "[[x-rollout]] running on it" > "$HOLD_FILE"; land s8 s8; echo "# s8" >> "$tmp/seed/$SELF"; commit s8
out=$(job)
has "$out" "primary: held:" "S8: a held primary behind origin"
has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12)" "S8: … still self-updates"
rm -f "$HOLD_FILE"; real; commit "real again"; job >/dev/null
S="$tmp/s-s9.json"; export SMOKE_MARK="$tmp/smoke9.mark"; : > "$SMOKE_MARK"
real; edit "$SELF" 'def cmd_run(args):
    global _STAMP
' 'def cmd_run(args):
    global _STAMP
    if os.environ.get("SMOKE_MARK"):
        open(os.environ["SMOKE_MARK"], "a").write("x\n")
'
commit s9; L9="$tmp/bin/skills/_shared/scripts/ladder.py"; rm -f "$L9"; mkdir -p "$L9/x"
out=$(job --state "$S")
has "$out" "self-update: installed 0 of 2 files, then skills/_shared/scripts/ladder.py failed (" "S9: a directory where ladder.py goes stops the install partway"
ok "$(sv "$S" self-update kind)|$(grep -c . "$SMOKE_MARK")|$(same "$pr" "$tmp/bin/primary-refresh.py")" "install-failed|1|same" "S9: … install-failed, smoked once, the old copy kept (it goes last)"
rm -rf "$L9"
out=$(job --state "$S")
has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed skills/_shared/scripts/ladder.py, primary-refresh.py)" "S9: once it is removed the next pass finishes the install"
ok "$(grep -c . "$SMOKE_MARK")|$(sv "$S" self-update kind)" "1|None" "S9: … with no second smoke, and the entry cleared"
unset SMOKE_MARK; real; commit "real again"; job >/dev/null

# ---- S10a-S10c: the candidate's own table -------------------------------------------------------------------------------------------------
X="skills/_shared/scripts/extra.txt"; addrow() { edit "$SELF" '    ("0644", "skills/_shared/scripts/ladder.py", "skills/_shared/scripts/ladder.py"),
)' '    ("0644", "skills/_shared/scripts/ladder.py", "skills/_shared/scripts/ladder.py"),
    ("0644", "skills/_shared/scripts/extra.txt", "skills/_shared/scripts/extra.txt"),
)'; }
addrow; echo extra > "$tmp/seed/$X"; chmod 0644 "$tmp/seed/$X"; commit s10a
out=$(job)
has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed $X, primary-refresh.py)" "S10a: a file the candidate's table adds is staged, smoked and installed"
ok "$(cat "$tmp/bin/$X")|$(mode_of "$tmp/bin/$X")" "extra|0644" "S10a: … with its content and the table's mode"
lacks "$(job)" "self-update" "S10a: the next pass: the script equal and every row matching, no line"
echo other > "$tmp/bin/other.txt"
real; git -C "$tmp/seed" rm -q "$X"; commit s10b
out=$(job)
has "$out" "self-update: the installed bundle now matches origin/master at $(tip | cut -c1-12) (installed primary-refresh.py; removed $X)" "S10b: a file the candidate drops is removed"
ok "$([ -e "$tmp/bin/$X" ] && echo there)|$(cat "$tmp/bin/other.txt")" "|other" "S10b: … gone, and a file in no table is untouched"
addrow; echo extra > "$tmp/seed/$X"; echo "# s10b2" >> "$tmp/seed/$SELF"; commit s10b2; job >/dev/null
ok "$(cat "$tmp/bin/$X" 2>/dev/null)" extra "S10b: (the row back)"
S="$tmp/s-s10.json"; export SMOKE_MARK="$tmp/smoke10.mark"; : > "$SMOKE_MARK"
real; edit "$SELF" 'def cmd_run(args):
    global _STAMP
' 'def cmd_run(args):
    global _STAMP
    if os.environ.get("SMOKE_MARK"):
        open(os.environ["SMOKE_MARK"], "a").write("x\n")
'
git -C "$tmp/seed" rm -q "$X"; commit s10b3
rm -f "$tmp/bin/$X"; mkdir -p "$tmp/bin/$X/sub"; : > "$tmp/bin/$X/sub/f"
out=$(job --state "$S")
has "$out" "self-update: installed 0 of 2 files, then $X failed (" "S10b: an unlink that fails reads install-failed"
ok "$(sv "$S" self-update kind)|$(grep -c . "$SMOKE_MARK")" "install-failed|1" "S10b: … after one smoke"
rm -rf "$tmp/bin/$X"
has "$(job --state "$S")" "self-update: the installed bundle now matches" "S10b: fixed, the next pass finishes it"
ok "$(grep -c . "$SMOKE_MARK")|$(sv "$S" self-update kind)" "1|None" "S10b: … with no second smoke"
unset SMOKE_MARK; real; commit "real again"; job >/dev/null
S="$tmp/s-s10c.json"
snap() { (cd "$tmp" && find bin x -type f 2>/dev/null | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(shasum < "$f")"; done); }
for c in dotdot nocopy; do
  real
  case $c in
    dotdot) edit "$SELF" '    ("0644", "skills/_shared/scripts/ladder.py", "skills/_shared/scripts/ladder.py"),
)' '    ("0644", "skills/_shared/scripts/ladder.py", "skills/_shared/scripts/ladder.py"),
    ("0644", "../x", "../x"),
)' ;;
    nocopy) edit "$SELF" '    ("0755", SELF_REL, COPY),
' '' ;;
  esac
  commit "s10c $c"; before=$(snap)
  has "$(job --state "$S")" "self-update: the candidate's bundle table is unreadable (" "S10c $c: a bad table is refused"
  ok "$(snap)" "$before" "S10c $c: … and nothing outside the stage is written"
done
real; commit "real again"; job >/dev/null
ok "$(same "$pr" "$tmp/bin/primary-refresh.py")" same "S10c: (the copy is this tree's script again)"

# ---- I6: the frozen self-update contract ---------------------------------------------------------------------------------------------------
# An installed copy in the field sends every candidate exactly these tokens and reads exactly these lines back. They are
# literal here on purpose, never read from the code: a change to any of them strands every installed copy (ADR 0066's
# 2026-11-05 amendment), so it must be made here too, with an ADR note and a re-install step.
out=$(cd "$tmp/out" && python3 "$tmp/bin/primary-refresh.py" run --primary "$tmp/primary" --state "$tmp/s-i6.json" --log "$tmp/i6.log" --now 2026-11-20T10:00:00+11:00 --dry-run 2>&1)
has "$out" "2026-11-20T10:00:00+11:00 primary-refresh $tmp/primary: current" "I6: run --primary --state --log --now --dry-run: an '<ISO> primary-refresh <P>: <outcome>' line"
has "$out" "primary-refresh $tmp/primary: self-update: current" "I6: … and an installed copy's 'self-update: current' line"
out=$(python3 "$tmp/bin/primary-refresh.py" bundle)
ok "$(printf '%s\n' "$out" | grep -cvE '^0[0-7]{3} [A-Za-z0-9._/-]+ [A-Za-z0-9._/-]+$')" 0 "I6: bundle prints '<mode> <repo-rel> <install-rel>' lines"
has "$out" "0755 skills/_shared/scripts/primary-refresh.py primary-refresh.py" "I6: … the copy's own row among them"

# ---- I2 / I3: install's interpreter, PATH and printed line -------------------------------------------------------------------------------
rc=$(python3 - "$pr" "$tmp/primary" "$tmp/bin3" <<'PY' 2>/dev/null
import runpy, sys
sys.version_info = (3, 10, 0)
sys.argv = [sys.argv[1], "install", "--primary", sys.argv[2], "--bin-dir", sys.argv[3], "--plist", sys.argv[3] + "/j.plist"]
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
except SystemExit as e:
    print(e.code)
PY
)
ok "$rc|$([ -e "$tmp/bin3" ] && echo wrote)" "2|" "I2: install on a python older than 3.11 exits 2, writing nothing"
mkdir -p "$tmp/a b"
out=$(python3 "$pr" install --primary "$tmp/primary" --bin-dir "$tmp/bin2" --plist "$tmp/a b/job.plist" --log "$tmp/job2.log" 2>&1)
py=$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["ProgramArguments"][0])' "$tmp/a b/job.plist")
has "$out" "the job runs $py" "I3: install says which python the job runs"
want=$(python3 - "$py" "$(command -v git)" <<'PY'
import os, sys
out = []
for d in (os.path.dirname(sys.argv[2]), os.path.dirname(sys.argv[1]), "/usr/bin", "/bin", "/usr/sbin", "/sbin"):
    if d and d not in out:
        out.append(d)
print(":".join(out))
PY
)
ok "$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["EnvironmentVariables"]["PATH"])' "$tmp/a b/job.plist")" "$want" \
  "I3: the job's PATH is git's directory, python's, then the system's, de-duplicated"
has "$out" "launchctl bootout gui/$(id -u)/com.thread.primary-refresh 2>/dev/null; while launchctl print gui/$(id -u)/com.thread.primary-refresh >/dev/null 2>&1; do sleep 1; done; launchctl bootstrap gui/$(id -u) '$tmp/a b/job.plist'" \
  "I3: the printed line waits for the bootout, and quotes a plist path with a space"

# ---- Q1-Q4: install drops the spells of checkouts the job does not watch; a pass never prunes ------------------------------
# The default state file is the job's (the plist names no --state); I3's install above is the last that touched it, and no
# arm after this one reads it.
qseed() {
  python3 - "$DS" "$tmp" "$(at 0)" <<'PY'
import json, os, sys
p, t, since = sys.argv[1:]
e = lambda kind, **x: dict({"since": since, "kind": kind, "kindSince": since, "outcome": kind}, **x)
d = {"v": 1, "stuck": {f"{t}/primary": e("held"), f"{t}/agents": e("diverged", notified=since, notifiedKinds=["diverged"]),
                       "self-update": e("refused"), "job": e("stale-job"), f"{t}/gone": e("busy")}}
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(d, open(p, "w"))
PY
}
entry() { python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["stuck"].get(sys.argv[2]), sort_keys=True))' "$1" "$2"; }
qseed; for k in "$tmp/primary" "$tmp/agents" self-update job; do entry "$DS" "$k"; done > "$tmp/q1.kept.before"
out=$(python3 "$pr" install --primary "$tmp/primary" --also "$tmp/agents" --bin-dir "$tmp/binq" --plist "$tmp/q.plist" --log "$tmp/q.log" 2>&1)
ok "$(skeys "$DS")" "$(printf '%s\n' "$tmp/agents" "$tmp/primary" job self-update | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" \
  "Q1: install keeps the spells of the checkouts it watches, self-update and job, and drops the rest"
has "$out" "primary-refresh install: dropped spell: $tmp/gone (not watched by this job)" "Q1: … one line per dropped spell"
ok "$(printf '%s\n' "$out" | grep -c 'dropped spell:')" 1 "Q1: … and only that one"
for k in "$tmp/primary" "$tmp/agents" self-update job; do entry "$DS" "$k"; done > "$tmp/q1.kept.after"
ok "$(same "$tmp/q1.kept.before" "$tmp/q1.kept.after")" same "Q1: … each kept entry exactly as seeded, an old notified field included"
has "$(printf '%s\n' "$out" | tail -1)" "next: launchctl bootout" "Q1: … before install's next: line, still last"
qseed
(cd "$tmp/out" && python3 "$tmp/binq/primary-refresh.py" run --primary "$tmp/primary" >/dev/null 2>&1)
ok "$(skeys "$DS" | tr ' ' '\n' | grep -cxF -e "$tmp/agents" -e "$tmp/gone")" 2 "Q2: a hand-run of the installed copy with only --primary keeps the agents and gone spells: a pass never prunes"
qseed; run >/dev/null
ok "$(skeys "$DS" | tr ' ' '\n' | grep -cxF -e "$tmp/agents" -e "$tmp/gone")" 2 "Q2: … nor does a run of the repo copy"
qseed; python3 "$pr" install --primary "$tmp/primary" --also "$tmp/agents" --bin-dir "$tmp/binq" --plist "$tmp/q.plist" --log "$tmp/q.log" >/dev/null 2>&1
cp -p "$DS" "$tmp/q3.before"
out=$(python3 "$pr" install --primary "$tmp/primary" --also "$tmp/agents" --bin-dir "$tmp/binq" --plist "$tmp/q.plist" --log "$tmp/q.log" 2>&1)
lacks "$out" "dropped spell:" "Q3: an install with nothing to drop drops nothing"
ok "$(same "$tmp/q3.before" "$DS")" same "Q3: … and leaves the file byte for byte"
rm -f "$DS"
out=$(python3 "$pr" install --primary "$tmp/primary" --bin-dir "$tmp/binq" --plist "$tmp/q.plist" --log "$tmp/q.log" 2>&1)
ok "$([ -e "$DS" ] && echo written)" "" "Q4: an install with no state file creates none"
printf '{not json' > "$DS"
out=$(python3 "$pr" install --primary "$tmp/primary" --bin-dir "$tmp/binq" --plist "$tmp/q.plist" --log "$tmp/q.log" 2>&1)
ok "$(cat "$DS")" "{not json" "Q4: … and leaves a corrupt one as it was, for the job's next pass"
lacks "$out" "dropped spell:" "Q4: … printing no dropped spell"
grep -q "One job per state file" "$pr"; ok "$?" 0 "Q4: the docstring names one job per state file"

# ---- I7 / I7b / I7c / I8: a copy that cannot load background_job.py, and `bundle`, which never loads it ----------------
# I7: a lone copy (its plugin root $tmp/lone holds nothing) pointed at a folder inside a checkout: no module beside it or
# in the primary, so it exits 1 before it reads the primary (R7's `not a primary checkout` never prints).
mkdir -p "$tmp/lone/x/y/z"; cp "$pr" "$tmp/lone/x/y/z/primary-refresh.py"
tail7="run primary-refresh.py install from a checkout that holds the whole bundle"
out=$(cd "$tmp/out" && python3 "$tmp/lone/x/y/z/primary-refresh.py" run --primary "$tmp/primary/skills" --state "$tmp/s-i7.json" 2>&1); rc=$?
ok "$rc|$out" "1|ERROR: primary-refresh run: cannot load skills/_shared/scripts/background_job.py (no file beside the copy or in $tmp/primary/skills): $tail7" \
  "I7: a copy with no background_job.py beside it or in the primary exits 1 with one ERROR line"
lacks "$out" "Traceback" "I7: … no traceback"
ok "$([ -e "$tmp/s-i7.json" ] && echo written)" "" "I7: … and no state"
out=$(cd "$tmp/out" && python3 "$tmp/lone/x/y/z/primary-refresh.py" install --primary "$tmp/primary/skills" --bin-dir "$tmp/bin7" --plist "$tmp/bin7/j.plist" 2>&1); rc=$?
ok "$rc|$out|$([ -e "$tmp/bin7" ] && echo wrote)" "2|ERROR: primary-refresh install: cannot load skills/_shared/scripts/background_job.py (no file beside the copy or in $tmp/primary/skills): $tail7|" \
  "I7b: install from that copy exits 2 with the same line, writing nothing"
# I7c: a copy whose own module is there but broken, beside a primary with a good one: the ERROR, never the primary's
mkdir -p "$tmp/lone2/skills/_shared/scripts"; cp "$pr" "$tmp/lone2/skills/_shared/scripts/"
echo 'raise RuntimeError("i7c")' > "$tmp/lone2/skills/_shared/scripts/background_job.py"
ok "$(same "$root/skills/_shared/scripts/background_job.py" "$tmp/primary/skills/_shared/scripts/background_job.py")" same "I7c: (the primary holds a good module)"
out=$(cd "$tmp/out" && python3 "$tmp/lone2/skills/_shared/scripts/primary-refresh.py" run --primary "$tmp/primary" --state "$tmp/s-i7c.json" 2>&1); rc=$?
ok "$rc|$out" "1|ERROR: primary-refresh run: cannot load skills/_shared/scripts/background_job.py ($tmp/lone2/skills/_shared/scripts/background_job.py raised RuntimeError: i7c): $tail7" \
  "I7c: a broken module beside the copy is one ERROR line naming it, exit 1, and the primary's is never loaded instead"
lacks "$out" "Traceback" "I7c: … no traceback"
ok "$([ -e "$tmp/s-i7c.json" ] && echo written)" "" "I7c: … and no state"
# I8: `bundle` loads no helper, so the lone copy prints the whole table
python3 "$tmp/lone/x/y/z/primary-refresh.py" bundle > "$tmp/i8.out" 2> "$tmp/i8.err"; rc=$?
ok "$rc|$(same "$tmp/i8.out" "$tmp/table")|$(wc -c < "$tmp/i8.err" | tr -d ' ')" "0|same|0" "I8: bundle from a copy with no helper beside it prints the six-row table, stderr empty"

ok "$(ls -a "$tmp/bin" | grep -c '^\.stage-')" 0 "no stage is left beside the copy"
exit $fail
