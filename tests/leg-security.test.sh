#!/usr/bin/env bash
# skills/execute/scripts/leg.py: a serial rollout's Legs, part 4 of 4: the Security check, mcp and listing (L19-L21; L1-L16 are tests/leg.test.sh).
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
#   L21  a Leg lists its chain instead of launching one (P44-4, ADR 0076 d4): a handoff-closed Leg is its chain's
#        session (`closing Leg N`) until its hand-over; handed --listed logs `hand-over: listed` and stamps an unstamped
#        note; its form rule, a missing Chain copy's unlisted line; restarted --listed on a stopped, closing or handed
#        chain, refused beside an open Leg, idempotent, retired by a began; a handed after a logged hand-over writes
#        nothing and prints the logged form's line; a manual hand-over keeps a stamped chain off the list until repair
#        lists it; every new status line matches the Stop hook's STATUS_RE; --dry-run of handed --listed and
#        restarted --listed writes nothing, listed and unlisted null (L21p); restarted --listed over a pending restart:
#        another session's is exit 3, its own session's is its update, no --replace (L21q)
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
export THREAD_HEAT_LEVEL=0   # the Heat hold's reading (a fresh claim's), pinned: a hot Mac never flips an assertion
# L19c's and L21d's Chain copies stay in temp (cscen points it at each scenario's own dir), and so does the launch-alias
# file a copy's manual launch line reads (absent: cscen removes it). No case here runs a completion verify.
export THREAD_CHAIN_COPY_DIR="$TMP/chains" THREAD_LAUNCH_ALIASES="$TMP/aliases.zsh"
mkdir -p "$TMPDIR" "$TMP/bin"
# A fake gh and ssh: any call is logged and fails, so a test can assert no network was touched.
printf '#!/bin/sh\necho "gh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/gh"
printf '#!/bin/sh\necho "ssh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/fake-ssh"
chmod +x "$TMP/bin/gh" "$TMP/bin/fake-ssh"
export PATH="$TMP/bin:$PATH" GIT_SSH_COMMAND="$TMP/bin/fake-ssh"
: > "$TMP/net.log"
NOW=2026-10-20T10:00+00:00

. tests/lib/leg-fixtures.sh   # the shared helpers (scen, mkro, mkt, leg, q, the repo helpers, cscen, lscen, ...)

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
subst "$T/$RO.md" "security_checks: false" "security_checks: true"   # a value other than true or false: L19d7
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
import importlib.util, signal, sys, time, types
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
rc, out, err, cut = leg.run_scan([sys.executable, "-c", "import time; time.sleep(60)"], 1)
eq((cut, rc), (True, -signal.SIGINT), "run_scan cuts a sleeping child past its timeout, by its SIGINT")
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

# ════ L21: a Leg lists its chain instead of launching one (P44-4, ADR 0076 d4) ═════════════════════════════════════
L21_LINES="$TMP/l21-status-lines"; : > "$L21_LINES"
keep21() { q 'd["status_line"]' >> "$L21_LINES"; }
stamp21() { subst "$T/$RO.md" 'status: open' $'status: open\nstart: unattended'; }
two21() { mkro '' $(rows cc-demo "$F" '`ext:x`' t1 t2); mkt t1; mkt t2; }
# (a) a stamped chain: its handoff-closed Leg is its session until handed --listed lists it
scen l21a; two21; stamp21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff
leg status
ok "$(q 'd["chain"]')|$(q 'd["listed"]')|$(q 'd["restart"]["blockedBy"]')" "awaiting-successor|False|closing Leg 1 (session s1)" \
   "L21a: after close --outcome handoff: awaiting-successor, not listed, its closing Leg the blocker"
has "$(q 'd["unlisted"]')" "its Leg session stands (closing Leg 1" "L21a: … unlisted: its closing Leg is its session"
leg handed --listed
ok "$rc|$(q 'd["status_line"]')" "0|ROLLOUT-STATUS: $RO merged=1/2 running=0 state=done reason=\"listed Leg 2 on the Waiting list\"" \
   "L21a: handed --listed prints the listed line"
keep21
ok "$(q 'd["listed"]')|$(q 'd["unlisted"]')|$(q 'd["stamped"]')|$(logn 'Leg 1 hand-over: listed$')" "True|None|False|1" \
   "L21a: … listed, the stamp already there, and hand-over: listed logged"
leg status
ok "$(q 'd["restart"]["blockedBy"]')|$(q 'd["listed"]')|$(q 'd["unlisted"]')|$(q 'd["legs"][0]["handover"]')" "None|True|None|listed" \
   "L21a: status then reads nothing blocking, and the chain listed"
snap; leg handed --listed; ok "$rc|$(q 'd["stamped"]')" "0|False" "L21a: a second handed --listed"; same "L21a: a second handed --listed"
# (b) an unstamped chain: handed --listed stamps it in the same save
scen l21b; two21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff
leg handed --listed
ok "$rc|$(q 'd["stamped"]')|$(q 'd["listed"]')|$(fm "$RO" start)" "0|True|True|unattended" "L21b: handed --listed stamps an unstamped chain, and lists it"
# (c) exactly one form
for v in "" "--listed --started x" "--manual x --listed"; do
  snap; leg handed $v; ok "$rc|$out" "2|" "L21c: handed ${v:-with no form} is a usage error"; same "L21c: handed ${v:-with no form}"
done
# (d) a missing Chain copy: listed false, the halted not-listed line
cscen l21d
R="$S/r"; crepo "$R" https://github.com/o/r21d.git; C="$S/chains/r-$RO"; export CWD="$C"
mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`" "t2~cc-r~$R~\`repo:$R//b.txt\`"; mkt t1; mkt t2
CWD="$R" leg copies; leg begin --cwd "$C"; finish t1; leg close --outcome handoff --cwd "$C"
mv "$C" "$S/moved"
CWD="$R" leg handed --listed
ok "$rc|$(q 'd["listed"]')|$(logn 'Leg 1 hand-over: listed$')" "0|False|1" "L21d: with its Chain copy gone, the hand-over is logged but not listed"
has "$(q 'd["status_line"]')" "state=halted reason=\"hand-over not listed: blocked by chain copy missing: $C" "L21d: … its halted line names why"
keep21
mv "$S/moved" "$C"; unset CWD
# (e) restarted --listed on a stopped chain: the line and the stamp, read as a listed restart
scen l21e; two21
leg begin --cwd "$F"; finish t1; leg close --outcome stopped --reason "out of time"
SESS=r1 leg restarted --leg 2 --listed
ok "$rc|$(q 'd["recorded"]')|$(q 'd["restarted"]["how"]')|$(q 'd["listed"]')|$(fm "$RO" start)" "0|True|listed|True|unattended" \
   "L21e: restarted --listed on a stopped chain records the restart and stamps the note"
ok "$(logn 'restart: Leg 2 listed$')" 1 "L21e: … logging restart: Leg 2 listed"
leg status
ok "$(q 'd["chain"]')|$(q 'd["restarted"]["how"]')|$(q 'd["listed"]')|$(q 'd["restart"]["blockedBy"]')" "restarting|listed|True|None" \
   "L21e: status reads restarting (how listed), listed, nothing blocking"
hasnt "$(q 'd["needsYou"]')" "restart of Leg 2" "L21e: … and a listed restart is no needs-you item"
# (i) the same line again records nothing
snap; SESS=r2 leg restarted --leg 2 --listed; ok "$rc|$(q 'd["recorded"]')" "0|False" "L21i: the same --listed line again"; same "L21i: --listed again"
# (j) a later began retires it
SESS=s2 leg begin --cwd "$F"; ok "$rc|$(q 'd["leg"]')" "0|2" "L21j: Leg 2 begins"
leg status
ok "$(q 'd["restarted"]')|$(q 'd["chain"]')|$(q 'd["listed"]')|$(q 'd["unlisted"]')" "None|live|False|its Leg session stands (open Leg 2)" \
   "L21j: … its began retires the listed restart: live, its open Leg off the list"
# (f) a handoff with no hand-over line, then restarted --listed: the closing session clears
scen l21f; two21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff
SESS=r1 leg restarted --leg 2 --listed; ok "$rc|$(q 'd["listed"]')" "0|True" "L21f: restarted --listed over a Leg that died before its hand-over"
leg status
ok "$(q 'd["restart"]["blockedBy"]')|$(q 'd["listed"]')|$(q 'd["chain"]')" "None|True|restarting" "L21f: … the closing session clears"
# (g) a handoff to a started session, then restarted --listed: the handover started session clears
scen l21g; two21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff; leg handed --started sess-x
leg status
ok "$(q 'd["restart"]["blockedBy"]')|$(q 'd["unlisted"]')" "handover started sess-x|no start: unattended" "L21g: a started hand-over blocks the restart"
stamp21; leg status
ok "$(q 'd["unlisted"]')" "its Leg session stands (handover started sess-x)" "L21g: … and, stamped, is its Leg session"
SESS=r1 leg restarted --leg 2 --listed
leg status
ok "$(q 'd["restart"]["blockedBy"]')|$(q 'd["listed"]')" "None|True" "L21g: restarted --listed clears the started session"
# (h) an open Leg: restarted --listed never lists a take-over (only a lapsed Leg lease lists one, P36-15: leg.test.sh L13c)
scen l21h; two21
leg begin --cwd "$F"; finish t1
snap; SESS=r1 leg restarted --leg 2 --listed
ok "$rc" 1 "L21h: restarted --listed beside an open Leg is exit 1"; has "$err" "an open Leg stands (Leg 1)" "L21h: … naming it"
same "L21h: an open Leg"
# (k)-(m) a handed after a logged hand-over writes nothing and prints the logged form's line
scen l21k; two21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff; leg handed --started sess-1
snap; leg handed --listed
ok "$rc|$(q 'd["stamped"]')|$(fm "$RO" start)" "0|False|<none>" "L21k: handed --listed after --started stamps nothing"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=1/2 running=0 state=done reason=\"handed off to Leg 2\"" "L21k: … and prints the started line"
same "L21k: handed --listed after --started"
scen l21l; two21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff; leg handed --manual "no host tool"
snap; leg handed --listed
ok "$rc|$(q 'd["stamped"]')" "0|False" "L21l: handed --listed after --manual"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=1/2 running=0 state=halted reason=\"manual handoff: Leg 2 in cc-demo from $F\"" \
   "L21l: … prints the manual line"
same "L21l: handed --listed after --manual"
scen l21m; two21; stamp21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff; leg handed --listed
snap; leg handed --manual x
ok "$rc|$(q 'd["status_line"]')|$(q 'd["handover"]')" "0|ROLLOUT-STATUS: $RO merged=1/2 running=0 state=done reason=\"listed Leg 2 on the Waiting list\"|listed" \
   "L21m: handed --manual after --listed prints the listed line"
same "L21m: handed --manual after --listed"
# (n) a manual hand-over keeps a stamped chain off the list until repair lists it
scen l21n; two21; stamp21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff; leg handed --manual "no host tool"
keep21
leg status
ok "$(q 'd["listed"]')|$(q 'd["unlisted"]')|$(q 'd["restart"]["blockedBy"]')" "False|a manual hand-over stands (Leg 1: no host tool)|None" \
   "L21n: a stamped chain after a manual hand-over is not listed, and nothing blocks its restart"
has "$(q 'd["needsYou"]')" "manual hand-over: start Leg 2 in" "L21n: … its paste-ready prompt a needs-you item"
SESS=r1 leg restarted --leg 2 --listed
leg status
ok "$(q 'd["listed"]')|$(q 'd["restarted"]["how"]')" "True|listed" "L21n: restarted --listed lists it"
hasnt "$(q 'd["needsYou"]')" "manual hand-over" "L21n: … and the manual hand-over item goes: a paste would double-start it"
# (p) --dry-run: handed --listed and restarted --listed write nothing, their listed and unlisted null
scen l21p; two21
leg begin --cwd "$F"; finish t1; leg close --outcome handoff
snap; leg handed --listed --dry-run
ok "$rc|$(q 'd["listed"]')|$(q 'd["unlisted"]')|$(q 'd["stamped"]')|$(q 'd["handover"]')|$(q 'd["dryRun"]')" "0|None|None|False|None|True" \
   "L21p: handed --listed --dry-run: listed and unlisted null, nothing stamped, no hand-over logged"
ok "$(q 'd["status_line"]')" "ROLLOUT-STATUS: $RO merged=1/2 running=0 state=done reason=\"listed Leg 2 on the Waiting list\"" \
   "L21p: … the passed form's line"
same "L21p: handed --listed --dry-run"
snap; SESS=r1 leg restarted --leg 2 --listed --dry-run
ok "$rc|$(q 'd["listed"]')|$(q 'd["unlisted"]')|$(q 'd["recorded"]')|$(q 'd["restarted"]')|$(q 'd["dryRun"]')" "0|None|None|False|None|True" \
   "L21p: restarted --listed --dry-run: listed and unlisted null, nothing recorded"
ok "$(fm "$RO" start)|$(logn 'restart: Leg 2')" "<none>|0" "L21p: … no stamp and no restart line"
same "L21p: restarted --listed --dry-run"
# (q) restarted --listed over a standing pending restart: another session's is exit 3; its own session's is its update,
# written with no --replace
scen l21q; two21
leg begin --cwd "$F"; finish t1; leg close --outcome stopped --reason "out of time"
SESS=r1 leg restarted --leg 2 --pending; ok "$rc|$(q 'd["restarted"]["how"]')" "0|pending" "L21q: r1's --pending stands"
snap; SESS=r2 leg restarted --leg 2 --listed
ok "$rc" 3 "L21q: r2's --listed over r1's pending restart is exit 3"; has "$err" "a restart of Leg 2 stands (pending" "L21q: … naming it"
same "L21q: r2 --listed over r1's pending"
SESS=r1 leg restarted --leg 2 --listed
ok "$rc|$(q 'd["recorded"]')|$(q 'd["restarted"]["how"]')|$(q 'd["listed"]')|$(fm "$RO" start)" "0|True|listed|True|unattended" \
   "L21q: r1's own --listed over its pending restart is its update: written with no --replace, stamped and listed"
ok "$(logn 'restart: Leg 2 pending (session r1)$')|$(logn 'restart: Leg 2 listed$')" "1|1" "L21q: … its listed line after the pending one"
leg status
ok "$(q 'd["restarted"]["how"]')|$(q 'd["restart"]["blockedBy"]')|$(q 'd["listed"]')" "listed|None|True" \
   "L21q: status reads the listed restart standing, nothing blocking, the chain listed"
# (o) the new status lines match the Stop hook's STATUS_RE
ok "$(grep -c . "$L21_LINES")" 3 "L21o: three status lines collected (listed, not listed, manual)"
bad=$(python3 - "$HOOK" "$L21_LINES" <<'PY'
import importlib.util, re, sys
spec = importlib.util.spec_from_file_location("drv", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for line in open(sys.argv[2]).read().splitlines():
    if not re.fullmatch(m.STATUS_RE.pattern + r'(?: reason="[^"]*")?', line) or "state=running" in line:
        print(line)
PY
)
ok "$bad" "" "L21o: every new hand-over status line matches the Stop hook's STATUS_RE, and none is state=running"

echo
if [ "$fail" -eq 0 ]; then echo "leg-security.test.sh: ALL PASS"; else echo "leg-security.test.sh: FAILED"; fi
exit "$fail"
