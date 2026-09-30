---
thread: thread-skill
written: 2026-09-30
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

## 1. Done and verified

- **Orient reshuffle of Thread Skill** (2026-09-30, night), with grill-with-docs. Drift 0 before and
  after (`reconcile-project.py --project thread-skill`). The next-action slot is unchanged
  (p11-7, fill-blank only).
- **PR #53 merged** at `df32531`, auto-merge on green CI (`make test`, macOS and Ubuntu). It carries
  ADRs 0029 and 0030 cut to decisions, `CONTEXT.md` one-liners, `THREAD.md` and the spike doc.
  Commits: `5d4404e` (round 2 answered at decision level), `ef71896` (round 3's `simplify` findings),
  `6bac013` (the slimming and round 3's nine design calls), `31e5147` (consumed review doc deleted).
  `make test` ALL PASS locally at `6bac013`.
- **Review:** round 3 ran `/fresh-review simplify` (28 findings, all acted on: see `6bac013`'s
  message). No further round, by Lachy's call: the ledger stopped at round 2.
- **Vault** (Obsidian, not committed here):
  - p8-2 became [[thread-skill-p12-14-approve-gates-resumes-run]] (respecced for the queue) and
    p8-4 became [[thread-skill-p12-15-schedule-unpushed-base-check]]; backlinks rewritten; P8 keeps
    p8-1.
  - P12 and P13 task bodies carry the mechanics and the night's decisions: p12-4, 5, 6, 7, 8, 9, 10,
    11, 13, 14 and p13-1, 2, 3, 4. The P12 and P13 phase notes are current.
  - [[ab-fable-vs-opus-planning]] is respecced (Opus 5.5 `xhigh` vs Fable 5.1 `high`, blind replay of
    hard rollout tasks) and joins Thread Skill after p13-2.

## 2. What remains

1. **Schedule P12.** Run `/thread:orient Thread Skill` and answer **Steer only**. Its § 6 schedules the
   wave-shaped members with `--tasks`: p12-2 to p12-12, p12-14 and p12-15. It first checks there is no
   live rollout on this repo (none on 2026-09-30).
2. **Leave session-lane work alone:** p12-13 (GifLab's first queue run, live acceptance) and p13-4
   (the 3.0.0 release). p13-1 to p13-3 wait for P12 (p13-1 depends on p12-12).
3. **Execute** through orient's execute offer. Previous self-rollouts ran from the clone
   `~/repos/tools/thread-skill-rollout` (see Gotchas).
4. **Then:** p12-13, P13 (p13-1 to p13-3 as a rollout, then p13-4), then the Fable A/B.
5. **Still owed:** the fresh-review of workspaces `29ca886`; tags 2.7.1 at `e5903f5` and 2.9.0 at
   `43ff855`.

## 3. Decisions settled

All in `docs/adr/0030-a-rollout-is-a-queue-that-integrates-at-merge.md` and
`docs/adr/0029-escalation-climbs-the-operators-ladder.md`; the mechanics are in the P12 and P13 task
notes. Don't re-grill:

- Waves are gone. A rollout is a queue; only dependencies and a Solo task hold a task back.
- Integration merges `main` into the task branch (never a force-push). The lead runs a clean
  Integration itself; a top-rung agent runs only for trouble. A rejection releases the lane. The
  verifier is skipped only when `main` hasn't moved. A set-aside task resumes where it stopped.
- The built-in ladder is two Opus rungs, `high` then `xhigh`, with no Fable. Rungs are named, and a
  task's `rung:` stamps a name. The file is read at the start of each Workflow call.
- Fable is not a rung until the blind A/B shows it winning on hard tasks.
- File lists are best-effort: no agent sweep and no confirmation turn (p12-10).
- P12 is built on the old wave engine. Its tasks form a dependency chain (p12-5, 6, then 7 and 8,
  then 9, then 10 and 11, then 12), so the waves are deep whatever the file overlap; accepted.

## 4. Gotchas found the hard way

- **`gh` 2.43 has no `gh pr update-branch`.** Use
  `gh api -X PUT repos/lachyts/thread-skill/pulls/<n>/update-branch`. Upgrading `gh` is
  [[thread-skill-gh-upgrade-and-set-head]].
- **`land.sh --own-branch --queue --reviewed <sha>`** refuses a head with non-review commits after
  the reviewed SHA, by design. #53 was merged with GitHub's auto-merge because Lachy chose not to
  review the slimming commit.
- **The `refs` contract test** resolves every `ADR NNNN § X` against that ADR's headings. The ADRs
  now say "decision N", never "§ N".
- **Self-rollout:** the plugin's marketplace is a directory source at this checkout, so a rollout
  merging into it goes live mid-run. Past rollouts ran from `~/repos/tools/thread-skill-rollout`
  (`THREAD.md` § Known quirks; [[thread-skill-p5-3-retire-rollout-clone]] is still open).
- **A rollout task's planner reads `origin`,** so anything the tasks must read has to be merged
  first. It is: #53 is on `master`.

## 5. Suggested skills

`/thread:orient` (Steer only), which runs `/thread:schedule --tasks`; `/thread:execute` through its
execute offer; `/thread:status` and `/thread:repair` if the rollout stalls; `/thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "Schedule and run P12, the queue build" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-30-schedule-p12-queue-build.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: Waves are being retired. ADR 0030 (a rollout is a queue that integrates at merge) and ADR 0029 (escalation climbs the operator's ladder) are merged on master (PR #53, df32531), cut to decisions; the P12 and P13 task notes in the vault carry the mechanics. The Thread Skill orient reshuffle is done and drift is 0. Nothing is running. P12 now needs scheduling as a rollout on the current wave engine.
Also read: docs/adr/0030-a-rollout-is-a-queue-that-integrates-at-merge.md, docs/adr/0029-escalation-climbs-the-operators-ladder.md, THREAD.md § Where we are, the vault phase note [[thread-skill-p12-a-rollout-is-a-queue]]
Suggested skills: /thread:orient (Steer only), which runs /thread:schedule --tasks; then /thread:execute through its execute offer
Next move: run `/thread:orient Thread Skill`, answer Steer only, and let § 6 schedule P12's wave-shaped members (p12-2 to p12-12, p12-14, p12-15) with --tasks; p12-13 and p13-4 stay session lane.
```
