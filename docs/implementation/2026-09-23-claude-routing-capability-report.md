# Claude native routing capability check

23 September 2026. **The five bounded native capability probes completed and
each harness-observed model and effort matched its resolved route.** Opus 5.5
ran high, xhigh, xhigh (built-in review) and max; Fable 5.1 ran max. This is
evidence for per-child model/effort bindings and a built-in review invocation on
Claude Code 2.1.280. It is not acceptance of an unattended rollout, a real
correction ladder or cold ownership recovery. Nothing was installed, released,
published or merged.

The consumed [handoff](../handoffs/2026-09-23-claude-routing-capability-check.md)
set the scope. This native session is `83243d46-2dbd-49ef-8e6b-194a8e84abdb`
(profile `lachlants`, account label `claude-account-85b950f122615c51`, a
pseudonymous digest of the profile's account UUIDs; no account switch or
credential copy). The Codex report, audit and v2 recheck were read first.

## Native identity and capability evidence

Runtime `2.1.280 (Claude Code)`; every probe transcript records version 2.1.280.
The lead itself runs `claude-opus-5-5` at xhigh (121 lead turns observed). The
account's native model catalogue (fetched 23 September) lists effort options
`low, medium, high, xhigh, max` for both `claude-opus-5-5` and
`claude-fable-5-1`, so each model's maximum is `max`. Fable is available and is
the policy's recovery binding; no unavailable route was needed.

The shared settings file (`~/.claude/settings.json`, hash `c8707904…3422ae`,
unchanged before and after) serves all four profile aliases through symlinks.
It pins `effortLevel: xhigh`, Opus 5.5 `xhigh` and Fable 5.1 `high` per model.
The candidate migration plan's source guard for that file still matches.

**Pins do not govern per-child effort on 2.1.280.** An agent definition's
`effort:` becomes a per-child context layer that the runtime resolves before the
settings table. The first probe was run alone to test exactly that: an Opus
child defined at high ran high under the xhigh pin; later children ran Opus max
and Fable max above their pins. This supersedes the 2.1.278 finding that the
per-model pin beat definition effort. Children without a definition effort
inherit the parent's session effort (earlier 2.1.280 sessions on this machine
show Opus children at high and medium under the same pin). Behaviour is
runtime-version dependent; any launch must re-probe it.

## Settings route and the one approved wider effect

Project-scoped definitions in this worktree's `.claude/agents/` were written
first. A `.claude/agents/` directory created mid-session was not hot-loaded
within 4.5 minutes, confirming the earlier observation. No slot was spent.
Lachy then explicitly approved adding four new files, byte-identical to the
project copies, to the shared user agents directory. No existing file and no
settings file changed. They were announced about 2.5 minutes later, were live
from 13:01 to 13:08 AEST, and were removed after the probes only after their
hashes matched; the directory listing now equals its pre-activation listing.
The temporary definitions pinned model and effort and allowed only Bash, Read,
Grep and Glob. The approval and rollback record is private
(`temporary-activation.json`).

## Pinned sources

| Candidate | Commit | Byte comparison |
| --- | --- | --- |
| Thread runtime | `aa184cd56fca8176b28f873f93bc6d435d5c4210` | All tracked `skills/execute` files match |
| Shared resolver and adapters | `ac028d47aeb7844b8c18cd0156acc5c3a7ebb749` | Resolver, workflow adapter, Python adapter, policy, both API documents, migration helper and resolver tests match |
| Canonical skill guidance | `7273ac93833cd4d895534e45e37bead16fb6a834` | Common adapter and fresh-review directories match |
| Reader | `8e5072c52ae69b7f19c2b7ec771305f258c3f887` | Tracked source matches; no Reader tests or model calls run |

Thread's checkout was at `45a093b` (documentation only after `aa184cd`). All
scoped trees were clean, and no source changed after the probes. The resolver,
adapter and policy were copied into private storage, preserving their relative
layout. Policy digest:
`d2eb7979ad0423484979dedfbb76b52713421583256357637032c32e06a66f2d`.

## Fixture and spending

A private Git repository reuses the Codex fixture bytes: a three-line capacity
function and a six-case verifier. Base `f41bab93562a5626e9820175ad67fa0ddbfc6bd2`
passes. Candidate `90b7591125a033c1378aabe79016285e820bc7b2` changes `<` to `<=`,
and the verifier exits 1 on the three equality cases. The defect is intentional
fixture data and was not repaired. HEAD, tree and file bytes were unchanged
after all probes.

**Five attempted native dispatches, five completed, zero refusals, zero
formatting corrections, zero descendants. Peak live children: two.** The native
subagent inventory for this session contains exactly the five bound children,
all at spawn depth 1. Every request was claimed in an account-bound exchange
(epoch 1) before dispatch and bound to the actual native agent ID immediately
after launch. The exchange reached `complete`.

| Slot / probe | Routing input | Resolved route | Native observation (all assistant turns) | Prompt delivered |
| --- | --- | --- | --- | --- |
| 1 easy work | easy, zero failures | Opus high / normal | `claude-opus-5-5`, high (4 turns) | Byte-identical |
| 2 difficult work | hard, zero failures | Opus xhigh / normal | `claude-opus-5-5`, xhigh (7) | Byte-identical |
| 3 independent review | review, hard | Opus xhigh / normal | `claude-opus-5-5`, xhigh (11) | Built-in rendering (see below) |
| 4 normal maximum | synthetic qualityFailures=1 | Opus max / maximum | `claude-opus-5-5`, max (12) | Byte-identical |
| 5 recovery maximum | synthetic qualityFailures=2 | Fable max / recovery | `claude-fable-5-1`, max (13) | One-character lead copy error |

Observations come from the harness-written child transcripts: `message.model`,
`effort` and `perTurnEffort` on every assistant entry, plus the meta file's
`agentType`. These are host runtime records, not child assertions or spawn
arguments; backend compute allocation is not exposed. The pinned adapter
validated each envelope's request/child identity, requested/resolved routing and
matching observation. Every work output was schema-valid on first return, with
exactly the four allowed keys.

**Delivery defect, slot 5.** When copying the claimed prompt into the native
spawn call, the lead typed `quality-failures` where the claim reads `quality
failures`. The lengths are identical and the meaning is unchanged. The adapter
does not compare delivered text, so it accepted the envelope. The model/effort
observation is unaffected, but the verbatim-delivery claim fails for this
probe. It is recorded, not corrected, because the ceiling was spent.

## Independent built-in review

**Fan-out preflight.** The built-in `code-review` has no named routing row for
`claude-opus-5-5`, so it uses the default row. At xhigh that selects the
`o48-xhigh-v1` recipe: ten finder angles, dedup and sweep "in THIS context — do
NOT spawn subagents", with no finder budget. The skill's context is `fork` unless
the ReportFindings inline mode is active, and this runtime lacks the enabling
flag. A 2.1.280 precedent on this machine showed a child's invocation launching
a forked background execution whose result returns to the root session, not to
the invoking child. The engine therefore costs exactly one native dispatch.
A wrapper child would have cost two and received only "launched".

The lead invoked the unmodified built-in: Skill tool use
`toolu_01AqsR7ZxtnP3oYSkwjSJM5n`, arguments `xhigh
f41bab9…...90b7591… in the git repository <fixture> …`. The runtime returned
"launched (forked execution, running in the background)". The fork's first
message is the rendered target plus the built-in xhigh recipe only, with no parent
conversation. It ran `claude-opus-5-5` at xhigh, and its commands show `git log`
and `git diff` for exactly that range in the fixture, file reads and a
bytecode-free verifier run. It used Bash only and spawned nothing.

Findings: capacity.py:3, the intentional `<=` off-by-one, identified with all
three failing boundary cases. A second, lower-severity finding flags the
fixture commit's `🧪 test` type for a logic change. That is accurate about the
deliberately regressive fixture commit and was not acted on.

The private Thread-shaped receipt binds request `efcefae5…`, child
`a0780129298d84ee1`, harness `claude`, engine `code-review`, level `xhigh`,
reviewed head `90b7591…` and the Skill invocation ID, with native evidence
(`82550181…`) holding the invocation, result, fork meta and commands. The command
level (xhigh) and the observed reasoning effort (xhigh) are recorded
separately. `/code-review ultra` was not invoked. Thread's rollout-host
immutable receipt capture was not initialised or tested live.

**Contract gap (Claude review).** The built-in forks its own child, so the adapter
contract preamble and schema cannot reach the reviewing fork without modifying
the engine. The review request used `{type: string}`, and the fork's verbatim
final text is the output. For rollouts, the engine's current Claude review
prompt (`wave-execute.workflow.js`, `nativeReviewContract`) asks one bound child
to invoke `/code-review xhigh` and itself return
`{verdict, feedback, reviewedHead}`. On 2.1.280 that child receives only
"launched", and the findings arrive at the lead. As written, the contract is not
natively satisfiable. A supported shape must be chosen and fixture-tested:
for example, the lead relays the fork's verbatim output to the same bound
review child by native message, and that child returns the verdict. That costs
two dispatches per review and puts the fork's identity in the receipt. See the
[pilot proposal](2026-09-23-claude-routing-pilot-proposal.md).

The session's review-freshness Stop hook flagged the lead's Skill invocation
once, because the handoff frontmatter edit was dirty. That was dismissed in one
line: the review targeted the private fixture range, and the engine ran forked,
not inline.

## Local fixtures (not native proof)

Before dispatch, the pinned resolver rejected three deliberately conflicting
profiles that copy the **live** shared pins, each with "Native profile effort
conflicts with requested routing; do not silently override it":
Opus-pin-xhigh against easy/high, Opus-pin-xhigh against first-failure max, and
Fable-pin-high against recovery max. No live setting changed. The pinned
resolver's eight tests passed. The probe snapshot omits a profile attestation
because definition effort governs per child. That omission was then borne out
by the observations, not assumed.

## Consequence for the guarded migration plan

The plan removes the shared `effortLevel` and the Opus/Fable per-model pins.
On 2.1.280 that global change is **not required** for per-child routing:
definition effort already governs children. The pins still govern the lead
session and any child spawned without a definition effort. Whether to apply the
settings removal, and the separate council `fable → claude-opus-5-5` changes, is
a distinct activation decision. It was not applied or needed here. The source
guard still matches.

## Remaining gaps

- Genuine substantive failure followed by a maximum correction, and a failed
  maximum correction followed by Fable. Slots 4–5 used synthetic selectors; no
  correction history exists.
- A runnable Claude review contract, as described above. Also unobserved: the
  fork's effort when a reviewer at max invokes the built-in, and relay/verdict
  acceptance through the rollout host.
- Live rollout-host receipt capture, PR verification and merging, integrated and
  reserved supplementary checks, launch-authority binding and cumulative
  reservations.
- Loading definitions without a global change: expected at session start from a
  project `.claude/agents/` (standard behaviour), but not observed here. It must
  be confirmed in launch preflight from the startup agent listing.
- Stopped-owner transfer (in-process children are expected to end with their
  owner and be observed terminal), interruption recovery, epoch fencing, Stop
  delivery versus heartbeat delivery, and quiet continuation.
- Estate-wide activation, the settings/council migration, the broader release
  promises and any change to historical executions.

No separate built-in review of this report or its private collection scripts
was run; the five-dispatch ceiling was exhausted. The reviewed candidate source
commits retain their earlier independent reviews.

Evidence: [public hash index](2026-09-23-claude-routing-evidence.json).
Raw receipts are private under
`.thread/claude-routing-capability-2026-09-23/`.
