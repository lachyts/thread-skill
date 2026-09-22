# New execution routing and evidence

Candidate source contract, 23 September 2026. Installation and live acceptance
are separate. Use protocol 4; protocol 3 and existing pinned protocol 4 records
keep their original runtime, prompts and accounting.

## Preparation

Create `config.routingPolicy` through the shared `native_routing.mjs`
`createRoutingPolicy` helper. Supply actual same-harness native capabilities,
supported effort labels and an evidence reference. Codex also supplies its
selected native normal model and optional recovery model. Claude's versioned
policy provides the ordinary and recovery bindings. For an agreed resource
ceiling, prepare `recovery: null` through `recoveryModel: null`; retain maximum
effort and the review floor. Legacy `model`, `judgeModel`, `maxTier` and `effort`
engine knobs and per-task model/effort overrides are rejected on this route,
not silently ignored. Exact model intent belongs in the policy snapshot.
Explicit comparison authors
use `exactModel`; never relabel an alternative as that author.

The snapshot contains `version`, `policyDigest`, `harness`, `normal`, `recovery`,
`startingEffort`, `reviewerFloor`, `exactModel` and `capabilities`. See the shared
resolver's `native_routing.md` for the strict schema. The host pins the adapter,
resolver, policy document, engine, state module and merger. It never reloads
today's defaults into an existing execution.

Task `difficulty` may be `easy` or `hard`. The engine treats cross-cutting work,
plan gates and failed recovery as consequential; the coordinator must also mark
architectural uncertainty, concurrency and security-sensitive work `hard`.
File count alone is not difficulty. Ordinary work starts high or xhigh; review
has an xhigh floor. A substantive failed attempt selects maximum supported
effort; a failed maximum correction selects prepared recovery at its maximum.
If recovery is unavailable, the original model continues at maximum within the
same allowance. If a prepared recovery model later becomes unavailable, the
coordinator must supply explicit native evidence through the typed
`modelUnavailable` boundary; generic quota/error text is insufficient. The
engine records this route change without another quality failure and uses only
a remaining bounded candidate/round for the original model at maximum. A failed
final round records the next state without spawning.

Plan, implementation and review round limits must accommodate the route. For
`N = 3` with recovery or `N = 2` without it, initial task pools need at least
`2N` calls and `N + 2` verifier reservations, plus two calls/one verifier when
plan-gated. The two host reservations cover the current integrated post-merge
check and conservative spare capacity for another verification. Authorised rollback reserves add two calls/three verifiers. This
admits one correction path and its review/merge checks; it is not a promise to
fund every possible failure across all layers. Greater headroom is explicit.
All usage remains cumulative; exhaustion stops dispatch. Separate supplementary
checks also spend the same pool.

Preserve `authority.evidence` as `{userText, context, source}`. The first two
fields hold exact user text and the proposal/amendments it covers; `source`
identifies durable message evidence. These are trusted host attestations, not a
way to create permission. Declare every external verifier script/config input
in `repository.verifierInputs` as absolute file paths. Use `[]` only when there
are none. The host captures path, resolved path and byte hash and checks drift
before every mutation and before/after verification. It cannot discover undeclared
indirect shell dependencies; the preparation manifest must be complete.

## Native result collection

Every prompt contains its real JSON result schema. A schema error returns to the
same bound child for formatting correction. Do not edit its verdict or spawn a
replacement, and do not classify formatting as a reasoning failure.

For policy requests, the coordinator adds `envelope.routing` independently of
the child output: `requestId`, `childId`, `policyDigest`, the exact requested and
resolved objects from the native request, and `observed`. A successful result
requires `observed: {model, effort, source: "native-runtime", evidence}` from
actual native spawn/status evidence. Requested settings, a child assertion or
capability inventory alone cannot establish observed effort. Conflicting
profile overrides must be resolved and probed before launch. Unknown or
unavailable settings are incomplete; never silently lower effort.

Successful `review:` results additionally require top-level `reviewReceipt`:

```json
{
  "version": 1,
  "requestId": "<exact native request>",
  "childId": "<independent bound child>",
  "harness": "codex",
  "engine": "review-agent",
  "reviewLevel": "xhigh",
  "reviewedHead": "<full commit SHA actually reviewed>",
  "invocationId": "<actual built-in invocation identity>",
  "nativeEvidence": {"path": "/ABS/native-review-evidence.json"}
}
```

For Claude use `harness: "claude"`, `engine: "code-review"`. The coordinator
captures evidence that the child ran that harness's unmodified built-in review.
Neither a custom review nor the implementer's self-review qualifies. The host
matches child/request/commit/engine/level, captures the evidence bytes immutably,
and binds its digest into approval. This is a trusted native-host evidence
boundary, not cryptographic authentication of arbitrary JSON. The receipt must
come from tool/transcript evidence, never fabricated text. Review-command level
is separate from model reasoning effort. Automatic review uses xhigh; maximum
reasoning never authorises the separately billed `/code-review ultra` service.

## Recovery-model refusal before a child exists

A confirmed launch refusal can be recorded using `unavailable` with `owner`,
`taskId`, `requestId`, `claimToken` and:

```json
{
  "model": "<the prepared recovery model for this claimed request>",
  "source": "native-launch",
  "neverStarted": true,
  "evidence": "<actual native response proving this launch created no child>"
}
```

The operation accepts only this owner's unbound claim and only the prepared
recovery binding. It records denial without inventing a child, approval or
successful work. Exact repeats are idempotent; changed proof is rejected.
The original call/verifier reservation remains spent. `advance` then lets the
canonical engine choose an original-model maximum candidate only if a bounded
round remains. A lost response, timeout or incomplete inventory does not prove
`neverStarted`; recover the actual ownership/child instead.

For a bound recovery child, a non-success `accept` envelope can carry
`modelUnavailable: {model, evidence}` when native evidence explicitly establishes
that route is unavailable. Keep the ordinary native identity/routing attestation;
generic quota text alone is not this typed signal. Permission for a new action
remains an authority blocker, not a reason to select another model.

## Supplementary verification

Use `verify` with `{owner, taskId, operation: {operationId, commit, purpose}}`.
`commit` is a concrete available SHA and `operationId` is stable for that logical
operation. The host reserves one verifier before starting an isolated check,
records its process lease and result, and returns the saved result on exact
replay. Conflicting reuse is rejected. These diagnostics cannot approve or
complete a task. A new logical check needs a new ID and remaining allowance.

Recovery first proves any outstanding verifier process lease stopped. It marks
unfinished checks interrupted, retains their expenditure and never invents
success. If a running operation's lease is missing, supply actual independent
stop evidence in `evidence.verifications[operationId]` as
`{status: "stopped", evidence: "<observed process evidence>"}`; ambiguity holds
recovery. An interrupted operation replay returns its interrupted record.

## Compatibility

No-policy invocations retain the legacy tier algorithm. New source hosts still
require the new review/authority/verifier contract at initialisation. Existing
executions continue using their recorded host, which is not overwritten. New
policy snapshots are immutable: their prepared recovery route replaces ad hoc
`substitute` transitions. A new binding needs a separately prepared execution;
that fact is not permission to reset allowances or relaunch automatically.
