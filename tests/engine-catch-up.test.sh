#!/usr/bin/env bash
# The Engine catch-up (ADR 0084 d5, p54-14): reconcile-rollout.py `catch-up` (the drain rule, its docstring), `next`'s
# drain and bound, engine-snapshot.py's move rule rows and adopt's catch-up branch (its header: the Catch-up log),
# clear-pause's backstop, record-entry --by catch-up and the verifier restamp.
#   CU2-CU5  the drain rule, read dry from the snapshot: an ordinary merge, another repo's Speed fix skipped silently
#            (a pr: URL, a bare #N through its rollout's Project root), a merge_commit: outside S..G, a tests-only one
#            (tests/, and skills/*/tests/), a true merge matched by its subject, a phase's drain with an unmarked
#            docs-only release (a), none once the phase's engine fixes are in S (b) or none of them touches engine
#            paths (c), and a drained phase's second fix (a take with nothing running, none with a row running)
#   CU1      the drain end to end: the stamps and the line, next starts nothing and halts catch-up once drained, resolve
#            due, cut and adopt (moved, the Notes line, verifier restamped), record-entry --by catch-up, clear-pause,
#            then next starts the queued row on the new snapshot (resolve's not due once moved is M1's, engine-snapshot)
#   CU12     a turn lost between adopt and clear-pause: another cut's adopt takes the Reinstate branch, no second moved
#   CU6      the bound: past 160 min with a row running, the stamps go, a bound line, rows start on the old snapshot;
#            then a take with nothing running
#   CU7      a serial chain: a take line only, due with no Leg open (resolve too), redone after a lost turn, never
#            with a Leg open; cut and adopt move it (no verifier WARN: a serial note has no stamp) and the next Leg
#            begins there
#   CU8      the Run record's catch-up lines; CU9 --abort, and adopt's exit 5 at S; CU9b no churn; CU10 the verifier
#            reader (prose and a fence ignored, two lines or an unsafe command kept); CU11 his pause wins: over an open
#            catch-up, a stale one (both stamps gone, or only pause_requested: paused_for dangling), and a move made
#            (adopt's moved, its turn lost: --abort still removes the stamps, so moving and status read his pause)
# Hermetic: HOME, the global git config, the vault, the events dir and the locks are temp; the engine origin is a local
# bare repo at $T/srv/fx/engine.git (its key fx/engine) seeded from this tree's files (tracked and new, never ignored),
# so nothing reaches the network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
. tests/lib/rollout-fixtures.sh   # away_file
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID XDG_STATE_HOME GIT_SSH_COMMAND
root=$(pwd -P)

T=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
T=$(cd "$T" && pwd -P)
trap 'chmod -R u+rwX "$T" 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$T/events}"   # the Run record (run_record.py) stays in temp
export THREAD_NOTE_LOCK_DIR="$T/note-locks" THREAD_GIT_ENV_DIR="$T/git-env" THREAD_LEG_LOCK_DIR="$T/leg-locks"
export THREAD_VERIFY_SLOTS_DIR="$T/verify-slots" TMPDIR="$T/tmp"
export THREAD_HEAT_LEVEL=0 THREAD_MACHINE_TIMES='{}'   # the Heat hold and the Mac's boot and sleeps, pinned
mkdir -p "$TMPDIR" "$T/bin"
printf '#!/bin/sh\necho "gh $*" >> "%s/gh.log"\nexit 1\n' "$T" > "$T/bin/gh"; chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH"
TASKS="$HOME/repos/obsidian/Work/Tasks"; mkdir -p "$TASKS/Archive/Rollouts"
NOW=2026-11-18T10:00:00Z
away_file "$HOME" 2026-11-18T00:00:00Z true 2099-01-01T00:00:00Z 9

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
# es <root> <verb> [args...] → $out $err $rc: that root's engine-snapshot.py
es() { local r="$1"; shift; python3 "$r/skills/_shared/scripts/engine-snapshot.py" "$@" > "$T/out" 2> "$T/err"; rc=$?
  out=$(cat "$T/out"); err=$(cat "$T/err"); }
# rr <root> <verb> [args...] → $out $err $rc: that root's reconcile-rollout.py
rr() { local r="$1"; shift; python3 "$r/skills/execute/scripts/reconcile-rollout.py" "$@" > "$T/out" 2> "$T/err" < /dev/null
  rc=$?; out=$(cat "$T/out"); err=$(cat "$T/err"); }
# cu <root> <note> [args...]: catch-up on $TASKS/<note>.md at $NOW (a later --now wins)
cu() { local r="$1" n="$2"; shift 2; rr "$r" catch-up --rollout "$TASKS/$n.md" --tasks-dir "$TASKS" --now "$NOW" "$@"; }
# j <python expr over d>: a field of the JSON on $out (else its last line's) (strings bare, the rest as JSON)
j() { printf '%s' "$out" | python3 -c 'import json, sys
try:
    t = sys.stdin.read()
    try:
        d = json.loads(t)
    except ValueError:
        d = json.loads(t.strip().split("\n")[-1])
    v = eval(sys.argv[1], {"d": d})
except Exception as e:
    print("<%s>" % type(e).__name__); sys.exit(0)
print(v if isinstance(v, str) else json.dumps(v))' "$1"; }
fmv() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$TASKS/$1.md" "$2"; }
setfm() { python3 - "$TASKS/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
head, rest = open(p).read().split("\n---\n", 1)
lines = [l for l in head.split("\n") if not re.match(rf"^{re.escape(k)}:", l)]
if v != "-":
    lines.append(f"{k}: {v}")
open(p, "w").write("\n".join(lines) + "\n---\n" + rest)
PY
}
log() { sed -n '/^## Catch-up log$/,/^## /p' "$TASKS/$1.md" | grep '^- ' ; }

# seed <dir>: this tree's plugin files, tracked and new (never ignored), as they are on disk; no __pycache__.
seed() {
  local d="$1"
  mkdir -p "$d"
  git -C "$root" ls-files -z --cached --others --exclude-standard -- skills hooks .claude-plugin .gitattributes \
    | (cd "$root" && python3 -c 'import os, shutil, sys
for p in sys.stdin.buffer.read().split(b"\0"):
    p = p.decode()
    if not p or not os.path.isfile(p) or "__pycache__" in p.split("/"):
        continue
    dst = os.path.join(sys.argv[1], p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(p, dst)' "$d")
}

# The engine origin (key fx/engine), its writer W, the Primary P and its snapshots home H; full-suite.yml publishes a
# Green tip, and the record verifies each commit grec names (no GitHub slug: gh is never asked).
ORIGIN="$T/srv/fx/engine.git"; W="$T/work"
git init -q --bare -b master "$ORIGIN"; git clone -q "$ORIGIN" "$W" 2>/dev/null
seed "$W"; mkdir -p "$W/.github/workflows"
printf 'jobs:\n  green-tip:\n    name: publish the Green tip\n    env:\n      GREEN_REF: refs/thread/green\n' > "$W/.github/workflows/full-suite.yml"
git -C "$W" add -A; git -C "$W" commit -qm v1; git -C "$W" push -q origin master
tip() { git --git-dir "$ORIGIN" rev-parse refs/heads/master; }
REC="$HOME/.local/state/thread/green-tip.json"
grec() { mkdir -p "$(dirname "$REC")"; python3 - "$REC" "$ORIGIN" "$@" <<'PY'
import json, sys
f, key, shas = sys.argv[1], sys.argv[2], sys.argv[3:]
json.dump({"v": 1, "repos": {key: {"verified": [{"sha": x, "at": "2026-11-18T08:00:00+00:00", "by": "test"} for x in shas],
                                   "unverified": []}}}, open(f, "w"))
PY
}
# green <sha>...: refs/thread/green at the last sha, every sha recorded verified
green() { local last; for last; do :; done; git --git-dir "$ORIGIN" update-ref refs/thread/green "$last"; grec "$@"; }
# c <subject> <path>: one commit on origin's master adding <path>
c() { mkdir -p "$(dirname "$W/$2")"; echo "$1" > "$W/$2"; git -C "$W" add -A; git -C "$W" commit -qm "$1"; git -C "$W" push -q origin master
  tip; }
V1=$(tip); green "$V1"
mkdir -p "$T/tools"; git clone -q "$ORIGIN" "$T/tools/engine"; P="$T/tools/engine"; H="$T/tools/engine-snapshots"
es "$P" cut --tasks-dir "$TASKS"; S=$(j 'd["snapshot"]'); S12=${V1:0:12}
ok "$rc|$(j 'd["sha"]')|$S" "0|$V1|$H/$S12" "setup: S cut at V1, the Green tip"
C1=$(c "feat: one (#101)" skills/new/c1.py)
C2=$(c "test: two (#102)" tests/c2.test.sh)
git -C "$W" checkout -q -b b; echo c3 > "$W/skills/new/c3.py"; git -C "$W" add -A; git -C "$W" commit -qm "branch work"
git -C "$W" checkout -q master; git -C "$W" merge -q --no-ff b -m "Merge pull request #103 from x/b"; git -C "$W" push -q origin master
C3=$(tip)
C4=$(c "docs: four (#104)" docs/c4.md)
C5=$(c "feat: five (#105)" skills/new/c5.py)
C6=$(c "feat: six (#106)" skills/new/c6.py)
C7=$(c "test: seven (#107)" skills/execute/tests/x.test.sh)
G=$C7; G12=${G:0:12}; green "$V1" "$G"

# The Project roots: proj (a clone; CLAUDE.md on origin's master: prose naming the line, a fenced one, one real line),
# proj2 (two real lines) and proj3 (an unsafe command) in their working trees only; oproj, another repo's root.
git init -q --bare -b master "$T/psrv/proj.git"; git clone -q "$T/psrv/proj.git" "$T/proj" 2>/dev/null
printf '# proj\n\nRead the `Verifier:` line below.\n\n```\nVerifier: `make demo`\n```\n\nVerifier: `make test-new`\nCompletion verifier: `make test`\n' > "$T/proj/CLAUDE.md"
git -C "$T/proj" add -A; git -C "$T/proj" commit -qm p; git -C "$T/proj" push -q origin master; git -C "$T/proj" fetch -q
mkdir -p "$T/proj2" "$T/proj3" "$T/oproj"
printf 'Verifier: `make a`\n- Verifier: `make b`\n' > "$T/proj2/CLAUDE.md"
printf "Verifier: \`x ' y \" z\`\n" > "$T/proj3/CLAUDE.md"
git init -q "$T/oproj"; git -C "$T/oproj" remote add origin https://github.com/other/proj.git

MARK='speed_fix: "docs/audits/test-suite-audit-2026-11-16.md row 2"'
PRU=https://github.com/fx/engine/pull
# unit <stem> <pr|-> <marked|-> [frontmatter line]...: a landed task note of rollout $UROLL (default fx-old, no note),
# never a row of a rollout read here
unit() { local s="$1" pr="$2" mk="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: done\nrollout: "[[%s]]"\n' "${UROLL:-fx-old}"; [ "$pr" = - ] || printf 'pr: %s\n' "$pr"
    [ "$mk" = - ] || printf '%s\n' "$MARK"; local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nA unit.\n'; } > "$TASKS/$s.md"; }
units() { rm -f "$TASKS"/fx-p*.md; }
# pro <name> <snap> <sha> [frontmatter line]...: a parallel rollout, stamped, Project root $PROOT (default proj),
# queue [[<name>-t1]], [[<name>-t2]], [[<name>-t3]], then $BODY; row <slug> <rollout> <status> [line]...: one of its
# task notes
pro() { local n="$1" s="$2" h="$3"; shift 3
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nengine_snapshot: "%s"\nengine_sha: %s\n' "$s" "$h"
    local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n- [[%s-t1]]\n- [[%s-t2]]\n- [[%s-t3]]\n\n%s' "${PROOT:-$T/proj}" "$n" "$n" "$n" \
      "${BODY:-}"; } > "$TASKS/$n.md"; }
row() { local s="$1" r="$2" st="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\n' "$st" "$r"; local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nA row.\n'; } > "$TASKS/$s.md"; }
rows() { row "$1-t1" "$1" "$2"; row "$1-t2" "$1" open; }   # rows <rollout> <t1's status>
rec() { cat "$THREAD_EVENTS_DIR/$1.jsonl" 2>/dev/null; }

# ════ CU2-CU5: the drain rule, dry, from S ══════════════════════════════════════════════════════════════════════
echo "== CU2-CU5"
pro cud "$S" "$V1"; rows cud open
# dec <label> <expect kind|due> [note]: one dry reading of [[cud]] (or <note>) from S
dec() { cu "${3:-$S}" "${4:-cud}" --dry-run; ok "$rc|$(j 'd["kind"]')|$(j 'd["due"]')" "0|$2" "$1"; }
units; unit fx-p9-1-a "$PRU/106" -
dec "CU2: an ordinary merge (an unmarked unit's commit under skills/) → none" "none|false"
units; unit fx-p9-1-a https://github.com/other/proj/pull/105 marked
dec "CU3: a marked unit whose pr: is another repo's → none" "none|false"
ok "$(j 'd["skipped"]')" "[]" "CU3: … skipped silently: no skipped row (another repo's Speed fix is the ordinary case)"
units; unit fx-p9-1-a "$PRU/105" marked "merge_commit: $V1"
dec "CU3: a marked unit whose merge_commit: is outside S..G → none (its pr: never read)" "none|false"
printf -- '---\ntags: [task, rollout]\nstatus: done\nprotocol_version: 5\n---\n\n## Notes\n\nProject root: `%s`\n' "$T/oproj" > "$TASKS/fx-oth.md"
units; UROLL=fx-oth unit fx-p9-1-a '"#105"' marked
dec "CU3b: a bare pr: #105 whose rollout's Project root origin is other/proj → none" "none|false"
ok "$(j 'd["skipped"]')" "[]" "CU3b: … skipped silently: no skipped row"
units; unit fx-p9-1-a "$PRU/102" marked
dec "CU4: a marked unit whose commit is tests/ only → none" "none|false"
units; unit fx-p9-1-a "$PRU/107" marked
dec "CU4c: a marked unit whose commit is skills/execute/tests/ only → none" "none|false"
units; unit fx-p8-1-m "$PRU/103" marked
dec "CU4b: a true merge, no merge_commit:, matched by its subject: its one-member phase drains" "drain|true"
ok "$(j 'd["release"]')|$(j 'd["fixes"]')|$(j 'd["green12"]')|$(j 'd["from12"]')" \
   "[{\"release\": \"fx-p8-1-m\", \"phase\": \"p8\"}]|[\"fx-p8-1-m\"]|$G12|$S12" "CU4b: … the release, the fix, at G from S"
ok "$(fmv cud pause_requested)|$(grep -c '^## Catch-up log' "$TASKS/cud.md")" "<none>|0" "CU4b: … --dry-run wrote nothing"
units; unit fx-p9-1-a "$PRU/101" marked; unit fx-p9-2-r "$PRU/104" -
dec "CU-a: marked c1 with an unmarked docs-only release c4 → drain" "drain|true"
ok "$(j 'd["release"][0]["release"]')|$(j 'd["fixes"]')" 'fx-p9-2-r|["fx-p9-1-a"]' "CU-a: … drain [[fx-p9-2-r]] for [[fx-p9-1-a]]"
es "$P" cut --at "$C1" --tasks-dir "$TASKS"; SC1=$(j 'd["snapshot"]')
pro cudb "$SC1" "$C1"; rows cudb open
units; unit fx-p9-1-a "$PRU/101" marked; unit fx-p9-1b-t "$PRU/102" marked; unit fx-p9-2-r "$PRU/104" -
dec "CU-b: engine_sha at c1, c2 marked too: every engine fix of the phase in S → none" "none|false" "$SC1" cudb
units; unit fx-p9-1b-t "$PRU/102" marked; unit fx-p9-2-r "$PRU/104" -
dec "CU-c: R in S..G, the phase's only marked member tests-only → none" "none|false"
units; unit fx-p9-1-a "$PRU/101" marked; unit fx-p9-1c-b "$PRU/105" marked; unit fx-p9-2-r "$PRU/104" -
BODY=$'## Catch-up log\n\n- 2026-11-18T07:00+00:00 drain [[fx-p9-2-r]] (p9) at '"$G12"' from '"$S12"$': [[fx-p9-1-a]]\n- 2026-11-18T09:40+00:00 bound [[fx-p9-2-r]] after 160 min: on '"$S12"$'\n' \
  pro cud5 "$S" "$V1"; rows cud5 open
dec "CU5: a drained phase's second engine fix, nothing running → take" "take|true" "$S" cud5
ok "$(j 'd["fixes"]')" '["fx-p9-1-a", "fx-p9-1c-b"]' "CU5: … the lacking engine fixes"
rows cud5 in_progress
dec "CU5: … with a row in_progress → no take" "take|false" "$S" cud5
has "$(j 'd["why"]')" "a take waits for a moment with nothing running" "CU5: … saying why"

# ════ CU1 (and CU10's reader): a drain, end to end ══════════════════════════════════════════════════════════════
echo "== CU1"
units; unit fx-p9-1-a "$PRU/101" marked; unit fx-p9-2-r "$PRU/104" -
pro cu1 "$S" "$V1" "verifier: make old"; rows cu1 in_progress
cu "$S" cu1
ok "$rc|$(j 'd["kind"]')|$(j 'd["due"]')|$(fmv cu1 pause_requested)|$(fmv cu1 paused_for)" "0|drain|true|true|catch-up" \
   "CU1: catch-up stamps pause_requested and paused_for: catch-up"
ok "$(log cu1)" "- 2026-11-18T10:00+00:00 drain [[fx-p9-2-r]] (p9) at $G12 from $S12: [[fx-p9-1-a]]" "CU1: … and its drain line"
cu "$S" cu1 --now 2026-11-18T10:05:00Z
ok "$rc|$(j 'd["due"]')|$(log cu1 | wc -l | tr -d ' ')" "0|false|1" "CU1: … a second read: the open catch-up is live, nothing new"
rr "$S" next --rollout "$TASKS/cu1.md" --tasks-dir "$TASKS" --now 2026-11-18T10:10:00Z
ok "$rc|$(j 'd["start"]')|$(j 'd["hold"]')|$(j 'd["halt"]')" \
   '0|[]|[{"slug": "cu1-t2", "reason": "catch-up: draining (an Engine catch-up)"}]|null' "CU1: next with a row running starts nothing"
has "$(rec cu1)" '"reason":"catch-up-drain"' "CU1: … its idle Slots read catch-up-drain"
setfm cu1-t1 status done
rr "$S" next --rollout "$TASKS/cu1.md" --tasks-dir "$TASKS" --now 2026-11-18T10:20:00Z
ok "$rc|$(j 'd["halt"]')|$(fmv cu1 paused)|$(fmv cu1 paused_for)|$(fmv cu1 pause_requested)" \
   "0|catch-up|2026-11-18T10:20+00:00|catch-up|<none>" "CU1: drained: next stamps paused:, keeps paused_for and halts catch-up"
has "$(rec cu1 | grep '"kind":"paused"')" '"mode":"catch-up"' "CU1: … the record's paused line, mode catch-up"
es "$P" resolve --rollout "$TASKS/cu1.md"
ok "$rc|$(j 'd["move"]["due"]')|$(j 'd["move"]["why"]')" "0|true|an Engine catch-up drained: the lead's own move (ADR 0084 d5)" \
   "CU1: resolve: due, the catch-up why"
es "$P" cut --tasks-dir "$TASKS"; N=$(j 'd["snapshot"]')
ok "$rc|$(j 'd["sha"]')" "0|$G" "CU1: the cut is at the Green tip"
es "$N" adopt --rollout "$TASKS/cu1.md" --now 2026-11-18T10:25:00Z
ok "$rc|$(j 'd["from"]')|$(fmv cu1 engine_sha)" "0|$V1|$G" "CU1: adopt from the new snapshot moves the note"
has "$(cat "$TASKS/cu1.md")" "- 2026-11-18T10:25+00:00 engine snapshot moved at catch-up: $S12 → $G12 (ADR 0084 d5)" "CU1: … the Notes line"
ok "$(log cu1 | tail -1)" "- 2026-11-18T10:25+00:00 moved $S12 → $G12 (drain 20 min)" "CU1: … the log ends moved, the drain's minutes"
ok "$(fmv cu1 verifier)|$(grep -c 'verifier restamped: make old → make test-new' "$TASKS/cu1.md")|$err" "make test-new|1|" \
   "CU10: … verifier: restamped from origin's CLAUDE.md (prose and a fenced line ignored), a Notes line, no WARN"
cp "$TASKS/cu1.md" "$T/cu1.lost"   # CU12's lost turn: here, before record-entry and clear-pause
rr "$N" record-entry --rollout "$TASKS/cu1.md" --by catch-up --session s1 --now 2026-11-18T10:26:00Z
ok "$rc|$(rec cu1 | tail -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["kind"], d["by"], d.get("stop"))')" \
   "0|lead-entry catch-up catch-up" "CU1: record-entry --by catch-up: {by: catch-up, stop: catch-up}"
rr "$N" clear-pause --rollout "$TASKS/cu1.md" --tasks-dir "$TASKS"
ok "$rc|$(fmv cu1 paused)|$(fmv cu1 pause_requested)|$(fmv cu1 paused_for)|$(log cu1 | tail -1 | cut -c26-30)" \
   "0|<none>|<none>|<none>|moved" "CU1: clear-pause: no stamp left, no line after moved"
rr "$N" next --rollout "$TASKS/cu1.md" --tasks-dir "$TASKS" --now 2026-11-18T10:30:00Z
ok "$rc|$(j 'd["start"]')|$(j 'd["halt"]')" '0|["cu1-t2"]|null' "CU1: next from N starts the queued row"
setfm cu1-t2 status done

# ════ CU8, CU9: the record, --abort, adopt's exit 5 ═════════════════════════════════════════════════════════════
echo "== CU8-CU9"
ok "$(rec cu1 | python3 -c 'import json,sys
for l in sys.stdin:
    d = json.loads(l)
    if d["kind"] == "catch-up":
        print(d["outcome"], d["shape"], d["from"][:12], d["to"][:12], d["release"], d["fixes"], d["drainMinutes"])')" \
   "moved parallel $S12 $G12 fx-p9-2-r ['fx-p9-1-a'] 20" "CU8: the record's catch-up line {from, to, fixes, release, drainMinutes, shape, outcome}"
pro cu9 "$S" "$V1"; rows cu9 open
cu "$S" cu9; rr "$S" next --rollout "$TASKS/cu9.md" --tasks-dir "$TASKS"
ok "$(j 'd["halt"]')|$(fmv cu9 paused_for)" "catch-up|catch-up" "CU9: a drain with nothing running drains at once"
cp "$TASKS/cu9.md" "$T/cu9.before"
es "$S" adopt --rollout "$TASKS/cu9.md"
ok "$rc|$out" "5|" "CU9: adopt from S itself (the cut landed at S) → exit 5"
cmp -s "$TASKS/cu9.md" "$T/cu9.before"; ok "$?" 0 "CU9: … nothing written"
cu "$S" cu9 --abort --why "cut exit 3: no Green tip"
ok "$rc|$(fmv cu9 paused)|$(fmv cu9 pause_requested)|$(fmv cu9 paused_for)" "0|<none>|<none>|<none>" "CU9: --abort removes the stamps"
ok "$(log cu9 | tail -1)" "- 2026-11-18T10:00+00:00 not moved at $G12: cut exit 3: no Green tip" "CU9: … closes the line, not moved"
ok "$(rec cu9 | tail -2 | python3 -c 'import json,sys; print(" ".join(json.loads(l)["kind"] + ":" + json.loads(l).get("outcome", "-") for l in sys.stdin))')" \
   "resumed:- catch-up:not-moved" "CU9: … emits resumed, then catch-up not-moved"
cu "$S" cu9 --abort --why again
ok "$rc|$(log cu9 | wc -l | tr -d ' ')" "0|2" "CU9: a second --abort: no open line, nothing written"
# ════ CU12: a turn lost between adopt and clear-pause ═══════════════════════════════════════════════════════════
echo "== CU12"
sed 's/cu1-t/cu12-t/g' "$T/cu1.lost" > "$TASKS/cu12.md"; rows cu12 done
es "$P" cut --at "$C6" --tasks-dir "$TASKS"; N2=$(j 'd["snapshot"]')
es "$N2" adopt --rollout "$TASKS/cu12.md" --now 2026-11-18T11:00:00Z
ok "$rc|$(j 'd["from"]')|$(grep -c 'moved at reinstate' "$TASKS/cu12.md")|$(log cu12 | grep -c '^- [^ ]* moved ')" "0|$G|1|1" \
   "CU12: another cut's adopt takes the Reinstate branch: at reinstate, no second moved line"
rr "$N2" clear-pause --rollout "$TASKS/cu12.md" --tasks-dir "$TASKS"
ok "$rc|$(fmv cu12 paused_for)|$(log cu12 | wc -l | tr -d ' ')" "0|<none>|2" "CU12: clear-pause clears it, no catch-up line"

# ════ CU6: the bound ════════════════════════════════════════════════════════════════════════════════════════════
echo "== CU6"
pro cu6 "$S" "$V1"; rows cu6 in_progress
cu "$S" cu6
ok "$(j 'd["kind"]')" drain "CU6: a drain with a row running"
rr "$S" next --rollout "$TASKS/cu6.md" --tasks-dir "$TASKS" --now 2026-11-18T12:39:00Z
ok "$(j 'd["start"]')|$(fmv cu6 paused_for)" "[]|catch-up" "CU6: at 159 min the drain holds"
rr "$S" next --rollout "$TASKS/cu6.md" --tasks-dir "$TASKS" --now 2026-11-18T12:41:00Z
ok "$rc|$(j 'd["start"]')|$(fmv cu6 pause_requested)|$(fmv cu6 paused_for)|$(fmv cu6 engine_sha)" "0|[\"cu6-t2\"]|<none>|<none>|$V1" \
   "CU6: past 160 min with a row running: the stamps go and rows start on the old snapshot"
ok "$(log cu6 | tail -1)" "- 2026-11-18T12:41+00:00 bound [[fx-p9-2-r]] after 161 min: on $S12" "CU6: … a bound line"
has "$(rec cu6)" '"outcome":"bound"' "CU6: … the record's catch-up line, outcome bound"
setfm cu6-t1 status done; setfm cu6-t2 status done; row cu6-t3 cu6 open
cu "$S" cu6 --now 2026-11-18T13:00:00Z
ok "$rc|$(j 'd["kind"]')|$(j 'd["due"]')|$(fmv cu6 paused_for)" "0|take|true|catch-up" "CU6: then, nothing running: a take"
cu "$S" cu6 --abort --why "a test's end"; setfm cu6-t3 status done

# ════ CU7: a serial chain ═══════════════════════════════════════════════════════════════════════════════════════
echo "== CU7"
mkdir -p "$T/launch"
LOG='## Leg log

- 2026-11-18T08:00+00:00 Leg 1 began: leg-1 session s1 in cc-demo from '"$T/launch"'
'
sro() { local n="$1" x="${SURF:-ext:x}"; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprojects:\n  - "[[Demo]]"\nprotocol_version: 5\n'
    local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- 'shape: serial\nsurfaces:\n  - "%s"\n---\n\n## Notes\n\nA chain.\n\n## Queue\n\n' "$x"
    printf -- '| # | Task | Launch | Surfaces |\n|---|---|---|---|\n| 1 | [[%s-t1\\|%s-t1]] | `cc-demo` from `%s` | `%s` |\n' "$n" "$n" "$T/launch" "$x"
    printf -- '\n## Post-rollout\n\nRollout-specific items go here:\n\n\n%s' "${BODY:-}"; } > "$TASKS/$n.md"
  printf -- '---\ntags: [task]\nstatus: open\nprojects:\n  - "[[Demo]]"\nrollout: "[[%s]]"\n---\n\n## Notes\n\nDo it.\n' "$n" > "$TASKS/$n-t1.md"; }
SURF=ext:o BODY="$LOG" sro cu7o "engine_snapshot: \"$S\"" "engine_sha: $V1"
cu "$S" cu7o
ok "$rc|$(j 'd["due"]')|$(grep -c '^## Catch-up log' "$TASKS/cu7o.md")" "0|false|0" "CU7: a Leg open (began last) → not due, nothing written"
es "$P" resolve --rollout "$TASKS/cu7o.md"; ok "$(j 'd["move"]["due"]')" false "CU7: … resolve not due"
BODY="$LOG- 2026-11-18T08:30+00:00 Leg 1 closed: handoff to Leg 2 in cc-demo from $T/launch
" sro cu7 "engine_snapshot: \"$S\"" "engine_sha: $V1"
cu "$S" cu7
ok "$rc|$(j 'd["kind"]')|$(j 'd["due"]')|$(fmv cu7 paused_for)|$(fmv cu7 pause_requested)" "0|take|true|<none>|<none>" \
   "CU7: no Leg open → a take, no pause stamp"
ok "$(log cu7)" "- 2026-11-18T10:00+00:00 take at $G12 from $S12: [[fx-p9-1-a]]" "CU7: … its take line"
cu "$S" cu7 --now 2026-11-18T10:10:00Z
ok "$rc|$(j 'd["due"]')|$(log cu7 | wc -l | tr -d ' ')" "0|true|1" "CU7: a repeat before the move: due, nothing new written"
es "$P" resolve --rollout "$TASKS/cu7.md"
ok "$(j 'd["move"]["due"]')|$(j 'd["move"]["why"]')" "true|an Engine catch-up's take: this Leg begin moves the chain" "CU7: resolve: due"
es "$N" adopt --rollout "$TASKS/cu7.md" --now 2026-11-18T10:15:00Z
ok "$rc|$(j 'd["from"]')|$(log cu7 | tail -1)|$err" "0|$V1|- 2026-11-18T10:15+00:00 moved $S12 → $G12 (take)|" \
   "CU7: cut and adopt move the chain: moved (take), and no verifier WARN (a serial note has no stamp to restamp)"
(cd "$T/launch" && python3 "$N/skills/execute/scripts/leg.py" begin --rollout "$TASKS/cu7.md" --tasks-dir "$TASKS" --session s2 \
   --now 2026-11-18T10:16:00+00:00 > "$T/out" 2> "$T/err"); rc=$?
ok "$rc" 0 "CU7: leg.py begin from N passes the guard"; hasnt "$(cat "$T/err")" "engine-snapshot:" "CU7: … no engine-snapshot: line"
es "$N" resolve --rollout "$TASKS/cu7.md"; ok "$(j 'd["move"]["due"]')" false "CU7: … Leg 2 began → not due"
has "$(rec cu7 | grep '"kind":"catch-up"')" '"shape":"serial","outcome":"moved"' "CU8: the serial move's catch-up line"

# ════ CU10: the verifier reader's WARNs (a plain Reinstate's move) ══════════════════════════════════════════════
echo "== CU10"
PROOT="$T/proj2" pro cu10a "$S" "$V1" "paused: 2026-11-18T09:00+00:00" "verifier: make keep"; rows cu10a done
es "$N" adopt --rollout "$TASKS/cu10a.md"
ok "$rc|$(fmv cu10a verifier)" "0|make keep" "CU10: two real Verifier: lines → the stamp kept"
has "$err" "WARN: verifier not restamped: $T/proj2/CLAUDE.md has 2 \`Verifier:\` lines" "CU10: … with a WARN"
PROOT="$T/proj3" pro cu10b "$S" "$V1" "paused: 2026-11-18T09:00+00:00" "verifier: make keep"; rows cu10b done
es "$N" adopt --rollout "$TASKS/cu10b.md"
ok "$rc|$(fmv cu10b verifier)" "0|make keep" "CU10: an unsafe command → the stamp kept"
has "$err" "cannot be stamped bare" "CU10: … with a WARN"

# ════ CU11: his pause ═══════════════════════════════════════════════════════════════════════════════════════════
echo "== CU11"
units; unit fx-p9-1-a "$PRU/101" marked; unit fx-p9-2-r "$PRU/104" -
pro cu11 "$S" "$V1" "verifier: make old"; rows cu11 in_progress
cu "$S" cu11
cu "$S" cu11 --abort --why "his pause"
setfm cu11 pause_requested true; setfm cu11-t1 status done
rr "$S" next --rollout "$TASKS/cu11.md" --tasks-dir "$TASKS"
ok "$(j 'd["halt"]')|$(fmv cu11 paused_for)|$(log cu11 | tail -1 | cut -c26-)" "paused|<none>|not moved at $G12: his pause" \
   "CU11a: --abort closes the drain; his soft pause drains to paused"
es "$P" resolve --rollout "$TASKS/cu11.md"
ok "$(j 'd["move"]["why"]')" "a hard pause: this /thread:execute is its Reinstate" "CU11a: … resolve reads a Reinstate"
es "$N" adopt --rollout "$TASKS/cu11.md"
ok "$rc|$(grep -c 'moved at reinstate' "$TASKS/cu11.md")|$(log cu11 | grep -c '^- [^ ]* moved ')|$(fmv cu11 verifier)" "0|1|0|make test-new" \
   "CU11a: … adopt: at reinstate, no exit 5, no catch-up line, verifier: restamped"
pro cu11c "$S" "$V1" "paused: 2026-11-18T09:00+00:00" "verifier: make test-new"; rows cu11c done
es "$N" adopt --rollout "$TASKS/cu11c.md"
ok "$rc|$(grep -c 'verifier restamped' "$TASKS/cu11c.md")|$err" "0|0|" "CU11a': the same Reinstate, CLAUDE.md naming the stamp: no change"
# CU11b: a stale catch-up, by what is removed: both stamps by hand, or only pause_requested (his soft-pause cancel, a
# quiet drain's undo), paused_for: catch-up left dangling, which is no catch-up
for v in "cu11b paused_for pause_requested" "cu11f pause_requested"; do
  set -- $v; n=$1; shift
  pro "$n" "$S" "$V1"; rows "$n" open
  cu "$S" "$n"; for k; do setfm "$n" "$k" -; done
  cu "$S" "$n" --now 2026-11-18T10:30:00Z
  ok "$rc|$(j 'd["due"]')|$(fmv "$n" paused_for)|$(log "$n" | tail -1 | cut -c26-)" "0|false|<none>|not moved at $G12: its stamps were removed" \
     "CU11b: $* removed: catch-up closes the stale line (and a dangling paused_for), then decides afresh"
  has "$(j 'd["why"]')" "waits for a newer Green tip" "CU11b: … ($*) afresh: the churn wait"
done
pro cu11d "$S" "$V1"; rows cu11d open
cu "$S" cu11d; setfm cu11d paused_for -; setfm cu11d pause_requested -; setfm cu11d paused 2026-11-18T10:40+00:00
cp "$TASKS/cu11d.md" "$T/cu11d.before"
cu "$S" cu11d --now 2026-11-18T10:45:00Z
cmp -s "$TASKS/cu11d.md" "$T/cu11d.before"; ok "$rc|$?|$(j 'd["due"]')" "0|0|false" "CU11c: his paused: standing → catch-up writes nothing"
rr "$S" clear-pause --rollout "$TASKS/cu11d.md" --tasks-dir "$TASKS"
ok "$rc|$(fmv cu11d paused)|$(log cu11d | tail -1 | cut -c26-)" "0|<none>|not moved at $G12: cleared at a Reinstate" \
   "CU11c: … his clear-pause closes the line (the backstop)"
# CU11d: his hard pause once adopt has written moved (its turn lost before clear-pause): § Pausing's --abort still
# removes the stamps, so his paused: never sits beside paused_for: catch-up
pro cu11m "$S" "$V1"; rows cu11m done
cu "$S" cu11m; rr "$S" next --rollout "$TASKS/cu11m.md" --tasks-dir "$TASKS" --now 2026-11-18T10:05:00Z
es "$N" adopt --rollout "$TASKS/cu11m.md" --now 2026-11-18T10:10:00Z
cu "$N" cu11m --abort --why "his pause" --now 2026-11-18T10:15:00Z
ok "$rc|$(fmv cu11m paused)|$(fmv cu11m pause_requested)|$(fmv cu11m paused_for)|$(log cu11m | tail -1 | cut -c26-30)|$(rec cu11m | tail -1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["kind"])')" \
   "0|<none>|<none>|<none>|moved|resumed" "CU11d: adopt moved, then --abort: the stamps go, no log line, the record's resumed"
setfm cu11m paused 2026-11-18T10:20+00:00; rr "$N" record-pause --rollout "$TASKS/cu11m.md" --tasks-dir "$TASKS"
rr "$N" moving --rollout "$TASKS/cu11m.md" --tasks-dir "$TASKS" --now 2026-11-18T10:25:00Z
ok "$rc|$(j 'd["verdict"]')|$(j 'd["cause"]')" "0|waiting|paused" "CU11d: … his hard pause: moving reads paused, not catch-up"
rr "$N" status --rollout "$TASKS/cu11m.md" --tasks-dir "$TASKS" --now 2026-11-18T10:25:00Z
ok "$rc|$(j 'd["paused"]')|$(j 'd["pausedFor"]')" "0|2026-11-18T10:20+00:00|null" "CU11d: … and the status JSON: paused, pausedFor null"

# ════ CU9b (last: it moves the Green tip) ═══════════════════════════════════════════════════════════════════════
echo "== CU9b"
# CU9b: no churn at the same Green tip; a strict descendant takes again
cu "$S" cu9 --now 2026-11-18T10:40:00Z
ok "$rc|$(j 'd["due"]')|$(log cu9 | wc -l | tr -d ' ')" "0|false|2" "CU9b: after not moved at G, catch-up at the same G writes nothing"
has "$(j 'd["why"]')" "it waits for a newer Green tip" "CU9b: … naming the wait"
C8=$(c "docs: eight" docs/c8.md); G2=$C8; green "$V1" "$G" "$G2"
cu "$S" cu9 --now 2026-11-18T10:45:00Z
ok "$rc|$(j 'd["kind"]')|$(j 'd["due"]')|$(j 'd["green12"]')" "0|take|true|${G2:0:12}" "CU9b: the Green tip a strict descendant: a take (the phase drained)"
cu "$S" cu9 --abort --why "a test's end"

echo
if [ "$fail" -eq 0 ]; then echo "engine-catch-up: ALL PASS"; else echo "engine-catch-up: FAILED"; fi
exit "$fail"
