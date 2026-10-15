---
thread: thread-skill
written: 2026-10-15
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

## 1. Done and verified

- **Grill finished, decisions recorded.** ADR 0037 (`docs/adr/0037-reflections-run-on-their-own-and-tune-for-hands-off-quality.md`), plus the `CONTEXT.md` § Run record and tuning terms: Hands-off rate, Quality, Escape, Review churn, Reflection, Tuning (knob/rule/bug), Watch, Quiet Reflection. Throughput is now a Guardrail. Commit `b744fdf` on `docs/reflections-run-on-their-own`, **PR #139** (https://github.com/lachyts/thread-skill/pull/139), with auto-merge queued. It was BLOCKED on CI after a branch update when this doc was written.
- **Vault, written at the reshuffle gate Lachy approved:**
  - Phase `Work/Phases/thread-skill-p21-reflections-run-on-their-own.md`, with tasks `thread-skill-p21-1` to `thread-skill-p21-8` (each carries its depends-on).
  - `thread-skill-p19-12-eval-retro-routing-case` → `status: dropped`, merged into p21-1.
  - `thread-skill-p15-7-review-ledger-emits-review-rounds` → priority normal, because p21-3 depends on it.
  - `thread-skill-eval-rollout-p19-evals` now lists three members: p19-12 is gone.
- **Chorus side:** `Work/Tasks/chorus-reflect-cadence.md` (Chorus project, `cc-chorus`) is a grill on when Chorus's `/reflect` runs on its own. It points at ADR 0037's shape.

## 2. What remains

1. **Check PR #139** (`gh pr view 139`). If it merged, go on to step 2. If it is still open, read its checks. Fix a red check on its branch, or, if CI is just pending, stop and report. Do not poll. P21 cannot be scheduled before #139 lands, because rollout worktrees branch from `origin`.
2. **Schedule.** Run `/thread:orient Thread Skill --steer`. Its § 6 routes the rollout-shaped P21 tasks on this repo (p21-1 to p21-4, p21-6, p21-7, and p21-8's plugin half) to `/thread:schedule --regenerate --tasks <members>`. p15-7 lives in `~/.agents` (another repo), so p21-3 waits on it. p21-5 and p21-8's sweep half are in the workspaces repo, which is session lane.
3. **Execute overnight.** The execute offer: Lachy wants rollouts set going unattended and ready by morning.

## 3. Decisions settled (don't re-litigate)

All of ADR 0037:
- **Headlines:** two, Hands-off rate and Quality (Escapes). Throughput and Review churn are Guardrails.
- **Naming:** Retro → Reflection and `/thread:reflect`, with the old name deleted (no alias stub).
- **Running:** every rollout is scored by script at completion. A model Reflection runs weekly, on Opus xhigh with no token cap.
- **What lands unasked:** bugs and three-times-agreed knobs. Rules never do.
- **Cadence:** a quiet streak of three moves the reading to fortnightly.
- **Escapes:** traced by a `fixes:` key.

The gate approved P21 as one phase with eight tasks.

## 4. Gotchas found the hard way

- **Two rollouts want this repo:**
  - P21.
  - The pending eval rollout (`thread-skill-eval-rollout-p19-evals`: p19-5, p19-10, p19-11). It needs the slot task `thread-skill-make-evals-on-opus` landed first, and p19-5's irreversible gate needs Lachy's sign-off.

  Only one unfinished rollout per repo is allowed (schedule § 0). Which tasks go into tonight's rollout is Lachy's call (see Gates).
- **This repo's primary checkout is `master`.** Branch before any commit.
- **`reviews.jsonl` does not exist yet.** p15-7 has not landed, so Review churn reads as unknown until p15-7 and p21-3 are built.

## 5. Suggested skills

`thread:orient` (`--steer`), `thread:schedule`, `thread:execute`, `thread:status`.

## 6. Paste-ready prompt

```
You're continuing "Schedule P21: Reflections run on their own" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-15-schedule-p21-reflections.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The 2026-10-15 orient grill decided ADR 0037: the Retro becomes an automatic Reflection tuned for hands-off quality. ADR + CONTEXT.md are in PR #139 (auto-merge queued). P21 (8 tasks, thread-skill-p21-1..8) is written in the vault. Schedule it once #139 lands, and run it unattended overnight.
Also read: docs/adr/0037-reflections-run-on-their-own-and-tune-for-hands-off-quality.md, ~/repos/obsidian/Work/Phases/thread-skill-p21-reflections-run-on-their-own.md
Suggested skills: thread:orient --steer, thread:schedule, thread:execute
Gates: tonight's rollout scope (P21 alone, or P21 plus the pending eval rollout's p19-5/10/11, which needs make-evals-on-opus landed first and p19-5's irreversible sign-off) returns to Lachy via grill-me. Report the choice and its evidence, do not resolve it downstream.
Next move: gh pr view 139. If merged, run /thread:orient Thread Skill --steer. If not, decide from its checks: fix a red check, or report pending and stop.
```
