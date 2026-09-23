# Revised Codex routing pilot preparation

Revised 23 September 2026 after independent review of the original proposal.
**The original two-task split is withdrawn.** The supported alternative below
uses **one task that delivers both documents**. It is prepared for independent
review, not authorised to launch. If a two-task rollout remains mandatory, this
preparation is incomplete; do not present the alternative as a two-task pilot.

No rollout, pilot branch, PR, automation or merge has been initialised. The
[completed capability report](2026-09-23-codex-routing-capability-report.md),
[original evidence index](2026-09-23-codex-routing-evidence.json) and all 49
private evidence files are unchanged. The separate correction has its own
[preparation evidence](2026-09-23-codex-routing-preparation-v2.md).

## Why the task shape changes

The canonical host runs one immutable `repository.verifier` command for baseline,
candidate, integrated and supplementary verification. It passes no task ID,
verification purpose or stage to that command. `verifyTask` accepts an operation
ID, exact commit and purpose; it cannot append `--require work/all` or substitute
a different verifier. The original baseline also lacked both documents, so its
default verifier failed before task A could start.

A work-only commit must be valid after the original task A, yet invalid as the
claimed final result if task B is missing. Running the same command against that
same repository state cannot produce both answers without an additional trusted
stage input. A mutable marker, branch-name convention or missing-file exemption
does not establish the intended stage. No such runtime capability is added here.

Instead, the exact pristine seed commit is the valid pre-work baseline. Every
other commit must contain both complete document contracts. The original work-only
intermediate state is deliberately rejected. Combining the outcomes into one
task removes the need for task-specific commands while preserving strict final
verification. This alternative does not exercise dependency release between two
tasks; that acceptance promise remains open.

## Repository, base and effects

Use `github.com/lachyts/thread-skill` in a new isolated checkout. The proposed
remote target branch remains `codex/routing-pilot-2026-09-23`, created from exactly
`89a7ff1d409554f5442b548c967408f24bfa27a4`. No such branch was created here.
The separate launch agreement must cover publishing that pinned candidate
history, opening **one** PR and automatically merging it only into that pilot
branch. Do not target the default branch or force an existing divergent branch.

The PR may add only:

- `docs/pilots/codex-routing/work-policy.md`
- `docs/pilots/codex-routing/review-policy.md`

Its merge changes no runtime, installed skill, profile or application. The pinned
base has no tracked `.github` workflow. Read-only launch preflight must still
check remote refs, account, repository rules and external effects; unexpected
deployment or publication effects stop preparation. No network preflight was
performed during this bounded correction.

Pin the source-local runtime, shared adapter, resolver and policy commits from
the capability report into a new execution directory. Do not install them
globally or change the source worktrees or historical execution records.

## One complete outcome

Task `routing-policy-documents` owns both named paths, is a narrow documentation
task, has difficulty easy and `planGate: false`. It must deliver both documents
in its candidate head. Its writable scope is exactly those two files.

The work document explains Astra's verified high/xhigh/ultra bindings, separates
requested/resolved/observed settings, records the absent recovery alternative
and states that direct maximum probes do not establish a correction ladder.
The review document explains the xhigh floor, clean independent child, exact
reviewed commit and invocation evidence, single-pass engine, insufficiency of
model self-report and separate Thread host receipt-capture gate.

Both documents must contain the exact contract lines in `REQUIRED_LINES` in the
candidate verifier. Those lines include the immutable capability report reference
at commit `8c5980bb0339310f537488bf4cfde599da1e6e07`. Explanatory prose may be added.
The independent native built-in reviewer checks the complete required outcome,
the prose's factual accuracy and absence of contradiction at the exact head;
passing mechanical line checks is not a substitute for review.

## One fixed verifier, including the final check

The separately versioned candidate is
[pilot-verify-v2.py](../preparations/2026-09-23-codex-routing-v2/pilot-verify-v2.py).
Use this exact command at every host verification point, with cwd set to the
candidate or integrated repository root:

```text
python3 -I /Users/lachlants/.codex/worktrees/5c5a/thread-skill/docs/preparations/2026-09-23-codex-routing-v2/pilot-verify-v2.py
```

Declare that absolute file as the sole external `repository.verifierInputs`
entry. Its exact SHA-256 is in the new preparation evidence and results index.
The host must bind its realpath and bytes before launch and check drift before
and after each verification. Pin the resolved Python and Git executable paths
and versions in launch evidence. The script uses Python's standard library and
local Git only, reads the candidate checkout, and writes no files. No stage
argument, environment flag or mutable helper selects its acceptance rule.

The verifier requires a clean repository rooted at cwd and descended from the
pinned baseline. At the exact baseline commit it requires the pilot directory
to be absent and emits `mode: baseline`. At every other commit it requires both
ordinary Markdown files and every contract line, and emits `mode: documents`.
The same tree in a new empty commit does not acquire the baseline exemption.
Missing documents, removed clauses and later deletion fail. Symlink directory
components or document files are rejected; that guard was source-inspected,
not separately exercised within the ten-invocation allowance.

After the one PR merges, obtain the exact integrated commit from its merge
receipt. Use the supported `verifyTask` operation under the **same task's** pool:

```json
{
  "operationId": "codex-routing-pilot-final-documents-v2",
  "commit": "<exact integrated commit from the run-owned merge receipt>",
  "purpose": "Confirm both complete routing policy documents at the final integrated commit"
}
```

The launch driver must substitute that observed full commit SHA, not the seed
commit or a guessed ref. The host reserves one verifier run and executes the
unchanged configured command. Require exit 0, output `mode: documents`, output
head equal to the operation commit, and the operation commit equal to the
run-owned integrated merge receipt. The initial baseline's green result cannot
satisfy those conditions. Exact redelivery of this operation returns the stored
result without another reservation; a changed commit or purpose is a conflict.
No `--require` command, extra unreserved check or runtime modification is used.
This is a supported future host path, not a claim that live host idempotency or
merging was tested during preparation.

## Routing, spending and recovery

Reconfirm the launch session's actual `gpt-6-astra` selection and supported
efforts. Work begins high, independent review xhigh, and a substantive correction
uses maximum ultra. Set recovery to null; do not invent another model binding.
Record actual native observations and built-in receipts through host acceptance.

The single task has **8 calls, 8 verifier runs and 1 ownership recovery**. These
replace the withdrawn two-task pools rather than adding to them. Set
`maxIterations: 2`, `maxReviewRounds: 2`, at most two live children and no plan
round. The pool exceeds the candidate host's ungated no-recovery minimum of four
calls and four verifications. All attempted dispatches and reserved verifications
remain spent on failure or interruption; the final supplementary check uses
this same pool. Permit at most one same-child formatting correction per stage.
No descendants, account switching, external model processes or added allowance.

Bind a verified non-secret native account label at execution creation. During
the task, perform exactly one controlled transfer while a real child is
dispatched. Establish that the prior owner stopped, observe the child's identity
and state, then recover the same execution on the same account with a new
ownership epoch. Preserve requests, receipts and spending. Missing stop/child
evidence leaves recovery incomplete and does not authorise replacement work.

The separate agreement may include a replacement native task and a quiet
five-minute heartbeat, notifying only on meaningful progress, completion,
failure or required user action. Rebind continuation on transfer without
duplicate dispatch and end it on completion or exhaustion. None is created now.

Success for this reduced pilot requires one exact-head built-in review accepted
by Thread, one pilot-branch merge, integrated and reserved final strict
verification, one evidence-backed ownership recovery and preserved spending.
It makes no claim about two-task prerequisite release or a genuine correction
ladder unless separately observed. Task 1 remains coordinator; historical task 3
and all old allowances stay untouched.

## Remaining agreement boundary

The coordinator must independently review this correction and explicitly retain
or reject the one-task shape. If the intended acceptance check requires two
independently merged tasks, the original verifier-stage constraint remains
unresolved; do not launch the original split or count this as satisfying it.
Before any launch request, recheck remote/account/effects and verifier bytes,
then present the revised outcome, one-PR merge effects and finite pool. Preserve
the user's exact new authorisation, covered proposal and native message source.
