#!/usr/bin/env bash
# p39-14 (ADR 0070): a set-aside task whose normal budget is spent runs Overtime by itself, then is taken out of its
# rollout with its dependants, listed and never asked. One decision function, lead-integrate.py auto_retry_verdict
# (`inputs` prints its `overtime` and `takeOut`), and two writing verbs: reconcile-rollout.py auto-retry (an Overtime run:
# `overtime_used`, the raise of the cap its stop spent and `auto_retry_raised`) and `defer --take-out` (the closure, the
# retire block, the rollout's `## Notes` lines, the `take-out` events and the markers).
#   O1  a review-blocked task past auto_retries re-enters three times with a raised max_review_rounds and no humanFix,
#       then is taken out with its queued dependant, leaves first   O2 a repeated fingerprint is taken out at once
#   O3  his decisions stay his (a gate, a question, cause 23, a `left` answer, auto_retries 0 at the same stop)
#   O4  budget edges (overtime_runs 0, auto_retries 0, the fail-closed order, an invalid overtime_runs stamp)
#   O5  infra and quota Overtime cool down 240 and 480 minutes, then are taken out   O6 the markers' lifetimes
#   O7  the take-out's exits and recovery: (a) a running dependant waits, (b) crash states re-run to completion,
#       (c) a merged PR is exit 4 then `resume`, (d) a failing `gh pr close` reaches the bound, (e) a PR merged elsewhere
#   O8  plan rounds and max_iterations raise   O9 the --max-review-rounds overlay clears overtime and takeOut
# The blocks are built through the real `reconcile` (and `lead-integrate.py set-aside` for the lead's own rows).
# Hermetic: HOME is an empty dir of its own, each scenario's Project root is a temp git checkout (with a real task tree
# and integration anchor where the retire block is read), `gh` is a fake through --gh-bin whose answers and failures
# each scenario sets, and the Run record is a THREAD_EVENTS_DIR per scenario. Temp notes only; no vault, no network.
# Usage: bash reconcile-rollout-overtime.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR XDG_STATE_HOME
export THREAD_EVENTS_DIR="$TMP/events"
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"
export THREAD_HEAT_LEVEL=0
NOW=2026-10-03T09:00:00Z
PR=https://github.com/o/r/pull/5
TRANSIENT='transient infrastructure failure — the agent process died mid-run on a terminal API/connection error'

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

A=proj-p1-1-a
B=proj-p1-2-b
C=proj-p1-3-c
RO=proj-rollout-2026-10-03

# The fake gh: every call is logged to $D/gh.log; `pr view` answers state $D/gh-state (OPEN) and base $D/gh-base
# (main); `repo view` answers $D/gh-default (main); a call whose argv contains the text in $D/gh-fail exits 1.
GH="$TMP/gh"
cat > "$GH" <<'SH'
#!/usr/bin/env bash
D="$GH_DIR"
printf '%s\n' "$*" >> "$D/gh.log"
if [ -f "$D/gh-fail" ] && case "$*" in *"$(cat "$D/gh-fail")"*) true;; *) false;; esac; then
  echo "gh: HTTP 502: Bad Gateway" >&2; exit 1
fi
case "$1 $2" in
  "pr view") printf '{"state":"%s","baseRefName":"%s","url":"%s","mergedAt":"2026-10-03T08:30:00Z","mergeCommit":{"oid":"%s"}}\n' \
      "$(cat "$D/gh-state" 2>/dev/null || echo OPEN)" "$(cat "$D/gh-base" 2>/dev/null || echo main)" "$3" \
      "dddddddddddddddddddddddddddddddddddddddd";;
  "repo view") cat "$D/gh-default" 2>/dev/null || echo main;;
  "pr close") ;;
esac
SH
chmod +x "$GH"

D=""
scen() {
  D="$TMP/$1"; mkdir -p "$D/root"; git -c init.defaultBranch=master init -q "$D/root"; echo "== $1"
  git -C "$D/root" commit -q --allow-empty -m root
  export THREAD_EVENTS_DIR="$D/events" THREAD_GIT_ENV_DIR="$TMP/git-env/$1" GH_DIR="$D"
  rm -rf "$HOME/.config"
}
# mkro [frontmatter lines...] — the rollout note: Project root $D/root, the queue A, B, C with their file-sets
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nprojects:\n  - "[[Proj]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s/root`\n\n## Queue\n\n| # | Task | Mode |\n|---|---|---|\n| 1 | [[%s]] | parallel |\n| 2 | [[%s]] | parallel |\n| 3 | [[%s]] | parallel |\n\n## File-sets\n\n- %s: a.py\n- %s: b.py\n- %s: c.py\n' \
      "$D" "$A" "$B" "$C" "$A" "$B" "$C"; } > "$D/$RO.md"
}
# mkt <slug> <status> [frontmatter lines...] — a task note linked to the rollout, with a brief
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[%s]]"\n' "$st" "$RO"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n**Do.**\n\n- add the migration\n'; } > "$D/$s.md"
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
setfm() {
  python3 - "$D/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
head, body = t.split("\n---\n", 1)
lines = head.split("\n")
idx = [i for i, l in enumerate(lines) if re.match(r"^%s:" % re.escape(k), l)]
if idx:
    lines[idx[0]] = "%s: %s" % (k, v)
else:
    lines.append("%s: %s" % (k, v))
open(p, "w").write("\n".join(lines) + "\n---\n" + body)
PY
}
sec() { awk -v h="$2" '$0==h{on=1; next} on && /^## /{exit} on{print}' "$D/$1.md"; }
row() {
  python3 -c 'import json,sys
s, st, d = sys.argv[1:4]
r = {"slug": s, "scope": "cross-cutting", "status": st, "prUrl": "", "blockerDiagnosis": d}
if len(sys.argv) > 4: r.update(json.loads(sys.argv[4]))
print(json.dumps({"rolloutSlug": "ro", "tasks": [r]}))' "$@"
}
rec() { python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${2:-2026-10-03T08:00:00Z}" <<<"$1" >/dev/null; }
lead() { printf '%s' "$3" | python3 "$LI" set-aside --note "$D/$1.md" --kind "$2" | python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${4:-2026-10-03T08:00:00Z}" >/dev/null; }
inp() { python3 "$LI" inputs --note "$D/$1.md" --now "${INOW:-$NOW}" "${@:2}"; }
ar() { out=$(python3 "$SCRIPT" auto-retry --tasks "$1" --rollout "$D/$RO.md" --tasks-dir "$D" --now "${ANOW:-$NOW}" "${@:2}" 2>&1); rc=$?; }
tko() { out=$(python3 "$SCRIPT" defer --take-out --tasks "$1" --rollout "$D/$RO.md" --tasks-dir "$D" --gh-bin "$GH" --now "${TNOW:-$NOW}" "${@:2}" 2>&1); rc=$?; }
mov() { python3 "$SCRIPT" moving --rollout "$D/$RO.md" --tasks-dir "$D" --now "${MNOW:-$NOW}" --gh-bin "$GH" 2>/dev/null; }
ms() {
  local o
  o=$(python3 "$SCRIPT" mark-started --tasks "$1" --tasks-dir "$D" --now "${2:-$NOW}" --arm-repo "$D/root" --arm-default master 2>&1) \
    || { echo "FAIL - mark-started $1 exited $?: $o"; fail=1; }
}
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), sort_keys=True))' "$2"; }
snap() { (cd "$D" && find . -path ./events -prune -o -path ./root -prune -o -name gh.log -prune -o -type f -print | LC_ALL=C sort | while read -r f; do printf '%s\n' "$f"; cat "$f"; done) | shasum | cut -c1-40; }
cnt() { [ -f "$THREAD_EVENTS_DIR/$RO.jsonl" ] && wc -l < "$THREAD_EVENTS_DIR/$RO.jsonl" | tr -d ' ' || echo 0; }
evs() {  # evs <kind> <expr>: each line of that kind, as expr over d
  [ -f "$THREAD_EVENTS_DIR/$RO.jsonl" ] || { echo ""; return; }
  python3 -c 'import json,sys
out = []
for l in open(sys.argv[1]):
    d = json.loads(l)
    if d["kind"] == sys.argv[2]:
        out.append(json.dumps(eval(sys.argv[3]), separators=(",", ":"), sort_keys=True))
print(" ".join(out))' "$THREAD_EVENTS_DIR/$RO.jsonl" "$1" "$2"
}
branch() { python3 -c 'import importlib.util,sys
s=importlib.util.spec_from_file_location("li",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.branch_of(sys.argv[2]))' "$LI" "$1"; }
# tree <slug>: the engine's task tree and its integration anchor in the Project root
tree() {
  local br; br=$(branch "$1")
  git -C "$D/root" worktree add -q -b "$br" "$D/root/.claude/worktrees/$1" 2>/dev/null
  git -C "$D/root" update-ref "refs/integration-anchor/$br" "$(git -C "$D/root" rev-parse HEAD)"
}
anchor() { git -C "$D/root" rev-parse -q --verify "refs/integration-anchor/$(branch "$1")" >/dev/null && echo yes || echo no; }
# rvblock <slug> <feedback> [now] — a running task review-blocks (its own run, four rounds) through the real reconcile
rvblock() {
  setfm "$1" status in_progress; setfm "$1" owner execute-test
  local x="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"feedback\":[\"r1\"]},{\"round\":2,\"feedback\":[\"r2\"]},{\"round\":3,\"feedback\":[\"r3\"]},{\"round\":4,\"feedback\":[\"$2\"]}]}"
  rec "$(row "$1" review-blocked "" "$x")" "${3:-2026-10-03T08:00:00Z}"
}
planblock() { setfm "$1" status in_progress; setfm "$1" owner execute-test; rec "$(row "$1" plan-blocked "$2")" "${3:-2026-10-03T08:00:00Z}"; }
blk() { setfm "$1" status in_progress; setfm "$1" owner execute-test; rec "$(row "$1" blocked "$2")" "${3:-2026-10-03T08:00:00Z}"; }
S_NOW="2026-10-03T09:00+00:00"

# ── O1: a review-blocked task past auto_retries runs three Overtime re-entries, then is taken out with its dependant ──
scen o1
mkro
mkt "$A" in_progress "owner: execute-test" "pr: $PR" "auto_retries: 1"
mkt "$B" open 'depends-on: ["[[proj-p1-1-a]]"]'
mkt "$C" open
tree "$A"
rvblock "$A" "round 4: the migration misses the rollback"
ar "$A"
ok "$rc|$(fm "$A" auto_retries_used)" "0|auto_retries_used: 1" "O1: the normal budget's one retry"
for k in 1 2 3; do
  ms "$A"
  rvblock "$A" "round 4: overtime block $k" "2026-10-03T08:1${k}:00Z"
  I=$(inp "$A")
  ok "$(j "$I" '[d["autoRetry"], d["humanFix"], d["takeOut"], d["overtime"]["used"], d["overtime"]["budget"], d["overtime"]["raise"]]')" \
    "[true,null,null,$((k - 1)),3,{\"field\":\"max_review_rounds\",\"to\":$((k + 4))}]" \
    "O1 overtime $k: autoRetry true, no humanFix, overtime $((k - 1))/3, raise max_review_rounds to $((k + 4))"
  FP=$(j "$I" 'd["fingerprint"]')
  M=$(cnt)
  ar "$A"
  ok "$rc|$out" "0|$A: auto-retry overtime $k/3 (review; feedback $FP; max_review_rounds raised to $((k + 4))) review-blocked->in_progress [written]" \
    "O1 overtime $k: the verb re-enters it"
  ok "$(fm "$A" overtime_used)|$(fm "$A" max_review_rounds)|$(fm "$A" auto_retry_raised)|$(fm "$A" auto_retries_used)" \
    "overtime_used: $k|max_review_rounds: $((k + 4))|auto_retry_raised: max_review_rounds=-|auto_retries_used: 1" \
    "O1 overtime $k: overtime_used, the raise, its prior value recorded once (absent: -), the normal counter untouched"
  ok "$(sec "$RO" '## Notes' | grep "auto-retry: \[\[$A\]\] overtime $k/3")" \
    "- $S_NOW auto-retry: [[$A]] overtime $k/3 (review; feedback $FP); max_review_rounds raised to $((k + 4)), one round" \
    "O1 overtime $k: the Notes line"
  ok "$(evs auto-retry '[d.get("overtime"), d.get("overtimeBudget"), d.get("raiseField"), d.get("raiseTo"), d.get("reviewRounds")]' | tr ' ' '\n' | tail -1)" \
    "[$k,3,\"max_review_rounds\",$((k + 4)),$((k + 4))]" "O1 overtime $k: the event's Overtime fields"
done
ms "$A"
rvblock "$A" "round 4: still the rollback" 2026-10-03T08:40:00Z
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["humanFix"], d["overtime"], d["takeOut"]["cause"], d["takeOut"]["overtimeUsed"], d["takeOut"]["failures"]]')" \
  '[false,null,null,"spent",3,0]' "O1: the fourth block past the budget reads takeOut spent, no humanFix"
ok "$(j "$I" 'd["autoRetryWhy"]')" "budget: 1/1 used; overtime 3/3 used: the lead takes it out" "O1: its why"
FP=$(j "$I" 'd["fingerprint"]')
before=$(snap); ar "$A"
ok "$rc|$(snap)" "1|$before" "O1: auto-retry refuses a take-out, nothing written"
M=$(cnt)
tko "$A"
ok "$rc" 0 "O1: defer --take-out exits 0"
ok "$(printf '%s\n' "$out" | grep -v deferred)" "$A: taken out after 3 Overtime runs (spent) → open [written]
$B: taken out with $A → open [written]" "O1: the two take-out lines"
ok "$(printf '%s\n' "$out" | grep -c 'deferred->open')" 2 "O1: each member deferred through defer's own save"
ok "$(printf '%s\n' "$out" | grep -n deferred | cut -d: -f1 | head -1)|$(printf '%s\n' "$out" | grep -n "^$B: deferred" | cut -d: -f1)" \
  "1|1" "O1: leaves first: the dependant is deferred before the task"
ok "$(fm "$A" status)|$(fm "$B" status)|$(fm "$C" status)" "status: open|status: open|status: open" "O1: both members open (C was open already)"
ok "$(fm "$A" rollout)|$(fm "$B" rollout)|$(fm "$C" rollout)" "<none>|<none>|rollout: \"[[$RO]]\"" "O1: the closure leaves the rollout, C stays"
ok "$(fm "$A" overtime_used)|$(fm "$A" auto_retry_raised)|$(fm "$A" max_review_rounds)" "<none>|<none>|<none>" \
  "O1: overtime_used and auto_retry_raised cleared, and max_review_rounds restored (removed: it was absent)"
ok "$(fm "$A" taken_out)|$(fm "$A" taken_out_of)|$(fm "$B" taken_out)|$(fm "$B" taken_out_of)" \
  "taken_out: 1|taken_out_of: [\"[[$RO]]\"]|<none>|<none>" "O1: taken_out and taken_out_of on the task only"
ok "$(sec "$RO" '## Queue' | grep -c '\[\[')|$(sec "$RO" '## Queue' | grep -c "\[\[$C\]\]")|$(sec "$RO" '## File-sets' | grep -c .)" "1|1|1" \
  "O1: the members' Queue rows and File-sets lines gone, C's kept"
ok "$(sec "$RO" '## Notes' | grep ' take-out: ')" \
  "- $S_NOW take-out: [[$A]] after 3 Overtime runs (review; Round 4: round 4: still the rollback; $PR; feedback $FP)
- $S_NOW take-out: [[$B]] with [[$A]] (its dependant; feedback $FP)" "O1: the rollout's Notes lines, one per member"
ok "$(evs take-out '[d["task"], d["cause"], d.get("stage"), d.get("overtimeUsed"), d.get("overtimeBudget"), d.get("with"), d["fingerprint"]]')" \
  "[\"$B\",\"dependant\",null,null,null,\"$A\",\"$FP\"] [\"$A\",\"spent\",\"review\",3,3,null,\"$FP\"]" \
  "O1: two take-out events, leaves first: the dependant's has no stage and has with"
ok "$(grep -c "pr close $PR --delete-branch" "$D/gh.log")" 1 "O1: the fake gh saw pr close --delete-branch"
ok "$([ -d "$D/root/.claude/worktrees/$A" ] && echo yes || echo no)|$(anchor "$A")" "no|no" "O1: the task tree and its anchor are gone"
before=$(snap); tko "$A"
ok "$rc|$out|$(snap)" "0|$A: already taken out of [[$RO]] [no-change]|$before" "O1: a re-run reads [no-change], nothing written"

# ── O2: a repeated fingerprint is taken out at once, budget left ────────────────────────────────────────────────────
scen o2
mkro; mkt "$A" in_progress "owner: execute-test"; mkt "$B" open; mkt "$C" open
planblock "$A" "Round 1: the plan misses the migration step"
ar "$A"
ms "$A"
planblock "$A" "Round 1: the plan misses the migration step" 2026-10-03T08:10:00Z
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["humanFix"], d["takeOut"]["cause"], d["autoRetriesUsed"], d["takeOut"]["overtimeUsed"]]')" \
  '[false,null,"same-feedback",1,0]' "O2: the same feedback with budget left reads takeOut same-feedback, no humanFix"
tko "$A"
ok "$rc|$(printf '%s\n' "$out" | tail -1)" "0|$A: taken out after 0 Overtime runs (same-feedback) → open [written]" "O2: taken out at once"
ok "$(evs take-out '[d["task"], d["cause"], d["stage"]]')" "[\"$A\",\"same-feedback\",\"plan\"]" "O2: its event"
ok "$(grep -c 'pr close' "$D/gh.log" 2>/dev/null || echo 0)" 0 "O2: no PR, no gh close"

echo
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
