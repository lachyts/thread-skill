# The vault grammar — phase and task names, statuses, in flight

The one definition of how a vault note's filename places it in a phase and how its `status:` reads,
and a rollout's start stamp.
`reconcile-project.py`'s drift detector, execute's phase-close ceremony, orient § 2's sweep and the
reshuffle's R1 all read the vault through it, so they classify the same note the same way (§ Readers
lists every reader). A reader that needs a pattern or a set cites the section here instead of
restating it; the scripts that cannot cite a doc keep a literal copy that
`tests/contracts/vault-grammar.test.mjs` pins to this file.

## Phase and task filenames

- **Phase number** `<N>`: whole or fractional with a literal dot, `PHASE_N` = `\d+(?:\.\d+)?`
  (`3`, `19`, `3.5`). A fractional phase is written with a dot, never a hyphen: `p3-5-` is task 5 of
  phase 3 (`add-phase.md`, the vault's phase writer).
- **Phase note**: `Work/Phases/<slug>-p<N>-<desc>.md`. **Task note**: `Work/Tasks/<slug>-p<N>-<M>-<desc>.md`,
  `<M>` its ordinal (digits). A task's **short id** is `p<N>-<M>` (`p8-1`, `p3.5-2`).
- **Membership** is by the literal prefix `<slug>-p<N>-`: `-p1-` never reaches `-p10-`, `-p3-` never
  reaches `-p3.5-`, and a sibling project `<slug>-plugin` never matches. A name whose number does not
  fit `PHASE_N` (`p3.`, `p.5`, `p3.5.1`) is no phase member.
- **Comparing and ordering**: the whole part is compared numerically (`p03` is `p3`), the fractional
  part literally (`p3.5` and `p3.50` are distinct). Phases sort numerically: `1, 2, 3, 3.5, 5, 10`.

## Statuses

A `status:` is read lower-cased, with `-` read as `_`: TaskNotes' own spelling `in-progress` is
`in_progress`. Anything outside the sets below (`in progress` with a space, say) is a hold.

- **Landed**: `done`, `merged`, `dropped`.
- **Active**: `open`, `in_progress`.
- **Review**: `review`.
- **Hold**: any other status (`parked`, `blocked`, …): a deliberate hold, not drift.

## In flight

A task stamped `rollout:` whose rollout note is still live (CONTEXT.md **Live rollout**: the link
resolves to a note directly in `Work/Tasks/`), or `status: in-progress` (TaskNotes' own spelling),
`in_progress` or `review`; a phase with any such member.

## Rollout start stamp

A rollout note asks the Chorus Stage to start its lead with `start: unattended` (*Start when ready*,
CONTEXT.md **Start when ready**). The key is `start`, read on the first top-level `start:` line of
the frontmatter, its scalar lower-cased with quotes and an inline ` # comment` dropped:
`start: unattended`, `start: "Unattended"` and `start: unattended  # by the offer` are the stamp. Any
other value (`start: manual`, an empty `start:`), a `start:` nested under another key, and a body line are
no stamp; `started:` and `started_unattended:` are other keys.

- **Writers**: the execute offer, on the rollout note just written and never started: orient § 9's
  Start when ready answer, and schedule step 8's **Start when ready.** on a standalone run. And
  schedule § 0's **Put back**, which only restores to a prior the exact line its Supersede prep removed,
  when the run stops before step 6 writes its note.
- **Readers**: the Chorus Stage (`src/stage/unattended.py` in the Chorus repo, Chorus ADR 0052 d6 as
  amended). It starts one lead (`/thread:execute [[<rollout>]]`) in the note's Project root once the
  note is runnable, and replaces the stamp in place with its own record,
  `started_unattended: <stamp>`, which thread-skill never writes or clears. And `/thread:status`
  (§ 1's **Start stamp**), which reports a stamped note nothing has started as waiting for the Stage
  (its § 4 action 13).
- **Clearers**: `reconcile-rollout.py next`, on every call off `--dry-run` that exits 0 (the lead's,
  execute § 4.5 step 1), which removes every top-level `start:` line reading `unattended` and reports
  `startCleared`, so a running rollout clears it; a refused `next` (exit 1) writes nothing, so the stamp
  waits. And schedule's **Supersede prep**, which removes it from a prior it is about to supersede
  (and step 1's confirm names the clear).

## Readers

- `skills/_shared/scripts/reconcile-project.py`: `PHASE_N`, `LANDED`, `ACTIVE`, `phase_key` and
  `phase_sort` (the canonical form and the order) and `Rec.status` (the normalised read); its docstring
  cites this file.
- `skills/execute/scripts/reconcile-rollout.py` `touched-phases`: `PHASED_STEM_RE`, `_phase_key` and
  `_phase_sort`, which feed `--phases` to reconcile-project in execute's phase-close ceremony.
- `skills/_shared/scripts/next-action.py`: `DEAD_STATUSES` (Landed) and `OPEN_STATUSES` (Active).
- orient § 2 (the sweep's in-flight report) and the reshuffle's R1 (the item set and its reach tiers).
- `skills/reflect/scripts/reflect.py` `bug`, `decide`, `close` and `moot`: reconcile-project.py's `LANDED` and its
  status read (`Rec.status`), loaded, so an open task and a done one are told apart as everywhere else; decide and
  close count only done and merged as deciding a held trade (`DECIDED`, LANDED less dropped).
- `skills/close/scripts/repo-track.sh`: `active` (Active), read as reconcile-project's `Rec.status` reads
  it (a matched `'…'` or `"…"` pair stripped, as `_unq` does, then lower-cased with `-` as `_`). Close
  step 2's tracked-task search prose and its edge-case bullet (`skills/close/SKILL.md`) read Active the
  same way: `review` and `blocked` are never tracked.
- close's candidate statuses (`skills/close/SKILL.md` § A finished task closes itself, **Candidates.**):
  Active and Review, read per § Statuses.
- `skills/execute/scripts/reconcile-rollout.py` carry's `SHORT_ID_RE` and `_order_hints`' short-id match:
  `p<PHASE_N>-<M>`, the phase matched literally.
- `skills/execute/scripts/reconcile-rollout.py` `next`: `START_KEY` and `START_UNATTENDED` (the stamp
  above), read as `_scalar` reads a frontmatter value, and reported as `startUnattended`.
- `skills/status/SKILL.md` § 1's **Start stamp** and § 4 action 13: the stamp above, read straight from the
  frontmatter.
- `skills/_shared/scripts/estate-scan.py` (the estate scan): Landed and Active through `DEAD_STATUSES`,
  `OPEN_STATUSES` and `status_of`, loaded from the next-action script rather than copied; Review through its pinned
  literal `REVIEW_STATUSES`; and § In flight, for each open task's `inFlight`.
- `tests/contracts/vault-grammar.test.mjs` pins every literal copy above to this file, and checks both
  scripts' key and sort helpers against the examples under § Phase and task filenames.
