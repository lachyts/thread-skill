# The execution-fit test — which lane owns a cluster

One system, two dispatch lanes. Every cluster of open tasks gets exactly one:

- **The rollout lane** (`/thread:schedule` → `/thread:execute`): worktrees, PRs,
  the three-layer convergence engine, per-wave auto-merge.
- **The session lane**: scoped sessions dispatched by calendar and attention —
  `defer` (`scheduled:` dates do the dispatch), a task's `## Launch` block via
  `open`, or orient's parallel-safe cc-* batches.

**The test decides, hard.** It is not a preference and not a count. A cluster is
**wave-shaped** when all three hold:

1. **One repo** — the tasks converge on ONE code repository.
2. **PR-per-task** — each task lands as an independently-shippable PR.
3. **In-run verification** — success is machine-checkable inside the run
   (tests / build / greps), not days later.

Wave-shaped → the rollout lane, even for a single task: a one-task rollout still
buys the plan gate, the verifier retry loop, the master review, and auto-merge —
autonomous convergence on one PR. Not wave-shaped → the session lane; a rollout
buys nothing there.

**Signs a task is NOT wave-shaped** (any one disqualifies it):

- Its core action is an external publish — CMS, live site, DNS, config console.
  (These always pause at the human gate regardless — ADR 0008 §3.7.)
- Its ordering constraint is a measurement window or calendar date, not file
  overlap. The engine's parallelism is forbidden by isolation windows, and
  file-overlap wave computation cannot see window/calendar constraints.
- Its verification only arrives days or weeks later (impact measures) — the
  verifier loop has nothing to verify inside the run.
- It is conversation-gated: it needs Lachy's input before an agent can act
  (task-writer § 5 notes this in the body).

**Mixed sets split.** The wave-shaped subset rolls out; the misfits stay
unstamped in the session lane. Name the split when reporting.

**Count is never a criterion.** There is no minimum rollout size — shape
decides, not size. (Decided 2026-08-12, ADR 0009; supersedes schedule's old
"<3 tasks" floor.)
