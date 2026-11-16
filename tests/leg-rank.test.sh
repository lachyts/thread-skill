#!/usr/bin/env bash
# skills/execute/scripts/leg.py: a serial rollout's Legs, part 3 of 4: the rank waits (L18; L1-L16 are tests/leg.test.sh).
#   L18  same-file waits go by rank, wait-die at claim (ADR 0067 d9): order_key and first_by (L18a); a higher-ranked chain
#        waits on a running lower-ranked holder, then goes first (L18b), its reservation sets a third chain's row aside
#        (L18c); a lower-ranked chain sets its row aside and claims another (L18d); aging lifts a waiter, and only its open
#        Leg's lines count (L18e); a task whose kind alternates logs each flip and polls, never returning at once (L18v);
#        no mutual wait over 10368 two-chain fixtures (L18f); an in-place chain is no rank peer
#        (L18g); only repo: and any rank-wait (L18h); claim re-reads the rank under the rank lock (L18i); begin's launch
#        check and status read the contention-aware plan, a never-begun chain's as begun (L18j2), and a chain held so
#        reads ready (L18j, L18t); a holder with no open Leg is not running: a stalled retry, a stopped close, (O)'s holder
#        half at the next begin, a later dead holder that holds nothing, and a dead holder's die over a live one whatever
#        the peers' order (L18k); land's claim check by rank (L18l); landFirst (L18m); the (H) land wait and its
#        controls (L18n); a fix row is never waited (L18o); ADR 0060's yield ahead of rank (L18q); one hop (L18u); wait's
#        cleared and --dry-run (L18p).
# Temp vaults (git repos), temp repos with literal origins and update-ref'd origin refs, so land.sh --route never
# needs the network; a fake gh and ssh log any call. HOME, LANDING_REGISTER and THREAD_LEG_LOCK_DIR are temp;
# --now and --session are pinned. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID XDG_STATE_HOME THREAD_LEG_LOCK_TIMEOUT
root=$(pwd -P)
LEG="$root/skills/execute/scripts/leg.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
holders=()
cleanup() { local p; for p in ${holders[@]+"${holders[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
export LANDING_REGISTER="$TMP/register.md"; : > "$LANDING_REGISTER"
export THREAD_LEG_LOCK_DIR="$TMP/locks" THREAD_EVENTS_DIR="$TMP/events" TMPDIR="$TMP/t"
export THREAD_HEAT_LEVEL=0   # the Heat hold's reading (a fresh claim's), pinned: a hot Mac never flips an assertion
# L18's Chain copies stay in temp (cscen points it at each scenario's own dir), and so does the launch-alias file a
# copy's manual launch line reads (absent: cscen removes it). No L18 case runs a completion verify.
export THREAD_CHAIN_COPY_DIR="$TMP/chains" THREAD_LAUNCH_ALIASES="$TMP/aliases.zsh"
mkdir -p "$TMPDIR" "$TMP/bin"
# A fake gh and ssh: any call is logged and fails, so a test can assert no network was touched.
printf '#!/bin/sh\necho "gh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/gh"
printf '#!/bin/sh\necho "ssh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/fake-ssh"
chmod +x "$TMP/bin/gh" "$TMP/bin/fake-ssh"
export PATH="$TMP/bin:$PATH" GIT_SSH_COMMAND="$TMP/bin/fake-ssh"
: > "$TMP/net.log"
NOW=2026-10-20T10:00+00:00

. tests/lib/leg-fixtures.sh   # the shared helpers (scen, mkro, mkt, leg, q, the repo helpers, cscen, lscen, ...)

# ════ L18: same-file waits go by rank, wait-die at claim (ADR 0067 d9) ════════════════════════════════════════════════
# Copy chains in one repo ($R, as L17's lscen), each note stamped with an estate rank of one orient-all pass (rk), Legs
# opened through begin, real git. A chain that ranks above waits at claim on a running holder's row; one below sets
# the row aside to retry; a holder with no open Leg is not running, so it stands the next begin instead (O's holder
# half); every wait is bounded.
RANK_AT="2026-10-20T08:00:00+00:00"
# rk <n> — mkro's EXTRA_FM for an estate rank of the pass at $RANK_AT
rk() { printf 'estate_rank: %s\nestate_rank_at: "%s"\n' "$1" "$RANK_AT"; }
# kscen <name> — lscen, plus a third chain $RO3 (copy $C3)
kscen() { lscen "$1"; RO3=demox-rollout-2026-10-20; C3="$S/chains/r-$RO3"; }
# wlease — plant $RO's Leg lease as a waiting turn end wrote it (`next --waiting`, 09:00); glease — the lease as
# [by, written_at, waiting], or none: a rank wait renews it with no `waiting` (P41-4: only a Capacity wait keeps it)
wlease() { mkdir -p "$HOME/.config/thread/leases"
  printf '{"rollout": "%s", "written_at": "2026-10-20T09:00:00Z", "by": "leg", "waiting": true}' "$RO" > "$HOME/.config/thread/leases/$RO.json"; }
glease() { python3 -c 'import json, sys
try:
    d = json.load(open(sys.argv[1]))
except FileNotFoundError:
    print("none"); sys.exit(0)
print(json.dumps([d.get("by"), d.get("written_at"), d.get("waiting", False)], separators=(",", ":")))' "$HOME/.config/thread/leases/$RO.json"; }
# fbase — a five-line f.txt on master, so two chains' edits of its first and last lines merge clean
fbase() { printf '1\n2\n3\n4\n5\n' > "$R/f.txt"; git -C "$R" add f.txt; git -C "$R" commit -qm "f"; git -C "$R" update-ref refs/remotes/origin/master HEAD; }
# nx — the last next's `action|kind|task|on`
nx() { q '"%s|%s|%s|%s" % (d.get("action"), d.get("kind"), d.get("task"), d.get("on"))'; }
# heldwhy <slug> — the last next's held why for that row
heldwhy() { q "[h['why'] for h in d['held'] if h['slug'] == '$1']"; }
# twork <copy> <task> <file> <content> — commit, review and done (the task already claimed)
twork() { tcommit "$1" "$2" "$3" "$4"; local d; d=$(review "$1" HEAD); leg done --task "$2" --verify pass --review "$d" --cwd "$1"; ok "$rc" 0 "done $2 (reviewed)"; }

# ---- L18a: order_key and first_by, in-process ----
la() {
  python3 - "$LEG" "$1" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("legmod", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
k, fb = m.order_key, m.first_by
B1, B2 = "2026-10-20T10:00+00:00", "2026-10-21T10:00+00:00"
r1, r2 = {"n": 1, "at": "a", "ts": 2000.0}, {"n": 2, "at": "a", "ts": 2000.0}
old, new2 = {"n": 1, "at": "a", "ts": 1000.0}, {"n": 2, "at": "b", "ts": 3000.0}
exec(sys.argv[2])
PY
}
ok "$(la 'print(k("b", B2) < k("a", None, r1), k("b", B2, r2) < k("a", B1), k("b", B1, new2) < k("a", B1, old), k("b", B1, r1) < k("a", B1, r2))')" \
   "True True True True" "L18a: the began tier first, then stamped before unstamped, a later pass first, the lower n first"
ok "$(la 'print(k("b", B1) < k("a", B2), k("b", None, None, "2026-10-01") < k("a", None, None, "2026-10-20"), k("a", None, None, "2026-10-20") < k("b", None, None, "2026-10-20"), k("b", None, None, "2026-10-20") < k("a", None, None, None), k("a", None, None, None) == k("a", None, None, "x"))')" \
   "True True True True True" "L18a: begun ties by began, never-begun ones by captured (a missing or malformed date last), then slug"
ok "$(la 'print(k("b", B1, r1, "2026-09-01") < k("a", B2, r2, "2026-09-01"), k("a", B1, r1) == k("a", B1, r1, "2026-01-01"), k("a", "not a stamp") == k("a", None))')" \
   "True True True" "L18a: captured: breaks only never-begun ties; a stamp that will not parse reads as never begun"
ok "$(la 'from pathlib import Path; n = lambda fm: m.rr.Note(Path("/x/n.md"), "---\n" + fm + "\n---\n"); print(m.sc.read_estate_rank(n("estate_rank: x\nestate_rank_at: 2026-10-20T08:00+00:00"), m.rr._parse_ts), k("a", B1, m.sc.read_estate_rank(n("estate_rank: x"), m.rr._parse_ts)) == k("a", B1))')" \
   "None True" "L18a: a malformed stamp reads as unstamped"
ok "$(la 'print(fb(k("a", B1), k("b", None)), "|", fb(k("a", B2, r1), k("b", B1)), "|", fb(k("a", B1, r1), k("b", B1, r2)), "|", fb(k("a", B1, new2), k("b", B1, old)), "|", fb(k("a", B1), k("b", B2)))')" \
   "began first | ranks above (estate rank 1) | ranks above (estate rank 1) | ranks above (estate rank 2) | began first" \
   "L18a: first_by: the tier and the began stamp say began first, the stamp, the pass and n say ranks above"
ok "$(la 'print(fb(k("b", None, None, "2026-10-01"), k("a", None, None, "2026-10-20")), "|", fb(k("a", None), k("b", None)), "|", fb(k("a", B1), k("b", B1)))')" \
   "was scheduled first | comes first by slug (neither has begun) | comes first by slug (both began at the same stamp)" \
   "L18a: … the earlier schedule, and today's slug words"

# ---- L18b: a higher-ranked chain waits on a lower-ranked holder, then goes first (L18i: next writes nothing; L18p: a
#      cleared wait and --dry-run log nothing); L18c: its reservation sets a third chain's row aside ----
kscen l18b; fbase
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1
RO=$RO3; EXTRA_FM=$(rk 3)$'\n' mkro '' "c1~cc-r~$R~\`repo:$R//f.txt\`" "c2~cc-r~$R~\`repo:$R//g.txt\`"; mkt c1; mkt c2
CWD="$R" leg copies; mkcopies
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18b: B (rank 2) claims b1 on f.txt first"
RO=$RO1; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18b: A (rank 1) begins beside B's open Leg: a code file meets at claim, not at begin"
snap; CWD="$C1" leg next
ok "$rc|$(nx)" "0|wait|wait|a1|$RO2" "L18b: A's next is a wait on B: A ranks above the holder of b1"
ok "$(q 'd["token"]')|$(q 'd["stalled"]')|$(q 'd["landFirst"]')" "repo:$R//f.txt|False|[]" "L18b: … on f.txt, not stalled, nothing to land first"
same "L18i: next writes nothing"
snap; CWD="$C1" leg claim --task a1
ok "$rc" 1 "L18b: … and A's claim is refused"
has "$err" "next is \`wait a1\`, not claim of [[a1]]: nothing written" "L18b: … naming the wait"; same "L18b: a refused claim"
snap; CWD="$C1" leg wait --task a1 --for 0 --dry-run
ok "$rc|$(q 'd["kind"]')|$(q 'd["cleared"]')|$(q 'd["logged"]')" "0|wait|False|False" "L18p: wait --dry-run reads the wait"; same "L18p: … and logs nothing"
wlease; CWD="$C1" leg wait --task a1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["cleared"]')|$(q 'd["stalled"]')|$(q 'd["logged"]')|$(q 'd["on"]')" "0|wait|False|False|True|$RO2" \
   "L18b: wait --for 0 logs the wait and prints cleared false"
ok "$(glease)" '["leg","2026-10-20T10:00:00Z",false]' "L18b: … and renews the Leg lease with no \`waiting\`: a rank wait is mid-turn (P41-4)"
ok "$(logn "Leg 1 rank wait: \[\[a1\]\] on \[\[$RO2\]\] (repo:$R//f.txt; ranks above it)\$")" 1 "L18b: … its rank wait: line"
CWD="$C1" leg wait --task a1 --for 0
ok "$rc|$(q 'd["logged"]')|$(logn 'rank wait:')" "0|False|1" "L18b: a second wait logs nothing: a1's latest line already records its kind"
RO=$RO2; tcommit "$C2" b1 f.txt $'1\n2\n3\n4\nB'; d=$(review "$C2" HEAD); CWD="$C2" leg done --task b1 --verify pass --review "$d" --cwd "$C2"
RO=$RO1; CWD="$C1" leg next; ok "$(nx)" "wait|wait|a1|$RO2" "L18b: B's done b1, not yet landed, still holds A"
RO=$RO2; CWD="$C2" leg land; ok "$rc|$(lands)|$(fm b1 leg_landed)" "0|landed|None|None|$NOW" "L18b: B lands b1, stamping leg_landed"
# L18c: C (rank 3) begins while A's wait still stands
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; ok "$rc" 0 "L18c: C begins"
CWD="$C3" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(heldwhy c1)" "claim|c2|['rank: [[$RO1]] ranks above and reserves repo:$R//f.txt; retry later']" \
   "L18c: C's c1 is held on A's reservation, and C claims c2"
CWD="$C3" leg claim --task c2; ok "$rc" 0 "L18c: … claimed"
RO=$RO1; snap; CWD="$C1" leg wait --task a1 --for 0
ok "$rc|$(q 'd["cleared"]')|$(q 'd["logged"]')|$(q 'd["next"]["action"]')" "0|True|False|claim" "L18p: once b1 lands, A's wait clears"
same "L18p: … and a cleared wait logs nothing"
CWD="$C1" leg land; ok "$rc|$(lands)" "0|current|None|None" "L18b: A's land brings master (b1) into its copy"
CWD="$C1" leg claim --task a1; ok "$rc" 0 "L18b: A claims a1: it went first among the waiters"
CWD="$C1" leg status
ok "$(q 'd["rank"]["standing"]')|$(q 'd["rank"]["lifts"]')|$(q 'd["rank"]["pos"]')|$(q 'd["rank"]["stamp"]["n"]')" "[]|0|0|1" \
   "L18b: after the claim no rank line stands and lifts are 0"
twork "$C1" a1 f.txt $'A\n2\n3\n4\nB'
RO=$RO3; CWD="$C3" leg next; ok "$(q 'd["action"]')" finish "L18c: C finishes c2 first"
RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18c: A lands a1"
RO=$RO3; twork "$C3" c2 g.txt "c's g"; CWD="$C3" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|c1" "L18c: once A's a1 is landed, C's c1 is claimable"
unset CWD

# ---- L18d: a lower-ranked chain sets its task aside and claims another row; L18e: aging lifts it ----
lscen l18d
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1; mkt a2
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(heldwhy b1)" "claim|b2|['rank: [[$RO1]] ranks above and holds repo:$R//f.txt; retry later']" \
   "L18d: B (rank 2) never waits on A's a1: it sets b1 aside to retry and claims b2"
CWD="$C2" leg claim --task b2; twork "$C2" b2 g.txt "b's g"; CWD="$C2" leg land
CWD="$C2" leg next
ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|False" "L18d: with nothing else left, B's next is a retry on b1, not stalled"
wlease; CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["logged"]')|$(q 'd["flipped"]')" "0|retry|True|False" "L18d: wait logs the retry"
ok "$(glease)" '["leg","2026-10-20T10:00:00Z",false]' "L18d: … and renews the Leg lease with no \`waiting\` (P41-4)"
ok "$(logn "Leg 1 rank retry: \[\[b1\]\] on \[\[$RO1\]\] (repo:$R//f.txt; \[\[$RO1\]\] ranks above)\$")" 1 "L18d: … its rank retry: line"
LNOW=2026-10-20T10:59+00:00 CWD="$C2" leg next
ok "$(nx)|$(q 'd["held"][0]["slug"]')" "wait|retry|b1|$RO1|b1" "L18e: 59 minutes on, B still sets b1 aside"
LNOW=2026-10-20T11:01+00:00 CWD="$C2" leg next
ok "$(nx)" "wait|wait|b1|$RO1" "L18e: 61 minutes on, aging lifts B above A: it now waits on a1"
LNOW=2026-10-20T11:01+00:00 CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["flipped"]')|$(q 'd["logged"]')|$(q 'd["lifts"]')|$(q 'd["waitedMinutes"]')" "0|wait|True|True|1|61" \
   "L18e: wait prints flipped, then logs the wait (lifts 1, 61 minutes waited)"
ok "$(logn "Leg 1 rank wait: \[\[b1\]\] on \[\[$RO1\]\] (repo:$R//f.txt; ranks above it)\$")" 1 "L18e: … its rank wait: line"
RO=$RO1; LNOW=2026-10-20T11:01+00:00 twork "$C1" a1 f.txt "a's f"
LNOW=2026-10-20T11:01+00:00 CWD="$C1" leg next
ok "$(nx)|$(heldwhy a2)" "wait|retry|a2|$RO2|['rank: [[$RO2]] ranks above and reserves repo:$R//f.txt; retry later']" \
   "L18e: A's next row a2 on f.txt is held on lifted B's reservation"
LNOW=2026-10-20T11:01+00:00 CWD="$C1" leg land; ok "$(lands)" "verify|None|None" "L18e: A's land merges B's landed b2 in and asks"
LNOW=2026-10-20T11:01+00:00 CWD="$C1" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)" "landed|None|None" "L18e: … then lands a1"
RO=$RO2; LNOW=2026-10-20T11:02+00:00 CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18e: B claims b1 first"
LNOW=2026-10-20T11:02+00:00 CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18e: … claimed"
LNOW=2026-10-20T11:02+00:00 CWD="$C2" leg status
ok "$(q 'd["rank"]["lifts"]')|$(q 'd["rank"]["standing"]')" "0|[]" "L18e: after B's claim, lifts are 0"
RO=$RO1; LNOW=2026-10-20T11:02+00:00 CWD="$C1" leg next
ok "$(nx)" "wait|wait|a2|$RO2" "L18e: … B's lines lapse at its claim, so A ranks above again and waits on b1: no preemption"
unset CWD
# L18e2: a standing line counts only in its open Leg: a closed Leg's retry lifts nothing
lscen l18e2; EXTRA_FM=$(rk 1)$'\n' mkro '' "t1~cc-r~$R~\`repo:$R//f.txt\`"; mkt t1; CWD="$R" leg copies
CWD="$C1" leg begin --cwd "$C1"
printf -- '- 2026-10-20T08:00+00:00 Leg 1 rank retry: [[t1]] on [[other-rollout-2026-10-20]] (repo:%s//f.txt; [[other-rollout-2026-10-20]] ranks above)\n' "$R" >> "$T/$RO.md"
CWD="$C1" leg status
ok "$(q 'd["rank"]["lifts"]')|$(q '[(x["task"], x["kind"]) for x in d["rank"]["standing"]]')" "2|[('t1', 'retry')]" \
   "L18e2: a retry line standing two hours in the open Leg lifts its chain twice"
CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"; LNOW=2026-10-20T10:05+00:00 CWD="$C1" leg begin --cwd "$C1"
LNOW=2026-10-20T10:05+00:00 CWD="$C1" leg status
ok "$(q 'd["openLeg"]')|$(q 'd["rank"]["lifts"]')|$(q 'd["rank"]["standing"]')" "2|0|[]" "L18e2: a retry line of a closed Leg lifts nothing in the next"
unset CWD
# L18v: a task whose kind alternates (floor-based lifts on two waiters at offset phases) holds both kinds' lines; wait
# logs a line whenever the kind differs from the task's latest, so it records the kind it waits as and polls, never
# returning at once into a Leg loop with no sleep
lscen l18v
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; LNOW=2026-10-20T10:20+00:00 CWD="$C2" leg next
ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|False" "L18v: B's only row is a retry on A's a1"
printf -- '- 2026-10-20T10:05+00:00 Leg 1 rank retry: [[b1]] on [[%s]] (repo:%s//f.txt; [[%s]] ranks above)\n' "$RO1" "$R" "$RO1" >> "$T/$RO.md"
printf -- '- 2026-10-20T10:10+00:00 Leg 1 rank wait: [[b1]] on [[%s]] (repo:%s//f.txt; ranks above it)\n' "$RO1" "$R" >> "$T/$RO.md"
t0=$SECONDS; LNOW=2026-10-20T10:20+00:00 CWD="$C2" leg wait --task b1 --for 2; el=$((SECONDS - t0))
ok "$rc|$(q 'd["kind"]')|$(q 'd["flipped"]')|$(q 'd["logged"]')|$(q 'd["cleared"]')|$(q 'd["stalled"]')|$([ "$el" -ge 2 ] && echo polled)" \
   "0|retry|True|True|False|False|polled" "L18v: with a wait line latest, a retry flips, logs a fresh retry line and polls its --for"
ok "$(logn 'rank retry: \[\[b1\]\]')|$(grep 'Leg 1 rank ' "$T/$RO.md" | tail -n 1 | grep -c 'rank retry: \[\[b1\]\]')" "2|1" \
   "L18v: … so b1's latest standing line records the kind it waits as"
snap; t0=$SECONDS; LNOW=2026-10-20T10:21+00:00 CWD="$C2" leg wait --task b1 --for 2; el=$((SECONDS - t0))
ok "$rc|$(q 'd["kind"]')|$(q 'd["flipped"]')|$(q 'd["logged"]')|$([ "$el" -ge 2 ] && echo polled)" "0|retry|False|False|polled" \
   "L18v: the next call flips nothing, logs nothing and polls"; same "L18v: … a call that only polls"
unset CWD

# ---- L18f: no fixture reaches a mutual wait (in-process, leg.py loaded by path): a property loop over two copied
#      chains' rank order, lifts, row states, open Legs, reservations and a row behind the other ----
lf() {
  python3 - "$LEG" <<'PY'
import importlib.util, itertools, sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location("legmod", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
NOW = datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc)
F = ("repo", "/r//f.txt")
STAMP = lambda minutes: (NOW - timedelta(minutes=minutes)).isoformat(timespec="minutes")

class Note:
    def __init__(self, **kv): self.kv = kv
    def get(self, k): return self.kv.get(k)

class Row:
    def __init__(self, slug, state, owner=None, unlanded=False):
        self.slug, self.state, self.unlanded, self.surfaces = slug, state, unlanded, ["repo:/r//f.txt"]
        self.note = Note(status={"running": "in_progress", "queued": "open", "done": "done"}[state], owner=owner)
        self.alias, self.folder, self.i = "cc-r", "/r", 0
    def same_launch(self, alias, folder): return True

class Chain:
    def __init__(self, slug, key, open_, rows, lines):
        self.ctx, self.key, self.open_, self.rows, self.lines = SimpleNamespace(slug=slug), key, open_, rows, lines
        self.note, self.log, self.contend = Note(), [], {}
        self.legs = {1: {"n": 1, "began": "x", "closed": None if open_ else "stopped: x"}}
    def open_leg(self): return {"n": 1, "alias": "cc-r", "folder": "/r"} if self.open_ else None
    def counted(self): return list(self.rows)
    def row(self, slug): return next((r for r in self.rows if r.slug.lower() == slug.lower()), None)
    def fixes(self): return []

WORLD = {}
m.sc.read_chain_copies = lambda note: []
m.other_serial = lambda ctx: [(SimpleNamespace(stem=s), WORLD[s]) for s in WORLD if s != ctx.slug]
m.peer_chain = lambda ctx, path: WORLD[path.stem]
m.chain_key = lambda C, began=None: C.key
m.standing_lines = lambda C, dead=(): C.lines if C.open_ else []
m.unlanded_done = lambda C, r: r.unlanded
m.leg_claim_tokens = lambda r: [F] if r.unlanded else []
m.holds_of = lambda chain, r: []

def make(slug, first, state, open_, reserve, lifted, behind):
    rows = [Row(f"{slug}0", "running" if state == "running" else "done", owner="leg-1" if state == "running" else None,
                unlanded=state == "unlanded"), Row(f"{slug}1", "queued")]
    if behind:
        rows.append(Row(f"{slug}b", "done", unlanded=True))
    other = "b" if slug == "a" else "a"
    lines = [{"task": f"{slug}1", "kind": reserve, "at": STAMP(61 if lifted else 1), "on": other}] if reserve else []
    return Chain(slug, (0, 0, -1.0, 1 if first else 2, 0.0, slug), open_, rows, lines)

bad, n, SEEN = [], 0, set()
opts = list(itertools.product(("running", "unlanded", "landed"), (True, False), (None, "retry", "wait"), (True, False),
                              (True, False)))
for a_first in (True, False):
    for oa in opts:
        for ob in opts:
            WORLD.clear()
            A, B = make("a", a_first, *oa), make("b", not a_first, *ob)
            WORLD.update(a=A, b=B)
            plans = {}
            for X in (A, B):
                if X.open_leg() is None:
                    continue
                X.contend = m.rank_contention(SimpleNamespace(slug=X.ctx.slug, now=NOW), X, 1)
                plans[X.ctx.slug] = m.plan_next(X, 1, "cc-r", "/r")
            n += 1
            label = f"a_first={a_first} a={oa} b={ob}"
            pa, pb = plans.get("a"), plans.get("b")
            SEEN.update(f"{p['action']}:{p.get('kind') or '-'}{':stalled' if p.get('stalled') else ''}" for p in plans.values())
            w = lambda p, kind: p is not None and p["action"] == "wait" and p["kind"] == kind
            if w(pa, "wait") and w(pb, "wait"):
                bad.append(f"mutual wait: {label}")
            for X, p in ((A, pa), (B, pb)):
                if p is None or p["action"] != "wait":
                    continue
                other = WORLD[p["on"]]
                if any(r.state == "running" and r.note.get("owner") == "leg-1" for r in X.rows):
                    bad.append(f"[[{X.ctx.slug}]] waits owning a row in progress: {label}")
                if p["kind"] == "wait" and other.open_leg() is None:
                    bad.append(f"[[{X.ctx.slug}]] waits on a chain with no open Leg: {label}")
                if p["kind"] == "land" and (not other.key < X.key or w(plans.get(other.ctx.slug), "land")):
                    bad.append(f"[[{X.ctx.slug}]]'s land wait points later or back: {label}")
                if p["kind"] == "retry" and p["stalled"] and (not other.key < X.key or other.open_leg() is not None):
                    bad.append(f"[[{X.ctx.slug}]]'s stalled retry is held by a running or later chain: {label}")
print(n, len(bad))
print(" ".join(sorted(SEEN)))
for b in bad[:5]:
    print(b)
PY
}
out_f=$(lf)
ok "$(printf '%s\n' "$out_f" | head -n 1)" "10368 0" "L18f: 10368 two-chain fixtures: no mutual wait, no wait owning a row in progress or on a chain not running, every land wait on an earlier chain, every stalled retry on an earlier chain with no open Leg"
ok "$(printf '%s\n' "$out_f" | sed -n 2p)" "claim:- finish:- wait:land wait:retry wait:retry:stalled wait:wait" "L18f: … the loop reaches every act: claim, finish, and each kind of wait"
[ "$(printf '%s\n' "$out_f" | head -n 1)" = "10368 0" ] || printf '%s\n' "$out_f"

# ---- L18g: an in-place chain beside a copy chain gets no rank hold, either way ----
lscen l18g; RO3=demoip-rollout-2026-10-20
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO3; EXTRA_FM=$(rk 2)$'\n' mkro '' "ip1~cc-r~$R~\`repo:$R//f.txt\`"; mkt ip1; RO=$RO1
CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18g: copy chain A's Leg begins"
# IP works $R in place: its Leg is opened by hand here, since begin's (M) would rightly hold it beside A's open Leg in $R
printf -- '\n## Leg log\n\n- 2026-10-20T09:00+00:00 Leg 1 began: leg-1 session s1 in cc-r from %s\n' "$R" >> "$T/$RO3.md"
RO=$RO3; CWD="$R" leg claim --task ip1; ok "$rc" 0 "L18g: in-place IP claims ip1 on f.txt: no rank read in place"
RO=$RO1; CWD="$C1" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|a1" "L18g: A's a1 on f.txt is claimable beside IP's ip1 in progress: an in-place chain is no rank peer"
CWD="$C1" leg status; ok "$(q 'd["rank"]["contention"]["held"]')" "{}" "L18g: … nothing held"
RO=$RO3; CWD="$R" leg status; ok "$(q 'd["rank"]["pos"]')|$(q 'd["rank"]["contention"]["held"]')" "None|{}" "L18g: … and the in-place chain reads no contention"
unset CWD

# ---- L18h: token kinds: vault against vault and ext: against ext: never rank-wait (d6); repo: against any is held; any
#      against vault is not ----
lscen l18h
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//z1.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//z2.txt\`" "b2~cc-r~$R~\`repo:$R//z3.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
# cell <rollout> <old> <new> — a Queue cell edited by hand after both begins (begin's own (M) would otherwise meet them)
cell() { subst "$T/$1.md" "| \`$2\` |" "| \`$3\` |"; }
cell "$RO1" "repo:$R//z1.txt" "repo:$R//f.txt"; cell "$RO2" "repo:$R//z2.txt" any
CWD="$C2" leg next
ok "$(q 'd["task"]')|$(heldwhy b1)" "b2|['rank: [[$RO1]] ranks above and holds repo:$R//f.txt; retry later']" "L18h: repo: against any (a bad cell) is held"
cell "$RO1" "repo:$R//f.txt" "vault:Work/Projects/A"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18h: any against vault is not"
cell "$RO2" any "vault:Work/Projects/A"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18h: vault against vault never rank-waits"
cell "$RO1" "vault:Work/Projects/A" "ext:cms"; cell "$RO2" "vault:Work/Projects/A" "ext:cms"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18h: nor ext: against ext:"
unset CWD

# ---- L18i: a holder that claims between next and claim makes the claim refuse, under the rank lock ----
lscen l18i
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18i: B's next proposes b1"
RO=$RO1; CWD="$C1" leg claim --task a1; RO=$RO2
snap; cp "$T/b1.md" "$TMP/snap-b1"; CWD="$C2" leg claim --task b1
ok "$rc" 1 "L18i: A claimed f.txt meanwhile: B's claim of b1 re-reads the rank and refuses"
has "$err" "next is \`claim b2\`, not claim of [[b1]]: nothing written" "L18i: … naming what next is now"
same "L18i: a refused claim"; cmp -s "$T/b1.md" "$TMP/snap-b1"; ok "$?" 0 "L18i: … and b1 is unwritten"
holdlock "$THREAD_LEG_LOCK_DIR/rank-claim.lock" "$TMP/rk1"; hpr=$hp
snap; LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C2" leg claim --task b2
ok "$rc" 5 "L18i: a held rank lock is exit 5"
has "$err" "the rank lock: another chain's claim held $THREAD_LEG_LOCK_DIR/rank-claim.lock past 1s" "L18i: … naming it"; same "L18i: … nothing written"
kill "$hpr" 2>/dev/null; wait "$hpr" 2>/dev/null
CWD="$C2" leg claim --task b2; ok "$rc" 0 "L18i: once released, B claims b2"
unset CWD

# ---- L18j, L18t: begin's launch check and status read the contention-aware plan; a chain whose rows are all held by a
#      running, higher-ranked chain reads ready, never stuck ----
lscen l18j
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R/sub/l~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg status
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["cwd"]')|$(q 'd["restart"]["blockedBy"]')" "b2|$C2/sub/l|None" \
   "L18t: b1 held by A, b2 claimable in another launch folder: the restart opens in b2's folder"
snap; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["exit"]')" "4|4" "L18j: begin in b1's folder is the wrong launch: the launch check reads the contention-aware plan"
same "L18j: … nothing written"
CWD="$C2/sub/l" leg begin --cwd "$C2/sub/l"; ok "$rc|$(q 'd["next"]["action"]')|$(q 'd["next"]["task"]')" "0|claim|b2" \
   "L18j: begin in b2's folder passes the launch check"
unset CWD
# L18j2: two never-begun stamped chains begin in reverse rank order. A fresh Leg 1 reads its own chain as begun (every
# claim after its begin does), so A (rank 1) ranks above B's claim, its first row is a wait there, not a die, and its
# Leg 1 opens in that row's folder, not the next row's launch
lscen l18j2
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R/sub/l~\`repo:$R//g.txt\`"; mkt a1; mkt a2
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg claim --task b1
ok "$rc" 0 "L18j2: B (rank 2) begins first and claims b1 on f.txt"
RO=$RO1; CWD="$C1" leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["task"]')|$(q 'd["restart"]["cwd"]')|$(q 'd["restart"]["blockedBy"]')" "not-started|a1|$C1|None" \
   "L18j2: A has never begun, but its restart reads it as begun: it opens in a1's folder"
ok "$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')|$(q 'd["next"]["on"]')|$(q 'd["rank"]["pos"]')|$(q 'd["rank"]["key"][0]')" \
   "wait|wait|$RO2|0|0" "L18j2: … its fresh Leg ranks above B (pos 0, the began tier) and waits on b1"
snap; CWD="$C1/sub/l" leg begin --cwd "$C1/sub/l"
ok "$rc|$(q 'd["exit"]')" "4|4" "L18j2: begin in a2's folder is the wrong launch"; same "L18j2: … nothing written"
CWD="$C1" leg begin --cwd "$C1"
ok "$rc|$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')|$(q 'd["next"]["task"]')|$(q 'd["next"]["on"]')" "0|wait|wait|a1|$RO2" \
   "L18j2: begin in a1's folder passes the launch check, and Leg 1's next is the wait on a1"
unset CWD
lscen l18t
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg next; ok "$(nx)" "wait|retry|b1|$RO1" "L18t: B's only row is held by A, running and ranked above"
CWD="$C2" leg close --outcome stuck --cwd "$C2"; ok "$rc" 0 "L18t: B's Leg closes"
CWD="$C2" leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')" "ready|whole|wait|retry" \
   "L18t: B reads ready (never stuck), holds its whole claim, and its next is the retry"
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["rows"][0]["held"]')" "b1|None|rank: [[$RO1]] ranks above and holds repo:$R//f.txt; retry later" \
   "L18t: its restart is the held row, unblocked, and the row carries the rank's why"
subst "$T/$RO2.md" "estate_rank: 2" "estate_rank: x"; CWD="$C2" leg status
ok "$(q 'd["rank"]["stamp"]')|$(q 'd["rank"]["warn"]')" \
   "None|estate_rank: x, estate_rank_at: $RANK_AT is malformed: read as unstamped (ADR 0067 d9)" "L18t: a malformed stamp reads as unstamped, with a WARN"
ok "$(q 'd["hold"]["warn"]')" "estate_rank: x, estate_rank_at: $RANK_AT is malformed: read as unstamped (ADR 0067 d9)" "L18t: … the hold's warn too"
unset CWD

# ---- L18k (R2-1): a holder with no open Leg is not running: never waited on at claim; it stands the next begin of a
#      chain that sorts after it ((O)'s holder half), and holds nothing against one that sorts before it ----
kscen l18k; RO1=demoxk-rollout-2026-10-20; C1="$S/chains/r-$RO1"   # X ($RO1, rank 1) and B ($RO2, rank 2)
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "x1~cc-r~$R~\`repo:$R//f.txt\`"; mkt x1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2
mkcopies; RO=$RO1; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task x1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18k: B begins beside X's open Leg"
RO=$RO1; CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"; ok "$rc" 0 "L18k: X's Leg closes stopped with x1 in progress"
RO=$RO2; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(heldwhy b1)" "claim|b2|['rank: [[$RO1]] holds repo:$R//f.txt with no open Leg; its next Leg finishes or lands it']" \
   "L18k (k1): B never waits on X, which is not running: b1 is set aside, and B claims b2"
CWD="$C2" leg claim --task b2; twork "$C2" b2 g.txt "b's g"; CWD="$C2" leg land; ok "$(lands)" "landed|None|None" "L18k: B lands b2"
CWD="$C2" leg next
ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|True" "L18k (k2): with only b1 left, B's next is a stalled retry"
snap; CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["stalled"]')|$(q 'd["logged"]')" "0|True|False" "L18k (k2): wait prints stalled"; same "L18k (k2): … and logs nothing"
CWD="$C2" leg close --outcome stopped --reason "rank wait: $(q 'd["why"]')" --cwd "$C2"; ok "$rc" 0 "L18k (k2): B closes stopped"
CWD="$C2" leg status
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["blockedBy"]')" "b1|surface held by [[$RO1]] (repo:$R//f.txt)" \
   "L18k (k3): B's restart is blocked by X's surface, so repair never restarts it into the same wait"
snap; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["held"]')" "3|[{'rollout': '$RO1', 'token': 'repo:$R//f.txt'}]" "L18k (k3): B's begin is exit 3"
has "$(q 'd["status_line"]')" "surface held: [[$RO1]] holds repo:$R//f.txt" "L18k (k3): … surface held"; same "L18k (k3): … nothing written"
has "$(q 'd["status_line"]')" "state=waiting reason=\"begin wait: " "L18k (k3): … a begin wait, never a halt"
RO=$RO1; CWD="$C1" leg status
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["blockedBy"]')" "x1|None" "L18k (k3): X's restart is the finish of x1, unblocked"
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task x1 --inherit; ok "$rc" 0 "L18k (k4): X's Leg 2 takes x1"
RO=$RO2; CWD="$C2" leg status; ok "$(q 'd["restart"]["blockedBy"]')" "None" "L18k (k4): once X's Leg is open, B's restart is unblocked"
CWD="$C2" leg begin --cwd "$C2"; ok "$rc|$(q 'd["leg"]')" "0|2" "L18k (k4): B's Leg 2 begins"
CWD="$C2" leg next; ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|False" "L18k (k4): … its next a retry, not stalled: X runs"
CWD="$C2" leg wait --task b1 --for 0; ok "$(q 'd["logged"]')" True "L18k: B logs its retry"
LNOW=2026-10-20T13:01+00:00 CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["stalled"]')|$(q 'd["waitedMinutes"]')" "0|True|181" "L18k (k6): a line standing 181 minutes on a running holder is stalled"
RO=$RO1; twork "$C1" x1 f.txt "x's f"; CWD="$C1" leg land; ok "$(lands)" "verify|None|None" "L18k (k4): X's land merges B's b2 and asks"
CWD="$C1" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)" "landed|None|None" "L18k (k4): … then lands x1"
RO=$RO2; CWD="$C2" leg wait --task b1 --for 0; ok "$rc|$(q 'd["cleared"]')" "0|True" "L18k (k4): B's wait clears"
CWD="$C2" leg land; CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18k (k4): … and B claims b1"
unset CWD
# k5: a later dead holder holds nothing against a chain that sorts before it; its land stands behind that chain
lscen l18k5; fbase; RO1=demoak-rollout-2026-10-20; C1="$S/chains/r-$RO1"; RO2=demoyk-rollout-2026-10-20; C2="$S/chains/r-$RO2"
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "y1~cc-r~$R~\`repo:$R//f.txt\`"; mkt y1
mkcopies; RO=$RO1; LNOW=2026-10-20T09:00+00:00 CWD="$C1" leg begin --cwd "$C1"
LNOW=2026-10-20T09:00+00:00 CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
RO=$RO2; LNOW=2026-10-20T09:30+00:00 CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18k (k5): Y (rank 2) begins while A has no open Leg"
LNOW=2026-10-20T09:30+00:00 CWD="$C2" leg claim --task y1; ok "$rc" 0 "L18k (k5): … and claims y1 on f.txt"
LNOW=2026-10-20T09:30+00:00 CWD="$C2" leg close --outcome stopped --reason "out of time" --cwd "$C2"
RO=$RO1; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18k (k5): A's begin passes beside Y's y1 in progress: a later holder"
CWD="$C1" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|a1" "L18k (k5): … and A claims a1: Y, not running and later, holds nothing"
CWD="$C1" leg claim --task a1; twork "$C1" a1 f.txt $'A\n2\n3\n4\n5'
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18k (k5): Y's Leg 2 begins"
CWD="$C2" leg claim --task y1 --inherit; twork "$C2" y1 f.txt $'1\n2\n3\n4\nY'
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "L18k (k5): Y's land stands behind A, which ranks above"
RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18k (k5): A lands"
RO=$RO2; CWD="$C2" leg land; CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"
ok "$(lands)|$(git -C "$R" show master:f.txt | tr '\n' ' ')" "landed|None|None|A 2 3 4 Y " "L18k (k5): … then Y's land merges A's work and lands"
unset CWD
# k7: a row held both by an earlier running chain and by an earlier one with no open Leg is a dead die, whichever note
#     sorts first: it cannot clear until the dead holder's Leg opens, so the retry is stalled, never a 180-minute poll.
#     L ($RO1, rank 1, running) sorts before D ($RO2, rank 2, no open Leg) in other_serial's path order; B ($RO3) is rank 3
kscen l18k7
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "l1~cc-r~$R~\`repo:$R//f.txt\`"; mkt l1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "d1~cc-r~$R~\`repo:$R//f.txt\`"; mkt d1
RO=$RO3; EXTRA_FM=$(rk 3)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1
CWD="$R" leg copies; mkcopies
RO=$RO1; LNOW=2026-10-20T09:00+00:00 CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18k (k7): L's Leg 1 begins"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg claim --task d1; ok "$rc" 0 "L18k (k7): D claims d1 on f.txt"
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; ok "$rc" 0 "L18k (k7): B begins beside D's open Leg"
RO=$RO2; CWD="$C2" leg close --outcome stopped --reason "out of time" --cwd "$C2"; ok "$rc" 0 "L18k (k7): D's Leg closes with d1 in progress"
RO=$RO1; CWD="$C1" leg claim --task l1; ok "$rc" 0 "L18k (k7): L claims l1 on f.txt: D, later and not running, holds nothing against it"
RO=$RO3; CWD="$C3" leg next
ok "$(nx)|$(q 'd["stalled"]')|$(heldwhy b1)" \
   "wait|retry|b1|$RO2|True|['rank: [[$RO2]] holds repo:$R//f.txt with no open Leg; its next Leg finishes or lands it']" \
   "L18k (k7): B's retry on b1 names D, with no open Leg, and is stalled, though L's running note sorts first"
unset CWD

# ---- L18l: land's claim check is rank-led: the later-begun, higher-ranked chain lands first ----
gscen2() {   # as gscen: A's a1 and B's b1 both commit f.txt; A begins first, B ranks above
  lscen "$1"; EXTRA_FM=$(rk 2)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; EXTRA_FM=$(rk 1)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1; mkcopies
  CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"
  RO=$RO1; CWD="$C1" work "$C1" a1 f.txt "a's f"; RO=$RO2; CWD="$C2" work "$C2" b1 f.txt "b's f"
}
gscen2 l18l
RO=$RO1; CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|[[$RO2]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "L18l: A began first, but B ranks above: A's land stands"
RO=$RO2; CWD="$C2" leg land; ok "$rc|$(lands)" "0|landed|None|None" "L18l: … and B's lands"
unset CWD

# ---- L18m (R1-4): the waiter side: a chain that waits on a holder whose land stands behind it lands its own rows first
#      (landFirst) ----
# mscen <name> — A (rank 1: a0 on a0.txt, a1 on f.txt) and B (rank 2: b1 on b1.txt, b2 on f.txt); a0 and b1 both edit
# f.txt (its first and last lines), A's a0 is done but not landed, and B's land of b1 stands behind it
mscen() {
  lscen "$1"; fbase
  EXTRA_FM=$(rk 1)$'\n' mkro '' "a0~cc-r~$R~\`repo:$R//a0.txt\`" "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a0; mkt a1
  RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; mkt b2; RO=$RO1
  mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
  RO=$RO1; CWD="$C1" leg claim --task a0; RO=$RO2; CWD="$C2" leg claim --task b1
  RO=$RO1; twork "$C1" a0 f.txt $'A\n2\n3\n4\n5'; RO=$RO2; twork "$C2" b1 f.txt $'1\n2\n3\n4\nB'
  CWD="$C2" leg land
  ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "$1: B's land of b1 stands behind A's unlanded a0"
  RO=$RO1
}
mscen l18m
CWD="$C1" leg next
ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a1|$RO2|['a0']" "L18m: A's next waits on b1, with landFirst [a0]: b1 lands only after a0"
CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18m: A's land lands a0"
CWD="$C1" leg next; ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a1|$RO2|[]" "L18m: … then landFirst is []"
CWD="$C1" leg wait --task a1 --for 0; ok "$(q 'd["logged"]')" True "L18m: A logs its wait"
RO=$RO2; CWD="$C2" leg next
ok "$(nx)|$(heldwhy b2)" "wait|retry|b2|$RO1|['rank: [[$RO1]] ranks above and reserves repo:$R//f.txt; retry later']" "L18m: B's b2 on f.txt is held on A's reservation"
RO=$RO1; CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18m: once A's Leg closes stopped, its reservation lapses: B claims b2"
unset CWD
mscen l18m2; pcommit "$R" f.txt $'P\n2\n3\n4\n5' "a peer's edit of f.txt on master"
CWD="$C1" leg land; ok "$(lands)" "stood|conflict in f.txt|False" "L18m: the conflict variant: A's own land of a0 stands on a conflict"
CWD="$C1" leg next; ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a1|$RO2|['a0']" "L18m: … and landFirst still names a0"
unset CWD

# ---- L18n: (H), the holder side's land wait: a chain whose own unlanded row would stand behind an earlier chain that is
#      between tasks and about to land waits for that land before claiming, with its three controls ----
# nscen <name> — A (rank 1) and B (rank 2), each with a row done on its own cell that also edits f.txt; neither landed
nscen() {
  lscen "$1"; fbase
  EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`" "a2~cc-r~$R~\`repo:$R//a2.txt\`"; mkt a1; mkt a2
  RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
  mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
  RO=$RO1; CWD="$C1" leg claim --task a1; RO=$RO2; CWD="$C2" leg claim --task b1
  RO=$RO1; twork "$C1" a1 f.txt $'A\n2\n3\n4\n5'; RO=$RO2; twork "$C2" b1 f.txt $'1\n2\n3\n4\nB'
}
nscen l18n
CWD="$C2" leg next
ok "$(nx)|$(q 'd["lands"]')" "wait|land|b2|$RO1|['b1']" "L18n: B's next is a land wait: A, earlier and between tasks, has just finished a1 on f.txt"
LNOW=2026-10-20T10:16+00:00 CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: control: 16 minutes on, A's done is stale: B claims"
RO=$RO1; echo x >> "$R/f.txt"; CWD="$C1" leg land; ok "$(lands)" "stood|the primary's uncommitted edit on f.txt|False" "L18n: A's land stands"
git -C "$R" checkout -q -- f.txt; RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: control: a land stood after A's done: B claims"
unset CWD
nscen l18n2; RO=$RO1; CWD="$C1" leg claim --task a2
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: control: A's open Leg is mid-task (a2 in progress): B claims"
unset CWD
nscen l18n3; RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18n: A lands a1"
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: … and B's land wait clears itself"
unset CWD
nscen l18n4; RO=$RO1; subst "$T/$RO1.md" "| \`repo:$R//a2.txt\` |" "| \`repo:$R//f.txt\` |"
CWD="$C1" leg next; ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a2|$RO2|['a1']" "L18n: A waits on B's unlanded b1, landing a1 first"
CWD="$C1" leg wait --task a2 --for 0; ok "$(q 'd["logged"]')" True "L18n: … and logs its wait on B"
RO=$RO2; LNOW=2026-10-20T10:16+00:00 CWD="$C2" leg next
ok "$(nx)" "wait|land|b2|$RO1" "L18n: A's standing wait on B keeps B's land wait though A's done is 16 minutes old"
unset CWD

# ---- L18o: a red re-verify's fix on f.txt is claimed, never waited: a holder behind this chain never holds a fix row ----
lscen l18o; fbase
EXTRA_FM=$(rk 1)$'\n' mkro '' "a0~cc-r~$R~\`repo:$R//f.txt\`"; mkt a0
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
RO=$RO1; CWD="$C1" leg claim --task a0; RO=$RO2; CWD="$C2" leg claim --task b1
RO=$RO1; twork "$C1" a0 f.txt $'A\n2\n3\n4\n5'; RO=$RO2; twork "$C2" b1 f.txt $'1\n2\n3\n4\nB'
CWD="$C2" leg land; ok "$(lands)" "stood|[[$RO1]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "L18o: B's land stands behind A"
RO=$RO1; CWD="$C1" leg file-fix --target a0 --cause own --evidence "a0's Verify red after a land merge"; f0=$(q 'd["fix"]')
CWD="$C1" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(q 'd["fix"]')" "claim|$f0|True" "L18o: A's fix on f.txt is claimed, though B's b1 there is unlanded behind A"
unset CWD

# ---- L18q (R2-4): ADR 0060's yield comes first: decided at begin, ahead of rank ----
lscen l18q
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R~\`repo:$R//g.txt\`"; mkt a1; mkt a2
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 f.txt "a's f"; CWD="$C1" leg land
CWD="$C1" leg claim --task a2; CWD="$C1" leg set-aside --task a2 --reason "blocked on a key"; CWD="$C1" leg close --outcome stuck --cwd "$C1"
python3 "$RR" hand-back --tasks a2 --tasks-dir "$T" > "$TMP/hb" 2>&1
snap; SESS=s2 CWD="$C1" leg begin --cwd "$C1"
ok "$rc|$(q 'd["held"]')" "3|[{'rollout': '$RO2', 'token': 'repo:$R//f.txt'}]" "L18q: A (rank 1) yields its smoke row's place to B (rank 2), scheduled on it while A was stuck"
has "$(q 'd["status_line"]')" "surface held: [[$RO2]] holds repo:$R//f.txt" "L18q: … at begin"; same "L18q: … nothing written"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18q: B's begin passes"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18q: … and B claims b1"
unset CWD

# ---- L18u: one hop: a peer's unlanded row whose land stands behind a third, earlier chain is not running ----
kscen l18u; fbase; RO1=demof-rollout-2026-10-20; C1="$S/chains/r-$RO1"; RO3=demoe-rollout-2026-10-20; C3="$S/chains/r-$RO3"
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "f1~cc-r~$R~\`repo:$R//f.txt\`"; mkt f1
RO=$RO3; EXTRA_FM=$(rk 2)$'\n' mkro '' "e1~cc-r~$R~\`repo:$R//e1.txt\`"; mkt e1
RO=$RO2; EXTRA_FM=$(rk 3)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1
CWD="$R" leg copies; RO=$RO3; CWD="$R" leg copies; RO=$RO1; CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; CWD="$C3" work "$C3" e1 f.txt $'E\n2\n3\n4\n5'
CWD="$C3" leg close --outcome stopped --reason "out of time" --cwd "$C3"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" work "$C2" b1 f.txt $'1\n2\n3\n4\nB'; CWD="$C2" leg land
ok "$(lands)" "stood|[[$RO3]] holds repo:$R//f.txt unlanded and ranks above (estate rank 2)|True" "L18u: B's land of b1 stands behind E"
RO=$RO1; CWD="$C1" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|f1" "L18u: F claims f1: B's b1 stands behind E, so B, which sorts after F, holds nothing"
RO=$RO3; CWD="$C3" leg land; ok "$(lands)" "landed|None|None" "L18u: control: E's closed Leg lands e1"
RO=$RO1; CWD="$C1" leg next; ok "$(nx)" "wait|wait|f1|$RO2" "L18u: … now B's b1 runs, and F waits on it"
unset CWD

echo
if [ "$fail" -eq 0 ]; then echo "leg-rank.test.sh: ALL PASS"; else echo "leg-rank.test.sh: FAILED"; fi
exit "$fail"
