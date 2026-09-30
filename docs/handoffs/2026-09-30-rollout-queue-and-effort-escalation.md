---
thread: thread-skill
written: 2026-09-30
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

# Handoff: a rollout as a queue that integrates at merge, and effort escalation on a capped task

## 1. Done and verified

- **Two ADR drafts, PROPOSED, uncommitted in this checkout** (on `master`, working tree only;
  `git status` shows them):
  - `docs/adr/0029-a-capped-task-escalates-by-effort.md`
  - `docs/adr/0030-a-rollout-is-a-queue-that-integrates-at-merge.md`
- **CONTEXT.md, uncommitted:** new **Queue** and **Integration** entries; **Wave** marked retiring;
  **Cursor**, **Tier** and **Escalation** amended to point at 0029/0030. `git diff CONTEXT.md` shows
  all of it.
- **Where it came from:** a Chorus `/thread:orient` on 2026-09-30 scheduled
  `chorus-rollout-2026-09-30` (vault `Work/Tasks/`), 53 tasks in 36 waves, because nearly every task
  edits `src/stage/static/stage.js` and schedule § 5's same-file invariant serialises them. Lachy
  asked two things, grilled in that Session (`/grill-with-docs`), which produced the drafts. He then
  **parked** the Chorus rollout (`paused: 2026-09-30T11:33:33+10:00` on the note, with a callout
  saying why) and asked for this design to be grilled here.
- **Engine facts read, not guessed:**
  - `skills/execute/wave-execute.workflow.js` `EFFORT` (line ~880): a capped (terminal) task already
    takes the top row, so the planner and implementer run at `high` from the first pass; escalation
    is model-only (opus→fable) and is switched off under `max_tier: opus`.
  - `skills/execute/scripts/merge-wave.sh`: each PR is brought up to date by GitHub's REST
    update-branch and trusts the repo's required checks. It HALTS on a conflict. Chorus has no CI,
    so a textually clean update is never re-verified before merge.

## 2. What remains

1. Grill the drafts further (`/grill-with-docs` in this repo). Open edges the first grill did not reach:
   - **Integration's owner:** the task's own implementer, re-dispatched with its diff and the landed
     PRs, or a dedicated integrator role? Is the short re-review the master review at a lower effort,
     or a new judge? What exactly counts as "the resolution changed code"?
   - **The plan-gate under a queue:** a task plans against the `main` of its start, and a plan that a
     landed PR made stale surfaces only at integration. Re-plan, or reconcile at integration?
   - **Queue order and priority:** by `priority:`, then schedule's order? Can Lachy reorder a live queue?
   - **The cursor and reporting:** replacing `merged_through_wave`, the Stop-hook driver's
     `WAVE-STATUS` line, the heartbeat, `/thread:status` and `/thread:repair`.
   - **Soft pause** without wave boundaries: pause after the running tasks integrate?
   - **The smart-halt** (the `## File-sets` block) becomes advisory. Confirm nothing else reads it as a gate.
   - **ADR 0029:** `escalatedBy` in the result schema; whether a plan block counts as the trigger;
     interaction with per-task `effort:`.
2. Land the docs (master is protected: branch + PR, ADR 0025/0028).
3. Plan the build as phased tasks (a `/thread:orient` scoped reshuffle of ADR 0030 is the natural
   route): schedule (order a queue, stop colouring), `wave-execute.workflow.js` (a queue driver,
   integration, effort escalation), `merge-wave.sh` (rebase-and-reverify instead of update-branch),
   `reconcile-wave.py` (the new cursor), status/repair, and the tests under `tests/`.
4. When the queue lands: re-plan the Chorus rollout onto it,
   `/thread:schedule --regenerate --tasks <its 53>` from `~/repos/tools/chorus`, then
   `/thread:execute`.

## 3. Decisions settled (Lachy, 2026-09-30)

- **Effort (ADR 0029):** on a capped task, the evidence that would escalate the model instead climbs
  planner and implementer effort **one rung, `high` → `xhigh`, sticky**. Judges keep the matrix;
  `max` stays a hand-set escape hatch. (Rejected: climb per failure to `max`; keep flat.)
- **Same file (ADR 0030 d1):** two tasks editing the same file **run in parallel**; they integrate
  at merge. (Rejected: function-level overlap; keep the file rule.)
- **Queue (d2):** **a rolling queue**, not waves: always the ceiling's worth running, the next
  starting the moment one merges, from the fresh `main`. (Rejected: waves of the ceiling's size.)
- **Stuck (d4):** an integration that fails is **set aside** (blocked, dependants wait), and the
  queue runs on. (Rejected: halt the rollout; retry-at-the-back.)
- Lachy's model tier holds: Opus 5.5 is the top tier, `max_tier: opus`, no Fable (AGENTS.md § Model tier).

## 4. Gotchas found the hard way

- The #30/#31 incident (a stale-base squash dropped a same-wave task's `metrics.py` changes) is why
  the file rule exists; integration must make "nothing merges from a base older than the `main` it
  lands on" true for **every** repo, CI or none, or the old hole reopens.
- `merge-wave.sh` treats "no required checks" as fine once `mergeStateStatus` goes CLEAN: on a
  no-CI repo that is exactly the unverified path. Integration's full-verifier re-run is the fix.
- The Chorus rollout's `## File-sets` (its note) is real data from three read-only agents: useful as
  a test fixture for the integrator (53 tasks, `stage.js` in ~33 of them).
- These drafts are only on disk in this checkout. Don't `git stash` or `checkout` over them.

## 5. Suggested skills

`/grill-with-docs` (the grill, writing here) → `/thread:orient [[…ADR 0030…]]` or plan files for the
build → `/fresh-review` on the build → `/thread:close`.

## 6. Paste-ready prompt

```
You're continuing "a rollout as a queue that integrates at merge, and effort escalation on a capped task" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-30-rollout-queue-and-effort-escalation.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: A Chorus orient on 2026-09-30 produced two PROPOSED, UNCOMMITTED drafts in this checkout: ADR 0029 (a capped task escalates by effort, high→xhigh, sticky) and ADR 0030 (a rollout is a rolling queue; same-file tasks run in parallel and integrate at merge: rebase onto latest main, implementer resolves, full verifier, short re-review; a stuck integration is set aside), plus CONTEXT.md's Queue/Integration entries. Lachy's four decisions are settled (doc § 3). The Chorus rollout (53 tasks, 36 waves on the old engine) is parked until the queue lands.
Also read: docs/adr/0029-a-capped-task-escalates-by-effort.md, docs/adr/0030-a-rollout-is-a-queue-that-integrates-at-merge.md, `git diff CONTEXT.md`, skills/execute/wave-execute.workflow.js (EFFORT, escalate), skills/execute/scripts/merge-wave.sh.
Suggested skills: /grill-with-docs, then /thread:orient (scoped) to phase the build, /fresh-review, /thread:close.
Next move: /grill-with-docs on ADR 0030's open edges (doc § 2.1), starting with who owns Integration.
```
