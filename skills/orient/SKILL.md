---
name: orient
description: 'Project-altitude orientation — audit a whole project/area after time away, recommend the best use of Lachy''s time, ask how he wants to steer (background agents vs hands-on focus), then route. Triggers on "orient me on <project>", "where is <project> at overall", "I haven''t looked at <project> in a while — what''s open?", "audit <project> and tell me where my time should go", "fan out background sessions on <project>", or explicit /thread:orient [target]. Also /thread:orient <target> --debrief to sweep previously dispatched batches. For ONE thread''s next move use thread:next; wave-shaped clusters (one repo, PR-per-task, machine-verifiable in-run) route to the rollout lane — thread:gather / thread:schedule — per the execution-fit test.'
---

# /thread:orient — where should my time go on this project?

The project-altitude sibling of `next` (ADR 0003). `next` answers "what's my
move?" for the *current thread*; `orient` answers it for a *whole project or
area* — many sub-projects, tasks, and threads, returned to after time away.
It audits the balls in the air, recommends ONE best use of Lachy's time, asks
how he wants to steer, then routes: parallel-safe batches dispatched as
background scoped sessions, a focus item opened for his own attention, or
both. A dispatch **launches its batches itself** (ADR 0010): the steering
answer is the sole authorisation, the prompt file remains the batch's durable
contract, and missing native capabilities remain explicitly undispatched.

**Contains no route logic of its own** beyond batching/emission: hands-on
focus dispatches to `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` (or the
task's own `## Launch` block); wave-shaped clusters route to the rollout lane
by running `${CLAUDE_PLUGIN_ROOT}/skills/gather/SKILL.md` or
`skills/schedule/SKILL.md`, never re-implemented here. The execution-fit test
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md`) decides the lane —
hard, not as a preference.

## Runtime boundary

The project audit, steering and task-note debrief are shared. Autonomous batches
use the calling harness's native child tools and current account, never a model
CLI or a new cmux/Orca model session. The shared exchange at
`~/repos/workspaces/_shared/scripts/native_workflow.md` supplies journalled
claims, native child bindings and result validation. Its generic batch engine
is `native_workflow_batch.workflow.js`; it dispatches already prepared prompts
and contains no project/domain workflow.

Native children inherit available tools; a target workspace path does not load
another MCP profile. Before dispatch, check every batch's required capability
and account against the calling session. If a required scoped capability is
absent, retain the prompt and report that batch blocked/undispatched. Do not
silently switch harness, account or launch a broader profile. Other independent
batches may proceed. Hands-on pickup follows `open`'s contract.

Wave-shaped work still routes to gather/schedule and execute's runtime gate.
The native exchange does not supply the detached Wave hook/heartbeat driver.

## Process

### 1. Resolve the target

Accept a fuzzy target and resolve it to (area, vault folder, workspace,
project roots):

- **A name** (`/thread:orient Animately`) or **wikilink** (`[[Animately]]`, a
  sub-project note) → match against `~/repos/obsidian/Work/Projects/<Area>/`
  and the workspace registry
  (`~/repos/workspaces/_shared/workspace-registry.md`).
- **Bare invocation** → infer the area from CWD (workspace dir, project root,
  or a repo matched via `repos:` frontmatter across
  `~/repos/obsidian/Work/Projects/**`). A matched note's area is the
  top-level `Work/Projects/<Area>/` folder it sits in, at any depth, never
  its parent folder or its `area:` frontmatter.
- The registry row gives the workspace dir, launcher aliases, and project
  roots. **Areas with no workspace** (Life, 2D, …) get a vault-only audit;
  dispatch is still possible but limited to bare `cc`/project-root launchers
  from the registry, with no scoped MCP profiles.
- Ambiguous → `AskUserQuestion` with the 2–3 most likely areas.

### 2. Audit (read-only sweep)

- **Vault**: the area note + every sub-project note under
  `Work/Projects/<Area>/`, at any depth; `Work/Tasks/` frontmatter sweep (`rg` for
  `projects:` matching the area or its projects — collect `status`,
  `priority`, `scheduled`, `due`, `dispatched`, `launch`); phase notes in
  `Work/Phases/` for the area's projects.
- **Threads**: THREAD.md state lines across the area's project dirs
  (`~/Projects/<Area>/*/THREAD.md`) and `_shared/threads/`.
- **Recency + drift**: overdue `scheduled:`/`due:` dates; note staleness
  (last-modified); `git status`/`git log -3` in each project root — dirty
  trees also surface aborted-session partial edits worth flagging.
- A task with a **recent `dispatched:` stamp** (≤7 days, still `status: open`)
  is *in flight* — report it as such; never re-batch it (§ 6).

### 3. Present

A situational report written for Lachy catching up, not a log:

- **Headline** (1–2 sentences): the state of the project as a whole.
- **Balls in the air**: per-sub-project one-liners — state, blocker,
  staleness. Group: active / in-flight (dispatched) / stalled / dormant.
- **ONE recommended best use of his time**, with a one-line reason — same
  single-recommendation discipline as `next`. Everything else is context, not
  competing recommendations.

### 4. Steer

`AskUserQuestion`, recommended option first (informed by the audit — e.g. if
almost nothing is parallel-safe, recommend Hands-on):

- **Autonomous** — cluster the parallelisable open work into batches and
  launch them as background scoped sessions; Lachy stays focused elsewhere.
  This answer IS the launch authorisation — no per-batch confirm follows
  (ADR 0010).
- **Hands-on** — he has time for this project: route the best-focus item into
  `thread:open` / its task's `## Launch` block and work it here.
- **Mixed** — dispatch the background-safe batches AND hand him the
  highest-leverage item for his own attention.
- **Report-only** — the audit summary was the deliverable; stop.

### 5. Route

- **Report-only** → done, no writes.
- **Hands-on** (and the focus half of Mixed) → if the item has a THREAD.md or
  capture task, run `open`'s pickup logic; else follow the task note's
  `## Launch` / `## Resume prompt`. No ceremony beyond that.
- **Autonomous** (and the batch half of Mixed) → §§ 6–7 for clusters that
  FAIL the execution-fit test; clusters that pass it go to the rollout lane
  below, regardless of the steering answer.
- **Wave-shaped clusters** (pass the execution-fit test:
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` — one repo,
  PR-per-task, machine-verifiable in-run) → **the rollout lane is the default,
  not a suggestion**: run `${CLAUDE_PLUGIN_ROOT}/skills/gather/SKILL.md`
  (loose tasks needing a roadmap) or `skills/schedule/SKILL.md` (already
  phased) for that cluster. cc-* batches are not offered for wave-shaped
  clusters — the 2026-08-10 GifLab and Smart Slider batches were this leak.
  Orient never re-implements the merge engine.

### 6. Batch (Autonomous / Mixed)

Batching is the session lane — only work that **fails** the execution-fit test
is batched here (wave-shaped clusters already routed via § 5). Cluster the
dispatchable open work into **parallel-safe batches**:

- **Disjoint surfaces**: no two batches may edit the same files, vault notes,
  or external surfaces (e.g. the same Webflow page/fields). A shared surface
  → same batch, or explicit ownership noted in both prompts.
- **Profile fit**: match each batch to the *narrowest covering* launch profile
  from the workspace's `CLAUDE.md § Launch profiles` table (e.g. SEO work →
  `cc-animately-seo`). That table + the registry are the only config — orient
  maintains no manifest of its own.
- **Exclusions**: conversation-gated tasks (need Lachy's input — say so, leave
  them for Hands-on); tasks with a recent `dispatched:` stamp; work whose
  playbook demands human sign-off before external effects.

### 7. Dispatch the batches

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

### 8. `--debrief`

`/thread:orient <target> --debrief` skips steering: sweep the area's
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
  anything in Report-only or dry runs.
- **Don't recommend more than one focus item**, and don't pad the audit —
  headline, balls in the air, one recommendation, then the steering menu.
- **Don't re-implement siblings or the engine.** Hands-on focus runs `open`'s
  logic; wave-shaped work goes to the rollout lane (the execution-fit test
  decides, hard); batch clusters never grow a merge engine here.
- **Don't batch a wave-shaped cluster.** If it passes the fit test it rolls
  out — cc-* batches are for work the engine can't take.
- **Don't use orient for a single live thread** — that's `next`.
