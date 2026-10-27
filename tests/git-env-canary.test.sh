#!/usr/bin/env bash
# p14-6, executed: skills/execute/scripts/git-env-canary.py, the lead's git-env canary (execute § 4.5 *Git-env
# canary*). A window is armed before a launch and checked when it ends; a change to the shared checkout's
# refs/heads/<default> or its bareness that is not a close-out is logged on the rollout note's `## Git-env log` and
# holds what it threatens until a human ack (repair § 3e, ADR 0046): a bare checkout the whole rollout (exit 3), any
# other trip the Integration lane (exit 9 at every site but a task window's, which takes its work as it stands, 0).
# A Bookkeeping miss (record missing, unreadable, not armed) runs the state check and trips only when it fails (the
# bm cases). tests/contracts/git-env-canary.test.mjs pins the prose. The pc
# cases pin a rollout clone beside its in-place twin (ADR 0042): only the clone is armed, and only its own move trips.
#
# Hermetic: every repo lives under mktemp with a local bare repo as its only remote; the vault (rollout note + task
# notes) is temp; THREAD_GIT_ENV_DIR points the records into temp; every canary verb gets --tasks-dir explicitly
# (under the runner's temp HOME the default tasks dir does not exist, so a canary that ignored it would exit 2).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
root=$(pwd -P)
CAN="$root/skills/execute/scripts/git-env-canary.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
LAND="$root/skills/_shared/scripts/land.sh"
SKILL="$root/skills/execute/SKILL.md"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
# An absent parallel_ceiling resolves through rollout-settings.py (~/.config/thread/rollouts.toml, p15-4): every
# call that reaches it runs with HOME=$EH, an empty dir, so only the built-in applies and the operator's file never does.
EH="$TMP/settings-home"; mkdir -p "$EH"
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
export THREAD_HEAT_LEVEL=0   # the Heat hold's reading, pinned: a hot Mac never flips an assertion
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master -c commit.gpgsign=false "$@"; }

S=""; O=""; R=""; V=""; RO=""; C2=""
# scen <name>: a fresh origin ($O, bare, the only remote), the shared checkout $R (a clone on master), a second
# clone $C2 (another session pushing to origin), the vault $V with the rollout note $RO (Project root: $R) and the
# records under $S/state.
scen() {
  S="$TMP/$1"; O="$S/origin.git"; R="$S/repo"; C2="$S/clone2"; V="$S/vault"; RO="$V/ro.md"
  mkdir -p "$S" "$V"
  export THREAD_GIT_ENV_DIR="$S/state"
  g init -q --bare "$O"
  g init -q "$S/seed"
  mkdir -p "$S/seed/docs/handoffs"
  echo a > "$S/seed/a.txt"; echo t > "$S/seed/THREAD.md"; echo h > "$S/seed/docs/handoffs/x.md"
  g -C "$S/seed" add -A; g -C "$S/seed" commit -q -m init
  echo b >> "$S/seed/a.txt"; g -C "$S/seed" commit -q -am second
  g -C "$S/seed" push -q "$O" master
  g clone -q "$O" "$R"; g clone -q "$O" "$C2"
  mkro "$R"
  echo "== $1"
}
# mkro <Project root | -> — the rollout note
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Notes\n\n'
    [ "$1" = "-" ] || printf 'Project root: `%s`\n' "$1"
    printf '\n## Queue\n\n- [[A]]\n'; } > "$RO"
}
# mkt <slug> <status> [frontmatter lines...] — a task note linked to the rollout
mkt() {
  local s=$1 st=$2; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[ro]]"\n' "$st"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\nbody\n'; } > "$V/$s.md"
}
setst() { python3 - "$V/$1.md" "$2" <<'PY'
import re, sys
p, st = sys.argv[1:]
t = open(p).read()
open(p, "w").write(re.sub(r"^status: .*$", f"status: {st}", t, count=1, flags=re.M))
PY
}
# can <verb> [args...] -> $rc, $out, $err. --tasks-dir is ${TD:-$V}.
can() {
  local verb=$1; shift
  python3 "$CAN" "$verb" --rollout "$RO" --tasks-dir "${TD:-$V}" "$@" > "$S/out" 2> "$S/err"; rc=$?
  out=$(cat "$S/out"); err=$(cat "$S/err")
}
arm() { can arm --repo "$R" --default master --slug "$1" --kind "${2:-task}"; }
chk() { can check --repo "$R" --default master --slug "$1" --kind "${2:-task}"; }
call() { can check-all; }
ackc() { can ack --repo "$R" --default master --slugs "$1" --ref "$2"; }
rst() { python3 "$CAN" restore --rollout "$RO" --repo "$R" --default master "$@" > "$S/out" 2> "$S/err"; rc=$?; out=$(cat "$S/out"); err=$(cat "$S/err"); }
recp() { printf '%s/ro/%s.%s.json' "$THREAD_GIT_ENV_DIR" "$1" "${2:-task}"; }
# recf <slug> <kind> <field> — one record field as JSON ("<none>" when the record is absent)
recf() { local p; p=$(recp "$1" "$2"); [ -f "$p" ] || { echo "<none>"; return; }; python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get(sys.argv[2])))' "$p" "$3"; }
trips() { grep -c "git-env trip \[\[$1\]\]" "$RO"; }
misses() { grep -c "git-env miss \[\[$1\]\]" "$RO"; }
lacks() { case "$1" in *"$2"*) ok "[$1]" "no '$2'" "$3";; *) ok y y "$3";; esac; }
acks() { grep -c 'git-env ack' "$RO"; }
cur() { git -C "$R" rev-parse "${1:-master}"; }
code() { echo "$RANDOM$RANDOM" >> "$R/${1:-code.txt}"; g -C "$R" add -A; g -C "$R" commit -q -m code; }
cpath() { mkdir -p "$(dirname "$R/$1")"; echo "$RANDOM" >> "$R/$1"; g -C "$R" add -A; g -C "$R" commit -q -m "close-out $1"; }
push2() { g -C "$C2" fetch -q origin; g -C "$C2" reset -q --hard origin/master; echo "$RANDOM" >> "$C2/c2.txt"; g -C "$C2" add -A; g -C "$C2" commit -q -m c2; g -C "$C2" push -q origin master; }
ff() { g -C "$R" fetch -q origin; g -C "$R" merge -q --ff-only origin/master; }
# await <pid> <cmd…> — poll <cmd> until it succeeds or <pid> has exited.
await() { local p=$1; shift; while ! "$@" 2>/dev/null && kill -0 "$p" 2>/dev/null; do sleep 0.05; done; }
# holder — hold the lock in the background until `release` kills it (the kernel drops a flock with its process),
# never for a fixed time a loaded host can outrun. A lock not taken within 60 s ends it by SIGALRM, and the `took
# the lock` check fails by name; an unreleased hold ends after 300 s, so a canary that ignores its timeout fails
# rather than hangs. $S/held once it holds.
holder() {
  rm -f "$S/held"
  python3 -c 'import fcntl, signal, sys, time
f = open(sys.argv[1], "a"); signal.alarm(60); fcntl.flock(f, fcntl.LOCK_EX); signal.alarm(0)
open(sys.argv[2], "w").close(); time.sleep(300)' "$THREAD_GIT_ENV_DIR/ro.lock" "$S/held" &
  hp=$!
  await "$hp" test -f "$S/held"
  ok "$([ -f "$S/held" ] && echo held || echo "never held")" held "holder: took the lock"
}
release() { kill "$hp" 2>/dev/null; wait "$hp" 2>/dev/null; }
dellog() { python3 - "$RO" "$1" <<'PY'
import sys
p, needle = sys.argv[1:]
lines = open(p).read().split("\n")
open(p, "w").write("\n".join(l for l in lines if needle not in l))
PY
}

# ── a: a clean window ────────────────────────────────────────────────────────────────────────────────────────
scen a
mkt A in_progress
arm A; ok "$rc" 0 "a: arm on an unchanged repo → 0"
ok "$(recf A task state)|$(recf A task closed)|$(recf A task ref)" "\"armed\"|false|\"$(cur)\"" "a: … an open armed record holding refs/heads/master"
chk A; ok "$rc" 0 "a: check on an unchanged repo → 0"
ok "$(recf A task state)|$(recf A task closed)" '"checked"|true' "a: … the record is a checked tombstone"
ok "$(grep -c 'git-env' "$RO")" 0 "a: … and the note carries no git-env line"
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "a: a repeated check of the closed window, on a clean clone → 0, no trip (a Bookkeeping miss, ADR 0046)"
has "$(grep 'git-env miss \[\[A\]\]' "$RO")" "task: record not armed; refs/heads/master at" "a: … logged as a record not armed miss with the checkout's state"
# a2: the skipped arm. A revise, restart or resume of the same task that never armed must not pass on the last
# window's tombstone: a code commit made with no window open would otherwise go unseen.
scen a2
mkt A in_progress
arm A; chk A; ok "$rc" 0 "a2: arm A, check A → 0"
code
chk A; ok "$rc|$(trips A)" "0|1" "a2: a code commit with no new arm, then check A → 0 (a task window), one trip line"
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: record not armed, and the state check failed: refs/heads/master" "a2: … logged as record not armed with the failed state check"
ok "$(recf A task state)|$(recf A task closed)" '"tripped"|true' "a2: … the record reads tripped and closed"
ackc A "$(cur)"; ok "$rc" 0 "a2: … which the ack clears"
arm A; chk A; ok "$rc" 0 "a2: a fresh arm, then its check → 0"
# a3: an acked tombstone is not an arm either.
scen a3
mkt A in_progress
arm A; code; chk A; ackc A "$(cur)"; ok "$(recf A task state)" '"acked"' "a3: a trip on a closed window, acked → acked"
chk A; ok "$rc|$(trips A)" "0|2" "a3: check A on the acked tombstone with no new arm (the commit still local) → 0, a second trip line"

# ── bm: a Bookkeeping miss runs the state check (ADR 0046) ─────────────────────────────────────────────────────
# A window the canary could not read (record missing, unreadable, not armed) observed nothing: the check reads the
# checkout's state there and then (R's master an ancestor of origin's tip by ls-remote and by origin/master after a
# fetch, T equal to a reading; no tracked changes; not bare). Passing, it logs a miss line and holds nothing; failing,
# it trips, and only Lachy's ack clears it.
# upwrap <name> [body]: an upload-pack wrapper for R's origin; it logs each invocation's pid to $S/<name>.pids.
upwrap() {
  cat > "$S/$1.sh" <<EOW
#!/usr/bin/env bash
echo \$\$ >> "$S/$1.pids"
n=\$(cat "$S/$1.n" 2>/dev/null || echo 0); echo \$((n+1)) > "$S/$1.n"
${2:-}
exec git upload-pack "\$@"
EOW
  chmod +x "$S/$1.sh"; g -C "$R" config remote.origin.uploadpack "$S/$1.sh"
}
# bm-a: the 2026-10-19 false trip: a window checked twice with no second arm, on a clean clone.
for k in task verify; do
  scen "bm-a-$k"
  if [ "$k" = task ]; then mkt A in_progress; else mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-19T10:00+00:00'; fi
  arm A "$k"; chk A "$k"; chk A "$k"
  ok "$rc|$(trips A)|$(acks)|$(misses A)" "0|0|0|1" "bm-a ($k): arm, check, check again on a clean clone → 0, no trip, no ack, one miss line"
  m=$(grep 'git-env miss \[\[A\]\]' "$RO")
  for want in "$k: record not armed;" "refs/heads/master at $(cur);" "ls-remote origin master $(cur origin/master);" "origin/master $(cur origin/master) after a fetch;" "master on origin;" "no tracked changes;" "core.bare false;" "holds nothing; repo $R"; do
    has "$m" "$want" "bm-a ($k): … the miss line names '$want'"
  done
  call; ok "$rc" 0 "bm-a ($k): … check-all → 0"
done
scen bm-missing
mkt A in_progress
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "bm-missing: a check with no record on a clean clone → 0, one miss line"
has "$(grep 'git-env miss' "$RO")" "task: record missing;" "bm-missing: … logged as record missing"
call; ok "$rc" 0 "bm-missing: … check-all → 0"
scen bm-unread
mkt A in_progress; mkt I review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-19T10:00+00:00'
arm A; echo '{not json' > "$(recp A)"
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "bm-unread: a task window's unreadable record → 0, one miss line"
arm I verify; echo '{not json' > "$(recp I verify)"
chk I verify; ok "$rc|$(trips I)|$(misses I)" "4|0|1" "bm-unread: a verify window's unreadable record → 4 (no verdict), one miss line"
has "$out" "checked [[I]] verify: no verdict" "bm-unread: … no verdict"
arm I verify; echo '{x' > "$(recp I verify)"; sleep 1   # a second apart, so this miss line is not the last one's twin
call; ok "$rc|$(misses I)|$(recf I verify missChecked)" "0|2|false" "bm-unread: a check-all logs the window's miss (its tombstone unconsumed)"
chk I verify; ok "$rc|$(misses I)|$(recf I verify missChecked)" "4|2|true" "bm-unread: … the window's own check consumes it: 4, no second line"
# bm-unread-late: the window's own check reads the state there and then, never the earlier check-all's: a local
# commit after the check-all logged the miss trips the window at its own check, so the re-run's arm never baselines
# on it. (A's closed window gives check-all its repo: with none known the miss trips at once.)
scen bm-unread-late
mkt A in_progress; mkt I review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-19T10:00+00:00'
arm A; chk A
arm I verify; echo '{not json' > "$(recp I verify)"
call; ok "$rc|$(misses I)|$(trips I)|$(recf I verify missChecked)" "0|1|0|false" "bm-unread-late: check-all logs the unreadable record's miss (its tombstone unconsumed)"
code; X=$(cur)
chk I verify; ok "$rc|$(misses I)|$(trips I)" "9|1|1" "bm-unread-late: … a local commit, then the window's own check → 9 (the lane), a trip, no second miss"
has "$(grep 'git-env trip \[\[I\]\]' "$RO")" "verify: record unreadable, and the state check failed: refs/heads/master $X holds commits not on origin master" "bm-unread-late: … the trip line names the failed state check"
ok "$(recf I verify state)|$(recf I verify closed)|$(recf I verify missChecked)" '"tripped"|true|true' "bm-unread-late: … the record reads tripped, closed and consumed"
arm I verify; ok "$rc|$(recf I verify state)" '9|"tripped"' "bm-unread-late: … the re-run's arm → 9, nothing baselined on the local commit"
chk I verify; ok "$rc|$(trips I)" "9|1" "bm-unread-late: … a repeated check of the tripped window → 9, no second trip line"
scen bm-behind
mkt A in_progress
arm A; chk A; push2
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "bm-behind: R behind origin after a peer push → 0, a miss (an ancestor of origin's tip)"
scen bm-untracked
mkt A in_progress
arm A; chk A; mkdir -p "$R/.claude"; echo x > "$R/.claude/merge-task.status"; echo y > "$R/stray.txt"
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "bm-untracked: an untracked .claude/merge-task.status (and a stray file) → 0, a miss"
# bm-pp: a peer push between the ls-remote and the fetch: T is not L1, so ls-remote is read again and T matches it.
scen bm-pp
mkt A in_progress
arm A; chk A; l1=$(cur origin/master)
upwrap pp "if [ \"\$n\" = 1 ]; then unset \$(git rev-parse --local-env-vars); git -C '$C2' fetch -q origin; git -C '$C2' reset -q --hard origin/master; echo p >> '$C2/pp.txt'; git -C '$C2' add -A; git -c user.name=t -c user.email=t@t -C '$C2' commit -q -m pp; git -C '$C2' push -q origin master; fi"
chk A; l2=$(git -C "$O" rev-parse master)
ok "$rc|$(trips A)|$(misses A)" "0|0|1" "bm-pp: a peer push between the reads → 0, a miss"
has "$(grep 'git-env miss' "$RO")" "ls-remote origin master $l1, re-read $l2; origin/master $l2 after a fetch" "bm-pp: … naming both readings"
# bm-trip: a miss whose state check fails trips, and only an ack clears it.
for v in local tracked bare fg fg2x fg2l url; do
  scen "bm-trip-$v"
  mkt A in_progress
  arm A; chk A
  case $v in
    local) code; want="holds commits not on origin" ;;
    tracked) echo dirty >> "$R/a.txt"; want="tracked changes" ;;
    bare) upwrap net; g -C "$R" config --local core.bare true; want="state check failed: core.bare true" ;;
    fg|fg2x|fg2l)
      g -C "$R" config remote.origin.fetch '+refs/heads/*:refs/remotes/elsewhere/*'
      L=$(cur origin/master); g -C "$R" checkout -q -b forge; code; X=$(cur forge); g -C "$R" checkout -q master
      g -C "$R" update-ref refs/remotes/origin/master "$X"
      [ "$v" = fg2l ] || g -C "$R" merge -q --ff-only "$X"
      want="origin/master $X after a fetch is neither ls-remote reading ($L, re-read $L)" ;;
    url) g -C "$R" remote set-url origin "$S/nowhere.git"; want="ls-remote origin master exited" ;;
  esac
  chk A; ok "$rc|$(trips A)|$(misses A)|$(acks)" "$([ "$v" = bare ] && echo 3 || echo 0)|1|0|0" "bm-trip ($v): the miss's state check fails → a trip, no miss, no ack"
  has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: record not armed, and the state check failed: " "bm-trip ($v): … the trip line says so"
  has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "$want" "bm-trip ($v): … naming '$want'"
  call; ok "$rc" "$([ "$v" = bare ] && echo 3 || echo 9)" "bm-trip ($v): check-all → $([ "$v" = bare ] && echo '3 (a bare checkout: the whole rollout)' || echo '9 (the lane)')"
  if [ "$v" = bare ]; then
    ok "$([ -e "$S/net.pids" ] && echo network || echo none)" none "bm-trip (bare): … no network call"
    has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "core.bare true; repo" "bm-trip (bare): … the line reads core.bare true, never core.bare false"
    rst --bare-only
  fi
  ackc A "$(cur)"; ok "$rc|$(acks)" "0|1" "bm-trip ($v): … only the ack clears it"
  call; ok "$rc" 0 "bm-trip ($v): … check-all → 0"
done
# The budget: one network budget, min(STATE_TIMEOUT, 0.4 x the lock timeout), each call in its own process group.
for b in slow slow2 cap; do
  scen "bm-$b"
  mkt A in_progress; mkt B in_progress; mkt C in_progress
  arm A; chk A; arm B; chk B
  upwrap "$b" 'sleep 60 & echo $! >> "'"$S/$b"'.pids"; wait'
  case $b in
    slow) ST=2 LT=8 ;;
    slow2) ST=2 LT=6 ;;
    cap) ST=30 LT=5 ;;
  esac
  if [ "$b" = cap ]; then
    t0=$(date +%s); THREAD_GIT_ENV_STATE_TIMEOUT=$ST THREAD_GIT_ENV_LOCK_TIMEOUT=$LT chk A; t1=$(date +%s)
    ok "$rc|$(( t1 - t0 <= 4 ))" "0|1" "bm-cap: STATE_TIMEOUT=30 under LOCK_TIMEOUT=5 → the miss ends within 4 s (0.4 x the lock timeout)"
    has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "ls-remote origin master timed out after 2s" "bm-cap: … its ls-remote timed out after 2 s"
  else
    THREAD_GIT_ENV_STATE_TIMEOUT=$ST THREAD_GIT_ENV_LOCK_TIMEOUT=$LT python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > "$S/a.out" 2> "$S/a.err" & pa=$!
    pb=""
    if [ "$b" = slow2 ]; then
      THREAD_GIT_ENV_STATE_TIMEOUT=$ST THREAD_GIT_ENV_LOCK_TIMEOUT=$LT python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug B --kind task > "$S/b.out" 2> "$S/b.err" & pb=$!
    fi
    await "$pa" test -s "$S/$b.pids"
    t0=$(date +%s); THREAD_GIT_ENV_STATE_TIMEOUT=$ST THREAD_GIT_ENV_LOCK_TIMEOUT=$LT arm C; t1=$(date +%s)
    ok "$rc|$(recf C task state)" '0|"armed"' "bm-$b: a concurrent task arm C behind the slow miss(es) (LOCK_TIMEOUT=$LT) → 0, armed"
    ok "$(( t1 - t0 <= 6 ))" 1 "bm-$b: … within 6 s"
    lacks "$err" "waiting for the lock" "bm-$b: … with no lock-timeout line"
    wait "$pa"; ra=$?; rb=0; [ -z "$pb" ] || { wait "$pb"; rb=$?; }
    ok "$ra|$rb" "0|0" "bm-$b: the slow miss's own check(s) → 0 (task windows)"
    has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "record not armed, and the state check failed: ls-remote origin master timed out after 2s" "bm-$b: … A trips: its ls-remote timed out after 2 s"
    [ "$b" = slow2 ] && has "$(grep 'git-env trip \[\[B\]\]' "$RO")" "timed out after 2s" "bm-slow2: … and B the same"
  fi
  sleep 0.2; alive=0
  while read -r pid; do kill -0 "$pid" 2>/dev/null && alive=$((alive + 1)); done < "$S/$b.pids"
  ok "$alive" 0 "bm-$b: … every wrapper process is gone (its group killed)"
  g -C "$R" config --unset remote.origin.uploadpack
  call; ok "$rc" 9 "bm-$b: check-all → 9 (the lane)"
done
# bm-lk: a concurrent fetch's ref lock: one retry after 1 s passes a lock that is gone by then; a lock that stays trips.
scen bm-lk
mkt A in_progress
LK="$R/.git/refs/remotes/origin/master.lock"
arm A; chk A; push2; mkdir -p "$(dirname "$LK")"; : > "$LK"
upwrap lk "[ \"\$n\" = 2 ] && rm -f '$LK'"
chk A; ok "$rc|$(trips A)|$(misses A)|$(cat "$S/lk.n")" "0|0|1|3" "bm-lk: a ref lock gone before the retry → the fetch's one retry passes (three upload-packs), a miss"
g -C "$R" config --unset remote.origin.uploadpack
arm A; chk A; push2; : > "$LK"
chk A; rm -f "$LK"
ok "$rc|$(trips A)" "0|1" "bm-lk: a ref lock that stays → a trip"
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "cannot lock ref" "bm-lk: … naming cannot lock ref"
# nv-miss (ADR 0053): a passing miss on a window whose tombstone carries an acked trip gives no verdict either.
scen nv-miss
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'; mkt T in_progress
arm A verify; arm T; old=$(cur); code; call; ok "$rc" 9 "nv-miss: a commit mid-window trips both windows (9)"
g -C "$R" push -q origin master
ackc A,T "$(cur)"; ok "$rc" 0 "nv-miss: the commit pushed, the ack re-baselines both"
chk A verify; ok "$rc|$(misses A)" "4|0" "nv-miss: the verify window's check → 4"
chk A verify; ok "$rc|$(misses A)|$(trips A)" "4|1|1" "nv-miss: … a second check (record not armed) → 4 again, a miss line, no second trip"
has "$out" "refs/heads/master ${old}→" "nv-miss: … naming the acked trip"
chk T; ok "$rc" 0 "nv-miss: the task window's check → 0"
chk T; ok "$rc|$(misses T)" "0|1" "nv-miss: … its second check (a miss) → 0"
has "$out" "checked [[T]] task: clean, taken as it stands" "nv-miss: … taken as it stands"
has "$out" "refs/heads/master ${old}→" "nv-miss: … naming the acked trip"

# ── sc: a trip holds what it threatens (ADR 0046) ──────────────────────────────────────────────────────────────
scen sc-lane
mkt A in_progress; mkt B in_progress; mkt I review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-19T10:00+00:00'
arm A; code
chk A; ok "$rc|$(trips A)" "0|1" "sc-lane: the default branch moved → a task check 0, logged"
call; ok "$rc" 9 "sc-lane: check-all → 9"
arm B; ok "$rc|$(recf B task state)" '0|"armed"' "sc-lane: a task arm B → 0, armed"
arm I integrate; ok "$rc|$(recf I integrate state)" '9|<none>' "sc-lane: arm I integrate → 9, nothing armed"
has "$err" "LANE HOLD: " "sc-lane: … naming the lane hold"
code; chk B; ok "$rc|$(trips B)" "0|1" "sc-lane: B's window sees a second move → 0, its trip joins the unacked set"
ackc A "$(cur)"; ok "$rc" 3 "sc-lane: ack A alone → 3 (the set is A, B)"
ackc A,B "$(cur)"; ok "$rc" 0 "sc-lane: ack A,B → 0"
call; ok "$rc" 0 "sc-lane: … check-all → 0"
scen sc-bare
mkt A in_progress; mkt B in_progress
arm A; g -C "$R" config --local core.bare true
chk A; ok "$rc" 3 "sc-bare: a bare flip → a task check 3 (the whole rollout)"
arm B; ok "$rc|$(recf B task state)" "3|<none>" "sc-bare: a task arm under it → 3, nothing armed"
scen sc-atarm
mkt A in_progress
g -C "$R" config --local core.bare true
arm A; ok "$rc|$(recf A task state)" "3|<none>" "sc-atarm: core.bare true at arm → 3, nothing armed"
has "$(grep 'git-env trip' "$RO")" "task: core.bare true at arm" "sc-atarm: … the line"
call; ok "$rc" 3 "sc-atarm: … check-all → 3"
# bl: a lane trip and a bare trip together hold the whole rollout; restore --bare-only, then one ack of every slug.
scen bl
mkt A in_progress; mkt C in_progress
arm A; code; chk A
call; ok "$rc" 9 "bl: (1) a lane trip → 9"
arm C; g -C "$R" config --local core.bare true
chk C; ok "$rc" 3 "bl: (2) a bare trip on top → 3"
call; ok "$rc" 3 "bl: … check-all 3"
ackc A,C "$(cur)"; ok "$rc" 3 "bl: (3) ack A,C while R reads bare → 3"
ackc A "$(cur)"; ok "$rc" 3 "bl: (4) ack A alone → 3 (the set is A, C)"
rst --bare-only; ok "$rc" 0 "bl: (5) restore --bare-only → 0"
call; ok "$rc" 3 "bl: … check-all still 3 (C's bare trip stands until the ack)"
ackc A,C "$(cur)"; ok "$rc" 0 "bl: (6) one ack of A,C → 0"
call; ok "$rc" 0 "bl: … check-all → 0"
arm A; code; call; ok "$rc" 9 "bl: (7) a later lane trip → 9"

# ── b: a code commit on local master trips ───────────────────────────────────────────────────────────────────
scen b
mkt A in_progress
arm A; old=$(cur); code; new=$(cur)
chk A; ok "$rc" 0 "b: a code commit on local master between arm and check → 0 (a task window: its work stands)"
ok "$(trips A)" 1 "b: … one trip line logged"
has "$(grep 'git-env trip' "$RO")" "task: refs/heads/master ${old}→${new}; repo $R" "b: … naming the kind, old→new and the repo"
ok "$(recf A task state)|$(recf A task closed)" '"tripped"|true' "b: … the record reads tripped and closed"
has "$err" "${old}→${new}" "b: … stderr names old→new"

# ── rr: the Run record (p15-2): the hold's edges record hold-started / hold-ended git-env ─────────────────────────
# Its own events dir on these calls, so the THREAD_TEST_EVENTS_DIR knob run never touches what this reads.
scen rr
mkt A in_progress
EVR="$S/events"
evs() { [ -f "$EVR/ro.jsonl" ] && python3 -c 'import json,sys; print(" ".join("%s:%s:%s" % (d["kind"], d.get("hold"), d["task"]) for d in map(json.loads, open(sys.argv[1]))))' "$EVR/ro.jsonl" || echo "<none>"; }
THREAD_EVENTS_DIR="$EVR" arm A; THREAD_EVENTS_DIR="$EVR" chk A
ok "$(evs)" "<none>" "rr: a clean window records nothing"
THREAD_EVENTS_DIR="$EVR" arm A; code
THREAD_EVENTS_DIR="$EVR" chk A; ok "$rc|$(evs)" "0|hold-started:git-env:None" "rr: the trip opens the hold → hold-started git-env, task null"
THREAD_EVENTS_DIR="$EVR" call; ok "$rc|$(evs)" "9|hold-started:git-env:None" "rr: check-all under the (lane) hold → 9, records nothing more"
THREAD_EVENTS_DIR="$EVR" ackc A "$(cur)"
ok "$rc|$(evs)" "0|hold-started:git-env:None hold-ended:git-env:None" "rr: the ack empties it → hold-ended git-env"

# ── c: bareness ──────────────────────────────────────────────────────────────────────────────────────────────
scen c
mkt A in_progress
arm A; g -C "$R" config --local core.bare true
chk A; ok "$rc" 3 "c: core.bare true (local config) → 3"
has "$(grep 'git-env trip' "$RO")" "core.bare false→true" "c: … the line names the bare flip"
scen c2
mkt A in_progress
arm A; g -C "$R" config --local extensions.worktreeConfig true; g -C "$R" config --worktree core.bare true
ok "$(git -C "$R" config --local --get core.bare)" false "c2: the local config still reads false"
chk A; ok "$rc" 3 "c2: core.bare true in config.worktree (extensions.worktreeConfig) → 3"

# ── d: moves relative to origin ──────────────────────────────────────────────────────────────────────────────
scen d
mkt A in_progress
arm A; push2; ff
chk A; ok "$rc" 0 "d: a push from a second clone, then fetch + merge --ff-only in R → 0"
arm A; code
chk A; ok "$rc|$(trips A)" "0|1" "d2: a code commit not on origin → a trip line (the task check 0)"
scen d3
mkt A in_progress
arm A
g -C "$R" checkout -q -b side; code; g -C "$R" push -q origin side:master; g -C "$R" checkout -q master; ff
chk A; ok "$rc" 0 "d3: a direct push to origin, then a local fast-forward → 0 (a pinned false negative, ADR 0030)"
arm A; push2; ff; push2; g -C "$R" fetch -q origin
chk A; ok "$rc" 0 "d4: a fast-forward, then origin moves again and is fetched → 0"
# d5: a forged refs/remotes/origin/master plus a local fast-forward onto it passes: a known gap (ADR 0030), which
# repair § 3e's ls-remote exposes and restore's fetch overwrites (j2).
arm A
g -C "$R" checkout -q -b forge; code; f=$(cur forge); g -C "$R" checkout -q master
g -C "$R" update-ref refs/remotes/origin/master "$f"; g -C "$R" merge -q --ff-only "$f"
chk A; ok "$rc" 0 "d5: a forged tracking ref plus a local fast-forward onto it → 0 (a pinned gap, ADR 0030)"

# ── r: the close-out rule (land.sh's closeout_shaped, stricter than S9) ─────────────────────────────────────
scen r
for s in A1 A2 A3 A4 A5 A6 A7 A8 A10; do mkt "$s" in_progress; done
arm A1; cpath THREAD.md; chk A1; ok "$rc" 0 "r1: a commit touching only THREAD.md → 0"
arm A2; g -C "$R" rm -q docs/handoffs/x.md; g -C "$R" commit -q -m "close-out: drop a consumed handoff"; cpath sub/docs/handoffs/y.md
chk A2; ok "$rc" 0 "r2: deleting docs/handoffs/x.md, then adding sub/docs/handoffs/y.md → 0"
g -C "$R" push -q origin master
arm A3; push2; ff; cpath THREAD.md; chk A3; ok "$rc" 0 "r3: a fast-forward, then a close-out commit → 0"
g -C "$R" push -q origin master
cpath docs/handoffs/z.md
arm A4; push2; g -C "$R" fetch -q origin; g -C "$R" rebase -q origin/master
chk A4; ok "$rc" 0 "r4: S11's shape (a local close-out rebased onto a moved origin) → 0"
g -C "$R" push -q origin master
arm A5; echo t2 >> "$R/THREAD.md"; mkdir -p "$R/src"; echo x > "$R/src/x.py"; g -C "$R" add -A; g -C "$R" commit -q -m mixed
chk A5; ok "$rc|$(trips A5)" "0|1" "r5: THREAD.md plus src/x.py → a trip"
scen r6
mkt A in_progress
arm A; cpath docs/handoffs/sub/x.md; chk A; ok "$rc|$(trips A)" "0|1" "r6: a nested docs/handoffs/sub/x.md → a trip"
scen r7
mkt A in_progress
g -C "$R" checkout -q -b side; cpath THREAD.md; g -C "$R" checkout -q master
arm A; cpath docs/handoffs/w.md; g -C "$R" merge -q --no-ff -m merge side
chk A; ok "$rc|$(trips A)" "0|1" "r7: a local merge commit (close-out paths only) → a trip (stricter than S9)"
scen r8
mkt A in_progress
arm A; g -C "$R" reset -q --hard HEAD~1
chk A; ok "$rc|$(trips A)" "0|1" "r8: local master reset behind origin → a trip"
scen r10
mkt A in_progress
arm A; g -C "$R" commit -q --allow-empty -m empty
chk A; ok "$rc|$(trips A)" "0|1" "r10: commit --allow-empty → a trip (stricter than S9)"
scen r11
mkt A in_progress
mkdir -p "$R/docs/reviews/sub"; echo r > "$R/docs/reviews/r.md"; echo n > "$R/docs/reviews/sub/n.md"
g -C "$R" add -A; g -C "$R" commit -q -m "review docs"; g -C "$R" push -q origin master
arm A; g -C "$R" rm -q docs/reviews/r.md; g -C "$R" commit -q -m "close-out: drop a consumed review doc"; cpath THREAD.md
chk A; ok "$rc" 0 "r11: deleting docs/reviews/r.md (land.sh's review-doc deletion), then THREAD.md → 0"
scen r12
mkt A in_progress
arm A; cpath docs/reviews/new.md; chk A; ok "$rc|$(trips A)" "0|1" "r12: adding docs/reviews/new.md → a trip"
scen r13
mkt A in_progress
mkdir -p "$R/docs/reviews"; echo r > "$R/docs/reviews/r.md"; g -C "$R" add -A; g -C "$R" commit -q -m "review doc"; g -C "$R" push -q origin master
arm A; cpath docs/reviews/r.md; chk A; ok "$rc|$(trips A)" "0|1" "r13: modifying docs/reviews/r.md → a trip"
scen r14
mkt A in_progress
mkdir -p "$R/docs/reviews/sub"; echo n > "$R/docs/reviews/sub/n.md"; g -C "$R" add -A; g -C "$R" commit -q -m "nested review doc"; g -C "$R" push -q origin master
arm A; g -C "$R" rm -q docs/reviews/sub/n.md; g -C "$R" commit -q -m "nested delete"; chk A; ok "$rc|$(trips A)" "0|1" "r14: deleting a nested docs/reviews/sub/n.md → a trip"
# r9: the python port against land.sh's own function, extracted by sed.
sed -n '/^closeout_shaped() {/,/^}/p' "$LAND" > "$TMP/closeout.sh"
ok "$(grep -c 'closeout_shaped' "$TMP/closeout.sh")" 1 "r9: land.sh's closeout_shaped extracted"
paths='THREAD.md
sub/THREAD.md
a/b/THREAD.md
THREAD.md.bak
xTHREAD.md
docs/handoffs/x.md
docs/handoffs/
docs/handoffs/sub/x.md
sub/docs/handoffs/y.md
sub/docs/handoffs/a/y.md
a/docs/handoffs/b/docs/handoffs/c.md
docs/handoffsx/y.md
src/x.py
README.md
docs/x.md'
want=$(printf '%s\n' "$paths" | while IFS= read -r p; do bash -c ". '$TMP/closeout.sh'; closeout_shaped \"\$1\" && echo \"\$1 y\" || echo \"\$1 n\"" _ "$p"; done)
got=$(printf '%s\n' "$paths" | python3 -c '
import importlib.util, sys
spec = importlib.util.spec_from_file_location("c", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for p in sys.stdin.read().split("\n"):
    if p: print(p, "y" if m.closeout_shaped(p) else "n")' "$CAN")
ok "$got" "$want" "r9: the python closeout_shaped agrees with land.sh's on $(printf '%s\n' "$paths" | wc -l | tr -d ' ') paths"
# r9b: the review-doc deletion rule, ported the same way: closeout_change over (status, path) pairs.
sed -n '/^review_doc() {/,/^}/p; /^closeout_change() {/,/^}/p' "$LAND" >> "$TMP/closeout.sh"
ok "$(grep -cE '^(review_doc|closeout_change)\(\) \{' "$TMP/closeout.sh")" 2 "r9b: land.sh's review_doc and closeout_change extracted"
changes='D docs/reviews/r.md
M docs/reviews/r.md
A docs/reviews/r.md
D docs/reviews/
D docs/reviews/sub/r.md
D sub/docs/reviews/r.md
D docs/reviewsx/r.md
D docs/handoffs/x.md
M THREAD.md
D src/x.py'
want=$(printf '%s\n' "$changes" | while read -r st p; do bash -c ". '$TMP/closeout.sh'; closeout_change \"\$1\" \"\$2\" && echo \"\$1 \$2 y\" || echo \"\$1 \$2 n\"" _ "$st" "$p"; done)
got=$(printf '%s\n' "$changes" | python3 -c '
import importlib.util, sys
spec = importlib.util.spec_from_file_location("c", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for ln in sys.stdin.read().split("\n"):
    if ln:
        st, p = ln.split(" ", 1); print(st, p, "y" if m.closeout_change(st, p) else "n")' "$CAN")
ok "$got" "$want" "r9b: the python closeout_change agrees with land.sh's on $(printf '%s\n' "$changes" | wc -l | tr -d ' ') changes"
ok "$(printf '%s\n' "$want" | grep -c ' y$')" 3 "r9b: exactly the docs/reviews/r.md deletion, the handoff and THREAD.md are accepted"

# ── u: the read order, through a recorder in place of _git ──────────────────────────────────────────────────
scen u
mkt A in_progress
u=$(python3 - "$CAN" "$RO" "$R" "$V" <<'PY'
import importlib.util, io, re, sys, types, contextlib
can, ro, repo, vault = sys.argv[1:]
spec = importlib.util.spec_from_file_location("canary", can); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
A, B, C = "a" * 40, "b" * 40, "c" * 40
calls = []
heads = [f"{A} refs/heads/master"]
def rec(r, *args):
    calls.append(list(args))
    out = ""
    if args[:1] == ("rev-parse",): out = "false\n"
    elif args[:1] == ("for-each-ref",): out = "\n".join(heads) + "\n" if args[-1] == "refs/heads/master" else f"{B} refs/remotes/origin/master\n"
    elif args[:1] == ("rev-list",): out = "" if "--parents" not in args else f"{C} {A}\n"
    elif args[:2] == ("merge-base", "--is-ancestor"): return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    elif args[:1] == ("merge-base",): out = B + "\n"
    elif args[:1] == ("diff-tree",): out = "M\0THREAD.md\0"
    return types.SimpleNamespace(returncode=0, stdout=out, stderr="")
m._git = rec
res = []
st = m._read_state(repo, "master")
res.append("u1 " + ("ok" if [c[:2] for c in calls] == [["rev-parse", "--is-bare-repository"], ["for-each-ref", "--format=%(objectname) %(refname)"], ["for-each-ref", "--format=%(objectname) %(refname)"]] and calls[1][-1] == "refs/heads/master" and calls[2][-1] == "refs/remotes/origin/master" and st == (False, A, B) else f"bad {calls} {st}"))
for label, h in (("two lines", [f"{A} refs/heads/master", f"{C} refs/heads/master/x"]), ("a wrong refname", [f"{A} refs/heads/master/x"])):
    heads[:] = h
    try:
        m._read_state(repo, "master"); res.append(f"u1-{label} no-exit")
    except m.CanaryError as e:
        res.append(f"u1-{label} {e.code}")
heads[:] = [f"{A} refs/heads/master"]
for d in ("ma*", "a..b"):
    calls.clear()
    with contextlib.redirect_stderr(io.StringIO()):
        rc = m.main(["arm", "--rollout", ro, "--tasks-dir", vault, "--repo", repo, "--default", d, "--slug", "A", "--kind", "task"])
    res.append(f"u1-default {d} {rc} {len(calls)}")
# u2: the comparison's rev-list / merge-base / diff-tree argv carry only shas.
calls.clear()
reason = m._compare({"repo": repo, "default": "master", "ref": C, "bare": False}, (False, A, B))
named = [c for c in calls if c[0] in ("rev-list", "merge-base", "diff-tree") and any(re.search(r"master|origin|HEAD", x) for x in c)]
res.append("u2 " + ("ok" if not named and reason is None and any(c[0] == "merge-base" for c in calls) else f"bad {named} {reason}"))
print("\n".join(res))
PY
)
has "$u" "u1 ok" "u1: _read_state reads bare, then refs/heads/master, then refs/remotes/origin/master, three calls"
has "$u" "u1-two lines 2" "u1: two lines for the heads read → exit 2"
has "$u" "u1-a wrong refname 2" "u1: a refname that is not exactly the requested ref → exit 2"
has "$u" "u1-default ma* 2 0" "u1: --default 'ma*' → 2 with no git call on R"
has "$u" "u1-default a..b 2 0" "u1: --default 'a..b' → 2 with no git call on R"
has "$u" "u2 ok" "u2: rev-list, merge-base and diff-tree take only the shas _read_state returned"
# u3: ack re-baselines to --ref with exactly one _read_state after the pass.
mkt B in_progress
arm A; arm B; code; Y=$(cur); chk A
u3=$(python3 - "$CAN" "$RO" "$R" "$V" "$Y" <<'PY'
import importlib.util, io, sys, contextlib
can, ro, repo, vault, y = sys.argv[1:]
spec = importlib.util.spec_from_file_location("canary", can); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
n = {"reads": 0, "at_pass_end": None}
real_read, real_pass = m._read_state, m._pass
def counted(*a, **k):
    n["reads"] += 1
    return real_read(*a, **k)
def passed(*a, **k):
    r = real_pass(*a, **k); n["at_pass_end"] = n["reads"]; return r
m._read_state, m._pass = counted, passed
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    rc = m.main(["ack", "--rollout", ro, "--tasks-dir", vault, "--repo", repo, "--default", "master", "--slugs", "A,B", "--ref", y])
print(rc, n["reads"] - n["at_pass_end"])
PY
)
ok "$u3" "0 1" "u3: ack --ref <Y> → 0, with exactly one _read_state after the pass"
ok "$(grep -c "git-env ack \[\[A\]\], \[\[B\]\]: refs/heads/master at $Y" "$RO")|$(recf B task state)|$(recf B task ref)" "1|\"armed\"|\"$Y\"" "u3: … the ack line names Y, and B's open window is re-baselined to Y"
u4=$(python3 - "$CAN" <<'PY'
import ast, sys
src = open(sys.argv[1]).read()
fn = next(n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "_read_state")
hits = [i for i, l in enumerate(src.split("\n"), 1) if "for-each-ref" in l]
print("ok" if hits and all(fn.lineno <= i <= fn.end_lineno for i in hits) else f"bad {hits} {fn.lineno}-{fn.end_lineno}")
PY
)
ok "$u4" ok "u4: for-each-ref appears only inside _read_state"

# ── e: one culprit, two windows ──────────────────────────────────────────────────────────────────────────────
scen e
mkt A in_progress; mkt B in_progress
arm A; arm B; code
chk A; ok "$rc" 0 "e: check A after one code commit → 0 (a task window; the lane is held)"
ok "$(trips A)|$(trips B)" "1|1" "e: … both windows' lines logged once"
ok "$(recf A task state)|$(recf A task closed)|$(recf B task state)|$(recf B task closed)" '"tripped"|true|"tripped"|false' "e: … A tripped/closed, B tripped/open"
chk B; ok "$rc" 0 "e: check B → 0"
ok "$(grep -c 'git-env trip' "$RO")" 2 "e: … the log line count unchanged"
before=$(cksum < "$RO")
ackc A "$(cur)"; ok "$rc" 3 "e: ack --slugs A (B unacked) → 3"
ok "$(cksum < "$RO")" "$before" "e: … and nothing is written"
ackc A,B "$(cur)"; ok "$rc" 0 "e: ack --slugs A,B --ref <cur> → 0"
ok "$(acks)" 1 "e: … one ack line"
arm A; ok "$rc" 0 "e: a fresh arm after the ack → 0"
chk A; ok "$rc" 0 "e: … and its check → 0"

# ── e2: hold order ───────────────────────────────────────────────────────────────────────────────────────────
scen e2
mkt A in_progress; mkt B in_progress; mkt C in_progress
arm A; arm B; arm C
rm -f "$THREAD_GIT_ENV_DIR/ro/A.task.json"
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "e2: A's record deleted, the clone clean → check A 0, a miss and no trip"
has "$(grep 'git-env miss \[\[A\]\]' "$RO")" "task: record missing; refs/heads/master at" "e2: … logged as record missing with the checkout's state"
ok "$(recf A task state)|$(recf A task closed)|$(recf A task miss)" '"checked"|true|"record missing"' "e2: … a closed checked tombstone carrying the miss"
ok "$(recf B task state)|$(recf C task state)" '"armed"|"armed"' "e2: … B and C stay armed"
chk C; ok "$rc" 0 "e2: a clean check C → 0 (the miss holds nothing)"
ok "$(recf C task state)" '"checked"' "e2: … C's tombstone"
code
chk B; ok "$rc" 0 "e2: a code commit, then check B → 0 (a task window)"
ok "$(trips B)|$(recf B task closed)" "1|true" "e2: … B's line logged and B closed"
before=$(cksum < "$RO")
ackc A,B "$(cur)"; ok "$rc" 3 "e2: ack --slugs A,B → 3 (A only missed: it is not in the unacked set)"
ok "$(cksum < "$RO")" "$before" "e2: … writing nothing"
ackc B "$(cur)"; ok "$rc" 0 "e2: ack --slugs B → 0"

# ── e3: a stale ref ──────────────────────────────────────────────────────────────────────────────────────────
scen e3
mkt A in_progress
arm A; code; X=$(cur); chk A; code; Y=$(cur)
ackc A "$X"; ok "$rc" 3 "e3: ack --ref X after the ref moved on to Y → 3"
ackc A absent; ok "$rc" 3 "e3: ack --ref absent → 3"
ackc A "$Y"; ok "$rc" 0 "e3: ack --ref Y → 0"
has "$(grep 'git-env ack' "$RO")" "refs/heads/master at $Y, core.bare false" "e3: … the ack line names Y"

# ── e4: a hidden trip ────────────────────────────────────────────────────────────────────────────────────────
scen e4
mkt A in_progress; mkt B in_progress
arm A; arm B; code; chk A
dellog 'git-env trip [[B]]'
ackc A "$(cur)"; ok "$rc" 3 "e4: B's line deleted by hand: ack --slugs A → 3"
ok "$(trips B)|$(acks)" "1|0" "e4: … B's line re-logged exactly once, no ack line"
ok "$(recf A task state)|$(recf B task state)" '"tripped"|"tripped"' "e4: … both records stay tripped"
scen e4b
mkt A in_progress; mkt B in_progress
arm A; arm B; rm -f "$THREAD_GIT_ENV_DIR/ro/A.task.json"
chk A; ok "$rc|$(misses A)" "0|1" "e4b: A's record deleted → check A 0, a miss"
code
ackc A "$(cur)"; ok "$rc" 3 "e4b: a code commit, then ack --slugs A → 3"
ok "$(trips B)|$(recf B task state)|$(recf B task closed)" '1|"tripped"|false' "e4b: … its pass logs B, tripped/open"
ackc B "$(cur)"; ok "$rc" 0 "e4b: ack --slugs B → 0"
ok "$(recf B task state)|$(recf B task ref)" "\"armed\"|\"$(cur)\"" "e4b: … B re-baselined to the acked ref"

# ── e5: an own record already tripped ────────────────────────────────────────────────────────────────────────
scen e5
mkt A in_progress; mkt B in_progress
arm A; arm B; code
call; ok "$rc" 9 "e5: check-all after a code commit → 9 (the lane held)"
ok "$(recf A task closed)|$(recf B task closed)" "false|false" "e5: … both tripped and open"
tripA=$(recf A task trip); code
chk A; ok "$rc" 0 "e5: a second commit, then check A → 0"
ok "$(grep -c 'git-env trip' "$RO")|$(recf A task closed)|$(recf A task trip)" "2|true|$tripA" "e5: … no new line, A closed, its trip unchanged"
dellog 'git-env trip [[A]]'
chk B; ok "$rc" 0 "e5: A's line deleted by hand, then check B → 0"
ok "$(trips A)|$(recf B task closed)" "1|true" "e5: … A's line re-logged once and B closed"

# ── f: fails closed ──────────────────────────────────────────────────────────────────────────────────────────
scen f
mkt A in_progress
mkdir -p "$S/plain"; mkro "$S/plain"
can arm --repo "$S/plain" --default master --slug A --kind task; ok "$rc" 2 "f: R not a git repo → arm 2"
mkro "$R"
mkdir -p "$S/locked"; chmod 555 "$S/locked"
THREAD_GIT_ENV_DIR="$S/locked/state" arm A; ok "$rc" 2 "f: an unwritable records dir → arm 2"
chmod 755 "$S/locked"
arm A; echo '{not json' > "$(recp A)"
chk A; ok "$rc|$(trips A)|$(misses A)" "0|0|1" "f: a corrupt record, the clone clean → check 0, one miss line, no trip"
has "$(grep 'git-env miss' "$RO")" "task: record unreadable; refs/heads/master at" "f: … logged as record unreadable with the checkout's state"
ok "$(recf A task state)|$(recf A task miss)|$(recf A task missChecked)" '"checked"|"record unreadable"|true' "f: … its own check consumed the tombstone"
scen f2
mkt A in_progress
arm A; code; chmod 444 "$RO"
chk A; ok "$rc" 2 "f: a read-only note → check 2"
ok "$(recf A task state)" '"tripped"' "f: … the record is left tripped"
chmod 644 "$RO"
call; ok "$rc" 9 "f: once the note is writable, check-all → 9"
ok "$(trips A)" 1 "f: … and re-logs the line"
python3 "$CAN" > /dev/null 2>&1; ok "$?" 2 "f: no verb → 2"
can arm --repo "$R" --default master --kind task; ok "$rc" 2 "f: arm without --slug → 2"
can arm --repo "$R" --default master --slug A --kind bogus; ok "$rc" 2 "f: an unknown --kind → 2"

# ── v: repo and default validation ───────────────────────────────────────────────────────────────────────────
scen v
mkt A in_progress
g init -q "$S/other"; g -C "$S/other" commit -q --allow-empty -m other
can arm --repo "$S/other" --default master --slug A --kind task; ok "$rc" 2 "v1: arm --repo <another repo> → 2"
has "$err" "is not this rollout's repo" "v1: … naming the rollout's repo"
arm A
can ack --repo "$R" --default main --slugs A --ref "$(cur)"; ok "$rc" 2 "v2: ack --default main against master records → 2"
ln -s "$R" "$S/link"; mkro "$S/link/"
chk A; ok "$rc" 0 "v3: a symlinked Project root with a trailing slash is accepted"
other_head=$(git -C "$S/other" rev-parse HEAD)
python3 "$CAN" restore --rollout "$RO" --repo "$S/other" --default master > /dev/null 2>&1
ok "$?|$(git -C "$S/other" rev-parse HEAD)" "2|$other_head" "v4: restore against another repo → 2, that repo unchanged"
mkro -
arm A; r1=$rc; chk A; r2=$rc; ackc A "$(cur)"; r3=$rc; rst; r4=$rc
ok "$r1|$r2|$r3|$r4" "2|2|2|2" "v5: no Project root: line → 2 for arm, check, ack and restore"
scen v6
mkt A in_progress
printf -- '\n## Git-env log\n\n- 2026-10-03T10:00:00+00:00 git-env trip [[A]] task: refs/heads/master %s→%s; repo %s\n' "$(cur)" "$(cur)" "$R" >> "$RO"
can ack --repo "$R" --default main --slugs A --ref "$(cur)"; ok "$rc" 2 "v6: trip lines only, ack --default main → 2"

# ── g: the hold outlives the records ─────────────────────────────────────────────────────────────────────────
scen g
mkt A in_progress; mkt C in_progress
arm A; code; rm -f "$(recp A)"; chk A
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: record missing, and the state check failed: refs/heads/master" "g: a deleted record with a local commit → a failed state check trips"
call; ok "$rc" 9 "g: the only record tripped (a lane hold); check-all → 9"
arm C; ok "$rc|$(recf C task state)" '0|"armed"' "g: a task arm C under the lane hold → 0, armed (task calls go on)"
has "$err" "LANE HOLD: " "g: … naming the lane hold on stderr"
PR="$S/plugin"; mkdir -p "$PR/skills/execute/scripts" "$R/.claude"
ln -s "$CAN" "$PR/skills/execute/scripts/git-env-canary.py"
printf '#!/usr/bin/env bash\ntouch "%s/stub-ran"\n' "$S" > "$PR/skills/execute/scripts/merge-task.sh"; chmod +x "$PR/skills/execute/scripts/merge-task.sh"
awk '/^# thread:git-env-backoff/{on=1; next} /^# end thread:git-env-backoff/{on=0} on' "$SKILL" > "$S/backoff.tpl"
ok "$(grep -c 'check-all' "$S/backoff.tpl")|$(grep -c 'merge-task.sh' "$S/backoff.tpl")" "1|1" "g: the backoff snippet found in execute/SKILL.md"
python3 - "$S/backoff.tpl" "$S/backoff.sh" "$R" "$RO --tasks-dir $V" <<'PY'
import sys
src, dst, repo, ro = sys.argv[1:]
t = open(src).read().replace("<repoPath>", repo).replace("<rollout-note>", ro).replace("<the same four args>", "a b c d").replace("sleep 60", "sleep 0")
open(dst, "w").write(t)
PY
CLAUDE_PLUGIN_ROOT="$PR" bash "$S/backoff.sh" > /dev/null 2>&1; brc=$?
ok "$brc|$([ -e "$S/stub-ran" ] && echo ran || echo not-run)|$(cat "$R/.claude/merge-task.status" 2>/dev/null)" "9|not-run|failed:git-env:9" \
  "g: the backoff under a lane hold never runs merge-task.sh and leaves failed:git-env:9 (the lane-hold row)"
# g3: the same under a bare checkout's hold: failed:git-env:3 (the trip row).
scen g3
mkt A in_progress
PR="$S/plugin"; mkdir -p "$PR/skills/execute/scripts" "$R/.claude"
ln -s "$CAN" "$PR/skills/execute/scripts/git-env-canary.py"
printf '#!/usr/bin/env bash\ntouch "%s/stub-ran"\n' "$S" > "$PR/skills/execute/scripts/merge-task.sh"; chmod +x "$PR/skills/execute/scripts/merge-task.sh"
python3 - "$TMP/g/backoff.tpl" "$S/backoff.sh" "$R" "$RO --tasks-dir $V" <<'PY2'
import sys
src, dst, repo, ro = sys.argv[1:]
t = open(src).read().replace("<repoPath>", repo).replace("<rollout-note>", ro).replace("<the same four args>", "a b c d").replace("sleep 60", "sleep 0")
open(dst, "w").write(t)
PY2
arm A; g -C "$R" config --local core.bare true; call; ok "$rc" 3 "g3: a bare flip → check-all 3"
CLAUDE_PLUGIN_ROOT="$PR" bash "$S/backoff.sh" > /dev/null 2>&1; brc=$?
ok "$brc|$([ -e "$S/stub-ran" ] && echo ran || echo not-run)|$(cat "$R/.claude/merge-task.status" 2>/dev/null)" "3|not-run|failed:git-env:3" \
  "g3: the backoff under a whole-rollout hold never runs merge-task.sh and leaves failed:git-env:3 (the trip row)"
# g2: a check-all that fails for another reason (a lock timeout, exit 2) records its own exit, so step 4 routes it
# to `git-env canary failed`, never to the trip reason.
scen g2
mkt A in_progress
PR="$S/plugin"; mkdir -p "$PR/skills/execute/scripts" "$R/.claude" "$THREAD_GIT_ENV_DIR"
ln -s "$CAN" "$PR/skills/execute/scripts/git-env-canary.py"
printf '#!/usr/bin/env bash\ntouch "%s/stub-ran"\n' "$S" > "$PR/skills/execute/scripts/merge-task.sh"; chmod +x "$PR/skills/execute/scripts/merge-task.sh"
python3 - "$TMP/g/backoff.tpl" "$S/backoff.sh" "$R" "$RO --tasks-dir $V" <<'PY'
import sys
src, dst, repo, ro = sys.argv[1:]
t = open(src).read().replace("<repoPath>", repo).replace("<rollout-note>", ro).replace("<the same four args>", "a b c d").replace("sleep 60", "sleep 0")
open(dst, "w").write(t)
PY
holder
THREAD_GIT_ENV_LOCK_TIMEOUT=1 CLAUDE_PLUGIN_ROOT="$PR" bash "$S/backoff.sh" > /dev/null 2>&1; brc=$?
release
ok "$brc|$([ -e "$S/stub-ran" ] && echo ran || echo not-run)|$(cat "$R/.claude/merge-task.status" 2>/dev/null)" "2|not-run|failed:git-env:2" \
  "g2: a lock timeout in the backoff's check-all never runs merge-task.sh and leaves failed:git-env:2 (canary failed)"
rows=$(grep -E '^   \| `failed:git-env:' "$SKILL")
has "$rows" '`failed:git-env:3` | Halt with `reason="git-env trip: the shared checkout changed"`' "g2: step 4 routes failed:git-env:3 to the trip reason"
has "$rows" '`failed:git-env:<any other rc>` | Halt with `reason="git-env canary failed"`' "g2: … and any other rc to git-env canary failed"
has "$rows" '`failed:git-env:9` | The lane is held' "g2: … and failed:git-env:9 to the lane hold, no halt"

# ── h: concurrency ───────────────────────────────────────────────────────────────────────────────────────────
scen h
mkt A in_progress; mkt B in_progress
arm A; arm B; code
python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > /dev/null 2>&1 & pa=$!
python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug B --kind task > /dev/null 2>&1 & pb=$!
wait "$pa"; ra=$?; wait "$pb"; rb=$?
ok "$ra|$rb" "0|0" "h: two concurrent checks each exit 0 (task windows)"
ok "$(trips A)|$(trips B)" "1|1" "h: … each line appears once"
ok "$(recf A task state)$(recf A task closed)|$(recf B task state)$(recf B task closed)" '"tripped"true|"tripped"true' "h: … both records tripped and closed"
dellog 'git-env trip [[B]]'
call; ok "$rc|$(trips B)" "9|1" "h: a trip line deleted by hand is re-appended once by the next check-all"

# ── i: ack refuses while bare; restore clears bare at both levels ────────────────────────────────────────────
scen i
mkt A in_progress
arm A; g -C "$R" config --local extensions.worktreeConfig true; g -C "$R" config --local core.bare true; g -C "$R" config --worktree core.bare true
chk A; ok "$rc" 3 "i: a bare flip → check 3"
ackc A "$(cur)"; ok "$rc" 3 "i: ack while R reads bare → 3"
ok "$(acks)" 0 "i: … no ack line"
rst; ok "$rc" 0 "i: restore → 0"
ok "$(git -C "$R" rev-parse --is-bare-repository)|$(git -C "$R" config --local --get core.bare)|$(git -C "$R" config --worktree --get core.bare || echo unset)" "false|false|unset" \
  "i: … bare cleared in the local and the worktree config"
ackc A "$(cur)"; ok "$rc" 0 "i: then ack --ref <cur> → 0"

# ── j: restore ───────────────────────────────────────────────────────────────────────────────────────────────
scen j
g -C "$R" config --local core.bare true
rst; ok "$rc|$(git -C "$R" rev-parse --is-bare-repository)" "0|false" "j: HEAD on master, a bare flip only → 0, no --drop-local needed"
code; c=$(cur); g -C "$R" checkout -q -b side origin/master
rst; ok "$rc|$(cur)" "2|$c" "j: HEAD elsewhere, a code commit on master, no --drop-local → 2, nothing moved"
rst --drop-local "$c"; ok "$rc|$(cur)" "0|$(cur origin/master)" "j: … with --drop-local <cur> → update-ref to origin/master"
g -C "$R" checkout -q master; code a.txt; c=$(cur); echo dirty >> "$R/a.txt"
rst --drop-local "$c"; ok "$rc|$(cur)" "2|$c" "j: an overlapping dirty change → 2, nothing moved"
scen jm
g -C "$R" update-ref -d refs/heads/master
rst; ok "$rc|$(git -C "$R" rev-parse --verify -q refs/heads/master || echo absent)" "2|absent" "m: the default deleted with HEAD on it → 2, no ref created"
has "$err" "update-ref refs/heads/master" "m: … printing the manual commands"
scen j2
g -C "$R" checkout -q -b forge; code; f=$(cur forge); g -C "$R" checkout -q master
g -C "$R" update-ref refs/remotes/origin/master "$f"
rst; ok "$rc|$(cur origin/master)" "0|$(git -C "$O" rev-parse master)" "j2: a forged origin/master is overwritten by restore's fetch"
scen j3
cpath THREAD.md; c=$(cur)
rst; ok "$rc|$(cur)|$(git -C "$R" config --local --get core.bare)" "2|$c|false" "j3: a local close-out commit, no --drop-local → 2, refs and core.bare unchanged"
has "$err" "close-out § 2.7 wants landed" "j3: … the commit listed and marked as a close-out"
has "$err" "--drop-local $c" "j3: … naming the flag to pass"
rst --drop-local 0000000000000000000000000000000000000000; ok "$rc|$(cur)" "2|$c" "j3: --drop-local <a wrong sha> → 2"
rst --drop-local "$c"; ok "$rc|$(cur)" "0|$(cur origin/master)" "j3: --drop-local <cur> → 0, master equals origin/master"
has "$err" "old master was $c" "j3: … printing the old sha"
rescue=$(printf '%s\n' "$err" | sed -n 's/.*recover with: //p')
has "$rescue" "git-env-rescue-" "j3: … and the git-env-rescue command"
(eval "$rescue") > /dev/null 2>&1
ok "$(git -C "$R" for-each-ref --format='%(objectname)' 'refs/heads/git-env-rescue-*')" "$c" "j3: running it recovers the commit"
scen j4
code; c=$(cur)
rst --drop-local "$c"; ok "$rc|$(cur)|$(git -C "$R" status --porcelain)" "0|$(cur origin/master)|" "j4: a code commit, --drop-local <cur> → 0, master equals origin/master, tree clean"
# j5: the keep-and-ack route with a bare flip and a pending close-out. restore's drop guard must not leave R bare,
# or ack's bare refusal and restore's drop guard send each other round forever.
scen j5
mkt A in_progress
arm A; cpath THREAD.md; b=$(cur); g -C "$R" config --local core.bare true
chk A; ok "$rc" 3 "j5: a bare flip plus a local THREAD.md commit → check 3"
rst; ok "$rc|$(cur)|$(git -C "$R" rev-parse --is-bare-repository)" "2|$b|false" "j5: restore, no --drop-local → 2 at the drop guard, core.bare cleared, B left at the close-out"
has "$err" "ack --ref $b" "j5: … pointing at ack to keep it"
ackc A "$b"; ok "$rc" 0 "j5: then ack --ref <B> → 0"
has "$(grep 'git-env ack' "$RO")" "refs/heads/master at $b, core.bare false" "j5: … the ack line names B"
# j6: --bare-only clears the bareness and moves no ref, even one behind origin (repair § 3e option (b)).
scen j6
g -C "$R" config --local extensions.worktreeConfig true; g -C "$R" config --worktree core.bare true
g -C "$R" update-ref refs/heads/master "$(cur HEAD~1)"; b=$(cur)
rst --bare-only; ok "$rc|$(cur)|$(git -C "$R" rev-parse --is-bare-repository)|$(git -C "$R" config --worktree --get core.bare || echo unset)" "0|$b|false|unset" \
  "j6: restore --bare-only → 0, core.bare cleared at both levels, master left behind origin"
rst --bare-only --drop-local "$b"; ok "$rc" 2 "j6: --bare-only with --drop-local → 2"

# ── k: the env scrub ─────────────────────────────────────────────────────────────────────────────────────────
scen k
mkt A in_progress
g init -q "$S/decoy"; g -C "$S/decoy" commit -q --allow-empty -m decoy; dh=$(git -C "$S/decoy" rev-parse HEAD)
env GIT_DIR="$S/decoy/.git" GIT_CONFIG_PARAMETERS="'core.bare=true'" python3 "$CAN" arm --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > /dev/null 2>&1; krc=$?
ok "$krc|$(recf A task ref)|$(recf A task bare)" "0|\"$(cur)\"|false" "k: GIT_DIR and GIT_CONFIG_PARAMETERS on the invocation: the canary reads R, not bare"
env GIT_DIR="$S/decoy/.git" GIT_CONFIG_PARAMETERS="'core.bare=true'" python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > /dev/null 2>&1
ok "$?|$(git -C "$S/decoy" rev-parse HEAD)" "0|$dh" "k: … its check is clean and the decoy is unchanged"

# ── l: retire ────────────────────────────────────────────────────────────────────────────────────────────────
scen l
mkt A in_progress
arm A; code
can retire; ok "$rc|$(trips A)" "9|1" "l: a leftover differing record → retire's check-all 9, the trip logged"
ok "$([ -d "$THREAD_GIT_ENV_DIR/ro" ] && echo kept)" kept "l: … nothing deleted"
scen l2
mkt A in_progress
arm A; chk A
can retire; ok "$rc" 0 "l: retire when clean → 0"
ok "$([ -d "$THREAD_GIT_ENV_DIR/ro" ] && echo dir || echo gone)|$([ -f "$THREAD_GIT_ENV_DIR/ro.retired" ] && echo y)|$([ -f "$THREAD_GIT_ENV_DIR/ro.lock" ] && echo y)" \
  "gone|y|y" "l: … removes the dir, writes .retired and keeps the .lock"

# ── n: arm compares every record ─────────────────────────────────────────────────────────────────────────────
scen n
mkt A in_progress; mkt B in_progress
arm A; code
arm B; ok "$rc|$(trips A)|$(recf B task state)" '0|1|"armed"' "n: A armed, the ref moves, arm B → A's trip logged, B armed (a task arm under a lane hold)"

# ── q: closed windows ────────────────────────────────────────────────────────────────────────────────────────
scen q1
mkt A in_progress
arm A; code; chk A; ackc A "$(cur)"; code
call; ok "$rc|$(recf A task state)" '0|"acked"' "q1: a trip, an ack, then a commit with no window open → check-all 0, the record acked"
scen q2
mkt A in_progress
arm A; setst A blocked
call; ok "$rc|$(recf A task state)" '0|"checked"' "q2: an orphan (its note blocked) → check-all 0, checked"
code; call; ok "$rc" 0 "q2: … a later commit → 0"
scen q3
mkt A in_progress
arm A; code; setst A blocked
call; ok "$rc|$(recf A task state)|$(recf A task closed)" '9|"tripped"|true' "q3: the commit first, then the orphan → 9 (compared once)"
scen q4
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-03T10:00+00:00'
arm A integrate
python3 - "$V/A.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write("".join(l for l in t.splitlines(True) if not l.startswith("integrating:")))
PY
call; ok "$rc|$(recf A integrate state)" '0|"checked"' "q4: an integrate window closes when integrating: is removed"
scen q5
mkt A in_progress; mkt B in_progress
arm A; arm B; code; chk A; ackc A,B "$(cur)"
ok "$(recf B task state)" '"armed"' "q5: an ack with B's window still open re-baselines it"
chk B; ok "$rc" 0 "q5: … and B's later check → 0: a task window takes its acked trip as it stands (ADR 0053)"

# ── rs: a room stop's stopped verify (execute § Room stop item 9: its `undo` runs with no canary `check`) ────────
# A verify the room stop TaskStopped keeps its window open while the note keeps `integrating:`. The resume entry's
# check-all compares that window; a `check` at the undo adds nothing, and it trips `record not armed` once the window
# is closed (rs2, and a3's second check), so item 9 runs none. rs1 is the half that does not trip: an ack while the
# owner holds re-baselines the window, so a check after it trips nothing, but reports the acked trip (ADR 0053).
scen rs1
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A verify; code
call; ok "$rc|$(recf A verify state)|$(recf A verify closed)" '9|"tripped"|false' "rs1: the stop's window trips at the entry check-all, still open (the owner holds)"
ackc A "$(cur)"; ok "$rc|$(recf A verify state)|$(recf A verify closed)" '0|"armed"|false' "rs1: … an ack while the owner holds re-baselines it"
chk A verify; ok "$rc|$(trips A)" "4|1" "rs1: … and a check after it → 4, no second trip line"
has "$out" "checked [[A]] verify: no verdict" "rs1: … no verdict, never clean"
scen rs2
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A verify; code
call; ok "$rc|$(recf A verify state)" '9|"tripped"' "rs2: the stop's window trips at the entry check-all"
python3 - "$V/A.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write("".join(l for l in t.splitlines(True) if not l.startswith("integrating:")))
PY
ackc A "$(cur)"; ok "$rc|$(recf A verify state)" '0|"acked"' "rs2: integrating: removed before the ack → the record is an acked tombstone"
chk A verify; ok "$rc|$(trips A)" "9|2" "rs2: … a check on it, the commit still local → 9, a second trip line"
has "$(grep 'git-env trip \[\[A\]\]' "$RO" | tail -n 1)" "verify: record not armed, and the state check failed" "rs2: … logged as record not armed with the failed state check"

# ── nv: a window acked mid-run gives no verdict (ADR 0053) ────────────────────────────────────────────────────
# The lead halts on a trip while a verify runs on in the background; Lachy acks; the resumed lead reads the rc and
# checks. The ack re-baselined the open window, so before ADR 0053 that check read clean and the rc was acted on.
for k in verify race-verify integrate; do
  scen "nv-$k"
  mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
  arm A "$k"; old=$(cur); code
  call; ok "$rc|$(recf A "$k" state)" '9|"tripped"' "nv-$k: a commit mid-window trips at a check-all (9), the window still open"
  ackc A "$(cur)"; ok "$rc|$(recf A "$k" state)" '0|"armed"' "nv-$k: … the ack re-baselines it"
  chk A "$k"; ok "$rc|$(trips A)" "4|1" "nv-$k: … its check → 4, no second trip line"
  has "$out" "checked [[A]] $k: no verdict" "nv-$k: … no verdict"
  has "$out" "refs/heads/master ${old}→" "nv-$k: … naming the acked trip"
  call; ok "$rc" 0 "nv-$k: … and check-all after it → 0 (it speaks for the rollout, never 4)"
  arm A "$k"; chk A "$k"; ok "$rc" 0 "nv-$k: a fresh window of the same slug and kind → 0 (the memory is the window's own)"
done
scen nv-task
# A task call's work is taken as it stands (ADR 0053): its check exits 0, naming the acked trip it ran through.
mkt A in_progress
arm A; old=$(cur); code; call; ackc A "$(cur)"
chk A; ok "$rc|$(trips A)" "0|1" "nv-task: a task window acked mid-run → its check 0, no second trip line"
has "$out" "checked [[A]] task: clean, taken as it stands" "nv-task: … taken as it stands"
has "$out" "refs/heads/master ${old}→" "nv-task: … naming the acked trip"
scen nv-rearm
# A Lost-call or § 5 resume arms the same window again before its check: the trip memory must survive that arm.
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A integrate; code; call; ackc A "$(cur)"
can arm --repo "$R" --default master --slug A --kind integrate --resume; ok "$rc" 0 "nv-rearm: a resume's arm (--resume) over the acked, still-open window → 0"
chk A integrate; ok "$rc" 4 "nv-rearm: … and its check still → 4 (the acked trip kept across the re-arm)"
scen nv-rearm-closed
# A usage-limit row: the integrate check (4) closes the window, then the Lost-call resume arms with --resume. The
# trips carry from that closed window, so the resumed call's verdict is still void.
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A integrate; code; call; ackc A "$(cur)"; chk A integrate; ok "$rc" 4 "nv-rearm-closed: the check → 4 and closes the window"
can arm --repo "$R" --default master --slug A --kind integrate --resume; chk A integrate
ok "$rc" 4 "nv-rearm-closed: … the Lost-call resume (--resume) over the closed window still checks 4"
scen nv-rearm-new
# A new run arming over an earlier window nobody checked (a room stop's stopped verify) starts with no memory.
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A verify; code; call; ackc A "$(cur)"
arm A verify; chk A verify; ok "$rc" 0 "nv-rearm-new: a new run's arm (no --resume) over the acked window → its check 0, no inherited trips"
scen nv-open
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A verify; code; call; ackc A "$(cur)"
call; ok "$rc" 0 "nv-open: check-all with the acked window still open → 0"
scen nv-3
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-14T10:00+00:00'
arm A verify; code; call; ackc A "$(cur)"; code
chk A verify; ok "$rc|$(trips A)" "9|2" "nv-3: an acked trip, then a second commit before the check → 9 (a standing trip wins over 4)"

# ── s: --tasks-dir ───────────────────────────────────────────────────────────────────────────────────────────
scen s
mkt A in_progress
for verb in arm check check-all ack retire; do
  case $verb in
    arm|check) TD="$S/nope" can "$verb" --repo "$R" --default master --slug A --kind task ;;
    ack) TD="$S/nope" can ack --repo "$R" --default master --slugs A --ref "$(cur)" ;;
    *) TD="$S/nope" can "$verb" ;;
  esac
  ok "$rc" 2 "s: a nonexistent --tasks-dir → $verb 2"
done
mkdir -p "$S/empty"
arm A; TD="$S/empty" call
ok "$rc|$(recf A task state)" '0|"armed"' "s: a tasks dir lacking A's note → A holds (stays armed)"
has "$err" "WARN: owner note A not found under $S/empty" "s: … with the WARN"
setst A blocked
TD="$S/empty" call; ok "$rc|$(recf A task state)" '0|"armed"' "s: q2 with a wrong existing dir → A stays armed"

# ── t: the lock ──────────────────────────────────────────────────────────────────────────────────────────────
scen t
mkt A in_progress
arm A; chk A; can retire
arm A; ok "$rc|$([ -d "$THREAD_GIT_ENV_DIR/ro" ] && echo dir || echo none)" "2|none" "t: retire, then arm → 2, no dir recreated"
has "$err" "rollout retired" "t: … naming the retirement"
ok "$([ -f "$THREAD_GIT_ENV_DIR/ro.lock" ] && echo y)" y "t: the .lock survives retire"
scen t2
mkt A in_progress
mkdir -p "$THREAD_GIT_ENV_DIR"
holder
THREAD_GIT_ENV_LOCK_TIMEOUT=1 call; ok "$rc" 2 "t: a held lock with THREAD_GIT_ENV_LOCK_TIMEOUT=1 → check-all 2"
has "$err" "timed out" "t: … a timeout"
release
# The wait, proven by what check-all does, not by the clock: check-all runs in the background with the canary's
# fcntl.flock wrapped to log each exclusive attempt (`busy` or `ok`) to $S/flock. The hold is released only once
# a `busy` shows check-all met it, so a final `ok` is the lock taken after waiting for the release.
holder
rm -f "$S/flock"
THREAD_GIT_ENV_LOCK_TIMEOUT=600 python3 - "$CAN" "$S/flock" "$RO" "$V" > "$S/out" 2> "$S/err" <<'PY' &
import importlib.util, sys
can, flog, ro, vault = sys.argv[1:]
spec = importlib.util.spec_from_file_location("canary", can); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
real, log = m.fcntl.flock, open(flog, "a", buffering=1)
def logged(fd, op):
    if not op & m.fcntl.LOCK_EX:
        return real(fd, op)
    try:
        real(fd, op)
    except BlockingIOError:
        log.write("busy\n"); raise
    log.write("ok\n")
m.fcntl.flock = logged
sys.exit(m.main(["check-all", "--rollout", ro, "--tasks-dir", vault]))
PY
cp=$!
await "$cp" grep -qx busy "$S/flock"
release; wait "$cp"; rc=$?
ok "$(head -n 1 "$S/flock" 2>/dev/null)|$(tail -n 1 "$S/flock" 2>/dev/null)|$(grep -cx ok "$S/flock" 2>/dev/null)" "busy|ok|1" \
  "t: check-all meets the held lock (busy), waits, and takes it once the holder releases"
ok "$rc" 0 "t: … and returns 0"

# ── w: arm refuses a window whose owner does not hold (p26-1) ────────────────────────────────────────────────
# A window armed with no owner closes at the next pass, and its own check then trips `record not armed`: a false
# halt that needs Lachy. `arm` refuses it instead (exit 2, nothing written), so the lead's skipped stamp stops at
# the arm. The owner of an integrate, verify or race-verify window is the Integration lane (reconcile-rollout.py
# `_holds_lane`): `integrating:`, or a current `integrated` Integration-log line.
noint() { python3 - "$V/$1.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write("".join(l for l in t.splitlines(True) if not l.startswith("integrating:")))
PY
}
scen w1
mkt A open
arm A task; ok "$rc|$(recf A task state)|$(grep -c git-env "$RO")" "2|<none>|0" "w1: arm a task window on a note that is not running → 2, no record, no log line"
has "$err" "[[A]] is not running" "w1: … stderr names the note"
has "$err" "stamp status: in_progress (execute § 4) first" "w1: … and the § 4 stamp to run"
ok "$(printf '%s\n' "$err" | grep -c 'mark-started')" 0 "w1: … and never mark-started (its own arm runs this refusal, p26-3)"
scen w2
mkt A review 'pr: https://github.com/o/r/pull/1'
for k in integrate verify race-verify; do
  arm A "$k"; ok "$rc|$(recf A "$k" state)|$(grep -c git-env "$RO")" "2|<none>|0" "w2: arm $k on a review note with no integrating: and no log → 2, nothing written"
  has "$err" "holds no integrating:" "w2: … $k: stderr names the missing stamp"
  has "$err" "mark-integrating" "w2: … $k: and the verb to run"
done
# w3: the 2026-10-19 incident. A verify window's tombstone, then `integrating:` removed (an integrate call's
# reconciled row) and the stamp skipped: the arm refuses and leaves the tombstone and the note untouched.
scen w3
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-19T10:00+00:00'
arm A verify; chk A verify; ok "$rc|$(recf A verify state)" '0|"checked"' "w3: a verify window armed and checked → a checked tombstone"
noint A
ro0=$(cksum < "$RO"); rec0=$(cksum < "$(recp A verify)")
arm A verify; ok "$rc|$(recf A verify state)" '2|"checked"' "w3: integrating: removed, arm verify → 2, the tombstone kept"
ok "$(cksum < "$RO")|$(cksum < "$(recp A verify)")" "$ro0|$rec0" "w3: … the rollout note and the record byte-identical"
python3 - "$V/A.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write(t.replace("pr: https://github.com/o/r/pull/1\n", "pr: https://github.com/o/r/pull/1\nintegrating: 2026-10-19T11:00+00:00\n", 1))
PY
arm A verify; ok "$rc" 0 "w3: integrating: stamped again (mark-integrating), arm verify → 0"
chk A verify; ok "$rc|$(trips A)" "0|0" "w3: … its check → 0, no record not armed"
# w4: an integrate call's `integrated` row removes `integrating:`; step 4's RACE re-verify still arms (D2).
A40=$(printf "%040d" 0 | tr 0 a); B40=$(printf "%040d" 0 | tr 0 b); C40=$(printf "%040d" 0 | tr 0 c)
ILINE="2026-10-19T10:30+00:00 integrated path=integrator pr=1 anchor=$A40 head=$B40 base=$C40 wait=1 duration=1 triggers=-"
scen w4
mkt A review 'pr: https://github.com/o/r/pull/1' 'ready: 2026-10-19T10:00+00:00'
printf '\n## Integration log\n\n%s\n' "$ILINE" >> "$V/A.md"
arm A race-verify; ok "$rc" 0 "w4: a current integrated line and no integrating:, arm race-verify → 0"
chk A race-verify; ok "$rc|$(trips A)" "0|0" "w4: … its check → 0, no record not armed"
scen w4b
mkt A review 'pr: https://github.com/o/r/pull/1' 'ready: 2026-10-19T11:00+00:00'
printf '\n## Integration log\n\n%s\n' "$ILINE" >> "$V/A.md"
arm A race-verify; ok "$rc|$(recf A race-verify state)" "2|<none>" "w4b: ready: restamped after the integrated line (a hand-back), arm race-verify → 2, no record"
# w5: a tasks dir lacking the owner's note still counts as holding (fail-closed), so the arm goes ahead.
scen w5
mkt A open
mkdir -p "$S/empty"
TD="$S/empty" arm A task; ok "$rc|$(recf A task state)" '0|"armed"' "w5: a tasks dir lacking A's note → arm 0"
has "$err" "WARN: owner note A not found under $S/empty" "w5: … with the WARN"
# w6: the refusal comes before the pass, so it compares and logs nothing; the next pass still trips A.
scen w6
mkt A in_progress; mkt B open
arm A; code
arm B task; ok "$rc|$(trips A)|$(recf A task state)|$(recf B task state)" '2|0|"armed"|<none>' "w6: A armed, the ref moves, arm B (not running) → 2, A's window untouched"
call; ok "$rc|$(trips A)" "9|1" "w6: … the next check-all trips A"

# w7: the completion verify's window (estate ADR 0009 d6) is the rollout's own: its slug is the rollout's stem, and
# its owner holds while the rollout note is not done, so its check comes before the ceremony's `status: done`.
scen w7
mkt A done
arm A completion-verify; ok "$rc|$(recf A completion-verify state)" "2|<none>" "w7: a completion-verify window slugged by a task → 2, no record"
has "$err" "the rollout's own ([[ro]])" "w7: … stderr names the rollout's own slug"
arm ro completion-verify; ok "$rc|$(recf ro completion-verify state)" '0|"armed"' "w7: arm completion-verify on the open rollout → 0, armed"
chk ro completion-verify; ok "$rc|$(recf ro completion-verify state)|$(trips ro)" '0|"checked"|0' "w7: … its clean check → 0, a checked tombstone"
arm ro completion-verify; code
chk ro completion-verify; ok "$rc|$(trips ro)" "9|1" "w7: re-armed (attempt 2), the ref moves → its check trips (9: the lane held)"
scen w7b
setst ro done   # the rollout note is $V/ro.md
arm ro completion-verify; ok "$rc|$(recf ro completion-verify state)" "2|<none>" "w7b: a done rollout opens no completion-verify window → 2"

# ── m: mark-started arms the task window (p26-3) ─────────────────────────────────────────────────────────────
# The 2026-10-19 incident: a seeded revise launched with `mark-started --start revise` and no `arm --kind task`, so
# its return's check met the first window's `checked` tombstone and tripped `record not armed`, a false halt.
# reconcile-rollout.py mark-started now arms the task window itself (--arm-repo/--arm-default), required while the
# rollout's Project root names an existing directory, after its own refusals and before any write: a failed arm
# writes nothing for that note. Each call keeps its own Run record dir ($S/events), as rr does.
# ms <slugs> [flags...] -> $rc, $out, $err; msa <slugs> [flags...] adds --arm-repo $R --arm-default master.
ms() { local t=$1; shift; HOME="$EH" THREAD_EVENTS_DIR="$S/events" python3 "$RR" mark-started --tasks "$t" --rollout "$RO" --tasks-dir "$V" "$@" > "$S/out" 2> "$S/err"; rc=$?; out=$(cat "$S/out"); err=$(cat "$S/err"); }
msa() { local t=$1; shift; ms "$t" --arm-repo "$R" --arm-default master "$@"; }
slots() { if [ -f "$S/events/ro.jsonl" ]; then grep -c 'slot-taken' "$S/events/ro.jsonl"; else echo 0; fi; }
started() { grep -c '^started: ' "$V/$1.md"; }
scen m1
mkt A in_progress
arm A; chk A; ok "$rc|$(recf A task state)" '0|"checked"' "m1: the first task window armed and checked → a checked tombstone"
msa A --start revise
ok "$rc" 0 "m1: a seeded revise's mark-started --start revise --arm-repo/--arm-default on the tombstone → 0"
ok "$(recf A task state)|$(recf A task closed)|$(recf A task ref)|$(started A)" "\"armed\"|false|\"$(cur)\"|1" "m1: … the task window armed at refs/heads/master, started: stamped"
ok "$(printf '%s\n' "$out" | head -n 1 | cut -c1-16)" "armed [[A]] task" "m1: … the canary's armed line passes through, before the started= line"
chk A; ok "$rc|$(trips A)" "0|0" "m1: the revise returns: check A → 0, no record not armed"
scen m1b
mkt A in_progress
a0=$(cksum < "$V/A.md"); ro0=$(cksum < "$RO")
ms A
ok "$rc" 2 "m1b: mark-started with no --arm-repo/--arm-default on a rollout whose Project root exists → 2"
has "$err" "--arm-repo <repoPath> --arm-default <B>" "m1b: … stderr names both flags"
has "$err" "Git-env canary" "m1b: … and points at execute § 4.5 *Git-env canary*"
ok "$(cksum < "$V/A.md")|$(cksum < "$RO")|$(recf A task state)|$(slots)" "$a0|$ro0|<none>|0" "m1b: … A.md and the rollout note byte-identical, no record, no slot-taken"
# m2: the arm's owner refusal (the § 4 stamp skipped) writes nothing: no started:, the marker kept, no slot-taken.
scen m2
mkt A open 'gates_signed: 2026-10-20T09:00+00:00'
a0=$(cksum < "$V/A.md")
msa A
ok "$rc" 2 "m2: mark-started with the flags on a note not stamped in_progress → 2 (the arm refused)"
has "$err" "[[A]] is not running" "m2: … the canary's refusal passes through"
has "$err" "stamp status: in_progress (execute § 4) first" "m2: … naming the § 4 stamp"
ok "$(printf '%s\n' "$err" | grep -c 'run reconcile-rollout.py mark-started')" 0 "m2: … never 'run mark-started first' out of mark-started itself"
has "$err" "ERROR: A: the task window's arm exited 2; nothing written" "m2: … and mark-started's own line"
ok "$(cksum < "$V/A.md")|$(recf A task state)|$(slots)" "$a0|<none>|0" "m2: … A.md byte-identical (gates_signed: kept, no started:), no record, no slot-taken"
# m3: under a lane hold the task arm arms and mark-started writes (ADR 0046: task calls go on).
scen m3
mkt A in_progress; mkt B in_progress
arm A; code; call; ok "$rc|$(trips A)" "9|1" "m3: A armed, a code commit, check-all → 9 (a lane hold)"
msa B
ok "$rc|$(recf B task state)|$(started B)" '0|"armed"|1' "m3: under the lane hold, mark-started B with the flags → 0, B armed and stamped"
has "$err" "LANE HOLD: " "m3: … the canary's LANE HOLD line passes through"
# m3b: under a bare checkout's hold the arm exits 3 and mark-started writes nothing.
scen m3b
mkt A in_progress; mkt B in_progress
arm A; g -C "$R" config --local core.bare true; call; ok "$rc|$(trips A)" "3|1" "m3b: A armed, a bare flip, check-all → 3 (the whole rollout)"
b0=$(cksum < "$V/B.md")
msa B
ok "$rc|$(cksum < "$V/B.md")|$(recf B task state)" "3|$b0|<none>" "m3b: under the bare hold, mark-started B with the flags → 3, B.md unchanged, no B record"
has "$err" "ERROR: B: the task window's arm exited 3; nothing written" "m3b: … naming the arm's exit"
# m4: R bare at the arm is the canary's own trip.
scen m4
mkt A in_progress
g -C "$R" config --local core.bare true
a0=$(cksum < "$V/A.md")
msa A
ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)" "3|$a0|<none>" "m4: R bare at mark-started's arm → 3, A.md unchanged, no record"
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: core.bare true at arm" "m4: … the canary's core.bare true at arm trip line"
# m5: a resume's own arm after mark-started's compares the window once, then re-baselines it.
scen m5
mkt A in_progress
msa A; r1=$rc; arm A; r2=$rc; chk A
ok "$r1|$r2|$rc|$(trips A)" "0|0|0|0" "m5: mark-started's arm, a resume's own arm, then check → 0, 0, 0, no trip"
scen m5b
mkt A in_progress
msa A; r1=$rc; code; arm A
ok "$r1|$rc|$(trips A)" "0|0|1" "m5b: mark-started's arm, a code commit, then the resume's own arm → one trip line (a task arm under a lane hold arms)"
# m6: --dry-run never runs the canary; the flag requirement still applies.
scen m6
mkt A in_progress
a0=$(cksum < "$V/A.md")
msa A --dry-run
ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)" "0|$a0|<none>" "m6: --dry-run with the flags → 0, A.md unchanged, no record"
has "$out" "A: would arm the task window (dry-run)" "m6: … it says it would arm"
ms A --dry-run; ok "$rc|$(cksum < "$V/A.md")" "2|$a0" "m6: --dry-run with no flags on a Project-root rollout → 2 (it previews the refusal)"
# m7: the flags go together, and need a rollout note to arm against.
scen m7
mkt A in_progress
a0=$(cksum < "$V/A.md")
ms A --arm-repo "$R"; ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)" "2|$a0|<none>" "m7: --arm-repo without --arm-default → 2, nothing written"
has "$err" "--arm-default" "m7: … a usage error naming the pair"
ms A --arm-default master; ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)" "2|$a0|<none>" "m7: --arm-default without --arm-repo → 2, nothing written"
printf -- '---\ntags: [task]\nstatus: in_progress\n---\n\nbody\n' > "$V/H.md"; h0=$(cksum < "$V/H.md")
msa H; ok "$rc|$(cksum < "$V/H.md")|$(recf H task state)" "2|$h0|<none>" "m7: a note with no rollout: and the flags → 2, nothing written"
has "$err" "no rollout note to arm against" "m7: … naming why"
# m8: no Project root line, or a root that does not exist: mark-started behaves as it did (no flags, no arm).
scen m8
mkro -
mkt A in_progress
ms A; ok "$rc|$(started A)|$(recf A task state)" "0|1|<none>" "m8: a rollout with no Project root: line, no flags → 0, started: stamped, no record"
mkro "$S/gone"
mkt B in_progress
ms B; ok "$rc|$(started B)|$(recf B task state)" "0|1|<none>" "m8: a Project root naming a missing directory, no flags → 0, started: stamped, no record"
# m8 fail-closed: a Project root mark-started cannot stat, or a rollout note that exists but cannot be read (the note
# at mode 000, or the note under a mode-000 parent), may need the arm, so with no flags it refuses: exit 2, A.md
# byte-identical, no record, no slot-taken. Python 3.14's Path.is_dir()/is_file() return False on EACCES, so these
# legs fail against a check built on them under python3.14. The modes are restored before the asserts. Skipped as
# root (a mode-000 dir can still be entered).
mslocked() {  # mslocked <name> <path to chmod 000> <restore mode>: ms A on a fresh in_progress A, then the asserts
  a0=$(cksum < "$V/A.md")
  chmod 000 "$2"; ms A; chmod "$3" "$2"
  ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)|$(slots)" "2|$a0|<none>|0" "m8 fail-closed ($1), no flags → 2, A.md byte-identical, no record, no slot-taken"
  has "$err" "--arm-repo <repoPath> --arm-default <B>" "m8 fail-closed ($1): … stderr names both flags"
}
if (mkdir -p "$TMP/m8-probe/d" && chmod 000 "$TMP/m8-probe" && ! [ -e "$TMP/m8-probe/d" ]); then
  chmod 755 "$TMP/m8-probe"
  scen m8-root
  mkdir -p "$S/locked/repo"; mkro "$S/locked/repo"
  mkt A in_progress
  mslocked "a Project root under a mode-000 parent" "$S/locked" 755
  has "$err" "Project root $S/locked/repo cannot be stat'ed" "m8 fail-closed (root): … naming the root it cannot stat"
  scen m8-note
  mkt A in_progress
  mslocked "the rollout note at mode 000" "$RO" 644
  has "$err" "the rollout note $RO cannot be read" "m8 fail-closed (note): … naming the note"
  scen m8-note-dir
  mkdir -p "$S/lockro"; mv "$RO" "$S/lockro/ro.md"; RO="$S/lockro/ro.md"
  mkt A in_progress
  mslocked "the rollout note under a mode-000 parent" "$S/lockro" 755
  has "$err" "the rollout note $RO cannot be read" "m8 fail-closed (note dir): … naming the note"
else
  chmod 755 "$TMP/m8-probe" 2>/dev/null
  echo "SKIP - m8 fail-closed legs (a mode-000 dir can still be entered here)"
fi
# m9: the canary binds --repo to the Project root.
scen m9
mkt A in_progress
a0=$(cksum < "$V/A.md")
ms A --arm-repo "$C2" --arm-default master
ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)" "2|$a0|<none>" "m9: --arm-repo naming another clone → 2 (the canary's binding), nothing written"
has "$err" "is not this rollout's repo" "m9: … the canary names the rollout's repo"
# m10: each slug arms on its own; one refused arm leaves the others armed and stamped.
scen m10
mkt A in_progress; mkt B open
b0=$(cksum < "$V/B.md")
msa A,B
ok "$rc|$(recf A task state)|$(started A)|$(recf B task state)|$(cksum < "$V/B.md")" "2|\"armed\"|1|<none>|$b0" "m10: --tasks A,B, A running and B open → 2; A armed and stamped, B untouched"
# m11: a finished note is refused before the arm.
scen m11
mkt A done
a0=$(cksum < "$V/A.md")
msa A; ok "$rc|$(cksum < "$V/A.md")|$(recf A task state)" "1|$a0|<none>" "m11: a done note with the flags → 1 (refused before the arm), no record"

# ── o: end to end ────────────────────────────────────────────────────────────────────────────────────────────
for variant in ref bare; do
  scen "o-$variant"
  mkt A in_progress; mkt Q open
  printf -- '- [[Q]]\n' >> "$RO"
  arm A
  if [ "$variant" = ref ]; then code; else g -C "$R" config --local core.bare true; fi
  chk A
  nx=$(HOME="$EH" python3 "$RR" next --rollout "$RO" --tasks-dir "$V" --running A)
  if [ "$variant" = ref ]; then
    ok "$rc" 0 "o ($variant): the culprit acts; check A → 0 (a task window)"
    ok "$(printf '%s' "$nx" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["halt"], d["start"], d["restart"], [(t["slug"], t["scope"]) for t in d["gitEnvHold"]], d["laneHold"])')" \
      "None ['Q'] [] [('A', 'lane')] [{'slug': 'A', 'hold': 'git-env'}]" "o ($variant): next → Q starts, the lane held"
  else
    ok "$rc" 3 "o ($variant): the culprit acts; check A → 3"
    ok "$(printf '%s' "$nx" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["halt"], d["start"], d["restart"], [t["slug"] for t in d["gitEnvHold"]])')" \
      "git-env [] [] ['A']" "o ($variant): next → halt git-env, start/restart []"
  fi
  rm -f "$S/merged"
  python3 "$CAN" check-all --rollout "$RO" --tasks-dir "$V" > /dev/null 2>&1 && touch "$S/merged"
  ok "$([ -e "$S/merged" ] && echo merged || echo held)" held "o ($variant): the pre-merge check-all is non-zero (9 or 3), so the merge never runs"
done

# ── pc: the rollout clone and its in-place twin (ADR 0042), invariant pins ──────────────────────────────────────
# R is the rollout clone (the Project root, pc-rollout) and IP its in-place twin (pc), both clones of one bare origin
# served as git@github.com:o/pc.git by the fake ssh, so self-rollout-check.sh --in-place pairs them. Only R is armed:
# peer work in IP, a peer push, a push from R and the twin's fast-forward are clean; R's own non-benign move trips.
cp "$root/tests/fixtures/land/fake-ssh.sh" "$TMP/fake-ssh"; chmod +x "$TMP/fake-ssh"
export GIT_SSH_COMMAND="$TMP/fake-ssh" GIT_SSH_VARIANT=ssh LOG_SSH="$TMP/ssh.log"; : > "$LOG_SSH"
IP=""
pcscen() {
  S="$TMP/$1"; O="$S/srv/o/pc.git"; R="$S/w/pc-rollout"; IP="$S/w/pc"; C2="$S/clone2"; V="$S/vault"; RO="$V/ro.md"
  mkdir -p "$S/srv/o" "$S/w" "$V"
  export THREAD_GIT_ENV_DIR="$S/state" SRV="$S/srv"
  g init -q --bare "$O"
  g init -q "$S/seed"
  echo a > "$S/seed/a.txt"; echo t > "$S/seed/THREAD.md"
  g -C "$S/seed" add -A; g -C "$S/seed" commit -q -m init; g -C "$S/seed" push -q "$O" master
  for c in "$R" "$IP" "$C2"; do g clone -q git@github.com:o/pc.git "$c" 2>/dev/null; done
  mkro "$R"
  echo "== $1"
}
ipcode() { echo "$RANDOM" >> "$IP/${1:-code.txt}"; g -C "$IP" add -A; g -C "$IP" commit -q -m "peer ${1:-code}"; }
pcscen pc1
mkt A in_progress
ok "$(bash "$root/skills/execute/scripts/self-rollout-check.sh" --in-place "$R")" "$IP" "pc: (fixture) R is a rollout clone whose twin is IP"
arm A; ipcode; ipcode THREAD.md; push2
chk A; ok "$rc|$(recf A task state)" '0|"checked"' "pc1: IP's code and THREAD.md commits and a peer push during R's window → clean"
pcscen pc1b
mkt A in_progress
code; arm A; g -C "$R" push -q origin master
ok "$(git -C "$R" rev-parse origin/master)" "$(cur)" "pc1b: (fixture) the push moved R's tracking ref"
chk A; ok "$rc|$(recf A task state)" '0|"checked"' "pc1b: a push from R during its window (the sweep's, edge case 11) → clean"
pcscen pc2
mkt A in_progress
arm A; code
chk A; ok "$rc|$(trips A)" "0|1" "pc2: R's own non-benign commit during its window → a trip"
pcscen pc3
mkt A in_progress
can arm --repo "$IP" --default master --slug A --kind task
ok "$rc" 2 "pc3: arm --repo <the in-place twin> → 2: the twin is never armed"
has "$err" "is not this rollout's repo" "pc3: … naming the rollout's repo"
pcscen pc4
mkt A in_progress
arm A; push2; old=$(git -C "$IP" rev-parse HEAD)
line=$(bash "$root/skills/execute/scripts/self-rollout-check.sh" --refresh-in-place "$R")
has "$line" "in-place: $IP fast-forwarded to origin/master" "pc4: --refresh-in-place R fast-forwards IP during R's integrate window"
ok "$([ "$(git -C "$IP" rev-parse HEAD)" != "$old" ] && echo moved)" moved "pc4: … IP moved"
chk A; ok "$rc|$(recf A task state)" '0|"checked"' "pc4: … and R's check is clean"
unset GIT_SSH_COMMAND GIT_SSH_VARIANT SRV

# ── p: the snippet's guard ───────────────────────────────────────────────────────────────────────────────────
awk '/^# thread:git-env-canary/{on=1; next} /^# end thread:git-env-canary/{on=0} on' "$SKILL" > "$TMP/canary.sh"
ok "$(grep -c 'git-env-canary.py' "$TMP/canary.sh")" 2 "p: the git-env-canary snippet found in execute/SKILL.md"
env -u CLAUDE_PLUGIN_ROOT bash "$TMP/canary.sh" > /dev/null 2> "$TMP/p.err"; prc=$?
ok "$prc" 2 "p: the snippet with CLAUDE_PLUGIN_ROOT unset → 2"
has "$(cat "$TMP/p.err")" "not found" "p: … naming the missing script"

echo
if [ "$fail" -eq 0 ]; then echo "git-env-canary: ALL PASS"; else echo "git-env-canary: FAILED"; fi
exit "$fail"
