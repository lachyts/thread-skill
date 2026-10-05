#!/usr/bin/env bash
# p14-6, executed: skills/execute/scripts/git-env-canary.py, the lead's git-env canary (execute § 4.5 *Git-env
# canary*). A window is armed before a launch and checked when it ends; a change to the shared checkout's
# refs/heads/<default> or its bareness that is not a close-out is logged on the rollout note's `## Git-env log` and
# holds the queue until a human ack (repair § 3e). tests/contracts/git-env-canary.test.mjs pins the prose.
#
# Hermetic: every repo lives under mktemp with a local bare repo as its only remote; the vault (rollout note + task
# notes) is temp; THREAD_GIT_ENV_DIR points the records into temp; every canary verb gets --tasks-dir explicitly
# (under the runner's temp HOME the default tasks dir does not exist, so a canary that ignored it would exit 2).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
root=$(pwd -P)
CAN="$root/skills/execute/scripts/git-env-canary.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
LAND="$root/skills/_shared/scripts/land.sh"
SKILL="$root/skills/execute/SKILL.md"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"  # the Run record (run_record.py, ADR 0032) stays in temp
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master -c commit.gpgsign=false "$@"; }

S=""; O=""; R=""; V=""; RO=""; C2=""
# scen <name>: a fresh origin ($O, bare, the only remote), the shared checkout $R (a clone on master), a second
# clone $C2 (another session pushing to origin), the vault $V with the rollout note $RO (Project root: $R) and the
# records under $S/state.
scen() {
  S="$TMP/$1"; O="$S/origin.git"; R="$S/repo"; C2="$S/clone2"; V="$S/vault"; RO="$V/ro.md"
  mkdir -p "$S" "$V"
  export THREAD_GIT_ENV_DIR="$S/state"
  g init -q --bare "$O"
  g init -q "$S/seed"
  mkdir -p "$S/seed/docs/handoffs"
  echo a > "$S/seed/a.txt"; echo t > "$S/seed/THREAD.md"; echo h > "$S/seed/docs/handoffs/x.md"
  g -C "$S/seed" add -A; g -C "$S/seed" commit -q -m init
  echo b >> "$S/seed/a.txt"; g -C "$S/seed" commit -q -am second
  g -C "$S/seed" push -q "$O" master
  g clone -q "$O" "$R"; g clone -q "$O" "$C2"
  mkro "$R"
  echo "== $1"
}
# mkro <Project root | -> — the rollout note
mkro() {
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Notes\n\n'
    [ "$1" = "-" ] || printf 'Project root: `%s`\n' "$1"
    printf '\n## Queue\n\n- [[A]]\n'; } > "$RO"
}
# mkt <slug> <status> [frontmatter lines...] — a task note linked to the rollout
mkt() {
  local s=$1 st=$2; shift 2
  { printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[ro]]"\n' "$st"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\nbody\n'; } > "$V/$s.md"
}
setst() { python3 - "$V/$1.md" "$2" <<'PY'
import re, sys
p, st = sys.argv[1:]
t = open(p).read()
open(p, "w").write(re.sub(r"^status: .*$", f"status: {st}", t, count=1, flags=re.M))
PY
}
# can <verb> [args...] -> $rc, $out, $err. --tasks-dir is ${TD:-$V}.
can() {
  local verb=$1; shift
  python3 "$CAN" "$verb" --rollout "$RO" --tasks-dir "${TD:-$V}" "$@" > "$S/out" 2> "$S/err"; rc=$?
  out=$(cat "$S/out"); err=$(cat "$S/err")
}
arm() { can arm --repo "$R" --default master --slug "$1" --kind "${2:-task}"; }
chk() { can check --repo "$R" --default master --slug "$1" --kind "${2:-task}"; }
call() { can check-all; }
ackc() { can ack --repo "$R" --default master --slugs "$1" --ref "$2"; }
rst() { python3 "$CAN" restore --rollout "$RO" --repo "$R" --default master "$@" > "$S/out" 2> "$S/err"; rc=$?; out=$(cat "$S/out"); err=$(cat "$S/err"); }
recp() { printf '%s/ro/%s.%s.json' "$THREAD_GIT_ENV_DIR" "$1" "${2:-task}"; }
# recf <slug> <kind> <field> — one record field as JSON ("<none>" when the record is absent)
recf() { local p; p=$(recp "$1" "$2"); [ -f "$p" ] || { echo "<none>"; return; }; python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get(sys.argv[2])))' "$p" "$3"; }
trips() { grep -c "git-env trip \[\[$1\]\]" "$RO"; }
acks() { grep -c 'git-env ack' "$RO"; }
cur() { git -C "$R" rev-parse "${1:-master}"; }
code() { echo "$RANDOM$RANDOM" >> "$R/${1:-code.txt}"; g -C "$R" add -A; g -C "$R" commit -q -m code; }
cpath() { mkdir -p "$(dirname "$R/$1")"; echo "$RANDOM" >> "$R/$1"; g -C "$R" add -A; g -C "$R" commit -q -m "close-out $1"; }
push2() { g -C "$C2" fetch -q origin; g -C "$C2" reset -q --hard origin/master; echo "$RANDOM" >> "$C2/c2.txt"; g -C "$C2" add -A; g -C "$C2" commit -q -m c2; g -C "$C2" push -q origin master; }
ff() { g -C "$R" fetch -q origin; g -C "$R" merge -q --ff-only origin/master; }
holder() {  # holder <seconds> — hold the lock in the background, $S/held once it is held
  rm -f "$S/held"
  python3 -c 'import fcntl, sys, time
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2], "w").close(); time.sleep(float(sys.argv[3]))' \
    "$THREAD_GIT_ENV_DIR/ro.lock" "$S/held" "$1" &
  hp=$!
  n=0; while [ ! -f "$S/held" ] && [ "$n" -lt 100 ]; do sleep 0.05; n=$((n + 1)); done
}
dellog() { python3 - "$RO" "$1" <<'PY'
import sys
p, needle = sys.argv[1:]
lines = open(p).read().split("\n")
open(p, "w").write("\n".join(l for l in lines if needle not in l))
PY
}

# ── a: a clean window ────────────────────────────────────────────────────────────────────────────────────────
scen a
mkt A in_progress
arm A; ok "$rc" 0 "a: arm on an unchanged repo → 0"
ok "$(recf A task state)|$(recf A task closed)|$(recf A task ref)" "\"armed\"|false|\"$(cur)\"" "a: … an open armed record holding refs/heads/master"
chk A; ok "$rc" 0 "a: check on an unchanged repo → 0"
ok "$(recf A task state)|$(recf A task closed)" '"checked"|true' "a: … the record is a checked tombstone"
ok "$(grep -c 'git-env' "$RO")" 0 "a: … and the note carries no git-env line"
chk A; ok "$rc" 3 "a: a repeated check of the closed window → 3 (its tombstone is not this window's arm)"
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: record not armed" "a: … logged as record not armed"
# a2: the skipped arm. A revise, restart or resume of the same task that never armed must not pass on the last
# window's tombstone: a code commit made with no window open would otherwise go unseen.
scen a2
mkt A in_progress
arm A; chk A; ok "$rc" 0 "a2: arm A, check A → 0"
code
chk A; ok "$rc|$(trips A)" "3|1" "a2: a code commit with no new arm, then check A → 3, one trip line"
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: record not armed" "a2: … logged as record not armed"
ok "$(recf A task state)|$(recf A task closed)" '"tripped"|true' "a2: … the record reads tripped and closed"
ackc A "$(cur)"; ok "$rc" 0 "a2: … which the ack clears"
arm A; chk A; ok "$rc" 0 "a2: a fresh arm, then its check → 0"
# a3: an acked tombstone is not an arm either.
scen a3
mkt A in_progress
arm A; code; chk A; ackc A "$(cur)"; ok "$(recf A task state)" '"acked"' "a3: a trip on a closed window, acked → acked"
chk A; ok "$rc|$(trips A)" "3|2" "a3: check A on the acked tombstone with no new arm → 3, a second trip line"

# ── b: a code commit on local master trips ───────────────────────────────────────────────────────────────────
scen b
mkt A in_progress
arm A; old=$(cur); code; new=$(cur)
chk A; ok "$rc" 3 "b: a code commit on local master between arm and check → 3"
ok "$(trips A)" 1 "b: … one trip line logged"
has "$(grep 'git-env trip' "$RO")" "task: refs/heads/master ${old}→${new}; repo $R" "b: … naming the kind, old→new and the repo"
ok "$(recf A task state)|$(recf A task closed)" '"tripped"|true' "b: … the record reads tripped and closed"
has "$err" "${old}→${new}" "b: … stderr names old→new"

# ── c: bareness ──────────────────────────────────────────────────────────────────────────────────────────────
scen c
mkt A in_progress
arm A; g -C "$R" config --local core.bare true
chk A; ok "$rc" 3 "c: core.bare true (local config) → 3"
has "$(grep 'git-env trip' "$RO")" "core.bare false→true" "c: … the line names the bare flip"
scen c2
mkt A in_progress
arm A; g -C "$R" config --local extensions.worktreeConfig true; g -C "$R" config --worktree core.bare true
ok "$(git -C "$R" config --local --get core.bare)" false "c2: the local config still reads false"
chk A; ok "$rc" 3 "c2: core.bare true in config.worktree (extensions.worktreeConfig) → 3"

# ── d: moves relative to origin ──────────────────────────────────────────────────────────────────────────────
scen d
mkt A in_progress
arm A; push2; ff
chk A; ok "$rc" 0 "d: a push from a second clone, then fetch + merge --ff-only in R → 0"
arm A; code
chk A; ok "$rc" 3 "d2: a code commit not on origin → 3"
scen d3
mkt A in_progress
arm A
g -C "$R" checkout -q -b side; code; g -C "$R" push -q origin side:master; g -C "$R" checkout -q master; ff
chk A; ok "$rc" 0 "d3: a direct push to origin, then a local fast-forward → 0 (a pinned false negative, ADR 0030)"
arm A; push2; ff; push2; g -C "$R" fetch -q origin
chk A; ok "$rc" 0 "d4: a fast-forward, then origin moves again and is fetched → 0"
# d5: a forged refs/remotes/origin/master plus a local fast-forward onto it passes: a known gap (ADR 0030), which
# repair § 3e's ls-remote exposes and restore's fetch overwrites (j2).
arm A
g -C "$R" checkout -q -b forge; code; f=$(cur forge); g -C "$R" checkout -q master
g -C "$R" update-ref refs/remotes/origin/master "$f"; g -C "$R" merge -q --ff-only "$f"
chk A; ok "$rc" 0 "d5: a forged tracking ref plus a local fast-forward onto it → 0 (a pinned gap, ADR 0030)"

# ── r: the close-out rule (land.sh's closeout_shaped, stricter than S9) ─────────────────────────────────────
scen r
for s in A1 A2 A3 A4 A5 A6 A7 A8 A10; do mkt "$s" in_progress; done
arm A1; cpath THREAD.md; chk A1; ok "$rc" 0 "r1: a commit touching only THREAD.md → 0"
arm A2; g -C "$R" rm -q docs/handoffs/x.md; g -C "$R" commit -q -m "close-out: drop a consumed handoff"; cpath sub/docs/handoffs/y.md
chk A2; ok "$rc" 0 "r2: deleting docs/handoffs/x.md, then adding sub/docs/handoffs/y.md → 0"
g -C "$R" push -q origin master
arm A3; push2; ff; cpath THREAD.md; chk A3; ok "$rc" 0 "r3: a fast-forward, then a close-out commit → 0"
g -C "$R" push -q origin master
cpath docs/handoffs/z.md
arm A4; push2; g -C "$R" fetch -q origin; g -C "$R" rebase -q origin/master
chk A4; ok "$rc" 0 "r4: S11's shape (a local close-out rebased onto a moved origin) → 0"
g -C "$R" push -q origin master
arm A5; echo t2 >> "$R/THREAD.md"; mkdir -p "$R/src"; echo x > "$R/src/x.py"; g -C "$R" add -A; g -C "$R" commit -q -m mixed
chk A5; ok "$rc" 3 "r5: THREAD.md plus src/x.py → 3"
scen r6
mkt A in_progress
arm A; cpath docs/handoffs/sub/x.md; chk A; ok "$rc" 3 "r6: a nested docs/handoffs/sub/x.md → 3"
scen r7
mkt A in_progress
g -C "$R" checkout -q -b side; cpath THREAD.md; g -C "$R" checkout -q master
arm A; cpath docs/handoffs/w.md; g -C "$R" merge -q --no-ff -m merge side
chk A; ok "$rc" 3 "r7: a local merge commit (close-out paths only) → 3 (stricter than S9)"
scen r8
mkt A in_progress
arm A; g -C "$R" reset -q --hard HEAD~1
chk A; ok "$rc" 3 "r8: local master reset behind origin → 3"
scen r10
mkt A in_progress
arm A; g -C "$R" commit -q --allow-empty -m empty
chk A; ok "$rc" 3 "r10: commit --allow-empty → 3 (stricter than S9)"
# r9: the python port against land.sh's own function, extracted by sed.
sed -n '/^closeout_shaped() {/,/^}/p' "$LAND" > "$TMP/closeout.sh"
ok "$(grep -c 'closeout_shaped' "$TMP/closeout.sh")" 1 "r9: land.sh's closeout_shaped extracted"
paths='THREAD.md
sub/THREAD.md
a/b/THREAD.md
THREAD.md.bak
xTHREAD.md
docs/handoffs/x.md
docs/handoffs/
docs/handoffs/sub/x.md
sub/docs/handoffs/y.md
sub/docs/handoffs/a/y.md
a/docs/handoffs/b/docs/handoffs/c.md
docs/handoffsx/y.md
src/x.py
README.md
docs/x.md'
want=$(printf '%s\n' "$paths" | while IFS= read -r p; do bash -c ". '$TMP/closeout.sh'; closeout_shaped \"\$1\" && echo \"\$1 y\" || echo \"\$1 n\"" _ "$p"; done)
got=$(printf '%s\n' "$paths" | python3 -c '
import importlib.util, sys
spec = importlib.util.spec_from_file_location("c", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for p in sys.stdin.read().split("\n"):
    if p: print(p, "y" if m.closeout_shaped(p) else "n")' "$CAN")
ok "$got" "$want" "r9: the python closeout_shaped agrees with land.sh's on $(printf '%s\n' "$paths" | wc -l | tr -d ' ') paths"

# ── u: the read order, through a recorder in place of _git ──────────────────────────────────────────────────
scen u
mkt A in_progress
u=$(python3 - "$CAN" "$RO" "$R" "$V" <<'PY'
import importlib.util, io, re, sys, types, contextlib
can, ro, repo, vault = sys.argv[1:]
spec = importlib.util.spec_from_file_location("canary", can); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
A, B, C = "a" * 40, "b" * 40, "c" * 40
calls = []
heads = [f"{A} refs/heads/master"]
def rec(r, *args):
    calls.append(list(args))
    out = ""
    if args[:1] == ("rev-parse",): out = "false\n"
    elif args[:1] == ("for-each-ref",): out = "\n".join(heads) + "\n" if args[-1] == "refs/heads/master" else f"{B} refs/remotes/origin/master\n"
    elif args[:1] == ("rev-list",): out = "" if "--parents" not in args else f"{C} {A}\n"
    elif args[:2] == ("merge-base", "--is-ancestor"): return types.SimpleNamespace(returncode=0, stdout="", stderr="")
    elif args[:1] == ("merge-base",): out = B + "\n"
    elif args[:1] == ("diff-tree",): out = "THREAD.md\0"
    return types.SimpleNamespace(returncode=0, stdout=out, stderr="")
m._git = rec
res = []
st = m._read_state(repo, "master")
res.append("u1 " + ("ok" if [c[:2] for c in calls] == [["rev-parse", "--is-bare-repository"], ["for-each-ref", "--format=%(objectname) %(refname)"], ["for-each-ref", "--format=%(objectname) %(refname)"]] and calls[1][-1] == "refs/heads/master" and calls[2][-1] == "refs/remotes/origin/master" and st == (False, A, B) else f"bad {calls} {st}"))
for label, h in (("two lines", [f"{A} refs/heads/master", f"{C} refs/heads/master/x"]), ("a wrong refname", [f"{A} refs/heads/master/x"])):
    heads[:] = h
    try:
        m._read_state(repo, "master"); res.append(f"u1-{label} no-exit")
    except m.CanaryError as e:
        res.append(f"u1-{label} {e.code}")
heads[:] = [f"{A} refs/heads/master"]
for d in ("ma*", "a..b"):
    calls.clear()
    with contextlib.redirect_stderr(io.StringIO()):
        rc = m.main(["arm", "--rollout", ro, "--tasks-dir", vault, "--repo", repo, "--default", d, "--slug", "A", "--kind", "task"])
    res.append(f"u1-default {d} {rc} {len(calls)}")
# u2: the comparison's rev-list / merge-base / diff-tree argv carry only shas.
calls.clear()
reason = m._compare({"repo": repo, "default": "master", "ref": C, "bare": False}, (False, A, B))
named = [c for c in calls if c[0] in ("rev-list", "merge-base", "diff-tree") and any(re.search(r"master|origin|HEAD", x) for x in c)]
res.append("u2 " + ("ok" if not named and reason is None and any(c[0] == "merge-base" for c in calls) else f"bad {named} {reason}"))
print("\n".join(res))
PY
)
has "$u" "u1 ok" "u1: _read_state reads bare, then refs/heads/master, then refs/remotes/origin/master, three calls"
has "$u" "u1-two lines 2" "u1: two lines for the heads read → exit 2"
has "$u" "u1-a wrong refname 2" "u1: a refname that is not exactly the requested ref → exit 2"
has "$u" "u1-default ma* 2 0" "u1: --default 'ma*' → 2 with no git call on R"
has "$u" "u1-default a..b 2 0" "u1: --default 'a..b' → 2 with no git call on R"
has "$u" "u2 ok" "u2: rev-list, merge-base and diff-tree take only the shas _read_state returned"
# u3: ack re-baselines to --ref with exactly one _read_state after the pass.
mkt B in_progress
arm A; arm B; code; Y=$(cur); chk A
u3=$(python3 - "$CAN" "$RO" "$R" "$V" "$Y" <<'PY'
import importlib.util, io, sys, contextlib
can, ro, repo, vault, y = sys.argv[1:]
spec = importlib.util.spec_from_file_location("canary", can); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
n = {"reads": 0, "at_pass_end": None}
real_read, real_pass = m._read_state, m._pass
def counted(*a, **k):
    n["reads"] += 1
    return real_read(*a, **k)
def passed(*a, **k):
    r = real_pass(*a, **k); n["at_pass_end"] = n["reads"]; return r
m._read_state, m._pass = counted, passed
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    rc = m.main(["ack", "--rollout", ro, "--tasks-dir", vault, "--repo", repo, "--default", "master", "--slugs", "A,B", "--ref", y])
print(rc, n["reads"] - n["at_pass_end"])
PY
)
ok "$u3" "0 1" "u3: ack --ref <Y> → 0, with exactly one _read_state after the pass"
ok "$(grep -c "git-env ack \[\[A\]\], \[\[B\]\]: refs/heads/master at $Y" "$RO")|$(recf B task state)|$(recf B task ref)" "1|\"armed\"|\"$Y\"" "u3: … the ack line names Y, and B's open window is re-baselined to Y"
u4=$(python3 - "$CAN" <<'PY'
import ast, sys
src = open(sys.argv[1]).read()
fn = next(n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef) and n.name == "_read_state")
hits = [i for i, l in enumerate(src.split("\n"), 1) if "for-each-ref" in l]
print("ok" if hits and all(fn.lineno <= i <= fn.end_lineno for i in hits) else f"bad {hits} {fn.lineno}-{fn.end_lineno}")
PY
)
ok "$u4" ok "u4: for-each-ref appears only inside _read_state"

# ── e: one culprit, two windows ──────────────────────────────────────────────────────────────────────────────
scen e
mkt A in_progress; mkt B in_progress
arm A; arm B; code
chk A; ok "$rc" 3 "e: check A after one code commit → 3"
ok "$(trips A)|$(trips B)" "1|1" "e: … both windows' lines logged once"
ok "$(recf A task state)|$(recf A task closed)|$(recf B task state)|$(recf B task closed)" '"tripped"|true|"tripped"|false' "e: … A tripped/closed, B tripped/open"
chk B; ok "$rc" 3 "e: check B → 3"
ok "$(grep -c 'git-env trip' "$RO")" 2 "e: … the log line count unchanged"
before=$(cksum < "$RO")
ackc A "$(cur)"; ok "$rc" 3 "e: ack --slugs A (B unacked) → 3"
ok "$(cksum < "$RO")" "$before" "e: … and nothing is written"
ackc A,B "$(cur)"; ok "$rc" 0 "e: ack --slugs A,B --ref <cur> → 0"
ok "$(acks)" 1 "e: … one ack line"
arm A; ok "$rc" 0 "e: a fresh arm after the ack → 0"
chk A; ok "$rc" 0 "e: … and its check → 0"

# ── e2: hold order ───────────────────────────────────────────────────────────────────────────────────────────
scen e2
mkt A in_progress; mkt B in_progress; mkt C in_progress
arm A; arm B; arm C
rm -f "$THREAD_GIT_ENV_DIR/ro/A.task.json"
chk A; ok "$rc" 3 "e2: A's record deleted → check A 3"
has "$(grep 'git-env trip \[\[A\]\]' "$RO")" "task: record missing" "e2: … logged as record missing"
ok "$(recf B task state)|$(recf C task state)" '"armed"|"armed"' "e2: … B and C stay armed"
chk C; ok "$rc" 3 "e2: a clean check C under the hold → 3"
ok "$(recf C task state)" '"checked"' "e2: … still writes C's tombstone"
code
chk B; ok "$rc" 3 "e2: a code commit, then check B → 3"
ok "$(trips B)|$(recf B task closed)" "1|true" "e2: … B's line logged and B closed"
before=$(cksum < "$RO")
ackc A "$(cur)"; ok "$rc" 3 "e2: ack --slugs A → 3"
ok "$(cksum < "$RO")" "$before" "e2: … writing nothing"
ackc A,B "$(cur)"; ok "$rc" 0 "e2: ack --slugs A,B → 0"

# ── e3: a stale ref ──────────────────────────────────────────────────────────────────────────────────────────
scen e3
mkt A in_progress
arm A; code; X=$(cur); chk A; code; Y=$(cur)
ackc A "$X"; ok "$rc" 3 "e3: ack --ref X after the ref moved on to Y → 3"
ackc A absent; ok "$rc" 3 "e3: ack --ref absent → 3"
ackc A "$Y"; ok "$rc" 0 "e3: ack --ref Y → 0"
has "$(grep 'git-env ack' "$RO")" "refs/heads/master at $Y, core.bare false" "e3: … the ack line names Y"

# ── e4: a hidden trip ────────────────────────────────────────────────────────────────────────────────────────
scen e4
mkt A in_progress; mkt B in_progress
arm A; arm B; code; chk A
dellog 'git-env trip [[B]]'
ackc A "$(cur)"; ok "$rc" 3 "e4: B's line deleted by hand: ack --slugs A → 3"
ok "$(trips B)|$(acks)" "1|0" "e4: … B's line re-logged exactly once, no ack line"
ok "$(recf A task state)|$(recf B task state)" '"tripped"|"tripped"' "e4: … both records stay tripped"
scen e4b
mkt A in_progress; mkt B in_progress
arm A; arm B; rm -f "$THREAD_GIT_ENV_DIR/ro/A.task.json"
chk A; ok "$rc" 3 "e4b: A's record deleted → check A 3"
code
ackc A "$(cur)"; ok "$rc" 3 "e4b: a code commit, then ack --slugs A → 3"
ok "$(trips B)|$(recf B task state)|$(recf B task closed)" '1|"tripped"|false' "e4b: … its pass logs B, tripped/open"
ackc A,B "$(cur)"; ok "$rc" 0 "e4b: ack --slugs A,B → 0"
ok "$(recf B task state)|$(recf B task ref)" "\"armed\"|\"$(cur)\"" "e4b: … B re-baselined to the acked ref"

# ── e5: an own record already tripped ────────────────────────────────────────────────────────────────────────
scen e5
mkt A in_progress; mkt B in_progress
arm A; arm B; code
call; ok "$rc" 3 "e5: check-all after a code commit → 3"
ok "$(recf A task closed)|$(recf B task closed)" "false|false" "e5: … both tripped and open"
tripA=$(recf A task trip); code
chk A; ok "$rc" 3 "e5: a second commit, then check A → 3"
ok "$(grep -c 'git-env trip' "$RO")|$(recf A task closed)|$(recf A task trip)" "2|true|$tripA" "e5: … no new line, A closed, its trip unchanged"
dellog 'git-env trip [[A]]'
chk B; ok "$rc" 3 "e5: A's line deleted by hand, then check B → 3"
ok "$(trips A)|$(recf B task closed)" "1|true" "e5: … A's line re-logged once and B closed"

# ── f: fails closed ──────────────────────────────────────────────────────────────────────────────────────────
scen f
mkt A in_progress
mkdir -p "$S/plain"; mkro "$S/plain"
can arm --repo "$S/plain" --default master --slug A --kind task; ok "$rc" 2 "f: R not a git repo → arm 2"
mkro "$R"
mkdir -p "$S/locked"; chmod 555 "$S/locked"
THREAD_GIT_ENV_DIR="$S/locked/state" arm A; ok "$rc" 2 "f: an unwritable records dir → arm 2"
chmod 755 "$S/locked"
arm A; echo '{not json' > "$(recp A)"
chk A; ok "$rc" 3 "f: a corrupt record → check 3"
has "$(grep 'git-env trip' "$RO")" "record unreadable" "f: … logged as record unreadable"
scen f2
mkt A in_progress
arm A; code; chmod 444 "$RO"
chk A; ok "$rc" 2 "f: a read-only note → check 2"
ok "$(recf A task state)" '"tripped"' "f: … the record is left tripped"
chmod 644 "$RO"
call; ok "$rc" 3 "f: once the note is writable, check-all → 3"
ok "$(trips A)" 1 "f: … and re-logs the line"
python3 "$CAN" > /dev/null 2>&1; ok "$?" 2 "f: no verb → 2"
can arm --repo "$R" --default master --kind task; ok "$rc" 2 "f: arm without --slug → 2"
can arm --repo "$R" --default master --slug A --kind bogus; ok "$rc" 2 "f: an unknown --kind → 2"

# ── v: repo and default validation ───────────────────────────────────────────────────────────────────────────
scen v
mkt A in_progress
g init -q "$S/other"; g -C "$S/other" commit -q --allow-empty -m other
can arm --repo "$S/other" --default master --slug A --kind task; ok "$rc" 2 "v1: arm --repo <another repo> → 2"
has "$err" "is not this rollout's repo" "v1: … naming the rollout's repo"
arm A
can ack --repo "$R" --default main --slugs A --ref "$(cur)"; ok "$rc" 2 "v2: ack --default main against master records → 2"
ln -s "$R" "$S/link"; mkro "$S/link/"
chk A; ok "$rc" 0 "v3: a symlinked Project root with a trailing slash is accepted"
other_head=$(git -C "$S/other" rev-parse HEAD)
python3 "$CAN" restore --rollout "$RO" --repo "$S/other" --default master > /dev/null 2>&1
ok "$?|$(git -C "$S/other" rev-parse HEAD)" "2|$other_head" "v4: restore against another repo → 2, that repo unchanged"
mkro -
arm A; r1=$rc; chk A; r2=$rc; ackc A "$(cur)"; r3=$rc; rst; r4=$rc
ok "$r1|$r2|$r3|$r4" "2|2|2|2" "v5: no Project root: line → 2 for arm, check, ack and restore"
scen v6
mkt A in_progress
printf -- '\n## Git-env log\n\n- 2026-10-03T10:00:00+00:00 git-env trip [[A]] task: refs/heads/master %s→%s; repo %s\n' "$(cur)" "$(cur)" "$R" >> "$RO"
can ack --repo "$R" --default main --slugs A --ref "$(cur)"; ok "$rc" 2 "v6: trip lines only, ack --default main → 2"

# ── g: the hold outlives the records ─────────────────────────────────────────────────────────────────────────
scen g
mkt A in_progress; mkt C in_progress
arm A; rm -f "$(recp A)"; chk A
call; ok "$rc" 3 "g: the only record tripped; check-all → 3"
arm C; ok "$rc|$(recf C task state)" "3|<none>" "g: arm C under the hold → 3, no record written"
PR="$S/plugin"; mkdir -p "$PR/skills/execute/scripts" "$R/.claude"
ln -s "$CAN" "$PR/skills/execute/scripts/git-env-canary.py"
printf '#!/usr/bin/env bash\ntouch "%s/stub-ran"\n' "$S" > "$PR/skills/execute/scripts/merge-task.sh"; chmod +x "$PR/skills/execute/scripts/merge-task.sh"
awk '/^# thread:git-env-backoff/{on=1; next} /^# end thread:git-env-backoff/{on=0} on' "$SKILL" > "$S/backoff.tpl"
ok "$(grep -c 'check-all' "$S/backoff.tpl")|$(grep -c 'merge-task.sh' "$S/backoff.tpl")" "1|1" "g: the backoff snippet found in execute/SKILL.md"
python3 - "$S/backoff.tpl" "$S/backoff.sh" "$R" "$RO --tasks-dir $V" <<'PY'
import sys
src, dst, repo, ro = sys.argv[1:]
t = open(src).read().replace("<repoPath>", repo).replace("<rollout-note>", ro).replace("<the same four args>", "a b c d").replace("sleep 60", "sleep 0")
open(dst, "w").write(t)
PY
CLAUDE_PLUGIN_ROOT="$PR" bash "$S/backoff.sh" > /dev/null 2>&1; brc=$?
ok "$brc|$([ -e "$S/stub-ran" ] && echo ran || echo not-run)|$(cat "$R/.claude/merge-task.status" 2>/dev/null)" "3|not-run|failed:git-env:3" \
  "g: the backoff under a hold never runs merge-task.sh and leaves failed:git-env:3 (the trip row)"
# g2: a check-all that fails for another reason (a lock timeout, exit 2) records its own exit, so step 4 routes it
# to `git-env canary failed`, never to the trip reason.
scen g2
mkt A in_progress
PR="$S/plugin"; mkdir -p "$PR/skills/execute/scripts" "$R/.claude" "$THREAD_GIT_ENV_DIR"
ln -s "$CAN" "$PR/skills/execute/scripts/git-env-canary.py"
printf '#!/usr/bin/env bash\ntouch "%s/stub-ran"\n' "$S" > "$PR/skills/execute/scripts/merge-task.sh"; chmod +x "$PR/skills/execute/scripts/merge-task.sh"
python3 - "$TMP/g/backoff.tpl" "$S/backoff.sh" "$R" "$RO --tasks-dir $V" <<'PY'
import sys
src, dst, repo, ro = sys.argv[1:]
t = open(src).read().replace("<repoPath>", repo).replace("<rollout-note>", ro).replace("<the same four args>", "a b c d").replace("sleep 60", "sleep 0")
open(dst, "w").write(t)
PY
holder 3
THREAD_GIT_ENV_LOCK_TIMEOUT=1 CLAUDE_PLUGIN_ROOT="$PR" bash "$S/backoff.sh" > /dev/null 2>&1; brc=$?
wait "$hp"
ok "$brc|$([ -e "$S/stub-ran" ] && echo ran || echo not-run)|$(cat "$R/.claude/merge-task.status" 2>/dev/null)" "2|not-run|failed:git-env:2" \
  "g2: a lock timeout in the backoff's check-all never runs merge-task.sh and leaves failed:git-env:2 (canary failed)"
rows=$(grep -E '^   \| `failed:git-env:' "$SKILL")
has "$rows" '`failed:git-env:3` | Halt with `reason="git-env trip: the shared checkout changed"`' "g2: step 4 routes failed:git-env:3 to the trip reason"
has "$rows" '`failed:git-env:<any other rc>` | Halt with `reason="git-env canary failed"`' "g2: … and any other rc to git-env canary failed"

# ── h: concurrency ───────────────────────────────────────────────────────────────────────────────────────────
scen h
mkt A in_progress; mkt B in_progress
arm A; arm B; code
python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > /dev/null 2>&1 & pa=$!
python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug B --kind task > /dev/null 2>&1 & pb=$!
wait "$pa"; ra=$?; wait "$pb"; rb=$?
ok "$ra|$rb" "3|3" "h: two concurrent checks each exit 3"
ok "$(trips A)|$(trips B)" "1|1" "h: … each line appears once"
ok "$(recf A task state)$(recf A task closed)|$(recf B task state)$(recf B task closed)" '"tripped"true|"tripped"true' "h: … both records tripped and closed"
dellog 'git-env trip [[B]]'
call; ok "$rc|$(trips B)" "3|1" "h: a trip line deleted by hand is re-appended once by the next check-all"

# ── i: ack refuses while bare; restore clears bare at both levels ────────────────────────────────────────────
scen i
mkt A in_progress
arm A; g -C "$R" config --local extensions.worktreeConfig true; g -C "$R" config --local core.bare true; g -C "$R" config --worktree core.bare true
chk A; ok "$rc" 3 "i: a bare flip → check 3"
ackc A "$(cur)"; ok "$rc" 3 "i: ack while R reads bare → 3"
ok "$(acks)" 0 "i: … no ack line"
rst; ok "$rc" 0 "i: restore → 0"
ok "$(git -C "$R" rev-parse --is-bare-repository)|$(git -C "$R" config --local --get core.bare)|$(git -C "$R" config --worktree --get core.bare || echo unset)" "false|false|unset" \
  "i: … bare cleared in the local and the worktree config"
ackc A "$(cur)"; ok "$rc" 0 "i: then ack --ref <cur> → 0"

# ── j: restore ───────────────────────────────────────────────────────────────────────────────────────────────
scen j
g -C "$R" config --local core.bare true
rst; ok "$rc|$(git -C "$R" rev-parse --is-bare-repository)" "0|false" "j: HEAD on master, a bare flip only → 0, no --drop-local needed"
code; c=$(cur); g -C "$R" checkout -q -b side origin/master
rst; ok "$rc|$(cur)" "2|$c" "j: HEAD elsewhere, a code commit on master, no --drop-local → 2, nothing moved"
rst --drop-local "$c"; ok "$rc|$(cur)" "0|$(cur origin/master)" "j: … with --drop-local <cur> → update-ref to origin/master"
g -C "$R" checkout -q master; code a.txt; c=$(cur); echo dirty >> "$R/a.txt"
rst --drop-local "$c"; ok "$rc|$(cur)" "2|$c" "j: an overlapping dirty change → 2, nothing moved"
scen jm
g -C "$R" update-ref -d refs/heads/master
rst; ok "$rc|$(git -C "$R" rev-parse --verify -q refs/heads/master || echo absent)" "2|absent" "m: the default deleted with HEAD on it → 2, no ref created"
has "$err" "update-ref refs/heads/master" "m: … printing the manual commands"
scen j2
g -C "$R" checkout -q -b forge; code; f=$(cur forge); g -C "$R" checkout -q master
g -C "$R" update-ref refs/remotes/origin/master "$f"
rst; ok "$rc|$(cur origin/master)" "0|$(git -C "$O" rev-parse master)" "j2: a forged origin/master is overwritten by restore's fetch"
scen j3
cpath THREAD.md; c=$(cur)
rst; ok "$rc|$(cur)|$(git -C "$R" config --local --get core.bare)" "2|$c|false" "j3: a local close-out commit, no --drop-local → 2, refs and core.bare unchanged"
has "$err" "close-out § 2.7 wants landed" "j3: … the commit listed and marked as a close-out"
has "$err" "--drop-local $c" "j3: … naming the flag to pass"
rst --drop-local 0000000000000000000000000000000000000000; ok "$rc|$(cur)" "2|$c" "j3: --drop-local <a wrong sha> → 2"
rst --drop-local "$c"; ok "$rc|$(cur)" "0|$(cur origin/master)" "j3: --drop-local <cur> → 0, master equals origin/master"
has "$err" "old master was $c" "j3: … printing the old sha"
rescue=$(printf '%s\n' "$err" | sed -n 's/.*recover with: //p')
has "$rescue" "git-env-rescue-" "j3: … and the git-env-rescue command"
(eval "$rescue") > /dev/null 2>&1
ok "$(git -C "$R" for-each-ref --format='%(objectname)' 'refs/heads/git-env-rescue-*')" "$c" "j3: running it recovers the commit"
scen j4
code; c=$(cur)
rst --drop-local "$c"; ok "$rc|$(cur)|$(git -C "$R" status --porcelain)" "0|$(cur origin/master)|" "j4: a code commit, --drop-local <cur> → 0, master equals origin/master, tree clean"
# j5: the keep-and-ack route with a bare flip and a pending close-out. restore's drop guard must not leave R bare,
# or ack's bare refusal and restore's drop guard send each other round forever.
scen j5
mkt A in_progress
arm A; cpath THREAD.md; b=$(cur); g -C "$R" config --local core.bare true
chk A; ok "$rc" 3 "j5: a bare flip plus a local THREAD.md commit → check 3"
rst; ok "$rc|$(cur)|$(git -C "$R" rev-parse --is-bare-repository)" "2|$b|false" "j5: restore, no --drop-local → 2 at the drop guard, core.bare cleared, B left at the close-out"
has "$err" "ack --ref $b" "j5: … pointing at ack to keep it"
ackc A "$b"; ok "$rc" 0 "j5: then ack --ref <B> → 0"
has "$(grep 'git-env ack' "$RO")" "refs/heads/master at $b, core.bare false" "j5: … the ack line names B"
# j6: --bare-only clears the bareness and moves no ref, even one behind origin (repair § 3e option (b)).
scen j6
g -C "$R" config --local extensions.worktreeConfig true; g -C "$R" config --worktree core.bare true
g -C "$R" update-ref refs/heads/master "$(cur HEAD~1)"; b=$(cur)
rst --bare-only; ok "$rc|$(cur)|$(git -C "$R" rev-parse --is-bare-repository)|$(git -C "$R" config --worktree --get core.bare || echo unset)" "0|$b|false|unset" \
  "j6: restore --bare-only → 0, core.bare cleared at both levels, master left behind origin"
rst --bare-only --drop-local "$b"; ok "$rc" 2 "j6: --bare-only with --drop-local → 2"

# ── k: the env scrub ─────────────────────────────────────────────────────────────────────────────────────────
scen k
mkt A in_progress
g init -q "$S/decoy"; g -C "$S/decoy" commit -q --allow-empty -m decoy; dh=$(git -C "$S/decoy" rev-parse HEAD)
env GIT_DIR="$S/decoy/.git" GIT_CONFIG_PARAMETERS="'core.bare=true'" python3 "$CAN" arm --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > /dev/null 2>&1; krc=$?
ok "$krc|$(recf A task ref)|$(recf A task bare)" "0|\"$(cur)\"|false" "k: GIT_DIR and GIT_CONFIG_PARAMETERS on the invocation: the canary reads R, not bare"
env GIT_DIR="$S/decoy/.git" GIT_CONFIG_PARAMETERS="'core.bare=true'" python3 "$CAN" check --rollout "$RO" --tasks-dir "$V" --repo "$R" --default master --slug A --kind task > /dev/null 2>&1
ok "$?|$(git -C "$S/decoy" rev-parse HEAD)" "0|$dh" "k: … its check is clean and the decoy is unchanged"

# ── l: retire ────────────────────────────────────────────────────────────────────────────────────────────────
scen l
mkt A in_progress
arm A; code
can retire; ok "$rc|$(trips A)" "3|1" "l: a leftover differing record → retire's check-all 3, the trip logged"
ok "$([ -d "$THREAD_GIT_ENV_DIR/ro" ] && echo kept)" kept "l: … nothing deleted"
scen l2
mkt A in_progress
arm A; chk A
can retire; ok "$rc" 0 "l: retire when clean → 0"
ok "$([ -d "$THREAD_GIT_ENV_DIR/ro" ] && echo dir || echo gone)|$([ -f "$THREAD_GIT_ENV_DIR/ro.retired" ] && echo y)|$([ -f "$THREAD_GIT_ENV_DIR/ro.lock" ] && echo y)" \
  "gone|y|y" "l: … removes the dir, writes .retired and keeps the .lock"

# ── n: arm compares every record ─────────────────────────────────────────────────────────────────────────────
scen n
mkt A in_progress; mkt B in_progress
arm A; code
arm B; ok "$rc|$(trips A)|$(recf B task state)" "3|1|<none>" "n: A armed, the ref moves, arm B → 3, A's trip logged, no B record"

# ── q: closed windows ────────────────────────────────────────────────────────────────────────────────────────
scen q1
mkt A in_progress
arm A; code; chk A; ackc A "$(cur)"; code
call; ok "$rc|$(recf A task state)" '0|"acked"' "q1: a trip, an ack, then a commit with no window open → check-all 0, the record acked"
scen q2
mkt A in_progress
arm A; setst A blocked
call; ok "$rc|$(recf A task state)" '0|"checked"' "q2: an orphan (its note blocked) → check-all 0, checked"
code; call; ok "$rc" 0 "q2: … a later commit → 0"
scen q3
mkt A in_progress
arm A; code; setst A blocked
call; ok "$rc|$(recf A task state)|$(recf A task closed)" '3|"tripped"|true' "q3: the commit first, then the orphan → 3 (compared once)"
scen q4
mkt A review 'pr: https://github.com/o/r/pull/1' 'integrating: 2026-10-03T10:00+00:00'
arm A integrate
python3 - "$V/A.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write("".join(l for l in t.splitlines(True) if not l.startswith("integrating:")))
PY
call; ok "$rc|$(recf A integrate state)" '0|"checked"' "q4: an integrate window closes when integrating: is removed"
scen q5
mkt A in_progress; mkt B in_progress
arm A; arm B; code; chk A; ackc A,B "$(cur)"
ok "$(recf B task state)" '"armed"' "q5: an ack with B's window still open re-baselines it"
chk B; ok "$rc" 0 "q5: … and B's later clean check → 0"

# ── s: --tasks-dir ───────────────────────────────────────────────────────────────────────────────────────────
scen s
mkt A in_progress
for verb in arm check check-all ack retire; do
  case $verb in
    arm|check) TD="$S/nope" can "$verb" --repo "$R" --default master --slug A --kind task ;;
    ack) TD="$S/nope" can ack --repo "$R" --default master --slugs A --ref "$(cur)" ;;
    *) TD="$S/nope" can "$verb" ;;
  esac
  ok "$rc" 2 "s: a nonexistent --tasks-dir → $verb 2"
done
mkdir -p "$S/empty"
arm A; TD="$S/empty" call
ok "$rc|$(recf A task state)" '0|"armed"' "s: a tasks dir lacking A's note → A holds (stays armed)"
has "$err" "WARN: owner note A not found under $S/empty" "s: … with the WARN"
setst A blocked
TD="$S/empty" call; ok "$rc|$(recf A task state)" '0|"armed"' "s: q2 with a wrong existing dir → A stays armed"

# ── t: the lock ──────────────────────────────────────────────────────────────────────────────────────────────
scen t
mkt A in_progress
arm A; chk A; can retire
arm A; ok "$rc|$([ -d "$THREAD_GIT_ENV_DIR/ro" ] && echo dir || echo none)" "2|none" "t: retire, then arm → 2, no dir recreated"
has "$err" "rollout retired" "t: … naming the retirement"
ok "$([ -f "$THREAD_GIT_ENV_DIR/ro.lock" ] && echo y)" y "t: the .lock survives retire"
scen t2
mkt A in_progress
mkdir -p "$THREAD_GIT_ENV_DIR"
holder 3
THREAD_GIT_ENV_LOCK_TIMEOUT=1 call; ok "$rc" 2 "t: a held lock with THREAD_GIT_ENV_LOCK_TIMEOUT=1 → check-all 2"
has "$err" "timed out" "t: … a timeout"
wait "$hp"
holder 1
THREAD_GIT_ENV_LOCK_TIMEOUT=10 call; ok "$rc" 0 "t: a holder that releases after 1 s → check-all waits and returns 0"
wait "$hp"

# ── o: end to end ────────────────────────────────────────────────────────────────────────────────────────────
for variant in ref bare; do
  scen "o-$variant"
  mkt A in_progress; mkt Q open
  printf -- '- [[Q]]\n' >> "$RO"
  arm A
  if [ "$variant" = ref ]; then code; else g -C "$R" config --local core.bare true; fi
  chk A; ok "$rc" 3 "o ($variant): the culprit acts; check A → 3"
  nx=$(python3 "$RR" next --rollout "$RO" --tasks-dir "$V" --running A)
  ok "$(printf '%s' "$nx" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["halt"], d["start"], d["restart"], [t["slug"] for t in d["gitEnvHold"]])')" \
    "git-env [] [] ['A']" "o ($variant): next → halt git-env, start/restart []"
  rm -f "$S/merged"
  python3 "$CAN" check-all --rollout "$RO" --tasks-dir "$V" > /dev/null 2>&1 && touch "$S/merged"
  ok "$([ -e "$S/merged" ] && echo merged || echo held)" held "o ($variant): the pre-merge check-all → 3, so the merge never runs"
done

# ── p: the snippet's guard ───────────────────────────────────────────────────────────────────────────────────
awk '/^# thread:git-env-canary/{on=1; next} /^# end thread:git-env-canary/{on=0} on' "$SKILL" > "$TMP/canary.sh"
ok "$(grep -c 'git-env-canary.py' "$TMP/canary.sh")" 2 "p: the git-env-canary snippet found in execute/SKILL.md"
env -u CLAUDE_PLUGIN_ROOT bash "$TMP/canary.sh" > /dev/null 2> "$TMP/p.err"; prc=$?
ok "$prc" 2 "p: the snippet with CLAUDE_PLUGIN_ROOT unset → 2"
has "$(cat "$TMP/p.err")" "not found" "p: … naming the missing script"

echo
if [ "$fail" -eq 0 ]; then echo "git-env-canary: ALL PASS"; else echo "git-env-canary: FAILED"; fi
exit "$fail"
