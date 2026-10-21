# 0051 — The Reflection keeps a Time-lost ledger, and a monthly audit reads past the record

Date: 2026-10-21
Status: accepted. Ruled with Lachy after the audit of where rollout time went (the re-grill of PR #202). Extends ADR 0037's weekly reading, and amends its decision 4: the reading falls due on the Thursday Routine's morning, made by Chorus's weekly Runner.

## Context

The audit that preceded ADRs 0048 to 0050 found the merge train (ADR 0044) aimed at the smallest of the costs it measured, and only a ranking of hours lost by cause across rollouts showed it. The weekly reading could not have: it traces each friction item to its rule one at a time and proposes knobs, never sums time lost by cause across rollouts and weeks, and reads only the Run record, which held none of the audit's load, suite-time or restart evidence and missed three of nine usage-limit stops in `chorus-rollout-2026-10-18`. Its knobs are per rollout, so its only reading of 16 October proposed raising a Parallel ceiling while the Mac sat at load 149. It may file bugs and land knobs, never propose a rule, so a conclusion such as ADR 0048's ("stop fixing stalls one cause at a time") is out of its reach.

## Decision

**The weekly reading keeps a Time-lost ledger: the hours each cause class cost, summed across every rollout it reads and trended against past weeks. Once a month, an audit like this one reads past the record and writes into the same ledger.**

- **The ledger ranks causes, not rollouts.** The classes start from this audit's: stalls by cause, usage limits, machine load, the Integration lane, Integration rework, plan blocks. A class that tops the ledger in two readings in a row becomes a design question in the decision task, for a grill: the one route by which the weekly reading raises a rule.
- **The monthly audit reads what the record cannot hold** (transcripts, suite logs, pause logs, the Mac's own history), reconciles it with the ledger, and names what the record should have carried, so the weekly reading needs it less each month. It runs as an extra step of the first weekly reading of each month, before that reading's ledger, and lands in the same decision task; a fortnightly cadence never skips it. This audit is its first entry and the ledger's baseline.
- **The reading is made for Thursday.** Chorus's weekly Runner, which already makes the Companion's reading on the morning of the Thursday Reflection Routine, makes `/thread:reflect --weekly` too, so both are fresh when the Routine walks them with Lachy. The reading falls due on that Thursday, not seven days after the last; the daily sweep starts it only when Chorus has not. Before this, the only reading closed on a Friday, so the next fell due the day after the Routine that should present it.
- **The Run record carries what the ledger needs.** Four kinds of event join it:
  - every stop, with its cause (a usage or session limit, a dead lead, a Mac restart or sleep, a halt, a Watchdog recovery) and the calls it killed, and every resume, with what restarted it;
  - every suite run: who ran it (a task, Integration, a RACE), its start, end, outcome and any timeout, the tree it ran on (so a re-run of a passed tree shows) and the names of its failing tests (so a Flake shows);
  - the load at each suite's start and end: the load average and the Mac-wide count of running Rollout tasks;
  - on each base-moved refusal, what moved `main` (another rollout's merge or a peer session's push) and whether it touched only Inert paths.

## Considered options

- **A ledger only:** rejected. The record cannot show some costs at all (a stop no session lived to log), and only a reader with the transcripts finds them.
- **A monthly audit only, the weekly reading as it is:** rejected. A month is long enough to lose several nights to one cause before anyone ranks it.

## Consequences

- Today the record has none of these: `chorus-rollout-2026-10-18`'s 347 events are Slots, the lane, review verdicts, merges, holds and one pause.
- The weekly reading reads machine-wide causes, so a knob a per-rollout reading would raise (a Parallel ceiling) can be held when the ledger puts load above it.
