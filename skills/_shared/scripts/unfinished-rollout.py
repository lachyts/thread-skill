#!/usr/bin/env python3
"""unfinished-rollout.py — at most one unfinished parallel rollout per repo; serial chains limited by surfaces
(schedule § 0 and § Serial path; ADR 0027, ADR 0030, ADR 0040).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check [--shape parallel] --repo <path>
        (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --shape serial --surface <token>...
        (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]

/thread:schedule § 0 runs the parallel check last, after the remote, landing-register, self-rollout and pushed-base
checks, and acts on the one line it prints; § Serial path S3 runs the serial check once per chain. Stdlib only,
python >= 3.9. No network. Git runs only as `git rev-parse --local-env-vars` (to scrub repo-local env vars such as a
hook's GIT_DIR, landing-register.py's rule) and `git -C <path> remote get-url origin`. It writes nothing. The
surface grammar (parse_token, overlaps, read_surfaces) and norm_origin are serial-chains.py's, loaded by `check`
(never by `running`).

Terms (CONTEXT.md). A LIVE rollout note sits directly in the tasks dir (location only, as
reconcile-project.py and /thread:close read it). An UNFINISHED rollout is narrower: a live rollout that is
neither `done` nor `dropped` and still has a task not merged (or no task yet).

Rules.
- Candidate: a note directly in the tasks dir (never Archive/**), tagged `rollout`, status not done/dropped.
- Same repo: the realpaths of the note's expanded `Project root:` and of --repo are equal, or both origins
  are readable and equal once normalised (serial-chains.py's norm_origin: an `https://github.com/`,
  `git@github.com:` or `ssh://git@github.com/` prefix stripped, a trailing `/` then `.git` dropped, lower-cased;
  any other URL is compared whole). A Project root that is missing here, or not a git repo with an origin, is compared on its
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
- Awaiting sign-off (ADR 0034): paused with `paused_for: sign-off` (reconcile-rollout.py await-sign-off: the
  run finished everything else and closed, and only gates wait on Lachy). It is a `paused:` like any other
  (eligible, released by `running`); its state reads `awaiting sign-off since <stamp>: [[a]], [[b]]`, the
  linked tasks set aside at `gate`, and its refusal names the sign-off path.
- Interrupted pair (P, N): both candidates, N's `supersedes:` names P, N never started, P paused or never
  started. N is the note an interrupted /thread:schedule wrote and died before closing P out (step 7.5), so
  N's tasks may be unstamped.
- Incomplete: reconcile-rollout.py's incomplete (a never-started note that must not run as written: it
  carries `incomplete: true`, which every rollout note is born with until schedule step 7's (or § Serial path
  S6's) last write removes it, and which § 0 stamps on an interrupted supersede's note; or its `supersedes:`
  names a rollout still unfinished beside it). It never changes stdout or the exit code; it names the note as
  incomplete on stderr (a WARN beside `supersede`, a line of the refusal otherwise).
- Misfiled superseded note: tagged `rollout`, directly in the tasks dir or directly in Archive/ (where the
  daily sweep files it; never Archive/Rollouts/), `status: done`, a `superseded_by:` naming a note that
  exists under the tasks dir, same repo (any project: filing is housekeeping, as reconcile-project.py's
  rule 3). Archive/Rollouts/<name> already there, or a `superseded_by:` naming no note: a WARN, never a
  `file` line, so § 0 cannot loop on it.

Shape (ADR 0040). A rollout note's `shape:` (reconcile-rollout.py's _shape): `serial`, or `parallel` for no key,
`parallel` or anything else; a raw value other than empty, `parallel` or `serial` (case-folded) WARNs `<slug>:
unknown shape <v>: read as parallel`. The parallel check's rules and outcomes read parallel notes only (a serial
note is skipped before the same-repo test, so it never WARNs `no Project root line`), and a supersede never crosses
shapes. Serial notes are the root-level ones neither `done` nor `dropped` (serial_notes), with the same never-started,
incomplete and complete reads; a complete one is dropped with the ceremony WARN below.

Surfaces. Comparison is literal, on canonical tokens (serial-chains.py's grammar): the `--surface` values and each
serial note's `surfaces:` are compared as written; --repo and each parallel candidate's Project root go through
`os.path.realpath`, then the vault mapping (at or under the vault root: `vault` or `vault:<rel>`), else become
`repo:<realpath>`. The vault root is the tasks dir's grandparent, used only when the tasks dir ends in
`Work/Tasks`. Overlap is serial-chains.py's `overlaps`. A serial note with no `surfaces:`, or with a token
parse_token refuses, reads as `any`, with `WARN: <slug>: <why>: read as any`.

Outcomes (parallel, the default), the first that applies:
  1. A misfiled superseded note -> `file <slug> <path relative to the tasks dir>` (the first by slug), exit 0.
  2. Complete candidates are dropped with `WARN: <slug>: every task merged but its completion ceremony never
     ran (status <s>): run its ## Post-rollout steps — not counted as unfinished`, except a candidate in an
     interrupted pair or named by another candidate's `supersedes:` (never dropped, no ceremony WARN). The
     rest is U.
  2b. Unfinished serial notes whose surfaces overlap --repo's token (a live chain owns the places it writes) ->
     `refuse <their slugs, sorted>`, exit 3, one stderr line each: `[[s]] (<label>; <state>) is a serial chain that
     writes <token> and owns that place (ADR 0040): <remedy>`. The remedy names whose note it is: never started,
     run it (`/thread:execute [[slug]]` from its first row's launch) or stamp it `status: dropped`, which frees its
     tasks, an incomplete one with its incomplete line first; one that has run (a `## Leg log` counts), wait for it
     or /thread:status then /thread:repair. Else U empty -> `none`, exit 0.
  3. U is exactly one interrupted pair {P, N} and N is this project's: with --regenerate `interrupted P N`,
     exit 0; without, `refuse P,N` (sorted), exit 3, and stderr says N is incomplete.
  4. U is one note X: eligible with --regenerate -> `supersede X`, exit 0 (an incomplete X WARNs that this
     run finishes it). Otherwise `refuse X`, exit 3, with the remedy for its case (incomplete: the
     incomplete line; eligible: re-run with --regenerate, and for one awaiting sign-off (below) the
     waiting tasks carry still gate-pending, or sign off, then /thread:execute; this project's, has run,
     not paused: let it finish, pause it, or hard-pause it, then --regenerate, or /thread:status then
     /thread:repair; another project's: wait, or /thread:status then /thread:repair; another project's
     awaiting sign-off: it waits only on Lachy's sign-off of its waiting tasks: sign off each gate, then
     /thread:execute (it runs them and closes), or /thread:repair to defer them, then /thread:execute
     closes it).
  5. Two or more -> `refuse <a>,<b>,…` (sorted), exit 3; stderr lists each with its project and state, the
     incomplete line for each pair among them and for each other incomplete note (another project's note:
     finish it with /thread:schedule <its project> --regenerate), and /thread:repair for a candidate named
     by the `supersedes:` of a note that has run.

Serial mode (`--shape serial`, one call per chain, its tokens as repeatable `--surface`): no `file`, `supersede` or
`interrupted` outcome; with --regenerate, `WARN: a serial run supersedes nothing (ADR 0040, p24-2): --regenerate
ignored`. Hits are every unfinished serial note (any project) with a surface overlapping a --surface token, and
every parallel candidate (root-level, unfinished, not complete, any project) whose Project root's token overlaps
one (a missing Project root WARNs as above and is not counted). Hits -> `refuse <sorted>`, exit 3, one stderr line
each naming the note, its project, its state, the overlapping pair and its remedy; none -> `none`, exit 0. It reads
notes only: no git.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py running [--tasks-dir <dir>]

`running` answers primary-hold.sh (ADR 0031 says why): a live rollout note tagged `rollout` at the protocol
the schedule template writes, neither `done` nor `dropped`, not `paused:`, started (reconcile-rollout.py's
never_started is false) and with no `engine_snapshot:` stamp is RUNNING. A stamped note runs on its own Engine
snapshot, never on the Primary checkout, so it holds nothing (ADR 0043; skills/_shared/engine-snapshot.md); only a
rollout scheduled before P29 (or on a version-cache install) still does. stdout: `running <slug>` per rollout,
sorted, or `none` (a missing tasks dir included); exit 0.

Output (check). stdout is exactly one line on exit 0 and 3: `none` | `supersede <slug>` | `interrupted <prior-slug>
<new-slug>` | `file <slug> <relpath>` | `refuse <slug>[,<slug>…]`. Slugs are filename stems; an unfinished
note is root-only, so `<tasks dir>/<slug>.md` is exact. `WARN:` lines go only to stderr and never change
stdout or the exit code. Exit 2 prints no stdout and one `unfinished-rollout:` stderr line: a missing or
non-directory --repo, --repo with serial or --surface with parallel, no --surface with serial, a --surface token
parse_token refuses, neither or both of --project/--tasks, a --tasks note not found, a missing tasks dir, or
reconcile-rollout.py or serial-chains.py unloadable.
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
SC_SRC = Path(__file__).resolve().parent / "serial-chains.py"
TEMPLATE = Path(__file__).resolve().parent.parent.parent / "schedule/rollout-template.md"
RR_NAMES = ("Note", "_scan", "_queue_state", "_counts", "_project_root", "_wikilink_slug", "_scalar", "_status",
            "_valued", "never_started", "incomplete", "_shape", "SHAPES")
SC_NAMES = ("parse_token", "fmt_token", "overlaps", "overlap_pairs", "read_surfaces", "norm_origin")
CLOSED = {"done", "dropped"}
SC = None   # serial-chains.py, loaded by cmd_check (load_sc)


def die(msg):
    print(f"unfinished-rollout: {msg}", file=sys.stderr)
    sys.exit(2)


class Parser(argparse.ArgumentParser):
    """argparse's errors as the script's one-line exit 2 (subparsers inherit the class)."""

    def error(self, message):
        die(message)


def load_module(name, src, names, label):
    """A sibling script as a module (side-effect-free on import), as reconcile-project.py loads one."""
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location(name, src)
        if spec is None or spec.loader is None:
            raise ImportError("no loader for this path")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for n in names:
            getattr(mod, n)
        return mod
    except Exception as e:  # noqa: BLE001 — any failure to load is the same exit-2 condition
        die(f"cannot load {src} ({label}): {e}")


def load_rr():
    return load_module("reconcile_rollout", RR_SRC, RR_NAMES, "skills/execute/scripts/reconcile-rollout.py")


def load_sc():
    """serial-chains.py: the surface grammar and norm_origin (its one copy). `running` never loads it."""
    global SC
    if SC is None:
        SC = load_module("serial_chains", SC_SRC, SC_NAMES, "skills/_shared/scripts/serial-chains.py")
    return SC


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
    """serial-chains.py's norm_origin, the one copy (cmd_check loads it before the first origin_of call)."""
    return load_sc().norm_origin(url)


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


def rollout_notes(rr, tasks_dir: Path, archive: bool):
    """(path, note, "root" | "archive") for each note tagged `rollout` directly in the tasks dir and, with
    archive, directly in Archive/. A missing folder or an unreadable note yields nothing."""
    folders = (("root", tasks_dir), ("archive", tasks_dir / "Archive")) if archive else (("root", tasks_dir),)
    for where, folder in folders:
        for path in sorted(folder.glob("*.md")):
            try:
                note = rr.Note(path)
            except (ValueError, OSError):
                continue
            if "rollout" in tags_of(rr, note):
                yield path, note, where


def vault_root(tasks_dir: Path):
    """The vault root's realpath (the tasks dir's grandparent) when the tasks dir ends in Work/Tasks, else None."""
    real = Path(os.path.realpath(tasks_dir))
    return str(real.parent.parent) if real.parts[-2:] == ("Work", "Tasks") else None


def path_token(path, vault):
    """A path as a canonical token, literally: its realpath, then the vault mapping, else ('repo', realpath). No git."""
    real = os.path.realpath(os.path.expanduser(str(path)))
    if vault is not None:
        rf, vf = real.casefold(), vault.casefold()
        if rf == vf:
            return ("vault", "")
        if rf.startswith(vf + "/"):
            return ("vault", real[len(vault) + 1:])
    return ("repo", real)


def shape_of(rr, slug, note, warns, warned):
    """reconcile-rollout.py's _shape, with a WARN (once per note) for a value it does not know."""
    raw = rr._scalar(note.get("shape")).lower()
    if raw not in ("",) + tuple(rr.SHAPES) and slug not in warned:
        warned.add(slug)
        warns.append(f"WARN: {slug}: unknown shape {raw}: read as parallel")
    return rr._shape(note)


def note_state(rr, path, note, tasks_dir, mine):
    """The read a candidate gets: this project's, its label, never started, paused, complete, incomplete."""
    linked, index = rr._scan(path, tasks_dir)
    fresh, why = rr.never_started(note, linked)
    counts = rr._counts([dict(zip(("state", "setAsideAt"), rr._queue_state(t))) for _, t in linked])
    paused = rr._scalar(note.get("paused")) if rr._valued(note.get("paused")) else ""
    sign_off = bool(paused) and rr._scalar(note.get("paused_for")).lower() == "sign-off"
    waiting = sorted(p.stem for p, t in linked if rr._queue_state(t) == ("set-aside", "gate")) if sign_off else []
    return {
        "slug": path.stem, "mine": bool(projects_of(rr, note) & mine), "label": project_label(rr, note),
        "paused": paused, "fresh": fresh, "why": why, "status": rr._status(note) or "no status",
        "signOff": sign_off, "waiting": waiting,
        "complete": counts["total"] >= 1 and counts["merged"] == counts["total"],
        "supersedes": link_slug(rr, note, "supersedes"), "incomplete": rr.incomplete(path, note, linked, index),
    }


def state_line(c) -> str:
    return (f"awaiting sign-off since {c['paused']}: {links(c['waiting'])}" if c["signOff"]
            else f"paused {c['paused']}" if c["paused"] else "never started" if c["fresh"]
            else f"has run: {c['why']}")


def ceremony_warn(c) -> str:
    return (f"WARN: {c['slug']}: every task merged but its completion ceremony never ran (status "
            f"{c['status']}): run its ## Post-rollout steps — not counted as unfinished")


def serial_notes(rr, notes, tasks_dir, warns, mine, warned):
    """The unfinished serial notes: root-level, `shape: serial`, neither done nor dropped, not complete (a complete
    one is dropped with the ceremony WARN), each with its state and its surfaces as tokens."""
    out = []
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) != "serial":
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        if c["complete"]:
            warns.append(ceremony_warn(c))
            continue
        c["state"] = state_line(c)
        raw, tokens, bad = SC.read_surfaces(note), [], None
        if not raw:
            bad = "no surfaces"
        for r in raw:
            try:
                tokens.append(SC.parse_token(r))
            except ValueError as e:
                bad = f"surfaces: {r} is not a surface token ({e})"
                break
        if bad:
            warns.append(f"WARN: {c['slug']}: {bad}: read as any")
            tokens = [("any", "")]
        c["tokens"] = tokens
        out.append(c)
    return out


def serial_remedy(s) -> str:
    """R3's remedy for a live serial note, naming whose note it is."""
    if s["fresh"]:
        drop = (f"run it (`/thread:execute [[{s['slug']}]]` from its first row's launch) or stamp [[{s['slug']}]] "
                "`status: dropped` to free its tasks (step 1 then takes them again), then re-run; declare `surfaces:` on "
                "its tasks before re-scheduling them if the claim was too broad")
        return f"{s['slug']} is incomplete: {s['incomplete']}; {drop}" if s["incomplete"] else drop
    return "wait for it to finish, or /thread:status then /thread:repair"


def run_projects(rr, args, tasks_dir, warns):
    """The run's project set: {norm(--project)}, or the intersection of the --tasks notes' projects."""
    if args.project is not None:
        return {norm_project(rr, args.project)} - {""}
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
    return mine


def cmd_check(args, rr) -> int:
    serial = args.shape == "serial"
    if serial:
        if args.repo is not None:
            die("--repo is the parallel check's; a serial check takes --surface")
        if not args.surface:
            die("--shape serial needs --surface <token>, one per token of the chain")
    else:
        if args.surface:
            die("--surface is the serial check's; a parallel check takes --repo")
        if args.repo is None:
            die("--repo <path> is required (the parallel check)")
        repo = Path(os.path.expanduser(args.repo))
        if not repo.is_dir():
            die(f"--repo {args.repo}: not a directory")
    if (args.project is None) == (args.tasks is None):
        die("pass exactly one of --project and --tasks")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    load_sc()
    surfaces = []
    for v in args.surface or []:
        try:
            surfaces.append(SC.parse_token(v))
        except ValueError as e:
            die(f"--surface {v}: {e}")

    warns, warned = [], set()
    vault = vault_root(tasks_dir)
    if serial:
        return check_serial(args, rr, tasks_dir, surfaces, vault, warns, warned)
    env = git_env()
    repo_real = os.path.realpath(repo)
    repo_origin = origin_of(repo, env)
    if repo_origin is None:
        warns.append(f"WARN: --repo {args.repo} is not a git repo with an origin here: matched on its path only")

    mine = run_projects(rr, args, tasks_dir, warns)

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
    notes = list(rollout_notes(rr, tasks_dir, archive=True))

    # 1. A superseded note that was stamped but never moved into Archive/Rollouts/ (a parallel one: a supersede
    # never crosses shapes).
    stems = None
    misfiled = []
    for path, note, where in notes:
        target = link_slug(rr, note, "superseded_by")
        if rr._status(note) != "done" or not target or rr._shape(note) == "serial" or \
                not same_repo(path.stem, note, warn=False):
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

    # The unfinished candidates on this repo (parallel notes: a serial one is skipped before the same-repo test).
    cands = {}
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial" \
                or not same_repo(path.stem, note):
            continue
        cands[path.stem.lower()] = note_state(rr, path, note, tasks_dir, mine)
    for c in cands.values():
        c["eligible"] = c["mine"] and (bool(c["paused"]) or c["fresh"])
        c["state"] = state_line(c)

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
            warns.append(ceremony_warn(c))
            del cands[k]
    pairs = [(p, n) for p, n in pairs if p in cands and n in cands]

    # 2b. A live serial chain owns the places it writes (ADR 0040): a parallel run on one is refused, before any
    # supersede (a supersede never crosses shapes).
    repo_tok = path_token(repo, vault)
    owners = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned):
        hit = next((tok for tok in s["tokens"] if SC.overlaps(repo_tok, tok)), None)
        if hit is not None:
            owners[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) is a serial chain that writes "
                                 f"{SC.fmt_token(hit)} and owns that place (ADR 0040): {serial_remedy(s)}")
    if owners:
        keys = sorted(owners, key=str.lower)
        return finish(warns, "refuse " + ",".join(keys), 3, [owners[k] for k in keys])
    u = sorted(cands)
    if not u:
        return finish(warns, "none", 0)
    slugs_of = lambda keys: ",".join(cands[k]["slug"] for k in sorted(keys))  # noqa: E731

    # 3. One interrupted supersede, this project's.
    if len(u) == 2 and len(pairs) == 1 and set(pairs[0]) == set(u) and cands[pairs[0][1]]["mine"]:
        p, n = (cands[k] for k in pairs[0])
        if args.regenerate:
            return finish(warns, f"interrupted {p['slug']} {n['slug']}", 0)
        return finish(warns, f"refuse {slugs_of(u)}", 3, [pair_incomplete(p, n)])

    # 4. One unfinished parallel rollout.
    if len(u) == 1:
        x = cands[u[0]]
        if x["eligible"] and args.regenerate:
            if x["incomplete"]:
                warns.append(f"WARN: {x['slug']} is incomplete ({x['incomplete']}): this run supersedes it, "
                             "which finishes it")
            return finish(warns, f"supersede {x['slug']}", 0)
        return finish(warns, f"refuse {x['slug']}", 3, [remedy(x)])

    # 5. Two or more.
    lines = [f"at most one unfinished rollout per repo, and this repo has {len(u)}:"]
    lines += [f"  - [[{cands[k]['slug']}]] ({cands[k]['label']}; {cands[k]['state']})" for k in u]
    for pk, nk in pairs:
        p, n = cands[pk], cands[nk]
        lines.append(pair_incomplete(p, n))
    for k in u:
        c = cands[k]
        if c["incomplete"] and k not in paired:
            lines.append(lone_incomplete(c))
    for k in u:
        c = cands[k]
        if not c["fresh"] and c["supersedes"] in cands and (c["supersedes"], k) not in pairs:
            lines.append(f"{cands[c['supersedes']]['slug']} is named by the supersedes: of {c['slug']}, which "
                         "has since run: an interrupted supersede whose new rollout has since run: /thread:repair")
    lines.append("otherwise: let each finish, or /thread:status then /thread:repair the stuck one")
    return finish(warns, f"refuse {slugs_of(u)}", 3, lines)


def check_serial(args, rr, tasks_dir, surfaces, vault, warns, warned) -> int:
    """Serial mode: the chain's tokens against every live serial note and every unfinished parallel rollout's root.
    It supersedes nothing and runs no git."""
    if args.regenerate:
        warns.append("WARN: a serial run supersedes nothing (ADR 0040, p24-2): --regenerate ignored")
    mine = run_projects(rr, args, tasks_dir, warns)
    notes = list(rollout_notes(rr, tasks_dir, archive=False))
    hits = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned):
        pairs = SC.overlap_pairs(surfaces, s["tokens"])
        if pairs:
            a, b = pairs[0]
            hits[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) is a live serial chain whose surface "
                               f"{SC.fmt_token(b)} overlaps this chain's {SC.fmt_token(a)} (ADR 0040: a chain owns the "
                               f"places it writes): {serial_remedy(s)}")
    for path, note, _ in notes:
        if rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial":
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        if c["complete"]:
            warns.append(ceremony_warn(c))
            continue
        root = rr._project_root(note)
        if root is None:
            warns.append(f"WARN: {c['slug']}: no Project root line: not counted")
            continue
        rtok = path_token(root, vault)
        a = next((x for x in surfaces if SC.overlaps(x, rtok)), None)
        if a is not None:
            hits[c["slug"]] = (f"[[{c['slug']}]] ({c['label']}; {state_line(c)}) is an unfinished parallel rollout "
                               f"whose Project root {root} ({SC.fmt_token(rtok)}) overlaps this chain's "
                               f"{SC.fmt_token(a)}: wait for it to finish, or /thread:status then /thread:repair")
    if hits:
        keys = sorted(hits, key=str.lower)
        return finish(warns, "refuse " + ",".join(keys), 3, [hits[k] for k in keys])
    return finish(warns, "none", 0)


def finish_with(x) -> str:
    """The re-run that supersedes x: --regenerate, or another project's own schedule run."""
    if x["mine"]:
        return "re-run with --regenerate to supersede it"
    return f"finish it with /thread:schedule {x['label'].split(', ')[0]} --regenerate"


def pair_incomplete(p, n) -> str:
    return (f"{n['slug']} is incomplete: an interrupted /thread:schedule wrote it to supersede {p['slug']} and "
            f"died before closing {p['slug']} out, so its tasks may be unstamped: {finish_with(n)}; never "
            f"/thread:execute [[{n['slug']}]] as written")


def lone_incomplete(x) -> str:
    return (f"{x['slug']} is incomplete: {x['incomplete']}: {finish_with(x)}; never /thread:execute "
            f"[[{x['slug']}]] as written")


def links(slugs) -> str:
    return ", ".join(f"[[{t}]]" for t in slugs) or "no task"


def remedy(x) -> str:
    s = x["slug"]
    if x["incomplete"]:
        return f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo, and {lone_incomplete(x)}"
    if x["eligible"] and x["signOff"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo: re-run with "
                "--regenerate to supersede it (its unlanded tasks carry into the new rollout; the waiting tasks carry "
                f"still gate-pending), or sign off, then /thread:execute [[{s}]]")
    if x["eligible"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo: re-run with "
                "--regenerate to supersede it (its unlanded tasks carry into the new rollout)")
    if x["mine"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}) has run and is not paused ({x['why']}): if a session "
                "drives it, let it finish or pause it (execute § Pausing); if none does, hard-pause it (stamp "
                f"`paused:` and a `## Pause log` line) and re-run with --regenerate; if stuck: /thread:status "
                f"[[{s}]], then /thread:repair [[{s}]]")
    if x["signOff"]:
        return (f"unfinished rollout [[{s}]] is another project's ({x['label']}; awaiting sign-off since {x['paused']}): "
                f"at most one unfinished rollout per repo: it waits only on your sign-off of {links(x['waiting'])}: sign "
                f"off each gate, then /thread:execute [[{s}]] (it runs them and closes), or /thread:repair [[{s}]] to "
                f"defer them, then /thread:execute [[{s}]] closes it")
    return (f"unfinished rollout [[{s}]] is another project's ({x['label']}; {x['state']}): at most one unfinished "
            "rollout per repo: wait for it to finish, or /thread:status then /thread:repair")


def cmd_running(args, rr) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    protocol = rr._scalar(rr.Note(TEMPLATE).get("protocol_version"))  # what schedule writes, what execute runs
    running = []
    for path, note, _ in rollout_notes(rr, tasks_dir, archive=False):
        if rr._status(note) in CLOSED or rr._scalar(note.get("protocol_version")) != protocol:
            continue
        if rr._valued(note.get("engine_snapshot")):
            continue   # ADR 0043: it runs on its Engine snapshot, so the Primary checkout is free to move
        if rr._valued(note.get("paused")) or rr.never_started(note, rr._scan(path, tasks_dir)[0])[0]:
            continue
        running.append(path.stem)
    print("\n".join(f"running {slug}" for slug in running) or "none")
    return 0


def finish(warns, line, code, errors=()):
    for w in warns:
        print(w, file=sys.stderr)
    for e in errors:
        print(e, file=sys.stderr)
    print(line)
    return code


def main() -> int:
    p = Parser(prog="unfinished-rollout.py", description="At most one unfinished parallel rollout per repo; serial "
                                                         "chains limited by surfaces (schedule § 0, § Serial path).")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="print none | supersede | interrupted | file | refuse for this repo or chain")
    c.add_argument("--shape", choices=("parallel", "serial"), default="parallel",
                   help="parallel (schedule § 0, the default) or serial (schedule § Serial path S3)")
    c.add_argument("--repo", default=None, help="the target repo (the path schedule § 0 resolved); parallel only")
    c.add_argument("--surface", action="append", default=None,
                   help="one of the chain's surface tokens, as serial-chains.py printed it (repeatable); serial only")
    c.add_argument("--project", default=None, help="the project schedule targets (a name or [[wikilink]])")
    c.add_argument("--tasks", default=None, help="comma-separated task slugs (a --tasks run): their shared projects")
    c.add_argument("--regenerate", action="store_true", help="this run may supersede (schedule --regenerate)")
    c.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    r = sub.add_parser("running", help="print the rollouts that may have a lead running on the primary checkout")
    r.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    args = p.parse_args()
    rr = load_rr()
    return cmd_running(args, rr) if args.cmd == "running" else cmd_check(args, rr)


if __name__ == "__main__":
    sys.exit(main())
