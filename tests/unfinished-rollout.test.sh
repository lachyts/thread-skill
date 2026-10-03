#!/usr/bin/env bash
# At most one unfinished rollout per repo (schedule § 0; ADR 0027, ADR 0030 decision 1 and its migration
# consequence), and the supersede that carries a rollout's unlanded tasks into its successor:
#   C1-C27  skills/_shared/scripts/unfinished-rollout.py check: none / supersede / interrupted / file / refuse
#   K1-K5   skills/execute/scripts/reconcile-rollout.py carry: preview, refusals, per-field writes, re-runs, and
#           the refusal of a prior that holds an undecided RACE or UNVERIFIED
#   M1-M12  a protocol-3 wave rollout in flight with `review` PRs migrates: check -> resume -> carry preview ->
#           write -> carry -> step 7 -> close-out (stamps, then the move), crash windows included.
#   I1-I7   § 0's interrupted finish, then a cancel: the incomplete note (reconcile-rollout.py incomplete) is
#           refused by `next`, reported by `status` and the check, until a completed supersede closes it.
#   R1-R4   unfinished-rollout.py running: land.sh's primary-checkout hold (ADR 0031)
#   D1-D3   a task taken out of a rollout whose step 7 ended (repair's `defer`, a gate dropped late, with or
#           without its `## Queue` row) never wedges the queue, started or not.
# Temp vaults, temp git repos with literal origin URLs (only `git remote get-url` reads them) and a stub gh.
# No vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR & co.)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
CHECK="$root/skills/_shared/scripts/unfinished-rollout.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
TPL="$root/skills/schedule/rollout-template.md"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

S=""; T=""; R=""
DEMO='projects: ["[[Demo]]"]'
PAUSED='paused: 2026-09-30T10:00+00:00'
# scen <name> — a fresh vault (tasks dir $T) and the target repo $R (origin github.com/demo/repo)
scen() {
  S="$TMP/$1"; T="$S/vault/Work/Tasks"; R="$S/repo"; mkdir -p "$T"
  mkrepo "$R" https://github.com/demo/repo.git
  echo "== $1"
}
# mkrepo <dir> <origin-url | -> — a git repo whose origin is that URL ("-": a plain dir, no git)
mkrepo() { mkdir -p "$1"; [ "$2" = "-" ] && return 0; git -c init.defaultBranch=main init -q "$1" && git -C "$1" remote add origin "$2"; }
# mkro <path under $T> <Project root | -> [frontmatter lines...] — a rollout note at status $ST (default open) and
# protocol_version $PV (default 5); $BODY is appended to its body
mkro() {
  local f="$T/$1" rp="$2"; shift 2
  mkdir -p "$(dirname "$f")"
  { printf -- '---\ntags: [task, rollout]\nstatus: %s\nprotocol_version: %s\n' "${ST:-open}" "${PV:-5}"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\n'
    [ "$rp" = "-" ] || printf 'Project root: `%s`\n' "$rp"
    printf '\n%s\n' "${BODY:-}"; } > "$f"
}
# mkt <path under $T> <rollout slug | -> <status | -> [frontmatter lines...] — a task note
mkt() {
  local f="$T/$1" ro="$2" st="$3"; shift 3
  mkdir -p "$(dirname "$f")"
  { printf -- '---\ntags: [task]\n'
    [ "$st" = "-" ] || printf 'status: %s\n' "$st"
    [ "$ro" = "-" ] || printf 'rollout: "[[%s]]"\n' "$ro"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody\n'; } > "$f"
}
# chk [args...] -> $out (stdout), $err (stderr), $rc
chk() { python3 "$CHECK" check --tasks-dir "$T" "$@" > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
# carry [args...] -> $out, $err, $rc
carry() { python3 "$RR" carry --tasks-dir "$T" "$@" > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
fm() { grep -m1 "^$2:" "$T/$1" || echo "<none>"; }   # fm <path under $T> <key> — the frontmatter line
# fmset <path under $T> <key> <value | -> — reconcile-rollout.py's Note.set (or, for "-", Note.remove), as
# schedule's frontmatter stamps
fmset() {
  python3 - "$RR" "$T/$1" "$2" "$3" <<'PY'
import importlib.util, sys
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
note = rr.Note(Path(sys.argv[2]))
note.remove(sys.argv[3]) if sys.argv[4] == "-" else note.set(sys.argv[3], sys.argv[4])
note.save()
PY
}
# closeout <prior> <new> — step 7.5: stamp the prior note done + superseded_by, then move it to Archive/Rollouts/
closeout() { fmset "$1.md" status done; fmset "$1.md" superseded_by "\"[[$2]]\""; mkdir -p "$T/Archive/Rollouts"; mv "$T/$1.md" "$T/Archive/Rollouts/"; }
# render <slug> <prior slug | -> <queue rows> — the rollout template rendered as $T/<slug>.md for $R, its
# `supersedes:` uncommented to name the prior slug (none for "-")
render() {
  python3 - "$TPL" "$T/$1.md" "$R" "$2" "$3" <<'PY'
import sys
tpl, out, repo, prior, rows = sys.argv[1:]
vals = {
    "PROJECT_NAME": "Demo", "DATE": "2026-10-01", "VERIFIER": "make test", "REPO_PATH": repo,
    "ROLLOUT_SLUG": out.rsplit("/", 1)[1][:-3], "THREAD_LINE": "",
    "QUEUE_TABLE": "| # | Task | Scope | Mode |\n|---|---|---|---|\n" + rows,
    "QUEUE_RATIONALE": "Carried in their old order.", "FILE_SETS": "- d: src/a.py",
    "KNOWN_BASELINE_FAILURES": "none", "POST_ROLLOUT_ITEMS": "none",
}
text = open(tpl).read()
for k, v in vals.items():
    text = text.replace("{{%s}}" % k, v)
if prior != "-":
    text = text.replace("# supersedes:", "supersedes:", 1).replace('"[[<prior-rollout-slug>]]"', f'"[[{prior}]]"', 1)
open(out, "w").write(text)
PY
}
row() { printf '| %s | [[%s\\|%s]] | single-file | %s |' "$1" "$2" "$2" "$3"; }   # row <n> <slug> <mode>
# nx <rollout slug> -> $out, $err, $rc — reconcile-rollout.py next --dry-run (the queue's start call)
nx() { python3 "$RR" next --rollout "$T/$1.md" --tasks-dir "$T" --dry-run > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
# inc <rollout slug> — status's `incomplete` field
inc() { python3 "$RR" status --rollout "$T/$1.md" --tasks-dir "$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["incomplete"])'; }
sums() { (cd "$T" && find . -name '*.md' -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$(cksum < "$f")"; done); }
# step7end <rollout slug> — schedule step 7's last write: the `incomplete: true` the note was born with (step 6) removed
step7end() { fmset "$1.md" incomplete -; }
# starts — the `start` list of the last nx call's JSON
starts() { printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["start"])'; }
sum1() { cksum < "$T/$1"; }

# ── C1-C2: nothing unfinished on this repo ───────────────────────────────────────────────────────────
scen c1
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "none|0" "C1: an empty vault prints none"

scen c2
mkrepo "$S/other" https://github.com/demo/other.git
mkro ro-x.md "$S/other" "$DEMO" "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "none|0" "C2: a rollout on another path and origin is not this repo's"

# ── C3-C6: one unfinished rollout ─────────────────────────────────────────────────────────────────────
scen c3
mkro ro-p.md "$R" "$DEMO" "$PAUSED"
mkt t1.md ro-p in_progress 'owner: execute-old'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C3: this project's paused rollout + --regenerate -> supersede"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse ro-p|3" "C4: the same without --regenerate refuses"
has "$err" "--regenerate" "C4: stderr names --regenerate as the remedy"

scen c5
mkro ro-p.md "$R" "$DEMO"
mkt t1.md ro-p in_progress 'owner: execute-live'
for flag in "" --regenerate; do
  chk --repo "$R" --project Demo $flag
  ok "$out|$rc" "refuse ro-p|3" "C5: this project's rollout that has run and is not paused refuses (${flag:-no flag})"
  has "$err" '`paused:`' "C5: stderr names the hard pause (${flag:-no flag})"
  has "$err" "/thread:status" "C5: stderr names /thread:status (${flag:-no flag})"
  has "$err" "/thread:repair" "C5: stderr names /thread:repair (${flag:-no flag})"
  has "$err" "owner: execute-live" "C5: stderr gives the never-started reason (${flag:-no flag})"
done

scen c6
mkro ro-o.md "$R" 'projects: ["[[Other]]"]' "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse ro-o|3" "C6: another project's paused rollout on this repo refuses"
has "$err" "at most one unfinished rollout per repo" "C6: stderr names the one-per-repo rule"

# ── C7-C8: repo identity ──────────────────────────────────────────────────────────────────────────────
scen c7
mkrepo "$S/clone" git@github.com:Demo/Repo.git
mkro ro-p.md "$S/clone" "$DEMO" "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C7: a second clone (ssh origin vs https, case-folded) is the same repo"
mkdir -p "$S/links"; ln -s "$R" "$S/links/repo"
mkro ro-p.md "$S/links/repo" "$DEMO" "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C7: a symlinked Project root matches by realpath"

scen c8
mkro ro-p.md "$S/gone" "$DEMO" "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "none|0" "C8: a Project root that does not exist here is not counted"
has "$err" "ro-p: Project root $S/gone is not a git repo with an origin here: matched on its path only" "C8: … and WARNs"
mkrepo "$S/plain" -
mkro ro-p.md "$S/plain" "$DEMO" "$PAUSED"
chk --repo "$S/plain" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C8: a plain non-git --repo still matches a rollout naming the same dir"
has "$err" "WARN: --repo $S/plain is not a git repo with an origin here: matched on its path only" "C8: … and WARNs for --repo"

# ── C9-C11: what is unfinished, and what counts as never started ─────────────────────────────────────
scen c9
ST=done mkro ro-done.md "$R" "$DEMO"
mkro Archive/Rollouts/ro-old.md "$R" "$DEMO"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "none|0" "C9: a done root rollout and an archived open one are not unfinished"

scen c10
mkro ro-p.md "$R" "$DEMO"
mkt t1.md ro-p open; mkt t2.md ro-p open
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C10: a never-started rollout is eligible"

scen c11
mkro ro-p.md "$R" "$DEMO"
mkt t1.md ro-p review 'pr: https://github.com/demo/repo/pull/1' 'started: 2026-09-30T10:00+00:00' 'ready: 2026-09-30T11:00+00:00'
mkt t2.md ro-p done 'merged: 2026-09-30T12:00+00:00'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C11: task status and started:/ready:/merged: never count as started"
for v in "task owner:" "task integrating:" "## Pause log" "pause_requested: true"; do
  mkro ro-p.md "$R" "$DEMO"
  mkt t1.md ro-p review 'pr: https://github.com/demo/repo/pull/1'
  case "$v" in
    "task owner:") mkt t1.md ro-p review 'pr: https://github.com/demo/repo/pull/1' 'owner: execute-x' ;;
    "task integrating:") mkt t1.md ro-p review 'pr: https://github.com/demo/repo/pull/1' 'integrating: 2026-09-30T13:00+00:00' ;;
    "## Pause log") BODY=$'## Pause log\n\n- 2026-09-30 paused' mkro ro-p.md "$R" "$DEMO" ;;
    "pause_requested: true") mkro ro-p.md "$R" "$DEMO" 'pause_requested: true' ;;
  esac
  chk --repo "$R" --project Demo --regenerate
  ok "$out|$rc" "refuse ro-p|3" "C11: $v marks the rollout as run (not paused: refused)"
done
# A protocol-3 note: its engine stamped owner: on each task at dispatch, and that alone marks it as run (as
# giflab's real note reads); the rollout note's own stamps from that engine never count.
PV=3 mkro ro-p.md "$R" "$DEMO" 'wave_1_dispatched: 2026-09-29' 'merged_through_wave: 2'
mkt t1.md ro-p review 'pr: https://github.com/demo/repo/pull/1' 'owner: execute-x'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse ro-p|3" "C11 legacy: a protocol-3 note whose task carries owner: has run (refused)"
PV=3 mkro ro-p.md "$R" "$DEMO" 'wave_1_dispatched: 2026-09-29' 'merged_through_wave: 2'
mkt t1.md ro-p review 'pr: https://github.com/demo/repo/pull/1'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C11 legacy: the same note with no task owner: is never started"

# ── C12-C13: a complete rollout, and two unfinished ──────────────────────────────────────────────────
scen c12
mkro ro-c.md "$R" "$DEMO" 'merged_through_wave: 1'
mkt t1.md ro-c done; mkt t2.md ro-c done
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "none|0" "C12: a complete rollout whose ceremony never ran is not counted"
has "$err" "WARN: ro-c: every task merged but its completion ceremony never ran (status open)" "C12: … and WARNs"
has "$err" "## Post-rollout" "C12: the WARN names the ## Post-rollout steps"
mkro ro-p.md "$R" "$DEMO" "$PAUSED"
mkt t3.md ro-p open
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-p|0" "C12: beside a paused rollout of this project, exactly supersede the other"

scen c13
mkro ro-a.md "$R" "$DEMO" "$PAUSED"
mkro ro-b.md "$R" "$DEMO"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse ro-a,ro-b|3" "C13: two unfinished rollouts refuse both"

# ── C14-C15: this project's ───────────────────────────────────────────────────────────────────────────
scen c14
mkro ro-d.md "$R" "$DEMO" "$PAUSED"
mkt x1.md - open 'projects: ["[[Demo]]", "[[AI]]"]'
mkt Archive/x2.md - open 'projects:' '  - "[[Demo]]"'
chk --repo "$R" --tasks x1,x2 --regenerate
ok "$out|$rc" "supersede ro-d|0" "C14: --tasks takes the intersection of the tasks' projects (root, then Archive)"
mkt x2.md - open 'projects: ["[[Other]]"]'
chk --repo "$R" --tasks x1,x2 --regenerate
ok "$out|$rc" "refuse ro-d|3" "C14: tasks sharing no project count no rollout as this project's"
has "$err" "WARN: the named tasks share no project" "C14: … and WARN"

scen c15
mkro zzz-rollout-2026-10-01.md "$R" 'projects: ["[[Demo Proj]]"]' "$PAUSED"
for p in "[[Demo Proj]]" "demo proj" demo-proj; do
  chk --repo "$R" --project "$p" --regenerate
  ok "$out|$rc" "supersede zzz-rollout-2026-10-01|0" "C15: --project $p matches projects [[Demo Proj]]"
done
rm "$T/zzz-rollout-2026-10-01.md"
mkro demo-proj-rollout-2026-10-01.md "$R" 'projects: ["[[Other]]"]' "$PAUSED"
chk --repo "$R" --project demo-proj --regenerate
ok "$out|$rc" "refuse demo-proj-rollout-2026-10-01|3" "C15 control: the filename never makes a rollout this project's"

# ── C16-C20: an interrupted supersede ─────────────────────────────────────────────────────────────────
P=demo-rollout-2026-09-23; N=demo-rollout-2026-10-01
scen c16
mkro $P.md "$R" "$DEMO" "$PAUSED"
mkt t1.md $P open; mkt t2.md $P done
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "interrupted $P $N|0" "C16: P paused + N never started naming it -> interrupted"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse $P,$N|3" "C16: … without --regenerate refuses both"
has "$err" "$N is incomplete" "C16: stderr says N is incomplete"
has "$err" "never /thread:execute [[$N]] as written" "C16: stderr forbids executing N as written"
mkt t1.md $P done
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "interrupted $P $N|0" "C16b: P whose every linked task merged is still paired"
hasnt "$err" "completion ceremony" "C16b: … with no ceremony WARN"
mkro ro-x.md "$R" "$DEMO"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse $P,$N,ro-x|3" "C16c: a pair plus a third unfinished rollout refuses all three"
has "$err" "$N is incomplete" "C16c: … and carries the pair's incomplete line"

scen c17
mkro $P.md "$R" "$DEMO" "$PAUSED"
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
mkt t1.md $N in_progress 'owner: execute-new'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse $P,$N|3" "C17: an N that has run is no pair"
has "$err" "/thread:repair" "C17: … the interrupted supersede whose new rollout has run routes to /thread:repair"

scen c18
mkro $P.md "$R" "$DEMO" "$PAUSED"
ST=done mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $P|0" "C18: an N at done (no superseded_by) is not unfinished; P alone is superseded"

scen c19
mkro $P.md "$R" "$DEMO"
mkt t1.md $P in_progress 'owner: execute-again'
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse $P,$N|3" "C19: a reinstated P (not paused, has run) is no pair"

scen c20
mkro $P.md "$R" "$DEMO" "$PAUSED"
mkro $N.md "$R" 'projects: ["[[Other]]"]' "supersedes: \"[[$P]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse $P,$N|3" "C20: a pair whose N is another project's refuses"
has "$err" "/thread:schedule Other --regenerate" "C20: … and names N's project's schedule run"

# ── C21-C22: no Project root; usage errors ────────────────────────────────────────────────────────────
scen c21
mkro ro-p.md - "$DEMO" "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "none|0" "C21: a rollout with no Project root line is not counted"
has "$err" "WARN: ro-p: no Project root line: not counted" "C21: … and WARNs"

scen c22
usage() {  # usage <label> <args...>
  local label="$1"; shift
  python3 "$CHECK" "$@" > "$S.out" 2> "$S.err"; rc=$?
  ok "$rc|$(cat "$S.out")|$(wc -l < "$S.err" | tr -d ' ')" "2||1" "C22: $label exits 2, no stdout, one stderr line"
  has "$(cat "$S.err")" "unfinished-rollout:" "C22: $label names the script"
}
usage "no verb"
usage "no --repo" check --tasks-dir "$T" --project Demo
usage "a missing --repo" check --tasks-dir "$T" --repo "$S/nope" --project Demo
usage "neither --project nor --tasks" check --tasks-dir "$T" --repo "$R"
usage "both --project and --tasks" check --tasks-dir "$T" --repo "$R" --project Demo --tasks x
usage "a --tasks note not found" check --tasks-dir "$T" --repo "$R" --tasks nope
usage "a missing tasks dir" check --tasks-dir "$S/none" --repo "$R" --project Demo
mkdir -p "$S/plugin/skills/_shared/scripts"; cp "$CHECK" "$S/plugin/skills/_shared/scripts/"
python3 "$S/plugin/skills/_shared/scripts/unfinished-rollout.py" check --tasks-dir "$T" --repo "$R" --project Demo > "$S.out" 2> "$S.err"; rc=$?
ok "$rc|$(cat "$S.out")" "2|" "C22: reconcile-rollout.py unloadable exits 2 with no stdout"
has "$(cat "$S.err")" "unfinished-rollout: cannot load" "C22: … and says so"

# ── C23-C25: a stamped but unmoved superseded note (file) ────────────────────────────────────────────
scen c23
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
ST=done mkro $P.md "$R" "$DEMO" "superseded_by: \"[[$N]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "file $P $P.md|0" "C23: P stamped done + superseded_by in the root -> file"
mkdir -p "$T/Archive"; mv "$T/$P.md" "$T/Archive/"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "file $P Archive/$P.md|0" "C23: … filed by the daily sweep into bare Archive/ -> file from there"
mkdir -p "$T/Archive/Rollouts"; mv "$T/Archive/$P.md" "$T/Archive/Rollouts/"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N|0" "C23: … once in Archive/Rollouts/ it is never filed again"

scen c24
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
ST=done mkro $P.md "$R" "$DEMO" "superseded_by: \"[[$N]]\""
mkdir -p "$T/Archive/Rollouts"; cp "$T/$P.md" "$T/Archive/Rollouts/$P.md"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N|0" "C24: a collision in Archive/Rollouts/ is never a file line (no § 0 loop)"
has "$err" "Archive/Rollouts/$P.md already exists" "C24: … and WARNs"
rm "$T/Archive/Rollouts/$P.md"
ST=done mkro $P.md "$R" "$DEMO" 'superseded_by: "[[ghost]]"'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N|0" "C24: a superseded_by naming no note is never a file line"
has "$err" "superseded_by names no note" "C24: … and WARNs"
rm "$T/$P.md"
mkrepo "$S/other" https://github.com/demo/other.git
ST=done mkro ro-other.md "$S/other" "$DEMO" "superseded_by: \"[[$N]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N|0" "C24: another repo's misfiled note is not this check's"
hasnt "$err" "ro-other" "C24: … and stays silent"

scen c25
ST=done mkro zeta.md "$R" "$DEMO" 'superseded_by: "[[ro-x]]"'
ST=done mkro alpha.md "$R" 'projects: ["[[Other]]"]' 'superseded_by: "[[ro-x]]"'
mkro ro-x.md "$R" "$DEMO" "$PAUSED"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "file alpha alpha.md|0" "C25: two misfiled notes -> the first by slug (whatever its project)"
mkdir -p "$T/Archive/Rollouts"; mv "$T/alpha.md" "$T/Archive/Rollouts/"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "file zeta zeta.md|0" "C25: … then the next"
mv "$T/zeta.md" "$T/Archive/Rollouts/"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-x|0" "C25: after the moves, the paused rollout is superseded"

# ── C26: a complete P named by a started N ────────────────────────────────────────────────────────────
scen c26
mkro $P.md "$R" "$DEMO" "$PAUSED"
mkt t1.md $P done
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
mkt t2.md $N in_progress 'owner: execute-new'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse $P,$N|3" "C26: a complete P named by a started N is never dropped"
hasnt "$err" "completion ceremony" "C26: … gets no ceremony WARN"
has "$err" "/thread:repair" "C26: … and routes to /thread:repair"

# ── C27: a note is born incomplete (step 6) and stays so until step 7's last write ─────────────────────
scen c27
render ro-q - "$(row 1 q1 —)
$(row 2 q2 —)"
ok "$(fm ro-q.md incomplete | sed 's/ *#.*//')" "incomplete: true" "C27: step 6 writes the note born incomplete (the template's stamp)"
mkt q1.md ro-q open
mkt q2.md - open "$DEMO"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse ro-q|3" "C27: a run that died inside step 7 (q2 unstamped) leaves a note refused without --regenerate"
has "$err" "ro-q is incomplete: it carries incomplete: true" "C27: … stderr names the stamp"
has "$err" "re-run with --regenerate to supersede it; never /thread:execute [[ro-q]] as written" "C27: … and the remedy"
nx ro-q
ok "$rc|$out" "1|" "C27: next refuses it (no JSON)"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede ro-q|0" "C27: with --regenerate it is superseded"
has "$err" "WARN: ro-q is incomplete (it carries incomplete: true" "C27: … with a WARN that the supersede finishes it"
fmset q2.md rollout '"[[ro-q]]"'; step7end ro-q
nx ro-q
ok "$rc|$(starts)" "0|['q1', 'q2']" "C27: once step 7 stamps q2 and ends, next runs the note"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse ro-q|3" "C27: … and the check refuses it without --regenerate only as an unfinished rollout"
hasnt "$err" "is incomplete" "C27: … never as incomplete"
mkt q1.md ro-q in_progress 'owner: execute-x'
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "refuse ro-q|3" "C27 control: once it has run it is an ordinary running rollout"
hasnt "$err" "is incomplete" "C27 control: … never judged incomplete"

# ── K1-K4: carry ──────────────────────────────────────────────────────────────────────────────────────
scen k
mkro $P.md "$R" "$DEMO" "$PAUSED"
mkt a.md $P done 'owner: execute-old' 'wave: 1'
mkt b.md $P review 'pr: https://github.com/demo/repo/pull/2' 'owner: execute-old' 'wave: 1' 'started: 2026-09-29T10:00+00:00'
mkt d.md $P open 'wave: 2'
mkt e.md $P in_progress 'owner: execute-old' 'integrating: 2026-09-29T11:00+00:00'
before=$(sums)
carry --from "$T/$P.md" --dry-run
ok "$rc" 0 "K1: carry --dry-run without --to exits 0"
ok "$(printf '%s\n' "$out" | grep -E '^(carry|keep) ')" "keep a merged
carry b awaiting-integration
carry d queued
carry e running" "K1: … one carry/keep line per linked note, sorted"
ok "$(sums)" "$before" "K1: … and writes nothing"

mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
before=$(sums)
refuse() {  # refuse <label> <args...> — exit 2, one ERROR line, nothing written
  local label="$1"; shift
  carry "$@"
  ok "$rc" 2 "K2: $label exits 2"
  has "$err" "ERROR:" "K2: $label prints an ERROR"
  ok "$(sums)" "$before" "K2: $label writes nothing"
}
refuse "from == to" --from "$T/$P.md" --to "$T/$P.md"
refuse "a missing --to" --from "$T/$P.md" --to "$T/nope.md"
mkdir -p "$T/Archive"; cp "$T/$N.md" "$T/Archive/$N.md"; before=$(sums)
refuse "a --to under Archive/" --from "$T/$P.md" --to "$T/Archive/$N.md"
rm "$T/Archive/$N.md"
mkro ro-ns.md "$R" "$DEMO"; before=$(sums)
refuse "a --to with no supersedes:" --from "$T/$P.md" --to "$T/ro-ns.md"
for st in done dropped; do
  ST=$st mkro ro-st.md "$R" "$DEMO" "supersedes: \"[[$P]]\""; before=$(sums)
  refuse "a --to at $st" --from "$T/$P.md" --to "$T/ro-st.md"
done
printf -- '---\ntags: [task]\nstatus: open\nsupersedes: "[[%s]]"\n---\n\nbody\n' "$P" > "$T/ro-untagged.md"; before=$(sums)
refuse "an untagged --to" --from "$T/$P.md" --to "$T/ro-untagged.md"
mkro ro-run.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
mkt r1.md ro-run in_progress 'owner: execute-new'; before=$(sums)
refuse "a --to that has run" --from "$T/$P.md" --to "$T/ro-run.md"
refuse "a --from that is not a rollout" --from "$T/a.md" --to "$T/$N.md"
ST=done mkro ro-fd.md "$R" "$DEMO" "$PAUSED" 'superseded_by: "[[ro-elsewhere]]"'
mkro ro-fdn.md "$R" "$DEMO" 'supersedes: "[[ro-fd]]"'; before=$(sums)
refuse "a --from done and superseded by another note" --from "$T/ro-fd.md" --to "$T/ro-fdn.md"
mkro ro-live.md "$R" "$DEMO"
mkt l1.md ro-live in_progress 'owner: execute-live'
mkro ro-livn.md "$R" "$DEMO" 'supersedes: "[[ro-live]]"'; before=$(sums)
refuse "a --from that has run and is not paused" --from "$T/ro-live.md" --to "$T/ro-livn.md"
refuse "no --to without --dry-run" --from "$T/$P.md"

pa=$(sum1 a.md); pp=$(sum1 $P.md)
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc" 0 "K3: carry exits 0"
ok "$(fm b.md rollout)|$(fm b.md owner)|$(fm b.md wave)|$(fm b.md status)|$(fm b.md pr)|$(fm b.md started)" \
  "rollout: \"[[$N]]\"|<none>|<none>|status: review|pr: https://github.com/demo/repo/pull/2|started: 2026-09-29T10:00+00:00" \
  "K3: a carried review task is re-pointed; owner: and wave: cleared; status, pr: and started: kept"
ok "$(fm d.md rollout)|$(fm d.md wave)|$(fm d.md status)" "rollout: \"[[$N]]\"|<none>|status: open" "K3: a carried open task loses its legacy wave:"
ok "$(fm e.md rollout)|$(fm e.md owner)|$(fm e.md integrating)|$(fm e.md status)" "rollout: \"[[$N]]\"|<none>|<none>|status: in_progress" "K3: a carried in_progress task loses owner: and integrating:"
ok "$(sum1 a.md)|$(sum1 $P.md)" "$pa|$pp" "K3: a kept task and the prior note are untouched"
ok "$(sed -n '1,4p' "$T/b.md")" "---
tags: [task]
status: review
rollout: \"[[$N]]\"" "K3: the rollout: line is rewritten in place"

before=$(sums)
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc|$(printf '%s\n' "$out" | tail -1)" "0|[no-change]" "K4: a re-run is a no-op"
ok "$(printf '%s\n' "$out" | grep -c '^carry ')" 0 "K4: … nothing left to carry"
ok "$(sums)" "$before" "K4: … and writes nothing"
sed -i.bak "s/^status: open\$/status: done/" "$T/$P.md"; rm -f "$T/$P.md.bak"
python3 - "$T/$P.md" "$N" <<'PY'
import sys
p, n = sys.argv[1:]
head, rest = open(p).read().split("\n---\n", 1)
open(p, "w").write(head + f'\nsuperseded_by: "[[{n}]]"' + "\n---\n" + rest)
PY
before=$(sums)
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc|$(printf '%s\n' "$out" | tail -1)" "0|[no-change]" "K4: a done --from superseded by --to re-runs as a no-op"
ok "$(sums)" "$before" "K4: … writing nothing"

# ── K5: carry refuses a prior that holds an undecided RACE or UNVERIFIED ─────────────────────────────
scen k5
BODY=$'## Race log\n\n- 2026-09-30T09:55+00:00 [[r1]] RACE: PR #5 merged as fff on parent ccc; re-verify it' \
  mkro $P.md "$R" "$DEMO" "$PAUSED"
mkt r1.md $P review 'pr: https://github.com/demo/repo/pull/5'
mkt q1.md $P open
mkro $N.md "$R" "$DEMO" "supersedes: \"[[$P]]\""
before=$(sums)
carry --from "$T/$P.md" --dry-run
ok "$rc" 2 "K5: carry --dry-run refuses a prior holding an undecided RACE"
has "$err" "[[r1]] (RACE)" "K5: … naming the held task"
has "$err" "/thread:repair [[$P]]" "K5: … and /thread:repair"
ok "$(sums)" "$before" "K5: … writing nothing"
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc" 2 "K5: carry refuses it for real too"
ok "$(sums)" "$before" "K5: … writing nothing"
python3 - "$T/$P.md" <<'PY'
import sys
p = sys.argv[1]
t = open(p).read()
open(p, "w").write(t.replace("## Notes\n\n", "## Notes\n\n- 2026-09-30 repair: [[r1]] RACE decided: the merge stands\n", 1))
PY
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc" 0 "K5: with the RACE decided: line in ## Notes, it carries"
ok "$(fm r1.md rollout)|$(fm q1.md rollout)" "rollout: \"[[$N]]\"|rollout: \"[[$N]]\"" "K5: … both unlanded tasks"

# ── M1-M12: a protocol-3 wave rollout in flight, with review PRs, migrates ────────────────────────────
scen m
U=https://github.com/demo/repo/pull
PV=3 BODY=$'## Wave structure\n\n| Wave | Task |\n|---|---|\n| 1 | [[a]] |\n| 1 | [[b]] |\n| 2 | [[d]] |\n\n## Pause log\n\n- 2026-09-30T10:00+00:00 hard pause before the migration' \
  mkro $P.md "$R" "$DEMO" 'merged_through_wave: 1' 'wave_1_dispatched: 2026-09-23' "$PAUSED"
mkt a.md $P done 'owner: execute-old' 'wave: 1' "pr: $U/1" 'started: 2026-09-23T10:00+00:00' 'merged: 2026-09-23T12:00+00:00'
mkt b.md $P review "pr: $U/2" 'owner: execute-old' 'wave: 1' 'started: 2026-09-23T10:00+00:00' 'ready: 2026-09-23T11:00+00:00'
mkt c.md $P review "pr: $U/3" 'owner: execute-old' 'wave: 1' 'started: 2026-09-23T10:00+00:00'
mkt d.md $P open 'wave: 2'
mkt e.md $P in_progress 'owner: execute-old' 'wave: 2' 'integrating: 2026-09-30T09:00+00:00' 'started: 2026-09-29T10:00+00:00'
mkt f.md $P blocked 'owner: execute-old' 'wave: 2'
mkt g.md $P merged 'merged_into: "[[d]]"'
mkt h.md $P dropped
mkt i.md $P review "pr: $U/9" 'owner: execute-old' 'wave: 2' 'integrating: 2026-09-30T09:30+00:00' 'started: 2026-09-29T10:00+00:00'

chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $P|0" "M2: the hard-paused wave rollout is superseded"

mkdir -p "$S/bin" "$S/gh"
cat > "$S/bin/gh" <<'EOF'
#!/usr/bin/env bash
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
case "$1 $2" in
  "pr view")   f="$GHDIR/pr-$(key "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1 ;;
  "repo view") f="$GHDIR/default-$(key "$3")"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no repo" >&2; exit 1 ;;
esac
exit 2
EOF
chmod +x "$S/bin/gh"
export GHDIR="$S/gh"
pr() { printf '{"state":"%s","mergedAt":%s,"baseRefName":"main","url":"%s"}\n' "$2" "$3" "$1" > "$S/gh/pr-$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_').json"; }
echo main > "$S/gh/default-demo_repo"
pr "$U/2" OPEN null; pr "$U/3" MERGED '"2026-09-30T08:15:00Z"'; pr "$U/9" OPEN null
bb=$(sum1 b.md); ii=$(sum1 i.md)
python3 "$RR" resume --rollout "$T/$P.md" --tasks-dir "$T" --gh-bin "$S/bin/gh" > "$S.out" 2> "$S.err"; rc=$?
ok "$rc" 0 "M3: resume on the prior rollout exits 0"
ok "$(fm c.md status)|$(fm c.md merged)" "status: done|merged: 2026-09-30T08:15+00:00" "M3: the review task whose PR merged is flipped done, merged: from mergedAt"
ok "$(sum1 b.md)|$(sum1 i.md)" "$bb|$ii" "M3: the open-PR review tasks are unchanged"

before=$(sums)
carry --from "$T/$P.md" --dry-run
ok "$(printf '%s\n' "$out" | grep -E '^(carry|keep) ')" "keep a merged
carry b awaiting-integration
keep c merged
carry d queued
carry e running
carry f set-aside
keep g folded
keep h other
carry i integrating" "M4: the carry preview, after resume"
ok "$(sums)" "$before" "M4: … writes nothing"

# M5: N rendered from the template, superseding P, its queue the carried tasks.
render $N $P "$(row 1 b 'carried (awaiting-integration)')
$(row 2 i 'carried (integrating)')
$(row 3 e 'carried (running)')
$(row 4 f 'carried (set-aside)')
$(row 5 d 'carried (queued)')"
ok "$(grep -c '{{' "$T/$N.md")|$(fm $N.md supersedes | sed 's/ *#.*//')" "0|supersedes: \"[[$P]]\"" "M5: N is rendered, stamped supersedes: P"
ok "$(fm $N.md incomplete | sed 's/ *#.*//')" "incomplete: true" "M5: … and born incomplete"

chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "interrupted $P $N|0" "M6: a crash right after N is written -> interrupted"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse $P,$N|3" "M6: … and without --regenerate it refuses"
has "$err" "$N is incomplete" "M6: … saying N is incomplete"
has "$err" "died before closing $P out, so its tasks may be unstamped" "M6: … because the run died before closing P out"
nx $N
ok "$rc|$out" "1|" "M6: next refuses N (no JSON)"
has "$err" "ERROR: $N is incomplete: it carries incomplete: true" "M6: … by the stamp it was born with (step 7 never ended)"

pa=$(sum1 a.md); pc=$(sum1 c.md); pg=$(sum1 g.md); ph=$(sum1 h.md); pp=$(sum1 $P.md)
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc" 0 "M7: carry exits 0"
for t in b d e f i; do
  ok "$(fm $t.md rollout)|$(fm $t.md owner)|$(fm $t.md integrating)|$(fm $t.md wave)" "rollout: \"[[$N]]\"|<none>|<none>|<none>" "M7: $t is carried, owner/integrating/wave cleared"
done
ok "$(fm b.md status)|$(fm d.md status)|$(fm e.md status)|$(fm f.md status)|$(fm i.md status)" \
  "status: review|status: open|status: in_progress|status: blocked|status: review" "M7: carried statuses are unchanged"
ok "$(sum1 a.md)|$(sum1 c.md)|$(sum1 g.md)|$(sum1 h.md)|$(sum1 $P.md)" "$pa|$pc|$pg|$ph|$pp" "M7: a, c, g, h and the prior note are untouched"

chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "interrupted $P $N|0" "M8: a crash after the carry (or step 7), before close-out -> still interrupted"
hasnt "$err" "completion ceremony" "M8: the paired P, now all merged, gets no ceremony WARN"
nx $N
ok "$rc" 1 "M8: next still refuses N once every queue row links back (step 7 never ended)"
has "$err" "ERROR: $N is incomplete: it carries incomplete: true" "M8: … by its stamp"
step7end $N
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "interrupted $P $N|0" "M8: a crash after step 7's end, before close-out -> still interrupted"
nx $N
ok "$rc" 1 "M8: next refuses N after step 7's end while P is open"
has "$err" "ERROR: $N is incomplete: its supersedes: names [[$P]], still unfinished beside it" "M8: … because P is still open beside it"
has "$err" "step 7.5" "M8: … naming the close-out that ends it"
hasnt "$err" "died" "M8: … and no cause it cannot know"
ln -s "$S/vault" "$S/vlink"
python3 "$RR" next --rollout "$S/vlink/Work/Tasks/$N.md" --tasks-dir "$T" --dry-run > "$S.out" 2> "$S.err"; rc=$?
ok "$rc" 1 "M8: … also when --rollout reaches N through a symlinked vault path"
python3 "$RR" next --rollout "$T/$N.md" --tasks-dir "$S/vlink/Work/Tasks" --dry-run > "$S.out" 2> "$S.err"; rc=$?
ok "$rc" 1 "M8: … or --tasks-dir does"

st() { python3 "$RR" status --rollout "$T/$1.md" --tasks-dir "$T" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(t["slug"] + "=" + t["queueState"] for t in sorted(d["tasks"], key=lambda t: t["slug"])))'; }
ok "$(st $N)" "b=awaiting-integration d=queued e=running f=set-aside i=awaiting-integration" "M9: status on N reads the carried queue"
ok "$(st $P)" "a=merged c=merged g=folded h=other" "M9: status on P keeps the landed, folded and other tasks"

fmset $P.md status done; fmset $P.md superseded_by "\"[[$N]]\""
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "file $P $P.md|0" "M10: stamped but not moved -> file"
mkdir -p "$T/Archive"; mv "$T/$P.md" "$T/Archive/"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "file $P Archive/$P.md|0" "M10: … after the daily sweep filed it into bare Archive/ -> file from there"

mkdir -p "$T/Archive/Rollouts"; mv "$T/Archive/$P.md" "$T/Archive/Rollouts/"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N|0" "M11: N (never started, its tasks keep started:/ready:) is superseded on --regenerate"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse $N|3" "M11: … and refused without it"

J=$(python3 "$RR" next --rollout "$T/$N.md" --tasks-dir "$T" --dry-run)
ok "$(printf '%s' "$J" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps([d["start"], d["running"], d["awaitingIntegration"], d["slotsInUse"]]))')" \
  '[["d"], ["e"], ["b", "i"], 1]' "M12: next on N starts d; e holds the one slot; b and i await Integration"

# ── I1-I7: § 0 finishes an interrupted supersede, then the run is cancelled ──────────────────────────
scen i
mkro $P.md "$R" "$DEMO" "$PAUSED"
mkt b.md $P review "pr: $U/2" 'started: 2026-09-23T10:00+00:00'
mkt d.md $P open
mkt n1.md - open "$DEMO"
# The run that wrote N died before step 6's carry: N's queue names two carried tasks and a new one, n1.
render $N $P "$(row 1 b 'carried (awaiting-integration)')
$(row 2 d 'carried (queued)')
$(row 3 n1 —)"
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "interrupted $P $N|0" "I1: P paused + N never started naming it -> interrupted"
nx $N
ok "$rc" 1 "I1: next refuses N before the finish"

# § 0's finish: stamp N incomplete (it still carries the stamp it was born with), carry, close P out. Then
# the user cancels at step 1.
fmset $N.md incomplete true
ok "$(grep -c '^incomplete:' "$T/$N.md")" 1 "I2: the finish's stamp on a note born incomplete stays one line"
carry --from "$T/$P.md" --to "$T/$N.md"
ok "$rc" 0 "I2: the finish's carry exits 0"
closeout $P $N
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N|0" "I2: the re-run check supersedes N"
has "$err" "WARN: $N is incomplete (it carries incomplete: true" "I2: … and WARNs that N is incomplete"
chk --repo "$R" --project Demo
ok "$out|$rc" "refuse $N|3" "I2: after the cancel, a run without --regenerate refuses N"
has "$err" "$N is incomplete: it carries incomplete: true" "I2: … saying N is incomplete"
has "$err" "never /thread:execute [[$N]] as written" "I2: … and forbidding execute"

nx $N
ok "$rc|$out" "1|" "I3: next refuses the cancelled N (no JSON): P is closed, so only the stamp holds it"
has "$err" "ERROR: $N is incomplete: it carries incomplete: true" "I3: … naming the stamp"
has "$err" "never run it as written; supersede it with /thread:schedule Demo --regenerate" "I3: … and the remedy, naming its project"
has "$(inc $N)" "it carries incomplete: true" "I3: status reports it incomplete"

fmset n1.md rollout "\"[[$N]]\""
nx $N
ok "$rc" 1 "I4: the stamp alone holds back a note whose every row links back (an all-carried queue)"
has "$(inc $N)" "it carries incomplete: true" "I4: status still reports it"

# A run that reached step 7's end removed the stamp: N's rows are never judged after that.
step7end $N
nx $N
ok "$rc|$(starts)" "0|['d', 'n1']" "I5 control: no stamp, P closed -> next runs N"
ok "$(inc $N)" "None" "I5 control: status reports nothing incomplete"

python3 "$RR" defer --tasks d --tasks-dir "$T" > /dev/null
nx $N
ok "$rc|$(starts)" "0|['n1']" "I6: a task taken out after step 7 (its row left in place) never wedges N"
ok "$(inc $N)" "None" "I6: … and status reports nothing incomplete"
fmset d.md rollout "\"[[$N]]\""

fmset $N.md incomplete true
N2=demo-rollout-2026-10-01-2
render $N2 $N "$(row 1 b 'carried (awaiting-integration)')
$(row 2 d 'carried (queued)')
$(row 3 n1 'carried (queued)')"
carry --from "$T/$N.md" --to "$T/$N2.md"
ok "$rc" 0 "I7: a later --regenerate carries N's tasks into N2"
nx $N2
ok "$rc" 1 "I7: N2 is refused until its own step 7 ends"
step7end $N2
closeout $N $N2
chk --repo "$R" --project Demo --regenerate
ok "$out|$rc" "supersede $N2|0" "I7: once N is closed out, only N2 is unfinished"
hasnt "$err" "incomplete" "I7: … and nothing is incomplete"
nx $N2
ok "$rc" 0 "I7: next runs N2"

# ── D1-D3: a task taken out of a rollout whose step 7 ended never wedges its queue ──────────────────
# D1: the queue has run (a started), then repair defers the started task, so the note reads never started again.
scen d1
render ro-d - "$(row 1 a —)
$(row 2 e —)
$(row 3 g —)"
mkt a.md ro-d in_progress 'owner: execute-d' 'started: 2026-10-01T10:00+00:00'
mkt e.md ro-d open
mkt g.md ro-d open
step7end ro-d
nx ro-d
ok "$rc|$(starts)" "0|['e', 'g']" "D1: the started queue runs (a holds a slot)"
python3 "$RR" defer --tasks a --rollout "$T/ro-d.md" --tasks-dir "$T" > /dev/null
ok "$(fm a.md rollout)|$(fm a.md owner)|$(grep -c '\[\[a\\|' "$T/ro-d.md")" "<none>|<none>|1" \
  "D1: defer clears a's rollout: and owner:, and leaves its ## Queue row"
nx ro-d
ok "$rc|$(starts)" "0|['e', 'g']" "D1: started, then deferred: next still runs the queue"
ok "$(inc ro-d)" "None" "D1: … and status reports nothing incomplete"

# D2: three stamped rows, never started; a gate dropped after step 7 by clearing g's rollout: (its row left).
scen d2
render ro-g - "$(row 1 e —)
$(row 2 f —)
$(row 3 g —)"
mkt e.md ro-g open; mkt f.md ro-g open; mkt g.md ro-g open
step7end ro-g
python3 "$RR" defer --tasks g --tasks-dir "$T" > /dev/null
nx ro-g
ok "$rc|$(starts)" "0|['e', 'f']" "D2: a dropped task's leftover row never wedges a never-started queue"
chk --repo "$R" --project Demo
hasnt "$err" "is incomplete" "D2: … and the check never calls it incomplete"

# D3: the drop as schedule step 8 spells it: rollout: cleared, then its ## Queue row and ## File-sets line removed.
python3 - "$T/ro-g.md" <<'PY'
import sys
p = sys.argv[1]
lines = open(p).read().split("\n")
open(p, "w").write("\n".join(l for l in lines if "[[g\\|" not in l and not l.startswith("- g:")))
PY
ok "$(grep -c '\[\[g' "$T/ro-g.md")" 0 "D3: g's row is gone"
nx ro-g
ok "$rc|$(starts)" "0|['e', 'f']" "D3: … and next runs the rest"

# ---- running: the rollouts that may have a lead on the primary checkout (land.sh's hold, ADR 0031) ----
# run [args...] -> $out, $err, $rc
run() { python3 "$CHECK" running --tasks-dir "$T" "$@" > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
scen r1
run
ok "$rc|$out" "0|none" "R1: no rollout note → none"
mkro ro-live.md "$R"
mkro ro-other.md /elsewhere/repo   # any repo counts: every lead runs from the one primary checkout
ST=open PV=3 mkro ro-proto3.md "$R"
mkro ro-paused.md "$R" "$PAUSED"
ST=done mkro ro-done.md "$R"
ST=dropped mkro ro-dropped.md "$R"
mkdir -p "$T/Archive"; mkro Archive/ro-filed.md "$R"
mkt task.md ro-live open
run
ok "$rc|$out" "0|running ro-live
running ro-other" "R2: protocol 5, open, unpaused, live, in any repo; never protocol 3, paused, done, dropped or archived"
mkt done-task.md ro-done merged
mkro ro-ceremony.md "$R"; mkt t2.md ro-ceremony merged
run
has "$out" "running ro-ceremony" "R3: every task merged but its completion ceremony not run: still running"
python3 "$CHECK" running --tasks-dir "$S/nowhere" > "$S.out" 2> "$S.err"; rc=$?
ok "$rc|$(cat "$S.out")" "2|" "R4: a missing tasks dir is exit 2 with no stdout"

echo
if [ "$fail" -eq 0 ]; then echo "unfinished-rollout: ALL PASS"; else echo "unfinished-rollout: FAILED"; fi
exit "$fail"
