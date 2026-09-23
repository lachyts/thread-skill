# Protocol 4 host payload reference

This is the CLI reference for [rollout-host.mjs](scripts/rollout-host.mjs), backed
by [rollout-state.mjs](scripts/rollout-state.mjs). The host runs the pinned
convergence engine and records evidence. The lead supplies actual native
children through its own harness. Follow the execution procedure in
[SKILL.md](SKILL.md) alongside this reference.

**Every example below is schematic and deliberately contains fake identities or
placeholder paths.** None is evidence, authorisation, a model recommendation or
a command to run unchanged. Replace fields from the actual user's instruction,
verified account/tool availability, current record and native tool responses.
In particular, never invent a child ID, successful output, stop confirmation,
review, approval, no-dispatch observation or merge result to fill a payload.

## New-source evidence and routing contract

This source requires exact authority text/context/source, an explicit external
verifier-input manifest and independent built-in review receipts. New routing is
explicitly selected by `config.routingPolicy`. Claude policy initialisation
selects `config.claudeReviewProtocol: "claude-fork-v1"` and
`evidenceContractVersion: 2`; it requires a fork-capable native adapter and at
least two concurrent slots. Codex and no-policy initialisations retain evidence
contract/receipt version 1, including Claude's legacy tier route. Existing pinned
records retain their own runtime and contracts. The optional mode-report contract
is selected separately by `repository.verifierContract`.
Read [the correction contract](routing-and-evidence.md)
for its complete fields and acceptance boundaries before using these payloads.
The `models` example below illustrates the retained legacy tier route only.
It is not the default model recommendation for new policy executions.

## Calling the CLI and identifying the owner

Invocation shape: `node <HOST_PATH> <COMMAND> <ABSOLUTE_RECORD_DIRECTORY>
<PAYLOAD_JSON_PATH>`. `status` omits the payload path. These are argument
placeholders, not shell redirections. Save JSON as a file; do not interpolate
evidence or requirements into a shell command.

Initialisation uses the installed host. It returns `pinnedHost`; use that exact
path for later operations on the record. Runtime changes elsewhere do not
upgrade this execution. The record directory must be private (mode 700),
absolute and not a symlink. `init` refuses an existing record.

| Command | Top-level payload keys | Result / purpose |
| --- | --- | --- |
| `init` | `spec`, `owner`, `config` | Verify the fetched baseline; pin the runtime and exact requirements; create the execution. |
| `status` | No payload | Read the view without taking ownership or mutating state. |
| `advance` | `owner` | Reconcile source changes, drain resolved superseded work, replay engine results, admit ready tasks and settle the execution. |
| `claim` | `owner`, `taskId`, `requestId` | Reserve allowance and native capacity before spawning. |
| `bind` | `owner`, `taskId`, `requestId`, `claimToken`, `childId` | Record the actual child returned by the native spawn tool. |
| `bind-review-fork` | `owner`, `taskId`, `requestId`, `claimToken`, `binding` | Bind the distinct fork child and invocation after the built-in's actual launch. |
| `record-review-fork` | `owner`, `taskId`, `requestId`, `claimToken`, `proof`, `nativeEvidence` | Record observed fork completion/terminal/no-launch evidence and capture its evidence file immutably. |
| `unavailable` | `owner`, `taskId`, `requestId`, `claimToken`, `proof` | Record a proven refusal of the prepared recovery model before any child exists; preserve the spent claim. |
| `accept` | `owner`, `taskId`, `envelope`, `reviewReceipt` for successful review | Validate and accept an observed native result. |
| `verify` | `owner`, `taskId`, `operation` | Reserve and run supplementary verification exactly once per operation ID. |
| `merge` | `owner`, `taskId` | Recheck the current approval and repository, invoke the pinned merger, then verify the integrated result. |
| `transition` | `owner`, `command` | Apply a supported explicit domain transition. |
| `recover` | New `owner`, `evidence` | Transfer a stopped owner's execution and native runs using observed evidence. |

Ordinary mutations require `owner.harness`, `owner.account`, `owner.session` and
`owner.epoch` to match the execution. Build this object from the latest
`status.owner` identity, with `epoch` set from **top-level `status.epoch`**.
An old payload must not be reused after ownership transfer or relaunch.

There are two independent epoch scopes:

| Field | Meaning | Where to obtain it |
| --- | --- | --- |
| Top-level payload `owner.epoch` | Current domain execution ownership generation. It increases on recovery and relaunch. | Top-level `status.epoch`. |
| `envelope.caller.epoch` | Ownership generation of this particular native run. Each newly initialised native run starts at 1. | Copy the request's **`resultCaller` object exactly** from the current host view. |

For example, an execution can have domain epoch 7 while a new native attempt is
at epoch 1. Do not copy 7 into that native envelope. The request's `caller` may
describe its original launch owner after recovery; `resultCaller` describes the
current owner who must attest a new result. A successful `claim` also returns
the correct native `caller` for that moment. Refresh it if recovery intervenes.
The host supplies native contexts internally; this CLI takes owner fields from
the payload rather than the standalone adapter's environment variables.

## Initialisation

Schematic `init` payload:

```json
{
  "owner": {
    "harness": "codex",
    "account": "<verified-current-account>",
    "session": "<actual-native-session>",
    "epoch": 1
  },
  "spec": {
    "protocolVersion": 4,
    "rolloutId": "example-rollout",
    "repository": {
      "path": "/ABS/REPOSITORY",
      "identity": "github.com/EXAMPLE/REPOSITORY",
      "baseBranch": "<actual-base-branch>",
      "verifier": "<configured-repository-verifier-command>",
      "verifierInputs": []
    },
    "authority": {
      "outcomes": ["<authorised outcome>"],
      "constraints": ["<actual constraint>"],
      "allowedActions": ["merge"],
      "reservedDecisions": ["<decision retained by the user>"],
      "gates": [],
      "mergeEffects": [],
      "evidence": {"userText":"<exact user instruction>","context":"<exact proposal and amendments approved>","source":"<durable conversation evidence>"}
    },
    "tasks": [
      {
        "id": "example-task",
        "sourcePath": "/ABS/TASK-NOTE.md",
        "requirements": "<exact complete contents of the source file, including newlines>",
        "acceptance": ["<objective acceptance check>"],
        "dependsOn": [],
        "conflicts": [],
        "scope": "single-file",
        "planGate": false,
        "allowance": {"calls": 12, "verifierRuns": 30, "recoveries": 2}
      }
    ]
  },
  "config": {
    "nativeAdapter": "/ABS/native_workflow.mjs",
    "account": "<same-verified-current-account-as-owner>",
    "maxConcurrent": 3,
    "models": {
      "opus": {"model": "<available-native-first-tier-model>"},
      "fable": {"model": "<available-native-higher-tier-model>"}
    },
    "roles": {},
    "engine": {"maxIterations": 3, "maxPlanRounds": 2, "maxReviewRounds": 2},
    "verifierTimeoutMs": 600000,
    "mergeTimeoutMs": 600000
  }
}
```

The illustrative allowances are finite numbers, not defaults to copy. All three
task allowances and all three engine budgets must be positive safe integers.
`maxConcurrent` must fit actual available native child capacity. Calls and
conservative verifier reservations are debited before dispatch; retries,
recovery, revised requirements and prerequisites do not replenish them. A task
cannot obtain fresh allowance merely by changing its model or attempt.
For Claude policy reviews, the claim debits **two calls and reserves two slots**
from that same pool before either wrapper or fork starts. Both slots stay occupied
while the wrapper remains active, even after its fork finishes. Reservations are
not refunded after refusal, interruption or unused capacity.

For prepared policy runs, let `N` be 3 when the snapshot has a recovery binding,
otherwise 2. Initial per-task minimums are `3N` calls for Claude fork review or
`2N` for Codex; verifier minimums are `2N + 2` with a report contract and `N + 2`
without one. Add two calls/one verifier for a plan gate. Authorised rollback adds
three Claude-fork calls or two other calls, plus four verifiers with reports or
three without. These are finite preparation floors, not allowance renewals or
funding for every combination of failures. Round ceilings must also accommodate
N; see [the accounting table](routing-and-evidence.md#preparation).

`sourcePath` must be absolute. `requirements` must equal the entire file read as
UTF-8, including its final newline. The host adopts an immutable copy; editing
the source later requires assessment. Task IDs use letters, digits, dots,
underscores or hyphens and start with a letter or digit. Dependency/conflict IDs
must exist; dependencies cannot cycle. This host currently accepts PR-shaped
tasks, not `scope: "read-only"` tasks. `cross-cutting` scope defaults to a plan
gate; explicit `planGate` affects dispatch. Task `model` and `effort` are legacy
options only and are rejected with `routingPolicy`.

The repository identity is checked against `origin`. Omit `baseBranch` only when
the host should resolve GitHub's actual default branch. Initialisation fetches
that branch and runs the baseline verifier in an isolated checkout; it is not
a read-only configuration validation.

`authority` is the recorded authorisation, not a suggested grant. All six arrays
are required. `outcomes` must be non-empty and `allowedActions` must already
include authorised `merge`. `gates` contains only actual covered/signed-off gate
strings; writing a string does not create consent. If a workflow has deployment
or publication effects, record their actual authorisation as entries such as
`{"path":".github/workflows/EXAMPLE.yml","authorised":true,"description":"<actual covered effect>"}`
in `mergeEffects`. The host checks the base and prospective merge content. An
empty array cannot authorise an unrecognised effect.

Add `revert-run-owned` to `allowedActions` only when that action is authorised.
Its reserve remains inside each original task pool: three calls with Claude fork
review, otherwise two; four verifier runs with mode reports, otherwise three.
Prepared policy minima include this reserve. Automatic
rollback remains limited to recorded run-owned squash commits, a separately
reviewed rollback PR and verification. It does not satisfy the original outcome.

### Optional verifier-report contract

Add this to `spec.repository`, with mode names chosen for the one immutable
verifier command. The example names are schematic:

```json
{
  "verifierContract": {
    "version": 1,
    "baselineModes": ["baseline"],
    "rollbackModes": ["baseline", "partial"]
  }
}
```

Every task then supplies a nonempty unique `verifierModes` list, for example
`["partial", "complete"]` for task A and `["complete"]` for task B. Mode names
match `[A-Za-z0-9][A-Za-z0-9._-]*`; empty, duplicate or malformed lists fail
preparation. `rollbackModes` is optional unless `revert-run-owned` is authorised,
when it is required explicitly. Its values describe valid rollback outcomes,
not permission to revert. Task modes without the repository contract are rejected.

The verifier must emit JSON with only `mode` and `head` on stdout. `head` must
equal the exact commit checked. An exit-zero malformed/stale report fails; a
valid mode outside the applicable list also fails acceptance. Baseline uses
`baselineModes`, ordinary task attempts use their `verifierModes`, and rollback
attempts use `rollbackModes`. The command itself never changes by task or stage.

Before approval, the host fetches the actual reviewed PR head and reserves one
verifier for an isolated candidate acceptance operation. Its stable ID is
`candidate-<attemptId>-<head>`; exact replay returns the recorded operation,
conflicting inputs fail, and an interrupted operation never becomes success.
This reuses `verify`'s durable allowance/process machinery. After merge, a separate
integrated check applies the same task-specific acceptance modes to the integrated
commit. A supplementary final check cannot substitute for either. A digest linking
B's document to A proves bytes only: dependency release requires host `dependsOn`,
actual verified merge evidence and dispatch chronology.

### Legacy model and role bindings

Model/tier bindings must name models actually available in this harness and
account. Uncapped execution requires explicit, distinct `opus` and `fable` model
bindings. `inherit: true` is an adapter binding option, but does not satisfy
that uncapped distinct-model check. If the approved run has the quota ceiling,
set `config.engine.maxTier` to `"opus"`; retain finite budgets and honest model
provenance. A capped run is not evidence that a higher tier was tried. Omission
is uncapped. Never use `ignoreGate`.

`roles` maps canonical specialised role names to available native roles, for
example `{"external-judge":"<verified-native-role>"}` when that role is
requested. General-purpose requests use the default role. Missing model or role
bindings block instead of invoking another provider. Optional engine settings
include `model`, `judgeModel` and `envBootstrap`; they do not expand authority.

## Status and ordinary progress

`status` needs no payload or caller claim. It returns `owner`, `epoch`,
`executionId`, `execution`, `rolloutComplete`, `ready`, `requests`,
`readyToMerge`, `allowances`, `assessments`, `interrupt`, `mergeHold`,
`recoveryPending`, `pinnedHost` and `continuation`. A lock changes the reported
continuation to owner reconciliation; it does not prove useful work is running.

Schematic `advance` payload:

```json
{
  "owner": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":7}
}
```

Read the returned view to decide the next operation. `advance` does not spawn
native children, collect their outputs or merge all approved PRs. A successful
CLI exit does not mean the rollout completed: inspect the result. Exceptions
produce an error object on stderr and exit 1. A claim can return a blocked
result without spawning anything when allowance is unavailable.

## Claim, bind and accept

Choose a current request with `claimable: true`. Schematic `claim` payload:

```json
{
  "owner": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":7},
  "taskId": "example-task",
  "requestId": "<request-id-from-current-view>"
}
```

After a successful claim, spawn exactly one ordinary child using the returned prompt,
schema, native role/model binding and clean context through this harness's
native tools. Never spawn before claiming, or redispatch a claim whose outcome
is uncertain. Immediately save the actual returned child ID with `bind`:

```json
{
  "owner": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":7},
  "taskId": "example-task",
  "requestId": "<claimed-request-id>",
  "claimToken": "<token-returned-by-claim>",
  "childId": "<actual-native-spawn-result-id>"
}
```

For `claude-fork-v1` that ordinary child is the wrapper; the unmodified built-in
invoked by that wrapper creates its separately reserved fork. Follow the fork
operations below instead of accepting a launch acknowledgement as a result.

Independent stages need distinct children. The lead session is not a child.
Use native wait/status tools to obtain the actual result. The lead then saves
an `accept` payload; the child must not attest or accept its own result:

```json
{
  "owner": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":7},
  "taskId": "example-task",
  "envelope": {
    "version": 1,
    "runId": "<native-run-id-from-request>",
    "requestId": "<claimed-request-id>",
    "claimToken": "<recorded-claim-token>",
    "childId": "<actual-bound-native-child-id>",
    "caller": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":1},
    "status": "ok",
    "output": {"EXAMPLE_ONLY":"Replace this entire object with the observed schema-valid child output"}
  }
}
```

Here the schematic domain epoch is 7 and native epoch is 1. In a real payload,
copy `envelope.caller` from **that request's current `resultCaller`**, without
adding/removing fields. `output` must satisfy the supplied `options.schema` and
cannot be null. For `blocked`, `denied` or `interrupted`, replace `status`, omit
`output`, and supply `reason` with the observed evidence. Timeout or silence
does not prove interruption, approval or success. Keep a running child pending
collection; the canonical engine decides any retry after a confirmed failure.

Exact previously accepted envelopes can be replayed by the current owner,
including their original caller attestation after recovery. Changed content or
attestation conflicts. An old owner's invocation is fenced even when carrying
an identical envelope. New results require the current `resultCaller`.
After accepting results, call `advance` to replay the engine and expose the
next requests or reviewed task.

## Claude fork binding, result and relay

These operations apply only to requests whose `options.reviewContract.protocol`
is `claude-fork-v1`. The wrapper invokes the unmodified `/code-review xhigh`
exactly once against the concrete reviewed head. Use Skill-capable definitions
for every resolved route: normal xhigh, normal maximum, and recovery maximum.
Reasoning effort is separate from the command level. Observe each process's
actual binding; inherited defaults or a wrapper observation cannot prove the
fork's model/effort. Do not invoke the billed `/code-review ultra` service.

After ordinary `bind` records the wrapper, observe the built-in's real fork
launch and send `bind-review-fork`:

```json
{
  "owner": {"harness":"claude","account":"<verified-account>","session":"<current-session>","epoch":7},
  "taskId": "example-task",
  "requestId": "<claimed-review-request>",
  "claimToken": "<recorded-token>",
  "binding": {"childId":"<actual-fork-child>","invocationId":"<actual-built-in-invocation>"}
}
```

The fork child and invocation identities must be distinct from each other and
from owner/wrapper/other request identities. Exact binding replay is idempotent;
another identity conflicts. After actual completion, use `record-review-fork`:

```json
{
  "owner": {"harness":"claude","account":"<verified-account>","session":"<current-session>","epoch":7},
  "taskId": "example-task",
  "requestId": "<same-review-request>",
  "claimToken": "<same-recorded-token>",
  "proof": {
    "childId": "<bound-fork-child>",
    "invocationId": "<bound-built-in-invocation>",
    "status": "complete",
    "reviewedHead": "<exact-request-reviewContract-reviewedHead>",
    "output": "<entire verbatim native fork output, including whitespace>",
    "routing": {
      "requestId": "<same-review-request>",
      "childId": "<bound-fork-child>",
      "policyDigest": "<pinned-policy-digest>",
      "requested": {"COPY_EXACT_OBJECT":"request.native.routing.requested"},
      "resolved": {"COPY_EXACT_OBJECT":"request.native.routing.resolved"},
      "observed": {"model":"<actual-fork-model>","effort":"<actual-fork-effort>","source":"native-runtime","evidence":"<actual-fork-runtime-evidence>"}
    },
    "evidence": "<actual native fork completion evidence>"
  },
  "nativeEvidence": {"path":"/ABS/NATIVE-FORK-EVIDENCE.json"}
}
```

Replace the two `COPY_EXACT_OBJECT` placeholders with the complete existing
objects, not new routing decisions. Complete proof requires the exact reviewed
head, a string output and matching observed fork provenance. `nativeEvidence.path`
must be an absolute nonempty file; optional `sha256` must match its bytes. The
host captures it immutably. Exact proof and evidence-byte replay is idempotent;
changed proof or captured bytes conflict. The request exposes its durable
`reviewFork.resultHash` and `reviewFork.outputHash`.

The wrapper stays pending while the fork runs. The lead relays **all verbatim
findings to that same wrapper** using actual native same-child messaging. It must
not create a replacement, edit the verdict, rerun review or treat "launched" as
completion. The wrapper returns the unchanged `{verdict,feedback,reviewedHead}`
result only after findings arrive. Accept its ordinary envelope with its own
native routing observation and top-level receipt v2:

```json
{
  "version": 2,
  "requestId": "<same-review-request>",
  "childId": "<bound-wrapper-child>",
  "harness": "claude",
  "engine": "code-review",
  "reviewLevel": "xhigh",
  "reviewedHead": "<same-exact-reviewed-head>",
  "invocationId": "<bound-built-in-invocation>",
  "fork": {"childId":"<bound-fork-child>","resultHash":"<recorded-reviewFork.resultHash>"},
  "relay": {"childId":"<same-bound-wrapper-child>","outputHash":"<recorded-reviewFork.outputHash>","evidence":"<actual-native-same-child-delivery-evidence>"},
  "nativeEvidence": {"path":"/ABS/NATIVE-REVIEW-AND-RELAY-EVIDENCE.json"}
}
```

This object belongs in `accept.reviewReceipt`, outside the wrapper's verdict.
`resultHash` identifies the whole recorded fork proof; `outputHash` hashes the
exact UTF-8 findings string, including whitespace. The host checks these against
the completed fork and same wrapper, then captures the receipt evidence file.
Keep `envelope.caller` from the current `resultCaller`, not the domain epoch.
Codex and retained non-fork requests use receipt v1 with no fork/relay fields;
see [their receipt shape](routing-and-evidence.md#native-result-collection).

For a bound fork that stopped without successful findings, `proof` is
`{childId, invocationId, status: "terminal", evidence}` with no output. Optional
`reviewedHead` and `routing` are validated when present. An unbound reservation
proven never launched uses exactly `{status: "not-started", evidence}`, without
invented IDs, head, output or routing. Both still require `nativeEvidence` at the
host boundary. They permit only non-success wrapper acceptance; a successful
wrapper requires `complete`. Resolve that fork reservation before recording an
unbound recovery-wrapper launch refusal with `unavailable`. Neither operation
refunds either call. Missing/ambiguous evidence keeps both processes held.

## Merge

Schematic `merge` payload for a task in `readyToMerge`:

```json
{
  "owner": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":7},
  "taskId": "example-task"
}
```

Supply no PR, approval, SHA or success claim in this payload. The host uses the
recorded independent review, verification and current approval; checks the
actual PR/base/head and merge effects; serialises repository merging; and invokes
the pinned merger. A changed base or head requires fresh integration and
verification/review of the existing PR. Queue acceptance leaves the task waiting.
Only observed merge plus successful post-merge integration verification completes
an outcome. With a verifier-report contract, both the reserved host candidate
check before approval and the integrated check must accept the task's mode and
exact head. Exit 0 in another valid repository mode is insufficient. A failed
integrated verifier creates a repository merge hold.

Re-run `merge` when fresh queue evidence needs reconciliation. Do not call it a
successful merge just because submission succeeded. `advance` owns draining and
superseded queue reconciliation; never manufacture a `drained`, `merge-observed`,
`converged`, `regression` or `clear-hold` transition.

## Explicit transitions

Every public transition uses this wrapper; replace `command` with one of the
objects below:

```json
{
  "owner": {"harness":"codex","account":"<verified-account>","session":"<current-native-session>","epoch":7},
  "command": {"type":"pause"}
}
```

| `command` | Preconditions and effect |
| --- | --- |
| `{"type":"pause"}` | From running: stop admitting new tasks; allow already active tasks to finish their remaining stages and approved merges. Settles to paused after active work drains. |
| `{"type":"stop"}` | Stop further dispatch/merge. It does not kill native children: use actual native interrupt/wait tools for the returned `interrupt` items and collect their real disposition. |
| `{"type":"resume"}` | Resume paused, stopped or ended execution using its remaining allowance. It neither clears blocks nor replenishes budgets. |
| `{"type":"settle"}` | Recompute paused/ended status from actual activity and readiness. `advance` normally performs this. |
| `{"type":"retry","taskId":"example-task"}` | Reopen an inactive, unfinished member with remaining allowance. No new pool or allowance. Resume the execution too if it has ended. |
| `{"type":"invalidate","taskId":"example-task","reason":"<what changed>","evidence":"<observed evidence>"}` | Invalidate the task and affected dependants. Active attempts become superseded/draining; resolve their actual children before the host drains them. |
| `{"type":"defer","scope":["example-task","example-dependent"]}` | Remove inactive tasks from membership; include their whole dependent closure. Does not erase history. |
| `{"type":"relaunch","scope":["example-task"],"instruction":"<actual explicit user relaunch instruction>"}` | Only after the execution ended. Create a new execution for the named unfinished member scope with its explicitly renewed allowance. Preserve history and any unresolved repository hold. The returned domain epoch increases. |

Resume, retry, revise, prerequisite discovery, recovery and substitution never
reset allowance. **Relaunch is the explicit renewal boundary**, not an automatic
retry path. Do not infer that authorisation from elapsed time, a new session or
quota returning. Re-read the returned owner/epoch after relaunch; new native runs
still start at their own epoch 1.

### Adopt a requirements revision

Edit the source through the authorised task workflow, then submit its exact
complete new contents. Source changes block adoption until assessed against the
existing authority. Schematic `command`:

```json
{
  "type": "revise",
  "taskId": "example-task",
  "requirements": "<exact complete current source file contents>",
  "assessment": {
    "withinAuthority": true,
    "authorityHash": "<actual-state.json-authorityHash>",
    "evidence": "<reasoned comparison with the recorded outcomes, constraints, actions and reserved decisions>"
  }
}
```

Obtain `authorityHash` from the record read-only. The boolean is an attestation
of that assessment, not permission to expand authority. The host checks exact
source equality, records a new immutable revision and invalidates dependent
approvals/outcomes. Any active attempt drains under host control before its
replacement starts. Spent allowance survives the revision.

### Cover a declaration with existing authority

An inactive task whose current attempt returned `gate-pending` may have used a
different declaration for an action and limit already authorised. Assess that
exact declaration against the unchanged rollout authority, then record the
mapping with this schematic `command`:

```json
{
  "type": "cover-gate",
  "taskId": "example-task",
  "declaration": "<exact string in this current attempt's gatedInputs>",
  "assessment": {
    "withinAuthority": true,
    "authorityHash": "<actual-state.json-authorityHash>",
    "evidence": "<which existing authorisation covers this exact action and limits, and why>"
  }
}
```

The host rejects undeclared gates, stale or superseded attempts, unassessed
requirements and missing authority assessment. This records coverage only;
the original authority and spent allowance remain unchanged. The task stays
blocked until an explicit `retry`; use `resume` with the same remaining
allowance if execution has ended and the current instruction authorises
continuing. Never silently clear a deliberate pause or immediate stop. A
heartbeat does not reopen an ended execution by itself.

Only mappings for the current revision and authority are supplied to the next
engine attempt, together with their assessment evidence for independent review.
A new requirement revision requires a new assessment. This operation cannot
authorise new spending, credentials, actions or higher limits; genuinely absent
authority remains a blocker.

### Add a prerequisite within the same pool

The parent must be inactive; first resolve its children and let the host drain
any superseded attempt. Create the prerequisite's actual source and assess its
scope. Schematic `command`:

```json
{
  "type": "prerequisite",
  "taskId": "example-task",
  "task": {
    "id": "example-prerequisite",
    "sourcePath": "/ABS/PREREQUISITE.md",
    "requirements": "<exact complete prerequisite source file contents>",
    "acceptance": ["<objective acceptance check>"],
    "dependsOn": [],
    "conflicts": [],
    "scope": "single-file",
    "allowance": {"calls":12,"verifierRuns":30,"recoveries":2}
  },
  "assessment": {
    "withinAuthority": true,
    "authorityHash": "<actual-state.json-authorityHash>",
    "evidence": "<why this prerequisite remains inside existing authority>"
  }
}
```

The task-shaped input requires valid positive allowance fields; copy the
parent's values. The domain replaces them with the parent's allowance and
assigns the **same pool**, so this adds no fresh calls, verifier runs or recovery
budget. It adds the dependency and invalidates the parent's affected outcomes.

### Substitute available native model bindings (legacy tier route)

This transition is unavailable with a pinned `routingPolicy`: its prepared recovery binding is the only automatic model substitution for that execution. Changing the policy requires a separately prepared new execution, not a mutation of a running or historical record.

For an inactive unfinished task with remaining allowance, the same owner may
record an actually available same-account model mapping:

```json
{
  "type": "substitute",
  "taskId": "example-task",
  "models": {
    "opus": {"model":"<verified-available-first-tier-model>"},
    "fable": {"model":"<verified-available-higher-tier-model>"}
  },
  "evidence": "<actual native availability and suitability evidence>"
}
```

The host validates and preserves these settings, then retries within the same
pool. It retains the existing role map and engine quality gates. This command
cannot change harness, account, engine budgets, gate policy or tier ceiling;
do not include those fields or assume the adapter silently substitutes another
provider. Uncapped bindings still need distinct explicit native models.

## Ownership recovery

Use `recover` only after actual native evidence establishes that the previous
owner stopped and resolves every claimed/dispatched request. Confirm the new
session is on the same harness and account. The top-level new `owner.epoch` is
the current domain epoch plus one; `evidence.previousEpoch` is that current
domain epoch. Unlike the standalone adapter's narrower identity shape, the
host's `evidence.previousCaller` includes **harness, account and session**, with
no epoch field.

Schematic payload, showing both observed terminal and verified never-started
cases. Use only request IDs actually present in the journals:

```json
{
  "owner": {"harness":"codex","account":"<same-verified-account>","session":"<new-actual-native-session>","epoch":8},
  "evidence": {
    "previousCaller": {"harness":"codex","account":"<same-verified-account>","session":"<previous-actual-native-session>"},
    "previousEpoch": 7,
    "previousOwnerStopped": true,
    "reason": "<actual native evidence that the previous owner stopped>",
    "requests": {
      "<request-with-an-actual-child>": {
        "childId": "<actual-native-child-id>",
        "status": "terminal",
        "evidence": "<native status/wait response identifying this exact terminal child>"
      },
      "<unbound-claim-proven-never-launched>": {
        "status": "not-started",
        "evidence": "<actual launch-history and inventory proof that no spawn occurred>"
      }
    }
  }
}
```

Supply `running` instead of `terminal` for a child observed still running. Both
keep the request dispatched; a terminal observation is not an accepted output.
The new owner must collect the result and use `accept` with the refreshed
request `resultCaller`. An unbound ambiguous claim normally needs its actual
child recovered; never clear it merely because a response is missing.

`not-started` is permitted only for a claim with no bound child and positive
native evidence that it never launched. Omit `childId`. It records interruption
without a fictional child or result and without refunding spent allowance.
Only the canonical engine may decide to retry it. Silence, timeout or an
incomplete inventory is not no-dispatch proof.

For every outstanding Claude review fork, include a separate observation inside
that request's evidence. For example:

```json
{
  "childId": "<actual-wrapper-child>",
  "status": "terminal",
  "evidence": "<actual wrapper terminal evidence>",
  "reviewFork": {
    "childId": "<actual-fork-child>",
    "invocationId": "<actual-built-in-invocation>",
    "status": "running",
    "evidence": "<separate native fork status evidence>"
  }
}
```

Fork `running` and `terminal` observations both preserve a dispatched fork until
the new owner records its separate complete/terminal result. Recovery may discover
an actual previously unbound fork, but cannot change any already-bound identity.
An unbound reserved fork with positive no-launch evidence instead uses
`reviewFork: {status: "not-started", evidence: "<native proof>"}`. A never-started
wrapper requires a never-started fork too, either already recorded or resolved
in this transfer. A dead wrapper does not prove its fork stopped.

Omit `reviewFork` observations for already complete, terminal or not-started fork
results; they remain immutable. Recovery validates every native run before
pinning its transfer intent. Missing or ambiguous fork evidence blocks transfer,
and identities cannot be reused across runs. Both reserved calls stay spent;
ownership recovery never converts a launch acknowledgement into a verdict.

Cover the host's outstanding claims and every claimed/dispatched request in
its recorded native runs. The host translates the domain recovery to each
run's own epoch; do not substitute the domain epoch into native journals. Each
active pool spends recovery allowance once for the successful domain transfer.
Ordinary task allowance is preserved.

A transfer interrupted part-way leaves `recoveryPending` and blocks ordinary
mutations. Retry **the exact same owner and evidence payload** to finish it;
do not build a new transfer against a partially changed picture. Exact completed
recovery delivery is idempotent. A previous owner or old epoch cannot retake the
execution using old stop evidence, including when a session identity is reused.

Recovery examines locks it handles and releases one only when its recorded PID
is demonstrably dead and its recorded identity remains unchanged. A dead helper
PID does not itself prove the native lead or child stopped. A live, ambiguous
or changed lock remains a block; age alone never grants takeover. Never edit
the journals or remove a lock to force dispatch.

The repository merger lease also records its process group before permitting
the command to start. A local supervisor stops that group if its parent host
disappears. Recovery checks that the group has stopped before releasing the
lease; a dead host PID alone is insufficient. Unknown legacy leases remain
blocked. Terminating a local process does not establish what GitHub already
accepted, so the durable merge intent still needs outcome reconciliation.

This protocol records trusted local host attestations. Passing fixture tests,
having request IDs, or filling these JSON shapes does not prove a live native
child, authenticated account, independent review or recovered owner. Obtain
those facts from the actual native tools before asserting them here.
