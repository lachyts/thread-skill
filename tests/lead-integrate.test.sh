#!/usr/bin/env bash
# p12-9 (ADR 0030 decision 3), executed: the lead's side of Integration, skills/execute/scripts/lead-integrate.py
# (prepare, verify, push, undo, inputs, set-aside, stamp), with reconcile-rollout.py, merge-task.sh and the
# engine (tests/lib/engine.mjs) where a case crosses into them. Fixtures: a real bare "GitHub" origin under a
# github.com/o/r.git path, the fake gh (tests/lib/merge-task-env.sh, tests/fixtures/merge-task/fake-gh.py), the
# project checkout, the task tree at .claude/worktrees/proj-t5 and a temp vault. Engine-only cases use fake SHAs.
#   C1  main unmoved: merge route, the lead's log line, merge-task 0, mark-done.
#   C2  main moved: the lead merges, verifies (the SKILL.md verify line), pushes, logs and merges — no agent.
#   C3  a shared file   C4  a conflict   C5  red, undo   C6  case (ii) from an engine line   C7  the own run merged
#   main; a stale anchor ref   C8  a missing, detached or unpushed tree (merge while main is unmoved, trouble once
#   it moved), leftovers, a gone branch   C9  push refused   C10 landed   C11 engine pins   C12 inputs parity (and
#   the rung record from inputs)   C13a exit-4 plumbing   C13b a dead integrate call   C13c lead-written own and
#   revise-stopped rows   C14 a rejection frees the lane while another integrates   C15 the verify line under bash
#   and zsh -f ($, $(…), backticks, \ and ' single-quoted)   C16 stamp, usage, an unreachable origin   C17 timeouts, signals,
#   the bootstrap, the race tree   C18 no relaunch loop   C19 an Integration set-aside re-enters   C20 the last
#   task rejected   C21 plan, the approved plan for the seeded revise   C22 inputs --row, the integrate call's record
#   checked against the note and its fallback prUrl a PR URL the engine takes, a bare #N built (p17-1)   C23 a
#   signal while a step starts, and the step's and verify's own signal mask (p22-2). C10 is the landed list with
#   a commit pushed without a PR (`unlisted`), and C11 also pins inputs --row's ports of historyError,
#   rungRecordError and PR_URL. The verify slots (p23-4, verify-slot.py): C24 the slot wait is excluded from the
#   deadline   C25 no slot within --slot-wait → rc `noslot`, exit 75, the verifier never ran, the race tree removed
#   C26 TERM during the wait   C27 a lone --slots or --slot-wait   C28 a SIGKILL of verify: its guard ends the
#   step and frees the slot, no rc   C17s C17's deadline and TERM arms slotted   C23s C23's TRAP and LATE arms
#   slotted (the LATE signal lands while the guard starts). C29 prepare refuses a note with no integrating: (exit 1,
#   nothing fetched, deleted, stashed or merged)   C29b the 2026-10-19 slip: merge-task's exit 3 after an integrate
#   call's integrated row, re-run with no mark-integrating (p26-1).
#   C30–C40 the Inert-path skip (ADR 0045, p29-3): C30 a THREAD.md-only move skips (push, log, merge-task, no verifier)
#   C31 a source file beside it re-runs   C32 a rename into docs/handoffs/ re-runs (case ii)   C33 an empty list, no table,
#   no file or no --verifier re-runs   C34 the task's own diff adds a reader   C35 a step walks the tree   C36 a shared
#   THREAD.md   C37 a refused rollouts.toml   C38 chained skips across merge-task's exit 3   C39 a cwd glob in a test
#   C40 fail closed: a failing cat-file is an inert check error, route verify, exit 0.
#   The Flake check (ADR 0050, p29-9): C41 an out-of-diff red cleared by its named re-run and a confirming run (a
#   Flake, rc 0)   C42 a red named re-run   C43 a red confirming run   C44 a touched test   C45 one touched, one not
#   C46 unnamed, unplaced, too many   C47 timeouts (the first run, the confirming run, no harness time left)   C48 the
#   RACE form   C49 no --named-rerun, no --diff-base, a green run, an unreadable diff   C50 refusals   C51 ids with
#   spaces and quotes, paths outside the tree   C52 the SKILL.md verify line with and without named_rerun, under bash
#   and zsh -f   C53 TERM during the named re-run or the confirming run, unslotted and slotted: rc 143, why `signal`,
#   the child gone, the slot free.   C54 with --rollout (p29-10): a Flake's suite ends green, a deadline in the confirming
#   run ends it timeout.
#   The Run record (p29-10, ADR 0051): S1–S8 verify --rollout's suite lines (green, red, timeout, race, completion,
#   noslot, none without --rollout, a TERM's stopped line after the rc and outcome files, a TERM in suite-started's vault
#   walk never swallowed); M1–M6 base-moved (a rollout's merge from the record or its note, a peer's push, the Inert
#   path test, no task note, main unreadable).
#   prepare's task-scoped failures (ADR 0048, p29-7): C55 a merge in progress its tree cannot abort   C55b tracked changes
#   it cannot stash   C55c an orphan PR branch (no merge-base)   C55d a missing origin/<default> stays exit 2   C55e a held
#   <ref>.lock on a stale anchor ref. C56 the `task note unreadable:` marker on every note-read failure (inputs, plan,
#   set-aside) and on nothing else (C56c usage, an empty reason, a refused --max-review-rounds; C56d git not runnable).
#   The RACE revert (ADR 0046, p29-2; lead-integrate.py revert): R1 route pr (the head on origin/master, M's files
#   M^1's, the bodies say `This reverts commit M`, origin/master untouched, restores by tree)   R2 merge-task 0, then
#   reverted   R3 a re-run before the merge reuses the branch and the PR, and after it reads the landed commit   R4 a
#   peer push: the branch takes origin/master by a fast-forward merge, restores false   R4b a THREAD.md-only peer close-out
#   restores by ADR 0045's Inert check (one verify-skipped line per check, base M^1), freeing the lane   R4c a source file
#   beside it   R4d a refused rollouts.toml   R4e no --verifier   R5 a conflict   R6 the target guard's refusals (a)–(g)
#   and a two-parent M   R6h another PR's RACE line under the slug is skipped   R7 origin unreachable (8)   R8 the tail
#   through reconcile frees the lane   R9 a stale open revert PR, noop   R10 an Engine snapshot mismatch (2)   R11
#   merge-task's exit 3 on the revert PR   R12 the crash tail   R13 merge-task's exit 5 on the revert PR.
# Hermetic: temp repos, PATH shim, ssh disabled, every merge-task interval 0; the verify slots in a temp pool
# (tests/lib/merge-task-env.sh exports THREAD_VERIFY_SLOTS_DIR).
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

tmp=$(cd "$(mktemp -d)" && pwd -P); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
# The note-lock dir, and so `next`'s Trickle claims beside it (p28-3), stays this suite's own: run.sh shares one across
# every suite, and another suite's `next` would prune or count claims this one's calls leave.
export THREAD_NOTE_LOCK_DIR="$tmp/note-locks"
. tests/lib/merge-task-env.sh
export THREAD_VERIFY_SLOT_POLL=0.1
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

LI="$root/skills/execute/scripts/lead-integrate.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
SKILL="$root/skills/execute/SKILL.md"
SLUG=proj-t5; BR=audit-fix/t5; PR=https://github.com/o/r/pull/5
REVISE='revise: rejected at Integration re-review — revise on the branch, then re-integrate'
sha() { printf "%040d" 0 | tr 0 "$1"; }
g() { git -c init.defaultBranch=master "$@"; }

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# ---- fixtures -------------------------------------------------------------------------------------------
# fx <name>: a fresh scenario. Origin (MT_SRV) holds master (base.txt, a.txt) and the task branch $BR (one
# commit: a.txt line 1 and t.txt — H0, the approved head); p is a pusher clone; R the project checkout; WT the
# task tree as the engine's setup leaves it; V the vault: ro.md and $SLUG.md (review, pr: #5, ready:, and the
# integrating: step 3's mark-integrating stamps before every prepare, p26-1).
fx() {
  echo "== $1"
  F="$tmp/$1"; mkdir -p "$F"
  export MT_STATE="$F/st" MT_SRV="$F/srv/github.com/o/r.git"
  mkdir -p "$MT_STATE/pr"; echo false > "$MT_STATE/mq"
  g init -q --bare "$MT_SRV"
  g clone -q "$MT_SRV" "$F/p" 2>/dev/null
  printf 'base\n' > "$F/p/base.txt"; printf 'a1\na2\na3\na4\na5\n' > "$F/p/a.txt"
  g -C "$F/p" add . && g -C "$F/p" commit -q -m base && g -C "$F/p" push -q origin master
  TB=$(git -C "$F/p" rev-parse HEAD); B=$TB
  g -C "$F/p" checkout -q -b "$BR"
  printf 'A1 task\na2\na3\na4\na5\n' > "$F/p/a.txt"; printf 'task\n' > "$F/p/t.txt"
  g -C "$F/p" add . && g -C "$F/p" commit -q -m "task t5" && g -C "$F/p" push -q origin "$BR"
  H0=$(git -C "$F/p" rev-parse HEAD)
  g -C "$F/p" checkout -q master
  g clone -q "$MT_SRV" "$F/repo" 2>/dev/null; R="$F/repo"
  WT="$R/.claude/worktrees/$SLUG"
  g -C "$R" worktree add -q "$WT" -b "$BR" "origin/$BR" >/dev/null 2>&1
  V="$F/vault"; mkdir -p "$V"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\nProject root: `%s`\n\n## Queue\n\n- [[%s]]\n' "$R" "$SLUG" > "$V/ro.md"
  printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: %s\nready: 2026-10-02T11:00+00:00\nintegrating: 2026-10-02T11:30+00:00\nreview_rounds_used: 1\n---\n\n## Notes\n\nt5\n' "$PR" > "$V/$SLUG.md"
}
# main <file> <content> [subject]: a commit on origin's master from p; B is the new tip.
main() {
  g -C "$F/p" checkout -q master; g -C "$F/p" pull -q --ff-only origin master 2>/dev/null
  printf '%s\n' "$2" > "$F/p/$1"; g -C "$F/p" add "$1"; g -C "$F/p" commit -q -m "${3:-main $1}"; g -C "$F/p" push -q origin master
  B=$(git -C "$F/p" rev-parse HEAD)
}
# onbranch <cmd…>: run a git command in p on origin's $BR, then push it (a repair, an integrator, an own-run merge).
onbranch() { g -C "$F/p" fetch -q origin; g -C "$F/p" checkout -q -B "$BR" "origin/$BR"; g -C "$F/p" "$@" >/dev/null; g -C "$F/p" push -q origin "$BR"; g -C "$F/p" checkout -q master; }
prep() { J=$(python3 "$LI" prepare --repo "$R" --slug "$SLUG" --default master --note "$V/$SLUG.md" "$@" 2>"$F/prep.err"); prc=$?; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False))' "$2"; }
loglines() { awk '/^## Integration log/{on=1; next} /^## /{on=0} on && NF' "$V/$SLUG.md"; }
fm() { grep -m1 "^$2:" "$1" || echo "<none>"; }
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
addlog() { printf '\n## Integration log\n\n%s\n' "$2" >> "$1"; }
mkpr() {  # mkpr <n> <head>: GitHub's PR n (audit-fix/t5 into master) with its head at <head>
  local d="$MT_STATE/pr/$1"; rm -rf "$d"; mkdir -p "$d"
  echo OPEN > "$d/state"; echo master > "$d/baseRefName"; echo "$2" > "$d/headRefOid"
  echo "$BR" > "$d/headRefName"; echo CLEAN > "$d/mergeStateStatus"; echo "https://github.com/o/r/pull/$1" > "$d/url"
}
mt() { : > "$MT_STATE/gh.log"; out=$(PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$R" "$@" 2>&1); rc=$?; }
rec() { python3 "$RR" reconcile --result - --tasks-dir "$V" --now "${2:-2026-10-02T12:00:00Z}" <<<"$1" >/dev/null; }
nxt() { python3 "$RR" next --rollout "$V/ro.md" --tasks-dir "$V" --now 2026-10-02T12:30:00Z --running "$1" 2>/dev/null; }
inp() { python3 "$LI" inputs --note "$V/$1.md" "${@:2}"; }
lastrun() { python3 - "$1" <<PY
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rr", "$RR"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.Note(__import__("pathlib").Path(sys.argv[1])).latest_run_text("## Blocker diagnosis"))
PY
}
setaside_at() { python3 "$RR" status --rollout "$V/ro.md" --tasks-dir "$V" | python3 -c 'import json,sys; d=json.load(sys.stdin); print([t["setAsideAt"] for t in d["tasks"] if t["slug"]==sys.argv[1]][0])' "$1"; }
# The SKILL.md verify line (between its markers), filled in as the skill says (each ' in the verifier and the
# bootstrap written as '\''): verify_line <tree> <slug> <verifier> [bootstrap]. VERIFY_FILL=dq fills them the
# old way instead (double quotes, only " escaped): C15's control.
verify_line() {
  ROLLOUT_NOTE="$V/ro.md" python3 - "$SKILL" "$R" "$@" <<'PY'
import os, re, sys
skill, repo, tree, slug, verifier = sys.argv[1:6]
boot = sys.argv[6] if len(sys.argv) > 6 else ""
text = open(skill).read()
m = re.search(r"^# thread:integration-verify[^\n]*\n(.*?)^# end thread:integration-verify", text, re.S | re.M)
if not m:
    print("NO-VERIFY-BLOCK"); sys.exit(0)
line = m.group(1).strip()
if os.environ.get("VERIFY_FILL") == "dq":
    line = line.replace("'<env_bootstrap>'", '"<env_bootstrap>"').replace("'<verifier>'", '"<verifier>"')
    esc = lambda s: s.replace('"', '\\"')
else:
    esc = lambda s: s.replace("'", "'\\''")
if not boot:
    line = re.sub(r""" --bootstrap (['"])<env_bootstrap>\1""", "", line)
# p29-9: <mainSha> is prepare's (MAIN_SHA, default HEAD) and <named_rerun> verify-timeout's namedRerun (NAMED_RERUN);
# with none, the line drops --named-rerun as the skill says.
named = os.environ.get("NAMED_RERUN", "")
if not named:
    line = line.replace(" --named-rerun '<named_rerun>'", "")
line = line.replace("<mainSha>", os.environ.get("MAIN_SHA", "HEAD")).replace("<named_rerun>", esc(named))
# <verify_timeout>, <verify_slots> and <slot_wait> are § 3's per-entry values (p14-2, p23-4); left literal, the shell
# would read them as redirections.
line = (line.replace("<tree>", tree).replace("<repoPath>", repo).replace("<slug>", slug)
        .replace("<rollout-note>", os.environ.get("ROLLOUT_NOTE", "<rollout-note>"))
        .replace("<verify_timeout>", os.environ.get("VERIFY_TIMEOUT", "1800"))
        .replace("<verify_slots>", os.environ.get("VERIFY_SLOTS", "2")).replace("<slot_wait>", os.environ.get("SLOT_WAIT", "60"))
        .replace("<env_bootstrap>", esc(boot)).replace("<verifier>", esc(verifier)))
print(line)
PY
}
# erow <args-json> <script-json>: one engine call (runTask) with a label-keyed stub; prints the result JSON.
erow() {
  node --input-type=module -e "
    import { runTask } from './tests/lib/engine.mjs'
    const [args, script] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2])]
    const r = await runTask(args, async (p, o) => { if (!(o.label in script)) throw new Error('stub: unknown label ' + o.label); return script[o.label] })
    if (r.error) { console.error(String(r.error && r.error.stack)); process.exit(1) }
    process.stdout.write(JSON.stringify(r.result))
  " "$1" "$2"
}
# p1args <slug> <maxReviewRounds> [history-json] [roundsUsed]: a mode-'integrate' P1 call (the lead merged and
# verified green, a shared file) for <slug> in rollout ro, repo /repo, with fake SHAs.
p1args() {
  python3 - "$@" <<'PY'
import json, sys
slug, maxr = sys.argv[1], int(sys.argv[2])
hist = json.loads(sys.argv[3]) if len(sys.argv) > 3 else [{"round": 1, "feedback": ["own-run fix"]}]
used = int(sys.argv[4]) if len(sys.argv) > 4 else 1
s = lambda c: c * 40
alias = slug.split("-", 1)[1] if "-" in slug else slug
print(json.dumps({"rolloutSlug": "ro", "repoPath": "/repo", "verifier": "true", "date": "2026-10-02", "mode": "integrate",
  "verifySlot": {"script": "/plugins/thread/x/skills/execute/scripts/verify-slot.py", "slots": 2},
  "task": {"slug": slug, "taskPath": "", "scope": "cross-cutting", "planGate": False, "maxIterations": 3,
           "maxReviewRounds": maxr, "maxPlanRounds": 3, "rung": "opus-xhigh"},
  "integration": {"prUrl": f"https://github.com/o/r/pull/{ord(slug[-1])}", "branch": f"audit-fix/{alias}",
    "worktreePath": f"/repo/.claude/worktrees/{slug}", "headSha": s("a"), "taskBase": s("b"), "mainSha": s("c"),
    "trouble": ["shared-file"], "landed": [], "reviewHistory": hist, "reviewRoundsUsed": used,
    "rung": {"startRung": "opus-high", "rung": "opus-xhigh", "climbs": [{"stage": "implement", "from": "opus-high", "to": "opus-xhigh"}]},
    "leadMerge": {"mergeCommit": s("d"), "headSha": s("d"), "baseSha": s("c"), "verified": True},
    "startedAt": "2026-10-02T12:00+00:00", "readyAt": "2026-10-02T11:00+00:00"}}))
PY
}
judge_changes() { printf '{"integration-review:%s r%s":{"verdict":"changes","feedback":["keep their rename"],"unreadable":false,"finishedAt":"2026-10-02T12:10:00Z"}}' "$1" "$2"; }
# notes-only rollout: nfx <name> <ceiling> — V with ro.md (Queue a, b, c, d, x, y) and no git.
nfx() {
  echo "== $1"; F="$tmp/$1"; V="$F/vault"; mkdir -p "$V"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: %s\n---\n\nProject root: `/repo`\n\n## Queue\n\n- [[proj-a]]\n- [[proj-b]]\n- [[proj-c]]\n- [[proj-d]]\n- [[proj-x]]\n- [[proj-y]]\n' "$2" > "$V/ro.md"
}
ntask() {  # ntask <slug> <status> [frontmatter lines…]
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nrollout: "[[ro]]"\n' "$st"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n%s\n' "$s"; } > "$V/$s.md"
}
# the row's PR as p1args renders it, for a note's pr:
p1pr() { python3 -c 'import sys; print("https://github.com/o/r/pull/%d" % ord(sys.argv[1][-1]))' "$1"; }

# ======== C1: main unmoved — route merge, the lead's case-(i) line, merge-task 0, mark-done ===============
fx c1
prep
ok "$prc" 0 "C1: prepare exits 0"
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')" "merge|i" "C1: main unmoved → case (i), route merge"
ok "$(j "$J" 'd["prHead"]')|$(j "$J" 'd["anchor"]')|$(j "$J" 'd["taskBase"]')|$(j "$J" 'd["mainSha"]')" "$H0|$H0|$TB|$TB" "C1: H = A = H0, TB = B"
ok "$(j "$J" 'd["mergeCommit"]')|$(git -C "$WT" rev-parse HEAD)" "|$H0" "C1: no merge commit; the tree stays at H0"
for k in branch worktreePath prHead anchor taskBase mainSha case route trouble reason landed unlisted note; do
  ok "$(j "$J" "'$k' in d")" true "C1: prepare prints $k"
done
ok "$(j "$J" '[d["landed"], d["unlisted"], d["note"]]')" '[[],[],""]' "C1: an empty range → landed [], unlisted [], note \"\""
S=$(python3 "$LI" stamp)
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started "$S" --anchor "$H0" --head "$H0" --base "$TB" >/dev/null
has "$(loglines)" " integrated path=lead pr=5 anchor=$H0 head=$H0 base=$TB " "C1: log-integration writes integrated path=lead head=H base=TB"
mkpr 5 "$H0"; printf '%s\n' "$TB" > "$MT_STATE/base.seq"
mt 5 "$H0" "$TB"
ok "$rc|$(cat "$R/.claude/merge-task.status")" "0|ok" "C1: merge-task merges the pair: rc 0, sentinel ok"
python3 "$RR" mark-done --tasks "$SLUG" --tasks-dir "$V" >/dev/null
ok "$(fm "$V/$SLUG.md" status)" "status: done" "C1: mark-done → done"

# ======== C2: main moved — the lead merges, verifies, pushes, logs and merges; no agent spawned ============
fx c2
main m.txt "theirs" "theirs: m (#7)"
mkdir -p "$tmp/noagent"; for b in claude node; do printf '#!/bin/sh\ntouch "%s/agent-spawned"\nexit 97\n' "$tmp" > "$tmp/noagent/$b"; chmod +x "$tmp/noagent/$b"; done
PATH0=$PATH; export PATH="$tmp/noagent:$PATH"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["trouble"]')|$(j "$J" 'd["sharedFiles"]')" "verify|i|[]|[]" "C2: main moved, no shared file → route verify, trouble []"
M=$(j "$J" 'd["mergeCommit"]')
ok "$(git -C "$WT" rev-list --parents -n 1 HEAD)" "$M $H0 $B" "C2: the lead's merge M has parents (H, B)"
ok "$(git -C "$WT" log -1 --format=%s "$M")" "Merge origin/master into $BR (Integration)" "C2: the engine's merge message"
ok "$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")" "$H0" "C2: nothing pushed yet"
cmd=$(verify_line "$WT" "$SLUG" "true")
CLAUDE_PLUGIN_ROOT="$root" bash -c "$cmd" >/dev/null 2>&1
ok "$(cat "$R/.claude/integration/$SLUG.rc" 2>/dev/null)" 0 "C2: the SKILL.md verify line, verifier true → rc 0"
ok "$(python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M" >/dev/null 2>&1; echo $?)" 0 "C2: push exits 0"
ok "$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")" "$M" "C2: origin's branch is M"
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$H0" --head "$M" --base "$B" >/dev/null
has "$(loglines)" " integrated path=lead pr=5 anchor=$H0 head=$M base=$B " "C2: log-integration writes head=M base=B"
before=$(loglines)
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["prHead"]')|$(j "$J" 'd["record"]["base"]')" "merge|ii|$M|$B" "C2: a second prepare → case (ii), merge (M, B)"
ok "$(j "$J" 'd["anchor"]')" "$H0" "C2: the anchor stays H0 (the commit before the lead's merge)"
ok "$(loglines)" "$before" "C2: case (ii) writes no new log line"
mkpr 5 "$M"; printf '%s\n' "$B" > "$MT_STATE/base.seq"
mt 5 "$M" "$B"
ok "$rc|$(cat "$R/.claude/merge-task.status")" "0|ok" "C2: merge-task <repo> 5 M B → rc 0, ok"
ok "$(git --git-dir "$MT_SRV" rev-list --parents -n 1 master | cut -d' ' -f2-)" "$B" "C2: the squash's single parent is B"
ok "$(grep -c '^pr merge' "$MT_STATE/gh.log")" 1 "C2: gh.log holds one pr merge"
python3 "$RR" mark-done --tasks "$SLUG" --tasks-dir "$V" >/dev/null
ok "$(fm "$V/$SLUG.md" status)" "status: done" "C2: mark-done → done"
export PATH=$PATH0
ok "$([ -e "$tmp/agent-spawned" ] && echo spawned || echo none)" none "C2: only git, the scripts and the fake gh ran (no claude, no node)"

# ======== C3: a shared file ==========================================================================
fx c3
main a.txt "$(printf 'a1\na2\na3\na4\nA5 theirs')" "theirs: a5 (#7)"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')|$(j "$J" 'd["sharedFiles"]')" 'verify|["shared-file"]|["a.txt"]' "C3: a shared file → verify, trouble [shared-file], sharedFiles [a.txt]"

# ======== C4: a conflict =============================================================================
fx c4
main a.txt "$(printf 'A1 theirs\na2\na3\na4\na5')" "theirs: a1 (#7)"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')|$(j "$J" 'd["conflictFiles"]')" 'trouble|["conflict"]|["a.txt"]' "C4: a conflict → trouble [conflict], conflictFiles [a.txt]"
ok "$(git -C "$WT" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && echo left || echo none)|$(git -C "$WT" rev-parse HEAD)" "none|$H0" "C4: the merge is aborted (no MERGE_HEAD), HEAD == H"
ok "$(git -C "$WT" status --porcelain --untracked-files=no)" "" "C4: the tree is clean"

# ======== C5: a red verifier; undo ===================================================================
fx c5
main m.txt "theirs"
prep; M=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" verify --tree "$WT" --out "$R/.claude/integration/$SLUG" --timeout 60 --verifier 'echo junk >> t.txt; echo red; false' >/dev/null
ok "$(cat "$R/.claude/integration/$SLUG.rc")" 1 "C5: a red verifier → rc 1"
has "$(tail -n 20 "$R/.claude/integration/$SLUG.log")" "red" "C5: the log tail carries the verifier's output"
U=$(python3 "$LI" undo --repo "$R" --slug "$SLUG" --merge "$M" --to "$H0" 2>&1); urc=$?
ok "$urc|$(git -C "$WT" rev-parse HEAD)" "0|$H0" "C5: undo restores H"
ok "$(j "$U" 'd["stashed"]')" "integration leftovers $M" "C5: undo stashes the verifier's leftover"
has "$(git -C "$WT" stash list)" "integration leftovers $M" "C5: the leftover is in the stash list, never discarded"
ok "$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")" "$H0" "C5: origin untouched"
python3 "$LI" undo --repo "$R" --slug "$SLUG" --merge "$M" --to "$H0" >/dev/null 2>&1
ok "$?" 1 "C5: undo refuses when HEAD is not the merge"
prep; M2=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" undo --repo "$R" --slug "$SLUG" --merge "$M2" --to "$TB" >/dev/null 2>&1
ok "$?" 1 "C5: undo refuses when M^1 is not --to"
python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M2" >/dev/null 2>&1
python3 "$LI" undo --repo "$R" --slug "$SLUG" --merge "$M2" --to "$H0" >/dev/null 2>&1
ok "$?|$(git -C "$WT" rev-parse HEAD)" "1|$M2" "C5: undo refuses a pushed merge"

# ======== C6: case (ii) from an engine line ============================================================
fx c6
main a.txt "$(printf 'a1\na2\na3\na4\nA5 theirs')" "theirs: a5 (#6)"; B0=$B
onbranch merge --no-ff --no-edit -m "Merge origin/master into $BR (Integration)" origin/master
M1=$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")
g -C "$WT" pull -q --ff-only origin "$BR" 2>/dev/null
addlog "$V/$SLUG.md" "2026-10-02T11:30+00:00 integrated path=integrator pr=5 anchor=$H0 head=$M1 base=$B0 wait=5 duration=3 triggers=shared-file"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["prHead"]')|$(j "$J" 'd["anchor"]')" "merge|ii|$M1|$H0" "C6: main unmoved → case (ii), merge (M1, B0), anchor H0"
ok "$(j "$J" '[d["record"][k] for k in ("duration", "triggers", "active")]')" '["3","shared-file",null]' \
  "C6: a line from before p29-13 (ten tokens, no active=) still parses: active null, the rest as written"
sed -i.bak "s/ triggers=shared-file$/ triggers=shared-file active=2/" "$V/$SLUG.md"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" '[d["record"][k] for k in ("duration", "triggers", "active")]')" \
  'merge|ii|["3","shared-file","2"]' "C6: an 11-token line (active=, p29-13) backs case (ii) the same, its active read"
sed -i.bak "s/ triggers=shared-file active=2$/ triggers=shared-file/" "$V/$SLUG.md"
main m.txt "theirs" "theirs: m (#8)"; B1=$B
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["sharedFiles"]')|$(j "$J" 'd["trouble"]')" "verify|ii|[]|[]" "C6: main moved → verify; shared files over B0..B1 only (a.txt was integrated already)"
ok "$(git -C "$WT" rev-list --parents -n 1 HEAD | cut -d' ' -f2-)" "$M1 $B1" "C6: the lead's merge has parents (M1, B1)"
ok "$(j "$J" 'd["taskBase"]')" "$TB" "C6: the task base stays merge-base(anchor, main)"
sed -i.bak "s/ base=$B0 wait=5 / base=- wait=5 /" "$V/$SLUG.md"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')" "trouble|null" "C6: an integrated line with no base never backs case (ii)"
sed -i.bak "s/ base=- wait=5 / base=$B0 wait=5 /" "$V/$SLUG.md"
for o in rejected set-aside; do
  sed -i.bak "s/ integrated path=integrator / $o path=integrator /" "$V/$SLUG.md"
  prep
  ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["trouble"]')" "trouble|null|[]" "C6: last line $o → trouble []"
  sed -i.bak "s/ $o path=integrator / integrated path=integrator /" "$V/$SLUG.md"
done

# ======== C7: the own run merged main; a stale anchor ref ===============================================
fx c7
main m.txt "theirs"
onbranch merge --no-ff --no-edit -m "agent merged main" origin/master
H=$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")
X=$(git -C "$R" commit-tree "$(git -C "$R" rev-parse "$TB^{tree}")" -m dangling)
git -C "$R" update-ref "refs/integration-anchor/$BR" "$X"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')|$(j "$J" 'd["anchor"]')|$(j "$J" 'd["prHead"]')" "trouble|[]|$H0|$H" "C7: an own-run merge of main → trouble [] on anchor H0"
ok "$(j "$J" 'd["staleRefDeleted"]')" "$X" "C7: the stale anchor ref is reported deleted"
ok "$(git -C "$R" rev-parse -q --verify "refs/integration-anchor/$BR" || echo gone)" gone "C7: … and it is gone"

# ======== C8: a missing tree, an unpushed commit, leftovers, a gone branch =============================
fx c8
printf 'leftover\n' >> "$WT/t.txt"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["stashed"]')" "merge|integration leftovers $H0" "C8: tracked leftovers are stashed (main unmoved → merge)"
has "$(git -C "$WT" stash list)" "integration leftovers $H0" "C8: … into the stash list"
g -C "$WT" commit -q --allow-empty -m unpushed
UNP=$(git -C "$WT" rev-parse HEAD)
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["prHead"]')" "merge|i|$H0" "C8: an unpushed commit in the tree, main unmoved → merge on origin's head (the merge route needs no tree)"
ok "$(git -C "$WT" rev-parse HEAD)" "$UNP" "C8: … and the tree's commit is left alone"
g -C "$WT" checkout -q --detach
prep
ok "$(j "$J" 'd["route"]')" "merge" "C8: a tree off its branch, main unmoved → merge"
g -C "$WT" checkout -q "$BR"
g -C "$R" worktree remove --force "$WT"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')" "merge|i" "C8: a missing tree, main unmoved → merge"
g -C "$R" worktree add -q "$WT" "$BR" >/dev/null 2>&1
main m.txt "theirs"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "trouble|[]" "C8: an unpushed commit in the tree, main moved → trouble []"
has "$(j "$J" 'd["reason"]')" "commit(s) origin/$BR lacks" "C8: … naming it"
g -C "$WT" reset -q --keep "$H0"; g -C "$WT" checkout -q --detach
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "trouble|[]" "C8: a tree off its branch, main moved → trouble []"
has "$(j "$J" 'd["reason"]')" "detached HEAD" "C8: … naming it"
g -C "$R" worktree remove --force "$WT"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "trouble|[]" "C8: a missing tree, main moved → trouble []"
has "$(j "$J" 'd["reason"]')" "no task tree of its own" "C8: … naming it"
git --git-dir "$MT_SRV" update-ref -d "refs/heads/$BR"
prep
ok "$prc|$(j "$J" 'd["route"]')" "0|set-aside" "C8: origin/<branch> gone → set-aside"
GONE=$(j "$J" 'd["reason"]')
ok "$GONE" "origin/$BR does not exist — the PR branch is gone" "C8: the reason, with no integration: prefix"

# ======== C9: push refused ===========================================================================
fx c9
main m.txt "theirs"
prep; M=$(j "$J" 'd["mergeCommit"]')
onbranch commit -q --allow-empty -m "a repair pushed meanwhile"
python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M" >/dev/null 2>&1
ok "$?" 1 "C9: a non-fast-forward push is refused (exit 1), never forced"
python3 "$LI" undo --repo "$R" --slug "$SLUG" --merge "$M" --to "$H0" >/dev/null 2>&1
ok "$?|$(git -C "$WT" rev-parse HEAD)" "0|$H0" "C9: undo restores H"

# ======== C10: landed ===============================================================================
fx c10
main x.txt "x" "theirs: rename (#7)"
g -C "$F/p" checkout -q -b feature; printf 'y\n' > "$F/p/y.txt"; g -C "$F/p" add y.txt; g -C "$F/p" commit -q -m feat
g -C "$F/p" checkout -q master; g -C "$F/p" merge -q --no-ff -m "Merge pull request #8 from o/feature" feature; g -C "$F/p" push -q origin master
printf -- '---\ntags: [task]\nstatus: done\npr: https://github.com/o/r/pull/7\n---\n\nx\n' > "$V/proj-t7.md"
mkdir -p "$V/Archive"; printf -- '---\ntags: [task]\nstatus: done\npr: "8"\n---\n\ny\n' > "$V/Archive/proj-t8.md"
prep
ok "$(j "$J" '[(x["prUrl"], x["title"], x["files"], x["taskPath"]) for x in d["landed"]]')" \
  "[[\"https://github.com/o/r/pull/7\",\"theirs: rename (#7)\",[\"x.txt\"],\"$V/proj-t7.md\"],[\"https://github.com/o/r/pull/8\",\"Merge pull request #8 from o/feature\",[\"y.txt\"],\"$V/Archive/proj-t8.md\"]]" \
  "C10: (#7) and a Merge pull request #8 commit → their PR, title, files and task note"
# p17-1: a commit pushed without a PR is skipped from landed (listed in unlisted), never dropping the whole list.
main z.txt "z" "a direct push"
prep
ok "$(j "$J" '[x["prUrl"] for x in d["landed"]]')" '["https://github.com/o/r/pull/7","https://github.com/o/r/pull/8"]' "C10: a commit with no PR number → landed still lists #7 and #8"
ok "$(j "$J" 'd["unlisted"]')" "[{\"sha\":\"$B\",\"subject\":\"a direct push\",\"files\":[\"z.txt\"]}]" "C10: … and unlisted names it: sha, subject, files"
N10=$(j "$J" 'd["note"]')
has "$N10" "1 commit(s)" "C10: … note counts it"; has "$N10" "${B:0:12}" "C10: … names its sha"; has "$N10" "name no PR" "C10: … and says why"
UL10=$(j "$J" 'd["unlisted"]')
main w.txt "w" "theirs: later (#9)"
prep
ok "$(j "$J" '[x["prUrl"] for x in d["landed"]]')" '["https://github.com/o/r/pull/7","https://github.com/o/r/pull/8","https://github.com/o/r/pull/9"]' "C10: a PR after the direct push → landed #7, #8, #9, oldest first"
ok "$(j "$J" 'd["unlisted"]')" "$UL10" "C10: … unlisted unchanged"
TB10=$(j "$J" 'd["taskBase"]'); B10=$(j "$J" 'd["mainSha"]')
NG=$(python3 - "$LI" "$R" "$TB10" "$B10" "$V" <<'PY2'
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("li", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
landed, unlisted, note = m._landed(sys.argv[2], sys.argv[3], sys.argv[4], "", Path(sys.argv[5]))
print(json.dumps({"landed": landed, "unlisted": [u["subject"] for u in unlisted], "note": note}))
PY2
)
ok "$(j "$NG" '[d["landed"], d["unlisted"]]')" '[[],["a direct push"]]' "C10: origin not github.com and pr: not a URL → landed [], unlisted still filled"
ok "$(j "$NG" 'd["note"].startswith("origin is not a github.com remote")')|$(j "$NG" '"; 1 commit(s)" in d["note"]')" "true|true" "C10: … note gives the non-github reason first, then the unlisted one"
ZB=$(git -C "$F/p" rev-parse HEAD~2); ZC=$(git -C "$F/p" rev-parse HEAD~1)
AP=$(python3 - "$LI" "$R" "$ZB" "$ZC" "$V" <<'PY2'
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("li", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
landed, unlisted, note = m._landed(sys.argv[2], sys.argv[3], sys.argv[4], "o/r", Path(sys.argv[5]))
print(json.dumps({"landed": landed, "unlisted": [u["subject"] for u in unlisted], "note": note}))
PY2
)
ok "$(j "$AP" '[d["landed"], d["unlisted"], d["note"].startswith("1 commit(s)")]')" '[[],["a direct push"],true]' "C10: a range of PR-less commits only → landed [], each in unlisted"

# ======== C11: engine pins (byte-equal) ===============================================================
echo "== c11"
CASES=$(python3 - <<'PY'
import json
H2 = [{"round": 1, "feedback": ["own-run fix"]}, {"round": 2, "feedback": ["keep their rename"], "stage": "integration"}]
HE = [{"round": 1, "feedback": ["", " "]}, {"round": 3, "feedback": ["a\nb", "  c  "]}]
reasons = ["merge step STOP: fetch origin failed twice", "integration: head moved after Integration (PR head x)",
           "INTEGRATION:  shouty", "  integration:x", "multi\nline\n reason", "", "integration: integration: doubled",
           "merge declined at the --gated hold",
           # p27-4: reasons that would read as a named marker are escaped `integration: set aside: ` on both sides
           "verifier red: x", "Conflict unresolved in a.js", "integration: verifier red: y"]
markers = [[k, r, h] for k in ("set-aside", "revise-stopped", "rejected") for r in reasons for h in ([], H2, HE)]
parse = ["revise: rejected at Integration re-review — revise on the branch, then re-integrate\nrevise stopped: x\n\nRound 1 rejection:\n- a\n- b\n\nRound 2 (Integration) rejection:\n- c",
         "integration: foo\n\nRound 1 rejection:\n- a", "Round 1:\n- a\n\nRound 2:\n- b", "", "  \n\nplain text\n- not a round",
         "REVISE: Rejected at integration re-review — x", "round 3 REJECTION:\n- y\nstray\n- z", "Round 1:\n-  spaced  \n- \n",
         " integration: spaced", "Round 01:\n- leading zero",
         # p27-4: an Integration conflict's marker with its brief and history; a shouty red; the escape
         "integration: conflict unresolved in a.js, b.js\n\nResolution brief (Integration conflict): merging the latest main "
         "conflicted and the integrator could not keep both intents, so it aborted the merge and pushed nothing.\n"
         "- Conflicting paths: a.js, b.js\n- Theirs: https://github.com/o/r/pull/5 (theirs: rename) touched a.js; brief /vault/t.md\n"
         "- The integrator:\n  - a.js: both rename foo\n  - Round 3 rejection:\n  - b.js: ours keeps foo\n\nRound 1 rejection:\n- own-run fix\n\nRound 2 (Integration) rejection:\n- keep their rename",
         "INTEGRATION: Verifier Red: x", "integration: set aside: conflict unresolved in a.js"]
minutes = [["2026-10-02T12:00+00:00", "2026-10-02T12:30+00:00"], ["2026-10-02T12:00:00Z", "2026-10-02T12:00:59Z"],
           ["2026-10-02T12:00:00Z", "2026-10-02T12:01:29.9Z"], ["2026-10-02T12:00:30Z", "2026-10-02T12:01:00Z"],
           ["2026-10-02T22:00+10:00", "2026-10-02T12:05Z"], ["2026-02-30T00:00Z", "2026-03-01T00:00Z"],
           ["2026-10-02T12:30Z", "2026-10-02T12:00Z"], [None, "2026-10-02T12:00Z"], ["2026-10-02T12:00+1000", "2026-10-02T02:10Z"],
           [" 2026-10-02T12:00Z ", "2026-10-02T12:01Z"], ["2024-02-29T00:00Z", "2024-03-01T00:00Z"], ["2026-10-02T24:00Z", "2026-10-03T00:00Z"],
           ["2026-10-02T12:00:59.6Z", "2026-10-02T12:02Z"], ["2026-10-02T12:00", "2026-10-02T12:01Z"]]
# p17-1: inputs --row's ports of historyError, rungRecordError and PR_URL, pass for pass.
f = lambda *fb: {"round": 1, "feedback": list(fb)}
hist = [[], [f("a")], [f()], [f(" ")], [f("\u00a0\ufeff")], [{"round": 2, "feedback": ["a"]}, {"round": 1, "feedback": ["b"]}],
        [f("a"), f("b")], [{"round": 0, "feedback": ["a"]}], [{"round": True, "feedback": ["a"]}], [{"round": "1", "feedback": ["a"]}],
        [{"round": 1, "feedback": "a"}], [{"round": 1, "feedback": [1]}], [{"round": 1, "feedback": ["a"], "stage": "x"}],
        [{"round": 1, "feedback": ["a"], "stage": None}], [{"round": 1}], [None], [[1]], ["x"], "x", None, {},
        [{"round": 1, "feedback": ["a"], "stage": "integration"}], [f(), {"round": 3, "feedback": ["c"], "stage": "integration"}],
        [{"round": 1, "feedback": [""]}, {"round": 2, "feedback": ["", " "]}]]
c = lambda s, a, b: {"stage": s, "from": a, "to": b}
rungs = [{"startRung": "", "rung": "", "climbs": []}, {"startRung": "opus-high", "rung": "opus-xhigh", "climbs": [c("implement", "opus-high", "opus-xhigh")]},
         {"startRung": "opus-high", "rung": "opus-high", "climbs": [c("review", "opus-high", "opus-high")]},
         {"startRung": "a1", "rung": "b.c_d-e", "climbs": [c("plan", "a1", "b.c_d-e")]},
         {"startRung": "", "rung": "Opus!", "climbs": []}, {"startRung": "", "rung": "true", "climbs": []},
         {"startRung": "", "rung": "opus-high"}, {"startRung": "", "rung": "opus-high", "climbs": [], "extra": 1},
         {"startRung": "", "rung": "opus-high", "climbs": [c("verify", "opus-high", "opus-xhigh")]},
         {"startRung": "", "rung": "opus-high", "climbs": [{"stage": "plan", "from": "opus-high"}]},
         {"startRung": "", "rung": "opus-high", "climbs": [c("plan", "", "opus-high")]},
         {"startRung": "", "rung": "opus-high", "climbs": {}}, {"startRung": None, "rung": "", "climbs": []},
         {"startRung": "", "rung": "", "climbs": [None]}, "opus-high", None, [], {}]
urls = ["https://github.com/o/r/pull/5", "https://github.com/o/r/pull/5/", "http://github.com/o/r/pull/5",
        "https://github.com/o/r/pulls/5", "https://ghe.example/o/r/pull/12", "https://github.com/o r/pull/5",
        "https://github.com/o\u00a0r/pull/5", "https://github.com/o/r/pull/5\n", "https://github.com/o/r/pull/", "",
        "https://github.com/o/r/pull/5x", "https://x/pull/1/pull/2", "https://github.com/o/r/pull/\u0665",
        " https://github.com/o/r/pull/5", "https://github.com/o/r/pull/5#x", "https://GITHUB.com/O/R/pull/5"]
# Two deliberate divergences, each stricter here (the row then falls back to the note): a pre-3.0.0 tier record and
# a float round (JSON 1.0 is the integer 1 to the engine).
div = [{"model": "opus", "escalated": False, "escalatedAt": "", "tierCapped": False, "tierCappedAt": ""}, [{"round": 1.0, "feedback": ["a"]}]]
print(json.dumps({"slugs": ["proj-t5", "solo", "a-b-c"], "markers": markers, "own": ["plain", "integration: x",
  "revise: rejected at Integration re-review — x", "", "Integration: X", " own text"], "minutes": minutes, "parse": parse,
  "hist": hist, "rungs": rungs, "urls": urls, "div": div}))
PY
)
ENG=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['ANCHOR_RECIPE', 'shortAlias', 'worktreeDir', 'integrationMergeStep', 'integrationMarker', 'stageDiagnosis', 'wholeMinutes', 'parseIntegrationMarker',
    'historyError', 'rungRecordError', 'PR_URL', 'integrationBlockOf', 'INTEGRATION_CONFLICT_MARK', 'INTEGRATION_RED_MARK'])
  const c = JSON.parse(process.argv[1])
  const st = T.integrationMergeStep({ repoPath: '/r', defaultBranch: 'master' }, { slug: 'proj-t5' }, { headSha: 'a'.repeat(40), taskBase: 'b'.repeat(40) })
  const br = st.match(/BR=\"([^\"]+)\"/)[1]
  process.stdout.write(JSON.stringify({
    recipe: T.ANCHOR_RECIPE,
    names: c.slugs.map((s) => ['audit-fix/' + T.shortAlias(s), T.worktreeDir('/r', s)]),
    mergeMsg: st.match(/-m \"(Merge origin[^\"]+)\"/)[1].replace('\$BR', br),
    markers: c.markers.map(([k, r, h]) => T.integrationMarker(k, r, h)),
    own: c.own.map((d) => T.stageDiagnosis({}, { blockerDiagnosis: d }, 'blocked')),
    minutes: c.minutes.map(([f, t]) => T.wholeMinutes(f, t)),
    parse: c.parse.map((x) => T.parseIntegrationMarker(x)),
    hist: c.hist.map((h) => [T.historyError(h, true) === '', T.historyError(h, false) === '']),
    rungs: c.rungs.map((g) => T.rungRecordError(g) === ''),
    urls: c.urls.map((u) => T.PR_URL.test(u)),
    div: [T.rungRecordError(c.div[0]) === '', T.historyError(c.div[1], true) === ''],
    blocks: c.parse.map((x) => T.integrationBlockOf(x)),
    marks: [T.INTEGRATION_CONFLICT_MARK, T.INTEGRATION_RED_MARK],
  }))
" "$CASES")
PY_=$(python3 - "$LI" "$CASES" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("li", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c = json.loads(sys.argv[2])
print(json.dumps({
  "recipe": m.ANCHOR_RECIPE,
  "names": [[m.branch_of(s), m.worktree_dir("/r", s)] for s in c["slugs"]],
  "mergeMsg": m.merge_message("master", m.branch_of("proj-t5")),
  "markers": [m.integration_marker(k, r, h) for k, r, h in c["markers"]],
  "own": [m.own_run_diagnosis(d) for d in c["own"]],
  "minutes": [m.rr._whole_minutes(f, t) for f, t in c["minutes"]],
  "parse": [m.parse_integration_marker(x) for x in c["parse"]],
  "hist": [[m.history_error(h, True) == "", m.history_error(h, False) == ""] for h in c["hist"]],
  "rungs": [m.rung_record_error(g) == "" for g in c["rungs"]],
  "urls": [bool(m.ENGINE_PR_URL_RE.fullmatch(u)) for u in c["urls"]],
  "div": [m.rung_record_error(c["div"][0]) == "", m.history_error(c["div"][1], True) == ""],
  "blocks": [m.rr.integration_block(x) or "" for x in c["parse"]],
  "marks": [m.rr.INTEGRATION_CONFLICT_MARK, m.rr.INTEGRATION_RED_MARK],
}, ensure_ascii=False))
PY
)
canon() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.dumps(d[sys.argv[2]], sort_keys=True, ensure_ascii=False))' "$1" "$2"; }
for k in recipe names mergeMsg markers own minutes parse hist rungs urls blocks marks; do
  ok "$(canon "$PY_" "$k")" "$(canon "$ENG" "$k")" "C11: lead-integrate's $k is byte-equal to the engine's"
done
# the cases are not vacuous: each list holds both verdicts, in the engine's own words (control)
ok "$(canon "$ENG" hist)" "[[true, false], [true, true], [true, false], [true, false], [true, false]$(printf ', [false, false]%.0s' $(seq 16)), [true, true], [true, true], [true, false]]" "C11: the engine's verdicts on the history cases (control)"
ok "$(canon "$ENG" rungs)|$(canon "$ENG" urls)" "[true, true, true, true$(printf ', false%.0s' $(seq 14))]|[true, false, false, false, true, false, false, false, false, false, false, true, false, false, false, true]" "C11: the engine's verdicts on the rung and URL cases (control)"
ok "$(canon "$ENG" div)|$(canon "$PY_" div)" "[true, true]|[false, false]" "C11: the two deliberate divergences (a pre-3.0.0 tier record, a float round) pass the engine and are refused here"
ok "$(canon "$ENG" names)" '[["audit-fix/t5", "/r/.claude/worktrees/proj-t5"], ["audit-fix/solo", "/r/.claude/worktrees/solo"], ["audit-fix/b-c", "/r/.claude/worktrees/a-b-c"]]' "C11: the names themselves (control)"
ok "$(python3 -c 'import json,sys; print(sum(1 for x in json.loads(sys.argv[1])["markers"] if x.lower().startswith("integration: integration:")))' "$PY_")" 3 "C11: only the doubled-prefix reason (x3 histories) keeps a second prefix (the engine strips one)"
ok "$(python3 -c 'import json,sys; b=json.loads(sys.argv[1])["blocks"]; print(sorted(set(b)), b[-3:])' "$ENG")" "['', 'conflict', 'red'] ['conflict', 'red', '']" \
  "C11: the engine's integrationBlockOf names a conflict, a red and the escape '' (control)"
ok "$(python3 -c 'import json,sys; print(sum(1 for x in json.loads(sys.argv[1])["markers"] if x.startswith("integration: set aside: ")))' "$PY_")" 9 \
  "C11: the three marker-shaped reasons (x3 histories) are escaped 'integration: set aside: '"

# ======== C12: inputs parity ============================================================================
nfx c12 4
ntask proj-a review "pr: $(p1pr proj-a)" 'review_rounds_used: 1' 'ready: 2026-10-02T11:00+00:00' 'rung: opus-high'
ROW=$(erow "$(p1args proj-a 3)" "$(judge_changes proj-a 2)")
rec "$ROW"
ok "$(fm "$V/proj-a.md" rung)" "rung: opus-xhigh" "C12: reconcile stamps the integrate row's passed-through rung"
I=$(inp proj-a --max-review-rounds 3)
DIAG=$(printf '%s' "$ROW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tasks"][0]["blockerDiagnosis"])')
EP=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['parseIntegrationMarker'])
  process.stdout.write(JSON.stringify(T.parseIntegrationMarker(process.argv[1])))
" "$DIAG")
ok "$(j "$I" '[d["markerStage"], d["markerReason"], d["history"]]')" "$(j "$EP" '[d["stage"], d["reason"], d["history"]]')" "C12: an engine rejected marker, reconciled, parses to exactly parseIntegrationMarker's output"
ok "$(j "$I" '[d["source"], d["lastRound"], d["reviewRoundsUsed"], d["readyAt"], d["rung"], d["resumeAt"]]')" \
  '["blocker",2,2,"2026-10-02T11:00+00:00",{"startRung":"","rung":"opus-xhigh","climbs":[]},"revise"]' "C12: source, rounds, readyAt, the rung record from the note's rung:, resumeAt revise"
ok "$(j "$I" '[k for k in ("model", "tierCapped", "tierCappedAt") if k in d]')" '[]' "C12: inputs carries no tier keys"
ok "$(j "$I" '"plan" in d')" false "C12: inputs carries no plan key (lead-integrate.py plan reads it, at the seeded revise only)"
ok "$(j "$I" 'd["lastIntegration"]["outcome"]')|$(j "$I" 'd["lastIntegration"]["path"]')" "rejected|judge-only" "C12: lastIntegration is the log's last line, as fields"
# the integrate call's rung fallback (SKILL.md § 4.5 step 3): inputs' rung record passes the engine's args check
# as it is, from a note with a rung: and from one with only stale tier stamps (the neutral record); a raw rung:
# string where the record goes fails it before dispatch (the control).
ntask proj-e review "pr: $(p1pr proj-e)" 'review_rounds_used: 1' 'tier_capped: review' 'model: fable'
NEUTRAL=$(inp proj-e)
ok "$(j "$NEUTRAL" 'd["rung"]')" '{"startRung":"","rung":"","climbs":[]}' "C12: a note with stale tier_capped:/model: fable and no rung: gives the neutral record"
RUNG=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['integrationArgsError'])
  const [a, i, n] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2]), JSON.parse(process.argv[3])]
  const err = (r) => { a.integration.rung = r; return T.integrationArgsError(a) }
  process.stdout.write(JSON.stringify([err(i.rung), err(n.rung), err(i.rung.rung).startsWith('rung must be')]))
" "$(p1args proj-a 3)" "$I" "$NEUTRAL")
ok "$RUNG" '["","",true]' "C12: inputs' rung record (named or neutral) passes integrationArgsError; a raw rung: string fails it"
# a review-blocked run parses whole; the newer run wins; a tie goes to review-blocked
ntask proj-b review-blocked "pr: $(p1pr proj-b)" 'review_rounds_used: 2'
printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-02T10:00+00:00)\n\nintegration: old set-aside\n\n<!-- run 1 end sha=000000000000 -->\n\n## Review-blocked feedback\n\n### Run 1 (2026-10-02T11:00+00:00)\n\nRound 1:\n- x\n\nRound 2:\n- y\n\n<!-- run 1 end sha=000000000000 -->\n\n## Integration log\n\n2026-10-02T10:30+00:00 rejected path=integrator pr=1 anchor=- head=- base=- wait=- duration=- triggers=-\n' >> "$V/proj-b.md"
I=$(inp proj-b)
ok "$(j "$I" '[d["source"], d["history"], d["resumeAt"], d["reviewRoundsUsed"]]')" '["review-blocked",[{"round":1,"feedback":["x"]},{"round":2,"feedback":["y"]}],"revise",2]' "C12: a newer review-blocked run parses whole; resumeAt revise"
sed -i.bak 's/### Run 1 (2026-10-02T10:00+00:00)/### Run 1 (2026-10-02T12:00+00:00)/' "$V/proj-b.md"
ok "$(j "$(inp proj-b)" '[d["source"], d["markerStage"], d["resumeAt"]]')" '["blocker","integrate","integration"]' "C12: a newer Blocker run wins → integration"
sed -i.bak 's/### Run 1 (2026-10-02T12:00+00:00)/### Run 1 (2026-10-02T11:00+00:00)/' "$V/proj-b.md"
ok "$(j "$(inp proj-b)" 'd["source"]')" "review-blocked" "C12: a tie goes to review-blocked"
ntask proj-c gate-pending "pr: $(p1pr proj-c)"
addlog "$V/proj-c.md" "2026-10-02T10:30+00:00 set-aside path=integrator pr=1 anchor=- head=- base=- wait=- duration=- triggers=-"
ok "$(j "$(inp proj-c)" 'd["resumeAt"]')" "integration" "C12: gate-pending with the last line set-aside → integration"
ntask proj-d blocked
printf '\n## Blocker diagnosis\n\nthe verifier stayed red\n' >> "$V/proj-d.md"
ok "$(j "$(inp proj-d --max-review-rounds 3)" '[d["markerStage"], d["resumeAt"], d["autoRevise"], d["reviewRoundsUsed"]]')" '["own","own",false,1]' "C12: an own-run diagnosis → own, no auto revise"

# ======== C13a: exit-4 plumbing ========================================================================
fx c13a
main m.txt "theirs"
I5=$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")
onbranch commit -q --allow-empty -m "pushed after the Integration"
N=$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")
mkpr 5 "$N"; printf '%s\n' "$B" > "$MT_STATE/base.seq"
setkey "$V/$SLUG.md" rung opus-xhigh
mt 5 "$I5" "$B"
ok "$rc" 4 "C13a: merge-task exit 4 (b): origin's branch moved past the integrated head"
REASON4=$(printf '%s\n' "$out" | sed -n 's/^set-aside reason: //p' | head -n 1)
has "$REASON4" "integration: head moved after Integration" "C13a: the text after set-aside reason: is merge-task's"
REASONS=("$REASON4" "integration: base moved before the merge 4 times in a row after 3 re-integrations (bases 1 2 3 4)" \
  "merge declined at the --gated hold" "merge-task exit 8 three times: retryable: cannot read PR #5 (x); nothing merged; re-run" \
  "workflow call failed: no result row" "$GONE")
EXPECT=("$REASON4" "integration: base moved before the merge 4 times in a row after 3 re-integrations (bases 1 2 3 4)" \
  "integration: merge declined at the --gated hold" "integration: merge-task exit 8 three times: retryable: cannot read PR #5 (x); nothing merged; re-run" \
  "integration: workflow call failed: no result row" "integration: $GONE")
i=0
for r in "${REASONS[@]}"; do
  setkey "$V/$SLUG.md" status review; setkey "$V/$SLUG.md" integrating 2026-10-02T12:00+00:00
  printf '%s' "$r" | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind integration | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
  first=$(lastrun "$V/$SLUG.md" | head -n 1)
  ok "$first" "${EXPECT[$i]}" "C13a[$i]: the diagnosis's first line is the reason, prefixed once"
  ok "$(printf '%s' "$first" | grep -ciE '^integration:[[:space:]]*integration:')" 0 "C13a[$i]: never integration: integration:"
  ok "$(setaside_at "$SLUG")" integration "C13a[$i]: status reports setAsideAt integration"
  ok "$(fm "$V/$SLUG.md" pr)|$(fm "$V/$SLUG.md" rung)|$(fm "$V/$SLUG.md" integrating)" "pr: $PR|rung: opus-xhigh|<none>" "C13a[$i]: pr: and rung: kept, integrating: gone"
  i=$((i+1))
done

# ======== C13b: a dead integrate call ===================================================================
fx c13b
main m.txt "theirs"
prep; M=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M" >/dev/null
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started 2026-10-02T12:00+00:00 --anchor "$H0" --head "$M" --base "$B" >/dev/null
setkey "$V/$SLUG.md" integrating 2026-10-02T12:05+00:00
logb=$(loglines)
printf 'workflow call failed: no result row' | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind integration | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
ok "$(fm "$V/$SLUG.md" status)|$(fm "$V/$SLUG.md" integrating)|$(fm "$V/$SLUG.md" pr)" "status: blocked|<none>|pr: $PR" "C13b: blocked, integrating: removed, pr: kept"
ok "$(loglines)" "$logb" "C13b: the Integration log is byte-identical (a lead row writes no line)"
NX=$(nxt "")
ok "$(j "$NX" 'd["integrating"]')|$(j "$NX" 'd["setAside"]')" "[]|[{\"slug\":\"$SLUG\",\"status\":\"blocked\",\"setAsideAt\":\"integration\"}]" "C13b: the lane is free; set aside at Integration"
ok "$(j "$(inp "$SLUG" --max-review-rounds 3)" '[d["resumeAt"], d["autoRevise"]]')" '["integration",false]' "C13b: inputs → resumeAt integration, no auto revise"
python3 "$RR" hand-back --tasks "$SLUG" --tasks-dir "$V" >/dev/null
ok "$(fm "$V/$SLUG.md" status)|$(j "$(nxt "")" 'd["awaitingIntegration"]')" "status: review|[\"$SLUG\"]" "C13b: hand-back → review, awaiting Integration"
# the dead integrator left a merge in progress and a tracked edit, and pushed another merge on top
g -C "$F/p" checkout -q -b side master; printf 's\n' > "$F/p/s.txt"; g -C "$F/p" add s.txt; g -C "$F/p" commit -q -m side; g -C "$F/p" push -q origin side; g -C "$F/p" checkout -q master
g -C "$WT" fetch -q origin
g -C "$WT" merge -q --no-ff --no-commit origin/side >/dev/null 2>&1
printf 'dead integrator edit\n' >> "$WT/base.txt"
onbranch merge --no-ff --no-edit -m "a dead integrator's pushed merge" origin/side
python3 "$RR" mark-integrating --tasks "$SLUG" --tasks-dir "$V" >/dev/null   # step 1.4 → step 3: the stamp before prepare
prep
ok "$(j "$J" 'd["abortedMerge"]')|$(git -C "$WT" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && echo left || echo none)" "true|none" "C13b: prepare aborts the merge left in progress"
ok "$(j "$J" 'd["stashed"]')" "integration leftovers $M" "C13b: … stashes the tracked edit"
has "$(git -C "$WT" stash list)" "integration leftovers $M" "C13b: … into the stash list"
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "trouble|[]" "C13b: a pushed half-Integration routes trouble []"
fx c13b2
main m.txt "theirs"
prep; M=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M" >/dev/null
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started 2026-10-02T12:00+00:00 --anchor "$H0" --head "$M" --base "$B" >/dev/null
g -C "$F/p" checkout -q -b side master; printf 's\n' > "$F/p/s.txt"; g -C "$F/p" add s.txt; g -C "$F/p" commit -q -m side; g -C "$F/p" push -q origin side; g -C "$F/p" checkout -q master
g -C "$WT" fetch -q origin; g -C "$WT" merge -q --no-ff --no-commit origin/side >/dev/null 2>&1
printf 'dead integrator edit\n' >> "$WT/base.txt"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["prHead"]')|$(j "$J" 'd["record"]["base"]')" "merge|ii|$M|$B" "C13b: with no extra push and main unmoved → case (ii) merge on the surviving record"

# ======== C13c: lead-written own and revise-stopped rows ===============================================
nfx c13c 4
ntask proj-a review "pr: $(p1pr proj-a)" 'review_rounds_used: 1'
rec "$(erow "$(p1args proj-a 3)" "$(judge_changes proj-a 2)")"
setkey "$V/proj-a.md" status in_progress
printf 'workflow call failed: no result row' | python3 "$LI" set-aside --note "$V/proj-a.md" --kind revise-stopped | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
I=$(inp proj-a --max-review-rounds 3)
ok "$(setaside_at proj-a)|$(j "$I" '[d["markerStage"], d["markerReason"], d["autoRevise"], d["resumeAt"]]')" 'run|["revise","workflow call failed: no result row",false,"revise"]' "C13c: revise-stopped → set aside at run, markerReason, no auto revise"
ok "$(lastrun "$V/proj-a.md" | head -n 2 | tail -n 1)" "revise stopped: workflow call failed: no result row" "C13c: the revise stopped: line"
ntask proj-b in_progress
printf 'workflow call failed: no result row' | python3 "$LI" set-aside --note "$V/proj-b.md" --kind own | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
ok "$(setaside_at proj-b)|$(j "$(inp proj-b)" 'd["resumeAt"]')|$(lastrun "$V/proj-b.md")" "run|own|workflow call failed: no result row" "C13c: own → set aside at run, resumeAt own, no own run: prefix"
ntask proj-c in_progress
printf 'integration: looks like a marker' | python3 "$LI" set-aside --note "$V/proj-c.md" --kind own | python3 "$RR" reconcile --result - --tasks-dir "$V" >/dev/null
ok "$(setaside_at proj-c)|$(lastrun "$V/proj-c.md")" "run|own run: integration: looks like a marker" "C13c: an own reason starting integration: gets own run: and stays at run"

# ======== C14: a rejection frees the lane while another task integrates ================================
nfx c14 2
ntask proj-a review "pr: $(p1pr proj-a)" 'integrating: 2026-10-02T12:00+00:00' 'review_rounds_used: 1'
ntask proj-b review "pr: $(p1pr proj-b)"
ntask proj-c open
rec "$(erow "$(p1args proj-a 3)" "$(judge_changes proj-a 2)")"
NX=$(nxt "")
ok "$(j "$NX" '[d["integrating"], d["awaitingIntegration"], d["setAside"], d["slotsInUse"]]')" '[[],["proj-b"],[{"slug":"proj-a","status":"blocked","setAsideAt":"run"}],0]' "C14: the rejection frees the lane: integrating [], awaiting [B], A set aside at run, 0 slots"
I=$(inp proj-a --max-review-rounds 3)
ok "$(j "$I" 'd["autoRevise"]')" true "C14: inputs → autoRevise true"
setkey "$V/proj-a.md" status in_progress; setkey "$V/proj-a.md" owner execute-c14
python3 "$RR" mark-started --tasks proj-a --tasks-dir "$V" >/dev/null
# resume.plan is `lead-integrate.py plan`'s plan (p14-2): the note's "## Approved plan", unquoted
printf '\n## Approved plan\n\nThe last approved plan, kept as a record for Integration.\n\n> C14 PLAN\n> - step one\n' >> "$V/proj-a.md"
PL=$(python3 "$LI" plan --note "$V/proj-a.md")
ok "$(j "$PL" 'd["plan"]')" "$(printf 'C14 PLAN\n- step one')" "C14: lead-integrate.py plan reads the note's approved plan"
RES=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['resumeArgsError'])
  const [i, pl] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2])]
  const resume = { stage: 'revise', prUrl: i.pr, branch: i.branch, worktreePath: '/repo/.claude/worktrees/proj-a', reviewHistory: i.history, reviewRoundsUsed: i.lastRound, plan: pl.plan }
  process.stdout.write(JSON.stringify([T.resumeArgsError({ repoPath: '/repo', task: { slug: 'proj-a', scope: 'cross-cutting', resume } }), resume.plan]))
" "$I" "$PL")
ok "$RES" '["","C14 PLAN\n- step one"]' "C14: the seeded revise's task.resume, built from inputs and plan, passes resumeArgsError"
python3 "$RR" mark-integrating --tasks proj-b --tasks-dir "$V" >/dev/null
NX=$(nxt proj-a)
ok "$(j "$NX" '[d["running"], d["integrating"], d["slotsInUse"], d["start"]]')" '[["proj-a"],["proj-b"],1,["proj-c"]]' "C14: A revises in a slot while B integrates; C starts"
setkey "$V/ro.md" parallel_ceiling 1
NX=$(nxt proj-a)
ok "$(j "$NX" '[d["start"], [h["reason"] for h in d["hold"] if h["slug"]=="proj-c"]]')" '[[],["ceiling: 1/1 slots in use"]]' "C14: ceiling 1: C is held"
ntask proj-d review "pr: $(p1pr proj-d)" 'review_rounds_used: 1'
rec "$(erow "$(p1args proj-d 3)" "$(judge_changes proj-d 2)")"
NX=$(nxt proj-a)
ok "$(j "$NX" 'd["slotsInUse"] == d["ceiling"]')|$(j "$(inp proj-d --max-review-rounds 3)" 'd["autoRevise"]')" "true|true" "C14: D rejected while slotsInUse == ceiling: auto-revisable, so it must wait (the contract's slots rule)"

# ======== C15: the verify line under bash and zsh -f =====================================================
fx c15
cmd=$(verify_line "$WT" "$SLUG" 'test -f t.txt && test -f .boot' 'test -d . && touch .boot')
ok "$(printf '%s' "$cmd" | grep -c 'NO-VERIFY-BLOCK')" 0 "C15: SKILL.md carries the thread:integration-verify block"
for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  rm -f "$WT/.boot"
  CLAUDE_PLUGIN_ROOT="$root" $sh -c "$cmd" >/dev/null 2>&1
  ok "$(cat "$R/.claude/integration/$SLUG.rc" 2>/dev/null)" 0 "C15 $n: the verify line runs (a verifier with spaces and &&, a bootstrap) → rc 0"
  has "$(cat "$R/.claude/integration/$SLUG.log")" "== verifier: test -f t.txt && test -f .boot" "C15 $n: the log names the verifier"
done
# $, $(…), backticks, a backslash and a ' must reach bash -c in the task tree unexpanded: in the lead's shell (cwd
# $root, no t.txt, another basename) any of them expands to something else and the run goes red.
SV='test "$(cat t.txt)" = task && b=`basename "$PWD"` && test "$b" = proj-t5 && printf '"'"'%s\n'"'"' "it'"'"'s \$5 in $b" > .v-out'
SB='test "$(basename "$PWD")" = proj-t5 && touch .boot2'
cmd=$(verify_line "$WT" "$SLUG" "$SV" "$SB")
dq=$(VERIFY_FILL=dq verify_line "$WT" "$SLUG" "$SV" "$SB")
for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  rm -f "$WT/.boot2" "$WT/.v-out" "$R/.claude/integration/$SLUG.rc"
  CLAUDE_PLUGIN_ROOT="$root" $sh -c "$cmd" >/dev/null 2>&1
  ok "$(cat "$R/.claude/integration/$SLUG.rc" 2>/dev/null)" 0 "C15 $n: a verifier and a bootstrap with \$, \$(…), backticks, \\ and ' → rc 0"
  ok "$(cat "$WT/.v-out" 2>/dev/null)" "it's \$5 in proj-t5" "C15 $n: … expanded by bash -c in the task tree only"
  has "$(cat "$R/.claude/integration/$SLUG.log")" "== verifier: $SV" "C15 $n: … and the log names the verifier byte for byte"
  has "$(cat "$R/.claude/integration/$SLUG.log")" "== env_bootstrap: $SB" "C15 $n: … and the bootstrap"
  rm -f "$WT/.boot2" "$WT/.v-out" "$R/.claude/integration/$SLUG.rc"
  CLAUDE_PLUGIN_ROOT="$root" $sh -c "$dq" >/dev/null 2>&1
  ok "$(r=$(cat "$R/.claude/integration/$SLUG.rc" 2>/dev/null); [ "$r" = 0 ] && echo green || echo "red")" red "C15 $n control: the old double-quoted form expands them in the lead's shell → red"
done

# ======== C16: stamp, usage, an unreachable origin ======================================================
fx c16
ok "$(python3 "$LI" stamp | grep -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$')" 1 "C16: stamp prints reconcile's _stamp form"
python3 "$LI" >/dev/null 2>&1; ok "$?" 2 "C16: no verb → exit 2"
python3 "$LI" push --repo "$R" --slug "$SLUG" --head zz >/dev/null 2>&1; ok "$?" 2 "C16: a bad sha → exit 2"
python3 "$LI" inputs --note "$F/nope.md" >/dev/null 2>&1; ok "$?" 2 "C16: a missing note → exit 2"
python3 "$LI" verify --tree "$WT" --out "$F/x" --timeout 5 >/dev/null 2>&1; ok "$?" 2 "C16: verify without --verifier → exit 2"
printf '' | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind own >/dev/null 2>&1; ok "$?" 2 "C16: set-aside with an empty reason → exit 2"
git -C "$R" remote set-url origin "$F/nowhere.git"
prep
ok "$prc|$J" "8|" "C16: an unreachable origin → prepare exit 8, nothing printed"
has "$(cat "$F/prep.err")" "fetch origin failed twice" "C16: … naming the failed fetch"

# ======== C17: timeouts, signals, the bootstrap after the merge, the race tree =============================
fx c17
# The sleepers carry this run's marker, its PID zero-padded (so no PID is a prefix of another) as the duration's
# fraction: a rollout runs this suite in several worktrees at once, and a machine-wide pgrep on a bare duration
# counted their sleepers as this run's survivors (2026-10-15, p20-2: "expected [0] got [4]").
u=$(printf %07d $$)
# Structural, not a stopwatch (p22-1): a rollout at ceiling 4 loads the host to ~150, and the old "within 15 s"
# bound went red there on correct code. The sleepers sleep 3171 s+, so only verify's kill can end them, and a
# verify that waited for them could not return before they did: the bounds below (300 s for verify to return or
# its children to start, 60 s for a killed child to vanish) are generous, never tight, and still fail a verify
# that waits for its children, or one that leaves a child alive.
# within <s> <cmd…>: poll <cmd> every 0.1 s until it succeeds (0) or <s> s of wall clock pass (1).
within() { local end=$((SECONDS + $1)); shift; until "$@" 2>/dev/null; do [ "$SECONDS" -ge "$end" ] && return 1; sleep 0.1; done; }
gone() { ! kill -0 "$1"; }
sleepers() { pgrep -f "$1" | wc -l | tr -d ' '; }
nosleeper() { [ "$(sleepers "$1")" = 0 ]; }
python3 "$LI" verify --tree "$WT" --out "$F/out/v" --timeout 2 --verifier "sleep 3171.$u & sleep 3172.$u; wait" >/dev/null &
vp=$!
if within 300 gone "$vp"; then st=returned; else st="still running after 300 s"; kill -TERM "$vp"; fi; wait "$vp"
ok "$(cat "$F/out/v.rc")" 124 "C17: the deadline → rc 124"
ok "$st" returned "C17: … verify returns at its deadline, not when its verifier's children would"
within 60 nosleeper "sleep 317[12]\.$u"
ok "$(sleepers "sleep 317[12]\.$u")" 0 "C17: no verifier child survives"
has "$(cat "$F/out/v.log")" "timed out after 2s" "C17: the log names the timeout"
python3 "$LI" verify --tree "$WT" --out "$F/out/t" --timeout 600 --verifier "sleep 3173.$u & sleep 3174.$u; wait" >/dev/null &
vp=$!
started() { grep -q '== verifier:' "$F/out/t.log" && [ "$(sleepers "sleep 317[34]\.$u\$")" -ge 1 ]; }
within 300 started && st=started || st="not started after 300 s"
ok "$st" started "C17: the verifier's children run before the TERM"
kill -TERM "$vp"; wait "$vp"
ok "$(cat "$F/out/t.rc")" 143 "C17: TERM to verify → rc 143"
within 60 nosleeper "sleep 317[34]\.$u"
ok "$(sleepers "sleep 317[34]\.$u")" 0 "C17: … and its children are gone"
main from-main.txt "dep" "theirs: dep (#7)"
prep; M=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" verify --tree "$WT" --out "$F/out/b" --timeout 60 --bootstrap 'test -f from-main.txt && touch .boot-ok' --verifier 'test -f .boot-ok && echo verified' >/dev/null
ok "$(cat "$F/out/b.rc")" 0 "C17: the bootstrap runs after the merge checkout (it needs main's file), then the verifier"
python3 "$LI" verify --tree "$WT" --out "$F/out/b2" --timeout 60 --bootstrap 'exit 3' --verifier 'touch .verifier-ran' >/dev/null
ok "$(cat "$F/out/b2.rc")|$([ -e "$WT/.verifier-ran" ] && echo ran || echo skipped)" "3|skipped" "C17: a failing bootstrap → its rc; the verifier never runs"
has "$(cat "$F/out/b2.log")" "env_bootstrap failed; verifier not run" "C17: … and the log says so"
BT="$F/boot-gone"; mkdir -p "$BT"
python3 "$LI" verify --tree "$BT" --out "$F/out/b3" --timeout 60 --bootstrap "cd / && rm -rf '$BT'" --verifier true >/dev/null 2>&1
ok "$([ -e "$F/out/b3.rc" ] && cat "$F/out/b3.rc" || echo none)" "none" "C17: a green bootstrap, then a verifier step that never starts → no rc (red), never the bootstrap's 0"
RT="$R/.claude/worktrees/race-$SLUG"
python3 "$LI" verify --repo "$R" --detach-at "$M" --tree "$RT" --out "$F/out/race" --timeout 60 --verifier 'test -f from-main.txt && false' >/dev/null
ok "$(cat "$F/out/race.rc")|$([ -e "$RT" ] && echo left || echo removed)" "1|removed" "C17: --detach-at verifies the race tree and removes it, even on red"
lacks "$(git -C "$R" worktree list)" "race-$SLUG" "C17: … unregistered too"
mkdir -p "$RT"
python3 "$LI" verify --repo "$R" --detach-at "$M" --tree "$RT" --out "$F/out/race2" --timeout 60 --verifier true >/dev/null 2>&1
ok "$?|$([ -e "$F/out/race2.rc" ] && echo rc || echo none)" "2|none" "C17: --detach-at refuses an existing path (no rc: red)"
rmdir "$RT"
# A killed re-verify leaves its tree's registration locked with a dead pid; once the directory is gone, the next
# re-verify at the same path unlocks and prunes it rather than wedging on "missing but locked worktree".
git -C "$R" worktree add -q --lock --reason "pid 1" --detach "$RT" "$M" && rm -rf "$RT"
python3 "$LI" verify --repo "$R" --detach-at "$M" --tree "$RT" --out "$F/out/race3" --timeout 60 --verifier true >/dev/null 2>&1
ok "$?|$(cat "$F/out/race3.rc" 2>/dev/null)" "0|0" "C17: a dead re-verify's locked registration (directory gone) is cleared, and the re-verify runs"

# ======== C18: no relaunch loop ===========================================================================
nfx c18 4
ntask proj-a review "pr: $(p1pr proj-a)" 'review_rounds_used: 1'
rec "$(erow "$(p1args proj-a 3)" "$(judge_changes proj-a 2)")"
ok "$(j "$(inp proj-a --max-review-rounds 3)" 'd["autoRevise"]')" true "C18a: a plain rejection with rounds left → true"
ok "$(j "$(inp proj-a)" 'd["autoRevise"]')" false "C18f: no --max-review-rounds → false"
ok "$(j "$(inp proj-a --max-review-rounds 2)" 'd["autoRevise"]')" false "C18d: --max-review-rounds = lastRound → false"
# (b) the seeded revise it launches stops blocked
I=$(inp proj-a --max-review-rounds 3)
SARGS=$(python3 - "$I" "$(p1pr proj-a)" <<'PY'
import json, sys
i = json.loads(sys.argv[1])
print(json.dumps({"rolloutSlug": "ro", "repoPath": "/repo", "verifier": "true", "date": "2026-10-02",
  "verifySlot": {"script": "/plugins/thread/x/skills/execute/scripts/verify-slot.py", "slots": 2},
  "task": {"slug": "proj-a", "taskPath": "", "scope": "cross-cutting", "planGate": False, "maxIterations": 3, "maxReviewRounds": 3,
           "maxPlanRounds": 3, "rung": "opus-xhigh", "resume": {"stage": "revise", "prUrl": sys.argv[2], "branch": i["branch"],
           "worktreePath": "/repo/.claude/worktrees/proj-a", "reviewHistory": i["history"], "reviewRoundsUsed": i["lastRound"], "plan": ""}}}))
PY
)
STUB=$(printf '{"revise:proj-a r3":{"verified":false,"blocked":true,"escalate":false,"prUrl":"%s","branch":"audit-fix/a","worktreePath":"/repo/.claude/worktrees/proj-a","blockerDiagnosis":"red after 3 iterations","summary":""}}' "$(p1pr proj-a)")
setkey "$V/proj-a.md" status in_progress
rec "$(erow "$SARGS" "$STUB")" 2026-10-02T12:20:00Z
I=$(inp proj-a --max-review-rounds 4)
ok "$(j "$I" '[d["markerStage"], d["markerReason"], d["autoRevise"]]')|$(setaside_at proj-a)" '["revise","red after 3 iterations",false]|run' "C18b: a seeded revise that stopped → markerReason set, false, still set aside at run"
# (c) a last-round rejection is review-blocked
ntask proj-b review "pr: $(p1pr proj-b)" 'review_rounds_used: 1'
rec "$(erow "$(p1args proj-b 2)" "$(judge_changes proj-b 2)")"
ok "$(fm "$V/proj-b.md" status)|$(j "$(inp proj-b --max-review-rounds 5)" 'd["autoRevise"]')" "status: review-blocked|false" "C18c: a last-round rejection → review-blocked, never auto"
# (e) a stale marker: the last log line is no longer rejected
ntask proj-c review "pr: $(p1pr proj-c)" 'review_rounds_used: 1'
rec "$(erow "$(p1args proj-c 3)" "$(judge_changes proj-c 2)")"
printf '2026-10-02T13:00+00:00 integrated path=lead pr=1 anchor=- head=- base=- wait=- duration=- triggers=-\n' >> "$V/proj-c.md"
ok "$(j "$(inp proj-c --max-review-rounds 3)" 'd["autoRevise"]')" false "C18e: the last line integrated → false"

# ======== C19: an Integration set-aside re-enters through hand-back ======================================
nfx c19 2
ntask proj-a review "pr: $(p1pr proj-a)"
rec "$(python3 -c 'import json,sys; print(json.dumps({"rolloutSlug":"ro","tasks":[{"slug":"proj-a","scope":"cross-cutting","status":"blocked","prUrl":sys.argv[1],"blockerDiagnosis":"integration: merge step STOP: fetch origin failed twice"}]}))' "$(p1pr proj-a)")"
ok "$(j "$(nxt "")" 'd["halt"]')" stuck "C19: alone and set aside at Integration → halt stuck"
python3 "$RR" hand-back --tasks proj-a --tasks-dir "$V" >/dev/null
ok "$(j "$(nxt "")" '[d["awaitingIntegration"], d["halt"]]')" '[["proj-a"],null]' "C19: hand-back → awaiting Integration, no halt"
python3 "$RR" mark-integrating --tasks proj-a --tasks-dir "$V" >/dev/null
ok "$(j "$(nxt "")" '[d["integrating"], d["halt"]]')" '[["proj-a"],null]' "C19: mark-integrating → integrating, no halt"
fx c19g
addlog "$V/$SLUG.md" "2026-10-02T11:30+00:00 set-aside path=integrator pr=5 anchor=$H0 head=$H0 base=$TB wait=- duration=- triggers=-"
prep
ok "$(j "$J" 'd["case"]')|$(j "$J" 'd["route"]')" "i|merge" "C19: a set-aside line with H == A → case (i)"
main a.txt "$(printf 'a1\na2\na3\na4\nA5 theirs')"
onbranch merge --no-ff --no-edit -m "Merge origin/master into $BR (Integration)" origin/master
M1=$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")
sed -i.bak "s/ head=$H0 base=$TB / head=$M1 base=$B /" "$V/$SLUG.md"
prep
ok "$(j "$J" 'd["case"]')|$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "null|trouble|[]" "C19: a set-aside line whose head is the PR head is never case (ii)"

# ======== C20: the last task left is rejected ==============================================================
nfx c20 2
ntask proj-x done; ntask proj-y done
ntask proj-a review "pr: $(p1pr proj-a)" 'integrating: 2026-10-02T12:00+00:00' 'review_rounds_used: 1'
rec "$(erow "$(p1args proj-a 3)" "$(judge_changes proj-a 2)")"
NX=$(nxt "")
ok "$(j "$NX" '[d["halt"], d["setAside"], d["slotsInUse"], d["start"], d["restart"], d["running"], d["awaitingIntegration"], d["integrating"]]')" \
  '["stuck",[{"slug":"proj-a","status":"blocked","setAsideAt":"run"}],0,[],[],[],[],[]]' "C20: the first next says stuck — the output step 1.1 must not act on"
ok "$(j "$(inp proj-a --max-review-rounds 3)" 'd["autoRevise"]')" true "C20: inputs → autoRevise true"
setkey "$V/proj-a.md" status in_progress; setkey "$V/proj-a.md" owner execute-c20
python3 "$RR" mark-started --tasks proj-a --tasks-dir "$V" >/dev/null
NX=$(nxt proj-a)
ok "$(j "$NX" '[d["halt"], d["running"], d["slotsInUse"]]')" '[null,["proj-a"],1]' "C20: after the seeded revise launches, next --running A: no halt, A running, 1 slot"

# ======== C21: plan — the approved plan for the seeded revise (p14-2) ======================================
nfx c21 2
ntask proj-a in_progress 'owner: execute-c21'
PL=$(python3 "$LI" plan --note "$V/proj-a.md")
ok "$(j "$PL" 'sorted(d)')|$(j "$PL" 'd["plan"]')|$(j "$PL" 'd["slug"]')" '["plan","slug"]||proj-a' "C21: no section → plan \"\", and the keys are exactly plan and slug"
C21P=$(printf 'Planned on: abc\n### Files to modify\n- x.py\n\n> a quote\n### Gated inputs\nNone')
python3 - "$C21P" <<'PY' > "$tmp/c21-row.json"
import json, sys
print(json.dumps({"rolloutSlug": "ro", "tasks": [{"slug": "proj-a", "scope": "cross-cutting", "status": "review",
  "prUrl": "https://github.com/o/r/pull/97", "reviewRoundsUsed": 1, "plan": sys.argv[1]}]}))
PY
rec "$(cat "$tmp/c21-row.json")"
ok "$(j "$(python3 "$LI" plan --note "$V/proj-a.md")" 'd["plan"]')" "$C21P" "C21: a reconciled plan reads back exactly"
rec '{"rolloutSlug": "ro", "tasks": [{"slug": "proj-a", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/97", "reviewRoundsUsed": 1, "plan": ""}]}'
ok "$(j "$(python3 "$LI" plan --note "$V/proj-a.md")" 'd["plan"]')|$(grep -c '^## Approved plan' "$V/proj-a.md")" "|0" "C21: a '' row removed it → plan \"\""
python3 "$LI" plan --note "$V/proj-zz.md" >/dev/null 2>&1; ok "$?" 2 "C21: a missing note exits 2"

# ======== C22: inputs --row — the integrate call's record, the approving row checked against the note (p17-1) ======
# The incident: after a session limit a saved transient row (blocked, no PR, 0 rounds) was taken as the approving
# row. `inputs --row` uses a row only when it matches the note and passes the engine's args check, else the note's.
nfx c22 2
ntask proj-a review "pr: $(p1pr proj-a)" 'review_rounds_used: 2' 'rung: opus-high'
ntask proj-b review 'review_rounds_used: 1'
ntask proj-c review 'pr: "#99"' 'review_rounds_used: 1'
ntask proj-d review 'pr: https://github.com/O/R/pull/100/' 'review_rounds_used: 1'
PRA=$(p1pr proj-a)
python3 - "$F" "$PRA" <<'PY'
import json, sys
d, pr = sys.argv[1], sys.argv[2]
H = [{"round": 1, "feedback": ["x"]}, {"round": 3, "feedback": ["keep theirs"], "stage": "integration"}]
RUNG = {"startRung": "opus-high", "rung": "opus-xhigh", "climbs": [{"stage": "implement", "from": "opus-high", "to": "opus-xhigh"}]}
good = {"slug": "proj-a", "scope": "cross-cutting", "status": "review", "prUrl": pr, "reviewRoundsUsed": 3, "reviewHistory": H, **RUNG}
env = lambda *rows: {"rolloutSlug": "ro", "tasks": list(rows)}
rows = {
  "incident": env({"slug": "proj-a", "scope": "cross-cutting", "status": "blocked", "prUrl": "", "reviewRoundsUsed": 0, "reviewHistory": []}),
  "noprurl": env({**good, "prUrl": ""}),
  "otherslug": {**good, "slug": "proj-b"},
  "otherenv": env({**good, "slug": "proj-b"}),
  "dup": env(good, {**good, "slug": "PROJ-A"}),
  "otherpr": env({**good, "prUrl": pr.rsplit("/", 1)[0] + "/99"}),
  "belownote": env({**good, "reviewRoundsUsed": 1, "reviewHistory": []}),
  "desc": env({**good, "reviewHistory": [{"round": 2, "feedback": ["a"]}, {"round": 1, "feedback": ["b"]}]}),
  "nonstr": env({**good, "reviewHistory": [{"round": 1, "feedback": [1]}]}),
  "stage": env({**good, "reviewHistory": [{"round": 1, "feedback": ["a"], "stage": "x"}]}),
  "belowhist": env({**good, "reviewRoundsUsed": 2}),
  "boolround": env({**good, "reviewHistory": [{"round": True, "feedback": ["a"]}]}),
  "slash": env({**good, "prUrl": pr + "/"}),
  "badrung": env({**good, "rung": "Opus!"}),
  "good": env({"slug": "proj-x", "status": "review"}, good),
  "bare": good,
  "nopr": env({**good, "slug": "proj-b", "reviewRoundsUsed": 1, "reviewHistory": []}),
  "bynum": env({**good, "slug": "proj-c", "prUrl": "https://github.com/o/r/pull/99", "reviewRoundsUsed": 1, "reviewHistory": []}),
  "bynumbad": env({**good, "slug": "proj-c", "prUrl": "https://github.com/o/r/pull/98", "reviewRoundsUsed": 1, "reviewHistory": []}),
  "byurl": env({**good, "slug": "proj-d", "prUrl": "https://github.com/o/r/pull/100", "reviewRoundsUsed": 1, "reviewHistory": []}),
}
for k, v in rows.items():
    json.dump(v, open(f"{d}/{k}.json", "w"))
open(f"{d}/malformed.json", "w").write("{not json")
json.dump(H, open(f"{d}/H.json", "w")); json.dump(RUNG, open(f"{d}/RUNG.json", "w"))
PY
RECS="$F/recs.jsonl"; : > "$RECS"
# irow <note slug> <inputs args…>: inputs' integrate record as IG (exit in irc); every proj-a record is kept for the
# engine's args check below.
irow() { local s="$1"; shift; I=$(python3 "$LI" inputs --note "$V/$s.md" "$@" 2>"$F/irow.err"); irc=$?; IG=$(j "$I" 'd["integrate"]' 2>/dev/null); [ "$s" != proj-a ] || printf '%s\n' "$IG" >> "$RECS"; }
NOTE_RUNG='{"startRung":"","rung":"opus-high","climbs":[]}'
irow proj-a
ok "$irc|$(j "$IG" 'sorted(d)')" '0|["prUrl","prUrlError","reviewHistory","reviewRoundsUsed","rowRefused","rung","rungSource","source"]' "C22: inputs prints the integrate record, with exactly its keys"
ok "$(j "$IG" '[d["source"], d["rungSource"], d["prUrl"], d["reviewHistory"], d["reviewRoundsUsed"], d["rowRefused"], d["prUrlError"]]')|$(j "$IG" 'd["rung"]')" \
  "[\"note\",\"note\",\"$PRA\",[],2,\"\",\"\"]|$NOTE_RUNG" "C22: no --row → the note's PR, history, rounds and rung record; rowRefused and prUrlError \"\""
irow proj-a --row "$F/incident.json"
ok "$irc|$(j "$IG" '[d["source"], d["prUrl"], d["reviewRoundsUsed"], d["reviewHistory"]]')|$(j "$IG" 'd["rung"]')" "0|[\"note\",\"$PRA\",2,[]]|$NOTE_RUNG" "C22: the incident's saved row (blocked, no PR, 0 rounds) is refused: the note's values"
has "$(j "$IG" 'd["rowRefused"]')" "status" "C22: … rowRefused names its status"
irow proj-a --row "$F/noprurl.json"
ok "$(j "$IG" 'd["source"]')" note "C22: a review row with prUrl \"\" is refused"
has "$(j "$IG" 'd["rowRefused"]')" "prUrl" "C22: … rowRefused names its prUrl"
for kw in "otherslug:slug" "otherenv:0 entries" "dup:2 entries" "otherpr:/pull/99" "belownote:review_rounds_used" "desc:ascending" \
  "nonstr:feedback" "stage:stage" "belowhist:last round" "boolround:round" "slash:prUrl"; do
  k=${kw%%:*}; want=${kw#*:}
  irow proj-a --row "$F/$k.json"
  ok "$irc|$(j "$IG" '[d["source"], d["prUrl"], d["reviewRoundsUsed"]]')" "0|[\"note\",\"$PRA\",2]" "C22: the $k row is refused: the note's values"
  has "$(j "$IG" 'd["rowRefused"]')" "$want" "C22: … rowRefused: $want"
done
for k in "$F/malformed.json" "$F/missing.json"; do
  irow proj-a --row "$k"
  ok "$irc|$(j "$IG" '[d["source"], d["rowRefused"] != ""]')" '0|["note",true]' "C22: an unreadable --row ($(basename "$k")) is refused with a reason, exit 0"
done
I=$(python3 "$LI" inputs --note "$V/proj-a.md" --row - </dev/null); irc=$?
ok "$irc|$(j "$I" '[d["integrate"]["source"], d["integrate"]["rowRefused"] != ""]')" '0|["note",true]' "C22: --row - with empty stdin is refused with a reason, exit 0"
irow proj-a --row "$F/badrung.json"
ok "$(j "$IG" '[d["source"], d["rungSource"], d["reviewRoundsUsed"]]')|$(j "$IG" 'd["rung"]')" "[\"row\",\"note\",3]|$NOTE_RUNG" "C22: a row with a bad rung record keeps the row and takes the note's rung record"
has "$(j "$IG" 'd["rowRefused"]')" "rung" "C22: … rowRefused names the rung record"
H22=$(j "$(cat "$F/H.json")" 'd'); RUNG22=$(j "$(cat "$F/RUNG.json")" 'd')
for form in good bare stdin; do
  if [ "$form" = stdin ]; then I=$(python3 "$LI" inputs --note "$V/proj-a.md" --row - <"$F/good.json"); irc=$?; IG=$(j "$I" 'd["integrate"]'); printf '%s\n' "$IG" >> "$RECS"
  else irow proj-a --row "$F/$form.json"; fi
  ok "$irc|$(j "$IG" '[d["source"], d["rungSource"], d["prUrl"], d["reviewRoundsUsed"], d["rowRefused"]]')|$(j "$IG" 'd["reviewHistory"]')|$(j "$IG" 'd["rung"]')" \
    "0|[\"row\",\"row\",\"$PRA\",3,\"\"]|$H22|$RUNG22" "C22: an approving row that matches the note ($form) is used verbatim"
done
irow proj-b --row "$F/nopr.json"
ok "$(j "$IG" '[d["source"], d["prUrl"]]')" '["note",null]' "C22: a note with no pr: refuses the row; prUrl null"
has "$(j "$IG" 'd["prUrlError"]')" "no pr:" "C22: … and prUrlError says the note has no pr:"
irow proj-c --row "$F/bynum.json"
ok "$(j "$IG" '[d["source"], d["prUrl"], d["prUrlError"]]')" '["row","https://github.com/o/r/pull/99",""]' "C22: a bare-number note pr: matches the row's PR by number; prUrlError \"\""
irow proj-c --row "$F/bynumbad.json"
ok "$(j "$IG" 'd["source"]')" note "C22: … and refuses another number"
irow proj-d --row "$F/byurl.json"
ok "$(j "$IG" 'd["source"]')" row "C22: a note pr: URL matches with one trailing / and case ignored"
# The note's fallback prUrl is a PR URL the engine takes (prIdentityError), never a hand-written bare `#N`: one is
# built on --repo's GitHub origin; with no --repo or no GitHub origin prUrl stays and prUrlError says why (the lead
# sets the task aside at Integration on it, and step 1.2 launches no seeded revise on it, never a call the engine
# would refuse as a Lost call). inputs' own prUrl and prUrlError, step 1.2's, are the same.
g init -q "$F/gh"; git -C "$F/gh" remote add origin https://github.com/o/r.git
g init -q "$F/local"; git -C "$F/local" remote add origin "$F/nowhere.git"
irow proj-c
ok "$(j "$IG" '[d["source"], d["prUrl"]]')" '["note","#99"]' "C22: a bare #99 with no --repo keeps the note's value"
has "$(j "$IG" 'd["prUrlError"]')" "bare number and no --repo was given" "C22: … and prUrlError names the bare number and the missing --repo"
irow proj-c --repo "$F/local"
ok "$(j "$IG" '[d["source"], d["prUrl"]]')" '["note","#99"]' "C22: a bare #99 with a non-GitHub origin keeps the note's value"
has "$(j "$IG" 'd["prUrlError"]')" "has no GitHub origin" "C22: … and prUrlError names the origin"
C22B=()
for args in "" "--row $F/bynumbad.json"; do
  irow proj-c --repo "$F/gh" $args; C22B+=("$IG")
  ok "$(j "$IG" '[d["source"], d["prUrl"], d["prUrlError"]]')" '["note","https://github.com/o/r/pull/99",""]' "C22: a bare #99 with a GitHub origin is built into its PR URL (${args:+a refused row}${args:-no --row})"
done
ok "$(j "$I" '[d["pr"], d["prUrl"], d["prUrlError"]]')" '["#99","https://github.com/o/r/pull/99",""]' \
  "C22: inputs' own prUrl (step 1.2's seeded revise passes it) is the same built URL; pr stays the note's"
irow proj-c
ok "$(j "$I" '[d["prUrl"], d["prUrlError"] == d["integrate"]["prUrlError"] != ""]')" '["#99",true]' "C22: … and with no --repo, inputs' own prUrlError is the record's"
irow proj-d
ok "$(j "$IG" '[d["source"], d["prUrl"], d["prUrlError"]]')" '["note","https://github.com/O/R/pull/100",""]' "C22: a note pr: URL's trailing / is dropped"
PRE=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['PR_URL'])
  process.stdout.write(JSON.stringify([...process.argv.slice(1).map((r) => T.PR_URL.test(JSON.parse(r).prUrl)), T.PR_URL.test('#99')]))
" "${C22B[@]}" "$IG")
ok "$PRE" '[true,true,true,false]' "C22: every built prUrl passes the engine's PR_URL, which refuses the bare #99"
# the engine's args check: every record inputs emitted for proj-a passes integrationArgsError; the refused rows' raw
# fields fail it (so the record never carries them), and the bad rung fails rungRecordError.
PAR=$(node --input-type=module -e "
  import fs from 'node:fs'
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['integrationArgsError', 'historyError', 'rungRecordError', 'PR_URL'])
  const [a, recs, dir] = [JSON.parse(process.argv[1]), fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), process.argv[3]]
  const err = (o) => { const x = JSON.parse(JSON.stringify(a)); Object.assign(x.integration, o); return T.integrationArgsError(x) }
  const row = (k) => { const v = JSON.parse(fs.readFileSync(dir + '/' + k + '.json', 'utf8')); return v.tasks ? v.tasks[0] : v }
  const raw = (r) => err({ prUrl: r.prUrl, reviewHistory: r.reviewHistory, reviewRoundsUsed: r.reviewRoundsUsed })
  const bad = row('badrung')
  process.stdout.write(JSON.stringify([
    recs.length, recs.map((r) => err({ prUrl: r.prUrl, reviewHistory: r.reviewHistory, reviewRoundsUsed: r.reviewRoundsUsed, rung: r.rung })).filter((e) => e),
    ['desc', 'nonstr', 'stage', 'belowhist', 'boolround', 'slash'].filter((k) => raw(row(k)) === ''),
    T.rungRecordError({ startRung: bad.startRung, rung: bad.rung, climbs: bad.climbs }) !== '',
  ]))
" "$(p1args proj-a 3)" "$RECS" "$F")
ok "$PAR" '[20,[],[],true]' "C22: all 20 proj-a records pass integrationArgsError; each refused row's raw fields fail it; the bad rung fails rungRecordError"

# ======== C23: a signal while a step starts; the step's and verify's own signal mask (p22-2) ================
# _run_step holds TERM/INT/HUP from just before Popen until _live records the new group (a signal in that window
# used to leave the verifier's own session running with no limit), restores the caller's mask in the child
# (preexec_fn) and in verify. Every check is structural (a pid, a file the trap writes, the mask), never a stopwatch:
# like C17's, the only bounds (300 s for a step to start, 60 s for a killed sleeper to vanish) are generous and only
# slow a real failure, never fail a correct one on a loaded host.
fx c23
u=$(printf %07d $$)
T="$F/steptree"; mkdir -p "$T"
# reaped <pid>: C17's within/gone on the sleeper the step recorded. A survivor sleeps ~53 min, so it is then
# SIGKILLed by that recorded pid (plain TERM would not do: the regression the trap check below catches leaves TERM
# blocked in the step), and the suite never leaks it.
reaped() {
  [ -n "$1" ] || { echo "no pid"; return; }
  if within 60 gone "$1"; then echo gone; else kill -KILL "$1" 2>/dev/null; echo survived; fi
}
# LATE: run lead-integrate's main with a Popen that, once the verifier's `bash -c` has started and written its
# sleeper's pid (waited for up to 300 s, as C17 waits), sends SIGTERM to this process before Popen returns: the
# Popen-to-_live window. The deadline lies past that wait, so only the SIGTERM can end the step.
LATE='
import importlib.util, os, signal, subprocess, sys, time
spec = importlib.util.spec_from_file_location("lead_integrate", sys.argv[1])
li = importlib.util.module_from_spec(spec)
spec.loader.exec_module(li)
class Late(subprocess.Popen):
    def __init__(self, args, *a, **k):
        super().__init__(args, *a, **k)
        if list(args[:2]) == ["bash", "-c"]:
            pid = os.path.join(k.get("cwd") or ".", "pid")
            end = time.monotonic() + 300
            while time.monotonic() < end:
                try:
                    if open(pid).read().strip():
                        break
                except OSError:
                    pass
                time.sleep(0.05)
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(0.5)
subprocess.Popen = Late
sys.exit(li.main(sys.argv[2:]))
'
python3 -B -c "$LATE" "$LI" verify --tree "$T" --out "$F/out/late" --timeout 600 --verifier "sleep 3181.$u & echo \$! > pid; wait" >/dev/null
ok "$(cat "$F/out/late.rc" 2>/dev/null)" 143 "C23: SIGTERM between Popen and _live → rc 143"
has "$(cat "$F/out/late.log" 2>/dev/null)" "stopped by signal 15" "C23: … the log names the signal"
ok "$(reaped "$(cat "$T/pid" 2>/dev/null)")" gone "C23: … and the step's group is killed (its sleeper is gone)"
# TRAP: verify in the background, its deadline never reached; once the step has set its TERM trap and started its
# sleeper (tpid written), verify gets SIGTERM and _kill_group SIGTERMs the group. The trap runs only if the step
# started with TERM unblocked.
python3 "$LI" verify --tree "$T" --out "$F/out/trap" --timeout 600 \
  --verifier "trap 'echo term > got; exit 0' TERM; sleep 3182.$u & echo \$! > tpid; wait" >/dev/null &
vp=$!
trapset() { [ -s "$T/tpid" ]; }
within 300 trapset && st=started || st="not started after 300 s"
ok "$st" started "C23: the step has set its TERM trap and started its sleeper before the TERM"
kill -TERM "$vp"; wait "$vp"
ok "$(cat "$F/out/trap.rc" 2>/dev/null)" 143 "C23: TERM to verify mid-step → rc 143"
ok "$(cat "$T/got" 2>/dev/null)" term "C23: the step starts with TERM unblocked (its trap runs on the group's SIGTERM)"
ok "$(reaped "$(cat "$T/tpid" 2>/dev/null)")" gone "C23: … and its sleeper is gone"
# MASK: one _run_step, then verify's own mask: TERM/INT/HUP no longer held, and whatever the caller had blocked
# before (its own SIGUSR1, or SIGTERM itself) still held: SIG_SETMASK to the old mask, not an UNBLOCK of SIGNALS.
MASK='
import importlib.util, signal, sys, time
spec = importlib.util.spec_from_file_location("lead_integrate", sys.argv[1])
li = importlib.util.module_from_spec(spec)
spec.loader.exec_module(li)
signal.pthread_sigmask(signal.SIG_BLOCK, {"usr1": [signal.SIGUSR1], "term": [signal.SIGTERM]}.get(sys.argv[4], []))
rc = li._run_step("true", sys.argv[2], open(sys.argv[3], "ab", buffering=0), time.monotonic() + 600)
held = set(signal.pthread_sigmask(signal.SIG_BLOCK, []))
print(f"{rc}|{sorted(int(s) for s in held & {signal.SIGTERM, signal.SIGINT, signal.SIGHUP})}|{signal.SIGUSR1 in held}")
'
ok "$(python3 -B -c "$MASK" "$LI" "$T" "$F/out/mask.log" none)" "0|[]|False" "C23: after a step, verify holds none of TERM/INT/HUP"
ok "$(python3 -B -c "$MASK" "$LI" "$T" "$F/out/mask.log" usr1)" "0|[]|True" "C23: … and a caller's own blocked SIGUSR1 stays blocked (the old mask is restored, not cleared)"
ok "$(python3 -B -c "$MASK" "$LI" "$T" "$F/out/mask.log" term)" "0|[15]|False" "C23: … and a caller's own blocked SIGTERM stays blocked (SIG_SETMASK to the old mask, not SIG_UNBLOCK of TERM/INT/HUP)"

# ======== C24–C28, C17s, C23s: the verify slots (p23-4) ====================================================
# verify --slots N --slot-wait S waits for one of the machine's N verify slots (here a temp pool, merge-task-env.sh)
# as an Integration waiter, BEFORE its --timeout deadline starts, and runs each step under verify-slot.py's guard.
# Structural, never a stopwatch (p22-1): holders hold until a .go file appears, every wait is a generous `within`
# poll, and every background pid is recorded and stopped only by that pid.
fx c24
u=$(printf %07d $$)
VSL="$root/skills/execute/scripts/verify-slot.py"
T="$F/slottree"; mkdir -p "$T"
vpids=()
# vhold <name>: hold the pool's only slot (run --slots 1) until <name>.go; the wrapper's pid in <name>.w.
vhold() {
  python3 "$VSL" run --slots 1 -- sh -c "echo \$\$ > '$F/$1.pid'; until [ -e '$F/$1.go' ]; do sleep 0.1; done" > /dev/null 2>&1 &
  echo $! > "$F/$1.w"; vpids+=($!)
  within 300 test -s "$F/$1.pid" || echo "FAIL - $1: the holder did not start within 300 s"
}
vstate() { python3 "$VSL" status --slots 1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["slots"][0]["state"])'; }
vfree() { [ "$(vstate)" = free ]; }
vwaiters() { ls "$THREAD_VERIFY_SLOTS_DIR" 2>/dev/null | grep -c '^waiter-.*\.wait$'; }
haswaiter() { [ "$(vwaiters)" -ge 1 ]; }
# alive <pid>: kill -0 succeeds AND ps shows a state that is not Z (an unreaped zombie runs nothing).
alive() { local s; kill -0 "$1" 2>/dev/null && s=$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ') && [ -n "$s" ] && [ "${s#Z}" = "$s" ]; }
vgone() { ! alive "$1"; }
# C24: the slot wait is excluded from the deadline. The only slot is held; verify --timeout 10 waits behind it. Only
# once at least 12 s have passed since verify started (a lower bound on time, never an upper one) is the slot freed:
# had the wait counted, the 10 s deadline would already be gone and the rc would deterministically be 124.
vhold h24
t0=$SECONDS
python3 "$LI" verify --tree "$T" --out "$F/out/c24" --timeout 10 --slots 1 --slot-wait 600 --verifier true > /dev/null 2>&1 &
vp=$!; vpids+=($vp)
within 300 grep -q 'waiting for one of 1' "$F/out/c24.log" && st=waiting || st="no waiting line in 300 s"
ok "$st" waiting "C24: verify --slots 1 waits behind the held slot (its waiting line in the log)"
until [ $((SECONDS - t0)) -ge 12 ]; do sleep 0.2; done
touch "$F/h24.go"
within 300 test -s "$F/out/c24.rc"; wait "$vp"
ok "$(cat "$F/out/c24.rc" 2>/dev/null)" 0 "C24: green after a wait longer than --timeout: the wait never counts against the deadline"
has "$(cat "$F/out/c24.log")" "== verify slot 1 of 1 after" "C24: … the log names the slot it got"
wait "$(cat "$F/h24.w")"
# C25: no slot within --slot-wait → `noslot`, exit 75, the verifier never ran; the race tree is still removed.
vhold h25
python3 "$LI" verify --tree "$T" --out "$F/out/c25" --timeout 60 --slots 1 --slot-wait 1 --verifier 'touch .verifier-ran' > /dev/null 2>&1
rc=$?
ok "$rc|$(cat "$F/out/c25.rc" 2>/dev/null)" "75|noslot" "C25: no verify slot within --slot-wait → exit 75, rc file noslot"
has "$(cat "$F/out/c25.log")" "no verify slot within 1s" "C25: … the log says so"
lacks "$(cat "$F/out/c25.log")" "== verifier:" "C25: … the verifier never started"
ok "$([ -e "$T/.verifier-ran" ] && echo ran || echo never)" never "C25: … and never ran"
main c25.txt "c25" "theirs: c25 (#8)"
prep; M25=$(j "$J" 'd["mergeCommit"]')
RT="$R/.claude/worktrees/race-$SLUG"
python3 "$LI" verify --repo "$R" --detach-at "$M25" --tree "$RT" --out "$F/out/c25r" --timeout 60 --slots 1 --slot-wait 1 --verifier true > /dev/null 2>&1
ok "$?|$(cat "$F/out/c25r.rc" 2>/dev/null)|$([ -e "$RT" ] && echo left || echo removed)" "75|noslot|removed" "C25: --detach-at with no slot → noslot, the race tree removed"
lacks "$(git -C "$R" worktree list)" "race-$SLUG" "C25: … and unregistered"
# C26: TERM while waiting for a slot → 143, the verifier never ran, no waiter file left.
python3 "$LI" verify --tree "$T" --out "$F/out/c26" --timeout 60 --slots 1 --slot-wait 600 --verifier 'touch .c26-ran' > /dev/null 2>&1 &
vp=$!; vpids+=($vp)
within 300 haswaiter && st=waiting || st="no waiter file in 300 s"
ok "$st" waiting "C26: the waiting verify registers as an Integration waiter"
kill -TERM "$vp"; wait "$vp"
ok "$(cat "$F/out/c26.rc" 2>/dev/null)|$([ -e "$T/.c26-ran" ] && echo ran || echo never)|$(vwaiters)" "143|never|0" "C26: TERM during the wait → rc 143, the verifier never ran, no waiter file left"
touch "$F/h25.go"; wait "$(cat "$F/h25.w")"
# C27: --slots and --slot-wait go together.
python3 "$LI" verify --tree "$T" --out "$F/out/c27a" --timeout 60 --slots 1 --verifier true > /dev/null 2>&1
ok "$?|$([ -e "$F/out/c27a.rc" ] && echo rc || echo none)" "2|none" "C27: a lone --slots → exit 2, no rc file"
python3 "$LI" verify --tree "$T" --out "$F/out/c27b" --timeout 60 --slot-wait 60 --verifier true > /dev/null 2>&1
ok "$?|$([ -e "$F/out/c27b.rc" ] && echo rc || echo none)" "2|none" "C27: a lone --slot-wait → exit 2, no rc file"
# C28: a SIGKILL of verify while its step runs: the guard ends the step and frees the slot; no rc (red).
rm -f "$T/vpid"
python3 "$LI" verify --tree "$T" --out "$F/out/c28" --timeout 600 --slots 1 --slot-wait 600 --verifier "echo \$\$ > vpid; exec sleep 3193.$u" > /dev/null 2>&1 &
vp=$!; vpids+=($vp)
within 300 test -s "$T/vpid" && st=started || st="not started in 300 s"
ok "$st" started "C28: the slotted verifier runs"
kill -KILL "$vp"; wait "$vp" 2>/dev/null
within 60 vgone "$(cat "$T/vpid")" && st=gone || st="alive after 60 s"
ok "$st" gone "C28: SIGKILL of verify → its guard still ends the step"
within 60 vfree && st=free || st="held after 60 s"
ok "$st" free "C28: … and the verify slot frees"
ok "$([ -e "$F/out/c28.rc" ] && echo rc || echo none)" none "C28: … and no rc is written (red)"
# C17s: C17's deadline and TERM arms, slotted.
python3 "$LI" verify --tree "$T" --out "$F/out/c17s" --timeout 2 --slots 1 --slot-wait 600 --verifier "sleep 3175.$u & sleep 3176.$u; wait" > /dev/null &
vp=$!; vpids+=($vp)
if within 300 gone "$vp"; then st=returned; else st="still running after 300 s"; kill -TERM "$vp"; fi; wait "$vp"
ok "$(cat "$F/out/c17s.rc" 2>/dev/null)|$st" "124|returned" "C17s: slotted, the deadline → rc 124, and verify returns at it"
within 60 nosleeper "sleep 317[56]\.$u"
ok "$(sleepers "sleep 317[56]\.$u")" 0 "C17s: … no verifier child survives"
python3 "$LI" verify --tree "$T" --out "$F/out/c17t" --timeout 600 --slots 1 --slot-wait 600 --verifier "sleep 3177.$u & sleep 3178.$u; wait" > /dev/null &
vp=$!; vpids+=($vp)
started17() { grep -q '== verifier:' "$F/out/c17t.log" && [ "$(sleepers "sleep 317[78]\.$u\$")" -ge 1 ]; }
within 300 started17 && st=started || st="not started after 300 s"
ok "$st" started "C17s: the slotted verifier's children run before the TERM"
kill -TERM "$vp"; wait "$vp"
ok "$(cat "$F/out/c17t.rc" 2>/dev/null)" 143 "C17s: TERM to a slotted verify → rc 143"
within 60 nosleeper "sleep 317[78]\.$u"
ok "$(sleepers "sleep 317[78]\.$u")" 0 "C17s: … and its children are gone"
within 60 vfree && st=free || st="held after 60 s"
ok "$st" free "C17s: … and the verify slot is free"
# C23s: C23's TRAP arm slotted (the step starts with TERM unblocked through the guard), and its LATE arm with the
# SIGTERM landing while the GUARD starts (Popen matched on the guard's argv): rc 143, the step's group killed.
T2="$F/steptree23"; mkdir -p "$T2"
python3 "$LI" verify --tree "$T2" --out "$F/out/trap-s" --timeout 600 --slots 1 --slot-wait 600 \
  --verifier "trap 'echo term > got; exit 0' TERM; sleep 3183.$u & echo \$! > tpid; wait" > /dev/null &
vp=$!; vpids+=($vp)
within 300 test -s "$T2/tpid" && st=started || st="not started after 300 s"
ok "$st" started "C23s: the slotted step has set its TERM trap and started its sleeper"
kill -TERM "$vp"; wait "$vp"
ok "$(cat "$F/out/trap-s.rc" 2>/dev/null)" 143 "C23s: TERM to a slotted verify mid-step → rc 143"
ok "$(cat "$T2/got" 2>/dev/null)" term "C23s: the guarded step starts with TERM unblocked (its trap runs on the group's SIGTERM)"
ok "$(reaped "$(cat "$T2/tpid" 2>/dev/null)")" gone "C23s: … and its sleeper is gone"
rm -f "$T2/pid"
LATE_S='
import importlib.util, os, signal, subprocess, sys, time
spec = importlib.util.spec_from_file_location("lead_integrate", sys.argv[1])
li = importlib.util.module_from_spec(spec)
spec.loader.exec_module(li)
class Late(subprocess.Popen):
    def __init__(self, args, *a, **k):
        super().__init__(args, *a, **k)
        if len(args) > 2 and args[2] == "_guard":
            pid = os.path.join(k.get("cwd") or ".", "pid")
            end = time.monotonic() + 300
            while time.monotonic() < end:
                try:
                    if open(pid).read().strip():
                        break
                except OSError:
                    pass
                time.sleep(0.05)
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(0.5)
subprocess.Popen = Late
sys.exit(li.main(sys.argv[2:]))
'
python3 -B -c "$LATE_S" "$LI" verify --tree "$T2" --out "$F/out/late-s" --timeout 600 --slots 1 --slot-wait 600 --verifier "sleep 3184.$u & echo \$! > pid; wait" > /dev/null
ok "$(cat "$F/out/late-s.rc" 2>/dev/null)" 143 "C23s: SIGTERM while the guard starts → rc 143"
ok "$(reaped "$(cat "$T2/pid" 2>/dev/null)")" gone "C23s: … and the step's group is killed through the guard (its sleeper is gone)"
within 60 vfree && st=free || st="held after 60 s"
ok "$st" free "C23s: … and the verify slot is free"
for p in "${vpids[@]}"; do kill -0 "$p" 2>/dev/null && kill -TERM "$p"; done

# ======== C29: prepare refuses a note with no integrating: (p26-1) ===========================================
# Every route into step 3's prepare passes mark-integrating first; a skipped stamp stops here, before anything
# is fetched, deleted, stashed or merged, and the lead's fix is the stamp, then prepare again.
noint() { sed -i.bak '/^integrating:/d' "$V/$SLUG.md"; }
fx c29
noint
X=$(git -C "$R" commit-tree "$(git -C "$R" rev-parse "$TB^{tree}")" -m dangling)
git -C "$R" update-ref "refs/integration-anchor/$BR" "$X"
printf 'leftover\n' >> "$WT/t.txt"
O0=$(git -C "$R" rev-parse refs/remotes/origin/master)
main m.txt "theirs"
prep
ok "$prc|$J" "1|" "C29: no integrating: → prepare exits 1 and prints no JSON"
has "$(cat "$F/prep.err")" "carries no integrating:" "C29: … stderr names the missing stamp"
has "$(cat "$F/prep.err")" "mark-integrating" "C29: … and the verb to run"
ok "$(git -C "$R" rev-parse -q --verify "refs/integration-anchor/$BR" || echo gone)" "$X" "C29: … the stale anchor ref is not deleted"
ok "$(git -C "$WT" stash list)|$(git -C "$WT" diff --name-only)" "|t.txt" "C29: … nothing stashed, the leftover still in the tree"
ok "$(git -C "$R" rev-parse refs/remotes/origin/master)" "$O0" "C29: … and nothing fetched (origin/master unchanged after main moved)"
python3 "$RR" mark-integrating --tasks "$SLUG" --tasks-dir "$V" >/dev/null
prep
ok "$prc|$(j "$J" 'd["route"]')" "0|verify" "C29: mark-integrating, then prepare again → 0, route verify"
# C29b: the incident's sequence. An integrate call's integrated row (reconcile removed integrating:), then
# merge-task's exit 3 (main moved): step 3 again from its start, so a prepare with no mark-integrating refuses.
fx c29b
main a.txt "$(printf 'a1\na2\na3\na4\nA5 theirs')" "theirs: a5 (#6)"; B0=$B
onbranch merge --no-ff --no-edit -m "Merge origin/master into $BR (Integration)" origin/master
M1=$(git --git-dir "$MT_SRV" rev-parse "refs/heads/$BR")
g -C "$WT" pull -q --ff-only origin "$BR" 2>/dev/null
addlog "$V/$SLUG.md" "2026-10-02T11:30+00:00 integrated path=integrator pr=5 anchor=$H0 head=$M1 base=$B0 wait=5 duration=3 triggers=shared-file"
noint
main m.txt "theirs" "theirs: m (#8)"
prep
ok "$prc" 1 "C29b: base moved after an integrated row, prepare with no mark-integrating → 1"
python3 "$RR" mark-integrating --tasks "$SLUG" --tasks-dir "$V" >/dev/null
prep
ok "$prc|$(j "$J" 'd["case"]')|$(j "$J" 'd["route"]')" "0|ii|verify" "C29b: mark-integrating, then prepare → 0, case (ii), route verify"

# ======== C30–C40: the Inert-path skip (ADR 0045, p29-3) ==================================================
# prepare --verifier: when main moved only in the repo's Inert paths (rollouts.toml, schema 2) and the Inert proof holds
# on M's tree, route `skip` (push M, log, merge-task; no verifier) and a `verify-skipped` Run-record line; anything else
# routes `verify` exactly as before, with `inert.why`. These fixtures give the clone a GitHub ssh origin served by the fake
# ssh (land.sh --origin-slug reads `remote get-url`), HOME a rollouts.toml of their own, and the Run record its own dir
# (these cases read it, so THREAD_TEST_EVENTS_DIR does not apply).
cp "$root/tests/fixtures/land/fake-ssh.sh" "$tmp/bin/fake-ssh"; chmod +x "$tmp/bin/fake-ssh"
REAL_GIT=$(command -v git)
ifx() {  # ifx <name> [inert_paths TOML value]: fx with the ssh origin, HOME and the record of its own
  fx "$1"
  export SRV="$F/srv/github.com" LOG_SSH="$F/ssh.log" GIT_SSH_COMMAND="$tmp/bin/fake-ssh" GIT_SSH_VARIANT=ssh
  g -C "$R" remote set-url origin git@github.com:o/r.git
  IH="$F/home"; IEV="$F/events"; mkdir -p "$IH/.config/thread"
  if [ -n "${2-}" ]; then printf 'schema = 2\n\n[repo."o/r"]\ninert_paths = %s\n' "$2" > "$IH/.config/thread/rollouts.toml"; fi
}
iprep() { J=$(HOME="$IH" THREAD_EVENTS_DIR="$IEV" python3 "$LI" prepare --repo "$R" --slug "$SLUG" --default master --note "$V/$SLUG.md" --verifier "${VER:-true}" "$@" 2>"$F/prep.err"); prc=$?; }
ikinds() { python3 -c 'import json,sys; print(json.dumps([json.loads(l)["kind"] for l in open(sys.argv[1])], separators=(",", ":")))' "$IEV/ro.jsonl" 2>/dev/null || echo '[]'; }
iline() { python3 -c 'import json,sys; ls=[json.loads(l) for l in open(sys.argv[1])]; print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))' "$IEV/ro.jsonl" "$1"; }
mtg() { : > "$MT_STATE/gh.log"; out=$(PATH="$tmp/bin:$PATH" bash "$MT" "$R" "$@" 2>&1); rc=$?; }
taskfile() {  # taskfile <path> <content>: a commit on origin's task branch from p (the task's own diff)
  g -C "$F/p" fetch -q origin; g -C "$F/p" checkout -q -B "$BR" "origin/$BR"
  mkdir -p "$F/p/$(dirname "$1")"; printf '%s\n' "$2" > "$F/p/$1"; g -C "$F/p" add "$1"; g -C "$F/p" commit -q -m "task: $1"
  g -C "$F/p" push -q origin "$BR"; g -C "$F/p" checkout -q master
}
mainmv() {  # mainmv <from> <to>: a rename on origin's master; B is the new tip
  g -C "$F/p" checkout -q master; g -C "$F/p" pull -q --ff-only origin master 2>/dev/null
  mkdir -p "$F/p/$(dirname "$2")"; g -C "$F/p" mv "$1" "$2"; g -C "$F/p" commit -q -m "mv $1 $2"; g -C "$F/p" push -q origin master
  B=$(git -C "$F/p" rev-parse HEAD)
}

# C30: a THREAD.md-only move skips the re-run: push M, log it, merge-task merges (M, B); no verifier ran.
ifx c30 '["THREAD.md", "docs/handoffs/**"]'
main THREAD.md "a peer's close-out" "docs(thread): close-out"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" 'd["trouble"]')|$(j "$J" 'd["sharedFiles"]')" "0|skip|i|[]|[]" "C30: a THREAD.md-only move → route skip, trouble []"
M=$(j "$J" 'd["mergeCommit"]')
ok "$(git -C "$WT" rev-list --parents -n 1 HEAD)" "$M $H0 $B" "C30: M merges B into H (unpushed)"
ok "$(j "$J" '[d["inert"]["skip"], d["inert"]["changed"], d["inert"]["changedTotal"], d["inert"]["nonInert"], d["inert"]["globs"]]')" '[true,["THREAD.md"],1,[],["THREAD.md"]]' "C30: inert names the move, the glob it proved, nothing non-inert"
has "$(j "$J" 'd["inert"]["why"]')" "the Inert proof held" "C30: … and why"
ok "$(python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M" >/dev/null 2>&1; echo $?)" 0 "C30: push M exits 0"
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$H0" --head "$M" --base "$B" >/dev/null
has "$(loglines)" " integrated path=lead pr=5 anchor=$H0 head=$M base=$B " "C30: log-integration writes head=M base=B"
mkpr 5 "$M"; printf '%s\n' "$B" > "$MT_STATE/base.seq"
mtg 5 "$M" "$B"
ok "$rc|$(cat "$R/.claude/merge-task.status")" "0|ok" "C30: merge-task merges (M, B): rc 0, ok"
ok "$([ -e "$R/.claude/integration/$SLUG.rc" ] && echo ran || echo none)" none "C30: no verifier ran (no rc file)"
ok "$(ikinds)" '["verify-skipped"]' "C30: the Run record holds one verify-skipped line"
ok "$(iline '[ls[0]["task"], ls[0]["repo"], ls[0]["paths"], ls[0]["pathsTotal"], ls[0]["head"], ls[0]["main"], ls[0]["globs"]]')" "[\"$SLUG\",\"o/r\",[\"THREAD.md\"],1,\"$M\",\"$B\",[\"THREAD.md\"]]" "C30: … with the paths, M, main and the glob"

# C31: THREAD.md plus a source file re-runs.
ifx c31 '["THREAD.md"]'
main THREAD.md "close-out"; main src.py "print(1)"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["skip"]')|$(j "$J" 'd["inert"]["nonInert"]')" '0|verify|false|["src.py"]' "C31: THREAD.md plus src.py → verify, src.py non-inert"
has "$(j "$J" 'd["inert"]["why"]')" "not inert prose" "C31: … why names the non-inert path"
ok "$(ikinds)" '[]' "C31: … and no record line (the path test decided)"

# C32: a rename from a source path into docs/handoffs/ re-runs (case ii, the path test on record.base..B).
ifx c32 '["THREAD.md", "docs/handoffs/**"]'
main s.py "print(1)"; B1=$B
iprep
ok "$(j "$J" 'd["route"]')" verify "C32: a source move first → verify"
M1=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M1" >/dev/null 2>&1
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$H0" --head "$M1" --base "$B1" >/dev/null
mainmv s.py docs/handoffs/s.md
iprep
ok "$prc|$(j "$J" 'd["case"]')|$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["nonInert"]')" '0|ii|verify|["s.py"]' "C32: git mv s.py docs/handoffs/s.md → case (ii), verify, s.py counts at the path it left"

# C33: no inert_paths re-runs: an empty list, no repo table, no file, and no --verifier at all.
ifx c33 '[]'
main THREAD.md "close-out"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["skip"]')" "0|verify|false" "C33: inert_paths = [] → verify"
has "$(j "$J" 'd["inert"]["why"]')" "inert_paths is empty" "C33: … why says so"
g -C "$WT" reset -q --hard "$H0"
printf 'schema = 2\n\n[repo."o/other"]\ninert_paths = ["THREAD.md"]\n' > "$IH/.config/thread/rollouts.toml"
iprep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["why"]')" "verify|no inert_paths for this repo in rollouts.toml: the verifier runs" "C33: another repo's table → verify"
g -C "$WT" reset -q --hard "$H0"; rm -f "$IH/.config/thread/rollouts.toml"
iprep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["skip"]')" "verify|false" "C33: no rollouts.toml → verify"
g -C "$WT" reset -q --hard "$H0"
J=$(python3 "$LI" prepare --repo "$R" --slug "$SLUG" --default master --note "$V/$SLUG.md" 2>"$F/prep.err")
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]')" 'verify|{"skip":false,"why":"no --verifier given: the verifier runs","globs":[],"changed":[],"changedTotal":0,"nonInert":[],"readers":[]}' "C33: no --verifier → verify, inert off"

# C34: the task's own diff adds a test reading THREAD.md: the proof on M's tree catches it.
ifx c34 '["THREAD.md"]'
taskfile tests/t.sh 'cat THREAD.md'
main THREAD.md "close-out"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')|$(j "$J" '[r["path"] for r in d["inert"]["readers"]]')" '0|verify|i|["tests/t.sh"]' "C34: a test the task adds reads THREAD.md → verify, the reader named"
ok "$(ikinds)|$(iline '[ls[0]["failed"], [r["path"] for r in ls[0]["readers"]], ls[0]["readers"][0]["kind"]]')" '["inert-proof-failed"]|[["THREAD.md"],["tests/t.sh"],"name"]' "C34: … and an inert-proof-failed line naming it"

# C35: a verifier step that walks the tree fails the proof.
ifx c35 '["THREAD.md"]'
main THREAD.md "close-out"
VER="find . -name '*.md' | wc -l" iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" '[d["inert"]["readers"][0][k] for k in ("path", "kind", "origin")]')" '0|verify|["<verifier>","walk","cwd"]' "C35: a step walking the tree → verify, kind walk, origin cwd"

# C36: a shared THREAD.md (the task and main both add it) is no skip: today's shared-file trouble stands.
ifx c36 '["THREAD.md"]'
taskfile THREAD.md "same"
main THREAD.md "same"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')|$(j "$J" 'd["sharedFiles"]')|$(j "$J" 'd["inert"]["skip"]')" '0|verify|["shared-file"]|["THREAD.md"]|false' "C36: a shared THREAD.md → verify with the shared-file trouble"
has "$(j "$J" 'd["inert"]["why"]')" "shared file" "C36: … why names it"

# C37: a refused rollouts.toml (inert_paths with no schema line) gives no skip and exit 0.
ifx c37
printf '[repo."o/r"]\ninert_paths = ["THREAD.md"]\n' > "$IH/.config/thread/rollouts.toml"
main THREAD.md "close-out"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["skip"]')" "0|verify|false" "C37: a refused rollouts.toml → verify, exit 0"
has "$(j "$J" 'd["inert"]["why"]')" "rollout settings refused" "C37: … why names the refusal"

# C38: chained skips: after a skip merged-in-waiting, main moves in THREAD.md again (merge-task exit 3), and the next
# prepare (case ii, the path test on record.base..B2) skips again on the newest M.
ifx c38 '["THREAD.md"]'
main THREAD.md "close-out 1"; B1=$B
iprep
M1=$(j "$J" 'd["mergeCommit"]')
ok "$(j "$J" 'd["route"]')" skip "C38: the first THREAD.md move → skip"
python3 "$LI" push --repo "$R" --slug "$SLUG" --head "$M1" >/dev/null 2>&1
python3 "$RR" log-integration --tasks "$SLUG" --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$H0" --head "$M1" --base "$B1" >/dev/null
main THREAD.md "close-out 2"; B2=$B
mkpr 5 "$M1"; printf '%s\n' "$B2" > "$MT_STATE/base.seq"
mtg 5 "$M1" "$B1"
ok "$rc" 3 "C38: merge-task (M1, B1) after main moved → exit 3 (base moved)"
python3 "$RR" mark-integrating --tasks "$SLUG" --tasks-dir "$V" >/dev/null
iprep
ok "$prc|$(j "$J" 'd["case"]')|$(j "$J" 'd["route"]')" "0|ii|skip" "C38: prepare again → case (ii), skip again"
M2=$(j "$J" 'd["mergeCommit"]')
ok "$(git -C "$WT" rev-list --parents -n 1 HEAD)" "$M2 $M1 $B2" "C38: … on the newest M (M1 + B2)"
ok "$(ikinds)" '["verify-skipped","verify-skipped"]' "C38: … two verify-skipped lines"

# C39: a test file with a cwd-relative recursive glob fails the proof (kind walk, origin cwd).
ifx c39 '["THREAD.md"]'
taskfile tests/test_md.py "$(printf 'import glob\nFILES = glob.glob("**/*.md", recursive=True)')"
main THREAD.md "close-out"
iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" '[d["inert"]["readers"][0][k] for k in ("path", "kind", "origin")]')" '0|verify|["tests/test_md.py","walk","cwd"]' "C39: glob.glob('**/*.md') in a test → verify, kind walk, origin cwd"
ok "$(ikinds)" '["inert-proof-failed"]' "C39: … and an inert-proof-failed line"

# C40: fail closed: a git that fails `cat-file --batch` makes the inert check raise; prepare routes verify, exits 0, and
# records the error, with no traceback.
ifx c40 '["THREAD.md"]'
taskfile src/x.py 'print(1)'   # a non-prose blob, so the proof reads one through cat-file --batch
main THREAD.md "close-out"
mkdir -p "$F/shim"
printf '#!/bin/sh\ncase " $* " in *" cat-file --batch "*) echo "shim: cat-file refused" >&2; exit 128 ;; esac\nexec "%s" "$@"\n' "$REAL_GIT" > "$F/shim/git"
chmod +x "$F/shim/git"
PATH="$F/shim:$PATH" iprep
ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["inert"]["skip"]')" "0|verify|false" "C40: a failing cat-file → prepare exits 0, route verify, no skip"
case "$(j "$J" 'd["inert"]["why"]')" in "inert check error: "*) ok y y "C40: … inert.why starts 'inert check error: '";; *) ok "$(j "$J" 'd["inert"]["why"]')" "inert check error: …" "C40: … inert.why";; esac
lacks "$(cat "$F/prep.err")" "Traceback" "C40: … no traceback on stderr"
has "$(cat "$F/prep.err")" "WARN: inert check error: ProofError" "C40: … one WARN line names the error"
ok "$(ikinds)|$(iline '[ls[0]["readers"], ls[0]["error"][:26]]')" '["inert-proof-failed"]|[[],"inert check error: ProofEr"]' "C40: … and an inert-proof-failed line with error and readers []"
unset SRV LOG_SSH GIT_SSH_COMMAND GIT_SSH_VARIANT

# ======== C41–C53: the Flake check (ADR 0050, p29-9) =======================================================
# verify --diff-base REV [--named-rerun CMD]: a red first run whose failing tests are all named, placed in a test
# file and outside `git diff --name-only REV HEAD` re-runs them by name, then confirms with one more verifier run on
# the same tree: green is a Flake (rc 0, <out>.flake.json verdict flake), any other red is red. The fixture: a repo
# whose base B holds tests/test_flaky.py, tests/test_touched.py, "tests/test sp.py" and src/x.py; the task commit T
# changes src/x.py and tests/test_touched.py. v.sh is the verifier (run n prints v.<n>.out, sleeps v.<n>.sleep, exits
# v.<n>.rc) and r.sh the named re-run (each call's argv to r.<n>.args, sleeps r.sleep, exits r.rc), both counting; a
# sleep is their child, its pid in v.<n>.cpid or r.cpid.
ffx() {
  echo "== $1"
  F="$tmp/$1"; mkdir -p "$F"; FR="$F/repo"
  g init -q "$FR"; mkdir -p "$FR/tests" "$FR/src"
  for f in tests/test_flaky.py tests/test_touched.py "tests/test sp.py" src/x.py; do printf 'base\n' > "$FR/$f"; done
  g -C "$FR" add . && g -C "$FR" commit -q -m base; FB=$(git -C "$FR" rev-parse HEAD)
  printf 'task\n' > "$FR/src/x.py"; printf 'task\n' > "$FR/tests/test_touched.py"
  g -C "$FR" commit -q -am task; FT=$(git -C "$FR" rev-parse HEAD)
  printf 'outside\n' > "$F/outside.py"
  mkdir -p "$F/bin"
  cat > "$F/bin/v.sh" <<'SH'
d="$(dirname "$(dirname "$0")")"; n=$(( $(cat "$d/v.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/v.count"
[ -f "$d/v.$n.out" ] && cat "$d/v.$n.out"
[ -f "$d/v.$n.sleep" ] && { sleep "$(cat "$d/v.$n.sleep")" & echo $! > "$d/v.$n.cpid"; wait; }
exit "$(cat "$d/v.$n.rc" 2>/dev/null || echo 0)"
SH
  cat > "$F/bin/r.sh" <<'SH'
d="$(dirname "$(dirname "$0")")"; n=$(( $(cat "$d/r.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/r.count"
for a in "$@"; do printf '%s\n' "$a"; done > "$d/r.$n.args"
[ -f "$d/r.sleep" ] && { sleep "$(cat "$d/r.sleep")" & echo $! > "$d/r.cpid"; wait; }
exit "$(cat "$d/r.rc" 2>/dev/null || echo 0)"
SH
  O="$F/out/v"; NR="bash $F/bin/r.sh {tests}"
}
red1() { printf '%s\n' "$@" > "$F/v.1.out"; echo 1 > "$F/v.1.rc"; }   # the first run fails, printing these lines
vf() { python3 "$LI" verify --tree "$FR" --out "$O" --timeout "${VT:-60}" --verifier "bash $F/bin/v.sh" "$@" >/dev/null 2>"$F/vf.err"; vrc=$?; }
fj() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); v=eval(sys.argv[2]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False))' "$O.flake.json" "$1" 2>/dev/null || echo "<no flake.json>"; }
cnt() { cat "$F/$1.count" 2>/dev/null || echo 0; }
rcof() { cat "$O.rc" 2>/dev/null || echo none; }

# C41: one out-of-diff test fails, passes its named re-run, and the confirming run is green: a Flake, rc 0.
ffx c41
red1 'FAILED tests/test_flaky.py::test_a - AssertionError'
vf --diff-base "$FB" --named-rerun "$NR"
ok "$vrc|$(rcof)" "0|0" "C41: a red on one out-of-diff test, green named re-run and confirming run → rc 0"
ok "$(fj 'd["verdict"]')|$(fj 'd["why"]')|$(fj 'd["flakes"]')" 'flake||["tests/test_flaky.py::test_a"]' "C41: flake.json reads flake, the first-run id its Flake"
ok "$(fj 'd["v"]')|$(fj 'd["sha"]')|$(fj 'd["diffBase"]')|$(fj 'd["failing"]')|$(fj 'd["touched"]')|$(fj 'd["timeout"]')" \
  "1|$FT|$FB|[\"tests/test_flaky.py::test_a\"]|[]|null" "C41: … with the tree's sha, the diff base, the failing ids, none touched, no timeout"
ok "$(cnt v)|$(cnt r)|$(cat "$F/r.1.args")" "2|1|tests/test_flaky.py::test_a" "C41: the verifier ran twice, the named re-run once with exactly that id"
has "$(cat "$O.log")" "== named re-run: bash $F/bin/r.sh tests/test_flaky.py::test_a" "C41: the log names the named re-run"
has "$(cat "$O.log")" "== named re-run rc 0" "C41: … and its rc"
has "$(cat "$O.log")" "== confirming run: bash $F/bin/v.sh" "C41: … and the confirming run"
has "$(cat "$O.log")" "== confirming run rc 0" "C41: … and its rc"

# C42: the named re-run is red: red at once, its rc kept, no full run.
ffx c42
red1 'FAILED tests/test_flaky.py::test_a - AssertionError'; echo 4 > "$F/r.rc"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["verdict"]')|$(fj 'd["why"]')|$(fj 'd["flakes"]')" "4|1|1|red|named-red|[]" "C42: a red named re-run → red (its rc), no confirming run"

# C43: the named re-run is green but the confirming run is red: red, its own rc.
ffx c43
red1 'FAILED tests/test_flaky.py::test_a - AssertionError'; printf 'FAILED tests/test_flaky.py::test_b\n' > "$F/v.2.out"; echo 2 > "$F/v.2.rc"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["verdict"]')|$(fj 'd["why"]')" "2|2|1|red|confirm-red" "C43: a green named re-run, then a red confirming run → red (its rc)"
ok "$(fj 'd["failing"]')" '["tests/test_flaky.py::test_a"]' "C43: … failing names the first run's ids only"

# C44: a failing test the diff touches: red, no re-run.
ffx c44
red1 'FAILED tests/test_touched.py::test_b - AssertionError'
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["verdict"]')|$(fj 'd["why"]')|$(fj 'd["touched"]')" '1|1|0|red|touched|["tests/test_touched.py::test_b"]' "C44: a touched test → red, no re-run"

# C45: one touched and one untouched: red, no re-run.
ffx c45
red1 'FAILED tests/test_flaky.py::test_a' 'FAILED tests/test_touched.py::test_b'
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["why"]')" "1|1|0|touched" "C45: one touched, one untouched → red, no re-run"

# C46: a red that names no test, one whose test cannot be placed, and one past the parser's cap: red, no re-run.
ffx c46
red1 'src/x.py:1:80: E501 line too long'
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["why"]')|$(fj 'd["failing"]')" "1|1|0|unnamed|[]" "C46: a lint red names no test → red (unnamed), no re-run"
ffx c46b
red1 '✖ D14. x (12ms)'
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt r)|$(fj 'd["why"]')|$(fj 'd["failing"]')" '1|0|unplaced|["D14. x"]' "C46: a spec name placed in no test file → red (unplaced), no re-run"
ffx c46c
for i in $(seq 1 55); do printf 'FAILED tests/test_flaky.py::test_%s\n' "$i"; done > "$F/v.1.out"; echo 1 > "$F/v.1.rc"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt r)|$(fj 'd["why"]')|$(fj 'len(d["failing"])')" "1|0|too-many|50" "C46: more failures than the parser's cap → red (too-many), no re-run"

# C47: timeouts. The first run's deadline: rc 124, no re-run; the confirming run's: red; no harness time left: red.
ffx c47
echo 5 > "$F/v.1.sleep"
VT=1 vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt r)|$(fj 'd["verdict"]')|$(fj 'd["why"]')|$(fj 'd["timeout"]')" '124|0|red|timeout|{"run":"first","seconds":1}' "C47: the first run's deadline → rc 124, red (timeout, first), no re-run"
ffx c47b
red1 'FAILED tests/test_flaky.py::test_a'; echo 5 > "$F/v.2.sleep"
VT=2 vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["why"]')|$(fj 'd["timeout"]["run"]')|$(fj 'd["timeout"]["seconds"]')" "124|2|1|timeout|confirm|2" "C47: the confirming run's deadline → rc 124, red (timeout, confirm)"
has "$(cat "$O.log")" "during the confirming run" "C47: … and the log names it"
ffx c47c
red1 'FAILED tests/test_flaky.py::test_a'
THREAD_VERIFY_HARNESS_S=600 vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["why"]')|$(fj 'd["timeout"]')" "1|1|0|no-time|null" "C47: no harness time left → red (no-time), nothing re-run"

# C48: the RACE form: the same check on the detached tree at the merge commit, the merged task's diff (H^1..H).
ffx c48
g -C "$FR" checkout -q -b task; g -C "$FR" checkout -q -B master "$FB"
printf 'main\n' > "$FR/m.txt"; g -C "$FR" add m.txt; g -C "$FR" commit -q -m main
g -C "$FR" merge -q --no-ff --no-edit task; FH=$(git -C "$FR" rev-parse HEAD)
RT="$FR/.claude/worktrees/race-x"
red1 'FAILED tests/test_flaky.py::test_a'
python3 "$LI" verify --repo "$FR" --detach-at "$FH" --tree "$RT" --out "$O" --timeout 60 --verifier "bash $F/bin/v.sh" --diff-base "$FH^1" --named-rerun "$NR" >/dev/null 2>&1
ok "$(rcof)|$(fj 'd["verdict"]')|$(fj 'd["sha"]')|$(cnt v)|$(cnt r)" "0|flake|$FH|2|1" "C48: a RACE re-verify's out-of-diff red cleared by its named re-run and confirming run → green, a Flake"
ok "$([ -e "$RT" ] && echo left || echo removed)" removed "C48: … the race tree is removed"
lacks "$(git -C "$FR" worktree list)" "race-x" "C48: … and unregistered"
rm -f "$F"/v.* "$F"/r.*; red1 'FAILED tests/test_flaky.py::test_a'; echo 1 > "$F/r.rc"
python3 "$LI" verify --repo "$FR" --detach-at "$FH" --tree "$RT" --out "$O" --timeout 60 --verifier "bash $F/bin/v.sh" --diff-base "$FH^1" --named-rerun "$NR" >/dev/null 2>&1
ok "$(rcof)|$(fj 'd["why"]')|$([ -e "$RT" ] && echo left || echo removed)" "1|named-red|removed" "C48: a repeat red (the named re-run) stays red; the tree is removed"
lacks "$(git -C "$FR" worktree list)" "race-x" "C48: … and pruned"
rm -f "$F"/v.* "$F"/r.*; red1 'FAILED tests/test_touched.py::test_b'
python3 "$LI" verify --repo "$FR" --detach-at "$FH" --tree "$RT" --out "$O" --timeout 60 --verifier "bash $F/bin/v.sh" --diff-base "$FH^1" --named-rerun "$NR" >/dev/null 2>&1
ok "$(rcof)|$(fj 'd["why"]')|$(cnt r)" "1|touched|0" "C48: the merged task's own test is touched: red, no re-run"

# C49: no --named-rerun: the check cannot re-run by name, so the red stays red.
ffx c49
red1 'FAILED tests/test_flaky.py::test_a'
vf --diff-base "$FB"
ok "$(rcof)|$(cnt v)|$(cnt r)|$(fj 'd["verdict"]')|$(fj 'd["why"]')" "1|1|0|red|no-named-rerun" "C49: no --named-rerun → red (no-named-rerun), no re-run"
ffx c49b
red1 'FAILED tests/test_flaky.py::test_a'
vf
ok "$(rcof)|$([ -e "$O.flake.json" ] && echo file || echo none)|$(cnt v)" "1|none|1" "C49: no --diff-base → red as before, no flake.json"
ffx c49c
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["verdict"]')|$(cnt v)|$(cnt r)" "0|green|1|0" "C49: a green first run → flake.json green, nothing re-run"
vf --diff-base "no-such-rev" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["verdict"]')" "0|green" "C49: … a green run never reads the diff"
rm -f "$F"/v.* "$F"/r.*; red1 'FAILED tests/test_flaky.py::test_a'
vf --diff-base "no-such-rev" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["why"]')|$(cnt r)" "1|diff|0" "C49: an unreadable diff base → red (diff), no re-run"

# C50: refusals (exit 2, no rc file): --diff-base with --outcome, a --named-rerun without exactly one {tests}, or
# without --diff-base.
ffx c50
for bad in "--diff-base $FB --outcome" "--diff-base $FB --named-rerun x" "--named-rerun {tests}"; do
  vf $bad
  ok "$vrc|$(rcof)" "2|none" "C50: $bad → exit 2, no rc"
done
vf --diff-base "$FB" --named-rerun "r {tests} {tests}"
ok "$vrc|$(rcof)" "2|none" "C50: a --named-rerun with two {tests} → exit 2, no rc"

# C51: ids with spaces and quotes reach the named re-run as single argv words; a ../ or absolute path outside the
# tree is unplaced; an absolute path inside the tree is made relative.
ffx c51
Q='tests/test_flaky.py::test_q["it'"'"'s$x`y`;|&"]'
red1 "not ok 1 - tests/test sp.py::test_s" "FAILED $Q"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["verdict"]')|$(cnt r)" "0|flake|1" "C51: a spaced and a quoted id → a Flake"
ok "$(cat "$F/r.1.args")" "$(printf '%s\n%s' "tests/test sp.py::test_s" "$Q")" "C51: … each reaches the named re-run as one argv word, byte for byte"
ffx c51b
red1 'FAILED ../outside.py::test_o'
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["why"]')|$(cnt r)" "1|unplaced|0" "C51: a ../ path outside the tree → unplaced"
ffx c51c
red1 "FAILED $F/outside.py::test_o"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["why"]')|$(cnt r)" "1|unplaced|0" "C51: an absolute path outside the tree → unplaced"
ffx c51d
red1 "FAILED $FR/tests/test_flaky.py::test_a" "FAILED tests::test_dir"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["why"]')" "1|unplaced" "C51: a directory is no test file → unplaced"
ffx c51e
red1 "FAILED $FR/tests/test_flaky.py::test_a"
vf --diff-base "$FB" --named-rerun "$NR"
ok "$(rcof)|$(fj 'd["verdict"]')" "0|flake" "C51: an absolute path inside the tree is made relative and placed"

# C52: the SKILL.md verify line, filled (<mainSha> and <named_rerun>; --named-rerun dropped when there is none), runs
# under bash and zsh -f.
ffx c52
R0=${R:-}; R=$FR
for sh in "${shells[@]}"; do
  n=$(basename "${sh%% *}")
  for nr in "$NR" ""; do
    rm -rf "$FR/.claude/integration" "$F"/v.* "$F"/r.*; red1 'FAILED tests/test_flaky.py::test_a'
    cmd=$(MAIN_SHA="$FB" NAMED_RERUN="$nr" verify_line "$FR" "$SLUG" "bash $F/bin/v.sh")
    CLAUDE_PLUGIN_ROOT="$root" $sh -c "$cmd" >/dev/null 2>&1
    O="$FR/.claude/integration/$SLUG"
    if [ -n "$nr" ]; then
      ok "$(rcof)|$(fj 'd["verdict"]')|$(cnt r)" "0|flake|1" "C52 $n: the filled verify line with named_rerun → the Flake check clears it"
    else
      ok "$(rcof)|$(fj 'd["why"]')|$(cnt r)" "1|no-named-rerun|0" "C52 $n: … with no named_rerun the line has no --named-rerun, and the red stays red"
    fi
  done
done
R=$R0

# C53: a signal during the Flake check. TERM to verify while the named re-run (r.sh) sleeps, and while the confirming
# run (v.sh's second call) sleeps, unslotted and slotted (--slots 1 --slot-wait 5): rc 143, flake.json red with why
# `signal`, the sleeping child gone (verify kills the step's process group, through its guard when slotted), and the
# verify slot free. Structural, as C17 is: the children sleep 3205 s+, so only verify's kill can end them.
for arm in named confirm; do
  for mode in unslotted slotted; do
    ffx "c53-$arm-$mode"
    red1 'FAILED tests/test_flaky.py::test_a'
    if [ "$arm" = named ]; then echo "3205.$u" > "$F/r.sleep"; cp="$F/r.cpid"; else echo "3206.$u" > "$F/v.2.sleep"; cp="$F/v.2.cpid"; fi
    SL=""; [ "$mode" = slotted ] && SL="--slots 1 --slot-wait 5"
    python3 "$LI" verify --tree "$FR" --out "$O" --timeout 600 --verifier "bash $F/bin/v.sh" --diff-base "$FB" --named-rerun "$NR" $SL >/dev/null 2>&1 &
    vp=$!
    c53up() { test -s "$cp" || ! kill -0 "$vp"; }
    within 300 c53up && test -s "$cp" && st=sleeping || st="not sleeping (verify ended, or 300 s passed)"
    ok "$st" sleeping "C53 $arm $mode: the $arm run's child sleeps before the TERM"
    if [ "$mode" = slotted ]; then
      has "$(cat "$O.log")" "== verify slot 1 of 1 after" "C53 $arm $mode: … in the pool's only verify slot"
      ok "$(vstate)" held "C53 $arm $mode: … held while it sleeps"
    fi
    kill -TERM "$vp" 2>/dev/null; wait "$vp"; vrc=$?
    ok "$vrc|$(rcof)|$(fj 'd["verdict"]')|$(fj 'd["why"]')" "143|143|red|signal" "C53 $arm $mode: TERM mid-run → exit 143, rc 143, flake.json red, why signal"
    ok "$(reaped "$(cat "$cp" 2>/dev/null)")" gone "C53 $arm $mode: … the sleeping child is gone"
    has "$(cat "$O.log")" "stopped by signal 15; killed the process group (rc 143)" "C53 $arm $mode: … the log says so"
    if [ "$arm" = named ]; then ok "$(cnt v)|$(cnt r)" "1|1" "C53 $arm $mode: … stopped in the named re-run, no confirming run"
    else ok "$(cnt v)|$(cnt r)" "2|1" "C53 $arm $mode: … stopped in the confirming run"; fi
    within 60 vfree && st=free || st="held after 60 s"
    ok "$st" free "C53 $arm $mode: … and the verify slot is free"
  done
done
ok "$(sleepers "sleep 320[56]\.$u")" 0 "C53: no Flake-check child survives"

# C54 (p29-9 beside p29-10's suite record): --rollout with --diff-base. A Flake ends its one suite green, rc 0; a
# deadline in the confirming run ends it timeout, its step the verifier, failing the first run's ids.
fsq() {  # fsq <python expr over L, the suite record's lines>
  python3 -c 'import json,sys; L=[json.loads(x) for x in open(sys.argv[1]) if x.strip()]; print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))' "$FEV/ro.jsonl" "$1" 2>/dev/null || echo none
}
ffx c54
FEV="$F/events"; mkdir -p "$F/v" "$F/home"; : > "$F/v/ro.md"
red1 'FAILED tests/test_flaky.py::test_a - AssertionError'
HOME="$F/home" THREAD_EVENTS_DIR="$FEV" vf --diff-base "$FB" --named-rerun "$NR" --rollout "$F/v/ro.md" --slug t1
ok "$(rcof)|$(fj 'd["verdict"]')|$(fsq '[[d["kind"], d.get("outcome"), d.get("rc"), "failing" in d] for d in L]')" \
  '0|flake|[["suite-started",null,null,false],["suite-ended","green",0,false]]' "C54: --rollout: a Flake ends its one suite green, rc 0"
ffx c54b
FEV="$F/events"; mkdir -p "$F/v" "$F/home"; : > "$F/v/ro.md"
red1 'FAILED tests/test_flaky.py::test_a'; echo 5 > "$F/v.2.sleep"
HOME="$F/home" THREAD_EVENTS_DIR="$FEV" VT=2 vf --diff-base "$FB" --named-rerun "$NR" --rollout "$F/v/ro.md" --slug t1
ok "$(rcof)|$(fj 'd["timeout"]["run"]')|$(fsq '[[d.get("outcome"), d.get("rc"), d.get("step"), d.get("timeout"), d.get("failing")] for d in L if d["kind"] == "suite-ended"]')" \
  '124|confirm|[["timeout",124,"verifier",2,["tests/test_flaky.py::test_a"]]]' "C54: a deadline in the confirming run ends the suite timeout (step verifier), failing the first run's ids"

# ======== S1–S8: verify --rollout records its suite in the Run record (p29-10, ADR 0051) ========================
# by integration (with --slug), race (--detach-at) or completion (--outcome, no task), runner lead; suite-started after
# the slot and before the deadline, suite-ended after the rc or outcome file. These cases read the record, so they keep
# their own (THREAD_TEST_EVENTS_DIR does not apply); HOME is an empty dir (the Mac-wide count reads the note's vault).
fx s1
SEV="$F/events"; SH_HOME="$F/home"; mkdir -p "$SH_HOME"
sv() {  # sv <out> [verify args…]: verify on the task tree with --rollout ro, the record in SEV; the exit in $rc
  local o="$1"; shift
  HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --tree "$WT" --out "$F/out/$o" --rollout "$V/ro.md" "$@" >/dev/null 2>&1; rc=$?
}
sq() {  # sq <python expr over L, the record's lines>
  python3 - "$SEV/ro.jsonl" "$1" <<'PY2'
import json, sys
try:
    L = [json.loads(x) for x in open(sys.argv[1]).read().splitlines() if x.strip()]
except FileNotFoundError:
    L = []
print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))
PY2
}
HEAD0=$(git -C "$WT" rev-parse HEAD)
sv s1 --slug "$SLUG" --timeout 60 --verifier true
ok "$rc|$(sq '[d["kind"] for d in L]')" '0|["suite-started","suite-ended"]' "S1: green: a suite-started and a suite-ended"
ok "$(sq '[L[0]["task"], L[0]["by"], L[0]["runner"], L[0]["sha"], L[0]["dirty"], len(L[0]["load"]), L[0]["running"]]')" "[\"$SLUG\",\"integration\",\"lead\",\"$HEAD0\",false,3,0]" "S1: by integration, runner lead, the tree's sha, the load, the running count"
ok "$(sq '[L[1]["suite"] == L[0]["suite"], L[1]["outcome"], L[1]["rc"], "failing" in L[1], "running" in L[1]]')" '[true,"green",0,false,true]' "S1: ended green, rc 0, no failing"
: > "$SEV/ro.jsonl"
sv s2 --slug "$SLUG" --timeout 60 --verifier 'echo "FAILED tests/b.py::u - boom"; exit 1'
ok "$rc|$(sq '[L[1]["outcome"], L[1]["rc"], L[1]["failing"]]')" '1|["red",1,["tests/b.py::u"]]' "S2: red: its failing names, read from the log"
: > "$SEV/ro.jsonl"
sv s3 --slug "$SLUG" --timeout 2 --verifier "sleep 3181.$u"
ok "$rc|$(sq '[L[1]["outcome"], L[1]["rc"], L[1]["timeout"], L[1]["step"], L[1]["failing"]]')" '124|["timeout",124,2,"verifier",[]]' "S3: timeout: its --timeout and step"
: > "$SEV/ro.jsonl"
RT="$R/.claude/worktrees/race-$SLUG"
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --repo "$R" --detach-at "$HEAD0" --tree "$RT" --out "$F/out/s4" --timeout 60 --rollout "$V/ro.md" --slug "$SLUG" --verifier true >/dev/null 2>&1
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --repo "$R" --detach-at "$HEAD0" --tree "$RT" --out "$F/out/s4c" --timeout 60 --outcome --rollout "$V/ro.md" --verifier true >/dev/null 2>&1
ok "$(sq '[[d["kind"], d["by"], d["task"], d.get("outcome")] for d in L]')" "[[\"suite-started\",\"race\",\"$SLUG\",null],[\"suite-ended\",\"race\",\"$SLUG\",\"green\"],[\"suite-started\",\"completion\",null,null],[\"suite-ended\",\"completion\",null,\"green\"]]" "S4: --detach-at is a race suite; --outcome a completion suite with no task"
: > "$SEV/ro.jsonl"
VSL="$root/skills/execute/scripts/verify-slot.py"
python3 "$VSL" run --slots 1 -- sh -c "echo \$\$ > '$F/s5.pid'; until [ -e '$F/s5.go' ]; do sleep 0.1; done" > /dev/null 2>&1 &
hp=$!
within 300 test -s "$F/s5.pid" || echo "FAIL - S5: the holder did not start within 300 s"
sv s5 --slug "$SLUG" --timeout 60 --slots 1 --slot-wait 1 --verifier true
touch "$F/s5.go"; wait "$hp"
ok "$rc|$(sq '[[d["kind"], d["outcome"], d["seconds"], d["waited"] >= 1, "rc" in d] for d in L]')" '75|[["suite-ended","noslot",0,true,false]]' "S5: noslot: an ended line only, with its wait, no rc"
rm -rf "$SEV"
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --tree "$WT" --out "$F/out/s6" --timeout 60 --verifier true >/dev/null 2>&1
ok "$([ -e "$SEV" ] && echo written || echo none)" none "S6: no --rollout: no record"
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --tree "$WT" --out "$F/out/s6b" --timeout 60 --slug "$SLUG" --verifier true >/dev/null 2>&1
ok "$?|$([ -e "$F/out/s6b.rc" ] && echo rc || echo none)" "2|none" "S6: --slug without --rollout is a usage error, no rc file"
# S7: TERM to a slotted verify once its suite-started line is in: 143, the rc file first, then suite-ended stopped.
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --tree "$WT" --out "$F/out/s7" --timeout 600 --slots 1 --slot-wait 60 --rollout "$V/ro.md" --slug "$SLUG" --verifier "sleep 3182.$u" >/dev/null 2>&1 &
vp=$!
within 300 grep -q suite-started "$SEV/ro.jsonl" || echo "FAIL - S7: no suite-started within 300 s"
kill -TERM "$vp"; wait "$vp"; rc=$?
ok "$rc|$(cat "$F/out/s7.rc" 2>/dev/null)" "143|143" "S7: exit 143 and <out>.rc reads 143"
ok "$(sq '[[d["kind"], d.get("outcome"), d.get("rc"), "running" in d, "failing" in d] for d in L]')" '[["suite-started",null,null,true,false],["suite-ended","stopped",143,false,false]]' "S7: suite-ended stopped, no running, no failing"
within 60 nosleeper "sleep 3182\.$u"
: > "$SEV/ro.jsonl"
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$LI" verify --tree "$WT" --out "$F/out/s7b" --timeout 600 --slots 1 --slot-wait 60 --outcome --rollout "$V/ro.md" --verifier "sleep 3183.$u" >/dev/null 2>&1 &
vp=$!
within 300 grep -q suite-started "$SEV/ro.jsonl" || echo "FAIL - S7b: no suite-started within 300 s"
kill -TERM "$vp"; wait "$vp"
ok "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["rc"], d["ended"])' "$F/out/s7b.outcome.json")" "143 signal" "S7b: --outcome: the outcome file carries rc 143 and ended signal"
ok "$(sq '[d.get("outcome") for d in L]')" '[null,"stopped"]' "S7b: … and the suite ended stopped"
within 60 nosleeper "sleep 3183\.$u"

# S8: a TERM while suite-started walks the vault for its running count, a slot held: never swallowed by the count's
# best effort. 143 and <out>.rc 143, the verifier never runs, no line (no green), the slot free.
: > "$SEV/ro.jsonl"
cat > "$F/s8.py" <<'PY2'
import importlib.util, os, signal, sys
spec = importlib.util.spec_from_file_location("lead_integrate", sys.argv[1])
li = importlib.util.module_from_spec(spec)
spec.loader.exec_module(li)
walk = li.rr._note_index
def index(tasks_dir):   # the TERM lands as suite-started walks the vault
    os.kill(os.getpid(), signal.SIGTERM)
    return walk(tasks_dir)
li.rr._note_index = index
sys.exit(li.main(sys.argv[2:]))
PY2
HOME="$SH_HOME" THREAD_EVENTS_DIR="$SEV" python3 "$F/s8.py" "$LI" verify --tree "$WT" --out "$F/out/s8" --timeout 60 --slots 1 --slot-wait 60 --rollout "$V/ro.md" --slug "$SLUG" --verifier "touch '$F/s8.ran'" >/dev/null 2>&1; rc=$?
ok "$rc|$(cat "$F/out/s8.rc" 2>/dev/null)" "143|143" "S8: a TERM in suite-started's vault walk: exit 143 and <out>.rc reads 143"
ok "$([ -e "$F/s8.ran" ] && echo ran || echo never)|$(sq '[d["kind"] for d in L]')" "never|[]" "S8: the verifier never ran, and no line was written"
ok "$(python3 "$root/skills/execute/scripts/verify-slot.py" status --slots 1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["slots"][0]["state"])')" free "S8: the slot is free"

# ======== M1–M6: base-moved, why main moved at a merge-task exit 3 (p29-10, ADR 0051) ===========================
# base-moved finds the task by its PR (the vault's pr:), fetches origin, classifies each first-parent commit base..main
# (a rollout's merge from the Run records or its task note, else a peer's push) and runs the Inert path test.
fx m1
MEV="$F/events"; MH="$F/home"; mkdir -p "$MH"
bm() {  # bm [args…]: base-moved for PR 5 with --base TB, the record in MEV, HOME an empty dir; its JSON in $J
  J=$(HOME="$MH" THREAD_EVENTS_DIR="$MEV" python3 "$LI" base-moved --repo "$R" --pr "${PRN:-5}" --base "$TB" --main "$B" --default master --tasks-dir "$V" "$@" 2>"$F/bm.err"); rc=$?
}
mq() { python3 -c 'import json,sys; ls=[json.loads(l) for l in open(sys.argv[1])]; print(json.dumps(eval(sys.argv[2]), separators=(",", ":")))' "$MEV/ro.jsonl" "$1" 2>/dev/null || echo none; }
HOME="$MH" THREAD_EVENTS_DIR="$MEV" python3 "$root/skills/_shared/scripts/run_record.py" emit --rollout other-ro --task other-t --kind merged --json '{"pr":"https://github.com/O/R/pull/9"}'
printf -- '---\ntags: [task]\nstatus: done\nrollout: "[[r2]]"\npr: https://github.com/o/r/pull/11\n---\n\nnote-t\n' > "$V/note-t.md"
main x.txt "x" "feat: x (#9)"; C1=$B
main y.txt "y" "a peer's push"; C2=$B
main z.txt "z" "fix: z (#11)"; C3=$B
bm --refusal 1
ok "$rc|$(j "$J" 'd["written"]')" "0|true" "M1: exit 0, one line written"
ok "$(mq '[[l["kind"], l["task"], l["pr"], l["base"], l["main"], l["refusal"], l["moversTotal"]] for l in ls]')" "[[\"base-moved\",\"$SLUG\",5,\"$TB\",\"$C3\",1,3]]" "M1: one base-moved for the task, with its PR, base, main and refusal"
ok "$(mq 'ls[0]["movers"]')" "[{\"sha\":\"$C1\",\"kind\":\"rollout\",\"pr\":9,\"rollout\":\"other-ro\",\"task\":\"other-t\",\"source\":\"record\"},{\"sha\":\"$C2\",\"kind\":\"peer\"},{\"sha\":\"$C3\",\"kind\":\"rollout\",\"pr\":11,\"rollout\":\"r2\",\"task\":\"note-t\",\"source\":\"note\"}]" \
  "M1–M3: oldest first: a rollout's merge from the record (owner/name read ignoring case), a PR-less peer push, a rollout's merge from its task note"
ok "$(mq '[ls[0]["inertOnly"], ls[0]["pathsTotal"], ls[0]["nonInert"], "error" in ls[0]]')" '[false,3,["x.txt","y.txt","z.txt"],false]' "M4: no inert_paths: inertOnly false, the paths named"
# M2b: a bare-number merged line matches only by its task: #11's line under another task stays a note match.
HOME="$MH" THREAD_EVENTS_DIR="$MEV" python3 "$root/skills/_shared/scripts/run_record.py" emit --rollout third-ro --task not-note-t --kind merged --json '{"pr":11}'
HOME="$MH" THREAD_EVENTS_DIR="$MEV" python3 "$root/skills/_shared/scripts/run_record.py" emit --rollout fourth-ro --task note-t --kind merged --json '{"pr":"#11"}'
bm
ok "$(mq '[ls[-1]["movers"][2]["rollout"], ls[-1]["movers"][2]["source"], "refusal" in ls[-1]]')" '["fourth-ro","record",false]' "M2: a bare-number merged line counts only under the PR's own task"
PRN=77 bm
ok "$rc|$(j "$J" 'd["written"]')|$(mq 'len(ls)')" "0|false|2" "M5: no task note names the PR: nothing written"
B=$(sha f) bm
ok "$rc|$(mq '[ls[-1]["inertOnly"], ls[-1]["movers"], ls[-1]["moversTotal"], ls[-1]["error"][:24]]')" '0|[null,[],0,"main ffffffffffff is not"]' "M6: main not readable: null beside its error, movers []"
ok "$(python3 "$LI" base-moved --repo "$R" --pr x --base "$TB" --main "$B" --default master >/dev/null 2>&1; echo $?)" 2 "M6: a bad --pr is a usage error"
# M4: the Inert path test on the repo's inert_paths (an ssh GitHub origin, as C30's): only THREAD.md moved → true; a
# source file beside it → false; a refused rollouts.toml → null beside its error.
ifx m4 '["THREAD.md"]'
MEV="$F/events"; MH="$IH"
main THREAD.md "close-out" "docs(thread): close-out"
bm
ok "$(mq '[ls[0]["inertOnly"], ls[0]["globs"], ls[0]["nonInert"], ls[0]["movers"][0]["kind"]]')" '[true,["THREAD.md"],[],"peer"]' "M4: a THREAD.md-only move: inertOnly true"
main src.py "print(1)" "feat: src"
bm
ok "$(mq '[ls[1]["inertOnly"], ls[1]["nonInert"], ls[1]["moversTotal"]]')" '[false,["src.py"],2]' "M4: a source file beside it: inertOnly false"
printf '[repo."o/r"]\ninert_paths = ["THREAD.md"]\n' > "$IH/.config/thread/rollouts.toml"
bm
ok "$(mq '[ls[2]["inertOnly"], ls[2]["error"][:12], ls[2]["moversTotal"]]')" '[null,"inert test: ",2]' "M4: a refused rollouts.toml: inertOnly null beside its error"
unset SRV LOG_SSH GIT_SSH_COMMAND GIT_SSH_VARIANT

# ======== R1–R13: the RACE revert (lead-integrate.py revert, ADR 0046) ===========================================
# A RACE red after the Flake check is reverted on main through a revert PR that merges only through merge-task. rvfx is
# fx (or ifx, for the Inert cases R4b–R4e) plus M, the task's squash merge on origin's master (PR #5 MERGED as M), the
# rollout's RACE line and `revert started: M`, and a queued proj-t6. srv refuses a non-fast-forward push, the fake gh's
# squash takes the PR head's tree (squash.tree head) and a PR it opened follows its branch (headRefOid.live).
RVH="$tmp/rv-home"; mkdir -p "$RVH"
rvfx() {
  if [ $# -gt 1 ]; then ifx "$1" "$2"; RVHOME="$IH"; else fx "$1"; RVHOME="$RVH"; fi
  RVEV="$F/events"; mkdir -p "$RVEV"
  git --git-dir "$MT_SRV" config receive.denyNonFastForwards true
  g -C "$F/p" fetch -q origin; g -C "$F/p" checkout -q master
  g -C "$F/p" merge -q --squash "origin/$BR" >/dev/null 2>&1; g -C "$F/p" commit -q -m "task t5 (#5)"; g -C "$F/p" push -q origin master
  M=$(git -C "$F/p" rev-parse HEAD); B=$M
  mkpr 5 "$H0"; echo MERGED > "$MT_STATE/pr/5/state"; echo "$M" > "$MT_STATE/pr/5/mergeCommit"
  echo head > "$MT_STATE/squash.tree"
  printf -- '- [[proj-t6]]\n' >> "$V/ro.md"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[ro]]"\n---\n\nt6\n' > "$V/proj-t6.md"
  printf '\n## Race log\n\n- 2026-10-02T12:00+00:00 [[%s]] RACE: PR #5 merged as %s on parent %s at head %s, not the integrated pair (head %s, base %s); origin/master holds an unverified combination; re-verify it\n- 2026-10-02T12:10+00:00 [[%s]] revert started: %s (re-verify rc 1, red after the Flake check)\n' \
    "$SLUG" "$M" "$TB" "$H0" "$H0" "$TB" "$SLUG" "$M" >> "$V/ro.md"
}
rlog() { printf '%s\n' "$1" >> "$V/ro.md"; }   # one ## Race log line (the note's last section)
subro() { python3 -c 'import sys; p, a, b = sys.argv[1:]; t = open(p).read(); open(p, "w").write(t.replace(a, b))' "$V/ro.md" "$1" "$2"; }
rv() { : > "$MT_STATE/gh.log"; J=$(HOME="$RVHOME" THREAD_EVENTS_DIR="$RVEV" python3 "$LI" revert --repo "$R" --slug "$SLUG" --default master --merge "${RM:-$M}" --note "$V/$SLUG.md" --rollout "$V/ro.md" --gh-bin "$tmp/bin/gh" "$@" 2>"$F/rv.err"); rrc=$?; }
srvm() { git --git-dir "$MT_SRV" rev-parse refs/heads/master; }
srvrefs() { git --git-dir "$MT_SRV" for-each-ref --format='%(refname) %(objectname)' | tr '\n' ' '; }
npc() { grep -c '^pr create' "$MT_STATE/gh.log"; }
ngh() { grep -c . "$MT_STATE/gh.log"; }
rmt() {  # rmt [head base]: merge-task on the revert PR, its pair from $J unless given; base.seq is what GitHub's ref read returns
  local h="${1:-$(j "$J" 'd["head"]')}" b="${2:-$(j "$J" 'd["base"]')}"
  [ -n "${KEEPSEQ:-}" ] || printf '%s\n' "$b" > "$MT_STATE/base.seq"
  : > "$MT_STATE/gh.log"; out=$(PATH="$tmp/bin:$PATH" HOME="$RVHOME" THREAD_EVENTS_DIR="$RVEV" bash "$MT" "$R" "$RPR" "$h" "$b" 2>&1); rc=$?
}
rhold() { HOME="$RVHOME" THREAD_EVENTS_DIR="$RVEV" python3 "$RR" hold --tasks "$SLUG" --hold race --state "$1" --tasks-dir "$V"; }
rrow() { printf '%s' "$(j "$J" 'd["tail"]["reason"]')" | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind integration | THREAD_EVENTS_DIR="$RVEV" python3 "$RR" reconcile --result - --tasks-dir "$V" --now 2026-10-02T12:40:00Z >/dev/null; }
tail_apply() {  # the landing tail, in its order: the line (only when raceLog.reverted is null), hold race end, the set-aside row
  [ "$(j "$J" 'd["raceLog"]["reverted"]')" != null ] || rlog "$(j "$J" 'd["tail"]["line"]')"
  rhold end >/dev/null; rrow
}
gone() { [ -e "$R/.claude/worktrees/revert-$SLUG" ] && echo kept || echo removed; }

# R1: route pr. R3: a re-run before the merge reuses the branch and the PR. R2: merge-task 0, then reverted. R3: a re-run
# after landing. R8: the tail through reconcile frees the lane, and next starts the next task.
rvfx r1
rv --verifier true
ok "$rrc|$(j "$J" 'd["route"]')" "0|pr" "R1: a RACE red after the Flake check → route pr"
H1=$(j "$J" 'd["head"]'); RPR=$(j "$J" 'd["pr"]')
ok "$(git --git-dir "$MT_SRV" rev-list --parents -n 1 "$H1")" "$H1 $M" "R1: the revert head's parent is origin/master (M)"
ok "$(git --git-dir "$MT_SRV" diff --quiet "$TB" "$H1" && echo same || echo differs)" same "R1: … and its files are M^1's"
has "$(git --git-dir "$MT_SRV" log -1 --format=%B "$H1")" "This reverts commit $M." "R1: the commit body says This reverts commit M"
has "$(cat "$MT_STATE/pr/$RPR/body")" "This reverts commit $M" "R1: … and so does the PR body"
ok "$(srvm)" "$M" "R1: origin/master untouched (a revert merges only through merge-task)"
ok "$(j "$J" '[d["raceLog"], d["restores"], d["restoresBy"], d["base"], d["branch"], d["landedAfter"], d["restoredTo"]]')" \
  "[{\"opened\":null,\"reverted\":null},true,\"tree\",\"$M\",\"thread-revert/$SLUG-${M:0:12}\",0,\"$TB\"]" "R1: raceLog null, restores by tree, base M, its branch"
ok "$(gone)" removed "R1: the revert tree removed"
rlog "- 2026-10-02T12:11+00:00 [[$SLUG]] revert opened: PR #$RPR $(j "$J" 'd["url"]')"
rv --verifier true
ok "$rrc|$(j "$J" '[d["route"], d["pr"], d["head"], d["raceLog"]["opened"]]')|$(npc)" "0|[\"pr\",$RPR,\"$H1\",\"PR #$RPR https://github.com/o/r/pull/$RPR\"]|0" \
  "R3: a re-run before the merge reuses the branch and the PR (no pr create), raceLog.opened read"
rmt
ok "$rc" 0 "R2: merge-task on the revert PR → 0"
S=$(srvm)
rv --verifier true
ok "$rrc|$(j "$J" '[d["route"], d["revertCommit"], d["restores"], d["restoresBy"], d["landedAfter"], d["tail"]["unverified"]]')" "0|[\"reverted\",\"$S\",true,\"tree\",0,false]" \
  "R2: revert again → reverted, its commit the PR's merge, main back at M^1's tree"
has "$(j "$J" 'd["tail"]["line"]')" "[[$SLUG]] reverted on main: $S (revert PR #$RPR of PR #5's merge ${M:0:12}; main back at ${TB:0:12}'s tree); set aside for Lachy" "R2: tail.line"
ok "$(j "$J" 'd["tail"]["reason"]')" "RACE: the re-verify was red after the Flake check; its merge ${M:0:12} is reverted on main by ${S:0:12}" "R2: tail.reason"
rv --verifier true
ok "$(j "$J" '[d["route"], d["revertCommit"]]')|$(npc)" "[\"reverted\",\"$S\"]|0" "R3: a re-run after landing → reverted, revertCommit the PR's mergeCommit"
tail_apply
ok "$(fm "$V/$SLUG.md" integrating)|$(grep -c 'reverted on main:' "$V/ro.md")" "<none>|1" "R8: the set-aside row removes integrating:; one reverted on main: line"
has "$(cat "$RVEV/ro.jsonl")" '"lane-freed"' "R8: … lane-freed recorded"
N=$(nxt "")
ok "$(j "$N" '[d["laneHold"], d["start"], [h["slug"] for h in d["raceHold"]]]')" "[[],[\"proj-t6\"],[\"$SLUG\"]]" "R8: next: the lane free, proj-t6 starts, the RACE still in raceHold for Lachy"

# R4: a peer push of src.py after the PR opened (no rollouts.toml): the branch takes origin/master by a merge, pushed as a
# fast-forward; restores false.
rvfx r4
rv --verifier true; H1=$(j "$J" 'd["head"]'); RPR=$(j "$J" 'd["pr"]')
main src.py "print(1)" "a peer's push"; X=$B
rv --verifier true; H2=$(j "$J" 'd["head"]')
ok "$rrc|$(j "$J" '[d["route"], d["pr"], d["base"]]')" "0|[\"pr\",$RPR,\"$X\"]" "R4: a peer push after the PR opened: revert again → the same PR on base X"
ok "$(git --git-dir "$MT_SRV" rev-list --parents -n 1 "$H2")" "$H2 $H1 $X" "R4: … origin/master merged into the branch (H2 = H1 + X), a fast-forward push (no --force)"
ok "$(j "$J" '[d["restores"], d["restoresBy"], d["landedAfter"]]')" "[false,null,1]" "R4: … restores false, landedAfter 1"
has "$(j "$J" 'd["inert"]["why"]')" "no inert_paths for this repo" "R4: … inert.why"
rmt; ok "$rc" 0 "R4: merge-task (H2, X) → 0"
rv --verifier true
ok "$(j "$J" '[d["route"], d["restores"], d["restoresBy"], d["tail"]["unverified"]]')" '["reverted",false,null,true]' "R4: revert → reverted, not restored"
has "$(j "$J" 'd["tail"]["line"]')" "main not re-verified: 1 commit(s) landed after ${M:0:12}); set aside for Lachy" "R4: … tail.line: main not re-verified"
has "$(j "$J" 'd["tail"]["reason"]')" "; main not re-verified: 1 commit(s) landed after ${M:0:12}" "R4: … and tail.reason"

# R5: a conflict → route conflict, nothing pushed, the tree removed.
rvfx r5
main a.txt "$(printf 'A1 peer\na2\na3\na4\na5')" "a peer's edit of the task's line"
refs0=$(srvrefs)
rv
ok "$rrc|$(j "$J" '[d["route"], d["conflictFiles"]]')" '0|["conflict",["a.txt"]]' "R5: reverting M conflicts → route conflict, the file named"
ok "$(srvrefs)|$(npc)|$(gone)" "$refs0|0|removed" "R5: … nothing pushed, no PR, the tree removed"

# R6: the target guard refuses (exit 1, no pr create, srv unchanged); (a)–(e) before any gh call. A two-parent M reverts with -m 1.
rvfx r6
cp "$V/ro.md" "$F/ro.keep"; cp "$V/$SLUG.md" "$F/t.keep"; refs0=$(srvrefs)
refuse() {  # refuse <label> [rv args]
  local l="$1"; shift; rv "$@"
  ok "$rrc|$(npc)|$(srvrefs)" "1|0|$refs0" "R6 $l: refused (exit 1), no pr create, srv unchanged"
}
grep -v ' RACE: PR #5 merged as ' "$F/ro.keep" > "$V/ro.md"; refuse "(a) no RACE line"; ok "$(ngh)" 0 "R6 (a): … no gh call"
cp "$F/ro.keep" "$V/ro.md"
RM=$TB refuse "(b) an unrelated --merge"; ok "$(ngh)" 0 "R6 (b): … no gh call"
grep -v '^integrating:' "$F/t.keep" > "$V/$SLUG.md"; refuse "(c) no integrating:"; ok "$(ngh)" 0 "R6 (c): … no gh call"
cp "$F/t.keep" "$V/$SLUG.md"
grep -v ' revert started: ' "$F/ro.keep" > "$V/ro.md"; refuse "(d) no revert started:"; ok "$(ngh)" 0 "R6 (d): … no gh call"
cp "$F/ro.keep" "$V/ro.md"
rlog "- 2026-10-02T12:20+00:00 [[$SLUG]] revert did not land: conflict in a.txt"; refuse "(e) a revert did not land: line"; ok "$(ngh)" 0 "R6 (e): … no gh call"
cp "$F/ro.keep" "$V/ro.md"
echo "$TB" > "$MT_STATE/pr/5/mergeCommit"; refuse "(f) PR #5's mergeCommit is not M"
echo "$M" > "$MT_STATE/pr/5/mergeCommit"
g -C "$R" checkout -q --detach; echo z > "$R/z.txt"; g -C "$R" add z.txt; g -C "$R" commit -q -m local; L=$(git -C "$R" rev-parse HEAD); g -C "$R" checkout -q master
subro "$M" "$L"; echo "$L" > "$MT_STATE/pr/5/mergeCommit"
RM=$L refuse "(g) M not on origin"
has "$(cat "$F/rv.err")" "is not on origin/master" "R6 (g): … saying so"
cp "$F/ro.keep" "$V/ro.md"; echo "$M" > "$MT_STATE/pr/5/mergeCommit"
g -C "$F/p" checkout -q -b side "$M"; printf 'side\n' > "$F/p/side.txt"; g -C "$F/p" add side.txt; g -C "$F/p" commit -q -m side
g -C "$F/p" checkout -q master; g -C "$F/p" merge -q --no-ff -m "Merge pull request #5 from o/side" side; g -C "$F/p" push -q origin master
M2=$(git -C "$F/p" rev-parse HEAD); subro "$M" "$M2"; echo "$M2" > "$MT_STATE/pr/5/mergeCommit"
RM=$M2 rv
ok "$rrc|$(j "$J" 'd["route"]')|$(git --git-dir "$MT_SRV" diff --quiet "$M" "$(j "$J" 'd["head"]')" && echo same || echo differs)" "0|pr|same" "R6: a two-parent M is reverted with -m 1 (the head's files are its first parent's)"
# R6h: a RACE line for another PR naming [[S]] (a lead's mistake) is skipped: the guard reads PR #5's.
rvfx r6h
rlog "- 2026-10-02T12:15+00:00 [[$SLUG]] RACE: PR #77 merged as $TB on parent $TB at head $TB, not the integrated pair"
rv
ok "$rrc|$(j "$J" 'd["route"]')" "0|pr" "R6h: another PR's RACE line under [[S]] → the guard still reads PR #5's line and passes"

# R7: origin unreachable → 8, nothing opened.
rvfx r7
g -C "$R" remote set-url origin "$F/nowhere.git"
rv
ok "$rrc|$(npc)" "8|0" "R7: origin unreachable → exit 8 (retryable), nothing opened"

# R9: a stale open revert PR, M undone by hand on main meanwhile → noop, the PR named in the tail.
rvfx r9
rv; RPR=$(j "$J" 'd["pr"]'); URL=$(j "$J" 'd["url"]')
g -C "$F/p" revert --no-edit "$M" >/dev/null; g -C "$F/p" push -q origin master; HR=$(git -C "$F/p" rev-parse HEAD)
rv
ok "$rrc|$(j "$J" '[d["route"], d["openPr"]["number"], d["restores"], d["restoresBy"]]')" "0|[\"noop\",$RPR,true,\"tree\"]" "R9: M undone by hand on main → noop, the open revert PR named"
has "$(j "$J" 'd["tail"]["line"]')" "reverted on main: $HR (no revert needed: PR #5's merge ${M:0:12}'s change is already gone from master; main back at ${TB:0:12}'s tree); stale revert PR #$RPR ($URL) is still open and must not merge: close it; set aside for Lachy" "R9: tail.line names the stale PR"
has "$(j "$J" 'd["tail"]["reason"]')" "stale revert PR #$RPR ($URL) is still open and must not merge: close it" "R9: … and tail.reason"

# R10: an Engine snapshot mismatch → exit 2 with its line, nothing fetched, no gh call, the notes byte-identical.
rvfx r10
python3 -c 'import sys; p = sys.argv[1]; t = open(p).read(); open(p, "w").write(t.replace("protocol_version: 5\n", "protocol_version: 5\nengine_snapshot: /nonexistent/thread-engine-snapshot\n", 1))' "$V/ro.md"
main y.txt "y" "a peer's push"
t0=$(cksum < "$V/$SLUG.md"); r0=$(cksum < "$V/ro.md"); o0=$(git -C "$R" rev-parse origin/master)
rv
ok "$rrc" 2 "R10: an Engine snapshot mismatch → exit 2"
has "$(cat "$F/rv.err")" "engine-snapshot: " "R10: … its engine-snapshot: line"
ok "$(ngh)|$(git -C "$R" rev-parse origin/master)|$(cksum < "$V/$SLUG.md")|$(cksum < "$V/ro.md")" "0|$o0|$t0|$r0" "R10: … nothing fetched, no gh call, the notes byte-identical"

# R11: merge-task's exit 3 on the revert PR (a peer push) → revert again (H2 = H1 + X) → merge-task 0 → reverted.
rvfx r11
rv; H1=$(j "$J" 'd["head"]'); RPR=$(j "$J" 'd["pr"]')
main x.txt "x" "a peer's push"; X=$B
printf '%s\n' "$X" > "$MT_STATE/base.seq"; KEEPSEQ=1 rmt "$H1" "$M"
ok "$rc" 3 "R11: merge-task on the revert PR after a peer push → exit 3 (base moved)"
ok "$(cat "$RVEV/ro.jsonl" 2>/dev/null | grep -c '"base-moved"')|$(cat "$R/.claude/merge-task/$RPR.base-moved" 2>/dev/null)" "0|$M" "R11: … base-moved writes nothing (no task note names the revert PR); the counter appended"
rv; H2=$(j "$J" 'd["head"]')
ok "$(git --git-dir "$MT_SRV" rev-list --parents -n 1 "$H2")" "$H2 $H1 $X" "R11: revert again → H2 with parents H1 and X"
rmt; ok "$rc" 0 "R11: merge-task (H2, X) → 0"
rv; ok "$(j "$J" '[d["route"], d["restores"]]')" '["reverted",false]' "R11: revert → reverted, restores false (x.txt landed after M)"

# R12: the crash tail: pending until the set-aside row; the re-run never appends the line twice; hold end is idempotent.
rvfx r12
rhold start >/dev/null
rv; RPR=$(j "$J" 'd["pr"]'); rlog "- 2026-10-02T12:11+00:00 [[$SLUG]] revert opened: PR #$RPR $(j "$J" 'd["url"]')"
rmt; ok "$rc" 0 "R12: merge-task on the revert PR → 0"
N=$(nxt ""); ok "$(j "$N" 'd["laneHold"]')" "[{\"slug\":\"$SLUG\",\"hold\":\"race\",\"revert\":true}]" "R12: merged, the tail not run (a crash) → next: revert true"
rv; rlog "$(j "$J" 'd["tail"]["line"]')"
N=$(nxt ""); ok "$(j "$N" 'd["laneHold"][0]["revert"]')" true "R12: the line written, integrating: standing (a crash before hold end) → still pending"
rv; ok "$(j "$J" '[d["route"], d["raceLog"]["reverted"] is not None]')" '["reverted",true]' "R12: the re-run reads the line (raceLog.reverted), so it is not appended again"
o1=$(rhold end); o2=$(rhold end)
ok "$o1|$o2" "$SLUG: hold-ended race [written]|$SLUG: hold-ended race [no-change]" "R12: hold race end twice → [written], then [no-change]"
rrow
N=$(nxt ""); ok "$(j "$N" 'd["laneHold"]')|$(grep -c 'reverted on main:' "$V/ro.md")" "[]|1" "R12: after the row the lane is free; one reverted on main: line"

# R13: merge-task's exit 5 on the revert PR (GitHub squashed it onto X2): it is on main, so revert routes reverted; no
# `revert did not land:` line, merge-task's RACE line is never appended, and the lane stays held (main not re-verified).
rvfx r13
printf -- '---\ntags: [task]\nstatus: done\nrollout: "[[ro]]"\n---\n\nt6\n' > "$V/proj-t6.md"
rv; H1=$(j "$J" 'd["head"]'); RPR=$(j "$J" 'd["pr"]')
main x2.txt "x2" "a peer's push"; X2=$B
g clone -q "$MT_SRV" "$F/r13c" 2>/dev/null; g -C "$F/r13c" revert --no-edit "$M" >/dev/null; g -C "$F/r13c" push -q origin HEAD:refs/scratch/r13
git -C "$F/r13c" rev-parse 'HEAD^{tree}' > "$MT_STATE/squash.tree"   # the real revert's tree on X2, its objects on srv
echo "$X2" > "$MT_STATE/squash-parent"; printf '%s\n' "$M" > "$MT_STATE/base.seq"
KEEPSEQ=1 rmt "$H1" "$M"
ok "$rc" 5 "R13: GitHub squashed the revert onto X2 → merge-task exit 5"
has "$out" "RACE: PR #$RPR merged as" "R13: … merge-task printed its RACE line"
rv --verifier true
ok "$(j "$J" '[d["route"], d["restores"], d["landedAfter"]]')" '["reverted",false,1]' "R13: revert → reverted (it is on main), restores false, landedAfter 1"
tail_apply
N=$(nxt "")
ok "$(j "$N" '[d["laneHold"], d["halt"], d["mainRed"]]')" "[[{\"slug\":\"$SLUG\",\"hold\":\"race\",\"revert\":false}],\"race\",[]]" "R13: next keeps the lane held (main not re-verified) and halts race; mainRed []"
ok "$(grep -c 'revert did not land:' "$V/ro.md")|$(grep -c "RACE: PR #$RPR" "$V/ro.md")" "0|0" "R13: no revert did not land: line, and no RACE: PR #R line"
HOME="$RVHOME" python3 "$RR" resume --rollout "$V/ro.md" --tasks-dir "$V" --gh-bin "$tmp/bin/gh" >/dev/null 2>&1
ok "$(fm "$V/$SLUG.md" status)" "status: blocked" "R13: resume never flips it"

# R4b–R4e: restores by ADR 0045's Inert check (ifx: the ssh origin o/r, HOME's rollouts.toml, the Run record).
rvfx r4b '["THREAD.md"]'
main THREAD.md "a peer's close-out" "docs(thread): close-out"; X=$B
rv --verifier true; RPR=$(j "$J" 'd["pr"]')
ok "$rrc|$(j "$J" '[d["route"], d["restores"], d["restoresBy"]]')" '0|["pr",true,"inert"]' "R4b: a peer close-out in THREAD.md only → restores by inert on the head"
rmt; ok "$rc" 0 "R4b: merge-task → 0"
S=$(srvm)
rv --verifier true
ok "$(j "$J" '[d["route"], d["restores"], d["restoresBy"], d["tail"]["unverified"]]')" '["reverted",true,"inert",false]' "R4b: revert → reverted, restored but for Inert paths"
has "$(j "$J" 'd["tail"]["line"]')" "main back at ${TB:0:12}'s tree but for Inert paths (1 path(s): THREAD.md))" "R4b: tail.line"
ok "$(iline '[[l["kind"], l["base"], l["head"], l["main"], l["paths"]] for l in ls][-1]')" "[\"verify-skipped\",\"$TB\",\"$S\",\"$S\",[\"THREAD.md\"]]" "R4b: the Run record's verify-skipped line: base M^1, head and main the squash"
ok "$(iline '[l["kind"] for l in ls if l["kind"] != "verify-skipped"]')" '[]' "R4b: … and no inert-proof-failed line"
tail_apply
N=$(nxt ""); ok "$(j "$N" '[d["laneHold"], d["start"]]')" '[[],["proj-t6"]]' "R4b: after the tail's row the lane is free and proj-t6 starts"
rvfx r4c '["THREAD.md"]'
printf -- '---\ntags: [task]\nstatus: done\nrollout: "[[ro]]"\n---\n\nt6\n' > "$V/proj-t6.md"
main THREAD.md "close-out"; main src.py "print(1)"
rv --verifier true; RPR=$(j "$J" 'd["pr"]')
ok "$(j "$J" '[d["route"], d["restores"], d["restoresBy"], d["inert"]["nonInert"]]')" '["pr",false,null,["src.py"]]' "R4c: src.py beside THREAD.md → restores false, src.py non-inert"
rmt; rv --verifier true; tail_apply
N=$(nxt ""); ok "$(j "$N" '[d["laneHold"], d["halt"]]')" "[[{\"slug\":\"$SLUG\",\"hold\":\"race\",\"revert\":false}],\"race\"]" "R4c: … the lane stays held"
rvfx r4d '["THREAD.md"]'
printf '[repo."o/r"]\ninert_paths = ["THREAD.md"]\n' > "$IH/.config/thread/rollouts.toml"
main THREAD.md "close-out"
rv --verifier true
ok "$rrc|$(j "$J" '[d["restores"], d["restoresBy"]]')" "0|[false,null]" "R4d: a refused rollouts.toml → restores false"
has "$(j "$J" 'd["inert"]["why"]')" "rollout settings refused" "R4d: … inert.why names the refusal"
rvfx r4e '["THREAD.md"]'
main THREAD.md "close-out"
rv
ok "$(j "$J" '[d["restores"], d["inert"]["why"]]')" '[false,"no --verifier given: the verifier runs"]' "R4e: no --verifier → restores false, inert.why says so"
unset SRV LOG_SSH GIT_SSH_COMMAND GIT_SSH_VARIANT

# ======== C55: prepare's task-scoped failures set the task aside, exit 0 (ADR 0048, p29-7) ===================
# Each is that one task's (its tree, its anchor, its anchor ref): route `set-aside` with the text as reason, so the
# lead sets it aside and the Integration lane runs on. The environment's own failures stay exit 2 (the Lane hold).
fx c55
GD=$(git -C "$WT" rev-parse --absolute-git-dir)
printf '%s\n' "$H0" > "$GD/MERGE_HEAD"; : > "$GD/index.lock"
prep
ok "$prc|$(j "$J" 'd["route"]')" "0|set-aside" "C55: a merge in progress its tree cannot abort (index.lock held) → exit 0, set-aside"
has "$(j "$J" 'd["reason"]')" "could not abort the merge left in progress in $WT" "C55: … the reason names it"
rm -f "$GD/MERGE_HEAD"
fx c55b
GD=$(git -C "$WT" rev-parse --absolute-git-dir)
printf 'edit\n' >> "$WT/t.txt"; : > "$GD/index.lock"
prep
ok "$prc|$(j "$J" 'd["route"]')" "0|set-aside" "C55b: tracked changes it cannot stash → exit 0, set-aside"
has "$(j "$J" 'd["reason"]')" "tracked changes in $WT could not be stashed" "C55b: … named"
rm -f "$GD/index.lock"
fx c55c
g -C "$F/p" checkout -q --orphan orphan; printf 'o\n' > "$F/p/o.txt"; g -C "$F/p" add -A; g -C "$F/p" commit -q -m orphan
g -C "$F/p" push -q -f origin "orphan:$BR"; g -C "$F/p" checkout -q -f master
prep
ok "$prc|$(j "$J" 'd["route"]')" "0|set-aside" "C55c: an orphan PR branch → exit 0, set-aside"
has "$(j "$J" 'd["reason"]')" "no merge-base of the anchor" "C55c: … no merge-base"
fx c55d
J=$(python3 "$LI" prepare --repo "$R" --slug "$SLUG" --default nosuch --note "$V/$SLUG.md" 2>"$F/prep.err"); prc=$?
ok "$prc" 2 "C55d: a missing origin/<default> is still exit 2 (the environment: a Lane hold)"
has "$(cat "$F/prep.err")" "origin/nosuch does not exist" "C55d: … named"
fx c55e
X=$(git -C "$R" commit-tree "$(git -C "$R" rev-parse "$TB^{tree}")" -m dangling)
git -C "$R" update-ref "refs/integration-anchor/$BR" "$X"
mkdir -p "$(dirname "$R/.git/refs/integration-anchor/$BR")"; : > "$R/.git/refs/integration-anchor/$BR.lock"
prep
ok "$prc|$(j "$J" 'd["route"]')" "0|set-aside" "C55e: a held <ref>.lock → exit 0, set-aside"
has "$(j "$J" 'd["reason"]')" "could not delete the stale anchor ref refs/integration-anchor/$BR" "C55e: … named"
rm -f "$R/.git/refs/integration-anchor/$BR.lock"

# ======== C56: every note-read failure carries `task note unreadable:`; nothing else does (p29-7) ===========
# execute § 4.5 *lead-integrate's exit 2* reads that one marker: a note race on a task that holds no lane is that task's
# alone; any other exit 2 there (usage, an empty reason, a refused --max-review-rounds, git not runnable) stays whole.
fx c56
E=$(python3 "$LI" inputs --note "$V/missing.md" 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56: inputs on a missing note → exit 2"
has "$E" "lead-integrate inputs: task note unreadable: not found at" "C56: … with the marker"
printf 'no frontmatter\n' > "$V/bad.md"
E=$(python3 "$LI" plan --note "$V/bad.md" 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56b: plan on an unparseable note → exit 2"; has "$E" "lead-integrate plan: task note unreadable:" "C56b: … with the marker"
E=$(printf 'why\n' | python3 "$LI" set-aside --note "$V/bad.md" --kind own 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56b: set-aside --kind own on an unparseable note → exit 2"; has "$E" "lead-integrate set-aside: task note unreadable:" "C56b: … with the marker"
E=$(printf '' | python3 "$LI" set-aside --note "$V/$SLUG.md" --kind own 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56c: set-aside with an empty reason → exit 2"; lacks "$E" "task note unreadable:" "C56c: … no marker"
E=$(python3 "$LI" inputs --note "$V/$SLUG.md" --max-review-rounds 0 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56c: inputs --max-review-rounds 0 → exit 2"; lacks "$E" "task note unreadable:" "C56c: … no marker"
E=$(python3 "$LI" push --repo "$R" --slug "$SLUG" --head xyz 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56c: push --head xyz (argparse) → exit 2"; lacks "$E" "task note unreadable:" "C56c: … no marker"
NOGIT="$F/nogit"; mkdir -p "$NOGIT"; ln -sf "$(command -v python3)" "$NOGIT/python3"
E=$(PATH="$NOGIT" "$(command -v python3)" "$LI" push --repo "$R" --slug "$SLUG" --head "$H0" 2>&1 >/dev/null); rc=$?
ok "$rc" 2 "C56d: push under a PATH with no git → exit 2"; has "$E" "lead-integrate push: git not runnable:" "C56d: … git not runnable"

echo; [ "$fail" -eq 0 ] && echo "lead-integrate: ALL PASS" || echo "lead-integrate: SOME FAILED"
exit "$fail"
