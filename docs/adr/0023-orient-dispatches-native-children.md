# 0023 — orient dispatches native children of its own session

Date: 2026-10-14
Status: accepted (supersedes ADR 0010)

## Context

On 2026-09-14 orient's batches moved from cmux-launched profile sessions to native child agents of
the orient session, through the shared exchange at
`~/repos/workspaces/_shared/scripts/native_workflow.md` and its generic batch engine
`native_workflow_batch.workflow.js` (this repo's `e4b8378` and `e586b19`). No ADR recorded the
switch. ADR 0010 still read accepted: it has orient launch each batch with `cmux workspace create`
and calls in-session fan-out "impossible", because a child inherits its parent's MCP config. The
skill ended up arguing with itself, at these anchors in `skills/orient/SKILL.md` (`c3bf2bf`):

1. "background scoped sessions" in § 6's **Autonomous** option (l.210–211), against § Runtime
   boundary's native children;
2. "cc-* batches" in § 6's rollout-lane bullet (l.205–206), a launch lane the native model no longer
   has, and the citation of ADR 0010 as the launch authority (l.212, l.328);
3. § 7 **Profile fit**, "match each batch to the *narrowest covering* launch profile" (l.241–244),
   against § Runtime boundary, "a target workspace path does not load another MCP profile"
   (l.34–35);
4. § 10's "Fire-and-forget remains the default" (l.320) against § 8 step 5, which collects each
   child's output and accepts its envelope (l.267);
5. outside the skill, the README's orient row (ADR 0010) and § Runtime support ("a scoped `cc-*`
   profile and cmux"), and `skills/_shared/execution-fit.md`'s session-lane bullet ("orient's
   parallel-safe cc-* batches").

Two incidents show the failure a split doctrine leaves open: one orient batch, two live sessions.

- **2026-08-14, on the cmux path.** During the first cmux self-launch run (ADR 0010's same-day
  validation), both SEO batch prompts started twice, about three minutes apart. The duplicates stood
  down cleanly.
- **2026-09-14, the `method-skill-bakeoff-fixes` batch.** The task was already stamped
  `dispatched: 2026-09-13`, and its prompt file was
  `ops-workspace/.scratch/orient/2026-09-13-method-skill-fixes-prompt.txt`. It ran in two sessions
  at once. Both edited `~/.agents/skills/method` in place, and the second's commit `6bf81a0`
  overwrote `f3e95cf` and `3bd3b31` (reverted as `4edb9cb`). No run journal exists for it (the
  first run dir is dated 2026-09-17), so the second launch passed orient's "don't re-batch a recent
  `dispatched:` stamp" rule by a path the record cannot recover: a second paste of the prompt, or a
  re-run. A guard at orient's dispatch step alone would not have held. It has to hold at both
  ends: orient's dispatch, and each batch prompt's own preflight.

The gather of 2026-09-26 folded in one more request: every native child orient launches names its
tier and its effort, never inheriting defaults silently.

## Decision

**a. One launch model.** Orient's Autonomous and Mixed batches run as native child agents of the
orient session, through the shared exchange and `native_workflow_batch.workflow.js`. Never cmux, a
terminal launch of a launch-profile alias, a model CLI, another harness or another account.

**b. Capability fit replaces profile fit.** Children inherit the calling session's tools and
account; a target workspace path loads no other profile. Per batch, orient checks the required MCP
namespaces and accounts against the calling session. A batch that needs something absent is
blocked, never substituted: its prompt file is kept, its tasks stay unstamped and it gets no job.
The report names the launch-profile alias that would cover it, so Lachy can launch it by hand: a
hands-on launch outside orient, which still runs the prompt's Twin check. Run the dispatch from the
narrowest profile that covers the batches, because kitchen-sink MCP sets still kill fan-out
("Prompt is too long").

**c. Collect-and-accept.** The orient session is the lead. It stays open until each child
returns, collects it and accepts its envelope, and the children's end lines in the covered task
notes are the durable record. Fire-and-forget retires with cmux, because a native child is bound to
its lead. This narrows the grilled "`--debrief` is the recovery path for a lead that ended before
collecting": `--debrief` collects and accepts only in the lead's own session. The exchange's
`sameCaller` check refuses any other caller, and it promises no cross-session handover. A lead
resumed with `claude --resume <id>` keeps its session ID (a `--fork-session` copy gets a new one),
so it can run `--debrief` itself; whether its children survive the exit is unverified. From any
other session `--debrief` classifies the run read-only, so a dead lead's uncollected envelopes are
lost, and the children's end lines in the task notes are the record.

**d. The steering answer stays the only launch authorisation.** ADR 0010's ruling 2 carries forward
unchanged: Autonomous, or the batch half of Mixed, authorises every batch, with no per-batch
confirm.

**e. A batch lands once.** Four rules hold it, at orient's dispatch and in each child's preflight
(orient § 8, Double-dispatch guard):

1. *In flight stays out.* A task with a `dispatched:` stamp or an orient start claim ≤7 days old,
   with no end line of the same run and job after it, is excluded and reported. One override
   sequence re-dispatches it, the same everywhere: Lachy names it in the steering answer → orient
   runs the journal lookup → a run in flight elsewhere that covers it is reported → Lachy names it
   again → orient dispatches it in a new run dir and records the override.
2. *One unique run dir per dispatch, and a lookup before `init`.* Each area has one gitignored home
   for its prompt files and run dirs, and an existing run dir or prompt file is never reused or
   overwritten. Before `init`, orient reads every journal in the home as data. Its own run is
   recovered. A foreign run that overlaps the batch is in flight while its lead is a listed peer
   in the same config dir, or, wherever the peer list cannot decide, while the clock says it is
   live; otherwise it is abandoned, reported, and stops blocking. A foreign run is never called,
   edited, moved or advanced.
3. *Stamp right after bind.* The `dispatched:` stamp and a dispatch line naming the run, job, child,
   lead, model and effort are written after `bind`, before the next spawn.
4. *Every prompt carries the Twin check.* Its header names the dispatch's `issued:` instant, its
   run, job, lead, covered notes and owned paths. Before its first edit the child stops on any
   live-twin signal in the covered notes, probes only its owned paths, and writes a start claim.

This narrows the grilled rule that `git status` dirt in the target surface stops a child. Whole-path
dirt would stop children on the leftover partials the old emission bullet ("reconcile before
working") told them to reconcile, and the shared vault is always dirty. A child stops on an owned
path written after `issued:` (`find -newermt`), deleted, or, in a code repository, committed to
since `issued:`; that still catches a live twin that ignores the protocol. A dirty owned path
written only before `issued:` is an aborted partial, reconciled by building on it or reporting it.
Residual: a live twin whose last write predates `issued:` reads as a partial. Reconciling never
discards anything (no `checkout`, `reset`, `clean` or `stash`), so its work survives.

**f. Tier and effort.** Each job names the top rung's `model` and `effort` from the operator's
ladder (`skills/_shared/scripts/ladder.py`, ADR 0029, which superseded ADR 0024's `top-tier` file
that the gather named), so no child inherits a default silently. Where a harness has no per-child
effort control (Claude's native child tool takes a model, not an effort), the report says the effort
was inherited. A refused ladder blocks every batch, and their prompts are kept.

## Rejected

- **Keep cmux launches (ADR 0010).** A cmux workspace is another session that orient can neither
  bind nor collect, the 2026-08-14 double start came from it, and the native exchange already
  journals each claim and binds each child.
- **Fire-and-forget native children.** A native child is bound to its lead, and only that lead can
  accept its envelope; a lead that walks away loses it.
- **Stamp `dispatched:` before the spawn** (the absorbed guard task's first idea). A failed spawn
  would leave unlaunched work marked in flight. The journal claim is the pre-spawn lock, and the
  stamp follows `bind`.

## Consequences

- `CONTEXT.md` (its session-lane entry, **Batch**, **Dispatch artefact** and **`dispatched:`
  stamp**) still describes cc-* batches and the no-cmux fallback, and this change deliberately
  leaves it. The protocol 4 redesign that was to rewrite it was retired unlanded (THREAD.md), so a
  follow-up task owns the rewrite.
- The Codex orient adapter (`~/.agents/skills/orient/SKILL.md`, outside this repo) still says cmux.
- ADR 0003's launch conclusion, superseded by ADR 0010, now ends here.
- The lead must stay open until its children return. A lead that ends early loses their envelopes;
  the task notes' end lines remain.
- Abandoned foreign runs are reported and never touched; their tasks stay out for the 7-day window.
- An area whose home is not gitignored cannot host a dispatch (xr-workspace today, until its
  `.scratch/` ignore line lands); orient never edits `.gitignore`.
- Peer liveness rests on the `Lead:` ref and config dir that the lead records. A peer list shows
  only its own config dir's sessions (observed 2026-10-14), so across profiles the clock decides,
  and a dead lead there holds its tasks until the window runs out.
