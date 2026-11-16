# tests/lib/leg-fixtures.sh: the helpers shared by the four leg.py suites (p54-9): tests/leg.test.sh (L1-L16),
# tests/leg-land.test.sh (L17), tests/leg-rank.test.sh (L18) and tests/leg-security.test.sh (L19-L21). Sourced by each
# after its own preamble, which sets root, LEG, RR, TMP, NOW and holders (and the env); this file holds definitions
# only, so it binds no path and exports nothing at source time. bash 3.2-compatible (macOS).

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

S=""; V=""; T=""; RO=""
# scen <name>: a fresh vault $V (a git repo, tasks at $T), a launch folder $F, and the rollout stem $RO.
scen() {
  S="$TMP/$1"; V="$S/vault"; T="$V/Work/Tasks"; F="$S/launch"; RO="demo-rollout-2026-10-20"
  mkdir -p "$T" "$F"; git init -q "$V"; echo "== $1"
}
# mkro <post-rollout items> <row>... — the serial note; a row is `slug~alias~folder~surfaces cell`.
mkro() {
  local items=$1 i=1 r s al fo su; shift
  { printf -- '---\ntags:\n  - task\n  - rollout\nstatus: open\npriority: high\nprojects:\n  - "[[Demo]]"\n'
    printf -- 'captured: 2026-10-20\nprotocol_version: 5\nshape: serial\nsurfaces:\n  - "ext:x"\n%s---\n\n' "${EXTRA_FM:-}"
    printf -- '## Notes\n\nSerial-rollout plan.\n\n## How to execute\n\nLegs run it.\n\n## Queue\n\n'
    printf -- '| # | Task | Launch | Surfaces |\n|---|---|---|---|\n'
    for r in "$@"; do
      IFS='~' read -r s al fo su <<< "$r"
      printf '| %s | [[%s\\|%s]] | `%s` from `%s` | %s |\n' "$i" "$s" "$s" "$al" "$fo" "$su"; i=$((i+1))
    done
    printf -- '\n### Why this order\n\nIn order.\n\n## Surfaces\n\n- t: ext:x\n\n## Post-rollout\n\n'
    printf -- 'When every task is done, run the completion ceremony.\n\n1. Mark it done.\n\n'
    printf -- 'Rollout-specific items go here:\n\n%s\n' "$items"
  } > "$T/$RO.md"
}
# mkt <slug> [frontmatter line]... — a task of the chain, with a Verify line unless NOVERIFY is set.
mkt() {
  local s=$1 l; shift
  { printf -- '---\ntags: [task]\nstatus: open\nprojects:\n  - "[[Demo]]"\nrollout: "[[%s]]"\n' "$RO"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nDo %s.\n' "$s"
    [ -n "${NOVERIFY:-}" ] || printf '\n**Verify:** `test -f %s.done`\n' "$s"
  } > "$T/$s.md"
}
# rows <alias> <folder> <surfaces cell> <slug>... — row specs for mkro
rows() { local al=$1 fo=$2 su=$3 s; shift 3; for s in "$@"; do printf '%s~%s~%s~%s\n' "$s" "$al" "$fo" "$su"; done; }

# leg <verb> [args]… → $out $err $rc; common flags appended. SESS (default s1) is --session; SESS= passes none.
# CWD is the directory leg.py runs in (default $F); LEGENV adds env assignments.
leg() {
  local sess=()
  [ -n "${SESS-s1}" ] && sess=(--session "${SESS-s1}")
  out=$(cd "${CWD:-$F}" && env ${LEGENV:-} python3 "$LEG" "$@" --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" \
        --now "${LNOW:-$NOW}" ${sess[@]+"${sess[@]}"} 2>"$TMP/err"); rc=$?
  err=$(cat "$TMP/err")
}
# q <python expr over d> — read the last leg.py JSON
q() { python3 -c 'import json, sys; d = json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$out" "$1" 2>/dev/null; }
fm() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$T/$1.md" "$2"; }
logn() { grep -c -- "$1" "$T/$RO.md"; }
snap() { cp "$T/$RO.md" "$TMP/snap"; }
same() { cmp -s "$T/$RO.md" "$TMP/snap"; ok "$?" 0 "$1: the rollout note is byte-identical"; }
# finish <slug> [extra done args] — claim (as next proposes) and mark done, verify pass
finish() { leg claim --task "$1"; ok "$rc" 0 "claim $1"; leg done --task "$1" --verify pass "${@:2}"; ok "$rc" 0 "done $1"; }

# ---- repo helpers ------------------------------------------------------------------------------------------------
# mkrepo <dir> <origin url> — a repo on master; origin/master and origin/HEAD set by update-ref (no network)
mkrepo() {
  mkdir -p "$1"; git init -q "$1"; echo base > "$1/a.txt"; echo b > "$1/b.txt"
  git -C "$1" add -A; git -C "$1" commit -qm base; git -C "$1" remote add origin "$2"
  git -C "$1" update-ref refs/remotes/origin/master HEAD; git -C "$1" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/master
}
# tcommit <repo> <task> <file> <content> [subject] — a commit carrying `Task: [[task]]`
tcommit() {
  mkdir -p "$(dirname "$1/$3")"; printf '%s\n' "$4" > "$1/$3"; git -C "$1" add -A
  git -C "$1" commit -qm "${5:-✨ feat: $2 $3}" -m "Task: [[$2]]"
}
# pcommit <repo> <file> <content> <subject> — a peer's commit, no Task: line
pcommit() { mkdir -p "$(dirname "$1/$2")"; printf '%s\n' "$3" > "$1/$2"; git -C "$1" add -A; git -C "$1" commit -qm "$4"; }
# subst <file> <from> <to> — a whole-line replacement in place (no sed -i, whose flag differs by platform)
subst() { python3 -c 'import sys; p, a, b = sys.argv[1:4]; t = open(p).read(); open(p, "w").write(t.replace(a, b))' "$@"; }
# review <repo> <rev> [effort] [status] [repo field] → a review doc's path (outside the repo)
review() {
  local d; d=$(mktemp "$S/review.XXXXXX")
  printf -- '---\nrepo: %s\nhead: %s\ndiff_digest: abc123\nharness: claude\nengine: code-review\nmode: code\neffort: %s\nreviewed: 2026-10-20\nstatus: %s\n---\n\nfindings\n' \
    "${5:-$1}" "$(git -C "$1" rev-parse --short=7 "$2")" "${3:-xhigh}" "${4:-consumed}" > "$d"; echo "$d"
}
# work <repo> <task> <file> <content> — claim, a trailered commit, a consumed xhigh review, done
work() {
  leg claim --task "$2"; ok "$rc" 0 "claim $2"
  tcommit "$1" "$2" "$3" "$4"
  local d; d=$(review "$1" HEAD)
  leg done --task "$2" --verify pass --review "$d" --cwd "$1"; ok "$rc" 0 "done $2 (reviewed)"
}

# rcv [args]… — reconcile-rollout.py completion-verify on the chain's note → $out $err $rc
rcv() {
  out=$(python3 "$RR" completion-verify --rollout "$T/$RO.md" --tasks-dir "$T" --now "$NOW" "$@" 2>"$TMP/err"); rc=$?
  err=$(cat "$TMP/err")
}

refuse() {  # refuse <label> [stderr fragment] — begin is exit 1 and writes nothing
  snap; leg begin --cwd "$F"; ok "$rc" 1 "L8: $1 is exit 1"; same "L8: $1"
  [ -z "${2:-}" ] || has "$err" "$2" "L8: $1 … says $2"
}

lb() {  # lb <tag> <session> <verb> [args] — leg.py in the background; its rc lands in $TMP/<tag>.rc
  local tag=$1 sess=$2; shift 2
  ( cd "$F" && python3 "$LEG" "$@" --rollout "$T/$RO.md" --tasks-dir "$T" --vault "$V" --now "$NOW" --session "$sess" \
      > "$TMP/$tag.out" 2>&1; echo $? > "$TMP/$tag.rc" ) &
}

# cscen <name> — scen, with this scenario's own copy dir $S/chains
cscen() { scen "$1"; export THREAD_CHAIN_COPY_DIR="$S/chains"; rm -f "$THREAD_LAUNCH_ALIASES"; }
# crepo <dir> <origin url> — mkrepo, plus a .gitignore of the config files, a tracked launch folder sub/l and a tracked
# .claude/settings.json; then the gitignored config at the toplevel and in sub/l, and an un-ignored untracked file
crepo() {
  mkrepo "$1" "$2"
  printf '.mcp.json\n**/.mcp.json\n.claude/settings.local.json\n' > "$1/.gitignore"
  mkdir -p "$1/sub/l" "$1/.claude"; echo keep > "$1/sub/l/keep.txt"; echo '{}' > "$1/.claude/settings.json"
  git -C "$1" add -A; git -C "$1" commit -qm "ignore the config"; git -C "$1" update-ref refs/remotes/origin/master HEAD
  echo '{"m":1}' > "$1/.mcp.json"; echo '{"l":1}' > "$1/.claude/settings.local.json"; echo '{"s":1}' > "$1/sub/l/.mcp.json"
  echo loose > "$1/loose.txt"
}

# lscen <name> — L16k's fixture: crepo $R (on master) and two chains in it, A ($RO1, copy $C1) and B ($RO2, copy $C2);
# the caller writes their notes (RO=$RO1 / RO=$RO2, then mkro and mkt) and runs mkcopies
lscen() {
  cscen "$1"; R="$S/r"; crepo "$R" "https://github.com/o/$1.git"; RO1=$RO; RO2=demo2-rollout-2026-10-20
  C1="$S/chains/r-$RO1"; C2="$S/chains/r-$RO2"
}
# mkcopies — both chains' copies (from $R), then RO back on $RO1
mkcopies() { RO=$RO2; CWD="$R" leg copies; RO=$RO1; CWD="$R" leg copies; }
# lands — the last land's `lands` as `state|why|waits` per copy, `;`-joined
lands() { q '";".join("%s|%s|%s" % (e["state"], e["why"], e["waits"]) for e in d["lands"])'; }
# master — $R's master (lscen's repo), as gscen and L17 read it
master() { git -C "$R" rev-parse master; }

# gscen <name> [B] — A's a1 (cell a1.txt) and B's b1 (cell b1.txt) both commit f.txt; A begins first (B with `B`)
gscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1; mkcopies
  if [ "${2:-}" = B ]; then RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; RO=$RO1; LNOW=2026-10-20T11:00+00:00 CWD="$C1" leg begin --cwd "$C1"
  else CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"; RO=$RO1; fi
  CWD="$C1" leg claim --task a1; mkdir -p "$C1/_shared/state/thread-events" "$C1/docs/reviews"
  echo e > "$C1/_shared/state/thread-events/run.jsonl"; echo r > "$C1/docs/reviews/r.md"
  tcommit "$C1" a1 f.txt "a's f"; d=$(review "$C1" HEAD)
  CWD="$C1" leg done --task a1 --verify pass --review "$d" --cwd "$C1"; ok "$rc" 0 "$1: done a1"
  RO=$RO2; CWD="$C2" work "$C2" b1 f.txt "b's f"; m0=$(master)
}

# holdlock <lock file> <flag> — an outside holder of a lock; $hp its pid, recorded for cleanup
holdlock() {
  mkdir -p "$(dirname "$1")"
  python3 -c 'import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); fcntl.flock(fd, fcntl.LOCK_EX); open(sys.argv[2], "w").write("held")
time.sleep(120)' "$1" "$2" &
  hp=$!; holders+=("$hp")
  local i=0; while [ ! -f "$2" ] && kill -0 "$hp" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i+1)); done
}
