#!/usr/bin/env bash
# p36-7 (ADR 0067 d8): the Capacity at a Leg's claim (skills/execute/scripts/leg.py; execute away.md § Capacity, legs.md).
# While a fresh capacity.json is in force, a Leg's fresh claim counts on the Mac, behind its Leg lease
# (~/.config/thread/leases/<rollout>.json, `by: leg`), and is gated by the room: `next` acts `wait` of kind `capacity`
# (or `quota`, the Login inside its line), `claim` stands exit 3 and records the chain waiting, `wait` polls for room.
#   L1  capacity 1, the Mac full: next waits, claim stands (exit 3) with nothing written and records the chain waiting
#   L2  capacity 2: the claim succeeds, writes the Leg lease, and a parallel rollout's next counts it
#   L3  a dead Leg's lease drops out: 90:00 still counts, 91 minutes lapses
#   L4  renewal: next renews, next --dry-run and status never do, --waiting holds 180 minutes, an unknown caller never
#   L5  close drops the lease
#   L6  no capacity.json: the claim is today's (no gate, no trickle lock), and the lease is still written
#   L7  the lock scope: no git call runs under the trickle lock; a held lock is exit 5; a plan refusal never waits on it
#   L8  a lead's next and a Leg's claim race for the last place: both finish, the Mac stays within C
#   L9  wait --task kinds capacity and quota
#   L10 quota on a Leg; status ignores it
#   L11 an inherited finish is never gated; L12 the gate never overrides a rank wait
# Temp vaults only; HOME, the lock dirs and the Run record are temp; --now and --session pinned. bash 3.2-compatible.
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR CLAUDE_ACCOUNT_PINNED CODEX_THREAD_ID XDG_STATE_HOME \
  THREAD_LEG_LOCK_TIMEOUT THREAD_NOTE_LOCK_TIMEOUT
root=$(pwd -P)
LEG="$root/skills/execute/scripts/leg.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
REAL_GIT=$(command -v git)

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
holders=()
cleanup() { local p; for p in ${holders[@]+"${holders[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master
export THREAD_EVENTS_DIR="$TMP/events" THREAD_MACHINE_TIMES='{}' THREAD_HEAT_LEVEL=0
export THREAD_CHAIN_COPY_DIR="$TMP/chains" THREAD_LAUNCH_ALIASES="$TMP/aliases.zsh" TMPDIR="$TMP/t"
mkdir -p "$TMPDIR"
NOW=2026-10-20T10:00:00+00:00

S=""; V=""; T=""; F=""; RO=""
# scen <name>: a fresh vault $V (tasks at $T), a launch folder $F (a git repo), its own HOME, lock dirs and the stem $RO.
scen() {
  S="$TMP/$1"; V="$S/vault"; T="$V/Work/Tasks"; F="$S/launch"; RO="demo-rollout-2026-10-20"
  mkdir -p "$T" "$F" "$S/home/.config/thread"; git init -q "$V"; git init -q "$F"
  git -C "$F" commit -q --allow-empty -m init
  export HOME="$S/home" THREAD_LEG_LOCK_DIR="$S/locks" THREAD_NOTE_LOCK_DIR="$S/note-locks"
  echo "== $1"
}
# mkro <slug>...: the serial note, one `ext:x` row per slug in $F.
mkro() {
  local i=1 s
  { printf -- '---\ntags:\n  - task\n  - rollout\nstatus: open\npriority: high\nprojects:\n  - "[[Demo]]"\n'
    printf -- 'captured: 2026-10-20\nprotocol_version: 5\nshape: serial\nsurfaces:\n  - "ext:x"\n---\n\n'
    printf -- '## Notes\n\nSerial-rollout plan.\n\n## Queue\n\n| # | Task | Launch | Surfaces |\n|---|---|---|---|\n'
    for s in "$@"; do printf '| %s | [[%s\\|%s]] | `cc-demo` from `%s` | `ext:x` |\n' "$i" "$s" "$s" "$F"; i=$((i+1)); done
    printf -- '\n## Post-rollout\n\nRollout-specific items go here:\n\n'
  } > "$T/$RO.md"
  for s in "$@"; do
    printf -- '---\ntags: [task]\nstatus: open\nprojects:\n  - "[[Demo]]"\nrollout: "[[%s]]"\n---\n\n## Notes\n\nDo %s.\n' "$RO" "$s" > "$T/$s.md"
  done
}
# mkpar <running> <queued>: a parallel rollout `par` with that many tasks in progress (p1…) and queued (q1…).
mkpar() {
  local i
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 8\n---\n\n## Queue\n\n' > "$T/par.md"
  i=1; while [ "$i" -le "$1" ]; do
    printf -- '---\ntags: [task]\nstatus: in_progress\nowner: lead-par\nrollout: "[[par]]"\n---\n' > "$T/p$i.md"
    printf -- '- [[p%s]]\n' "$i" >> "$T/par.md"; i=$((i+1)); done
  i=1; while [ "$i" -le "$2" ]; do
    printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[par]]"\n---\n' > "$T/q$i.md"
    printf -- '- [[q%s]]\n' "$i" >> "$T/par.md"; i=$((i+1)); done
}
cap() { printf '{"capacity": %s, "written_at": "%s"%s}' "$1" "${2:-$NOW}" "${3:+, $3}" > "$HOME/.config/thread/capacity.json"; }
uncap() { rm -f "${HOME:?}/.config/thread/capacity.json"; }
# leg <verb> [args]… → $out $err $rc; SESS (default s1) is --session, SESS= passes none; LNOW the --now.
leg() {
  local sess=()
  [ -n "${SESS-s1}" ] && sess=(--session "${SESS-s1}")
  out=$(cd "$F" && python3 "$LEG" "$@" --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" \
        --now "${LNOW:-$NOW}" ${sess[@]+"${sess[@]}"} 2>"$TMP/err"); rc=$?
  err=$(cat "$TMP/err")
}
q() { python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$out" "$1" 2>/dev/null; }
# par [--now T]: the parallel rollout's `next --dry-run` → $pj
par() { pj=$(python3 "$RR" next --rollout "$T/par.md" --tasks-dir "$T" --now "${PNOW:-$NOW}" --dry-run 2>/dev/null); }
pq() { python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(json.dumps(eval(sys.argv[2]), separators=(",", ":"), sort_keys=True))' "$pj" "$1"; }
fm() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$T/$1.md" "$2"; }
LEASE() { python3 -c 'import json, sys
try:
    d = json.load(open(sys.argv[1]))
except FileNotFoundError:
    print("none"); sys.exit(0)
print(json.dumps([d.get("by"), d.get("written_at"), d.get("waiting", False)], separators=(",", ":")))' "$HOME/.config/thread/leases/$RO.json"; }
setlease() { mkdir -p "$HOME/.config/thread/leases"; printf '{"rollout": "%s", "written_at": "%s", "by": "leg"%s}' "$RO" "$1" "${2:+, $2}" > "$HOME/.config/thread/leases/$RO.json"; }
WAITING() { python3 -c 'import json, sys
try:
    d = json.load(open(sys.argv[1]))
except FileNotFoundError:
    print("none"); sys.exit(0)
print(json.dumps([[w["rollout"], w["want"]] for w in d.get("waiting", [])], separators=(",", ":")))' "$THREAD_NOTE_LOCK_DIR/trickle-claims.json"; }
sums() { cksum "$T"/*.md | awk '{print $1 $2}' | tr '\n' ' '; }
# hold_lock: a background python holds the trickle claim lock until killed (its pid recorded in $holder).
hold_lock() {
  mkdir -p "$THREAD_NOTE_LOCK_DIR"
  python3 -c 'import fcntl, sys, time
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2], "w").write("held"); time.sleep(120)' \
    "$THREAD_NOTE_LOCK_DIR/trickle.lock" "$S/held" &
  holder=$!; holders+=("$holder")
  local k=0; while [ ! -f "$S/held" ] && [ "$k" -lt 100 ]; do sleep 0.1; k=$((k+1)); done
}
release_lock() { kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null; rm -f "${S:?}/held"; }
T1=2026-10-20T11:20:00+00:00     # T0 + 80 min
T2=2026-10-20T11:40:00+00:00     # T0 + 100 min

# ════ L1: capacity 1, the Mac full ═════════════════════════════════════════════════════════════════════════════════
scen l1
mkro t1 t2; mkpar 1 0; cap 1
leg begin --cwd "$F"; ok "$rc|$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')" "0|wait|capacity" "L1: begin's next reads the Capacity wait"
leg next
ok "$rc|$(q 'd["action"]')|$(q 'd["kind"]')|$(q 'd["task"]')" "0|wait|capacity|t1" "L1: next acts wait of kind capacity on t1"
ok "$(q 'd["why"]')|$(q 'd["next"]["task"]')|$(q 'd["stalled"]')" "trickle: 1/1 tasks running on this Mac|t1|False" "L1: … why the Trickle's line, the row named, never stalled"
ok "$(q 'd["capacity"]["limit"]')|$(q 'd["capacity"]["elsewhere"]')" "1|{'par': 1}" "L1: … its capacity block reads C 1 and par's task"
before=$(sums)
leg claim --task t1
ok "$rc|$(q 'd["exit"]')" "3|3" "L1: claim stands exit 3"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=0/2 running=0 state=waiting reason=\"trickle: 1/1 tasks running on this Mac\"" "L1: … its status line is waiting on the Capacity"
ok "$(q 'd["capacity"]["limit"]')" 1 "L1: … with its capacity block"
ok "$(sums)" "$before" "L1: … every note byte-identical"
ok "$(WAITING)" "[[\"$RO\",1]]" "L1: … and the chain's waiting record (want 1) is written"

# ════ L2: capacity 2: the claim counts ════════════════════════════════════════════════════════════════════════════
scen l2
mkro t1 t2; mkpar 1 1; cap 2
leg begin --cwd "$F"; leg next; ok "$(q 'd["action"]')" claim "L2: room for one: next is claim"
leg claim --task t1
ok "$rc|$(fm t1 status)|$(fm t1 owner)" "0|in_progress|leg-1" "L2: the claim succeeds"
ok "$(LEASE)" "[\"leg\",\"2026-10-20T10:00:00Z\",false]" "L2: … and writes the Leg lease, by leg"
ok "$(WAITING)" "none" "L2: … no waiting record"
par
ok "$(pq 'd["trickle"]["elsewhere"]')|$(pq 'd["start"]')" "{\"$RO\":1}|[]" "L2: the parallel rollout counts the Leg and holds its second start"
ok "$(pq 'd["hold"][0]["reason"]')" '"trickle: 2/2 tasks running on this Mac"' "L2: … on the Capacity"

# ════ L3: a dead Leg's lease drops out ══════════════════════════════════════════════════════════════════════════
setlease 2026-10-20T08:30:00Z; par
ok "$(pq 'd["trickle"]["elsewhere"]')" "{\"$RO\":1}" "L3: a Leg lease exactly 90:00 old still counts"
setlease 2026-10-20T08:29:00Z; par
ok "$(pq '[d["trickle"]["elsewhere"], d["trickle"]["lapsed"], d["start"]]')" "[{},{\"$RO\":1},[\"q1\"]]" "L3: 91 minutes old it lapses, is named, and the room is par's again"

# ════ L4: renewal ════════════════════════════════════════════════════════════════════════════════════════════════
scen l4
mkro t1 t2; mkpar 1 1; cap 2
leg begin --cwd "$F"; leg claim --task t1; ok "$rc" 0 "L4: claimed at T0"
LNOW=$T1 leg next --dry-run; ok "$(LEASE)" '["leg","2026-10-20T10:00:00Z",false]' "L4: next --dry-run renews nothing"
LNOW=$T1 leg status; ok "$(LEASE)" '["leg","2026-10-20T10:00:00Z",false]' "L4: status never renews"
SESS= LNOW=$T1 leg next; ok "$rc|$(LEASE)" '0|["leg","2026-10-20T10:00:00Z",false]' "L4: an unknown caller's next never renews a Leg"
PNOW=$T2 cap 2 "$T2"; PNOW=$T2 par
ok "$(pq 'd["trickle"]["lapsed"]')" "{\"$RO\":1}" "L4: … so at T0+100m the lease has lapsed"
LNOW=$T1 leg next; ok "$(q 'd["action"]')|$(LEASE)" 'finish|["leg","2026-10-20T11:20:00Z",false]' "L4: the Leg's own next (finish) renews it"
PNOW=$T2 par; ok "$(pq 'd["trickle"]["elsewhere"]')" "{\"$RO\":1}" "L4: … so a parallel next at T0+100m still counts the Leg"
leg next --waiting "review in flight: [[t1]]"
ok "$(LEASE)" '["leg","2026-10-20T10:00:00Z",true]' "L4: next --waiting writes a waiting lease"
cap 2 2026-10-20T12:30:00Z; PNOW=2026-10-20T12:30:00+00:00 par
ok "$(pq 'd["trickle"]["elsewhere"]')" "{\"$RO\":1}" "L4: … which still counts at T0+150m"
cap 2 2026-10-20T13:01:00Z; PNOW=2026-10-20T13:01:00+00:00 par
ok "$(pq 'd["trickle"]["lapsed"]')" "{\"$RO\":1}" "L4: … and is lapsed at T0+181m"

# ════ L5: close drops the lease ═════════════════════════════════════════════════════════════════════════════════════
cap 2
leg close --outcome stopped --reason "Lachy stopped it"
ok "$rc|$(LEASE)" "0|none" "L5: close --outcome stopped deletes the Leg lease"
par; ok "$(pq '[d["trickle"]["elsewhere"], d["trickle"]["lapsed"]]')" '[{},{}]' "L5: … so the stopped claim counts no more"

# ════ L11: an inherited finish is never gated ═══════════════════════════════════════════════════════════════════════
cap 1
SESS=s2 leg begin --cwd "$F"; ok "$rc|$(q 'd["next"]["action"]')|$(q 'd["next"]["inherit"]')" "0|finish|True" "L11: Leg 2 inherits t1 on a full Mac"
SESS=s2 leg claim --task t1 --inherit
ok "$rc|$(fm t1 owner)|$(LEASE)" '0|leg-2|["leg","2026-10-20T10:00:00Z",false]' "L11: the inherited claim is never gated, and writes the lease"

# ════ L6: no capacity.json: today's claim ═════════════════════════════════════════════════════════════════════════
scen l6
mkro t1 t2; mkpar 3 0
leg begin --cwd "$F"; leg next; ok "$(q 'd["action"]')" claim "L6: no Capacity: next is claim, whatever runs elsewhere"
hold_lock
SECONDS=0; THREAD_NOTE_LOCK_TIMEOUT=20 leg claim --task t1; took=$SECONDS
ok "$rc|$(fm t1 owner)" "0|leg-1" "L6: the claim proceeds as today"
ok "$([ "$took" -lt 10 ] && echo fast)" fast "L6: … at once, with the trickle lock held elsewhere (no trickle lock under the fallback)"
release_lock
ok "$(LEASE)" '["leg","2026-10-20T10:00:00Z",false]' "L6: … and still writes the Leg lease"
par; ok "$(pq 'd["trickle"]["elsewhere"]')" '{}' "L6: … which no lead counts while the Capacity is missing"

# ════ L7: the lock scope ═══════════════════════════════════════════════════════════════════════════════════════════
scen l7
mkro t1 t2; mkpar 0 0; cap 3
leg begin --cwd "$F"
mkdir -p "$S/shim" "$THREAD_NOTE_LOCK_DIR"
cat > "$S/shim/git" <<EOF
#!/bin/sh
python3 -c 'import fcntl, sys
f = open(sys.argv[1], "a")
try:
    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB); print("free")
except OSError:
    print("held")' "$THREAD_NOTE_LOCK_DIR/trickle.lock" >> "$S/git.log"
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$S/shim/git"; : > "$S/git.log"
PATH="$S/shim:$PATH" leg claim --task t1
ok "$rc|$(fm t1 owner)" "0|leg-1" "L7: a claim under the Capacity succeeds through the git shim"
ok "$([ -s "$S/git.log" ] && sort -u "$S/git.log" | tr '\n' ' ')" "free " "L7: … and every git call it made ran with the trickle lock free"
leg done --task t1 --verify none 2>/dev/null; leg next; ok "$(q 'd["task"]')" t2 "L7: t1 done; next is t2"
hold_lock
before=$(sums)
THREAD_NOTE_LOCK_TIMEOUT=1 leg claim --task t2
ok "$rc|$(sums)" "5|$before" "L7: the trickle lock held past its timeout: exit 5, nothing written"
SECONDS=0; THREAD_NOTE_LOCK_TIMEOUT=20 leg claim --task t1; took=$SECONDS
ok "$rc|$([ "$took" -lt 10 ] && echo fast)" "1|fast" "L7: a claim refused for a plan mismatch returns exit 1 at once, never waiting on the lock"
release_lock

# ════ L8: a lead's next and a Leg's claim race for the last place ═════════════════════════════════════════════════
scen l8
mkro t1 t2; mkpar 1 1; cap 2
leg begin --cwd "$F"
( python3 "$RR" next --rollout "$T/par.md" --tasks-dir "$T" --now "$NOW" > "$S/next.json" 2>/dev/null; echo $? > "$S/next.rc" ) &
nxpid=$!
( cd "$F" && python3 "$LEG" claim --task t1 --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" --session s1 \
    > "$S/claim.json" 2>/dev/null; echo $? > "$S/claim.rc" ) &
clpid=$!
wait "$nxpid"; wait "$clpid"
crc=$(cat "$S/claim.rc"); [ "$crc" = 0 ] || [ "$crc" = 3 ] && crc=ok
ok "$(cat "$S/next.rc")|$crc" "0|ok" "L8: both finish (next 0, claim 0 or 3): no deadlock"
total=$(python3 -c 'import json, sys
n = len(json.load(open(sys.argv[1]))["start"])
c = 1 if open(sys.argv[2]).read().strip() == "0" else 0
print(1 + n + c)' "$S/next.json" "$S/claim.rc")
ok "$([ "$total" -le 2 ] && echo within)" within "L8: … and the Mac runs at most C (2): $total"

# ════ L9: wait --task, kinds capacity and quota ═══════════════════════════════════════════════════════════════════
scen l9
mkro t1 t2; mkpar 1 0; cap 1
leg begin --cwd "$F"
ok "$(LEASE)" '["leg","2026-10-20T10:00:00Z",false]' "L9: begin wrote the Leg lease"
rm -f "${HOME:?}/.config/thread/leases/${RO:?}.json"
leg wait --task t1 --for -1; ok "$rc|$out" "2|" "L9: a bad --for is a usage error"
leg wait --task t1 --for 0 --dry-run
ok "$rc|$(q 'd["kind"]')|$(WAITING)|$(LEASE)" "0|capacity|none|none" "L9: --dry-run waits read-only: no record, no lease"
leg wait --task t1 --for 1
ok "$rc|$(q 'd["kind"]')|$(q 'd["cleared"]')|$(q 'd["stalled"]')|$(q 'd["logged"]')" "0|capacity|False|False|False" "L9: no room: the wait returns kind capacity, not cleared, never stalled, no rank line"
ok "$(WAITING)|$(LEASE)" "[[\"$RO\",1]]|[\"leg\",\"2026-10-20T10:00:00Z\",false]" "L9: … its waiting record and its lease are written at its start"
ok "$(grep -c 'rank wait\|rank retry' "$T/$RO.md")" 0 "L9: … and the Leg log has no rank line"
( cd "$F" && python3 "$LEG" wait --task t1 --for 40 --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" \
    --session s1 > "$S/wait.json" 2>/dev/null; echo $? > "$S/wait.rc" ) &
wpid=$!
sleep 2
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("status: in_progress", "status: done", 1))' "$T/p1.md"
wait "$wpid"
out=$(cat "$S/wait.json")
ok "$(cat "$S/wait.rc")|$(q 'd["cleared"]')|$(q 'd["next"]["action"]')" "0|True|claim" "L9: room planted mid-poll: the wait clears and next is claim"
cap 1 "$NOW" '"logins": {"login-a": {"inside_line": true}}'
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("status: done", "status: in_progress", 1))' "$T/p1.md"
ok "$(WAITING)" "[[\"$RO\",1]]" "L9: (an earlier waiting record stands)"
CLAUDE_CODE_SESSION_ID=x CLAUDE_ACCOUNT_PINNED=login-a leg wait --task t1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["why"]')|$(WAITING)" "0|quota|quota: login-a is inside its line|[]" "L9: kind quota writes no record and removes the earlier one"

# ════ L10: quota on a Leg; status ignores it ═══════════════════════════════════════════════════════════════════════
scen l10
mkro t1 t2; mkpar 0 0; cap 3 "$NOW" '"logins": {"login-a": {"inside_line": true}}'
leg begin --cwd "$F"
CLAUDE_CODE_SESSION_ID=x CLAUDE_ACCOUNT_PINNED=login-a leg next
ok "$(q 'd["action"]')|$(q 'd["kind"]')|$(q 'd["why"]')" "wait|quota|quota: login-a is inside its line" "L10: next acts wait of kind quota"
before=$(sums)
CLAUDE_CODE_SESSION_ID=x CLAUDE_ACCOUNT_PINNED=login-a leg claim --task t1
ok "$rc|$(q 'd["quota"]["login"]')|$(sums)" "3|login-a|$before" "L10: claim stands exit 3 on the quota, nothing written"
ok "$(WAITING)" none "L10: … and writes no waiting record (no lock taken)"
CLAUDE_CODE_SESSION_ID=x CLAUDE_ACCOUNT_PINNED=login-a leg status
ok "$(q 'd["next"]["action"]')" claim "L10: status in the same env shows claim: it never reads the quota"
leg next; ok "$(q 'd["action"]')" claim "L10: a caller with no Claude Code session is never held"

# ════ L12: the gate never overrides a rank wait ═══════════════════════════════════════════════════════════════════
ok "$(python3 - "$LEG" "$RR" <<'PY'
import importlib.util, sys
def load(name, src):
    spec = importlib.util.spec_from_file_location(name, src); m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m); return m
leg = load("leg", sys.argv[1]); leg.rr = load("rr", sys.argv[2])
plan = {"action": "wait", "kind": "wait", "task": "t1", "on": "other", "token": "repo:/x", "why": "rank: …"}
out, g = leg.leg_gate(None, None, plan)
print(out is plan and g is None)
PY
)" True "L12: a rank wait passes the gate untouched (only a claim is ever gated)"

echo
[ "$fail" -eq 0 ] && echo "leg-capacity.test.sh: ALL PASS" || echo "leg-capacity.test.sh: FAILED"
exit "$fail"
