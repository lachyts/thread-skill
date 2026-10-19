---
thread: thread-skill
written: 2026-10-19
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- `/thread:orient Thread Skill` audited the project and reshuffled today's grill output (ADR 0040 serial rollouts, ADR 0041 orient-all) into P24, P25 and a new P26, then grilled P24's three open build questions plus the canary collision.
- PR #178 (ADR 0040, 0041, 0042 + CONTEXT.md) merged, `90034b0`. It was red at first because `tests/contracts/queue-only.test.mjs` still pinned **Rollout-shaped**; fixed in `4379185`.
- Two `/fresh-review` xhigh rounds ran on #178: docs `docs/reviews/2026-10-19-4379185-ce3be9.md` and `docs/reviews/2026-10-19-9c41535-6fb897.md`, both consumed. Round 2 was 14/15 regressions, so the ledger said STOP. PR #180 (branch `docs/adr-0040-0042-review-round-2`, auto-merge queued) cuts ADR 0040's rulings and ADR 0042 back to decisions. Contracts: 898 pass.
- Rollout note `[[thread-skill-rollout-2026-10-19]]` is written and stamped. It holds 10 tasks with Project root `~/repos/tools/thread-skill-rollout`, verifier `make test`, ceiling 4 (built-in) and standing approval US$50 (`file:defaults`). p24-1 is `solo: true`; `rung: opus-xhigh` is on p24-3, p25-2, p25-3 and p26-2. `reconcile-rollout.py next`: start p24-1, the other 9 held, `0/10 merged`.
- Thread Skill's `next_task` slot is filled with p24-1. P26 phase note: `Work/Phases/thread-skill-p26-rollouts-never-share-a-checkout.md`. Renames: canary-arms → p26-1, in-place-master → p26-2, release-4-1-0 → `thread-skill-release-after-p24-p25`.

## 2. What remains

1. Confirm PR #180 has merged (`gh pr view 180 --repo lachyts/thread-skill --json state`). If it is still open, wait for it; auto-merge is queued. If it is BEHIND, update the branch (`gh api -X PUT repos/lachyts/thread-skill/pulls/180/update-branch`). p24-1's worktree branches from `origin/master` and should see the decision-level ADR 0040.
2. Run `/thread:execute [[thread-skill-rollout-2026-10-19]]` from this clone.
3. At completion the ceremony scores the run. The release is already a task (`[[thread-skill-release-after-p24-p25]]`).

## 3. Decisions settled (Lachy, 2026-10-19; see ADR 0040 § Build-grill rulings and ADR 0042)

- **Leg smoke test:** the preflight plus the predecessor Leg's Verifies. A failure files a `fixes:` task and never reopens a done task.
- **Leg review:** each code-writing task gets `/fresh-review` xhigh before it is done.
- **Serial limits:** serial rollouts are limited by surfaces, not repo, and there are no serial self-rollouts.
- **Clones:** every parallel rollout scheduled after P26 runs from `<toplevel>-rollout`.
- **Release:** no standalone 4.1.0. One release follows P24–P26, and they run on the 4.0.0 engine.
- **The review questions** on p24-2, p24-3 and p26-2 (`## Open review questions`) are for their plans to settle against code. They are not Lachy gates.

## 4. Gotchas found the hard way

- The primary checkout `~/repos/tools/thread-skill` is the live plugin (4.0.0) and is 40 commits behind origin. It is held by ADR 0031 while `chorus-rollout-2026-10-18` runs, so never commit or fast-forward there.
- `gh pr update-branch` doesn't exist in this gh; use the REST `update-branch` endpoint.
- `make test` takes more than 10 minutes under today's machine load, so a background `make test` hits the tool's time limit. Contracts alone: `node --test tests/contracts/*.test.mjs`.

## 5. Suggested skills

`thread:execute`, then `thread:status` / `thread:repair` if it stalls, `thread:reflect` at completion.

## 6. Paste-ready prompt

```
You're continuing "Thread Skill: execute the P24–P26 rollout" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill-rollout/docs/handoffs/2026-10-19-execute-p24-p26-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: orient reshuffled today's grill (ADR 0040 serial rollouts, 0041 orient-all, 0042 every rollout from its clone) into P24–P26 and wrote [[thread-skill-rollout-2026-10-19]] (10 tasks, p24-1 Solo first, Project root this clone, make test, ceiling 4). PR #178 merged; PR #180 (ADRs back to decision level after a review-ledger STOP) has auto-merge queued.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-10-19.md, docs/adr/0040-a-rollout-is-parallel-or-serial.md, docs/adr/0042-a-parallel-rollout-always-runs-from-its-clone.md
Suggested skills: thread:execute, thread:status, thread:repair, thread:reflect
Next move: confirm PR #180 merged (wait if open), then /thread:execute [[thread-skill-rollout-2026-10-19]].
```
