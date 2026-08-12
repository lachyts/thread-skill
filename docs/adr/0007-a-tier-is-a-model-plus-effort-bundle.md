# A tier is a model + effort bundle, not two knobs

Reasoning effort joins the tier ladder instead of becoming an independent config axis. Each tier is a
(model, per-role effort) bundle with the matrix fixed in the engine: `opus` runs planner/implementer
at **medium** and judges at **high**; `fable` runs planner/implementer at **high**, judges at
**high**, and the master review at **xhigh**. Mechanical reconcile stages run at **low** on either
tier. Escalation and schedule §4.7 step-ups therefore carry effort automatically — flipping a task to
fable is one move that upgrades both model and effort, and judges follow as before. The single escape
hatch is per-task `effort:` frontmatter (e.g. a monster task at fable/max), which overrides the
bundle's implementer/planner effort for that task only. There is no rollout-level effort config.

Decided in the 2026-07-18 grill that specced the wave-skill backlog. The brief ("add in effort level
alongside model for deciding what the sub agents settings get") read as a second knob; the grill
resolved it into the existing ladder because the Workflow engine's `agent()` already accepts `effort`
per call — the design question was never *can we set it* but *who decides it, and how often Lachy has
to think about it*.

## Considered Options

- **Independent effort knob** — rollout config gains an `effort:` block (per-role defaults) tunable
  per rollout, orthogonal to model tier. Rejected: it's a matrix to think about on every schedule
  run, most rollouts would ship the defaults anyway, and it lets the two ladders disagree (fable at
  low effort wastes the escalation; opus at max burns the savings the first-pass tier exists for).
- **Per-task uniform stamp** — schedule stamps `effort:` per task; all of that task's agents run at
  it uniformly. Rejected: uniform effort overpays mechanical stages and underpowers judges — the
  exact opposite of the engine guidance (cheap mechanical stages, expensive verify/judge stages).
- **Tier bundles with a fixed per-role matrix (chosen)** — one ladder, richer rungs. Zero new config
  surface; escalation semantics (ADR 0006) extend without modification; the stance memory holds
  (capability on hard work, savings on the mechanical bulk).

## Consequences

- CONTEXT.md § Tier is redefined: a tier is model AND effort; "model" alone is no longer a synonym.
- The engine's agent-spawn sites set `effort` from the task's tier + the agent's role; the per-role
  matrix lives in one place in `wave-execute.workflow.js`.
- Escalation reporting stays unchanged — `model: fable` on the note implies the fable effort bundle;
  no second stamp is needed. Only an explicit per-task `effort:` override appears in frontmatter.
- Tuning the matrix means editing the engine, not a rollout note. That is deliberate: the matrix
  encodes a stance (where effort is worth paying), not a per-rollout preference.
