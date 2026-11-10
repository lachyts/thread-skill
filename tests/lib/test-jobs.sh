# tests/run.sh's cap on its own background suites (p23-4) and their liveness bound. bash 3.2-compatible (macOS).
# Source it.
#
# On 2026-10-17 tests/run.sh, which backgrounded every suite at once, alone drove one 12-core machine to load 66,
# and several rollouts' verifies ran it side by side. The cap keeps `make test` near a third of the cores:
#   suite_cap [cores]    print the cap: THREAD_TEST_JOBS when set (a positive integer; anything else returns 2 and
#                        prints nothing; an empty value is unset), else max(2, ceil(cores / 3)), cores defaulting to
#                        the machine's (getconf _NPROCESSORS_ONLN, then sysctl -n hw.ncpu, then 3). 12 cores give 4.
#   wait_for_room <cap>  block until fewer than <cap> of this shell's background jobs are running.
# CI pins THREAD_TEST_JOBS (.github/workflows/test.yml and full-suite.yml): its 3- and 4-vCPU runners would get the
# floor, 2.
#
# The liveness bound (#327 finding 6, estate ADR 0011 d3: a liveness bound, never a tight wall-clock one). Without it a
# hung suite held a CI job to its timeout-minutes and a local `make test` forever. run.sh runs each spawned suite in a
# process group of its own, watched by watch_group:
#   flat_bound           print THREAD_SUITE_BOUND when set (a positive integer of seconds; anything else returns 2 and
#                        prints nothing; an empty value is unset, and prints nothing).
#   suite_bounds <weights file> [flat]
#                        entries on stdin (run.sh's shard entries: `@merge-task-self-tests` and test paths), one
#                        `<entry><TAB><seconds>` line out per entry, in order. <flat>, when given, is every entry's
#                        bound. Else an entry with a weight in <weights file> (tests/shard-weights.tsv, measured
#                        seconds; its format is tests/lib/shard.py's) gets SUITE_BOUND_FACTOR times it, rounded up, and
#                        at least SUITE_BOUND_FLOOR; an entry with none (a suite added since the weights were measured,
#                        or no weights file) gets SUITE_BOUND_UNWEIGHTED. run.sh bounds each merge-task self-test by
#                        the `@merge-task-self-tests` line. A malformed weights line is skipped here (shard.py refuses
#                        it).
#   bound_or_unweighted <bound>
#                        print <bound> when it is a positive integer (decimal, so 007 is 7), else print
#                        SUITE_BOUND_UNWEIGHTED and return 1. run.sh's spawn passes every bound through it, so a suite
#                        whose bound went missing (an entry suite_bounds printed no line for) is still bounded, and
#                        spawn says so, where watch_group's test on an empty bound would fail and never fire.
#   watch_group <pgid> <bound> <marker> [grace]
#                        while the leader <pgid> lives, poll every SUITE_POLL seconds; once the suite has been awake
#                        <bound> seconds, create <marker> and end the group (end_groups, <grace> defaulting to
#                        SUITE_STOP_GRACE). Run it in the background with its output on /dev/null. Awake seconds, not
#                        elapsed ones: each poll adds the step of its clock (_watch_clock), but a step past
#                        SUITE_POLL_JUMP, or a backwards one, adds one second. bash's SECONDS follows the wall clock,
#                        so a Mac asleep through a verify (lid closed, idle sleep) or a Ctrl-Z on `make test` (the
#                        watchers stop with run.sh, the suites in their own groups run on) would otherwise come back
#                        with every live suite past its bound and kill them all, a false red; the engine likewise
#                        counts Mac sleeps as stops (reconcile-rollout.py's machine_times), and verify-slot.py's bounds
#                        read time.monotonic.
#   _watch_clock         set _watch_now to the clock watch_group reads: SECONDS (no fork, and bash 3.2 has it). A test
#                        redefines it after sourcing: an injected clock (estate ADR 0011 d3).
#   end_groups <grace> [pgid...]
#                        TERM every group at once, wait up to <grace> seconds for all of them to empty, then KILL
#                        whatever is left. No group is a no-op. run.sh's stop_suites ends every live suite this way.
# 3x the measured seconds covers CI macOS's roughly 1.6x local time with margin (tests/leg.test.sh: 527 s, bound
# 1581 s), and a small suite's hang shows red in 5 minutes. SUITE_POLL_JUMP is a few polls' worth: a loaded machine's
# `sleep 1` overruns by far less, and a Mac sleep or a suspend by far more. SUITE_STOP_GRACE sits under
# verify-slot.py's KILL_GRACE (10 s): a guard that ends a run TERMs run.sh's group, and run.sh's own TERM trap then
# KILLs a suite that outlives its TERM before the guard KILLs run.sh's group, which no longer holds the suites.
SUITE_BOUND_FACTOR=3
SUITE_BOUND_FLOOR=300
SUITE_BOUND_UNWEIGHTED=1200
SUITE_STOP_GRACE=5
SUITE_POLL=1
SUITE_POLL_JUMP=5

_test_cores() {
  local c
  c=$(getconf _NPROCESSORS_ONLN 2>/dev/null) || c=
  case "$c" in ''|*[!0-9]*|0) c=$(sysctl -n hw.ncpu 2>/dev/null) || c= ;; esac
  case "$c" in ''|*[!0-9]*|0) c=3 ;; esac
  echo "$c"
}

suite_cap() {
  local cores="${1:-}" j="${THREAD_TEST_JOBS:-}" c
  if [ -n "$j" ]; then
    case "$j" in *[!0-9]*) return 2 ;; esac
    j=$((10#$j))
    [ "$j" -ge 1 ] || return 2
    echo "$j"
    return 0
  fi
  [ -n "$cores" ] || cores=$(_test_cores)
  c=$(( (cores + 2) / 3 ))
  [ "$c" -ge 2 ] || c=2
  echo "$c"
}

wait_for_room() {
  local cap="$1" p
  while p=($(jobs -pr)); [ ${#p[@]} -ge "$cap" ]; do sleep 0.2; done
}

flat_bound() {
  local b="${THREAD_SUITE_BOUND:-}"
  [ -n "$b" ] || return 0
  case "$b" in *[!0-9]*) return 2 ;; esac
  b=$((10#$b))
  [ "$b" -ge 1 ] || return 2
  echo "$b"
}

suite_bounds() {
  local w="$1" flat="${2:-}"
  [ -f "$w" ] || w=/dev/null
  awk -F'\t' -v factor="$SUITE_BOUND_FACTOR" -v floor="$SUITE_BOUND_FLOOR" -v none="$SUITE_BOUND_UNWEIGHTED" \
    -v flat="$flat" '
    phase != 1 { if ($0 !~ /^#/ && NF == 2 && $1 ~ /^[0-9]*\.?[0-9]+$/ && $1 + 0 > 0) w[$2] = $1 + 0; next }
    $0 == "" { next }
    {
      if (flat != "") b = flat
      else if ($0 in w) { b = w[$0] * factor; b = (b > int(b)) ? int(b) + 1 : int(b); if (b < floor) b = floor }
      else b = none
      print $0 "\t" b
    }' "$w" phase=1 -
}

bound_or_unweighted() {
  case "$1" in ''|*[!0-9]*) echo "$SUITE_BOUND_UNWEIGHTED"; return 1 ;; esac
  [ $((10#$1)) -ge 1 ] || { echo "$SUITE_BOUND_UNWEIGHTED"; return 1; }
  echo $((10#$1))
}

_watch_clock() { _watch_now=$SECONDS; }

watch_group() {
  local g="$1" bound="$2" mark="$3" grace="${4:-$SUITE_STOP_GRACE}" up=0 last d
  _watch_clock; last=$_watch_now
  while kill -0 "$g" 2>/dev/null; do
    _watch_clock; d=$((_watch_now - last)); last=$_watch_now
    [ "$d" -ge 0 ] && [ "$d" -le "$SUITE_POLL_JUMP" ] || d=1  # asleep, suspended or a clock change: one poll's second
    up=$((up + d))
    if [ "$up" -ge "$bound" ]; then
      : > "$mark"
      end_groups "$grace" "$g"
      return 0
    fi
    sleep "$SUITE_POLL"
  done
  return 0
}

end_groups() {
  local grace="$1" g t=0 live; shift
  for g in "$@"; do kill -TERM -- "-$g" 2>/dev/null; done
  while [ "$t" -lt $((grace * 5)) ]; do
    live=0
    for g in "$@"; do kill -0 -- "-$g" 2>/dev/null && { live=1; break; }; done
    [ "$live" = 1 ] || return 0
    sleep 0.2; t=$((t + 1))
  done
  for g in "$@"; do kill -KILL -- "-$g" 2>/dev/null; done
  return 0
}
