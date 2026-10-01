#!/usr/bin/env python3
"""unfinished-rollout.py — at most one unfinished rollout per repo (schedule § 0; ADR 0027, ADR 0030).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --repo <path>
        (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]

/thread:schedule § 0 runs it last, after the remote, landing-register and pushed-base checks, and acts on
the one line it prints. Stdlib only, python >= 3.9. No network. Git runs only as `git rev-parse
--local-env-vars` (to scrub repo-local env vars such as a hook's GIT_DIR, landing-register.py's rule) and
`git -C <path> remote get-url origin`. It writes nothing.

Terms (CONTEXT.md). A LIVE rollout note sits directly in the tasks dir (location only, as
reconcile-project.py and /thread:close read it). An UNFINISHED rollout is narrower: a live rollout that is
neither `done` nor `dropped` and still has a task not merged (or no task yet).

Rules.
- Candidate: a note directly in the tasks dir (never Archive/**), tagged `rollout`, status not done/dropped.
- Same repo: the realpaths of the note's expanded `Project root:` and of --repo are equal, or both origins
  are readable and equal once normalised (an `https://github.com/`, `git@github.com:` or
  `ssh://git@github.com/` prefix stripped, a trailing `/` then `.git` dropped, lower-cased; any other URL is
  compared whole). A Project root that is missing here, or not a git repo with an origin, is compared on its
  path only, with `WARN: <slug>: Project root <p> is not a git repo with an origin here: matched on its path
  only`; --repo the same (`WARN: --repo <p> …`). No `Project root:` line: `WARN: <slug>: no Project root
  line: not counted`.
- This project's: the run's project set is {norm(--project)}, or with --tasks the intersection of the named
  tasks' `projects:` (each note found root-first, then under Archive/); an empty intersection WARNs `the
  named tasks share no project`, and no rollout is then this project's. A candidate is this project's when
  norm(its `projects:`) meets that set; the filename never counts. norm: the wikilink's note name,
  lower-cased, every run of non-alphanumerics turned into `-`, trimmed.
- Complete: at least one linked task and every one merged (reconcile-rollout.py's queue states).
- Never started: reconcile-rollout.py's never_started (only execute's own marks).
- Eligible: this project's, and paused (`paused:`) or never started.
- Interrupted pair (P, N): both candidates, N's `supersedes:` names P, N never started, P paused or never
  started. N is the note an interrupted /thread:schedule wrote before its step 7 stamped N's tasks.
- Misfiled superseded note: tagged `rollout`, directly in the tasks dir or directly in Archive/ (where the
  daily sweep files it; never Archive/Rollouts/), `status: done`, a `superseded_by:` naming a note that
  exists under the tasks dir, same repo (any project: filing is housekeeping, as reconcile-project.py's
  rule 3). Archive/Rollouts/<name> already there, or a `superseded_by:` naming no note: a WARN, never a
  `file` line, so § 0 cannot loop on it.

Outcomes, the first that applies:
  1. A misfiled superseded note -> `file <slug> <path relative to the tasks dir>` (the first by slug), exit 0.
  2. Complete candidates are dropped with `WARN: <slug>: every task merged but its completion ceremony never
     ran (status <s>): run its ## Post-rollout steps — not counted as unfinished`, except a candidate in an
     interrupted pair or named by another candidate's `supersedes:` (never dropped, no ceremony WARN). The
     rest is U. U empty -> `none`, exit 0.
  3. U is exactly one interrupted pair {P, N} and N is this project's: with --regenerate `interrupted P N`,
     exit 0; without, `refuse P,N` (sorted), exit 3, and stderr says N is incomplete.
  4. U is one note X: eligible with --regenerate -> `supersede X`, exit 0. Otherwise `refuse X`, exit 3,
     with the remedy for its case (eligible: re-run with --regenerate; this project's, has run, not paused:
     let it finish, pause it, or hard-pause it, then --regenerate, or /thread:status then /thread:repair;
     another project's: wait, or /thread:status then /thread:repair).
  5. Two or more -> `refuse <a>,<b>,…` (sorted), exit 3; stderr lists each with its project and state, the
     incomplete line for each pair among them (a pair whose N is another project's: finish it with
     /thread:schedule <N's project> --regenerate), and /thread:repair for a candidate named by the
     `supersedes:` of a note that has run.

Output. stdout is exactly one line on exit 0 and 3: `none` | `supersede <slug>` | `interrupted <prior-slug>
<new-slug>` | `file <slug> <relpath>` | `refuse <slug>[,<slug>…]`. Slugs are filename stems; an unfinished
note is root-only, so `<tasks dir>/<slug>.md` is exact. `WARN:` lines go only to stderr and never change
stdout or the exit code. Exit 2 prints no stdout and one `unfinished-rollout:` stderr line: a missing or
non-directory --repo, neither or both of --project/--tasks, a --tasks note not found, a missing tasks dir,
or reconcile-rollout.py unloadable.
"""
import argparse
import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_TASKS_DIR = Path(os.path.expanduser("~/repos/obsidian/Work/Tasks"))
RR_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/reconcile-rollout.py"
RR_NAMES = ("Note", "_scan", "_queue_state", "_counts", "_project_root", "_wikilink_slug", "_scalar", "_status",
            "_valued", "never_started")
CLOSED = {"done", "dropped"}
GITHUB_PREFIXES = ("https://github.com/", "git@github.com:", "ssh://git@github.com/")


def die(msg):
    print(f"unfinished-rollout: {msg}", file=sys.stderr)
    sys.exit(2)


class Parser(argparse.ArgumentParser):
    """argparse's errors as the script's one-line exit 2 (subparsers inherit the class)."""

    def error(self, message):
        die(message)


def load_rr():
    """reconcile-rollout.py as a module (side-effect-free on import), as reconcile-project.py loads it."""
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location("reconcile_rollout", RR_SRC)
        if spec is None or spec.loader is None:
            raise ImportError("no loader for this path")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in RR_NAMES:
            getattr(mod, name)
        return mod
    except Exception as e:  # noqa: BLE001 — any failure to load is the same exit-2 condition
        die(f"cannot load {RR_SRC} (skills/execute/scripts/reconcile-rollout.py): {e}")


# ---- git ---------------------------------------------------------------------------------------

def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as landing-register.py scrubs them."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               timeout=30).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def norm_origin(url: str) -> str:
    low = url.lower()
    for prefix in GITHUB_PREFIXES:
        if low.startswith(prefix):
            rest = url[len(prefix):]
            if rest.endswith("/"):
                rest = rest[:-1]
            if rest.endswith(".git"):
                rest = rest[:-4]
            return "github.com/" + rest.lower()
    return url


def origin_of(path: Path, env):
    """The normalised origin URL of the git repo at path, or None (not a directory, not a repo, no origin)."""
    if not path.is_dir():
        return None
    try:
        r = subprocess.run(["git", "-C", str(path), "remote", "get-url", "origin"], env=env,
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    url = r.stdout.strip()
    return norm_origin(url) if r.returncode == 0 and url else None


# ---- projects ------------------------------------------------------------------------------------

def norm_project(rr, value) -> str:
    name = rr._wikilink_slug(rr._scalar(value)) or ""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def projects_of(rr, note):
    return {p for p in (norm_project(rr, v) for v in note.get_list("projects")) if p}


def project_label(rr, note) -> str:
    names = [rr._wikilink_slug(rr._scalar(v)) for v in note.get_list("projects")]
    return ", ".join(n for n in names if n) or "no project"


def find_task(tasks_dir: Path, slug: str):
    """A task note by name: the root copy, else the first under Archive/ (as reconcile-rollout's index)."""
    root = tasks_dir / f"{slug}.md"
    if root.is_file():
        return root
    archive = tasks_dir / "Archive"
    if archive.is_dir():
        found = sorted(archive.rglob(f"{slug}.md"))
        if found:
            return found[0]
    return None


# ---- the check -----------------------------------------------------------------------------------

def link_slug(rr, note, key) -> str:
    return (rr._wikilink_slug(rr._scalar(note.get(key))) or "").lower()


def tags_of(rr, note):
    return {rr._scalar(t).lower() for t in note.get_list("tags")}


def cmd_check(args, rr) -> int:
    repo = Path(os.path.expanduser(args.repo))
    if not repo.is_dir():
        die(f"--repo {args.repo}: not a directory")
    if (args.project is None) == (args.tasks is None):
        die("pass exactly one of --project and --tasks")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")

    warns = []
    env = git_env()
    repo_real = os.path.realpath(repo)
    repo_origin = origin_of(repo, env)
    if repo_origin is None:
        warns.append(f"WARN: --repo {args.repo} is not a git repo with an origin here: matched on its path only")

    # The run's project set.
    if args.project is not None:
        mine = {norm_project(rr, args.project)} - {""}
    else:
        slugs = [s.strip() for s in args.tasks.split(",") if s.strip()]
        if not slugs:
            die("--tasks names no task")
        sets = []
        for s in slugs:
            name = rr._wikilink_slug(s) or s
            path = find_task(tasks_dir, name)
            if path is None:
                die(f"--tasks {name}: no note at {tasks_dir / (name + '.md')} or under Archive/")
            try:
                sets.append(projects_of(rr, rr.Note(path)))
            except ValueError as e:
                die(f"--tasks {name}: {e}")
        mine = set.intersection(*sets)
        if not mine:
            warns.append("WARN: the named tasks share no project: no unfinished rollout counts as this project's")

    origins = {}

    def same_repo(slug, note, warn=True):
        root = rr._project_root(note)
        if root is None:
            if warn:
                warns.append(f"WARN: {slug}: no Project root line: not counted")
            return False
        if os.path.realpath(root) == repo_real:
            return True
        if str(root) not in origins:
            origins[str(root)] = origin_of(root, env)
        o = origins[str(root)]
        if o is None:
            if warn:
                warns.append(f"WARN: {slug}: Project root {root} is not a git repo with an origin here: "
                             "matched on its path only")
            return False
        return repo_origin is not None and o == repo_origin

    # Rollout notes directly in the tasks dir and directly in Archive/ (never Archive/Rollouts/ or deeper).
    notes = []
    for where, folder in (("root", tasks_dir), ("archive", tasks_dir / "Archive")):
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.md")):
            try:
                note = rr.Note(path)
            except (ValueError, OSError):
                continue
            if "rollout" in tags_of(rr, note):
                notes.append((path, note, where))

    # 1. A superseded note that was stamped but never moved into Archive/Rollouts/.
    stems = None
    misfiled = []
    for path, note, where in notes:
        target = link_slug(rr, note, "superseded_by")
        if rr._status(note) != "done" or not target or not same_repo(path.stem, note, warn=False):
            continue
        rel = path.name if where == "root" else f"Archive/{path.name}"
        if stems is None:
            stems = {p.stem.lower() for p in tasks_dir.rglob("*.md")}
        if target not in stems:
            warns.append(f"WARN: {path.stem}: superseded but filed at {rel}, and its superseded_by names no note "
                         f"([[{target}]]): resolve it by hand")
            continue
        if (tasks_dir / "Archive" / "Rollouts" / path.name).exists():
            warns.append(f"WARN: {path.stem}: superseded but filed at {rel}, and Archive/Rollouts/{path.name} "
                         "already exists: resolve the collision by hand")
            continue
        misfiled.append((path.stem.lower(), 0 if where == "root" else 1, path.stem, rel))
    if misfiled:
        _, _, slug, rel = min(misfiled)
        return finish(warns, f"file {slug} {rel}", 0)

    # The unfinished candidates on this repo.
    cands = {}
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or not same_repo(path.stem, note):
            continue
        linked = rr._scan(path, tasks_dir)[0]
        fresh, why = rr.never_started(note, linked)
        counts = rr._counts([dict(zip(("state", "setAsideAt"), rr._queue_state(t))) for _, t in linked])
        paused = rr._scalar(note.get("paused")) if rr._valued(note.get("paused")) else ""
        cands[path.stem.lower()] = {
            "slug": path.stem, "mine": bool(projects_of(rr, note) & mine), "label": project_label(rr, note),
            "paused": paused, "fresh": fresh, "why": why, "status": rr._status(note) or "no status",
            "complete": counts["total"] >= 1 and counts["merged"] == counts["total"],
            "supersedes": link_slug(rr, note, "supersedes"),
        }
    for c in cands.values():
        c["eligible"] = c["mine"] and (bool(c["paused"]) or c["fresh"])
        c["state"] = (f"paused {c['paused']}" if c["paused"] else "never started" if c["fresh"]
                      else f"has run: {c['why']}")

    pairs = []  # (P key, N key)
    for nk, n in cands.items():
        pk = n["supersedes"]
        if pk and pk != nk and pk in cands and n["fresh"] and (cands[pk]["paused"] or cands[pk]["fresh"]):
            pairs.append((pk, nk))
    paired = {k for pair in pairs for k in pair}
    named = {c["supersedes"] for k, c in cands.items() if c["supersedes"] and c["supersedes"] != k}

    # 2. A complete rollout whose ceremony never ran is not unfinished (unless a supersede names it).
    for k in sorted(cands):
        c = cands[k]
        if c["complete"] and k not in paired and k not in named:
            warns.append(f"WARN: {c['slug']}: every task merged but its completion ceremony never ran (status "
                         f"{c['status']}): run its ## Post-rollout steps — not counted as unfinished")
            del cands[k]
    pairs = [(p, n) for p, n in pairs if p in cands and n in cands]
    u = sorted(cands)
    if not u:
        return finish(warns, "none", 0)
    slugs_of = lambda keys: ",".join(cands[k]["slug"] for k in sorted(keys))  # noqa: E731

    # 3. One interrupted supersede, this project's.
    if len(u) == 2 and len(pairs) == 1 and set(pairs[0]) == set(u) and cands[pairs[0][1]]["mine"]:
        p, n = (cands[k] for k in pairs[0])
        if args.regenerate:
            return finish(warns, f"interrupted {p['slug']} {n['slug']}", 0)
        return finish(warns, f"refuse {slugs_of(u)}", 3, [incomplete(p, n)])

    # 4. One unfinished rollout.
    if len(u) == 1:
        x = cands[u[0]]
        if x["eligible"] and args.regenerate:
            return finish(warns, f"supersede {x['slug']}", 0)
        return finish(warns, f"refuse {x['slug']}", 3, [remedy(x)])

    # 5. Two or more.
    lines = [f"at most one unfinished rollout per repo, and this repo has {len(u)}:"]
    lines += [f"  - [[{cands[k]['slug']}]] ({cands[k]['label']}; {cands[k]['state']})" for k in u]
    for pk, nk in pairs:
        p, n = cands[pk], cands[nk]
        if n["mine"]:
            lines.append(incomplete(p, n))
        else:
            lines.append(f"{n['slug']} is incomplete: an interrupted /thread:schedule wrote it to supersede "
                         f"{p['slug']} and died before stamping its tasks: finish it with /thread:schedule "
                         f"{n['label'].split(', ')[0]} --regenerate; never /thread:execute [[{n['slug']}]] as written")
    for k in u:
        c = cands[k]
        if not c["fresh"] and c["supersedes"] in cands and (c["supersedes"], k) not in pairs:
            lines.append(f"{cands[c['supersedes']]['slug']} is named by the supersedes: of {c['slug']}, which "
                         "has since run: an interrupted supersede whose new rollout has since run: /thread:repair")
    lines.append("otherwise: let each finish, or /thread:status then /thread:repair the stuck one")
    return finish(warns, f"refuse {slugs_of(u)}", 3, lines)


def incomplete(p, n) -> str:
    return (f"{n['slug']} is incomplete: an interrupted /thread:schedule wrote it to supersede {p['slug']} and "
            f"died before stamping its tasks: re-run with --regenerate to finish and supersede it; never "
            f"/thread:execute [[{n['slug']}]] as written")


def remedy(x) -> str:
    s = x["slug"]
    if x["eligible"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo: re-run with "
                "--regenerate to supersede it (its unlanded tasks carry into the new rollout)")
    if x["mine"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}) has run and is not paused ({x['why']}): if a session "
                "drives it, let it finish or pause it (execute § Pausing); if none does, hard-pause it (stamp "
                f"`paused:` and a `## Pause log` line) and re-run with --regenerate; if stuck: /thread:status "
                f"[[{s}]], then /thread:repair [[{s}]]")
    return (f"unfinished rollout [[{s}]] is another project's ({x['label']}; {x['state']}): at most one unfinished "
            "rollout per repo: wait for it to finish, or /thread:status then /thread:repair")


def finish(warns, line, code, errors=()):
    for w in warns:
        print(w, file=sys.stderr)
    for e in errors:
        print(e, file=sys.stderr)
    print(line)
    return code


def main() -> int:
    p = Parser(prog="unfinished-rollout.py", description="At most one unfinished rollout per repo (schedule § 0).")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="print none | supersede | interrupted | file | refuse for this repo")
    c.add_argument("--repo", required=True, help="the target repo (the path schedule § 0 resolved)")
    c.add_argument("--project", default=None, help="the project schedule targets (a name or [[wikilink]])")
    c.add_argument("--tasks", default=None, help="comma-separated task slugs (a --tasks run): their shared projects")
    c.add_argument("--regenerate", action="store_true", help="this run may supersede (schedule --regenerate)")
    c.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    args = p.parse_args()
    rr = load_rr()
    return cmd_check(args, rr)


if __name__ == "__main__":
    sys.exit(main())
