#!/usr/bin/env python3
"""waits-on.py: the cross-project wait lines on every live rollout note (ADR 0078 d7; schedule step 7, § 1.5's empty
queue, § Serial path S6, orient-all § 2).

    write [--tasks-dir <dir>] [--rollout <slug> --held <dependant>=<dependency>...]

Rewrites the `## Waits on` section (skills/_shared/vault-grammar.md § Waits on, at the note's end, gone when nothing
waits) of every live rollout note: tagged `rollout`, directly in the tasks dir, neither done nor dropped (_live_rollout's
rule). Every one, whichever project's, because a dependency released after a note was written (a supersede's `defer`, a
repair's defer, its rollout closed) reaches that note through no schedule of its own. Each gets one line per dependency
that no rollout will land for its dependant:

    - [[<dependant>]] waits on [[<x>]] (<Project>, not scheduled)

A line is written for a task linked to the note (`rollout:`, reconcile-rollout.py's _scan) that has not landed, folded
or been dropped, and each `depends-on:` / `blocked-by:` entry (_dep_entries, followed through _fold_unit to its unit,
one line per unit however many of a dependant's entries fold into it) whose note exists, is not landed (_dep_status),
shares no `projects:` entry with the dependant, and whose `rollout:` links no live rollout (_live_rollout, schedule
step 1's rule). A dependency on the dependant's own project is the queue's own hold, and a missing note is
`_dep_status`'s `note not found`. `<Project>` is the dependency's first project, or `no project`.

A held line has the same form, for a task schedule's Pre-flight left out (schedule § 3: a `waits` leaver, or a
dependant out through one), which no `rollout:` links to the note. `--held A=B` (repeatable, with `--rollout`, the
live rollout note the schedule wrote or joined, or at an empty queue this project's that § 0 named) writes `- [[A]] waits on [[B]] (...)` on that note. Every later rewrite,
by any caller, re-reads each line already in a note's section whose dependant the note does not link, keeps it while it
is still true and drops it once it is not: A has a note, has not landed, been folded or dropped, and its `rollout:` links
no live rollout (no schedule has taken it since); B, followed through _fold_unit, has a note, has not landed, and is
not in flight (its `rollout:` links no live rollout, its status neither in_progress nor review). That is a held line,
and also a linked task's own line once a defer (schedule step 6's, or repair's dependency-aware one) clears its
`rollout:`: a task deferred out of a rollout keeps its line there while it still waits, until a schedule takes it or
its dependency lands or goes in flight. The re-read lines follow the linked ones, sorted by dependant then dependency,
one per pair.

The section is computed inside Note.apply, from the note it is handed: when another writer changed the note since this
run read it, Note.save replays the edit on the fresh note, so a line another rewrite wrote meanwhile (a `--held` one
above all, which nothing else stores) is re-read there and kept while it is true, never lost.

Stdout, per note by path: `<slug>: N waits` then its lines, or `<slug>: none`. Exit 0; 1 a note unreadable or unwritable
(one `ERROR: waits-on:` line each, the others still written), no tasks dir, or a `--rollout` that names no live rollout
note (an `ERROR: waits-on:` line naming it: its `--held` lines are written nowhere, and every live note still gets its
rewrite); 2 usage (a `--held` without `--rollout`, or one not given as A=B: nothing written). It writes only that
section of each note, through Note.save's lock and journal, so a running rollout's note keeps its other writers' lines.
It is idempotent, and never blocks a schedule: its caller carries a non-zero exit to its summary. estate-scan.py reads
the section back for orient-all's pass.
"""
import argparse
import importlib.util
import os
import re
import sys
from pathlib import Path

HEADING = "## Waits on"
LINE = re.compile(r"^- \[\[(.+?)\]\] waits on \[\[(.+?)\]\] \((.+?), not scheduled\)$")  # estate-scan.py's WAITS_ON
IN_FLIGHT = ("in_progress", "in-progress", "review")
HERE = os.path.dirname(os.path.abspath(__file__))
RR_SRC = os.path.join(HERE, "..", "..", "execute", "scripts", "reconcile-rollout.py")


def load_rr():
    """reconcile-rollout.py as a module, for the note reads and writes a rollout note's other writers use."""
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("reconcile_rollout", RR_SRC)
    if spec is None or spec.loader is None:
        raise ImportError(f"no loader for {RR_SRC}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def project_names(rr, note):
    """The note's `projects:` as (normalised key, display name) pairs, in order."""
    return [(name.lower(), name) for name in (rr._wikilink_slug(rr._scalar(v)) for v in note.get_list("projects")) if name]


def wait_lines(rr, tasks_dir: Path, linked, index):
    out = []
    for path, task in sorted(linked, key=lambda pair: pair[0].stem.lower()):
        if rr._landed(task) or rr._status(task) in ("merged", "dropped"):
            continue
        mine = {key for key, _name in project_names(rr, task)}
        units = set()   # lower-cased: two entries folded into one unit are one wait
        for dep in rr._dep_entries(task):
            unit, entry, _folded = rr._fold_unit(dep, index)
            if entry is None or unit.lower() in units or rr._dep_status(dep, index)[0]:
                continue
            theirs = project_names(rr, entry[1])
            if mine & {key for key, _name in theirs} or rr._live_rollout(tasks_dir, entry[1].get("rollout")):
                continue
            units.add(unit.lower())
            label = theirs[0][1] if theirs else "no project"
            out.append(f"- [[{path.stem}]] waits on [[{unit}]] ({label}, not scheduled)")
    return out


def line_of(rr, dependant, unit, entry):
    theirs = project_names(rr, entry[1]) if entry else []
    return f"- [[{dependant}]] waits on [[{unit}]] ({theirs[0][1] if theirs else 'no project'}, not scheduled)"


def held_line(rr, tasks_dir: Path, index, dependant, dependency):
    """A held pair's line while it is still true (the module docstring), else None."""
    mine = index.get(dependant.lower())
    if mine is None or rr._landed(mine[1]) or rr._status(mine[1]) in ("merged", "dropped") \
            or rr._live_rollout(tasks_dir, mine[1].get("rollout")):
        return None
    unit, entry, _folded = rr._fold_unit(dependency, index)
    if entry is None or rr._dep_status(dependency, index)[0] or rr._status(entry[1]) in IN_FLIGHT \
            or rr._live_rollout(tasks_dir, entry[1].get("rollout")):
        return None
    return line_of(rr, mine[0].stem, unit, entry)


def held_lines(rr, note, tasks_dir: Path, linked, index, new_pairs=()):
    """The lines re-read from the note's section (each whose dependant it does not link: the module docstring), and
    new_pairs, each kept only while still true, sorted and one per (dependant, unit)."""
    own = {path.stem.lower() for path, _task in linked}
    pairs = []
    for line in note.section_text(HEADING).split("\n"):
        m = LINE.match(line.strip())
        if m and m.group(1).lower() not in own:
            pairs.append((m.group(1), m.group(2)))
    pairs += list(new_pairs)
    out, seen = [], set()
    for dependant, dependency in pairs:
        line = held_line(rr, tasks_dir, index, dependant, dependency)
        if line and line.lower() not in seen:
            seen.add(line.lower())
            out.append(line)
    return sorted(out, key=lambda x: tuple(g.lower() for g in LINE.match(x).group(1, 2)))


def live_rollouts(rr, tasks_dir: Path):
    """Every live rollout note's path, sorted: tagged `rollout`, directly in the tasks dir, neither done nor dropped."""
    return sorted(path for path, note in rr._walk_of(tasks_dir).notes.items()
                  if path.parent == tasks_dir and "rollout" in rr._tags(note)
                  and rr._status(note) not in rr.CLOSED_ROLLOUT_STATUSES)


def edit_section(n, rr, tasks_dir: Path, linked, index, linked_lines, new_pairs):
    """The section's edit, a Note.apply fn: linked_lines (wait_lines'), then the lines held_lines re-reads from n itself,
    so save()'s replay on a fresh note reads that note's section, never the one this run read."""
    lines = linked_lines + held_lines(rr, n, tasks_dir, linked, index, new_pairs)
    if lines:
        n.upsert_section(HEADING, "\n".join(lines))
    else:
        n.remove_section(HEADING)


def rewrite(rr, path: Path, tasks_dir: Path, new_pairs=()):
    """Rewrite one rollout note's section as it stands and return its lines as saved. OSError or ValueError: nothing
    written."""
    note = rr.Note(path)
    linked, index = rr._scan(path, tasks_dir)
    linked_lines = wait_lines(rr, tasks_dir, linked, index)
    note.apply(edit_section, rr, tasks_dir, linked, index, linked_lines, tuple(new_pairs))
    note.save()
    return [line for line in note.section_text(HEADING).split("\n") if line.strip()]


def rr_slug(raw):
    """A --held side as a bare slug: `[[x|alias]]`, `x.md` and a path cut as _wikilink_slug cuts them."""
    s = raw.strip().strip('"').strip("'").replace("[[", "").replace("]]", "")
    s = re.split(r"[|#^]", s, maxsplit=1)[0].strip().split("/")[-1].strip()
    return s[:-3] if s.endswith(".md") else s


def main() -> int:
    p = argparse.ArgumentParser(prog="waits-on.py", description="Cross-project wait lines on every live rollout note (ADR 0078 d7).")
    sub = p.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write", help="rewrite `## Waits on` on every live rollout note")
    w.add_argument("--tasks-dir", default=os.path.expanduser("~/repos/obsidian/Work/Tasks"), help="the task-note dir")
    w.add_argument("--rollout", help="the live rollout note the --held lines go on (schedule's own, the one it joined, "
                   "or at an empty queue this project's live one)")
    w.add_argument("--held", action="append", default=[], help="<dependant>=<dependency>: a task the Pre-flight held")
    args = p.parse_args()
    pairs = []
    for raw in args.held:
        a, sep, b = raw.partition("=")
        a, b = rr_slug(a), rr_slug(b)
        if not sep or not a or not b:
            p.error(f"--held {raw}: give it as <dependant>=<dependency>")
        pairs.append((a, b))
    if pairs and not args.rollout:
        p.error("--held needs --rollout")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        print(f"ERROR: waits-on: {tasks_dir}: no such directory", file=sys.stderr)
        return 1
    rr = load_rr()
    notes = live_rollouts(rr, tasks_dir)
    target, rc = None, 0
    if args.rollout:
        want = (rr._wikilink_slug(args.rollout) or "").lower()
        target = next((path for path in notes if path.stem.lower() == want), None)
        if target is None:
            # Never a stop: every other live note still gets its rewrite (schedule S6 runs one call per note).
            print(f"ERROR: waits-on: --rollout {args.rollout}: no live rollout note of that name in {tasks_dir}; "
                  f"its --held lines are written nowhere", file=sys.stderr)
            rc = 1
    for path in notes:
        try:
            lines = rewrite(rr, path, tasks_dir, pairs if path == target else ())
        except (OSError, ValueError) as e:
            print(f"ERROR: waits-on: {path}: {e}", file=sys.stderr)
            rc = 1
            continue
        print(f"{path.stem}: {len(lines)} waits" if lines else f"{path.stem}: none")
        for line in lines:
            print(line)
    return rc


if __name__ == "__main__":
    sys.exit(main())
