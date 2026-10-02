#!/usr/bin/env python3
"""Stop-hook driver: keeps a queued rollout moving without user re-prompting (ADR 0030, p12-9).

The programmatic twin of a /goal condition, shipped with the plugin so the
user never has to type one (execute SKILL.md §8). On every session stop it
finds the last ROLLOUT-STATUS line the assistant emitted —

  ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=<running|waiting|halted|done>[ reason="…"]

— primarily from the hook payload's `last_assistant_message` (race-free),
falling back to a transcript scan for history, and:

  running  -> block the stop (driving work remains: reconcile a returned call,
              integrate and merge one task, fill the free slots via `next`)
  waiting  -> allow (a task call, an integrate call, a background Integration
              command or a merge hold is in flight; its notification or the
              heartbeat cron is the wake signal)
  halted   -> allow + clear driver state (a §7 stop condition; human's turn)
  done     -> allow + clear driver state (completion ceremony performed)
  (none)   -> allow (not a rollout-driving session)

The wave loop's old status line (`cursor=<K>/<N>`) no longer matches (that loop is
gone, ADR 0030), and neither does a line without `running=`.

Blocking is bounded by a progress-aware cap: consecutive blocks without
`merged` advancing release the stop and surface the stall to the user instead
of spinning forever (`running` alone never counts as progress; the harness's own
CLAUDE_CODE_STOP_HOOK_BLOCK_CAP is a second, coarser floor). State lives
per-session under ~/.claude/rollout-driver/<session_id>.json as
{<slug>: {"merged": K, "blocks": n}} (override the dir with
ROLLOUT_DRIVER_STATE_DIR; ROLLOUT_DRIVER_DEBUG names a file to append a debug
line to).
"""

import json
import os
import re
import sys

MAX_BLOCKS_WITHOUT_PROGRESS = 3
TAIL_BYTES = 5_000_000  # only scan the transcript's last ~5MB

STATUS_RE = re.compile(
    r"ROLLOUT-STATUS:\s+(?P<slug>\S+)\s+merged=(?P<k>\d+)/(?P<n>\d+)\s+running=(?P<r>\d+)"
    r"\s+state=(?P<state>running|waiting|halted|done)"
)


def state_dir():
    return os.environ.get(
        "ROLLOUT_DRIVER_STATE_DIR",
        os.path.expanduser("~/.claude/rollout-driver"),
    )


def state_path(session_id):
    return os.path.join(state_dir(), f"{session_id}.json")


def load_state(session_id):
    try:
        with open(state_path(session_id)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(session_id, state):
    os.makedirs(state_dir(), exist_ok=True)
    with open(state_path(session_id), "w") as f:
        json.dump(state, f)


def last_rollout_status(transcript_path):
    """Latest ROLLOUT-STATUS match from an *assistant* text block, or None.

    Only assistant-authored text counts — tool results and user messages can
    quote the line (docs, THREAD, status reports) without meaning it.
    """
    try:
        size = os.path.getsize(transcript_path)
        with open(transcript_path, encoding="utf-8", errors="replace") as f:
            if size > TAIL_BYTES:
                f.seek(size - TAIL_BYTES)
                f.readline()  # drop the partial line
            lines = f.readlines()
    except OSError:
        return None

    for line in reversed(lines):
        if "ROLLOUT-STATUS:" not in line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if obj.get("type") != "assistant":
            continue
        content = (obj.get("message") or {}).get("content")
        if isinstance(content, str):
            texts = [content]
        elif isinstance(content, list):
            texts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        else:
            continue
        # last match within the message wins
        match = None
        for text in texts:
            for m in STATUS_RE.finditer(text):
                match = m
        if match:
            return match
    return None


def debug(msg):
    path = os.environ.get("ROLLOUT_DRIVER_DEBUG")
    if path:
        with open(path, "a") as f:
            f.write(msg + "\n")


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return
    transcript_path = payload.get("transcript_path")
    session_id = payload.get("session_id", "unknown")

    # Primary source: the payload's own last_assistant_message — authoritative
    # for the turn that just ended, and immune to the transcript-write race
    # (the final message is flushed to the transcript file AFTER Stop hooks
    # fire; verified empirically on 2.1.199).
    m = None
    last_msg = payload.get("last_assistant_message")
    if isinstance(last_msg, str):
        for m2 in STATUS_RE.finditer(last_msg):
            m = m2  # last match in the message wins

    # Fallback: transcript history. Catches a driving session whose latest
    # turn forgot the status line (an older `running` still blocks, bounded
    # by the progress cap) and harness versions without the payload field.
    if m is None and transcript_path:
        m = last_rollout_status(transcript_path)

    debug(
        f"session={session_id} "
        f"last_msg_match={'yes' if last_msg and m and m.string is last_msg else 'no'} "
        f"match={'none' if m is None else m.group(0)}"
    )
    if m is None:
        return

    slug, merged, total, running, state = m["slug"], int(m["k"]), int(m["n"]), int(m["r"]), m["state"]

    if state == "waiting":
        return

    if state in ("halted", "done"):
        driver = load_state(session_id)
        if slug in driver:
            del driver[slug]
            save_state(session_id, driver)
        return

    # state == running. Progress is `merged` alone: a task call starting or returning changes `running`
    # without landing anything, so it never resets the count.
    driver = load_state(session_id)
    entry = driver.get(slug)
    if not isinstance(entry, dict) or "merged" not in entry:
        entry = {"merged": -1, "blocks": 0}
    if merged > entry.get("merged", -1):
        entry = {"merged": merged, "blocks": 0}

    if entry["blocks"] >= MAX_BLOCKS_WITHOUT_PROGRESS:
        print(json.dumps({
            "systemMessage": (
                f"rollout-driver: released the stop after {entry['blocks']} continuations "
                f"without merge progress — [[{slug}]] still reports state=running at "
                f"merged {merged}/{total} ({running} running). Likely wedged: run /thread:status or "
                "/thread:repair."
            )
        }))
        return

    entry["blocks"] += 1
    driver[slug] = entry
    save_state(session_id, driver)

    print(json.dumps({
        "decision": "block",
        "reason": (
            f"ROLLOUT-DRIVER: [[{slug}]] is mid-rollout (merged {merged}/{total}, {running} running, "
            "state=running) — the turn ended with driving work outstanding. Continue the §4.5 queue loop "
            "now: reconcile every returned call (reconcile-rollout.py reconcile), then integrate and merge "
            "one task at a time (Integration via lead-integrate.py prepare, then merge-task.sh, then "
            "mark-done), then run reconcile-rollout.py next and fill the free slots. Then end the turn "
            "with the correct line: "
            f"`ROLLOUT-STATUS: {slug} merged=<K>/{total} running=<R> state=waiting` while a call, a "
            "background Integration command or a merge hold is in flight, state=halted with reason=\"…\" "
            "if a §7 stop condition fired, or state=done after the completion ceremony. Do not end the "
            "turn while state=running."
        ),
    }))


if __name__ == "__main__":
    main()
