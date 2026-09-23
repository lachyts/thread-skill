# Proposed two-task Codex routing pilot

Prepared 23 September 2026 after the
[bounded native capability check](2026-09-23-codex-routing-capability-report.md).
**Proposal only: no rollout, pilot branch, PR, schedule or merge has been
initialised.** A separate launch agreement must cover the concrete terms below.
This does not reuse historical pilot approvals or any remaining probe allowance.

## Repository, base and effects

Use `github.com/lachyts/thread-skill` with a new isolated checkout. Create the
remote pilot target branch `codex/routing-pilot-2026-09-23` from exactly
`89a7ff1d409554f5442b548c967408f24bfa27a4`. That branch does not yet exist as a
result of this proposal. The launch agreement must explicitly permit publishing
that pinned candidate history to the pilot branch, creating two PRs and merging
them automatically into that branch. Do not target the default branch.

The two PRs add only the two documentation files listed below. No runtime source,
installed skill, profile, vault task schema or application is changed by their
merges. The pinned base has no tracked `.github` workflow. Repository rules,
current remote refs and external integrations still require read-only launch
preflight; an unexpected deployment or publication effect stops launch. Nothing
may be force-pushed, reset or deleted to obtain this base. An existing divergent
target branch requires a revised agreement.

Use the source-local candidate runtime and shared adapter/resolver/policy commits
from the capability report. Pin them into a new private execution directory;
do not globally install them. Preserve the original source worktrees and all
historical execution directories.

## Two outcomes

| Task | Exact writable path | Required outcome | Dependency |
| --- | --- | --- | --- |
| A — work policy | `docs/pilots/codex-routing/work-policy.md` | Explain the verified `gpt-6-astra` bindings: easy high, difficult xhigh and maximum ultra; distinguish requested, resolved and observed settings; state that no recovery alternative is configured and maximum probes did not prove a failed correction ladder. Cite the capability report by its committed source reference. | None |
| B — review policy | `docs/pilots/codex-routing/review-policy.md` | Explain `review-agent` at the xhigh floor, clean child context, exact reviewed commit, host-observed invocation and evidence, and its single pass. State that model self-report is insufficient and that Thread host receipt capture is a separate gate. Cite the capability report by its committed source reference. | A merged and integrated verification passed |

Both are narrow documentation tasks, difficulty easy, with `planGate: false`.
Only their named file is writable by each implementer. An independent native
built-in reviewer checks each exact head against its complete required outcome.
The reviewer must not approve solely because a phrase checker passes.

## Exact verification

The prepared external verifier is
`/Users/lachlants/.codex/worktrees/5c5a/thread-skill/.thread/codex-routing-capability-2026-09-23/pilot-verify.py`.
Its SHA-256 is recorded in the public evidence index. It imports Python standard
library modules only, reads the two target paths relative to the checked-out
repository and writes no files. It rejects missing required files, symlinks and
missing contract phrases. It is a mechanical check, not a truth or prose-quality
assessment.

Repository verifier, with its working directory set to the exact candidate or
integrated repository checkout:

```text
python3 -I /Users/lachlants/.codex/worktrees/5c5a/thread-skill/.thread/codex-routing-capability-2026-09-23/pilot-verify.py
```

Declare that absolute script as the sole external `repository.verifierInputs`
entry; hash and realpath-bind it before launch and before/after every verifier.
The repository inputs are the two Markdown files at the exact verified commit.
No live home/session files, Reader paths, network calls or metered model helpers
are verifier inputs. Use the installed Python 3 executable resolved at launch
and record its version/path with the verifier command.

Task A additionally runs the same command with `--require work`; task B uses
`--require all`. The independent reviewer checks those exact acceptance results.
After both merges, reserve one supplementary check from B's existing pool and
run `--require all` at the final integrated commit. Use the stable operation ID
`codex-routing-pilot-final-documents-v1`; exact redelivery must reuse its stored
result. Each distinct command invocation consumes a verifier reservation,
including supplementary checks and repeats not covered by idempotent replay.

The default verifier accepts A alone and checks every pilot file present, so A
can merge before B exists. It fails when neither document exists. B's complete
acceptance requires both documents, independently of that incremental mode.
Local scratch cases verify these modes; no pilot task has executed.

## Native routing and finite allowance

Reconfirm the actual pilot session retains `gpt-6-astra`; do not change the model
silently. Prepare its native capability snapshot again at launch. Work starts
high; independent review starts xhigh. A substantive correction uses supported
maximum ultra. Set recovery to null because no alternative is configured.
Preserve all observations and built-in receipts through host acceptance.

| Pool | Calls | Verifier runs | Ownership recoveries |
| --- | ---: | ---: | ---: |
| A | 8 | 8 | 1 |
| B | 8 | 8 | 1 |
| Total | 16 | 16 | 2 |

Use at most two live children. Set `maxIterations: 2` and `maxReviewRounds: 2`;
no plan round is needed. These pools exceed the candidate host's no-recovery,
ungated minimum of four calls and four verifier reservations per task. They are
finite headroom, not permission to exceed round limits. Every attempted child
dispatch spends a call, including refusal; every reserved verification remains
spent on failure or interruption. Permit at most one same-child formatting
correction per stage. No delegation from review or work children and no added
budget, alternative model, paid external API or account switch.

A correct first implementation does not prove a correction ladder. Do not plant
a new defect or relabel interruption as a quality failure merely to obtain that
claim. An actual substantive failure, if one occurs within these pools, must
follow the pinned maximum-first policy.

## Required ownership recovery and continuation

Bind the new execution to a verified non-secret native account label at initial
creation. During task A, perform exactly one controlled owner transfer while an
actual native child is dispatched. Obtain native evidence that the old owner
has stopped and establish the child's real identity and running/terminal state.
Recover the same execution in a fresh native task on the same account, increasing
the ownership epoch and preserving every request, result, review receipt and
spent reservation. A timeout or missing transcript is not stopped-owner proof.
If the native interface cannot establish the required state, stop and report
that slice incomplete; do not launch replacement work.

The separate agreement should include creation of the replacement native task
and a quiet five-minute thread heartbeat for session continuation. Notify only
on meaningful progress, completion, failure or required user action. Any owner
transfer must rebind continuation to the new owner without duplicate dispatch.
End the heartbeat when complete or exhausted. No automation is created now.

Success requires both exact-head built-in review receipts accepted by the
Thread host, two merges only to the named pilot branch, integrated verification,
one evidence-backed ownership recovery, cumulative spending preserved, and a
final report separating actual continuation from ordinary in-turn progress.
The coordinator remains task 1; historical task 3 and its allowances stay closed.

## Launch agreement still needed

Before requesting launch approval, the coordinator must present this proposal
with the immutable capability-report commit reference, recheck the remote
branch/account/effects and confirm the verifier bytes. The user's exact response,
the proposal it covers and its native message reference become the new
authorisation record. Until then, this proposal authorises no external changes,
live rollout initialisation, task filing, scheduling or merges.
