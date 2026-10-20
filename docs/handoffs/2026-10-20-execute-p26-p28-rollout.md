---
thread: thread-skill
written: 2026-10-20
status: pending
---
**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

# Handoff — execute the P26–P28 rollout

## 1. Done and verified

- **`/thread:orient Thread Skill` (2026-10-20)**, run in the primary checkout after `[[thread-skill-rollout-2026-10-19]]` closed (10/10 merged, #183–#192; P24, P25 closed). Drift empty; no declared check.
- **Reshuffle written** (vault, Obsidian Sync; no git):
  - New phase `[[thread-skill-p27-fixes-from-the-p24-p26-run]]`: p27-1 integrator reads the plan from the note, p27-2 weekly reading reads serial chains, p27-3 bind-run refuses a dir with no journal, p27-4 integration conflict state (merged with the merge-queue gloss task), p27-5 handoff ends with next (Lachy's brain dump respecced).
  - New phase `[[thread-skill-p28-the-trickle]]`: p28-1 machine-wide count, Trickle and Away; p28-2 the last starts and the night record. Unbundled from `[[thread-skill-the-trickle-and-the-last-starts]]` (now done).
  - Backlinks rewritten (only the archived 10-19 rollout note held any); no out-of-vault links.
- **Scheduled** `[[thread-skill-rollout-2026-10-20]]` (`~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-10-20.md`): 8 tasks, p26-3 → p27-1..5 → p28-1 → p28-2. Project root `~/repos/tools/thread-skill-rollout`, verifier `make test`, baseline failures none, built-in settings (4/4/3/3), standing approval 50 USD (file:defaults). `rung: opus-xhigh` on p26-3, p28-1, p28-2. `depends-on`: p28-1 → p26-3, p28-2 → p28-1. Every § 0 check passed (self-rollout → clone, origin, register `land`, pushed-base `pushed` with cited paths, unfinished `none`). `incomplete:` cleared; each task carries a **Rollout run** line pointing agents at the clone.
- Next-action slot filled: `next_task: [[thread-skill-p26-3-mark-started-arms-the-task-window]]`.

## 2. What remains

1. In the clone, run `/thread:execute [[thread-skill-rollout-2026-10-20]]` (continuous). Execute's runtime gate and § 2.7 pushed-base run at entry.
2. If the pushed-base entry check halts on this handoff's own landing commit in the primary (`queued` in a `close/…` PR), wait for that PR to merge rather than opening another.
3. At completion, the ceremony's post-rollout item points at `[[thread-skill-release-after-p24-p25]]`: fold P27 and P28 into that release's scope.

## 3. Decisions settled (2026-10-20 grill)

- **Integrate args:** drop `integration.plan`; the integrator agent reads `## Approved plan` from the task note (p27-1).
- **bind-run:** refuse at bind time a `--journal-dir` with no `wf_<run>.json` and no run subdir; the two lost Agent Stable calls stay lost (p27-3).
- **Trickle state file:** thread-skill owns it, `~/.config/thread/away.json` `{away, until, morning, trickle, written_at}`; stale = `until` past or `written_at` > 24 h; Chorus writes to that spec (noted on `[[chorus-away-state-and-the-evening-now]]`).
- **Handoff → next:** handoff's last step runs `next` for the parent session; a router-dispatched handoff skips it (p27-5).
- Session-lane work (release, version-cache install, p11-7, estate chores, GitHub email block, cross-model audit research, verifier security checks): "Not now".

## 4. Gotchas found the hard way

- **The primary checkout is held** by `chorus-rollout-2026-10-18` (ADR 0031): 62 commits behind origin, so the installed engine is the primary's pre-P24 code. The release can't install until that rollout finishes.
- **Integrate args too large** (the bug p27-1 fixes) can recur in this run before p27-1 lands: the 10-19 ruling was to pass `plan: ""` (logged in that rollout's `## Notes`). Decide from that ruling, rather than holding the lane.
- Landing PR **#182** (10-19 orient close-out) showed merge state UNKNOWN with green checks and auto-merge queued; #193 was in CI. Check both if pushed-base complains.
- P28 reads Chorus ADR 0104 by absolute path (`~/repos/tools/chorus/docs/adr/0104-…`), another repo: read only.

## 5. Suggested skills

`thread:execute`, then `thread:status` / `thread:repair` if it stalls, `thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "Thread Skill: execute the P26–P28 rollout" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-20-execute-p26-p28-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The 2026-10-20 orient reshuffle wrote P27 (fixes from the P24–P26 run) and P28 (the Trickle, Chorus ADR 0104) and scheduled [[thread-skill-rollout-2026-10-20]]: 8 tasks (p26-3, p27-1..5, p28-1, p28-2) from this clone, verifier make test, built-in settings, standing approval 50 USD, opus-xhigh on p26-3/p28-1/p28-2. All schedule § 0 checks passed. The primary checkout is held by chorus-rollout-2026-10-18, so the release waits.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-10-20.md
Suggested skills: thread:execute, thread:status, thread:repair, thread:close
Next move: /thread:execute [[thread-skill-rollout-2026-10-20]] — if an integrate call's plan is too large to pass, decide from the 10-19 ruling (plan: "") in that rollout's ## Notes rather than holding the lane.
```
