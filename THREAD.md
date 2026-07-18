# wave — iteration thread

Running log of how the wave skill pair evolves. Newest first. The structured findings ledger
lives in the Obsidian vault at `Work/Tasks/wave-execute-e2e-test-giflab`; the project note is
`Work/Projects/Side projects/Wave Skill`.

---

## 2026-07-19 — 1.4.0 ships: /wave:gather — loose tasks → roadmap, grill skills wired in live

The gather build (specced in the 2026-07-18 grill, deferred via `wave-skill-gather-skill`) lands as
`skills/gather/SKILL.md`: cluster proposals → grilled meaning → mechanical writes (phase notes per
`add-phase.md`, `pN-M` renames + `phase:` stamps with vault-wide backlink rewrite, two-block
surfacing), `--light` for clustering-only. Split's inverse; both feed `/wave:schedule`.

**New this session — the interview step is wired to Lachy's grill skills by name, never copied**,
so his edits to them propagate for free. Gate rule (grilled 2026-07-19): repo (from the project
note's `repos:`) has `CONTEXT.md`/`CONTEXT-MAP.md` → invoke `grill-with-docs` silently, doc writes
directed at that repo (not the session CWD); repo without → one up-front ask ("start a CONTEXT.md?");
no repo → `grill-me`; neither installed (public plugin, personal skills) → inline interview shape.
This adds the one sanctioned exception to gather's vault-only scope: the grill step inherits
grill-with-docs' write surface (`CONTEXT.md` + `docs/adr/` in the resolved repo). Recorded here in
lieu of an ADR — additive, cheap to reverse, no new architecture.

Other grilled calls: joins into **existing** phases allowed (`M` = next free ordinal, never
renumber); no `--regenerate` (the no-`phase:` discovery filter makes re-runs incremental by
construction); backlinks rewritten in-place on rename. CONTEXT.md gains the **Gather** glossary
entry; README gains the pipeline bullet + layout + routing line. Shipped as **1.4.0**.

## 2026-07-19 — 1.3.0 ships: the self-hosting rollout — wave builds six features into itself

A grill-with-docs session turned the project's own backlog (5 brain-dump captures + 1 specced
task) into [[wave-skill-rollout-2026-07-18]] and ran it same-day: **6 waves, fully serial**
(complete conflict graph — `wave-execute.workflow.js` is a 5-of-6 hub), PRs #1–#6, zero
escalations (both opus tasks first-shot green; four predictive fable step-ups). Landed:

- **Transient-death handling** (#1) — `runAgent()` wrapper: one in-run retry, `__dead` sentinel at
  all 10 call sites, layer-appropriate transient blocks, no escalation on infra death.
- **Effort bundles** (#2, ADR 0004) — tier = (model + effort); per-role matrix in the engine;
  per-task `effort:` escape hatch. One ladder, not two knobs.
- **Pause/reinstate** (#3) — soft (`pause_requested`, wave-boundary, via reconcile) + hard
  (TaskStop protocol incl. heartbeat CronDelete); reinstate = plain execute resume.
- **Gated inputs** (#4, ADR 0005) — required plan declaration; `gate-pending` pauses regardless of
  plan_approval/continuous; `approve-gates` records durable sign-off; resume-filter excludes.
- **Progress/ETA** (#5) — flat `wave_N_dispatched/merged` stamps via reconcile (input-gated
  decision, injected live by /wave:repair mid-rollout), rough in-rollout estimate, status render.
- **Dated rollout naming** (#6) — emit `<slug>-rollout-<YYYY-MM-DD>` everywhere, resolve legacy.

**The rollout was also the wave-verify live bed — all three drills passed** (status drift flag;
repair drift-resolve + input-gated inject + re-dispatch; defer-with-dependent chain surfacing).
And it took a real **hard pause** (fable credits, 20:55→02:24): TaskStop mid-implement, heartbeat
deleted, `paused:` stamp, one-shot resume cron — `resumeFromRunId` recovered the worktree work.
The manual runbook matched the protocol wave 3 had codified hours earlier.

- **Gotcha caught pre-flight**: the narcissus no-CI merge-wave guard lived only in the plugin
  cache — never committed. Ported to the repo (`8a3614c`) before dispatch; it then fired live on
  PRs #3/#5. Rule: a cache hot-patch must be committed back the same day.
- **Escalation flip still unobserved live** (unit-tested only) — watch on the next mixed rollout;
  live-bed checklist: vault `wave-skill-live-bed-v13-features`.
- Shipped as **1.3.0** (`c66e221`): manifest + marketplace bumped, cache dir synced from repo,
  `installed_plugins.json` repointed. Vault also gained `/wave:gather` specced (grill-me-by-default
  gather route — tasks → roadmap/phases), riding a later rollout.
- 2026-07-19: set down via thread:defer → vault `wave-skill-gather-skill` (scheduled today, resume
  prompt inside) — the gather build is the next session's work; ships as 1.4.0.

## 2026-07-13 — 1.2.0 ships: duplicate-hooks load failure fixed; gstack eval shrinks the live bed

The plugin had been **fully dead** — `claude plugin list` showed `✘ failed to load` on 1.1.0 with
"Duplicate hooks file detected", killing every `/wave:*` command AND the Stop-hook driver. Root
cause: Claude Code now auto-loads the standard `hooks/hooks.json`, so the explicit `"hooks"` key in
`plugin.json` (added deliberately with the driver in 1.1.0) became a fatal double-registration.
Fixed by dropping the key and shipping **1.2.0** (`19f7fef`): marketplace.json re-synced from its
stale 1.0.0 (README "versions must agree" rule), `claude plugin marketplace update wave` +
`claude plugin update wave@wave`, verified `✔ enabled` with the driver files intact in the new
cache dir.

- **Known quirk (permanent)**: never reference `hooks/hooks.json` from `plugin.json` — the manifest
  `hooks` key is only for *additional* hook files beyond the auto-loaded standard one. Re-adding it
  bricks the whole plugin, not just the hook.
- **Version drift resolved**: 1.2.0 formally publishes everything the in-place rsyncs had smuggled
  into the 1.1.0 cache (model escalation, phase-source inheritance, merge-wave CI fix, alias
  removal). `claude plugin tag` still deferred until the escalation + status/repair live pass.
- **Live-bed change**: the 07-12 entry named "gstack adoption" as the candidate rollout for the
  live drills. The gstack deep-dive (2026-07-13, [[evaluate-gstack-for-our-setup]] — verdicts in
  [[External Skill Sources]]) killed that: gstack skills are ~75% generated boilerplate over a
  Bun-binary runtime, so nothing is adopted wholesale — just two standalone build tasks
  ([[distill-plan-critique-skill]], [[adapt-design-shotgun-lightweight]]), no multi-wave rollout.
  **The live bed for the escalation observation + wave-verify drills moves to the next Animately
  rollout.**

---

## 2026-07-12 — model escalation: one-shot opus first pass, iteration runs at fable

Grill-with-docs session on `wave-skill-fable-fallback`. The brief said "configure Fable as the
fallback model and re-run"; Lachy's mid-grill counter-proposal inverted it — *"drop the ralph loop
for opus tasks and if it doesn't pass first time, escalate to fable"* — and that generalised to all
three convergence loops. An opus task now gets exactly one un-iterated pass per layer (one plan, one
implementation + a **single** verifier run, one judged PR round); the first rejection/red/block
anywhere **escalates** the task to fable for all remaining work — sticky, judges follow the live
tier, and reconcile stamps `model: fable` on the note so resume/repair re-dispatches start at fable.
`max_iterations` is now purely fable's budget. Shipped `e90e504`, pushed; cache synced in place at
1.1.0 (no version bump).

- **Engine restructure**: the 3-stage `pipeline(plan, implement, review)` became single-stage
  `converge(task)` holding mutable tier state (`st.tier`) — same no-barrier parallelism, but an
  escalation in any layer carries into every later agent AND judge. New empty-when-unused fragments
  `oneShotVerify` (replaces ralphLoop at opus tier; red ⇒ commit work, no PR, note diagnosis,
  `escalate=true`) + `escalationContext` (fable takeover inherits worktree + diagnosis; approved
  plans carry over un-replanned). `IMPL_RESULT` gained required `escalate`; results gained
  `model`/`escalated`/`escalatedAt`; reconcile-wave.py stamps the note.
- **Terminology (CONTEXT.md § Model tiering + ADR 0003)**: **Step-up** = schedule §4.7's predictive
  fable stamp; **Escalation** = the engine's evidence-driven flip. "Fallback" rejected — nothing
  falls back, the task steps up. Consequence for schedule: borderline step-up candidates can safely
  stay opus (a wrong call costs one cheap first pass, not a blocked rollout).
- **Deliberate resume-cache break**: the opus implementer prompt changed unconditionally (one-shot
  block is always-on for opus), so in-flight rollouts resumed across the upgrade re-run implement
  stages. Landed between rollouts — nothing was in flight. The fable arm is byte-identical to
  ralphLoop (asserted in prompt-invariants, now 19 cases; reconcile test covers the stamp on landed
  AND still-blocked escalated tasks).
- **Stance memory updated**: "judges always Fable" was stale (judges follow task tier since
  `841df76`); the memory now records one-shot + escalation as the current embodiment of "err toward
  Fable" — escalate on first evidence of hardness rather than defaulting everything up.
- **Open / next** — first live observation rides the next genuine rollout (gstack adoption is the
  candidate), alongside the still-pending status-drift + repair end-to-end drills
  ([[wave-verify-status-repair-live]] § Live bed): watch for an opus task landing green first-shot,
  an escalation firing (`model: fable` stamped + "escalated at …" report line), and no
  over-escalation on trivial review nitpicks — if judges reject too eagerly at r1, the lever is
  judge prompt wording, not the escalation rule. Consider a version bump + `claude plugin tag` once
  the status/repair pair and escalation have a live pass.

---

## 2026-07-07 (afternoon) — stacked project blocks: the phase roadmap is query-driven, prose dies

Second grill, triggered by Lachy opening [[Focus App]]: the morning design put the Phases view behind
a base-block *tab* while the visible roadmap stayed hand-maintained prose — a phase created by
`/add`/split surfaced only in the hidden place. Fix: project notes open with **two stacked,
always-visible base blocks** — open tasks (`groupBy: phase`) + the `Work/Phases/` roadmap as a
`type: table` (unfiltered by status; done phases are history). Prose `## Phases` deleted from Focus
App (`## Later (unscheduled)` prose survives for uncommitted ideas); retroactive **done phase notes
for P1 and P2** complete the 1→4 arc (P2 shipped mid-session in the concurrent P2 run — its phase
note's prefix base surfaces [[focus-app-p2-watcher-drift]] as the one pre-protocol task that
delivered it). Template + `add-project.md` + `add-phase.md` step 4 + schema § Project/§ Phase
updated; other projects inherit lazily on first phase. Vault `8395835`, workspaces `67326d1`.

- **Open**: `groupBy` on the tasknotesTaskList view parses + renders clean at 0 results, but group
  headers are unverified (Focus App had zero open tasks). Eyeball when the P3 split writes tasks;
  fallback = drop `groupBy`, keep phase-first sort (documented in schema changelog).
- **Gotcha (recurring)**: editing this repo does NOT update the installed plugin — Claude Code loads
  skills from `~/.claude/plugins/cache/wave/wave/1.1.0/`. Caught live: `/wave:split` loaded the
  pre-session SKILL.md mid-run. Fixed with the in-place rsync (no version bump, 2026-06-12
  precedent): `rsync -a --delete --exclude .git ~/repos/tools/wave-skill/ ~/.claude/plugins/cache/wave/wave/1.1.0/`.
- **P3 split is Lachy's to run interactively** (grill-style) — deliberately not automated this
  session; the sandbox exercise (Wave Protocol Test project, created + fully torn down) validated
  the whole protocol end-to-end instead: classifier, fresh + legacy split paths, discovery filter,
  archive pass, live Bases rendering.

---

## 2026-07-07 — a phase is a plan, not a task: Phase becomes a vault type, split inherits phase numbers

Grill-with-docs session triggered by the Focus App collision: roadmap phases (P1–P4) had been
captured as task notes, and splitting one would have nested a second phase counter
(`focus-app-p2-watcher-drift-p1-1-…`) with `projects:` pointing at a task masquerading as a project.
Key clarification now in CONTEXT.md: **two ladders share one atom** — planning (project → phase →
task, ordered by meaning) and execution (rollout → wave → task, ordered by file-safety). Phase never
enters the engine; wave never appears in planning; one phase = one rollout by convention only.

- **Phase is a first-class vault type**: `tags: [phase, <area>]`, `phase: N`, home
  `Work/Phases/<project>-p<N>-<desc>`, archive parity with tasks. Writer spec (single source of the
  note shape, read by `/add`, split, and free-form agents):
  `workspaces/_shared/knowledge/add-writers/add-phase.md`. ADR 0002.
- **split**: detects a phase-note source → project slug = parent from `projects:`, tasks inherit
  `phase: N` (never a nested counter; intra-phase order = dependency links only). Gate table gains a
  proposed-filename column + source-disposition footer; step 6 retags/moves legacy task-tagged
  sources.
- **schedule**: discovery gained the positive `tags: contains task` filter — the old exclusion-only
  filter would have dispatched any open non-task note linked to the project (found during the grill).
- Rejected: janitor sweeps, validation hooks, `--phase` flags, per-project phase folders — wave's
  gates are the intentional correction moments; authoring-time knowledge prevents the mess upstream.
- No engine changes; no version bump. First live exercise: splitting Focus App P3.

---

## 2026-07-05 — merge-wave: absent required check + CI in flight = pending, not "never appeared"

The 2026-07-04 giflab rollout halted 3× (once per fresh check-run cycle: initial push, each REST
update-branch) on `ERROR: required checks never appeared` — the mono's sole required check is the
end-of-workflow roll-up `Checks Complete` (`needs:` every other job), and GitHub only *creates* that
check run when its `needs:` finish (~7–8 min), far past the ~2.5 min appear budget
(`CHECK_RETRY_MAX × CHECK_INTERVAL`). Recovery was poll-then-rerun babysitting; the aggregate-only
required-check pattern is common (it's what keeps branch protection stable across path-conditional
jobs), so this was a real zero-touch hole. Task: `wave-merge-rollup-check-appear-timeout`.

- **Fix (option 2 from the task note — the real one):** new `ci_runs_in_flight()` probes
  `actions/runs?head_sha=<head>`; while any workflow run on the head SHA is not `completed`,
  `wait_required_checks` treats absent required checks as *pending* and keeps waiting (heartbeat
  logged). The `CHECK_RETRY_MAX` budget now counts only CONSECUTIVE polls with nothing running
  anywhere — "never appeared" fires only when nothing is coming. Red-check/infra-rerun path untouched.
- **Probe gotcha #1 — workflow runs, NOT check-suites:** installed apps (digitalocean, cursor) leave
  phantom check suites permanently `queued` with 0 check runs on every giflab commit; a check-suite
  probe would read "in flight" forever. Verified live before writing the fix.
- **Probe gotcha #2 — empty `head_sha=` is silently IGNORED** by the API and returns the repo's entire
  run list (a false in-flight → infinite wait). `ci_runs_in_flight` is fail-closed: empty SHA, API
  error, or unparseable count all fall back to the bounded appear budget — external-CI repos behave
  exactly as before.
- No version bump (in-place sync at 1.1.0, per the 2026-06-12 precedent). Live acceptance rides on the
  next giflab wave: all PRs merge with zero manual intervention, including after update-branch cycles.

---

## 2026-07-03 (evening) — /wave:plan alias removed; /wave:schedule is the only name

The deprecated alias stub at `skills/plan/` (left behind by the 2026-06-18 rename) is gone. Lachy's
call: the lingering `/wave:plan` command muddied the concept — "plan" suggests planner logic that no
longer lives there, and the pipeline reads cleaner as exactly **`/wave:split` → `/wave:schedule` →
`/wave:execute`** with no plan-named entry point. No engine change, no version bump (in-place sync at
1.1.0 across repo → marketplace → cache, same as the 2026-06-12 reconcile). Anyone typing
`/wave:plan` now simply finds no such command instead of a redirect.

---

## 2026-07-03 (later) — automatic driver: Stop hook + heartbeat cron (wave drives itself)

Lachy's pushback on the morning's audit landed: *"I don't understand why I've been given it as a user
to type these in. WAVE should do this by itself."* Correct — `/goal` and `/loop` are just user-facing
wrappers over primitives the plugin can own (Stop hooks and CronCreate). Wave now ships both; the user
types nothing.

- **`hooks/wave-stop-driver.py`** (+ `hooks/hooks.json`, wired via new `"hooks"` key in `plugin.json`,
  version bumped 1.0.0 → 1.1.0) — a Stop hook, the programmatic twin of a `/goal` condition. Parses
  the last assistant-emitted `WAVE-STATUS` line: `running` → blocks the stop with the exact next step;
  `waiting`/`halted`/`done` → releases (halted/done also clear driver state). Progress-aware cap: 3
  consecutive blocks without cursor advance → release + "likely wedged — /wave:status or /wave:repair"
  systemMessage (the harness's `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` is a second floor). Only
  assistant-authored text blocks count — tool results/user messages quoting the line (docs, THREAD) are
  ignored, and `<K>`-style template placeholders can't match the strict regex. 13-case
  `wave-stop-driver.test.sh` green; state per session in `~/.claude/wave-driver/<session_id>.json`
  (override: `WAVE_DRIVER_STATE_DIR`).
- **WAVE-STATUS gained a 4th state: `waiting`** — critical to avoid the busy-spin the morning audit
  flagged for `/goal`: a launched wave idling on its Workflow-completion notification is *legitimate*
  stopping (`waiting`, driver releases); only `running` (reconcile/merge/launch work outstanding) blocks.
- **Heartbeat cron** (execute step 5): at first wave launch the lead session self-registers a
  `*/20 * * * *` CronCreate — the backstop for the one stall the Stop hook can't see (hung Workflow /
  missed notification while `waiting`). Tick: done/halted → self-delete; run visibly in flight → silent
  no-op; stalled → re-enter §4.5 cold resume (idempotent). Completion ceremony + §7 halts delete it.
- **§8 rewritten**: automatic driver is the default; `/goal` + `/loop /wave:status` demoted to manual
  fallbacks (hooks disabled / foreign environments). Gated mode ends merge-pause turns with
  `state=halted reason="gated: awaiting user merge"` so the driver releases — gated stays human.
- **Ship path**: plugin installs from GitHub `lachyts/wave-skill` (marketplace `wave`) — needs commit +
  push + `claude plugin update wave`; next session start will prompt to trust the new hook.
- **Live battery (same day): PASS — with one real bug found and fixed.** Headless sessions via
  `claude --plugin-dir <repo> -p … --model haiku --include-hook-events`:
  - **Race bug**: the first live run never blocked — the final assistant message is flushed to the
    transcript file *after* Stop hooks fire (verified: transcript grew ~6KB post-hook), so the
    transcript-only parser saw stale history. Fix: the Stop payload carries **`last_assistant_message`**
    (verified on 2.1.199) — now the primary source, race-free; transcript scan demoted to history
    fallback (still catches a turn that *forgot* the line). Unit suite grew to 16 cases, all green.
  - T1 no-op safety (non-wave session, machine-wide): PASS — clean 1-turn stop, zero interference.
  - T2 block→converge: PASS — `running` blocked, harness auto-continued, model followed the block
    reason to `waiting`, released; state file recorded blocks=1. Registration confirmed: 10 Stop hooks
    baseline → 11 with the plugin.
  - T3 wedge cap: the *mechanism* passed so well the cap never engaged — the block reason redirected a
    model told to stay wedged forever into printing `waiting` on the very next turn. Cap arithmetic
    stays unit-tested (cases 5–6).
  - T4 halted: PASS — zero blocks, immediate release.
  - Bonus discovery: the Stop payload also carries **`background_tasks`** and **`session_crons`** — a
    future driver iteration could distinguish "waiting with a live run" from "stalled" without touching
    /workflows. `WAVE_DRIVER_DEBUG=<path>` env now makes the hook append diagnostics (kept — it found
    the race).
- **Shipped same day**: pushed (09255ef), `claude plugin update wave@wave` 1.0.0 → 1.1.0, and the
  post-update parity test (T2 against the *installed* plugin, no --plugin-dir) passed identically —
  including the answer to the trust question: **the new hook fired in a fresh headless session with no
  re-trust prompt**.
- **Open / next** — remaining live checks (next real rollout): (a) the driver + heartbeat + execute
  engine together, (b) `waiting` means no busy-spin during an hour-long wave, (c) heartbeat registers
  once / self-deletes on done.

---

## 2026-07-03 — /loop + /goal audit: unattended driving documented (docs only)

Audited Claude Code's built-in `/loop` (recurring re-invocation, fixed-cron or self-paced) and `/goal`
(per-turn Stop-hook convergence evaluator, transcript-only, Haiku) against wave. Verdict: both map
cleanly onto wave's biggest operational gap — the §4.5 continuous loop had **no durable driver** (grep:
zero scheduling primitives in the repo; the loop was model discipline + Workflow-completion
notifications). Wave was already loop-shaped (durable cursor, idempotent cold resume, `resume-filter`,
clean §7 HALTs), so the integration is docs-only — no engine change, resume-cache invariants untouched.

- **execute §6** — every execute turn now ends with a machine-readable
  `WAVE-STATUS: <slug> cursor=K/N state=running|halted|done [reason=…]` line, the deterministic hook a
  transcript-only `/goal` evaluator (or looped prompt) keys off.
- **execute §8 (new)** — *Unattended driving*: `/goal …state=done or state=halted, or stop after 4
  hours` as the continuous-mode backstop; dynamic `/loop` as a stall heartbeat re-entering cold resume;
  fixed `/loop 45m /wave:status` for drift sweeps. Guardrails: never past a §7 HALT, `--gated`
  incompatible, in-call waits (Workflow call, merge-wave.sh CI watching) unaffected, loops are
  session-scoped (true detachment = `/schedule` cloud routine).
- **status** — new *Loopable* section (watchdog pattern, self-terminate when rollout done).
- **repair** — new Don't: never run under `/loop` (input-gated by design).
- **Research correction worth remembering:** a subagent "verified" a v2.1.196 changelog rule that only
  skills with `autonomous: true` frontmatter run inside /loop — **fabricated**. The 2.1.199 binary has
  no such key; the real (inverse) gate is `disable-model-invocation: true`, and slash-command loop
  payloads are first-class (`/loop 5m /babysit-prs` is the built-in's own example). Wave skills need no
  frontmatter change — just never add `disable-model-invocation`.
- **Drive-by fix** — `schedule/SKILL.md` pointed at `skills/plan/rollout-template.md` (dangling since
  the plan→schedule rename); now `skills/schedule/rollout-template.md`.
- **Open / next** — live-verify on the next real rollout: (a) `/loop 45m /wave:status [[rollout]]`
  smoke test — confirm the skill invokes from a tick and stays read-only; (b) `/goal` behaviour while a
  wave's Workflow call is in flight — does the evaluator busy-spin no-op turns during the ~1h run? If it
  spins, prefer the dynamic-/loop heartbeat and keep `/goal` for headless one-shots; record either way.
  These join the still-pending status-drift + repair end-to-end live checks.

---

## 2026-06-25 — `/wave:status` + `/wave:repair`: rollout-scoped situational awareness & repair

Added the two operational verbs Lachy asked for — *"where is this rollout?"* and *"sort it out"* —
plus the `judgeModel` engine fix from the giflab smoke test (not previously logged). The grill (via
`/grill-with-docs`) killed the original "repair engine" design: re-running `/wave:execute` **already**
re-attempts blocked tasks (the engine's worktree setup is idempotent on re-dispatch —
`wave-execute.workflow.js:432` — and `resume-filter` treats blocked statuses as "needs dispatch"). So
repair is a **conductor**, not a second engine.

- **`/wave:status [[rollout]]`** (`skills/status/SKILL.md`) — read-only situational report. Vault read
  via a new `reconcile-wave.py status` mode (glob-by-`rollout:`-backlink, so read-only tasks the
  `## File-sets` block omits are included) + a **live cross-check** (one `git worktree list`, one
  `gh pr view` per PR'd task) that flags **drift**. `--offline` skips the network.
- **`/wave:repair [[rollout]]`** (`skills/repair/SKILL.md`) — conductor. Diagnoses, then: reconciles
  drift → done, auto-retries agent-fixable blocks (cap one/run), asks only **input-gated** decisions
  and injects them into the notes, **dependency-aware-defers** wedged tasks, and hands off to execute's
  §4.5 resume. Never merges except via `merge-wave.sh`. Decision recorded in
  `docs/adr/0001-repair-is-a-conductor-not-an-engine.md`.
- **`reconcile-wave.py` +3 modes** — `status` (emit situational JSON, pure read), `resolve` (flip a
  *blocked* note → done, the `review-blocked → done` gap-closer for the out-of-band-merge case; refuses
  any non-blocked note — caller must verify the PR merged), `defer` (pop a task back to open backlog,
  clearing `wave:`/`rollout:`/`owner:`). Covered by new cases in `reconcile-wave.test.sh`.
- **Engine: re-dispatch is feedback-aware.** A static `PRIOR_FEEDBACK_NOTE` line in the implementer /
  planner / approved-plan-implementer prompts tells a resumed agent to treat a prior
  `## Review-blocked feedback` / `## Blocker diagnosis` / `## Plan-blocked feedback` / `## Repair input`
  section as authoritative — so repair's auto-retry converges instead of silently repeating rejected
  work. `prompt-invariants.test.mjs` still green (the change doesn't touch the gated pure functions).
- **`judgeModel` fix (from the smoke test).** The two judge roles were hard-pinned to `fable`; when
  Fable 5 was unavailable the whole run died. Judges now default to `fable` but are overridable per-run
  via the `judgeModel` arg.
- **Domain model captured** — `CONTEXT.md` glossary (conductor vs engine, input-gated vs agent-fixable
  block, drift, clean defer, dependent closure, situational report) via `/grill-with-docs`.
- **Open / next** — the live paths aren't exercised yet: status **drift** against a *really*-merged PR
  and a full **repair end-to-end** re-dispatch both need a real rollout (the deterministic core is
  unit-tested). Run them on the next rollout. Possible follow-up: bump the plugin version /
  `claude plugin tag` to publish the two new skills.

---

## 2026-06-24 — Orca coexistence: separate lanes + cockpit, wave keeps merge authority (docs only)

Lachy is adopting **Orca** (onorca.dev — open-source GUI ADE / human-in-the-loop cockpit for
parallel agents) as his daily driver and asked how it changes wave, "especially git worktrees."
After a 3-stream investigation (wave architecture · Orca internals · 2026 best-practices) the
answer was **no engine change** — the two coexist cleanly and the work was documentation.

- **Posture — separate lanes + cockpit.** wave = autonomous batch rollouts (unchanged); Orca =
  supervised/exploratory work (one gnarly task, fan-N-pick-winner which wave structurally can't do,
  design-mode, multi-provider) **plus** a read-only window onto wave's live worktrees. They never
  hand-edit the same worktree mid-rollout.
- **Worktrees don't collide.** wave registers via standard `git worktree add` under
  `.claude/worktrees/<slug>`; Orca auto-discovers external worktrees (`git worktree list`),
  classifies them `external`, displays them when external-visibility is on. Free visibility, zero
  integration code.
- **Repair bridge — wave keeps merge authority.** A blocked task is repaired in Orca (fix + push,
  **never merge there**); re-running `/wave:execute` lands it via idempotent `merge-wave.sh`,
  keeping the cursor / smart-halt / file-set invariants intact. Documented in README +
  cross-ref at execute SKILL §7.
- **Billing was a red herring** — Workflow subagents inherit the session's auth, which is a Stripe
  subscription (not API), so rollouts already run on the subscription; Orca wraps the same `claude`
  CLI and changes nothing. The real cost lever stays model-tiering (Fable-first).
- **Reaper verified safe** — `daily-sweep.sh:179-218` (the 11am `daily-git-sweep`) removes only
  clean+merged worktrees, so the bridge (blocked = unmerged) is never reaped. A plain
  `git worktree lock` does NOT protect a worktree (the sweep unlocks non-live-PID locks) — that
  mitigation was investigated and dropped.
- **Deferred:** scripting wave to drive `orca serve`/RPC (loses Workflow resume-cache + harness-
  native simplicity; Orca's interactive agent dispatch is GUI-only). Revisit only if read-only
  visibility proves insufficient.

---

## 2026-06-18 — `/wave:split` added + `plan → schedule` rename (pipeline is now split → schedule → execute)

Two changes in one pass:

- **New `/wave:split`** (`skills/split/`) — the missing upstream stage: takes a plan/design (vault
  note, plan-mode plan file, or inline prose), decomposes it into **PR-sized, phased Obsidian task
  notes** (with the runnable prompt + context + `touches:` + deps), and slims the source into a
  linked outline. Emits **schedule-ready** tasks (writes `touches:`, leaves `wave:`/`scope:` for the
  scheduler). Propose→approve→write gate; honours explicit phases, else infers dependency layers.
- **Renamed `/wave:plan` → `/wave:schedule`** — once `split` does the "turn intent into tasks"
  work, the middle stage isn't *planning*, it's **scheduling** (clustering existing tasks into
  parallel-safe waves). `skills/plan/` is now a thin deprecated **alias stub** that redirects to
  `/wave:schedule`. Live surfaces updated (README, manifests, execute cross-refs, rollout-template);
  archived rollout notes left as historical record — execute reads the rollout *data contract*, not
  the command name, so existing rollouts are unaffected.
- **Forked-clone reconciliation first** — the repo (model-tiering) and the marketplace/cache
  (completion-ceremony + mark-done) had re-diverged since 2026-06-12; merged into one history
  (`d2ceda8`, only THREAD.md conflicted) and re-unified all three copies before layering these on.
- **Canonical source going forward:** the repo `~/repos/tools/wave-skill` is the dev source — edit
  here, then sync the marketplace + the installed cache down from it. (Supersedes the old
  "edit the marketplace" note.)

---

## 2026-06-12 — mark-done: tasks no longer stranded at `review` after landing

The lifecycle ended at `status: review` — engine stamps review, merge-wave merges, ceremony
closes the rollout, but nothing flipped the task notes. Seven landed giflab tasks (PRs #56–#60)
piled up as false "awaiting acceptance" items before Lachy noticed.

- **New `reconcile-wave.py mark-done`** — flips `review` → `done` only; refuses any other status
  (exit 1) so blocked tasks can't be swept along. Test coverage in `reconcile-wave.test.sh`.
- **Wired into every merge-confirmation point** in execute SKILL: §4.5 step 3 (after cursor
  advance — PR tasks *and* the wave's read-only tasks), single-wave mode, cold resume, and a
  straggler sweep as ceremony item 1.
- **Drift healed** — the dated-rollout ordinal naming (plan §6, execute §1) existed only as
  direct edits to the installed cache; ported into the repo. Reminder: the installed cache at
  `~/.claude/plugins/cache/wave/wave/1.0.0/` is a COPY — edit the repo, then re-sync the cache
  (or reinstall); editing either alone re-creates two-way drift.

---

## 2026-06-10 — Per-task model tiering (fable default, opus drop-down)

Agents previously inherited whatever model the invoking session ran — non-deterministic across
sessions. Model is now an explicit config field resolved task frontmatter → rollout frontmatter →
`fable` (commit `db21202`).

- **Stance (Lachy's call):** err toward Fable 5. Fable is the default for every agent; Opus is a
  deliberate per-task *drop-down*, never the other way round.
- **Easy-task heuristic** — `/wave:plan` step 4.7 suggests `model: opus` only when ALL of:
  `scope: single-file`, `work_depth` shallow/absent, change is mechanical (judged from the body).
  Suggestions are a user-confirmed batch; only confirmed tasks get `model: opus` stamped (never
  stamp `model: fable` — it's the rollout-level default in the template frontmatter).
- **Judges engine-pinned to fable** — the task model applies to planner/implementer/reviser/
  investigator; `plan-judge` + `review-judge` always run `JUDGE_MODEL = 'fable'` (merge
  gatekeepers keep max capability even on an opus task). Not configurable by design.
- **No protocol bump** — v3 rollouts without `model:` resolve to `fable`, the intended default.
  Existing rollouts need no regeneration; `model: opus` can be hand-stamped on any task anytime.
- **Quirk** — adding `model` to `agent()` opts is a one-time resume-cache break for pre-feature
  runs (opts are part of the cache key). New runs are stable: the resolved model is deterministic.

---

## 2026-06-04 — Extracted into its own repo, as the `wave` plugin

Pulled `wave-plan` / `wave-execute` out of `~/.claude` (the `lachyts/claude-config` repo) into
this standalone repo, packaged as a Claude Code plugin so it can be tracked, versioned, and
iterated independently.

- **Skills renamed** `wave-plan` → `plan`, `wave-execute` → `execute` (invoked `/wave:plan`,
  `/wave:execute`). Plugin namespace is `wave`; the repo keeps the descriptive name `wave-skill`.
- **Portable paths** — all self-references rewritten from hardcoded `~/.claude/skills/wave-*`
  to `${CLAUDE_PLUGIN_ROOT}/skills/{plan,execute}/…`, including the Workflow `scriptPath`.
- **Engine untouched** — `wave-execute.workflow.js` + the scripts stay byte-identical (preserves
  the resume-cache invariant and the prompt-invariants test).
- **Dev loop** — `claude --plugin-dir <repo>` loads the working tree live; stable channel is a
  marketplace install from GitHub.
- **Verified** — `claude plugin validate` clean; `node --check` / `bash -n` / `py_compile` pass;
  all three test suites green from the new paths (incl. the byte-identical resume-cache invariant);
  installed cache at `~/.claude/plugins/cache/wave/wave/1.0.0/` resolves every bundled path the
  `${CLAUDE_PLUGIN_ROOT}` references point at.
- **Why a plugin, not a symlink** — symlinked skill/command discovery is unreliable (hardlinks
  were needed for shared commands); `--plugin-dir` gives live working-tree iteration without that
  risk, so "clean external repo" and "fast iteration" stopped trading off.
- **Refactor-order quirk** — rewrite self-paths to `${CLAUDE_PLUGIN_ROOT}` BEFORE renaming
  `wave-execute`→`execute`: `skills/wave-execute/wave-execute.workflow.js` contains the substring
  `/wave-execute`, so the rename rule corrupted the engine filename to `wave:execute.workflow.js`
  (would break `scriptPath`). Caught + fixed; cache-path + prompt-invariants checks guard it.

## 2026-06-04 — Operational backlog cleared (was claude-config PR #1)

Landed the MED/LOW improvements spun out of the giflab findings ledger:

- **Scripted reconcile** (`reconcile-wave.py`) — replaces ~50 hand-edited vault frontmatter
  transitions per rollout; per-task resume keyed on task status, not the wave cursor.
- **Merge infra-flake retry** (`merge-wave.sh`) — classify failed CI steps infra-vs-genuine,
  fail-closed; auto-rerun only provable infra/setup flakes before halting.
- **Per-task override channel** (`ignore_gate`) + **env bootstrap** (`env_bootstrap`) — both
  optional, both rendering byte-identical prompts when unset.
- Confirmed affine-cluster merging was already shipped (wave-plan step 4.5).

## 2026-06-02 — End-to-end giflab run → findings ledger

First full real rollout: 8 waves, 14 PRs. Produced the findings ledger. Three HIGH-leverage
fixes shipped + validated (giflab PR #52). Everything since traces back to this run.

---

### Backlog / ideas

- Optional: a small live giflab rollout slice to exercise scripted reconcile + infra-rerun
  end-to-end from the installed plugin.
- First live `/wave:execute` run: confirm the harness substitutes `${CLAUDE_PLUGIN_ROOT}` in the
  Workflow `scriptPath` value (the target file is already verified present in both the install
  cache and the working tree; substitution is the standard documented plugin mechanism, so this is
  belt-and-braces). Fallback if it ever doesn't: resolve the path in a Bash `echo` step first.
  Same run: confirm `/workflows` shows subagents on Fable 5 (and Opus on any opus-stamped task) —
  the model-tiering smoke check.
