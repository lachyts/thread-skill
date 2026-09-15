# 0015 — process candidates route by altitude

Date: 2026-09-15
Status: accepted

## Context

ADR 0012 gave capture one destination — the project's `METHOD.md` — and scoped
category 7 to closes that resolve a project directory; ADR 0014 carried that
scope rule verbatim into stash and defer. A process audit (2026-09-06) showed
what the scope rule costs. Lessons learned in tool repos and shared threads
fell on the floor: they were not project work, so every capture door NOOPed on
them. The ones that did land often landed in the wrong place — giflab's project
ledger holding lessons about the wave engine, which belong to every repo the
engine runs on, not to giflab.

The same audit found `knowledge/processes.md` accumulating that material by
hand in each workspace: a parallel process surface with no status vocabulary,
no provenance, no gate and no reconcile pass — an un-lifecycled system running
beside the one ADR 0012 built.

The method skill now defines three altitudes — project, seat, estate — with the
same `## Candidates` contract at each, and a routing test that decides between
them. That makes the destination a question the writers can answer, instead of
a constant they were built around.

## Decision

Close, stash and defer route each process observation by altitude, using the
routing test in the method skill's capture contract (§ Which ledger a row goes
to) — one definition, cited by all three writers, restated by none:

- Three ledgers, same `## Candidates` contract at each: project
  `<project>/METHOD.md`; seat
  `~/repos/workspaces/<workspace>/knowledge/METHOD.md`; estate
  `~/repos/workspaces/_shared/knowledge/METHOD.md`. Ledger paths are always
  written rooted, never as a bare `_shared/…` fragment.
- The test runs at every capture, in order, stopping at the first yes: holds
  only for this project's arrangement → project; holds for the next project of
  this kind with the subject stripped → the owning workspace's seat; holds in
  every workspace (agent practice, harness, tooling, grill discipline) →
  estate. Unsure → project, because promotion at apply corrects under-routing
  and nothing corrects over-routing.
- **Scope opens.** A capture with no project — a shared thread, a tool repo, a
  workspace-level session — skips step 1 and routes to seat or estate instead
  of NOOPing. Tool repos and shared threads still get no project `METHOD.md`;
  a project in an area with no paired workspace sends seat-shaped rows to the
  estate, and a context with no workspace has no seat either — seat-shaped
  rows from a CWD outside `~/repos/workspaces/` and outside a project go to
  the estate ledger.
- **Two bars by content kind.** Process — how the work is done — goes to a
  METHOD ledger via category 7; a fact about a tool or system (a flag, a quirk,
  a limit, a schema) goes to a knowledge topic file or `gotchas.md` via the
  knowledge row. The knowledge row no longer claims "processes", and
  `knowledge/processes.md` no longer exists anywhere — folded into the seat
  ledgers on 2026-09-15.
- Unchanged: the bar (stage-shift, pivot, reusable move, revealing failure,
  cross-workstream effect, with NOOP the expected common outcome), the
  create-from-template path, the silence rule at stash and defer, and
  `handoff` staying untouched.
- Row form aligned to the method contract: this repo's writer example now
  carries the `K<nn>` id and the `path § heading` evidence form it had
  omitted; the contract itself is unchanged.

## Rejected

- **Keep the NOOP and accept the hole** — the audit's own evidence is the
  counter-example: the material that fell on the floor was estate-shaped agent
  practice, the most reusable kind there is, and a tool repo is exactly where
  it gets learned.
- **One merged bar for process and facts**, routed to a destination later. The
  two bars have different owners (`/method` reconciles one, `/learn` the other)
  and different lifecycles; merging them hands every gotcha to a curation pass
  that has no verdict for it.
- **Ask before routing** — re-litigates ADR 0011 and 0014's silence rule. The
  test is mechanical, the section is non-curated, and an over-routed row is
  cheaper than a question at a low-energy exit.

## Consequences

- Amends ADR 0012's scope sentence "Category 7 fires only on closes that
  resolve a project directory; shared-thread and no-project closes NOOP it",
  and ADR 0014's "the scan runs only when the capture resolves a project
  directory". Both carry the amendment note.
- The cross-repo entry-format lockstep from ADR 0012 now binds these three
  writers at three altitudes: a row-form change moves with the method skill for
  all of them at once, or not at all.
- One commit rule at every altitude: a candidate append is committed
  immediately in its containing repo — a project ledger in the `~/Projects`
  monorepo, a seat or estate ledger in `~/repos/workspaces` — by
  `git -C <repo> add <path> && git -C <repo> commit -m "…" -- <path>`, the
  `add` being required because a freshly created ledger is untracked. It is
  versioned immediately rather than waiting on the daily sweep, ADR 0012's
  rationale unchanged; close's workspaces auto-commit then finds a seat or
  estate ledger already committed.
- The canonical design record for the altitudes and the routing test is
  `~/repos/workspaces/_shared/docs/adr/0003-method-at-every-altitude.md`. This
  ADR records only what changed for this repo's writers: where the two overlap,
  the workspaces ADR governs the design and this one governs close, stash and
  defer.
