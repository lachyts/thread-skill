# Independent Claude pilot record check, 23 September 2026

**Verdict: the durable record substantiates completion, three changed-base retries and the reported reservation totals. Acceptance remains qualified.** No inconsistent request ID, accepted envelope, approval digest, requirement revision or merge binding was found. This is an execution-evidence audit, not a source review or a release decision. Native execution, review-engine compliance, GitHub corroboration and verifier isolation are checked separately by the parent audit.

The inputs were the native Claude section of the [pilot report](../implementation/2026-09-22-live-pilot.md), the private launch agreement/preparation/configuration, [authoritative record](../../.thread/pilot-claude-2026-09-22/record/state.json), six native adapter journals, operation payloads and outputs, raw result captures, adopted requirements and evidence receipts. The [earlier changed-base audit](2026-09-22-changed-base-record-check.md) supplied methodology only. The state file remained SHA-256 `9fb67afe246bd1880527cde8fdab91dad51a0b29ee8d7c6bc6626761511cd76a` throughout this check.

## Independently confirmed bindings

- All **14 request IDs** recompute from the native run ID, request key, original unprefixed prompt and options. All original prompt hashes match. Each emitted prompt is retained in the saved prompt files. These checks establish consistency among saved records; they do not by themselves prove the exact prompt bytes sent through the native tool.
- All **14 accepted envelope hashes** agree between the acceptance payload, native journal and host accepted entry. Task, attempt, run, claim token, owner, child ID and result output agree with the claim/bind records. Each request has an ordered requested → claimed → dispatched → accepted-result lifecycle. All six native adapter runs are complete.
- All **19 raw output captures**, including five initially rejected results, parse to their saved structured output after extracting their JSON block where necessary. Every accepted result matches a raw capture. This is a check of the captures; actual transcript provenance belongs to the parent audit.
- All **six converged result hashes and approval digests**, including A's three superseded approvals, recompute. Every approval binds the adopted requirement revision, authority, verifier command, base, outcome purpose, dependency outcomes and the same verified/reviewed head. Each implementation-output digest and independent reviewer identity also agrees with the accepted requests. The seven coordinator review requests use distinct clean-context Fable children at requested `xhigh`; B's separate revision request uses Fable at requested `high`.
- All **three landing observation hashes** recompute. Each merge-operation approval snapshot equals the corresponding current task approval. The merger report, landing, outcome and saved successful post-merge verification name the same squash commit.

| Task | Verified and reviewed head | Recorded squash | Post-merge verification finished (UTC) |
| --- | --- | --- | --- |
| C | `9299ebd9ee81abf36d3a1e54f335db38f8a054d9` | `2a1ef6476f5bf0ccda3feb13916091000f9be518` | 22 September, 06:39:26 |
| A | `f2ffbe7868b79574e1d9d904b73dceb00a24d4cb` | `dca45b0e99dc07120280b7e83c8fc110fb24799e` | 22 September, 07:58:57 |
| B | `c978fd6316674c89fbcadaf846655938b4faa627` | `19bf1ac8ac053b90562d91a5d4defc603af6d64e` | 22 September, 08:22:14 |

## Authority, requirements and pinned bytes

Preparation and the domain record contain identical authority and repository objects. The authority digest recomputes to `b8e01d54d9a8bf80dcc2ec9b0abed7f2f2e447bf8bfd37d25ffe7db4388cd521`. The saved approval authorises the three outcomes, automatic squash merges after verification and independent native review, per-task 8/16/2 allowances, one draining pause and one separately recorded coordinator resume.

**The authority digest does not bind the exact user approval text.** Its `evidence.userText` is the literal pointer `see approval.json userText (verbatim)`. The exact text exists in the separate approval file, but neither that text nor its file hash is included in the authority snapshot. This limits the binding claim; it is not evidence that approval was absent. The approval file's audit-time SHA-256 is `cab2260defaded379df401d98dd9e207459ec7378915335b32b7ed58e65c21be`.

All three current source task notes equal their adopted files, preparation requirements and stored revision requirements byte-for-byte. Their JSON-string revision digests match all associated attempts and approvals. Each remains revision 1, with no revision history.

| Task | Bytes | Requirement file SHA-256 |
| --- | ---: | --- |
| A | 3,387 | `1d47df918d4b4a87416cf7e420ff44f9efe09ea95a0a2e2082a10d3ca980aacd` |
| B | 3,147 | `02c2822ad63e064271e14ed1404bc24848ad9dfebda07de6cb7230fc280ed3c0` |
| C | 2,994 | `8b346d8b726922e964eb716d9da626f465edc9d69699ae72191b5559289a7812` |

The five pinned runtime files match their recorded byte hashes: engine `cecf1edd…`, merger `5333d5f6…`, adapter `33871419…`, host `015a6f79…`, state `55abeb93…`. The saved configuration equals the host configuration. The approval's verifier digest binds the command string, not the verifier file's bytes. Current verifier bytes hash to `c6eb222776ce8977481dbb8e4200029f41f87a11af94ae072b4f7870982dc5a4`; the launch hash receipt does not include this file.

## Allowances, changed base and pause

The **91 contiguous domain events** independently reconstruct the following spend:

| Task | Stage calls | Stage verifier reservations | Post-merge reservations | Recoveries | Remaining calls / verifiers / recoveries |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 8 | 12 | 1 | 0 | 0 / 3 / 2 |
| B | 4 | 6 | 1 | 0 | 4 / 9 / 2 |
| C | 2 | 3 | 1 | 0 | 6 / 12 / 2 |

All 50 saved host views retain the same execution, epoch 1 and original 8/16/2 limits, with correct remaining-budget arithmetic. Execution history and ownership-recovery records are empty. Claim-to-result intervals reach at most two concurrent coordinator stages and end with none outstanding. These counts do not measure descendant agents or every shell invocation.

A's approval is invalidated at events **26, 41 and 54**, after base movements to `2a1ef647…`, `8ba9b209…` and `e486da98…`. New attempts at events **30, 43 and 56** preserve its requirement revision and original pool. Fresh result and review bindings precede A's merge observation at event **68**. B first starts at event **70**, after A's verified landing, with that squash as its adopted base. C was already complete.

There is exactly one pause, event **14**, and one resume, event **29**. The paused view has no B attempt or spend, and A remains open after its changed-base invalidation. The saved before-resume and transition-resume views have identical allowances and epoch; the resume receipt agrees with both. Thus the stronger checkpoint, A merged with B held solely by pause, remains unobserved, as the report already states.

**The reservation totals are not a complete count of actual verifier invocations.** The private [attempt-three evidence](../../.thread/pilot-claude-2026-09-22/evidence/a-integrate-2-schema-rejection.json) records an extra coordinator invocation against an archive of A's exact `58e41d97…` head after the child failed to capture its literal exit status. That receipt explicitly says it was not a host reservation. A had nine reservations at that stage and thirteen finally; charging this one additional invocation would yield fourteen of sixteen, not a ceiling breach. Other reviewer checks are not reconstructed into a measured invocation total here.

## Report qualifications and limits

- The heartbeat bullet names five deliveries but lists only four times. The saved evidence contains the fifth at approximately **08:32 UTC**, which reads `ended` and deletes the heartbeat. Its scheduled-tick annotation says 08:33 despite the earlier delivery timestamp; that schedule annotation should not be treated as proof of delay. Native delivery timing and deletion are independently checked by the parent.
- The five schema rejections are evidenced by retained invalid payloads and boundary errors. The second-attempt reviewer returned **eight** extra keys; its first error was `unexpected verifiedHeadMatches`, so describing all three reviewer rejections solely as added `summary` is incomplete. Each eventual acceptance is bound to the original request and child, with no extra stage claim. Four re-emissions preserve all schema-permitted fields exactly; A's first integration re-emission also adds its grandchild reviewer's ID to its summary. The accepted version matches the saved raw re-emission.
- A's third integration result also names a grandchild reviewer. The report's claim that only two implement children spawned their own reviewers needs reconciliation with the actual native tool calls; the parent owns that check. Such descendants are not included in the fourteen coordinator-stage claims.
- A requested reasoning effort of `xhigh` and an independent reviewer identity do **not** establish use of the required built-in review engine. The launch authority and adopted notes contain no explicit exception to the standing review route. Thread ADR 0007 configures reasoning effort; estate ADR 0006 distinguishes that from `/code-review xhigh`'s review prompt. The parent checks actual native review invocation and gives the overall acceptance verdict.
- B's first review has six feedback bullets. Every bullet appears verbatim in both its revision prompt and round-two review prompt; the latter retains the no-new-nitpick discipline and its result approves the final head.

The final saved view reports ended execution, three complete outcomes, no merge hold or recovery pending, and no actionable or waiting continuation. Cold ended-session recovery, ambiguous unbound children, a real Stop-driver block, stronger pause/dependency overlap, requirement changes, prerequisites, partial ending, relaunch and run-owned reversion remain unobserved.

This sub-audit ran no product tests, invoked no host/adapter operation, contacted no external service, read no actual native transcript and changed no source, private record, task note, Git index or HEAD. This report is its sole write and is left unstaged.
