#!/usr/bin/env bash
# skills/_shared/scripts/land-carrier.py — the landing carrier (ADR 0078 d2): every open `landing` PR, and every PR on a
# land.sh-named close/ branch, keeps moving until it merges. Bare "servers" under $SRV/o/<repo>.git (uploadpack.allowFilter,
# so the scratch clone is really partial) stand for GitHub; a temp global git config maps https://github.com/ onto them;
# tests/fixtures/land/fake-gh.py is `gh` (GH_SEARCH=prs), serving the PRs seeded into its prs.json; an opt-in `git` wrapper
# logs argv with the three prompt vars and copies the state file at each push ($GIT_SNAP). Every pass runs at a clock
# 20 minutes on from the last, so each is due.
#   C0 quiet passes and the rate limit · C1 C1b C1c update-branch, one per repo per pass · C2 an unsettled mergeability
#   C3 C3b C4 C4d the resolver · C5 C5b C5c C5d C5e the rerun rule · C6 C6g C6h C6i merges and the binding
#   C7 C7n supersession and tombstones · C8 the clock · C9 C10 no write · C11 the deadline and a TERM
#   C12 discovery and scope · C13 a refused auto-merge falls through · C14 the prompt vars · C15 stuck
#   C16 marker · C17 --dry-run · C18 skipped PRs
# The cases are grouped into shard_<n>() functions, each self-contained; run bare, this script starts one child per shard
# (`--shard <n>`), all at once, each with its own temp dir, then prints their output in shard order. Hermetic: HOME,
# XDG_STATE_HOME, TMPDIR, the global git config and the landing register are temp; the caller's GIT_DIR & co. are unset.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)

root=$(pwd -P)
CARRIER=$root/skills/_shared/scripts/land-carrier.py
MT=$root/skills/execute/scripts/merge-task.sh
self=$root/tests/land-carrier.test.sh

if [ "${1:-}" != --shard ]; then
  echo "== shards"
  ids=$(sed -n 's/^shard_\([0-9][0-9]*\)() {$/\1/p' "$self" | tr '\n' ' ')
  ok "$(awk '/^shard_[0-9]+\(\) \{$/{on=1; next} /^\}  # end shard_[0-9]+$/{on=0; next} !on && /^echo "== C/' "$self")" "" \
     "every case sits inside a shard_<n>() function"
  ok "$([ -n "$ids" ] && echo y)" y "shards found: $ids"
  sd=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
  pids=()
  trap 'kill ${pids[@]+"${pids[@]}"} 2>/dev/null; rm -rf "$sd"' EXIT
  for k in $ids; do "$BASH" "$self" --shard "$k" > "$sd/$k.out" 2>&1 & pids+=($!); done
  i=0
  for k in $ids; do
    wait "${pids[$i]}"; rc=$?; i=$((i+1))
    cat "$sd/$k.out"
    ok "$rc" 0 "shard $k exited 0"
  done
  pids=()
  echo
  [ "$fail" = 0 ] && echo "land-carrier.test.sh: ALL PASS" || echo "land-carrier.test.sh: FAILED"
  exit "$fail"
fi
shard=${2:-}

tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P)
holders=()
cleanup() { local p; for p in ${holders[@]+"${holders[@]}"}; do kill -9 "$p" 2>/dev/null; done; rm -rf "$tmp"; }
trap cleanup EXIT
mkdir -p "$tmp/home" "$tmp/bin" "$tmp/gitw" "$tmp/srv/o" "$tmp/w" "$tmp/t" "$tmp/gh" "$tmp/state" "$tmp/snaps" "$tmp/events"
export HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" TMPDIR="$tmp/t" LANDING_REGISTER="$tmp/register.md"
export THREAD_EVENTS_DIR="$tmp/events" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$tmp/gitconfig"
: > "$LANDING_REGISTER"
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
git config --global url."file://$tmp/srv/".insteadOf https://github.com/
git config --global uploadpack.allowFilter true
cp tests/fixtures/land/fake-gh.py "$tmp/bin/gh"; chmod +x "$tmp/bin/gh"
REALGIT=$(command -v git)
cat > "$tmp/gitw/git" <<EOF
#!/bin/bash
printf '%s|%s|%s|%s\n' "\$*" "\${GIT_TERMINAL_PROMPT-}" "\${GH_PROMPT_DISABLED-}" "\${GCM_INTERACTIVE-}" >> "$tmp/git.log"
case " \$* " in *" push "*) if [ -n "\${GIT_SNAP:-}" ]; then k=\$(ls "$tmp/snaps" | grep -c '\.json\$'); cp "\$GIT_SNAP" "$tmp/snaps/push-\$k.json"; printf '%s\n' "\$*" > "$tmp/snaps/push-\$k.argv"; fi ;; esac
exec "$REALGIT" "\$@"
EOF
chmod +x "$tmp/gitw/git"
export PATH="$tmp/bin:$PATH" SRV="$tmp/srv" LOG_GH="$tmp/gh.log" GH_STATE="$tmp/gh" GH_SEARCH=prs
ST="$XDG_STATE_HOME/thread/landings.json"
: > "$LOG_GH"; : > "$tmp/git.log"

# ---- helpers -----------------------------------------------------------------------------------------------------------
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
cnt() { printf '%s\n' "$1" | grep -cF -- "$2"; }
ghlog() { cat "$LOG_GH"; }
gitlog() { cat "$tmp/git.log"; }
T0=2026-11-10T10:00:00+11:00
at() { python3 -c 'import sys, datetime as d; print((d.datetime.fromisoformat(sys.argv[1]) + d.timedelta(minutes=int(sys.argv[2]))).isoformat())' "$T0" "$1"; }
CLK=0
# reset: a clean fake GitHub, no landings.json, no logs
reset() { rm -rf "$GH_STATE" "$ST" "$tmp/snaps"; mkdir -p "$GH_STATE" "$tmp/snaps"; : > "$LOG_GH"; : > "$tmp/git.log"; }
# carrier [VAR=value …] [-- <run args>…] → out, err, rc: one pass, the clock 20 minutes on (so it is due); logs reset first.
carrier() {
  local extra=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do extra+=("$1"); shift; done
  [ $# -gt 0 ] && shift
  CLK=$((CLK + 20))
  : > "$LOG_GH"; : > "$tmp/git.log"
  out=$(env ${extra[@]+"${extra[@]}"} python3 "$CARRIER" run --settle-wait 0 --now "$(at $CLK)" "$@" 2>"$tmp/err"); rc=$?
  err=$(cat "$tmp/err")
}
# ef <key> <field>: one field of one landings.json entry (None when absent)
ef() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["landings"].get(sys.argv[2], {}).get(sys.argv[3]))' "$ST" "$1" "$2" 2>/dev/null; }
keys() { python3 -c 'import json,sys; print(" ".join(sorted(json.load(open(sys.argv[1]))["landings"])))' "$ST" 2>/dev/null; }
stk() { python3 "$CARRIER" stuck "$@" 2>&1; }
sline() { python3 "$CARRIER" stuck "$@" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["line"])'; }
srvsha() { git --git-dir "$SRV/o/$1.git" rev-parse -q --verify "refs/heads/$2"; }
prstate() { python3 -c 'import json,sys; print([p for p in json.load(open(sys.argv[1])) if p["number"] == int(sys.argv[2])][0]["state"])' "$GH_STATE/prs.json" "$1"; }
reruns() { cat "$GH_STATE/reruns.txt" 2>/dev/null | tr '\n' ' ' | sed 's/ $//'; }
cb() { printf 'close/2026-11-10-%s-%s' "$1" "$(printf '%s' "$1" | shasum | cut -c1-12)"; }
# repo <name>: a server o/<name> and a work clone $W at master: THREAD.md (front matter), src/c.txt, a.txt, a handoff doc
repo() {
  local n=$1
  git init -q --bare -b master "$SRV/o/$n.git"
  W="$tmp/w/$n"; git init -q -b master "$W"; mkdir -p "$W/src" "$W/docs/handoffs"
  printf -- '---\nlast_touched: 2026-11-01\n---\n# T\n\n## Session log\n\n- base entry\n' > "$W/THREAD.md"
  printf 'c1\nc2\nc3\nc4\nc5\nc6\nc7\nc8\n' > "$W/src/c.txt"
  echo a > "$W/a.txt"; echo h > "$W/docs/handoffs/h.md"
  git -C "$W" add -A; git -C "$W" commit -qm base
  git -C "$W" remote add origin "$SRV/o/$n.git"; git -C "$W" push -q origin master
}
# co <branch> [<from>]: check out <branch> in $W: origin's copy when it has one, else a new one off <from> (origin/master)
co() {
  git -C "$W" fetch -q origin
  if [ -n "${2:-}" ]; then git -C "$W" checkout -q -B "$1" "$2"
  elif git -C "$W" rev-parse -q --verify "refs/remotes/origin/$1" >/dev/null; then git -C "$W" checkout -q -B "$1" "origin/$1"
  else git -C "$W" checkout -q -B "$1" origin/master; fi
}
# ci <subject>: commit everything in $W and push the branch; C is the commit
ci() { git -C "$W" add -A; git -C "$W" commit -qm "$1"; git -C "$W" push -q origin "HEAD:refs/heads/$(git -C "$W" symbolic-ref --short HEAD)"; C=$(git -C "$W" rev-parse HEAD); }
# put <branch> <file> <line> [<from>]: append <line> to <file> on <branch>, commit, push; C is the commit
put() { co "$1" "${4:-}"; mkdir -p "$(dirname "$W/$2")"; printf '%s\n' "$3" >> "$W/$2"; ci "$1: $3"; }
# sub <branch> <file> <old> <new>: replace a line on <branch>, commit, push
sub() { co "$1"; python3 -c 'import sys; p,o,n=sys.argv[1:]; t=open(p).read(); assert o in t, o; open(p,"w").write(t.replace(o,n,1))' "$W/$2" "$3" "$4"; ci "$1: $3 -> $4"; }
# pr <repo> <branch> [<field>=<json>…] → N: a PR in the fake's state (open, labelled landing, by me, base master)
pr() {
  N=$(python3 - "$GH_STATE/prs.json" "$@" <<'PY'
import json, sys
f, repo, branch = sys.argv[1:4]
try:
    prs = json.load(open(f))
except FileNotFoundError:
    prs = []
n = max([p["number"] for p in prs] + [0]) + 1
p = {"number": n, "url": "https://github.com/o/%s/pull/%d" % (repo, n), "state": "OPEN", "headRefName": branch,
     "headRefOid": "", "isCrossRepository": False, "author": {"login": "me"}, "autoMergeRequest": None,
     "repo": "o/" + repo, "labels": ["landing"], "base": "master"}
for kv in sys.argv[4:]:
    k, _, v = kv.partition("=")
    p[k] = json.loads(v)
prs.insert(0, p)
json.dump(prs, open(f, "w"))
print(n)
PY
)
}
# setf <n> <field>=<json>…: edit a PR in the fake's state
setf() {
  python3 - "$GH_STATE/prs.json" "$@" <<'PY'
import json, sys
f, n = sys.argv[1], int(sys.argv[2])
prs = json.load(open(f))
for p in prs:
    if p["number"] == n:
        for kv in sys.argv[3:]:
            k, _, v = kv.partition("=")
            p[k] = json.loads(v)
json.dump(prs, open(f, "w"))
PY
}
# mark <repo> <n> <sha> [<prefix>]: a `Landing queued (ADR 0078 d2): <sha>` comment by me, the next id
mark() {
  python3 - "$GH_STATE/comments/o/$1/$2.json" "${4:-Landing queued (ADR 0078 d2): }$3" <<'PY'
import json, os, sys
f, body = sys.argv[1:3]
os.makedirs(os.path.dirname(f), exist_ok=True)
try:
    cs = json.load(open(f))
except FileNotFoundError:
    cs = []
cs.append({"id": max([c["id"] for c in cs] + [0]) + 1, "user": {"login": "me"}, "body": body + "\n\nmore", "head": ""})
json.dump(cs, open(f, "w"))
PY
}
AM='autoMergeRequest={"mergeMethod":"MERGE"}'   # a PR whose auto-merge is already queued
puts() { ghlog | grep -F -- "--method PUT" ; }
writes() { ghlog | grep -E -- '--method (PUT|POST|PATCH)|pr merge' ; }

shard_1() {
echo "== C0. quiet passes, and the rate limit"
reset; carrier
ok "$rc|$out" "0|" "C0: no PR: exit 0, nothing printed"
ok "$(cnt "$(ghlog)" "search prs")|$(cnt "$(ghlog)" "api user")" "2|0" "C0: … two searches and no api user"
has "$(ghlog)" "search prs --state open --author @me --label landing --limit 100 --json repository,number,url" "C0: … the labelled search"
has "$(ghlog)" "search prs --state open --author @me --head close --limit 100 --json repository,number,url" "C0: … and the close/ head search"
ok "$(ef _pass lastPass)" "$(at $CLK)" "C0: … lastPass is the pass's time"
cp "$ST" "$tmp/c0.json"; : > "$LOG_GH"
python3 "$CARRIER" run --now "$(at $((CLK + 5)))" > "$tmp/c0.out" 2>&1; rc=$?
ok "$rc|$(cat "$tmp/c0.out")|$(ghlog | grep -c .)" "3||0" "C0: 5 minutes on: exit 3 (not due), no output, no call"
ok "$(cmp -s "$ST" "$tmp/c0.json" && echo same)" same "C0: … landings.json byte-identical"
python3 "$CARRIER" run --now "$(at $((CLK + 15)))" >/dev/null 2>&1; rc=$?
ok "$rc|$(cnt "$(ghlog)" "search prs")" "0|2" "C0: 15 minutes on: it searches again"
python3 "$CARRIER" run --now "$(at $((CLK - 600)))" >/dev/null 2>&1; rc=$?
ok "$rc" 0 "C0: a lastPass in the future never blocks"
CLK=$((CLK + 20))

echo "== C1. behind and green: update-branch, expected_head_sha, updatedFrom"
reset; repo r1; B=$(cb r1); put "$B" THREAD.md "- r1 entry"; H=$C; put master a.txt "moved"; pr r1 "$B" "$AM"
carrier GH_CHECKS=pass
ok "$rc" 0 "C1: exit 0"
has "$(ghlog)" "api --method PUT repos/o/r1/pulls/$N/update-branch -f expected_head_sha=$H" "C1: update-branch pinned to the head"
has "$out" "o/r1#$N: update-branch requested (from ${H:0:12})" "C1: … and says so"
ok "$(ef "o/r1#$N" updatedFrom)|$(ef "o/r1#$N" kind)" "$H|close-out" "C1: updatedFrom recorded, kind close-out"
ok "$(ef "o/r1#$N" movedAt)" "$(at $CLK)" "C1: first sight starts the clock"

echo "== C1b. one update-branch per repo per pass"
reset; repo r1b; B1=$(cb r1b1); put "$B1" THREAD.md "- one"; B2=$(cb r1b2); put "$B2" a.txt "two" ; put master src/c.txt "moved"
pr r1b "$B1" "$AM"; N1=$N; pr r1b "$B2" "$AM"; N2=$N
repo r1c; B3=$(cb r1c); put "$B3" THREAD.md "- three"; put master a.txt moved; pr r1c "$B3" "$AM"; N3=$N
carrier GH_CHECKS=pass
ok "$(ghlog | grep -c 'update-branch')" 2 "C1b: two update-branches: one per repo"
ok "$(ghlog | grep -c 'repos/o/r1b/pulls/[0-9]*/update-branch')|$(ghlog | grep -c 'repos/o/r1c/pulls/[0-9]*/update-branch')" "1|1" "C1b: … one in each repo"
has "$(ghlog)" "repos/o/r1b/pulls/$N1/update-branch" "C1b: the first in order takes the slot"
ok "$(ef "o/r1b#$N2" outcome)" "waiting its turn to be brought current" "C1b: the other waits its turn"
carrier GH_CHECKS=pass
ok "$(ghlog | grep -c 'repos/o/r1b/pulls/[0-9]*/update-branch')" 1 "C1b: the next pass, one update-branch again"
has "$(ghlog)" "repos/o/r1b/pulls/$N2/update-branch" "C1b: … for the one that waited (least recently handled first)"

echo "== C1c. behind and pending, or behind and genuinely red: no update"
reset; repo r1d; B=$(cb r1d); put "$B" THREAD.md "- d"; put master a.txt moved; pr r1d "$B" "$AM"
carrier GH_CHECKS=pending
ok "$(writes | grep -c .)" 0 "C1c: pending: no write"
ok "$(ef "o/r1d#$N" outcome)" "waiting for its checks" "C1c: … waiting for its checks"
carrier GH_CHECKS=fail
ok "$(writes | grep -c .)" 0 "C1c: genuinely red: no write"
has "$(ef "o/r1d#$N" outcome)" "not re-run: a genuine failure in build (Run tests)" "C1c: … the outcome names the genuine step"

echo "== C2. an unknown mergeability is re-read; one that stays unknown is no act"
reset; repo r2; B=$(cb r2); put "$B" THREAD.md "- r2"; put master a.txt moved; pr r2 "$B" "$AM" 'mergeableState=["unknown","behind"]'
carrier GH_CHECKS=pass
ok "$(ghlog | grep -c "pulls/$N\$")" 2 "C2: read twice"
has "$(ghlog)" "pulls/$N/update-branch" "C2: … then update-branch"
setf "$N" 'mergeableState=["unknown","unknown","unknown","unknown"]'; m0=$(ef "o/r2#$N" movedAt)
carrier GH_CHECKS=pass
ok "$(ghlog | grep -c "pulls/$N\$")|$(writes | grep -c .)" "4|0" "C2: all unknown: four reads, no write"
ok "$(ef "o/r2#$N" outcome)|$(ef "o/r2#$N" movedAt)" "GitHub has not settled its mergeability|$m0" "C2: … has not settled, and movedAt unchanged"
}  # end shard_1

shard_2() {
echo "== C3. the resolver: both-add hunks and last_touched, newer side first"
reset
# r3h: the head's commit is the newer; r3b: the base's is. Each side adds a line at THREAD.md's end and moves last_touched.
side() {  # side <branch> <date> <line> <epoch>: last_touched and a line on <branch>, committed at <epoch>
  co "$1"; python3 -c 'import re,sys; p,d=sys.argv[1:]; t=open(p).read(); open(p,"w").write(re.sub(r"last_touched: [^\n]*", "last_touched: "+d, t, count=1))' "$W/THREAD.md" "$2"
  printf '%s\n' "$3" >> "$W/THREAD.md"; GIT_COMMITTER_DATE="$4 +0000" ci "$1: $3"
}
repo r3h; B3h=$(cb r3h); side "$B3h" 2026-11-03 "- head line" 1762900000; H3h=$C; side master 2026-11-02 "- base line" 1762800000; M3h=$C
pr r3h "$B3h" "$AM"; N3h=$N
repo r3b; B3b=$(cb r3b); side "$B3b" 2026-11-02 "- head line" 1762800000; H3b=$C; side master 2026-11-04 "- base line" 1762900000; M3b=$C
pr r3b "$B3b" "$AM"; N3b=$N
repo r3c; B3c=$(cb r3c); put "$B3c" docs/handoffs/h.md "head line"; H3c=$C; put master docs/handoffs/h.md "base line"; M3c=$C
pr r3c "$B3c" "$AM"; N3c=$N
carrier PATH="$tmp/gitw:$PATH" GIT_SNAP="$ST" GH_CHECKS=pass
P=$(srvsha r3h "$B3h")
has "$out" "o/r3h#$N3h: resolved THREAD.md and pushed ${P:0:12}" "C3: resolved and pushed, and says so"
ok "$(git --git-dir "$SRV/o/r3h.git" rev-list --parents -n 1 "$P")" "$P $H3h $M3h" "C3: the pushed merge has parents [head, base]"
t=$(git --git-dir "$SRV/o/r3h.git" show "$P:THREAD.md")
ok "$(printf '%s\n' "$t" | tail -n 2 | tr '\n' '|')" "- head line|- base line|" "C3: both lines kept, the newer (head) first"
has "$t" "last_touched: 2026-11-03" "C3: … the later last_touched"
lacks "$t" "<<<<" "C3: … no conflict markers"
t=$(git --git-dir "$SRV/o/r3b.git" show "$(srvsha r3b "$B3b"):THREAD.md")
ok "$(printf '%s\n' "$t" | tail -n 2 | tr '\n' '|')" "- base line|- head line|" "C3: the base's newer line first when the base is newer"
has "$t" "last_touched: 2026-11-04" "C3: … and its later last_touched"
has "$(gitlog)" "clone --bare --filter=blob:none --no-tags --single-branch --branch master -c credential.helper= -c credential.helper=!gh auth git-credential -c core.hooksPath=/dev/null" \
  "C3: a bare partial clone, the inherited helpers cleared, then gh's, hooks off"
has "$(gitlog)" "write-tree --missing-ok" "C3: write-tree --missing-ok"
has "$(gitlog)" "-c core.hooksPath=/dev/null push origin $P:refs/heads/$B3h" "C3: pushed with hooks off, never forced"
lacks "$(gitlog | grep ' push ')" "--force" "C3: … no --force"
snap=$(grep -l -- "$P:refs/heads/" "$tmp"/snaps/push-*.argv | sed 's/argv$/json/')
ok "$(python3 -c 'import json,sys; e=json.load(open(sys.argv[1]))["landings"][sys.argv[2]]; print(e.get("pushed"), e.get("pushedFrom"))' "$snap" "o/r3h#$N3h" 2>/dev/null)" "$P $H3h" \
  "C3: the state file already held pushed and pushedFrom when the push ran (O1)"
ok "$(ls "$TMPDIR" | grep -c '^land-carrier-')" 0 "C3: no land-carrier-* directory left"
echo "== C14. the scratch clone runs under land.sh's prompt rule"
has "$(gitlog | grep 'clone --bare')" "|0|1|never" "C14: the clone's env carries GIT_TERMINAL_PROMPT=0 GH_PROMPT_DISABLED=1 GCM_INTERACTIVE=never"
echo "== C3b. a both-add hunk in a handoff doc is resolved"
P=$(srvsha r3c "$B3c")
has "$out" "o/r3c#$N3c: resolved docs/handoffs/h.md and pushed ${P:0:12}" "C3b: resolved"
ok "$(git --git-dir "$SRV/o/r3c.git" show "$P:docs/handoffs/h.md" | tr '\n' '|')" "h|base line|head line|" "C3b: both lines (a tie puts base first)"

echo "== C4. ineligible conflicts: no push, and the outcome says why"
reset
repo r4a; B=$(cb r4a); sub "$B" THREAD.md "- base entry" "- base entry (head)"; sub master THREAD.md "- base entry" "- base entry (base)"; pr r4a "$B" "$AM"; N4a=$N
repo r4b; B=$(cb r4b); sub "$B" src/c.txt c2 c2-head; sub master src/c.txt c2 c2-base; pr r4b "$B" "$AM"; N4b=$N
repo r4c; B=$(cb r4c); put "$B" docs/handoffs/h.md "more"; co master; git -C "$W" rm -q docs/handoffs/h.md; ci "rm h"; pr r4c "$B" "$AM"; N4c=$N
repo r4e; B=$(cb r4e); sub "$B" THREAD.md "last_touched: 2026-11-01" "last_touched: someday"; sub master THREAD.md "last_touched: 2026-11-01" "last_touched: 2026-11-02"
pr r4e "$B" "$AM"; N4e=$N
carrier PATH="$tmp/gitw:$PATH" GH_CHECKS=pass
ok "$(gitlog | grep -c ' push ')" 0 "C4: nothing pushed"
ok "$(ef "o/r4a#$N4a" outcome)" "not resolved: a conflict hunk in THREAD.md rewrites lines" "C4 (a): a rewrite hunk"
ok "$(ef "o/r4b#$N4b" outcome)" "not resolved: src/c.txt conflicts, and it is no close-out path" "C4 (b): a code path conflicts"
ok "$(ef "o/r4c#$N4c" outcome)" "not resolved: a CONFLICT (modify/delete) conflict on docs/handoffs/h.md" "C4 (c): modify/delete on a handoff doc"
ok "$(ef "o/r4e#$N4e" outcome)" "not resolved: a conflict hunk in THREAD.md rewrites lines" "C4 (e): a last_touched that is no date"

echo "== C4d. a clean auto-merge of a code path beside a THREAD.md both-add is resolved"
reset; repo r4d; B=$(cb r4d)
co "$B"; sed -i.bak 's/^c1$/c1-head/' "$W/src/c.txt"; rm -f "$W/src/c.txt.bak"; printf -- '- head line\n' >> "$W/THREAD.md"; ci head; H=$C
co master; sed -i.bak 's/^c8$/c8-base/' "$W/src/c.txt"; rm -f "$W/src/c.txt.bak"; printf -- '- base line\n' >> "$W/THREAD.md"; ci base
pr r4d "$B" "$AM"
carrier GH_CHECKS=pass
P=$(srvsha r4d "$B")
has "$out" "o/r4d#$N: resolved THREAD.md and pushed ${P:0:12}" "C4d: resolved"
ok "$(git --git-dir "$SRV/o/r4d.git" show "$P:src/c.txt" | sed -n '1p;8p' | tr '\n' '|')" "c1-head|c8-base|" "C4d: … src/c.txt carries both sides' changes"
}  # end shard_2

shard_3() {
echo "== C5. a cancelled job is re-run, twice per head at most"
reset; repo r5; B=$(cb r5); put "$B" THREAD.md "- r5"; pr r5 "$B" "$AM"
carrier GH_CHECKS=cancelled
has "$(ghlog)" "api --method POST repos/o/r5/actions/runs/1/rerun-failed-jobs" "C5: rerun-failed-jobs on run 1"
has "$out" "o/r5#$N: re-ran run 1 (cancelled jobs)" "C5: … and says so"
ok "$(reruns)|$(ef "o/r5#$N" reruns)" "1|1" "C5: one rerun recorded"
carrier GH_CHECKS=cancelled
ok "$(reruns)|$(ef "o/r5#$N" reruns)" "1 1|2" "C5: a second pass, a second rerun"
carrier GH_CHECKS=cancelled
ok "$(reruns)|$(ef "o/r5#$N" outcome)" "1 1|rerun budget spent" "C5: a third pass re-runs nothing: rerun budget spent"
put "$B" THREAD.md "- r5 more"
carrier GH_CHECKS=cancelled
ok "$(reruns)|$(ef "o/r5#$N" reruns)" "1 1 1|1" "C5: a new head resets the count"

echo "== C5b. a failed step is re-run only when it is setup; a status error never"
reset; repo r5b; B=$(cb r5b); put "$B" THREAD.md "- r5b"; pr r5b "$B" "$AM"
carrier GH_CHECKS=fail GH_STEPS="Configure (Debug)"
ok "$(reruns)" 1 "C5b: failure at Configure (Debug): re-run"
put "$B" THREAD.md "- next"
carrier GH_CHECKS=fail GH_STEPS="Run tests"
ok "$(reruns)" 1 "C5b: failure at Run tests: not re-run"
has "$(ef "o/r5b#$N" outcome)" "not re-run: a genuine failure in build (Run tests)" "C5b: … the outcome names it"
put "$B" THREAD.md "- again"
carrier GH_CHECKS=status-error
ok "$(reruns)" 1 "C5b: a status error: not re-run"
ok "$(ef "o/r5b#$N" outcome)" "not re-run: status ci/legacy is error" "C5b: … the outcome names the status"

echo "== C5c. the classifier is merge-task.sh's own; with no merge-task.sh a failure is never re-run"
ok "$(printf 'Configure (Debug)\n' | bash "$MT" --classify-steps)|$(printf 'Run tests\n' | bash "$MT" --classify-steps)|$(printf 'Set up job\nInstall dependencies\n' | bash "$MT" --classify-steps)" \
  "infra|genuine|infra" "C5c: merge-task.sh --classify-steps: infra, genuine, infra"
mini="$tmp/mini/skills/_shared/scripts"; mkdir -p "$mini"
cp "$CARRIER" "$root/skills/_shared/scripts/background_job.py" "$root/skills/_shared/scripts/landing-register.py" "$mini/"
reset; repo r5c; B=$(cb r5c); put "$B" THREAD.md "- r5c"; pr r5c "$B" "$AM"
CLK=$((CLK + 20)); : > "$LOG_GH"
GH_CHECKS=fail GH_STEPS="Configure (Debug)" python3 "$mini/land-carrier.py" run --settle-wait 0 --now "$(at $CLK)" >/dev/null 2>&1
ok "$(reruns)" "" "C5c: a mini root with no merge-task.sh never re-runs a failure"
CLK=$((CLK + 20))
GH_CHECKS=cancelled python3 "$mini/land-carrier.py" run --settle-wait 0 --now "$(at $CLK)" >/dev/null 2>&1
ok "$(reruns)" 1 "C5c: … but still re-runs a cancelled job"

echo "== C5d. a genuine failure anywhere on the head beats every cancellation"
reset; repo r5d; B=$(cb r5d); put "$B" THREAD.md "- d"; pr r5d "$B" "$AM"
carrier GH_CHECKS=jobs GH_JOBS="1:failure:Run tests;1:cancelled:;1:cancelled:"
ok "$(reruns)" "" "C5d (i): the #149 shape (one failure, its siblings cancelled): no rerun"
has "$(ef "o/r5d#$N" outcome)" "Run tests" "C5d (i): … the outcome names Run tests"
put "$B" THREAD.md "- d2"
carrier GH_CHECKS=jobs GH_JOBS="1:cancelled:;2:failure:Run tests"
ok "$(reruns)" "" "C5d (ii): a cancelled run beside a genuine failure in another run: neither re-run"
put "$B" THREAD.md "- d3"
carrier GH_CHECKS=jobs GH_JOBS="1:cancelled:;2:failure:Set up job"
ok "$(reruns)|$(ef "o/r5d#$N" reruns)" "1 2|1" "C5d (iii): all proven: one POST per run, one rerun of the head"

echo "== C5e. timed_out and startup_failure go through the classifier; no failed step is genuine"
reset; repo r5e; B=$(cb r5e); put "$B" THREAD.md "- e"; pr r5e "$B" "$AM"
carrier GH_CHECKS=jobs GH_JOBS="1:timed_out:"
ok "$(reruns)" "" "C5e (i): timed out with no failed step: no rerun"
has "$(ef "o/r5e#$N" outcome)" "timed out with no failed step" "C5e (i): … says so"
put "$B" THREAD.md "- e2"
carrier GH_CHECKS=jobs GH_JOBS="1:timed_out:Set up job"
ok "$(reruns)" 1 "C5e (ii): timed out at Set up job: re-run"
put "$B" THREAD.md "- e3"
carrier GH_CHECKS=jobs GH_JOBS="1:startup_failure:"
ok "$(reruns)" 1 "C5e (iii): startup_failure with no step: no rerun"
put "$B" THREAD.md "- e4"
carrier GH_CHECKS=jobs GH_JOBS="1:action_required:"
ok "$(reruns)|$(ef "o/r5e#$N" outcome)" "1|not re-run: job0 concluded action_required" "C5e (iv): action_required: no rerun"

echo "== C13. a refused auto-merge falls through to update-branch, the resolver and the rerun"
reset
repo r13a; Ba=$(cb r13a); put "$Ba" THREAD.md "- a"; Ha=$C; put master a.txt moved; pr r13a "$Ba"; Na=$N
repo r13b; Bb=$(cb r13b); put "$Bb" THREAD.md "- head"; Hb=$C; put master THREAD.md "- base"; pr r13b "$Bb"; Nb=$N
repo r13c; Bc=$(cb r13c); put "$Bc" THREAD.md "- c"; Hc=$C; pr r13c "$Bc"; Nc=$N
carrier GH_MERGE=notallowed GH_CHECKS_MAP="$Ha=pass,$Hb=pass,$Hc=cancelled"
has "$(ghlog)" "pr merge $Na -R o/r13a --auto --merge" "C13: auto-merge asked for"
has "$(ghlog)" "repos/o/r13a/pulls/$Na/update-branch" "C13: refused and behind: update-branch the same pass"
has "$(ef "o/r13a#$Na" outcome)" "auto-merge not queued (GraphQL: Auto merge is not allowed" "C13: … the refusal noted"
ok "$(git --git-dir "$SRV/o/r13b.git" rev-list --parents -n 1 "$(srvsha r13b "$Bb")" | wc -w | tr -d ' ')" 3 "C13: refused and dirty: the resolver pushes a merge"
ok "$(reruns)" 1 "C13: refused and red with only infra: re-run"
}  # end shard_3

shard_4() {
echo "== C6. merges: auto-merge off, auto-merge allowed, a clean refusal, own-auto, own-marked, a stale marker"
reset; repo r6a; B=$(cb r6a); put "$B" THREAD.md "- a"; H=$C; pr r6a "$B"
carrier GH_AUTOMERGE=false GH_CHECKS=pass
has "$(ghlog)" "api --method PUT repos/o/r6a/pulls/$N/merge -f merge_method=merge -f sha=$H" "C6 (a): auto-merge off on the repo: PUT merge pinned to the head"
lacks "$(ghlog)" "--auto" "C6 (a): … no auto-merge asked for"
ok "$(prstate "$N")|$(keys)" "MERGED|_pass" "C6 (a): merged, and its entry dropped"
has "$out" "o/r6a#$N: merged at ${H:0:12}" "C6 (a): … and says so"
reset; repo r6b; B=$(cb r6b); put "$B" THREAD.md "- b"; pr r6b "$B"
carrier GH_CHECKS=pass
has "$(ghlog)" "pr merge $N -R o/r6b --auto --merge" "C6 (b): auto-merge allowed and off on the PR: queued"
ok "$(puts | grep -c .)|$out" "0|o/r6b#$N: auto-merge queued" "C6 (b): … no direct merge, and it says so"
reset; repo r6c; B=$(cb r6c); put "$B" THREAD.md "- c"; H=$C; pr r6c "$B"
carrier GH_MERGE=clean GH_CHECKS=pass
ok "$(ghlog | grep -nE -- '--auto --merge|pulls/[0-9]+/merge' | cut -d: -f2 | awk '{print $1}' | tr '\n' ' ')" "pr api " "C6 (c): the auto-merge refusal, then …"
has "$(ghlog)" "pulls/$N/merge -f merge_method=merge -f sha=$H" "C6 (c): … a direct merge in the same pass"
reset
repo r6d; put feat/d THREAD.md "- d"; pr r6d feat/d "$AM"; Nd=$N
repo r6e; put feat/e THREAD.md "- e"; He=$C; pr r6e feat/e; Ne=$N; mark r6e "$Ne" "$He"
repo r6f; put feat/f THREAD.md "- f"; Hf=$C; pr r6f feat/f; Nf=$N; mark r6f "$Nf" "$Hf"; put feat/f a.txt "after the queue"
carrier GH_CHECKS=pass
ok "$(writes | grep -c 'o/r6d')|$(ef "o/r6d#$Nd" kind)|$(ef "o/r6d#$Nd" outcome)" "0|own-auto|waiting for GitHub's auto-merge" "C6 (d): own-auto: no merge call, GitHub merges it"
has "$(ghlog)" "api --method PUT repos/o/r6e/pulls/$Ne/merge -f merge_method=merge -f sha=$He" "C6 (e): own-marked: PUT merge pinned to the bound head"
ok "$(writes | grep -c 'o/r6f')|$(ef "o/r6f#$Nf" kind)|$(ef "o/r6f#$Nf" cleared)" "0|own-unqueued|True" "C6 (f): a marker for an older head after an author push: own-unqueued, no write"

echo "== C6g. an own-marked PR the carrier brought current is followed and merged at the merge"
reset; repo r6g; put feat/g THREAD.md "- g"; S=$C; put master a.txt moved; pr r6g feat/g; mark r6g "$N" "$S"
carrier GH_UPDATE=merge GH_CHECKS=pass
M=$(srvsha r6g feat/g)
ok "$(ef "o/r6g#$N" bound)|$(git --git-dir "$SRV/o/r6g.git" log -1 --format=%ce "$M")" "$S|noreply@github.com" "C6g: bound to S, then a GitHub-made update-branch merge"
carrier GH_UPDATE=merge GH_CHECKS=pass
ok "$(ef "o/r6g#$N" bound)" "None" "C6g: (merged: the entry is gone)"
has "$(ghlog)" "api --method PUT repos/o/r6g/pulls/$N/merge -f merge_method=merge -f sha=$M" "C6g: the binding advanced to M, and PUT merge carries sha=M"

echo "== C6h. a head the binding cannot follow clears it, and a cleared binding stays cleared for its marker"
reset
repo r6h1; put feat/h THREAD.md "- h"; S1=$C; put master a.txt moved; pr r6h1 feat/h; N1=$N; mark r6h1 "$N1" "$S1"
co feat/h; git -C "$W" merge -q --no-ff --no-edit origin/master; git -C "$W" push -q origin feat/h
repo r6h2; put feat/h THREAD.md "- h"; S2=$C; put master a.txt moved; pr r6h2 feat/h; N2=$N; mark r6h2 "$N2" "$S2"
co feat/h; git -C "$W" merge -q --no-ff --no-commit origin/master >/dev/null 2>&1; echo extra >> "$W/a.txt"; git -C "$W" add -A
GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL=noreply@github.com git -C "$W" commit -qm "Merge branch 'master' into feat/h"; git -C "$W" push -q origin feat/h
carrier GH_CHECKS=pass
ok "$(writes | grep -c .)" 0 "C6h: no merge, no write"
ok "$(ef "o/r6h1#$N1" bound)|$(ef "o/r6h1#$N1" cleared)|$(ef "o/r6h1#$N1" kind)" "None|True|own-unqueued" "C6h (i): a session's own clean merge of master clears it"
ok "$(ef "o/r6h2#$N2" bound)|$(ef "o/r6h2#$N2" cleared)" "None|True" "C6h (ii): a GitHub-committer merge whose tree is not the clean merge clears it"
W="$tmp/w/r6h1"; git -C "$W" push -q -f origin "$S1:refs/heads/feat/h"; setf "$N1" 'mergeableState="clean"'
carrier GH_CHECKS=pass
ok "$(writes | grep -c 'o/r6h1')|$(ef "o/r6h1#$N1" kind)" "0|own-unqueued" "C6h (iii): forced back to S: still cleared for that marker, no merge"
mark r6h1 "$N1" "$S1"
carrier GH_CHECKS=pass
has "$(ghlog)" "api --method PUT repos/o/r6h1/pulls/$N1/merge -f merge_method=merge -f sha=$S1" "C6h (iii): a new queued marker on S starts over: PUT merge with sha=S"

echo "== C6i. a chain of carrier hops is followed from the last bound, never from S"
reset; repo r6i; put feat/i THREAD.md "- i"; S=$C; put master a.txt moved; pr r6i feat/i; mark r6i "$N" "$S"; m0=
carrier GH_UPDATE=merge GH_CHECKS=pass
M1=$(srvsha r6i feat/i); m0=$(ef "o/r6i#$N" movedAt)
ok "$(ef "o/r6i#$N" bound)|$(git --git-dir "$SRV/o/r6i.git" rev-list --parents -n 1 "$M1" | cut -d' ' -f2)" "$S|$S" "C6i (i): pass 1 binds S and update-branches to M1 [S, master]"
put master a.txt "moved again"
carrier GH_UPDATE=merge GH_CHECKS=pass GH_SNAP="$ST"
M2=$(srvsha r6i feat/i)
ok "$(ef "o/r6i#$N" bound)|$(git --git-dir "$SRV/o/r6i.git" rev-list --parents -n 1 "$M2" | cut -d' ' -f2)" "$M1|$M1" "C6i (i): pass 2 advances to M1 and update-branches again to M2 [M1, master']"
ok "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["landings"][sys.argv[2]]["bound"])' "$(ls "$GH_STATE"/snaps/*-put.json | head -1)" "o/r6i#$N")" "$M1" \
  "C6i (i): … the state file held bound=M1 when that PUT went (O1)"
ok "$(ef "o/r6i#$N" movedAt)" "$m0" "C6i (i): … the carrier's merges never move the clock"
carrier GH_UPDATE=merge GH_CHECKS=pass
has "$(ghlog)" "api --method PUT repos/o/r6i/pulls/$N/merge -f merge_method=merge -f sha=$M2" "C6i (i): pass 3 advances to M2 and merges with sha=M2"
reset; repo r6j; put feat/j THREAD.md "- j"; S=$C; put master a.txt moved; pr r6j feat/j; mark r6j "$N" "$S"
carrier GH_UPDATE=merge GH_CHECKS=pass
M1=$(srvsha r6j feat/j)
put master THREAD.md "- master's own line"
carrier GH_UPDATE=merge GH_CHECKS=pass
P=$(srvsha r6j feat/j)
ok "$(ef "o/r6j#$N" bound)|$(ef "o/r6j#$N" pushed)|$(ef "o/r6j#$N" pushedFrom)" "$M1|$P|$M1" "C6i (ii): bound advanced to M1, then the resolver pushed P from M1"
carrier GH_UPDATE=merge GH_CHECKS=pass
has "$(ghlog)" "api --method PUT repos/o/r6j/pulls/$N/merge -f merge_method=merge -f sha=$P" "C6i (ii): the next pass advances to P through pushedFrom and merges with sha=P"
}  # end shard_4

shard_5() {
echo "== C7. supersession: by base, by a later close-out, never across bases or by an own branch; tombstones"
reset
repo r7a; P=$(cb r7a); put "$P" THREAD.md "- p"; put master THREAD.md "- p"; pr r7a "$P" "$AM"; Na=$N
pl() {  # pl <repo> <L branch> [<L fields>…]: P adds "- p"; a later L adds "- p" and "- l"; Np, Nl
  local r=$1 l=$2; shift 2
  put "$(cb "$r-p")" THREAD.md "- p"; pr "$r" "$(cb "$r-p")" "$AM"; Np=$N
  put "$l" THREAD.md "- p"; put "$l" THREAD.md "- l"; pr "$r" "$l" "$AM" "$@"; Nl=$N
}
repo r7b; pl r7b "$(cb r7b-l)"; Pb=$Np; Lb=$Nl
repo r7c; git -C "$W" push -q origin master:dev; pl r7c "$(cb r7c-l)" 'base="dev"'; Pc=$Np
repo r7d; pl r7d feat/l; Pd=$Np
repo r7f; pl r7f "$(cb r7f-l)"; Pf=$Np; Lf=$Nl
repo r7g; pl r7g "$(cb r7g-l)"; Pg=$Np; Lg=$Nl
carrier GH_CHECKS=pending
ok "$(prstate "$Na")|$(keys | tr ' ' '\n' | grep -c "^o/r7a#")" "CLOSED|0" "C7 (a): its lines on base, one commit: closed, the entry dropped"
has "$(cat "$GH_STATE/comments/o/r7a/$Na.json")" "Superseded (ADR 0078 d2): its lines are already on master" "C7 (a): … with a Superseded comment"
has "$(ghlog)" "api --method PATCH repos/o/r7a/pulls/$Na -f state=closed" "C7 (a): … then PATCH state=closed"
ok "$(prstate "$Pb")|$(ef "o/r7b#$Pb" supersededBy)" "CLOSED|o/r7b#$Lb" "C7 (b): carried by a later close-out: closed, supersededBy L"
has "$out" "o/r7b#$Pb: closed as superseded (https://github.com/o/r7b/pull/$Lb carries its lines)" "C7 (b): … and says so"
ok "$(prstate "$Pc")|$(ef "o/r7c#$Pc" outcome)" "OPEN|waiting for its checks" "C7 (c): an L on another base: kept (supersession read, no verdict)"
ok "$(prstate "$Pd")|$(ef "o/r7d#$Pd" outcome)" "OPEN|waiting for its checks" "C7 (d): an L on an own branch: kept"
setf "$Lb" 'state="CLOSED"'; setf "$Lg" 'state="MERGED"'
carrier GH_CHECKS=pending
ok "$(prstate "$Pb")|$(ef "o/r7b#$Pb" supersededBy)" "OPEN|None" "C7 (e): L closed unmerged: P reopened"
has "$out" "o/r7b#$Pb: reopened (https://github.com/o/r7b/pull/$Lb closed unmerged)" "C7 (e): … and says so"
ok "$(keys | tr ' ' '\n' | grep -c "^o/r7g#$Pg\$")" 0 "C7 (g): L merged: P's tombstone dropped"
ok "$(ef "o/r7f#$Pf" supersededBy)" "o/r7f#$Lf" "C7 (f): (a tombstone stands while its L is open)"
setf "$Lf" 'state="CLOSED"'
carrier GH_CHECKS=pending GH_PATCH=fail
ok "$(prstate "$Pf")|$(ef "o/r7f#$Pf" stuck)" "CLOSED|True" "C7 (f): the reopen fails: P stays closed and is flagged stuck"
has "$(sline --now "$(at $CLK)")" "o/r7f#$Pf: reopen failed (https://github.com/o/r7f/pull/$Lf closed unmerged)" "C7 (f): … listed by stuck at once"

echo "== C7n. a commit stranded under a close-out keeps it open, unless a later close-out carries both"
reset; repo r7n; P=$(cb r7n-p); put "$P" THREAD.md "- s"; X=$C; put "$P" THREAD.md "- c"
co master; printf -- '- s\n- c\n' >> "$W/THREAD.md"; ci "the lines, by another route"
pr r7n "$P" "$AM"; Pn=$N
carrier GH_CHECKS=pending
ok "$(prstate "$Pn")" OPEN "C7n: lines on base but two commits: not closed"
put "$(cb r7n-l)" THREAD.md "- l" "origin/$P"; pr r7n "$(cb r7n-l)" "$AM"; Ln=$N
carrier GH_CHECKS=pending
ok "$(prstate "$Pn")|$(ef "o/r7n#$Pn" supersededBy)" "CLOSED|o/r7n#$Ln" "C7n: an L carrying both commits: closed"

echo "== C8. the clock: 24 h unmoved is stuck; only an author's push restarts it"
reset; repo r8; B=$(cb r8); put "$B" THREAD.md "- r8"; pr r8 "$B" "$AM"
carrier GH_CHECKS=pending; t0=$(at $CLK)
CLK=$((CLK + 1440)); carrier GH_CHECKS=pending
has "$out" "o/r8#$N: stuck: unmoved since ${t0:0:16}: waiting for its checks" "C8 (a): unmoved for 24 h: stuck, and says so"
ok "$(ef "o/r8#$N" stuck)" True "C8 (a): … marked stuck"
carrier GH_CHECKS=pending
ok "$out" "" "C8 (a): … once"
ok "$(sline --now "$(at $CLK)")" "Landings: o/r8#$N: waiting for its checks (unmoved since ${t0:0:16})" "C8 (a): … and listed by stuck"
put "$B" THREAD.md "- an author's push"
carrier GH_CHECKS=pending
ok "$(ef "o/r8#$N" movedAt)|$(ef "o/r8#$N" stuck)" "$(at $CLK)|False" "C8 (b): an author push restarts movedAt"
m=$(ef "o/r8#$N" movedAt); put "$B" THREAD.md "- another push"
carrier GH_CHECKS=pending GH_COMMIT=fail
ok "$(ef "o/r8#$N" movedAt)" "$m" "C8 (d): a failed commits read restarts nothing"
reset; repo r8c; B=$(cb r8c); put "$B" THREAD.md "- c"; put master a.txt moved; pr r8c "$B" "$AM"
carrier GH_CHECKS=pass GH_UPDATE=merge; m=$(ef "o/r8c#$N" movedAt)
carrier GH_CHECKS=pending
ok "$(ef "o/r8c#$N" head)|$(ef "o/r8c#$N" movedAt)" "$(srvsha r8c "$B")|$m" "C8 (c): the carrier's update-branch merge is a new head that keeps the clock"
reset; repo r8e; B=$(cb r8e); put "$B" THREAD.md "- head"; put master THREAD.md "- base"; pr r8e "$B" "$AM"
carrier GH_CHECKS=pass; m=$(ef "o/r8e#$N" movedAt)
carrier GH_CHECKS=pending
ok "$(ef "o/r8e#$N" head)|$(ef "o/r8e#$N" movedAt)" "$(ef "o/r8e#$N" pushed)|$m" "C8 (e): the resolver's push is a new head that keeps the clock"

echo "== C9. own-unqueued and draft PRs: no write, stuck after a day"
reset; repo r9; put feat/u THREAD.md "- u"; pr r9 feat/u; Nu=$N; put feat/d THREAD.md "- d"; pr r9 feat/d 'draft=true'; Nd=$N
carrier GH_CHECKS=pass
ok "$(writes | grep -c .)|$(ef "o/r9#$Nu" outcome)|$(ef "o/r9#$Nd" outcome)" "0|not queued: left to its session|a draft: left to its session" \
  "C9: no write: left to its session"
CLK=$((CLK + 1440)); carrier GH_CHECKS=pass
ok "$(printf '%s\n' "$out" | grep -c ': stuck: unmoved since')" 2 "C9: … both stuck after 24 h"

echo "== C10. a repo on the landing register gets no write of any kind"
reset; repo r10; B=$(cb r10); put "$B" THREAD.md "- r10"; pr r10 "$B"; printf -- '- o/r10 — team repo\n' > "$LANDING_REGISTER"
carrier GH_CHECKS=pass
ok "$(writes | grep -c .)" 0 "C10: no write"
has "$(ef "o/r10#$N" outcome)" "landing register: listed o/r10: team repo" "C10: the outcome names the register"
: > "$LANDING_REGISTER"
}  # end shard_5

shard_6() {
echo "== C11. the deadline cuts a pass between PRs; a TERM stops the live child and keeps the written entries"
reset; repo r11; put "$(cb r11a)" THREAD.md "- a"; pr r11 "$(cb r11a)" "$AM" 'hang="pull"'; N1=$N
put "$(cb r11b)" THREAD.md "- b"; pr r11 "$(cb r11b)" "$AM"; N2=$N
carrier GH_CHECKS=pending -- --deadline 3
ok "$rc" 0 "C11 (a): exit 0"
has "$(ef "o/r11#$N1" outcome)" "cannot read the PR: gh ran past" "C11 (a): PR 1's entry is written (its read stopped at the deadline)"
ok "$(keys | tr ' ' '\n' | grep -c "^o/r11#$N2\$")|$(ghlog | grep -c "pulls/$N2\$")" "0|0" "C11 (a): PR 2 untouched"
setf "$N1" 'hang=null'
carrier GH_CHECKS=pending
ok "$(ghlog | grep -E "pulls/($N1|$N2)\$" | head -1 | sed 's/.*pulls\///')" "$N2" "C11 (a): the next pass handles PR 2 first"
reset; repo r11t; put feat/a THREAD.md "- a"; pr r11t feat/a; N1=$N   # an own branch: its pass reads no later PR
put "$(cb r11tb)" THREAD.md "- b"; pr r11t "$(cb r11tb)" "$AM" 'hang="pull"'; N2=$N
CLK=$((CLK + 20)); rm -f "$GH_STATE/hang.pid"
GH_CHECKS=pending python3 "$CARRIER" run --settle-wait 0 --now "$(at $CLK)" > "$tmp/c11.out" 2>&1 & cpid=$!
i=0; while [ ! -s "$GH_STATE/hang.pid" ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done
hp=$(cat "$GH_STATE/hang.pid" 2>/dev/null); holders+=("$hp")
kill -TERM "$cpid"; wait "$cpid"; rc=$?
ok "$rc" 143 "C11 (b): a TERM during PR 2's hung read: exit 143"
ok "$(ef "o/r11t#$N1" kind)" own-unqueued "C11 (b): PR 1's entry persists"
sleep 0.5
ok "$(kill -0 -- "-$hp" 2>/dev/null && echo alive || echo gone)" gone "C11 (b): the hung child's process group is gone"

echo "== C12. discovery and scope"
reset; carrier GH_SEARCH=fail
has "$out" "search failed: gh: HTTP 401: Bad credentials" "C12 (a): a failing search prints one line"
carrier GH_SEARCH=fail
ok "$out|$(sline --now "$(at $CLK)")" "|None" "C12 (a): … once, and is not listed within a day"
has "$(sline --now "$(at $((CLK + 1440)))")" "Landings: search: search failed: gh: HTTP 401: Bad credentials" "C12 (a): stuck lists the spell at 24 h"
carrier
ok "$(ef _pass searchFailedSince)" None "C12 (a): a search that works clears it"
reset
repo r12b; Bb=$(cb r12b); put "$Bb" THREAD.md "- b"; pr r12b "$Bb" "$AM" 'labels=[]'; Nb=$N
repo r12c; put close/fix-thing THREAD.md "- c"; pr r12c close/fix-thing 'labels=[]'; Nc=$N
repo r12d; put close/fix-thing THREAD.md "- d"; pr r12d close/fix-thing; Nd=$N
carrier PATH="$tmp/gitw:$PATH" GH_CHECKS=pass
ok "$(ef "o/r12b#$Nb" kind)" close-out "C12 (b): an unlabelled close-out with land.sh's branch is found by the --head close search"
ok "$(keys | tr ' ' '\n' | grep -c '^o/r12c#')|$(writes | grep -c 'o/r12c')|$(gitlog | grep 'clone' | grep -c 'o/r12c')" "0|0|0" \
  "C12 (c): an unlabelled close/fix-thing is out of scope: no entry, no write, no clone"
ok "$(ef "o/r12d#$Nd" kind)|$(writes | grep -c 'o/r12d')" "own-unqueued|0" "C12 (d): a labelled close/fix-thing takes the own-branch kinds: own-unqueued, no write"

echo "== C15. stuck: its JSON, a null line, the due rule, and _pass never an entry"
reset; mkdir -p "$(dirname "$ST")"
python3 - "$ST" "$(at 0)" "$(at 2000)" <<'PY'
import json, sys
p, old, future = sys.argv[1:]
e = lambda moved, **x: dict({"url": "https://github.com/o/x/pull/1", "kind": "close-out", "since": old, "movedAt": moved,
                             "outcome": "waiting for its checks"}, **x)
json.dump({"v": 1, "landings": {"_pass": {"lastPass": old}, "o/x#1": e(old), "o/x#2": e(future),
                                "o/x#3": e(old, supersededBy="o/x#4"), "o/x#5": e(old, supersededBy="o/x#4", stuck=True,
                                                                                  outcome="reopen failed")}}, open(p, "w"))
PY
j=$(stk --now "$(at 1500)")
ok "$(printf '%s' "$j" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(d), [sorted(r) for r in d["stuck"]][:1], [r["key"] for r in d["stuck"]])')" \
  "['line', 'state', 'stuck'] [['key', 'kind', 'movedAt', 'outcome', 'url']] ['o/x#1', 'o/x#5']" \
  "C15: {state, stuck: [{key, url, kind, movedAt, outcome}], line}: due a day after movedAt, a stuck tombstone; never a future movedAt, an unstuck tombstone or _pass"
has "$(sline --now "$(at 1500)")" "Landings: o/x#1: waiting for its checks (unmoved since ${T0:0:16}) · o/x#5: reopen failed" "C15: the line"
ok "$(sline --now "$(at 60)" | grep -c 'o/x#1')" 0 "C15: … within a day the entry is not due"
rm -f "$ST"; ok "$(sline)" None "C15: no file: a null line"
python3 "$CARRIER" stuck --now nope > /dev/null 2>&1; ok "$?" 2 "C15: a bad --now is usage, exit 2"

echo "== C16. marker: the newest marker-class comment by the login"
mk() { printf '%s' "$1" | python3 "$CARRIER" marker --login me 2>/dev/null; echo "|$?"; }
q='Landing queued (ADR 0078 d2): '
ok "$(mk "[{\"id\":1,\"user\":{\"login\":\"me\"},\"body\":\"${q}aaa\"}][{\"id\":3,\"user\":{\"login\":\"me\"},\"body\":\"${q}bbb\\nmore\"},{\"id\":2,\"user\":{\"login\":\"me\"},\"body\":\"Landing withdrawn (ADR 0078 d2): aaa\"}]")" \
  "queued bbb|0" "C16: concatenated pages, the newest by id"
ok "$(mk "[{\"id\":1,\"user\":{\"login\":\"me\"},\"body\":\"${q}aaa\"},{\"id\":2,\"user\":{\"login\":\"someone\"},\"body\":\"${q}ccc\"}]")" "queued aaa|0" "C16: another login's ignored"
ok "$(mk "[{\"id\":1,\"user\":{\"login\":\"me\"},\"body\":\"${q}aaa\"},{\"id\":2,\"user\":{\"login\":\"me\"},\"body\":\"Landing held (ADR 0028 § 3)\\n\\nwhy\"}]")" "none|0" "C16: after a hold: none"
ok "$(mk "[{\"id\":1,\"user\":{\"login\":\"me\"},\"body\":\"${q}aaa\"},{\"id\":2,\"user\":{\"login\":\"me\"},\"body\":\"Landing withdrawn (ADR 0078 d2): aaa\"}]")" "none|0" "C16: after a withdrawal: none"
ok "$(mk "[{\"id\":7,\"user\":{\"login\":\"me\"},\"body\":\"${q}not-a-sha\"},{\"id\":8,\"user\":{\"login\":\"me\"},\"body\":\"a plain comment\"}]")" "queued not-a-sha|0" "C16: any S, the head never consulted"
ok "$(mk 'not json')|$(mk '')" "|2||2" "C16: unreadable or empty JSON: exit 2"
printf '[]' | python3 "$CARRIER" marker >/dev/null 2>&1; ok "$?" 2 "C16: no --login: exit 2"

echo "== C17. --dry-run: would-lines, no state, no write, due or not"
reset; repo r17; B=$(cb r17); put "$B" THREAD.md "- r17"; H=$C; put master a.txt moved; pr r17 "$B" "$AM"
carrier GH_CHECKS=pass -- --dry-run
has "$out" "o/r17#$N: would request update-branch (from ${H:0:12})" "C17: a would-line"
ok "$([ -e "$ST" ] && echo written)|$(writes | grep -c .)" "|0" "C17: no state written, no write call"
mkdir -p "$(dirname "$ST")"; printf '{"v": 1, "landings": {"_pass": {"lastPass": "%s"}}}\n' "$(at $CLK)" > "$ST"
out=$(GH_CHECKS=pass python3 "$CARRIER" run --dry-run --settle-wait 0 --now "$(at $CLK)" 2>/dev/null); rc=$?
ok "$rc" 0 "C17: --dry-run runs even when not due"
has "$out" "would request update-branch" "C17: … and still says what it would do"

echo "== C18. another author's PR, or a head in another repo, is skipped"
reset; repo r18; put feat/x THREAD.md "- x"; pr r18 feat/x 'isCrossRepository=true'; Nx=$N
put feat/y THREAD.md "- y"; pr r18 feat/y 'author={"login":"someone"}'; Ny=$N
mkdir -p "$(dirname "$ST")"
printf '{"v": 1, "landings": {"o/r18#%s": {"url": "u", "since": "%s", "movedAt": "%s"}}}\n' "$Ny" "$(at $CLK)" "$(at $CLK)" > "$ST"
carrier GH_CHECKS=pass
ok "$(writes | grep -c .)" 0 "C18: no write"
ok "$(ef "o/r18#$Nx" outcome)" "skipped: its head is in another repository (fork/r18)" "C18: a cross-repo head is skipped"
ok "$(ef "o/r18#$Ny" outcome)" "skipped: the PR is someone's, not me's" "C18: another author's PR is skipped"
}  # end shard_6

# ---- run this child's shard -------------------------------------------------------------------------------------------
declare -F "shard_$shard" >/dev/null || { echo "FAIL - no shard_$shard"; exit 1; }
"shard_$shard"
echo
[ "$fail" = 0 ] && r="ALL PASS" || r=FAILED
echo "land-carrier.test.sh shard $shard: $r (${SECONDS}s)"
exit "$fail"
