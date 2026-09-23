---
thread: thread-skill
written: 2026-09-23
status: pending
---

# Claude routing capability check

## Done and verified

The [delivery record](../implementation/2026-09-23-routing-delivery.md) identifies
the reviewed Thread/shared/skills/Reader commits. The
[acceptance matrix](../implementation/2026-09-23-routing-acceptance.md) separates
fixtures from live acceptance. Lachy authorised the staged testing on
23 September: "Ok yes please go ahead and do this. also i assume we can close
out \"thread 3\"?" The Codex check runs first in a fresh native task. This Claude
brief is prepared for a separate native Claude session after that report is
available; no Claude process has been launched by Codex.

Codex report now available: task **thread 4**, commit `8c5980b`,
`/Users/lachlants/.codex/worktrees/5c5a/thread-skill/docs/implementation/2026-09-23-codex-routing-capability-report.md`.
The five capability probes passed; the coordinator independently checked native
turn observations and all 49 saved evidence hashes. Read the
[coordinator audit](../audits/2026-09-23-codex-routing-capability-audit.md) for the
limits. Two findings concern the separately proposed Codex rollout's verifier;
they do not invalidate the capability result or expand this Claude check.

## What remains

1. Mark this handoff consumed when launched. Work in
   `/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill` and put
   private evidence/scratch under a new `.thread/claude-routing-capability-*`
   directory. Read the Codex capability report supplied by the coordinator,
   the delivery record and acceptance matrix. Inspect source status and preserve
   peer edits. Pin runtime bytes to the delivered commits; load candidate source
   for this check without globally installing or releasing either candidate.
2. Establish the actual native Claude session/account, child tools, Opus 5.5 and
   Fable availability, native effort lists and active overrides. Read the
   candidate shared resolver API at
   `/Users/lachlants/.codex/worktrees/thread-native-recovery/_shared/scripts/native_routing.md`
   and Thread `skills/execute/routing-and-evidence.md`.
3. Inspect the guarded migration plan at
   `/Users/lachlants/.codex/worktrees/thread-native-recovery/docs/implementation/2026-09-23-native-routing-migration-plan.json`.
   Recheck its source guards. Prefer an isolated session/project setting that
   demonstrably governs this session's children. Do not switch accounts or copy
   credentials. Shared global settings currently serve multiple profile aliases;
   do not mutate them under an assumption that they are session-local. If only
   a global change can enable the test, prepare the exact minimal diff, current
   hashes, rollback and restart/probe procedure for one explicit approval. This
   is a wider activation effect, not a routine decision inside the probe scope.
4. With trustworthy native capabilities, create the shared policy snapshot and
   private fixture repository. At most FIVE attempted native child dispatches:
   Opus easy/high; Opus difficult/xhigh; independent Opus review at xhigh;
   Opus maximum; Fable maximum. If Fable is unavailable, spend the final slot on
   bounded Opus maximum and record the unavailable route. At most TWO concurrent
   live children. Each refusal consumes a slot; at most ONE same-child formatting
   correction per probe. Native review fan-out counts inside the five-slot cap.
5. Use the candidate shared native adapter and actual result schemas. Record
   requested/resolved/observed settings independently. Actual native runtime
   evidence must show that starting and maximum efforts took effect. Definitions,
   requested tool arguments and model-authored claims alone are insufficient.
   Do not silently lower effort or fake acceptance when observations are missing.
6. The independent review child must run the unmodified built-in
   `/code-review xhigh` on the exact tiny fixture commit. Capture native child,
   engine, command level, invocation identity and reviewed SHA. Reasoning effort
   remains distinct from command level. Do not invoke `/code-review ultra`.
   Preflight fan-out behaviour; if the built-in cannot stay within the cap,
   report the precise incomplete stage rather than using a custom reviewer.
7. Separately exercise conflicting-profile rejection as a labelled local
   resolver fixture. Direct maximum/recovery probes are capability evidence,
   not proof of real quality-failure transitions. Finish independent useful
   probes within the original ceiling even if one slice is incomplete.
8. Save and commit a report separating native proof from local fixtures, with
   source hashes, slot expenditure and outstanding gaps. Keep raw receipts
   private. Restore any approved temporary setting only when its current bytes
   still match your change; do not overwrite a peer edit. Return the report to
   the coordinator. If checks pass, prepare the tiny two-task rollout proposal;
   do not initialise or merge before its concrete launch agreement.

## Decisions settled

Native Claude children and the current account only. The five-child capability
check is already authorised; routine preparation choices do not need approval.
Global activation, publication, API spending and PR/merge effects are outside
this check. Source candidate pins and historical records remain unchanged.
Ordinary work is Opus 5.5; Fable is maximum-effort recovery, not a planning default.
No heartbeat is required for this short check. Missing observable effort leaves
native acceptance incomplete; do not substitute requested settings.

## Gotchas found the hard way

Earlier profile overrides forced Opus and Fable effort independently of agent
definitions. The profile aliases share one settings file. Hot-loading a child
definition or Stop hook does not prove its effective effort. Earlier custom
reviewers and unreserved checks do not validate the new contract. Do not rerun
old pilots, restore their scratch files or replenish their allowances.

## Suggested skills

Candidate common policy and fresh-review guidance:
`/Users/lachlants/.codex/worktrees/shared-skill-routing/skills/`.
Native built-in code review inside an independent child. Use the verification
skill for evidence claims. Do not enter legacy protocol-3 execute for this check.

## Paste-ready prompt

Run the authorised bounded Claude routing capability check in this native Claude
session after reading the Codex capability report supplied with this prompt.
Read first: /Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/handoffs/2026-09-23-claude-routing-capability-check.md, then mark it consumed.
Work from that candidate directory and use a new private scratch/evidence folder.
Follow the five-child ceiling, actual-effort and built-in-review requirements.
Begin preflight without repeating approval for the check. Any necessary shared
global profile change needs its exact concrete diff approved because it affects
other sessions. Do not install globally, release or start a new rollout. Finish
with evidence and a concrete pilot proposal only if native capabilities pass.
