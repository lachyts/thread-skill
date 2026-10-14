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
NOW=2026-10-14T09:00:00Z
DATE=2026-10-14

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

# Settings homes: H50 holds `[defaults] spend_approval_usd = 50`; HE is empty (the built-in 0, off); HR is refused.
H50="$TMP/home50"; mkdir -p "$H50/.config/thread"; printf '[defaults]\nspend_approval_usd = 50\n' > "$H50/.config/thread/rollouts.toml"
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
# mkt <slug> <status|-> [frontmatter lines...] — a task note linked to ro
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\n'
    [ "$st" = "-" ] || printf 'status: %s\n' "$st"
    printf 'rollout: "[[ro]]"\n'
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
sa() {  # sa <slugs> [extra args] — approve-gates --standing; $out (stdout+stderr), $rc
  local t="$1"; shift
  out=$(HOME="$HH" python3 "$SCRIPT" approve-gates --standing --tasks "$t" --rollout "$D/ro.md" --tasks-dir "$D" \
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
