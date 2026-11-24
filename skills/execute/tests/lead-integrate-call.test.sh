#!/usr/bin/env bash
# p55-2 (ADR 0085 d7): the launch args `lead-integrate.py call` builds, pinned beside the other execute suites on a
# hand-written prepare record and a temp vault: no git repo, no gh, no engine. Every reader `call` leans on is driven
# here (reconcile-rollout.py's command reader, _security_check and resolved settings; rollout-settings.py; ladder.py;
# security-check.py's preflight, under a stub gitleaks), so a change to one of them runs this file in the Fast tier.
# What needs a real prepare, origin or the engine stays in tests/lead-integrate.test.sh: C66 (the anchor against
# ANCHOR_RECIPE, the engine's dispatch, --repo's trailing /, the record's `default` fallback) and C67 (a seeded revise's
# whole args, which ask origin for the default branch).
#   F  the launch args, one row per field: task.planGate (off, required and scope-gated, on the task and on the
#      rollout), task.approvedGates, task.ignoreGate, task.rung against the legacy model and effort, the round budgets by
#      level, envBootstrap, and verifySlot, securityCheck and ladder against `verify-timeout` and ladder.py under one HOME.
#   B  the rollout's `## Known baseline failures` block.
#   G  round budgets by level: a task's invalid stamp is budgetError (exit 0, args null; H12 after its row), a rollout's
#      is exit 2.
#   X  the exit 2s, one `refusal` each: nothing printed, the cause named on stderr.
#   P  prUrlError: exit 0, args null.
#   V  --revise's own stops: a note not at resumeAt revise, --after, a history the engine refuses, budgetError and its
#      revise-stopped row.
# Usage: bash lead-integrate-call.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$HERE/../scripts" && pwd -P)"
LI="$SCRIPTS/lead-integrate.py"
RR="$SCRIPTS/reconcile-rollout.py"
LADDER="$(cd "$HERE/../../_shared/scripts" && pwd -P)/ladder.py"
TMP=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record stays in temp
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"                      # and so does the note save lock
# The Security check's preflight asks gitleaks for its version: a stub, so the machine's own is never run or needed.
GLS="$TMP/gitleaks-stub"; printf '#!/bin/sh\necho 8.30.1\n' > "$GLS"; chmod +x "$GLS"; export THREAD_GITLEAKS="$GLS"

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False))' "$2"; }

SLUG=proj-t5
# cfx <name>: a fresh scenario. R is a plain directory (no git) holding only prepare's record, written by hand as the
# trouble route leaves it; V the vault: ro.md (Project root R, verifier `true`) and the task note in review.
cfx() {
  echo "== $1"
  F="$TMP/$1"; R="$F/repo"; V="$F/vault"; WT="$R/.claude/worktrees/$SLUG"; REC="$R/.claude/integration/$SLUG.prepare.json"
  mkdir -p "$R/.claude/integration" "$V" "$F/home"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\nverifier: "true"\n---\n\nProject root: `%s`\n\n## Queue\n\n- [[%s]]\n' "$R" "$SLUG" > "$V/ro.md"
  printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: https://github.com/o/r/pull/5\nready: 2026-10-02T11:00+00:00\nintegrating: 2026-10-02T11:30+00:00\nreview_rounds_used: 1\n---\n\n## Notes\n\nt5\n' > "$V/$SLUG.md"
  python3 - "$REC" "$SLUG" "$WT" <<'PY'
import json, sys
rec, slug, tree = sys.argv[1:]
json.dump({"slug": slug, "default": "master", "branch": "audit-fix/t5", "worktreePath": tree, "route": "trouble", "trouble": [],
           "anchor": "a" * 40, "taskBase": "b" * 40, "mainSha": "c" * 40, "landed": [], "sharedFiles": []}, open(rec, "w"))
PY
  cp "$V/ro.md" "$F/ro.keep"; cp "$V/$SLUG.md" "$F/t.keep"; cp "$REC" "$F/rec.keep"
}
reset() { cp "$F/ro.keep" "$V/ro.md"; cp "$F/t.keep" "$V/$SLUG.md"; cp "$F/rec.keep" "$REC"; }
# setkey <note> <key> <value>: stamp one frontmatter key; tk on the task note, rk on the rollout note.
setkey() {
  python3 - "$1" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
head, rest = t.split("\n---\n", 1)
lines = head.split("\n")
for i, l in enumerate(lines):
    if re.match(rf"^{re.escape(k)}:", l):
        lines[i] = f"{k}: {v}"
        break
else:
    lines.append(f"{k}: {v}")
open(p, "w").write("\n".join(lines) + "\n---\n" + rest)
PY
}
tk() { setkey "$V/$SLUG.md" "$1" "$2"; }
rk() { setkey "$V/ro.md" "$1" "$2"; }
# home <name> <file> <text>: a HOME of its own holding ~/.config/thread/<file>; its path on stdout.
home() { mkdir -p "$F/$1/.config/thread"; printf '%b' "$3" > "$F/$1/.config/thread/$2"; printf '%s' "$F/$1"; }
# call [args…]: `call` for $SLUG (an argument given again, --repo say, wins). Its HOME is CHOME, else the fixture's
# empty one: every call reads the rollout settings and the ladder, and run.sh's shared HOME holds a refused rollouts.toml.
call() { CJ=$(HOME="${CHOME:-$F/home}" python3 "$LI" call --repo "$R" --slug "$SLUG" --note "$V/$SLUG.md" "$@" 2>"$F/call.err"); crc=$?; }
inp() { HOME="$F/home" python3 "$LI" inputs --note "$V/$SLUG.md" "$@"; }
# field <label> <python over d, the printed args> <expected>: one call on the notes as stamped, then the fixture restored.
field() { call; ok "$crc|$([ -n "$CJ" ] && j "$(j "$CJ" 'd["args"]')" "$2")" "0|$3" "F: $1"; reset; }
# refusal <label> <stderr part>: the last call exited 2 with nothing on stdout and its line on stderr; the fixture restored.
refusal() { ok "$crc|$CJ" "2|" "$1 → exit 2, nothing printed"; has "$(cat "$F/call.err")" "$2" "$1: … named"; reset; }
# rejected <rounds text>: the task note as a rejected Integration leaves it (the revise marker, then its rounds).
rejected() {
  setkey "$V/$SLUG.md" status blocked
  printf '\n## Blocker diagnosis\n\nrevise: rejected at Integration re-review — revise on the branch, then re-integrate\n%b\n## Integration log\n\n2026-10-02T12:00+00:00 rejected path=judge-only pr=5 anchor=%s head=%s base=%s wait=60 duration=10 triggers=shared-file active=10\n' \
    "$1" "$(printf '%040d' 0 | tr 0 a)" "$(printf '%040d' 0 | tr 0 d)" "$(printf '%040d' 0 | tr 0 c)" >> "$V/$SLUG.md"
}

# ── F: the launch args' fields ────────────────────────────────────────────────────────────────────
# The engine takes a wrong value for any of these without refusing, so no dispatch check can see one regress.
cfx fields
TASK='[d["task"].get(k) for k in ("planGate", "ignoreGate", "rung", "model", "effort", "approvedGates")]'
field "no stamp: planGate scope-gated on cross-cutting; no ignoreGate, rung, model, effort or approvedGates; no envBootstrap" \
  "$TASK + [\"envBootstrap\" in d]" '[true,null,null,null,null,null,false]'
PG='d["task"]["planGate"]'
tk scope single-file;                                      field "planGate: scope-gated on single-file → false" "$PG" false
tk plan_approval off;                                      field "planGate: off on the task, cross-cutting → false" "$PG" false
tk scope single-file; tk plan_approval required;           field "planGate: required on the task, single-file → true" "$PG" true
tk scope single-file; rk plan_approval required;           field "planGate: required on the rollout, none on the task → true" "$PG" true
rk plan_approval off;                                      field "planGate: off on the rollout, cross-cutting → false" "$PG" false
tk plan_approval scope-gated; rk plan_approval off;        field "planGate: scope-gated on the task over off on the rollout → true" "$PG" true
tk scope single-file; rk plan_approval scope-gated;        field "planGate: scope-gated on the rollout, single-file → false" "$PG" false
printf '\n## Approved gates\n\n- spend: fal.ai renders — cap 5 USD (approved 2026-11-01 by Lachy)\n* credential: the staging token\n\nnot a bullet\n' >> "$V/$SLUG.md"
field "approvedGates: the section's bullets, the marker and the (approved …) annotation stripped" 'd["task"]["approvedGates"]' \
  '["spend: fal.ai renders — cap 5 USD","credential: the staging token"]'
printf '\n## Approved gates\n\n' >> "$V/$SLUG.md"
field "approvedGates: an empty section → [], the key kept" 'd["task"]["approvedGates"]' '[]'
tk ignore_gate true;  field "ignoreGate: ignore_gate: true → true" 'd["task"]["ignoreGate"]' true
tk ignore_gate false; field "ignoreGate: ignore_gate: false → no key" '"ignoreGate" in d["task"]' false
RUNG='[d["task"].get(k) for k in ("rung", "model", "effort")]'
tk rung opus-xhigh; tk model fable; tk effort max; field "rung: a rung name → only the rung, the legacy stamps dropped" "$RUNG" '["opus-xhigh",null,null]'
tk model fable; tk effort max;                    field "rung: none → the task's legacy model and effort" "$RUNG" '[null,"fable","max"]'
rk model opus; rk effort max;                     field "rung: none, model on the rollout → the rollout's model; effort is the task's alone" "$RUNG" '[null,"opus",null]'
tk model fable; rk model opus;                    field "rung: none, model on both → the task's" "$RUNG" '[null,"fable",null]'
BUDGETS='[d["task"][k] for k in ("maxIterations", "maxReviewRounds", "maxPlanRounds")]'
tk max_iterations 2; rk max_iterations 5; rk max_review_rounds 7
CHOME=$(home budgets rollouts.toml '[defaults]\nmax_review_rounds = 6\nmax_plan_rounds = 9\n') field \
  "budgets: the task's stamp, then the rollout's, then the resolved rollouts.toml value" "$BUDGETS" '[2,7,9]'
rk env_bootstrap '"npm ci" # install'; field "envBootstrap: the rollout's env_bootstrap:, through the command reader" 'd["envBootstrap"]' 'npm ci'
# § 4's pre-check compares args.verifySlot and args.securityCheck with this entry's verify-timeout line as JSON, so
# `call` must print what verify-timeout prints under the same HOME; args.ladder is ladder.py's own stdout.
parity() {  # parity <label> <HOME> <expected [verifySlot.slots, securityCheck]>: on the notes as stamped, then restored
  local vt ld a
  vt=$(HOME="$2" python3 "$RR" verify-timeout --rollout "$V/ro.md"); ld=$(HOME="$2" python3 "$LADDER")
  CHOME="$2" call; a=$(j "$CJ" 'd["args"]')
  ok "$crc|$(j "$a" '[d["verifySlot"], d.get("securityCheck")]')|$(j "$a" 'd["ladder"]')" "0|$(j "$vt" '[d["verifySlot"], d.get("securityCheck")]')|$(j "$ld" 'd')" \
    "F: $1: verifySlot and securityCheck are verify-timeout's, ladder is ladder.py's"
  ok "$(j "$a" '[d["verifySlot"]["slots"], d.get("securityCheck")]')" "$3" "F: $1: … and read"; reset
}
parity "no security_checks, no rollouts.toml" "$F/home" '[2,null]'
rk security_checks true
parity "security_checks: true, verify_slots = 3" "$(home slots rollouts.toml '[defaults]\nverify_slots = 3\n')" "[3,{\"script\":\"$SCRIPTS/security-check.py\"}]"

# ── B: the rollout's ## Known baseline failures ───────────────────────────────────────────────────
# Every non-blank line once the template's comment goes; a block reading `none`: no key.
cfx baseline
printf '\n## Known baseline failures\n\n<!-- Machine-readable: one line per failing test: `- <test_id> — <one-line reason>`.\n     Write `none` when clean `main` is fully green. -->\n- test_a — env\ntest_b — flaky dns\n' >> "$V/ro.md"
call; ok "$crc|$(j "$CJ" 'd["args"]["knownBaselineFailures"]')" '0|["test_a — env","test_b — flaky dns"]' "B: the baseline block → its two entries, the bare line kept"
reset; printf '\n## Known baseline failures\n\n<!-- one line per failing test -->\nnone\n' >> "$V/ro.md"
call; ok "$crc|$(j "$CJ" '"knownBaselineFailures" in d["args"]')" "0|false" "B: a block reading none → no key"

# ── G: round budgets by level ─────────────────────────────────────────────────────────────────────
cfx budgets
tk max_iterations 0
call
BE=$(j "$CJ" 'd["budgetError"]')
ok "$crc|$(j "$CJ" 'd["args"]')|$BE" "0|null|invalid round budget: max_iterations on [[$SLUG]] must be an integer >= 1, got '0'" "G: max_iterations: 0 on the task → exit 0, args null, budgetError"
printf '%s' "$BE" | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind integration | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
ok "$(j "$(inp)" 'd["humanFix"]["act"]')" "fix the round budget" "G: its Integration row → humanFix H12"
tk max_iterations 3
ok "$(j "$(inp)" 'd["autoRetryError"]')" "null" "G: … and once the stamp reads 3, no autoRetryError"
reset; rk max_plan_rounds 0
call
ok "$crc|$CJ" "2|" "G: max_plan_rounds: 0 on the rollout, none on the task → exit 2, nothing printed"
has "$(cat "$F/call.err")" "invalid round budget: max_plan_rounds on [[ro]] must be an integer >= 1, got '0'" "G: … naming [[ro]]"
tk max_plan_rounds 2
call
ok "$crc|$(j "$CJ" 'd["args"]["task"]["maxPlanRounds"]')" "0|2" "G: a valid task stamp over an invalid rollout one → the task's value"

# ── X: the exit 2s ────────────────────────────────────────────────────────────────────────────────
cfx refusals
call --repo repo; refusal "X: a --repo that is not absolute" "--repo repo is not an absolute path"
python3 -c 'import sys; p, a, b = sys.argv[1:]; t = open(p).read(); open(p, "w").write(t.replace(a, b))' "$V/ro.md" "Project root: \`$R\`" "Project root: \`$F/p\`"
call; refusal "X: a --repo that is not the rollout's Project root" "is not [[ro]]'s Project root"
python3 -c 'import json, sys; p, t = sys.argv[1:]; d = json.load(open(p)); d["worktreePath"] = t; json.dump(d, open(p, "w"))' "$REC" "$F/elsewhere/$SLUG"
call; refusal "X: a prepare record whose tree is another directory" "the prepare record's worktreePath $F/elsewhere/$SLUG is not $WT"
tk rollout '"[[nowhere]]"'
call; refusal "X: a task whose rollout names no note" "no rollout note for [[$SLUG]]"
tk scope read-only
call; refusal "X: scope: read-only" "[[$SLUG]] is scope: read-only"
grep -v '^verifier:' "$F/ro.keep" > "$V/ro.md"
call; refusal "X: a rollout with no verifier" "[[ro]] has no verifier:"
rk verifier "'make test' now"
call; refusal "X: a verifier the command reader refuses" "[[ro]]: verifier: "
rk env_bootstrap '"npm ci" now'
call; refusal "X: an env_bootstrap the command reader refuses" "[[ro]]: env_bootstrap: "
rk security_checks maybe
call; refusal "X: a refused security_checks value" "security_checks: must be true or false, got 'maybe'"
CHOME=$(home badsettings rollouts.toml '[defaults]\nparallel_ceiling = 0\n') call; refusal "X: a refused rollouts.toml" "rollout settings refused:"
CHOME=$(home badladder ladder.toml 'rungs = "not a table"\n') call; refusal "X: a refused ladder file" "ladder file refused: $F/badladder/.config/thread/ladder.toml"

# ── P: prUrlError ─────────────────────────────────────────────────────────────────────────────────
cfx prurl
tk pr not-a-pr
call
ok "$crc|$(j "$CJ" 'd["args"]')|$([ -n "$(j "$CJ" 'd["prUrlError"]')" ] && echo set)" "0|null|set" "P: pr: not-a-pr → exit 0, args null, prUrlError"

# ── V: --revise's own stops ───────────────────────────────────────────────────────────────────────
# Each comes before `call --revise` asks origin for the default branch, so none needs a repo.
cfx revise
call --revise; refusal "V: --revise on a note at resumeAt own" "reads resumeAt own, not revise"
call --revise --after red
ok "$crc|$CJ" "2|" "V: --revise with --after → usage, exit 2"; has "$(cat "$F/call.err")" "--revise takes no --row or --after" "V: … named"
rejected ''
ok "$(j "$(inp)" '[d["resumeAt"], d["history"]]')" '["revise",[]]' "V: a revise marker with no round → resumeAt revise, an empty history"
call --revise; refusal "V: --revise on a history the engine refuses" "review history must be non-empty, which the engine refuses"
rejected '\nRound 2 (Integration) rejection:\n- keep their rename\n'
tk max_plan_rounds abc
call --revise
BE=$(j "$CJ" 'd["budgetError"]')
ok "$crc|$(j "$CJ" 'd["args"]')|$BE" "0|null|invalid round budget: max_plan_rounds on [[$SLUG]] must be an integer >= 1, got 'abc'" "V: max_plan_rounds: abc → exit 0, args null, budgetError"
printf '%s' "$BE" | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind revise-stopped | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
ok "$(j "$(inp --repo "$R")" '[d["resumeAt"], d["humanFix"]["act"]]')" '["revise","fix the round budget"]' "V: its revise-stopped row keeps resumeAt revise; humanFix H12"

echo
if [ "$fail" -eq 0 ]; then echo "lead-integrate-call: ALL PASS"; else echo "lead-integrate-call: FAILED"; fi
exit "$fail"
