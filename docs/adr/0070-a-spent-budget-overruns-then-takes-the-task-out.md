# 0070 — A spent budget runs Overtime, then takes the task out

Date: 2026-11-06
Status: proposed. Grilled at `/thread:orient Thread Skill` on 2026-11-06, from Lachy's Note on [[thread-skill-p39-13-fresh-review-landing-loop-review-follow-ups]]: "if all I'm doing is approving another review round or another kind of run, I don't want to be asked about that ... there should be a budget of a set amount of extra runs that can happen until then, and it either gets taken out of another rollout or something like that." Amended 2026-11-18 by [[thread-skill-p39-15-adr-0070-settles-its-review-findings]], before anything is built: the orient grill of 2026-11-12 ruled the four questions its first review left for Lachy, and every finding of its two review rounds (c800df0/c1bf27, rounds 1 and 2) is settled below (§ Review findings settled). To be built by p39-13 (close's landing loop), p39-14 (the engine) and p39-21 (a task taken out more than once). The file keeps its first name, which those tasks cite; the term it coins is **Overtime** (it was "Overrun" until the amendment, a word the Night record already uses).

On acceptance it amends: close § The stop rule and ADR 0065 Decision 6 (no round after the budget), reversing ADR 0065's rejected option "A fourth round to review a CI fix after the budget"; fresh-review's ADR 0001 in `~/.agents` (a chain ends at three code rounds), through a fresh-review task; ADR 0033 d3 (`auto_retries = 0`), d5 (quota and infra blocks past their retries) and d6 (the budget's lifetime); ADR 0035's H9, a spent budget raised on Lachy's word through `record-answer --raise`, and ADR 0004's "repair keeps a spent budget"; repair § 5's "Has dependants → ask" for a take-out; and close's **Don't create tasks unsolicited** exception, whose one task now carries a take-out too. It does not amend ADR 0058, which has no review-blocked route.

## Context

Once a budget is spent, a landing and a rollout task both wait for Lachy, and in both his answer is mechanical:

- **A landing** (close's own-branch loop) has three code rounds. A `ci failed`, or a red Verify run after a clean round, once they are spent is "a decision for Lachy" (close § The stop rule), even a flake, and `--fixed-at-budget` refuses an untrailered fix, so whatever he says he merges by hand. A red run with no cause in the branch, or one also red on `origin/<default>`, is a decision for him at any count, and so is an unconfirmed round.
- **A rollout task** has `auto_retries` (2) automatic retries, and round caps: `max_review_rounds`, `max_plan_rounds` and `max_iterations`. After them, a set-aside task waits for `/thread:repair`'s `record-answer --raise` on his word (ADR 0035's H9 `raise <field>, hand back or defer`), which approves one more round, or for a bare hand-back (H10) that approves one more retry. A quota block past its five free retries waits for him the same way (ADR 0033 d5).

His Priorities card says the project runs without him, and since 2026-11-06 that approving another round or run is never his question.

## Decision

1. **Overtime.** Once a landing's or a rollout task's normal budget is spent, it takes up to `overtime_runs` more runs by itself (built-in 3, Lachy's "3 extra runs" of 2026-11-06; decision 8), never asked. The normal budget is a landing's three code rounds, and a rollout task's `auto_retries` with the round cap its stop spent (`max_review_rounds`, `max_plan_rounds` or `max_iterations`). An Overtime run is one of:
   - **a re-run**: a failed check or Verify run run again on the same tree, with no commit of a fix (decision 3 says which failures);
   - **a fix**: a commit that fixes a `ci failed` or red Verify run, with the one review round that reads it;
   - **a review round**: one more code round of a landing's chain (decision 9), or one more master-review round of an engine task, through `max_review_rounds` raised by one;
   - **a plan round**: one more plan round, through `max_plan_rounds` raised by one;
   - **a verifier pass**: one more verifier iteration, through `max_iterations` raised by one;
   - **a retry**: one more automatic re-entry of a set-aside task past `auto_retries`, an infra or quota block's included (decision 3).

   **One counting rule.** An Overtime run is one re-entry from a stop to the next stop or merge, whatever it holds: a fix with its review round is one, a revise with its review round is one, a re-run is one. In the engine one re-entry is one `auto-retry` verb call, raising by one the cap its stop spent; in a landing it is one record (decision 2).
2. **Where the count lives.** The count is durable, and nothing but a take-out resets it.
   - **A rollout task**: an `overtime_used` frontmatter marker on its task note, written by `reconcile-rollout.py auto-retry` in the save that re-enters it. An Overtime re-entry is always that verb's, never `hand-back`'s, and `hand-back` (ADR 0033 d6), a recorded answer and a supersede's `carry` leave the marker as it stands: a human answer gives back the normal budget, never the Overtime. Only `defer` clears it, the take-out's own (decision 5), which starts the task's next life under decision 6's count.
   - **A landing**: each Overtime run commits one record under `docs/reviews/` on the branch before it starts (`mode: overtime`, `overtime: <n>`, its kind and its key), and an Overtime review round's own doc carries `overtime: <n>` too. A resumed landing (a hold, a lost session, a later plain call's `stuck:`) reads the highest `overtime:` among the docs added since its PR opened, deleted ones included, by close's own Counting command with `overtime` for `round`, so no session gets a fresh three.
3. **Which stops run Overtime.** Every stop that only approves another run is an Overtime run once the normal budget is spent, and is never asked:
   - a `ci failed`, or a red Verify run, after a clean round once the landing's budget is spent: a fix;
   - a failure with no cause in the change, a flake, a runner problem or one also red on `origin/<default>`: a re-run, before the budget or past it, and never a stop for Lachy (his ruling of 2026-11-12, decided for him: any machinery snag is the system's); one red on master is also the master-runs reading's red-master fix (ADR 0084), and the landing is taken out once its Overtime is spent;
   - a confirmed blocking finding whose fix cannot be made to pass its reproduction: a fix, then the take-out;
   - an unconfirmed round (a checker lost twice): a review round;
   - an engine task past its `auto_retries` with its round cap spent or not (`lead-integrate.py`'s verdict cause 24, ADR 0035's H9 or H10 for it): a retry, with the raise of the cap its stop spent;
   - an infra block past `auto_retries`: a retry, after the 240-minute cool-down (ADR 0033 d5), so an infra loop is bounded by the Overtime;
   - a quota block past its five free retries (cause 22): a retry, after the 480-minute cool-down.

   A landing's CI infrastructure conclusions (`cancelled`, `timed_out`, `startup_failure` and the like) still never count towards a key or raise effort (close § The stop rule's CI key), but each re-run of one past the budget spends an Overtime run, so a `timed_out` the change causes (a test that hangs) is bounded too.
4. **His decisions still stop.** A decision only Lachy can make still reaches him as it does today, at any point in the budget or the Overtime, and spends nothing: a product or design call, an ADR change, or a reproduction close believes shows intended behaviour; a blocking fix outside the task; a gate, a credential or an irreversible sign-off (ADR 0008); a `## Needs you` question; an undecided RACE or UNVERIFIED; a refused or repeated descope (H5); an Integration set-aside with no `pr:`, a gone branch or a `pr:` the engine refuses (H6 to H8); merge-task's exit-1 texts outside ADR 0033 d8's allowlist (cause 15); the same Integration stop twice running (cause 23), whose fix is outside the task (a runner, a GitHub setting); a merge setting left for him (H13); an invalid round-budget stamp (H12). Two landing stops are his for the same reason: `max unavailable` (a spawn-depth setting only he changes) and a dirty tree (it may hold his own work). The Overtime replaces only approvals of another run.
5. **Then it is taken out.** With the Overtime spent and the work still not mergeable, or at once on the same feedback again (§ Decided for him), the work is taken out, and nobody is asked:
   - **A rollout task** leaves the rollout by repair § 5's clean defer, its retire block included: its worktree is removed, its integration anchor deleted and its PR closed with `--delete-branch`. GitHub keeps a closed PR's diff and commits (`refs/pull/<n>/head`), so the PR link stays the evidence, and the next rollout starts on a fresh branch, colliding with no old branch or worktree. The rollout runs on to its completion without it.
   - **Its dependants.** Its dependent closure (repair § 5 step 1: transitive, through `merged_into:` tombstones) leaves with it, each by the same clean defer, leaves first, so the take-out is a chain take-out and no ask. A dependant running or integrating under a live lead, or held by a serial Leg, is never written: it finishes first (his ruling of 2026-11-12, decided for him: finished work is not thrown away), and the take-out waits for it. A dependant whose merge lands the task's own commits (a stacked PR) merges the task through it, and nothing is taken out; any other outcome takes the task and the closure that remains out.
   - **A landing** is held: its PR stays open with auto-merge off, and its evidence goes into the landing's one follow-up task (the filed-findings task of ADR 0058 Decision 2, written then if the landing has none), so a landing still writes at most one task nobody asked for.
   - **The evidence stays out of the brief.** A take-out writes nothing into the task note's body, which descope's `_brief_items` and the plan judge read (ADR 0033's rejected option). It writes a stamped line in the rollout's `## Notes` (`- <stamp> take-out: [[<slug>]] after <n> Overtime runs (<stage>; <the last diagnosis's first line>; <pr url>)`), a `take-out` Run record event, and two frontmatter markers that `defer` never clears: `taken_out` (how many times, across rollouts) and `taken_out_of` (the rollouts), from which a later reader finds each take-out's evidence.
6. **A task taken out more than once.** The first take-out puts the task back in the open backlog, and the next orient places it again. The second marks it for a rewrite: the next Shaping session (orient, or orient-all's pass) splits, narrows or restates it from both take-outs' evidence, and it gets one more rollout; schedule's Pickup sweep never adds a marked task before its rewrite. The third puts one row on his needs-you list with every take-out's diagnosis and a recommendation. (Lachy, 2026-11-12: "Rewritten first, then me." Built by [[thread-skill-p39-21-a-task-taken-out-twice-is-rewritten-then-reaches-him]].)
7. **Listed, never alerted.** A taken-out task shows in the rollout's report (or close's landing row), its Run record and the weekly Reflection. It is no needs-you item until decision 6's third take-out, and no rollout pushes anything anyway (ADR 0075). (Lachy, 2026-11-06: "Listed, no alert".)
8. **The allowance is a Tuning key.** `overtime_runs` (an integer ≥ 0, built-in 3) resolves as `auto_retries` does, task note → rollout note → `~/.config/thread/rollouts.toml` (`[defaults]` or a repo table) → built-in, through `rollout-settings.py`, and a landing reads its repo's value the same way. It joins `TUNING_KEYS`, so the weekly reading may land it as an agreed knob, and revert it, unasked, inside the Guardrails like any knob (ADR 0037 d5). (Lachy's ruling of 2026-11-12, decided for him by his Note of 2026-11-06: "if all I'm doing is approving another review round or another kind of run, I don't want to be asked".) `auto_retries` stays no Tuning key, ADR 0033's rejected option standing for it.
9. **A landing's Overtime review rounds are rounds four and on.** The landing's chain goes on past `round: 3` only for an Overtime round: close names it as one when it invokes `/fresh-review`, and its doc says `round: <n>` (4 or more) and `overtime: <k>`. fresh-review's Step 2 check 3, "no fourth", is amended to dispatch such a round and no other, in `~/.agents` by [[fresh-review-skill-followup-a-landing-overtime-round-past-the-third]]: p39-13 waits for it. An Overtime round is read as the budget round is: a blocking finding on it is fixed until its reproduction passes, and land.sh's `--fixed-at-budget` already reads every doc whose `round:` is 3 or more.

## Decided for him (overturnable)

- One counting rule → decision 1's: one re-entry from a stop to the next stop or merge is one run, whatever it holds (technical: an engine revise and its review round are one re-entry, so "three" means three in the engine and the landing alike, and p39-14's "raised `max_review_rounds` up to three times" reads the same).
- The same feedback again → taken out at once, without spending the rest of the Overtime, before the budget is spent or after: an engine agent block whose fingerprint equals `auto_retry_sha` (cause 25), or a landing fix whose key has failed twice at `max` (technical: another identical run cannot change the outcome, and it is no decision only he can make). A re-run is exempt, since a re-run is how a flake clears.
- A re-run → for a GitHub Actions run, `gh run rerun --failed <run id>` on the run that failed, whether it ran on the reviewed commit R or on HEAD; for a commit status or a third-party check app, which gh cannot re-run, the push of the Overtime record (decision 2), which gives HEAD a fresh run of every check that runs on a push. A check that neither reaches cannot be re-run, and its Overtime is spent at once (technical: land.sh reads failures from R and HEAD both, and only Actions runs re-run).
- Reading a re-run → in the Overtime, land.sh takes each check's newest completed run on R or HEAD as its result, so a re-run supersedes the failure it re-ran (technical: today HEAD's pending run supersedes R's failure only under `--fixed-at-budget`, and a re-run would leave R's failure standing under the same key).
- Observing a re-run → close never polls: it waits on the run it started, `gh run watch <id> --exit-status`, a wait on the run itself bounded by a liveness limit, then calls `--queue`. A wait cut by its bound ends the landing `queued` with the Overtime record already pushed, so the next session or the daily lander (ADR 0028 d7) reads the count from it (technical: one snapshot read at once would see the re-run pending and switch auto-merge on).
- `auto_retries = 0`, or `overtime_runs = 0` → no Overtime: the stop that spends the normal budget is a take-out at once, never a re-entry and never his (technical: ADR 0033 d3's zero turns every automatic retry off, and asking him to approve the run is what this ADR ends).
- A take-out's retire block → repair § 5's whole block runs (technical: a kept branch or worktree collides with the next rollout's dispatch of the same slug, and a closed PR stays readable).
- A take-out's evidence → the rollout's `## Notes`, the Run record and two markers, never the task body (technical: ADR 0033 keeps records out of the brief).
- A held landing's evidence → folded into its one follow-up task, never a second task (technical: close's guardrail allows exactly one task nobody asked for).
- The term → **Overtime**, since "overrun" already names the Night record's "fallback overrun" in the weekly Reflection that will list take-outs; "raise" stays a live word: the Human fix's `raise` and ADR 0033 d7's automatic raise both stand, and an engine Overtime run's extra round is a raise (technical).
- Dev-time `/fresh-review` rounds → never count towards a landing's three or its Overtime (priorities: ADR 0065 already rules the landing's chain is its own; the Counting command is brought into line).
- A CI fix past the budget → its commit is reviewed by its one Overtime round before the merge is queued (priorities: production-ready, so no unreviewed fix lands).

## Considered options

- **Stop for Lachy on a failure with no cause in the change** (close's rule today). Rejected by his ruling of 2026-11-12: a machinery snag is the system's, and re-running a red-on-master check costs at most the Overtime before the take-out.
- **Infrastructure blocks never counting against the Overtime.** Rejected: ADR 0033 d5 has them spend `auto_retries`, and exempting them past it would retry a dying call every 240 minutes forever.
- **Deferring dependants as they stand, running or not.** Rejected: repair § 5 never writes a task a live lead is running, and a dependant about to merge is finished work.
- **Re-placing a taken-out task with no bound, or alerting him at the first take-out.** Rejected by his answer to #6: rewritten first, then him.
- **A fixed three.** Rejected by his ruling on #15: tuning the allowance is another approval he does not want.
- **Keeping the PR and branch open at a take-out.** Rejected: the next rollout's dispatch of the slug collides with them, and GitHub keeps a closed PR readable.
- **Writing the evidence into the task note.** Rejected, as ADR 0033 rejected it: the body is the brief.
- **A take-out task of its own for a held landing.** Rejected: close's guardrail allows one unsolicited task per landing, and its follow-up task can carry both.
- **Counting a fix and its review round as two runs.** Rejected: the engine and the landing would build different threes.
- **Keeping the name Overrun.** Rejected: two unrelated mechanisms under one word in one weekly Reflection.

## Consequences

- **What the builds amend.** p39-13: close § The stop rule (Decision 6 of ADR 0065 goes; **Counting** reads `overtime:`; **A decision for Lachy** keeps only decision 4's landing stops), land.sh's Overtime check read, and the follow-up task's take-out evidence. p39-14: `rollout-settings.py` (`overtime_runs` in `SETTING_KEYS` and `TUNING_KEYS`), `lead-integrate.py`'s verdict (causes 18, 22, 24 and 25 become Overtime runs or take-outs, H9 is no Human fix any more), `reconcile-rollout.py auto-retry` (the raise and the `overtime_used` marker) and a take-out verb on `defer` (the closure, its markers, its `## Notes` line and Run record event), execute § 4.5 step 1.2 and § 7's set-aside routes, and repair § 5 (a take-out's closure). p39-21: decision 6. When each lands, the ADRs it overturns (0033, 0035, 0004 and 0065) get their amendment notes.
- **The bound per task.** Per rollout: (`auto_retries` + one descope) × (1 + human hand-backs) agent and infra retries (ADR 0033), plus five quota retries per stretch, plus `overtime_runs`. Across rollouts: three take-outs, then Lachy.
- **CONTEXT.md** names **Overtime** and **taken out**, marked proposed until p39-14 lands; **Agent-fixable block**, **Clean defer** and **Human fix** say what changes once it is built.
- **Verify:** each finding below is named in this text; CONTEXT.md has no entry contradicting it; `make test` green.

## Review findings settled

Round 1 is c800df0/c1bf27 (15 findings, all filed); round 2 is its extra round (`-r2`), whose other eleven restate round 1's.

- #1, and r2 #1, a fourth round: decision 9 and the fresh-review task; ADR 0065 Decision 6 and its rejected option named as amended.
- #2, a re-run never observed and never counted: decision 2's record, and the Decided bullets on observing a re-run.
- #3, a no-cause failure routed both ways: decision 3 (his ruling) and decision 4's full list.
- #4, the retire block: decision 5, and the Decided bullet.
- #5, dependants running or integrating: decision 5's dependants (his ruling).
- #6, take-outs across rollouts: decision 6 (his ruling).
- #7, infra blocks: decision 3, and the Considered option.
- #8, two counting rules: decision 1's one rule.
- #9, the glossary: CONTEXT.md's **Agent-fixable block** amended, **Overtime** marked proposed.
- #10, the wrong ADR: the Status names ADRs 0033, 0035, 0004 and 0065, not 0058.
- #11, plan rounds and `max_iterations`: decision 1's plan round and verifier pass.
- #12, `auto_retries = 0` and spent quota retries: the Decided bullet, and decision 3.
- #13, non-Actions checks and R against HEAD: the Decided bullets on a re-run and reading it.
- #14, the term: **Overtime**, and "raise" kept live.
- #15, a fixed three: decision 8 (his ruling).
- r2 #3, where the count lives: decision 2.
- r2 #9, `auto_retries` is no Tuning key: decision 8 makes `overtime_runs` one in its own right.
- r2 #12, evidence in the brief: decision 5's evidence.
- r2 #13, a second unsolicited task: decision 5's landing.
