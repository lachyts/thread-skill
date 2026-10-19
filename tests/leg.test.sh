#!/usr/bin/env bash
# skills/execute/scripts/leg.py: a serial rollout's Legs (ADR 0040, p24-3; skills/execute/legs.md).
#   L1   two Legs (5 + 2) with a handoff, then Complete: post-items, a follow-on, dispositions, the Completion log,
#        the archive and one vault commit; an Archive collision; next --waiting; file-followup after Complete reads
#        the archived note and writes nothing into it; L1v the routed land follow-on and its controls
#   L2   a lost Leg: exit 3 for another session, --take-over inherits the claim, five fresh claims beside it, the
#        same-session resume, CODEX_THREAD_ID, `unknown` never matching, --resume; L4c six smoke entries; L2b a Leg
#        lost or stopped before its smoke test hands its unsmoked tasks on
#   L3   gates: set aside at the gate, the chain goes on, stuck at the end, approve-gates (bare and --standing) and
#        hand-back re-enter through claim; a re-claimed task is one fresh claim
#   L4   fix tasks: own, chain (a later task only), outside and drift checked against git; idempotent; a
#        half-written filing; L4b a fix set aside keeps its target on the smoke list and holds its dependant; L4e
#        a fix for t10 is never one for t1
#   L5   the review gate on done; L5b change
#   L6   set-aside --revert: the commit, a conflict, a dirty path; close --outcome halt and clear-halt
#   L7   the launch check, a two-launch chain, a codex boundary and a manual hand-over
#   L8   refusals; L9 an exported GIT_DIR; L10 the close-out landing under a Leg; L11 the status mapping
#   L12  the lock: an interleaved hand-over and successor, racing begins, the timeout
# Temp vaults (git repos), temp repos with literal origins and update-ref'd origin refs, so land.sh --route never
# needs the network; a fake gh and ssh log any call. HOME, LANDING_REGISTER and THREAD_LEG_LOCK_DIR are temp;
# --now and --session are pinned. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID XDG_STATE_HOME THREAD_LEG_LOCK_TIMEOUT
root=$(pwd -P)
LEG="$root/skills/execute/scripts/leg.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
CLOSE="$root/skills/close/SKILL.md"
HOOK="$root/hooks/rollout-stop-driver.py"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
holders=()
cleanup() { local p; for p in ${holders[@]+"${holders[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
export LANDING_REGISTER="$TMP/register.md"; : > "$LANDING_REGISTER"
export THREAD_LEG_LOCK_DIR="$TMP/locks" THREAD_EVENTS_DIR="$TMP/events" TMPDIR="$TMP/t"
mkdir -p "$TMPDIR" "$TMP/bin"
# A fake gh and ssh: any call is logged and fails, so a test can assert no network was touched.
printf '#!/bin/sh\necho "gh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/gh"
printf '#!/bin/sh\necho "ssh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/fake-ssh"
chmod +x "$TMP/bin/gh" "$TMP/bin/fake-ssh"
export PATH="$TMP/bin:$PATH" GIT_SSH_COMMAND="$TMP/bin/fake-ssh"
: > "$TMP/net.log"
NOW=2026-10-20T10:00+00:00

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

S=""; V=""; T=""; RO=""
# scen <name>: a fresh vault $V (a git repo, tasks at $T), a launch folder $F, and the rollout stem $RO.
scen() {
  S="$TMP/$1"; V="$S/vault"; T="$V/Work/Tasks"; F="$S/launch"; RO="demo-rollout-2026-10-20"
  mkdir -p "$T" "$F"; git init -q "$V"; echo "== $1"
}
# mkro <post-rollout items> <row>... — the serial note; a row is `slug~alias~folder~surfaces cell`.
mkro() {
  local items=$1 i=1 r s al fo su; shift
  { printf -- '---\ntags:\n  - task\n  - rollout\nstatus: open\npriority: high\nprojects:\n  - "[[Demo]]"\n'
    printf -- 'captured: 2026-10-20\nprotocol_version: 5\nshape: serial\nsurfaces:\n  - "ext:x"\n%s---\n\n' "${EXTRA_FM:-}"
    printf -- '## Notes\n\nSerial-rollout plan.\n\n## How to execute\n\nLegs run it.\n\n## Queue\n\n'
    printf -- '| # | Task | Launch | Surfaces |\n|---|---|---|---|\n'
    for r in "$@"; do
      IFS='~' read -r s al fo su <<< "$r"
      printf '| %s | [[%s\\|%s]] | `%s` from `%s` | %s |\n' "$i" "$s" "$s" "$al" "$fo" "$su"; i=$((i+1))
    done
    printf -- '\n### Why this order\n\nIn order.\n\n## Surfaces\n\n- t: ext:x\n\n## Post-rollout\n\n'
    printf -- 'When every task is done, run the completion ceremony.\n\n1. Mark it done.\n\n'
    printf -- 'Rollout-specific items go here:\n\n%s\n' "$items"
  } > "$T/$RO.md"
}
# mkt <slug> [frontmatter line]... — a task of the chain, with a Verify line unless NOVERIFY is set.
mkt() {
  local s=$1 l; shift
  { printf -- '---\ntags: [task]\nstatus: open\nprojects:\n  - "[[Demo]]"\nrollout: "[[%s]]"\n' "$RO"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nDo %s.\n' "$s"
    [ -n "${NOVERIFY:-}" ] || printf '\n**Verify:** `test -f %s.done`\n' "$s"
  } > "$T/$s.md"
}
# rows <alias> <folder> <surfaces cell> <slug>... — row specs for mkro
rows() { local al=$1 fo=$2 su=$3 s; shift 3; for s in "$@"; do printf '%s~%s~%s~%s\n' "$s" "$al" "$fo" "$su"; done; }

# leg <verb> [args]… → $out $err $rc; common flags appended. SESS (default s1) is --session; SESS= passes none.
# CWD is the directory leg.py runs in (default $F); LEGENV adds env assignments.
leg() {
  local sess=()
  [ -n "${SESS-s1}" ] && sess=(--session "${SESS-s1}")
  out=$(cd "${CWD:-$F}" && env ${LEGENV:-} python3 "$LEG" "$@" --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" \
        --now "${LNOW:-$NOW}" ${sess[@]+"${sess[@]}"} 2>"$TMP/err"); rc=$?
  err=$(cat "$TMP/err")
}
# q <python expr over d> — read the last leg.py JSON
q() { python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$out" "$1" 2>/dev/null; }
fm() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$T/$1.md" "$2"; }
logn() { grep -c -- "$1" "$T/$RO.md"; }
snap() { cp "$T/$RO.md" "$TMP/snap"; }
same() { cmp -s "$T/$RO.md" "$TMP/snap"; ok "$?" 0 "$1: the rollout note is byte-identical"; }
# finish <slug> [extra done args] — claim (as next proposes) and mark done, verify pass
finish() { leg claim --task "$1"; ok "$rc" 0 "claim $1"; leg done --task "$1" --verify pass "${@:2}"; ok "$rc" 0 "done $1"; }
STATUS_LINES="$TMP/status-lines"; : > "$STATUS_LINES"
keepline() { q 'd["status_line"]' >> "$STATUS_LINES"; }

# ════ L1: two Legs, 5 + 2, then Complete ════════════════════════════════════════════════════════════════════════
scen l1
mkro $'- Re-run the audit on the live site.\n- Tell the team the chain landed.' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4 t5 t6 t7)
for t in t1 t2 t3 t4 t5 t6 t7; do mkt "$t"; done
git -C "$V" add -A && git -C "$V" commit -qm vault
leg begin --cwd "$F"
ok "$rc|$(q 'd["leg"]')|$(q 'd["owner"]')" "0|1|leg-1" "L1: Leg 1 begins as leg-1"
ok "$(q 'd["smoke"]')" "[]" "L1: Leg 1 runs the preflight alone (no smoke list)"
ok "$(logn 'Leg 1 began: leg-1 session s1 in cc-demo from ')" 1 "L1: … and logs its began line"
for t in t1 t2 t3 t4 t5; do
  leg next; ok "$(q 'd["action"]')/$(q 'd["task"]')" "claim/$t" "L1: next proposes $t"
  finish "$t"
done
ok "$(fm t3 status)|$(fm t3 owner)|$(fm t3 leg)|$(fm t3 completed)" "done|leg-1|1|2026-10-20" "L1: done stamps status, leg and completed"
ok "$(fm t3 started)" "2026-10-20T10:00+00:00" "L1: claim stamped started:"
leg next; ok "$(q 'd["action"]')|$(q 'd["reason"]')" "handoff|5 fresh claims" "L1: five fresh claims, then next is handoff"
leg close --outcome handoff --cwd "$F"
ok "$rc" 0 "L1: close --outcome handoff"
title=$(q 'd["handover"]["title"]'); prompt=$(q 'd["handover"]["prompt"]'); tldr=$(q 'd["handover"]["tldr"]')
ok "$([ ${#title} -le 60 ] && echo y)" y "L1: the hand-over title is at most 60 characters ($title)"
ok "$(printf '%s\n' "$prompt" | head -n 1)" "/thread:execute [[$RO]]" "L1: the prompt's first line runs the next Leg"
has "$prompt" "the brief is the rollout note's ## Leg log: $T/$RO.md" "L1: … and names the brief"
hasnt "$tldr" "/" "L1: the tldr holds no path"
ok "$(q 'd["handover"]["cwd"]')|$(q 'd["handover"]["harness"]')" "$F|claude" "L1: the hand-over opens in row 6's folder"
ok "$(q '"status_line" in d')" False "L1: a handoff close prints no status line (handed does)"
ok "$(logn 'Leg 1 closed: handoff to Leg 2 in cc-demo from ')" 1 "L1: the close line is logged"
leg handed --started task_x
ok "$rc|$(q 'd["status_line"]')" "0|ROLLOUT-STATUS: $RO merged=5/7 running=0 state=done reason=\"handed off to Leg 2\"" \
   "L1: handed prints the done status line"
keepline
ok "$(logn 'Leg 1 hand-over: started task_x')" 1 "L1: … and logs the hand-over"
snap; leg handed --started task_x; ok "$rc" 0 "L1: handed again"; same "L1: handed is idempotent"
SESS=s2 leg begin --cwd "$F"
ok "$rc|$(q 'd["leg"]')" "0|2" "L1: Leg 2 begins"
ok "$(q '",".join(e["task"] for e in d["smoke"])')" "t1,t2,t3,t4,t5" "L1: Leg 2's smoke list is every task Leg 1 finished"
ok "$(q 'd["smoke"][0]["verify"]')" '**Verify:** `test -f t1.done`' "L1: … each with its Verify line"
for t in t1 t2 t3 t4 t5; do SESS=s2 leg smoke --task "$t" --result pass; done
ok "$(logn 'Leg 2 smoke: \[\[t.\]\] pass')" 5 "L1: five smoke passes logged"
SESS=s2 leg next; ok "$(q 'd["task"]')" t6 "L1: Leg 2 next is t6"
SESS=s2 leg claim --task t6; ok "$rc" 0 "claim t6"
snap; SESS=s2 leg next --waiting "review in flight: [[t6]]"
ok "$rc|$(q 'd["status_line"]')" "0|ROLLOUT-STATUS: $RO merged=5/7 running=1 state=waiting reason=\"review in flight: [[t6]]\"" \
   "L1: next --waiting prints the review-in-flight line, R 1 while t6 is claimed"
keepline
SESS=s2 leg next --waiting "room stop: stopping calls at a step boundary"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=5/7 running=1 state=waiting reason=\"room stop: stopping calls at a step boundary\"" \
   "L1: … and the room stop's"
keepline; same "L1: next --waiting writes nothing"
SESS=s2 leg next; ok "$(q '"status_line" in d')" False "L1: a bare next prints no status line"
SESS=s2 leg next --waiting " "; ok "$rc|$out" "2|" "L1: --waiting with no reason is a usage error"
SESS=s2 leg done --task t6 --verify pass; ok "$rc" 0 "done t6"
SESS=s2 leg next; ok "$(q 'd["task"]')" t7 "L1: Leg 2 next is t7"; SESS=s2 finish t7
SESS=s2 leg next; ok "$(q 'd["action"]')" complete "L1: then next is complete"
SESS=s2 leg post-items
ok "$(q 'len(d["items"])')|$(q 'd["items"][1]["text"]')" "2|Tell the team the chain landed." "L1: post-items lists the 2 items"
SESS=s2 leg file-followup --item 1 --title "Re-run the audit" --why "The audit checks the live site."
fu=$(q 'd["followup"]')
ok "$rc|$fu" "0|demo-followup-re-run-the-audit" "L1: file-followup files a loose follow-on"
ok "$(fm "$fu" status)|$(fm "$fu" rollout)|$(fm "$fu" phase)|$(fm "$fu" owner)" "open|<none>|<none>|<none>" \
   "L1: … open, with no rollout:, phase: or owner:"
has "$(sed -n '/^projects:/,/^contexts:/p' "$T/$fu.md")" '"[[Demo]]"' "L1: … projects: copied from the rollout"
has "$(cat "$T/$RO.md")" "- → [[$fu]]: Re-run the audit" "L1: … and item 1 becomes its pointer"
SESS=s2 leg post-items; ok "$(q 'd["items"][0]["pointer"]')|$(q 'd["items"][1]["pointer"]')" "$fu|None" "L1: item 1 has a pointer, item 2 none"
snap; SESS=s2 leg close --outcome complete --cwd "$F"
ok "$rc" 1 "L1: complete without item 2's disposition is exit 1"; has "$err" "item(s) 2" "L1: … naming item 2"; same "L1: refused complete"
mkdir -p "$T/Archive/Rollouts"; echo x > "$T/Archive/Rollouts/$RO.md"
SESS=s2 leg close --outcome complete --cwd "$F" --disposition 2="told them in the Monday note"
ok "$rc" 1 "L1: an Archive collision is exit 1"; has "$err" "archive collision" "L1: … says so"; same "L1: the collision"
rm "${T:?}/Archive/Rollouts/${RO:?}.md"
SESS=s2 leg close --outcome complete --cwd "$F" --disposition 2="told them in the Monday note"
ok "$rc|$(q 'd["status_line"]')" "0|ROLLOUT-STATUS: $RO merged=7/7 running=0 state=done" "L1: complete prints state=done"
keepline
A="$T/Archive/Rollouts/$RO.md"
ok "$([ -f "$A" ] && [ ! -e "$T/$RO.md" ] && echo y)" y "L1: the note is archived"
ok "$(T="$T/Archive/Rollouts" fm "$RO" status 2>/dev/null)" done "L1: … status: done"
cl=$(sed -n '/^## Completion log/,$p' "$A")
has "$cl" '- Leg 1: `cc-demo` from `'"$F"'`, ' "L1: the Completion log has Leg 1's line"
has "$cl" 'done [[t1]], [[t2]], [[t3]], [[t4]], [[t5]]; set aside none' "L1: … Leg 1 did t1–t5"
has "$cl" 'done [[t6]], [[t7]]; set aside none' "L1: … Leg 2 did t6–t7"
has "$cl" "Post-rollout items: 1. → [[$fu]]; 2. told them in the Monday note" "L1: … both dispositions"
has "$cl" "- Chain commits: none" "L1: … Chain commits: none"
has "$cl" "- Reflection: not scored (serial; p24-4)" "L1: … and the Reflection line"
ok "$(git -C "$V" show --name-status --no-renames --format= HEAD | sort -k2 | tr '\t\n' ' |')" \
   "A Work/Tasks/Archive/Rollouts/$RO.md|A Work/Tasks/$fu.md|D Work/Tasks/$RO.md|" \
   "L1: the vault commit holds exactly the archived note, the follow-on and the tracked old path"
ok "$(git -C "$V" status --porcelain -- "Work/Tasks/$RO.md" "Work/Tasks/Archive/Rollouts/$RO.md")" "" "L1: … and leaves neither path dirty"
# close § Under a Leg, step 6, after Complete: the note is archived, so file-followup reads it there and files the task
# alone, writing nothing into the archived note.
cp "$A" "$TMP/snapA"
SESS=s2 leg file-followup --title "Tidy the release notes" --why "A close candidate after Complete."
fa=$(q 'd["followup"]')
ok "$rc|$fa|$(q 'd["pointer"]')|$(q 'd["archived"]')" "0|demo-followup-tidy-the-release-notes|False|$A" \
   "L1: after Complete, file-followup by the live path reads the archived note and files the task"
ok "$(fm "$fa" status)|$(fm "$fa" rollout)" "open|<none>" "L1: … a loose open task"
has "$(cat "$T/$fa.md")" "Filed by Leg 2 of [[$RO]] after its Complete (the archived note holds no pointer to it)." "L1: … saying so"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L1: … and the archived note is byte-identical: no pointer, no log line"
ok "$([ -e "$T/$RO.md" ] && echo y || echo n)" n "L1: … and no live note is recreated"
out=$(cd "$F" && python3 "$LEG" file-followup --title "Check the dashboards" --why w --rollout "$RO" --tasks-dir "$T" \
      --vault "$V" --now "$NOW" --session s2 2>"$TMP/err"); rc=$?
ok "$rc|$(q 'd["archived"]')|$(q 'd["followup"]')" "0|$A|demo-followup-check-the-dashboards" "L1: … and by its slug"
SESS=s2 leg file-followup --item 1 --title x --why y
ok "$rc" 1 "L1: --item on the archived note is exit 1"; has "$err" "settled at Complete" "L1: … saying why"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L1: … the archived note still byte-identical"
SESS=s3 leg begin --cwd "$F"; ok "$rc" 1 "L1: begin on the archived chain is exit 1"; has "$err" "is done" "L1: … it is done"
for v in "handed --started task_q" "smoke --task t1 --result pass" "clear-halt --reason x"; do
  leg $v; ok "$rc" 1 "L1: $v on the archived note is exit 1"; has "$err" "complete and archived" "L1: … $v says so"
done
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L1: … and the archived note stays byte-identical"
ok "$(find "$T" -name '.*.tmp' | wc -l | tr -d ' ')" 0 "L1: no temp file is left under Work/Tasks"

# ---- repo helpers ------------------------------------------------------------------------------------------------
# mkrepo <dir> <origin url> — a repo on master; origin/master and origin/HEAD set by update-ref (no network)
mkrepo() {
  mkdir -p "$1"; git init -q "$1"; echo base > "$1/a.txt"; echo b > "$1/b.txt"
  git -C "$1" add -A; git -C "$1" commit -qm base; git -C "$1" remote add origin "$2"
  git -C "$1" update-ref refs/remotes/origin/master HEAD; git -C "$1" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
}
# tcommit <repo> <task> <file> <content> [subject] — a commit carrying `Task: [[task]]`
tcommit() {
  mkdir -p "$(dirname "$1/$3")"; printf '%s\n' "$4" > "$1/$3"; git -C "$1" add -A
  git -C "$1" commit -qm "${5:-✨ feat: $2 $3}" -m "Task: [[$2]]"
}
# pcommit <repo> <file> <content> <subject> — a peer's commit, no Task: line
pcommit() { mkdir -p "$(dirname "$1/$2")"; printf '%s\n' "$3" > "$1/$2"; git -C "$1" add -A; git -C "$1" commit -qm "$4"; }
# subst <file> <from> <to> — a whole-line replacement in place (no sed -i, whose flag differs by platform)
subst() { python3 -c 'import sys; p, a, b = sys.argv[1:4]; t = open(p).read(); open(p, "w").write(t.replace(a, b))' "$@"; }
# review <repo> <rev> [effort] [status] [repo field] → a review doc's path (outside the repo)
review() {
  local d; d=$(mktemp "$S/review.XXXXXX")
  printf -- '---\nrepo: %s\nhead: %s\ndiff_digest: abc123\nharness: claude\nengine: code-review\nmode: code\neffort: %s\nreviewed: 2026-10-20\nstatus: %s\n---\n\nfindings\n' \
    "${5:-$1}" "$(git -C "$1" rev-parse --short=7 "$2")" "${3:-xhigh}" "${4:-consumed}" > "$d"; echo "$d"
}
# work <repo> <task> <file> <content> — claim, a trailered commit, a consumed xhigh review, done
work() {
  leg claim --task "$2"; ok "$rc" 0 "claim $2"
  tcommit "$1" "$2" "$3" "$4"
  local d; d=$(review "$1" HEAD)
  leg done --task "$2" --verify pass --review "$d" --cwd "$1"; ok "$rc" 0 "done $2 (reviewed)"
}

# ════ L1v: the routed land follow-on at Complete, and its controls ═════════════════════════════════════════════════
scen l1v
R="$S/r1"; mkrepo "$R" https://github.com/o/r1.git; export CWD="$R"
mkro '' "t3~cc-r1~$R~\`repo:$R\`"; mkt t3
git -C "$V" add -A; git -C "$V" commit -qm vault; git -C "$V" remote add origin https://github.com/o/vault.git
git -C "$V" update-ref refs/remotes/origin/master HEAD; git -C "$V" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
echo extra > "$V/extra.md"; git -C "$V" add -A; git -C "$V" commit -qm "vault ahead"   # (f) the vault: GitHub origin, ahead
leg begin --cwd "$R"; ok "$rc" 0 "L1v: begin in the chain checkout"
work "$R" t3 c.txt "t3 work"
mkdir -p "$R/docs/reviews"; printf -- '---\nstatus: pending\n---\nx\n' > "$R/docs/reviews/x.md"
git -C "$R" add -A; git -C "$R" commit -qm "📝 docs(review): fresh-review findings"
t3sha=$(git -C "$R" log --format=%H --grep 'Task: \[\[t3\]\]' -1)
leg close --outcome complete --cwd "$R"
ok "$rc" 0 "L1v: complete"
fu=$(q '[f for f in d["followups"] if "-land-chain-" in f][0]')
ok "$fu" "demo-followup-land-chain-2026-10-20" "L1v: a landable checkout ahead with chain commits files the land follow-on"
fb=$(cat "$T/$fu.md")
has "$fb" "\`${t3sha:0:12}\` ✨ feat: t3 c.txt ([[t3]])" "L1v: … listing t3's commit (sha12, subject, task)"
hasnt "$fb" "docs(review)" "L1v: … and never the untrailered docs(review) commit"
has "$fb" "open a PR from them, or push them" "L1v: … with the act"
hasnt "$fb" "$V" "L1v (f): the vault, GitHub origin and ahead, is never named"
A="$T/Archive/Rollouts/$RO.md"
has "$(cat "$A")" "- Chain commits: $R: 1 not on origin/master → [[$fu]]" "L1v: the Completion log's Chain commits line"
has "$(cat "$A")" "- → [[$fu]]: land the chain's commits" "L1v: … and a Post-rollout pointer"
has "$(cat "$A")" "Leg 1 follow-on [[$fu]] (land)" "L1v: … and the log line"
ok "$(grep -c 'Chain commits:' "$A")" 1 "L1v (f): one Chain commits line: the vault is no chain checkout"

# landctl <label> <expected Chain commits tail> [y: a follow-on is filed] — a one-task chain in $R, worked, $HOOK_CMD
# run, then complete
landctl() {
  mkro '' "t9~cc-r~$R~\`repo:$R\`"; mkt t9
  leg begin --cwd "$R"; ok "$rc" 0 "$1: begin"
  work "$R" t9 c.txt "c $1"
  [ -z "${HOOK_CMD:-}" ] || eval "$HOOK_CMD"
  leg close --outcome complete --cwd "$R"; ok "$rc" 0 "$1: complete"
  has "$(cat "$T/Archive/Rollouts/$RO.md")" "- Chain commits: $R: $2" "$1: Chain commits: … $2"
  ok "$(ls "$T" | grep -c -- '-land-chain-')" "$( [ "${3:-n}" = y ] && echo 1 || echo 0)" "$1: land follow-on filed: ${3:-n}"
}
scen l1va; R="$HOME/repos/workspaces"; mkrepo "$R" https://github.com/o/ws.git; export CWD="$R"
landctl "L1v (a) swept" "not landed: swept by the daily sweep, nothing filed"
scen l1vb; mkdir -p "$S/srv"; git init -q --bare "$S/srv/r.git"; R="$S/r"; mkrepo "$R" "$S/srv/r.git"; export CWD="$R"
landctl "L1v (b) no GitHub origin" "not landed: no GitHub origin, nothing filed"
scen l1vc; R="$S/r"; mkrepo "$R" https://github.com/o/rc.git; export CWD="$R"
printf -- '- o/rc — frozen for the audit\n' > "$LANDING_REGISTER"
landctl "L1v (c) register-listed" "not landed: listed o/rc: frozen for the audit, nothing filed"
: > "$LANDING_REGISTER"
scen l1vd; R="$S/r"; mkrepo "$R" https://github.com/o/rd.git; git -C "$R" checkout -qb feat/x; export CWD="$R"
landctl "L1v (d) a non-default branch" "not landed: on feat/x, not master, nothing filed"
scen l1ve; R="$S/r"; mkrepo "$R" https://github.com/o/re.git; export CWD="$R"
HOOK_CMD='git -C "$R" update-ref refs/remotes/origin/master HEAD; pcommit "$R" THREAD.md closed "📝 docs(thread): close-out"' \
  landctl "L1v (e) only a close-out commit ahead" "all on origin/master"
scen l1vg; R="$S/r"; mkrepo "$R" https://github.com/o/rg.git; export CWD="$R"
HOOK_CMD='git -C "$R" checkout -q --detach' landctl "L1v (g) a detached HEAD" "stuck: detached HEAD → [[demo-followup-land-chain-2026-10-20]]" y
has "$(cat "$T/demo-followup-land-chain-2026-10-20.md")" "check the landing route (detached HEAD), then open a PR from them, or push them" \
   "L1v (g): … its act starts by checking the landing route"
ok "$(grep -c . "$TMP/net.log")" 0 "L1v: no gh or ssh call was made"
unset CWD

# ════ L2: a lost Leg, take-over, resume ════════════════════════════════════════════════════════════════════════════
scen l2
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4 t5 t6 t7 t8)
for t in t1 t2 t3 t4 t5 t6 t7 t8; do mkt "$t"; done
leg begin --cwd "$F"; leg claim --task t1; ok "$rc" 0 "L2: Leg 1 claims t1, then dies"
b1=$(fm t1 leg_base); s1=$(fm t1 started)
snap; SESS=s2 leg begin --cwd "$F"
ok "$rc" 3 "L2: a begin from another session meets the unclosed Leg 1: exit 3"; same "L2: exit 3"
has "$err" "--resume 1" "L2: … naming --resume 1"; has "$err" "--take-over" "L2: … and --take-over"
has "$(q 'd["status_line"]')" 'state=halted reason="Leg 1 unclosed: --resume 1 or --take-over"' "L2: … with its halted status line"
keepline
SESS=s2 leg begin --cwd "$F" --take-over
ok "$rc|$(q 'd["leg"]')|$(q 'd["tookOver"]')|$(q 'd["inherited"]')" "0|2|1|['t1']" "L2: --take-over begins Leg 2 with t1 inherited"
ok "$(logn 'Leg 1 closed: lost (taken over by Leg 2)')|$(logn 'Leg 2 began: leg-2 session s2 in cc-demo from .*; took over from Leg 1')" "1|1" \
   "L2: … logging the lost line, then the began line"
SESS=s2 leg next; ok "$(q 'd["action"]')/$(q 'd["task"]')/$(q 'd["inherit"]')" "finish/t1/True" "L2: next finishes t1 first"
SESS=s2 leg claim --task t2; ok "$rc" 1 "L2: claiming t2 before t1 is refused"
LNOW=2026-10-20T11:00+00:00 SESS=s2 leg claim --task t1 --inherit
ok "$rc|$(fm t1 owner)|$(fm t1 leg)" "0|leg-2|2" "L2: claim --inherit takes t1 for Leg 2"
ok "$(fm t1 leg_base)|$(fm t1 started)" "$b1|$s1" "L2: … keeping its leg_base and started:"
ok "$(logn 'Leg 2 took \[\[t1\]\] (inherited from Leg 1)')" 1 "L2: … logged as took"
SESS=s2 leg done --task t1 --verify pass; ok "$rc" 0 "L2: Leg 2 finishes t1"
for t in t2 t3 t4 t5 t6; do SESS=s2 finish "$t"; done
SESS=s2 leg next; ok "$(q 'd["action"]')|$(q 'd["claims"]')" "handoff|5" "L2: the inherited task never counts: five fresh claims beside it"
snap; SESS=s2 leg begin --cwd "$F"
ok "$rc|$(q 'd["resumed"]')|$(q 'd["leg"]')" "0|silent|2" "L2: the same session's begin resumes silently"; same "L2: silent resume"
SESS=s2 leg close --outcome handoff; SESS=s2 leg handed --started task_y
LEGENV=CODEX_THREAD_ID=th-1 SESS= leg begin --cwd "$F" --harness claude
ok "$rc|$(q 'd["leg"]')|$(q 'd["session"]')" "0|3|th-1" "L2: CODEX_THREAD_ID is the session id"
ok "$(q 'len(d["smoke"])')" 6 "L4c: an inherited task plus five gives Leg 3 six smoke entries"
snap; LEGENV=CODEX_THREAD_ID=th-1 SESS= leg begin --cwd "$F" --harness claude
ok "$rc|$(q 'd["resumed"]')" "0|silent" "L2: … and a second begin resumes silently"; same "L2: codex resume"
LEGENV=CODEX_THREAD_ID=th-1 SESS= leg close --outcome handoff
SESS= leg begin --cwd "$F"; ok "$rc|$(q 'd["leg"]')|$(q 'd["session"]')" "0|4|unknown" "L2: no session id begins as unknown"
snap; SESS= leg begin --cwd "$F"; ok "$rc" 3 "L2: unknown never matches unknown: exit 3"; same "L2: unknown"
SESS=s9 leg begin --cwd "$F" --resume 5; ok "$rc" 1 "L2: --resume naming the wrong Leg is exit 1"; same "L2: wrong resume"
SESS=s9 leg begin --cwd "$F" --resume 4
ok "$rc|$(q 'd["resumed"]')|$(logn 'Leg 4 resumed: session s9')" "0|logged|1" "L2: --resume 4 logs resumed"
snap; SESS=s9 leg begin --cwd "$F"; ok "$rc|$(q 'd["resumed"]')" "0|silent" "L2: … and that session now resumes silently"; same "L2: resumed"

# L2b: a Leg lost, or stopped, before (or part-way through) its smoke test hands its unsmoked tasks on
scen l2b
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4)
for t in t1 t2 t3 t4; do mkt "$t"; done
smk() { q '",".join(e["task"] for e in d["smoke"])'; }
leg begin --cwd "$F"; finish t1; finish t2; leg close --outcome handoff; leg handed --started x
SESS=s2 leg begin --cwd "$F"; ok "$(smk)" "t1,t2" "L2b: Leg 2's smoke list is t1, t2; then Leg 2 dies before its smoke test"
SESS=s3 leg begin --cwd "$F" --take-over
ok "$rc|$(q 'd["leg"]')|$(smk)" "0|3|t1,t2" "L2b: a take-over before the smoke test carries t1 and t2 to Leg 3"
ok "$(q 'd["smoke"][0]["why"]')" "['done by Leg 1, never smoke-tested since']" "L2b: … each saying why"
SESS=s3 leg smoke --task t1 --result pass
SESS=s3 leg close --outcome stopped --reason "out of time"
SESS=s4 leg begin --cwd "$F"; ok "$rc|$(smk)" "0|t2" "L2b: a stop part-way through the smoke test carries only the unsmoked t2"
SESS=s4 leg close --outcome stopped --reason "out of time again"
SESS=s5 leg begin --cwd "$F"; ok "$rc|$(smk)" "0|t2" "L2b: a close --outcome stopped before the smoke test carries t2 again"
SESS=s5 leg smoke --task t2 --result not-run --why "needs a device"
SESS=s5 finish t3; SESS=s5 leg close --outcome handoff; SESS=s5 leg handed --started y
SESS=s6 leg begin --cwd "$F"; ok "$rc|$(smk)" "0|t3" "L2b: once logged, even as not run, a task is never carried: Leg 6 checks t3 only"

# ════ L3: gates ═════════════════════════════════════════════════════════════════════════════════════════════════════
scen l3
G1='spend: OpenAI API for the audit — cap 5 USD'
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4 t5)
mkt t1; mkt t2; mkt t3; mkt t4 'depends-on:' '  - "[[t2]]"'; mkt t5
leg begin --cwd "$F"; finish t1
leg next; ok "$(q 'd["task"]')" t2 "L3: next is t2"
leg claim --task t2 --gate "$G1"; ok "$rc|$(q 'd["unapproved"]')" "0|['$G1']" "L3: claim reports the unapproved gate"
leg set-aside --task t2 --kind gate --gate "$G1" --reason "an unapproved spend gate"
ok "$rc|$(fm t2 status)|$(fm t2 owner)" "0|gate-pending|<none>" "L3: set-aside --kind gate: gate-pending, no owner"
has "$(sed -n '/^## Gated inputs (awaiting sign-off)/,$p' "$T/t2.md")" "- $G1" "L3: … with the gate under ## Gated inputs (awaiting sign-off)"
leg next; ok "$(q 'd["task"]')" t3 "L3: the chain goes on: t3"; finish t3
leg next; ok "$(q 'd["task"]')" t5 "L3: t4 is held, t5 next"
has "$(q 'd["held"]')" "depends on [[t2]] (gate-pending)" "L3: … t4 held on t2's gate"
finish t5
leg next; ok "$(q 'd["action"]')" stuck "L3: only the set-aside and its dependant remain: stuck"
leg close --outcome stuck
ok "$rc|$(q 'd["status_line"]')" "0|ROLLOUT-STATUS: $RO merged=3/5 running=0 state=halted reason=\"awaiting you: 1 set aside\"" "L3: close stuck"
keepline
has "$(q 'd["needs_you"]')" "[[t2]] sign off gated input: $G1" "L3: … its needs-you item names the gate"
python3 "$RR" approve-gates --tasks t2 --tasks-dir "$T" > "$TMP/ag" 2>&1; ok "$?" 0 "L3: a bare approve-gates signs t2"
ok "$(fm t2 status)|$([ "$(fm t2 gates_signed)" != '<none>' ] && echo y)" "in_progress|y" "L3: … in_progress with gates_signed"
SESS=s2 leg begin --cwd "$F"; ok "$(q 'd["next"]["action"]')/$(q 'd["next"]["task"]')" "claim/t2" "L3: the next Leg re-enters t2"
SESS=s2 leg claim --task t2 --gate "$G1"
ok "$rc|$(fm t2 gates_signed)|$(fm t2 owner)|$(q 'd["unapproved"]')" "0|<none>|leg-2|[]" "L3: claim consumes gates_signed; the gate is approved"
SESS=s2 leg done --task t2 --verify pass; SESS=s2 leg next; ok "$(q 'd["task"]')" t4 "L3: t4 is free once t2 is done"
# --standing, with a rollouts.toml [defaults] standing approval
scen l3b
mkdir -p "$HOME/.config/thread"; printf '[defaults]\nspend_approval_usd = 10\n' > "$HOME/.config/thread/rollouts.toml"
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2
leg begin --cwd "$F"; leg claim --task t1 --gate "$G1"
leg set-aside --task t1 --kind gate --gate "$G1" --reason "spend"
python3 "$RR" approve-gates --standing --tasks t1 --rollout "$T/$RO.md" --tasks-dir "$T" > "$TMP/ag" 2>&1
ok "$?|$(fm t1 status)" "0|in_progress" "L3: approve-gates --standing signs a covered gate on a serial note"
leg next; ok "$(q 'd["task"]')" t1 "L3: … and the Leg re-enters it"
printf '' > "$HOME/.config/thread/rollouts.toml"
# hand-back
leg claim --task t1; leg set-aside --task t1 --reason "blocked on a missing key"
ok "$(fm t1 status)|$(fm t1 owner)" "blocked|<none>" "L3: a block set-aside: blocked, no owner"
has "$(cat "$T/t1.md")" "Set aside by Leg 1 of [[$RO]]: blocked on a missing key" "L3: … with its diagnosis"
python3 "$RR" hand-back --tasks t1 --tasks-dir "$T" > "$TMP/hb" 2>&1; ok "$?|$(fm t1 status)" "0|in_progress" "L3: hand-back re-enters it"
leg next; ok "$(q 'd["task"]')" t1 "L3: … next claims it"
leg claim --task t1; ok "$rc|$(fm t1 handed_back)" "0|<none>" "L3: … and claim consumes handed_back"
ok "$(logn 'Leg 1 claimed \[\[t1\]\]')" 3 "L3: t1 has three claimed lines in Leg 1 (the gate, the standing approval, the hand-back)"
leg done --task t1 --verify pass; leg next
ok "$(q 'd["task"]')|$(q 'd["claims"]')" "t2|1" "L3: … and counts as one fresh claim"

# ════ L4: fix tasks ═════════════════════════════════════════════════════════════════════════════════════════════════
scen l4
R="$S/r"; mkrepo "$R" https://github.com/o/r4.git; export CWD="$R"
mkro '' $(rows cc-r "$R" "\`repo:$R\`" t1 t2 t3 t4 t5 t6 t7)
for t in t1 t2 t3 t4 t5 t6; do mkt "$t"; done; mkt t7 'depends-on:' '  - "[[t3]]"'
leg begin --cwd "$R"
leg claim --task t1; leg done --task t1 --verify pass --cwd "$R"; ok "$rc" 0 "L4: t1 writes no code: no review needed"
work "$R" t2 b.txt "t2 b"
work "$R" t3 a.txt "t3 a"
work "$R" t4 d.txt "t4 d"
work "$R" t5 a.txt "t5 a, over t3's line"
leg close --outcome handoff --cwd "$R"; leg handed --started task_z
SESS=s2 leg begin --cwd "$R"; ok "$(q '",".join(e["task"] for e in d["smoke"])')" "t1,t2,t3,t4,t5" "L4: Leg 2's smoke list"
SESS=s2 leg smoke --task t3 --result fail --why "a.txt says t5"
snap; SESS=s2 leg file-fix --target t3 --cause chain --culprit t4 --evidence x
ok "$rc" 1 "L4: a culprit whose commits miss t3's paths is exit 1"; same "L4: culprit t4"
SESS=s2 leg file-fix --target t3 --cause chain --culprit nope --evidence x; ok "$rc" 1 "L4: a culprit that is no chain row is exit 1"; same "L4: culprit nope"
SESS=s2 leg file-fix --target t3 --cause outside --evidence x; ok "$rc" 1 "L4: outside with no untrailered commit on t3's paths is exit 1"
SESS=s2 leg file-fix --target t3 --cause drift --evidence x; ok "$rc" 1 "L4: drift after a commit to t3's paths is exit 1"
has "$err" "use own, chain or outside" "L4: … with the hint"; same "L4: refusals"
# t3, then t5, both wrote a.txt: t3 landed before t5 passed its own Verify, so it never broke t5 ...
SESS=s2 leg file-fix --target t5 --cause chain --culprit t3 --evidence x
ok "$rc" 1 "L4: a culprit whose commits on t5's paths all came before t5's last Task: commit is exit 1"
has "$err" "all came before [[t5]]'s last Task: commit" "L4: … saying so"; same "L4: culprit t3 for t5"
# ... and the control: the same pair the other way round, t5 after t3, is the culprit (below).
SESS=s2 leg file-fix --target t3 --cause chain --culprit t5 --evidence "Verify failed: a.txt reads t5" --excerpt "FAIL: a.txt"
f1=$(q 'd["fix"]')
ok "$rc|$f1" "0|demo-followup-fix-t3" "L4: chain --culprit t5 files the fix"
ok "$(fm "$f1" verifies)|$(fm "$f1" fixes)|$(fm "$f1" rollout)|$(fm "$f1" launch)|$(fm "$f1" status)" \
   "\"[[t3]]\"|\"[[t5]]\"|\"[[$RO]]\"|cc-r|open" "L4: … verifies t3, fixes the culprit t5, rollout:, this Leg's launch"
has "$(cat "$T/$f1.md")" '**Verify:** `test -f t3.done`' "L4: … t3's Verify line copied"
has "$(cat "$T/$f1.md")" "FAIL: a.txt" "L4: … and the output excerpt"
ok "$(fm t3 status)" done "L4: t3 stays done"
qrows() { sed -n '/^## Queue/,/^### /p' "$T/$RO.md" | grep '^| [0-9]' | sed 's/^| \([0-9]*\) | \[\[\([^]\\]*\).*/\1:\2/' | tr '\n' ' '; }
ok "$(qrows)" "1:t1 2:t2 3:t3 4:t4 5:t5 6:$f1 7:t6 8:t7 " "L4: the fix row goes ahead of the first queued row, renumbered"
has "$(grep "\[\[$f1" "$T/$RO.md" | head -1)" "| \`cc-r\` from \`$R\` | \`repo:$R\` |" "L4: … in this Leg's launch with t3's surfaces"
SESS=s2 leg next; ok "$(q 'd["task"]')|$(q 'd["fix"]')" "$f1|True" "L4: next works the fix before t6"
snap; SESS=s2 leg file-fix --target t3 --cause own --evidence again
ok "$rc|$(q 'd["existing"]')|$(ls "$T" | grep -c followup-fix-t3)" "0|True|1" "L4: a re-run files nothing new"; same "L4: idempotent"
SESS=s2 leg file-fix --target t2 --cause own --evidence "b.txt is wrong"
ok "$rc|$(fm demo-followup-fix-t2 verifies)|$(fm demo-followup-fix-t2 fixes)" "0|\"[[t2]]\"|\"[[t2]]\"" "L4: own: fixes names t2 itself"
SESS=s2 leg file-fix --target t1 --cause chain --culprit t5 --evidence x; ok "$rc" 1 "L4: a vault-only task takes no chain cause"
SESS=s2 leg file-fix --target t1 --cause drift --evidence "the API changed"
ok "$rc|$(fm demo-followup-fix-t1 verifies)|$(fm demo-followup-fix-t1 fixes)" "0|\"[[t1]]\"|<none>" "L4: drift: verifies only"
pcommit "$R" d.txt "peer d" "peer: tidy d"
SESS=s2 leg file-fix --target t4 --cause outside --evidence "a peer rewrote d.txt"
ok "$rc|$(fm demo-followup-fix-t4 verifies)|$(fm demo-followup-fix-t4 fixes)" "0|\"[[t4]]\"|<none>" "L4: outside, with a peer commit: verifies only"
# a half-written filing: a fix note for t5 with no row
printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[%s]]"\nverifies: "[[t5]]"\n---\n\n## Notes\n\nhalf\n' "$RO" > "$T/demo-followup-fix-t5.md"
SESS=s2 leg file-fix --target t5 --cause own --evidence x
ok "$rc|$(q 'd["fix"]')|$(q 'd["wroteNote"]')|$(ls "$T" | grep -c followup-fix-t5)" "0|demo-followup-fix-t5|False|1" \
   "L4: a half-written filing gets its row and no second note"
has "$(qrows)" "demo-followup-fix-t5" "L4: … the row is in the Queue"
unset CWD
# L4b: a fix set aside keeps its target on the smoke list and holds its dependant
scen l4b
R="$S/r"; mkrepo "$R" https://github.com/o/r4b.git; export CWD="$R"
mkro '' $(rows cc-r "$R" "\`repo:$R\`" t1 t2 t3 t4)
mkt t1; mkt t2; mkt t3; mkt t4 'depends-on:' '  - "[[t2]]"'
leg begin --cwd "$R"; leg claim --task t1; leg done --task t1 --verify pass --cwd "$R"
work "$R" t2 a.txt "t2"; leg claim --task t3; leg done --task t3 --verify pass --cwd "$R"
leg close --outcome handoff --cwd "$R"; leg handed --started x
SESS=s2 leg begin --cwd "$R"
SESS=s2 leg smoke --task t1 --result fail --why "inherited partial work"
SESS=s2 leg smoke --task t3 --result not-run --why "needs a device"
SESS=s2 leg smoke --task t2 --result fail
SESS=s2 leg file-fix --target t2 --cause own --evidence x; fx=$(q 'd["fix"]')
SESS=s2 leg next; ok "$(q 'd["task"]')" "$fx" "L4b: the fix comes first"
SESS=s2 leg claim --task "$fx"; SESS=s2 leg set-aside --task "$fx" --reason "the fix needs Lachy"
SESS=s2 leg next; ok "$(q 'd["action"]')" stuck "L4b: with the fix set aside, nothing is claimable"
has "$(q 'd["held"]')" "depends on [[t2]] (awaiting fix [[$fx]])" "L4b: t2's dependant is held awaiting the fix"
SESS=s2 leg close --outcome stuck; SESS=s3 leg begin --cwd "$R"
ok "$(q '",".join(e["task"] for e in d["smoke"])')" "t1,t2" "L4b: Leg 3 re-verifies t2 (its fix is not done) and carries t1's fail; t3's not run is not carried"
unset CWD
# L4e: a fix filed for t10 is never one for t1 (the closed link, not a prefix)
scen l4e
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t10 t2); mkt t1; mkt t10; mkt t2
leg begin --cwd "$F"; finish t1; finish t10; leg close --outcome handoff; leg handed --started x
SESS=s2 leg begin --cwd "$F"
SESS=s2 leg smoke --task t1 --result fail --why "t1 broke"; SESS=s2 leg smoke --task t10 --result fail
SESS=s2 leg file-fix --target t10 --cause drift --evidence "the API changed"; ok "$rc" 0 "L4e: a fix for t10"
SESS=s2 leg close --outcome stopped --reason "out of time"
SESS=s3 leg begin --cwd "$F"
ok "$rc|$(q '",".join(e["task"] for e in d["smoke"])')" "0|t1,t10" "L4e: Leg 3 carries t1's fail beside t10's fix"
ok "$(q 'd["smoke"][0]["why"]')" "[\"failed at Leg 2's smoke test, no fix filed\"]" "L4e: … t1 for its unfixed fail"

# ════ L5: the review gate; L5b: change ══════════════════════════════════════════════════════════════════════════════
scen l5
R="$S/r"; mkrepo "$R" https://github.com/o/r5.git; pcommit "$R" e.txt e "earlier"; export CWD="$R"
mkro '' $(rows cc-r "$R" "\`repo:$R\`" t1 t2 t3)
mkt t1; mkt t2; mkt t3
leg begin --cwd "$R"; base=$(git -C "$R" rev-parse HEAD)
leg claim --task t1; ok "$(fm t1 leg_base)" "[\"$R@$base\"]" "L5: claim stamps leg_base for the row's repo surface"
tcommit "$R" t1 a.txt "t1 a"
pcommit "$R" x.txt peer "peer: x"
pcommit "$R" docs/reviews/r.md "doc" "📝 docs(review): fresh-review findings"
tcommit "$R" t1 docs/reviews/s.md "doc" "✨ feat: t1 review doc"
leg change --task t1
ok "$(q 'len(d["tops"][0]["commits"])')|$(q 'd["tops"][0]["paths"]')|$(q 'd["codeWriting"]')" "2|['a.txt']|True" \
   "L5b: change lists the trailered commits and their paths, docs/reviews/ out"
ok "$(q 'len(d["tops"][0]["warns"])')" 1 "L5b: … one WARN, for the peer's untrailered commit"
has "$(q 'd["tops"][0]["warns"][0]')" "peer: x" "L5b: … naming it; a docs/reviews-only commit is exempt"
snap; leg done --task t1 --verify pass --cwd "$R"; ok "$rc" 1 "L5: done without --review is exit 1"; same "L5: no review"
good=$(review "$R" HEAD)
leg done --task t1 --review "$good" --cwd "$R"; ok "$rc" 1 "L5: done without --verify pass is exit 1"
side=$(git -C "$R" commit-tree 'HEAD^{tree}' -p HEAD -m side)
for bad in "$(review "$R" HEAD high)|effort" "$(review "$R" HEAD xhigh pending)|status" "$(review "$R" "$base^")|descend" \
           "$(review "$R" "$side")|ancestor" "$(review "$R" HEAD xhigh consumed "$S/elsewhere")|repo"; do
  leg done --task t1 --verify pass --review "${bad%%|*}" --cwd "$R"
  ok "$rc" 1 "L5: a review doc with a bad ${bad##*|} is refused"; has "$err" "${bad##*|}" "L5: … saying ${bad##*|}"
done
same "L5: refused docs"
CWD="$S" leg done --task t1 --verify pass --review "$good" --cwd "$S"; ok "$rc" 1 "L5: code outside the cwd's checkout is refused"
has "$err" "work it from a Leg launched in $R" "L5: … with where to work it"
leg done --task t1 --verify pass --review "$good" --cwd "$R"
ok "$rc|$(fm t1 status)|$(fm t1 reviewed)" "0|done|[\"$good\"]" "L5: a valid doc: done, reviewed: stamped"
leg claim --task t2; leg done --task t2 --verify pass --cwd "$R"; ok "$rc" 0 "L5: a task with no trailered commits needs no review"
leg claim --task t3; echo v > "$V/v.md"; git -C "$V" add -A; git -C "$V" commit -qm "vault edit" -m "Task: [[t3]]"
leg done --task t3 --verify pass --cwd "$R"; ok "$rc" 0 "L5: a task whose Task: commits are in the vault only needs no review"
unset CWD

# ════ L6: revert, conflict, halt ════════════════════════════════════════════════════════════════════════════════════
scen l6
R="$S/r"; mkrepo "$R" https://github.com/o/r6.git; export CWD="$R"
mkro '' $(rows cc-r "$R" "\`repo:$R\`" t1 t2 t3)
mkt t1; mkt t2; mkt t3
leg begin --cwd "$R"; leg claim --task t1; base=$(git -C "$R" rev-parse HEAD)
tcommit "$R" t1 a.txt "t1 a"; tcommit "$R" t1 c.txt "t1 c"
leg set-aside --task t1 --revert --reason "the review did not converge"
rsha=$(q 'd["reverted"][0]["sha"]')
ok "$rc|$(git -C "$R" rev-parse HEAD)" "0|$rsha" "L6: set-aside --revert commits the revert"
msg=$(git -C "$R" log -1 --format=%B)
has "$msg" "Task: [[t1]]" "L6: … carrying Task:"; has "$msg" "Set-aside: the review did not converge" "L6: … and Set-aside:"
git -C "$R" diff --quiet "$base" HEAD -- a.txt c.txt; ok "$?" 0 "L6: the paths are back at leg_base"
has "$(cat "$T/t1.md")" "reverted $rsha in $R" "L6: the diagnosis names the revert"
ok "$(logn "Leg 1 reverted $rsha in $R")" 1 "L6: … and so does the log"
ok "$(git -C "$R" worktree list | grep -c .)|$(ls "$TMPDIR" | grep -c leg-revert)" "1|0" "L6: no scratch tree is left"
leg next; leg claim --task t2; tcommit "$R" t2 d.txt "t2 d"
echo dirty >> "$R/d.txt"; h0=$(git -C "$R" rev-parse HEAD)
leg set-aside --task t2 --revert --reason x; ok "$rc|$(git -C "$R" rev-parse HEAD)" "3|$h0" "L6: a dirty path to revert is exit 3 first"
git -C "$R" checkout -q -- d.txt; echo staged >> "$R/d.txt"; git -C "$R" add d.txt
leg set-aside --task t2 --revert --reason x; ok "$rc" 3 "L6: a staged one too"
git -C "$R" reset -q d.txt; git -C "$R" checkout -q -- d.txt
pcommit "$R" d.txt "peer d" "peer: rewrite d"; h0=$(git -C "$R" rev-parse HEAD)
leg set-aside --task t2 --revert --reason "would conflict"
ok "$rc" 3 "L6: a revert that would conflict is exit 3"; has "$err" "conflicts" "L6: … says so"
ok "$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain)|$(git -C "$R" diff)" "$h0||" "L6: … HEAD, index and tree unchanged"
ok "$(ls "$R/.git" | grep -cE '^(REVERT_HEAD|CHERRY_PICK_HEAD|sequencer)$')|$(git -C "$R" worktree list | grep -c .)" "0|1" \
   "L6: … no REVERT_HEAD, CHERRY_PICK_HEAD or sequencer, no scratch tree"
ok "$(fm t2 status)|$(fm t2 owner)" "in_progress|leg-1" "L6: … and t2 stays claimed"
leg close --outcome halt --reason "revert conflict on t2"
ok "$rc|$(q 'd["status_line"]')" "0|ROLLOUT-STATUS: $RO merged=0/3 running=1 state=halted reason=\"halt: revert conflict on t2\"" "L6: close --outcome halt"
keepline
SESS=s2 leg begin --cwd "$R"; ok "$rc" 3 "L6: begin is exit 3 while the halt stands"; has "$err" "clear-halt" "L6: … naming clear-halt"
SESS=s2 leg clear-halt --reason "resolved by hand"; ok "$rc|$(logn 'halt cleared: resolved by hand')" "0|1" "L6: clear-halt logs it"
SESS=s2 leg begin --cwd "$R"; ok "$rc|$(q 'd["inherited"]')" "0|['t2']" "L6: the next Leg inherits the halted task"
SESS=s2 leg clear-halt --reason again; ok "$rc" 1 "L6: clear-halt with no halt standing is exit 1"
unset CWD

# ════ L7: launch ════════════════════════════════════════════════════════════════════════════════════════════════════
scen l7
FA="$S/a"; FB="$S/b"; mkdir -p "$FA" "$FB"
mkro '' $(rows cc-a "$FA" '`ext:x`' t1 t2) $(rows cx-b "$FB" '`ext:y`' t3 t4)
for t in t1 t2 t3 t4; do mkt "$t"; done
snap; CWD="$S" leg begin --cwd "$S"
ok "$rc" 4 "L7: a wrong cwd is exit 4"; same "L7: wrong cwd"
ok "$(q 'd["launch"]')|$(q 'd["prompt"].split(chr(10))[0]')" "cc-a from $FA|/thread:execute [[$RO]]" "L7: … printing the launch line and the Leg prompt"
has "$(q 'd["status_line"]')" "state=halted reason=\"wrong launch: run Leg 1 as cc-a from $FA\"" "L7: … and its halted status line"
keepline
export CWD="$FA"
leg begin --cwd "$FA"; ok "$rc" 0 "L7: Leg 1 begins in row 1's launch"
finish t1; finish t2
leg next; ok "$(q 'd["action"]')|$(q 'd["next"]["task"]')" "handoff|t3" "L7: a launch change is a Leg boundary"
leg close --outcome handoff
ok "$(q 'd["handover"]["harness"]')|$(q 'd["handover"]["cwd"]')" "codex|$FB" "L7: the hand-over is codex, in B's folder"
leg handed --manual "a claude to codex boundary"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=2/4 running=0 state=halted reason=\"manual handoff: Leg 2 in cx-b from $FB\"" \
   "L7: handed --manual prints the manual handoff line"
keepline
ok "$(logn 'Leg 1 hand-over: manual (a claude to codex boundary)')" 1 "L7: … and logs it"
export CWD="$FB"
SESS=s2 leg begin --cwd "$FB"; ok "$rc" 4 "L7: a cx- row in a claude Leg is exit 4"
SESS=s2 leg begin --cwd "$FB" --harness codex; ok "$rc|$(q 'd["leg"]')" "0|2" "L7: … and a codex Leg begins"
unset CWD

# ════ L8: refusals ══════════════════════════════════════════════════════════════════════════════════════════════════
refuse() {  # refuse <label> [stderr fragment] — begin is exit 1 and writes nothing
  snap; leg begin --cwd "$F"; ok "$rc" 1 "L8: $1 is exit 1"; same "L8: $1"
  [ -z "${2:-}" ] || has "$err" "$2" "L8: $1 … says $2"
}
scen l8; mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1
subst "$T/$RO.md" 'shape: serial' 'shape: parallel'; refuse "a parallel note" "not a serial rollout"
EXTRA_FM=$'incomplete: true\n' mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); refuse "an incomplete note" "incomplete"
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); subst "$T/$RO.md" 'status: open' 'status: dropped'; refuse "a dropped note" "dropped"
EXTRA_FM=$'paused: 2026-10-19T10:00+00:00\n' mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2)
refuse "a paused: note" "a serial note is never paused: delete its paused: (and pause_requested:) line, then /thread:execute [[$RO]]"
has "$(q 'd["status_line"]')" 'state=halted reason="a serial note is never paused"' "L8: … its halted status line"; keepline
EXTRA_FM=$'pause_requested: true\n' mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); refuse "a pause_requested: note" "never paused"
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2)
TS="$S/ts"; mkrepo "$TS" https://github.com/lachyts/thread-skill.git
snap; CWD="$TS" leg begin --cwd "$TS"; ok "$rc" 1 "L8: a cwd on lachyts/thread-skill is exit 1"; same "L8: self"
has "$err" "this plugin's own checkout" "L8: … naming it"
leg begin --cwd "$F"; finish t1; leg next
ok "$(q 'd["action"]')|$(q 'd["held"]')" "stuck|[{'slug': 't2', 'why': 'note not found'}]" "L8: a missing task note is held 'note not found'"

# ════ L9: an exported GIT_DIR does not redirect leg.py ══════════════════════════════════════════════════════════════
scen l9
R="$S/r"; mkrepo "$R" https://github.com/o/r9.git
X=$(mktemp -d "$TMP/throwaway.XXXXXX"); git init -q "$X"; echo x > "$X/x"; git -C "$X" add -A; git -C "$X" commit -qm x
mkro '' "t1~cc-r~$R~\`repo:$R\`"; mkt t1
LEGENV="GIT_DIR=$X/.git GIT_WORK_TREE=$X" CWD="$R" leg begin --cwd "$R"; ok "$rc" 0 "L9: begin under an exported GIT_DIR"
LEGENV="GIT_DIR=$X/.git GIT_WORK_TREE=$X" CWD="$R" leg claim --task t1
ok "$(fm t1 leg_base)" "[\"$R@$(git -C "$R" rev-parse HEAD)\"]" "L9: leg_base names the row's checkout, not the GIT_DIR"

# ════ L10: the close-out landing under a Leg (the S9 regression) ════════════════════════════════════════════════════
scen l10
R="$S/r"; mkrepo "$R" git@github.com:o/r10.git; export CWD="$R"
mkro '' "t1~cc-r~$R~\`repo:$R\`"; mkt t1
leg begin --cwd "$R"; leg claim --task t1; tcommit "$R" t1 a.txt "t1 a"
mkdir -p "$R/docs/reviews"
printf -- '---\nrepo: %s\nhead: %s\nmode: code\neffort: xhigh\nstatus: pending\n---\n\nfindings\n' "$R" "$(git -C "$R" rev-parse --short=7 HEAD)" > "$R/docs/reviews/x.md"
git -C "$R" add -A; git -C "$R" commit -qm "📝 docs(review): fresh-review findings"
subst "$R/docs/reviews/x.md" 'status: pending' 'status: consumed'
leg done --task t1 --verify pass --review "$R/docs/reviews/x.md" --cwd "$R"; ok "$rc" 0 "L10: done with the in-repo review doc"
leg close --outcome stopped --reason "end of the session" --cwd "$R"
ok "$rc|$(q "'$R' in d['commit_only']")" "0|True" "L10: commit_only lists the chain checkout"
has "$(q 'd["status_line"]')" 'state=halted reason="stopped: end of the session"' "L10: close --outcome stopped"; keepline
awk '{ l=$0; sub(/^[ \t]+/, "", l) }
     l ~ /^# thread:land( |$)/ { on=1; ind=substr($0, 1, length($0)-length(l)); next }
     l == "# end thread:land" { on=0 }
     on { if (index($0, ind) == 1) print substr($0, length(ind)+1); else print $0 }' "$CLOSE" > "$S/snip.sh"
sed -e "s|top='<top>'|top='$R'|" -e "s|slug='<slug>'|slug='t1'|" -e "s|mode=''|mode='--commit-only'|" \
    -e "s|<message>|🔧 chore(review): consumed review docs — delete (history keeps them)|" -e "s| <paths>\$| '$R/docs/reviews/x.md'|" \
    "$S/snip.sh" > "$S/run.sh"
: > "$TMP/net.log"
lout=$(cd "$R" && CLAUDE_PLUGIN_ROOT="$root" bash "$S/run.sh" 2>"$S/land.err"); lrc=$?
ok "$lout|$lrc" "not landed: commit-only|0" "L10: close's land snippet, commit-only: not landed: commit-only, exit 0"
hasnt "$lout$(cat "$S/land.err")" "stuck:" "L10: … never stuck:"
ok "$(git -C "$R" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/reviews/x.md|" "L10: … the consumed doc's deletion is committed"
ok "$(grep -c . "$TMP/net.log")" 0 "L10: … and no gh or ssh call was made"
unset CWD

# ════ L11: the status mapping ═══════════════════════════════════════════════════════════════════════════════════════
ok "$(grep -c . "$STATUS_LINES")" 11 "L11: eleven status lines collected (handed, review in flight, room stop, complete, unclosed, stuck, halt, wrong
   launch, manual, paused, stopped)"
bad=$(python3 - "$HOOK" "$STATUS_LINES" <<'PY'
import importlib.util, re, sys
spec = importlib.util.spec_from_file_location("drv", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for line in open(sys.argv[2]).read().splitlines():
    if not re.fullmatch(m.STATUS_RE.pattern + r'(?: reason="[^"]*")?', line) or "state=running" in line:
        print(line)
PY
)
ok "$bad" "" "L11: every Leg status line matches the Stop hook's STATUS_RE, and none is state=running"

# ════ L12: the lock ═════════════════════════════════════════════════════════════════════════════════════════════════
scen l12
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4 t5 t6 t7)
for t in t1 t2 t3 t4 t5 t6 t7; do mkt "$t"; done
leg begin --cwd "$F"; for t in t1 t2 t3 t4 t5; do finish "$t"; done; leg close --outcome handoff
LOCK="$THREAD_LEG_LOCK_DIR/$RO.lock"
hold() {  # hold <flag file> — an outside holder of the lock; $hp its pid, recorded for cleanup
  python3 -c 'import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); fcntl.flock(fd, fcntl.LOCK_EX); open(sys.argv[2], "w").write("held")
time.sleep(120)' "$LOCK" "$1" &
  hp=$!; holders+=("$hp")
  local i=0; while [ ! -f "$1" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
}
lb() {  # lb <tag> <session> <verb> [args] — leg.py in the background; its rc lands in $TMP/<tag>.rc
  local tag=$1 sess=$2; shift 2
  ( cd "$F" && python3 "$LEG" "$@" --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" --session "$sess" \
      > "$TMP/$tag.out" 2>&1; echo $? > "$TMP/$tag.rc" ) &
}
hold "$TMP/held1"; snap
lb h1 s1 handed --started task_x; p1=$!
( cd "$F" && python3 "$LEG" begin --cwd "$F" --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" --session s2 >/dev/null 2>&1 \
  && python3 "$LEG" claim --task t6 --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" --session s2 >/dev/null 2>&1
  echo $? > "$TMP/h2.rc" ) & p2=$!
sleep 1
same "L12: while an outside holder has the lock"
ok "$(kill -0 "$p1" 2>/dev/null && kill -0 "$p2" 2>/dev/null && echo y)" y "L12: … both writers are still waiting"
kill "$hp"; wait "$hp" 2>/dev/null; wait "$p1" "$p2"
ok "$(cat "$TMP/h1.rc")|$(cat "$TMP/h2.rc")" "0|0" "L12: released, both exit 0"
ok "$(logn 'Leg 1 hand-over: started task_x')|$(logn 'Leg 2 began')|$(logn 'Leg 2 claimed \[\[t6\]\]')|$(fm t6 owner)" "1|1|1|leg-2" \
   "L12: the note holds the hand-over, Leg 2's began and its claim"
SESS=s2 leg close --outcome stopped --reason "race next"
hold "$TMP/held2"
lb r1 s3 begin --cwd "$F"; q1=$!; lb r2 s4 begin --cwd "$F"; q2=$!
sleep 0.5; kill "$hp"; wait "$hp" 2>/dev/null; wait "$q1" "$q2"
ok "$(cat "$TMP/r1.rc" "$TMP/r2.rc" | sort | tr '\n' ' ')" "0 3 " "L12: two racing begins: one begins, the other is exit 3"
ok "$(logn 'Leg 3 began')" 1 "L12: … and there is one began line"
hold "$TMP/held3"; snap
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 SESS=s3 leg done --task t6 --verify pass
ok "$rc" 5 "L12: a lock held past THREAD_LEG_LOCK_TIMEOUT is exit 5"; same "L12: timeout"
kill "$hp"; wait "$hp" 2>/dev/null
ok "$(find "$TMP" -path '*/Work/Tasks/*' -name '.*.tmp' | wc -l | tr -d ' ')" 0 "L12: no temp file is left under any Work/Tasks"

echo
if [ "$fail" -eq 0 ]; then echo "leg.test.sh: ALL PASS"; else echo "leg.test.sh: FAILED"; fi
exit "$fail"
