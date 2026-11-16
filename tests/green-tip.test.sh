#!/usr/bin/env bash
# skills/_shared/scripts/green-tip.py, executed (ADR 0084 d1 and Decided for you 11; p54-6): the live target of a repo,
# its Green tip. GT1 a repo that publishes nothing; GT2 a recorded Green tip; GT3 gh's three answers and its exact argv;
# GT4 the step-back; GT5 GT6 an absent ref; GT7 an unreachable one (a stale fetched copy ignored); GT8 not an ancestor;
# GT9 the live-checkout rule; GT10 --no-write; GT11 a corrupt record; GT12 usage, an unreadable origin and an internal
# failure; GT13 the 15-minute negative answer; GT14 the GitHub URL forms (landing-register.py's); GT15 the inner bounds;
# GT16 an outer kill reaps every child; GT17 a locked record; GT18 waits. Origins are git@github.com:o/<r>.git,
# served from $SRV/o/<r>.git by an inline ssh stub on PATH (GIT_SSH_COMMAND unset, so the resolver's BatchMode rule
# reaches it); an inline gh stub answers from a file and logs its argv. Hermetic: HOME, XDG_STATE_HOME and the record
# live under mktemp; global/system git config is ignored, and git never guesses an identity (user.useConfigOnly), so a
# commit made without g fails on every OS, as on a CI runner whose user has no name;
# never the network, never the real gh.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset GIT_SSH_COMMAND GIT_SSH CDPATH
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true
root=$(pwd -P)
GT="$root/skills/_shared/scripts/green-tip.py"
LR="$root/skills/_shared/scripts/landing-register.py"

tmp=$(mktemp -d); tmp=$(cd "$tmp" && pwd -P)
holders=()
cleanup() { local p; for p in ${holders[@]+"${holders[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "$tmp"; }
trap cleanup EXIT
export HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" THREAD_GREEN_TIP_FILE="$tmp/rec.json"
export SRV="$tmp/srv" LOG_SSH="$tmp/ssh.log" LOG_GH="$tmp/gh.log" GH_ANSWER="$tmp/gh.answer" HANG_PID="$tmp/hang.pid"
mkdir -p "$HOME" "$tmp/bin" "$SRV/o" "$tmp/w"; : > "$LOG_SSH"; : > "$LOG_GH"
cat > "$tmp/bin/ssh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$LOG_SSH"
case ${FAKE:-ok} in
  fail) echo "ssh: connect to host github.com port 22: Connection refused" >&2; exit 255 ;;
  hang) echo $$ > "$HANG_PID"; exec sleep 120 ;;
esac
cmd=${!#}; verb=${cmd%% *}; p=${cmd#* }; p=${p#\'}; p=${p%\'}; p=${p#/}
exec "$verb" "$SRV/$p"
EOF
cat > "$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
( IFS='|'; printf 'GH_PROMPT_DISABLED=%s %s\n' "${GH_PROMPT_DISABLED:-}" "$*" ) >> "$LOG_GH"
case ${GH_MODE:-ok} in
  hang) echo $$ > "$HANG_PID"; exec sleep 120 ;;
  fail) echo "gh: HTTP 401: Bad credentials" >&2; exit 1 ;;
esac
cat "$GH_ANSWER"
EOF
chmod +x "$tmp/bin/ssh" "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }
lacks() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
gone() {  # gone <pid> <label>: gone within 5 s; no pid recorded is a FAIL
  [ -n "$1" ] || { ok "no pid recorded" gone "$2"; return; }
  local i=0; while kill -0 "$1" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
  ok "$(kill -0 "$1" 2>/dev/null && echo alive || echo gone)" gone "$2"
}
YML='name: full suite
jobs:
  shard:
    runs-on: ubuntu-latest
  green-tip:
    name: publish the Green tip
    env:
      GREEN_REF: refs/thread/green'
# srv <name> [yml]: a bare server o/<name> with one commit (yml or not), its seed, and W, a clone over the fake ssh
srv() {
  g init -q --bare "$SRV/o/$1.git"; g clone -q "$SRV/o/$1.git" "$tmp/seed-$1" 2>/dev/null
  echo base > "$tmp/seed-$1/a.txt"
  if [ "${2:-}" = yml ]; then mkdir -p "$tmp/seed-$1/.github/workflows"; printf '%s\n' "$YML" > "$tmp/seed-$1/.github/workflows/full-suite.yml"; fi
  g -C "$tmp/seed-$1" add -A; g -C "$tmp/seed-$1" commit -qm base; g -C "$tmp/seed-$1" push -q origin master 2>/dev/null
  W="$tmp/w/$1"; g clone -q "git@github.com:o/$1.git" "$W" 2>/dev/null
}
push() { echo "$3" > "$tmp/seed-$1/$2"; g -C "$tmp/seed-$1" add -A; g -C "$tmp/seed-$1" commit -qm "$2"; g -C "$tmp/seed-$1" push -q origin master 2>/dev/null; git -C "$tmp/seed-$1" rev-parse HEAD; }
green() { git --git-dir "$SRV/o/$1.git" update-ref refs/thread/green "$2"; }
fetch() { git -C "$1" fetch -q origin master 2>/dev/null; }
# rec <key> <sha>…: a record with these verified commits (newest first), nothing else
rec() {
  python3 - "$THREAD_GREEN_TIP_FILE" "$@" <<'PY'
import json, sys
f, key, shas = sys.argv[1], sys.argv[2], sys.argv[3:]
json.dump({"v": 1, "repos": {key: {"verified": [{"sha": s, "at": "2026-11-01T10:00:00+11:00", "by": "test"} for s in shas],
                                   "unverified": []}}}, open(f, "w"))
PY
}
rv() { python3 -c 'import json,sys; e=json.load(open(sys.argv[1]))["repos"].get(sys.argv[2], {}); print(eval(sys.argv[3], {"e": e}))' "$THREAD_GREEN_TIP_FILE" "$@" 2>&1; }
gt() { python3 "$GT" target --repo "$W" --branch master "$@"; }
js() { python3 "$GT" target --repo "$W" --branch master --json "$@" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {"d": d}))' "${JQ:?}"; }
answer() {  # answer <name> <app> <status> <conclusion> [sha]: one check run, as GitHub's REST reply
  python3 - "$@" > "$GH_ANSWER" <<'PY'
import json, sys
a = sys.argv[1:] + [""]
run = {"name": a[0], "app": {"slug": a[1]}, "status": a[2], "conclusion": a[3] or None}
if a[4]:
    run["head_sha"] = a[4]
print(json.dumps({"total_count": 1, "check_runs": [run]}))
PY
}
norun() { echo '{"total_count": 0, "check_runs": []}' > "$GH_ANSWER"; }

# ---- GT1: no publishing job: origin, no ref fetch, no gh ----------------------------------------------------------------
srv n; push n b.txt two >/dev/null; fetch "$W"; : > "$LOG_SSH"; : > "$LOG_GH"
ok "$(gt)" "origin $(git -C "$W" rev-parse origin/master) origin/master: this repo publishes no Green tip" "GT1: no green-tip job in full-suite.yml: origin's tip"
ok "$(grep -c . "$LOG_SSH")|$(grep -c . "$LOG_GH")|$([ -e "$THREAD_GREEN_TIP_FILE" ] && echo rec)" "0|0|" "GT1: … no network call (zero ssh lines), no gh, no record written"

# ---- the publishing fixture: C1 (the job) .. C2 .. C3 (origin's tip), the ref at C2 ------------------------------------
srv r yml; C1=$(git -C "$W" rev-parse HEAD); C2=$(push r b.txt two); C3=$(push r c.txt three); green r "$C2"; fetch "$W"

# ---- GT2: a recorded Green tip, one behind ------------------------------------------------------------------------------
rec o/r "$C2"; : > "$LOG_GH"
ok "$(gt)" "green $C2 the Green tip ${C2:0:12}, 1 behind origin/master" "GT2: the Green tip, recorded verified: green, 1 behind"
ok "$(JQ='d["behind"], d["verified"], d["publishes"], d["green"] == d["target"]' js)" "(1, True, True, True)" "GT2: … behind 1, verified, publishes"
ok "$(grep -c . "$LOG_GH")" 0 "GT2: … no gh call"
ok "$(rv o/r 'e.get("seen")')" "$C2" "GT2: … and the fetch recorded seen"

# ---- GT3: gh's answers on an unrecorded Green tip --------------------------------------------------------------------
rm -f "$THREAD_GREEN_TIP_FILE"; : > "$LOG_GH"; answer "publish the Green tip" github-actions completed success "$C2"
ok "$(gt)" "green $C2 the Green tip ${C2:0:12}, 1 behind origin/master" "GT3: a passing publish run: verified"
ok "$(cat "$LOG_GH")" "GH_PROMPT_DISABLED=1 api|-X|GET|repos/o/r/commits/$C2/check-runs|-f|check_name=publish the Green tip|-f|filter=latest" \
  "GT3: … gh's exact argv, each -f one argument, with GH_PROMPT_DISABLED=1"
ok "$(rv o/r '[v["sha"] for v in e["verified"]], e["unverified"]')" "(['$C2'], [])" "GT3: … recorded verified"
while IFS='|' read -r name app st conc why; do
  rm -f "$THREAD_GREEN_TIP_FILE"; answer "$name" "$app" "$st" "$conc"
  out=$(gt)
  ok "${out%% *}" hold "GT3: $why: not verified (a hold, nothing older recorded)"
  ok "$(rv o/r '[u["sha"] for u in e["unverified"]], e["verified"]')" "(['$C2'], [])" "GT3: … $why: recorded unverified"
done <<'EOF'
build|github-actions|completed|success|a run named otherwise
publish the Green tip|someone-else|completed|success|another app's run
publish the Green tip|github-actions|completed|failure|a completed failure
EOF
rm -f "$THREAD_GREEN_TIP_FILE"; norun; out=$(gt)
ok "${out%% *}|$(rv o/r '[u["sha"] for u in e["unverified"]]')" "hold|['$C2']" "GT3: no run at all: not verified, recorded unverified"
has "$out" "not verified (no passing publish run on it)" "GT3: … and the why says so"
rm -f "$THREAD_GREEN_TIP_FILE"; answer "publish the Green tip" github-actions in_progress ""; gt >/dev/null
cp "$THREAD_GREEN_TIP_FILE" "$tmp/rec.before"
for st in in_progress queued; do
  answer "publish the Green tip" github-actions "$st" ""; out=$(gt)
  ok "${out%% *}|$(cmp -s "$tmp/rec.before" "$THREAD_GREEN_TIP_FILE" && echo same)" "hold|same" "GT3: a $st publish run: not verified, the record byte-identical"
done
has "$out" "its publish run is still running" "GT3: … the why says it is still running"

# ---- GT4: the ref at origin's untested tip steps back -------------------------------------------------------------------
green r "$C3"; rec o/r "$C2"; norun
ok "$(gt)" "green $C2 the Green tip ${C3:0:12} is not verified (no passing publish run on it): stepped back to ${C2:0:12}, the newest verified commit before it" \
  "GT4: an unverified Green tip at origin's tip steps back to the recorded commit before it"
ok "$(JQ='d["stepped"], d["green"], d["behind"]' js)" "(True, '$C3', 1)" "GT4: … stepped, green names the ref, 1 behind"
rec o/r "$C1" "$C2"
ok "$(JQ='d["target"]' js)" "$C2" "GT4: of two recorded ancestors, the newer by history (whatever the record's order)"
rm -f "$THREAD_GREEN_TIP_FILE"; out=$(gt)
ok "${out%% *} ${out#* }" "hold - the Green tip ${C3:0:12} is not verified (no passing publish run on it), and no verified commit is recorded before it" \
  "GT4: none recorded: a hold, never origin's tip"
ok "$(JQ='d["cause"], d["target"], d["fallback"]' js)" "('unverified', None, None)" "GT4: … cause unverified"
green r "$C2"

# ---- GT5 / GT6: an absent ref -------------------------------------------------------------------------------------------
srv r5 yml; B5=$(push r5 b.txt two); green r5 "$B5"; fetch "$W"; rec o/r5 "$B5"; gt >/dev/null   # seen
git --git-dir "$SRV/o/r5.git" update-ref -d refs/thread/green
g -C "$tmp/seed-r5" rm -q .github/workflows/full-suite.yml; g -C "$tmp/seed-r5" commit -qm "no job"; g -C "$tmp/seed-r5" push -q origin master 2>/dev/null; fetch "$W"
out=$(gt)
ok "${out%% *}" hold "GT5: the ref gone after it was seen, the job removed: still a hold"
has "$out" "refs/thread/green is gone from origin after it was seen (if origin stopped publishing on purpose, drop \"o/r5\" from $THREAD_GREEN_TIP_FILE)" \
  "GT5: … naming the record key to drop"
ok "$(JQ='d["cause"], d["fallback"]' js)" "('absent', '$B5')" "GT5: … cause absent, fallback the recorded ancestor"
srv r6 yml; rm -f "$THREAD_GREEN_TIP_FILE"; out=$(gt)
ok "$out" "hold - refs/thread/green is not on origin, which publishes one (.github/workflows/full-suite.yml's green-tip job)" "GT6: the job, the ref never there: a hold"
ok "$(JQ='d["cause"], d["fallback"]' js)" "('absent', None)" "GT6: … cause absent, no fallback"

# ---- GT7: unreachable, a stale fetched copy ignored ---------------------------------------------------------------------
W="$tmp/w/r"; git -C "$W" update-ref refs/thread/fetched/green "$(git -C "$W" rev-parse origin/master)"; rec o/r "$C2"
out=$(FAKE=fail gt)
ok "${out%% *} ${out#* }" "hold - refs/thread/green: origin did not answer (fatal: Could not read from remote repository.)" "GT7: a fetch that cannot reach origin: a hold, never the stale copy"
ok "$(FAKE=fail JQ='d["cause"], d["target"]' js)" "('unreachable', None)" "GT7: … cause unreachable"

# ---- GT8: not an ancestor -----------------------------------------------------------------------------------------------
side=$(g --git-dir "$SRV/o/r.git" commit-tree -p "$C1" -m side "$C1^{tree}"); green r "$side"
out=$(gt)
ok "${out%% *}|$(JQ='d["cause"], d["green"]' js)" "hold|('not-ancestor', '$side')" "GT8: a ref off origin's history: a hold, cause not-ancestor, green the side commit"
green r "$C2"

# ---- GT9: the live-checkout rule ----------------------------------------------------------------------------------------
srv r9 yml; C9=$(push r9 b.txt two); push r9 c.txt three >/dev/null; green r9 "$C9"; fetch "$W"; rec o/r9 "$C9"
g -C "$W" worktree add -q --detach "$tmp/w/r9-wt" 2>/dev/null; g clone -q "git@github.com:o/r9.git" "$tmp/w/r9-rollout" 2>/dev/null
: > "$LOG_SSH"
for c in "$tmp/w/r9-wt" "$tmp/w/r9-rollout"; do
  out=$(python3 "$GT" target --repo "$c" --branch master --checkout)
  ok "${out%% *}" origin "GT9: --checkout on ${c##*/}: origin's tip"
  has "$out" "not a live checkout" "GT9: … not a live checkout"
done
ok "$(grep -c . "$LOG_SSH")" 0 "GT9: … with no network call"
ok "$(gt --checkout | cut -d' ' -f1-2)" "green $C9" "GT9: --checkout on the main checkout: the Green tip"
ok "$(python3 "$GT" target --repo "$tmp/w/r9-wt" --branch master | cut -d' ' -f1-2)" "green $C9" "GT9: without --checkout (the cut), a worktree reads the Green tip too"

# ---- GT10 / GT11: --no-write and a corrupt record -----------------------------------------------------------------------
W="$tmp/w/r"; echo '{"v": 1, "repos": {}}' > "$THREAD_GREEN_TIP_FILE"; cp "$THREAD_GREEN_TIP_FILE" "$tmp/rec.before"
answer "publish the Green tip" github-actions completed success "$C2"
ok "$(gt --no-write | cut -d' ' -f1-2)|$(cmp -s "$tmp/rec.before" "$THREAD_GREEN_TIP_FILE" && echo same)" "green $C2|same" "GT10: --no-write verifies and records nothing"
printf '{not json' > "$THREAD_GREEN_TIP_FILE"
out=$(gt 2>&1)
ok "$(printf '%s\n' "$out" | grep -c 'green-tip: WARN: ')|$(printf '%s\n' "$out" | grep -c Traceback)" "1|0" "GT11: a corrupt record: one WARN, no traceback"
ok "$(rv o/r '[v["sha"] for v in e["verified"]], e.get("seen")')" "(['$C2'], '$C2')" "GT11: … rewritten valid at the write"

# ---- GT12: usage, an unreadable origin, an internal failure -------------------------------------------------------------
python3 "$GT" target --branch master >/dev/null 2>&1; ok "$?" 2 "GT12: no --repo: exit 2"
python3 "$GT" >/dev/null 2>&1; ok "$?" 2 "GT12: no verb: exit 2"
python3 "$GT" target --repo "$W" --branch master --now yesterday >/dev/null 2>&1; ok "$?" 2 "GT12: a bad --now: exit 2"
ok "$(python3 "$GT" target --repo "$W" --branch nope)" "hold - refs/remotes/origin/nope names no commit" "GT12: an origin/<d> that does not resolve: a hold"
out=$(python3 - "$GT" "$W" <<'PY' 2>&1
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("gt", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def boom(*a, **k):
    raise RuntimeError("boom")
m.resolve = boom
print("rc", m.main(["target", "--repo", sys.argv[2], "--branch", "master"]))
PY
)
has "$out" "green-tip: internal failure: RuntimeError: boom" "GT12: a resolver that raises: one stderr line"
has "$out" "rc 1" "GT12: … exit 1"

# ---- GT13: the negative answer, cached 15 minutes; a pending answer never is ----------------------------------------------
T=2026-11-16T10:00:00+11:00
at() { python3 -c 'import sys, datetime as d; print((d.datetime.fromisoformat(sys.argv[1]) + d.timedelta(minutes=int(sys.argv[2]))).isoformat())' "$T" "$1"; }
rm -f "$THREAD_GREEN_TIP_FILE"; norun; : > "$LOG_GH"
gt --now "$(at 0)" >/dev/null; gt --now "$(at 5)" >/dev/null
ok "$(grep -c . "$LOG_GH")" 1 "GT13: no run, two readings 5 min apart: one gh call"
has "$(gt --now "$(at 6)")" "asked within 15 min" "GT13: … the cached reading says so"
gt --now "$(at 16)" >/dev/null
ok "$(grep -c . "$LOG_GH")" 2 "GT13: … 16 min on: asked again"
rm -f "$THREAD_GREEN_TIP_FILE"; : > "$LOG_GH"; gt --no-write --now "$(at 0)" >/dev/null; gt --no-write --now "$(at 1)" >/dev/null
ok "$(grep -c . "$LOG_GH")" 2 "GT13: --no-write records no answer, so it asks every time"
rm -f "$THREAD_GREEN_TIP_FILE"; : > "$LOG_GH"; answer "publish the Green tip" github-actions in_progress ""
gt --now "$(at 0)" >/dev/null; gt --now "$(at 1)" >/dev/null
ok "$(grep -c . "$LOG_GH")" 2 "GT13: a pending run, twice: two calls (never cached)"
answer "publish the Green tip" github-actions completed success; out=$(gt --now "$(at 2)")
ok "$(printf '%s' "$out" | cut -d' ' -f1-2)|$(grep -c . "$LOG_GH")" "green $C2|3" "GT13: … then it passes: verified at the third call"

# ---- GT14: the GitHub URL forms, as landing-register.py reads them -------------------------------------------------------
ok "$(python3 - "$GT" "$LR" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
def load(n, p):
    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
gt, lr = load("gt", sys.argv[1]), load("lr", sys.argv[2])
def theirs(u):
    m = lr.ORIGIN_RE.fullmatch(u); rest = m.group(1) if m else ""
    rest = rest[:-1] if rest.endswith("/") else rest
    s = lr.parse_slug(rest); return "/".join(s) if s else None
urls = ["https://github.com/o/r", "https://github.com/o/r.git", "git@github.com:o/r.git", "ssh://git@github.com/o/r.git",
        "https://github.com/o/r/", "/tmp/x/r.git", "git@gitlab.com:o/r.git", "https://u@github.com/o/r", "git@github.com:o/..",
        "ssh://git@github.com:22/o/r.git", ""]
bad = [u for u in urls if gt.parse_slug(u) != theirs(u)]
print(bad or "same", [gt.parse_slug(u) for u in urls[:4]])
PY
)" "same ['o/r', 'o/r', 'o/r', 'o/r']" "GT14: the three URL forms read o/r, and every form reads as landing-register.py reads it"
g init -q --bare "$tmp/local.git"; g clone -q "$tmp/seed-r" "$tmp/w/local" 2>/dev/null; g -C "$tmp/w/local" remote set-url origin "$tmp/local.git"
g -C "$tmp/seed-r" push -q "$tmp/local.git" master 2>/dev/null; git --git-dir "$tmp/local.git" update-ref refs/thread/green "$(git -C "$tmp/seed-r" rev-parse HEAD)"
g -C "$tmp/w/local" fetch -q origin master 2>/dev/null; mkdir -p "$tmp/seed-r/.github/workflows"
git --git-dir "$tmp/local.git" update-ref refs/heads/master "$C3"; g -C "$tmp/w/local" fetch -q origin master 2>/dev/null
git --git-dir "$tmp/local.git" update-ref refs/thread/green "$C2"
: > "$LOG_GH"; rm -f "$THREAD_GREEN_TIP_FILE"
out=$(python3 "$GT" target --repo "$tmp/w/local" --branch master)
ok "${out%% *}|$(grep -c . "$LOG_GH")" "hold|0" "GT14: a local-path origin that publishes: no gh call, so only a recorded commit verifies"
has "$out" "not a GitHub origin: only a recorded commit verifies" "GT14: … and the why says so"
ok "$(rv "$tmp/local.git" 'e.get("seen")')" "$C2" "GT14: … its record key is the raw origin URL"

# ---- GT15: the inner bounds ---------------------------------------------------------------------------------------------
read -r -d '' PL <<'PL'
my $t=shift; $t=1 unless defined $t && $t=~/^\d+$/ && $t>=1;
my $pid=fork; defined $pid or exit 127;
if(!$pid){ setpgrp(0,0); exec { $ARGV[0] } @ARGV; exit 127 }
$SIG{ALRM}=sub{ kill 'KILL',-$pid; waitpid($pid,0); exit 142 };
alarm $t; waitpid($pid,0); my $st=$?; alarm 0;
kill 'KILL',-$pid;
exit($st & 127 ? 128+($st & 127) : $st >> 8)
PL
wrap() { perl -e "$PL" "$@" </dev/null; }   # land.sh's bounded: its own group, killed at the bound and after an exit
rec o/r "$C2"
rm -f "$HANG_PID"; s0=$SECONDS
out=$(FAKE=hang python3 - "$GT" "$W" <<'PY' 2>&1
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("gt", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
r = m.resolve(sys.argv[2], "master", budget=2)
print(r["kind"], r["cause"])
PY
)
ok "$out|$([ $((SECONDS - s0)) -le 10 ] && echo soon)" "hold unreachable|soon" "GT15 (a): imported, budget 2, a hanging ssh: a hold, unreachable, within 10 s (the hang is 120 s)"
gone "$(cat "$HANG_PID" 2>/dev/null)" "GT15 (a): … the hung ssh is gone (its own group, killed at the bound)"
rm -f "$HANG_PID"; s0=$SECONDS
out=$(FAKE=hang wrap 10 python3 "$GT" target --repo "$W" --branch master --budget 2); rc=$?
ok "$rc|${out%% *}|$([ $((SECONDS - s0)) -le 10 ] && echo soon)" "0|hold|soon" "GT15 (b): the CLI under the group-kill wrapper, --budget 2: exit 0, a hold, within 10 s (the hang is 120 s)"
has "$out" "refs/thread/green: " "GT15 (b): … unreachable, its why naming the ref"
gone "$(cat "$HANG_PID" 2>/dev/null)" "GT15 (b): … the ssh its inner kill left in the CLI's group is reaped by the wrapper's after-exit kill"
rm -f "$THREAD_GREEN_TIP_FILE" "$HANG_PID"; : > "$LOG_GH"; s0=$SECONDS
out=$(GH_MODE=hang wrap 10 python3 "$GT" target --repo "$W" --branch master --budget 2)
ok "${out%% *}|$(grep -c . "$LOG_GH")|$(rv o/r 'e["unverified"]')|$([ $((SECONDS - s0)) -le 10 ] && echo soon)" "hold|1|[]|soon" \
  "GT15 (c): --budget 2, a hanging gh on an unrecorded tip: one bounded call, nothing recorded"
gone "$(cat "$HANG_PID" 2>/dev/null)" "GT15 (c): … the hung gh is gone"

# ---- GT16: an outer kill reaps every child --------------------------------------------------------------------------------
rec o/r "$C2"; rm -f "$HANG_PID"
FAKE=hang wrap 2 python3 "$GT" target --repo "$W" --branch master --budget 60 >/dev/null; rc=$?
ok "$rc" 142 "GT16: the CLI past its outer bound: the wrapper exits 142"
gone "$(cat "$HANG_PID" 2>/dev/null)" "GT16: … and the CLI's children, in its group, are gone with it"

# ---- GT17: a locked record ----------------------------------------------------------------------------------------------
rm -f "$THREAD_GREEN_TIP_FILE"; rec o/r "$C2"; cp "$THREAD_GREEN_TIP_FILE" "$tmp/rec.before"
python3 -c 'import fcntl, sys, time; f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2], "w").write("held"); time.sleep(30)' \
  "$THREAD_GREEN_TIP_FILE.lock" "$tmp/locked" &
holders+=($!); i=0; while [ ! -s "$tmp/locked" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
s0=$SECONDS; out=$(gt --budget 3 2>&1)
ok "$(printf '%s\n' "$out" | grep -c '^green ')|$(cmp -s "$tmp/rec.before" "$THREAD_GREEN_TIP_FILE" && echo same)|$([ $((SECONDS - s0)) -le 10 ] && echo soon)" "1|same|soon" \
  "GT17: a held lock: the reading still prints, the record unchanged, within its 3 s budget and a margin (the holder sleeps 30 s)"
has "$out" "green-tip: WARN: the record is locked: this reading is not recorded" "GT17: … with one WARN"
{ kill "${holders[0]}"; wait "${holders[0]}"; } 2>/dev/null

# ---- GT18: waits, steps 0 and 1 alone: local, no network, no gh, no write -------------------------------------------------
wt() { python3 "$GT" waits --repo "$1" --branch master; }
: > "$LOG_SSH"; : > "$LOG_GH"; cp "$THREAD_GREEN_TIP_FILE" "$tmp/rec.before"
ok "$(wt "$tmp/w/r9")" waits "GT18: a main checkout whose origin/<d> full-suite.yml holds the job: waits"
ok "$(wt "$tmp/w/r9-wt")|$(wt "$tmp/w/r9-rollout")" "origin not a live checkout (a linked worktree)|origin not a live checkout (a Rollout clone)" \
  "GT18: … a linked worktree and a Rollout clone do not (step 0)"
ok "$(wt "$tmp/w/n")" "origin this repo publishes no Green tip" "GT18: no job: origin"
ok "$(grep -c . "$LOG_SSH")|$(grep -c . "$LOG_GH")|$(cmp -s "$tmp/rec.before" "$THREAD_GREEN_TIP_FILE" && echo same)" "0|0|same" \
  "GT18: … no network call, no gh, the record unchanged"
rec o/n; python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d["repos"]["o/n"]["seen"]=sys.argv[2]; json.dump(d, open(sys.argv[1], "w"))' \
  "$THREAD_GREEN_TIP_FILE" "$(git -C "$tmp/w/n" rev-parse HEAD)"
ok "$(wt "$tmp/w/n")" waits "GT18: no job, but the record has seen the ref: waits"
printf '{not json' > "$THREAD_GREEN_TIP_FILE"
ok "$(wt "$tmp/w/n" 2>&1)" "origin this repo publishes no Green tip" "GT18: a corrupt record reads as empty, with no WARN"
python3 "$GT" waits --repo "$W" >/dev/null 2>&1; ok "$?" 2 "GT18: no --branch: exit 2"

exit $fail
