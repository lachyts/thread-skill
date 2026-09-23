# Claude review and task acceptance correction

Authority: Lachy's request to execute the next steps after the coordinator audit,
23 September 2026. Scope: reviewed source and preparation corrections, focused local
tests, independent native Codex source review, and preparation of a bounded native
Claude check. No installation, publication, rollout initialisation or merge.

Decision: ADR 0022, accepted before runtime edits. Existing evidence packets and
their exhausted five-probe allowances remain immutable.

## Work

- Shared adapter worker: durable review fork binding, result, provenance and recovery.
- Engine worker: fork-aware prompts and all resolved review routes; verifier-mode prompts.
- Coordinator: cumulative host reservations, receipt binding, candidate and integrated
  task acceptance, verifier preparation, docs and delivery.
- Independent existing coordinator reviewer: native built-in source review and fix recheck.

## Interface rulings

- Opt-in `reviewContract.protocol: claude-fork-v1`; two calls from the existing pool,
  two conservatively reserved concurrency slots. No second spending counter.
- `bindReviewFork` records the actual fork/invocation; `recordReviewFork` records
  terminal evidence, verbatim findings and observed routing. A completed fork is
  required before accepting a successful wrapper result. Recovery includes fork
  status evidence; uncertainty remains a hold.
- `repository.verifierContract: {version:1,baselineModes:[...],rollbackModes?:[...]}` and per-task
  `verifierModes:[...]` pin allowed JSON `{mode,head}` reports. A host candidate
  check uses the existing reserved/idempotent supplementary operation machinery;
  integrated verification also enforces that task's modes. The command never changes.
  Explicit restoration modes are required when automatic reverts are authorised.
- Extra minimum preparation headroom covers fork calls and host candidate checks.
  Exhaustion blocks; it never grants an extra correction.

## Verification

Test-first regressions for wrong/missing/stale fork identities and heads, duplicate
results, mismatched observed bindings, ambiguous or stopped-owner recovery, spent
allowances and capacity; exit-zero partial/malformed reports must not approve or
complete a task. Preserve no-contract/old-runtime behaviour. Exercise a versioned
two-task verifier locally, including missing B, stale digest, symlink and empty
non-base commit. Record native evidence separately from all fixtures.

## Delivery and limits

The reviewed implementation reserves two calls/slots for each new policy-routed
Claude review. Native wrapper/fork identities, exact head, observed bindings and
verbatim findings survive replay and recovery. Recovery prevalidation rejects
missing fork evidence before creating a transfer intent. The host rejects an
exit-zero report with the wrong task mode before approval and after integration;
its candidate check is reserved and idempotent in the original pool.

Independent source review used the unmodified native Codex `review-agent` through
the existing coordinator reviewer. The reviewer retained unrelated earlier review
history, but did not see the author conversation for this work. Actual reviewer
effort was not independently observable. Runtime findings were corrected and
rechecked; the final two stale accounting assertions were corrected and passed.
See the [review record](../reviews/2026-09-23-claude-review-correction.md).

The [versioned verifier packet](../preparations/2026-09-23-claude-routing-v2/README.md)
spent exactly twelve deterministic verifier invocations, all matching expectations,
and passed six in-process content checks. Independent review checked all saved
hashes and case snapshots without rerunning the exhausted allowance. Its tested
bytes remain unchanged. It verifies document content, not native behaviour.

The [corrected pilot proposal](2026-09-23-claude-routing-pilot-proposal-v2.md)
uses pinned per-task modes, actual dependency/merge chronology and one cumulative
pool including every fork. The [new native handoff](../handoffs/2026-09-23-claude-review-path-check.md)
prepares three sequential wrapper/fork pairs, six attempted children maximum,
to check xhigh, maximum and recovery review routes. No native child has run under
that new scope. Project-local definitions are prepared before a fresh native
Claude session starts; startup loading and actual fork effort remain unproved.

Source pins and final local check results are recorded below. The
private check directory's `preparation.json` binds those pins and exact definition
hashes. Preparing that directory does not initialise a rollout or spend native
slots. Installation, release and the two-task live pilot remain separate.

## Local validation

| Check | Result | Evidence type |
| --- | --- | --- |
| Current host and state regression suites | 86/86 pass | Local fixtures, final full run |
| Engine routing and safety | 95/95 pass | Local fixtures |
| Prompt invariants | 191 checks pass | Local source/fixture checks |
| Actual shared-adapter integration | 12/12 cases pass, including two final corrected assertion rechecks | Synthetic native envelopes, no native children |
| Shared JavaScript suites | 74/74 pass | Local fixtures |
| New pilot verifier | 12/12 cases match expectations; allowance exhausted | Saved deterministic subprocess evidence |
| Verifier content classifier | 6/6 pass | In-process fixtures |
| Source and preparation review | No outstanding findings | Independent unmodified native Codex review |
| Corrected Claude wrapper/fork check | Prepared, not run | Native evidence pending |

The final host/state log is private at
`.thread/claude-review-correction-host-tests.tap`. Independent reviewer checks
are detailed in the review record. Syntax, whitespace and all declared verifier
artifact hashes were checked before commit. No model or pilot-verifier call was
made to perform the final hash checks.

## Pinned source and prepared entry point

| Candidate | Reviewed commit |
| --- | --- |
| Thread runtime, tests, verifier and preparation templates | `db18cb467172861fa8d626b318561d724dcf0a2a` |
| Shared native adapter and recovery | `214aee11a52fe6d1d20759681db4cb664ffe2b29` |
| Skill guidance, unchanged | `7273ac93833cd4d895534e45e37bead16fb6a834` |
| Agent Reader isolation, unchanged | `8e5072c52ae69b7f19c2b7ec771305f258c3f887` |

The fresh native Claude session starts in:

```text
/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/.thread/claude-review-path-check-2026-09-23
```

Twelve source/definition files have been copied byte-for-byte from those commits
and hash-checked. The private manifest `preparation.json` has SHA-256
`1a63a4f1ee8dcf53c63f1aa09a28459ee1584c80ec281e282b70713451c9a62b`.
The private spending ledger has zero reservations and zero native attempts.
There is no exchange or rollout record. Its empty local Git root establishes
the intended project scope for startup loading; it publishes nothing.

Read `START-HERE.md` there and execute the linked handoff in native Claude.
Codex has prepared this check but has no exposed native Claude session launcher;
starting a foreign CLI model process would violate the agreed harness boundary.
Actual project-definition loading, maximum-effort fork inheritance and faithful
same-wrapper relay remain the next native evidence to collect. No repeated old
probe, pilot-verifier invocation, global profile change or live rollout was made.
