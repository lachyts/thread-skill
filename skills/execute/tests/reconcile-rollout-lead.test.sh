#!/usr/bin/env bash
# The lead's two reconcile verbs (ADR 0030 decisions 3 and 4, p12-9): `hand-back` (a set-aside task re-enters
# the queue at the stage it stopped: Integration -> review, its own run -> in_progress) and `log-integration`
# (the lead's own clean-path Integration record, one `path=lead` line through _integration_log_line). Temp
# notes only; no vault, no network.
# Usage: bash reconcile-rollout-lead.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
NOW=2026-10-02T14:05:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/repo"; echo "== $1"; }
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[a]]\n- [[b]]\n- [[c]]\n' "$D/repo"; } > "$D/ro.md"
}
# mkt <slug> <status> [frontmatter lines...] — a task note linked to ro.
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[ro]]"\nowner: execute-2026-10-02-abc\n' "$st"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
body() { awk 'n>=2{print} /^---$/{n++}' "$D/$1.md"; }
rec() { python3 "$SCRIPT" reconcile --result - --tasks-dir "$D" --now "${2:-$NOW}" <<<"$1" >/dev/null; }
nxt() { python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --running "" 2>/dev/null; }
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True))' "$2"; }
hb() { out=$(python3 "$SCRIPT" hand-back --tasks "$1" --tasks-dir "$D" --now "${2:-2026-10-03T09:00:00Z}" 2>&1); rc=$?; }
row() {  # row <slug> <status> <blockerDiagnosis> [pr]
  python3 -c 'import json,sys; s,st,d,pr=sys.argv[1:5]; print(json.dumps({"rolloutSlug":"ro","tasks":[{"slug":s,"scope":"cross-cutting","status":st,"prUrl":pr,"blockerDiagnosis":d,"reviewHistory":[{"round":1,"feedback":["fix it"]}]}]}))' "$1" "$2" "$3" "${4:-}"
}
PR=https://github.com/o/r/pull/7
REVISE='revise: rejected at Integration re-review — revise on the branch, then re-integrate'

# ── hand-back: an Integration set-aside re-enters at Integration ─────────────────────────────────────
scen integration
mkro
mkt a review "pr: $PR" 'integrating: 2026-10-02T10:00+00:00' 'ready: 2026-10-01T08:00+00:00'
printf '\n## Integration log\n\n2026-10-02T10:00+00:00 integrated path=integrator pr=7 anchor=%s head=%s base=%s wait=5 duration=3 triggers=conflict\n' \
  "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" "$(printf 'c%.0s' $(seq 40))" >> "$D/a.md"
rec "$(row a blocked 'integration: merge step STOP: fetch origin failed twice' "$PR")"
ok "$(q "$(nxt)" '[x["setAsideAt"] for x in d["setAside"] if x["slug"]=="a"]')" '["integration"]' "fixture: a is set aside at Integration"
before=$(body a)
hb a
ok "$rc" 0 "hand-back: an Integration set-aside exits 0"
has "$out" "a: blocked->review" "hand-back: says blocked->review"
ok "$(fm a status)" "status: review" "hand-back: Integration set-aside -> review"
ok "$(fm a ready)" "ready: 2026-10-03T09:00+00:00" "hand-back: ready: restamped from --now"
ok "$(fm a pr)" "pr: $PR" "hand-back: pr: kept"
ok "$(body a)" "$before" "hand-back: the body (runs and the Integration log) is byte-identical"
J=$(nxt)
ok "$(q "$J" 'd["awaitingIntegration"]')" '["a"]' "hand-back: next lists it awaiting Integration"
ok "$(q "$J" 'd["setAside"]')" '[]' "hand-back: no longer set aside"
python3 "$SCRIPT" mark-integrating --tasks a --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1
ok "$?" 0 "hand-back: mark-integrating then succeeds"

# ── hand-back: a revise-stopped, a review-blocked, an own-run blocked and a plan-blocked note -> in_progress ─
scen own
mkro
mkt a review "pr: $PR"
mkt b review "pr: https://github.com/o/r/pull/8"
mkt c open
rec "$(row a blocked "$REVISE
revise stopped: the reviser died

Round 1 rejection:
- fix it" "$PR")"
rec '{"rolloutSlug":"ro","tasks":[{"slug":"b","scope":"cross-cutting","status":"review-blocked","prUrl":"https://github.com/o/r/pull/8","reviewHistory":[{"round":1,"feedback":["x"]},{"round":2,"feedback":["y"]}]}]}'
rec "$(row c blocked 'the verifier stayed red after 3 iterations')"
for s in a b c; do
  before=$(body "$s")
  hb "$s"
  ok "$rc" 0 "hand-back $s: exits 0"
  has "$out" "->in_progress" "hand-back $s: says ->in_progress"
  ok "$(fm "$s" status)" "status: in_progress" "hand-back $s: -> in_progress"
  ok "$(fm "$s" owner)" "<none>" "hand-back $s: owner: removed"
  ok "$(body "$s")" "$before" "hand-back $s: the body is byte-identical"
done
ok "$(fm a pr)" "pr: $PR" "hand-back: a revise-stopped note keeps its pr:"
J=$(nxt)
ok "$(q "$J" 'sorted(d["restart"])')" '["a","b","c"]' "hand-back: next --running '' restarts all three"
scen plan
mkro
mkt a open
rec "$(row a plan-blocked 'the plan judge never approved')"
hb a
ok "$rc|$(fm a status)|$(fm a owner)" "0|status: in_progress|<none>" "hand-back: plan-blocked -> in_progress, owner: removed"

# ── hand-back refusals: exit 1, nothing written ─────────────────────────────────────────────────────
scen refuse
mkro
mkt g gate-pending
mkt d done "pr: $PR"
mkt r review "pr: $PR"
mkt i in_progress
mkt o open
mkt n review
mkt x blocked
printf '\n## Blocker diagnosis\n\nintegration: set aside with no PR\n' >> "$D/x.md"
for s in g d r i o n x; do
  before=$(cat "$D/$s.md")
  hb "$s"
  ok "$rc" 1 "hand-back refuses $s ($(fm "$s" status | sed 's/status: //'))"
  ok "$(cat "$D/$s.md")" "$before" "hand-back $s: the note is byte-identical"
  has "$out" "refusing to hand back" "hand-back $s: names the refusal"
done
hb missing; ok "$rc" 1 "hand-back: a missing note exits 1"

# ── log-integration: the lead's clean-path record ───────────────────────────────────────────────────
A=$(printf '1%.0s' $(seq 40)); H=$(printf '2%.0s' $(seq 40)); B=$(printf '3%.0s' $(seq 40))
li() { out=$(python3 "$SCRIPT" log-integration --tasks "$1" --tasks-dir "$D" --started "$2" --anchor "$3" --head "$4" --base "$5" --now "${6:-2026-10-02T12:47:30+00:00}" 2>&1); rc=$?; }
scen log
mkro
mkt a review "pr: $PR" 'ready: 2026-10-02T12:00+00:00' 'review_rounds_used: 2' 'tier_capped: review'
fmb=$(awk '/^---$/{n++; print; next} n<2{print}' "$D/a.md")
li a 2026-10-02T12:30+00:00 "$A" "$H" "$B"
ok "$rc" 0 "log-integration: exits 0"
want=$(python3 - "$SCRIPT" "$A" "$H" "$B" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
a, h, b = sys.argv[2:5]
print(m._integration_log_line({"prUrl": "https://github.com/o/r/pull/7", "integration": {
  "outcome": "integrated", "path": "lead", "anchor": {"headSha": a}, "headSha": h, "baseSha": b, "triggers": [],
  "metrics": {"startedAt": "2026-10-02T12:30+00:00", "waitMinutes": 30, "durationMinutes": 17}}}))
PY
)
got=$(awk '/^## Integration log/{on=1; next} /^## /{on=0} on && NF' "$D/a.md")
ok "$got" "$want" "log-integration: the line is _integration_log_line's for the lead row (wait 30, duration 17)"
has "$got" " integrated path=lead pr=7 anchor=$A head=$H base=$B wait=30 duration=17 triggers=-" "log-integration: path=lead, the three SHAs, triggers=-"
ok "$(awk '/^---$/{n++; print; next} n<2{print}' "$D/a.md")" "$fmb" "log-integration: the frontmatter is byte-identical"
snap=$(cat "$D/a.md")
li a 2026-10-02T12:30+00:00 "$A" "$H" "$B" 2026-10-02T13:59:00+00:00
ok "$rc|$(cat "$D/a.md")" "0|$snap" "log-integration: a re-run (same startedAt and SHAs, a later --now) is a no-op"
has "$out" "[no-change]" "log-integration: a re-run says [no-change]"
li a 2026-10-02T12:50+00:00 "$A" "$B" "$B" 2026-10-02T12:49:00+00:00
ok "$rc" 0 "log-integration: a second Integration appends"
ok "$(awk '/^## Integration log/{on=1; next} /^## /{on=0} on && NF' "$D/a.md" | tail -n 1 | cut -d' ' -f1,2,8,9)" \
  "2026-10-02T12:50+00:00 integrated wait=50 duration=-" "log-integration: a negative duration is -"
scen log-noready
mkro
mkt a review "pr: 9"
li a 2026-10-02T12:30+00:00 "$A" "$H" "$B"
ok "$rc" 0 "log-integration: no ready: still writes"
has "$(awk '/^## Integration log/{on=1; next} on && NF' "$D/a.md")" "pr=9 anchor=$A head=$H base=$B wait=- duration=17" "log-integration: no ready: -> wait=-, a bare pr number"

# refusals
scen log-refuse
mkro
mkt a in_progress "pr: $PR"
mkt b review
mkt c review "pr: $PR"
for s in a b; do
  before=$(cat "$D/$s.md"); li "$s" 2026-10-02T12:30+00:00 "$A" "$H" "$B"
  ok "$rc|$(cat "$D/$s.md")" "1|$before" "log-integration refuses $s ($(fm "$s" status | sed 's/status: //'), pr: $(fm "$s" pr))"
done
before=$(cat "$D/c.md")
li c 2026-10-02T12:30+00:00 "${A:0:39}" "$H" "$B"; ok "$rc|$(cat "$D/c.md")" "1|$before" "log-integration refuses a short anchor"
li c 2026-10-02T12:30+00:00 "$A" "$(printf 'G%.0s' $(seq 40))" "$B"; ok "$rc|$(cat "$D/c.md")" "1|$before" "log-integration refuses a non-hex head"
li c "yesterday" "$A" "$H" "$B"; ok "$rc|$(cat "$D/c.md")" "1|$before" "log-integration refuses a non-ISO --started"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-lead: ALL PASS"; else echo "reconcile-rollout-lead: SOME FAILED"; fi
exit "$fail"
