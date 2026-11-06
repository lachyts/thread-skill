---
thread: thread-skill
written: 2026-11-06
status: pending
launches: thread-skill-rollout-2026-11-06
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

# Execute [[thread-skill-rollout-2026-11-06]]

## 1. Done and verified

- `/thread:orient Thread Skill` (2026-11-06) reshuffled the loose follow-ups into phase P39 (`Work/Phases/thread-skill-p39-a-rollouts-loose-ends-close.md`, a rollout's loose ends close) and phase P40 (`Work/Phases/thread-skill-p40-the-next-move-starts-by-itself.md`). Lachy approved the gate ("Write it").
- `/thread:schedule` wrote `~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-06.md`: 13 tasks (p39-1, p39-3 to p39-12, p40-1, p40-2), all graded Ready, on Engine snapshot `3e9f86cfeb70` (origin/master 3e9f86c). The tasks are stamped, `incomplete:` is cleared, and `verify-timeout` read the note clean.
- Verifier `make test`. It covers the merge gate (`make test (ubuntu-latest)`, `make test (macos-latest)`). Settings are the built-ins (ceiling 4, review 4, iterations 3, plan 3). Standing approval is 200 USD (file:defaults). Baseline none.

## 2. What remains

Run `/thread:execute [[thread-skill-rollout-2026-11-06]]` from the Project root above, continuous, to the end, then its completion ceremony. Post-rollout items are in the note.

## 3. Decisions settled

- Pre-flight calls are written into each task's `## Decided for you (2026-11-06)`: p39-9 honours `security_checks` in the Leg; p39-11 adds the guard here and files a fresh-review follow-up; p39-12 refreshes the stamp on a repeat signal and also matches the bare wording; p40-1 creates a missing clone without asking and gets its own ADR.
- Left out on purpose: p39-13, whose over-budget rule Lachy is grilling in the orient session; p39-2, already landed by #281 and closed; p11-7, session lane.

## 4. Gotchas found the hard way

- The gated-input sweep hits on p39-3, p39-8 and p40-1 are the engine's subject matter (credential, secret and gate words), not gates any task pays for.
- p39-4 and p39-5 both touch the live-checkout guard, and p39-5 and p40-2 both touch `skills/close/SKILL.md`. Integration serialises them; they were not folded.

## 5. Suggested skills

`thread:execute`, then `thread:close` at the ceremony.

## 6. Paste-ready prompt

```
You're continuing "Execute the P39/P40 Thread Skill rollout" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-06-execute-p39-p40-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: orient reshuffled Thread Skill into P39 (a rollout's loose ends close) and P40 (the next move starts by itself); schedule wrote thread-skill-rollout-2026-11-06, 13 Ready tasks on snapshot 3e9f86cfeb70, verifier make test. p39-13 is held out for Lachy's grill; p39-2 already landed.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-06.md
Suggested skills: thread:execute, thread:close
Next move: /thread:execute [[thread-skill-rollout-2026-11-06]]
```
