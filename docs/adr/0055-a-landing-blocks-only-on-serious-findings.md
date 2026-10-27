# 0055 — A landing blocks only on serious findings

Date: 2026-10-27
Status: accepted. Ruled with Lachy after the review-convergence audit (`docs/audits/2026-10-27-review-convergence.md`): he picked "serious only" as the bar an agent's own branch must clear before its merge is queued, and "wait for my call only when a serious finding is open". The rest are technical calls, decided and listed here. Amends ADR 0028 Decisions 2 and 3; widens close's "don't create tasks unsolicited" guardrail by one case.

## Context

ADR 0028 made close land the session's own branch through a `/fresh-review` loop with no round cap, merging only after a clean round: a code round with no accepted finding. narcissus-avp PR #65 ran 16 rounds over five days and never had one. Its code rounds returned 10 to 15 findings each until the end, while the fixes between rounds shrank to a few lines. About 5 of the 185 landing-loop findings were serious (a crash or a wrong result in normal use), and none came in the last three rounds. The same deferred items came back round after round: the reviewer is told never to read earlier review docs, and every round re-read the whole branch. Six times a later round asked to undo an earlier round's fix. The ledger's regression stop never fired, because the loop was not chasing its last round's fixes. It was re-raising old items and reversing itself, which the ledger cannot see.

PR #65 is the long tail, not an outlier. Since 2026-09-15, none of 452 Claude review rounds across the estate has returned zero findings. The `xhigh` cell (`o48-xhigh-v1`: ten inline angles, no verify phase, recall over precision) fills its cap of 15 on a 77-line diff as readily as on a 1,000-line one. So "no accepted finding" has only ever been met by marking findings deliberate, and 78% of loops ended on the ledger instead.

Human teams and AI review tools stop on a different condition: no open *blocking* finding. Google approves a change that improves code health and marks minor points `Nit:`. Conventional Comments and Gerrit separate blocking from non-blocking. Anthropic's Code Review never blocks on a Nit and skips re-review when no Important finding is open. LLM reviewers are low-precision, and identical runs disagree, so a loop that treats every finding as work does not settle.

## Decision

1. **The blocking test.** A finding blocks a landing only when its failure scenario is one of these:
   - (a) a crash or hang;
   - (b) data loss or corruption;
   - (c) a wrong result;
   - (d) a security hole;
   - (e) the named test failing: the task's `**Verify:**` line, or the acceptance list of the ADR or spec the branch builds.

   Clauses (a) to (d) count only on a path the branch ships for normal use. Everything else is **non-blocking**: an edge, error or debug path, docs and comments, naming, style, duplication, performance, a refactor. The session landing the branch grades each finding against this test and names the clause. The reviewer does not grade, because the `xhigh` cell emits no severity and a model's own severity rating is close to random (Greptile's measurement).
2. **A clean round is a code round with no blocking finding**, alongside the existing checks (mode, effort, head, digest). Non-blocking findings are never fixed on the branch: every fix is new code the next round reads (70% of PR #65's findings cited lines an earlier fix had written). They are **filed** instead, verbatim, in one follow-up vault task per landing. The landing creates that task without asking: Lachy's pick is the approval, and the task carries no `fixes:`, because it is planned follow-on work, not an Escape. A finding that is wrong is **rejected**, with its reason. "Deliberate" is no longer a category for something real but small.
3. **Repeats and reversals never block on their own.**
   - A **recurring** finding restates one an earlier round of this landing filed or rejected (same file, same concern). It blocks only when it brings a failure scenario the earlier one lacked.
   - A **reversal** asks to undo an earlier round's fix. The earlier fix stands and the reversal goes into the follow-up task, unless a test, the spec or a rig run settles which reading is right.

   The rollout engine's judge already works this way: "Do not contradict guidance you gave in an earlier round"; a new objection rejects only if the new commits introduced it.
4. **A budget of four code rounds, and only an open serious finding reaches Lachy.**
   - **The budget.** If the fourth code round still has a blocking finding, the loop holds without fixing it, and the open findings go on a `Needs your call:` row. Four matches execute's built-in `max_review_rounds` and Self-Refine's cap.
   - **The ledger's regression stop no longer ends a landing.** It is the agent's to resolve: the next fix reverts to the root instead of patching a patch (fresh-review's "never a third patch"), and the next round reviews it. The budget bounds the loop instead.
   - **Unchanged:** the CI and Verify stops, and a finding that needs a product or design call.
   - **What reaches Lachy.** A merge is queued only after a clean round, so a landing reaches him only when a serious finding is still open at the budget, or for a decision no agent can make (Chorus ADR 0110).
   - **fresh-review's own chains, outside a landing,** take the same rules: they end at a round with no blocking finding and never go to Lachy on a ledger STOP. This absorbs the stop-rule part of thread-skill task p30-2.

   **Every code round still reviews the whole branch.** With only serious findings blocking, a second full look is a second independent sample for serious bugs; about half of Snyk's LLM findings turned up in only one of five identical scans. The noise a full look re-raises can no longer hold the merge.

   **The landing loop runs no `simplify` rounds**, because a cleanup is never blocking and could only be filed. **"A full-cap round earns one more round" no longer applies to a landing**: the engine ranks most severe first, so what the cap cuts is the least severe.
5. **Every round is recorded, mechanically, and read weekly.**
   - land.sh's own-branch `--queue` and `--hold` record every review doc on the branch through fresh-review's `review-round.py`, so a landing cannot end unrecorded. fresh-review still records each doc when its findings arrive, and again when it is consumed.
   - The `review-round` line gains the doc's `status`, the `branch`, the diff size (`lines`, `files`), and the disposition counts: `blocking`, `open`, `filed`, `recurring`, `reversal` and `rejected`. These are parsed from a fixed `## Disposition` format.
   - The weekly Reflection's `freshReview` reports each landing: rounds, findings and blocking per round, filed, open and reversals. Until now it reported only rounds with regressions.

## Considered options

- **Keep "no accepted finding".** Rejected: it has never been reached by a Claude round, so every landing ends on the ledger or a question to Lachy.
- **Serious plus edge cases.** Rejected by Lachy: PR #65 had three to eight edge-path findings every round, so the loop would not settle either.
- **Re-review only the fixes after round 1**, as Anthropic's Code Review and CodeRabbit do. Rejected for now:
  - it gives up the second sample of the original code;
  - the ledger's regression ratio would be meaningless, since a fix-range review cites fix lines by construction;
  - it breaks the clean round's digest check against land.sh's whole-branch digest.
- **A plateau stop** (blocking findings not falling over two rounds). Dropped: the four-round budget bounds the same loop with less mechanism.
- **A diff-size gate.** Rejected: the estate data shows the `xhigh` cell filling its cap on small diffs too (Spearman 0.25 between size and rounds). Size is recorded and reported, not gated.
- **Severity from the reviewer** (the `max` cell's verify phase). Rejected: its verifier grades whether a finding is real, not whether it is serious, at about eight times the wall clock per round.

## Consequences

- **Edge-case and debug-path issues ship**, and wait in the follow-up task. This is the cost Lachy accepted.
- **The session grades its own branch, which is a bias risk.** Three things answer it: the test is written down, every grade in the doc names its clause or its reason, and the weekly reading reports blocking rates per landing, so a session that never blocks shows up.
- **ADR 0028 Decision 3's "no round cap" is replaced** by the budget of four. Decision 2's "merges once the review is clean" now means clean by this test.
- **Ledger fixes ride along:**
  - `review-ledger.py` walks history with `--full-history`; it was blind to docs on a merged branch: 5 of 39 doc commits on narcissus-avp.
  - It counts simplify tables with lettered rows (A1, S1, E1) and an angle column; four docs read as zero findings.
- **On PR #65's history this ends the loop at about round 2:** round 1's three serious findings fixed, and round 2 had none. This is an estimate: the counterfactual round 2 would have reviewed a smaller fix set.
- **Verify:** fresh-review's `test_review_round.py` and the new ledger tests pass, and thread-skill's `make test` passes.
