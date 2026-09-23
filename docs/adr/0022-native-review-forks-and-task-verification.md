# 0022: Account for native review forks and task completion separately

Status: accepted (23 September 2026); implemented in reviewed candidate source,
native review-path acceptance pending. Recorded as accepted, implementation pending
before source edits; see the dated correction delivery for review and source pins.

## Context

The bounded Claude check at `4a1dd06` demonstrated the requested model and effort
bindings. It also showed that built-in review forks and delivers findings to the
lead. A wrapper cannot infer a verdict from a launch acknowledgement. The proposed
two-task verifier admitted valid partial repository states, while the host treated
every zero exit as task completion. See the coordinator audit dated 23 September.

## Decision

New Claude executions use an explicit fork-aware review contract. The bound review
wrapper invokes the unmodified built-in once; the host captures its distinct fork,
relays the verbatim findings to the same wrapper and accepts its structured verdict
only after the fork's completion and provenance have been recorded. Both native
identities, exact reviewed head and invocation evidence remain attributable.

Reserve two calls from the existing task pool before either review process starts.
Reserve their concurrent capacity together. Unused or interrupted reservations are
not refunded. Recovery must reconcile both processes; an unknown fork cannot be
discarded when a wrapper terminates. The actual wrapper and fork must each match
the resolved review model and reasoning effort. The built-in command level remains
xhigh; every supported maximum/recovery binding requires an appropriate native
definition and observation.

An optional, immutable verifier-report contract distinguishes repository validity
from individual task completion. One command still verifies every state. It emits
JSON with the verified commit and mode. Preparation pins allowed baseline modes and
each task's completion modes. The host checks the exact candidate before approval,
then the integrated state before recording completion. A supplementary final check
cannot replace either gate. All checks reserve the original verifier allowance.
Authorised rollback also needs explicit restoration modes; a task's ordinary
completion mode is not necessarily the result a valid revert should restore.

Prerequisite ordering is established by current satisfied outcomes, merge evidence
and dispatch history. Matching document hashes demonstrate content consistency only.

## Compatibility and consequences

This amends ADR 0021's native evidence boundary and implements ADRs 0018–0020's
existing authority, completion and accounting promises. Historical protocol 3 and
pinned protocol 4 executions keep their runtime and contracts. No source change
installs a candidate, renews a completed probe allowance or authorises a live pilot.

The extra review process and host candidate verification increase preparation's
minimum allowances. Runtime observations remain mandatory; fixtures cannot prove
native effort inheritance or successful same-child relay. A separately bounded
native check will test the corrected path before rollout launch.
