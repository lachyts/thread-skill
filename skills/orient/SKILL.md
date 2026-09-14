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
contract, and a hand-run one-liner survives only as the no-cmux fallback.

**Contains no route logic of its own** beyond batching/emission: hands-on
focus dispatches to `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` (or the
task's own `## Launch` block); wave-shaped clusters route to the rollout lane
by running `${CLAUDE_PLUGIN_ROOT}/skills/gather/SKILL.md` or
`skills/schedule/SKILL.md`, never re-implemented here. The execution-fit test
(`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md`) decides the lane —
hard, not as a preference.

## Runtime boundary

The read-only project audit, recommendation and task-note debrief are portable
across harnesses with local filesystem access. Hands-on pickup follows `open`'s
own runtime contract. Planning a batch does not mean this harness can launch it.

The batch launcher in §§ 6–7 is a **Claude Code scoped-profile runtime**: it
expands a `cc-*` alias into a Claude process and uses cmux to start a separate
session with that profile's MCP configuration. Before offering a launch or
writing any `dispatched:` stamp, check that the calling session is Claude Code,
the intended profile is available, and cmux is reachable. Keep the calling
session's account; a generic permission to batch work does not authorise spending
another harness or account's quota.

In Codex or another harness, complete the portable audit and supported hands-on
work. If background batches are requested, prepare their durable prompts and
clearly labelled manual Claude-profile launch commands for Lachy, then report
that automatic dispatch requires the Claude scoped-profile runtime. Leave those
tasks unstamped until a launch is verified. Missing cmux in Claude uses the same
manual-emission fallback. Never turn this launcher into same-session subagents,
Workflows, or a silent `claude` shell execution from another harness: those do
not preserve the separate profile and account contract.

Wave-shaped work still routes to `gather` / `schedule` for planning. Execution
and repair require the canonical Wave runtime specified by `execute`; discovery
of a skill is not runtime support. Do not improvise a replacement engine or port
Wave as part of orient.

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
  `~/repos/obsidian/Work/Projects/*/*.md`).
- The registry row gives the workspace dir, launcher aliases, and project
  roots. **Areas with no workspace** (Life, 2D, …) get a vault-only audit;
  dispatch is still possible but limited to bare `cc`/project-root launchers
  from the registry, with no scoped MCP profiles.
- Ambiguous → `AskUserQuestion` with the 2–3 most likely areas.

### 2. Audit (read-only sweep)

- **Vault**: the area note + every sub-project note in
  `Work/Projects/<Area>/`; `Work/Tasks/` frontmatter sweep (`rg` for
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

1. Write the batch prompt to
   `<workspace>/.scratch/orient/<YYYY-MM-DD>-<batch-slug>-prompt.txt`.
2. Apply the runtime boundary above. If automatic launch is unsupported,
   go directly to the manual-emission fallback in step 5, without stamping tasks.
3. **Launch the batch as a cmux workspace** (the steering answer already
   authorised this — no second confirm, ADR 0010):

   ```bash
   cmux workspace create --name "<batch title>" --cwd <workspace-dir> \
     --focus false \
     --command '<expanded profile command> "$(cat <prompt-file>)"'
   ```

   The `--command` text is the profile alias's full expansion from `~/.zshrc`
   (aliases don't resolve in non-interactive shells): `claude
   --dangerously-skip-permissions --add-dir … --mcp-config
   <profile>.mcp.json --strict-mcp-config` plus the prompt argument. The
   command runs through a shell, so `"$(cat …)"` expands. Drop the alias's
   leading `cd` — `--cwd` covers it.
4. **Verify the launch**: `cmux read-screen --workspace <ref> --scrollback` —
   the prompt text visible in the transcript and the session working means
   launched; an idle input box means the prompt never arrived (close the
   workspace, fix quoting, relaunch). After verification, stamp
   `dispatched: <YYYY-MM-DD>` into every covered task note (the double-dispatch
   guard § 2 reads; the batch session's end-of-run update supersedes it).
5. **Fallback — unsupported harness or no reachable cmux socket** (`cmux
   ping` fails: Desktop app, SSH, cmux not running): emit one fenced `bash` block per batch for Lachy
   to run himself, and say launching fell back to emission:

   ```bash
   cc-animately-seo "$(cat ~/repos/workspaces/animately-workspace/.scratch/orient/2026-08-08-seo-batch-prompt.txt)"
   ```

   Profile aliases take a trailing prompt directly; **bare aliases**
   (`cc-giflab` etc.) need `-- "prompt"` (`reference_claude_cli_add_dir_variadic`).

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
- **In place, never worktrees** — `.mcp.json` + `profiles/` are gitignored, so
  a worktree session has no workspace MCPs (`reference_orca_inplace_vs_worktree`).

Close the dispatch with one line per batch: workspace ref, batch title, tasks
covered, and launch-verified or fell-back-to-emission.

### 8. `--debrief`

`/thread:orient <target> --debrief` skips steering: sweep the area's
`dispatched:`-stamped task notes (and, where more detail is needed, the batch
sessions' transcripts via `ccd_session_mgmt`, or a still-open batch workspace
live via `cmux read-screen --scrollback`), then report per batch —
completed / stalled / never launched. Clear `dispatched:` from any task whose
stamp is stale (>7 days with no progress update, or artefact never launched).
Fire-and-forget remains the default; a fresh `/thread:orient` audit is the
lightweight version of this.

## Don't

- **Don't run batches as Workflows or subagents inside the orient session.**
  Subagents inherit the parent session's MCP config — they cannot load a
  different scoped profile, which is the whole point of a batch. Separate
  launched sessions only.
- **Don't ask a second launch confirmation.** The steering answer authorises
  the launch (ADR 0010); composing batches and firing them is mechanics.
- **Don't dispatch from (or into) a full-profile session.** Kitchen-sink MCP
  sets kill sub-agent fan-out ("Prompt is too long") — scoped profiles are
  the entire point.
- **Don't emit Claude Desktop chips or cloud launches.** Chips wrapped every
  prompt in `/grill-with-docs` on 2026-08-08 (batches never executed —
  investigation task open); no cloud environment is configured. cmux launch
  is the surface; hand-run terminal one-liners are the fallback.
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
