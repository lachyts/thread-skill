---
thread: thread-skill
written: 2026-11-05
status: pending
launches: thread-skill-rollout-2026-11-05
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- `/thread:orient Thread Skill` reshuffled the loose backlog on 2026-11-05. It added P36's four leftovers (p36-9 to p36-12) and wrote the new phases P37 (*a rollout never waits on a glitch*, `Work/Phases/thread-skill-p37-a-rollout-never-waits-on-a-glitch.md`) and P38 (*close keeps the project note a dashboard*).
- `/thread:schedule` wrote `~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-05.md`:
  - 11 tasks (p37-1 to p37-7, p36-9, p36-10, p38-1, p38-2), all graded Ready by the Pre-flight with nothing left out;
  - Engine snapshot `5a83725f60f5` (`~/repos/tools/thread-skill-snapshots/5a83725f60f5`);
  - Project root `~/repos/tools/thread-skill-rollout`, fast-forwarded to `5a83725`;
  - verifier `make test`, which covers the merge gate (both required checks run `make test`);
  - the built-in settings 4/4/3/3 and a standing approval of US$200;
  - `incomplete:` cleared, and every task stamped `rollout:` and `scope:`.

## 2. What remains

Run `/thread:execute [[thread-skill-rollout-2026-11-05]]` from the Project root, continuous, to the completion ceremony.

## 3. Decisions settled

- The grade's Decided-for-you calls are in each task's `## Decided for you (2026-11-05)` section: p36-10, p37-2, p37-3, p37-7, p38-1 and p36-12. Don't re-ask them.
- p37-4 carries `plan_approval: required` and a recorded spend Planner line. Its US$ amounts describe the rule it fixes and buy nothing, so the standing approval signs any gate it declares.

## 4. Gotchas found the hard way

- Same-file pairs were kept apart on purpose, so Integration serialises their merges: p37-1 and p37-2 (`merge-task.sh`), p38-1 and p38-2 (`skills/close/SKILL.md`).
- p37-3's work is already built on `origin/fix/unparseable-note-named` (`99d5fee`). It is 8 commits behind master, with one conflict in `tests/estate-dispatch.test.mjs`. A Chorus Stage worktree, `.claude/worktrees/stage.review-and-land-the-unparseable-note-fix`, may be sitting on it idle; check before dispatch.
- ntfy is not set up (Lachy said "Not now"), so needs-you alerts reach nobody this run. Push them through the Stage instead.
- This Mac's gh is 2.43.1, with no `--json` on `pr checks`, until p37-2 lands.

## 5. Suggested skills

`thread:execute`; then `thread:status` and `thread:repair` if anything stalls.

## 6. Paste-ready prompt

```
You're continuing "Thread Skill P37 rollout launch" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-05-launch-p37-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: orient reshuffled Thread Skill into P37 (a rollout never waits on a glitch) and P38, plus P36 leftovers; schedule wrote [[thread-skill-rollout-2026-11-05]], 11 Ready tasks, snapshot 5a83725f60f5, verifier make test. ntfy is not set up, so alerts reach nobody but the Stage.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-11-05.md
Suggested skills: thread:execute, thread:status, thread:repair
Next move: /thread:execute [[thread-skill-rollout-2026-11-05]]
```
