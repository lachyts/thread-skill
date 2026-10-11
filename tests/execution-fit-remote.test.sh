#!/usr/bin/env bash
# The remote-check and register-check snippets in skills/_shared/execution-fit.md § Dispatch blockers,
# extracted by their markers and run against fixture remotes (the register check against the read-only
# fixture register, never the real one), plus the pointers that wire them in: schedule § 0 runs both
# (without copying them) and stops before any write; execute § 2.5 runs the register check at every
# invocation and § 4.5 re-runs it before every dispatch, Workflow call and merge-task.sh call (ADR 0028
# § Decision); execute § 5 carries the scratchpad fallback for a refused engine path.
# Hermetic: every repo lives under mktemp; no commits (so no identity); never gh, never the network. The
# caller's GIT_DIR & co. are unset, and global/system git config is ignored so a user `url.*.insteadOf`
# rule can't rewrite what `git remote get-url` prints when this runs standalone.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
g() { git -c init.defaultBranch=main "$@"; }

# ---- the snippet, verbatim from execution-fit.md ---------------------------------------------------------
awk '/^# thread:remote-check/{on=1; next} /^# end thread:remote-check/{on=0} on' \
  skills/_shared/execution-fit.md | sed 's#^R="<repoPath>"$#R="$1"#' > "$tmp/check.sh"
ok "$(grep -c 'R="$1"' "$tmp/check.sh")" 1 "remote-check snippet found in execution-fit.md"

# run <repo> → sets out (stdout), err (stderr), rc (exit code)
run() { out=$(bash "$tmp/check.sh" "$1" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
repo() { g init -q "$1" && { [ -z "${2:-}" ] || g -C "$1" remote add origin "$2"; }; }  # repo <dir> [origin-url]

# 1. no origin at all (a fresh git init, a filter-repo seed)
repo "$tmp/lonely"
run "$tmp/lonely"
ok "$rc" 1 "no origin → exit 1"
has "$err" "gh repo create" "no origin → the gh repo create remedy"
ok "${out:-<empty>}" "<empty>" "no origin → nothing on stdout"

# 2. origin is a local path (a clone of the live checkout)
g init -q --bare "$tmp/m.git"
repo "$tmp/pathorigin" "$tmp/m.git"
run "$tmp/pathorigin"
ok "$rc" 1 "path origin → exit 1"
has "$err" "not a GitHub remote" "path origin → not a GitHub remote"

# 3. origin is a file:// URL
repo "$tmp/fileorigin" "file://$tmp/m.git"
run "$tmp/fileorigin"
ok "$rc" 1 "file:// origin → exit 1"
has "$err" "not a GitHub remote" "file:// origin → not a GitHub remote"

# 4. origin on another host
repo "$tmp/gitlab" "https://gitlab.com/o/r.git"
run "$tmp/gitlab"
ok "$rc" 1 "other-host origin → exit 1"
has "$err" "not a GitHub remote" "other-host origin → not a GitHub remote"

# 5-7. the GitHub URL shapes pass and print the URL exactly
for u in "https://github.com/o/r.git" "git@github.com:o/r.git" "ssh://git@github.com/o/r.git"; do
  d="$tmp/gh-$(printf %s "$u" | tr -c 'A-Za-z0-9' _)"
  repo "$d" "$u"
  run "$d"
  ok "$rc" 0 "$u → exit 0"
  ok "$out" "$u" "$u → prints the URL"
done

# 8. a repo path with a space, GitHub origin
repo "$tmp/my repo" "https://github.com/o/r.git"
run "$tmp/my repo"
ok "$rc" 0 "repo path with a space → exit 0"
ok "$out" "https://github.com/o/r.git" "repo path with a space → prints the URL"

# 9. a repo path with a space, no origin: the remedy names the whole path
repo "$tmp/no remote here"
run "$tmp/no remote here"
ok "$rc" 1 "spaced path, no origin → exit 1"
has "$err" "--source \"$tmp/no remote here\"" "spaced path, no origin → remedy quotes the whole path"

# 9b. a ~/-relative path (rollout notes and project `Local:` lines carry them) is expanded, not read as no origin
mkdir -p "$tmp/rh"
repo "$tmp/rh/tilde" "https://github.com/o/r.git"
out=$(HOME="$tmp/rh" bash "$tmp/check.sh" "~/tilde" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err")
ok "$rc" 0 "~/ path with a GitHub origin → exit 0"
ok "$out" "https://github.com/o/r.git" "~/ path → prints the URL"
ok "${err:-<empty>}" "<empty>" "~/ path → no 'no origin remote' remedy"

# ---- the register check, verbatim from execution-fit.md ----------------------------------------------------
awk '/^# thread:register-check/{on=1; next} /^# end thread:register-check/{on=0} on' \
  skills/_shared/execution-fit.md | sed 's#^R="<repoPath>"$#R="$1"#' > "$tmp/register.sh"
ok "$(grep -c 'R="$1"' "$tmp/register.sh")" 1 "register-check snippet found in execution-fit.md"
ok "$(grep -c 'skills/_shared/scripts/landing-register.py' "$tmp/register.sh")" 1 "register-check calls landing-register.py"
ok "$(grep -c '2>&1' "$tmp/register.sh")" 0 "register-check never folds the reader's stderr into stdout"
ok "$(grep -c '2>/dev/null' "$tmp/register.sh")" 0 "register-check never drops the reader's stderr"

export CLAUDE_PLUGIN_ROOT LANDING_REGISTER
CLAUDE_PLUGIN_ROOT=$(pwd -P)
LANDING_REGISTER=$(pwd -P)/tests/fixtures/landing-register/register.md   # never the real register
# rrun <repo> → sets out (stdout), err (stderr), rc (exit code)
rrun() { out=$(bash "$tmp/register.sh" "$1" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }

# 10. a listed repo: exit 3, the listed line + remedy on stderr, nothing on stdout
repo "$tmp/listed" "https://github.com/Animately/imgproxy.git"
rrun "$tmp/listed"
ok "$rc" 3 "listed repo → exit 3"
ok "${out:-<empty>}" "<empty>" "listed repo → nothing on stdout"
has "$err" "listed Animately/imgproxy: reason A" "listed repo → the listed line verbatim"
has "$err" "unlisting is Lachy's call" "listed repo → the remedy"

# 11. an owner-wide entry lists every repo of that owner
repo "$tmp/wild" "git@github.com:Wild/x.git"
rrun "$tmp/wild"
ok "$rc" 3 "owner-wide Wild/* → exit 3"

# 12. an unlisted repo lands
repo "$tmp/unlisted" "https://github.com/o/r.git"
rrun "$tmp/unlisted"
ok "$rc" 0 "unlisted repo → exit 0"
ok "$out" "land" "unlisted repo → prints land"

# 13. no register file: lands, and the reader's warning passes through
LANDING_REGISTER="$tmp/none.md" rrun "$tmp/unlisted"
ok "$rc" 0 "no register → exit 0"
ok "$out" "land" "no register → prints land"
ok "$([ -n "$err" ] && echo y || echo n)" y "no register → stderr is not swallowed"
has "$err" "no register at" "no register → the reader's warning passes through"

# 14. an unreadable register fails closed (exit 2), never read as unlisted
LANDING_REGISTER="$(pwd -P)/tests/fixtures/landing-register/unterminated.md" rrun "$tmp/unlisted"
ok "$rc" 2 "unterminated register → exit 2"
ok "${out:-<empty>}" "<empty>" "unterminated register → nothing on stdout"
has "$err" "landing-register:" "unterminated register → the reader's error line"

# 15. no origin: exit 4 with the remedy
rrun "$tmp/lonely"
ok "$rc" 4 "no origin → exit 4"
ok "${out:-<empty>}" "<empty>" "no origin → nothing on stdout"
has "$err" "run the remote check in skills/_shared/execution-fit.md § Dispatch blockers" "no origin → the remedy names the remote check by location"

# 16. the reader is missing (CLAUDE_PLUGIN_ROOT unset or wrong): exit 2
CLAUDE_PLUGIN_ROOT="$tmp/nowhere" rrun "$tmp/unlisted"
ok "$rc" 2 "reader missing → exit 2"
ok "${out:-<empty>}" "<empty>" "reader missing → nothing on stdout"
has "$err" "not found" "reader missing → says not found"

# 17. python3 missing (127) fails closed: exit 2, never land
mkdir -p "$tmp/empty"
out=$(PATH="$tmp/empty" /bin/bash "$tmp/register.sh" "$tmp/listed" 2>/dev/null); rc=$?
ok "$rc" 2 "python3 missing → exit 2"
ok "$([ "$out" != land ] && echo y || echo n)" y "python3 missing → never prints land"

# 18. a listed repo at a path with a space
repo "$tmp/listed here" "https://github.com/Animately/imgproxy.git"
rrun "$tmp/listed here"
ok "$rc" 3 "listed repo at a spaced path → exit 3"

# 19. a ~/-relative Project root is expanded before the reader sees it
mkdir -p "$tmp/h"
repo "$tmp/h/listed" "https://github.com/Animately/imgproxy.git"
HOME="$tmp/h" rrun "~/listed"
ok "$rc" 3 "~/ path to a listed repo → exit 3"

# 20-22. composition of the two snippets (remote check, then register check, then the first write); the
# order schedule § 0's prose gives them is pinned in the wiring section below
gate() { rm -f "$tmp/stamped"; bash "$tmp/check.sh" "$1" >/dev/null 2>&1 && bash "$tmp/register.sh" "$1" >/dev/null 2>&1 && touch "$tmp/stamped"; }
gate "$tmp/listed"; rc=$?
ok "$rc" 3 "schedule gate, listed repo → exit 3"
ok "$([ -e "$tmp/stamped" ] && echo y || echo n)" n "schedule gate, listed repo → nothing written"
gate "$tmp/unlisted"
ok "$([ -e "$tmp/stamped" ] && echo y || echo n)" y "schedule gate, unlisted repo → proceeds"
gate "$tmp/lonely"
ok "$([ -e "$tmp/stamped" ] && echo y || echo n)" n "schedule gate, no origin → the remote check stops it first"

# ---- the wiring --------------------------------------------------------------------------------------------
# Every phrase below is one only this change's text carries, so each check fails on the docs before it.
ef=$(tr '\n' ' ' < skills/_shared/execution-fit.md)   # one line, so a phrase may wrap
engine=$(awk '/^\*\*Engine path\.\*\*/{on=1} on && /^$/{on=0} on' skills/_shared/execution-fit.md | tr '\n' ' ')
has "$engine" "**Engine path.**" "execution-fit names the engine-path blocker"
has "$engine" "execute § 5 carries the scratchpad fallback" "engine-path blocker cites execute § 5"
has "$ef" "schedule § 0 runs these checks" "execution-fit names schedule § 0 as the gate"

s0=$(awk '/^### 0\./{on=1} /^### 1\./{on=0} on' skills/schedule/SKILL.md)
has "$s0" "execution-fit.md\` § Dispatch blockers" "schedule § 0 points at execution-fit.md § Dispatch blockers"
has "$s0" "stop before step 1" "schedule § 0 stops before step 1"
has "$s0" "no task stamped" "schedule § 0 stamps no task"
has "$s0" "no rollout note" "schedule § 0 writes no rollout note"
has "$s0" "no heartbeat" "schedule § 0 registers no heartbeat"
ok "$(grep -c '# thread:remote-check' skills/schedule/SKILL.md)" 0 "schedule does not copy the snippet"

s5=$(awk '/^### 5\./{on=1} /^### 6\./{on=0} on' skills/execute/SKILL.md)
for w in scratchpad cmp "Never edit"; do
  has "$s5" "$w" "execute § 5 fallback mentions $w"
done
has "$s5" "scriptPath\` the run started with" "execute § 5 resume re-passes the scriptPath the run started with"

# ---- the register-check wiring -------------------------------------------------------------------------------
has "$ef" "Six blockers" "execution-fit names six blockers"
ur=$(awk '/^\*\*Unfinished rollout\.\*\*/{on=1} /^\*\*Engine path\.\*\*/{on=0} on' skills/_shared/execution-fit.md | tr '\n' ' ')
has "$ur" "**Unfinished rollout.**" "execution-fit has the Unfinished rollout blocker, ahead of Engine path"
has "$ur" "unfinished-rollout.py check" "the Unfinished rollout blocker names unfinished-rollout.py check"
has "$ur" "schedule § 0" "the Unfinished rollout blocker points at schedule § 0 for its outcomes"
has "$ur" "Uncommitted grill docs" "orient's Uncommitted grill docs hold sits beside it"
has "$ef" "**Landing register.**" "execution-fit names the landing-register blocker"
has "$ef" "execute § 2.5" "execution-fit cites execute § 2.5 for the re-checks"
has "$ef" "any stderr already printed" "execution-fit: a failed check keeps whatever stderr it printed"

has "$s0" "landing register" "schedule § 0 runs the landing-register check"
has "$s0" "listed <owner/name>: <reason>" "schedule § 0 prints the listed line"
s0flat=$(printf '%s\n' "$s0" | tr '\n' ' ')
has "$s0flat" "landing register check" "schedule § 0 names the landing register check"
has "${s0flat%%landing register check*}" "gh repo view" "schedule § 0 runs the remote check and gh repo view before the register check"
has "${s0flat#*landing register check}" "On any failure" "schedule § 0: any failure, register check included, stops"
has "${s0flat#*landing register check}" "stop before step 1" "schedule § 0 stops before step 1 after the register check"
ok "$(grep -c '# thread:register-check' skills/schedule/SKILL.md)" 0 "schedule does not copy the register snippet"

s25=$(awk '/^### 2\.5\./{on=1} /^### 3\./{on=0} on' skills/execute/SKILL.md | tr '\n' ' ')
has "$s25" "### 2.5. Landing-register gate" "execute § 2.5 exists"
has "$s25" "execution-fit.md\` § Dispatch blockers" "execute § 2.5 points at execution-fit.md § Dispatch blockers"
for w in "state=halted" "before anything" "verbatim" "above the ROLLOUT-STATUS"; do
  has "$s25" "$w" "execute § 2.5 mentions $w"
done

has "$s25" "**Pausing is exempt.**" "execute § 2.5 exempts pausing"
exempt="${s25#*"**Pausing is exempt.**"}"
for w in "pause_requested: true" "TaskStop" "\`paused:\` stamp" "CronDelete" "never blocks stopping work"; do
  has "$exempt" "$w" "execute § 2.5 pause exemption covers $w"
done
has "$s25" "hard pause" "execute § 2.5 names hard pause for an urgent mid-rollout listing"
has "$s25" "until that call returns, its agents keep pushing" "execute § 2.5 documents the in-flight-call limit"
has "$s25" "Exposure is bounded to the in-flight call" "execute § 2.5 bounds exposure to the in-flight call"
dont=$(grep '^- Never start a task' skills/execute/SKILL.md)
has "$dont" "never blocks stopping work" "execute Don'ts: the register check never blocks a pause"
pz=$(awk '/^## Pausing \+ reinstating/{on=1} /^\*\*Soft pause/{on=0} on' skills/execute/SKILL.md | tr '\n' ' ')
has "$pz" "Neither pause runs the § 2.5" "execute Pausing: neither pause runs the register gate"
has "$ef" "caught only when that call returns" "execution-fit documents the in-flight-call limit"
has "$ef" "hard pause the rollout" "execution-fit names hard pause as the mid-rollout remedy"

s45raw=$(awk '/^### 4\.5\./{on=1} /^### 5\./{on=0} on' skills/execute/SKILL.md)
s45=$(printf '%s\n' "$s45raw" | tr '\n' ' ')
intro="${s45%%"**The loop**"*}"
has "$s45" "**The loop**" "execute § 4.5 has the queue's loop"
for w in "§ 2.5" "Every entry into this loop" "every Workflow call" "\`resumeFromRunId\`" "every \`merge-task.sh\` call"; do
  has "$intro" "$w" "execute § 4.5 entry rule mentions $w"
done
step1=$(printf '%s\n' "$s45raw" | awk '/^1\. /{on=1} /^2\. /{on=0} on' | tr '\n' ' ')
has "$step1" "mark-started" "execute § 4.5 step 1 stamps each start (mark-started)"
has "${step1%%stamp*}" "§ 2.5" "execute § 4.5 step 1 re-checks before the first stamp"
has "${step1%%mark-started*}" "§ 2.5" "execute § 4.5 step 1 re-checks before mark-started"
step3=$(printf '%s\n' "$s45raw" | awk '/^3\. \*\*Integrate/{on=1} /^4\. /{on=0} on' | tr '\n' ' ')
has "$step3" "lead-integrate.py prepare" "execute § 4.5 step 3 integrates via lead-integrate.py prepare"
has "${step3%%lead-integrate.py prepare*}" "§ 2.5" "execute § 4.5 step 3 re-checks before lead-integrate.py prepare"
step4=$(printf '%s\n' "$s45raw" | awk '/^4\. \*\*Merge/{on=1} /^5\. /{on=0} on' | tr '\n' ' ')
has "$step4" "merge-task.sh" "execute § 4.5 step 4 merges via merge-task.sh"
has "${step4%%merge-task.sh*}" "§ 2.5" "execute § 4.5 step 4 re-checks before merge-task.sh"
cold=$(printf '%s\n' "$s45raw" | awk '/^\*\*Cold resume\.\*\*/{on=1} on && /^$/{on=0} on' | tr '\n' ' ')
has "$cold" "reconcile-rollout.py resume" "execute § 4.5 cold resume flips merged PRs done (resume)"
has "${cold%%reconcile-rollout.py resume*}" "§ 2.5" "execute § 4.5 cold resume re-checks before resume"
has "$cold" "merge-task.sh" "execute § 4.5 cold resume never re-sends a merged PR to merge-task.sh"
rein=$(printf '%s\n' "$s45raw" | awk '/^\*\*Reinstate \(/{on=1} on' | tr '\n' ' ')
has "$rein" "clear-pause" "execute § 4.5 reinstate still clears the pause"
has "${rein%%clear-pause*}" "§ 2.5" "execute § 4.5 reinstate re-checks before clear-pause"
has "$rein" "cold resume" "execute § 4.5 reinstate still continues the cold resume"

resume=$(grep 'resumeFromRunId: <runId>' skills/execute/SKILL.md)
has "$resume" "resumeFromRunId" "execute § 5 still carries the dead-run resume"
has "${resume%%resumeFromRunId*}" "§ 2.5" "execute § 5 re-checks before a resumeFromRunId resume"
hb=$(grep '^> ROLLOUT-HEARTBEAT' skills/execute/SKILL.md)
has "$hb" "§4.5" "execute § 5 heartbeat re-enters through § 4.5 (and so its entry rule)"
preins=$(grep '^\*\*Reinstate\.\*\*' skills/execute/SKILL.md)
has "$preins" "clears it" "execute Pausing: the Reinstate line still clears the stamp"
has "${preins%%"clears it"*}" "§ 2.5" "execute Pausing: the Reinstate line re-checks before clearing the stamp"

s7=$(awk '/^### 7\./{on=1} /^### 8\./{on=0} on' skills/execute/SKILL.md | tr '\n' ' ')
has "$s7" "landing register" "execute § 7 halts on a landing-register listing"
ok "$(grep -c '# thread:register-check' skills/execute/SKILL.md)" 0 "execute does not copy the register snippet"

# repair never merges or resumes a Workflow itself: both stay routed through execute § 4.5 and its re-checks
ok "$(grep -c 'skills/execute/scripts/merge-task.sh' skills/repair/SKILL.md)" 0 "repair never invokes merge-task.sh directly"
ok "$(grep -c 'resumeFromRunId' skills/repair/SKILL.md)" 0 "repair never resumes a Workflow directly"
has "$(tr '\n' ' ' < skills/repair/SKILL.md)" "§4.5 resume" "repair hands off to execute's §4.5 resume"
s5r=$(awk '/^### 5\./{on=1} /^### 6\./{on=0} on' skills/repair/SKILL.md | tr '\n' ' ')
has "$s5r" "not gated on the landing register" "repair § 5 records its ungated clean-defer PR close as deliberate"
has "$ef" "clean defer runs" "execution-fit records repair § 5's clean defer as a register exception"

echo; [ "$fail" -eq 0 ] && echo "execution-fit-remote: ALL PASS" || echo "execution-fit-remote: SOME FAILED"
exit "$fail"
