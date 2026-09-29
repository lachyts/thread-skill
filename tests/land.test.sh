#!/usr/bin/env bash
# skills/_shared/scripts/land.sh — the shared landing route (ADR 0028, queue and finish) — close's
# `# thread:land` snippet and handoff's `# thread:handoff-land` snippet. Fixture repos talk to bare "servers" under $tmp/srv through a fake ssh that maps
# git@github.com:<o>/<r>.git and ssh://git@github.com/<o>/<r>.git there; a fake `gh`
# (tests/fixtures/land/fake-gh.py) logs every call and serves protection, access, PR list/create/merge,
# labels and update-branch. Every handed path goes through a symlinked alias of the temp dir, so the
# physical-path handling is exercised on every run. Hang stubs run a non-exec `sleep 40 | cat`; hang cases
# assert elapsed time. Hermetic: HOME, the global git config and TMPDIR are temp, and the caller's GIT_DIR
# & co. are unset. bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)

root=$(pwd -P)
LAND=$root/skills/_shared/scripts/land.sh
CLOSE=$root/skills/close/SKILL.md
BASH32=/bin/bash
echo "# bash on PATH: $(bash --version | head -n 1)"
echo "# BASH32 ($BASH32): $($BASH32 --version | head -n 1)"

real=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
real=$(cd "$real" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$real" ] || [ ! -d "$real" ] || [ "$real" = "$root" ]; then echo "FAIL - mktemp gave no usable dir [$real]"; exit 1; fi
ln -s "$real" "$real.alias" || { echo 'FAIL - alias symlink'; exit 1; }
tmp="$real.alias"
holders=()
cleanup() {
  local p
  for p in ${holders[@]+"${holders[@]}"}; do kill -9 "$p" 2>/dev/null; done
  chmod -R u+rwX "$real" 2>/dev/null; rm -rf "$real" "$real.alias"
}
trap cleanup EXIT

mkdir -p "$tmp/home" "$tmp/bin" "$tmp/srv/o" "$tmp/w" "$tmp/t" "$tmp/gh"
export HOME="$tmp/home"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$tmp/gitconfig"
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch main
git config --global advice.detachedHead false
export LANDING_REGISTER="$tmp/register.md"
export LAND_TIMEOUT=2 LAND_DEADLINE=300
cp tests/fixtures/land/fake-gh.py "$tmp/bin/gh"; cp tests/fixtures/land/fake-ssh.sh "$tmp/bin/fake-ssh"
chmod +x "$tmp/bin/gh" "$tmp/bin/fake-ssh"
export PATH="$tmp/bin:$PATH"
export GIT_SSH_COMMAND="$tmp/bin/fake-ssh" GIT_SSH_VARIANT=ssh
export SRV="$tmp/srv" LOG_SSH="$tmp/ssh.log" LOG_GH="$tmp/gh.log" GH_STATE="$tmp/gh"
export TMPDIR="$tmp/t"
: > "$LOG_SSH"; : > "$LOG_GH"
: > "$LANDING_REGISTER"

shells=("bash")
command -v zsh >/dev/null 2>&1 && shells+=("zsh -f")

# ---- helpers ---------------------------------------------------------------------------------------------
hasnt() { case "$1" in *"$2"*) ok y n "$3";; *) ok n n "$3";; esac; }
cnt() { local n; n=$(printf '%s\n' "$1" | grep -cF -- "$2"); echo "$n"; }
lines() { printf '%s' "$1" | awk 'END { print NR }'; }
ghlog() { cat "$LOG_GH"; }
sshlog() { cat "$LOG_SSH"; }
ghreset() { rm -rf "$GH_STATE"; mkdir -p "$GH_STATE"; }
srvref() { git --git-dir "$SRV/o/$1.git" rev-parse -q --verify "refs/heads/$2"; }
srvclose() { git --git-dir "$SRV/o/$1.git" for-each-ref --format='%(refname:lstrip=2) %(objectname)' refs/heads/close/; }
tmpempty() { ok "$(ls -A "$TMPDIR" | wc -l | tr -d ' ')" 0 "$1: TMPDIR holds nothing afterwards"; }

# mkrepo <name> [<origin url>] → $W, a clone at master with origin/HEAD set, the server $SRV/o/<name>.git.
mkrepo() {
  local n=$1 url=${2:-git@github.com:o/$1.git}
  git init -q --bare -b master "$SRV/o/$n.git"
  W="$tmp/w/$n"
  git init -q -b master "$W"
  mkdir -p "$W/src"
  echo base > "$W/a.txt"; echo t0 > "$W/THREAD.md"; echo c0 > "$W/src/c.txt"
  git -C "$W" add -A && git -C "$W" commit -qm base
  git -C "$W" remote add origin "$url"
  git -C "$W" push -q "$SRV/o/$n.git" master
  git -C "$W" update-ref refs/remotes/origin/master HEAD
  git -C "$W" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
}
# srvcommit <name> <file> <content> [<subject>] — a commit on the server's master from a second clone.
srvcommit() {
  local n=$1 f=$2 c=$3 O
  O=$(mktemp -d "$tmp/oc.XXXXXX")
  git clone -q "$SRV/o/$n.git" "$O/c" 2>/dev/null
  mkdir -p "$(dirname "$O/c/$f")"; printf '%s\n' "$c" > "$O/c/$f"
  git -C "$O/c" add -A && git -C "$O/c" commit -qm "${4:-origin: $f}" && git -C "$O/c" push -q origin HEAD:master 2>/dev/null
  rm -rf "$O"
}
# fetchsrv <name>: refresh the clone's origin/master straight from the server path (no ssh).
fetchsrv() { git -C "$W" fetch -q "$SRV/o/$1.git" "+refs/heads/master:refs/remotes/origin/master"; }
# c0 [<subject>]: a stranded earlier close-out commit (THREAD.md only).
c0() { echo "c0 ${1:-x}" >> "$W/THREAD.md"; git -C "$W" add THREAD.md; git -C "$W" commit -qm "📝 docs(thread): close-out — ${1:-earlier}"; }
edit() { echo "${2:-closed}" >> "$W/THREAD.md"; }

# land [VAR=value …] -- <land.sh args…> → $out, $err, $rc, $el (seconds). Logs are reset first.
LAND_SHELL=bash
land() {
  local extra=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do extra+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  : > "$LOG_SSH"; : > "$LOG_GH"
  local s=$SECONDS
  out=$(env ${extra[@]+"${extra[@]}"} $LAND_SHELL "$LAND" "$@" 2>"$tmp/err"); rc=$?
  el=$((SECONDS - s)); err=$(cat "$tmp/err")
}
# res <label> <rc> <stdout exact or prefix…> — one stdout line, rc, and TMPDIR left empty.
res() {
  local label=$1 want_rc=$2 want=$3
  ok "$(lines "$out")" 1 "$label: exactly one stdout line"
  case $want in
    *'…') case $out in "${want%…}"*) ok y y "$label: stdout starts [${want%…}]";; *) ok "$out" "$want" "$label: stdout";; esac ;;
    *) ok "$out" "$want" "$label: stdout" ;;
  esac
  ok "$rc" "$want_rc" "$label: rc"
  hasnt "$err" "unbound variable" "$label: no unbound variable"
  tmpempty "$label"
}
made() { printf '%s\n' "$err" | sed -n 's/^land: commit //p' | head -n 1; }
nossh() { ok "$(sshlog | grep -c .)" 0 "$1: zero ssh calls"; }
nogh() { ok "$(ghlog | grep -c .)" 0 "$1: zero gh calls"; }
nopush() { ok "$(cnt "$(sshlog)" git-receive-pack)" 0 "$1: nothing pushed"; }
sha12() { git -C "$W" rev-parse HEAD | cut -c1-12; }
# seedpr <state> <headRefName> <headRefOid> [cross] — prepend a PR (newest first) to the fake's state.
seedpr() {
  python3 - "$GH_STATE/prs.json" "$@" <<'PY'
import json, sys
f, state, name, oid = sys.argv[1:5]
cross = len(sys.argv) > 5
try:
    prs = json.load(open(f))
except FileNotFoundError:
    prs = []
n = max([p["number"] for p in prs] + [0]) + 1
prs.insert(0, {"number": n, "url": "https://github.com/o/x/pull/%d" % n, "state": state, "headRefName": name,
               "headRefOid": oid, "isCrossRepository": cross})
json.dump(prs, open(f, "w"))
PY
}
wtcount() { git -C "$W" worktree list | grep -c .; }

echo "== land.sh exists"
ok "$([ -x "$LAND" ] && echo y)" y "land.sh is present and executable"
[ -x "$LAND" ] || { echo "make test: land.sh missing"; exit 1; }

# ==== Protected route: creating and queueing a PR =========================================================
echo "== 1. protected, local strictly behind"
ghreset; mkrepo c1; srvcommit c1 x.txt X; X=$(srvref c1 master); edit
land -- --slug 'c1 thread' -- "$W" "$W/THREAD.md"
res "case 1" 0 "queued https://github.com/o/c1/pull/1"
C=$(git -C "$W" rev-parse HEAD)
ok "$(made)" "$C" "case 1: land: commit is HEAD"
ok "$(git -C "$W" rev-parse HEAD^)" "$X" "case 1: local fast-forwarded to X first (C's parent is X)"
br="close/$(git -C "$W" log -1 --format=%cd --date=short)-c1-thread-$(sha12)"
ok "$(srvclose c1)" "$br $C" "case 1: server close/<cdate>-<slug>-<sha12> is C"
ok "$(ghlog | awk '{print $1" "$2" "$3" "$4}' | tr '\n' '|')" \
   "api repos/o/c1 --jq .permissions.push|api repos/o/c1/branches/master --jq .protected|pr list -R o/c1|pr list -R o/c1|api --method POST repos/o/c1/pulls|api --method POST repos/o/c1/issues/1/labels|pr merge 1 -R|" \
   "case 1: gh calls in order: access, protection, open list, all list, create, label, merge"
has "$(ghlog)" "pr list -R o/c1 --state open --limit 200" "case 1: phase 1 is --state open"
has "$(ghlog)" "pr list -R o/c1 --state all --limit 200" "case 1: phase 2 is --state all"
has "$(ghlog)" "pr merge 1 -R o/c1 --auto --merge" "case 1: auto-merge queued with a merge commit"
has "$(ghlog)" "-f labels[]=landing" "case 1: labelled landing over REST"
for bad in "pr edit" "pr create" "update-branch"; do hasnt "$(ghlog)" "$bad" "case 1: no $bad"; done
ok "$(git -C "$W" rev-parse refs/heads/master)" "$C" "case 1: the local default keeps the commit"

echo "== 2. protected, diverged with a stranded C0"
ghreset; mkrepo c2; c0; C0=$(git -C "$W" rev-parse HEAD); srvcommit c2 x.txt X; edit
land -- --slug c2 -- "$W" "$W/THREAD.md"
res "case 2" 0 "queued https://github.com/o/c2/pull/1"
C=$(git -C "$W" rev-parse HEAD)
ok "$(git -C "$W" rev-parse HEAD^)" "$C0" "case 2: HEAD pushed unchanged (C's parent is C0; not rebased)"
ok "$(srvclose c2 | cut -d' ' -f2)" "$C" "case 2: the server close/ branch is C"
ok "$(cnt "$(ghlog)" "update-branch")" 1 "case 2: update-branch called once"
has "$err" "land: carried 1 earlier close-out commit(s)" "case 2: carried 1"

echo "== 3. protected, auto-merge refused"
for mm in notallowed clean; do
  ghreset; mkrepo "c3$mm"; edit
  land GH_MERGE=$mm -- "$W" "$W/THREAD.md"
  res "case 3 ($mm)" 0 "queued: needs merge https://github.com/o/c3$mm/pull/1"
  ok "$(cnt "$(ghlog)" "issues/1/labels")" 1 "case 3 ($mm): the label is still added"
done

echo "== 4. same-day second close"
ghreset; mkrepo c4; edit one
land -- --slug c4 -- "$W" "$W/THREAD.md"; res "case 4 first" 0 "queued https://github.com/o/c4/pull/1"
edit two
land -- --slug c4 -- "$W" "$W/THREAD.md"; res "case 4 second" 0 "queued https://github.com/o/c4/pull/2"
ok "$(srvclose c4 | grep -c .)" 2 "case 4: a second close/ branch"
ok "$(cnt "$(ghlog)" "POST repos/o/c4/pulls")" 1 "case 4: a new PR"

# ==== Protected route: reuse and retry ====================================================================
echo "== 5. retry under another TZ, zero paths, OPEN PR"
ghreset; mkrepo c5; edit
land GH_MERGE=notallowed -- --slug c5 -- "$W" "$W/THREAD.md"; res "case 5 setup" 0 "queued: needs merge https://github.com/o/c5/pull/1"
closes=$(srvclose c5)
land TZ=Pacific/Kiritimati GH_MERGE=notallowed -- --slug c5 -- "$W"
res "case 5c (still refused)" 0 "queued: needs merge https://github.com/o/c5/pull/1"
ok "$(cnt "$(ghlog)" "pr list")" 1 "case 5: only the open list is called"
nopush "case 5"; hasnt "$(ghlog)" "POST repos/o/c5/pulls" "case 5: no second create"
has "$err" "land: nothing committed" "case 5: nothing committed"
land TZ=Etc/GMT+12 -- --slug c5 -- "$W"
res "case 5b (the reused PR's merge queued)" 0 "queued https://github.com/o/c5/pull/1"
ok "$(srvclose c5)" "$closes" "case 5b: no new branch"
has "$(ghlog)" "issues/1/labels" "case 5b: the reused PR is labelled"
has "$(ghlog)" "pr merge 1 -R o/c5 --auto --merge" "case 5b: the reused PR's merge is queued again"
hasnt "$(ghlog)" "autoMergeRequest" "case 5b: the PR list never asks for autoMergeRequest"

echo "== 6. PR create hangs after creating"
ghreset; mkrepo c6; edit
land GH_CREATE=hang-after-create -- "$W" "$W/THREAD.md"
res "case 6" 0 "queued https://github.com/o/c6/pull/1"
ok "$([ "$el" -lt 15 ] && echo y)" y "case 6: bounded (${el}s < 15s)"
ok "$(cnt "$(ghlog)" "pr list -R o/c6 --state open")" 2 "case 6: the re-lookup ran"
land -- "$W"
res "case 6 rerun" 0 "queued https://github.com/o/c6/pull/1"
hasnt "$(ghlog)" "POST repos/o/c6/pulls" "case 6: the next run makes no second create"

echo "== 7. foreign PRs are ignored"
ghreset; mkrepo c7; c0; H=$(git -C "$W" rev-parse HEAD)
seedpr OPEN feat/x "$H"; seedpr OPEN "close/2020-01-01-x-$(sha12)" "$H" cross
land -- "$W"
res "case 7" 0 "queued https://github.com/o/c7/pull/3"
has "$(ghlog)" "POST repos/o/c7/pulls" "case 7: a new PR is created"
has "$(ghlog)" "issues/3/labels" "case 7: the label targets the new PR"
hasnt "$(ghlog)" "issues/1/labels" "case 7: the non-close/ PR is untouched"
hasnt "$(ghlog)" "issues/2/labels" "case 7: the cross-repo PR is untouched"

echo "== 8. closed or merged match"
ghreset; mkrepo c8; c0; seedpr CLOSED "close/2020-01-01-x-$(sha12)" 0000
land -- "$W"
res "case 8 closed" 1 "stuck: close-out PR https://github.com/o/x/pull/1 was closed unmerged"
nopush "case 8 closed"; hasnt "$(ghlog)" "POST repos/o/c8/pulls" "case 8 closed: no create"
ghreset; seedpr MERGED "close/2020-01-01-x-$(sha12)" 0000
land -- "$W"
res "case 8 merged" 1 "stuck: close-out PR https://github.com/o/x/pull/1 merged but $(sha12) is not on origin/master"
nopush "case 8 merged"

echo "== 9. lookup failures"
ghreset; mkrepo c9; c0
land GH_LIST=fail -- "$W"; res "case 9" 1 "stuck: cannot look up landing PR: gh: Server Error (HTTP 502)"
nopush "case 9"; hasnt "$(ghlog)" "POST" "case 9: no create"
land GH_LIST=hang -- "$W"; res "case 9b" 1 "stuck: cannot look up landing PR: timed out"
ok "$([ "$el" -lt 15 ] && echo y)" y "case 9b: bounded (${el}s < 15s)"
land GH_LIST_ALL=fail -- "$W"; res "case 9c" 1 "stuck: cannot look up landing PR: gh: Server Error (HTTP 502)"
nopush "case 9c"
land GH_LIST=badjson -- "$W"; res "case 9d (bad JSON)" 1 "stuck: cannot look up landing PR: bad JSON from the PR list"

# ==== Protection probe and unprotected route ==============================================================
echo "== 10. protection unreadable"
ghreset; mkrepo c10; edit
land GH_PROT=404 -- "$W" "$W/THREAD.md"; res "case 10" 1 "stuck: cannot read branch protection: gh: Branch not found (HTTP 404)"
nopush "case 10"; ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 10: committed first"
land GH_PROT=hang -- "$W"; res "case 10b" 1 "stuck: cannot read branch protection: timed out"
ok "$([ "$el" -lt 15 ] && echo y)" y "case 10b: bounded (${el}s < 15s)"

echo "== 11. unprotected, origin unmoved"
ghreset; mkrepo c11; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 11" 0 landed
ok "$(srvref c11 master)" "$(git -C "$W" rev-parse HEAD)" "case 11: pushed straight to master"
ok "$(cnt "$(ghlog)" "pr ")" 0 "case 11: zero gh pr calls"
edit again
land GH_PROT=holdout -- "$W" "$W/THREAD.md"
res "case 11b" 0 landed
ok "$([ "$el" -lt 15 ] && echo y)" y "case 11b: a stub's leftover child cannot hold the capture (${el}s < 15s)"

echo "== 12. unprotected, origin moved, stranded C0, clean tree"
ghreset; mkrepo c12; c0; srvcommit c12 x.txt X; X=$(srvref c12 master); edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 12" 0 landed
ok "$(made)" "$(srvref c12 master)" "case 12: land: commit is the server head"
ok "$(git -C "$W" rev-parse master)" "$(srvref c12 master)" "case 12: local master is the server head"
ok "$(git -C "$W" rev-parse master~2)" "$X" "case 12: C0 and C rebased onto origin's tip"
ok "$(wtcount)" 1 "case 12: the scratch worktree is gone"
ok "$(git -C "$W" status --porcelain)" "" "case 12: the tree is clean"

echo "== 13. rebase conflict"
ghreset; mkrepo c13; srvcommit c13 THREAD.md "origin thread"; S=$(srvref c13 master); edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 13" 1 "stuck: rebase conflict"
ok "$(srvref c13 master)" "$S" "case 13: server untouched"
ok "$(git -C "$W" rev-parse HEAD)" "$(made)" "case 13: local HEAD is this run's commit, unmoved"
ok "$(git -C "$W" status --porcelain)" "" "case 13: index and work tree unchanged"
ok "$(wtcount)" 1 "case 13: the scratch worktree is removed"
echo "== 13b. a local pull merge"
ghreset; mkrepo c13b; c0; srvcommit c13b x.txt X1; fetchsrv c13b
git -C "$W" merge -q --no-edit refs/remotes/origin/master; srvcommit c13b y.txt X2
land GH_PROT=false -- "$W"
res "case 13b" 1 "stuck: local merge commit on master; not rebased"
nopush "case 13b"

echo "== 13c. dirty and pre-staged, non-overlapping"
ghreset; mkrepo c13c; c0
srvcommit c13c a.txt "origin a"; srvcommit c13c d.txt "origin d"; X=$(srvref c13c master)
echo b > "$W/src/b.txt"; git -C "$W" add src/b.txt; echo dirty >> "$W/src/c.txt"; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 13c" 0 landed
N=$(git -C "$W" rev-parse master)
ok "$(srvref c13c master)" "$N" "case 13c: server head = local master"
ok "$(git -C "$W" rev-parse master~2)" "$X" "case 13c: C0's rebased copy sits on origin's tip"
ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 13c: src/b.txt still staged"
ok "$(git -C "$W" status --porcelain -- src/c.txt)" " M src/c.txt" "case 13c: src/c.txt still modified"
ok "$(git -C "$W" diff --name-only "$X" "$N" | tr '\n' ' ')" "THREAD.md " "case 13c: pushed commits hold only THREAD.md"
ok "$(cat "$W/a.txt")/$(cat "$W/d.txt")" "origin a/origin d" "case 13c: a.txt and d.txt match origin"

echo "== 13d. overlapping local changes"
for v in dirty untracked staged; do
  ghreset; mkrepo "c13d$v"; c0
  srvcommit "c13d$v" a.txt "origin a"; srvcommit "c13d$v" d.txt "origin d"; S=$(srvref "c13d$v" master)
  echo b > "$W/src/b.txt"; git -C "$W" add src/b.txt
  case $v in
    dirty) echo mine >> "$W/a.txt"; want="'a.txt' not uptodate"; wst=' M a.txt|' ;;
    untracked) echo mine > "$W/d.txt"; want="'d.txt' would be overwritten"; wst='?? d.txt|' ;;
    staged) echo mine >> "$W/a.txt"; git -C "$W" add a.txt; want="a.txt"; wst='M  a.txt|' ;;
  esac
  edit; land GH_PROT=false -- "$W" "$W/THREAD.md"
  res "case 13d ($v)" 1 "stuck: rebase refused: …"
  has "$out" "$want" "case 13d ($v): the refusal names [$want]"
  ok "$(git -C "$W" status --porcelain -- a.txt d.txt | tr '\n' '|')" "$wst" "case 13d ($v): the overlapping change is intact"
  ok "$(git -C "$W" rev-parse HEAD)" "$(made)" "case 13d ($v): local HEAD unmoved"
  ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 13d ($v): src/b.txt still staged"
  ok "$(srvref "c13d$v" master)" "$S" "case 13d ($v): server untouched"
  nopush "case 13d ($v)"
  ok "$(wtcount)" 1 "case 13d ($v): the scratch worktree is removed"
done
ok "$(git -C "$W" status --porcelain -- a.txt)" "M  a.txt" "case 13d (staged): a.txt still staged"
git -C "$W" stash -q
land GH_PROT=false -- "$W"
res "case 13d re-run after git stash" 0 landed
ok "$(srvref c13dstaged master)" "$(git -C "$W" rev-parse master)" "case 13d: landed after the stash"

echo "== 14. a non-close-out commit ahead"
ghreset; mkrepo c14; echo x >> "$W/src/c.txt"; git -C "$W" commit -qam "feat: unrelated"; edit
land -- "$W" "$W/THREAD.md"
res "case 14" 1 "stuck: local commits not from a close-out: feat: unrelated"
nopush "case 14"; ok "$(cnt "$(ghlog)" "pr ")" 0 "case 14: no gh pr call"

# ==== Route classes =======================================================================================
echo "== 15. no GitHub origin"
ghreset; mkrepo c15; git -C "$W" remote remove origin; edit
land -- "$W" "$W/THREAD.md"; res "case 15 (no remote)" 0 "not landed: no GitHub origin"
nossh "case 15"; nogh "case 15"; ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 15: committed"
mkrepo c15b https://gitlab.com/o/c15b.git; edit
land -- "$W" "$W/THREAD.md"; res "case 15 (gitlab)" 0 "not landed: no GitHub origin"; nossh "case 15 gitlab"

echo "== 16. listed on the landing register"
ghreset; mkrepo c16; edit
printf -- '- o/c16 — shared team repo\n' > "$LANDING_REGISTER"
land -- "$W" "$W/THREAD.md"; res "case 16" 0 "not landed: listed o/c16: shared team repo"
nossh "case 16"; nogh "case 16"; ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 16: committed"
rm -f "$LANDING_REGISTER"; ln -s "$tmp/nowhere.md" "$LANDING_REGISTER"; edit
land -- "$W" "$W/THREAD.md"; res "case 16b (dangling register)" 1 "stuck: landing register: landing-register: …"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 16b: committed first"; nossh "case 16b"
rm -f "$LANDING_REGISTER"; : > "$LANDING_REGISTER"

# ==== Staging and preflight ===============================================================================
echo "== 17. handoff deletion through a removed directory"
ghreset; mkrepo c17; mkdir -p "$W/docs/handoffs"; echo h > "$W/docs/handoffs/h.md"
git -C "$W" add docs && git -C "$W" commit -qm "📝 docs(handoff): h" && git -C "$W" push -q "$SRV/o/c17.git" master && fetchsrv c17
git -C "$W/docs/handoffs" rm -qf "$W/docs/handoffs/h.md"
ok "$([ -d "$W/docs" ] && echo present || echo gone)" gone "case 17: docs/ is gone (precondition)"
edit
land GH_PROT=false -- "$W/docs/handoffs" "$W/THREAD.md" "$W/docs/handoffs/h.md"
res "case 17" 0 landed
ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "M THREAD.md|D docs/handoffs/h.md|" "case 17: one commit holds M THREAD.md and D h.md"
ok "$(srvref c17 master)" "$(git -C "$W" rev-parse HEAD)" "case 17: landed"
mkdir -p "$W/docs/handoffs"; echo p > "$W/docs/handoffs/p.md"
git -C "$W" add docs && git -C "$W" commit -qm "📝 docs(handoff): p" && git -C "$W" push -q "$SRV/o/c17.git" master && fetchsrv c17
rm "$W/docs/handoffs/p.md"; echo b > "$W/src/b.txt"; git -C "$W" add src/b.txt
land GH_PROT=false -- "$W" "$W/docs/handoffs/p.md" "$W/docs/handoffs/ghost.md"
res "case 17 plain rm" 0 landed
ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/handoffs/p.md|" "case 17: a plain-rm'd tracked doc is committed as D"
has "$err" "land: dropped docs/handoffs/ghost.md (not on disk, never tracked)" "case 17: a never-tracked path is dropped"
ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 17: pre-staged src/b.txt stays staged"

echo "== 17b. an index-only missing path"
ghreset; mkrepo c17b; mkdir -p "$W/docs/handoffs"; echo n > "$W/docs/handoffs/n.md"
git -C "$W" add docs/handoffs/n.md; rm "$W/docs/handoffs/n.md"; H0=$(git -C "$W" rev-parse HEAD); edit
land GH_PROT=false -- "$W" "$W/THREAD.md" "$W/docs/handoffs/n.md"
res "case 17b" 0 landed
has "$err" "land: dropped docs/handoffs/n.md (not on disk, index-only; unstaged)" "case 17b: dropped with the index-only note"
hasnt "$err" "commit failed" "case 17b: no commit failure"
ok "$(git -C "$W" show --name-only --format= HEAD | tr '\n' ' ')" "THREAD.md " "case 17b: the commit touches only THREAD.md"
ok "$(git -C "$W" rev-parse HEAD^)" "$H0" "case 17b: one new commit"
ok "$(git -C "$W" ls-files docs/handoffs/n.md)" "" "case 17b: n.md is out of the index"
echo n > "$W/docs/handoffs/n.md"; git -C "$W" add docs/handoffs/n.md; rm "$W/docs/handoffs/n.md"; H0=$(git -C "$W" rev-parse HEAD)
land GH_PROT=false -- "$W" "$W/docs/handoffs/n.md"
res "case 17b only n.md" 0 landed
has "$err" "land: nothing committed" "case 17b only n.md: nothing committed"
ok "$(git -C "$W" rev-parse HEAD)" "$H0" "case 17b only n.md: HEAD unchanged"
W="$tmp/w/c17bu"; git init -q -b master "$W"; echo t > "$W/THREAD.md"; mkdir -p "$W/docs/handoffs"
echo n > "$W/docs/handoffs/n.md"; git -C "$W" add docs/handoffs/n.md; rm "$W/docs/handoffs/n.md"
land -- "$W" "$W/THREAD.md" "$W/docs/handoffs/n.md"
res "case 17b unborn" 0 "not landed: no GitHub origin"
ok "$(git -C "$W" rev-list --count HEAD)" 1 "case 17b unborn: THREAD.md is a root commit"
ok "$(git -C "$W" show --name-only --format= HEAD | tr '\n' ' ')" "THREAD.md " "case 17b unborn: only THREAD.md"
has "$err" "land: dropped docs/handoffs/n.md (not on disk, index-only; unstaged)" "case 17b unborn: n.md dropped"

echo "== 18. stuck before any commit"
ghreset; mkrepo c18; edit; H0=$(git -C "$W" rev-parse HEAD)
stuck0() {  # stuck0 <label> <want> <land args…>
  local label=$1 want=$2; shift 2
  land -- "$@"; res "case 18 $label" 1 "$want"
  has "$err" "land: nothing committed" "case 18 $label: nothing committed"
  ok "$(git -C "$W" rev-parse HEAD 2>/dev/null)" "$H0" "case 18 $label: HEAD unchanged"
}
stuck0 "non-close-out path" "stuck: not a close-out path: src/c.txt" "$W" "$W/src/c.txt"
stuck0 "path outside top" "stuck: path outside …" "$W" "$tmp/w/c1/THREAD.md"
stuck0 "a .. tail" "stuck: path outside …" "$W" "$W/docs/nope/../THREAD.md"
printf 'docs/handoffs/ign.md\n' > "$W/.git/info/exclude"; mkdir -p "$W/docs/handoffs"; echo i > "$W/docs/handoffs/ign.md"
stuck0 "ignored path" "stuck: ignored: docs/handoffs/ign.md" "$W" "$W/docs/handoffs/ign.md"
touch "$W/.git/MERGE_HEAD"
stuck0 "MERGE_HEAD" "stuck: half-applied operation (MERGE_HEAD)" "$W" "$W/THREAD.md"
rm -f "$W/.git/MERGE_HEAD"
git -C "$W" checkout -q --detach
stuck0 "detached HEAD" "stuck: detached HEAD" "$W" "$W/THREAD.md"
git -C "$W" checkout -q master
# The repo's nearest existing ancestor cannot be entered: stuck, never a fall-through to the caller's CWD
# repo (this test runs inside the thread-skill checkout, a GitHub repo, so a fall-through would show).
mkdir -p "$tmp/w/locked"; chmod 000 "$tmp/w/locked"
if (cd "$tmp/w/locked" 2>/dev/null); then
  echo "SKIP - case 18 unresolvable repo (a mode-000 dir can still be entered here)"
else
  stuck0 "unresolvable repo" "stuck: cannot resolve $tmp/w/locked/sub" "$tmp/w/locked/sub"
  nossh "case 18 unresolvable repo"; nogh "case 18 unresolvable repo"
  land -- --origin-slug "$tmp/w/locked/sub"; ok "$out/$rc" "/4" "case 18 unresolvable repo: --origin-slug exits 4, stdout empty"
fi
chmod 755 "$tmp/w/locked"

echo "== 19. swept repos"
sw() { mkdir -p "$1"; git init -q -b master "$1"; git -C "$1" remote add origin git@github.com:o/sw.git; echo t > "$1/THREAD.md"; }
for e in repos/workspaces repos/obsidian .claude .agents Projects Projects/Life/audio-archive \
         Projects/Life/grandma-shirleys-book Projects/Narcissus/narcissus-echo repos/concepts/cc; do
  sw "$HOME/$e"
  land -- "$HOME/$e" "$HOME/$e/THREAD.md"
  res "case 19 ~/$e" 0 "not landed: swept by the daily sweep"; nossh "case 19 ~/$e"
done
land -- "$real.alias/home/repos/obsidian" "$HOME/repos/obsidian/THREAD.md"
res "case 19 through the alias" 0 "not landed: swept by the daily sweep"
sw "$HOME/repos/concepts/wt-main"; git -C "$HOME/repos/concepts/wt-main" commit -qm i --allow-empty
git -C "$HOME/repos/concepts/wt-main" worktree add -q "$HOME/repos/concepts/gf" -b gf 2>/dev/null
echo t > "$HOME/repos/concepts/gf/THREAD.md"
land GH_PROT=false -- "$HOME/repos/concepts/gf" "$HOME/repos/concepts/gf/THREAD.md"
hasnt "$out" "swept" "case 19: a concepts child with a .git file takes the normal route"
rm -rf "$HOME/Projects/Narcissus/narcissus-echo"
git -C "$HOME/repos/concepts/wt-main" worktree add -q "$HOME/Projects/Narcissus/narcissus-echo" -b ne 2>/dev/null
ok "$([ -f "$HOME/Projects/Narcissus/narcissus-echo/.git" ] && echo file)" file "case 19: the in-tree entry's .git is a file (precondition)"
echo t > "$HOME/Projects/Narcissus/narcissus-echo/THREAD.md"
land GH_PROT=false -- "$HOME/Projects/Narcissus/narcissus-echo" "$HOME/Projects/Narcissus/narcissus-echo/THREAD.md"
hasnt "$out" "swept" "case 19: an in-tree entry with a .git file takes the normal route"
sw "$HOME/repos/other"
land GH_PROT=false -- "$HOME/repos/other" "$HOME/repos/other/THREAD.md"
hasnt "$out" "swept" "case 19: ~/repos/other takes the normal route"

echo "== 20. a non-default checkout"
ghreset; mkrepo c20; git -C "$W" checkout -q -b feat/x; srvcommit c20 x.txt X; fetchsrv c20
F0=$(git -C "$W" rev-parse feat/x); M0=$(git -C "$W" rev-parse master); O0=$(git -C "$W" rev-parse origin/master)
ok "$(git -C "$W" merge-base --is-ancestor feat/x origin/master && echo y)" y "case 20: feat/x is strictly behind origin/master (precondition)"
edit
land -- "$W" "$W/THREAD.md"
res "case 20" 0 "not landed: on feat/x, not master"
ok "$(git -C "$W" rev-parse HEAD^)" "$F0" "case 20: the commit sits on feat/x's old tip"
ok "$(git -C "$W" rev-parse master)/$(git -C "$W" rev-parse origin/master)" "$M0/$O0" "case 20: master and origin refs unchanged"
nossh "case 20"; nogh "case 20"
git -C "$W" symbolic-ref -d refs/remotes/origin/HEAD; edit
land -- "$W" "$W/THREAD.md"
res "case 20b" 0 "not landed: on feat/x, not master"
ok "$(sshlog | grep -c .)" 1 "case 20b: exactly one ssh invocation"
has "$(sshlog)" "git-upload-pack" "case 20b: it is the ls-remote"
ok "$(git -C "$W" rev-parse origin/master)" "$O0" "case 20b: no fetch"

# ==== Default branch and fetch ============================================================================
echo "== 21. origin/HEAD unset"
ghreset; mkrepo c21; git -C "$W" symbolic-ref -d refs/remotes/origin/HEAD; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"; res "case 21" 0 landed
edit; land FAKE_SSH=fail -- "$W" "$W/THREAD.md"
res "case 21 ssh fails" 1 "stuck: default branch unresolved: fake-ssh: connect to host github.com port 22: Connection refused"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 21: committed first"
edit; land FAKE_SSH=hang -- "$W" "$W/THREAD.md"
res "case 21b" 1 "stuck: default branch unresolved: timed out"
ok "$([ "$el" -lt 15 ] && echo y)" y "case 21b: bounded (${el}s < 15s)"

echo "== 22. fetch hangs"
ghreset; mkrepo c22; edit
land FAKE_SSH=hang -- "$W" "$W/THREAD.md"
res "case 22" 1 "stuck: cannot fetch origin/master: timed out"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 22: committed first"
ok "$([ "$el" -lt 15 ] && echo y)" y "case 22: bounded (${el}s < 15s)"
edit; land FAKE_SSH=fail -- "$W" "$W/THREAD.md"
res "case 22b (fetch refused)" 1 "stuck: cannot fetch origin/master: fake-ssh: connect to host github.com port 22: Connection refused"

# ==== Other behaviours ====================================================================================
echo "== 23. --commit-only"
ghreset; mkrepo c23; edit
land -- --commit-only "$W" "$W/THREAD.md"; res "case 23" 0 "not landed: commit-only"
nossh "case 23"; nogh "case 23"; ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 23: committed"

echo "== 24. zero paths, nothing ahead"
ghreset; mkrepo c24
land -- "$W"; res "case 24" 0 landed
has "$err" "land: nothing to land" "case 24: nothing to land"; has "$err" "land: nothing committed" "case 24: nothing committed"
nogh "case 24"

echo "== 25. --origin-slug"
g25="$tmp/w/g25"; git init -q -b master "$g25"
for u in https://github.com/o/r.git https://github.com/o/r/ git@github.com:o/r.git ssh://git@github.com/o/r.git ssh://git@github.com/o/r.git/; do
  git -C "$g25" remote remove origin 2>/dev/null; git -C "$g25" remote add origin "$u"
  land -- --origin-slug "$g25"; ok "$out/$rc" "o/r/0" "case 25: $u → o/r"
done
for u in https://gitlab.com/o/r.git https://github.com/o git@github.com:o/r/x.git https://github.com/o/...; do
  git -C "$g25" remote remove origin; git -C "$g25" remote add origin "$u"
  land -- --origin-slug "$g25"; ok "$out/$rc" "/4" "case 25: $u → exit 4, stdout empty"
done
ghreset; mkrepo c25 ssh://git@github.com/o/c25.git; edit
land -- "$W" "$W/THREAD.md"; res "case 25 e2e over ssh://" 0 "queued https://github.com/o/c25/pull/1"
has "$(ghlog)" "api repos/o/c25 " "case 25: the slug reaches gh as repos/o/c25"
land -- --slug; ok "$rc/$out" "2/" "usage error: exit 2, stdout empty"

echo "== 26. an apostrophe survives"
ghreset; mkrepo c26; edit
printf '%s\n' "📝 docs(thread): close-out — Lachy's thread" > "$tmp/msg26"
land GH_PROT=false -- -F "$tmp/msg26" "$W" "$W/THREAD.md"; res "case 26" 0 landed
ok "$(git -C "$W" log -1 --format=%s)" "📝 docs(thread): close-out — Lachy's thread" "case 26: the message is intact"

echo "== 27. environment"
ghreset; mkrepo c27; git -C "$W" config core.sshCommand "$tmp/bin/fake-ssh"; edit
land -u GIT_SSH_COMMAND GH_PROT=false -- "$W" "$W/THREAD.md"; res "case 27 core.sshCommand" 0 landed
has "$(sshlog)" "git-receive-pack" "case 27: core.sshCommand is used, not overwritten"
edit; land GIT_DIR=/nonexistent GH_PROT=false -- "$W" "$W/THREAD.md"; res "case 27 GIT_DIR" 0 landed
printf '#!/bin/sh\n{ git config gc.auto; git config maintenance.auto; git config user.flavour; } > "%s"\n' "$tmp/hook27" > "$W/.git/hooks/post-commit"
chmod +x "$W/.git/hooks/post-commit"; edit
land GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.flavour GIT_CONFIG_VALUE_0=mint GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 27 GIT_CONFIG_COUNT" 0 landed
ok "$(tr '\n' ' ' < "$tmp/hook27")" "0 false mint " "case 27: gc.auto=0, maintenance.auto=false, and the caller's key still applies"
rm -f "$W/.git/hooks/post-commit"

echo "== 28. slugs"
ghreset; mkrepo c28; edit
land -- --slug 'My Thread!' "$W" "$W/THREAD.md"; res "case 28" 0 "queued …"
has "$(srvclose c28)" "-my-thread-$(sha12) " "case 28: 'My Thread!' → my-thread"
edit; land -- --slug '' "$W" "$W/THREAD.md"; res "case 28 empty" 0 "queued …"
has "$(srvclose c28)" "-c28-$(sha12) " "case 28: an empty slug → the repo's basename"

# ==== Structural ==========================================================================================
echo "== 29. structural"
src=$(cat "$LAND")
code=$(grep -v '^[[:space:]]*#' "$LAND")
for w in nohup disown setsid '--watch' 'sleep ' default-branch.sh 'gh pr edit' 'gh pr create' 'gh label' '--search' \
         '3>&1' '>&3' 'exec 3' 'set -u' 'nounset' 'set -e' 'reset --keep' 'reset --hard' ' checkout' \
         'commit -a' ' --all' ' -am' 'budget()'; do
  hasnt "$code" "$w" "structural: no [$w]"
done
ok "$(printf '%s\n' "$code" | grep -cE '(^|[^&])&[[:space:]]*$')" 0 "structural: no trailing &"
ok "$(printf '%s\n' "$code" | grep -E 'git push' | grep -cE -- '--force|-f |[[:space:]]"?\+')" 0 "structural: no force push"
ok "$(head -n 1 "$LAND")" "#!/usr/bin/env bash" "structural: the shebang has no -u"
ok "$(printf '%s\n' "$code" | grep -E '(^|[^[:alnum:]_])(git (push|fetch|ls-remote)|gh )' | grep -vcE '^[[:space:]]*(out=\$\()?bounded ')" 0 \
   "structural: every git push|fetch|ls-remote and gh line starts with bounded"
has "$src" "alarm \$t; waitpid(\$pid,0); my \$st=\$?; alarm 0;
kill 'KILL',-\$pid;" "structural: a post-waitpid group kill"
for w in 'exec { $ARGV[0] } @ARGV' '$t=1 unless' 'return 124          # deadline' '[ "$rem" -lt "$t" ] && t=$rem'; do
  has "$src" "$w" "structural: carries [$w]"
done
ok "$(grep -c 'gh pr list' "$LAND")" "$(grep -cE 'gh pr list .*--state "\$1"' "$LAND")" "structural: every gh pr list passes --state (open|all)"
has "$src" 'pr_lookup open' "structural: phase 1 is --state open"; has "$src" 'pr_lookup all' "structural: phase 2 is --state all"
cp_body=$(awk '/^  commit_paths\(\) \{/{on=1} on{print} on && /^  \}/{exit}' "$LAND")
ok "$(printf '%s\n' "$code" | grep -c 'git commit')" 1 "structural: exactly one git commit line"
has "$cp_body" 'git commit -q -F "$msgfile" -- "${list[@]}"' "structural: the commit is inside commit_paths, by pathspec"
ok "$(printf '%s\n' "$cp_body" | sed -n 2p | sed 's/^ *//')" '[ "${#list[@]}" -gt 0 ] || { echo "land: nothing committed"; return 0; }' \
   "structural: commit_paths starts with the length guard"
ok "$(printf '%s\n' "$code" | grep -c 'git diff --cached')" 1 "structural: one git diff --cached"
has "$cp_body" 'git diff --cached --quiet -- "${list[@]}"' "structural: …inside commit_paths"
ok "$(printf '%s\n' "$code" | grep -o '[^+]"\${[A-Za-z_]*\[@\]}"' | grep -c .)" 2 "structural: only commit_paths' two [@] expansions are unguarded"
ok "$($BASH32 -n "$LAND" 2>&1; echo $?)" 0 "structural: $BASH32 -n land.sh passes"
ok "$(grep -cF '( exec 1>&2; main "$@" )' "$LAND")" 1 "structural: the body runs as ( exec 1>&2; main \"\$@\" )"
outside=$(awk '/^\( exec 1>&2; main/{next} /^[a-z_]+\(\) \{/{f=1} f&&/^\}/{f=0; next} f{next} {print}' "$LAND" | grep -v '^[[:space:]]*#' | grep -E "printf|echo" )
ok "$(printf '%s\n' "$outside" | grep -c .)" 1 "structural: one stdout write outside the functions"
has "$outside" "printf '%s\\n' \"\$land_out\"" "structural: …the parent's final printf"
ok "$(grep -E '>[[:space:]]*"\$LAND_RES"' "$LAND")" "result() { printf '%s\\n' \"\$1\" > \"\$LAND_RES\"; }" "structural: result() is the only writer of \$LAND_RES"
has "$src" '"GIT_CONFIG_KEY_$land_cfg_n=gc.auto" "GIT_CONFIG_VALUE_$land_cfg_n=0"' "structural: gc.auto=0 appended"
has "$src" '"GIT_CONFIG_KEY_$land_cfg_n=maintenance.auto" "GIT_CONFIG_VALUE_$land_cfg_n=false"' "structural: maintenance.auto=false appended"
ok "$(printf '%s\n' "$code" | grep -E 'rebase' | grep -vE 'git -C "\$wt" .*rebase|scratch_rebase|rebase-(merge|apply)|rebase (conflict|failed|refused)|rebase onto|before rebase|not rebased|rebased' | grep -c .)" 0 \
   "structural: rebase runs only as git -C \"\$wt\" … rebase"
ok "$(printf '%s\n' "$code" | grep -c 'read-tree -m -u')" 2 "structural: read-tree -m -u only in the move (and its rollback)"
ok "$(printf '%s\n' "$code" | grep -c 'update-ref .*refs/heads/')" 1 "structural: one update-ref of a branch"
has "$(printf '%s\n' "$code" | grep 'worktree add')" '-c core.hooksPath=/dev/null worktree add -q --detach' "structural: worktree add is detached, hooks off"
has "$(printf '%s\n' "$code" | grep "trap '")" 'git worktree remove --force "$wt"' "structural: worktree remove in a trap"
has "$(printf '%s\n' "$code" | grep "trap '")" 'git worktree prune' "structural: worktree prune in a trap"
s4=$(awk '/---- S4\./{on=1} /---- S5\./{on=0} on' "$LAND")
has "$(printf '%s\n' "$s4" | sed -n 2p)" 'if [ "$class" = landable ] && [ "$b" = "$d" ]; then' "structural: S4 sits inside the landable-and-on-<d> guard"
has "$s4" 'git fetch' "structural: …holding the fetch"; has "$s4" 'merge --ff-only' "structural: …and the fast-forward"
ok "$(printf '%s\n' "$code" | grep -cE 'git fetch|merge --ff-only')" 2 "structural: no fetch or fast-forward elsewhere"

# ==== The snippet =========================================================================================
echo "== 30. close's # thread:land snippet"
o=$(grep -cE '^[[:space:]]*# thread:land( |$)' "$CLOSE"); c=$(grep -cE '^[[:space:]]*# end thread:land$' "$CLOSE")
ok "$o/$c" "1/1" "one # thread:land marker pair"
awk '{ l=$0; sub(/^[ \t]+/, "", l) }
     l ~ /^# thread:land( |$)/ { on=1; ind=substr($0, 1, length($0)-length(l)); next }
     l == "# end thread:land" { on=0 }
     on { if (index($0, ind) == 1) print substr($0, length(ind)+1); else print $0 }' "$CLOSE" > "$tmp/snip.sh"
ok "$(grep -c 'bash "$ld"' "$tmp/snip.sh")" 1 "the snippet has exactly one bash \"\$ld\" line"
ok "$(tail -n 1 "$tmp/snip.sh")" 'bash "$ld" ${mode:+"$mode"} --slug "$slug" -F "$msg" -- "$top" <paths>' "the land.sh call is the snippet's last line"
hasnt "$(cat "$tmp/snip.sh")" "git add" "the snippet holds no git add"; hasnt "$(cat "$tmp/snip.sh")" "git commit" "the snippet holds no git commit"
# fill <top> <slug> <mode> <paths…> → $tmp/run.sh, the snippet with its placeholders filled as close would.
fill() {
  local t=$1 s=$2 m=$3 q=; shift 3
  local p; for p in "$@"; do q="$q '$p'"; done
  sed -e "s|top='<top>'|top='$t'|" -e "s|slug='<slug>'|slug='$s'|" -e "s|mode=''|mode='$m'|" \
      -e "s|<message>|📝 docs(thread): close-out — Lachy's snippet run|" -e "s| <paths>\$|$q|" "$tmp/snip.sh" > "$tmp/run.sh"
}
snip() {  # snip <shell> [VAR=value …] → out, err, rc, el
  local sh=$1; shift
  : > "$LOG_SSH"; : > "$LOG_GH"; local s=$SECONDS
  out=$(env CLAUDE_PLUGIN_ROOT="$root" "$@" $sh "$tmp/run.sh" 2>"$tmp/err"); rc=$?
  el=$((SECONDS - s)); err=$(cat "$tmp/err")
}
for sh in "${shells[@]}"; do
  ghreset; mkrepo "c30${#sh}"; edit
  fill "$W" "c30" "" "$W/THREAD.md"
  snip "$sh" GH_PROT=false; res "case 30 [$sh]" 0 landed
  ok "$(git -C "$W" log -1 --format=%s)" "📝 docs(thread): close-out — Lachy's snippet run" "case 30 [$sh]: the heredoc message is intact"
  ok "$(srvref "c30${#sh}" master)" "$(git -C "$W" rev-parse HEAD)" "case 30 [$sh]: landed on the server"
  snip "$sh" CLAUDE_PLUGIN_ROOT="$tmp/nowhere"; ok "$rc/$out" "2/" "case 30 [$sh]: a bogus CLAUDE_PLUGIN_ROOT → rc 2, stdout empty"
  has "$err" "land: script not found" "case 30 [$sh]: …and says so"
  ghreset; mkrepo "c30b${#sh}"; edit; fill "$W" "c30b" "--commit-only" "$W/THREAD.md"
  snip "$sh"; res "case 30b [$sh] save mode, protected" 0 "not landed: commit-only"; nossh "case 30b [$sh]"; nogh "case 30b [$sh]"
  mkdir -p "$W/docs/handoffs"; echo h > "$W/docs/handoffs/h.md"; git -C "$W" add docs; git -C "$W" commit -qm h
  git -C "$W" rm -qf docs/handoffs/h.md; fill "$W/docs/handoffs" "c30b" "--commit-only" "$W/docs/handoffs/h.md"
  snip "$sh"; res "case 30b [$sh] save mode, a deletion" 0 "not landed: commit-only"; nossh "case 30b [$sh] deletion"; nogh "case 30b [$sh] deletion"
  ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/handoffs/h.md|" "case 30b [$sh]: the deletion is committed"
done

echo "== 31. update-branched reuse under a different slug"
ghreset; mkrepo c31; c0; seedpr OPEN "close/2020-01-01-oldslug-$(sha12)" 1111111111111111111111111111111111111111
land -- --slug newslug "$W"; res "case 31" 0 "queued https://github.com/o/x/pull/1"
nopush "case 31"; hasnt "$(ghlog)" "POST repos/o/c31/pulls" "case 31: no create"
has "$(ghlog)" "issues/1/labels" "case 31: the label targets the old PR"; has "$(ghlog)" "pr merge 1 " "case 31: the merge targets the old PR"
ghreset; seedpr OPEN "close/2020-01-01-oldslug-0123456789ab" 1111111111111111111111111111111111111111
land -- --slug newslug "$W"; res "case 31 control" 0 "queued https://github.com/o/c31/pull/2"
has "$(ghlog)" "POST repos/o/c31/pulls" "case 31 control: a different sha12 is not matched"

echo "== 32. FF refused by a dirty overlap, protected"
ghreset; mkrepo c32; B0=$(git -C "$W" rev-parse HEAD); srvcommit c32 a.txt "origin a"; echo mine >> "$W/a.txt"; edit
land -- "$W" "$W/THREAD.md"
res "case 32" 0 "queued https://github.com/o/c32/pull/1"
has "$err" "land: ff refused: " "case 32: the ff refused note"
ok "$(git -C "$W" rev-parse HEAD^)" "$B0" "case 32: C's parent is the old base"
ok "$(srvclose c32 | cut -d' ' -f2)" "$(git -C "$W" rev-parse HEAD)" "case 32: the server close/ branch is C"
ok "$(cnt "$(ghlog)" update-branch)" 1 "case 32: update-branch once"
ok "$(git -C "$W" status --porcelain -- a.txt)" " M a.txt" "case 32: a.txt is still dirty"
ok "$(git -C "$W" show --name-only --format= HEAD | tr '\n' ' ')" "THREAD.md " "case 32: a.txt is not in C"

echo "== 32b. FF refused under merge.autoStash=true"
ghreset; mkrepo c32b; git -C "$W" config merge.autoStash true; B0=$(git -C "$W" rev-parse HEAD)
srvcommit c32b a.txt "origin a"; echo mine >> "$W/a.txt"; edit
land -- "$W" "$W/THREAD.md"
res "case 32b" 0 "queued https://github.com/o/c32b/pull/1"
has "$err" "land: ff refused: " "case 32b: the ff refused note"
ok "$(git -C "$W" rev-parse HEAD^)" "$B0" "case 32b: C's parent is the old base (no fast-forward)"
ok "$(git -C "$W" status --porcelain -- a.txt)" " M a.txt" "case 32b: a.txt is still just dirty"
ok "$(cat "$W/a.txt" | tr '\n' '|')" "base|mine|" "case 32b: a.txt is exactly the local change, no conflict markers"
ok "$(git -C "$W" stash list | grep -c .)" 0 "case 32b: no autostash entry left behind"

echo "== 33. push access"
ghreset; mkrepo c33; c0
land GH_ACCESS=false -- "$W"; res "case 33 false" 0 "not landed: no push access"
nopush "case 33"; hasnt "$(ghlog)" "branches" "case 33: no protection call"; hasnt "$(ghlog)" "pr " "case 33: no pr call"
has "$(ghlog)" ".permissions.push | tostring" "case 33: the access probe uses | tostring"
land GH_ACCESS=null -- "$W"; res "case 33 null" 1 "stuck: push access unknown (token lacks permissions)"
land GH_ACCESS=empty -- "$W"; res "case 33 empty" 1 "stuck: push access unknown (token lacks permissions)"
land GH_ACCESS=404 -- "$W"; res "case 33 404" 1 "stuck: cannot read push access: gh: Not Found (HTTP 404)"
land GH_ACCESS=hang -- "$W"; res "case 33 hang" 1 "stuck: cannot read push access: timed out"
ok "$([ "$el" -lt 15 ] && echo y)" y "case 33 hang: bounded (${el}s < 15s)"

echo "== 34. labelling"
ghreset; mkrepo c34; c0
land GH_LABELS=404-then-ok -- "$W"; res "case 34" 0 "queued https://github.com/o/c34/pull/1"
ok "$(ghlog | grep -E 'labels' | awk '{print $4}' | tr '\n' ' ')" "repos/o/c34/issues/1/labels repos/o/c34/labels repos/o/c34/issues/1/labels " "case 34: add, create, add"
hasnt "$err" "label failed" "case 34: no label failure"
ghreset; land GH_LABELS=404-then-ok GH_LABELCREATE=422 -- "$W"; res "case 34 422" 0 "queued …"
ok "$(cnt "$(ghlog)" "issues/1/labels")" 2 "case 34: a 422 create still retries the add"
hasnt "$err" "label failed" "case 34 422: counts as success"
ghreset; land GH_LABELS=hang -- "$W"; res "case 34 hang" 0 "queued …"
has "$err" "land: label failed: timed out" "case 34 hang: label failed: timed out"
hasnt "$(ghlog)" "pr edit" "case 34: never pr edit"

echo "== 35. the deadline"
ghreset; mkrepo c35; c0; srvcommit c35 x.txt X; edit
land LAND_TIMEOUT=30 LAND_DEADLINE=12 GH_LABELS=hang GH_LABELCREATE=hang -- "$W" "$W/THREAD.md"
res "case 35" 0 "queued: needs merge https://github.com/o/c35/pull/1"
has "$err" "land: label failed" "case 35: label failed"
has "$err" "land: skipped label retry: deadline" "case 35: skipped label retry"
has "$err" "land: skipped merge: deadline" "case 35: skipped merge"; hasnt "$(ghlog)" "pr merge" "case 35: no pr merge"
has "$err" "land: skipped update-branch: deadline" "case 35: skipped update-branch"; hasnt "$(ghlog)" "update-branch" "case 35: no PUT"
ok "$([ "$el" -lt 25 ] && echo y)" y "case 35: under the deadline (${el}s < 25s)"
edit; land LAND_DEADLINE=0 -- "$W" "$W/THREAD.md"
res "case 35 deadline 0" 1 "stuck: deadline passed before fetch"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 35 deadline 0: THREAD.md committed"; nossh "case 35 deadline 0"

echo "== 36. unrelated histories"
ghreset; mkrepo c36; W="$tmp/w/c36u"; git init -q -b master "$W"; git -C "$W" remote add origin git@github.com:o/c36.git
echo t > "$W/THREAD.md"
land -- "$W" "$W/THREAD.md"; res "case 36 unborn" 1 "stuck: local branch has no common history with origin/master"
has "$err" "land: nothing committed" "case 36 unborn: nothing committed"
W="$tmp/w/c36o"; git init -q -b master "$W"; git -C "$W" remote add origin git@github.com:o/c36.git
echo t > "$W/THREAD.md"; git -C "$W" add THREAD.md; git -C "$W" commit -qm "📝 docs(thread): orphan"; edit
land -- "$W" "$W/THREAD.md"; res "case 36 orphan" 1 "stuck: local branch has no common history with origin/master"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 36 orphan: committed first"
nopush "case 36 orphan"; hasnt "$(ghlog)" "pr " "case 36 orphan: no pr call"; hasnt "$(ghlog)" "pulls" "case 36 orphan: no pulls call"

echo "== 37. the lookup window"
ghreset; mkrepo c37; c0
seedpr OPEN "close/2020-01-01-old-$(sha12)" "$(git -C "$W" rev-parse HEAD)"
python3 - "$GH_STATE/prs.json" <<'PY'
import json, sys
f = sys.argv[1]; prs = json.load(open(f))
for k in range(250):
    prs.insert(0, {"number": 1000 + k, "url": "https://github.com/o/x/pull/%d" % (1000 + k), "state": "MERGED",
                   "headRefName": "close/2020-01-01-n-%012d" % k, "headRefOid": "%040d" % k,
                   "isCrossRepository": False})
json.dump(prs, open(f, "w"))
PY
land -- "$W"; res "case 37" 0 "queued https://github.com/o/x/pull/1"
nopush "case 37"; hasnt "$(ghlog)" "POST repos/o/c37/pulls" "case 37: the older OPEN match is reused"
python3 - "$GH_STATE/prs.json" <<'PY'
import json, sys
f = sys.argv[1]; prs = json.load(open(f))
for p in prs:
    if p["number"] == 1: p["state"] = "CLOSED"
json.dump(prs, open(f, "w"))
PY
land -- "$W"; res "case 37 control" 0 "queued https://github.com/o/c37/pull/1250"
has "$(ghlog)" "POST repos/o/c37/pulls" "case 37 control: a CLOSED match beyond 200 is not seen"

echo "== 38. zero paths with pre-staged work"
for LAND_SHELL in "$BASH32" bash; do
  L="[$LAND_SHELL]"
  ghreset; mkrepo "c38a${#LAND_SHELL}"; echo b > "$W/src/b.txt"; git -C "$W" add src/b.txt; H0=$(git -C "$W" rev-parse HEAD)
  land GH_PROT=false -- "$W"; res "case 38 $L 24b" 0 landed
  has "$err" "land: nothing to land" "case 38 $L 24b: nothing to land"; has "$err" "land: nothing committed" "case 38 $L 24b: nothing committed"
  ok "$(git -C "$W" rev-parse HEAD)" "$H0" "case 38 $L 24b: HEAD unchanged"
  ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 38 $L 24b: src/b.txt still staged"
  land GH_PROT=false -- "$W" "$W/docs/handoffs/gone.md"; res "case 38 $L 24c" 0 landed
  has "$err" "land: dropped docs/handoffs/gone.md" "case 38 $L 24c: dropped"; has "$err" "land: nothing committed" "case 38 $L 24c: nothing committed"
  ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 38 $L 24c: src/b.txt still staged"
  ghreset; mkrepo "c38d${#LAND_SHELL}"; c0; C0=$(git -C "$W" rev-parse HEAD); echo b > "$W/src/b.txt"; git -C "$W" add src/b.txt
  land -- "$W"; res "case 38 $L 24d" 0 "queued …"
  has "$err" "land: carried 1 earlier close-out commit(s)" "case 38 $L 24d: carried 1"
  ok "$(srvclose "c38d${#LAND_SHELL}" | cut -d' ' -f2)" "$C0" "case 38 $L 24d: the server close/ branch is C0"
  ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 38 $L 24d: src/b.txt still staged"
  ghreset; mkrepo "c38e${#LAND_SHELL}"; echo b > "$W/src/b.txt"; git -C "$W" add src/b.txt
  printf -- '- o/c38e%s — team\n' "${#LAND_SHELL}" > "$LANDING_REGISTER"
  land -- "$W"; res "case 38 $L 24e" 0 "not landed: listed o/c38e${#LAND_SHELL}: team"
  has "$err" "land: nothing committed" "case 38 $L 24e: nothing committed"
  ok "$(git -C "$W" status --porcelain -- src/b.txt)" "A  src/b.txt" "case 38 $L 24e: src/b.txt still staged"
  : > "$LANDING_REGISTER"
done
LAND_SHELL=bash

echo "== 39. a setsid holder cannot pin stdout"
ghreset; mkrepo c39
cat > "$W/.git/hooks/post-commit" <<EOF
#!/bin/sh
perl -MPOSIX -e 'exit if fork; POSIX::setsid(); open my \$f, ">", "$tmp/holder.pid"; print \$f \$\$; close \$f; sleep 40'
EOF
chmod +x "$W/.git/hooks/post-commit"; edit; rm -f "$tmp/holder.pid"
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 39" 0 landed
ok "$([ "$el" -lt 15 ] && echo y)" y "case 39: returned while the holder lives (${el}s < 15s)"
for k in 1 2 3 4 5; do [ -s "$tmp/holder.pid" ] && break; sleep 1; done
hp=$(cat "$tmp/holder.pid" 2>/dev/null); [ -n "$hp" ] && holders+=("$hp")
ok "$([ -n "$hp" ] && kill -0 "$hp" 2>/dev/null && echo alive)" alive "case 39: the holder was alive (precondition)"
if command -v lsof >/dev/null 2>&1 && [ -n "$hp" ]; then
  ok "$(lsof -p "$hp" 2>/dev/null | awk '$4 ~ /^1[rwu]?$/' | grep -c PIPE)" 0 "case 39: the holder holds no pipe on fd 1"
else
  echo "SKIP - case 39 lsof control (no lsof)"
fi
[ -n "$hp" ] && kill -9 "$hp" 2>/dev/null
edit; rm -f "$tmp/holder.pid"
fill "$W" c39 "" "$W/THREAD.md"
snip bash GH_PROT=false; res "case 39 snippet" 0 landed
ok "$([ "$el" -lt 15 ] && echo y)" y "case 39 snippet: returned while the holder lives (${el}s < 15s)"
for k in 1 2 3 4 5; do [ -s "$tmp/holder.pid" ] && break; sleep 1; done
hp=$(cat "$tmp/holder.pid" 2>/dev/null); [ -n "$hp" ] && { holders+=("$hp"); kill -9 "$hp" 2>/dev/null; }

echo "== 40. a refused push says why"
ghreset; mkrepo c40; edit
land GH_PROT=false FAKE_SSH=move -- "$W" "$W/THREAD.md"
res "case 40 (non-fast-forward)" 1 "stuck: push refused: ! [rejected] HEAD -> master (fetch first)"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 40: committed first"
ghreset; mkrepo c40b
printf '#!/bin/sh\necho "error: GH006: Protected branch update failed for refs/heads/master." >&2\nexit 1\n' > "$SRV/o/c40b.git/hooks/pre-receive"
chmod +x "$SRV/o/c40b.git/hooks/pre-receive"; S=$(srvref c40b master); edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 40b (declined by the server)" 1 "stuck: push refused: remote: error: GH006: Protected branch update failed for refs/heads/master."
ok "$(srvref c40b master)" "$S" "case 40b: server untouched"

echo "== 41. handoff's # thread:handoff-land snippet"
HANDOFF=$root/skills/handoff/SKILL.md
o=$(grep -cE '^[[:space:]]*# thread:handoff-land( |$)' "$HANDOFF"); c=$(grep -cE '^[[:space:]]*# end thread:handoff-land$' "$HANDOFF")
ok "$o/$c" "1/1" "one # thread:handoff-land marker pair"
awk '{ l=$0; sub(/^[ \t]+/, "", l) }
     l ~ /^# thread:handoff-land( |$)/ { on=1; ind=substr($0, 1, length($0)-length(l)); next }
     l == "# end thread:handoff-land" { on=0 }
     on { if (index($0, ind) == 1) print substr($0, length(ind)+1); else print $0 }' "$HANDOFF" > "$tmp/hsnip.sh"
ok "$(grep -c 'bash "$ld"' "$tmp/hsnip.sh")" 1 "the handoff snippet has exactly one bash \"\$ld\" line"
ok "$(tail -n 1 "$tmp/hsnip.sh")" 'bash "$ld" --slug "$slug" -F "$msg" -- "$home" "$doc"' "the land.sh call is the handoff snippet's last line"
# fill41 <message> → $tmp/run.sh, handoff's snippet filled for the doc $W/docs/handoffs/2026-01-01-x.md.
fill41() {
  sed -e "s|home='<home>'|home='$W'|" -e "s|slug='<slug>'|slug='x'|" \
      -e "s|doc='<abs doc path>'|doc='$W/docs/handoffs/2026-01-01-x.md'|" -e "s|<message>|$1|" "$tmp/hsnip.sh" > "$tmp/run.sh"
}
mkdoc() { D="$W/docs/handoffs/2026-01-01-x.md"; mkdir -p "$W/docs/handoffs"; echo "pending" > "$D"; }
nomsg() { ok "$(ls -A "$TMPDIR" | grep -c '^land-msg\.')" 0 "$1: no land-msg.* file left"; }
isuntracked() { git -C "$W" ls-files --error-unmatch docs/handoffs/2026-01-01-x.md >/dev/null 2>&1 && echo tracked || echo untracked; }
for sh in "$BASH32" "${shells[@]}"; do
  L="case 41 [$sh]"
  # Protected: committed on master, pushed to a close/ branch, merge queued, never waited on.
  ghreset; mkrepo "c41p${#sh}"; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh"; res "$L protected" 0 "queued https://github.com/o/c41p${#sh}/pull/1"; nomsg "$L protected"
  ok "$(git -C "$W" symbolic-ref HEAD)" refs/heads/master "$L: the checkout stays on master"
  ok "$([ -f "$D" ] && echo y)" y "$L: the doc is still on disk"
  ok "$(git -C "$W" log -1 --format=%s)" "📝 docs(handoff): x" "$L: HEAD is the doc's commit"
  ok "$(git -C "$W" show --name-only --format= HEAD | tr '\n' ' ')" "docs/handoffs/2026-01-01-x.md " "$L: the commit holds the doc only"
  ok "$(cnt "$(ghlog)" "pr merge 1 ")" 1 "$L: one pr merge"
  has "$(ghlog | grep -F 'pr merge 1 ')" "--auto" "$L: the merge is queued with --auto"
  hasnt "$(ghlog)" "pr checks" "$L: no pr checks"; hasnt "$(ghlog)" "--watch" "$L: no --watch"
  # Unprotected: pushed.
  ghreset; mkrepo "c41u${#sh}"; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh" GH_PROT=false; res "$L unprotected" 0 landed; nomsg "$L unprotected"
  ok "$(srvref "c41u${#sh}" master)" "$(git -C "$W" rev-parse HEAD)" "$L unprotected: landed on the server"
  # Withdrawal: rm -f, then the same snippet lands the removal.
  rm -f "$D"; fill41 "🔧 chore(handoff): withdraw x"
  snip "$sh" GH_PROT=false; res "$L withdrawal" 0 landed; nomsg "$L withdrawal"
  ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/handoffs/2026-01-01-x.md|" "$L withdrawal: the deletion is committed"
  ok "$(git -C "$W" symbolic-ref HEAD)" refs/heads/master "$L withdrawal: still on master"
  ok "$(srvref "c41u${#sh}" master)" "$(git -C "$W" rev-parse HEAD)" "$L withdrawal: landed on the server"
  # Refresh: origin moved on; the default is fast-forwarded first, an untracked scratch file untouched.
  ghreset; mkrepo "c41r${#sh}"; srvcommit "c41r${#sh}" other.txt theirs; S=$(srvref "c41r${#sh}" master)
  echo mine > "$W/scratch.txt"; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh" GH_PROT=false; res "$L refresh" 0 landed; nomsg "$L refresh"
  ok "$(cat "$W/other.txt" 2>/dev/null)" theirs "$L refresh: origin's file is in the working tree"
  ok "$(git -C "$W" merge-base --is-ancestor "$S" HEAD && echo y)" y "$L refresh: origin's commit is in HEAD's ancestry"
  ok "$(git -C "$W" rev-parse HEAD^)" "$S" "$L refresh: the doc commit sits on top of origin's"
  ok "$(git -C "$W" status --porcelain -- scratch.txt)/$(cat "$W/scratch.txt")" "?? scratch.txt/mine" "$L refresh: the scratch file is untouched"
  # Not versioned: a detached HEAD commits nothing; the doc is on disk only.
  ghreset; mkrepo "c41n${#sh}"; git -C "$W" checkout -q --detach; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh"; res "$L detached" 1 "stuck: detached HEAD"; nomsg "$L detached"
  has "$err" "land: nothing committed" "$L detached: nothing committed"
  ok "$([ -f "$D" ] && echo y)/$(isuntracked)" y/untracked "$L detached: the doc is on disk, untracked"
  # A bogus CLAUDE_PLUGIN_ROOT: the guard exits 2 before anything is created; no fallback commit.
  git -C "$W" checkout -q master
  snip "$sh" CLAUDE_PLUGIN_ROOT="$tmp/nowhere"; ok "$rc/$out" "2/" "$L: a bogus CLAUDE_PLUGIN_ROOT → rc 2, stdout empty"
  has "$err" "land: script not found" "$L: …and says so"
  ok "$([ -f "$D" ] && echo y)/$(isuntracked)" y/untracked "$L: the doc stays on disk, uncommitted"
  tmpempty "$L bogus root"
done

echo
[ "$fail" = 0 ] && echo "land.test.sh: ALL PASS" || echo "land.test.sh: FAILED"
exit "$fail"
