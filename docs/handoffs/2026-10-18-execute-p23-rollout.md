---
thread: thread-skill
written: 2026-10-18
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

## 1. Done and verified

- **`[[thread-skill-rollout-2026-10-17]]` is closed out.** 10 of 11 tasks merged. It was scored (`close-score.py --close supersede` → `t-20261018T055357Z-907caf`), stamped `status: done` + `superseded_by: "[[thread-skill-rollout-2026-10-18]]"`, and moved to `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`. Its git-env canary was retired. Its overnight stall (p19-10 and p19-5's spend gates refused by the pricer, plus an undelivered push logged as pushed) is the Context of ADR 0038.
- **ADR 0038 "a Cap is a promise"** merged in PR #168 (`0b1c2a7`): `docs/adr/0038-a-cap-is-a-promise.md`, the CONTEXT.md **Cap** entry, a back-reference in ADR 0034 and a README § Design line. Status is `accepted, not built`. P23 builds it.
- **`[[thread-skill-rollout-2026-10-18]]` is scheduled** (`/thread:schedule Thread Skill --regenerate --tasks …`; supersedes the 10-17 note). It has 7 tasks: p19-5 (carried, `in_progress`), p23-4, p23-1, p23-3, p23-5, p23-6, p23-7. Phase note: `[[thread-skill-p23-rollouts-run-through-the-evening]]`. Settings: Project root `~/repos/tools/thread-skill-rollout`, verifier `make test`, ceilings 4/4/3/3, baseline failures none, standing approval 50 USD (`file:defaults`), no `incomplete:` stamp. `reconcile-rollout.py next` gives running p19-5, start p23-1, p23-5, p23-4, and holds p23-3, p23-6, p23-7 on their dependencies.
- **The four forks are ruled** (they were listed in the 10-17 handoff): PR #88 → land a trimmed version (p23-7). The 5c5a `.thread/` evidence → archived to `~/Archive/thread-skill/2026-09-23-codex-routing-evidence.tgz` and removed. The thread-rollout-redesign worktree → archived to `~/Archive/thread-skill/2026-09-23-thread-rollout-redesign-evidence.tgz` plus branch `archive/thread-rollout-redesign` (`14676a3`). p21-5/p21-9 → settled, both marked done.
- The 10-17 handoff (`docs/handoffs/2026-10-17-execute-p22-rollout.md`) is marked consumed.

## 2. What remains

1. `/thread:execute [[thread-skill-rollout-2026-10-18]]` from the clone, continuous. Lachy is away from about 18:15 and wants it to run through the evening.
2. **p19-5 resumes, it does not restart from scratch.** Its branch `audit-fix/skill-p19-5-trim-descriptions-700-hard-cap` already has the pre-trim eval record (`a352a29`) and the trim (`14e7ee8`). The Workflow call that was running it died with the 13:08 process. What's left: the post-trim `make evals` run, the PR and the review. Both of its gates are already in its note's `## Approved gates` (the irreversible one from 10-16, the spend one signed 2026-10-18), so a restated plan needs both bullets verbatim.
3. Post-rollout, for Lachy: the 4.1.0 release decision (`claude plugin update thread@thread`, `make release-check`, a release PR with p19-5's comparison record), and setting `[notify] ntfy_topic` in `~/.config/thread/rollouts.toml` once p23-3 lands. Until both p23-1 and p23-3 have merged, the fallback has no table and no topic.
4. Then `thread:close` from the clone (update THREAD.md, delete this doc).

## 3. Decisions settled

- ADR 0038 is the design: one-line `spend: <what> — cap N USD` gates with the split in sub-bullets, the pricer unchanged and fail-closed, the plan judge prices each top-level gate through `exposure -` on stdin, a never-priceable gate is bounced at most once, and the ntfy fallback fires only when Remote Control is inactive or errors. Don't relitigate it in plans. The task notes carry the details.
- p23-2 was merged into p23-1. p23-1, p23-4 and p23-5 carry `rung: opus-xhigh`.
- The Opus 5.5 lock holds for every call (no Fable, `max_tier: opus`).
- [[ntfy-noise-audit]] was filed as a separate task (Lachy's ask). It isn't part of this rollout.

## 4. Gotchas found the hard way

- The pushed-base gate (execute § 2.7) waits on queued `close/*` landing PRs, and that includes this doc's own landing PR. If start is held, wait for the PR to merge. Don't push around it.
- `gh pr edit` / `gh pr update-branch` fail on this repo (Projects classic deprecation). Use the `gh api` REST endpoints (`PUT /repos/{o}/{r}/pulls/{n}/update-branch`).
- A Workflow result is JSON with a `result` key, not a `<result>` tag.
- The Bash tool runs zsh, which doesn't word-split variables. Use arrays for pathspecs.
- No question tool while rollout work is live. Gates go through the Needs-you log and push. Until p23-3 lands, check that a push really went out, because "not sent (Remote Control inactive)" was logged as pushed on 10-17 and on 10-10.

## 5. Suggested skills

`thread:execute` (the run), `thread:status` / `thread:repair` if it stalls, `fresh-review` for any code the lead writes by hand, `thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "Thread Skill: execute the P23 rollout" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-18-execute-p23-rollout.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: [[thread-skill-rollout-2026-10-18]] is scheduled (7 tasks: carried p19-5, then P23, which builds ADR 0038 "a Cap is a promise", merged in #168). The 10-17 rollout is closed out and archived. p19-5's branch already holds its pre-trim eval record and the trim, and both its gates are approved; it needs the post-trim eval, the PR and the review. Lachy is away for the evening and wants it running continuously.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-rollout-2026-10-18.md, docs/adr/0038-a-cap-is-a-promise.md, ~/repos/obsidian/Work/Phases/thread-skill-p23-rollouts-run-through-the-evening.md
Suggested skills: thread:execute, thread:status, thread:repair, fresh-review, thread:close
Next move: /thread:execute [[thread-skill-rollout-2026-10-18]]
```
