# Preparation delegates decisions within rollout authorisation

Status: accepted, implementation pending
Date: 2026-09-22

Preparation establishes outcomes, acceptance checks, consequential trade-offs, constraints and permitted actions. Execution may choose and revise its approach inside that authorisation without asking routine questions: unattended progress requires delegated judgement rather than an exhaustive prewritten implementation. Significant choices are recorded and independently reviewed; ordinary uncertainty does not become a reserved decision.

Missing authority blocks the affected task and its dependent closure while independent work continues. Preparation must explicitly cover merge-triggered deployment or publication before launch. A newly discovered effect or changed target outside that authority is not implicitly approved, and agents must never purchase resources, change accounts or bypass protection to keep moving.

This amends [ADR 0008](0008-a-declared-gate-always-pauses-for-a-human.md) and [ADR 0013](0013-only-list-items-declare-gates-prose-is-commentary.md) for the new contract: approval may already exist in rollout authorisation, and the execution record owns its evidence rather than task-note sign-offs. Exact gate declarations still need a recorded mapping to the authority that covers the action and limits; absent or ambiguous authority never means approval. Protocol 3 retains its original note-based contract.

## Consequences

The user agrees outcomes and boundaries interactively, then agents plan details, assess changes and merge approved results autonomously. A run that needs new authority reports the blocked scope without waiting indefinitely for a conversation. The rejected alternative, asking about every implementation uncertainty, defeats overnight operation and obscures the genuinely reserved choices.
