# 0014 — stash and defer run the silent process scan

Date: 2026-09-01
Status: accepted

## Context

ADR 0012 wired process-observation capture (category 7) into `close` only, and
deliberately left stash/defer/handoff untouched: "low-energy exits must not
force a process pass." The same day's fresh-review flagged the hole that
ruling leaves open, using the skill's own origin story as the counter-example:
the Codex copy thread that motivated the entire method skill died *without* a
close. Had capture existed then, the sole capture door would have missed the
system's own worked example.

Revisited with Lachy (2026-09-01, ops-workspace orient session): the
"never force a process pass" concern protects *Lachy's* energy at an
end-of-rope moment — it was never about the agent's effort. A scan that is
autonomous and silent on NOOP costs him nothing at a low-energy exit.

## Decision

`stash` and `defer` run the same stage-gated category-7 scan as `close`,
autonomously and silently:

- The bar, the destination, and the entry format are `close`'s category 7
  verbatim (ADR 0012 / the method skill's capture contract). No second
  definition — both skills point at the same contract.
- Scope rule unchanged: the scan runs only when the capture resolves a
  project directory; shared-thread and no-project exits NOOP it.
- **NOOP is silent** — no "no process observations" line in the confirmation.
  A hit appends to the project's `METHOD.md` `## Candidates`, auto-commits
  that file (same hygiene as close), and adds at most one line to the
  stash/defer confirmation.
- `handoff` stays untouched: the work continues immediately in a fresh
  session, and that session's eventual close scans with full context.

This supersedes ADR 0012's consequence line "stash/defer/handoff are
deliberately untouched" for stash and defer only.

## Rejected

- **Ask-before-append** — re-litigates ADR 0011; the Candidates section is
  non-curated by design.
- **Full close triage at stash/defer** — they remain lightweight exits. This
  is one scan category, not close's seven; memory, knowledge, and vault-task
  triage still belong to `close` alone.
- **Keep close-only and accept the hole** — the motivating thread's death
  without a close is exactly the evidence that the hole swallows the
  highest-value material: threads that die untidily are often the ones whose
  process taught the most.

## Consequences

- Stash/defer gain a small silent write step; their "fast and decisive"
  contract is preserved by the silence rule — if the scan ever makes these
  exits feel heavy, tighten the category-7 bar (ADR 0012's lever), don't add
  ceremony.
- The cross-repo entry-format lockstep from ADR 0012 now binds three writers:
  close, stash, defer.
