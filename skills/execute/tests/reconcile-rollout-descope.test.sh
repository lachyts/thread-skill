#!/usr/bin/env bash
# reconcile-rollout.py descope (p14-4): the one guarded verb that records an automatic descope of a plan-blocked
# task, run by the live lead (execute § 4.5 step 1.2) and by /thread:repair § 3d. Exit 0 records it (the caller
# then runs `hand-back`); exit 3 is an ASK and repair asks Lachy: its one write is `descope_refused:` naming the block
# it judged (none while a descope is armed), which lead-integrate.py's verdict reads as autoRetry: false (R). The
# fixtures are the brief's four: an optional part descopes and files a follow-up (F1), work a later task owns
# descopes (F2), required scope asks (F3), and a second block after an automatic descope asks (F4); R is the refusal's
# lifetime. The plan-blocked state is built through the real `reconcile`. Temp notes only; no vault, no network.
# Usage: bash reconcile-rollout-descope.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
LI="$HERE/../scripts/lead-integrate.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
NOW=2026-10-03T09:00:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

A=proj-p3-5-a
B=proj-p3-6-b
C=proj-p3-7-c
RO=proj-rollout-2026-10-03
FU=proj-followup-canary
POINTER='(descoped: see ## Scope decision (automatic))'
BRIEF='**Do.**

- add the resume guard
- consider a canary that trips on a moved ref

**Verify.** make test'
OWNER_BODY='This task rewrites the resume filter end to end.'
FEEDBACK='Round 1: the canary pulls in resume, repair and integration machinery, and the resume filter changes belong to p3-6'

D=""
scen() { D="$TMP/$1"; mkdir -p "$D"; echo "== $1"; }
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nprojects:\n  - "[[Proj]]"\n---\n\n'
    printf -- '## Notes\n\nProject root: `%s/repo`\n\n## Queue\n\n- [[%s]]\n- [[%s]]\n- [[%s]]\n' "$D" "$A" "$B" "$C"; } > "$D/$RO.md"
}
# mkt <slug> <status> <brief body> [frontmatter lines...] — a task note linked to the rollout.
mkt() {
  local s="$1" st="$2" b="$3"; shift 3
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[%s]]"\nowner: execute-2026-10-03-abc\n' "$st" "$RO"
    printf -- 'projects:\n  - "[[Proj]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n%s\n' "$b"; } > "$D/$s.md"
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
# The body of section $2 of note $1 (up to the next `## ` heading).
sec() { awk -v h="$2" '$0==h{on=1; next} on && /^## /{exit} on{print}' "$D/$1.md"; }
row() {  # row <slug> <status> <blockerDiagnosis>
  python3 -c 'import json,sys; s,st,d=sys.argv[1:4]; print(json.dumps({"rolloutSlug":"ro","tasks":[{"slug":s,"scope":"cross-cutting","status":st,"prUrl":"","blockerDiagnosis":d}]}))' "$1" "$2" "$3"
}
rec() { python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${2:-2026-10-03T08:00:00Z}" <<<"$1" >/dev/null; }
ds() { last_call=(ds "$@"); out=$(python3 "$SCRIPT" descope --tasks "$1" --rollout "$D/$RO.md" --tasks-dir "$D" --now "$NOW" "${@:2}" 2>&1); rc=$?; }
opt() { ds "$A" --part "${1:-a canary}" --optional --short "${2:-canary}" --reason "the canary pulls in machinery later tasks rewrite" "${@:3}"; }
own() { ds "$A" --part "${1:-the resume filter changes}" --owner "${2:-$B}" --owner-quote "${3:-rewrites the resume filter}" --reason "p3-6 rewrites the filter" "${@:4}"; }
snap() { (cd "$D" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s\n' "$f"; cat "$f"; done) | shasum | cut -c1-40; }
# snapr: snap with every `descope_refused:` line left out (the refusal's one write).
snapr() { (cd "$D" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s\n' "$f"; grep -v '^descope_refused: ' "$f"; done) | shasum | cut -c1-40; }
# topkey <slug>: "run=<n> sha=<sha>" of the note's top Plan-blocked feedback run (its end marker).
topkey() { grep -o '^<!-- run [0-9]* end sha=[0-9a-f]* -->' "$D/$1.md" | tail -1 | sed -E 's/<!-- run ([0-9]+) end sha=([0-9a-f]+) -->/run=\1 sha=\2/'; }
sha12() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])' "$1"; }
followups() { (cd "$D" && ls ./*-followup-*.md 2>/dev/null | wc -l | tr -d ' '); }
# A plan-blocked a with the F1 brief, b queued as the owner, c queued.
base() {
  mkro
  mkt "$A" in_progress "$BRIEF" "$@"
  mkt "$B" open "$OWNER_BODY"
  mkt "$C" open "body c"
  rec "$(row "$A" plan-blocked "$FEEDBACK")"
}
# brief <body>: like base, but a's brief is <body>.
brief() {
  mkro
  mkt "$A" in_progress "$1"
  mkt "$B" open "$OWNER_BODY"
  mkt "$C" open "body c"
  rec "$(row "$A" plan-blocked "$FEEDBACK")"
}
# asks <label> [armed]: exit 3, one ASK line, and the vault dir byte-identical to $before but for the one write,
# `descope_refused: <now> run=<n> sha=<sha>` naming the top Plan-blocked feedback run (none while a descope is armed);
# a re-run of the same call changes nothing (idempotent).
asks() {
  ok "$rc" 3 "$1: exits 3 (ASK)"
  has "$out" "ASK: [[$A]]" "$1: one ASK line naming the task"
  ok "$(snapr)" "$before" "$1: nothing written but descope_refused:"
  if [ "${2:-}" = armed ]; then
    ok "$(fm "$A" descope_refused)" "<none>" "$1: armed, so no descope_refused:"
    has "$out" "; nothing written: /thread:repair" "$1: armed, the ASK line says nothing was written"
  else
    ok "$(fm "$A" descope_refused)" "descope_refused: 2026-10-03T09:00+00:00 $(topkey "$A")" "$1: descope_refused: names the block judged"
    has "$out" "; refusal recorded as descope_refused:, nothing else written: /thread:repair" "$1: the ASK line says the refusal is recorded"
  fi
  local again; again=$(snap); "${last_call[@]}" >/dev/null 2>&1
  ok "$rc|$(snap)" "3|$again" "$1: a re-run exits 3 and writes nothing more"
}
# refuses <label>: exit 1, an ERROR line, nothing written.
refuses() {
  ok "$rc" 1 "$1: exits 1"
  has "$out" "ERROR:" "$1: an ERROR line"
  ok "$(snap)" "$before" "$1: nothing written"
}

# ── F1: an optional part descopes automatically and files a follow-up ──────────────────────────────
scen f1
base
ok "$(fm "$A" status)" "status: plan-blocked" "fixture: a is plan-blocked through the real reconcile"
tp_before=$(python3 "$SCRIPT" touched-phases --rollout "$D/$RO.md" --tasks-dir "$D")
opt
ok "$rc" 0 "F1: exits 0"
has "$out" "[written]" "F1: [written]"
has "$out" "$FU" "F1: names the follow-up"
ok "$(followups)" 1 "F1: exactly one follow-up note"
ok "$(fm "$FU" descoped_from)" "descoped_from: \"[[$A]]\"" "F1 follow-up: descoped_from names the task"
ok "$(fm "$FU" status)" "status: open" "F1 follow-up: status open"
ok "$(fm "$FU" work_depth)" "work_depth: shallow" "F1 follow-up: work_depth shallow"
ok "$(fm "$FU" captured)" "captured: 2026-10-03" "F1 follow-up: captured from --now"
ok "$(grep -A1 '^projects:' "$D/$FU.md" | tail -1)" '  - "[[Proj]]"' "F1 follow-up: projects copied"
for k in rollout phase owner; do ok "$(fm "$FU" $k)" "<none>" "F1 follow-up: no $k:"; done
has "$(cat "$D/$FU.md")" "a canary" "F1 follow-up: carries the part"
ok "$(python3 "$SCRIPT" touched-phases --rollout "$D/$RO.md" --tasks-dir "$D")" "$tp_before" "F1: touched-phases prints nothing for the follow-up"
SD=$(sec "$A" '## Scope decision (automatic)')
has "$SD" "<!-- descope run=1 part=$(sha12 'a canary') mode=optional -->" "F1: the Scope decision holds the run-1 marker"
has "$SD" "- descoped (automatic) " "F1: the Scope decision entry line"
has "$SD" "[[$FU]]" "F1: the entry links the follow-up"
ok "$(grep -c -F -- "- consider a canary that trips on a moved ref $POINTER" "$D/$A.md")" 1 "F1: the brief bullet ends with the pointer"
RI=$(sec "$A" '## Repair input')
has "$RI" "(automatic)" "F1: an (automatic) Repair input line"
has "$RI" "Plan-blocked feedback run 1 is superseded" "F1: the Repair input names the one superseded run (singular)"
has "$RI" "every other point stands" "F1: every other point stands"
ok "$(fm "$A" descope_armed)" "descope_armed: 2026-10-03T09:00+00:00" "F1: descope_armed stamped"
ok "$(fm "$A" status)" "status: plan-blocked" "F1: status still plan-blocked (hand-back is the caller's)"
ok "$(sec "$RO" '## Notes' | grep -c "descope: \[\[$A\]\].*run 1")" 1 "F1: one rollout ## Notes descope line"
before=$(snap)
opt
ok "$rc|$(followups)" "0|1" "F1 re-run: exit 0, still one follow-up"
has "$out" "[no-change]" "F1 re-run: [no-change]"
ok "$(snap)" "$before" "F1 re-run: nothing rewritten"
# partial failure (b): the rollout Notes line lost -> restored once
grep -v "descope: \[\[$A\]\]" "$D/$RO.md" > "$D/ro.tmp" && mv "$D/ro.tmp" "$D/$RO.md"
opt
ok "$rc" 0 "F1 partial (b): exit 0"
has "$out" "[written]" "F1 partial (b): [written]"
ok "$(sec "$RO" '## Notes' | grep -c "descope: \[\[$A\]\].*run 1")" 1 "F1 partial (b): the Notes line is back exactly once"
# partial failure (c): the Repair input line, then the brief pointer, lost -> each restored once
grep -v '^- (automatic)' "$D/$A.md" > "$D/a.tmp" && mv "$D/a.tmp" "$D/$A.md"
opt
ok "$rc|$(sec "$A" '## Repair input' | grep -c '(automatic)')" "0|1" "F1 partial (c): the Repair input line restored once"
sed "s/ (descoped: see ## Scope decision (automatic))//" "$D/$A.md" > "$D/a.tmp" && mv "$D/a.tmp" "$D/$A.md"
opt
ok "$rc|$(grep -c -F "$POINTER" "$D/$A.md")" "0|1" "F1 partial (c): the brief pointer restored once"
ok "$(followups)|$(grep -c '^<!-- descope ' "$D/$A.md")" "1|1" "F1 partial: one follow-up, one marker"
# the restart consumes the stamp
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
ok "$(fm "$A" status)" "status: in_progress" "F1: hand-back takes it to in_progress"
ms=$(python3 "$SCRIPT" mark-started --tasks "$A" --tasks-dir "$D" --now "$NOW" 2>&1)
has "$ms" "$A: descope restart (descoped 2026-10-03T09:00+00:00; descope_armed: cleared)" "F1: mark-started prints the descope restart"
ok "$(fm "$A" descope_armed)" "<none>" "F1: mark-started removes descope_armed"
ms=$(python3 "$SCRIPT" mark-started --tasks "$A" --tasks-dir "$D" --now "$NOW" 2>&1)
hasnt "$ms" "descope restart" "F1: a later mark-started says nothing"

# ── F1: the brief's other accepted marker forms ───────────────────────────────────────────────────
# A clause that is only a marker word ended by `:` or `.` marks the next clause.
for form in 'nice:- Nice to have: a canary that trips on a moved ref' 'optional:- Optional. A canary that trips on a moved ref' \
            'bold:- **Optional:** a canary that trips on a moved ref' 'or:- consider the docs, or a canary that trips on a moved ref'; do
  scen "f1-form-${form%%:*}"
  brief "${form#*:}"
  opt
  ok "$rc|$(followups)" "0|1" "F1 form ${form%%:*} (${form#*:}): exit 0, a follow-up filed"
  ok "$(grep -c -F -- "${form#*:} $POINTER" "$D/$A.md")" 1 "F1 form ${form%%:*}: the pointer ends the bullet"
done
# A fenced block right under the bullet ends the item: the pointer lands on the bullet, never inside the fence.
scen f1-fence
brief '- consider a canary that trips on a moved ref
```sh
git update-ref refs/canary HEAD
```
- add the resume guard'
opt
ok "$rc" 0 "F1 fence: exit 0"
ok "$(grep -c -F -- "- consider a canary that trips on a moved ref $POINTER" "$D/$A.md")" 1 "F1 fence: the pointer ends the bullet"
ok "$(grep -c -x '```sh' "$D/$A.md")|$(grep -c -x '```' "$D/$A.md")" "1|1" "F1 fence: both fence lines are intact (the fence closes)"
ok "$(grep -c -F "$POINTER" "$D/$A.md")" 1 "F1 fence: one pointer, none inside the fence"

# ── F1 (a): a follow-up already filed by a crashed run is reused ──────────────────────────────────
scen f1-prefiled
base
printf -- '---\ntags: [task]\nstatus: open\ndescoped_from: "[[%s]]"\n---\n\n## Notes\n\nfiled by a crashed run\n' "$A" > "$D/$FU.md"
fu=$(cat "$D/$FU.md")
opt
ok "$rc|$(followups)" "0|1" "F1 (a): exit 0, one follow-up"
has "$out" "[written]" "F1 (a): [written]"
ok "$(cat "$D/$FU.md")" "$fu" "F1 (a): the pre-filed follow-up is reused, untouched"

# ── F1 refusals: exit 1, nothing written ──────────────────────────────────────────────────────────
scen f1-refuse
base
before=$(snap)
opt "a canary" p3-x;                     refuses "--short p3-x (a phase-member name)"
opt "a canary" Not_Kebab;                refuses "--short not kebab"
printf -- '---\ntags: [task]\nstatus: open\n---\n\n## Notes\n\nsomeone else\n' > "$D/$FU.md"
before=$(snap)
opt;                                     refuses "a note at the follow-up path without descoped_from"
rm "$D/$FU.md"
before=$(snap)
opt "a canary" canary --dry-run
ok "$rc" 0 "--dry-run: exit 0"
has "$out" "(dry-run)" "--dry-run: says so"
ok "$(snap)" "$before" "--dry-run: writes nothing"
ds "$A" --part "a canary" --optional --short canary --owner "$B" --reason x
ok "$rc" 2 "usage: --optional with --owner exits 2"
ds "$A" --part "a canary" --reason x
ok "$rc" 2 "usage: neither --optional nor --owner exits 2"
ds "$A" --part "a canary" --optional --reason x
ok "$rc" 2 "usage: --optional without --short exits 2"
ok "$(snap)" "$before" "usage: nothing written"
mkt "$C" blocked "body c"
rec "$(row "$C" blocked 'the verifier stayed red')"
before=$(snap)
ds "$C" --part "x" --optional --short x --reason x;  ok "$rc" 1 "a blocked note exits 1"; ok "$(snap)" "$before" "a blocked note: nothing written"
mkt "$C" plan-blocked "body c"
before=$(snap)
ds "$C" --part "x" --optional --short x --reason x;  ok "$rc" 1 "a plan-blocked note with no feedback run exits 1"; ok "$(snap)" "$before" "no run: nothing written"
printf -- '---\ntags: [task, rollout]\nstatus: in_progress\n---\n\n## Notes\n' > "$D/other-rollout-2026-10-03.md"
before=$(snap)
out=$(python3 "$SCRIPT" descope --tasks "$A" --rollout "$D/other-rollout-2026-10-03.md" --tasks-dir "$D" --now "$NOW" --part "a canary" --optional --short canary --reason x 2>&1); rc=$?
refuses "a --rollout the note does not name"
ds missing-task --part "a canary" --optional --short canary --reason x
ok "$rc" 1 "a missing note exits 1"

# ── F2: work a later task in the same rollout owns ────────────────────────────────────────────────
scen f2
base
bnote=$(cat "$D/$B.md")
own
ok "$rc" 0 "F2: exits 0"
has "$out" "[written]" "F2: [written]"
ok "$(followups)" 0 "F2: no follow-up filed"
SD=$(sec "$A" '## Scope decision (automatic)')
has "$SD" "[[$B]]" "F2: the Scope decision names the owner"
has "$SD" "<!-- descope run=1 part=$(sha12 'the resume filter changes') mode=owner owner=$B -->" "F2: the owner marker"
ptr=$(sec "$A" '## Notes' | grep -F "$POINTER")
has "$ptr" "the resume filter changes" "F2: an emergent part gets a pointer line in the first brief section"
has "$ptr" "[[$B]]" "F2: the pointer line names the owner"
ok "$(cat "$D/$B.md")" "$bnote" "F2: the owner's note is untouched"
ok "$(sec "$RO" '## Notes' | grep -c "descope: \[\[$A\]\].*\[\[$B\]\].*run 1")" 1 "F2: one rollout ## Notes line naming the owner"
before=$(snap)
own
ok "$rc|$(snap)" "0|$before" "F2 re-run: [no-change]"

# F2 owner controls: each asks, writing only descope_refused:
for case in dropped parked done; do
  scen "f2-owner-$case"
  base
  mkt "$B" "$case" "$OWNER_BODY"
  before=$(snap); own; asks "F2 owner $case"
done
scen f2-owner-unlinked
base
mkt "$B" open "$OWNER_BODY"
sed 's/^rollout: .*/rollout: "[[another-rollout-2026-10-01]]"/' "$D/$B.md" > "$D/b.tmp" && mv "$D/b.tmp" "$D/$B.md"
before=$(snap); own; asks "F2 owner not linked to the rollout"
scen f2-owner-upstream
base 'depends-on:' "  - \"[[$B]]\""
before=$(snap); own; asks "F2 owner upstream of the task"
scen f2-owner-quote
base
before=$(snap); own "the resume filter changes" "$B" "rewrites the repair verb"; asks "F2 owner-quote absent from the owner's note"
scen f2-owner-self
base
before=$(snap); own "the resume filter changes" "$A" "consider a canary"; asks "F2 --owner names the task itself"

# F2 owner held by an undecided RACE, then by an UNVERIFIED: each asks
scen f2-owner-race
base
printf '\n## Race log\n\n- 2026-10-03 [[%s]] merged while main moved: re-verify red\n' "$B" >> "$D/$RO.md"
before=$(snap); own; asks "F2 owner held by a RACE"
has "$out" "RACE or UNVERIFIED" "F2 owner RACE: names the hold"
scen f2-owner-unverified
base
mkt "$B" in_progress "$OWNER_BODY"
rec "$(row "$B" blocked 'integration: UNVERIFIED: merged without a re-verify')"
ok "$(fm "$B" status)" "status: blocked" "fixture: b is set aside through the real reconcile"
before=$(snap); own; asks "F2 owner held by an UNVERIFIED"
has "$out" "RACE or UNVERIFIED" "F2 owner UNVERIFIED: names the hold"

# ── F3: required scope asks Lachy ─────────────────────────────────────────────────────────────────
scen f3-unmarked
base
before=$(snap); opt "the resume guard" guard; asks "F3 --optional on an unmarked bullet"
scen f3-clause
mkro
mkt "$A" in_progress '- Consider every caller; add the X guard'
mkt "$B" open "$OWNER_BODY"
rec "$(row "$A" plan-blocked 'the X guard needs a schema')"
before=$(snap); opt "the X guard" x-guard; asks "F3 the marker is in another clause"
scen f3-twice
mkro
mkt "$A" in_progress '- consider a canary
- wire a canary into CI'
mkt "$B" open "$OWNER_BODY"
rec "$(row "$A" plan-blocked 'the canary')"
before=$(snap); opt; asks "F3 the part once marked and once unmarked"
scen f3-decisions
base
printf '\n## Decisions (gather 2026-10-01)\n\n- the resume filter changes stay in this task\n' >> "$D/$A.md"
before=$(snap); own; asks "F3 --owner, the part under ## Decisions"
scen f3-repair-input
base
printf '\n## Repair input\n\n- keep the resume filter changes here\n' >> "$D/$A.md"
before=$(snap); own; asks "F3 --owner, the part under an unmarked ## Repair input line"
scen f3-floor
base
before=$(snap); own "the resume guard"; asks "F3 --owner, the part in an unmarked brief bullet (the required-scope floor)"
scen f3-adr
mkro
mkt "$A" in_progress '- consider a canary as ADR 0030 decision 4 allows'
mkt "$B" open "$OWNER_BODY"
rec "$(row "$A" plan-blocked 'the canary')"
before=$(snap); opt; asks "F3 a clause that cites an ADR"
# The clause heuristic fails closed: a coordinated second instruction, a negated marker, or a fence
for form in 'and:- Consider the docs, and add the X guard' 'but:- Consider the docs, but add the X guard' \
            'then:- Consider the docs, then add the X guard' 'not:- It is not optional to add the X guard' \
            'never:- Never consider skipping the X guard' "isnt:- The X guard isn't optional" "curly:- The X guard isn’t optional"; do
  scen "f3-form-${form%%:*}"
  brief "${form#*:}"
  before=$(snap); opt "the X guard" x-guard; asks "F3 form ${form%%:*} (${form#*:})"
done
scen f3-fenced-part
brief '- consider a canary:
```
wire a canary into CI
```'
before=$(snap); opt; asks "F3 the part also sits in a fenced code block"
has "$out" "fenced code block" "F3 fenced: says why"
# The owner floor is tied to the block: a paraphrase in neither the feedback nor the brief asks.
scen f3-owner-paraphrase
base
before=$(snap); own "resume guard work"; asks "F3 --owner, a paraphrase of required scope (in neither feedback nor brief)"
has "$out" "neither the latest Plan-blocked feedback run nor the brief" "F3 owner paraphrase: says why"
# A recorded decision holding the part asks: Approved gates, Gated inputs, a human Scope decision.
for sect in '## Approved gates|- spend: a canary run on the CI box — cap USD 5' \
            '## Gated inputs (awaiting sign-off)|- credential: a canary token' \
            '## Scope decision (gather 2026-10-01)|- a canary stays in this task'; do
  scen "f3-held-$(printf '%s' "${sect%%|*}" | tr 'A-Z' 'a-z' | tr -cd 'a-z' | cut -c1-16)"
  base
  printf '\n%s\n\n%s\n' "${sect%%|*}" "${sect#*|}" >> "$D/$A.md"
  before=$(snap); opt; asks "F3 the part under ${sect%%|*}"
  has "$out" "${sect%%|*}" "F3 ${sect%%|*}: names the section"
done
scen f3-feedback-only
base
before=$(snap); opt "integration machinery" machinery; asks "F3 a part found only in the feedback"

# ── F4: a second block after an automatic descope asks Lachy ──────────────────────────────────────
scen f4-new-run
base
opt
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
python3 "$SCRIPT" mark-started --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
rec "$(row "$A" plan-blocked 'Round 1: the guard still reaches into repair')" 2026-10-03T10:00:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")" 2 "fixture F4 (i): a new run 2"
before=$(snap); opt; asks "F4 (i) a new plan-block after the descope and its restart"
scen f4-same-run
base
opt
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
python3 "$SCRIPT" mark-started --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
rec "$(row "$A" plan-blocked "$FEEDBACK")" 2026-10-03T10:00:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")|$(fm "$A" status)|$(fm "$A" descope_armed)" "1|status: plan-blocked|<none>" "fixture F4 (ii): byte-identical feedback adds no run; the stamp is gone"
before=$(snap); opt; asks "F4 (ii) a byte-identical second block"
scen f4-armed
base
opt
before=$(snap); opt "a moved ref" moved-ref; asks "F4 (iii) a different part at the same run while armed" armed
before=$(snap); own "a canary"; asks "F4 (iv) the same part in another mode while armed" armed

# ── R: the refusal is durable on the note, read by the verdict, and outdated or removed by what moves the task ──
# The verdict resolves the budget (rollouts.toml under an empty HOME of its own, the Project root a temp dir).
inp() { mkdir -p "$TMP/home" "$D/repo"; HOME="$TMP/home" python3 "$LI" inputs --note "$D/$1.md" --now "$NOW"; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":")))' "$2"; }
scen r-refused
base
ok "$(j "$(inp "$A")" 'd["autoRetry"]')" true "R control: before the refusal the plan-block reads autoRetry true"
before=$(snap); opt "the resume guard" guard; asks "R: required scope refused"
ok "$(j "$(inp "$A")" '[d["autoRetry"], d["autoRetryWhy"]]')" "[false,\"descope refused: a scope decision is Lachy's (/thread:repair asks him)\"]" \
  "R: the verdict reads the refusal (autoRetry false), whatever session asks"
rec "$(row "$A" plan-blocked "$FEEDBACK")" 2026-10-03T10:00:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")|$(j "$(inp "$A")" 'd["autoRetry"]')" "1|false" "R: a byte-identical re-block adds no run, so the refusal still names the block"
rec "$(row "$A" plan-blocked 'Round 2: the guard still reaches into repair')" 2026-10-03T10:30:00Z
ok "$(grep -c '^### Run ' "$D/$A.md")|$(j "$(inp "$A")" 'd["autoRetry"]')" "2|true" "R: a later block (run 2) outdates it"
scen r-handback
base
opt "the resume guard" guard
python3 "$SCRIPT" hand-back --tasks "$A" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
ok "$(fm "$A" status)|$(fm "$A" descope_refused)" "status: in_progress|<none>" "R: hand-back removes descope_refused"
scen r-descoped
base
opt "the resume guard" guard
ok "$(fm "$A" descope_refused)" "descope_refused: 2026-10-03T09:00+00:00 $(topkey "$A")" "fixture R: refused first"
opt
ok "$rc|$(fm "$A" descope_refused)|$(fm "$A" descope_armed)" "0|<none>|descope_armed: 2026-10-03T09:00+00:00" "R: a later descope that goes ahead removes descope_refused"
scen r-dry
base
before=$(snap); opt "the resume guard" guard --dry-run
ok "$rc|$(snap)" "3|$before" "R: --dry-run writes no descope_refused"
has "$out" "; nothing written: /thread:repair" "R: --dry-run's ASK line says nothing was written"
scen r-defer
base
opt "the resume guard" guard
out=$(python3 "$SCRIPT" defer --tasks "$A" --rollout "$D/$RO.md" --tasks-dir "$D" 2>&1)
ok "$(fm "$A" descope_refused)" "<none>" "R: defer clears descope_refused"
has "$out" "descope_refused" "R: defer names descope_refused among what it clears"

# ── defer clears the stamp ────────────────────────────────────────────────────────────────────────
scen defer
base
opt
out=$(python3 "$SCRIPT" defer --tasks "$A" --rollout "$D/$RO.md" --tasks-dir "$D" 2>&1)
ok "$(fm "$A" descope_armed)" "<none>" "defer clears descope_armed"
has "$out" "descope_armed" "defer names descope_armed among what it clears"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-descope: ALL PASS"; else echo "reconcile-rollout-descope: SOME FAILED"; fi
exit "$fail"
