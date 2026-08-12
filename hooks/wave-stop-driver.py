#!/usr/bin/env python3
"""Stop-hook driver: keeps a wave rollout moving without user re-prompting.

The programmatic twin of a /goal condition, shipped with the plugin so the
user never has to type one (execute SKILL.md §8). On every session stop it
finds the last WAVE-STATUS line the assistant emitted — primarily from the
hook payload's `last_assistant_message` (race-free), falling back to a
transcript scan for history — and:

  running  -> block the stop (driving work remains: reconcile/merge/launch)
  waiting  -> allow (a wave's Workflow call is in flight; the completion
              notification or the heartbeat cron is the wake signal)
  halted   -> allow + clear driver state (a §7 stop condition; human's turn)
  done     -> allow + clear driver state (completion ceremony performed)
  (none)   -> allow (not a wave-driving session)

Blocking is bounded by a progress-aware cap: consecutive blocks without the
cursor advancing release the stop and surface the stall to the user instead
of spinning forever (the harness's own CLAUDE_CODE_STOP_HOOK_BLOCK_CAP is a
second, coarser floor). State lives per-session under
~/.claude/wave-driver/<session_id>.json (override dir with WAVE_DRIVER_STATE_DIR).
"""

import json
import os
import re
import sys

MAX_BLOCKS_WITHOUT_PROGRESS = 3
TAIL_BYTES = 5_000_000  # only scan the transcript's last ~5MB

STATUS_RE = re.compile(
    r"WAVE-STATUS:\s+(?P<slug>\S+)\s+cursor=(?P<k>\d+)/(?P<n>\d+)"
    r"\s+state=(?P<state>running|waiting|halted|done)"
)


def state_dir():
    return os.environ.get(
        "WAVE_DRIVER_STATE_DIR",
        os.path.expanduser("~/.claude/wave-driver"),
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


def last_wave_status(transcript_path):
    """Latest WAVE-STATUS match from an *assistant* text block, or None.

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
        if "WAVE-STATUS:" not in line:
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
    path = os.environ.get("WAVE_DRIVER_DEBUG")
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
        m = last_wave_status(transcript_path)

    debug(
        f"session={session_id} "
        f"last_msg_match={'yes' if last_msg and m and m.string is last_msg else 'no'} "
        f"match={'none' if m is None else m.group(0)}"
    )
    if m is None:
        return

    slug, cursor, total, state = m["slug"], int(m["k"]), int(m["n"]), m["state"]

    if state == "waiting":
        return

    if state in ("halted", "done"):
        driver = load_state(session_id)
        if slug in driver:
            del driver[slug]
            save_state(session_id, driver)
        return

    # state == running
    driver = load_state(session_id)
    entry = driver.get(slug, {"cursor": -1, "blocks": 0})
    if cursor > entry.get("cursor", -1):
        entry = {"cursor": cursor, "blocks": 0}

    if entry["blocks"] >= MAX_BLOCKS_WITHOUT_PROGRESS:
        print(json.dumps({
            "systemMessage": (
                f"wave-driver: released the stop after {entry['blocks']} continuations "
                f"without cursor progress — [[{slug}]] still reports state=running at "
                f"cursor {cursor}/{total}. Likely wedged: run /thread:status or /thread:repair."
            )
        }))
        return

    entry["blocks"] += 1
    driver[slug] = entry
    save_state(session_id, driver)

    print(json.dumps({
        "decision": "block",
        "reason": (
            f"WAVE-DRIVER: [[{slug}]] is mid-rollout (cursor {cursor}/{total}, state=running) — "
            "the turn ended with driving work outstanding. Continue the §4.5 per-wave loop now: "
            "reconcile the finished wave if one returned, merge via merge-wave.sh, advance the "
            "cursor, and launch the next wave. Then end the turn with the correct line: "
            f"`WAVE-STATUS: {slug} cursor=<K>/{total} state=waiting` after launching a wave, "
            "state=halted with reason=\"…\" if a §7 stop condition fired, or state=done after the "
            "completion ceremony. Do not end the turn while state=running."
        ),
    }))


if __name__ == "__main__":
    main()
