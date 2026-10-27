#!/usr/bin/env bash
# p29-10 (ADR 0051): merge-task.sh records why main moved. Each newly counted exit-3 refusal (the cap's 4th included)
# runs lead-integrate.py base-moved, which writes one base-moved line into the task's rollout record: the movers
# base..main and whether only Inert paths moved. "This base was already counted" writes none, and recording never
# changes an exit or a line of output. Driven end to end against the shared fake gh and a real bare "GitHub" repo
# (tests/lib/merge-task-env.sh); the vault (the task note whose pr: names the PR) and the record live in temp.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)

tmp=$(mktemp -d); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
export THREAD_EVENTS_DIR="$tmp/events"   # this suite reads the record, so it keeps its own (not THREAD_TEST_EVENTS_DIR)
export HOME="$tmp/home" PYTHONDONTWRITEBYTECODE=1 THREAD_NOTE_LOCK_DIR="$tmp/note-locks"
VT="$HOME/repos/obsidian/Work/Tasks"; mkdir -p "$VT"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n## Queue\n\n- [[t5]]\n' > "$VT/ro.md"
printf -- '---\ntags: [task]\nstatus: review\nrollout: "[[ro]]"\npr: https://github.com/o/r/pull/5\n---\n\nt5\n' > "$VT/t5.md"
rec() {  # rec <python expr over L, ro's record lines>
  python3 - "$THREAD_EVENTS_DIR/ro.jsonl" "$1" <<'PY'
import json, sys
try:
    L = [json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
except (FileNotFoundError, NotADirectoryError):
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY
}
moved() {  # moved: X, a commit on srv's master after B (a peer's push), what GitHub's ref read returns
  X=$(mk "$B" moved); git --git-dir "$MT_SRV" update-ref refs/heads/master "$X"; echo "$X" > "$MT_STATE/base.seq"
}

# 1. a newly counted exit 3: one base-moved line, refusal 1, its mover a peer's push
fresh; pair; mkpr 5 "$I"; moved
run 5 "$I" "$B"
ok "$rc" 3 "1. base moved: exit 3"
ok "$(rec 'len(L)')" 1 "1. one base-moved line"
ok "$(rec '[L[0]["kind"], L[0]["task"], L[0]["pr"], L[0]["base"], L[0]["main"], L[0]["refusal"], L[0]["moversTotal"], L[0]["movers"]]')" \
  "[\"base-moved\",\"t5\",5,\"$B\",\"$X\",1,1,[{\"sha\":\"$X\",\"kind\":\"peer\"}]]" "1. its task, PR, base, main, refusal 1 and the peer push that moved main"
ok "$(rec '[L[0]["inertOnly"], L[0]["repo"]]')" '[false,"o/r"]' "1. no inert_paths: inertOnly false; the repo by its origin"
OUT1=$out

# 2. the same refusal again: "this base was already counted", no line
run 5 "$I" "$B"
ok "$rc" 3 "2. the same base again: exit 3"
has "$out" "this base was already counted" "2. … already counted"
ok "$(rec 'len(L)')" 1 "2. no second line"

# 3. the cap: the 4th distinct refusal sets the task aside (exit 4) and is recorded too, refusal 4
b() { printf '%040d' "$1"; }
fresh; pair; mkpr 5 "$I"; moved; seed 5 "$(b 1)" "$(b 2)" "$(b 3)"
run 5 "$I" "$B"
ok "$rc" 4 "3. the 4th refusal: exit 4"
ok "$(rec '[L[-1]["refusal"], L[-1]["base"]]')" "[4,\"$B\"]" "3. … and its line, refusal 4"
ok "$(rec 'len(L)')" 2 "3. one line for it"

# 4. an unwritable record: the same exit and the same output
fresh; pair; mkpr 5 "$I"; moved
run 5 "$I" "$B"; rc_w=$rc; out_w=$out
rm -f "$tmp/repo/.claude/merge-task/5.base-moved"
: > "$tmp/not-a-dir"
THREAD_EVENTS_DIR="$tmp/not-a-dir/events" run 5 "$I" "$B"
ok "$rc|$(sent)" "$rc_w|failed:3" "4. an unwritable record: the same exit, failed:3"
ok "$out" "$out_w" "4. … and the same output"
has "$OUT1" "BASE MOVED: origin/master is" "4. (the output names the move)"

echo; [ "$fail" -eq 0 ] && echo "merge-task-base-moved: ALL PASS" || echo "merge-task-base-moved: SOME FAILED"
exit "$fail"
