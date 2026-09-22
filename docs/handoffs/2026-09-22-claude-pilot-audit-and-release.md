---
thread: thread-skill
written: 2026-09-22
status: pending
---

# Claude protocol 4 pilot: independent audit, then the release decision

Manual handoff written at a session safepoint after `thread:close`. The native Claude pilot is finished and every record is committed; what remains is the audit that the Codex slice already received, and a decision only Lachy can make.

## Done and verified

- Native Claude session `9fce5030-d194-4c32-a286-5a9705505228` ran execution `db955f02-9692-4777-afcb-48645277ba5f` (candidate `5d3e40f`, adapter `0cdc433`) to `ended`, `rolloutComplete: true`. PRs [#18](https://github.com/lachyts/agent-reader/pull/18) → `2a1ef647`, [#19](https://github.com/lachyts/agent-reader/pull/19) → `dca45b0e`, [#20](https://github.com/lachyts/agent-reader/pull/20) → `19bf1ac8`, each squash-merged by the pinned merger after fresh `claude-fable-5-1` review at `xhigh` and post-merge verifier exit 0. Spent A 8/13/0, B 4/7/0, C 2/4/0 of 8/16/2.
- Observed and recorded: profile effort governs children in a fresh session (Fable at xhigh); draining pause → `paused`; heartbeat read `paused` and deleted itself; one recorded one-shot coordinator resume with allowances unchanged; five real session-cron deliveries; the corrected changed-base entry recovering three consecutive base movements unattended; a review-requested revision round; immediate dependent admission; Stop hook firing at every turn end; five out-of-schema child outputs rejected at the host boundary and re-emitted validly by the same bound children.
- Written and committed: report section `docs/implementation/2026-09-22-live-pilot.md` § Native Claude slice (`2b11d8c`); `THREAD.md` state, quirks, resume (`2b11d8c`, pointer `be577fb`); R-WAVE ledger entry in the adapter worktree `/Users/lachlants/.codex/worktrees/thread-native-recovery` (`d38a6ec`); estate METHOD candidates K62–K63 (`401a8c2` in `~/repos/workspaces`); vault rollout note `agent-reader-claude-pilot-rollout-2026-09-22` (status done) and acceptance task `thread-rollout-v4-native-acceptance` § Claude live evidence (Obsidian Sync; git sweep later).
- Private record and evidence: `.thread/pilot-claude-2026-09-22/` (gitignored, mode 700): `approval.json`, `preparation.json`, `config.json`, `payloads/`, `outputs/` (every host call and raw child output), `evidence/*.json`, `record/` (authoritative state and pinned release).
- Close-out done: `modelSettings.claude-fable-5-1.effortLevel` restored to `high` (file hash equals the pre-edit hash `25c034d9…`); the eight `rollout-*` agent definitions and `.claude/settings.local.json` removed; both consumed handoff docs deleted (`31b1c1c`, `deafb5d`).

## What remains

1. **Independent audit of the Claude slice**, mirroring thread 3's audit of the Codex slice (`bd04272`, `docs/audits/2026-09-22-*`). A fresh reviewer child (not this session's lineage) checks the report section against the private record: every merge in `record/state.json` `host.merges` matches GitHub; every child ID in `outputs/bind-*.json` has a transcript under the session's `subagents/`; every accepted envelope's output equals the child's final transcript text; pinned release hashes equal `evidence/launch-hashes.json`; the three source task notes still match their adopted snapshots. Record the audit under `docs/audits/` and disposition any finding.
2. **Coordinate with thread 1** (the main project conversation) before acting further; thread 3 continues independently. Do not duplicate dispatch, re-initialise or relaunch execution `db955f02…`, and never reuse either pilot's pools.
3. **Lachy's release decision.** Both harness slices now have real unattended evidence; the remaining acceptance cases are listed in the acceptance task (real Stop-driver block, A merged while B held solely by pause, cold/ambiguous recovery, revisions/prerequisites, partial ending, relaunch, revert). Present the two options plainly: release on current evidence, or run a further bounded slice for named cases with fresh finite authority. If he says release: integrate the shared adapter and Thread candidate, bump both Thread plugin manifests together, run the cache dance and verify installed cache hashes per the acceptance task; keep active v3/v4 executions pinned.
4. **Candidate contract finding to raise, not fix silently:** children add out-of-schema keys about a third of the time; the preamble should name the exact allowed keys. And the allowance model should treat base movement as a cost (K62).
5. Housekeeping Lachy may want: close source task notes `agent-reader-claude-pilot-{a,b,c}` (still `status: open`, untouched because they were fingerprinted); the session-only heartbeat cron `efc4721b` dies with the session.

## Decisions settled

- The pilot scope (A/B/C, 8/16/2, maxConcurrent 2, engine 3/2/2, one pause and one resume) is fully executed; no relaunch, no renewed allowance, nothing installed or released.
- The changed-base acceptance claim is made only for what was observed: three unattended recoveries through the corrected entry with fresh verification and review, landed by the unchanged pinned merger.
- Unobserved cases stay open and are not inferred.

## Gotchas found the hard way

- Children (Opus and Fable) return extra JSON keys despite "Return ONLY JSON satisfying the supplied schema"; the host rejects at `accept` with no state change. Recover by messaging the same bound child to re-emit the allowed keys; never edit output or re-spawn.
- A sibling thread merging into the same repo forces integrate + review per movement; A's allowance was consumed exactly. Serialise pilots per repository or budget for the merge rate.
- `CronCreate` heartbeats arrive 5–10 minutes after the scheduled minute; child idle notifications arrive first. The Stop driver only blocks when a turn ends with actionable work.
- The agent definition `effort:` field does not govern; the profile's per-model `modelSettings.<model>.effortLevel` does, and only at session start.
- `gh pr edit` fails silently on `lachyts/agent-reader` (Projects-classic GraphQL deprecation); use the REST pulls endpoint and read back.
- The originating Codex sessions commit into this worktree concurrently; re-read `git log` before pinning anything. Deleting the last handoff doc removes `docs/handoffs/` itself; `mkdir -p` before writing a new one.

## Suggested skills

- `thread:open` with this doc's path (marks it consumed), then `fresh-review` for the audit child, then the acceptance task's § Resume prompt if Lachy decides to release.

## Paste-ready prompt

```
You're continuing "Claude protocol 4 pilot: independent audit, then the release decision" — a live handoff, not a cold pickup.
Read first: /Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/handoffs/2026-09-22-claude-pilot-audit-and-release.md — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: the native Claude protocol 4 pilot on lachyts/agent-reader is finished (execution db955f02, PRs #18/#19/#20 merged by the pinned host) and fully recorded in docs/implementation/2026-09-22-live-pilot.md § Native Claude slice, THREAD.md, the R-WAVE ledger and the acceptance task. Nothing is installed or released.
Also read: THREAD.md § Where we are (top entry) and § Known quirks; docs/audits/2026-09-22-live-pilot-independent-audit.md and 2026-09-22-changed-base-independent-audit.md (how thread 3 audited the Codex slice); ~/repos/obsidian/Work/Tasks/thread-rollout-v4-native-acceptance.md.
Suggested skills: thread:open (this doc), fresh-review for the audit child.
Next move: run an independent audit of the Claude slice against .thread/pilot-claude-2026-09-22/ (private, gitignored) and GitHub, record it under docs/audits/, then put the release decision to Lachy with both options and act only on his answer.
```
