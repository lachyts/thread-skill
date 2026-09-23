# Claude routing pilot: proposed two-task shape

23 September 2026. **Proposal only.** It grants no launch, scheduling, publish or
merge authority. It follows the [Claude capability report](2026-09-23-claude-routing-capability-report.md).
It needs coordinator review, one precondition fix and independent built-in
review of its verifier, then a concrete launch agreement. No pilot branch, PR,
execution directory, verifier file or automation exists.

## Precondition: a runnable Claude review contract

The engine's Claude review prompt asks one bound child to invoke
`/code-review xhigh` and return `{verdict, feedback, reviewedHead}` itself. On
Claude Code 2.1.280 the built-in forks. The invoking child receives only
"launched", and the findings arrive at the root session. Before launch, a
separately reviewed source change must make this path runnable and
fixture-tested. The proposed shape:

1. The engine requests a `review:` child as today. The lead spawns it from a
   review definition (Opus xhigh, tools including Skill). The child reads the
   exact PR head and invokes `/code-review xhigh <verified range>`.
2. The fork is recorded as the engine execution. The lead captures the fork ID
   from the invocation result and meta file, the Skill tool-use ID and the fork's
   verbatim final output.
3. The lead sends that verbatim output to **the same bound review child** by
   native message. The child returns the unchanged verdict schema; the lead never
   authors or edits a verdict.
4. The receipt names the bound child, adds the fork ID to its native evidence,
   and keeps engine `code-review`, level `xhigh` and the inspected head.

Each review therefore costs two native dispatches. If this change is not
accepted, the pilot cannot run built-in review as specified; do not substitute a
custom reviewer.

## Why two tasks fit the fixed verifier contract

The reviewed Codex v2 correction established these constraints: one immutable
`repository.verifier` command for baseline, candidate, integrated and
supplementary checks; `verifyTask` takes only `{operationId, commit, purpose}`;
and the baseline must pass. It also already accepts the final check by reading
the verifier's reported mode (`mode: documents`) from the reserved result.

This proposal applies that reading to three monotone states rather than a
stage argument. The same state always yields the same answer:

| Repository state | Exit | Reported mode |
| --- | --- | --- |
| Exact pinned base, pilot directory absent | 0 | `baseline` |
| Task A document complete, task B absent | 0 | `partial` |
| Both complete, B's prerequisite digest equals A's current bytes | 0 | `complete` |
| Anything else, e.g. B without A, digest mismatch, missing line, extra file, symlink, empty non-base commit | 1 | none |

The work-only state is valid, not a false final result. The claimed final result
is enforced by requiring `mode: complete` from the reserved final operation, as
Codex v2 required `mode: documents`. Task B's document must contain
`Prerequisite: docs/pilots/claude-routing/work-policy.md sha256 <hex>`, matching
A's merged bytes. A task-B candidate built before A merged therefore fails. The
dependency is machine-checked, and this is the prerequisite-release scenario the
one-task Codex alternative left open. Missing B at the end is caught by the final
mode, not by an unreserved check. The coordinator should confirm that this
reasoning resolves the original P1/P2 findings.

## Repository, base and effects

`github.com/lachyts/thread-skill`, a new isolated checkout, target branch
`claude/routing-pilot-2026-09-23`. It would be created from a commit pinned at
agreement: the documentation commit recording this proposal, whose runtime
pins equal the capability report's. The agreement must cover publishing
that history to the pilot branch, opening **two** PRs and merging each
automatically only into the pilot branch. Never target the default branch or
force an existing branch. Only these files may change:

- Task A `claude-routing-work-policy`: `docs/pilots/claude-routing/work-policy.md`
  (easy, no plan gate).
- Task B `claude-routing-review-policy`: `docs/pilots/claude-routing/review-policy.md`
  (easy, no plan gate, depends on A).

A records the observed Opus high/xhigh/max and Fable max bindings. It keeps
requested, resolved and observed separate, and states that synthetic maximum
probes are not a correction ladder. B records the xhigh review floor, the fork
and relay shape, exact-head binding and command level versus reasoning effort,
and cites A by digest. Exact required lines are fixed in the verifier. Merges
change no runtime, skill, profile or application. Read-only launch preflight
must still check remote refs, account, repository rules and workflows; any
unexpected effect stops preparation.

## Verifier (to prepare separately)

`claude-pilot-verify-v1.py`: standard library and local Git only, read-only.
It requires a clean repository rooted at cwd and descended from the pinned
base. It emits `{mode, head}` and implements the table above. Prepare it as a
bounded step: at most ten local invocations covering each row, including the
symlink and empty-commit rows, and an independent built-in review. Record its
SHA-256. Declare it as the sole `repository.verifierInputs` entry, run it as
`python3 -I <absolute path>` at every host point, and pin the Python and Git
paths and versions.

Final check under **task B's** pool, after B's run-owned merge receipt:

```json
{"operationId": "claude-routing-pilot-final-v1",
 "commit": "<exact integrated commit from B's merge receipt>",
 "purpose": "Confirm both routing policy documents and B's prerequisite digest at the final integrated commit"}
```

This requires exit 0, `mode: complete`, output head equal to the operation
commit, and that commit equal to B's merge receipt. Exact replay returns the
stored result; a changed commit or purpose is a conflict.

## Routing and spending

Before starting the pilot session, place pinned definitions in the pilot
checkout's `.claude/agents/`: Opus 5.5 at high, xhigh and max; Fable 5.1 at max;
and an Opus xhigh review definition that allows Skill. Project scope needs no
shared-settings or user-directory change. It loads at startup but not mid-session,
so confirm the startup agent listing before initialising. The lead maps each
resolved binding to its definition. The first real child is the version
re-probe: the host rejects any observed mismatch, so a changed runtime fails
closed. The snapshot uses the policy's Fable recovery binding.

Per task, the engine pool is 8 calls and 6 verifier reservations (B: 7,
including the final check). That is above the recovery minimum of 2N = 6 calls
and N + 2 = 5 verifier reservations. Native dispatches are capped at 12 per
task, counting review forks. `maxIterations: 3`, `maxReviewRounds: 3`, at most
two live children, one same-child formatting correction per stage, and no
added allowance. Expenditure stays spent on failure or interruption.

## Recovery and lifecycle

Bind the account label at creation. Make exactly one controlled owner transfer
while a real child is dispatched: stop the owning session, observe the child
(in-process children are expected to end with their owner, so record `terminal`
and let the engine decide any retry within budget), then `recover` into a new
native Claude session on the same account at epoch 2. Record Stop-hook delivery
separately from heartbeat delivery. An optional quiet five-minute heartbeat
notifies only on progress, completion, failure or required action.

## Success, and what it does not prove

Success requires all of the following:

- Two exact-head built-in review receipts accepted by the host.
- B dispatched only after A merged.
- Two pilot-branch merges.
- A reserved final `mode: complete` check.
- Observed effort on every child.
- One evidence-backed ownership recovery.
- Preserved spending.

It does not prove a genuine correction ladder unless one occurs, and it does not
prove release while unrelated work runs. Before any launch request, recheck
remote, account and effects, the verifier bytes and the runtime version. Present
the exact outcome, both merge effects and the finite pools, and preserve
Lachy's exact new authorisation. Prior approvals do not carry over.
