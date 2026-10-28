#!/usr/bin/env bash
# p28-2 (Chorus ADR 0104 d4 and its Consequences): while Lachy is Away to the Morning, `next` starts a queued task only
# if its kind's usual length (the median of its past runs, from the folded call journals in the Run record) ends it
# by the Morning's hour; with fewer than 3 past runs, nothing starts in the 2 h before it. Restarts are never held,
# and the hold never halts. Off --dry-run, `next` writes the night record into the rollout's Run record: one
# away-night marker per Morning, one last-start-held line per held task, and one ran-past-morning line per task whose
# Slot was open at the Morning (execute away.md § The last starts, § The night record). Every `next` call pins HOME to
# its scenario's own dir, so the operator's away.json never reaches an assertion. Temp notes only.
#
# This suite reads the record (the history and the night record), so it keeps its own THREAD_EVENTS_DIR, one per
# scenario, and ignores THREAD_TEST_EVENTS_DIR (the knob tests/run.sh honours to run every other suite against an
# unwritable events dir). The history is read Mac-wide from the events dir, so no scenario sees another's.
# Usage: bash reconcile-rollout-last-starts.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
RR="$HERE/../../_shared/scripts/run_record.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # away_file
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"            # the Run record stays in temp; scen points it at the scenario's own dir
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"     # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
export THREAD_GIT_ENV_DIR="$TMP/git-env"          # mark-started's canary arm (p26-3) keeps its records in temp
unset XDG_STATE_HOME

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/home" "$D/Archive/Rollouts"; export THREAD_EVENTS_DIR="$D/events"; echo "== $1"; }
# mkro <stem> <ceiling> [frontmatter lines...] — a rollout note in $D; its tasks list themselves as they are made (mkt).
mkro() {
  local s="$1" c="$2"; shift 2
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: %s\n' "$c"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nfixture\n\n## Queue\n\n'; } > "$D/$s.md"
}
ro() { mkro ro 3 'projects: ["[[Demo]]", "[[AI]]"]' "$@"; }   # the rollout under test: project Demo, ceiling 3
# mkt <slug> <rollout> <status> [frontmatter lines...] — a task note in $D, appended to its rollout's queue list.
mkt() {
  local s="$1" r="$2" st="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\n' "$st" "$r"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
  printf -- '- [[%s]]\n' "$s" >> "$D/$r.md"
}
restatus() { python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("\nstatus: open\n", "\nstatus: %s\n" % sys.argv[2], 1))' "$D/$1.md" "$2"; }
# nx <now> [next flags...] — `next` on $D/ro.md at <now>, HOME pinned to $D/home; stderr lands in $D/err.
nx() { local now="$1"; shift; HOME="$D/home" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$now" "$@" 2>"$D/err"; }
# started <slug> <now>: the lead's § 4 stamp, then mark-started (its slot-taken lands in the record at <now>).
started() {
  restatus "$1" in_progress
  HOME="$D/home" python3 "$SCRIPT" mark-started --tasks "$1" --rollout "$D/ro.md" --tasks-dir "$D" --now "$2" >/dev/null 2>>"$D/err-ms"
}
lines() { if [ -s "$D/err" ]; then wc -l < "$D/err" | tr -d ' '; else echo 0; fi; }
# q <json> <python-expr over d> — compact JSON of the expression ('PARSE' when stdout is not one JSON object)
q() { printf '%s' "$1" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except ValueError:
    print("PARSE"); sys.exit(0)
print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
holds='{h["slug"]: h["reason"] for h in d["hold"]}'
# recq <python-expr over rows> — this scenario's ro.jsonl as `rows` (dicts), the expression as compact JSON
recq() { python3 -c 'import json,sys
try:
    rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
except FileNotFoundError:
    rows = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":"), sort_keys=True))' "$D/events/ro.jsonl" "$1"; }
count() { recq "sum(1 for r in rows if r['kind'] == '$1')"; }
NIGHT='[[r["kind"], r["task"]] + [r.get(k) for k in ("morning", "scope", "history", "usualMinutes", "slotTakenAt")] for r in rows if r["kind"] in ("away-night", "last-start-held", "ran-past-morning")]'

# The history: one finished task call per spec, through run_record.py itself (one process for many specs). A spec is
# JSON {stem, slug, scope, minutes, end, project, extra}: an archived task note <slug> (scope `-` writes no scope:),
# an archived rollout note <stem> (projects [[<project>]]), and in <stem>.jsonl a run-bound line and a completed
# `mode: task` call-journal line of durationMs <minutes>, ending at <end>. extra: note false (no task note), rnote
# false (no rollout note), bound false (no run-bound line), bind / cj (fields merged in; a null drops one), torn (the
# call-journal line torn, unparseable), runId (the call's, else wf_<slug>).
cat > "$TMP/hist.py" <<'PY'
import importlib.util, json, os, sys
from datetime import datetime
spec = importlib.util.spec_from_file_location("thread_run_record", sys.argv[1])
rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)
D = sys.argv[2]
for raw in sys.argv[3:]:
    s = json.loads(raw)
    x, stem, slug = s["extra"], s["stem"], s["slug"]
    tn = os.path.join(D, "Archive", slug + ".md")
    if x.get("note", True) and not os.path.exists(tn):
        scope = "" if s["scope"] == "-" else "scope: %s\n" % s["scope"]
        with open(tn, "w") as f:
            f.write('---\ntags: [task]\nstatus: done\n%srollout: "[[%s]]"\n---\n' % (scope, stem))
    rn = os.path.join(D, "Archive", "Rollouts", stem + ".md")
    if x.get("rnote", True) and not os.path.exists(rn):
        with open(rn, "w") as f:
            f.write('---\ntags: [task, rollout]\nstatus: done\nprotocol_version: 5\nprojects: ["[[%s]]"]\n---\n' % s["project"])
    end = datetime.fromisoformat(s["end"].replace("Z", "+00:00"))
    ms, run = int(s["minutes"] * 60000), x.get("runId", "wf_" + slug.replace("-", "_"))
    bind = dict({"runId": run, "journalDir": "/nonexistent/workflows", "call": "task"}, **x.get("bind", {}))
    cj = dict({"runId": run, "status": "completed", "mode": "task", "durationMs": ms,
               "startTime": int(end.timestamp() * 1000) - ms}, **x.get("cj", {}))
    cj = {k: v for k, v in cj.items() if v is not None}
    if x.get("bound", True):
        assert rr.emit(stem, "run-bound", slug, {k: v for k, v in bind.items() if v is not None}, ts=s["end"], strict=True)
    if x.get("torn"):
        with open(rr.record_path(stem), "a") as f:
            f.write(json.dumps(dict(cj, kind="call-journal", task=slug))[:40] + "\n")
    else:
        assert rr.emit(stem, "call-journal", slug, cj, ts=s["end"], strict=True)
PY
# spec <stem> <slug> <scope> <minutes> [end] [project] [extra-json]
spec() {
  local x="${7:-}"; [ -n "$x" ] || x='{}'
  printf '{"stem":"%s","slug":"%s","scope":"%s","minutes":%s,"end":"%s","project":"%s","extra":%s}' \
    "$1" "$2" "$3" "$4" "${5:-2026-10-02T12:00:00Z}" "${6:-Demo}" "$x"
}
past() { python3 "$TMP/hist.py" "$RR" "$D" "$(spec "$@")"; }
# The default history: cross-cutting 100/110/120 min (median 110), single-file 20/25/30 (median 25), read-only 2 runs.
history() {
  python3 "$TMP/hist.py" "$RR" "$D" \
    "$(spec old-ro h-cc1 cross-cutting 100)" "$(spec old-ro h-cc2 cross-cutting 110)" "$(spec old-ro h-cc3 cross-cutting 120)" \
    "$(spec old-ro h-sf1 single-file 20)" "$(spec old-ro h-sf2 single-file 25)" "$(spec old-ro h-sf3 single-file 30)" \
    "$(spec old-ro h-ro1 read-only 10)" "$(spec old-ro h-ro2 read-only 10)"
}
# night: Away to the Morning, written at 07:00 (until today's 09:00, the Morning 09:00).
night() { away_file "$D/home" 2026-10-03T07:00:00Z true 2026-10-03T09:00:00Z 2 09:00; }

CC='last start: cross-cutting usually takes 110 min (median of 3 past runs), past the Morning at 09:00'
nohist() { printf 'last start: no history for %s (%s past runs, 3 needed), none starts in the 2 h before the Morning at 09:00' "$1" "$2"; }
NONE='{"kinds":{},"morning":null}'

# ── L1: a kind whose usual length overruns the Morning is held ─────────────────────────────────────────────────
scen l1-overrun
ro; mkt c1 ro open 'scope: cross-cutting'
history; night
J=$(nx 2026-10-03T07:30:00Z --dry-run); rc=$?
ok "$rc" 0 "L1: next exits 0"
ok "$(q "$J" '[d["start"], d["restart"], d["halt"]]')" '[[],[],null]' "L1: c1 does not start, and nothing halts"
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L1: c1 is held by its kind's usual length"
ok "$(q "$J" 'd["lastStarts"]')" '{"kinds":{"cross-cutting":{"history":3,"usualMinutes":110}},"morning":"2026-10-03T09:00:00+00:00"}' \
  "L1: lastStarts names the Morning and the kind's reading"
ok "$(q "$J" 'list(d)[list(d).index("trickle") + 1]')" '"lastStarts"' "L1: lastStarts follows trickle"
ok "$(lines)" 0 "L1: nothing on stderr"

# ── L2: a kind that fits starts; the boundary is now + usual == the Morning ───────────────────────────────────
scen l2-fits
ro; mkt c1 ro open 'scope: cross-cutting'; mkt s1 ro open 'scope: single-file'
history; night
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" 'd["start"]')" '["s1"]' "L2: s1 (single-file, 25 min) starts at 07:30"
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L2: c1 above it is held, and skipped, never a stop"
ok "$(q "$J" 'd["lastStarts"]["kinds"]')" '{"cross-cutting":{"history":3,"usualMinutes":110},"single-file":{"history":3,"usualMinutes":25}}' \
  "L2: both candidates' kinds are read, sorted"
J=$(nx 2026-10-03T07:10:00Z --dry-run)
ok "$(q "$J" '[d["start"], d["hold"]]')" '[["c1","s1"],[]]' "L2: at 07:10, 07:10 + 110 min is the Morning: c1 starts"
J=$(nx 2026-10-03T07:11:00Z --dry-run)
ok "$(q "$J" '[d["start"], [h["slug"] for h in d["hold"]]]')" '[["s1"],["c1"]]' "L2: at 07:11, one minute later, c1 is held"

# ── L3: no history holds in the last two hours ─────────────────────────────────────────────────────────────────
scen l3-no-history
ro; mkt r1 ro open 'scope: read-only'
history; night
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" "$holds")" "{\"r1\":\"$(nohist read-only 2)\"}" "L3: read-only (2 runs) is held by the fallback at 07:30"
ok "$(q "$J" 'd["lastStarts"]["kinds"]')" '{"read-only":{"history":2,"usualMinutes":null}}' "L3: usualMinutes is null under 3 runs"
J=$(nx 2026-10-03T07:00:00Z --dry-run)
ok "$(q "$J" '[d["start"], d["hold"]]')" '[["r1"],[]]' "L3: exactly 2 h before the Morning, r1 starts"
J=$(nx 2026-10-03T06:59:00Z --dry-run)
ok "$(q "$J" '[d["start"], d["hold"]]')" '[["r1"],[]]' "L3: at 06:59, r1 starts"

# ── L4: it does not apply unless Away runs to the Morning ──────────────────────────────────────────────────────
scen l4-not-applied
ro; mkt c1 ro open 'scope: cross-cutting'
history
notapplied() {  # notapplied <label>: the file is already written
  J=$(nx 2026-10-03T07:30:00Z)
  ok "$(q "$J" '[d["start"], d["hold"], d["lastStarts"]]')" "[[\"c1\"],[],$NONE]" "L4 $1: c1 starts, lastStarts null"
}
away_file "$D/home" 2026-10-03T07:00:00Z false 2026-10-03T18:00:00Z; notapplied "a fresh not-Away file"
rm -f "$D/home/.config/thread/away.json"; notapplied "a missing file"
away_file "$D/home" 2026-10-02T07:00:00Z true 2026-10-03T09:00:00Z; notapplied "a stale file"
ok "$(lines)" 1 "L4 a stale file: its one WARN line, nothing more"
away_file "$D/home" 2026-10-03T07:00:00Z true 2026-10-05T09:00:00Z; notapplied "Away until a Morning 49.5 h out"
ok "$(count away-night)" 0 "L4: off --dry-run, no away-night marker is written in any of them"
ok "$(count last-start-held)" 0 "L4: … and no last-start-held line"

# ── L5: restarts are exempt ────────────────────────────────────────────────────────────────────────────────────
scen l5-restart
ro; mkt c2 ro in_progress 'scope: cross-cutting' 'owner: gone'; mkt c3 ro in_progress 'scope: cross-cutting' \
  'handed_back: 2026-10-03T08:00+00:00'; mkt c1 ro open 'scope: cross-cutting'
history; night
J=$(nx 2026-10-03T08:30:00Z --running "" --dry-run)
ok "$(q "$J" '[d["restart"], d["start"], d["halt"]]')" '[["c2","c3"],[],null]' \
  "L5: a stalled task and a handed-back one restart at 08:30, the last starts aside"
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L5: the queued c1 is held"

# ── L6: a head Solo task ───────────────────────────────────────────────────────────────────────────────────────
scen l6-solo
ro; mkt x1 ro open 'scope: cross-cutting' 'solo: true'; mkt x2 ro open 'scope: single-file'
history; night
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" '[d["start"], d["halt"]]')" '[[],null]' "L6: the head Solo does not start, and nothing halts"
ok "$(q "$J" "$holds")" "{\"x1\":\"${CC}\",\"x2\":\"behind solo [[x1]]\"}" "L6: the Solo reads last start:, the row below behind it"
scen l6b-solo-alone
ro; mkt y1 ro open 'scope: cross-cutting'; mkt y2 ro open 'scope: single-file' 'solo: true'; mkt y3 ro open 'scope: single-file'
history; night
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" '[d["start"], d["hold"]]')" "[[\"y2\"],[{\"reason\":\"$CC\",\"slug\":\"y1\"},{\"reason\":\"behind solo [[y2]]\",\"slug\":\"y3\"}]]" \
  "L6: a held row above the Solo lets the Solo start alone, as a dependency hold does"

# ── L7: no halt, and the idle reason ───────────────────────────────────────────────────────────────────────────
scen l7-no-halt
ro; mkt c1 ro open 'scope: cross-cutting'
history; night
J=$(nx 2026-10-03T07:30:00Z)
ok "$(q "$J" '[d["start"], d["halt"], d["slotsInUse"]]')" '[[],null,0]' "L7: only c1, nothing running: neither stuck nor halted"
ok "$(recq '[[r["reason"], r["free"]] for r in rows if r["kind"] == "idle-slots"]')" '[["hold-last-start",3]]' \
  "L7: off --dry-run, idle-slots reads hold-last-start with free 3"
scen l7b-git-env
ro; mkt c1 ro open 'scope: cross-cutting'
history; night
printf '\n## Git-env log\n\n- 2026-10-03T07:00+00:00 git-env trip [[c1]] task: core.bare false→true; repo /x\n' >> "$D/ro.md"
J=$(nx 2026-10-03T07:30:00Z)
ok "$(q "$J" '[d["halt"], d["start"], [h["scope"] for h in d["gitEnvHold"]]]')" '["git-env",[],["rollout"]]' "L7: a whole-rollout git-env trip (a bare checkout) halts git-env"
ok "$(q "$J" "$holds")" '{"c1":"git-env hold: /thread:repair"}' "L7: … replacing every hold"
ok "$(count last-start-held)" 0 "L7: … so no last-start-held line is written"
ok "$(count away-night)" 1 "L7: the night's marker is still written"

# ── L8: history edges ──────────────────────────────────────────────────────────────────────────────────────────
# Two good cross-cutting runs, then one edge: each edge alone leaves the kind under 3, so c1 reads the fallback.
edge() {  # edge <label> <past args...>
  local label="$1"; shift
  scen "l8-$label"
  ro; mkt c1 ro open 'scope: cross-cutting'
  night
  python3 "$TMP/hist.py" "$RR" "$D" "$(spec old-ro h-cc1 cross-cutting 100)" "$(spec old-ro h-cc2 cross-cutting 110)" "$(spec "$@")"
  J=$(nx 2026-10-03T07:30:00Z --dry-run)
  ok "$(q "$J" "$holds")" "{\"c1\":\"$(nohist cross-cutting 2)\"}" "L8 $label: the kind reads 2 runs, the fallback"
}
edge ended-31-days-ago old-ro h-cc3 cross-cutting 120 2026-09-02T07:30:00Z
edge project-other other-ro h-cc3 cross-cutting 120 "" Other
edge no-rollout-note ghost-ro h-cc3 cross-cutting 120 "" "" '{"rnote": false}'
edge no-task-note old-ro h-cc3 cross-cutting 120 "" "" '{"note": false}'
edge resumed-from old-ro h-cc3 cross-cutting 120 "" "" '{"bind": {"resumedFrom": "wf_old"}}'
edge killed old-ro h-cc3 cross-cutting 120 "" "" '{"cj": {"status": "killed"}}'
edge integrate old-ro h-cc3 cross-cutting 120 "" "" '{"bind": {"call": "integrate"}, "cj": {"mode": "integrate"}}'
edge no-start-time old-ro h-cc3 cross-cutting 120 "" "" '{"cj": {"startTime": null}}'
edge torn-line old-ro h-cc3 cross-cutting 120 "" "" '{"torn": true}'
edge no-run-bound old-ro h-cc3 cross-cutting 120 "" "" '{"bound": false}'
# h-cc2's own call (runId wf_h_cc2) folded into a second file of the project too: one run, counted once
edge one-run-in-two-files old-ro2 h-cc2 cross-cutting 110
# The edge's spec reads its defaults when given "": spec turns an empty end or project into the default.
scen l8-a-good-third
ro; mkt c1 ro open 'scope: cross-cutting'
night
python3 "$TMP/hist.py" "$RR" "$D" "$(spec old-ro h-cc1 cross-cutting 100)" "$(spec old-ro h-cc2 cross-cutting 110)" \
  "$(spec old-ro h-cc3 cross-cutting 120 2026-09-03T07:30:00Z)"
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L8: control: a third run ending exactly 30 days ago counts"
# A mid-run Reflection's fold-journals puts this rollout's own finished calls into ro.jsonl itself: its own note (never
# in the walk's index, which skips the rollout note) names the project, so they read as history.
scen l8-own-record
ro; mkt c1 ro open 'scope: cross-cutting'
night
own='{"rnote": false}'
python3 "$TMP/hist.py" "$RR" "$D" "$(spec ro h-cc1 cross-cutting 100 "" "" "$own")" "$(spec ro h-cc2 cross-cutting 110 "" "" "$own")" \
  "$(spec ro h-cc3 cross-cutting 120 "" "" "$own")"
ok "$(ls "$D/Archive/Rollouts")" "" "L8 own-record: no other note stands in for the rollout's own"
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L8 own-record: three runs folded into the rollout's own record read as history"
scen l8-no-projects
mkro ro 3; mkt c1 ro open 'scope: cross-cutting'
history; night
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" "$holds")" "{\"c1\":\"$(nohist cross-cutting 0)\"}" "L8: a rollout with no projects: reads no history"
scen l8-unscoped
ro; mkt u1 ro open
history
python3 "$TMP/hist.py" "$RR" "$D" "$(spec old-ro h-un1 - 100)" "$(spec old-ro h-un2 - 100)" "$(spec old-ro h-un3 - 100)"
night
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" "$holds")" '{"u1":"last start: unscoped usually takes 100 min (median of 3 past runs), past the Morning at 09:00"}' \
  "L8: a task with no scope: is kind unscoped, in the queue and in the history"

# ── L9: the night record lists both kinds of entry ─────────────────────────────────────────────────────────────
nightrun() {  # steps 1-4 of L9 in the current scenario
  ro; mkt c1 ro open 'scope: cross-cutting'; mkt s1 ro open 'scope: single-file'
  history; night
  J=$(nx 2026-10-03T07:30:00Z)
  ok "$(q "$J" '[d["start"], [h["slug"] for h in d["hold"]]]')" '[["s1"],["c1"]]' "$1 step 1: s1 starts at 07:30, c1 is held"
  started s1 2026-10-03T07:30:00Z
  ok "$(recq '[r["ts"] for r in rows if r["kind"] == "slot-taken" and r["task"] == "s1"]')" '["2026-10-03T07:30:00.000Z"]' \
    "$1 step 2: s1's slot-taken is at 07:30"
  J=$(nx 2026-10-03T07:50:00Z)
  ok "$(q "$J" '[d["start"], d["running"], [h["slug"] for h in d["hold"]]]')" '[[],["s1"],["c1"]]' "$1 step 3: at 07:50, c1 is held again"
  ok "$(recq '[r["kind"] for r in rows if r["kind"] in ("away-night", "last-start-held")]')" '["away-night","last-start-held"]' \
    "$1 step 3: still exactly one line of each kind"
  python3 "$RR" emit --kind slot-taken --rollout ro --task e1 --json '{"settings":{"parallel_ceiling":3}}' --ts 2026-10-03T06:00:00Z
  python3 "$RR" emit --kind slot-freed --rollout ro --task e1 --json '{"outcome":"ready"}' --ts 2026-10-03T08:50:00Z
  python3 "$RR" emit --kind slot-taken --rollout ro --task f1 --json '{"settings":{"parallel_ceiling":3}}' --ts 2026-10-03T09:05:00Z
}
scen l9-night
nightrun L9
ok "$(recq "$NIGHT")" '[["away-night",null,"2026-10-03T09:00:00Z",null,null,null,null],["last-start-held","c1","2026-10-03T09:00:00Z","cross-cutting",3,110,null]]' \
  "L9: the marker and c1's held line, with its kind's reading"
away_file "$D/home" 2026-10-03T09:00:00Z false 2026-10-03T18:00:00Z 2
J=$(nx 2026-10-03T09:15:00Z)
ok "$(q "$J" '[d["start"], d["lastStarts"]["morning"], d["trickle"]["running"]]')" '[["c1"],null,2]' \
  "L9 step 5: at 09:15, not Away: c1 starts in the Trickle's one free place, no last starts"
ok "$(recq '[[r["task"], r["morning"], r["slotTakenAt"], r["scope"], r["history"], r.get("usualMinutes")] for r in rows if r["kind"] == "ran-past-morning"]')" \
  '[["s1","2026-10-03T09:00:00Z","2026-10-03T07:30:00.000Z","single-file",3,25]]' \
  "L9 step 5: one ran-past-morning line, for s1 alone (never e1, freed at 08:50, nor f1, taken at 09:05)"
ok "$(lines)" 0 "L9 step 5: nothing on stderr"
J=$(nx 2026-10-03T09:30:00Z)
ok "$(count ran-past-morning)" 1 "L9 step 6: a rerun writes no second ran-past-morning line"
ok "$(recq '[[r["kind"], r["task"]] for r in rows if r.get("morning") == "2026-10-03T09:00:00Z"]')" \
  '[["away-night",null],["last-start-held","c1"],["ran-past-morning","s1"]]' \
  "L9 step 7: grouped by morning, the night holds the marker, c1's held line and s1's ran-past line"

# ── L9b: a stale file at the Morning still records the night from its marker ──────────────────────────────────
scen l9b-stale
nightrun L9b
J=$(nx 2026-10-03T09:15:00Z)
ok "$(q "$J" '[d["trickle"]["file"], d["trickle"]["limit"], d["start"]]')" '["stale",2,["c1"]]' "L9b: the 07:00 file is stale at 09:15: Trickle 2"
ok "$(lines)" 1 "L9b: one WARN line, nothing more"
ok "$(recq '[r["task"] for r in rows if r["kind"] == "ran-past-morning"]')" '["s1"]' "L9b: s1's ran-past-morning line is written from the marker"

# ── L9c: the Slot pairing at the Morning: a from-file carried closes a Slot, and M itself is neither in nor out ──────
scen l9c-pairing
ro; mkt c1 ro open 'scope: cross-cutting'
history; night
J=$(nx 2026-10-03T07:30:00Z)
ok "$(count away-night)" 1 "L9c: the 07:30 call writes the night's marker"
ev() { python3 "$RR" emit --kind "$1" --rollout "$2" --task "$3" --json "$4" --ts "$5"; }  # ev <kind> <rollout> <task> <json> <ts>
TAKE='{"settings":{"parallel_ceiling":3}}'
ev slot-taken ro g1 "$TAKE" 2026-10-03T06:00:00Z; ev carried next-ro g1 '{"from":"ro"}' 2026-10-03T08:40:00Z
ev slot-taken ro h1 "$TAKE" 2026-10-03T09:00:00Z
ev slot-taken ro i1 "$TAKE" 2026-10-03T06:00:00Z; ev slot-freed ro i1 '{"outcome":"ready"}' 2026-10-03T09:00:00Z
ev slot-taken ro k1 "$TAKE" 2026-10-03T08:59:59Z; ev slot-freed ro k1 '{"outcome":"ready"}' 2026-10-03T09:00:01Z
ok "$(recq '[[r["task"], r["from"]] for r in rows if r["kind"] == "carried"]')" '[["g1","ro"]]' "L9c: g1's carried line sits in ro.jsonl, its from-file"
away_file "$D/home" 2026-10-03T09:00:00Z false 2026-10-03T18:00:00Z 2
J=$(nx 2026-10-03T09:15:00Z)
ran='[r["task"] for r in rows if r["kind"] == "ran-past-morning"]'
ok "$(recq "\"g1\" in $ran")" false "L9c: g1, its Slot closed by a from-file carried at 08:40, ran past no Morning"
ok "$(recq "\"h1\" in $ran")" false "L9c: h1, taken exactly at the Morning, did not run past it"
ok "$(recq "\"i1\" in $ran")" false "L9c: i1, freed exactly at the Morning, did not run past it"
ok "$(recq "$ran")" '["k1"]' "L9c: control: k1, taken a second before the Morning and freed a second after, ran past it"
ok "$(lines)" 0 "L9c: nothing on stderr"

# ── L10: --dry-run decides the same and writes nothing ────────────────────────────────────────────────────────
scen l10-dry-run
ro; mkt c1 ro open 'scope: cross-cutting'; mkt s1 ro open 'scope: single-file'
history; night
sums() { cksum "$D"/*.md | awk '{print $1 $2}' | tr '\n' ' '; }
before=$(sums); recs=$(cksum "$D"/events/*.jsonl)
DRY=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(sums)" "$before" "L10: --dry-run leaves every note byte-identical"
ok "$(cksum "$D"/events/*.jsonl)" "$recs" "L10: … and writes no record line"
ok "$(ls "$D/events")" "old-ro.jsonl" "L10: … not even the rollout's own record"
WET=$(nx 2026-10-03T07:30:00Z)
ok "$(q "$DRY" '[d["start"], d["hold"], d["lastStarts"]]')" "$(q "$WET" '[d["start"], d["hold"], d["lastStarts"]]')" \
  "L10: --dry-run gives the same starts, holds and lastStarts"

# ── L11: across a daylight-saving change, the Morning is until itself ─────────────────────────────────────────
# Melbourne's daylight saving starts at 02:00 on 2026-10-04: until 09:00+11:00 is 22:00Z, never 23:00Z.
scen l11-dst
ro; mkt c1 ro open 'scope: cross-cutting'
history
away_file "$D/home" 2026-10-03T15:00:00Z true 2026-10-04T09:00:00+11:00 2 09:00
J=$(TZ=Australia/Melbourne nx 2026-10-03T15:30:00Z --dry-run)
ok "$(q "$J" 'd["lastStarts"]["morning"]')" '"2026-10-04T09:00:00+11:00"' "L11: at 01:30+10:00, the Morning is 09:00+11:00"
J=$(TZ=Australia/Melbourne nx 2026-10-03T20:10:00Z --dry-run)
ok "$(q "$J" 'd["start"]')" '["c1"]' "L11: at 20:10Z, 20:10 + 110 min is 22:00Z, the Morning: c1 starts"
J=$(TZ=Australia/Melbourne nx 2026-10-03T20:11:00Z --dry-run)
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L11: at 20:11Z it is held, where a +10:00 reading would start it"
# M is the same instant at the local offset, never `until`'s own: the same Morning written in Z reads alike
away_file "$D/home" 2026-10-03T15:00:00Z true 2026-10-03T22:00:00Z 2 09:00
J=$(TZ=Australia/Melbourne nx 2026-10-03T15:30:00Z --dry-run)
ok "$(q "$J" 'd["lastStarts"]["morning"]')" '"2026-10-04T09:00:00+11:00"' "L11: an until of 22:00:00Z reads M 09:00+11:00, at the local offset"

# ── L12: the 05:00 press (until tomorrow's 09:00) looks only toward tomorrow's Morning, from 24 h before it ──────
scen l12-press
ro; mkt c1 ro open 'scope: cross-cutting'; mkt s1 ro in_progress 'scope: single-file'
history
away_file "$D/home" 2026-10-03T07:00:00Z true 2026-10-04T09:00:00Z 2 09:00
J=$(nx 2026-10-03T07:30:00Z)
ok "$(q "$J" '[d["start"], d["hold"], d["lastStarts"]]')" "[[\"c1\"],[],$NONE]" "L12: at 07:30 tomorrow's Morning is 25.5 h out: c1 starts"
ok "$(count away-night)" 0 "L12: … no marker, nothing held toward today's 09:00"
python3 "$RR" emit --kind slot-taken --rollout ro --task s1 --json '{"settings":{"parallel_ceiling":3}}' --ts 2026-10-03T08:00:00Z
J=$(nx 2026-10-03T09:00:00Z)
ok "$(q "$J" '[d["start"], d["lastStarts"]["morning"]]')" '[["c1"],"2026-10-04T09:00:00+00:00"]' \
  "L12: at 09:00, exactly 24 h before tomorrow's Morning, it applies, and c1 fits"
ok "$(recq "$NIGHT")" '[["away-night",null,"2026-10-04T09:00:00Z",null,null,null,null]]' "L12: one marker, for tomorrow's Morning"
J=$(nx 2026-10-03T09:30:00Z)
ok "$(count ran-past-morning)" 0 "L12: s1's Slot open across today's 09:00 writes no ran-past line: that Morning has no marker"

# ── L13: a daytime Away block is no night (round 2's fix) ──────────────────────────────────────────────────────
scen l13-daytime
ro; mkt c1 ro open 'scope: cross-cutting'; mkt s1 ro open 'scope: single-file'
history
daytime() {  # daytime <label> <now>: the file is already written
  J=$(nx "$2")
  ok "$(q "$J" '["c1" in d["start"], d["lastStarts"]["morning"]]')" '[true,null]' "L13 $1: c1 starts, lastStarts.morning null"
}
away_file "$D/home" 2026-10-03T07:00:00Z true 2026-10-03T11:00:00Z; daytime "(c) a block spanning the Morning, until 11:00" 2026-10-03T07:30:00Z
away_file "$D/home" 2026-10-03T12:00:00Z true 2026-10-03T13:00:00Z; daytime "(a) Lunch, until 13:00" 2026-10-03T12:30:00Z
started s1 2026-10-03T12:35:00Z
away_file "$D/home" 2026-10-03T14:00:00Z true 2026-10-03T22:05:00Z; daytime "(b) the Trickle suite's block, until 22:05" 2026-10-03T14:05:00Z
ok "$(recq '[r["kind"] for r in rows if r["kind"] in ("away-night", "last-start-held")]')" '[]' \
  "L13 (a)-(c): off --dry-run, no away-night or last-start-held line"
away_file "$D/home" 2026-10-04T09:00:00Z false 2026-10-04T18:00:00Z
J=$(nx 2026-10-04T09:15:00Z)
ok "$(count ran-past-morning)" 0 "L13 (d): s1, taken at 12:35 and still open, ran past no Morning: no marker, no line"
scen l13e-seconds
ro; mkt c1 ro open 'scope: cross-cutting'
history
away_file "$D/home" 2026-10-03T07:00:00Z true 2026-10-03T09:00:30Z
J=$(nx 2026-10-03T07:30:00Z --dry-run)
ok "$(q "$J" '[d["lastStarts"]["morning"], [h["slug"] for h in d["hold"]]]')" '["2026-10-03T09:00:00+00:00",["c1"]]' \
  "L13 (e): until 09:00:30 is on the Morning to the minute: M is 09:00:00"

# ── L14: an unreadable record writes no night line, warning only when the last starts apply ───────────────────
scen l14-unreadable
ro; mkt c1 ro open 'scope: cross-cutting'
history; night
mkdir -p "$D/events/ro.jsonl"
J=$(nx 2026-10-03T07:30:00Z)
ok "$(q "$J" "$holds")" "{\"c1\":\"$CC\"}" "L14: the hold stands"
ok "$(grep -c '^run_record: warning: night record not written: ' "$D/err")" 1 "L14: one night-record warning while the last starts apply"
rm -f "$D/home/.config/thread/away.json"
J=$(nx 2026-10-03T07:30:00Z)
ok "$(grep -c 'night record' "$D/err")" 0 "L14: not Away, the same record is silent"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
