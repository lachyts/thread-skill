#!/usr/bin/env bash
# Durable triggers (p45-7, ADR 0078 d5; skills/_shared/vault-grammar.md § When): `reconcile-rollout.py triggers due`
# lists what is due with no lead and writes nothing, and `triggers fire <id>` runs one and records it, once, as `fired:`
# on the entry itself. Temp notes, a stub gh and a stub refresh; no vault, no network.
#   T1 the first case: a MERGED `{on: merged, do: regenerate}` on an unrun note, no lead      T2 on      T3 do
#   T4 regenerate's gate      T5 where a command runs      T6 no lead: due writes nothing      T7 fire
#   T8 reset-primary, one row per outcome      T9 the forms and the record, read back through PyYAML
#   T10 unreadable, and a good sibling kept      T11 the scan: dropped, archived, the root copy
# Usage: bash reconcile-rollout-triggers.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"                    # the note and trigger locks stay in temp too
NOW=2026-10-02T14:05:00Z
STAMP=2026-10-02T14:05+00:00
PAUSED='paused: 2026-10-01T10:00+00:00'

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

# scen <name>: a fresh vault under $D: the tasks dir $T, the project notes $P, a repo $D/repo, the stub gh and refresh.
scen() {
  D="$TMP/$1"; T="$D/Work/Tasks"; P="$D/Work/Projects"; mkdir -p "$T/Archive/Rollouts" "$P" "$D/repo" "$D/bin" "$D/gh"
  echo "== $1"
  export GHLOG="$D/gh.log" GHDIR="$D/gh" REFRESHLOG="$D/refresh.log" REFRESH_OUT="" REFRESH_RC=0
  : > "$GHLOG"; : > "$REFRESHLOG"
  cat > "$D/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$GHLOG"
f="$GHDIR/$(basename "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1
EOF
  cat > "$D/bin/refresh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$REFRESHLOG"
[ -z "$REFRESH_OUT" ] || printf '%s\n' "$REFRESH_OUT"
exit "$REFRESH_RC"
EOF
  chmod +x "$D/bin/gh" "$D/bin/refresh"
}
# prj <N> <STATE>: the stub gh's answer for PR N of o/r.
prj() { printf '{"state":"%s","mergedAt":null,"url":"https://github.com/o/r/pull/%s"}\n' "$2" "$1" > "$D/gh/$1.json"; }
# ro <name> <frontmatter lines, \n-joined>: a rollout note of project X, its Project root $D/repo (RO_STATUS and
# RO_ROOT, for one call, change its status and root).
ro() {
  printf -- '---\ntags: [task, rollout]\nstatus: %s\nprojects: ["[[X]]"]\n%b\n---\n\n## Notes\n\nProject root: `%s`\n' \
    "${RO_STATUS:-open}" "$2" "${RO_ROOT:-$D/repo}" > "$T/$1.md"
}
# tk <slug> <rollout|-> <status> <frontmatter lines, \n-joined> [body]: a task note of project X ("-": no rollout:).
tk() {
  local link=""; [ "$2" = "-" ] || link="rollout: \"[[$2]]\"\n"
  printf -- "---\ntags: [task]\nstatus: %s\n${link}projects: [\"[[X]]\"]\n%b\n---\n\n## Notes\n\n%s\n" "$3" "$4" "${5:-body}" > "$T/$1.md"
}
# wh <on> <do>: one flow `when:` line.
wh() { printf 'when: {on: "%s", do: "%s"}' "$1" "$2"; }
due() { python3 "$SCRIPT" triggers due --tasks-dir "$T" --gh-bin "$D/bin/gh"; }
fire() { python3 "$SCRIPT" triggers fire "$1" --tasks-dir "$T" --gh-bin "$D/bin/gh" --refresh-bin "$D/bin/refresh" --now "$NOW"; }
# rows: `due`'s JSON (kept in $D/due.json), one row a line in $D/rows: note, bucket, do, id, detail, tab-separated. Detail
# is a due row's kind, command and projectRoot; a waiting row's why; an unreadable row's error.
rows() {
  due > "$D/due.json"
  python3 - "$D/due.json" > "$D/rows" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for r in d["due"]:
    print("\t".join([r["note"], "due", r["do"], r["id"], f'{r["kind"]} {r["command"]} {r["projectRoot"]}']))
for r in d["waiting"]:
    print("\t".join([r["note"], "waiting", r["do"], r["id"], r["why"]]))
for r in d["unreadable"]:
    print("\t".join([r["note"], "unreadable", "-", "-", r["error"]]))
PY
}
# row <note> [do]: the note's first row (with [do], its first row reading exactly that do), else "none".
row() { awk -F'\t' -v n="$1" -v d="${2:-}" '$1 == n && (d == "" || $3 == d) { print; found = 1; exit } END { if (!found) print "none" }' "$D/rows"; }
bucket() { row "$@" | cut -f2; }
idof() { row "$@" | cut -f4; }
# table: lines of `note|bucket|substring of the row's detail[|do]` on stdin; each is one assertion on $D/rows.
table() {
  local note want sub do got
  while IFS='|' read -r note want sub do; do
    [ -n "$note" ] || continue
    got="$(row "$note" "$do")"
    ok "$(printf '%s' "$got" | cut -f2)" "$want" "$note ${do:+($do) }is $want"
    has "$(printf '%s' "$got" | cut -f5)" "$sub" "$note ${do:+($do) }detail"
  done
}
hash() { (cd "$T" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) | shasum -a 256; }
GOOD_ON="merged o/r#1"

# ---- T1: the first case --------------------------------------------------------------------------------------------
scen first; prj 1 MERGED
ro r "$(wh "$GOOD_ON" regenerate)"
rows
table <<EOF
r|due|command /thread:schedule [[X]] --regenerate $D/repo
EOF

# ---- T2: on, through the existing readers (do is reset-primary: no gate, no root) -----------------------------------
scen on; prj 1 MERGED; prj 2 OPEN; prj 3 CLOSED   # PR 4: no answer, a gh error
tk m1 - open "$(wh "merged o/r#1" reset-primary)"
tk m1b - open "$(wh "merged https://github.com/o/r/pull/1" reset-primary)"
tk m2 - open "$(wh "merged o/r#2" reset-primary)"
tk m3 - open "$(wh "merged o/r#3" reset-primary)"
tk m4 - open "$(wh "merged o/r#4" reset-primary)"
ro p1 "$PAUSED\n$(wh paused reset-primary)"
ro p2 "pause_requested: true\n$(wh paused reset-primary)"
ro p3 "$(wh paused reset-primary)"
printf '\n## Pause log\n\n- 2026-10-01T10:00+00:00 room stop: L1 at its line; stopping at a step boundary: none; lane: none\n' >> "$T/p3.md"
tk p4 p1 open "$(wh paused reset-primary)"
tk p5 p1 done "$(wh paused reset-primary)"
tk p6 p2 open "$(wh paused reset-primary)"
ro p7 "$PAUSED\npaused_for: sign-off\n$(wh paused reset-primary)"
ro p8 "$PAUSED\nsuperseded_by: \"[[p1]]\"\n$(wh paused reset-primary)"
RO_STATUS=done ro p9 "$PAUSED\n$(wh paused reset-primary)"
tk p10 - done "$PAUSED\n$(wh paused reset-primary)"
tk d1 - done ""; tk o1 - open ""; tk unit - done ""
tk mem - merged 'merged_into: "[[unit]]"'
printf -- '---\ntags: [task]\nstatus: done\n---\n' > "$T/Archive/arch.md"
tk l1 - open "$(wh "landed [[d1]]" reset-primary)"
tk l2 - open "$(wh "landed [[o1]]" reset-primary)"
tk l3 - open "$(wh "landed [[mem]]" reset-primary)"
tk l4 - open "$(wh "landed [[arch]]" reset-primary)"
tk l5 - open "$(wh "landed [[nope]]" reset-primary)"
rows
table <<'EOF'
m1|due|script
m1b|due|script
m2|waiting|OPEN
m3|waiting|CLOSED
m4|waiting|no PR
p1|due|script
p2|waiting|not paused
p3|waiting|not paused
p4|due|script
p5|due|script
p6|waiting|not paused
p7|due|script
p8|waiting|closed
p9|waiting|closed
p10|waiting|closed
l1|due|script
l2|waiting|open
l3|due|script
l4|due|script
l5|waiting|not found
EOF
ok "$(grep -c 'pull/1 ' "$GHLOG")" 1 "two triggers on one PR make one gh call"

# ---- T3: do, each verb's kind and exact command -----------------------------------------------------------------------
scen do; prj 1 MERGED
tk a dr open ""; tk b dr open ""; tk c - done ""; tk e - dropped ""
ro dr "$PAUSED\nwhen:\n  - {on: \"$GOOD_ON\", do: regenerate}
  - {on: \"$GOOD_ON\", do: \"regenerate --tasks a,[[b]]\"}\n  - {on: \"$GOOD_ON\", do: \"schedule [[a]]\"}
  - {on: \"$GOOD_ON\", do: reset-primary}\n  - {on: \"$GOOD_ON\", do: \"schedule [[nope]]\"}
  - {on: \"$GOOD_ON\", do: \"regenerate --tasks c,e\"}\n  - {on: \"$GOOD_ON\", do: \"regenerate --tasks a,c\"}"
rows
table <<EOF
dr|due|command /thread:schedule [[X]] --regenerate $D/repo|regenerate
dr|due|command /thread:schedule --regenerate --tasks a,b $D/repo|regenerate --tasks a,[[b]]
dr|due|command /thread:schedule --tasks a $D/repo|schedule [[a]]
dr|due|script None None|reset-primary
dr|waiting|not found|schedule [[nope]]
dr|waiting|nothing left to schedule|regenerate --tasks c,e
dr|due|command /thread:schedule --regenerate --tasks a,c $D/repo|regenerate --tasks a,c
EOF
hasnt "$(cat "$D/due.json")" "Under the chain" "no command claims an approved queue's chain"

# ---- T4: regenerate's gate (each note also carries a schedule that a closed note still fires) ------------------------
scen gate; prj 1 MERGED
tk u - open "" 'Project root: `'"$D/repo"'`'
two() { printf 'when:\n  - {on: "%s", do: regenerate}\n  - {on: "%s", do: "schedule [[u]]"}' "$GOOD_ON" "$GOOD_ON"; }
ro g-paused "$PAUSED\n$(two)"
ro g-unrun "$(two)"
ro g-run "$(two)"; tk g-run-t g-run open "owner: lead-1"
RO_STATUS=done ro g-done "$(two)"
ro g-new "supersedes: \"[[g-sup]]\"\n$(two)"; ro g-sup "superseded_by: \"[[g-new]]\"\n$(two)"
RO_STATUS=done ro g-arch "superseded_by: \"[[g-new]]\"\n$(two)"; mv "$T/g-arch.md" "$T/Archive/Rollouts/g-arch.md"
tk t-open g-paused open "$(two)"
tk t-done g-paused done "$(two)"
tk t-none - open "$(two)"
tk t-carried g-new open "$(two)"
RO_STATUS=done ro g-nogh "$(wh "merged o/r#5" regenerate)"
rows
ok "$(grep -c 'pull/5 ' "$GHLOG")" 0 "an entry that cannot fire makes no gh call"
table <<EOF
g-paused|due|/thread:schedule [[X]] --regenerate|regenerate
g-unrun|due|/thread:schedule [[X]] --regenerate|regenerate
g-run|waiting|running: schedule refuses a regenerate|regenerate
g-done|waiting|closed: nothing to regenerate|regenerate
g-done|due|/thread:schedule --tasks u|schedule [[u]]
g-sup|waiting|superseded by [[g-new]]|regenerate
g-sup|due|/thread:schedule --tasks u|schedule [[u]]
g-arch|waiting|superseded by [[g-new]]|regenerate
g-arch|due|/thread:schedule --tasks u|schedule [[u]]
t-open|due|/thread:schedule [[X]] --regenerate $D/repo|regenerate
t-done|due|/thread:schedule [[X]] --regenerate $D/repo|regenerate
t-none|waiting|no rollout to regenerate|regenerate
t-none|due|/thread:schedule --tasks u|schedule [[u]]
g-new|due|/thread:schedule [[X]] --regenerate $D/repo|regenerate
t-carried|waiting|[[g-new]] superseded a rollout|regenerate
t-carried|due|/thread:schedule --tasks u|schedule [[u]]
EOF
before="$(cat "$T/g-sup.md" "$T/g-new.md" | shasum -a 256)"
out="$(fire "$(idof g-sup regenerate)" 2>&1)"; ok "$?" 1 "fire on a superseded note exits 1"
has "$out" "superseded by [[g-new]]" "and says why"
ok "$(cat "$T/g-sup.md" "$T/g-new.md" | shasum -a 256)" "$before" "the superseded note and its successor are byte-identical"

# ---- T5: where a command runs --------------------------------------------------------------------------------------
scen root; prj 1 MERGED; mkdir -p "$D/repo2" "$D/repo3" "$D/repoU" "$P/Archive"
printf -- '---\ntags: [project]\n---\n\nNo local line here.\n' > "$P/First.md"
printf -- '---\ntags: [project]\n---\n\nLocal: `%s`\n' "$D/repo3" > "$P/Second.md"
printf -- '---\ntags: [project]\n---\n\nLocal: `%s/wrong`\n' "$D" > "$P/Archive/Second.md"
ro r-own "$PAUSED\n$(wh "$GOOD_ON" regenerate)"
RO_ROOT="$D/repo2" ro r-two "$PAUSED"
tk t-link r-two open "$(wh "$GOOD_ON" regenerate)"
tgt() { printf -- '---\ntags: [task]\nstatus: open\nprojects: [%s]\n%s---\n\n## Notes\n\n%s\n' "$2" "${3:-}" "${4:-body}" > "$T/$1.md"; }
tgt u-local '"[[First]]", "[[Second]]"'
tk t-local - open "$(wh "$GOOD_ON" "schedule [[u-local]]")"
tgt u-own '"[[First]]"' "" 'Project root: `'"$D/repoU"'`'
ro r-three "$PAUSED\n$(wh "$GOOD_ON" "schedule [[u-own]]")"
tgt u-none '"[[First]]"'
tk t-none - open "$(wh "$GOOD_ON" "schedule [[u-none]]")"
tgt u-dead '"[[Second]]"' $'rollout: "[[r-own]]"\n' 'Project root: `'"$D/gone"'`'
tk t-dead - open "$(wh "$GOOD_ON" "schedule [[u-dead]]")"
rows
table <<EOF
r-own|due|/thread:schedule [[X]] --regenerate $D/repo
t-link|due|/thread:schedule [[X]] --regenerate $D/repo2
t-local|due|/thread:schedule --tasks u-local $D/repo3
r-three|due|/thread:schedule --tasks u-own $D/repoU
t-none|waiting|no Project root: add a Local: line to [[First]]
t-dead|waiting|$D/gone is not a directory
EOF
for n in t-none t-dead; do
  before="$(shasum -a 256 < "$T/$n.md")"; fire "$(idof $n)" >/dev/null 2>&1; ok "$?" 1 "fire on $n exits 1"
  ok "$(shasum -a 256 < "$T/$n.md")" "$before" "$n spends no fired:"
done

# ---- T6: no lead, and due writes nothing ------------------------------------------------------------------------------
scen nolead; prj 1 MERGED
ro r "$(wh "$GOOD_ON" regenerate)"
before="$(hash)"; due >/dev/null; ok "$?" 0 "due exits 0 with no lead"
ok "$(hash)" "$before" "due leaves the tasks dir byte-identical"
[ -e "$THREAD_EVENTS_DIR" ]; ok "$?" 1 "due writes no Run record"
python3 "$SCRIPT" triggers due --tasks-dir "$D/nowhere" >/dev/null 2>&1; ok "$?" 1 "a missing tasks dir exits 1"

# ---- T7: fire ------------------------------------------------------------------------------------------------------
scen fire; prj 1 MERGED; prj 2 OPEN
ro r "$(wh "$GOOD_ON" regenerate)"; ro s "$(wh "$GOOD_ON" reset-primary)"; ro w "$(wh "merged o/r#2" regenerate)"
ro par "$(wh "$GOOD_ON" regenerate)"
rows; id="$(idof r)"
first="$(fire "$id")"; ok "$?" 0 "fire exits 0"
has "$first" '"fresh": true' "the first fire is fresh"
has "$first" '"command": "/thread:schedule [[X]] --regenerate"' "and hands the command back"
has "$(grep '^when:' "$T/r.md")" "fired: \"$STAMP\"" "fired: is recorded on the entry"
saved="$(shasum -a 256 < "$T/r.md")"
second="$(fire "$id")"; ok "$?" 0 "a second fire exits 0"
has "$second" '"fresh": false' "and is not fresh"
ok "$(shasum -a 256 < "$T/r.md")" "$saved" "the second fire writes nothing"
rows; ok "$(bucket r)" none "a fired entry is no longer listed"
ok "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["fired"])' "$D/due.json")" 1 "due counts it fired"
export REFRESH_OUT="2026-10-02T14:05:00+00:00 primary-refresh /tmp/repo: current"
sid="$(idof s)"; fire "$sid" >/dev/null; fire "$sid" >/dev/null
ok "$(wc -l < "$REFRESHLOG" | tr -d ' ')" 1 "a second fire does not run the script step again"
has "$(cat "$REFRESHLOG")" "run" "the script step runs primary-refresh's run"
before="$(hash)"
out="$(fire "$(idof w)" 2>&1)"; ok "$?" 1 "a trigger not due exits 1"; has "$out" "not due" "and says so"
out="$(fire deadbeef0000 2>&1)"; ok "$?" 1 "an unknown id exits 1"; has "$out" "unknown" "and says so"
ok "$(hash)" "$before" "neither writes anything"
rows; pid="$(idof par)"
fire "$pid" > "$D/par1" & p1=$!; fire "$pid" > "$D/par2" & p2=$!; wait "$p1"; wait "$p2"
ok "$(cat "$D/par1" "$D/par2" | grep -c '"fresh": true')" 1 "two parallel fires give exactly one fresh"
ok "$(grep -o 'fired:' "$T/par.md" | wc -l | tr -d ' ')" 1 "and one fired:"

# ---- T8: reset-primary, one row per outcome (R recorded, N not recorded and still due) -----------------------------------
scen reset
LINE="2026-10-02T14:05:00+00:00 primary-refresh /tmp/my repo:"
while IFS='~' read -r verdict rc output; do
  [ -n "$verdict" ] || continue
  tk k - open "$(wh paused reset-primary)\n$PAUSED"
  id="$(python3 "$SCRIPT" triggers due --tasks-dir "$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["due"][0]["id"])')"
  export REFRESH_RC="$rc" REFRESH_OUT="$(printf '%b' "$output" | sed "s#^@ #$LINE #")"
  before="$(shasum -a 256 < "$T/k.md")"
  out="$(fire "$id" 2>/dev/null)"; rc2=$?
  if [ "$verdict" = R ]; then
    ok "$rc2" 0 "recorded: $output"
    has "$(cat "$T/k.md")" "fired: \"$STAMP\"" "fired: written for: $output"
    want="$(printf '%b' "$output" | tail -1 | sed 's/^@ //')"   # the last line: a self-update line comes first
    has "$out" "\"outcome\": \"$want\"" "and the outcome shown: $want"
  else
    ok "$rc2" 1 "not recorded: $output (rc $rc)"
    ok "$(shasum -a 256 < "$T/k.md")" "$before" "nothing written for: $output"
  fi
done <<'EOF'
R~0~@ current
R~0~@ ahead 2: left to its landing route
R~0~@ moved aaaaaaaaaaaa..bbbbbbbbbbbb (3 commits)
R~0~@ diverged (ahead 1, behind 2): never integrated here
R~0~@ held: a rollout runs
R~0~@ refused: local changes overlap origin/main (x)
R~0~@ self-update: would install it\n@ current
N~0~@ busy: a rebase is in progress
N~0~@ not a primary checkout: a linked worktree
N~0~@ fetch failed: no route
N~0~@ broken: live-checkout.sh default: exit 1
N~0~@ unreadable: an unborn HEAD
N~0~@ timed out: git merge --ff-only ran past 600 s and was stopped
N~0~
N~0~@ a new outcome
N~0~@ self-update: current
N~1~@ current
EOF

# ---- T9: the forms and the record: fire on each form, read back through PyYAML, golden lines ----------------------------
scen forms; prj 1 MERGED; prj 2 MERGED
python3 - "$SCRIPT" "$D" "$NOW" "$STAMP" <<'PY' || fail=1
import importlib.util, json, pathlib, subprocess, sys
try:
    import yaml
except ImportError:
    sys.exit("PyYAML is missing: python3 -m pip install pyyaml")
sys.dont_write_bytecode = True
script, base, now, stamp = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3], sys.argv[4]
spec = importlib.util.spec_from_file_location("rr", script); rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
A, B = "merged o/r#1", "merged o/r#2"
F = f'fired: "{stamp}"'
# Each row: name, when: block, the entry fired (the `on`), the block after it.
SINGLE = [
    ("flow", f'when: {{on: "{A}", do: regenerate}}', f'when: {{on: "{A}", do: regenerate, {F}}}'),
    ("flow-comment", f'when: {{on: "{A}", do: regenerate}}  # keep me', f'when: {{on: "{A}", do: regenerate, {F}}}  # keep me'),
    ("flow-multiline", f'when: {{on: "{A}",\n  do: regenerate}}', f'when: {{on: "{A}",\n  do: regenerate, {F}}}'),
    ("block-mapping", f'when:\n  on: {A}\n  do: regenerate', f'when:\n  on: {A}\n  do: regenerate\n  {F}'),
    ("flow-item", f'when:\n  - {{on: "{A}", do: regenerate}}', f'when:\n  - {{on: "{A}", do: regenerate, {F}}}'),
    ("block-item", f'when:\n  - on: {A}\n    do: regenerate', f'when:\n  - on: {A}\n    do: regenerate\n    {F}'),
    ("wide-dash", f'when:\n  -   on: {A}\n      do: regenerate', f'when:\n  -   on: {A}\n      do: regenerate\n      {F}'),
    ("flow-item-col0", f'when:\n- {{on: "{A}", do: regenerate}}', f'when:\n- {{on: "{A}", do: regenerate, {F}}}'),
    ("block-item-col0", f'when:\n- on: {A}\n  do: regenerate', f'when:\n- on: {A}\n  do: regenerate\n  {F}'),
    ("block-item-gap", f'when:\n  - on: {A}\n\n# keep\n    do: regenerate', f'when:\n  - on: {A}\n\n# keep\n    do: regenerate\n    {F}'),
    ("flow-close-alone", f'when: {{on: "{A}",\n  do: regenerate\n  }}', f'when: {{on: "{A}",\n  do: regenerate\n  , {F} }}'),
    ("flow-close-after-comma", f'when: {{on: "{A}",\n  do: regenerate,\n  }}', f'when: {{on: "{A}",\n  do: regenerate,\n   {F} }}'),
]
# Mixed siblings at both dash columns, firing each one.
def mixed(dash):
    return (f'when:\n{dash}- {{on: "{A}", do: regenerate}}\n{dash}- on: {B}\n{dash}  do: regenerate',
            (f'when:\n{dash}- {{on: "{A}", do: regenerate, {F}}}\n{dash}- on: {B}\n{dash}  do: regenerate',
             f'when:\n{dash}- {{on: "{A}", do: regenerate}}\n{dash}- on: {B}\n{dash}  do: regenerate\n{dash}  {F}'))
TEMPLATE = '---\ntags: [task, rollout]\nstatus: open\nprojects: ["[[X]]"]\npaused: 2026-10-01T10:00+00:00\n{w}\nnext_key: 1\n---\n\n## Notes\n\nProject root: `{repo}`\n\nbody\n'
bad = 0
def check(cond, label, extra=""):
    global bad
    print(("ok   - " if cond else "FAIL - ") + label + ("" if cond else f": {extra}"))
    bad += 0 if cond else 1
def run(*a):
    return subprocess.run([sys.executable, script, "triggers", *a], capture_output=True, text=True)
ids = set()
cases = [(n, b, A, a) for n, b, a in SINGLE]
for dash in ("", "  "):
    before, afters = mixed(dash)
    for on, after in zip((A, B), afters):
        cases.append((f"mixed{len(dash)}-{'flow' if on == A else 'block'}", before, on, after))
for name, before, on, after in cases:
    d = base / name
    t = d / "Work" / "Tasks"; t.mkdir(parents=True); repo = d / "repo"; repo.mkdir()
    path = t / "r.md"
    path.write_text(TEMPLATE.format(w=before, repo=repo))
    due = json.loads(run("due", "--tasks-dir", str(t), "--gh-bin", str(base / "bin" / "gh")).stdout)
    row = next((r for r in due["due"] if r["on"] == on), None)
    check(row is not None, f"{name}: the form reads", json.dumps(due))
    if row is None:
        continue
    if not name.startswith("mixed"):
        ids.add(row["id"])
    fired = run("fire", row["id"], "--tasks-dir", str(t), "--gh-bin", str(base / "bin" / "gh"), "--now", now)
    check(fired.returncode == 0 and json.loads(fired.stdout)["fresh"] is True, f"{name}: fire is fresh", fired.stderr)
    got = path.read_text()
    check(got == TEMPLATE.format(w=after, repo=repo), f"{name}: only the record changed", got)
    fm = yaml.safe_load(got.split("---\n")[1])
    entries = fm["when"] if isinstance(fm["when"], list) else [fm["when"]]
    entry = next(e for e in entries if e[True] == on)     # YAML 1.1 reads the key `on` as true
    check(entry.get("fired") == stamp, f"{name}: the YAML loads and the entry holds fired", got)
check(len(ids) == 1, "the forms give one id", str(ids))

# A trigger id is stable when a sibling moves, and unchanged by fired.
check(rr._trigger_id("R", "paused", "reset-primary") == rr._trigger_id("r", "paused", "reset-primary"),
      "the id reads the note's stem lower-cased")

# The record under Note.save's replay: a line another writer added lands, and the entry it moved is still the one marked.
note_path = base / "replay.md"
text = TEMPLATE.format(w=f'when:\n  - {{on: "{A}", do: regenerate}}\n  - on: {B}\n    do: regenerate', repo="/x")
note_path.write_text(text)
note = rr.Note(note_path)
tid = next(e["id"] for e in rr._when(note) if e["on"] == B)
note.apply(rr._mark_fired, tid, stamp)
note_path.write_text(text.replace("next_key: 1", "next_key: 1\nadded: 2").replace("tags: [task, rollout]\n", "tags: [task, rollout]\nmoved: 1\n"))
note.save()
got = note_path.read_text()
check("added: 2" in got and f"    do: regenerate\n    {F}" in got and rr._when(rr.Note(note_path))[1]["fired"] == stamp,
      "a concurrent save: the replay marks the entry in the fresh text", got)
gone = base / "gone.md"
text = TEMPLATE.format(w=f'when:\n  - on: {B}\n    do: regenerate', repo="/x")
gone.write_text(text)
note = rr.Note(gone)
tid = rr._when(note)[0]["id"]
note.apply(rr._mark_fired, tid, stamp)
gone.write_text(TEMPLATE.format(w=f'when:\n  - on: {A}\n    do: regenerate', repo="/x"))
note.save()
check("fired" not in gone.read_text() and not any(e["fired"] for e in rr._when(note)),
      "an entry removed meanwhile is a no-op, and reads unfired")
sys.exit(1 if bad else 0)
PY

# ---- T10: unreadable, never due, and a good sibling kept ------------------------------------------------------------------
scen unread; prj 1 MERGED
list_of() { printf 'when:\n  - %s\n  - {on: "%s", do: reset-primary}' "$1" "$GOOD_ON"; }
OPEN_ON="merged o/r#1"
bad() { tk "$1" - open "$(list_of "$2")"; }
bad u-key '{on: "merged o/r#7", do: reset-primary, x: 1}'
bad u-nodo '{on: "merged o/r#7"}'
bad u-onverb '{on: "exploded o/r#7", do: reset-primary}'
bad u-doverb '{on: "merged o/r#7", do: explode}'
bad u-bare '{on: "merged 12", do: reset-primary}'
bad u-foo '{on: "merged o/r#7", do: "regenerate --foo"}'
bad u-dup "{on: \"$OPEN_ON\", do: reset-primary}"
bad u-emptyf '{on: "merged o/r#7", do: reset-primary, fired: ""}'
bad u-nullf '{on: "merged o/r#7", do: reset-primary, fired: null}'
bad u-comma '{on: "merged o/r#7", do: regenerate --tasks a,b}'
bad u-link '{on: "merged o/r#7", do: schedule [[a]]}'
bad u-offcol 'on: merged o/r#7\n      do: reset-primary'
bad u-dupkey '{on: "merged o/r#7", on: "merged o/r#8", do: reset-primary}'
bad u-item 'soon'
bad u-emptyi ''
bad u-pausedx '{on: "paused x", do: reset-primary}'
bad u-resetx '{on: "merged o/r#7", do: "reset-primary x"}'
bad u-heading '{on: "landed [[#x]]", do: reset-primary}'
bad u-block '{on: "merged o/r#7", do: "schedule [[^x]]"}'
tk u-flist - open "when: [{on: \"$GOOD_ON\", do: reset-primary}]"
ro u-ser "shape: serial\nwhen:\n  - {on: \"$GOOD_ON\", do: regenerate}\n  - {on: \"$GOOD_ON\", do: reset-primary}"
tk u-tser u-ser open "when:\n  - {on: \"$GOOD_ON\", do: regenerate}\n  - {on: \"$GOOD_ON\", do: reset-primary}"
tk u-cols - open "when:\n  - {on: \"$GOOD_ON\", do: reset-primary}\n    - {on: \"merged o/r#2\", do: reset-primary}"
tk u-null - open 'when: null'
tk u-empty - open 'when:'
tk u-scalar - open 'when: soon'
tk u-stray - open "when:\n  - {on: \"$GOOD_ON\", do: reset-primary}\n  stray: 1"
printf -- '---\ntags: [task, rollout]\nstatus: open\n%s\n---\n\nProject root: `%s`\n' "$(wh "$GOOD_ON" regenerate)" "$D/repo" > "$T/u-noproj.md"
rows
# note|its due rows (the good sibling, or none when the block cannot be split)|why it is unreadable: its branch's own words
while IFS='|' read -r n kept why; do
  [ -n "$n" ] || continue
  ok "$(grep -c "^$n	due" "$D/rows")" "$kept" "$n: $kept due"
  ok "$(grep -c "^$n	unreadable" "$D/rows")" 1 "$n: one unreadable row"
  has "$(grep "^$n	unreadable" "$D/rows" | cut -f5)" "$why" "$n: $why"
done <<'EOF'
u-key|1|unknown key x
u-nodo|1|no do
u-onverb|1|unknown on exploded
u-doverb|1|unknown do explode
u-bare|1|merged names owner/repo#N
u-foo|1|regenerate takes only --tasks
u-dup|1|a duplicate of an entry above
u-emptyf|1|an empty fired:
u-nullf|1|an empty fired:
u-comma|1|not an {on, do} mapping
u-link|1|a flow value holding a wikilink must be quoted
u-offcol|1|a key off its column
u-dupkey|1|duplicate key on
u-item|1|not an {on, do} mapping
u-emptyi|1|empty list item
u-pausedx|1|paused takes no argument
u-resetx|1|reset-primary takes no argument
u-heading|1|landed names one [[task]]
u-block|1|schedule names one [[task]]
u-flist|0|a flow list
u-cols|0|list items at two dash columns
u-null|0|null value
u-empty|0|empty value
u-scalar|0|not an {on, do} mapping
u-stray|0|a line outside any list item
EOF
ok "$(bucket u-ser regenerate)" none "a serial rollout's regenerate has no due or waiting row"
ok "$(grep -c '^u-ser	unreadable.*supersedes nothing' "$D/rows")" 1 "a serial rollout's regenerate is unreadable"
ok "$(grep -c '^u-ser	due' "$D/rows")" 1 "a serial note's other trigger is due"
ok "$(grep -c '^u-tser	unreadable.*supersedes nothing' "$D/rows")" 1 "a task on a serial rollout's regenerate is unreadable"
ok "$(grep -c '^u-tser	due' "$D/rows")" 1 "the task's other trigger is due"
ok "$(grep -c '^u-noproj	unreadable.*names none' "$D/rows")" 1 "a bare regenerate with no project to name is unreadable"
# The id the two-column block's first item would have, had it read.
cid="$(python3 -c 'import hashlib,sys; print(hashlib.sha256("\0".join(("u-cols", sys.argv[1], "reset-primary")).encode()).hexdigest()[:12])' "merged https://github.com/o/r/pull/1")"
before="$(shasum -a 256 < "$T/u-cols.md")"; fire "$cid" >/dev/null 2>&1; ok "$?" 1 "fire on the two-column block exits 1"
ok "$(shasum -a 256 < "$T/u-cols.md")" "$before" "nothing written on the two-column block"
sid="$(python3 -c 'import hashlib,sys; print(hashlib.sha256("\0".join(("u-ser", sys.argv[1], "regenerate")).encode()).hexdigest()[:12])' "merged https://github.com/o/r/pull/1")"
fire "$sid" >/dev/null 2>&1; ok "$?" 1 "fire on an unreadable (serial) regenerate exits 1"

# ---- T11: the scan ----------------------------------------------------------------------------------------------------
scen scan; prj 1 MERGED; prj 2 MERGED
tk dropped - dropped "$(wh "$GOOD_ON" reset-primary)"
tk archived - done "$(wh "$GOOD_ON" reset-primary)"; mv "$T/archived.md" "$T/Archive/archived.md"
tk both - open "$(wh "$GOOD_ON" reset-primary)"
tk both2 - open "$(wh "merged o/r#2" reset-primary)"; mv "$T/both2.md" "$T/Archive/both.md"
rows
ok "$(bucket dropped)" none "a dropped note is inert"
ok "$(bucket archived)" due "an archived note is read"
ok "$(grep -c '^both	' "$D/rows")" 1 "one row for a stem with an Archive copy"
ok "$(grep -c "pull/2 " "$GHLOG")" 0 "the root copy is read, the Archive copy's PR is not"
if [ "$(id -u)" -ne 0 ]; then
  tk locked - open "$(wh "$GOOD_ON" reset-primary)"; chmod 000 "$T/locked.md"
  out="$(due 2>&1 >/dev/null)"; ok "$?" 0 "due reads on past a note it cannot read"
  has "$out" "WARN: triggers: cannot read" "with one stderr WARN"
fi

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-triggers: ALL PASS"; else echo "reconcile-rollout-triggers: FAILED"; fi
exit "$fail"
