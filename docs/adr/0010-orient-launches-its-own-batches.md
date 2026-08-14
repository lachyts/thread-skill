# 0010 — orient launches its own batches; the steering answer is the authorisation

Date: 2026-08-14
Status: accepted (supersedes the launch conclusion of ADR 0003)

## Context

ADR 0003 ruled dispatch-as-artefact: orient emits prompt files plus cc-*
one-liners, "never launched sessions", because full-profile fan-out hit
"Prompt is too long", worktrees lose gitignored MCP configs, and terminal
one-liners were the only surface that reliably delivered a scoped session in
2026-08-08 tooling. On 2026-08-14 Lachy challenged the paste hand-off from the
SEO orient run, believing the cc-* lane had been retired into the rollout
engine. The docs showed the lane itself was correct (the fit test routed both
batches right — multi-repo, no PRs, gitignored profile edits), but the
challenge exposed a real tension: the wave-repair autonomy ruling — "Claude
does all mechanics, Lachy only decides; never hand him commands to type" —
generalises, and pasting a composed one-liner is pure mechanics. Meanwhile the
tooling gap had closed: `cmux workspace create --cwd … --command …` spawns an
interactive workspace running an arbitrary command through a shell.

## Decision

Orient launches its batch sessions itself. Two rulings (grilled 2026-08-14):

1. **Launch mode** — after writing the prompt file and stamping
   `dispatched:`, orient runs `cmux workspace create` per batch with the
   profile alias's *expanded* command (aliases don't resolve non-interactively)
   and verifies via `read-screen` that the prompt arrived. Emission of the
   one-liner survives only as the fallback when `cmux ping` fails.
2. **Launch gate** — the steering answer ("Autonomous" / the batch half of
   "Mixed") is the sole authorisation. No per-batch confirm after composition,
   accepted knowing batches run under `--dangerously-skip-permissions` without
   Lachy reviewing their composition first.

ADR 0003's scope reasoning otherwise survives intact: orient still never grows
a merge engine, non-PR ops work is still the wrong fit for the engine, and
batches still require separate scoped sessions — a Workflow/subagent inside
the orient session inherits the parent's MCP config and can never load a
different profile, which is why "run them inside the parent thread" stays
impossible, not merely unchosen.

## Rejected

- **Keep emitted-never-launched** — the paste as a deliberate "go" moment.
  Rejected: the decision already happened at steering; the paste is mechanics,
  and the repair-autonomy principle rules mechanics to Claude.
- **Confirm-at-launch gate** — a per-batch summary + "fire now?" after
  composition (steering happens before batches are computed, so this was the
  last review moment). Rejected by ruling: one decision point, not two.
- **Headless `claude -p` self-launch** — maximum autonomy, but loses session
  visibility and interactive MCP auth; the launched work is long-running and
  worth watching.
- **In-session Workflow fan-out** — impossible, not rejected: MCP profile
  inheritance (above).

## Consequences

- First live run validated the mechanic same-day: the 2026-08-14 SEO p4/p5
  batches launched as workspaces 38/39, prompts verified in-transcript.
- `--debrief` gains a live surface: still-open batch workspaces are readable
  via `cmux read-screen --scrollback` alongside task-note stamps.
- Non-cmux surfaces (Desktop app, SSH) degrade gracefully to ADR 0003
  behaviour — artefacts emitted, Lachy fires them.
- The batch prompt file's role sharpens: it is the batch's durable contract
  (the launched command still reads it via `$(cat …)`), not a hand-off note.
