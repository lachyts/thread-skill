# 0027 — orient is the one shaping verb

Date: 2026-09-28
Status: accepted (amends ADRs 0003, 0009, 0010 and 0026; retires `split` and `gather`)

## Context

Lachy picks a project up by running `orient`, `gather`, `split` and `grill-with-docs` together in
one session (Chorus p29's own note: "`/thread:orient` → `/thread:gather` → `/grill-with-docs`").
The verbs did not know they were one move. Orient left a brain dump on the Hands-on pile
because it is conversation-gated and so fails the execution-fit test; gather grilled brain dumps
but treated a note holding two ideas as one task and took every existing phase as fixed; split
could fan a note out into tasks but assumed an approved plan and never grilled. After all of
that he still had to schedule, check dispatch blockers and set up a clean session before
`execute` could start. On pickup he almost always wants a **reshuffle**: stray bugs, brain dumps
and unstarted phases all back on the table, next steps rethought.

## Decision

Grilled 2026-09-28.

1. **Orient owns the reshuffle.** `/thread:orient <project>` audits, shows the report, then asks
   once: **Reshuffle** (recommended), **Steer only** (fix drift and route the work as it stands,
   e.g. to fan out batches) or **Look only**. Look only is the former Report-only steer moved up
   front and stays write-free.
2. **`split` and `gather` retire as verbs.** Their machinery becomes orient's reshape step. Pointed
   at a single plan, design note or brain dump, orient runs a **scoped reshuffle** of that note
   alone, which is split's old job. No alias stubs.
3. **Reach tiers.** In-flight work (live rollout, dispatched, in progress) is frozen: read for
   context, never re-scoped, re-phased or rewritten, though a superseding schedule may re-derive
   its wave. Unstarted phased work is movable. Loose work is fully open, including re-homing. The
   tiers hold across projects: a reshuffle reads related projects (parked or being absorbed ones
   especially) and may pull their unstarted work into its target, leaving a pointer.
4. **Sort, then grill only what is unclear.** Every item is sorted clear (straight to the gate) or
   unclear (brain dumps, one-liners: grilled, cluster by cluster, highest value first). Brain
   dumps are unbundled, one task per idea. The grill can stop at any point; what is resolved is
   written at the one gate and the rest stays loose. Gather's `--light` goes, since stopping the
   grill early does its job.
5. **Orient schedules and offers execute.** Wave-shaped phases are scheduled by orient itself. At
   schedules exactly the wave-shaped phases' members (`--tasks`), never a bare project run. At
   most one rollout is live per repo (schedule's gate stops on another project's), so new work
   **supersedes** this project's live rollout. A mid-run rollout is never paused silently: the
   execute offer asks, and **Pause and hand off** is the consent. The pass ends with the **execute offer**: a fresh session via handoff
   (the default, because the reshuffle has filled this context), here, or not yet. The steering
   question (Autonomous / Hands-on / Mixed) moves after the reshuffle and covers only session-lane
   work.

## Considered options

- **Gather widens into the reshuffle; orient stays a lighter audit.** Rejected: it keeps two verbs
  Lachy always types together, and orient's audit is the context the reshuffle needs anyway.
- **A new `reshuffle` verb replacing orient and gather.** Rejected: orient already has the right
  altitude and the steering and debrief machinery; a new name would only add a concept.
- **Keep `split` for single plans.** Rejected by Lachy: a scoped reshuffle covers it and one entry
  point beats a second verb to remember.
- **Reshuffles never touch phased work** (gather's old rule). Rejected: a real reshuffle has to be
  able to retire or re-phase unstarted work. Only in-flight work is protected.
- **A second rollout beside, or queued behind, the live one.** Rejected: side by side has nothing
  guarding file overlap between rollouts; queueing makes non-overlapping work wait for no reason.
  Supersede already exists (schedule 2.8.0).
- **Orient runs execute on an Autonomous steer.** Not chosen: execute usually wants a clean
  session, so it is an offer at the end, defaulting to a handoff.

## Consequences

- Orient's description has to carry split's and gather's triggers inside the 600–700 character
  skill-description budget.
- Everything that names `/thread:split` or `/thread:gather` (schedule, execute, the router skill,
  README, evals, tests) is rewritten to name orient; old names are deleted, never stubbed.
- ADR 0026's gather backstop becomes part of orient's reshuffle: the audit runs the reconcile step
  as a dry run and a Reshuffle answer applies its unambiguous list first. This lands task p10-3
  (orient reports and fixes drift) inside the same change.
