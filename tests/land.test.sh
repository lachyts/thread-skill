#!/usr/bin/env bash
# skills/_shared/scripts/land.sh — the shared landing route (ADR 0028, queue and finish) — close's
# `# thread:land` snippet and handoff's `# thread:handoff-land` snippet (cases 1–41), and its own-branch mode
# with close's `# thread:land-own` snippet (cases 42–70). Fixture repos talk to bare "servers" under $tmp/srv
# through a fake ssh that maps git@github.com:<o>/<r>.git and ssh://git@github.com/<o>/<r>.git there; a fake
# `gh` (tests/fixtures/land/fake-gh.py) logs every call and serves protection, access, PR list/create/merge,
# labels, update-branch, the user, PR bodies, hold comments and per-SHA check-runs and status. Every handed
# path goes through a symlinked alias of the temp dir, so the physical-path handling is exercised on every run.
# Hang stubs run a non-exec `sleep 40 | cat`. A call handed any `*=hang*` setting runs under
# LAND_TIMEOUT=$HANG and asserts elapsed under $HANG_BOUND (case 35 passes its own LAND_TIMEOUT after it, which
# wins, and a HANG_BOUND prefix, since its deadline is the bound); every other call has the 15 s suite default,
# room for a fake gh slowed by `make test`'s concurrent suites. Hermetic: HOME, the global git config and TMPDIR
# are temp, and the caller's GIT_DIR & co. are unset. bash 3.2-compatible (macOS).
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
export LAND_TIMEOUT=15 LAND_DEADLINE=300
HANG=4 HANG_BOUND=25   # a hang call's LAND_TIMEOUT (land() applies it) and its elapsed bound, under a stub's 40 s
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
  local extra=() hang=() e
  while [ $# -gt 0 ] && [ "$1" != -- ]; do extra+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  for e in ${extra[@]+"${extra[@]}"}; do case $e in *=hang*) hang=(LAND_TIMEOUT=$HANG) ;; esac; done
  : > "$LOG_SSH"; : > "$LOG_GH"
  local s=$SECONDS
  out=$(env ${hang[@]+"${hang[@]}"} ${extra[@]+"${extra[@]}"} $LAND_SHELL "$LAND" "$@" 2>"$tmp/err"); rc=$?
  el=$((SECONDS - s)); err=$(cat "$tmp/err")
  [ ${#hang[@]} = 0 ] || ok "$([ "$el" -lt "$HANG_BOUND" ] && echo y)" y "hang (${extra[*]}): bounded (${el}s < ${HANG_BOUND}s)"
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
ok "$(head -n 1 "$GH_STATE/body.txt")" "Landing for \`$(sha12)\` (ADR 0028)." "case 1: the PR body names the landing, not a caller"
hasnt "$(cat "$GH_STATE/body.txt")" "thread:close" "case 1: the PR body does not say thread:close"
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
land GH_LIST_ALL=fail -- "$W"; res "case 9c" 1 "stuck: cannot look up landing PR: gh: Server Error (HTTP 502)"
nopush "case 9c"
land GH_LIST=badjson -- "$W"; res "case 9d (bad JSON)" 1 "stuck: cannot look up landing PR: bad JSON from the PR list"

# ==== Protection probe and unprotected route ==============================================================
echo "== 10. protection unreadable"
ghreset; mkrepo c10; edit
land GH_PROT=404 -- "$W" "$W/THREAD.md"; res "case 10" 1 "stuck: cannot read branch protection: gh: Branch not found (HTTP 404)"
nopush "case 10"; ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 10: committed first"
land GH_PROT=hang -- "$W"; res "case 10b" 1 "stuck: cannot read branch protection: timed out"

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

echo "== 22. fetch hangs"
ghreset; mkrepo c22; edit
land FAKE_SSH=hang -- "$W" "$W/THREAD.md"
res "case 22" 1 "stuck: cannot fetch origin/master: timed out"
ok "$(made)" "$(git -C "$W" rev-parse HEAD)" "case 22: committed first"
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
for w in nohup disown setsid '--watch' 'sleep ' default-branch.sh 'gh pr edit' 'gh pr create' 'gh pr checks' 'gh label' '--search' \
         '3>&1' '>&3' 'exec 3' 'set -u' 'nounset' 'set -e' 'reset --keep' 'reset --hard' \
         'commit -a' ' --all' ' -am' 'budget()' 'push -u' '--set-upstream' 'branch -D' 'branch -d' ' --delete'; do
  hasnt "$code" "$w" "structural: no [$w]"
done
# ` checkout` is never a git command here; messages may name the checkout, so double-quoted strings are
# stripped first (a real `git -C "$wt" checkout` still matches).
ok "$(printf '%s\n' "$code" | sed 's/"[^"]*"//g' | grep -c ' checkout')" 0 "structural: no [ checkout] command"
ok "$(printf '%s\n' "$code" | grep -cE '(^|[^&])&[[:space:]]*$')" 0 "structural: no trailing &"
ok "$(printf '%s\n' "$code" | grep -E 'git push' | grep -cE -- '--force|-f |[[:space:]]"?\+')" 0 "structural: no force push"
ok "$(head -n 1 "$LAND")" "#!/usr/bin/env bash" "structural: the shebang has no -u"
ok "$(printf '%s\n' "$code" | grep -c 'thread:close')" 0 "structural: land.sh names no caller in what it writes"
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
# The own-branch mode is one delimited block; the close-out route outside it fetches and fast-forwards only in S4.
ownb=$(awk '/^# ==== own-branch mode/{on=1} on{print} /^# ==== end own-branch mode/{exit}' "$LAND" | grep -v '^[[:space:]]*#')
closeout=$(awk '/^# ==== own-branch mode/{on=1} !on{print} /^# ==== end own-branch mode/{on=0}' "$LAND" | grep -v '^[[:space:]]*#')
ok "$(printf '%s\n' "$closeout" | grep -cE 'git fetch|merge --ff-only')" 2 "structural: the close-out route fetches and fast-forwards only in S4"
ok "$(printf '%s\n' "$ownb" | grep -cE 'git fetch')" 3 "structural: own-branch fetches origin/<d>, origin/<B> and a merged PR's head only"
ok "$(printf '%s\n' "$ownb" | grep -c 'merge --ff-only')" 1 "structural: own-branch fast-forwards once (O9)"
ok "$(printf '%s\n' "$ownb" | grep -c 'git push')" 1 "structural: own-branch pushes once"
has "$ownb" 'bounded git push origin "refs/heads/$B:refs/heads/$B"' "structural: …<B> to itself, no -u, no force"
ok "$(printf '%s\n' "$ownb" | grep -c 'gh pr checks')" 0 "structural: own-branch reads checks over REST only"
has "$ownb" 'commits/$1/check-runs?per_page=100' "structural: …check-runs"; has "$ownb" 'commits/$1/status' "structural: …and the combined status"
ok "$(printf '%s\n' "$ownb" | grep -c 'git commit')" 0 "structural: own-branch never commits (merge commits come from git merge in the scratch worktree)"
ok "$(grep -c '^  if \[ "${1:-}" = --own-branch \]; then shift; own_main "$@"; exit 1; fi$' "$LAND")" 1 "structural: --own-branch dispatches at the top of main"

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
# LAND_TIMEOUT=600 outlives the 40 s hang stub, so `label failed: timed out` proves the deadline clipped the call's
# budget. A deadline that passes before the label call (no `label failed`) is load, not a regression: retry once
# with a longer one (still under the stub's 40 s), then SKIP.
hit=
for d in 12 30; do
  ghreset; mkrepo "c35d$d"; c0; srvcommit "c35d$d" x.txt X; edit
  HANG_BOUND=600 land LAND_TIMEOUT=600 LAND_DEADLINE=$d GH_LABELS=hang GH_LABELCREATE=hang -- "$W" "$W/THREAD.md"
  case $err in *"land: label failed"*) hit=y; break ;; esac
  echo "SKIP - case 35 (deadline ${d}s): the deadline passed before the label call (a loaded host)"
done
if [ "$hit" = y ]; then
  res "case 35" 0 "queued: needs merge https://github.com/o/c35d$d/pull/1"
  has "$err" "land: label failed: timed out" "case 35: the label call was cut by the ${d}s deadline (timed out, not its own 600 s budget)"
  has "$err" "land: skipped label retry: deadline" "case 35: skipped label retry"
  has "$err" "land: skipped merge: deadline" "case 35: skipped merge"; hasnt "$(ghlog)" "pr merge" "case 35: no pr merge"
  has "$err" "land: skipped update-branch: deadline" "case 35: skipped update-branch"; hasnt "$(ghlog)" "update-branch" "case 35: no PUT"
fi
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
isuntracked() { git -C "$W" ls-files --error-unmatch docs/handoffs/2026-01-01-x.md >/dev/null 2>&1 && echo tracked || echo untracked; }
for sh in "$BASH32" "${shells[@]}"; do
  L="case 41 [$sh]"
  # Protected: committed on master, pushed to a close/ branch, merge queued, never waited on.
  ghreset; mkrepo "c41p${#sh}"; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh"; res "$L protected" 0 "queued https://github.com/o/c41p${#sh}/pull/1"
  ok "$(git -C "$W" symbolic-ref HEAD)" refs/heads/master "$L: the checkout stays on master"
  ok "$([ -f "$D" ] && echo y)" y "$L: the doc is still on disk"
  ok "$(git -C "$W" log -1 --format=%s)" "📝 docs(handoff): x" "$L: HEAD is the doc's commit"
  ok "$(git -C "$W" show --name-only --format= HEAD | tr '\n' ' ')" "docs/handoffs/2026-01-01-x.md " "$L: the commit holds the doc only"
  ok "$(cnt "$(ghlog)" "pr merge 1 ")" 1 "$L: one pr merge"
  has "$(ghlog | grep -F 'pr merge 1 ')" "--auto" "$L: the merge is queued with --auto"
  has "$(ghlog | grep -F '/pulls ')" "title=📝 docs(handoff): x -f head=close/" "$L: the PR is titled with the doc's commit subject"
  has "$(cat "$GH_STATE/body.txt")" "Landing for \`$(sha12)\`" "$L: the PR body names the doc's landing"
  hasnt "$(cat "$GH_STATE/body.txt")" "thread:close" "$L: the handoff's PR body does not say thread:close"
  hasnt "$(ghlog)" "pr checks" "$L: no pr checks"; hasnt "$(ghlog)" "--watch" "$L: no --watch"
  # Unprotected: pushed.
  ghreset; mkrepo "c41u${#sh}"; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh" GH_PROT=false; res "$L unprotected" 0 landed
  ok "$(srvref "c41u${#sh}" master)" "$(git -C "$W" rev-parse HEAD)" "$L unprotected: landed on the server"
  # Withdrawal: rm -f, then the same snippet lands the removal.
  rm -f "$D"; fill41 "🔧 chore(handoff): withdraw x"
  snip "$sh" GH_PROT=false; res "$L withdrawal" 0 landed
  ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/handoffs/2026-01-01-x.md|" "$L withdrawal: the deletion is committed"
  ok "$(git -C "$W" symbolic-ref HEAD)" refs/heads/master "$L withdrawal: still on master"
  ok "$(srvref "c41u${#sh}" master)" "$(git -C "$W" rev-parse HEAD)" "$L withdrawal: landed on the server"
  # Withdrawing a doc that is already gone commits nothing: `landed` with `land: nothing to land` and a
  # `dropped` line, which handoff § Commit it reads as no landing row and `not versioned: <path> (not on disk)`.
  H=$(git -C "$W" rev-parse HEAD); snip "$sh" GH_PROT=false; res "$L withdrawal of a gone doc" 0 landed
  has "$err" "land: nothing to land" "$L withdrawal of a gone doc: nothing to land"
  has "$err" "land: dropped docs/handoffs/2026-01-01-x.md (not on disk, never tracked)" "$L withdrawal of a gone doc: the path is dropped"
  ok "$(git -C "$W" rev-parse HEAD)" "$H" "$L withdrawal of a gone doc: no commit"
  # Refresh: origin moved on; the default is fast-forwarded first, an untracked scratch file untouched.
  ghreset; mkrepo "c41r${#sh}"; srvcommit "c41r${#sh}" other.txt theirs; S=$(srvref "c41r${#sh}" master)
  echo mine > "$W/scratch.txt"; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh" GH_PROT=false; res "$L refresh" 0 landed
  ok "$(cat "$W/other.txt" 2>/dev/null)" theirs "$L refresh: origin's file is in the working tree"
  ok "$(git -C "$W" merge-base --is-ancestor "$S" HEAD && echo y)" y "$L refresh: origin's commit is in HEAD's ancestry"
  ok "$(git -C "$W" rev-parse HEAD^)" "$S" "$L refresh: the doc commit sits on top of origin's"
  ok "$(git -C "$W" status --porcelain -- scratch.txt)/$(cat "$W/scratch.txt")" "?? scratch.txt/mine" "$L refresh: the scratch file is untouched"
  # Not versioned: a detached HEAD commits nothing; the doc is on disk only.
  ghreset; mkrepo "c41n${#sh}"; git -C "$W" checkout -q --detach; mkdoc; fill41 "📝 docs(handoff): x"
  snip "$sh"; res "$L detached" 1 "stuck: detached HEAD"
  has "$err" "land: nothing committed" "$L detached: nothing committed"
  ok "$([ -f "$D" ] && echo y)/$(isuntracked)" y/untracked "$L detached: the doc is on disk, untracked"
  # A bogus CLAUDE_PLUGIN_ROOT: the guard exits 2 before anything is created; no fallback commit.
  git -C "$W" checkout -q master
  snip "$sh" CLAUDE_PLUGIN_ROOT="$tmp/nowhere"; ok "$rc/$out" "2/" "$L: a bogus CLAUDE_PLUGIN_ROOT → rc 2, stdout empty"
  has "$err" "land: script not found" "$L: …and says so"
  ok "$([ -f "$D" ] && echo y)/$(isuntracked)" y/untracked "$L: the doc stays on disk, uncommitted"
  tmpempty "$L bogus root"
done

# ==== Own-branch mode (ADR 0028 §§ 1–3, 5; close § Land the own branch) =====================================
OB=feat/x
# mkbranch <name>: mkrepo, then the own branch $OB checked out with one work commit on it.
mkbranch() { mkrepo "$1"; git -C "$W" checkout -q -b "$OB"; work "first work"; }
# work <subject>: a code commit on the checkout.
work() { echo "$1" >> "$W/src/c.txt"; git -C "$W" commit -qam "✨ feat: $1"; }
# docscommit <file> <content> [<subject>]: a docs/reviews/-only commit (a review doc added or edited).
docscommit() {
  mkdir -p "$W/docs/reviews"; printf '%s\n' "$2" > "$W/docs/reviews/$1"
  git -C "$W" add "docs/reviews/$1"; git -C "$W" commit -qm "${3:-📝 docs(review): $1}" -- "docs/reviews/$1"
}
# docsdelete: the one deletion commit for every review doc on the checkout.
docsdelete() { git -C "$W" rm -rq docs/reviews; git -C "$W" commit -qm "🔧 chore(review): delete this loop's review docs"; }
# srvbranchcommit <name> <branch> <file> <content>: a commit on the server's <branch> from a second clone.
srvbranchcommit() {
  local n=$1 br=$2 f=$3 c=$4 O
  O=$(mktemp -d "$tmp/oc.XXXXXX")
  git clone -q -b "$br" "$SRV/o/$n.git" "$O/c" 2>/dev/null
  printf '%s\n' "$c" > "$O/c/$f"
  git -C "$O/c" add -A && git -C "$O/c" commit -qm "origin: $f" && git -C "$O/c" push -q origin "HEAD:$br" 2>/dev/null
  rm -rf "$O"
}
# srvmergepr <name> <n>: GitHub merges PR <n> — its head merged into the server's master with a merge commit.
srvmergepr() {
  local n=$1 pr=$2 O head
  head=$(python3 -c 'import json, sys; print([p for p in json.load(open(sys.argv[1])) if p["number"] == int(sys.argv[2])][0]["headRefName"])' "$GH_STATE/prs.json" "$pr")
  O=$(mktemp -d "$tmp/oc.XXXXXX")
  git clone -q "$SRV/o/$n.git" "$O/c" 2>/dev/null
  git -C "$O/c" merge -q --no-ff --no-edit "origin/$head" && git -C "$O/c" push -q origin HEAD:master 2>/dev/null
  rm -rf "$O"
  git --git-dir "$SRV/o/$n.git" update-ref "refs/pull/$pr/head" "$(srvref "$n" "$head")"
  setpr "$pr" state MERGED
}
# setpr <n> <key> <json-ish value>: edit one field of PR <n> in the fake's state (null, {} or a string).
setpr() {
  python3 - "$GH_STATE/prs.json" "$@" <<'PY'
import json, sys
f, n, k, v = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
prs = json.load(open(f))
for p in prs:
    if p["number"] == n:
        p[k] = None if v == "null" else {"mergeMethod": "MERGE"} if v == "{}" else v
json.dump(prs, open(f, "w"))
PY
}
# seedown <state> <head> <oid> <login> [cross]: prepend a PR with an author (newest first).
seedown() {
  python3 - "$GH_STATE/prs.json" "$@" <<'PY'
import json, sys
f, state, name, oid, login = sys.argv[1:6]
try:
    prs = json.load(open(f))
except FileNotFoundError:
    prs = []
n = max([p["number"] for p in prs] + [0]) + 1
prs.insert(0, {"number": n, "url": "https://github.com/o/x/pull/%d" % n, "state": state, "headRefName": name,
               "headRefOid": oid, "isCrossRepository": len(sys.argv) > 6, "author": {"login": login},
               "autoMergeRequest": None})
json.dump(prs, open(f, "w"))
PY
}
# addworkflow: commit a GitHub Actions workflow on the checkout, so the repo has CI.
addworkflow() {
  mkdir -p "$W/.github/workflows"; printf 'on: pull_request\njobs: {}\n' > "$W/.github/workflows/ci.yml"
  git -C "$W" add .github && git -C "$W" commit -qm "🔧 chore(ci): workflow" -- .github
}
# fr_digest: a verbatim copy of fresh-review's Step 1 diff6 pipeline (~/.agents/skills/fresh-review/SKILL.md
# § Step 1 — Resolve the scope mechanically), run in $W. land.sh's `land: digest` must equal it.
fr_digest() (
  cd "$W" || exit 1
top="$(git rev-parse --show-toplevel)"
up="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || true)"
# GNU stat first: on GNU, `-f` is --file-system and succeeds with the wrong output.
fmt=(-c '%n %s %Y'); stat -c %n -- "$top" >/dev/null 2>&1 || fmt=(-f '%N %z %m')
{ git -C "$top" diff HEAD -- . ':!docs/reviews'
  [ -n "$up" ] && git -C "$top" diff "$up...HEAD" -- . ':!docs/reviews'
  git -C "$top" ls-files --others --exclude-standard -z -- . ':!docs/reviews' \
    | (cd "$top" && xargs -0 -r stat "${fmt[@]}" --) \
    | LC_ALL=C sort
} | shasum -a 1 | cut -c1-6
)
digest() { printf '%s\n' "$err" | sed -n 's/^land: digest //p'; }
upstream() { git -C "$W" rev-parse --abbrev-ref "$OB@{upstream}" 2>/dev/null; }
tip() { git -C "$W" rev-parse HEAD; }
h7() { printf '%s' "$1" | cut -c1-7; }
merges() { ghlog | grep -F 'pr merge' | grep -vF -- '--disable-auto'; }
direct() { merges | grep -vF -- '--auto'; }
checkreads() { ghlog | grep -oE 'commits/[0-9a-f]{40}/' | sort -u | grep -c .; }
# own [VAR=value …] -- [<own-branch args>…]: land.sh --own-branch --branch $OB … -- $W.
own() {
  local extra=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do extra+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  land ${extra[@]+"${extra[@]}"} -- --own-branch --branch "$OB" "$@" -- "$W"
}
# ores <label> <rc> <stdout>: res, plus no refs/land/* left behind.
ores() { res "$@"; ok "$(git -C "$W" for-each-ref refs/land/ | grep -c .)" 0 "$1: no refs/land/* left"; }
# qsetup <name> [plain-call VAR=value …]: the own branch pushed by a plain call (PR 1), R its reviewed HEAD,
# then a review doc's add, consumed and deletion commits (docs/reviews/ only), H the new HEAD.
qsetup() {
  local n=$1; shift
  ghreset; mkbranch "$n"; own "$@" --; R=$(tip)
  docscommit r1.md "status: pending"; docscommit r1.md "status: consumed"; docsdelete; H=$(tip)
}

echo "== 42. own branch: plain, protected, fresh <B>"
ghreset; mkbranch c42; F=$(tip)
own --
ores "case 42" 0 "pr open https://github.com/o/c42/pull/1"
ok "$(srvref c42 "$OB")" "$F" "case 42: <B> pushed unchanged"
ok "$(ghlog | awk '{print $1" "$2" "$3" "$4}' | tr '\n' '|')" \
   "api repos/o/c42 --jq .permissions.push|pr list -R o/c42|api --method POST repos/o/c42/pulls|api --method POST repos/o/c42/issues/1/labels|" \
   "case 42: gh calls: access, lookup, create, label"
has "$(ghlog)" "pr list -R o/c42 --state all --head $OB --limit 30 --json number,url,state,headRefName,headRefOid,isCrossRepository,author,autoMergeRequest" "case 42: one lookup by --head, every state"
has "$(ghlog)" "-f title=✨ feat: first work -f head=$OB -f base=master" "case 42: base master, head <B>, the oldest subject"
ok "$(merges | grep -c .)" 0 "case 42: no pr merge"
has "$err" "land: base $(srvref c42 master)" "case 42: land: base"; has "$err" "land: head $F" "case 42: land: head"
ok "$(upstream)" origin/master "case 42: @{upstream} is origin/master"
has "$err" "land: upstream origin/master (was none)" "case 42: the upstream line"
ok "$(digest)" "$(fr_digest)" "case 42: land: digest equals fresh-review's diff6"
ok "$([ -n "$(digest)" ] && [ "$(digest)" != da39a3 ] && echo y)" y "case 42: the digest is not the empty da39a3"
has "$(git -C "$W" config branch.$OB.remote)" origin "case 42: branch.<B>.remote is origin"
ok "$(head -n 1 "$GH_STATE/body.txt")" "Own-branch landing for \`$OB\` (ADR 0028 § 2): reviewed by /fresh-review before its merge is queued." \
   "case 42: the own-branch PR body names the landing, not a caller"
hasnt "$(cat "$GH_STATE/body.txt")" "thread:close" "case 42: the own-branch PR body does not say thread:close"

echo "== 43. own branch: a second plain call reuses the PR"
work "a fix"
own --
ores "case 43" 0 "pr open https://github.com/o/c42/pull/1"
ok "$(srvref c42 "$OB")" "$(tip)" "case 43: the fix is pushed"
hasnt "$(ghlog)" "POST repos/o/c42/pulls" "case 43: no second create"
has "$(ghlog)" "api user --jq .login" "case 43: the open PR's author is checked"
has "$err" "land: upstream origin/master (was origin/master)" "case 43: the upstream stays origin/master"

echo "== 44. own branch: push.default and a prior upstream"
ghreset; mkbranch c44; git -C "$W" config push.default upstream
own --
ores "case 44" 1 "stuck: push.default=upstream would push $OB to master"
nopush "case 44"; ok "$(git -C "$W" config push.default)" upstream "case 44: push.default untouched"
ok "$(git -C "$W" config "branch.$OB.merge")" "" "case 44: no upstream set"
git -C "$W" config --unset push.default
git -C "$W" push -q "$SRV/o/c44.git" "$OB"; git -C "$W" fetch -q "$SRV/o/c44.git" "+refs/heads/$OB:refs/remotes/origin/$OB"
git -C "$W" branch -q --set-upstream-to "origin/$OB" "$OB"
own --
ores "case 44b" 0 "pr open https://github.com/o/c44/pull/1"
has "$err" "land: upstream origin/master (was origin/$OB)" "case 44b: a prior origin/<B> upstream is replaced"
ok "$(upstream)" origin/master "case 44b: now origin/master"

echo "== 45. own branch: protected --queue"
qsetup c45a
own GH_CHECKS_MAP="$R=pass,$H=pending" -- --queue --reviewed "$R"
ores "case 45 pending" 0 "queued https://github.com/o/c45a/pull/1"
has "$(ghlog)" "pr merge 1 -R o/c45a --auto --merge" "case 45 pending: auto-merge queued"
ok "$(direct | grep -c .)" 0 "case 45 pending: no direct merge"
ok "$(srvref c45a "$OB")" "$H" "case 45: the deletion commit is pushed"
qsetup c45b
own GH_MERGE=notallowed GH_CHECKS_MAP="$R=pass,$H=pending" -- --queue --reviewed "$R"
ores "case 45 notallowed + pending" 0 "queued: needs merge https://github.com/o/c45b/pull/1"
ok "$(direct | grep -c .)" 0 "case 45 notallowed + pending: no direct merge"
qsetup c45c
own GH_MERGE=notallowed GH_CHECKS_MAP="$R=pass,$H=pass" -- --queue --reviewed "$R"
ores "case 45 notallowed + pass" 0 landed
ok "$(direct)" "pr merge 1 -R o/c45c --merge" "case 45 notallowed + pass: one direct merge"
qsetup c45d
own GH_MERGE=notallowed GH_CHECKS_MAP="$R=pass" -- --queue --reviewed "$R"
ores "case 45 notallowed + none, no CI" 0 landed
has "$err" "land: checks none (no ci)" "case 45 none: no CI at all"
qsetup c45e
own GH_MERGE=notallowed GH_DIRECT=fail GH_CHECKS_MAP="$R=pass,$H=pass" -- --queue --reviewed "$R"
ores "case 45 direct fails" 0 "queued: needs merge https://github.com/o/c45e/pull/1"
has "$err" "land: merge failed: GraphQL: Base branch was modified" "case 45 direct fails: says why"

echo "== 46. own branch: where failures come from"
qsetup c46
U="https://github.com/o/c46/pull/1"
own GH_CHECKS_MAP="$R=fail,$H=pending" -- --queue --reviewed "$R"
ores "case 46 R fail" 0 "ci failed: build (failure: Tests failed) https://github.com/o/c46/actions/runs/1"
ok "$(merges | grep -c .)" 0 "case 46 R fail: zero merges"
has "$err" "land: checks read R $(h7 "$R") H $(h7 "$H")" "case 46 R fail: stderr names R and H"
ok "$(checkreads)" 2 "case 46: both SHAs read"
has "$(ghlog)" "commits/$R/check-runs?per_page=100" "case 46: R's check-runs"; has "$(ghlog)" "commits/$R/status" "case 46: R's status"
own GH_CHECKS_MAP="$R=status-fail,$H=none" -- --queue --reviewed "$R"
ores "case 46 R status-fail" 0 "ci failed: ci/legacy (failure: 2 tests failed) https://ci.example/1"
own GH_CHECKS_MAP="$R=pass,$H=fail" -- --queue --reviewed "$R"
ores "case 46 H fail" 0 "ci failed: build (failure: Tests failed) https://github.com/o/c46/actions/runs/1"
own GH_CHECKS_MAP="$R=fail,$H=pass" -- --queue --reviewed "$R"
ores "case 46 H supersedes" 0 "queued $U"
hasnt "$out$err" "ci failed" "case 46 H supersedes: R's failure is superseded by HEAD's pass"
own GH_CHECKS_MAP="$R=neutral,$H=pass" -- --queue --reviewed "$R"
ores "case 46 R neutral" 0 "queued $U"
for k in cancelled timed_out startup_failure status-error stale; do
  own GH_CHECKS_MAP="$R=pass,$H=$k" -- --queue --reviewed "$R"
  ores "case 46 H $k" 0 "queued $U"
  has "$err" "land: checks infra: " "case 46 H $k: infra noted"
  hasnt "$out" "ci failed" "case 46 H $k: never ci failed"
done
has "$err" "land: checks infra: build (stale)" "case 46: the infra line names the check and conclusion"
own GH_CHECKS_MAP="$R=cancelled,$H=pending" -- --queue --reviewed "$R"
ores "case 46 R infra" 0 "queued $U"
own GH_CHECKS_MAP="$R=404,$H=pending" -- --queue --reviewed "$R"
ores "case 46 R 404" 1 "stuck: cannot read checks: gh: Not Found (HTTP 404)"
own GH_CHECKS_MAP="$R=pass,$H=404" -- --queue --reviewed "$R"
ores "case 46 H 404" 1 "stuck: cannot read checks: gh: Not Found (HTTP 404)"
own GH_CHECKS_MAP="$R=pass,$H=hang" -- --queue --reviewed "$R"
ores "case 46 H hang" 1 "stuck: cannot read checks: timed out"
own GH_CHECKS_MAP="$H=pass" -- --queue --reviewed "$H"
ores "case 46 R = H" 0 "queued $U"
ok "$(checkreads)" 1 "case 46 R = H: one SHA read"
ok "$(ghlog | grep -c "commits/$H/")" 2 "case 46 R = H: one check-runs and one status GET"

echo "== 47. own branch: unprotected"
qsetup c47a GH_PROT=false
own GH_PROT=false GH_CHECKS_MAP="$R=pass" -- --queue --reviewed "$R"
ores "case 47 none, no CI" 0 landed
ok "$(merges)" "pr merge 1 -R o/c47a --merge" "case 47 none: one direct merge, no --auto"
qsetup c47b GH_PROT=false
own GH_PROT=false GH_CHECKS_MAP="$R=pass,$H=pending" -- --queue --reviewed "$R"
ores "case 47 pending" 0 "queued: needs merge https://github.com/o/c47b/pull/1"
has "$err" "land: checks pending" "case 47 pending: says so"; ok "$(merges | grep -c .)" 0 "case 47 pending: no merge call"
own GH_PROT=false GH_CHECKS_MAP="$R=pass,$H=cancelled" -- --queue --reviewed "$R"
ores "case 47 cancelled" 0 "queued: needs merge https://github.com/o/c47b/pull/1"
has "$err" "land: checks infra" "case 47 cancelled: infra"; ok "$(merges | grep -c .)" 0 "case 47 cancelled: no merge call"
own GH_PROT=false GH_CHECKS_MAP="$R=fail,$H=pending" -- --queue --reviewed "$R"
ores "case 47 R fail" 0 "ci failed: build (failure: Tests failed) https://github.com/o/c47b/actions/runs/1"

echo "== 48. own branch: update-branch only when queued and behind"
qsetup c48; srvcommit c48 x.txt X
own GH_CHECKS_MAP="$R=pass,$H=pending" -- --queue --reviewed "$R"
ores "case 48 queued" 0 "queued https://github.com/o/c48/pull/1"
ok "$(cnt "$(ghlog)" update-branch)" 1 "case 48 queued: update-branch once"
qsetup c48b; srvcommit c48b x.txt X
own GH_MERGE=notallowed GH_CHECKS_MAP="$R=pass,$H=pass" -- --queue --reviewed "$R"
ores "case 48 landed" 0 landed
ok "$(cnt "$(ghlog)" update-branch)" 0 "case 48 landed: no update-branch"

echo "== 49. own branch: the --reviewed guard"
qsetup c49; work "after the review"; S=$(srvref c49 "$OB")
own -- --queue --reviewed "$R"
ores "case 49 code after R" 1 "stuck: unreviewed commits after $(h7 "$R"): ✨ feat: after the review"
nopush "case 49"; ok "$(srvref c49 "$OB")" "$S" "case 49: server <B> unchanged"
qsetup c49b
own GH_CHECKS_MAP="$R=pass,$H=pending" -- --queue --reviewed "$R"
ores "case 49 docs only" 0 "queued https://github.com/o/c49b/pull/1"
git -C "$W" checkout -q -b other master; echo o > "$W/o.txt"; git -C "$W" add o.txt; git -C "$W" commit -qm other; X=$(tip); git -C "$W" checkout -q "$OB"
own -- --queue --reviewed "$X"
ores "case 49 another branch's commit" 1 "stuck: reviewed commit $(h7 "$X") is not on $OB"
own -- --queue --reviewed nosuchrev
ores "case 49 unknown" 1 "stuck: reviewed commit nosuchrev not found"

echo "== 50. own branch: --hold"
qsetup c50; printf '%s\n' "ledger regression: round 4 reviewed round 3's fixes — Lachy's call" > "$tmp/diag50"
own -- --hold -F "$tmp/diag50"
ores "case 50" 0 "held https://github.com/o/c50/pull/1"
ok "$(sed -n 1p "$GH_STATE/comment.txt")" "Landing held (ADR 0028 § 3)" "case 50: the comment's first line"
hasnt "$(cat "$GH_STATE/comment.txt")" "thread:close" "case 50: the hold comment does not say thread:close"
ok "$(sed -n 2p "$GH_STATE/comment.txt")" "" "case 50: then a blank line"
ok "$(sed -n 3p "$GH_STATE/comment.txt")" "ledger regression: round 4 reviewed round 3's fixes — Lachy's call" "case 50: then the diagnosis"
ok "$(merges | grep -c .)" 0 "case 50: no merge"
ok "$(srvref c50 "$OB")" "$H" "case 50: the local deletion commit is pushed"
own GH_COMMENT=fail -- --hold -F "$tmp/diag50"
ores "case 50 comment fails" 0 "held https://github.com/o/c50/pull/1"
has "$err" "land: comment failed: gh: Resource not accessible by integration (HTTP 403)" "case 50: comment failed"

echo "== 51. own branch: auto-merge off on every call but --queue"
ghreset; mkbranch c51; own --; setpr 1 autoMergeRequest '{}'; work "next"
own --
ores "case 51 plain" 0 "pr open https://github.com/o/c51/pull/1"
dis=$(ghlog | grep -n -- '--disable-auto' | cut -d: -f1); lab=$(ghlog | grep -n 'issues/1/labels' | cut -d: -f1)
ok "$dis" 4 "case 51: --disable-auto is the 4th gh call (after access, lookup, user)"
ok "$([ -n "$dis" ] && [ -n "$lab" ] && [ "$dis" -lt "$lab" ] && echo y)" y "case 51: …before the push and label"
has "$err" "land: auto-merge off" "case 51: says so"
setpr 1 autoMergeRequest '{}'; work "another"; S=$(srvref c51 "$OB")
own GH_DISABLE=fail --
ores "case 51 disable fails" 1 "stuck: cannot switch auto-merge off on https://github.com/o/c51/pull/1: GraphQL: Could not disable auto-merge (disablePullRequestAutoMerge)"
nopush "case 51 disable fails"; ok "$(srvref c51 "$OB")" "$S" "case 51 disable fails: server unchanged"
printf 'why\n' > "$tmp/diag51"
own -- --hold -F "$tmp/diag51"
ores "case 51 hold" 0 "held https://github.com/o/c51/pull/1"
has "$(ghlog)" "pr merge 1 -R o/c51 --disable-auto" "case 51 hold: disables it"
setpr 1 autoMergeRequest '{}'; R=$(tip)
own GH_CHECKS_MAP="$R=pending" -- --queue --reviewed "$R"
ores "case 51 queue" 0 "queued https://github.com/o/c51/pull/1"
hasnt "$(ghlog)" "--disable-auto" "case 51 queue: leaves it on"

echo "== 52. own branch: preflight"
ghreset; mkbranch c52; git -C "$W" checkout -q -b feat/y
own --; ores "case 52 moved" 1 "stuck: checkout moved: on feat/y, not $OB"; nossh "case 52 moved"; nogh "case 52 moved"
git -C "$W" checkout -q master
land -- --own-branch --branch master -- "$W"
ores "case 52 on master" 0 "not landed: on master, the default branch"; nossh "case 52 on master"; nogh "case 52 on master"
git -C "$W" checkout -q --detach "$OB"
own --; ores "case 52 detached" 1 "stuck: detached HEAD"; nossh "case 52 detached"; nogh "case 52 detached"
git -C "$W" checkout -q "$OB"; touch "$W/.git/MERGE_HEAD"
own --; ores "case 52 half-applied" 1 "stuck: half-applied operation (MERGE_HEAD)"; nossh "case 52 half-applied"
rm -f "$W/.git/MERGE_HEAD"

echo "== 53. own branch: route classes"
ghreset; mkbranch c53; printf -- '- o/c53 — team repo\n' > "$LANDING_REGISTER"
own --; ores "case 53 listed" 0 "not landed: listed o/c53: team repo"; nossh "case 53 listed"; nogh "case 53 listed"
: > "$LANDING_REGISTER"; git -C "$W" remote remove origin
own --; ores "case 53 no origin" 0 "not landed: no GitHub origin"; nossh "case 53 no origin"; nogh "case 53 no origin"
sw "$HOME/repos/concepts/own53"; W="$HOME/repos/concepts/own53"; git -C "$W" add THREAD.md; git -C "$W" commit -qm t
git -C "$W" checkout -q -b "$OB"; echo w >> "$W/THREAD.md"; git -C "$W" commit -qam "✨ feat: swept work"
own --; ores "case 53 swept" 0 "not landed: swept by the daily sweep"; nossh "case 53 swept"; nogh "case 53 swept"

echo "== 54. own branch: no push access"
ghreset; mkbranch c54
own GH_ACCESS=false --; ores "case 54" 0 "not landed: no push access"; nopush "case 54"

echo "== 55. own branch: another author's PR"
ghreset; mkbranch c55; seedown OPEN "$OB" 0000 someone
own --; ores "case 55" 0 "not landed: PR https://github.com/o/x/pull/1 belongs to someone"
nopush "case 55"; hasnt "$(ghlog)" "POST" "case 55: nothing created"
ghreset; seedown OPEN "$OB" 0000 someone cross
own --; ores "case 55 cross-repo" 0 "pr open https://github.com/o/c55/pull/2"
has "$(ghlog)" "POST repos/o/c55/pulls" "case 55 cross-repo: ignored, a new PR is created"

echo "== 56. own branch: the newest PR's state"
ghreset; mkbranch c56; seedown CLOSED "$OB" 0000 me
own --; ores "case 56 closed" 1 "stuck: PR https://github.com/o/x/pull/1 for $OB was closed unmerged"; nopush "case 56 closed"
ghreset; git -C "$W" push -q "$SRV/o/c56.git" "$OB"; seedown MERGED "$OB" "$(tip)" me
git --git-dir "$SRV/o/c56.git" update-ref refs/pull/1/head "$(tip)"
own --; ores "case 56 merged at HEAD" 0 landed
nopush "case 56 merged"; hasnt "$(ghlog)" "POST" "case 56 merged: no create"; has "$err" "land: merged in https://github.com/o/x/pull/1" "case 56 merged: says where"
work "after the merge"
own --; ores "case 56 merged, then new work" 0 "pr open https://github.com/o/c56/pull/2"
has "$(ghlog)" "POST repos/o/c56/pulls" "case 56 new work: a new PR"

echo "== 57. own branch: update-branch, then GitHub merges"
ghreset; mkbranch c57; own --; R=$(tip); srvcommit c57 x.txt X
own GH_UPDATE=merge GH_CHECKS_MAP="$R=pending" -- --queue --reviewed "$R"
ores "case 57 queued" 0 "queued https://github.com/o/c57/pull/1"
ok "$(git --git-dir "$SRV/o/c57.git" rev-list --parents -n 1 "refs/heads/$OB" | wc -w | tr -d ' ')" 3 "case 57: update-branch made a merge commit on the server"
srvmergepr c57 1
own --; ores "case 57 after the merge" 0 landed
has "$err" "land: nothing to land" "case 57: nothing to land"; nopush "case 57"; hasnt "$(ghlog)" "POST" "case 57: no create"

echo "== 58. own branch: after update-branch, a plain call fast-forwards"
ghreset; mkbranch c58; own --; R=$(tip); srvcommit c58 x.txt X
own GH_UPDATE=merge GH_CHECKS_MAP="$R=pending" -- --queue --reviewed "$R"
echo mine >> "$W/a.txt"; A=$(cat "$W/a.txt")
own --; ores "case 58" 0 "pr open https://github.com/o/c58/pull/1"
ok "$(tip)" "$(srvref c58 "$OB")" "case 58: fast-forwarded to origin/<B>"
ok "$(cat "$W/a.txt")" "$A" "case 58: the unrelated dirty file is byte-identical"
has "$err" "land: tree dirty: a.txt" "case 58: …and the tree line names it"

echo "== 59. own branch: update-branch plus a local fix"
ghreset; mkbranch c59; own --; R=$(tip); srvcommit c59 x.txt X
own GH_UPDATE=merge GH_CHECKS_MAP="$R=pending" -- --queue --reviewed "$R"
work "local fix"; echo mine >> "$W/a.txt"; wt0=$(wtcount)
own --; ores "case 59" 0 "pr open https://github.com/o/c59/pull/1"
ok "$(srvref c59 "$OB")" "$(tip)" "case 59: the server tip is local HEAD"
ok "$(git -C "$W" rev-list --parents -n 1 HEAD | wc -w | tr -d ' ')" 3 "case 59: HEAD is a merge commit (2 parents)"
ok "$(wtcount)" "$wt0" "case 59: the scratch worktree is gone"
ok "$(git -C "$W" status --porcelain -- a.txt)" " M a.txt" "case 59: the dirty file is kept"
ghreset; mkbranch c59c; own --; R=$(tip); srvcommit c59c q.txt theirs
own GH_UPDATE=merge GH_CHECKS_MAP="$R=pending" -- --queue --reviewed "$R"
echo mine > "$W/q.txt"; git -C "$W" add q.txt; git -C "$W" commit -qm "✨ feat: q"; L=$(tip); S=$(srvref c59c "$OB")
own --; ores "case 59 conflict" 1 "stuck: merge conflict with origin/$OB"
ok "$(tip)" "$L" "case 59 conflict: local unchanged"; nopush "case 59 conflict"; ok "$(srvref c59c "$OB")" "$S" "case 59 conflict: server unchanged"
ok "$(git -C "$W" status --porcelain)" "" "case 59 conflict: the tree is clean"

echo "== 60. own branch: a foreign commit on origin/<B>"
ghreset; mkbranch c60; own --; srvbranchcommit c60 "$OB" f.txt foreign; S=$(srvref c60 "$OB"); work "mine"
own --; ores "case 60" 1 "stuck: origin/$OB has commits this checkout lacks: origin: f.txt"
ok "$(srvref c60 "$OB")" "$S" "case 60: server ref unchanged"; nopush "case 60"

echo "== 61. own branch: nothing ahead"
ghreset; mkrepo c61; git -C "$W" checkout -q -b "$OB"
own --; ores "case 61" 0 landed; has "$err" "land: nothing to land" "case 61: nothing to land"; nogh "case 61"

echo "== 62. own branch: usage errors"
printf 'x\n' > "$tmp/f62"
for argv in "--own-branch -- $W" "--own-branch --branch -- $W" "--own-branch --branch $OB -- $W $W/THREAD.md" \
            "--own-branch --branch $OB --commit-only -- $W" "--own-branch --branch $OB --slug x -- $W" \
            "--own-branch --branch $OB --queue -- $W" \
            "--own-branch --branch $OB --reviewed abc -- $W" "--own-branch --branch $OB --queue --reviewed abc --hold -F $tmp/f62 -- $W" \
            "--own-branch --branch $OB --hold -- $W" "--own-branch --branch $OB -F $tmp/f62 -- $W" \
            "--own-branch --branch $OB --queue --hold -- $W" "--own-branch --branch $OB --hold -F $tmp/nope -- $W" \
            "--own-branch --branch $OB --queue --reviewed abc -F $tmp/f62 -- $W" "--own-branch --branch $OB"; do
  land -- $argv
  ok "$rc/$out" "2/" "case 62: [$argv] → exit 2, stdout empty"
  tmpempty "case 62 [$argv]"
done

echo "== 63. close's # thread:land-own snippet"
o=$(grep -cE '^[[:space:]]*# thread:land-own( |$)' "$CLOSE"); c=$(grep -cE '^[[:space:]]*# end thread:land-own$' "$CLOSE")
ok "$o/$c" "1/1" "one # thread:land-own marker pair"
awk '{ l=$0; sub(/^[ \t]+/, "", l) }
     l ~ /^# thread:land-own( |$)/ { on=1; ind=substr($0, 1, length($0)-length(l)); next }
     l == "# end thread:land-own" { on=0 }
     on { if (index($0, ind) == 1) print substr($0, length(ind)+1); else print $0 }' "$CLOSE" > "$tmp/osnip.sh"
ok "$(grep -c 'bash "$ld"' "$tmp/osnip.sh")" 1 "the own snippet has exactly one bash \"\$ld\" line"
ok "$(tail -n 1 "$tmp/osnip.sh")" 'bash "$ld" --own-branch --branch "$br" ${act:+"$act"} ${rev:+--reviewed} ${rev:+"$rev"} ${note:+-F} ${note:+"$note"} -- "$top"' \
   "the land.sh call is the own snippet's last line"
# ofill <act> <rev> → $tmp/run.sh, the own snippet filled as close fills it (the diagnosis carries an apostrophe).
ofill() {
  sed -e "s|top='<top>'|top='$W'|" -e "s|br='<branch>'|br='$OB'|" \
      -e "s|act=''|act='$1'|" -e "s|rev=''|rev='$2'|" \
      -e "s|<diagnosis>|needs your call: the product question is Lachy's|" "$tmp/osnip.sh" > "$tmp/run.sh"
}
for sh in "${shells[@]}"; do
  qsetup "c63${#sh}"
  ofill "" ""; snip "$sh"; ores "case 63 [$sh] plain" 0 "pr open https://github.com/o/c63${#sh}/pull/1"
  ok "$(upstream)" origin/master "case 63 [$sh] plain: the review base is set"
  ofill "--queue" "$R"; snip "$sh" GH_CHECKS_MAP="$R=pass,$H=pending"; ores "case 63 [$sh] queue" 0 "queued https://github.com/o/c63${#sh}/pull/1"
  has "$err" "land: checks read R $(h7 "$R") H $(h7 "$H")" "case 63 [$sh] queue: --reviewed arrived intact"
  ofill "--hold" ""; snip "$sh"; ores "case 63 [$sh] hold" 0 "held https://github.com/o/c63${#sh}/pull/1"
  ok "$(sed -n 3p "$GH_STATE/comment.txt")" "needs your call: the product question is Lachy's" "case 63 [$sh] hold: the diagnosis arrived intact"
  ofill "" ""; snip "$sh" CLAUDE_PLUGIN_ROOT="$tmp/nowhere"; ok "$rc/$out" "2/" "case 63 [$sh]: a bogus CLAUDE_PLUGIN_ROOT → rc 2, stdout empty"
  has "$err" "land: script not found" "case 63 [$sh]: …and says so"
  tmpempty "case 63 [$sh] bogus root"
done

echo "== 64. own branch: case 42 under $BASH32"
LAND_SHELL=$BASH32
ghreset; mkbranch c64
own --; ores "case 64" 0 "pr open https://github.com/o/c64/pull/1"
ok "$(digest)" "$(fr_digest)" "case 64: the digest matches under $BASH32"
ok "$(upstream)" origin/master "case 64: the upstream is origin/master"
qsetup c64q; own GH_CHECKS_MAP="$R=fail" -- --queue --reviewed "$R"
ores "case 64 queue" 0 "ci failed: build (failure: Tests failed) https://github.com/o/c64q/actions/runs/1"
LAND_SHELL=bash

echo "== 65. own branch: the tree line"
ghreset; mkbranch c65
echo dirty >> "$W/a.txt"
own --; ores "case 65 modified" 0 "pr open https://github.com/o/c65/pull/1"
has "$err" "land: tree dirty: a.txt" "case 65 modified: named"; hasnt "$err" "land: digest" "case 65 modified: no digest"
git -C "$W" checkout -q -- a.txt; echo new > "$W/new.txt"
own --; ores "case 65 untracked" 0 "pr open https://github.com/o/c65/pull/1"
has "$err" "land: tree dirty: new.txt" "case 65 untracked: named"; hasnt "$err" "land: digest" "case 65 untracked: no digest"
rm "$W/new.txt"; for k in 1 2 3 4 5 6; do echo "$k" > "$W/u$k.txt"; done
own --; has "$err" "land: tree dirty: u1.txt, u2.txt, u3.txt, u4.txt, u5.txt (+1 more)" "case 65: at most five paths"
rm "$W"/u?.txt; echo scratch.tmp >> "$W/.git/info/exclude"; echo s > "$W/scratch.tmp"
own --; ores "case 65 excluded" 0 "pr open https://github.com/o/c65/pull/1"
ok "$(digest)" "$(fr_digest)" "case 65 excluded: an ignored scratch file never counts"
mkdir -p "$W/docs/reviews"; echo pending > "$W/docs/reviews/2026-01-01-abc-def.md"
own --; ores "case 65 docs/reviews" 0 "pr open https://github.com/o/c65/pull/1"
ok "$(digest)" "$(fr_digest)" "case 65 docs/reviews: a review doc never counts and the digest matches"

echo "== 66. own branch: the upstream is restored"
qsetup c66
own GH_CHECKS_MAP="$R=pass,$H=pending" -- --queue --reviewed "$R"
ores "case 66 queued" 0 "queued https://github.com/o/c66/pull/1"
ok "$(upstream)" "origin/$OB" "case 66 queued: upstream origin/<B>"
has "$err" "land: upstream origin/$OB (was origin/master)" "case 66 queued: says so"
own --; ok "$(upstream)" origin/master "case 66: the next plain call sets origin/master again"
printf 'held\n' > "$tmp/diag66"
own -- --hold -F "$tmp/diag66"; ores "case 66 hold" 0 "held https://github.com/o/c66/pull/1"
ok "$(upstream)" "origin/$OB" "case 66 hold: upstream origin/<B>"
has "$err" "land: upstream origin/$OB (was origin/master)" "case 66 hold: says so"
own --; own GH_CHECKS_MAP="$R=fail" -- --queue --reviewed "$R"
ores "case 66 ci failed" 0 "ci failed: build (failure: Tests failed) https://github.com/o/c66/actions/runs/1"
ok "$(upstream)" "origin/$OB" "case 66 ci failed: upstream origin/<B>"
own --; git -C "$W" checkout -q -b elsewhere
own --; ores "case 66 preflight" 1 "stuck: checkout moved: on elsewhere, not $OB"
ok "$(upstream)" origin/master "case 66 preflight: a preflight stuck leaves the review base (the residue)"
git -C "$W" checkout -q "$OB"

echo "== 67. own branch: no checks yet on a repo with CI"
ghreset; mkbranch c67; addworkflow; own GH_PROT=false --; R=$(tip); docscommit r.md x; docsdelete; H=$(tip)
own GH_PROT=false -- --queue --reviewed "$R"
ores "case 67 unprotected" 0 "queued: needs merge https://github.com/o/c67/pull/1"
has "$err" "land: checks none yet (ci: workflows)" "case 67 unprotected: CI from the workflow file"
ok "$(merges | grep -c .)" 0 "case 67 unprotected: zero pr merge calls"
ok "$(checkreads)" 2 "case 67: no base read when a workflow file exists"
ghreset; mkbranch c67p; addworkflow; own --; R=$(tip); docscommit r.md x; docsdelete
own GH_MERGE=notallowed -- --queue --reviewed "$R"
ores "case 67 protected" 0 "queued: needs merge https://github.com/o/c67p/pull/1"
ok "$(direct | grep -c .)" 0 "case 67 protected: no direct merge"

echo "== 68. own branch: CI detected from the base"
qsetup c68 GH_PROT=false; BS=$(srvref c68 master)
own GH_PROT=false GH_CHECKS_MAP="$BS=pass" -- --queue --reviewed "$R"
ores "case 68" 0 "queued: needs merge https://github.com/o/c68/pull/1"
has "$err" "land: checks none yet (ci: base)" "case 68: CI from the base tip"
ok "$(merges | grep -c .)" 0 "case 68: no merge"
has "$(ghlog)" "commits/$BS/check-runs" "case 68: the base tip is read"
own GH_PROT=false GH_CHECKS_MAP="$BS=404" -- --queue --reviewed "$R"
ores "case 68 base 404" 1 "stuck: cannot read checks: gh: Not Found (HTTP 404)"

echo "== 69. own branch: a fresh R after ci failed"
ghreset; mkbranch c69; own --; R1=$(tip); docscommit r1.md pending; docscommit r1.md consumed; docsdelete; D1=$(tip)
own GH_CHECKS_MAP="$R1=fail" -- --queue --reviewed "$R1"
ores "case 69 first" 0 "ci failed: build (failure: Tests failed) https://github.com/o/c69/actions/runs/1"
own --; docscommit r2.md pending; docscommit r2.md consumed; docsdelete; D2=$(tip)
own GH_CHECKS_MAP="$R1=fail,$D1=pass,$D2=pending" -- --queue --reviewed "$D1"
ores "case 69 second" 0 "queued https://github.com/o/c69/pull/1"
has "$(ghlog)" "commits/$D1/check-runs" "case 69: the previous deletion commit's CI is read"
hasnt "$(ghlog)" "commits/$R1/" "case 69: the first round's R is not read again"

echo "== 70. own branch: empty fields never shift the result line"
# GitHub Actions check runs carry `output.title: null`, a status may have no description, and a deleted
# author has no login. Each field must stay in its own slot, and the stop rule's key (the ci failed line
# without its URL) must hold no URL, so the same failure twice gives the same key.
key() { printf '%s\n' "${out% http*}"; }
qsetup c70
own GH_CHECKS_MAP="$R=fail-notitle,$H=pending" -- --queue --reviewed "$R"
ores "case 70 R null title" 0 "ci failed: build (failure) https://github.com/o/c70/actions/runs/1"
ok "$(key)" "ci failed: build (failure)" "case 70 R null title: the key is name and conclusion, no URL"
own GH_CHECKS_MAP="$R=pass,$H=fail-notitle" -- --queue --reviewed "$R"
ores "case 70 H null title" 0 "ci failed: build (failure) https://github.com/o/c70/actions/runs/1"
own GH_CHECKS_MAP="$R=status-fail-nodesc,$H=none" -- --queue --reviewed "$R"
ores "case 70 null description" 0 "ci failed: ci/legacy (failure) https://ci.example/1"
ok "$(key)" "ci failed: ci/legacy (failure)" "case 70 null description: the key holds no URL"
own GH_CHECKS_MAP="$R=pass,$H=cancelled" -- --queue --reviewed "$R"
has "$err" "land: checks infra: build (cancelled)" "case 70 infra: the INFRA field is read whole"
ghreset; mkbranch c70b; seedown OPEN "$OB" 0000 ""
own --; ores "case 70 empty login" 0 "not landed: PR https://github.com/o/x/pull/1 belongs to an unknown author"
nopush "case 70 empty login"

# ==== The primary checkout holds while a rollout runs (ADR 0031) ===========================================
# pplugin <name>: commit a copy of this tree's skills/ into $W and push it, so $W is a primary checkout when
# land.sh runs from $W's own copy ($PLAND). The started rollout comes from tests/lib/rollout-fixtures.sh.
. tests/lib/rollout-fixtures.sh
PTASKS="$HOME/repos/obsidian/Work/Tasks"
pplugin() {
  cp -R "$root/skills" "$W/skills"; git -C "$W" add skills && git -C "$W" commit -qm plugin
  git -C "$W" push -q "$SRV/o/$1.git" master; git -C "$W" update-ref refs/remotes/origin/master HEAD
  PLAND="$W/skills/_shared/scripts/land.sh"
}

echo "== 71. protected, local behind, the primary checkout while a rollout runs"
ghreset; mkrepo c71; pplugin c71; srvcommit c71 x.txt X; B0=$(git -C "$W" rev-parse HEAD); edit
prollout "$PTASKS"
LAND=$PLAND land -- --slug c71 -- "$W" "$W/THREAD.md"
res "case 71" 0 "queued https://github.com/o/c71/pull/1"
ok "$(git -C "$W" rev-parse HEAD^)" "$B0" "case 71: not fast-forwarded (C's parent is the old base)"
has "$err" "land: held the primary checkout at ${B0:0:7}, not fast-forwarded: [[demo-rollout-2026-10-03]] running on it" "case 71: the held note names the rollout"
ghreset; mkrepo c71b; pplugin c71b; srvcommit c71b x.txt X; X=$(srvref c71b master); edit
prollout "$PTASKS" "paused: 2026-10-03T10:00+10:00"
LAND=$PLAND land -- --slug c71b -- "$W" "$W/THREAD.md"
res "case 71b" 0 "queued https://github.com/o/c71b/pull/1"
ok "$(git -C "$W" rev-parse HEAD^)" "$X" "case 71b: a hard-paused rollout releases it: fast-forwarded to X"
hasnt "$err" "held the primary checkout" "case 71b: no held note"
ghreset; mkrepo c71c; pplugin c71c; srvcommit c71c x.txt X; X=$(srvref c71c master); edit
prollout "$PTASKS"
land -- --slug c71c -- "$W" "$W/THREAD.md"
ok "$(git -C "$W" rev-parse HEAD^)" "$X" "case 71c: land.sh run from another checkout never holds this one"
ghreset; mkrepo c71d; pplugin c71d; srvcommit c71d x.txt X; B0=$(git -C "$W" rev-parse HEAD); edit
printf 'import sys\nsys.exit(5)\n' > "$W/skills/_shared/scripts/unfinished-rollout.py"
LAND=$PLAND land -- --slug c71d -- "$W" "$W/THREAD.md"
ok "$(git -C "$W" rev-parse HEAD^)" "$B0" "case 71d: a failed running check holds"
has "$err" "not fast-forwarded: the running-rollout check failed (rc 5)" "case 71d: … and says so"
git -C "$W" checkout -q -- skills

echo "== 72. unprotected, origin moved, the primary checkout while a rollout runs"
ghreset; mkrepo c72; pplugin c72; c0; srvcommit c72 x.txt X; X=$(srvref c72 master); edit
prollout "$PTASKS"
OLD=$(git -C "$W" rev-parse HEAD)
LAND=$PLAND land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 72" 0 landed
ok "$(made)" "$(srvref c72 master)" "case 72: land: commit is the pushed, rebased tip"
ok "$(git -C "$W" rev-parse "$(srvref c72 master)~2")" "$X" "case 72: C0 and C rebased onto origin's tip on the server"
ok "$(git -C "$W" rev-parse HEAD^)" "$OLD" "case 72: the local branch never moved (C sits on its old base)"
has "$err" "pushed the rebased tip without moving it: [[demo-rollout-2026-10-03]] running on it" "case 72: the held note"
ok "$(wtcount)" 1 "case 72: the scratch worktree is gone"
rm -rf "$HOME/repos"

# ==== Review docs: a close-out carries a consumed review doc's deletion, and nothing else of docs/reviews/ ====
# rdoc <name> <status>: a fresh-review doc under docs/reviews/; its body repeats `status: consumed`, which
# never counts (only the front matter does).
rdoc() {
  mkdir -p "$(dirname "$W/docs/reviews/$1")"
  printf -- '---\nhead: abc1234\nstatus: %s\n---\n\nTarget: x\nstatus: consumed\n' "$2" > "$W/docs/reviews/$1"
}
rseed() { git -C "$W" add docs && git -C "$W" commit -qm "📝 docs(review): seed" && git -C "$W" push -q "$SRV/o/$1.git" master && fetchsrv "$1"; }
rstuck() {  # rstuck <label> <want> <path> — refused before any commit, the path left as it was
  local label=$1 want=$2 p=$3 before
  before=$(cat "$W/$p" 2>/dev/null; git -C "$W" status --porcelain -- "$p")
  H0=$(git -C "$W" rev-parse HEAD)
  land GH_PROT=false -- "$W" "$W/THREAD.md" "$W/$p"; res "case 73 $label" 1 "$want"
  has "$err" "land: nothing committed" "case 73 $label: nothing committed"
  ok "$(git -C "$W" rev-parse HEAD)" "$H0" "case 73 $label: HEAD unchanged"
  ok "$(cat "$W/$p" 2>/dev/null; git -C "$W" status --porcelain -- "$p")" "$before" "case 73 $label: $p untouched"
  nossh "case 73 $label"
}
echo "== 73. consumed review-doc deletions"
ghreset; mkrepo c73
rdoc r1.md consumed; rdoc r2.md pending; rdoc r3.md pending; rdoc r4.md consumed; rdoc r5.md pending
rdoc sub/n.md consumed; rseed c73
edit
land GH_PROT=false -- "$W" "$W/THREAD.md" "$W/docs/reviews/r1.md"
res "case 73 committed mark" 0 landed
ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "M THREAD.md|D docs/reviews/r1.md|" "case 73 committed mark: one commit holds M THREAD.md and D r1.md"
ok "$([ -e "$W/docs/reviews/r1.md" ] && echo present || echo gone)" gone "case 73 committed mark: land.sh removed r1.md from disk"
ok "$(srvref c73 master)" "$(git -C "$W" rev-parse HEAD)" "case 73 committed mark: landed on origin"
sed -i.bak 's/^status: pending$/status: consumed/' "$W/docs/reviews/r2.md"; rm -f "$W/docs/reviews/r2.md.bak"
land GH_PROT=false -- "$W" "$W/docs/reviews/r2.md"
res "case 73 uncommitted mark" 0 landed
ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/reviews/r2.md|" "case 73 uncommitted mark: a deletion only, the mark never committed"
git -C "$W" rm -qf docs/reviews/r4.md
land GH_PROT=false -- "$W" "$W/docs/reviews/r4.md"
res "case 73 already git-rm'd" 0 landed
ok "$(git -C "$W" show --name-status --format= HEAD | tr '\t\n' ' |')" "D docs/reviews/r4.md|" "case 73 already git-rm'd: committed as D"
edit
rdoc new.md consumed
rstuck "added" "stuck: not a close-out path: docs/reviews/new.md…" docs/reviews/new.md
rm -f "$W/docs/reviews/new.md"
echo more >> "$W/docs/reviews/r3.md"
rstuck "modified pending" "stuck: not a close-out path: docs/reviews/r3.md…" docs/reviews/r3.md
git -C "$W" checkout -q -- docs/reviews/r3.md
git -C "$W" rm -qf docs/reviews/r5.md
rstuck "deleted pending" "stuck: not a close-out path: docs/reviews/r5.md…" docs/reviews/r5.md
git -C "$W" reset -q -- docs/reviews/r5.md; git -C "$W" checkout -q -- docs/reviews/r5.md
rstuck "nested" "stuck: not a close-out path: docs/reviews/sub/n.md" docs/reviews/sub/n.md
rstuck "never tracked" "stuck: not a close-out path: docs/reviews/ghost.md…" docs/reviews/ghost.md

echo "== 73b. carried commits: a review-doc deletion rides along, an addition or a modification does not"
ghreset; mkrepo c73b; rdoc r.md consumed; rseed c73b
git -C "$W" rm -q docs/reviews/r.md; git -C "$W" commit -qm "🔧 chore(review): r consumed — delete"; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 73b deletion carried" 0 landed
has "$err" "land: carried 1 earlier close-out commit(s)" "case 73b: carried 1"
ok "$(srvref c73b master)" "$(git -C "$W" rev-parse HEAD)" "case 73b: landed on origin"
ghreset; mkrepo c73m; rdoc r.md consumed; rseed c73m
echo more >> "$W/docs/reviews/r.md"; git -C "$W" commit -qam "📝 docs(review): annotate r"; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 73b modification" 1 "stuck: local commits not from a close-out: 📝 docs(review): annotate r"
nopush "case 73b modification"
ghreset; mkrepo c73a; rdoc r.md consumed
git -C "$W" add docs; git -C "$W" commit -qm "📝 docs(review): add r"; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 73b addition" 1 "stuck: local commits not from a close-out: 📝 docs(review): add r"
nopush "case 73b addition"
ghreset; mkrepo c73n; rdoc sub/n.md consumed; rseed c73n
git -C "$W" rm -q docs/reviews/sub/n.md; git -C "$W" commit -qm "🔧 chore(review): nested delete"; edit
land GH_PROT=false -- "$W" "$W/THREAD.md"
res "case 73b nested deletion" 1 "stuck: local commits not from a close-out: 🔧 chore(review): nested delete"

echo
[ "$fail" = 0 ] && echo "land.test.sh: ALL PASS" || echo "land.test.sh: FAILED"
exit "$fail"
