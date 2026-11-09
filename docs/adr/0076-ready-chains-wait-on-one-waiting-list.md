# 0076 — Ready chains wait on one Waiting list, not in open sessions

Date: 2026-11-08
Status: proposed. Grilled with Lachy on 2026-11-08 (`/grill-with-docs`, thread-skill session), after an audit of the
chains the 2026-11-06 and 2026-11-07 orient passes started. Amends P41's Begin wait ([[thread-skill-p41-1-adr-0075-rollouts-wait-and-never-notify]], its ADR in review: the Begin wait is the Waiting list's,
not the session's) and ADR 0072/orient-all's Leg launch (a serial chain is listed, not launched). Leaves ADR 0067
(Chain copies, file claims, Capacity, rank) and ADR 0074 (one chain per project, sign-ins at schedule) as they are.

## Context

On 2026-11-08, 33 rollouts were open: 4 parallel and 29 serial chains. Each chain already worked in its own Chain copy,
so no two of them shared a checkout. They were stuck anyway:

- Nine chains stopped at begin between 12:49 and 12:52 on 2026-11-06, on *"[[seo-rollout-2026-11-02]] holds
  repo:~/repos/workspaces"*: a pre-0067 note's whole-checkout claim. That rollout was archived later, but a stopped
  chain never looks again.
- Four stopped on *"surface re-check failed: TimeoutExpired"*: about 20 Legs began in three minutes, load reached 36–65,
  and begin's 60 s check ran out of time.
- The Animately App orient of 2026-11-07 wrote nine one-task chains. None ever got a Leg, though each read ready to
  claim, because nothing starts a serial chain on its own.
- Capacity read 2 (of a maximum of 6), halved for growing swap, while about 20 idle Leg sessions sat on the Stage.

P41's Begin wait makes a held begin wait instead of stopping, but the wait lives in the open session, which polls every 60 s.
With 30 chains and room for 2 that is 30 open sessions loading the Mac, pulling Capacity down and filling the Stage,
which is the admin Lachy named: "it requires a lot of my admin to work with each of them … It'd be good to have a
system where I can run rollouts throughout all these different projects and it all runs smoothly."

## Decision

**d1. One Waiting list for the estate.** A serial chain that is ready to run but has no room, or whose files another
rollout holds, waits on the Waiting list (CONTEXT.md), with no session. It is opened a Leg session only when it reaches
the front and Capacity has a free place, best Estate rank first (Lachy's pick, 2026-11-08: "One queue").

**d2. A chain on the list holds nothing up.** A chain at the front whose files are held is passed over for the next one
that can start, and keeps its place for when the hold clears (ADR 0048: no single cause holds the whole queue). A begin
that finds a hold once its session is open ends that session and puts the chain back on the list in its old place.
A timed-out check is a hold in this sense, never a stop.

**d3. The list is read from the notes, and started by the Stage.** An unfinished serial note with `start: unattended`,
no open Leg and no stop that needs Lachy is on the list; no other store holds it. thread-skill answers *which chain
next* (a read-only verb over Capacity, holds and rank, usable from a terminal); Chorus's Stage starts that chain's Leg
in its launch folder inside its Chain copy, as it starts a parallel lead today. A Leg session counts against Capacity
from its start, not from its first claim.

**d4. Orient and orient-all list chains; they never launch a Leg.** Schedule's serial path writes `start: unattended`
on each chain note it writes for a run Lachy approved. orient-all's Leg items, and a Leg's handoff to the next Leg,
stamp the note instead of calling `create_thread`. Parallel rollouts keep one lead each, started as today.

*(Amended by P44-4, 2026-11-10: only a writer on the Chorus Stage lists a chain (Chorus's `list_sessions` answers).
Schedule stamps only on a standalone run; under orient, orient-all and the Backlog orient the parent stamps
(`reconcile-rollout.py stamp-start`), so his Not yet withholds the stamp. Off the Stage nothing is stamped, and Leg 1
is pasted: a chain is listed or has a paste-ready prompt, never both. A Leg's hand-over writes `hand-over: listed`
(`leg.py handed --listed`). A manual hand-over stays off the list, reversing P44-1's reading that it was on it, until
repair lists it; repair rejoins a fixed or held chain with `leg.py restarted --listed` (d6). A Leg closed with a
handoff counts as its chain's session (`closing Leg N`) until its hand-over is written.)*

**d5. He sees it as one quiet line.** The Stage shows one line (how many chains wait, which is next, how much room),
which opens into the ordered list with a click: no notification, no card per chain, no command to run (Lachy, 2026-11-08:
"I just want to be at least able to, with a click, see what that list actually looks like"). Where the line sits is a
Chorus design call.

**d6. A stop that needs him leaves the list.** A chain stopped for a sign-in, a gated input or a wrong checkout is off
the list and listed in its rollout note for a sitting he chooses (P41: a single set-aside leads nowhere); it rejoins once fixed.

## Considered options

- **Every chain's session open at once, each waiting by itself** (P41's Begin wait as written): rejected. It is the
  start-up herd behind four of the 2026-11-06 stops, the idle load behind today's halved Capacity, and a Stage full of
  sessions that do nothing.
- **A few sessions open ahead of room** (Capacity plus two, warm and waiting): rejected. Opening a session takes
  seconds, and warm sessions cost memory while they wait.

## Consequences

- P41's in-session poll (`begin-wait`, P41-3) and its watch of waiting Legs shrink to the case of a Leg already
  running that meets a hold at claim; the begin case moves to the list.
- Today's stuck chains are moved onto the list once it is built: their idle Leg sessions are closed, stale halts on an
  archived holder or a timed-out check are cleared, and the Animately App's nine one-task chains are regenerated as one
  chain (ADR 0074 d1).
- Chorus records the Stage half (starting a listed chain, the line and its list) in its own ADR.

## Decided for Lachy (overturnable)

1. The list lives in the rollout notes (`start: unattended` on a serial note), never in a separate file: one truth, and
   a crash loses nothing. (technical)
2. Chorus's Stage starts the Legs and thread-skill picks which: the Stage already owns sessions and writes Capacity, and
   a terminal still sees the same answer. (technical)
3. A held front chain is passed over, never waited on. (priorities: get as much running as possible)
4. Parallel rollouts stay out of the list: each is one lead, which already starts tasks only as Capacity allows.
   (technical)
5. Today's stuck chains wait for this build rather than being restarted by hand now, since a manual restart opens the
   same herd of sessions; the idle Leg sessions are closed first, which frees memory and lets Capacity rise. (technical)
