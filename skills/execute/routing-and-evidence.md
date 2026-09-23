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

New Claude policy executions select `config.claudeReviewProtocol: "claude-fork-v1"`
at initialisation and use evidence contract version 2. The adapter must support
durable fork binding/results and `maxConcurrent` must be at least 2. Every code
review reserves two calls and two concurrent native slots together: the wrapper
and its built-in fork. Both slots remain reserved while the wrapper is active,
even if the fork finishes first. Unused or interrupted reservations stay spent.
Codex policy reviews retain the one-child contract and receipt version 1.

Plan, implementation and review round limits must accommodate the route. The
host uses `N = 3` when the prepared snapshot contains a recovery binding and
`N = 2` when it is null. Its per-task preparation minimums are:

| Original pool | Claude fork protocol | Codex policy |
| --- | --- | --- |
| Calls | `3N` | `2N` |
| Verifiers with the report contract below | `2N + 2` | `2N + 2` |
| Verifiers without a report contract | `N + 2` | `N + 2` |
| Plan-gated addition | 2 calls, 1 verifier | 2 calls, 1 verifier |
| Authorised rollback addition | 3 calls; 4 verifiers with reports, otherwise 3 | 2 calls; 4 verifiers with reports, otherwise 3 |

The report-contract minimum covers engine candidate runs and host candidate
acceptance checks; the remaining two verifiers provide the current integrated
postmerge check and conservative spare capacity. Rollback capacity is reserved
inside the original pool. These minima admit one correction path and its
review/merge checks, not every possible failure across all layers. Greater
headroom is explicit. Usage remains cumulative; exhaustion stops dispatch.
Supplementary checks spend the same pool.

Preserve `authority.evidence` as `{userText, context, source}`. The first two
fields hold exact user text and the proposal/amendments it covers; `source`
identifies durable message evidence. These are trusted host attestations, not a
way to create permission. Declare every external verifier script/config input
in `repository.verifierInputs` as absolute file paths. Use `[]` only when there
are none. The host captures path, resolved path and byte hash and checks drift
before every mutation and before/after verification. It cannot discover undeclared
indirect shell dependencies; the preparation manifest must be complete.

## Task verifier reports

An optional immutable `repository.verifierContract` has
`{version: 1, baselineModes: [...]}` and may also declare `rollbackModes: [...]`.
Every task then requires `verifierModes: [...]`; modes without a repository
contract are rejected. Each list must be nonempty and unique, using strings
matching `[A-Za-z0-9][A-Za-z0-9._-]*`. Only these contract keys are supported.
If `revert-run-owned` is authorised, explicit `rollbackModes` is required: the
host never guesses that a normal task completion mode proves a successful revert.

The existing single verifier command emits only JSON `{mode, head}` on stdout.
Exit 0 alone is insufficient. The reported head must equal the full commit being
checked, and the mode must belong to `baselineModes` for initialisation,
`task.verifierModes` for ordinary candidates/integrated results, or `rollbackModes`
for rollback attempts. Missing/malformed JSON, extra report keys or a stale head
turn an exit-zero process into failed verification. A valid repository mode
outside this task's list still cannot approve or complete that task.

After native convergence, the host fetches the actual reviewed PR head and runs
an isolated candidate acceptance check before recording approval. It reserves
one verifier from the existing pool, journals the operation under
`candidate-<attemptId>-<head>` and reuses the exact completed result on replay;
conflicting inputs are rejected. This uses the same durable process/operation
machinery as supplementary `verify`. After an actual merge, a separate integrated
check must satisfy the same task modes at the integrated commit. A later final
check cannot replace either gate. A wrong integrated mode creates a merge hold.

For example, baseline may accept `baseline`, A may accept `partial` or `complete`,
and B only `complete`. B cannot finish on an exit-zero `partial` report. A digest
link from B to A proves matching bytes only; host dependencies, verified merge
evidence and actual dispatch chronology establish prerequisite release.

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

Successful Codex and non-fork `review:` results additionally require top-level
`reviewReceipt` version 1:

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

For the retained Claude non-fork route use `harness: "claude"`,
`engine: "code-review"`. The coordinator captures evidence that the child ran
that harness's unmodified built-in review.
Neither a custom review nor the implementer's self-review qualifies. The host
matches child/request/commit/engine/level, captures the evidence bytes immutably,
and binds its digest into approval. This is a trusted native-host evidence
boundary, not cryptographic authentication of arbitrary JSON. The receipt must
come from tool/transcript evidence, never fabricated text. Review-command level
is separate from model reasoning effort. Automatic review uses xhigh; maximum
reasoning never authorises the separately billed `/code-review ultra` service.

### Claude fork review and receipt v2

For `claude-fork-v1`, the request carries
`reviewContract: {protocol: "claude-fork-v1", engine: "claude-code-review", level: "xhigh", reviewedHead}`.
The concrete head is required. Claim before either process starts, then bind the
wrapper normally. It invokes the unmodified `/code-review xhigh` exactly once,
using the Skill-capable definition for its resolved binding: normal xhigh,
normal maximum after a quality failure, or recovery maximum after the second.
The actual wrapper and fork observations must each match that resolved route.

Use `bind-review-fork` to save the observed distinct fork `childId` and
`invocationId`, then `record-review-fork` to save its exact `reviewedHead`,
verbatim string output, separate fork routing provenance and native completion
evidence. The host also captures a nonempty native evidence file immutably.
The fork routing object retains the original request's `requested` and `resolved`
objects but names the fork child and its own runtime observation. A wrapper
observation cannot stand in for fork provenance. Exact repeats are idempotent;
changed identities, proof or evidence bytes conflict.

"Launched" is not completion. While findings are pending the wrapper waits; the
lead relays the completed fork's full verbatim findings to that same wrapper
through native same-child messaging. The wrapper preserves every finding and
returns the unchanged `{verdict, feedback, reviewedHead}` schema. No replacement
child, custom review, second built-in invocation or lead-authored verdict is
permitted. The lead accepts its ordinary envelope with the wrapper's own routing
provenance and this additional receipt (all placeholders are schematic):

```json
{
  "version": 2,
  "requestId": "<original review request>",
  "childId": "<bound wrapper child>",
  "harness": "claude",
  "engine": "code-review",
  "reviewLevel": "xhigh",
  "reviewedHead": "<exact verified and reviewed commit>",
  "invocationId": "<bound built-in invocation>",
  "fork": {"childId": "<bound fork child>", "resultHash": "<recorded reviewFork.resultHash>"},
  "relay": {
    "childId": "<same bound wrapper child>",
    "outputHash": "<SHA-256 of the exact verbatim fork output string>",
    "evidence": "<actual native same-child delivery evidence>"
  },
  "nativeEvidence": {"path": "/ABS/native-review-and-relay-evidence.json"}
}
```

Copy `resultHash` from the recorded fork; it hashes the complete proof, not just
the findings. `relay.outputHash` must match the findings' exact UTF-8 bytes
(also exposed as `reviewFork.outputHash`). Receipt identities, invocation, head
and relay target must match the bound request. Optional `nativeEvidence.sha256`
must match the captured file. These remain trusted host attestations of actual
tool/transcript evidence, not authentication conferred by filling JSON fields.

Successful wrapper acceptance requires a complete fork. Before accepting a
blocked/denied/interrupted wrapper, separately resolve the fork as complete,
terminal without successful output, or proven not-started. An unbound fork
reservation accepts only `{status: "not-started", evidence}`; never invent IDs.
A bound terminal fork retains its actual child/invocation IDs. Timeout alone
resolves neither process. Ownership recovery must include `reviewFork` evidence
for every outstanding reservation/fork; `running` or `terminal` observations
preserve it as dispatched until its separate result is recorded. Omit already
resolved fork observations and preserve their immutable results. See the exact
[host payloads](host-api.md#claude-fork-binding-result-and-relay).

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
For a fork-review wrapper refused before launch, first record native proof that
its reserved fork was also not started. `unavailable` cannot discard that second
reservation or refund either call.

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

No-policy invocations retain the legacy tier algorithm and single-child receipt
v1, including Claude. New Claude **policy** initialisations require the fork
protocol/receipt v2; Codex retains receipt v1. New source hosts require exact
authority and declared verifier-input evidence; the mode-report contract remains
an explicit opt-in. Existing
executions continue using their recorded host, which is not overwritten. New
policy snapshots are immutable: their prepared recovery route replaces ad hoc
`substitute` transitions. A new binding needs a separately prepared execution;
that fact is not permission to reset allowances or relaunch automatically.
