#!/usr/bin/env bash
# p46-2 (ADR 0079 decisions 3 and 4): arms. A drawn role falls in its Opus or Fable arm by a draw fixed by the task's
# name (a rollout's lead by the rollout's), compared with the role's Fable share (the ladder's [share] table), stamped
# on the note at the task's first dispatch, so a resume or a later dispatch keeps it whatever the share is by then.
#   D  the draw (reconcile-rollout.py loaded by importlib): 1,000 slugs at a share of 0.5 land 45 to 55% in Fable for
#      each drawn role, two roles' draws are independent (each of the four combinations 20 to 30%), a share of 0 draws
#      none and 1 draws all, the planner and plan judge are never drawn, hardness picks the builder, and the stamp
#      parses and formats back to itself.
#   M  mark-started: a first dispatch stamps and prints the arms line; a re-dispatch at another share keeps it; a
#      resume stamps and prints nothing; a task begun before the draw is stamped all none; hardness is read once; no
#      [share] leaves the note's bytes as before; --dry-run writes nothing; a stamp that does not parse is kept with
#      one WARN; a refused ladder stamps nothing.
#   R  record-entry: the lead's arm on the rollout note, kept at a later share, none for a rollout led before the
#      draw, nothing with no share; the lead-entry line carries no arm.
#   S  status: its ladder keeps source, rungs and error, never the share.
#   F  (p52-2, ADR 0081 d2) the role-call fold of a doubled master review: its first reviewer is its own role, the
#      master-review line carries no arm, and a dead Fable first reviewer's rerun on the rung is fellBack.
#   P  (p46-3, ADR 0079 decision 6) the paced share: each draw is the role's Fable ceiling (the [share] value) times
#      skills/execute/scripts/fable_pace.py's pace for the caller's Login (CLAUDE_CONFIG_DIR's basename, login-a here)
#      in the quota store, and writes one fable-share Run record line; a missing or stale store, or no session, draws
#      Opus with its why and one WARN, never a stop; a spent window draws Opus with no why; the lead's draw is paced too;
#      --dry-run and a later dispatch's none stamp write no line. The M and R cases run at pace 1 (Fable 0, general 50).
#   A  (p46-3, ADR 0079 d7) a row's allowance: a valid one stamps `fell_back:`, a malformed one is an ERROR that stamps
#      nothing; an allowance block writes `## Blocker diagnosis`, never plan feedback; status shows fellBack only on an
#      unlanded stamped task.
#   C  (p46-3) the role-call fold of a fell-back call: fellBack from the ran flag, a redirected plan judge's model and
#      effort from its `asked`, refused from an errored agent's refusal text, never from a connection drop.
# HOME points at a temp dir holding each case's ~/.config/thread/ladder.toml and ~/.claude/state/agent-quotas.json.
# Temp dirs only.
# Usage: bash reconcile-rollout-arms.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME/.config/thread" "$HOME/.claude/state"
unset CLAUDE_ACCOUNT_PINNED AGENT_QUOTAS_STORE
# p46-3: the draws read the caller's Login (a Claude Code session's CLAUDE_CONFIG_DIR basename) in the quota store.
export CLAUDE_CODE_SESSION_ID=arms-test CLAUDE_CONFIG_DIR="$TMP/login-a"
STORE="$HOME/.claude/state/agent-quotas.json"
export THREAD_EVENTS_DIR="$TMP/events"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export THREAD_GIT_ENV_DIR="$TMP/git-env"
export THREAD_MACHINE_TIMES='{}'
V="$TMP/vault"; mkdir -p "$V" "$THREAD_EVENTS_DIR"
NOW=2026-11-13T10:00:00Z
LADDER="$HOME/.config/thread/ladder.toml"

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }

# quota <fable> <general> [age-s]: login-a's row in the quota store, both windows fetched age seconds (600) before NOW.
quota() {
  python3 - "$STORE" "$NOW" "$1" "$2" "${3:-600}" <<'PY'
import json, sys
from datetime import datetime
path, now, f, g, age = sys.argv[1:]
at = datetime.fromisoformat(now.replace("Z", "+00:00")).timestamp() - int(age)
def w(kind, u, extra):
    return dict({"kind": kind, "utilization": float(u), "resets_at": at + 3 * 86400, "is_enabled": True, "fetched_at": at,
                 "source": "oauth"}, **extra)
row = {"provider": "anthropic", "account": "a@example.invalid", "profile": "login-a", "fetched_at": at, "status": "ok",
       "windows": [w("seven_day", g, {}), w("custom", f, {"custom_kind": "claude-weekly-scoped-fable", "display_name": "Fable"})]}
json.dump({"version": 1, "written_at": at, "accounts": [row]}, open(path, "w"))
PY
}
quota 0 50   # pace 1: the M and R cases draw at their [share] values, as before p46-3
# shares <rollout>: the fable-share lines of its Run record, one compact JSON object per line (ts, host, v dropped).
shares() {
  python3 - "$THREAD_EVENTS_DIR/$1.jsonl" <<'PY'
import json, sys
try:
    L = [json.loads(x) for x in open(sys.argv[1]) if x.strip()]
except FileNotFoundError:
    L = []
for d in L:
    if d["kind"] == "fable-share":
        print(json.dumps({k: v for k, v in d.items() if k not in ("ts", "host", "v", "kind", "rollout")}, sort_keys=True,
                         separators=(",", ":")))
PY
}

# ladder <toml after the one rung>: the operator's file, one Opus rung, then the given lines (a [share] table).
ladder() { printf '[[rung]]\nname = "opus-high"\nmodel = "opus"\neffort = "high"\njudge = "high"\nreview = "xhigh"\n%s\n' "$1" > "$LADDER"; }
noladder() { rm -f "$LADDER"; }
mkro() {  # mkro <stem>: a parallel rollout note whose Project root does not exist (no arm needed)
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n' \
    "$TMP/no-repo" > "$V/$1.md"
}
mkt() {  # mkt <slug> [frontmatter lines...]: an in_progress task note in rollout ro
  local s=$1; shift
  { printf -- '---\ntags: [task]\nstatus: in_progress\nrollout: "[[ro]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody of %s\n' "$s"; } > "$V/$s.md"
}
fm() { grep -m1 "^$2:" "$V/$1.md" || echo "<none>"; }
ms() { python3 "$SCRIPT" mark-started --tasks "$1" --tasks-dir "$V" --now "$NOW" "${@:2}" 2>"$TMP/err"; }
armline() { grep "^$1: arms " || echo "<none>"; }
sha() { shasum "$1" | cut -d' ' -f1; }
mkro ro

echo "== D. the draw"
out=$(python3 - "$SCRIPT" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
slugs = ["t-%04d" % i for i in range(1000)]
drawn = ("master-review", "builder", "investigator", "lead")
draws = {r: [m._draw_arm(r, s, 0.5) for s in slugs] for r in drawn}
for r in drawn:
    f = draws[r].count("fable") / 1000
    print("share-%s %s" % (r, "ok" if 0.45 <= f <= 0.55 else f))
for a, b in (("master-review", "builder"), ("builder", "investigator")):
    combos = {}
    for x, y in zip(draws[a], draws[b]):
        combos[(x, y)] = combos.get((x, y), 0) + 1
    bad = [(k, v) for k, v in combos.items() if not 200 <= v <= 300]
    print("independent-%s-%s %s" % (a, b, "ok" if len(combos) == 4 and not bad else (combos, bad)))
print("share-0", sum(m._draw_arm(r, s, 0) == "fable" for r in drawn for s in slugs))
print("share-1", sum(m._draw_arm(r, s, 1) == "fable" for r in drawn for s in slugs))
print("fixed", m._draw_arm("builder", "t-0007", 0.5) == m._draw_arm("builder", "t-0007", 0.5))
for r in ("planner", "plan-judge"):
    try:
        m._draw_arm(r, "t-0001", 1)
        print("refuses-%s no" % r)
    except ValueError:
        print("refuses-%s yes" % r)
def note(slug, *lines):
    return m.Note(Path("/x/%s.md" % slug), text="---\nstatus: in_progress\n" + "".join(l + "\n" for l in lines) + "---\nbody\n")
ALL = {"master-review": 1, "builder": 1, "investigator": 1, "lead": 1}
keys = set()
for i in range(50):
    for lines in (("scope: single-file",), ("scope: read-only",), ("scope: cross-cutting",), ("work_depth: deep",)):
        keys |= set(m._task_arms(note("t-%d" % i, *lines), ALL))
print("never-planned", sorted(keys))
print("deep", m._task_arms(note("t-a", "scope: single-file", "work_depth: deep"), ALL))
print("cross", m._task_arms(note("t-a", "scope: cross-cutting", "work_depth: standard"), ALL))
print("standard", m._task_arms(note("t-a", "scope: single-file", "work_depth: standard"), ALL))
print("read-only", m._task_arms(note("t-a", "scope: read-only", "work_depth: deep"), ALL))
print("unshared", m._task_arms(note("t-a", "scope: cross-cutting"), {"lead": 1}))
for stamp in ("master-review=fable builder=none", "investigator=opus", "lead=fable"):
    roles = m.ARM_ROLES + (m.LEAD_ROLE,)
    print("roundtrip", m._format_arms(m._parse_arms(stamp, roles)) == stamp)
print("reorders", m._format_arms(m._parse_arms("builder=opus master-review=fable")))
print("unparsed", [m._parse_arms(v) for v in ("", "builder", "builder=maybe", "planner=fable", "lead=fable",
                                              "builder=opus builder=fable")])
PY
)
while IFS= read -r line; do
  case "$line" in
    share-0\ *|share-1\ *) ;;
    share-*|independent-*) ok "${line#* }" ok "D: ${line%% *} (45 to 55% in Fable; each combination 20 to 30%)" ;;
  esac
done <<< "$out"
ok "$(grep -c '^share-[a-z]' <<< "$out")" 4 "D: four drawn roles measured"
ok "$(grep -c '^independent-' <<< "$out")" 2 "D: two pairs measured"
ok "$(grep '^share-0 ' <<< "$out")" "share-0 0" "D: a share of 0 draws none"
ok "$(grep '^share-1 ' <<< "$out")" "share-1 4000" "D: a share of 1 draws all"
ok "$(grep '^fixed ' <<< "$out")" "fixed True" "D: the draw is fixed by its inputs"
ok "$(grep '^refuses-' <<< "$out" | tr '\n' ' ')" "refuses-planner yes refuses-plan-judge yes " "D: the planner and the plan judge are never drawn"
ok "$(grep '^never-planned ' <<< "$out")" "never-planned ['builder', 'investigator', 'master-review']" "D: _task_arms never returns the planner, plan judge or lead"
ok "$(grep '^deep ' <<< "$out")" "deep {'master-review': 'fable', 'builder': 'fable'}" "D: work_depth deep draws the builder"
ok "$(grep '^cross ' <<< "$out")" "cross {'master-review': 'fable', 'builder': 'fable'}" "D: scope cross-cutting draws the builder"
ok "$(grep '^standard ' <<< "$out")" "standard {'master-review': 'fable', 'builder': 'none'}" "D: a standard single-file task's builder sits in no arm"
ok "$(grep '^read-only ' <<< "$out")" "read-only {'investigator': 'fable'}" "D: a read-only task draws only its investigator"
ok "$(grep '^unshared ' <<< "$out")" "unshared {'master-review': 'none', 'builder': 'none'}" "D: a role with no share sits in no arm"
ok "$(grep -c '^roundtrip True' <<< "$out")" 3 "D: a stamp parses and formats back to itself"
ok "$(grep '^reorders ' <<< "$out")" "reorders master-review=fable builder=opus" "D: the stamp is written in role order"
ok "$(grep '^unparsed ' <<< "$out")" "unparsed [None, None, None, None, None, None]" "D: an empty, bare, unknown-arm, planner, lead or repeated stamp does not parse"

echo "== M1. a first dispatch at share 1 stamps every role of the task's kind and prints the arms line"
ladder $'[share]\nmaster-review = 1\nbuilder = 1\ninvestigator = 1'
mkt m1 "scope: single-file" "work_depth: deep"
out=$(ms m1); rc=$?
ok "$rc" 0 "M1: exit 0"
ok "$(fm m1 arms)" "arms: master-review=fable builder=fable" "M1: the stamp, raw, in role order"
ok "$(armline m1 <<< "$out")" 'm1: arms {"master-review":"fable","builder":"fable"}' "M1: the arms line, compact JSON"
mkt m1r "scope: read-only"
ok "$(ms m1r | armline m1r)" 'm1r: arms {"investigator":"fable"}' "M1: a read-only task: its investigator alone"

echo "== M2. a stamped arm survives a re-dispatch at a different share"
ladder $'[share]\nmaster-review = 0\nbuilder = 0'
out=$(ms m1 --start restart)
ok "$(fm m1 arms)" "arms: master-review=fable builder=fable" "M2: the stamp is kept at share 0"
ok "$(armline m1 <<< "$out")" 'm1: arms {"master-review":"fable","builder":"fable"}' "M2: the same arms line"
noladder
ok "$(ms m1 --start restart | armline m1)" 'm1: arms {"master-review":"fable","builder":"fable"}' "M2: and with no ladder file at all"

echo "== M3. a resume draws, stamps and prints nothing, stamped or not"
ladder $'[share]\nmaster-review = 1\nbuilder = 1'
mkt m3 "scope: cross-cutting"
out=$(ms m3 --start resume)
ok "$(fm m3 arms)" "<none>" "M3: an unstamped note gets no arms: on a resume"
ok "$(armline m3 <<< "$out")" "<none>" "M3: and no arms line"
before=$(fm m1 arms)
out=$(ms m1 --start resume)
ok "$(fm m1 arms)" "$before" "M3: a stamped note keeps its stamp"
ok "$(armline m1 <<< "$out")" "<none>" "M3: a resume prints no arms line (it re-passes its own args)"

echo "== M4. a task begun before the draw (started:, no arms:) is stamped all none at its next fresh call"
mkt m4 "scope: cross-cutting" "started: 2026-11-12T09:00+11:00"
out=$(ms m4 --start revise)
ok "$(fm m4 arms)" "arms: master-review=none builder=none" "M4: a seeded revise of a task begun before the draw sits in no arm"
ok "$(armline m4 <<< "$out")" 'm4: arms {"master-review":"none","builder":"none"}' "M4: its arms line"
mkt m4b "scope: read-only" "started: 2026-11-12T09:00+11:00"
ok "$(ms m4b | armline m4b)" 'm4b: arms {"investigator":"none"}' "M4: a restart of a read-only task begun before the draw"

echo "== M5. hardness is read once, at the first stamp"
ladder $'[share]\nmaster-review = 1\nbuilder = 1'
mkt m5 "scope: single-file" "work_depth: standard"
ms m5 >/dev/null
ok "$(fm m5 arms)" "arms: master-review=fable builder=none" "M5: a builder share of 1, a standard single-file task: builder=none (not hard)"
python3 - "$V/m5.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write(t.replace("work_depth: standard", "work_depth: deep"))
PY
ok "$(fm m5 work_depth)" "work_depth: deep" "M5: the task made deep"
ok "$(ms m5 --start restart | armline m5)" 'm5: arms {"master-review":"fable","builder":"none"}' "M5: at the same share, a restart still prints builder none"
ok "$(fm m5 arms)" "arms: master-review=fable builder=none" "M5: and keeps the stamp"

echo "== M6. no [share] table: no stamp, no line, the note's bytes as with no ladder file"
mkdir -p "$TMP/v6a" "$TMP/v6b"
for d in v6a v6b; do printf -- '---\ntags: [task]\nstatus: in_progress\nscope: cross-cutting\nwork_depth: deep\n---\n\nbody\n' > "$TMP/$d/m6.md"; done
noladder
outa=$(python3 "$SCRIPT" mark-started --tasks m6 --tasks-dir "$TMP/v6a" --now "$NOW" 2>/dev/null)
ladder ''
outb=$(python3 "$SCRIPT" mark-started --tasks m6 --tasks-dir "$TMP/v6b" --now "$NOW" 2>/dev/null)
ok "$(sha "$TMP/v6b/m6.md")" "$(sha "$TMP/v6a/m6.md")" "M6: a ladder with no [share] writes the bytes no ladder writes"
ok "$(grep -c '^arms:' "$TMP/v6b/m6.md")" 0 "M6: no arms: line"
ok "$outb" "$outa" "M6: the same stdout, no arms line"
ladder $'[share]'
outc=$(python3 "$SCRIPT" mark-started --tasks m6 --tasks-dir "$TMP/v6b" --now "$NOW" --start restart 2>/dev/null)
ok "$(grep -c '^arms:' "$TMP/v6b/m6.md")" 0 "M6: an empty [share] table names no share either"

echo "== M7. --dry-run computes and prints the same, and writes nothing"
ladder $'[share]\nmaster-review = 1\nbuilder = 1'
mkt m7 "scope: cross-cutting"
before=$(sha "$V/m7.md")
out=$(ms m7 --dry-run)
ok "$(sha "$V/m7.md")" "$before" "M7: the note is unchanged"
ok "$(armline m7 <<< "$out")" 'm7: arms {"master-review":"fable","builder":"fable"}' "M7: the arms line a real run would print"

echo "== M8. a stamp that does not parse is kept, with one WARN and no line"
mkt m8 "scope: cross-cutting" "arms: builder=maybe"
out=$(ms m8 --start restart)
ok "$(fm m8 arms)" "arms: builder=maybe" "M8: kept as it is"
ok "$(armline m8 <<< "$out")" "<none>" "M8: no arms line (the call runs with no arms)"
ok "$(grep -c "^WARN: m8: arms: 'builder=maybe' does not parse" "$TMP/err")" 1 "M8: one WARN naming it"

echo "== M9. a refused ladder: nothing stamped, no line, one WARN for the run"
printf '[[rung]]\nname = "x"\n' > "$LADDER"
mkt m9a "scope: cross-cutting"; mkt m9b "scope: cross-cutting"
out=$(ms m9a,m9b); rc=$?
ok "$rc" 0 "M9: exit 0 (the lead halts on ladder.py first)"
ok "$(fm m9a arms)$(fm m9b arms)" "<none><none>" "M9: nothing stamped"
ok "$(grep -c ': arms ' <<< "$out")" 0 "M9: no arms line"
ok "$(grep -c '^WARN: mark-started: the ladder is refused' "$TMP/err")" 1 "M9: one WARN for the run"

echo "== R. record-entry stamps the lead's arm on the rollout note"
ent() { python3 "$SCRIPT" record-entry --rollout "$V/$1.md" --by stage --session S1 --now "$NOW" "${@:2}" 2>"$TMP/err"; }
rec() { python3 -c 'import json,sys; L=[json.loads(x) for x in open(sys.argv[1]) if x.strip()]; print(json.dumps([d for d in L if d["kind"]=="lead-entry"]))' "$THREAD_EVENTS_DIR/$1.jsonl"; }
mkro r1
ladder $'[share]\nlead = 1'
out=$(ent r1); rc=$?
ok "$rc" 0 "R1: exit 0"
ok "$(fm r1 arms)" "arms: lead=fable" "R1: the first entry at share 1 stamps lead=fable"
ok "$(grep -c '^r1: arms lead=fable (stamped)$' <<< "$out")" 1 "R1: and says so"
ok "$(grep -c '^r1: lead-entry by=stage$' <<< "$out")" 1 "R1: the entry's own line is unchanged"
ok "$(rec r1 | python3 -c 'import json,sys; print(["arm" in d for d in json.load(sys.stdin)])')" "[False]" "R1: the lead-entry line carries no arm"
ladder $'[share]\nlead = 0'
out=$(ent r1)
ok "$(fm r1 arms)" "arms: lead=fable" "R2: a later entry at share 0 keeps the stamp"
ok "$(grep -c 'arms' <<< "$out")" 0 "R2: and prints no arms line"
mkro r3
noladder
ent r3 >/dev/null
before=$(sha "$V/r3.md")
ok "$(fm r3 arms)" "<none>" "R3: with no ladder file, no stamp"
ladder ''
ent r3 >/dev/null
ok "$(sha "$V/r3.md")" "$before" "R3: with no [share] table, the rollout note is unchanged"
ladder $'[share]\nlead = 1'
out=$(ent r3)
ok "$(fm r3 arms)" "arms: lead=none" "R4: a rollout led before the share stood is stamped lead=none"
ok "$(grep -c '^r3: arms lead=none (stamped)$' <<< "$out")" 1 "R4: and says so"
mkro r5
ladder $'[share]\nmaster-review = 1'
ent r5 >/dev/null
ok "$(fm r5 arms)" "arms: lead=none" "R5: a share with no lead role stamps lead=none"
mkro r6
ladder $'[share]\nlead = 1'
before=$(sha "$V/r6.md")
ent r6 --dry-run >/dev/null
ok "$(sha "$V/r6.md")" "$before" "R6: --dry-run stamps nothing"

echo "== S. status reads the ladder as before: its share is mark-started's and record-entry's"
ladder $'[share]\nmaster-review = 1\nlead = 1'
ok "$(python3 "$SCRIPT" status --rollout "$V/ro.md" --tasks-dir "$V" --now "$NOW" 2>/dev/null \
  | python3 -c 'import json,sys; print(list(json.load(sys.stdin)["ladder"]))')" "['source', 'rungs', 'error']" \
  "S: status's ladder holds source, rungs and error, never the share"

echo "== F. (p52-2) the role-call fold of a doubled master review"
out=$(python3 - "$SCRIPT" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ladder = {"source": "x", "rungs": [{"name": "opus-xhigh", "model": "opus", "effort": "xhigh", "judge": "high", "review": "xhigh"}]}
args = {"task": {"arms": {"master-review": "opus", "builder": "fable"}}, "ladder": ladder}
def ran(label, model, effort):
    return {"label": label, "rung": "opus-xhigh", "model": model, "effort": effort}
def agent(label, model):
    return {"type": "workflow_agent", "label": label, "model": model, "tokens": 10}
def fold(rans, agents):
    row = {"status": "review", "ran": rans, "climbs": []}
    return {d["role"]: d for d in m._role_calls("wf_x", "task", (1794000000000, row, agents), args, {})}
a = fold([ran("implement:x", "fable", "high"), ran("first-review:x r1", "fable", "high"), ran("review:x r1", "opus", "xhigh")],
         [agent("first-review:x r1", "claude-fable-5-2"), agent("review:x r1", "claude-opus-5-5")])
print("roles", list(a))
fr = a["first-reviewer"]
print("first", fr["model"], fr["effort"], fr["dispatches"], "arm" in fr, fr.get("fellBack", False))
print("master-arm", "arm" in a["master-review"], "builder-arm", a["builder"].get("arm"))
b = fold([ran("first-review:x r1", "fable", "high"), ran("first-review:x r1 on-rung", "opus", "xhigh"), ran("review:x r1", "opus", "xhigh")], [])
fr = b["first-reviewer"]
print("rerun", fr["model"], fr["dispatches"], fr.get("fellBack", False))
c = fold([ran("review:x r1", "opus", "xhigh")], [])
print("single-arm", c["master-review"].get("arm"))
PY
)
ok "$(sed -n 1p <<< "$out")" "roles ['builder', 'first-reviewer', 'master-review']" "F1: the first reviewer folds as its own role, before the master review"
ok "$(sed -n 2p <<< "$out")" "first fable high 1 False False" "F1: its line: what it asked, no arm, not fell back"
ok "$(sed -n 3p <<< "$out")" "master-arm False builder-arm fable" "F1: the master-review line carries no arm (outside the draw); the builder keeps its own"
ok "$(sed -n 4p <<< "$out")" "rerun fable 2 True" "F2: a dead Fable first reviewer rerun on the rung: one line, model fable, 2 dispatches, fellBack"
ok "$(sed -n 5p <<< "$out")" "single-arm opus" "F3: control: an undoubled segment keeps the master review's arm"

echo "== P. (p46-3) the paced share: ceiling x the Login's pace, one fable-share line per draw"
ladder $'[share]\nmaster-review = 1'
# A slug whose master-review draw is Fable at a share of 1 and Opus at 0.5 (u in [0.5, 1)).
half=$(python3 - "$SCRIPT" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(next(s for s in ("p1-%d" % i for i in range(100)) if m._draw_arm("master-review", s, 0.5) == "opus"))
PY
)
quota 40 40
mkt "$half" "scope: single-file"
out=$(ms "$half"); rc=$?
ok "$rc" 0 "P1: exit 0"
ok "$(fm "$half" arms)" "arms: master-review=opus builder=none" "P1: an even store paces 0.5, so a slug Fable drew at 1 draws Opus"
ok "$(shares ro | tail -1)" '{"ceiling":{"master-review":1},"fable":40,"fetchedAt":"2026-11-13T09:50:00Z","general":40,"login":"login-a","pace":0.5,"share":{"master-review":0.5},"task":"'"$half"'"}' \
  "P1: its fable-share line: login, ceiling, share, pace and the reading"
ok "$(grep -c 'fable share' "$TMP/err")" 0 "P1: no WARN on a usable reading"
quota 0 50
ok "$(ms "$half" --start restart >/dev/null; fm "$half" arms)" "arms: master-review=opus builder=none" "P1: the stamp is kept at pace 1 on a later dispatch"

pcase() {  # pcase <n> <why> <setup>: a fresh task drawn at master-review = 1 under <setup>; prints arms|why|warns|rc
  mkt "p$1" "scope: single-file"
  local rc; out=$(eval "$3; ms p$1"); rc=$?
  printf '%s|%s|%s|%s\n' "$(fm "p$1" arms)" "$(shares ro | tail -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("why"), d["pace"], d["share"], "login" in d, "fable" in d)')" \
    "$(grep -c "^WARN: fable share: $2: every role draws Opus$" "$TMP/err")" "$rc"
}
ok "$(pcase 2 'no store' 'rm -f "$STORE"')" "arms: master-review=opus builder=none|no store 0.0 {'master-review': 0.0} True False|1|0" "P2: a missing store draws Opus, its why on the line, one WARN, exit 0"
ok "$(pcase 3 'stale (fable fetched 3h 0m ago)' 'quota 0 50 10800')" "arms: master-review=opus builder=none|stale (fable fetched 3h 0m ago) 0.0 {'master-review': 0.0} True False|1|0" "P3: a stale store draws Opus"
ok "$(pcase 4 'no Login' 'quota 0 50; unset CLAUDE_CODE_SESSION_ID')" "arms: master-review=opus builder=none|no Login 0.0 {'master-review': 0.0} False False|1|0" "P4: no session: no Login, Opus, no login on the line"
ok "$(pcase 5 'x' 'quota 100 40')" "arms: master-review=opus builder=none|None 0.0 {'master-review': 0.0} True True|0|0" "P5: a spent Fable window draws Opus with no why"
quota 0 50
mkro p6
ladder $'[share]\nlead = 1'
quota 40 40
n=$(shares p6 | wc -l | tr -d ' ')
python3 "$SCRIPT" record-entry --rollout "$V/p6.md" --by stage --session S1 --now "$NOW" >/dev/null 2>"$TMP/err"
ok "$(shares p6 | tail -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("task"), d["pace"], d["share"], d["login"])')" \
  "None 0.5 {'lead': 0.5} login-a" "P6: the lead's draw is paced, and its line has no task"
ok "$(( $(shares p6 | wc -l) - n ))" 1 "P6: one line"
ladder $'[share]\nmaster-review = 1'
mkt p7 "scope: single-file"
n=$(shares ro | wc -l | tr -d ' ')
ms p7 --dry-run >/dev/null
ok "$(shares ro | wc -l | tr -d ' ')" "$n" "P7: --dry-run writes no line"
mkt p8 "scope: single-file" "started: 2026-11-12T09:00+11:00"
ms p8 >/dev/null
ok "$(fm p8 arms)|$(shares ro | wc -l | tr -d ' ')" "arms: master-review=none builder=none|$n" "P8: a later dispatch's none stamp reads nothing and writes no line"
quota 0 50

echo "== A. (p46-3) a row's allowance stamps fell_back:; an allowance block is a Blocker diagnosis; status shows it"
rec_row() {  # rec_row <slug> <row json fields>: reconcile one task-mode row from in_progress; prints rc
  python3 -c 'import json, sys; d = {"slug": sys.argv[2], "rung": ""}; d.update(json.loads(sys.argv[3])); json.dump({"rolloutSlug": "ro", "tasks": [d]}, open(sys.argv[1], "w"))' \
    "$TMP/row-$1.json" "$1" "$2"
  python3 "$SCRIPT" reconcile --result "$TMP/row-$1.json" --tasks-dir "$V" --now "$NOW" >/dev/null 2>"$TMP/err"; echo $?
}
REVIEW='"status":"review","prUrl":"https://github.com/o/r/pull/9","reviewRoundsUsed":1'
mkt a1 "scope: cross-cutting"
ok "$(rec_row a1 '{'"$REVIEW"',"allowance":{"refused":["implement:a1"],"fellBack":2}}')" 0 "A1: exit 0"
ok "$(fm a1 fell_back)" "fell_back: $(fm a1 ready | cut -d' ' -f2)" "A1: fell_back: is the row's stamp (its ready: here)"
mkt a1b "scope: cross-cutting"
ok "$(rec_row a1b '{'"$REVIEW"',"allowance":{"refused":[],"fellBack":1}}')" 1 "A1: a malformed allowance exits 1"
ok "$(fm a1b fell_back)|$(grep -c '^ERROR: a1b: allowance is not null or an object' "$TMP/err")|$(fm a1b status)" "<none>|1|status: review" \
  "A1: one ERROR, nothing stamped, the rest of the row lands"
mkt a1c "scope: cross-cutting"
rec_row a1c '{'"$REVIEW"'}' >/dev/null
ok "$(fm a1c fell_back)" "<none>" "A1: a row with no allowance stamps nothing"
mkt a2 "scope: cross-cutting" "plan_approval: required"
rec_row a2 '{"status":"blocked","planRoundsUsed":2,"blockerDiagnosis":"allowance refusal — a dispatch on Fable died twice and its rerun on Opus died too.","allowance":{"refused":["plan:a2"],"fellBack":1}}' >/dev/null
ok "$(grep -c '^## Blocker diagnosis$' "$V/a2.md")|$(grep -c '^## Plan-blocked feedback$' "$V/a2.md")|$(fm a2 status)" "1|0|status: blocked" \
  "A2: an allowance block is a Blocker diagnosis, never plan feedback"
mkt a3 "scope: cross-cutting" "fell_back: 2026-11-12T09:00+11:00" "merged: 2026-11-12T10:00+11:00"
sed -i.bak 's/^status: in_progress$/status: done/' "$V/a3.md" && rm -f "$V/a3.md.bak"   # a landed task keeps its stamp
ok "$(python3 "$SCRIPT" status --rollout "$V/ro.md" --tasks-dir "$V" --now "$NOW" 2>/dev/null \
  | python3 -c 'import json,sys; t={r["slug"]: r.get("fellBack") for r in json.load(sys.stdin)["tasks"]}; print(t.get("a1") is not None, t.get("a2") is not None, t.get("a1c"), t.get("a3"))')" \
  "True True None None" "A3: status carries fellBack only on a stamped task that has not landed"

echo "== C. (p46-3) the role-call fold of a fell-back call"
out=$(python3 - "$SCRIPT" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ladder = {"source": "x", "rungs": [{"name": "opus-high", "model": "opus", "effort": "high", "judge": "medium", "review": "high", "plan": "fable"}]}
args = {"task": {}, "ladder": ladder}
def ran(label, model, effort, fell=False):
    d = {"label": label, "rung": "opus-high", "model": model, "effort": effort}
    if fell:
        d.update(asked={"model": "fable", "effort": "high"}, fellBack=True)
    return d
def agent(label, model, error=None):
    g = {"type": "workflow_agent", "label": label, "model": model, "tokens": 10}
    if error:
        g.update(state="error", error=error)
    return g
def fold(rans, agents):
    row = {"status": "review", "ran": rans, "climbs": []}
    return {d["role"]: d for d in m._role_calls("wf_x", "task", (1794000000000, row, agents), args, {})}
LIMIT = "You've reached your Fable limit. Run /usage-credits to continue or switch models with /model."
a = fold([ran("plan:x", "fable", "high"), ran("plan:x on-rung", "opus", "high", True), ran("plan-judge:x r1", "opus", "medium", True),
          ran("implement:x", "opus", "high"), ran("revise:x r2", "opus", "high", True)],
         [agent("plan:x", "claude-fable-5-1", LIMIT), agent("plan:x", "claude-fable-5-1", LIMIT), agent("plan:x on-rung", "claude-opus-5-5"),
          agent("plan-judge:x r1", "claude-opus-5-5")])
p, j, b = a["planner"], a["plan-judge"], a["builder"]
print("planner", p["model"], p["effort"], p["dispatches"], p.get("fellBack"), p.get("refused"))
print("judge", j["model"], j["effort"], j["models"], j.get("fellBack"), j.get("refused", False))
print("builder", b["model"], b.get("fellBack"), b.get("refused", False))
c = fold([ran("implement:x", "fable", "high"), ran("implement:x on-rung", "opus", "high", True)],
         [agent("implement:x", "claude-fable-5-1", "API Error: Connection closed mid-response"), agent("implement:x on-rung", "claude-opus-5-5")])
print("drop", c["builder"]["model"], c["builder"].get("fellBack"), c["builder"].get("refused", False))
PY
)
ok "$(sed -n 1p <<< "$out")" "planner fable high 2 True True" "C1: the planner that died on Fable: model fable, refused from the error text, fellBack"
ok "$(sed -n 2p <<< "$out")" "judge fable high ['claude-opus-5-5'] True False" "C2: a redirected plan judge reads its asked (fable/high), models the opus id, fellBack"
ok "$(sed -n 3p <<< "$out")" "builder opus True False" "C3: fellBack from a ran entry's flag alone (no journal agent)"
ok "$(sed -n 4p <<< "$out")" "drop fable True False" "C4: a connection drop gives fellBack without refused"

[ "$fail" = 0 ] && echo "PASS" || echo "FAILED"
exit "$fail"
