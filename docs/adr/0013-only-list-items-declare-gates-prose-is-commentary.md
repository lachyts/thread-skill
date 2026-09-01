# 0013 — only list items declare gates; prose is commentary

Date: 2026-09-01
Status: accepted

## Context

Observed live 2026-09-01 (chorus-rollout wave 2, runId `wf_e8fc58df-a9e`): the
planner restated two already-approved gates as bullets in `### Gated inputs`,
then added a parenthetical footnote — *(Both restated verbatim from the task
note's "## Approved gates" — no new gates.)*. `parseGatedInputs` treated every
non-blank, non-heading line in the section as a declaration ("bare prose lines
count as declarations — fail-closed in the ambiguous direction"), so the
footnote became a phantom gate with no approved counterpart and the task
returned `gate-pending` — a spurious human pause after every declared gate was
signed off. The workaround (resume with the footnote appended to
`approvedGates`) put non-gate prose into the durable sign-off record. The
original comment optimised for the wrong ambiguity: real plans put commentary,
not gates, in prose.

## Decision

`parseGatedInputs` reads only **top-level** markdown list items (`- ` / `* ` /
`+ ` / `1. ` / `1) ` at indent < 2); non-list prose and nested sub-bullets in
the section are commentary, never a gate (a clean-room review caught that
trimming before the match let an indented sub-bullet footnote reproduce the
live failure). An indented non-list line directly under a gate is a soft-wrap
continuation and is rejoined, so a wrapped spend gate never reaches sign-off
without its mandatory cap. "None" counts only when a line (or bullet) is
exactly `None` — an embellished "None yet, but the deploy step will need
PROD_API_KEY." was a silent fail-open under a prefix match, so anything beyond
the bare word is commentary. Numbered items count because the planner prompt
says "one line per authorisation" — accepting them only moves toward
fail-closed, and markers are stripped before storage so `normalizeGate` (and
its Python mirror `_norm_gate`) stay untouched, in lockstep.

A section with no top-level list items and no exact "None" is unparseable and
returns `null` —
the same fail-closed door as a missing section (`plan-blocked`, ADR 0008's
gate-D path): a gate written only as prose can never silently pass, and a
re-plan under the hardened prompt self-heals into bullets or an explicit
"None". Compensating controls: the planner and plan-reviser prompts demand
bullets-only in the section, and the plan-judge treats non-bullet prose there
as an automatic "changes". Sign-off text stays a durable verbatim-matched
contract — only clean bullet text ever reaches "## Approved gates".

## Rejected

- **Pure bullets-only (prose silently ignored everywhere).** A gate declared
  only as prose sails through unpaused — fail-open on exactly the
  spend/credential/irreversible decisions ADR 0008 exists to keep out of agent
  hands. The engine already refuses to trust the judge alone on this section
  (the missing-section null path), and this would abandon that stance.
- **Bullets-when-present with a prose fallback.** Keeps the spurious-pause bug
  alive for a commentary-only section (a narrower form of the live failure),
  carries the identical mixed-case residual, and adds a second parse mode to
  test.

## Consequences

- A prose-only declaration now costs a plan round (`plan-blocked` → re-plan)
  instead of a bogus human sign-off request; so does an embellished `None`
  ("None — the task is read-only.") that the old prefix match tolerated.
- A column-0 prose line after a bullet is always commentary, never a lazy
  continuation — the live footnote sat at column 0, so wraps must be indented
  to survive; the prompt's one-bullet-per-gate rule makes wrapping rare.
- The residual mixed case — bullets present plus a NEW gate written as prose —
  remains fail-open at the parser; the judge's automatic-"changes" rule on
  non-bullet prose is the control that closes it.
- The prompt-byte change invalidates in-flight rollouts' resume caches
  (planner/judge calls re-run cleanly — cost, not corruption); ship between
  rollouts.
- `reconcile-wave.py` (`cmd_approve_gates`, the pending section) is untouched:
  it parses the machine-written section reconcile itself emits from the
  engine's `gatedInputs` array, which is always bullets.
