#!/usr/bin/env bash
# p33-4 (ADR 0064), the hermetic rig: two projects' parallel rollouts on one repo, each in its own rollout clone, landing
# through the origin lane one Integration at a time, each re-verified on the main the other just moved. Script-driven
# (no lead, no Workflow call): the steps a lead's § 0, step 3 and step 4 run, in order, against a real bare
# `github.com/o/r.git` served over a fake ssh (tests/fixtures/land/fake-ssh.sh: the origin URL is git@github.com:o/r.git,
# so land.sh reads o/r), the fake gh (tests/lib/merge-task-env.sh, tests/fixtures/merge-task/fake-gh.py; its squash keeps
# the PR head's tree) and a temp vault.
#   S1  two clones, the waiter, in turn: `clone` gives Proj A the default clone and Proj B `project proj-b`; `--ensure`
#       makes each; both checks pass (B's with the WARN naming A); `branches` is clear. A takes the lane, B waits (4) and
#       origin-wait times out (75); A merges; A's next task yields to B (4) and B's origin wait returns (0); B takes the
#       lane, re-verifies on A's squash and merges; then A's re-verifies on B's. Each squash's only parent is the one
#       before it, and B's Integration log base is A's squash. The Mac-wide count reads A's running task (D7).
#   S2  D12: a merge-hold release re-enters with no mark-integrating; B, which took the lane during the hold, gets
#       merge-task's exit 3 (Base moved), and its step 3 again re-verifies on A's squash.
#   S3  D13/D14 end to end: a Base-moved re-run that yields (release=origin) keeps `integrating:`, status gives the row
#       originWait, and the Reflection counts one Integration across the yield.
# Hermetic: HOME, the Run record, the note locks, the verify slots and GIT_CONFIG_GLOBAL are temp; never the network.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd -P)
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
export TZ=UTC PYTHONDONTWRITEBYTECODE=1 THREAD_MACHINE_TIMES='{}' THREAD_HEAT_LEVEL=0
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

tmp=$(cd "$(mktemp -d)" && pwd -P); trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
export HOME="$tmp/home"; mkdir -p "$HOME"
printf '[init]\n\tdefaultBranch = master\n[user]\n\tname = t\n\temail = t@t\n' > "$tmp/gitconfig"
export GIT_CONFIG_GLOBAL="$tmp/gitconfig" GIT_CONFIG_NOSYSTEM=1
export THREAD_NOTE_LOCK_DIR="$tmp/note-locks" THREAD_VERIFY_SLOT_POLL=0.1
. tests/lib/merge-task-env.sh   # MT_SRV=$tmp/srv/github.com/o/r.git, MT_STATE, the fake gh in $tmp/bin, every interval 0
export THREAD_EVENTS_DIR="$tmp/events"
cp tests/fixtures/land/fake-ssh.sh "$tmp/bin/fake-ssh"; chmod +x "$tmp/bin/fake-ssh"
export SRV="$tmp/srv/github.com" LOG_SSH="$tmp/ssh.log" GIT_SSH_COMMAND="$tmp/bin/fake-ssh" GIT_SSH_VARIANT=ssh
export PATH="$tmp/bin:$PATH"
SC="$root/skills/execute/scripts/self-rollout-check.sh"
UR="$root/skills/_shared/scripts/unfinished-rollout.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
LI="$root/skills/execute/scripts/lead-integrate.py"
SCORE="$root/skills/reflect/scripts/score.py"
V="$tmp/vault/Work/Tasks"; mkdir -p "$V"
T="$tmp/repos/r"; D="$T-rollout"; P="$T-proj-b-rollout"
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v, separators=(",", ":")))' "$2"; }

# ---- the repo: origin's master with a Makefile, the in-place checkout T --------------------------------------------
fresh; echo head > "$MT_STATE/squash.tree"   # a clean fake-gh state; its squash keeps the PR head's tree
git clone -q git@github.com:o/r.git "$tmp/seed" 2>/dev/null
printf 'test:\n\ttrue\n' > "$tmp/seed/Makefile"; printf 'base\n' > "$tmp/seed/base.txt"
git -C "$tmp/seed" add -A && git -C "$tmp/seed" commit -q -m base && git -C "$tmp/seed" push -q origin master
B0=$(srvtip)
mkdir -p "$tmp/repos"; git clone -q git@github.com:o/r.git "$T" 2>/dev/null
srvhead() { git --git-dir "$MT_SRV" rev-parse "refs/heads/$1"; }
parents() { git --git-dir "$MT_SRV" rev-list --parents -n 1 "$1" | cut -d' ' -f2-; }
# branch <slug> <file>: the task's branch audit-fix/<alias>, one commit on origin's current master touching <file>
branch() {
  local s="$1" br="audit-fix/${1#*-}"
  git -C "$tmp/seed" fetch -q origin && git -C "$tmp/seed" checkout -q -B "$br" origin/master
  printf '%s\n' "$s" > "$tmp/seed/$2"; git -C "$tmp/seed" add -A && git -C "$tmp/seed" commit -q -m "task $s"
  git -C "$tmp/seed" push -q -f origin "$br"; git -C "$tmp/seed" checkout -q master
}
# tree <root> <slug>: the task's tree, as the engine's setup leaves it
tree() { git -C "$1" fetch -q origin && git -C "$1" worktree add -q "$1/.claude/worktrees/$2" -b "audit-fix/${2#*-}" "origin/audit-fix/${2#*-}" >/dev/null 2>&1; }
# pr <n> <slug>: the fake gh's PR n on the task's branch, its head the branch's tip
pr() {
  local d="$MT_STATE/pr/$1" br="audit-fix/${2#*-}"
  rm -rf "$d"; mkdir -p "$d"; echo OPEN > "$d/state"; echo master > "$d/baseRefName"; srvhead "$br" > "$d/headRefOid"
  echo "$br" > "$d/headRefName"; echo CLEAN > "$d/mergeStateStatus"; echo "https://github.com/o/r/pull/$1" > "$d/url"
}
mkro() {  # mkro <stem> <project> <root>
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\nprojects:\n  - "[[%s]]"\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n' "$2" "$3" > "$V/$1.md"
}
mkt() {  # mkt <slug> <rollout> <project> <pr n> [status]
  printf -- '---\ntags: [task]\nstatus: %s\nscope: cross-cutting\nprojects:\n  - "[[%s]]"\nrollout: "[[%s]]"\npr: https://github.com/o/r/pull/%s\nready: 2026-10-02T11:00+00:00\n---\n\n## Notes\n\n%s\n' "${5:-review}" "$3" "$2" "$4" "$1" > "$V/$1.md"
  printf -- '- [[%s]]\n' "$1" >> "$V/$2.md"
}
lease() { mkdir -p "$HOME/.config/thread/leases"; printf '{"rollout": "%s", "written_at": "%s", "by": "next"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HOME/.config/thread/leases/$1.json"; }
mi() { out=$(python3 "$RR" mark-integrating --tasks "$1" --tasks-dir "$V" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
md() { python3 "$RR" mark-done --tasks "$1" --tasks-dir "$V" >/dev/null 2>&1; }
prep() { J=$(python3 "$LI" prepare --repo "$1" --slug "$2" --default master --note "$V/$2.md" 2>"$tmp/prep.err"); prc=$?; }
logi() { python3 "$RR" log-integration --tasks "$1" --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$2" --head "$3" --base "$4" >/dev/null; }
# mt <root> <pr n> <head> <base>: merge-task, GitHub's ref read returning origin's real master tip
mt() { srvtip > "$MT_STATE/base.seq"; rm -f "$MT_STATE/base.cur"; out=$(bash "$MT" "$1" "$2" "$3" "$4" 2>&1); rc=$?; }
lanetaken() { python3 -c 'import json, sys; print(sum(1 for l in open(sys.argv[1]) if l.strip() and json.loads(l).get("kind") == "lane-taken" and json.loads(l).get("task") == sys.argv[2]))' "$THREAD_EVENTS_DIR/$1.jsonl" "$2"; }
vfy() { python3 "$LI" verify --tree "$1/.claude/worktrees/$2" --out "$1/.claude/integration/$2" --timeout 120 --verifier 'make test' >/dev/null 2>&1; cat "$1/.claude/integration/$2.rc" 2>/dev/null; }
push() { python3 "$LI" push --repo "$1" --slug "$2" --head "$3" >/dev/null 2>&1; echo $?; }
loglines() { awk '/^## Integration log/{on=1; next} /^## /{on=0} on && NF' "$V/$1.md"; }
ow() { out=$(python3 "$RR" origin-wait --tasks "$1" --tasks-dir "$V" "${@:2}" 2>/dev/null); rc=$?; }
# land <root> <slug> <pr n>: one Integration when main has not moved: prepare (route merge), log-integration, merge-task
land_unmoved() {
  prep "$1" "$2"; ok "$prc|$(j "$J" 'd["route"]')" "0|merge" "$4: prepare routes merge (main unmoved)"
  logi "$2" "$(j "$J" 'd["anchor"]')" "$(j "$J" 'd["prHead"]')" "$(j "$J" 'd["mainSha"]')"
  mt "$1" "$3" "$(j "$J" 'd["prHead"]')" "$(j "$J" 'd["mainSha"]')"; ok "$rc" 0 "$4: merge-task merges it"
}
# land_moved <root> <slug> <pr n> <label>: prepare routes verify (main moved), verify, push, log, prepare (case ii), merge
land_moved() {
  prep "$1" "$2"; ok "$prc|$(j "$J" 'd["route"]')" "0|verify" "$4: prepare routes verify (main moved)"
  local base m anchor; base=$(j "$J" 'd["mainSha"]'); m=$(j "$J" 'd["mergeCommit"]'); anchor=$(j "$J" 'd["anchor"]')
  LAST_BASE=$base
  ok "$(vfy "$1" "$2")" 0 "$4: the verifier ran green on the lead's merge of the moved main"
  ok "$(push "$1" "$2" "$m")" 0 "$4: push"
  logi "$2" "$anchor" "$m" "$base"
  prep "$1" "$2"; ok "$prc|$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')" "0|merge|ii" "$4: prepare again routes merge (case ii)"
  pr "$3" "$2"
  mt "$1" "$3" "$m" "$base"; ok "$rc" 0 "$4: merge-task merges it"
}

# ======== S1: two clones, the waiter, in turn =========================================================================
echo "== S1"
ok "$(python3 "$UR" clone --repo "$T" --project "Proj A" --tasks-dir "$V" 2>/dev/null)" default "S1: clone, Proj A, nothing unfinished → default"
ok "$(bash "$SC" --ensure "$T" 2>/dev/null)" "$D" "S1: --ensure makes D, the default clone"
ok "$(python3 "$UR" check --repo "$D" --project "Proj A" --tasks-dir "$V" 2>/dev/null)" none "S1: check --repo D for Proj A → none"
mkro proj-a-rollout-2026-11-02 "Proj A" "$D"   # its note and tasks, as step 6 writes them
for s in proj-a-t1:11 proj-a-t2:12 proj-a-t3:13; do mkt "${s%:*}" proj-a-rollout-2026-11-02 "Proj A" "${s#*:}"; done
ok "$(python3 "$UR" clone --repo "$T" --project "Proj B" --tasks-dir "$V" 2>/dev/null)" "project proj-b" "S1: clone, Proj B, A in D → project proj-b"
ok "$(bash "$SC" --ensure "$T" proj-b 2>/dev/null)" "$P" "S1: --ensure … proj-b makes P"
ok "$(bash "$SC" --in-place "$P")" "$T" "S1: … whose in-place twin is T"
out=$(python3 "$UR" check --repo "$P" --project "Proj B" --tasks-dir "$V" 2>"$tmp/err"); err=$(cat "$tmp/err")
ok "$out" none "S1: check --repo P for Proj B → none"
has "$err" "WARN: [[proj-a-rollout-2026-11-02]] (Proj A; never started) is another project's unfinished rollout on this repo, in its own clone $D" "S1: … with the WARN naming A"
mkro proj-b-rollout-2026-11-02 "Proj B" "$P"; mkt proj-b-t1 proj-b-rollout-2026-11-02 "Proj B" 21
ok "$(python3 "$UR" branches --repo "$P" --tasks proj-b-t1 --tasks-dir "$V" 2>/dev/null)" none "S1: branches → none"
branch proj-a-t1 a1.txt; branch proj-a-t2 a2.txt; branch proj-b-t1 b1.txt
tree "$D" proj-a-t1; tree "$D" proj-a-t2; tree "$P" proj-b-t1
pr 11 proj-a-t1; pr 12 proj-a-t2; pr 21 proj-b-t1
lease proj-a-rollout-2026-11-02; lease proj-b-rollout-2026-11-02
mi proj-a-t1; ok "$rc" 0 "S1: A's mark-integrating for a1 → 0"
mi proj-b-t1; ok "$rc" 4 "S1: B's for b1 → 4"
has "$err" "ORIGIN LANE: [[proj-a-rollout-2026-11-02]]'s [[proj-a-t1]] integrates on o/r" "S1: … the holder line"
ow proj-b-t1 --timeout 1 --poll 0.2; ok "$rc" 75 "S1: origin-wait for b1 → 75 while A integrates"
land_unmoved "$D" proj-a-t1 11 "S1 a1"
A1=$(srvtip); ok "$(parents "$A1")" "$B0" "S1: a1's squash's only parent is the base"
md proj-a-t1
mi proj-a-t2; ok "$rc" 4 "S1: A's a2 → 4, yielding to B"
has "$err" "ORIGIN LANE: [[proj-b-rollout-2026-11-02]] waits on o/r since" "S1: … the yield line naming B"
ow proj-b-t1 --timeout 30 --poll 0.2; ok "$rc|$out" "0|origin lane: [[proj-b-t1]]'s turn on o/r" "S1: B's origin wait returns: its turn"
mi proj-b-t1; ok "$rc" 0 "S1: B's b1 → 0"
land_moved "$P" proj-b-t1 21 "S1 b1"
ok "$LAST_BASE" "$A1" "S1: B's prepare read main at a1's squash"
B1=$(srvtip); ok "$(parents "$B1")" "$A1" "S1: b1's squash's only parent is a1's squash"
has "$(loglines proj-b-t1)" " base=$A1 " "S1: B's Integration log base is a1's squash"
md proj-b-t1
mi proj-a-t2; ok "$rc" 0 "S1: A's a2 → 0, its turn now"
land_moved "$D" proj-a-t2 12 "S1 a2"
ok "$LAST_BASE" "$B1" "S1: A's re-verify read main at b1's squash"
A2=$(srvtip); ok "$(parents "$A2")" "$B1" "S1: a2's squash's only parent is b1's squash"
md proj-a-t2
# D7: the Mac-wide count reads the other project's running task
printf -- '---\ntags: [task]\nstatus: in_progress\nscope: cross-cutting\nprojects:\n  - "[[Proj A]]"\nrollout: "[[proj-a-rollout-2026-11-02]]"\nowner: lead-a\n---\n\nrunning\n' > "$V/proj-a-t3.md"
mkt proj-b-t2 proj-b-rollout-2026-11-02 "Proj B" 22 open
NX=$(python3 "$RR" next --rollout "$V/proj-b-rollout-2026-11-02.md" --tasks-dir "$V" --dry-run 2>/dev/null)
ok "$(j "$NX" 'd["trickle"]["elsewhere"]')" '{"proj-a-rollout-2026-11-02":1}' "S1 (D7): next --dry-run for B counts A's running task in trickle.elsewhere"

# ======== S2: a merge-hold release re-enters with no mark-integrating (D12) ===========================================
echo "== S2"
rm -f "$V/proj-a-t3.md" "$V/proj-b-t2.md"
mkt proj-a-t4 proj-a-rollout-2026-11-02 "Proj A" 14; mkt proj-b-t3 proj-b-rollout-2026-11-02 "Proj B" 23
branch proj-a-t4 a4.txt; branch proj-b-t3 b3.txt; tree "$D" proj-a-t4; tree "$P" proj-b-t3; pr 14 proj-a-t4; pr 23 proj-b-t3
lease proj-a-rollout-2026-11-02; lease proj-b-rollout-2026-11-02
mi proj-a-t4; ok "$rc" 0 "S2: a4 takes the lane"
prep "$D" proj-a-t4; ok "$(j "$J" 'd["route"]')" merge "S2: a4's prepare routes merge"
A4H=$(j "$J" 'd["prHead"]'); A4B=$(j "$J" 'd["mainSha"]')
logi proj-a-t4 "$(j "$J" 'd["anchor"]')" "$A4H" "$A4B"
python3 "$RR" hold --tasks proj-a-t4 --hold merge --state start --tasks-dir "$V" >/dev/null
mi proj-b-t3; ok "$rc" 0 "S2: A's merge hold frees the origin lane: b3 takes it"
prep "$P" proj-b-t3; ok "$(j "$J" 'd["route"]')" merge "S2: b3's prepare routes merge (main unmoved)"
B3H=$(j "$J" 'd["prHead"]'); B3B=$(j "$J" 'd["mainSha"]')
logi proj-b-t3 "$(j "$J" 'd["anchor"]')" "$B3H" "$B3B"
python3 "$RR" hold --tasks proj-a-t4 --hold merge --state end --tasks-dir "$V" >/dev/null   # the release: no mark-integrating
mt "$D" 14 "$A4H" "$A4B"; ok "$rc" 0 "S2: A's release merges a4 (the base pin: main unmoved)"
A4=$(srvtip); md proj-a-t4
ok "$(lanetaken proj-a-rollout-2026-11-02 proj-a-t4)" 1 "S2: A's record holds exactly one lane-taken for a4"
mt "$P" 23 "$B3H" "$B3B"; ok "$rc" 3 "S2: B's merge-task → 3 (Base moved): a4 landed during its Integration"
mi proj-b-t3; ok "$rc" 0 "S2: B's step 3 again: mark-integrating → 0"
land_moved "$P" proj-b-t3 23 "S2 b3"
ok "$LAST_BASE" "$A4" "S2: b3's re-verify read main at a4's squash"
ok "$(parents "$(srvtip)")" "$A4" "S2: b3's squash's only parent is a4's squash"
md proj-b-t3

# ======== S3: a yield read back by status and the Reflection (D13, D14) ===============================================
echo "== S3"
mkro c-rollout-2026-11-02 "Proj C" "$D"; mkro e-rollout-2026-11-02 "Proj E" "$P"
mkt c-t1 c-rollout-2026-11-02 "Proj C" 31; mkt e-t1 e-rollout-2026-11-02 "Proj E" 41
lease c-rollout-2026-11-02; lease e-rollout-2026-11-02
mi c-t1; ok "$rc" 0 "S3: C's c1 takes the lane"
mi e-t1; ok "$rc" 4 "S3: E's e1 is refused: E now waits"
sleep 1   # a waiting entry's since is to the second, and a tie goes to the lower stem: E's must be the earlier
mi c-t1; ok "$rc" 4 "S3: C's Base-moved re-run of c1 yields to E"
has "$err" "ORIGIN LANE: [[e-rollout-2026-11-02]] waits on o/r since" "S3: … the yield line naming E"
has "$(tail -1 "$THREAD_EVENTS_DIR/c-rollout-2026-11-02.jsonl")" '"release":"origin"' "S3: C's record frees its lane: release=origin"
has "$(tail -1 "$THREAD_EVENTS_DIR/c-rollout-2026-11-02.jsonl")" '"origin":"o/r"' "S3: … origin=o/r"
has "$(grep -m1 '^integrating:' "$V/c-t1.md")" "integrating:" "S3: c1 keeps integrating:"
ST=$(python3 "$RR" status --rollout "$V/c-rollout-2026-11-02.md" --tasks-dir "$V" 2>/dev/null)
ok "$(j "$ST" '[t["queueState"] for t in d["tasks"] if t["slug"] == "c-t1"][0]')" integrating "S3: status: c1 is integrating"
ok "$(j "$ST" '[t["originWait"]["origin"] for t in d["tasks"] if t["slug"] == "c-t1"][0]')" o/r "S3: … with originWait.origin o/r"
mi e-t1; ok "$rc" 0 "S3: e1 takes the lane"
printf -- '---\ntags: [task]\nstatus: done\nrollout: "[[e-rollout-2026-11-02]]"\npr: https://github.com/o/r/pull/41\n---\n\ne1\n' > "$V/e-t1.md"
python3 "$RR" mark-done --tasks e-t1 --tasks-dir "$V" >/dev/null 2>&1
python3 "$RR" free-lane --tasks e-t1 --tasks-dir "$V" >/dev/null 2>&1
mi c-t1; ok "$rc" 0 "S3: once E is done, c1's mark-integrating → 0"
ST=$(python3 "$RR" status --rollout "$V/c-rollout-2026-11-02.md" --tasks-dir "$V" 2>/dev/null)
ok "$(j "$ST" '"originWait" in [t for t in d["tasks"] if t["slug"] == "c-t1"][0]')" false "S3: … and status drops originWait"
SET="$tmp/settings.json"
python3 - "$SET" <<'PY'
import json, sys
s = {k: {"value": v, "source": "built-in"} for k, v in (("parallel_ceiling", 2), ("max_review_rounds", 4), ("max_iterations", 3), ("max_plan_rounds", 3))}
g = {k: {"value": v, "source": "built-in"} for k, v in (("tokens_per_merge_pct", 25), ("set_aside_rate_points", 5), ("conflict_rate_points", 10), ("quota_stalls", 0), ("review_churn_pct", 40), ("hours_per_task", 1.5))}
json.dump({"path": "/none", "file": False, "repo": "o/r", "settings": s, "guardrails": g}, open(sys.argv[1], "w"))
PY
SCJ=$(python3 "$SCORE" --rollout c-rollout-2026-11-02 --settings "$SET" 2>/dev/null)
ok "$(j "$SCJ" 'd["lane"]["integrations"]')" 1 "S3 (D13): score.py over C's record counts one Integration across its yield"

echo; [ "$fail" -eq 0 ] && echo "parallel-rollouts-one-repo: ALL PASS" || echo "parallel-rollouts-one-repo: SOME FAILED"
exit "$fail"
