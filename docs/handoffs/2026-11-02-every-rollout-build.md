---
thread: every-rollout-at-once
written: 2026-11-02
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-wt-every-rollout`

# Every project's rollout runs at once: land the spike, plan the build

## 1. Done and verified

- **The spike is done, and it is uncommitted in this worktree** (branch `spike/every-rollout-at-once`, cut from origin/master `29d2f2f`). It holds:
  - `docs/spikes/2026-11-02-every-rollout-at-once.md`, the report with evidence and sources;
  - `docs/adr/0065-every-projects-rollout-runs-at-once.md`, proposed;
  - CONTEXT.md: **Rollout**, **Serial rollout** and **Surface** amended, and **Chain copy**, **Note wait** and **Capacity** added;
  - one-line "to be superseded/amended" pointers in ADR 0040 and ADR 0059;
  - `.scratch/replan.py`, untracked: the re-plan the report's § 0 cites.
- **The headline finding.** The 2026-11-02 orient-all pass ran on a stale primary checkout, 95 commits behind and without ADR 0059. Re-planned on origin's rules, every vault chain comes apart, and 19 of 33 chains still clash, all through checkout-wide claims: `~/repos/workspaces` (15 chains), `~/.agents` (5) and `~/Projects` (4).
- **The Primary refresh (ADR 0066) is built.** It keeps the primary checkout current.
  - [PR #272](https://github.com/lachyts/thread-skill/pull/272) is queued with auto-merge. CI was pending at hand-off.
  - The launchd job `com.thread.primary-refresh` is installed and running: a copy at `~/.local/state/thread/bin/`, logging to `~/Library/Logs/thread-primary-refresh.log`. Its first pass logged `held` by five rollouts.
  - Review left open findings, filed in `[[thread-skill-primary-refresh-review-follow-ups]]`.

## 2. What remains

1. **Bring the branch current and land the spike docs.**
   - Merge `origin/master` into `spike/every-rollout-at-once` once #272 has merged. ADR 0065's Consequences cite ADR 0066, and `tests/contracts/refs.test.mjs` fails until 0066 is on the branch.
   - Decide where `.scratch/replan.py` goes. It is the evidence the report's § 0 cites, so either move it to `docs/spikes/2026-11-02-replan.py` and fix the citation, or inline its method.
   - Commit by pathspec (📝 docs), run `make test`, then land the branch as close § Land the own branch does: `land.sh --own-branch`, the `/fresh-review` loop, then `--queue`.
2. **Plan the build as Thread Skill's next phase.** Run `/thread:orient Thread Skill`, or write the phase and task notes directly, from ADR 0065's decisions 2-9.
   - Order: Chain copies and the landing step (d2, d3), file tokens and every consumer (d4, d5), the vault Note wait hook (d6), Capacity (d8, which also needs a Chorus task: `capacity.json`, and an amendment to Chorus ADR 0104 d2), then rank and wait-die (d9).
   - Workspaces needs launch markers with repo-relative paths (ADR 0065 Consequences): a task outside this repo.
3. **Operational, Lachy's.** `mac-data-mcp-rollout-2026-10-29` is a serial chain stuck since 2026-10-29: Photos.app was wedged mid-export.
   - Its stuck chain alone holds the primary checkout, so the Primary refresh cannot catch up until it is resolved (force-quit Photos, then `/thread:repair [[mac-data-mcp-rollout-2026-10-29]]`) or dropped.
   - `~/.config/thread/rollouts.toml` has no `[notify] ntfy_topic`, so the Primary refresh's day-long notice has nowhere to go.

## 3. Decisions settled

**Lachy's rulings, 2026-11-02:**
- A clash is only two runs editing the same file or note, in either shape. Spike first, then build.
- The vault: a best-effort Note wait, with the higher-ranked run first. Every wait is recorded for the weekly Reflection. Vault copies are held back until that record shows real clashes ("Wait, and watch it").
- `/fresh-review` stays a shared skill in `~/.agents`, kept current by the Primary refresh ("Stay shared, kept current").
- The Primary refresh: "Fix both, one more pass". It landed with the round's open blockers filed.

**Decided for him** (ADR 0065 § Decided for Lachy):
- Chain copies are git worktrees under `~/.local/state/thread/chains/`.
- A chain lands each task on the primary's local default branch, so nothing new pushes unattended.
- Predicted claims only order runs; the landing check decides.
- Waits are wait-die by rank, with no preemption.
- Capacity rises and falls on its own, replacing the fixed day Trickle, and falls back to it when a reading fails.
- Rollouts of one project on one repo still share one queue.

## 4. Gotchas found the hard way

- **Sessions load the plugin live from the primary checkout** (a directory-source marketplace). Thousands of script runs came from `~/repos/tools/thread-skill/skills/...` and none from the version cache. So the primary's age is the installed behaviour. The Makefile's "version-keyed cache" note is historical.
- **The primary predates `engine-snapshot.py`.** Every rollout scheduled from it is unstamped, and `primary-hold.sh` counts each one until it finishes. The Primary refresh moves the primary at the first clear pass.
- **A Claude subagent cannot leave the session's cwd.** A `/fresh-review` of a branch in another worktree must use the ranged scope from a sibling checkout. Launching this session in the worktree avoids that.
- **The old handoff doc** `~/repos/tools/thread-skill/docs/handoffs/2026-11-02-every-rollout-at-once.md` sits in the primary marked consumed and uncommitted. A later close in that home deletes it (handoff-lifecycle § Close-out rule (b)).
- **ADR 0066 is taken** by the Primary refresh. Number the build's ADRs from 0067.

## 5. Suggested skills

`/fresh-review`; `/thread:orient Thread Skill` (or `superpowers:writing-plans` for the phase notes); `grill-with-docs` only if planning finds a new fork that is Lachy's.

## 6. Paste-ready prompt

```
You're continuing "Every project's rollout runs at once: land the spike, plan the build" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-wt-every-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill-wt-every-rollout/docs/handoffs/2026-11-02-every-rollout-build.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The spike is done but uncommitted on spike/every-rollout-at-once: ADR 0065 (proposed), the spike report and CONTEXT.md terms. A clash is only the same file or note: chain copies are git worktrees, claims are files checked at landing, the vault gets a best-effort Note wait, Capacity is automatic, waits go wait-die by rank. The Primary refresh (ADR 0066, PR #272) keeps the primary checkout current and is installed.
Also read: docs/adr/0065-every-projects-rollout-runs-at-once.md, docs/spikes/2026-11-02-every-rollout-at-once.md, CONTEXT.md **Chain copy**, **Note wait**, **Capacity**.
Suggested skills: /fresh-review, /thread:orient Thread Skill, grill-with-docs (only for a new fork).
Gates: a new design fork that is Lachy's (intent, how robust) returns to him via grill-me; technical calls are decided and listed.
Next move: once PR #272 has merged, merge origin/master into this branch, commit the spike docs, then land the branch through the /fresh-review loop.
```
