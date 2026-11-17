#!/usr/bin/env bash
# p51-2: clean main is verified before the first dispatch (schedule step 2.6), skills/_shared/scripts/baseline-capture.py.
# A fixture repo (a bare origin and its clone) whose verifier is a script on main:
#   B1  a red main records its baseline: one `- <id> — <reason>` line per failing test, the ids split back out of
#       the block as execute reads it (its knownBaselineFailures), the run held in a verify slot, the tree removed
#   B2  a green main records none
#   B3  a red main naming no test, a failed bootstrap and a missing origin/<default>
#   B4  the frame: the wait command its first line names reports its end inside the caller's turn (a fork's)
#   B5  a stop is passed on to the verify: no verdict, none recorded, the tree removed
# Hermetic: temp repos, ssh disabled, the verify slots in a temp pool, the heat reading pinned.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset VERIFY_SLOT_HELD
export TZ=UTC PYTHONDONTWRITEBYTECODE=1 GIT_SSH_COMMAND=false
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
tmp=$(cd "$(mktemp -d)" && pwd -P); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
export THREAD_EVENTS_DIR="$tmp/events" THREAD_VERIFY_SLOTS_DIR="$tmp/verify-slots" THREAD_HEAT_LEVEL=0
export THREAD_VERIFY_SLOT_POLL=0.1
BC="$root/skills/_shared/scripts/baseline-capture.py"

git -c init.defaultBranch=master init -q --bare "$tmp/srv.git"
# main(<check.sh body>): commit a verifier script to origin's master from another clone, so the checkout under test
# holds a stale origin/master until the capture fetches it.
git -c init.defaultBranch=master clone -q "$tmp/srv.git" "$tmp/up" 2>/dev/null
main() {
  printf '%s\n' "$1" > "$tmp/up/check.sh"
  git -C "$tmp/up" add check.sh && git -C "$tmp/up" commit -qm c && git -C "$tmp/up" push -q origin HEAD:master
}
main 'exit 0'
git -c init.defaultBranch=master clone -q "$tmp/srv.git" "$tmp/repo" 2>/dev/null
cap() { out=$(python3 "$BC" --repo "$tmp/repo" --default master --verifier 'bash check.sh' --timeout 60 --slots 1 \
  --slot-wait 30 --date 2026-11-18 "$@" 2>"$tmp/err"); rc=$?; }
j() { printf '%s' "$out" | python3 -c 'import json,sys; v=json.load(sys.stdin)[sys.argv[1]]; print(v if isinstance(v, str) else json.dumps(v))' "$1"; }

# ---- B1: a red main records its baseline ----
main 'echo "ok 1 - tests/fine.test.sh"; echo "not ok 2 - tests/a.test.sh"; echo "not ok 3 - tests/b.test.sh # flaky?"; exit 1'
cap
sha=$(git --git-dir "$tmp/srv.git" rev-parse master)
ok "$rc|$(j status)|$(j sha)|$(j fetched)|$(j rc)" "0|red|$sha|true|1" "B1: a red main is captured red, on the fetched origin/master"
ok "$(j failing)" '["tests/a.test.sh", "tests/b.test.sh"]' "B1: … its failing tests read from the verifier's output"
ok "$(j block)" "- tests/a.test.sh — red on clean master at ${sha:0:7} before the first dispatch (2026-11-18)
- tests/b.test.sh — red on clean master at ${sha:0:7} before the first dispatch (2026-11-18)" \
  "B1: … one \`- <id> — <reason>\` block line per red"
# Execute reads the block's lines as knownBaselineFailures, `<test_id> — <reason>`: the id splits back out whole.
ok "$(j block | sed -e 's/^- //' -e 's/ — .*//' | paste -sd, -)" "tests/a.test.sh,tests/b.test.sh" \
  "B1: … each line splits back to its test id, the form a task's verify ignores"
ok "$(j line)" "Baseline: 2 red on clean master at ${sha:0:7}: tests/a.test.sh, tests/b.test.sh" "B1: … step 8's line names them"
log=$(j log)
has "$(cat "$log")" "== verify slot 1 of 1 after" "B1: … the run held one of the machine's verify slots"
ok "$(ls "$tmp/repo/.claude/baseline" | grep -c '^tree-')" 0 "B1: … and its clean tree is removed"

# ---- B2: a green main records none ----
main 'echo "ok 1 - tests/fine.test.sh"; exit 0'
cap
sha=$(git --git-dir "$tmp/srv.git" rev-parse master)
ok "$rc|$(j status)|$(j block)|$(j failing)" "0|green|none|[]" "B2: a green main records none"
ok "$(j line)" "Baseline: none (clean master green at ${sha:0:7})" "B2: … and step 8's line says main is green"

# ---- B3: what records none, and what stops ----
main 'echo boom; exit 3'
cap
ok "$rc|$(j status)|$(j rc)|$(j block)" "0|unnamed|3|none" "B3: a red main naming no test records none"
has "$(j line)" "red at" "B3: … and its line still says main is red"
main 'exit 0'
cap --bootstrap 'exit 4'
ok "$rc|$(j status)|$(j block)" "0|noverdict|none" "B3: a failed bootstrap is no verdict, none recorded"
has "$(j line)" "not captured: env_bootstrap failed (rc 4)" "B3: … its line names why"
cap --no-fetch
ok "$rc|$(j fetched)" "0|null" "B3: --no-fetch runs on the origin/master the repo holds"
out=$(python3 "$BC" --repo "$tmp/repo" --default nope --verifier true --timeout 60 2>"$tmp/err"); rc=$?
ok "$rc|$out" "2|" "B3: no origin/<default> is exit 2, nothing printed"
has "$(cat "$tmp/err")" "baseline-capture: no origin/nope" "B3: … with its one stderr line"

# ---- B4: the frame, so a fork waits for the capture inside its turn ----
main 'echo "not ok 1 - tests/a.test.sh"; exit 1'
python3 "$BC" --repo "$tmp/repo" --default master --verifier 'bash check.sh' --timeout 60 --slots 1 --slot-wait 30 \
  --date 2026-11-18 >"$tmp/bg.out" 2>&1 &
bg=$!
for _ in $(seq 200); do [ -s "$tmp/bg.out" ] && break; sleep 0.1; done
first=$(head -1 "$tmp/bg.out")
has "$first" "verify-slot: run $bg started; wait for its verdict with: python3 " "B4: its first line names the wait"
eval "${first#*wait for its verdict with: } --for 60" >/dev/null 2>"$tmp/wait.err"; wrc=$?
wait "$bg"
ok "$wrc|$(tail -1 "$tmp/wait.err")" "0|verify-slot: exit 0 (run $bg)" "B4: … which reports the capture's end"
out=$(grep '^{' "$tmp/bg.out")
ok "$(j status)|$(j failing)" 'red|["tests/a.test.sh"]' "B4: … its JSON line written before the exit line"

# ---- B5: a stop is passed on to the verify ----
main 'echo started; sleep 30; exit 0'
python3 "$BC" --repo "$tmp/repo" --default master --verifier 'bash check.sh' --timeout 60 --slots 1 --slot-wait 30 \
  --date 2026-11-18 >"$tmp/stop.out" 2>&1 &
bg=$!
for _ in $(seq 200); do grep -qs '^== verifier:' "$tmp/repo/.claude/baseline/main-$bg.log" && break; sleep 0.1; done
kill "$bg"; wait "$bg"; src=$?
out=$(grep '^{' "$tmp/stop.out")
ok "$src|$(j status)|$(j block)" "143|noverdict|none" "B5: a stopped capture is no verdict, none recorded, exit 128+n"
has "$(j line)" "not captured: stopped by signal 15" "B5: … its line names the stop"
has "$(cat "$(j log)")" "verify: stopped by signal 15" "B5: … passed on to the verify, which stopped its suite"
ok "$(ls "$tmp/repo/.claude/baseline" | grep -c '^tree-')" 0 "B5: … and the verify it passed the stop to removed its tree"
ok "$(tail -1 "$tmp/stop.out")" "verify-slot: exit 143 (run $bg)" "B5: … its exit line last"

exit $fail
