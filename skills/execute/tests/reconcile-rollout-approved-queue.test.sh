#!/usr/bin/env bash
# The approved queue (p30-4; skills/_shared/vault-grammar.md § Approved queue): `approve-queue` writes the hold, the
# `on_merge: regenerate` beside it and the start stamp on Lachy's words; at the gating PR's merge `next` keeps the hold
# standing and reports `halt: regenerate` with the members the route passes to /thread:schedule --regenerate, waits on
# an Integration in flight or a standing room stop, and releases as a plain hold (one WARN line) once the queue has run
# or has nothing of its own left. The Chorus Stage's room stops (step-boundary.py's lines, the one regex) are no run
# mark; Lachy's own pause is. `stamp-start` stamps the new note under the chain, `status` reports onMerge and chainStart,
# and a superseded note's `next` ends quietly (halt superseded). Temp notes, a stub gh; no vault, no network.
#   A0 approve-queue        A1-A2f the verdict (OPEN, MERGED, I8, nothing left, closed, a PR task, an Integration)
#   A3 the chain's script half and the superseded tail      A4-A4f pauses and room stops      A5 an unreadable on_merge
#   A6 stamp-start's refusals      A7 status      A8 no on_merge and mixed case      A9 one room-stop regex
# Usage: bash reconcile-rollout-approved-queue.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
SB="$HERE/../scripts/step-boundary.py"
UR="$HERE/../../_shared/scripts/unfinished-rollout.py"
TPL="$HERE/../../schedule/rollout-template.md"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # away_file
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
NOW=2026-10-02T14:05:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""
X='projects: ["[[X]]"]'
# scen <name>: a fresh tasks dir $D with the Project root ($D/repo), the stub gh ($D/bin/gh) and an empty gh log.
scen() {
  D="$TMP/$1"; mkdir -p "$D/repo" "$D/bin" "$D/gh"; echo "== $1"
  export GHLOG="$D/gh.log" GHDIR="$D/gh"; : > "$GHLOG"
  cat > "$D/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$PWD|$*" >> "$GHLOG"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
case "$1 $2" in
  "pr view") f="$GHDIR/pr-$(key "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1 ;;
esac
echo "unexpected gh call: $*" >&2; exit 2
EOF
  chmod +x "$D/bin/gh"
}
# mkro <name> <body> [frontmatter lines...] — the rollout note $D/<name>.md of project X; <body> follows its Project root.
mkro() {
  local name="$1" body="$2"; shift 2
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n%s\n' "$X"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n%s\n' "$D/repo" "$body"; } > "$D/$name.md"
}
# mkt <slug> <rollout|-> <status|-> [frontmatter lines...] — a task note ("-": no rollout: / no status: line).
mkt() {
  local s="$1" ro="$2" st="$3"; shift 3
  { printf -- '---\ntags: [task]\n'
    [ "$st" = "-" ] || printf 'status: %s\n' "$st"
    [ "$ro" = "-" ] || printf 'rollout: "[[%s]]"\n' "$ro"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
# roomstop <note> start|ended <stamp> — step-boundary.py's exact line forms, appended inside `## Pause log` as its
# begin and end append them (Note.append_line), the section created at the note's end when absent.
roomstop() {
  python3 - "$SCRIPT" "$D/$1.md" "$2" "$3" <<'PY'
import importlib.util, sys
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
n = rr.Note(Path(sys.argv[2]))
line = f"- {sys.argv[4]} room stop: L1 at its 5-hour line; stopping at a step boundary: none; lane: none" \
    if sys.argv[3] == "start" else f"- {sys.argv[4]} room stop ended"
n.append_line("## Pause log", line)
n.save()
PY
}
# prj <ref> <STATE> — the stub gh's answer to `gh pr view <ref>`.
prj() { printf '{"state":"%s","mergedAt":null,"url":"https://github.com/o/r/pull/x"}\n' "$2" > "$D/gh/pr-$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_').json"; }
U=https://github.com/o/r/pull
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }   # fm <note> <key> — the frontmatter line
EH="$TMP/settings-home"; mkdir -p "$EH"; away_file "$EH" 2026-10-02T00:00:00Z   # Away: each rollout runs to its own ceiling
nxt() { local r="$1"; shift; HOME="$EH" python3 "$SCRIPT" next --rollout "$D/$r.md" --tasks-dir "$D" --now "$NOW" --gh-bin "$D/bin/gh" "$@"; }
aq() { HOME="$EH" python3 "$SCRIPT" approve-queue --tasks-dir "$D" "$@"; }
ss() { HOME="$EH" python3 "$SCRIPT" stamp-start --tasks-dir "$D" "$@"; }
st() { HOME="$EH" python3 "$SCRIPT" status --rollout "$D/$1.md" --tasks-dir "$D" --now "$NOW"; }
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
ro_entry='[d["holdUntil"][0][k] for k in ("held", "waits", "cleared")]'
OM='hold_until: {pr: o/r#202, merged: true}'
APPROVED=("$OM" 'on_merge: regenerate')

# ── A0, the writer: approve-queue on a template-shaped note writes the hold, on_merge and the start stamp ──────────────
scen a0
python3 - "$TPL" "$D/ro.md" "$D/repo" <<'PY'
import re, sys
tpl, out, repo = sys.argv[1:]
vals = {"MAX_ITERATIONS": "3", "MAX_REVIEW_ROUNDS": "4", "MAX_PLAN_ROUNDS": "3", "PARALLEL_CEILING": "4", "PROJECT_NAME": "X",
        "DATE": "2026-10-01", "VERIFIER": "make test", "REPO_PATH": repo, "ROLLOUT_SLUG": "ro", "THREAD_LINE": "",
        "QUEUE_TABLE": "| # | Task | Scope | Mode |\n|---|---|---|---|\n| 1 | [[x-p29-1-a\\|x-p29-1-a]] | single-file | Parallel |",
        "QUEUE_RATIONALE": "-", "FILE_SETS": "- x-p29-1-a: a.py", "KNOWN_BASELINE_FAILURES": "none",
        "POST_ROLLOUT_ITEMS": "none"}
text = open(tpl).read()
for k, v in vals.items():
    text = text.replace("{{%s}}" % k, v)
text = re.sub(r"^incomplete: true.*\n", "", text, flags=re.M)   # schedule step 7's last write
open(out, "w").write(text)
PY
mkt x-p29-1-a ro open "$X"
out=$(aq --rollout "$D/ro.md" --pr o/r#202 2>"$D/err"); rc=$?
ok "$rc|$out" "0|undo: remove hold_until, on_merge and start: unattended from [[ro]] before o/r#202 merges, or pause [[ro]] once its lead runs" "A0: exit 0 and exactly one undo line"
ok "$(cat "$D/err")" "" "A0: … nothing on stderr"
ok "$(grep -A2 '^parallel_ceiling:' "$D/ro.md")" "parallel_ceiling: 4
hold_until: {pr: o/r#202, merged: true}
on_merge: regenerate" "A0: the hold after parallel_ceiling:, on_merge right after it"
ok "$(grep -A1 '^status:' "$D/ro.md")" "status: open
start: unattended" "A0: start: unattended just below status:"
cp "$D/ro.md" "$D/ro.once"
out2=$(aq --rollout "$D/ro.md" --pr "$U/202"); rc=$?
ok "$rc|$out2" "0|$out" "A0: a re-run (the PR as its URL) prints the same line"
cmp -s "$D/ro.md" "$D/ro.once"; ok "$?" 0 "A0: … and writes nothing"
mkro ro "" 'started_unattended: 2026-10-02T09:00+00:00'
ok "$(aq --rollout "$D/ro.md" --pr o/r#202)" "undo: remove hold_until and on_merge from [[ro]] before o/r#202 merges, or pause [[ro]] once its lead runs" \
  "A0: with started_unattended: valued the undo line leaves the start stamp out"
ok "$(fm ro start)" "<none>" "A0: … and no start: is written"
# Room stops (R1): the Stage's lines are no run mark, ended or standing; a hard pause's line is.
mkro ro ""; roomstop ro start 2026-10-02T10:00+00:00; roomstop ro ended 2026-10-02T11:00+00:00
aq --rollout "$D/ro.md" --pr o/r#202 >/dev/null; ok "$?" 0 "A0: a note whose Pause log holds only an ended room stop is accepted"
mkro ro ""; roomstop ro start 2026-10-02T10:00+00:00
aq --rollout "$D/ro.md" --pr o/r#202 >/dev/null; ok "$?" 0 "A0: … and one whose room stop still stands"
mkro ro $'## Pause log\n\n- 2026-10-02T10:00+00:00 hard pause: runs wf_a; lane none'
cp "$D/ro.md" "$D/ro.before"
aq --rollout "$D/ro.md" --pr o/r#202 >/dev/null 2>"$D/err"; rc=$?
ok "$rc" 1 "A0: a hard pause's Pause log line is refused"
has "$(cat "$D/err")" "it has run (it has a ## Pause log line that is no room stop)" "A0: … naming why"
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "A0: … and writes nothing"
# Mixed case (R2): `on_merge: Regenerate` is the value; nothing is rewritten.
mkro ro "" 'start: unattended' "$OM" 'on_merge: Regenerate'
cp "$D/ro.md" "$D/ro.before"
aq --rollout "$D/ro.md" --pr o/r#202 >/dev/null; ok "$?" 0 "A0: on_merge: Regenerate is neither refused"
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "A0: … nor rewritten"
# The refusals: exit 1, one ERROR line, the note byte-identical.
refusal() {  # refusal <label> <pr> — on the note as it stands
  cp "$D/ro.md" "$D/ro.before"
  aq --rollout "$D/ro.md" --pr "$2" >"$D/out" 2>"$D/err"; rc=$?
  ok "$rc|$(cat "$D/out")|$(grep -c '^ERROR: approve-queue: ' "$D/err")|$(grep -c . "$D/err")" "1||1|1" "A0: $1 is refused with one ERROR line"
  cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "A0: … $1 writes nothing"
}
mkro ro "" 'shape: serial'; refusal "a serial note" o/r#202
mkro ro "" 'incomplete: true'; refusal "an incomplete note" o/r#202
sed -i.bak 's/^status: open$/status: done/' "$D/ro.md"; refusal "a done note" o/r#202
mkro ro "" 'superseded_by: "[[ro-2]]"'; refusal "a superseded note" o/r#202
mkro ro "" 'paused: 2026-10-02T10:00+00:00'; refusal "a paused note" o/r#202
mkro ro ""; mkt x-p29-1-a ro in_progress "$X" 'owner: lead-1'; refusal "a note whose task carries owner:" o/r#202
mkt x-p29-1-a ro open "$X"
refusal "--pr 7" 7
refusal "--pr nonsense" nonsense
mkro ro "" 'hold_until: {pr: o/r#303}'; refusal "a hold on another PR" o/r#202
mkro ro "" 'hold_until: {pr: o/r#202, merged: false}'; refusal "an unreadable hold" o/r#202
mkro ro "" 'on_merge: rebuild'; refusal "on_merge: rebuild" o/r#202
aq --rollout "$D/ro.md" >/dev/null 2>&1; ok "$?" 2 "A0: a missing --pr is a usage error (exit 2)"

# ── A1: while the PR is OPEN an approved queue holds as any hold does ──────────────────────────────────────────────────
scen a1
mkro ro $'- [[x-p29-1-a]]' "${APPROVED[@]}"
mkt x-p29-1-a ro open "$X"
prj "$U/202" OPEN
J=$(nxt ro)
ok "$(q "$J" '[d["halt"], d["onMerge"], d["supersededBy"], d["start"]]')" '["held",null,null,[]]' "A1: OPEN: halt held, onMerge null, nothing starts"

# ── A2, the Verify: at the merge the hold stays, halt regenerate, with the members ──────────────────────────────────────
scen a2
mkro ro $'- [[x-p29-1-a]]\n- [[x-p29-2-b]]\n- [[x-p29-3-c]]\n- [[x-p29-4-d]]' 'start: unattended' "${APPROVED[@]}"
mkt x-p29-1-a ro open "$X"
mkt x-p29-2-b ro review "$X" "pr: $U/5"            # A2e: a carried review task with a PR
mkt x-p29-3-c ro done "$X"                          # landed: no member
mkt x-p29-4-d ro open                               # a project-less linked task: left out
mkt x-p29-5-e - open "$X"                           # a sibling filed since
mkt x-p290-1-f - open "$X"                          # phase 290, not 29
mkt x-p29.5-1-g - open "$X"                         # phase 29.5, not 29
mkt x-p29-6-h - open "$X" 'tags: [task, decisions]'
sed -i.bak '2d' "$D/x-p29-6-h.md"                   # its own tags: line only
mkro other "" ; mkt x-p29-7-i other open "$X"       # another live rollout's
mkt x-p29-8-j - done "$X"                           # landed
mkt x-p29-9-k - open                                # a project-less sibling
mkt y-p29-1-m - open "$X"                           # another slug
prj "$U/202" MERGED
cp "$D/ro.md" "$D/ro.before"
J=$(nxt ro --dry-run 2>"$D/err")
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "A2: --dry-run leaves the note byte-identical"
J0=$(nxt ro 2>"$D/err")
ok "$(q "$J" '{k: v for k, v in d.items() if k != "startCleared"}')" "$(q "$J0" '{k: v for k, v in d.items() if k != "startCleared"}')" "A2: --dry-run gives the same output"
ok "$(q "$J0" 'd["halt"]')" '"regenerate"' "A2: halt regenerate"
ok "$(q "$J0" "$ro_entry")" '[true,"regenerate",false]' "A2: the entry: held, waits regenerate, not cleared"
ok "$(q "$J0" 'd["onMerge"]')" "{\"action\":\"regenerate\",\"detail\":null,\"members\":[\"x-p29-1-a\",\"x-p29-2-b\",\"x-p29-5-e\"],\"note\":\"ro\",\"pr\":\"o/r#202\",\"successor\":null,\"url\":\"$U/202\",\"why\":null}" \
  "A2: onMerge names the members: the linked rows and the sibling, each of project X"
ok "$(q "$J0" '[d["start"], d["restart"], d["awaitingIntegration"]]')" '[[],[],[]]' "A2e: nothing starts and no Integration starts"
ok "$(q "$J0" '{h["slug"]: h["reason"] for h in d["hold"]}')" '{"x-p29-1-a":"hold until o/r#202 merged: on_merge regenerate","x-p29-4-d":"hold until o/r#202 merged: on_merge regenerate"}' "A2: every queued task holds on the reason"
ok "$(fm ro hold_until)|$(fm ro on_merge)" "$OM|on_merge: regenerate" "A2: the hold and on_merge stay"
ok "$(q "$J0" 'd["startCleared"]')|$(fm ro start)" "true|<none>" "A2: the lead's next still clears P's start stamp"
ok "$(cat "$D/err")" "" "A2: no WARN"
ok "$(python3 - "$SCRIPT" "$UR" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
def load(n, p):
    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
rr, ur = load("rr", sys.argv[1]), load("ur", sys.argv[2])
vals = ['"[[X]]"', "[[Thread Skill]]", "Thread  Skill", '"[[a/b/Thread_Skill|alias]]"', "", "[[--]]", "Animately 2.0"]
print(all(rr._norm_project(v) == ur.norm_project(rr, v) for v in vals))
PY
)" True "A2: _norm_project agrees with unfinished-rollout.py's norm_project"

# ── A2b (I8): the lead died after step 6's carry: P links nothing, N's tasks are the members, regenerate beats empty ──────
scen a2b
mkro ro "" "${APPROVED[@]}"
mkro ro-2 $'- [[x-p29-1-a]]' 'incomplete: true' 'supersedes: "[[ro]]"' "$OM"
mkt x-p29-1-a ro-2 open "$X"
prj "$U/202" MERGED
J=$(nxt ro)
ok "$(q "$J" '[d["halt"], d["onMerge"]["action"], d["onMerge"]["members"], d["onMerge"]["successor"]]')" '["regenerate","regenerate",["x-p29-1-a"],"ro-2"]' \
  "A2b: halt regenerate (not empty), successor ro-2, its task among the members"

# ── A2c: nothing of its own left: released with a WARN and cleared ──────────────────────────────────────────────────────
scen a2c
mkro ro "" "${APPROVED[@]}"
mkt x-p29-5-e - open "$X"
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" '[d["halt"], d["onMerge"]["action"], d["onMerge"]["why"]]')" '["empty","released","nothing of its own left"]' "A2c: released, halt empty"
ok "$(q "$J" "$ro_entry")|$(fm ro hold_until)" "[false,null,true]|<none>" "A2c: … the hold cleared"
ok "$(cat "$D/err")" "WARN: on_merge: regenerate on ro not run: nothing of its own left: released as a plain hold" "A2c: … one WARN line"

# ── A2d: a closed P is a plain release ────────────────────────────────────────────────────────────────────────────────
scen a2d
mkro ro $'- [[x-p29-1-a]]' "${APPROVED[@]}"
sed -i.bak 's/^status: open$/status: dropped/' "$D/ro.md"
mkt x-p29-1-a ro open "$X"
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['onMerge'], $ro_entry]")|$(cat "$D/err")" '[null,[false,null,true]]|' "A2d: status dropped: released and cleared, no onMerge, no WARN"

# ── A2f (R3.1): an Integration begun while the PR was open makes the verdict wait, never read as run ───────────────────
scen a2f
mkro ro $'- [[x-p29-1-a]]\n- [[x-p29-2-b]]' "${APPROVED[@]}"
mkt x-p29-1-a ro open "$X"
mkt x-p29-2-b ro review "$X" "pr: $U/5"
prj "$U/202" OPEN
J=$(nxt ro)
ok "$(q "$J" '[d["halt"], d["awaitingIntegration"]]')" '[null,["x-p29-2-b"]]' "A2f: OPEN: Integration of a task with a PR carries on"
HOME="$EH" python3 "$SCRIPT" mark-integrating --tasks x-p29-2-b --tasks-dir "$D" --now "$NOW" >/dev/null
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['halt'], $ro_entry, d['onMerge']['action'], d['onMerge']['why'], d['onMerge']['detail'], d['integrating']]")" \
  '[null,[true,"integration",false],"waits","an Integration in flight",["x-p29-2-b"],["x-p29-2-b"]]' "A2f: MERGED mid-Integration: the verdict waits, halt null"
ok "$(fm ro hold_until)|$(cat "$D/err")" "$OM|" "A2f: … the hold kept, no WARN"
HOME="$EH" python3 "$SCRIPT" mark-done --tasks x-p29-2-b --tasks-dir "$D" --now "$NOW" >/dev/null
J=$(nxt ro)
ok "$(q "$J" '[d["halt"], d["onMerge"]["members"]]')" '["regenerate",["x-p29-1-a"]]' "A2f: once it merged: halt regenerate"
# A RACE re-verify holds the lane on the task (race_held_lane): the verdict waits too.
mkro ro $'- [[x-p29-1-a]]\n- [[x-p29-2-b]]\n\n## Race log\n\n- 2026-10-02T12:00+00:00 [[x-p29-2-b]] RACE: main moved under the merge' "${APPROVED[@]}"
mkt x-p29-2-b ro review "$X" "pr: $U/5" 'integrating: 2026-10-02T11:00+00:00'
J=$(nxt ro)
ok "$(q "$J" "[d['halt'], $ro_entry, d['onMerge']['why']]")" '[null,[true,"integration",false],"an Integration in flight"]' "A2f: a RACE-held lane waits too"
# A stale integrating: (no Integration in flight: the stamp on a task that no longer reads review with a PR) has run.
mkro ro $'- [[x-p29-1-a]]\n- [[x-p29-2-b]]' "${APPROVED[@]}"
mkt x-p29-2-b ro blocked "$X" 'integrating: 2026-10-02T11:00+00:00'
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" '[d["onMerge"]["action"], d["onMerge"]["why"]]')" '["released","it has run"]' "A2f: a stale integrating: reads as run"
has "$(cat "$D/err")" "it has run (its task x-p29-2-b carries integrating: 2026-10-02T11:00+00:00 with no Integration in flight)" "A2f: … the WARN names it"

# ── A3: the chain's script half: stamp-start, N's first next, and the superseded tail ───────────────────────────────────
scen a3
mkro ro "" "${APPROVED[@]}" 'status_note: x'
sed -i.bak 's/^status: open$/status: done/; s/^status_note: x$/superseded_by: "[[ro-2]]"/' "$D/ro.md"
mkro ro-2 $'- [[x-p29-1-a]]' 'supersedes: "[[ro]]"' "$OM"
mkt x-p29-1-a ro-2 open "$X"
prj "$U/202" MERGED
ok "$(q "$(st ro-2)" 'd["chainStart"]')" '{"pr":"o/r#202","prior":"ro"}' "A3: status flags N's unstamped start (chainStart)"
out=$(ss --rollout "$D/ro-2.md" 2>"$D/err"); rc=$?
ok "$rc|$out" "0|undo: remove start: unattended from [[ro-2]] before the Stage starts it, or pause [[ro-2]] once it runs; it superseded [[ro]] when o/r#202 merged" "A3: stamp-start exits 0 with one undo line"
ok "$(grep -A1 '^status:' "$D/ro-2.md")" "status: open
start: unattended" "A3: … start: unattended just below status:"
ok "$(q "$(st ro-2)" 'd["chainStart"]')" 'null' "A3: … and chainStart clears"
cp "$D/ro-2.md" "$D/ro-2.once"
ok "$(ss --rollout "$D/ro-2.md")" "$out" "A3: a re-run prints the same line"
cmp -s "$D/ro-2.md" "$D/ro-2.once"; ok "$?" 0 "A3: … and writes nothing"
J=$(nxt ro-2 2>"$D/err")
ok "$(q "$J" "[d['start'], d['startCleared'], $ro_entry, d['onMerge']]")|$(fm ro-2 hold_until)" '[["x-p29-1-a"],true,[false,null,true],null]|<none>' \
  "A3: N's first next releases and clears the copied hold and starts its queue"
# The superseded tail: a late tick on P, before and after its move, ends quietly.
EVD="$D/events"; mkdir -p "$EVD"; evsum() { (cd "$EVD" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(cksum < "$f")"; done); }
evsum > "$D/ev.before"
cp "$D/ro.md" "$D/ro.before"
J=$(THREAD_EVENTS_DIR="$EVD" nxt ro 2>"$D/err"); rc=$?
ok "$rc|$(q "$J" '[d["halt"], d["supersededBy"], d["start"], d["holdUntil"], d["onMerge"], d["ceiling"]]')" '0|["superseded","ro-2",[],[],null,null]' "A3: an unmoved superseded P: halt superseded, every other key empty"
ok "$(q "$J" 'list(d)')" "$(q "$(nxt ro-2 --dry-run)" 'list(d)')" "A3: … the same keys, in the same order, as any next"
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "A3: … the note byte-identical"
evsum > "$D/ev.after"; cmp -s "$D/ev.before" "$D/ev.after"; ok "$?" 0 "A3: … no event recorded"
ok "$(grep -c . "$GHLOG")|$(cat "$D/err")" "1|" "A3: … no gh call (the one call is N's), nothing on stderr"
mkdir -p "$D/Archive/Rollouts"; mv "$D/ro.md" "$D/Archive/Rollouts/ro.md"
J=$(THREAD_EVENTS_DIR="$EVD" HOME="$EH" python3 "$SCRIPT" next --rollout "$D/Archive/Rollouts/ro.md" --tasks-dir "$D" --now "$NOW" --gh-bin "$D/bin/gh"); rc=$?
ok "$rc|$(q "$J" '[d["halt"], d["supersededBy"]]')" '0|["superseded","ro-2"]' "A3: a moved one too"
cmp -s "$D/Archive/Rollouts/ro.md" "$D/ro.before"; ok "$?" 0 "A3: … byte-identical"
evsum > "$D/ev.after"; cmp -s "$D/ev.before" "$D/ev.after"; ok "$?" 0 "A3: … no event recorded"
nxt ro >/dev/null 2>&1; ok "$?" 1 "A3: the old path exits 1 (not found)"

# ── A4: his own pause stays a run mark: released as a plain hold, with the WARN line and the clear ─────────────────────
for form in paused hard empty; do
  scen "a4-$form"
  case "$form" in
    paused) mkro ro $'- [[x-p29-1-a]]' "${APPROVED[@]}" 'paused: 2026-10-02T10:00+00:00'; why='it carries paused: 2026-10-02T10:00+00:00' ;;
    hard) mkro ro $'- [[x-p29-1-a]]\n\n## Pause log\n\n- 2026-10-02T10:00+00:00 hard pause: runs none' "${APPROVED[@]}"; why='it has a ## Pause log line that is no room stop' ;;
    empty) mkro ro $'- [[x-p29-1-a]]\n\n## Pause log\n' "${APPROVED[@]}"; why='it has a ## Pause log section' ;;
  esac
  mkt x-p29-1-a ro open "$X"
  prj "$U/202" MERGED
  J=$(nxt ro 2>"$D/err")
  ok "$(q "$J" '[d["onMerge"]["action"], d["onMerge"]["why"], d["onMerge"]["detail"]]')" "[\"released\",\"it has run\",\"$why\"]" "A4: [$form] released: it has run"
  ok "$(cat "$D/err")" "WARN: on_merge: regenerate on ro not run: it has run ($why): released as a plain hold" "A4: [$form] … the WARN line"
  ok "$(q "$J" "$ro_entry")|$(fm ro hold_until)" "[false,null,true]|<none>" "A4: [$form] … the hold cleared"
done

# ── A4b (R1): room stops that ended are no run mark: regenerate, no WARN, the hold kept ─────────────────────────────────
scen a4b
mkro ro $'- [[x-p29-1-a]]' "${APPROVED[@]}"
mkt x-p29-1-a ro open "$X"; mkt x-p29-5-e - open "$X"
roomstop ro start 2026-10-02T10:00+00:00; roomstop ro ended 2026-10-02T11:00+00:00
roomstop ro start 2026-10-02T12:00+00:00; roomstop ro ended 2026-10-02T12:30+00:00
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['halt'], d['onMerge']['action'], d['onMerge']['members'], $ro_entry]")" '["regenerate","regenerate",["x-p29-1-a","x-p29-5-e"],[true,"regenerate",false]]' "A4b: halt regenerate with the members"
hasnt "$(cat "$D/err")" "WARN: on_merge:" "A4b: … no WARN"
ok "$(fm ro hold_until)" "$OM" "A4b: … the hold kept"

# ── A4c (R1): a room stop that still stands makes the verdict wait; once ended, the next next regenerates ───────────────
scen a4c
mkro ro $'- [[x-p29-1-a]]' "${APPROVED[@]}"
mkt x-p29-1-a ro open "$X"
roomstop ro start 2026-10-02T10:00+00:00; roomstop ro ended 2026-10-02T11:00+00:00; roomstop ro start 2026-10-02T13:00+00:00
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['onMerge']['action'], d['onMerge']['why'], d['onMerge']['detail'], $ro_entry, d['halt'], d['start']]")" \
  '["waits","a room stop stands","since 2026-10-02T13:00+00:00",[true,"room-stop",false],"held",[]]' "A4c: the verdict waits, halt held"
ok "$(q "$J" '{h["slug"]: h["reason"] for h in d["hold"]}')" '{"x-p29-1-a":"hold until o/r#202 merged: on_merge regenerate waits for the room stop since 2026-10-02T13:00+00:00 to end"}' "A4c: … the hold reason"
ok "$(fm ro hold_until)|$(cat "$D/err")" "$OM|" "A4c: … the hold kept, no WARN"
HOME="$EH" python3 "$SB" end --rollout "$D/ro.md" >/dev/null
J=$(nxt ro)
ok "$(q "$J" 'd["halt"]')" '"regenerate"' "A4c: after step-boundary.py end the next next regenerates"

# ── A4d-A4f: ended room stops beside his own pause or a task owner: still released ──────────────────────────────────────
for form in paused requested owner; do
  scen "a4-ended-$form"
  extra=(); owner=()
  case "$form" in
    paused) extra=('paused: 2026-10-02T13:00+00:00'); why='it carries paused: 2026-10-02T13:00+00:00' ;;
    requested) extra=('pause_requested: true'); why='it carries pause_requested' ;;
    owner) owner=('owner: lead-1'); why='its task x-p29-1-a carries owner: lead-1' ;;
  esac
  mkro ro $'- [[x-p29-1-a]]' "${APPROVED[@]}" ${extra[@]+"${extra[@]}"}
  mkt x-p29-1-a ro open "$X" ${owner[@]+"${owner[@]}"}
  roomstop ro start 2026-10-02T10:00+00:00; roomstop ro ended 2026-10-02T11:00+00:00
  prj "$U/202" MERGED
  J=$(nxt ro 2>"$D/err")
  ok "$(q "$J" '[d["onMerge"]["action"], d["onMerge"]["detail"]]')" "[\"released\",\"$why\"]" "A4: [ended room stops + $form] released: it has run"
  has "$(cat "$D/err")" "not run: it has run ($why)" "A4: [ended room stops + $form] … the WARN line"
done

# ── A5 (R3.4): an unreadable on_merge waits silently while OPEN and holds on Lachy at the merge ──────────────────────────
scen a5
mkro ro $'- [[x-p29-1-a]]' "$OM" 'on_merge: rebuild'
mkt x-p29-1-a ro open "$X"
prj "$U/202" OPEN
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['halt'], d['holdUntil'][0]['waits'], d['onMerge']]")|$(cat "$D/err")" '["held","merge",null]|' "A5: OPEN: halt held, waits merge, no onMerge, nothing on stderr"
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['halt'], $ro_entry, d['holdUntil'][0]['error'], d['onMerge']]")" '["held",[true,"you",false],"on_merge must be regenerate",null]' "A5: MERGED: held, waits you, its error"
ok "$(q "$J" '{h["slug"]: h["reason"] for h in d["hold"]}')" '{"x-p29-1-a":"hold until: on_merge unreadable (on_merge must be regenerate)"}' "A5: … the unreadable reason"
ok "$(fm ro hold_until)" "$OM" "A5: … the hold kept (fail closed)"

# ── A6: stamp-start's refusals: exit 1, one ERROR line, nothing written ────────────────────────────────────────────────
scen a6
mkro ro "" "${APPROVED[@]}"
sed -i.bak 's/^status: open$/status: done/' "$D/ro.md"
sref() {  # sref <label>
  cp "$D/ro-2.md" "$D/ro-2.before" 2>/dev/null
  ss --rollout "$D/ro-2.md" >"$D/out" 2>"$D/err"; rc=$?
  ok "$rc|$(cat "$D/out")|$(grep -c '^ERROR: stamp-start: ' "$D/err")" "1||1" "A6: $1 is refused with one ERROR line"
  [ -f "$D/ro-2.before" ] && { cmp -s "$D/ro-2.md" "$D/ro-2.before"; ok "$?" 0 "A6: … $1 writes nothing"; }
  rm -f "$D/ro-2.before"
}
sref "a note not found"
mkro ro-2 "" 'shape: serial' 'supersedes: "[[ro]]"'; sref "a serial note"
mkro ro-3 "" ; mkro ro-2 "" 'supersedes: "[[ro-3]]"'; sref "an incomplete note (its prior still open)"; rm "$D/ro-3.md"
mkro ro-2 "" 'supersedes: "[[ro]]"'; sed -i.bak 's/^status: open$/status: dropped/' "$D/ro-2.md"; sref "a closed note"
mkro ro-2 "" 'supersedes: "[[ro]]"' 'superseded_by: "[[ro-4]]"'; sref "a superseded note"
mkro ro-2 "" 'supersedes: "[[ro]]"' 'pause_requested: true'; sref "a paused note"
mkro ro-2 "" 'supersedes: "[[ro]]"'; mkt x-p29-1-a ro-2 in_progress "$X" 'owner: lead-2'; sref "a note that has run"; rm "$D/x-p29-1-a.md"
mkro ro-2 "" 'supersedes: "[[ro]]"' 'started_unattended: 2026-10-02T12:00+00:00'; sref "a note the Stage started"
mkro ro-2 ""; sref "a note that supersedes nothing"

# ── A7: status reports onMerge and chainStart, pure reads ─────────────────────────────────────────────────────────────
scen a7
mkro ro "" "$OM" 'on_merge: "REGENERATE"  # x'
ok "$(q "$(st ro)" 'd["onMerge"]')" '{"error":null,"value":"regenerate"}' "A7: a quoted, upper-case value with a comment reads regenerate"
mkro ro "" "$OM" 'on_merge: rebuild'
ok "$(q "$(st ro)" 'd["onMerge"]')" '{"error":"on_merge must be regenerate","value":"rebuild"}' "A7: a bad value is reported with its error"
mkro ro "" 'on_merge: regenerate'
ok "$(q "$(st ro)" 'd["onMerge"]')" 'null' "A7: no hold: read by nothing (null)"
mkro ro "" 'shape: serial' "$OM" 'on_merge: regenerate'
ok "$(q "$(st ro)" 'd["onMerge"]')" 'null' "A7: a serial note: null"
mkro ro "" "$OM"
ok "$(q "$(st ro)" '[d["onMerge"], d["chainStart"]]')" '[null,null]' "A7: no on_merge, no chain: both null"
ok "$(grep -c . "$GHLOG")" 0 "A7: status makes no gh call"

# ── A8: no on_merge: next is p30-3's, plus the two null keys; a room-stopped plain hold releases; mixed case reads ───────
scen a8
mkro ro $'- [[x-p29-1-a]]' "$OM"
mkt x-p29-1-a ro open "$X"
prj "$U/202" MERGED
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" '[d["onMerge"], d["supersededBy"], d["start"], d["halt"]]')|$(cat "$D/err")" '[null,null,["x-p29-1-a"],null]|' "A8: no on_merge: released, starts, the two keys null"
ok "$(q "$J" 'list(d)[list(d).index("holdUntil") + 1:list(d).index("holdUntil") + 3]')" '["onMerge","supersededBy"]' "A8: … the two keys right after holdUntil"
mkro ro $'- [[x-p29-1-a]]' "$OM"
roomstop ro start 2026-10-02T10:00+00:00; roomstop ro ended 2026-10-02T11:00+00:00
J=$(nxt ro 2>"$D/err")
ok "$(q "$J" "[d['onMerge'], $ro_entry]")|$(cat "$D/err")" '[null,[false,null,true]]|' "A8: a room-stopped plain hold releases and clears, no WARN"
mkro ro $'- [[x-p29-1-a]]' "$OM" 'on_merge: Regenerate'
J=$(nxt ro)
ok "$(q "$J" 'd["halt"]')" '"regenerate"' "A8: on_merge: Regenerate at the merge regenerates (R2)"

# ── A9: step-boundary.py and _approved_marks read one room-stop regex ───────────────────────────────────────────────────
# Identity alone proves nothing for an identical copy (re.compile caches a pattern), so the source must bind RR's too.
scen a9
chk='import importlib.util, re, sys
sys.dont_write_bytecode = True
s = importlib.util.spec_from_file_location("sb", sys.argv[1]); sb = importlib.util.module_from_spec(s); s.loader.exec_module(sb)
assert sb.ROOM_LINE is sb.RR.ROOM_STOP_LINE_RE, "two room-stop regexes"
assert re.search(r"^ROOM_LINE = RR\.ROOM_STOP_LINE_RE$", open(sys.argv[1]).read(), re.M), "a copy of the regex"
print("one")'
ok "$(python3 -c "$chk" "$SB" 2>&1)" "one" "A9: step-boundary's ROOM_LINE is reconcile-rollout's ROOM_STOP_LINE_RE"
mkdir -p "$D/mut"; cp "$SCRIPT" "$D/mut/reconcile-rollout.py"
for form in same drifted; do
  case "$form" in
    same) pat='^- (\\S+) room stop(: | ended\\b)' ;;
    drifted) pat='^- (\\S+) room stop(: | ended)' ;;
  esac
  sed "s/^ROOM_LINE = RR.ROOM_STOP_LINE_RE\$/ROOM_LINE = re.compile(r\"$pat\")/" "$SB" > "$D/mut/step-boundary.py"
  ok "$(grep -c '^ROOM_LINE = re.compile' "$D/mut/step-boundary.py")" 1 "A9: control [$form]: the mutated copy keeps its own regex"
  python3 -c "$chk" "$D/mut/step-boundary.py" >/dev/null 2>&1; ok "$?" 1 "A9: control [$form]: a copy with its own regex fails the check"
done

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-approved-queue: ALL PASS"; else echo "reconcile-rollout-approved-queue: FAILED"; fi
exit "$fail"
