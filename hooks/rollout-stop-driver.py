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
              command or a merge hold is in flight, or a retry cool-down,
              quota or infra, is pending (execute §4.5 step 1.5, ADR 0033),
              or a PR hold waits on its merge (`next` reports `halt: held`,
              reason="held until …", execute §4.5 step 1.5, vault-grammar
              § Hold until),
              or a Trickle wait stands (`next` holds a task on the machine-wide
              Trickle, execute §4.5 step 1.6, Chorus ADR 0104) or an Away-cap
              wait does (on the machine-wide Away cap while Lachy is Away,
              ADR 0049), or a last-starts
              wait stands (`next` holds a task on the last starts, with its
              reason="last start: …", §4.5 step 1.6, Chorus ADR 0104 d4), or a Heat hold
              stands (`heat: …`: the Mac is too hot to start a task, estate
              ADR 0009 d5); its notification or the heartbeat cron is the wake
              signal)
  halted   -> allow + clear driver state (a §7 stop condition; human's turn)
  done     -> allow + clear driver state (completion ceremony performed)
  (none)   -> allow (not a rollout-driving session)

A line without `merged=` and `running=` (a cursor-shaped one included) never
matches (ADR 0030: a rollout is a queue with no stored cursor).

STATUS_RE is a cross-version contract (ADR 0043; skills/_shared/engine-snapshot.md
§ Cross-version state): this hook runs from the Primary checkout, while each
rollout's lead runs on its own Engine snapshot and prints the line from that
version's prose. So the line's form only ever widens: a change that stops
matching a line an older snapshot prints is a migration, never a silent rewrite.

The halt's Run-record line (p29-10, ADR 0051; run_record.py's stop model). On
`state=halted`, and only when the match came from the payload's
`last_assistant_message` (never the transcript fallback, which can be old), the
hook records the halt as `stopped` {cause: halt, inferred: false, reason (the
line's reason="…", cut to 200 characters), calls (the Slots and lane the record
shows in flight)} in the rollout's Run record. It resolves <tasks dir>/<slug>.md
(reconcile-rollout.py's DEFAULT_TASKS_DIR, loaded lazily with stderr silenced)
and records nothing when: there is no note; the note is `shape: serial` (Legs
print halted lines, leg.py's status_line, but never run record-entry),
superseded, done or dropped; a pause stands (_pause_stands: the note's `paused:`
stamp or an open `paused` in the record, so a soft pause's drain and a sign-off
halt are no stop); or the last stopped line after the last lead-entry is already
a halt with the same reason. Recording never changes the hook's stdout or exit.
Cross-version: the line is a new kind only, which every older reader ignores; a
lead on an older Engine snapshot never writes the lead-entry that closes it,
hence the same-reason dedupe (readers end it at the next slot-taken, lane-taken
or run-bound).

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
# The halted line's reason="…" (the Run record's halt reason, p29-10): read after STATUS_RE's match, never part of it.
REASON_RE = re.compile(r'\s+reason="([^"]*)"')
SLUG_FILE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
RECONCILE_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills", "execute", "scripts",
                            "reconcile-rollout.py")


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


def _load_reconcile():
    """reconcile-rollout.py, loaded on first use (only a halted line needs it); importing it has no side effects."""
    import importlib.util
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("thread_reconcile_rollout", RECONCILE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def record_halt(m):
    """The halt's `stopped` line in the rollout's Run record (the module docstring's rules). Best-effort and silent:
    stdout is never written, stderr is silenced, and nothing raises."""
    saved = sys.stderr
    try:
        with open(os.devnull, "w") as quiet:
            sys.stderr = quiet
            slug = m["slug"]
            if not SLUG_FILE_RE.match(slug):
                return
            rc = _load_reconcile()
            path = rc.DEFAULT_TASKS_DIR / f"{slug}.md"
            if not path.is_file():
                return
            note = rc.Note(path)
            if rc._ledger_skip(note):
                return
            stem = path.stem
            lines = rc._record_read(stem)
            if lines is None or rc._pause_stands(note, lines)[0]:
                return
            r = REASON_RE.match(m.string, m.end())
            reason = r.group(1).strip()[:200] if r else ""
            open_stops = rc._stop_state(lines)["open"]   # the non-sleep stopped lines after the last lead-entry
            if open_stops and open_stops[-1].get("cause") == "halt" and (open_stops[-1].get("reason") or "") == reason:
                return
            fields = {"cause": "halt", "inferred": False, "calls": rc.inflight_calls(lines)}
            if reason:
                fields["reason"] = reason
            rc._event(stem, "stopped", None, fields)
    except Exception:  # noqa: BLE001 — recording never changes the hook's decision
        pass
    finally:
        sys.stderr = saved


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
        if state == "halted" and isinstance(last_msg, str) and m.string is last_msg:
            record_halt(m)
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
            "background Integration command or a merge hold is in flight, a retry cool-down is pending "
            "(with its reason=\"…\", §4.5 step 1.5), a PR hold waits on its merge (`next` reports `halt: held`, "
            "with its reason=\"held until …\", §4.5 step 1.5) or a Trickle wait stands (`next` holds a task on the "
            "Trickle, with its reason=\"trickle: …\", §4.5 step 1.6) or an Away-cap wait does (on the Away cap, "
            "with its reason=\"away cap: …\"), or a last-starts wait stands (`next` holds a "
            "task on the last starts, with its reason=\"last start: …\", §4.5 step 1.6)"
            " or a Heat hold stands (`heat: …`, the "
            "same wait), state=halted with "
            "reason=\"…\" if a §7 stop "
            "condition fired, or state=done after the completion ceremony. Do not end the turn while "
            "state=running."
        ),
    }))


if __name__ == "__main__":
    main()
