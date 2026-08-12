# Repair is a conductor, not an engine

`/thread:repair` orchestrates the existing `/thread:execute` engine to unstick a rollout — it diagnoses,
captures human decisions into task notes, reconciles drift, and then hands off to execute's resume. It
deliberately does **not** contain its own merge or convergence logic. We chose this because the engine's
worktree setup is already idempotent on re-dispatch (`wave-execute.workflow.js`) and `resume-filter`
already treats blocked tasks as "needs dispatch" — so re-running execute *already* re-attempts blocked
work. A repair that owned fix logic would duplicate the convergence loop and risk diverging from it.

## Considered Options

- **Parallel repair engine** — repair re-implements its own dispatch/merge loop. Rejected: duplicates
  the single hardest-won part of the system and would drift out of sync with execute.
- **Patch-in-place + force-flip** — repair edits the stuck PR directly, merges it, and force-flips
  `review-blocked → done`. Rejected: bypasses the review gate that blocked the task in the first place.
- **Conductor over execute (chosen)** — repair only does what re-running execute can't: capture an
  input-gated decision into the note, reconcile an out-of-band-merged task to done, and defer a wedged
  task. Everything else delegates to execute's resume, keeping one convergence path and an honest review gate.

## Consequences

- The `review-blocked → done` transition has exactly two sanctioned paths: normal re-dispatch through the
  engine (the task converges and lands), or `reconcile-wave.py resolve` for the drift case only (caller
  must have verified the PR merged). `mark-done` still refuses anything not at `review`.
- A trivial fix (e.g. filling one placeholder value) pays for a full re-dispatch + re-review rather than a
  one-line patch. Accepted as the price of not duplicating the engine and not bypassing review.
