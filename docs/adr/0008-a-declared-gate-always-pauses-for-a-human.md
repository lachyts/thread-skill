# A declared gate always pauses for a human, even in continuous mode

Every implementer plan must carry a **Gated inputs** section declaring any human authorisation the
task will need — API spend with a cap, credentials, or an irreversible action — or an explicit
"None". A non-empty declaration always stops that task at the plan-gate for human sign-off,
**regardless of `plan_approval` config or continuous mode**. Approval is written durably into the
task note (the gate, the cap, the sign-off), so re-dispatches and resumes never re-ask. A light
schedule-time sweep complements it: tasks whose notes smell of spend get `plan_approval` forced on,
but the authoritative declaration is the plan's — only the implementer's plan reliably knows the task
needs $30 of Replicate credits.

Decided in the 2026-07-18 grill from the capture "check if there are any gated user inputs … and
approve them as part of the plan before the wave starts the execution". The reactive concept already
existed (input-gated block: the run hits a wall and waits); this makes it predictive without
weakening zero-touch autonomy where autonomy is safe.

## Considered Options

- **Schedule-time detection only** — regex the task notes at planning, approve everything up front in
  the rollout note, engine never pauses. Rejected: detection is guessy, and a gate the implementer
  discovers later still blocks — the feature would promise pre-approval it can't keep.
- **Plan-gate riding `plan_approval`** — gates surface in plans but auto-approve when
  `plan_approval: false`. Rejected: continuous mode could spend money without a human ever seeing a
  number. The whole point of the gate taxonomy is that spend/credentials/irreversibles are decisions
  no agent may make (the same line the harness itself draws).
- **Plan-gate with an unconditional human stop (chosen)** — continuous mode stays zero-touch for
  every task that declares "None", and pauses for exactly the tasks where zero-touch would mean
  unsupervised spending. The trade is a rare, legible interruption in exchange for a hard safety
  property.

## Consequences

- Continuous mode is no longer unconditionally zero-touch: a rollout containing a gated task pauses
  at that task's plan-gate. This is the designed behaviour, not a regression — surface it in the
  dispatch summary so the pause is expected.
- The plan prompt template gains a required section; a plan without it (or with an undeclared gate
  discovered mid-implementation) is a plan-judge `changes`, which on an opus task also triggers
  escalation (ADR 0006).
- Approved gates in the task note become part of the durable contract: `/thread:repair` treats a task
  blocked on an *undeclared* gate as input-gated, and a task re-blocked on an *approved* gate as
  agent-fixable evidence that the implementation ignored its contract.
- The cap in a spend gate is a ceiling the implementer must respect, not a target; blowing it is a
  verifier/review failure, not a re-ask.
