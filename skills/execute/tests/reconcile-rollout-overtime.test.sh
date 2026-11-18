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
#       (c) a merged PR is exit 4, a paused line and no failure, then `resume`, (d) a failing `gh pr close` reaches the
#       bound, (e) a PR merged elsewhere, (f) a member's save that fails is one failure line and a cool-down, (w) an
#       awaiting-Integration or RACE-held member waits
#   O8  plan rounds and max_iterations raise   O9 the --max-review-rounds overlay clears overtime and takeOut
#   O10 the closure: a chain, a tombstone fold, a dependant's own PR and raised cap, and a Speed fix hold's entry left out
#   O11 across versions: on an engine from before p39-14, `moving` and needs-you read a spent budget as Lachy's
# The blocks are built through the real `reconcile` (and `lead-integrate.py set-aside` for the lead's own rows).
# Hermetic: HOME is an empty dir of its own, each scenario's Project root is a temp git checkout (with a real task tree
# and integration anchor where the retire block is read), `gh` is a fake through --gh-bin whose answers and failures
# each scenario sets, and the Run record is a THREAD_EVENTS_DIR per scenario. Each rollout is stamped on this tree's
# engine (O11 restamps one on an old root), so the guard-exempt readers never read the Primary checkout's. Temp notes
# only; no vault, no network.
# Usage: bash reconcile-rollout-overtime.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
UR="$HERE/../../_shared/scripts/unfinished-rollout.py"
NEWROOT="$(cd "$HERE/../../.." && pwd -P)"
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
H=proj-p1-4-h
X=proj-p1-5-x
T=proj-p1-6-t
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
# mkro [frontmatter lines...] — the rollout note on this tree's engine: Project root $D/root, the queue A, B, C with
# their file-sets
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nprojects:\n  - "[[Proj]]"\n'
    printf 'engine_snapshot: "%s"\n' "$NEWROOT"
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
ok "$(j "$(inp "$A" --max-review-rounds 9)" '[d["takeOut"], d["humanFix"]]')" '[null,null]' "O9: an overlay mismatch clears takeOut"
tko "$A"
ok "$rc|$(printf '%s\n' "$out" | tail -1)" "0|$A: taken out after 0 Overtime runs (same-feedback) → open [written]" "O2: taken out at once"
ok "$(evs take-out '[d["task"], d["cause"], d["stage"]]')" "[\"$A\",\"same-feedback\",\"plan\"]" "O2: its event"
ok "$(grep -c 'pr close' "$D/gh.log" 2>/dev/null || echo 0)" 0 "O2: no PR, no gh close"

# ── O3: his decisions stay his, the budget spent or not: no Overtime and no take-out under them ───────────────────
# vt <label> <expected act>: the read in I carries that humanFix act and neither overtime nor takeOut
vt() { ok "$(j "$I" '[d["humanFix"]["act"] if d["humanFix"] else None, d["overtime"], d["takeOut"]]')" "[\"$2\",null,null]" "O3 $1: $2, no Overtime, no take-out"; }
scen o3-gate
mkro; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2"; mkt "$B" open
rec "$(row "$A" gate-pending "" '{"gatedInputs":["spend: x — cap USD 1"]}')"
I=$(inp "$A"); vt gate "sign off gated input"
scen o3-question
mkro; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2"; mkt "$B" open
rec "$(row "$A" blocked "the feedback" '{"needsHuman":"Which API key?"}')"
I=$(inp "$A"); vt question "answer the question"
scen o3-same-stop
mkro; mkt "$A" review "pr: $PR" "ready: 2026-10-03T06:00+00:00" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
KILL="merge-task signalled twice (143): last wait: PR #5 — required checks not created yet; CI in flight on head — waiting on: build (in_progress)"
lead "$A" integration "$KILL"
ANOW=2026-10-03T08:15:00Z ar "$A"
python3 "$SCRIPT" mark-integrating --tasks "$A" --tasks-dir "$D" --now 2026-10-03T08:20:00Z >/dev/null 2>&1
lead "$A" integration "$KILL" 2026-10-03T08:30:00Z
I=$(INOW=2026-10-03T09:30:00Z inp "$A"); vt "same stop (cause 23)" "hand back or defer"
has "$(j "$I" 'd["autoRetryWhy"]')" "same stop twice running at Integration" "O3 same stop: its why"
setfm "$A" auto_retries 0
I=$(INOW=2026-10-03T09:30:00Z inp "$A"); vt "auto_retries 0 at the same stop" "hand back or defer"
ok "$(j "$I" 'd["autoRetryWhy"]')" "auto_retries is 0: automatic retries are off" "O3 auto_retries 0 at the same stop: decision 4's stop keeps cause 18's H10"
scen o3-left
mkro; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2"; mkt "$B" open
planblock "$A" "Round 1: the plan misses the migration step"
ok "$(j "$(inp "$A")" 'd["overtime"]["used"]')" 0 "O3 left: (an Overtime run before the answer)"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
python3 "$SCRIPT" record-answer --tasks "$A" --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" --kind decision --ask x \
  --answer "leave it" --fingerprint "$FP" --form left >/dev/null 2>&1
I=$(inp "$A"); vt "a left answer" "hand back or defer"
has "$(j "$I" 'd["humanFix"]["detail"]')" "left on your answer of $S_NOW" "O3 left: his answer keeps it"

# ── O4: budget edges ────────────────────────────────────────────────────────────────────────────────────────────
scen o4
mkro; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2" "overtime_runs: 0"; mkt "$B" open
planblock "$A" "Round 1: the plan misses the migration step"
ok "$(j "$(inp "$A")" '[d["humanFix"], d["overtime"], d["takeOut"]["cause"], d["takeOut"]["overtimeBudget"]]')" '[null,null,"spent",0]' \
  "O4: overtime_runs 0 → a take-out at the budget point"
setfm "$A" overtime_runs 3; setfm "$A" auto_retries 0; setfm "$A" auto_retries_used 0
ok "$(j "$(inp "$A")" '[d["humanFix"], d["takeOut"]["cause"], d["autoRetryWhy"]]')" \
  '[null,"no-overtime","auto_retries is 0: automatic retries are off, so no Overtime: the lead takes it out"]' "O4: auto_retries 0 → a take-out at once"
for k in "overtime_used:x" "auto_retries_used:-1" "auto_retry_at:yesterday"; do
  setfm "$A" "${k%%:*}" "${k#*:}"
  ok "$(j "$(inp "$A")" '[d["humanFix"]["act"], d["takeOut"], d["autoRetryWhy"]]')" "[\"hand back or defer\",null,\"malformed ${k%%:*}: '${k#*:}' (fails closed)\"]" \
    "O4: a malformed ${k%%:*} fails closed to H10 under auto_retries 0, never a take-out"
  setfm "$A" "${k%%:*}" 0; [ "${k%%:*}" = auto_retry_at ] && setfm "$A" auto_retry_at 2026-10-03T07:00+00:00
done
mkt "$C" plan-blocked "auto_retries: 0"
ok "$(j "$(inp "$C")" '[d["humanFix"]["act"], d["takeOut"], d["autoRetryWhy"]]')" \
  '["hand back or defer",null,"no feedback fingerprint: the block recorded no feedback"]' "O4: no fingerprint fails closed to H10, never a take-out"
setfm "$A" overtime_runs x
ok "$(j "$(inp "$A")" '[d["humanFix"]["act"], d["autoRetryError"]]')" \
  "[\"fix the round budget\",\"overtime_runs on [[$A]] must be an integer >= 0, got 'x'\"]" "O4: an invalid overtime_runs stamp is H12"

# ── O5: infra and quota Overtime cool down 240 and 480 minutes, then are taken out ─────────────────────────────────
scen o5-infra
mkro; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2" "overtime_runs: 1"; mkt "$B" open
planblock "$A" "$TRANSIENT"
ok "$(j "$(INOW=2026-10-03T11:59:00Z inp "$A")" '[d["autoRetry"], d["autoRetryAfter"], d["overtime"], d["humanFix"]]')" '[false,"2026-10-03T12:00+00:00",null,null]' \
  "O5 infra: past its budget it cools 240 minutes (INFRA_COOLDOWN_MIN[-1])"
ok "$(j "$(INOW=2026-10-03T12:00:00Z inp "$A")" '[d["autoRetry"], d["overtime"]["used"], d["overtime"]["raise"]]')" '[true,0,null]' \
  "O5 infra: then an Overtime run, no raise (a transient spends no cap)"
ANOW=2026-10-03T12:00:00Z ar "$A"
ok "$rc|$(fm "$A" overtime_used)" "0|overtime_used: 1" "O5 infra: the Overtime re-entry"
ms "$A" 2026-10-03T12:01:00Z; planblock "$A" "$TRANSIENT" 2026-10-03T12:10:00Z
ok "$(j "$(INOW=2026-10-03T12:10:00Z inp "$A")" '[d["autoRetryAfter"], d["takeOut"]["cause"], d["humanFix"]]')" '[null,"spent",null]' \
  "O5 infra: the Overtime spent → a take-out, no cool-down to wait"
scen o5-quota
mkro; mkt "$A" in_progress "owner: execute-test" "quota_retries_used: 5" "overtime_runs: 1"; mkt "$B" open
lead "$A" own "workflow call failed: API Error: usage limit reached" 2026-10-03T10:00:00Z
ok "$(j "$(INOW=2026-10-03T17:59:00Z inp "$A")" '[d["autoRetryClass"], d["autoRetryAfter"], d["humanFix"]]')" '["quota","2026-10-03T18:00+00:00",null]' \
  "O5 quota: past its five free retries it cools 480 minutes"
ANOW=2026-10-03T18:00:00Z ar "$A"
ok "$rc|$(fm "$A" overtime_used)|$(fm "$A" quota_retries_used)|$(printf '%s' "$out" | cut -d' ' -f2-4)" "0|overtime_used: 1|quota_retries_used: 5|auto-retry overtime 1/1" \
  "O5 quota: an Overtime run, the quota counter untouched"
setfm "$A" status in_progress; ms "$A" 2026-10-03T18:01:00Z
lead "$A" own "workflow call failed: API Error: usage limit reached" 2026-10-03T18:10:00Z
ok "$(j "$(INOW=2026-10-04T08:00:00Z inp "$A")" '[d["takeOut"]["cause"], d["humanFix"]]')" '["spent",null]' "O5 quota: then a take-out"

# ── O6: the markers' lifetimes ────────────────────────────────────────────────────────────────────────────────
scen o6
mkro; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2" "max_iterations: 2"; mkt "$B" open
blk "$A" "the implementer could not make the migration test pass"
ok "$(j "$(inp "$A")" 'd["overtime"]["raise"]')" '{"field":"max_iterations","to":3}' "O6: (an own blocker raises max_iterations)"
ar "$A"
ok "$(fm "$A" overtime_used)|$(fm "$A" auto_retry_raised)|$(fm "$A" max_iterations)" "overtime_used: 1|auto_retry_raised: max_iterations=2|max_iterations: 3" \
  "O6: the raise records the stamp it replaced"
ms "$A"; blk "$A" "the implementer still could not make it pass" 2026-10-03T08:10:00Z
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
ok "$(fm "$A" overtime_used)|$(fm "$A" auto_retry_raised)|$(fm "$A" auto_retries_used)" "overtime_used: 1|auto_retry_raised: max_iterations=2|<none>" \
  "O6: hand-back gives back the normal budget and keeps the Overtime's markers"
mkro "paused: 2026-10-03T08:00+00:00"
setfm "$A" status blocked; setfm "$A" owner execute-test
{ printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nsupersedes: "[[%s]]"\n---\n\n## Queue\n' "$RO"; } > "$D/proj-rollout-2026-10-04.md"
python3 "$SCRIPT" carry --from "$D/$RO.md" --to "$D/proj-rollout-2026-10-04.md" --tasks-dir "$D" >/dev/null 2>&1
ok "$(fm "$A" overtime_used)|$(fm "$A" auto_retry_raised)" "overtime_used: 1|auto_retry_raised: max_iterations=2" "O6: carry keeps them"
setfm "$A" taken_out 1
python3 "$SCRIPT" defer --tasks "$A" --tasks-dir "$D" >/dev/null 2>&1
ok "$(fm "$A" overtime_used)|$(fm "$A" auto_retry_raised)|$(fm "$A" max_iterations)|$(fm "$A" taken_out)" \
  "<none>|<none>|max_iterations: 3|taken_out: 1" "O6: a plain defer clears both, leaves the raised cap as it stands, and keeps taken_out"

# ── O7: the take-out's exits and its recovery ───────────────────────────────────────────────────────────────────
# o7 <name> [A's extra frontmatter...]: A set aside with a take-out pending at once (auto_retries 0), B its queued
# dependant, C done; the rollout started (A's owner).
o7() {
  local n="$1"; shift
  scen "o7-$n"; mkro
  mkt "$A" in_progress "owner: execute-test" "auto_retries: 0" "$@"
  mkt "$B" open 'depends-on: ["[[proj-p1-1-a]]"]'
  mkt "$C" done
  planblock "$A" "Round 1: the plan misses the migration step"
  FP=$(j "$(inp "$A")" 'd["fingerprint"]')
}
failed_lines() { sec "$RO" '## Notes' | grep -c "take-out failed: \[\[$A\]\]"; }
# (a) a running dependant: the take-out waits, and `moving` never counts the task as W
o7 a
setfm "$B" status in_progress; setfm "$B" owner execute-test
before=$(snap); tko "$A"
ok "$rc|$out|$(snap)" "3|$A: take-out waits: [[$B]] is running [no-change]|$before" "O7a: a running dependant → exit 3, nothing written"
ok "$(j "$(mov)" 'd["work"]["reentry"]')" '[]' "O7a: moving: the task is no W (its running dependant is)"
setfm "$B" status open; setfm "$B" owner ""
ok "$(j "$(mov)" 'd["work"]["reentry"]')" "[\"$A\"]" "O7a: (control) with B queued the take-out is the lead's W"
# (b) crash states, each built from a finished take-out, re-run to completion with nothing twice
o7 b; cp "$D/$A.md" "$TMP/o7b-a.md"; cp "$D/$B.md" "$TMP/o7b-b.md"; cp "$D/$RO.md" "$TMP/o7b-ro.md"
tko "$A"; ok "$rc" 0 "O7b: (the reference take-out)"
cp "$D/$RO.md" "$TMP/o7b-ro-done.md"; cp "$THREAD_EVENTS_DIR/$RO.jsonl" "$TMP/o7b-ev.jsonl"
dropev() { python3 -c 'import json,sys
p, task = sys.argv[1:]
keep = [l for l in open(p) if not (json.loads(l)["kind"] == "take-out" and json.loads(l)["task"] == task)]
open(p, "w").write("".join(keep))' "$THREAD_EVENTS_DIR/$RO.jsonl" "$1"; }
tlines() { sec "$RO" '## Notes' | grep -c ' take-out: '; }
tevs() { evs take-out 'd["task"]' | tr ' ' '\n' | grep -c "$1"; }
#   (i) the rollout note saved, no member yet
cp "$TMP/o7b-a.md" "$D/$A.md"; cp "$TMP/o7b-b.md" "$D/$B.md"; cp "$TMP/o7b-ro-done.md" "$D/$RO.md"; rm -f "$THREAD_EVENTS_DIR/$RO.jsonl"
tko "$A"
ok "$rc|$(tlines)|$(fm "$A" status)|$(fm "$B" status)|$(tevs "$A")|$(tevs "$B")" "0|2|status: open|status: open|1|1" "O7b (i): both taken out, no second Notes line"
#   (ii) the dependant deferred with its event, the task untouched
cp "$TMP/o7b-a.md" "$D/$A.md"; cp "$TMP/o7b-ev.jsonl" "$THREAD_EVENTS_DIR/$RO.jsonl"; dropev "$A"; cp "$TMP/o7b-ro-done.md" "$D/$RO.md"
tko "$A"
ok "$rc|$(tlines)|$(fm "$A" taken_out)|$(tevs "$A")|$(tevs "$B")" "0|2|taken_out: 1|1|1" "O7b (ii): the task finished, the dependant's event not emitted again"
#   (iii) the task's event written, its save not
cp "$TMP/o7b-a.md" "$D/$A.md"; cp "$TMP/o7b-ev.jsonl" "$THREAD_EVENTS_DIR/$RO.jsonl"
tko "$A"
ok "$rc|$(fm "$A" status)|$(fm "$A" taken_out)|$(tevs "$A")" "0|status: open|taken_out: 1|1" "O7b (iii): the task saved, no second event"
#   (iv) all done but the task's event: [no-change], the event written, nothing bumped
dropev "$A"
tko "$A"
ok "$rc|$out|$(fm "$A" taken_out)|$(tevs "$A")|$(tevs "$B")" "0|$A: already taken out of [[$RO]] [no-change]|taken_out: 1|1|1" \
  "O7b (iv): [no-change], the missing event written"
ok "$(evs take-out '[d["task"], d["cause"], d.get("stage"), d.get("overtimeUsed")]' | tr ' ' '\n' | grep "$A")" "[\"$A\",\"no-overtime\",\"plan\",0]" \
  "O7b (iv): its fields read back from the Notes line"
# (c) the task's PR merged into the default branch: exit 4 and one paused line, never a failure (nothing failed, so no
# cool-down and no step toward the bound); `resume`, the lead's work, lands it
o7 c "pr: $PR"
echo MERGED > "$D/gh-state"
tko "$A"
ok "$rc|$(failed_lines)|$(fm "$A" status)" "4|0|status: plan-blocked" "O7c: a merged PR → exit 4, no take-out failed: line, the task untouched"
ok "$(sec "$RO" '## Notes' | grep 'take-out paused')" "- $S_NOW take-out paused: [[$A]] ([[$A]]'s PR merged into main: resume lands it; feedback $FP)" "O7c: one paused line"
TNOW=2026-10-03T09:05:00Z tko "$A"
ok "$rc|$(sec "$RO" '## Notes' | grep -c 'take-out paused')|$(failed_lines)" "4|1|0" "O7c: a re-run before resume: exit 4 again, no second line"
ok "$(j "$(INOW=2026-10-03T09:05:00Z inp "$A")" '[d["takeOut"]["failures"], d["autoRetryAfter"], d["humanFix"]]')" '[0,null,null]' \
  "O7c: the verdict counts no failure and starts no cool-down"
ok "$(j "$(MNOW=2026-10-03T09:05:00Z mov)" '[d["work"]["reentry"], d["work"]["coolDown"]]')" "[[\"$A\"],[]]" \
  "O7c: moving reads it as the lead's work (its resume), never a cool-down"
python3 "$SCRIPT" resume --rollout "$D/$RO.md" --tasks-dir "$D" --gh-bin "$GH" --now "$NOW" >/dev/null 2>&1
ok "$(fm "$A" status)|$(j "$(inp "$A")" 'd["takeOut"]')" "status: done|null" "O7c: resume lands it, and no take-out remains"
# (d) a failing `gh pr close`: each failure one line and a cool-down, the third Lachy's H10; then repair's run finishes it
o7 d "pr: $PR"
echo "pr close" > "$D/gh-fail"
cp "$D/$A.md" "$TMP/o7d-a.md"
tko "$A"
ok "$rc|$(failed_lines)|$(cmp -s "$D/$A.md" "$TMP/o7d-a.md" && echo same)|$(fm "$B" status)" "1|1|same|status: open" \
  "O7d: exit 1, one failure line, the task notes unwritten"
has "$out" "gh pr close $PR failed: gh: HTTP 502: Bad Gateway" "O7d: the ERROR names the close"
TNOW=2026-10-03T09:10:00Z tko "$A"; ok "$rc|$(failed_lines)" "3|1" "O7d: in its cool-down the verb waits (exit 3)"
TNOW=2026-10-03T09:15:00Z tko "$A"; ok "$rc|$(failed_lines)" "1|2" "O7d: the second failure at +15"
ok "$(j "$(INOW=2026-10-03T09:20:00Z inp "$A")" 'd["autoRetryAfter"]')" "2026-10-03T10:15+00:00" "O7d: then a 60-minute cool-down"
TNOW=2026-10-03T10:15:00Z tko "$A"; ok "$rc|$(failed_lines)" "1|3" "O7d: the third failure at +75"
I=$(INOW=2026-10-03T10:20:00Z inp "$A")
ok "$(j "$I" '[d["humanFix"]["act"], d["takeOut"]["failures"], d["autoRetryAfter"]]')" '["hand back or defer",3,null]' "O7d: the third failure is Lachy's H10, takeOut kept"
ok "$(j "$I" 'd["humanFix"]["detail"]')" "take-out failed 3 times (feedback $FP): gh pr close of [[$A]]'s PR failed: gh: HTTP 502: Bad Gateway" "O7d: its detail"
ok "$(j "$(MNOW=2026-10-03T10:20:00Z mov)" '[d["verdict"], d["work"]["reentry"], d["work"]["coolDown"]]')" '["waiting",[],[]]' \
  "O7d: moving drops it from W: his"
rm -f "$D/gh-fail"
TNOW=2026-10-03T10:30:00Z tko "$A"
ok "$rc|$(fm "$A" status)|$(fm "$B" status)|$(fm "$B" rollout)" "0|status: open|status: open|<none>" "O7d: with gh mended, the verb on repair's word finishes it"
# (e) a PR merged into another base: the take-out goes on, with no close
o7 e "pr: $PR"
echo MERGED > "$D/gh-state"; echo release > "$D/gh-base"
tko "$A"
ok "$rc|$(fm "$A" status)|$(grep -c 'pr close' "$D/gh.log")" "0|status: open|0" "O7e: merged into another base → taken out, no close"
# (f) a member's save fails (a read-only dependant): one failure line and the 15-minute cool-down, never a traceback and
# a take-out re-run every turn; mended, a re-run after the cool-down finishes it
o7 f
chmod 0444 "$D/$B.md"
tko "$A"
ok "$rc|$(failed_lines)|$(fm "$A" status)|$(fm "$B" rollout)" "1|1|status: plan-blocked|rollout: \"[[$RO]]\"" \
  "O7f: a dependant's failed save → exit 1, one failure line, neither member deferred"
has "$out" "ERROR: defer --take-out: $B: cannot save its note:" "O7f: the ERROR names the save"
hasnt "$out" "Traceback" "O7f: no traceback"
ok "$(j "$(INOW=2026-10-03T09:05:00Z inp "$A")" '[d["takeOut"]["failures"], d["autoRetryAfter"], d["humanFix"]]')" '[1,"2026-10-03T09:15+00:00",null]' \
  "O7f: the verdict cools the take-out 15 minutes"
chmod 0644 "$D/$B.md"
TNOW=2026-10-03T09:15:00Z tko "$A"
ok "$rc|$(fm "$A" status)|$(fm "$B" rollout)|$(tevs "$B")" "0|status: open|<none>|1" "O7f: mended, the re-run finishes it, the dependant's event once"
# (w) a member awaiting Integration or held by an undecided RACE is finished first: exit 3, nothing written
for w in "awaiting-integration" "held by an undecided RACE"; do
  o7 w
  if [ "$w" = awaiting-integration ]; then setfm "$B" status review; setfm "$B" pr "https://github.com/o/r/pull/6"
  else printf '\n## Race log\n\n- 2026-10-03T08:30+00:00 [[%s]] RACE: PR #6 merged as %s\n' "$B" "$(printf '%040d' 6)" >> "$D/$RO.md"; fi
  before=$(snap); tko "$A"
  ok "$rc|$out|$(snap)" "3|$A: take-out waits: [[$B]] is $w [no-change]|$before" "O7w: a member $w → exit 3, nothing written"
done

# ── O10: the closure, leaves first: a chain C → B → A, X through a tombstone folded into A, and H, whose only entry on
# A is a Speed fix hold's, left out; B's own OPEN PR closed naming A, and the cap its own Overtime raised restored ──────
o7 o10 "pr: $PR"
B_PR=https://github.com/o/r/pull/6
mkt "$B" open 'depends-on: ["[[proj-p1-1-a]]"]' "pr: $B_PR" "max_review_rounds: 6" "auto_retry_raised: max_review_rounds=4"
mkt "$C" open 'depends-on: ["[[proj-p1-2-b]]"]'
mkt "$T" merged 'merged_into: "[[proj-p1-1-a]]"'
mkt "$X" open 'depends-on: ["[[proj-p1-6-t]]"]'
mkt "$H" open 'depends-on: ["[[proj-p1-1-a]]"]'
printf '\n## Speed fix holds\n\n- 2026-10-03T07:00+00:00 hold [[%s]] (p1, schedule): [[%s]]\n' "$A" "$H" >> "$D/$RO.md"
tko "$A"
ok "$rc|$(printf '%s\n' "$out" | grep 'deferred->open' | cut -d: -f1 | tr '\n' ' ')" "0|$C $X $B $A " \
  "O10: exit 0, deferred leaves first: C before B (it depends on B), X, then the task last"
W=$(evs take-out 'd["task"] + ":" + str(d.get("with"))' | tr -d '"' | tr ' ' '\n')
# each row: member | its rollout: after | the `with` on its take-out event (none: no event) | its Notes lines naming A
for r in "$C|<none>|$A|1" "$X|<none>|$A|1" "$B|<none>|$A|1" "$H|rollout: \"[[$RO]]\"|none|0" "$T|rollout: \"[[$RO]]\"|none|0"; do
  IFS='|' read -r m ro_ with_ line_ <<<"$r"
  ok "$(fm "$m" rollout)|$(printf '%s\n' "$W" | grep "^$m:" | cut -d: -f2 | grep . || echo none)|$(sec "$RO" '## Notes' | grep -c "take-out: \[\[$m\]\] with \[\[$A\]\]")" \
    "$ro_|$with_|$line_" "O10 $m: its rollout:, its take-out event's with, its Notes line"
done
ok "$(evs take-out 'd["task"]' | tr -d '"')" "$C $X $B $A" "O10: the events, leaves first"
ok "$(grep -c "pr close $B_PR --delete-branch --comment taken out of \[\[$RO\]\] with \[\[$A\]\] (ADR 0070): back to the backlog" "$D/gh.log")|$(grep -c "pr close $PR --delete-branch --comment taken out of \[\[$RO\]\] (ADR 0070)" "$D/gh.log")" \
  "1|1" "O10: B's OPEN PR closed naming the task, the task's own without"
ok "$(fm "$B" max_review_rounds)|$(fm "$B" auto_retry_raised)" "max_review_rounds: 4|<none>" "O10: B's raised cap restored and its marker cleared"

# ── O11: across versions (engine-snapshot.md § Cross-version state): `moving` and needs-you run from any root, so on a
# rollout whose engine predates p39-14 (no TAKE_OUT_ENGINE line) a spent budget is that engine's H9 or H10, Lachy's ──
OLDROOT="$TMP/snaps/old"; mkdir -p "$OLDROOT/skills/execute/scripts"
printf 'print("an engine before p39-14")\n' > "$OLDROOT/skills/execute/scripts/reconcile-rollout.py"
ok "$(grep -c '^TAKE_OUT_ENGINE = 1$' "$SCRIPT")" 1 "O11: this tree carries the marker line once"
nyacts() { python3 "$UR" needs-you --tasks-dir "$D" --now "$NOW" --gh-bin "$GH" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.dumps([i["act"] for i in json.load(sys.stdin)["items"] if i["task"] == sys.argv[1]]))' "$A"; }
# each row: the block's kind (a take-out: auto_retries 0; an Overtime run: the normal budget spent) | the engine root |
# moving's reentry | needs-you's acts for A
for r in "take-out|new|[\"$A\"]|[]" "take-out|old|[]|[\"hand back or defer\"]" \
         "overtime|new|[\"$A\"]|[]" "overtime|old|[]|[\"hand back or defer\"]"; do
  IFS='|' read -r kind eng re_ acts_ <<<"$r"
  root_=$([ "$eng" = new ] && echo "$NEWROOT" || echo "$OLDROOT")
  scen "o11-$kind-$eng"; mkro
  mkt "$A" in_progress "owner: execute-test" "$([ "$kind" = take-out ] && echo 'auto_retries: 0' || echo 'auto_retries_used: 2')"
  mkt "$B" open 'depends-on: ["[[proj-p1-1-a]]"]'; mkt "$C" done
  planblock "$A" "Round 1: the plan misses the migration step"
  ok "$(j "$(inp "$A")" '"take-out" if d["takeOut"] else "overtime" if d["overtime"] else None')" "$kind" "O11 $kind: (the lead's own read: the $kind)"
  setfm "$RO" engine_snapshot "\"$root_\""
  ok "$(j "$(mov)" 'd["work"]["reentry"]')|$(nyacts)" "$re_|$acts_" "O11 $kind on the $eng engine: moving's W and needs-you's items"
done

# ── O8: plan rounds raise max_plan_rounds ──────────────────────────────────────────────────────────────────────
scen o8
mkro "max_plan_rounds: 2"; mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2"; mkt "$B" open
planblock "$A" "plan round budget exhausted after 2 rounds: the judge still wants the rollback"
ok "$(j "$(inp "$A")" 'd["overtime"]["raise"]')" '{"field":"max_plan_rounds","to":3}' "O8: a spent plan budget raises max_plan_rounds to resolved + 1"
# O9: the --max-review-rounds overlay mismatch clears overtime (and takeOut, O2)
ok "$(j "$(inp "$A" --max-review-rounds 9)" '[d["autoRetry"], d["overtime"], d["takeOut"]]')" '[false,null,null]' "O9: an overlay mismatch clears overtime"
ar "$A"
ok "$(fm "$A" max_plan_rounds)|$(fm "$A" auto_retry_raised)" "max_plan_rounds: 3|auto_retry_raised: max_plan_rounds=-" "O8: written on the task, its absence recorded"
has "$(sec "$RO" '## Notes')" "max_plan_rounds raised to 3, one round" "O8: the Notes line names it"


echo
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
