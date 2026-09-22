# Independent audit of the native Claude pilot

Checked 23 September 2026 from the main project task. The subject is the [Native Claude slice](../implementation/2026-09-22-live-pilot.md), execution `db955f02-9692-4777-afcb-48645277ba5f`, native session `9fce5030-d194-4c32-a286-5a9705505228`. The private record remains unchanged.

## Verdict

The three outcomes really landed, and native children completed three changed-base retries without coordinator Git repair. The execution ended within its recorded reservation limits. This is genuine unattended execution evidence, with qualified acceptance: the required built-in review route was not exercised, and the supplied verifier was not isolated from shared reader files. Resolve those findings before treating this slice as evidence that the complete intended workflow is ready for wider unattended use. Nothing was installed, released or relaunched by this audit.

## Findings to carry forward

### Built-in review routing was bypassed

All seven coordinator review stages ran in separate Fable children at actual `xhigh` reasoning effort. Their native transcripts contain custom inspection through Bash/Read, with no invocation of `/code-review` or another built-in review engine. Their initial prompts are the candidate's custom review instructions. The final reviewers did inspect and approve the exact heads subsequently merged; this finding does not claim that independent review was absent.

The standing [review policy](/Users/lachlants/.agents/knowledge/reviewing-code.md) requires the built-in engine and distinguishes the `/code-review xhigh` review level from reasoning effort. The launch agreement supplies no explicit exception. The workflow needs to route review stages through that engine and retain actual invocation evidence. A later review can assess the landed changes, but cannot retroactively establish that this pilot followed that route.

### The verifier writes outside its scratch response store

The pilot's `verify.sh` runs `tests/test_focus_targeting.py`. At the merged commit, its hook subprocess calls `src/save_last_response.py`, whose `CANONICAL_TXT` and `LOG` are fixed under the user's home independently of `AGENT_READER_RESPONSES_DIR` (lines 39 and 41). The hook writes the canonical last response at lines 1359–1360 and appends to the shared log. The supplied verifier isolates neither of those paths.

This is supported by execution evidence, not just a possible path: the actual shared log contains fixture hook success entries during the pilot, including 18:22:11–18:22:14 Melbourne time, matching B's post-merge verifier. The fixture text can therefore replace the reader's canonical last response while checks still pass. No claim is made that historical user content is irrecoverable, and this audit did not restore shared files over subsequent activity.

The next preparation must use a verifier whose complete write surface is isolated, or an appropriately restricted test set. This audit reran only the inspected, isolated Claude-state and pruning tests: **24 + 6 passed** on a separate archive of actual final squash `19bf1ac8…`. It did not rerun the unsafe full verifier or certify all of its checks independently.

### Preparation and resource evidence need tighter recording

The [separate record audit](2026-09-23-claude-pilot-record-check.md) found consistent hashes and counters, with two limits: the authority snapshot contains a pointer to the approval text rather than the text or its hash, and the verifier is bound by its command string without a launch byte hash. The approval exists and the launch was authorised; these are weaker evidence bindings, not missing permission.

The record also discloses an extra coordinator verifier invocation outside host reservations when a child failed to capture its exit status. Charging that invocation would place A at 14/16, so this is not an established ceiling breach. Counts should continue to be called reservations, not complete usage. Future recovery should reserve such work through the same authority before running it. Descendant reviewers and schema-repair messages likewise are not represented as additional coordinator-stage claims.

The five out-of-schema results were rejected and re-emitted by their original children; all eventual outputs match the actual transcripts. Name the exact allowed result keys in the stage contract and keep one authoritative review route. Do not weaken validation to accommodate the extra fields.

## Independently established results

Authenticated GitHub reads confirmed these identities, order and scope:

| Task | PR | Actual squash | Merged UTC, 22 September | Sole changed file |
| --- | --- | --- | --- | --- |
| C | [18](https://github.com/lachyts/agent-reader/pull/18) | `2a1ef6476f5bf0ccda3feb13916091000f9be518` | 06:39:17 | `README.md` |
| A | [19](https://github.com/lachyts/agent-reader/pull/19) | `dca45b0e99dc07120280b7e83c8fc110fb24799e` | 07:58:47 | `tests/test_claude_state.py` |
| B | [20](https://github.com/lachyts/agent-reader/pull/20) | `19bf1ac8ac053b90562d91a5d4defc603af6d64e` | 08:22:04 | `tests/README.md` |

- All **14** accepted outputs equal JSON returned in the actual bound children's final transcript text. Native spawn return IDs match the host bindings. Actual model records show Opus/Fable at `xhigh`. The seven review prompts differ from emitted prompts only by a removed trailing newline; there is no substantive prompt change.
- All three integration children executed the complete corrected entry, including the collision guard and ancestry checks, unchanged. They appended only success/head/log diagnostics. Each actual tool result reports a successful `ort` merge. Recorded coordinator tool calls contain no direct Git integration repair.
- The durable audit independently reconstructed **91 events**, 14 request/result bindings, six approval digests and three landings. Pinned runtime bytes and all three adopted requirement notes match. Spend is A **8/13/0**, B **4/7/0**, C **2/4/0**, against original **8/16/2** limits, with no allowance renewal or ownership recovery.
- The root native transcript has the initial handoff prompt and no later human instruction. Five actual heartbeat deliveries occurred at **06:54:23, 07:22:22, 07:43:31, 08:02:22 and 08:32:23 UTC**. The first read `paused` and deleted its job; the last read `ended` and deleted its job. A separate one-shot resume delivered at **06:58:01**, as authorised in advance for this test. This does not authorise ordinary pauses to resume themselves.
- Current profile bytes exactly match the restoration receipt, with Fable effort back at `high`. The eight temporary rollout definitions and the worktree-local Stop settings are absent.

## Reporting corrections and remaining cases

The fifth heartbeat was the ended-state delivery omitted from the report's time list. Its evidence's scheduled-minute annotation is inconsistent and does not establish the claimed lateness. Three integration children, rather than two, spawned extra reviewers. Those reviewers were not used as the host's approval authority.

The shared Stop probe contains entries from before this session. Its claim of 34 firings belonging to this session is overstated: 26 probe timestamps fall in the session window, while **25 native Stop summaries explicitly name the driver**. Those native summaries establish delivery; no real driver block was observed. Do not infer one driver execution per every coordinator turn from the probe count.

The exact schema-error shorthand and reservation limits are qualified in the record audit. These corrections do not invalidate the three successful integrations or merges.

The previously unobserved domain cases remain open: dependent release while unrelated work is active; pause as the sole follow-on hold after prerequisite completion; cold/ambiguous ownership recovery; requirement revisions and newly discovered prerequisites; partial ending, scoped relaunch and run-owned reversion; queued merges and arbitrary PR-head movement; missing-authority enforcement. The controlled resume and successful retries are not substitutes for those cases.

Independent native transcript hashes, binding comparisons, integration tool results, heartbeat deliveries, Stop summaries, shared-fixture log excerpts and isolated test receipts are retained under `.thread/independent-claude-audit-2026-09-23/`. Private records, source code, task notes, live runtimes and automations were not changed.
