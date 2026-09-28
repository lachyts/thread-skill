---
name: orient
description: 'Pick a project back up and reshuffle it: audit a project/area after time away, re-sort its open work (bugs, brain dumps, loose tasks, unstarted phases), grill what is unclear, write phases and tasks, schedule the wave-shaped ones and offer to execute. One plan, design note or brain dump becomes phased tasks. Triggers on "orient me on <project>", "where is <project> at overall", "reshuffle <project>", "turn these tasks into a roadmap", "split/break this plan into numbered, phased tasks", "fan out background sessions on <project>", or /thread:orient [target]; --debrief sweeps batches. One thread: thread:next.'
---

# /thread:orient — pick a project up and reshuffle it

The project-altitude sibling of `next` (ADR 0003), and the one shaping verb (ADR 0027). `next`
answers "what's my move?" for the *current thread*; `orient` answers it for a *whole project or
area* returned to after time away. It audits the balls in the air, recommends ONE best use of
Lachy's time, then asks **Reshuffle, Steer only or Look only**. A reshuffle re-sorts all the open work, grills
what is unclear and writes the result at one gate (`reshuffle.md`). Orient then routes by lane:
it schedules wave-shaped phases itself, steers the session-lane work (background batches, a focus
item, or both) and ends with the **execute offer**. Pointed at a single plan, design note or brain
dump, it runs a **scoped reshuffle** of that note alone.

**Contains no route logic of its own** beyond batching, emission and the reshuffle: hands-on focus
dispatches to `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` (or the task's own `## Launch` block);
wave-shaped phases go to `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md`; the execute offer runs
`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` or `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md`.
None is re-implemented here. The execution-fit test
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md`) decides the lane, hard, not as a
preference.

## Runtime boundary

The project audit, reshuffle, steering and task-note debrief are shared. Autonomous batches use
the calling harness's native child tools and current account, never a model CLI or a new
cmux/Orca model session. The shared exchange at
`~/repos/workspaces/_shared/scripts/native_workflow.md` supplies journalled claims, native child
bindings and result validation. Its generic batch engine is `native_workflow_batch.workflow.js`;
it dispatches already prepared prompts and contains no project/domain workflow.

Native children inherit available tools; a target workspace path does not load another MCP
profile. Before dispatch, check every batch's required capability and account against the calling
session. If a required scoped capability is absent, retain the prompt and report that batch
blocked/undispatched. Do not silently switch harness, account or launch a broader profile. Other
independent batches may proceed. Hands-on pickup follows `open`'s contract.

Wave-shaped work still goes through schedule and execute's runtime gate. The native exchange does
not supply the detached Wave hook/heartbeat driver.

## Invocation forms

```
/thread:orient Chorus                     # audit, then Reshuffle / Look only
/thread:orient [[Chorus]]                 # explicit wikilink form
/thread:orient                            # infer the area from CWD
/thread:orient [[<design, phase or brain-dump note>]]   # scoped reshuffle of that note
/thread:orient ~/.claude/plans/<plan>.md  # scoped reshuffle of an approved plan file
/thread:orient "<prose describing the work>"            # scoped reshuffle of inline prose
/thread:orient Chorus --debrief           # sweep previously dispatched batches (§ 10)
```

## Process

### 1. Resolve the target

Accept a fuzzy target and resolve it to (area, vault folder, workspace, project roots):

- **A name** (`/thread:orient Animately`) or **wikilink** (`[[Animately]]`, a
  sub-project note) → match against the folders and notes under
  `~/repos/obsidian/Work/Projects/`, at any depth, and the workspace registry
  (`~/repos/workspaces/_shared/workspace-registry.md`).
- **A single-note target** → a **scoped reshuffle**: a wikilink or vault path to a note that is not
  a project or area note (a design, phase or brain-dump note), a plan file path, or quoted prose.
  The project slug is the note's `projects:` entry; for a phase note (`tags: [phase]`, or a legacy
  task-tagged note named `<project>-p<N>-…` or reading "Phase N of [[Project]]") it is the
  **parent** project, and phase N is inherited. A note with no `projects:` takes its own title as
  the slug, confirmed at the gate. A plan file or prose has no vault node: match it to an existing
  project where one fits, else derive the slug from its title; confirm either way. The area and vault folder then follow from that project.
- **Bare invocation** → infer the area from CWD (workspace dir, project root,
  or a repo matched via `repos:` frontmatter across
  `~/repos/obsidian/Work/Projects/**`).
- **Vault folder and area**, for a note matched by either route: the vault
  folder is the top-level `Work/Projects/<Folder>/` the note sits in, at any
  depth, never its parent folder. The area is the note's `area:` frontmatter,
  else that folder — the same rule as process-scan rung 3. So
  `Life (area)/Audio Intake/Audio Intake.md` gives vault folder `Life (area)`
  and area `Life`. A name that matches a top-level folder takes that folder
  as the vault folder. § 2 Vault sweeps the vault folder; § 2 Threads sweeps
  the area.
- The registry row gives the workspace dir, launcher aliases, and project
  roots. **Areas with no workspace** (Life, 2D, …) get a vault-only audit;
  dispatch is still possible but limited to bare `cc`/project-root launchers
  from the registry, with no scoped MCP profiles.
- Ambiguous → `AskUserQuestion` with the 2–3 most likely areas.

A scoped target narrows § 2 to the resolved project and skips § 4's question: pointing orient at a
note is already the instruction to shape it.

### 2. Audit (read-only sweep)

- **Next-action slots, first** (estate ADR 0008, decision 7): each project
  note's `next_task:` and that task's `next_action:` (its title when the
  line is blank), read with
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py read <project>…`
  — one `slot <project> live | blank | dead:<reason> <task> <line>` row
  each. A **dead link** (CONTEXT.md **Next task**) reads as a blank slot;
  the script decides which links are dead, never judge it by eye. The slot
  is the project's standing answer; the rest of the sweep is weighed
  against it.
- **Vault**: the area note + every sub-project note (a note whose
  frontmatter `tags:` includes `project`, never a reference, garden or
  README note) under the vault folder `Work/Projects/<Folder>/`, at any
  depth; `Work/Tasks/` frontmatter sweep (`rg` for
  `projects:` matching the area or its projects — collect `status`,
  `priority`, `scheduled`, `due`, `dispatched`, `launch`, `phase`, `wave`,
  `rollout`); phase notes in `Work/Phases/` for the area's projects.
- **Threads**: THREAD.md state lines across the area's project dirs
  (`~/Projects/<Area>/*/THREAD.md`) and `_shared/threads/`.
- **Drift** (ADR 0026): run the shared reconcile step as a dry run for each project in the target,
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/reconcile-project.py --project <slug>`,
  and keep its UNAMBIGUOUS and AMBIGUOUS lists. It writes nothing.
- **Related projects**: projects the target's notes link or name, and projects linking the
  target, especially ones `status: parked` or being absorbed by it. Read their unstarted phases
  and loose tasks for overlap with the target's open work (the reshuffle may pull them in).
- **Recency**: overdue `scheduled:`/`due:` dates; note staleness
  (last-modified); `git status`/`git log -3` in each project root — dirty
  trees also surface aborted-session partial edits worth flagging.
- **In flight**: anything `reshuffle.md` R1 counts as in flight (the one definition: a live
  rollout's stamped tasks, a `dispatched:` stamp ≤7 days old, `status: in-progress` /
  `in_progress` / `review`). Report it as such; never re-batch it (§ 7) and never reshuffle it.

### 3. Present

A situational report written for Lachy catching up, not a log:

- **Headline** (1–2 sentences): the state of the project as a whole.
- **Balls in the air**: per-sub-project one-liners — the slot first
  (`next: <next_action> ([[<task>]])`, or `No next action`), then state,
  blocker, staleness. Group: active / in-flight (dispatched) / stalled /
  dormant.
- **Drift**: one line, the counts plus names, split into unambiguous (fixed on Reshuffle) and
  ambiguous (listed for Lachy, never applied). Omit the line when both lists are empty.
- **Shape**: how much a reshuffle has to work with: loose tasks, brain dumps, unstarted phases,
  overlaps found in related projects, and any live rollout.
- **ONE recommended best use of his time**, with a one-line reason — same
  single-recommendation discipline as `next`. Everything else is context, not
  competing recommendations. Frame it as a **proposal against the slot** of
  the project it belongs to, so the two never read as competing answers:
  the slot's own task → say they agree; a different item → name the slot and
  say why this beats it; a blank slot → say the recommendation would fill it.

### 4. Reshuffle or Look only

`AskUserQuestion`, recommended option first:

- **Reshuffle** (the usual choice on pickup) — continue to § 5. This answer authorises the drift
  fixes; the reshuffle's own writes still wait for its gate.
- **Steer only** — no reshaping: fix the drift (§ 5.1), then route the open work as it stands
  (§ 6), e.g. to fan out background batches. Authorises the drift fixes, as any steer did under
  ADR 0026.
- **Look only** — the audit was the deliverable. **Look only** → stop: no writes of any kind.

A scoped target skips this question and goes straight to § 5.2: it reshapes one note, so it
applies no drift fixes (the § 3 Drift line is report-only for it).

### 5. Reshuffle

1. **Fix the unambiguous drift first** (Reshuffle and Steer only; never for a scoped target):
   re-run the reconcile step with `--apply` for each project, so the reshuffle never forms a
   roadmap on top of finished work. Ambiguous items are listed for Lachy and never applied. Steer
   only then skips to § 6.
2. **Run the reshape step** in `${CLAUDE_PLUGIN_ROOT}/skills/orient/reshuffle.md` (R1–R5): the
   item set by reach tier, the clear/unclear sort and proposal, the grill of what is unclear
   (which Lachy can stop at any point), the one gate, the writes. With nothing to reshape
   (Lachy stops the grill at once and the gate is empty), carry straight on to § 6.

### 6. Route

- **Run the execution-fit test** on each phase the reshuffle touched and on each other open
  cluster, and name its lane. Mixed sets split, as the fit-test doc says.
- **Wave-shaped → the rollout lane, scheduled here.** Run
  `${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--tasks` naming exactly the members of
  the wave-shaped phases (or clusters) on that repo: never a bare project run, which would also
  sweep up misfits, session-lane phases and whatever the grill left unresolved. **At most one
  rollout is live per repo**, so first look for an open rollout note in `Work/Tasks/` whose
  `Project root:` line is this repo:
  - **None** → schedule `--tasks <members>`.
  - **This project's, not running** (paused, or idle per
    `${CLAUDE_PLUGIN_ROOT}/skills/status/SKILL.md`) → schedule `--regenerate --tasks <members +
    its unmerged tasks>`, so the new rollout **supersedes** it.
  - **This project's, mid-run** → schedule nothing and pause nothing here. The supersede waits
    for the execute offer (§ 9), whose answer is the only consent to pause a running rollout.
  - **Another project's** → schedule § 0 stops on it (execution-fit § Dispatch blockers); report
    the remedy and make no execute offer for this repo.

  Schedule's own § 0 checks can still stop it with a named remedy, which orient reports. cc-*
  batches are never offered for wave-shaped work; orient never re-implements the merge engine.
- **Everything else → the session lane.** If any session-lane work is left, steer it with
  `AskUserQuestion`, recommended option first (informed by the audit — e.g. if almost nothing is
  parallel-safe, recommend Hands-on):
  - **Autonomous** — cluster the parallelisable work into batches and launch them as background
    scoped sessions (§§ 7–8); Lachy stays focused elsewhere. This answer IS the launch
    authorisation — no per-batch confirm follows (ADR 0010).
  - **Hands-on** — he has time for this project: if the best-focus item has a THREAD.md or capture
    task, run `open`'s pickup logic; else follow the task note's `## Launch` / `## Resume prompt`.
    No ceremony beyond that.
  - **Mixed** — dispatch the background-safe batches AND hand him the highest-leverage item.
  - **Not now** — leave the session-lane work where the reshuffle put it.
- **The slot write** (fill-blank only — estate ADR 0008 decision 4), after the steering answer:
  in every mode but Look only or a dry run, when the recommendation is a task note that stays
  open, run
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py fill <task> [--action -]`
  (the line on stdin, grain rule and targets as
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4b), naming the task by its
  post-reshuffle filename. It fills only
  a blank or dead slot and a blank `next_action:`; a set slot is never
  overwritten — only a set-down or Lachy does that; the recommendation
  stays a proposal against it. Skip the write when Hands-on
  picks the task up through `open`'s pickup: that completes a capture, so
  the pointer would be dead the moment it landed.

### 7. Batch (Autonomous / Mixed)

Batching is the session lane — only work that **fails** the execution-fit test
is batched here (wave-shaped work already went to schedule in § 6). Cluster the
dispatchable open work into **parallel-safe batches**:

- **Disjoint surfaces**: no two batches may edit the same files, vault notes,
  or external surfaces (e.g. the same Webflow page/fields). A shared surface
  → same batch, or explicit ownership noted in both prompts.
- **Profile fit**: match each batch to the *narrowest covering* launch profile
  from the workspace's `CLAUDE.md § Launch profiles` table (e.g. SEO work →
  `cc-animately-seo`). That table + the registry are the only config — orient
  maintains no manifest of its own.
- **Exclusions**: conversation-gated tasks (need Lachy's input — say so, leave
  them for Hands-on or the next reshuffle's grill); tasks with a recent `dispatched:` stamp; work
  whose playbook demands human sign-off before external effects.

### 8. Dispatch the batches

For each batch:

1. Write its durable prompt to
   `<workspace>/.scratch/orient/<YYYY-MM-DD>-<batch-slug>-prompt.txt`.
2. Check required tools/accounts and file ownership. Assemble `args.jobs` for
   supported batches: `{ key: <batch-slug>, prompt: <full prompt>, options: {} }`.
   Use the shared batch engine and one stable private run directory for this
   dispatch. Keep unsupported batches unstamped and explain the missing tool.
3. Follow the shared host protocol: `advance`, claim a pending request, spawn a
   clean native child, and bind the actual returned child ID immediately. Include
   workspace context and ownership in the prompt. Children and all their nested
   agents/reviewers stay in the calling harness and account.
4. Only after the native spawn has returned a real child ID and is bound, stamp
   `dispatched: <YYYY-MM-DD>` on its covered task notes. A prepared request or a
   claim without a verified child is not a launch. Respect available concurrency;
   queue excess batches without launching another model process.
5. Collect native child output and accept its envelope, then advance the journal.
   Recover the actual child on interruption rather than clearing its claim. Report
   each batch as running, complete or blocked with its native ID/run directory.

**Every batch prompt must carry** (the emission spec):

- **Execute-directly framing** — this is a worklist to run, not a plan to
  grill or re-scope. Name the concrete tasks and their notes.
- **Preflight** — verify the profile's MCP namespaces are loaded and make one
  cheap authenticated call each; missing/unauthenticated → STOP and report
  (same guard as task-writer § 5).
- **`git status` first** — a prior aborted session may have left partial
  edits; reconcile before working.
- **Domain playbook gates** — staging-first, confirm-before-publish, and any
  domain-specific sign-off rules from the workspace's playbooks. No Linear
  filing unless the active profile carries a Linear server.
- **Cross-batch coordination** — name any shared surfaces and who owns them;
  check task-note progress stamps before editing anything another batch might
  own.
- **End-of-run updates** — update each covered task note per TaskNotes
  conventions (status/progress stamp, superseding `dispatched:`), so a later
  orient run or `--debrief` reads the truth from the notes.
- **Execution context** — identify the canonical workspace, project and required
  authenticated tools. Native tools come from the parent session. Isolate code
  edits in worktrees where needed; do not expect a worktree to load MCP profiles.

Close the dispatch with one line per batch: native child ID, batch title, tasks
covered, and verified-running, completed or blocked.

### 9. The execute offer

**When § 6 wrote a rollout note**, end with `AskUserQuestion`, recommended option first:

- **Fresh session** (recommended after a reshuffle, which has filled this context) — run
  `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` with the target repo as the handoff's home, so the
  new session starts there, and `/thread:execute [[<rollout>]]` as the continuation. Handoff
  creates the visible task where the harness can, and labels it a manual handoff elsewhere.
- **Here** — run `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` on the rollout note in this
  session (sensible when the reshuffle was small).
- **Not yet** — name the rollout note and the `/thread:execute [[<rollout>]]` line, and stop.

**When the supersede is waiting on a mid-run rollout** (§ 6), the offer is different, because
nothing new is scheduled yet and the old rollout is still running:

- **Pause and hand off** (recommended) — this answer is the consent to pause. Stamp
  `pause_requested: true` on the live rollout note (a soft pause: the running wave finishes and
  merges; execute § Pausing + reinstating a rollout), then run the handoff skill as above with this
  continuation: wait for the rollout's `paused:` stamp, run
  `/thread:schedule --regenerate --tasks <the § 6 members + its unmerged tasks>`, then execute the
  new rollout it writes. Never `/thread:execute` the old note: that would reinstate it.
- **Not yet** — pause nothing; the live rollout runs on. The reshuffled phases are written and
  wait; a later `/thread:orient <project>` schedules them once the live rollout is done.

There is no **Here** in that case: this session would sit waiting on a wave boundary. Execute's own
runtime gate still applies wherever it runs. No rollout written and no supersede waiting → no
offer.

### 10. `--debrief`

`/thread:orient <target> --debrief` skips the reshuffle and steering: sweep the area's
`dispatched:`-stamped task notes (and, where more detail is needed, the batch
native run journals and the calling harness's native child status/results), then report per batch —
completed / stalled / never launched. Clear `dispatched:` from any task whose
stamp is stale (>7 days with no progress update, or artefact never launched).
Fire-and-forget remains the default; a fresh `/thread:orient` audit is the
lightweight version of this.

## Don't

- **Do not pretend native children load a different profile.** Check required
  tools in the calling session; missing dependencies block that batch.
- **Don't ask a second launch confirmation.** The steering answer authorises
  the launch (ADR 0010); composing batches and firing them is mechanics.
- **Don't dispatch from (or into) a full-profile session.** Kitchen-sink MCP
  sets kill sub-agent fan-out ("Prompt is too long") — scoped profiles are
  the entire point.
- **Do not substitute another harness or account.** Native child dispatch is the
  default; absent capabilities are reported instead of shelling out to a model.
- **Don't re-batch a task with a recent `dispatched:` stamp**, and don't stamp
  or write anything — the slot write included — in Look only or dry runs.
- **Don't reshuffle in-flight work.** Its scope, phase and body are frozen; only new members may
  join its phase (`reshuffle.md` R1).
- **Don't write before the reshuffle's gate**, drift fixes on a Reshuffle or Steer only answer
  aside; a scoped target applies none.
- **Don't pause a running rollout** except on the execute offer's **Pause and hand off** answer.
- **Don't recommend more than one focus item**, and don't pad the audit —
  headline, balls in the air, drift, shape, one recommendation, then the question.
- **Don't re-implement siblings or the engine.** Hands-on focus runs `open`'s
  logic; wave-shaped work goes to schedule (the execution-fit test
  decides, hard); execute runs only through the execute offer; batch clusters never grow a merge
  engine here.
- **Don't batch a wave-shaped cluster**, don't schedule a bare project run (always `--tasks`), and
  don't schedule a second rollout beside a live one on the same repo: supersede it.
- **Don't use orient for a single live thread** — that's `next`.
