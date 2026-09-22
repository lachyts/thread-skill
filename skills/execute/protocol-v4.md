# Protocol 4 native rollout pilot

Read the [compatibility gate](../../docs/implementation/rollout-compatibility.md) first. This is a development pilot until real unattended acceptance is recorded in both harnesses. Existing protocol 3 records keep their original engine and driver. Never change an existing note's version to use this page.

New preparations using this candidate must also follow [routing and evidence](routing-and-evidence.md), including host-recorded built-in review and actual model/effort observations. Old pinned pilots retain their original contract; do not add these fields to their journals.

## Preparation: interactive, before execution

Use grill-with-docs. Read CONTEXT and ADRs 0018–0021. Settle the following with the user using one consequential question at a time, resolving discoverable repository facts yourself:

1. Required outcomes, acceptance checks and boundaries; record which implementation choices are delegated and which decisions are explicitly reserved.
2. Repository and target branch; resolve the remote identity and a verifier that passes on the clean base. Include bootstrap needs and detect deployment/publication effects of merging, covering those effects explicitly before launch.
3. Dependencies as required outcomes, separately from conflicts (including shared generated files, package/lockfiles and scaffolding). Waves remain a provisional view.
4. Finite per-original-task allowances, permitted same-account model bindings and any resource ceiling. Prerequisites and revisions consume the same allowance. No overall overnight duration cap is imposed.
5. Local host availability and native continuation capability. Both harnesses require the local machine and app/session runtime to be available. No machine-off execution is promised.

Capture requirements from the Obsidian task notes. Save the preparation JSON beside the project execution record, never in a temporary directory. Use [preparation.example.json](preparation.example.json) for its shape, replacing every example value with discovered facts or agreed choices. The user approves outcomes and authority; agents write and review the detailed plans during execution. Approval is a statement from the user or an existing applicable authorisation, never an inferred result of silence.

`authority.gates` contains the exact approved gate declarations and limits passed to the engine. Preserve the user evidence explaining each approval in the preparation record. When an attempt reports a new declaration already covered by that authority, record the comparison through `cover-gate` (see [payload reference](host-api.md#cover-a-declaration-with-existing-authority)), then explicitly retry within the remaining allowance. The mapping is bound to the current requirements and authority and accompanies the next independent review. It cannot grant a new action or larger limit. Missing authority holds the affected task rather than generating an overnight conversation or weakening the gate.

Link the private record directory from a separate rollout note carrying `protocol_version: 4`. The task requirements remain in Obsidian. Operational record files may contain private requirements and native prompts, so keep them gitignored and private.

## Host interface

The host lives at `scripts/rollout-host.mjs`. All CLI inputs are JSON **files**; do not interpolate task prose into a shell command. A payload contains `owner: {harness,account,session,epoch}` and the fields for that operation. Use actual native session identity and the current account binding; the host cannot independently identify an authenticated account from a label.

Use the [host API payload reference](host-api.md) for exact request shapes, result envelopes and recovery evidence. After initialisation, invoke the returned `pinnedHost` for every mutation; the installed host can still read status. Never infer a native attempt's ownership epoch from the domain execution epoch.

| Operation | Purpose |
| --- | --- |
| `init DIR PAYLOAD_JSON` | Prepare repository/verifier, adopt initial requirements and pin implementation; payload includes `spec`, `owner`, `config`. |
| `status DIR` | Read state and summary without dispatch. |
| `advance DIR PAYLOAD_JSON` | Recover/replay existing attempts and admit ready tasks. Returns native requests and ready-to-merge tasks. |
| `claim DIR PAYLOAD_JSON` | Reserve allowance/capacity before native spawn (`taskId`, `requestId`). |
| `bind DIR PAYLOAD_JSON` | Record the actual returned native child (`taskId`, `requestId`, `claimToken`, `childId`). |
| `accept DIR PAYLOAD_JSON` | Accept an attested result (`taskId`, `envelope`) after native wait/status evidence. |
| `merge DIR PAYLOAD_JSON` | Merge one approved task serially using the canonical merger and actual GitHub evidence. |
| `transition DIR PAYLOAD_JSON` | Apply an explicit domain command in `command`, preserving ownership epoch and allowance. |
| `recover DIR PAYLOAD_JSON` | Adopt ownership only after native evidence resolves the previous owner and every active child. |

`config.nativeAdapter` points to the canonical shared adapter with ownership recovery support. `config.models` maps the engine's tier names to actual native models available in this harness/account. Do not map both tiers to an inherited model and call it escalation. A quota ceiling retains full verification/review quality. The host pins engine, merger and adapter code; the continuation must also keep using the recorded host version.

## Native continuation loop

Before launch, verify native child tools, model/role bindings, repository access and a real continuation facility. The coordinator does not spawn model processes. The loop is event-driven across tasks:

1. Call `advance`. Claim and spawn **all currently admitted requests up to available capacity before waiting for any one child**. Each gets a fresh native child in the calling harness with the exact prompt, schema, model, effort and project context. Record its actual child ID with `bind` immediately. Never reuse an earlier stage's child for a new independent review.
2. Wait for whichever native child completes first, leaving other running children dispatched. A lost spawn response is ambiguous: inspect native children and recover its real ID, never clear the claim and spawn again.
3. Accept only the collected structured result in the adapter envelope. Use the request's current `resultCaller` after recovery, not its original caller provenance. Record terminal failure with its evidence; silence or timeout is not a successful result. Children never author host attestations or accept their own envelopes.
4. Advance immediately after each result. Merge each eligible task serially as soon as it is approved, then advance and fill freed capacity to release dependants while unrelated tasks continue. Do not wait for the whole original batch. Required checks, repository/base/head bindings and the current requirement revision still apply.

For Codex, create a heartbeat on the **existing task** only when actually launching an authorised unattended pilot and the native automation tool is available. Inspect existing automations first to avoid duplicates. Save the record path, pinned host path and this loop in its prompt. Do not use a standalone cron as a thread-heartbeat substitute. For Claude, emit `THREAD-EXECUTION: {"record":"<absolute private record directory>","execution":"<current execution ID>"}` in an assistant message. The protocol 4 Stop driver validates this marker against the record and actual native session, then consults the host's continuation state. One rollout lifecycle is active per native session; the newest validated lifecycle marker routes continuation. The protocol 3 wave-cursor hook remains separate. If the continuation facility cannot resume this owner and collect its children, report that capability gap before promising unattended execution.

The Claude Stop hook cannot wake an idle session to poll a merge queue. Before the first dispatch, use its native `CronList` to find an existing `THREAD-EXECUTION <execution ID>` heartbeat; otherwise register a session heartbeat with `CronCreate` at the existing twenty-minute interval. Its prompt must name the private record and pinned host, read status first, collect/recover native children, poll pending merges through the host, and follow this loop. It must delete itself with `CronDelete` on `paused`, `stopped` or `ended`, remain quiet on unchanged waiting, and never resume or relaunch automatically. Missing native heartbeat tools are an unmet unattended preflight, even if the Stop hook is installed. Session closure suspends this facility; recovery requires a running native session.

A wakeup reads state first. It collects or recovers existing work, then advances; it never invokes relaunch, clears pause or invents fresh allowances. Stay quiet while state is unchanged; notify only meaningful progress, completion, failure or a newly required decision. End the continuation when the execution ends or pauses. A genuine in-flight worker, CI check or merge queue remains waiting; confirm live evidence and use bounded recovery when activity disappears. The Claude Stop driver releases after three unchanged actionable continuations with an explicit incomplete report; this is a fault signal, not completion. It permits genuine waiting and never turns a pause into an automatic resume.

## Changes, pause and repair

A requirement fingerprint change produces an assessment hold. Assess the new text against existing authority, record the evidence and adopt it through `revise`; adoption invalidates stale approvals/outcomes and requires re-planning and revalidation. Resolve superseded active children before `drained` permits a replacement. An out-of-authority revision remains blocked while independent tasks continue.

`prerequisite` inserts a necessary task and its dependency edges atomically; it shares the originating task's pool. `pause` stops admissions but drains active bounded work and permits its approved merges. `stop` fences claims and merges immediately; interrupt native children and record their outcomes. Only an explicit `resume` reinstates a paused execution, without resetting allowances. An explicit `relaunch` of an ended execution grants new finite allowances to the requested unfinished scope only.

After a post-merge failure, retain the repository merge hold. Bounded repair uses the same convergence engine and remaining allowance. A safe revert must identify the execution-owned merge being reverted, preserve peer changes, pass independent review and verify integration. Record the revert through outcome invalidation so dependants revalidate. If safe repair/revert cannot be established, retain the hold and report the blocker. Never use a force merge, protection bypass or weaker verifier to finish a run.

## Reporting

Report execution status separately from rollout completion. Seven complete and three blocked is an ended partial execution and an unfinished rollout. Keep blocked membership/history intact; clean defer is explicit removal with dependency closure accounted for. Report the actual native/merge evidence and remaining allowances. Fixture tests do not establish that the installed harness, heartbeat or account works unattended.

After each meaningful change, project the host's task states, adopted revision identifiers, PR links, blockers and remaining allowances into the separate Obsidian rollout note, with a link to the durable execution record. Mark it as a derived progress view. In this pilot the entire source task note is fingerprinted: preserve its requirement text and keep machine progress in the rollout note so reporting cannot create a spurious requirement revision. Source edits still require assessment and adoption. The record remains authoritative if note projection is interrupted; refresh the note from status on the next wake.
