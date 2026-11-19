# Shared helpers for the signal tests that run a call in its own process group and check nothing of it is left
# (live-checkout.test.sh LC10, land.test.sh case 22c, self-rollout-check.test.sh's TERM mid-fetch). Source it from the
# repo root after `. tests/lib/assert.sh`. bash 3.2-compatible (macOS).

# gone <pgid>: polls until no process of the group is left (a reaped zombie can't fake a pass), under a 30 s liveness
# bound: a killed group is gone well inside it, and a leaked sleep outlives it. Prints gone, or "no pgid" when <pgid> is
# not a number, or alive, after which it kills the group, so a red run leaves no sleep behind.
gone() {
  local i=0; case ${1:-} in ''|*[!0-9]*) echo "no pgid"; return ;; esac
  while kill -0 -- "-$1" 2>/dev/null; do
    [ "$i" -ge 300 ] && { kill -KILL -- "-$1" 2>/dev/null; echo alive; return; }
    sleep 0.1; i=$((i+1))
  done
  echo gone
}

# hang_ssh <stub> <pgfile>: an executable fake ssh at <stub> that writes its own process group to <pgfile> (whole,
# through <pgfile>.t), then hangs on a non-exec `sleep 300 | cat`, as a stalled connection that BatchMode never refuses.
hang_ssh() {
  printf '#!/usr/bin/env bash\nps -o pgid= -p $$ | tr -d " " > "%s.t"; mv "%s.t" "%s"\nsleep 300 | cat\n' \
    "$2" "$2" "$2" > "$1"
  chmod +x "$1"
}
