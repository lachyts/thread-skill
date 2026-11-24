#!/usr/bin/env bash
# p55-5 (ADR 0085 d5): what unfinished-rollout.py reads of a Lead hand-over. `waiting`'s `leads` row is the contract the
# Chorus task that opens a handed-over rollout's fresh lead is built against, and `needs-you`'s `hand-over` item is its
# carrier until that task lands. Every state goes through reconcile-rollout.py's own writers: record-entry for the
# lead, `next` at a planted count of 2 (it drains and stamps `paused:` in one call: nothing runs), `stamp-start
# --hand-over` for a listing, `hand-over --manual` for the form off the Stage. One vault: three rollouts of one open
# task each, on one Project root (a plain directory: nothing here runs git).
#   LH1 the leads row, and what is never one   LH2 the needs-you item at 44 and 46 minutes
#   LH3 a fresh lead's entry drops both
# (the key order of `waiting`'s JSON is unfinished-rollout.test.sh's WL1 and the state line `handing over since` its
# LH4; the engine's side is reconcile-rollout-hand-over.test.sh.)
# This suite reads the record, so it keeps its own THREAD_EVENTS_DIR and ignores THREAD_TEST_EVENTS_DIR.
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
unset $(git rev-parse --local-env-vars 2>/dev/null)

HERE="$(cd "$(dirname "$0")" && pwd -P)"
RR="$HERE/../scripts/reconcile-rollout.py"
UR="$HERE/../../_shared/scripts/unfinished-rollout.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
T="$TMP/vault/Work/Tasks"; R="$TMP/repo"
mkdir -p "$HOME" "$T" "$R"
unset CLAUDE_CODE_SESSION_ID CLAUDE_CONFIG_DIR
export THREAD_EVENTS_DIR="$TMP/events"
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export THREAD_MACHINE_TIMES='{}'
export THREAD_HEAT_LEVEL=0

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }

# handover <slug> <session> listed|manual|drained [--gated]: a parallel rollout of one open task, handed over by <session>
handover() {
  local ro=$1 sid=$2 how=$3; shift 3
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nprojects: ["[[Demo]]"]\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[%s-t]]\n' \
    "$R" "$ro" > "$T/$ro.md"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[%s]]"\nprojects: ["[[Demo]]"]\n---\n\n## Notes\n\nA task.\n' "$ro" > "$T/$ro-t.md"
  mkdir -p "$HOME/.config/thread/compactions/$ro"
  printf '{"version": 1, "count": 2, "told": 2}\n' > "$HOME/.config/thread/compactions/$ro/$sid.json"
  CLAUDE_CODE_SESSION_ID=$sid python3 "$RR" record-entry --rollout "$T/$ro.md" --by stage --now 2026-11-08T08:00:00Z >/dev/null
  CLAUDE_CODE_SESSION_ID=$sid python3 "$RR" next --rollout "$T/$ro.md" --tasks-dir "$T" --running "" --now 2026-11-08T09:00:00Z >/dev/null 2>&1
  case $how in
    listed) python3 "$RR" stamp-start --hand-over --rollout "$T/$ro.md" --tasks-dir "$T" --now 2026-11-08T09:01:00Z "$@" >/dev/null ;;
    manual) python3 "$RR" hand-over --manual --rollout "$T/$ro.md" --tasks-dir "$T" --now 2026-11-08T09:01:00Z "$@" >/dev/null ;;
  esac
}
# entry <slug> <session> [by]: a lead's entry at 09:30
entry() { CLAUDE_CODE_SESSION_ID=$2 python3 "$RR" record-entry --rollout "$T/$1.md" --by "${3:-stage}" --now 2026-11-08T09:30:00Z >/dev/null; }
# setfm <slug> <key> <value | ->: set (or, for "-", remove) one frontmatter line
setfm() { python3 - "$T/$1.md" "$2" "$3" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
head, rest = open(p).read().split("\n---\n", 1)
lines = [l for l in head.split("\n") if not re.match(rf"^{re.escape(k)}:", l)]
if v != "-":
    lines.append(f"{k}: {v}")
open(p, "w").write("\n".join(lines) + "\n---\n" + rest)
PY
}
out=""
wl() { out=$(python3 "$UR" waiting --tasks-dir "$T" --now 2026-11-08T10:00:00+00:00 2>"$TMP/err"); }   # the Waiting list
ny() { out=$(python3 "$UR" needs-you --tasks-dir "$T" --now "$1" --gh-bin "$TMP/no-gh" 2>"$TMP/err"); }   # needs-you at <now>
j() { python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$out" "$1"; }
hrows() { j '"\n".join("|".join(str(i[k]) for k in ("kind","source","rollout","task","act","detail")) for i in d["items"] if i["source"] == "hand-over")'; }

echo "== LH1. waiting's leads row, and what is never one"
handover ro-h s-a listed
wl
ok "$(j 'd["leads"]')" "[{'slug': 'ro-h', 'cwd': '$R', 'title': 'Lead hand-over: ro-h', 'prompt': '/thread:execute [[ro-h]]', 'harness': 'claude', 'since': '2026-11-08T09:00+00:00'}]" \
  "LH1: a listed hand-over is a leads row: its Project root, title, prompt, harness and paused:"
with=$(j '{k: v for k, v in d.items() if k != "leads"}')
mv "$T/ro-h.md" "$TMP/ro-h.aside"
wl
ok "$(j '{k: v for k, v in d.items() if k != "leads"}')|$(j 'd["leads"]')" "$with|[]" "LH1: room, running, cap, waiting and next equal the same vault without it"
mv "$TMP/ro-h.aside" "$T/ro-h.md"
for v in "paused_for -|his pause" "paused_for sign-off|a sign-off pause" "paused_for catch-up|a catch-up" "status done|a done note" \
         'superseded_by "[[ro-x]]"|a superseded note'; do
  kv=${v%%|*}; cp "$T/ro-h.md" "$TMP/ro-h.keep"
  setfm ro-h "${kv%% *}" "${kv#* }"; wl
  ok "$(j 'd["leads"]')" "[]" "LH1: not listed under ${v#*|}"
  cp "$TMP/ro-h.keep" "$T/ro-h.md"
done
handover ro-m s-m manual --gated
handover ro-d s-d drained
wl
ok "$(j '[r["slug"] for r in d["leads"]]')" "['ro-h']" "LH1: a manual hand-over and a drained, unhanded one are no leads row"
entry ro-h s-a heartbeat
wl
ok "$(j '[r["slug"] for r in d["leads"]]')" "['ro-h']" "LH1: the handing session's own entry leaves it listed"

echo "== LH2. needs-you's hand-over item: a manual one at once, a listed and a drained one once paused: is 45 min old"
ny 2026-11-08T09:44:00Z
ok "$(hrows)" "hands-on|hand-over|ro-m|None|start a fresh lead in a new session: /thread:execute [[ro-m]] --gated|manual" \
  "LH2: at 44 min only the manual one is listed, its act carrying --gated"
ok "$(j '[i["text"] for i in d["items"] if i["source"] == "hand-over"]')" "['lead handed over at 2026-11-08T09:00+00:00 (compactions): no fresh lead yet']" \
  "LH2: … its text the paused: stamp and the cause"
ny 2026-11-08T09:46:00Z
ok "$(hrows)" "$(printf '%s\n%s\n%s' \
  "hands-on|hand-over|ro-d|None|start a fresh lead in a new session: /thread:execute [[ro-d]]|drained, never handed" \
  "hands-on|hand-over|ro-h|None|start a fresh lead in a new session: /thread:execute [[ro-h]]|listed on the Waiting list, unopened for 46 min" \
  "hands-on|hand-over|ro-m|None|start a fresh lead in a new session: /thread:execute [[ro-m]] --gated|manual")" \
  "LH2: at 46 min the listed and the drained ones too, in rollout order"
ok "$(j 'd["count"]')" 3 "LH2: … counted"

echo "== LH3. a fresh lead's entry opens it: off the leads and the needs-you list (the handing session's, LH1, did not)"
entry ro-h s-b
wl
ok "$(j 'd["leads"]')" "[]" "LH3: a fresh lead's entry drops the leads row"
ny 2026-11-08T09:46:00Z
ok "$(j '[i["rollout"] for i in d["items"] if i["source"] == "hand-over"]')" "['ro-d', 'ro-m']" "LH3: … and its needs-you item"

[ "$fail" -eq 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
