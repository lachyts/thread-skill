#!/usr/bin/env bash
# One lock for every script writer of a note (reconcile-rollout.py's Note.save): the canary's trip line, a reconcile
# verb's stamp and completion-verify --run's line land on the same rollout note from different processes. A save
# takes the note's lock, reads the note again, re-applies its own edits to what it read and replaces the file
# atomically, so a concurrent writer's line is never lost and no reader ever sees a truncated note. Temp dirs only.
# Usage: bash note-save.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_NOTE_LOCK_DIR="$TMP/locks"
. "$HERE/../../../tests/lib/assert.sh"

mknote() {
  printf -- '---\ntags: [task, rollout]\nstatus: open\n---\n\n## Notes\n\nbody\n\n## Git-env log\n\n- 2026-10-24T09:00+00:00 first\n' > "$1"
}
# py <code> — the module as rr, the note's path as p
py() { python3 - "$SCRIPT" "$N" "$@" <<PY
import importlib.util, sys, os
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
p = Path(sys.argv[2])
$1
PY
}

# ── lost update: two writers load the note, both save; each one's edit survives ──────────────────────────────
N="$TMP/ro.md"; mknote "$N"
py '
a = rr.Note(p); b = rr.Note(p)
b.append_line("## Git-env log", "- 2026-10-24T10:00+00:00 git-env trip [[x]] task: refs/heads/main a→b; repo /r")
b.save()
a.set("paused", "2026-10-24T10:01+00:00")
a.append_line("## Git-env log", "- 2026-10-24T10:02+00:00 other")
a.append_section("## Pause log", "- paused")
a.save()
'
t=$(cat "$N")
has "$t" "git-env trip [[x]] task" "lost-update: the first writer's trip line survives the second writer's save"
has "$t" "paused: 2026-10-24T10:01+00:00" "lost-update: … and the second writer's frontmatter stamp lands"
has "$t" "10:02+00:00 other" "lost-update: … and its own line"
has "$t" "## Pause log" "lost-update: … and its own section"
ok "$(grep -c 'first' "$N")" 1 "lost-update: … the line both read is kept once"
ok "$(grep -c '^## Git-env log' "$N")" 1 "lost-update: … under one section heading"

# ── the edits re-applied in order: a set then a remove of the same key leaves it removed ─────────────────────
N="$TMP/ro2.md"; mknote "$N"
py '
a = rr.Note(p); b = rr.Note(p)
b.set("ready", "x"); b.save()
a.set("owner", "o"); a.remove("owner"); a.save()
'
ok "$(grep -c '^owner:' "$N")|$(grep -c '^ready: x' "$N")" "0|1" "order: set then remove → removed, the other writer's key kept"

# ── atomic: the save replaces the file (a new inode), never truncates it in place ────────────────────────────
N="$TMP/ro3.md"; mknote "$N"
before=$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$N")
py 'a = rr.Note(p); a.set("ready", "y"); a.save()'
after=$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$N")
ok "$([ "$before" != "$after" ] && echo replaced || echo "in place")" replaced "atomic: the save replaces the note, never a truncating write"
ok "$(ls -A "$TMP" | grep -c 'ro3.md.*tmp')" 0 "atomic: … and leaves no temp file"

# ── the lock: a save waits for the note's lock, and gives up with an error after its timeout ─────────────────
N="$TMP/ro4.md"; mknote "$N"
lock=$(py 'print(rr._note_lock_path(p))')
python3 -c 'import fcntl, os, sys, time
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
f = open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2], "w").close(); time.sleep(60)' "$lock" "$TMP/held" &
hp=$!
while [ ! -f "$TMP/held" ] && kill -0 "$hp" 2>/dev/null; do sleep 0.05; done
out=$(THREAD_NOTE_LOCK_TIMEOUT=1 py '
a = rr.Note(p); a.set("ready", "z")
try:
    a.save()
    print("saved")
except OSError as e:
    print("refused:", e)
' 2>&1)
kill "$hp" 2>/dev/null; wait "$hp" 2>/dev/null
has "$out" "refused:" "lock: a save while another process holds the note's lock times out with an OSError"
ok "$(grep -c '^ready: z' "$N")" 0 "lock: … and writes nothing"
py 'a = rr.Note(p); a.set("ready", "z"); a.save()'
ok "$(grep -c '^ready: z' "$N")" 1 "lock: once it is free the save lands"

# ── a note deleted under a writer is never resurrected by its save ────────────────────────────────────────────
N="$TMP/ro5.md"; mknote "$N"
out=$(py '
a = rr.Note(p); a.set("ready", "q"); os.unlink(p)
try:
    a.save()
    print("saved")
except OSError as e:
    print("refused:", type(e).__name__)
' 2>&1)
ok "$out|$([ -e "$N" ] && echo present || echo gone)" "refused: FileNotFoundError|gone" "gone: a note moved away under a writer is not written back"

echo
if [ "$fail" -eq 0 ]; then echo "note-save: ALL PASS"; else echo "note-save: FAILED"; fi
exit "$fail"
