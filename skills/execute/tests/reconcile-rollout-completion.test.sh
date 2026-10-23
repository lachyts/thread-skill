#!/usr/bin/env bash
# The completion verify (estate ADR 0009 d6, Chorus ADR 0107 d1): reconcile-rollout.py completion-verify, driven
# end to end through lead-integrate.py verify --outcome --detach-at on a fixture repo's merged main.
#   C1  no completion_verifier: -> state absent; the read and a refused --record leave the note byte-identical.
#   C2  `true` -> green on attempt 1: one log line, one completion-verify record, a summary, no fix task; the run's
#       log moves to <out>.<run id>.log and its rc and outcome go.
#   C3  a failing suite -> rerun on attempt 1, red on attempt 2 on the same sha: one fix task (projects copied, the
#       sha, the rc, the log and the failing ids), never a second one; a --record once decided still prints JSON.
#   C4  a red that clears on the re-run of the same tree -> a Flake: recorded, no task.
#   C5  noslot -> no verdict: the state stays `run`, streak counts it, and a third no-verdict run says halt.
#   C6  a deadline in the verifier is red at once; one in the env_bootstrap is `unrun`; a verifier's own rc 124 is
#       an ordinary red; a fix task already in the Archive is not refiled.
#   C7  refusals: nothing to record, an outcome file that is not verify's, an attempt 2 off the red tree; --dry-run
#       writes nothing.
#   C8  the value: absent forms, kept comments, and refused forms (a block scalar, a continued line, an escape, text
#       after the quote).
#   C9  the outcome decides, never the log's text: a dead verify, a failed bootstrap and verify's signal stop are no
#       verdict, the stop never counting toward the halt; a suite printing verify's own words stays a red.
#   C10 a run in flight: verify --outcome holds <out>.lock and locks its tree, so the read says in-flight, --record
#       refuses (3) and a second verify on the same --out exits 2 with the live run's files untouched; stopped, its
#       outcome reads `record`, then `stopped`.
#   C11 an unwritable tasks dir is a clean exit 1, the run still recordable, and a later record lands it.
#   C12 a run recorded but never moved (a crash between the note and the files) only finishes the move.
#   C13 a verify with no --outcome (Integration, RACE) writes no lock, no outcome and leaves its tree unlocked.
# Temp repos and notes only; no vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"  # this suite reads the Run record: each scenario keeps its own dir (scen)
NOW=2026-10-23T09:00:00Z
g() { git -c user.email=t@t -c user.name=t -c init.defaultBranch=master -c commit.gpgsign=false "$@"; }

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""; RO=""; SHA=""
# scen <name> [completion_verifier value | -] — a repo whose origin/master is merged main, and its rollout note
scen() {
  D="$TMP/$1"; mkdir -p "$D/tasks"; RO="$D/tasks/ro-rollout-2026-10-23.md"; export THREAD_EVENTS_DIR="$D/events"
  g init -q --bare "$D/origin.git"; g init -q "$D/repo"
  echo a > "$D/repo/a.txt"; g -C "$D/repo" add -A; g -C "$D/repo" commit -q -m init
  g -C "$D/repo" remote add origin "$D/origin.git"; g -C "$D/repo" push -q origin master
  g -C "$D/repo" fetch -q origin; SHA=$(git -C "$D/repo" rev-parse origin/master)
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprojects:\n  - "[[Demo]]"\nprotocol_version: 5\nverifier: "true"\n'
    [ "${2:--}" = "-" ] || printf 'completion_verifier: %s\n' "$2"
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[a]]\n' "$D/repo"; } > "$RO"
  echo "== $1"
}
cv() { python3 "$SCRIPT" completion-verify --rollout "$RO" --tasks-dir "$D/tasks" --now "$NOW" "$@" > "$D/out" 2> "$D/err"; rc=$?
       out=$(cat "$D/out"); err=$(cat "$D/err"); }
js() { python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get(sys.argv[2]); print("null" if v is None else v)' "$out" "$1"; }
# launch [verify args...] — run the read's verifier on its tree as the lead does (foreground)
launch() {
  cv; local tree outp verifier sha; tree=$(js tree); outp=$(js out); verifier=$(js verifier); sha=$(js sha)
  [ "$sha" = "null" ] && sha=$SHA
  python3 "$LI" verify --outcome --repo "$D/repo" --detach-at "$sha" --tree "$tree" --out "$outp" --timeout 60 \
    --verifier "$verifier" "$@" > /dev/null 2>&1
}
# run_attempt [--now T] — launch, then record from the attempt's own files
run_attempt() { launch; cv --record "$@"; }
# fake <ended> [rc|-] [step] [log text] — the attempt's ended files, as verify --outcome leaves them (FID: the run id)
fake() {
  cv; local o; o=$(js out); mkdir -p "$(dirname "$o")"
  FID=${FID:-r$RANDOM$RANDOM} python3 - "$o" "$1" "${2:--}" "${3:-}" "${FSHA:-$SHA}" "${4:-}" <<'PY'
import json, os, sys
o, ended, rc, step, sha, text = sys.argv[1:]
d = {"v": 1, "id": os.environ["FID"], "sha": sha, "ended": ended}
if rc != "-":
    d["rc"] = rc if rc == "noslot" else int(rc)
    open(o + ".rc", "w").write(rc + "\n")
if step:
    d["step"] = step
open(o + ".outcome.json", "w").write(json.dumps(d) + "\n")
open(o + ".log", "w").write(text + "\n")
PY
}
log_lines() { grep -c ' -> ' "$RO" || true; }
records() { cat "$THREAD_EVENTS_DIR"/ro-rollout-2026-10-23.jsonl 2>/dev/null | python3 -c '
import json, sys
print(",".join("%s/%s" % (d["result"], d["attempt"]) for d in map(json.loads, sys.stdin) if d["kind"] == "completion-verify"))'; }
red() { printf '%s/completion-red-ro-rollout-2026-10-23.md' "$D/tasks"; }
red_exists() { test -e "$(red)" && echo yes || echo no; }
integ() { printf '%s/repo/.claude/integration' "$D"; }

# ── C1 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c1
before=$(cksum < "$RO")
cv; ok "$rc|$out" '0|{"verifier": null, "state": "absent"}' "C1: no completion_verifier: → state absent"
cv --record; ok "$rc" 2 "C1: --record with no completion_verifier: → 2"
has "$err" "declares no completion_verifier:" "C1: … naming the missing key"
ok "$(cksum < "$RO")|$(records)|$(ls "$D/tasks" | wc -l | tr -d ' ')" "$before||1" "C1: … the note byte-identical, no record, no task"

# ── C2 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c2 '"true"'
cv; ok "$(js state)|$(js attempt)|$(js sha)|$(js verifier)" "run|1|null|true" "C2: declared → state run, attempt 1, no sha yet"
ok "$(js tree)" "$D/repo/.claude/worktrees/completion-ro-rollout-2026-10-23-1" "C2: … the attempt's own tree"
launch
cv; ok "$(js state)" "record" "C2: an ended, unrecorded run → record"
cv --record; ok "$rc|$(js result)|$(js decided)" "0|green|True" "C2: --record reads the run's outcome → green"
cv; ok "$(js state)" "green" "C2: … decided"
has "$(js summary)" "Completion verify: green at ${SHA:0:12}" "C2: … its Completion log summary"
ok "$(log_lines)|$(records)" "1|green/1" "C2: one log line, one completion-verify record"
ok "$(ls "$(integ)" | grep -c '^completion-ro-rollout-2026-10-23-1\..*-[0-9]*\.log$')|$(ls "$(integ)" | grep -c '\.rc$\|\.outcome\.json$')" "1|0" "C2: the log moved to its run's name, the rc and outcome gone"
has "$(grep ' -> green' "$RO")" "(run " "C2: … the line names its run"
ok "$(red_exists)" "no" "C2: no fix task"
ok "$(git -C "$D/repo" worktree list | wc -l | tr -d ' ')" "1" "C2: the detached tree is removed"

# ── C3 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c3 "\"printf 'FAILED tests/test_x.py::test_slow - boom'; echo; exit 1\""
run_attempt; ok "$(js result)|$(js attempt)" "rerun|1" "C3: red on attempt 1 → rerun"
cv; ok "$(js state)|$(js attempt)|$(js sha)" "rerun|2|$SHA" "C3: … attempt 2 on the red run's sha"
ok "$(js out)" "$(integ)/completion-ro-rollout-2026-10-23-2" "C3: … with its own out"
run_attempt --now 2026-10-23T09:40:00Z; ok "$(js result)|$(js followup)" "red|completion-red-ro-rollout-2026-10-23" "C3: red again → red, the fix task named"
ok "$(ls "$(integ)" | grep -c '^completion-ro-rollout-2026-10-23-1\..*\.log$')" "1" "C3: attempt 1's log survives the re-run"
F=$(cat "$(red)")
has "$F" "status: open" "C3: the fix task is open"
has "$F" '  - "[[Demo]]"' "C3: … projects: copied from the rollout"
has "$F" 'completion_red_of: "[[ro-rollout-2026-10-23]]"' "C3: … naming the rollout"
has "$F" "$SHA" "C3: … the sha"
has "$F" "rc 1, red on its run and on a re-run of the same tree" "C3: … the rc, and the re-run it failed"
has "$F" "completion-ro-rollout-2026-10-23-2." "C3: … attempt 2's log"
has "$F" '`tests/test_x.py::test_slow`' "C3: … and the failing id read from the log"
hasnt "$F" "rollout:" "C3: … never a rollout: (a loose task)"
cv; has "$(js summary)" "Completion verify: red at ${SHA:0:12} (rc 1, attempt 2); fix task [[completion-red-ro-rollout-2026-10-23]]" "C3: the summary names the fix task"
ok "$(log_lines)|$(records)" "2|rerun/1,red/2" "C3: two log lines, two records"
c0=$(cksum < "$(red)"); r0=$(cksum < "$RO")
cv --record; ok "$rc|$(js result)|$(js decided)|$(js written)" "0|red|True|False" "C3: --record once decided → the verdict as JSON, nothing written"
ok "$(cksum < "$(red)")|$(cksum < "$RO")|$(ls "$D/tasks" | grep -c completion-red)" "$c0|$r0|1" "C3: … the note and the one fix task untouched"

# ── C4 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c4 "\"test -f $TMP/c4.once || { touch $TMP/c4.once; exit 1; }\""
run_attempt; ok "$(js result)" "rerun" "C4: red on attempt 1 → rerun"
run_attempt --now 2026-10-23T09:40:00Z; ok "$(js result)|$(js followup)" "flake|null" "C4: green on the re-run of the same tree → flake, no task"
cv; ok "$(js state)" "flake" "C4: … decided"
has "$(js summary)" "flake at ${SHA:0:12}" "C4: … the summary names the Flake"
ok "$(red_exists)|$(records)" "no|rerun/1,flake/2" "C4: no fix task; recorded"

# ── C5 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c5 '"true"'
fake noslot noslot
cv --record; ok "$rc|$(js result)|$(js streak)|$(js halt)" "0|noslot|1|False" "C5: no verify slot → noslot, no halt"
cv; ok "$(js state)|$(js attempt)|$(js streak)" "run|1|1" "C5: … no verdict: still run, attempt 1"
fake noslot noslot; cv --record
fake noslot noslot; cv --record; ok "$(js streak)|$(js halt)" "3|True" "C5: the third no-verdict run in a row → halt, though all in one minute"
ok "$(log_lines)" "3" "C5: … three lines kept"
run_attempt; ok "$(js result)|$(js streak)" "green|0" "C5: a slot at the next tick → green"
ok "$(records)" "noslot/1,noslot/1,noslot/1,green/1" "C5: each run recorded"

# ── C6 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c6 '"sleep 5"'
launch --timeout 1
cv --record; ok "$(js result)|$(js attempt)" "red|1" "C6: a deadline in the verifier → red at once, no re-run"
F=$(cat "$(red)")
has "$F" "verify's own \`verify_timeout\` deadline, red at once" "C6: … the fix task says so"
hasnt "$F" "re-run of the same tree" "C6: … and claims no re-run"
scen c6b '"true"'
launch --timeout 1 --bootstrap 'sleep 5'
cv --record; ok "$(js result)|$(red_exists)" "unrun|no" "C6: a deadline in the env_bootstrap → unrun, no fix task (the suite never ran)"
scen c6c '"true"'
fake done 124
cv --record; ok "$(js result)" "rerun" "C6: a verifier's own rc 124 → an ordinary red: rerun"
scen c6d '"true"'
mkdir -p "$D/tasks/Archive/2026"; printf -- '---\nstatus: done\n---\n' > "$D/tasks/Archive/2026/completion-red-ro-rollout-2026-10-23.md"
fake deadline 124 verifier
cv --record; ok "$(js result)|$(js followup)" "red|completion-red-ro-rollout-2026-10-23" "C6: deadline red with the fix task archived"
ok "$(red_exists)" "no" "C6: … the archived fix task is not refiled"
cv; ok "$(js followup)" "completion-red-ro-rollout-2026-10-23" "C6: … and the read finds it there"

# ── C7 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c7 '"true"'
cv --record; ok "$rc" 3 "C7: nothing to record → 3"
has "$err" "nothing to record" "C7: … saying so"
cv; o=$(js out); mkdir -p "$(dirname "$o")"; echo '{"not": "verify"}' > "$o.outcome.json"; echo 0 > "$o.rc"
before=$(cksum < "$RO")
cv --record; ok "$rc" 2 "C7: an outcome file that is not verify's → 2"
ok "$(cksum < "$RO")|$(test -f "$o.rc" && echo kept)" "$before|kept" "C7: … nothing written, the files kept"
fake done 1; cv --record
FSHA=0123456789abcdef0123456789abcdef01234567 fake done 0
cv --record; ok "$rc" 2 "C7: attempt 2 off the red run's sha → 2"
has "$err" "not the red tree $SHA" "C7: … naming the red tree"
fake done 0; before=$(cksum < "$RO")
cv --record --dry-run; ok "$(js result)|$(js written)|$(cksum < "$RO")" "flake|False|$before" "C7: --dry-run classifies, writes nothing"
cv; ok "$(js state)" "record" "C7: … the run still recordable"
python3 "$SCRIPT" completion-verify --rollout "$D/none.md" > /dev/null 2>&1; ok "$?" 1 "C7: no rollout note → 1"

# ── C8 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c8 '  # optional (estate ADR 0009 d6): uncommented as written'
cv; ok "$(js state)" "absent" "C8: a comment-only completion_verifier: → absent, never a passing bash comment"
scen c8b 'null'
cv; ok "$(js state)" "absent" "C8: completion_verifier: null → absent"
scen c8c '"make test-all # every tier"   # the full suite'
cv; ok "$(js verifier)" "make test-all # every tier" "C8: a quoted command keeps its own # and drops the trailing comment"
scen c8d 'make test-all   # the full suite'
cv; ok "$(js verifier)" "make test-all" "C8: a bare command drops its inline comment"
scen c8e -
python3 - "$RO" "$HERE/../../schedule/rollout-template.md" <<'PY'
import sys
ro, tpl = sys.argv[1:]
line = next(l for l in open(tpl) if l.startswith("# completion_verifier:"))
t = open(ro).read()
open(ro, "w").write(t.replace("verifier: \"true\"\n", "verifier: \"true\"\n" + line[2:], 1))
PY
cv; ok "$(js state)" "absent" "C8: the template's line uncommented as it stands → absent"
i=0
for v in '>-' '|' "'make test ''all'''" '"python3 -c \"x\""' '"make test" all' '[make, test]' 'make|  test-all' '|  make test-all'; do
  i=$((i + 1)); scen "c8x$i" -
  python3 - "$RO" "$v" <<'PY'
import sys
ro, v = sys.argv[1:]
body = v.replace("|", "\n", 1) if v.startswith(("make|", "|  ")) else v
t = open(ro).read()
open(ro, "w").write(t.replace("verifier: \"true\"\n", "verifier: \"true\"\ncompletion_verifier: " + body + "\n", 1))
PY
  cv; ok "$rc|$out" "2|" "C8: completion_verifier: $v → refused (2), no command"
done

# ── C9 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c9 '"true"'
fake done 1 '' 'FAIL - C17: [env_bootstrap failed; verifier not run] not in [x]'
cv --record; ok "$(js result)" "rerun" "C9: a suite printing verify's own words is still its rc's red"
scen c9b '"true"'
fake running
cv --record; ok "$(js result)|$(js streak)" "unrun|1" "C9: an outcome still running, its lock free (verify died) → unrun"
cv; ok "$(js state)|$(js attempt)" "run|1" "C9: … no verdict: attempt 1 again"
fake signal 143; cv --record; ok "$(js result)|$(js streak)|$(js halt)" "stopped|1|False" "C9: verify's own signal stop → stopped, the streak unmoved"
fake bootstrap 1; cv --record; ok "$(js result)|$(js streak)" "unrun|2" "C9: a failed env_bootstrap → unrun"
fake signal 143; cv --record
fake running; cv --record; ok "$(js streak)|$(js halt)" "3|True" "C9: the third unrun in a row (stops skipped) → halt"
ok "$(red_exists)" "no" "C9: … none of them files a fix task"

# ── C10 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c10 '"sleep 30"'
cv; tree=$(js tree); outp=$(js out)
python3 "$LI" verify --outcome --repo "$D/repo" --detach-at "$SHA" --tree "$tree" --out "$outp" --timeout 60 --verifier 'sleep 30' > /dev/null 2>&1 &
vp=$!
for _ in $(seq 1 100); do grep -q '^== verifier' "$outp.log" 2>/dev/null && break; sleep 0.1; done
cv; ok "$(js state)" "in-flight" "C10: verify holds its lock → in-flight"
cv; ok "$(js state)" "in-flight" "C10: … a second read still sees it (a shared probe never blocks a reader)"
has "$(git -C "$D/repo" worktree list --porcelain)" "locked pid $vp" "C10: the detached tree is locked with verify's pid (the sweep's reaper skips it)"
cv --record; ok "$rc" 3 "C10: --record while it runs → 3"
python3 "$LI" verify --outcome --tree "$D/repo" --out "$outp" --timeout 60 --verifier true > "$D/v2" 2>&1; ok "$?" 2 "C10: a second verify on the same --out → 2"
has "$(cat "$D/v2")" "already running" "C10: … saying so"
ok "$(test -f "$outp.log" && test -f "$outp.outcome.json" && echo kept)" "kept" "C10: … the live run's files untouched"
kill -TERM "$vp" 2>/dev/null; wait "$vp" 2>/dev/null
cv; ok "$(js state)" "record" "C10: the run stopped → its lock drops, and its outcome reads record"
cv --record; ok "$(js result)" "stopped" "C10: … recorded as verify's own signal stop"
ok "$(git -C "$D/repo" worktree list | wc -l | tr -d ' ')" "1" "C10: the locked tree is still removed"

# ── C11 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c11 '"true"'
fake done 1; cv --record; fake done 1
python3 "$SCRIPT" completion-verify --rollout "$RO" --tasks-dir "$D/no-such-dir" --record > "$D/out" 2> "$D/err"; rc=$?
ok "$rc" 1 "C11: an unwritable tasks dir → 1"
hasnt "$(cat "$D/err")" "Traceback" "C11: … cleanly"
cv; ok "$(js state)|$(log_lines)" "record|1" "C11: … nothing recorded, the run still recordable"
cv --record; ok "$(js result)|$(red_exists)|$(log_lines)" "red|yes|2" "C11: a later record lands it"

# ── C12 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c12 '"true"'
FID=crash1 fake done 1; cv; o=$(js out)
cp "$o.outcome.json" "$D/keep.json"; cp "$o.log" "$D/keep.log"; cp "$o.rc" "$D/keep.rc"
cv --record; ok "$(js result)" "rerun" "C12: the run recorded"
mv "$D/keep.json" "$o.outcome.json"; mv "$D/keep.log" "$o.log"; mv "$D/keep.rc" "$o.rc"   # as if the move never ran
cv; ok "$(js state)" "rerun" "C12: … attempt 2's state; attempt 1's files are no longer read"
sed -i '' -e 's/ -> rerun/ -> noslot/' "$RO" 2>/dev/null || sed -i -e 's/ -> rerun/ -> noslot/' "$RO"
cv; ok "$(js state)" "record" "C12: a line carrying the run's id, with the files still there → record"
n0=$(log_lines); cv --record; ok "$(js written)|$(log_lines)|$(test -e "$o.outcome.json" && echo left || echo moved)" "False|$n0|moved" "C12: … --record only finishes the move, no second line"

# ── C13 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c13 '"true"'
python3 "$LI" verify --repo "$D/repo" --detach-at "$SHA" --tree "$D/race" --out "$(integ)/race-x" --timeout 60 --verifier true > /dev/null 2>&1
ok "$?|$(cat "$(integ)/race-x.rc")" "0|0" "C13: a verify with no --outcome (Integration, RACE) runs as before"
ok "$(ls "$(integ)" | grep -c 'race-x\.lock\|race-x\.outcome')" "0" "C13: … no lock, no outcome file"
hasnt "$(cat "$(integ)/race-x.log")" "detached at" "C13: … and its log as before"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-completion: ALL PASS"; else echo "reconcile-rollout-completion: FAILED"; fi
exit "$fail"
