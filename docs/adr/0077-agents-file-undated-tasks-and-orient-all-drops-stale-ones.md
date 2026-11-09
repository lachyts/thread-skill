# 0073 — Agents file undated tasks without asking; orient-all drops stale ones

Date: 2026-11-09
Status: accepted (grilled with Lachy, 2026-11-09, from a custard doof stick close). Amends ADR 0011 d1 ("vault tasks
stay gated") and ADR 0017's "a loose end reaches the task menu"; extends the Readiness grade (ADR 0041, ADR 0054).
Not yet built: the specs and scripts it names still carry the old gate.

## Context

ADR 0011 kept new vault tasks behind a question because "they surface on the daily agenda — the one destination
with ongoing attention cost". On 9 Nov 2026 that premise was checked against the vault: of 733 open tasks, 102 carry
a `scheduled:` or `due:` date; the other 631 never reach a day page. They sit in their project's list, which orient
and orient-all read. Meanwhile the gate kept asking, and Lachy, approving a task at a close, said:

> I feel like you should be able to file tasks without having to ask me … can we update how that works so that you
> can file a task without having to ask me?

His 4 Nov ruling already pointed the same way: automation files its actionable output into the shared backlog,
batched and quiet. Asked how filed tasks should be kept in check, he chose no separate pruning, because orient-all
already reads every open task — "I kind of don't want to know about these tasks at all and I kind of want them to be
just automatically folded into Orient or dropped from Orient." Orient-all folds them in (its grader grades every open
task), but it had no way to drop one: a stale or duplicate task was graded and then worked or asked about.

## Decision

1. **Undated tasks need no approval.** Any agent may file a real follow-up as an undated task in its project's list
   (task-writer §§ 1, 4 and 5), without asking. It never carries `scheduled:` or `due:`, so it never reaches a day
   page. Close's step-6 menu stops asking about new tasks; the mark-done question (ADR 0026) is unchanged.
2. **Dated tasks only on his word.** A task gets a date only when Lachy asks for one (defer, "put this on Friday").
3. **No separate pruning.** No agent-filed marker, no review batch, no expiry: orient-all is the pruning.
4. **A fifth Readiness grade, Drop.** The grader may drop any task, his own included, when it duplicates another open
   task or is confidently stale. A dropped task moves to the archive (reversible, never deleted) and is recorded in
   the Grade log only; nothing he reads lists it. Any doubt is a question instead: the task becomes a One call asking
   whether to drop it, inside the pass's budget.

## Consequences

- Close's report names filed tasks as one count line, not a menu, so a close no longer stops on task approval.
- To build: close SKILL (Propose-first bullet, Destinations row, step 6, the "Don't create tasks unsolicited"
  guardrail), task-writer (the undated rule), orient-all and `readiness-grade.md` (the Drop grade and its
  confidence rule), `estate-rank.py` and `estate-dispatch.py` (rank and write a Drop as an archive move), and the
  estate rule in `~/.agents/knowledge/task-home.md`.
- Risk accepted: an occasional real task is dropped unseen; it stays findable in the archive.
