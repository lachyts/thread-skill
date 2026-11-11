#!/usr/bin/env bash
# hooks/vault-note-overlap.py — the PreToolUse hook on Edit, Write and MultiEdit that records which live run's task
# wrote each vault note, lets another run's edit through with a warning naming the run in the note, and writes each
# warned overlap to the Run record's overlaps.jsonl (ADR 0067 d6). The hook's docstring holds every rule; this pins
# them on a fixture vault, fixture transcripts in the harness's real shape (the preamble line, then the computed text
# indented by two spaces, tests/fixtures/note-overlap/harness-preamble.txt) and payloads built with json.dumps.
# Temp dirs only: HOME, the vault, the state dir and the Run record all live under one mktemp.
# Usage: bash tests/vault-note-overlap.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
root="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$root/hooks/vault-note-overlap.py"
PRE="$root/tests/fixtures/note-overlap/harness-preamble.txt"
T="$(mktemp -d)"
T="$(cd "$T" && pwd -P)"
trap 'chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home"
export THREAD_EVENTS_DIR="$T/events"   # the Run record stays in temp (tests/contracts/run-record-hermetic.test.mjs)
export THREAD_NOTE_OVERLAP_DIR="$T/state"
unset XDG_STATE_HOME THREAD_NOTE_OVERLAP_DEBUG
. "$root/tests/lib/assert.sh"

VAULT="$HOME/repos/obsidian"
TASKS="$VAULT/Work/Tasks"
PROJ="$T/projects"
DAY="Days/2026/2026-11/2026-W45/2026-11-03 Tue.md"
mkdir -p "$TASKS" "$PROJ" "$VAULT/Days/2026/2026-11/2026-W45" "$VAULT/.obsidian"
OV="$THREAD_EVENTS_DIR/overlaps.jsonl"

# The fixture builders and readers, one python file.
cat > "$T/h.py" <<'PY'
import json, os, sys
cmd = sys.argv[1]
if cmd == "transcript":
    # transcript <path> <session> <agent id> <preamble file or -> <shape: str | list | late> ; the computed text on stdin
    path, sid, aid, pre, shape = sys.argv[2:7]
    computed = sys.stdin.read().rstrip("\n")
    body = "\n".join("  " + l for l in computed.split("\n"))
    text = (open(pre, encoding="utf-8").read().rstrip("\n") + "\n" + body) if pre != "-" else body
    content = text
    if shape == "list":
        content = [{"type": "text", "text": "<system-reminder>\nthe harness's context\n</system-reminder>"},
                   {"type": "text", "text": text}]
    first = {"parentUuid": None, "isSidechain": True, "agentId": aid, "type": "user", "sessionId": sid,
             "message": {"role": "user", "content": content}}
    lines = [{"type": "summary", "summary": "an earlier line"}] if shape == "late" else []
    lines += [first, {"parentUuid": "x", "isSidechain": True, "agentId": aid, "type": "assistant",
                      "message": {"role": "assistant", "content": [{"type": "text", "text": "On it."}]}}]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for l in lines:
            f.write(json.dumps(l) + "\n")
elif cmd == "payload":
    # payload <session> <transcript_path> <agent id or -> <tool> <file_path> [<extra json object>]
    sid, tp, aid, tool, fp = sys.argv[2:7]
    extra = json.loads(sys.argv[7]) if len(sys.argv) > 7 else {}
    p = {"session_id": sid, "transcript_path": tp, "cwd": os.environ.get("CALL_CWD", "/tmp"), "permission_mode": "bypassPermissions",
         "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": {"file_path": fp}}
    if aid != "-":
        p["agent_id"] = aid
        p["agent_type"] = "workflow-subagent"
    p.update(extra)
    for k, v in list(p.items()):
        if v is None:
            del p[k]
    print(json.dumps(p))
elif cmd == "get":
    # get <file> <python expression over d (the JSON document)> ; '' when the file is missing or empty
    try:
        with open(sys.argv[2], encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        raw = ""
    d = json.loads(raw) if raw.strip() else None
    print(eval(sys.argv[3], {"d": d, "json": json}))
elif cmd == "lines":
    # lines <jsonl file> <python expression over L (the parsed lines)>
    try:
        with open(sys.argv[2], encoding="utf-8") as f:
            L = [json.loads(x) for x in f if x.strip()]
    except OSError:
        L = []
    print(eval(sys.argv[3], {"L": L, "json": json}))
PY
H() { python3 "$T/h.py" "$@"; }

rollout_note() {  # rollout_note <slug> [<extra frontmatter line>] [<body>]
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n%s\n---\n\n## Notes\n\n%s\n' "${2:-}" "${3:-}" > "$TASKS/$1.md"
}
task_note() {  # task_note <slug> <status> <owner> <rollout link> [<pr> [<frontmatter line>]]
  { printf -- '---\ntags:\n  - task\nstatus: %s\n' "$2"
    [ -n "$3" ] && printf 'owner: %s\n' "$3"
    printf 'rollout: "[[%s]]"\n' "$4"
    [ -n "${5:-}" ] && printf 'pr: %s\n' "$5"
    [ -n "${6:-}" ] && printf '%s\n' "$6"
    printf -- '---\n# %s\n\nbody\n' "$1"; } > "$TASKS/$1.md"
}
# agent <session> <agent id> <opener text> [<form: workflows | subagents> [<shape>]] — the agent's transcript beside
# its lead's, the computed text the opener and a few body lines
agent() {
  local sid="$1" aid="$2" text="$3" form="${4:-workflows}" shape="${5:-str}" path
  : > "$PROJ/$sid.jsonl"
  if [ "$form" = subagents ]; then path="$PROJ/$sid/subagents/agent-$aid.jsonl"
  else path="$PROJ/$sid/subagents/workflows/wf_x/agent-$aid.jsonl"; fi
  printf '%s\n\nTask note: /x/%s.md\nProject root: /repo\n\nSteps:\n1. Read the task note in full.\n' "$text" "$aid" |
    H transcript "$path" "$sid" "$aid" "$PRE" "$shape"
}
# call <session> <agent id or -> <tool> <file path> [<extra json>] — runs the hook; sets rc, out, err
call() {
  local p extra="${5:-}"
  [ -n "$extra" ] || extra='{}'
  p=$(H payload "$1" "$PROJ/$1.jsonl" "$2" "$3" "$4" "$extra")
  printf '%s' "$p" | python3 "$HOOK" > "$T/out" 2> "$T/err"
  rc=$?
  out=$(cat "$T/out"); err=$(cat "$T/err")
}
ctx() { H get "$T/out" '(d or {}).get("hookSpecificOutput", {}).get("additionalContext", "")'; }
deny() { H get "$T/out" '"permissionDecision" in json.dumps(d) if d else False'; }
nlines() { H lines "$OV" "len([l for l in L if $1])"; }
records() { find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
reset() { rm -rf "$THREAD_NOTE_OVERLAP_DIR" "$THREAD_EVENTS_DIR"; }
fresh() { reset; call "$SA" agentA Write "$VAULT/$DAY"; }   # a clean state, then A's first write of the Day note

rollout_note ra; rollout_note rb
task_note a1 in_progress lead-aaaa1111 ra
task_note b1 in_progress lead-bbbb2222 rb
SA=sess-aaaa-0001; SB=sess-bbbb-0002
agent "$SA" agentA "You're picking up [[a1]] from the rollout at [[ra]]."
agent "$SB" agentB "PLAN APPROVED for [[b1]] (rollout [[rb]]). Implement the approved plan below."

# ── 1. fast exits: outside the vault, Work/Tasks and .obsidian/ are never recorded ───────────────────────────
call "$SA" agentA Write "$T/elsewhere/notes.md"
ok "$rc|$out|$err|$(records)" "0|||0" "fast exit: a path outside the vault gives empty stdout, exit 0, no record"
call "$SA" agentA Edit "$TASKS/a1.md"
ok "$rc|$out|$err|$(records)" "0|||0" "fast exit: a Work/Tasks note is bookkeeping, never recorded"
call "$SA" agentA Write "$VAULT/.obsidian/workspace.json"
ok "$rc|$out|$err|$(records)" "0|||0" "fast exit: a .obsidian/ file is never recorded"

# ── 2. the first failing test: A's implementer writes the Day note, B's approved-plan implementer edits it ───────
call "$SA" agentA Write "$VAULT/$DAY"
ok "$rc|$out|$err" "0||" "A's first write: silent, exit 0"
ok "$(records)" 1 "A's first write: the note's record is written"
call "$SB" agentB Edit "$VAULT/$DAY"
ok "$rc|$err" "0|" "B's edit: exit 0, empty stderr"
c=$(ctx)
has "$c" "[[a1]]" "B's warning names the holder's task"
has "$c" "[[ra]]" "B's warning names the holder's run"
has "$c" "re-read" "B's warning tells the agent to re-read the note"
has "$c" "let through" "B's warning says the edit was let through"
ok "$(deny)" False "B's call carries no permissionDecision"
ok "$(H get "$T/out" 'd["hookSpecificOutput"]["hookEventName"]')" PreToolUse "the output is PreToolUse's hookSpecificOutput"
ok "$(nlines 'True')" 1 "one overlaps.jsonl line"
ok "$(H lines "$OV" '[(l["kind"], l["rollout"], l["task"], l["note"], l["holderRollout"], l["holderTask"], l["via"], l["tool"]) for l in L]')" \
  "[('note-overlap', 'rb', 'b1', '$DAY', 'ra', 'a1', 'agent', 'Edit')]" "the line names the note and both runs"
ok "$(H lines "$OV" 'all(l["holderSince"].endswith("Z") for l in L)')" True "the line carries when the holder first wrote, UTC Z"
ok "$(ls "$THREAD_EVENTS_DIR")" "overlaps.jsonl" "no rollout's own record grows a line"

# ── 3. the reviser form: a two-line opener ─────────────────────────────────────────────────────────────────────
agent "$SB" agentB2 "REVISION ROUND 2: master review requested changes on your prior pass for [[b1]]
(rollout [[rb]])."
fresh; call "$SB" agentB2 MultiEdit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "the reviser (a two-line opener) is identified and warned"
ok "$(nlines 'l["task"] == "b1" and l["tool"] == "MultiEdit"')" 1 "the reviser's overlap is one line, tool MultiEdit"

# ── 4. repeats: one warning per new holder write ───────────────────────────────────────────────────────────────
reset
call "$SA" agentA Write "$VAULT/$DAY"
call "$SB" agentB Edit "$VAULT/$DAY"
call "$SB" agentB Edit "$VAULT/$DAY"
ok "$out|$(nlines 'l["rollout"] == "rb"')" "|1" "B edits again with no new A write: silent, no new line"
call "$SA" agentA Edit "$VAULT/$DAY"
has "$(ctx)" "[[b1]]" "A writes again: A is warned in turn, naming B's task"
call "$SB" agentB Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "after A's new write, B is warned again"
ok "$(nlines 'l["rollout"] == "rb"')" 2 "… with a second line"
ok "$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" '[(w["task"], w["writes"]) for w in d["writers"]]')" "[('a1', 2), ('b1', 3)]" \
  "the record counts each run's writes"

# ── 5. liveness ends a record ───────────────────────────────────────────────────────────────────────────────────
live_case() {  # live_case <label> <a1 status> <a1 owner> <a1 rollout> [<pr> [<line>]] — B's edit after A's write
  reset; task_note a1 in_progress lead-aaaa1111 ra
  call "$SA" agentA Write "$VAULT/$DAY"
  task_note a1 "$2" "$3" "$4" "${5:-}" "${6:-}"
  call "$SB" agentB Edit "$VAULT/$DAY"
}
live_case done done lead-aaaa1111 ra
ok "$out|$(nlines True)" "|0" "a done holder no longer warns"
ok "$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" '[w["task"] for w in d["writers"]]')" "['b1']" "… and its writer is pruned"
live_case blocked blocked lead-aaaa1111 ra
ok "$out|$(nlines True)" "|0" "a set-aside (blocked) holder no longer warns"
live_case restart in_progress lead-cccc3333 ra
has "$(ctx)" "[[a1]]" "a restart by a new lead Session (owner: re-stamped to its tag) keeps the holder's record: still warned"
first=$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" '[w["first"] for w in d["writers"] if w["task"] == "a1"][0]')
call "$SA" agentA Edit "$VAULT/$DAY"
ok "$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" '[(w["task"], w["owner"], w["writes"]) for w in d["writers"]]')" \
  "[('a1', 'lead-cccc3333', 2), ('b1', 'lead-bbbb2222', 1)]" \
  "… and the restarted task's own edit continues its entry under the new tag, its count kept"
ok "$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" '[w["first"] for w in d["writers"] if w["task"] == "a1"][0]')" "$first" \
  "… with its first write kept"
rollout_note rc
live_case repointed in_progress lead-aaaa1111 rc
ok "$out|$(nlines True)" "|0" "a rollout: re-pointed (a carry or a defer) ends the record"
live_case review review lead-aaaa1111 ra https://github.com/o/r/pull/7
has "$(ctx)" "[[a1]]" "review with a pr: (awaiting Integration) still warns"
live_case review-no-pr review lead-aaaa1111 ra
ok "$out" "" "review with no pr: is not live"
live_case carried review lead-aaaa1111 ra https://github.com/o/r/pull/7 'merged: 2026-11-11T10:00+00:00'
ok "$out" "" "review with a pr: and a valued merged: (a carried fix, ADR 0078 d1) is not live"
for m in 'merged: null' 'merged: ~' 'merged: ""'; do
  live_case unvalued review lead-aaaa1111 ra https://github.com/o/r/pull/7 "$m"
  has "$(ctx)" "[[a1]]" "review with a pr: and $m (unvalued, _valued's literal mirror) still warns"
done
reset; task_note a1 in_progress lead-aaaa1111 ra
call "$SA" agentA Write "$VAULT/$DAY"
mkdir -p "$TASKS/Archive/Rollouts"; mv "$TASKS/ra.md" "$TASKS/Archive/Rollouts/ra.md"
call "$SB" agentB Edit "$VAULT/$DAY"
ok "$out" "" "an archived rollout ends the record"
mv "$TASKS/Archive/Rollouts/ra.md" "$TASKS/ra.md"
reset; call "$SA" agentA Write "$VAULT/$DAY"
mv "$TASKS/a1.md" "$T/a1.md"; call "$SB" agentB Edit "$VAULT/$DAY"
ok "$out" "" "a missing task note ends the record"
mv "$T/a1.md" "$TASKS/a1.md"

# ── 6. same rollout: two tasks of ra in one note are not warned (another run is another rollout) ─────────────────
reset; task_note a2 in_progress lead-aaaa1111 ra
agent "$SA" agentA2 "You're picking up [[a2]] from the rollout at [[ra]]."
call "$SA" agentA Write "$VAULT/$DAY"
call "$SA" agentA2 Edit "$VAULT/$DAY"
ok "$out|$(nlines True)|$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" 'len(d["writers"])')" "|0|2" \
  "two tasks of one rollout: both recorded, no warning"

# ── 7–8. wrong pairs are unidentified: no record ─────────────────────────────────────────────────────────────────
reset; task_note x1 in_progress lead-x rc
agent "$SB" agentX "You're picking up [[x1]] from the rollout at [[rb]]."
call "$SB" agentX Write "$VAULT/$DAY"
ok "$out|$(records)" "|0" "a task whose rollout: names a link not in the opener is unidentified"
agent "$SB" agentY "Read the task note and summarise the rollout's state."
call "$SB" agentY Write "$VAULT/$DAY"
ok "$out|$(records)" "|0" "an opener with no links (a non-engine subagent, no Leg) is unidentified"
agent "$SB" agentZ "Line one.
Line two.
Line three.
You're picking up [[b1]] from the rollout at [[rb]]."
call "$SB" agentZ Write "$VAULT/$DAY"
ok "$(records)" 0 "an opener pushed below the first three lines is unidentified"

# ── 9. a serial Leg: no agent_id, found by its session in an open Leg ───────────────────────────────────────────
leg_note() {  # leg_note <extra Leg log lines> — the chain's note, named as schedule names every rollout note
  rollout_note "$SR" 'shape: serial' "body

## Queue

| # | Task |
|---|---|
| 1 | [[s1]] |

## Leg log

- 2026-11-03T10:00+11:00 Leg 1 began: leg-1 session $SL in cc-thread from ~/repos/x
- 2026-11-03T10:05+11:00 Leg 1 claimed [[s1]]${1:-}"
}
SL=sess-leg-0003; SR=sr-rollout-2026-11-03
reset; leg_note; task_note s1 in_progress leg-1 "$SR"
call "$SA" agentA Write "$VAULT/$DAY"
call "$SL" - Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "a Leg's edit of A's note warns naming A's task"
has "$(ctx)" "[[ra]]" "… and A's run"
ok "$(H lines "$OV" '[(l["rollout"], l["task"], l["via"]) for l in L]')" "[('$SR', 's1', 'leg')]" "the Leg's line reads via: leg"
reset; leg_note "
- 2026-11-03T11:00+11:00 Leg 1 closed: chain complete"
call "$SL" - Edit "$VAULT/$DAY"
ok "$(records)" 0 "a closed Leg is not identified"
reset; leg_note; task_note s1 in_progress leg-2 "$SR"
call "$SL" - Edit "$VAULT/$DAY"
ok "$(records)" 0 "a claim whose owner is another Leg is not identified"
reset; leg_note "
- 2026-11-03T10:30+11:00 Leg 1 resumed: session sess-leg-0004"; task_note s1 in_progress leg-1 "$SR"
call "$SL" - Edit "$VAULT/$DAY"
ok "$(records)" 0 "a Leg resumed by another session is not this session's"
call sess-leg-0004 - Edit "$VAULT/$DAY"
ok "$(records)" 1 "… and the resuming session is"
reset; leg_note; agent "$SL" legsub "Grep the repo for the old name."
call "$SL" legsub Edit "$VAULT/$DAY"
ok "$(records)" 1 "a Leg's own subagent (an agent_id, no engine opener) falls back to the Leg"
# the lost-Leg signal: a holder recorded under leg-1 whose task a take-over re-stamps leg-2 is no longer live
reset; leg_note; task_note s1 in_progress leg-1 "$SR"
call "$SL" - Edit "$VAULT/$DAY"
call "$SA" agentA Edit "$VAULT/$DAY"
has "$(ctx)" "[[s1]]" "a Leg's live record warns another run's edit, naming the Leg's task"
reset; call "$SL" - Edit "$VAULT/$DAY"
task_note s1 in_progress leg-2 "$SR"
call "$SA" agentA Edit "$VAULT/$DAY"
ok "$out|$(nlines True)" "|0" "a Leg's take-over (owner: leg-1 re-stamped leg-2) ends the Leg's record: no warning"
ok "$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" '[w["task"] for w in d["writers"]]')" "['a1']" \
  "… and its writer is pruned"
task_note s1 in_progress leg-1 "$SR"
rm "$TASKS/$SR.md"

# ── 10. transcript forms and message shapes ────────────────────────────────────────────────────────────────────
form() { H lines "$THREAD_NOTE_OVERLAP_DIR/debug.jsonl" '(L[-1]["form"], L[-1]["identity"])'; }
agent "$SB" agentS "You're picking up [[b1]] from the rollout at [[rb]]." subagents
fresh; call "$SB" agentS Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "form: <stem>/subagents/agent-<id>.jsonl"
ok "$(form)" "('subagents', 'agent')" "… read as the subagents form"
fresh; p=$(H payload "$SB" "$PROJ/$SB/subagents/agent-agentS.jsonl" agentS Edit "$VAULT/$DAY")
printf '%s' "$p" | python3 "$HOOK" > "$T/out" 2> "$T/err"
has "$(ctx)" "[[a1]]" "form: a transcript_path pointing straight at the agent file"
ok "$(form)" "('direct', 'agent')" "… read as the direct form"
agent "$SB" agentL "PLAN APPROVED for [[b1]] (rollout [[rb]]). Implement the approved plan below." workflows list
fresh; call "$SB" agentL Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "a message whose content is a list of text parts"
agent "$SB" agentLate "PLAN APPROVED for [[b1]] (rollout [[rb]]). Implement the approved plan below." workflows late
fresh; call "$SB" agentLate Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "a first user line that is not line 0"
agent "$SB" agentNP "You're picking up [[b1]] from the rollout at [[rb]]."
python3 - "$PROJ/$SB/subagents/workflows/wf_x/agent-agentNP.jsonl" <<'PY'
import json, sys
L = [json.loads(x) for x in open(sys.argv[1])]
L[0]["message"]["content"] = L[0]["message"]["content"].split("\n", 1)[1]   # no harness preamble line
open(sys.argv[1], "w").write("".join(json.dumps(x) + "\n" for x in L))
PY
fresh; call "$SB" agentNP Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "a computed text with no harness preamble line still reads its opener"
mkdir -p "$T/elsewhere"; mv "$PROJ/$SB/subagents/workflows/wf_x/agent-agentB.jsonl" "$T/elsewhere/agent-x.jsonl"
fresh; call "$SB" agentB Edit "$VAULT/$DAY" "{\"agent_transcript_path\": \"$T/elsewhere/agent-x.jsonl\"}"
has "$(ctx)" "[[a1]]" "form: an agent_transcript_path key"
ok "$(form)" "('agent_transcript_path', 'agent')" "… read as the agent_transcript_path form"
mv "$T/elsewhere/agent-x.jsonl" "$PROJ/$SB/subagents/workflows/wf_x/agent-agentB.jsonl"
reset; CALL_CWD="$VAULT/Days" call "$SA" agentA Write "2026/2026-11/2026-W45/2026-11-03 Tue.md"
ok "$(H get "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" 'd["note"]')" "$DAY" "a relative file_path is joined to the payload's cwd"
UPPER=$(python3 -c 'import sys; print(sys.argv[1].upper())' "$DAY")
fresh; call "$SB" agentB Edit "$VAULT/$UPPER"
has "$(ctx)" "[[a1]]" "a case-different path is the same note (case-folded key)"
ln -s "$VAULT" "$T/vault-link"
fresh; call "$SB" agentB Edit "$T/vault-link/$DAY"
has "$(ctx)" "[[a1]]" "a path through a symlink to the vault is the same note (realpath on both sides)"

# ── 11. the XDG rule: a relative THREAD_NOTE_OVERLAP_DIR or XDG_STATE_HOME is ignored ─────────────────────────────
reset; mkdir -p "$T/cwd"
p=$(H payload "$SA" "$PROJ/$SA.jsonl" agentA Write "$VAULT/$DAY")
(cd "$T/cwd" && printf '%s' "$p" | THREAD_NOTE_OVERLAP_DIR=rel XDG_STATE_HOME=rel2 python3 "$HOOK" > /dev/null 2>&1)
ok "$(find "$HOME/.local/state/thread/note-writers" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')" 1 \
  "xdg: the record lands under ~/.local/state/thread/note-writers"
ok "$([ -e "$T/cwd/rel" ] || [ -e "$T/cwd/rel2" ] && echo made || echo none)" none "xdg: no relative dir is made in the cwd"
p=$(H payload "$SA" "$PROJ/$SA.jsonl" agentA Write "$VAULT/$DAY")
printf '%s' "$p" | THREAD_NOTE_OVERLAP_DIR= XDG_STATE_HOME="$T/xdg" python3 "$HOOK" > /dev/null 2>&1
ok "$(find "$T/xdg/thread/note-writers" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')" 1 "xdg: an absolute XDG_STATE_HOME is used when the override is empty"
rm -rf "$HOME/.local" "$T/xdg"

# ── 12. the debug log ────────────────────────────────────────────────────────────────────────────────────────────
reset; call "$SA" agentA Write "$VAULT/$DAY"; call "$SB" agentB Edit "$VAULT/$DAY"
DBG="$THREAD_NOTE_OVERLAP_DIR/debug.jsonl"
ok "$(H lines "$DBG" '[(l["agent"], l["form"], l["identity"], l["outcome"], l["why"], l["note"]) for l in L][-1]')" \
  "(True, 'workflows', 'agent', 'warned', 'ok', '$DAY')" "debug (default): B's line"
ok "$(H lines "$DBG" '[l["outcome"] for l in L]')" "['recorded', 'warned']" "debug (default): A's recorded, B's warned"
ok "$(H lines "$DBG" 'sorted(L[-1])')" "['agent', 'agentType', 'form', 'identity', 'ms', 'note', 'outcome', 'session', 'tool', 'ts', 'why']" "debug: the line's keys"
call "$SA" agentA Edit "$TASKS/a1.md"
ok "$(H lines "$DBG" '(L[-1]["why"], L[-1]["form"], L[-1]["identity"])')" "('bookkeeping', 'skipped', 'none')" "debug (default): a Work/Tasks edit is logged as bookkeeping"
call "$SA" agentA Edit "$T/elsewhere/notes.md"
ok "$(H lines "$DBG" 'len(L)')" 3 "debug (default): a call outside the vault is not logged"
export THREAD_NOTE_OVERLAP_DEBUG="$T/dbg.jsonl"
call "$SA" agentA Edit "$T/elsewhere/notes.md"
ok "$(H lines "$T/dbg.jsonl" '(L[-1]["why"], "note" in L[-1])')" "('outside-vault', False)" "debug (explicit): a non-vault call, no note"
call "$SB" agentY Write "$VAULT/Days/other.md"
ok "$(H lines "$T/dbg.jsonl" '(L[-1]["identity"], L[-1]["why"])')" "('none', 'no-opener-pair')" "debug (explicit): an unidentified vault edit"
call "$SB" ghost Write "$VAULT/Days/other.md"
ok "$(H lines "$T/dbg.jsonl" '(L[-1]["form"], L[-1]["why"])')" "('none', 'no-transcript')" "debug (explicit): an agent with no transcript"
printf 'not json' | python3 "$HOOK" > /dev/null 2>&1
ok "$(H lines "$T/dbg.jsonl" 'L[-1]["why"]')" "bad-payload" "debug (explicit): a payload that is not JSON"
export THREAD_NOTE_OVERLAP_DEBUG=off
rm -f "$DBG"; call "$SB" agentB Edit "$VAULT/$DAY"
ok "$([ -e "$DBG" ] && echo y || echo n)" n "debug off: no file"
export THREAD_NOTE_OVERLAP_DEBUG=rel.jsonl
call "$SB" agentB Edit "$VAULT/$DAY"
ok "$([ -e "$DBG" ] && echo y || echo n)|$(find "$T" -name rel.jsonl | wc -l | tr -d ' ')" "y|0" "debug relative: ignored, the default file used"
unset THREAD_NOTE_OVERLAP_DEBUG
python3 -c 'import sys; open(sys.argv[1], "w").write("x" * 600000)' "$DBG"
call "$SB" agentB Edit "$VAULT/$DAY"
ok "$([ -e "$DBG.1" ] && echo y || echo n)|$(H lines "$DBG" 'len(L)')" "y|1" "debug: past 512 KB the file rotates to .1"

# ── 13. the sweep: a record untouched for 14 days goes on the next recorded write, once a day ──────────────────
reset; mkdir -p "$THREAD_NOTE_OVERLAP_DIR"
OLD="$THREAD_NOTE_OVERLAP_DIR/0123456789abcdef.json"
printf '{"note": "x.md", "writers": []}' > "$OLD"
touch_back() { python3 -c 'import os, sys, time; t = time.time() - float(sys.argv[2]) * 86400; os.utime(sys.argv[1], (t, t))' "$1" "$2"; }
touch_back "$OLD" 20; : > "$THREAD_NOTE_OVERLAP_DIR/.swept"; touch_back "$THREAD_NOTE_OVERLAP_DIR/.swept" 0
call "$SA" agentA Write "$VAULT/$DAY"
ok "$([ -e "$OLD" ] && echo kept || echo gone)" kept "sweep: a fresh .swept leaves an old record"
touch_back "$THREAD_NOTE_OVERLAP_DIR/.swept" 2
call "$SA" agentA Write "$VAULT/$DAY"
ok "$([ -e "$OLD" ] && echo kept || echo gone)|$(records)" "gone|1" "sweep: a .swept 2 days old removes a record 20 days old, never the live one"

# ── 14. robustness: always exit 0, never a deny, empty stderr ────────────────────────────────────────────────────
robust() {  # robust <label> — after a call: rc 0, no deny, empty stderr
  ok "$rc|$(deny)|$err" "0|False|" "robust: $1"
}
printf 'not json' | python3 "$HOOK" > "$T/out" 2> "$T/err"; rc=$?; err=$(cat "$T/err")
robust "stdin that is not JSON"
printf '{"session_id": "s", "tool_name": "Edit"}' | python3 "$HOOK" > "$T/out" 2> "$T/err"; rc=$?; err=$(cat "$T/err")
robust "no tool_input"
reset; call "$SA" agentA Write "$VAULT/$DAY"
chmod 000 "$PROJ/$SB/subagents/workflows/wf_x/agent-agentB.jsonl"
call "$SB" agentB Edit "$VAULT/$DAY"; robust "an unreadable transcript"
ok "$out" "" "… unidentified, so silent"
chmod 644 "$PROJ/$SB/subagents/workflows/wf_x/agent-agentB.jsonl"
: > "$T/afile"
THREAD_NOTE_OVERLAP_DIR="$T/afile" call "$SB" agentB Edit "$VAULT/$DAY"; robust "THREAD_NOTE_OVERLAP_DIR a regular file"
KEY=$(basename "$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json')" .json)
rm -f "$THREAD_NOTE_OVERLAP_DIR/$KEY.lock"; mkdir "$THREAD_NOTE_OVERLAP_DIR/$KEY.lock"
before=$(cat "$THREAD_NOTE_OVERLAP_DIR/$KEY.json")
ok "$(nlines True)" 0 "(no overlaps.jsonl line yet: nothing has been warned since the reset)"
call "$SB" agentB Edit "$VAULT/$DAY"; robust "the note's lock cannot be opened"
has "$(ctx)" "[[a1]]" "… the warning still goes out, from an unlocked read of the record"
call "$SB" agentB Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "… a repeat call warns again (the holder's warned mark went unsaved)"
ok "$(nlines True)" 0 "… and neither call writes an overlaps.jsonl line"
ok "$(cat "$THREAD_NOTE_OVERLAP_DIR/$KEY.json")" "$before" "… and nothing is written"
rmdir "$THREAD_NOTE_OVERLAP_DIR/$KEY.lock"
python3 - "$THREAD_NOTE_OVERLAP_DIR/$KEY.lock" "$T/held" <<'PY' &
import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o644)
fcntl.flock(fd, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(8)
PY
holder=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -e "$T/held" ] && break; python3 -c 'import time; time.sleep(0.1)'; done
before=$(cat "$THREAD_NOTE_OVERLAP_DIR/$KEY.json")
call "$SB" agentB Edit "$VAULT/$DAY"; robust "the note's lock held by another process past 0.3 s"
has "$(ctx)" "[[a1]]" "… the warning still goes out"
call "$SB" agentB Edit "$VAULT/$DAY"
has "$(ctx)" "[[a1]]" "… a repeat call while the lock is held warns again"
ok "$(nlines True)" 0 "… and neither call writes an overlaps.jsonl line"
ok "$(cat "$THREAD_NOTE_OVERLAP_DIR/$KEY.json")" "$before" "… and nothing is written"
ok "$(H lines "$THREAD_NOTE_OVERLAP_DIR/debug.jsonl" '[l["outcome"] for l in L][-2:]')" "['lock-busy', 'lock-busy']" "… each logged lock-busy"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
# drive <mode> <session> <agent id or -> — loads the hook as a module and runs handle() on an Edit of the Day note in
# this process, with fcntl hidden (mode nofcntl) or the budget spent at one checkpoint (budget:<checkpoint>); the
# result, {raised, outcome, calls (the hook functions reached, in order), out}, in $T/drive.json
cat > "$T/drive.py" <<'PY'
import importlib.util, json, sys, time, types
hook_path, mode, payload = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
if mode == "nofcntl":
    sys.modules["fcntl"] = None   # `import fcntl` raises ImportError, as on native Windows
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("vault_note_overlap", hook_path)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
checkpoint = mode.split(":", 1)[1] if mode.startswith("budget:") else None
clock, calls, start = [0.0], [], time.monotonic()
hook.time = types.SimpleNamespace(monotonic=lambda: clock[0] + time.monotonic() - start, time=time.time,
                                  strftime=time.strftime, gmtime=time.gmtime, sleep=time.sleep)
spent = 100 * hook.BUDGET
if checkpoint == "transcript":
    clock[0] = spent   # spent from the start: the first check, before the transcript read
flip = {"leg": "pick_pair", "lock": "pick_pair", "emit": "visit"}.get(checkpoint)   # spent once that function returns
def wrap(name):
    orig = getattr(hook, name)
    def f(*a, **k):
        calls.append(name)
        r = orig(*a, **k)
        if name == flip:
            clock[0] = spent
        return r
    setattr(hook, name, f)
for name in ("find_transcript", "pick_pair", "leg_identity", "visit", "_lock", "emit"):
    wrap(name)
call = {"tool": None, "agent": False, "agentType": None, "session": None, "form": "skipped", "identity": "none",
        "why": None, "outcome": "silent", "note": None}
raised, out = None, None
try:
    out = hook.handle(payload, call, 0.0)
except BaseException as e:  # noqa: BLE001
    raised = repr(e)
print(json.dumps({"raised": raised, "outcome": call["outcome"], "calls": calls, "out": out}))
PY
drive() {
  local p
  p=$(H payload "$2" "$PROJ/$2.jsonl" "$3" Edit "$VAULT/$DAY")
  python3 "$T/drive.py" "$HOOK" "$1" "$p" > "$T/drive.json" 2> "$T/drive.err"
}
dv() { H get "$T/drive.json" "$1"; }
before=$(cat "$THREAD_NOTE_OVERLAP_DIR/$KEY.json")
drive nofcntl "$SB" agentB
ok "$(dv '(d["raised"], d["outcome"], d["calls"])')" "(None, 'lock-busy', ['find_transcript', 'pick_pair', 'visit', '_lock'])" \
  "no fcntl (native Windows): the ImportError is caught in _lock, which returns no lock"
has "$(dv 'json.loads(d["out"])["hookSpecificOutput"]["additionalContext"]')" "[[a1]]" \
  "… the documented unlocked read still warns from an existing record"
ok "$(dv '"permissionDecision" in d["out"]')|$(nlines True)|$(cat "$THREAD_NOTE_OVERLAP_DIR/$KEY.json")" "False|0|$before" \
  "… no permissionDecision, no overlaps.jsonl line and nothing written"
reset; call "$SA" agentA Write "$VAULT/$DAY"
THREAD_EVENTS_DIR="$T/afile/events" call "$SB" agentB Edit "$VAULT/$DAY"; robust "THREAD_EVENTS_DIR under a regular file"
has "$(ctx)" "[[a1]]" "… the warning still goes out with no record line"

# ── 15. time limit and floor ──────────────────────────────────────────────────────────────────────────────────────
reset; mkdir -p "$THREAD_NOTE_OVERLAP_DIR"
i=0; while [ "$i" -lt 40 ]; do rollout_note "p$i-rollout-2026-11-0$((i % 9 + 1))" 'shape: serial' "- 2026-11-03T10:00+11:00 Leg 1 began: leg-1 session other-$i in a from b"; i=$((i+1)); done
python3 -c '
import os, sys
for i in range(300):
    open(os.path.join(sys.argv[1], "%016x.json" % i), "w").write("{\"note\": \"n.md\", \"writers\": []}")' "$THREAD_NOTE_OVERLAP_DIR"
call "$SA" agentA Write "$VAULT/$DAY"
slow=$(python3 - "$HOOK" "$PROJ" "$VAULT/$DAY" "$SA" "$SB" "$SL" <<'PY'
import json, subprocess, sys, time
hook, proj, note, sa, sb, sl = sys.argv[1:]
worst = 0.0
for i in range(20):
    sid, aid = [(sa, "agentA"), (sb, "agentB"), (sl, None), (sb, "agentY")][i % 4]
    p = {"session_id": sid, "transcript_path": "%s/%s.jsonl" % (proj, sid), "cwd": "/tmp", "hook_event_name": "PreToolUse",
         "tool_name": "Edit", "tool_input": {"file_path": note}}
    if aid:
        p["agent_id"] = aid
    t = time.monotonic()
    subprocess.run([sys.executable, hook], input=json.dumps(p), capture_output=True, text=True)
    worst = max(worst, time.monotonic() - t)
print("slow %.3f" % worst if worst >= 1.0 else "fast")
PY
)
ok "$slow" fast "time: 20 calls with 40 rollout notes and 300 record files each finish under 1.0 s"
# the budget guard: spent at each checkpoint, handle() stops there, raises nothing and never denies
reset; call "$SA" agentA Write "$VAULT/$DAY"
REC=$(find "$THREAD_NOTE_OVERLAP_DIR" -name '*.json'); before=$(cat "$REC")
budget_case() {  # budget_case <checkpoint> <agent id> <the hook functions reached, a python list> — B's session
  drive "budget:$1" "$SB" "$2"
  ok "$(dv '(d["raised"], d["outcome"], d["calls"])')" "(None, 'budget', $3)" "budget spent before the $1: stops there, no exception"
}
budget_case transcript agentB "[]"
ok "$(dv 'd["out"]')|$(cat "$REC")" "None|$before" "… nothing printed, nothing written"
budget_case leg agentY "['find_transcript', 'pick_pair']"
ok "$(dv 'd["out"]')|$(cat "$REC")" "None|$before" "… (an opener that names no run) the Leg scan never runs, nothing printed"
budget_case lock agentB "['find_transcript', 'pick_pair', 'visit']"
ok "$(dv 'd["out"]')|$(cat "$REC")" "None|$before" "… (an identified edit) no lock is taken, nothing printed, nothing written"
budget_case emit agentB "['find_transcript', 'pick_pair', 'visit', '_lock']"
has "$(dv 'json.loads(d["out"])["hookSpecificOutput"]["additionalContext"]')" "[[a1]]" "… (a warned edit) the warning JSON is still returned"
ok "$(dv '"permissionDecision" in d["out"]')|$(nlines True)" "False|0" "… with no permissionDecision, and no overlaps.jsonl line (emit never ran)"
ok "$(python3 -c '
import json, sys
h = json.load(open(sys.argv[1]))["hooks"]["PreToolUse"]
e = [x for x in h if "vault-note-overlap.py" in json.dumps(x)]
x = e[0]["hooks"][0] if len(e) == 1 else {}
print(e[0].get("matcher"), x.get("timeout", 99) <= 10, "onFailure" in json.dumps(e), x.get("command"))' "$root/hooks/hooks.json")" \
  'Edit|Write|MultiEdit True False python3 "${CLAUDE_PLUGIN_ROOT}/hooks/vault-note-overlap.py"' \
  "hooks.json: the PreToolUse entry's matcher, a timeout of 10 s or less, no onFailure"
ok "$(python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9)); print("ok")' "$HOOK" 2>&1)" ok \
  "floor: the hook parses as python 3.9"
ok "$(python3 - "$HOOK" "$root/skills/execute/scripts/leg.py" "$root/skills/execute/scripts/reconcile-rollout.py" <<'PY' 2>&1
import importlib.util, sys
def load(name, src):
    spec = importlib.util.spec_from_file_location(name, src); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
sys.dont_write_bytecode = True
hook, leg, rr = load("hook", sys.argv[1]), load("leg", sys.argv[2]), load("rr", sys.argv[3])
print(hook.LINK_RE_SRC == leg.LINK_RE.pattern, hook.ROLLOUT_NOTE_NAME_RE_SRC == rr.ROLLOUT_NOTE_NAME_RE.pattern)
PY
)" "True True" "the hook's link and rollout-name grammar are leg.py's LINK_RE and reconcile-rollout.py's ROLLOUT_NOTE_NAME_RE"

echo
if [ "$fail" -eq 0 ]; then echo "vault-note-overlap: ALL PASS"; else echo "vault-note-overlap: FAILED"; fi
exit "$fail"
