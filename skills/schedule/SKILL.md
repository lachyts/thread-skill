---
name: schedule
description: 'Use when planning a parallel rollout of multiple Obsidian tasks under a single project — produces a thin rollout note (data only) that the `/thread:execute` skill reads and runs on the Workflow engine. Reads tasks from ~/repos/obsidian/Work/Tasks/, computes wave structure from file-overlap + dependency analysis, auto-merges affine same-file task clusters (same change, artificially split) into a single sequential dispatch unit, writes an always-dated <project-slug>-rollout-<YYYY-MM-DD>.md with `protocol_version: 3` frontmatter + rollout-level config defaults (verifier, max_iterations, max_review_rounds, max_plan_rounds, plan_approval, parallel_ceiling, model), and stamps wave: N on each task. Scope: Obsidian only.'
---

# /thread:schedule — turn a backlog of Obsidian tasks into a rollout note

A **wave plan** groups a backlog of related Obsidian tasks into parallel-safe waves, so a single Claude Code session can fan them out across worktree-isolated subagents.

This skill is the **planner**. The rollout note it produces is a data artefact — the dispatch + convergence contract lives in the sibling **`/thread:execute`** skill (`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`).

## Scope

**Obsidian only.** Reads from and writes to `~/repos/obsidian/Work/Tasks/`. Not for Linear, GitHub issues, or any other backlog source.

## Invocation forms

```
/thread:schedule GifLab                       # default: all open tasks linked to [[GifLab]]
/thread:schedule [[GifLab]]                   # explicit wikilink form
/thread:schedule GifLab --regenerate          # re-plan even tasks that already have wave: set
/thread:schedule --tasks task-a,task-b,task-c # explicit set instead of project filter
```

The argument resolves to a project-note slug (the thing the task's `projects:` frontmatter list contains). Strip `[[...]]` wrappers and case-fold for comparison.

## Skill flow

### 0. Execution-fit gate

Run the execution-fit test (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` — the
canonical definition). Wave rollouts are for **wave-shaped** work: tasks that converge on ONE
code repo, land as a PR each, and verify machine-checkably inside the run (tests / build /
greps). Before computing anything, scan the candidate set for misfits — tasks whose core action
is an external publish (CMS / live site / DNS / config console), whose ordering constraint is a
measurement window or calendar date rather than file overlap, or whose verification only
arrives days later (impact measures). If misfits dominate, **stop and route the set to the
session lane** (`defer` for `scheduled:`-date dispatch, `open` via the task's `## Launch`
block) instead of forcing a rollout: the engine's parallelism is forbidden by isolation
windows, every externally-publishing task pauses at the human gate (ADR 0008 §3.7), and
file-overlap wave computation cannot see window/calendar constraints. A mixed set is fine if
the wave-shaped subset can roll out while the misfits stay unstamped — name them in the gate.

There is no minimum size: shape decides, not count. A wave-shaped cluster of one still rolls
out — the plan gate, verifier retry, master review, and auto-merge are the point. For N ≤ 2,
note that the ceremony is thin and proceed.

### 1. Discover tasks

Walk `~/repos/obsidian/Work/Tasks/*.md`. Filter:

- `status: open` (default — `--include-done` to override)
- `projects:` contains the target wikilink
- `tags:` **contains** `task` — phase notes (`tags: [phase]`, see ADR 0005) and any other non-task
  note linked to the project are never dispatched
- `tags:` does **not** contain `rollout` (rollouts aren't tasks)
- Skip tasks that already have `wave:` set unless `--regenerate` is passed
- Skip tasks with `status: merged` — step 4.5 folded these into a combined note; their `merged_into:` target carries the work and gets dispatched in their place

Report the count and let the user confirm before proceeding.

### 2. Extract file scope per task — hybrid resolution

For each task:

1. **If the task's frontmatter has `touches: [...]`** — use that as authoritative. No further detection needed.
2. **Otherwise — regex the body** for file paths:
   - Inline code: `` `src/foo/bar.py` ``
   - Fenced code blocks: paths inside ```python … ``` blocks
   - Bare paths in prose: `src/...`, repo-root-relative paths
   - Common patterns: `src/giflab/<module>.py`, `tests/<layer>/<name>.py`
3. **Print what was detected per task**, then ask the user to confirm — y/n approves the whole batch, or per-task review for tricky cases.

The per-task file-set now drives wave **serialisation** (step 5 keeps same-file tasks out of the same wave), so under-detection is the dangerous direction — a missed shared file lets two tasks edit it in parallel. When regex detection is uncertain, prefer to over-list candidate files and let the user trim at the confirm step.

If a task touches zero files after both passes, classify it as `scope: read-only` (see step 4).

### 2.5. Detect the project's verifier

Resolve the rollout-level default verifier — the shell command(s) `/thread:execute` will run inside each subagent's worktree to decide pass/fail. Detection order:

1. Project's `CLAUDE.md` — look for a line like `Verifier: \`<cmd>\`` or a "Verification" / "Testing" section that names a single canonical command
2. Project's `Makefile` at repo root — presence of a `test` target → `make test`
3. `pyproject.toml` with `[tool.poetry]` → `poetry run pytest`
4. `package.json` with a `test` script → `npm test`
5. Fall back to no detection → surface to user, ask them to provide one (or proceed without; `/thread:execute` will refuse to dispatch without a verifier)

Print the detected command and ask the user to confirm or override before continuing. Store it for step 6.

### 2.6. Capture known baseline failures

Some repos carry tests that already fail on a clean `main` for environmental / pre-existing reasons (an ImageMagick 0-byte quirk, a perf ratio over a hardcoded ceiling, a Windows-only tool gap). Without a manifest, **every** dispatched agent independently re-diagnoses the same reds and burns tool-calls proving they're out of scope (14× in the first giflab run). Capture them once here so `/thread:execute` can thread them into every agent and treat "only these fail" as green.

- **Declare by default** — ask the user for the known baseline failures as `<test_id> — <one-line reason>` lines.
- **Opt-in detection** — offer to run the verifier once on a clean `main` (clean checkout, run `{{VERIFIER}}`, collect the failing test ids) and present the set for the user to confirm + annotate with reasons.
- If clean `main` is fully green, record `none`.

**Honesty constraint** (per the project's `CLAUDE.md`): the manifest is a **comparison reference, not a mute button** — `/thread:execute` keeps running the full verifier and only ignores these exact reds; it never `--deselect`s them (that would hide a real regression in them). The manifest is a point-in-time snapshot with no liveness guarantee — re-capture on `--regenerate`.

Store the confirmed lines for step 6's `{{KNOWN_BASELINE_FAILURES}}` block.

### 2.7. Detect the env-bootstrap command (optional)

If the verifier needs a one-time environment setup before it runs in a **fresh** worktree — the recurring "wrong Python / no editable install" friction where each agent independently rediscovers `poetry env use 3.11 && poetry install` — capture it once as the rollout's `env_bootstrap`. `/thread:execute` then runs it once per worktree right after the agent enters it, so no agent has to rediscover it. Detection:

1. Project's `CLAUDE.md` — a line like `Env bootstrap: \`<cmd>\`` or a documented "set up the worktree env" command.
2. Otherwise ask the user (the common shapes are `poetry env use <ver> && poetry install`, `npm ci`, `uv sync`), or leave it unset.

Leave it unset when the verifier works in a bare checkout — the worktree setup then renders byte-identically to before. Store the command for step 6 (it becomes the rollout frontmatter's `env_bootstrap:` line).

### 3. Extract dependencies

Look for:

- `blocked-by:` or `depends-on:` in frontmatter (list of task slugs or wikilinks)
- `[[other-task]]` wikilinks in the body that match tasks in the discovered set — treat as soft dependencies (signal, not hard order)
- Body phrases like "gated on", "after X lands", "depends on" — surface to the user for confirmation

### 3.5. Detect human/release gates

Some task notes carry a **human/release gate** in prose — "don't action until a release ships", "hold for sign-off", "gated on the next deploy". A `/thread:execute` agent reads the note and may refuse mid-dispatch when it hits one, so a buried gate is unreliable either way. Scan each task body for gate language (`don't action until`, `do not action until`, `hold for`, `until a release`, `until the next release`, `gated on a release`, `human sign-off`, `wait for sign-off`). Collect any matches — they become the **pre-flight decision** surfaced in step 8: the user either clears each gate (set `ignore_gate: true` on the task to override it for the run, or remove the gate text) or drops the task from this rollout. Don't bury the gate in the body and hope the agent honours it.

### 3.6. Sweep for gated-input smell (advisory — ADR 0008)

Distinct from 3.5's release/hold gates: **gated inputs** are human *authorisations* — API spend, credentials, irreversible actions. Scan each task body for spend smell (`credits`, `paid API`, `$`, `budget`, `billable`, `API cost`), credential smell (`API key`, `token`, `secret`, `credential`, `prod access`), and irreversibility smell (`irreversible`, `cannot be undone`, `delete production`, `wipe`). Tasks that match get **`plan_approval: required`** stamped in step 7 (user-confirmed in the same batch as the model step-ups), so they always produce a plan whose required `### Gated inputs` declaration the engine can pause on.

**Advisory only — the plan's declaration is authoritative** (ADR 0008): only the implementer's plan reliably knows the task needs $30 of Replicate credits, so the engine pauses on the *declaration*, never on this sweep. The stamp merely guarantees the gate surfaces predictively at the plan-gate rather than reactively mid-implementation (a missed smell still stops — every code-writing agent carries the same stop rule). List the stamped tasks in step 8's summary as **expected to gate**, so the pause reads as designed when it happens.

### 4. Classify scope per task

Look for a `scope:` frontmatter field. Valid values:

- `single-file` — touches 1 file, no cross-cutting effects
- `cross-cutting` — touches >1 file OR modifies aggregation/composite logic that other tasks may have changed
- `read-only` — investigation / audit / no source edits

If `scope:` is absent, infer:

- 1 file detected → `single-file`
- >5 files detected → `cross-cutting`
- 0 files detected + the body mentions "investigate" / "characterise" / "audit" → `read-only`
- Otherwise leave it `single-file` but flag for user review

### 4.5. Detect and merge affine same-file clusters

Step 5 treats same-file tasks as a hazard to *serialise* — but serialising isn't always the right move. When several small tasks all edit one hot file and are really **the same change, artificially split** (the recurring shape of audit-fix backlogs), spreading them across N serial waves wastes the whole rollout. Parallelising can't help — by the invariant they can't share a wave — so consolidating the redundant ones is the only lever left. This step finds those clusters and folds each into **one task** before the wave graph is built.

Do this **automatically** — don't ask the user which clusters to merge. The judgement lives in the task bodies; your job is to read them carefully and apply the heuristic + guards below the same way every run. (You still confirm the *result* before authoring — see the end of this step.)

**A cluster qualifies only if BOTH hold:**

1. **Shared file** — the members' resolved file-sets (from step 2) overlap on ≥1 file.
2. **Affinity** — they are the *same kind of change*, not merely the same file. Require **≥1 strong** signal, or **≥2 weak**:
   - *Strong* — a body literally invites the fold: "consider folding X into the same Y", "same DRY-up", "shared `_helper()`", "treat as in-scope for the same PR". (Conditional phrasing — "if Wave N is still in flight, fold it in" — still counts: once both are in one unit, the condition is moot.)
   - *Strong* — same source audit doc **and** same fix-shape verb (all "replace sentinel → NaN + NaN-aware aggregation"; all "add classifier + lossy ceiling").
   - *Weak* — mutual `[[cross-reference]]` wikilinks between the members.
   - *Weak* — shared `parent:` frontmatter, or near-identical acceptance-criteria structure.

**Never merge — even when same-file — if any of these fire (hard blocks):**

These are the guardrails on "trust Claude's read." A human who split tasks deliberately is handing you information — don't overrule it.

- **Explicit independence** — a body calls another member "independent changes to different callsites", lists it under "Out of scope", or otherwise scopes it out. The split was on purpose.
- **Dependency** — one blocks or gates the other → keep them ordered across waves, don't fuse.
- **Mismatched review depth** — don't fold a `read-only` audit into a `cross-cutting` fix; they want different scrutiny.
- **Too big to review well** — if the merged file-set exceeds ~6 files, or you'd be fusing two `deep` (`work_depth`) tasks, the cost of reviewing one giant PR defeats the time saved. Keep them separate.

Same-file tasks that share a file but *fail* the affinity test — three *different* fixes to one module — are the normal case. Leave them for step 5 to serialise. **Merging is the exception, not the default.**

**Safety constraint — a merged cluster is ONE dispatch unit.** One agent, one branch, one PR, sub-tasks done *in sequence* in a single worktree. "Merge into one wave" must never mean "two same-file agents in parallel" — that is exactly the #30/#31 squash-drop incident the same-file invariant exists to prevent (a stale-base squash silently dropped another PR's same-file changes; see the project's `CLAUDE.md` on stale-branch squash reverts). Representing the cluster as a single task (below) makes parallel same-file dispatch *structurally impossible* — which is why we consolidate at plan time instead of teaching the executor about clusters.

**How to represent it — author one combined note, tombstone the members.**

For each confirmed cluster, author a new task note at `~/repos/obsidian/Work/Tasks/<descriptive-cluster-slug>.md`, named after the *change* (e.g. `giflab-metrics-nan-sentinel-hardening.md` — pick a basename nothing else uses). Give it normal Task frontmatter:

- `tags: [task, <area>]`, `status: open`, `priority`, `projects:` (copied from the members)
- `scope: cross-cutting` — a merge always crosses the members' concerns, so step 5 places it alone and the plan-gate + rigorous review apply
- `touches:` = the **union** of the members' confirmed file-sets — the one sanctioned place the planner writes `touches:` (see Don'ts): it's a union of sets the user already confirmed in step 2, not a fresh guess. This union may be wider than any single member's footprint, so it can conflict with more tasks in step 5 than any member did — step 5 colours from the union.

In the body, aggregate every member's acceptance criteria under one `## Acceptance criteria` (the implementer must satisfy all of them, in sequence), and link each original with an unpathed `[[wikilink]]` under a `## Folded-in tasks` heading so the per-task detail stays discoverable.

Then turn each member into a **tombstone** — don't delete it (backlinks to it must keep resolving, and a wrong merge has to stay trivially reversible):

- set `status: merged`
- add `merged_into: "[[<combined-note-slug>]]"`
- clear `wave:` — remove it if a prior plan set it (on `--regenerate`); tombstones are never dispatched, and step 1 skips them on re-plans

`merged` is a configured TaskNotes status (`isCompleted: true`, `autoArchive: true`), so tombstones auto-archive into `Work/Tasks/Archive/` and leave the active list — their backlinks (and the combined note's `## Folded-in tasks` links) still resolve, since wikilinks are unpathed. See `obsidian-schema.md` § Task.

The rollout then references only the combined note, as an ordinary `cross-cutting` task — so `/thread:execute` and its engine need to know nothing about merging.

**Confirm the result before writing.** Show the user each proposed merge (members → combined note, plus the affinity signal that fired) and — just as important — the same-file pairs you deliberately *kept apart* and the guard that fired for each. This is where a misread gets caught. Get a y/n before authoring anything.

### 4.7. Assign model tier per task

Every agent in the convergence engine runs **Opus 4.8 by default** (`model: opus`, the rollout-level default in the template frontmatter). Opus is the tier for **mechanical execution**; whole tasks step **up** to Fable when they're structural or hard. **Err toward Fable** — this rollout puts anything with real thinking in it on Fable, and reserves Opus for the mechanical bulk.

Stamp `model: fable` on a task when **either** holds:

- **`scope: cross-cutting`** — it spans multiple files, so getting the structure coherent is the work, **or**
- **`work_depth: deep`** — flagged deep/design-heavy (algorithm choice, subtle interactions, long-horizon investigation).

Everything else stays Opus: single-file `shallow`/mechanical changes — config edits, renames, contained fixes with crisp acceptance criteria — and single-file read-only checks. A single-file task steps up only if it's genuinely `deep`. Merged units from step 4.5 (always `cross-cutting`) go to Fable.

A Fable task runs **end-to-end on Fable** — its planner, implementer, reviser, **and** both judges (judges follow the task's tier — see `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`). Present the step-ups as a batch ("these N are structural/deep → fable: …") with one line of justification each, and get a y/n (or per-task veto) before stamping in step 7 — veto a rote cross-cutting task (e.g. a mechanical rename across files) down to Opus if it needs no real judgement. Everything not stamped runs Opus.

The step-up is **predictive** — it fires on the task's shape before any run. Its evidence-driven twin lives in the engine: an Opus task gets a one-shot first pass, and the first rejection or red verifier run **escalates** it to Fable mid-run (see execute SKILL.md § Model escalation). So a borderline candidate can safely stay Opus — a wrong call costs one cheap first pass, not a blocked rollout.

**Effort rides the tier — never plan it separately (ADR 0007).** A tier is a (model, per-role effort) **bundle**: Opus runs its planner/implementer at medium, Fable at high; judges run high on either tier, the master review at xhigh on Fable, mechanical reconcile stages at low. The matrix is fixed in the engine (see execute SKILL.md § Effort bundles) — there is deliberately **no rollout-level effort config**, so stepping a task up to Fable is the one move that raises both model and effort. The **single escape hatch** is per-task `effort:` frontmatter (`low` \| `medium` \| `high` \| `xhigh` \| `max`), which overrides the planner/implementer effort for that task only — judges keep the matrix. Reserve it for the rare monster task the user explicitly flags (e.g. a Fable step-up worth `effort: max`), confirm it in the same y/n batch as the step-ups, and stamp it in step 7. Never stamp it by default, and never add an `effort:` key to the rollout note.

### 5. Compute waves

**Core invariant: two tasks that touch the same file never share a wave.** Same-file tasks are serialised across consecutive waves — the later one rebases onto main after the first lands. (This is the fix for the #30/#31 incident, where two same-wave tasks both edited `metrics.py` and a stale-base squash silently dropped the first task's changes.)

Algorithm — **one** file-overlap graph-colouring over *every editing task* (`single-file`, `cross-cutting`, and merged units alike). Scope does **not** decide wave placement — it only drives review depth and the plan-gate downstream (steps 6–7 and `/thread:execute`). Wave eligibility is governed *solely* by file-overlap, so a `cross-cutting` task whose file-set is disjoint from its candidate wave-mates runs in parallel with them, exactly like a `single-file` one. (Two disjoint cross-cutting tasks can still interact *semantically* — both touch composite logic in different files — but that's caught by their rigorous review + plan-gate, not by wave isolation; the wave graph only prevents same-*file* overwrites.)

1. Build a **conflict graph**: an edge between two editing tasks iff their resolved file-sets (from step 2, **unioned** for merged units) share ≥1 file. Read-only tasks make no edits, so they carry no edges.
2. **Colour by file-overlap.** Process tasks in **descending conflict-degree** (ties broken alphabetically by slug, for determinism), placing each in the **earliest wave that contains no task it shares a file with**. Degree-0 tasks (disjoint from everything) fill the earliest waves for maximum parallel safety; a task on a hot file gets pushed later, one wave per same-file rival. Tasks that merely cluster — sharing a *neighbour* but not a *file* — still run in the same wave.
3. A task lands **alone in its wave** only when it conflicts on files with every task that could otherwise join it — *not* because of its scope. A wide cross-cutting task touching two hub files (e.g. `metrics.py` + `enhanced_metrics.py`) is the usual reason: it conflicts with both hubs' editors, so no safe wave-mate remains.
4. **Read-only tasks** have no edges — schedule them in any wave once their dependency (if any) has landed; they're safe alongside any editing wave.

A merged unit from step 4.5 enters the graph as a **single node whose file-set is the union of its members** — placed by the same colouring as everything else. It shares a wave with any file-disjoint task (as a real merged unit often does — e.g. a `metrics.py` hardening merge can run in wave 1 beside three disjoint partners) and is serialised against anything it shares a file with. Because the union can be **wider than any single member's footprint**, recompute its conflicts from the union: a merge can pull in a hub file only one member touched, expanding what the unit conflicts with — and, when you write the rationale (step 6), count the merged unit under *every* hub its union touches. Its tombstoned members are absent from the graph entirely.

Dependencies trump the colouring: if task A depends on task B, A's wave must come after B's.

### 6. Write the rollout note

Location: `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` — **always dated** (slug = the lowercase kebab form of the project wikilink, or a natural scope slug when the batch has one; date = today, the day you write the note — e.g. `[[GifLab]]` on 2026-07-18 → `giflab-rollout-2026-07-18.md`). The date is mandatory: an undated `<slug>-rollout` name collides with the project's next rollout, so it is **never emitted**. Legacy undated notes keep their names — no migration; the readers (`/thread:execute`, `/thread:status`, `/thread:repair`) still resolve both forms. This is the canonical rule in CONTEXT.md § Rollout.

**Dated-note naming — handles more than one rollout per day.** The filename is `<slug>-rollout-<YYYY-MM-DD>.md` for the **first** rollout of a given day, and `<slug>-rollout-<YYYY-MM-DD>-<N>.md` (N≥2) for each **subsequent** rollout that same day. Resolve N deterministically: glob `<slug>-rollout-<YYYY-MM-DD>*.md` — nothing matches → bare date (no `-N`); only the bare-date note exists → `-2`; otherwise → one past the highest existing ordinal. The first-of-day note never carries `-1` (kept bare, backward-compatible with every existing dated rollout). So a day's sequence reads `…-2026-06-09.md`, `…-2026-06-09-2.md`, `…-2026-06-09-3.md`. **Never overwrite or reuse an existing dated note** — always advance to the next free ordinal. The one prompt is when today's note already exists and you're re-running to *replace* one you just wrote in error: offer **Overwrite** (replace the same-day note), **Advance** (write the next free ordinal — the usual choice for a new, distinct effort), or **Cancel**. Substitute the resolved slug into `{{ROLLOUT_SLUG}}` everywhere downstream — the note's own filename, the per-task `rollout:` stamps (step 7), the summary (step 8), and any `supersedes:` / `superseded_by:` links.

**Superseding a prior rollout.** When `--regenerate` replaces an earlier rollout (commonly a dated one whose still-open tasks are being re-planned here), stamp `supersedes: "[[<prior-rollout-slug>]]"` in this note's frontmatter, and close out the prior rollout: set `status: done` (TaskNotes only knows `open` / `in-progress` / `done`, and `done` auto-archives it out of the open list) + `superseded_by: "[[<this-slug>]]"` to record *why* it closed and keep the lineage navigable. Its already-landed tasks stay `done`; its still-open tasks are re-planned into this rollout.

Use the template at `${CLAUDE_PLUGIN_ROOT}/skills/schedule/rollout-template.md`. Substitute:
- `{{PROJECT_NAME}}` — display name (e.g. `GifLab`)
- `{{PROJECT_SLUG}}` — kebab form (e.g. `giflab`)
- `{{ROLLOUT_SLUG}}` — the resolved dated rollout slug, no extension (e.g. `giflab-rollout-2026-07-18`)
- `{{DATE}}` — today's date (YYYY-MM-DD)
- `{{VERIFIER}}` — the verifier command detected in step 2.5 (or user-provided)
- `{{REPO_PATH}}` — the project's local repo path from the project note's `Local:` line, if discoverable; otherwise leave a `<TODO>` marker
- `{{THREAD_PATH}}` — path to the project's THREAD.md if one exists; otherwise omit the line
- `{{WAVE_TABLE}}` — rendered wave structure table (see template). A merged unit (step 4.5) renders as a normal row with **Mode = `sequential-merged (one agent/PR)`**, signalling that one agent does the folded sub-tasks in sequence
- `{{WAVE_RATIONALE}}` — short prose explaining the ordering
- `{{TASKS_BY_WAVE}}` — wikilink list per wave (see template)
- `{{FILE_SETS}}` — a **machine-readable** per-task file-set block (one line per *editing* task: `- <full-slug> (wave N): file, file, …`), rendered from the **confirmed step-2 file-sets** (unioned for merged units, exactly as step 5 colours them). Omit read-only tasks (no edits). `/thread:execute` reads this block for its blocked-task smart-halt: if a task fails to land and its files reappear in a later wave, the rollout halts rather than branching that later wave from a `main` missing the fix. This is **rollout-note data** — a derivation of sets the user already confirmed in step 2, not a fresh guess — so it is distinct from, and does not violate, the task-frontmatter `touches:` Don't (it lives in the rollout note, never stamped onto the individual tasks).
- `{{KNOWN_BASELINE_FAILURES}}` — the `## Known baseline failures` block from step 2.6: one `- <test_id> — <reason>` line per test already red on a clean `main`, or `none`. `/thread:execute` reads this block, threads it into every agent, and shifts the Ralph green criterion to "no NEW failures beyond this set" (never `--deselect`). Like `{{FILE_SETS}}`, this is rollout-note data the executor reads, never task frontmatter.
- `{{POST_ROLLOUT_ITEMS}}` — rollout-specific post-completion items (audit re-runs, downstream unblocks, validation sweeps), one numbered/bulleted line each, or `none`. These slot under the template's fixed completion-ceremony steps; at completion the ceremony (execute SKILL §4.5 step 5) converts each into a new open task + thin pointer, so phrase them as work descriptions, not instructions to leave in place.

The template's frontmatter carries `protocol_version: 3` plus rollout-level convergence defaults (`max_iterations: 3`, `max_review_rounds: 4`, `max_plan_rounds: 3`, `plan_approval: scope-gated`, `parallel_ceiling: 4`, `model: opus`). These are inherited by every task in the rollout; per-task overrides go in the task's own frontmatter. When step 2.7 detected an env-bootstrap command, uncomment the template's `env_bootstrap:` line and set it (`/thread:execute` runs it once per worktree); leave it commented out when none. `plan_approval: scope-gated` means the plan-gate fires only for `scope: cross-cutting` tasks (other values: `off`, `required`) — see `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` for the gate semantics. (`completion_sentinel` is gone as of protocol 3 — the Workflow engine returns validated structured output instead of parsing sentinel strings.)

Render each task reference as `[[<full-slug>|<short-alias>]]` in the wave-structure table for readability. In the per-wave detail section use the full `[[<full-slug>]]` form.

### 7. Update each task's frontmatter

For each task in the rollout:

- Add `wave: <N>` (or update if `--regenerate`)
- Add `rollout: "[[<rollout-slug>]]"` backlink
- Add `scope:` if not already set (single-file / cross-cutting / read-only — see step 4) — `/thread:execute` uses this to route master-review depth
- For `scope: read-only` tasks specifically, also add `max_iterations: 1` (nothing to retry)
- For tasks the user confirmed as Fable step-ups in step 4.7, add `model: fable` — never stamp `model: opus` (that's the rollout-level default every task inherits)
- For a task the user explicitly confirmed an effort override for (§4.7 — rare), add `effort: <low|medium|high|xhigh|max>` — never stamp `effort:` by default, and never add it to the rollout note (it has no rollout-level form; the tier bundle decides everywhere else)
- For tasks the §3.6 sweep flagged (user-confirmed), add `plan_approval: required` — advisory: it guarantees a plan-gate exists where the plan's own `### Gated inputs` declaration (the authoritative signal, ADR 0008) can pause for sign-off
- Preserve all other frontmatter fields verbatim

The combined notes authored in step 4.5 are stamped here like any other task (`wave:`, `rollout:`, `scope: cross-cutting`). Their folded-in members are **not** stamped `wave:` — they already carry `status: merged` + `merged_into:` from step 4.5 and are never dispatched.

Use the same YAML field ordering the file already has; insert the new fields just below the existing `status:` line.

**Do NOT stamp `verifier:` / `max_iterations:` / `max_review_rounds:` / `model:` on individual tasks by default.** Those fields are rollout-level defaults — tasks inherit them automatically. Only set them per-task if the user explicitly asks to override the rollout default for a specific task during the confirm-batch step. The sanctioned exceptions are read-only's `max_iterations: 1`, the user-confirmed `model: fable` from step 4.7, the user-confirmed per-task `effort:` override (§4.7 — unlike the others it has no rollout-level form at all, so per-task frontmatter is the only place it can ever live), and the §3.6 sweep's `plan_approval: required` on gated-input-smelling tasks — all deliberate per-task decisions, not defaults.

### 8. Print summary

```
Wave plan for {{PROJECT_NAME}} written to [[{{ROLLOUT_SLUG}}]] — N tasks across M waves.
Verifier: <detected command>
Default review rounds: 4

Open in Obsidian to review. To execute:
  execute Wave 1 of [[{{ROLLOUT_SLUG}}]]      # one wave
  execute [[{{ROLLOUT_SLUG}}]]                # full rollout (continuous)

The thread:execute skill at ${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md reads this note and runs the three-layer convergence engine (plan-gate → Ralph retry → master review) via the Workflow tool.
```

**Pre-flight — gated tasks.** If step 3.5 found any human/release-gated tasks, list them above the summary so the user clears them before executing (an unaddressed gate makes the agent refuse mid-run):

```
⚠️ Pre-flight — these tasks carry a human/release gate. Clear each before executing, or they'll refuse mid-dispatch:
  - [[task-x]] — "don't action until the v0.5 release ships"
To run one anyway, set `ignore_gate: true` on its task note (overrides the gate for the run); or drop it from the rollout.
```

Likewise list the §3.6 gated-input step-ups so the eventual pause reads as designed (ADR 0008 — these will stop at their plan-gate for your sign-off even in continuous mode; `ignore_gate` does NOT override a gated input):

```
Expected to gate (will pause for your sign-off at their plan-gate):
  - [[task-y]] — smells of API spend ("~$30 of Replicate credits") → plan_approval: required
```

## Execution lives in `/thread:execute`

This skill does not execute anything. The rollout note it produces is read by the sibling **`/thread:execute`** skill (`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`), which resolves per-task config and calls the **Workflow** tool with `wave-execute.workflow.js` — the convergence engine (plan-gate → Ralph retry → master review). The engine is not duplicated into individual rollout notes; improvements to the script reach every rollout immediately.

## Don'ts

- Don't refuse small rollouts — shape decides, not count (`skills/_shared/execution-fit.md`). A one-task wave-shaped rollout is valid; note the ceremony is thin and proceed.
- Don't auto-merge dependency cycles silently — if A depends on B and B depends on A, surface and ask. (This is about *dependency* cycles — distinct from the affinity-cluster consolidation in step 4.5, which is a sanctioned auto-merge of same-*change* tasks.)
- Don't overwrite an existing rollout without prompting.
- Don't touch tasks outside the target project (the `projects:` filter is strict).
- Don't fill in `touches:` on tasks where you regex-detected files — that promotes a guess into authoritative metadata. Only the user does that. The **one** exception is the combined note authored in step 4.5: its `touches:` is the *union of file-sets the user already confirmed* for the members, so it's a derivation, not a fresh guess. (Separately, the `## File-sets` block in the **rollout note** — step 6 — also records confirmed file-sets, but that's rollout-note data the executor reads, never task frontmatter, so it doesn't touch this rule.)
- Don't run `git` operations or open PRs from the planner — the planner only reads/writes vault files.

## Verification

End-to-end test against an existing backlog (e.g. GifLab):

1. `/thread:schedule GifLab` from any Claude Code session
2. Confirms ~9 open tasks, prints detected files per task, asks to confirm
3. Step 2.5 detects `make test` (or whatever GifLab's CLAUDE.md prescribes) — prints it and asks to confirm
4. Computes wave structure
5. Writes the always-dated note `giflab-rollout-<YYYY-MM-DD>.md` (advancing to the next `-N` ordinal if today's already exists).
6. Rollout note carries `protocol_version: 3`, `verifier:`, `max_iterations: 3`, `max_review_rounds: 4`, `max_plan_rounds: 3`, `plan_approval: scope-gated`, `parallel_ceiling: 4`, `model: opus` in frontmatter. No inline execution playbook — the rollout body is data only.
7. Stamps `wave: N`, `rollout: "[[...]]"`, and `scope:` on each task
8. Prints summary pointing the user toward `/thread:execute`

Then from a fresh session: paste `execute Wave 1 of [[giflab-rollout-<YYYY-MM-DD>]]` (the dated note just written) — the `/thread:execute` skill should pick it up, gate on `protocol_version: 3`, resolve per-task config, and call the Workflow tool with `wave-execute.workflow.js` to run the three-layer convergence engine per task (visible live via `/workflows`).

### Merge regression (step 4.5)

The GifLab backlog is a good fixture because it exercises both a merge and a deliberate non-merge in one run. Against the open backlog, `/thread:schedule GifLab --regenerate` should:

- **MERGE → "metrics.py sentinel → NaN hardening":** `giflab-dry-ssimulacra2-fallback-dict` + `giflab-lpips-fallback-nan-sentinel` + `giflab-per-frame-exception-nan-sentinel`. All replace fabricated sentinels with `float("nan")` + NaN-aware aggregation in `metrics.py` error paths, and the LPIPS task literally says *"consider folding LPIPS into the same DRY-up… shared `_nan_fallback_dict(keys)`"* (strong signal). 3 serial waves → 1.
- **MERGE → "content-classifier lossy ceiling":** `giflab-data-viz-animation-lossy-guard` + `giflab-photographic-content-lossy-ceiling`. Both build the same pre-compression classifier + `lossy_max` machinery; only the heuristic differs. 2 waves → 1.
- **KEEP SEPARATE (guard fires):** the `composite_quality` trio `giflab-composite-quality-bare-vs-mean-key-mismatch` + `giflab-composite-quality-nan-guard` + `giflab-temporal-consistency-composite-quality-fix`. They share `enhanced_metrics.py`, but the nan-guard task calls the per-frame task *"independent changes to different callsites"* and scopes the temporal task out — explicit-independence hard block. Stay serialised across waves.
- Members of the two merges end up `status: merged` + `merged_into:`, with **no `wave:`**; a second `--regenerate` skips them (step 1).
- Wave count drops from ~9 to ~6 (the two merges save three waves).
