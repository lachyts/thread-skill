---
thread: thread-skill
written: 2026-10-15
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- **PR #139 merged** (`38d75ec` on origin/master): ADR 0037 and its CONTEXT.md terms. CI had failed on an unqualified "ADR 0043" (Chorus's), fixed in `0981b9e` ("Chorus ADR 0043").
- **Scheduled** `[[thread-skill-rollout-2026-10-15]]` (`~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-10-15.md`), Project root the clone `~/repos/tools/thread-skill-rollout` (§ 0's self-rollout check swapped it off the live primary). § 0 all clear: remote, landing register `land`, pushed-base `pushed`, unfinished-rollout `none`. `reconcile-rollout.py next` → start p21-1, everything else held on dependencies.
- **Queue:** p21-1 → p21-2, p21-4 → p21-6; p21-3 (also waits on p15-7) → p21-7 → p21-8. Verifier `make test`, baseline failures none, built-in settings (ceiling 4, review 4, iterations 3, plan 3; no `rollouts.toml`).
- **Stamps:** `rollout:` + `scope:` on all seven; `rung: opus-xhigh` on p21-2 and p21-7; p21-1 has `plan_approval: required`, `spend_approval_usd: 30` and a `## Decisions (asked ahead 2026-10-15)` Spend line (its routing evals). Each note carries a **Rollout run** line pointing agents at the clone.
- **Split:** p21-8 is now the plugin half only; its workspaces half is new `thread-skill-p21-9-daily-sweep-starts-the-reflection` (session lane). Phase note updated.
- **p15-7** (`~/.agents`, outside the rollout) is being landed tonight by a background child of the scheduling session. When its note reads `status: done`, the queue frees p21-3, then p21-7 and p21-8.

## 2. What remains

1. `/thread:execute [[thread-skill-rollout-2026-10-15]]`, continuous, unattended overnight. Lachy wants it all ready by morning.
2. If p15-7 never lands, p21-3/7/8 stay queued and the rollout stays unfinished: report that in the morning, do not force them.
3. At completion, the ceremony as written (the Retro line is still the old form; p21-6 changes it).

## 3. Decisions settled

- Tonight's scope: P21 plus p15-7 (Lachy, 2026-10-15). The eval rollout (p19-5/10/11, make-evals-on-opus) waits.
- p21-1's eval spend approved up to 30 USD.
- Rungs, the p21-8 split and the plan above: approved as described.

## 4. Gotchas

- The primary checkout `~/repos/tools/thread-skill` is the live plugin and `[[chorus-rollout-2026-10-15]]` runs on it: never pull, switch or update the plugin there.
- `~/.config/thread/rollouts.toml` does not exist, so the standing approval is off: only p21-1's own stamp covers its spend.
- p21-7's Verify runs a model Reflection that may file vault tasks: expected behaviour, not a stray side effect.

## 5. Suggested skills

`thread:execute`, `thread:status`, `thread:repair`.

## 6. Paste-ready prompt

```
You're continuing "Execute the P21 rollout overnight" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-15-execute-p21-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: P21 (Reflections run on their own, ADR 0037) is scheduled as [[thread-skill-rollout-2026-10-15]] on this clone: 7 tasks, p21-1 first. p21-3/7/8 wait on p15-7, which another session is landing in ~/.agents tonight. p21-1's eval spend is pre-approved to 30 USD. Lachy wants it run unattended and ready by morning.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-10-15.md, docs/adr/0037-reflections-run-on-their-own-and-tune-for-hands-off-quality.md
Suggested skills: thread:execute, thread:status
Next move: /thread:execute [[thread-skill-rollout-2026-10-15]]
```
