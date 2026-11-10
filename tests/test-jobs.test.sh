#!/usr/bin/env bash
# p23-4, executed: tests/lib/test-jobs.sh, tests/run.sh's cap on its own background suites (suite_cap,
# wait_for_room) and their liveness bound (flat_bound, suite_bounds, bound_or_unweighted, watch_group, end_groups), and
# the run.sh lines that use them.
# Run under this bash and, when present, under /bin/bash (3.2 on macOS), the shell run.sh is written for. Structural:
# the peak is counted by marker dirs, never timed; watch_group's bounds and end_groups's grace are 1 s, their checks
# liveness-bounded at 10 s; watch_group's awake-seconds count reads an injected clock, never a real sleep.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
trap 'rm -rf "$tmp"' EXIT

# atleast2 <s>: ok when <s> is an integer >= 2.
atleast2() { case "$1" in ''|*[!0-9]*) echo bad ;; *) if [ "$1" -ge 2 ]; then echo ok; else echo bad; fi ;; esac; }
# /bin/bash joins only when it is another file (on a merged-/usr runner it is the same bash as /usr/bin/bash).
shells=("$(command -v bash)")
[ -x /bin/bash ] && ! [ /bin/bash -ef "${shells[0]}" ] && shells+=(/bin/bash)

k=0
for sh in "${shells[@]}"; do
  k=$((k + 1))
  n="$sh ($("$sh" -c 'echo ${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}'))"
  cap() { env -u THREAD_TEST_JOBS "$sh" -c '. tests/lib/test-jobs.sh; suite_cap "$@"; echo "rc=$?"' sh "$@"; }
  capj() { THREAD_TEST_JOBS="$1" "$sh" -c '. tests/lib/test-jobs.sh; suite_cap 12; echo "rc=$?"'; }
  # ---- suite_cap: a third of the cores, at least 2 ----------------------------------------------------------
  for pair in 12:4 4:2 3:2 1:2 16:6 24:8 13:5; do
    ok "$(cap "${pair%%:*}" | tr '\n' ' ')" "${pair##*:} rc=0 " "$n: suite_cap ${pair%%:*} cores → ${pair##*:}"
  done
  got=$(cap | head -1)
  ok "$(atleast2 "$got")" ok "$n: suite_cap with the machine's cores → an integer >= 2 ($got)"
  # ---- THREAD_TEST_JOBS: a positive integer wins; an empty value is unset; anything else is refused ----------
  ok "$(capj 7 | tr '\n' ' ')" "7 rc=0 " "$n: THREAD_TEST_JOBS=7 → 7"
  ok "$(capj 007 | tr '\n' ' ')" "7 rc=0 " "$n: THREAD_TEST_JOBS=007 → 7 (decimal, not octal)"
  ok "$(capj '' | tr '\n' ' ')" "4 rc=0 " "$n: THREAD_TEST_JOBS='' → the default"
  for bad in 0 abc -1 1.5 ' 2'; do
    ok "$(capj "$bad" | tr '\n' ' ')" "rc=2 " "$n: THREAD_TEST_JOBS='$bad' → return 2, nothing printed"
  done
  # ---- wait_for_room: never more than <cap> jobs at once, and every job runs -----------------------------------
  D="$tmp/room-$k"; mkdir -p "$D/in"   # one dir per arm, never shared
  "$sh" -c '. tests/lib/test-jobs.sh
    D=$1
    for i in 1 2 3 4 5 6; do
      wait_for_room 2
      { mkdir "$D/in/$i"; ls "$D/in" | wc -l >> "$D/peaks"; sleep 0.3; ls "$D/in" | wc -l >> "$D/peaks"; rmdir "$D/in/$i"; echo x >> "$D/ran"; } &
    done
    wait' sh "$D"
  peak=$(sort -n "$D/peaks" | tail -1 | tr -d ' ')
  ok "$([ "${peak:-9}" -le 2 ] && echo y || echo "peak $peak")" y "$n: wait_for_room 2 over six jobs: at most 2 at once"
  ok "$(wc -l < "$D/ran" | tr -d ' ')" 6 "$n: … and all six ran"
  # ---- flat_bound: THREAD_SUITE_BOUND, a positive integer; an empty value is unset; anything else is refused --------
  fb() { THREAD_SUITE_BOUND="$1" "$sh" -c '. tests/lib/test-jobs.sh; flat_bound; echo "rc=$?"'; }
  ok "$(fb 7 | tr '\n' ' ')" "7 rc=0 " "$n: THREAD_SUITE_BOUND=7 → 7"
  ok "$(fb 007 | tr '\n' ' ')" "7 rc=0 " "$n: THREAD_SUITE_BOUND=007 → 7 (decimal, not octal)"
  ok "$(fb '' | tr '\n' ' ')" "rc=0 " "$n: THREAD_SUITE_BOUND='' → nothing (each suite's own bound)"
  for bad in 0 abc -1 1.5 ' 2'; do
    ok "$(fb "$bad" | tr '\n' ' ')" "rc=2 " "$n: THREAD_SUITE_BOUND='$bad' → return 2, nothing printed"
  done
  # ---- suite_bounds: 3x the measured seconds rounded up, 300 s floor, 1200 s unweighted; a flat bound wins ----------
  W="$tmp/weights-$k.tsv"
  printf '# a comment\n\n%s\t%s\n' 9 @merge-task-self-tests 527 tests/zzleg.test.sh 100.2 tests/zza.test.sh \
    0.5 tests/zzb.test.sh bad tests/zzc.test.sh > "$W"
  sb() { local w="$1" f="$2"; shift 2; printf '%s\n' "$@" | "$sh" -c '. tests/lib/test-jobs.sh; suite_bounds "$@"' sh "$w" "$f" | tr '\t\n' ': '; }
  ok "$(sb "$W" '' @merge-task-self-tests tests/zzleg.test.sh tests/zza.test.sh tests/zzb.test.sh tests/zzc.test.sh tests/zznew.test.mjs)" \
    "@merge-task-self-tests:300 tests/zzleg.test.sh:1581 tests/zza.test.sh:301 tests/zzb.test.sh:300 tests/zzc.test.sh:1200 tests/zznew.test.mjs:1200 " \
    "$n: suite_bounds: 3x the weight rounded up (527 → 1581, 100.2 → 301), the 300 s floor, 1200 s for no weight or a malformed line"
  ok "$(sb "$tmp/no-such.tsv" '' tests/zzleg.test.sh)" "tests/zzleg.test.sh:1200 " "$n: suite_bounds: no weights file → 1200 s"
  ok "$(sb "$W" 5 tests/zzleg.test.sh @merge-task-self-tests)" "tests/zzleg.test.sh:5 @merge-task-self-tests:5 " "$n: suite_bounds: a flat bound is every entry's"
  # ---- watch_group: a group whose leader outlives its bound is TERMed whole; a group that ignores TERM is KILLed ----
  # wg <group cmd> <bound>: run <group cmd> as a process group of its own, watched; prints `<marker?>|<group gone?>|<s>`.
  wg() {
    "$sh" -c '. tests/lib/test-jobs.sh
      D=$1; rm -f "$D/mark"; s=$SECONDS
      set -m; bash -c "$2" sh "$D" > /dev/null 2>&1 < /dev/null & g=$!; set +m
      watch_group "$g" "$3" "$D/mark" 1 > /dev/null 2>&1
      wait "$g" 2>/dev/null
      n=0; while kill -0 -- "-$g" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.2; n=$((n + 1)); done
      kill -0 -- "-$g" 2>/dev/null && gone=n || gone=y
      [ -e "$D/mark" ] && m=y || m=n
      echo "$m|$gone|$((SECONDS - s))"' sh "$D" "$1" "$2"
  }
  # within <got> <max s>: <got>'s fields 1-2, then `fast` when its seconds are at most <max s> (a liveness bound).
  within() { local m=${1%|*}; [ "${1##*|}" -le "$2" ] && echo "$m|fast" || echo "$m|slow (${1##*|}s)"; }
  ok "$(within "$(wg 'sleep 30 & sleep 30' 1)" 10)" "y|y|fast" "$n: watch_group: a leader past its 1 s bound: marker made, the group (a background child too) gone, well inside 30 s"
  ok "$(within "$(wg "trap '' TERM; sleep 30" 1)" 10)" "y|y|fast" "$n: watch_group: a group that ignores TERM is KILLed after the grace"
  ok "$(within "$(wg 'sleep 0.3' 30)" 10)" "n|y|fast" "$n: watch_group: a leader that ends inside its bound: no marker, and the watch ends with it"
  # ---- watch_group counts awake seconds: a clock step past SUITE_POLL_JUMP (5), or backwards, adds one ---------------
  # An injected clock (estate ADR 0011 d3) at a 0.05 s poll; each read logs `<clock>:<marker made yet?>`. Bound 9: 0, 1
  # (+1), 6 (+5, at SUITE_POLL_JUMP, whole), 3606 (an hour asleep or suspended: +1), 3000 (backwards: +1), 3001 (+1)
  # reaches it at the sixth read. Read as elapsed time, 3606 would end the group at the fourth: the false red of a Mac
  # that slept through a verify. Past its list the clock steps 1 a read, and the group's own 30 s bounds a regression.
  got=$("$sh" -c '. tests/lib/test-jobs.sh
    D=$1; rm -f "$D/mark"; SUITE_POLL=0.05; ts=(0 1 6 3606 3000 3001); i=0; log=
    _watch_clock() {
      if [ "$i" -lt ${#ts[@]} ]; then _watch_now=${ts[i]}; else _watch_now=$((_watch_now + 1)); fi
      i=$((i + 1)); [ -e "$D/mark" ] && log="$log $_watch_now:y" || log="$log $_watch_now:n"
    }
    set -m; bash -c "sleep 30" > /dev/null 2>&1 < /dev/null & g=$!; set +m
    watch_group "$g" 9 "$D/mark" 1 > /dev/null 2>&1
    wait "$g" 2>/dev/null
    n=0; while kill -0 -- "-$g" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.2; n=$((n + 1)); done
    kill -0 -- "-$g" 2>/dev/null && gone=n || gone=y
    [ -e "$D/mark" ] && m=y || m=n
    echo "${log# }|$m|$gone"' sh "$D")
  ok "$got" "0:n 1:n 6:n 3606:n 3000:n 3001:n|y|y" \
    "$n: watch_group: a clock step past SUITE_POLL_JUMP or backwards counts one second, so an hour asleep never ends the group; it still ends at its bound"
  # ---- bound_or_unweighted: a positive integer stands; anything else is the unweighted 1200 s, rc 1 -----------------
  got=$("$sh" -c '. tests/lib/test-jobs.sh
    for b in 301 007 "" abc 0 00 -5 1.5; do r=$(bound_or_unweighted "$b"); echo "$b=$r/$?"; done' | tr '\n' ' ')
  ok "$got" "301=301/0 007=7/0 =1200/1 abc=1200/1 0=1200/1 00=1200/1 -5=1200/1 1.5=1200/1 " \
    "$n: bound_or_unweighted: 301 and 007 (decimal) stand; empty, abc, 0, 00, -5 and 1.5 fall back to 1200 s with rc 1"
  # ---- end_groups: every group TERMed at once; one that ignores TERM is KILLed after the grace ------------------------
  got=$("$sh" -c '. tests/lib/test-jobs.sh
    s=$SECONDS
    set -m
    bash -c "trap \"\" TERM; sleep 30 & sleep 30" > /dev/null 2>&1 < /dev/null & a=$!
    bash -c "sleep 30 & sleep 30" > /dev/null 2>&1 < /dev/null & b=$!
    set +m
    sleep 0.3
    end_groups 1 "$a" "$b"
    wait "$a" "$b" 2>/dev/null
    n=0; while { kill -0 -- "-$a" || kill -0 -- "-$b"; } 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.2; n=$((n + 1)); done
    { kill -0 -- "-$a" || kill -0 -- "-$b"; } 2>/dev/null && gone=n || gone=y
    end_groups 1; echo "$?|$gone|$((SECONDS - s))"')
  ok "$(within "$got" 10)" "0|y|fast" \
    "$n: end_groups: two groups (one ignores TERM) both gone after a 1 s grace, background children too; no group is a no-op"
done

# ---- run.sh uses it ----------------------------------------------------------------------------------------
run=$(cat tests/run.sh)
has "$run" '. tests/lib/test-jobs.sh' "run.sh sources tests/lib/test-jobs.sh"
has "$run" 'max_jobs=$(suite_cap) || {' "run.sh: the cap comes from suite_cap, and a bad THREAD_TEST_JOBS stops the run"
has "$run" 'echo "== suites: at most $max_jobs at a time"' "run.sh prints the cap"
ok "$(awk '/^spawn\(\) \{/{on=1} on && /wait_for_room "\$max_jobs"/{print "y"; exit} on && /^\}/{exit}' tests/run.sh)" y "run.sh: spawn() waits for room first"
has "$run" 'node --test --test-concurrency="$max_jobs" --test-timeout=600000' \
  "run.sh: node runs at the same concurrency, each test file bounded at 10 minutes"
has "$run" 'flat=$(flat_bound) || {' "run.sh: a bad THREAD_SUITE_BOUND stops the run"
ok "$(awk '/^spawn\(\) \{/{on=1} on && /set -m; "\$@"/{a=1} on && /watch_group "\$pid" "\$bound"/{b=1} on && /^\}/{exit} END{print (a && b) ? "y" : "n"}' tests/run.sh)" y \
  "run.sh: spawn() runs each suite as a process group of its own, watched by watch_group"
ok "$(awk '/^spawn\(\) \{/{on=1} on && /bound=\$\(bound_or_unweighted "\$2"\) \|\|/{print "y"; exit} on && /^\}/{exit}' tests/run.sh)" y \
  "run.sh: spawn() passes its bound through bound_or_unweighted, so a missing bound never leaves a suite unbounded"
ok "$(awk '/^stop_suites\(\) \{/{on=1} on && /end_groups "\$SUITE_STOP_GRACE"/{print "y"; exit} on && /^\}/{exit}' tests/run.sh)" y \
  "run.sh: stop_suites() ends the live groups through end_groups (TERM, then KILL after the grace)"
has "$run" 'export THREAD_VERIFY_SLOTS_DIR="$scratch/verify-slots"' "run.sh: the verify slots stay in scratch"
has "$run" 'sh_tests=($(ls -S skills/execute/tests/*.test.sh tests/*.test.sh))' "run.sh: the shell suites spawn largest first"
# `ls -S` is word-split into the array, so no suite path may hold whitespace.
ok "$(ls skills/execute/tests/*.test.sh tests/*.test.sh | grep -c '[[:space:]]')" 0 "no shell suite path holds whitespace (run.sh word-splits ls -S)"
# CI pins the cap and keeps its job names (ADR 0025).
ci=$(cat .github/workflows/test.yml)
has "$ci" 'THREAD_TEST_JOBS: "4"' "CI pins THREAD_TEST_JOBS to 4"
has "$ci" 'name: make test (${{ matrix.os }})' "CI keeps its job name (the required-check context)"
has "$ci" 'os: [ubuntu-latest, macos-latest]' "CI keeps its matrix"

echo; [ "$fail" -eq 0 ] && echo "test-jobs: ALL PASS" || echo "test-jobs: SOME FAILED"
exit "$fail"
