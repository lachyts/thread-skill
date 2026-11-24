#!/usr/bin/env bash
# p55-5 (ADR 0085 d3, d5, d6 and d9): at its second compaction a parallel rollout's lead drains and hands over.
# reconcile-rollout.py `next` starts the drain at the caller's count (LEAD_HANDOVER_COMPACTIONS) or at a Lead error
# that hands over, stamps `paused:` once drained (or at HAND_OVER_DRAIN_MINUTES, the bound), and halts `hand-over`;
# `stamp-start --hand-over` lists it, `hand-over --manual` hands it over off the Stage, `hand-over --abort` is his
# pause over it, and `clear-pause` refuses the handing session (exit 4) and lets a fresh one take it. Every planted
# state goes through the engine's own writers (record-entry, mark-started, bind-run, mark-integrating, free-lane,
# lead-error); the count files are planted as p55-4's hook writes them.
#   HO1 next at the count   HO2 drained   HO2b a call the summary lost   HO3 the bound   HO4 his pause
#   HO5 the listing   HO6 the manual form   HO7 the Reinstate   HO8 a fresh session mid-drain   HO9 join and carry
#   HO10 a Lead error at its bound   HO11 a second hand-over   HO12 nothing to hand   HO13 identity
#   HO14 the start stamp   HO15 an Approved queue's regenerate waits for the fresh lead
# (the Waiting list row and the needs-you item are reconcile-rollout-hand-over-leads.test.sh's; moving's readings
# reconcile-rollout-moving.test.sh's; the Stop driver's lines rollout-stop-driver.test.sh's; the ledger's
# reflect-ledger.test.mjs's; reconcile's merge-step at the bound reconcile-rollout-record.test.sh's.)
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR and ignores THREAD_TEST_EVENTS_DIR.
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd -P)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
V="$HOME/repos/obsidian/Work/Tasks"
mkdir -p "$V" "$TMP/journal"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR
EV="$TMP/events"
export THREAD_EVENTS_DIR="$EV"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export THREAD_MACHINE_TIMES='{}'
export THREAD_HEAT_LEVEL=0
CD="$HOME/.config/thread/compactions"
# Away with an Away cap that never binds, written fresh for every --now here: each rollout runs to its own ceiling, so
# one case's running rows never hold another's starts on the Mac-wide cap.
mkdir -p "$HOME/.config/thread"
printf '{"away": true, "until": "2099-01-01T00:00:00Z", "morning": "09:00", "trickle": 2, "away_cap": 99, "written_at": "2026-11-25T09:00:00Z"}\n' \
  > "$HOME/.config/thread/away.json"
T0=2026-11-25T10:00:00Z               # every case's drain starts here
S0=2026-11-25T10:00+00:00             # … its stamp
PR=https://github.com/o/r/pull

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok "$1" "*$2*" "$3";; esac; }
hasnt() { case "$1" in *"$2"*) ok "$1" "no $2" "$3";; *) ok y y "$3";; esac; }

N() { printf 'ho%s-rollout-2026-11-25' "$1"; }
mkro() {  # mkro <case> <task slug>... -- [frontmatter lines...]: a parallel rollout note linking its tasks
  local c=$1 s; s=$(N "$1"); shift
  local tasks="" fm=""
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do tasks="$tasks- [[$1]]\n"; shift; done
  [ $# -gt 0 ] && shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\nprojects: ["[[X]]"]\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n' "$TMP/repo"; printf -- "$tasks"; } > "$V/$s.md"
}
mkt() {  # mkt <slug> <case> <status> [frontmatter lines...]
  local s=$1 c=$2 st=$3; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\nprojects: ["[[X]]"]\n' "$st" "$(N "$c")"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nA task.\n'; } > "$V/$s.md"
}
fmv() { python3 - "$V/$1.md" "$2" <<'PY'
import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")
PY
}
fmc() { fmv "$(N "$1")" "$2"; }       # fmc <case> <key>: the rollout note's frontmatter value
setfm() { python3 - "$V/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
head, rest = open(p).read().split("\n---\n", 1)
lines = [l for l in head.split("\n") if not re.match(rf"^{re.escape(k)}:", l)]
if v != "-":
    lines.append(f"{k}: {v}")
open(p, "w").write("\n".join(lines) + "\n---\n" + rest)
PY
}
plog() { sed -n '/^## Pause log$/,/^## /p' "$V/$(N "$1").md" | grep '^- ' ; }   # plog <case>: its Pause log lines
sum() { cksum < "$V/$(N "$1").md"; }
rec() { cat "$EV/$(N "$1").jsonl" 2>/dev/null; }
recq() {  # recq <case> <python expr over L, the record's lines>
  python3 - "$EV/$(N "$1").jsonl" "$2" <<'PY'
import json, sys
try:
    L = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
except FileNotFoundError:
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY
}
q() { python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))' "$1" "$2"; }
count() {  # count <case> <session> <n>: the count file p55-4's hook writes
  mkdir -p "$CD/$(N "$1")"; printf '{"version": 1, "rollout": "%s", "session": "%s", "count": %s, "told": %s}\n' \
    "$(N "$1")" "$2" "$3" "$3" > "$CD/$(N "$1")/$2.json"
}
rr() { python3 "$SCRIPT" "$@"; }
# nx <case> <session|-> [args...]: `next` as that session (- for none) at $T0 unless --now follows; its JSON on stdout
nx() { local c=$1 s=$2; shift 2
  if [ "$s" = - ]; then rr next --rollout "$V/$(N "$c").md" --tasks-dir "$V" --now "$T0" "$@" 2>"$TMP/nx.err"
  else CLAUDE_CODE_SESSION_ID=$s rr next --rollout "$V/$(N "$c").md" --tasks-dir "$V" --now "$T0" "$@" 2>"$TMP/nx.err"; fi; }
as() { local s=$1; shift; if [ "$s" = - ]; then "$@"; else CLAUDE_CODE_SESSION_ID=$s "$@"; fi; }
ent() { local c=$1 s=$2; shift 2; as "$s" rr record-entry --rollout "$V/$(N "$c").md" --by stage "$@" >/dev/null; }
cp_() { local c=$1 s=$2; shift 2; as "$s" rr clear-pause --rollout "$V/$(N "$c").md" --tasks-dir "$V" "$@"; }
ss() { local c=$1; shift; rr stamp-start --rollout "$V/$(N "$c").md" --tasks-dir "$V" "$@"; }
ho() { local c=$1; shift; rr hand-over --rollout "$V/$(N "$c").md" --tasks-dir "$V" "$@"; }
started() {  # started <case> <slug> <runId>: the task's Slot and its bound task call, through the engine's writers
  rr mark-started --tasks "$2" --rollout "$V/$(N "$1").md" --tasks-dir "$V" --now "$T0" >/dev/null
  : > "$TMP/journal/$3.json"
  rr bind-run --tasks "$2" --run-id "$3" --call task --journal-dir "$TMP/journal" --tasks-dir "$V" >/dev/null
}
mins() { python3 -c 'import sys; from datetime import datetime, timedelta; print((datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")) + timedelta(minutes=int(sys.argv[2]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$T0" "$1"; }

echo "== HO1. next at the count: the drain's stamps, its line, its record line, nothing new starts"
mkro 1 ho1-a ho1-b; mkt ho1-a 1 in_progress; mkt ho1-b 1 open
ent 1 s1 --now 2026-11-25T09:00:00Z
count 1 s1 1
J=$(nx 1 s1 --running ho1-a --dry-run)
ok "$(q "$J" '[d["start"], d["handOver"]["due"], d["handOver"]["why"]]')" '[["ho1-b"],false,"compaction 1 of 2: not due"]' "HO1 control: count 1 starts the queued row"
count 1 s-other 2
J=$(nx 1 s1 --running ho1-a --dry-run)
ok "$(q "$J" '[d["start"], d["handOver"]["due"]]')" '[["ho1-b"],false]' "HO1 control: count 2 of another session is not the caller's"
count 1 s1 2
before=$(sum 1); recs=$(rec 1 | wc -l)
J=$(nx 1 s1 --running ho1-a --dry-run)
ok "$(q "$J" '[d["start"], d["handOver"]["due"], d["handOver"]["state"]]')|$(sum 1)|$(rec 1 | wc -l)" "[[\"ho1-b\"],true,null]|$before|$recs" \
  "HO1 control: --dry-run reads it due, stamps nothing and writes nothing"
J=$(nx 1 s1 --running ho1-a)
ok "$(q "$J" '[d["start"], d["restart"], d["hold"], d["halt"]]')" '[[],[],[{"slug":"ho1-b","reason":"hand-over: draining (a Lead hand-over)"}],null]' \
  "HO1: count 2: nothing starts, the queued row held as the drain"
ok "$(q "$J" '{k: d["handOver"][k] for k in ("due", "cause", "state", "at", "count", "session", "since")}')" \
  "{\"due\":true,\"cause\":\"compactions\",\"state\":\"draining\",\"at\":2,\"count\":2,\"session\":\"s1\",\"since\":\"$S0\"}" "HO1: … handOver draining"
ok "$(fmc 1 pause_requested)|$(fmc 1 paused_for)|$(fmc 1 paused)" "true|hand-over|<none>" "HO1: … both stamps, no paused:"
ok "$(plog 1)" "- $S0 hand-over: draining (compactions; session s1; count 2)" "HO1: … the draining line names the session"
ok "$(recq 1 '[{k: d.get(k) for k in ("outcome", "cause", "session", "count")} for d in L if d["kind"] == "hand-over"]')" \
  '[{"outcome":"drain","cause":"compactions","session":"s1","count":2}]' "HO1: … the record's hand-over drain line"
ok "$(recq 1 '[d["reason"] for d in L if d["kind"] == "idle-slots"]')" '["hand-over-drain"]' "HO1: … its idle Slots read hand-over-drain"

echo "== HO2. drained: paused: stamped, paused_for kept, halt hand-over"
J=$(nx 1 s1 --running "" --now 2026-11-25T10:20:00Z)
ok "$(q "$J" '[d["pausedNow"], d["halt"], d["restart"], d["handOver"]["state"]]')" '[true,"hand-over",[],"drained"]' \
  "HO2: nothing live (ho1-a stalled does not block): pausedNow, halt hand-over, no restart"
ok "$(fmc 1 paused)|$(fmc 1 pause_requested)|$(fmc 1 paused_for)" "2026-11-25T10:20+00:00|<none>|hand-over" "HO2: … paused: stamped, paused_for kept"
ok "$(recq 1 '[d["mode"] for d in L if d["kind"] == "paused"]')" '["hand-over"]' "HO2: … the paused line's mode hand-over"

echo "== HO2b. a call the summary lost: handOver.open names it; listed in --running, the drain waits"
mkro 2b ho2b-a ho2b-b; mkt ho2b-a 2b in_progress; mkt ho2b-b 2b open
ent 2b s2 --now 2026-11-25T09:00:00Z; started 2b ho2b-a wf_ho2b_a; count 2b s2 2
J=$(nx 2b s2 --running ho2b-a)
ok "$(q "$J" '[d["handOver"]["state"], d["handOver"]["open"], d["halt"]]')" '["draining",[],null]' "HO2b: listed in --running, the drain waits on it"
J=$(nx 2b s2 --running "" --now 2026-11-25T10:05:00Z)
ok "$(q "$J" '[d["handOver"]["state"], d["handOver"]["open"], d["halt"]]')" \
  '["drained",[{"task":"ho2b-a","runId":"wf_ho2b_a","call":"task"}],"hand-over"]' "HO2b: left out of --running: drained, open names it with its runId"
J=$(nx 2b s2 --running ho2b-a --now 2026-11-25T10:06:00Z)
ok "$(q "$J" '[d["handOver"]["open"], d["running"], d["halt"]]')" '[[],["ho2b-a"],"hand-over"]' "HO2b: listed again under paused:, halt is still hand-over"
mkro 2c ho2c-a; mkt ho2c-a 2c in_progress
ent 2c s2c --now 2026-11-25T09:00:00Z; started 2c ho2c-a wf_ho2c_a; count 2c s2c 2
J=$(nx 2c s2c --running "")
ok "$(q "$J" '[d["handOver"]["state"], d["handOver"]["open"], d["halt"]]')" \
  '["drained",[{"task":"ho2c-a","runId":"wf_ho2c_a","call":"task"}],"hand-over"]' "HO2b: the one call that starts it and stamps paused: names the lost call too"

echo "== HO3. the bound: past 160 min with work in flight"
mkro 3 ho3-a ho3-b ho3-c; mkt ho3-a 3 in_progress; mkt ho3-b 3 open; mkt ho3-c 3 review "pr: $PR/3"
ent 3 s3 --now 2026-11-25T09:00:00Z; started 3 ho3-a wf_ho3_a
rr mark-integrating --tasks ho3-c --tasks-dir "$V" --now "$T0" >/dev/null
count 3 s3 2
nx 3 s3 --running ho3-a >/dev/null
J=$(nx 3 s3 --running ho3-a --now "$(mins 159)")
ok "$(q "$J" '[d["handOver"]["state"], d["halt"]]')|$(plog 3 | wc -l | tr -d ' ')" '["draining",null]|1' "HO3: at 159 min the drain holds"
J=$(nx 3 s3 --running ho3-a --now "$(mins 161)")
ok "$(q "$J" '[d["halt"], d["handOver"]["state"], d["handOver"]["stop"], d["pausedNow"]]')" \
  '["hand-over","bound",[{"slug":"ho3-a","runId":"wf_ho3_a"},{"slug":"ho3-c"}],true]' "HO3: at 161 min: paused:, halt hand-over at once, stop names the call and the lane"
ok "$(plog 3 | tail -1)" "- 2026-11-25T12:41+00:00 hand-over: bound after 161 min: stopping ho3-a (wf_ho3_a); lane ho3-c" \
  "HO3: … the bound line, the lane holder named"
hasnt "$(plog 3 | tail -1)" "[[" "HO3: … the bound line holds no wikilink"
ok "$(fmc 3 paused)|$(fmc 3 paused_for)" "2026-11-25T12:41+00:00|hand-over" "HO3: … paused: stamped, paused_for kept"
ok "$(recq 3 '[[d["kind"], d.get("task"), d.get("outcome") or d.get("release") or d.get("mode")] for d in L if d["ts"] >= "2026-11-25T12:41"]' )" \
  '[["paused",null,"hand-over"],["hand-over",null,"bound"],["slot-freed","ho3-a","stopped"],["lane-freed","ho3-c","halt"],["idle-slots",null,null]]' \
  "HO3: … the record: paused, the bound line, the Slot stopped, the lane freed"
ok "$(recq 3 '[d["drainMinutes"] for d in L if d["kind"] == "hand-over" and d["outcome"] == "bound"]')" '[161]' "HO3: … drainMinutes 161"
nx 3 s3 --running ho3-a --now "$(mins 170)" >/dev/null
ok "$(plog 3 | grep -c 'bound after')|$(recq 3 'sum(1 for d in L if d["kind"] == "hand-over" and d["outcome"] == "bound")')" "1|1" "HO3: a second call writes no second line"

echo "== HO4. his pause: no hand-over under it; --abort takes over the drain, the paused: and a listing"
mkro 4 ho4-a ho4-b -- "pause_requested: true"; mkt ho4-a 4 in_progress; mkt ho4-b 4 open
ent 4 s4 --now 2026-11-25T09:00:00Z; count 4 s4 2
J=$(nx 4 s4 --running ho4-a)
ok "$(fmc 4 paused_for)|$(plog 4 | wc -l | tr -d ' ')|$(q "$J" 'd["handOver"]["due"]')" "<none>|0|false" "HO4: his pause_requested at count 2: no hand-over"
setfm "$(N 4)" pause_requested -; setfm "$(N 4)" paused 2026-11-25T09:30+00:00
nx 4 s4 --running "" >/dev/null
ok "$(fmc 4 paused_for)|$(plog 4 | wc -l | tr -d ' ')" "<none>|0" "HO4: his paused: at count 2: no hand-over"
cp_ 4 s4 >/dev/null
nx 4 s4 --running ho4-a >/dev/null
ok "$(fmc 4 paused_for)|$(plog 4 | wc -l | tr -d ' ')" "hand-over|1" "HO4: his Reinstate: the first next hands over"
out=$(ho 4 --abort --why "his pause" --now 2026-11-25T10:05:00Z)
ok "$(fmc 4 pause_requested)|$(fmc 4 paused_for)|$(plog 4 | tail -1)" "<none>|<none>|- 2026-11-25T10:05+00:00 hand-over: not handed over (his pause)" \
  "HO4: --abort during the drain: the stamps go, the not-handed line"
ok "$(recq 4 '[[d["outcome"], d.get("why")] for d in L if d["kind"] == "hand-over"][-1]')" '["not-handed","his pause"]' "HO4: … the record's not-handed line"
nx 4 s4 --running "" --now 2026-11-25T10:10:00Z >/dev/null
ok "$(fmc 4 paused_for)|$(fmc 4 paused)" "hand-over|2026-11-25T10:10+00:00" "HO4: the count stands: the next next hands over again, and drains"
ho 4 --abort --why "his pause" --now 2026-11-25T10:15:00Z >/dev/null
ok "$(fmc 4 paused)|$(fmc 4 paused_for)|$(recq 4 '[d["kind"] for d in L][-2:]')" '<none>|<none>|["resumed","hand-over"]' \
  "HO4: --abort after paused:: the stamps go, resumed then not-handed"
nx 4 s4 --running "" --now 2026-11-25T10:20:00Z >/dev/null; ss 4 --hand-over --now 2026-11-25T10:21:00Z >/dev/null
ok "$(fmc 4 start)" "unattended" "HO4: … handed over and listed again"
ho 4 --abort --why "his pause" --now 2026-11-25T10:25:00Z >/dev/null
ok "$(fmc 4 start)|$(fmc 4 paused)" "<none>|<none>" "HO4: --abort after a listing: the start stamp goes too"
before=$(sum 4)
ok "$(ho 4 --abort --why "his pause" --now 2026-11-25T10:30:00Z)|$(sum 4)" "$(N 4): no Lead hand-over stands [no-change]|$before" "HO4: a second abort writes nothing"

echo "== HO5. the listing: stamp-start --hand-over"
mkro 5 ho5-a ho5-b; mkt ho5-a 5 in_progress; mkt ho5-b 5 done
ent 5 s5 --now 2026-11-25T09:00:00Z; count 5 s5 2
nx 5 s5 --running ho5-a >/dev/null
out=$(ss 5 --hand-over --now 2026-11-25T10:01:00Z 2>&1); rc=$?
ok "$rc|$(fmc 5 start)" "1|<none>" "HO5: refused while it drains (no hand-over paused:), nothing written"
has "$out" "carries no hand-over paused:" "HO5: … saying why"
nx 5 s5 --running "" --now 2026-11-25T10:02:00Z >/dev/null
out=$(ss 5 --hand-over --gated --now 2026-11-25T10:03:00Z); rc=$?
ok "$rc|$out" "0|ROLLOUT-STATUS: $(N 5) merged=1/2 running=0 state=done reason=\"handed over: listed on the Waiting list for a fresh lead\"" \
  "HO5: the listing prints the done line"
ok "$(fmc 5 start)|$(plog 5 | tail -1)" "unattended|- 2026-11-25T10:03+00:00 hand-over: listed (gated)" "HO5: … start: unattended, the listed line, --gated logged"
ok "$(recq 5 '[{k: d.get(k) for k in ("outcome", "listed", "session", "gated")} for d in L if d["kind"] == "hand-over"][-1]')" \
  '{"outcome":"handed","listed":true,"session":"s5","gated":true}' "HO5: … the record's handed line"
before=$(sum 5); recs=$(rec 5 | wc -l)
ok "$(ss 5 --hand-over --now 2026-11-25T10:09:00Z)|$(sum 5)|$(rec 5 | wc -l)" "$out|$before|$recs" "HO5: a repeat writes nothing and prints the line again"
out=$(ss 5 2>&1); rc=$?
ok "$rc" 1 "HO5: a plain stamp-start still refuses it"
has "$out" "is paused" "HO5: … as paused"

echo "== HO6. the manual form: hand-over --manual"
mkro 6 ho6-a; mkt ho6-a 6 open
ent 6 s6 --now 2026-11-25T09:00:00Z; count 6 s6 2
nx 6 s6 --running "" >/dev/null
out=$(ho 6 --manual --gated --now 2026-11-25T10:01:00Z)
ok "$out" "[[$(N 6)]] lead hand-over: start a fresh lead in a new session with /thread:execute [[$(N 6)]] --gated
ROLLOUT-STATUS: $(N 6) merged=0/1 running=0 state=halted reason=\"lead hand-over: start a fresh lead with /thread:execute [[$(N 6)]] --gated\"" \
  "HO6: the needs-you line and the halted line"
ok "$(fmc 6 start)|$(plog 6 | tail -1)" "<none>|- 2026-11-25T10:01+00:00 hand-over: manual (gated)" "HO6: … no start stamp, the manual line"
ok "$(recq 6 '[[d["outcome"], d.get("listed")] for d in L if d["kind"] == "hand-over"][-1]')" '["handed",false]' "HO6: … the record's handed line, listed false"
ok "$(ss 6 --hand-over)|$(fmc 6 start)" "$out|<none>" "HO6: inside the same hand-over the manual finish stands: a listing prints its lines and stamps nothing"

echo "== HO7. the Reinstate: a fresh session's entry, clear-pause and next"
ent 5 s-new --now 2026-11-25T11:00:00Z
ok "$(recq 5 '[[d["kind"], d.get("by"), d.get("stop")] for d in L if d["ts"] >= "2026-11-25T11:00"]')" '[["lead-entry","stage","hand-over"]]' \
  "HO7: record-entry writes lead-entry stop hand-over and no inferred stopped line"
out=$(cp_ 5 s-new --now 2026-11-25T11:01:00Z); rc=$?
ok "$rc|$(fmc 5 paused)|$(fmc 5 paused_for)|$(plog 5 | tail -1)" "0|<none>|<none>|- 2026-11-25T11:01+00:00 hand-over: taken by session s-new" \
  "HO7: clear-pause clears and logs taken"
ok "$(recq 5 '[d["kind"] for d in L][-1]')" '"resumed"' "HO7: … resumed"
J=$(nx 5 s-new --running "" --now 2026-11-25T11:02:00Z)
ok "$(q "$J" '[d["startCleared"], d["restart"], d["halt"], d["handOver"]["state"]]')|$(fmc 5 start)" '[true,["ho5-a"],null,null]|<none>' \
  "HO7: its next clears the start stamp and restarts the stalled row"

echo "== HO8. a fresh session mid-drain lifts it and goes on in the same call"
mkro 8 ho8-a ho8-b; mkt ho8-a 8 in_progress; mkt ho8-b 8 open
ent 8 s8 --now 2026-11-25T09:00:00Z; count 8 s8 2
nx 8 s8 --running ho8-a >/dev/null
J=$(nx 8 s-fresh --running ho8-a --now 2026-11-25T10:10:00Z)
ok "$(q "$J" '[d["start"], d["handOver"]["state"]]')|$(fmc 8 pause_requested)|$(fmc 8 paused_for)" '[["ho8-b"],null]|<none>|<none>' \
  "HO8: lifted, and the queued row starts in the same call"
ok "$(plog 8 | tail -1)|$(recq 8 '[[d["outcome"], d.get("why")] for d in L if d["kind"] == "hand-over"][-1]')" \
  "- 2026-11-25T10:10+00:00 hand-over: lifted (another session leads)|[\"not-handed\",\"another session leads\"]" "HO8: … the lifted line and not-handed"

echo "== HO9. join accepts a handing-over rollout; carry refuses it"
mkro 9 ho9-a; mkt ho9-a 9 in_progress
ent 9 s9 --now 2026-11-25T09:00:00Z; count 9 s9 2
nx 9 s9 --running ho9-a >/dev/null
printf -- '---\ntags: [task]\nstatus: open\nprojects: ["[[X]]"]\n---\n\n## Notes\n\nNew.\n' > "$V/ho9-new.md"
out=$(rr join --rollout "$V/$(N 9).md" --tasks ho9-new --tasks-dir "$V" --dry-run 2>&1); rc=$?
ok "$rc" 0 "HO9: join accepts it during the drain"
nx 9 s9 --running "" --now 2026-11-25T10:05:00Z >/dev/null
out=$(rr carry --from "$V/$(N 9).md" --tasks-dir "$V" --dry-run 2>&1); rc=$?
ok "$rc" 2 "HO9: carry refuses it under the hand-over's paused: (exit 2, nothing carried)"
has "$out" "is handing over to a fresh lead" "HO9: … saying why"

echo "== HO10. a Lead error at its bound hands over: what is in flight ends, nothing new begins"
mkro 10 ho10-a ho10-b ho10-c ho10-d; mkt ho10-a 10 in_progress
mkt ho10-b 10 review "pr: $PR/101"; mkt ho10-c 10 review "pr: $PR/102" "ready: 2026-11-25T09:30+00:00"; mkt ho10-d 10 review "pr: $PR/103"
ent 10 s10 --now 2026-11-25T09:00:00Z
mi() { as "${2:-s10}" rr mark-integrating --tasks "$1" --tasks-dir "$V" --now "$T0"; }
mi ho10-d >/dev/null; rr free-lane --tasks ho10-d --tasks-dir "$V" >/dev/null   # an Args refusal's leftover stamp
mi ho10-b >/dev/null                                                              # the lane's holder
le() { CLAUDE_CODE_SESSION_ID=${2:-s10} rr lead-error --rollout "$V/$(N 10).md" --tasks "${1:-ho10-d}" --site args-refusal </dev/null; }
le >/dev/null; le >/dev/null
J3=$(le)
ok "$(q "$J3" '[d["n"], d["over"], d["handOver"]]')" '[3,true,true]' "HO10: the third reads over and handOver"
J=$(nx 10 s10 --running "")
ok "$(q "$J" '[d["handOver"]["cause"], d["handOver"]["state"], d["handOver"]["held"], d["integrating"], d["awaitingIntegration"]]')" \
  '["lead-error","draining",["ho10-c","ho10-d"],["ho10-b"],[]]' "HO10 (i)(ii): cause lead-error: the lane's holder drains, the leftover and the awaiting row are held"
for s in ho10-c ho10-d; do
  before=$(cksum < "$V/$s.md"); recs=$(rec 10 | wc -l)
  out=$(mi $s 2>&1); rc=$?
  ok "$rc|$(cksum < "$V/$s.md")|$(rec 10 | wc -l)" "5|$before|$recs" "HO10 (ii): mark-integrating $s exits 5 and writes nothing"
  has "$out" "HAND-OVER: [[$s]]'s Integration waits" "HO10 (ii): … one HAND-OVER: line"
done
# The lane's holder between its integrate call and its merge: reconcile removed its `integrating:` stamp and the record's
# lane is still held on it (the lead's verify and merge-task run), so it stays in the drain, never held.
setfm ho10-b integrating -
J=$(nx 10 s10 --running "" --now 2026-11-25T10:02:00Z)
ok "$(q "$J" '[d["handOver"]["state"], d["handOver"]["held"], d["awaitingIntegration"], d["halt"], d["pausedNow"]]')|$(fmc 10 paused)" \
  '["draining",["ho10-c","ho10-d"],["ho10-b"],null,false]|<none>' "HO10 (ii): the lane's holder awaiting, its stamp reconciled away: in the drain, not held, no paused:"
ok "$(mi ho10-b >/dev/null 2>&1; echo $?)" 0 "HO10: the lane's holder re-takes it (a Base moved re-run passes)"
setfm ho10-b status done; rr free-lane --tasks ho10-b --tasks-dir "$V" >/dev/null 2>&1
J=$(nx 10 s10 --running "" --now 2026-11-25T10:30:00Z)
ok "$(q "$J" '[d["handOver"]["state"], d["halt"], d["handOver"]["held"]]')" '["drained","hand-over",["ho10-c","ho10-d"]]' \
  "HO10 (ii): the lane's holder landed: drained, both still held"
ss 10 --hand-over --now 2026-11-25T10:31:00Z >/dev/null
before=$(sum 10)
out=$(cp_ 10 s10 2>&1); rc=$?
ok "$rc|$(sum 10)" "4|$before" "HO13 (b): under cause lead-error, after the handed line, the handing session's clear-pause exits 4"
ent 10 s-new --now 2026-11-25T11:00:00Z; cp_ 10 s-new --now 2026-11-25T11:00:00Z >/dev/null
J=$(nx 10 s-new --running "" --now 2026-11-25T11:01:00Z)
ok "$(q "$J" '[d["integrating"], d["awaitingIntegration"]]')" '[["ho10-d"],["ho10-c"]]' "HO10 (iii): the fresh lead's next lists the leftover under integrating"
ok "$(mi ho10-d s-new >/dev/null 2>&1; echo $?)" 0 "HO10 (iii): … and mark-integrating re-takes the lane"
J=$(nx 10 s10 --running "" --now 2026-11-25T11:05:00Z --dry-run)
ok "$(q "$J" '[d["handOver"]["cause"], d["handOver"]["due"]]')" '[null,false]' "HO10 (vi): a line from before the handed line never re-triggers"
for k in 1 2 3; do le ho10-c s-x >/dev/null; done
le ho10-c >/dev/null; le ho10-c >/dev/null
ok "$(q "$(le ho10-c)" '[d["n"], d["total"], d["over"], d["handOver"]]')" '[3,6,true,false]' "HO10 (v): at the bound, the task's sixth total: handOver false"

echo "== HO11. a second hand-over: its own draining line, its own finish"
mkro 11 ho11-a; mkt ho11-a 11 open
ent 11 sA --now 2026-11-25T09:00:00Z; count 11 sA 2
nx 11 sA --running "" >/dev/null; ss 11 --hand-over --now 2026-11-25T10:01:00Z >/dev/null
ent 11 sB --now 2026-11-25T11:00:00Z; cp_ 11 sB --now 2026-11-25T11:00:00Z >/dev/null
nx 11 sB --running "" --now 2026-11-25T11:01:00Z >/dev/null
ok "$(fmc 11 paused_for)" "<none>" "HO11: sB at count 0 hands nothing over"
count 11 sB 2
nx 11 sB --running "" --now 2026-11-25T12:00:00Z >/dev/null
out=$(ss 11 --hand-over --now 2026-11-25T12:01:00Z)
ok "$(plog 11 | cut -c26-)" "hand-over: draining (compactions; session sA; count 2)
hand-over: listed
hand-over: taken by session sB
hand-over: draining (compactions; session sB; count 2)
hand-over: listed" "HO11: a second draining line and a second listed line"
ok "$(fmc 11 start)|$(recq 11 '[d.get("session") for d in L if d["kind"] == "hand-over" and d["outcome"] == "handed"]')" 'unattended|["sA","sB"]' \
  "HO11: … the stamp, and a second handed line"

echo "== HO12. nothing to hand"
mkro 12a ho12a-a; mkt ho12a-a 12a done; count 12a s12 2
J=$(nx 12a s12 --running "")
ok "$(q "$J" '[d["halt"], d["handOver"]["due"], d["handOver"]["why"]]')|$(fmc 12a paused_for)" '["complete",false,"nothing left to hand"]|<none>' \
  "HO12: every row merged: complete, nothing stamped"
mkro 12b; count 12b s12 2
J=$(nx 12b s12 --running "")
ok "$(q "$J" 'd["halt"]')|$(fmc 12b paused_for)" '"empty"|<none>' "HO12: a note linking no task: empty, nothing stamped"
mkro 12c ho12c-a -- 'superseded_by: "[[x]]"'; mkt ho12c-a 12c open; count 12c s12 2
J=$(nx 12c s12 --running "")
ok "$(q "$J" '[d["halt"], d["handOver"]]')|$(fmc 12c paused_for)" '["superseded",null]|<none>' "HO12: a superseded note: the early return, nothing stamped"
mkro 12d ho12d-a ho12d-b; mkt ho12d-a 12d in_progress; mkt ho12d-b 12d done; count 12d s12 2
nx 12d s12 --running ho12d-a >/dev/null
ok "$(fmc 12d paused_for)" "hand-over" "HO12: a drain with one row running"
setfm ho12d-a status done
J=$(nx 12d s12 --running "" --now 2026-11-25T10:10:00Z)
ok "$(q "$J" 'd["halt"]')|$(fmc 12d paused_for)|$(fmc 12d pause_requested)|$(plog 12d | tail -1)" \
  '"complete"|<none>|<none>|- 2026-11-25T10:10+00:00 hand-over: lifted (nothing left to hand)' "HO12: … its last row merged: lifted, and the same call reads complete"

echo "== HO13. identity"
mkro 13 ho13-a ho13-b; mkt ho13-a 13 in_progress; mkt ho13-b 13 open
ent 13 s13 --now 2026-11-25T09:00:00Z; count 13 s13 2
nx 13 s13 --running ho13-a >/dev/null
printf 'garbage\n' > "$CD/$(N 13)/s13.json"
J=$(nx 13 s13 --running ho13-a --now 2026-11-25T10:05:00Z)
ok "$(q "$J" 'd["handOver"]["state"]')|$(fmc 13 pause_requested)|$(fmc 13 paused_for)" '"draining"|true|hand-over' \
  "HO13 (c): a garbage count file of the handing session lifts nothing"
nx 13 s13 --running "" --now 2026-11-25T10:10:00Z >/dev/null; ss 13 --hand-over --now 2026-11-25T10:11:00Z >/dev/null
ent 13 s13 --now 2026-11-25T10:20:00Z
before=$(sum 13)
out=$(cp_ 13 s13 --now 2026-11-25T10:21:00Z); rc=$?
ok "$rc|$(sum 13)" "4|$before" "HO13 (a): after its own entry, the handing session's clear-pause exits 4 and writes nothing"
has "$out" "HAND-OVER-OWED: [[$(N 13)]]" "HO13 (a): … one HAND-OVER-OWED line"
echo "== HO14. the start stamp: the handing session's next keeps it"
J=$(nx 13 s13 --running "" --now 2026-11-25T10:22:00Z)
ok "$(q "$J" '[d["startCleared"], d["halt"]]')|$(fmc 13 start)" '[false,"hand-over"]|unattended' "HO14: its next reports startCleared false and keeps start: unattended"
# HO13 (d): no session id on either side: a Lead error with no session hands over; nothing is lifted or refused
mkro 13d ho13d-a ho13d-b; mkt ho13d-a 13d in_progress; mkt ho13d-b 13d open
ent 13d - --now 2026-11-25T09:00:00Z
for k in 1 2 3; do rr lead-error --rollout "$V/$(N 13d).md" --site command </dev/null >/dev/null; done
nx 13d - --running ho13d-a >/dev/null
ok "$(plog 13d)" "- $S0 hand-over: draining (lead-error; session none; count 0)" "HO13 (d): a session-less Lead error hands over, session none"
nx 13d s-x --running ho13d-a --now 2026-11-25T10:05:00Z >/dev/null
nx 13d - --running ho13d-a --now 2026-11-25T10:06:00Z >/dev/null
ok "$(fmc 13d paused_for)|$(plog 13d | wc -l | tr -d ' ')" "hand-over|1" "HO13 (d): … neither another session nor a session-less one lifts it"
nx 13d - --running "" --now 2026-11-25T10:07:00Z >/dev/null
out=$(cp_ 13d - --now 2026-11-25T10:08:00Z); rc=$?
ok "$rc|$(fmc 13d paused)|$(plog 13d | tail -1)" "0|<none>|- 2026-11-25T10:08+00:00 hand-over: taken by session none" "HO13 (d): … and a session-less clear-pause clears it"

echo "== HO15. an Approved queue: a hand-over is no run mark; halt hand-over under its paused:, regenerate after the Reinstate"
mkdir -p "$TMP/bin"   # a stub gh: the gating PR reads MERGED
printf '%s\n' '#!/usr/bin/env bash' 'echo "{\"state\":\"MERGED\",\"mergedAt\":null,\"url\":\"https://github.com/o/r/pull/202\"}"' > "$TMP/bin/gh"
chmod +x "$TMP/bin/gh"
mkro 15 ho15-a -- 'hold_until: {pr: o/r#202, merged: true}' 'on_merge: regenerate'; mkt ho15-a 15 open
ent 15 s15 --now 2026-11-25T09:00:00Z; count 15 s15 2
J=$(nx 15 s15 --running "" --gh-bin "$TMP/bin/gh")
ok "$(q "$J" '[d["halt"], d["handOver"]["state"], d["onMerge"]["action"], d["holdUntil"][0]["held"]]')|$(fmc 15 on_merge)|$(fmc 15 paused)" \
  "[\"hand-over\",\"drained\",\"regenerate\",true]|regenerate|$S0" "HO15: under its paused: the halt is hand-over, the hold and on_merge kept (no plain release)"
out=$(rr carry --from "$V/$(N 15).md" --tasks-dir "$V" --dry-run 2>&1); rc=$?
ok "$rc" 2 "HO15: carry still refuses the handing-over approved queue"
has "$out" "is handing over to a fresh lead" "HO15: … saying why"
ent 15 s-new --now 2026-11-25T11:00:00Z; cp_ 15 s-new --now 2026-11-25T11:00:00Z >/dev/null
J=$(nx 15 s-new --running "" --now 2026-11-25T11:01:00Z --gh-bin "$TMP/bin/gh")
ok "$(q "$J" '[d["halt"], d["onMerge"]["action"], d["onMerge"]["members"], d["handOver"]["state"]]')|$(fmc 15 on_merge)" \
  '["regenerate","regenerate",["ho15-a"],null]|regenerate' "HO15: after the fresh lead's clear-pause its next regenerates: the hand-over's lines are no run mark"

[ "$fail" -eq 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
