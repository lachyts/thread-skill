#!/usr/bin/env bash
# p23-4, executed: tests/lib/test-jobs.sh, tests/run.sh's cap on its own background suites (suite_cap,
# wait_for_room), and the run.sh lines that use it. Run under this bash and, when present, under /bin/bash (3.2 on
# macOS), the shell run.sh is written for. Structural: the peak is counted by marker dirs, never timed.
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
done

# ---- run.sh uses it ----------------------------------------------------------------------------------------
run=$(cat tests/run.sh)
has "$run" '. tests/lib/test-jobs.sh' "run.sh sources tests/lib/test-jobs.sh"
has "$run" 'max_jobs=$(suite_cap) || {' "run.sh: the cap comes from suite_cap, and a bad THREAD_TEST_JOBS stops the run"
has "$run" 'echo "== suites: at most $max_jobs at a time"' "run.sh prints the cap"
ok "$(awk '/^spawn\(\) \{/{on=1} on && /wait_for_room "\$max_jobs"/{print "y"; exit} on && /^\}/{exit}' tests/run.sh)" y "run.sh: spawn() waits for room first"
has "$run" 'node --test --test-concurrency="$max_jobs"' "run.sh: node runs at the same concurrency"
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
