# 0021 — Shared effort-first routing

Date: 2026-09-23
Status: accepted, implementation pending

Adopt the shared native model-routing policy, recorded in the workspaces repository’s [ADR 0008](/Users/lachlants/.codex/worktrees/thread-native-recovery/_shared/docs/adr/0008-effort-first-native-model-routing.md), for new executions. Normal effort, maximum effort and alternative-model recovery are distinct states. Difficulty informs the starting effort; substantive quality failure triggers maximum effort before alternative-model recovery. An alternative is not presumed universally superior.

This amends [0006](0006-one-shot-first-pass-iteration-escalates-to-fable.md), [0007](0007-a-tier-is-a-model-plus-effort-bundle.md) and [0016](0016-a-tier-ceiling-caps-escalation-when-quota-is-gone.md) for the new policy contract only. Preserve their historical rules for pinned executions. Model names are bindings, not convergence state. Native effort must be supported and checked, and the execution records requested, resolved and observed settings separately.

The convergence engine retains merge authority. Escalation inherits work, accumulated feedback and remaining allowance; it creates no new budget. At an unavailable recovery route the current model remains terminal and runs bounded corrective work at maximum effort. Resource or authority failures are not evidence of insufficient reasoning. Neither review requirements nor acceptance criteria weaken.

The shared policy owns concrete model and effort defaults. The glossary remains conceptual. This is an accepted target, not a claim that the current runtime already implements it.


Implementation note, 23 September: source candidate implements this opt-in
protocol 4 contract. Policy bindings remain immutable during an execution;
legacy ad hoc substitution/effort/tier knobs are rejected. Prepare an exact
model snapshot for requested authors or a null recovery binding for a resource
ceiling. This makes the compatibility boundary explicit before activation.
Live native acceptance, installation and release remain pending.
