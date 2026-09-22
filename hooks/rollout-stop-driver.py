#!/usr/bin/env python3
"""Bounded Claude Stop continuation for protocol 4, using the durable host view.

The marker locates a record; it does not authorise work or report its status.
Only a private record owned by this native Claude session can continue. The
trusted plugin host supplies the read-only continuation decision; this hook
neither dispatches children nor implements convergence, merge or recovery.

Offline fixtures verify hook decisions, not live Claude wake delivery. Native
child completion and the execution heartbeat remain responsible for real waits.
"""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

MAX_BLOCKS_WITHOUT_PROGRESS = 3
TAIL_BYTES = 5_000_000
MARKER = re.compile(r"^[ \t]*THREAD-EXECUTION:[ \t]*(.*)$", re.MULTILINE)
WAVE_MARKER = re.compile(
    r"WAVE-STATUS:\s+\S+\s+cursor=\d+/\d+\s+state=(?:running|waiting|halted|done)"
)
HOST = Path(__file__).resolve().parent.parent / "skills/execute/scripts/rollout-host.mjs"


def marker_in(text):
    """Return (present, v4 marker); a later v3 marker takes over this session."""
    matches = list(MARKER.finditer(text)) if isinstance(text, str) else []
    waves = list(WAVE_MARKER.finditer(text)) if isinstance(text, str) else []
    if waves and (not matches or waves[-1].start() > matches[-1].start()):
        return True, None
    if not matches:
        return False, None
    try:
        value = json.loads(matches[-1].group(1))
    except ValueError:
        return True, None
    return True, value if isinstance(value, dict) else None


def assistant_texts(payload):
    """Newest assistant text first; never route from user or tool quotations."""
    if isinstance(payload.get("last_assistant_message"), str):
        yield payload["last_assistant_message"]
    filename = payload.get("transcript_path")
    if not isinstance(filename, str) or not filename:
        return
    try:
        with open(filename, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            if stream.tell() > TAIL_BYTES:
                stream.seek(-TAIL_BYTES, os.SEEK_END)
                stream.readline()
            else:
                stream.seek(0)
            lines = stream.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        return
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict) or entry.get("type") != "assistant":
            continue
        message = entry.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        texts = [content] if isinstance(content, str) else [
            block.get("text", "") for block in content or []
            if isinstance(block, dict) and block.get("type") == "text"
        ] if isinstance(content, list) else []
        for text in reversed(texts):
            yield text


def locate(payload):
    for text in assistant_texts(payload):
        present, value = marker_in(text)
        if present:
            return value
    return None


def supersedes_wave(payload):
    """Legacy routing seam: only a later private, owned v4 record supersedes v3."""
    session = payload.get("session_id")
    if not isinstance(session, str) or not session.strip():
        return False
    for text in assistant_texts(payload):
        if not isinstance(text, str):
            continue
        markers = [(match.start(), "wave", match) for match in WAVE_MARKER.finditer(text)]
        markers += [(match.start(), "rollout", match) for match in MARKER.finditer(text)]
        for _, kind, match in sorted(markers, reverse=True):
            if kind == "wave":
                return False
            try:
                marker = json.loads(match.group(1))
                if not isinstance(marker, dict) or not isinstance(marker.get("record"), str):
                    continue
                execution_id = marker.get("execution")
                if not isinstance(execution_id, str) or not execution_id.strip():
                    continue
                state, _ = read_record(Path(marker["record"]))
                if (owned(state, execution_id, session)
                        and state["execution"].get("status") in ("running", "pausing", "paused", "stopped", "ended")):
                    return True
            except (ValueError, OSError):
                continue
    return False


def private_stat(info, directory=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    return kind(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077


def read_record(directory):
    """Reject public or symlink authority; opening a descriptor avoids leaf swaps."""
    if not directory.is_absolute() or not private_stat(directory.lstat(), directory=True):
        raise ValueError("record directory is not a private owned directory")
    fd = os.open(directory / "state.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        if not private_stat(os.fstat(stream.fileno())):
            raise ValueError("state.json is not a private owned regular file")
        data = stream.read()
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError("state.json is not an object")
    return value, data


def owned(state, execution_id, session):
    execution = state.get("execution")
    if type(state.get("protocolVersion")) is not int or state["protocolVersion"] != 4:
        return False
    if not isinstance(execution, dict) or execution.get("id") != execution_id:
        return False
    owner = execution.get("owner")
    return (isinstance(owner, dict) and owner.get("harness") == "claude"
            and owner.get("session") == session
            and isinstance(owner.get("account"), str) and bool(owner["account"].strip()))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def progress(state):
    """Only durable work transitions count; no-op events cannot reset the cap."""
    execution = state["execution"]
    tasks = {}
    for task_id, task in state["tasks"].items():
        attempt = task.get("attempt") or {}
        tasks[task_id] = {
            "status": task.get("status"), "member": task.get("member"),
            "revision": task.get("revision", {}).get("hash"),
            "assessment": task.get("requiresAssessment"),
            "attempt": {key: attempt.get(key) for key in ("id", "generation", "superseded", "resultHash")},
            "approval": task.get("approval", {}).get("digest"), "outcome": task.get("outcome"),
        }
    host = state.get("host") or {}
    runs = {}
    for attempt_id, run in host.get("runs", {}).items():
        snapshot = run.get("snapshot") or {}
        runs[attempt_id] = {
            "initialisation": run.get("initialisation"), "status": snapshot.get("status"),
            "requests": [{key: request.get(key) for key in ("id", "status", "childId")}
                         for request in snapshot.get("requests", [])],
            "accepted": {key: value.get("envelopeHash") for key, value in run.get("accepted", {}).items()},
        }
    merges = {}
    for approval, operation in host.get("merges", {}).items():
        report = operation.get("report") or {}
        merges[approval] = {
            "status": operation.get("status"), "outcome": report.get("outcome"),
            "results": [{key: result.get(key) for key in ("state", "head", "mergeCommit")}
                        for result in report.get("results", [])],
            "verification": operation.get("verification"),
        }
    return digest({
        "execution": {key: execution.get(key) for key in ("id", "status", "epoch", "pools", "mergeHold")},
        "requests": {key: {field: request.get(field) for field in ("status", "childId", "attemptId")}
                     for key, request in execution.get("requests", {}).items()},
        "tasks": tasks, "runs": runs, "merges": merges,
    })


def counter_path(session, directory, execution_id):
    root = Path(os.environ.get("ROLLOUT_DRIVER_STATE_DIR", "~/.claude/rollout-driver")).expanduser()
    key = digest([session, str(directory.resolve()), execution_id])
    return root, root / (key + ".json")


def clear_counter(session, directory, execution_id):
    root, filename = counter_path(session, directory, execution_id)
    try:
        if private_stat(root.lstat(), directory=True):
            filename.unlink(missing_ok=True)
    except OSError:
        pass  # a terminal execution never gets resumed to repair driver metadata


def continuation_count(session, directory, execution_id, token):
    root, filename = counter_path(session, directory, execution_id)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not private_stat(root.lstat(), directory=True):
        raise ValueError("driver counter directory is not private")
    fd = os.open(filename, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as stream:
        if not private_stat(os.fstat(stream.fileno())):
            raise ValueError("driver counter is not private")
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            entry = json.load(stream)
        except ValueError:
            entry = {}
        count = entry.get("blocks", 0) if isinstance(entry, dict) and entry.get("progress") == token else 0
        if type(count) is not int or count < 0:
            count = 0
        if count < MAX_BLOCKS_WITHOUT_PROGRESS:
            count += 1
            stream.seek(0)
            json.dump({"progress": token, "blocks": count}, stream)
            stream.truncate()
            stream.flush()
            os.fsync(stream.fileno())
            return count
        return None


def incomplete(reference, reason):
    print(json.dumps({"systemMessage": (
        f"rollout-driver: execution incomplete; {reason}. Record: {reference}. "
        "No completion is implied. Inspect the canonical execution status and report the blocker."
    )}))


def main():
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError):
        return
    if not isinstance(payload, dict):
        return
    session = payload.get("session_id")
    if not isinstance(session, str) or not session.strip():
        return
    marker = locate(payload)
    if not marker:
        return
    path, execution_id = marker.get("record"), marker.get("execution")
    if not isinstance(path, str) or not path or not isinstance(execution_id, str) or not execution_id.strip():
        return
    directory = Path(path)
    try:
        state, before = read_record(directory)
    except (OSError, ValueError):
        return
    if not owned(state, execution_id, session):
        return
    status = state["execution"].get("status")
    if status in ("paused", "stopped", "ended"):
        clear_counter(session, directory, execution_id)
        return
    if status not in ("running", "pausing"):
        return
    reference = json.dumps({"record": str(directory), "execution": execution_id}, ensure_ascii=True)
    try:
        # Never execute the record's pinnedHost (or any other marker-supplied code).
        # This installed status command imports its own trusted state module and is read-only.
        result = subprocess.run(["node", str(HOST), "status", str(directory)],
                                capture_output=True, text=True, timeout=5, check=True)
        view = json.loads(result.stdout)
        current, after = read_record(directory)
        if before != after or not owned(current, execution_id, session):
            return  # concurrent host activity; re-inspect on the next native wake
        if (view.get("executionId") != execution_id or view.get("owner") != state["execution"]["owner"]
                or view.get("epoch") != state["execution"].get("epoch")
                or view.get("execution") != state["execution"]["status"]):
            raise ValueError("host view does not match the current owner and execution")
        decision = view.get("continuation")
        if (not isinstance(decision, dict) or type(decision.get("actionable")) is not bool
                or type(decision.get("waiting")) is not bool):
            raise ValueError("host has no compatible continuation view")
        if decision.get("needsAttention") is True:
            incomplete(reference, "the host requires attention: " + str(decision.get("reason", "unknown hold")))
            return
        if not decision["actionable"]:
            if not decision["waiting"]:
                incomplete(reference, "the host requires attention: " + str(decision.get("reason", "unknown hold")))
            return
        count = continuation_count(session, directory, execution_id, progress(state))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        incomplete(reference, "the driver could not safely inspect the host or persist its continuation limit")
        return
    if count is None:
        incomplete(reference, f"released after {MAX_BLOCKS_WITHOUT_PROGRESS} continuations without durable progress")
        return
    print(json.dumps({"decision": "block", "reason": (
        f"ROLLOUT-DRIVER: execution {execution_id} has actionable work in its authoritative record {reference}. "
        "Continue the protocol-4 execute driver through the canonical host using this native Claude session. "
        "Re-read status, reconcile actual native children, and advance only the work that status permits. "
        "A claimed request without a bound child requires evidence-based reconciliation, never blind redispatch. "
        "Respect pausing and all existing authority and allowances. Report the actual execution outcome; "
        "an ended execution may be incomplete. Finish with THREAD-EXECUTION: followed by the same record/execution JSON."
    )}))


if __name__ == "__main__":
    main()
