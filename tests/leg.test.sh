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
#        re-reads P's branch after the peer check, and lands only when <d> is the tip (L17r); it merges only when <d> is
#        strictly behind the chain branch and unmoved since step 4, after live-checkout.sh's overlap mode, so a stand
#        or a no-op leaves R's ORIG_HEAD absent (L17s: s1 in L17c, s2 a moved <d> before the overlap, s3 <d> already
#        the tip, s4 the branch at <d>, s5 the branch unreadable, s6 the overlap mode unrunnable).
#   L18  same-file waits go by rank, wait-die at claim (ADR 0067 d9): order_key and first_by (L18a); a higher-ranked chain
#        waits on a running lower-ranked holder, then goes first (L18b), its reservation sets a third chain's row aside
#        (L18c); a lower-ranked chain sets its row aside and claims another (L18d); aging lifts a waiter, and only its open
#        Leg's lines count (L18e); a task whose kind alternates logs each flip and polls, never returning at once (L18v);
#        no mutual wait over 10368 two-chain fixtures (L18f); an in-place chain is no rank peer
#        (L18g); only repo: and any rank-wait (L18h); claim re-reads the rank under the rank lock (L18i); begin's launch
#        check and status read the contention-aware plan, a never-begun chain's as begun (L18j2), and a chain held so
#        reads ready (L18j, L18t); a holder with no open Leg is not running: a stalled retry, a stopped close, (O)'s holder
#        half at the next begin, a later dead holder that holds nothing, and a dead holder's die over a live one whatever
#        the peers' order (L18k); land's claim check by rank (L18l); landFirst (L18m); the (H) land wait and its
#        controls (L18n); a fix row is never waited (L18o); ADR 0060's yield ahead of rank (L18q); one hop (L18u); wait's
#        cleared and --dry-run (L18p).
#   L19  the Security check on a serial chain (execute § 3 `security_checks`; legs.md § The task loop's **Security
#        check.**): begin's preflight, before the lock and after the halt check, on every begin (L19a); `security` in
#        place, a primary scanned in a detached scratch tree: its refusals, its record and section, the ask by pushed
#        (false, true from the remote-tracking ref or leg.py's own ls-remote, null), his untracked and tracked edits
#        untouched, an unscannable gitleaks, the budget and its floor, a dead run's tree swept, a HEAD moved mid-scan
#        (L19b); Chain copies: the Leg's documented rewrite, a revert refused over a copy's secret, a rewrite below the
#        review's head, a config red's --scan-ask summary, a stray in the primary, an unscanned copy's halt, and the
#        cannot-rewrite halt with his remedy before clear-halt (L19c); done reads the latest scan, a copy's at its HEAD
#        (L19d); set-aside's gate, its usage and the in-place secret's halt (L19e); the re-entry through repair's
#        record-answer run from /bin/bash, with its controls (L19f); an unscannable checkout halts with the claim kept
#        (L19g); in process: shell_safe, security_ask, run_scan's cut and settle_pushed (L19h). A stub gitleaks
#        (THREAD_GITLEAKS), local bare origins and a closed OSV port: no network, and no token sits in this file.
#   L20  begin's `mcp` (ADR 0074 d2): the required namespaces of this launch's unlanded rows, read by serial-chains.py's
#        required_mcp: the optional part dropped, a line with no `required` word read, `required none` read as nothing,
#        and another launch's rows left out
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
# ohR / nohR — the primary's ORIG_HEAD, absent or written / removed: a refused or no-op `merge --ff-only` writes it, so a
# land that ran no merge leaves it absent (p39-4)
ohR() { [ -e "$(git -C "$R" rev-parse --path-format=absolute --git-path ORIG_HEAD)" ] && echo written || echo absent; }
nohR() { rm -f "$(git -C "$R" rev-parse --path-format=absolute --git-path ORIG_HEAD)"; }

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
echo "peer's b" > "$R/b.txt"; m0=$(master); nohR
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on b.txt|False" "L17c: a peer's uncommitted edit on b.txt stands the land"
ok "$(master)|$(cat "$R/b.txt")|$(git -C "$R" stash list | wc -l | tr -d ' ')|$(fm a1 leg_landed)" "$m0|peer's b|0|<none>" \
   "L17c: … master unchanged, the edit intact, nothing stashed, nothing stamped"
ok "$(ohR)" absent "L17s1: … and no merge ran: R's ORIG_HEAD absent (the overlap stood it first)"
git -C "$R" checkout -q -- b.txt
CWD="$C1" work "$C1" a2 n.txt "a2's n"; echo "untracked" > "$R/n.txt"; nohR
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on n.txt|False" "L17c: an untracked file in the ff's way stands it too"
ok "$(master)|$(cat "$R/n.txt")" "$m0|untracked" "L17c: … the file intact"
ok "$(ohR)" absent "L17s1: … and R's ORIG_HEAD absent"
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
# claim; A ($RO1) has landed g.txt, and B's b2 depends on A's a1. B acts 16 minutes after X's done: within 15 minutes, X
# (earlier, between tasks) reads as about to land, and B's next would first wait for that land ((H), ADR 0067 d9: L18n).
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
export LNOW=2026-10-20T10:16+00:00
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
unset LNOW
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

# ---- L17s: the ff in P runs only when <d> is strictly behind the chain branch, and the overlap first (p39-4) ----
# Each case patches A's land once, from a wrapped peer_stand (between step 4 and the re-read), as L17r does.
# s2: <d> moves on and an untracked file lands in R's way: moved first (re-run from step 4), never the overlap's stand
rscen l17s2; nohR
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        subprocess.run(["git", "-C", R, "commit", "-q", "--allow-empty", "-m", "peer moves master"], check=True)
        open(os.path.join(R, "a1.txt"), "w").write("peer a1\n")
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)" "0|verify|None|None" \
   "L17s2: master moved during the peer check: moved, then the next try asks for the re-verify, never the overlap's stand"
ok "$(git -C "$R" log -1 --format=%s master)|$(cat "$R/a1.txt")|$(ohR)|$(fm a1 leg_landed)" "peer moves master|peer a1|absent|<none>" \
   "L17s2: … master is the moved commit, a1.txt intact, R's ORIG_HEAD absent, nothing stamped"
rm -f "$R/a1.txt"; unset CWD
# s3: R's master is already the chain's tip at the re-read (moved there by hand): landed, and no no-op merge ran
rscen l17s3
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        br = "refs/heads/chain/" + os.path.basename(note)[:-3]
        subprocess.run(["git", "-C", R, "merge", "-q", "--ff-only", br], check=True)
        oh = subprocess.run(["git", "-C", R, "rev-parse", "--path-format=absolute", "--git-path", "ORIG_HEAD"],
                            capture_output=True, text=True).stdout.strip()
        if os.path.exists(oh):
            os.remove(oh)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)|$(master)|$(ohR)" "0|landed|None|None|$tip|absent" \
   "L17s3: master already at the chain's tip: landed with no merge run (R's ORIG_HEAD absent)"
unset CWD
# s4: the chain branch is moved back to master: d equals it, so moved with no merge, then the next try is current
rscen l17s4; nohR
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        br = "refs/heads/chain/" + os.path.basename(note)[:-3]
        subprocess.run(["git", "-C", R, "update-ref", br, "refs/heads/master"], check=True)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)|$(master)|$(ohR)" "0|current|None|None|$m0|absent" \
   "L17s4: chain/<RO> moved to master: moved with no merge run, then current, R's ORIG_HEAD absent"
unset CWD
# s5: the chain branch is gone at the re-read, d unmoved: it stands, naming the branch, and no merge runs
rscen l17s5; nohR
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        br = "refs/heads/chain/" + os.path.basename(note)[:-3]
        subprocess.run(["git", "-C", R, "update-ref", "-d", br], check=True)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)|$(master)|$(ohR)" "0|stood|cannot read refs/heads/chain/$RO in $R|False|$m0|absent" \
   "L17s5: chain/<RO> unreadable with master unmoved: it stands, naming it, no merge run"
unset CWD
# s6: the overlap mode cannot run: a WARN, and the merge goes on with git's own refusal as its only guard
rscen l17s6
pland 'm.LIVE_CHECKOUT_SH = m.Path("/nonexistent/live-checkout.sh")'
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$tip" "L17s6: live-checkout.sh overlap cannot run: the ff still lands"
has "$(q 'd["warns"]')" "WARN: $R: live-checkout.sh overlap exit 127: the fast-forward ran with git's own refusal as its only guard" \
   "L17s6: … with a WARN naming it"
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
# ════ L18: same-file waits go by rank, wait-die at claim (ADR 0067 d9) ════════════════════════════════════════════════
# Copy chains in one repo ($R, as L17's lscen), each note stamped with an estate rank of one orient-all pass (rk), Legs
# opened through begin, real git. A chain that ranks above waits at claim on a running holder's row; one below sets
# the row aside to retry; a holder with no open Leg is not running, so it stands the next begin instead (O's holder
# half); every wait is bounded.
RANK_AT="2026-10-20T08:00:00+00:00"
# rk <n> — mkro's EXTRA_FM for an estate rank of the pass at $RANK_AT
rk() { printf 'estate_rank: %s\nestate_rank_at: "%s"\n' "$1" "$RANK_AT"; }
# kscen <name> — lscen, plus a third chain $RO3 (copy $C3)
kscen() { lscen "$1"; RO3=demox-rollout-2026-10-20; C3="$S/chains/r-$RO3"; }
# fbase — a five-line f.txt on master, so two chains' edits of its first and last lines merge clean
fbase() { printf '1\n2\n3\n4\n5\n' > "$R/f.txt"; git -C "$R" add f.txt; git -C "$R" commit -qm "f"; git -C "$R" update-ref refs/remotes/origin/master HEAD; }
# nx — the last next's `action|kind|task|on`
nx() { q '"%s|%s|%s|%s" % (d.get("action"), d.get("kind"), d.get("task"), d.get("on"))'; }
# heldwhy <slug> — the last next's held why for that row
heldwhy() { q "[h['why'] for h in d['held'] if h['slug'] == '$1']"; }
# twork <copy> <task> <file> <content> — commit, review and done (the task already claimed)
twork() { tcommit "$1" "$2" "$3" "$4"; local d; d=$(review "$1" HEAD); leg done --task "$2" --verify pass --review "$d" --cwd "$1"; ok "$rc" 0 "done $2 (reviewed)"; }

# ---- L18a: order_key and first_by, in-process ----
la() {
  python3 - "$LEG" "$1" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("legmod", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
k, fb = m.order_key, m.first_by
B1, B2 = "2026-10-20T10:00+00:00", "2026-10-21T10:00+00:00"
r1, r2 = {"n": 1, "at": "a", "ts": 2000.0}, {"n": 2, "at": "a", "ts": 2000.0}
old, new2 = {"n": 1, "at": "a", "ts": 1000.0}, {"n": 2, "at": "b", "ts": 3000.0}
exec(sys.argv[2])
PY
}
ok "$(la 'print(k("b", B2) < k("a", None, r1), k("b", B2, r2) < k("a", B1), k("b", B1, new2) < k("a", B1, old), k("b", B1, r1) < k("a", B1, r2))')" \
   "True True True True" "L18a: the began tier first, then stamped before unstamped, a later pass first, the lower n first"
ok "$(la 'print(k("b", B1) < k("a", B2), k("b", None, None, "2026-10-01") < k("a", None, None, "2026-10-20"), k("a", None, None, "2026-10-20") < k("b", None, None, "2026-10-20"), k("b", None, None, "2026-10-20") < k("a", None, None, None), k("a", None, None, None) == k("a", None, None, "x"))')" \
   "True True True True True" "L18a: begun ties by began, never-begun ones by captured (a missing or malformed date last), then slug"
ok "$(la 'print(k("b", B1, r1, "2026-09-01") < k("a", B2, r2, "2026-09-01"), k("a", B1, r1) == k("a", B1, r1, "2026-01-01"), k("a", "not a stamp") == k("a", None))')" \
   "True True True" "L18a: captured: breaks only never-begun ties; a stamp that will not parse reads as never begun"
ok "$(la 'from pathlib import Path; n = lambda fm: m.rr.Note(Path("/x/n.md"), "---\n" + fm + "\n---\n"); print(m.sc.read_estate_rank(n("estate_rank: x\nestate_rank_at: 2026-10-20T08:00+00:00"), m.rr._parse_ts), k("a", B1, m.sc.read_estate_rank(n("estate_rank: x"), m.rr._parse_ts)) == k("a", B1))')" \
   "None True" "L18a: a malformed stamp reads as unstamped"
ok "$(la 'print(fb(k("a", B1), k("b", None)), "|", fb(k("a", B2, r1), k("b", B1)), "|", fb(k("a", B1, r1), k("b", B1, r2)), "|", fb(k("a", B1, new2), k("b", B1, old)), "|", fb(k("a", B1), k("b", B2)))')" \
   "began first | ranks above (estate rank 1) | ranks above (estate rank 1) | ranks above (estate rank 2) | began first" \
   "L18a: first_by: the tier and the began stamp say began first, the stamp, the pass and n say ranks above"
ok "$(la 'print(fb(k("b", None, None, "2026-10-01"), k("a", None, None, "2026-10-20")), "|", fb(k("a", None), k("b", None)), "|", fb(k("a", B1), k("b", B1)))')" \
   "was scheduled first | comes first by slug (neither has begun) | comes first by slug (both began at the same stamp)" \
   "L18a: … the earlier schedule, and today's slug words"

# ---- L18b: a higher-ranked chain waits on a lower-ranked holder, then goes first (L18i: next writes nothing; L18p: a
#      cleared wait and --dry-run log nothing); L18c: its reservation sets a third chain's row aside ----
kscen l18b; fbase
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1
RO=$RO3; EXTRA_FM=$(rk 3)$'\n' mkro '' "c1~cc-r~$R~\`repo:$R//f.txt\`" "c2~cc-r~$R~\`repo:$R//g.txt\`"; mkt c1; mkt c2
CWD="$R" leg copies; mkcopies
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18b: B (rank 2) claims b1 on f.txt first"
RO=$RO1; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18b: A (rank 1) begins beside B's open Leg: a code file meets at claim, not at begin"
snap; CWD="$C1" leg next
ok "$rc|$(nx)" "0|wait|wait|a1|$RO2" "L18b: A's next is a wait on B: A ranks above the holder of b1"
ok "$(q 'd["token"]')|$(q 'd["stalled"]')|$(q 'd["landFirst"]')" "repo:$R//f.txt|False|[]" "L18b: … on f.txt, not stalled, nothing to land first"
same "L18i: next writes nothing"
snap; CWD="$C1" leg claim --task a1
ok "$rc" 1 "L18b: … and A's claim is refused"
has "$err" "next is \`wait a1\`, not claim of [[a1]]: nothing written" "L18b: … naming the wait"; same "L18b: a refused claim"
snap; CWD="$C1" leg wait --task a1 --for 0 --dry-run
ok "$rc|$(q 'd["kind"]')|$(q 'd["cleared"]')|$(q 'd["logged"]')" "0|wait|False|False" "L18p: wait --dry-run reads the wait"; same "L18p: … and logs nothing"
CWD="$C1" leg wait --task a1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["cleared"]')|$(q 'd["stalled"]')|$(q 'd["logged"]')|$(q 'd["on"]')" "0|wait|False|False|True|$RO2" \
   "L18b: wait --for 0 logs the wait and prints cleared false"
ok "$(logn "Leg 1 rank wait: \[\[a1\]\] on \[\[$RO2\]\] (repo:$R//f.txt; ranks above it)\$")" 1 "L18b: … its rank wait: line"
CWD="$C1" leg wait --task a1 --for 0
ok "$rc|$(q 'd["logged"]')|$(logn 'rank wait:')" "0|False|1" "L18b: a second wait logs nothing: a1's latest line already records its kind"
RO=$RO2; tcommit "$C2" b1 f.txt $'1\n2\n3\n4\nB'; d=$(review "$C2" HEAD); CWD="$C2" leg done --task b1 --verify pass --review "$d" --cwd "$C2"
RO=$RO1; CWD="$C1" leg next; ok "$(nx)" "wait|wait|a1|$RO2" "L18b: B's done b1, not yet landed, still holds A"
RO=$RO2; CWD="$C2" leg land; ok "$rc|$(lands)|$(fm b1 leg_landed)" "0|landed|None|None|$NOW" "L18b: B lands b1, stamping leg_landed"
# L18c: C (rank 3) begins while A's wait still stands
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; ok "$rc" 0 "L18c: C begins"
CWD="$C3" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(heldwhy c1)" "claim|c2|['rank: [[$RO1]] ranks above and reserves repo:$R//f.txt; retry later']" \
   "L18c: C's c1 is held on A's reservation, and C claims c2"
CWD="$C3" leg claim --task c2; ok "$rc" 0 "L18c: … claimed"
RO=$RO1; snap; CWD="$C1" leg wait --task a1 --for 0
ok "$rc|$(q 'd["cleared"]')|$(q 'd["logged"]')|$(q 'd["next"]["action"]')" "0|True|False|claim" "L18p: once b1 lands, A's wait clears"
same "L18p: … and a cleared wait logs nothing"
CWD="$C1" leg land; ok "$rc|$(lands)" "0|current|None|None" "L18b: A's land brings master (b1) into its copy"
CWD="$C1" leg claim --task a1; ok "$rc" 0 "L18b: A claims a1: it went first among the waiters"
CWD="$C1" leg status
ok "$(q 'd["rank"]["standing"]')|$(q 'd["rank"]["lifts"]')|$(q 'd["rank"]["pos"]')|$(q 'd["rank"]["stamp"]["n"]')" "[]|0|0|1" \
   "L18b: after the claim no rank line stands and lifts are 0"
twork "$C1" a1 f.txt $'A\n2\n3\n4\nB'
RO=$RO3; CWD="$C3" leg next; ok "$(q 'd["action"]')" finish "L18c: C finishes c2 first"
RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18c: A lands a1"
RO=$RO3; twork "$C3" c2 g.txt "c's g"; CWD="$C3" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|c1" "L18c: once A's a1 is landed, C's c1 is claimable"
unset CWD

# ---- L18d: a lower-ranked chain sets its task aside and claims another row; L18e: aging lifts it ----
lscen l18d
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1; mkt a2
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(heldwhy b1)" "claim|b2|['rank: [[$RO1]] ranks above and holds repo:$R//f.txt; retry later']" \
   "L18d: B (rank 2) never waits on A's a1: it sets b1 aside to retry and claims b2"
CWD="$C2" leg claim --task b2; twork "$C2" b2 g.txt "b's g"; CWD="$C2" leg land
CWD="$C2" leg next
ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|False" "L18d: with nothing else left, B's next is a retry on b1, not stalled"
CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["logged"]')|$(q 'd["flipped"]')" "0|retry|True|False" "L18d: wait logs the retry"
ok "$(logn "Leg 1 rank retry: \[\[b1\]\] on \[\[$RO1\]\] (repo:$R//f.txt; \[\[$RO1\]\] ranks above)\$")" 1 "L18d: … its rank retry: line"
LNOW=2026-10-20T10:59+00:00 CWD="$C2" leg next
ok "$(nx)|$(q 'd["held"][0]["slug"]')" "wait|retry|b1|$RO1|b1" "L18e: 59 minutes on, B still sets b1 aside"
LNOW=2026-10-20T11:01+00:00 CWD="$C2" leg next
ok "$(nx)" "wait|wait|b1|$RO1" "L18e: 61 minutes on, aging lifts B above A: it now waits on a1"
LNOW=2026-10-20T11:01+00:00 CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["kind"]')|$(q 'd["flipped"]')|$(q 'd["logged"]')|$(q 'd["lifts"]')|$(q 'd["waitedMinutes"]')" "0|wait|True|True|1|61" \
   "L18e: wait prints flipped, then logs the wait (lifts 1, 61 minutes waited)"
ok "$(logn "Leg 1 rank wait: \[\[b1\]\] on \[\[$RO1\]\] (repo:$R//f.txt; ranks above it)\$")" 1 "L18e: … its rank wait: line"
RO=$RO1; LNOW=2026-10-20T11:01+00:00 twork "$C1" a1 f.txt "a's f"
LNOW=2026-10-20T11:01+00:00 CWD="$C1" leg next
ok "$(nx)|$(heldwhy a2)" "wait|retry|a2|$RO2|['rank: [[$RO2]] ranks above and reserves repo:$R//f.txt; retry later']" \
   "L18e: A's next row a2 on f.txt is held on lifted B's reservation"
LNOW=2026-10-20T11:01+00:00 CWD="$C1" leg land; ok "$(lands)" "verify|None|None" "L18e: A's land merges B's landed b2 in and asks"
LNOW=2026-10-20T11:01+00:00 CWD="$C1" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)" "landed|None|None" "L18e: … then lands a1"
RO=$RO2; LNOW=2026-10-20T11:02+00:00 CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18e: B claims b1 first"
LNOW=2026-10-20T11:02+00:00 CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18e: … claimed"
LNOW=2026-10-20T11:02+00:00 CWD="$C2" leg status
ok "$(q 'd["rank"]["lifts"]')|$(q 'd["rank"]["standing"]')" "0|[]" "L18e: after B's claim, lifts are 0"
RO=$RO1; LNOW=2026-10-20T11:02+00:00 CWD="$C1" leg next
ok "$(nx)" "wait|wait|a2|$RO2" "L18e: … B's lines lapse at its claim, so A ranks above again and waits on b1: no preemption"
unset CWD
# L18e2: a standing line counts only in its open Leg: a closed Leg's retry lifts nothing
lscen l18e2; EXTRA_FM=$(rk 1)$'\n' mkro '' "t1~cc-r~$R~\`repo:$R//f.txt\`"; mkt t1; CWD="$R" leg copies
CWD="$C1" leg begin --cwd "$C1"
printf -- '- 2026-10-20T08:00+00:00 Leg 1 rank retry: [[t1]] on [[other-rollout-2026-10-20]] (repo:%s//f.txt; [[other-rollout-2026-10-20]] ranks above)\n' "$R" >> "$T/$RO.md"
CWD="$C1" leg status
ok "$(q 'd["rank"]["lifts"]')|$(q '[(x["task"], x["kind"]) for x in d["rank"]["standing"]]')" "2|[('t1', 'retry')]" \
   "L18e2: a retry line standing two hours in the open Leg lifts its chain twice"
CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"; LNOW=2026-10-20T10:05+00:00 CWD="$C1" leg begin --cwd "$C1"
LNOW=2026-10-20T10:05+00:00 CWD="$C1" leg status
ok "$(q 'd["openLeg"]')|$(q 'd["rank"]["lifts"]')|$(q 'd["rank"]["standing"]')" "2|0|[]" "L18e2: a retry line of a closed Leg lifts nothing in the next"
unset CWD
# L18v: a task whose kind alternates (floor-based lifts on two waiters at offset phases) holds both kinds' lines; wait
# logs a line whenever the kind differs from the task's latest, so it records the kind it waits as and polls, never
# returning at once into a Leg loop with no sleep
lscen l18v
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; LNOW=2026-10-20T10:20+00:00 CWD="$C2" leg next
ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|False" "L18v: B's only row is a retry on A's a1"
printf -- '- 2026-10-20T10:05+00:00 Leg 1 rank retry: [[b1]] on [[%s]] (repo:%s//f.txt; [[%s]] ranks above)\n' "$RO1" "$R" "$RO1" >> "$T/$RO.md"
printf -- '- 2026-10-20T10:10+00:00 Leg 1 rank wait: [[b1]] on [[%s]] (repo:%s//f.txt; ranks above it)\n' "$RO1" "$R" >> "$T/$RO.md"
t0=$SECONDS; LNOW=2026-10-20T10:20+00:00 CWD="$C2" leg wait --task b1 --for 2; el=$((SECONDS - t0))
ok "$rc|$(q 'd["kind"]')|$(q 'd["flipped"]')|$(q 'd["logged"]')|$(q 'd["cleared"]')|$(q 'd["stalled"]')|$([ "$el" -ge 2 ] && echo polled)" \
   "0|retry|True|True|False|False|polled" "L18v: with a wait line latest, a retry flips, logs a fresh retry line and polls its --for"
ok "$(logn 'rank retry: \[\[b1\]\]')|$(grep 'Leg 1 rank ' "$T/$RO.md" | tail -n 1 | grep -c 'rank retry: \[\[b1\]\]')" "2|1" \
   "L18v: … so b1's latest standing line records the kind it waits as"
snap; t0=$SECONDS; LNOW=2026-10-20T10:21+00:00 CWD="$C2" leg wait --task b1 --for 2; el=$((SECONDS - t0))
ok "$rc|$(q 'd["kind"]')|$(q 'd["flipped"]')|$(q 'd["logged"]')|$([ "$el" -ge 2 ] && echo polled)" "0|retry|False|False|polled" \
   "L18v: the next call flips nothing, logs nothing and polls"; same "L18v: … a call that only polls"
unset CWD

# ---- L18f: no fixture reaches a mutual wait (in-process, leg.py loaded by path): a property loop over two copied
#      chains' rank order, lifts, row states, open Legs, reservations and a row behind the other ----
lf() {
  python3 - "$LEG" <<'PY'
import importlib.util, itertools, sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location("legmod", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
NOW = datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc)
F = ("repo", "/r//f.txt")
STAMP = lambda minutes: (NOW - timedelta(minutes=minutes)).isoformat(timespec="minutes")

class Note:
    def __init__(self, **kv): self.kv = kv
    def get(self, k): return self.kv.get(k)

class Row:
    def __init__(self, slug, state, owner=None, unlanded=False):
        self.slug, self.state, self.unlanded, self.surfaces = slug, state, unlanded, ["repo:/r//f.txt"]
        self.note = Note(status={"running": "in_progress", "queued": "open", "done": "done"}[state], owner=owner)
        self.alias, self.folder, self.i = "cc-r", "/r", 0
    def same_launch(self, alias, folder): return True

class Chain:
    def __init__(self, slug, key, open_, rows, lines):
        self.ctx, self.key, self.open_, self.rows, self.lines = SimpleNamespace(slug=slug), key, open_, rows, lines
        self.note, self.log, self.contend = Note(), [], {}
        self.legs = {1: {"n": 1, "began": "x", "closed": None if open_ else "stopped: x"}}
    def open_leg(self): return {"n": 1, "alias": "cc-r", "folder": "/r"} if self.open_ else None
    def counted(self): return list(self.rows)
    def row(self, slug): return next((r for r in self.rows if r.slug.lower() == slug.lower()), None)
    def fixes(self): return []

WORLD = {}
m.sc.read_chain_copies = lambda note: []
m.other_serial = lambda ctx: [(SimpleNamespace(stem=s), WORLD[s]) for s in WORLD if s != ctx.slug]
m.peer_chain = lambda ctx, path: WORLD[path.stem]
m.chain_key = lambda C, began=None: C.key
m.standing_lines = lambda C, dead=(): C.lines if C.open_ else []
m.unlanded_done = lambda C, r: r.unlanded
m.leg_claim_tokens = lambda r: [F] if r.unlanded else []
m.holds_of = lambda chain, r: []

def make(slug, first, state, open_, reserve, lifted, behind):
    rows = [Row(f"{slug}0", "running" if state == "running" else "done", owner="leg-1" if state == "running" else None,
                unlanded=state == "unlanded"), Row(f"{slug}1", "queued")]
    if behind:
        rows.append(Row(f"{slug}b", "done", unlanded=True))
    other = "b" if slug == "a" else "a"
    lines = [{"task": f"{slug}1", "kind": reserve, "at": STAMP(61 if lifted else 1), "on": other}] if reserve else []
    return Chain(slug, (0, 0, -1.0, 1 if first else 2, 0.0, slug), open_, rows, lines)

bad, n, SEEN = [], 0, set()
opts = list(itertools.product(("running", "unlanded", "landed"), (True, False), (None, "retry", "wait"), (True, False),
                              (True, False)))
for a_first in (True, False):
    for oa in opts:
        for ob in opts:
            WORLD.clear()
            A, B = make("a", a_first, *oa), make("b", not a_first, *ob)
            WORLD.update(a=A, b=B)
            plans = {}
            for X in (A, B):
                if X.open_leg() is None:
                    continue
                X.contend = m.rank_contention(SimpleNamespace(slug=X.ctx.slug, now=NOW), X, 1)
                plans[X.ctx.slug] = m.plan_next(X, 1, "cc-r", "/r")
            n += 1
            label = f"a_first={a_first} a={oa} b={ob}"
            pa, pb = plans.get("a"), plans.get("b")
            SEEN.update(f"{p['action']}:{p.get('kind') or '-'}{':stalled' if p.get('stalled') else ''}" for p in plans.values())
            w = lambda p, kind: p is not None and p["action"] == "wait" and p["kind"] == kind
            if w(pa, "wait") and w(pb, "wait"):
                bad.append(f"mutual wait: {label}")
            for X, p in ((A, pa), (B, pb)):
                if p is None or p["action"] != "wait":
                    continue
                other = WORLD[p["on"]]
                if any(r.state == "running" and r.note.get("owner") == "leg-1" for r in X.rows):
                    bad.append(f"[[{X.ctx.slug}]] waits owning a row in progress: {label}")
                if p["kind"] == "wait" and other.open_leg() is None:
                    bad.append(f"[[{X.ctx.slug}]] waits on a chain with no open Leg: {label}")
                if p["kind"] == "land" and (not other.key < X.key or w(plans.get(other.ctx.slug), "land")):
                    bad.append(f"[[{X.ctx.slug}]]'s land wait points later or back: {label}")
                if p["kind"] == "retry" and p["stalled"] and (not other.key < X.key or other.open_leg() is not None):
                    bad.append(f"[[{X.ctx.slug}]]'s stalled retry is held by a running or later chain: {label}")
print(n, len(bad))
print(" ".join(sorted(SEEN)))
for b in bad[:5]:
    print(b)
PY
}
out_f=$(lf)
ok "$(printf '%s\n' "$out_f" | head -n 1)" "10368 0" "L18f: 10368 two-chain fixtures: no mutual wait, no wait owning a row in progress or on a chain not running, every land wait on an earlier chain, every stalled retry on an earlier chain with no open Leg"
ok "$(printf '%s\n' "$out_f" | sed -n 2p)" "claim:- finish:- wait:land wait:retry wait:retry:stalled wait:wait" "L18f: … the loop reaches every act: claim, finish, and each kind of wait"
[ "$(printf '%s\n' "$out_f" | head -n 1)" = "10368 0" ] || printf '%s\n' "$out_f"

# ---- L18g: an in-place chain beside a copy chain gets no rank hold, either way ----
lscen l18g; RO3=demoip-rollout-2026-10-20
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO3; EXTRA_FM=$(rk 2)$'\n' mkro '' "ip1~cc-r~$R~\`repo:$R//f.txt\`"; mkt ip1; RO=$RO1
CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18g: copy chain A's Leg begins"
# IP works $R in place: its Leg is opened by hand here, since begin's (M) would rightly hold it beside A's open Leg in $R
printf -- '\n## Leg log\n\n- 2026-10-20T09:00+00:00 Leg 1 began: leg-1 session s1 in cc-r from %s\n' "$R" >> "$T/$RO3.md"
RO=$RO3; CWD="$R" leg claim --task ip1; ok "$rc" 0 "L18g: in-place IP claims ip1 on f.txt: no rank read in place"
RO=$RO1; CWD="$C1" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|a1" "L18g: A's a1 on f.txt is claimable beside IP's ip1 in progress: an in-place chain is no rank peer"
CWD="$C1" leg status; ok "$(q 'd["rank"]["contention"]["held"]')" "{}" "L18g: … nothing held"
RO=$RO3; CWD="$R" leg status; ok "$(q 'd["rank"]["pos"]')|$(q 'd["rank"]["contention"]["held"]')" "None|{}" "L18g: … and the in-place chain reads no contention"
unset CWD

# ---- L18h: token kinds: vault against vault and ext: against ext: never rank-wait (d6); repo: against any is held; any
#      against vault is not ----
lscen l18h
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//z1.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//z2.txt\`" "b2~cc-r~$R~\`repo:$R//z3.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
# cell <rollout> <old> <new> — a Queue cell edited by hand after both begins (begin's own (M) would otherwise meet them)
cell() { subst "$T/$1.md" "| \`$2\` |" "| \`$3\` |"; }
cell "$RO1" "repo:$R//z1.txt" "repo:$R//f.txt"; cell "$RO2" "repo:$R//z2.txt" any
CWD="$C2" leg next
ok "$(q 'd["task"]')|$(heldwhy b1)" "b2|['rank: [[$RO1]] ranks above and holds repo:$R//f.txt; retry later']" "L18h: repo: against any (a bad cell) is held"
cell "$RO1" "repo:$R//f.txt" "vault:Work/Projects/A"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18h: any against vault is not"
cell "$RO2" any "vault:Work/Projects/A"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18h: vault against vault never rank-waits"
cell "$RO1" "vault:Work/Projects/A" "ext:cms"; cell "$RO2" "vault:Work/Projects/A" "ext:cms"; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18h: nor ext: against ext:"
unset CWD

# ---- L18i: a holder that claims between next and claim makes the claim refuse, under the rank lock ----
lscen l18i
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b1" "L18i: B's next proposes b1"
RO=$RO1; CWD="$C1" leg claim --task a1; RO=$RO2
snap; cp "$T/b1.md" "$TMP/snap-b1"; CWD="$C2" leg claim --task b1
ok "$rc" 1 "L18i: A claimed f.txt meanwhile: B's claim of b1 re-reads the rank and refuses"
has "$err" "next is \`claim b2\`, not claim of [[b1]]: nothing written" "L18i: … naming what next is now"
same "L18i: a refused claim"; cmp -s "$T/b1.md" "$TMP/snap-b1"; ok "$?" 0 "L18i: … and b1 is unwritten"
holdlock "$THREAD_LEG_LOCK_DIR/rank-claim.lock" "$TMP/rk1"; hpr=$hp
snap; LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C2" leg claim --task b2
ok "$rc" 5 "L18i: a held rank lock is exit 5"
has "$err" "the rank lock: another chain's claim held $THREAD_LEG_LOCK_DIR/rank-claim.lock past 1s" "L18i: … naming it"; same "L18i: … nothing written"
kill "$hpr" 2>/dev/null; wait "$hpr" 2>/dev/null
CWD="$C2" leg claim --task b2; ok "$rc" 0 "L18i: once released, B claims b2"
unset CWD

# ---- L18j, L18t: begin's launch check and status read the contention-aware plan; a chain whose rows are all held by a
#      running, higher-ranked chain reads ready, never stuck ----
lscen l18j
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R/sub/l~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg status
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["cwd"]')|$(q 'd["restart"]["blockedBy"]')" "b2|$C2/sub/l|None" \
   "L18t: b1 held by A, b2 claimable in another launch folder: the restart opens in b2's folder"
snap; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["exit"]')" "4|4" "L18j: begin in b1's folder is the wrong launch: the launch check reads the contention-aware plan"
same "L18j: … nothing written"
CWD="$C2/sub/l" leg begin --cwd "$C2/sub/l"; ok "$rc|$(q 'd["next"]["action"]')|$(q 'd["next"]["task"]')" "0|claim|b2" \
   "L18j: begin in b2's folder passes the launch check"
unset CWD
# L18j2: two never-begun stamped chains begin in reverse rank order. A fresh Leg 1 reads its own chain as begun (every
# claim after its begin does), so A (rank 1) ranks above B's claim, its first row is a wait there, not a die, and its
# Leg 1 opens in that row's folder, not the next row's launch
lscen l18j2
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R/sub/l~\`repo:$R//g.txt\`"; mkt a1; mkt a2
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg claim --task b1
ok "$rc" 0 "L18j2: B (rank 2) begins first and claims b1 on f.txt"
RO=$RO1; CWD="$C1" leg status
ok "$(q 'd["chain"]')|$(q 'd["restart"]["task"]')|$(q 'd["restart"]["cwd"]')|$(q 'd["restart"]["blockedBy"]')" "not-started|a1|$C1|None" \
   "L18j2: A has never begun, but its restart reads it as begun: it opens in a1's folder"
ok "$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')|$(q 'd["next"]["on"]')|$(q 'd["rank"]["pos"]')|$(q 'd["rank"]["key"][0]')" \
   "wait|wait|$RO2|0|0" "L18j2: … its fresh Leg ranks above B (pos 0, the began tier) and waits on b1"
snap; CWD="$C1/sub/l" leg begin --cwd "$C1/sub/l"
ok "$rc|$(q 'd["exit"]')" "4|4" "L18j2: begin in a2's folder is the wrong launch"; same "L18j2: … nothing written"
CWD="$C1" leg begin --cwd "$C1"
ok "$rc|$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')|$(q 'd["next"]["task"]')|$(q 'd["next"]["on"]')" "0|wait|wait|a1|$RO2" \
   "L18j2: begin in a1's folder passes the launch check, and Leg 1's next is the wait on a1"
unset CWD
lscen l18t
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg next; ok "$(nx)" "wait|retry|b1|$RO1" "L18t: B's only row is held by A, running and ranked above"
CWD="$C2" leg close --outcome stuck --cwd "$C2"; ok "$rc" 0 "L18t: B's Leg closes"
CWD="$C2" leg status
ok "$(q 'd["chain"]')|$(q 'd["hold"]["scope"]')|$(q 'd["next"]["action"]')|$(q 'd["next"]["kind"]')" "ready|whole|wait|retry" \
   "L18t: B reads ready (never stuck), holds its whole claim, and its next is the retry"
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["rows"][0]["held"]')" "b1|None|rank: [[$RO1]] ranks above and holds repo:$R//f.txt; retry later" \
   "L18t: its restart is the held row, unblocked, and the row carries the rank's why"
subst "$T/$RO2.md" "estate_rank: 2" "estate_rank: x"; CWD="$C2" leg status
ok "$(q 'd["rank"]["stamp"]')|$(q 'd["rank"]["warn"]')" \
   "None|estate_rank: x, estate_rank_at: $RANK_AT is malformed: read as unstamped (ADR 0067 d9)" "L18t: a malformed stamp reads as unstamped, with a WARN"
ok "$(q 'd["hold"]["warn"]')" "estate_rank: x, estate_rank_at: $RANK_AT is malformed: read as unstamped (ADR 0067 d9)" "L18t: … the hold's warn too"
unset CWD

# ---- L18k (R2-1): a holder with no open Leg is not running: never waited on at claim; it stands the next begin of a
#      chain that sorts after it ((O)'s holder half), and holds nothing against one that sorts before it ----
kscen l18k; RO1=demoxk-rollout-2026-10-20; C1="$S/chains/r-$RO1"   # X ($RO1, rank 1) and B ($RO2, rank 2)
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "x1~cc-r~$R~\`repo:$R//f.txt\`"; mkt x1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2
mkcopies; RO=$RO1; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task x1
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18k: B begins beside X's open Leg"
RO=$RO1; CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"; ok "$rc" 0 "L18k: X's Leg closes stopped with x1 in progress"
RO=$RO2; CWD="$C2" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(heldwhy b1)" "claim|b2|['rank: [[$RO1]] holds repo:$R//f.txt with no open Leg; its next Leg finishes or lands it']" \
   "L18k (k1): B never waits on X, which is not running: b1 is set aside, and B claims b2"
CWD="$C2" leg claim --task b2; twork "$C2" b2 g.txt "b's g"; CWD="$C2" leg land; ok "$(lands)" "landed|None|None" "L18k: B lands b2"
CWD="$C2" leg next
ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|True" "L18k (k2): with only b1 left, B's next is a stalled retry"
snap; CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["stalled"]')|$(q 'd["logged"]')" "0|True|False" "L18k (k2): wait prints stalled"; same "L18k (k2): … and logs nothing"
CWD="$C2" leg close --outcome stopped --reason "rank wait: $(q 'd["why"]')" --cwd "$C2"; ok "$rc" 0 "L18k (k2): B closes stopped"
CWD="$C2" leg status
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["blockedBy"]')" "b1|surface held by [[$RO1]] (repo:$R//f.txt)" \
   "L18k (k3): B's restart is blocked by X's surface, so repair never restarts it into the same wait"
snap; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["held"]')" "3|[{'rollout': '$RO1', 'token': 'repo:$R//f.txt'}]" "L18k (k3): B's begin is exit 3"
has "$(q 'd["status_line"]')" "surface held: [[$RO1]] holds repo:$R//f.txt" "L18k (k3): … surface held"; same "L18k (k3): … nothing written"
RO=$RO1; CWD="$C1" leg status
ok "$(q 'd["restart"]["task"]')|$(q 'd["restart"]["blockedBy"]')" "x1|None" "L18k (k3): X's restart is the finish of x1, unblocked"
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task x1 --inherit; ok "$rc" 0 "L18k (k4): X's Leg 2 takes x1"
RO=$RO2; CWD="$C2" leg status; ok "$(q 'd["restart"]["blockedBy"]')" "None" "L18k (k4): once X's Leg is open, B's restart is unblocked"
CWD="$C2" leg begin --cwd "$C2"; ok "$rc|$(q 'd["leg"]')" "0|2" "L18k (k4): B's Leg 2 begins"
CWD="$C2" leg next; ok "$(nx)|$(q 'd["stalled"]')" "wait|retry|b1|$RO1|False" "L18k (k4): … its next a retry, not stalled: X runs"
CWD="$C2" leg wait --task b1 --for 0; ok "$(q 'd["logged"]')" True "L18k: B logs its retry"
LNOW=2026-10-20T13:01+00:00 CWD="$C2" leg wait --task b1 --for 0
ok "$rc|$(q 'd["stalled"]')|$(q 'd["waitedMinutes"]')" "0|True|181" "L18k (k6): a line standing 181 minutes on a running holder is stalled"
RO=$RO1; twork "$C1" x1 f.txt "x's f"; CWD="$C1" leg land; ok "$(lands)" "verify|None|None" "L18k (k4): X's land merges B's b2 and asks"
CWD="$C1" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)" "landed|None|None" "L18k (k4): … then lands x1"
RO=$RO2; CWD="$C2" leg wait --task b1 --for 0; ok "$rc|$(q 'd["cleared"]')" "0|True" "L18k (k4): B's wait clears"
CWD="$C2" leg land; CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18k (k4): … and B claims b1"
unset CWD
# k5: a later dead holder holds nothing against a chain that sorts before it; its land stands behind that chain
lscen l18k5; fbase; RO1=demoak-rollout-2026-10-20; C1="$S/chains/r-$RO1"; RO2=demoyk-rollout-2026-10-20; C2="$S/chains/r-$RO2"
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "y1~cc-r~$R~\`repo:$R//f.txt\`"; mkt y1
mkcopies; RO=$RO1; LNOW=2026-10-20T09:00+00:00 CWD="$C1" leg begin --cwd "$C1"
LNOW=2026-10-20T09:00+00:00 CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
RO=$RO2; LNOW=2026-10-20T09:30+00:00 CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18k (k5): Y (rank 2) begins while A has no open Leg"
LNOW=2026-10-20T09:30+00:00 CWD="$C2" leg claim --task y1; ok "$rc" 0 "L18k (k5): … and claims y1 on f.txt"
LNOW=2026-10-20T09:30+00:00 CWD="$C2" leg close --outcome stopped --reason "out of time" --cwd "$C2"
RO=$RO1; CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18k (k5): A's begin passes beside Y's y1 in progress: a later holder"
CWD="$C1" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|a1" "L18k (k5): … and A claims a1: Y, not running and later, holds nothing"
CWD="$C1" leg claim --task a1; twork "$C1" a1 f.txt $'A\n2\n3\n4\n5'
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18k (k5): Y's Leg 2 begins"
CWD="$C2" leg claim --task y1 --inherit; twork "$C2" y1 f.txt $'1\n2\n3\n4\nY'
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "L18k (k5): Y's land stands behind A, which ranks above"
RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18k (k5): A lands"
RO=$RO2; CWD="$C2" leg land; CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"
ok "$(lands)|$(git -C "$R" show master:f.txt | tr '\n' ' ')" "landed|None|None|A 2 3 4 Y " "L18k (k5): … then Y's land merges A's work and lands"
unset CWD
# k7: a row held both by an earlier running chain and by an earlier one with no open Leg is a dead die, whichever note
#     sorts first: it cannot clear until the dead holder's Leg opens, so the retry is stalled, never a 180-minute poll.
#     L ($RO1, rank 1, running) sorts before D ($RO2, rank 2, no open Leg) in other_serial's path order; B ($RO3) is rank 3
kscen l18k7
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "l1~cc-r~$R~\`repo:$R//f.txt\`"; mkt l1
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "d1~cc-r~$R~\`repo:$R//f.txt\`"; mkt d1
RO=$RO3; EXTRA_FM=$(rk 3)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1
CWD="$R" leg copies; mkcopies
RO=$RO1; LNOW=2026-10-20T09:00+00:00 CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L18k (k7): L's Leg 1 begins"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" leg claim --task d1; ok "$rc" 0 "L18k (k7): D claims d1 on f.txt"
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; ok "$rc" 0 "L18k (k7): B begins beside D's open Leg"
RO=$RO2; CWD="$C2" leg close --outcome stopped --reason "out of time" --cwd "$C2"; ok "$rc" 0 "L18k (k7): D's Leg closes with d1 in progress"
RO=$RO1; CWD="$C1" leg claim --task l1; ok "$rc" 0 "L18k (k7): L claims l1 on f.txt: D, later and not running, holds nothing against it"
RO=$RO3; CWD="$C3" leg next
ok "$(nx)|$(q 'd["stalled"]')|$(heldwhy b1)" \
   "wait|retry|b1|$RO2|True|['rank: [[$RO2]] holds repo:$R//f.txt with no open Leg; its next Leg finishes or lands it']" \
   "L18k (k7): B's retry on b1 names D, with no open Leg, and is stalled, though L's running note sorts first"
unset CWD

# ---- L18l: land's claim check is rank-led: the later-begun, higher-ranked chain lands first ----
gscen2() {   # as gscen: A's a1 and B's b1 both commit f.txt; A begins first, B ranks above
  lscen "$1"; EXTRA_FM=$(rk 2)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; EXTRA_FM=$(rk 1)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1; mkcopies
  CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"
  RO=$RO1; CWD="$C1" work "$C1" a1 f.txt "a's f"; RO=$RO2; CWD="$C2" work "$C2" b1 f.txt "b's f"
}
gscen2 l18l
RO=$RO1; CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|[[$RO2]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "L18l: A began first, but B ranks above: A's land stands"
RO=$RO2; CWD="$C2" leg land; ok "$rc|$(lands)" "0|landed|None|None" "L18l: … and B's lands"
unset CWD

# ---- L18m (R1-4): the waiter side: a chain that waits on a holder whose land stands behind it lands its own rows first
#      (landFirst) ----
# mscen <name> — A (rank 1: a0 on a0.txt, a1 on f.txt) and B (rank 2: b1 on b1.txt, b2 on f.txt); a0 and b1 both edit
# f.txt (its first and last lines), A's a0 is done but not landed, and B's land of b1 stands behind it
mscen() {
  lscen "$1"; fbase
  EXTRA_FM=$(rk 1)$'\n' mkro '' "a0~cc-r~$R~\`repo:$R//a0.txt\`" "a1~cc-r~$R~\`repo:$R//f.txt\`"; mkt a0; mkt a1
  RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; mkt b2; RO=$RO1
  mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
  RO=$RO1; CWD="$C1" leg claim --task a0; RO=$RO2; CWD="$C2" leg claim --task b1
  RO=$RO1; twork "$C1" a0 f.txt $'A\n2\n3\n4\n5'; RO=$RO2; twork "$C2" b1 f.txt $'1\n2\n3\n4\nB'
  CWD="$C2" leg land
  ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "$1: B's land of b1 stands behind A's unlanded a0"
  RO=$RO1
}
mscen l18m
CWD="$C1" leg next
ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a1|$RO2|['a0']" "L18m: A's next waits on b1, with landFirst [a0]: b1 lands only after a0"
CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18m: A's land lands a0"
CWD="$C1" leg next; ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a1|$RO2|[]" "L18m: … then landFirst is []"
CWD="$C1" leg wait --task a1 --for 0; ok "$(q 'd["logged"]')" True "L18m: A logs its wait"
RO=$RO2; CWD="$C2" leg next
ok "$(nx)|$(heldwhy b2)" "wait|retry|b2|$RO1|['rank: [[$RO1]] ranks above and reserves repo:$R//f.txt; retry later']" "L18m: B's b2 on f.txt is held on A's reservation"
RO=$RO1; CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18m: once A's Leg closes stopped, its reservation lapses: B claims b2"
unset CWD
mscen l18m2; pcommit "$R" f.txt $'P\n2\n3\n4\n5' "a peer's edit of f.txt on master"
CWD="$C1" leg land; ok "$(lands)" "stood|conflict in f.txt|False" "L18m: the conflict variant: A's own land of a0 stands on a conflict"
CWD="$C1" leg next; ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a1|$RO2|['a0']" "L18m: … and landFirst still names a0"
unset CWD

# ---- L18n: (H), the holder side's land wait: a chain whose own unlanded row would stand behind an earlier chain that is
#      between tasks and about to land waits for that land before claiming, with its three controls ----
# nscen <name> — A (rank 1) and B (rank 2), each with a row done on its own cell that also edits f.txt; neither landed
nscen() {
  lscen "$1"; fbase
  EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`" "a2~cc-r~$R~\`repo:$R//a2.txt\`"; mkt a1; mkt a2
  RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//g.txt\`"; mkt b1; mkt b2; RO=$RO1
  mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
  RO=$RO1; CWD="$C1" leg claim --task a1; RO=$RO2; CWD="$C2" leg claim --task b1
  RO=$RO1; twork "$C1" a1 f.txt $'A\n2\n3\n4\n5'; RO=$RO2; twork "$C2" b1 f.txt $'1\n2\n3\n4\nB'
}
nscen l18n
CWD="$C2" leg next
ok "$(nx)|$(q 'd["lands"]')" "wait|land|b2|$RO1|['b1']" "L18n: B's next is a land wait: A, earlier and between tasks, has just finished a1 on f.txt"
LNOW=2026-10-20T10:16+00:00 CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: control: 16 minutes on, A's done is stale: B claims"
RO=$RO1; echo x >> "$R/f.txt"; CWD="$C1" leg land; ok "$(lands)" "stood|the primary's uncommitted edit on f.txt|False" "L18n: A's land stands"
git -C "$R" checkout -q -- f.txt; RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: control: a land stood after A's done: B claims"
unset CWD
nscen l18n2; RO=$RO1; CWD="$C1" leg claim --task a2
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: control: A's open Leg is mid-task (a2 in progress): B claims"
unset CWD
nscen l18n3; RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L18n: A lands a1"
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|b2" "L18n: … and B's land wait clears itself"
unset CWD
nscen l18n4; RO=$RO1; subst "$T/$RO1.md" "| \`repo:$R//a2.txt\` |" "| \`repo:$R//f.txt\` |"
CWD="$C1" leg next; ok "$(nx)|$(q 'd["landFirst"]')" "wait|wait|a2|$RO2|['a1']" "L18n: A waits on B's unlanded b1, landing a1 first"
CWD="$C1" leg wait --task a2 --for 0; ok "$(q 'd["logged"]')" True "L18n: … and logs its wait on B"
RO=$RO2; LNOW=2026-10-20T10:16+00:00 CWD="$C2" leg next
ok "$(nx)" "wait|land|b2|$RO1" "L18n: A's standing wait on B keeps B's land wait though A's done is 16 minutes old"
unset CWD

# ---- L18o: a red re-verify's fix on f.txt is claimed, never waited: a holder behind this chain never holds a fix row ----
lscen l18o; fbase
EXTRA_FM=$(rk 1)$'\n' mkro '' "a0~cc-r~$R~\`repo:$R//f.txt\`"; mkt a0
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
RO=$RO1; CWD="$C1" leg claim --task a0; RO=$RO2; CWD="$C2" leg claim --task b1
RO=$RO1; twork "$C1" a0 f.txt $'A\n2\n3\n4\n5'; RO=$RO2; twork "$C2" b1 f.txt $'1\n2\n3\n4\nB'
CWD="$C2" leg land; ok "$(lands)" "stood|[[$RO1]] holds repo:$R//f.txt unlanded and ranks above (estate rank 1)|True" "L18o: B's land stands behind A"
RO=$RO1; CWD="$C1" leg file-fix --target a0 --cause own --evidence "a0's Verify red after a land merge"; f0=$(q 'd["fix"]')
CWD="$C1" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')|$(q 'd["fix"]')" "claim|$f0|True" "L18o: A's fix on f.txt is claimed, though B's b1 there is unlanded behind A"
unset CWD

# ---- L18q (R2-4): ADR 0060's yield comes first: decided at begin, ahead of rank ----
lscen l18q
EXTRA_FM=$(rk 1)$'\n' mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R~\`repo:$R//g.txt\`"; mkt a1; mkt a2
RO=$RO2; EXTRA_FM=$(rk 2)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 f.txt "a's f"; CWD="$C1" leg land
CWD="$C1" leg claim --task a2; CWD="$C1" leg set-aside --task a2 --reason "blocked on a key"; CWD="$C1" leg close --outcome stuck --cwd "$C1"
python3 "$RR" hand-back --tasks a2 --tasks-dir "$T" > "$TMP/hb" 2>&1
snap; SESS=s2 CWD="$C1" leg begin --cwd "$C1"
ok "$rc|$(q 'd["held"]')" "3|[{'rollout': '$RO2', 'token': 'repo:$R//f.txt'}]" "L18q: A (rank 1) yields its smoke row's place to B (rank 2), scheduled on it while A was stuck"
has "$(q 'd["status_line"]')" "surface held: [[$RO2]] holds repo:$R//f.txt" "L18q: … at begin"; same "L18q: … nothing written"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L18q: B's begin passes"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L18q: … and B claims b1"
unset CWD

# ---- L18u: one hop: a peer's unlanded row whose land stands behind a third, earlier chain is not running ----
kscen l18u; fbase; RO1=demof-rollout-2026-10-20; C1="$S/chains/r-$RO1"; RO3=demoe-rollout-2026-10-20; C3="$S/chains/r-$RO3"
RO=$RO1; EXTRA_FM=$(rk 1)$'\n' mkro '' "f1~cc-r~$R~\`repo:$R//f.txt\`"; mkt f1
RO=$RO3; EXTRA_FM=$(rk 2)$'\n' mkro '' "e1~cc-r~$R~\`repo:$R//e1.txt\`"; mkt e1
RO=$RO2; EXTRA_FM=$(rk 3)$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1
CWD="$R" leg copies; RO=$RO3; CWD="$R" leg copies; RO=$RO1; CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; CWD="$C3" work "$C3" e1 f.txt $'E\n2\n3\n4\n5'
CWD="$C3" leg close --outcome stopped --reason "out of time" --cwd "$C3"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" work "$C2" b1 f.txt $'1\n2\n3\n4\nB'; CWD="$C2" leg land
ok "$(lands)" "stood|[[$RO3]] holds repo:$R//f.txt unlanded and ranks above (estate rank 2)|True" "L18u: B's land of b1 stands behind E"
RO=$RO1; CWD="$C1" leg next
ok "$(q 'd["action"]')|$(q 'd["task"]')" "claim|f1" "L18u: F claims f1: B's b1 stands behind E, so B, which sorts after F, holds nothing"
RO=$RO3; CWD="$C3" leg land; ok "$(lands)" "landed|None|None" "L18u: control: E's closed Leg lands e1"
RO=$RO1; CWD="$C1" leg next; ok "$(nx)" "wait|wait|f1|$RO2" "L18u: … now B's b1 runs, and F waits on it"
unset CWD

# ════ L19: the Security check on a serial chain (execute § 3 `security_checks`; legs.md § The task loop's **Security
# check.**) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# A python gitleaks stub (THREAD_GITLEAKS): `version` prints $STUB_VERSION (8.30.1); `git` logs its argv to $STUB_LOG,
# counts its calls in $STUB_COUNT, sleeps $STUB_SLEEP (its pid to $STUB_PIDS) and exits $STUB_GIT_EXIT when set, else
# emulates the github-pat rule over `git log -p` of its --log-opts range. The fake secret is built at run time from a
# fixed sha512, so no token sits in this file. Origins are local bare repos (GIT_ALLOW_PROTOCOL=file), OSV a closed port.
SCPY="$root/skills/execute/scripts/security-check.py"
GLS="$TMP/bin/gitleaks-stub"
cat > "$GLS" <<'STUB'
#!/usr/bin/env python3
import json, os, re, subprocess, sys, time
if sys.argv[1:2] == ["version"]:
    print(os.environ.get("STUB_VERSION", "8.30.1")); sys.exit(0)
args = sys.argv[1:]
cp = os.environ.get("STUB_COUNT")
if cp:
    n = int(open(cp).read() or 0) if os.path.exists(cp) else 0
    open(cp, "w").write(str(n + 1))
if os.environ.get("STUB_LOG"):
    open(os.environ["STUB_LOG"], "a").write(" ".join(args) + "\n")
if os.environ.get("STUB_SLEEP"):
    if os.environ.get("STUB_PIDS"):
        open(os.environ["STUB_PIDS"], "a").write(f"{os.getpid()}\n")
    time.sleep(float(os.environ["STUB_SLEEP"]))
if os.environ.get("STUB_GIT_EXIT"):
    sys.exit(int(os.environ["STUB_GIT_EXIT"]))
src, opts, i = args[1], {}, 2
while i < len(args):
    a = args[i]
    if a.startswith("--log-opts="):
        opts["log"] = a[len("--log-opts="):]
    elif a in ("--report-path", "--report-format", "--exit-code", "--log-level", "--config"):
        opts[a] = args[i + 1]; i += 1
    i += 1
out = subprocess.run(["git", "-C", src, "log", "-p", "--format=COMMIT %H", *opts["log"].split()], capture_output=True,
                     text=True).stdout
found, commit, file, ln = [], None, None, 0
for line in out.split("\n"):
    if line.startswith("COMMIT "):
        commit = line.split()[1]; continue
    if line.startswith("+++ "):
        file = line[6:] if line.startswith("+++ b/") else None; continue
    if line.startswith("--- ") or line.startswith("diff --git"):
        continue
    m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
    if m:
        ln = int(m.group(1)); continue
    if file is None:
        continue
    if line.startswith("+"):
        if re.search(r"ghp_[0-9A-Za-z]{36}", line):
            found.append({"RuleID": "github-pat", "File": file, "StartLine": ln, "Commit": commit, "Secret": "REDACTED"})
        ln += 1
    elif line.startswith(" "):
        ln += 1
json.dump(found, open(opts["--report-path"], "w"))
STUB
chmod +x "$GLS"
export THREAD_GITLEAKS="$GLS" THREAD_OSV_URL=http://127.0.0.1:9 GIT_ALLOW_PROTOCOL=file STUB_LOG="$TMP/stub.log"
SECRET=$(python3 -c 'import hashlib; h = hashlib.sha512(b"thread-security-fixture").digest(); A = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; print("gh" + "p_" + "".join(A[b % 62] for b in h[:36]))')
ok "${#SECRET}" 40 "L19: the fake secret is built at run time (ghp_ and 36 characters)"
SECFM='security_checks: true'
# sscen <name> [k rows]: an in-place chain on $R (origin the local bare $S/o.git, master pushed), $SECFM, rows a1..ak
sscen() {
  local k i=1 names=""
  scen "$1"; R="$S/r"; git init --bare -q "$S/o.git"; mkrepo "$R" "$S/o.git"; git -C "$R" push -q origin master
  k=${2:-3}; while [ "$i" -le "$k" ]; do names="$names a$i"; i=$((i+1)); done
  EXTRA_FM="$SECFM"$'\n' mkro '' $(rows cc-r "$R" "\`repo:$R\`" $names); for s in $names; do mkt "$s"; done
  git -C "$V" add -A; git -C "$V" commit -qm vault; export CWD="$R"; : > "$STUB_LOG"; : > "$TMP/net.log"
}
# csscen <name> [k rows]: the same in Chain copies: crepo's $R, its copy $C, the launch folder sub/l; Leg 1 begun there
csscen() {
  local k i=1 names=""
  cscen "$1"; R="$S/r"; C="$S/chains/r-$RO"; git init --bare -q "$S/o.git"; crepo "$R" https://github.com/o/r19.git
  git -C "$R" remote set-url origin "$S/o.git"; git -C "$R" push -q origin master
  k=${2:-3}; while [ "$i" -le "$k" ]; do names="$names a$i"; i=$((i+1)); done
  EXTRA_FM="$SECFM"$'\n' mkro '' $(rows cc-r "$R/sub/l" "\`repo:$R//a.txt\`" $names); for s in $names; do mkt "$s"; done
  git -C "$V" add -A; git -C "$V" commit -qm vault; : > "$STUB_LOG"; : > "$TMP/net.log"
  CWD="$R" leg copies; export CWD="$C/sub/l"; leg begin --cwd "$C/sub/l"
}
leak() { tcommit "$1" "$2" "${3:-cfg.py}" "TOKEN = '$SECRET'" "✨ feat: $2 config"; }   # leak <repo> <task> [file]
tq() { q "d[\"tops\"][${2:-0}][\"$1\"]"; }   # tq <key> [k]: the k-th top's key
nonet() { ok "$(wc -c < "$TMP/net.log" | tr -d ' ')" 0 "$1: no network call (net.log is empty)"; }
nosecret() { hasnt "$out$err$(cat "$T"/*.md)" "$SECRET" "$1: the secret is in no stdout, stderr or note"; }
summary() { leg status; q "[r for r in d[\"rows\"] if r[\"slug\"] == \"$1\"][0][\"setAside\"][\"summary\"]"; }
# scratch <repo>: its worktree count, then the leg-security-* and thread-security-* dirs left in $TMPDIR
scratch() { echo "$(git -C "$1" worktree list | grep -c .)|$(ls "$TMPDIR" | grep -c 'leg-security-')|$(ls "$TMPDIR" | grep -c 'thread-security-')"; }
basesha() { local b; b=$(fm "$1" "${2:-leg_base}"); b=${b#*@}; echo "${b%%\"*}"; }

# ---- L19a: begin runs the preflight ----
sscen l19a
leg begin --cwd "$R"
ok "$rc|$(q 'd["securityCheck"]["script"]')" "0|$SCPY" "L19a1: security_checks: true: begin prints securityCheck, the tree's security-check.py"
leg close --outcome stopped --reason x --cwd "$R"
subst "$T/$RO.md" "security_checks: true" "security_checks: false"; SESS=s2 leg begin --cwd "$R"
ok "$rc|$(q '"securityCheck" in d')" "0|False" "L19a2: false: no securityCheck"
SESS=s2 leg close --outcome stopped --reason x --cwd "$R"
subst "$T/$RO.md" $'\nsecurity_checks: false' ''; SESS=s3 leg begin --cwd "$R"
ok "$rc|$(q '"securityCheck" in d')|$(grep -c '^security_checks' "$T/$RO.md")" "0|False|0" "L19a2: … and the key absent: none"
SESS=s3 leg close --outcome stopped --reason x --cwd "$R"
subst "$T/$RO.md" $'\nshape: serial\n' $'\nshape: serial\nsecurity_checks: yes\n'; snap; SESS=s4 leg begin --cwd "$R"
ok "$rc|$(q 'd["status_line"]')" "1|ROLLOUT-STATUS: $RO merged=0/3 running=0 state=halted reason=\"security_checks refused on [[$RO]]\"" \
   "L19a3: yes: begin refuses, exit 1, on the security_checks status line"
has "$err" "security_checks: must be true or false, got 'yes': fix or remove the key, or install gitleaks" "L19a3: … naming the value and the remedy"
same "L19a3: a refused key"
subst "$T/$RO.md" "security_checks: yes" "security_checks: true"
SESS=s4 LEGENV=STUB_VERSION=8.18.0 leg begin --cwd "$R"
ok "$rc" 1 "L19a4: gitleaks older than 8.19.0: begin refuses"; has "$err" "older than 8.19.0" "L19a4: … relaying preflight's line"
SESS=s4 leg begin --cwd "$R"; SESS=s4 leg claim --task a1; SESS=s4 leg close --outcome halt --reason "held" --cwd "$R"
subst "$T/$RO.md" "security_checks: true" "security_checks: yes"; SESS=s5 leg begin --cwd "$R"
ok "$rc" 3 "L19a5: a standing halt and a bad key: the halt reads first (exit 3)"
SESS=s5 leg clear-halt --reason "go on"; subst "$T/$RO.md" "security_checks: yes" "security_checks: true"
SESS=s5 leg begin --cwd "$R"; ok "$rc" 0 "L19a6: the next Leg begins"
subst "$T/$RO.md" "security_checks: true" "security_checks: yes"; snap; SESS=s5 leg begin --cwd "$R"
ok "$rc|$(q 'd["error"]')" "1|security_checks: must be true or false, got 'yes': fix or remove the key, or install gitleaks, then /thread:execute [[$RO]] again; nothing written" \
   "L19a6: a silent resume with the key turned bad refuses too"
same "L19a6: the refused resume"
SESS=s5 leg begin --cwd "$R" --dry-run; ok "$rc" 1 "L19a7: --dry-run with a bad key refuses"
subst "$T/$RO.md" "security_checks: yes" "security_checks: true"
python3 - "$LEG" "$T/$RO.md" "$T" "$V" "$R" > "$TMP/l19a8" 2>&1 <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("leg", sys.argv[1]); leg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leg)
note, tasks, vault, R = sys.argv[2:6]
leg.rr = leg._load("reconcile_rollout", leg.RR_SRC); leg.sc = leg._load("serial_chains", leg.SC_SRC)
order, real, enter = [], leg.rr._security_check, leg.Lock.__enter__
def pre(n):
    order.append("preflight")
    t = open(note).read(); open(note, "w").write(t.replace("security_checks: true", "security_checks: false"))
    return real(n)
def ent(self):
    order.append("lock"); return enter(self)
leg.rr._security_check, leg.Lock.__enter__ = pre, ent
args = leg.parser().parse_args(["begin", "--cwd", R, "--rollout", note, "--tasks-dir", tasks, "--vault", vault,
                                "--now", "2026-10-20T10:00+00:00", "--session", "s5"])
try:
    leg.cmd_begin(leg.Ctx(args), args); print("begun")
except leg.Refuse as e:
    print(e.code, e.msg)
print(",".join(order))
PY
ok "$(cat "$TMP/l19a8")" "1 security_checks changed while begin ran: run begin again; nothing written
preflight,lock" "L19a8: in process: the preflight runs before the lock, and a key rewritten meanwhile refuses"
nonet L19a
unset CWD

# ---- L19b: security, in place (a primary, scanned in a detached scratch tree) ----
sscen l19b
leg begin --cwd "$R"; leg claim --task a1; base=$(git -C "$R" rev-parse HEAD)
subst "$T/$RO.md" "security_checks: true" "security_checks: false"; leg security --task a1
ok "$rc" 1 "L19b1: security with the key off is exit 1"; has "$err" "security_checks is not true on [[$RO]]: nothing to scan" "L19b1: … saying so"
subst "$T/$RO.md" "security_checks: false" "security_checks: yes"; leg security --task a1
ok "$rc" 1 "L19b1: … and with yes"; has "$err" "security_checks: must be true or false, got 'yes': fix the note" "L19b1: … naming it"
subst "$T/$RO.md" "security_checks: yes" "security_checks: true"
leg security --task a2; ok "$rc" 1 "L19b2: a queued task is refused"; has "$err" "[[a2]] is not Leg 1's in_progress claim" "L19b2: … as not this Leg's claim"
leg security --task a1
ok "$rc|$(q 'd["tops"]')|$(q 'd["clean"]')|$(fm a1 leg_scan)" "0|[]|True|<none>" "L19b2: no commit yet: tops [], clean, nothing written"
tcommit "$R" a1 c.txt "a1 work"; head=$(git -C "$R" rev-parse HEAD); : > "$STUB_LOG"
leg security --task a1
ok "$rc|$(tq primary)|$(tq base)|$(tq head)|$(tq verdict)|$(q 'd["ask"]')" "0|True|$base|$head|clean|None" \
   "L19b3: a clean own commit: one primary top, from its leg_base, at HEAD"
ok "$(fm a1 leg_scan)|$(grep -c '^## Security check' "$T/a1.md")" "[\"$R@$head clean\"]|0" "L19b3: … leg_scan records it, and no section"
has "$(cat "$STUB_LOG")" "--no-merges $base..$head" "L19b3: … gitleaks read the task's own range"
ok "$(scratch "$R")" "1|0|0" "L19b3: … in a scratch tree that is gone (one worktree, no leg-security-* or thread-security-*)"
ok "$(logn 'Leg 1 security')" 0 "L19b3: … and security writes no Leg log line"
leak "$R" a1; sec=$(git -C "$R" rev-parse HEAD)
leg security --task a1
ok "$rc|$(tq verdict)|$(tq rewrite)|$(q 'd["tops"][0]["secrets"][0]["pushed"]')" "0|secret|None|False" \
   "L19b4: an own unpushed secret: secret, no rewrite (a primary), pushed false (origin reachable, not holding it)"
ask=$(q 'd["ask"]')
ok "$ask" "A secret (github-pat) in cfg.py, commit ${sec:0:7}, line 1, is in $R's history, which a Leg never rewrites: rotate it, and while origin does not hold it you may rewrite it out of that history yourself before the halt is cleared?" \
   "L19b4: … the ask, the false wording"
hasnt "$ask" "whether origin holds it is unknown" "L19b4: … never the unknown wording"
for c in '`' '$' '"' '\'; do hasnt "$ask" "$c" "L19b4: … no $c in the ask"; done
has "$(cat "$T/a1.md")" "Ask: $ask" "L19b4: … written under ## Security check"
has "$(cat "$T/a1.md")" "- $R at ${sec:0:12}: secret: github-pat in cfg.py, commit ${sec:0:7}, line 1; a primary checkout's history, which a Leg never rewrites" \
   "L19b4: … with its secret line"
nosecret L19b4
git -C "$R" push -q origin master; leg security --task a1
ok "$(q 'd["tops"][0]["secrets"][0]["pushed"]')" True "L19b5: pushed (the remote-tracking ref holds it): pushed true"
has "$(q 'd["ask"]')" "is in $R's history, which a Leg never rewrites, and origin already holds it: rotate it?" "L19b5: … rotate it"
hasnt "$(q 'd["ask"]')" "rewrite it out" "L19b5: … and no rewrite is offered"
nonet L19b
unset CWD
sscen l19b5b; leg begin --cwd "$R"; leg claim --task a1; leak "$R" a1; o0=$(git -C "$R" rev-parse refs/remotes/origin/master)
git clone -q "$S/o.git" "$S/c2"; git -C "$S/c2" fetch -q "$R" master; git -C "$S/c2" push -q origin FETCH_HEAD:refs/heads/master
leg security --task a1
ok "$(git -C "$R" rev-parse refs/remotes/origin/master)|$(q 'd["tops"][0]["secrets"][0]["pushed"]')" "$o0|True" \
   "L19b5b: pushed from a second clone (\$R's origin/master unchanged): leg.py's ls-remote reads it true"
has "$(q 'd["ask"]')" "origin already holds it: rotate it?" "L19b5b: … the same wording"
git -C "$R" remote set-url origin "$S/gone.git"; leg security --task a1
ok "$(q 'd["tops"][0]["secrets"][0]["pushed"]')|$(q 'd["tops"][0]["secrets"][0]["pushedWhy"]')" "None|git ls-remote origin exited 128" \
   "L19b5c: origin gone: pushed null, pushedWhy git's exit"
has "$(q 'd["ask"]')" "whether origin holds it is unknown (git ls-remote origin exited 128): rotate it, and while origin does not hold it you may rewrite it out" \
   "L19b5c: … the unknown wording"
nonet L19b5b
unset CWD
sscen l19b6; leg begin --cwd "$R"; leg claim --task a1; tcommit "$R" a1 c.txt "a1 work"
echo mine > "$R/scratch.txt"; echo edit >> "$R/b.txt"; cp "$R/scratch.txt" "$TMP/s.before"; cp "$R/b.txt" "$TMP/b.before"
leg security --task a1
ok "$rc|$(tq verdict)|$(q 'sorted(d["tops"][0]["uncommitted"])')" "0|clean|['b.txt', 'scratch.txt']" \
   "L19b6: his untracked file and tracked edit: the scan still runs (a scratch tree), uncommitted lists both"
cmp -s "$R/scratch.txt" "$TMP/s.before" && cmp -s "$R/b.txt" "$TMP/b.before"; ok "$?" 0 "L19b6: … both byte-identical afterwards"
head=$(git -C "$R" rev-parse HEAD); LEGENV=STUB_GIT_EXIT=3 leg security --task a1
ok "$rc|$(tq verdict)|$(tq error)" "0|unscanned|gitleaks exited 3" "L19b7: gitleaks exits 3: unscanned, its ERROR line"
has "$(cat "$T/a1.md")" "- $R at ${head:0:12}: unscanned: gitleaks exited 3" "L19b7: … with its section line"
ok "$(fm a1 leg_scan)" "[\"$R@$head unscanned\"]" "L19b7: … and its record"
t0=$(date +%s); trap '' INT   # leg.py started with SIGINT ignored, as a background job is: the cut still cleans up
LEGENV="THREAD_LEG_SECURITY_BUDGET=3 THREAD_LEG_SECURITY_FLOOR=1 STUB_SLEEP=60 STUB_PIDS=$TMP/pids" leg security --task a1
t1=$(date +%s); trap - INT
ok "$rc|$(tq verdict)|$([ $((t1 - t0)) -lt 30 ] && echo fast)" "0|unscanned|fast" "L19b8: a 3 s budget over a sleeping gitleaks, SIGINT ignored by its caller: back within 30 s, unscanned"
has "$(tq error)" "timed out: the Security check's 3 s budget ran out in $R" "L19b8: … timed out"
spid=$(head -n 1 "$TMP/pids"); kill -0 "$spid" 2>/dev/null; ok "$?" 1 "L19b8: … the stub ($spid) is dead"
ok "$(scratch "$R")" "1|0|0" "L19b8: … and no scratch tree or scanner dir is left"
LEGENV="THREAD_LEG_SECURITY_BUDGET=5 THREAD_LEG_SECURITY_FLOOR=10 STUB_COUNT=$TMP/count" leg security --task a1
ok "$(tq verdict)|$(tq error)|$(cat "$TMP/count" 2>/dev/null || echo 0)" "unscanned|not scanned: the Security check's 5 s budget ran out|0" \
   "L19b9: less than the floor left: not scanned, gitleaks never ran"
git -C "$R" worktree add -q --detach "$TMPDIR/leg-security-999999-x" HEAD; git -C "$R" worktree lock "$TMPDIR/leg-security-999999-x"
leg security --task a1
ok "$(tq verdict)|$(scratch "$R")|$(test -e "$TMPDIR/leg-security-999999-x" && echo y || echo n)" "clean|1|0|0|n" \
   "L19b10: a dead run's locked leg-security-* worktree is swept"
cp "$T/a1.md" "$TMP/a1.snap"; snap
python3 - "$LEG" "$T/$RO.md" "$T" "$V" "$R" > "$TMP/l19b11" 2>&1 <<'PY'
import importlib.util, subprocess, sys
spec = importlib.util.spec_from_file_location("leg", sys.argv[1]); leg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leg)
note, tasks, vault, R = sys.argv[2:6]
real = leg.run_scan
def peer(argv, timeout):
    subprocess.run(["git", "-C", R, "commit", "-q", "--allow-empty", "-m", "peer: during the scan"], check=True)
    return real(argv, timeout)
leg.run_scan = peer
sys.exit(leg.main(["security", "--task", "a1", "--rollout", note, "--tasks-dir", tasks, "--vault", vault,
                   "--now", "2026-10-20T10:00+00:00", "--session", "s1"]))
PY
ok "$?" 1 "L19b11: in process, a peer commit during the scan: exit 1"
has "$(cat "$TMP/l19b11")" "HEAD moved in $R since the scan: run security again; nothing written" "L19b11: … HEAD moved"
cmp -s "$T/a1.md" "$TMP/a1.snap"; ok "$?" 0 "L19b11: … the task note byte-identical"
same "L19b11"
nonet L19b6
unset CWD

# ---- L19c: Chain copies: the Leg rewrites a copy's secret out itself ----
csscen l19c
leg claim --task a1; lb=$(git -C "$C" rev-parse HEAD); leak "$C" a1; sec=$(git -C "$C" rev-parse HEAD)
leg security --task a1
ok "$rc|$(tq primary)|$(tq verdict)|$(tq rewrite)|$(q 'd["ask"]')" "0|False|secret|$lb|None" \
   "L19c1: a secret in a1's copy commit: a copy's secret, rewrite from its parent, no ask"
has "$(cat "$T/a1.md")" "- $C at ${sec:0:12}: secret: github-pat in cfg.py, commit ${sec:0:7}, line 1; rewrite from ${lb:0:12}" \
   "L19c1: … its section line"
cp "$T/a1.md" "$TMP/a1.snap"; snap; leg set-aside --task a1 --revert --reason x
ok "$rc|$(git -C "$C" rev-parse HEAD)" "1|$sec" "L19c2: set-aside --revert over a copy's secret is refused, HEAD unchanged"
has "$err" "a secret is in chain/$RO in $C: rewrite it out first" "L19c2: … rewrite it out first"
cmp -s "$T/a1.md" "$TMP/a1.snap"; ok "$?" 0 "L19c2: … the task note byte-identical"
same "L19c2"
paths=$(git -C "$C" diff --name-only "$lb" HEAD); git -C "$C" reset -q --soft "$lb"
printf 'TOKEN = None\n' > "$C/cfg.py"; git -C "$C" add -- $paths; git -C "$C" commit -qm "✨ feat: a1 config" -m "Task: [[a1]]"
leg security --task a1; ok "$rc|$(tq verdict)|$(grep -c '^## Security check' "$T/a1.md")" "0|clean|0" "L19c3: the documented rewrite: clean, the section gone"
d=$(review "$C" HEAD); leg done --task a1 --verify pass --review "$d" --cwd "$C/sub/l"; ok "$rc" 0 "L19c3: … done"
leg land; ok "$(q 'd["lands"][0]["state"]')" landed "L19c3: … land"
hasnt "$(git -C "$R" log -p master)" "$SECRET" "L19c3: … and master's history holds no secret"
leg claim --task a2; lb=$(basesha a2); leak "$C" a2; tcommit "$C" a2 x.txt "a2 more"; d=$(review "$C" HEAD)
leg security --task a2; ok "$(tq verdict)|$(tq rewrite)" "secret|$lb" "L19c3b: a secret below the review's head: rewrite from leg_base"
git -C "$C" reset -q --soft "$lb"; printf 'TOKEN = None\n' > "$C/cfg.py"; git -C "$C" add -- cfg.py x.txt
git -C "$C" commit -qm "✨ feat: a2" -m "Task: [[a2]]"; leg security --task a2; ok "$(tq verdict)" clean "L19c3b: … rewritten: clean"
leg done --task a2 --verify pass --review "$d" --cwd "$C/sub/l"
ok "$rc" 1 "L19c3b: … done refuses the review's fit"; has "$err" "is not an ancestor of HEAD" "L19c3b: … its head is gone"
leg set-aside --task a2 --revert --reason "review no longer fits"; ok "$rc" 0 "L19c3b: … set-aside --revert (no second round)"
leg claim --task a3; tcommit "$C" a3 .gitleaksignore "x" "✨ feat: a3 ignore"; leak "$C" a3
leg security --task a3; rw=$(tq rewrite); ok "$(tq verdict)" secret "L19c4: a committed .gitleaksignore and a secret: secret"
git -C "$C" reset -q --soft "$rw"; printf 'TOKEN = None  # a3\n' > "$C/cfg.py"; git -C "$C" add -- cfg.py
git -C "$C" commit -qm "✨ feat: a3 config" -m "Task: [[a3]]"
leg security --task a3; ask=$(q 'd["ask"]')
ok "$(tq verdict)" red "L19c4: … rewritten out: red on the config change"
case "$ask" in "This change creates or edits .gitleaksignore, the secret scanner's own config: keep it (answer security-accept config:"[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]"), or drop the change?") m=y;; *) m=n;; esac
ok "$m" y "L19c4: … asking with its security-accept config:<12 hex> ($ask)"
leg set-aside --task a3 --revert --scan-ask; ok "$rc" 0 "L19c4: set-aside --revert --scan-ask"
ok "$(summary a3)" "Set aside by Leg 1 of [[$RO]]: security check: $ask" "L19c4: … setAside.summary is the ask, byte for byte"
nosecret L19c; nonet L19c
unset CWD
csscen l19c5; leg claim --task a1; leg done --task a1 --verify pass --cwd "$C/sub/l"; leg land
leg claim --task a2; pb=$(basesha a2 leg_primary_base); leak "$R" a2
leg security --task a2
ok "$rc|$(q 'len(d["tops"])')|$(tq top)|$(tq primary)|$(tq base)|$(tq verdict)|$(q 'd["tops"][0]["secrets"][0]["pushed"]')" \
   "0|1|$R|True|$pb|secret|False" "L19c5: a stray Task: [[a2]] secret in \$R: a primary entry from leg_primary_base, pushed settled false"
leg done --task a2 --verify pass --cwd "$C/sub/l"; ok "$rc" 1 "L19c5: … done refuses the stray"
leg set-aside --task a2 --revert --scan-ask
ok "$rc|$(q 'd["reverted"][0]["top"]')|$(test -e "$R/cfg.py" && echo y || echo n)" "0|$R|n" "L19c5: … --revert --scan-ask reverts it in \$R"
leg close --outcome halt --reason "security check: [[a2]] holds a secret" --cwd "$C/sub/l"; ok "$rc" 0 "L19c5: … and the Leg halts"
ok "$(scratch "$R")" "2|0|0" "L19c5: no scratch tree is left (the copy's worktree only)"
nonet L19c5
unset CWD
csscen l19c6; leg claim --task a1; tcommit "$C" a1 c.txt "a1 work"; m0=$(git -C "$R" rev-parse master)
LEGENV=STUB_GIT_EXIT=3 leg security --task a1; ok "$(tq verdict)" unscanned "L19c6: gitleaks exits 3 in a copy: unscanned"
leg close --outcome halt --reason "security check: [[a1]] could not be scanned" --cwd "$C/sub/l"; leg land
ok "$(q 'd["lands"][0]["state"]')|$(q 'd["lands"][0]["why"]')|$(git -C "$R" rev-parse master)" "stood|a row is in progress: a land never merges mid-task|$m0" \
   "L19c6: … the halt keeps the claim, so the land stands and master is unchanged"
nonet L19c6
unset CWD
csscen l19c7; leg claim --task a1; lb=$(git -C "$C" rev-parse HEAD); leak "$C" a1
pcommit "$C" THREAD.md closed "📝 docs(thread): close-out"; co=$(git -C "$C" rev-parse HEAD)
leg security --task a1
ok "$(tq verdict)|$(tq rewrite)|$(tq rewriteWhy)" "secret|None|${co:0:12} above it is not this task's (no Task: [[a1]] line)" \
   "L19c7: an untrailered commit above a copy's secret: no rewrite point, naming it"
has "$(cat "$T/a1.md")" "; no rewrite point: ${co:0:12} above it is not this task's (no Task: [[a1]] line)" "L19c7: … in its section line"
leg close --outcome halt --reason "security check: [[a1]] holds a secret the Leg cannot rewrite" --cwd "$C/sub/l"
ok "$rc|$(fm a1 status)|$(fm a1 owner)" "0|in_progress|leg-1" "L19c7: … the Leg halts with the claim kept"
leg land; ok "$(q 'd["lands"][0]["state"]')" stood "L19c7: … and the land stands"
git -C "$C" reset -q --soft "$lb"; printf 'TOKEN = None\n' > "$C/cfg.py"; git -C "$C" add -- cfg.py THREAD.md
git -C "$C" commit -qm "✨ feat: a1 config, rewritten" -m "Task: [[a1]]"
SESS=s2 leg clear-halt --reason "a1's secret rewritten out of its commits"
SESS=s2 leg begin --cwd "$C/sub/l"; ok "$rc|$(q 'd["inherited"]')" "0|['a1']" "L19c7: his remedy, then clear-halt: the next Leg inherits a1"
SESS=s2 leg claim --task a1 --inherit; ok "$rc|$(fm a1 leg_base)" "0|[\"$C@$lb\"]" "L19c7: … its leg_base unchanged"
SESS=s2 leg security --task a1; ok "$(tq verdict)" clean "L19c7: … the same window scans clean"
d=$(review "$C" HEAD); SESS=s2 leg done --task a1 --verify pass --review "$d" --cwd "$C/sub/l"; ok "$rc" 0 "L19c7: … done"
SESS=s2 leg land; ok "$(q 'd["lands"][0]["state"]')" landed "L19c7: … land"
hasnt "$(git -C "$R" log -p master)" "$SECRET" "L19c7: … and master's history holds no secret"
nonet L19c7
unset CWD
csscen l19c7b; leg claim --task a1; lb=$(git -C "$C" rev-parse HEAD); leak "$C" a1
pcommit "$C" THREAD.md closed "📝 docs(thread): close-out"; co=$(git -C "$C" rev-parse HEAD)
leg security --task a1; ok "$(tq verdict)|$(tq rewrite)" "secret|None" "L19c7b: the drop variant: no rewrite point"
leg close --outcome halt --reason "security check: [[a1]] holds a secret the Leg cannot rewrite" --cwd "$C/sub/l"
git -C "$C" reset -q --hard "$lb"
SESS=s2 leg clear-halt --reason "a1's commits dropped"; SESS=s2 leg begin --cwd "$C/sub/l"; SESS=s2 leg claim --task a1 --inherit
ok "$rc|$(fm a1 leg_scan)|$(grep -c '^## Security check' "$T/a1.md")" "0|[\"$C@$co secret\"]|1" \
   "L19c7b: his reset --hard to leg_base (repair § 7 (c)), then the inherited claim: the stale record and section are still there"
SESS=s2 leg security --task a1 --dry-run
ok "$rc|$(q 'd["tops"]')|$(fm a1 leg_scan)|$(grep -c '^## Security check' "$T/a1.md")" "0|[]|[\"$C@$co secret\"]|1" \
   "L19c7b: … security --dry-run: tops [], and nothing removed"
SESS=s2 leg security --task a1
ok "$rc|$(q 'd["tops"]')|$(q 'd["clean"]')|$(fm a1 leg_scan)|$(grep -c '^## Security check' "$T/a1.md")" "0|[]|True|<none>|0" \
   "L19c7b: … security: tops [], and the stale leg_scan and ## Security check are removed"
hasnt "$(cat "$T/a1.md")" "no rewrite point" "L19c7b: … no secret line is left in the task note"
SESS=s2 leg done --task a1 --verify pass --cwd "$C/sub/l"; ok "$rc" 0 "L19c7b: … done"
nosecret L19c7b; nonet L19c7b
unset CWD
csscen l19c8; leg claim --task a1; lb=$(git -C "$C" rev-parse HEAD); leak "$C" a1; sec=$(git -C "$C" rev-parse HEAD)
leg security --task a1
ok "$(tq verdict)|$(tq rewrite)|$(q 'd["tops"][0]["secrets"][0]["pushed"]')" "secret|$lb|False" \
   "L19c8: control: an unpushed copy secret has its rewrite point"
git -C "$C" push -q origin "HEAD:refs/heads/chain/$RO"
leg security --task a1
ok "$(git -C "$C" branch -r --contains "$sec" | tr -d ' ')|$(tq verdict)|$(q 'd["tops"][0]["secrets"][0]["pushed"]')|$(tq rewrite)|$(tq rewriteWhy)|$(q 'd["ask"]')" \
   "origin/chain/$RO|secret|True|None|origin already holds ${sec:0:7}|None" \
   "L19c8: a remote-tracking ref holds the copy's secret (a hand push of chain/$RO): rewrite null, origin already holds it"
has "$(cat "$T/a1.md")" "- $C at ${sec:0:12}: secret: github-pat in cfg.py, commit ${sec:0:7}, line 1; no rewrite point: origin already holds ${sec:0:7}" \
   "L19c8: … its section line, for the cannot-rewrite halt"
nosecret L19c8; nonet L19c8
unset CWD

# ---- L19d: done reads the latest scan ----
sscen l19d 5; leg begin --cwd "$R"
leg claim --task a1; tcommit "$R" a1 c.txt "a1 work"; d=$(review "$R" HEAD); : > "$STUB_LOG"; snap; cp "$T/a1.md" "$TMP/a1.snap"
leg done --task a1 --verify pass --review "$d" --cwd "$R"
ok "$rc|$(wc -c < "$STUB_LOG" | tr -d ' ')" "1|0" "L19d1: key on, a reviewed code commit, no scan: done refuses and runs none"
has "$err" "[[a1]]: the Security check (security_checks) has no clean scan covering $R (a Chain copy's must be at its HEAD; latest: none): run \`leg.py security --task a1\`" \
   "L19d1: … naming security"
cmp -s "$T/a1.md" "$TMP/a1.snap"; ok "$?" 0 "L19d1: … the task note byte-identical"
same "L19d1"
leg security --task a1; leg done --task a1 --verify pass --review "$d" --cwd "$R"; ok "$rc" 0 "L19d2: after a clean scan, done"
leg claim --task a2; tcommit "$R" a2 c2.txt "a2 work"; d=$(review "$R" HEAD); leg security --task a2
pcommit "$R" docs/reviews/r.md doc "📝 docs(review): fresh-review findings"
leg done --task a2 --verify pass --review "$d" --cwd "$R"; ok "$rc" 1 "L19d3: in place, the review doc's commit above the scan: done refuses"
has "$err" "latest: clean at " "L19d3: … naming the latest scan"
leg security --task a2; leg done --task a2 --verify pass --review "$d" --cwd "$R"; ok "$rc" 0 "L19d3: … scanned again: done"
leg claim --task a3; tcommit "$R" a3 c3.txt "a3 work"; d=$(review "$R" HEAD); leg security --task a3
pcommit "$R" a.txt "his edit" "peer: his a.txt"
leg done --task a3 --verify pass --review "$d" --cwd "$R"; ok "$rc" 0 "L19d4: in place, his untrailered commit above the scan keeps it covering"
leg claim --task a4; echo v > "$V/v.md"; git -C "$V" add -A; git -C "$V" commit -qm "vault edit" -m "Task: [[a4]]"
leg done --task a4 --verify pass --cwd "$R"; ok "$rc" 0 "L19d6: a vault-only task needs no scan with the key on"
subst "$T/$RO.md" "security_checks: true" "security_checks: false"; : > "$STUB_LOG"
leg claim --task a5; tcommit "$R" a5 c5.txt "a5 work"; d=$(review "$R" HEAD)
leg done --task a5 --verify pass --review "$d" --cwd "$R"
ok "$rc|$(wc -c < "$STUB_LOG" | tr -d ' ')" "0|0" "L19d5: the key off: done as today, no scan"
nonet L19d
unset CWD
sscen l19d7; leg begin --cwd "$R"
leg claim --task a1; tcommit "$R" a1 c.txt "a1 work"; d=$(review "$R" HEAD)
leg security --task a1; ok "$(tq verdict)" clean "L19d7: a clean scan covers a1's commit, the key true"
subst "$T/$RO.md" "security_checks: true" "security_checks: yes"; cp "$T/a1.md" "$TMP/a1.snap"; snap
leg done --task a1 --verify pass --review "$d" --cwd "$R"
ok "$rc" 1 "L19d7: the key turned yes: done refuses, its clean covering scan notwithstanding"
has "$err" "security_checks: must be true or false, got 'yes': fix the note" "L19d7: … with security's line"
cmp -s "$T/a1.md" "$TMP/a1.snap"; ok "$?" 0 "L19d7: … the task note byte-identical"
same "L19d7"
leg security --task a1; ok "$rc" 1 "L19d7: … and security refuses the value"
has "$err" "security_checks: must be true or false, got 'yes': fix the note" "L19d7: … with the same line"
leg set-aside --task a1 --revert --reason x; ok "$rc|$(git -C "$R" log -1 --format=%s)" "1|✨ feat: a1 c.txt" "L19d7: … and set-aside --revert refuses it, nothing reverted"
has "$err" "security_checks: must be true or false, got 'yes': fix the note" "L19d7: … with the same line"
unset CWD
csscen l19d8
leg claim --task a1; tcommit "$C" a1 x.txt "a1 work"; d=$(review "$C" HEAD); leg security --task a1
pcommit "$C" loose2.txt l "an untrailered commit in the copy"
leg done --task a1 --verify pass --review "$d" --cwd "$C/sub/l"
ok "$rc" 1 "L19d8: a copy: a commit after the clean scan, done refuses"; has "$err" "a Chain copy's must be at its HEAD; latest: clean at" "L19d8: … at its HEAD"
leg security --task a1; ok "$(tq verdict)" clean "L19d8: … scanned again at HEAD"
leg done --task a1 --verify pass --review "$d" --cwd "$C/sub/l"; ok "$rc" 0 "L19d8: … done"; leg land
leg claim --task a2; tcommit "$C" a2 x2.txt "a2 work"; d=$(review "$C" HEAD); leg security --task a2
tcommit "$C" a3 y.txt y
leg done --task a2 --verify pass --review "$d" --cwd "$C/sub/l"; ok "$rc" 1 "L19d9: a copy: another task's commit after the scan, done refuses"
leg security --task a2; leg done --task a2 --verify pass --review "$d" --cwd "$C/sub/l"; ok "$rc" 0 "L19d9: … scanned again: done"; leg land
leg claim --task a3; pcommit "$C" z.txt z "an untrailered commit"
leg done --task a3 --verify pass --cwd "$C/sub/l"
ok "$rc" 1 "L19d10: a copy task with only an untrailered commit: done refuses"; has "$err" "run \`leg.py security --task a3\`" "L19d10: … naming security"
leg security --task a3; ok "$(tq verdict)" clean "L19d10: … its window scans clean"
leg done --task a3 --verify pass --cwd "$C/sub/l"; ok "$rc" 0 "L19d10: … done"
nonet L19d8
unset CWD

# ---- L19e: set-aside ----
sscen l19e 4; leg begin --cwd "$R"
leg set-aside --task a3 --reason "preflight: mcp did not answer"; ok "$rc" 0 "L19e4: a queued row's plain set-aside, key on"
subst "$T/$RO.md" "security_checks: true" "security_checks: yes"
leg set-aside --task a4 --reason "preflight: mcp did not answer"; ok "$rc" 0 "L19e4: … and with yes"
subst "$T/$RO.md" "security_checks: yes" "security_checks: true"
leg claim --task a1; tcommit "$R" a1 c.txt "a1 work"
subst "$T/$RO.md" "security_checks: true" "security_checks: yes"; cp "$T/a1.md" "$TMP/a1.snap"; snap
leg set-aside --task a1 --reason x
ok "$rc|$(fm a1 status)|$(fm a1 owner)" "1|in_progress|leg-1" "L19e4: the own claim with yes: refused"
has "$err" "security_checks: must be true or false, got 'yes': fix the note" "L19e4: … with security's line"
cmp -s "$T/a1.md" "$TMP/a1.snap"; ok "$?" 0 "L19e4: … the task note byte-identical"
same "L19e4: the own claim with yes"
subst "$T/$RO.md" "security_checks: yes" "security_checks: true"
snap; leg set-aside --task a1 --reason x
ok "$rc" 1 "L19e1: the own claim with commits, plain: refused"; has "$err" "set it aside with --revert, after \`leg.py security --task a1\`" "L19e1: … naming --revert"
same "L19e1"
leg set-aside --task a1 --revert --reason x; ok "$rc" 1 "L19e2: --revert with no scan: refused"
has "$err" "run \`leg.py security --task a1\` first: $R has no scan covering its commits" "L19e2: … run security first"
LEGENV=STUB_GIT_EXIT=3 leg security --task a1; leg set-aside --task a1 --revert --reason x
ok "$rc" 1 "L19e3: --revert over an unscanned record: refused"; has "$err" "could not be scanned: close the Leg --outcome halt instead" "L19e3: … halt instead"
leg security --task a1
leg set-aside --task a1 --revert --scan-ask; ok "$rc" 1 "L19e6: --scan-ask after a clean scan: refused"
has "$err" "--scan-ask quotes the latest Security check question, and none covers HEAD: give --reason" "L19e6: … give --reason"
leg set-aside --task a1 --scan-ask; ok "$rc|$out" "2|" "L19e6: --scan-ask without --revert is usage"
leg set-aside --task a1 --revert --scan-ask --reason x; ok "$rc|$out" "2|" "L19e6: … with --reason too"
leg set-aside --task a1 --revert; ok "$rc|$out" "2|" "L19e6: … and neither"
leak "$R" a1; leg security --task a1; ask=$(q 'd["ask"]')
leg set-aside --task a1 --revert --scan-ask; ok "$rc" 0 "L19e7: an in-place secret: --revert --scan-ask"
has "$(git -C "$R" log -1 --format=%B)" "Set-aside: security check: A secret (github-pat)" "L19e7: … the revert's Set-aside: line"
ok "$(summary a1)" "Set aside by Leg 1 of [[$RO]]: security check: $ask" "L19e7: … setAside.summary byte-equal"
leg close --outcome halt --reason "security check: [[a1]] holds a secret" --cwd "$R"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=0/4 running=0 state=halted reason=\"halt: security check: [[a1]] holds a secret\"" "L19e7: … the halt"
SESS=s2 leg begin --cwd "$R"; ok "$rc" 3 "L19e7: … and begin stands on it"
nosecret L19e; nonet L19e
unset CWD
sscen l19e5; leg begin --cwd "$R"; leg claim --task a1; tcommit "$R" a1 c.txt "a1 work"; leg security --task a1
leg set-aside --task a1 --revert --reason "the review did not converge"; ok "$rc" 0 "L19e5: set aside --revert after a clean scan"
python3 "$RR" hand-back --tasks a1 --tasks-dir "$T" > "$TMP/hb" 2>&1; ok "$(fm a1 status)|$(fm a1 owner)" "in_progress|<none>" "L19e5: … handed back"
h0=$(git -C "$R" rev-parse HEAD); leg set-aside --task a1 --reason "plain, while handed back"
ok "$rc|$(git -C "$R" rev-parse HEAD)" "0|$h0" "L19e5: a handed-back row (no owner, its old window): a plain set-aside, no revert"
unset CWD
csscen l19e8; leg claim --task a1; tcommit "$C" a1 x.txt "a1 work"; leg security --task a1
pcommit "$C" loose3.txt l "an untrailered commit in the copy"; leg set-aside --task a1 --revert --reason x
ok "$rc" 1 "L19e8: a copy: a commit after the clean scan: --revert refused"
has "$err" "run \`leg.py security --task a1\` first" "L19e8: … run security first"
unset CWD

# ---- L19f: the re-entry through repair's documented forms (in place, a config touch) ----
# reentry <name> <answer, @KEY@ for the config token>: a1's config touch is set aside --revert --scan-ask; repair § 7
# (b)'s record-answer, its --ask the summary and its --answer his words inside the documented double quotes, runs from
# /bin/bash; hand-back; the fresh claim; the documented restore (git revert --no-commit, commit by path); security.
reentry() {
  sscen "$1"; leg begin --cwd "$R"; leg claim --task a1; tcommit "$R" a1 .gitleaksignore "x" "✨ feat: a1 ignore"
  leg security --task a1; ok "$(tq verdict)" red "$1: a config touch reads red"
  leg set-aside --task a1 --revert --scan-ask; ok "$rc" 0 "$1: --revert --scan-ask"
  rv=$(q 'd["reverted"][0]["sha"]'); leg status
  sum=$(q '[r for r in d["rows"] if r["slug"] == "a1"][0]["setAside"]["summary"]')
  fp=$(q '[r for r in d["rows"] if r["slug"] == "a1"][0]["setAside"]["fingerprint"]')
  key=$(printf '%s' "$sum" | grep -o 'config:[0-9a-f]\{12\}' | head -n 1); ans=${2//@KEY@/$key}
  { printf '#!/bin/bash\n'
    printf 'python3 %s record-answer --tasks a1 --rollout %s --kind decision --ask "%s" --answer "%s" --fingerprint %s --form hand-back --tasks-dir %s --now 2026-10-20T10:05+00:00\n' \
      "$RR" "$T/$RO.md" "$sum" "$ans" "$fp" "$T"
  } > "$S/answer.sh"
  /bin/bash "$S/answer.sh" > "$S/answer.out" 2> "$S/answer.err"; arc=$?
  python3 "$RR" hand-back --tasks a1 --tasks-dir "$T" --answer 2026-10-20T10:05+00:00 --now 2026-10-20T10:06+00:00 > "$S/hb.out" 2>&1
  LNOW=2026-10-20T10:07+00:00 leg claim --task a1
  ok "$rc|$(fm a1 leg_scan)|$(grep -c '^## Security check' "$T/a1.md")|$(fm a1 leg_base)" "0|<none>|0|[\"$R@$(git -C "$R" rev-parse HEAD)\"]" \
     "$1: the fresh claim drops leg_scan and the section, and restamps leg_base after the revert"
  git -C "$R" revert --no-commit "$rv"; git -C "$R" commit -qm "✨ feat: a1 ignore, restored" -m "Task: [[a1]]" -- .gitleaksignore
  LNOW=2026-10-20T10:08+00:00 leg security --task a1
}
reentry l19f 'keep it (security-accept @KEY@)'
ok "$arc|$(printf '%s' "$key" | grep -c '^config:[0-9a-f]\{12\}$')" "0|1" "L19f: the ask names its config token, and repair's record-answer ran from /bin/bash"
has "$(cat "$T/a1.md")" "→ keep it (security-accept $key)" "L19f: … recording his answer with the token"
ok "$(tq verdict)|$(q 'd["tops"][0]["scan"]["accepted"][0]["token"]')" "clean|$key" "L19f: the re-entry's scan reads clean: accepted $key"
has "$(q 'd["tops"][0]["scan"]["brief"]')" "accepted $key" "L19f: … its brief says so"
d=$(review "$R" HEAD); LNOW=2026-10-20T10:09+00:00 leg done --task a1 --verify pass --review "$d" --cwd "$R"; ok "$rc" 0 "L19f: … done"
unset CWD
reentry l19f2 'keep it (answer `security-accept @KEY@`)'
has "$(cat "$S/answer.err")" "command not found" "L19f: control: the backticked form runs the token as a command"
hasnt "$(cat "$T/a1.md")" "→ keep it (answer security-accept" "L19f: control: … and loses it from the answer"
ok "$(tq verdict)" red "L19f: control: … so the re-entry stays red"
unset CWD
reentry l19f3 'keep it'
ok "$(tq verdict)" red "L19f: control: an answer with no token stays red"
nonet L19f
unset CWD

# ---- L19g: a scan the Leg cannot run halts with the claim kept (in place) ----
sscen l19g; leg begin --cwd "$R"; leg claim --task a1; lb=$(fm a1 leg_base); tcommit "$R" a1 c.txt "a1 work"
LEGENV=STUB_GIT_EXIT=3 leg security --task a1; ok "$(tq verdict)" unscanned "L19g: unscanned"
leg close --outcome halt --reason "security check: [[a1]] could not be scanned" --cwd "$R"
ok "$rc|$(fm a1 status)|$(fm a1 owner)|$(fm a2 status)" "0|in_progress|leg-1|open" "L19g: … close --outcome halt keeps a1, a2 stays open"
SESS=s2 leg clear-halt --reason "gitleaks fixed"; SESS=s2 leg begin --cwd "$R"
ok "$rc|$(q 'd["inherited"]')" "0|['a1']" "L19g: … the next Leg inherits a1"
SESS=s2 leg claim --task a1 --inherit; ok "$(fm a1 leg_base)" "$lb" "L19g: … leg_base unchanged"
SESS=s2 leg security --task a1; ok "$(tq verdict)" clean "L19g: … the fixed stub scans the same window clean"
d=$(review "$R" HEAD); SESS=s2 leg done --task a1 --verify pass --review "$d" --cwd "$R"; ok "$rc" 0 "L19g: … done"
ok "$(grep -E 'claimed \[\[a2\]\]|done \[\[a1\]\]' "$T/$RO.md" | head -n 1 | grep -c 'done \[\[a1\]\]')" 1 "L19g: no claimed [[a2]] before done [[a1]]"
nonet L19g
unset CWD

# ---- L19h: in process: shell_safe, security_ask, run_scan's cut, settle_pushed ----
python3 - "$LEG" > "$TMP/l19h.out" 2>&1 <<'PY'
import importlib.util, sys, time, types
spec = importlib.util.spec_from_file_location("leg", sys.argv[1]); leg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leg)
bad = []
def eq(got, want, label):
    if got != want:
        bad.append(f"{label}: expected {want!r} got {got!r}")
ss = leg.shell_safe
for raw, want in [("a `b` c", "a b c"), ('say "hi"', "say 'hi'"), ("$HOME", "?HOME"), ("a\\b", "a/b"),
                  ("one\n  two", "one two"), ("tab\there", "tab\there"), ("x  \r\n y", "x y"),
                  ("keep (answer `security-accept config:0123456789ab`)", "keep (answer security-accept config:0123456789ab)"),
                  (None, None)]:
    eq(ss(raw), want, f"shell_safe {raw!r}")
    eq(ss(ss(raw)), ss(raw), f"shell_safe idempotent {raw!r}")
P = "/p/r"
def ent(primary, secrets=(), config=(), advs=(), top=P):
    return {"top": top, "primary": primary, "secrets": list(secrets),
            "scan": {"configTouched": list(config), "advisories": list(advs)}}
def sec(pushed, why=None):
    return {"rule": "github-pat", "file": "cfg.py", "line": 3, "commit": "abcdef1234567", "pushed": pushed, "pushedWhy": why}
head = "A secret (github-pat) in cfg.py, commit abcdef1, line 3, is in /p/r's history, which a Leg never rewrites"
rw = "rotate it, and while origin does not hold it you may rewrite it out of that history yourself before the halt is cleared"
eq(leg.security_ask([ent(True, [sec(True)])]), head + ", and origin already holds it: rotate it?", "ask pushed true")
eq(leg.security_ask([ent(True, [sec(False)])]), head + ": " + rw + "?", "ask pushed false")
eq(leg.security_ask([ent(True, [sec(None, "git ls-remote origin exited 128")])]),
   head + ", and whether origin holds it is unknown (git ls-remote origin exited 128): " + rw + "?", "ask pushed null")
eq(leg.security_ask([ent(False, [sec(False)])]), None, "a copy's secret is never asked")
cfg = {"path": ".gitleaksignore", "cause": "uncommitted", "accept": "config:0123456789ab"}
eq(leg.security_ask([ent(False, config=[cfg])]),
   "This change leaves an uncommitted .gitleaksignore, the secret scanner's own config: keep it (answer "
   "security-accept config:0123456789ab), or drop the change?", "ask config")
nofix = {"ecosystem": "PyPI", "name": "req", "version": "1.0", "id": "GHSA-x", "fixed": [], "accept": "advisory:0123456789ab"}
fix = dict(nofix, fixed=["1.2", "2.0"], accept="advisory:ba9876543210")
eq(leg.security_ask([ent(False, advs=[nofix])]),
   "PyPI req 1.0 has advisory GHSA-x with no fixed release: keep it (answer security-accept advisory:0123456789ab), "
   "name another package, or drop the need?", "ask advisory, no fixed release")
eq(leg.security_ask([ent(False, advs=[fix])]),
   "PyPI req 1.0 has advisory GHSA-x, fixed in 1.2, 2.0, that the Leg did not move past: keep it (answer "
   "security-accept advisory:ba9876543210), or move it to a fixed release?", "ask advisory, fixed")
eq(leg.security_ask([ent(False, [sec(False)], config=[cfg], top="/c"), ent(True, [sec(True)])]),
   "The Security check found 2 things only you can settle: (1) in /c: This change leaves an uncommitted "
   ".gitleaksignore, the secret scanner's own config: keep it (answer security-accept config:0123456789ab), or drop "
   "the change; (2) in /p/r: " + head + ", and origin already holds it: rotate it?", "ask, two items over two entries")
eq(leg.security_ask([ent(True), ent(False)]), None, "no item: no ask")
t0 = time.monotonic()
rc, out, err, cut = leg.run_scan([sys.executable, "-c", "import time; time.sleep(60)"], 1)
eq((cut, time.monotonic() - t0 < 1 + leg.SCAN_GRACE + 2), (True, True), "run_scan cuts a sleeping child within timeout + grace")
def fake(table):   # leg.git answered from a table, each call's verb recorded
    calls = []
    def git(top, *args, input=None, timeout=120):
        calls.append(args[0])
        rc, out = table.get(args[0], (0, ""))
        return types.SimpleNamespace(returncode=rc, stdout=out, stderr="")
    return git, calls
LIVE = "f" * 40
def settle(table, pushed=None, left=100):
    leg.git, calls = fake(table)
    s = [{"commit": "a" * 40, "pushed": pushed, "pushedWhy": None}]
    leg.settle_pushed("/p/r", s, time.monotonic() + left, 420)
    return (s[0]["pushed"], s[0]["pushedWhy"]), calls
base = {"symbolic-ref": (0, "master\n"), "ls-remote": (0, f"{LIVE}\trefs/heads/master\n"), "cat-file": (0, ""),
        "merge-base": (0, "")}
eq(settle(dict(base, **{"symbolic-ref": (1, "")}))[0], (None, "/p/r's HEAD is detached"), "settle: detached")
eq(settle(dict(base, **{"ls-remote": (2, "")}))[0], (False, None), "settle: ls-remote rc 2")
eq(settle(base)[0], (True, None), "settle: held, an ancestor")
eq(settle(dict(base, **{"merge-base": (1, "")}))[0], (False, None), "settle: held, not an ancestor")
eq(settle(dict(base, **{"cat-file": (1, "")}))[0],
   (None, "origin's head fffffff is not held here: fetch it, then run security again"), "settle: not held")
eq(settle(dict(base, **{"ls-remote": (128, "")}))[0], (None, "git ls-remote origin exited 128"), "settle: rc 128")
got, calls = settle(base, left=0.5)
eq((got, "ls-remote" in calls), ((None, "not read: the Security check's 420 s budget ran out"), False),
   "settle: under 1 s left, no ls-remote")
got, calls = settle(base, pushed=True)
eq((got[0], calls), (True, []), "settle: a scanner true is kept, with no call")
# The budget: a call held to the deadline never starts with under 1 s left (within), so none runs past it.
eq(leg.within(time.monotonic() + 0.5), None, "within: under 1 s left, no call")
eq(leg.within(time.monotonic() + 100, 5), 5, "within: its cap")
eq(leg.within(time.monotonic() + 3, 30) <= 3, True, "within: at most the rest of the deadline")
past, OUT = time.monotonic() - 1, "the Security check's 420 s budget ran out"
leg.git, calls = fake({})
eq((leg.uncommitted_paths("/p/r", past), calls), ([], []), "uncommitted_paths past the deadline: [], no git call")
leg.git, calls = fake({})
leg.sweep_scratch("/p/r", past)
with leg.scratch_tree("/p/r", past, 420) as got:
    eq(got, (None, "not scanned: " + OUT), "scratch_tree past the deadline: not scanned")
eq(calls, [], "sweep_scratch and scratch_tree past the deadline: no list, add or teardown")
leg.git, calls = fake({"worktree": (0, "worktree /p/r\n\nworktree /tmp/leg-security-999999-x\n")})
leg.sweep_scratch("/p/r", time.monotonic() + leg.TEARDOWN - 5)
eq(calls, ["worktree"], "sweep_scratch: a dead tree's teardown waits while under TEARDOWN s are left")
ent = {"top": "/p/r", "base": "c" * 40}
leg.git, calls = fake({})
leg._scan_into(ent, types.SimpleNamespace(path="/n.md"), "/p/r", past, 420)
eq((ent.get("error"), calls), ("not scanned: " + OUT, []), "_scan_into past the deadline: not scanned, no scan")
copy = {"secrets": [{"commit": "a" * 40, "pushed": False}], "rewriteFrom": "b" * 40, "mergeBehind": False}
leg.git, calls = fake({})
eq((leg.rewrite_point("/c", "c" * 40, "a1", copy, past, 420), calls), ((None, "not read: " + OUT), []),
   "rewrite_point past the deadline: not read, no git call")
held = dict(copy, secrets=[{"commit": "a" * 40, "pushed": False}, {"commit": "d" * 40, "pushed": True}], mergeBehind=True)
leg.git, calls = fake({})
eq((leg.rewrite_point("/c", "c" * 40, "a1", held, time.monotonic() + 100, 420), calls),
   ((None, "origin already holds ddddddd"), []), "rewrite_point: a secret origin holds comes first, with no git call")
log = f"\x1e{'e' * 40}\x1ffix\n\nTask: [[a1]]\n\x1f\n\ncfg.py\n\x1e{'f' * 40}\x1fdocs\n\x1f\n\ndocs/reviews/r.md\n"
leg.git, calls = fake({"merge-base": (0, ""), "log": (0, log)})
eq((leg.rewrite_point("/c", "c" * 40, "a1", copy, time.monotonic() + 100, 420), calls), (("b" * 40, None), ["merge-base", "log"]),
   "rewrite_point: one log for the window, a review-doc commit above it kept")
leg.git, calls = fake({"merge-base": (0, ""), "log": (0, log + f"\x1e{'9' * 40}\x1fpeer\n\x1f\n\na.txt\n")})
eq(leg.rewrite_point("/c", "c" * 40, "a1", copy, time.monotonic() + 100, 420),
   (None, "999999999999 above it is not this task's (no Task: [[a1]] line)"), "rewrite_point: a peer commit above it")
leg.git, calls = fake({"merge-base": (1, "")})
eq(leg.rewrite_point("/c", "c" * 40, "a1", copy, time.monotonic() + 100, 420),
   (None, "bbbbbbbbbbbb is below the task's leg_base"), "rewrite_point: below leg_base")
print("\n".join(bad) if bad else "all")
PY
ok "$(cat "$TMP/l19h.out")" all "L19h: in process: shell_safe, security_ask, run_scan's cut and settle_pushed"

# ════ L20: begin's mcp, through serial-chains.py's required_mcp (ADR 0074 d2) ══════════════════════════════════════
scen l20
mkdir -p "$S/other"
mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2 t3) $(rows cc-other "$S/other" '`ext:y`' t4)
for t in t1 t2 t3 t4; do mkt "$t"; done
printf '\n## Launch\n\n- **MCP:** required `mcp__a__*`; optional `mcp__b__*`\n' >> "$T/t1.md"
printf '\n## Launch\n\n- **MCP:** `mcp__c__*`, `mcp__a__*`\n' >> "$T/t2.md"
printf '\n## Launch\n\n- **MCP:** required none; optional `mcp__x__*`\n' >> "$T/t3.md"
printf '\n## Launch\n\n- **MCP:** required `mcp__z__*`\n' >> "$T/t4.md"
git -C "$V" add -A && git -C "$V" commit -qm vault
leg begin --cwd "$F"
ok "$rc|$(q 'd["mcp"]')" "0|['mcp__a__*', 'mcp__c__*']" \
   "L20: begin's mcp: the optional part dropped, a line with no required word read, required none nothing, another launch's row left out"
echo
if [ "$fail" -eq 0 ]; then echo "leg.test.sh: ALL PASS"; else echo "leg.test.sh: FAILED"; fi
exit "$fail"
