#!/usr/bin/env bash
# p55-4 (ADR 0085 d3 and d4): a compaction is counted on disk and sends the lead back to its rules. The plugin's
# SessionStart hook (hooks/rollout-compaction.py, matcher `compact`) counts a compaction of a session that leads a
# parallel rollout and prints one line into its context; reconcile-rollout.py `compactions` is the heartbeat's
# backstop (it raises the count to the transcript's marks and says whether a § 1 re-entry is owed); `next` reports
# the count. Every planted state goes through the engine's own writers: record-entry for the lead, the Stop hook for
# a halt, step-boundary.py for a room stop (a dated `## Pause log` line for an old one), record-pause for an open
# pause line. The hook reads the wall clock, so its cases put the lead-entry in the past and a room stop at now.
#   H1 one compaction adds one   H2 a non-lead session   H3 a broken Run record   H3b one broken note never turns the
#   hook off   H4 not the lead's compaction   H5 the skips   H6 the stops (one table)   H7 the root   H8 a count that
#   cannot be written   H9 wiring and floor   H10 unknown keys survive
#   B1 the raise   B3 no file   B6 decoys   B7 the transcript   B8 not the lead   B9 --dry-run   B10 skips, usage and
#   the guard   B11 a mark before the first lead-entry   B12 a mark while another session led   B13 undated marks
#   B14 a stop keeps the order owed, and the entry that ends it takes it   B15 the hook's deferral no entry followed is
#   ordered at the first tick   B16 the over-count WARN   B17 the held room stop   B18 an invalid told   B19 a file of
#   another version   N1-N4 next's key
# (bind-run's journal dir, rebuilt on the shared transcript lookup, is reconcile-rollout-record.test.sh's.)
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR and ignores THREAD_TEST_EVENTS_DIR.
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd -P)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
SB="$HERE/../scripts/step-boundary.py"
PLUGIN="$(cd "$HERE/../../.." && pwd -P)"
HOOK="$PLUGIN/hooks/rollout-compaction.py"
DRIVER="$PLUGIN/hooks/rollout-stop-driver.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
V="$HOME/repos/obsidian/Work/Tasks"   # reconcile-rollout.py's DEFAULT_TASKS_DIR: the hook finds rollout notes here
mkdir -p "$V"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR
EV="$TMP/events"
export THREAD_EVENTS_DIR="$EV"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export ROLLOUT_DRIVER_STATE_DIR="$TMP/driver"
export THREAD_MACHINE_TIMES='{}'
export THREAD_HEAT_LEVEL=0
CD="$HOME/.config/thread/compactions"
PJ="$HOME/.claude/projects"
SKF="skills/execute/SKILL.md"           # the skill file's path in the hook's line and a temp snapshot (never read here)
T0=2026-10-26T10:00:00Z                # every case's first lead-entry
LATER=2026-10-26T20:00:00Z             # the verb's --now where no room stop is read

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) ok y y "$3";; *) ok "$1" "*$2*" "$3";; esac; }

N() { printf '%s-rollout-2026-10-26' "$1"; }   # a dated rollout note's stem
mkro() {  # mkro <case> [frontmatter lines...]: a parallel rollout note in $V, named as schedule dates them
  local s; s=$(N "$1"); shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n## Queue\n\n'; } > "$V/$s.md"
}
ent() { local ro; ro=$(N "$1"); shift; python3 "$SCRIPT" record-entry --rollout "$V/$ro.md" "$@" >/dev/null; }
lead() { mkro "$1"; ent "$1" --by stage --session "s-$1" --now "$T0"; }   # case <c>: its rollout, led by s-<c>
pay() {  # pay <session> [more JSON members]: a compaction's SessionStart payload
  printf '{"hook_event_name":"SessionStart","source":"compact","session_id":"%s","transcript_path":"/x/%s.jsonl"%s}' "$1" "$1" "${2:-}"
}
hook() { printf '%s' "$1" | python3 "$HOOK" 2>"$TMP/hook.err"; }
cfile() { printf '%s/%s/%s.json' "$CD" "$(N "$1")" "${2:-s-$1}"; }
plant() { local f; f=$(cfile "$1" "${3:-s-$1}"); mkdir -p "$(dirname "$f")"; printf '%s\n' "$2" > "$f"; }
sum() { local f; f=$(cfile "$@"); if [ -e "$f" ]; then cksum < "$f"; else echo "<none>"; fi; }
cf() {  # cf <case> <python expr over d, the count file>: its JSON, or <none>
  python3 - "$(cfile "$1")" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except FileNotFoundError:
    print("<none>"); sys.exit(0)
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY
}
q() {  # q <JSON> <python expr over d>
  python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))' "$1" "$2"
}
ctx() { python3 -c 'import json, sys; print(json.loads(sys.argv[1])["hookSpecificOutput"]["additionalContext"])' "$1"; }   # the line(s), as text
sig() {  # sig <hook stdout> <case> [root]: the output's exact shape and the line's form, as one token
  python3 - "$1" "$(N "$2")" "${3:-$PLUGIN}/$SKF" <<'PY'
import json, sys
out, slug, skill = sys.argv[1:4]
try:
    d = json.loads(out)
except ValueError:
    print("no JSON: %r" % out[:60]); sys.exit(0)
h = d.get("hookSpecificOutput") or {}
shape = sorted(d) == ["hookSpecificOutput"] and sorted(h) == ["additionalContext", "hookEventName"]
lines = [l for l in h.get("additionalContext", "").split("\n") if l.startswith("ROLLOUT-COMPACTION %s: " % slug)]
if len(lines) != 1:
    print("%d lines for %s" % (len(lines), slug)); sys.exit(0)
line = lines[0]
now, stop = "Before the next launch" in line, "start nothing now" in line
forms = {"The rollout is paused: start": "paused", "A room stop stands: start": "room", "The rollout is halted: start": "halted"}
form = "now" if now and not stop else next((v for k, v in forms.items() if k in line and stop and not now), "?")
n = line.split(": compaction ", 1)[1].split(" ", 1)[0]
marks = [skill + " as a file" in line, "§ 1" in line, "--gated run stays gated" in line,
         "/thread:execute [[%s]]" % slug in line, "(the count was not saved: " in line]
print("%s|%s|%s|%s|%s" % (h.get("hookEventName") if shape else "bad shape", form, n,
                          "".join("1" if m else "0" for m in marks[:4]), "unsaved" if marks[4] else "saved"))
PY
}
mark() { printf '{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","timestamp":"%s","sessionId":"%s"}' "$1" "$2"; }
tx() {  # tx <case> <line>...: the session's transcript, where the verb finds it
  local s="s-$1"; shift; mkdir -p "$PJ/p"; printf '%s\n' "$@" > "$PJ/p/$s.jsonl"
}
cv() { local c=$1; shift; python3 "$SCRIPT" compactions --rollout "$V/$(N "$c").md" --session "s-$c" "$@" 2>"$TMP/cv.err"; }
warns() { grep -c '^WARN: compactions:' "$TMP/cv.err"; }
roomline() {  # roomline <case> <line>: a planted `## Pause log` line
  printf '\n## Pause log\n\n%s\n' "$2" >> "$V/$(N "$1").md"
}
ago() { python3 -c 'import sys; from datetime import datetime, timedelta, timezone as z; print((datetime.now(z.utc) - timedelta(hours=float(sys.argv[1]))).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"; }
begin() { printf '%s\n' "Login at its week's line; stopping at a step boundary: none; lane: none" | python3 "$SB" begin --rollout "$V/$(N "$1").md" >/dev/null; }
halt() {  # halt <case>: the Stop hook records an open halt
  printf '{"session_id":"x","last_assistant_message":"ROLLOUT-STATUS: %s merged=0/2 running=0 state=halted reason=\\"stuck\\""}' "$(N "$1")" | python3 "$DRIVER" >/dev/null
}
capfresh() { mkdir -p "$HOME/.config/thread"; printf '{"capacity": 4, "written_at": "%s"}\n' "$(ago 0)" > "$HOME/.config/thread/capacity.json"; }

echo "== H1. one compaction adds one, and the line orders the re-entry"
lead h1; R=$(N h1)
out=$(hook "$(pay s-h1)"); rc=$?
ok "$rc|$(cat "$TMP/hook.err")" "0|" "H1: exit 0, nothing on stderr"
ok "$(cf h1 '[d["version"], d["rollout"], d["session"], d["count"], d["corrected"], d["told"], d["by"], d["at"][-1]]')" \
  "[1,\"$R\",\"s-h1\",1,0,1,\"hook\",\"Z\"]" "H1: the count file: version 1, count 1, told 1, by hook"
ok "$(sig "$out" h1)" "SessionStart|now|1|1111|saved" "H1: only hookSpecificOutput {hookEventName: SessionStart, additionalContext}; the no-stop form with the root, § 1 and the --gated rule"
ok "$(q "$out" 'd["hookSpecificOutput"]["additionalContext"].count("\n")')" 0 "H1: one line"
has "$(ctx "$out")" "ROLLOUT-COMPACTION $R: compaction 1 of this lead session, counted on disk (ADR 0085). The skill text was cut from context. Before the next launch, re-enter /thread:execute [[$R]] at § 1 from the engine root: read $PLUGIN/$SKF as a file and follow it from § 1, with $PLUGIN for \${CLAUDE_PLUGIN_ROOT} in every command." "H1: the line's opening, word for word"
out=$(hook "$(pay s-h1)")
ok "$(sig "$out" h1)|$(cf h1 '[d["count"], d["told"]]')" "SessionStart|now|2|1111|saved|[2,2]" "H1: a second compaction: count 2, told 2"

echo "== H2. a non-lead session writes nothing and prints nothing"
before=$(sum h1)
out=$(hook "$(pay s-other)"); rc=$?
ok "$rc|$out|$(cat "$TMP/hook.err")|$(sum h1 s-other)|$(sum h1)" "0|||<none>|$before" "H2: another session: silent, no file, the lead's bytes unchanged"
ent h1 --by stage --session s-h1-next --now 2026-10-26T12:00:00Z
out=$(hook "$(pay s-h1)"); rc=$?
ok "$rc|$out|$(cat "$TMP/hook.err")|$(sum h1)" "0|||$before" "H2: a later lead-entry of another session makes it a non-lead: silent, bytes unchanged"

echo "== H3. a broken Run record, or a broken payload, exits 0 with nothing printed and nothing written"
lead h3; R=$(N h3)
quiet() {  # quiet <label> <payload>
  out=$(hook "$2"); rc=$?
  ok "$rc|$out|$(cat "$TMP/hook.err")|$(sum h3)" "0|||<none>" "H3: $1"
}
cp "$EV/$R.jsonl" "$TMP/h3.record"
printf '\377\376 not a record\n' > "$EV/$R.jsonl"; quiet "garbage bytes" "$(pay s-h3)"
rm -f "$EV/$R.jsonl"; mkdir "$EV/$R.jsonl"; quiet "a directory in the record's place" "$(pay s-h3)"
rmdir "$EV/$R.jsonl"; cp "$TMP/h3.record" "$EV/$R.jsonl"
: > "$TMP/a-file"; THREAD_EVENTS_DIR="$TMP/a-file" quiet "an events dir that is a file" "$(pay s-h3)"
quiet "a payload that is not JSON" "not json"
quiet "a payload with no session_id" '{"hook_event_name":"SessionStart","source":"compact"}'

echo "== H3b. one broken note never turns the hook off: each note is read under its own try"
lead h3b
printf -- '---\n\377\376\n---\n' > "$V/$(N a0).md"      # not UTF-8, sorted before the lead's note
mkdir "$V/$(N a1).md"                                   # a directory named like a rollout note, before it too
printf -- '---\n\377\376\n---\n' > "$V/$(N z9).md"      # not UTF-8, sorted after it
mkro h3c; ent h3c --by stage --session s-h3b --now "$T0"; printf '\377 garbage\n' > "$EV/$(N h3c).jsonl"   # a valid note, its record broken
mkro h3d; ent h3d --by stage --session s-h3b --now "$T0"   # a second rollout the same session leads
out=$(hook "$(pay s-h3b)"); rc=$?
ok "$rc|$(sig "$out" h3b)|$(cf h3b 'd["count"]')" "0|SessionStart|now|1|1111|saved|1" "H3b: the lead is still counted and told"
ok "$(sig "$out" h3d)|$(q "$out" 'd["hookSpecificOutput"]["additionalContext"].count("\n")')|$(sum h3c s-h3b)" "SessionStart|now|1|1111|saved|1|<none>" "H3b: a session leading two rollouts gets one line each; the broken record's rollout none"
rm -f "$V/$(N a0).md" "$V/$(N z9).md"; rmdir "$V/$(N a1).md"

echo "== H4. not the lead's compaction: another source, a subagent's, an agent transcript"
lead h4
for src in startup resume clear fork; do
  out=$(printf '{"hook_event_name":"SessionStart","source":"%s","session_id":"s-h4","transcript_path":"/x/s-h4.jsonl"}' "$src" | python3 "$HOOK" 2>&1)
  ok "$?|$out|$(sum h4)" "0||<none>" "H4: source $src: nothing"
done
out=$(hook "$(pay s-h4 ',"agent_id":"agent-7","agent_type":"Explore"')")
ok "$out|$(sum h4)" "|<none>" "H4: a non-empty agent_id: nothing"
out=$(printf '{"hook_event_name":"SessionStart","source":"compact","session_id":"s-h4","transcript_path":"/x/agent-x.jsonl"}' | python3 "$HOOK" 2>&1)
ok "$out|$(sum h4)" "|<none>" "H4: a transcript named agent-x.jsonl: nothing"
out=$(printf '{"hook_event_name":"PostCompact","source":"compact","session_id":"s-h4"}' | python3 "$HOOK" 2>&1)
ok "$out|$(sum h4)" "|<none>" "H4: another event: nothing"
out=$(hook "$(pay s-h4 ',"agent_type":"lead","agent_id":""')")
ok "$(sig "$out" h4)|$(cf h4 'd["count"]')" "SessionStart|now|1|1111|saved|1" "H4: agent_type with no agent_id (a lead started with --agent) is counted"

echo "== H5. a serial, a superseded and a done note whose record names the session: nothing"
for c in h5a h5b h5c; do lead "$c"; done
mkro h5a "shape: serial"; mkro h5b 'superseded_by: "[[x]]"'
sed -i.bak 's/^status: open/status: done/' "$V/$(N h5c).md"; rm -f "$V/$(N h5c).md.bak"
for c in h5a h5b h5c; do
  out=$(hook "$(pay "s-$c")"); ok "$?|$out|$(sum "$c")" "0||<none>" "H5: $c: silent, no file"
done

echo "== H6. the stops: his pause, a standing room stop and an open halt defer the order; the engine's own do not"
# row <case> <want form> <want count,told>: the hook on the state the case built
row() {
  out=$(hook "$(pay "s-$1")")
  ok "$(sig "$out" "$1")|$(cf "$1" '[d["count"], d["told"]]')" "SessionStart|$2|1|1111|saved|$3" "H6 $1: $4"
}
mkro h6a "paused: 2026-10-26T10:30+00:00"; ent h6a --by stage --session s-h6a --now "$T0"
row h6a paused '[1,0]' "a paused: stamp: the paused form, counted, told unchanged"
mkro h6b "paused: 2026-10-26T10:30+00:00"; ent h6b --by stage --session s-h6b --now "$T0"
python3 "$SCRIPT" record-pause --rollout "$V/$(N h6b).md" --tasks-dir "$V" >/dev/null; mkro h6b
row h6b paused '[1,0]' "an open paused record line with the stamp removed: the paused form"
mkro h6c "pause_requested: true"; ent h6c --by stage --session s-h6c --now "$T0"
row h6c now '[1,1]' "a soft pause's drain is no stop: the order is now"
mkro h6d "paused: 2026-10-26T10:30+00:00" "paused_for: catch-up"; ent h6d --by stage --session s-h6d --now "$T0"
row h6d now '[1,1]' "an Engine catch-up's pause is no stop"
lead h6e; begin h6e
row h6e room '[1,0]' "a room stop begun now: the room-stop form"
lead h6f; roomline h6f "- 2026-10-01T00:00+00:00 room stop: Login at its week's line"
row h6f now '[1,1]' "a start line older than the bound, not held: no stop"
lead h6f2; begin h6f2; python3 "$SB" end --rollout "$V/$(N h6f2).md" >/dev/null
row h6f2 now '[1,1]' "a room stop ended: no stop"
lead h6g; roomline h6g "- $(ago 7) room stop: held by the Stage: Login at its week's line"; capfresh
row h6g room '[1,0]' "a held start line 7 h old while the Stage lives (a fresh capacity.json): the room-stop form"
rm -f "$HOME/.config/thread/capacity.json"
lead h6g2; roomline h6g2 "- $(ago 7) room stop: held by the Stage: Login at its week's line"
row h6g2 now '[1,1]' "the same with no capacity file: lapsed, no stop"
lead h6h; halt h6h
row h6h halted '[1,0]' "an open halt: the halted form"
ent h6h --by lachy --session s-h6h
out=$(hook "$(pay s-h6h)")
ok "$(sig "$out" h6h)|$(cf h6h '[d["count"], d["told"]]')" "SessionStart|now|2|1111|saved|[2,2]" "H6 h6h: a later record-entry closed the halt: the order is now, and told catches up"
mkro h6p "paused: 2026-10-26T10:30+00:00"; ent h6p --by stage --session s-h6p --now "$T0"; begin h6p
row h6p paused '[1,0]' "a pause over a standing room stop reads the paused form"
line=$(ctx "$(hook "$(pay s-h6e)")")
has "$line" "A room stop stands: start nothing now. Whoever opens the entry that ends this stop (the Stage's resume, the heartbeat's lapse re-entry, or his own /thread:execute [[$(N h6e)]]), read $PLUGIN/$SKF as a file first, with $PLUGIN for \${CLAUDE_PLUGIN_ROOT} in every command, and take that entry from § 1 of that text under that entry's own rules" "H6: the room-stop form, word for word"

echo "== H7. the root the line names: the note's engine_snapshot, read as the guard reads it"
mkdir -p "$HOME/snaps/abc/skills/execute"; : > "$HOME/snaps/abc/$SKF"
lead h7a; mkro h7a 'engine_snapshot: "~/snaps/abc"'
ok "$(sig "$(hook "$(pay s-h7a)")" h7a "$HOME/snaps/abc")" "SessionStart|now|1|1111|saved" "H7: a quoted ~/-form stamp names the snapshot's skill file"
lead h7b; mkro h7b "engine_snapshot: ~/snaps/abc # the cut of 26 Oct" "paused: 2026-10-26T10:30+00:00"
ok "$(sig "$(hook "$(pay s-h7b)")" h7b "$HOME/snaps/abc")" "SessionStart|paused|1|1111|saved" "H7: a bare stamp with a trailing comment, under a stop: the same root"
lead h7c; mkro h7c 'engine_snapshot: "~/snaps/gone"'
ok "$(sig "$(hook "$(pay s-h7c)")" h7c)" "SessionStart|now|1|1111|saved" "H7: a stamp whose directory is gone names the hook's own root"

echo "== H8. a count that cannot be written: the line is still printed, with its tail"
lead h8; mkdir -p "$CD"; : > "$CD/$(N h8)"
out=$(hook "$(pay s-h8)"); rc=$?
ok "$rc|$(sig "$out" h8)|$(cat "$TMP/hook.err")" "0|SessionStart|now|1|1111|unsaved|" "H8: exit 0, the line with its not-saved tail, nothing on stderr"

echo "== H9. wiring and floor"
ok "$(python3 - "$PLUGIN/hooks/hooks.json" <<'PY'
import json, sys
e = json.load(open(sys.argv[1]))["hooks"]["SessionStart"]
h = e[0]["hooks"]
print(json.dumps([h[0]["type"], h[0]["timeout"] <= 10, "onFailure" in h[0]]))
PY
)" '["command", true, false]' "H9: the SessionStart hook is a command with a timeout of 10 s or less and no onFailure (engine-snapshot.test.mjs pins its matcher and command)"
ok "$(python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9)); print("ok")' "$HOOK" 2>&1)" ok "H9: the hook parses as python 3.9"
pyc() { [ -d "$PLUGIN/hooks/__pycache__" ] && printf h; [ -d "$HERE/../scripts/__pycache__" ] && printf s; echo; }
was=$(pyc)
out=$(printf '%s' "$(pay s-h1-next)" | env -u PYTHONDONTWRITEBYTECODE python3 "$HOOK" 2>&1)
ok "$(sig "$out" h1)|$(pyc)" "SessionStart|now|1|1111|saved|$was" "H9: a run with PYTHONDONTWRITEBYTECODE unset counts, and writes no bytecode beside the hook or the engine"

echo "== H10. a key this engine does not know survives both writers"
lead h10; plant h10 '{"version": 1, "rollout": "x", "session": "s-h10", "count": 1, "corrected": 0, "told": 1, "at": "2026-10-26T10:30:00Z", "by": "hook", "later": 1}'
hook "$(pay s-h10)" >/dev/null
ok "$(cf h10 '[d["count"], d["later"], d["rollout"]]')" "[2,1,\"$(N h10)\"]" "H10: the hook keeps it"
tx h10 "$(mark 2026-10-26T11:00:00Z s-h10)" "$(mark 2026-10-26T12:00:00Z s-h10)" "$(mark 2026-10-26T13:00:00Z s-h10)"
cv h10 --now "$LATER" >/dev/null
ok "$(cf h10 '[d["count"], d["later"], d["by"]]')" '[3,1,"heartbeat"]' "H10: the verb keeps it"

echo "== B1. the raise: marks above the count raise it and order the re-entry, once"
lead b1; plant b1 '{"version": 1, "rollout": "b1", "session": "s-b1", "count": 1, "corrected": 0, "told": 1, "at": "2026-10-26T10:30:00Z", "by": "hook"}'
tx b1 "$(mark 2026-10-26T11:00:00Z s-b1)" "$(mark 2026-10-26T12:00:00Z s-b1)"
J=$(cv b1 --now "$LATER"); rc=$?
ok "$rc|$(q "$J" '[d["rollout"], d["session"], d["lead"], d["count"], d["was"], d["told"], d["owed"], d["marks"], d["outside"], d["undated"], d["corrected"], d["stop"], d["reenter"], d["written"]]')|$(warns)" \
  "0|[\"$(N b1)\",\"s-b1\",true,2,1,2,1,2,0,0,1,null,true,true]|0" "B1: count 2, was 1, corrected 1, owed 1, reenter true, told 2"
ok "$(q "$J" 'list(d)')|$(q "$J" 'd["transcript"]')" '["rollout","session","lead","count","was","told","owed","transcript","marks","outside","undated","corrected","stop","reenter","written"]|"'"$PJ/p/s-b1.jsonl"'"' "B1: the JSON's keys, and the transcript it read"
ok "$(cf b1 '[d["count"], d["corrected"], d["told"], d["by"]]')" '[2,1,2,"heartbeat"]' "B1: the file, by heartbeat"
before=$(sum b1); J=$(cv b1 --now "$LATER")
ok "$(q "$J" '[d["count"], d["was"], d["owed"], d["reenter"], d["written"]]')|$(sum b1)" "[2,2,0,false,false]|$before" "B1: a second run: owed 0, reenter false, bytes unchanged"

echo "== B3. no file: one mark writes count 1 and orders; no mark writes no file"
lead b3; tx b3 "$(mark 2026-10-26T11:00:00Z s-b3)"
J=$(cv b3 --now "$LATER")
ok "$(q "$J" '[d["count"], d["was"], d["reenter"], d["written"]]')|$(cf b3 '[d["count"], d["told"], d["corrected"]]')" "[1,0,true,true]|[1,1,1]" "B3: no file and one mark: count 1, told 1, reenter true"
lead b3n; tx b3n '{"type":"user","message":{"content":"hello"},"timestamp":"2026-10-26T11:00:00Z"}'
J=$(cv b3n --now "$LATER")
ok "$(q "$J" '[d["count"], d["marks"], d["reenter"], d["written"]]')|$(sum b3n)" "[0,0,false,false]|<none>" "B3: no file and no mark: no file"

echo "== B6. decoys do not count"
lead b6
{ printf '%s\n' '{"type":"system","subtype":"microcompact_boundary","timestamp":"2026-10-26T11:00:00Z","sessionId":"s-b6"}'
  printf '%s\n' '{"type":"user","message":{"content":"{\"type\":\"system\",\"subtype\":\"compact_boundary\"}"},"subtype":"x","timestamp":"2026-10-26T11:01:00Z"}'
  printf '%s\n' '{"type":"assistant","subtype":"compact_boundary","message":{"content":"compact_boundary"},"timestamp":"2026-10-26T11:02:00Z"}'
  printf '%s\n' '{"type":"system","subtype":"compact_boundary","isSidechain":true,"timestamp":"2026-10-26T11:03:00Z","sessionId":"s-b6"}'
  printf '%s' '{"type":"system","subtype":"compact_boundary","timestamp":"2026-10-26T11:04'; } > "$TMP/b6.jsonl"
J=$(cv b6 --transcript "$TMP/b6.jsonl" --now "$LATER")
ok "$(q "$J" '[d["marks"], d["outside"], d["undated"], d["reenter"], d["transcript"]]')|$(sum b6)|$(warns)" "[0,0,0,false,\"$TMP/b6.jsonl\"]|<none>|0" "B6: a microcompact line, quoted text, a sidechain line and a torn last line: no mark"

echo "== B7. the transcript: none, or two matches, corrects nothing; --transcript wins"
lead b7
J=$(cv b7 --now "$LATER"); ok "$(q "$J" '[d["transcript"], d["marks"], d["reenter"]]')" '[null,0,false]' "B7: no transcript"
mkdir -p "$PJ/p" "$PJ/q"; mark 2026-10-26T11:00:00Z s-b7 > "$PJ/p/s-b7.jsonl"; cp "$PJ/p/s-b7.jsonl" "$PJ/q/s-b7.jsonl"
J=$(cv b7 --now "$LATER"); ok "$(q "$J" '[d["transcript"], d["marks"], d["reenter"]]')|$(sum b7)" '[null,0,false]|<none>' "B7: two matching transcripts: none read"
J=$(cv b7 --transcript "$PJ/q/s-b7.jsonl" --now "$LATER"); ok "$(q "$J" '[d["transcript"], d["marks"], d["reenter"]]')" "[\"$PJ/q/s-b7.jsonl\",1,true]" "B7: --transcript wins"

echo "== B8. not the lead: nothing written"
lead b8; tx b8 "$(mark 2026-10-26T11:00:00Z s-b8)"; ent b8 --by stage --session s-b8-next --now 2026-10-26T12:00:00Z
J=$(cv b8 --now "$LATER"); ok "$(q "$J" '[d["lead"], d["reenter"], d["written"], d["marks"]]')|$(sum b8)" "[false,false,false,0]|<none>" "B8: a session that is not the latest lead-entry's"
J=$(python3 "$SCRIPT" compactions --rollout "$V/$(N b8).md" --now "$LATER"); ok "$?|$(q "$J" '[d["session"], d["lead"], d["written"]]')" "0|[null,false,false]" "B8: no session"

echo "== B9. --dry-run writes nothing"
lead b9; tx b9 "$(mark 2026-10-26T11:00:00Z s-b9)"
J=$(cv b9 --now "$LATER" --dry-run); ok "$(q "$J" '[d["count"], d["told"], d["reenter"], d["written"]]')|$(sum b9)" "[1,1,true,false]|<none>" "B9: the reading, no file"

echo "== B10. skips, usage and the guard"
lead b10; mkro b10 "shape: serial"
ok "$(cv b10 --now "$LATER"; echo "rc=$?")" "[skip] $(N b10): shape: serial (a serial rollout runs as Legs): no compaction counted
rc=0" "B10: a serial note prints [skip]"
lead b10d; sed -i.bak 's/^status: open/status: done/' "$V/$(N b10d).md"; rm -f "$V/$(N b10d).md.bak"
has "$(cv b10d --now "$LATER")" "[skip] $(N b10d): status: done" "B10: a done note prints [skip]"
ok "$(python3 "$SCRIPT" compactions >/dev/null 2>&1; echo $?)" 2 "B10: no --rollout is a usage error"
ok "$(python3 "$SCRIPT" compactions --rollout "$V/nope.md" 2>&1; echo "rc=$?")" "ERROR: compactions: rollout note not found at $V/nope.md
rc=1" "B10: a missing note: exit 1, an ERROR line"
lead b10g; tx b10g "$(mark 2026-10-26T11:00:00Z s-b10g)"
mkro b10g 'engine_snapshot: "/nonexistent/plug-snapshots/000000000000"' "engine_sha: $(printf '0%.0s' $(seq 40))"
out=$(python3 "$SCRIPT" compactions --rollout "$V/$(N b10g).md" --session s-b10g --now "$LATER" 2>&1); rc=$?
ok "$rc|$(sum b10g)" "2|<none>" "B10: a note stamped with another snapshot is refused by the guard, nothing written"
has "$out" "engine-snapshot: " "B10: the guard's line"

echo "== B11. a mark before the first lead-entry is in no span"
lead b11; tx b11 "$(mark 2026-10-26T05:00:00Z s-b11)"
J=$(cv b11 --now "$LATER"); ok "$(q "$J" '[d["marks"], d["outside"], d["reenter"], d["written"]]')|$(sum b11)|$(warns)" "[0,1,false,false]|<none>|0" "B11: no file, marks 0, outside 1, nothing ordered"
plant b11 '{"version": 1, "rollout": "b11", "session": "s-b11", "count": 1, "corrected": 0, "told": 1, "at": "2026-10-26T10:30:00Z", "by": "hook"}'
tx b11 "$(mark 2026-10-26T05:00:00Z s-b11)" "$(mark 2026-10-26T11:00:00Z s-b11)"; before=$(sum b11)
J=$(cv b11 --now "$LATER"); ok "$(q "$J" '[d["marks"], d["outside"], d["count"], d["reenter"]]')|$(sum b11)" "[1,1,1,false]|$before" "B11: with the hook's count 1 and one mark inside: bytes unchanged"

echo "== B12. a mark while another session led, or naming another session, is outside"
mkro b12; ent b12 --by stage --session s-b12 --now 2026-10-26T10:00:00Z
ent b12 --by stage --session s-b12-other --now 2026-10-26T12:00:00Z; ent b12 --by stage --session s-b12 --now 2026-10-26T14:00:00Z
tx b12 "$(mark 2026-10-26T11:00:00Z s-b12)" "$(mark 2026-10-26T13:00:00Z s-b12)" "$(mark 2026-10-26T15:00:00Z s-b12)" "$(mark 2026-10-26T15:30:00Z s-parent)"
J=$(cv b12 --now "$LATER"); ok "$(q "$J" '[d["marks"], d["outside"], d["undated"], d["count"]]')" "[2,2,0,2]" "B12: two marks in the session's own spans; the other lead's time and the other session's mark outside"

echo "== B13. an undated mark is never counted, and is reported once"
lead b13
tx b13 '{"type":"system","subtype":"compact_boundary","sessionId":"s-b13"}' "$(mark soon s-b13)" "$(mark 2026-10-26T11:00:00 s-b13)" "$(mark 2026-10-26T11:30:00Z s-b13)"
J=$(cv b13 --now "$LATER"); rc=$?
ok "$rc|$(q "$J" '[d["marks"], d["undated"], d["outside"], d["count"]]')|$(warns)" "0|[1,3,0,1]|1" "B13: marks 1, undated 3 (none, unparseable, naive), one WARN line, exit 0"
has "$(cat "$TMP/cv.err")" "WARN: compactions: $(N b13): 3 compaction mark(s) of s-b13 with no usable timestamp: never counted" "B13: the WARN names them"

echo "== B14. a stop keeps the order owed; the entry that ends it takes it, else the first tick after it gives it"
P0='{"version": 1, "rollout": "x", "session": "x", "count": 1, "corrected": 0, "told": 0, "at": "2026-10-26T10:30:00Z", "by": "hook"}'   # the hook's deferral: its stop line was printed at 10:30
P1='{"version": 1, "rollout": "x", "session": "x", "count": 1, "corrected": 0, "told": 1, "at": "2026-10-26T10:30:00Z", "by": "hook"}'   # nothing owed yet: the verb's raise makes the deferral
# owedrow <case> <stop> <who deferred: hook | verb> <command that ends the stop> <want reenter> <what the row shows>
# The entries are written at the wall clock, after P0's `at`, but for the one row that dates its own.
owedrow() {
  local n=1 by=hook wrote=false
  if [ "$3" = hook ]; then plant "$1" "$P0"; tx "$1" "$(mark 2026-10-26T10:30:00Z "s-$1")"
  else n=2 by=heartbeat wrote=true; plant "$1" "$P1"; tx "$1" "$(mark 2026-10-26T11:00:00Z "s-$1")" "$(mark 2026-10-26T12:00:00Z "s-$1")"; fi
  J=$(cv "$1")
  ok "$(q "$J" '[d["count"], d["told"], d["owed"], d["reenter"], d["stop"], d["written"]]')|$(cf "$1" '[d["count"], d["told"], d["by"]]')" "[$n,$((n - 1)),1,false,\"$2\",$wrote]|[$n,$((n - 1)),\"$by\"]" "B14 $1: under the $2: owed 1 (an integer), reenter false, told kept"
  eval "$4" >/dev/null
  J=$(cv "$1")
  ok "$(q "$J" '[d["count"], d["told"], d["owed"], d["reenter"], d["stop"], d["written"]]')|$(cf "$1" '[d["told"], d["by"]]')" "[$n,$n,1,$5,null,true]|[$n,\"heartbeat\"]" "B14 $1: $6"
  before=$(sum "$1"); J=$(cv "$1")
  ok "$(q "$J" '[d["owed"], d["reenter"], d["written"]]')|$(sum "$1")" "[0,false,false]|$before" "B14 $1: the next tick: owed 0, bytes unchanged"
}
mkro b14a "paused: 2026-10-26T10:30+00:00"; ent b14a --by stage --session s-b14a --now "$T0"
owedrow b14a pause hook 'ent b14a --by lachy --session s-b14a; python3 "$SCRIPT" clear-pause --rollout "$V/$(N b14a).md" --tasks-dir "$V"' false \
  "his Reinstate's entry took the hook's order: told 1 written, reenter false, no second read"
lead b14e; begin b14e
owedrow b14e room-stop hook 'ent b14e --by stage --session s-b14e; python3 "$SB" end --rollout "$V/$(N b14e).md"' false \
  "the Stage's resume took it: reenter false"
lead b14h; halt b14h
owedrow b14h halt hook 'ent b14h --by lachy --session s-b14h' false "his own /thread:execute closed the halt and took it: reenter false"
lead b14t; halt b14t
owedrow b14t halt hook 'ent b14t --by heartbeat --session s-b14t' true \
  "a halt clause (1) cannot see: (2b)'s own entry closes it, a heartbeat entry takes nothing, and that same tick orders"
mkro b14s "paused: 2026-10-26T10:30+00:00"; ent b14s --by stage --session s-b14s --now "$T0"
owedrow b14s pause hook 'ent b14s --by lachy --session s-b14s --now 2026-10-26T10:30:00.900Z; python3 "$SCRIPT" clear-pause --rollout "$V/$(N b14s).md" --tasks-dir "$V"' true \
  "an entry in the hook's own second is not after it: still ordered"
mkro b14v "paused: 2026-10-26T10:30+00:00"; ent b14v --by stage --session s-b14v --now "$T0"
owedrow b14v pause verb 'ent b14v --by lachy --session s-b14v; python3 "$SCRIPT" clear-pause --rollout "$V/$(N b14v).md" --tasks-dir "$V"' true \
  "the verb's own deferral printed no line, so his Reinstate's entry takes nothing: ordered, corrected 1"
ok "$(cf b14v 'd["corrected"]')" 1 "B14 b14v: corrected still 1"
mkro b14c "pause_requested: true"; ent b14c --by stage --session s-b14c --now "$T0"
plant b14c "$P1"; tx b14c "$(mark 2026-10-26T11:00:00Z s-b14c)" "$(mark 2026-10-26T12:00:00Z s-b14c)"
J=$(cv b14c --now "$LATER"); ok "$(q "$J" '[d["reenter"], d["stop"], d["told"]]')" "[true,null,2]" "B14: a soft pause's drain: reenter true at once"
mkro b14n "paused: 2026-10-26T10:30+00:00"; ent b14n --by stage --session s-b14n --now "$T0"
plant b14n '{"version": 1, "count": 3, "told": 1}'
J=$(cv b14n --now "$LATER"); ok "$(q "$J" '[d["owed"], d["reenter"], d["stop"], d["written"]]')" '[2,false,"pause",false]' "B14: count 3, told 1 under a pause: owed 2, nothing to write"

echo "== B15. the hook's deferral no entry followed (the lead's own is dated before it) is ordered at the first tick, with or without a transcript"
for c in b15a b15b; do
  lead "$c"; begin "$c"; hook "$(pay "s-$c")" >/dev/null; python3 "$SB" end --rollout "$V/$(N "$c").md" >/dev/null
done
tx b15a "$(mark 2026-10-26T11:00:00Z s-b15a)"; left=$(cf b15a '[d["count"], d["told"]]')
J=$(cv b15a); ok "$left|$(q "$J" '[d["marks"], d["owed"], d["reenter"], d["told"], d["was"]]')|$(cf b15a 'd["told"]')" "[1,0]|[1,1,true,1,1]|1" "B15: the hook left count 1, told 0; the tick orders it: marks 1, owed 1, reenter true, told 1"
J=$(cv b15b); ok "$(q "$J" '[d["transcript"], d["owed"], d["reenter"], d["told"]]')" "[null,1,true,1]" "B15: with no transcript at all: still reenter true"

echo "== B16. the over-count WARN: a count above the marks is left as it is, and said"
lead b16; plant b16 '{"version": 1, "rollout": "x", "session": "x", "count": 3, "corrected": 0, "told": 3, "at": "2026-10-26T10:30:00Z", "by": "hook"}'
tx b16 "$(mark 2026-10-26T11:00:00Z s-b16)" "$(mark 2026-10-26T12:00:00Z s-b16)"; before=$(sum b16)
J=$(cv b16 --now "$LATER"); rc=$?
ok "$rc|$(q "$J" '[d["count"], d["marks"], d["reenter"], d["written"]]')|$(sum b16)|$(warns)" "0|[3,2,false,false]|$before|1" "B16: never lowered, bytes unchanged, one WARN line"
has "$(cat "$TMP/cv.err")" "WARN: compactions: $(N b16): the count on disk (3) is above the 2 compaction mark(s)" "B16: the WARN names 3 and 2"
tx b16 "$(mark 2026-10-26T11:00:00Z s-b16)" "$(mark 2026-10-26T12:00:00Z s-b16)" "$(mark later s-b16)"
cv b16 --now "$LATER" >/dev/null
ok "$(warns)|$(grep -c 'above the' "$TMP/cv.err")" "1|0" "B16: with an undated mark the over-count is not claimed (the undated WARN alone)"

echo "== B17. a held room stop past its bound is read through the Stage's reading, in the verb too"
lead b17; roomline b17 "- $(ago 7) room stop: held by the Stage: Login at its week's line"; capfresh
J=$(cv b17); rc=$?
ok "$rc|$(q "$J" '[d["stop"], d["reenter"]]')|$(grep -c Traceback "$TMP/cv.err")" '0|["room-stop",false]|0' "B17: exit 0, stop room-stop, no traceback"
rm -f "$HOME/.config/thread/capacity.json"

echo "== B18. an invalid told reads 0: one more order, then written properly"
lead b18
for told in '' ', "told": -1' ', "told": 5' ', "told": "2"' ', "told": true'; do
  plant b18 "{\"version\": 1, \"count\": 2$told}"
  J=$(cv b18 --now "$LATER"); ok "$(q "$J" '[d["owed"], d["reenter"], d["told"]]')|$(cf b18 '[d["count"], d["told"]]')" "[2,true,2]|[2,2]" "B18: {count 2$told}"
done

echo "== B19. a file of another version is never overwritten and orders nothing"
lead b19; plant b19 '{"version": 2, "count": 7, "shape": "newer"}'; before=$(sum b19)
tx b19 "$(mark 2026-10-26T11:00:00Z s-b19)" "$(mark 2026-10-26T12:00:00Z s-b19)"
J=$(cv b19 --now "$LATER"); rc=$?
ok "$rc|$(q "$J" '[d["reenter"], d["written"], d["marks"]]')|$(sum b19)|$(warns)" "0|[false,false,2]|$before|1" "B19: reenter false, written false, one WARN, bytes unchanged"
out=$(hook "$(pay s-b19)")
ok "$(sig "$out" b19)|$(sum b19)" "SessionStart|now|?|1111|unsaved|$before" "B19: the hook prints the line with ? and the not-saved tail, and writes nothing"
plant b19 'not json at all'
J=$(cv b19 --now "$LATER"); ok "$(q "$J" '[d["count"], d["was"], d["reenter"], d["written"]]')|$(cf b19 '[d["version"], d["count"], d["told"]]')|$(warns)" "[2,0,true,true]|[1,2,2]|1" "B19: garbage is replaced as if no file, with one WARN"

echo "== N1-N4. next reports the count, right after startCleared"
nxt() { python3 "$SCRIPT" next --rollout "$V/$(N "$1").md" --tasks-dir "$V" --running "" --dry-run --now "$LATER" 2>"$TMP/nx.err"; }
lead n1; plant n1 '{"version": 1, "count": 2, "told": 2}'
J=$(CLAUDE_CODE_SESSION_ID=s-n1 nxt n1); rc=$?
ok "$rc|$(q "$J" 'd["compactions"]')|$(cat "$TMP/nx.err")" '0|{"session":"s-n1","count":2,"file":"ok"}|' "N1: the count of the caller's session"
ok "$(q "$J" 'list(d)[list(d).index("startCleared") + 1]')" '"compactions"' "N4: the key sits right after startCleared"
J=$(CLAUDE_CODE_SESSION_ID=s-none nxt n1); ok "$(q "$J" 'd["compactions"]')" '{"session":"s-none","count":0,"file":"none"}' "N2: no file reads count 0, file none"
J=$(nxt n1); ok "$(q "$J" 'd["compactions"]')" '{"session":null,"count":0,"file":"none"}' "N2: no session reads session null"
for bad in 'garbage' '{"version": 2, "count": 9}'; do
  plant n1 "$bad"
  J=$(CLAUDE_CODE_SESSION_ID=s-n1 nxt n1); rc=$?
  ok "$rc|$(q "$J" 'd["compactions"]')|$(grep -c '^WARN: compactions:' "$TMP/nx.err")" '0|{"session":"s-n1","count":0,"file":"unreadable"}|1' "N3: $bad: count 0, file unreadable, one WARN, exit 0"
done

[ "$fail" -eq 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
