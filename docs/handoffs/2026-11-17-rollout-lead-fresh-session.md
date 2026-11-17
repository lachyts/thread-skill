---
thread: rollout-lead-fresh-session
written: 2026-11-17
status: pending
launches: thread-skill-rollout-2026-11-12
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-rollout`

You are the new lead of `[[thread-skill-rollout-2026-11-12]]`. Lachy hard-paused it on 17 Nov 2026 at 22:31 AEDT so that a fresh session leads it on a fresh Engine snapshot. The old lead (session `22a01d17`) ran five and a half days across three context compactions, and after the third it stalled the queue with its own launch error.

## 1. Done and verified

- 42 of 80 tasks merged. The last three: PR #429 (p54-13, `117f4a2`), PR #430 (p54-12, `2818bc8`), PR #431 (p54-16, `302490b`). Each reads `status: review`, landed and carried: done once Live, which the engine settles by itself.
- p54-6 (PR #425) was handed back at 22:31 (`blocked->review`, `ready: 2026-11-17T22:31+11:00`). `next --dry-run` listed it under `awaitingIntegration`. Its branch is untouched, and its Linux CI fix (`d9f190b..1f60c7b`) is on it.
- The hard pause is recorded: `paused: 2026-11-17T22:31+11:00` on the rollout note, a `## Pause log` line, and `record-pause` printed `hard pause recorded (nothing in flight)`. No Workflow call, Integration command or heartbeat cron is alive.

## 2. What remains

1. Run `/thread:execute [[thread-skill-rollout-2026-11-12]]` through the Skill tool. That is a Reinstate. Its § 1.5 moves the rollout onto a fresh Engine snapshot (`move.due`: cut, adopt, resolve again), then `clear-pause` and the cold resume.
2. The loop's first Integration is p54-6. Its PR head is not its anchor, so `prepare` will route it to `trouble`.
3. p54-8 follows p54-6, and 30 queued tasks follow p54-8. Lead the queue to the completion ceremony.
4. p46-3 stays set aside, gate-pending. Its sign-off is Lachy's, through `/thread:repair [[thread-skill-rollout-2026-11-12]]`. List it as a needs-you item; never sign it and never notify him.

## 3. Decisions settled

- Every agent runs on Opus, the lead included (the note carries no `arms:` stamp; Lachy's launch instruction was all-Opus).
- Never push a rollout needs-you item: no PushNotification, no ntfy.
- Never use the question tool while work is live. Only `merge-task.sh` merges: never `gh pr merge`, never a force-push.
- UK English. Every turn ends with a `ROLLOUT-STATUS:` line.
- Lachy chose the new-engine route over a plain fresh session and over `--regenerate`.

## 4. Gotchas found the hard way

Each of these was the old lead rebuilding a command from memory after a compaction. The rule that covers them all: **take every command from SKILL.md at the engine root, never from memory, a summary or this doc. A compaction is a § 1 entry (§ 1.5): re-read SKILL.md from the engine root after each one, before any launch.**

- An integrate call's `integration.headSha` is `prepare`'s `anchor`, never its `prHead`. The old lead passed `prHead` for p54-6; the merge step refused, and the set-aside met a spent retry budget, so the task waited 16 hours for Lachy.
- A merge-task exit 1 is set aside with merge-task's own text from its last `ERROR:` line onward. A summary in the lead's words makes the retry rule read the stop as a human's.
- `next --running` takes the live slugs, never a count.
- The Workflow journals live under the session's `subagents/workflows/` directory, and the profile path changes with the Login.
- `gh pr edit` fails on this repo (the retired classic Projects); agents use the REST API.

## 5. Suggested skills

- `thread:execute` (the Reinstate, then the loop).
- `thread:status` for a read-only picture when unsure.

## 6. Also filed

- `~/repos/obsidian/Work/Tasks/thread-skill-grill-a-rollout-lead-hands-over-before-compaction-costs.md`: the grill Lachy asked for on this failure. It is not the lead's to run.
- `~/repos/obsidian/Work/Tasks/thread-skill-followup-ci-shard-weight-for-reflect-weekly.md`, and p54-16's four follow-ups (`thread-skill-suite-plausible-cuts`, `thread-skill-suite-plausible-push-downs`, `thread-skill-retire-legs-in-place-mode`, `thread-skill-retire-protocol-3-migration-and-k6`).

## 7. Paste-ready prompt

```
You're continuing "Lead thread-skill rollout 2026-11-12" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-rollout — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-11-17-rollout-lead-fresh-session.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: You are the new lead of [[thread-skill-rollout-2026-11-12]] (protocol 5, 42/80 merged). Lachy hard-paused it on 17 Nov at 22:31 AEDT so a fresh session leads it on a fresh Engine snapshot; nothing is in flight. p54-6 (PR #425) was handed back and awaits Integration; p54-8 and 30 queued tasks wait behind it. p46-3 is gate-pending and is Lachy's, through /thread:repair.
Model: Opus for the lead and every agent.
Rules: never push rollout notifications (no PushNotification, no ntfy); never the question tool while work is live; only merge-task.sh merges; UK English; end every turn with a ROLLOUT-STATUS line. Take every command from SKILL.md at the engine root, and re-read it there after any compaction before you launch anything.
Suggested skills: thread:execute
Next move: run /thread:execute [[thread-skill-rollout-2026-11-12]] through the Skill tool: the Reinstate, which moves the rollout onto a fresh Engine snapshot and resumes the queue.
```
