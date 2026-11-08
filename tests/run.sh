#!/usr/bin/env bash
# The one test entrypoint. `make test` is the full suite (the self-rollout's completion verifier); `make test-fast`
# (`--fast`) is the fast tier (its verifier, ADR 0073 d1); `--only <test file>...` runs the named files; `--shard K/N`
# runs shard K of the full suite split N ways (CI's full-suite.yml, ADR 0073 d3) and `--shard-plan N` prints that
# split and runs nothing. bash 3.2-compatible (macOS).
#
# Modes. Every mode runs the always-run steps (bash and python syntax, the workflow parse, the fast-tier map check)
# and ends with the check that the run wrote nothing into the checkout. Full mode then runs every suite. --fast runs
# only the test files tests/lib/fast-tier.py selects for the diff from THREAD_VERIFY_BASE (ADR 0062), read through
# tests/fast-tier.map, and the full suite when the selector cannot place a changed path (its FULL line). --only runs
# the named collected files, and never the merge-task self-tests. --shard K/N runs shard K of the split
# tests/lib/shard.py makes of the merge-task self-tests and every collected test (its docstring holds the rules; the
# self-tests run in shard 1), so the N shards together run the full suite exactly once; a shard.py failure is a red
# `shard split` step, never a green run of nothing. --shard-plan N prints shard.py's `<k><TAB><entry>` lines for the
# same entries and exits before any step, writing nothing.
#
# Hermetic by construction: HOME and the global git config point into a temp dir, so any stray default
# (reconcile-rollout.py's vault Tasks dir, the Stop hook's ~/.claude/rollout-driver, a git identity) lands in
# temp instead of the real vault or ~/.claude. PYTHONDONTWRITEBYTECODE keeps __pycache__ out of the tree.
#
# Discovery is by explicit globs, not bare `node --test` (which walks the whole tree): node:test files
# and plain exit-code scripts both run under `node --test`; shell suites and the merge-task self-tests
# run concurrently. New suites join by filename — including the protocol 4 branch's, unchanged.
#
# Reporting (p43-6, #327 finding 2). Each suite and each step prints one `<label>: ok (<N>s)` or `<label>: FAILED
# (<N>s)` line the moment it ends, N its own seconds, so a run cut part-way (a CI job at its timeout-minutes) still
# shows every suite that finished, and its times; a suite with no line was still running. Once every background suite
# has ended, each one's output prints grouped under `== <label>`, in spawn order, and only then does node run. The
# verdict line carries the whole run's seconds.
#
# Capped (p23-4): at most `suite_cap` background suites run at once (tests/lib/test-jobs.sh: THREAD_TEST_JOBS,
# else max(2, ceil(cores / 3)), 4 on 12 cores), and node runs that many test files at once. The suites spawn
# roughly longest-first: the two merge-task self-tests, then the shell suites by file size, largest first (`ls -S`;
# no suite path holds a space, tests/test-jobs.test.sh pins it), so no static list can drift.
# THREAD_VERIFY_SLOTS_DIR points into scratch, so a suite that takes a verify slot (verify-slot.py) never waits on
# the machine's pool, nor an inner `make test` on its outer wrapper's slot.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
shopt -s nullglob

usage() { echo "usage: bash tests/run.sh [--fast | --only <test file>... | --shard K/N | --shard-plan N]" >&2; exit 2; }
mode=full; only=(); shard_k=; shard_n=
case "${1:-}" in
  '') ;;
  --fast) mode=fast; shift; [ "$#" -eq 0 ] || usage ;;
  --only) mode=only; shift; [ "$#" -gt 0 ] || usage; only=("$@") ;;
  --shard)
    mode=shard; shift; [ "$#" -eq 1 ] || usage
    case "$1" in */*) shard_k=${1%%/*}; shard_n=${1#*/} ;; *) usage ;; esac
    case "$shard_k" in ''|*[!0-9]*) usage ;; esac
    case "$shard_n" in ''|*[!0-9]*) usage ;; esac
    shard_k=$((10#$shard_k)); shard_n=$((10#$shard_n))
    [ "$shard_k" -ge 1 ] && [ "$shard_k" -le "$shard_n" ] || usage ;;
  --shard-plan)
    mode=plan; shift; [ "$#" -eq 1 ] || usage
    case "$1" in ''|*[!0-9]*) usage ;; esac
    shard_n=$((10#$1)); [ "$shard_n" -ge 1 ] || usage ;;
  *) usage ;;
esac

export PYTHONDONTWRITEBYTECODE=1
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT

# Pin the real interpreters BEFORE swapping HOME: version-manager shims (asdf, mise, pyenv) resolve the
# global version under $HOME and fail inside the temp one. Their resolved dirs go first on PATH.
node_bin=$(node -p 'process.execPath' 2>/dev/null) || { echo "make test: node not found"; exit 1; }
# One python start gives both the interpreter and its user site: a `pip install --user` PyYAML (which
# next-action.py needs) resolves under $HOME too, so pin the real one and the swap hides nothing the
# scripts import. Read-only use; nothing lands there.
py_info=$(python3 -c 'import site, sys; print(sys.executable); print(site.getuserbase())' 2>/dev/null) \
  || { echo "make test: python3 not found"; exit 1; }
py_bin=${py_info%%$'\n'*}
export PYTHONUSERBASE=${py_info#*$'\n'}
export PATH="$(dirname "$node_bin"):$(dirname "$py_bin"):$PATH"

export HOME="$scratch/home"; mkdir -p "$HOME"
# A refused operator rollouts.toml (p15-4) in the scratch HOME: reconcile-rollout.py resolves an absent
# `parallel_ceiling` through rollout-settings.py, which reads ~/.config/thread/rollouts.toml. Every suite pins
# HOME (an empty dir of its own) on each call that reaches the resolver, so this file is never read by a
# passing run; a missed site fails loudly (`next` exits 1, status's ceiling goes null) instead of silently
# reading whatever the scratch HOME holds.
mkdir -p "$HOME/.config/thread"
printf '%s\n' '# Seeded by tests/run.sh and refused on purpose: a suite that reaches rollout-settings.py must pin HOME.' \
  '[defaults]' 'parallel_ceiling = 0' > "$HOME/.config/thread/rollouts.toml"
# The Run record (run_record.py, ADR 0032) lands in temp too, whatever the caller exported; each engine-driving
# suite also sets its own (tests/contracts/run-record-hermetic.test.mjs), so this is the backstop. The one knob,
# THREAD_TEST_EVENTS_DIR, points every such suite at another dir instead: `THREAD_TEST_EVENTS_DIR=<a regular
# file>/events make test` runs them all against an unwritable record (p15-2: recording never breaks a verb).
# The suites that read the record (run-record, the fold and record suites) keep their own dir.
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$scratch/events}"; unset XDG_STATE_HOME
# The session transcripts the weekly reading's attention ledger reads (attention.py, p30-7) stay in temp too: an empty
# dir, so no suite reads this Mac's own sessions; each suite that reads transcripts sets its own.
mkdir -p "$scratch/transcripts"; export THREAD_TRANSCRIPTS_DIR="$scratch/transcripts"
# The machine's verify slots (verify-slot.py, p23-4) stay in temp too: each suite that reaches a pool exports its
# own (tests/contracts/verify-slot-hermetic.test.mjs), so this is the backstop.
export THREAD_VERIFY_SLOTS_DIR="$scratch/verify-slots"
# A serial chain's Chain copies (leg.py copies, ADR 0067 d2) stay in temp too: each suite that makes one exports its own
# (tests/leg.test.sh), so this is the backstop that keeps a missed site out of ~/.local/state/thread/chains.
export THREAD_CHAIN_COPY_DIR="$scratch/chains"
# The Security check (security-check.py, execute § 3 `security_checks`) never reaches the real OSV under test: a closed port, so
# a case that forgets its own stub reads `advisories not checked`, never the network; an inherited THREAD_GITLEAKS is unset, so
# each suite pins its own stub (or finds the real gitleaks itself). Each suite that reaches either sets its own: the backstop.
export THREAD_OSV_URL=http://127.0.0.1:9; unset THREAD_GITLEAKS
# The gate and the lead's Integration verify run this whole suite inside a verify slot, whose command sees
# VERIFY_SLOT_HELD=1 (verify-slot.py, p34-1): unset, so no suite reads its own runs as already inside a slot.
unset VERIFY_SLOT_HELD
# The fast tier reads its reach from that diff base, so it is captured first, then unset below.
verify_base=${THREAD_VERIFY_BASE:-}
# The lead's verify exports its diff base to the suite it runs (ADR 0062): unset, so no inner verify inherits the outer one's.
unset THREAD_VERIFY_BASE
# The Mac's own evidence of a stop (reconcile-rollout.py machine_times: kern.boottime, kern.waketime, `pmset -g log`,
# p29-10) is never read under test: `{}` is no boot and no sleep, so no suite infers a stop from this Mac's history.
# Each suite that tests the stops sets its own.
export THREAD_MACHINE_TIMES='{}'
# The Heat hold's reading (verify-slot.py heat_level, estate ADR 0009 d5) is pinned at nominal, so a hot Mac never
# flips an assertion and an inner `make test` never waits on the real heat; each suite that reaches it pins it too.
export THREAD_HEAT_LEVEL=0
# The note save lock (reconcile-rollout.py's _note_lock_path): one lock file per note directory, in temp like the rest.
export THREAD_NOTE_LOCK_DIR="$scratch/note-locks"
# The Note overlap hook's writer records and default debug log (hooks/vault-note-overlap.py, ADR 0067 d6) stay in temp
# too: its suite sets its own, so this is the backstop; an inherited debug file is unset, so no call logs outside temp.
export THREAD_NOTE_OVERLAP_DIR="$scratch/note-writers"; unset THREAD_NOTE_OVERLAP_DEBUG
export GIT_CONFIG_GLOBAL="$scratch/gitconfig"
# A git hook running `make test` exports GIT_DIR & co. (and `git -c ...` exports GIT_CONFIG_PARAMETERS);
# left set, every git call below and every suite's temp-repo git call (commits, pushes included) would land
# on this checkout's repo and its real remote instead. git's own list of repo-local vars, so none is missed;
# it prints even under a bogus GIT_DIR. Scrubbed before the first git call so the whole runner runs clean.
unset $(git rev-parse --local-env-vars)
git config --global user.name "thread-tests"; git config --global user.email "thread-tests@example.invalid"
git config --global init.defaultBranch main

# Every file the run creates or modifies anywhere in the checkout (untracked dirs and already-dirty files
# included) is newer than this stamp. Finder's .DS_Store churn is the one exemption. The sleep only
# matters where mtimes are whole seconds (APFS and ext4 store nanoseconds, so it is skipped there).
stamp="$scratch/stamp"; : > "$stamp"
python3 -c 'import os,sys; sys.exit(os.stat(sys.argv[1]).st_mtime_ns % 10**9 == 0)' "$stamp" || sleep 1

. tests/lib/test-jobs.sh
max_jobs=$(suite_cap) || { echo "make test: THREAD_TEST_JOBS must be a positive integer, got '${THREAD_TEST_JOBS:-}'"; exit 2; }

fail=0
failed=""
# ended <label> <rc> <start>: the line that says <label> ended, ok or FAILED, and its seconds since <start> (bash's
# SECONDS: no fork, and bash 3.2 has it). One short echo, so two suites ending at once never interleave in a line.
ended() { local w=ok; [ "$2" = 0 ] || w=FAILED; echo "$1: $w ($((SECONDS - $3))s)"; }
step() {  # step <label> <cmd...>
  local label="$1" s=$SECONDS rc; shift
  echo "== $label"
  "$@"; rc=$?
  ended "$label" "$rc" "$s"
  [ "$rc" = 0 ] || { fail=1; failed="$failed
  - $label"; }
}

n=0; labels=()
spawn() {  # spawn <label> <cmd...> — run in background once there is room, capture output + exit code by index,
  # then print its `ended` line from the background, as it ends
  wait_for_room "$max_jobs"
  local label="$1"; shift
  labels[$n]=$label
  { s=$SECONDS; "$@" > "$scratch/$n.out" 2>&1; rc=$?; echo "$rc" > "$scratch/$n.rc"; ended "$label" "$rc" "$s"; } &
  n=$((n+1))
}
report() {  # report <i> — print that suite's block; a non-zero or missing rc fails the run
  local i="$1" rc
  echo "== ${labels[$i]}"
  cat "$scratch/$i.out" 2>/dev/null
  rc=$(cat "$scratch/$i.rc" 2>/dev/null || echo missing)
  [ "$rc" = 0 ] || { fail=1; failed="$failed
  - ${labels[$i]}"; }
}

sh_files=(skills/*/scripts/*.sh hooks/*.sh tests/*.sh tests/lib/*.sh)
py_files=(skills/*/scripts/*.py hooks/*.py tests/lib/*.py)
wf_files=(skills/*/*.workflow.js skills/*/diagnostics/*.workflow.js)
node_tests=(skills/execute/tests/*.test.mjs tests/*.test.mjs tests/contracts/*.test.mjs)
# Largest first: a cheap longest-first order (p23-4), so the long suites start before the cap fills.
sh_tests=($(ls -S skills/execute/tests/*.test.sh tests/*.test.sh))
nl=$'\n'; tab=$'\t'

# --only: every named file is one run.sh collects.
if [ "$mode" = only ]; then
  collected="$nl$(printf '%s\n' ${node_tests[@]+"${node_tests[@]}"} ${sh_tests[@]+"${sh_tests[@]}"})$nl"
  for t in "${only[@]}"; do
    case "$collected" in *"$nl$t$nl"*) ;; *) echo "run.sh: --only $t: not a test file run.sh collects" >&2; usage ;; esac
  done
fi

# shard_split <N>: tests/lib/shard.py's `<k><TAB><entry>` line for the merge-task self-tests and every collected test,
# in run.sh's order (the self-tests, the shell suites largest first, the node files).
shard_split() {
  printf '%s\n' @merge-task-self-tests ${sh_tests[@]+"${sh_tests[@]}"} ${node_tests[@]+"${node_tests[@]}"} \
    | python3 tests/lib/shard.py "$1"
}
# --shard-plan: the dry run. It prints the split and exits before any step; the trap removes scratch.
if [ "$mode" = plan ]; then shard_split "$shard_n"; exit $?; fi

syntax_sh() { local f r=0; for f in "$@"; do bash -n "$f" || r=1; done; return $r; }
# Warnings are errors: an invalid escape such as '\`' in a non-raw string is a silent DeprecationWarning on python
# 3.11 but a SyntaxWarning on stderr on every run from 3.12 (CI's), which breaks each suite that pins an empty
# stderr. Each file is parsed on its own, so one bad file names itself and the rest still get checked.
syntax_py() { python3 -W error::DeprecationWarning -W error::SyntaxWarning -c 'import ast, sys
r = 0
for p in sys.argv[1:]:
    try:
        ast.parse(open(p).read(), p)
    except SyntaxError as e:
        print(f"{p}:{e.lineno}: {e.msg}"); r = 1
sys.exit(r)' "$@"; }

step "bash syntax (${#sh_files[@]} files)"     syntax_sh "${sh_files[@]}"
step "python syntax (${#py_files[@]} files)"   syntax_py "${py_files[@]}"
step "workflow parse (${#wf_files[@]} files)"  bash tests/lib/check-workflow-parse.sh "${wf_files[@]}"
# The map check runs in every mode, so a stale map line turns every run red, not only a run that selects its suite.
step "fast-tier map check"                      python3 tests/lib/fast-tier.py check

# What this run runs: run_sh (largest first, as sh_tests), run_node, and the two merge-task self-tests when self_tests=1.
# keep <list>: the entries of sh_tests and node_tests that the newline-separated <list> names, in their order.
keep() {
  local t
  run_sh=(); run_node=()
  for t in ${sh_tests[@]+"${sh_tests[@]}"}; do case "$nl$1$nl" in *"$nl$t$nl"*) run_sh+=("$t") ;; esac; done
  for t in ${node_tests[@]+"${node_tests[@]}"}; do case "$nl$1$nl" in *"$nl$t$nl"*) run_node+=("$t") ;; esac; done
}
run_sh=(${sh_tests[@]+"${sh_tests[@]}"}); run_node=(${node_tests[@]+"${node_tests[@]}"}); self_tests=1
if [ "$mode" = fast ]; then
  sel=$(python3 tests/lib/fast-tier.py select ${verify_base:+--base "$verify_base"}); src=$?
  head=${sel%%"$nl"*}; picked=""; case "$sel" in *"$nl"*) picked=${sel#*"$nl"} ;; esac
  kind=${head%%"$tab"*}
  if [ "$src" -ne 0 ]; then
    echo "== fast tier: full suite (selector failed (rc $src))"
  elif [ "$kind" = FULL ] && [ "$head" != FULL ]; then
    echo "== fast tier: full suite (${head#FULL"$tab"})"
  elif [ "$kind" = FAST ]; then
    IFS=$tab read -r _ fbase fsource fcount <<< "$head"
    keep "$picked"
    case "$nl$picked$nl" in *"$nl@merge-task-self-tests$nl"*) self_tests=1 ;; *) self_tests=0 ;; esac
    k=$(( ${#run_sh[@]} + ${#run_node[@]} ))
    echo "== fast tier: base ${fbase:0:12} ($fsource), $fcount changed paths, $k test files"
    [ "$self_tests" = 1 ] && echo "   the merge-task self-tests"
    for t in ${run_sh[@]+"${run_sh[@]}"} ${run_node[@]+"${run_node[@]}"}; do echo "   $t"; done
  else
    echo "== fast tier: full suite (selector output unreadable: ${head:0:80})"
  fi
elif [ "$mode" = only ]; then
  keep "$(printf '%s\n' "${only[@]}")"; self_tests=0
elif [ "$mode" = shard ]; then
  # shard_pick: this shard's entries into $mine. A shard.py failure fails the step, and the run then runs no test.
  shard_pick() {
    local split sk se
    split=$(shard_split "$shard_n") || { echo "shard.py failed, so this shard runs no test"; return 1; }
    mine=""
    while IFS=$tab read -r sk se; do [ "$sk" = "$shard_k" ] && mine="$mine$se$nl"; done <<< "$split"
    shard_ok=1
  }
  run_sh=(); run_node=(); self_tests=0; shard_ok=0
  step "shard split" shard_pick
  if [ "$shard_ok" = 1 ]; then
    keep "$mine"
    case "$nl$mine" in *"$nl@merge-task-self-tests$nl"*) self_tests=1 ;; esac
    k=$(( ${#run_sh[@]} + ${#run_node[@]} ))
    echo "== shard $shard_k/$shard_n: $k test files"
    [ "$self_tests" = 1 ] && echo "   the merge-task self-tests"
    for t in ${run_sh[@]+"${run_sh[@]}"} ${run_node[@]+"${run_node[@]}"}; do echo "   $t"; done
  fi
fi

# Independent suites run concurrently (each builds under its own mktemp), at most $max_jobs at a time, each printing
# its line as it ends. Once all have ended, every block (the self-tests', then the shell suites') prints in spawn
# order, before node, which runs at the same concurrency.
echo "== suites: at most $max_jobs at a time"
if [ "$self_tests" = 1 ]; then
  spawn "merge-task classifier self-test"      bash skills/execute/scripts/merge-task.sh --self-test-classify
  spawn "merge-task base self-test"            bash skills/execute/scripts/merge-task.sh --self-test-base
fi
for t in ${run_sh[@]+"${run_sh[@]}"}; do spawn "$t" bash "$t"; done
wait
i=0; while [ "$i" -lt "$n" ]; do report "$i"; i=$((i+1)); done
# A bare `node --test` walks the whole tree, so node runs only when a file is selected.
if [ "${#run_node[@]}" -gt 0 ]; then
  step "node tests (${#run_node[@]} files)"    node --test --test-concurrency="$max_jobs" "${run_node[@]}"
else
  echo "== node tests: none selected"
fi

# A run must leave the checkout exactly as it found it (no bytecode, no stray state files).
tree_unchanged() {
  # .git is git's; .claude holds other sessions' worktrees and merge-task's sentinel and cap state, not this run's output.
  local w; w=$(find "$root" \( -path "$root/.git" -o -path "$root/.claude" \) -prune -o -newer "$stamp" -type f ! -name .DS_Store -print)
  [ -z "$w" ] || { echo "written during the run:"; echo "$w"; return 1; }
}
step "run wrote nothing into the checkout" tree_unchanged

echo
if [ "$fail" -eq 0 ]; then echo "make test: ALL PASS (${SECONDS}s)"; else echo "make test: FAILED (${SECONDS}s)$failed"; fi
exit "$fail"
