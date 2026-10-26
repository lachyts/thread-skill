# Away, the Trickle and the Away cap — how many Rollout tasks the Mac runs at once

By day, while Lachy is at the Mac, at most a few Rollout tasks run across the whole Mac, whatever the number of Rollouts: the **Trickle** (Chorus ADR 0104 d2). While he is **Away**, the **Away cap** bounds them: a larger Mac-wide cap, sized so suites do not contend, where each Rollout once ran to its own `parallel_ceiling`; each Rollout still runs within its own ceiling (ADR 0049, overturning Chorus ADR 0104 d3). Chorus says whether he is Away; this repo's queue keeps the count (Chorus ADR 0104 d6), so a Rollout run from a terminal obeys it too.

thread-skill owns the state file below as its one reader: `next` (`skills/execute/scripts/reconcile-rollout.py`, `_away_state`) reads it on every call, `mark-started` reads it once per run for the Run record (§ Away), and nothing else here does. The lead never reads or writes it. Any writer may write it: Chorus does, and so may a person by hand (§ Without a writer).

## The state file

The file is `~/.config/thread/away.json`, under the home dir as it is at the call (`Path.home()`), so a pinned HOME is the only override, as for `rollouts.toml` and `ladder.toml`. There is no env var and no flag.

It is one JSON object, read as at most 64 KiB of UTF-8. The first five keys are required and `away_cap` is optional. Extra keys are ignored, so a later field stays compatible.

| Key | Type | Meaning |
|---|---|---|
| `away` | a JSON boolean | True while Lachy is Away (Chorus ADR 0104 d1: the Evening, an Away block or the Lunch restart). |
| `until` | ISO 8601 with an offset or `Z` (a naive stamp is refused as ambiguous) | When this state is next due to change. Away: the Morning's hour, or the end of the Away block, that ends it. Not Away: the next Evening's hour, or the start of the next Away block. With no change scheduled: any time after the writer's next refresh. In both states a passed `until` reads stale. |
| `morning` | `"HH:MM"`, 00:00 to 23:59 | The Morning's hour, in local wall-clock time (the Mac's system time zone). `next` checks its shape and reports it; the last starts toward the Morning (Chorus ADR 0104 d4) are a later task's. |
| `trickle` | a JSON integer of at least 1 | N, the most Rollout tasks the Mac runs while not Away. A bool, a float, a string or 0 is refused: the Trickle is never 0 (§ The Trickle). |
| `written_at` | ISO 8601 with an offset or `Z` | When the writer last wrote the file. |
| `away_cap` | optional; a JSON integer of at least 1, strictly greater than `trickle` | A, the most Rollout tasks the Mac runs while Away (§ Away). A bool, a float, a string, null, 0, or a value at or below `trickle` is refused. Absent, the built-in applies (§ Away). Chorus writes it at every rewrite, Away or not. |

`away_cap` came after the other five (p29-8, ADR 0049). An engine snapshot from before it ignores it as an extra key and runs Away to each rollout's own ceiling (ADR 0043), so a writer may write it at any time, while such a rollout is live or paused.

A sample, Away overnight:

```json
{"away": true, "until": "2026-10-22T09:00:00+11:00", "morning": "09:00", "trickle": 2, "away_cap": 4, "written_at": "2026-10-21T18:00:00+11:00"}
```

The writer's duties:

- Write atomically: a temp file in the same directory, then a rename, so a reader never sees half a file.
- Rewrite it at each change of state, and rewrite it at least once every 24 h while a state holds (the same state with a new `written_at`). A long Away (a weekend) or a long day otherwise goes stale at 24 h and reads not Away at Trickle 2 partway through.

## Reading it

`next` reads the file once its refusals pass (a serial rollout, an incomplete one, an unresolvable ceiling), so a refused call reads nothing and prints nothing about it. `--now` is the reading's now, or the clock without it. The reading is one of four, reported as `trickle.file`, and `trickle.why` says why for every one but `fresh`:

| `file` | When | Reads |
|---|---|---|
| `fresh` | The object is well-formed and no stale test below holds. | `away` and `trickle` from the file, and the Away cap from its `away_cap` (else the built-in, § Away); `trickle.until` and `trickle.morning` are the file's. |
| `missing` | No file, a dangling symlink, or a plain file where `~/.config/thread` should be. | Not Away, Trickle 2. |
| `unreadable` | Any other read error (a directory at the path included), more than 64 KiB, not UTF-8, not JSON, not an object, a required key missing, or a key ill-typed (an `away_cap` at or below `trickle` included); `why` names the first problem, in the key table's order. | Not Away, Trickle 2. |
| `stale` | Any of the three stale tests. | Not Away, Trickle 2: the file's own `trickle` and `away_cap` are ignored. |

Every reading reports the Away cap as `trickle.awayCap`: the file's, or the built-in for a fresh file without the key, and the built-in 4 for the other three, which read not Away, so it never binds there.

The three stale tests, each a reader rule:

1. `until` is at or before now, in either state.
2. `written_at` is more than 24 h before now (exactly 24 h is still fresh).
3. `written_at` is more than 5 minutes after now. A writer whose clock runs ahead could otherwise keep a file fresh past its 24 h, so this one fails safe.

Only a fresh file sets `trickle.until` and `trickle.morning`; otherwise both are null.

A broken writer is loud. On `stale` or `unreadable`, `next` prints one line on stderr, on every call, `--dry-run` included:

`WARN: ~/.config/thread/away.json <stale|unreadable>: <why> — read as not Away, Trickle 2`

The line names the path as written here, never the resolved one, so it reads the same in every HOME and a lead can tell one line from another (execute § 4.5 step 1.1 prints each distinct line once per session). A missing file prints nothing: it is the documented default until a writer exists. A stale file warns too, because a working writer never leaves one: Chorus quit overnight, or a hand-written file passed its 24 h.

## The Trickle

While not Away, at most N Rollout tasks run across the whole Mac: N is a fresh file's `trickle`, else 2. `next` counts what runs elsewhere, then sizes this rollout's new starts to the room left; it never holds back a restart. While Away, the Away cap A takes N's place, counted the same way (§ Away), so every rule below holds for it too.

**The count elsewhere** (`trickle.elsewhere`). It comes from the same walk of `--tasks-dir` that `next` already makes, the one tasks dir every lead on the Mac uses. Another rollout note counts only when it sits directly in that dir (never under `Archive/`), is tagged `rollout`, is not `done` or `dropped`, is parallel, carries no `paused:` stamp, and has started (an execute session's mark: the module docstring's "Never started"). Its count is its linked notes at `status: in_progress`, less the ones its own undecided RACE or UNVERIFIED holds: `next` re-reads such a task as set aside, it never restarts, so it holds no Slot, and once Lachy's decision lifts the hold it counts again. A rollout draining a soft pause (`pause_requested`) still counts. Review and integrating notes never count, because Integration holds no Slot. This rollout counts its own the same way, every one of its `in_progress` tasks, live or stalled, never through `elsewhere`. The count is reported per rollout, `{<rollout>: n}` with n > 0 only, sorted.

**Serial rollouts are outside the count.** A Leg (`skills/execute/legs.md`) is one visible session working one task at a time, `next` never runs for a serial rollout, and a stopped Leg's claim stays `in_progress` with no session behind it, so counting it would hold the Trickle for nobody.

**The limit** (`slotLimit`). Not Away, it is `min(ceiling, max(0, N − the count elsewhere))`. Away, it is `min(ceiling, max(0, A − the count elsewhere))`, A the Away cap. A new start, a seeded revise (execute § 4.5 step 1.2) and a head Solo task's lone start all stop at it, counting every `in_progress` task of this rollout, live or stalled, as every other lead counts them: one fits while those tasks plus this call's starts (and, for a revise, the revises already launched) are below `slotLimit`, so not Away the room is N, less the count elsewhere, less this rollout's `in_progress` tasks, less this call's starts (Away, A in N's place). A running call is never stopped: `slotsInUse` may exceed `slotLimit`, as on the morning after an Away night, and then nothing new starts until the count falls.

**A restart waits on the ceiling alone.** A restart takes back a task whose note already reads `in_progress`, a task every other lead already counts, and Chorus ADR 0104 d4 says only that nothing *new* starts above the Trickle. So a restart is bounded by this rollout's `parallel_ceiling`, never by `slotLimit`, Away or not. Were it bounded there, a Login switch or a usage-limit respawn, which ends every background call, would leave each Cold-resumed lead waiting on the others' stalled notes with nothing running, every heartbeat reading the same until the Evening. A set-aside task handed back (an automatic retry, a recorded answer, a descope, a signed gate or `/thread:repair`) re-enters `in_progress` and restarts the same way, so a hand-back on a full Mac can take it past N (or A) by that one task; every lead counts it from the hand-back on.

**The hold.** A row held for want of a Slot reads `ceiling: <in use>/<ceiling> slots in use` once this rollout fills its own ceiling, else `trickle: <running>/<N> tasks running on this Mac` while not Away, or `away cap: <running>/<A> tasks running on this Mac` while Away, where running is `trickle.running` (below). Whichever binds first names the reason. Only a queued row ever reads `trickle:` or `away cap:`; a stalled one waits on the ceiling alone. A head Solo task the Trickle or the Away cap holds gets that reason, and the rows below it still read `behind solo [[…]]`. A git-env hold replaces every hold, and a pause holds its rows itself, so neither ever reads `trickle:` or `away cap:`.

**It never halts.** A row the Trickle or the Away cap holds could start once the Mac has room, so while any row reads `trickle:` or `away cap:` the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6), even with nothing of this rollout in flight. A seeded revise the lead holds for want of `slotLimit` is no row of `next`'s, so `next` may read `stuck` over it; the lead's halt guard turns that `stuck` into the same wait (execute § 4.5 step 1.5). A rollout whose rows wait only on dependencies or gates halts as before, the cap full or not.

**The output.** `next` adds two keys after `slotsInUse`, every other key unchanged (`ceiling` included): `slotLimit`, an int, and `trickle`, `{away, file, why, limit, awayCap, until, morning, elsewhere, running}`, where `limit` is N, `awayCap` is A (reported in both states, binding only Away) and `running` is the count elsewhere plus this rollout's `in_progress` tasks, live or stalled, plus this call's starts: the count every lead's cap sees once this call's starts are stamped. The Run record's `idle-slots` event reads `hold-trickle` whenever the call holds a row on `trickle:`, and `hold-away-cap` whenever it holds one on `away cap:`; its `free` stays the ceiling's.

**A morning launch still starts** (Chorus ADR 0104 d2) is read as the Trickle is never 0: N is at least 1. It does not mean a new rollout starts at once. A lead re-runs `next` as soon as one of its calls returns, so a rollout already inside the Trickle refills it at once, while one waiting on it re-checks only at its heartbeat's 20-minute ticks; a morning launch can wait while night work drains above the Trickle, then behind whoever refills first. A fair share or a first start is a later task's.

Two leads can overshoot the Trickle or the Away cap by at most one call's starts each: the window runs from one lead's `next` to its § 4 stamp. A claim under a lock is a later task's.

**A parallel rollout with no lead holds the Trickle for nobody.** The count reads notes, never sessions, so a parallel rollout whose lead is gone keeps its `in_progress` notes in every other rollout's `trickle.elsewhere` for as long as it is left: its session closed, or a § 7 halt left stalled rows (a git-env halt does, and deletes the heartbeat, so no tick re-enters it). Those notes hold Trickle room (Away, Away-cap room) while nothing of theirs runs, the case that keeps serial rollouts out of the count, and other rollouts' new starts wait behind them; restarts never do. The remedy is Lachy's: `trickle.elsewhere` names the rollout, and stamping it `paused:` (execute *Pausing + reinstating a rollout*: the hard pause's first step, its calls already dead) takes it out of the count at once; its reinstate, `/thread:execute [[<rollout>]]`, restarts its stalled tasks and they count again. Resuming it instead (`/thread:execute [[<rollout>]]`, or `/thread:repair` after a halt) gives its notes a lead again, so they hold room for a task that runs. A liveness signal (a lease the live lead refreshes, so a lapsed one stops counting) is a later task's.

## Away

While Lachy is Away (a fresh file with `away: true`), the **Away cap** A bounds the Rollout tasks running across the whole Mac in the Trickle's place (ADR 0049, overturning Chorus ADR 0104 d3, which ran every Rollout to its own ceiling). It counts as the Trickle does (§ The Trickle): the same count elsewhere, `slotLimit` at `min(ceiling, max(0, A − the count elsewhere))`, and a restart that waits on the ceiling alone. Each rollout's `parallel_ceiling` still bounds its own share: a rollout whose own ceiling binds first reads `ceiling:`, as by day.

**The value.** A is a fresh file's `away_cap`. With the key absent the built-in is 4: twice the Mac's two Verify slots (`verify-slot.py --slots 2`), so two suites run and two queue, where on the night ADR 0049 records eight rollouts ran to their own ceilings at load 139 to 149. A fresh file with no `away_cap` and a `trickle` of 4 or more lifts the built-in to `trickle` + 1, so the Away cap is always above the Trickle, as Chorus keeps it. Chorus's own default is the same 4, so a hand-written file without the key behaves as the Stage's. A stale, unreadable or missing file reads not Away, so the Away cap never binds there (§ Reading it).

**A meant wait.** A row the Away cap holds reads `away cap: <running>/<A> tasks running on this Mac`, and it never halts: a rollout the Away cap alone holds is a meant wait, never Stalled (ADR 0048), even with nothing of it in flight. `halt` stays null, the lead's turn ends `waiting` with that reason (execute § 4.5 steps 1.5 and 1.6), and the Run record's `idle-slots` reads `hold-away-cap`, so the Watchdog verdict reads a wait on the Away cap.

**A dead lead's notes hold room.** The count reads notes, never sessions, so a rollout whose lead died holds its Away-cap room until the Watchdog recovers it (ADR 0048) or Lachy pauses it (the `paused:` stamp, § The Trickle); the Companion has no pause.

**Tuning.** `mark-started` records the cap in force at each Slot start, slot-taken's `cap`, `{away, n, file}`, in the Run record, read once per run and silently (`next` prints the WARN). A Reflection reads it against suite times, verify reds and load once the record carries them (p29-10), and tunes A like any knob (ADR 0032, 0049); Throughput is the Guardrail on how low it may go, since a night of many rollouts finishes later per rollout by design.

What is still running at the Morning finishes; nothing new starts above the Trickle until he is Away again (Chorus ADR 0104 d4). The Evening's switch gives more room (the Trickle to the Away cap); the Morning's may leave `slotsInUse` above `slotLimit`, and then nothing new starts until the count falls.

## Without a writer

With no file, every rollout on the Mac runs at a combined Trickle of 2, nights included. To run a night at the Away cap before a writer exists, write the file by hand, atomically:

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
    json.dump({"away": True, "until": until.isoformat(), "morning": "09:00", "trickle": 2, "away_cap": 4,
               "written_at": now.isoformat()}, f)
os.replace(path + ".tmp", path)
PY
```

A hand-written file goes stale at its `until`, or 24 h after its `written_at`, whichever comes first; from then on each lead prints the `WARN: ~/.config/thread/away.json stale: …` line on every `next` call, and the Mac is back at Trickle 2. Delete the file to go back to the default with no WARN.
