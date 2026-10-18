# Claude review-path check: native report

23 September 2026. Executes the [bounded handoff](../handoffs/2026-09-23-claude-review-path-check.md)
from its prepared private directory. Evidence index: [JSON](2026-09-23-claude-review-path-check-evidence.json)
(identities, observations, hashes, private hash index; no transcript content).

**Outcome: not passed.** Pair 1 (Opus xhigh) completed end to end. Pairs 2 (Opus max) and
3 (Fable max) are incomplete: every built-in fork ran at effort xhigh while those routes
resolved max. The six-slot allowance is exhausted. The two-task pilot remains held and
no launch agreement is presented.

## Scope kept

- Root session `9d3f4cab-2f63-4f8c-9cb8-a91481a4e12b`, Claude Code 2.1.280 (binary SHA-256
  `387a5c5d…229d`, identical to the capability check), `fauxmuse` profile, account label
  `claude-account-87779c3fb4aba28a`. Started in the prepared directory.
- All twelve pinned files matched manifest and `git show <pin>:<path>` before and after.
  `preparation.json` SHA-256 `1a63a4f1…c9a62b`. Shared settings stayed `c8707904…3422ae`.
- The startup agent listing (04:55:40Z) contained all three `thread-review-check-*` types
  before any exchange was created.
- New account-bound adapter exchange (`maxConcurrent` 2, run `ebf2d7b6-…-698aa61bb278`),
  not `rollout-host init`. Durable ledger: 6 reserved, 6 attempted, 3 sequential pairs,
  each pair reserved before its claim. No replacement, retry, second review or descendant.
- Fresh fixture `35b0c2e…` → `6c1da37…` with trees identical to the historical
  `f41bab9…` → `90b7591…`; deliberate `<=` defect unrepaired; fixture clean at close.
- No original probe, pilot verifier, global setting, rollout, remote write, PR or merge.
  Temporary project definitions were removed at close after a byte match; archival
  templates in `docs/preparations/2026-09-23-claude-review-path/` are retained.

## Preparation

Built-in fan-out was inspected before launch, from the installed binary: the xhigh recipe
runs ten angles and a sweep "in THIS context — do NOT spawn subagents", so one fork per
pair fits. The same inspection showed `getEffort` deriving the fork's effort from the
explicit level (`xhigh`), predicting the pair 2/3 mismatch before any slot was spent.
That prediction was recorded as static evidence only; the native observations follow.

Wrapper prompts came from the pinned engine run through a labelled deterministic boundary
fixture (real resolver, synthetic `agent()` responses). Synthetic selector inputs
("SYNTHETIC SELECTOR INPUT 1/2 of 2") produced quality-failure counts 1 and 2; they are
not reasoning failures. The only adaptation replaced the `PR:` line and the
`gh pr view … headRefOid` read with the explicit local range and `git -C … rev-parse HEAD`
(two lines per prompt; diff saved privately). Fork protocol text, schema, review contract
and routing options are byte-identical to the engine capture.

## Results

| | Pair 1 | Pair 2 | Pair 3 |
| --- | --- | --- | --- |
| Resolved route | Opus 5.5 xhigh, normal | Opus 5.5 max, maximum | Fable 5.1 max, recovery |
| Wrapper spawn | named teammate | named teammate | plain subagent |
| Wrapper observed | Opus xhigh ✓ | **Opus xhigh ✗** | Fable max ✓ |
| Prompt delivery | exact | exact | exact |
| Skill invocations | 1 | 1 | 1 |
| Fork observed | Opus xhigh ✓ | **Opus xhigh ✗** | **Fable xhigh ✗** |
| Fork descendants | 0 | 0 | 0 |
| Relay to same wrapper | byte-exact | byte-exact | byte-exact |
| Wrapper result | `changes`, head matches | `changes`, head matches | `changes`, head matches |
| Findings retained | 3/3 | 1/1 | 5/5 |
| Adapter | fork complete; wrapper ok | fork terminal; wrapper blocked | fork terminal; wrapper blocked |
| Receipt v2 | prepared | not prepared | not prepared |

Observations are harness-written transcript fields (`message.model`, `effort`,
`perTurnEffort`) for every assistant entry, never requested settings or child claims.
Pair 1 identities: wrapper `apair1-wrapper-ce6d7097860849aa`, invocation
`toolu_01GvdDj1TVGukfvVZmyDqCk5`, fork `a237e9881c66a0fcc`, fork resultHash `a71a960a…`,
outputHash `d7d29b32…`. Pairs 2 and 3 are listed in the evidence index.

The deliberate defect yielded `changes` in every pair. That is the review working, not
approval of the fixture.

## Native findings

1. **Unmodified `/code-review xhigh` fixes fork effort at xhigh.** Its forked-skill record
   and all fork turns show xhigh in each pair. Fork model does follow the wrapper (Fable
   under Fable). Under the current `claude-fork-v1` contract, whose review level is fixed at
   xhigh, maximum and recovery review routes cannot be satisfied. This is a contract gap,
   not an effort-lowering choice.
2. **Spawn shape changes effort precedence.** An Agent call carrying `name` produced an
   `in_process_teammate`, whose `effort: max` definition ran at xhigh (the session default).
   A plain background subagent honoured the Fable max definition. Pair 1 could not tell
   these apart. The shape difference came from this run's own dispatch choice and is disclosed.
3. **Completion routing depends on shape.** Teammate wrappers' forks were spawnDepth 1 and
   reported to the lead, making the relay necessary. The plain wrapper's fork was spawnDepth 2
   and its notification reached the wrapper, which also read the fork transcript itself
   before the lead's relay arrived. The historical plain-subagent probe reported to the lead
   instead; the cause is not isolated.
4. **Relay bytes are exact; result containers are not.** All three relays matched the fork
   output hash at send and receipt (teammate envelope or queued command). Wrappers preserved
   every finding with identical field values, but re-rendered the fenced findings array
   (compact JSON, split substrings or `key: value`), so the verdict itself is not hashable
   against the fork output.
5. **Task notifications HTML-escape the fork result** (`&lt;`). Verbatim bytes were taken
   from the fork transcript, not the notification.
6. **Built-in verification strays outside the fixture.** Forks in pairs 2 and 3 ran
   `verify.py` on exported copies under the session scratchpad. The pair 3 fork grepped the
   enclosing private directory and saw a preview containing the fixture record's defect
   label, which qualifies pair 3's independence. The fixture itself was never modified.

## What this does not establish

No rollout host accepted a native receipt; receipt v2 exists only as preparation for pair 1.
Real quality-failure escalation, maximum-effort review forks, automatic merges, reserved
final checks and cold ownership recovery remain unproven. Findings 1–3 need a source or
contract decision (for example, level-per-route review or a fixed plain-subagent dispatch
shape) and a separately bounded native check. This allowance is spent and does not renew.
