# Independent check of the corrected Codex recovery pilot

Checked on 22 September 2026 from the main design/audit task. Source report: `.thread/codex-changed-base-2026-09-22/report.md`; native task `01a0c79b-ab7b-7f83-9c6f-469d50ba9613`; execution `cd89eb1d-acec-4dcd-8511-4c8c0a5f4a5d`.

## Verdict

The agreed changed-base recovery case passed. The actual native child ran the corrected entry on A's existing PR, preserved its task work and ignored local probe, obtained fresh verification and independent review, and the canonical host merged it after B. The evidence supports the report's scoped conclusion. This closes the corrected Codex retry acceptance gap from the [first independent pilot audit](2026-09-22-live-pilot-independent-audit.md); it does not establish full release readiness or native Claude acceptance.

## Checks independent of the completion report

- Fresh authenticated GitHub reads confirmed B [PR #16](https://github.com/lachyts/agent-reader/pull/16) merged at 07:10:11 UTC as `8ba9b209a5e053ed6be3d63cfe3d0ddaa38906bc`, followed by A [PR #17](https://github.com/lachyts/agent-reader/pull/17) at 07:28:29 UTC as `e486da98283ee7e5b098a1773b24e0971b61e6da`. Each adds only its authorised test file.
- Read the original native integration transcripts, not only exported receipts. All 24 selected tool events across A and B matched their actual transcript entries, and both complete transcript hashes matched. A's executed entry, decoded as data without rerunning the command, is byte-identical to the emitted request: SHA-256 `7c4b0c90c709baaa5462f7c734b0fe401eb3af39dec4099aff1cc6b5d1755462`. Its actual merge tool result exited 0.
- Fresh local Git reads confirmed A's integrated head `420814470cad0f2f857dd0dd66799c19a7a1920d` has the previous reviewed A head and B's squash as its two parents. Its worktree is clean. The ignored probe still matches its initial hash `7c0909f1b8629aef50f95e9b26240bb7b496dcc1d7109ffc1796c1e20387ee1a`; the revised test file remains unchanged by integration. B and Claude's README merge are ancestors of A's actual squash.
- Read both final reviewers' original native transcripts. Each loaded the bundled review-agent and approved the exact head subsequently merged. Native model/effort records show Astra at `xhigh`; parent spawn calls show `fork_turns: none`. A's final reviewer is `01a0c800-bd9c-7a93-b0af-c9c4fe674b74`; B's is `01a0c7e3-b512-79f2-b6d1-35d09721851d`.
- Independently reran the isolated verifier on a separate archive of A's actual squash commit. All 15 checks passed: six prune tests, five migration tests and four provenance-cache checks. The verifier file is byte-identical to its launch hash `4abc503acbe9b614d00fb5e803c07f8ffd6f79eef7c61c235f2b2b0d05a9f49a`; only its location was changed so temporary scratch lives under this audit's directory. The excluded legacy integration scripts were not run.
- The native root transcript contains the launch agreement followed by five real heartbeat messages and no further human prompts. Each heartbeat followed an earlier root final. Inspection of recorded coordinator tool calls found no direct Git integration repair. The current saved automation `thread-changed-base-pilot` is `PAUSED` and targets the correct native task.
- A separate [durable-record audit](2026-09-22-changed-base-record-check.md) independently reconstructed all 62 events, ten requests and results, four approvals, and both merge/post-merge bindings without discrepancy. A spent 6 stage calls and 10 verifier reservations; B spent 4 and 7. Both retained their original 12/24/2 limits, with no ownership recovery or allowance renewal and at most two concurrent stages. The five pinned files, adopted requirements and all 1,920 saved files from the previous pilot matched their recorded hashes.

## Limits retained

The ignored probe was unrelated to the incoming changes. Its preservation is live evidence for this successful path, not live rejection of a colliding ignored file, case alias, file/directory collision, directory rename or strategy override. Those variants retain their separate regression evidence.

One coverage claim in the private report needs narrowing: its list includes Unicode aliases before saying the focused regressions cover those variants. The recorded alias regression uses an ASCII case alias; no separate Unicode-alias regression was evidenced. Unicode-alias rejection therefore remains unverified by this audit, both live and in the cited regressions. This wording qualification does not change the agreed recovery result.

The run did not test owner recovery, requirement revisions, partial ending, relaunch, reversion, queued merges, missing authority, or the remaining dependency/pause timing cases. The separate Claude run still needs its own completed evidence review. The earlier shared-scratch preflight incident remains recorded and was excluded from this approved verifier; this check does not certify or repair those legacy tests.

## Audit evidence

Independent GitHub snapshots, native transcript checks, spawn settings, exact entry comparison, local Git/probe checks and the merged verifier receipt/log are retained in `.thread/independent-changed-base-audit-2026-09-22/`. The original pilot record was not edited or resumed. Source, installed runtimes, automations and peer handoff edits were not changed by this audit.

An initial audit-script assertion compared the approval's verifier binding with file bytes. That binding hashes the JSON-encoded command, whereas the launch receipt separately hashes the script. Both were resolved and checked before the independent verifier ran; this was an audit assumption error, not a pilot mismatch.
