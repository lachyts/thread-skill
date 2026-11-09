---
thread: thread-skill
written: 2026-11-08
status: consumed
launches: thread-skill-rollout-2026-11-08
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- [[thread-skill-rollout-2026-11-07]] landed its three ADR tasks:
  - p43-1, ADR 0073: PR #333, merged as ccb26d9.
  - p41-1, ADR 0075: PR #336, merged as a86801a.
  - p42-1, ADR 0074: PR #334, merged as 2a7cf5c.
- It was then soft-paused on 2026-11-08 (`paused: 2026-11-08T17:01+11:00`), so that Phase 44 could join. Phase 44 is ADR 0076, the Waiting list, PR #338, merged as 0cea9ee.
- `/thread:schedule --regenerate` wrote [[thread-skill-rollout-2026-11-08]] and closed the old note out. The old note is archived in `Work/Tasks/Archive/Rollouts/` with `superseded_by:`, and it was scored as `t-20261108T061504Z-36116e`.
- The new note:
  - 18 tasks: the 14 unlanded P41–P43 tasks carried as `queued`, plus p44-1 to p44-4.
  - The Pre-flight graded all 18 Ready and asked nothing.
  - Engine snapshot `2a7cf5cf9243`, verifier `make test`, which covers both required checks.
  - Every task is stamped with `rollout:`, and `incomplete:` is cleared.
- A dry-run `next` starts p41-2, p41-5, p41-7 and p42-2 at once (`parallel_ceiling` 4).

## 2. What remains

Run `/thread:execute [[thread-skill-rollout-2026-11-08]]` from the Project root above, continuous.

- p44-4 also depends on [[chorus-p100-8-the-stage-starts-chains-from-the-waiting-list]], a Chorus task outside this queue. It waits on that task; this is expected, not a block.
- p44-5 is serial-shaped and was left out of this note. Schedule it once p44-4 lands: `/thread:schedule --tasks thread-skill-p44-5-move-todays-chains-onto-the-list`. It is listed in the note's Post-rollout items.

## 3. Decisions settled

- P41-3 and P41-4 carry their `## Amended 2026-11-08` sections for ADR 0076: begin-wait and its marker are dropped. Build them as amended.
- The Pre-flight wrote four technical calls into the task notes' `## Decided for you`:
  - p44-1 lands after p41-2. This is stamped as `depends-on:`.
  - p41-7 has nothing left to fit to p41-3.
  - p42-3 follows ADR 0074 d3 as it landed, not the note's older `works` wording.
  - p42-4's dependants of a left-out row leave with it.
- This rollout keeps `make test` at every merge. The Fast tier applies only from the next rollout, after p43-2 lands.

## 4. Gotchas found the hard way

- On 2026-11-08 the ubuntu runner's newer GNU diff broke `tests/release-check.test.sh` cases (c)/(c2). PR #335 fixed it on master (e5011ea). A red `make test (ubuntu-latest)` on a PR older than that is fixed by Integration merging master in, not by the task's code.
- On 2026-11-08 two opus-xhigh agents failed with "Claude Code can't use your Claude subscription, usually because a payment is past due". The next calls ran normally. If it recurs, the claude.ai billing page needs looking at, and the automatic-retry budget keeps the failures bounded.
- The in-place checkout `~/repos/tools/thread-skill` has 3 local-only close-out commits, queued in `close/2026-11-08-thread-skill-db21fcdd5d74`. Merge-task's in-place refresh reports it `not moved` until that PR merges. Pushed-base calls it not a blocker.
- Master moves under PRs often (other sessions land on this repo). Merge-task's exit 3 (base moved) re-integrates, and exit 8 (a GitHub connection reset) backs off: both recovered cleanly here.

## 5. Suggested skills

`thread:execute`, then `thread:status` or `thread:repair` if it stalls.

## 6. Paste-ready prompt

```
You're continuing "Run thread-skill-rollout-2026-11-08" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-08-thread-skill-rollout-2026-11-08.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: schedule --regenerate superseded thread-skill-rollout-2026-11-07 (which landed ADRs 0073/0074/0075) with an 18-task parallel rollout: the 14 unlanded P41–P43 tasks plus P44-1..4 (ADR 0076, the Waiting list). All graded Ready, snapshot 2a7cf5cf9243, verifier make test. p44-4 also waits on a Chorus task outside the queue (expected); p44-5 is a serial follow-up, not in this note.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-08.md
Suggested skills: thread:execute
Next move: /thread:execute [[thread-skill-rollout-2026-11-08]]
```
