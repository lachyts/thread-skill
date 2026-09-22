# Independent changed-base record check, 22 September 2026

**Verdict: PASS for the durable recovery evidence, with one report wording qualification.** The record supports the agreed successful changed-base path and the reported allowance totals. I found no inconsistent request, result, approval, merge or requirement binding. This is an execution-evidence audit, not a general code review or release decision.

The independent input was the private [pilot record](../../.thread/codex-changed-base-2026-09-22/record/state.json), execution `cd89eb1d-acec-4dcd-8511-4c8c0a5f4a5d`, plus its four raw native journals, ten acceptance payloads, claim/bind payloads, emitted requests, raw results, launch material and requirement files. Hashes and counters below were independently recomputed; they were not taken on trust from the final summary. The state file's SHA-256 remained `71c88f12a5dc32556916513ff27c3eb7071932842cec870b35805cdd8795fa9e` throughout this check.

## Report qualification

The private [report's remaining-cases paragraph](../../.thread/codex-changed-base-2026-09-22/report.md) lists “case/Unicode aliases” and then says the focused real-Git regressions cover “these variants”. The seven recorded regression cases include ASCII case aliases (`PEER.txt` versus `peer.txt`), but no explicit Unicode alias fixture is evidenced. The [fixture table](../../skills/execute/tests/engine-safety.test.mjs), retained preflight log and [correction review](../reviews/2026-09-22-ignored-file-fix.md) agree on that narrower coverage. Unicode alias rejection should remain unverified separately from the tested case-alias behaviour. This wording qualification does not invalidate the successful unrelated-ignored-file recovery observed in this pilot. The private report was preserved unchanged.

## Independently confirmed bindings

- All **10 request IDs** recompute from each raw journal's run ID, request key, original unprefixed prompt and options. Original prompt hashes also match. Emitted prompts and native model/context bindings agree with the journal. The five reviews request distinct clean-context Astra children at `xhigh`; initial/integration implementation uses Sol, and A's revision uses Astra.
- All **10 accepted envelopes** have matching independently recomputed hashes in the host and native journals. Claim tokens, task/attempt/run IDs, child IDs and outputs agree across claim/bind/accept payloads, raw result files, host accepted records and native journals. Every journal has ordered requested → claimed → dispatched → accepted-result events; all four native runs finish `complete`.
- All **four converged result hashes and approval digests**, including superseded approvals, recompute correctly. Each approval ties the same verified/reviewed head to the adopted requirement revision, authority, verifier command, base, outcome purpose and dependency state. The approval's implementation-output hash also recomputes, and its reviewer is a different child from its implementer.
- B's initial approval is invalidated at domain event 30 after main advances to `2a1ef6476f5bf0ccda3feb13916091000f9be518`. B's new result and review bind head `94978484bc9024ce83672e4e58263da13dbbb404`; merge event 44 binds squash `8ba9b209a5e053ed6be3d63cfe3d0ddaa38906bc` and successful post-merge verification containing 10 checks.
- A's initial approval is invalidated at event 47 by that B squash. Its new attempt begins at event 49 with the same requirement revision, task pool, branch and PR #17. Request `49a867cbe8d4d4cbbad0f1124314250e` and independent review `9ac58fd1d4b9915c6980ddbd4088af52` bind head `420814470cad0f2f857dd0dd66799c19a7a1920d`. Merge event 61 binds squash `e486da98283ee7e5b098a1773b24e0971b61e6da` and successful post-merge verification containing 15 checks, finished `07:28:35.063Z`.
- Both merge-operation approval snapshots equal the current task approvals, and both landing observation hashes recompute. The post-merge commit, merger's reported squash, task outcome and persisted verification observation agree. These are durable-record findings; external corroboration belongs to the parent audit.

## Authority, requirements and pinned bytes

The proposal bytes match the approval's SHA-256 `e1da8320e5e39f3df0cfecc1e7dd13f39f46ead1133ef2e69f975d880a5cf76f`. The exact recorded user text equals the domain authority evidence, and the authority digest recomputes to `9598db6faab52cc68e36fd3d11517c4c199cd1629247f06d14274b745c717b99`.

Both current source notes equal their immutable adopted files and the stored requirements byte-for-byte. A's 6,563 bytes hash to `797b9060af75ad5eecadc7dd28fe36bebc46dca84ac49d6637ada6c69ac57517`; B's 4,644 bytes hash to `dfb4cb58b3a8230af0bdb1beb23b01eca655fcf301abb4e7ff3498c4e70dc41e`. Their canonical JSON-string revision digests match every associated attempt and approval. Both remain revision 1 with no revision history.

All five pinned runtime files match their recorded byte hashes:

| File | SHA-256 |
| --- | --- |
| Engine | `cecf1eddc9afe0466c0c2a1fe707e7b305323e7dd1b90328d9eae09ef1ceb639` |
| Merger | `5333d5f6d6b3107a2456743732ae889b099bb0a9cb5139971dad7a026421a4dd` |
| Adapter | `33871419dc9ba306a3de2841b6947167f358b0b8522a28a0f9796688e196d585` |
| Host | `015a6f790c3d947d7ff40c3035c2388b8b48d94feabc93ae5b64373a790a1241` |
| State module | `55abeb939a07f4c8c76c18455d74681515a93d5ac48bbce0aaa208b5aa6219d7` |

The engine also matches the actual Git blob at correction commit `fa937dfb342c8e03da9c77826d6e17ebb18c730a`. Current verifier bytes match the launch receipt: `4abc503acbe9b614d00fb5e803c07f8ffd6f79eef7c61c235f2b2b0d05a9f49a`. The approval's different verifier hash, `5ab54d876d92d72fa8e431289ebe817105a086b19722542e54e59c9f327af792`, correctly hashes the canonical JSON verifier **command string**, as defined by the pinned state module; it is not a file-content hash.

## Allowances and completion

The 62 contiguous domain events independently reconstruct the following spend:

| Task | Calls | Stage verifier reservations | Post-merge reservations | Recoveries | Remaining calls / verifiers / recoveries |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 6 | 9 | 1 | 0 | 6 / 14 / 2 |
| B | 4 | 6 | 1 | 0 | 8 / 17 / 2 |

This matches the report and original per-task limits of 12 / 24 / 2. There is one execution at epoch 1, four attempts, ten claims, two changed-base invalidations and two merge observations. No owner-recovery or allowance-renewal event exists; execution history and host recovery records are empty. All 30 saved host views retain the same execution, epoch and limits. Claim-to-result intervals reach at most two concurrent stages and end with none outstanding. The counters are conservative reservations, not measured model tokens or every reviewer shell command.

The final view reports ended execution, two complete outcomes, no merge hold or recovery pending, and no actionable/waiting continuation. It retains four accepted request entries from the current attempts; their presence is historical evidence, not in-flight work. An initial audit assertion incorrectly expected an empty request list; the corrected terminal-state assertion passed.

Rehashing the **1,920 saved files** listed by the launch integrity manifest against the correct previous-pilot directory found zero mismatches. The previous execution ID, ended status and complete pool limits/spend also match the initial snapshot.

## Limits

The report appropriately keeps live collision rejection, directory relocation, branch strategy overrides and the earlier wider rollout acceptance cases open. No source requirement changed, owner recovery occurred, dependent task was released, queued merge was exercised or run-owned reversion occurred here. Successful changed-base retry must not become acceptance of those cases or of the separate Claude pilot.

This sub-audit did not execute product tests, invoke the host/adapter, contact GitHub, inspect actual native transcripts, control automation, or modify source, private records, Git index or HEAD. The parent separately checks live GitHub, native transcripts and heartbeat deliveries, local preservation and an isolated verifier rerun. This file is the sole write from this sub-audit and is left unstaged.
