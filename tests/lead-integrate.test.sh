#!/usr/bin/env bash
# p12-9 (ADR 0030 decision 3), executed: the lead's side of Integration, skills/execute/scripts/lead-integrate.py
# (prepare, verify, push, undo, inputs, set-aside, stamp), with reconcile-rollout.py, merge-task.sh and the
# engine (tests/lib/engine.mjs) where a case crosses into them. Fixtures: a real bare "GitHub" origin under a
# github.com/o/r.git path, the fake gh (tests/lib/merge-task-env.sh, tests/fixtures/merge-task/fake-gh.py), the
# project checkout, the task tree at .claude/worktrees/proj-t5 and a temp vault. Engine-only cases use fake SHAs.
#   C1  main unmoved: merge route, the lead's log line, merge-task 0, mark-done.
#   C2  main moved: the lead merges, verifies (the SKILL.md verify line), pushes, logs and merges — no agent.
#   C3  a shared file   C4  a conflict   C5  red, undo   C6  case (ii) from an engine line   C7  the own run merged
#   main; a stale anchor ref   C8  a missing or unpushed tree, leftovers, a gone branch   C9  push refused
#   C10 landed   C11 engine pins   C12 inputs parity   C13a exit-4 plumbing   C13b a dead integrate call
#   C13c lead-written own and revise-stopped rows   C14 a rejection frees the lane while another integrates
#   C15 the verify line under bash and zsh -f   C16 stamp, usage, an unreachable origin   C17 timeouts, signals,
#   the bootstrap, the race tree   C18 no relaunch loop   C19 an Integration set-aside re-enters   C20 the last
#   task rejected.
# Hermetic: temp repos, PATH shim, ssh disabled, every merge-task interval 0.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

tmp=$(cd "$(mktemp -d)" && pwd -P); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
. tests/lib/merge-task-env.sh
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
# task tree as the engine's setup leaves it; V the vault: ro.md and $SLUG.md (review, pr: #5, ready:).
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
  printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nrollout: "[[ro]]"\npr: %s\nready: 2026-10-02T11:00+00:00\nreview_rounds_used: 1\n---\n\n## Notes\n\nt5\n' "$PR" > "$V/$SLUG.md"
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
# The SKILL.md verify line (between its markers), filled in: verify_line <tree> <slug> <verifier> [bootstrap]
verify_line() {
  python3 - "$SKILL" "$R" "$@" <<'PY'
import re, sys
skill, repo, tree, slug, verifier = sys.argv[1:6]
boot = sys.argv[6] if len(sys.argv) > 6 else ""
text = open(skill).read()
m = re.search(r"^# thread:integration-verify[^\n]*\n(.*?)^# end thread:integration-verify", text, re.S | re.M)
if not m:
    print("NO-VERIFY-BLOCK"); sys.exit(0)
line = m.group(1).strip()
if not boot:
    line = line.replace(' --bootstrap "<env_bootstrap>"', "")
line = (line.replace("<tree>", tree).replace("<repoPath>", repo).replace("<slug>", slug)
        .replace("<env_bootstrap>", boot).replace("<verifier>", verifier))
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
  "task": {"slug": slug, "taskPath": "", "scope": "cross-cutting", "planGate": False, "maxIterations": 3,
           "maxReviewRounds": maxr, "maxPlanRounds": 3, "model": "fable"},
  "integration": {"prUrl": f"https://github.com/o/r/pull/{ord(slug[-1])}", "branch": f"audit-fix/{alias}",
    "worktreePath": f"/repo/.claude/worktrees/{slug}", "headSha": s("a"), "taskBase": s("b"), "mainSha": s("c"),
    "trouble": ["shared-file"], "landed": [], "plan": "", "reviewHistory": hist, "reviewRoundsUsed": used,
    "rung": {"model": "fable", "escalated": False, "escalatedAt": "", "tierCapped": False, "tierCappedAt": ""},
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
for k in branch worktreePath prHead anchor taskBase mainSha case route trouble reason landed; do
  ok "$(j "$J" "'$k' in d")" true "C1: prepare prints $k"
done
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
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "trouble|[]" "C8: an unpushed commit in the tree → trouble []"
has "$(j "$J" 'd["reason"]')" "commit(s) origin/$BR lacks" "C8: … naming it"
g -C "$R" worktree remove --force "$WT"
prep
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["trouble"]')" "trouble|[]" "C8: a missing tree → trouble []"
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
main z.txt "z" "a direct push"
prep
ok "$(j "$J" 'd["landed"]')" "[]" "C10: a commit with no PR number → landed []"
has "$(j "$J" 'd["note"]')" "names no PR" "C10: … and says why"

# ======== C11: engine pins (byte-equal) ===============================================================
echo "== c11"
CASES=$(python3 - <<'PY'
import json
H2 = [{"round": 1, "feedback": ["own-run fix"]}, {"round": 2, "feedback": ["keep their rename"], "stage": "integration"}]
HE = [{"round": 1, "feedback": ["", " "]}, {"round": 3, "feedback": ["a\nb", "  c  "]}]
reasons = ["merge step STOP: fetch origin failed twice", "integration: head moved after Integration (PR head x)",
           "INTEGRATION:  shouty", "  integration:x", "multi\nline\n reason", "", "integration: integration: doubled",
           "merge declined at the --gated hold"]
markers = [[k, r, h] for k in ("set-aside", "revise-stopped", "rejected") for r in reasons for h in ([], H2, HE)]
parse = ["revise: rejected at Integration re-review — revise on the branch, then re-integrate\nrevise stopped: x\n\nRound 1 rejection:\n- a\n- b\n\nRound 2 (Integration) rejection:\n- c",
         "integration: foo\n\nRound 1 rejection:\n- a", "Round 1:\n- a\n\nRound 2:\n- b", "", "  \n\nplain text\n- not a round",
         "REVISE: Rejected at integration re-review — x", "round 3 REJECTION:\n- y\nstray\n- z", "Round 1:\n-  spaced  \n- \n",
         " integration: spaced", "Round 01:\n- leading zero"]
minutes = [["2026-10-02T12:00+00:00", "2026-10-02T12:30+00:00"], ["2026-10-02T12:00:00Z", "2026-10-02T12:00:59Z"],
           ["2026-10-02T12:00:00Z", "2026-10-02T12:01:29.9Z"], ["2026-10-02T12:00:30Z", "2026-10-02T12:01:00Z"],
           ["2026-10-02T22:00+10:00", "2026-10-02T12:05Z"], ["2026-02-30T00:00Z", "2026-03-01T00:00Z"],
           ["2026-10-02T12:30Z", "2026-10-02T12:00Z"], [None, "2026-10-02T12:00Z"], ["2026-10-02T12:00+1000", "2026-10-02T02:10Z"],
           [" 2026-10-02T12:00Z ", "2026-10-02T12:01Z"], ["2024-02-29T00:00Z", "2024-03-01T00:00Z"], ["2026-10-02T24:00Z", "2026-10-03T00:00Z"],
           ["2026-10-02T12:00:59.6Z", "2026-10-02T12:02Z"], ["2026-10-02T12:00", "2026-10-02T12:01Z"]]
print(json.dumps({"slugs": ["proj-t5", "solo", "a-b-c"], "markers": markers, "own": ["plain", "integration: x",
  "revise: rejected at Integration re-review — x", "", "Integration: X", " own text"], "minutes": minutes, "parse": parse}))
PY
)
ENG=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['ANCHOR_RECIPE', 'shortAlias', 'worktreeDir', 'integrationMergeStep', 'integrationMarker', 'stageDiagnosis', 'wholeMinutes', 'parseIntegrationMarker'])
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
}, ensure_ascii=False))
PY
)
canon() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.dumps(d[sys.argv[2]], sort_keys=True, ensure_ascii=False))' "$1" "$2"; }
for k in recipe names mergeMsg markers own minutes parse; do
  ok "$(canon "$PY_" "$k")" "$(canon "$ENG" "$k")" "C11: lead-integrate's $k is byte-equal to the engine's"
done
ok "$(canon "$ENG" names)" '[["audit-fix/t5", "/r/.claude/worktrees/proj-t5"], ["audit-fix/solo", "/r/.claude/worktrees/solo"], ["audit-fix/b-c", "/r/.claude/worktrees/a-b-c"]]' "C11: the names themselves (control)"
ok "$(python3 -c 'import json,sys; print(sum(1 for x in json.loads(sys.argv[1])["markers"] if x.lower().startswith("integration: integration:")))' "$PY_")" 3 "C11: only the doubled-prefix reason (x3 histories) keeps a second prefix (the engine strips one)"

# ======== C12: inputs parity ============================================================================
nfx c12 4
ntask proj-a review "pr: $(p1pr proj-a)" 'review_rounds_used: 1' 'ready: 2026-10-02T11:00+00:00' 'tier_capped: review' 'model: fable'
ROW=$(erow "$(p1args proj-a 3)" "$(judge_changes proj-a 2)")
rec "$ROW"
setkey "$V/proj-a.md" tier_capped review
I=$(inp proj-a --max-review-rounds 3)
DIAG=$(printf '%s' "$ROW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tasks"][0]["blockerDiagnosis"])')
EP=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['parseIntegrationMarker'])
  process.stdout.write(JSON.stringify(T.parseIntegrationMarker(process.argv[1])))
" "$DIAG")
ok "$(j "$I" '[d["markerStage"], d["markerReason"], d["history"]]')" "$(j "$EP" '[d["stage"], d["reason"], d["history"]]')" "C12: an engine rejected marker, reconciled, parses to exactly parseIntegrationMarker's output"
ok "$(j "$I" '[d["source"], d["lastRound"], d["reviewRoundsUsed"], d["readyAt"], d["tierCapped"], d["tierCappedAt"], d["model"], d["resumeAt"]]')" \
  '["blocker",2,2,"2026-10-02T11:00+00:00",true,"review","fable","revise"]' "C12: source, rounds, readyAt, tier_capped, model, resumeAt revise"
ok "$(j "$I" 'd["lastIntegration"]["outcome"]')|$(j "$I" 'd["lastIntegration"]["path"]')" "rejected|judge-only" "C12: lastIntegration is the log's last line, as fields"
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
setkey "$V/$SLUG.md" tier_capped review
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
  ok "$(fm "$V/$SLUG.md" pr)|$(fm "$V/$SLUG.md" tier_capped)|$(fm "$V/$SLUG.md" integrating)" "pr: $PR|tier_capped: review|<none>" "C13a[$i]: pr: and tier_capped: kept, integrating: gone"
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
RES=$(node --input-type=module -e "
  import { loadEngine } from './tests/lib/engine.mjs'
  const T = loadEngine(['resumeArgsError'])
  const i = JSON.parse(process.argv[1])
  const resume = { stage: 'revise', prUrl: i.pr, branch: i.branch, worktreePath: '/repo/.claude/worktrees/proj-a', reviewHistory: i.history, reviewRoundsUsed: i.lastRound, plan: '' }
  process.stdout.write(JSON.stringify(T.resumeArgsError({ repoPath: '/repo', task: { slug: 'proj-a', scope: 'cross-cutting', resume } })))
" "$I")
ok "$RES" '""' "C14: the seeded revise's task.resume, built from inputs, passes resumeArgsError"
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
t0=$(date +%s)
python3 "$LI" verify --tree "$WT" --out "$F/out/v" --timeout 2 --verifier 'sleep 3171 & sleep 3172; wait' >/dev/null
el=$(( $(date +%s) - t0 ))
ok "$(cat "$F/out/v.rc")" 124 "C17: the deadline → rc 124"
ok "$([ "$el" -lt 15 ] && echo fast || echo "slow ${el}s")" fast "C17: … within 15 s"
ok "$(pgrep -f 'sleep 317[12]' | wc -l | tr -d ' ')" 0 "C17: no verifier child survives"
has "$(cat "$F/out/v.log")" "timed out after 2s" "C17: the log names the timeout"
python3 "$LI" verify --tree "$WT" --out "$F/out/t" --timeout 600 --verifier 'sleep 3173 & sleep 3174; wait' >/dev/null &
vp=$!
n=0; until grep -q '== verifier:' "$F/out/t.log" 2>/dev/null && [ "$(pgrep -f 'sleep 317[34]$' | wc -l | tr -d ' ')" -ge 1 ]; do n=$((n+1)); [ "$n" -gt 100 ] && break; sleep 0.1; done
kill -TERM "$vp"; wait "$vp"
ok "$(cat "$F/out/t.rc")" 143 "C17: TERM to verify → rc 143"
n=0; while [ "$(pgrep -f 'sleep 317[34]' | wc -l | tr -d ' ')" -gt 0 ] && [ "$n" -lt 30 ]; do n=$((n+1)); sleep 0.1; done
ok "$(pgrep -f 'sleep 317[34]' | wc -l | tr -d ' ')" 0 "C17: … and its children are gone"
main from-main.txt "dep" "theirs: dep (#7)"
prep; M=$(j "$J" 'd["mergeCommit"]')
python3 "$LI" verify --tree "$WT" --out "$F/out/b" --timeout 60 --bootstrap 'test -f from-main.txt && touch .boot-ok' --verifier 'test -f .boot-ok && echo verified' >/dev/null
ok "$(cat "$F/out/b.rc")" 0 "C17: the bootstrap runs after the merge checkout (it needs main's file), then the verifier"
python3 "$LI" verify --tree "$WT" --out "$F/out/b2" --timeout 60 --bootstrap 'exit 3' --verifier 'touch .verifier-ran' >/dev/null
ok "$(cat "$F/out/b2.rc")|$([ -e "$WT/.verifier-ran" ] && echo ran || echo skipped)" "3|skipped" "C17: a failing bootstrap → its rc; the verifier never runs"
has "$(cat "$F/out/b2.log")" "env_bootstrap failed; verifier not run" "C17: … and the log says so"
RT="$R/.claude/worktrees/race-$SLUG"
python3 "$LI" verify --repo "$R" --detach-at "$M" --tree "$RT" --out "$F/out/race" --timeout 60 --verifier 'test -f from-main.txt && false' >/dev/null
ok "$(cat "$F/out/race.rc")|$([ -e "$RT" ] && echo left || echo removed)" "1|removed" "C17: --detach-at verifies the race tree and removes it, even on red"
lacks "$(git -C "$R" worktree list)" "race-$SLUG" "C17: … unregistered too"
mkdir -p "$RT"
python3 "$LI" verify --repo "$R" --detach-at "$M" --tree "$RT" --out "$F/out/race2" --timeout 60 --verifier true >/dev/null 2>&1
ok "$?|$([ -e "$F/out/race2.rc" ] && echo rc || echo none)" "2|none" "C17: --detach-at refuses an existing path (no rc: red)"

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
  "task": {"slug": "proj-a", "taskPath": "", "scope": "cross-cutting", "planGate": False, "maxIterations": 3, "maxReviewRounds": 3,
           "maxPlanRounds": 3, "model": "fable", "resume": {"stage": "revise", "prUrl": sys.argv[2], "branch": i["branch"],
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

echo; [ "$fail" -eq 0 ] && echo "lead-integrate: ALL PASS" || echo "lead-integrate: SOME FAILED"
exit "$fail"
