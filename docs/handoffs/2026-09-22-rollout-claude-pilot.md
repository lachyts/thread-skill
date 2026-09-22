---
thread: thread-skill
written: 2026-09-22
status: pending
---

# Thread protocol 4: separate native Claude pilot

This is a manual handoff for one future Claude-native consumer. No Claude session has been launched from Codex. Read this document, mark it consumed without committing yet, and confirm the actual calling harness before acting. Do not execute the Claude slice through a Codex subprocess.

## Current evidence and retained state

The Codex Agent Reader pilot finished all three useful outcomes: PRs [#13](https://github.com/lachyts/agent-reader/pull/13), [#14](https://github.com/lachyts/agent-reader/pull/14), [#15](https://github.com/lachyts/agent-reader/pull/15), each with fresh native independent review, automatic canonical-host squash merge and successful post-merge verification. Execution `88c68b76-b116-4f72-a7ae-ae64ae280d4c` is ended and complete. Its existing-task heartbeat is paused. Do not resume, reinitialise or relaunch it. Its source task snapshots and finite pools are retained; this handoff grants no new allowance.

Read [the live pilot evidence](../implementation/2026-09-22-live-pilot.md) for actual native child/request IDs, three heartbeat deliveries, child-owner recovery, blocker/independent progress, dependent admission, draining pause, one explicitly approved resume and limitations. The private record remains under `/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/.thread/pilot-2026-09-22/record`; keep it and its pinned release intact.

The run exposed a changed-base prompt defect. The host correctly invalidated stale approval, but the next child was told to stop unless the new base was already integrated. The coordinator explicitly reconciled the existing branch, then the original pinned engine obtained fresh verification/review and merged it. Candidate source now has a bounded guarded-integration correction and regression coverage at `67a825fb723f3b67604b6529553cc87b910f85e4`, with a fresh independent recheck reporting no findings; read the latest review disposition before use. The correction was **not** loaded into the Codex pilot and needs live acceptance.

## Candidate locations

- Thread: `/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill`, named branch `codex/thread-rollout-redesign`. It descends from `de84d401d06d022aea09a2e94c09d73b0eb9b4ea`; use the latest reviewed checkpoint for a new execution, not exact equality to that old HEAD.
- Shared adapter: `/Users/lachlants/.codex/worktrees/thread-native-recovery`, named branch `codex/thread-native-recovery`, implementation ancestry `5cb5b72569e6bf153ce272b37f2c6fbfa6cd90d5`. Evidence-only commits may follow. Use `_shared/scripts/native_workflow.mjs` explicitly.
- Neither candidate is installed or released. Both Thread manifests remain 2.5.1. Installed protocol 3 guards and all live/pinned versions remain unchanged. Preserve unrelated changes and the pilot's retained worktrees.

## Next native session

1. Establish real Claude session/account, fresh native child capacity, native result collection, ownership evidence and continuation tools. Read candidate `skills/execute/protocol-v4.md`, `host-api.md`, `docs/implementation/rollout-compatibility.md`, and the ADR/domain/progress references. Check candidate ancestry, review disposition and GitHub authentication. Do not assume catalogue availability proves delivery.
2. Prepare concrete useful work and finite authority with Lachy before launching. The Codex agreement covered its three now-merged outcomes and one planned resume, not new Claude work, extra PRs or refreshed budgets. Discover repository/base/verifier and merge effects, propose prerequisite A, dependent B and independent C, then resolve any missing authorisation. Reuse settled rollout design decisions; no redundant design interview.
3. Pin a new explicitly authorised protocol 4 execution to the reviewed candidate. Use Claude's real native children/reviewers and waits in its current account. Verify the candidate Stop integration, emit its actual `THREAD-EXECUTION` marker, and register/find its native session heartbeat with real Cron tools before dispatch. Missing native continuation is an unmet preflight; do not substitute another harness or a shell scheduler.
4. Claim before spawn, immediately bind actual IDs, fill admitted capacity before waiting, accept actual schema-valid outputs using the request's current resultCaller, then advance/merge serially through that execution's pinned host. Preserve budgets and same-PR revalidation across retry, recovery and revision. Honour pause/stop/ended and stop continuation; no silent resume or relaunch.
5. Observe only cases supported by the agreed useful work. The corrected changed-base entry deserves real acceptance. Keep queue/head-change, cold/ambiguous-child recovery, pause with prerequisite already merged, unrelated-work overlap, revision/prerequisite, partial-ending/relaunch and revert scenarios open unless actually observed. Do not change protection/queue settings or manufacture work merely to claim coverage.
6. Update the existing acceptance task `/Users/lachlants/repos/obsidian/Work/Tasks/thread-rollout-v4-native-acceptance.md` and candidate Shared Skills ledger `docs/implementation/shared-skills-runtime-migrations.md` R-WAVE. Keep C-CLAUDE-INFERENCE separate from canonical-engine evidence. No duplicate follow-up task.

Only after both native slices, the remaining required acceptance cases and independent review pass may integration/release be considered. This handoff does not authorise skipping the compatibility gate, installing either candidate, bumping versions or publishing.
