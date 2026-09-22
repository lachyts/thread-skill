# Shared routing and rollout corrections

Status: reviewed candidate sources implemented; native acceptance and activation pending. Authority: Lachy’s explicit implementation request, 2026-09-23, for the complete Shared model routing and rollout corrections plan.

## Agreed contract

Ordinary Claude work uses Opus 5.5: high for straightforward planning/implementation, xhigh for difficult or consequential work and independent review. Codex keeps native model selections with the same effort policy. First substantive quality failure jumps directly to supported maximum effort. A failed maximum-effort correction permits the configured alternative at maximum effort; unavailable Fable means bounded continued Opus work. No budget renewal, cross-harness child, weakened verification or invented observation.

## Work and ownership

| Task | Scope | Owner |
| --- | --- | --- |
| 1 | Shared versioned routing resolver, native adapter/schema and provenance support | shared routing worker |
| 2 | Thread engine policy states, prompts and focused engine tests | convergence worker |
| 3 | Agent Reader response-directory isolation and regression tests | lead |
| 4 | Durable host review receipts, authorisation/verifier binding, supplementary verification and accounting | lead |
| 5 | Canonical skill/agent/hook guidance migration, docs, acceptance matrix and independent review | lead with available workers |

## Interface agreement

New executions opt into `routingPolicy` (version 1) supplied as a fully resolved snapshot. It identifies harness, policy hash, normal and optional recovery native bindings with supported effort levels, starting effort and reviewer floor. Legacy executions without this field retain their previous contract. The shared resolver owns validation and normalisation; the convergence engine consumes the resolved snapshot and durable routing state. Host and adapter evidence remains outside child verdict schemas.

Native reviews need a coordinator-supplied receipt bound to request, native child, built-in engine, review level, reviewed head and native invocation evidence. Review-level selection and child reasoning effort remain distinct. Exact authorisation text/context and external verifier bytes join the preparation evidence. Supplementary verification reserves allowance before execution and uses durable idempotency keys; recovery does not refund interrupted work.

## Delivery boundary

Reviewed candidate source and documentation; no installation, release, new live rollout or modification of old pilot evidence. Native harness checks are prepared with finite terms and reported separately from fixtures. Existing verification/merge gates stay mandatory.

## Rulings

- Independent workers may run concurrently in separate repositories or disjoint owned files, per Lachy’s standing parallel-work instruction; shared interfaces are agreed first.
- No new model or effort claims are inferred from requested settings. Native observations may be unknown, but mandatory new-policy capability acceptance must then remain incomplete.
- Skill and Claude configuration changes are prepared in isolated source worktrees; activation remains a separate delivery step.


## Candidate source locations

- Thread: `/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill`, branch `codex/thread-rollout-redesign`.
- Shared policy/adapters/hooks: `/Users/lachlants/.codex/worktrees/thread-native-recovery`, branch `codex/thread-native-recovery`.
- Canonical skill sources: `/Users/lachlants/.codex/worktrees/shared-skill-routing`, branch `codex/shared-skill-routing`.
- Reader isolation: `/Users/lachlants/.codex/worktrees/reader-response-isolation`, branch `codex/reader-response-isolation`, reviewed commit `8e5072c`.

No source in the live skills/config checkouts has been activated. The guarded
profile/council migration plan identifies original file hashes without copying
secret settings. It must be checked again against live bytes before a later
activation. See [acceptance matrix and bounded native checks](2026-09-23-routing-acceptance.md)
and [host payload contract](../../skills/execute/routing-and-evidence.md).

New policy executions reject legacy tier/model/effort overrides rather than
silently reinterpret them. Resource ceilings use a prepared null recovery
binding and keep full review/maximum effort. Explicit authors use an exact
policy snapshot. Binding changes cannot mutate a pinned execution or renew its
allowance. This boundary is recorded in ADR 0021.


## Validation checkpoint

- Engine: 87 tests with the real shared resolver (39 routing and 48 safety), plus passing prompt invariants.
- Host/domain: 79 tests, including duplicate results, stale evidence, queued merges, actual local process death and supplementary reservation recovery.
- Integrated engine/adapter/pinned host: 10 fixtures, zero skipped, with both harness identities; no live child or GitHub claims. Includes typed recovery-model launch refusal, exact replay, bounded fallback and last-round exhaustion.
- Continuation: 21 protocol 4 driver tests and the protocol 3/mixed-marker suite pass.
- Shared core: 60 JavaScript tests; inference/alias/draft/caller/migration Python suite 60 tests; 35 allocation/capacity checks.
- Canonical skills: 4 source contract checks. These do not replace live behavioural evaluations.
- Reader: 3 simultaneous-hook/default-layout tests, all-module override checks, 5 migration lifecycle tests and cache regressions pass. Independent native review returned no findings; commit 8e5072c.

The shared-core reviewer reproduced two defects (exact-author maximum below
review floor; Python's redundant exact-author requirement). Both were fixed,
regression-tested and rechecked with no findings. The final native source review
found no remaining issues in Thread, shared adapters/migration or canonical
skills. See the [Thread review record](../reviews/2026-09-23-routing-and-evidence.md)
and the shared/skills repositories' review records. The reviewer was reused
after the native thread limit prevented a fresh spawn; it had no author context
for this work but retained unrelated review history. Actual effort was not
independently observable. No fixture or source review has been relabelled as
native effective-effort or live rollout evidence.
