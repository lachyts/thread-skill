# Protocol 4 live pilot: Codex preparation and evidence

Status: both slices ended with all three outcomes complete on 22 September 2026: the Codex pilot (§ above) and the native Claude pilot (§ Native Claude slice below, which also observed the corrected changed-base entry recovering unattended three times). Heartbeats stopped. Neither candidate is installed or released; the remaining acceptance cases are listed at the end.

The user requested one small real pilot with A → B and independent C, followed by controlled blocker, draining pause and native recovery observations. Repository, outcomes, merge effects and finite allowances must be resolved with the user before launch. The existing native acceptance task remains open. This record does not promote either candidate or stand in for the separate Claude slice.

## Initial preflight, 22 September 2026

- Consumed `docs/handoffs/2026-09-22-rollout-live-pilot.md` by changing only its frontmatter status. No commit made.
- Thread branch `codex/thread-rollout-redesign`, HEAD `de84d401d06d022aea09a2e94c09d73b0eb9b4ea`, contains implementation checkpoint `15781f5fd46cfe1869cf7681e31c5650254bcf93`.
- Shared adapter branch `codex/thread-native-recovery`, HEAD `5cb5b72569e6bf153ce272b37f2c6fbfa6cd90d5`, matches the required checkpoint and is clean.
- The Thread worktree already contained untracked `docs/reviews/2026-09-22-live-pilot-handoff.md`; preserved. Both Thread manifests still declare 2.5.1. No installed runtime changed.
- GitHub authenticated read `gh api user` returned `lachyts`. Native Codex account configuration reports ChatGPT authentication; no credentials were copied or logged.
- Lead native session: `01a0c6ef-80af-7d83-81eb-6f2c5f7e5c25`.
- Real read-only native child: `/root/pilot_repo_probe`, session `01a0c6f1-2b7b-71a3-8f78-63efb1c58277`, model `gpt-5.6-sol`, effort `high`. Native spawn returned its canonical identity; native inventory observed it running; native messaging delivered its preliminary repository and distinct-session evidence. A bounded native wait timed out while the child was still working. This is a prerequisite probe, not rollout convergence or unattended acceptance.
- Native child spawn, messaging, inventory, interruption and wait tools are present. Existing-task `automation_update` heartbeat is callable. No existing local automation definitions were found, and no heartbeat was registered before launch agreement. Tool availability does not prove delivery or resumability.
- Node v23.9.0 imported the explicit candidate adapter and exposed `initialise`, `advance`, `claim`, `bind`, `accept`, `inspect` and `recover`.
- Fresh domain preflight: `node --test skills/execute/tests/rollout-state.test.mjs`, 37 passed, zero failed. This is deterministic regression evidence only.

## Candidate source hashes before launch

| File | SHA-256 |
| --- | --- |
| `skills/execute/scripts/rollout-host.mjs` | `015a6f790c3d947d7ff40c3035c2388b8b48d94feabc93ae5b64373a790a1241` |
| `skills/execute/wave-execute.workflow.js` | `5a27d4c253a70adbf3a5333889d23eb20f635e7663b9231e11de06e4f13ea839` |
| `skills/execute/scripts/rollout-state.mjs` | `55abeb939a07f4c8c76c18455d74681515a93d5ac48bbce0aaa208b5aa6219d7` |
| `skills/execute/scripts/merge-wave.sh` | `5333d5f6d6b3107a2456743732ae889b099bb0a9cb5139971dad7a026421a4dd` |
| Candidate shared `_shared/scripts/native_workflow.mjs` | `33871419dc9ba306a3de2841b6947167f358b0b8522a28a0f9796688e196d585` |

Execution will use the host's returned pinned copy, not these mutable source paths. Private requirements, prompts, payloads and operational journals belong under the gitignored `.thread/` directory, linked from the separate Obsidian rollout projection.

## Launch preparation (historical checkpoint)

The user approved the complete proposed pilot agreement with “yes, agree”. Exact Obsidian source requirements, the private preparation/configuration and the separate rollout projection were written before the native coordinator initialised the canonical host. No pilot PR or merge had occurred at that checkpoint.

The agreed coordinator interruption would transfer the execution into the lead using distinct real native session identities. The later observations below record actual stop/child evidence, allowance comparisons and heartbeat deliveries. Ended-session collection, queue behaviour and other unobserved acceptance cases remain open.

## Agreed work

Repository: `github.com/lachyts/agent-reader`, local `/Users/lachlants/repos/tools/agent-reader`, target `main`. Authenticated fetch confirmed clean `origin/main` at `b80b17ae66eb18c3982788901e12c8db12f0f69e`. No tracked GitHub Actions workflow or configured `core.hooksPath` was found. The probe rejected Check Engine as a poorer pilot because its only test requires a removed live corpus and the surrounding scripts include client-data and metered-model operations.

| Task | Required outcome | Scope and dependency |
| --- | --- | --- |
| A | Dedicated deterministic cleanup tests: expired response files and arbitrary sidecars are removed, fresh responses and unrelated global dotfiles survive, and the prune count is correct. Include reusable fixtures for follow-on cases; retain saved-page preservation coverage. | New `tests/test_prune.py`; no dependency. Preserve existing integration tests. |
| B | Extend A's suite with timestamp and symlink lifecycle coverage: fresh `.txt` overrides old `.html`, absent `.txt` falls back to `.html`, dangling `latest.html` is removed, valid `latest.html` remains. | `tests/test_prune.py`; depends on A and shares its file. |
| C | Correct README instructions to reflect the documented Natural Reader workflow, retain supported optional TLS behaviour, and replace the stale fixed test-file count with maintainable test guidance. | `README.md` only; independent of A/B. Historical facts are not blindly renamed. |

Acceptance: hermetic assertions run without touching the live response store; new cases exercise externally visible cleanup results rather than duplicate the implementation; the focused verifier passes; C agrees with current source and ADRs; fresh independent native reviewers approve the exact PR head before the host can merge. Production source, installation scripts, configuration, deployment, publications and account changes are outside this pilot's agreed outcome scope.

The selected existing regression scripts passed on a clean archive of the freshly fetched base: `tests/test_pages.py` and `tests/test_focus_targeting.py`, both exit 0. Their logs and the exact baseline result are retained under `.thread/pilot-2026-09-22/preflight/`. The shell initially lacked the documented `markdown` dependency; it was installed as version 3.10.3 into a private pilot virtual environment. The original checkout stayed clean. No broad-suite pass is claimed. The live rendering/extension tests and real model transports were not run.

The completed native probe confirmed that existing tests cover one known sidecar and the saved-pages exclusion, while the proposed arbitrary-sidecar, count, timestamp and symlink cases add missing contract coverage. It directly exercised the A/B behaviours in temporary directories and reported them passing. That probe is discovery evidence; it is not the proposed committed test deliverable or its independent review. The installed reader uses source from its primary checkout, but these proposed tests/docs edits do not change running code even after a later pull.

Agreed stable verifier: use that isolated interpreter and its subprocess PATH, `PYTHONDONTWRITEBYTECODE=1`, and the scoped no-LLM switch; run both existing regression scripts and additionally run `tests/test_prune.py` when present. Presence and full A/B case coverage remain mandatory PR acceptance checks, so the baseline's absence of the new file cannot approve a missing deliverable. Do not apply a global no-LLM switch to the repository's whole suite: its transport tests deliberately manage that variable themselves.

## Approved authority and finite allowance

- Create isolated task branches/worktrees, commit, push and open at most three outcome PRs to this private repository; use automatic squash merges through the pinned canonical host/merger after verification and independent review. Revisions reuse the task's PR. No force push, protection bypass, release, installation or deployment.
- Native Codex models: `opus` → `gpt-5.6-sol`, `fable` → `gpt-6-astra`; independent master review uses `fable` at the engine's `xhigh` effort. Same current account, maximum two concurrent stage children. Engine limits: three implementation verification iterations, two plan rounds and two review rounds per attempt.
- Per original task: 12 native stage calls, 24 verifier reservations, two ownership recoveries. These are upper bounds, not work targets. Retries, changed-base revalidation, revisions and any necessary prerequisite share that original pool. No automatic relaunch or renewed allowance.
- One controlled task hold affecting A and therefore B, while C can progress. A's task requirements will require the absolute private control file `.thread/pilot-2026-09-22/controls/release-a.json` under this Thread candidate to contain `{"released":true}` before implementation. Initially it is absent. Collect the actual child's missing-input result and observe independent C progress, then create the receipt and retry within the same pool. The receipt is explicitly pilot input, not evidence of product success or permission to bypass a genuine missing-authority block.
- One draining pause while A is active and before its merge can admit B, with a single explicitly pre-authorised resume after the paused state and absence of B dispatch are recorded. Active bounded stages and approved merges may drain; B must remain unstarted even after A's outcome is verified. The coordinator then performs the one agreed resume with the same allowance. The heartbeat must honour pause rather than resume on its own. This observes dependency release on reinstatement; ordinary unpaused release while C remains active may remain unobserved in this three-task slice.
- One coordinator-child interruption at a native checkpoint with no uncertain external mutation, then observed recovery into this lead. Preserve actual child IDs, pending results, epoch fencing and cumulative spend. Do not claim ended-session recovery from a child-to-lead transfer.
- An existing-task heartbeat only after launch agreement, with real delivery recorded. Local machine/app availability is required. The heartbeat reads the durable record, reconciles existing children and uses the pinned host; it never grants more allowance or silently resumes a pause.
- Observe natural ordering; do not stretch C or manufacture changes to create overlap. If these three tasks do not demonstrate a particular overlap, queued merge or changed-head case, retain that acceptance case as open. Additional useful scope or fresh allowance needs the user's explicit agreement.

Approval evidence: in native lead session `01a0c6ef-80af-7d83-81eb-6f2c5f7e5c25`, Lachy replied “yes, agree” to the complete agreement including automatic merges, finite allowances and the planned pause/resume. The exact evidence is retained in `.thread/pilot-2026-09-22/approval.json`. No later per-merge approval is required inside these bounds.

The fresh native preparation reviewer `/root/fresh_review` reported no findings, including the concrete controlled-input and pause checkpoints. This is documentation review, not live acceptance.

Authenticated repository preflight confirmed private `lachyts/agent-reader`, target `main`, push permission and squash merging enabled; the branch is unprotected. GitHub auto-merge is disabled, which does not prevent the canonical merger from performing the authorised direct squash merge once verified. No setting was changed.

The immutable pilot verifier script has SHA-256 `db83d613479e00c9d0ea1e1927596cbd9611bfad22e72f5f986120f3621b116d`. Its Python environment is isolated and persistent inside the private pilot directory. Source requirements live in the three `agent-reader-thread-pilot-{a-prune-contract,b-prune-lifecycle,c-readme-current}` notes, with `agent-reader-thread-pilot-rollout-2026-09-22` as derived progress. Existing acceptance task remains open.

## Live observations: initial dispatch and recovery

- Canonical initialisation succeeded as native coordinator `/root/pilot_owner`, actual session `01a0c708-2a6c-7fe0-b252-10f7eaa4e923`, execution `88c68b76-b116-4f72-a7ae-ae64ae280d4c`, epoch 1. It used the candidate shared adapter and returned a pinned host under the private execution release directory.
- Existing-root-task heartbeat `thread-native-pilot` was registered at five-minute intervals before dispatch. The first tool request omitted a required thread destination and was rejected without creating an automation; the corrected request supplied the real root task and succeeded. Delivery remains unobserved at this checkpoint.
- The coordinator admitted, claimed, spawned and bound A and C before waiting: A `5d0ff811eee7e2e2ee2f59d34d1fde73` → `/root/pilot_owner/stage_a_1`; C `318c9468cfb4213082d1d2f0f050994d` → `/root/pilot_owner/stage_c_1`. Both were fresh native `gpt-5.6-sol` children at medium effort. B was not admitted.
- At the reported safe checkpoint, native inventory showed the owner and both children running. Native interruption returned previous owner status `running`; subsequent inventory showed the owner `interrupted` and both children still `running`. No result had been accepted and no merge started.
- The pinned host accepted actual stopped-owner/running-child evidence and transferred ownership to root session `01a0c6ef-80af-7d83-81eb-6f2c5f7e5c25`, domain epoch 2. Both existing child IDs remain bound; no replacement dispatch occurred. Recovery pending is false.
- Allowance comparison passed: A/C each retain one spent call and three verifier reservations, now plus one spent recovery; B remains entirely unspent. All original limits are identical. Exact before/after pools and native observations are retained in private evidence. This establishes one real child-owner-to-root recovery with in-flight children, not ended-session recovery.

## Live observations: heartbeat, blocker and draining pause

- A real existing-task heartbeat arrived at `2026-09-22T03:04:19.497Z` after the prior root turn ended. Native inventory returned both original recovered children as completed, with actual structured final output matching their child-owned raw files. The root collected and accepted those results using each request’s refreshed `resultCaller`; it did not redispatch either original stage.
- C produced verified README-only PR [#13](https://github.com/lachyts/agent-reader/pull/13), head `81b8911ce59caf6cf5de264b677a3291d81036dd`, while A reported its real missing pilot input. The PR was attached to this task. A fresh native `gpt-6-astra` reviewer at `xhigh` was claimed and bound through the engine.
- The canonical engine escalated A’s first missing-input result to a fresh `gpt-6-astra` stage at high effort. That child independently observed the same absent input and returned blocked. After accepting/advancing, the durable task states were A `blocked`, B `open`, C `active`. A had spent 2 calls/6 conservative verifier reservations/1 recovery; B remained unspent. This is a real controlled-input block and independent progress, not a fabricated model result.
- The coordinator then wrote the pre-authorised release receipt, retried A in its original pool and admitted its new attempt. Before A’s future merge could admit B, the explicit planned pause set the execution to `pausing`. C’s existing review and A’s already active task can finish; B is still unstarted. The new A worker is `/root/stage_a_released`, fresh `gpt-5.6-sol` at medium effort. No allowance was replenished.

- C’s fresh native reviewer `/root/stage_c_review_1` returned `approve` with `reviewedHead=81b8911ce59caf6cf5de264b677a3291d81036dd`. The pinned host accepted that result, made C ready to merge and performed the automatic squash merge while the execution drained. GitHub confirmed PR #13 merged as `ef36370824f1ad52357ebc4605fb8cd1485f4222`; post-merge verification exited 0 at `2026-09-22T03:10:32.305Z`. C is complete. A remains active and B unstarted. No protection/configuration change or deployment occurred. The actual merge and post-merge proof are retained in the host journal and `evidence/c-confirmed-merge.json`.

- A second real heartbeat arrived at `2026-09-22T03:20:19.529Z` and collected A’s completed implementation without replacement work. A produced [PR #14](https://github.com/lachyts/agent-reader/pull/14), verified head `a721d2338128c8559f777227e967de0606a64129`, adding only `tests/test_prune.py`. A fresh native reviewer `/root/stage_a_review_1` was claimed/bound at `gpt-6-astra`/`xhigh`. The execution remains `pausing`; B remains unstarted.

## Live observations: changed base and controlled resume

- A’s first independent review approved head `a721d2338128c8559f777227e967de0606a64129`. The canonical merge operation detected C’s intervening base change, held the existing PR #14 and required fresh integration, verification and review. No A merge occurred.
- The next canonical advance drained that superseded attempt and settled the execution to `paused`. Native inventory showed the original owner interrupted and both remaining A children completed. B had no attempt, no PR and zero spent allowance. The existing heartbeat was explicitly set to `PAUSED` through the native automation tool.
- This observed a real draining pause and prevented B dispatch. It did **not** observe the narrower planned checkpoint where A is already merged and B is held solely by pause: A had reopened because of the changed base. That acceptance case remains open.
- The coordinator separately recorded and exercised the one pre-authorised resume, citing the original “yes, agree” approval. Before/after allowance equality passed. No new permission or allowance was inferred from heartbeat delivery. The same heartbeat was reactivated only after this explicit coordinator action.
- Advance admitted A again against C’s merge commit `ef36370824f1ad52357ebc4605fb8cd1485f4222`, retaining PR #14. The claimed/bound fresh stage is `/root/stage_a_integrate` (`gpt-5.6-sol`, medium). Its actual result is pending.

## Live defect: changed-base entry ordering

The fresh integration child ran the required checks and returned blocked: the new adopted base was not yet an ancestor of A's existing branch, and the emitted prompt required stopping before integration. The host correctly fenced stale approval, but the pinned convergence prompt could not complete its own changed-base recovery. Actual output is retained in `evidence/raw-a-integrate.json`. This is a live defect, not successful unattended changed-base recovery.

The result was accepted and the pinned engine emitted its bounded stronger-tier stage. With all A children terminal and accepted, the coordinator explicitly reconciled the clean existing A branch by merging the already reviewed C base locally: `a721d2338128c8559f777227e967de0606a64129` → `6779592630bada6ce466bb3755f394395a19b778`. This added C's README change, retained A's exact test diff, rewrote no history and neither pushed nor merged a GitHub PR. The saved receipt is `evidence/a-coordinator-base-integration.json`. The fresh native escalation `/root/stage_a_integrated_escalation` must now verify that commit and the engine must obtain a new independent review before its canonical merger can act. All stages retain A's original allowance.

A separate bounded worker is correcting the candidate prompt and adding regression coverage. The running execution remains pinned to its original bytes; no candidate-source fix can be claimed as live acceptance in this execution.

The integrated A stage passed the scoped verifier at clean unchanged head `6779592630bada6ce466bb3755f394395a19b778`, pushed exactly that commit and updated the existing PR #14. Its actual result was accepted and advanced. Fresh independent reviewer `/root/stage_a_review_integrated`, request `a5b7d13f0cf18c8f473fa2e7b14aef2e`, is checking that head. A has spent 7 calls, 15 conservative verifier reservations and 1 recovery so far, from its original 12/24/2 pool.

## A merge and dependent admission

The fresh integrated-head reviewer approved `6779592630bada6ce466bb3755f394395a19b778`. The pinned host automatically squash-merged PR #14 as `079e175adc9ac41cc110b55a74fe881942bfd976`, verified the integrated result successfully and marked A complete. Immediate advance admitted B against the new base. Thus dependent admission after confirmed prerequisite completion is observed; C was already complete, so overlap with unrelated active C remains unobserved.

B's first request `6914d59dcf113171dc4051551e80c27a` was claimed, but native spawn was explicitly rejected with `agent thread limit reached`. No B child was created; native inventory and the rejection are recorded in `evidence/b-spawn-capacity-rejection.json`. The same claim and reserved allowance are retained while native capacity frees; no replacement claim or fictional child is recorded. The parallel candidate-source review is separate infrastructure work and is still running.

After the candidate reviewer completed, native capacity allowed `/root/stage_b_implement` to spawn. The same B claim/token was immediately bound, without a second claim or allowance debit. The original rejection was definite, not an ambiguous lost spawn. The separate candidate fix passed its initial regression/host tests; native review then found a canonical-path comparison defect, now being corrected before a fresh recheck. See `docs/reviews/2026-09-22-de84d40-14f75d.md`.

## Third heartbeat and B review

An actual third heartbeat arrived at `2026-09-22T03:53:49.633Z` after the previous root turn ended. It collected B’s actual completed native result: [PR #15](https://github.com/lachyts/agent-reader/pull/15), verified head `354cdead2b5cb195d54c333a4e354945ff4a715b`, extending only `tests/test_prune.py`. The result was accepted, advanced and a fresh independent reviewer `/root/stage_b_review_1` claimed/bound to request `707a5a514258f26c05b76c43af8614f2` (`gpt-6-astra`, xhigh).

The candidate correction worker reported that the additional canonical-path regressions failed before correction and all 41 engine-safety tests now pass; prompt invariants, syntax and diff checks pass. Its scope is still the engine and focused tests. A new fresh review remains required. These fixture results do not establish the corrected candidate’s live unattended acceptance.

## Completed Codex slice

Execution `88c68b76-b116-4f72-a7ae-ae64ae280d4c` is `ended`, `rolloutComplete: true`, all A/B/C tasks `complete`, no in-flight request or repository hold. The existing heartbeat was set to `PAUSED` through the native app tool after ending. All three real PRs were automatically squash-merged by the original pinned host after commit-bound native verification and fresh independent review. A subsequent authenticated GitHub read confirmed each actual merge and file scope.

Columns “spent” and “remaining” are native stage calls / conservative verifier reservations / ownership recoveries. Each original task retained the same 12/24/2 ceiling throughout; reservations are not a claim that every reserved verifier invocation ran.

| Task | Outcome PR | Verified and reviewed head | Confirmed merge | Post-merge verifier | Spent | Remaining |
| --- | --- | --- | --- | --- | --- | --- |
| C | [PR #13](https://github.com/lachyts/agent-reader/pull/13) | `81b8911ce59caf6cf5de264b677a3291d81036dd` | `ef36370824f1ad52357ebc4605fb8cd1485f4222` | 0 at 2026-09-22T03:10:32.305Z | 2/4/1 | 10/20/1 |
| A | [PR #14](https://github.com/lachyts/agent-reader/pull/14) | `6779592630bada6ce466bb3755f394395a19b778` | `079e175adc9ac41cc110b55a74fe881942bfd976` | 0 at 2026-09-22T03:39:22.870Z | 7/16/1 | 5/8/1 |
| B | [PR #15](https://github.com/lachyts/agent-reader/pull/15) | `354cdead2b5cb195d54c333a4e354945ff4a715b` | `fbf1f9372abd6f074b5f93fb2c50649cf3db6684` | 0 at 2026-09-22T03:57:37.583Z | 2/4/0 | 10/20/2 |

Observed in the actual harness/account: fresh native implementation/review stages, three real existing-task heartbeat deliveries after root turns ended, automatic authenticated merges, blocker isolation with independent C progress, immediate B admission after verified A completion, stopped-owner transfer retaining the same in-flight child IDs, cumulative allowance preservation, a draining pause that stopped continuation, and exactly one separately authorised resume. B's explicit failed native spawn preserved its original claim until a fresh child could be bound; no duplicate task PR, dispatch claim or merge occurred.

The changed-base guard also invalidated stale approval correctly. Its emitted retry then failed before it could integrate the base, exposing a real candidate defect. The coordinator's bounded local reconciliation restored the required invariant; the unchanged pinned engine subsequently verified/reviewed/merged the existing A PR. This is a completed useful pilot with a recorded coordinator repair, **not** proof that the corrected candidate can recover that case unattended.

Still open: native Claude session and its heartbeat/Stop path; corrected candidate's live changed-base recovery; arbitrary PR-head movement; queued merges; cold ended-session and ambiguous unbound-child recovery; the narrower pause with A already merged but B held solely by pause; ordinary dependency release while unrelated C is still active; in-flight requirement revisions/prerequisites, partial ending, scoped relaunch and safe run-owned revert. No new scope or allowance was granted to exercise those cases. The existing acceptance task and R-WAVE remain open.

Private durable evidence is under `.thread/pilot-2026-09-22/`: approval/config/preparation, per-operation payloads/outputs, actual native request/result files, recovery/heartbeat/pause/resume receipts and the authoritative record. Final summaries are `evidence/final-rollout-status.json`, `final-confirmed-landings.json`, `github-final-pr-evidence.json` and `final-source-integrity.json`. All three source task notes exactly match their adopted snapshots. The pinned runtime hashes after resume still equal the launch hashes above. The separate Obsidian rollout note is the derived completed progress view.

Preserve the named candidate branches, pilot worktrees, private execution and pinned release. No installation, version bump, release, deployment, force push or branch-protection change occurred. Separate continuation for Claude is documented in [the Claude pilot handoff](../handoffs/2026-09-22-rollout-claude-pilot.md); it must negotiate concrete new work and finite authority before launch, never reuse this completed pilot's allowance.

## Candidate correction and independent recheck

The bounded correction is committed as `67a825fb723f3b67604b6529553cc87b910f85e4` on `codex/thread-rollout-redesign`. It permits explicit integration of the pinned base only for matching durable retry context, with canonical repository/worktree identity, expected branch/head, clean state and edit/commit authority; it preserves the existing PR and aborts conflicts. Other/legacy entry paths retain their strict checks. The first fresh native review found one P2 path-equivalence defect; it was corrected, regression-tested and rechecked by a separate fresh reviewer with no findings.

Verification: 41 engine-safety tests, prompt invariants and diff checks passed on the corrected diff; the initial bounded fix also passed 33 host tests and proved 48 legacy prompt variants byte-identical to the prior HEAD. Both sets of results are fixture/regression evidence. The final review confirms no live native-child/PR execution of these new bytes occurred. Review records: `docs/reviews/2026-09-22-de84d40-14f75d.md` (finding retained and annotated) and `2026-09-22-de84d40-4c7a8e.md` (fresh recheck).

## Native Claude slice, 22 September 2026

**Independent follow-up, 23 September:** the [Claude pilot audit](../audits/2026-09-23-claude-pilot-independent-audit.md) substantiates the merges and three native recoveries, with qualifications: built-in review routing was not exercised, the verifier writes to shared reader files, and several evidence/count claims need narrowing. Read that audit and its record check before making a release decision. The original report below is retained as the historical handback.

Status: Claude pilot execution ended with all three outcomes complete. Heartbeat self-deleted on pause and again on end. Neither candidate is installed or released. This section records the native Claude run that the Codex slice above left open.

### Preflight and launch gate

- Consumed `docs/handoffs/2026-09-22-claude-pilot-restart.md` (front matter only). Fresh native Claude session `9fce5030-d194-4c32-a286-5a9705505228`, profile `fauxmuse`, Claude Code 2.1.278, account `claude-account-sha256:b9908d43…`.
- The previous session could not launch because a running session does not reload effort settings. In this fresh session the profile's `modelSettings.claude-fable-5-1.effortLevel` (edited to `xhigh` by the previous session) governed: probe children `rollout-fable-xhigh` and `rollout-opus-medium` ran `claude-fable-5-1` at `xhigh` and `claude-opus-5` at `xhigh` (requested `medium`; the agent definition's `effort` field still does not govern). Fable review at `xhigh` was therefore satisfied and Opus at `xhigh` accepted. Evidence: `.thread/pilot-claude-2026-09-22/evidence/effort-probes-fresh-session.json`.
- Candidate pinned at `5d3e40fd64a3f3b51d8714370eb589df6d7905e8` (execute directory byte-identical at worktree HEAD `cc8640e`); shared adapter `0cdc433`. Pinned release hashes: host `015a6f79…`, state `55abeb93…`, engine `cecf1edd…`, merger `5333d5f6…`, adapter `33871419…`; all unchanged after the run (`evidence/final-source-integrity.json`).
- Initialised 06:29:17Z through the installed host into execution `db955f02-9692-4777-afcb-48645277ba5f`, epoch 1. Per task 8 calls / 16 verifier reservations / 2 recoveries, `maxConcurrent` 2, engine 3/2/2, `judgeModel` fable. Worktree-local Stop hook active; session heartbeat registered via `CronCreate` before the first dispatch.

### Observed

| Task | Outcome PR | Verified and reviewed head | Confirmed merge | Post-merge verifier | Spent | Remaining |
| --- | --- | --- | --- | --- | --- | --- |
| C | [PR #18](https://github.com/lachyts/agent-reader/pull/18) | `9299ebd9ee81abf36d3a1e54f335db38f8a054d9` | `2a1ef6476f5bf0ccda3feb13916091000f9be518` | 0 at 06:39Z | 2/4/0 | 6/12/2 |
| A | [PR #19](https://github.com/lachyts/agent-reader/pull/19) | `f2ffbe7868b79574e1d9d904b73dceb00a24d4cb` | `dca45b0e99dc07120280b7e83c8fc110fb24799e` | 0 at 07:58Z | 8/13/0 | 0/3/2 |
| B | [PR #20](https://github.com/lachyts/agent-reader/pull/20) | `c978fd6316674c89fbcadaf846655938b4faa627` | `19bf1ac8ac053b90562d91a5d4defc603af6d64e` | 0 at 08:22Z | 4/7/0 | 4/9/2 |

Columns are native stage calls / conservative verifier reservations / recoveries against 8/16/2. Every merge was performed by the pinned merger after commit-bound verification and a fresh independent `claude-fable-5-1` review at `xhigh`; GitHub confirmed each merge and file scope (`evidence/final-confirmed-landings.json`).

- **Native children.** Every stage ran as a fresh child spawned by the coordinator with `subagent_type` matching the request's tier and effort, the engine prompt passed verbatim (`originalPromptHash` verified against the engine prompt beneath the adapter's contract preamble), real child IDs bound immediately, results collected from the child transcripts and accepted with each request's current `resultCaller`. Idle children were stopped after acceptance.
- **Corrected changed-base entry, observed unattended three times.** A's first head `1ce3b7bf` was verified and approved, then held at merge because C's merge moved `main`. After the resume the engine re-admitted A through the corrected entry (candidate `67a825f` + `fa937df`): the child resumed the recorded branch, passed the canonical identity and clean-state checks, ran the ignored-path collision guard, merged the pinned base from the recorded prior head with `ort --no-ff`, re-verified and pushed to the same PR. This happened again after the other thread's PR #16 landed (base `8ba9b209`) and again after PR #17 (base `e486da98`). Each attempt got fresh verification and a fresh review; the unchanged pinned merger landed PR #19 on the fourth attempt with A's calls exhausted exactly. No coordinator repository intervention occurred. Evidence: `evidence/a-changed-base-hold*.json`, `a-changed-base-integrated.json`, `a-integrate-3-accepted.json`, `a-confirmed-merge.json`.
- **Draining pause and single resume.** `pause` at 06:37Z while A was active with its PR up. The drain permitted C's review and merge and A's review; A's merge was then held on the changed base and the execution settled to `paused` at 06:43Z with B never dispatched. The heartbeat delivered at 06:54Z, read `paused`, deleted itself and issued nothing. One recorded coordinator resume at 06:58Z (scheduled as a separate one-shot coordinator wake, not the heartbeat) with allowances byte-identical before and after; the heartbeat was then re-registered. The narrower checkpoint (A merged while B held solely by pause) was **not** observed, as in the Codex slice: A reopened on the changed base before the pause settled. Evidence: `pause-issued.json`, `paused-checkpoint.json`, `heartbeat-first-delivery.json`, `resume-issued.json`.
- **Heartbeat.** Five real session-cron deliveries after coordinator turns ended (06:54Z on paused; 07:22Z, 07:43Z, 08:02Z running with a child in flight, each ending quietly). Deliveries arrived 5 to 10 minutes after the scheduled minute, within the tool's documented jitter and idle-only firing. `heartbeat-registered.json`, `heartbeat-reregistered.json`, `heartbeat-deliveries-after-resume.json`.
- **Review-requested revision.** B's first review returned `changes` with six bullets; the engine emitted a `fable` revise stage carrying them verbatim, the revision applied all six, and the round-2 review (with round-1 history and the no-new-nitpick discipline) approved. `b-review-changes-and-revise.json`, `b-confirmed-merge.json`.
- **Dependent admission.** B was admitted by the `advance` immediately after A's confirmed merge and dispatched in the same coordinator turn sequence. C was already complete, so overlap with unrelated active work at dependent release remains unobserved.
- **Stop hook.** The worktree-local Stop hook fired at every coordinator turn end (34 timestamped probe lines this session). The driver never emitted a block message because no turn ended with actionable work; its block path stays fixture-verified only. `stop-driver-observation.json`.
- **Host boundary under real children.** Five child outputs carried properties outside their schema (Opus x2 added `reviewer`; Fable x3 added `summary` to the three-key review schema). The pinned adapter's validator rejected each at the host boundary (`$: unexpected …`, exit 1, no state change) and the same bound child re-emitted a schema-valid result on a native message; no output was edited by the coordinator. Two implement children also spawned their own grandchild reviewers, which were not credited. These are candidate findings for the child contract wording, not host defects. `a-integrate-schema-rejection.json`, `a-review-attempt2-schema-rejection.json`, `a-integrate-2-schema-rejection.json`, `a-review-attempt3-schema-rejection.json`, `a-review-attempt4-schema-rejection.json`.
- **Concurrency pressure.** The other thread merged two PRs into the same repository during A's cycle; each moved the base and cost A an integrate-plus-review cycle. The allowance held exactly. A fourth movement would have blocked A with calls exhausted, which is the intended finite behaviour.

### Still open after both slices

Cold ended-session and ambiguous unbound-child recovery; a real Stop-driver block; A merged while B is held solely by pause; ordinary dependency release while unrelated work is still active; in-flight requirement revisions and prerequisites; partial ending, scoped relaunch and safe run-owned revert; arbitrary PR-head movement other than base movement. No new scope or allowance was granted to exercise those cases.

Private durable evidence is under `.thread/pilot-claude-2026-09-22/`: approval, preparation, config, per-operation payloads/outputs, raw child outputs, the authoritative record and the evidence files named above. The three source task notes still match their adopted snapshots; the derived Obsidian rollout note `agent-reader-claude-pilot-rollout-2026-09-22` carries the final projection.
