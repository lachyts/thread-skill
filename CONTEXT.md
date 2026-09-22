# Thread — domain glossary

Thread carries work through time, from choosing what deserves attention to verifying agreed outcomes. This glossary defines the accepted domain model; the runtime compatibility guide distinguishes implemented behaviour from pending changes.

## Language

### The system

**Lane**: One of two ways to advance work: coordinated rollouts for independently verifiable changes, or scoped sessions for work requiring another rhythm.

**Execution-fit test**: The rule deciding whether a cluster belongs in the rollout lane or the session lane.

**Wave-shaped**: Work in one repository, with independently shippable tasks and outcomes that can be checked during execution. The number of tasks does not determine its shape.

**Task floor**: The guarantee that setting work aside leaves a self-contained task with enough context to resume it.

### Continuity and attention

**Thread**: A live agent conversation carrying working context.

**Thread record**: The durable state of play that survives the conversation which produced it.

**Route**: A deliberate disposition of the current thread when its next move is known.

**Router**: The sibling of the routes that helps choose the next move when it is undecided.

**Orient**: A project-level pass that reviews open work, recommends priorities and establishes how to proceed.

**Batch**: A group of session-lane work expected to progress safely in parallel.
_Avoid_: rollout, wave.

**Dispatch artefact**: The durable brief authorising a session-lane batch to begin.

**Dispatch stamp**: A record that work has been assigned, preventing it from being assigned twice accidentally.

**Thread-worthy**: Work whose decisions, context or artefacts justify a durable thread record beyond its task capture.

**Stash**: Setting work aside without assigning a day to resume it.

**Defer**: Setting work aside until a particular day.

**Handoff**: Transferring a thread's continuation to a fresh conversation to continue immediately.

**Handoff doc**: The durable brief owned by the next conversation until that conversation has consumed it.
_Avoid_: temporary note, compaction file.

**Continuation**: Work still within the handed-off thread's agreed scope.

**Loose end**: Follow-up work outside that scope which deserves its own task.

**Close**: Completing a thread and preserving the state and learning that remain useful.

**Pickup**: Resuming saved work; the capture has fulfilled its purpose once the work is live again.

### Memory capture

**Four-verb triage**: Resolving a memory candidate as an addition, update, supersession or deliberate no-op against existing memory.

**Provisional**: An inferred memory not yet corroborated by later use.

**Provenance**: Whether a memory was explicitly requested, inferred during work or inherited without a known origin.

**Recall**: Use of a memory in a live session, rather than merely listing its existence.

**Curator**: The process responsible for consolidating and retiring memory while preserving useful knowledge.

**Permanent**: A memory exempt from retirement based solely on lack of recent use.

**Demotion**: Moving a memory from general scope to the narrower context where it is useful.

**Seat**: The workspace scope of a method observation.

**Estate**: The scope shared across all workspaces.

**Process observation**: A reusable observation about how work was made, distinct from the subject matter of that work.

**Method candidate**: A process observation awaiting assessment before becoming an established working method.

### Planning structure

**Task**: One independently shippable unit with an agreed outcome and acceptance checks.
_Avoid_: ticket, item, story.

**Phase**: A milestone grouping in a human roadmap, giving tasks shared meaning without imposing an execution barrier.
_Avoid_: task, wave.

**Gather**: Forming a roadmap from loose tasks through proposed groupings and discussion.

**Rollout**: The coordinated pursuit of agreed task outcomes. It remains unfinished while required outcomes remain unmet, even when an execution has ended.
_Avoid_: batch, run, campaign.

**Execution**: One authorised effort to advance a rollout, with bounded allowances. It may span sessions and end with a partial result.
_Avoid_: rollout, session.

**Wave**: A provisional grouping of tasks expected to progress safely in parallel. It is a planning view.
_Avoid_: barrier, phase.

**Task revision**: A version of a task's requirements, assessed against rollout authorisation before adoption.

**Task dependency**: A requirement for another task's currently satisfied outcome.

**Task conflict**: A reason tasks cannot safely progress concurrently, without necessarily depending on one another's outcomes.

**Dependent closure**: All tasks that directly or indirectly require another task's outcome.

**Cursor**: A legacy summary of progress through ordered waves. It is not authoritative evidence of task completion in the readiness-based model.

### Authorisation

**Rollout authorisation**: The agreed outcomes, constraints and permitted actions governing a rollout.

**Delegated decision**: A choice agents may settle within rollout authorisation.

**Reserved decision**: A choice explicitly retained for the user.

**Gated input**: Authority required before a consequential action may proceed; existing authorisation can satisfy it when it covers that action and its limits.

**Input-gated block**: A task unable to proceed because required authority or a reserved decision is missing.

### Task lifecycle

**Landed**: A change that has actually merged. Landing is historical evidence and does not alone establish that the current outcome is satisfied.
_Avoid_: complete, queued.

**Complete**: A task whose current agreed outcome is verified. Adopted revisions or reversions can require that outcome to be assessed again.

**Waiting**: Awaiting evidenced work already in progress.
_Avoid_: blocked, parked.

**Blocked**: Unable to progress under current conditions or remaining allowance.
_Avoid_: waiting, parked, deferred.

**Agent-fixable block**: An obstruction agents can resolve within existing authorisation and remaining allowance.

**Drift**: A difference between recorded progress and the evidence of what has actually happened.

**Clean defer**: Explicitly removing a task from a rollout into the open backlog, resolving its dependent closure at the same time.
_Avoid_: block, park, skip.

**Pause**: Stopping new task starts while active tasks finish bounded work and may merge when approved. An immediate stop also stops ongoing work; neither form silently resumes itself.

**Reinstate**: Explicitly resuming a paused execution with its remaining allowances.
_Avoid_: relaunch, fresh start.

**Relaunch**: An explicit new instruction to advance unfinished rollout scope with fresh bounded allowances after the previous execution has ended.

### Convergence and recovery

**Convergence**: Bringing a task to an independently reviewed, verified result through bounded planning, implementation and review.

**Engine**: The single authority for performing convergence and merging its approved changes.

**Conductor**: A component that diagnoses and coordinates work through the engine without duplicating convergence or merge authority.
_Avoid_: second engine.

**Accumulated feedback**: The history of review findings that subsequent work must address without reintroducing earlier defects.

**Step-back round**: A revision that reassesses the approach after repeated rejection instead of continuing local patches.

**Ceiling approval**: Approval on the final permitted review round after earlier rejections.

**Situational report**: A read-only account of task progress, blockers, drift and the recommended next action.

**Repair bridge**: The route by which blocked work is repaired and revalidated through the same engine.

### Resource policy

**Tier**: A model and effort bundle used together for a task's work and review.

**Step-up**: Assigning a more capable starting tier because of the expected difficulty or consequences of the task. A step-up may increase effort without changing model.

**Escalation**: Moving to the next agreed tier in response to substantive quality evidence encountered during execution. It may increase effort or change model; it does not renew allowance or widen authorisation.

**Ceiling**: A resource limit on usable tiers, distinct from a judgement that a task cannot be solved. A ceiling never weakens acceptance or verification requirements.

**Allowance**: A finite amount of work authorised for an execution. Recovery, revisions and discovered prerequisites share what remains rather than creating new allowance.
