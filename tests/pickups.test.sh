#!/usr/bin/env bash
# The pickup sweep and the unstarted read (ADR 0057; schedule § 1.2, close step 2): the two read-only verbs of
# skills/_shared/scripts/unfinished-rollout.py.
#   P1-P10  `pickups --repo <path> --tasks <slugs> [--misfit <slug>=<why>]...`: the pool, its order, the Repo rule
#           (counted aggregate only), the gate rule, misfits, the needed set and the extras' dependency closures under
#           the cap of 5, the umbrella project, and its exit 2s, read-only and byte-equal on a rerun
#   N1-N12  `unstarted --rollout <slug> [--handoffs <dir>]...`: closed, serial, started (approved_unrun, or a Run record
#           lead-entry), stamped, incomplete, launched (a handoff doc's `launches:`) or unstarted with its Project root
#           (N12: close step 2's **Stale launch.** read of a launch doc's own `launches:`, with the peer guard)
# Temp vaults, temp git repos with literal origin URLs (only `git remote get-url` reads them), a stub HOME and the Run
# record in temp. No vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR & co.)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
CHECK="$root/skills/_shared/scripts/unfinished-rollout.py"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"; unset XDG_STATE_HOME
mkdir -p "$THREAD_EVENTS_DIR"

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

S=""; T=""; R=""; H=""
# scen <name> — a fresh vault (tasks dir $T), a stub HOME $H and the target repo $R = $H/code/repo
# (origin github.com/demo/repo), so a `~/code/repo` Repo line names it
scen() {
  S="$TMP/$1"; T="$S/vault/Work/Tasks"; H="$S/home"; R="$H/code/repo"; mkdir -p "$T"
  mkrepo "$R" https://github.com/demo/repo.git
  echo "== $1"
}
# mkrepo <dir> <origin-url | -> — a git repo whose origin is that URL ("-": a plain dir, no git)
mkrepo() { mkdir -p "$1"; [ "$2" = "-" ] && return 0; git -c init.defaultBranch=main init -q "$1" && git -C "$1" remote add origin "$2"; }
# mkt <slug> <Repo line value | -> [frontmatter lines...] — an open task note in $T on $PROJ (default "[[Demo]]"),
# tagged $TAGS (default task), at $ST (default open); $BODY goes under ## Notes; "-" writes no ## Launch section
mkt() {
  local s="$1" r="$2"; shift 2
  { printf -- '---\ntags: [%s]\nstatus: %s\nprojects: [%s]\n' "${TAGS:-task}" "${ST:-open}" "${PROJ:-\"[[Demo]]\"}"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n# %s\n\n## Notes\n\n%s\n' "$s" "${BODY:-body}"
    [ "$r" = "-" ] || printf '\n## Launch\n\n- **Launch:** `cc-x`\n- **Repo:** %s\n' "$r"
  } > "$T/$s.md"
}
# pk [args...] -> $out (stdout), $err (stderr), $rc; HOME pinned to $H so a `~/` Repo line resolves there
pk() { HOME="$H" python3 "$CHECK" pickups --tasks-dir "$T" "$@" > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
# j <python expression over d> — a field of $out's JSON, printed (lists comma-joined by the expression itself)
j() { printf '%s' "$out" | python3 -c 'import json, sys; d = json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }
joined() { j '",".join(x["slug"] for x in d["join"])'; }
why() { j "next((x['why'] for x in d['join'] + d['left'] if x['slug'] == '$1'), '<none>')"; }
kind() { j "next((x['kind'] for x in d['join'] if x['slug'] == '$1'), '<none>')"; }
lefts() { j '",".join(x["slug"] for x in d["left"])'; }
# nowhere <slug> — the slug is in no list of $out (order, join, needed, left, beyond, warnings)
nowhere() { ok "$(j "any('\"$1\"' in json.dumps(d[k]) for k in ('order', 'join', 'needed', 'left', 'beyond', 'warnings'))")" False "$2"; }
REPO_LINE() { printf '`%s`' "$1"; }

# ── P1: the brief's Verify: an extra open task on the same repo joins ────────────────────────────────────────
scen p1
mkt a "$(REPO_LINE "$R")"; mkt b "$(REPO_LINE "$R")"; mkt c "$(REPO_LINE "$R")"
pk --repo "$R" --tasks a,b
ok "$rc" 0 "P1: pickups exits 0"
ok "$(joined)" "c" "P1: the extra open task on the same repo joins"
ok "$(kind c)" "extra" "P1: … as an extra"
ok "$(why c)" "open on [[Demo]] on this repo, priority normal" "P1: … with its why"
ok "$(j 'list(d.keys())')" "['projects', 'order', 'join', 'needed', 'left', 'counted', 'beyond', 'warnings', 'cap']" \
  "P1: the keys, in order"
ok "$(j 'd["cap"]')" 5 "P1: the cap is 5"
ok "$(j 'd["projects"]')" "['demo']" "P1: the run's project set"
ok "$err" "" "P1: nothing on stderr"

# ── P2: the Repo rule ────────────────────────────────────────────────────────────────────────────────────────
scen p2
mkrepo "$S/other" https://github.com/demo/other.git
mkrepo "$S/twin" git@github.com:demo/repo.git
mkt a "$(REPO_LINE "$R")"
mkt no-repo -
mkt other-origin "$(REPO_LINE "$S/other")"
mkt gone "$(REPO_LINE "$S/missing")"
mkt prose "$(REPO_LINE "$R") (from \`main\` once \`x\` merged)"
mkt tilde '`~/code/repo/`'
mkt twin "$(REPO_LINE "$S/twin")"
mkt bare "$R some trailing words"
pk --repo "$R" --tasks a
ok "$(joined)" "bare,prose,tilde,twin" "P2: trailing prose, a ~/ path, a bare token and the same origin elsewhere all join"
ok "$(j 'd["counted"]')" "{'another repo': 1, 'no ## Launch repo': 1}" "P2: another origin and no Repo line are counted"
nowhere no-repo "P2: a task with no Repo line is in no list"
nowhere other-origin "P2: a task on another origin is in no list"
ok "$(why gone)" "## Launch repo $S/missing is missing here: its origin is unread" "P2: a missing path is left, named"
ok "$(lefts)" "gone" "P2: … and only it is left"
# --repo with no origin: only paths compare, so the twin is counted
mkrepo "$S/plain" -
mkt p-a "$(REPO_LINE "$S/plain")"; mkt p-b "$(REPO_LINE "$S/plain/")"
pk --repo "$S/plain" --tasks p-a
ok "$(joined)" "p-b" "P2: --repo with no origin: a task on the same path joins"
ok "$(j 'd["counted"]["another repo"]')" 6 "P2: … and every other repo, its twin included, is counted"
has "$err" "WARN: --repo $S/plain is not a git repo with an origin here: only paths are compared" "P2: … with its WARN"

# ── P3: the order, and the cap ───────────────────────────────────────────────────────────────────────────────
scen p3
mkt a "$(REPO_LINE "$R")"
mkt x-high "$(REPO_LINE "$R")" 'priority: high' 'phase: 10'
mkt x-low "$(REPO_LINE "$R")" 'priority: low' 'phase: 1'
mkt x-none "$(REPO_LINE "$R")" 'priority: none'
mkt n-p10 "$(REPO_LINE "$R")" 'phase: 10'
mkt n-p2 "$(REPO_LINE "$R")" 'phase: 2'
mkt n-p30 "$(REPO_LINE "$R")" 'phase: p30'
mkt n-30a "$(REPO_LINE "$R")" 'phase: 30a'
mkt n-empty "$(REPO_LINE "$R")" 'phase:'
mkt n-missing "$(REPO_LINE "$R")" 'priority: bogus'
pk --repo "$R" --tasks a
ok "$rc" 0 "P3: odd phases exit 0"
ok "$(j '",".join(d["order"])')" "x-high,n-p2,n-p10,n-30a,n-empty,n-missing,n-p30,x-low,x-none" \
  "P3: priority, then phase numerically (unparseable last), then slug; unknown priority reads normal, none last"
ok "$(joined)" "x-high,n-p2,n-p10,n-30a,n-empty" "P3: the first five in order join"
ok "$(j '",".join(d["beyond"])')" "n-missing,n-p30,x-low,x-none" "P3: the rest are beyond the cap"
scen p3b
mkt a "$(REPO_LINE "$R")"
for e in e1 e2 e3 e4 e5 e6; do mkt "$e" "$(REPO_LINE "$R")"; done
pk --repo "$R" --tasks a
ok "$(joined)|$(j '",".join(d["beyond"])')" "e1,e2,e3,e4,e5|e6" "P3: six extras give five joins and one beyond"

# ── P4: needed tasks ─────────────────────────────────────────────────────────────────────────────────────────
scen p4
mkt a "$(REPO_LINE "$R")" 'depends-on: ["[[n1]]"]'
mkt b "$(REPO_LINE "$R")" 'depends-on: ["[[g1]]"]'
mkt n1 "$(REPO_LINE "$R")" 'priority: low' 'depends-on: ["[[tomb]]"]'
ST=merged mkt tomb "$(REPO_LINE "$R")" 'merged_into: "[[n2]]"'
mkt n2 "$(REPO_LINE "$R")" 'priority: low'
BODY='This needs usage credits to run.' mkt g1 "$(REPO_LINE "$R")"
for e in e1 e2 e3 e4 e5 e6; do mkt "$e" "$(REPO_LINE "$R")"; done
pk --repo "$R" --tasks a,b
ok "$(j '",".join(d["needed"])')" "n1,n2" "P4: needed is transitive, through a merged_into tombstone"
ok "$(kind n1),$(kind n2)" "needed,needed" "P4: … each joins as needed"
ok "$(why n1)|$(why n2)" "needed by [[a]]|needed by [[n1]]" "P4: … with the task that needs it"
ok "$(j 'sum(x["kind"] == "extra" for x in d["join"])')" 5 "P4: needed tasks are uncapped beside five extras"
ok "$(why g1)" 'gated: spend "credits"' "P4: a needed task with a gate hit is left"
ok "$(j 'd["warnings"]')" "[{'task': 'b', 'dep': 'g1', 'why': 'gated: spend \"credits\"'}]" "P4: … and its dependant is warned"
nowhere tomb "P4: the tombstone itself is no pickup"

# ── P5: the extras' dependency closures, to a fixpoint ───────────────────────────────────────────────────────
scen p5
mkrepo "$S/other" https://github.com/demo/other.git
mkt cand "$(REPO_LINE "$R")"
mkt b "$(REPO_LINE "$R")" 'priority: high' 'depends-on: ["[[a]]"]'
mkt a "$(REPO_LINE "$R")" 'priority: low'
mkt b2 "$(REPO_LINE "$R")" 'priority: high' 'depends-on: ["[[elsewhere]]"]'
mkt elsewhere "$(REPO_LINE "$S/other")"
mkt c1 "$(REPO_LINE "$R")" 'depends-on: ["[[c2]]"]'
mkt c2 "$(REPO_LINE "$R")" 'blocked-by: ["[[c1]]"]'
mkt f1 "$(REPO_LINE "$R")"; mkt f2 "$(REPO_LINE "$R")"
mkt b3 "$(REPO_LINE "$R")" 'priority: low' 'depends-on: ["[[z3]]"]'
mkt z3 "$(REPO_LINE "$R")" 'priority: low'
pk --repo "$R" --tasks cand
ok "$(joined)" "b,a,f1,f2,z3" "P5: an extra and the later-sorting pool task it depends on join together"
ok "$(why a)" "needed by [[b]]" "P5: … the pulled-in dependency names its dependant"
ok "$(why b2)" "depends on [[elsewhere]] (open)" "P5: an extra depending on a task on another repo is left"
ok "$(why c1)|$(why c2)" "a dependency cycle with [[c2]]|a dependency cycle with [[c1]]" "P5: a cycle leaves each member"
ok "$(j '",".join(d["beyond"])')" "b3" "P5: with one slot left, an extra needing two goes beyond while a later single fits"
ok "$(j 'd["counted"]["another repo"]')" 1 "P5: the other-repo dependency is counted, never named but in the why"

# ── P6: exclusions ───────────────────────────────────────────────────────────────────────────────────────────
scen p6
mkt a "$(REPO_LINE "$R")"
printf -- '---\ntags: [task, rollout]\nstatus: open\n---\n' > "$T/ro-live.md"
printf -- '---\ntags: [task, rollout]\nstatus: done\n---\n' > "$T/ro-done.md"
mkt linked-live "$(REPO_LINE "$R")" 'rollout: "[[ro-live]]"'
mkt linked-done "$(REPO_LINE "$R")" 'rollout: "[[ro-done]]"'
TAGS='task, decisions' mkt decision "$(REPO_LINE "$R")"
TAGS='task, rollout' mkt rollout-tagged "$(REPO_LINE "$R")"
TAGS=phase mkt phase-note "$(REPO_LINE "$R")"
ST=merged mkt merged "$(REPO_LINE "$R")"
ST=in_progress mkt running "$(REPO_LINE "$R")"
PROJ='"[[Elsewhere]]"' mkt other-project "$(REPO_LINE "$R")"
mkdir -p "$T/Archive"; mkt archived "$(REPO_LINE "$R")"; mv "$T/archived.md" "$T/Archive/"
pk --repo "$R" --tasks a
ok "$(joined)" "linked-done" "P6: only a task linked to a done rollout joins"
for x in a ro-live ro-done linked-live decision rollout-tagged phase-note merged running other-project archived; do
  nowhere "$x" "P6: $x is in no list"
done
ok "$(j 'sum(d["counted"].values())')" 0 "P6: … and none is counted"

# ── P7: the gate rule ────────────────────────────────────────────────────────────────────────────────────────
scen p7
mkt a "$(REPO_LINE "$R")"
BODY='Buy more credits for the renders.' mkt g-spend "$(REPO_LINE "$R")"
BODY='Rotate the API key first.' mkt g-cred "$(REPO_LINE "$R")"
BODY='Then wipe the staging bucket.' mkt g-irr "$(REPO_LINE "$R")"
BODY='Count the `$HOME` uses.' mkt clean "$(REPO_LINE "$R")"
pk --repo "$R" --tasks a
ok "$(why g-spend)|$(why g-cred)|$(why g-irr)" 'gated: spend "credits"|gated: credential "API key"|gated: irreversible "wipe"' \
  "P7: a spend, credential or irreversible hit leaves the task, never dismissed"
ok "$(joined)" "clean" "P7: a shell variable is no hit"

# ── P8: misfits ──────────────────────────────────────────────────────────────────────────────────────────────
scen p8
mkt a "$(REPO_LINE "$R")" 'depends-on: ["[[n1]]"]'
mkt n1 "$(REPO_LINE "$R")" 'priority: low'
for e in e1 e2 e3 e4 e5 e6; do mkt "$e" "$(REPO_LINE "$R")"; done
pk --repo "$R" --tasks a --misfit e1='needs the headset'
ok "$(joined)" "n1,e2,e3,e4,e5,e6" "P8: a misfit frees its slot for the next in order"
ok "$(why e1)" "needs the headset" "P8: … and is left with its why"
pk --repo "$R" --tasks a --misfit '[[n1]]=an open design question'
ok "$(j 'd["warnings"]')" "[{'task': 'a', 'dep': 'n1', 'why': 'an open design question'}]" "P8: a misfit needed task warns"
pk --repo "$R" --tasks a --misfit nope=x
ok "$rc|$out" "2|" "P8: a misfit naming no pool task exits 2, nothing on stdout"
has "$err" "unfinished-rollout: --misfit nope" "P8: … with its line"
pk --repo "$R" --tasks a --misfit e1
ok "$rc|$out" "2|" "P8: a misfit without =why exits 2"

# ── P9: the umbrella project ─────────────────────────────────────────────────────────────────────────────────
scen p9
PROJ='"[[AVP]]", "[[Art]]"' mkt a "$(REPO_LINE "$R")"
PROJ='"[[AVP]]", "[[Art]]"' mkt b "$(REPO_LINE "$R")"
PROJ='"[[Art]]"' mkt art-repo "$(REPO_LINE "$R")"
PROJ='"[[Art]]"' mkt art-venue -
pk --repo "$R" --tasks a,b
ok "$(j 'd["projects"]')" "['art', 'avp']" "P9: the run's set is the candidates' shared projects"
ok "$(joined)" "art-repo" "P9: an umbrella-only task with a Repo line on this repo joins"
ok "$(why art-repo)" "open on [[Art]] on this repo, priority normal" "P9: … named by its project"
ok "$(j 'd["counted"]["no ## Launch repo"]')" 1 "P9: … and one without a Repo line is counted"
PROJ='"[[X]]"' mkt x1 "$(REPO_LINE "$R")"; PROJ='"[[Y]]"' mkt y1 "$(REPO_LINE "$R")"
pk --repo "$R" --tasks x1,y1
ok "$rc|$(j 'd["order"]')|$(joined)" "0|[]|" "P9: candidates that share no project sweep an empty pool"
has "$err" "WARN: the named tasks share no project: the pickup pool is empty" "P9: … with a WARN"

# ── P10: exit 2s, read-only, no bytecode, byte-equal reruns ─────────────────────────────────────────────────
scen p10
mkt a "$(REPO_LINE "$R")" 'depends-on: ["[[n1]]"]'; mkt n1 "$(REPO_LINE "$R")"; mkt c "$(REPO_LINE "$R")"
pk --repo "$S/nope" --tasks a;                ok "$rc|$out" "2|" "P10: a missing --repo exits 2"
pk --repo "$R" --tasks ghost;                 ok "$rc|$out" "2|" "P10: a --tasks note not found exits 2"
pk --repo "$R";                               ok "$rc|$out" "2|" "P10: no --tasks exits 2"
out=$(HOME="$H" python3 "$CHECK" pickups --tasks-dir "$S/none" --repo "$R" --tasks a 2>/dev/null); rc=$?
ok "$rc|$out" "2|" "P10: a missing tasks dir exits 2"
# a plugin copy without gated_inputs.py: the verb cannot load it (exit 2), while check never needs it
PC="$S/plugin"; mkdir -p "$PC/skills/_shared/scripts" "$PC/skills/execute/scripts" "$PC/skills/schedule"
cp "$CHECK" "$root/skills/_shared/scripts/serial-chains.py" "$root/skills/_shared/scripts/run_record.py" "$PC/skills/_shared/scripts/"
cp "$root/skills/execute/scripts/reconcile-rollout.py" "$PC/skills/execute/scripts/"
cp "$root/skills/schedule/rollout-template.md" "$PC/skills/schedule/"
out=$(env -u PYTHONDONTWRITEBYTECODE HOME="$H" python3 "$PC/skills/_shared/scripts/unfinished-rollout.py" pickups \
  --tasks-dir "$T" --repo "$R" --tasks a 2> "$S.err"); rc=$?
ok "$rc|$out" "2|" "P10: gated_inputs.py unloadable exits 2"
has "$(cat "$S.err")" "cannot load" "P10: … naming the load"
out=$(env -u PYTHONDONTWRITEBYTECODE HOME="$H" python3 "$PC/skills/_shared/scripts/unfinished-rollout.py" check \
  --tasks-dir "$T" --repo "$R" --tasks a 2>/dev/null); rc=$?
ok "$rc|$out" "0|none" "P10: check runs without gated_inputs.py (loaded only by the new verbs)"
cp "$root/skills/_shared/scripts/gated_inputs.py" "$PC/skills/_shared/scripts/"
snap() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum) | shasum; }
before_v=$(snap "$S/vault"); before_r=$(snap "$R")
env -u PYTHONDONTWRITEBYTECODE HOME="$H" python3 "$PC/skills/_shared/scripts/unfinished-rollout.py" pickups \
  --tasks-dir "$T" --repo "$R" --tasks a > "$S.r1" 2>&1
env -u PYTHONDONTWRITEBYTECODE HOME="$H" python3 "$PC/skills/_shared/scripts/unfinished-rollout.py" pickups \
  --tasks-dir "$T" --repo "$R" --tasks a > "$S.r2" 2>&1
ok "$(cat "$S.r1")" "$(cat "$S.r2")" "P10: a rerun is byte-equal"
has "$(cat "$S.r1")" '"needed": ["n1"]' "P10: … and the run read the vault"
ok "$(snap "$S/vault")|$(snap "$R")" "$before_v|$before_r" "P10: the vault and the repo are byte-equal after the runs"
ok "$(find "$PC" -name __pycache__ | wc -l | tr -d ' ')" 0 "P10: no __pycache__ written"

# ── N1-N12: unstarted ────────────────────────────────────────────────────────────────────────────────────────
# mkro <slug> [frontmatter lines...] — a parallel rollout note in $T at $ST (default open); $BODY appended
mkro() {
  local s="$1"; shift
  { printf -- '---\ntags: [rollout]\nstatus: %s\nprotocol_version: 5\n' "${ST:-open}"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n%s\n' "$R" "${BODY:-}"; } > "$T/$s.md"
}
# un [args...] -> $out, $err, $rc
un() { HOME="$H" python3 "$CHECK" unstarted --tasks-dir "$T" "$@" > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
lead() { printf '{"v":1,"ts":"%s","host":"h","rollout":"%s","task":null,"kind":"lead-entry","by":"stage"}\n' "$2" "$1" >> "$THREAD_EVENTS_DIR/$1.jsonl"; }

scen n
mkro ro-fresh; mkt t1 - 'rollout: "[[ro-fresh]]"'
un --rollout ro-fresh
ok "$out|$rc" "unstarted ro-fresh $R|0" "N1: a fresh note reads unstarted, with its Project root"
un --rollout '[[ro-fresh]]'
ok "$out" "unstarted ro-fresh $R" "N1: … by its wikilink too"
mkro ro-owned; mkt t2 - 'rollout: "[[ro-owned]]"' 'owner: lead-1234'
un --rollout ro-owned
ok "$out" "started ro-owned (its task t2 carries owner: lead-1234)" "N2: a task's owner: reads started"
mkro ro-stamp 'start: unattended'
un --rollout ro-stamp
ok "$out" "stamped ro-stamp (start: unattended)" "N3: start: unattended reads stamped"
mkro ro-su 'started_unattended: 2026-10-27T10:00+11:00'
un --rollout ro-su
ok "$out" "stamped ro-su (started_unattended: 2026-10-27T10:00+11:00)" "N3: started_unattended: reads stamped"

HD="$S/handoffs"; HE="$S/handoffs2"; mkdir -p "$HD" "$HE"
mkro ro-l1; mkro ro-l2; mkro ro-l3
printf -- '---\nthread: x\nwritten: 2026-10-28\nstatus: consumed\nlaunches: "[[ro-l1]]"\n---\nbody\n' > "$HD/2026-10-28-l1.md"
printf -- '---\r\nthread: x\r\nstatus: pending\r\nlaunches: "[[RO-L2]]"\r\n---\r\nbody\r\n' > "$HE/2026-10-28-l2.md"
printf -- '---\nthread: x\nstatus: pending\n---\nlaunches: "[[ro-l3]]"\n' > "$HD/2026-10-28-body-only.md"
printf -- '---\nthread: x\nstatus: pending\nlaunches: "[[ro-other]]"\n---\nbody\n' > "$HD/2026-10-28-other.md"
un --rollout ro-l1 --handoffs "$HD" --handoffs "$HE"
ok "$out" "launched ro-l1 $HD/2026-10-28-l1.md (consumed)" "N4: a consumed launch doc reads launched"
un --rollout ro-l2 --handoffs "$HD" --handoffs "$HE"
ok "$out" "launched ro-l2 $HE/2026-10-28-l2.md (pending)" "N4: a pending CRLF launch doc, case-folded, reads launched"
un --rollout ro-l3 --handoffs "$HD"
ok "$out" "unstarted ro-l3 $R" "N4: launches: in the body only is no launch"
un --rollout ro-l1
ok "$out" "unstarted ro-l1 $R" "N4: with no --handoffs the doc is not read"

mkro ro-held 'hold_until: {pr: o/r#1, merged: false}'
lead ro-held 2026-10-28T01:00:00.000Z
un --rollout ro-held
ok "$out" "started ro-held (a lead entered 2026-10-28T01:00:00.000Z)" "N5: a lead-entry with no owner: reads started"
mkro ro-bad; mkdir -p "$THREAD_EVENTS_DIR/ro-bad.jsonl"
un --rollout ro-bad
ok "$out|$rc" "unstarted ro-bad $R|0" "N5: an unreadable Run record reads as none"

ST=done mkro ro-done
un --rollout ro-done
ok "$out" "closed ro-done (done)" "N6: a done note reads closed"
mkro ro-arch; mkdir -p "$T/Archive/Rollouts"; mv "$T/ro-arch.md" "$T/Archive/Rollouts/"
un --rollout ro-arch
ok "$out" "closed ro-arch (archived)" "N6: a note only under Archive/ reads closed"
mkro ro-serial 'shape: serial'
un --rollout ro-serial
ok "$out" "serial ro-serial" "N7: a serial note reads serial"
mkro ro-inc 'incomplete: true'
un --rollout ro-inc
has "$out" "incomplete ro-inc (it carries incomplete: true" "N8: incomplete: true reads incomplete"
un --rollout ro-ghost
ok "$rc|$out" "2|" "N9: a missing note exits 2, nothing on stdout"
has "$err" "unfinished-rollout: --rollout ro-ghost" "N9: … with its line"
BODY=$'## Pause log\n\n- 2026-10-01T10:00+00:00 room stop: L1 at its 5-hour line; stopping at a step boundary: none; lane: none\n- 2026-10-01T11:00+00:00 room stop ended' \
  mkro ro-aq 'start: unattended' 'hold_until: {pr: o/r#202, merged: false}' 'on_merge: regenerate'
un --rollout ro-aq
ok "$out" "stamped ro-aq (start: unattended)" "N10: an approved queue whose room stops ended reads stamped"

# N11: a withdrawn launch (its doc removed, another slug's left) reads unstarted, unless a lead entered
mkro ro-w; HW="$S/handoffs-w"; mkdir -p "$HW"
printf -- '---\nstatus: pending\nlaunches: "[[ro-w]]"\n---\nbody\n' > "$HW/2026-10-28-w.md"
printf -- '---\nstatus: pending\nlaunches: "[[ro-x]]"\n---\nbody\n' > "$HW/2026-10-28-x.md"
un --rollout ro-w --handoffs "$HW"
ok "$out" "launched ro-w $HW/2026-10-28-w.md (pending)" "N11: before the withdrawal it reads launched"
rm -f "$HW/2026-10-28-w.md"
un --rollout ro-w --handoffs "$HW"
ok "$out" "unstarted ro-w $R" "N11: with its launch doc withdrawn it reads unstarted"
lead ro-w 2026-10-28T02:00:00.000Z
un --rollout ro-w --handoffs "$HW"
ok "$out" "started ro-w (a lead entered 2026-10-28T02:00:00.000Z)" "N11: … unless the withdrawn lead had entered"

# N12: close step 2's **Stale launch.**: each pending launch doc's `launches:` value, passed as it stands with no
# --handoffs, reads closed for a done or archived rollout (stale at once), started once a lead entered (stale only
# when the peer guard prints delete: the doc 24 h or more old), and unstarted or stamped otherwise (left for its lead)
HS="$S/handoffs-s"; mkdir -p "$HS" "$T/Archive/Rollouts"
ST=done mkro ro-sd; mkro ro-sa; mv "$T/ro-sa.md" "$T/Archive/Rollouts/"; mkro ro-ss; mkro ro-sf; mkro ro-st 'start: unattended'
lead ro-ss 2026-10-27T01:00:00.000Z
for s in ro-sd ro-sa ro-ss ro-sf ro-st; do
  printf -- '---\nthread: x\nwritten: 2026-10-26\nstatus: pending\nlaunches: "[[%s]]"\n---\nbody\n' "$s" > "$HS/$s.md"
done
# lv <doc> — the doc's front-matter `launches:` value as it stands (quotes and brackets kept)
lv() { awk 'NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^launches:/{sub(/^launches:[ \t]*/, ""); print; exit}' "$1"; }
ok "$(lv "$HS/ro-sd.md")" '"[[ro-sd]]"' "N12: the value is read from the front matter as it stands"
un --rollout "$(lv "$HS/ro-sd.md")"
ok "$out|$rc" "closed ro-sd (done)|0" "N12: a done rollout's launch doc reads closed (stale at once)"
un --rollout "$(lv "$HS/ro-sa.md")"
ok "$out" "closed ro-sa (archived)" "N12: an archived rollout's reads closed (stale at once)"
un --rollout "$(lv "$HS/ro-ss.md")"
ok "$out" "started ro-ss (a lead entered 2026-10-27T01:00:00.000Z)" "N12: a rollout a lead entered reads started"
un --rollout "$(lv "$HS/ro-sf.md")"
ok "$out" "unstarted ro-sf $R" "N12: with no --handoffs a fresh rollout reads unstarted, never its own launch (left for its lead)"
un --rollout "$(lv "$HS/ro-st.md")"
ok "$out" "stamped ro-st (start: unattended)" "N12: a stamped rollout reads stamped (left for its lead)"
awk '/^# thread:peer-guard/{on=1; next} /^# end thread:peer-guard/{on=0} on' \
  "$root/skills/_shared/handoff-lifecycle.md" > "$S.guard"
cp "$HS/ro-ss.md" "$HS/ro-ss-fresh.md"; touch -t 202001010000 "$HS/ro-ss.md"
ok "$(f="$HS/ro-ss.md" bash "$S.guard")" delete "N12: a started rollout's launch doc 24 h or more old: the peer guard prints delete (stale)"
ok "$(f="$HS/ro-ss-fresh.md" bash "$S.guard")" "keep fresh" "N12: … and a fresh one keep fresh (left for its lead)"
before_v=$(snap "$S/vault")
un --rollout ro-fresh --handoffs "$HD"
ok "$(snap "$S/vault")" "$before_v" "N: unstarted writes nothing"

[ "$fail" = 0 ] && echo "pickups: ALL PASS" || echo "pickups: SOME FAILED"
exit "$fail"
