#!/usr/bin/env bash
# p17-1: what the lead feeds an Integration, pinned next to the other execute suites (the task's Verify line).
# A thin suite: the full cases live with their git, gh and vault fixtures in tests/lead-integrate.test.sh (C10 the
# landed list, C22 `inputs --row`), and the lane's order is reconcile-rollout-queue.test.sh's `lane-order`.
#   L1  lead-integrate.py _landed skips a commit pushed without a PR (listed in `unlisted`), never dropping the list.
#   R1  `inputs --row` refuses a stale saved row (the incident: blocked, no PR, 0 rounds) and falls back to the note.
#   R2  … and takes an approving row that matches the note.
#   M1-M6 (p55-3, ADR 0085 d8) `set-aside --merge-task` cuts step 4's set-aside reason from merge-task's own output by
#       the sentinel's code (1, 2, 4, 8, a signal, a missing sentinel; Codex's file too), and refuses each mistake of
#       the lead's typing with a `lead error:` line, exit 2; both modes or neither is argparse's usage.
# Usage: bash integration-inputs.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HERE="$(cd "$(dirname "$0")" && pwd)"
LI="$HERE/../scripts/lead-integrate.py"
TMP=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False))' "$2"; }

# ── L1: the landed list survives a direct push ───────────────────────────────────────────────────
echo "== L1"
R="$TMP/repo"; V="$TMP/vault"; mkdir -p "$V"
git -c init.defaultBranch=main init -q "$R"
commit() { printf '%s\n' "$1" > "$R/$1.txt"; git -C "$R" add "$1.txt"; git -C "$R" commit -q -m "$2"; }
commit base base; TB=$(git -C "$R" rev-parse HEAD)
commit x "theirs: x (#7)"
commit z "a direct push"; Z=$(git -C "$R" rev-parse HEAD)
commit y "theirs: y (#9)"; B=$(git -C "$R" rev-parse HEAD)
L=$(python3 - "$LI" "$R" "$TB" "$B" "$V" <<'PY'
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("li", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
landed, unlisted, note = m._landed(sys.argv[2], sys.argv[3], sys.argv[4], "o/r", Path(sys.argv[5]))
print(json.dumps({"landed": landed, "unlisted": unlisted, "note": note}))
PY
)
ok "$(j "$L" '[x["prUrl"] for x in d["landed"]]')" '["https://github.com/o/r/pull/7","https://github.com/o/r/pull/9"]' "L1: the PRs either side of a direct push stay in landed, oldest first"
ok "$(j "$L" 'd["unlisted"]')" "[{\"sha\":\"$Z\",\"subject\":\"a direct push\",\"files\":[\"z.txt\"]}]" "L1: the direct push is in unlisted: sha, subject, files"
has "$(j "$L" 'd["note"]')" "name no PR" "L1: the note says why it is not in landed"

# ── R1 / R2: the integrate record from `inputs --row` ────────────────────────────────────────────
echo "== R1"
NOTE="$V/proj-a.md"
printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: https://github.com/o/r/pull/5\nreview_rounds_used: 2\n---\n\n## Notes\n\na\n' > "$NOTE"
python3 - "$TMP" <<'PY'
import json, sys
d = sys.argv[1]
json.dump({"rolloutSlug": "ro", "tasks": [{"slug": "proj-a", "status": "blocked", "prUrl": "", "reviewRoundsUsed": 0,
           "reviewHistory": []}]}, open(f"{d}/stale.json", "w"))
json.dump({"rolloutSlug": "ro", "tasks": [{"slug": "proj-a", "status": "review", "prUrl": "https://github.com/o/r/pull/5",
           "reviewRoundsUsed": 2, "reviewHistory": [{"round": 1, "feedback": ["x"]}], "startRung": "opus-high",
           "rung": "opus-high", "climbs": []}]}, open(f"{d}/good.json", "w"))
PY
I=$(python3 "$LI" inputs --note "$NOTE" --row "$TMP/stale.json"); rc=$?
ok "$rc" 0 "R1: inputs --row exits 0 on a refused row"
ok "$(j "$I" '[d["integrate"]["source"], d["integrate"]["prUrl"], d["integrate"]["reviewRoundsUsed"]]')" '["note","https://github.com/o/r/pull/5",2]' "R1: a blocked row with no PR and 0 rounds is refused: the note's PR and rounds"
has "$(j "$I" 'd["integrate"]["rowRefused"]')" "status" "R1: … and rowRefused says why"
echo "== R2"
I=$(python3 "$LI" inputs --note "$NOTE" --row "$TMP/good.json")
ok "$(j "$I" '[d["integrate"]["source"], d["integrate"]["reviewHistory"], d["integrate"]["rowRefused"]]')" '["row",[{"round":1,"feedback":["x"]}],""]' "R2: an approving row that matches the note is used"

# ── M: step 4's merge-task set-aside cuts its own reason (p55-3, ADR 0085 d8) ───────────────────────────────────
# `set-aside --repo R --merge-task F` reads the code from R/.claude/merge-task.status and cuts the reason from F,
# merge-task's own output, by reconcile-rollout.py's constants, so the lead types neither (tests/merge-task-no-runner.test.sh
# drives it on real merge-task runs). Each mistake of the lead's typing is a `lead error:` line, exit 2, no stdout.
echo "== M"
P="$TMP/proj"; SV="$TMP/sv"; mkdir -p "$P/.claude/integration" "$SV"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[mt]]\n' "$P" > "$SV/ro.md"
printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: https://github.com/o/r/pull/5\nintegrating: 2026-10-05T10:00+00:00\n---\n\n## Notes\n\na\n' > "$SV/mt.md"
CANARY='git-env-canary: check-all: 0 windows open, no trip'   # a Backoff's lines before merge-task's own
RED=$'ERROR: a REQUIRED check FAILED on PR #5 (Ralph passed locally, but remote CI is red):\nlint\tfail\t31s\thttps://github.com/o/r/actions/runs/1/job/2\n  Diagnose: gh pr checks 5 -R o/r — push a fix to the branch, re-integrate, then re-run merge-task.sh.'
RERUN=$'  infra rerun 1/2 triggered — re-watching required checks…'
NEVER='ERROR: required checks never appeared for PR #5 — no CI runs in flight on its head SHA, nothing is coming'
# msa <sentinel|-> <output> [F]: set-aside --merge-task on that output (F: its path; default a temp file); sets out, err, rc
msa() {
  if [ "$1" = - ]; then rm -f "$P/.claude/merge-task.status"; else printf '%s\n' "$1" > "$P/.claude/merge-task.status"; fi
  local f="${3:-$TMP/mt.out}"
  printf '%s' "$2" > "$f"
  out=$(python3 "$LI" set-aside --note "$SV/mt.md" --repo "$P" --merge-task "$f" 2>"$TMP/mt.err"); rc=$?; err=$(cat "$TMP/mt.err")
}
diag() { j "$out" '[d["tasks"][0]["leadSetAside"], d["tasks"][0]["blockerDiagnosis"]]'; }
msa failed:1 "$CANARY"$'\n'"$RED"$'\r\n\r\n'
ok "$rc|$(diag)" "0|$(python3 -c 'import json,sys; print(json.dumps(["own", "merge-task: " + sys.argv[1]], separators=(",", ":"), ensure_ascii=False))' "$RED")" \
  "M1: failed:1, a red check: kind own, merge-task: and its ERROR text to the end (CRLF and blanks dropped, the canary's lines cut)"
ok "$(python3 - "$LI" "$out" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("li", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
d = json.loads(sys.argv[2])["tasks"][0]["blockerDiagnosis"]
print(any(f in m.rr._merge_task_cause(d) for f in m.rr.MERGE_TASK_FIXABLE))
PY
)" True "M1: … in which _merge_task_cause finds MERGE_TASK_FIXABLE (the retry's fixable text)"
msa failed:1 "$RED"$'\n'"$RERUN"$'\n'"$NEVER"
ok "$(diag)" "[\"integration\",\"integration: merge-task exit 1, GitHub-side: $NEVER\"]" \
  "M2: an earlier ERROR before an infra rerun is cut: the last one, GitHub's side, kind integration"
# Each row: sentinel | output | kind | the diagnosis's first line
while IFS='|' read -r code text kind first; do
  msa "$code" "$(printf '%b' "$text")"
  ok "$rc|$(j "$out" 'd["tasks"][0]["leadSetAside"]')|$(j "$out" 'd["tasks"][0]["blockerDiagnosis"].split(chr(10))[0]')" "0|$kind|$first" "M3: $code"
done <<'EOF'
failed:2|merge-task: checking\nERROR: merge-task args: <head> zz is not a 40-hex SHA\n|own|merge-task: ERROR: merge-task args: <head> zz is not a 40-hex SHA
failed:4|x\nset-aside reason: integration: no-runner: required job "a" queued 47 minutes with no runner (run 7, job 8)\nset-aside reason: integration: no-runner: required job "a" queued 47 minutes with no runner (run 7, job 8)\n|integration|integration: no-runner: required job "a" queued 47 minutes with no runner (run 7, job 8)
failed:8|git-env-canary: check-all: ok\nretryable: GitHub has not settled its mergeability (UNKNOWN after 6 re-polls)\n\n|integration|integration: merge-task exit 8 three times: retryable: GitHub has not settled its mergeability (UNKNOWN after 6 re-polls)
failed:143|  PR #5 — waiting on: build (in_progress)\n  last wait: PR #5 — waiting on: build (in_progress)\nTerminated: 15\n|integration|integration: merge-task signalled twice (143): last wait: PR #5 — waiting on: build (in_progress)
-|merge-task: re-polling BLOCKED (2/6)\nbash: line 1: 4242 Terminated  merge-task.sh /r 5\n|integration|integration: merge-task signalled twice (missing): merge-task: re-polling BLOCKED (2/6)
EOF
msa failed:4 $'set-aside reason: integration: head moved after Integration (PR head h)\n' "$P/.claude/integration/mt.merge-task.out"
ok "$rc|$(j "$out" 'd["tasks"][0]["blockerDiagnosis"]')" "0|integration: head moved after Integration (PR head h)" \
  "M4: Codex's <repo>/.claude/integration/<slug>.merge-task.out reads the same"
# Each mistake of the lead's typing: exit 2, nothing on stdout, one `lead error:` line.
while IFS='|' read -r label code text why; do
  msa "$code" "$(printf '%b' "$text")"
  ok "$rc|$out" "2|" "M5: $label: exit 2, nothing on stdout"
  has "$err" "lead-integrate set-aside: lead error: $why" "M5: $label: its lead error line"
done <<'EOF'
sentinel ok|ok|x\n|
failed:3|failed:3|ERROR: base moved\n|
failed:abort|failed:abort|x\n|
failed:4 with no set-aside reason line|failed:4|integration: no-runner\n|
failed:1 with no ERROR line|failed:1|merge-task: checking\n|
EOF
printf 'failed:4\n' > "$P/.claude/merge-task.status"
out=$(python3 "$LI" set-aside --note "$SV/mt.md" --repo "$P" --merge-task "$TMP/no-such.out" 2>"$TMP/mt.err"); rc=$?
ok "$rc|$out" "2|" "M5: an unreadable output file: exit 2, nothing on stdout"; has "$(cat "$TMP/mt.err")" "lead error: cannot read the merge-task output" "M5: … its lead error line"
out=$(python3 "$LI" set-aside --note "$SV/mt.md" --repo "$TMP" --merge-task "$TMP/mt.out" 2>"$TMP/mt.err"); rc=$?
ok "$rc|$out" "2|" "M5: a --repo that is not the Project root: exit 2"; has "$(cat "$TMP/mt.err")" "lead error: --repo $TMP is not [[ro]]'s Project root" "M5: … its lead error line"
for form in both neither; do
  if [ "$form" = both ]; then o=$(printf x | python3 "$LI" set-aside --note "$SV/mt.md" --kind own --repo "$P" --merge-task "$TMP/mt.out" 2>&1); rc=$?
  else o=$(python3 "$LI" set-aside --note "$SV/mt.md" 2>&1); rc=$?; fi
  ok "$rc" 2 "M6: $form modes: exit 2"; has "$o" "usage:" "M6: $form modes: argparse's usage line"
done

echo
if [ "$fail" -eq 0 ]; then echo "integration-inputs: ALL PASS"; else echo "integration-inputs: FAILED"; fi
exit "$fail"
