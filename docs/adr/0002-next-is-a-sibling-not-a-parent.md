# `next` is a sibling, not a parent

`thread:next` — the router that answers "what's my next move?" — sits
*alongside* the decisive routes (`stash`, `defer`, `handoff`, `close`) as a
peer member, not above them as the sole entry point. The decisive routes are
invoked directly when intent is already known; `next` exists for the undecided
moment and dispatches to a sibling once a move is chosen.

We chose this because intent-detection can't be trusted with decisive moods:
when Lachy already knows "I'm out of time, lock this in", forcing that through
a router that summarises and recommends first adds latency and risks the
router second-guessing a decision that was already made. The hybrid was an
explicit user decision during design (over a router-first shape).

## Considered Options

- **Router-only** — one entry point (`thread:next`), every disposal flows
  through recommend-then-dispatch. Rejected: the decisive cases ("just stash
  it") don't need a recommendation, and a router can misread a decisive mood.
- **Routes-only** — no router; Lachy always picks the verb. Rejected: the most
  common real moment is genuinely undecided ("what's my move here?"), which is
  exactly a router's job.
- **Hybrid, `next` as sibling (chosen)** — decisive verbs for known intent,
  `next` for the undecided moment. `next` executes a chosen route by running
  the sibling's logic, so there is exactly one implementation per route.

## Consequences

- Six members instead of a minimal two; the family must stay conceptually
  coherent (one glossary, one task-writer) so it reads as a system, not six
  random verbs.
- `next` contains no route logic of its own — it must dispatch to sibling
  SKILL.md logic, never re-implement it. Any route behaviour change lands in
  one place.
