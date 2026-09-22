# Task-ready rollout implementation

Status: implementation candidate reviewed and fixture-tested; live unattended acceptance and release remain pending.
Decision basis: [glossary](../../CONTEXT.md), [ADR 0018](../adr/0018-preparation-delegates-within-rollout-authorisation.md), [ADR 0019](../adr/0019-task-readiness-governs-progress.md), [ADR 0020](../adr/0020-requirements-and-execution-evidence-have-distinct-authorities.md).

## Contract and preparation

Protocol 3 remains the existing wave-barrier runtime. Protocol 4 is explicit and uses a durable project record, one task-level invocation of the same `wave-execute.workflow.js`, the shared native Workflow adapter and the existing `merge-wave.sh`. It never feeds v4 state to the v3 cursor or silently upgrades a live rollout. A release pins host, state transitions, engine, native adapter and merger bytes per execution; changing installed source does not change a running execution.

Preparation captures repository identity, base branch, verifier, outcomes, acceptance checks, constraints, permitted actions, reserved decisions, preapproved gates and merge-triggered effects. It resolves the repository and fetched base and runs the verifier on an isolated clean base before workers begin. An unrecognised deployment/publication consequence blocks launch until covered. Scope stays one repository and PR-shaped machine-verifiable tasks.

The preparation interview asks about consequential trade-offs, not every implementation detail. During execution the lead makes evidenced choices inside that authority, records them and has significant choices independently reviewed. It blocks the affected dependency closure when required authority is missing and continues independent work.

## Durable ownership

The project record owns authorisation, execution IDs, task membership, adopted requirement snapshots, attempts, allowances, approvals, current outcome validity and merge evidence. Source task notes own requirements. Derived note statuses are projections, never merge evidence. Requirement fingerprints exclude machine-owned progress only when an explicit parser can distinguish it; otherwise an edit requires assessment, never silent adoption.

The initial implementation fingerprints complete source notes. Its lead projects progress into a separate Obsidian rollout note from the host's status view, leaving source requirements unchanged. This avoids interpreting the system's own progress writes as requirement revisions; an interrupted projection is refreshed from the authoritative record on the next wake.

Each mutation uses a private atomic record under an exclusive process lock. The record carries an owner (harness, account and session) and monotonically increasing ownership epoch. A recovered owner must reconcile every claimed/dispatched native child before redispatch. Same harness/account is required; old epochs are fenced. Lost spawn responses are ambiguous and consume capacity until resolved, not invitations to spawn twice. A local host outage leaves evidence intact; an expired timestamp alone proves neither termination nor failure.

The repository merge lease additionally checkpoints the subprocess group before releasing a start gate. Parent-liveness loss stops that group, and recovery requires it to be stopped before releasing the lease. A local process death still leaves any GitHub outcome uncertain; every durable merge intent stays held until remote evidence and its domain transition are recorded.

The native adapter remains the only interpreter of canonical Workflow requests. The lead claims before native spawn, binds the actual native child ID immediately, waits using native tools, then accepts the attested structured result. Independent stages use independent children. No standalone model process, cross-account switch or quota purchase is allowed. A suitable same-account binding may be substituted only in a new immutable attempt segment with cumulative allowance preserved.

## Allowances and readiness

Each execution grants finite native-call, verifier-iteration and recovery allowances per original task. A claim reserves the full possible verifier work requested of an implementing child; reservation is conservatively spent even if the child dies or uses less. This deliberately underuses rather than silently replenishes budget. Engine round/iteration ceilings remain in force. A discovered prerequisite shares its originating task's allowance pool; revisions, retries and substitutions never allocate another pool.

Readiness requires: membership in the requested scope, unsatisfied current outcome, satisfied dependency outcomes, adequate remaining allowance, approved authority, no conflicting active task, and a runnable execution. Dependency cycles or unknown references reject the entire graph update. Conflicts are symmetric exclusion constraints, separate from dependencies. A new prerequisite and all changed edges are validated and committed atomically. Active work affected by a revision or invalidation is superseded and must drain or be interrupted before a replacement starts.

Each converged task is processed immediately. The merger is serial per repository, binds repository/base/head, observes the actual merge and preserves queue-pending state. Approval is tied to requirement revision, authority, verifier, fetched base, dependency evidence and PR head. Any change invalidates stale approval. A successful queue admission never marks complete or deletes its branch.

A superseded queued PR remains in flight until observed closed or merged. It cannot silently drain into a replacement. A later actual landing is recorded against its historical approval and revision, verified, and triggers current-outcome revalidation without claiming completion.

Normal pause stops admitting new tasks while active attempts finish bounded work and may merge. Immediate stop fences new claims and merges and asks the native host to interrupt active children. Both require explicit reinstatement. Quota loss cannot lower quality gates. Exhaustion blocks a task; an execution ends partial only after no ready task and no evidenced in-flight activity remain. The rollout remains open while any required outcome is unsatisfied.

## Recovery and changed requirements

Before each admission and merge, compare the source requirement fingerprint. The lead assesses edits against existing authority; approved adoption saves a new immutable revision and invalidates its old review/completion and dependent completion. Out-of-authority edits hold the affected work pending a new user decision; the original permission never grows by editing a note.

A post-merge regression holds merging for that repository. Bounded repair uses the same engine and remaining task allowance; if it cannot repair, a safe revert of attributable execution-owned changes is independently checked, preserving peer work. Revert evidence remains in history and invalidates outcomes of affected tasks and dependants. If neither repair nor safe revert is possible within authority, retain the hold and report the specific blocker.

When preparation authorises reverting run-owned changes, the host reserves two native calls and three verifier runs inside each original pool for that fallback. This reduces the allowance available for ordinary convergence and repair; it does not grant extra work. The fallback still uses the canonical engine, a fresh independent reviewer and the canonical merger. An isolated Git revert tree must match the reviewed candidate exactly. Actual reversal relationships are retained even if integration verification fails or the rollback was superseded while queued.

Explicit relaunch of an ended execution grants fresh finite allowances only to requested unfinished tasks. Prior executions and their spent allowances remain immutable history. Restart, heartbeat, owner transfer, pause/resume and a source edit never invoke relaunch.

## Host continuation and release

Claude and Codex use the same coordinator and native request exchange. A continuation wakeup inspects the record, recovers ownership, collects existing children, advances ready work and reconciles merges; it does not own a second convergence loop. Codex uses a heartbeat attached to the existing task. Claude uses its native session continuation facilities. Both require a running local host; recovery after sleep or quit is required, not machine-off progress. Paused and ended executions are not silently restarted by wakeups.

No overall overnight wall-clock cap: work continues until completion or no progress remains possible, subject to finite per-task and recovery budgets. In-flight native work/CI/queue states carry evidence and bounded inactivity handling. A wakeup stays quiet unless there is meaningful progress, completion, failure or required authority.

## Acceptance and evidence

Tests must cover immediate dependent admission; dependency-only block propagation; revision invalidation; seven complete/three blocked partial ending; budget preservation and scoped relaunch; pause draining; merge queue/head/replay races; revert invalidation; ownership fencing and ambiguous child recovery. Native-adapter fixtures establish deterministic behaviour only. Genuine unattended runs and recovery must be observed separately in Claude and Codex before promoting continuous support; a missing harness is an outstanding acceptance item, never a fabricated pass.
