# Shell side of tests/lib/handshake.py, the suites' one handshake (a test, never the clock, ends a wait; the
# cap only turns a lost handshake into a loud failure). Source it; bash 3.2-compatible.
#   hs_wait <file> [--cap S] [--pid P]   0 once <file> exists; 3 at the cap, 4 when P ends first (stderr says which)
#   hs_hold <lock> <held file> <release file> [--cap S] &   hold an flock on <lock> until <release file> exists
HANDSHAKE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/handshake.py"
hs_wait() { python3 "$HANDSHAKE" wait "$@"; }
hs_hold() { local lock=$1 held=$2 release=$3; shift 3; python3 "$HANDSHAKE" hold "$lock" --held "$held" --release "$release" "$@"; }
