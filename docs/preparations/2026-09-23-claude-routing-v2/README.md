# Two-task Claude verifier v2 preparation

23 September 2026. Source and deterministic local preparation only. No rollout,
native child, capability probe, network action, branch publication, PR or merge
was launched. This directory is separate from the immutable five-probe capability
packet and its exhausted allowance. The verifier passed independent built-in
[source review](../../reviews/2026-09-23-claude-review-correction.md) with no findings.
A concrete launch agreement remains pending; these fixtures are not
live fork, relay, correction or recovery evidence.

## Fixed command and acceptance

The [verifier](claude-pilot-verify-v2.py) uses Python's standard library and local
read-only Git commands. The future agreement must supply the exact full base
commit and pin this file's absolute path and SHA-256 as a verifier input. The same
command is used at baseline, candidate, integrated and reserved final checks:

```text
python3 -I /absolute/pinned/claude-pilot-verify-v2.py --base <exact-agreed-base>
```

That is schematic, not a runnable launch instruction. No future base, target
branch or rollout has been selected here. The command runs at the checked-out
repository root and writes only one JSON object to stdout:
`{"mode":"baseline|partial|complete|invalid","head":"<actual full HEAD>"}`.
Invalid states exit 1; the three valid modes exit 0. An unreadable repository
returns `invalid` with an empty head. There is no prose/error output channel.

The repository must be clean, HEAD must descend from the supplied base, and only
these two tracked, ordinary non-executable files may differ from that base:

- `docs/pilots/claude-routing/work-policy.md`
- `docs/pilots/claude-routing/review-policy.md`

An exact base passes only with the pilot directory absent. A non-base commit with
complete A and absent B is `partial`. Both complete documents with B's SHA-256
matching A's actual bytes are `complete`. An empty descendant is invalid. So are
B alone, missing clauses, stale digests, symlink files or any symlink in the pilot
parent chain, extra pilot entries, out-of-scope changes and repository dirt.
Assume-unchanged and skip-worktree index entries are refused; pilot bytes must
also match their committed blobs. HEAD, cleanliness and pilot content are checked
again before a successful report. Ordinary ignored files outside the pilot are
not repository dirt; ignored extra entries inside the pilot are still rejected.

The host configuration pairs this report with immutable task completion modes:

```json
{
  "repository": {"verifierContract": {"version": 1, "baselineModes": ["baseline"]}},
  "taskA": {"verifierModes": ["partial", "complete"]},
  "taskB": {"verifierModes": ["complete"], "dependsOn": ["<actual-task-A-id>"]}
}
```

This is a schematic fragment, not an execution configuration. The host must gate
both candidate approval and integrated completion on the task's allowed mode and
exact commit. B cannot complete on `partial`, even with exit 0. A supplementary
final check cannot replace either gate. Dependency release still requires actual
host `dependsOn` state, A's verified merge and dispatch chronology. Matching A's
digest proves content equality only and says nothing about when B was dispatched.

## Required document content

The [work fixture](work-policy.fixture.md) and [review template](review-policy.fixture.md)
define the exact required nonblank lines, in order. Extra contradictory prose,
hidden comments and code-fenced copies do not satisfy the contract. Blank lines
may vary. Replace the review template's `WORK_SHA256` with SHA-256 of the actual
work document bytes; the verifier accepts only a matching lowercase 64-digit hash.

The content distinguishes requested, resolved and runtime-observed bindings,
records the historical Opus high/xhigh/max and Fable max observations, and limits
what those observations prove. It describes the independent xhigh built-in,
separate wrapper/fork observations, faithful same-wrapper relay, original shared
allowances and spent reservations. It expressly rejects synthetic selectors or
matching document hashes as proof of a genuine correction or lifecycle transition.
The earlier packet did not prove maximum-effort fork inheritance or a completed
relay. This verifier checks those document statements, not native behaviour.

## Bounded local evidence

**All 12 authorised verifier subprocess invocations were spent once. All 12
matched their expected outcomes. No invocation allowance remains; do not rerun
the suite or the verifier under this preparation allowance.**

The [content tests](test-content.py) first failed on missing baseline/partial
classification (2 failed, 4 passed), then passed all 6 in-process tests after
implementation. These imported the content classifier only: no verifier
subprocess, Git call or native dispatch. The [one-time local runner](test-local-once.py)
then made precisely one verifier subprocess call per case, reserving each in an
append-only ledger before launch. It has no retry path and refuses an existing
fixture directory. Creating a different fixture directory does not confer a new
allowance.

| Invocation | Fixture state | Exit | Mode |
| --- | --- | --- | --- |
| 1 | Exact clean base, pilot absent | 0 | baseline |
| 2 | Complete A, B absent | 0 | partial |
| 3 | Complete A and B, matching digest | 0 | complete |
| 4 | Empty non-base commit | 1 | invalid |
| 5 | B only | 1 | invalid |
| 6 | Required allowance clause missing from A | 1 | invalid |
| 7 | B quotes a stale digest | 1 | invalid |
| 8 | A is a symlink to otherwise complete content | 1 | invalid |
| 9 | Pilot parent is a symlink to otherwise complete content | 1 | invalid |
| 10 | Extra pilot file | 1 | invalid |
| 11 | Committed out-of-scope README edit | 1 | invalid |
| 12 | Untracked repository dirt | 1 | invalid |

Every case preserved HEAD, worktree file/symlink inventory and index SHA-256
across its invocation. The isolated local Git fixture, case worktrees, full
before/after records and append-only invocation ledger are retained privately at
`.thread/claude-verifier-v2-preparation-20260923/`. Its fixture-only base is
`50152902fdb57f926ab8f01a91f49859aca94a8b`, **not** a proposed launch base. Local
fixture commits were necessary for ancestry checks; the source repository was not
committed. No original probe or historical evidence was rerun or edited.

The [public evidence manifest](evidence.json) records each actual head, result,
runtime path/version, script/template/test hashes and private evidence hashes.
Runtime used: Python 3.11.3 at
`/Users/lachlants/.pyenv/versions/3.11.3/bin/python3`; Git 2.47.0 at
`/opt/homebrew/bin/git`. These are observations from this fixture run, not future
launch pins or native model evidence.

Exact SHA-256 records:

| Artifact | SHA-256 |
| --- | --- |
| Verifier | `e5600fe57beb947b636acfbfe332ed297270fb28040535f0ac9ed744cdb7e4bf` |
| Public evidence manifest | `b86e6c3642e26c9b044295fbf10754638a6c6ce3cd06874ff5fafaef4515c7b2` |
| Private full results | `21b9132f61b3d5b69dda80301ea96ffd8222d0a895fe150386ad8f4d2df149b0` |
| Private invocation ledger | `3fb43adf6f33db8f1d0592d3e1def216090d25d16956ed03c8c25e38fc291c33` |

Any source correction after independent review requires a new recorded version
and separately authorised verification allowance; the tested bytes and this
12-invocation record must not be silently relabelled.
