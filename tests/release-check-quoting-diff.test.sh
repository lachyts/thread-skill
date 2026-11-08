#!/usr/bin/env bash
# tests/release-check.test.sh on a host whose own `diff` already shell-quotes a path holding a space in its
# `Only in` lines (GNU diffutils 3.12, ubuntu-latest from 2026-11-08). The suite must pass there: its diff
# shim wraps the host's diff, so it must not quote that path a second time.
# The host diff is simulated: a wrapper around this machine's diff that quotes the way 3.12 does, put first
# on PATH for the whole suite run.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
host="$tmp/host-bin"; mkdir -p "$host"; sys_diff=$(type -P diff)
cat > "$host/diff" <<EOF
#!/usr/bin/env bash
# quotes an unquoted name holding a space, as GNU diffutils 3.12 does
"$sys_diff" "\$@" | sed -E "s/^Only in ([^':]* [^':]*): /Only in '\\1': /"; exit "\${PIPESTATUS[0]}"
EOF
chmod +x "$host/diff"

# the simulated host diff prints the 3.12 form, once quoted
mkdir -p "$tmp/q a" "$tmp/q b"; : > "$tmp/q a/only"
has "$("$host/diff" -rq "$tmp/q a" "$tmp/q b")" "Only in '$tmp/q a': only" "the simulated host diff quotes like 3.12"
rm -rf "$tmp/q a" "$tmp/q b"

out=$(PATH="$host:$PATH" bash tests/release-check.test.sh 2>&1); rc=$?
ok "$(printf '%s\n' "$out" | grep -c 'FAIL - the diff shim prints the quoted form')" 0 \
  "release-check.test.sh's diff shim self-check passes on a host diff that already quotes"
ok "$rc" 0 "release-check.test.sh passes on a host diff that already quotes"
[ "$rc" -eq 0 ] || printf '%s\n' "$out" | grep -E '^FAIL|release-check:'

echo; [ "$fail" -eq 0 ] && echo "release-check-quoting-diff: ALL PASS" || echo "release-check-quoting-diff: SOME FAILED"
exit "$fail"
