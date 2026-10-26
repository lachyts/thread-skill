#!/usr/bin/env bash
# A gate never holds an unattended rollout (ADR 0034, p18-2): reconcile-rollout.py's half.
#   S1-S6  approve-gates --standing: a spend gate the standing approval covers is signed and annotated (p18-7's probe
#          reads 9 and passes at 50), anything else stays pending as an ASK line (a fast-mode gate across three
#          Logins, a credential, the reviewer's 70 USD gate), mixed declarations split, the limit resolves task ->
#          rollout -> rollouts.toml -> built-in 0 (off), bad stamps and a refused file write nothing, and a stop at
#          Integration still routes by its stage.
#   Q1-Q2  `next`'s awaiting-sign-off verdict: only gate-pending tasks and their queued dependants (a folded member
#          included) remain; any other set-aside, a RACE or an UNVERIFIED keeps `stuck`.
#   Q3-Q5  await-sign-off (the sign-off pause), status's pausedFor and clear-pause's STILL-AWAITING refusal, then the
#          reinstate once signed (by hand, or by a raised standing approval).
#   S7     ADR 0038's one-line gates through approve-gates --standing: p19-10's restated gate (cap 24 USD) and p19-5's
#          (cap 50 USD total) are signed; p19-10's original one-line gate asks, naming its two `each`. It runs at a
#          US$200 limit, so the month line (S9) never touches its pricing; S9c3 is the same two gates at US$50.
#   S8     ADR 0038's bounce, end to end from the engine: a priced gate (cap 24 USD) whose sub-bullet spends 40, flagged
#          on both plan rounds, is plan-blocked when the judge obeys the usd-null rule; a judge that wrongly bounces it
#          leaves `## Gate bounce (awaiting sign-off)` on the gate-pending note, and the standing approval asks instead of
#          signing (the same gate without the section is signed). Lachy's sign-off removes it; other rows settle it.
#   S9     the month line (p30-8, ADR 0034's 2026-10-27 amendment): each signing is logged in the rollout note's
#          `## Needs-you log`, and a covered gate still asks when this calendar month's standing-approved spend (every
#          rollout note's log: the live ones in the tasks dir, Archive/ and Archive/Rollouts/, dated names only, each
#          once by real path) would pass the limit with it: Verify's US$30 signs and US$250 asks; the sum runs across
#          notes, calls, gates and slugs, inclusive; dry-run writes and locks nothing; bare sign-offs, push lines, other
#          sections, undated notes and task notes never count; an unreadable dated note or an unlistable directory
#          asks; a held standing-spend lock exits 1, while a slug that needs no month read still asks; a task stamp is
#          its own line.
#   G1-G4  gate-pricer (ADR 0038): the gated_inputs.py path while the standing approval is on, "" with its why while it
#          is off (built-in 0, or a task stamp of 0), and exit 1 with an ERROR line and no stdout on a bad stamp or a
#          refused rollouts.toml. It writes nothing.
# Temp notes only; no vault, no network. HOME is pinned on every call that reaches rollout-settings.py (tests/run.sh
# seeds a refused rollouts.toml in its scratch HOME). bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
UNFINISHED="$HERE/../../_shared/scripts/unfinished-rollout.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"  # this suite reads the Run record, so it keeps its own dir
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
NOW=2026-10-14T09:00:00Z
DATE=2026-10-14

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

# Settings homes: H50 holds `[defaults] spend_approval_usd = 50`, H200 `= 200` (Lachy's, 2026-10-23); HE is empty (the
# built-in 0, off); HR is refused.
H50="$TMP/home50"; mkdir -p "$H50/.config/thread"; printf '[defaults]\nspend_approval_usd = 50\n' > "$H50/.config/thread/rollouts.toml"
H200="$TMP/home200"; mkdir -p "$H200/.config/thread"; printf '[defaults]\nspend_approval_usd = 200\n' > "$H200/.config/thread/rollouts.toml"
HE="$TMP/home-empty"; mkdir -p "$HE"
HR="$TMP/home-refused"; mkdir -p "$HR/.config/thread"; printf '[defaults]\nspend_approval_usd = -5\n' > "$HR/.config/thread/rollouts.toml"
HH="$H50"   # the home the helpers below pass

D=""
scen() { D="$TMP/$1"; mkdir -p "$D/repo"; echo "== $1"; }
# mkro [frontmatter lines...] — the rollout note $D/ro.md (schedule order $ORDER, default the slugs a b)
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 4\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n%s\n' "$D/repo" "${ORDER:-- [[a]]}"; } > "$D/ro.md"
}
# mkt <slug> <status|-> [frontmatter lines...] — a task note linked to ro (or to $RO's note when set)
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\n'
    [ "$st" = "-" ] || printf 'status: %s\n' "$st"
    printf 'rollout: "[[%s]]"\n' "${RO:-ro}"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
# gate <slug> <gate>... — append the pending section reconcile writes for a gate-pending stop
gate() {
  local s="$1"; shift
  { printf '\n## Gated inputs (awaiting sign-off)\n\n'; for g in "$@"; do printf -- '- %s\n' "$g"; done; } >> "$D/$s.md"
}
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }
# section <slug> <heading> — the section's non-blank lines
section() { awk -v h="$2" '$0 == h {on=1; next} /^## /{on=0} on && NF' "$D/$1.md"; }
sa() {  # sa <slugs> [extra args] — approve-gates --standing on $D/ro.md (or $RONOTE when set); $out (stdout+stderr), $rc
  local t="$1"; shift
  out=$(HOME="$HH" python3 "$SCRIPT" approve-gates --standing --tasks "$t" --rollout "${RONOTE:-$D/ro.md}" --tasks-dir "$D" \
    --date "$DATE" --now "$NOW" "$@" 2>&1); rc=$?
}
nxt() { HOME="$HE" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run "$@"; }
st() { HOME="$HE" python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW"; }
aso() { out=$(python3 "$SCRIPT" await-sign-off --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" 2>&1); rc=$?; }
cpz() { out=$(python3 "$SCRIPT" clear-pause --rollout "$D/ro.md" --tasks-dir "$D" 2>&1); rc=$?; }
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
events() { cat "$THREAD_EVENTS_DIR/ro.jsonl" 2>/dev/null; }

# p18-7's real gates (chorus-rollout-2026-10-10), verbatim from its archived note's `## Approved gates`.
PROBE="spend: the fast-mode probe (\`scripts/stage/probe-fast.py\`). Phase A is free (\`get_usage\` only, every signed-in Claude Login). Phase B runs seven Turns on \`claude-opus-5-5\` on ONE Login that passes the cap (three standard, four fast), drawn from that Login's usage credits. Cap US\$5 total, held by the client's \`max_budget_usd=5\` and the script stopping before any Turn once the cumulative \`total_cost_usd\` reaches US\$4."
FAST="spend: the live feature, Claude fast mode on each run of questions on the Session he is on, drawn from that Login's usage credits (extra usage). Cap US\$50 per Login (per account) per calendar month, enforced in code: fast is asked only while the Login's extra-usage monthly limit reads at or under \`fast_credit_cap\` (5000 minor units, USD or AUD only) with used credits under it, and unknown, stale, unlimited or over-cap credits keep it standard."
FAST3="spend: Claude fast mode on the Session he is on, drawn from that Login's usage credits (extra usage) — cap US\$50 per Login per month across 3 Logins"
CRED='credential: the Replicate API key from 1Password'
SEVENTY='spend: image API — cap US$40, plus US$30 for the fallback'
ANN9="(approved $DATE under the standing approval: total exposure US\$9, limit US\$50 from file:defaults)"

# ── S1: p18-7's probe passes the standing US$50 approval ─────────────────────────────────────────────
scen s1
mkro; mkt a gate-pending 'owner: lead-1'; gate a "$PROBE"
sa a
ok "$rc" 0 "S1: the probe is covered: exit 0"
ok "$(section a '## Approved gates')" "- $PROBE $ANN9" "S1: the approved line is the gate plus the standing annotation"
has "$(section a '## Approved gates')" 'total exposure US$9' "S1: the annotation records the total exposure, cap plus stop line"
ok "$(fm a status)|$(fm a gates_signed)" "status: in_progress|gates_signed: 2026-10-14T09:00+00:00" "S1: it flips to in_progress with gates_signed:"
ok "$(section a '## Gated inputs (awaiting sign-off)')" "" "S1: the pending section is gone"
has "$out" "a: gate approved under the standing approval: $PROBE (exposure US\$9 of US\$50, file:defaults)" "S1: the approval line"

# ── S2: fast mode across three Logins asks ───────────────────────────────────────────────────────────
scen s2
mkro; mkt a gate-pending; gate a "spend: fast mode — cap US\$50 per Login per month across 3 Logins"
before=$(cat "$D/a.md")
sa a
ok "$rc" 3 "S2: 150 over 50: exit 3"
ok "$(printf '%s\n' "$out" | grep -c '^ASK: ')" 1 "S2: one ASK line"
has "$out" "ASK: a: spend: fast mode — cap US\$50 per Login per month across 3 Logins: total exposure US\$150 is over the standing approval's US\$50 (file:defaults)" "S2: the ASK line names the exposure"
ok "$(cat "$D/a.md")" "$before" "S2: the note is byte-identical (still gate-pending, nothing approved)"

# ── S3: a credential, and the reviewer's 70 USD gate, still stop ─────────────────────────────────────
scen s3
mkro; mkt a gate-pending; gate a "$CRED"; mkt b gate-pending; gate b "$SEVENTY"
ORDER=$'- [[a]]\n- [[b]]' mkro
before=$(cat "$D/a.md" "$D/b.md")
sa a,b
ok "$rc" 3 "S3: exit 3"
has "$out" "ASK: a: $CRED: not a spend gate" "S3: a credential gate never passes"
has "$out" "ASK: b: $SEVENTY: total exposure US\$70 is over" "S3: US\$40 plus US\$30 is 70, over 50"
ok "$(cat "$D/a.md" "$D/b.md")" "$before" "S3: both notes untouched"

# ── S4: a mixed declaration splits; a re-run writes nothing ──────────────────────────────────────────
scen s4
mkro; mkt a gate-pending; gate a "$PROBE" "$CRED"
sa a
ok "$rc" 3 "S4: one covered, one left: exit 3"
ok "$(section a '## Approved gates')" "- $PROBE $ANN9" "S4: the probe moved"
ok "$(section a '## Gated inputs (awaiting sign-off)')" "- $CRED" "S4: the credential stays pending"
ok "$(fm a status)|$(fm a gates_signed)" "status: gate-pending|<none>" "S4: still gate-pending"
before=$(cat "$D/a.md")
sa a
ok "$rc|$(cat "$D/a.md")" "3|$before" "S4: a re-run exits 3 and leaves the note byte-identical"
hasnt "$out" "gate approved" "S4: a re-run approves nothing"
# the manual sign-off moves only the remainder, one line per gate
out=$(python3 "$SCRIPT" approve-gates --tasks a --tasks-dir "$D" --date "$DATE" --now "$NOW" 2>&1); rc=$?
ok "$rc|$(section a '## Approved gates' | wc -l | tr -d ' ')" "0|2" "S4: Lachy's sign-off moves the credential; two approved lines"
ok "$(fm a status)" "status: in_progress" "S4: signed, it flips"
sa a
ok "$rc" 0 "S4: --standing on a fully approved note is [no-change], exit 0"
has "$out" "[no-change]" "S4: … and says so"

# ── S5: settings, the ask-ahead stamp and refusals ───────────────────────────────────────────────────
scen s5
mkro; mkt a gate-pending; gate a "$PROBE"
before=$(cat "$D/a.md")
HH="$HE" sa a
ok "$rc|$(cat "$D/a.md")" "3|$before" "S5: no rollouts.toml (built-in 0): even the probe asks, nothing written"
has "$out" "standing approval off (built-in 0): set [defaults] spend_approval_usd in ~/.config/thread/rollouts.toml" "S5: the ASK names the off approval"
mkt b gate-pending 'spend_approval_usd: 150'; gate b "$FAST3"
sa b
ok "$rc" 0 "S5: a task stamp of 150 covers the count-phrased fast-mode gate"
ok "$(section b '## Approved gates')" "- $FAST3 (approved $DATE under the standing approval: total exposure US\$150, limit US\$150 from task)" "S5: annotated with source task"
mkt c gate-pending 'spend_approval_usd: 150'; gate c "$FAST"
before=$(cat "$D/c.md")
sa c
ok "$rc|$(cat "$D/c.md")" "3|$before" "S5: the same stamp never covers the verbatim uncounted gate"
has "$out" "ASK: c: $FAST: per-Login cap with no Login count" "S5: … per-Login cap with no Login count"
for bad in -1 fifty; do
  mkt d gate-pending "spend_approval_usd: $bad"; gate d "$PROBE"
  before=$(cat "$D/d.md")
  sa d
  ok "$rc|$(cat "$D/d.md")" "1|$before" "S5: a stamp of $bad exits 1, nothing written"
  has "$out" "spend_approval_usd on [[d]] must be an integer >= 0" "S5: … naming the stamp ($bad)"
done
# This mkro rewrites ro.md, wiping b's US$150 Needs-you log line, so e's US$9 sums against 0 this month. Were the log
# kept, e asking (150 + 9 is past the rollout's 10 month line) would be the month line working, not a bug to fix.
mkro 'spend_approval_usd: 10'
mkt e gate-pending; gate e "$PROBE"
sa e
ok "$rc" 0 "S5: a rollout stamp of 10 covers the probe (9)"
has "$(section e '## Approved gates')" "limit US\$10 from rollout" "S5: … with source rollout"
mkro
mkt f gate-pending; gate f "$PROBE"
before=$(cat "$D/f.md")
HH="$HR" sa f
ok "$rc|$(cat "$D/f.md")" "1|$before" "S5: a refused rollouts.toml exits 1, nothing written"
has "$out" "rollout settings refused" "S5: … and says so"
out=$(HOME="$H50" python3 "$SCRIPT" approve-gates --standing --tasks f --tasks-dir "$D" --now "$NOW" 2>&1); rc=$?
ok "$rc|$(cat "$D/f.md")" "1|$before" "S5: --standing without --rollout exits 1, nothing written"
has "$out" "ERROR: --standing needs --rollout" "S5: … with its ERROR line"

# ── S6: a stop at Integration still routes by its stage ──────────────────────────────────────────────
scen s6
mkro; mkt a gate-pending 'pr: https://github.com/o/r/pull/7'; gate a "$PROBE"
printf '\n## Integration log\n\n2026-10-13T10:00+00:00 set-aside path=integrator pr=7 anchor=%s head=%s base=%s wait=1 duration=2 triggers=-\n' \
  "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" "$(printf 'c%.0s' $(seq 40))" >> "$D/a.md"
sa a
ok "$rc|$(fm a status)|$(fm a ready)" "0|status: review|ready: 2026-10-14T09:00+00:00" "S6: at Integration it goes to review with ready:"

# ── S7: ADR 0038's one-line gates (a Cap that holds its split) ───────────────────────────────────────
scen s7
# p19-10's original gate, from its archived note's line 157 (the `## Approved plan` quote, `> - ` stripped).
P19_10='spend: `claude plugin eval` re-runs of close-deletes-consumed-keeps-legacy and close-pending-doc-owns-continuation, --runs 3 each, Opus model and judge, before and after the fix plus at most one more iteration (up to 6 invocations, each --max-cost-usd 4) — cap 20 USD'
ONE24='spend: claude plugin eval re-runs of the two close cases — cap 24 USD'
ONE50='spend: two make evals runs, pre-trim and post-trim — cap 50 USD total'
ORDER=$'- [[a]]\n- [[b]]\n- [[c]]' mkro
mkt a gate-pending; gate a "$ONE24"
mkt b gate-pending; gate b "$ONE50"
mkt c gate-pending; gate c "$P19_10"
before=$(cat "$D/c.md")
HH="$H200" sa a,b,c
ok "$rc" 3 "S7: two signed, one asks: exit 3"
has "$out" "a: gate approved under the standing approval: $ONE24 (exposure US\$24 of US\$200, file:defaults)" "S7: p19-10's restated gate signs US\$24"
has "$out" "b: gate approved under the standing approval: $ONE50 (exposure US\$50 of US\$200, file:defaults)" "S7: p19-5's one-line gate signs US\$50"
has "$out" "ASK: c: $P19_10: per/each outside the cap clause: each, each" "S7: p19-10's original gate asks, naming its two each"
ok "$(cat "$D/c.md")" "$before" "S7: the unpriceable gate's note is untouched"

# ── S8: a gate the plan judge flagged never reaches the standing approval (ADR 0038, p23-1 round 2) ──────────────
# The reviewer's reproduction, end to end: the engine (task.workflow.js, through tests/lib/engine.mjs) runs a plan whose
# gate line prices (`cap 24 USD`, US$24, under the US$50 limit) while its sub-bullet spends 40, the plan judge flagging it
# on both rounds. Obeying the fragment (no gateBounce: the gate priced), the row is plan-blocked, so approve-gates
# --standing has nothing to sign. A judge that wrongly lists it in gateBounce gets the bounce override (gate-pending);
# reconcile writes the bounce paragraph under `## Gate bounce (awaiting sign-off)`, and while it stands the standing
# approval signs nothing on the note: an ASK, never `gate approved under the standing approval`. The same gate on a note
# without the section is signed (the control: the section is what refuses). Lachy's sign-off removes both sections.
ROOTDIR="$(cd "$HERE/../../.." && pwd)"
S8_JS=$(cat <<'JS'
import { runTask, VERIFY_SLOT } from './tests/lib/engine.mjs'
const [slug, bounce] = process.argv.slice(1)
const G24 = 'spend: eval re-runs — cap 24 USD'
const plan = `Planned on: abc\n### Files to modify\n- x\n### Gated inputs\n- ${G24}\n  - 10 invocations at --max-cost-usd 4 (40 USD)\n### Risks / unknowns\n- none`
const feedback = ['the sub-bullet spends 40 USD (10 invocations at --max-cost-usd 4) against a Cap of 24 USD: raise the Cap or trim the runs']
const args = { rolloutSlug: 'ro', repoPath: '/repo', verifier: 'make test', date: '2026-10-14',
  verifySlot: VERIFY_SLOT, // required (estate ADR 0009 d4)
  gatePricer: '/x/skills/_shared/scripts/gated_inputs.py',
  task: { slug, taskPath: `/vault/${slug}.md`, scope: 'cross-cutting', planGate: true, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 2, rung: 'opus-high' } }
const out = await runTask(args, async (prompt, opts) => {
  const kind = opts.label.split(':')[0]
  if (kind === 'plan' || kind === 'plan-revise') return { ready: true, blocked: false, blockerCause: '', plan }
  if (kind === 'plan-judge') return { verdict: 'changes', feedback, ...(bounce === 'yes' ? { gateBounce: [G24] } : {}) }
  throw new Error('S8: unexpected agent ' + opts.label)
})
if (out.error) throw out.error
process.stdout.write(JSON.stringify(out.result))
JS
)
s8row() { (cd "$ROOTDIR" && node --input-type=module -e "$S8_JS" "$1" "$2"); }  # s8row <slug> <yes|no> — the result JSON
rec() { HOME="$HE" python3 "$SCRIPT" reconcile --result "$1" --tasks-dir "$D" --now "$NOW" >/dev/null 2>&1; }
G24='spend: eval re-runs — cap 24 USD'
BOUNCE_H='## Gate bounce (awaiting sign-off)'
scen s8
ORDER=$'- [[a]]\n- [[b]]\n- [[c]]' mkro
ok "$(printf '%s\n' "$G24" | python3 -I "$HERE/../../_shared/scripts/gated_inputs.py" exposure -)" '{"usd": "24", "why": ""}' "S8: the gate's own line prices US\$24, under the limit"
# the judge obeys the fragment: no gateBounce for a priced gate, so an ordinary changes, plan-blocked
mkt b in_progress
s8row b no > "$TMP/s8-b.json"
ok "$(q "$(cat "$TMP/s8-b.json")" '[d["tasks"][0]["status"], d["tasks"][0]["gatedInputs"], [c["stage"] for c in d["tasks"][0]["climbs"]]]')" '["plan-blocked",[],["plan"]]' "S8: obeyed, the engine row is plan-blocked and climbed"
rec "$TMP/s8-b.json"
ok "$(fm b status)|$(section b "$BOUNCE_H")" "status: plan-blocked|" "S8: … reconciled plan-blocked, no bounce section"
sa b
ok "$rc" 1 "S8: --standing refuses a note that is not gate-pending (exit 1)"
hasnt "$out" "gate approved under the standing approval" "S8: … and signs nothing"
# a judge that wrongly bounces the priced gate: gate-pending with the bounce, which the standing approval never signs
mkt a in_progress
s8row a yes > "$TMP/s8-a.json"
ok "$(q "$(cat "$TMP/s8-a.json")" '[d["tasks"][0]["status"], d["tasks"][0]["gatedInputs"], d["tasks"][0]["climbs"]]')" "[\"gate-pending\",[\"$G24\"],[]]" "S8: wrongly bounced, the engine row is gate-pending with no climb"
rec "$TMP/s8-a.json"
ok "$(fm a status)|$(section a '## Gated inputs (awaiting sign-off)')" "status: gate-pending|- $G24" "S8: reconciled gate-pending with the gate pending"
BS=$(section a "$BOUNCE_H")
has "$BS" "bounced by the plan judge (ADR 0038): it still read these gates as unpriceable after one bounce, so they go to sign-off as written, never to the standing approval:" "S8: the bounce section opens with the engine's paragraph"
has "$BS" "  - $G24" "S8: … names the flagged gate"
has "$BS" "its round-2 feedback:" "S8: … and the round"
has "$BS" "  - the sub-bullet spends 40 USD (10 invocations at --max-cost-usd 4) against a Cap of 24 USD: raise the Cap or trim the runs" "S8: … with the judge's feedback for the person who signs"
rec "$TMP/s8-a.json"
ok "$(section a "$BOUNCE_H")|$(grep -cxF "$BOUNCE_H" "$D/a.md")" "$BS|1" "S8: a re-reconcile keeps one bounce section, its text unchanged (upserted, never duplicated)"
before=$(cat "$D/a.md")
sa a
ok "$rc" 3 "S8: --standing on the bounced note exits 3"
hasnt "$out" "gate approved under the standing approval" "S8: the bounced gate never reaches the standing approval's signature"
has "$out" "ASK: a: $G24: the plan judge bounced this plan (ADR 0038; its feedback is under $BOUNCE_H), so the standing approval signs none of its gates; the pricer reads: exposure US\$24" "S8: … it is an ASK naming the bounce and the pricer's reading"
ok "$(cat "$D/a.md")" "$before" "S8: … and the note is byte-identical"
# the control: the same gate on a gate-pending note without the bounce section is signed
mkt c gate-pending; gate c "$G24"
sa c
ok "$rc" 0 "S8 (control): without the bounce section the same gate is covered"
has "$out" "c: gate approved under the standing approval: $G24 (exposure US\$24 of US\$50, file:defaults)" "S8 (control): … under the standing approval"
# Lachy's sign-off removes both sections and sends the task on
out=$(python3 "$SCRIPT" approve-gates --tasks a --tasks-dir "$D" --date "$DATE" --now "$NOW" 2>&1); rc=$?
ok "$rc|$(fm a status)" "0|status: in_progress" "S8: Lachy's sign-off flips the bounced note"
ok "$(section a '## Gated inputs (awaiting sign-off)')|$(section a "$BOUNCE_H")" "|" "S8: … removing the pending and the bounce sections"
ok "$(section a '## Approved gates')" "- $G24 (approved $DATE)" "S8: … recording his sign-off"
# a later gate-pending row without a bounce, or any other row, settles an older bounce section
mkt d in_progress
s8row d yes > "$TMP/s8-d.json"; rec "$TMP/s8-d.json"
ok "$(section d "$BOUNCE_H" | head -1 | cut -c1-37)" "bounced by the plan judge (ADR 0038):" "S8: d carries a bounce"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); r=d["tasks"][0]; r["blockerDiagnosis"]=r["blockerDiagnosis"].split("\n\n")[0]; json.dump(d, open(sys.argv[2], "w"))' "$TMP/s8-d.json" "$TMP/s8-d2.json"
rec "$TMP/s8-d2.json"
ok "$(fm d status)|$(section d "$BOUNCE_H")" "status: gate-pending|" "S8: a gate-pending row with no bounce paragraph removes the section"
rec "$TMP/s8-d.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); r=d["tasks"][0]; r["status"]="plan-blocked"; r["gatedInputs"]=[]; json.dump(d, open(sys.argv[2], "w"))' "$TMP/s8-d.json" "$TMP/s8-d3.json"
rec "$TMP/s8-d3.json"
ok "$(fm d status)|$(section d "$BOUNCE_H")" "status: plan-blocked|" "S8: a row of another status removes it too"

# ── S9: the month line (p30-8; ADR 0034's 2026-10-27 amendment, Chorus ADR 0108 d4) ───────────────────────────────
# Spend is never asked ahead: a covered gate is signed and its signing logged in the rollout note's `## Needs-you log`,
# and it still asks when this calendar month's standing-approved spend (summed from every rollout note's log) would
# pass the limit with it. LOG(x, m, gate) is that line at NOW, under the H200 limit unless named.
logl() {  # logl <slug> <x> <m> <gate> [limit] [source] — the standing approval's Needs-you log line at NOW
  printf -- '- 2026-10-14T09:00+00:00 [[%s]] signed under the standing approval: US$%s (month to date US$%s of US$%s, %s): %s' \
    "$1" "$2" "$3" "${5:-200}" "${6:-file:defaults}" "$4"
}
mkarch() {  # mkarch <path> [log line] — an archived rollout note, its `## Needs-you log` holding the line
  { printf -- '---\ntags: [task, rollout]\nstatus: done\n---\n\n## Queue\n\n- [[x]]\n'
    [ -z "${2:-}" ] || printf '\n## Needs-you log\n\n%s\n' "$2"; } > "$1"
}
R30='spend: replicate credits — cap 30 USD'
R250='spend: replicate credits — cap 250 USD'
DECOY='- 2026-10-03T10:00+00:00 [[z1]] signed under the standing approval: US$500 (month to date US$500 of US$200, file:defaults): spend: z1 — cap 500 USD'

# S9a: Verify's US$30 asks nothing and is signed, its signing logged below `## Queue`
scen s9a
mkro; mkt a gate-pending; gate a "$R30"
HH="$H200" sa a
ok "$rc|$(fm a status)" "0|status: in_progress" "S9a: Verify's US\$30 is signed by the standing approval: exit 0, in_progress"
ok "$(section a '## Approved gates')" "- $R30 (approved $DATE under the standing approval: total exposure US\$30, limit US\$200 from file:defaults)" "S9a: … annotated as before"
ok "$(section ro '## Needs-you log')" "$(logl a 30 30 "$R30")" "S9a: the signing is the rollout note's one Needs-you log line"
ok "$(grep '^## ' "$D/ro.md" | tail -1)" "## Needs-you log" "S9a: … in a section created at the note's end, below ## Queue"
hasnt "$out" "ASK:" "S9a: nothing asks"

# S9b: Verify's US$250 still reaches him
scen s9b
mkro; mkt a gate-pending; gate a "$R250"
before=$(cat "$D/a.md" "$D/ro.md")
HH="$H200" sa a
ok "$rc" 3 "S9b: Verify's US\$250 asks: exit 3"
has "$out" "ASK: a: $R250: total exposure US\$250 is over the standing approval's US\$200 (file:defaults)" "S9b: … over the per-gate limit"
ok "$(cat "$D/a.md" "$D/ro.md")" "$before" "S9b: a.md and ro.md byte-identical (no Needs-you log)"

# S9c: the month line sums every rollout note's log (live, Archive/, Archive/Rollouts/, a -2 ordinal), this month only,
# inclusive, and across calls (S9j: the tasks dir itself, the dedupe, and what never counts there)
scen s9c
mkro; mkt a gate-pending; gate a "$R30"
printf '\n## Needs-you log\n\n%s\n%s\n' \
  '- 2026-10-02T10:00+00:00 [[old1]] signed under the standing approval: US$100 (month to date US$100 of US$200, file:defaults): spend: x — cap 100 USD' \
  '- 2026-09-30T10:00+00:00 [[old0]] signed under the standing approval: US$150 (month to date US$150 of US$200, file:defaults): spend: y — cap 150 USD' >> "$D/ro.md"
mkdir -p "$D/Archive/Rollouts"
mkarch "$D/Archive/Rollouts/x-rollout-2026-10-01.md" '- 2026-10-05T10:00+00:00 [[x1]] signed under the standing approval: US$40 (month to date US$140 of US$200, file:defaults): spend: x1 — cap 40 USD'
mkarch "$D/Archive/y-rollout-2026-10-02-2.md" '- 2026-10-07T10:00+00:00 [[y1]] signed under the standing approval: US$30 (month to date US$170 of US$200, file:defaults): spend: y1 — cap 30 USD'
HH="$H200" sa a
ok "$rc" 0 "S9c: 100 + 40 + 30 this month, plus 30, lands exactly on the US\$200 line: signed (inclusive)"
ok "$(section ro '## Needs-you log' | tail -1)" "$(logl a 30 200 "$R30")" "S9c: … logged at month to date US\$200"
P10='spend: one more probe — cap 10 USD'
mkt b gate-pending; gate b "$P10"
before=$(cat "$D/b.md" "$D/ro.md")
HH="$H200" sa b
ok "$rc" 3 "S9c: a later call's US\$10 is past the month line: exit 3"
has "$out" "ASK: b: $P10: this month's (2026-10) standing approvals would reach US\$210 with this gate, past the US\$200 month line (file:defaults)" "S9c: … the ASK names the month line (a's persisted line was read)"
ok "$(cat "$D/b.md" "$D/ro.md")" "$before" "S9c: b.md and ro.md byte-identical across the call"

# S9c2: two gates on one note: the first signs, the second is past the month line
scen s9c2
B150='spend: batch one — cap 150 USD'; B60='spend: batch two — cap 60 USD'
mkro; mkt a gate-pending; gate a "$B150" "$B60"
HH="$H200" sa a
ok "$rc|$(fm a status)" "3|status: gate-pending" "S9c2: one gate signed, one left: exit 3, still gate-pending"
ok "$(section a '## Approved gates')" "- $B150 (approved $DATE under the standing approval: total exposure US\$150, limit US\$200 from file:defaults)" "S9c2: batch one approved"
ok "$(section a '## Gated inputs (awaiting sign-off)')" "- $B60" "S9c2: batch two alone stays pending"
has "$out" "ASK: a: $B60: this month's (2026-10) standing approvals would reach US\$210 with this gate, past the US\$200 month line (file:defaults)" "S9c2: … asking past the month line"
ok "$(section ro '## Needs-you log')" "$(logl a 150 150 "$B150")" "S9c2: one log line, batch one's"

# S9c3: S7's two gates at US$50 in one call: the running sum crosses slugs
scen s9c3
ORDER=$'- [[a]]\n- [[b]]' mkro
mkt a gate-pending; gate a "$ONE24"
mkt b gate-pending; gate b "$ONE50"
before=$(cat "$D/b.md")
sa a,b
ok "$rc" 3 "S9c3: a signs, b asks: exit 3"
has "$out" "a: gate approved under the standing approval: $ONE24 (exposure US\$24 of US\$50, file:defaults)" "S9c3: a's US\$24 signs"
has "$out" "ASK: b: $ONE50: this month's (2026-10) standing approvals would reach US\$74 with this gate, past the US\$50 month line (file:defaults)" "S9c3: b's US\$50 alone is covered, but a's US\$24 earlier in the call puts it past the line"
ok "$(cat "$D/b.md")" "$before" "S9c3: b.md byte-identical"
ok "$(section ro '## Needs-you log')" "$(logl a 24 24 "$ONE24" 50)" "S9c3: one log line, a's"

# S9d: dry-run writes nothing and takes no lock
scen s9d
mkro; mkt a gate-pending; gate a "$R30"
before=$(cat "$D/a.md" "$D/ro.md")
out=$(THREAD_NOTE_LOCK_DIR="$TMP/locks-dry" HOME="$H200" python3 "$SCRIPT" approve-gates --standing --tasks a --rollout "$D/ro.md" \
  --tasks-dir "$D" --date "$DATE" --now "$NOW" --dry-run 2>&1); rc=$?
ok "$rc" 0 "S9d: dry-run exits 0"
has "$out" "(dry-run)" "S9d: … and says so"
ok "$(cat "$D/a.md" "$D/ro.md")" "$before" "S9d: a.md and ro.md byte-identical"
if [ ! -e "$TMP/locks-dry/standing-spend.lock" ]; then echo "ok   - S9d: no standing-spend lock taken"; else echo "FAIL - S9d: a standing-spend lock was taken"; fail=1; fi

# S9e: Lachy's bare sign-off logs nothing and never counts
scen s9e
mkro; mkt a gate-pending; gate a "$R30"
before=$(cat "$D/ro.md")
out=$(python3 "$SCRIPT" approve-gates --tasks a --tasks-dir "$D" --date "$DATE" --now "$NOW" 2>&1); rc=$?
ok "$rc|$(cat "$D/ro.md")" "0|$before" "S9e: a bare sign-off leaves ro.md byte-identical"
R200='spend: replicate credits — cap 200 USD'
mkt b gate-pending; gate b "$R200"
HH="$H200" sa b
ok "$rc" 0 "S9e: a later US\$200 gate is signed: the bare sign-off's 30 is not counted"
ok "$(section ro '## Needs-you log')" "$(logl b 200 200 "$R200")" "S9e: … logged at month to date US\$200"

# S9f: push lines and other sections never count; the new line goes inside the log section
scen s9f
mkro; mkt a gate-pending; gate a "$R30"
printf '\n## Needs-you log\n\n%s\n%s\n\n## Completion log\n\n%s\n' \
  '- 2026-10-14T08:00+00:00 [[z]] pushed via push: sign off gated input: spend: probe — cap 190 USD' \
  '- 2026-10-14T08:01+00:00 [[z]] push failed: [[y]] signed under the standing approval: US$190' \
  '- 2026-10-14T08:02+00:00 [[y]] signed under the standing approval: US$190 (month to date US$190 of US$200, file:defaults): spend: q — cap 190 USD' >> "$D/ro.md"
cl=$(section ro '## Completion log')
HH="$H200" sa a
ok "$rc" 0 "S9f: a push line, a quoted mark and a Completion log line are not counted: signed"
ok "$(section ro '## Needs-you log' | tail -1)" "$(logl a 30 30 "$R30")" "S9f: the new line is the log section's last, month to date US\$30"
ok "$(section ro '## Completion log')" "$cl" "S9f: the Completion log is unchanged"

# S9g: an unreadable dated rollout note, or a directory it cannot list, asks (fail closed); an undated note is never
# opened
if [ "$(id -u)" = 0 ]; then
  echo "ok   - S9g: skipped as root (chmod 000 reads anyway)"
else
  scen s9g
  mkro; mkt a gate-pending; gate a "$R30"
  mkdir -p "$D/Archive/Rollouts"
  W="$D/Archive/Rollouts/w-rollout-2026-10-03.md"
  mkarch "$W"; chmod 000 "$W"
  before=$(cat "$D/a.md")
  HH="$H200" sa a
  ok "$rc" 3 "S9g: an unreadable rollout note: exit 3"
  has "$out" "cannot read $W for this month's standing approvals" "S9g: … the ASK names it"
  ok "$(cat "$D/a.md")" "$before" "S9g: a.md byte-identical"
  chmod 644 "$W"
  chmod 000 "$D/Archive/Rollouts"
  before=$(cat "$D/a.md" "$D/ro.md")
  HH="$H200" sa a
  chmod 755 "$D/Archive/Rollouts"
  ok "$rc" 3 "S9g: a directory that exists but cannot be listed: exit 3"
  has "$out" "ASK: a: $R30: cannot read $D/Archive/Rollouts for this month's standing approvals (" "S9g: … the ASK names the directory"
  ok "$(cat "$D/a.md" "$D/ro.md")" "$before" "S9g: a.md and ro.md byte-identical"
  U="$D/z-p1-1-rollout-face.md"
  mkarch "$U" "$DECOY"; chmod 000 "$U"
  HH="$H200" sa a
  ok "$rc" 0 "S9g: an unreadable undated note is never opened: signed"
  chmod 644 "$U"
fi

# S9h: the standing-spend lock is taken; held elsewhere, the call exits 1 and writes nothing for a slug that needed the
# month read, while a later slug that needs none (b, over the per-gate limit) still asks
scen s9h
ORDER=$'- [[a]]\n- [[b]]' mkro; mkt a gate-pending; gate a "$R30"; mkt b gate-pending; gate b "$R250"
mkdir -p "$TMP/locks-held"
python3 -c 'import fcntl, sys, time
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2], "w").close(); time.sleep(60)' \
  "$TMP/locks-held/standing-spend.lock" "$TMP/held" &
HOLDER=$!
for _ in $(seq 100); do [ -e "$TMP/held" ] && break; sleep 0.1; done
before=$(cat "$D/a.md" "$D/b.md" "$D/ro.md")
out=$(THREAD_NOTE_LOCK_DIR="$TMP/locks-held" THREAD_NOTE_LOCK_TIMEOUT=1 HOME="$H200" python3 "$SCRIPT" approve-gates --standing \
  --tasks a,b --rollout "$D/ro.md" --tasks-dir "$D" --date "$DATE" --now "$NOW" 2>&1); rc=$?
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
ok "$rc" 1 "S9h: a held standing-spend lock: exit 1"
has "$out" "ERROR: a: " "S9h: … an ERROR for a, which needed the month read"
has "$out" "standing-spend.lock" "S9h: … naming the lock"
has "$out" "ASK: b: $R250: total exposure US\$250 is over the standing approval's US\$200 (file:defaults)" "S9h: b, after it and needing no month read, still asks"
ok "$(cat "$D/a.md" "$D/b.md" "$D/ro.md")" "$before" "S9h: a.md, b.md and ro.md byte-identical"

# S9i: a task stamp sets its own per-gate limit and its own month line
scen s9i
R120='spend: replicate credits — cap 120 USD'
mkro; mkt a gate-pending 'spend_approval_usd: 300'; gate a "$R120"
printf '\n## Needs-you log\n\n%s\n' \
  '- 2026-10-02T10:00+00:00 [[old1]] signed under the standing approval: US$170 (month to date US$170 of US$200, file:defaults): spend: x — cap 170 USD' >> "$D/ro.md"
HH="$H200" sa a
ok "$rc" 0 "S9i: 170 + 120 is within the task's own US\$300 line: signed"
ok "$(section ro '## Needs-you log' | tail -1)" "$(logl a 120 290 "$R120" 300 task)" "S9i: … logged against the task's line"

# S9j: the live layout. A dated rollout note sits in the tasks dir beside its tasks, so the dir's listing finds it as
# well as --rollout, here given by a second spelling of the same file (`repo/..`: pathlib collapses a `./` but keeps a
# `..`, so only the real path dedupes it): it counts once. Another project's live dated note in the same dir counts;
# an undated note and a task note there, each holding a US$500 standing line this month, never count.
scen s9j
X=x-rollout-2026-10-14; XP="$D/repo/../$X.md"
R60='spend: replicate credits — cap 60 USD'
ORDER=$'- [[a]]\n- [[b]]' mkro; mv "$D/ro.md" "$D/$X.md"
printf '\n## Needs-you log\n\n%s\n' \
  '- 2026-10-03T10:00+00:00 [[x0]] signed under the standing approval: US$100 (month to date US$100 of US$200, file:defaults): spend: x0 — cap 100 USD' >> "$D/$X.md"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Queue\n\n- [[y1]]\n\n## Needs-you log\n\n%s\n' \
  '- 2026-10-04T10:00+00:00 [[y1]] signed under the standing approval: US$40 (month to date US$40 of US$200, file:defaults): spend: y1 — cap 40 USD' \
  > "$D/y-rollout-2026-10-09.md"
mkarch "$D/z-p1-1-rollout-face.md" "$DECOY"
mkt c open; printf '\n## Needs-you log\n\n%s\n' "$DECOY" >> "$D/c.md"
RO=$X mkt a gate-pending; gate a "$R60"
RONOTE="$XP" HH="$H200" sa a
ok "$rc|$(fm a status)" "0|status: in_progress" "S9j: its own note's 100 (listed and named, counted once) + another live note's 40 + 60 lands on the US\$200 line: signed"
ok "$(section "$X" '## Needs-you log' | tail -1)" "$(logl a 60 200 "$R60")" "S9j: … logged in the dated note at month to date US\$200 (neither decoy's US\$500 counted)"
ok "$(section y-rollout-2026-10-09 '## Needs-you log' | wc -l | tr -d ' ')" 1 "S9j: the other project's note is read, never written"
RO=$X mkt b gate-pending; gate b "$P10"
before=$(cat "$D/b.md" "$D/$X.md")
RONOTE="$XP" HH="$H200" sa b
ok "$rc" 3 "S9j: a later call's US\$10 is past the month line: exit 3"
has "$out" "ASK: b: $P10: this month's (2026-10) standing approvals would reach US\$210 with this gate, past the US\$200 month line (file:defaults)" "S9j: … at US\$210, each note still counted once"
ok "$(cat "$D/b.md" "$D/$X.md")" "$before" "S9j: b.md and the rollout note byte-identical across the call"

# ── G1-G4: gate-pricer, the plan judge's pricer path for one call (ADR 0038) ─────────────────────────
GI="$(cd "$HERE/../../_shared/scripts" && pwd -P)/gated_inputs.py"
gp() {  # gp <home> <slugs> — gate-pricer; $out (stdout), $err (stderr), $rc
  local h="$1" t="$2"
  out=$(HOME="$h" python3 "$SCRIPT" gate-pricer --tasks "$t" --rollout "$D/ro.md" --tasks-dir "$D" 2>"$TMP/gp.err"); rc=$?
  err=$(cat "$TMP/gp.err")
}
scen g1
mkro; mkt a open; mkt b in_progress
before=$(cat "$D/ro.md" "$D/a.md" "$D/b.md"); ev=$(events | wc -l | tr -d ' ')
gp "$H50" a,b
ok "$rc|$err" "0|" "G1: exit 0, nothing on stderr"
ok "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" 2 "G1: one JSON line per slug"
ok "$(q "$(printf '%s\n' "$out" | head -1)" '[d["slug"], d["limit"], d["source"], d["why"], sorted(d)]')" '["a",50,"file:defaults","",["gatePricer","limit","slug","source","why"]]' "G1: on at 50 from file:defaults, the keys"
gpath=$(q "$(printf '%s\n' "$out" | head -1)" 'd["gatePricer"]')
ok "$gpath" "\"$GI\"" "G1: gatePricer is the plugin's gated_inputs.py"
case "$GI" in /*/gated_inputs.py) [ -f "$GI" ] && echo "ok   - G1: an absolute path to an existing file" || { echo "FAIL - G1: $GI is no file"; fail=1; } ;; *) echo "FAIL - G1: $GI not absolute"; fail=1 ;; esac
ok "$(cat "$D/ro.md" "$D/a.md" "$D/b.md")|$(events | wc -l | tr -d ' ')" "$before|$ev" "G1: it writes nothing and records nothing"
scen g2
mkro; mkt a open
gp "$HE" a
ok "$rc" 0 "G2: the built-in 0 exits 0"
ok "$(q "$out" '[d["gatePricer"], d["limit"], d["source"], d["why"]]')" '["",0,"built-in","standing approval off (built-in 0)"]' "G2: off, gatePricer \"\""
scen g3
mkro; mkt a open 'spend_approval_usd: 0'
gp "$H50" a
ok "$(q "$out" '[d["gatePricer"], d["limit"], d["source"], d["why"]]')" '["",0,"task","standing approval off (task 0)"]' "G3: a task stamp of 0 turns it off for that task"
scen g4
mkro; mkt a open 'spend_approval_usd: fifty'; mkt b open
gp "$H50" a
ok "$rc|$out" "1|" "G4: a bad stamp exits 1 with no stdout"
has "$err" "ERROR: a: spend_approval_usd on [[a]] must be an integer >= 0" "G4: … and an ERROR line naming it"
gp "$HR" b
ok "$rc|$out" "1|" "G4: a refused rollouts.toml exits 1 with no stdout"
has "$err" "ERROR: b: rollout settings refused" "G4: … and an ERROR line"
sed -i.bak 's/^rollout: .*/rollout: "[[other]]"/' "$D/b.md" && rm -f "$D/b.md.bak"
gp "$H50" b
ok "$rc|$out" "1|" "G4: a task of another rollout exits 1 with no stdout"
has "$err" "its rollout: is" "G4: … naming its rollout"
gp "$H50" nope
ok "$rc|$out" "1|" "G4: a missing note exits 1 with no stdout"

# ── Q1: only gate-pending tasks and their queued dependants remain ───────────────────────────────────
scen q1
ORDER=$'- [[g]]\n- [[d]]\n- [[e]]\n- [[m]]\n- [[x]]' mkro
mkt g gate-pending 'owner: lead-1'; gate g "spend: fast mode — cap US\$50 per Login per month across 3 Logins"
mkt d open 'depends-on: ["[[g]]"]'
mkt m merged 'merged_into: "[[g]]"'
mkt e open 'depends-on: ["[[m]]"]'
mkt x done
J=$(nxt)
ok "$(q "$J" 'd["halt"]')" '"awaiting-sign-off"' "Q1: the verdict is awaiting-sign-off, never stuck"
ok "$(q "$J" 'd["awaitingSignOff"]')" '[{"slug":"g","why":"gate-pending"},{"slug":"d","why":"depends on [[g]]"},{"slug":"e","why":"depends on [[g]]"}]' "Q1: awaitingSignOff names the gate and both dependants (one through a folded member)"

# ── Q2: any other set-aside keeps `stuck` ────────────────────────────────────────────────────────────
scen q2
ORDER=$'- [[g]]\n- [[r]]' mkro
mkt g gate-pending; gate g "$CRED"
mkt r review-blocked 'pr: https://github.com/o/r/pull/9'
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["awaitingSignOff"]]')" '["stuck",[]]' "Q2: gate-pending plus review-blocked is stuck"
mkt r review 'pr: https://github.com/o/r/pull/9'
printf '\n## Race log\n\n- 2026-10-14T08:00+00:00 [[r]] RACE: merged as an unverified combination\n' >> "$D/ro.md"
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["awaitingSignOff"]]')" '["stuck",[]]' "Q2: gate-pending plus a RACE hold is not awaiting sign-off"
ORDER=$'- [[g]]\n- [[r]]' mkro
mkt r blocked
printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-14T08:00+00:00)\n\nUNVERIFIED: the merge was never re-verified\n\n<!-- run 1 end sha=000000000000 -->\n' >> "$D/r.md"
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["awaitingSignOff"], [h["kind"] for h in d["raceHold"]]]')" '["stuck",[],["UNVERIFIED"]]' "Q2: gate-pending plus an UNVERIFIED is not awaiting sign-off"
Q2=$D

# ── Q3: await-sign-off stamps the sign-off pause ─────────────────────────────────────────────────────
D="$TMP/q1"; echo "== q3"
ok "$(python3 "$UNFINISHED" running --tasks-dir "$D")" "running ro" "Q3: before the pause the rollout reads as running (primary hold)"
aso
ok "$rc" 0 "Q3: await-sign-off exits 0"
ok "$(fm ro paused)|$(fm ro paused_for)" "paused: 2026-10-14T09:00+00:00|paused_for: sign-off" "Q3: paused: and paused_for: sign-off"
ok "$(section ro '## Pause log')" "- 2026-10-14T09:00+00:00 awaiting sign-off: [[g]] (gate-pending), [[d]] (depends on [[g]]), [[e]] (depends on [[g]]): sign off, then /thread:execute [[ro]]" "Q3: the Pause log line names every waiting task"
has "$(events)" '"kind":"paused","mode":"sign-off"' "Q3: the Run record holds paused mode=sign-off"
before=$(cat "$D/ro.md")
aso
ok "$rc|$(cat "$D/ro.md")" "0|$before" "Q3: a re-run is a no-op"
has "$out" "[no-change]" "Q3: … and says [no-change]"
ok "$(python3 "$UNFINISHED" running --tasks-dir "$D")" "none" "Q3: afterwards the rollout no longer reads as running"
D="$Q2"
before=$(cat "$D/ro.md")
aso
ok "$rc|$(cat "$D/ro.md")" "1|$before" "Q3: on a stuck rollout it exits 1 and writes nothing"
has "$out" "is not awaiting sign-off" "Q3: … and says why"

# ── Q4: status reports pausedFor ─────────────────────────────────────────────────────────────────────
D="$TMP/q1"; echo "== q4"
ok "$(q "$(st)" '[d["paused"], d["pausedFor"]]')" '["2026-10-14T09:00+00:00","sign-off"]' "Q4: status reports pausedFor sign-off"
scen q4-hard
mkro 'paused: 2026-10-14T08:00+00:00'; mkt a open
ok "$(q "$(st)" 'd["pausedFor"]')" 'null' "Q4: a hard pause has no pausedFor"

# ── Q5: re-entry ──────────────────────────────────────────────────────────────────────────────────────
D="$TMP/q1"; echo "== q5"
before=$(cat "$D/ro.md"); ev=$(events | grep -c '"resumed"')
cpz
ok "$rc|$(cat "$D/ro.md")" "3|$before" "Q5: clear-pause under a sign-off pause with the gate unsigned exits 3, both stamps kept"
ok "$out" "STILL-AWAITING: [[g]]: spend: fast mode — cap US\$50 per Login per month across 3 Logins" "Q5: it prints each pending gate"
ok "$(events | grep -c '"resumed"')" "$ev" "Q5: no resumed is recorded"
out=$(python3 "$SCRIPT" approve-gates --tasks g --tasks-dir "$D" --date "$DATE" --now "$NOW" 2>&1)
cpz
ok "$rc|$(fm ro paused)|$(fm ro paused_for)" "0|<none>|<none>" "Q5: once signed, clear-pause exits 0 and removes both stamps"
has "$(events)" '"resumed"' "Q5: … and records resumed"
J=$(HOME="$HE" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run --running "")
ok "$(q "$J" 'd["restart"]')" '["g"]' "Q5: next --running \"\" restarts the signed task"
scen q5-raise
mkro; mkt g gate-pending; gate g "spend: fast mode — cap US\$50 per Login per month across 3 Logins"
HR2="$TMP/home-raise"; mkdir -p "$HR2/.config/thread"; printf '[defaults]\nspend_approval_usd = 50\n' > "$HR2/.config/thread/rollouts.toml"
HH="$HR2" sa g
ok "$rc" 3 "Q5: at 50 the standing approval asks"
aso
ok "$rc|$(fm ro paused_for)" "0|paused_for: sign-off" "Q5: the sign-off pause stands"
printf '[defaults]\nspend_approval_usd = 200\n' > "$HR2/.config/thread/rollouts.toml"
HH="$HR2" sa g
ok "$rc|$(fm g status)" "0|status: in_progress" "Q5: raised to 200, Reinstate's standing approval signs it"
cpz
ok "$rc|$(fm ro paused)|$(fm ro paused_for)" "0|<none>|<none>" "Q5: then clear-pause clears the sign-off pause"
scen q5-hard
mkro 'paused: 2026-10-14T08:00+00:00'; mkt a open
cpz
ok "$rc|$(fm ro paused)" "0|<none>" "Q5: a hard pause with no paused_for clears exactly as before"
has "$out" "pause cleared" "Q5: … with its message"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-standing: ALL PASS"; else echo "reconcile-rollout-standing: SOME FAILED"; fi
exit "$fail"
