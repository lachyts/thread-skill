---
thread: thread-skill
written: 2026-10-17
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

## 1. Done and verified

- **4.0.0 released and installed.** PR #153 merged (`9589e20`), tag `thread--v4.0.0`; `claude plugin update thread@thread` 3.1.0 → 4.0.0; `make release-check` passes; the cache holds `skills/reflect/`. Major because the scoring verb was renamed with no alias (README § Upgrading to 4.0.0).
- **`make evals` on Opus** (PR #152, `d54df6f`): the recipe is one exact line, defaults before `$(EVAL_ARGS)`, locks (`--ablation none --model opus --judge-model opus --no-publish`) after; contract in `tests/contracts/evals-structure.test.mjs`. Full run: 23/23 at 1.00, $6.56, `docs/evals/2026-10-16-release-4-0.md` (p19-5's pre-trim baseline).
- **Orient reshuffle (2026-10-16):** P22 `[[thread-skill-p22-fixes-after-3-1]]` with p22-1..p22-7 (p22-7 added 10-17: weekly Reflection gaps). P15 closed; p15-6 dropped; `[[thread-skill-eval-rollout-p19-evals]]` done. `~/.config/thread/rollouts.toml` holds `spend_approval_usd = 50`. p19-5's irreversible gate is in its `## Approved gates`, conditional on the 4.0.0 record; its note says to run a pre-trim `--runs 3` in its worktree first.
- **First weekly Reflection** run by hand: `r-20261016T232153Z-7d4d21`, 10 rollouts, Hands-off 1.0 throughout, 3 Watches, 2 knobs held, no bug or decision task, ~258k tokens / 14 min. Next due 2026-10-24. Lachy kept the bound (Opus xhigh, no cap, 4h kill) and declined chorus `max_plan_rounds` 3 → 4 for now.
- **Session-lane batches** (run `~/repos/workspaces/_shared/.scratch/orient/ai/runs/2026-10-16-ts-session-lane`, complete): workspaces PR #5 (p21-5 `fixes:` key, p21-9 sweep starts the Reflection); PRs #95, #142 closed. Workspaces local master merged with origin and pushed (`0068b8e`).
- Slot: `next_task` → `[[thread-skill-p22-1-lead-integrate-c17-load-tolerant]]`.

## 2. What remains

1. `/thread:orient Thread Skill --steer`: schedule one rollout with `--tasks` p22-1..p22-7 plus p19-10, p19-11, p19-5 (the execution-fit test puts all ten in the rollout lane). Project root is the clone `~/repos/tools/thread-skill-rollout` (schedule § 0's self-rollout check resolves it). Order: p22-1 (C17 flake) early; p22-6 (ADR sweep) can run any time now 4.0.0 is out; p19-5 after p19-10/p19-11.
2. Then the execute offer (orient § 9).
3. Close out THREAD.md: its Where we are / Resume still describe 10-16 (3.2.0, old slugs) and need this session's facts.

## 3. Decisions settled

Release first (done); 4.0.0 not 3.2.0; $50 standing approval; p19-5 signed ahead on condition; p15-6 dropped; p11-7 stays session lane; Reflection bound unchanged; max_plan_rounds stays 3; skill gaps → p22-7.

## 4. Gotchas found the hard way

- `tests/contracts/reflect.test.mjs` pins the manifest's reflect sentence and bans the retired verb string anywhere in product files (README included).
- `make release-check` needs the installed cache, so it runs after `claude plugin update`, not before the release PR merges.
- The review ledger counts the release PR's rounds as part of #152's chain: run it with `--chain <head> --baseline <head>` for a new chain.
- Consumed `docs/reviews/` docs must leave the tree before a release merges, or they land in the version cache.

## 5. Suggested skills

`thread:orient` (with `--steer`), then `thread:schedule` and `thread:execute` through it; `thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "Thread Skill: schedule the P22 rollout on 4.0.0" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-17-schedule-p22-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: thread 4.0.0 is released and installed (PR #153, tag thread--v4.0.0); make evals runs on Opus (PR #152, 23/23 at 1.00). The 2026-10-16 orient reshuffle wrote P22 (p22-1..p22-7) and signed p19-5's gate ahead; spend_approval_usd = 50 is set. Nothing is scheduled and no rollout runs on this repo.
Also read: ~/repos/obsidian/Work/Phases/thread-skill-p22-fixes-after-3-1.md, ~/repos/obsidian/Work/Tasks/thread-skill-p19-5-trim-descriptions-700-hard-cap.md
Suggested skills: thread:orient (--steer), thread:close
Gates: PR #88 (merge trimmed or close), the 5c5a Codex worktree's .thread/ evidence (keep or drop), and the thread-rollout-redesign worktree (uncommitted work, 11 unpushed commits) return to Lachy via grill-me — report them, do not resolve them downstream
Next move: run /thread:orient Thread Skill --steer and schedule p22-1..p22-7 plus p19-10, p19-11, p19-5 as one rollout from the clone.
```
