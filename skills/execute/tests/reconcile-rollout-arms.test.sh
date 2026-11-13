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
# HOME points at a temp dir holding each case's ~/.config/thread/ladder.toml. Temp dirs only.
# Usage: bash reconcile-rollout-arms.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME/.config/thread"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR
export THREAD_EVENTS_DIR="$TMP/events"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export THREAD_GIT_ENV_DIR="$TMP/git-env"
export THREAD_MACHINE_TIMES='{}'
V="$TMP/vault"; mkdir -p "$V" "$THREAD_EVENTS_DIR"
NOW=2026-11-13T10:00:00Z
LADDER="$HOME/.config/thread/ladder.toml"

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }

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
ladder $'[share]\nmaster-review = 1'
mkt m5 "scope: single-file" "work_depth: standard"
ms m5 >/dev/null
ok "$(fm m5 arms)" "arms: master-review=fable builder=none" "M5: a standard task first stamped with only a master-review share"
ladder $'[share]\nmaster-review = 1\nbuilder = 1'
python3 - "$V/m5.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write(t.replace("work_depth: standard", "work_depth: deep"))
PY
ok "$(ms m5 --start restart | armline m5)" 'm5: arms {"master-review":"fable","builder":"none"}' "M5: a builder share added and the task made deep: still builder=none"

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

[ "$fail" = 0 ] && echo "PASS" || echo "FAILED"
exit "$fail"
