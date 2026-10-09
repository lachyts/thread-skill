#!/usr/bin/env bash
# p16-4 (ADR 0033): execute's lead re-enters agent-fixable set-asides by itself. One decision function,
# lead-integrate.py auto_retry_verdict, which `inputs` prints to every caller (autoRetry, autoRetryWhy,
# autoRetryError, autoRetryClass, autoRetryBudget, the counters, fingerprint, autoRetryRaise, autoRetryAfter), and
# one writing verb, reconcile-rollout.py auto-retry, which re-runs the verdict before it writes: the rollout's
# `## Notes` line, the task note (hand-back's own transition, the markers, the raise) and the Run record events.
#   A1  a first and second plan-block retried, a third stopped by the budget   A2 an identical fingerprint stops
#   A3  a `## Needs you` question never retries   A4 every excluded kind   A5 merge-task's fixable exit-1 texts
#   A6  the budget: task, rollout, rollouts.toml and built-in; invalid stamps; a refused file; the assertions
#   A7  the records (the brief untouched, repair's raise regex, a re-run, a partial write)   A8 the raise
#   A9  an Integration set-aside   A10 infra blocks   A11 quota blocks and their cool-down   A12 the budget lifetime
#   A13 the queue   A14 the Run record   A15 the pins (merge-task.sh, lead-integrate.py, execute SKILL.md)
# The blocks are built through the real `reconcile` (and `lead-integrate.py set-aside` for the lead's own rows).
# Hermetic: HOME is an empty dir of its own (rollout-settings.py reads ~/.config/thread/rollouts.toml), each
# scenario's Project root is a temp dir, and this suite reads the Run record, so it keeps its own
# THREAD_EVENTS_DIR per scenario and ignores THREAD_TEST_EVENTS_DIR. Temp notes only; no vault, no network.
# Usage: bash reconcile-rollout-auto-retry.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOTDIR="$(cd "$HERE/../../.." && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
MT="$HERE/../scripts/merge-task.sh"
SKILL="$HERE/../SKILL.md"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR XDG_STATE_HOME
export THREAD_EVENTS_DIR="$TMP/events"   # the Run record (run_record.py, ADR 0032); each scenario points it at its own dir
NOW=2026-10-03T09:00:00Z
PR=https://github.com/o/r/pull/5
REVISE='revise: rejected at Integration re-review — revise on the branch, then re-integrate'
TRANSIENT='transient infrastructure failure — the agent process died mid-run on a terminal API/connection error'
A40=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; B40=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; C40=cccccccccccccccccccccccccccccccccccccccc

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

A=proj-p1-1-a
B=proj-p1-2-b
RO=proj-rollout-2026-10-03
FA='Round 1: the plan misses the migration step'
FB='Round 1: the plan still misses the rollback path'
FC='Round 1: the plan names no test for the rollback'

D=""
scen() {
  D="$TMP/$1"; mkdir -p "$D/root"; echo "== $1"
  export THREAD_EVENTS_DIR="$D/events"
  rm -rf "$HOME/.config"
}
# mkro [frontmatter lines...] — the rollout note: Project root $D/root, a queue, an empty ## Notes section
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nprojects:\n  - "[[Proj]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s/root`\n\n## Queue\n\n- [[%s]]\n- [[%s]]\n' "$D" "$A" "$B"; } > "$D/$RO.md"
}
# mkt <slug> <status> [frontmatter lines...] — a task note linked to the rollout, with a brief
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[%s]]"\n' "$st" "$RO"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n**Do.**\n\n- add the migration\n- consider a rollback path\n'; } > "$D/$s.md"
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
setfm() {  # setfm <slug> <key> <value>: replace or add a frontmatter line
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
body() { python3 -c 'import sys; print(open(sys.argv[1]).read().split("\n---\n", 1)[1], end="")' "$D/$1.md"; }
sec() { awk -v h="$2" '$0==h{on=1; next} on && /^## /{exit} on{print}' "$D/$1.md"; }
# row <slug> <status> <blockerDiagnosis> [extra json object merged in]
row() {
  python3 -c 'import json,sys
s, st, d = sys.argv[1:4]
r = {"slug": s, "scope": "cross-cutting", "status": st, "prUrl": "", "blockerDiagnosis": d}
if len(sys.argv) > 4: r.update(json.loads(sys.argv[4]))
print(json.dumps({"rolloutSlug": "ro", "tasks": [r]}))' "$@"
}
rec() { python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${2:-2026-10-03T08:00:00Z}" <<<"$1" >/dev/null; }
# lead <slug> <kind> <reason> [now]: the lead's own set-aside row (lead-integrate.py set-aside), reconciled
lead() { printf '%s' "$3" | python3 "$LI" set-aside --note "$D/$1.md" --kind "$2" | python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${4:-2026-10-03T08:00:00Z}" >/dev/null; }
inp() { python3 "$LI" inputs --note "$D/$1.md" --now "${INOW:-$NOW}" "${@:2}"; }
ar() { out=$(python3 "$SCRIPT" auto-retry --tasks "$1" --rollout "$D/$RO.md" --tasks-dir "$D" --now "${ANOW:-$NOW}" "${@:2}" 2>&1); rc=$?; }
ms() { python3 "$SCRIPT" mark-started --tasks "$1" --tasks-dir "$D" --now "${2:-$NOW}" >/dev/null 2>&1; }
nxt() { python3 "$SCRIPT" next --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" --running "$1" --dry-run 2>/dev/null; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), sort_keys=True))' "$2"; }
snap() { (cd "$D" && find . -path ./events -prune -o -type f -print | LC_ALL=C sort | while read -r f; do printf '%s\n' "$f"; cat "$f"; done) | shasum | cut -c1-40; }
sha12() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])' "$1"; }
# The Run record: cnt = its line count; since <n> [expr] = each later line as kind:task (or expr over d)
cnt() { [ -f "$THREAD_EVENTS_DIR/$RO.jsonl" ] && wc -l < "$THREAD_EVENTS_DIR/$RO.jsonl" | tr -d ' ' || echo 0; }
since() {
  [ -f "$THREAD_EVENTS_DIR/$RO.jsonl" ] || { echo ""; return; }
  tail -n +"$(( $1 + 1 ))" "$THREAD_EVENTS_DIR/$RO.jsonl" | python3 -c 'import json,sys
e = sys.argv[1] if len(sys.argv) > 1 else None
out = []
for l in sys.stdin:
    d = json.loads(l)
    out.append(json.dumps(eval(e), separators=(",", ":"), sort_keys=True) if e else "%s:%s" % (d["kind"], d.get("task") or "-"))
print(" ".join(out))' "${@:2}"
}
lastev() { python3 -c 'import json,sys
for l in reversed(open(sys.argv[1]).read().splitlines()):
    d = json.loads(l)
    if d["kind"] == sys.argv[2]:
        print(json.dumps(eval(sys.argv[3]), separators=(",", ":"), sort_keys=True)); break' "$THREAD_EVENTS_DIR/$RO.jsonl" "$1" "$2"; }
notes_lines() { sec "$RO" '## Notes' | grep -c "auto-retry: \[\[$1\]\]"; }
# planblock <slug> <feedback> [now]: a running task (in_progress, owner) plan-blocks through the real reconcile
planblock() { setfm "$1" status in_progress; setfm "$1" owner execute-test; rec "$(row "$1" plan-blocked "$2")" "${3:-2026-10-03T08:00:00Z}"; }
SHA_A=$(sha12 "$FA"); SHA_B=$(sha12 "$FB"); SHA_C=$(sha12 "$FC")
S_NOW="2026-10-03T09:00+00:00"   # NOW as _stamp writes it: an auto-retry line's stamp and its auto_retry_at

# ── A1: a first and second plan-block retried automatically; the third stops (the spec's queue test) ────────────
scen a1
mkro
mkt "$A" in_progress "owner: execute-test"
mkt "$B" open
planblock "$A" "$FA"
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryWhy"], d["autoRetryError"], d["autoRetryClass"], d["autoRetriesUsed"], d["quotaRetriesUsed"]]')" \
  '[true,"",null,"agent",0,0]' "A1: inputs → autoRetry true, class agent, used 0"
ok "$(j "$I" 'd["autoRetryBudget"]')" '{"autoRetries":{"source":"built-in","value":2},"maxReviewRounds":{"source":"built-in","value":4}}' \
  "A1: the budget resolves to the built-ins (2, and 4 rounds)"
ok "$(j "$I" 'd["fingerprint"]')" "$SHA_A" "A1: the fingerprint is the Plan-blocked run-1 marker sha"
ok "$(grep -c "<!-- run 1 end sha=$SHA_A -->" "$D/$A.md")" 1 "A1: (the marker carries that sha)"
ok "$(j "$I" '[d["autoRetryRaise"], d["autoRetryAfter"]]')" '[null,null]' "A1: no raise, no cool-down"
M=$(cnt)
ar "$A" --auto-retries 2 --fingerprint "$SHA_A"
ok "$rc" 0 "A1: auto-retry exits 0"
ok "$out" "$A: auto-retry 1/2 (plan; feedback $SHA_A) plan-blocked->in_progress [written]" "A1: one stdout line"
ok "$(fm "$A" status)|$(fm "$A" owner)|$(fm "$A" handed_back)" "status: in_progress|<none>|handed_back: 2026-10-03T09:00+00:00" \
  "A1: hand-back's own transition (in_progress, owner: cleared, handed_back:)"
ok "$(fm "$A" auto_retries_used)|$(fm "$A" auto_retry_sha)|$(fm "$A" auto_retry_at)|$(fm "$A" quota_retries_used)" \
  "auto_retries_used: 1|auto_retry_sha: $SHA_A|auto_retry_at: 2026-10-03T09:00+00:00|<none>" "A1: used 1, sha A, auto_retry_at; no quota counter"
ok "$(sec "$RO" '## Notes' | grep 'auto-retry:')" "- $S_NOW auto-retry: [[$A]] 1/2 (plan; feedback $SHA_A)" "A1: one rollout ## Notes line, in the exact format (stamped with its auto_retry_at)"
ok "$(since "$M")" "auto-retry:$A" "A1: one auto-retry event"
ok "$(lastev auto-retry '[d["stage"], d["setAsideAt"], d["retryClass"], d["used"], d["budget"], d["fingerprint"]]')" \
  "[\"plan\",\"run\",\"agent\",1,2,\"$SHA_A\"]" "A1: its fields"
NX=$(nxt "")
ok "$(j "$NX" '[d["restart"], d["halt"]]')" "[[\"$A\"],null]" "A1: next --running \"\" restarts it; no halt"
# the second block: B → retry 2
ms "$A"
planblock "$A" "$FB" 2026-10-03T09:10:00Z
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetriesUsed"], d["fingerprint"]]')" "[true,1,\"$SHA_B\"]" "A1 re-block B: autoRetry true, used 1, fingerprint B"
ar "$A" --auto-retries 2 --fingerprint "$SHA_B"
ok "$rc|$out" "0|$A: auto-retry 2/2 (plan; feedback $SHA_B) plan-blocked->in_progress [written]" "A1 re-block B: retry 2/2"
ok "$(fm "$A" auto_retries_used)|$(fm "$A" auto_retry_sha)" "auto_retries_used: 2|auto_retry_sha: $SHA_B" "A1: used 2, sha B"
ok "$(notes_lines "$A")" 2 "A1: two Notes lines"
# the third block: C → stopped by the budget, and the verb writes nothing
ms "$A"
planblock "$A" "$FC" 2026-10-03T09:20:00Z
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryWhy"], d["autoRetriesUsed"]]')" '[false,"budget: 2/2 used",2]' "A1 re-block C: autoRetry false, budget: 2/2 used"
before=$(snap); M=$(cnt)
ar "$A" --auto-retries 2 --fingerprint "$SHA_C"
ok "$rc" 1 "A1 third: the verb exits 1"
has "$out" "ERROR: auto-retry: $A: not auto-retryable: budget: 2/2 used; nothing written" "A1 third: one ERROR line"
ok "$(snap)" "$before" "A1 third: both notes byte-identical"
ok "$(since "$M")" "" "A1 third: nothing recorded"
setfm "$B" status done
NX=$(nxt "")
ok "$(j "$NX" '[d["halt"], [e["slug"] for e in d["setAside"]]]')" "[\"stuck\",[\"$A\"]]" "A1: every set-aside exhausted (and nothing else to start) → halt stuck"

# ── A2: an identical fingerprint stops at once ─────────────────────────────────────────────────────────────
scen a2
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
ar "$A"
ok "$rc" 0 "A2: the first retry (no assertions passed) exits 0"
ms "$A"
planblock "$A" "$FA" 2026-10-03T09:10:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")" 1 "A2: reconcile wrote no new run for the identical feedback"
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryWhy"], d["fingerprint"], d["autoRetriesUsed"]]')" \
  "[false,\"same feedback as the block last re-entered\",\"$SHA_A\",1]" "A2: autoRetry false at once, with budget left"
before=$(snap)
ar "$A"
ok "$rc|$(snap)" "1|$before" "A2: the verb exits 1 and writes nothing"
has "$out" "same feedback as the block last re-entered" "A2: the ERROR names why"

# ── A3: a `## Needs you` question never retries, with budget left ───────────────────────────────────────────
scen a3
mkro; mkt "$A" open; mkt "$B" open
ASK='{"needsHuman":"Which API key?"}'
ASK_RB="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"feedback\":[\"x\"]}],\"needsHuman\":\"Which API key?\"}"
for st in plan-blocked blocked review-blocked; do
  mkt "$A" in_progress "owner: execute-test" "pr: $PR"
  extra=$ASK; [ "$st" = review-blocked ] && extra=$ASK_RB
  rec "$(row "$A" "$st" "the feedback" "$extra")"
  I=$(inp "$A")
  ok "$(j "$I" '[d["status"], d["autoRetry"], d["autoRetryWhy"], d["autoRetriesUsed"]]')" \
    "[\"$st\",false,\"needs a human: the note's ## Needs you question\",0]" "A3 $st: needsHuman → false, budget untouched"
  before=$(snap); ar "$A"
  ok "$rc|$(snap)" "1|$before" "A3 $st: the verb exits 1, nothing written"
done

# ── A4: each excluded kind never retries, and the verb writes nothing ──────────────────────────────────────
# excluded <label> <expected why fragment> [expected verb exit]
excluded() {
  local I; I=$(inp "$A")
  ok "$(j "$I" 'd["autoRetry"]')" false "A4 $1: autoRetry false"
  has "$(j "$I" 'd["autoRetryWhy"]')" "$2" "A4 $1: why names it"
  before=$(snap); M=$(cnt)
  ar "$A"
  ok "$rc|$(snap)|$(since "$M")" "${3:-1}|$before|" "A4 $1: the verb exits ${3:-1}, writes and records nothing"
}
scen a4-gate
mkro; mkt "$A" in_progress "owner: execute-test"; mkt "$B" open
GATED='{"gatedInputs":["spend: Replicate — cap USD 5"]}'
rec "$(row "$A" gate-pending "" "$GATED")"
excluded gate-pending "gate-pending: sign-off is the human's"

scen a4-race
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
printf '\n## Race log\n\n- 2026-10-03T08:30+00:00 [[%s]] RACE: PR #5 merged as x\n' "$A" >> "$D/$RO.md"
excluded RACE "RACE undecided" 2
has "$out" "ERROR: auto-retry: [[$A]] RACE undecided: no \"repair: [[$A]] RACE decided:\" line on $RO" "A4 RACE: hand-back's ERROR line, for auto-retry"

scen a4-unverified
mkro; mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
lead "$A" integration "UNVERIFIED: PR #5 merged as abc; not verifiable yet; re-run to verify"
excluded UNVERIFIED "UNVERIFIED undecided" 2

scen a4-branch-gone
mkro; mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
lead "$A" integration "origin/audit-fix/p1-1-a does not exist — the PR branch is gone"
excluded "branch gone" "the PR branch is gone"

# merge-task's exit-1 texts that need a human (each pinned against merge-task.sh in A15)
HUMAN_TEXTS=(
  "ERROR: PR #5 is 'CLOSED' (not OPEN/MERGED) — nothing was merged. Resolve manually."
  "ERROR: PR #5's head branch audit-fix/p1-1-a is not on origin (PR head $A40): merge-task merges only a same-repo head"
  "ERROR: PR #5 targets 'release', not the default branch 'main' — nothing was merged."
  "ERROR: merge queue required on main: merge-task cannot pin the base — nothing was merged."
  "ERROR: PR #5 is BLOCKED but required checks are already green — a NON-check gate is in the way"
  "ERROR: GitHub refused to merge PR #5: Repository rule violations found — nothing was merged."
  "ERROR: gh reported success but PR #5 is not confirmed merged (queued or auto-merge?); auto-merge disable ok"
  "ERROR: PR #5 stays BEHIND although origin/main is still the integrated base $B40 — nothing was merged."
  "ERROR: PR #5 unexpected mergeStateStatus='DRAFT' — nothing was merged."
)
i=0
for text in "${HUMAN_TEXTS[@]}"; do
  i=$((i+1)); scen "a4-merge-task-$i"
  mkro; mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
  lead "$A" own "merge-task: $text"
  excluded "merge-task text $i" "merge-task needs a human: merge-task: $text"
done

scen a4-declined
mkro; mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
lead "$A" integration "merge declined at the --gated hold"
excluded declined "merge declined at the --gated hold"

scen a4-review-no-pr
mkro; mkt "$A" review "review_rounds_used: 1"; mkt "$B" open
excluded "review with no pr:" "approved without a PR"

scen a4-integration-no-pr
mkro; mkt "$A" in_progress "owner: execute-test"; mkt "$B" open
rec "$(row "$A" blocked 'integration: base moved before the merge 4 times in a row')"
ok "$(j "$(nxt "")" '[e["setAsideAt"] for e in d["setAside"]]')" '["integration"]' "A4: (set aside at Integration)"
excluded "Integration with no pr:" "set aside at Integration with no pr:"

scen a4-autorevise
mkro; mkt "$A" review "pr: $PR" "ready: 2026-10-03T06:00+00:00" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
DIAG="$REVISE

Round 1 (Integration) rejection:
- the merge dropped the retry guard"
EXTRA="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"stage\":\"integration\",\"feedback\":[\"the merge dropped the retry guard\"]}],\"integration\":{\"outcome\":\"rejected\",\"path\":\"judge-only\",\"headSha\":\"$B40\",\"baseSha\":\"$C40\",\"anchor\":{\"headSha\":\"$A40\"},\"metrics\":{\"startedAt\":\"2026-10-03T07:00:00Z\"}}}"
rec "$(row "$A" blocked "$DIAG" "$EXTRA")"
ok "$(j "$(inp "$A" --max-review-rounds 4)" 'd["autoRevise"]')" true "A4: (inputs --max-review-rounds 4 → autoRevise true)"
excluded "autoRevise true" "autoRevise: step 1.2's seeded revise owns it"

scen a4-descoped
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
printf '\n## Scope decision (automatic)\n\n- descoped (automatic) 2026-10-03T07:00+00:00, Plan-blocked feedback run 1: "x" is optional in the brief\n<!-- descope run=1 part=%s mode=optional -->\n' "$(sha12 x)" >> "$D/$A.md"
excluded "plan-blocked after a descope" "plan-blocked again after an automatic descope"
setfm "$A" descope_armed 2026-10-03T07:00+00:00
ok "$(j "$(inp "$A")" 'd["autoRetry"]')" true "A4 control: with descope_armed: standing (the descope's own hand-back pending) it is retryable"

scen a4-zero
mkro; mkt "$A" open "auto_retries: 0"; mkt "$B" open
planblock "$A" "$FA"
excluded "auto_retries: 0" "auto_retries is 0"

# ── A5: merge-task's fixable exit-1 texts retry, at the task's own run ──────────────────────────────────────
i=0
for text in "ERROR: PR #5 has a MERGE CONFLICT with main (mergeStateStatus=DIRTY) on the integrated base — nothing was merged." \
            "ERROR: a REQUIRED check FAILED on PR #5 (Ralph passed locally, but remote CI is red):"; do
  i=$((i+1)); scen "a5-$i"
  mkro; mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
  lead "$A" own "merge-task: $text"
  I=$(inp "$A")
  ok "$(j "$I" '[d["autoRetry"], d["autoRetryClass"]]')" '[true,"agent"]' "A5 ${text:10:20}: autoRetry true"
  ar "$A"
  ok "$rc|$(fm "$A" status)" "0|status: in_progress" "A5 ${text:10:20}: its own run (in_progress)"
  has "$out" "(integrate; feedback " "A5: the stage is integrate (merge-task's exit 1, ADR 0032's table)"
  ok "$(lastev auto-retry '[d["stage"], d["setAsideAt"]]')" '["integrate","run"]' "A5: stage integrate, setAsideAt run"
done

# ── A6: the budget ───────────────────────────────────────────────────────────────────────────────────────
scen a6-task-zero
mkro; mkt "$A" open "auto_retries: 0"; mkt "$B" open
planblock "$A" "$FA"
before=$(snap)
ar "$A" --auto-retries 2
ok "$rc|$(snap)" "1|$before" "A6: task auto_retries: 0 with --auto-retries 2 → exit 1, both notes byte-identical"
has "$out" "the note changed since \`inputs\`" "A6: the mismatch names the note change"
ar "$A"
ok "$rc|$(snap)" "1|$before" "A6: the same without the flag → exit 1, nothing written"
has "$out" "auto_retries is 0" "A6: why"

scen a6-rollout
mkro "auto_retries: 1"; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
ok "$(j "$(inp "$A")" 'd["autoRetryBudget"]["autoRetries"]')" '{"source":"rollout","value":1}' "A6: a rollout-level auto_retries: 1 → source rollout"
setfm "$A" auto_retries 3
ok "$(j "$(inp "$A")" 'd["autoRetryBudget"]["autoRetries"]')" '{"source":"task","value":3}' "A6: the task's stamp wins over the rollout's"

scen a6-toml
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
mkdir -p "$HOME/.config/thread"
printf '[defaults]\nauto_retries = 3\nmax_review_rounds = 5\n' > "$HOME/.config/thread/rollouts.toml"
ok "$(j "$(inp "$A")" 'd["autoRetryBudget"]')" '{"autoRetries":{"source":"file:defaults","value":3},"maxReviewRounds":{"source":"file:defaults","value":5}}' \
  "A6: rollouts.toml [defaults] → file:defaults"
git init -q "$D/root" && git -C "$D/root" remote add origin https://github.com/o/r
printf '[defaults]\nauto_retries = 3\n[repo."o/r"]\nauto_retries = 1\n' > "$HOME/.config/thread/rollouts.toml"
ok "$(j "$(inp "$A")" 'd["autoRetryBudget"]["autoRetries"]')" '{"source":"file:repo","value":1}' "A6: a repo table for the Project root's origin → file:repo"
# run.sh's refused file: no retry, no halt, and inputs still exits 0 (status-repair's must() relies on it)
printf '[defaults]\nparallel_ceiling = 0\n' > "$HOME/.config/thread/rollouts.toml"
I=$(inp "$A"); irc=$?
ok "$irc|$(j "$I" '[d["autoRetry"], d["autoRetryError"], d["autoRetryBudget"]]')" '0|[false,null,null]' "A6: a refused rollouts.toml → exit 0, autoRetry false, no autoRetryError"
has "$(j "$I" 'd["autoRetryWhy"]')" "auto_retries unresolved: " "A6: why: unresolved, in the resolver's words"
before=$(snap); ar "$A"
ok "$rc|$(snap)" "1|$before" "A6: the verb exits 1, nothing written"
setfm "$A" auto_retries 2; setfm "$A" max_review_rounds 4
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetryBudget"]["autoRetries"]["source"]]')" '[true,"task"]' "A6: both keys stamped → the file is never read"
rm -rf "$HOME/.config"

scen a6-root-gone
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
mkdir -p "$HOME/.config/thread"; printf '[repo."o/r"]\nauto_retries = 1\n' > "$HOME/.config/thread/rollouts.toml"
rm -rf "$D/root"
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryError"]]')" '[false,null]' "A6: a Project root that is gone → no retry and no halt"
has "$(j "$I" 'd["autoRetryWhy"]')" "not a directory" "A6: why names the root"
rm -rf "$HOME/.config"

for stamp in '-1' '1.5' 'true' '"2"' ''; do
  scen "a6-invalid-$(sha12 "x$stamp")"
  mkro; mkt "$A" open "auto_retries: $stamp"; mkt "$B" open
  planblock "$A" "$FA"
  I=$(inp "$A")
  ok "$(j "$I" '[d["autoRetry"], d["autoRetryError"] is not None]')" '[false,true]' "A6: auto_retries: [$stamp] → autoRetryError"
  has "$(j "$I" 'd["autoRetryError"]')" "auto_retries on [[$A]] must be an integer >= 0" "A6: [$stamp]: the error names the field and the note"
  before=$(snap); ar "$A"
  ok "$rc|$(snap)" "1|$before" "A6: [$stamp]: the verb exits 1, nothing written"
  has "$out" "invalid round budget: auto_retries on [[$A]]" "A6: [$stamp]: the ERROR names the round budget"
done
scen a6-invalid-rounds
mkro "max_review_rounds: 0"; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
has "$(j "$(inp "$A")" 'd["autoRetryError"]')" "max_review_rounds on [[$RO]] must be an integer >= 1, got '0'" "A6: a rollout max_review_rounds: 0 names the rollout"

scen a6-assert
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
before=$(snap)
ar "$A" --fingerprint 0123456789ab
ok "$rc|$(snap)" "1|$before" "A6: a --fingerprint mismatch → exit 1, nothing written"
has "$out" "is not the block's $SHA_A: the note changed since \`inputs\`" "A6: the mismatch names the block's sha"
ar "$A" --fingerprint nothex
ok "$rc|$(snap)" "2|$before" "A6: a malformed --fingerprint is usage (exit 2)"
I=$(inp "$A" --max-review-rounds 3)
ok "$(j "$I" '[d["autoRetry"], d["autoRetryWhy"]]')" '[false,"--max-review-rounds 3 is not the resolved max_review_rounds 4"]' \
  "A6: a --max-review-rounds that disagrees with the resolution → false"
ok "$(j "$(inp "$A" --max-review-rounds 4)" 'd["autoRetry"]')" true "A6: an agreeing --max-review-rounds → true"

# ── A7: the records ─────────────────────────────────────────────────────────────────────────────────────────
items() { python3 - "$SCRIPT" "$D/$1.md" <<'PY'
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
_lines, items, fenced = m._brief_items(m.Note(Path(sys.argv[2])))
print(json.dumps([i[3] for i in items] + fenced))
PY
}
scen a7
mkro; mkt "$A" open "max_review_rounds: 3"; mkt "$B" open
planblock "$A" "$FA"
b0=$(body "$A"); i0=$(items "$A")
ar "$A"
ok "$rc" 0 "A7: retried"
ok "$(body "$A")" "$b0" "A7: the task note's body is byte-identical (the line goes to the rollout, never the brief)"
ok "$(items "$A")" "$i0" "A7: descope's _brief_items are unchanged"
before=$(snap)
ar "$A"
ok "$rc|$(snap)" "1|$before" "A7: a re-run after success exits 1 and writes nothing"
has "$out" "not auto-retryable: not set aside (running)" "A7: (it is running now)"
# a partial write: the task note unwritable → exit 1 with the Notes line written; the re-run writes one line, then the note
ms "$A"; planblock "$A" "$FB" 2026-10-03T09:10:00Z
chmod 0444 "$D/$A.md"
ANOW=2026-10-03T09:15:00Z ar "$A"
ok "$rc|$(notes_lines "$A")|$(fm "$A" status)|$(fm "$A" auto_retry_at)" "1|2|status: plan-blocked|auto_retry_at: $S_NOW" \
  "A7 partial: exit 1, the Notes line written, the task note not (its auto_retry_at is still the first retry's)"
has "$out" "a re-run finishes the records" "A7 partial: the ERROR says a re-run finishes it"
chmod 0644 "$D/$A.md"
ANOW=2026-10-03T09:16:00Z ar "$A"
ok "$rc|$(notes_lines "$A")|$(fm "$A" status)|$(fm "$A" auto_retries_used)|$(fm "$A" auto_retry_at)" \
  "0|2|status: in_progress|auto_retries_used: 2|auto_retry_at: 2026-10-03T09:16+00:00" \
  "A7 partial: the re-run leaves one line for the retry (stamped after the note's auto_retry_at) and writes the task note"
ok "$(sec "$RO" '## Notes' | grep 'auto-retry:' | tail -1)" "- 2026-10-03T09:15+00:00 auto-retry: [[$A]] 2/2 (plan; feedback $SHA_B)" \
  "A7 partial: the line is the first attempt's, kept"
# --dry-run writes and records nothing
ms "$A"; planblock "$A" "$FC" 2026-10-03T09:20:00Z
setfm "$A" auto_retries 3
before=$(snap); M=$(cnt)
ar "$A" --dry-run
ok "$rc|$(snap)|$(since "$M")" "0|$before|" "A7: --dry-run exits 0, writes and records nothing"
has "$out" "$A: auto-retry 3/3 (plan; feedback $SHA_C) plan-blocked->in_progress (dry-run)" "A7: --dry-run prints the outcome"
# a hand-back resets the counters, so a later genuine retry can read exactly like an earlier one but for its stamp
# (the same n/N, stage and feedback): it is a new line, one per retry, never taken for an unfinished write
scen a7-hand-back
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
ar "$A"
ok "$rc|$(notes_lines "$A")" "0|1" "A7 hand-back: the first retry (1/2, feedback A)"
ms "$A" 2026-10-03T09:01:00Z; setfm "$A" owner execute-test
rec "$(row "$A" plan-blocked "$FB" '{"needsHuman":"Which migration tool?"}')" 2026-10-03T09:10:00Z
has "$(j "$(INOW=2026-10-03T09:10:00Z inp "$A")" 'd["autoRetryWhy"]')" "needs a human" "A7 hand-back: (the second block asks a human)"
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now 2026-10-03T09:20:00Z >/dev/null 2>&1
ok "$(fm "$A" auto_retries_used)|$(fm "$A" auto_retry_at)" "<none>|auto_retry_at: $S_NOW" "A7 hand-back: (the counters cleared, auto_retry_at kept)"
ms "$A" 2026-10-03T09:21:00Z; setfm "$A" owner execute-test
rec "$(row "$A" plan-blocked "$FA" '{"needsHuman":""}')" 2026-10-03T09:30:00Z
I=$(INOW=2026-10-03T09:30:00Z inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetriesUsed"], d["fingerprint"]]')" "[true,0,\"$SHA_A\"]" "A7 hand-back: feedback A again, on the fresh budget"
M=$(cnt)
ANOW=2026-10-03T09:30:00Z ar "$A"
ok "$rc|$out" "0|$A: auto-retry 1/2 (plan; feedback $SHA_A) plan-blocked->in_progress [written]" \
  "A7 hand-back: the same count, stage and feedback as the first retry"
ok "$(notes_lines "$A")" 2 "A7 hand-back: a second Notes line (one per retry, so the Auto-retried row and the Completion log count both)"
ok "$(sec "$RO" '## Notes' | grep 'auto-retry:' | tail -1)" "- 2026-10-03T09:30+00:00 auto-retry: [[$A]] 1/2 (plan; feedback $SHA_A)" \
  "A7 hand-back: stamped with this retry's auto_retry_at"
ok "$(since "$M")" "auto-retry:$A" "A7 hand-back: its event"
ok "$(since 0 | tr ' ' '\n' | grep -c "^auto-retry:$A$")" "$(notes_lines "$A")" "A7 hand-back: as many Notes lines as auto-retry events"

# ── A8: the raise ───────────────────────────────────────────────────────────────────────────────────────────
scen a8
mkro; mkt "$A" review "pr: $PR" "ready: 2026-10-03T06:00+00:00" "integrating: 2026-10-03T07:00+00:00" "max_review_rounds: 3"; mkt "$B" open
EXTRA="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"feedback\":[\"a\"]},{\"round\":2,\"feedback\":[\"b\"]},{\"round\":3,\"stage\":\"integration\",\"feedback\":[\"c\"]}],\"integration\":{\"outcome\":\"rejected\",\"path\":\"judge-only\",\"headSha\":\"$B40\",\"baseSha\":\"$C40\",\"anchor\":{\"headSha\":\"$A40\"},\"metrics\":{\"startedAt\":\"2026-10-03T07:00:00Z\"}}}"
rec "$(row "$A" review-blocked "" "$EXTRA")"
I=$(inp "$A")
ok "$(j "$I" '[d["status"], d["resumeAt"], d["lastRound"], d["autoRetry"], d["autoRetryRaise"], d["autoRetryBudget"]["maxReviewRounds"]]')" \
  '["review-blocked","revise",3,true,4,{"source":"task","value":3}]' "A8: review-blocked, last log rejected, lastRound 3, K 3 → autoRetryRaise 4"
FP=$(j "$I" 'd["fingerprint"]')
ar "$A"
ok "$rc|$(fm "$A" max_review_rounds)" "0|max_review_rounds: 4" "A8: the verb writes max_review_rounds: 4 on the task note"
ok "$out" "$A: auto-retry 1/2 (integrate; feedback $FP; max_review_rounds raised to 4) review-blocked->in_progress [written]" "A8: stdout names the raise"
L=$(sec "$RO" '## Notes' | grep 'auto-retry:')
ok "$L" "- $S_NOW auto-retry: [[$A]] 1/2 (integrate; feedback $FP); max_review_rounds raised to 4, one round" "A8: the Notes line carries repair's raise wording"
ok "$(printf '%s\n' "$L" | python3 -c 'import re,sys; m=re.search(r"\[\[%s\]\].*max_review_rounds raised to (\d+), one round" % re.escape(sys.argv[1]), sys.stdin.read()); print(m.group(1) if m else "")' "$A")" 4 \
  "A8: repair's already-raised rule finds the raise line in the rollout's ## Notes"
ok "$(lastev auto-retry '[d["stage"], d["reviewRounds"]]')" '["integrate",4]' "A8: the event carries reviewRounds 4 (the set-aside line's stage)"
I=$(inp "$A")
ok "$(j "$I" '[d["resumeAt"], d["lastRound"]]')" '["revise",3]' "A8: inputs then gives resumeAt revise (Restart routing's seeded revise)"
RES=$(cd "$ROOTDIR" && node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['resumeArgsError'])
  const i = JSON.parse(process.argv[1])
  const resume = { stage: 'revise', prUrl: i.pr, branch: i.branch, worktreePath: '/repo/.claude/worktrees/$A', reviewHistory: i.history, reviewRoundsUsed: i.lastRound, plan: '' }
  const task = { slug: '$A', scope: 'cross-cutting', maxReviewRounds: 4, resume }
  process.stdout.write(JSON.stringify([T.resumeArgsError({ repoPath: '/repo', task }), resume.reviewRoundsUsed + 1 <= task.maxReviewRounds]))
" "$I")
ok "$RES" '["",true]' "A8: the seeded revise's resume args (maxReviewRounds 4) pass resumeArgsError, with a round left"
# an own-run review-blocked: no raise (its own call restarts the review loop)
scen a8-own
mkro; mkt "$A" in_progress "owner: execute-test" "max_review_rounds: 2"; mkt "$B" open
EXTRA="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"feedback\":[\"a\"]},{\"round\":2,\"feedback\":[\"b\"]}]}"
rec "$(row "$A" review-blocked "" "$EXTRA")"
I=$(inp "$A")
ok "$(j "$I" '[d["resumeAt"], d["autoRetry"], d["autoRetryRaise"]]')" '["own",true,null]' "A8: an own-run review-blocked task → no raise"
ar "$A"
ok "$rc|$(fm "$A" max_review_rounds)" "0|max_review_rounds: 2" "A8 own: max_review_rounds unchanged"
hasnt "$(sec "$RO" '## Notes')" "raised" "A8 own: no raise suffix"

# ── A9: an Integration set-aside rejoins the Integration queue ──────────────────────────────────────────────
scen a9
mkro; mkt "$A" review "pr: $PR" "ready: 2026-10-03T06:00+00:00" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
lead "$A" integration "merge-task exit 8 three times: retryable: cannot read PR #5 (HTTP 502)"
ok "$(j "$(nxt "")" '[e["setAsideAt"] for e in d["setAside"]]')" '["integration"]' "A9: (set aside at Integration)"
M=$(cnt)
ar "$A"
ok "$rc|$(fm "$A" status)|$(fm "$A" ready)" "0|status: review|ready: 2026-10-03T09:00+00:00" "A9: → review with ready: restamped"
has "$out" "blocked->review" "A9: stdout: blocked->review"
ok "$(j "$(nxt "")" 'd["awaitingIntegration"]')" "[\"$A\"]" "A9: next lists it awaiting Integration"
ok "$(since "$M")" "ready:$A auto-retry:$A" "A9: a ready event, then auto-retry"
ok "$(lastev auto-retry '[d["stage"], d["setAsideAt"], d["retryClass"]]')" '["integrate","integration","agent"]' "A9: stage integrate, setAsideAt integration"

# ── A10: infra blocks are exempt from the same-fingerprint stop; the budget still bounds them ─────────────────
scen a10-transient
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$TRANSIENT"
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryClass"]]')" '[true,"infra"]' "A10: a TRANSIENT plan-block → infra, retryable"
ar "$A"; ok "$rc" 0 "A10: retry 1"
ms "$A"; planblock "$A" "$TRANSIENT" 2026-10-03T09:10:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")" 1 "A10: the identical transient wrote no new run"
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetriesUsed"]]')" '[true,1]' "A10: the identical transient is still retryable (infra: no fingerprint stop)"
ar "$A"; ok "$rc|$(fm "$A" auto_retries_used)" "0|auto_retries_used: 2" "A10: retry 2"
ms "$A"; planblock "$A" "$TRANSIENT" 2026-10-03T09:20:00Z
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetryWhy"]]')" '[false,"budget: 2/2 used"]' "A10: the third stops on the budget"
scen a10-dead
mkro; mkt "$A" in_progress "owner: execute-test"; mkt "$B" open
lead "$A" own "workflow call failed: no result row"
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetryClass"]]')" '[true,"infra"]' "A10: a non-quota dead call → infra"
ar "$A"; ok "$rc" 0 "A10 dead: retry 1"
ms "$A"; setfm "$A" status in_progress; lead "$A" own "workflow call failed: no result row" 2026-10-03T09:10:00Z
ok "$(j "$(inp "$A")" 'd["autoRetry"]')" true "A10 dead: the identical dead call is still retryable"
ar "$A"; ok "$rc" 0 "A10 dead: retry 2"
ms "$A"; setfm "$A" status in_progress; lead "$A" own "workflow call failed: no result row" 2026-10-03T09:20:00Z
ok "$(j "$(inp "$A")" 'd["autoRetryWhy"]')" "budget: 2/2 used" "A10 dead: the third stops on the budget"

# ── A11: quota blocks: free retries after a cool-down ─────────────────────────────────────────────────────
scen a11
mkro; mkt "$A" in_progress "owner: execute-test"; mkt "$B" open
QT='workflow call failed: API Error: usage limit reached'
lead "$A" own "$QT" 2026-10-03T10:00:00Z
I=$(INOW=2026-10-03T10:00:00Z inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryClass"], d["autoRetryAfter"], d["autoRetryWhy"]]')" \
  '[false,"quota","2026-10-03T10:30+00:00","quota cool-down: retries at 2026-10-03T10:30+00:00"]' "A11: at T → false, autoRetryAfter T+30"
before=$(snap)
ANOW=2026-10-03T10:29:00Z ar "$A"
ok "$rc|$(snap)" "1|$before" "A11: the verb refuses while it cools (nothing written)"
I=$(INOW=2026-10-03T10:30:00Z inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryClass"]]')" '[true,"quota"]' "A11: at T+30 → true, class quota"
M=$(cnt)
ANOW=2026-10-03T10:30:00Z ar "$A"
ok "$rc|$(fm "$A" quota_retries_used)|$(fm "$A" auto_retries_used)|$(fm "$A" auto_retry_at)" \
  "0|quota_retries_used: 1|<none>|auto_retry_at: 2026-10-03T10:30+00:00" "A11: quota_retries_used 1, auto_retries_used absent, auto_retry_at"
has "$out" "$A: auto-retry quota 1/5 (implement; feedback " "A11: stdout counts the quota retry"
has "$(sec "$RO" '## Notes')" "auto-retry: [[$A]] quota 1/5 (implement; feedback " "A11: the Notes line counts the quota retry"
ok "$(lastev auto-retry '[d["retryClass"], d["used"], d["quotaRetries"], d["budget"]]')" '["quota",0,1,2]' "A11: the event: quota, used 0, quotaRetries 1"
ms "$A" 2026-10-03T10:31:00Z; setfm "$A" status in_progress
lead "$A" own "$QT" 2026-10-03T10:40:00Z
I=$(INOW=2026-10-03T11:00:00Z inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["autoRetryAfter"]]')" '[false,"2026-10-03T11:30+00:00"]' "A11: an identical re-block → after = auto_retry_at + 60"
setfm "$A" quota_retries_used 5
ok "$(j "$(INOW=2026-10-04T10:00:00Z inp "$A")" '[d["autoRetry"], d["autoRetryWhy"]]')" '[false,"quota: 5/5 free retries outlasted: a human"]' "A11: after 5 → outlasted"
setfm "$A" quota_retries_used 1; setfm "$A" auto_retries 0
ok "$(j "$(INOW=2026-10-04T10:00:00Z inp "$A")" '[d["autoRetry"], d["autoRetryWhy"]]')" '[false,"auto_retries is 0: automatic retries are off"]' "A11: auto_retries: 0 → no quota retry"
setfm "$A" auto_retries 2; setfm "$A" quota_retries_used x
ok "$(j "$(INOW=2026-10-04T10:00:00Z inp "$A")" '[d["autoRetry"], d["quotaRetriesUsed"]]')" '[false,null]' "A11: a malformed counter fails closed"

# ── A12: the budget's lifetime ───────────────────────────────────────────────────────────────────────────────
scen a12-hand-back
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"; ar "$A"; ms "$A"
planblock "$A" "$FB" 2026-10-03T09:10:00Z
hb=$(python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" 2>&1)
ok "$hb" "$A: plan-blocked->in_progress (set aside at its run; owner: cleared) [written]" "A12: hand-back's stdout is unchanged"
ok "$(fm "$A" auto_retries_used)|$(fm "$A" quota_retries_used)|$(fm "$A" auto_retry_sha)" "<none>|<none>|auto_retry_sha: $SHA_B" \
  "A12: hand-back clears both counters and re-stamps the sha with the block it re-enters"
ok "$(fm "$A" auto_retry_at)" "auto_retry_at: 2026-10-03T09:00+00:00" "A12: hand-back keeps auto_retry_at"
ms "$A"; planblock "$A" "$FB" 2026-10-03T09:20:00Z
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetryWhy"], d["autoRetriesUsed"]]')" '[false,"same feedback as the block last re-entered",0]' \
  "A12: after a human hand-back an identical re-block stops at once"
setfm "$A" status in_progress; planblock "$A" "$FC" 2026-10-03T09:30:00Z
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetriesUsed"]]')" '[true,0]' "A12: new feedback is retryable on a fresh budget"
ar "$A"; ok "$rc|$(fm "$A" auto_retries_used)" "0|auto_retries_used: 1" "A12: and retries with used 1"

scen a12-hand-back-none
mkro; mkt "$A" review "review_rounds_used: 1" "auto_retry_sha: 0123456789ab" "auto_retries_used: 1"; mkt "$B" open
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
ok "$(fm "$A" auto_retry_sha)|$(fm "$A" auto_retries_used)" "<none>|<none>" "A12: a hand-back of a block with no fingerprint removes the sha"

scen a12-carry
mkro "paused: 2026-10-03T08:00+00:00"; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
for k in "auto_retries_used: 1" "quota_retries_used: 2" "auto_retry_sha: $SHA_A" "auto_retry_at: 2026-10-03T08:30+00:00"; do setfm "$A" "${k%%:*}" "${k#*: }"; done
{ printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nsupersedes: "[[%s]]"\n---\n\n## Queue\n' "$RO"; } > "$D/proj-rollout-2026-10-04.md"
cr=$(python3 "$SCRIPT" carry --from "$D/$RO.md" --to "$D/proj-rollout-2026-10-04.md" --tasks-dir "$D" 2>&1)
has "$cr" "carry $A set-aside" "A12 carry: (carried)"
ok "$(fm "$A" auto_retries_used)|$(fm "$A" quota_retries_used)|$(fm "$A" auto_retry_sha)|$(fm "$A" auto_retry_at)" \
  "<none>|<none>|auto_retry_sha: $SHA_A|auto_retry_at: 2026-10-03T08:30+00:00" "A12: carry clears the counters and keeps the sha"

scen a12-defer
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"; ar "$A"
setfm "$A" quota_retries_used 1
df=$(python3 "$SCRIPT" defer --tasks "$A" --rollout "$D/$RO.md" --tasks-dir "$D" 2>&1)
ok "$(fm "$A" auto_retries_used)|$(fm "$A" quota_retries_used)|$(fm "$A" auto_retry_sha)|$(fm "$A" auto_retry_at)" "<none>|<none>|<none>|<none>" \
  "A12: defer clears all four markers"
has "$df" "auto_retries_used/quota_retries_used/auto_retry_sha/auto_retry_at cleared" "A12: defer's line lists them"

scen a12-leave
mkro; mkt "$A" in_progress "owner: execute-test"; mkt "$B" open
GATED='{"gatedInputs":["spend: x — cap USD 1"]}'
rec "$(row "$A" gate-pending "" "$GATED")"
for k in "auto_retries_used: 1" "quota_retries_used: 2" "auto_retry_sha: $SHA_A" "auto_retry_at: 2026-10-03T08:30+00:00"; do setfm "$A" "${k%%:*}" "${k#*: }"; done
python3 "$SCRIPT" approve-gates --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
ok "$(fm "$A" status)" "status: in_progress" "A12: (approve-gates ran)"
ms "$A"
ok "$(fm "$A" auto_retries_used)|$(fm "$A" quota_retries_used)|$(fm "$A" auto_retry_sha)|$(fm "$A" auto_retry_at)" \
  "auto_retries_used: 1|quota_retries_used: 2|auto_retry_sha: $SHA_A|auto_retry_at: 2026-10-03T08:30+00:00" "A12: approve-gates and mark-started leave the markers"

# ── A13: the queue ──────────────────────────────────────────────────────────────────────────────────────────
scen a13
mkro; setfm "$RO" parallel_ceiling 1; mkt "$A" open; mkt "$B" in_progress "owner: execute-test"
planblock "$A" "$FA"; ar "$A"
NX=$(nxt "$B")
ok "$(j "$NX" '[d["restart"], [h["reason"] for h in d["hold"] if h["slug"] == "'"$A"'"], d["halt"]]')" '[[],["ceiling: 1/1 slots in use"],null]' \
  "A13: with the ceiling full the retried task is ceiling-held, never over-launched"

# ── A14: the Run record ─────────────────────────────────────────────────────────────────────────────────────
scen a14
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
ok "$(lastev set-aside 'd["stage"]')" '"plan"' "A14: (the block's set-aside line, stage plan)"
ar "$A"
ok "$(lastev auto-retry 'd["stage"]')" "$(lastev set-aside 'd["stage"]')" "A14: the auto-retry's stage equals the preceding set-aside line's"
scen a14-recordless
mkro; mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; mkt "$B" open
lead "$A" own "merge-task: ERROR: PR #5 has a MERGE CONFLICT with main (mergeStateStatus=DIRTY) on the integrated base — nothing was merged."
rm -f "$THREAD_EVENTS_DIR/$RO.jsonl"
ar "$A"
ok "$rc|$(lastev auto-retry '[d["stage"], d["setAsideAt"]]')" '0|["integrate","run"]' "A14: with no record, the stage table: merge-task's own run → integrate"
scen a14-unwritable
mkro; mkt "$A" open; mkt "$B" open
planblock "$A" "$FA"
: > "$TMP/a-file"
THREAD_EVENTS_DIR="$TMP/a-file/events" ar "$A"
ok "$rc|$(fm "$A" status)" "0|status: in_progress" "A14: an unwritable events dir still exits 0 and writes the notes"
has "$out" "run_record: warning: cannot write" "A14: (the record warns)"

# ── A15: the pins ───────────────────────────────────────────────────────────────────────────────────────────
pin() {
  python3 - "$SCRIPT" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps({"fix": list(m.MERGE_TASK_FIXABLE), "gone": m.BRANCH_GONE_MARK, "declined": m.DECLINED_MARK,
                  "cool": list(m.QUOTA_COOLDOWN_MIN), "keys": list(m.AUTO_RETRY_KEYS)}))
PY
}
P=$(pin)
while IFS= read -r frag; do
  ok "$(grep -c -F -- "$frag" "$MT" | awk '{print ($1 > 0)}')" 1 "A15: MERGE_TASK_FIXABLE \"$frag\" is merge-task.sh's text"
done < <(j "$P" '"\n".join(d["fix"])')
ok "$(j "$P" 'len(d["fix"])')" 2 "A15: (two fixable texts)"
for frag in "(not OPEN/MERGED)" "is not on origin" "not the default branch" "merge queue required" "a NON-check gate" \
            "GitHub refused to merge" "is not confirmed merged" "stays BEHIND" "unexpected mergeStateStatus"; do
  ok "$(grep -c -F -- "$frag" "$MT" | awk '{print ($1 > 0)}')" 1 "A15: the human text \"$frag\" (A4) is merge-task.sh's"
done
ok "$(grep -c -F -- "$(j "$P" 'd["gone"]')" "$LI" | awk '{print ($1 > 0)}')" 1 "A15: BRANCH_GONE_MARK is lead-integrate.py prepare's text"
ok "$(grep -c -F -- "$(j "$P" 'd["declined"]')" "$SKILL" | awk '{print ($1 > 0)}')" 1 "A15: DECLINED_MARK is execute SKILL.md's decline reason"
ok "$(j "$P" 'd["cool"]')" '[30,60,120,240,480]' "A15: QUOTA_COOLDOWN_MIN"
ok "$(j "$P" 'd["keys"]')" '["auto_retries_used","quota_retries_used","auto_retry_sha","auto_retry_at"]' "A15: the four markers"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout auto-retry: ALL PASS"; else echo "reconcile-rollout auto-retry: FAILED"; fi
exit "$fail"
