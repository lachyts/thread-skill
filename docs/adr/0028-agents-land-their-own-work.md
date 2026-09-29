# 0028 — agents land their own work

Date: 2026-09-29
Status: proposed (amends ADR 0011's close guardrail "never touch a branch"; absorbs task p5-4)
*(Amended 2026-09-29, after p11-3's plan failed review twice: landing queues the merge and finishes; nothing waits for it. §§ 5–7 below are the amended text.)*

## Context

Close commits but never pushes. ADR 0011 made commits autonomous and never considered pushing; the
guardrail "close never merges, pushes, rebases or deletes a branch" was written to keep close off
branches that belong to other sessions. ADR 0025 then protected `master`, so a close-out committed
there cannot be pushed at all (p5-4). On 2026-09-28 the rollout session ended with its close-out on
an unpushed branch, and Lachy had to ask for the push and the PR. He wants none of this admin: once
work is done, it should reach master without his attention, however long that takes.

## Decision

**Landing** (CONTEXT.md) is the agents' job, end to end: push, PR, review, fixes, CI retries, merge,
cleanup. Lachy is asked only for a decision no agent can make.

1. **Scope.** Close lands its own close-out commits and the session's **own branch** (the branch
   whose work this session did, by ADR 0026's test). Another session's branch is still only reported.
2. **Review before merge.** The own branch goes through `/fresh-review`; close fixes the findings and
   merges once the review is clean and CI is green. The **close-out PR** (THREAD.md, handoff docs)
   merges on green with no review.
3. **No round cap.** The review/fix and CI-retry loops run until clean and green. They stop only on
   real non-convergence: the review ledger's regression stop, the same check failing the same way
   twice after effort has risen to `max`, or a finding that needs Lachy's decision. Then the PR stays
   open with the diagnosis. (Model escalation is unavailable under the Opus lock; effort rises
   instead.)
4. **The repo's rules decide the route.** Protected default branch → a close-out branch, PR and
   GitHub auto-merge. Unprotected GitHub repo → push straight to the default branch. No GitHub
   origin → commit locally and report.
5. **Queue and finish; the checkout never goes back.** Close commits the close-out on the default
   branch as before, pushes that commit to a `close/<date>-<slug>` branch (protected repos), opens
   the PR, labels it `landing` and queues GitHub auto-merge with a **merge commit**. It does not
   wait. The local default keeps the commit, so the tree is current; once GitHub merges, the next
   pull or rollout fast-forwards over it. Waiting inside the session was dropped: CI plus a strict
   update-branch can outlast one tool call, and a detached waiter needed lock and recovery
   machinery that did not converge in review.
6. **Handoff lands the same way,** with no wait: the doc is on disk the moment it is committed.
   `/thread:open save` stays commit-only.
7. **Durability.** A queued merge that fails (red CI, a PR left behind master, auto-merge refused)
   is retried by the daily lander (p11-7, run once a day whenever the laptop is awake) and by the
   next close in that repo. The "safe to end" banner means pushed and queued, not merged. The own
   branch's review (§ 2) still runs inline; only the CI wait moved out of the session.
8. **The landing register** is one estate-wide deny-list of repos agents never push to on their own.
   Any repo Lachy can push to lands unless it is listed. It gates close, handoff, the nightly lander
   and rollouts alike (schedule's dispatch gate refuses a listed repo). Initial entries: every
   `Animately/*` repo except `giflab`, `gifsicle` and `optimizer`.

## Considered options

- **Report stranded commits** (p5-4's recommendation). Rejected: it leaves the admin with Lachy.
- **A fixed round cap** (one fix round, or five). Rejected: Lachy prefers more loops to a PR left for
  him; the ledger stop already catches a loop that is making things worse.
- **Allow-list or owner-based register.** Rejected for a deny-list: nearly every repo he can push to
  should land, and the exceptions are few and known. The cost, accepted: a new team repo lands until
  someone lists it.

## Consequences

- AGENTS.md § Reviewing code says reviews run in the background and never block; landing's review
  is the one inline review, because the merge waits on its result.
- GitHub auto-merge and delete-branch-on-merge are switched on for `lachyts/thread-skill`
  (2026-09-29); other repos need the same settings, or close waits on CI itself.
- Own-branch landing (p11-4) points `<B>`'s upstream at `origin/<default>` while close's review loop
  runs, so `/fresh-review`'s `@{upstream}...HEAD` leg covers the whole branch; land.sh restores
  `origin/<B>` when it queues or holds (and on every other result but a preflight stop). A session that
  ends mid-loop leaves that residue; `git branch --set-upstream-to origin/<B> <B>` restores it.
