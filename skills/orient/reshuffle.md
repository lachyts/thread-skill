# Reshuffle — orient's reshape step

Orient § 5 runs this after Lachy picks **Reshuffle** (or at once for a scoped target). It takes the
target's open work, sorts it, grills what is unclear, and writes the result at one gate. It carries
the machinery of the retired `split` and `gather` verbs (ADR 0027): roadmap forming and renames,
decomposition and task writing.

**Write surface.** `~/repos/obsidian/Work/Tasks/`, `~/repos/obsidian/Work/Phases/`, the target
project note and, for pull-ins, the source project's phase and task notes (the moved notes
themselves, pointer lines, and retiring a phase the move emptied). When R3 grills **with
docs**, the interview also writes `CONTEXT.md` + `docs/adr/` in the **resolved project repo**
(never committed here: orient § 6 holds scheduling until they land). Nothing else outside the
vault: out-of-vault backlinks are reported, not rewritten (R5.3). Never git/gh. Never stamps
`wave:`, `rollout:` or `scope:`: orient § 6 hands wave-shaped phases to schedule, which owns them.

## Scoped targets

A single-note target resolves its project like this, and the gate confirms it:

- A note with `projects:` → that project. A phase note (`tags: [phase]`, or a legacy task-tagged
  note named `<project>-p<N>-…` or reading "Phase N of [[Project]]") → its **parent** project,
  and every task inherits phase N, never a nested counter.
- A note with no `projects:` is its own project: its title is the slug and it becomes the project
  note (gains `project` in `tags:` and R5.6's surfacing).
- A plan file or inline prose has no vault node: match it to an existing project where one fits,
  else derive the slug from its title.

## R1. The item set

Classify from orient § 2's frontmatter sweep; don't walk the folders again. The target project(s)
are the notes whose `projects:` contains the wikilink and, for phase notes, filenames
`<slug>-p<N>-…` where `<N>` is digits with an optional `.digits`: anchored on `-p<N>-` like
`reconcile-project.py`, so a sibling project `<slug>-plugin` never matches, though that script
only reads whole-number phases. Skip notes tagged `rollout` and landed statuses (`done`, `merged`,
`dropped`). Give every item its **reach tier** (CONTEXT.md **Reach tiers**):

- **In flight — frozen.** Orient § 2's definition. Shown for context. Its scope, phase and body
  never change. New work may still join its phase.
- **Possibly landed — frozen too.** Anything on the reconcile step's AMBIGUOUS list (orient § 2),
  and anything orient § 4's bound apply reported as `New since review` or `Reviewed, not applied`:
  it may already have merged (the § 2 sweep predates the apply, so it can still read as open), so
  it is listed for Lachy and never moved, restamped, dropped or scheduled.
- **Thread captures — frozen too.** A `thread`-tagged task (stash/defer's capture) belongs to its
  thread and is picked up by `open`; the reshuffle shows it for context and never unbundles,
  drops, renames or re-homes it.
- **Unstarted — movable.** A phased task (`phase:` set) that is not in flight, and phase notes with
  no in-flight member. May be re-phased, merged, unbundled, dropped, or the phase retired.
- **Loose — open.** `tags:` contains `task` but not `thread`, no `phase:`, not in flight. Anything
  goes, including a re-home to another project.

The target project note itself is an item too when its body holds a plan with no
`## Build sequence` yet (a design section never decomposed): it is unclear by definition, R2
decomposes it and R5.5 slims it, as for a scoped design note.

Add the **related projects** orient § 2 found: their unstarted and loose items that overlap the
target are candidates to **pull in**. Their in-flight items stay where they are.

**Scoped target**: the item set is that source alone, plus any tasks already written from it. The
project's roadmap is read only for numbering.

**Numbering**, from one listing of `Work/Phases/` (Archive included) and the task filenames:
`N_max` is the highest phase number; per phase, `M` is the highest ordinal among
`<slug>-p<N>-<M>-*` filenames (archived included) and the struck-through entries R5.2 leaves in a
phase's `## Build sequence` when a task moves out, so an ordinal is never reused. New phases
number from `N_max + 1` (P1 when the project has none); a fractional `N_max` rounds up to the
next whole phase, which is the first new one (`p3.5` → P4). Fractional naming otherwise follows
`add-phase.md` § Step 3. Existing phase numbers are **never** changed.

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
- **Frozen context** — the frozen items, read-only, so the proposal can be read against them.

A task may join an **existing** phase (in-flight ones included) when it clearly belongs there.
This is **a proposal, never a decision**: every row is an input to R3's interview or R4's gate.

**Decomposing a plan** (scoped targets, undecomposed project notes and large unbundles). A task is
**one independently shippable, separately verifiable unit** (about one PR, one coherent change),
not a step. A distinct artifact is one task; "and then" or "depends on the above" is a dependency
or a phase boundary, not necessarily a new task; a change spanning many files as one coherent edit
is still one task, and two tasks editing the same file as one change are one task. For each task
capture a one-line scope, the repo/cwd, the process (Spec Kit or freeform) and the runnable prompt.
Record `touches:` only from file paths the source actually names, never a guess; when files aren't
inferable, omit it and let schedule resolve it. Record dependencies ("needs X", "after X lands") as
`[[task]]` links. Phases: if the source **states phases**, honour them; otherwise infer them as
dependency layers numbered from `N_max + 1` (tasks that depend on nothing form the first new
phase, tasks depending only on those the next, and so on).

## R3. Grill the unclear

A full-depth interview, one question at a time, recommended answer first, resolving:

- **(a) roadmap meaning** — phase names, ordering, membership, moves, drops, unbundles, re-homes
  and pull-ins. The human decides; the reshuffle never invents a phase silently or force-phases a
  misfit.
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

Note shape belongs to the writer specs; reference them, never duplicate the schema, all under
`~/repos/workspaces/_shared/knowledge/add-writers/`: `add-phase.md` (phase notes, including
dedupe and project-note surfacing), `add-project.md` (a new project note), and `add-task.md`
§ Step 4 (frontmatter, `## Notes` body, its *Phased task* bullet) plus, for a task with a launch
signal (a repo, named MCP servers, live branch state), `add-task.md` § Launch context (its
`## Launch` and `## Resume prompt` blocks).

1. **Phase notes** — `Work/Phases/<slug>-p<N>-<kebab-desc>.md`, numbered from `N_max + 1`; an
   existing phase gaining members is edited per `add-phase.md` § Step 2. A retired phase gets
   `status: dropped` and one line naming where its members went.
2. **Tasks**, each as `Work/Tasks/<slug>-p<N>-<M>-<kebab-desc>.md` (`M` = one past R1's highest
   ordinal for the phase) with `phase: N`:
   - **New tasks** (unbundles, decomposed plans) add only what the reshuffle knows on top of the
     spec: `work_depth:` (shallow / standard / deep) from size; `touches:` from R2, omitted when
     not inferable; `## Notes` opening `**Phase N · Task M** of [[<Project>]]`, then the process,
     the cwd, `Depends on [[...]]` links and the 1–2 line goal; the runnable prompt in the
     `## Resume prompt` block when the task qualifies for launch context, else as a fenced block
     under `## Notes`; and a closing `**Verify:**` line.
   - **Phased or moved tasks** are renamed and stamped. The body gets the grilled spec when R3
     respecced it; a clear item's body is unchanged apart from backlink rewrites. A `wave:` or
     `rollout:` stamp left by a retired rollout (R1 found it not in flight) is cleared, or
     schedule would skip the task. A task moving out of a phase leaves its entry in that phase's
     `## Build sequence`, struck through with a pointer (`~~p3-2~~ moved to [[<new-slug>]]`), so
     its ordinal stays used.
   - Leave **`wave:` unset**. Don't set `scope:`: schedule infers it from `touches:`.
3. **Renames rewrite backlinks, in one pass.** First check every target basename is free, in one
   listing. Then write all the old slugs to a file and find the files that mention any of them
   with one `/usr/bin/grep -rlF -f <old-slugs-file>` (the Bash tool's `rg`/`grep` are shell
   functions a script can't call), excluding `.git`, `.obsidian`, `.smart-env` and `.trash`: a
   plain vault-wide rewrite corrupts Smart Connections' `.smart-env/*.ajson` cache. In each hit,
   rewrite every old→new pair in one edit. A link is `[[old-slug` followed by `]]`, `|`, `\|` or
   `#`, so aliased and heading links are caught and `[[old-slug-more]]` is not. Rewrite inside the
   vault only. Links outside it (`~/Projects/**/THREAD.md`, `~/repos/workspaces/_shared/threads/`,
   the project repo's `THREAD.md` and `docs/handoffs/`) are found by the same search and **listed
   in the report** for Lachy, never edited: they are committed files in other repos.
4. **Other dispositions.** An unbundled brain dump gets an `## Unbundled into` list of its tasks;
   it is marked `status: done` only when every idea in it was unbundled. If the grill stopped
   first, it stays open with the unreached ideas in its body, for the next reshuffle. A
   merged-away item gets `status: dropped` and `Merged into [[<survivor>]]`; a dropped item gets
   `status: dropped` and a one-line reason. A re-homed item's `projects:` is switched. A
   pulled-in item is renamed into the target's roadmap, its `projects:` switched to the target,
   and its source phase note gains a pointer line
   (`Moved to [[<new-slug>]] (orient reshuffle, <date>)`); a source phase the move emptied is
   retired (`status: dropped`, naming where its members went).
5. **Scoped source disposition.** A vault source note gets a single delimited `## Build sequence`
   section: a numbered, phase-grouped `[[task]]` outline. Replace only that section, idempotently,
   never clobbering the rest. A phase-note source is also brought up to the Phase shape
   (`add-phase.md`): a legacy task-tagged note swaps `task` → `phase` in `tags:`, gains `phase: N`,
   moves to `Work/Phases/` and carries the embedded task base. A plan-file or inline source matched
   to an existing project writes nothing to the project note beyond item 6 (its phase notes carry
   the outline). Only when no project exists does it create one, per `add-project.md` (its dedupe
   and Step 3), then add the `## Build sequence` outline.
6. **Surfacing** — the project note's base blocks, per `add-phase.md` § Step 4: add whichever
   are missing, never a second copy.
7. **Misfits and unresolved items stay loose**, untouched apart from backlink rewrites.

**Report**: phases as clickable `obsidian://` links, renames, the other dispositions, surfacing
status, misfits, out-of-vault links to fix, and what the grill left unresolved. Orient § 6 routes
from here.

## Don'ts

The rules above are the contract; these are the ones most easily broken.

- **Don't touch frozen items** (in flight, possibly landed, thread captures) beyond adding new
  members to an in-flight phase.
- **Don't renumber.** Existing phases and ordinals are immutable, and an ordinal is never reused.
- **Don't write before the R4 gate**, and don't rename without the basename check and the
  backlink rewrite.
- **Don't copy the grill skills' instructions inline**: invoke `grill-with-docs` / `grill-me` by
  name; the inline shape is only the no-skills fallback.
- **Don't duplicate the writer-spec schema**: note shape lives in `add-writers/add-task.md`,
  `add-writers/add-phase.md` and `add-writers/add-project.md`.
