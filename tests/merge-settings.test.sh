#!/usr/bin/env bash
# skills/execute/scripts/merge-settings.py (ADR 0080, p47-9): a stuck rollout changes its repo's merge settings, logged
# with its undo. Hermetic on the shared fake gh (tests/fixtures/merge-task/fake-gh.py): GitHub's copy of origin is a
# local bare repo the clone reaches through url.<bare>.insteadOf, while remote.origin.url reads
# https://github.com/o/r.git, so the script's origin is o/r and its fetches are real. Task notes are built through the
# real `lead-integrate.py set-aside | reconcile-rollout.py reconcile` and `auto-retry`, so each block's Run record and
# its settings point are the engine's own.
#   M0      before the settings point: not due, no gh call
#   M1-M2b  a no-runner block: the classic PATCH and its undo; a ruleset PUT that keeps every rule; a last ruleset check
#   M3*     an unreported-context block: renames in master's history and in the task's own PR, the rename gate, matrix
#           expansion, deletions, clears and every `left`
#   M4-M9   a red check, ownership, rights, the Run record, the lock, transient reads, gh missing, idempotence
#   M10-M17 restore, dismiss and rows; quoting; the fake's 422s; an over-long line; a dangling change; a context two
#           tasks share; the block boundary; two identical rows
#   M18     check, the repo check before the first Slot: nothing found (a young queue, a quick cancel, a hosted job),
#           a no-runner check cleared, restored and dismissed, a registered runner listed, no recent run, not
#           owned, a failed read
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
tmp=$(mktemp -d); tmp=$(cd "$tmp" && pwd -P); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
# A user-site PyYAML (the workflows' reader) still imports under the temp HOME: run.sh pins PYTHONUSERBASE too.
export PYTHONUSERBASE="${PYTHONUSERBASE:-$(python3 -c 'import site; print(site.getuserbase())')}"
export HOME="$tmp/home"; mkdir -p "$HOME"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR XDG_STATE_HOME
export THREAD_NOTE_LOCK_DIR="$tmp/locks" THREAD_GIT_ENV_DIR="$tmp/git-env" THREAD_MERGE_SETTINGS_LOCK_S=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
MS="$root/skills/execute/scripts/merge-settings.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
LI="$root/skills/execute/scripts/lead-integrate.py"
RREC="$root/skills/_shared/scripts/run_record.py"
PR=https://github.com/o/r/pull/5
NOW=2026-10-03T09:00:00Z
hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), sort_keys=True))' "$2"; }
sha12() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])' "$1"; }

# ---- the repo: a bare origin reached through insteadOf, a work clone that authors its history -------------------------
BARE="$tmp/gh/o/r.git"; W="$tmp/work"; REPO="$tmp/repo"
newrepo() {  # a fresh origin with one commit on master; $REPO cloned from it (origin o/r), $W the authoring clone
  rm -rf "$tmp/gh" "$W" "$REPO"
  git -c init.defaultBranch=master init -q --bare "$BARE"
  git -c init.defaultBranch=master clone -q "$BARE" "$W" 2>/dev/null
  printf 'r\n' > "$W/README"; gt -C "$W" add -A; gt -C "$W" commit -qm root; gt -C "$W" push -q origin HEAD:master
  git -c init.defaultBranch=master clone -q "$BARE" "$REPO" 2>/dev/null
  git -C "$REPO" remote set-url origin https://github.com/o/r.git
  git -C "$REPO" config url."$BARE".insteadOf https://github.com/o/r.git
}
put() { mkdir -p "$(dirname "$W/$1")"; printf '%s\n' "$2" > "$W/$1"; }
cm() { gt -C "$W" add -A; gt -C "$W" commit -qm "${1:-c}" --allow-empty; gt -C "$W" rev-parse HEAD; }
pushm() { gt -C "$W" push -q origin HEAD:master; }
prhead() {  # prhead <sha>: the PR's head on origin, never fetched by the clone
  gt -C "$W" push -q -f origin "$1:refs/pull/5/head" "$1:refs/heads/audit-fix/t5"
}
branch_pr() {  # branch_pr <base sha> [<path> <yaml>]: H, a child of base with README (or the workflow) changed
  gt -C "$W" checkout -q -B pr "$1"
  if [ "$#" -ge 3 ]; then put "$2" "$3"; else printf 'pr\n' >> "$W/README"; fi
  H=$(cm pr); gt -C "$W" checkout -q master; prhead "$H"
}
job() {  # job <id> [<more yaml, \n-escaped>]: a minimal ci.yml job block (two-space indented under `jobs:`)
  printf '  %s:\n    runs-on: ubuntu-latest\n%b    steps:\n      - run: echo hi\n' "$1" "${2:-}"
}
ci() { printf 'on: [push, pull_request]\njobs:\n'; printf '%s\n' "$@"; }   # ci <job block>…: a workflow
newrepo

# ---- the notes: a rollout, a task at the settings point (templates copied per case) ----------------------------------
TPL="$tmp/tpl"; T="$tmp/case"
lead() {  # lead <slug> <reason> <now>
  printf '%s' "$2" | python3 "$LI" set-aside --note "$T/tasks/$1.md" --kind integration \
    | python3 "$RR" reconcile --result - --tasks-dir "$T/tasks" --now "$3" >/dev/null
}
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nauto_retries: 2\n'
    printf 'max_review_rounds: 4\nprojects:\n  - "[[Proj]]"\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[t]]\n- [[u]]\n' "$REPO"
  } > "$T/tasks/ro.md"
}
mkt() {
  printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: %s\nintegrating: 2026-10-03T07:00+00:00\n---\n\n## Notes\n\nA task.\n' \
    "$PR" > "$T/tasks/$1.md"
}
NR='no-runner: required job "self-hosted (arm)" queued 47 minutes with no runner (run 7, job 8)'
NR2='no-runner: required job "self-hosted (arm)" queued 112 minutes with no runner (run 9, job 11)'
ur() { printf 'unreported-context: required check "%s" is reported by no check run or status on the PR'"'"'s head, and no run on it is in flight' "$1"; }
to_point() {  # to_point <slug> <reason> [<reason2>]: set aside at 08:00, retried at 08:15, the same stop at 08:30
  lead "$1" "$2" 2026-10-03T08:00:00Z
  python3 "$RR" auto-retry --tasks "$1" --rollout "$T/tasks/ro.md" --tasks-dir "$T/tasks" --now 2026-10-03T08:15:00Z >/dev/null 2>&1 \
    || echo "FAIL - template: auto-retry $1"
  python3 "$RR" mark-integrating --tasks "$1" --tasks-dir "$T/tasks" --now 2026-10-03T08:20:00Z >/dev/null 2>&1
  lead "$1" "${3:-$2}" 2026-10-03T08:30:00Z
}
tpl() {  # tpl <name> <reason…>: a template whose task t is at the settings point (and u too with a second reason)
  rm -rf "$T"; mkdir -p "$T/tasks" "$T/events"; export THREAD_EVENTS_DIR="$T/events"
  mkro; mkt t; to_point t "$2" "${3:-$2}"
  if [ "${4:-}" ]; then mkt u; to_point u "$4"; fi
  rm -rf "${TPL:?}/$1"; mkdir -p "$TPL"; cp -R "$T" "$TPL/$1"
}
use() { rm -rf "$T"; cp -R "$TPL/$1" "$T"; export THREAD_EVENTS_DIR="$T/events"; fresh; }
tpl nr "$NR" "$NR2"
tpl nr2 "$NR" "$NR2" "$NR"
tpl ur "$(ur build)"
tpl ur-bt "$(ur build-and-test)"
tpl ur-matrix "$(ur 'build (macos-14)')"
ilog() {  # ilog <slug> <base> <head>: the Integration log line merge-task ran (lead-written set-asides add none)
  printf '\n## Integration log\n\n2026-10-03T07:30+00:00 integrated path=integrator pr=5 anchor=%s head=%s base=%s wait=1 duration=1 triggers=- active=1\n' \
    "$3" "$3" "$2" >> "$T/tasks/$1.md"
}

# ---- the run --------------------------------------------------------------------------------------------------------
free() {  # free [<slug>] [--now …]: merge-settings.py free on $T/tasks/<slug>.md (gh.log and writes.log cleared first)
  local s=t; case "${1:-}" in -*|'') ;; *) s=$1; shift ;; esac
  : > "$MT_STATE/gh.log"; rm -f "$MT_STATE/writes.log"
  out=$(PATH="$tmp/bin:$PATH" python3 "$MS" free --note "$T/tasks/$s.md" --repo "$REPO" --now "$NOW" "$@" 2>&1); rc=$?
}
ms() { out=$(PATH="$tmp/bin:$PATH" python3 "$MS" "$@" 2>&1); rc=$?; }
ncalls() { cat "$MT_STATE/gh.log" 2>/dev/null | grep -c .; }
nwrites() { cat "$MT_STATE/writes.log" 2>/dev/null | grep -c .; }
rows() { awk '$0=="## Merge settings"{on=1; next} on && /^## /{exit} on && NF' "$T/tasks/${1:-t}.md"; }
nrow() { rows "${2:-t}" | grep -cE "^- \S+ $1( |$)"; }
inp() { python3 "$LI" inputs --note "$T/tasks/${1:-t}.md" --repo "$REPO" --now "${INOW:-$NOW}"; }
evs() {  # evs <kind>: the Run record's lines of that kind, as JSON lines
  python3 -c 'import json,sys
for l in open(sys.argv[1]):
    d = json.loads(l)
    if d["kind"] == sys.argv[2]: print(json.dumps(d, sort_keys=True))' "$THREAD_EVENTS_DIR/ro.jsonl" "$1" 2>/dev/null
}
nev() { evs "$1" | grep -c . ; }
rsc() { printf '%s\n' "$1" > "$MT_STATE/rsc.json"; }
canon() { python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
for c in d.get("checks") or []:
    if c.get("app_id") == -1: c["app_id"] = None
print(json.dumps(d, sort_keys=True))' "$1"; }
runs_on() {  # runs_on <sha> <name>[:<conclusion>]…: GitHub Actions check runs on <sha>
  python3 -c 'import json,sys
runs = []
for a in sys.argv[2:]:
    n, _, c = a.partition(":")
    runs.append({"name": n, "status": "completed", "conclusion": c or "success", "app": {"id": 15368}, "id": len(runs) + 1})
print(json.dumps({"total_count": len(runs), "check_runs": runs}))' "$@" > "$MT_STATE/checkruns.$1"
}
msrow() { local s="$1"; shift; { grep -q '^## Merge settings$' "$T/tasks/$s.md" || printf '\n## Merge settings\n\n'; printf '%s\n' "$@"; } >> "$T/tasks/$s.md"; }
undo_of() { rows | sed -n "s/^  [0-9a-f]\{12\} undo: //p" | sed -n "${1:-1}p"; }
FP_NR=$(sha12 $'no-runner\nself-hosted (arm)')
RSC_NR='{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "self-hosted (arm)", "app_id": 15368}]}'

# ════ M0: before the settings point ═══════════════════════════════════════════════════════════════════════════════════
rm -rf "$T"; mkdir -p "$T/tasks" "$T/events"; export THREAD_EVENTS_DIR="$T/events"; fresh
mkro; mkt t; lead t "$NR" 2026-10-03T08:00:00Z
rsc "$RSC_NR"
I=$(INOW=2026-10-03T08:05:00Z inp)
ok "$(j "$I" '[d["settingsBlock"]["due"], d["autoRetryAfter"], d["humanFix"]]')" '[false,"2026-10-03T08:15+00:00",null]' \
  "M0: the first set-aside is not due: its infra cool-down retries at the stamp + 15"
free --now 2026-10-03T08:05:00Z
ok "$rc|$(ncalls)|$(rows | grep -c .)" "5|0|0" "M0: free exits 5 with no gh call and no row"

# ════ M1: a no-runner block, the classic source ════════════════════════════════════════════════════════════════════
use nr; rsc "$RSC_NR"
before=$(canon "$MT_STATE/rsc.json")
free
ok "$rc" 0 "M1: free exits 0 at the settings point"
ok "$(nwrites)" 1 "M1: one write"
ok "$(cat "$MT_STATE/writes.log")" 'PATCH repos/o/r/branches/master/protection/required_status_checks {"checks":[{"app_id":-1,"context":"ci"}],"strict":true}' \
  "M1: one PATCH, the classic body {strict, checks}, a null app_id written -1"
ok "$(nrow changing)|$(nrow changed)" "1|1" "M1: a changing row and its changed row"
has "$(rows)" "changing " "M1: (the change row)"
has "$(rows)" ": protection o/r@master: removed \"self-hosted (arm)\"" "M1: … naming the source and the change"
ok "$(nev setting-changed)" 1 "M1: one setting-changed line"
ok "$(evs setting-changed | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["block"], d["change"], d["context"], d["repo"], d["branch"], d["source"])')" \
  "no-runner removed self-hosted (arm) o/r master protection" "M1: … its fields"
has "$out" "merge setting changed for you" "M1: the change is printed with its undo"
UNDO=$(undo_of)
(cd "$tmp" && PATH="$tmp/bin:$PATH" sh -c "$UNDO") >/dev/null 2>&1
ok "$(canon "$MT_STATE/rsc.json")" "$before" "M1: the undo through the fake restores the setting exactly"
I=$(INOW=2026-10-03T09:01:00Z inp)
ok "$(j "$I" '[d["autoRetry"], d["settingsBlock"]["state"]]')" '[true,"changed"]' "M1: inputs then reads 22a (a changed block re-enters once)"

# ════ M2: a ruleset holding three rules ═══════════════════════════════════════════════════════════════════════════
use nr
mkdir -p "$MT_STATE/rulesets"; echo unprotected > "$MT_STATE/branch"
RULES='[{"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false}},
        {"type": "non_fast_forward"},
        {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": true,
          "required_status_checks": [{"context": "ci", "integration_id": 15368}, {"context": "self-hosted (arm)"}]}}]'
printf '{"id": 42, "name": "main", "source_type": "Repository", "rules": %s}\n' "$RULES" > "$MT_STATE/rulesets/42.json"
planted=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["rules"], sort_keys=True))' "$MT_STATE/rulesets/42.json")
free
ok "$rc|$(nwrites)" "0|1" "M2: a ruleset block: one write"
body=$(sed -n 's/^PUT repos\/o\/r\/rulesets\/42 //p' "$MT_STATE/writes.log")
ok "$(j "$body" '[r["type"] for r in d["rules"]]')" '["pull_request","non_fast_forward","required_status_checks"]' \
  "M2: the PUT carries every rule, in order"
ok "$(j "$body" '"parameters" in d["rules"][1]')" false "M2: non_fast_forward gains no parameters key"
ok "$(j "$body" 'd["rules"][2]["parameters"]')" '{"required_status_checks":[{"context":"ci","integration_id":15368}],"strict_required_status_checks_policy":true}' \
  "M2: the up-to-date policy and a set integration_id kept, the context removed"
(cd "$tmp" && PATH="$tmp/bin:$PATH" sh -c "$(undo_of)") >/dev/null 2>&1
ok "$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["rules"], sort_keys=True))' "$MT_STATE/rulesets/42.json")" "$planted" \
  "M2: the undo restores the planted rules, non_fast_forward still with no parameters key"
# M2b: a ruleset's last check is never removed (the rule's up-to-date policy would go with it)
use nr
mkdir -p "$MT_STATE/rulesets"; echo unprotected > "$MT_STATE/branch"
printf '{"id": 42, "source_type": "Repository", "rules": [{"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": true, "required_status_checks": [{"context": "self-hosted (arm)"}]}}]}\n' \
  > "$MT_STATE/rulesets/42.json"
free
ok "$rc|$(nwrites)|$(nrow left)" "3|0|1" "M2b: emptying a ruleset's checks is left, no write"
has "$(rows)" "up-to-date policy" "M2b: … naming the policy it would drop"

# ════ M3: an unreported-context block ═════════════════════════════════════════════════════════════════════════════
# ur_case <tpl> <C> <C'> [<app>]: required [ci, C], the block the template names; rsc and C' passing on $H (none: no run).
ur_case() {
  use "$1"; ilog t "$HB" "$H"
  rsc "{\"strict\": true, \"checks\": [{\"context\": \"ci\", \"app_id\": null}, {\"context\": \"$2\", \"app_id\": ${4:-15368}}]}"
  if [ -n "$3" ]; then runs_on "$H" "$3"; else runs_on "$H"; fi   # GitHub's answer for a head with no run: an empty list
}
replaced() {  # replaced <label> <C> <C'>: one PATCH that replaced C with C' at its position
  ok "$rc|$(nwrites)" "0|1" "$1: one write"
  ok "$(sed -n 's/^PATCH [^ ]* //p' "$MT_STATE/writes.log")" \
    "{\"checks\":[{\"app_id\":-1,\"context\":\"ci\"},{\"app_id\":${4:-15368},\"context\":\"$3\"}],\"strict\":true}" \
    "$1: $2 replaced by $3 at its position, its app kept"
}
leftw() {  # leftw <label> <why fragment>: left, no write
  ok "$rc|$(nwrites)|$(nrow left)" "3|0|1" "$1: left, no write"
  has "$(rows)" "$2" "$1: … $2"
}
# M3: a name: change in master's history
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    name: build-and-test\n')")"; HB=$(cm rename); pushm
branch_pr "$HB"
stale=$(git -C "$REPO" rev-parse refs/remotes/origin/master)
ur_case ur build build-and-test; free
replaced M3 build build-and-test
ok "$(git -C "$REPO" rev-parse refs/remotes/origin/master)" "$HB" "M3f: free fetched origin/master (it was ${stale:0:7})"
has "$(rows)" "replaced \"build\" -> \"build-and-test\"" "M3: the row names the replacement"
# M3gf: the rename gate: no run of C' on H, then a failed one
ur_case ur build ''; free
leftw "M3gf (no run)" "\"build-and-test\" has not passed on the PR's head"
ur_case ur build ''; runs_on "$H" build-and-test:failure; free
leftw "M3gf (failed)" "has not passed on the PR's head"
# M3null: a null app backed by the exact expanded name in history acts
ur_case ur build build-and-test null; free
replaced M3null build build-and-test -1
# M3i: a job id rename (one id out, one in, same file)
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)" "$(job lint)")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build-and-test)" "$(job lint)")"; HB=$(cm rename); pushm; branch_pr "$HB"
ur_case ur build build-and-test; free
replaced M3i build build-and-test
# M3d: a deleted job, in a commit that adds no job
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)" "$(job lint)")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job lint)")"; HB=$(cm drop); pushm; branch_pr "$HB"
ur_case ur build ''; free
ok "$rc|$(nwrites)|$(sed -n 's/^PATCH [^ ]* //p' "$MT_STATE/writes.log")" '0|1|{"checks":[{"app_id":-1,"context":"ci"}],"strict":true}' \
  "M3d: a job deleted by a commit that adds none: removed"
# M3x: an ambiguous move (two combinations left, two arrived)
newrepo; put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [a, b]\n')")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [c, d]\n')")"; HB=$(cm move); pushm; branch_pr "$HB"
tpl ur-a "$(ur 'build (a)')"
ur_case ur-a 'build (a)' ''; free
leftw M3x "2 combinations left and 2 arrived"
# M3m: a matrix job whose literal name changes
newrepo; put .github/workflows/ci.yml "$(ci "$(job build '    name: build\n    strategy:\n      matrix:\n        os: [ubuntu]\n')")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    name: test\n    strategy:\n      matrix:\n        os: [ubuntu]\n')")"; HB=$(cm rename); pushm
branch_pr "$HB"
tpl ur-bu "$(ur 'build (ubuntu)')"
ur_case ur-bu 'build (ubuntu)' 'test (ubuntu)'; free
replaced M3m 'build (ubuntu)' 'test (ubuntu)'
# M3v: a matrix value rename, one combination out and one in
newrepo; put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [ubuntu, macos-14]\n')")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [ubuntu, macos-15]\n')")"; HB=$(cm bump); pushm
branch_pr "$HB"
ur_case ur-matrix 'build (macos-14)' 'build (macos-15)'; free
replaced M3v 'build (macos-14)' 'build (macos-15)'
# M3w: an expression-named matrix job
newrepo; put .github/workflows/ci.yml "$(ci "$(job build '    name: ${{ matrix.os }} tests\n    strategy:\n      matrix:\n        os: [macos-14]\n')")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    name: ${{ matrix.os }} tests\n    strategy:\n      matrix:\n        os: [macos-15]\n')")"; HB=$(cm bump); pushm
branch_pr "$HB"
tpl ur-mt "$(ur 'macos-14 tests')"
ur_case ur-mt 'macos-14 tests' 'macos-15 tests'; free
replaced M3w 'macos-14 tests' 'macos-15 tests'
# M3ln: a literal name given to an unnamed matrix job keeps the values suffix, in master's history and in the PR
newrepo; put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [ubuntu]\n')")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    name: Test\n    strategy:\n      matrix:\n        os: [ubuntu]\n')")"; HB=$(cm name); pushm
branch_pr "$HB"
ur_case ur-bu 'build (ubuntu)' 'Test (ubuntu)'; free
replaced "M3ln (master)" 'build (ubuntu)' 'Test (ubuntu)'
newrepo; put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [ubuntu]\n')")"; HB=$(cm c0); pushm
branch_pr "$HB" .github/workflows/ci.yml "$(ci "$(job build '    name: Test\n    strategy:\n      matrix:\n        os: [ubuntu]\n')")"
ur_case ur-bu 'build (ubuntu)' 'Test (ubuntu)'; free
replaced "M3ln (own PR)" 'build (ubuntu)' 'Test (ubuntu)'
# M3ex: an exclude matrix; the excluded combination is never a name
newrepo
put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [ubuntu, macos-14]\n        node: [18, 20]\n        exclude:\n          - os: macos-14\n            node: 18\n')")"
cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    strategy:\n      matrix:\n        os: [ubuntu, macos-15]\n        node: [18, 20]\n        exclude:\n          - os: macos-15\n            node: 18\n')")"
HB=$(cm bump); pushm; branch_pr "$HB"
tpl ur-ex "$(ur 'build (macos-14, 20)')"
ur_case ur-ex 'build (macos-14, 20)' 'build (macos-15, 20)'; free
replaced M3ex 'build (macos-14, 20)' 'build (macos-15, 20)'
ok "$(python3 - "$MS" "$W" "$(git -C "$W" rev-parse HEAD~1)" <<'PY'
import importlib.util, sys
s = importlib.util.spec_from_file_location("ms", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(sorted(m.Rev(sys.argv[2], sys.argv[3]).names))
PY
)" "['build (macos-14, 20)', 'build (ubuntu, 18)', 'build (ubuntu, 20)']" "M3ex: the expansion never holds the excluded build (macos-14, 18)"
# The task's own PR (Hb -> H): M3o replaced, M3oc removed, M3of not passed, M3od deleted
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)")"; HB=$(cm c0); pushm
branch_pr "$HB" .github/workflows/ci.yml "$(ci "$(job build '    name: build-and-test\n')")"
ur_case ur build build-and-test; free
replaced M3o build build-and-test
(cd "$tmp" && PATH="$tmp/bin:$PATH" sh -c "$(undo_of)") >/dev/null 2>&1
ok "$(python3 -c 'import json,sys; print([c["context"] for c in json.load(open(sys.argv[1]))["checks"]])' "$MT_STATE/rsc.json")" \
  "['ci', 'build']" "M3o: its undo restores build"
ur_case ur build build-and-test
rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "build", "app_id": 15368}, {"context": "build-and-test", "app_id": 15368}]}'
free
ok "$rc|$(sed -n 's/^PATCH [^ ]* //p' "$MT_STATE/writes.log")" '0|{"checks":[{"app_id":-1,"context":"ci"},{"app_id":15368,"context":"build-and-test"}],"strict":true}' \
  "M3oc: C' already required: C removed"
ur_case ur build ''; runs_on "$H" build-and-test:failure; free
leftw M3of "\"build-and-test\" has not passed on the PR's head"
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)" "$(job lint)")"; HB=$(cm c0); pushm
branch_pr "$HB" .github/workflows/ci.yml "$(ci "$(job lint)")"
ur_case ur build ''; free
leftw M3od "deleted by this task's own PR: dropping a required job is his call"
# M3o2: another task's own rename required build-and-test before its PR merged: left, naming that task
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)")"; HB=$(cm c0); pushm; branch_pr "$HB"
ur_case ur-bt build-and-test ''
python3 "$RREC" emit --rollout ro --task other-task --kind setting-changed --json \
  "{\"id\": \"aaaaaaaaaaaa\", \"repo\": \"o/r\", \"branch\": \"master\", \"source\": \"protection\", \"block\": \"unreported-context\", \"change\": \"replaced\", \"context\": \"build\", \"newContext\": \"build-and-test\", \"before\": \"{}\", \"after\": \"{}\", \"undo\": \"true\", \"fingerprint\": \"bbbbbbbbbbbb\"}" >/dev/null
free
leftw M3o2 "required since [[other-task]]'s own rename, which has not reached master"
# M3t: origin/<b> names C since the integration: cleared, no write, no event; the verdict reads 22a once
newrepo; put .github/workflows/ci.yml "$(ci "$(job lint)")"; HB=$(cm c0); pushm; branch_pr "$HB"
put .github/workflows/ci.yml "$(ci "$(job lint)" "$(job build)")"; cm add >/dev/null; pushm
ur_case ur build ''; free
ok "$rc|$(nwrites)|$(nrow cleared)|$(nev setting-changed)" "0|0|1|0" "M3t: origin names C since the integration: cleared, no write, no event"
has "$out" "[[t]]: cleared, no setting changed: origin/master names it since the integration" "M3t: its stdout says no setting changed"
hasnt "$out" "merge setting changed for you" "M3t: … never the changed-for-you line (nothing to undo)"
has "$(rows)" "origin/master names it since the integration" "M3t: … saying why"
ok "$(j "$(INOW=2026-10-03T09:01:00Z inp)" 'd["autoRetry"]')" true "M3t: the verdict reads 22a"
# left, no write: M3n no evidence, M3c still met at H, M3a another app, M3u a reusable a / b
newrepo; put .github/workflows/ci.yml "$(ci "$(job lint)")"; HB=$(cm c0); pushm; branch_pr "$HB"
ur_case ur build ''; free
leftw M3n "no rename or deletion of \"build\""
newrepo; put .github/workflows/ci.yml "$(ci "$(job lint)")"; HB=$(cm c0); pushm
branch_pr "$HB" .github/workflows/ci.yml "$(ci "$(job lint)" "$(job build '    if: false\n')")"
ur_case ur build ''; free
leftw M3c "a path-filtered or conditional job still named \"build\" at the PR's head"
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)")"; cm c0 >/dev/null
put .github/workflows/ci.yml "$(ci "$(job build '    name: build-and-test\n')")"; HB=$(cm rename); pushm; branch_pr "$HB"
ur_case ur build build-and-test 777; free
leftw M3a "another app's check"
newrepo
put .github/workflows/ci.yml "$(printf 'on: [push]\njobs:\n  call:\n    uses: ./.github/workflows/re.yml\n')"
put .github/workflows/re.yml "$(printf 'on: [workflow_call]\njobs:\n%s' "$(job build)")"
HB=$(cm c0); pushm; branch_pr "$HB"
tpl ur-ab "$(ur 'call / build')"
ur_case ur-ab 'call / build' ''; free
ok "$rc|$(nwrites)|$(nrow left)" "3|0|1" "M3u: a reusable workflow's a / b context: left, no write"
# M3e, M3in: an identity the expansion cannot resolve that _match hits is left, never decided by _match
for c in 'expr|    name: ${{ inputs.x }} build\n|x build' 'fromJSON|    strategy:\n      matrix: ${{ fromJSON(needs.a.outputs.m) }}\n|build (ubuntu)' \
         'include|    strategy:\n      matrix:\n        os: [ubuntu]\n        include:\n          - os: ubuntu\n            extra: 1\n|build (ubuntu)' \
         'float|    strategy:\n      matrix:\n        python: [3.10]\n|build (3.10)'; do
  IFS='|' read -r label yaml ctx <<EOF
$c
EOF
  newrepo; put .github/workflows/ci.yml "$(ci "$(job build "$yaml")")"; HB=$(cm c0); pushm; branch_pr "$HB"
  tpl ur-u "$(ur "$ctx")"
  ur_case ur-u "$ctx" ''; free
  leftw "M3e/M3in ($label)" "cannot be expanded and may report"
done
# M3gap: an unparseable workflow at the PR's head is unreadable
newrepo; put .github/workflows/ci.yml "$(ci "$(job build)")"; HB=$(cm c0); pushm
branch_pr "$HB" .github/workflows/bad.yml 'on: [push'
ur_case ur build ''; free
leftw M3gap "unreadable: .github/workflows/bad.yml at"
# M7b: an unreported-context note with no Integration log head: unreadable, no gh call
use ur; rsc "$RSC_NR"; free
ok "$rc|$(ncalls)|$(nrow left)" "3|0|1" "M7b: no Integration log head: left, no gh call"
has "$(rows)" "unreadable: the Integration log's last line gives no 40-hex head= and base=" "M7b: … saying why"

# ════ M4-M9: the guards ═══════════════════════════════════════════════════════════════════════════════════════════
newrepo
# M4: a red required check (reasonClass merge-gate) is no settings block
rm -rf "$T"; mkdir -p "$T/tasks" "$T/events"; export THREAD_EVENTS_DIR="$T/events"; fresh
mkro; mkt t
printf '%s' "merge-task: ERROR: a REQUIRED check FAILED on PR #5 (Ralph passed locally, but remote CI is red):" \
  | python3 "$LI" set-aside --note "$T/tasks/t.md" --kind own | python3 "$RR" reconcile --result - --tasks-dir "$T/tasks" --now 2026-10-03T08:00:00Z >/dev/null
free
ok "$rc|$(ncalls)|$(rows | grep -c .)" "5|0|0" "M4: a real red: exit 5, no gh call, no row"
# M5: a repo he does not own; M5b an org admin, an org member
use nr; rsc "$RSC_NR"; echo '{"owner": {"login": "someone", "type": "User"}, "default_branch": "master", "permissions": {"admin": true}}' > "$MT_STATE/repo.json"
free
ok "$rc|$(nwrites)|$(nev setting-left)" "3|0|1" "M5: not owned: left, one setting-left line"
has "$(rows)" "left $FP_NR: not-owned:" "M5: … its row"
ok "$(evs setting-left | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["cause"])')" not-owned "M5: … cause not-owned"
use nr; rsc "$RSC_NR"; echo '{"owner": {"login": "org", "type": "Organization"}, "default_branch": "master", "permissions": {"admin": true}}' > "$MT_STATE/repo.json"
echo admin > "$MT_STATE/orgrole.org"; free
ok "$rc|$(nwrites)" "0|1" "M5b: an org he is an admin of: changed"
use nr; rsc "$RSC_NR"; echo '{"owner": {"login": "org", "type": "Organization"}, "default_branch": "master", "permissions": {"admin": true}}' > "$MT_STATE/repo.json"
echo member > "$MT_STATE/orgrole.org"; free
ok "$rc|$(nwrites)" "3|0" "M5b: an org member without admin: left"
# M6: no admin rights; a 403 on the write
use nr; rsc "$RSC_NR"; echo '{"owner": {"login": "o", "type": "User"}, "default_branch": "master", "permissions": {"admin": false}}' > "$MT_STATE/repo.json"
free
ok "$rc|$(nwrites)" "3|0" "M6: no admin rights: left"; has "$(rows)" "no-rights: this gh token has no admin rights on o/r" "M6: … no-rights"
use nr; rsc "$RSC_NR"; echo 'gh: Resource not accessible by integration (HTTP 403)' > "$MT_STATE/write.err"
free
ok "$rc|$(nrow void)|$(nrow left)" "3|1|1" "M6: a 403 on the write: void, then left"
has "$(rows)" "no-rights: gh: Resource not accessible by integration (HTTP 403)" "M6: … with gh's text"
# M7: no Run-record line names the block
use nr; rsc "$RSC_NR"; rm -f "$THREAD_EVENTS_DIR/ro.jsonl"; free
ok "$rc|$(ncalls)" "3|0" "M7: no set-aside line in the Run record: left, no gh call"; has "$(rows)" "not-recorded:" "M7: … not-recorded"
# M8: the lock held by another process
use nr; rsc "$RSC_NR"
mkdir -p "$THREAD_NOTE_LOCK_DIR"
python3 -c 'import fcntl,os,sys,time
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2], "w").close(); time.sleep(60)' \
  "$THREAD_NOTE_LOCK_DIR/merge-settings-o-r.lock" "$tmp/locked" & holder=$!
i=0; while [ ! -e "$tmp/locked" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
free --now 2026-10-03T09:00:50Z
ok "$rc|$(nrow tried)|$(nwrites)" "75|1|0" "M8: the lock held: exit 75, a tried row (busy)"
I=$(INOW=2026-10-03T09:01:00Z inp)
ok "$(j "$I" '[d["autoRetryAfter"], d["settingsBlock"]["freeNow"], d["humanFix"]]')" '["2026-10-03T09:06+00:00",false,null]' \
  "M8: the try's retry, rounded up past the 5 minutes (a try at :50 s reads 09:06), freeNow false"
free --now 2026-10-03T09:03:00Z
ok "$rc|$(nrow tried)" "75|1" "M8: a second free before the retry exits 75 with no new row"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null; rm -f "$tmp/locked"
# M8b: a transient read twice is 8, the third try left; M8c gh missing
use nr; rsc "$RSC_NR"; echo 'gh: Server Error (HTTP 502)' > "$MT_STATE/err.repo-api"
free; r1=$rc; free --now 2026-10-03T09:06:00Z; r2=$rc; free --now 2026-10-03T09:12:00Z; r3=$rc
ok "$r1|$r2|$r3|$(nrow tried)|$(nrow left)" "8|8|3|2|1" "M8b: a 5xx read: tried (8), tried (8), then left (3)"
has "$(rows)" "unreadable: repos/o/r: gh: Server Error (HTTP 502) (3 tries)" "M8b: … the third names the tries"
use nr; rsc "$RSC_NR"; free --gh-bin "$tmp/no-gh"
ok "$rc|$(nrow left)" "3|1" "M8c: gh missing: left"; has "$(rows)" "unreadable: gh not found" "M8c: … unreadable"
# M9: a second free after changed: 0, no gh call
use nr; rsc "$RSC_NR"; free; free --now 2026-10-03T09:00:30Z
ok "$rc|$(ncalls)" "0|0" "M9: free on a changed block exits 0 with no gh call"; has "$out" "[[t]]: already changed for you: - " "M9: … already changed for you"

# ════ M10-M17 ═════════════════════════════════════════════════════════════════════════════════════════════════════
# M10: rows, restore, a drifted restore, dismiss, --unrestored
use nr; rsc "$RSC_NR"; free
ID=$(rows | sed -n 's/^- [^ ]* changed \([0-9a-f]\{12\}\)$/\1/p')
ms rows --tasks-dir "$T/tasks" --rollout ro
ok "$(j "$out" '[(r["task"], r["state"], r["id"]) for r in d["rows"]]')" "[[\"t\",\"changed\",\"$ID\"]]" "M10: rows lists the open change"
has "$(j "$out" 'd["rows"][0]["undo"]')" "| gh api" "M10: … with its undo"
ms restore --note "$T/tasks/t.md" --id "$ID" --now 2026-10-03T10:00:00Z
ok "$rc|$(nrow restored)|$(nev setting-restored)" "0|1|1" "M10: restore writes the before back, a restored row and a line"
ok "$(python3 -c 'import json,sys; print([c["context"] for c in json.load(open(sys.argv[1]))["checks"]])' "$MT_STATE/rsc.json")" \
  "['ci', 'self-hosted (arm)']" "M10: … the setting restored"
ms rows --tasks-dir "$T/tasks" --rollout ro; ok "$(j "$out" 'len(d["rows"])')" 0 "M10: a restored change is no row"
use nr; rsc "$RSC_NR"; free
ID=$(rows | sed -n 's/^- [^ ]* changed \([0-9a-f]\{12\}\)$/\1/p')
rsc '{"strict": true, "checks": [{"context": "other", "app_id": null}]}'
: > "$MT_STATE/writes.log"; ms restore --note "$T/tasks/t.md" --id "$ID"
ok "$rc|$(nwrites)|$(nrow restored)" "3|0|0" "M10: a drifted setting refuses the restore, nothing written"
has "$out" "its undo: printf" "M10: … printing the undo"
ms dismiss --note "$T/tasks/t.md" --id "$ID" --now 2026-10-03T10:00:00Z
ok "$rc|$(nrow dismissed)|$(nev setting-dismissed)|$(nev setting-changed)" "0|1|1|1" "M10: dismiss: a row and a line, the change's line kept"
ms rows --tasks-dir "$T/tasks"; ok "$(j "$out" 'len(d["rows"])')" 0 "M10: a dismissed change is no open row"
ms rows --tasks-dir "$T/tasks" --unrestored; ok "$(j "$out" '[r["state"] for r in d["rows"]]')" '["dismissed"]' "M10: --unrestored lists it"
# M11: a quote in a context survives the undo; the undo body writes -1 for a null app
tpl q "no-runner: required job \"it's (arm)\" queued 47 minutes with no runner (run 7, job 8)"
use q; rsc '{"strict": false, "checks": [{"context": "ci", "app_id": null}, {"context": "it'"'"'s (arm)", "app_id": 15368}]}'
before=$(canon "$MT_STATE/rsc.json"); free
ok "$rc" 0 "M11: a context named it's (arm) is changed"
has "$(undo_of)" '"app_id":-1' "M11: the undo body writes a null app_id as -1"
(cd "$tmp" && PATH="$tmp/bin:$PATH" sh -c "$(undo_of)") >/dev/null 2>&1
ok "$(canon "$MT_STATE/rsc.json")" "$before" "M11: … and survives the undo's quoting"
# M12: the fake refuses what GitHub refuses
fresh; rsc '{"strict": true, "checks": []}'
g() { printf '%s' "$2" | PATH="$tmp/bin:$PATH" gh api --method "$1" "$3" --input - >/dev/null 2>"$tmp/g.err"; echo "$?:$(grep -c 'HTTP 422' "$tmp/g.err")"; }
ok "$(g PATCH '{"strict": true, "contexts": ["ci"], "checks": []}' repos/o/r/branches/master/protection/required_status_checks)" "1:1" "M12: contexts and checks: 422"
ok "$(g PATCH '{"strict": true, "checks": [{"context": "ci", "app_id": null}]}' repos/o/r/branches/master/protection/required_status_checks)" "1:1" "M12: app_id null: 422"
mkdir -p "$MT_STATE/rulesets"; echo '{"id": 1, "rules": []}' > "$MT_STATE/rulesets/1.json"
ok "$(g PUT '{"rules": [{"type": "pull_request", "parameters": null}]}' repos/o/r/rulesets/1)" "1:1" "M12: a null parameters: 422"
ok "$(g PUT '{"rules": [{"type": "non_fast_forward", "parameters": {}}]}' repos/o/r/rulesets/1)" "1:1" "M12: parameters on non_fast_forward: 422"
ok "$(g PUT '{"rules": [{"type": "non_fast_forward"}]}' repos/o/r/rulesets/1)" "0:0" "M12: (a parameterless rule as {type}: 200)"
# M13: a change whose Run record line would pass MAX_LINE is left, no write
use nr
rsc "$(python3 -c 'import json; print(json.dumps({"strict": True, "checks": [{"context": "ci-%03d-%s" % (i, "x" * 30), "app_id": None} for i in range(300)] + [{"context": "self-hosted (arm)", "app_id": 15368}]}))')"
free
ok "$rc|$(nwrites)" "3|0" "M13: an undo too large to record: left, no write"; has "$(rows)" "undo too large to record" "M13: … saying so"
# M14: a dangling changing row (a crash between the write and its confirmation)
dangle() {  # dangle <live after|before>: a changing row of this block with no changed or void row
  use nr; rsc "$RSC_NR"
  local b='{"checks":[{"app_id":-1,"context":"ci"},{"app_id":15368,"context":"self-hosted (arm)"}],"strict":true}'
  local a='{"checks":[{"app_id":-1,"context":"ci"}],"strict":true}'
  msrow t "- 2026-10-03T08:59:00+00:00 changing cccccccccccc $FP_NR: protection o/r@master: removed \"self-hosted (arm)\"" \
    "  cccccccccccc before: $b" "  cccccccccccc after: $a" "  cccccccccccc undo: true"
  [ "$1" = after ] && rsc '{"strict": true, "checks": [{"context": "ci", "app_id": -1}]}'
  return 0
}
dangle after; ms rows --note "$T/tasks/t.md"
ok "$(j "$out" '[r["state"] for r in d["rows"]]')" '["unconfirmed"]' "M14: rows lists a dangling change as unconfirmed"
free
ok "$rc|$(nwrites)|$(rows | grep -c 'changed cccccccccccc')" "0|0|1" "M14: live = its after: confirmed changed, no second write"
dangle before; free
ok "$rc|$(nwrites)|$(nrow void)|$(nrow changed)" "0|1|1|1" "M14: live = its before: void, then the write runs once"
# M15: two tasks blocked on one context: the second reads cleared; M15b with no record of the change, left
use nr2; rsc "$RSC_NR"; free t; ok "$rc" 0 "M15: (t changes the setting)"
free u
ok "$rc|$(nwrites)|$(nrow cleared u)|$(nev setting-changed)" "0|0|1|1" "M15: u's free reads cleared: no write, no event"
ok "$(j "$(INOW=2026-10-03T09:01:00Z inp u)" 'd["autoRetry"]')" true "M15: u's verdict reads 22a once"
has "$out" "[[u]]: cleared, no setting changed: another task's change freed it" "M15: u's stdout says no setting changed"
hasnt "$out" "merge setting changed for you" "M15: … never the changed-for-you line"
free u; ok "$rc|$(ncalls)" "0|0" "M9b: free on a cleared block exits 0 with no gh call"
has "$out" "[[u]]: already cleared, no setting changed: another task's change freed it" "M9b: … already cleared, no setting changed"
use nr2; rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}]}'; free u
ok "$rc|$(nrow left u)" "3|1" "M15b: not required and no record of a change: left"
# M16: the block boundary (T2)
use nr; rsc "$RSC_NR"; free --gh-bin "$tmp/no-gh"; ok "$rc" 3 "M16: (left: gh missing)"
python3 "$RR" hand-back --tasks t --tasks-dir "$T/tasks" --now 2026-10-03T09:10:00Z >/dev/null 2>&1
python3 "$RR" mark-integrating --tasks t --tasks-dir "$T/tasks" --now 2026-10-03T09:15:00Z >/dev/null 2>&1
lead t "$NR2" 2026-10-03T09:20:00Z
free --now 2026-10-03T09:30:00Z
ok "$rc|$(nwrites)|$(nrow changed)" "0|1|1" "M16: after his hand-back the identical block frees again (a past left row reads nothing)"
use nr; rsc "$RSC_NR"
msrow t "- 2026-10-03T08:00:00+00:00 tried $FP_NR: busy: x" "- 2026-10-03T08:01:00+00:00 tried $FP_NR: busy: x" \
  "- 2026-10-03T08:15:00+00:00 re-entered"
ok "$(j "$(inp)" '[d["settingsBlock"]["freeNow"], d["settingsBlock"]["state"]]')" '[true,"unfreed"]' "M16: a tried row before the boundary counts no try"
use nr; rsc "$RSC_NR"
msrow t "- 2026-10-03T08:00:00+00:00 changing dddddddddddd $FP_NR: protection o/r@master: removed \"self-hosted (arm)\"" \
  "- 2026-10-03T08:00:01+00:00 changed dddddddddddd" "- 2026-10-03T08:05:00+00:00 restored dddddddddddd" \
  "- 2026-10-03T08:15:00+00:00 re-entered"
free; ok "$rc|$(ncalls)" "3|0" "M16: a restored row before a hand-back still exits 3"
# M17: two identical rows in one second keep both indented lines
rm -rf "$T"; mkdir -p "$T"; printf -- '---\nstatus: blocked\n---\n\n## Notes\n\nx\n' > "$T/n.md"
python3 - "$RR" "$T/n.md" <<'PY'
import importlib.util, sys
s = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(s); s.loader.exec_module(rr)
from pathlib import Path
lines = ["- 2026-10-03T09:00:00+00:00 tried aaaaaaaaaaaa: busy: x", "  aaaaaaaaaaaa before: {}"]
for _ in range(2):
    n = rr.Note(Path(sys.argv[2])); rr._append_settings_rows(n, lines); n.save()
PY
ok "$(grep -c '^  aaaaaaaaaaaa before: {}$' "$T/n.md")|$(grep -c '^## Merge settings$' "$T/n.md")" "2|1" "M17: two identical rows keep both indented lines, one section"

# ════ M18: check, the repo check before the first Slot (ADR 0080 d6, p51-5) ══════════════════════════════════════
# The rollout note holds the rows; the recent workflow runs are `runs` and `runjobs.<id>` (ids newest first), and the
# runners registered `runners` (none by default).
OLD=2026-10-03T07:00:00Z; NEW=2026-10-03T08:55:00Z   # 2 hours and 5 minutes before $NOW
jb() {  # jb <name> <status> <conclusion|-> <self|hosted> <runner|-> <created> [<completed>]: one job object
  python3 -c 'import json,sys
n, st, co, kind, rn, at = sys.argv[1:7]
print(json.dumps({"name": n, "status": st, "conclusion": None if co == "-" else co, "created_at": at,
                  "completed_at": sys.argv[7] if len(sys.argv) > 7 else None,
                  "labels": ["self-hosted", "arm64"] if kind == "self" else ["ubuntu-latest"],
                  "runner_id": None if rn == "-" else 3, "runner_name": None if rn == "-" else rn}))' "$@"
}
rj() { local id="$1"; shift; printf '{"total_count": %d, "jobs": [%s]}\n' "$#" "$(IFS=,; echo "$*")" > "$MT_STATE/runjobs.$id"; }
SH='self-hosted (arm)'
CI_OK=$(jb ci completed success hosted gh-1 "$OLD" "$OLD")
STUCK_Q=$(jb "$SH" queued - self - "$OLD")                                       # queued 2 hours
STUCK_C=$(jb "$SH" completed cancelled self - "$OLD" 2026-10-03T08:00:00Z)       # cancelled after an hour's wait
ck() {  # ck [args…]: check on $T/tasks/ro.md
  : > "$MT_STATE/gh.log"; rm -f "$MT_STATE/writes.log"
  out=$(PATH="$tmp/bin:$PATH" python3 "$MS" check --note "$T/tasks/ro.md" --repo "$REPO" --now "$NOW" "$@" 2>&1); rc=$?
}
ckro() { rm -rf "$T"; mkdir -p "$T/tasks" "$T/events"; export THREAD_EVENTS_DIR="$T/events"; fresh; mkro; rsc "$RSC_NR"
  echo '[{"id": 9}, {"id": 7}]' > "$MT_STATE/runs"; }
changed_id() { rows ro | sed -n 's/^- [^ ]* changed \([0-9a-f]\{12\}\)$/\1/p'; }
line_of() { evs "$1" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["task"], d["id"])'; }
# M18a: nothing found when each required check's only jobs are no stop: "self-hosted (arm)" queued 5 minutes, or
# cancelled 30 s after it was created (a hand's or a concurrency group's cancel); ci's only job GitHub-hosted and
# queued 2 hours (beside a "self-hosted (arm)" job a runner took)
for c in "queued 5 minutes|$(jb "$SH" queued - self - "$NEW")|$CI_OK" \
         "cancelled after 30 s|$(jb "$SH" completed cancelled self - "$OLD" 2026-10-03T07:00:30Z)|$CI_OK" \
         "hosted, queued 2 hours|$(jb "$SH" completed success self mac-1 "$OLD" "$OLD")|$(jb ci queued - hosted - "$OLD")"; do
  IFS='|' read -r label job ci <<EOF
$c
EOF
  ckro; rj 9 "$ci" "$job"; rj 7; ck
  ok "$rc|$(nwrites)|$(rows ro | grep -c .)" "0|0|0" "M18a ($label): exit 0, no write, no row"
  has "$out" "repo check: nothing found on o/r@master (2 required checks against 2 recent workflow runs)" "M18a ($label): … nothing found"
done
# M18b: a required check whose only jobs no runner took, queued and cancelled, and whose labels the one registered
# runner (self-hosted, x64) does not cover: found and cleared, its undo logged; restore and dismiss on the rollout note
ckb() { ckro; rj 9 "$CI_OK" "$STUCK_Q"; rj 7 "$CI_OK" "$STUCK_C"
  echo '[{"name": "linux-1", "status": "online", "busy": false, "labels": [{"name": "self-hosted"}, {"name": "x64"}]}]' > "$MT_STATE/runners"
  before=$(canon "$MT_STATE/rsc.json"); ck; }
ckb
ok "$rc|$(nwrites)|$(nrow changing ro)|$(nrow changed ro)" "0|1|1|1" "M18b: exit 0, one write, a changing and a changed row on the rollout note"
has "$(cat "$MT_STATE/writes.log")" '{"checks":[{"app_id":-1,"context":"ci"}],"strict":true}' "M18b: … the PATCH removes only that check"
ok "$(evs setting-changed | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["task"], d["block"], d["context"])')" \
  "ro no-runner self-hosted (arm)" "M18b: a setting-changed line in the rollout's Run record"
has "$out" "[[ro]]: merge setting changed for you (protection o/r@master: removed \"self-hosted (arm)\"); undo: printf" "M18b: … listed as changed for you"
ms rows --tasks-dir "$T/tasks" --rollout ro
ok "$(j "$out" '[(r["task"], r["state"]) for r in d["rows"]]')" '[["ro","changed"]]' "M18b: rows reads it off the rollout note"
ID=$(changed_id); ms restore --note "$T/tasks/ro.md" --id "$ID" --now 2026-10-03T10:00:00Z
ok "$rc|$(canon "$MT_STATE/rsc.json")|$(nrow restored ro)" "0|$before|1" "M18b: restore on the rollout note writes the before back, a restored row"
ok "$(line_of setting-restored)" "ro $ID" "M18b: … a setting-restored line, task ro, in the rollout's Run record"
ckb; ID=$(changed_id); ms dismiss --note "$T/tasks/ro.md" --id "$ID" --now 2026-10-03T10:00:00Z
ok "$rc|$(nrow dismissed ro)|$(line_of setting-dismissed)" "0|1|ro $ID" "M18b: dismiss on the rollout note: a dismissed row and a setting-dismissed line, task ro"
mkdir -p "$T/tasks/Archive/Rollouts"; mv "$T/tasks/ro.md" "$T/tasks/Archive/Rollouts/"; ms rows --tasks-dir "$T/tasks" --rollout ro --unrestored
ok "$(j "$out" '[(r["task"], r["state"]) for r in d["rows"]]')" '[["ro","dismissed"]]' "M18b: … still listed once the rollout note is archived"
# M18f: a registered runner whose labels cover the stuck job's (case folded), offline or busy, or the owning org's:
# listed, never freed (it may yet take the job, ADR 0080 d2); M18g: the runners unread: left
for c in 'runners|"mac-1" (offline)|{"name": "mac-1", "status": "offline", "busy": false, "labels": [{"name": "Self-Hosted"}, {"name": "macOS"}, {"name": "ARM64"}]}' \
         'runners|"mac-1" (online, busy)|{"name": "mac-1", "status": "online", "busy": true, "labels": [{"name": "self-hosted"}, {"name": "arm64"}]}' \
         'runners.org|"org-mac" (online)|{"name": "org-mac", "status": "online", "busy": false, "labels": [{"name": "self-hosted"}, {"name": "arm64"}]}'; do
  IFS='|' read -r file want runner <<EOF
$c
EOF
  ckro; rj 9 "$CI_OK" "$STUCK_Q"; rj 7 "$CI_OK"; echo "[$runner]" > "$MT_STATE/$file"
  if [ "$file" = runners.org ]; then echo admin > "$MT_STATE/orgrole.org"
    echo '{"owner": {"login": "org", "type": "Organization"}, "default_branch": "master", "permissions": {"admin": true}}' > "$MT_STATE/repo.json"; fi
  ck
  ok "$rc|$(nwrites)|$(rows ro | grep -c .)|$(nev setting-left)" "3|0|0|0" "M18f ($want): exit 3, no write, no row"
  has "$out" "[[ro]]: not changed (runner): required check \"$SH\": runner $want is registered for its jobs' labels: listed for you" \
    "M18f ($want): … listed for you"
done
ckro; rj 9 "$CI_OK" "$STUCK_Q"; rj 7 "$CI_OK"; echo 'gh: Must have admin rights to Repository. (HTTP 403)' > "$MT_STATE/err.runners"; ck
ok "$rc|$(nwrites)|$(nrow left ro)" "3|0|1" "M18g: the runners unread: left, no write"; has "$(rows ro)" "unreadable: repos/o/r/actions/runners: HTTP 403" "M18g: … unreadable"
# M18c: a required check with no recent run is listed, never changed; M18d: one he cannot change is left, listed
ckro; rsc '{"strict": true, "checks": [{"context": "ci", "app_id": null}, {"context": "gone", "app_id": null}]}'
rj 9 "$CI_OK"; rj 7 "$CI_OK"; ck
ok "$rc|$(nwrites)|$(rows ro | grep -c .)" "3|0|0" "M18c: no recent run: exit 3, no write, no row"
has "$out" 'repo check: required check "gone" has no job in the last 2 workflow runs of o/r' "M18c: … listed for you"
ckro; rj 9 "$CI_OK" "$STUCK_Q"; rj 7 "$CI_OK"
echo '{"owner": {"login": "someone", "type": "User"}, "default_branch": "master", "permissions": {"admin": true}}' > "$MT_STATE/repo.json"
ck
ok "$rc|$(nwrites)|$(nrow left ro)|$(nev setting-left)" "3|0|1|1" "M18d: a repo he does not own: left, no write, a left row and line"
# M18e: a read that fails is no finding
ckro; echo 'gh: Server Error (HTTP 502)' > "$MT_STATE/err.runs"; ck
ok "$rc|$(nwrites)" "8|0" "M18e: the runs unread: exit 8, nothing written"; has "$out" "repo check: not read (" "M18e: … not read"

echo; [ "$fail" -eq 0 ] && echo "merge-settings: ALL PASS" || echo "merge-settings: SOME FAILED"
exit "$fail"
