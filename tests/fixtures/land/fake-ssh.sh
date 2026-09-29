#!/usr/bin/env bash
# Fake ssh for tests/land.test.sh: maps git@github.com:<o>/<r>.git and ssh://git@github.com/<o>/<r>.git to
# the bare repo $SRV/<o>/<r>.git, logging one line per invocation to $LOG_SSH. FAKE_SSH=fail refuses the
# connection; FAKE_SSH=hang runs a non-exec `sleep 40 | cat` child.
printf '%s\n' "$*" >> "$LOG_SSH"
case ${FAKE_SSH:-ok} in
  fail) echo "fake-ssh: connect to host github.com port 22: Connection refused" >&2; exit 255 ;;
  hang) sleep 40 | cat; exit 255 ;;
esac
cmd=${!#}
verb=${cmd%% *}; p=${cmd#* }; p=${p#\'}; p=${p%\'}; p=${p#/}
exec "$verb" "$SRV/$p"
