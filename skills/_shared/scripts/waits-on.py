#!/usr/bin/env python3
"""waits-on.py: the cross-project wait lines on every live rollout note (ADR 0078 d7; schedule step 7, § Serial path S6,
orient-all § 2).

    write [--tasks-dir <dir>]

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

Stdout, per note by path: `<slug>: N waits` then its lines, or `<slug>: none`. Exit 0; 1 a note unreadable or unwritable
(one `ERROR: waits-on:` line each, the others still written) or no tasks dir; 2 usage. It writes only that section of
each note, through Note.save's lock and journal, so a running rollout's note keeps its other writers' lines. It is
idempotent, and never blocks a schedule: its caller carries a non-zero exit to its summary. estate-scan.py reads the
section back for orient-all's pass.
"""
import argparse
import importlib.util
import os
import sys
from pathlib import Path

HEADING = "## Waits on"
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


def wait_lines(rr, rollout_path: Path, tasks_dir: Path):
    linked, index = rr._scan(rollout_path, tasks_dir)
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


def live_rollouts(rr, tasks_dir: Path):
    """Every live rollout note's path, sorted: tagged `rollout`, directly in the tasks dir, neither done nor dropped."""
    return sorted(path for path, note in rr._walk_of(tasks_dir).notes.items()
                  if path.parent == tasks_dir and "rollout" in rr._tags(note)
                  and rr._status(note) not in rr.CLOSED_ROLLOUT_STATUSES)


def rewrite(rr, path: Path, tasks_dir: Path):
    """Rewrite one rollout note's section as it stands and return its lines. OSError or ValueError: nothing written."""
    note = rr.Note(path)
    lines = wait_lines(rr, path, tasks_dir)
    if lines:
        note.upsert_section(HEADING, "\n".join(lines))
    else:
        note.remove_section(HEADING)
    note.save()
    return lines


def main() -> int:
    p = argparse.ArgumentParser(prog="waits-on.py", description="Cross-project wait lines on every live rollout note (ADR 0078 d7).")
    sub = p.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write", help="rewrite `## Waits on` on every live rollout note")
    w.add_argument("--tasks-dir", default=os.path.expanduser("~/repos/obsidian/Work/Tasks"), help="the task-note dir")
    args = p.parse_args()
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        print(f"ERROR: waits-on: {tasks_dir}: no such directory", file=sys.stderr)
        return 1
    rr = load_rr()
    rc = 0
    for path in live_rollouts(rr, tasks_dir):
        try:
            lines = rewrite(rr, path, tasks_dir)
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
