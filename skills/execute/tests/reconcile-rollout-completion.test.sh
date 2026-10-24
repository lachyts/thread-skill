#!/usr/bin/env bash
# The completion verify (estate ADR 0009 d6, Chorus ADR 0107 d1, ADR 0052): reconcile-rollout.py completion-verify,
# read mode and --run, which owns one attempt end to end (the canary arm, lead-integrate.py verify --outcome in its
# own process, the check, the record) on a fixture repo's merged main.
#   C1  no completion_verifier: -> state absent; --run refuses (2) and the note stays byte-identical.
#   C2  `true` -> green on attempt 1: one log line, one completion-verify record, a summary, no fix task; the run's
#       log kept under its run's name, no rc or outcome left, the tree removed, the canary window checked; a --run
#       once decided runs nothing.
#   C3  a failing suite -> rerun on attempt 1, red on attempt 2 on the same sha: one fix task (projects copied, the
#       sha, the rc, the log and the failing ids).
#   C4  a red that clears on the re-run of the same tree -> a Flake: recorded, no task.
#   C5  completion_timeout: a deadline in the verifier is red at once; one in the env_bootstrap is `unrun`; a failed
#       env_bootstrap is `unrun`; a bad completion_timeout is refused; a fix task already in the Archive is not
#       refiled.
#   C6  the halt streak: the third no-verdict run in a row halts, the fourth does not (the streak restarts at a halt),
#       the sixth does; a `stopped` line never counts.
#   C7  a run in flight holds the attempt's lock: the read says in-flight, a second --run exits 3 and writes nothing;
#       TERMed, the run records its own `stopped` and removes its tree.
#   C8  a --run killed outright leaves its verify holding the lock until it ends, then a free lock and no line: the
#       same attempt runs again; a dead run's locked worktree entry is pruned first.
#   C9  git-env: a trip caught by --run's own check records `unrun` and exits 4; a trip a loop-entry check-all caught
#       and an ack re-armed meanwhile still records `unrun`, never the run's verdict.
#   C10 origin unread is exit 1 with nothing armed or written; a fix task that cannot be written on a final red is
#       exit 1 with no line, so the attempt runs again.
#   C11 the value: absent forms, kept comments, refused forms; env_bootstrap is read the same way.
#   C12 the outcome classes (verify's outcome file alone, never its log's text).
#   C13 a verify with no --outcome (Integration, RACE) writes no outcome file and leaves its tree unlocked.
#   C14 reconcile-rollout.py loads where fcntl does not (the Windows machine): a read verb still runs.
# Temp repos and notes only; no vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
CANARY="$HERE/../scripts/git-env-canary.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"  # this suite reads the Run record: each scenario keeps its own dir (scen)
export THREAD_VERIFY_SLOTS_DIR="$TMP/verify-slots"
export HOME="$TMP/home"; mkdir -p "$HOME"   # an empty HOME: rollout-settings.py resolves the built-ins
NOW=2026-10-24T09:00:00Z
g() { git -c user.email=t@t -c user.name=t -c init.defaultBranch=master -c commit.gpgsign=false "$@"; }

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""; RO=""; SHA=""
# scen <name> [completion_verifier value | -] [extra frontmatter line…] — a repo whose origin/master is merged main,
# and its rollout note
scen() {
  D="$TMP/$1"; mkdir -p "$D/tasks"; RO="$D/tasks/ro-rollout-2026-10-24.md"; export THREAD_EVENTS_DIR="$D/events"
  export THREAD_GIT_ENV_DIR="$D/git-env"
  g init -q --bare "$D/origin.git"; g init -q "$D/repo"
  echo a > "$D/repo/a.txt"; g -C "$D/repo" add -A; g -C "$D/repo" commit -q -m init
  g -C "$D/repo" remote add origin "$D/origin.git"; g -C "$D/repo" push -q origin master
  g -C "$D/origin.git" symbolic-ref HEAD refs/heads/master
  g -C "$D/repo" fetch -q origin; SHA=$(git -C "$D/repo" rev-parse origin/master)
  local name="$1" v="${2:--}"; shift; [ $# -gt 0 ] && shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprojects:\n  - "[[Demo]]"\nprotocol_version: 5\nverifier: "true"\n'
    [ "$v" = "-" ] || printf 'completion_verifier: %s\n' "$v"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[a]]\n' "$D/repo"; } > "$RO"
  echo "== $name"
}
cv() { python3 "$SCRIPT" completion-verify --rollout "$RO" --tasks-dir "$D/tasks" --now "$NOW" "$@" > "$D/out" 2> "$D/err"; rc=$?
       out=$(cat "$D/out"); err=$(cat "$D/err"); }
# js <key>… — the keys' values from the last JSON line, joined with |, in one interpreter start
js() { python3 -c 'import json,sys; d=json.loads(sys.argv[1] or "{}"); print("|".join("null" if d.get(k) is None else str(d.get(k)) for k in sys.argv[2:]))' "$out" "$@"; }
log_lines() { grep -c ' -> ' "$RO" || true; }
records() { cat "$THREAD_EVENTS_DIR"/ro-rollout-2026-10-24.jsonl 2>/dev/null | python3 -c '
import json, sys
print(",".join("%s/%s" % (d["result"], d["attempt"]) for d in map(json.loads, sys.stdin) if d["kind"] == "completion-verify"))'; }
red() { printf '%s/completion-red-ro-rollout-2026-10-24.md' "$D/tasks"; }
red_exists() { test -e "$(red)" && echo yes || echo no; }
integ() { printf '%s/repo/.claude/integration' "$D"; }
window() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["state"])' \
  "$THREAD_GIT_ENV_DIR/ro-rollout-2026-10-24/ro-rollout-2026-10-24.completion-verify.json" 2>/dev/null || echo none; }
# seed <result>… — hand-written log lines, as earlier runs left them
seed() {
  python3 - "$RO" "$SHA" "$@" <<'PY'
import sys
ro, sha, *results = sys.argv[1:]   # a no-verdict line still names the tree it would have run on
t = open(ro).read()
if "## Completion verify log" not in t:
    t = t.rstrip("\n") + "\n\n## Completion verify log\n\n"
for i, r in enumerate(results):
    t += f"- 2026-10-24T08:0{i}+00:00 attempt 1 at {sha} rc absent -> {r}: seeded (run seed{i}; log -)\n"
open(ro, "w").write(t)
PY
}
# wait_for <file> <text> — up to 10 s for a line in a file
wait_for() { for _ in $(seq 1 100); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 0.1; done; return 1; }

# ── C1 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c1
before=$(cksum < "$RO")
cv; ok "$rc|$out" '0|{"verifier": null, "state": "absent"}' "C1: no completion_verifier: → state absent"
cv --run; ok "$rc" 2 "C1: --run with no completion_verifier: → 2"
has "$err" "declares no completion_verifier:" "C1: … naming the missing key"
ok "$(cksum < "$RO")|$(records)|$(ls "$D/tasks" | wc -l | tr -d ' ')" "$before||1" "C1: … the note byte-identical, no record, no task"

# ── C2 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c2 '"true"'
cv; ok "$(js state)|$(js attempt)|$(js sha)|$(js verifier)" "run|1|null|true" "C2: declared → state run, attempt 1, no sha yet"
ok "$(js tree)" "$D/repo/.claude/worktrees/completion-ro-rollout-2026-10-24-1" "C2: … the attempt's own tree"
cv --run; ok "$rc|$(js ran)|$(js result)|$(js decided)|$(js halt)" "0|True|green|True|False" "C2: --run → green"
cv; ok "$(js state)" "green" "C2: … decided"
has "$(js summary)" "Completion verify: green at ${SHA:0:12}" "C2: … its Completion log summary"
ok "$(log_lines)|$(records)" "1|green/1" "C2: one log line, one completion-verify record"
has "$(grep ' -> green' "$RO")" "at $SHA rc 0" "C2: … the line names the merged sha and the rc"
ok "$(ls "$(integ)" | grep -c '^completion-ro-rollout-2026-10-24-1\..*-[0-9]*\.log$')|$(ls "$(integ)" | grep -c '\.rc$\|\.outcome\.json$')" "1|0" "C2: the log kept under its run's name, no rc or outcome left"
ok "$(red_exists)|$(git -C "$D/repo" worktree list | wc -l | tr -d ' ')" "no|1" "C2: no fix task; the detached tree removed"
ok "$(window)" "checked" "C2: the canary window armed and checked once"
ok "$(test -f "$D/repo/.git/thread/completion-ro-rollout-2026-10-24-1.lock" && echo git-dir)" "git-dir" "C2: the attempt's lock lives in the git dir, out of reach of a git clean or rm -rf .claude"
r0=$(cksum < "$RO")
cv --run; ok "$rc|$(js ran)|$(js result)|$(cksum < "$RO")|$(records)" "0|False|green|$r0|green/1" "C2: --run once decided runs nothing and writes nothing"

# ── C3 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c3 "\"printf 'FAILED tests/test_x.py::test_slow - boom'; echo; exit 1\""
cv --run; ok "$(js result)|$(js attempt)|$(js decided)" "rerun|1|False" "C3: red on attempt 1 → rerun"
has "$(grep ' -> rerun' "$RO")" "failing tests/test_x.py::test_slow" "C3: … its line names the failing ids (the Flake log)"
cv; ok "$(js state)|$(js attempt)|$(js sha)" "rerun|2|$SHA" "C3: … attempt 2 on the red run's sha"
ok "$(js out)" "$(integ)/completion-ro-rollout-2026-10-24-2" "C3: … with its own out"
g -C "$D/repo" commit -q --allow-empty -m later; g -C "$D/repo" push -q origin master
cv --run --now 2026-10-24T09:40:00Z; ok "$(js result)|$(js followup)" "red|completion-red-ro-rollout-2026-10-24" "C3: red again → red, the fix task named"
has "$(grep 'attempt 2' "$RO")" "at $SHA" "C3: … attempt 2 ran on the red tree, not the moved origin"
ok "$(ls "$(integ)" | grep -c '^completion-ro-rollout-2026-10-24-1\..*\.log$')" "1" "C3: attempt 1's log survives the re-run"
F=$(cat "$(red)")
has "$F" "status: open" "C3: the fix task is open"
has "$F" '  - "[[Demo]]"' "C3: … projects: copied from the rollout"
has "$F" 'completion_red_of: "[[ro-rollout-2026-10-24]]"' "C3: … naming the rollout"
has "$F" "$SHA" "C3: … the sha"
has "$F" "rc 1, red on its run and on a re-run of the same tree" "C3: … the rc, and the re-run it failed"
has "$F" "completion-ro-rollout-2026-10-24-2." "C3: … attempt 2's log"
has "$F" '`tests/test_x.py::test_slow`' "C3: … and the failing id read from the log"
hasnt "$F" "rollout:" "C3: … never a rollout: (a loose task)"
cv; has "$(js summary)" "Completion verify: red at ${SHA:0:12} (rc 1, attempt 2); fix task [[completion-red-ro-rollout-2026-10-24]]" "C3: the summary names the fix task"
ok "$(log_lines)|$(records)" "2|rerun/1,red/2" "C3: two log lines, two records"

# ── C4 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c4 "\"test -f $TMP/c4.once || { touch $TMP/c4.once; exit 1; }\""
cv --run; ok "$(js result)" "rerun" "C4: red on attempt 1 → rerun"
cv --run --now 2026-10-24T09:40:00Z; ok "$(js result)|$(js followup)" "flake|null" "C4: green on the re-run of the same tree → flake, no task"
cv; ok "$(js state)" "flake" "C4: … decided"
has "$(js summary)" "flake at ${SHA:0:12}" "C4: … the summary names the Flake"
ok "$(red_exists)|$(records)" "no|rerun/1,flake/2" "C4: no fix task; recorded"

# ── C5 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c5 '"sleep 5"' 'completion_timeout: 1'
cv --run; ok "$(js result)|$(js attempt)" "red|1" "C5: a deadline in the verifier (completion_timeout) → red at once, no re-run"
F=$(cat "$(red)")
has "$F" "the completion verify's own \`completion_timeout\` deadline, red at once" "C5: … the fix task says so"
hasnt "$F" "re-run of the same tree" "C5: … and claims no re-run"
scen c5b '"true"' 'completion_timeout: 1' 'env_bootstrap: "sleep 5"'
cv --run; ok "$(js result)|$(red_exists)" "unrun|no" "C5: a deadline in the env_bootstrap → unrun, no fix task (the suite never ran)"
scen c5c '"true"' "env_bootstrap: 'exit 3'"
cv --run; ok "$(js result)|$(js streak)" "unrun|1" "C5: a failed env_bootstrap → unrun"
scen c5d '"true"' 'env_bootstrap: "touch .boot-ok"'
cv --run; ok "$(js result)" "green" "C5: a green env_bootstrap runs first, then the verifier"
for bad in 0 6601 abc; do
  scen "c5x$bad" '"true"' "completion_timeout: $bad"
  before=$(cksum < "$RO")
  cv; ok "$rc" 2 "C5: completion_timeout: $bad → refused (2) by the read"
  cv --run; ok "$rc|$(cksum < "$RO")" "2|$before" "C5: … and by --run, nothing written"
done
scen c5e "\"printf 'FAILED t::x'; exit 1\""
mkdir -p "$D/tasks/Archive/2026"; printf -- '---\nstatus: done\n---\n' > "$D/tasks/Archive/2026/completion-red-ro-rollout-2026-10-24.md"
cv --run; cv --run; ok "$(js result)|$(js followup)|$(red_exists)" "red|completion-red-ro-rollout-2026-10-24|no" "C5: a fix task already archived is named, never refiled"

# ── C6 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c6 '"true"' "env_bootstrap: 'exit 3'"
seed noslot stopped noslot
cv; ok "$(js state)|$(js streak)" "run|2" "C6: two no-verdict lines at the tail, a stopped one skipped → streak 2"
cv --run; ok "$(js result)|$(js streak)|$(js halt)" "unrun|3|True" "C6: the third no-verdict run in a row → halt"
cv --run; ok "$(js streak)|$(js halt)" "4|False" "C6: the next one after the halt → no halt (the streak restarts)"
cv --run; cv --run; ok "$(js streak)|$(js halt)" "6|True" "C6: the third since the halt → halt again"
ok "$(red_exists)" "no" "C6: … none of them files a fix task"

# ── C7 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c7 '"sleep 30"'
python3 "$SCRIPT" completion-verify --rollout "$RO" --tasks-dir "$D/tasks" --now "$NOW" --run > "$D/bg.out" 2> "$D/bg.err" &
bp=$!
wait_for "$(integ)/completion-ro-rollout-2026-10-24-1.log" '^== verifier'
cv; ok "$(js state)" "in-flight" "C7: --run holds the attempt's lock → in-flight"
cv; ok "$(js state)" "in-flight" "C7: … a second read still sees it (a shared probe never blocks a reader)"
lp=$(git -C "$D/repo" worktree list --porcelain | sed -n 's/^locked pid //p')
ok "$(test -n "$lp" && kill -0 "$lp" 2>/dev/null && echo live)" "live" "C7: the detached tree is locked with its live verify's pid (the sweep's reaper skips it)"
before=$(cksum < "$RO")
cv --run; ok "$rc|$(js ran)|$(js state)|$(cksum < "$RO")" "3|False|in-flight|$before" "C7: a second --run → 3, nothing written"
kill -TERM "$bp" 2>/dev/null; wait "$bp"; brc=$?
out=$(cat "$D/bg.out")
ok "$brc|$(js result)|$(js streak)" "0|stopped|0" "C7: TERMed, --run records its own stopped, the streak unmoved"
ok "$(git -C "$D/repo" worktree list | wc -l | tr -d ' ')|$(window)" "1|checked" "C7: … the locked tree removed, the window checked"
cv; ok "$(js state)|$(js attempt)" "run|1" "C7: … the same attempt runs again"
python3 - "$D/repo/.git/thread/completion-ro-rollout-2026-10-24-1.lock" <<'PY' &
import fcntl, sys, time
fh = open(sys.argv[1], "a"); fcntl.flock(fh, fcntl.LOCK_SH); time.sleep(0.5)
PY
sp=$!; sleep 0.1
python3 - "$RO" <<'PY'
import sys
t = open(sys.argv[1]).read(); open(sys.argv[1], "w").write(t.replace('completion_verifier: "sleep 30"', 'completion_verifier: "true"'))
PY
cv --run; wait "$sp"
ok "$rc|$(js result)" "0|green" "C7: a reader's shared probe as --run starts → --run waits it out, never exits 3"

# ── C8 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c8 "\"test -f $TMP/c8.once || { touch $TMP/c8.once; sleep 30; }\""
python3 "$SCRIPT" completion-verify --rollout "$RO" --tasks-dir "$D/tasks" --now "$NOW" --run > /dev/null 2>&1 &
bp=$!
wait_for "$(integ)/completion-ro-rollout-2026-10-24-1.log" '^== verifier'
for _ in $(seq 1 100); do [ -f "$TMP/c8.once" ] && break; sleep 0.1; done   # the verifier is past its touch
kill -KILL "$bp"; wait "$bp" 2>/dev/null
cv; ok "$(js state)" "in-flight" "C8: --run killed outright → its verify, a child holding the attempt's lock, still runs: in-flight"
pkill -f "$TMP/c8.once" 2>/dev/null
for _ in $(seq 1 100); do cv; [ "$(js state)" = "in-flight" ] || break; sleep 0.1; done
cv; ok "$(js state)|$(js attempt)|$(log_lines)" "run|1|0" "C8: … once it ends, a free lock and no line: the same attempt"
cv --run; ok "$rc|$(js result)|$(js streak)" "0|green|0" "C8: the next --run clears the leftovers and runs it → green, the dead run never counted"
ok "$(git -C "$D/repo" worktree list | wc -l | tr -d ' ')|$(log_lines)" "1|1" "C8: … one tree gone, one line"
scen c8b '"true"'
g -C "$D/repo" worktree add -q --lock --reason "pid 1" --detach "$D/repo/.claude/worktrees/completion-ro-rollout-2026-10-24-1" "$SHA"
rm -rf "$D/repo/.claude/worktrees"
cv --run; ok "$rc|$(js result)" "0|green" "C8: a dead run's locked worktree entry with its directory gone is pruned, and the attempt runs"

# ── C9 ────────────────────────────────────────────────────────────────────────────────────────────────────────
scen c9 "\"git -C '$TMP/c9/repo' -c user.email=t@t -c user.name=t commit -q --allow-empty -m moved\""
cv --run; ok "$rc|$(js ran)|$(js result)|$(js decided)" "4|True|unrun|False" "C9: the shared checkout moved during the run → its own check trips: unrun, exit 4"
has "$(grep ' -> unrun' "$RO")" "git-env" "C9: … the line says the verdict was never acted on"
has "$err" "git-env" "C9: … the canary's stderr passed through"
scen c9b "\"i=0; while [ ! -f $TMP/c9b.go ] && [ \$i -lt 600 ]; do sleep 0.1; i=\$((i + 1)); done\""
python3 "$SCRIPT" completion-verify --rollout "$RO" --tasks-dir "$D/tasks" --now "$NOW" --run > "$D/bg.out" 2> "$D/bg.err" &
bp=$!
wait_for "$(integ)/completion-ro-rollout-2026-10-24-1.log" '^== verifier'
g -C "$D/repo" commit -q --allow-empty -m moved; new=$(git -C "$D/repo" rev-parse master)
python3 "$CANARY" check-all --rollout "$RO" --tasks-dir "$D/tasks" > /dev/null 2>&1; ok "$?" 3 "C9: a loop-entry check-all catches the trip"
python3 "$CANARY" ack --rollout "$RO" --tasks-dir "$D/tasks" --repo "$D/repo" --default master --slugs ro-rollout-2026-10-24 --ref "$new" > /dev/null 2>&1
ok "$?|$(window)" "0|armed" "C9: … and an ack re-arms the window while the run goes on"
python3 - "$RO" <<'PY'
import sys
t = open(sys.argv[1]).read(); open(sys.argv[1], "w").write(t.replace("## Queue\n", "## Queue\n\n- written during the run\n", 1))
PY
touch "$TMP/c9b.go"
wait "$bp"; brc=$?; out=$(cat "$D/bg.out")
ok "$brc|$(js result)" "0|unrun" "C9: the run's own check passes, but a trip fell inside its window → unrun, never green"
has "$(cat "$RO")" "- written during the run" "C9: … and a line written to the note during the run is kept"

# ── C10 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c10 '"true"'
g -C "$D/repo" remote set-url origin "$D/no-such-origin.git"
before=$(cksum < "$RO")
cv --run; ok "$rc|$(cksum < "$RO")|$(window)" "1|$before|none" "C10: origin unread → 1, nothing armed or written"
has "$err" "origin" "C10: … saying so"
scen c10b '"exit 1"'
cv --run
if [ "$(id -u)" -eq 0 ]; then echo "ok   - C10: (root ignores a 555 dir: the unwritable fix task case is skipped)"; cv --run; else
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
chmod 555 "$D/tasks"; cv --run; chmod 755 "$D/tasks"
ok "$rc|$(log_lines)|$(red_exists)" "1|1|no" "C10: a fix task that cannot be written on a final red → 1, no second line"
fi
hasnt "$err" "Traceback" "C10: … cleanly"
cv; ok "$(js state)|$(js attempt)" "rerun|2" "C10: … attempt 2 runs again"
ln -s "$D/no-such-target" "$(red)"
cv --run; ok "$rc|$(test -L "$(red)" && echo kept)" "1|kept" "C10: a fix-task path this run could not write (a dangling link) is never removed"
rm -f "$(red)"
cv --run; ok "$(js result)|$(red_exists)|$(log_lines)" "red|yes|2" "C10: a later run lands it"

scen c10c '"--no-such-option"'
cv --run; ok "$rc|$(js ran)|$(js result)" "0|True|rerun" "C10: a command starting with - is the verifier, never an option: an ordinary red"
scen c10e '"true"'
mkdir -p "$D/repo/.claude/worktrees/completion-ro-rollout-2026-10-24-1x"
cv --run --now 2026-10-24T09:10:00Z
python3 - "$RO" <<'PY'
import re, sys
for l in open(sys.argv[1]):
    m = re.search(r"\(run \S+; log (\S+)\)", l)
    if m and m.group(1) != "-":
        import os; print("ok   - C10: the line's log exists" if os.path.exists(m.group(1)) else f"FAIL - C10: {m.group(1)} missing")
PY

scen c10f "\"exit 1\""
o="$(integ)/completion-ro-rollout-2026-10-24-1"; mkdir -p "$(integ)"
git -C "$D/repo" fetch -q origin
printf '{"v": 1, "id": "dead1", "sha": "%s", "ended": "done", "rc": 0}\n' "$SHA" > "$o.outcome.json"; echo "dead log" > "$o.log"
python3 - "$SCRIPT" "$RO" "$D/tasks" "$NOW" > "$D/out" 2> "$D/err" <<'PY'
import importlib.util, sys
from pathlib import Path
script, ro, tasks, now = sys.argv[1:]
spec = importlib.util.spec_from_file_location("rr", script); rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)
rr._lead()                                       # loaded first: only the child verify is pointed away
rr.LEAD_INTEGRATE_PY = Path(script).with_name("no-such-lead-integrate.py")
sys.argv = [script, "completion-verify", "--rollout", ro, "--tasks-dir", tasks, "--now", now, "--run"]
sys.exit(rr.main())
PY
out=$(cat "$D/out")
ok "$(js result)" "unrun" "C10: verify never starts, a dead run's green outcome left behind → unrun, never green"
hasnt "$(grep ' -> ' "$RO")" "dead1" "C10: … the dead run's outcome is never read as this run's"
scen c10h '"true"'
rm -rf "$D/origin.git" "$D/repo"
g init -q --bare --object-format=sha256 "$D/origin.git"; g init -q --object-format=sha256 "$D/repo"
echo a > "$D/repo/a.txt"; g -C "$D/repo" add -A; g -C "$D/repo" commit -q -m init
g -C "$D/repo" remote add origin "$D/origin.git"; g -C "$D/repo" push -q origin master
g -C "$D/origin.git" symbolic-ref HEAD refs/heads/master
cv --run; ok "$rc|$(log_lines)" "1|0" "C10: a SHA-256 repository → exit 1, nothing run or written, never an endless unrun loop"
has "$err" "SHA-256" "C10: … saying so"
scen c10g '"sleep 30"'
python3 - "$SCRIPT" "$RO" "$D/tasks" "$NOW" "$(integ)/completion-ro-rollout-2026-10-24-1.log" > "$D/out" <<'PY'
import os, signal, subprocess, sys, time
script, ro, tasks, now, log = sys.argv[1:]
p = subprocess.Popen([sys.executable, script, "completion-verify", "--rollout", ro, "--tasks-dir", tasks, "--now", now,
                      "--run"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
for _ in range(200):
    if os.path.exists(log) and "== verifier" in open(log).read():
        break
    time.sleep(0.1)
os.killpg(p.pid, signal.SIGTERM)   # the whole group, as a tree-wide stop does
print(p.communicate()[0].strip())
PY
out=$(cat "$D/out")
ok "$(js result)" "stopped" "C10: a TERM to --run's whole group → stopped"
has "$(grep ' -> stopped' "$RO")" "rc 143" "C10: … verify got it once, through --run, and ended cleanly (its own signal rc)"

# ── C11 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c11 '  # optional (estate ADR 0009 d6): uncommented as written'
cv; ok "$(js state)" "absent" "C11: a comment-only completion_verifier: → absent, never a passing bash comment"
scen c11b 'null'
cv; ok "$(js state)" "absent" "C11: completion_verifier: null → absent"
scen c11c '"make test-all # every tier"   # the full suite'
cv; ok "$(js verifier)" "make test-all # every tier" "C11: a quoted command keeps its own # and drops the trailing comment"
scen c11d 'make test-all   # the full suite'
cv; ok "$(js verifier)" "make test-all" "C11: a bare command drops its inline comment"
scen c11e -
python3 - "$RO" "$HERE/../../schedule/rollout-template.md" <<'PY'
import sys
ro, tpl = sys.argv[1:]
t = open(ro).read()
for key in ("# completion_verifier:", "# completion_timeout:"):
    line = next(l for l in open(tpl) if l.startswith(key))
    t = t.replace("verifier: \"true\"\n", "verifier: \"true\"\n" + line[2:], 1)
open(ro, "w").write(t)
PY
cv; ok "$rc|$(js state)" "0|absent" "C11: the template's lines uncommented as they stand → absent"
scen c11f '"true"' 'completion_timeout:   # optional (ADR 0052): uncommented as written'
cv; ok "$rc|$(js state)" "0|run" "C11: with a verifier declared, a comment-only completion_timeout: → its default, never refused"
scen c11h '"true"' 'completion_timeout: ""'
cv; ok "$rc|$(js state)" "0|run" "C11: a quoted empty completion_timeout: → its default"
scen c11i "bash -c 'echo # hi'"
cv; ok "$rc|$out" "2|" "C11: a bare command holding a quote and a # → refused (2), never cut inside its own quotes"
scen c11j "echo \"it's\" 'x #y' \"z's\""
cv; ok "$rc|$out" "2|" "C11: a bare command with both quote kinds and a # inside quotes → refused (2)"
scen c11k '"true"' '  # runs every tier'
cv; ok "$rc|$(js verifier)" "0|true" "C11: an indented comment after the key is no continuation"
scen c11l -
python3 - "$RO" <<'PY'
import sys
t = open(sys.argv[1]).read()
open(sys.argv[1], "w").write(t.replace('verifier: "true"\n', 'verifier: "true"\ncompletion_verifier: make\n\n  test-all\n', 1))
PY
cv; ok "$rc|$out" "2|" "C11: a value continued after a blank line → refused (2), never cut to its first line"
scen c11m '"true"' 'completion_timeout:' '  900'
cv; ok "$rc|$out" "2|" "C11: a completion_timeout: whose value sits on the next line → refused (2), never the default"
scen c11g '"true"' 'env_bootstrap: >-'
HOME="$TMP/home" python3 "$SCRIPT" verify-timeout --rollout "$RO" > /dev/null 2> "$D/err"; ok "$?" 2 "C11: verify-timeout, run at every loop entry, refuses a completion key the reader cannot represent (2, never verify_timeout's 1)"
has "$(cat "$D/err")" "env_bootstrap" "C11: … naming it, before any work runs"
i=0
for v in '>-' '|' "'make test ''all'''" '"python3 -c \"x\""' '"make test" all' '[make, test]' 'make|  test-all' '|  make test-all' '- make test' 'make test: all'; do
  i=$((i + 1)); scen "c11x$i" -
  python3 - "$RO" "$v" <<'PY'
import sys
ro, v = sys.argv[1:]
body = v.replace("|", "\n", 1) if v.startswith(("make|", "|  ")) else v
t = open(ro).read()
open(ro, "w").write(t.replace("verifier: \"true\"\n", "verifier: \"true\"\ncompletion_verifier: " + body + "\n", 1))
PY
  cv; ok "$rc|$out" "2|" "C11: completion_verifier: $v → refused (2), no command"
done
scen c11y '"true"' 'env_bootstrap: >-'
cv; ok "$rc" 2 "C11: an env_bootstrap the reader cannot represent → refused (2)"

scen c11z '"true"'
python3 - "$D/repo/.git/thread" "$RO" <<'PY' &
import fcntl, os, sys, time
d, ro = sys.argv[1:]; os.makedirs(d, exist_ok=True)
fh = open(os.path.join(d, "completion-ro-rollout-2026-10-24-1.lock"), "a"); fcntl.flock(fh, fcntl.LOCK_EX)
time.sleep(0.5)
t = open(ro).read(); open(ro, "w").write(t.replace('completion_verifier: "true"\n', ""))
PY
hp=$!; sleep 0.2
cv --run; wait "$hp"
ok "$rc|$(window)" "2|none" "C11: the verifier removed before --run gets its lock → refused (2), nothing armed"

# ── C12 ───────────────────────────────────────────────────────────────────────────────────────────────────────
python3 - "$SCRIPT" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)
cases = [({"ended": "running"}, 1, "unrun"), ({"ended": "noslot", "rc": "noslot"}, 1, "noslot"),
         ({"ended": "signal", "rc": 143, "signal": 15}, 1, "stopped"), ({"ended": "bootstrap", "rc": 1}, 1, "unrun"),
         ({"ended": "deadline", "rc": 124, "step": "env_bootstrap"}, 1, "unrun"),
         ({"ended": "deadline", "rc": 124, "step": "verifier"}, 1, "red"), ({"ended": "done", "rc": 124}, 1, "rerun"),
         ({"ended": "done", "rc": 0}, 1, "green"), ({"ended": "done", "rc": 0}, 2, "flake"),
         ({"ended": "done", "rc": 1}, 2, "red"), (None, 1, "unrun")]
bad = [(o, n, want, got) for o, n, want in cases if (got := rr._classify_completion(o, n)[0]) != want]
print("ok   - C12: each outcome class (a verifier's own rc 124 is an ordinary red)" if not bad else f"FAIL - C12: {bad}")
sys.exit(1 if bad else 0)
PY
[ $? -eq 0 ] || fail=1

# ── C13 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c13 '"true"'
python3 "$LI" verify --repo "$D/repo" --detach-at "$SHA" --tree "$D/race" --out "$(integ)/race-x" --timeout 60 --verifier true > /dev/null 2>&1
ok "$?|$(cat "$(integ)/race-x.rc")" "0|0" "C13: a verify with no --outcome (Integration, RACE) runs as before"
ok "$(ls "$(integ)" | grep -c 'race-x\.outcome')" "0" "C13: … no outcome file"
python3 "$LI" verify --repo "$D/repo" --detach-at "$SHA" --tree "$D/race2" --out "$(integ)/race-y" --timeout 60 \
  --verifier "git -C '$D/repo' worktree list --porcelain > '$D/wt-during.txt'" > /dev/null 2>&1
ok "$(grep -c '^worktree .*/race2$' "$D/wt-during.txt")|$(grep -c '^locked' "$D/wt-during.txt")" "1|0" "C13: … and its tree, read while it runs, is not locked"
python3 "$LI" verify --outcome --tree "$D/repo" --out "$(integ)/oc-x" --timeout 60 --verifier true > /dev/null 2>&1
ok "$(test -e "$(integ)/oc-x.rc" && echo rc || echo none)|$(test -e "$(integ)/oc-x.outcome.json" && echo outcome)" "none|outcome" "C13: verify --outcome writes its outcome in place of an rc (the file heartbeat clause (4) acts on)"

# ── C14 ───────────────────────────────────────────────────────────────────────────────────────────────────────
scen c14 '"true"'
python3 - "$SCRIPT" "$RO" "$D/tasks" <<'PY' > "$D/out" 2> "$D/err"; rc=$?; out=$(cat "$D/out")
import sys
sys.modules["fcntl"] = None   # as on Windows: `import fcntl` raises ImportError
script, ro, tasks = sys.argv[1:]
sys.argv = [script, "completion-verify", "--rollout", ro, "--tasks-dir", tasks]
exec(compile(open(script).read(), script, "exec"), {"__name__": "__main__", "__file__": script})
PY
ok "$rc|$(js state)" "0|run" "C14: with no fcntl, reconcile-rollout.py still loads and a read verb runs"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-completion: ALL PASS"; else echo "reconcile-rollout-completion: FAILED"; fi
exit "$fail"
