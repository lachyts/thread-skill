# One-shot first pass; iteration escalates to Fable

An `opus` task gets exactly one un-iterated pass at each convergence layer — one plan, one
implementation with a single verifier run, one judged PR round. The first evidence of hardness
anywhere (a plan-judge `changes`, a first-pass planner/investigator block, a red one-shot verifier
run, an implementer block, a review-judge `changes`) escalates the task to `fable` for all remaining
work, judges included. The flip is one-way, sticky within the run, and stamped `model: fable` on the
task note at reconcile, so resume / `/thread:repair` re-dispatches start at fable. Opus never runs the
Ralph loop: `max_iterations` is fable's budget. Pre-stamped fable tasks (schedule §4.7 step-ups)
never escalate — there is nothing above fable — and run the full loop from the start. There is no
config switch.

The prompting mechanics: the opus code-writing prompt renders a `oneShotVerify` block in place of the
Ralph loop (red ⇒ commit work, no PR, note diagnosis, return `escalate=true`), and the fable takeover
re-renders the same prompt builder at the fable tier plus an `escalationContext` hand-over block —
empty-when-unused, like every other optional fragment. The takeover inherits the first pass's
worktree, committed work, and note diagnosis; an approved plan carries over un-replanned.

We chose this while executing `wave-skill-fable-fallback` (2026-07-12). The brief asked for a
"fallback": re-run blocked opus tasks on Fable. The grill inverted it — if opus's first attempt
doesn't land cleanly, letting opus burn its full iteration budgets first is the waste, not the
safety. Iteration is *evidence of hardness*, and hardness is exactly what the higher tier is for.
("Fallback" was rejected as the term for the same reason — nothing falls back; the task steps up.
See CONTEXT.md § Model tiering.)

## Considered Options

- **Exhaust-then-retry (the brief's literal reading)** — opus runs full budgets; a blocked exit
  triggers one whole-task fable re-run. Rejected: pays the full opus convergence bill (up to
  `max_iterations × verifier × max_review_rounds`) before the capable model ever looks, and the
  fable attempt re-treads work instead of inheriting a cheap, well-diagnosed first pass.
- **Lead-session per-wave retry** — after reconcile, the skill stamps blocked opus tasks fable and
  makes a second Workflow call before merging. Rejected: escalation is convergence logic, and the
  project deliberately moved convergence out of fumble-prone prose choreography into the engine
  (same reasoning as reconcile-wave.py replacing hand-edits).
- **Repair/resume-time only** — no automatic retry; the bump happens on the next re-dispatch.
  Rejected: a blocked wave halts and waits for a human, breaking zero-touch continuous mode for
  exactly the tasks automation exists for.
- **One-shot first pass + in-engine sticky escalation (chosen)** — uniform across all three loops
  and all run modes, no prose choreography, and the cost profile matches the stance memory:
  capability on hard work over token savings, with savings taken on the mechanical bulk.

## Consequences

- `thread:schedule` §4.7 step-ups become a *predictive* lever only; borderline candidates can safely
  stay opus since a wrong call costs one cheap first pass, not a blocked rollout.
- `review-blocked` and plan/Ralph blocks now always exit at fable — a block is a genuine wall or an
  input-gated decision, never "the cheap model wasn't enough", which sharpens `/thread:repair`'s
  input-gated-vs-agent-fixable triage.
- The opus implementer prompt changed unconditionally (the one-shot block is always-on for opus
  tasks), so this feature deliberately breaks the byte-identical resume-cache invariant across the
  upgrade: in-flight rollouts resumed across it re-run their implement stages. Safe (worktree setup
  is resume-safe) but re-spends — land the upgrade between rollouts.
- Mechanical tasks get cheaper (no forced iteration budget on green-first-shot work); proven-hard
  tasks cost one extra opus pass relative to pre-stamping them fable.
- The engine's result surface and reconcile grew `model` / `escalated` / `escalatedAt`, and the wave
  report an "Approved after escalation" section — escalations are legible per wave and in the
  completion log.
