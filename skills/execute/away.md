# Away and the Trickle — how many Rollout tasks the Mac runs at once

By day, while Lachy is at the Mac, at most a few Rollout tasks run across the whole Mac, whatever the number of Rollouts: the **Trickle** (Chorus ADR 0104 d2). While he is **Away**, every Rollout runs to its own `parallel_ceiling` (Chorus ADR 0104 d3). Toward the Morning, a task starts only if it will finish by then: the **last starts** (Chorus ADR 0104 d4), and each night's held starts and overruns are recorded (§ The night record). Chorus says whether he is Away; this repo's queue keeps the count (Chorus ADR 0104 d6), so a Rollout run from a terminal obeys it too.

thread-skill owns the state file below as its one reader: `next` (`skills/execute/scripts/reconcile-rollout.py`, `_away_state`) reads it on every call, and nothing else here does. The lead never reads or writes it. Any writer may write it: Chorus does, and so may a person by hand (§ Without a writer).

## The state file

The file is `~/.config/thread/away.json`, under the home dir as it is at the call (`Path.home()`), so a pinned HOME is the only override, as for `rollouts.toml` and `ladder.toml`. There is no env var and no flag.

It is one JSON object, read as at most 64 KiB of UTF-8. All five keys are required. Extra keys are ignored, so a later field stays compatible.

| Key | Type | Meaning |
|---|---|---|
| `away` | a JSON boolean | True while Lachy is Away (Chorus ADR 0104 d1: the Evening, an Away block or the Lunch restart). |
| `until` | ISO 8601 with an offset or `Z` (a naive stamp is refused as ambiguous) | When this state is next due to change. Away: the Morning's hour, or the end of the Away block, that ends it. Not Away: the next Evening's hour, or the start of the next Away block. With no change scheduled: any time after the writer's next refresh. In both states a passed `until` reads stale. |
| `morning` | `"HH:MM"`, 00:00 to 23:59 | The Morning's hour, in local wall-clock time (the Mac's system time zone). `next` checks its shape and reports it, and reads it for the last starts (§ The last starts): an Away `until` on this hour is a night. |
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

While not Away, at most N Rollout tasks run across the whole Mac: N is a fresh file's `trickle`, else 2. `next` counts what runs elsewhere, then sizes this rollout's new starts to the room left; it never holds back a restart.

**The count elsewhere** (`trickle.elsewhere`). It comes from the same walk of `--tasks-dir` that `next` already makes, the one tasks dir every lead on the Mac uses. Another rollout note counts only when it sits directly in that dir (never under `Archive/`), is tagged `rollout`, is not `done` or `dropped`, is parallel, carries no `paused:` stamp, and has started (an execute session's mark: the module docstring's "Never started"). Its count is its linked notes at `status: in_progress`, less the ones its own undecided RACE or UNVERIFIED holds: `next` re-reads such a task as set aside, it never restarts, so it holds no Slot, and once Lachy's decision lifts the hold it counts again. A rollout draining a soft pause (`pause_requested`) still counts. Review and integrating notes never count, because Integration holds no Slot. This rollout counts its own the same way, every one of its `in_progress` tasks, live or stalled, never through `elsewhere`. The count is reported per rollout, `{<rollout>: n}` with n > 0 only, sorted.

**Serial rollouts are outside the count.** A Leg (`skills/execute/legs.md`) is one visible session working one task at a time, `next` never runs for a serial rollout, and a stopped Leg's claim stays `in_progress` with no session behind it, so counting it would hold the Trickle for nobody.

**The limit** (`slotLimit`). Away, it is the rollout's ceiling. Not Away, it is `min(ceiling, max(0, N − the count elsewhere))`. A new start, a seeded revise (execute § 4.5 step 1.2) and a head Solo task's lone start all stop at it, counting every `in_progress` task of this rollout, live or stalled, as every other lead counts them: one fits while those tasks plus this call's starts (and, for a revise, the revises already launched) are below `slotLimit`, so not Away the room is N, less the count elsewhere, less this rollout's `in_progress` tasks, less this call's starts. A running call is never stopped: `slotsInUse` may exceed `slotLimit`, as on the morning after an Away night, and then nothing new starts until the count falls.

**A restart waits on the ceiling alone.** A restart takes back a task whose note already reads `in_progress`, a task every other lead already counts, and Chorus ADR 0104 d4 says only that nothing *new* starts above the Trickle. So a restart is bounded by this rollout's `parallel_ceiling`, never by `slotLimit`. Were it bounded there, a Login switch or a usage-limit respawn, which ends every background call, would leave each Cold-resumed lead waiting on the others' stalled notes with nothing running, every heartbeat reading the same until the Evening. A set-aside task handed back (an automatic retry, a recorded answer, a descope, a signed gate or `/thread:repair`) re-enters `in_progress` and restarts the same way, so a hand-back on a full Mac can take it past N by that one task; every lead counts it from the hand-back on.

**The hold.** A row held for want of a Slot reads `ceiling: <in use>/<ceiling> slots in use` once this rollout fills its own ceiling, else `trickle: <running>/<N> tasks running on this Mac`, where running is `trickle.running` (below). Whichever binds first names the reason. Only a queued row ever reads `trickle:`; a stalled one waits on the ceiling alone. A head Solo task the Trickle holds gets the `trickle:` reason, and the rows below it still read `behind solo [[…]]`. A git-env hold replaces every hold, and a pause holds its rows itself, so neither ever reads `trickle:`.

**It never halts.** A row the Trickle holds could start once the Mac has room, so while any row reads `trickle:` the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6), even with nothing of this rollout in flight. A seeded revise the lead holds for want of `slotLimit` is no row of `next`'s, so `next` may read `stuck` over it; the lead's halt guard turns that `stuck` into the same wait (execute § 4.5 step 1.5). A rollout whose rows wait only on dependencies or gates halts as before, Trickle full or not.

**The output.** `next` adds two keys after `slotsInUse`, every other key unchanged (`ceiling` included): `slotLimit`, an int, and `trickle`, `{away, file, why, limit, until, morning, elsewhere, running}`, where `limit` is N and `running` is the count elsewhere plus this rollout's `in_progress` tasks, live or stalled, plus this call's starts: the count every lead's Trickle sees once this call's starts are stamped. The Run record's `idle-slots` event reads `hold-trickle` whenever the call holds a row on `trickle:`; its `free` stays the ceiling's.

**A morning launch still starts** (Chorus ADR 0104 d2) is read as the Trickle is never 0: N is at least 1. It does not mean a new rollout starts at once. A lead re-runs `next` as soon as one of its calls returns, so a rollout already inside the Trickle refills it at once, while one waiting on it re-checks only at its heartbeat's 20-minute ticks; a morning launch can wait while night work drains above the Trickle, then behind whoever refills first. A fair share or a first start is a later task's.

Two leads can overshoot the Trickle by at most one call's starts each: the window runs from one lead's `next` to its § 4 stamp. A claim under a lock is a later task's.

**A parallel rollout with no lead holds the Trickle for nobody.** The count reads notes, never sessions, so a parallel rollout whose lead is gone keeps its `in_progress` notes in every other rollout's `trickle.elsewhere` for as long as it is left: its session closed, or a § 7 halt left stalled rows (a git-env halt does, and deletes the heartbeat, so no tick re-enters it). Those notes hold Trickle room while nothing of theirs runs, the case that keeps serial rollouts out of the count, and other rollouts' new starts wait behind them; restarts never do. The remedy is Lachy's: `trickle.elsewhere` names the rollout, and stamping it `paused:` (execute *Pausing + reinstating a rollout*: the hard pause's first step, its calls already dead) takes it out of the count at once; its reinstate, `/thread:execute [[<rollout>]]`, restarts its stalled tasks and they count again. Resuming it instead (`/thread:execute [[<rollout>]]`, or `/thread:repair` after a halt) gives its notes a lead again, so they hold room for a task that runs. A liveness signal (a lease the live lead refreshes, so a lapsed one stops counting) is a later task's.

## Away

A fresh file with `away: true` gives each Rollout its own `parallel_ceiling`, nothing else changed: `slotLimit` is the ceiling, the count elsewhere is still reported, and a hold reads `ceiling:` as it always has. What is still running at the Morning finishes; nothing new starts above the Trickle until he is Away again (Chorus ADR 0104 d4). While Away runs to the Morning, the last starts hold a start that would not finish by it (§ The last starts).

## The last starts

Toward the Morning a task starts only if its kind's usual length ends it by the Morning's hour; with no history for its kind, nothing starts in the last two hours. Running tasks finish (Chorus ADR 0104 d4). `next` holds the start; the lead never reads the file or the history.

**When they apply.** All three must hold:

- a fresh file reads `away: true`;
- its `until` is the Morning: read in local wall-clock time (the Mac's system time zone, as `morning` is), `until` falls on `morning`'s HH:MM to the minute;
- M, that `until` with its seconds cut, is after now and at most 24 h ahead (now < M <= now + 24 h).

M keeps `until`'s own offset, so a night across a daylight-saving change needs no wall-clock arithmetic. `until` must be the Morning because Chorus writes it as the latest end among what holds now (Chorus ADR 0104 § Built): the Morning's hour for the Evening and its 05:00 to 09:00 tail, the block's end for an Away block, Lunch's end for the Lunch restart. So the Evening, its tail, an Away block ending at the Morning and § Without a writer's hand-written file all apply.

Nothing applies, and nothing is recorded, for any of these:

- the Lunch restart, or a daytime Away block (an `until` of 13:00, 17:00 or 22:05);
- an Away block ending before the Morning, or spanning it (until 11:00) while he is still away;
- Away with `until` on the Morning but more than 24 h out (a weekend block until Monday's 09:00 before Sunday's, a hand-written file far ahead);
- the 05:00 to 09:00 press of *the Evening, now* (until tomorrow's 09:00) toward today's 09:00: it applies only from today's 09:00, once tomorrow's Morning is 24 h out;
- not Away: by day, or a missing, stale or unreadable file. The Trickle already bounds the Mac.

**A task's kind and its usual length** (Chorus ADR 0099 d2's reading of past journals):

- A task's kind is its note's `scope:` (lowercased), else `unscoped`.
- Its past runs are read per project, the rollout's first `projects:` link (case ignored), from the folded `call-journal` lines of every per-rollout `<rollout>.jsonl` in the Run record's events dir (never `reviews`, `tunings`, `reflections` or `grades`). A file counts only when its rollout note (this rollout's own, or one `next`'s walk of `--tasks-dir` finds, `Archive/Rollouts/` included) names the same first project.
- A call counts when its latest terminal line reads `status: completed` and `mode: task`, with an integer `durationMs` of at least 1 and an integer `startTime`; its end (`startTime` + `durationMs`) falls in the last 30 days; its file's `run-bound` line for that runId carries no `resumedFrom`; and its task's note is found (its kind is that note's). Each runId counts once.
- The usual length is the median of the kind's lengths, with at least 3 past runs. Fewer than 3 is no history.
- A rollout with no `projects:` reads no history. An events dir, file or line that cannot be read reads fewer runs, so the fallback holds more, never less.
- The history is read once per call, and only when a start reaches the check or a ran-past line is due.

**The rule.** A start is held when now + its usual length is past M, so a start that ends exactly at M starts. With no history its length is 2 h: it starts until exactly 2 h before M.

**What they hold.** A queued task's start and a head Solo task's lone start, checked only once a Slot is found: a row held for want of one keeps its `ceiling:` (or `trickle:`) reason, and the Trickle never binds while Away. Restarts are exempt: a stalled `in_progress` task, a set-aside task handed back and a seeded revise each re-enter a task already begun, and running tasks finish. The hold reads, quote-free:

- with history: `last start: <kind> usually takes <N> min (median of <k> past runs), past the Morning at <HH:MM>`, N the median rounded up to a minute;
- with none: `last start: no history for <kind> (<k> past runs, 3 needed), none starts in the 2 h before the Morning at <HH:MM>`.

A held row is skipped, never a stop: the next best row may still fit, so a short kind starts below a long one. A head Solo task the last starts hold reads `last start:`, and the rows below it read `behind solo [[…]]`. A git-env hold replaces every hold, and a pause holds its rows itself, so neither ever reads `last start:`.

**It never halts.** While any row reads `last start:`, the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6). At the Morning the file reads not Away and the Trickle takes over. The Run record's `idle-slots` event reads `hold-last-start` whenever the call holds a row on `last start:` (after `hold-trickle`, which never co-occurs).

**The output.** `next` adds one key after `trickle`, every other key unchanged: `lastStarts`, `{morning, kinds}`. `morning` is M as ISO 8601 with its local offset, or null when the last starts do not apply. `kinds` is `{<kind>: {usualMinutes, history}}` for each kind this call's start candidates read, sorted: `usualMinutes` the median rounded up to a minute, or null with no history, and `history` the kind's past runs. It is `{}` when they do not apply, or when no candidate reached the check.

## The night record

Per night, the starts the last starts held and the tasks still running at the Morning are recorded in each rollout's own Run record (`<rollout>.jsonl`, `skills/_shared/scripts/run_record.py`), the Reflection's input (ADR 0032), so a Reflection can tune the two-hour fallback and the Trickle's number (Chorus ADR 0104's Consequences). `next` is the one writer: off `--dry-run`, once its refusals pass, after its `idle-slots` event, each line best-effort. It reads this rollout's record once per call, and writes each line once (a missing record is an empty one):

- `away-night` `{morning}`, no task: one per (rollout, M), on any call where the last starts apply. It is the night's denominator, nights with no hold included. A daytime Away block never writes one.
- `last-start-held` `{morning, scope, history, usualMinutes?}`: one per (task, M), for each row of the call's final holds that reads `last start:`. A git-env or pause hold writes none.
- `ran-past-morning` `{morning, slotTakenAt, scope, history, usualMinutes?}`: for every `away-night` marker in this record whose M is at or before now, one per (task, M) for each task whose Slot was open at M: its first `slot-taken` before M, and no `slot-freed` (or `carried` in this, its from-file) at or before M, by the record's pairing rules. `slotTakenAt` is that `slot-taken`'s ts.

The Slots are read from the record, never from notes, so a Morning the lead missed (down at 09:00), or a file gone stale after it, is still recorded at its next call, whatever the file then says. A dead lead's Slots count, as they do for the Trickle; a night whose writer died before the Morning ran at Trickle 2 from then on, so a task the Trickle started that was still open at M ran past it too. `scope` is the task note's kind (`unscoped` with no note); `history` and `usualMinutes` are the kind's reading at the write (`usualMinutes` only with history), so a Reflection tells a fallback overrun from an underestimate.

`morning` and `slotTakenAt` are UTC `Z` stamps. A night is keyed by its `morning`: its record is the union of the three kinds sharing that `morning` across every `<rollout>.jsonl`. A rollout with no `next` call while Away to the Morning (every Slot busy all night with tasks begun by day) writes no marker, so that night has no record for it. Serial rollouts never run `next`, so they are outside the last starts, as they are outside the Trickle.

An unreadable record writes no night line, since its dedupe cannot be checked: while the last starts apply, `next` prints one `run_record: warning: night record not written: <why>` line on stderr; otherwise it is silent.

## Without a writer

With no file, every rollout on the Mac runs at a combined Trickle of 2, nights included. To run a night to each ceiling before a writer exists, write the file by hand, atomically:

```sh
mkdir -p ~/.config/thread && python3 - <<'PY'
import datetime, json, os
now = datetime.datetime.now().astimezone()
until = now.replace(hour=9, minute=0, second=0, microsecond=0)  # the next 09:00 strictly after now
if until <= now:
    until += datetime.timedelta(days=1)
until = until.replace(tzinfo=None).astimezone()  # that 09:00's own offset, a daylight-saving change overnight included
path = os.path.expanduser("~/.config/thread/away.json")
with open(path + ".tmp", "w") as f:
    json.dump({"away": True, "until": until.isoformat(), "morning": "09:00", "trickle": 2,
               "written_at": now.isoformat()}, f)
os.replace(path + ".tmp", path)
PY
```

Its `until` is the Morning, so the last starts apply to it (§ The last starts). A hand-written file goes stale at its `until`, or 24 h after its `written_at`, whichever comes first; from then on each lead prints the `WARN: ~/.config/thread/away.json stale: …` line on every `next` call, and the Mac is back at Trickle 2. Delete the file to go back to the default with no WARN.
