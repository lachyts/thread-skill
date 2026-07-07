# A phase is a plan, not a task

A project's roadmap phase (P1, P2, …) is its own vault type — `tags: [phase]`, home folder
`Work/Phases/`, named `<project>-p<N>-<desc>` — never a `task`-tagged note. Tasks inherit their
phase's number (`phase: N`, filenames `<project>-p<N>-<M>-<desc>`); `/wave:split` never starts a
second phase counter inside a phase, and it de-tasks a legacy task-tagged phase note it decomposes.
Phases stay a purely human planning tier: `/wave:schedule` requires `tags: task` at discovery and
computes waves only from file overlap + dependency links, so phase notes are structurally
undispatchable. One phase = one rollout holds by convention, not machinery.

We chose this after the Focus App collision (2026-07-07): P2 had been captured as a task note that
was really a multi-deliverable plan. Splitting it as-is would have made the note title the project
slug, restarted the phase counter (`focus-app-p2-watcher-drift-p1-1-…`), pointed `projects:` at a
task masquerading as a project, and left a "task" in the backlog that `/wave:schedule` would happily
dispatch as one giant unit.

## Considered Options

- **Nested mini-project slugs** — split the phase note as its own project with fresh p1/p2
  sub-phases. Rejected: two colliding "phase" counters in one filename, and a task note acting as a
  project node muddies the `projects:` chain.
- **Parent-task umbrellas** — keep the phase as an open task the children link to. Rejected: a
  task-tagged note that must never be dispatched is a standing footgun in every future rollout.
- **`--phase` filter on schedule** — keep phases task-tagged, scope rollouts by flag. Rejected:
  treats the symptom; the mislabelled note still lies about its type to every other consumer.
- **Janitor sweep / validation hooks** — background correction of mislabelled notes. Rejected:
  corrects after the fact what authoring-time knowledge prevents; the wave gates (split's
  approve-before-write table, schedule's discovery filter) are the intentional checkpoints.
- **First-class Phase type + authoring-time protocol (chosen)** — phase becomes a vault type with
  archive parity; the note shape lives in one writer spec (`_shared/knowledge/add-writers/add-phase.md`)
  read by `/add`, `/wave:split`, and free-form agents via CLAUDE.md § Task home.

## Consequences

- Schedule's discovery gained a positive `tags: contains task` filter — the protocol is
  machine-respected, not just documented.
- Split resolves a phase-note source to its **parent** project slug and inherits the phase number;
  intra-phase ordering is dependency links only (schedule re-derives layers from deps anyway, so
  sub-phase numbering carried zero machine value).
- Naming is load-bearing: the ordinal `M` distinguishes task files from phase files, and a phase
  note's embedded Bases block lists its tasks via `file.name.startsWith("<project>-p<N>-")` (Bases
  forbids wikilink literals in expressions; string prefixes work).
- Rollout notes remain `tags: [task, rollout]` in `Work/Tasks/` — an accepted exception, already
  excluded from discovery by the `rollout` tag.
