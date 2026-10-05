# Shared fixture for tests/merge-task-*.test.sh. Source it after `. tests/lib/assert.sh`, with $root (the repo
# root) and $tmp (a fresh mktemp dir) set. GitHub's copy of origin is a real bare repo under a github.com/o/r.git
# path, so the kept owner/repo derivation reads o/r, and $tmp/repo clones it, so the script's fetch, its
# containment check and its ls-remote run for real. The fake gh (tests/fixtures/merge-task/fake-gh.py) serves
# every GitHub read and the merge from $MT_STATE; every interval is 0 and each read is tried twice.
mkdir -p "$tmp/bin"
cp "$root/tests/fixtures/merge-task/fake-gh.py" "$tmp/bin/gh"; chmod +x "$tmp/bin/gh"
export MT_STATE="$tmp/st" MT_SRV="$tmp/srv/github.com/o/r.git"
export MERGE_TASK_CHECK_INTERVAL=0 MERGE_TASK_STATE_INTERVAL=0 MERGE_TASK_CONFIRM_INTERVAL=0 \
       MERGE_TASK_READ_INTERVAL=0 MERGE_TASK_READ_TRIES=2 MERGE_TASK_HEAD_LAG_INTERVAL=0
unset MERGE_TASK_REINTEGRATE_MAX
export THREAD_EVENTS_DIR="$tmp/events"  # the Run record (run_record.py, ADR 0032) stays in temp
MT="$root/skills/execute/scripts/merge-task.sh"
gt() { git -c user.name=t -c user.email=t@t "$@"; }
gc() { gt -C "$tmp/repo" "$@"; }
git -c init.defaultBranch=master init -q --bare "$MT_SRV"
EMPTY=$(git --git-dir "$MT_SRV" mktree </dev/null)
mk() {  # mk <parent|""> [msg] — print a new real commit in srv (empty tree)
  if [ -n "$1" ]; then gt --git-dir "$MT_SRV" commit-tree "$EMPTY" -p "$1" -m "${2:-c}"
  else gt --git-dir "$MT_SRV" commit-tree "$EMPTY" -m "${2:-c}"; fi
}
git --git-dir "$MT_SRV" update-ref refs/heads/master "$(mk "" root)"
git -c init.defaultBranch=master clone -q "$MT_SRV" "$tmp/repo" 2>/dev/null
srvtip() { git --git-dir "$MT_SRV" rev-parse refs/heads/master; }
fresh() {  # a clean fake-gh state (default master, no merge queue, compare ahead) and no cap state
  rm -rf "$MT_STATE" "$tmp/repo/.claude/merge-task"; mkdir -p "$MT_STATE/pr"; echo false > "$MT_STATE/mq"
}
pair() {  # B := a new srv master commit (the integrated base, what GitHub's ref read returns); I := its child
  B=$(mk "$(srvtip)" base); git --git-dir "$MT_SRV" update-ref refs/heads/master "$B"
  I=$(mk "$B" head); printf '%s\n' "$B" > "$MT_STATE/base.seq"
}
mkpr() {  # mkpr <n> <head> [mergeStateStatus] [state] — PR n, audit-fix/t<n> into master; srv branch at <head>
  local d="$MT_STATE/pr/$1"
  rm -rf "$d"; mkdir -p "$d"
  echo "${4:-OPEN}" > "$d/state"; echo master > "$d/baseRefName"; echo "$2" > "$d/headRefOid"
  echo "audit-fix/t$1" > "$d/headRefName"; echo "${3:-CLEAN}" > "$d/mergeStateStatus"
  echo "https://github.com/o/r/pull/$1" > "$d/url"
  git --git-dir "$MT_SRV" update-ref "refs/heads/audit-fix/t$1" "$2"
}
run() {  # run <pr> <head> <base> — merge-task.sh on $tmp/repo: sets out and rc; gh.log holds this run's calls
  : > "$MT_STATE/gh.log"
  out=$(PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$MT" "$tmp/repo" "$@" 2>&1); rc=$?
}
sent() { cat "$tmp/repo/.claude/merge-task.status" 2>/dev/null; }
glog() { cat "$MT_STATE/gh.log" 2>/dev/null; }
nmerge() { grep -c '^pr merge .*--squash' "$MT_STATE/gh.log" 2>/dev/null; }
seed() {  # seed <n> <line…> — pre-seed PR n's base-moved counter
  local n="$1"; shift; mkdir -p "$tmp/repo/.claude/merge-task"; printf '%s\n' "$@" > "$tmp/repo/.claude/merge-task/$n.base-moved"
}
ctr() { cat "$tmp/repo/.claude/merge-task/$1.base-moved" 2>/dev/null; }
lacks() { case "$1" in *"$2"*) ok "[$1]" "no '$2'" "$3";; *) ok y y "$3";; esac; }
