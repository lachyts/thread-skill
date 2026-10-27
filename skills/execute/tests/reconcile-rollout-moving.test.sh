#!/usr/bin/env bash
# p29-7 (ADR 0048): no single cause holds the whole queue. reconcile-rollout.py `moving`, the Watchdog's read-only
# verdict (moving | stalled | waiting | skip), and the narrowings it reads: the Lane hold (`lane-hold` / `lane-ack`, `next`'s
# `lane` entry and halt), prepare's and merge-task's task-scoped set-asides, the lead's infra set-asides, a task-level
# invalid round budget (H12, never a halt) and the wait clauses' inputs.
#   S1 stop_spans' reason and index   M1-M21 the verdicts   N1-N9b the narrowings, each through the real verbs
# Each scenario builds its own tasks dir, Run record (run_record.py emit --ts for the past), HOME and THREAD_MACHINE_TIMES,
# so nothing reads this machine's history; a stub gh stands in for every PR read. Temp notes only; no vault, no network.
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR per scenario and ignores THREAD_TEST_EVENTS_DIR.
# Usage: bash reconcile-rollout-moving.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
RRPY="$HERE/../../_shared/scripts/run_record.py"
PLUGIN="$(cd "$HERE/../../.." && pwd)"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # away_file; THREAD_HEAT_LEVEL=0
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR XDG_STATE_HOME
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export THREAD_MACHINE_TIMES='{}'
export THREAD_HEAT_LEVEL=0
NOW=2026-10-26T12:00:00Z
RO=proj-rollout-2026-10-26
PR=https://github.com/o/r/pull/5
A40=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; B40=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; C40=cccccccccccccccccccccccccccccccccccccccc

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), ensure_ascii=False))' "$2"; }

D=""
# scen <name>: a fresh tasks dir $D, its Project root ($D/root, a git repo), its own Run record dir, a stub gh, and a
# HOME whose fresh Away file lifts the Mac-wide cap (each rollout runs to its own ceiling) unless a case writes its own.
scen() {
  D="$TMP/$1"; mkdir -p "$D/root" "$D/bin" "$D/gh" "$D/home"; echo "== $1"
  git -c init.defaultBranch=master init -q "$D/root"
  export THREAD_EVENTS_DIR="$D/events" THREAD_GIT_ENV_DIR="$D/git-env" GHDIR="$D/gh" HOME="$D/home"
  export THREAD_MACHINE_TIMES='{}' THREAD_HEAT_LEVEL=0
  away_file "$D/home" 2026-10-26T00:00:00Z true 2099-01-01T00:00:00Z 2 09:00 99
  cat > "$D/bin/gh" <<'EOF'
#!/usr/bin/env bash
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
case "$1 $2" in
  "pr view") f="$GHDIR/pr-$(key "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1 ;;
esac
echo "unexpected gh call: $*" >&2; exit 2
EOF
  chmod +x "$D/bin/gh"
  QUEUE="a b c"
}
prj() { printf '{"state":"%s","mergedAt":null,"url":"%s"}\n' "$2" "${3:-https://github.com/o/r/pull/x}" > "$D/gh/pr-$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_').json"; }
# mkro [frontmatter lines...]: the rollout note $D/$RO.md, Project root $D/root, `## Queue` listing $QUEUE.
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nprojects:\n  - "[[Proj]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s/root`\n\n## Queue\n\n' "$D"
    for s in $QUEUE; do printf -- '- [[%s]]\n' "$s"; done; } > "$D/$RO.md"
}
# mkt <slug> <status> [frontmatter lines...]: a task note of the rollout.
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[%s]]"\n' "$st" "$RO"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
setfm() {  # setfm <note> <key> <value>
  python3 - "$D/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
head, body = t.split("\n---\n", 1)
lines = head.split("\n")
idx = [i for i, l in enumerate(lines) if re.match(r"^%s:" % re.escape(k), l)]
if idx:
    lines[idx[0]] = "%s: %s" % (k, v)
else:
    lines.append("%s: %s" % (k, v))
open(p, "w").write("\n".join(lines) + "\n---\n" + body)
PY
}
em() {  # em <kind> <task|-> <json> <ts>: one past Run-record line of $RO, through the one writer
  if [ "$2" = - ]; then python3 "$RRPY" emit --rollout "$RO" --kind "$1" --json "$3" --ts "$4"
  else python3 "$RRPY" emit --rollout "$RO" --kind "$1" --task "$2" --json "$3" --ts "$4"; fi || { echo "FAIL - emit $1 refused"; fail=1; }
}
entry() { em lead-entry - '{"by":"heartbeat","session":"S"}' "$1"; }
halted() { em stopped - "{\"cause\":\"halt\",\"inferred\":false,\"calls\":[],\"reason\":\"$1\"}" "$2"; }
mv() { python3 "$SCRIPT" moving --rollout "$D/$RO.md" --tasks-dir "$D" --now "${MNOW:-$NOW}" --gh-bin "$D/bin/gh" "$@"; }
vc() { j "$(mv "$@")" '[d["verdict"], d["cause"]]'; }
vcr() { j "$(mv "$@")" '[d["verdict"], d["cause"], d["reason"]]'; }
nx() { python3 "$SCRIPT" next --rollout "$D/$RO.md" --tasks-dir "$D" --now "${MNOW:-$NOW}" --gh-bin "$D/bin/gh" --dry-run "$@"; }
st() { python3 "$SCRIPT" status --rollout "$D/$RO.md" --tasks-dir "$D" --now "${MNOW:-$NOW}"; }
rec() { python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${2:-2026-10-26T08:00:00Z}" <<<"$1" >/dev/null; }
# lead <slug> <kind> <reason> [now]: the lead's own set-aside row (lead-integrate.py set-aside), reconciled
lead() { printf '%s' "$3" | python3 "$LI" set-aside --note "$D/$1.md" --kind "$2" | python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${4:-2026-10-26T08:00:00Z}" >/dev/null; }
inp() { python3 "$LI" inputs --note "$D/$1.md" --now "${INOW:-$NOW}" "${@:2}"; }
lh() {  # lh <slug> <cause> <evidence>: lane-hold; $out, $rc
  out=$(printf '%s\n' "$3" | python3 "$SCRIPT" lane-hold --rollout "$D/$RO.md" --tasks "$1" --cause "$2" --tasks-dir "$D" --now "${MNOW:-$NOW}" 2>&1); rc=$?
}
la() { out=$(python3 "$SCRIPT" lane-ack --rollout "$D/$RO.md" --tasks "$1" --fix "$2" --tasks-dir "$D" --now "${MNOW:-$NOW}" 2>&1); rc=$?; }
evs() { python3 -c 'import json,sys
try: L=[json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
except FileNotFoundError: L=[]
print(json.dumps([[d["kind"], d.get("task"), d.get("release") or d.get("hold")] for d in L if d["kind"] in sys.argv[2].split(",")], separators=(",", ":")))' "$THREAD_EVENTS_DIR/$RO.jsonl" "$1"; }
integrating() { mkt "$1" review "pr: $PR" "owner: lead" "ready: 2026-10-26T07:00+00:00" "integrating: 2026-10-26T08:00+00:00"; }
running() { mkt "$1" in_progress "owner: lead" "started: 2026-10-26T08:00+00:00"; }
# setaside_infra <slug> <stamp>: a task set aside at its run by a non-quota dead call (infra; A10's shape)
setaside_infra() { running "$1"; lead "$1" own "workflow call failed: no result row" "$2"; }

# ── S1: stop_spans pairs each span with its own stopped line (reason, index) ─────────────────────────────────────
scen s1
mkro; running a
entry 2026-10-26T09:00:00Z
halted "RACE undecided: [[x]]" 2026-10-26T09:10:00Z
em stopped - '{"cause":"dead-lead","inferred":true,"calls":[],"at":"2026-10-26T09:20:00.000Z"}' 2026-10-26T09:05:00Z
em paused - '{"mode":"hard"}' 2026-10-26T09:30:00Z
ok "$(python3 - "$SCRIPT" "$RO" <<'PY'
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
lines = rr._record_read(sys.argv[2])
print(json.dumps([[s["cause"], s["reason"], s["index"], s["end"] is not None, sorted(s)] for s in rr.stop_spans(lines)], separators=(",", ":")))
PY
)" '[["dead-lead","",2,true,["cause","end","index","reason","start"]],["halt","RACE undecided: [[x]]",1,true,["cause","end","index","reason","start"]]]' \
  "S1: each span carries its own line's reason and file index (the dead-lead's \"\"), the old keys unchanged"

# ── M1 / M2: an in_progress task, its lead silent for 2 h → stalled silent; 10 min → moving ──────────────────────
scen m1
mkro; running a; mkt b open; mkt c open
entry 2026-10-26T10:00:00Z
J=$(mv); rc=$?
ok "$rc" 0 "M1: exit 0"
ok "$(j "$J" '[d["verdict"], d["cause"], d["reason"], d["ageMinutes"], d["stallAfter"], d["lastEvent"]]')" \
  '["stalled","silent","no life sign for 120m",120,45,"2026-10-26T10:00:00.000Z"]' "M1: stalled silent, 120 m, the last life sign named"
ok "$(j "$J" 'sorted(d)')" '["ageMinutes","cause","lastEvent","reason","rollout","stallAfter","until","verdict","work"]' "M1: the keys"
ok "$(j "$J" 'd["work"]["running"]')" '["a"]' "M1: work names the running task"
ok "$(printf '%s' "$J" | wc -l | tr -d ' ')" 0 "M1: one compact line"
entry 2026-10-26T11:50:00Z
ok "$(vc)" '["moving",null]' "M2: a 10-minute-old lead-entry → moving"
ok "$(vc --stall-after 5)" '["stalled","silent"]' "M2: --stall-after 5 → stalled"

# ── M3 / M3b: a hard pause → paused; the real await-sign-off → sign-off ────────────────────────────────────────
scen m3
mkro "paused: 2026-10-26T09:00+00:00"; running a
entry 2026-10-26T08:00:00Z
ok "$(vcr)" '["waiting","paused","paused at user request"]' "M3: a stamped pause → waiting paused, never stalled"
scen m3b
QUEUE="g"; mkro; mkt g gate-pending "owner: lead"
printf '\n## Gated inputs (awaiting sign-off)\n\n- spend: one run — cap 5 USD\n' >> "$D/g.md"
python3 "$SCRIPT" await-sign-off --rollout "$D/$RO.md" --tasks-dir "$D" --now 2026-10-26T09:00:00Z >/dev/null 2>&1
ok "$(grep -c '^paused_for: sign-off' "$D/$RO.md")" 1 "M3b: await-sign-off stamped paused_for: sign-off"
ok "$(vc)" '["waiting","sign-off"]' "M3b: sign-off, read before the paused: it stamps beside it"

# ── M4 / M5: held only by the Trickle → trickle; only by the Away cap → away-cap ────────────────────────────────
scen m4
mkro; mkt q open "owner: lead"
OTHER=other-rollout-2026-10-26
printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\n---\n\n## Queue\n\n- [[o1]]\n- [[o2]]\n' > "$D/$OTHER.md"
for t in o1 o2; do printf -- '---\ntags: [task]\nstatus: in_progress\nowner: lead-o\nrollout: "[[%s]]"\n---\n' "$OTHER" > "$D/$t.md"; done
QUEUE="q"; mkro
rm -f "$D/home/.config/thread/away.json"; away_file "$D/home" 2026-10-26T00:00:00Z false 2099-01-01T00:00:00Z 2 09:00 99
entry 2026-10-26T08:00:00Z
ok "$(vcr)" '["waiting","trickle","trickle: 2/2 tasks running on this Mac"]' "M4: the Trickle alone → a meant wait naming it, whatever the silence"
away_file "$D/home" 2026-10-26T00:00:00Z true 2099-01-01T00:00:00Z 1 09:00 2
ok "$(vcr)" '["waiting","away-cap","away cap: 2/2 tasks running on this Mac"]' "M5: the Away cap alone → away-cap"

# ── M6 / M6b: a room stop under its bound → room-stop; one 7 h old → stalled usage-limit ───────────────────────
scen m6
mkro; running a
entry 2026-10-26T10:50:00Z
printf '\n## Pause log\n\n- 2026-10-26T11:00+00:00 room stop: Login at its 5-hour line\n' >> "$D/$RO.md"
em stopped - '{"cause":"usage-limit","inferred":false,"calls":[],"reason":"Login at its 5-hour line"}' 2026-10-26T11:00:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["until"]]')" '["waiting","room-stop","2026-10-26T17:00+00:00"]' "M6: room-stop until its stamp + 6 h"
MNOW=2026-10-26T18:00:00Z
ok "$(vcr)" '["stalled","usage-limit","no life sign for 420m"]' "M6b: past its bound, by silence: usage-limit"
unset MNOW

# ── M7 family: an open halt H ────────────────────────────────────────────────────────────────────────────────
scen m7
mkro; mkt a open
entry 2026-10-26T11:00:00Z
halted "RACE undecided: [[x]]" 2026-10-26T11:01:00Z
ok "$(vcr)" '["stalled","halt","RACE undecided: [[x]]: the halt holds more than it threatens"]' \
  "M7: a RACE halt beside a startable task → stalled halt at once, its reason read through the span's index"
scen m7b
mkro; mkt a open
entry 2026-10-26T11:00:00Z; halted "rollout settings refused" 2026-10-26T11:01:00Z
ok "$(vcr)" '["waiting","you","rollout settings refused"]' "M7b: a kept whole halt with work → waiting you"
scen m7c
QUEUE="b"; mkro; setaside_infra b 2026-10-26T08:00:00Z
setfm b auto_retries 0
entry 2026-10-26T11:00:00Z; halted "nothing can start: 1 set aside" 2026-10-26T11:01:00Z
ok "$(vcr)" '["waiting","you","nothing can start: 1 set aside"]' "M7c: nothing startable → you, the halt's reason"
scen m7d
QUEUE="a b"; mkro; integrating a
lh a merge-task-abort "merge-task exited 70"
setaside_infra b 2026-10-26T08:00:00Z
entry 2026-10-26T08:04:00Z; halted "lane held: merge-task-abort on [[a]]" 2026-10-26T08:04:30Z
MNOW=2026-10-26T08:05:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["until"], d["reason"]]')" \
  '["waiting","cool-down","2026-10-26T08:15+00:00","infra cool-down: [[b]] retries at 2026-10-26T08:15+00:00"]' "M7d: at T+5 the cool-down, never the halt"
MNOW=2026-10-26T08:20:00Z
ok "$(vc)" '["stalled","halt"]' "M7d: at T+20 the retry is work: the lane halt holds more than it threatens"
unset MNOW
scen m7e
mkro; mkt a open
entry 2026-10-26T11:00:00Z; halted "lead-integrate.py failed on [[a]]" 2026-10-26T11:01:00Z
ok "$(vc)" '["waiting","you"]' "M7e: lead-integrate.py failed on (kept whole) → you"

# ── M8 / M8b: a boot after L → mac-restart; a fresh wake → moving ──────────────────────────────────────────────
scen m8
mkro; running a
entry 2026-10-26T09:00:00Z
THREAD_MACHINE_TIMES='{"boot":"2026-10-26T10:00:00Z"}' J=$(mv)
ok "$(j "$J" '[d["verdict"], d["cause"], d["reason"]]')" '["stalled","mac-restart","no life sign for 180m"]' "M8: a boot after L → mac-restart"
ok "$(THREAD_MACHINE_TIMES='{"wake":"2026-10-26T11:50:00Z"}' vc)" '["moving",null]' "M8b: a fresh wake restarts the silence"

# ── M9 / M9b: a future infra autoRetryAfter → cool-down; past due → stalled ─────────────────────────────────────
scen m9
QUEUE="b"; mkro; setaside_infra b 2026-10-26T11:50:00Z
entry 2026-10-26T10:00:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["until"], d["work"]["coolDown"]]')" \
  '["waiting","cool-down","2026-10-26T12:05+00:00",[{"slug":"b","class":"infra","until":"2026-10-26T12:05+00:00"}]]' "M9: cooling → cool-down with until"
MNOW=2026-10-26T12:50:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["work"]["reentry"]]')" '["stalled","silent",["b"]]' "M9b: past due, the retry is work: stalled (the set-aside's own lines were the last life sign)"
unset MNOW

# ── M10 / M11 / M12 ──────────────────────────────────────────────────────────────────────────────────────────────
scen m10
mkro; mkt a open "owner: lead"
entry 2026-10-26T08:00:00Z
THREAD_HEAT_LEVEL=2 J=$(mv)
ok "$(j "$J" '[d["verdict"], d["cause"], d["reason"]]')" '["waiting","heat","heat: the Mac is hot (heavy)"]' "M10: the Heat hold → heat"
scen m11
mkro; mkt a open; mkt b open
ok "$(vc)" '["waiting","not-started"]' "M11: never started, no lead-entry → not-started"
scen m12
mkro "shape: serial"; running a
ok "$(vc)" '["skip","shape: serial (a serial rollout runs as Legs)"]' "M12: serial → skip"
mkro 'superseded_by: "[[x-rollout-2026-10-27]]"'
ok "$(j "$(mv)" 'd["verdict"]')" '"skip"' "M12: superseded → skip"
mkro; setfm "$RO" status done
ok "$(j "$(mv)" 'd["verdict"]')" '"skip"' "M12: done → skip"
mkro; mkdir -p "$D/Archive"; cp "$D/$RO.md" "$D/Archive/$RO.md"
ok "$(python3 "$SCRIPT" moving --rollout "$D/Archive/$RO.md" --tasks-dir "$D" --now "$NOW" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["verdict"], d["cause"])')" "skip archived" "M12: archived → skip"

# ── M13: moving writes nothing (the notes, the record, the locks, the claims file, HOME), and no bytecode ───────────
scen m13
QUEUE="a b c q"; mkro "pause_requested: true"; running a; integrating b; setaside_infra c 2026-10-26T11:58:00Z; mkt q open
entry 2026-10-26T09:00:00Z
mkdir -p "$THREAD_NOTE_LOCK_DIR"
snap() { find "$D" "$THREAD_NOTE_LOCK_DIR" -type f -print0 | sort -z | xargs -0 stat -f '%N %m %z' 2>/dev/null | shasum | cut -c1-16; }
before=$(snap)
mv >/dev/null; mv --stall-after 10 >/dev/null
ok "$(snap)" "$before" "M13: every file under the tasks dir, the record dir, HOME and the lock dir unchanged"
ok "$(find "$THREAD_NOTE_LOCK_DIR" "$D/home" "$TMP" -name 'trickle-claims.json' | wc -l | tr -d ' ')" 0 "M13: no claims file appears (and no new lock: the snapshot above)"
CP="$TMP/plugin-copy"; mkdir -p "$CP"; cp -R "$PLUGIN/skills" "$CP/"; find "$CP" -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null
(unset PYTHONDONTWRITEBYTECODE; python3 "$CP/skills/execute/scripts/reconcile-rollout.py" moving --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" --gh-bin "$D/bin/gh" >/dev/null)
ok "$(find "$CP" -name __pycache__ | wc -l | tr -d ' ')" 0 "M13: no __pycache__ in a copy of the plugin layout, run without -B"

# ── M14: usage and lost looks ───────────────────────────────────────────────────────────────────────────────
scen m14
mkro; running a
out=$(mv --stall-after 0 2>&1); rc=$?; ok "$rc" 2 "M14: --stall-after 0 → exit 2"
out=$(mv --stall-after 1441 2>&1); rc=$?; ok "$rc" 2 "M14: --stall-after 1441 → exit 2"
out=$(python3 "$SCRIPT" moving --rollout "$D/missing.md" --tasks-dir "$D" 2>&1); rc=$?
ok "$rc" 1 "M14: a missing note → exit 1"; has "$out" "(a lost look, never a stall)" "M14: … named a lost look"
printf 'no frontmatter\n' > "$D/$RO.md"
out=$(mv 2>&1); rc=$?; ok "$rc" 1 "M14: broken rollout frontmatter → exit 1"

# ── M15 family: an approved queue's regenerate ──────────────────────────────────────────────────────────────────
scen m15
QUEUE="a"; mkro 'hold_until: {pr: o/r#202, merged: true}' 'on_merge: regenerate'; mkt a open "projects: [\"[[Proj]]\"]"
prj https://github.com/o/r/pull/202 MERGED
entry 2026-10-26T11:10:00Z
J=$(mv)
ok "$(j "$J" '[d["verdict"], d["cause"], d["until"], d["work"]["halt"]]')" '["waiting","regenerating","2026-10-26T13:10+00:00","regenerate"]' \
  "M15: halt regenerate, 50 m silent → regenerating, until the base + 120"
ok "$(MNOW=2026-10-26T13:20:00Z vc)" '["stalled","silent"]' "M15: at 130 m → stalled"
halted "approved queue: regenerate stopped: schedule refused" 2026-10-26T11:15:00Z
ok "$(vcr)" '["waiting","you","approved queue: regenerate stopped: schedule refused"]' "M15: an open regenerate-stopped halt → you"
scen m15b
QUEUE="a r"; mkro 'hold_until: {pr: o/r#202, merged: true}' 'on_merge: regenerate'; mkt a open "projects: [\"[[Proj]]\"]"
mkt r in_progress "started: 2026-10-26T08:00+00:00"   # running, with no owner: (an owner: is a run mark: a plain release)
prj https://github.com/o/r/pull/202 MERGED
entry 2026-10-26T11:10:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["work"]["running"], d["work"]["halt"]]')" '["waiting","regenerating",["r"],"regenerate"]' \
  "M15b: a running task beside the regenerate at 50 m → regenerating, never stalled and never moving"
ok "$(MNOW=2026-10-26T13:20:00Z vcr)" '["stalled","silent","no life sign for 130m"]' "M15c: at 130 m → stalled silent"

# ── M16 / M17 family ────────────────────────────────────────────────────────────────────────────────────────────
scen m16
mkro; running a
ok "$(vcr)" '["stalled","silent","no life sign in the Run record"]' "M16: work with an empty record → stalled silent"
scen m17
mkro "pause_requested: true"; mkt a open "owner: lead"
entry 2026-10-26T08:00:00Z
cp "$D/$RO.md" "$D/ro.before"
ok "$(vc)" '["waiting","paused"]' "M17: a drained soft pause (next reports halt paused) → paused"
cmp -s "$D/$RO.md" "$D/ro.before"; ok "$?" 0 "M17: the drain is only in memory: the note is byte-identical"
scen m17b
QUEUE="a"; mkro "pause_requested: true"; integrating a
lh a merge-task-abort "merge-task exited 70"
entry 2026-10-26T11:50:00Z
ok "$(j "$(nx)" '[d["halt"], d["pauseRequested"], d["paused"]]')" '["lane",true,null]' "M17b: next: halt lane, pauseRequested, not drained"
ok "$(vcr)" '["waiting","you","lane held: merge-task-abort on [[a]]"]' "M17b: a soft pause behind a lane verdict → you, its ack never hidden"
halted "lane held: merge-task-abort on [[a]]" 2026-10-26T11:55:00Z
ok "$(vcr)" '["waiting","you","lane held: merge-task-abort on [[a]]"]' "M17b: with the halt recorded → the same you, from H"
scen m17c
QUEUE="a"; mkro "paused: 2026-10-26T09:00+00:00"; integrating a
lh a merge-task-abort "merge-task exited 70"
entry 2026-10-26T11:50:00Z
ok "$(vc)" '["waiting","paused"]' "M17c: a stamped pause beside a Lane hold → paused (his act)"
ok "$(j "$(st)" '[h["slug"] for h in d["laneLog"]]')" '["a"]' "M17c: status's laneLog still lists it"

# ── M18: a lane hold on an unreadable note, nothing else → you ──────────────────────────────────────────────────
scen m18
QUEUE="a"; mkro; integrating a
printf 'not a note\n' > "$D/a.md"
lh a integrate-env "lead-integrate prepare: task note unreadable: no frontmatter"
entry 2026-10-26T11:50:00Z
ok "$(vcr)" '["waiting","you","lane held: integrate-env on [[a]]"]' "M18: the unreadable task shows through laneHold"

# ── M19 family: a Merge hold, judged by silence ─────────────────────────────────────────────────────────────────
scen m19
QUEUE="a"; mkro; integrating a
em lane-taken a '{}' 2026-10-26T08:00:00Z
em hold-started a '{"hold":"merge"}' 2026-10-26T08:01:00Z
entry 2026-10-26T11:50:00Z
ok "$(vcr)" '["waiting","merge-hold","merge hold on [[a]]"]' "M19: a live lead's merge hold → merge-hold"
MNOW=2026-10-26T13:50:00Z
ok "$(vcr)" '["stalled","silent","no life sign for 120m"]' "M19b: 2 h silent → stalled"
ok "$(THREAD_MACHINE_TIMES='{"boot":"2026-10-26T12:00:00Z"}' vc)" '["stalled","mac-restart"]' "M19c: a boot after L → mac-restart"
unset MNOW
scen m19d
QUEUE="a"; mkro; integrating a
em lane-taken a '{}' 2026-10-26T08:00:00Z
em hold-started a '{"hold":"merge"}' 2026-10-26T08:01:00Z
python3 - "$THREAD_EVENTS_DIR/$RO.jsonl" <<'PY'
import json, sys
p = sys.argv[1]; L = [json.loads(x) for x in open(p).read().splitlines() if x.strip()]
open(p, "w").write("".join(json.dumps(d) + "\n" for d in L if d["kind"] != "lead-entry"))
PY
ok "$(j "$(MNOW=2026-10-26T08:10:00Z mv)" '[d["verdict"], d["cause"]]')" '["waiting","merge-hold"]' "M19d: (control) its own lines are life signs"
ok "$(vc)" '["stalled","silent"]' "M19d: no lead-entry, the last line 4 h old → stalled"
em hold-ended a '{"hold":"merge"}' 2026-10-26T09:50:00Z
ok "$(j "$(mv)" '[d["verdict"], d["work"]["lane"]]')" '["stalled",true]' "M19e: the hold ended, 2 h old → stalled through W (the lane is work again)"

# ── M20: a cap-held seeded revise ──────────────────────────────────────────────────────────────────────────────────
REVISE='revise: rejected at Integration re-review — revise on the branch, then re-integrate'
revise_row() {
  local DIAG="$REVISE

Round 1 (Integration) rejection:
- the merge dropped the retry guard"
  local EXTRA="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"stage\":\"integration\",\"feedback\":[\"the merge dropped the retry guard\"]}],\"integration\":{\"outcome\":\"rejected\",\"path\":\"judge-only\",\"headSha\":\"$B40\",\"baseSha\":\"$C40\",\"anchor\":{\"headSha\":\"$A40\"},\"metrics\":{\"startedAt\":\"2026-10-26T07:00:00Z\"}}}"
  rec "$(python3 -c 'import json,sys
r = {"slug": sys.argv[1], "scope": "cross-cutting", "status": "blocked", "prUrl": "", "blockerDiagnosis": sys.argv[2]}
r.update(json.loads(sys.argv[3])); print(json.dumps({"rolloutSlug": "ro", "tasks": [r]}))' "$1" "$DIAG" "$EXTRA")"
}
m20() {
  scen "$1"
  QUEUE="v"; mkro "max_review_rounds: 4"
  mkt v review "pr: $PR" "owner: lead" "ready: 2026-10-26T06:00+00:00" "integrating: 2026-10-26T07:00+00:00"
  revise_row v
  prj "$PR" OPEN "$PR"
  OTHER=other-rollout-2026-10-26
  printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\n---\n\n## Queue\n\n- [[o1]]\n- [[o2]]\n' > "$D/$OTHER.md"
  for t in o1 o2; do printf -- '---\ntags: [task]\nstatus: in_progress\nowner: lead-o\nrollout: "[[%s]]"\n---\n' "$OTHER" > "$D/$t.md"; done
  rm -f "$D/home/.config/thread/away.json"; away_file "$D/home" 2026-10-26T00:00:00Z false 2099-01-01T00:00:00Z 2 09:00 99
}
m20 m20
ok "$(j "$(inp v --max-review-rounds 4)" 'd["autoRevise"]')" true "M20: (inputs: a seeded revise, autoRevise true)"
entry 2026-10-26T10:00:00Z
J=$(mv)
ok "$(j "$J" '[d["verdict"], d["cause"], d["work"]["capHeld"]]')" '["waiting","trickle",[{"slug":"v","cause":"trickle"}]]' \
  "M20: a revise held only for want of slotLimit → trickle, capHeld names it"
ok "$(THREAD_HEAT_LEVEL=2 vc)" '["waiting","heat"]' "M20: at heavy heat → heat"
away_file "$D/home" 2026-10-26T00:00:00Z true 2099-01-01T00:00:00Z 1 09:00 2
ok "$(vc)" '["waiting","away-cap"]' "M20: while Away → away-cap"
rm -f "$D/o1.md" "$D/o2.md"
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["work"]["reentry"]]')" '["stalled","silent",["v"]]' "M20: with room, the revise is work: stalled at 2 h"
entry 2026-10-26T11:50:00Z
ok "$(vc)" '["moving",null]' "M20: … moving at 10 m"
m20 m20b
setfm v max_review_rounds 0
entry 2026-10-26T10:00:00Z
ok "$(j "$(inp v)" '[d["autoRevise"], d["humanFix"]["act"]]')" '[false,"fix the round budget"]' "M20b: inputs with no flag: autoRevise false, H12"
ok "$(vcr)" '["waiting","you","nothing can start: 1 set aside"]' "M20b: an invalid K is no work: you"

# ── M21 family: the lane the lead holds for a RACE re-verify (or its landing tail) is work, judged by silence ───────
# execute § 4.5's RACE procedure keeps the lane held through the re-verify (the Run record's lane-taken, no lane-freed),
# and a re-verify in flight never halts on its own task: a dead lead there is a stall, never a RACE waiting on Lachy.
scen m21
QUEUE="a"; mkro; integrating a
em lane-taken a '{}' 2026-10-26T08:00:00Z
printf '\n## Race log\n\n- 2026-10-26T08:30+00:00 [[a]] RACE: PR #5 merged as %s on parent x\n' "$A40" >> "$D/$RO.md"
em hold-started a '{"hold":"race"}' 2026-10-26T08:31:00Z
entry 2026-10-26T09:00:00Z
ok "$(j "$(nx)" '[d["laneHold"], d["halt"]]')" '[[{"slug":"a","hold":"race","revert":false}],"race"]' \
  "M21: (next: laneHold race, revert false, halt race: the lead's own lane state keeps it from halting)"
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["reason"], d["work"]["lane"]]')" '["stalled","silent","no life sign for 180m",true]' \
  "M21: the lead silent 3 h mid re-verify → stalled silent, the lane work (never RACE undecided)"
entry 2026-10-26T11:50:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["work"]["lane"]]')" '["moving",null,true]' "M21b: a live lead's re-verify → moving"
printf -- '- 2026-10-26T11:55+00:00 [[a]] re-verify not run: no verify slot in 3 tries; the RACE waits for you\n' >> "$D/$RO.md"
out=$(python3 "$SCRIPT" free-lane --tasks a --tasks-dir "$D" --now 2026-10-26T11:55:00Z 2>&1); rc=$?
ok "$rc|$out" "0|a: lane freed (halt)" "M21c: (the third noslot's free-lane)"
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["reason"], d["work"]["lane"]]')" '["waiting","you","RACE undecided: [[a]]",false]' \
  "M21c: the lane freed, the RACE left to Lachy → you"
scen m21d
QUEUE="a b"; mkro; integrating a; integrating b
em lane-taken b '{}' 2026-10-26T08:00:00Z
printf '\n## Race log\n\n- 2026-10-26T08:30+00:00 [[a]] RACE: PR #5 merged as %s on parent x\n' "$A40" >> "$D/$RO.md"
entry 2026-10-26T09:00:00Z
ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["work"]["lane"]]')" '["waiting","you",false]' \
  "M21d: (control) the record's lane open on another task is not the RACE's re-verify: you"

# ════ The narrowings, each through the real verbs ══════════════════════════════════════════════════════════════════

# ── N1: merge-task 70 → a Lane hold; the rest runs on ─────────────────────────────────────────────────────────────
scen n1
mkro; integrating a; mkt b review "pr: https://github.com/o/r/pull/6" "owner: lead" "ready: 2026-10-26T07:30+00:00"; mkt c open
em lane-taken a '{}' 2026-10-26T08:00:00Z
lh a merge-task-abort "ERROR: merge-task aborted (70): set -u
second line ignored"
ok "$rc" 0 "N1: lane-hold exits 0"
ok "$out" "a: lane hold (merge-task-abort) [written]; lane freed" "N1: its line"
ok "$(awk '/^## Lane log/{on=1; next} on && NF' "$D/$RO.md")" "- 2026-10-26T12:00+00:00 lane hold [[a]] merge-task-abort: ERROR: merge-task aborted (70): set -u" \
  "N1: the Lane-log line, its evidence the first line"
ok "$(tail -n 1 "$D/$RO.md" | cut -c1-30)" "- 2026-10-26T12:00+00:00 lane " "N1: the section is at the note's end"
ok "$(evs lane-freed)" '[["lane-freed","a","halt"]]' "N1: the record frees the lane (release=halt)"
J=$(nx)
ok "$(j "$J" '[d["laneHold"], d["integrating"], d["awaitingIntegration"], d["start"], d["halt"]]')" \
  '[[{"slug":"a","hold":"lane","cause":"merge-task-abort","stamp":"2026-10-26T12:00+00:00"}],["a"],["b"],["c"],null]' \
  "N1: next: laneHold [a lane], a integrating, b awaits, c starts, no halt"
setfm c status done
ok "$(j "$(nx)" '[d["halt"], d["awaitingIntegration"], d["start"]]')" '["lane",["b"],[]]' "N1: once nothing else moves: halt lane, b never integrated"
entry 2026-10-26T11:50:00Z
ok "$(vcr)" '["waiting","you","lane held: merge-task-abort on [[a]]"]' "N1: moving → you"
lh a merge-task-abort "again"; ok "$out" "a: lane hold (merge-task-abort) [no-change]" "N1: a re-run → [no-change]"
la zz "x"; ok "$rc" 1 "N1: lane-ack on a slug no hold names → exit 1"
la a ""; ok "$rc" 2 "N1: an empty --fix → exit 2"
la a "rebuilt merge-task's bash"; ok "$rc|$out" "0|a: lane ack [written]" "N1: lane-ack releases it"
ok "$(j "$(nx)" '[d["laneHold"], d["halt"]]')" '[[],null]' "N1: the lane moves again"
la a "again"; ok "$out" "a: lane ack [no-change] (every hold is acked)" "N1: a second ack → [no-change]"
lh a merge-task-abort "a new abort"; ok "$rc" 0 "N1: a hold after an ack holds again"
ok "$(j "$(nx)" '[e["hold"] for e in d["laneHold"]]')" '["lane"]' "N1: … listed"
setfm b integrating 2026-10-26T08:30+00:00
printf -- '\n## Race log\n\n- 2026-10-26T09:00+00:00 [[b]] RACE: PR #6 merged as dddddddddddddddddddddddddddddddddddddddd on parent x\n- 2026-10-26T09:10+00:00 [[b]] revert started: dddddddddddddddddddddddddddddddddddddddd (re-verify rc 1)\n' > "$D/race.tmp"
python3 - "$D/$RO.md" "$D/race.tmp" <<'PY'
import sys
p, r = sys.argv[1:]; t = open(p).read(); i = t.index("\n## Lane log")
open(p, "w").write(t[:i] + open(r).read() + t[i:])
PY
J=$(nx)
ok "$(j "$J" '[[e["hold"], e.get("revert")] for e in d["laneHold"]]')" '[["race",true],["lane",null]]' "N1: a pending RACE revert beside a lane entry"
ok "$(j "$J" 'd["halt"]')" '"lane"' "N1: … the Lane hold stops it: halt lane"
lh a bogus "x"; ok "$rc" 2 "N1: a cause outside LANE_HOLD_CAUSES → exit 2"
lh "a,b" merge-task-env "x"; ok "$rc" 2 "N1: two slugs → exit 2"

# ── N1b: every cause through the full chain, readable and unreadable notes ──────────────────────────────────────
n1b() {  # n1b <name> <cause> <note: ok|unparseable|missing> <evidence>
  scen "n1b-$1"
  QUEUE="a b"; mkro; integrating a; mkt b review "pr: https://github.com/o/r/pull/6" "owner: lead" "ready: 2026-10-26T07:30+00:00"
  em lane-taken a '{}' 2026-10-26T08:00:00Z
  case "$3" in unparseable) printf 'garbled\n' > "$D/a.md";; missing) rm -f "$D/a.md";; esac
  lh a "$2" "$4"
  ok "$rc" 0 "N1b $1: lane-hold exits 0"
  case "$3" in ok) hasnt "$out" "task note unreadable" "N1b $1: a readable note";; *) has "$out" "(task note unreadable: " "N1b $1: says the note is unreadable";; esac
  ok "$(grep -c "lane hold \[\[a\]\] $2: " "$D/$RO.md")" 1 "N1b $1: the line lands"
  ok "$(evs lane-freed)" '[["lane-freed","a","halt"]]' "N1b $1: lane-freed lands"
  J=$(nx)
  ok "$(j "$J" '[[e["slug"], e["hold"]] for e in d["laneHold"]]')" '[["a","lane"]]' "N1b $1: laneHold lists a"
  ok "$(j "$J" '[d["halt"], d["awaitingIntegration"]]')" '["lane",["b"]]' "N1b $1: halt lane once nothing else moves; b not integrated"
  la a "fixed"; ok "$rc" 0 "N1b $1: lane-ack releases it"
  ok "$(j "$(nx)" 'd["laneHold"]')" '[]' "N1b $1: … released"
}
n1b env merge-task-env ok "ERROR: gh not found on PATH"
n1b verify verify-noslot ok "verify: no verify slot within 600s"
GITLESS="$TMP/gitless"; mkdir -p "$GITLESS"; ln -sf "$(command -v python3)" "$GITLESS/python3"
PUSHERR=$(PATH="$GITLESS" "$(command -v python3)" "$LI" push --repo "$TMP" --slug a --head "$A40" 2>&1 >/dev/null)
has "$PUSHERR" "lead-integrate push: git not runnable:" "N1b: (the real push stderr with no git on PATH)"
n1b push integrate-env ok "$PUSHERR"
n1b unparseable integrate-env unparseable "lead-integrate prepare: task note unreadable: no frontmatter"
n1b missing integrate-env missing "lead-integrate prepare: task note unreadable: not found"
scen n1b-unknown
QUEUE="a"; mkro; integrating a
before=$(cat "$D/$RO.md")
lh zz integrate-env "x"
ok "$rc" 1 "N1b: a slug neither readable nor in the Queue → exit 1"
has "$out" "names no task of [[$RO]]" "N1b: … named"
ok "$(cat "$D/$RO.md")" "$before" "N1b: … nothing written"
printf -- '---\ntags: [task]\nstatus: review\nrollout: "[[other-rollout]]"\n---\n' > "$D/zz.md"
lh zz integrate-env "x"; ok "$rc" 1 "N1b: another rollout's task → exit 1"

# ── N2: the lead's Integration set-asides: infra and agent classes, the lane free ───────────────────────────────
n2() {  # n2 <name> <reason> <class>
  scen "n2-$1"
  QUEUE="a b"; mkro; integrating a; mkt b review "pr: https://github.com/o/r/pull/6" "owner: lead" "ready: 2026-10-26T07:30+00:00"
  lead a integration "$2" 2026-10-26T11:00:00Z
  ok "$(j "$(INOW=2026-10-26T11:05:00Z inp a)" '[d["autoRetryClass"], d["autoRetry"]]')" "[\"$3\",$([ "$3" = infra ] && echo false || echo true)]" "N2 $1: class $3"
  J=$(nx)
  ok "$(j "$J" '[d["integrating"], d["awaitingIntegration"][:1], d["halt"]]')" '[[],["b"],null]' "N2 $1: the lane is free, b first, no halt"
  if [ "$3" = infra ]; then
    ok "$(j "$(INOW=2026-10-26T11:05:00Z inp a)" 'd["autoRetryAfter"]')" '"2026-10-26T11:15+00:00"' "N2 $1: cools 15 min"
    ok "$(j "$(INOW=2026-10-26T11:15:00Z inp a)" 'd["autoRetry"]')" true "N2 $1: then retryable"
  fi
}
n2 origin "prepare: origin unreachable three times: fatal: unable to access" infra
n2 signal "merge-task signalled twice (143): Terminated" infra
n2 refused "prepare refused twice: no integrating: after mark-integrating" agent
n2 abort "could not abort the merge left in progress in /t: x" agent
n2 noanchor "ANCHOR_RECIPE gave no anchor for thread/a at x: y" agent
n2 mergebase "no merge-base of the anchor x and origin/main" agent
scen n2-exit8
QUEUE="a"; mkro; integrating a
lead a integration "merge-task exit 8 three times: GitHub unreachable" 2026-10-26T11:00:00Z
ok "$(j "$(INOW=2026-10-26T11:05:00Z inp a)" 'd["autoRetryClass"]')" '"agent"' "N2: merge-task exit 8 three times stays agent (ADR 0033)"

# ── N2b: merge-task's argument exit 2 → an own-run set-aside, H10 ────────────────────────────────────────────────
scen n2b
QUEUE="a b"; mkro; integrating a; mkt b open
lead a own "merge-task: ERROR: merge-task args: integrated head 'x' is not a 40-hex SHA" 2026-10-26T11:00:00Z
ok "$(j "$(inp a)" '[d["humanFix"]["act"], d["humanFix"]["handBack"]]')" '["hand back or defer",true]' "N2b: H10, handBack true"
ok "$(j "$(nx)" '[d["start"], d["halt"]]')" '[["b"],null]' "N2b: the queue runs on"

# ── N3: a task-level invalid round budget → that task set aside (H12), never a halt ─────────────────────────────
# Driven from a queued (`open`) note, as execute § 3 runs it: the lead writes its own Set aside row before any start,
# so there is no `status: in_progress` stamp, no mark-started and no slot event.
scen n3
QUEUE="q r"; mkro; mkt q open "max_plan_rounds: 0"; mkt r open
lead q own "invalid round budget: max_plan_rounds on [[q]] must be an integer >= 1, got '0'" 2026-10-26T11:00:00Z
ok "$(grep -m1 '^status:' "$D/q.md")" "status: blocked" "N3: the own row sets the open note aside (status blocked)"
ok "$(evs slot-taken,slot-freed)" '[]' "N3: … with no slot event (no start ran)"
J=$(nx)
ok "$(j "$J" '[d["start"], [[e["slug"], e["setAsideAt"]] for e in d["setAside"]], d["halt"]]')" '[["r"],[["q","run"]],null]' \
  "N3: q set aside at its run, r starts"
I=$(inp q)
ok "$(j "$I" '[d["humanFix"]["act"], d["autoRetryError"]]')" "[\"fix the round budget\",\"max_plan_rounds on [[q]] must be an integer >= 1, got '0'\"]" "N3: inputs → H12 naming the field"
out=$(python3 "$SCRIPT" auto-retry --tasks q --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" 2>&1); rc=$?
ok "$rc" 1 "N3: auto-retry refuses"; has "$out" "invalid round budget:" "N3: … naming the invalid budget"
setfm q max_plan_rounds 3
ok "$(j "$(inp q)" '[d["autoRetry"], d["humanFix"], d["autoRetryError"]]')" '[true,null,null]' "N3: fixed to 3 → autoRetry true"
out=$(python3 "$SCRIPT" auto-retry --tasks q --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" 2>&1); rc=$?
ok "$rc" 0 "N3: auto-retry re-enters it"
ok "$(j "$(nx)" 'd["restart"] + d["running"]')" '["q"]' "N3: next takes q back"
scen n3-h10
QUEUE="q r"; mkro; mkt q open "max_plan_rounds: 0" "auto_retries: 0"; mkt r open
lead q own "invalid round budget: max_plan_rounds on [[q]] must be an integer >= 1, got '0'" 2026-10-26T11:00:00Z
setfm q max_plan_rounds 3
ok "$(j "$(inp q)" '[d["humanFix"]["act"], d["humanFix"]["raise"]]')" '["hand back or defer",null]' "N3: fixed with auto_retries 0 → H10, raise null"

# ── N3b: an invalid max_review_rounds is never passed to inputs ─────────────────────────────────────────────────
scen n3b
QUEUE="q r"; mkro; mkt q open "max_review_rounds: 0"; mkt r open
lead q own "invalid round budget: max_review_rounds on [[q]] must be an integer >= 1, got '0'" 2026-10-26T11:00:00Z
I=$(python3 "$LI" inputs --note "$D/q.md" --repo "$D/root" --now "$NOW"); rc=$?
ok "$rc|$(j "$I" '[d["autoRevise"], d["humanFix"]["act"]]')" '0|[false,"fix the round budget"]' "N3b: inputs with no flag → exit 0, H12"
has "$(j "$I" 'd["humanFix"]["detail"]')" "max_review_rounds" "N3b: … naming max_review_rounds"
err=$(python3 "$LI" inputs --note "$D/q.md" --max-review-rounds 0 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "N3b: inputs --max-review-rounds 0 → exit 2 (the read § 3 forbids)"
hasnt "$err" "task note unreadable:" "N3b: … with no note-race marker, so it would be a whole halt"
ok "$(j "$(nx)" 'd["start"]')" '["r"]' "N3b: r starts"

# ── N4: an undecided RACE plus `re-verify not run` → the lane only ──────────────────────────────────────────────
scen n4
QUEUE="a b"; mkro; mkt a review "pr: $PR" "owner: lead" "ready: 2026-10-26T07:00+00:00"; mkt b open
printf '\n## Race log\n\n- 2026-10-26T09:00+00:00 [[a]] RACE: PR #5 merged as %s on parent x\n- 2026-10-26T09:30+00:00 [[a]] re-verify not run: no verify slot in 3 tries; the RACE waits for you\n' "$A40" >> "$D/$RO.md"
J=$(nx)
ok "$(j "$J" '[d["laneHold"], d["start"], d["halt"]]')" '[[{"slug":"a","hold":"race","revert":false}],["b"],null]' "N4: laneHold race, revert false; b starts; no halt"
setfm b status done
ok "$(j "$(nx)" 'd["halt"]')" '"race"' "N4: with nothing else → race"

# ── N5: a gate-pending task and a queued one → the queued one starts ────────────────────────────────────────────
scen n5
QUEUE="g b"; mkro; mkt g gate-pending "owner: lead"; mkt b open
printf '\n## Gated inputs (awaiting sign-off)\n\n- spend: one run — cap 5 USD\n' >> "$D/g.md"
ok "$(j "$(nx)" '[d["start"], d["halt"]]')" '[["b"],null]' "N5: the queued task starts beside the gate"

# ── N6: a bare checkout's trip → whole; a lane trip → the lane only ─────────────────────────────────────────────
scen n6
QUEUE="a b"; mkro; integrating a; mkt b open
printf '\n## Git-env log\n\n- 2026-10-26T09:00+00:00 git-env trip [[a]] integrate: core.bare false→true\n' >> "$D/$RO.md"
entry 2026-10-26T11:50:00Z
ok "$(j "$(nx)" '[d["halt"], d["start"]]')" '["git-env",[]]' "N6: a bare checkout → halt git-env, nothing starts"
ok "$(vcr)" '["waiting","you","git-env trip: the shared checkout changed"]' "N6: moving → you (read live)"
scen n6-lane
QUEUE="a b"; mkro; integrating a; mkt b open
printf '\n## Git-env log\n\n- 2026-10-26T09:00+00:00 git-env trip [[a]] integrate: HEAD moved\n' >> "$D/$RO.md"
ok "$(j "$(nx)" '[[e["hold"] for e in d["laneHold"]], d["start"]]')" '[["git-env"],["b"]]' "N6: a lane trip → laneHold git-env, b starts"

# ── N7: a refused rollouts.toml holds the whole rollout ─────────────────────────────────────────────────────────
scen n7
QUEUE="a"; mkro; mkt a open "owner: lead"
mkdir -p "$D/home/.config/thread"; printf '[defaults]\nparallel_ceiling = "x"\n' > "$D/home/.config/thread/rollouts.toml"
out=$(python3 "$SCRIPT" verify-timeout --rollout "$D/$RO.md" 2>&1); rc=$?
ok "$rc" 3 "N7: verify-timeout exits 3 under a refused rollouts.toml"
entry 2026-10-26T11:00:00Z; halted "rollout settings refused" 2026-10-26T11:01:00Z
ok "$(vc)" '["waiting","you"]' "N7: the open halt with work → you"

# ── N8: a hard pause holds the whole rollout ────────────────────────────────────────────────────────────────────
scen n8
QUEUE="a"; mkro "paused: 2026-10-26T09:00+00:00"; mkt a open "owner: lead"
ok "$(j "$(nx)" '[d["start"], d["halt"]]')" '[[],"paused"]' "N8: nothing starts, halt paused"

# ── N9: the wait clauses' inputs: a lane verdict beside a cooling retry ─────────────────────────────────────────
n9() {  # n9 <name> <setup: lane|race|gitenv>
  scen "n9-$1"
  QUEUE="a b"; mkro; integrating a
  case "$2" in
    lane) lh a merge-task-abort "merge-task exited 70";;
    race) setfm a integrating '""'; sed -i.bak '/^integrating: ""$/d' "$D/a.md"
          printf '\n## Race log\n\n- 2026-10-26T07:30+00:00 [[a]] RACE: PR #5 merged as %s on parent x\n' "$A40" >> "$D/$RO.md";;
    gitenv) printf '\n## Git-env log\n\n- 2026-10-26T07:30+00:00 git-env trip [[a]] integrate: HEAD moved\n' >> "$D/$RO.md";;
  esac
  setaside_infra b 2026-10-26T08:00:00Z
  MNOW=2026-10-26T08:05:00Z
  J=$(nx --running "")
  ok "$(j "$J" '[d["start"], d["restart"]]')" '[[],[]]' "N9 $1: at T0+5 nothing starts or restarts"
  case "$2" in lane) ok "$(j "$J" 'd["halt"]')" '"lane"' "N9 $1: halt lane";; race) ok "$(j "$J" 'd["halt"]')" '"race"' "N9 $1: halt race";;
    gitenv) ok "$(j "$J" 'd["halt"]')" '"git-env"' "N9 $1: halt git-env";; esac
  ok "$(j "$(INOW=2026-10-26T08:05:00Z inp b)" '[d["autoRetry"], d["autoRetryClass"], d["autoRetryAfter"], d["humanFix"]]')" \
    '[false,"infra","2026-10-26T08:15+00:00",null]' "N9 $1: inputs on b: a cool-down (clause (i)'s facts)"
  entry 2026-10-26T08:04:00Z
  ok "$(j "$(mv)" '[d["verdict"], d["cause"], d["until"]]')" '["waiting","cool-down","2026-10-26T08:15+00:00"]' "N9 $1: moving → cool-down"
  ok "$(python3 -c 'import json,sys; print(sum(1 for x in open(sys.argv[1]) if json.loads(x).get("cause") == "halt"))' "$THREAD_EVENTS_DIR/$RO.jsonl")" 0 "N9 $1: no halt recorded"
  MNOW=2026-10-26T08:20:00Z
  I=$(INOW=$MNOW inp b)
  ok "$(j "$I" 'd["autoRetry"]')" true "N9 $1: at T0+20 → autoRetry"
  out=$(python3 "$SCRIPT" auto-retry --tasks b --rollout "$D/$RO.md" --tasks-dir "$D" --now "$MNOW" --auto-retries 2 --fingerprint "$(j "$I" 'd["fingerprint"]' | tr -d '"')" 2>&1); rc=$?
  ok "$rc" 0 "N9 $1: auto-retry exits 0"
  J=$(nx --running "")
  ok "$(j "$J" '[d["restart"], d["halt"]]')" '[["b"],null]' "N9 $1: next restarts b, no halt"
  entry 2026-10-26T08:19:00Z
  ok "$(vc)" '["moving",null]' "N9 $1: moving with a fresh lead-entry"
  unset MNOW
}
n9 lane lane
n9 race race
n9 gitenv gitenv
scen n9-prhold
QUEUE="a c"; mkro; integrating a; mkt c open "owner: lead" "hold_until: {pr: o/r#77, merged: true}"
lh a merge-task-abort "merge-task exited 70"
prj o/r#77 OPEN
J=$(nx)
ok "$(j "$J" '[d["halt"], [[h["note"], h["waits"]] for h in d["holdUntil"] if h["held"]]]')" '["lane",[["c","merge"]]]' "N9 pr-hold: halt lane while c's PR hold waits on its merge (clause (iv)'s fact)"
entry 2026-10-26T08:00:00Z
ok "$(vc)" '["waiting","pr-hold"]' "N9 pr-hold: moving → pr-hold"

# ── N9b: an UNVERIFIED beside a cooling set-aside ───────────────────────────────────────────────────────────────
scen n9b
QUEUE="u b"; mkro; running u
lead u own "UNVERIFIED: the verifier never reached a verdict" 2026-10-26T07:00:00Z
setaside_infra b 2026-10-26T08:00:00Z
MNOW=2026-10-26T08:05:00Z
J=$(nx --running "")
ok "$(j "$J" '[d["halt"], d["raceHold"]]')" '["stuck",[{"slug":"u","kind":"UNVERIFIED"}]]' "N9b: next → stuck, raceHold UNVERIFIED"
ok "$(j "$(INOW=$MNOW inp b)" 'd["autoRetryAfter"]')" '"2026-10-26T08:15+00:00"' "N9b: the cooling one's autoRetryAfter"
entry 2026-10-26T08:04:00Z
ok "$(vc)" '["waiting","cool-down"]' "N9b: moving → cool-down"
MNOW=2026-10-26T08:20:00Z
out=$(python3 "$SCRIPT" auto-retry --tasks b --rollout "$D/$RO.md" --tasks-dir "$D" --now "$MNOW" 2>&1); rc=$?
ok "$rc" 0 "N9b: at T0+20 auto-retry exits 0"
ok "$(j "$(nx --running "")" 'd["restart"]')" '["b"]' "N9b: next restarts it"
unset MNOW

echo
[ "$fail" -eq 0 ] && echo "reconcile-rollout-moving: ALL PASS" || echo "reconcile-rollout-moving: FAILED"
exit "$fail"
