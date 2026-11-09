---
thread: thread-skill
written: 2026-11-07
status: consumed
launches: thread-skill-rollout-2026-11-07
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- `/thread:orient Thread Skill` (2026-11-07) reshuffled the project and Lachy approved it ("Write it"):
  - P41 gained p41-7 (`leg.py wait` holds and reports real minutes).
  - p41-1's ADR was renumbered 0071 → 0075, and its file was renamed `thread-skill-p41-1-adr-0075-…`.
  - New P43 ([[thread-skill-p43-a-merge-verifies-the-fast-tier]]) turns ADR 0073 into p43-1 to p43-6.
- `/thread:schedule` wrote [[thread-skill-rollout-2026-11-07]]:
  - 17 tasks, all graded Ready, nothing asked.
  - Engine snapshot `b24768376de3`, verifier `make test`, merge gate covered by the verifier.
  - Every task is stamped `rollout:` and `scope:`, and `incomplete:` has been cleared.

## 2. What remains

Run `/thread:execute [[thread-skill-rollout-2026-11-07]]` from the Project root above, continuous. The ADR tasks rank first (p41-1, p42-1, p43-1). p43-1 cherry-picks the grilled commit `260b680`, which is in this clone's object store (branch `docs/fast-tier-at-merge`).

## 3. Decisions settled

- P41 and P42 were grilled with Lachy earlier on 2026-11-07 (their phase notes quote his words). ADR 0073 was grilled the same morning.
- ADR numbers: 0073 is the Fast tier (p43-1), 0074 is P42 and 0075 is P41.
- This rollout keeps `make test` at every merge. The Fast tier applies only from the next rollout, after p43-2 lands.

## 4. Gotchas found the hard way

- Another session is fixing `merge-task.sh`, which p43-4 and p43-5 also touch ([[thread-skill-merge-task-empty-required-checks-reads-as-some]]). Integration merges whichever lands second.
- PR #312 (ADR 0070) is still open with auto-merge queued. Nothing in this rollout depends on it.

## 5. Suggested skills

`thread:execute`, then `thread:status` / `thread:repair` if it stalls.

## 6. Paste-ready prompt

```
You're continuing "Run thread-skill-rollout-2026-11-07" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-07-thread-skill-rollout-2026-11-07.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: orient reshuffled Thread Skill into P41 (rollouts wait, never notify), P42 (one chain per project, sign-ins at schedule) and new P43 (ADR 0073, Fast tier at merge); schedule wrote a 17-task parallel rollout, all Ready, snapshot b24768376de3, verifier make test.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-07.md
Suggested skills: thread:execute
Next move: /thread:execute [[thread-skill-rollout-2026-11-07]]
```
