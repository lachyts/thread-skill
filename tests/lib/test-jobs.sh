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
#   watch_group <pgid> <bound> <marker> [grace]
#                        while the leader <pgid> lives, poll once a second; once it has lived <bound> seconds, create
#                        <marker> and end the group (end_groups, <grace> defaulting to SUITE_STOP_GRACE). Run it in the
#                        background with its output on /dev/null.
#   end_groups <grace> [pgid...]
#                        TERM every group at once, wait up to <grace> seconds for all of them to empty, then KILL
#                        whatever is left. No group is a no-op. run.sh's stop_suites ends every live suite this way.
# 3x the measured seconds covers CI macOS's roughly 1.6x local time with margin (tests/leg.test.sh: 527 s, bound
# 1581 s), and a small suite's hang shows red in 5 minutes. SUITE_STOP_GRACE sits under verify-slot.py's KILL_GRACE
# (10 s): a guard that ends a run TERMs run.sh's group, and run.sh's own TERM trap then KILLs a suite that outlives its
# TERM before the guard KILLs run.sh's group, which no longer holds the suites.
SUITE_BOUND_FACTOR=3
SUITE_BOUND_FLOOR=300
SUITE_BOUND_UNWEIGHTED=1200
SUITE_STOP_GRACE=5

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

watch_group() {
  local g="$1" bound="$2" mark="$3" grace="${4:-$SUITE_STOP_GRACE}" s=$SECONDS
  while kill -0 "$g" 2>/dev/null; do
    if [ $((SECONDS - s)) -ge "$bound" ]; then
      : > "$mark"
      end_groups "$grace" "$g"
      return 0
    fi
    sleep 1
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
