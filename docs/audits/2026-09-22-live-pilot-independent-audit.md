# Independent audit of the Codex rollout pilot

Audited on 22 September 2026 from the originating design session, with a fresh native code reviewer and a separate execution-record auditor. Pilot task: **Run Thread rollout pilot**, native session `01a0c6ef-80af-7d83-81eb-6f2c5f7e5c25`. Candidate snapshot: `50dc7fe05ff14a9df1e033c99e4754d309d69557`; source correction reviewed at `67a825fb723f3b67604b6529553cc87b910f85e4` against `de84d401d06d022aea09a2e94c09d73b0eb9b4ea`.

## Verdict

The pilot genuinely completed its three useful task outcomes using native Codex children, independent review, real heartbeat continuation and authenticated automatic merges. The record distinguishes demonstrated behaviour from unobserved cases. Full release acceptance remains incomplete, and the fresh review found one additional data-preservation defect in the candidate recovery correction.

The changed-base repair during the pilot was performed autonomously by its coordinator. No additional human decision appeared between the user's launch approval and completion: the intervening root turns were three actual heartbeat deliveries. This is evidence of unattended coordination, but it is not live acceptance of the subsequently corrected task retry path.

## New finding: preserve ignored local files during base integration (P2)

At `skills/execute/wave-execute.workflow.js:862`, the new changed-base retry runs `git merge --no-ff --no-edit` after a clean-status check. Git's normal status omits ignored files, and merge overwrites ignored files by default when the incoming commit tracks their paths. The emitted setup can therefore succeed while replacing local work.

The independent bundled reviewer reproduced this with an ignored `local.txt` containing local work and an adopted base that newly tracked `local.txt` with different contents. Both cleanliness checks passed; the local contents were replaced. This reproduction was separate from the completed pilot; the audit does not claim that the pilot itself lost a file.

Recommended repair: use `--no-overwrite-ignore` or an equivalent collision guard, and add a real-Git regression proving a collision leaves the local contents and prior branch head intact. Keep this finding open until the correction and focused recheck pass. See the [complete independent code review](../reviews/2026-09-22-pilot-fix-independent-audit.md).

### Follow-up correction — 22 September 2026

The finding is now resolved in candidate commit `fa937dfb342c8e03da9c77826d6e17ebb18c730a`. Testing showed that the suggested Git flag alone did not prevent the overwrite. The correction previews the merge's actual resulting paths before any worktree merge, including paths moved by directory-rename detection, and checks both path collisions and filesystem identities. The actual merge explicitly uses the preview's strategy and suppresses branch-specific strategy overrides for that command.

All seven new regressions passed: matching files, case aliases, both file/directory collision directions, directory-rename relocation, a branch strategy override, and unrelated ignored contents that must remain usable. The combined engine safety and prompt suite passed 49 Node tests with no failures or skips. A [fresh independent review of the correction](../reviews/2026-09-22-ignored-file-fix.md) returned no findings. Its scope and tested Git/filesystem versions are recorded there; the combined test log is retained at `.thread/independent-audit-2026-09-22/ignored-file-fix-tests.log`.

This follow-up changes the candidate source and tests. It does not alter the completed pilot's pinned implementation, execution record or spent allowances. A new authorised execution must pin the corrected candidate to establish live recovery acceptance. The other acceptance boundaries below remain unchanged.

## Independently confirmed results

Authenticated GitHub reads during this audit confirmed all three actual merges into `main`, their head identities and their file scopes:

| Task | PR | Reviewed head | Actual merge | Scope |
| --- | --- | --- | --- | --- |
| C | [13](https://github.com/lachyts/agent-reader/pull/13) | `81b8911ce59caf6cf5de264b677a3291d81036dd` | `ef36370824f1ad52357ebc4605fb8cd1485f4222` | `README.md` |
| A | [14](https://github.com/lachyts/agent-reader/pull/14) | `6779592630bada6ce466bb3755f394395a19b778` | `079e175adc9ac41cc110b55a74fe881942bfd976` | `tests/test_prune.py` added |
| B | [15](https://github.com/lachyts/agent-reader/pull/15) | `354cdead2b5cb195d54c333a4e354945ff4a715b` | `fbf1f9372abd6f074b5f93fb2c50649cf3db6684` | `tests/test_prune.py` extended |

Native child transcripts were read directly for C's final reviewer (`01a0c714-2d79-7672-8248-f07c41736785`), A's integrated-head reviewer (`01a0c72f-cd69-76f1-8e1a-bea6f961fbd7`) and B's reviewer (`01a0c740-5988-76c1-aaf6-465ea118da6c`). Each loaded the bundled Codex `review-agent`, ran independently and returned approval of the exact head subsequently merged. These checks do not rely solely on coordinator-written JSON results.

Native root transcripts confirmed the launch agreement and the user's “yes, agree”, the actual interruption of the initial owner, and heartbeat turns beginning at 03:04:19, 03:20:19 and 03:53:49 UTC, each after the preceding root turn completed. The actual saved heartbeat configuration is `PAUSED` and targets that pilot task. No audit operation resumed it.

The pilot's correction receipt records a local merge of C's adopted base into A's branch at 03:32:21 UTC, after the previous child had completed. The original pinned engine then obtained fresh verification/review before its own merger merged A. It did not substitute the old approval after that head change.

## Acceptance boundaries

| Agreed promise | What the pilot establishes |
| --- | --- |
| A completed task unlocks its dependant while unrelated work continues | B was admitted 1.084 seconds after A's confirmed completion; C was already complete. The overlap case remains unobserved. |
| A blocked task holds only its dependency closure | A's controlled missing input held A/B while C progressed and merged. |
| An adopted revision invalidates stale review/completion | No live requirements revision occurred. Source snapshots remained unchanged. |
| Seven complete and three blocked means ended execution/open rollout | This execution ended with all three complete; partial ending remains untested live. |
| Restarts preserve allowance; relaunch renews only requested scope | A real interrupted-child-owner transfer preserved existing children and spent allowance. Cold ended-session recovery and scoped relaunch remain untested. |
| Pause drains active work without follow-ons | The draining pause held B and allowed C to merge. A reopened on a changed base, so pause as the sole reason to hold B after A merges remains untested. |
| Queues, changed heads and duplicate results cannot falsely advance | Changed-base protection invalidated A's earlier approval; same claim survived a definite failed B spawn. Queued merges, arbitrary PR-head movement and ambiguous unbound-child recovery remain untested live. |
| Reversions invalidate affected outcomes/dependants | No live run-owned revert occurred. |
| Genuine unattended execution and recovery in both harnesses | Codex completed through real heartbeats, with the recorded autonomous coordinator repair. Corrected-path live recovery and native Claude execution remain open. |

These are acceptance gaps, not additional observed code defects. They are already retained in the pilot report and acceptance task; the phrase “pilot complete” must not be promoted to “release ready”. The controlled missing-input hold was explicitly not an authorisation gate, so it does not establish live missing-authority enforcement.

## Audit checks and evidence

- Re-ran the exact scoped pilot verifier on a separate archive of final merged commit `fbf1f9372abd6f074b5f93fb2c50649cf3db6684`: exit 0. Both existing regression scripts and all six new cleanup test methods passed. Verifier hash still matches the launch hash `db83d613479e00c9d0ea1e1927596cbd9611bfad22e72f5f986120f3621b116d`.
- Re-ran engine safety and prompt compatibility: 42 Node tests passed, including 41 safety cases and the prompt runner's 191 assertions. The independent reviewer separately tested fixed commit blobs and reproduced the ignored-file defect despite those passing tests.
- The separate [record audit](2026-09-22-pilot-record-check.md) passed 175 binding/hash checks and reconstructed the final pools from all 75 domain events without discrepancy. It checks actual request/result/approval bindings, ownership epochs, source snapshots and pinned implementations. Budget figures are conservative implementation-verifier reservations and task-stage calls, not a count of every reviewer shell check or total session token use.
- Independent native/GitHub receipts and the new merged-verifier log are retained under `.thread/independent-audit-2026-09-22/`. The original private execution evidence remains under `.thread/pilot-2026-09-22/`; neither directory is committed.
- Source code, live rollouts, installed runtimes and GitHub state were not changed by this audit. The peer task's concurrent Claude handoff edit was preserved. No new automation or child rollout was launched.

## Recommended next move

With the ignored-file finding resolved and independently rechecked, run a small new Codex execution pinned to the corrected candidate that naturally advances the base while another task's PR remains open. Verify that the task integrates, revalidates, receives fresh review and merges without the coordinator's ad hoc local Git repair. Preserve the other outstanding acceptance cases and the separate native Claude run before release. The existing pilot task can coordinate this new execution; the completed execution's allowances and evidence must not be reused as a fresh launch.
