#!/usr/bin/env bash
# p29-12: a row that ends a Slot is its call's end. The lead reconciles at its next turn, which can come hours after
# the call ended (a lead held on a git-env hold, or idle), so reconcile reads the end from the call itself: the journal
# of the call bound to the task's open Slot (its run-bound line in the Run record). The note's `ready:` (and a
# read-only approval's `merged:`) and the row's slot-freed, ready, merged, set-aside and quota-stall events take that
# end, each event marked `stamp: call-end` with the reconcile's own clock as `reconciledAt`. With no readable end they
# fall back to the reconcile's clock, marked `stamp: fallback`, and the line says so. An integrate row is the lead's
# (the lane, ADR 0030): its events stay at the reconcile's clock, unmarked. The Integration log's wait= and the
# Integration queue then read from the true ready, and the night record from the true Slot end.
#
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR (one per scenario) and ignores
# THREAD_TEST_EVENTS_DIR (the knob tests/run.sh honours to run every other suite against an unwritable events dir).
# Usage: bash reconcile-rollout-ready-at.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
RR="$HERE/../../_shared/scripts/run_record.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
# Calls that reach rollout-settings.py read ~/.config/thread/rollouts.toml: HOME is an empty dir (p15-4's rule).
export HOME="$TMP/home"; mkdir -p "$HOME"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR XDG_STATE_HOME
export THREAD_EVENTS_DIR="$TMP/events"            # the Run record stays in temp; scen points it at the scenario's own dir
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"     # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
export THREAD_GIT_ENV_DIR="$TMP/git-env"          # mark-started's canary arm (p26-3) keeps its records in temp
export THREAD_HEAT_LEVEL=0                        # the Heat hold's reading, pinned: a hot Mac never flips an assertion

PR=https://github.com/o/r/pull
A40=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; B40=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; C40=cccccccccccccccccccccccccccccccccccccccc

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }

D=""; J=""
# scen <name>: a fresh vault dir, its own events dir and a session whose workflows/ dir holds the journals
scen() {
  D="$TMP/$1"; J="$D/sess/workflows"; mkdir -p "$D" "$J"
  export THREAD_EVENTS_DIR="$D/events"
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 3\n---\n\n'
    printf -- '## Notes\n\nProject root: `%s`\n\n## Queue\n\n' "$TMP/no-repo"; } > "$D/ro.md"
  echo "== $1"
}
# mkt <slug> <status> [frontmatter lines...]: a task note of `ro`, listed in its queue (scope cross-cutting unless a
# `scope:` line is given)
mkt() {
  local s=$1 st=$2 l scope='scope: cross-cutting'; shift 2
  for l in "$@"; do case "$l" in scope:*) scope="";; esac; done
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[ro]]"\n' "$st"
    [ -z "$scope" ] || printf '%s\n' "$scope"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody of %s\n' "$s"; } > "$D/$s.md"
  printf -- '- [[%s]]\n' "$s" >> "$D/ro.md"
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
setstatus() { python3 -c 'import re, sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(re.sub(r"(?m)^status: .*$", "status: " + sys.argv[2], t, count=1))' "$D/$1.md" "$2"; }
# start <slug> <now>: the lead's § 4 stamp, then mark-started (its slot-taken lands at <now>)
start() {
  setstatus "$1" in_progress
  python3 "$SCRIPT" mark-started --tasks "$1" --rollout "$D/ro.md" --tasks-dir "$D" --now "$2" >/dev/null 2>"$D/err-ms" \
    || { echo "FAIL - mark-started $1: $(cat "$D/err-ms")"; fail=1; }
}
# bind <slug> <runId> <now> [call]: bind-run right after the launch (the run's transcript dir exists, the journal not yet)
bind() {
  mkdir -p "$D/sess/subagents/workflows/$2"
  python3 "$SCRIPT" bind-run --tasks "$1" --run-id "$2" --call "${4:-task}" --journal-dir "$J" --tasks-dir "$D" --now "$3" \
    >/dev/null 2>"$D/err-bind" || { echo "FAIL - bind-run $1 $2: $(cat "$D/err-bind")"; fail=1; }
}
# journal <runId> <start ISO|-> <minutes|-> [status] [extra json]: the Workflow journal the call leaves when it ends
journal() {
  python3 - "$J/$1.json" "$1" "$2" "$3" "${4:-completed}" "${5:-}" <<'PY'
import json, sys
from datetime import datetime, timezone
out, run, start, minutes, status, extra = sys.argv[1:]
d = {"runId": run, "status": status, "args": {"mode": "task"}, "agentCount": 2, "totalTokens": 1000}
if start != "-":
    st = int(datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() * 1000)
    d["startTime"] = st
    if minutes != "-":
        d["durationMs"] = int(float(minutes) * 60000)
        end = datetime.fromtimestamp((st + d["durationMs"]) / 1000, timezone.utc)
        d["timestamp"] = end.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
if extra:
    d.update(json.loads(extra))
    d = {k: v for k, v in d.items() if v is not None}
json.dump(d, open(out, "w"))
PY
}
# rec <slug> <json fields> <now> [flags...]: reconcile one task-call row; its stdout+stderr land in $out
rec() {
  local s=$1 f=$2 now=$3; shift 3
  python3 -c 'import json, sys; d = {"slug": sys.argv[2], "rung": ""}; d.update(json.loads(sys.argv[3])); json.dump({"rolloutSlug": "ro", "tasks": [d]}, open(sys.argv[1], "w"))' \
    "$D/row-$s.json" "$s" "$f"
  out=$(python3 "$SCRIPT" reconcile --result "$D/row-$s.json" --tasks-dir "$D" --now "$now" "$@" 2>&1); rc=$?
}
REVIEW() { printf '{"status":"review","scope":"cross-cutting","prUrl":"%s/%s","reviewRoundsUsed":1,"planRoundsUsed":0}' "$PR" "$1"; }
# ev <slug> <kind> [keys...]: that task's events of that kind, each as [ts, <keys>...] (compact JSON)
ev() {
  python3 - "$D/events/ro.jsonl" "$@" <<'PY'
import json, sys
path, task, kind, keys = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
try:
    rows = [json.loads(l) for l in open(path) if l.strip()]
except FileNotFoundError:
    rows = []
print(json.dumps([[r["ts"]] + [r.get(k) for k in keys] for r in rows if r.get("task") == task and r["kind"] == kind],
                 separators=(",", ":")))
PY
}
count() { if [ -f "$D/events/ro.jsonl" ]; then wc -l < "$D/events/ro.jsonl" | tr -d ' '; else echo 0; fi; }
# floor_ok <slug>: `ok` when no event of that task written after its last slot-taken is earlier than that slot-taken
# (a reader that reads the record by ts would otherwise see the Slot end before it was last taken), else the offenders
floor_ok() {
  python3 - "$D/events/ro.jsonl" "$1" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
mine = [r for r in rows if r.get("task") == sys.argv[2]]
last = max((i for i, r in enumerate(mine) if r["kind"] == "slot-taken"), default=None)
bad = [] if last is None else [[r["kind"], r["ts"]] for r in mine[last + 1:] if r["ts"] < mine[last]["ts"]]
print("ok" if last is not None and not bad else json.dumps(bad or "no slot-taken"))
PY
}
nx() { python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$1" 2>"$D/err-next"; }
q() { printf '%s' "$1" | python3 -c 'import json, sys; d = json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":")))' "$2"; }

# ── R1: a call that ended at T and was reconciled 13 hours later stamps ready (note and event) at T ────────────────
scen r1-thirteen-hours
mkt a open
start a 2026-10-19T08:00:00Z
bind a wf_a1 2026-10-19T08:01:00Z
journal wf_a1 2026-10-19T08:01:00Z 71.5                       # ends T = 09:12:30Z
rec a "$(REVIEW 1)" 2026-10-19T22:12:30Z                       # the lead's next turn: T + 13 h
ok "$rc" 0 "R1: reconcile exits 0"
ok "$(fm a ready)" "ready: 2026-10-19T09:12+00:00" "R1: the note's ready: is the call's end, not the reconcile's clock"
has "$out" "a: status=review pr=$PR/1 ready=2026-10-19T09:12+00:00 [written]" "R1: the line names the ready stamp, no fallback"
ok "$(ev a ready pr stamp reconciledAt)" \
  "[[\"2026-10-19T09:12:30.000Z\",\"$PR/1\",\"call-end\",\"2026-10-19T22:12:30.000Z\"]]" \
  "R1: the ready event is at the call's end, marked call-end, with the reconcile's clock beside it"
ok "$(ev a slot-freed outcome stamp reconciledAt)" \
  '[["2026-10-19T09:12:30.000Z","ready","call-end","2026-10-19T22:12:30.000Z"]]' \
  "R1: slot-freed is at the call's end too (the Slot's call ended there)"
n=$(count)
cp "$D/a.md" "$D/a.before"
rec a "$(REVIEW 1)" 2026-10-20T01:00:00Z
cmp -s "$D/a.md" "$D/a.before"; ok "$?" 0 "R1: a re-reconcile at a later --now is byte-identical"
ok "$(count)" "$n" "R1: ... and records nothing (review -> review stamps no ready)"
# The Integration log's wait= reads from the true ready: 22:30 - 09:12 = 798 min (the reconcile's clock gave 18).
python3 "$SCRIPT" mark-integrating --tasks a --tasks-dir "$D" --now 2026-10-19T22:30:00Z >/dev/null
lo=$(python3 "$SCRIPT" log-integration --tasks a --started 2026-10-19T22:30+00:00 --anchor "$A40" --head "$B40" --base "$C40" \
  --tasks-dir "$D" --now 2026-10-19T22:45:00Z 2>&1)
has "$lo" "2026-10-19T22:30+00:00 integrated path=lead pr=1 anchor=$A40 head=$B40 base=$C40 wait=798 duration=15 triggers=-" \
  "R1: the Integration log's wait= runs from the true ready"

# ── R2: the Integration queue orders by the true ready ─────────────────────────────────────────────────────────────
scen r2-queue-order
mkt b open; mkt c open
start b 2026-10-19T08:00:00Z; start c 2026-10-19T08:00:00Z
bind b wf_b1 2026-10-19T08:01:00Z; bind c wf_c1 2026-10-19T08:01:00Z
journal wf_b1 2026-10-19T08:01:00Z 160                         # b ends 10:41
journal wf_c1 2026-10-19T08:01:00Z 140                         # c ends 10:21, earlier
rec b "$(REVIEW 2)" 2026-10-19T21:00:00Z
rec c "$(REVIEW 3)" 2026-10-19T21:00:00Z                       # one lead turn reconciles both
ok "$(fm b ready)|$(fm c ready)" "ready: 2026-10-19T10:41+00:00|ready: 2026-10-19T10:21+00:00" "R2: each ready: is its own call's end"
J2=$(HOME="$HOME" nx 2026-10-19T21:01:00Z)
ok "$(q "$J2" 'd["awaitingIntegration"]')" '["c","b"]' "R2: c's call ended first, so it integrates first (schedule order would put b first)"

# ── R3: a result with no readable end falls back to the reconcile's clock, marked ───────────────────────────────
scen r3-fallback
mkt f open
start f 2026-10-19T08:00:00Z                                   # a Slot, but no call bound to it
rec f "$(REVIEW 4)" 2026-10-19T12:00:00Z
ok "$rc" 0 "R3: reconcile exits 0"
ok "$(fm f ready)" "ready: 2026-10-19T12:00+00:00" "R3: ready: falls back to the reconcile's clock"
has "$out" "f: status=review pr=$PR/4 ready=2026-10-19T12:00+00:00 (fallback) [written]" "R3: the line marks the fallback"
ok "$(ev f ready stamp reconciledAt)" '[["2026-10-19T12:00:00.000Z","fallback",null]]' "R3: the ready event is marked fallback"
ok "$(ev f slot-freed outcome stamp)" '[["2026-10-19T12:00:00.000Z","ready","fallback"]]' "R3: so is slot-freed"

# ── R4: what counts as the call's end ─────────────────────────────────────────────────────────────────────────────
scen r4-guards
# g1: a journal that is not terminal (the call has not ended) is no end
mkt g1 open; start g1 2026-10-19T08:00:00Z; bind g1 wf_g1 2026-10-19T08:01:00Z; journal wf_g1 2026-10-19T08:01:00Z 30 running
rec g1 "$(REVIEW 11)" 2026-10-19T12:00:00Z
ok "$(fm g1 ready)" "ready: 2026-10-19T12:00+00:00" "R4 g1: a non-terminal journal falls back"
# g2: a journal naming another runId is no end
mkt g2 open; start g2 2026-10-19T08:00:00Z; bind g2 wf_g2 2026-10-19T08:01:00Z; journal wf_g2 2026-10-19T08:01:00Z 30 completed '{"runId":"wf_other"}'
rec g2 "$(REVIEW 12)" 2026-10-19T12:00:00Z
ok "$(fm g2 ready)|$(ev g2 ready stamp)" 'ready: 2026-10-19T12:00+00:00|[["2026-10-19T12:00:00.000Z","fallback"]]' "R4 g2: a journal naming another runId falls back"
# g3: an end after the reconcile's clock is no end
mkt g3 open; start g3 2026-10-19T08:00:00Z; bind g3 wf_g3 2026-10-19T08:01:00Z; journal wf_g3 2026-10-19T08:01:00Z 600
rec g3 "$(REVIEW 13)" 2026-10-19T12:00:00Z
ok "$(fm g3 ready)" "ready: 2026-10-19T12:00+00:00" "R4 g3: an end after now falls back"
# g4: a journal with no startTime/durationMs but a `timestamp` (written as the call ended) is read from that
mkt g4 open; start g4 2026-10-19T08:00:00Z; bind g4 wf_g4 2026-10-19T08:01:00Z
journal wf_g4 - - completed '{"timestamp":"2026-10-19T09:47:05.120Z"}'
rec g4 "$(REVIEW 14)" 2026-10-19T12:00:00Z
ok "$(fm g4 ready)|$(ev g4 ready stamp)" 'ready: 2026-10-19T09:47+00:00|[["2026-10-19T09:47:05.120Z","call-end"]]' "R4 g4: the journal's timestamp is the end"
# g5: a call bound in an earlier Slot is never this Slot's: set aside, restarted with no call bound yet
mkt g5 open; start g5 2026-10-19T08:00:00Z; bind g5 wf_g5a 2026-10-19T08:01:00Z; journal wf_g5a 2026-10-19T08:01:00Z 30
rec g5 '{"status":"blocked","scope":"cross-cutting","prUrl":"","blockerDiagnosis":"verifier red"}' 2026-10-19T09:00:00Z
ok "$(ev g5 set-aside stamp)" '[["2026-10-19T08:31:00.000Z","call-end"]]' "R4 g5: the first Slot's set-aside is at its call's end"
start g5 2026-10-19T10:00:00Z
rec g5 "$(REVIEW 15)" 2026-10-19T12:00:00Z
ok "$(fm g5 ready)" "ready: 2026-10-19T12:00+00:00" "R4 g5: the earlier Slot's call is not read: fallback"
# g6: a restart inside one open Slot (a dead lead) binds a second call: the latest bound call is the one that ended
mkt g6 open; start g6 2026-10-19T08:00:00Z; bind g6 wf_g6a 2026-10-19T08:01:00Z; journal wf_g6a 2026-10-19T08:01:00Z 20 failed
start g6 2026-10-19T09:00:00Z; bind g6 wf_g6b 2026-10-19T09:01:00Z; journal wf_g6b 2026-10-19T09:01:00Z 44
rec g6 "$(REVIEW 16)" 2026-10-19T12:00:00Z
ok "$(fm g6 ready)" "ready: 2026-10-19T09:45+00:00" "R4 g6: the restart's call is read, never the dead one"
# g6b: a restart re-takes the open Slot after its call died (killed at 08:21), but the launch fails, so nothing new is
# bound: the dead call's end is earlier than the re-take, so it is no end of this Slot's last call. Stamped there, the
# slot-freed would sit before the 09:00 slot-taken and split the Slot for every reader that reads the record by ts.
mkt g6b open; start g6b 2026-10-19T08:00:00Z; bind g6b wf_g6ba 2026-10-19T08:01:00Z
journal wf_g6ba 2026-10-19T08:01:00Z 20 killed
start g6b 2026-10-19T09:00:00Z
printf '%s' "workflow call failed: the launch was refused" | python3 "$HERE/../scripts/lead-integrate.py" set-aside --note "$D/g6b.md" --kind own \
  | python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now 2026-10-19T12:00:00Z >/dev/null 2>&1
ok "$(ev g6b slot-freed outcome stamp reconciledAt)" '[["2026-10-19T12:00:00.000Z","lost","fallback",null]]' \
  "R4 g6b: an end before the Slot's last slot-taken is no end: slot-freed falls back"
ok "$(ev g6b set-aside reasonClass stamp)" '[["2026-10-19T12:00:00.000Z","call-failed","fallback"]]' "R4 g6b: ... and so does set-aside"
ok "$(floor_ok g6b)" "ok" "R4 g6b: no event is earlier than the Slot's last slot-taken"
# g6c: the p84-8 pattern, a restart that re-binds the same runId, whose resumed run rewrites its journal: its end is read
mkt g6c open; start g6c 2026-10-19T01:00:00Z; bind g6c wf_g6c 2026-10-19T01:01:00Z
start g6c 2026-10-19T04:31:00Z; bind g6c wf_g6c 2026-10-19T04:32:00Z; journal wf_g6c 2026-10-19T04:32:00Z 238
rec g6c "$(REVIEW 61)" 2026-10-19T12:00:00Z
ok "$(fm g6c ready)|$(ev g6c ready stamp)" 'ready: 2026-10-19T08:30+00:00|[["2026-10-19T08:30:00.000Z","call-end"]]' \
  "R4 g6c: a re-take at 04:31, the same runId re-bound at 04:32, its journal ending 08:30: ready at 08:30"
# g6d: the same re-bind, but the resume never rewrote the journal: the file on disk is the earlier attempt's, ended
# 08:21, before the 09:00 re-take, so the row falls back
mkt g6d open; start g6d 2026-10-19T08:00:00Z; bind g6d wf_g6d 2026-10-19T08:01:00Z; journal wf_g6d 2026-10-19T08:01:00Z 20 failed
start g6d 2026-10-19T09:00:00Z; bind g6d wf_g6d 2026-10-19T09:01:00Z
rec g6d "$(REVIEW 62)" 2026-10-19T12:00:00Z
ok "$(fm g6d ready)" "ready: 2026-10-19T12:00+00:00" "R4 g6d: a re-bound run whose journal ended before the re-take: ready: falls back"
has "$out" "g6d: status=review pr=$PR/62 ready=2026-10-19T12:00+00:00 (fallback) [written]" "R4 g6d: the line marks the fallback"
ok "$(ev g6d ready stamp)|$(ev g6d slot-freed outcome stamp)" \
  '[["2026-10-19T12:00:00.000Z","fallback"]]|[["2026-10-19T12:00:00.000Z","ready","fallback"]]' "R4 g6d: ready and slot-freed are marked fallback"
ok "$(floor_ok g6d)" "ok" "R4 g6d: no event is earlier than the Slot's last slot-taken"
# g7: a journal that ended before the Slot was taken is a stale file, never this call's end
mkt g7 open; start g7 2026-10-19T08:00:00Z; bind g7 wf_g7 2026-10-19T08:01:00Z; journal wf_g7 2026-10-19T06:00:00Z 30
rec g7 "$(REVIEW 17)" 2026-10-19T12:00:00Z
ok "$(fm g7 ready)" "ready: 2026-10-19T12:00+00:00" "R4 g7: an end before the Slot was taken falls back"
# g8: a journal file that is not JSON
mkt g8 open; start g8 2026-10-19T08:00:00Z; bind g8 wf_g8 2026-10-19T08:01:00Z; printf 'not json' > "$J/wf_g8.json"
rec g8 "$(REVIEW 18)" 2026-10-19T12:00:00Z
ok "$rc|$(fm g8 ready)" "0|ready: 2026-10-19T12:00+00:00" "R4 g8: an unreadable journal falls back, exit 0"
# g9: no journal yet (still in flight, or never written)
mkt g9 open; start g9 2026-10-19T08:00:00Z; bind g9 wf_g9 2026-10-19T08:01:00Z
rec g9 "$(REVIEW 19)" 2026-10-19T12:00:00Z
has "$out" "g9: status=review pr=$PR/19 ready=2026-10-19T12:00+00:00 (fallback) [written]" "R4 g9: no journal (still in flight, or never written) falls back"

# ── R4b: score.py reads g6b's record as one Slot, 08:00 to the reconcile ──────────────────────────────────────────
# The reviewer's reproduction of g6b alone: with the dead call's 08:21 as the Slot's end, the 09:00 re-take opened a
# second Slot never freed (a never-finished gap, 0.85 running h); at the fallback it is one Slot, freed at 12:00.
scen r4b-retake-score
mkt g open; start g 2026-10-19T08:00:00Z; bind g wf_ga 2026-10-19T08:01:00Z
journal wf_ga 2026-10-19T08:01:00Z 20 killed
start g 2026-10-19T09:00:00Z
printf '%s' "workflow call failed: the launch was refused" | python3 "$HERE/../scripts/lead-integrate.py" set-aside --note "$D/g.md" --kind own \
  | python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now 2026-10-19T12:00:00Z >/dev/null 2>&1
S4=$(python3 "$HERE/../../reflect/scripts/score.py" --rollout ro --note "$D/ro.md" --until 2026-10-19T12:00:00Z --tasks-dir "$D" 2>"$D/err-score")
ok "$(q "$S4" '[d["runningTime"]["hours"], d["slots"]["closed"], d["slots"]["slotHours"]]')" '[4.0,1,4.0]' \
  "R4b: score.py reads one closed Slot, 08:00 to 12:00: 4.0 running h"
ok "$(q "$S4" '[e["kind"] for e in d["runningTime"]["excluded"]] + [f for f in d["flags"] if "never finished" in f]')" '[]' \
  "R4b: ... with no never-finished gap or flag"

# ── R5: the other events a Slot-ending row writes take the call's end too ───────────────────────────────────────
scen r5-siblings
# a read-only approval: done on its call's end, merged: and the merged event there
mkt r open 'scope: read-only'
start r 2026-10-19T08:00:00Z; bind r wf_r1 2026-10-19T08:01:00Z; journal wf_r1 2026-10-19T08:01:00Z 29
rec r '{"status":"review","scope":"read-only","prUrl":"","reviewRoundsUsed":1,"planRoundsUsed":0}' 2026-10-19T20:00:00Z
ok "$(fm r status)|$(fm r merged)|$(fm r ready)" "status: done|merged: 2026-10-19T08:30+00:00|<none>" "R5: a read-only approval is merged: at its call's end"
has "$out" "r: status=done (read-only, approved) merged=2026-10-19T08:30+00:00 [written]" "R5: the line names the merged stamp"
ok "$(ev r merged readOnly stamp)|$(ev r slot-freed outcome stamp)" \
  '[["2026-10-19T08:30:00.000Z",true,"call-end"]]|[["2026-10-19T08:30:00.000Z","completed","call-end"]]' \
  "R5: its merged and slot-freed events are at the call's end"
# a block: set-aside and slot-freed at the call's end
mkt s open
start s 2026-10-19T08:00:00Z; bind s wf_s1 2026-10-19T08:01:00Z; journal wf_s1 2026-10-19T08:01:00Z 59
rec s '{"status":"plan-blocked","scope":"cross-cutting","prUrl":"","blockerDiagnosis":"plan not approved"}' 2026-10-19T20:00:00Z
ok "$(ev s set-aside stage reasonClass stamp reconciledAt)" \
  '[["2026-10-19T09:00:00.000Z","plan","plan-rejected","call-end","2026-10-19T20:00:00.000Z"]]' "R5: a block's set-aside is at its call's end"
ok "$(ev s slot-freed outcome stamp)" '[["2026-10-19T09:00:00.000Z","set-aside","call-end"]]' "R5: ... and its slot-freed"
# a review row's master-review rounds were judged inside the call: each review-verdict line is at its end too
mkt v open
start v 2026-10-19T08:00:00Z; bind v wf_v1 2026-10-19T08:01:00Z; journal wf_v1 2026-10-19T08:01:00Z 44
rec v "{\"status\":\"review\",\"scope\":\"cross-cutting\",\"prUrl\":\"$PR/5\",\"reviewRoundsUsed\":1,\"planRoundsUsed\":0,\"reviewVerdicts\":[{\"round\":1,\"verdict\":\"approve\",\"head\":\"\",\"feedback\":[]}]}" \
  2026-10-19T20:00:00Z
ok "$(ev v review-verdict round verdict stamp)|$(fm v ready)" '[["2026-10-19T08:45:00.000Z",1,"approve","call-end"]]|ready: 2026-10-19T08:45+00:00' \
  "R5: a review-verdict line is at its call's end"
# a dead call's lead row (a quota stop): set-aside, slot-freed lost and quota-stall at the dead call's end
mkt dq open
start dq 2026-10-19T08:00:00Z; bind dq wf_dq 2026-10-19T08:01:00Z; journal wf_dq 2026-10-19T08:01:00Z 9 failed
printf '%s' "workflow call failed: usage limit reached" | python3 "$HERE/../scripts/lead-integrate.py" set-aside --note "$D/dq.md" --kind own \
  | python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now 2026-10-19T20:00:00Z >/dev/null 2>&1
ok "$(ev dq slot-freed outcome stamp)|$(ev dq quota-stall stamp)" \
  '[["2026-10-19T08:10:00.000Z","lost","call-end"]]|[["2026-10-19T08:10:00.000Z","call-end"]]' "R5: a dead call's slot-freed and quota-stall are at its end"
# an integrate row is the lead's: the lane frees at the reconcile's clock, unmarked, and stamps no ready
mkt i review "pr: $PR/9" 'ready: 2026-10-19T09:00+00:00' 'integrating: 2026-10-19T10:00+00:00'
python3 "$SCRIPT" mark-integrating --tasks i --tasks-dir "$D" --now 2026-10-19T10:00:00Z >/dev/null
python3 - "$D/row-i.json" <<'PY'
import json, sys
row = {"slug": "i", "status": "blocked", "prUrl": "https://github.com/o/r/pull/9", "reviewRoundsUsed": 1, "rung": "",
       "blockerDiagnosis": "revise: rejected at integration re-review",
       "integration": {"outcome": "rejected", "path": "judge-only", "anchor": {"headSha": "a" * 40}, "headSha": "b" * 40,
                       "baseSha": "c" * 40, "triggers": [], "metrics": {"startedAt": "2026-10-19T10:00+00:00"}}}
json.dump({"rolloutSlug": "ro", "tasks": [row]}, open(sys.argv[1], "w"))
PY
python3 "$SCRIPT" reconcile --result "$D/row-i.json" --tasks-dir "$D" --now 2026-10-19T20:00:00Z >/dev/null 2>&1
ok "$(ev i lane-freed release stamp)|$(fm i ready)" '[["2026-10-19T20:00:00.000Z","reject",null]]|ready: 2026-10-19T09:00+00:00' \
  "R5: an integrate row's lane-freed stays at the reconcile's clock, unmarked, and ready: is untouched"

# ── R6: --dry-run reads the end and prints it, writes and records nothing ────────────────────────────────────────
scen r6-dry-run
mkt d open
start d 2026-10-19T08:00:00Z; bind d wf_d1 2026-10-19T08:01:00Z; journal wf_d1 2026-10-19T08:01:00Z 59
n=$(count); cp "$D/d.md" "$D/d.before"
rec d "$(REVIEW 21)" 2026-10-19T20:00:00Z --dry-run
has "$out" "d: status=review pr=$PR/21 ready=2026-10-19T09:00+00:00 (dry-run)" "R6: --dry-run prints the stamp it would write"
cmp -s "$D/d.md" "$D/d.before"; ok "$?|$(count)" "0|$n" "R6: ... and writes and records nothing"

# ── R7: the night record reads the Slot as ended at its call's end ─────────────────────────────────────────────
# Away to the Morning 08:00 (an away-night marker); n's call ended at 03:00 and the lead reconciled at 09:00, after
# the Morning: n never ran past it. m has no readable end: its Slot reads open at 08:00, as before (the control).
scen r7-night
mkt n open; mkt m open
python3 "$RR" emit --kind away-night --rollout ro --json '{"morning":"2026-10-20T08:00:00Z"}' --ts 2026-10-20T00:30:00Z
start n 2026-10-20T01:00:00Z; bind n wf_n1 2026-10-20T01:01:00Z; journal wf_n1 2026-10-20T01:01:00Z 119
start m 2026-10-20T01:00:00Z
rec n "$(REVIEW 31)" 2026-10-20T09:00:00Z
rec m "$(REVIEW 32)" 2026-10-20T09:00:00Z
J7=$(HOME="$HOME" nx 2026-10-20T09:05:00Z)
ok "$(ev n ran-past-morning)|$(ev m ran-past-morning)" '[]|[["2026-10-20T09:05:00.000Z"]]' \
  "R7: n's call ended before the Morning, so no ran-past-morning line; m (fallback) reads as before"

exit $fail
