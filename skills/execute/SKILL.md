---
name: execute
description: Use to execute a wave rollout — reads a rollout note at ~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md (legacy undated notes still resolve), resolves per-task config, and calls the Workflow tool with wave-execute.workflow.js to run the convergence engine (per-task plan-gate → Ralph-style verifier retry → master review, converging in parallel within each wave). In continuous mode (bare "execute [[rollout]]") it auto-merges each wave before launching the next — zero-touch, no per-PR confirmation — with --gated as the manual-merge escape hatch; the one designed exception is a task whose plan declares gated inputs (API spend / credentials / irreversible actions), which always pauses for human sign-off (ADR 0005, §3.7). Triggers on natural-language "execute Wave N of [[rollout-slug]]" or "execute [[rollout-slug]]" patterns, explicit /wave:execute invocation, or "pause the rollout" / "reinstate [[rollout]]" (safe pause: soft via pause_requested on the rollout note, hard via TaskStop + a paused: stamp; reinstate is plain re-invocation — see §Pausing). Only runs rollouts with protocol_version: 3; refuses older rollouts and prompts for regeneration via /wave:schedule --regenerate.
---

# /wave:execute — run a wave rollout on the Workflow engine

`/wave:execute` is the executor half of the wave split. Where `/wave:schedule` writes the rollout note (data), this skill reads it, resolves config, and hands the convergence work to a **dynamic Workflow** script. This skill is a thin shim; the engine lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js`.

The engine runs three layers per task — optional plan-gate (autonomous judge) → Ralph-style agent-side verifier retry → master-side review-and-revise loop — and converges tasks **in parallel within each wave** (a task can be in master-review while a wave-mate is still implementing). The skill itself stays in the conversation to do vault I/O, the protocol gate, status reconciliation, reporting, and the `--gated` between-wave pause (which an autonomous background workflow cannot do).

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` produced by `/wave:schedule` (older undated `<slug>-rollout` notes still resolve — see step 1). The Workflow's agents operate in isolated git worktrees they create under the target repo (`<repoPath>/.claude/worktrees/`) and open PRs. The lead session updates task frontmatter in the vault. Does not touch any other backlog source.

## Invocation forms

```
execute Wave 1 of [[giflab-rollout]]       # single wave — opens PRs, you merge
execute [[giflab-rollout]]                 # full rollout, CONTINUOUS AUTO-MERGE (zero-touch — the default)
/wave:execute Wave 1 of [[giflab-rollout]] # explicit, single wave
/wave:execute [[giflab-rollout]] --gated   # full rollout, MANUAL merge: pause between waves for you to merge
```

Bare `execute [[rollout]]` is **continuous auto-merge**: the lead session runs each wave, merges that
wave's approved PRs to `main`, then launches the next — no per-PR confirmation. `--gated` is the same
per-wave loop with a human merge pause instead, for when you want to eyeball PRs before they land.
Single-wave mode opens PRs and leaves merging to you.

## Skill flow

### 1. Read the rollout note

Resolve `[[<slug>]]` to `~/repos/obsidian/Work/Tasks/<slug>.md`. Read frontmatter + body.

The slug is whatever the invocation names. `/wave:schedule` writes rollout notes **always dated** — `<project-slug>-rollout-<YYYY-MM-DD>` for the first rollout of a day, or `<project-slug>-rollout-<YYYY-MM-DD>-<N>` (N≥2) for each subsequent rollout that same day (the first-of-day stays bare-date). Legacy notes from before this rule use the undated `<project-slug>-rollout`; execute still resolves them. The ordinal is purely `/wave:schedule`'s collision-avoidance scheme; execute reads the exact note it's handed and needs no special parsing. If the user names a rollout ambiguously (e.g. "execute today's giflab rollout") and several dated/ordinal notes match, **list the matches and ask which** — don't assume the highest ordinal.

If the frontmatter carries a `paused:` stamp, this invocation is a **reinstate** — see §4.5 *Reinstate* and *Pausing + reinstating a rollout* below.

### 2. Protocol-version gate

- Missing `protocol_version` **or** `protocol_version: 2` → print: "This rollout predates the Workflow engine. Regenerate it to run under the current contract: `/wave:schedule <project> --regenerate`." Stop. (The legacy prose executor has been retired — there is no in-conversation engine to fall back to.)
- `protocol_version` other than `3` → print "unsupported protocol version <N>; this executor supports protocol_version: 3" and stop.
- `protocol_version: 3` → proceed.

### 3. Resolve effective config per task

For each task in the target wave (or all waves in continuous mode), resolve, in order **task frontmatter → rollout frontmatter → hardcoded default**:

| Field | Default | Becomes (in args) |
|---|---|---|
| `verifier` | fail with a message asking the user to provide one | `verifier` (rollout-level) |
| `max_iterations` | `3` (or `1` if `scope: read-only`) | `task.maxIterations` |
| `max_review_rounds` | `4` | `task.maxReviewRounds` |
| `max_plan_rounds` | `3` | `task.maxPlanRounds` |
| `plan_approval` | `scope-gated` | drives `task.planGate` (see 3.5) |
| `parallel_ceiling` | `4` | `concurrency` (rollout-level) |
| `env_bootstrap` | none (omit) | `envBootstrap` (rollout-level) |
| `ignore_gate` | `false` (omit) | `task.ignoreGate` (per-task) |
| `model` | `opus` | `task.model` (per-task; `opus` \| `fable`) |
| `effort` | none (omit) | `task.effort` (per-task ONLY — the ADR 0004 escape hatch; it has no rollout-level form) |

`scope:` is read directly from each task's frontmatter (set by `/wave:schedule`). `completion_sentinel` is no longer used — the Workflow returns validated structured output instead of parsing sentinel strings.

`env_bootstrap` (rollout-level) is an optional shell command the engine runs once per worktree so agents start from a working interpreter + deps (e.g. `poetry env use 3.11 && poetry install`) — read it from the rollout frontmatter and pass it as `envBootstrap`; **omit the key when absent** so the worktree-setup prompt stays byte-identical (resume-cache invariant). `ignore_gate` (per-task) is an explicit override for a task note that carries a human/release gate in prose ("don't action until a release ships"); when `true`, pass `ignoreGate: true` on that task so the engine tells the agent the gate is overridden for this run — **omit/false** otherwise.

`model` resolves task frontmatter → rollout frontmatter → `opus` and sets the task's **starting tier**. Judges **follow the task's live tier**, so a `fable` task gets Fable review end-to-end. (A run can still pin all judges to one model via the `judgeModel` arg — it wins when set.)

**Effort bundles (ADR 0004).** A tier is a **(model, per-role effort) bundle**, not two knobs — reasoning effort rides the same ladder as the model. The per-role matrix is fixed in ONE place in the engine (`wave-execute.workflow.js`, the `EFFORT` constant):

| Role | `opus` tier | `fable` tier |
|---|---|---|
| planner / implementer (incl. revisers + read-only investigator) | medium | high |
| judges (plan + review) | high | high |
| master review (the PR-review judge — refines the judges row) | high | xhigh |
| mechanical reconcile stages | low | low |

Every `agent()` spawn site sets `effort` from the task's **live** tier + the agent's role, so escalation carries effort automatically — flipping a task to fable is one move that upgrades model AND effort, and judges follow (judges pinned via `judgeModel` take the pinned tier's row — model and effort always travel together). The **single escape hatch** is per-task `effort:` frontmatter (`low` \| `medium` \| `high` \| `xhigh` \| `max`): resolve it from the task note and pass it as `task.effort` — it overrides the planner/implementer effort for that task only, judges always keep the matrix, and it holds across an escalation (a monster task at fable/max stays at max). There is deliberately **no rollout-level effort config** (see ADR 0004's rejected options) — tuning the matrix means editing the engine, because the matrix encodes a stance (where effort is worth paying), not a per-rollout preference. The reconcile row is documented stance only today: reconcile is deterministic Python (`reconcile-wave.py`), so no agent consumes it.

**Model escalation (one-shot first pass).** An `opus` task gets exactly one un-iterated pass at each layer: one plan, one implementation with a **single** verifier run (the Ralph `max_iterations` budget does not apply to the first pass), one judged PR round. The first evidence of hardness anywhere — a plan-judge `changes` verdict, a first-pass planner/investigator block, a red one-shot verifier run, an implementer block, or a review-judge `changes` verdict — **escalates the task to `fable` for all remaining work**, judges included. Escalation is one-way, sticky, and happens inside the engine (no re-invocation): the fable agent inherits the prior attempt's worktree, committed work, and note diagnosis, and runs the full Ralph loop. A `fable` task (stepped up by `/wave:schedule` §4.7 or a rollout-level `model: fable`) never escalates — there is nothing above fable — and runs the full loop from the start, exactly as before. Escalation is **durable**: reconcile (§6) stamps `model: fable` on the task note, so resume / `/wave:repair` re-dispatches start at fable and never re-pay the opus toll. There is no config switch — escalation is always on for opus tasks.

### 3.5. Resolve the plan-gate per task → `task.planGate` (boolean)

- `plan_approval: off` → `planGate: false`
- `plan_approval: required` → `planGate: true`
- `plan_approval: scope-gated` → `planGate: true` iff `scope: cross-cutting`; `single-file` and `read-only` → `false`

(`/wave:schedule`'s gated-input sweep may have stamped `plan_approval: required` on tasks that smell of spend/credentials — that per-task frontmatter wins here as usual. It is advisory: it guarantees a plan-gate exists where the plan's own declaration can pause; the declaration itself is authoritative — §3.7.)

### 3.7. Gated inputs — the unconditional human stop (ADR 0005)

Every plan the engine's planner produces must carry a **`### Gated inputs`** section — API spend (with a **hard cap**), credentials, irreversible actions, or an explicit `None`. A missing section is a plan-judge `changes` (and the engine fails closed to `plan-blocked` if a judge ever approves one without it). After the plan-judge approves a plan, the engine compares the declared gates against the task's **approved gates** and, if any declared gate is not yet approved, returns the task at **`status: gate-pending`** without implementing — **regardless of `plan_approval` config or continuous mode**. Tasks with no plan-gate are covered by the same rule reactively: every code-writing prompt carries a stop rule, so an implementer that finds an undeclared/unapproved gated input stops *before* the gated action and returns it in `gatedInputs`, which the engine converts to the same `gate-pending` stop. A gate stop is a human decision, not evidence of hardness — it never escalates an opus task.

**Resolve `task.approvedGates` when building args (step 4):** read the task note's `## Approved gates` section; each bullet, with its `(approved …)` annotation stripped, becomes one entry. Omit the key when the note has no such section. The engine skips the stop for exactly these gates (whitespace/case-insensitive match; **a changed cap is a NEW gate**). The approval is durable on the note, so re-dispatches and resumes never re-ask.

**Sign-off flow (the pause continuous mode makes for gated tasks):** reconcile (§6) writes the declared gates under `## Gated inputs (awaiting sign-off)` and sets `status: gate-pending`. Present each gate **verbatim** to the user and ask for sign-off — this pause is **designed** (ADR 0005), not a failure. On sign-off run:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py approve-gates --tasks <slugA,slugB>
```

(moves the pending gates to `## Approved gates` with the sign-off date — gate + cap + sign-off — and flips the note to `in_progress`), then re-dispatch exactly those tasks (per-task resume within the wave). If the user declines a gate, defer the task or leave it — the wave then follows the normal incomplete-wave rules. If nobody is present to sign off, end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="gated inputs await sign-off: [[task]]"`. `resume-filter` **excludes** `gate-pending` notes, so no unattended re-entry (heartbeat included) can bypass or spam a pending gate — only `approve-gates`, run after an explicit human sign-off, makes the task dispatchable again. The approved cap is a **ceiling** the implementer must respect; blowing it is a verifier/review failure, not a re-ask.

### 4. Stamp in-progress + build args

Before launching, for each task in scope: stamp `status: in_progress` and `owner: <session-tag>` on the task's frontmatter (blocks duplicate dispatches). Keep this in the lead session — subagents never write task `status:`. In the launch message, **flag any task expected to gate** (a `plan_approval: required` stamped by `/wave:schedule`'s gated-input sweep, or a note that smells of spend/credentials) so the eventual `gate-pending` pause is expected, not a surprise (§3.7).

Build the `args` object the workflow expects:

```jsonc
{
  "rolloutSlug": "giflab-rollout",
  "repoPath": "/abs/path/to/repo",      // from the rollout's "Project root" line
  "verifier": "make test",               // resolved rollout-level verifier
  "date": "2026-05-29",                  // pass it in — Date.now() is unavailable in the script
  "concurrency": 4,                       // parallel_ceiling
  "knownBaselineFailures": [              // from the "## Known baseline failures" block; omit when none
    "test_color_reducer_functionality — ImageMagick 0-byte output (pre-existing, env)"
  ],
  "envBootstrap": "poetry env use 3.11 && poetry install",  // from rollout `env_bootstrap:`; OMIT when absent
  "progress": "wave 1/4 dispatched — 0m elapsed",  // optional; mark-dispatched's progress line (§4.5 step 1) —
                                                   //   the engine log()s it verbatim (its sandbox has no clock);
                                                   //   OMIT when mark-dispatched printed none
  "waves": [
    { "wave": 1, "tasks": [
      { "slug": "giflab-fix-x", "taskPath": "/abs/.../giflab-fix-x.md",
        "scope": "single-file", "planGate": false,
        "maxIterations": 3, "maxReviewRounds": 4, "maxPlanRounds": 2,
        "ignoreGate": false,                 // per-task; omit/false unless overriding a human/release gate
        "model": "opus",                     // per-task STARTING tier; "fable" when wave:schedule stepped a
                                             //   hard task up. The engine may escalate opus→fable mid-run.
        "effort": "max" }                    // per-task ONLY, from the task note's `effort:` frontmatter —
                                             //   OMIT when absent. Overrides the tier bundle's planner/
                                             //   implementer effort; judges keep the matrix (ADR 0004).
    ]}
  ]
}
```

Also read the rollout note's **`## Known baseline failures`** block (`/wave:schedule` step 2.6): when it lists tests (not `none`/empty), pass them as `knownBaselineFailures: ["<test_id> — <reason>", …]`. The engine threads the manifest into every agent and shifts the Ralph green criterion to "no NEW failures beyond this set" — it keeps running the full verifier and never `--deselect`s the listed reds (per the project's `CLAUDE.md`: a comparison reference, not a mute button). Omit the key when the block is absent or `none` — the engine then behaves exactly as before (`verifier` exit 0 = pass).

- **Single-wave mode** (`execute Wave N of [[rollout]]`) → include only wave N in `waves`. Opens PRs; the user merges. No auto-merge. The tasks therefore end the session at `status: review` — once the user confirms the merges (or a later invocation finds the PRs merged in pre-flight), run `reconcile-wave.py mark-done` on them so they don't linger as false "awaiting acceptance" items.
- **Continuous auto-merge mode** (`execute [[rollout]]`, no wave number, no flag — the DEFAULT) → do **not** pass all waves at once. Drive the rollout **one wave per Workflow call** across turns, auto-merging each wave before launching the next. This is the zero-touch path — see §4.5.
- **`--gated`** → the **same** one-wave-per-call loop as continuous, but the between-wave step is a **human merge pause** instead of the auto-merge: run wave N, present its report, wait for the user to merge + re-invoke, then call wave N+1. The escape hatch for eyeballing PRs before they land.

> Correctness between waves comes from the **auto-merge + `origin/main` worktree base** (§4.5), not from a completion barrier. The old engine ran all waves against one frozen `main`, which silently re-created the #30/#31 squash-drop exposure for any rollout whose same-file tasks span waves. The per-wave loop fixes that.

### 4.5. Continuous auto-merge — the per-wave loop

In continuous mode the lead session is the conductor: run ONE wave on the engine, merge that wave, then launch the next. The merge — not a human, not a completion barrier — is what makes "earlier same-file work lands before the next wave branches" real. The loop is driven across turns by Workflow-completion notifications and is resumable via a durable cursor.

**Durable cursor.** Track progress in the rollout note frontmatter: `merged_through_wave: <N>` (`0` or absent = nothing merged yet). This is the single source of truth for "where was I" — a fresh session resumes from it, never from a GitHub/vault re-scan. New rollouts seed it at `0`; an older rollout without the field is treated as `0` (start at wave 1).

**Per wave K** (K = `merged_through_wave` + 1):

1. Resolve config + stamp `status: in_progress` for wave K's tasks (step 4). Stamp the wave's **dispatch boundary** on the rollout note — the engine's sandbox has no clock, so wall-clock enters here:
   ```
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py mark-dispatched --rollout <rollout-note> --wave K
   ```
   (writes `wave_K_dispatched: <timestamp>`; idempotent — **first dispatch wins**, so a resume re-dispatch never resets the wave clock). It prints a `progress:` line — "wave K/N dispatched — 42m elapsed, ~50m remaining (rough)" — surface it to the user and pass its text as the args `progress` string so the engine `log()`s it live in `/workflows`. Then build args with `waves: [waveK]` only; call the Workflow (step 5).
2. On completion → reconcile vault frontmatter (step 6).
3. **Auto-merge wave K.** Collect the wave's tasks that returned `status: review` **and** have a non-empty `pr` (read-only tasks have none; **never** merge `review-blocked` / `blocked` / `plan-blocked` / `gate-pending`), in the report's recommended order. Run:
   ```
   ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/merge-wave.sh <repoPath> <pr> <pr> …
   ```
   - **The sentinel is authoritative, not the reported exit.** On exit the script writes `<repoPath>/.claude/merge-wave.status` — `ok` only on a clean merge, `failed:<code>` on any halt. If the run is backgrounded, a trailing-command wrapper (`… & wait; echo done`) can mask the script's real exit — so **read the sentinel file**, not the reported exit code. Treat anything other than a file containing exactly `ok` — **including a missing file** — as a halt.
   - **sentinel ≠ `ok` → HALT the rollout.** Surface the script's message verbatim (which PR, why, the exact next step) and stop. Do **not** advance the cursor or launch the next wave.
   - **sentinel `ok` → advance the cursor to `merged_through_wave: K`** via the helper (not a hand-edit):
     `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py cursor --rollout <rollout-note> --wave K`
     The cursor step also stamps the **merge boundary** (`wave_K_merged: <timestamp>`, first merge wins) and prints a `progress:` line — "wave K/N merged — 1h 24m elapsed, ~50m remaining (rough)" — include it in the wave report. The estimate is in-rollout arithmetic only (average task convergence from this rollout's completed waves × remaining ÷ ceiling), **always labelled rough (~)** — never restate it with false precision; before any wave completes it shows elapsed only (no basis yet), and on the final wave it prints the total instead ("rollout complete in 2h 10m").
   - **…then flip the wave's landed tasks to `done`** (same helper):
     `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py mark-done --tasks <slugA,slugB,…>`
     Pass **every wave-K task that ended at `status: review`** — both the just-merged PR tasks (the merge IS the confirmation a `review` note was waiting for) and the wave's read-only tasks (no PR to merge; their master-review approval was their confirmation, and the wave completing is when that becomes final). Idempotent; the helper refuses any note not at `review`/`done`, so a blocked task can never be swept along. Without this flip, landed tasks pile up at `review` as false "awaiting acceptance" items — seven had accumulated by 2026-06-12.
   - **Soft-pause check (rides the cursor step — zero extra calls).** The `cursor` helper honours a `pause_requested: true` flag on the rollout note: it stamps `paused: <timestamp>`, clears the flag, and prints a `paused=` line alongside the cursor advance. When that line appears, the user asked for a soft pause — do **NOT** launch wave K+1. Print a short paused report (what merged this wave, what's left) and end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="paused at user request"`. The Stop-hook driver releases on `halted`, and the heartbeat cron deletes itself on its next tick — on this `halted` line, or on the `paused:` stamp its prompt checks ahead of the stall diagnosis (§5), which is what keeps "nothing auto-resumes a paused rollout" true for a hard pause too (a hard pause never emits `halted`; its runbook also deletes the cron outright). Reinstate is plain `/wave:execute [[rollout]]` — see *Pausing + reinstating a rollout* below.
4. **Smart-halt check** before launching K+1: if any wave-K task did **not** land (`blocked` / `review-blocked` / `plan-blocked` / `gate-pending`) **and** its file-set (from the rollout note's `## File-sets` block) intersects the union of any later wave's file-sets → **HALT** with a clear report (e.g. "wave K left [[task]] unlanded; wave M edits the same file `<f>` — continuing would branch it from a main missing the fix"). The user fixes the blocker and re-invokes. Otherwise, **honour any pending pause before launching K+1**: a partially-landed wave never runs step 3's cursor advance (*Per-task resume within a wave* below), so a `pause_requested: true` still sitting on the rollout note has NOT been honoured yet — check the note, and if the flag is pending, re-run `reconcile-wave.py cursor --rollout <rollout-note> --wave <current merged_through_wave>` (cursor-idempotent — re-setting the same value changes nothing — while performing the stamp + clear + `paused=` signal) and exit exactly as the step-3 *Soft-pause check* does: no wave K+1, paused report, `WAVE-STATUS: <slug> cursor=<merged_through_wave>/<N> state=halted reason="paused at user request"`. With no pending pause, launch wave K+1 (its worktrees branch from the freshly-merged `origin/main`).
5. Repeat until the last wave merges, then **perform the completion ceremony** (don't just point the user at the checklist):
   - Sweep the rollout's task notes: every task should already read `status: done` (step 3's `mark-done` flips them wave by wave). Flip any straggler still at `review` whose PR is verifiably merged (`mark-done` again); a straggler at any *other* status means the rollout isn't actually complete — stop and say so.
   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter.
   - File any follow-on work the rollout's Post-rollout section names (validation re-runs, audits, deferred items) as **new open tasks** in `Work/Tasks/`, and rewrite those items in the rollout note as thin pointers to the new tasks.
   - Append a `## Completion log` to the rollout note: dispatch dates, waves → PRs (links + merge dates), convergence stats per task, **total duration + a per-wave duration breakdown** (read the `timeline` block from `reconcile-wave.py status --rollout <rollout-note>` — it's computed from the `wave_N_dispatched`/`wave_N_merged` stamps), and the disposition of each post-rollout item.
   - Close out the associated thread (see `~/.claude/skills/thread/SKILL.md`) — or record in the log why it stays open.
   - Delete the rollout's `WAVE-HEARTBEAT` cron if one is registered (`CronList` → `CronDelete`); the heartbeat also self-deletes on its next tick, but don't leave it ticking for up to 20 minutes against a finished rollout.
   - Move the rollout note to `Work/Tasks/Archive/Rollouts/` (`git mv` in the vault) and commit the vault. Wikilinks resolve by filename, so `[[<slug>]]` references and task `rollout:` backlinks survive the move.

   A done rollout left sitting in `Work/Tasks/` is invisible-but-present — every Bases view filters `status != done`, so it vanishes from view with no record of what happened. The ceremony is what makes completion legible weeks later.

**Cold resume.** Re-invoking `execute [[rollout]]` when `merged_through_wave: N` is set: first re-run `merge-wave.sh` against wave N+1's already-open PRs (idempotent — merged PRs are skipped, so this flushes any half-merged wave), `mark-done` the tasks whose PRs are now confirmed merged, then continue the loop.

**Reinstate (resuming a paused rollout).** If the rollout note carries a `paused:` stamp, this invocation IS the reinstate — clear the stamp first, deterministically:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py clear-pause --rollout <rollout-note>
```

then continue the normal cold resume above (flush any half-merged wave, `resume-filter`, re-dispatch whatever didn't land). There is no separate resume command. `clear-pause` also removes any still-pending `pause_requested` (the hard-pause-before-honour edge) so a freshly reinstated rollout doesn't immediately re-pause. **Only trigger it on a `paused:` stamp** — a pending `pause_requested` with no stamp is a live user request that must survive resumes (including the heartbeat cron's re-entry) and takes effect at the next wave boundary.

**Per-task resume within a wave (finding #7).** A wave that returned one approved + one blocked task merges the approved PR but can't advance the cursor (the wave is incomplete). On resume, dispatch only the tasks in that wave whose note status is **not already landed/approved** — the task-note `status:` is the source of truth, not the cursor. Compute the still-to-dispatch set deterministically rather than re-dispatching the whole wave (which would re-run already-merged work):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py resume-filter --tasks slugA,slugB,slugC
#   prints the subset whose status ∉ {done, review, merged} — build args from exactly those.
#   gate-pending notes are ALSO excluded (with a stderr WARN): they await a human sign-off, not a
#   dispatch — approve-gates makes them dispatchable again (§3.7).
```

**No `## File-sets` block?** (an older rollout) the precise smart-halt can't run — fall back to the **coarse** rule: any unlanded task + any later wave ⇒ HALT. Tell the user to `/wave:schedule --regenerate` for precise halting.

### 5. Call the Workflow

This skill instruction is the sanctioned opt-in for the Workflow tool — call it directly:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js",
  args: <the args object above>,
})
```

Pass `args` as an actual JSON object in the tool call. (Note: the Workflow tool delivers `args` to a `scriptPath` workflow JSON-**stringified** — confirmed by smoke test — so the engine parses it defensively with `typeof args === 'string' ? JSON.parse(args) : args`. Don't remove that parse thinking it's redundant.)

Tell the user the run launched, which waves/tasks it covers, and that they can watch live with `/workflows`. Record the returned `runId` — if the run dies, resume with `Workflow({ scriptPath, args, resumeFromRunId: <runId> })` (unchanged `agent()` calls replay from cache).

**Register the heartbeat (continuous mode, once per rollout).** In the same turn as the first wave launch, check `CronList` for an existing `WAVE-HEARTBEAT <rollout-slug>` task; if none, register one via `CronCreate` (schedule `*/20 * * * *`) with this prompt:

> WAVE-HEARTBEAT <rollout-slug>: Read the last WAVE-STATUS line for this rollout in the conversation. If state=done or state=halted (or the rollout note is archived), find this cron via CronList and CronDelete it, then stop. If the rollout note's frontmatter carries a `paused:` stamp, the rollout is deliberately paused — a hard pause emits no halted line, so check the note BEFORE any stall diagnosis: CronDelete this cron and stop; never resume a paused rollout. If a Workflow run for the rollout is still visibly running in /workflows, do nothing — end the turn silently. Otherwise the rollout has stalled (no run in flight, waves remain): re-enter /wave:execute [[<rollout-slug>]] §4.5 resume from the cursor.

This is the backstop for a hung Workflow run or a missed completion notification — the stall mode nothing else catches. Then **end the launch turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=waiting`** so the Stop-hook driver (§8) lets the session idle until the notification arrives.

### 6. Reconcile + report

The workflow returns `{ rolloutSlug, tasks: [{ slug, scope, status, prUrl, branch, worktreePath, reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, summary, model, escalated, escalatedAt, gatedInputs }] }` where `status ∈ review | review-blocked | blocked | plan-blocked | gate-pending`, `model` is the FINAL tier the task ran on, `escalated`/`escalatedAt` (`plan` | `implement` | `review`) record an opus→fable escalation, and `gatedInputs` lists the declared-but-unapproved gates when the task paused at `gate-pending` (§3.7).

**Reconcile with the deterministic helper — do NOT hand-edit frontmatter.** Write the returned object to a temp file (or pipe it on stdin) and run:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py reconcile --result /tmp/wave-result.json
#   --result -   reads the JSON from stdin instead
```

The helper resolves each task note by slug under `~/repos/obsidian/Work/Tasks/` and performs every per-task write the old hand-edit loop did — **idempotently**, so it's safe to re-run on resume. Per returned `status`:
- `review` → `status: review`, `pr: <url>`, `review_rounds_used: <n>` (and `plan_rounds_used: <n>` when the task was plan-gated)
- `review-blocked` → `status: review-blocked`, `pr: <url>`; appends `reviewFeedback` under `## Review-blocked feedback`
- `blocked` → `status: blocked`; appends `blockerDiagnosis` under `## Blocker diagnosis` (skipped if the agent already wrote it)
- `plan-blocked` → `status: plan-blocked`; appends the accumulated plan feedback under `## Plan-blocked feedback`
- `gate-pending` → `status: gate-pending`; **upserts** the declared gates under `## Gated inputs (awaiting sign-off)` (upsert, not append — the pending list always reflects the latest declaration)
- any status with `escalated: true` → additionally stamps `model: fable` (durable escalation — later re-dispatches start at fable)

(This replaces ~5 fumble-prone frontmatter edits per wave — finding #6. The lead session still owns the call; subagents never write task `status:`.)

Then print the finalisation report:

```
Wave N report for [[<rollout-slug>]]

Approved clean (1 round):
- [[task-a]] — PR <url>

Approved after revision:
- [[task-c]] — 2 rounds — PR <url>

Approved after plan revision:
- [[task-g]] — plan_rounds_used = 2 — PR <url>

Approved after escalation (opus → fable):
- [[task-i]] — escalated at implement — PR <url>

Review-blocked (max rounds reached):
- [[task-e]] — PR <url> — see "## Review-blocked feedback"

Plan-blocked (no PR opened):
- [[task-h]] — see "## Plan-blocked feedback"

Ralph-blocked (no PR opened):
- [[task-f]] — see "## Blocker diagnosis"

Gate-pending (awaiting YOUR sign-off — a declared gate always pauses, ADR 0005):
- [[task-j]] — declared: spend: Replicate API — cap USD 30
  → sign off, then: reconcile-wave.py approve-gates --tasks task-j; re-dispatch via resume-filter

Recommended merge order: <list>
```

**End every execute turn with the machine-readable status line** (after the report, or alone on turns that only reconcile/merge/resume):

```
WAVE-STATUS: <rollout-slug> cursor=<K>/<N> state=<running|waiting|halted|done>[ reason="<short halt reason>"]
```

- `running` — in-session driving work remains **right now** (a wave returned and needs reconcile/merge; the next wave needs launching). The plugin's Stop-hook driver (§8) refuses to let the session stop on this state — so never end a turn on `running` unless you genuinely stopped mid-work.
- `waiting` — a wave's Workflow call is in flight; nothing to do until its completion notification (the heartbeat cron is the backstop). Emit this after launching a wave.
- `halted` — a §7 stop condition fired, `--gated` is waiting on the user, or a requested pause took effect (*Pausing + reinstating a rollout*) — always include `reason=`.
- `done` — completion ceremony performed.

This line is the contract the automatic driver (§8) keys off — the Stop hook parses it with a strict regex, so keep the format byte-stable.

**Merging:** in `--gated` / single-wave mode, do NOT merge — the user decides. In continuous auto-merge mode the lead session merges this wave via `scripts/merge-wave.sh` (§4.5) — never an inline `gh pr merge`. Within a wave the approved PRs are file-disjoint (the wave invariant), so they don't conflict with each other; the merge script brings each up to date with `main` in turn before squash-merging.

The merge gate is the repo's **required** checks — branch-protection's own definition of mergeable — **not** GitHub's cosmetic `CLEAN` (which also waits on non-required checks). A `main` that legitimately carries red *non-required* checks reports every PR as `UNSTABLE`, never `CLEAN`; gating on `CLEAN` would merge no wave at all. `merge-wave.sh`'s `UNSTABLE)` case handles this by waiting on `--required` checks only — a genuinely-failing required check surfaces as `BLOCKED`, not `UNSTABLE`, so it stays safe. Don't "tidy" it back to `CLEAN`-only (see `giflab-rollout-merge-wave-unstable-fix`).

### 7. Continuous-mode stop conditions

Continuous mode is the per-wave loop (§4.5), not one engine call. It **HALTS automatically** — surface the reason prominently, leave everything merged-so-far landed, end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="…"` (§6) so the automatic driver releases (§8), and stop — when:

- a wave produces **zero** approved (`status: review`) PRs (nothing to merge; downstream presumptively unsafe), or
- `merge-wave.sh` exits non-zero (a real merge conflict or red required check), or
- the smart-halt check fires (an unlanded task's file reappears in a later wave), or
- a wave leaves `gate-pending` tasks and nobody is present to sign off (`reason="gated inputs await sign-off: …"` — a **designed** pause, ADR 0005, not a failure: the user signs off, `approve-gates` runs, and re-invocation resumes; when the user IS present, ask for the sign-off in-conversation instead of halting — §3.7).

A **soft pause** (*Pausing + reinstating a rollout* below) exits through the same `state=halted` mechanics but is **deliberate**, not a failure — there is no cause to fix, and reinstating is plain re-invocation.

In every halt case the work merged so far stays on `main`; the user fixes the cause and re-invokes `execute [[rollout]]` to resume from the `merged_through_wave` cursor. To see *why* a rollout halted, run `/wave:status [[rollout]]` (read-only situational report). To **sort out** a stalled rollout without ceding merge authority, run `/wave:repair [[rollout]]` — it reconciles drift, re-dispatches agent-fixable blocks, captures input-gated decisions, defers wedged tasks, and resumes via this skill's §4.5 loop (`merge-wave.sh` stays the sole merger). `/wave:repair` is the systematised replacement for hand-repairing a worktree in an external cockpit (README → *Coexistence with Orca*).

### 8. Unattended driving — the automatic driver

The §4.5 loop is driven across turns by Workflow-completion notifications — nothing in the notifications themselves *enforces* that it keeps going. The plugin closes that gap with two self-managing pieces; **the user types nothing**:

**The Stop-hook driver** (`hooks/wave-stop-driver.py`, wired via the plugin's `hooks.json`). On every session stop it reads the last `WAVE-STATUS` line (§6) and, while `state=running`, **blocks the stop** and hands back the exact next step (reconcile → merge → advance cursor → launch next wave). It releases on `waiting` (a Workflow run is legitimately in flight), `halted` (§7 — human's turn), and `done`. It is progress-aware: three consecutive blocks without the cursor advancing release the stop and surface "likely wedged — run /wave:status or /wave:repair" instead of spinning forever. This is the programmatic twin of a `/goal` condition, shipped so nobody has to remember to set one.

**The heartbeat cron** (registered by step 5 at first wave launch, `*/20 * * * *`). Catches the one stall the Stop hook can't see: a hung Workflow run or missed completion notification while the session idles at `state=waiting`. Each tick checks; if nothing needs doing it ends silently; if the rollout stalled it re-enters §4.5 cold resume (idempotent — cursor + `resume-filter` + merge-wave.sh's merged-PR skip make re-entry duplicate-free); it deletes itself once the rollout is done, halted, or paused (its prompt checks the rollout note's `paused:` stamp before diagnosing a stall — a hard pause emits no `halted` line, and "stalled" must never re-dispatch a wave the user deliberately stopped).

Division of labour: **Stop hook** = "don't stop while there's driving work"; **heartbeat** = "wake up if the thing you were waiting for never arrives"; **§7 HALTs** = the deliberate exits both respect.

**Manual fallbacks** (when the plugin's hooks are disabled, or driving from an environment without them):

- `/goal The WAVE-STATUS line for <rollout-slug> reports state=done or state=halted, or stop after 4 hours` — transcript-only evaluator, auto-continues a stopped session; always include the time/turn bound and the `state=halted` release clause. Note it will also bounce `state=waiting` turns, so expect some no-op continuations while a wave runs.
- `/loop 45m /wave:status [[<rollout>]]` — read-only watchdog for drift and stranded-`review` tasks (the failure mode that let seven landed tasks sit unnoticed in the giflab rollout); stop it (`/loop stop`) once the rollout archives.

**Guardrails + limits:**

- **Everything here is session-scoped.** The Stop hook and heartbeat cron only act while the session is alive; a closed terminal stops them all (they resume with `claude --resume`). True detachment is a `/schedule` cloud routine — out of wave's scope.
- **Never automate `/wave:repair`** — it is input-gated by design (it asks the user decisions no agent can make); the driver, the heartbeat, and any loop must route a wedged rollout *to* repair, never *through* it.
- **`--gated` mode is exempt from unattended driving** — the per-wave human merge pause is the point. In gated mode end merge-pause turns with `state=halted reason="gated: awaiting user merge"` so the Stop hook releases.
- **A §7 HALT ends unattended driving.** Emit `state=halted` with the reason — the Stop hook releases, the heartbeat self-deletes on its next tick, and a well-worded `/goal` fallback releases on the clause.
- **What none of this fixes:** the blocking waits *inside* single tool calls — the Workflow call (~1h worst case per stubborn task, §Resource budget) and `merge-wave.sh`'s serial required-checks watching — are untouched by any driver.
- **Skill invocation under /loop (fallbacks):** slash-command payloads are invoked normally (`/loop 5m /babysit-prs` is the built-in's own example). The only frontmatter that breaks this is `disable-model-invocation: true` — never add it to `execute` or `status`. (There is no `autonomous:` frontmatter key; that's a myth — verified against the 2.1.199 binary.)
- Cloud providers (Bedrock/Vertex) downgrade dynamic `/loop` to a fixed ~10-minute cadence.

## Pausing + reinstating a rollout

"Pause the rollout" means **soft pause** by default; **hard pause** only when it must stop *now*. Either way the pause is recorded on the rollout note, and reinstating is plain `/wave:execute [[rollout]]` — no separate resume command, no new state machine. (Terms: `CONTEXT.md` → *Pause*, *Reinstate*.)

**Soft pause (default).** Stamp `pause_requested: true` on the rollout note's frontmatter (a lead-session edit — it's rollout config, not task status). Nothing is interrupted: the in-flight wave finishes, merges, and advances the cursor as normal; the end-of-wave `cursor` helper then honours the flag — stamps `paused: <timestamp>`, clears `pause_requested` — and the loop exits with `state=halted reason="paused at user request"` instead of launching the next wave (§4.5 step 3, *Soft-pause check*; a partially-landed wave skips step 3's cursor advance, so step 4 honours the still-pending flag before any K+1 launch instead). Zero extra agent calls; the pause lands on a clean wave boundary. To cancel a pending request before it takes effect, remove the `pause_requested:` line (or run `clear-pause`).

**Hard pause (urgent).** Stop the run now — in-flight agents die, but their worktrees keep all committed (and any uncommitted) work. This is a documented protocol, not engine code:

1. Find the rollout's active Workflow run (`/workflows`, or the task list) and **TaskStop** it.
2. Stamp the rollout note by hand: `paused: <timestamp>` in frontmatter, plus a short `## Pause log` body entry with the `runId` and which wave/tasks were in flight — the context the stamp alone can't carry.
3. Delete the rollout's `WAVE-HEARTBEAT` cron (`CronList` → `CronDelete`), mirroring the completion-ceremony step (§4.5). A hard pause emits no `state=halted` line, so the last WAVE-STATUS still reads `waiting` — a live heartbeat would diagnose "stalled" on its next ≤20-min tick and re-dispatch the wave you just killed. The heartbeat prompt's own paused-stamp check (§5) is the backstop if this step is missed, but delete the cron anyway rather than leaning on it.

The killed wave's tasks simply didn't land: their notes still read `in_progress`, so `resume-filter` re-dispatches them on reinstate, and the engine's worktree setup reuses each task's existing worktree + branch (resume-safe by design). Losses are bounded to in-flight agent context — committed work, and uncommitted files sitting in the worktrees, survive.

**Reinstate.** `/wave:execute [[rollout]]`. The resume path (§4.5 *Reinstate*) sees the `paused:` stamp, clears it via `reconcile-wave.py clear-pause`, and continues from the cursor — flush any half-merged wave, re-dispatch whatever didn't land. The heartbeat cron re-registers at the next wave launch (§5; the paused rollout's old one is already gone — self-deleted on the soft pause's `halted` line or on its prompt's paused-stamp check, or deleted directly by hard-pause step 3 — so a pause is never auto-resumed by a leftover tick).

A paused rollout is **intentional**, not stalled: `/wave:status` reports it as paused (stamp + since-when + what's left), and `/wave:repair` treats it as nothing-to-fix.

## Don'ts

- Merge ONLY via `scripts/merge-wave.sh`, ONLY in continuous auto-merge mode, ONLY from the lead session. In `--gated` / single-wave mode the user merges. Never an inline `gh pr merge`, never `--admin` (it would bypass branch protection and merge a red branch), never a force-push — ever. The engine (`wave-execute.workflow.js`) never merges.
- Don't skip the protocol-version gate. Legacy (v2 / absent) rollouts must be regenerated, not retrofitted.
- Don't update a task's `status:` from inside a subagent — the lead session reconciles after the workflow returns.
- Don't hand-roll the convergence loop in the conversation — that engine moved into `wave-execute.workflow.js`. If the loop needs changing, edit the script and (for an interrupted run) re-invoke with `resumeFromRunId`.
- Don't raise `concurrency` blindly. The Workflow's own cap is CPU-core-based (~14 on the M3) — higher than the memory-safe ceiling for heavy-model tasks (LPIPS ≈ 500 MB/process). `parallel_ceiling: 4` exists to chunk heavy waves so no more than 4 worktrees run at once. Raise it only for light waves.

## Worktree lifecycle (how the engine isolates + reuses worktrees)

Each **code-writing** agent (implementer / approved-plan implementer) creates its own worktree explicitly as its first action — fetching origin and branching a **fresh** worktree from `origin/main` (`git -C <repoPath> fetch origin && git -C <repoPath> worktree add <repoPath>/.claude/worktrees/<slug> -b audit-fix/<alias> origin/main`) so it includes every prior wave that has already merged — and returns its absolute path (`git rev-parse --show-toplevel`) in the structured result. Downstream revisers `cd` into that threaded `worktreePath` to reuse the same worktree (push to the existing branch, the PR auto-updates). The setup step is resume-safe: it reuses the dir if it already exists and attaches an existing branch rather than failing.

**Why explicit, not `isolation: "worktree"`:** the harness's `isolation: "worktree"` worktrees the *session's* git root, not the target repo — from an ops/vault session it would grab `~/repos/workspaces` (the wrong repo) and ignore `repoPath` (verified empirically). Anchoring on `repoPath` makes the engine correct **from any launch location** (vault, ops, or the repo itself) and places worktrees under the target repo where the daily reaper finds them. The plan-gate's planner and the read-only investigator write no code, so they investigate read-only against the main checkout and open no worktree.

**Cleanup** is the daily sweep's worktree reaper (`_shared/scripts/daily-sweep.sh` → `prune_worktrees`), which removes orphaned worktrees + branches under any `~/repos/**/.claude/worktrees/` once they're clean and merged. The engine does not clean up after itself. (If a target repo ever lives outside `~/repos`, widen the reaper's `find` root.)

## Protocol versions

| Version | Contract | Status |
|---|---|---|
| (absent) / 2 | Legacy in-conversation playbook (prose-driven dispatch + sentinel parsing) | Retired — regenerate via `/wave:schedule --regenerate` |
| 3 | Workflow-engine convergence (`wave-execute.workflow.js`): structured output, in-pipeline parallel review, autonomous plan-gate judge, journaled resume | Current |

Future protocol bumps follow the same rule: a new executor refuses older versions and asks the user to regenerate.

## Resource budget

The engine chunks each wave by `parallel_ceiling` (default 4) so heavy-model waves never run more than that many worktrees concurrently. Convergence multiplies wall-clock, not memory: worst-case per task is roughly `max_iterations × verifier-time × max_review_rounds`. With defaults (3 × 5 min × 4) one stubborn task can occupy a worktree ~an hour. For waves dominated by cross-cutting long-verifier tasks, lower `max_review_rounds` in the rollout frontmatter.

Escalation shifts that arithmetic for `opus` tasks: the opus first pass costs at most one implementation + **one** verifier run, and only an escalated task pays the full fable convergence bill on top (`1 × verifier` + fable's `max_iterations × verifier × max_review_rounds`). Mechanical tasks that land first-shot get cheaper than the old always-iterate profile; proven-hard tasks cost one extra opus pass over pre-stamping them fable.

**Continuous auto-merge adds serial merge time per wave.** Merges into a `strict`-protected `main` can't be parallelised — each merge advances `main`, so the next PR must re-update its branch and re-pass its required checks. Budget ≈ (update-branch + required-checks runtime + squash) per approved PR, **sequentially** — new wall-clock the old "human merges later" path didn't charge to the run.
