---
thread: thread-skill
written: 2026-10-03
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- **The reshuffle** (`/thread:orient Thread Skill`, 2026-10-03, Lachy's calls) respecced P13 and filed P14 ([[thread-skill-p14-the-queue-hardened]], build sequence 1-8). p13-1 is the loader only; P13 goes live (p13-4's release and checkout update) only after the Chorus run ends; the `--admin` opt-in is dropped; the git-env canary (p14-6) is a lead-side check.
- **p14-1, the CI flake: PR #73 merged (`5a1a35f`).** pushed-base decides "landed" by touched-file content alone (no `git cherry`, no patch identity); land.test.sh's `land()` applies the hang budget itself. Verify met: 20/20 Ubuntu `make test` jobs at `9de70c8`. Vault note `status: done`.
- **p14-7, the primary checkout holds: PR #72 merged (`0b60690`).** ADR 0031: `land.sh` S4/S11 never move the plugin's primary checkout (`~/repos/tools/thread-skill`) while a running rollout exists (`unfinished-rollout.py running`, `primary-hold.sh`). `make test` green locally and in CI.
- **The cut-over is done.** Chorus soft-paused at 16:10, `~/repos/tools/thread-skill` fast-forwarded `04d1739` → `0b60690`, Chorus reinstated by Lachy. Checked live: `unfinished-rollout.py running` → `running chorus-rollout-2026-10-03`; `primary-hold.sh ~/repos/tools/thread-skill` → `[[chorus-rollout-2026-10-03]] running on it`; this clone is not held.

## 2. What remains

1. **Refresh this clone:** `git -C /Users/lachlants/repos/tools/thread-skill-rollout status -sb` must be a clean `master`; fast-forward it to `origin/master` (≥ `0b60690`). The untracked `.claude/` is the old worktrees dir: leave it.
2. **Steer-only `/thread:orient Thread Skill`** in this session. The reshuffle is already done: no re-litigating, just schedule. It schedules, as one queue rollout from this clone: p13-1, p13-2, p13-3 and p14-2, p14-3, p14-4, p14-5, p14-6, p14-8 (open, rollout-shaped). Not p13-4 (session lane, after Chorus ends), not p14-1/p14-7 (done/landed).
   - p13-1 and p13-2 start at `effort: xhigh`, `max_plan_rounds: 6` (stamped on their notes). The model tier is locked to Opus (global AGENTS.md): no `model: fable`, `max_tier: opus`.
   - The interim rule and Lead actions carry over from P12 (each task note states them).
3. **Execute it** (`/thread:execute [[thread-skill-rollout-…]]`) in this session, on Lachy's go.
4. **p14-7's last Verify line**: a landing from the primary checkout prints `land: held the primary checkout` while Chorus runs. The first close or handoff run *from* `~/repos/tools/thread-skill` will show it; record it on [[thread-skill-p14-7-primary-checkout-holds]] and mark that note done.
5. **This thread's close-out** (from this clone or a worktree, never the primary while Chorus runs, ADR 0031 Consequences): delete the six consumed review docs in `docs/reviews/` (`2026-10-03-{e459b4a-43acfa,f55e764-2fdaf3,7c39aac-129f3b,4aaec18-38d563,2f8a9c9-c39dc3,81ddb02-e6620f}.md`), and commit `~/repos/tools/thread-skill/THREAD.md`'s pending edits by carrying them here (it is uncommitted in the primary checkout; don't commit there while held).

## 3. Decisions settled

- Chorus is the first queue run ([[thread-skill-p12-13-chorus-first-queue-run]]); both rollouts run at once on the engine at `0b60690`. The primary checkout does not move again until Chorus ends (the hold enforces it for landings; never pull, switch branches or update the plugin there by hand).
- P13 merges land on `origin` during the Chorus run; p13-4 (3.0.0, and updating the live checkout) waits for Chorus to finish.
- Review chains follow the ledger: both PRs stopped at their STOP and went to their Verify lists.

## 4. Gotchas found the hard way

- **The session cwd is the primary checkout when launched there**: a `/fresh-review` from such a session reviews a worktree only via an explicit pinned range, and `/simplify`'s angles report to the root session, not the wrapper ([[fresh-review-simplify-angles-report-to-root]]).
- **Chorus can let an idle CLI go** after a Host restart, killing its crons and Monitors ([[chorus-the-at-rest-let-go-spares-crons-and-monitors]]). The Chorus lead's heartbeat does fire when idle (14:16, 14:27): check `CronList` in the Chorus lead after any Host restart.
- `gh pr edit` fails on gh 2.43 (Projects-classic GraphQL); use `gh api -X PATCH repos/lachyts/thread-skill/pulls/<n>`.

## 5. Suggested skills

`/thread:orient` (Steer only), `/thread:schedule` (via orient), `/thread:execute`, `/thread:status`, `/thread:close`.

## 6. Paste-ready prompt

```
You're continuing "Thread Skill: schedule the P13/P14 queue rollout" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill-rollout/docs/handoffs/2026-10-03-schedule-p13-p14-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The orient reshuffle is done and both session-lane fixes merged (PR #73 CI flake, PR #72 primary-checkout hold, ADR 0031). The Chorus rollout is running on the primary checkout ~/repos/tools/thread-skill at 0b60690, which is held: never pull, switch or close there. This clone runs Thread Skill's own rollout.
Also read: ~/repos/obsidian/Work/Phases/thread-skill-p13-the-ladder.md, ~/repos/obsidian/Work/Phases/thread-skill-p14-the-queue-hardened.md
Suggested skills: /thread:orient (Steer only), /thread:execute, /thread:status
Next move: fast-forward this clone to origin/master, then run a Steer-only /thread:orient Thread Skill to schedule p13-1..3 + p14-2..6, p14-8 as one queue rollout.
```
