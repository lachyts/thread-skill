# Rollout compatibility and release gate

| Contract | Behaviour | Availability |
| --- | --- | --- |
| Protocol 3 | Ordered wave barriers, note approvals, legacy cursor, original lifecycle | Existing supported contract; new invocations receive safety fixes. Never change live engine bytes/arguments. |
| Protocol 4 | Per-task readiness, project execution evidence, cumulative allowances, pinned native attempts | Development pilot, explicit preparation required. Deterministic tests are not live unattended acceptance. |

The standalone canonical skills remain pointers to this repository. There is one convergence engine and one merger, with native child exchange for the calling harness/account. An installed old native adapter without explicit ownership recovery cannot satisfy protocol 4 preflight.

## Promotion checklist

- Domain scenario and native exchange regression suites pass.
- Native independent review findings resolved.
- Real Codex unattended run, automatic merges and recovery recorded.
- Real Claude unattended run, automatic merges and recovery recorded.
- Observe pause, ambiguous-child recovery, queued merge and changed-head handling without duplicate side effects.
- Pin all implementation files and record hashes in executions. Active protocol 3 invocations keep their old cached version; new source cannot be replayed against old caches.
- Bump both plugin manifests together for release, then verify installed cache hashes against that version. Same-version edits do not refresh version-keyed caches.

**Current release status:** not promoted. This development branch does not modify the installed plugin or live rollouts. Live acceptance in both harnesses remains a required gate, not an assumption based on fixtures. See [progress](rollout-redesign-progress.md) for actual implementation/test evidence.
