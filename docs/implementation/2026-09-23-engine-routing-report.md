# Engine routing implementation evidence

Date: 2026-09-23. Scope: the convergence engine, its focused tests, and lead-assigned host integration fixtures. No live model was launched, no pilot was resumed, and no installation or global configuration was changed.

## Behaviour

New `routingPolicy` runs use the shared, pinned `normaliseRoutingPolicy` and `resolveRouting` functions injected by the native adapter. The engine contains no second model policy. Missing helpers, incompatible policy/state, or a native profile that conflicts with a reachable routing stage fail before any child dispatch.

Work starts at high/easy or xhigh/hard effort. Cross-cutting and plan-gated tasks default to hard; an explicit `task.difficulty` takes precedence, and otherwise the snapshot supplies the starting difficulty. Plan and code reviewers use the review floor. First substantive quality failure selects the same model's supported maximum effort; a failed maximum-effort correction permits the configured alternative at its supported maximum. An unavailable alternative continues the normal model at maximum under the same bounds. An exact-model policy retains that author. Native supported maxima are selected by the resolver; the engine does not assume the label `max` exists.

Runtime unavailability is separate from absent preflight capability. Only a native adapter exception carrying validated `modelUnavailable: {model, evidence}` for the currently selected recovery binding enables fallback. The engine records that pair as `routingState.recoveryUnavailable`, resolves `maximum-unavailable` through the shared resolver, and keeps the quality-failure count unchanged. Generic quota, permission, infrastructure or ambiguous-launch errors still block. No diagnosis substring or child verdict can establish unavailability.

A refused recovery launch consumes its existing candidate/round and reservation. Fallback uses only the next existing slot; at the ceiling the task blocks with the durable flag and no extra request. A refused reviewer uses the next review round against the already verified work; a refused plan judge retains the produced plan. Restart and a later explicit retry/resume preserve the unavailable flag and cumulative pool spend. Three candidate slots therefore do not promise an additional fourth candidate when the recovery launch itself is refused.

Implementation/planner results gain optional `failureKind` only under the new policy: `quality`, `infrastructure`, `authority`, `quota`, or `schema`. Generic blocks, malformed results, native resource failures, missing gates and absent/stale commit evidence do not move routing. An explicit verifier-red signal or a substantive judge rejection can move it. Review verdict schemas remain unchanged. Resource failures are never reinterpreted using diagnosis substrings.

Each new-policy implementation candidate gets one verifier run and consumes one of `maxIterations`. A review correction consumes the next existing review round and one verifier candidate. A correction that fails verification consumes that round without a judge; a later existing round can use the resulting route. Final-round failure records the next routing state without dispatching more work. Plan candidates similarly consume `maxPlanRounds`. No route change or native delivery failure renews an allowance.

Partial work, PR identity, branch, worktree, plan feedback and review history survive blocked corrections, including native boundary exceptions after an earlier quality failure. A later attempt receives durable failure feedback as evidence and anti-regression constraints, never as authority.

## Host and adapter interface

Both `routingPolicy` and `evidenceContractVersion: 1` require explicit `protocolVersion: 4`. Unflagged protocol 3 and pinned protocol 4 retain the legacy route, effort matrix, schemas and prompt fragments.

New-policy arguments reject legacy `maxTier`, `judgeModel`, `model` and `effort`, plus task-level `model`/`effort`, rather than silently ignoring them. Prepare `recovery: null` in the snapshot for an unavailable alternative, or use an exact native policy binding to preserve explicit author intent. The host omits legacy defaults for policy executions and rejects explicit conflicting controls during preparation.

The host supplies `args.harness` for evidence-contract runs without routing. With routing, the policy supplies the harness. Code-review children must invoke Claude's actual native `/code-review xhigh` or Codex's bundled `review-agent` in an independent native child. Review level and reasoning effort are separate. A coordinator receipt with real native invocation evidence remains outside the child's unchanged verdict and binds the request, actual child, engine, review level and inspected commit. The host owns receipt verification; prompt text alone is not evidence.

Every routed native request includes concrete `model`, `effort`, and:

```json
{
  "routing": {
    "role": "work",
    "difficulty": "easy",
    "qualityFailures": 1,
    "exactModel": false
  }
}
```

Code-review requests additionally carry `reviewContract` with engine `claude-code-review` or `codex-review-agent`, level `xhigh`, and the verified commit as `reviewedHead`. This is a requested contract, not observed execution evidence.

Each result adds:

- `routingState`: `{version:1, policyDigest, qualityFailures, stage, lastFailure?, recoveryUnavailable?}`. Stages are `normal`, `maximum`, `recovery`, or `maximum-unavailable`. `lastFailure`, when present, has `{layer:"plan"|"implement"|"review", kind:"quality", feedback:[string]}`. `recoveryUnavailable`, when present, is `{model,evidence}` for the prepared recovery binding and requires at least two substantive quality failures. The host seeds the next authorised attempt with this state and forbids removal/change of an established unavailable flag. State compatibility is checked against the pinned resolver.
- `requestedProfile`: the last dispatched work request's resolved `{harness, model, effort, policyDigest, route}`. This field makes no observation claim; native adapter provenance is authoritative for effective settings.
- `verifierCandidatesUsed`: implementation and review-correction candidates dispatched during this attempt. Plan baseline costs remain separately identifiable by plan requests/rounds.
- `planHistory`: accumulated `{round, feedback}` entries, alongside the existing review history.

The result's `model` is the last dispatched work model, never an unexecuted recommendation. Routing state can advance at a ceiling while that model remains unchanged.

For a proven launch refusal before any child exists, the host invokes `recordUnavailable(directory, taskId, requestId, claimToken, proof, owner)` with `{model,evidence,source:"native-launch",neverStarted:true}`. The adapter requires a claimed, unbound recovery request, preserves its spent claim and creates no child identity. An identical proof is idempotent; a conflicting proof is rejected. A bound child instead requires the adapter's attested terminal-result path. Unknown child status remains a recovery problem, never a fabricated refusal.

## Reservation arithmetic

New-policy implement/investigate request labels use `@<stage> cN`; each implementation candidate costs one verifier reservation. `revise:… rN` costs one verifier reservation. Conservatively reserve one baseline verifier for each plan/plan-revise candidate (plan revisions can investigate without rerunning it). Native calls cost one call each. No new-policy automatic dead-child respawn occurs.

To admit one full correction ladder wherever the first failures arise, followed by an independent approving review, reserve at least six native calls and three child verifier candidates for a leaf task. A plan-gated task adds two plan calls and one baseline verifier, giving eight calls and four child verifiers. Add the host's actual integration/postmerge verifier allowance separately.

To provision all configured engine ceilings conservatively, let `P = maxPlanRounds` for a plan-gated task, otherwise zero; `I = maxIterations`; `R = maxReviewRounds`; and `H` be host verifier runs. Reserve `2P + I + 2R - 1` calls and `P + I + R - 1 + H` verifier runs. This is capacity arithmetic, not permission to add work beyond a ceiling.

## Tests and limits

TDD witnesses: the initial 18-case suite failed 17 new routing cases while its legacy control passed. Further regressions witnessed failures for retained retry feedback, a failed maximum-effort review correction, protocol/schema boundaries, discovering a conflicting native profile only after partial work, a thrown native quota boundary losing durable routing, automatic difficulty and silently ignored legacy controls. The runtime-refusal additions witnessed five failing fallback/restart cases and a malformed early-unavailability seed before correction. Each was corrected and rerun.

Final verification:

- `NATIVE_ROUTING_MODULE=/Users/lachlants/.codex/worktrees/thread-native-recovery/_shared/scripts/native_routing.mjs node --test skills/execute/tests/engine-routing.test.mjs skills/execute/tests/engine-safety.test.mjs`: **87 passed, 0 failed** (39 routing, 48 existing safety).
- `node skills/execute/tests/prompt-invariants.test.mjs`: **191 checks, ALL PASS**, including legacy prompt byte-identity, tier ceilings, effort bundles and dead-child behaviour.
- `THREAD_TEST_NATIVE_ADAPTER=/Users/lachlants/.codex/worktrees/thread-native-recovery/_shared/scripts/native_workflow.mjs node --test skills/execute/tests/rollout-integration.test.mjs`: **10 passed, 0 failed, 0 skipped**. The actual engine, shared resolver/adapter, pinned host and local Git fixture cover Claude easy and Codex hard routing, observed-provenance enforcement, built-in review receipts, exact authorisation bytes, external verifier drift, ownership recovery, identical delivery, durable routing after quota block, minimum allowance rejection and rejected legacy controls. Runtime launch-refusal cases cover both a three-candidate ceiling followed by explicit retry/resume and a fourth existing fallback slot, including proof replay/conflict, no fabricated child, unchanged quality count, retained spend, restart, ready-to-merge and merge. The three pre-existing integration cases remain passing.
- `git diff --check`: passed.

The full plan-gated review ladder fixture spends eight native calls and four child verifier reservations, then one combined postmerge integration verification. The host's admission floor also retains one spare verification slot and, when authorised, rollback capacity; unused capacity is not reported as spent. Its three review receipts and all native model/effort observations are explicitly synthetic fixture evidence.

The routing test replaces only the native agent boundary and runs the actual workflow source. Its default mode uses a deterministic resolver fixture so repository-only checks remain runnable; `NATIVE_ROUTING_MODULE` exercises the real shared resolver and policy digest, as above. Synthetic capability strings, child replies and invocation-contract assertions are test fixtures, not evidence that any live harness ran a model or built-in review. Independent native source review is complete with no remaining findings; its scope and limitations are in the [review record](../reviews/2026-09-23-routing-and-evidence.md).
