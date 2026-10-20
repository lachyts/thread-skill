#!/usr/bin/env bash
# p18-3 (ADR 0035): one Human fix per refusal. lead-integrate.py auto_retry_verdict names the one fixed act that moves a
# set-aside block no agent may move (`inputs`' humanFix: {act, detail, handBack, label, raise}), and reads the one shared
# answer (`inputs`' answerRecorded, reconcile-rollout.py _answer_recorded). reconcile-rollout.py record-answer is the only
# writer of an answer, hand-back spends every live answer and takes `--answer <stamp>` as a compare-and-swap, and an
# answered block is never retried.
#   H  each Human-fix branch (H0a-H0f the answer overlay, a `left` question and a `left` null cause included; H1-H12,
#      H12 under an answer and a question; the null cases)
#   K  --max-review-rounds is an overlay humanFix ignores; the keys today's callers read are unchanged
#   L  the label forms, and `ask 2` after a spent answer
#   N  answerRecorded: the live forms, the dead keys, each re-entry stamp, ties and unparseable stamps
#   W  record-answer: the save, its refusals (a decision beside an open question included), --raise for all three
#      fields, --pr, the stamp bump, supersede
#   B  hand-back: --answer's compare-and-swap, the spend, a refused hand-back spends nothing
#   X  the races between the lead's Recorded answer, repair and the other verbs
# The blocks are built through the real `reconcile` (and `lead-integrate.py set-aside` for the lead's own rows).
# Hermetic: HOME is an empty dir of its own (rollout-settings.py reads ~/.config/thread/rollouts.toml), each scenario's
# Project root is a temp git checkout (mark-started arms the task window against it, p26-3, with the canary's records
# in a temp THREAD_GIT_ENV_DIR outside the scenario dir), and the Run record lands in each scenario's own dir. Temp
# notes only; no vault, no network.
# Usage: bash reconcile-rollout-human-fix.test.sh   (exit 0 = pass)
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
NOW=2026-10-03T09:00:00Z
S_NOW="2026-10-03T09:00+00:00"
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
Q='Which migration tool: alembic or yoyo?'

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/root"; git -c init.defaultBranch=master init -q "$D/root"; echo "== $1"; export THREAD_EVENTS_DIR="$D/events" THREAD_GIT_ENV_DIR="$TMP/git-env/$1"; rm -rf "$HOME/.config"; }
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 3\nprojects:\n  - "[[Proj]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s/root`\n\n## Queue\n\n- [[%s]]\n- [[%s]]\n' "$D" "$A" "$B"; } > "$D/$RO.md"
}
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[%s]]"\n' "$st" "$RO"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n**Do.**\n\n- add the migration\n- consider a rollback path\n'; } > "$D/$s.md"
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
if v == "<drop>":
    lines = [l for i, l in enumerate(lines) if i not in idx]
elif idx:
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
ra() { out=$(python3 "$SCRIPT" record-answer --tasks "$1" --rollout "$D/$RO.md" --tasks-dir "$D" --now "${RNOW:-$NOW}" "${@:2}" 2>&1); rc=$?; }
hb() { out=$(python3 "$SCRIPT" hand-back --tasks "$1" --tasks-dir "$D" --now "${HNOW:-$NOW}" "${@:2}" 2>&1); rc=$?; }
# ms <slug> [now]: the lead's mark-started, which arms the task window (p26-3); a refusal fails loudly.
ms() {
  local o
  o=$(python3 "$SCRIPT" mark-started --tasks "$1" --tasks-dir "$D" --now "${2:-$NOW}" --arm-repo "$D/root" --arm-default master 2>&1) \
    || { echo "FAIL - mark-started $1 exited $?: $o"; fail=1; }
}
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), sort_keys=True))' "$2"; }
# hf <inputs json>: [act, handBack, raise] of humanFix, or null
hf() { j "$1" '[d["humanFix"]["act"], d["humanFix"]["handBack"], d["humanFix"]["raise"]] if d["humanFix"] else None'; }
fix() { j "$1" "d['humanFix']['$2'] if d['humanFix'] else None"; }
ans() { j "$1" '[d["answerRecorded"]["form"], d["answerRecorded"]["stamp"]] if d["answerRecorded"] else None'; }
snap() { (cd "$D" && find . -path ./events -prune -o -type f -print | LC_ALL=C sort | while read -r f; do printf '%s\n' "$f"; cat "$f"; done) | shasum | cut -c1-40; }
sha12() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])' "$1"; }
planblock() {  # planblock <slug> <feedback> [now] [extra row json]
  local extra="${4:-}"; [ -n "$extra" ] || extra='{}'
  setfm "$1" status in_progress; setfm "$1" owner execute-test; rec "$(row "$1" plan-blocked "$2" "$extra")" "${3:-2026-10-03T08:00:00Z}"
}
# entry <slug> <line>: a hand-written `## Repair input` entry (the shape record-answer writes)
entry() { python3 - "$D/$1.md" "$2" <<'PY'
import sys
p, line = sys.argv[1:]
t = open(p).read()
if "\n## Repair input\n" in t:
    t = t.replace("\n## Repair input\n\n", "\n## Repair input\n\n" + line + "\n", 1)
else:
    t = t.rstrip("\n") + "\n\n## Repair input\n\n" + line + "\n"
open(p, "w").write(t)
PY
}
needs() { printf '\n## Needs you\n\n%s\n' "$2" >> "$D/$1.md"; }
# the lead's *Recorded answer* predicate, read off inputs
predicate() { j "$1" 'bool(d["answerRecorded"] and d["answerRecorded"]["form"] == "hand-back" and d["humanFix"] is None)'; }
SHA_A=$(sha12 "$FA"); SHA_B=$(sha12 "$FB")
RB1="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"feedback\":[\"a\"]}]}"   # an own run's review-blocked row
SETTINGS_KEYS='["autoRetry","autoRetryWhy","autoRetryError","autoRetryClass","autoRetryBudget","autoRetriesUsed","quotaRetriesUsed","fingerprint","autoRetryRaise","autoRetryAfter"]'

# An Integration set-aside with a pr: and budget left (merge-task's exit 8, retryable): A, at Integration.
int_retryable() { mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"; lead "$A" integration "merge-task exit 8 three times: retryable: cannot read PR #5 (HTTP 502)"; }
# A plain rejection (the seeded revise's): A, blocked at its run.
plain_rejection() {
  mkt "$A" review "pr: $PR" "ready: 2026-10-03T06:00+00:00" "integrating: 2026-10-03T07:00+00:00" "$@"
  local diag="$REVISE

Round 1 (Integration) rejection:
- the merge dropped the retry guard"
  local extra="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"stage\":\"integration\",\"feedback\":[\"the merge dropped the retry guard\"]}],\"integration\":{\"outcome\":\"rejected\",\"path\":\"judge-only\",\"headSha\":\"$B40\",\"baseSha\":\"$C40\",\"anchor\":{\"headSha\":\"$A40\"},\"metrics\":{\"startedAt\":\"2026-10-03T07:00:00Z\"}}}"
  rec "$(row "$A" blocked "$diag" "$extra")"
}
# A review-blocked note re-entering a revise (its last Integration line rejected), lastRound 3.
revise_blocked() {
  mkt "$A" review "pr: $PR" "ready: 2026-10-03T06:00+00:00" "integrating: 2026-10-03T07:00+00:00" "$@"
  local extra="{\"prUrl\":\"$PR\",\"reviewHistory\":[{\"round\":1,\"feedback\":[\"a\"]},{\"round\":2,\"feedback\":[\"b\"]},{\"round\":3,\"stage\":\"integration\",\"feedback\":[\"c\"]}],\"integration\":{\"outcome\":\"rejected\",\"path\":\"judge-only\",\"headSha\":\"$B40\",\"baseSha\":\"$C40\",\"anchor\":{\"headSha\":\"$A40\"},\"metrics\":{\"startedAt\":\"2026-10-03T07:00:00Z\"}}}"
  rec "$(row "$A" review-blocked "" "$extra")"
}

# ── H0: the answer overlay ──────────────────────────────────────────────────────────────────────────────────────
scen h0a
mkro; mkt "$B" open
int_retryable
needs "$A" "$Q"
I=$(inp "$A"); FP=$(j "$I" 'd["fingerprint"]')
ok "$(hf "$I")" '["answer the question",true,null]' "H0a: (a question on a retryable Integration set-aside: H4, handBack true)"
ra "$A" --kind needs-you --ask "$Q" --answer "restore the closed PR first" --fingerprint "$FP" --form awaiting-repair
ok "$rc" 0 "H0a: record-answer --form awaiting-repair exits 0"
ok "$(sec "$A" '## Needs you')" "" "H0a: the section is removed"
I=$(inp "$A")
ok "$(j "$I" '[d["autoRetry"], d["answerRecorded"]["form"]]')" '[false,"awaiting repair"]' "H0a: the cause would retry, yet autoRetry is false"
has "$(j "$I" 'd["autoRetryWhy"]')" "answered for this block (awaiting repair, $S_NOW): " "H0a: why names the answer"
ok "$(hf "$I")" '["finish the recorded answer",false,null]' "H0a: H0, handBack false"
has "$(fix "$I" detail)" "(block $FP; awaiting repair): \"$Q\" → restore the closed PR first" "H0a: its detail is the entry line"
ok "$(predicate "$I")" false "H0a: the lead's Recorded answer predicate is false"
before=$(snap); ar "$A"
ok "$rc|$(snap)" "1|$before" "H0a: auto-retry exits 1 and writes nothing"
has "$out" "not auto-retryable: answered for this block" "H0a: auto-retry's ERROR names the answer"

scen h0b
mkro; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" blocked 'integration: base moved before the merge 4 times in a row')"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $FP): \"restore it?\" → yes"
I=$(inp "$A")
ok "$(ans "$I")" '["hand-back","2026-10-03T08:30+00:00"]' "H0b: a hand-written hand-back answer reads live"
ok "$(hf "$I")" '["finish the recorded answer",false,null]' "H0b: its cause is H6 (no pr:), so H0, never the lead's hand-back"
ok "$(predicate "$I")" false "H0b: the predicate is false"

scen h0c
mkro; mkt "$B" open
int_retryable; setfm "$A" pr '"#5"'
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $FP): \"hand it back?\" → yes"
I=$(inp "$A" --repo "$D/root")
ok "$(j "$I" 'd["prUrlError"] != ""')" true "H0c Integration: (a bare #5 with no GitHub origin: prUrlError)"
ok "$(hf "$I")|$(predicate "$I")" '["finish the recorded answer",false,null]|false' "H0c Integration: H0 over H7, the predicate false"
scen h0c-revise
mkro; mkt "$B" open
plain_rejection; setfm "$A" pr '"#5"'
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $FP): \"hand it back?\" → yes"
I=$(inp "$A" --repo "$D/root" --max-review-rounds 4)
ok "$(hf "$I")|$(predicate "$I")" '["finish the recorded answer",false,null]|false' "H0c revise-shaped: H0 over H7 (rule 10), the predicate false"

scen h0d
mkro; mkt "$B" open
mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"
lead "$A" integration "origin/audit-fix/p1-1-a does not exist — the PR branch is gone"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $FP): \"recut?\" → yes"
I=$(inp "$A")
ok "$(hf "$I")|$(predicate "$I")" '["finish the recorded answer",false,null]|false' "H0d: a hand-back answer on H8 is H0"

# H0e: a `## Needs you` question answered `left`. record-answer removes the section, so the item's what is no longer the
# question and its act is the cause's: execute § 6.5 (c) lists a `left` item by its form and never pushes it.
scen h0e
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA" 2026-10-03T08:00:00Z "{\"needsHuman\":\"$Q\"}"
ok "$(hf "$(inp "$A")")" '["answer the question",true,null]' "H0e: (a question: H4)"
ra "$A" --kind needs-you --ask "$Q" --answer "leave it for now" --fingerprint "$SHA_A" --form left
ok "$rc|$(sec "$A" '## Needs you')" "0|" "H0e: --form left on the question exits 0 and removes the section"
I=$(inp "$A")
ok "$(ans "$I")|$(predicate "$I")" "[\"left\",\"$S_NOW\"]|false" "H0e: answerRecorded reads left (the form § 6.5 (c) skips the push on); never the lead's"
ok "$(hf "$I")" '["hand back or defer",true,null]' "H0e: the act is now the cause's (H10), not answer the question: the item text changed"
has "$(fix "$I" detail)" "left on your answer of $S_NOW: auto_retries is 0" "H0e: its detail names the left answer, then the cause"
# H0f: a `left` answer on a block whose cause has no fix (a retry is due): the overlay's H10, never null.
scen h0f
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["humanFix"]]')" '[true,null]' "H0f: (the cause would retry: no fix)"
ra "$A" --kind decision --ask "retry it?" --answer "no, leave it" --fingerprint "$SHA_A" --form left
I=$(inp "$A")
ok "$(j "$I" 'd["autoRetry"]')|$(hf "$I")|$(ans "$I")" "false|[\"hand back or defer\",true,null]|[\"left\",\"$S_NOW\"]" "H0f: a left answer on a null cause reads H10, form left"
ok "$(fix "$I" detail)" "left on your answer of $S_NOW: nothing else holds it" "H0f: its detail"

# ── H1-H12 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
scen h1
mkro; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" gate-pending "" '{"gatedInputs":["spend: Replicate — cap USD 5","credential: a token"]}')"
I=$(inp "$A")
ok "$(hf "$I")" '["sign off gated input",false,null]' "H1: a gate"
ok "$(fix "$I" detail)|$(fix "$I" label)" "spend: Replicate — cap USD 5; credential: a token|(gate-pending)" "H1: the pending gates, label (gate-pending)"

scen h2
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"; setfm "$A" rollout '"[[proj-rollout-missing]]"'
I=$(inp "$A")
ok "$(hf "$I")" "[\"fix its rollout: or defer\",false,null]" "H2: no rollout note"

scen h3-race
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
printf '\n## Race log\n\n- 2026-10-03T08:30+00:00 [[%s]] RACE: PR #5 merged as x\n' "$A" >> "$D/$RO.md"
I=$(inp "$A")
ok "$(hf "$I")" '["decide RACE",false,null]' "H3: an undecided RACE"
ok "$(fix "$I" detail)" "- 2026-10-03T08:30+00:00 [[$A]] RACE: PR #5 merged as x" "H3 RACE: the Race log line"
scen h3-unverified
mkro; mkt "$B" open
mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"
lead "$A" integration "UNVERIFIED: PR #5 merged as abc; not verifiable yet; re-run to verify"
I=$(inp "$A")
ok "$(hf "$I")" '["decide UNVERIFIED",false,null]' "H3: an undecided UNVERIFIED"
has "$(fix "$I" detail)" "UNVERIFIED: PR #5 merged as abc" "H3 UNVERIFIED: its line"

scen h4-own
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA" 2026-10-03T08:00:00Z "{\"needsHuman\":\"$Q\"}"
I=$(inp "$A")
ok "$(hf "$I")|$(fix "$I" detail)" "[\"answer the question\",true,null]|$Q" "H4: an own run's question, handBack true"
scen h4-revise
mkro; mkt "$B" open
plain_rejection; setfm "$A" pr '"#5"'; needs "$A" "$Q"
I=$(inp "$A" --repo "$D/root" --max-review-rounds 4)
ok "$(hf "$I")" '["answer the question",false,null]' "H4: a prUrlError revise's question, handBack false (through H7)"

scen h5-descoped
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
printf '\n## Scope decision (automatic)\n\n- descoped (automatic) 2026-10-03T07:00+00:00, Plan-blocked feedback run 1: "x" is optional in the brief\n<!-- descope run=1 part=%s mode=optional -->\n' "$(sha12 x)" >> "$D/$A.md"
I=$(inp "$A")
ok "$(hf "$I")" '["decide scope or defer",true,null]' "H5: plan-blocked after a descope"
ok "$(fix "$I" detail)" "plan-blocked again after an automatic descope (Plan-blocked feedback run 1)" "H5: its detail"
scen h5-refused
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
out=$(python3 "$SCRIPT" descope --tasks "$A" --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" --part "add the migration" --optional --short mig --reason x 2>&1); rc=$?
ok "$rc" 3 "H5 refused: (descope exits 3: required scope)"
I=$(inp "$A")
ok "$(j "$I" 'd["autoRetryWhy"]')|$(hf "$I")" 'descope refused at Plan-blocked feedback run 1: Lachy decides the scope|["decide scope or defer",true,null]' "H5: a refused descope"
has "$(fix "$I" detail)" "descope refused (automatic) run=1 sha=$SHA_A, Plan-blocked feedback run 1: \"add the migration\" (optional)" "H5 refused: the record is its detail"

scen h6
mkro; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" blocked 'integration: base moved before the merge 4 times in a row')"
I=$(inp "$A")
ok "$(hf "$I")" '["restore, recut or defer",false,null]' "H6: at Integration with no pr:, never hand-back"
ok "$(fix "$I" detail)" "base moved before the merge 4 times in a row; restore finds its branch's PR (repair § 4), and a MERGED one is § 3c's PR-less merge" "H6: the block's first line, then § 4 and § 3c"

scen h7
mkro; mkt "$B" open
int_retryable; setfm "$A" pr '"#5"'
I=$(inp "$A" --repo "$D/root")
ok "$(hf "$I")" "[\"fix the note's pr: or defer\",false,null]" "H7: at Integration, handBack false"
ok "$(fix "$I" detail)" "$(j "$I" 'd["prUrlError"]')" "H7: its detail is prUrlError"
scen h7-revise
mkro; mkt "$B" open
plain_rejection; setfm "$A" pr '"#5"'
I=$(inp "$A" --repo "$D/root" --max-review-rounds 4)
ok "$(j "$I" 'd["autoRetryWhy"]')|$(hf "$I")" "autoRevise: step 1.2's seeded revise owns it|[\"fix the note's pr: or defer\",false,null]" "H7: the autoRevise form, handBack false"
setfm "$A" pr "$PR"
ok "$(hf "$(inp "$A" --repo "$D/root" --max-review-rounds 4)")" null "H7 control: without prUrlError the autoRevise form is null"

scen h8
mkro; mkt "$B" open
mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"
lead "$A" integration "origin/audit-fix/p1-1-a does not exist — the PR branch is gone"
I=$(inp "$A")
ok "$(hf "$I")|$(fix "$I" detail)" '["restore, recut or defer",false,null]|origin/audit-fix/p1-1-a does not exist — the PR branch is gone' "H8: the branch is gone"

# H9: each budget, named by what the source run is (auto_retries: 0 refuses it at the budget)
scen h9-plan
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "plan not approved after 3 rounds. Accumulated reviewer feedback:
Round 1: x"
I=$(inp "$A")
ok "$(hf "$I")" '["raise max_plan_rounds, hand back or defer",true,"max_plan_rounds"]' "H9: max_plan_rounds"
ok "$(fix "$I" detail)" "auto_retries is 0: automatic retries are off" "H9: its detail is autoRetryWhy"
scen h9-review
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" review-blocked "" "$RB1")"
ok "$(hf "$(inp "$A")")" '["raise max_review_rounds, hand back or defer",true,"max_review_rounds"]' "H9: max_review_rounds (review-blocked)"
scen h9-marker
mkro "auto_retries: 0"; mkt "$B" open
plain_rejection "max_review_rounds: 1"
I=$(inp "$A" --max-review-rounds 1)
ok "$(j "$I" 'd["autoRevise"]')|$(hf "$I")" 'false|["raise max_review_rounds, hand back or defer",true,"max_review_rounds"]' "H9: a plain-rejection marker at the cap"
scen h9-iterations
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" blocked 'the verifier stayed red after 3 iterations: test_migration fails')"
ok "$(hf "$(inp "$A")")" '["raise max_iterations, hand back or defer",true,"max_iterations"]' "H9: max_iterations (the implementer's own paragraph)"

# H10: each fixed opening, a decline, auto_retries: 0 and a same-fingerprint block at Integration: no raise
for opening in "workflow call failed: no result row" "transient infrastructure failure — x" "plan-divergence: the plan names a missing file" \
               "agent returned neither verified nor blocked" "workflow stage threw — see /workflows"; do
  scen "h10-$(sha12 "$opening")"
  mkro "auto_retries: 0"; mkt "$B" open
  mkt "$A" in_progress "owner: execute-test"
  if [ "${opening%%:*}" = "workflow call failed" ]; then lead "$A" own "$opening"; else rec "$(row "$A" blocked "$opening")"; fi
  ok "$(hf "$(inp "$A")")" '["hand back or defer",true,null]' "H10: the opening \"${opening:0:30}\" spends no budget"
done
scen h10-merge-task
mkro; mkt "$B" open
mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"
lead "$A" own "merge-task: ERROR: PR #5 is 'CLOSED' (not OPEN/MERGED) — nothing was merged. Resolve manually."
ok "$(hf "$(inp "$A")")" '["hand back or defer",true,null]' "H10: merge-task's human text"
scen h10-declined
mkro; mkt "$B" open
mkt "$A" review "pr: $PR" "integrating: 2026-10-03T07:00+00:00"
lead "$A" integration "merge declined at the --gated hold"
ok "$(hf "$(inp "$A")")" '["hand back or defer",true,null]' "H10: a declined merge"
scen h10-zero
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ok "$(hf "$(inp "$A")")" '["hand back or defer",true,null]' "H10: auto_retries: 0 on a plan-block that spent no plan rounds"
scen h10-same
mkro; mkt "$B" open
int_retryable
ar "$A"; ok "$rc" 0 "H10 same: (the first retry)"
python3 "$SCRIPT" mark-integrating --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
lead "$A" integration "merge-task exit 8 three times: retryable: cannot read PR #5 (HTTP 502)" 2026-10-03T09:10:00Z
I=$(INOW=2026-10-03T09:10:00Z inp "$A")
ok "$(j "$I" 'd["autoRetryWhy"]')|$(hf "$I")" 'same feedback as the block last re-entered|["hand back or defer",true,null]' "H10: the same fingerprint at Integration, no raise"

scen h11
mkro; mkt "$B" open
mkt "$A" review "review_rounds_used: 1"
I=$(inp "$A")
ok "$(hf "$I")|$(fix "$I" label)" '["hand back or defer",true,null]|(review, no PR)' "H11: a code-writing review with no PR"

scen h12
mkro; mkt "$B" open
mkt "$A" open "auto_retries: -1"; planblock "$A" "$FA"
I=$(inp "$A")
ok "$(hf "$I")" '["fix the round budget",false,null]' "H12: an invalid budget stamp"
ok "$(fix "$I" detail)" "$(j "$I" 'd["autoRetryError"]')" "H12: its detail is autoRetryError"
ERR=$(j "$I" 'd["autoRetryError"]'); CLS=$(j "$I" 'd["autoRetryClass"]')
has "$ERR" "auto_retries on [[$A]] must be an integer >= 0" "H12: (autoRetryError names the stamp)"
ra "$A" --kind decision --ask "fix the budget?" --answer "leave it" --fingerprint "$SHA_A" --form left
ok "$rc" 0 "H12 answered: (a left answer)"
I=$(inp "$A")
ok "$(j "$I" 'd["autoRetryError"]')|$(j "$I" 'd["autoRetryClass"]')|$(j "$I" 'd["answerRecorded"]["form"]')" "$ERR|$CLS|left" \
  "H12 answered: the answer keeps the cause's autoRetryError and autoRetryClass (execute § 3's halt, status's flag)"
ok "$(fix "$I" act)" "fix the round budget" "H12 answered: the left answer keeps H12's act"
before=$(snap); ar "$A"
ok "$rc|$(snap)" "1|$before" "H12 answered: auto-retry exits 1, nothing written"
has "$out" "invalid round budget: auto_retries on [[$A]]" "H12 answered: … on the invalid budget, as before the answer"
scen h12-question
mkro; mkt "$B" open
mkt "$A" open "auto_retries: -1"; planblock "$A" "$FA" 2026-10-03T08:00:00Z "{\"needsHuman\":\"$Q\"}"
I=$(inp "$A")
ok "$(hf "$I")" '["answer the question",false,null]' "H12 under a question: H4, its handBack H12's (false)"
has "$(j "$I" 'd["autoRetryError"]')" "auto_retries on [[$A]] must be an integer >= 0" "H12 under a question: autoRetryError kept"

# the null cases: the way back is the lead's own
scen null
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["humanFix"]]')" '[true,null]' "null: autoRetry true"
setfm "$A" status in_progress
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["humanFix"], d["answerRecorded"]]')" '[false,null,null]' "null: running"
scen null-cooling
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$TRANSIENT"
I=$(INOW=2026-10-03T08:00:00Z inp "$A")
ok "$(j "$I" '[d["autoRetryAfter"] is not None, d["humanFix"]]')" '[true,null]' "null: cooling"
scen null-autorevise
mkro; mkt "$B" open
plain_rejection
ok "$(j "$(inp "$A" --max-review-rounds 4)" '[d["autoRevise"], d["humanFix"]]')" '[true,null]' "null: autoRevise"
scen null-answered
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask "auto_retries is 0: hand it back?" --answer yes --fingerprint "$SHA_A" --form hand-back
I=$(inp "$A")
ok "$(j "$I" 'd["humanFix"]')|$(predicate "$I")" 'null|true' "null: a hand-back answer on a cause a hand-back moves (H10)"

# ── K: the --max-review-rounds overlay ───────────────────────────────────────────────────────────────────────────
scen k
mkro; mkt "$B" open
mkt "$A" in_progress "owner: execute-test" "auto_retries_used: 2"
rec "$(row "$A" review-blocked "" "$RB1")"
I=$(inp "$A" --max-review-rounds 3)
ok "$(j "$I" '[d["autoRetry"], d["autoRetryWhy"], d["autoRetryAfter"], d["autoRetryRaise"]]')" '[false,"--max-review-rounds 3 is not the resolved max_review_rounds 4",null,null]' \
  "K: a mismatched K keeps today's why"
ok "$(hf "$I")" '["raise max_review_rounds, hand back or defer",true,"max_review_rounds"]' "K: humanFix ignores the flag (the spent budget's H9)"
ok "$(hf "$(inp "$A")")" "$(hf "$I")" "K: the same humanFix without the flag"
scen k-retryable
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
I=$(inp "$A" --max-review-rounds 3)
ok "$(j "$I" '[d["autoRetry"], d["humanFix"]]')" '[false,null]' "K: a retryable note under a mismatch has humanFix null"
ok "$(python3 -c 'import importlib.util,json,sys
s=importlib.util.spec_from_file_location("li",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(json.dumps([list(m.AUTO_RETRY_KEYS[:10]), list(m.AUTO_RETRY_KEYS[10:])], separators=(",", ":")))' "$LI")" \
  "[$SETTINGS_KEYS,[\"humanFix\",\"answerRecorded\"]]" "K: today's ten verdict keys, in order, then the two new ones"
ok "$(python3 -c 'import importlib.util,json,sys
s=importlib.util.spec_from_file_location("li",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(json.dumps(list(m.HUMAN_FIX_ACTS), separators=(",", ":"), ensure_ascii=False))' "$LI")" \
  '["finish the recorded answer","sign off gated input","fix its rollout: or defer","decide RACE","decide UNVERIFIED","answer the question","decide scope or defer","restore, recut or defer","fix the note'"'"'s pr: or defer","raise max_plan_rounds, hand back or defer","raise max_review_rounds, hand back or defer","raise max_iterations, hand back or defer","hand back or defer","fix the round budget"]' \
  "K: HUMAN_FIX_ACTS, the fixed vocabulary every act the H series reads comes from (the verdict refuses any other)"

# ── L: the label ─────────────────────────────────────────────────────────────────────────────────────────────────
scen l
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ok "$(fix "$(inp "$A")" label)" "(plan-blocked, Plan-blocked feedback run 1)" "L: (<status>, <section> run <n>)"
planblock "$A" "$FB" 2026-10-03T08:10:00Z
ok "$(fix "$(inp "$A")" label)" "(plan-blocked, Plan-blocked feedback run 2)" "L: the top run"
scen l-legacy
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" plan-blocked; printf '\n## Plan-blocked feedback\n\nthe plan misses a step\n' >> "$D/$A.md"
ok "$(fix "$(inp "$A")" label)" "(plan-blocked, Plan-blocked feedback)" "L: a legacy section with no run"
scen l-ask
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA" 2026-10-03T08:00:00Z "{\"needsHuman\":\"$Q\"}"
ra "$A" --kind needs-you --ask "$Q" --answer "alembic" --fingerprint "$SHA_A" --form hand-back
ST=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]')
hb "$A" --answer "$ST"; ok "$rc" 0 "L: (the lead's hand-back --answer)"
ms "$A" 2026-10-03T09:01:00Z; setfm "$A" owner execute-test
rec "$(row "$A" plan-blocked "$FA" "{\"needsHuman\":\"$Q\"}")" 2026-10-03T09:10:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")" 1 "L: (an identical re-block writes no run)"
I=$(INOW=2026-10-03T09:10:00Z inp "$A")
ok "$(ans "$I")|$(fix "$I" label)" "null|(plan-blocked, Plan-blocked feedback run 1, ask 2)" "L: the identical re-block after a spent answer is ask 2"

# ── N: answerRecorded ────────────────────────────────────────────────────────────────────────────────────────────
scen n
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ok "$(ans "$(inp "$A")")" null "N: no ## Repair input"
for form in "|hand-back" "; awaiting repair|awaiting repair" "; left|left"; do
  mkt "$A" open; planblock "$A" "$FA"
  entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A${form%%|*}): \"x\" → y"
  ok "$(ans "$(inp "$A")")" "[\"${form#*|}\",\"2026-10-03T08:30+00:00\"]" "N: the live form ${form#*|}"
done
for dead in "; handed back 2026-10-03T08:40+00:00" "; superseded 2026-10-03T08:40+00:00"; do
  mkt "$A" open; planblock "$A" "$FA"
  entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A$dead): \"x\" → y"
  ok "$(ans "$(inp "$A")")" null "N: a dead key ($dead) never counts"
done
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:30+00:00 decision (block -): \"x\" → y"
ok "$(ans "$(inp "$A")")" null "N: a (block -) entry never counts"
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_B): \"x\" → y"
ok "$(ans "$(inp "$A")")" null "N: another fingerprint never counts"
# each re-entry stamp alone being newer
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A): \"x\" → y"
printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-03T08:45+00:00)\n\nan older red verifier\n\n<!-- run 1 end sha=%s -->\n' "$(sha12 'an older red verifier')" >> "$D/$A.md"
ok "$(ans "$(inp "$A")")" null "N: a run in another section newer than the answer"
for stamp in "auto_retry_at|2026-10-03T08:45+00:00" "started|2026-10-03T08:45+00:00"; do
  mkt "$A" open; planblock "$A" "$FA"
  entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A): \"x\" → y"
  setfm "$A" "${stamp%%|*}" "${stamp#*|}"
  ok "$(ans "$(inp "$A")")" null "N: ${stamp%%|*} newer than the answer"
done
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A): \"x\" → y"
printf '\n## Scope decision (automatic)\n\n- descoped (automatic) 2026-10-03T08:45+00:00, Plan-blocked feedback run 1: "x" is optional in the brief\n' >> "$D/$A.md"
ok "$(ans "$(inp "$A")")" null "N: an automatic descope entry newer than the answer"
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:00+00:00 decision (block $SHA_A): \"x\" → y"
ok "$(ans "$(inp "$A")")" null "N: a tie with the re-entry stamp fails closed"
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- yesterday decision (block $SHA_A): \"x\" → y"
ok "$(ans "$(inp "$A")")" null "N: an unparseable entry stamp fails closed"
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A): \"x\" → y"
printf '\n## Review-blocked feedback\n\n### Run 1 (sometime)\n\nx\n' >> "$D/$A.md"
ok "$(ans "$(inp "$A")")" null "N: an unparseable re-entry stamp fails closed"
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $SHA_A; left): \"x\" → leave it"
entry "$A" "- 2026-10-03T08:40+00:00 decision (block $SHA_A): \"x\" → hand it back"
ok "$(ans "$(inp "$A")")" '["hand-back","2026-10-03T08:40+00:00"]' "N: two live entries, the later wins"
entry "$A" "- 2026-10-03T08:40+00:00 decision (block $SHA_A; awaiting repair): \"x\" → restore it"
ok "$(ans "$(inp "$A")")" null "N: two live entries sharing the newest stamp fail closed"

# ── W: record-answer ─────────────────────────────────────────────────────────────────────────────────────────────
scen w-order
mkro; mkt "$B" open
mkt "$A" open "auto_retries: 0"; planblock "$A" "plan not approved after 3 rounds. Accumulated reviewer feedback:
Round 1: x" 2026-10-03T08:00:00Z "{\"needsHuman\":\"$Q\"}"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $FP; left): \"earlier\" → leave it"
before=$(snap)
ra "$A" --kind needs-you --ask "$Q" --answer "alembic" --fingerprint "$FP" --form hand-back --raise max_plan_rounds
ok "$rc" 1 "W: --raise on a needs-you own run exits 1 (H4 names no raise)"
ok "$(snap)" "$before" "W: … nothing written"
setfm "$A" auto_retries 0
chmod 0444 "$D/$A.md"; before=$(snap)
ra "$A" --kind needs-you --ask "$Q" --answer "alembic" --fingerprint "$FP" --form awaiting-repair --pr "$PR"
ok "$rc|$(snap)" "1|$before" "W: an unwritable task note: exit 1, nothing written (one save)"
chmod 0644 "$D/$A.md"
ra "$A" --kind needs-you --ask "$Q" --answer "alembic" --fingerprint "$FP" --form awaiting-repair --pr "$PR"
ok "$rc|$out" "0|$A: answer recorded (awaiting-repair) $S_NOW [written]" "W: one stdout line"
ok "$(sec "$A" '## Needs you')|$(fm "$A" pr)" "|pr: $PR" "W: the section removed, pr: written"
ok "$(sec "$A" '## Repair input' | grep -v '^$')" "- 2026-10-03T08:30+00:00 decision (block $FP; superseded $S_NOW): \"earlier\" → leave it
- $S_NOW needs you (block $FP; awaiting repair): \"$Q\" → alembic" "W: the earlier live entry superseded, the entry last"
before=$(snap)
ra "$A" --kind needs-you --ask "$Q" --answer "alembic" --fingerprint "$FP" --form awaiting-repair --pr "$PR"
ok "$rc|$out|$(snap)" "0|$A: answer recorded (awaiting-repair) $S_NOW [no-change]|$before" "W: an identical re-run is [no-change] at its stamp"

scen w-refusals
mkro; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" blocked 'integration: base moved before the merge 4 times in a row')"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
before=$(snap)
ra "$A" --kind decision --ask "restore?" --answer yes --fingerprint "$FP" --form hand-back
ok "$rc|$(snap)" "1|$before" "W: --form hand-back at Integration with no pr: exits 1, nothing written"
has "$out" "a bare hand-back refuses it" "W: … says why"
ra "$A" --kind decision --ask "restore?" --answer yes --fingerprint 0123456789ab --form awaiting-repair
ok "$rc|$(snap)" "1|$before" "W: a fingerprint that is not the block's exits 1"
ra "$A" --kind decision --ask "restore?" --answer yes --fingerprint "$FP"
ok "$rc|$(snap)" "1|$before" "W: a fingerprint without --form exits 1"
ra "$A" --kind decision --ask "restore?" --answer yes --fingerprint - --form left
ok "$rc|$(snap)" "1|$before" "W: --form with - exits 1"
ra "$A" --kind decision --ask "x" --answer y --fingerprint "$FP" --form left --pr "$PR"
ok "$rc|$(snap)" "1|$before" "W: --pr with --form left exits 1"
ra "$A" --kind decision --ask "x" --answer y --fingerprint "$FP" --form left --raise max_iterations
ok "$rc|$(snap)" "1|$before" "W: --raise with --form left exits 1"
ra "$A" --kind needs-you --ask "x" --answer y --fingerprint "$FP" --form left
ok "$rc|$(snap)" "1|$before" "W: --kind needs-you with no question exits 1"
ra "$A" --kind decision --ask "restore?" --answer "restored PR #5" --fingerprint "$FP" --form hand-back --pr "$PR"
ok "$rc|$(fm "$A" pr)" "0|pr: $PR" "W: with --pr the hand-back answer is recorded (the pr: written before the entry)"
ok "$(predicate "$(inp "$A")")" true "W: … and the lead's predicate holds"
scen w-decision-question
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA" 2026-10-03T08:00:00Z "{\"needsHuman\":\"$Q\"}"
before=$(snap)
for form in hand-back awaiting-repair left; do
  ra "$A" --kind decision --ask "hand it back?" --answer yes --fingerprint "$SHA_A" --form "$form"
  ok "$rc|$(snap)" "1|$before" "W: --kind decision --form $form while the note holds a ## Needs you question exits 1, nothing written"
done
has "$out" "ERROR: record-answer: $A: the note holds a ## Needs you question: record its answer with --kind needs-you; nothing written" \
  "W: … its ERROR points to --kind needs-you"
I=$(inp "$A")
ok "$(hf "$I")|$(ans "$I")|$(sec "$A" '## Needs you' | grep -c "$Q")" '["answer the question",true,null]|null|1' "W: … the question stands, H4, no answer"
ra "$A" --kind needs-you --ask "$Q" --answer alembic --fingerprint "$SHA_A" --form hand-back
ok "$rc|$(sec "$A" '## Needs you')|$(predicate "$(inp "$A")")" "0||true" "W: the same answer as --kind needs-you records, removes the section, and the lead may act"
scen w-pr-url-error
mkro; mkt "$B" open
int_retryable; setfm "$A" pr '"#5"'
FP=$(j "$(inp "$A")" 'd["fingerprint"]'); before=$(snap)
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back
ok "$rc|$(snap)" "1|$before" "W: --form hand-back on a prUrlError at Integration exits 1"
scen w-dash
mkro; mkt "$B" open
mkt "$A" review "review_rounds_used: 1"
ra "$A" --kind decision --ask "hand it back?" --answer yes --fingerprint -
ok "$rc|$(sec "$A" '## Repair input' | grep -v '^$')" "0|- $S_NOW decision (block -): \"hand it back?\" → yes" "W: a PR-less review records (block -)"
before=$(snap); ra "$A" --kind decision --ask "hand it back?" --answer yes --fingerprint -
ok "$rc|$(snap)" "0|$before" "W: … an identical re-run is [no-change]"
ok "$(ans "$(inp "$A")")" null "W: … and a - entry never counts"

scen w-bump
mkro; mkt "$B" open
mkt "$A" open "auto_retries: 0"; planblock "$A" "$FA"
RNOW=2026-10-03T08:00:00Z ra "$A" --kind decision --ask x --answer "leave it" --fingerprint "$SHA_A" --form left
ok "$rc|$out" "0|$A: answer recorded (left) 2026-10-03T08:01+00:00 [written]" "W: a stamp tying the last run is bumped one minute"
RNOW=2026-10-03T08:00:30Z ra "$A" --kind decision --ask x --answer "hand it back" --fingerprint "$SHA_A" --form hand-back
ok "$rc" 1 "W: a bump more than a minute ahead exits 1"
has "$out" "re-run in a minute" "W: … and says re-run"

scen w-raise-revise
mkro; mkt "$B" open
revise_blocked "max_review_rounds: 3"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
ra "$A" --kind decision --ask "one more round?" --answer yes --fingerprint "$FP" --form hand-back
ok "$rc" 1 "W: a revise re-entry with no round left and no --raise refuses --form hand-back"
ra "$A" --kind decision --ask "one more round?" --answer yes --fingerprint "$FP" --form hand-back --raise max_review_rounds
ok "$rc|$(fm "$A" max_review_rounds)" "0|max_review_rounds: 4" "W: --raise max_review_rounds on a revise writes lastRound + 1"
ok "$(sec "$RO" '## Notes' | grep 'raised')" "- 2026-10-03 repair: [[$A]] max_review_rounds raised to 4, one round" "W: … with its ## Notes line"
scen w-raise-revise-left
mkro; mkt "$B" open
revise_blocked "max_review_rounds: 5"
FP=$(j "$(inp "$A")" 'd["fingerprint"]'); before=$(snap)
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_review_rounds
ok "$rc|$(snap)" "1|$before" "W: --raise max_review_rounds when k > lastRound (and the cause names none) exits 1"
scen w-raise-plan
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "plan not approved after 3 rounds. Accumulated reviewer feedback:
Round 1: x"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_review_rounds
ok "$rc" 1 "W: a raise the cause does not name exits 1"
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_plan_rounds
ok "$rc|$(fm "$A" max_plan_rounds)" "0|max_plan_rounds: 4" "W: --raise max_plan_rounds writes the resolved value + 1 (built-in 3)"
ok "$(sec "$RO" '## Notes' | grep 'raised')" "- 2026-10-03 repair: [[$A]] max_plan_rounds raised to 4, one round" "W: … with its ## Notes line"
scen w-raise-iterations
mkro "auto_retries: 0" "max_iterations: 5"; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" blocked 'the verifier stayed red after 5 iterations: test_migration fails')"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_iterations
ok "$rc|$(fm "$A" max_iterations)" "0|max_iterations: 6" "W: --raise max_iterations writes the resolved value + 1 (the rollout's 5)"
ok "$(sec "$RO" '## Notes' | grep 'raised')" "- 2026-10-03 repair: [[$A]] max_iterations raised to 6, one iteration" "W: … one iteration"
scen w-raise-own-review
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" review-blocked "" "$RB1")"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_plan_rounds
ok "$rc" 1 "W: --raise max_plan_rounds on a review H9 exits 1"
setfm "$RO" paused 2026-10-03T08:40+00:00
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_review_rounds
ok "$rc|$(fm "$A" max_review_rounds)" "0|max_review_rounds: 5" "W: an own-run review H9 raise writes the resolved value + 1, under a stamped pause too"
scen w-raise-unresolved
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "plan not approved after 3 rounds. Accumulated reviewer feedback:
Round 1: x"
rm -rf "$D/root"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
ok "$(fix "$(inp "$A")" raise)" "max_plan_rounds" "W: (an unresolved budget is H9 here)"
before=$(snap)
ra "$A" --kind decision --ask x --answer y --fingerprint "$FP" --form hand-back --raise max_plan_rounds
ok "$rc|$(snap)" "1|$before" "W: an unresolvable value exits 1, nothing written"
has "$out" "make no raise: " "W: … with the resolver's line"

scen w-supersede
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer "leave it" --fingerprint "$SHA_A" --form left
OLD=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]')
ra "$A" --kind decision --ask x --answer "hand it back" --fingerprint "$SHA_A" --form hand-back
NEW=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]')
ok "$OLD|$NEW" "$S_NOW|2026-10-03T09:01+00:00" "W: the second answer in the same minute is bumped past the first"
ok "$(sec "$A" '## Repair input' | grep -c "(block $SHA_A; superseded $NEW)")|$(sec "$A" '## Repair input' | grep -c "(block $SHA_A):")" "1|1" \
  "W: one live entry; the old one reads superseded"
before=$(snap); hb "$A" --answer "$OLD"
ok "$rc|$(snap)" "1|$before" "W: hand-back --answer <the superseded stamp> exits 1"

# ── B: hand-back ─────────────────────────────────────────────────────────────────────────────────────────────────
scen b
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer "leave it" --fingerprint "$SHA_A" --form left
ST=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]'); before=$(snap)
hb "$A" --answer "$ST"
ok "$rc|$(snap)" "1|$before" "B: --answer on a left answer exits 1"
has "$out" "ERROR: hand-back: $A: the answer of $ST is spent, superseded, not a hand-back answer or no longer this block's; nothing written" "B: the ERROR line"
RNOW=2026-10-03T09:05:00Z ra "$A" --kind decision --ask x --answer "restore" --fingerprint "$SHA_A" --form awaiting-repair
ST=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]'); before=$(snap)
hb "$A" --answer "$ST"; ok "$rc|$(snap)" "1|$before" "B: --answer on an awaiting-repair answer exits 1"
hb "$A,$B" --answer "$ST"; ok "$rc|$(snap)" "2|$before" "B: --answer with two slugs is usage (exit 2)"
hb "$A" --answer 2026-10-03T08:59+00:00; ok "$rc|$(snap)" "1|$before" "B: --answer with another stamp exits 1"
entry "$A" "- 2026-10-03T07:30+00:00 decision (block $SHA_B; left): \"an older block\" → leave it"
hb "$A"
ok "$rc|$(fm "$A" status)" "0|status: in_progress" "B: a bare hand-back moves it"
ok "$(sec "$A" '## Repair input' | grep -c "; handed back $S_NOW)")|$(sec "$A" '## Repair input' | grep -cE "\(block [0-9a-f]{12}(; awaiting repair|; left)?\)")|$(sec "$A" '## Repair input' | grep -c "; superseded ")" "2|0|1" \
  "B: … and spends every live key (an older block's too) in its one save; a superseded one stays superseded"
scen b-refused
mkro; mkt "$B" open
mkt "$A" in_progress "owner: execute-test"
rec "$(row "$A" blocked 'integration: base moved before the merge 4 times in a row')"
FP=$(j "$(inp "$A")" 'd["fingerprint"]')
entry "$A" "- 2026-10-03T08:30+00:00 decision (block $FP): \"x\" → y"
before=$(snap); hb "$A"
ok "$rc|$(snap)" "1|$before" "B: a refused hand-back (Integration, no pr:) spends nothing"
scen b-auto-retry
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T07:30+00:00 decision (block $SHA_B): \"x\" → y"
ar "$A"
ok "$rc|$(sec "$A" '## Repair input' | grep -c "(block $SHA_B)")" "0|1" "B: auto-retry is unchanged: it spends nothing (its auto_retry_at voids older answers)"

# ── X: the races ─────────────────────────────────────────────────────────────────────────────────────────────────
scen x-double
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer "hand it back" --fingerprint "$SHA_A" --form hand-back
ST=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]')
hb "$A" --answer "$ST"; ok "$rc" 0 "X: the lead's hand-back --answer"
before=$(snap); hb "$A" --answer "$ST"
ok "$rc|$(snap)" "1|$before" "X: repair's --answer after it exits 1, nothing written"
ms "$A" 2026-10-03T09:01:00Z; setfm "$A" owner execute-test
rec "$(row "$A" plan-blocked "$FA")" 2026-10-03T09:10:00Z
before=$(snap); hb "$A" --answer "$ST"
ok "$rc|$(snap)" "1|$before" "X: after an identical re-block, repair's --answer exits 1 and the note is untouched"
I=$(INOW=2026-10-03T09:10:00Z inp "$A")
ok "$(ans "$I")|$(fix "$I" label)" "null|(plan-blocked, Plan-blocked feedback run 1, ask 2)" "X: … the re-block is a fresh ask"
scen x-supersede
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer "hand it back" --fingerprint "$SHA_A" --form hand-back
LEAD=$(j "$(inp "$A")" 'd["answerRecorded"]["stamp"]')
ra "$A" --kind decision --ask x --answer "no: restore the PR first" --fingerprint "$SHA_A" --form awaiting-repair
before=$(snap); hb "$A" --answer "$LEAD"
ok "$rc|$(snap)" "1|$before" "X: repair superseded while the lead held the old stamp: the lead's --answer exits 1"
scen x-tie
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
entry "$A" "- 2026-10-03T08:00+00:00 decision (block $SHA_A): \"x\" → y"
I=$(inp "$A")
ok "$(ans "$I")|$(hf "$I")" 'null|["hand back or defer",true,null]' "X: a hand-written tie reads no answer, and the task is listed"
scen x-auto-retry
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer y --fingerprint "$SHA_A" --form left
before=$(snap); ar "$A"
ok "$rc|$(snap)" "1|$before" "X: auto-retry on an answered block exits 1"
scen x-bare
mkro "auto_retries: 0"; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer y --fingerprint "$SHA_A" --form hand-back
hb "$A"; ok "$rc" 0 "X: a bare hand-back by hand"
ms "$A" 2026-10-03T09:01:00Z; setfm "$A" owner execute-test
rec "$(row "$A" plan-blocked "$FA")" 2026-10-03T09:10:00Z
I=$(INOW=2026-10-03T09:10:00Z inp "$A")
ok "$(ans "$I")|$(fix "$I" label)" "null|(plan-blocked, Plan-blocked feedback run 1, ask 2)" "X: it spent the answer, so the identical re-block is ask 2"
scen x-descope
mkro; mkt "$B" open
mkt "$A" open; planblock "$A" "$FA"
ra "$A" --kind decision --ask x --answer "hand it back" --fingerprint "$SHA_A" --form hand-back
before=$(snap)
out=$(python3 "$SCRIPT" descope --tasks "$A" --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" --part "a rollback path" --optional --short rollback --reason x 2>&1); rc=$?
ok "$rc|$(snap)" "1|$before" "X: descope on an answered block exits 1, nothing written or recorded"
has "$out" "ERROR: descope: $A: answered for this block ($S_NOW); the answer stands" "X: … its ERROR line"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout human-fix: ALL PASS"; else echo "reconcile-rollout human-fix: FAILED"; fi
exit "$fail"
