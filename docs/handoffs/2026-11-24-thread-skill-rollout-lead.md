---
thread: thread-skill
written: 2026-11-24
status: pending
launches: thread-skill-rollout-2026-11-24
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

# Lead [[thread-skill-rollout-2026-11-24]] (45 tasks)

This doc briefs the lead of a parallel rollout. It is a Rollout launch, never a fork of the orient session that wrote it.

## 1. Done and verified

- `/thread:orient Thread Skill` (24 Nov 2026) reshuffled the project and scheduled `thread-skill-rollout-2026-11-24`: 45 tasks, `protocol_version: 5`, Engine snapshot `6012a0492ce3` (the Green tip, 0 behind origin/master), verifier `THREAD_SKIP_SLOW=1 make test-fast`, completion verifier `make test`, `parallel_ceiling` 4. The note is in `~/repos/obsidian/Work/Tasks/`, never started, with no `incomplete:` stamp.
- Schedule's checks passed: the rollout clone was fast-forwarded to `6012a04`, pushed-base read `pushed` with all 47 cited paths, the unfinished-rollout check read `none`, the Branch check read `none`, the Repo check found nothing, and the merge gate (`make test (ubuntu-latest)`) runs the same fast tier as the verifier.
- The Pre-flight graded all 45 (43 Ready, 2 One call answered and recorded, none left out).
- Operator files changed the same morning, on Lachy's rulings: `~/.config/thread/rollouts.toml` gained `schema = 5` and `test_logins = ["dummy"]`; `~/.config/thread/ladder.toml` now exists (Fable plans on both Opus rungs, a third all-Fable rung, `[share]` 0.5 for master-review, builder, investigator and lead). `ladder.py` reads it from snapshot `6012a0492ce3`.

## 2. What remains

Run `/thread:execute [[thread-skill-rollout-2026-11-24]]` from the Project root and lead the queue to its completion ceremony. Nothing else.

## 3. Decisions settled

- Phase 55 (the lead hand-over) and Phase 56 (sign-offs asked ahead) are `priority: high` and start first. p55-1 writes ADR 0085; p55-2 to p55-4 depend on it, p55-5 on p55-3 and p55-4; p56-2 and p56-3 depend on p56-1.
- Every decision of Lachy's is in the task notes: his rulings are quoted, and the technical calls are under each note's `## Decided for you` or "Decided for him". Do not re-open them.
- Two tasks carry `plan_approval: required` with a recorded Planner line (p56-6, p56-7: their notes name currency amounts). Their work spends nothing.

## 4. Gotchas found the hard way

- **The baseline is `none`, but one file went red once.** Schedule's baseline run on clean master ended `FAILED (1185s)` on `tests/live-checkout.test.sh` (LC8, bash 3.2.57). The file passes when run alone on the same commit, so it is a flake inside a full run: [[thread-skill-flake-live-checkout-lc8-red-in-a-full-fast-tier-run]]. If an Integration verify goes red on LC8 alone, it is that flake, never the task's diff.
- **This is the first rollout with the ladder file.** If a call halts `ladder file refused`, the file is `~/.config/thread/ladder.toml`; `python3 <engine root>/skills/_shared/scripts/ladder.py` names the line. Deleting the file restores the built-in two-rung ladder.
- **You are the kind of lead Phase 55 is about.** Until it lands, nothing counts your compactions. After any compaction, re-enter `/thread:execute` at § 1 from the engine root before your next launch (execute § 1.5 says so), and build no launch from a summary.
- `chorus-rollout-2026-11-24` runs on the same Mac and the same snapshot; the Trickle and the Capacity share the machine between you.

## 5. Suggested skills

`thread:execute` (then `thread:status` and `thread:repair` only if it stalls).

## 6. Paste-ready prompt

```
You're continuing "Lead the Thread Skill rollout of 24 Nov" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-24-thread-skill-rollout-lead.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: /thread:orient Thread Skill scheduled thread-skill-rollout-2026-11-24 this morning: 45 tasks, never started, Engine snapshot 6012a0492ce3, verifier THREAD_SKIP_SLOW=1 make test-fast, baseline none. Every schedule check passed and every decision of Lachy's is recorded in the task notes. It is the first rollout to run with the Fable ladder file.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-24.md
Suggested skills: thread:execute
Next move: /thread:execute [[thread-skill-rollout-2026-11-24]]
```
