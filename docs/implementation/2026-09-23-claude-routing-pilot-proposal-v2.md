# Claude two-task pilot, corrected preparation

23 September 2026. **Prepared proposal, not launch authority.** This replaces the
operational recommendations in the original proposal without changing that
historical document or its capability evidence. Read ADR 0022 and the
[correction delivery](2026-09-23-claude-review-correction.md) for source pins and
review status. The new native review-path check must pass before a launch agreement.

## Outcomes and order

Use `github.com/lachyts/thread-skill` in a new isolated checkout. Propose a new
non-default target branch `claude/routing-pilot-v2-2026-09-23`, never force or reuse
an existing branch. Pin its exact base commit at agreement after read-only remote,
account, branch-rule and workflow/effect preflight. Publishing that base history,
opening two PRs and automatically merging them into this target require the
concrete agreement. No target or PR has been created by this preparation.

- A, `claude-routing-work-policy`: create only
  `docs/pilots/claude-routing/work-policy.md`, using the versioned work fixture's
  required content. Easy, no plan gate, no dependencies.
- B, `claude-routing-review-policy`: create only
  `docs/pilots/claude-routing/review-policy.md`, using the review template with
  the SHA-256 of A's actual integrated bytes. Easy, no plan gate,
  `dependsOn: ["claude-routing-work-policy"]`.

Both exact task requirements are adopted and hashed before launch. The host must
record A's verified merge and current satisfied outcome before B is dispatched.
B's content hash proves byte consistency; it cannot establish dispatch order.
Record the real host events for that separate claim. Neither task changes runtime,
profiles or installed skills. Unexpected remote effects remain a preparation hold.

## Fixed verification and task completion

Use the reviewed [verifier v2 preparation](../preparations/2026-09-23-claude-routing-v2/README.md).
Its SHA-256 is `e5600fe57beb947b636acfbfe332ed297270fb28040535f0ac9ed744cdb7e4bf`.
The twelve local preparation invocations are spent and are not a launch allowance.
Copy those exact bytes into the new execution's immutable input area and declare
their absolute path in `repository.verifierInputs`. Bind verified Python/Git paths
and versions in the agreement. Use one unchanged command everywhere:

```text
<pinned-python> -I <absolute-pinned-verifier> --base <full-agreed-base-SHA>
```

Pin `repository.verifierContract` as
`{"version":1,"baselineModes":["baseline"]}`. A allows
`verifierModes: ["partial", "complete"]`; B allows `["complete"]` only.
The verifier checks a clean descendant of the exact base, the exact two-file
scope, complete required content, regular files and B's matching digest. The
host independently checks report head and task mode before candidate approval
and after integration. Exit zero in `partial` can never complete B.

One final supplementary operation uses B's remaining original pool:

```json
{"operationId":"claude-routing-pilot-final-v2","commit":"<B's exact integrated merge commit>","purpose":"Confirm both routing policy documents and prerequisite digest at B's integrated commit"}
```

Use the supported `verify` / `verifyTask` API. Require a completed operation,
`accepted: true`, exit zero and report `{mode:"complete",head:<operation commit>}`.
Match the commit to B's recorded merge. Repeating the identical submission reads
its result; a changed commit or purpose needs a distinct operation and allowance.

## Routing, review and finite allowances

Bind the corrected Thread and shared runtime versions from the delivery record,
the verified native Claude account and a fresh policy snapshot. Native review
must pass the separate [review-path check](../handoffs/2026-09-23-claude-review-path-check.md)
on the same runtime and supported routes. Use high for these easy implementations,
xhigh for independent review, direct maximum after a substantive failure and
prepared Fable maximum recovery after a failed maximum correction.

Every review reserves two calls and two capacity slots together: wrapper and
built-in fork. Bind and observe both separately, retain the exact fork output,
relay it verbatim to the same wrapper and accept its schema-valid verdict with
the version-2 host receipt. The built-in command remains `/code-review xhigh`
at every model/effort route. No separately billed ultra command or custom review.

Proposed pools are **12 calls, 10 verifier reservations and 1 ownership recovery
for A; 12 calls, 11 verifier reservations and 1 ownership recovery for B**.
These are one cumulative pool per task, including forks, failed launches,
candidate checks and B's final operation. There is no second native-call ceiling
that permits calls beyond the pool. Set `maxIterations:3`, `maxReviewRounds:3`,
`maxPlanRounds:3`, no plan gates and `maxConcurrent:2`. The prepared recovery route
requires at least nine calls/eight verifiers before extra headroom. At most one
same-child formatting correction per stage; it does not create a new stage or
fund another verifier. Exhaustion blocks, including during recovery.

Automatic reverts are outside this proposed authority. If added at agreement,
prepare explicit restoration modes and additional reserved rollback headroom.
Reverting B to A-only content can report `partial`; reverting both documents in
a new empty descendant is deliberately invalid in this verifier. Supporting that
full rollback needs a separately versioned, tested verifier and revised agreement.

## Recovery and evidence

Prepare one controlled owner transfer in a native Claude session, using actual
stopped-owner evidence and the same account. Reconcile wrapper and fork separately
if either exists. Terminal observations do not invent results; uncertainty holds.
The new owner uses the recorded epoch and original pools. A running native child
must not be duplicated. Record Stop delivery separately from heartbeat delivery.
Any heartbeat must remain quiet while nothing actionable changes and stop when
the execution ends or user input is required.

Success requires actual observations on all children, two exact-head built-in
receipts, A merge before B dispatch, two pilot-target merges, the reserved final
complete report and one evidence-backed owner transfer with preserved spending.
This two-task serial dependency pilot does not establish release while unrelated
work continues, or a genuine reasoning escalation unless that actually occurs.
Keep those acceptance rows pending. Finish with the durable records and limitations.

Before launch, present the exact base/target/effects, pinned sources and verifier,
adopted requirements and pools, then capture the user's exact launch agreement.
Earlier capability approvals and this preparation do not authorise the pilot.
