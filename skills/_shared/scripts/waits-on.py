#!/usr/bin/env python3
"""waits-on.py: the cross-project wait lines on a rollout note (ADR 0078 d7; schedule step 7 and § Serial path S6).

    write --rollout <note> [--tasks-dir <dir>]

Rewrites the note's `## Waits on` section (skills/_shared/vault-grammar.md § Waits on, at the note's end, gone when
nothing waits) with one line per dependency that no rollout will land for its dependant:

    - [[<dependant>]] waits on [[<x>]] (<Project>, not scheduled)

A line is written for a task linked to the note (`rollout:`, reconcile-rollout.py's _scan) that has not landed, folded
or been dropped, and each `depends-on:` / `blocked-by:` entry (_dep_entries, followed through _fold_unit to its unit)
whose note exists, is not landed (_dep_status), shares no `projects:` entry with the dependant, and whose `rollout:` links
no live rollout (_live_rollout, schedule step 1's rule). A dependency on the dependant's own project is the queue's own
hold, and a missing note is `_dep_status`'s `note not found`. `<Project>` is the dependency's first project, or
`no project`.

Stdout: each line written, then `<slug>: N waits` or `<slug>: none`. Exit 0; 1 the note unreadable or unwritable (one
`ERROR: waits-on:` line); 2 usage. It writes only that note, is idempotent, and never blocks a schedule: its caller
carries a non-zero exit to its summary. estate-scan.py reads the section back for orient-all's next pass.
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
        for dep in rr._dep_entries(task):
            unit, entry, _folded = rr._fold_unit(dep, index)
            if entry is None or rr._dep_status(dep, index)[0]:
                continue
            theirs = project_names(rr, entry[1])
            if mine & {key for key, _name in theirs} or rr._live_rollout(tasks_dir, entry[1].get("rollout")):
                continue
            label = theirs[0][1] if theirs else "no project"
            out.append(f"- [[{path.stem}]] waits on [[{unit}]] ({label}, not scheduled)")
    return out


def main() -> int:
    p = argparse.ArgumentParser(prog="waits-on.py", description="Cross-project wait lines on a rollout note (ADR 0078 d7).")
    sub = p.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write", help="rewrite the note's `## Waits on` section")
    w.add_argument("--rollout", required=True, help="the rollout note's path")
    w.add_argument("--tasks-dir", default=os.path.expanduser("~/repos/obsidian/Work/Tasks"), help="the task-note dir")
    args = p.parse_args()
    path = Path(os.path.expanduser(args.rollout))
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))

    def error(msg):
        print(f"ERROR: waits-on: {path}: {msg}", file=sys.stderr)
        return 1

    rr = load_rr()
    try:
        note = rr.Note(path)
        lines = wait_lines(rr, path, tasks_dir)
    except (OSError, ValueError) as e:
        return error(f"cannot read: {e}")
    if lines:
        note.upsert_section(HEADING, "\n".join(lines))
    else:
        note.remove_section(HEADING)
    try:
        note.save()
    except OSError as e:
        return error(f"cannot write: {e}")
    for line in lines:
        print(line)
    print(f"{path.stem}: {len(lines)} waits" if lines else f"{path.stem}: none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
