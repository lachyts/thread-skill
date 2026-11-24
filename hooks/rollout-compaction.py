#!/usr/bin/env python3
"""SessionStart hook (matcher `compact`): a compaction of a rollout's lead is counted on disk and sends the lead
back to its rules (ADR 0085 decisions 3 and 4, p55-4; execute SKILL.md § 1.5 *After a compaction*).

The harness cuts the skill text from context at a compaction, and a lead that carries on from its summary rebuilds
its commands from memory. So on every compaction of a session that leads a parallel rollout (the Run record's latest
`lead-entry` names the session), this hook adds one to that rollout's count on disk and prints one line into the
lead's context: the count, and the order to re-enter `/thread:execute [[<rollout>]]` at § 1 from the engine root
before the next launch. Under his pause, a standing room stop or an open halt the line says to start nothing now and
to take the entry that ends the stop from § 1; the order stays owed on disk until then. For any other session it
writes nothing and prints nothing.

The event. `SessionStart` fires with `source: "compact"` after an automatic or a manual compaction, and its
`hookSpecificOutput.additionalContext` is added to the session's context; `PreCompact`'s output becomes summary
instructions and `PostCompact` has no decision control, so neither can order the lead. The output is exactly

  {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "<one line per rollout>"}}

(`hookEventName` is required: without it the harness drops the context as a non-blocking error.)

It acts only when the payload's `hook_event_name` is `SessionStart` and its `source` is `compact`, it carries no
`agent_id` (a subagent's compaction is not the lead's; `agent_type` alone is a lead started with `--agent`, and is
counted) and its transcript is not an `agent-*.jsonl`. The candidate sessions are the payload's `session_id` and the
transcript's stem.

The logic is reconcile-rollout.py's `lead_compactions`, loaded by path from this hook's own tree with stderr
silenced: it holds the count file's shape, the stop reading, the root the line names and the line's forms, and its
docstring is their one copy. The hook runs from the Primary checkout while each rollout's lead runs on its own Engine
snapshot, so the count file and the `ROLLOUT-COMPACTION` line are cross-version contracts
(skills/_shared/engine-snapshot.md § Cross-version state): each only widens.

It fails open. Every error is swallowed, nothing reaches stderr and the exit is always 0: a hook error never blocks
a session. When it did not fire, or was cut by its timeout before its write, nothing was written, and the
heartbeat's clause (2e) (`reconcile-rollout.py compactions`) raises the count from the transcript's compaction marks
and gives the order at the next tick. It reads everything first, writes the count, then prints at once.

Python >= 3.9, stdlib only.
"""

import json
import os
import sys

RECONCILE_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills", "execute", "scripts",
                            "reconcile-rollout.py")


def _load_reconcile():
    """reconcile-rollout.py, loaded only for a compaction of a main session; importing it has no side effects."""
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("thread_reconcile_rollout", RECONCILE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decide(raw):
    """The hook's stdout for a payload, or None to stay silent (the module docstring's rules)."""
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        return None
    if payload.get("hook_event_name") != "SessionStart" or payload.get("source") != "compact":
        return None
    if payload.get("agent_id"):
        return None
    sessions = [payload.get("session_id")]
    transcript = payload.get("transcript_path")
    if isinstance(transcript, str) and transcript:
        base = os.path.basename(transcript)
        if base.startswith("agent-") and base.endswith(".jsonl"):
            return None
        if base.endswith(".jsonl"):
            sessions.append(base[:-len(".jsonl")])
    sessions = [s for s in sessions if isinstance(s, str) and s]
    if not sessions:
        return None
    rows = _load_reconcile().lead_compactions(sessions)
    lines = [r["line"] for r in rows if isinstance(r, dict) and isinstance(r.get("line"), str) and r["line"]]
    if not lines:
        return None
    return json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "\n".join(lines)}})


def main():
    out = None
    try:
        sys.stderr = open(os.devnull, "w")   # left so to the exit: nothing ever reaches stderr
        out = decide(sys.stdin.read())
    except Exception:  # noqa: BLE001 — the hook fails open: an error never blocks a session
        out = None
    if out:
        try:
            sys.stdout.write(out + "\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
