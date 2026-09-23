---
name: gather
description: 'Use when turning a project''s loose Obsidian tasks into a phased roadmap — the inverse of /thread:split; both converge on /thread:schedule. Triggers on "turn these tasks into a roadmap", "gather these tasks", "roadmap-ify/phase this backlog", or pointing at a project with loose tasks and asking for a roadmap. Proposes theme+dependency clusters, then grills by default (grill-with-docs / grill-me, invoked by skill name) to resolve phase names, ordering, membership, and per-task specs — the human decides; --light = clustering-only, bodies untouched. Then the mechanical writes per the shared writer specs; misfits stay loose. Never dispatches, never stamps wave:. Scope: Obsidian.'
---

# /thread:gather — turn loose tasks into a roadmap

`/thread:gather` turns **a project's disparate loose tasks** into a roadmap: cluster proposals →
grilled meaning → phase notes + `pN-M` renames + project-note surfacing. It is the **inverse of
`/thread:split`** — split decomposes a plan into tasks; gather forms phases from tasks that already
exist. Both converge on `/thread:schedule` **when the work is wave-shaped** (phases order meaning,
waves order merges — but not every roadmap wants a rollout; see step 5's execution-fit test).

Reference roadmap shape: the `[[GifLab]]` project note — phase notes in `Work/Phases/`,
`<project>-pN-M` task naming, two always-visible base blocks at the top of the project note.

## Scope

**Obsidian, with one sanctioned exception.** Reads and writes `~/repos/obsidian/Work/Tasks/`,
`~/repos/obsidian/Work/Phases/`, and the target project note. Never git/gh, never dispatches,
never stamps `wave:`. The exception: when step 3 grills **with docs**, the interview inherits the
`grill-with-docs` write surface — `CONTEXT.md` + `docs/adr/` in the **resolved project repo** —
and nothing else outside the vault, ever.

## Invocation forms

```
/thread:gather GifLab               # all loose open tasks linked to [[GifLab]]
/thread:gather [[GifLab]]           # explicit wikilink form
/thread:gather GifLab --light       # clustering-only: no interview, task bodies untouched except backlink rewrites
```

The argument resolves to a project-note slug exactly as `/thread:schedule` does (strip `[[...]]`,
case-fold). There is no `--regenerate`: the discovery filter (no `phase:`) makes re-runs
incremental by construction — already-phased tasks never re-enter.

## Skill flow

### 1. Discover loose tasks + the existing roadmap

Walk `~/repos/obsidian/Work/Tasks/*.md`. Filter:

- `status: open`
- `projects:` contains the target wikilink
- `tags:` **contains** `task` — phase notes (`tags: [phase]`, ADR 0005) are never gathered
- `tags:` does **not** contain `rollout`; skip `status: merged` tombstones
- **no `phase:`** — a phased task already has a home; gather only handles the loose ones

Then read the existing roadmap: `Work/Phases/<project-slug>-p*` (and `Work/Phases/Archive/`) →
the max phase number `N_max` and, per existing phase, the max task ordinal `M` (from
`Work/Tasks/<project-slug>-p<N>-<M>-*` filenames, archived included). Fractional phases keep the
dot (`p3.5`), per the writer spec. New phases number from `N_max + 1` (P1 when the project has none)
(a fractional `N_max` such as `p3.5` rounds up to the next whole phase, P4); existing numbering is
**never** changed.

Report the loose count and the roadmap shape found, and confirm before proceeding.

### 2. Propose clusters

Group the loose tasks by theme + dependency affinity (body wikilinks, `blocked-by:`/`depends-on:`,
shared repo/area, same source doc). Render a table:

```
proposed phase | members | rationale (1 line) | proposed order
```

plus an explicit **misfit list** — tasks that don't belong to any phase and stay loose. Not
everything must be phased. A task may also be proposed for an **existing** phase when it clearly
belongs there.

This is **a proposal, never a decision** — every row is an input to step 3's interview (or to the
step-4 gate under `--light`), not an outcome.

### 3. Grill the meaning (default)

A full-depth interview — one question at a time, recommended answer first — resolving:

- **(a) roadmap meaning** — phase names, ordering, membership (including assigning a loose task
  into an existing phase — `M` = that phase's next free ordinal). The human decides; gather never
  invents phases silently.
- **(b) per-task speccing** — every brain-dump capture gets its decisions grilled and written into
  a real body (goal, runnable prompt, verify line — the shape `add-task.md` prescribes).

**Run the interview through the user's grill skills — invoke by name, never copy their text**, so
edits to those skills propagate here for free. Resolve the project's repo from the project note's
`repos:` frontmatter (expand `~`), then gate:

- **Repo root has `CONTEXT.md` (or `CONTEXT-MAP.md`)** → invoke the **`grill-with-docs`** skill
  (Skill tool) and run its interview + documentation discipline, with doc writes directed at
  **that repo** — not the session CWD (grill-with-docs' default).
- **Repo resolves but no `CONTEXT.md`** → ask once, up front: "start a `CONTEXT.md` for
  `<repo>`?" Yes → `grill-with-docs` (it creates the file lazily on the first resolved term);
  no → `grill-me`.
- **No resolvable repo** (vault-only project) → invoke the **`grill-me`** skill.
- Multiple `repos:` entries: prefer the one with `CONTEXT.md`; still ambiguous → ask.
- **Neither skill installed** (gather ships in a public plugin; those are personal skills) →
  run the same interview shape inline: one question at a time, recommended answer first, walk
  each branch until shared understanding.

`--light` **skips this step entirely** — clustering-only, no interview, no docs discipline, and
step 4 leaves every task body untouched except backlink rewrites.

### 4. Write (the mechanical half) — gate first

Print the final disposition table and get a y/n (or adjustments) **before writing any files**:

```
phases to create (pN — name) | old filename → new filename | joins existing phase? | body respecced? | misfits (stay loose)
```

Then write, per the shared writer specs — **reference them for note shape, never duplicate the
schema**: `~/repos/workspaces/_shared/knowledge/add-writers/add-phase.md` (phase notes) and
`add-task.md` § Step 4 (its *Phased task* bullet) for renamed tasks.

1. **Phase notes** — `Work/Phases/<project-slug>-p<N>-<kebab-desc>.md` (`tags: [phase, <area>]`,
   `phase: N`, embedded name-prefix task base, `## Build sequence` listing the members), numbered
   from `N_max + 1`. An existing phase gaining members is **edited** (its
   `## Build sequence` extended), never duplicated.
2. **Task renames + stamps** — each phased task becomes
   `Work/Tasks/<project-slug>-p<N>-<M>-<kebab-desc>.md` with `phase: N` added to frontmatter.
   Before each rename: check the target basename is free, then grep the vault for `[[old-slug]]`
   and rewrite every backlink to the new slug (wikilinks don't follow filesystem renames). In full
   mode the body gets the grilled spec; under `--light` the body stays byte-identical except backlink
   rewrites — rename + `phase:` stamp only.
3. **Two-block surfacing** — ensure the project note carries the two always-visible base blocks
   (open-tasks list + stacked Phases table — shape from `_System/Templates/Project.md`; copy from
   a sibling like `[[GifLab]]`). **Only if absent** — idempotent, never clobber existing blocks.
4. **Misfits stay loose** — untouched apart from backlink rewrites, listed in the report.

### 5. Hand off — run the execution-fit test before naming a next step

Report what was written (phases as clickable `obsidian://` links, renames, surfacing status,
misfits). Then run the execution-fit test
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` — the canonical definition) on each
phase and name its lane — **do not default to `/thread:schedule`**:

- **Wave-shaped** (one repo, PR-per-task, machine-verifiable in-run) → name
  **`/thread:schedule <slug>`**. Any size — a one-task phase still qualifies; shape decides,
  not count.
- **Everything else** → the session lane: work the phase's `## Build sequence` one scoped
  session at a time — `defer` sets a task onto a day (`scheduled:` dates do the dispatch),
  `open` picks one up via its `## Launch` / `## Resume prompt` block. The fit-test doc lists
  the disqualifying signs (external publishes, window/calendar ordering, late verification).

Phases order meaning, waves order merges — gather never writes `wave:` either way.

## Don'ts

- **Don't invent phases silently.** Every phase name, ordering, and membership call is the
  human's — via the step-3 interview or the step-4 gate.
- **Don't renumber.** Existing phases and task ordinals are immutable; new phases number from
  `N_max + 1`, joins take the next free `M`.
- **Don't stamp `wave:`, `rollout:`, or `scope:`** — those belong to `/thread:schedule`.
- **Don't respec bodies under `--light`** — rename + `phase:` stamp only; the body stays
  byte-identical except backlink rewrites.
- **Don't force-phase a misfit.** Loose is a valid end state.
- **Don't write before the step-4 gate.**
- **Don't rename without the backlink rewrite** (and the basename-free check).
- **Don't duplicate the writer-spec schema** — `add-phase.md` / `add-task.md` are the note-shape
  source of truth.
- **Don't copy the grill skills' instructions inline** — invoke `grill-with-docs` / `grill-me` by
  name so their updates propagate; the inline shape is only the no-skills fallback.
- **Don't write outside the vault** — except `CONTEXT.md` / `docs/adr/` in the resolved project
  repo, via the grill-with-docs surface, during step 3 only.
- **Don't dispatch, and don't touch git/gh.**

## Verification

End-to-end against a fixture project with 6+ loose tasks (including empty brain-dump captures):

1. `/thread:gather <Fixture>` — discovers the loose set, reports the existing roadmap, proposes
   clusters + misfits.
2. Full run: interview resolves phases + specs; gate table approved; produces phase notes with
   correct naming/frontmatter/embedded base, renamed `pN-M` tasks with real bodies, surfacing
   blocks on the project note; misfits untouched apart from backlink rewrites. Grep old slugs →
   zero stale backlinks.
3. `--light` run on a second fixture: clusters confirmed at the gate, tasks renamed + stamped,
   bodies byte-identical except backlink rewrites (diff), no interview.
4. Docs-gate spot checks: project whose repo has `CONTEXT.md` → `grill-with-docs` invoked and doc
   writes land in that repo (not the session CWD); repo without → the one-time ask; vault-only
   project → `grill-me`.
5. `/thread:schedule <Fixture>` accepts gather's output with zero manual edits.
6. Grep the touched tasks: no `wave:` was ever stamped.
