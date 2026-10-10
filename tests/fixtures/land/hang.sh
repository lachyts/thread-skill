#!/bin/sh
# hang.sh [<pid>] — the hung child of a fake network call (tests/land.test.sh): a non-exec child that keeps its
# stdout open until land.sh kills the call's process group whole. It never outlives a broken kill for long, so a
# regression fails by name, well inside the verifier's timeout, instead of hanging the suite:
#   - it watches <pid> (default: its process group leader, the call land.sh started). If that ends (or is a
#     zombie) while this still runs, the group was not killed whole: it logs `orphan` to $HANG_LOG and exits;
#   - after $HANG_CAP seconds (default 120) it logs `cap` to $HANG_LOG and exits: nothing killed it at all.
w=${1:-$(ps -o pgid= -p $$ | tr -d ' ')}
cap=${HANG_CAP:-120}
n=0
while :; do
  case $(ps -o stat= -p "$w" 2>/dev/null) in
    '' | Z*) echo "orphan: the group leader $w ended before this child was killed" >> "$HANG_LOG"; exit 1 ;;
  esac
  n=$((n + 1))
  [ "$n" -ge $((cap * 5)) ] && { echo "cap: nothing killed this child within ${cap}s" >> "$HANG_LOG"; exit 1; }
  sleep 0.2
done
