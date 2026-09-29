#!/usr/bin/env bash
# Fake ssh for tests/land.test.sh: maps git@github.com:<o>/<r>.git and ssh://git@github.com/<o>/<r>.git to
# the bare repo $SRV/<o>/<r>.git, logging one line per invocation to $LOG_SSH. FAKE_SSH=fail refuses the
# connection; FAKE_SSH=hang runs a non-exec `sleep 40 | cat` child; FAKE_SSH=move moves the server's
# master on by one empty commit just before a push, so a push that fetched first is still rejected.
printf '%s\n' "$*" >> "$LOG_SSH"
case ${FAKE_SSH:-ok} in
  fail) echo "fake-ssh: connect to host github.com port 22: Connection refused" >&2; exit 255 ;;
  hang) sleep 40 | cat; exit 255 ;;
esac
cmd=${!#}
verb=${cmd%% *}; p=${cmd#* }; p=${p#\'}; p=${p%\'}; p=${p#/}
if [ "${FAKE_SSH:-}" = move ] && [ "$verb" = git-receive-pack ]; then
  g="$SRV/$p"; t=$(git --git-dir "$g" rev-parse refs/heads/master)
  n=$(git --git-dir "$g" commit-tree -p "$t" -m "origin: moved" "$t^{tree}")
  git --git-dir "$g" update-ref refs/heads/master "$n" "$t"
fi
exec "$verb" "$SRV/$p"
