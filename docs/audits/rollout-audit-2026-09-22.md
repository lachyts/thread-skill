# Thread rollout audit — 2026-09-22

Baseline: `2063f818800b7a3d905e4af0051d01806baf3536` (2.5.1). Scope: rollout execution, recovery, documentation and Codex integration. Native independent code review and independent refutation of documentation candidates; no external merges or model CLI children were used. Existing engine, reconciliation, stop-driver and shared adapter suites passed, demonstrating gaps in their coverage rather than absence of defects.

| Priority | Finding | Baseline evidence | Remedy |
| --- | --- | --- | --- |
| P1 | Invalid budgets can bypass planning approval or return no tasks | workflow:954 and argument dispatch | Strict positive integer validation before dispatch |
| P1 | Successful merge command can mean queued, not merged | merger:285 | Observe matching actual merged state before completion/deletion |
| P1 | Foreign PR URL reduced to a local number | merger:355 | Validate repository and URL identity before mutation |
| P1 | False verification with a PR reaches approval | workflow:1071,1130 | Enforce verified result before review eligibility |
| P2 | Blocked/gated outcomes lose existing PR | reconcile:525 | Preserve PR evidence on every result |
| P2 | Later attempt feedback suppressed by same heading | reconcile:558 | Attempt-aware ordered evidence, duplicate replay idempotent |
| P2 | Quoted YAML status becomes dispatchable | reconcile:704 | Decode scalar status before comparison |
| P2 | Optional failed check blocks zero-required-check repository | merger:252 | Distinguish absent required checks from pending required checks |
| P2 | Stale result reopens completed task | reconcile:503 | Terminal protection and ordered attempt identity |
| P2 | Resource ceiling provenance lost in status and later failures | reconcile:520,760 | Preserve evidence and expose it to repair |
| P2 | Base hardcoded to main | workflow:720, merger refresh | Resolve intended branch explicitly |
| P2 | Planning and implementation inspect different bases | workflow:499 | Pin the same fresh base snapshot |

## Documentation findings surviving independent refutation

- ADR 0016's cap provenance was absent from the status projection. This loses triage information; it does not prove every capped task is always misclassified.
- ADR 0006's first-rejection escalation guarantee conflicts with a one-round ceiling. Honour the ceiling, record the recommended next tier, and distinguish that from a stronger tier actually executed.
- Execute said read-only findings had master review, but the engine returns before that judge. Describe that legacy path honestly; do not imply a review occurred.

The alleged repair-input/gate contradiction conflated ordinary input blocks with explicit authorisation gates and was refuted. Scheduling heuristics alone did not prove a contradiction; the separately recorded package-initialisation overlap incident remains a real scheduling constraint. The Codex detached lifecycle gap was already documented honestly and is an implementation gap, not documentation drift. No confirmed missing documentation references were found within this rollout scope.

## Order

Record the domain model and authority decisions first; fix the safety defects before depending on unattended execution; build durable task readiness and native ownership recovery; then demonstrate real unattended acceptance in each harness. Keep the current bounded tier policy. Defer the longer effort ladder and unrelated continuity backlog. Do not use a weakened version of the engine to certify its own safety.

Implementation and acceptance evidence: [progress](../implementation/rollout-redesign-progress.md), [specification](../implementation/rollout-v4.md).
