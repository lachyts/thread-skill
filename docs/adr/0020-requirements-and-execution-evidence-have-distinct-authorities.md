# Task requirements and execution evidence have distinct authorities

Status: accepted, implementation pending
Date: 2026-09-22

Obsidian owns task requirements; a durable project execution record owns attempts, adopted revisions, approvals, resource use, ownership and verification/merge evidence. Notes reflect progress and link to that evidence. Separating intent from operational history allows recovery without trusting a mutable status stamp as proof of completion.

Requirement edits can be adopted autonomously when assessed to remain inside rollout authorisation. Adoption requires re-planning and revalidation and invalidates stale approvals and completion; an edit never expands permission. The assessed revision is retained so a worker's evidence can be tied to the requirements it actually received.

Allowances belong to an execution. Revisions, newly discovered prerequisites, model substitutions, restarts, recovery, ownership transfer and ordinary pause/resume cannot replenish them. Prerequisite work shares its originating task's remaining allowance. After an execution ends, an explicit relaunch grants new bounded allowances only to requested unfinished scope, preserving all earlier usage and outcomes. This qualifies automatic retry guidance in [ADR 0004](0004-repair-is-a-conductor-not-an-engine.md) and [ADR 0016](0016-a-tier-ceiling-caps-escalation-when-quota-is-gone.md): resource availability is necessary but cannot renew an exhausted allowance.

A task-note edit is not an approval record, and a restarted session is not a new execution. The additional durable bookkeeping is accepted in exchange for auditable unattended recovery and honest resource limits. Protocol 3 records are never silently reinterpreted as this contract.
