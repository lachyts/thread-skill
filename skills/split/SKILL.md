---
name: split
description: Use when turning a plan or design into a set of numbered, phased Obsidian task notes — decomposing "a plan" into PR-sized tasks that /wave:schedule then groups into waves. Triggers on "split this plan into tasks", "decompose this", "turn this design into tasks", "break this into numbered/phased tasks", or pointing at a design/project note or an approved plan and asking for tasks. Input: a vault design/project note, a plan-mode plan file, or inline prose. Writes <slug>-pN-M task notes + slims the source into a linked outline. First stage of /wave:split → /wave:schedule → /wave:execute. Scope: Obsidian only.
---

# /wave:split — decompose a plan into numbered, phased tasks

`/wave:split` turns **a plan or design** into a backlog of **PR-sized Obsidian task notes**, numbered
and grouped into phases, each carrying the runnable prompt + context to execute it. It then slims the
source into a linked outline.

This is the **front stage** of the pipeline. `/wave:schedule` (the planner) reads the tasks it writes
and clusters them into parallel-safe waves; `/wave:execute` runs them. So `split` emits
**schedule-ready** tasks — it writes `touches:` and dependency links, and leaves `wave:` for
`/wave:schedule` to stamp.

## Scope

**Obsidian only.** Writes tasks to `~/repos/obsidian/Work/Tasks/` and (optionally) edits a project
note. Not for Linear, GitHub issues, or in-repo Spec Kit `tasks.md` (that's `/speckit.tasks`).

## Invocation forms

```
/wave:split [[gifLook]]                 # a vault design/project note (wikilink)
/wave:split Work/Projects/Animately/gifLook   # vault path
/wave:split ~/.claude/plans/<plan>.md   # an approved plan-mode plan file
/wave:split "<prose describing the work>"     # inline
/wave:split [[gifLook]] --regenerate    # re-decompose; otherwise skip a slug whose tasks exist
```

## Skill flow

### 1. Resolve input → project slug

Resolve the argument by shape:

- **`[[wikilink]]` or a vault path** → read that note. It is both the source to decompose *and* the
  project note to slim (step 6). The **project slug** is the note's title.
- **A file path** (e.g. `~/.claude/plans/*.md`) or **inline prose** → read it as the plan. There is
  no vault node yet — derive a slug from the plan's title/topic and confirm it with the user; step 6
  will **create** the project/outline note.

Read the whole source. If it names a target repo / project, note it (drives `cwd` + `projects:`).

### 2. Decompose into PR-sized deliverables

A task = **one independently-shippable, separately-verifiable unit** (≈ one PR / one coherent
change). Bias to a coherent deliverable, not a step — do **not** manufacture the artificially-split
same-file clusters `/wave:schedule` step 4.5 has to re-merge. Heuristics:

- A distinct artifact (a new module/skill/command, a spec change, a doc) → one task.
- "And then" / "depends on the above" → a phase boundary or a dependency, not necessarily a new task.
- A change that spans many files but is *one* coherent edit → still one task.

For each task capture: a one-line **scope**, the **repo/cwd**, the **process** (Spec Kit vs greenfield
/ freeform), and the **runnable prompt** to execute it (the `/speckit.specify …` text, or the
natural-language build prompt — lifted/adapted from the plan).

### 3. Detect `touches:`, dependencies, phases

- **`touches:`** — file paths the plan names for each task (inline code, fenced blocks, bare repo
  paths). This is the one place a task's file-set is authored up front; `/wave:schedule` consumes it
  as authoritative (no regex fallback). When a task's files aren't inferable, **omit** `touches:` and
  let `/wave:schedule` resolve it later — do not guess.
- **Dependencies** — "needs X", "after X lands", "depends on", or a later task building on an earlier
  artifact → record as `[[task]]` links in the dependent's body.
- **Phases** — if the plan **states phases** (e.g. "Phase 0–3"), honour them. Otherwise **infer**
  phases as dependency layers (topological): tasks that depend on nothing = phase 0; tasks that depend
  only on phase-0 tasks = phase 1; and so on.

### 4. Propose — approve before writing (the gate)

Print the proposed breakdown as a table and get a y/n (or adjustments) **before writing any files**:

```
# | phase | task title | scope (1 line) | deps | touches | repo/cwd | process
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

- Leave **`wave:` unset** — `/wave:schedule` stamps it.
- Don't set `scope:` — `/wave:schedule` infers it from `touches:` (single source of that logic).
- Skip a `<slug>-*` task that already exists unless `--regenerate`.

### 6. Slim the source into a linked outline

- **Source is a vault note** → replace (or insert) a single delimited **`## Build sequence`** section
  with a numbered, phase-grouped `[[task]]`-linked outline. **Idempotent** — replace only that
  section; never clobber the rest of the note. Ensure the project note carries the standard Bases
  task-query block (copy from a sibling project note) so the tasks auto-surface.
- **Source was a plan-file / inline** → create the project/outline note at
  `~/repos/obsidian/Work/Projects/<Area>/<Project>.md` (project frontmatter + Bases block + the
  `## Build sequence` outline).

### 7. Report

List the tasks written, show the outline, and name the next step: **`/wave:schedule <slug>`**.

## Don'ts

- **Don't over-split.** Coherent PR-sized units, not steps. If you'd be creating two tasks that edit
  the same file as one change, make it one task.
- **Don't guess `touches:`.** Author it only from paths the plan actually names; otherwise omit.
- **Don't stamp `wave:` or `scope:`** — those belong to `/wave:schedule`.
- **Don't write before the gate.** Step 4's approval precedes any file write.
- **Don't clobber the source note** — the `## Build sequence` edit is section-scoped and idempotent.
