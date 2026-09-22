---
thread: thread-skill
written: 2026-09-22
status: pending
---

# Thread rollout: prepare and run a live pilot

Manual prompt handoff requested by the user. No new session or pilot has been launched.

## Done and verified

The rollout redesign is an unreleased candidate, committed and independently reviewed. Its domain glossary, ADRs, implementation, test results and review dispositions are recorded in [rollout-redesign-progress.md](../implementation/rollout-redesign-progress.md). That record distinguishes deterministic fixtures from real execution. **Live unattended acceptance remains outstanding.**

Start in this exact directory, which contains the candidate rather than the installed release:

`/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill`

| Component | Candidate branch | Implementation checkpoint | Worktree |
| --- | --- | --- | --- |
| Thread | `codex/thread-rollout-redesign` | `15781f5fd46cfe1869cf7681e31c5650254bcf93` | `/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill` |
| Shared native adapter | `codex/thread-native-recovery` | `5cb5b72569e6bf153ce272b37f2c6fbfa6cd90d5` | `/Users/lachlants/.codex/worktrees/thread-native-recovery` |

Both worktrees were clean before this handoff was added. The Thread checkpoint predates this document's own commit; verify ancestry, not exact HEAD equality. The shared adapter implementation is in `42263b4`, with review and migration evidence in its later commits. Neither candidate has been integrated, installed or published. Plugin version remains 2.5.1.

Required references, relative to the Thread candidate unless absolute:

- `CONTEXT.md` and `docs/adr/0018-*.md`, `0019-*.md`, `0020-*.md`: accepted domain promises.
- `docs/implementation/rollout-compatibility.md`: the release gate.
- `skills/execute/SKILL.md`, `skills/execute/protocol-v4.md`, `skills/execute/host-api.md`, `skills/execute/preparation.example.json`: actual candidate invocation and payload contract.
- `/Users/lachlants/.codex/worktrees/thread-native-recovery/docs/implementation/shared-skills-runtime-migrations.md`: candidate R-WAVE evidence.
- `/Users/lachlants/repos/obsidian/Work/Tasks/thread-rollout-v4-native-acceptance.md`: existing acceptance task. Keep it open until its acceptance scope is actually complete; do not mark it done merely on pickup.

The progress record contains the full validation inventory. Highlights are 37 domain tests, 33 host tests including actual local SIGKILL recovery, 42 shared adapter tests, and three integration fixtures using the actual engine and adapter. Their model outputs and GitHub responses are fixtures. They do not prove native child dispatch, authenticated merges or heartbeat continuation.

## What remains

1. **Prepare one small real pilot.** Read this document, then mark only its frontmatter `status: consumed` without committing yet. Verify both candidate worktrees and their ancestry, preserve unrelated work, identify the current native harness/account and inspect available child/wait/continuation tools. Start with Codex when launched in Codex. The original session reached its fresh-agent limit; a new session must verify that fresh children can actually be created.
2. **Choose concrete pilot work before launching.** The user requested a test rollout but has not selected its target repository or task outcomes. Inspect suitable existing repositories and propose three small, independently shippable, low-impact changes: A is a prerequisite, B depends on A, and C is independent. Prefer useful test or documentation improvements in a repository with no deployment/publication on merge; do not create artificial production changes. Record outcomes, acceptance checks, repository/base, permitted merge effects, finite allowances and any controlled fault injection. Present this concrete preparation for the user's launch decision where authority remains missing. Do not repeat settled design questions or require approval for each later merge.
3. **Run the first pilot unattended after preparation.** Follow the candidate protocol 4 skill, explicitly select the candidate adapter, pin the implementation and retain the durable execution record. Use the one canonical engine and merger, fresh native children, independent verification and real authenticated GitHub PRs. Observe A's confirmed merge making B eligible while C remains active when the schedule permits; do not lengthen work merely to manufacture overlap. Record observed ordering and repeat a bounded scenario if the run did not establish the promise.
4. **Exercise controlled continuation and recovery.** Use small follow-on scenarios under the agreed allowance to observe a blocked task holding only its dependants, a draining pause starting no follow-ons, and an interrupted owner recovering without duplicate child dispatch or merges. Choose a safe checkpoint with no uncertain external mutation; use real interruption/ownership evidence. Record spent allowance before and after recovery and verify it is preserved. Record real native wait/heartbeat activity; a lead repeatedly polling in the same turn is not proof of unattended continuation. Do not assume a heartbeat makes ended-session children resumable.
5. **Record gaps precisely.** The compatibility checklist also requires queued merges and changed heads without false completion. Exercise those only where the repository and preparation support it; do not change branch protection or enable a merge queue solely to tick a box without authority. Keep unobserved cases pending. The existing acceptance task also carries revision, partial-ending and scoped-relaunch scenarios; use its full scope and the progress matrix to avoid treating this first pilot as the entire release gate.
6. **Finish the current harness slice, then the other harness.** Preserve real caller/request/child identities, pinned hashes, wait results, PR/head/actual-merge evidence, budget use and recovery transitions in durable project records. Fix demonstrated defects within the agreed scope, run targeted checks and obtain native independent review. Update the existing acceptance task and candidate migration ledger with observed evidence, without creating a duplicate task. A Claude run must take place in Claude with its own native tools/account. If that slice is unavailable here, leave it open and prepare a separate handoff for that consumer; this document has one consumer.
7. **Promote only after the release gate passes.** Real unattended Codex and Claude runs, required recovery cases and independent review must pass before integrating both candidates, bumping both Thread manifests and verifying installed cache hashes. This handoff is primarily the pilot, not authority to skip the compatibility checklist or publish an unvalidated candidate.

## Decisions settled

- Prepare interactively; execute unattended within agreed outcomes and permitted actions. Make educated decisions and record consequential choices. Routine uncertainty is not a reason to ask the user.
- Merges are automatic once the recorded authority, independent review and actual verification allow them. Merge-triggered deployment/publication must already be covered.
- Tasks advance by readiness. Waves are a provisional planning view. A blocked task holds its dependency closure; independent work continues.
- Requirements belong to Obsidian. The durable execution record owns attempts, adopted revisions, allowances, approvals and merge evidence. Notes reflect that evidence.
- Recovery, revisions and pause/resume never replenish allowance. Only an explicit relaunch grants fresh bounded allowance to the requested unfinished scope.
- Normal pause drains active work and starts no follow-ons. Neither pause nor stop silently resumes itself.
- Keep one convergence engine and one merge authority. Native children, reviewers and retries remain in the calling harness/account; no CLI model subprocess or silent provider/account substitution.
- Preserve live protocol 3 implementations and records. The candidate contract is explicitly protocol 4; do not reinterpret or edit an existing record's version to upgrade it.

## Gotchas found the hard way

- The original repo `/Users/lachlants/repos/tools/thread-skill` and installed skills still describe the live release. Their presence does not select the candidate. Explicitly read and invoke the candidate paths above.
- The original `THREAD.md` describes prior release work. Use the candidate progress record for this implementation's current state.
- An installed adapter without the ownership recovery API fails protocol 4 preflight. Supply the candidate `_shared/scripts/native_workflow.mjs` from the shared worktree.
- Keep using the host's returned `pinnedHost` for execution mutations. Do not switch engine or adapter bytes under an active execution.
- Source task notes are revision inputs. Write execution progress to the separate rollout projection; do not accidentally revise requirements by appending routine progress.
- Native agent thread limits are different from free concurrency slots. An idle old child is not a fresh independent stage. Never manufacture IDs or substitute fixture results.
- Queue admission is not a merge; a changed PR head invalidates review. Ambiguous side effects require reconciliation before replacement work.
- The shared live workspace has unrelated edits. Integrate by deliberate scoped changes only; never reset or overwrite it.
- Codex continuation uses its existing-task heartbeat. Claude uses its native session heartbeat and the candidate Stop hook. Neither implementation's presence is evidence that delivery worked.

## Suggested skills

- `grill-with-docs` for unresolved pilot repository/outcome/authority choices only; the rollout domain decisions above are already settled.
- Candidate `schedule` and `execute` for protocol 4 preparation and execution; candidate `status` and `repair` for evidenced inspection/recovery.
- `fresh-review` for new implementation fixes using the calling harness's bundled/native review engine.
- `handoff` for a separate other-harness consumer when needed; `close` deletes this consumed handoff at the consuming session's close-out commit.

## Paste-ready prompt

```text
Prepare and run a small real pilot of the Thread rollout redesign.

Start in /Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill.
Read /Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/handoffs/2026-09-22-rollout-live-pilot.md first, then mark that handoff status: consumed without committing yet.

The candidate is implemented, reviewed and tested, but real unattended execution, automatic GitHub merges and native recovery are still unverified. The required shared adapter candidate is at /Users/lachlants/.codex/worktrees/thread-native-recovery. Neither candidate is installed or released.

First propose a suitable repository and three small useful tasks: A is a prerequisite, B depends on A, and C is independent. Resolve the concrete outcomes, merge effects and finite allowances with me before launch. Then run unattended within that agreement, making informed decisions and merging automatically after verification and independent review. Observe dependent release, progress around a blocker, pause and controlled recovery without duplicate work or renewed allowances.

Use the candidate protocol 4 instructions and actual native children, waits and continuation tools in this harness/account. Record real evidence, preserve candidate branches and live runtimes, and leave unobserved acceptance cases open. Do not substitute simulated results or launch the other harness as a subprocess. Complete this harness's slice first; the other harness needs its own native session before release.

Suggested skills: grill-with-docs for unresolved pilot preparation, candidate schedule/execute/status/repair, and fresh-review for fixes. Begin by reading the handoff and checking the candidate worktrees and native prerequisites.
```
