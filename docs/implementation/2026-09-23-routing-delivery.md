# Shared routing and rollout corrections: delivered sources

23 September 2026. The requested correction batch is implemented, independently
reviewed and committed in isolated source branches. Installation, release and
new live rollouts remain separate. The active Claude settings, installed skills
and historical protocol 3/4 execution records were not changed.

## Candidate commits

| Repository / candidate branch | Source commit | Scope |
| --- | --- | --- |
| Thread: `codex/thread-rollout-redesign` | `aa184cd56fca8176b28f873f93bc6d435d5c4210` | Pinned effort-first convergence, durable review evidence, authorisation/verifier binding, idempotent supplementary checks and bounded fallback |
| Shared workspaces: `codex/thread-native-recovery` | `ac028d47aeb7844b8c18cd0156acc5c3a7ebb749` | Versioned policy, native adapters/helper handoff, typed unavailability, allocation hook and guarded profile/council migration plan |
| Canonical skill sources: `codex/shared-skill-routing` | `7273ac93833cd4d895534e45e37bead16fb6a834` | Common routing, council, fresh-review, doc-audit and review guidance |
| Agent Reader: `codex/reader-response-isolation` | `8e5072c52ae69b7f19c2b7ec771305f258c3f887` | Test-directory isolation for canonical response text/log and hermetic regressions |

Accepted decisions are recorded separately in shared commit `09faba3` (ADR0008)
and Thread commit `dada0a8` (ADR0021, glossary and historical amendments). They
were recorded as accepted, implementation pending before runtime edits.
Documentation retains the distinction between implemented candidate source and
pending activation/native acceptance. This delivery document is a later
documentation-only commit; the source identities above remain the tested ones.

Candidate worktrees and integration contract are in the
[implementation record](2026-09-23-routing-and-corrections.md).

## Implemented behaviour

One shared policy selects easy/high or difficult/xhigh work and an independent
review floor of xhigh. Quality failure moves directly to the current model's
supported maximum; a failed maximum correction permits the prepared native
alternative. A proven unavailable recovery route returns to the original model
at maximum within the existing allowance. Generic quota/permission/timeout
failures do not count as reasoning failures. Explicit authors remain exact.

Executions pin the policy, resolver and runtime. Requested, resolved and observed
settings stay distinct. Successful new-policy results require matching native
observations; unknown actual effort cannot be represented as success. The
host records built-in review evidence for the exact child and commit. Schema
correction stays with the same child. Native launch refusals preserve spent
claims without inventing a child, and repeated evidence cannot create extra
work or verification.

The guarded profile/council plan addresses the conflicting Claude effort pins
without editing live settings. Its source hashes must still match before a
later activation. The preparation and request contracts are documented in
[routing and evidence](../../skills/execute/routing-and-evidence.md).

## Validation and review

| Check | Result |
| --- | --- |
| Thread host and domain | 79 passing tests |
| Engine routing and existing safety | 87 passing tests using the real shared resolver |
| Prompt compatibility | 191 passing checks |
| Engine, shared adapter and pinned host integration | 10 passing fixtures, zero skipped |
| Shared JavaScript / Python | 60 passing tests each |
| Allocation/capacity hook / canonical guidance | 35 / 4 passing checks |
| Reader | Three isolation tests, hermetic override checks, five migration lifecycle tests and cache regressions passing |
| Source hygiene | Syntax, example JSON and whitespace checks passing |

Independent native review found no remaining issues after corrections. Records:
[Thread](../reviews/2026-09-23-routing-and-evidence.md),
[shared core](/Users/lachlants/.codex/worktrees/thread-native-recovery/docs/reviews/2026-09-23-native-routing-core.md),
[migration](/Users/lachlants/.codex/worktrees/thread-native-recovery/docs/reviews/2026-09-23-native-routing-migration.md),
[skills](/Users/lachlants/.codex/worktrees/shared-skill-routing/docs/reviews/2026-09-23-shared-model-routing.md),
[Reader](/Users/lachlants/.codex/worktrees/reader-response-isolation/docs/reviews/2026-09-23-reader-isolation.md).

Fresh reviewer creation hit the native thread limit. The reused reviewer had no
author conversation for these changes but retained unrelated prior review
history. Actual reasoning effort was not independently observable. Review and
fixture results are source evidence, not native provider/effort acceptance.

## Prepared next boundary

The [acceptance matrix](2026-09-23-routing-acceptance.md) separates every fixture
claim from live evidence. It contains bounded native checks for both harnesses,
including actual effort and built-in review evidence, followed by separately
prepared tiny unattended rollouts. These checks have not been launched. Profile
activation must be checked through native observation; requested settings alone
are insufficient. Existing pilots and their allowances remain untouched.
