#!/usr/bin/env bash
# p23-4, executed: tests/lib/test-jobs.sh, tests/run.sh's cap on its own background suites (suite_cap,
# wait_for_room) and their liveness bound (flat_bound, suite_bounds, bound_or_unweighted, watch_group, end_groups), and
# the run.sh lines that use them; and (p54-3, ADR 0084 d4) run.sh's bytecode cache and node's longest-first order.
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
  # ---- suite_bounds: 10x the measured seconds rounded up, 300 s floor, 1200 s unweighted; a flat bound wins ---------
  W="$tmp/weights-$k.tsv"
  printf '# a comment\n\n%s\t%s\n' 9 @merge-task-self-tests 527 tests/zzleg.test.sh 100.25 tests/zza.test.sh \
    0.5 tests/zzb.test.sh bad tests/zzc.test.sh > "$W"
  sb() { local w="$1" f="$2"; shift 2; printf '%s\n' "$@" | "$sh" -c '. tests/lib/test-jobs.sh; suite_bounds "$@"' sh "$w" "$f" | tr '\t\n' ': '; }
  ok "$(sb "$W" '' @merge-task-self-tests tests/zzleg.test.sh tests/zza.test.sh tests/zzb.test.sh tests/zzc.test.sh tests/zznew.test.mjs)" \
    "@merge-task-self-tests:300 tests/zzleg.test.sh:5270 tests/zza.test.sh:1003 tests/zzb.test.sh:300 tests/zzc.test.sh:1200 tests/zznew.test.mjs:1200 " \
    "$n: suite_bounds: 10x the weight rounded up (527 → 5270, 100.25 → 1003), the 300 s floor (9 → 300), 1200 s for no weight or a malformed line"
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
has "$run" 'node tests/lib/node-run.mjs --test-concurrency="$max_jobs" --test-timeout=1200000 "${run_node[@]}"' \
  "run.sh: node runs at the same concurrency, each test file bounded at 20 minutes, through node-run.mjs (it keeps the order)"
# ---- the real bounds clear macOS CI: PR #373's first CI run (factor 3) killed tests/unfinished-rollout.test.sh at 336 s
# and tests/leg.test.sh at 1581 s, both healthy. The slowest passing macos-latest times seen, 19 jobs (PR full runs and
# master's shards, 2026-11-10 to 11), each needing a bound at least 1.5x it from the real tests/shard-weights.tsv; node's
# --test-timeout bounds a whole file (tests/reflect-weekly.test.mjs, about 512 s there, its tests' duration_ms summed).
# leg.test.sh's 1581 s and 1891 s are now split across its four files (p54-9), 1891 by the parts' measured shares.
# A weights regenerate or a factor change that would kill one of them on CI is red here first.
ci_max="tests/leg.test.sh 550
tests/leg-land.test.sh 565
tests/leg-rank.test.sh 355
tests/leg-security.test.sh 421
tests/lead-integrate.test.sh 735
tests/unfinished-rollout.test.sh 613
tests/primary-refresh.test.sh 543
tests/land.test.sh 297
tests/serial-chains.test.sh 163"
bounds=$(printf '%s\n' "$ci_max" | awk '{print $1}' | bash -c '. tests/lib/test-jobs.sh; suite_bounds tests/shard-weights.tsv')
bad=""
while read -r t m; do
  b=$(printf '%s\n' "$bounds" | awk -F'\t' -v t="$t" '$1 == t { print $2 }')
  [ "$((${b:-0} * 2))" -ge "$((m * 3))" ] || bad="$bad $t=${b:-none}<1.5x$m"
done <<< "$ci_max"
ok "${bad# }" "" "run.sh: each suite's bound from the real weights is at least 1.5x its slowest passing macOS CI time"
nt=$(grep -o 'test-timeout=[0-9]*' tests/run.sh | head -1); nt=${nt#test-timeout=}
ok "$([ "${nt:-0}" -ge $((512 * 1500)) ] && echo ok || echo "${nt:-none} ms")" ok \
  "run.sh: node's --test-timeout is at least 1.5x the slowest node file's macOS CI time (512 s)"
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
# CI pins the cap and keeps its job name (ADR 0025).
ci=$(cat .github/workflows/test.yml)
has "$ci" 'THREAD_TEST_JOBS: "4"' "CI pins THREAD_TEST_JOBS to 4"
has "$ci" 'name: make test (${{ matrix.os }})' "CI keeps its job name (the required-check context)"
has "$ci" 'os: [ubuntu-latest]' "CI's PR check runs on ubuntu alone (ADR 0084 d3)"
# The Slow tier (p54-1, ADR 0084 d3): GitHub's PR check leaves it out, run.sh unsets the flag so no suite inherits it,
# and master's full suite never sets it. tests/fast-tier.test.sh G1-G6 pins what the flag does.
has "$ci" 'THREAD_SKIP_SLOW: "1"' "CI's PR check sets THREAD_SKIP_SLOW=1"
has "$run" 'skip_slow=${THREAD_SKIP_SLOW:-}' "run.sh captures THREAD_SKIP_SLOW"
ok "$(grep -c '^unset THREAD_SKIP_SLOW$' tests/run.sh)" 1 "run.sh unsets THREAD_SKIP_SLOW, so no suite inherits it"
ok "$(grep -c THREAD_SKIP_SLOW .github/workflows/full-suite.yml)" 0 "master's full-suite.yml never sets THREAD_SKIP_SLOW"

# ---- node's files longest first (p54-3): `node --test` sorts its arguments by path, so run.sh orders them with
# shard.py --order from tests/shard-weights.tsv's measured seconds and passes them to node-run.mjs, which keeps the order
# (tests/fast-tier.test.sh F23 runs it on a fixture). From the real weights, the slowest node file goes first.
has "$run" 'ordered=$(printf '"'"'%s\n'"'"' "${node_tests[@]}" | python3 tests/lib/shard.py --order)' \
  "run.sh: node's files are ordered by shard.py --order"
first=$(printf '%s\n' skills/execute/tests/*.test.mjs tests/*.test.mjs tests/contracts/*.test.mjs | python3 tests/lib/shard.py --order | head -1)
ok "$first" tests/reflect-weekly.test.mjs "run.sh: from the real weights, node's first file is tests/reflect-weekly.test.mjs, the slowest"
ok "$(ls skills/execute/tests/*.test.mjs tests/*.test.mjs tests/contracts/*.test.mjs | grep -c '[[:space:]]')" 0 \
  "no node test path holds whitespace (run.sh word-splits shard.py's order)"

# ---- the bytecode cache (p54-3, ADR 0084 d4): run.sh warms a scratch prefix once and exports it to every suite ---------
has "$run" 'export PYTHONPYCACHEPREFIX="$scratch/pyc"' "run.sh exports a scratch bytecode prefix to every suite and node file"
has "$run" 'python3 -m compileall -q' "run.sh warms it with compileall"
# leg.py loads reconcile-rollout.py by path after `sys.dont_write_bytecode = True`, which stops a write and never a read.
# A marker .pyc for the engine, in a prefix of this suite's own (the run's shared prefix is never written): leg.py run
# under it prints the marker, so a script a suite runs reads its bytecode from the prefix. PYTHONDONTWRITEBYTECODE is
# unset for that run, so it would write if it could, and the tree still gets no bytecode.
rr=$(cd skills/execute/scripts && pwd -P)/reconcile-rollout.py
P="$tmp/pyc"; : > "$tmp/pyc.stamp"
PYTHONPYCACHEPREFIX="$P" python3 - "$rr" <<'PY'
import importlib.util, marshal, os, sys
src = sys.argv[1]; st = os.stat(src)
pyc = importlib.util.cache_from_source(src)
os.makedirs(os.path.dirname(pyc), exist_ok=True)
code = compile('print("zz-pyc-marker"); raise SystemExit(7)', src, "exec")
with open(pyc, "wb") as f:  # PEP 552's timestamp header: magic, flags 0, the source's mtime and size
    f.write(importlib.util.MAGIC_NUMBER + (0).to_bytes(4, "little") + (int(st.st_mtime) & 0xFFFFFFFF).to_bytes(4, "little")
            + (st.st_size & 0xFFFFFFFF).to_bytes(4, "little") + marshal.dumps(code))
PY
# legs [<python flag>]: leg.py's status verb on a note that does not exist; it loads the engine before it reads the note.
legs() { HOME="$tmp" python3 "$@" skills/execute/scripts/leg.py status --rollout "$tmp/zz-none.md" 2>&1; }
got=$(PYTHONPYCACHEPREFIX="$P" PYTHONDONTWRITEBYTECODE='' legs); grc=$?
ok "$grc|$got" "7|zz-pyc-marker" "bytecode cache: leg.py reads the engine's bytecode from the prefix, its dont_write_bytecode notwithstanding"
got=$( (unset PYTHONPYCACHEPREFIX; legs) | grep -c zz-pyc-marker)
ok "$got" 0 "bytecode cache: … control: with no prefix it compiles the source and never sees the marker"
ok "$(find skills hooks -newer "$tmp/pyc.stamp" \( -name '*.pyc' -o -name __pycache__ \) -print | head -3)" "" \
  "bytecode cache: … and neither run left bytecode or a __pycache__ in the tree"
# run.sh's own prefix: exported to this suite, warmed with the engine's .pyc, and the one a real engine load reads.
if [ -n "${PYTHONPYCACHEPREFIX:-}" ]; then
  warm=$(python3 -c 'import importlib.util, sys; print(importlib.util.cache_from_source(sys.argv[1]))' "$rr")
  if [ "${warm#"$PYTHONPYCACHEPREFIX"/}" = "$warm" ]; then got="outside the prefix: $warm"
  elif [ -f "$warm" ]; then got=y; else got="no $warm"; fi
  ok "$got" y \
    "bytecode cache: run.sh's prefix holds the engine's warmed .pyc"
  ok "$(legs -v | grep -cF "code object from '$warm'")" 1 \
    "bytecode cache: … and leg.py's engine load reads it"
  # Under a prefix python never reads a __pycache__, so the stdlib (and PyYAML, where it is installed) is warmed too, or
  # every launch of every suite would compile it.
  got=$(python3 -c 'import argparse, importlib.util, os, sys
mods = [argparse]
try:
    import yaml; mods.append(yaml)
except ImportError:
    pass
print(" ".join(m.__name__ for m in mods if not os.path.isfile(importlib.util.cache_from_source(m.__file__))))')
  ok "$got" "" "bytecode cache: … and holds the stdlib's and PyYAML's bytecode too (argparse, yaml)"
else
  ok "unset" "set" "bytecode cache: PYTHONPYCACHEPREFIX is set (run this suite through bash tests/run.sh)"
fi

echo; [ "$fail" -eq 0 ] && echo "test-jobs: ALL PASS" || echo "test-jobs: SOME FAILED"
exit "$fail"
