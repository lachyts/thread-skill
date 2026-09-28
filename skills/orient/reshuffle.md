# Reshuffle — orient's reshape step

Orient § 5 runs this after Lachy picks **Reshuffle** (or at once for a scoped target). It takes the
target's open work, sorts it, grills what is unclear, and writes the result at one gate. It carries
the machinery of the retired `split` and `gather` verbs (ADR 0027): gather's roadmap forming and
renames, split's decomposition and task writing.

**Write surface.** `~/repos/obsidian/Work/Tasks/`, `~/repos/obsidian/Work/Phases/`, the target
project note and, for pull-ins, the source project's notes (pointers only). When R3 grills **with
docs**, the interview also writes `CONTEXT.md` + `docs/adr/` in the **resolved project repo**, and
nothing else outside the vault. Never git/gh. Never stamps `wave:`, `rollout:` or `scope:`: orient
§ 6 hands wave-shaped phases to schedule, which owns those.

## R1. The item set

Walk `~/repos/obsidian/Work/Tasks/*.md` and `~/repos/obsidian/Work/Phases/*.md` for the target
project(s) (`projects:` contains the wikilink; `<slug>-p*` for phase notes). Skip notes tagged
`rollout` and landed statuses (`done`, `merged`, `dropped`). Give every item its **reach tier**
(CONTEXT.md **Reach tiers**):

- **In flight — frozen.** A task stamped `wave:`/`rollout:` whose rollout note is still live (the
  link resolves to a note in `Work/Tasks/` root), a `dispatched:` stamp ≤ 7 days old, or
  `status: in_progress` / `review`; a phase with any such member. Shown for context. Its scope,
  phase and body never change. New work may still join its phase.
- **Unstarted — movable.** A phased task (`phase:` set) that is not in flight, and phase notes with
  no in-flight member. May be re-phased, merged, unbundled, dropped, or the phase retired.
- **Loose — open.** `tags:` contains `task`, no `phase:`, not in flight. Anything goes, including a
  re-home to another project.

Add the **related projects** orient § 2 found: their unstarted and loose items that overlap the
target are candidates to **pull in**. Their in-flight items stay where they are.

**Scoped target** (a single note, plan file or inline prose): the item set is that source alone,
plus any tasks already written from it. The project's roadmap is read only for numbering.

Then read the roadmap numbering: `Work/Phases/<slug>-p*` (and `Work/Phases/Archive/`) → the max
phase number `N_max` and, per phase, the max task ordinal `M` (from `Work/Tasks/<slug>-p<N>-<M>-*`
filenames, archived included). Fractional phases keep the dot (`p3.5`); a fractional `N_max` rounds
up to the next whole phase. New phases number from `N_max + 1` (P1 when the project has none);
existing phase numbers are **never** changed.

## R2. Sort and propose

Sort every non-frozen item as **clear** (its body already says what to do: goal, scope, how to
verify) or **unclear** (brain dumps, one-liners, anything whose intent needs Lachy). Then propose a
disposition for each and render the proposal:

```
proposed phase | members | rationale (1 line) | proposed order
```

plus lists for everything that is not a plain phase membership:

- **Unbundle** — a brain dump holding several ideas → one task per idea.
- **Move** — an unstarted task to another phase; **merge** — two items that are one change.
- **Drop** — an unstarted or loose item no longer worth doing; **retire** — an unstarted phase
  emptied by moves or drops.
- **Re-home** — a loose item that belongs to another project; **pull in** — a related project's
  unstarted or loose item that belongs here.
- **Misfits** — items that stay loose. Loose is a valid end state; not everything must be phased.
- **Frozen context** — the in-flight items, read-only, so the proposal can be read against them.

A task may join an **existing** phase (in-flight ones included) when it clearly belongs there.
This is **a proposal, never a decision**: every row is an input to R3's interview or R4's gate.

**Decomposing a plan** (scoped targets and large unbundles). A task is **one independently
shippable, separately verifiable unit** (about one PR, one coherent change). A distinct artifact is
one task; "and then" or "depends on the above" is a dependency or a phase boundary, not necessarily
a new task; a change spanning many files as one coherent edit is still one task. Don't manufacture
same-file clusters that schedule would re-merge. For each task capture a one-line scope, the
repo/cwd, the process (Spec Kit or freeform) and the runnable prompt. Record `touches:` only from
file paths the source actually names; when files aren't inferable, omit it and let schedule
resolve it. Record dependencies ("needs X", "after X lands") as `[[task]]` links. Phases: if the
source **states phases**, honour them; otherwise infer them as dependency layers numbered from
`N_max + 1` (tasks that depend on nothing form the first new phase, tasks depending only on those
the next, and so on). A phase-note source is a single phase: its tasks inherit its number and its
**parent** project slug (from `projects:`), never a nested counter.

## R3. Grill the unclear

A full-depth interview, one question at a time, recommended answer first, resolving:

- **(a) roadmap meaning** — phase names, ordering, membership, moves, drops, unbundles, re-homes
  and pull-ins. The human decides; the reshuffle never invents a phase silently.
- **(b) per-item speccing** — every unclear item gets its decisions grilled into a real body (goal,
  runnable prompt, verify line, the shape `add-task.md` prescribes). An unbundled task quotes its
  slice of the brain dump verbatim as **His words**.

Clear items are not grilled; they go straight to the gate. Grill cluster by cluster, highest value
first (the cluster holding orient's recommendation leads). **Lachy can stop at any point**: what is
resolved goes to the gate; everything unresolved stays loose, untouched, for the next reshuffle.

**Run the interview through the user's grill skills, invoked by name, never copied**, so their
edits propagate. Resolve the project's repo from the project note's `repos:` frontmatter (expand
`~`), then:

- **Repo root has `CONTEXT.md` (or `CONTEXT-MAP.md`)** → invoke **`grill-with-docs`** (Skill tool),
  with doc writes directed at **that repo**, not the session CWD.
- **Repo resolves but has no `CONTEXT.md`** → ask once, up front: "start a `CONTEXT.md` for
  `<repo>`?" Yes → `grill-with-docs`; no → `grill-me`.
- **No resolvable repo** (vault-only project) → **`grill-me`**.
- Several `repos:` entries: prefer the one with `CONTEXT.md`; still ambiguous → ask.
- **Neither skill installed** (this plugin is public; those skills are personal) → run the same
  interview shape inline.

## R4. The gate

Print the final disposition table and get a y/n (or adjustments) **before writing any file**:

```
phases to create (pN — name) | old filename → new filename | joins existing phase? | body respecced? | unbundled / moved / merged / dropped / re-homed / pulled in | misfits (stay loose)
```

A scoped target adds a **source-disposition footer**, e.g.
`source: focus-app-p3-capture-tasknotes → phase note (legacy task-tagged: retag [phase] + move to Work/Phases/)`.
Lachy may merge, split, rename, re-phase or drop rows; re-render until approved. This is where
granularity is corrected cheaply: nothing exists yet.

## R5. Write

Note shape belongs to the writer specs; reference them, never duplicate the schema:
`~/repos/workspaces/_shared/knowledge/add-writers/add-phase.md` (phase notes) and `add-task.md`
§ Step 4 (frontmatter, `## Notes` body, its *Phased task* bullet) plus, for a task with a launch
signal (a repo, named MCP servers, live branch state), `add-task.md` § Launch context (its
`## Launch` and `## Resume prompt` blocks).

1. **Phase notes** — `Work/Phases/<slug>-p<N>-<kebab-desc>.md`, numbered from `N_max + 1`. An
   existing phase gaining members is **edited** (its `## Build sequence` extended), never
   duplicated. A retired phase gets `status: dropped` and one line naming where its members went.
2. **Tasks**, each as `Work/Tasks/<slug>-p<N>-<M>-<kebab-desc>.md` (`M` = the phase's next free
   ordinal) with `phase: N`:
   - **New tasks** (unbundles, decomposed plans) add only what the reshuffle knows on top of the
     spec: `work_depth:` (shallow / standard / deep) from size; `touches:` from R2, omitted when
     not inferable; `## Notes` opening `**Phase N · Task M** of [[<Project>]]`, then the process,
     the cwd, `Depends on [[...]]` links and the 1–2 line goal; the runnable prompt in the
     `## Resume prompt` block when the task qualifies for launch context, else as a fenced block
     under `## Notes`; and a closing `**Verify:**` line.
   - **Phased or moved tasks** are renamed and stamped. The body gets the grilled spec when R3
     respecced it; a clear item's body is unchanged apart from backlink rewrites.
   - Leave **`wave:` unset**. Don't set `scope:`: schedule infers it from `touches:`.
3. **Renames rewrite backlinks.** Before each rename check the target basename is free, then find
   every `[[old-slug]]` in the vault and rewrite it to the new slug (wikilinks don't follow a
   filesystem rename). Search with `/usr/bin/grep -rlF` (the Bash tool's `rg`/`grep` are shell
   functions a script can't call) and exclude `.git`, `.obsidian`, `.smart-env` and `.trash`:
   a plain vault-wide rewrite corrupts Smart Connections' `.smart-env/*.ajson` cache.
4. **Other dispositions.** An unbundled brain dump gets `status: done` and an `## Unbundled into`
   list of its tasks. A merged-away item gets `status: dropped` and `Merged into [[<survivor>]]`; a
   dropped item gets `status: dropped` and a one-line reason. A re-homed item's `projects:` is
   switched. A pulled-in item is renamed into the target's roadmap and its source phase note
   gains a pointer line (`Moved to [[<new-slug>]] (orient reshuffle, <date>)`).
5. **Scoped source disposition.** A vault source note gets a single delimited `## Build sequence`
   section: a numbered, phase-grouped `[[task]]` outline. Replace only that section, idempotently,
   never clobbering the rest. A phase-note source is also brought up to the Phase shape
   (`add-phase.md`): a legacy task-tagged note swaps `task` → `phase` in `tags:`, gains `phase: N`,
   moves to `Work/Phases/` and carries the embedded task base. A plan-file or inline source creates
   the project/outline note at `Work/Projects/<Area>/<Project>.md` (project frontmatter, Bases
   block, the `## Build sequence` outline).
6. **Two-block surfacing** — ensure the project note carries the two always-visible base blocks
   (open-tasks list + stacked Phases table; shape from `_System/Templates/Project.md`, copy from a
   sibling like `[[GifLab]]`), **only if absent**.
7. **Misfits and unresolved items stay loose**, untouched apart from backlink rewrites.

**Report**: phases as clickable `obsidian://` links, renames, the other dispositions, surfacing
status, misfits, and what the grill left unresolved. Orient § 6 routes from here.

## Don'ts

- **Don't touch in-flight work** beyond adding new members to its phase.
- **Don't invent phases silently** or force-phase a misfit.
- **Don't renumber.** Existing phases and ordinals are immutable; new phases number from
  `N_max + 1`, joins take the next free `M`.
- **Don't over-split.** Coherent PR-sized units, not steps; two tasks editing the same file as one
  change are one task.
- **Don't guess `touches:`.** Only paths the source names.
- **Don't write before the R4 gate**, and don't rename without the basename check and the
  backlink rewrite.
- **Don't stamp `wave:`, `rollout:` or `scope:`**: those belong to schedule.
- **Don't copy the grill skills' instructions inline**: invoke `grill-with-docs` / `grill-me` by
  name; the inline shape is only the no-skills fallback.
- **Don't write outside the vault**, except `CONTEXT.md` / `docs/adr/` in the resolved project
  repo via the grill-with-docs surface during R3.
- **Don't duplicate the writer-spec schema**: note shape lives in `add-writers/add-task.md` (tasks)
  and `add-writers/add-phase.md` (phases).
