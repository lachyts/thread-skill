---
name: split
description: 'Use when turning a plan or design into a set of numbered, phased Obsidian task notes — decomposing "a plan" into PR-sized tasks that /thread:schedule then groups into waves. Triggers on "split this plan into tasks", "decompose this", "turn this design into tasks", "break this into numbered/phased tasks", or pointing at a design/project/phase note or an approved plan and asking for tasks. Input: a vault design/project note, a phase note (tasks inherit its phase number and parent project — never a nested counter), a plan-mode plan file, or inline prose. Writes <project>-pN-M task notes + slims the source into a linked outline. First stage of /thread:split → /thread:schedule → /thread:execute. Scope: Obsidian only.'
---

# /thread:split — decompose a plan into numbered, phased tasks

`/thread:split` turns **a plan or design** into a backlog of **PR-sized Obsidian task notes**, numbered
and grouped into phases, each carrying the runnable prompt + context to execute it. It then slims the
source into a linked outline.

This is the **front stage** of the pipeline. `/thread:schedule` (the planner) reads the tasks it writes
and clusters them into parallel-safe waves; `/thread:execute` runs them. So `split` emits
**schedule-ready** tasks — it writes `touches:` and dependency links, and leaves `wave:` for
`/thread:schedule` to stamp.

## Scope

**Obsidian only.** Writes tasks to `~/repos/obsidian/Work/Tasks/` and (optionally) edits a project
note. Not for Linear, GitHub issues, or in-repo Spec Kit `tasks.md` (that's `/speckit.tasks`).

## Invocation forms

```
/thread:split [[gifLook]]                 # a vault design/project note (wikilink)
/thread:split Work/Projects/Animately/gifLook   # vault path
/thread:split ~/.claude/plans/<plan>.md   # an approved plan-mode plan file
/thread:split "<prose describing the work>"     # inline
/thread:split [[gifLook]] --regenerate    # re-decompose; otherwise skip a slug whose tasks exist
```

## Skill flow

### 1. Resolve input → project slug

Resolve the argument by shape:

- **`[[wikilink]]` or a vault path** → read that note. It is both the source to decompose *and* the
  note to slim (step 6). The **project slug** is the note's title — **unless it's a phase note**:
  - **Phase-note source** — the note is `tags: [phase]`, or (legacy) a task-tagged note whose
    filename matches `<project>-p<N>-…` or whose body reads "Phase N of [[Project]]". Then the
    **project slug is the parent project** from the note's `projects:` frontmatter (never the phase
    note's own title), and **phase = N is inherited** by every task. Both are confirmed at the
    step-4 gate. Note shape source of truth:
    `~/repos/workspaces/_shared/knowledge/add-writers/add-phase.md`.
- **A file path** (e.g. `~/.claude/plans/*.md`) or **inline prose** → read it as the plan. There is
  no vault node yet — derive a slug from the plan's title/topic and confirm it with the user; step 6
  will **create** the project/outline note.

Read the whole source. If it names a target repo / project, note it (drives `cwd` + `projects:`).

### 2. Decompose into PR-sized deliverables

A task = **one independently-shippable, separately-verifiable unit** (≈ one PR / one coherent
change). Bias to a coherent deliverable, not a step — do **not** manufacture the artificially-split
same-file clusters `/thread:schedule` step 4.5 has to re-merge. Heuristics:

- A distinct artifact (a new module/skill/command, a spec change, a doc) → one task.
- "And then" / "depends on the above" → a phase boundary or a dependency, not necessarily a new task.
- A change that spans many files but is *one* coherent edit → still one task.

For each task capture: a one-line **scope**, the **repo/cwd**, the **process** (Spec Kit vs greenfield
/ freeform), and the **runnable prompt** to execute it (the `/speckit.specify …` text, or the
natural-language build prompt — lifted/adapted from the plan).

### 3. Detect `touches:`, dependencies, phases

- **`touches:`** — file paths the plan names for each task (inline code, fenced blocks, bare repo
  paths). This is the one place a task's file-set is authored up front; `/thread:schedule` consumes it
  as authoritative (no regex fallback). When a task's files aren't inferable, **omit** `touches:` and
  let `/thread:schedule` resolve it later — do not guess.
- **Dependencies** — "needs X", "after X lands", "depends on", or a later task building on an earlier
  artifact → record as `[[task]]` links in the dependent's body.
- **Phases** — **never nest phases.** A phase-note source (step 1) is a *single* phase: every task
  inherits its `phase: N`, and intra-phase ordering is expressed as dependency links only —
  `/thread:schedule` re-derives layers from deps, so sub-phase numbering adds zero machine value.
  For a multi-phase plan: if it **states phases** (e.g. "Phase 0–3"), honour them; otherwise
  **infer** phases as dependency layers (topological): tasks that depend on nothing = phase 0; tasks
  that depend only on phase-0 tasks = phase 1; and so on. Inferred layers ARE the project's roadmap
  phases — author one **phase note per phase** (per `add-phase.md`, at
  `Work/Phases/<project>-p<N>-<desc>`) so the structure is uniform from day one.

### 4. Propose — approve before writing (the gate)

Print the proposed breakdown as a table and get a y/n (or adjustments) **before writing any files**:

```
# | proposed filename | phase | task title | scope (1 line) | deps | touches | repo/cwd | process
```

Below the table, print a **source-disposition footer** so the protocol is visible at the gate, e.g.:

```
source: focus-app-p3-capture-tasknotes → phase note (legacy task-tagged: retag [phase] + move to Work/Phases/)
```

The user may merge, split, rename, re-phase, or drop rows. Re-render until approved. This is where
granularity is corrected cheaply — files don't exist yet.

### 5. Write the task notes

For each approved task, write `~/repos/obsidian/Work/Tasks/<slug>-pN-M-<kebab-desc>.md` (`p<phase>`,
`M` = sequence within phase) from the vault Task template
(`~/repos/obsidian/_System/Templates/Task.md`):

```markdown
---
tags: [task, <area>, <repo>]
status: open
priority: normal
work_depth: <shallow|standard|deep>
projects: ["[[<Project>]]", "[[<Area>]]"]   # + "[[<RepoProject>]]" when repo-specific
phase: <N>
touches: ["<path>", ...]    # omit when not inferable
captured: <today>
---

## Notes
**Phase N · Task M** of [[<Project>]]. <Spec Kit | greenfield>. cwd `<repo>`. Depends on [[...]].

<goal, 1–2 lines>

​```
<the runnable prompt to paste>
​```

**Verify:** <how to know it's done>.
```

- Leave **`wave:` unset** — `/thread:schedule` stamps it.
- Don't set `scope:` — `/thread:schedule` infers it from `touches:` (single source of that logic).
- Skip a `<slug>-*` task that already exists unless `--regenerate`.

### 6. Slim the source into a linked outline

- **Source is a vault note** → replace (or insert) a single delimited **`## Build sequence`** section
  with a numbered, phase-grouped `[[task]]`-linked outline. **Idempotent** — replace only that
  section; never clobber the rest of the note. Ensure the project note carries the standard Bases
  task-query block (copy from a sibling project note) so the tasks auto-surface.
- **Source is a phase note** → same Build-sequence slim (design content stays), plus bring it up to
  the Phase shape (`add-phase.md`): if legacy task-tagged, swap `task` → `phase` in `tags:` (keep
  area tags), add `phase: N`, move the file to `~/repos/obsidian/Work/Phases/`, and ensure it
  carries the embedded task base (`file.hasTag("task") && file.name.startsWith("<project>-p<N>-")`).
  Wikilinks are unpathed, so the move breaks nothing.
- **Source was a plan-file / inline** → create the project/outline note at
  `~/repos/obsidian/Work/Projects/<Area>/<Project>.md` (project frontmatter + Bases block + the
  `## Build sequence` outline).

### 7. Report

List the tasks written, show the outline, and name the next step: **`/thread:schedule <slug>`**.

## Don'ts

- **Don't over-split.** Coherent PR-sized units, not steps. If you'd be creating two tasks that edit
  the same file as one change, make it one task.
- **Don't guess `touches:`.** Author it only from paths the plan actually names; otherwise omit.
- **Don't stamp `wave:` or `scope:`** — those belong to `/thread:schedule`.
- **Don't write before the gate.** Step 4's approval precedes any file write.
- **Don't clobber the source note** — the `## Build sequence` edit is section-scoped and idempotent.
- **Don't leave a split source task-tagged** — a phase is a plan, never a task (`tags: [phase]`,
  `Work/Phases/`); a task-tagged phase note is dispatchable by mistake. See ADR 0005.
- **Don't restart a phase counter inside a phase** — tasks inherit the roadmap number
  (`<project>-p<N>-<M>-…`), never `…-p1-1` under a `p2` source. Note shape lives in
  `add-writers/add-phase.md` — don't duplicate the schema here.
