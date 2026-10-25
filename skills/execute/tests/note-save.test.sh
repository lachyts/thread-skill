#!/usr/bin/env bash
# One lock for every script writer of a note (reconcile-rollout.py's Note.save): the canary's trip line, a reconcile
# verb's stamp and completion-verify --run's line land on the same rollout note from different processes. A save
# takes the note's lock, reads the note again, re-applies its own edits to what it read and writes it in place, so
# a concurrent writer's line is never lost and the note keeps its inode. Temp dirs only.
# Usage: bash note-save.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(mktemp -d)"
TMP="$(cd "$TMP" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_NOTE_LOCK_DIR="$TMP/locks"
export THREAD_EVENTS_DIR="$TMP/events"   # the Run record stays in temp (tests/contracts/run-record-hermetic.test.mjs)
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

LEG="$HERE/../scripts/leg.py"
# pyleg <code> — rr and leg loaded (leg loads rr in its main, so it is set here), the note's path as p
pyleg() { python3 - "$SCRIPT" "$LEG" "$N" <<PY
import importlib.util, sys
from pathlib import Path
def load(name, src):
    spec = importlib.util.spec_from_file_location(name, src); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
rr = load("rr", sys.argv[1]); leg = load("leg", sys.argv[2]); leg.rr = rr
p = Path(sys.argv[3])
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

# ── in place: the save writes the note itself (same inode), so its created time, tags and links stay ─────────
N="$TMP/ro3.md"; mknote "$N"
before=$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$N")
py 'a = rr.Note(p); a.set("ready", "y"); a.save()'
after=$(python3 -c 'import os,sys; print(os.stat(sys.argv[1]).st_ino)' "$N")
ok "$([ "$before" = "$after" ] && echo "in place" || echo replaced)|$(grep -c '^ready: y' "$N")" "in place|1" "in place: the save writes the note itself, never a new file"
ok "$(ls -A "$TMP" | grep -c 'ro3.md.*tmp')" 0 "in place: … and leaves no temp file"

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

# ── a no-op edit is not replayed: a stale remove never deletes what another writer just wrote ────────────────
N="$TMP/ro6.md"; mknote "$N"
py '
a = rr.Note(p); b = rr.Note(p)
b.set("pause_requested", "true"); b.save()
a.remove("pause_requested"); a.set("ready", "r"); a.save()
'
ok "$(grep -c '^pause_requested: true' "$N")|$(grep -c '^ready: r' "$N")" "1|1" "no-op: a remove of an absent key, replayed, keeps the other writer's fresh key"

# ── an edit computed from the note itself (apply) is re-applied: leg's log line survives a concurrent write ──
N="$TMP/ro7.md"; mknote "$N"
pyleg '
a = rr.Note(p); b = rr.Note(p)
b.append_line("## Git-env log", "- 2026-10-24T11:00+00:00 git-env trip [[y]] task: x; repo /r"); b.save()
a.set("owner", "leg-2"); leg.log_line(a, "- began: leg-2"); leg.log_line(a, "- step: two"); a.save()
'
t=$(cat "$N")
has "$t" "- began: leg-2" "apply: leg's Leg-log line lands after a concurrent writer's save"
has "$t" "- step: two" "apply: … and its second, in order"
has "$t" "git-env trip [[y]]" "apply: … beside the other writer's line"

# ── an edit save cannot re-apply fails closed: nothing written, an OSError naming the note ───────────────────
N="$TMP/ro8.md"; mknote "$N"
out=$(py '
a = rr.Note(p); b = rr.Note(p)
b.set("ready", "b"); b.save()
a._body += "- an edit no journal holds\n"; a.dirty = True
try:
    a.save(); print("saved")
except OSError as e:
    print("refused:", e)
' 2>&1)
has "$out" "refused:" "fail-closed: an unjournaled edit over a changed note is refused"
ok "$(grep -c 'an edit no journal holds' "$N")|$(grep -c '^ready: b' "$N")" "0|1" "fail-closed: … nothing written, the other writer's key kept"
py '
a = rr.Note(p); a._body += "- unchanged under it\n"; a.dirty = True; a.save()
'
ok "$(grep -c 'unchanged under it' "$N")" 1 "fail-closed: … the same edit on an unchanged note saves"

# ── a second save with nothing new writes nothing (so a note moved meanwhile is no error) ────────────────────
N="$TMP/ro9.md"; mknote "$N"
out=$(py '
a = rr.Note(p); a.set("ready", "s"); a.save(); os.rename(p, str(p) + ".moved")
try:
    a.save(); print("ok", a.dirty)
except OSError as e:
    print("refused:", type(e).__name__)
' 2>&1)
ok "$out" "ok True" "resave: a save with nothing new after a save is a no-op (dirty still reports the write)"

# ── a symlinked note: the save writes through to its target, keeping the link and the mode ──────────────────
mkdir -p "$TMP/real"; mknote "$TMP/real/t.md"; chmod 640 "$TMP/real/t.md"; ln -s "$TMP/real/t.md" "$TMP/link.md"
N="$TMP/link.md"
py 'a = rr.Note(p); a.set("ready", "l"); a.save()'
ok "$([ -L "$N" ] && echo link || echo file)|$(grep -c '^ready: l' "$TMP/real/t.md")|$(python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777))' "$TMP/real/t.md")" "link|1|0o640" "symlink: the link stays, its target takes the save, its mode kept"

# ── _set_body_lines outside a journaled edit is refused at once, so a missed site fails every test run ───────
out=$(N="$TMP/ro.md" py '
a = rr.Note(p)
try:
    a._set_body_lines(a._body.split("\n") + ["- x"]); print("allowed")
except RuntimeError as e:
    print("refused")
' 2>&1)
ok "$out" "refused" "journal: a direct _set_body_lines outside a journaled edit raises"

# ── leg's Queue row insert is re-applied: placed before the first queued row, found by its slug ─────────────
N="$TMP/ro10.md"
printf -- '---\ntags: [task, rollout]\n---\n\n## Queue\n\n| # | Task | Mode |\n|---|---|---|\n| 1 | [[t1]] | — |\n| 2 | [[t2]] | — |\n\n## Git-env log\n\n- first\n' > "$N"
pyleg '
a = rr.Note(p); b = rr.Note(p)
b.append_line("## Git-env log", "- second"); b.save()
a.apply(leg._insert_row, "| 9 | [[fix]] | — |", "t2"); a.save()
'
ok "$(grep -n '\[\[' "$N" | tr '\n' ' ')" "9:| 1 | [[t1]] | — | 10:| 2 | [[fix]] | — | 11:| 3 | [[t2]] | — | " "insert-row: the row lands before t2, renumbered, after a concurrent write"
ok "$(grep -c -- '- second' "$N")" 1 "insert-row: … beside the other writer's line"

# ── one lock per directory: every note in it shares the lock, so the lock files stay few ─────────────────────
out=$(N="$TMP/ro.md" py 'print(rr._note_lock_path(p) == rr._note_lock_path(p.with_name("other.md")))')
ok "$out" "True" "lock: two notes in one directory share one lock file"

echo
if [ "$fail" -eq 0 ]; then echo "note-save: ALL PASS"; else echo "note-save: FAILED"; fi
exit "$fail"
