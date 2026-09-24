# Process scan — the category-7 contract

The one statement of category 7, the process-observation scan. `thread:close` runs it in full as its category 7; `thread:stash` and `thread:defer` run it in silent mode on every exit (ADR 0012, 0014, 0015). The writers cite this file; none restates it.

## The bar

A **process observation** is a genuine stage-shift, pivot, reusable move, revealing failure, or cross-workstream effect in *how the project is being made*. Stage-gated, never per-iteration: another numbered pass existing is not an observation; discovering that one variable had to lock before the others could move is. Most sessions have none — NOOP is the expected outcome.

## Routing

Route with the `method` skill's routing test — `~/.agents/skills/method/SKILL.md` § Which ledger a row goes to; unsure → project; when no project directory resolves, unsure → the seat if a workspace resolves, else the estate (ADR 0015). That section is the single definition of the test, including sub-seats, areas with no paired workspace, and contexts with no project or no workspace: cite it, never restate its rungs here. A project ledger is a destination only when § Project directory resolution below yields a directory; otherwise the routing test skips its project step.

## Project directory resolution

Category 7's **project** ledger needs a project *directory* on disk, and a code repo is not one: `~/repos/animately/giflab` is the code, `~/Projects/Animately/giflab/` is the project. Resolve the directory in order, stopping at the first hit:

1. **CWD inside `~/Projects/<Area>/<Project>/`** → that directory.
2. **CWD inside a code repo** → the vault project note paired with it: grep `repos:` frontmatter across `~/repos/obsidian/Work/Projects/**` for an entry matching this CWD's repo (expand `~` to `$HOME` before comparing). If that note names a project directory under `~/Projects/` — its `Local:` line, or the paired path the `repos:` entry resolves to — that directory is the answer. **More than one match** (a sibling project sharing the repo, or a monorepo with sub-project notes) → narrow silently and never ask: keep the match the active THREAD.md's project names, else the one the conversation is scoped to, and carry the narrowed note on through this rung and rung 3. If more than one still matches, there is no project directory (rung 3 does not run on an ambiguous pairing), and the routing test skips its project step.
3. **The paired note names no `~/Projects/` path at all** → take the note's area (its `area:` frontmatter, else the `Work/Projects/<Area>/` folder it sits in) plus the code repo's basename, and use `~/Projects/<Area>/<basename>/` **only if that directory already exists**. GifLab is the case: its note's `repos:` and `Local:` both name the code repo `~/repos/animately/giflab`, area `Animately`, basename `giflab` — and `~/Projects/Animately/giflab/` exists, so that is the answer. Never create the directory, and never guess past this rung.

Nothing else resolves. Never invent a path from the note's title, and never create a project directory just to hold a ledger. **A tool repo — any repo outside `~/Projects/` — is never a project surface, even when it has its own `THREAD.md`**: a THREAD.md is thread state, not a project ledger, and a tool repo's process rows go to the estate. If no rung hits, there is no project directory — say so and let the routing test skip its project step.

## Windows

On Windows (no `~/.agents` tree — the method contract and template are not shipped there) the category-7 scan NOOPs at every altitude; never hand-roll a row or a ledger.

## Row form

Append to the `METHOD.md` `## Candidates` the routing test resolves — project (`<project directory>/METHOD.md`), seat (`~/repos/workspaces/<workspace>/knowledge/METHOD.md`, or a declared sub-seat's such as `~/repos/workspaces/animately-workspace/seo/knowledge/METHOD.md`) or estate (`~/repos/workspaces/_shared/knowledge/METHOD.md`) — as one row:

```
- YYYY-MM-DD [provisional] K<nn> — <observation> — source: <harness/thread>, evidence: <path § heading>
```

`K` + one more than the highest existing `K` ordinal in that ledger, `K01` when none, independent of other prefixes; link-checked. Per the `method` skill's capture contract: create the file from `~/.agents/skills/method/METHOD-template.md` if absent, following its creation rules — fill the frontmatter for that altitude, keep placeholders commented out.

Capture does not curate `## Method`; an authorised method pass follows the method skill's working agreement for routine curation and user decisions on exceptions (the 2026-09-15 agreement supersedes the earlier blanket apply gate).

## One commit rule

**One rule at every altitude:** commit the append immediately in its containing repo — a project ledger in the `~/Projects` monorepo, a seat or estate ledger in `~/repos/workspaces` — by pathspec, with the add-then-pathspec form in `close` § Commit hygiene (the one place the form, the index pre-scan and the failure branch live), so it is versioned immediately rather than waiting on the daily sweep (ADR 0012, 0015).

## Silent mode (stash, defer)

`stash` and `defer` run this scan silently (ADR 0014): NOOP is the expected outcome and produces **no output** — no "no process observations" line. A hit appends and commits exactly as above, then adds exactly one line to the stash/defer confirmation (the ledger path and the observation). On Windows the NOOP is silent too. `close` is never silent: its step-8 report lists any append.
