---
thread: thread-skill
written: 2026-09-23
status: prepared
---

# Bounded Claude review-path check

Run this in a **fresh native Claude session**, using the prepared private directory
`/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/.thread/claude-review-path-check-2026-09-23`.
Project-local review definitions are prepared there before startup. Their presence
is not proof that they load or govern execution; establish both from native tools.
Do not use a foreign model CLI or launch another account from Codex.

## Start in the prepared directory

The first attempted session, `0c1fdfb0-000c-43dc-a4a7-14e2d25352a5`, started in
the parent Thread worktree. Its startup inventory lacked all three definitions;
changing cwd inside that session did not load them. It stopped before creating
an exchange or reserving any child. The existing six-slot allowance is unchanged.
The private evidence is `evidence/2026-09-23-startup-precondition-0c1fdfb0.json`.

Create a new session with the prepared directory selected **before startup**.
Do not resume the blocked session or ask it to change directories. In a graphical
launcher, choose the exact prepared directory as the project/working folder before
creating the session; the parent `thread-skill` folder is not equivalent.

Alternatively, Lachy can run this in a terminal outside an agent session. It
starts interactive native Claude with the same `fauxmuse` profile as the blocked
preflight. It neither changes the global account selection nor uses print mode:

```sh
cd '/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/.thread/claude-review-path-check-2026-09-23' && env CLAUDE_CONFIG_DIR='/Users/lachlants/.claude-profiles/fauxmuse' claude --name 'Claude review-path check' 'Read START-HERE.md and execute the linked bounded check. First confirm all three thread-review-check agents are loaded. Preserve the six-child ceiling.'
```

The installed CLI help confirms interactive startup and the `--name`/prompt
syntax. This command has not been launched by Codex. Correct startup scope is
the next controlled check; it is not yet proof that the definitions will load.

This is a new finite check of the corrected wrapper/fork path, prepared following
Lachy's request to execute the audit's next steps. The original five capability
probes are complete and exhausted. Their records and allowances are immutable.
Read the [correction delivery](../implementation/2026-09-23-claude-review-correction.md),
[Claude audit](../audits/2026-09-23-claude-routing-capability-audit.md) and
[source API](../../skills/execute/routing-and-evidence.md) first.

## Scope and ceiling

At most **six attempted native children**, reserved as **three pairs** before
dispatch. Run pairs sequentially, at most two live children:

| Pair | Wrapper and built-in fork | Selector |
| --- | --- | --- |
| 1 | Opus 5.5, xhigh | Review role, zero quality failures |
| 2 | Opus 5.5, maximum supported effort | Synthetic one-failure selector |
| 3 | Fable 5.1, maximum supported effort | Synthetic two-failure selector |

Each wrapper may invoke the unmodified `/code-review xhigh` exactly once. The
fork consumes the pair's second slot. Refusals and reservations remain spent.
At most one same-wrapper formatting correction; no replacement wrappers,
additional review passes or child descendants. Inspect built-in fan-out before
launch; a changed recipe that cannot fit the pair is an incomplete route, not
permission for extra children. If Fable is unavailable, report pair 3 incomplete;
do not substitute an unplanned probe. No automatic allowance reset or relaunch.

No rollout initialisation, remote writes, PRs, merges, installation, release,
shared user definitions or global profile changes. Keep all fixture work and
raw evidence in this private directory. This check does not run the two-task
pilot verifier; its twelve preparation calls are spent. No new pilot branch.

## Preparation without model calls

1. Verify the committed source pins and definition hashes in `preparation.json`.
   Record native runtime version, root session, account label, model catalogue,
   effort support and actual startup agent inventory. Preserve shared settings;
   if the needed definitions do not load, report that precise limitation. Do not
   hot-install user-level definitions under an old approval.
2. Verify and use the already prepared immutable adapter/resolver/policy snapshot,
   which preserves relative imports. The private directory has its own empty
   local Git root solely to establish a project startup scope, not a rollout or
   published branch. Use a new account-bound **adapter exchange**, not
   `rollout-host init`. Set its `maxConcurrent` to two. Reserve each pair in a
   durable six-slot ledger before spawning. The adapter tracks identities and
   capacity; this capability ledger provides the finite run allowance.
3. Create a fresh local fixture with the same tiny deliberate capacity-boundary
   defect as the historical check, recording exact base and reviewed commit.
   Do not mutate the old fixture or repair the deliberate defect. Review is
   read-only; any local verifier the built-in runs must stay in this new fixture
   and be logged. Its calls do not count as pilot-verifier runs.
4. Generate the wrapper prompt/schema and review contract from the pinned
   convergence engine using a clearly labelled deterministic boundary fixture
   (the engine-routing test harness shows how to capture requests without native
   calls). Fix repository/range/head to the new local fixture and replace only
   fixture PR navigation with the explicit local Git range, recording the exact
   adaptation diff. Keep the fork protocol instructions and result schema intact.
   This adaptation tests the review path, not real PR access or host merging.
   Record synthetic selector inputs; do not claim actual reasoning failures.

## Each pair

1. Create the request with `reviewContract.protocol: "claude-fork-v1"`,
   `engine: "claude-code-review"`, command level `xhigh` and the exact fixture
   head, under the verified shared policy. Claim it, reserve both native slots,
   and spawn the wrapper from the definition matching its exact resolved binding.
   Deliver the claimed prompt byte-for-byte; compare native tool arguments to
   the saved prompt. Bind the real wrapper ID immediately.
2. The wrapper invokes the unmodified built-in once. Capture the actual Skill
   invocation ID and distinct fork ID, then call `bindReviewFork` with those
   observed identities. Do not treat a launch acknowledgement as findings.
3. Capture actual native runtime model and effort separately for the wrapper
   and fork. Requested arguments, definitions and the wrapper's claims are not
   execution evidence. Any mismatch or unobservable setting makes that pair
   incomplete. Never silently lower effort or rewrite the observation.
4. Save the fork's **verbatim** output, invocation/completion and exact reviewed
   range evidence. Use `recordReviewFork` with real native routing observation
   and `reviewedHead`. Hash the original output bytes; retain all findings.
5. Relay those exact output bytes through native same-child messaging to the
   original wrapper. Save delivery evidence. It returns the actual engine schema
   `{verdict,feedback,reviewedHead}`. A deliberate defect should yield changes;
   an accepted transport envelope is not approval of the defective code.
   Accept the wrapper through the adapter with its separate observation.
6. Prepare the Thread version-2 receipt from actual evidence: wrapper/request,
   invocation, head, fork child/resultHash and same-wrapper relay/outputHash.
   Without a live rollout record this is receipt preparation, not proof that
   the rollout host accepted a native receipt. Preserve that distinction.
7. Reconcile both processes before progressing. If the wrapper ends early or
   the fork's status is unknown, retain the hold and evidence; don't relaunch.
   Continue another independently safe pair only if capacity and the original
   six-slot ledger permit it. An unavailable route is reported accurately.

## Finish

Record exact source hashes, six-slot expenditure, startup loading, requested /
resolved / observed settings, wrapper and fork identities, original findings,
relay bytes, schema acceptance and any incomplete slice. Save a public report
and hash index in the Thread candidate; raw transcripts stay private. Preserve
peer edits and the old evidence. Remove only these temporary project definitions
at close, and only when their bytes still match `preparation.json`; retain the
archival templates and evidence. No global settings restoration is needed.

Keep fixture and native claims separate. This check cannot establish real failure
escalation, rollout-host receipt capture, automatic merges or cold owner recovery.
After a passing check, present the corrected two-task proposal's remaining
remote/effect preflight and concrete launch agreement. Do not launch it here.

## Prompt

Execute the bounded Claude review-path check described in
`/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/handoffs/2026-09-23-claude-review-path-check.md`.
Work from the prepared private directory in that document. Verify source pins
and startup definitions, then use at most three sequential wrapper/fork pairs
(six native children total). Preserve actual effort evidence and verbatim
same-wrapper relay. Do not rerun the original capability probes, change global
settings, initialise a rollout, publish or merge. Report unsupported capabilities
without inventing evidence or exceeding the allowance.
