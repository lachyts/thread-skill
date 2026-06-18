---
name: execute
description: Use to execute a wave rollout — reads a rollout note at ~/repos/obsidian/Work/Tasks/<slug>-rollout.md, resolves per-task config, and calls the Workflow tool with wave-execute.workflow.js to run the convergence engine (per-task plan-gate → Ralph-style verifier retry → master review, converging in parallel within each wave). In continuous mode (bare "execute [[rollout]]") it auto-merges each wave before launching the next — zero-touch, no per-PR confirmation — with --gated as the manual-merge escape hatch. Triggers on natural-language "execute Wave N of [[rollout-slug]]" or "execute [[rollout-slug]]" patterns, or explicit /wave:execute invocation. Only runs rollouts with protocol_version: 3; refuses older rollouts and prompts for regeneration via /wave:plan --regenerate.
---

# /wave:execute — run a wave rollout on the Workflow engine

`/wave:execute` is the executor half of the wave split. Where `/wave:plan` writes the rollout note (data), this skill reads it, resolves config, and hands the convergence work to a **dynamic Workflow** script. This skill is a thin shim; the engine lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js`.

The engine runs three layers per task — optional plan-gate (autonomous judge) → Ralph-style agent-side verifier retry → master-side review-and-revise loop — and converges tasks **in parallel within each wave** (a task can be in master-review while a wave-mate is still implementing). The skill itself stays in the conversation to do vault I/O, the protocol gate, status reconciliation, reporting, and the `--gated` between-wave pause (which an autonomous background workflow cannot do).

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout.md` produced by `/wave:plan`. The Workflow's agents operate in isolated git worktrees they create under the target repo (`<repoPath>/.claude/worktrees/`) and open PRs. The lead session updates task frontmatter in the vault. Does not touch any other backlog source.

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

The slug is whatever the invocation names. `/wave:plan` writes rollout notes as `<project-slug>-rollout` (the original, undated), `<project-slug>-rollout-<YYYY-MM-DD>` (first rollout of a day), or `<project-slug>-rollout-<YYYY-MM-DD>-<N>` (N≥2, each subsequent rollout that same day — the first-of-day stays bare-date). The ordinal is purely `/wave:plan`'s collision-avoidance scheme; execute reads the exact note it's handed and needs no special parsing. If the user names a rollout ambiguously (e.g. "execute today's giflab rollout") and several dated/ordinal notes match, **list the matches and ask which** — don't assume the highest ordinal.

### 2. Protocol-version gate

- Missing `protocol_version` **or** `protocol_version: 2` → print: "This rollout predates the Workflow engine. Regenerate it to run under the current contract: `/wave:plan <project> --regenerate`." Stop. (The legacy prose executor has been retired — there is no in-conversation engine to fall back to.)
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
| `model` | `fable` | `task.model` (per-task; `fable` \| `opus`) |

`scope:` is read directly from each task's frontmatter (set by `/wave:plan`). `completion_sentinel` is no longer used — the Workflow returns validated structured output instead of parsing sentinel strings.

`env_bootstrap` (rollout-level) is an optional shell command the engine runs once per worktree so agents start from a working interpreter + deps (e.g. `poetry env use 3.11 && poetry install`) — read it from the rollout frontmatter and pass it as `envBootstrap`; **omit the key when absent** so the worktree-setup prompt stays byte-identical (resume-cache invariant). `ignore_gate` (per-task) is an explicit override for a task note that carries a human/release gate in prose ("don't action until a release ships"); when `true`, pass `ignoreGate: true` on that task so the engine tells the agent the gate is overridden for this run — **omit/false** otherwise.

`model` resolves task frontmatter → rollout frontmatter → `fable` and sets the model for that task's planner/implementer/reviser/investigator agents. The two judge roles (plan-judge, review-judge) always run `fable` — engine-pinned, not configurable — so the merge gatekeepers keep maximum capability even when an easy task drops to `opus`.

### 3.5. Resolve the plan-gate per task → `task.planGate` (boolean)

- `plan_approval: off` → `planGate: false`
- `plan_approval: required` → `planGate: true`
- `plan_approval: scope-gated` → `planGate: true` iff `scope: cross-cutting`; `single-file` and `read-only` → `false`

### 4. Stamp in-progress + build args

Before launching, for each task in scope: stamp `status: in_progress` and `owner: <session-tag>` on the task's frontmatter (blocks duplicate dispatches). Keep this in the lead session — subagents never write task `status:`.

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
  "waves": [
    { "wave": 1, "tasks": [
      { "slug": "giflab-fix-x", "taskPath": "/abs/.../giflab-fix-x.md",
        "scope": "single-file", "planGate": false,
        "maxIterations": 3, "maxReviewRounds": 4, "maxPlanRounds": 2,
        "ignoreGate": false,                 // per-task; omit/false unless overriding a human/release gate
        "model": "fable" }                   // per-task; "opus" when wave:plan dropped an easy task down
    ]}
  ]
}
```

Also read the rollout note's **`## Known baseline failures`** block (`/wave:plan` step 2.6): when it lists tests (not `none`/empty), pass them as `knownBaselineFailures: ["<test_id> — <reason>", …]`. The engine threads the manifest into every agent and shifts the Ralph green criterion to "no NEW failures beyond this set" — it keeps running the full verifier and never `--deselect`s the listed reds (per the project's `CLAUDE.md`: a comparison reference, not a mute button). Omit the key when the block is absent or `none` — the engine then behaves exactly as before (`verifier` exit 0 = pass).

- **Single-wave mode** (`execute Wave N of [[rollout]]`) → include only wave N in `waves`. Opens PRs; the user merges. No auto-merge. The tasks therefore end the session at `status: review` — once the user confirms the merges (or a later invocation finds the PRs merged in pre-flight), run `reconcile-wave.py mark-done` on them so they don't linger as false "awaiting acceptance" items.
- **Continuous auto-merge mode** (`execute [[rollout]]`, no wave number, no flag — the DEFAULT) → do **not** pass all waves at once. Drive the rollout **one wave per Workflow call** across turns, auto-merging each wave before launching the next. This is the zero-touch path — see §4.5.
- **`--gated`** → the **same** one-wave-per-call loop as continuous, but the between-wave step is a **human merge pause** instead of the auto-merge: run wave N, present its report, wait for the user to merge + re-invoke, then call wave N+1. The escape hatch for eyeballing PRs before they land.

> Correctness between waves comes from the **auto-merge + `origin/main` worktree base** (§4.5), not from a completion barrier. The old engine ran all waves against one frozen `main`, which silently re-created the #30/#31 squash-drop exposure for any rollout whose same-file tasks span waves. The per-wave loop fixes that.

### 4.5. Continuous auto-merge — the per-wave loop

In continuous mode the lead session is the conductor: run ONE wave on the engine, merge that wave, then launch the next. The merge — not a human, not a completion barrier — is what makes "earlier same-file work lands before the next wave branches" real. The loop is driven across turns by Workflow-completion notifications and is resumable via a durable cursor.

**Durable cursor.** Track progress in the rollout note frontmatter: `merged_through_wave: <N>` (`0` or absent = nothing merged yet). This is the single source of truth for "where was I" — a fresh session resumes from it, never from a GitHub/vault re-scan. New rollouts seed it at `0`; an older rollout without the field is treated as `0` (start at wave 1).

**Per wave K** (K = `merged_through_wave` + 1):

1. Resolve config + stamp `status: in_progress` for wave K's tasks (step 4); build args with `waves: [waveK]` only; call the Workflow (step 5).
2. On completion → reconcile vault frontmatter (step 6).
3. **Auto-merge wave K.** Collect the wave's tasks that returned `status: review` **and** have a non-empty `pr` (read-only tasks have none; **never** merge `review-blocked` / `blocked` / `plan-blocked`), in the report's recommended order. Run:
   ```
   ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/merge-wave.sh <repoPath> <pr> <pr> …
   ```
   - **The sentinel is authoritative, not the reported exit.** On exit the script writes `<repoPath>/.claude/merge-wave.status` — `ok` only on a clean merge, `failed:<code>` on any halt. If the run is backgrounded, a trailing-command wrapper (`… & wait; echo done`) can mask the script's real exit — so **read the sentinel file**, not the reported exit code. Treat anything other than a file containing exactly `ok` — **including a missing file** — as a halt.
   - **sentinel ≠ `ok` → HALT the rollout.** Surface the script's message verbatim (which PR, why, the exact next step) and stop. Do **not** advance the cursor or launch the next wave.
   - **sentinel `ok` → advance the cursor to `merged_through_wave: K`** via the helper (not a hand-edit):
     `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py cursor --rollout <rollout-note> --wave K`
   - **…then flip the wave's landed tasks to `done`** (same helper):
     `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py mark-done --tasks <slugA,slugB,…>`
     Pass **every wave-K task that ended at `status: review`** — both the just-merged PR tasks (the merge IS the confirmation a `review` note was waiting for) and the wave's read-only tasks (no PR to merge; their master-review approval was their confirmation, and the wave completing is when that becomes final). Idempotent; the helper refuses any note not at `review`/`done`, so a blocked task can never be swept along. Without this flip, landed tasks pile up at `review` as false "awaiting acceptance" items — seven had accumulated by 2026-06-12.
4. **Smart-halt check** before launching K+1: if any wave-K task did **not** land (`blocked` / `review-blocked` / `plan-blocked`) **and** its file-set (from the rollout note's `## File-sets` block) intersects the union of any later wave's file-sets → **HALT** with a clear report (e.g. "wave K left [[task]] unlanded; wave M edits the same file `<f>` — continuing would branch it from a main missing the fix"). The user fixes the blocker and re-invokes. Otherwise launch wave K+1 (its worktrees branch from the freshly-merged `origin/main`).
5. Repeat until the last wave merges, then **perform the completion ceremony** (don't just point the user at the checklist):
   - Sweep the rollout's task notes: every task should already read `status: done` (step 3's `mark-done` flips them wave by wave). Flip any straggler still at `review` whose PR is verifiably merged (`mark-done` again); a straggler at any *other* status means the rollout isn't actually complete — stop and say so.
   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter.
   - File any follow-on work the rollout's Post-rollout section names (validation re-runs, audits, deferred items) as **new open tasks** in `Work/Tasks/`, and rewrite those items in the rollout note as thin pointers to the new tasks.
   - Append a `## Completion log` to the rollout note: dispatch dates, waves → PRs (links + merge dates), convergence stats per task, disposition of each post-rollout item.
   - Close out the associated thread (see `~/.claude/skills/thread/SKILL.md`) — or record in the log why it stays open.
   - Move the rollout note to `Work/Tasks/Archive/Rollouts/` (`git mv` in the vault) and commit the vault. Wikilinks resolve by filename, so `[[<slug>]]` references and task `rollout:` backlinks survive the move.

   A done rollout left sitting in `Work/Tasks/` is invisible-but-present — every Bases view filters `status != done`, so it vanishes from view with no record of what happened. The ceremony is what makes completion legible weeks later.

**Cold resume.** Re-invoking `execute [[rollout]]` when `merged_through_wave: N` is set: first re-run `merge-wave.sh` against wave N+1's already-open PRs (idempotent — merged PRs are skipped, so this flushes any half-merged wave), `mark-done` the tasks whose PRs are now confirmed merged, then continue the loop.

**Per-task resume within a wave (finding #7).** A wave that returned one approved + one blocked task merges the approved PR but can't advance the cursor (the wave is incomplete). On resume, dispatch only the tasks in that wave whose note status is **not already landed/approved** — the task-note `status:` is the source of truth, not the cursor. Compute the still-to-dispatch set deterministically rather than re-dispatching the whole wave (which would re-run already-merged work):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py resume-filter --tasks slugA,slugB,slugC
#   prints the subset whose status ∉ {done, review, merged} — build args from exactly those
```

**No `## File-sets` block?** (an older rollout) the precise smart-halt can't run — fall back to the **coarse** rule: any unlanded task + any later wave ⇒ HALT. Tell the user to `/wave:plan --regenerate` for precise halting.

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

### 6. Reconcile + report

The workflow returns `{ rolloutSlug, tasks: [{ slug, scope, status, prUrl, branch, worktreePath, reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, summary }] }` where `status ∈ review | review-blocked | blocked | plan-blocked`.

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

Review-blocked (max rounds reached):
- [[task-e]] — PR <url> — see "## Review-blocked feedback"

Plan-blocked (no PR opened):
- [[task-h]] — see "## Plan-blocked feedback"

Ralph-blocked (no PR opened):
- [[task-f]] — see "## Blocker diagnosis"

Recommended merge order: <list>
```

**Merging:** in `--gated` / single-wave mode, do NOT merge — the user decides. In continuous auto-merge mode the lead session merges this wave via `scripts/merge-wave.sh` (§4.5) — never an inline `gh pr merge`. Within a wave the approved PRs are file-disjoint (the wave invariant), so they don't conflict with each other; the merge script brings each up to date with `main` in turn before squash-merging.

The merge gate is the repo's **required** checks — branch-protection's own definition of mergeable — **not** GitHub's cosmetic `CLEAN` (which also waits on non-required checks). A `main` that legitimately carries red *non-required* checks reports every PR as `UNSTABLE`, never `CLEAN`; gating on `CLEAN` would merge no wave at all. `merge-wave.sh`'s `UNSTABLE)` case handles this by waiting on `--required` checks only — a genuinely-failing required check surfaces as `BLOCKED`, not `UNSTABLE`, so it stays safe. Don't "tidy" it back to `CLEAN`-only (see `giflab-rollout-merge-wave-unstable-fix`).

### 7. Continuous-mode stop conditions

Continuous mode is the per-wave loop (§4.5), not one engine call. It **HALTS automatically** — surface the reason prominently, leave everything merged-so-far landed, and stop — when:

- a wave produces **zero** approved (`status: review`) PRs (nothing to merge; downstream presumptively unsafe), or
- `merge-wave.sh` exits non-zero (a real merge conflict or red required check), or
- the smart-halt check fires (an unlanded task's file reappears in a later wave).

In every halt case the work merged so far stays on `main`; the user fixes the cause and re-invokes `execute [[rollout]]` to resume from the `merged_through_wave` cursor.

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
| (absent) / 2 | Legacy in-conversation playbook (prose-driven dispatch + sentinel parsing) | Retired — regenerate via `/wave:plan --regenerate` |
| 3 | Workflow-engine convergence (`wave-execute.workflow.js`): structured output, in-pipeline parallel review, autonomous plan-gate judge, journaled resume | Current |

Future protocol bumps follow the same rule: a new executor refuses older versions and asks the user to regenerate.

## Resource budget

The engine chunks each wave by `parallel_ceiling` (default 4) so heavy-model waves never run more than that many worktrees concurrently. Convergence multiplies wall-clock, not memory: worst-case per task is roughly `max_iterations × verifier-time × max_review_rounds`. With defaults (3 × 5 min × 4) one stubborn task can occupy a worktree ~an hour. For waves dominated by cross-cutting long-verifier tasks, lower `max_review_rounds` in the rollout frontmatter.

**Continuous auto-merge adds serial merge time per wave.** Merges into a `strict`-protected `main` can't be parallelised — each merge advances `main`, so the next PR must re-update its branch and re-pass its required checks. Budget ≈ (update-branch + required-checks runtime + squash) per approved PR, **sequentially** — new wall-clock the old "human merges later" path didn't charge to the run.
