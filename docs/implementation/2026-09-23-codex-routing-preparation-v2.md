# Codex pilot preparation correction, version 2

23 September 2026. This correction responds to the independent proposal review
relayed by coordinator task 1. It does not reopen the completed five-probe
capability allowance. **The original two-task pilot is not ready to launch.**
A supported one-task alternative delivers both required documents together;
the [revised proposal](2026-09-23-codex-routing-pilot-proposal.md) explicitly
records the lost two-task dependency-release coverage.

## Findings and disposition

| Finding | Source confirmation | Correction |
| --- | --- | --- |
| P1: original baseline fails before task A | Pinned baseline `89a7ff1` contains neither document; local invocation of the original verifier exited 1 with `no pilot document present`. Host initialisation requires exit 0 at baseline. | New verifier recognises only the exact clean, document-free seed commit as baseline. Every other commit requires both complete document contracts. |
| P2: per-task and supplementary `--require` commands are unsupported | `engineTask` forwards no task verifier; `verifyTask` reserves/replays the fixed repository command using operation ID, commit and purpose. The underlying process receives no task/purpose selector. | Removed all task-specific verifier invocations. One fixed command is used for baseline, implementation, integration and the reserved final operation. No runtime changes. |

The original split cannot both accept a work-only intermediate commit and reject
that same state as an incomplete final result through the unchanged verifier
alone. The one-task alternative rejects that intermediate outcome everywhere
outside the exact baseline. This is an explicit scope reduction, not evidence
that the original two-task requirement was fulfilled. If two independent tasks
remain mandatory, the proposal remains blocked on that constraint.

## Exact candidate

- Path: [pilot-verify-v2.py](../preparations/2026-09-23-codex-routing-v2/pilot-verify-v2.py)
- Absolute external verifier input:
  `/Users/lachlants/.codex/worktrees/5c5a/thread-skill/docs/preparations/2026-09-23-codex-routing-v2/pilot-verify-v2.py`
- SHA-256: `70535c8ac06464741a773df5f8fe1acfd63cecaaa58114db225e8fa12f2c535f`
- Immutable baseline: `89a7ff1d409554f5442b548c967408f24bfa27a4`
- Mechanical outcome: both named Markdown files, with all required factual
  contract lines and the immutable capability-report source reference.
- Final verification: existing `verifyTask` with operation ID
  `codex-routing-pilot-final-documents-v2`, the actual integrated merge commit
  and the exact purpose in the proposal; same configured command, one reserved
  call, idempotent exact replay. Require output mode `documents` and matching
  commit. No final-stage flag or additional command is assumed.

The external verifier uses Python standard library and local Git only. Its
baseline success is explicit validation of the pinned clean pre-work state, not
a claim that either future task outcome already exists. A later commit with the
same empty tree fails. Both final documents remain required on every changed
candidate and integrated commit. Native independent review remains responsible
for semantic correctness of explanatory prose; exact-line checks do not prove
the absence of contradictory prose.

## Ten deterministic invocations

Each invocation was reserved in the new ledger before execution. Exactly ten
were used, including reproduction of the original defect; no retries remain.
The setup used private local Git clones, ordinary fixture commits and no merges.
All verifier working directories were clean at invocation. These are local
verifier cases, not host-initialised rollouts or claims of live idempotency.

| # | Case | Expected / actual exit | Result |
| --- | --- | --- | --- |
| 1 | Original verifier, exact pinned baseline | 1 / 1 | P1 reproduced |
| 2 | Version 2, exact pinned baseline | 0 / 0 | `mode: baseline` |
| 3 | Descendant commit with unchanged empty document tree | 1 / 1 | No baseline exemption |
| 4 | Work document only | 1 / 1 | Missing review outcome rejected |
| 5 | Review document only | 1 / 1 | Missing work outcome rejected |
| 6 | Both complete documents | 0 / 0 | `mode: documents` |
| 7 | Missing work provenance clause | 1 / 1 | Incomplete contract rejected |
| 8 | Missing review evidence clause | 1 / 1 | Incomplete contract rejected |
| 9 | Review document deleted after a complete commit | 1 / 1 | Regression rejected |
| 10 | Later complete commit, unchanged verifier command | 0 / 0 | Final strict mode demonstrated locally |

The exact cases, working directories, candidate heads, commands, outputs and
verifier hashes are in [the new results index](2026-09-23-codex-routing-preparation-v2.json).
Private ledger, setup script and preservation snapshots are separately stored
under `.thread/codex-routing-preparation-v2-2026-09-23/`. No new evidence was
written into the original capability packet.

## Preservation and remaining boundaries

The completed capability report and original public evidence index were checked
against their starting byte hashes and Git commit `8c5980b`. All 49 original
private evidence files still match their original index hashes. The original
proposed verifier remains untouched as historical evidence.

This correction launched zero native children, made zero model probes, changed
no runtime or global settings and performed no network operation, rollout
initialisation, PR creation or merge. Only the proposal, new verifier and new
preparation evidence are committed. The coordinator will review these changes
using its existing reviewer; no independent review of this correction is claimed
here. The separate concrete launch agreement is still pending.
