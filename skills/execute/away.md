# Away, the Trickle and the Away cap — how many Rollout tasks the Mac runs at once

By day, while Lachy is at the Mac, at most a few Rollout tasks run across the whole Mac, whatever the number of Rollouts: the **Trickle** (Chorus ADR 0104 d2). While he is **Away**, the **Away cap** bounds them: a larger Mac-wide cap, sized so suites do not contend, where each Rollout once ran to its own `parallel_ceiling`; each Rollout still runs within its own ceiling (ADR 0049, overturning Chorus ADR 0104 d3). Toward the Morning, a task starts only if it will finish by then: the **last starts** (Chorus ADR 0104 d4), and each night's held starts and overruns are recorded (§ The night record). Chorus says whether he is Away; this repo's queue keeps the count (Chorus ADR 0104 d6), so a Rollout run from a terminal obeys it too. Day or night, a hot Mac starts nothing new: the **Heat hold** (§ Heat, estate ADR 0009 d5).

thread-skill owns the state file below as its one reader: `next` (`skills/execute/scripts/reconcile-rollout.py`, `_away_state`) reads it on every call, `mark-started` reads it once per run for the Run record (§ Away), `status` reads it for its Trickle line, and every progress line (`next`'s, `status`'s, and each `--rollout` verb's) reads it for the ETA's width (§ The Trickle). Nothing else here does, all of them read it silently, and only `next` prints the WARN. The lead never reads or writes it. Any writer may write it: Chorus does, and so may a person by hand (§ Without a writer). `next` also keeps one file of its own beside its note locks, the Trickle claims (§ The Trickle, *Trickle claims*), which no other verb reads or writes.

## The state file

The file is `~/.config/thread/away.json`, under the home dir as it is at the call (`Path.home()`), so a pinned HOME is the only override, as for `rollouts.toml` and `ladder.toml`. There is no env var and no flag.

It is one JSON object, read as at most 64 KiB of UTF-8. The first five keys are required and `away_cap` is optional. Extra keys are ignored, so a later field stays compatible.

| Key | Type | Meaning |
|---|---|---|
| `away` | a JSON boolean | True while Lachy is Away (Chorus ADR 0104 d1: the Evening, an Away block or the Lunch restart). |
| `until` | ISO 8601 with an offset or `Z` (a naive stamp is refused as ambiguous) | When this state is next due to change. Away: the Morning's hour, or the end of the Away block, that ends it. Not Away: the next Evening's hour, or the start of the next Away block. With no change scheduled: any time after the writer's next refresh. In both states a passed `until` reads stale. |
| `morning` | `"HH:MM"`, 00:00 to 23:59 | The Morning's hour, in local wall-clock time (the Mac's system time zone). `next` checks its shape and reports it, and reads it for the last starts (§ The last starts): an Away `until` on this hour is a night. |
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

**The count elsewhere** (`trickle.elsewhere`). Off `--dry-run` it comes from a fresh walk of `--tasks-dir` (the one tasks dir every lead on the Mac uses), taken under the Trickle claim lock (*Trickle claims*, below); under `--dry-run`, from the walk `next` already makes. Another rollout note counts only when it sits directly in that dir (never under `Archive/`), is tagged `rollout`, is not `done` or `dropped`, is parallel, carries no `paused:` stamp, and has started (an execute session's mark: the module docstring's "Never started"). Its count is its linked notes at `status: in_progress`, less the ones its own undecided RACE or UNVERIFIED holds: `next` re-reads such a task as set aside, it never restarts, so it holds no Slot, and once Lachy's decision lifts the hold it counts again. A rollout draining a soft pause (`pause_requested`) still counts. Review and integrating notes never count, because Integration holds no Slot. This rollout counts its own the same way, every one of its `in_progress` tasks, live or stalled, never through `elsewhere`. The count is reported per rollout, `{<rollout>: n}` with n > 0 only, sorted. `next` adds another lead's live Trickle claims to that count (*Trickle claims*, below); `status` and every progress line count notes only.

**Serial rollouts are outside the count.** A Leg (`skills/execute/legs.md`) is one visible session working one task at a time, `next` never runs for a serial rollout, and a stopped Leg's claim stays `in_progress` with no session behind it, so counting it would hold the Trickle for nobody.

**The limit** (`slotLimit`). Not Away, it is `min(ceiling, max(0, N − the count elsewhere))`. Away, it is `min(ceiling, max(0, A − the count elsewhere))`, A the Away cap. A new start, a seeded revise (execute § 4.5 step 1.2) and a head Solo task's lone start all stop at it, counting every `in_progress` task of this rollout, live or stalled, as every other lead counts them: one fits while those tasks plus this call's starts (and, for a revise, the revises already launched) are below `slotLimit`, so not Away the room is N, less the count elsewhere, less this rollout's `in_progress` tasks, less this call's starts (Away, A in N's place). A running call is never stopped: `slotsInUse` may exceed `slotLimit`, as on the morning after an Away night, and then nothing new starts until the count falls.

**A restart waits on the ceiling alone.** A restart takes back a task whose note already reads `in_progress`, a task every other lead already counts, and Chorus ADR 0104 d4 says only that nothing *new* starts above the Trickle. So a restart is bounded by this rollout's `parallel_ceiling`, never by `slotLimit`, Away or not. Were it bounded there, a Login switch or a usage-limit respawn, which ends every background call, would leave each Cold-resumed lead waiting on the others' stalled notes with nothing running, every heartbeat reading the same until the Evening. A set-aside task handed back (an automatic retry, a recorded answer, a descope, a signed gate or `/thread:repair`) re-enters `in_progress` and restarts the same way, so a hand-back on a full Mac can take it past N (or A) by that one task; every lead counts it from the hand-back on.

**The hold.** A row held for want of a Slot reads `ceiling: <in use>/<ceiling> slots in use` once this rollout fills its own ceiling, else `trickle: <running>/<N> tasks running on this Mac` while not Away, or `away cap: <running>/<A> tasks running on this Mac` while Away, where running is `trickle.running` (below). Whichever binds first names the reason. Only a queued row ever reads `trickle:` or `away cap:`; a stalled one waits on the ceiling alone. A head Solo task the Trickle or the Away cap holds gets that reason, and the rows below it still read `behind solo [[…]]`. A whole-rollout (bare) git-env hold, or a main-red hold (`next`'s `mainRed`, a RACE revert that did not land), replaces every hold, and a pause holds its rows itself, so none of them ever reads `trickle:` or `away cap:`. A git-env trip that holds the lane only (ADR 0046) holds no Slot, so the Trickle and the Away cap read the rows as usual.

**It never halts.** A row the Trickle or the Away cap holds could start once the Mac has room, so while any row reads `trickle:` or `away cap:` the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6), even with nothing of this rollout in flight. A seeded revise the lead holds for want of `slotLimit` is no row of `next`'s, so `next` may read `stuck` over it; the lead's halt guard turns that `stuck` into the same wait (execute § 4.5 step 1.5). A rollout whose rows wait only on dependencies or gates halts as before, the cap full or not.

**The output.** `next` adds two keys after `slotsInUse`, every other key unchanged (`ceiling` included): `slotLimit`, an int, and `trickle`, `{away, file, why, limit, awayCap, until, morning, elsewhere, running}`, where `limit` is N, `awayCap` is A (reported in both states, binding only Away) and `running` is the count elsewhere (another lead's live Trickle claims included) plus this rollout's `in_progress` tasks, live or stalled, plus this call's starts: the count every lead's cap sees once this call's starts are stamped. The Run record's `idle-slots` event reads `hold-trickle` whenever the call holds a row on `trickle:`, and `hold-away-cap` whenever it holds one on `away cap:`; its `free` stays the ceiling's.

**The ETA.** The progress line's rough remaining estimate (p28-6) counts its chunks at the Trickle's limit, `min(ceiling, max(1, cap - the count elsewhere))`, the count elsewhere read from the notes only (no Trickle claims) and the cap in force by Away state: `slotLimit` floored at 1 (a full Mac still drains one at a time) and with the Heat hold left out (it passes). `status`'s `timeline` reports it as `etaWidth`, with `etaBy` `ceiling`, `trickle` or `away cap`. `status` also reports the `trickle` block itself, read the same way from the notes only, plus `here` (this rollout's own count as the others read it), for its Trickle line.

**A morning launch still starts** (Chorus ADR 0104 d2) is read as the Trickle is never 0: N is at least 1. It does not mean a new rollout starts at once. A lead re-runs `next` as soon as one of its calls returns, so a rollout already inside the Trickle refills it at once, while one waiting on it re-checks only at its heartbeat's 20-minute ticks; a morning launch can wait while night work drains above the Trickle, then behind whoever refills first. A fair share or a first start is a later task's.

**Trickle claims.** Two leads' `next` calls would otherwise both see the room one free place leaves, from one lead's `next` to its § 4 stamp, and the heartbeat's ticks bring waiting leads back together. So off `--dry-run`, once its refusals pass and every PR hold is read, `next` takes the machine-wide `trickle.lock` in the note-lock dir (`THREAD_NOTE_LOCK_DIR`, else `$XDG_STATE_HOME/thread/note-locks`, else `~/.local/state/thread/note-locks`), walks `--tasks-dir` afresh, counts and picks its starts. Once the rollout note's own save has succeeded, it records one claim per start (the head Solo task's lone start included) in `trickle-claims.json` beside the lock, replacing its rollout's earlier claims, and lets the lock go; a call whose save fails claims nothing. A claim names the tasks dir (its real path), the rollout, the task and `at`, the call's now to the second. Every other lead's `next` counts a live claim under its rollout in `trickle.elsewhere`, beside that rollout's notes; a lead's own claims never count against its own rollout.

- A claim is consumed by its task's § 4 stamp. It counts until the note-based count counts that task (`status: in_progress`, and the rollout started), so a stamp written in two edits, in either order, never drops it and never counts the task twice. A task that leaves the queue another way (set aside, in review, done) drops its claim.
- A claim lives 20 minutes from its `at`, to the second: one heartbeat tick. A lead that never stamps holds that room for nobody until then: a crash, or a refusal after a successful `next` (a § 2.5 or canary refusal at step 1.3), a bounded cost. A lock holder that dies frees the lock with its process.
- A claim counts only in the tasks dir it was written for. One whose task note is missing from the walk still counts (a note caught mid-edit fails to parse and is skipped), and so does one whose rollout note is missing from the walk (torn mid-edit, or deleted), under the name the claim recorded, until it expires. One whose rollout note is present but outside the count (under `Archive/`, closed, serial, paused or untagged) counts nothing and goes at the next write, as does one whose task note now names another rollout or has left the queue another way.
- `--dry-run` reads the claims against the walk it already makes and writes nothing, taking no lock. A pause, a rollout hold, the heat, a whole-rollout git-env hold (a bare checkout, `gitEnvHold` `scope: rollout`) or a main-red hold (`mainRed`, a RACE revert that did not land) leaves the call's `start` empty, which clears its rollout's claims. A git-env trip that holds the lane only (ADR 0046) leaves `start` as it is, so its starts are claimed as usual.
- It fails open, never a halt: each failure prints one line on `next`'s stderr, which execute § 4.5 step 1.1 relays, and the call carries on. A lock it cannot take or a write that fails leaves the call's own starts unclaimed, the old window.
  - `WARN: trickle claims <lock path>: <why> — counted without the lock; this call's starts are not claimed`: a lock not taken within `THREAD_NOTE_LOCK_TIMEOUT` seconds (30), or a lock dir it cannot write. The count still runs, reading the file without the lock.
  - `WARN: trickle claims <path> unreadable: <why> — read as none`, `--dry-run` included: over 256 KiB, not UTF-8, not JSON, not an object, no integer `version`, or `claims` not a list. The next write replaces it.
  - `WARN: trickle claims <path> version <v> — read as none, left for its writer`: the file is `{"version": 1, "claims": […]}`, and one of another version is never written.
  - `WARN: trickle claims <path>: <why> — this call's starts are not claimed`: the write failed.
- An engine snapshot from before p28-3 (ADR 0043) neither reads nor writes the file, so its starts keep the old window, one call's starts per lead.
- A seeded revise (execute § 4.5 step 1.2) is bounded by `slotLimit`, claims included, but is not itself claimed, because `next` cannot know `autoRevise`. So two leads can still overshoot the Trickle or the Away cap by up to the revises one step 1.2 launches, from step 1.1's `next` to each revise's § 4 stamp. Claiming it is [[thread-skill-p28-8-trickle-claim-a-seeded-revise]]'s.

**A parallel rollout with no lead holds the Trickle for nobody.** The count reads notes, never sessions, so a parallel rollout whose lead is gone keeps its `in_progress` notes in every other rollout's `trickle.elsewhere` for as long as it is left: its session closed, or a § 7 halt left stalled rows (a git-env halt does, and deletes the heartbeat, so no tick re-enters it). Those notes hold Trickle room (Away, Away-cap room) while nothing of theirs runs, the case that keeps serial rollouts out of the count, and other rollouts' new starts wait behind them; restarts never do. The remedy is Lachy's: `trickle.elsewhere` names the rollout, and stamping it `paused:` (execute *Pausing + reinstating a rollout*: the hard pause's first step, its calls already dead) takes it out of the count at once; its reinstate, `/thread:execute [[<rollout>]]`, restarts its stalled tasks and they count again. Resuming it instead (`/thread:execute [[<rollout>]]`, or `/thread:repair` after a halt) gives its notes a lead again, so they hold room for a task that runs. A liveness signal (a lease the live lead refreshes, so a lapsed one stops counting) is a later task's.

## Heat

The **Heat hold** (estate ADR 0009 d5): while the Mac is hot, nothing new starts and no suite is added to it. The afternoon of 2026-10-21 showed why: heavy agent work on battery reached thermal emergency, and the kernel held the power budget at 1 to 3 % until a forced power-off.

**The reading.** `notifyutil -g com.apple.system.thermalpressurelevel` gives the Mac's thermal pressure: 0 nominal, 1 moderate, 2 heavy, 3 trapping, 4 sleeping (`pmset -g therm` reports nothing on Apple Silicon). One function reads it, `heat_level()` in `skills/execute/scripts/verify-slot.py`, fresh on every call and never cached; `next` loads it from there. It fails open, like an unusable verify-slots dir: no `notifyutil` (Linux, CI), a non-zero exit, a 2-second timeout or output it cannot parse reads 0, and so does a `verify-slot.py` that will not load (Windows). `THREAD_HEAT_LEVEL`, an integer from 0 to 4, pins the level: the test suites pin it at 0 (`tests/run.sh`, `tests/lib/rollout-fixtures.sh`, `tests/lib/merge-task-env.sh` and every suite that reaches a reading), so a hot Mac never flips an assertion. Any other value is ignored.

**The limit.** `next` reads the level once a call, right after the Away state, so a refused call reads neither. At heavy or worse `slotLimit` is 0, so no new start, seeded revise or head Solo task launches. It holds Away too: heat overnight is still heat. **A restart still waits on the ceiling alone**, as under the Trickle: it takes back a task every lead already counts. A running call is never stopped by `next`; its own suite is the verify slots' to hold or stop (below).

**The hold.** A row held for want of a Slot reads `heat: the Mac is hot (<name>)`, the level's name, unless this rollout's ceiling is full (`ceiling:` first). It replaces the `trickle:` and `away cap:` reasons while the Mac is hot, and since no Slot is found the last starts never read the row. A head Solo task the heat holds gets the `heat:` reason, and the rows below it still read `behind solo [[…]]`. A whole-rollout (bare) git-env hold, a main-red hold (`next`'s `mainRed`), a pause and a standing rollout `hold_until` hold their rows themselves, so none of them ever reads `heat:`. A git-env trip that holds the lane only (ADR 0046) holds no Slot, so the Heat hold reads the rows as usual.

**It never halts.** A row the heat holds could start once the Mac cools, so while any row reads `heat:` the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6), even with nothing of this rollout in flight. A seeded revise the lead holds for want of `slotLimit` while the Mac is hot is a Heat hold, the same wait (execute § 4.5 step 1.5).

**The output.** `next` adds one key after `lastStarts`, every other key unchanged: `heat`, `{level, name}`, at every level. The Run record's `idle-slots` event reads `hold-heat` whenever the call holds a row on `heat:`, ahead of `hold-trickle`, `hold-away-cap` and `hold-last-start`; its `free` stays the ceiling's.

**The verify slots** (`verify-slot.py` contract 7). At heavy no verify slot is free: a new suite waits, `verify-slot: waiting (heat: heavy)`. At trapping or sleeping the wrapper also stops the slotted suite it runs (the guard's TERM, 10 s, KILL), releases its slot and goes back in line, at the back, to restart from the beginning once the level is below heavy. A suite that had already finished keeps its own verdict. A heat stop is never red: an agent's `run` exits only with its last run's rc, or 76 (`verify-slot: no verdict: …`) when stopped while the Mac is hot; the lead's `lead-integrate.py verify` re-queues inside its `--slot-wait` and reads `heat` (exit 76) once that wait runs out, as `noslot` (75) does for a slot. Both are no verdict.

**Agents' own Turns run on.** The Heat hold starts nothing new and adds no suite; it never stops a running task call, whose model Turns go on (only its suites wait or restart).

## Away

While Lachy is Away (a fresh file with `away: true`), the **Away cap** A bounds the Rollout tasks running across the whole Mac in the Trickle's place (ADR 0049, overturning Chorus ADR 0104 d3, which ran every Rollout to its own ceiling). It counts as the Trickle does (§ The Trickle): the same count elsewhere, `slotLimit` at `min(ceiling, max(0, A − the count elsewhere))`, and a restart that waits on the ceiling alone. Each rollout's `parallel_ceiling` still bounds its own share: a rollout whose own ceiling binds first reads `ceiling:`, as by day. A hot Mac still holds every new start Away (§ Heat).

**The value.** A is a fresh file's `away_cap`. With the key absent the built-in is 4: twice the Mac's two Verify slots (`verify-slot.py --slots 2`), so two suites run and two queue, where on the night ADR 0049 records eight rollouts ran to their own ceilings at load 139 to 149. A fresh file with no `away_cap` and a `trickle` of 4 or more lifts the built-in to `trickle` + 1, so the Away cap is always above the Trickle, as Chorus keeps it. Chorus's own default is the same 4, so a hand-written file without the key behaves as the Stage's. A stale, unreadable or missing file reads not Away, so the Away cap never binds there (§ Reading it).

**A meant wait.** A row the Away cap holds reads `away cap: <running>/<A> tasks running on this Mac`, and it never halts: a rollout the Away cap alone holds is a meant wait, never Stalled (ADR 0048), even with nothing of it in flight. `halt` stays null, the lead's turn ends `waiting` with that reason (execute § 4.5 steps 1.5 and 1.6), and the Run record's `idle-slots` reads `hold-away-cap`, so the Watchdog verdict reads a wait on the Away cap.

**A dead lead's notes hold room.** The count reads notes, never sessions, so a rollout whose lead died holds its Away-cap room until the Watchdog recovers it (ADR 0048) or Lachy pauses it (the `paused:` stamp, § The Trickle); the Companion has no pause.

**Tuning.** `mark-started` records the cap in force at each Slot start, slot-taken's `cap`, `{away, n, file}`, in the Run record, read once per run and silently (`next` prints the WARN). A Reflection reads it against suite times, verify reds and load once the record carries them (p29-10), and tunes A like any knob (ADR 0032, 0049); Throughput is the Guardrail on how low it may go, since a night of many rollouts finishes later per rollout by design.

What is still running at the Morning finishes; nothing new starts above the Trickle until he is Away again (Chorus ADR 0104 d4). The Evening's switch gives more room (the Trickle to the Away cap); the Morning's may leave `slotsInUse` above `slotLimit`, and then nothing new starts until the count falls. While Away runs to the Morning, the last starts hold a start that would not finish by it (§ The last starts).

## The last starts

Toward the Morning a task starts only if its kind's usual length ends it by the Morning's hour; with no history for its kind, nothing starts in the last two hours. Running tasks finish (Chorus ADR 0104 d4). `next` holds the start; the lead never reads the file or the history.

**When they apply.** All three must hold:

- a fresh file reads `away: true`;
- its `until` is the Morning: read in local wall-clock time (the Mac's system time zone, as `morning` is), `until` falls on `morning`'s HH:MM to the minute;
- M, that `until` with its seconds cut, is after now and at most 24 h ahead (now < M <= now + 24 h).

M is the same instant, at the local offset (an `until` written as `2026-10-03T22:00:00Z` under Australia/Melbourne gives M `2026-10-04T09:00:00+11:00`), so a night across a daylight-saving change needs no wall-clock arithmetic. `until` must be the Morning because Chorus writes it as the latest end among what holds now (Chorus ADR 0104 § Built): the Morning's hour for the Evening and its 05:00 to 09:00 tail, the block's end for an Away block, Lunch's end for the Lunch restart. So the Evening, its tail, an Away block ending at the Morning and § Without a writer's hand-written file all apply.

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

**What they hold.** A queued task's start and a head Solo task's lone start, checked only once a Slot is found: a row held for want of one keeps its `ceiling:` (or `away cap:`) reason, since the Away cap, never the Trickle, binds while Away. Restarts are exempt: a stalled `in_progress` task, a set-aside task handed back and a seeded revise each re-enter a task already begun, and running tasks finish. The hold reads, quote-free:

- with history: `last start: <kind> usually takes <N> min (median of <k> past runs), past the Morning at <HH:MM>`, N the median rounded up to a minute;
- with none: `last start: no history for <kind> (<k> past runs, 3 needed), none starts in the 2 h before the Morning at <HH:MM>`.

A held row is skipped, never a stop: the next best row may still fit, so a short kind starts below a long one. A head Solo task the last starts hold reads `last start:`, and the rows below it read `behind solo [[…]]`. A whole-rollout (bare) git-env hold, or a main-red hold (`next`'s `mainRed`, a RACE revert that did not land), replaces every hold, and a pause holds its rows itself, so none of them ever reads `last start:`. A git-env trip that holds the lane only (ADR 0046) holds no Slot, so the last starts read the rows as usual.

**It never halts.** While any row reads `last start:`, the rollout is neither `stuck` nor `awaiting-sign-off`: `halt` stays null and the lead waits (execute § 4.5 step 1.6). At the Morning the file reads not Away and the Trickle takes over. The Run record's `idle-slots` event reads `hold-last-start` whenever the call holds a row on `last start:` (after `hold-trickle`, which never co-occurs, and after `hold-away-cap`, which can: a call holding rows on both reads `hold-away-cap`).

**The output.** `next` adds one key after `trickle`, every other key unchanged: `lastStarts`, `{morning, kinds}`. `morning` is M as ISO 8601 with its local offset, or null when the last starts do not apply. `kinds` is `{<kind>: {usualMinutes, history}}` for each kind this call's start candidates read, sorted: `usualMinutes` the median rounded up to a minute, or null with no history, and `history` the kind's past runs. It is `{}` when they do not apply, or when no candidate reached the check.

## The night record

Per night, the starts the last starts held and the tasks still running at the Morning are recorded in each rollout's own Run record (`<rollout>.jsonl`, `skills/_shared/scripts/run_record.py`), the Reflection's input (ADR 0032), so a Reflection can tune the two-hour fallback and the Trickle's number (Chorus ADR 0104's Consequences). `next` is the one writer: off `--dry-run`, once its refusals pass, after its `idle-slots` event, each line best-effort. It reads this rollout's record once per call, and writes each line once (a missing record is an empty one):

- `away-night` `{morning}`, no task: one per (rollout, M), on any call where the last starts apply. It is the night's denominator, nights with no hold included. A daytime Away block never writes one.
- `last-start-held` `{morning, scope, history, usualMinutes?}`: one per (task, M), for each row of the call's final holds that reads `last start:`. A whole-rollout git-env, main-red or pause hold writes none.
- `ran-past-morning` `{morning, slotTakenAt, scope, history, usualMinutes?}`: for every `away-night` marker in this record whose M is at or before now, one per (task, M) for each task whose Slot was open at M: its first `slot-taken` before M, and no `slot-freed` (or `carried` in this, its from-file) at or before M, by the record's pairing rules. `slotTakenAt` is that `slot-taken`'s ts.

The Slots are read from the record, never from notes, so a Morning the lead missed (down at 09:00), or a file gone stale after it, is still recorded at its next call, whatever the file then says. A dead lead's Slots count, as they do for the Trickle and the Away cap; a night whose writer died before the Morning ran at Trickle 2 from then on, so a task the Trickle started that was still open at M ran past it too. `scope` is the task note's kind (`unscoped` with no note); `history` and `usualMinutes` are the kind's reading at the write (`usualMinutes` only with history), so a Reflection tells a fallback overrun from an underestimate.

`morning` and `slotTakenAt` are UTC `Z` stamps. A night is keyed by its `morning`: its record is the union of the three kinds sharing that `morning` across every `<rollout>.jsonl`. A rollout with no `next` call while Away to the Morning (every Slot busy all night with tasks begun by day) writes no marker, so that night has no record for it. Serial rollouts never run `next`, so they are outside the last starts, as they are outside the Trickle.

An unreadable record writes no night line, since its dedupe cannot be checked: while the last starts apply, `next` prints one `run_record: warning: night record not written: <why>` line on stderr; otherwise it is silent.

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

Its `until` is the Morning, so the last starts apply to it (§ The last starts). A hand-written file goes stale at its `until`, or 24 h after its `written_at`, whichever comes first; from then on each lead prints the `WARN: ~/.config/thread/away.json stale: …` line on every `next` call, and the Mac is back at Trickle 2. Delete the file to go back to the default with no WARN.
