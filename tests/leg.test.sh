#!/usr/bin/env bash
# skills/execute/scripts/leg.py: a serial rollout's Legs (ADR 0040, p24-3; skills/execute/legs.md).
#   L1   two Legs (5 + 2) with a handoff, then Complete: post-items, a follow-on, dispositions, the Completion log,
#        the archive and one vault commit; an Archive collision; next --waiting; file-followup after Complete reads
#        the archived note and writes nothing into it; L1v the routed land follow-on and its controls; done's
#        leg_head stamp (L1, L1v, L1h: each checkout's newest trailered commit of the task, never a peer's HEAD, [] when
#        it committed nowhere, none with no leg_base)
#   L1cv a serial chain's completion verify at Complete (ADR 0055): close refuses it undecided, writes its summary
#        line, puts a red's fix task in the vault commit, refuses a bare YAML boolean, and leaves a note without the
#        key byte-for-byte as before
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
#   L13  status (read-only, no lock): the chain states, the stall, the restart and its blockers, set-asides, per-Leg
#        lists, a take-over's lastAt, dependants and the defer closure, a terminal chain with no restart, next or
#        smoke list (L13g, L13o); restarted: its checks, in order
#   L14  the hold (ADR 0060): live and ready hold the whole claim, stuck only its set-aside row's surface; begin's
#        surface re-check is exit 3 (nothing written, --dry-run too) while another chain's unlanded row holds a smoke
#        row's surface, and status's restart names it as its blocker; a re-check that fails is exit 3 too and status's
#        blocker (L14f); a stuck chain with a row in progress, or no Queue rows, holds its whole claim with a warn (L14h)
#   L15  claim stamps one leg_base per checkout the row works (a file token's checkout, its launch folder's; the vault
#        never), and status's hold carries the order's began stamp and the open Leg (ADR 0067 d2, d4)
#   L16  Chain copies (ADR 0067 d2): `copies` makes each checkout's worktree on chain/<rollout> under the copy dir, cut
#        from the default branch, links the gitignored config (the toplevel's and a launch folder's; never a tracked or
#        un-ignored file), stamps chain_copies: after shape:, and refuses a copy dir under ~/repos, an occupied path, a
#        malformed key, one repository twice, this plugin's own checkout and the chain branch checked out in another
#        worktree (L16a); begin remakes a deleted copy on its branch, exit 4 naming the copy line, and logs the
#        primary folder (L16b, L16g); begin fast-forwards a clean copy to the primary's default branch, whatever the
#        primary has checked out, and its controls, landFirst when the chain branch has commits that branch lacks (L16c); claim stamps the copy and the primary bases, done passes a copy commit and refuses one in the
#        primary, which --revert reverts there, while a hand merge of the chain branch is never stray (L16d); two
#        chains in one repo hold separate HEADs and indexes (L16e); the hand-over, handed --manual and status's restart
#        open in the copy, with the alias's paste line (a cd-less alias's whole command) or its prose fallback, and a
#        missing copy blocks the restart (L16f); done's own-checkout rule across two copies (L16h); Complete refuses a
#        task not yet landed, then files only the origin half once land puts it on master, and a stuck route still files
#        a chain merged by hand (L16i); begin adds a hand-added row's pair, and claim refuses a top with none or a pair
#        whose copy is missing (L16j); claim refuses a dependency another chain finished whose commit the copy lacks,
#        naming its chain/<X> or the land that brings it in, and claims it once the work is there, or when the commit
#        is another repository's (L16k). L1-L15 are the in-place regression: their notes carry no chain_copies:.
#   L17  leg.py land (ADR 0067 d3, d4): two chains land in turn by merge, a stale --verified asks again (L17a), with
#        change's first-parent WARN (L17k), check_cause's land-merge outside (L17l) and a row with no Verify line (L17n);
#        a conflict stands and Complete waits, then a hand resolution lands (L17b); a peer's edit or an untracked file
#        refuses the ff, never a stash (L17c); --retire removes the copy and deletes its branch with -d, kept on any
#        refusal with a follow-on (L17d); both p36-3 interims retired (L17e, L17f); actual claims (L17g); the repo lock
#        (L17h); the stands that run no git, the refusals and the in-place peer (L17i); --red (L17j); the verified tip
#        (L17m); Complete's Land first before the completion verify, and a land that waits closes stopped (L17o); a
#        claim stand still brings in what other chains landed, so the claim it unblocks passes (L17q); the ff in P
#        re-reads P's branch after the peer check, and lands only when <d> is the tip (L17r).
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
export THREAD_HEAT_LEVEL=0   # the Heat hold's reading, pinned: a hot Mac never flips an assertion
# L1cv's completion-verify --run: the machine's verify slots and the detached verify trees stay in temp (ADR 0055)
export THREAD_VERIFY_SLOTS_DIR="$TMP/verify-slots" THREAD_COMPLETION_TREE_DIR="$TMP/trees"
# L16's Chain copies stay in temp (each L16 scenario points it at its own dir), and so does the launch-alias file a copy's
# manual launch line reads (absent unless a case writes it)
export THREAD_CHAIN_COPY_DIR="$TMP/chains" THREAD_LAUNCH_ALIASES="$TMP/aliases.zsh"
mkdir -p "$TMPDIR" "$TMP/bin"
# A fake gh and ssh: any call is logged and fails, so a test can assert no network was touched.
printf '#!/bin/sh\necho "gh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/gh"
printf '#!/bin/sh\necho "ssh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/fake-ssh"
chmod +x "$TMP/bin/gh" "$TMP/bin/fake-ssh"
export PATH="$TMP/bin:$PATH" GIT_SSH_COMMAND="$TMP/bin/fake-ssh"
: > "$TMP/net.log"
NOW=2026-10-20T10:00+00:00
REFL="close-score: demo-rollout-2026-10-20: recorded t-20261020T100000Z-abc123 (completion)"   # legs.md § Complete step 3's line

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
ok "$(fm t3 leg_base)|$(fm t3 leg_head)" "[]|<none>" "L1: an ext: chain's task has no leg_base entry, so done stamps no leg_head"
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
SESS=s2 leg next --waiting "room stop: L at its week's line"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=5/7 running=1 state=waiting reason=\"room stop: L at its week's line\"" \
   "L1: … and a week's line's, intact"
same "L1: … a week's line's writes nothing"
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
snap; SESS=s2 leg close --outcome complete --cwd "$F" --disposition 2="told them in the Monday note"
ok "$rc|$out" "2|" "L1: complete without --reflection is a usage error (exit 2, stdout empty)"
has "$err" "--reflection" "L1: … naming --reflection"; same "L1: no --reflection"
SESS=s2 leg close --outcome handoff --cwd "$F" --reflection "$REFL"
ok "$rc|$out" "2|" "L1: --reflection on a handoff close is a usage error"; same "L1: --reflection on handoff"
SESS=s2 leg close --outcome complete --cwd "$F" --reflection "$REFL"
ok "$rc" 1 "L1: complete without item 2's disposition is exit 1"; has "$err" "item(s) 2" "L1: … naming item 2"; same "L1: refused complete"
mkdir -p "$T/Archive/Rollouts"; echo x > "$T/Archive/Rollouts/$RO.md"
SESS=s2 leg close --outcome complete --cwd "$F" --disposition 2="told them in the Monday note" --reflection "$REFL"
ok "$rc" 1 "L1: an Archive collision is exit 1"; has "$err" "archive collision" "L1: … says so"; same "L1: the collision"
rm "${T:?}/Archive/Rollouts/${RO:?}.md"
SESS=s2 leg close --outcome complete --cwd "$F" --disposition 2="told them in the Monday note" --reflection "$REFL"
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
has "$cl" "- Reflection: $REFL" "L1: … and the Reflection line, close-score's line verbatim"
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
out=$(cd "$F" && python3 "$LEG" file-followup --title "Note the archive path" --why w --rollout "$A" --tasks-dir "$T" \
      --vault "$V" --now "$NOW" --session s2 2>"$TMP/err"); rc=$?
ok "$rc|$(q 'd["archived"]')|$(q 'd["pointer"]')|$(q 'd["followup"]')" "0|$A|False|demo-followup-note-the-archive-path" \
   "L1: … and by its Archive/Rollouts/ path, read as archived"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L1: … the archived note byte-identical: no pointer, no log line"
out=$(cd "$F" && python3 "$LEG" smoke --task t1 --result pass --rollout "$A" --tasks-dir "$T" --vault "$V" --now "$NOW" \
      --session s2 2>"$TMP/err"); rc=$?; err=$(cat "$TMP/err")
ok "$rc" 1 "L1: smoke by the Archive/Rollouts/ path is exit 1"; has "$err" "complete and archived" "L1: … saying so"
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
ok "$(fm t3 leg_head)" "[\"$R@$t3sha\"]" "L1v: done stamps leg_head, the task's own trailered commit in its checkout"
leg close --outcome complete --cwd "$R" --reflection "$REFL"
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
  leg close --outcome complete --cwd "$R" --reflection "$REFL"; ok "$rc" 0 "$1: complete"
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

# ════ L1h: done's leg_head, the task's own newest trailered commit per checkout (ADR 0055) ═════════════════════════
scen l1h
R="$S/r"; mkrepo "$R" https://github.com/o/rh.git; export CWD="$R"
mkro '' "t1~cc-r~$R~\`repo:$R\`" "t2~cc-r~$R~\`repo:$R\`"; mkt t1; NOVERIFY=1 mkt t2
leg begin --cwd "$R"; ok "$rc" 0 "L1h: begin"
leg claim --task t1; ok "$rc" 0 "L1h: claim t1"
tcommit "$R" t1 c.txt "t1 work"; t1sha=$(git -C "$R" rev-parse HEAD); d=$(review "$R" HEAD)
pcommit "$R" peer.txt p "chore: a peer's commit"
leg done --task t1 --verify pass --review "$d" --cwd "$R"; ok "$rc" 0 "L1h: done t1 with a peer's commit on top"
ok "$(fm t1 leg_head)" "[\"$R@$t1sha\"]" "L1h: leg_head is the task's own commit"
hasnt "$(fm t1 leg_head)" "$(git -C "$R" rev-parse HEAD)" "L1h: … never HEAD at done (the peer's commit)"
leg claim --task t2; ok "$rc" 0 "L1h: claim t2"
leg done --task t2 --cwd "$R"; ok "$rc" 0 "L1h: done t2, which committed nothing"
ok "$(fm t2 leg_base)|$(fm t2 leg_head)" "[\"$R@$(git -C "$R" rev-parse HEAD)\"]|[]" \
   "L1h: a task with a leg_base that committed nowhere → leg_head: []"
unset CWD

# ════ L1cv: a serial chain's completion verify at Complete (ADR 0055) ═════════════════════════════════════════════════
# cvchain <label> [completion_verifier value] — a one-task chain in $R (its one repo: surface), worked to done
cvchain() {
  local fm; R="$S/r"; mkrepo "$R" https://github.com/o/rcv.git; export CWD="$R"
  fm=$(printf '  - "repo:%s"' "$R"); [ -z "${2:-}" ] || fm="$fm"$'\n'"completion_verifier: $2"
  EXTRA_FM="$fm"$'\n' mkro '' "t9~cc-r~$R~\`repo:$R\`"; mkt t9
  git -C "$V" add -A; git -C "$V" commit -qm vault
  leg begin --cwd "$R"; ok "$rc" 0 "$1: begin"
  work "$R" t9 c.txt "c $1"
}
# rcv [args]… — reconcile-rollout.py completion-verify on the chain's note → $out $err $rc
rcv() {
  out=$(python3 "$RR" completion-verify --rollout "$T/$RO.md" --tasks-dir "$T" --now "$NOW" "$@" 2>"$TMP/err"); rc=$?
  err=$(cat "$TMP/err")
}
commit_files() { git -C "$V" show --name-status --no-renames --format= HEAD | sort -k2 | tr '\t\n' ' |'; }
scen l1cv; cvchain "L1cv (i)" '"true"'
snap; leg close --outcome complete --cwd "$R" --reflection "$REFL"
ok "$rc" 1 "L1cv (i): complete before the completion verify → exit 1"
has "$err" "the completion verify is not decided (run, attempt 1)" "L1cv (i): … it is not decided"; same "L1cv (i): the refused complete"
rcv --run; ok "$rc|$(q 'd["result"]')" "0|green" "L1cv (i): completion-verify --run → green on the chain's checkout"
sha=$(git -C "$R" rev-parse HEAD)
leg close --outcome complete --cwd "$R" --reflection "$REFL"
ok "$rc|$(q 'd["completionVerify"]["state"]')|$(q 'd["completionVerify"]["followup"]')" "0|green|None" "L1cv (i): then complete → exit 0"
A="$T/Archive/Rollouts/$RO.md"
has "$(sed -n '/^## Completion log/,$p' "$A")" "- Completion verify: green at ${sha:0:12} (\`true\`)" "L1cv (i): its summary is a Completion log line"
has "$(cat "$A")" "## Completion verify log" "L1cv (i): … and the archived note keeps its Completion verify log"
ok "$(git -C "$R" status --porcelain)|$(git -C "$R" worktree list | wc -l | tr -d ' ')" "|1" \
   "L1cv (i): the chain's checkout: an empty porcelain, no worktree left"
scen l1cv2; cvchain "L1cv (ii)" '"false"'
rcv --run; ok "$(q 'd["result"]')" rerun "L1cv (ii): false → rerun"
rcv --run; ok "$(q 'd["result"]')" red "L1cv (ii): … then red"
sha=$(git -C "$R" rev-parse HEAD)
leg close --outcome complete --cwd "$R" --reflection "$REFL"
ok "$rc|$(q 'd["completionVerify"]["state"]')|$(q 'd["completionVerify"]["followup"]')" "0|red|completion-red-$RO" \
   "L1cv (ii): a red still completes the chain, its fix task named"
A="$T/Archive/Rollouts/$RO.md"
has "$(sed -n '/^## Completion log/,$p' "$A")" "- Completion verify: red at ${sha:0:12} (rc 1, attempt 2); fix task [[completion-red-$RO]]" \
   "L1cv (ii): the red summary names the fix task"
has "$(commit_files)" "A Work/Tasks/completion-red-$RO.md|" "L1cv (ii): the fix task is in the vault commit"
ok "$(ls "$T" | grep -c '^completion-red-')" 1 "L1cv (ii): exactly one fix task"
scen l1cv3; cvchain "L1cv (iii)"
rcv; ok "$rc|$out" '0|{"verifier": null, "state": "absent"}' "L1cv (iii): no completion_verifier: → the read says absent"
leg close --outcome complete --cwd "$R" --reflection "$REFL"
ok "$rc|$(q '"completionVerify" in d')" "0|False" "L1cv (iii): complete → exit 0, no completionVerify"
fu=$(q '[f for f in d["followups"] if "-land-chain-" in f][0]')
A="$T/Archive/Rollouts/$RO.md"
hasnt "$(cat "$A")" "Completion verify" "L1cv (iii): … no Completion verify line and no log section"
ok "$(commit_files)" "A Work/Tasks/Archive/Rollouts/$RO.md|A Work/Tasks/$fu.md|D Work/Tasks/$RO.md|" \
   "L1cv (iii): the vault commit holds exactly the archived note, the land follow-on and the old path, as before"
scen l1cv4; cvchain "L1cv (iv)" 'true'
snap; leg close --outcome complete --cwd "$R" --reflection "$REFL"
ok "$rc" 1 "L1cv (iv): a bare completion_verifier: true → complete exits 1"
has "$err" "YAML boolean" "L1cv (iv): … naming the YAML boolean"; same "L1cv (iv): the refused complete"
rcv; ok "$rc" 2 "L1cv (iv): … and the read refuses it (2)"
ok "$(grep -c . "$TMP/net.log")" 0 "L1cv: no gh or ssh call was made"
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
leg next; ok "$(q 'd["task"]')" t3 "L3: the chain goes on: t3"
# execute § 3.7's exact `None` (legs.md § The task loop passes it as --gate) is no gate, as the engine reads it
leg claim --task t3 --gate None; ok "$rc|$(q 'd["unapproved"]')" "0|[]" "L3: claim --gate None is no gate: unapproved []"
leg done --task t3 --verify pass; ok "$rc" 0 "done t3"
leg next; ok "$(q 'd["task"]')" t5 "L3: t4 is held, t5 next"
has "$(q 'd["held"]')" "depends on [[t2]] (gate-pending)" "L3: … t4 held on t2's gate"
leg claim --task t5 --gate "- none."; ok "$rc|$(q 'd["unapproved"]')" "0|[]" "L3: … a bulleted, case-folded \`none.\` too"
leg done --task t5 --verify pass; ok "$rc" 0 "done t5"
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

# ════ L13: status and restarted (p24-4: /thread:status § 5, /thread:repair § 7) ══════════════════════════════════
# Every chain is built through leg.py's own verbs; status is read-only and takes no lock.
mstime() { python3 -c 'import time; print(int(time.time() * 1000))'; }
# (a) not started
scen l13a
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2
leg status
ok "$rc|$(q 'd["chain"]')|$(q 'd["openLeg"]')|$(q 'd["stall"]')|$(q 'd["legs"]')|$(q 'd["restarted"]')" "0|not-started|None|None|[]|None" \
   "L13a: a chain no Leg began reads not-started, no open Leg, no stall"
ok "$(q 'd["restart"]["leg"]')|$(q 'd["restart"]["task"]')|$(q 'd["restart"]["launch"]')|$(q 'd["restart"]["cwd"]')|$(q 'd["restart"]["harness"]')|$(q 'd["restart"]["anyLaunch"]')|$(q 'd["restart"]["blockedBy"]')" \
   "1|t1|cc-demo from $F|$F|claude|False|None" "L13a: … its restart is Leg 1 in row 1's launch, nothing blocking"
ok "$(q 'd["progress"]')|$(q 'd["note"]["archived"]')" "{'done': 0, 'total': 2, 'running': 0}|False" "L13a: … progress 0/2, live"
# (b) a Leg stopped holding t1; (b2) its successor between begin and claim --inherit
scen l13b
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3); for t in t1 t2 t3; do mkt "$t"; done
leg begin --cwd "$F"; leg claim --task t1; leg close --outcome stopped --reason "out of time"
leg status
ok "$(q 'd["chain"]')|$(q 'd["stall"]["claimed"][0]')" "stopped|{'task': 't1', 'owner': 'leg-1', 'leg': 1, 'legOutcome': 'stopped'}" \
   "L13b: a Leg stopped holding t1: stopped, with the stall naming t1"
ok "$(q 'd["restart"]["prompt"].split(chr(10))[0]')|$(q 'd["restart"]["takeOver"]')|$(q 'd["restart"]["blockedBy"]')" "/thread:execute [[$RO]]|False|None" \
   "L13b: … the restart prompt's first line runs the next Leg, no take-over"
ok "$(q 'd["next"]["action"]')|$(q 'd["next"]["task"]')|$(q 'd["next"]["inherit"]')" "finish|t1|True" "L13b: … next is finish t1, inherited"
has "$(q 'd["needsYou"]')" "stalled: no Leg is open" "L13b: … and a needs-you item for the stall"
ok "$(q 'd["legs"][0]["outcome"]')|$(q 'd["legs"][0]["claimed"]')" "stopped|[{'task': 't1', 'at': '$NOW'}]" "L13b: … Leg 1's outcome and claims"
SESS=s2 leg begin --cwd "$F"; ok "$rc|$(q 'd["leg"]')" "0|2" "L13b2: Leg 2 begins"
leg status
ok "$(q 'd["chain"]')|$(q 'd["openLeg"]')|$(q 'd["stall"]')|$(q 'd["progress"]["running"]')" "live|2|None|0" \
   "L13b2: before its claim --inherit: live, open Leg 2, no stall"
# (c) an open Leg of s1, read from s2; (k) restarted never checks the open Leg
scen l13c
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2
leg begin --cwd "$F"; leg claim --task t1
SESS=s2 leg status
ok "$(q 'd["chain"]')|$(q 'd["progress"]["running"]')|$(q 'd["restart"]["takeOver"]')|$(q 'd["restart"]["blockedBy"]')" "live|1|True|open Leg 1 (session s1)" \
   "L13c: an open Leg of s1, read from s2: live, a take-over restart blocked by the open Leg"
ok "$(q 'd["restart"]["prompt"].split(chr(10))[0]')|$(q 'd["restart"]["leg"]')|$(q 'd["restart"]["task"]')" "/thread:execute [[$RO]] --take-over|2|t1" \
   "L13c: … its prompt carries --take-over, for Leg 2 finishing t1"
SESS=r1 leg restarted --leg 2 --pending
ok "$rc|$(q 'd["recorded"]')|$(logn 'restart: Leg 2 pending (session r1)')" "0|True|1" "L13k: restarted over an open Leg records (it never checks the open Leg)"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')" "restarting|restart Leg 2 (pending)" "L13k: … restarting, blocked by the restart"
# (d) a halt holding a claim, then clear-halt; (k) the restart lifecycle on that stalled chain
scen l13d
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3); for t in t1 t2 t3; do mkt "$t"; done
leg begin --cwd "$F"; finish t1; leg claim --task t2; leg close --outcome halt --reason "a revert conflict"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["halt"]')" "halted|halt|{'reason': 'a revert conflict', 'leg': 1}" \
   "L13d: a halt holding t2: halted, the restart blocked by the halt"
has "$(q 'd["needsYou"]')" "halted at Leg 1: a revert conflict" "L13d: … a needs-you item for the halt"
snap; SESS=r1 leg restarted --leg 2 --pending; ok "$rc" 3 "L13k: restarted under a standing halt is exit 3"; same "L13k: halt"
leg clear-halt --reason "resolved by hand"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["restart"]["task"]')|$(q 'd["haltCleared"]')" "stalled|None|t2|[{'at': '$NOW', 'reason': 'resolved by hand', 'leg': 1}]" \
   "L13d: after clear-halt: stalled, nothing blocking the restart of t2"
snap; SESS= leg restarted --leg 2 --pending
ok "$rc" 1 "L13k: restarted with no session id is exit 1"; has "$err" "--session" "L13k: … naming --session"; same "L13k: unknown --pending"
SESS= leg restarted --leg 2 --started X; ok "$rc" 1 "L13k: … whatever the form"; same "L13k: unknown --started"
SESS=r1 leg restarted --leg 2 --pending --started X; ok "$rc|$out" "2|" "L13k: two forms are a usage error"
SESS=r1 leg restarted --leg 2 --pending
ok "$rc|$(q 'd["recorded"]')|$(q 'd["restarted"]["how"]')|$(q 'd["restarted"]["session"]')" "0|True|pending|r1" "L13k: r1 --pending records"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')" "restarting|restart Leg 2 (pending)" "L13k: … restarting, blocked by the restart"
snap; SESS=r2 leg restarted --leg 2 --pending
ok "$rc" 3 "L13k: a second repair's --pending is exit 3"; has "$err" "a restart of Leg 2 stands (pending" "L13k: … naming the standing restart"
same "L13k: r2 --pending"
SESS=r1 leg restarted --leg 2 --pending; ok "$rc|$(q 'd["recorded"]')" "0|False" "L13k: the same line again records nothing"; same "L13k: r1 again"
SESS=r1 leg restarted --leg 2 --started X
ok "$rc|$(q 'd["recorded"]')|$(q 'd["restarted"]["how"]')|$(q 'd["restarted"]["started"]')" "0|True|started|X" "L13k: r1's own --started is the update"
snap; SESS=r2 leg restarted --leg 2 --manual "no host tool"
ok "$rc" 3 "L13k: r2 --manual over a started restart is exit 3"; has "$err" "--replace" "L13k: … naming --replace"; same "L13k: r2 --manual"
SESS=r2 leg restarted --leg 2 --manual "no host tool" --replace
ok "$rc|$(q 'd["restarted"]["how"]')|$(q 'd["restarted"]["manual"]')" "0|manual|no host tool" "L13k: … with --replace it records"
snap; SESS=r2 leg restarted --leg 3 --pending; ok "$rc" 1 "L13k: --leg 3 (not the next Leg) is exit 1"; same "L13k: --leg 3"
printf -- '- %s restart: Leg 2 pending (session unknown)\n' "$NOW" >> "$T/$RO.md"
leg status; ok "$(q 'd["restarted"]["how"]')|$(q 'd["restarted"]["session"]')" "pending|unknown" "L13k: a hand-written pending line of session unknown stands"
ok "$(q '[x["how"] for x in d["restarts"]]')" "['pending', 'started', 'manual', 'pending']" "L13k: … status lists every restart line"
snap; SESS=r9 leg restarted --leg 2 --started X; ok "$rc" 3 "L13k: … and never matches: exit 3"; same "L13k: unknown pending"
SESS=s2 leg begin --cwd "$F"; ok "$rc|$(q 'd["leg"]')|$(q 'd["inherited"]')" "0|2|['t2']" "L13k: Leg 2 begins and inherits t2"
ok "$(logn 'Leg 2 began: leg-2 session s2')" 1 "L13k: … its began line reads Leg 2"
leg status; ok "$(q 'd["chain"]')|$(q 'd["restarted"]')" "live|None" "L13k: … live, and no restart stands"
snap; SESS=r3 leg restarted --leg 2 --started Z
ok "$rc|$(q 'd["recorded"]')|$(q 'd["began"]')" "0|False|True" "L13k: a later --started for a begun Leg records nothing"; same "L13k: began"
# (e) a handoff: no hand-over line, then started; and a manual one
scen l13e
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4 t5 t6 t7); for t in t1 t2 t3 t4 t5 t6 t7; do mkt "$t"; done
leg begin --cwd "$F"; for t in t1 t2 t3 t4 t5; do finish "$t"; done; leg close --outcome handoff
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["restart"]["task"]')" "awaiting-successor|None|t6" \
   "L13e: a handoff with no hand-over line: awaiting-successor, nothing blocking"
# (h) per-Leg event lists equal the log lines
ok "$(q '",".join(x["task"] for x in d["legs"][0]["claimed"])')|$(q '",".join(x["task"] for x in d["legs"][0]["done"])')" "t1,t2,t3,t4,t5|t1,t2,t3,t4,t5" "L13h: Leg 1's claimed and done lists"
ok "$(q 'len(d["legs"][0]["claimed"])')|$(q 'len(d["legs"][0]["done"])')" "$(logn 'Leg 1 claimed ')|$(logn 'Leg 1 done ')" "L13h: … equal its log lines"
leg handed --started task_x
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["legs"][0]["handover"]')" "awaiting-successor|handover started task_x|started task_x" \
   "L13e: started: the restart is blocked by the started Session"
scen l13e2
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2
leg begin --cwd "$F"; finish t1; leg close --outcome handoff; leg handed --manual "no host tool"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["blockedBy"]')" "awaiting-successor|None" "L13e: a manual hand-over blocks nothing"
has "$(q 'd["needsYou"]')" "manual hand-over: start Leg 2 in cc-demo from $F" "L13e: … it is a needs-you item"
# (f) stuck: a gate and a block, their dependants and fingerprints
scen l13f
G1='spend: OpenAI API for the audit — cap 5 USD'
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3); mkt t1; mkt t2; mkt t3 'depends-on:' '  - "[[t1]]"'
leg begin --cwd "$F"; leg claim --task t1 --gate "$G1"; leg set-aside --task t1 --kind gate --gate "$G1" --reason "unapproved gate"
leg claim --task t2; leg set-aside --task t2 --reason "blocked on a missing key"
leg close --outcome stuck
git -C "$V" add -A; git -C "$V" commit -qm vault
leg status
ok "$(q 'd["chain"]')|$(q 'd["rows"][0]["setAside"]["status"]')|$(q 'd["rows"][0]["setAside"]["gates"]')" "stuck|gate-pending|['$G1']" \
   "L13f: stuck, t1 set aside at its gate, the gate listed"
ok "$(q 'd["rows"][1]["setAside"]["summary"]')" "Set aside by Leg 1 of [[$RO]]: blocked on a missing key" "L13f: t2's summary is its diagnosis"
fp=$(python3 -c 'import importlib.util, sys, pathlib
s = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(m._block_fingerprint(m.Note(pathlib.Path(sys.argv[2]))))' "$RR" "$T/t2.md")
ok "$(q 'd["rows"][1]["setAside"]["fingerprint"]')|$(q 'd["rows"][0]["setAside"]["fingerprint"]')" "$fp|None" "L13f: … its fingerprint is rr._block_fingerprint ($fp); a gate has none"
ok "$(q 'd["rows"][2]["held"]')|$(q 'd["rows"][0]["dependants"]')" "depends on [[t1]] (gate-pending)|[{'slug': 't3', 'state': 'queued', 'owner': None}]" \
   "L13f: t3 is held on t1, and is t1's dependant"
# (i) read-only: nothing changes, and it answers while another verb holds the lock
before=$( { git -C "$V" status --porcelain; find "$V" -path "$V/.git" -prune -o -type f -print | sort | xargs shasum; ls -l "$THREAD_LEG_LOCK_DIR"; } 2>&1)
hold "$TMP/held-l13"
t0=$(mstime); leg status; t1=$(mstime)
ok "$rc|$([ $((t1 - t0)) -lt 5000 ] && echo fast)" "0|fast" "L13i: status answers in under 5 s while the lock is held ($((t1 - t0)) ms)"
kill "$hp"; wait "$hp" 2>/dev/null
after=$( { git -C "$V" status --porcelain; find "$V" -path "$V/.git" -prune -o -type f -print | sort | xargs shasum; ls -l "$THREAD_LEG_LOCK_DIR"; } 2>&1)
ok "$after" "$before" "L13i: … and writes nothing: the porcelain, every file's sha1 and the lock dir are unchanged"
# (g) L1's chain, from the Archive
A1="$TMP/l1/vault/Work/Tasks/Archive/Rollouts/$RO.md"; c1=$(cksum < "$A1")
T="$TMP/l1/vault/Work/Tasks" V="$TMP/l1/vault" leg status
ok "$rc|$(q 'd["chain"]')|$(q 'd["note"]["archived"]')|$(q 'd["note"]["status"]')|$(q 'd["progress"]')" "0|complete|True|done|{'done': 7, 'total': 7, 'running': 0}" \
   "L13g: L1's archived chain reads complete"
ok "$(q '[g["outcome"] for g in d["legs"]]')" "['handoff', 'complete']" "L13g: … Leg 1 handed off, Leg 2 completed"
ok "$(q 'd["restart"]')|$(q 'd["next"]')|$(q 'd["smoke"]')" "None|None|[]" \
   "L13g: … no restart, no next act and no smoke list: begin refuses a complete chain"
T="$TMP/l1/vault/Work/Tasks" V="$TMP/l1/vault" SESS=r1 leg restarted --leg 3 --pending
ok "$rc" 1 "L13k: restarted on an archived note is exit 1"; ok "$(cksum < "$A1")" "$c1" "L13g: … the archived note unchanged"
# (j) a non-serial note, and no note
scen l13j
mkro '' $(rows cc-demo "$F" '`ext:x`' t1); mkt t1; subst "$T/$RO.md" 'shape: serial' 'shape: parallel'
leg status; ok "$rc|$(q 'd["exit"]')" "1|1" "L13j: a parallel note is exit 1"; has "$err" "read it with reconcile-rollout.py status" "L13j: … with the hint"
rm "${T:?}/${RO:?}.md"; leg status; ok "$rc" 1 "L13j: a missing note is exit 1"
# (l) completable: a Complete Leg begins from the last Leg's folder or any folder but this plugin's checkout
scen l13l
FA="$S/a"; mkdir -p "$FA" "$S/elsewhere"
mkro '' $(rows cc-a "$FA" '`ext:x`' t1 t2); mkt t1; mkt t2
export CWD="$FA"
leg begin --cwd "$FA"; finish t1; finish t2; leg close --outcome stopped --reason "out of context"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["anyLaunch"]')|$(q 'd["restart"]["launch"]')|$(q 'd["restart"]["harness"]')|$(q 'd["restart"]["cwd"]')" "completable|True|None|None|$FA" \
   "L13l: every row done, no Leg open: completable, a restart in any launch from Leg 1's folder"
snap; leg begin --cwd "$FA" --dry-run; ok "$rc|$(q 'd["leg"]')" "0|2" "L13l: begin --dry-run from restart.cwd"
CWD="$S/elsewhere" leg begin --cwd "$S/elsewhere" --dry-run
ok "$rc|$(q 'd["launch"]["folder"]')" "0|$S/elsewhere" "L13l: … and from an unrelated folder, which becomes its launch"
TS="$S/ts"; mkrepo "$TS" https://github.com/lachyts/thread-skill.git
CWD="$TS" leg begin --cwd "$TS" --dry-run; ok "$rc" 1 "L13l: … but never from this plugin's own checkout"; has "$err" "this plugin's own checkout" "L13l: … naming it"
same "L13l: the dry runs"
unset CWD
# (m) a take-over: the lost Leg's lastAt is its own last line, never the taker's
scen l13m
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2
LNOW=2026-10-20T10:05+00:00 leg begin --cwd "$F"; LNOW=2026-10-20T10:10+00:00 leg claim --task t1
LNOW=2026-10-20T11:00+00:00 SESS=s2 leg begin --cwd "$F" --take-over
leg status
ok "$(q 'd["legs"][0]["outcome"]')|$(q 'd["legs"][0]["lastAt"]')|$(q 'd["legs"][0]["closedStamp"]')|$(q 'd["legs"][1]["tookOver"]')" \
   "lost|2026-10-20T10:10+00:00|2026-10-20T11:00+00:00|1" "L13m: a lost Leg's lastAt is its own claim, not the taker's close line"
# (n) dependants, and the defer closure (repair § 7 (b))
scen l13n
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3 t4 t5)
mkt t1; mkt t2 'depends-on:' '  - "[[t1]]"'; mkt t3 'blocked-by:' '  - "[[t2]]"'; mkt t4; mkt t5 'depends-on:' '  - "[[m]]"'
printf -- '---\ntags: [task]\nstatus: merged\nmerged_into: "[[t1]]"\n---\n\nFolded into [[t1]].\n' > "$T/m.md"
leg begin --cwd "$F"; leg claim --task t1; leg set-aside --task t1 --reason "blocked on a missing key"
leg next; ok "$(q 'd["task"]')" t4 "L13n: t2, t3 and t5 are held, so t4 is next"; finish t4; leg close --outcome stuck
cp -R "$V" "$S/vault2"
leg status
ok "$(q 'd["chain"]')|$(q '[x["slug"] for x in d["rows"][0]["dependants"]]')|$(q 'd["rows"][3]["dependants"]')" "stuck|['t2', 't3', 't5']|[]" \
   "L13n: stuck; t1's dependants are t2, t3 (blocked-by) and t5 (through the tombstone m)"
ok "$(q 'd["rows"][4]["deps"]')" "['t1']" "L13n: … t5's dependency resolves through m to t1"
snap; python3 "$RR" defer --tasks t1 --rollout "$T/$RO.md" --tasks-dir "$T" > "$TMP/df" 2>&1; ok "$?" 0 "L13n1: defer t1 alone"
leg status
ok "$(q 'd["chain"]')|$(q 'd["rows"][0]["state"]')|$(q 'd["rows"][1]["held"]')" "stuck|deferred|depends on [[t1]] (open)" \
   "L13n1: deferring t1 alone strands its dependants: the chain stays stuck, t2 held on the open t1"
same "L13n1: defer never writes the rollout note"
T2="$S/vault2/Work/Tasks"; cp "$T2/$RO.md" "$TMP/snap2"
python3 "$RR" defer --tasks t1,t2,t3,t5 --rollout "$T2/$RO.md" --tasks-dir "$T2" > "$TMP/df" 2>&1; ok "$?" 0 "L13n2: defer the closure"
T="$T2" V="$S/vault2" leg status
ok "$(q 'd["chain"]')|$(q '[r["state"] for r in d["rows"]]')" "completable|['deferred', 'deferred', 'deferred', 'done', 'deferred']" \
   "L13n2: deferring the closure makes the chain completable"
cmp -s "$T2/$RO.md" "$TMP/snap2"; ok "$?" 0 "L13n2: … and the rollout note is byte-identical"
# (o) the terminal states: dropped, superseded and incomplete print no restart, no next and no smoke list; paused
# keeps them (what runs once the stamp is gone)
scen l13o
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2
leg begin --cwd "$F"; finish t1; leg close --outcome stopped --reason "out of time"
cp "$T/$RO.md" "$TMP/l13o-note"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["task"]')|$(q 'd["next"]["action"]')|$(q '[x["task"] for x in d["smoke"]]')" "stopped|t2|claim|['t1']" \
   "L13o: stopped with t1 done: a restart of t2, next claims it, t1 on the smoke list"
for st in 'status: dropped|dropped' 'superseded_by: "[[other-rollout]]"|superseded' 'incomplete: true|incomplete' \
          'paused: 2026-10-20T10:00+00:00|paused'; do
  line=${st%|*}; want=${st#*|}
  cp "$TMP/l13o-note" "$T/$RO.md"
  if [ "$want" = dropped ]; then subst "$T/$RO.md" 'status: open' "$line"; else subst "$T/$RO.md" 'status: open' "status: open
$line"; fi
  leg status
  if [ "$want" = paused ]; then
    ok "$rc|$(q 'd["chain"]')|$(q 'd["restart"]["task"]')|$(q 'd["next"]["action"]')|$(q 'len(d["smoke"])')" "0|paused|t2|claim|1" \
       "L13o: paused keeps the restart, next and smoke list"
  else
    ok "$rc|$(q 'd["chain"]')|$(q 'd["restart"]')|$(q 'd["next"]')|$(q 'd["smoke"]')" "0|$want|None|None|[]" \
       "L13o: $want prints no restart, no next and no smoke list"
  fi
done

# ════ L14: the hold and the surface re-check (ADR 0060, p33-2) ═════════════════════════════════════════════════════
scen l14
VA='`vault:Work/Projects/A`'; VB='`vault:Work/Projects/B`'
mkro '' "t1~cc-demo~$F~$VA" "t2~cc-demo~$F~$VB"; mkt t1; mkt t2
subst "$T/$RO.md" '  - "ext:x"' $'  - "vault:Work/Projects/A"\n  - "vault:Work/Projects/B"'
leg begin --cwd "$F"; finish t1; leg claim --task t2
leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["hold"]["held"]')" "live|whole|['vault:Work/Projects/A', 'vault:Work/Projects/B']" \
   "L14: a live chain holds its whole claim"
leg set-aside --task t2 --reason "blocked on a missing key"; leg close --outcome stuck
leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["hold"]["held"]')|$(q 'd["hold"]["released"]')" \
   "stuck|stuck|['vault:Work/Projects/B']|['vault:Work/Projects/A']" "L14: a stuck chain holds only its set-aside row's surface"
ok "$(q 'd["hold"]["rows"]')" "[{'slug': 't2', 'state': 'set-aside', 'surfaces': ['vault:Work/Projects/B'], 'folder': '$F'}]" "L14: … naming the row and its launch folder"
python3 "$RR" hand-back --tasks t2 --tasks-dir "$T" > "$TMP/hb" 2>&1
leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["restart"]["blockedBy"]')" "ready|whole|None" \
   "L14: handed back, the chain reads ready and reclaims its whole claim; nothing blocks Leg 2"
# Another chain, scheduled on vault:Work/Projects/A while this one was stuck
B=other-rollout-2026-10-21
{ printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nshape: serial\nprojects:\n  - "[[Other]]"\n'
  printf -- 'surfaces:\n  - "vault:Work/Projects/A"\n---\n\n## Notes\n\nA chain.\n\n## Queue\n\n| # | Task | Launch | Surfaces |\n|---|---|---|---|\n'
  printf -- '| 1 | [[u1\\|u1]] | `cc-demo` from `%s` | `vault:Work/Projects/A` |\n' "$F"; } > "$T/$B.md"
printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[%s]]"\n---\n\n## Notes\n\nDo u1.\n' "$B" > "$T/u1.md"
leg status
ok "$(q 'd["restart"]["blockedBy"]')" "surface held by [[$B]] (vault:Work/Projects/A)" \
   "L14: status: Leg 2's restart is blocked by the chain that now holds its smoke row's surface"
snap; SESS=s2 leg begin --cwd "$F" --dry-run
ok "$rc|$(q 'd["exit"]')" "3|3" "L14: begin --dry-run runs the re-check too: exit 3"; same "L14: --dry-run"
snap; SESS=s2 leg begin --cwd "$F"
ok "$rc|$(q 'd["held"]')" "3|[{'rollout': '$B', 'token': 'vault:Work/Projects/A'}]" "L14: begin is exit 3, naming what holds it"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=1/2 running=0 state=halted reason=\"surface held: [[$B]] holds vault:Work/Projects/A\"" \
   "L14: … its status line"
has "$(q 'd["error"]')" "this chain waits its turn" "L14: … and its error says it waits its turn"
same "L14: a held begin writes nothing"
subst "$T/$B.md" 'status: open' 'status: dropped'
SESS=s2 leg begin --cwd "$F"
ok "$rc|$(q 'd["leg"]')|$(q '[x["task"] for x in d["smoke"]]')" "0|2|['t1']" "L14: once that chain is dropped, Leg 2 begins"
# The re-check fails closed: a --rollout outside --tasks-dir gives a --resume naming no note there, so the check exits 2
scen l14f
mkro '' "t1~cc-demo~$F~$VA" "t2~cc-demo~$F~$VB"; mkt t1; mkt t2
AWAY="$S/away"; mkdir -p "$AWAY"; mv "$T/$RO.md" "$AWAY/$RO.md"
legaway() { out=$(cd "$F" && python3 "$LEG" "$@" --rollout "$AWAY/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" \
                  --session s1 2>"$TMP/err"); rc=$?; err=$(cat "$TMP/err"); }
cp "$AWAY/$RO.md" "$TMP/snap"; cp "$T/t1.md" "$TMP/snap-t1"
legaway begin --cwd "$F"
ok "$rc|$(q 'd["exit"]')" "3|3" "L14f: a surface re-check that fails is exit 3 (fail closed)"
has "$(q 'd["error"]')" "surface re-check failed: unfinished-rollout: --resume $RO: no rollout note at " \
   "L14f: … its error names the check's own line (capped at 160 characters)"
ok "$(q 'd["error"].startswith("surface re-check failed: ")')" True "L14f: … and starts with surface re-check failed:"
has "$(q 'd["status_line"]')" "state=halted reason=\"surface re-check failed: unfinished-rollout: --resume $RO" "L14f: … its status line"
cmp -s "$AWAY/$RO.md" "$TMP/snap"; ok "$?" 0 "L14f: the rollout note is byte-identical"
cmp -s "$T/t1.md" "$TMP/snap-t1"; ok "$?" 0 "L14f: … and so is the first row's task: nothing written"
legaway status
ok "$rc|$(q 'd["chain"]')" "0|not-started" "L14f: status reads the chain"
ok "$(q 'd["restart"]["blockedBy"].startswith("surface re-check failed: unfinished-rollout: --resume ")')" True \
   "L14f: … and its restart's blocker is the failed re-check"
# hold_of fails closed to the whole claim, with its warn, on a stuck chain it cannot narrow safely
scen l14h
VC='`vault:Work/Projects/C`'
mkro '' "t1~cc-demo~$F~$VA" "t2~cc-demo~$F~$VB" "t3~cc-demo~$F~$VC"; mkt t1; mkt t2; mkt t3
subst "$T/$RO.md" '  - "ext:x"' $'  - "vault:Work/Projects/A"\n  - "vault:Work/Projects/B"\n  - "vault:Work/Projects/C"'
leg begin --cwd "$F"; finish t1; leg claim --task t2; leg set-aside --task t2 --reason "blocked on a missing key"
subst "$T/t3.md" 'status: open' $'status: in_progress\nowner: lachy'
leg close --outcome stuck
leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["hold"]["held"]')|$(q 'd["hold"]["released"]')" \
   "stuck|whole|['vault:Work/Projects/A', 'vault:Work/Projects/B', 'vault:Work/Projects/C']|[]" \
   "L14h: a stuck chain with a row in progress (owned by hand) holds its whole claim"
ok "$(q 'd["hold"]["warn"]')" "chain stuck, but [[t3]] reads in progress: it holds its whole claim" "L14h: … with its warn"
mkro ''
subst "$T/$RO.md" '  - "ext:x"' '  - "vault:Work/Projects/A"'
printf -- '\n## Leg log\n\n- 2026-10-20T09:00+00:00 Leg 1 began: leg-1 session s1 in cc-demo from %s\n- 2026-10-20T09:30+00:00 Leg 1 closed: chain stuck: 0 set aside\n' "$F" >> "$T/$RO.md"
leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["hold"]["held"]')|$(q 'd["hold"]["unlanded"]')" \
   "stuck|whole|['vault:Work/Projects/A']|['vault:Work/Projects/A']" "L14h: a stuck chain whose ## Queue has no rows holds its whole claim"
ok "$(q 'd["hold"]["warn"]')" "chain stuck, but its ## Queue has no rows: it holds its whole claim" "L14h: … with its warn"
# ════ L15: stamp_bases, one base per checkout the row works, and the hold's order fields (ADR 0067 d2, d4) ═════════
scen l15
R="$S/r"; mkrepo "$R" https://github.com/o/r15.git; export CWD="$R"
mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`" "t2~cc-r~$R~\`ext:x\` \`vault:Work/Projects/A\`"; mkt t1; mkt t2
leg status
ok "$(q 'd["hold"]["began"]')|$(q 'd["hold"]["open"]')" "None|None" "L15: before Leg 1 the hold has no began stamp and no open Leg"
leg begin --cwd "$R"; ok "$rc" 0 "L15: begin"
leg status
ok "$(q 'd["hold"]["began"]')|$(q 'd["hold"]["open"]')" "$NOW|{'n': 1, 'folder': '$R'}" "L15: status's hold carries the first began stamp and the open Leg"
base=$(git -C "$R" rev-parse HEAD)
leg claim --task t1
ok "$rc|$(fm t1 leg_base)" "0|[\"$R@$base\"]" "L15: a claim on a row whose cell holds a file token stamps its checkout"
leg done --task t1 --verify pass; ok "$rc" 0 "L15: done t1"
leg claim --task t2
ok "$rc|$(fm t2 leg_base)" "0|[\"$R@$base\"]" "L15: a row with only ext: and vault tokens, launched in a checkout, stamps that checkout"
scen l15v
git -C "$V" commit -q --allow-empty -m vault; export CWD="$V"
mkro '' "t1~cc-v~$V~\`ext:x\`"; mkt t1
leg begin --cwd "$V"; ok "$rc" 0 "L15: begin from the vault"
leg claim --task t1
ok "$rc|$(fm t1 leg_base)" "0|[]" "L15: a vault-launched row stamps nothing"
unset CWD

# ════ L16: Chain copies (ADR 0067 d2) ═══════════════════════════════════════════════════════════════════════════════
# cscen <name> — scen, with this scenario's own copy dir $S/chains
cscen() { scen "$1"; export THREAD_CHAIN_COPY_DIR="$S/chains"; rm -f "$THREAD_LAUNCH_ALIASES"; }
# crepo <dir> <origin url> — mkrepo, plus a .gitignore of the config files, a tracked launch folder sub/l and a tracked
# .claude/settings.json; then the gitignored config at the toplevel and in sub/l, and an un-ignored untracked file
crepo() {
  mkrepo "$1" "$2"
  printf '.mcp.json\n**/.mcp.json\n.claude/settings.local.json\n' > "$1/.gitignore"
  mkdir -p "$1/sub/l" "$1/.claude"; echo keep > "$1/sub/l/keep.txt"; echo '{}' > "$1/.claude/settings.json"
  git -C "$1" add -A; git -C "$1" commit -qm "ignore the config"; git -C "$1" update-ref refs/remotes/origin/master HEAD
  echo '{"m":1}' > "$1/.mcp.json"; echo '{"l":1}' > "$1/.claude/settings.local.json"; echo '{"s":1}' > "$1/sub/l/.mcp.json"
  echo loose > "$1/loose.txt"
}
fmline() { grep -A1 '^shape: serial' "$T/$RO.md" | tail -n 1; }

cscen l16a
R="$S/r"; crepo "$R" https://github.com/o/r16.git; C="$S/chains/r-$RO"
git -C "$R" checkout -qb w; pcommit "$R" wip.txt wip "wip on w"   # $R works on a WIP branch: the copy is cut from master
mkdir -p "$S/plain"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`" "t2~cc-r~$R/sub/l~\`repo:$S/plain\`"; mkt t1; mkt t2
git -C "$V" add -A; git -C "$V" commit -qm vault
snap; leg copies --dry-run
ok "$rc|$(q 'd["stamped"]')|$(q 'd["copies"][0]["copy"]')|$(q 'd["copies"][0]["made"]')" "0|True|$C|True" \
   "L16a: copies --dry-run reports the copy it would make"
ok "$(test -e "$C" && echo y || echo n)" n "L16a: … and makes nothing"; same "L16a: copies --dry-run"
snap; LEGENV="THREAD_CHAIN_COPY_DIR=$HOME/repos/chains" leg copies
ok "$rc|$(test -e "$HOME/repos/chains" && echo y || echo n)" "1|n" "L16a: a copy dir under ~/repos is refused (exit 1), nothing made"
has "$err" "at or under ~/repos" "L16a: … saying so"; same "L16a: a copy dir under ~/repos"
leg copies
ok "$rc|$(q 'd["stamped"]')|$(q 'd["copies"][0]["checkout"]')|$(q 'd["copies"][0]["branch"]')|$(q 'd["copies"][0]["base"]')" \
   "0|True|$R|chain/$RO|master" "L16a: copies makes \$R's Chain copy on chain/\$RO, cut from master"
ok "$(git -C "$C" rev-parse --show-toplevel)|$(git -C "$C" symbolic-ref HEAD)|$(git -C "$C" rev-parse HEAD)" \
   "$C|refs/heads/chain/$RO|$(git -C "$R" rev-parse master)" "L16a: … a worktree at \$S/chains/r-\$RO, on master's commit though \$R is on w"
ok "$(git -C "$R" symbolic-ref --short HEAD)" w "L16a: … and \$R stays on w"
ok "$(fm "$RO" chain_copies)|$(fmline)" "[\"$R -> $C\"]|chain_copies: [\"$R -> $C\"]" "L16a: chain_copies: stamped with the one pair, after shape:"
ok "$(readlink "$C/.mcp.json")|$(readlink "$C/.claude/settings.local.json")|$(readlink "$C/sub/l/.mcp.json")" \
   "$R/.mcp.json|$R/.claude/settings.local.json|$R/sub/l/.mcp.json" "L16a: the gitignored config is linked, at the toplevel and in the launch folder"
ok "$(q 'd["copies"][0]["linked"]')" "['.mcp.json', '.claude/settings.local.json', 'sub/l/.mcp.json']" "L16a: … and listed"
ok "$(test -e "$C/loose.txt" && echo y || echo n)|$(test -L "$C/.claude/settings.json" && echo link || echo own)" "n|own" \
   "L16a: an un-ignored untracked file is never linked, and a tracked file is the copy's own"
ok "$(git -C "$C" status --porcelain)" "" "L16a: the copy is clean"
has "$(q 'd["warns"]')" "WARN: $S/plain is in no git checkout: no Chain copy (it is no checkout's index)" \
   "L16a: control: a repo: path in no git gets no copy, with a WARN, beside the one pair"
snap; leg copies
ok "$rc|$(q 'd["copies"][0]["made"]')|$(q 'd["stamped"]')|$(q 'd["copies"][0]["linked"]')" "0|False|False|[]" "L16a: a second run makes and stamps nothing"
same "L16a: a second copies"
# a tracked .mcp.json and an un-ignored settings.local.json are never linked
RT="$S/rt"; mkrepo "$RT" https://github.com/o/rt.git; echo '{}' > "$RT/.mcp.json"; git -C "$RT" add -A; git -C "$RT" commit -qm mcp
mkdir -p "$RT/.claude"; echo '{}' > "$RT/.claude/settings.local.json"
mkro '' "t1~cc-rt~$RT~\`repo:$RT//a.txt\`"; leg copies
ok "$rc|$(test -L "$S/chains/rt-$RO/.mcp.json" && echo link || echo own)|$(test -e "$S/chains/rt-$RO/.claude/settings.local.json" && echo y || echo n)" \
   "0|own|n" "L16a: a tracked .mcp.json is the copy's own, and an un-ignored settings.local.json is never linked"
# refusals: an occupied copy path, a malformed key; the note unwritten
cscen l16a2
R="$S/r"; crepo "$R" https://github.com/o/r16b.git; C="$S/chains/r-$RO"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`"; mkt t1
mkdir -p "$C"; snap; leg copies
ok "$rc" 1 "L16a: a copy path held by a plain directory is refused (exit 1)"
has "$err" "$C exists and is not $R's Chain copy on chain/$RO" "L16a: … naming it"; same "L16a: an occupied copy path"
rmdir "$C"; subst "$T/$RO.md" 'shape: serial' "shape: serial
chain_copies: [\"$R\"]"
snap; leg copies
ok "$rc" 1 "L16a: a malformed chain_copies: is refused (exit 1)"; has "$err" "chain_copies: " "L16a: … naming the key"
same "L16a: a malformed chain_copies:"
ok "$(test -e "$C" && echo y || echo n)" n "L16a: … and nothing is made"
# refusals: one repository twice (a primary and its linked worktree), this plugin's own checkout, the chain branch checked
# out in another worktree (the copy deleted, the branch then checked out in the primary); each the note unwritten
cscen l16a3
R="$S/r"; crepo "$R" https://github.com/o/r16a3.git; W="$S/rw"; git -C "$R" worktree add -q -b side "$W"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`" "t2~cc-w~$W~\`repo:$W//b.txt\`"; mkt t1; mkt t2
snap; leg copies
ok "$rc|$(test -e "$S/chains" && echo y || echo n)" "1|n" "L16a: a primary and its linked worktree in one chain are refused (exit 1), nothing made"
has "$err" "$R and $W are one repository (git common dir $R/.git): a chain copies a repository once, from its primary checkout; nothing written" \
   "L16a: … naming both and their common dir"
same "L16a: one repository twice"
cscen l16a4
TS="$S/ts"; crepo "$TS" https://github.com/lachyts/thread-skill.git
mkro '' "t1~cc-ts~$TS~\`repo:$TS//a.txt\`"; mkt t1
snap; leg copies
ok "$rc|$(test -e "$S/chains" && echo y || echo n)" "1|n" "L16a: this plugin's own checkout is refused (exit 1), nothing made"
has "$err" "$TS is this plugin's own checkout: there are no serial self-rollouts (ADR 0040); nothing written" "L16a: … naming it"
same "L16a: this plugin's own checkout"
cscen l16a5
R="$S/r"; crepo "$R" https://github.com/o/r16a5.git; C="$S/chains/r-$RO"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`"; mkt t1
leg copies; ok "$rc" 0 "L16a: copies"
rm -rf "$C"; git -C "$R" worktree prune; git -C "$R" checkout -q "chain/$RO"
snap; leg copies
ok "$rc|$(test -e "$C" && echo y || echo n)" "1|n" "L16a: chain/\$RO checked out in the primary is refused (exit 1), the copy not remade"
has "$err" "chain/$RO is checked out in $R, not in its Chain copy $C: check it out elsewhere there, then run again; nothing written" \
   "L16a: … naming the worktree that holds it"
same "L16a: the chain branch checked out elsewhere"

# ════ L16b: begin remakes a deleted copy on its branch; exit 4 names the copy's launch; the began line its primary ═══
cscen l16b
R="$S/r"; crepo "$R" https://github.com/o/r16c.git; C="$S/chains/r-$RO"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`"; mkt t1
leg copies; ok "$rc" 0 "L16b: copies"
tcommit "$C" t0 early.txt "early chain work"; early=$(git -C "$C" rev-parse HEAD)
rm -rf "$C"
snap; CWD="$R" leg begin --cwd "$R"
ok "$rc|$(git -C "$C" rev-parse HEAD)|$(git -C "$C" symbolic-ref HEAD)" "4|$early|refs/heads/chain/$RO" \
   "L16b: begin from the primary remakes the deleted copy on its branch, its earlier commit kept, then exit 4"
ok "$(q 'd["launch"]')" "cc-r from $C/sub/l: cd there, then run cc-r's command without its cd (\`alias cc-r\` prints it); never cc-r itself, since cc-r itself opens $R/sub/l" \
   "L16b: … its launch the copy line (no alias file: the prose, never the alias itself)"
has "$(q 'd["status_line"]')" "reason=\"wrong launch: run Leg 1 as cc-r from $C/sub/l\"" "L16b: … its reason naming the copy folder"
same "L16b: exit 4 writes nothing to the note"
CWD="$C/sub/l" leg begin --cwd "$C/sub/l"
ok "$rc|$(q 'd["cwd"]')|$(q 'd["copies"]')" "0|$C/sub/l|[{'checkout': '$R', 'copy': '$C', 'branch': 'chain/$RO', 'made': False, 'fastForwarded': False}]" \
   "L16b: begin from the copy's launch folder: 0, with copies and cwd"
ok "$(logn "Leg 1 began: leg-1 session s1 in cc-r from $R/sub/l\$")" 1 "L16b: … and the began line names the primary folder"
ok "$(q 'd["launch"]["folder"]')" "$R/sub/l" "L16b: … as its launch folder"

# ════ L16c: begin fast-forwards a clean copy to its primary's default branch ═══════════════════════════════════════
# ffscen <name> — a copy chain in $R (on master), copies made, then master moves ahead in $R
ffscen() {
  cscen "$1"; R="$S/r"; crepo "$R" "https://github.com/o/$1.git"; C="$S/chains/r-$RO"
  mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`"; mkt t1; leg copies
  pcommit "$R" m.txt m "master moves on"
}
ffscen l16c
CWD="$C/sub/l" leg begin --cwd "$C/sub/l"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(git -C "$C" rev-parse HEAD)|$(q 'd["landFirst"]')" "0|True|$(git -C "$R" rev-parse master)|False" \
   "L16c: begin fast-forwards the clean copy to master (landFirst false)"
ok "$(git -C "$R" symbolic-ref --short HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)" "master|" "L16c: … never moving the primary"
ffscen l16c2; echo dirty >> "$C/a.txt"
CWD="$C/sub/l" leg begin --cwd "$C/sub/l"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(q 'd["landFirst"]')" "0|False|False" "L16c: control: a dirty copy is not fast-forwarded"
has "$(q 'd["warns"]')" "WARN: $C: not fast-forwarded to master: the copy has uncommitted changes" "L16c: … with a WARN"
ffscen l16c3; tcommit "$C" t0 own.txt "the chain's own commit"; own=$(git -C "$C" rev-parse HEAD)
CWD="$C/sub/l" leg begin --cwd "$C/sub/l"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(git -C "$C" rev-parse HEAD)|$(q 'd["landFirst"]')" "0|False|$own|True" \
   "L16c: control: a chain with its own commit is not fast-forwarded: landFirst"
has "$(q 'd["warns"]')" "WARN: $C: not fast-forwarded to master: chain/$RO has commits master lacks (run leg.py land before the first claim: it merges master in)" \
   "L16c: … with a WARN naming the land"
ffscen l16c4; git -C "$R" checkout -qb w
CWD="$C/sub/l" leg begin --cwd "$C/sub/l"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(git -C "$C" rev-parse HEAD)|$(git -C "$R" symbolic-ref --short HEAD)" \
   "0|True|$(git -C "$R" rev-parse master)|w" "L16c: the primary off master: the copy is still fast-forwarded (it reads only refs/heads/master)"
cscen l16c5
R="$S/r"; mkdir -p "$R"; git -c init.defaultBranch=trunk init -q "$R"; echo a > "$R/a.txt"; git -C "$R" add -A; git -C "$R" commit -qm base
C="$S/chains/r-$RO"; mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`"; mkt t1
leg copies
ok "$rc|$(q 'd["copies"][0]["base"]')|$(git -C "$C" rev-parse HEAD)" "0|HEAD|$(git -C "$R" rev-parse HEAD)" \
   "L16c: control: no origin/HEAD, main or master: the copy is cut from HEAD"
has "$(q 'd["warns"]')" "WARN: $R: no default branch resolved: its Chain copy is cut from HEAD (trunk) and begin never fast-forwards it" "L16c: … with a WARN"
pcommit "$R" m.txt m "trunk moves on"
CWD="$C" leg begin --cwd "$C"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')" "0|False" "L16c: … and begin never fast-forwards it"
has "$(q 'd["warns"]')" "WARN: $C: not fast-forwarded: $R has no default branch resolved" "L16c: … saying why"

# ════ L16d: claim stamps the copy and the primary; done passes a copy commit and refuses a primary one ═════════════
cscen l16d
R="$S/r"; crepo "$R" https://github.com/o/r16d.git; C="$S/chains/r-$RO"; export CWD="$C/sub/l"
mkro '' $(rows cc-r "$R/sub/l" "\`repo:$R//a.txt\`" t1 t2 t3 t4); for t in t1 t2 t3 t4; do mkt "$t"; done
CWD="$R" leg copies; leg begin --cwd "$C/sub/l"; ok "$rc" 0 "L16d: begin in the copy"
leg claim --task t1
ok "$rc|$(fm t1 leg_base)|$(fm t1 leg_primary_base)" "0|[\"$C@$(git -C "$C" rev-parse HEAD)\"]|[\"$R@$(git -C "$R" rev-parse HEAD)\"]" \
   "L16d: claim stamps leg_base on the copy and leg_primary_base on the primary"
ok "$(q 'd["leg_primary_base"]')" "['$R@$(git -C "$R" rev-parse HEAD)']" "L16d: … and prints it"
tcommit "$C" t1 c.txt "t1 work"; d=$(review "$C" HEAD)
leg done --task t1 --verify pass --review "$d" --cwd "$C/sub/l"
ok "$rc|$(fm t1 leg_head)" "0|[\"$C@$(git -C "$C" rev-parse HEAD)\"]" "L16d: a commit in the copy, reviewed there, passes done; leg_head is on the copy"
leg claim --task t2; ok "$rc" 0 "L16d: claim t2"
tcommit "$R" t2 s.txt "t2 in the primary"; stray=$(git -C "$R" rev-parse HEAD)
snap; leg done --task t2 --verify pass --cwd "$C/sub/l"
ok "$rc" 1 "L16d: a Task: commit in the primary is refused by done"
has "$err" "[[t2]] committed in the primary $R, not its chain copy $C: set it aside with --revert, which reverts it there, and redo it in $C" \
   "L16d: … naming the primary and the copy"; same "L16d: a refused done"
leg change --task t2
has "$(q 'd["stray"]')" "WARN: ${stray:0:12} '✨ feat: t2 s.txt' in $R carries Task: [[t2]] but is in the primary" "L16d: change shows the stray WARN"
leg set-aside --task t2 --reason "worked in the primary" --revert
ok "$rc|$(logn "Leg 1 reverted .* in $R\$")|$(test -e "$R/s.txt" && echo y || echo n)" "0|1|n" "L16d: set-aside --revert reverts it in the primary"
leg claim --task t3; ok "$rc" 0 "L16d: claim t3"
tcommit "$C" t3 d.txt "t3 work"; git -C "$R" merge -q --no-edit "chain/$RO"; d=$(review "$C" HEAD)
leg change --task t3; ok "$(q 'd["stray"]')" "[]" "L16d: control: chain/\$RO merged into \$R mid-task is never stray"
leg done --task t3 --verify pass --review "$d" --cwd "$C/sub/l"; ok "$rc" 0 "L16d: control: … and done passes"
leg claim --task t4; ok "$rc" 0 "L16d: claim t4"
tcommit "$C" t4 e.txt "t4 work"; git -C "$R" merge -q --no-edit "chain/$RO"
leg set-aside --task t4 --reason "set aside after a hand merge" --revert
ok "$rc|$(logn "Leg 1 reverted .* in $R\$")|$(logn "Leg 1 reverted .* in $C\$")" "0|1|1" "L16d: control: --revert finds nothing in \$R, only the copy's commit"
unset CWD

# ════ L16e: two chains in one repo hold separate HEADs and indexes ═════════════════════════════════════════════════
cscen l16e
R="$S/r"; crepo "$R" https://github.com/o/r16e.git; RO1=$RO; RO2=demo2-rollout-2026-10-20
mkro '' "e1~cc-r~$R~\`repo:$R//a.txt\`"; mkt e1
RO=$RO2; mkro '' "e2~cc-r~$R~\`repo:$R//b.txt\`"; mkt e2; leg copies; ok "$rc" 0 "L16e: the second chain's copies"
RO=$RO1; leg copies; ok "$rc" 0 "L16e: the first chain's copies"
C1="$S/chains/r-$RO1"; C2="$S/chains/r-$RO2"; rh=$(git -C "$R" rev-parse HEAD)
tcommit "$C1" e1 a.txt "e1 work"; tcommit "$C2" e2 b.txt "e2 work"
ok "$(git -C "$C1" symbolic-ref HEAD)|$(git -C "$C2" symbolic-ref HEAD)" "refs/heads/chain/$RO1|refs/heads/chain/$RO2" "L16e: each on its own branch"
ok "$([ "$(git -C "$C1" rev-parse HEAD)" != "$(git -C "$C2" rev-parse HEAD)" ] && echo y)|$([ "$(git -C "$C1" rev-parse --path-format=absolute --git-path index)" != "$(git -C "$C2" rev-parse --path-format=absolute --git-path index)" ] && echo y)" \
   "y|y" "L16e: a commit in each leaves two HEADs and two indexes"
ok "$(git -C "$R" rev-parse HEAD)" "$rh" "L16e: … and \$R's HEAD unchanged"

# ════ L16f: the hand-over, handed --manual and status's restart open in the copy ═══════════════════════════════════
cscen l16f
R="$S/r"; crepo "$R" https://github.com/o/r16f.git; C="$S/chains/r-$RO"; export CWD="$C"
mkro '' "t1~cc-a~$R~\`repo:$R//a.txt\`" "t2~cc-r~$R/sub/l~\`repo:$R//b.txt\`"; mkt t1; mkt t2
CWD="$R" leg copies; leg begin --cwd "$C"; ok "$rc" 0 "L16f: Leg 1 begins in the copy's toplevel"
finish t1
printf '%s\n' "alias cc-a='cd ~/elsewhere && cc'" "alias cc-r='cd ~/somewhere && cc --add-dir \"\$HOME/v\"'" > "$THREAD_LAUNCH_ALIASES"
leg close --outcome handoff --cwd "$C"
ok "$rc|$(q 'd["handover"]["cwd"]')" "0|$C/sub/l" "L16f: the hand-over's cwd is the next row's folder inside the copy"
ok "$(q 'd["handover"]["launch"]')" "cd $C/sub/l && cc --add-dir \"\$HOME/v\"" "L16f: … and its launch the alias's paste line, never the alias itself"
ok "$(logn "Leg 1 closed: handoff to Leg 2 in cc-r from $R/sub/l\$")" 1 "L16f: … while the close line names the Queue folder"
leg handed --manual "no host tool"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=1/2 running=0 state=halted reason=\"manual handoff: Leg 2 in cc-r from $C/sub/l\"" \
   "L16f: handed --manual names the copy folder"
leg status
ok "$(q 'd["restart"]["cwd"]')|$(q 'd["restart"]["launch"]')|$(q 'd["restart"]["blockedBy"]')" "$C/sub/l|cd $C/sub/l && cc --add-dir \"\$HOME/v\"|None" \
   "L16f: status's restart opens in the copy"
has "$(q 'd["needsYou"]')" "manual hand-over: start Leg 2 in cd $C/sub/l && cc --add-dir " "L16f: … and the manual hand-over item carries the line"
rm -f "$THREAD_LAUNCH_ALIASES"; leg status
has "$(q 'd["restart"]["launch"]')" "never cc-r itself, since cc-r itself opens $R/sub/l" "L16f: with no alias file, the line is the prose: never the alias itself"
printf '%s\n' "alias cc-r='cc --add-dir \"\$HOME/v\"'" > "$THREAD_LAUNCH_ALIASES"; leg status
ok "$(q 'd["restart"]["launch"]')" "cd $C/sub/l && cc --add-dir \"\$HOME/v\"" \
   "L16f: an alias with no cd of its own (cc-steph's form): its whole command after the copy's cd, never the prose"
rm -f "$THREAD_LAUNCH_ALIASES"
mv "$C" "$S/moved"
CWD="$R" leg status
ok "$(q 'd["restart"]["blockedBy"]')" "chain copy missing: $C (leg.py copies --rollout $T/$RO.md remakes it)" "L16f: a missing copy blocks the restart"
mv "$S/moved" "$C"; unset CWD

# ════ L16g: a row-less begin in the copy logs the primary folder ═══════════════════════════════════════════════════
cscen l16g
R="$S/r"; crepo "$R" https://github.com/o/r16g.git; C="$S/chains/r-$RO"; export CWD="$C/sub/l"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`"; mkt t1
CWD="$R" leg copies; leg begin --cwd "$C/sub/l"; finish t1; leg close --outcome stopped --reason "out of time" --cwd "$C/sub/l"
SESS=s2 leg begin --cwd "$C/sub/l"
ok "$rc|$(q 'd["next"]["action"]')|$(logn "Leg 2 began: leg-2 session s2 in claude from $R/sub/l\$")" "0|complete|1" \
   "L16g: a complete Leg begun in the copy logs its primary folder"
unset CWD

# ════ L16h: two copies, one Leg: done finishes only the cwd's copy's commits (ADR 0059 d4) ═════════════════════════
cscen l16h
R="$S/r"; crepo "$R" https://github.com/o/r16h.git; R2="$S/r2"; crepo "$R2" https://github.com/o/r16h2.git
C="$S/chains/r-$RO"; C2="$S/chains/r2-$RO"; export CWD="$C"
mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\` \`repo:$R2//b.txt\`" "t2~cc-r2~$R2~\`repo:$R2//b.txt\`"; mkt t1; mkt t2
CWD="$R" leg copies
ok "$rc|$(fm "$RO" chain_copies)" "0|[\"$R -> $C\", \"$R2 -> $C2\"]" "L16h: a two-checkout chain gets two copies"
leg begin --cwd "$C"; leg claim --task t1
ok "$rc|$(fm t1 leg_base)" "0|[\"$C@$(git -C "$C" rev-parse HEAD)\", \"$C2@$(git -C "$C2" rev-parse HEAD)\"]" "L16h: claim stamps both copies"
tcommit "$C2" t1 b.txt "t1 in the other copy"; d=$(review "$C2" HEAD)
leg done --task t1 --verify pass --review "$d" --cwd "$C"
ok "$rc" 1 "L16h: row 1's commit in the other copy is refused by done"
has "$err" "[[t1]] changed $C2, not this Leg's checkout $C" "L16h: … not this Leg's checkout"
unset CWD

# ════ L16i: Complete files the land follow-on: merge the chain branch into the primary's default branch ════════════
# icomplete <name> [checkout branch] — a one-task copy chain in $R, worked in the copy, then Complete
icomplete() {
  cscen "$1"; R="$S/r"; crepo "$R" "https://github.com/o/$1.git"; C="$S/chains/r-$RO"; export CWD="$C"
  mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`"; mkt t1
  [ -z "${2:-}" ] || git -C "$R" checkout -qb "$2"
  CWD="$R" leg copies; leg begin --cwd "$C"; work "$C" t1 c.txt "t1 work"
  snap; leg close --outcome complete --cwd "$C" --reflection "$REFL"; ok "$rc" 1 "$1: complete refuses t1 unlanded"
  has "$err" "[[t1]] is not on master in $R: run leg.py land first" "$1: … naming the land"; same "$1: a refused complete"
  leg land; ok "$rc|$(q 'd["lands"][0]["state"]')" "0|landed" "$1: land"
  leg close --outcome complete --cwd "$C" --reflection "$REFL"; ok "$rc" 0 "$1: complete"
  A="$T/Archive/Rollouts/$RO.md"; FU="$T/demo-followup-land-chain-2026-10-20.md"
}
icomplete l16i
has "$(cat "$FU")" "- \`$C\` (\`chain/$RO\` of \`$R\`): \`chain/$RO\` is already on \`master\`: open a PR from them, or push them" \
   "L16i: landed, the land follow-on files only the origin half"
hasnt "$(cat "$FU")" "merge \`chain/$RO\` into" "L16i: … with no merge lead-in"
hasnt "$(cat "$FU")" "worktree remove" "L16i: … and no worktree remove tail (land --retire does it)"
hasnt "$(cat "$FU")" "Chain copy, not yet on" "L16i: … nor the copy's old parenthesis"
has "$(cat "$FU")" "([[t1]])" "L16i: … listing t1's commit"
has "$(cat "$A")" "- Chain commits: $C (chain/$RO of $R): all on master, 1 not on origin/master → [[demo-followup-land-chain-2026-10-20]]" "L16i: the Chain commits line"
icomplete l16i2 w
ok "$(test -f "$FU" && echo y || echo n)" n "L16i: a deferred route (on w), everything landed: nothing filed"
has "$(cat "$A")" "- Chain commits: $C (chain/$RO of $R): all on master; not landed: on w, not master, nothing filed" "L16i: … and its Chain commits line"
# control: chain/$RO merged into master by hand, then a stuck route (the primary detached): a stuck route cannot say what
# origin has, so every chain commit is still filed, as in place
cscen l16i3
R="$S/r"; crepo "$R" https://github.com/o/l16i3.git; C="$S/chains/r-$RO"; export CWD="$C"
mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`"; mkt t1
CWD="$R" leg copies; leg begin --cwd "$C"; work "$C" t1 c.txt "t1 work"; t1sha=$(git -C "$C" rev-parse HEAD)
git -C "$R" merge -q --no-edit "chain/$RO"; git -C "$R" checkout -q --detach
ok "$(git -C "$R" merge-base --is-ancestor "$t1sha" master && echo y)" y "L16i: control setup: t1's commit is on master"
leg close --outcome complete --cwd "$C" --reflection "$REFL"; ok "$rc" 0 "L16i: complete after a hand merge, on a stuck route"
A="$T/Archive/Rollouts/$RO.md"; FU="$T/demo-followup-land-chain-2026-10-20.md"
ok "$(test -f "$FU" && echo y || echo n)" y "L16i: control: the land follow-on is still filed"
has "$(cat "$FU")" "- \`$C\` (\`chain/$RO\` of \`$R\`): \`chain/$RO\` is already on \`master\`: check the landing route (detached HEAD), then open a PR from them, or push them" \
   "L16i: … its act starting from the landing route, the merge already made"
hasnt "$(cat "$FU")" "worktree remove" "L16i: … with no worktree remove tail"
has "$(cat "$FU")" "\`${t1sha:0:12}\` ✨ feat: t1 c.txt ([[t1]])" "L16i: … listing t1's commit"
has "$(cat "$A")" "- Chain commits: $C (chain/$RO of $R): all on master; stuck: detached HEAD → [[demo-followup-land-chain-2026-10-20]]" \
   "L16i: … and its Chain commits line, never 'all on master' alone"
unset CWD

# ════ L16j: begin adds a hand-added row's pair; claim refuses a top with no pair ═══════════════════════════════════
cscen l16j
R="$S/r"; crepo "$R" https://github.com/o/r16j.git; R3="$S/r3"; crepo "$R3" https://github.com/o/r16j3.git
C="$S/chains/r-$RO"; C3="$S/chains/r3-$RO"; export CWD="$C/sub/l"
mkro '' "t1~cc-r~$R/sub/l~\`repo:$R//a.txt\`"; mkt t1; mkt t2
CWD="$R" leg copies
python3 - "$T/$RO.md" "$R" "$R3" <<'PY'
import sys
p, r, r3 = sys.argv[1:]
t = open(p).read()
row = f"| 1 | [[t1\\|t1]] | `cc-r` from `{r}/sub/l` | `repo:{r}//a.txt` |\n"
open(p, "w").write(t.replace(row, row + f"| 2 | [[t2\\|t2]] | `cc-r` from `{r}/sub/l` | `repo:{r3}//x.txt` |\n", 1))
PY
leg begin --cwd "$C/sub/l"
ok "$rc|$(fm "$RO" chain_copies)|$(git -C "$C3" symbolic-ref HEAD)" "0|[\"$R -> $C\", \"$R3 -> $C3\"]|refs/heads/chain/$RO" \
   "L16j: begin adds and makes a hand-added row's pair"
ok "$(q '[c["made"] for c in d["copies"]]')" "[False, True]" "L16j: … the new one made"
subst "$T/$RO.md" "chain_copies: [\"$R -> $C\", \"$R3 -> $C3\"]" "chain_copies: [\"$R -> $C\"]"
finish t1
snap; cp "$T/t2.md" "$TMP/snap-t2"; leg claim --task t2
ok "$rc" 1 "L16j: with that pair removed by hand, claim refuses"
has "$err" "$R3 has no Chain copy in chain_copies: run leg.py copies --rollout $T/$RO.md, then claim again; nothing written" "L16j: … naming leg.py copies"
same "L16j: a refused claim"; cmp -s "$T/t2.md" "$TMP/snap-t2"; ok "$?" 0 "L16j: … and t2 is unwritten"
subst "$T/$RO.md" "chain_copies: [\"$R -> $C\"]" "chain_copies: [\"$R -> $C\", \"$R3 -> $C3\"]"; rm -rf "$C3"
snap; leg claim --task t2
ok "$rc" 1 "L16j: with the pair back but its copy deleted, claim refuses"
has "$err" "$R3's Chain copy $C3 is missing: leg.py begin remakes it (or leg.py copies --rollout $T/$RO.md), then claim again; nothing written" \
   "L16j: … naming the missing copy and begin"
same "L16j: a claim on a missing copy"; cmp -s "$T/t2.md" "$TMP/snap-t2"; ok "$?" 0 "L16j: … and t2 is unwritten"
unset CWD

# ════ L16k: a dependency another chain finished, still on its chain/<X> branch, holds a copy chain's claim ═══════
cscen l16k
R="$S/r"; crepo "$R" https://github.com/o/r16k.git; RO1=$RO; RO2=demo2-rollout-2026-10-20
C1="$S/chains/r-$RO1"; C2="$S/chains/r-$RO2"
mkro '' "a1~cc-r~$R~\`repo:$R//a.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b.txt\`"; mkt b1 'depends-on:' '  - "[[a1]]"'
RO=$RO1; CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L16k: chain 1's Leg begins in its copy"
CWD="$C1" work "$C1" a1 a1.txt "a1 work"; a1sha=$(git -C "$C1" rev-parse HEAD)
ok "$(fm a1 leg_head)" "[\"$C1@$a1sha\"]" "L16k: a1 is done, its leg_head on chain/\$RO1's copy"
RO=$RO2; CWD="$R" leg copies; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L16k: chain 2's Leg begins in its copy"
CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L16k: next frees b1, its dependency done"
snap; cp "$T/b1.md" "$TMP/snap-b1"; CWD="$C2" leg claim --task b1
ok "$rc" 1 "L16k: claim refuses b1: a1's commit is on chain/\$RO1, not on master or in \$C2"
ok "$(q 'd["error"]')" "[[b1]] depends on [[a1]] (done on chain/$RO1, not yet on master: it lands at [[$RO1]]'s next done or close): set it aside (\`leg.py set-aside --task b1 --reason \"<this error>\"\`) until that work is in $C2; nothing written" \
   "L16k: … naming the cause and the set-aside"
ok "$(q 'd["unlandedDeps"][0]["dep"]')|$(q 'd["unlandedDeps"][0]["rollout"]')|$(q 'd["unlandedDeps"][0]["sha"]')|$(q 'd["unlandedDeps"][0]["copy"]')" \
   "a1|$RO1|$a1sha|$C2" "L16k: … and unlandedDeps names a1, its chain, its commit and this copy"
same "L16k: a refused claim"; cmp -s "$T/b1.md" "$TMP/snap-b1"; ok "$?" 0 "L16k: … and b1 is unwritten"
git -C "$R" merge -q --no-edit "chain/$RO1"
CWD="$C2" leg claim --task b1
ok "$rc" 1 "L16k: merged into master by hand but not yet in \$C2: still refused"
ok "$(q 'd["error"]')" "[[b1]] depends on [[a1]] (on master, not yet in $C2: run leg.py land, which brings master in): run leg.py land, then claim again; nothing written" \
   "L16k: … naming the land and the claim again, never a set-aside"
CWD="$C2" leg land; ok "$rc|$(q 'd["lands"][0]["state"]')" "0|current" "L16k: control: leg.py land brings master into \$C2"
CWD="$C2" leg claim --task b1
ok "$rc|$(fm b1 leg_base)" "0|[\"$C2@$a1sha\"]" "L16k: control: with a1's work in \$C2, b1 is claimed"
# control: a copy chain in another repository never meets a1's commit
R2="$S/r2"; crepo "$R2" https://github.com/o/r16k2.git; RO3=demo3-rollout-2026-10-20; C3="$S/chains/r2-$RO3"
RO=$RO3; mkro '' "d1~cc-r2~$R2~\`repo:$R2//a.txt\`"; mkt d1 'depends-on:' '  - "[[a1]]"'
CWD="$R2" leg copies; CWD="$C3" leg begin --cwd "$C3"; CWD="$C3" leg claim --task d1
ok "$rc" 0 "L16k: control: a1's commit is no object of \$R2's, so d1 is claimed"
unset CWD

# ════ L17: leg.py land (ADR 0067 d3, d4) ═══════════════════════════════════════════════════════════════════════════
# lscen <name> — L16k's fixture: crepo $R (on master) and two chains in it, A ($RO1, copy $C1) and B ($RO2, copy $C2);
# the caller writes their notes (RO=$RO1 / RO=$RO2, then mkro and mkt) and runs mkcopies
lscen() {
  cscen "$1"; R="$S/r"; crepo "$R" "https://github.com/o/$1.git"; RO1=$RO; RO2=demo2-rollout-2026-10-20
  C1="$S/chains/r-$RO1"; C2="$S/chains/r-$RO2"
}
# mkcopies — both chains' copies (from $R), then RO back on $RO1
mkcopies() { RO=$RO2; CWD="$R" leg copies; RO=$RO1; CWD="$R" leg copies; }
# lands — the last land's `lands` as `state|why|waits` per copy, `;`-joined
lands() { q '";".join("%s|%s|%s" % (e["state"], e["why"], e["waits"]) for e in d["lands"])'; }
master() { git -C "$R" rev-parse master; }

# ---- L17a: two chains land in turn, by merge ----
lscen l17a
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R/sub/l~\`repo:$R//b1.txt\`" "b2~cc-r~$R/sub/l~\`repo:$R//b2.txt\`"; mkt b1; NOVERIFY=1 mkt b2; RO=$RO1
mkcopies
CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L17a: A's Leg begins in its copy"
RO=$RO2; CWD="$C2/sub/l" leg begin --cwd "$C2/sub/l"; ok "$rc" 0 "L17a: B's Leg begins in its copy"
CWD="$C2/sub/l" work "$C2" b1 b1.txt "b1 work"; b1sha=$(git -C "$C2" rev-parse HEAD)
CWD="$C2/sub/l" leg file-fix --target b1 --cause outside --evidence "red"
ok "$rc" 1 "L17l: control: before any land merge, outside is refused for b1"; RO=$RO1
CWD="$C1" work "$C1" a1 a1.txt "a1 work"; a1sha=$(git -C "$C1" rev-parse HEAD)
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$a1sha" "L17a: A lands a1: master is chain/A's tip"
ok "$(q 'd["lands"][0]["landed"]')|$(fm a1 leg_landed)" "['a1']|$NOW" "L17a: … a1 is listed, and leg_landed: stamped"
ok "$(logn "Leg 1 land: \[\[a1\]\] on master in $R (${a1sha:0:12})\$")" 1 "L17a: … and the land: line logged"
RO=$RO2; CWD="$C2/sub/l" leg land
ok "$rc|$(lands)" "0|verify|None|None" "L17a: B's b1, cut before A's land, asks for a re-verify after the merge"
ok "$(q 'd["lands"][0]["verify"]')" "[{'task': 'b1', 'line': '**Verify:** \`test -f b1.done\`', 'folder': '$C2/sub/l'}]" \
   "L17a: … naming b1's Verify line and its folder in the copy"
head=$(q 'd["lands"][0]["head"]')
ok "$(git -C "$C2" rev-parse HEAD)|$(git -C "$C2" rev-parse HEAD^1)|$(git -C "$C2" rev-parse HEAD^2)|$(master)" "$head|$b1sha|$a1sha|$a1sha" \
   "L17a: … chain/B's tip is a merge of b1 and master, and master is unmoved"
ok "$(git -C "$C2" log -1 --format=%s)" "🔀 land: merge master into chain/$RO2" "L17a: … its subject the land merge's"
CWD="$C2/sub/l" leg land --verified "$head"
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$head" "L17a: --verified <head> lands it"
ok "$(git -C "$R" merge-base --is-ancestor "$b1sha" master && echo y)|$(git -C "$C2" log -1 --format=%H "$b1sha")" "y|$b1sha" \
   "L17a: … b1's sha unchanged, an ancestor of master (never a rebase)"
ok "$(logn "Leg 1 land verified: $R at $head\$")|$(fm b1 leg_landed)" "1|$NOW" "L17a: … land verified: logged, b1 stamped"
# control: master moves after the verify, so a stale --verified merges again and asks again
CWD="$C2/sub/l" work "$C2" b2 b2.txt "b2 work"
pcommit "$R" peer.txt p "a peer moves master"
CWD="$C2/sub/l" leg land --verified "$head"
ok "$rc|$(lands)" "0|verify|None|None" "L17a: control: master moved after the verify: a stale --verified asks again"
ok "$(q 'd["lands"][0]["head"]' | grep -c "$head")|$(logn 'land verified:')" "0|1" "L17a: … on a new merge, and nothing more is logged"
ok "$(q 'd["lands"][0]["verify"]')" "[{'task': 'b2', 'line': None, 'folder': '$C2/sub/l'}]" \
   "L17n: a row with no Verify line asks with line None, and its folder"
CWD="$C2/sub/l" leg change --task b2
ok "$rc|$(q 'd["tops"][0]["warns"]')" "0|[]" "L17k: change: the untrailered peer commit a land merged in raises no WARN"
pcommit "$C2" loose2.txt l "an untrailered commit in the copy"
CWD="$C2/sub/l" leg change --task b2
has "$(q 'd["tops"][0]["warns"]')" "'an untrailered commit in the copy' in $C2 carries no Task: line" "L17k: control: one on the copy's own line still warns"
CWD="$C2/sub/l" leg file-fix --target b1 --cause outside --evidence "red after the land"
ok "$rc|$(q 'd["cause"]')" "0|outside" "L17l: outside passes for b1 once a land merge is in its range"
unset CWD

# ---- L17b: a conflict leaves the task unlanded, and Complete waits ----
# bscen <name> — A's a1 (cell a1.txt) and B's b1 (cell b1.txt) both write c.txt; A lands it first
bscen() {
  lscen "$1"
  mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
  mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
  CWD="$C2" work "$C2" b1 c.txt "b's c"; b1sha=$(git -C "$C2" rev-parse HEAD); RO=$RO1
  CWD="$C1" work "$C1" a1 c.txt "a's c"; CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "$1: A lands c.txt first"
  m0=$(master); RO=$RO2
}
bscen l17b
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|conflict in c.txt|False" "L17b: B's land conflicts on c.txt: it stands, waits False"
ok "$(git -C "$C2" rev-parse -q --verify MERGE_HEAD || echo none)|$(git -C "$C2" rev-parse HEAD)|$(master)|$(fm b1 leg_landed)" \
   "none|$b1sha|$m0|<none>" "L17b: … the merge aborted: no MERGE_HEAD, nothing moved, nothing stamped"
ok "$(logn "Leg 1 land stood: $R: conflict in c.txt\$")" 1 "L17b: … and the stand logged"
CWD="$C2" leg land; ok "$(logn "land stood: $R: conflict in c.txt")" 1 "L17b: the same stand again is not logged twice"
snap; CWD="$C2" leg close --outcome complete --cwd "$C2" --reflection "$REFL"
ok "$rc" 1 "L17b: Complete refuses while b1 is unlanded"
has "$err" "[[b1]] is not on master in $R: run leg.py land first (legs.md § Complete's Land first); nothing written" "L17b: … naming the land"
same "L17b: a refused complete"
# (b2) the hand resolution: the pinned subject, resolve, add, commit --no-edit, then land again
git -C "$C2" merge --no-ff -m "🔀 land: merge master into chain/$RO2" refs/heads/master >/dev/null 2>&1
printf 'a and b\n' > "$C2/c.txt"; git -C "$C2" add c.txt; git -C "$C2" commit -q --no-edit
CWD="$C2" leg land
ok "$rc|$(lands)" "0|verify|None|None" "L17b2: after the hand resolution, land asks for the re-verify"
CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"
ok "$rc|$(lands)|$(cat "$R/c.txt")" "0|landed|None|None|a and b" "L17b2: … then lands the resolution"
CWD="$C2" leg change --task b1
ok "$(q 'd["tops"][0]["warns"]')" "[]" "L17b2: … and change raises no WARN for the merge"
unset CWD

# ---- L17c: a peer's uncommitted edit, or an untracked file, refuses the fast-forward ----
lscen l17c
mkro '' "a1~cc-r~$R~\`repo:$R//b.txt\`" "a2~cc-r~$R~\`repo:$R//n.txt\`"; mkt a1; mkt a2; mkcopies
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 b.txt "a1's b"
echo "peer's b" > "$R/b.txt"; m0=$(master)
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on b.txt|False" "L17c: a peer's uncommitted edit on b.txt stands the land"
ok "$(master)|$(cat "$R/b.txt")|$(git -C "$R" stash list | wc -l | tr -d ' ')|$(fm a1 leg_landed)" "$m0|peer's b|0|<none>" \
   "L17c: … master unchanged, the edit intact, nothing stashed, nothing stamped"
git -C "$R" checkout -q -- b.txt
CWD="$C1" work "$C1" a2 n.txt "a2's n"; echo "untracked" > "$R/n.txt"
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on n.txt|False" "L17c: an untracked file in the ff's way stands it too"
ok "$(master)|$(cat "$R/n.txt")" "$m0|untracked" "L17c: … the file intact"
rm "$R/n.txt"; CWD="$C1" leg land
ok "$rc|$(lands)|$(fm a1 leg_landed)|$(fm a2 leg_landed)" "0|landed|None|None|$NOW|$NOW" "L17c: once cleared, both land"
unset CWD

# ---- L17d: --retire after Complete: the copy removed, its branch deleted with -d ----
# dscen <name> [checkout branch] — chain A alone, a1 worked in its copy and landed, then Complete; $A the archived note
dscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  [ -z "${2:-}" ] || git -C "$R" checkout -qb "$2"
  CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"
  CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "$1: a1 lands"
  CWD="$C1" leg close --outcome complete --cwd "$C1" --reflection "$REFL"; ok "$rc" 0 "$1: complete"
  A="$T/Archive/Rollouts/$RO.md"; cp "$A" "$TMP/snapA"
}
dscen l17d1
cfg0=$(git -C "$R" config --list --local | grep -v '^branch\.chain' | sort)
CWD="$C1" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"], e["why"]) for e in d["retired"]]')|$(q 'd["followup"]')" \
   "0|[(True, True, True, None)]|None" "L17d1: --retire run from inside the copy: landed, removed, branch deleted"
ok "$(test -e "$C1" && echo y || echo n)|$(git -C "$R" show-ref -q --verify "refs/heads/chain/$RO1" && echo y || echo n)" "n|n" \
   "L17d1: … the copy is gone and chain/\$RO1 deleted"
ok "$(git -C "$R" config --list --local | grep -v '^branch\.chain' | sort)|$(git -C "$R" rev-parse --is-inside-work-tree)" "$cfg0|true" \
   "L17d1: … R's config intact"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L17d1: … and the archived note byte-identical"
dscen l17d2 w
CWD="$C1" leg land --retire
ok "$rc|$(q '[(e["removed"], e["branchDeleted"]) for e in d["retired"]]')" "0|[(True, True)]" \
   "L17d2: R on w (master landed by update-ref): -d deletes the branch, its upstream set to master first"
ok "$(git -C "$R" config --get-regexp '^branch\.chain' || echo none)|$(git -C "$R" symbolic-ref --short HEAD)" "none|w" \
   "L17d2: … no branch.chain* config is left, and R stays on w"
dscen l17d3; echo x > "$C1/untracked.txt"
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(test -d "$C1" && echo y)" "0|[(False, False)]|y" \
   "L17d3: an untracked file in the copy: worktree remove refuses (never --force), copy and branch kept"
has "$(q 'd["warns"]')" "WARN: $C1 (chain/$RO1 of $R) kept: git worktree remove refused" "L17d3: … with a WARN"
ok "$(q 'd["followup"]')" "demo-followup-retire-chain-2026-10-20" "L17d3: … and a retire follow-on"
has "$(cat "$T/demo-followup-retire-chain-2026-10-20.md")" "land --retire --rollout $A --session s1" "L17d3: … naming the command that finishes it"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L17d3: the archived note byte-identical"
dscen l17d4; pcommit "$C1" b.txt "close-out b" "📝 docs(thread): close-out"; echo "peer's b" > "$R/b.txt"
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(cat "$R/b.txt")" "0|[(False, False, False)]|peer's b" \
   "L17d4: a peer's edit on a close-out's file keeps the copy and the branch, the edit intact"
has "$(q 'd["retired"][0]["why"]')" "the primary's uncommitted edit on b.txt" "L17d4: … naming it"
bad=$(python3 - "$LEG" <<'PY2'
import ast, sys
src = open(sys.argv[1]).read()
tree = ast.parse(src)
for fn in ("land_retire", "_retire_land"):
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == fn)
    for s in ast.walk(node):
        if isinstance(s, ast.Constant) and s.value in ("-D", "--force", "-f"):
            print(fn, s.value)
PY2
)
ok "$bad" "" "L17d5: land --retire's source holds no -D, --force or -f"
unset CWD

# ---- L17e: interim (1) retired: a dependency another chain landed is claimed ----
lscen l17e
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b0~cc-r~$R~\`repo:$R//b0.txt\`" "b1~cc-r~$R~\`repo:$R//b1.txt\`"; NOVERIFY=1 mkt b0; mkt b1 'depends-on:' '  - "[[a1]]"'
RO=$RO1; mkcopies
CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; RO=$RO1
CWD="$C1" work "$C1" a1 a1.txt "a1 work"; a1sha=$(git -C "$C1" rev-parse HEAD)
CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "L17e: A lands a1"
RO=$RO2; CWD="$C2" finish b0
CWD="$C2" leg claim --task b1
ok "$rc" 1 "L17e: mid-Leg, B's copy lacks the landed a1: claim refuses"
ok "$(q 'd["error"]')" "[[b1]] depends on [[a1]] (on master, not yet in $C2: run leg.py land, which brings master in): run leg.py land, then claim again; nothing written" \
   "L17e: … naming the land and the claim again, never a set-aside"
CWD="$C2" leg land
ok "$rc|$(lands)|$(git -C "$C2" rev-parse HEAD)" "0|current|None|None|$a1sha" "L17e: land fast-forwards the copy: current"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17e: … and b1 is claimed"
# a fresh Leg after A's land: begin's fast-forward brings a1 in
lscen l17e2
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1 'depends-on:' '  - "[[a1]]"'
RO=$RO1; mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(q 'd["landFirst"]')" "0|True|False" "L17e: after A's land, B's fresh begin fast-forwards"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17e: … and claim b1 passes"
unset CWD

# ---- L17f: interim (2) retired: the chain that takes its file turn second begins with the first's landed work ----
# fscen <name> [two] — A ($RO1) began first, a1 done on f.txt and its Leg closed stopped, not landed (with `two`, a
# second row a2 on g.txt still open); B ($RO2) writes f.txt too
fscen() {
  lscen "$1"
  if [ -n "${2:-}" ]; then mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R~\`repo:$R//g.txt\`"; mkt a2
  else mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; fi; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1 'depends-on:' '  - "[[a1]]"'; RO=$RO1; mkcopies
  CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 f.txt "a's f"
  CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
}
fscen l17f1 two
RO=$RO2; snap; CWD="$C2" leg begin --cwd "$C2"
ok "$rc" 3 "L17f1: B is held while A's done a1 is unlanded on f.txt"
has "$err" "surface held: [[$RO1]] holds repo:$R//f.txt" "L17f1: … naming it"; same "L17f1: a held begin"
RO=$RO1; CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "L17f1: A's closed Leg lands a1"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["landFirst"]')|$(cat "$C2/f.txt")" "0|False|a's f" "L17f1: then B begins, with A's f.txt in its copy"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17f1: … and claims b1"
fscen l17f2; git -C "$R" checkout -qb w; wh=$(git -C "$R" rev-parse HEAD)
CWD="$C1" leg land
ok "$rc|$(lands)|$(git -C "$R" symbolic-ref --short HEAD)|$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)" \
   "0|landed|None|None|w|$wh|" "L17f2: R on w, master checked out nowhere: A lands by update-ref, R untouched"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(cat "$C2/f.txt")" "0|True|a's f" "L17f2: B's begin fast-forwards to master though R is on w"
fscen l17f3; CWD="$C1" leg land
pcommit "$C2" THREAD.md closed "📝 docs(thread): close-out"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["landFirst"]')|$(q 'd["copies"][0]["fastForwarded"]')" "0|True|False" "L17f3: a close-out on chain/B: begin cannot fast-forward, landFirst"
has "$(q 'd["warns"]')" "WARN: $C2: not fast-forwarded to master: chain/$RO2 has commits master lacks (run leg.py land before the first claim: it merges master in)" \
   "L17f3: … with the WARN"
CWD="$C2" leg land
ok "$rc|$(lands)|$(cat "$C2/f.txt")" "0|landed|None|None|a's f" "L17f3: land merges master in and lands the close-out"
ok "$(logn "Leg 1 land: close-outs on master in $R (")" 1 "L17f3: … logged as close-outs"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17f3: … and b1 is claimed with A's work in the copy"
fscen l17f4
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc" 3 "L17f4: a1 as A's only row (A complete, not landed): B is still held"
RO=$RO1; CWD="$C1" leg land; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(cat "$C2/f.txt")" "0|a's f" "L17f4: … and freed once A lands"
unset CWD

# ---- L17g: actual claims (ADR 0067 d4): an earlier chain's unlanded file stands a later chain's land ----
# gscen <name> [B] — A's a1 (cell a1.txt) and B's b1 (cell b1.txt) both commit f.txt; A begins first (B with `B`)
gscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1; mkcopies
  if [ "${2:-}" = B ]; then RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; RO=$RO1; LNOW=2026-10-20T11:00+00:00 CWD="$C1" leg begin --cwd "$C1"
  else CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"; RO=$RO1; fi
  CWD="$C1" leg claim --task a1; mkdir -p "$C1/_shared/state/thread-events" "$C1/docs/reviews"
  echo e > "$C1/_shared/state/thread-events/run.jsonl"; echo r > "$C1/docs/reviews/r.md"
  tcommit "$C1" a1 f.txt "a's f"; d=$(review "$C1" HEAD)
  CWD="$C1" leg done --task a1 --verify pass --review "$d" --cwd "$C1"; ok "$rc" 0 "$1: done a1"
  RO=$RO2; CWD="$C2" work "$C2" b1 f.txt "b's f"; m0=$(master)
}
gscen l17g
ok "$(fm a1 leg_claims)" "[\"repo:$R//f.txt\"]" "L17g: done stamps leg_claims: f.txt only (no docs/reviews/, no bookkeeping)"
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and began first|True" \
   "L17g: B's land on f.txt stands: A began first and holds it unlanded (waits True)"
ok "$(master)|$(fm b1 leg_landed)" "$m0|<none>" "L17g: … nothing moved or stamped"
gscen l17g2 B
CWD="$C2" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17g: control: B began first: A never blocks it"
gscen l17g3; git -C "$R" merge -q --no-edit "chain/$RO1"
CWD="$C2" leg land
hasnt "$(lands)" "holds repo:" "L17g: control: a1 merged into master by hand (unstamped): git says landed, no claim stand"
gscen l17g4; RO=$RO1; subst "$T/a1.md" "leg_claims: [\"repo:$R//f.txt\"]" ""; RO=$RO2
CWD="$C2" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17g: control: a1 without leg_claims: (done before them) never blocks"
scen l17g5; R="$S/r"; mkrepo "$R" https://github.com/o/g5.git; export CWD="$R"
mkro '' "t1~cc-r~$R~\`repo:$R//c.txt\`"; mkt t1; leg begin --cwd "$R"; work "$R" t1 c.txt "t1 work"
ok "$(fm t1 leg_claims)" "<none>" "L17g: control: an in-place done stamps no leg_claims:"
leg land; ok "$rc|$(q 'd["inPlace"]')|$(q 'd["lands"]')" "0|True|[]" "L17i: in place, land is inPlace with no lands"
unset CWD

# ---- L17q: a land that stands on an earlier chain's claim still brings in what other chains landed ----
# X ($RO3) began first and holds f.txt unlanded; B's ($RO2) done b1 committed f.txt too, so B's land stands on X's
# claim; A ($RO1) has landed g.txt, and B's b2 depends on A's a1
lscen l17q; RO3=demox-rollout-2026-10-20; C3="$S/chains/r-$RO3"
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//b2.txt\`"; mkt b1; mkt b2 'depends-on:' '  - "[[a1]]"'
RO=$RO3; mkro '' "x1~cc-r~$R~\`repo:$R//x1.txt\`"; mkt x1; CWD="$R" leg copies; mkcopies
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; ok "$rc" 0 "L17q: X's Leg begins first"
RO=$RO1; LNOW=2026-10-20T11:00+00:00 CWD="$C1" leg begin --cwd "$C1"
RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L17q: … then A's and B's"
RO=$RO3; CWD="$C3" work "$C3" x1 f.txt "x's f"
RO=$RO2; CWD="$C2" work "$C2" b1 f.txt "b's f"; b1sha=$(git -C "$C2" rev-parse HEAD)
RO=$RO1; CWD="$C1" work "$C1" a1 g.txt "a's g"; CWD="$C1" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17q: A lands g.txt beside X's unlanded f.txt"; m0=$(master)
RO=$RO2; CWD="$C2" leg claim --task b2
ok "$rc|$(q 'd["error"]')" "1|[[b2]] depends on [[a1]] (on master, not yet in $C2: run leg.py land, which brings master in): run leg.py land, then claim again; nothing written" \
   "L17q: B's b2 is refused: a1 is on master, not yet in \$C2"
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO3]] holds repo:$R//f.txt unlanded and began first|True" "L17q: B's land stands on X's claim on f.txt"
ok "$(cat "$C2/g.txt")|$(git -C "$C2" rev-parse HEAD^1)|$(git -C "$C2" rev-parse HEAD^2)|$(git -C "$C2" log -1 --format=%s)" \
   "a's g|$b1sha|$m0|🔀 land: merge master into chain/$RO2" "L17q: … yet its merge brought A's landed g.txt into \$C2, kept on chain/B"
ok "$(q 'd["lands"][0]["head"]')|$(q 'd["lands"][0]["merged"]')|$(master)|$(fm b1 leg_landed)" "$(git -C "$C2" rev-parse HEAD)|$m0|$m0|<none>" \
   "L17q: … the stand names that merge, and master and b1 are unmoved"
CWD="$C2" leg claim --task b2; ok "$rc" 0 "L17q: … so the claim of b2 that land named passes"
tcommit "$C2" b2 b2.txt "b2 work"; d=$(review "$C2" HEAD); CWD="$C2" leg done --task b2 --verify pass --review "$d" --cwd "$C2"
subst "$T/x1.md" "leg_claims: [\"repo:$R//f.txt\"]" ""   # X's claim gone (as in L17g4): only the kept merge is left
CWD="$C2" leg land
ok "$rc|$(lands)|$(q '[v["task"] for v in d["lands"][0]["verify"]]')" "0|verify|None|None|['b1']" \
   "L17q: once X's claim clears, the kept merge asks for b1's re-verify (b2 was cut after it)"
unset CWD

# ---- L17r: the fast-forward in P re-reads P's branch after the peer check ----
# rscen <name> — one copy chain A with a1 done, unlanded; $m0 master, $tip chain/A's tip
rscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; CWD="$R" leg copies
  CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; m0=$(master); tip=$(git -C "$C1" rev-parse HEAD)
}
# pland <python> — A's land, in-process from $C1, after <python> (m the module, R the primary) patches it
pland() {
  out=$(cd "$C1" && python3 - "$LEG" "$T/$RO.md" "$T" "$V" "$NOW" "$R" "$1" <<'PY2'
import importlib.util, json, os, subprocess, sys
leg, note, tasks, vault, now, R, patch = sys.argv[1:]
spec = importlib.util.spec_from_file_location("legmod", leg); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
args = m.parser().parse_args(["land", "--rollout", note, "--tasks-dir", tasks, "--vault", vault, "--now", now, "--session", "s1"])
exec(patch)
print(json.dumps(m.cmd_land(m.Ctx(args), args)))
PY2
); rc=$?
}
rscen l17r
pland '
real = m.peer_stand
def peer_stand(*a, **k):   # R switches to w while the peer check reads the notes
    subprocess.run(["git", "-C", R, "checkout", "-q", "-b", "w"], check=True)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)" "0|stood|$R left master during the land (its HEAD is now refs/heads/w)|True" \
   "L17r: R switched to w after where was read: the land stands (waits True), never an ff of w"
ok "$(master)|$(git -C "$R" rev-parse w)|$(fm a1 leg_landed)|$(logn 'Leg 1 land: ')" "$m0|$m0|<none>|0" \
   "L17r: … master and w unmoved, nothing stamped, no land: line"
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)|$(git -C "$R" rev-parse w)" "0|landed|None|None|$tip|$m0" "L17r: control: the next land, R on w, lands by update-ref"
rscen l17r2
pland '
real, fired = m.git, []
def git(top, *a, **k):   # R switches to w2 between the re-read and the ff
    if not fired and "merge" in a and "--ff-only" in a and os.path.realpath(str(top)) == os.path.realpath(R):
        fired.append(1)
        real(R, "checkout", "-q", "-b", "w2")
    return real(top, *a, **k)
m.git = git'
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$tip" \
   "L17r: an ff that moved w2, not master, is moved, never landed: the next try lands master by update-ref"
ok "$(logn "Leg 1 land: \[\[a1\]\] on master in $R (${tip:0:12})\$")|$(fm a1 leg_landed)" "1|$NOW" "L17r: … logged once, a1 stamped"
unset CWD

# ---- L17h: the per-repo lock ----
# holdlock <lock file> <flag> — an outside holder of a lock; $hp its pid, recorded for cleanup
holdlock() {
  mkdir -p "$(dirname "$1")"
  python3 -c 'import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); fcntl.flock(fd, fcntl.LOCK_EX); open(sys.argv[2], "w").write("held")
time.sleep(120)' "$1" "$2" &
  hp=$!; holders+=("$hp")
  local i=0; while [ ! -f "$2" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
}
lscen l17h; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; mkcopies
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; m0=$(master)
RL="$(git -C "$R" rev-parse --path-format=absolute --git-common-dir)/thread/chain-land.lock"
holdlock "$RL" "$TMP/rl1"; hp1=$hp
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|another land held $RL past 1s|True" "L17h: a held chain-land.lock: exit 0, the copy stands naming it (waits True)"
ok "$(master)|$(fm a1 leg_landed)" "$m0|<none>" "L17h: … nothing moved"
holdlock "$THREAD_LEG_LOCK_DIR/$RO1.lock" "$TMP/rl2"; hp2=$hp
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C1" leg land; ok "$rc" 5 "L17h: a held rollout lock is still exit 5"
kill "$hp1" "$hp2"; wait "$hp1" "$hp2" 2>/dev/null
# (h2) two copies, R1's lock held: R1 stands, R2 lands; a row's stamp waits for every entry
cscen l17h2; R="$S/r"; crepo "$R" https://github.com/o/h2.git; R2="$S/r2"; crepo "$R2" https://github.com/o/h22.git
C="$S/chains/r-$RO"; C2="$S/chains/r2-$RO"
mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\` \`repo:$R2//b.txt\`"; mkt t1
CWD="$R" leg copies; CWD="$C" leg begin --cwd "$C"; CWD="$C" work "$C" t1 c.txt "t1 work"
pcommit "$C2" THREAD.md closed "📝 docs(thread): close-out"; c2=$(git -C "$C2" rev-parse HEAD)
subst "$T/t1.md" "leg_head: [\"$C@" "leg_head: [\"$C2@$c2\", \"$C@"
RL2="$(git -C "$R" rev-parse --path-format=absolute --git-common-dir)/thread/chain-land.lock"
holdlock "$RL2" "$TMP/rl3"
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C" leg land
ok "$rc|$(lands)" "0|stood|another land held $RL2 past 1s|True;landed|None|None" "L17h2: R1 locked: R1 stands, R2 lands"
ok "$(git -C "$R2" rev-parse master)|$(fm t1 leg_landed)" "$c2|<none>" "L17h2: … t1's R2 entry is on master, yet its stamp waits for R1's"
kill "$hp"; wait "$hp" 2>/dev/null
CWD="$C" leg land
ok "$rc|$(lands)|$(fm t1 leg_landed)" "0|landed|None|None;current|None|None|$NOW" "L17h2: once free, R1 lands and t1 is stamped"
unset CWD

# ---- L17j: --red keeps the merge and moves nothing ----
# jscen <name> — A lands a1; B's b1 (cut before it) asks for its re-verify
jscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//b2.txt\`"; mkt b1; mkt b2; RO=$RO1; mkcopies
  CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" work "$C2" b1 b1.txt "b1 work"
  RO=$RO1; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land; m0=$(master); RO=$RO2
}
jscen l17j
CWD="$C2" leg land; ok "$(lands)" "verify|None|None" "L17j: B's land asks"; h=$(q 'd["lands"][0]["head"]')
snap; CWD="$C2" leg land --red "make test red"
ok "$rc|$(lands)|$(master)|$(git -C "$C2" rev-parse HEAD)" "0|stood|Verify red after a land merge: make test red|False|$m0|$h" \
   "L17j1: --red logs the stand, keeps the merge on chain/B and moves nothing"
ok "$(diff "$TMP/snap" "$T/$RO.md" | grep -c '^>')|$(logn "Leg 1 land stood: $R: Verify red after a land merge: make test red\$")" "1|1" \
   "L17j1: … one line written"
# (j2) the close-time land: B's Leg closed, its red files no fix (file-fix refuses a closed Leg), the next Leg asks again
jscen l17j2
CWD="$C2" leg close --outcome handoff --cwd "$C2"; ok "$rc" 0 "L17j2: B's Leg 1 closes with a handoff"
CWD="$C2" leg land; ok "$rc|$(lands)" "0|verify|None|None" "L17j2: the closed Leg's land asks for the re-verify"
h=$(q 'd["lands"][0]["head"]'); snap
CWD="$C2" leg land --red "x"
ok "$rc|$(diff "$TMP/snap" "$T/$RO.md" | grep '^>' | sed 's/^> //')" "0|- $NOW Leg 1 land stood: $R: Verify red after a land merge: x" \
   "L17j2: --red on a closed Leg writes only that stand line"
ok "$(master)|$(git -C "$C2" rev-parse HEAD)" "$m0|$h" "L17j2: … no ref moved"
CWD="$C2" leg file-fix --target b1 --cause outside --evidence x
ok "$rc" 1 "L17j2: file-fix on the closed Leg is exit 1"; has "$err" "no Leg has begun" "L17j2: … naming it"
SESS=s2 CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["landFirst"]')" "0|True" "L17j2: the next Leg's begin prints landFirst"
has "$(q 'd["warns"]')" "WARN: $C2: chain/$RO2 has commits master lacks, not yet landed (run leg.py land before the first claim)" \
   "L17j2: … its copy holding master through the kept merge"
SESS=s2 CWD="$C2" leg land; ok "$rc|$(lands)" "0|verify|None|None" "L17j2: … and its land asks again (no verified tip recorded)"
unset CWD

# ---- L17m: a verified tip is recorded, so a stand after --verified asks nothing more ----
jscen l17m
CWD="$C2" leg land; h=$(q 'd["lands"][0]["head"]'); echo x > "$R/b1.txt"
CWD="$C2" leg land --verified "$h"
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on b1.txt|False" "L17m: --verified, then the ff stands on a peer's file"
ok "$(logn "Leg 1 land verified: $R at $h\$")" 1 "L17m: … the verified tip logged"
rm "$R/b1.txt"; CWD="$C2" leg land
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$h" "L17m: once the file is gone it lands with no ask"
CWD="$C2" work "$C2" b2 b2.txt "b2 work"; pcommit "$R" other.txt o "a peer moves master"
CWD="$C2" leg land; h2=$(q 'd["lands"][0]["head"]'); echo x > "$R/b2.txt"
CWD="$C2" leg land --verified "$h2"; ok "$(lands)" "stood|the primary's uncommitted edit on b2.txt|False" "L17m: control: a second round stands"
rm "$R/b2.txt"; pcommit "$R" other2.txt o "master moves again"
CWD="$C2" leg land; ok "$rc|$(lands)" "0|verify|None|None" "L17m: control: master moved after the verify: it asks again"
unset CWD

# ---- L17i: stands that run no git, the refusals, and the in-place peer ----
lscen l17i; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`" "a2~cc-r~$R~\`repo:$R//a2.txt\`"; mkt a1; mkt a2; mkcopies
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
snap; CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|a row is in progress: a land never merges mid-task|False" "L17i: a row in progress stands every copy"
ok "$(diff "$TMP/snap" "$T/$RO.md" | grep -c '^>')" 1 "L17i: … logging only its stand"
tcommit "$C1" a1 a1.txt "a1 work"; d=$(review "$C1" HEAD); CWD="$C1" leg done --task a1 --verify pass --review "$d" --cwd "$C1"
m0=$(master); snap; CWD="$C1" leg land --dry-run
ok "$rc|$(q 'd["lands"][0]["state"]')|$(q 'd["lands"][0]["plan"]["unl"]')|$(q 'd["lands"][0]["plan"]["ff"]')|$(q 'd["dryRun"]')" \
   "0|plan|['a1']|merge --ff-only in $R|True" "L17i: --dry-run prints the plan"
ok "$(master)|$(fm a1 leg_landed)" "$m0|<none>" "L17i: … and moves nothing"; same "L17i: --dry-run"
SESS=s9 CWD="$C1" leg land; ok "$rc" 1 "L17i: another session's land is exit 1"
has "$err" "no Leg of this session: run leg.py begin first" "L17i: … naming it"
CWD="$C1" leg land --retire; ok "$rc" 1 "L17i: --retire on a live note is exit 1"
CWD="$C1" leg land --verified abc; ok "$rc|$out" "2|" "L17i: --verified needs a full sha (usage)"
CWD="$C1" leg land --red x --verified "$m0"; ok "$rc|$out" "2|" "L17i: --red with --verified is usage"
git -C "$R" checkout -q -b w; git -C "$R" worktree add -q "$S/mw" master
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)" "0|stood|master is checked out in $S/mw|False|$m0" "L17i: master checked out in another worktree: it stands"
git -C "$R" worktree remove "$S/mw"; git -C "$R" checkout -q master
dscen l17i2; CWD="$R" leg land; ok "$rc" 1 "L17i: plain land on an archived note is exit 1"
has "$err" "only file-followup and land --retire write after Complete" "L17i: … naming land --retire"
cscen l17i3
R="$S/r"; mkdir -p "$R"; git -c init.defaultBranch=trunk init -q "$R"; echo a > "$R/a.txt"; git -C "$R" add -A; git -C "$R" commit -qm base
C="$S/chains/r-$RO"; mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`"; mkt t1
CWD="$R" leg copies; CWD="$C" leg begin --cwd "$C"; CWD="$C" work "$C" t1 t.txt "t1 work"
CWD="$C" leg land
ok "$rc|$(lands)" "0|stood|$R has no default branch resolved (origin/HEAD, main or master)|False" "L17i: no default branch: it stands"
unset CWD
# The in-place peer: IP ($RO3) works $R in place, beside copy chain A ($RO1)
# pscen <name> — A's a1 done and landed, a close-out on chain/A, A closed stopped; IP's note (row ip1 on $R, from $R)
pscen() {
  lscen "$1"; RO3=demoip-rollout-2026-10-20
  mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO3; mkro '' "ip1~cc-r~$R~\`repo:$R//ip.txt\`"; mkt ip1; RO=$RO1
  CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"
  CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "$1: a1 lands"
  pcommit "$C1" THREAD.md closed "📝 docs(thread): close-out"
  CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
}
# closeout <name> — another close-out on chain/A
closeout() { pcommit "$C1" "THREAD-$1.md" "$1" "📝 docs(thread): close-out $1"; }
pscen l17p
RO=$RO3; CWD="$R" leg begin --cwd "$R"; ok "$rc" 0 "L17i (p1): IP's real begin in \$R passes beside A, all done and landed"
RO=$RO1; m0=$(master); rh=$(git -C "$R" rev-parse HEAD); ips=$(fm ip1 status)
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|[[$RO3]] works $R in place (Leg 1 open): a land never moves a checked-out master under another chain's live work|True" \
   "L17i (p1): A's closed-Leg land stands while IP's Leg is open in \$R (waits True)"
ok "$(master)|$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)|$(fm ip1 status)" "$m0|$rh||$ips" \
   "L17i (p1): … master, \$R's HEAD and tree and IP untouched"
ok "$(logn "Leg 1 land stood: $R: \[\[$RO3\]\] works $R in place (Leg 1 open)")" 1 "L17i (p1): … the stand logged"
RO=$RO3; CWD="$R" leg claim --task ip1; CWD="$R" leg close --outcome stopped --reason "out of time" --cwd "$R"; RO=$RO1
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|[[$RO3]] works $R in place ([[ip1]] in progress): a land never moves a checked-out master under another chain's live work|True" \
   "L17i (p2): IP closed with ip1 in progress: it still stands"
RO=$RO3; CWD="$R" leg begin --cwd "$R"; CWD="$R" leg claim --task ip1 --inherit; ok "$rc" 0 "L17i (p3): IP's Leg 2 takes ip1"
CWD="$R" leg set-aside --task ip1 --reason "set aside"; ok "$rc" 0 "L17i (p3): … sets it aside"
CWD="$R" leg close --outcome stuck --cwd "$R"; ok "$rc" 0 "L17i (p3): … and closes stuck"; RO=$RO1
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$(git -C "$C1" rev-parse HEAD)" "L17i (p3): control: nothing of IP's is live: A lands"
R2="$S/r2"; crepo "$R2" https://github.com/o/p2.git; RO4=demoipb-rollout-2026-10-20
RO=$RO4; mkro '' "q1~cc-r~$R2~\`repo:$R2//q.txt\`"; mkt q1; CWD="$R2" leg begin --cwd "$R2"; ok "$rc" 0 "L17i (p3): a second in-place chain opens a Leg in \$R2"
RO=$RO1; closeout two; CWD="$C1" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17i (p3): control: a live chain in place in another repo: A lands"
RO5=demoipc-rollout-2026-10-20; RO=$RO5; mkro '' "r1~cc-r~$R~\`repo:$R//r.txt\`"; mkt r1
CWD="$R" leg begin --cwd "$R"; ok "$rc" 0 "L17i (p3): a third in-place chain opens a Leg in \$R"
git -C "$R" checkout -q -b w; RO=$RO1; closeout three; wh=$(git -C "$R" rev-parse HEAD)
CWD="$C1" leg land
ok "$rc|$(lands)|$(git -C "$R" symbolic-ref --short HEAD)|$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)" \
   "0|landed|None|None|w|$wh|" "L17i (p3): control: \$R on w, master checked out nowhere: update-ref beside that open Leg, \$R untouched"
git -C "$R" checkout -q master
RO=$RO5; CWD="$R" leg close --outcome stopped --reason "out of time" --cwd "$R"
subst "$T/$RO5.md" "status: open" "status: dropped"   # its unlanded row in $R would hold a later chain's begin there (d4)
RO6=demoipd-rollout-2026-10-20; RO=$RO6; EXTRA_FM='chain_copies: []'$'\n' mkro '' "s1~cc-r~$R~\`repo:$R//s.txt\`"; mkt s1
CWD="$R" leg copies; C6="$S/chains/r-$RO6"; CWD="$C6" leg begin --cwd "$C6"; ok "$rc" 0 "L17i (p3): a copy chain opens a Leg"
RO=$RO1; closeout four; CWD="$C1" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17i (p3): control: a chain with chain_copies: is no peer: A lands"
unset CWD
# (p4) A complete and archived, IP's Leg open: --retire keeps both, then retires both once IP closes
lscen l17p4; RO3=demoip-rollout-2026-10-20
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; RO=$RO3; mkro '' "ip1~cc-r~$R~\`repo:$R//ip.txt\`"; mkt ip1; RO=$RO1
CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land
CWD="$C1" leg close --outcome complete --cwd "$C1" --reflection "$REFL"; ok "$rc" 0 "L17i (p4): A completes"
RO=$RO3; CWD="$R" leg begin --cwd "$R"; RO=$RO1; closeout one
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(test -d "$C1" && echo y)" "0|[(False, False, False)]|y" \
   "L17i (p4): --retire beside IP's open Leg keeps the copy and the branch"
has "$(cat "$T/$(q 'd["followup"]').md")" "once [[$RO3]]'s Leg closes, run" "L17i (p4): … its follow-on waits for IP's Leg"
RO=$RO3; CWD="$R" leg close --outcome stopped --reason "out of time" --cwd "$R"; RO=$RO1
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(test -d "$C1" && echo y || echo n)" "0|[(True, True, True)]|n" \
   "L17i (p4): once IP's Leg closes, the same --retire retires both"
unset CWD
# (p5) a peer whose Chain read raises stands only when its surfaces: name the primary (or read as any)
p5() {  # p5 <IP's extra surfaces line> — A's land, in-process, with Chain raising for IP's note
  RO=$RO3; EXTRA_FM="$1"$'\n' mkro '' "ip1~cc-r~$R~\`repo:$R//ip.txt\`"; RO=$RO1
  out=$(python3 - "$LEG" "$T/$RO1.md" "$T" "$V" "$NOW" "$RO3" <<'PY2'
import importlib.util, json, sys
leg, note, tasks, vault, now, bad = sys.argv[1:]
spec = importlib.util.spec_from_file_location("legmod", leg); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
args = m.parser().parse_args(["land", "--rollout", note, "--tasks-dir", tasks, "--vault", vault, "--now", now, "--session", "s1"])
real = m.Chain
class Chain(real):
    def __init__(self, ctx):
        if ctx.rollout.stem == bad:
            raise ValueError("planted")
        super().__init__(ctx)
m.Chain = Chain
print(json.dumps(m.cmd_land(m.Ctx(args), args)))
PY2
)
}
pscen l17p5; closeout five
p5 '  - "repo:'"$R"'"'
ok "$(lands)" "stood|[[$RO3]] could not be read (ValueError: planted) and may work $R in place: fix its note|False" \
   "L17i (p5): an unreadable peer whose surfaces: name \$R stands the land, waits False"
R2="$S/r2"; mkdir -p "$R2"; p5 '  - "repo:'"$R2"'"'
ok "$(lands)" "landed|None|None" "L17i (p5): … one whose surfaces: name only \$R2 lets it land"
has "$(q 'd["warns"]')" "WARN: [[$RO3]] could not be read (ValueError: planted)" "L17i (p5): … with a WARN"

# ---- L17o: Complete lands first, so the completion verify runs on the landed tip ----
lscen l17o; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(printf '  - "repo:%s"\ncompletion_verifier: "true"' "$R")$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" work "$C2" b1 b1.txt "b1 work"
RO=$RO1; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')" complete "L17o: B's next is complete"
CWD="$C2" leg land; ok "$(lands)" "verify|None|None" "L17o: Land first: B's land asks for b1's re-verify"
CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)" "landed|None|None" "L17o: … then lands"
CWD="$C2" rcv --run; ok "$rc|$(q 'd["result"]')" "0|green" "L17o: the completion verify runs green"
ok "$(master)" "$(git -C "$C2" rev-parse HEAD)" "L17o: … on the copy's HEAD, which is master"
CWD="$C2" leg close --outcome complete --cwd "$C2" --reflection "$REFL"; ok "$rc" 0 "L17o: complete"
has "$(cat "$T/Archive/Rollouts/$RO2.md")" "- Completion verify: green at $(master | cut -c1-12) (\`true\`)" \
   "L17o: … its Completion verify line names master's landed tip"
# (o2) a land that waits for an earlier chain closes the Leg stopped, never a halt; once that chain lands, it completes
lscen l17o2; printf '1\n2\n3\n4\n5\n' > "$R/f.txt"; git -C "$R" add f.txt; git -C "$R" commit -qm "f"
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"; RO=$RO1
CWD="$C1" work "$C1" a1 f.txt $'A\n2\n3\n4\n5'
RO=$RO2; CWD="$C2" work "$C2" b1 f.txt $'1\n2\n3\n4\nB'
CWD="$C2" leg next; ok "$(q 'd["action"]')" complete "L17o2: B's rows are all done: next is complete"
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and began first|True" "L17o2: Land first waits on A (waits True)"
CWD="$C2" leg close --outcome stopped --reason "land waits: [[$RO1]] holds repo:$R//f.txt unlanded and began first" --cwd "$C2"
ok "$rc|$(fm "$RO2" status)|$(test -f "$T/$RO2.md" && echo live)" "0|open|live" "L17o2: … B closes stopped: the note stays live, not done"
RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L17o2: A lands"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc|$(q 'd["next"]["action"]')" "0|complete" "L17o2: B's fresh Leg reads complete"
CWD="$C2" leg land; ok "$(lands)" "verify|None|None" "L17o2: … its land merges A's f.txt in and asks"
CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)|$(cat "$R/f.txt" | tr '\n' ' ')" "landed|None|None|A 2 3 4 B " \
   "L17o2: … then lands both edits"
CWD="$C2" leg close --outcome complete --cwd "$C2" --reflection "$REFL"; ok "$rc" 0 "L17o2: and Complete closes"
unset CWD
echo
if [ "$fail" -eq 0 ]; then echo "leg.test.sh: ALL PASS"; else echo "leg.test.sh: FAILED"; fi
exit "$fail"
