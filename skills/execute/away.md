# Away and the Trickle — how many Rollout tasks the Mac runs at once

By day, while Lachy is at the Mac, at most a few Rollout tasks run across the whole Mac, whatever the number of Rollouts: the **Trickle** (Chorus ADR 0104 d2). While he is **Away**, every Rollout runs to its own `parallel_ceiling` (Chorus ADR 0104 d3). Chorus says whether he is Away; this repo's queue keeps the count (Chorus ADR 0104 d6), so a Rollout run from a terminal obeys it too.

thread-skill owns the state file below as its one reader: `next` (`skills/execute/scripts/reconcile-rollout.py`, `_away_state`) reads it on every call, and nothing else here does. The lead never reads or writes it. Any writer may write it: Chorus does, and so may a person by hand (§ Without a writer).

## The state file

The file is `~/.config/thread/away.json`, under the home dir as it is at the call (`Path.home()`), so a pinned HOME is the only override, as for `rollouts.toml` and `ladder.toml`. There is no env var and no flag.

It is one JSON object, read as at most 64 KiB of UTF-8. All five keys are required. Extra keys are ignored, so a later field stays compatible.

| Key | Type | Meaning |
|---|---|---|
| `away` | a JSON boolean | True while Lachy is Away (Chorus ADR 0104 d1: the Evening, an Away block or the Lunch restart). |
| `until` | ISO 8601 with an offset or `Z` (a naive stamp is refused as ambiguous) | When this state is next due to change. Away: the Morning's hour, or the end of the Away block, that ends it. Not Away: the next Evening's hour, or the start of the next Away block. With no change scheduled: any time after the writer's next refresh. In both states a passed `until` reads stale. |
| `morning` | `"HH:MM"`, 00:00 to 23:59 | The Morning's hour, in local wall-clock time (the Mac's system time zone). `next` checks its shape and reports it; the last starts toward the Morning (Chorus ADR 0104 d4) are a later task's. |
| `trickle` | a JSON integer of at least 1 | N, the most Rollout tasks the Mac runs while not Away. A bool, a float, a string or 0 is refused: the Trickle is never 0 (§ The Trickle). |
| `written_at` | ISO 8601 with an offset or `Z` | When the writer last wrote the file. |

A sample, Away overnight:

```json
{"away": true, "until": "2026-10-22T09:00:00+11:00", "morning": "09:00", "trickle": 2, "written_at": "2026-10-21T18:00:00+11:00"}
```

The writer's duties:

- Write atomically: a temp file in the same directory, then a rename, so a reader never sees half a file.
- Rewrite it at each change of state, and rewrite it at least once every 24 h while a state holds (the same state with a new `written_at`). A long Away (a weekend) or a long day otherwise goes stale at 24 h and reads not Away at Trickle 2 partway through.

## Reading it

`next` reads the file once its refusals pass (a serial rollout, an incomplete one, an unresolvable ceiling), so a refused call reads nothing and prints nothing about it. `--now` is the reading's now, or the clock without it. The reading is one of four, reported as `trickle.file`, and `trickle.why` says why for every one but `fresh`:

| `file` | When | Reads |
|---|---|---|
| `fresh` | The object is well-formed and no stale test below holds. | `away` and `trickle` from the file; `trickle.until` and `trickle.morning` are the file's. |
| `missing` | No file, a dangling symlink, or a plain file where `~/.config/thread` should be. | Not Away, Trickle 2. |
| `unreadable` | Any other read error (a directory at the path included), more than 64 KiB, not UTF-8, not JSON, not an object, or a key missing or ill-typed; `why` names the first problem, in the key table's order. | Not Away, Trickle 2. |
| `stale` | Any of the three stale tests. | Not Away, Trickle 2: the file's own `trickle` is ignored. |

The three stale tests, each a reader rule:

1. `until` is at or before now, in either state.
2. `written_at` is more than 24 h before now (exactly 24 h is still fresh).
3. `written_at` is more than 5 minutes after now. A writer whose clock runs ahead could otherwise keep a file fresh past its 24 h, so this one fails safe.

Only a fresh file sets `trickle.until` and `trickle.morning`; otherwise both are null.

A broken writer is loud. On `stale` or `unreadable`, `next` prints one line on stderr, on every call, `--dry-run` included:

`WARN: ~/.config/thread/away.json <stale|unreadable>: <why> — read as not Away, Trickle 2`

The line names the path as written here, never the resolved one, so it reads the same in every HOME and a lead can tell one line from another (execute § 4.5 step 1.1 prints each distinct line once per session). A missing file prints nothing: it is the documented default until a writer exists. A stale file warns too, because a working writer never leaves one: Chorus quit overnight, or a hand-written file passed its 24 h.

## The Trickle

While not Away, at most N Rollout tasks run across the whole Mac: N is a fresh file's `trickle`, else 2. `next` counts what runs elsewhere, then sizes this rollout's starts to the room left.

**The count elsewhere** (`trickle.elsewhere`). It comes from the same walk of `--tasks-dir` that `next` already makes, the one tasks dir every lead on the Mac uses. Another rollout note counts only when it sits directly in that dir (never under `Archive/`), is tagged `rollout`, is not `done` or `dropped`, is parallel, carries no `paused:` stamp, and has started (an execute session's mark: the module docstring's "Never started"). Its count is its linked notes at `status: in_progress`, less the ones its own undecided RACE or UNVERIFIED holds: `next` re-reads such a task as set aside, it never restarts, so it holds no Slot, and once Lachy's decision lifts the hold it counts again. A rollout draining a soft pause (`pause_requested`) still counts. Review and integrating notes never count, because Integration holds no Slot. This rollout counts through its own running and restarting tasks, never through `elsewhere`. The count is reported per rollout, `{<rollout>: n}` with n > 0 only, sorted.

**Serial rollouts are outside the count.** A Leg (`skills/execute/legs.md`) is one visible session working one task at a time, `next` never runs for a serial rollout, and a stopped Leg's claim stays `in_progress` with no session behind it, so counting it would hold the Trickle for nobody.

**The limit** (`slotLimit`). Away, it is the rollout's ceiling. Not Away, it is `min(ceiling, max(0, N − the count elsewhere))`. Restarts, starts and a head Solo task's lone start all stop at it. A running call is never stopped: `slotsInUse` may exceed `slotLimit`, as on the morning after an Away night, and then nothing starts or restarts until the count falls.

**The hold.** A row held for want of a Slot reads `ceiling: <in use>/<ceiling> slots in use` once this rollout fills its own ceiling, else `trickle: <running>/<N> tasks running on this Mac`, where running is the count elsewhere plus this rollout's Slots in use. Whichever binds first names the reason. A head Solo task the Trickle holds gets the `trickle:` reason, and the rows below it still read `behind solo [[…]]`. A git-env hold replaces every hold, and a pause holds its rows itself, so neither ever reads `trickle:`.

**It never halts.** A row the Trickle holds could start once the Mac has room, so while any row reads `trickle:` the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6), even with nothing of this rollout in flight. A rollout whose rows wait only on dependencies or gates halts as before, Trickle full or not.

**The output.** `next` adds two keys after `slotsInUse`, every other key unchanged (`ceiling` included): `slotLimit`, an int, and `trickle`, `{away, file, why, limit, until, morning, elsewhere, running}`, where `limit` is N and `running` is the count elsewhere plus `slotsInUse` plus this call's starts. The Run record's `idle-slots` event reads `hold-trickle` whenever the call holds a row on `trickle:`; its `free` stays the ceiling's.

**A morning launch still starts** (Chorus ADR 0104 d2) is read as the Trickle is never 0: N is at least 1. It does not mean a new rollout starts at once. A lead re-runs `next` as soon as one of its calls returns, so a rollout already inside the Trickle refills it at once, while one waiting on it re-checks only at its heartbeat's 20-minute ticks; a morning launch can wait while night work drains above the Trickle, then behind whoever refills first. A fair share or a first start is a later task's.

Two leads can overshoot the Trickle by at most one call's starts each: the window runs from one lead's `next` to its § 4 stamp. A claim under a lock is a later task's.

## Away

A fresh file with `away: true` gives each Rollout its own `parallel_ceiling`, nothing else changed: `slotLimit` is the ceiling, the count elsewhere is still reported, and a hold reads `ceiling:` as it always has. What is still running at the Morning finishes; nothing new starts above the Trickle until he is Away again (Chorus ADR 0104 d4).

## Without a writer

With no file, every rollout on the Mac runs at a combined Trickle of 2, nights included. To run a night to each ceiling before a writer exists, write the file by hand, atomically:

```sh
mkdir -p ~/.config/thread && python3 - <<'PY'
import datetime, json, os
now = datetime.datetime.now().astimezone()
until = (now + datetime.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
path = os.path.expanduser("~/.config/thread/away.json")
with open(path + ".tmp", "w") as f:
    json.dump({"away": True, "until": until.isoformat(), "morning": "09:00", "trickle": 2,
               "written_at": now.isoformat()}, f)
os.replace(path + ".tmp", path)
PY
```

A hand-written file goes stale at its `until`, or 24 h after its `written_at`, whichever comes first; from then on each lead prints the `WARN: ~/.config/thread/away.json stale: …` line on every `next` call, and the Mac is back at Trickle 2. Delete the file to go back to the default with no WARN.
