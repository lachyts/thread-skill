---
thread: thread-skill
written: 2026-09-21
status: pending
---

# Handoff — thread-skill: consume the 2026-09-17 tier-ceiling review, then ship 2.5.0

Live fork of the 2026-09-21 session that shipped the durable handoff lifecycle (ADR 0017). That
work is done and committed; this doc carries only what was left over. It is itself the first
handoff doc written under the contract it ships — the consuming session's close deletes it.

## Done and verified

- **thread 2.5.0 committed at `4add36d`** — `thread:handoff` durable docs, `thread:close` § The
  handoff owns the continuation, `thread:open` handoff-doc pickup, ADR 0017 (amends 0011),
  glossary, README, both manifests 2.5.0. Tree clean. `origin/master` == HEAD at the time of
  writing (the push happened between the session's final report and this handoff — verify with
  `git status -sb` before assuming).
- **Two xhigh clean-room rounds consumed** — `docs/reviews/2026-09-21-ed4b2b4-e65597.md` (14)
  and `docs/reviews/2026-09-21-0d64649-39c201.md` (15), both `status: consumed` with disposition
  tables; chain stopped by METHOD K27. Those two docs are due for deletion in the next close-out
  commit in this repo (fresh-review lifecycle) — the consuming session may do it.
- **Rig evidence** in ADR 0017 § Decision: 2 controls proposed all four candidates, 7 treatment
  reps proposed only the two loose ends, the consumer rep deleted the doc cleanly.
- **Cross-repo alignment committed**: `workspaces` `fe77799` (stop-hook message names `<home>` +
  front matter; fixtures 38/0), `agents-config` `5197453` (Codex handoff stub drops OS temp).
  Three memories in the workspaces scope updated; `feedback_handoff_owns_the_continuation`
  marked superseded.

## What remains

1. **Consume `docs/reviews/2026-09-17-f4ba792-round2.md`** (12 findings on the `args.maxTier`
   tier ceiling, still `status: pending` — the commit `484c305` said "consume" but never flipped
   the status, so the SessionStart hook flags it every session). Its own § Addendum at `063f6c9`
   already records 1, 2, 3, 4, 5 and 11 as closed. Live state at `4add36d`, checked 2026-09-21:
   - **12 — open.** `grep -rl max_tier skills/schedule/` → 0 files. The rollout template and
     schedule skill still never emit the key ADR 0016 says is reachable through the dispatch
     path. Fix: a commented-out `# max_tier: opus` line in `skills/schedule/rollout-template.md`
     beside `env_bootstrap:`, and the key in schedule's frontmatter enumeration.
   - **9 — open.** `grep -c 'converge(.*maxTier' skills/execute/tests/prompt-invariants.test.mjs`
     → 0. No scenario drives `converge()` under a cap. Fix: one scenario with
     `{...aEff, maxTier:'opus'}` asserting every dispatched model is `opus`, second-pass prompts
     say SECOND PASS not STRONGER-TIER, result carries `tierCapped: true, escalated: false`.
   - **10 — likely closed.** `tierCap(` call sites 9 → 4 at HEAD; confirm the warning logs once
     (`log('maxTier: unrecognised` under a bad value) rather than per prompt build.
   - **8 — partly.** `escalate()`'s return is read at 1 of 6 call sites (`const moved =` at
     ~1034). Decide: thread the boolean through or drop the return and the comment claiming it.
   - **6 — likely closed.** `judgeEffort` (~872) now has the "pinning a judge … would silently
     LOWER review effort" comment and takes the higher of pinned/effortTier rank; add the
     `judgeModel: 'fable'` + cap assertion the round said was missing.
   - **7 — unverified.** Doubled Ralph budget under a cap (terminal first pass runs the full
     loop, then the suppressed-escalation re-dispatch runs it again). Read `implement()` around
     the `escalate(st, task.slug, 'implement')` calls; if the second dispatch still renders
     `ralphLoop`, either skip the re-dispatch when `escalate()` returns false or document the
     doubling in `rollout-template.md`'s worst-case line.
   Then: disposition table appended, `status: consumed`, commit by pathspec. If any engine code
   changes, `/fresh-review xhigh` on the diff (keep the batch uncommitted while it runs — K25),
   run the README § Tests suite, and consume that round too.
2. **Ship 2.5.0 through the cache** — the cache is version-keyed (THREAD.md § Known quirks):
   `claude plugin marketplace update thread` → `claude plugin update thread@thread` → restart the
   session. Push first if `git status -sb` shows anything ahead. Until the restart, sessions run
   2.4.0's handoff text (OS temp) — the memory pointer covers that gap.
3. **Close-out housekeeping** in this repo's next `thread:close`: `git rm -f` the two consumed
   2026-09-21 review docs and, once this doc is consumed, this doc.

## Decisions settled

- Everything in ADR 0017 and its § Rejected — do not reopen the TTL, the one-doc-one-consumer
  rule, the legacy rule, or the one-file pathspec commit into the working repo.
- Round-2 findings 6 (no TTL) and 12 (commit surface) were marked deliberate with reasons in
  the review doc; they are not open items.
- The chorus/audio-intake METHOD rows K25/K26/K27 govern the review loop here: commit the review
  doc never the code while a round runs; transcribe when the wrapper stalls; stop at ~40%
  regressions.

## Gotchas found the hard way

- **The `fresh-review` wrapper wrote its own doc in round 1** (first time in five rounds) but
  not in round 2 — when it forks and says so, the parent transcribes. Check
  `docs/reviews/` for the file before writing a duplicate.
- **`git rm` refuses a doc whose consumed mark is uncommitted** — always `git rm -f`.
- **The Bash tool is zsh**: an unmatched glob aborts the whole command and `2>/dev/null` does
  not hide it. The close scan uses `find` for that reason; keep it that way.
- **The `~/Projects` monorepo's git toplevel is `~/Projects`** — never use the toplevel as the
  handoff home there; the unit directory rule exists because of it.
- **Concurrent rig reps sharing one fixture file** will trip each other's stale-write guard;
  give every rep its own copy.

## Suggested skills

- `fresh-review` (xhigh) for any engine change in item 1.
- `superpowers:verification-before-completion` before flipping the review doc to consumed.
- `thread:close` at the end — it will delete this doc.

## Paste-ready prompt

```
You're continuing "thread-skill: consume the 2026-09-17 tier-ceiling review, then ship 2.5.0" mid-stream — a live handoff, not a cold pickup.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-21-tier-review-triage-and-ship.md — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: thread 2.5.0 (durable handoff docs + close suppression, ADR 0017) is committed at 4add36d, tree clean, origin/master == HEAD, plugin cache still on 2.4.0. One review doc is still `status: pending`: docs/reviews/2026-09-17-f4ba792-round2.md — 12 findings on the maxTier tier ceiling; its own addendum shows 1–5 and 11 closed at 063f6c9; at HEAD findings 12 and 9 are verified open, 6 and 10 likely closed, 7 unverified, 8 partial.
Also read: docs/reviews/2026-09-17-f4ba792-round2.md; skills/execute/wave-execute.workflow.js (tierCap, clampTier, judgeEffort, escalate, implement); skills/schedule/rollout-template.md; THREAD.md § Known quirks (the version-keyed cache dance).
Suggested skills: fresh-review xhigh if any engine code changes (batch uncommitted while it runs — METHOD K25); superpowers:verification-before-completion; thread:close at the end.
Next move: verify findings 6, 7, 8, 9, 10 and 12 against HEAD with the commands in the doc, fix what is open, append the disposition table and flip the doc to `status: consumed`; then `claude plugin marketplace update thread && claude plugin update thread@thread` and restart.
```
