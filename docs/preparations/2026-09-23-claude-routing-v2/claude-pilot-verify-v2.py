#!/usr/bin/env python3
"""Read-only verifier: python3 -I /absolute/this-file.py --base FULL_COMMIT.

Stdout is exactly one JSON {mode, head} report. Invalid states exit 1. This
checks fixed document content and Git state, never native behaviour or task
dependency release. The host owns task-specific mode acceptance and chronology.
"""
import sys
sys.dont_write_bytecode = True

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

PILOT = "docs/pilots/claude-routing"
WORK_NAME, REVIEW_NAME = "work-policy.md", "review-policy.md"
ALLOWED = {f"{PILOT}/{WORK_NAME}", f"{PILOT}/{REVIEW_NAME}"}
LIMIT = 65536
WORK_LINES = """# Claude routing work policy
- Observed bindings: claude-opus-5-5 high, xhigh and max; claude-fable-5-1 max (Claude Code 2.1.280, 2026-09-23).
- Requested, resolved and runtime-observed model/effort are separate evidence; a requested or resolved setting is not an observation.
- Routing: normal work uses high for easy tasks and xhigh for hard tasks; the first substantive quality failure uses the same model's supported maximum.
- Recovery: only a failed maximum-effort quality correction may select available Fable at its supported maximum; verified Fable unavailability retains Opus maximum within remaining allowance.
- Infrastructure, missing authority, quota and schema failures do not count as quality failures.
- Calls and verifier reservations share the original task pool; spent, refused and interrupted reservations stay spent, and transitions never renew allowance.
- The maximum-effort capability probes used synthetic selectors; they do not prove a genuine quality-failure/correction transition, dependency release or ownership recovery.""".splitlines()
REVIEW_LINES = """- Independent review invokes the unmodified /code-review xhigh exactly once for the exact verified commit; command level and reasoning effort are separate.
- The review wrapper and built-in fork are distinct native children on the same Claude harness and account; both calls and concurrent slots are reserved from the original task pool.
- The wrapper uses a Skill-capable definition for its exact resolved model/effort; the actual wrapper and fork bindings must each be runtime-observed and match the requested route.
- A launch acknowledgement is not completion; the lead relays all completed fork findings verbatim to the same wrapper by native same-child messaging before its unchanged verdict is accepted.
- Opus xhigh, Opus maximum and Fable maximum review routes each require their own matching observed bindings; the earlier capability packet did not prove fork effort inheritance or the completed relay path.
- The prerequisite SHA-256 proves content equality only; task B releases through host dependsOn, A's actual verified merge and dispatch chronology.
- Missing or mismatched fork, invocation, commit or routing evidence holds acceptance; synthetic selectors and document hashes do not prove lifecycle transitions.
- The single verifier reports mode and exact head; baseline accepts baseline, task A accepts partial or complete, and task B accepts complete at candidate and postmerge gates. A final check cannot replace those gates.""".splitlines()


def content_lines(raw):
    if not isinstance(raw, bytes) or len(raw) > LIMIT:
        raise ValueError("invalid document bytes")
    # Blank lines may vary. Every nonblank line, including its order, is fixed:
    # comments, code fences, duplicate clauses and contradictory additions fail.
    return [line for line in raw.decode("utf-8").splitlines() if line]


def classify_documents(documents, head, base):
    if head == base:
        return "baseline" if documents is None else "invalid"
    if not isinstance(documents, dict) or set(documents) not in (
            {WORK_NAME}, {WORK_NAME, REVIEW_NAME}):
        return "invalid"
    try:
        if content_lines(documents[WORK_NAME]) != WORK_LINES:
            return "invalid"
        if REVIEW_NAME not in documents:
            return "partial"
        digest = hashlib.sha256(documents[WORK_NAME]).hexdigest()
        required = ["# Claude routing review policy",
                    f"Prerequisite: {PILOT}/{WORK_NAME} sha256 {digest}"] + REVIEW_LINES
        return "complete" if content_lines(documents[REVIEW_NAME]) == required else "invalid"
    except (UnicodeError, ValueError):
        return "invalid"


def git(root, *arguments):
    # Do not let inherited repository/config selectors or replace refs change
    # the repository being checked. Disable fsmonitor callbacks and index locks.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_OPTIONAL_LOCKS="0", GIT_NO_REPLACE_OBJECTS="1",
               GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    result = subprocess.run(
        ["git", "--no-optional-locks", "-c", "core.fsmonitor=false",
         "-c", "core.untrackedCache=false", "-c", "core.ignoreStat=false",
         "-c", "core.hooksPath=" + os.devnull, *arguments], cwd=root,
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ValueError("Git evidence unavailable")
    return result.stdout


def clean(root):
    if git(root, "status", "--porcelain=v1", "--untracked-files=all",
           "--ignore-submodules=none", "-z"):
        raise ValueError("dirty repository")
    # Assume-unchanged/skip-worktree entries can hide dirty files from status.
    if any(entry[:2] != b"H " for entry in git(root, "ls-files", "-v", "-z").split(b"\0") if entry):
        raise ValueError("hidden index state")


def pilot_snapshot(root):
    """Walk each pilot parent without following symlinks; read regular files only."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    directory = os.open(root, flags)
    try:
        for component in PILOT.split("/"):
            try:
                child = os.open(component, flags, dir_fd=directory)
            except FileNotFoundError:
                return None
            os.close(directory)
            directory = child
        names = set(os.listdir(directory))
        if names - {WORK_NAME, REVIEW_NAME}:
            raise ValueError("extra pilot entry")
        documents = {}
        for name in names:
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                 dir_fd=directory)
            with os.fdopen(descriptor, "rb") as stream:
                metadata = os.fstat(stream.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > LIMIT:
                    raise ValueError("pilot entry is not a bounded regular file")
                documents[name] = stream.read(LIMIT + 1)
        return documents
    finally:
        os.close(directory)


def verify(root, head, base):
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", base):
        raise ValueError("base must be a full commit")
    if git(root, "cat-file", "-t", base).strip() != b"commit":
        raise ValueError("base is not a commit")
    if Path(os.fsdecode(git(root, "rev-parse", "--show-toplevel").strip())).resolve() != root:
        raise ValueError("run only at repository root")
    git(root, "merge-base", "--is-ancestor", base, head)
    clean(root)
    documents = pilot_snapshot(root)
    changed = {os.fsdecode(name) for name in git(root, "diff", "--name-only", "--no-renames",
               "--no-ext-diff", "--no-textconv", "-z", base, head, "--").split(b"\0") if name}
    if changed - ALLOWED:
        raise ValueError("out-of-scope change")
    if documents is not None:
        entries = git(root, "ls-tree", "-z", head, "--", *sorted(ALLOWED))
        tracked = {}
        for entry in entries.split(b"\0"):
            if not entry:
                continue
            metadata, path = entry.split(b"\t", 1)
            mode, kind, object_id = metadata.split()
            if mode != b"100644" or kind != b"blob":
                raise ValueError("pilot files must be ordinary non-executable tracked files")
            tracked[os.fsdecode(path).rsplit("/", 1)[-1]] = git(root, "cat-file", "blob", object_id.decode("ascii"))
        if tracked != documents:
            raise ValueError("worktree bytes differ from commit")
    mode = classify_documents(documents, head, base)
    clean(root)
    if git(root, "rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip() != head:
        raise ValueError("HEAD moved during verification")
    if pilot_snapshot(root) != documents:
        raise ValueError("pilot changed during verification")
    return mode


def main(arguments):
    head, mode = "", "invalid"
    try:
        root = Path.cwd().resolve()
        head = git(root, "rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip()
        if len(arguments) != 2 or arguments[0] != "--base":
            raise ValueError("expected --base FULL_COMMIT")
        mode = verify(root, head, arguments[1])
    except Exception:
        # The machine contract deliberately has no prose/error channel. A failure
        # is never a positive repository mode; inspect the preserved fixture/state.
        mode = "invalid"
    print(json.dumps({"mode": mode, "head": head}, separators=(",", ":")))
    return 1 if mode == "invalid" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
