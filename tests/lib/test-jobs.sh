# tests/run.sh's cap on its own background suites (p23-4). bash 3.2-compatible (macOS). Source it.
#
# On 2026-10-17 tests/run.sh, which backgrounded every suite at once, alone drove one 12-core machine to load 66,
# and several rollouts' verifies ran it side by side. The cap keeps `make test` near a third of the cores:
#   suite_cap [cores]    print the cap: THREAD_TEST_JOBS when set (a positive integer; anything else returns 2 and
#                        prints nothing; an empty value is unset), else max(2, ceil(cores / 3)), cores defaulting to
#                        the machine's (getconf _NPROCESSORS_ONLN, then sysctl -n hw.ncpu, then 3). 12 cores give 4.
#   wait_for_room <cap>  block until fewer than <cap> of this shell's background jobs are running.
# CI pins THREAD_TEST_JOBS (.github/workflows/test.yml): its 3- and 4-vCPU runners would get the floor, 2.

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
