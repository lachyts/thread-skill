# 0075 — A rollout waits instead of stopping, and never notifies

Date: 2026-11-07
Status: accepted, not built. Grilled with Lachy on 2026-11-07 in the Leg 1 session of
`reference-loop-rollout-2026-11-06-2`, after that Leg's begin stopped on a surface re-check that timed out and its
needs-you push reached nobody. Written by Phase 41 · Task 1 (`thread-skill-p41-1-adr-0075-rollouts-wait-and-never-notify`);
P41-2 to P41-6 and one Chorus task build it. Supersedes ADR 0038 d3 (the ntfy fallback), ADR 0048's launchd fallback
(the last sentence of its Decision bullet *Catch what is not a hold*, "When Chorus is not running, a launchd job reads
it instead and only notifies Lachy", and *The launchd fallback* in its *How p29-7 built it*) and every notice of ADR
0066 (d2's Notice, and each notice its 2026-11-05 amendment sends or bundles: item 4's timeout notice, item 5's
cadence, item 6's refused-tip notice and `ntfy-push.py` bundle row, and item 9's job-spell notice). Overturns ADR
0048's rejection of its Considered option *The watchdog in one place*: the Watchdog is Chorus's alone (d5). Amends
ADR 0034 d3 ("pushed once"), ADR 0067 d2 (schedule gives every new chain its Chain copies; d2's in-place branch, for
a note without `chain_copies:`, survives only as the reader for a note written before this ADR, d4) and ADR 0067 d4's
token rule (a bare `repo:<toplevel>` cell in a copied chain stands against an in-place peer only, d4).

## Context

On 2026-11-06 Leg 1 of `reference-loop-rollout-2026-11-06-2` stopped before it began. `leg.py begin`'s surface
re-check, a read-only `unfinished-rollout.py check`, ran out of its 60 s while the Mac's load average stood at 53. The
Leg ended `halted` and tried to push the stop to Lachy's phone. The push reached nobody: Remote Control was off, and no
`[notify] ntfy_topic` had ever been set.

A re-run at normal load took 7.7 s and gave a real answer: `seo-rollout-2026-11-02` held the whole `workspaces` repo.
That chain works in place (its note has no `chain_copies:`), had been stuck on Lachy since 2 November with four tasks
set aside, and claims the bare `repo:/Users/lachlants/repos/workspaces`. So both stops, the slow check and the real
hold, handed the restart back to him, and neither reached him.

Research behind the grill found four things:

- **Chorus already gives the signal he wants.** It has no phone push. A halt that is his (Chorus's `halts.py`,
  its `HIS_HEADS`) becomes a demand, and the Companion leads him to it when he is at the Stage; every other halt goes
  to Upkeep. All the push code is this repo's: execute § 6.5's push and its ntfy fallback, `ntfy-push.py`, the
  launchd `watchdog.py`, and `primary-refresh.py`'s notices.
- **Why the check is slow.** `reconcile-rollout.py`'s `_scan` re-reads every task note (2,897 on 2026-11-07) about 38
  times per check: two scans per unfinished serial note in `unfinished-rollout.py` (`note_state`, and `chain_hold`
  through `leg.Chain`).
- **A chain that works in place never converts by itself.** `chain_pairs` gives nothing without `chain_copies:`, and
  only a hand-run `leg.py copies` stamps it, so an in-place chain keeps claiming its whole checkout for as long as it
  is unfinished.
- **Nothing outside the session wakes a waiting Leg.** `reconcile-rollout.py moving` skips every serial note, so the
  Chorus Watchdog never watches a Leg; and a Stage respawn after an hour at rest kills a poller the session started in
  the background. That happened twice to the session that held this grill.

Lachy's words, from the grill:

> this shouldn't block a rollout from running

> I don't want to get notifications about rollouts. I want to be able to fix all rollouts when I sit down
> intentionally to fix them

> if I'm actually at the Mac, then I should get a notification. A rollout breaking or stopping should be a
> high-priority notification … the companion leading me to that session … nothing via my phone.

## Decision

**d1. The Begin wait.** A Leg that cannot begin yet waits and begins itself. Two causes are a Begin wait: the
surface re-check that goes unanswered on a busy Mac, and another rollout's hold on a place this Leg would write (a
surface stand, ADR 0060 and ADR 0067 d4). Neither is a halt. `leg.py begin` ends `state=waiting reason="begin wait: …"`
with nothing written, and the Leg waits for the check to pass, then runs begin again. A Leg never begins without a
passing check: a timed-out check retries for longer and, still unanswered, reads as `unanswered`, never as a pass and
never as a refusal. Every other refusal stays `halted`. The wait is the session's (a background poll, Codex's a
foreground loop), and its only record outside the vault is a marker under `~/.config/thread/leases/`; the vault is not
written until begin runs. Parallel execute's § 4.5 Surface re-check takes the same rule: a hold or an unanswered check
ends the turn `waiting`, and the heartbeat re-enters, never § 7.

**d2. No rollout ever pushes.** No verb, script or job of this plugin sends Lachy a notification about a rollout or
the checkouts it runs from: no PushNotification, no ntfy publish, no notify-only launchd job, no mail. This supersedes
ADR 0038 d3 (an undelivered push falls back to ntfy), ADR 0048's launchd fallback (`watchdog.py check` notifies when
Chorus is not running) and every notice of ADR 0066 (d2's 24-hour Notice, and its 2026-11-05 amendment's timeout
notice, notice cadence, refused-tip notice and job-spell notice). It amends ADR 0034 d3: a gate found mid-run is set
aside and listed, never pushed. A Needs-you item stays in the report's `Needs you:` block and in the rollout note, for
a sitting he chooses. A Primary checkout that stays stuck stays in `primary-refresh.py`'s state file, and
`/thread:status` reads it there: P41-5 adds a Primary refresh line under its engine line, so a sitting sees it. The
`[notify]` table is retired: `rollout-settings.py` tolerates it with one warning and never refuses a file for it,
since removing a key must never halt every rollout.

**d3. The only signal is Chorus's Companion lead, read off an honest `halted` line.** When Lachy is at the Mac in
Chorus, the Companion leads him to a rollout that has stopped as a whole and needs him; that is the one signal, and it
is Chorus's. This repo's part is to keep the line it reads honest. A turn ends `state=halted` only when the rollout
or chain has really stopped as a whole, never for a wait (a Begin wait ends `waiting`, d1) or a single set-aside.
Which halt leads him is Chorus's reading (its `halts.py`, `HIS_HEADS`), and every other halt goes to Upkeep for
repair. A single set-aside stays listed in the rollout note and the report for a sitting he chooses, and leads
nowhere.

**d4. No serial chain works in place.** Every serial note gets `chain_copies:` when it is scheduled: schedule's
Serial path S5 runs `leg.py copies` for every chain, unconditionally. The in-place branch that ADR 0067 d2 left for a
note without `chain_copies:` survives only as the reader for a note written before this, and a one-time sweep converts
the unfinished ones. A bare `repo:<toplevel>` cell in a copied chain stands against an in-place peer only, never
against another copied chain's begin; copied chains still meet file to file at claim (the Rank wait) and at land, as
in ADR 0067.

**d5. `moving` watches waiting Legs.** `reconcile-rollout.py moving` no longer skips a serial note that has a Begin
wait marker, or an open Leg whose lease reads `waiting` (a Begin wait, a Capacity wait or a review wait). It reads
`waiting` while the marker or lease is fresh, and `stalled` once its session is gone or it is stale past
`STALL_AFTER_MIN`; every other serial note stays `skip`. So the Chorus Watchdog can recover a waiting Leg whose
session died, with one Stage Prompt (`/thread:execute [[<slug>]]`), as it recovers a parallel lead. The Watchdog is
Chorus's alone.

## Considered options

- **A longer timeout only:** declined. It moves the stop, it does not remove it. A Mac busy for longer than the new
  timeout halts the Leg again, and a real hold still halts it and hands the restart back to him.
- **One push for a broken main:** declined. Lachy wants no rollout notification away from the Mac, and a broken main
  holds only the merges it threatens (ADR 0048); the Companion leads him to it when he sits down.
- **A daily digest:** declined. It is still a notification he did not ask for, and the report, the rollout notes and
  `/thread:status` already hold everything it would say.
- **Keep the launchd fallback for rollouts run outside Chorus:** declined. It only notified, and d2 removes the
  notice; with nothing to send it has nothing to do. A rollout outside Chorus is read when he runs `/thread:status`.
  That gap was ADR 0048's reason to reject *The watchdog in one place*; with no notice left to send, it no longer
  holds.
- **Skip the check on a timeout:** declined. A Leg that begins without a passing check can write a place another chain
  holds.

## Decided for him (overturnable)

- **The begin check retries longer and never skips.** A Leg never begins without a real answer.
- **The slow check is fixed with a once-per-process index, not a cache kept between runs** (P41-2). Nothing stale
  survives a run.
- **`[notify]` is ignored with a warning, not refused.** Removing a key must never halt every rollout.
- **The Needs-you log keeps only the Standing approval's ledger.** Its push lines served only dedupe; old ones stay as
  inert history.
- **The work is a new phase, P41, scheduled behind the live thread-skill rollout.** The two never collide.

## Consequences

- The build is P41-2 (the check scans the vault once), P41-3 (the Begin wait in `leg.py`, legs.md and execute § 4.5),
  P41-4 (`moving` reads waiting Legs), P41-5 (every rollout notification removed: `ntfy-push.py`, `watchdog.py` and
  their tests deleted, execute § 6.5's push rules dropped, `primary-refresh.py`'s notices dropped and its state file's
  stuck spells read by a Primary refresh line in `/thread:status`, `[notify]` ignored with a warning) and P41-6 (no
  chain works in place). One Chorus task follows P41-4: its Watchdog takes `moving`'s serial verdicts.
- Until P41-5 lands, execute § 6.5 still pushes and falls back to ntfy, and `primary-refresh.py` still sends its
  notices; CONTEXT.md's **Needs-you item**, **Primary refresh** and **Rollout settings** entries say so beside this
  decision, and P41-5 drops those interim clauses.
- `primary-refresh.py`'s self-update contract (ADR 0066's 2026-11-05 amendment, items 6 and 7) still holds. Dropping
  `ntfy-push.py` from its bundle table is a table drop, which the installed copy removes on its next fetched pass;
  `background_job.py`'s interface is frozen additive only, so its ntfy call may stay in the module, unused.
- `moving`'s serial verdicts change a contract Chorus reads, so its Watchdog task lands after P41-4 and before
  anything relies on a serial `stalled`.
- A Leg's Begin wait can last as long as the holder's turn. That is meant: it is a wait, not a stall, and the
  Watchdog recovers it only once its session is gone or it goes stale.
- The Run record's `watchdog` cause stays: it names Chorus's recoveries, never a notice.
