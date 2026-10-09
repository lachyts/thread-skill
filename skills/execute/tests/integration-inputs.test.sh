#!/usr/bin/env bash
# p17-1: what the lead feeds an Integration, pinned next to the other execute suites (the task's Verify line).
# A thin suite: the full cases live with their git, gh and vault fixtures in tests/lead-integrate.test.sh (C10 the
# landed list, C22 `inputs --row`), and the lane's order is reconcile-rollout-queue.test.sh's `lane-order`.
#   L1  lead-integrate.py _landed skips a commit pushed without a PR (listed in `unlisted`), never dropping the list.
#   R1  `inputs --row` refuses a stale saved row (the incident: blocked, no PR, 0 rounds) and falls back to the note.
#   R2  … and takes an approving row that matches the note.
# Usage: bash integration-inputs.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HERE="$(cd "$(dirname "$0")" && pwd)"
LI="$HERE/../scripts/lead-integrate.py"
TMP=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record stays in temp

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

echo
if [ "$fail" -eq 0 ]; then echo "integration-inputs: ALL PASS"; else echo "integration-inputs: FAILED"; fi
exit "$fail"
