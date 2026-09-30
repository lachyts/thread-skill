---
name: execute
description: 'Use to execute a wave rollout — reads the rollout note, resolves per-task config, and runs the convergence engine on the Workflow tool (plan-gate → verifier retry → master review, parallel within each wave). Continuous mode (bare "execute [[rollout]]") auto-merges each wave; --gated pauses for manual merges; a plan-declared gated input always pauses for human sign-off. Triggers on "execute [[rollout-slug]]", "execute Wave N of [[rollout]]", "pause the rollout", "reinstate [[rollout]]", or explicit /thread:execute. Only runs protocol_version: 3 rollouts; older notes are refused with a /thread:schedule --regenerate prompt.'
---

# /thread:execute — run a wave rollout on the Workflow engine

`/thread:execute` is the executor half of the wave split. Where `/thread:schedule` writes the rollout note (data), this skill reads it, resolves config, and hands the convergence work to a **dynamic Workflow** script. This skill is a thin shim; the engine lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js`.

The engine runs three layers per task — optional plan-gate (autonomous judge) → Ralph-style agent-side verifier retry → master-side review-and-revise loop — and converges tasks **in parallel within each wave** (a task can be in master-review while a wave-mate is still implementing). The skill itself stays in the conversation to do vault I/O, the protocol gate, status reconciliation, reporting, and the `--gated` between-wave pause (which an autonomous background workflow cannot do).

## Native runtime binding

The canonical JavaScript engine also runs through
`~/repos/workspaces/_shared/scripts/native_workflow.mjs`; read the co-located
`native_workflow.md` host protocol before dispatch. It injects `agent`, `pipeline`,
`phase` and `log` and journals native-child requests/results. Claude and Codex
both keep children, nested reviewers and retries in the calling harness/account.
Provider tier names in this engine (`opus` / `fable`) require explicit verified
native model bindings; do not silently downgrade escalation to one inherited model.

**Preflight before any task status or owner stamp:** select a supported execution
mode and verify native children, role/model bindings and required project tools.
A session-driven single wave can use the exchange. Use one stable private run
directory; recover claims and bound native IDs on interruption, never dispatch
again because an `advance` call was repeated. The canonical engine still owns
convergence, budgets and gates; the lead still owns reconciliation and merging.

The continuous detached lifecycle in §8 (Stop hook, heartbeat and cold-resume
notifications) is still a Claude runtime integration. It is **not ported to Codex**
by the exchange adapter. In Codex, a default invocation requiring that lifecycle
must stop at this preflight and report the unsupported driver; do not stamp tasks,
register a substitute cron, or silently reinterpret the invocation as single-wave.
Only a specifically requested session-driven single wave bypasses the detached
driver requirement. Existing scheduled jobs and journals retain their runtime.

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` produced by `/thread:schedule` (older undated `<slug>-rollout` notes still resolve — see step 1). The Workflow's agents operate in isolated git worktrees they create under the target repo (`<repoPath>/.claude/worktrees/`) and open PRs. The lead session updates task frontmatter in the vault and, at completion, sets `status: done` on the phase notes the rollout finished and may file a `phase-close-followup-*` task (ADR 0026). Does not touch any other backlog source.

## Invocation forms

```
execute Wave 1 of [[giflab-rollout]]       # single wave — opens PRs, you merge
execute [[giflab-rollout]]                 # full rollout, CONTINUOUS AUTO-MERGE (zero-touch — the default)
/thread:execute Wave 1 of [[giflab-rollout]] # explicit, single wave
/thread:execute [[giflab-rollout]] --gated   # full rollout, MANUAL merge: pause between waves for you to merge
```

Bare `execute [[rollout]]` is **continuous auto-merge**: the lead session runs each wave, merges that
wave's approved PRs to the base branch (`main` unless §4's `defaultBranch` says otherwise), then launches the next — no per-PR confirmation. `--gated` is the same
per-wave loop with a human merge pause instead, for when you want to eyeball PRs before they land.
Single-wave mode opens PRs and leaves merging to you.

## Skill flow

### 1. Read the rollout note

Resolve `[[<slug>]]` to `~/repos/obsidian/Work/Tasks/<slug>.md`. Read frontmatter + body.

The slug is whatever the invocation names. `/thread:schedule` writes rollout notes **always dated** — `<project-slug>-rollout-<YYYY-MM-DD>` for the first rollout of a day, or `<project-slug>-rollout-<YYYY-MM-DD>-<N>` (N≥2) for each subsequent rollout that same day (the first-of-day stays bare-date). Legacy notes from before this rule use the undated `<project-slug>-rollout`; execute still resolves them. The ordinal is purely `/thread:schedule`'s collision-avoidance scheme; execute reads the exact note it's handed and needs no special parsing. If the user names a rollout ambiguously (e.g. "execute today's giflab rollout") and several dated/ordinal notes match, **list the matches and ask which** — don't assume the highest ordinal.

If the frontmatter carries a `paused:` stamp, this invocation is a **reinstate** — see §4.5 *Reinstate* and *Pausing + reinstating a rollout* below.

### 2. Protocol-version gate

- Missing `protocol_version` **or** `protocol_version: 2` → print: "This rollout predates the Workflow engine. Regenerate it to run under the current contract: `/thread:schedule <project> --regenerate`." Stop. (The legacy prose executor has been retired — there is no in-conversation engine to fall back to.)
- `protocol_version` other than `3` → print "unsupported protocol version <N>; this executor supports protocol_version: 3" and stop.
- `protocol_version: 3` → proceed.

### 2.5. Landing-register gate

The lead session never dispatches a wave, calls or resumes a Workflow, or merges into a repo on the
landing register (ADR 0028 § Decision). Run the register check in
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` § Dispatch blockers (point at it; never copy the
snippet here) against the rollout's `Project root`. `/thread:schedule` § 0 already ran it, but a repo can
be listed after scheduling, so run it again at **every** invocation that starts or continues work (fresh,
cold resume, reinstate, single-wave, `--gated`), before anything writes or merges: before the §3/§4
stamps, and before §4.5 *Reinstate*'s `clear-pause`.

**Pausing is exempt.** A pause invocation (*Pausing + reinstating a rollout* below) skips this gate
entirely: the soft pause's `pause_requested: true` stamp, and every hard-pause step (the **TaskStop**, the
`paused:` stamp and its `## Pause log` entry, the heartbeat `CronDelete`). The gate never blocks stopping
work: a listed repo, or an exit-2 failure such as a malformed or unterminated register, still lets the
user pause.

**What the gate cannot catch.** It runs lead-side, between engine calls. A repo listed while a wave's
Workflow is in flight is only caught at the next re-check: until that wave returns, its agents keep
pushing task branches and opening PRs on the repo. The step-3 re-check still stops the merge, so nothing
lands on the default branch. For an urgent mid-wave listing, **hard pause** the rollout (TaskStop kills
the in-flight agents now); the exemption above means the gate never stands in the way of that.

- **Exit 0** (`land`): proceed. Any warning the reader printed on stderr (no register file, a malformed
  entry) still shows; pass it on to the user.
- **Any non-zero exit**: write nothing (no stamp, no cursor, no `mark-dispatched`, no merge, no Workflow
  call). Print the snippet's stderr verbatim above the WAVE-STATUS line (the `listed <owner/name>:
  <reason>` line with its remedy, the reader's `landing-register:` error, or the no-origin remedy), then
  end the turn with
  `WAVE-STATUS: <slug> cursor=<merged_through_wave>/<N> state=halted reason="<owner/name> is on the landing register"`
  (exit 3), or `reason="landing-register check failed"` (exit 2 or 4). The reason stays short and
  quote-free for the Stop-hook regex; the verbatim stderr above it says where to go. Unlisting is Lachy's
  call, so this is a designed stop (§7), not something to route around.

"Re-run § 2.5" elsewhere in this skill means exactly this: the same check with the same halt.

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
| `max_tier` | none (omit) | `maxTier` (rollout-level; **`opus` is the only value that caps anything** — `fable` is the uncapped default, so `max_tier: fable` is a no-op, and an empty `max_tier:` parses as null and also runs uncapped, with no log line) — the ADR 0016 tier **ceiling**. Set it ONLY when the account's fable quota is exhausted, never as a cost preference: it clamps the seed, suppresses escalation (reported as `tierCapped`), and clamps a `judgeModel` pin. A capped tier is terminal, so it runs the full Ralph loop at the higher tier's effort. Omit ⇒ byte-identical to pre-ceiling. |
| `env_bootstrap` | none (omit) | `envBootstrap` (rollout-level) |
| `ignore_gate` | `false` (omit) | `task.ignoreGate` (per-task) |
| `model` | `opus` | `task.model` (per-task; `opus` \| `fable`) |
| `effort` | none (omit) | `task.effort` (per-task ONLY — the ADR 0007 escape hatch; it has no rollout-level form) |

**Validate the round budgets before anything else.** Each resolved `max_iterations`, `max_review_rounds` and `max_plan_rounds` must be an **integer >= 1** — a YAML int, never `0`, negative, fractional, a string, empty or `null` (a hardcoded default applies only when the key is absent at every level; an empty `max_plan_rounds:` is null, not absent). On any violation the lead writes nothing: no `status: in_progress` stamp, no `mark-dispatched`, no Workflow call. Name the field, the bad value and its source (task or rollout frontmatter), then end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="invalid round budget: <field> on [[task]]"` — for a rollout-level value, name the rollout instead of the task. This is the upstream refusal; the engine also fails closed per task (`plan-blocked` / `review-blocked` naming the field) so a bad budget can never silently disable a plan or review layer (ADR 0008).

`scope:` is read directly from each task's frontmatter (set by `/thread:schedule`). `completion_sentinel` is no longer used — the Workflow returns validated structured output instead of parsing sentinel strings.

`env_bootstrap` (rollout-level) is an optional shell command the engine runs once per worktree so agents start from a working interpreter + deps (e.g. `poetry env use 3.11 && poetry install`) — read it from the rollout frontmatter and pass it as `envBootstrap`; **omit the key when absent** so the worktree-setup prompt stays byte-identical (resume-cache invariant). `ignore_gate` (per-task) is an explicit override for a task note that carries a human/release gate in prose ("don't action until a release ships"); when `true`, pass `ignoreGate: true` on that task so the engine tells the agent the gate is overridden for this run — **omit/false** otherwise.

`model` resolves task frontmatter → rollout frontmatter → `opus` and sets the task's **starting tier**. Judges **follow the task's live tier**, so a `fable` task gets Fable review end-to-end. (A run can still pin all judges to one model via the `judgeModel` arg — it wins when set.)

**Effort bundles (ADR 0007).** A tier is a **(model, per-role effort) bundle**, not two knobs — reasoning effort rides the same ladder as the model. The per-role matrix is fixed in ONE place in the engine (`wave-execute.workflow.js`, the `EFFORT` constant), restated below for reading only — **the constant is canonical; if the two ever disagree, this table is the bug**:

| Role | `opus` tier | `fable` tier |
|---|---|---|
| planner / implementer (incl. revisers + read-only investigator) | medium | high |
| judges (plan + review) | high | high |
| master review (the PR-review judge — refines the judges row) | high | xhigh |
| mechanical reconcile stages | low | low |

Every `agent()` spawn site sets `effort` from the task's **live** tier + the agent's role, so escalation carries effort automatically — flipping a task to fable is one move that upgrades model AND effort, and judges follow (judges pinned via `judgeModel` take the pinned tier's row — model and effort always travel together). The **single escape hatch** is per-task `effort:` frontmatter (`low` \| `medium` \| `high` \| `xhigh` \| `max`): resolve it from the task note and pass it as `task.effort` — it overrides the planner/implementer effort for that task only, judges always keep the matrix, and it holds across an escalation (a monster task at fable/max stays at max). There is deliberately **no rollout-level effort config** (see ADR 0007's rejected options) — tuning the matrix means editing the engine, because the matrix encodes a stance (where effort is worth paying), not a per-rollout preference. The reconcile row is documented stance only today: reconcile is deterministic Python (`reconcile-wave.py`), so no agent consumes it.

**Model escalation (one-shot first pass).** An `opus` task gets exactly one un-iterated pass at each layer: one plan, one implementation with a **single** verifier run (the Ralph `max_iterations` budget does not apply to the first pass), one judged PR round. The first evidence of hardness anywhere — a plan-judge `changes` verdict, a first-pass planner/investigator block, a red one-shot verifier run, an implementer block, or a review-judge `changes` verdict — **escalates the task to `fable` for all remaining work**, judges included. Escalation is one-way, sticky, and happens inside the engine (no re-invocation): the fable agent inherits the prior attempt's worktree, committed work, and note diagnosis, and runs the full Ralph loop. A `fable` task (stepped up by `/thread:schedule` §4.7 or a rollout-level `model: fable`) never escalates — there is nothing above fable — and runs the full loop from the start, exactly as before. Escalation is **durable**: reconcile (§6) stamps `model: fable` on the task note, so resume / `/thread:repair` re-dispatches start at fable and never re-pay the opus toll. There is no config switch — escalation is always on for opus tasks.

### 3.5. Resolve the plan-gate per task → `task.planGate` (boolean)

- `plan_approval: off` → `planGate: false`
- `plan_approval: required` → `planGate: true`
- `plan_approval: scope-gated` → `planGate: true` iff `scope: cross-cutting`; `single-file` and `read-only` → `false`

(`/thread:schedule`'s gated-input sweep may have stamped `plan_approval: required` on tasks that smell of spend/credentials — that per-task frontmatter wins here as usual. It is advisory: it guarantees a plan-gate exists where the plan's own declaration can pause; the declaration itself is authoritative — §3.7.)

### 3.7. Gated inputs — the unconditional human stop (ADR 0008)

Every plan the engine's planner produces must carry a **`### Gated inputs`** section — API spend (with a **hard cap**), credentials, irreversible actions, or exactly `None`. Gates are **top-level markdown bullets, one per line**; prose, footnotes, and nested sub-bullets in the section are commentary the engine ignores (ADR 0013). A missing section — or one with no bullet gates and no exact `None` — is a plan-judge `changes` (and the engine fails closed to `plan-blocked` if a judge ever approves one anyway). After the plan-judge approves a plan, the engine compares the declared gates against the task's **approved gates** and, if any declared gate is not yet approved, returns the task at **`status: gate-pending`** without implementing — **regardless of `plan_approval` config or continuous mode**. Tasks with no plan-gate are covered by the same rule reactively: every code-writing prompt carries a stop rule, so an implementer that finds an undeclared/unapproved gated input stops *before* the gated action and returns it in `gatedInputs`, which the engine converts to the same `gate-pending` stop. A gate stop is a human decision, not evidence of hardness — it never escalates an opus task.

**Resolve `task.approvedGates` when building args (step 4):** read the task note's `## Approved gates` section; each bullet, with its `(approved …)` annotation stripped, becomes one entry. Omit the key when the note has no such section. The engine skips the stop for exactly these gates (whitespace/case-insensitive match; **a changed cap is a NEW gate**). Declared gates arrive bullet-clean — markers stripped, soft-wraps rejoined (ADR 0013) — so an approval matches only that exact text. The approval is durable on the note, so re-dispatches and resumes never re-ask.

**Sign-off flow (the pause continuous mode makes for gated tasks):** reconcile (§6) writes the declared gates under `## Gated inputs (awaiting sign-off)` and sets `status: gate-pending`. Present each gate **verbatim** to the user and ask for sign-off — this pause is **designed** (ADR 0008), not a failure. On sign-off run:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py approve-gates --tasks <slugA,slugB>
```

(moves the pending gates to `## Approved gates` with the sign-off date — gate + cap + sign-off — and flips the note to `in_progress`), then re-dispatch exactly those tasks (per-task resume within the wave). If the user declines a gate, defer the task or leave it — the wave then follows the normal incomplete-wave rules. If nobody is present to sign off, end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="gated inputs await sign-off: [[task]]"`. `resume-filter` **excludes** `gate-pending` notes, so no unattended re-entry (heartbeat included) can bypass or spam a pending gate — only `approve-gates`, run after an explicit human sign-off, makes the task dispatchable again. The approved cap is a **ceiling** the implementer must respect; blowing it is a verifier/review failure, not a re-ask.

### 4. Stamp in-progress + build args

**Git-env check (before any stamp).** Agents and verifiers inherit this session's environment. A `GIT_DIR`, `GIT_WORK_TREE` & co. exported here (a git hook or a `git -c` wrapper launched Claude Code) overrides every `git -C` the engine renders and every scrub an agent forgets: its git commands, the verifier's and `merge-wave.sh`'s run against whatever repository the variable names (the 2026-09-23 leak, p12-3). The engine prefixes each rendered command with `unset $(git rev-parse --local-env-vars 2>/dev/null);`, but only this session can check the environment it hands down. Run this first, in every mode (§4.5 step 1, single-wave, and § 5's resume):

```bash
# thread:git-env-check (extracted and tested by tests/git-env-scrub.test.sh)
vars=$(git rev-parse --local-env-vars) && [ -n "$vars" ] || { echo "git-env: git rev-parse --local-env-vars failed" >&2; exit 2; }
hits=$(for v in $(git rev-parse --local-env-vars); do printenv "$v" >/dev/null && printf '%s ' "$v"; done)
if [ -n "$hits" ]; then
  echo "git-env: exported in the lead session: ${hits% }" >&2
  case " $hits" in *" GIT_CONFIG_PARAMETERS "*|*" GIT_CONFIG_COUNT "*) echo "git-env: GIT_CONFIG_PARAMETERS/GIT_CONFIG_COUNT usually mean the wrapper that launched Claude Code ran 'git -c …'" >&2 ;; esac
  echo "git-env: relaunch Claude Code from a shell without them (never from inside a git hook), then re-invoke" >&2
  exit 1
fi
# end thread:git-env-check
```

`$vars` only proves the list is readable; the loop iterates the command substitution itself, because zsh (the Bash tool's shell on macOS) never word-splits a parameter expansion. On **any non-zero exit, write nothing**: no stamp, no `mark-dispatched`, no Workflow call. Print its stderr verbatim above the WAVE-STATUS line and end the turn with `WAVE-STATUS: <slug> cursor=<merged_through_wave>/<N> state=halted reason="git env set in the lead session"` (exit 1) or `reason="git-env check failed"` (exit 2).

Before launching, for each task in scope: stamp `status: in_progress` and `owner: <session-tag>` on the task's frontmatter (blocks duplicate dispatches). Keep this in the lead session — subagents never write task `status:`. In the launch message, **flag any task expected to gate** (a `plan_approval: required` stamped by `/thread:schedule`'s gated-input sweep, or a note that smells of spend/credentials) so the eventual `gate-pending` pause is expected, not a surprise (§3.7).

Build the `args` object the workflow expects:

```jsonc
{
  "rolloutSlug": "giflab-rollout",
  "repoPath": "/abs/path/to/repo",      // from the rollout's "Project root" line
  // "defaultBranch": "master",           // ONLY when the resolver below prints something other than
                                          //   "main"; absent for main repos like this giflab example
                                          //   (byte-identical prompts)
  "verifier": "make test",               // resolved rollout-level verifier
  "date": "2026-05-29",                  // pass it in — Date.now() is unavailable in the script
  "concurrency": 4,                       // parallel_ceiling
  "knownBaselineFailures": [              // from the "## Known baseline failures" block; omit when none
    "test_color_reducer_functionality — ImageMagick 0-byte output (pre-existing, env)"
  ],
  "envBootstrap": "poetry env use 3.11 && poetry install",  // from rollout `env_bootstrap:`; OMIT when absent
  "maxTier": "opus",                      // from rollout `max_tier:` (ADR 0016); OMIT when absent —
                                          //   a quota ceiling, never a cost knob. Check the account's
                                          //   quota before setting it, and say so in the launch message.
  "progress": "wave 1/4 dispatched — 0m elapsed",  // optional; mark-dispatched's progress line (§4.5 step 1) —
                                                   //   the engine log()s it verbatim (its sandbox has no clock);
                                                   //   OMIT when mark-dispatched printed none
  "waves": [
    { "wave": 1, "tasks": [
      { "slug": "giflab-fix-x", "taskPath": "/abs/.../giflab-fix-x.md",
        "scope": "single-file", "planGate": false,
        "maxIterations": 3, "maxReviewRounds": 4, "maxPlanRounds": 2,  // positive integers only (§3)
        "ignoreGate": false,                 // per-task; omit/false unless overriding a human/release gate
        "model": "opus",                     // per-task STARTING tier; "fable" when thread:schedule stepped a
                                             //   hard task up. The engine may escalate opus→fable mid-run.
        "effort": "max" }                    // per-task ONLY, from the task note's `effort:` frontmatter —
                                             //   OMIT when absent. Overrides the tier bundle's planner/
                                             //   implementer effort; judges keep the matrix (ADR 0007).
    ]}
  ]
}
```

**Resolve `defaultBranch` when building each wave's args** — it is the repo's GitHub default branch, the one source the whole rollout shares: fresh worktrees branch from `origin/<it>`, `gh pr create` targets the same default on its own, and `merge-wave.sh` refuses a wave whose PRs target anything else. Ask the **remote**: the local `refs/remotes/origin/HEAD` is often unset and can be stale (it survives a default-branch rename and even the deletion of the branch it names). The answer is deterministic, so a resume re-passes the same value. **Stop** when the remote does not answer — never assume `main`, which fails at the first worktree of a `master` repo:

```bash
# thread:default-branch-resolver (extracted and tested by tests/default-branch.test.sh)
R="<repoPath>"
db="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/default-branch.sh"
if [ ! -f "$db" ]; then echo "default-branch: script not found at $db (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
bash "$db" "$R"
# end thread:default-branch-resolver
```

Pass the printed name as `defaultBranch` only when it is not `main`. Any non-zero exit stops: 1 means the remote did not answer, 2 means `scripts/default-branch.sh` was not found or `<repoPath>` was left empty. A resume (`resumeFromRunId`) re-passes the run's ORIGINAL args unchanged — adding `defaultBranch` to a run that started without it changes prompt bytes and re-runs cached agents.

Also read the rollout note's **`## Known baseline failures`** block (`/thread:schedule` step 2.6): when it lists tests (not `none`/empty), pass them as `knownBaselineFailures: ["<test_id> — <reason>", …]`. The engine threads the manifest into every agent and shifts the Ralph green criterion to "no NEW failures beyond this set" — it keeps running the full verifier and never `--deselect`s the listed reds (per the project's `CLAUDE.md`: a comparison reference, not a mute button). Omit the key when the block is absent or `none` — the engine then behaves exactly as before (`verifier` exit 0 = pass).

- **Single-wave mode** (`execute Wave N of [[rollout]]`) → include only wave N in `waves`. Opens PRs; the user merges. No auto-merge. The tasks therefore end the session at `status: review` — once the user confirms the merges (or a later invocation finds the PRs merged in pre-flight), run `reconcile-wave.py mark-done` on them so they don't linger as false "awaiting acceptance" items.
- **Continuous auto-merge mode** (`execute [[rollout]]`, no wave number, no flag — the DEFAULT) → do **not** pass all waves at once. Drive the rollout **one wave per Workflow call** across turns, auto-merging each wave before launching the next. This is the zero-touch path — see §4.5.
- **`--gated`** → the **same** one-wave-per-call loop as continuous, but the between-wave step is a **human merge pause** instead of the auto-merge: run wave N, present its report, wait for the user to merge + re-invoke, then call wave N+1. The escape hatch for eyeballing PRs before they land.

> Correctness between waves comes from the **auto-merge + `origin/<default branch>` worktree base** (§4.5; `origin/main` unless `defaultBranch` says otherwise), not from a completion barrier. The old engine ran all waves against one frozen `main`, which silently re-created the #30/#31 squash-drop exposure for any rollout whose same-file tasks span waves. The per-wave loop fixes that.

### 4.5. Continuous auto-merge — the per-wave loop

In continuous mode the lead session is the conductor: run ONE wave on the engine, merge that wave, then launch the next. The merge — not a human, not a completion barrier — is what makes "earlier same-file work lands before the next wave branches" real. The loop is driven across turns by Workflow-completion notifications and is resumable via a durable cursor.

**Landing-register re-check.** Every entry into this loop (top-down, *Cold resume*, *Reinstate*, the § 5 heartbeat's re-entry, `/thread:repair`'s hand-off) re-runs § 2.5 before anything else it does, and the loop re-runs § 2.5 before every wave dispatch, every Workflow call (a `resumeFromRunId` resume included) and every `merge-wave.sh` call. A halt leaves open PRs open, the cursor unadvanced and any `paused:` stamp in place.

**Durable cursor.** Track progress in the rollout note frontmatter: `merged_through_wave: <N>` (`0` or absent = nothing merged yet). This is the single source of truth for "where was I" — a fresh session resumes from it, never from a GitHub/vault re-scan. New rollouts seed it at `0`; an older rollout without the field is treated as `0` (start at wave 1).

**Per wave K** (K = `merged_through_wave` + 1):

1. Re-run § 2.5; then resolve config + stamp `status: in_progress` for wave K's tasks (step 4). Stamp the wave's **dispatch boundary** on the rollout note — the engine's sandbox has no clock, so wall-clock enters here:
   ```
   python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py mark-dispatched --rollout <rollout-note> --wave K
   ```
   (writes `wave_K_dispatched: <timestamp>`; idempotent — **first dispatch wins**, so a resume re-dispatch never resets the wave clock). It prints a `progress:` line — "wave K/N dispatched — 42m elapsed, ~50m remaining (rough)" — surface it to the user and pass its text as the args `progress` string so the engine `log()`s it live in `/workflows`. Then build args with `waves: [waveK]` only; call the Workflow (step 5).
2. On completion → reconcile vault frontmatter (step 6).
3. **Auto-merge wave K.** Re-run § 2.5 before `merge-wave.sh`: a repo listed during the wave halts here with the wave's approved PRs left open (merging puts commits on the listed repo's default branch). On that halt there is no merge, no cursor advance and no `mark-done`; the tasks stay at `review`, and once the repo is unlisted, re-invocation's *Cold resume* flush merges them. Collect the wave's tasks that returned `status: review` **and** have a non-empty `pr` (read-only tasks have none; **never** merge `review-blocked` / `blocked` / `plan-blocked` / `gate-pending`), in the report's recommended order. Run:
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
   - **Soft-pause check (rides the cursor step — zero extra calls).** The `cursor` helper honours a `pause_requested: true` flag on the rollout note: it stamps `paused: <timestamp>`, clears the flag, and prints a `paused=` line alongside the cursor advance. When that line appears, the user asked for a soft pause — do **NOT** launch wave K+1. Print a short paused report (what merged this wave, what's left) and end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="paused at user request"`. The Stop-hook driver releases on `halted`, and the heartbeat cron deletes itself on its next tick — on this `halted` line, or on the `paused:` stamp its prompt checks ahead of the stall diagnosis (§5), which is what keeps "nothing auto-resumes a paused rollout" true for a hard pause too (a hard pause never emits `halted`; its runbook also deletes the cron outright). Reinstate is plain `/thread:execute [[rollout]]` — see *Pausing + reinstating a rollout* below.
4. **Smart-halt check** before launching K+1: if any wave-K task did **not** land (`blocked` / `review-blocked` / `plan-blocked` / `gate-pending`) **and** its file-set (from the rollout note's `## File-sets` block) intersects the union of any later wave's file-sets → **HALT** with a clear report (e.g. "wave K left [[task]] unlanded; wave M edits the same file `<f>` — continuing would branch it from a main missing the fix"). The user fixes the blocker and re-invokes. Otherwise, **honour any pending pause before launching K+1**: a partially-landed wave never runs step 3's cursor advance (*Per-task resume within a wave* below), so a `pause_requested: true` still sitting on the rollout note has NOT been honoured yet — check the note, and if the flag is pending, re-run `reconcile-wave.py cursor --rollout <rollout-note> --wave <current merged_through_wave>` (cursor-idempotent — re-setting the same value changes nothing — while performing the stamp + clear + `paused=` signal) and exit exactly as the step-3 *Soft-pause check* does: no wave K+1, paused report, `WAVE-STATUS: <slug> cursor=<merged_through_wave>/<N> state=halted reason="paused at user request"`. With no pending pause, launch wave K+1 (its worktrees branch from the freshly-merged `origin/main`).
5. Repeat until the last wave merges, then **perform the completion ceremony** (don't just point the user at the checklist):
   - Sweep the rollout's task notes: every task should already read `status: done` (step 3's `mark-done` flips them wave by wave). Flip any straggler still at `review` whose PR is verifiably merged (`mark-done` again); a straggler at any *other* status means the rollout isn't actually complete — stop and say so.
   - **Close the phases this rollout finished (ADR 0026).** Without this step a phase closes only when a lead remembers to. Run it here, before the rollout stamp, never after:
     ```
     python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py touched-phases --rollout <rollout-note>
     python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/reconcile-project.py <line> --kinds phase --apply
     ```
     The first prints one `--project <slug> --phases <N,M,...>` line per project slug among the rollout's linked task notes named `<slug>-p<N>-*` (archived ones included, loose tasks ignored); run the second once for each line it prints, with `<line>` as that line verbatim.
     - **Scope.** Phases come only from `touched-phases`. A phase the rollout did not touch is never passed, so it is left alone even when it is finished.
     - **Mapping output back to phase numbers.** reconcile-project prints each item as an indented line under its section header: under `Written (n)`, `  - phase <stem>: status: done, completed: <date>`; under `Ambiguous (n)`, `  - phase <stem>: <reason>`; under `Errors (n)`, `  - phase <stem> skipped: dependency ...` or `  - phase <stem> not written: ...`. Map each `<stem>` to a touched number N by its literal `<slug>-p<N>-` prefix, where `<slug>` is that line's `--project` value. The match is on the whole prefix, so `-p1-` never matches `-p10-`.
     - **Outcome per touched phase**, in this precedence, each reported to the user and recorded in the Completion log. **closed**: it appears under Written. **ambiguous**: it appears under Ambiguous and is never applied; record it with the tool's reason for the user to decide. **failed**: it appears under Errors, or its line exited non-zero and printed no sections (exit 2, a usage or loader error, or a crash: the tool prints every section at once, so a run that printed `Errors (n)` is never a whole-line failure); every phase on such a line without its own Written, Ambiguous or Errors entry is failed, never left open. Handle it as in *Failure* below. **already closed**: any other touched phase whose phase note (`Work/Phases/<slug>-p<N>-*.md`, then `Work/Phases/Archive/**`) reads `status: done`, because an interrupted ceremony already closed it or a lead closed it by hand; the log records it among the closed phases, marked already closed. **left open**: every other touched phase, i.e. touched minus Written, Ambiguous and Errors and minus the already closed, recorded with the fixed reason `not closed: a task is still open or held, or the phase note is missing or not open` (the cases the tool is silent on: QUIET phases, phases with no tasks, and phase notes missing or at a status other than open or done). Surface any `Skipped` lines (gh unavailable) as-is.
     - **Empty output.** If `touched-phases` exits 0 and prints nothing, record "no phased tasks: nothing to close" in the log.
     - **Failure, for either command.** When `touched-phases` exits non-zero (1: rollout note not found; 2: usage error) or reconcile-project exits non-zero (1: an apply write failed or a dependent phase was skipped; 2: usage or loader error, nothing written): surface the message verbatim to the user, file a follow-on open task at `Work/Tasks/phase-close-followup-<rollout-slug>.md`, record the failure in the Completion log linking the follow-on, and **continue the ceremony**. Why a task and not only a log line: orient's audit runs the reconcile step and would re-find the drift (ADR 0027), but only when someone next orients on the project; this open task is visible now, and a line only in a done, archived rollout's log is exactly the invisible state ADR 0026 fixes.
       - Name: it deliberately starts `phase-close-followup-`, so it never prefix-matches schedule's same-day glob `<slug>-rollout-<YYYY-MM-DD>*.md`, step 1's "several dated/ordinal notes match" lookup, status/repair's `<slug>-rollout-<date>` reads or reconcile-project's `<slug>-rollout` detection. It has no `-p<digits>-` segment of its own, so it is never a phase task.
       - Frontmatter: the same new-task shape as the follow-on tasks in the follow-on bullet below (its fenced block), minus `rollout:`, `wave:` and `phase:`. With no `phase:` key it is a loose task, never a phase member. Copy `projects:` from the rollout.
       - Body: one line per failure, `close phase <slug>-p<N>: reconcile-project exited <code>: <message>` for a phase under Errors, or `close phases <slug>-p<N,M>: reconcile-project exited <code>: <message>` for a whole-line failure, or `touched-phases exited <code>: <message>`. Then the exact commands to re-run, with `--rollout` given the post-move path `Work/Tasks/Archive/Rollouts/<rollout-slug>.md` (the move below archives the rollout note, so its `Work/Tasks/` path would exit 1 on every re-run), and "a re-run resolves lines as in *Resolving a stale follow-on*; once every line is resolved, set this task done".
       - Existing follow-on: look in `Work/Tasks/` root, then `Work/Tasks/Archive/**`, and never create a second same-named note. A failure already listed (an unresolved line with the same `close phase <slug>-p<N>`, `close phases <slug>-p<N,M>` or `touched-phases` key) gets only the in-place `still failing` annotation below, never a second line; only failures not yet listed are appended as new lines. If the only copy is archived and done, `git mv` it back to `Work/Tasks/` and reset `status: open` before appending.
     - **Resolving a stale follow-on (resume or hand fix).** On any re-run where `phase-close-followup-<rollout-slug>` already exists, walk its unresolved lines. Append `resolved <date>: <outcome>` to a `close phase <slug>-p<N>` line when phase N is absent from Errors in a run of its line that printed sections, whatever the exit code and whatever its new outcome; to a `close phases` line when that line no longer exits 2 or crashes (it printed sections); and to a `touched-phases` line when `touched-phases` exits 0. Append `still failing <date>: exited <code>: <message>` in place to each line that still fails. When every line is resolved, stamp the follow-on `status: done` + `completed: <date>`, so a follow-on never keeps claiming a failure that no longer exists.
   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter.
   - File any follow-on work the rollout's Post-rollout section names (validation re-runs, audits, deferred items) as **new open tasks** in `Work/Tasks/`, and rewrite those items in the rollout note as thin pointers to the new tasks, and add a pointer to any phase-close follow-on filed above. Both kinds of follow-on use the vault's new-task frontmatter (after `_System/Templates/Task.md` and the rollout template's own), never `rollout:`, `wave:`, `phase:` or `owner:`:
     ```yaml
     tags: [task]
     status: open
     priority: normal
     work_depth: shallow
     projects: <copied from the rollout>
     contexts: []
     scheduled:
     due:
     captured: <today>
     ```
   - Append a `## Completion log` to the rollout note: dispatch dates, waves → PRs (links + merge dates), convergence stats per task, **total duration + a per-wave duration breakdown** (read the `timeline` block from `reconcile-wave.py status --rollout <rollout-note>` — it's computed from the `wave_N_dispatched`/`wave_N_merged` stamps), phase closure: phases closed, already closed, ambiguous (with the tool's reason), failed (with the follow-on task link), left open (with the fixed reason), and the disposition of each post-rollout item.
   - Close out the associated thread (run `/thread:close` — a sibling: `${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md`) — or record in the log why it stays open.
   - Delete the rollout's `WAVE-HEARTBEAT` cron if one is registered (`CronList` → `CronDelete`); the heartbeat also self-deletes on its next tick, but don't leave it ticking for up to 20 minutes against a finished rollout.
   - Move the rollout note to `Work/Tasks/Archive/Rollouts/` (`git mv` in the vault) and commit the vault (task, phase, follow-on and rollout notes). Wikilinks resolve by filename, so `[[<slug>]]` references and task `rollout:` backlinks survive the move.

   A done rollout left sitting in `Work/Tasks/` is invisible-but-present — every Bases view filters `status != done`, so it vanishes from view with no record of what happened. The ceremony is what makes completion legible weeks later.

**Cold resume.** Re-invoking `execute [[rollout]]` when `merged_through_wave: N` is set: first re-run § 2.5; then re-run `merge-wave.sh` against wave N+1's already-open PRs (idempotent — merged PRs are skipped, so this flushes any half-merged wave), `mark-done` the tasks whose PRs are now confirmed merged, then continue the loop.

**Reinstate (resuming a paused rollout).** If the rollout note carries a `paused:` stamp, this invocation IS the reinstate — re-run § 2.5 first (a halt there leaves the `paused:` stamp in place, so the heartbeat's paused-stamp check and `/thread:status` still read it as paused); then clear the stamp, deterministically:

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

**No `## File-sets` block?** (an older rollout) the precise smart-halt can't run — fall back to the **coarse** rule: any unlanded task + any later wave ⇒ HALT. Tell the user to `/thread:schedule --regenerate` for precise halting.

### 5. Call the Workflow

This skill instruction is the sanctioned opt-in for the Workflow tool — call it directly:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js",
  args: <the args object above>,
})
```

Pass `args` as an actual JSON object in the tool call. (Note: the Workflow tool delivers `args` to a `scriptPath` workflow JSON-**stringified** — confirmed by smoke test — so the engine parses it defensively with `typeof args === 'string' ? JSON.parse(args) : args`. Don't remove that parse thinking it's redundant.)

**If the Workflow tool refuses the engine path.** Some harnesses refuse the `${CLAUDE_PLUGIN_ROOT}` path with "scriptPath must be a script path this tool returned, or a file you can already read"; a prior `Read` of the file does not help. Fall back to a scratchpad copy:

1. `mkdir -p "<scratchpad>/wave" && cp "${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js" "<scratchpad>/wave/wave-execute.workflow.js"`, where `<scratchpad>` is this session's scratchpad directory.
2. `cmp` the copy against the source. If `cmp` reports any difference, stop.
3. Pass `<scratchpad>/wave/wave-execute.workflow.js` as `scriptPath`.

The engine has no relative imports, so the copy runs unchanged. A `resumeFromRunId` resume re-passes the same `scriptPath` the run started with, exactly like its args. A later session (a new scratchpad) re-copies the same bytes, and per-task resume (`resume-filter`) still keeps the tasks that already landed. Never edit the copy. This is a fallback only: the cache path is the default (the 2026-09-23 E2E ran it unrefused).

Tell the user the run launched, which waves/tasks it covers, and that they can watch live with `/workflows`. Record the returned `runId`. If the run dies, re-run § 2.5 first (a listed repo halts instead of replaying agents that push branches) and § 4's git-env check (a halt there writes nothing), then resume with `Workflow({ scriptPath, args, resumeFromRunId: <runId> })`, passing the `scriptPath` the run started with (unchanged `agent()` calls replay from cache). The check is lead-side only, so the resume's args and prompt bytes are unchanged and the replay cache stays valid.

**Register the heartbeat (continuous mode, once per rollout).** In the same turn as the first wave launch, check `CronList` for an existing `WAVE-HEARTBEAT <rollout-slug>` task; if none, register one via `CronCreate` (schedule `*/20 * * * *`) with this prompt:

> WAVE-HEARTBEAT <rollout-slug>: Read the last WAVE-STATUS line for this rollout in the conversation. If state=done or state=halted (or the rollout note is archived), find this cron via CronList and CronDelete it, then stop. If the rollout note's frontmatter carries a `paused:` stamp, the rollout is deliberately paused — a hard pause emits no halted line, so check the note BEFORE any stall diagnosis: CronDelete this cron and stop; never resume a paused rollout. If a Workflow run for the rollout is still visibly running in /workflows, do nothing — end the turn silently. Otherwise the rollout has stalled (no run in flight, waves remain): re-enter /thread:execute [[<rollout-slug>]] §4.5 resume from the cursor.

This is the backstop for a hung Workflow run or a missed completion notification — the stall mode nothing else catches. Then **end the launch turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=waiting`** so the Stop-hook driver (§8) lets the session idle until the notification arrives.

### 6. Reconcile + report

The workflow returns `{ rolloutSlug, tasks: [{ slug, scope, status, prUrl, branch, worktreePath, reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, reviewHistory, approvedAtCeiling, summary, model, escalated, escalatedAt, gatedInputs }] }` where `status ∈ review | review-blocked | blocked | plan-blocked | gate-pending`, `model` is the FINAL tier the task ran on, `escalated`/`escalatedAt` (`plan` | `implement` | `review`) record an opus→fable escalation, `gatedInputs` lists the declared-but-unapproved gates when the task paused at `gate-pending` (§3.7), `reviewHistory` is the accumulated by-round review-judge rejection rationale, and `approvedAtCeiling` marks an approval on the final review round with real rejection history (a ceiling approval).

**Reconcile with the deterministic helper — do NOT hand-edit frontmatter.** Write the returned object to a temp file (or pipe it on stdin) and run:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-wave.py reconcile --result /tmp/wave-result.json
#   --result -   reads the JSON from stdin instead
```

The helper resolves each task note by slug under `~/repos/obsidian/Work/Tasks/` and performs every per-task write the old hand-edit loop did — **idempotently**, so it's safe to re-run on resume. Per returned `status`:
- any status with `tierCapped: true` → reconcile stamps **`tier_capped: <layer>`** on the task note (never `model: fable` — the run could not use that tier, and stamping it would send the next dispatch back into the exhausted quota). An uncapped re-run that gets further retires the marker. The run was capped by `maxTier` (ADR 0016): a block on that task is **not** evidence of a genuine wall, and it is re-dispatchable uncapped once the higher tier's quota returns. Say so in the report; never let `/thread:repair` read it as input-gated.
- `review` → `status: review`, `pr: <url>`, `review_rounds_used: <n>` (and `plan_rounds_used: <n>` when the task was plan-gated); a ceiling approval (`approvedAtCeiling`) additionally appends the grouped `reviewHistory` under `## Review history (approved at ceiling)` — an audit record, never re-dispatch input
- `review-blocked` → `status: review-blocked`, `pr: <url>`; appends the grouped `reviewHistory` (every round, latest last; legacy results without it fall back to final-round `reviewFeedback`) under `## Review-blocked feedback`
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

Gate-pending (awaiting YOUR sign-off — a declared gate always pauses, ADR 0008):
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

**Merging:** in `--gated` / single-wave mode, do NOT merge — the user decides. In continuous auto-merge mode the lead session merges this wave via `scripts/merge-wave.sh` (§4.5) — never an inline `gh pr merge`. Within a wave the approved PRs are file-disjoint (the wave invariant), so they don't conflict with each other; the merge script brings each up to date with the base branch in turn before squash-merging.

The merge gate is the repo's **required** checks — branch-protection's own definition of mergeable — **not** GitHub's cosmetic `CLEAN` (which also waits on non-required checks). A base branch that legitimately carries red *non-required* checks reports every PR as `UNSTABLE`, never `CLEAN`; gating on `CLEAN` would merge no wave at all. `merge-wave.sh`'s `UNSTABLE)` case handles this by waiting on `--required` checks only — a genuinely-failing required check surfaces as `BLOCKED`, not `UNSTABLE`, so it stays safe. Don't "tidy" it back to `CLEAN`-only (see `giflab-rollout-merge-wave-unstable-fix`).

### 7. Continuous-mode stop conditions

Continuous mode is the per-wave loop (§4.5), not one engine call. It **HALTS automatically** — surface the reason prominently, leave everything merged-so-far landed, end the turn with `WAVE-STATUS: <slug> cursor=<K>/<N> state=halted reason="…"` (§6) so the automatic driver releases (§8), and stop — when:

- a wave produces **zero** approved (`status: review`) PRs (nothing to merge; downstream presumptively unsafe), or
- `merge-wave.sh` exits non-zero (a real merge conflict or red required check), or
- the smart-halt check fires (an unlanded task's file reappears in a later wave), or
- § 2.5, or a §4.5 re-check of it, reports the repo on the landing register, or the check itself fails (`reason="<owner/name> is on the landing register"` or `reason="landing-register check failed"` — a **designed** stop: unlisting is Lachy's call; open PRs stay open and re-invocation after unlisting flushes them), or
- § 4's git-env check finds a repo-local `GIT_*` variable exported in the lead session, or the check itself fails (`reason="git env set in the lead session"` or `reason="git-env check failed"` — nothing is stamped or dispatched; relaunch Claude Code from a shell without them, or put a working `git` on PATH, then re-invoke), or
- §3's round-budget validation finds a `max_iterations`, `max_review_rounds` or `max_plan_rounds` that is not an integer >= 1 (`reason="invalid round budget: <field> on [[task]]"` — nothing is stamped or dispatched; fix the frontmatter and re-invoke), or
- a wave leaves `gate-pending` tasks and nobody is present to sign off (`reason="gated inputs await sign-off: …"` — a **designed** pause, ADR 0008, not a failure: the user signs off, `approve-gates` runs, and re-invocation resumes; when the user IS present, ask for the sign-off in-conversation instead of halting — §3.7).

A **soft pause** (*Pausing + reinstating a rollout* below) exits through the same `state=halted` mechanics but is **deliberate**, not a failure — there is no cause to fix, and reinstating is plain re-invocation.

In every halt case the work merged so far stays on the base branch; the user fixes the cause and re-invokes `execute [[rollout]]` to resume from the `merged_through_wave` cursor. To see *why* a rollout halted, run `/thread:status [[rollout]]` (read-only situational report). To **sort out** a stalled rollout without ceding merge authority, run `/thread:repair [[rollout]]` — it reconciles drift, re-dispatches agent-fixable blocks, captures input-gated decisions, defers wedged tasks, and resumes via this skill's §4.5 loop (`merge-wave.sh` stays the sole merger). `/thread:repair` is the systematised replacement for hand-repairing a worktree in an external cockpit (README → *Coexistence with Orca*).

### 8. Unattended driving — the automatic driver

The §4.5 loop is driven across turns by Workflow-completion notifications — nothing in the notifications themselves *enforces* that it keeps going. The plugin closes that gap with two self-managing pieces; **the user types nothing**:

**The Stop-hook driver** (`hooks/wave-stop-driver.py`, wired via the plugin's `hooks.json`). On every session stop it reads the last `WAVE-STATUS` line (§6) and, while `state=running`, **blocks the stop** and hands back the exact next step (reconcile → merge → advance cursor → launch next wave). It releases on `waiting` (a Workflow run is legitimately in flight), `halted` (§7 — human's turn), and `done`. It is progress-aware: three consecutive blocks without the cursor advancing release the stop and surface "likely wedged — run /thread:status or /thread:repair" instead of spinning forever. This is the programmatic twin of a `/goal` condition, shipped so nobody has to remember to set one.

**The heartbeat cron** (registered by step 5 at first wave launch, `*/20 * * * *`). Catches the one stall the Stop hook can't see: a hung Workflow run or missed completion notification while the session idles at `state=waiting`. Each tick checks; if nothing needs doing it ends silently; if the rollout stalled it re-enters §4.5 cold resume (idempotent — cursor + `resume-filter` + merge-wave.sh's merged-PR skip make re-entry duplicate-free); it deletes itself once the rollout is done, halted, or paused (its prompt checks the rollout note's `paused:` stamp before diagnosing a stall — a hard pause emits no `halted` line, and "stalled" must never re-dispatch a wave the user deliberately stopped).

Division of labour: **Stop hook** = "don't stop while there's driving work"; **heartbeat** = "wake up if the thing you were waiting for never arrives"; **§7 HALTs** = the deliberate exits both respect.

**Manual fallbacks** (when the plugin's hooks are disabled, or driving from an environment without them):

- `/goal The WAVE-STATUS line for <rollout-slug> reports state=done or state=halted, or stop after 4 hours` — transcript-only evaluator, auto-continues a stopped session; always include the time/turn bound and the `state=halted` release clause. Note it will also bounce `state=waiting` turns, so expect some no-op continuations while a wave runs.
- `/loop 45m /thread:status [[<rollout>]]` — read-only watchdog for drift and stranded-`review` tasks (the failure mode that let seven landed tasks sit unnoticed in the giflab rollout); stop it (`/loop stop`) once the rollout archives.

**Guardrails + limits:**

- **Everything here is session-scoped.** The Stop hook and heartbeat cron only act while the session is alive; a closed terminal stops them all (they resume with `claude --resume`). True detachment is a `/schedule` cloud routine — out of wave's scope.
- **Never automate `/thread:repair`** — it is input-gated by design (it asks the user decisions no agent can make); the driver, the heartbeat, and any loop must route a wedged rollout *to* repair, never *through* it.
- **`--gated` mode is exempt from unattended driving** — the per-wave human merge pause is the point. In gated mode end merge-pause turns with `state=halted reason="gated: awaiting user merge"` so the Stop hook releases.
- **A §7 HALT ends unattended driving.** Emit `state=halted` with the reason — the Stop hook releases, the heartbeat self-deletes on its next tick, and a well-worded `/goal` fallback releases on the clause.
- **What none of this fixes:** the blocking waits *inside* single tool calls — the Workflow call (~1h worst case per stubborn task, §Resource budget) and `merge-wave.sh`'s serial required-checks watching — are untouched by any driver.
- **Skill invocation under /loop (fallbacks):** slash-command payloads are invoked normally (`/loop 5m /babysit-prs` is the built-in's own example). The only frontmatter that breaks this is `disable-model-invocation: true` — never add it to `execute` or `status`. (There is no `autonomous:` frontmatter key; that's a myth — verified against the 2.1.199 binary.)
- Cloud providers (Bedrock/Vertex) downgrade dynamic `/loop` to a fixed ~10-minute cadence.

## Pausing + reinstating a rollout

"Pause the rollout" means **soft pause** by default; **hard pause** only when it must stop *now*. Either way the pause is recorded on the rollout note, and reinstating is plain `/thread:execute [[rollout]]` — no separate resume command, no new state machine. Neither pause runs the § 2.5 landing-register gate: stopping work is never blocked, even for a listed repo or a register the check can't read. (Terms: `CONTEXT.md` → *Pause*, *Reinstate*.)

**Soft pause (default).** Stamp `pause_requested: true` on the rollout note's frontmatter (a lead-session edit — it's rollout config, not task status). Nothing is interrupted: the in-flight wave finishes, merges, and advances the cursor as normal; the end-of-wave `cursor` helper then honours the flag — stamps `paused: <timestamp>`, clears `pause_requested` — and the loop exits with `state=halted reason="paused at user request"` instead of launching the next wave (§4.5 step 3, *Soft-pause check*; a partially-landed wave skips step 3's cursor advance, so step 4 honours the still-pending flag before any K+1 launch instead). Zero extra agent calls; the pause lands on a clean wave boundary. To cancel a pending request before it takes effect, remove the `pause_requested:` line (or run `clear-pause`).

**Hard pause (urgent).** Stop the run now — in-flight agents die, but their worktrees keep all committed (and any uncommitted) work. This is a documented protocol, not engine code:

1. Find the rollout's active Workflow run (`/workflows`, or the task list) and **TaskStop** it.
2. Stamp the rollout note by hand: `paused: <timestamp>` in frontmatter, plus a short `## Pause log` body entry with the `runId` and which wave/tasks were in flight — the context the stamp alone can't carry.
3. Delete the rollout's `WAVE-HEARTBEAT` cron (`CronList` → `CronDelete`), mirroring the completion-ceremony step (§4.5). A hard pause emits no `state=halted` line, so the last WAVE-STATUS still reads `waiting` — a live heartbeat would diagnose "stalled" on its next ≤20-min tick and re-dispatch the wave you just killed. The heartbeat prompt's own paused-stamp check (§5) is the backstop if this step is missed, but delete the cron anyway rather than leaning on it.

The killed wave's tasks simply didn't land: their notes still read `in_progress`, so `resume-filter` re-dispatches them on reinstate, and the engine's worktree setup reuses each task's existing worktree + branch (resume-safe by design). Losses are bounded to in-flight agent context — committed work, and uncommitted files sitting in the worktrees, survive.

**Reinstate.** `/thread:execute [[rollout]]`. The resume path (§4.5 *Reinstate*) re-runs § 2.5, then sees the `paused:` stamp, clears it via `reconcile-wave.py clear-pause`, and continues from the cursor — flush any half-merged wave, re-dispatch whatever didn't land. The heartbeat cron re-registers at the next wave launch (§5; the paused rollout's old one is already gone — self-deleted on the soft pause's `halted` line or on its prompt's paused-stamp check, or deleted directly by hard-pause step 3 — so a pause is never auto-resumed by a leftover tick).

A paused rollout is **intentional**, not stalled: `/thread:status` reports it as paused (stamp + since-when + what's left), and `/thread:repair` treats it as nothing-to-fix.

## Don'ts

- Merge ONLY via `scripts/merge-wave.sh`, ONLY in continuous auto-merge mode, ONLY from the lead session. In `--gated` / single-wave mode the user merges. Never an inline `gh pr merge`, never `--admin` (it would bypass branch protection and merge a red branch), never a force-push — ever. The engine (`wave-execute.workflow.js`) never merges.
- Never dispatch a wave, call or resume a Workflow, or call `merge-wave.sh` for a repo the landing register lists. § 2.5 runs first, every time (and §4.5 re-runs it before each of those). Never gate a pause on it: soft and hard pause (TaskStop, the `paused:` stamp, the heartbeat `CronDelete`) are exempt, so the register check never blocks stopping work.
- Don't skip the protocol-version gate. Legacy (v2 / absent) rollouts must be regenerated, not retrofitted.
- Don't update a task's `status:` from inside a subagent — the lead session reconciles after the workflow returns.
- Don't hand-roll the convergence loop in the conversation — that engine moved into `wave-execute.workflow.js`. If the loop needs changing, edit the script and (for an interrupted run) re-invoke with `resumeFromRunId`.
- Don't raise `concurrency` blindly. The Workflow's own cap is CPU-core-based (~14 on the M3) — higher than the memory-safe ceiling for heavy-model tasks (LPIPS ≈ 500 MB/process). `parallel_ceiling: 4` exists to chunk heavy waves so no more than 4 worktrees run at once. Raise it only for light waves.

## Worktree lifecycle (how the engine isolates + reuses worktrees)

**Every task gets ONE worktree, created by its first agent** (ADR 0030, p12-4), at `<repoPath>/.claude/worktrees/<slug>`; every later agent on the task reuses it. A **code-writing** task's tree is its branch `audit-fix/<alias>`, cut from a **freshly fetched** `origin/<default branch>` (`git -C <repoPath> fetch origin && git -C <repoPath> worktree add <repoPath>/.claude/worktrees/<slug> -b audit-fix/<alias> origin/<default branch>` — `main` unless §4's `defaultBranch` is passed) so it includes every prior wave that has already merged. On a plan-gated task the planner creates it (`taskTreeSetup`), so the plan and the code share one base; otherwise the implementer creates it (`worktreeSetup`), exactly as before. A **read-only** task's tree is a detached worktree at the same path, created by its planner when it is plan-gated (`plan_approval: required` gates read-only tasks too, §3.5), else by its investigator. Implementers return the tree's absolute path (`git rev-parse --show-toplevel`) in the structured result; downstream revisers `cd` into that threaded `worktreePath` to reuse it (push to the existing branch, the PR auto-updates). Every setup is resume-safe: it reuses the dir if it already exists and attaches an existing branch rather than failing.

**The five read-only agents read the task tree, never `repoPath`.** The planner, plan judge, plan reviser and investigator are handed `Task tree: <tree>` and enter it with `taskTreeSetup`; the review judge is handed the same path as context only (the PR is authoritative: it reads the tree only when its HEAD equals the PR head and its status is clean, else `gh pr diff` / `gh pr view` alone). The planner and investigator **refresh** a reused tree: after a fetch they fast-forward it to `origin/<default branch>` only when it has no tracked changes and no commits of its own (`merge --ff-only` on a branch, `checkout --detach` only when already detached, so a branch tree is never detached); any skip prints `tree NOT refreshed: <why>; N behind origin/<base> as last fetched` for the agent to quote. The plan judge and reviser never move it. Every `taskTreeSetup` prints `tree base: <sha>`; the plan's first line is `Planned on: <sha>`, and the plan judge compares the two and returns `changes` when a tree recreated or moved since planning no longer backs the plan. A detached tree met by a code-writing task's planner or judge (a read-only → code-writing scope flip on the same slug) is attached to `audit-fix/<alias>`: the existing branch, else a new one at HEAD, so no commit is lost. Agents tidy only what their own verifier run added (a before/after `status --porcelain` diff), never the env bootstrap's output. **`repoPath` is only the anchor and the branch source**; no agent reads its files. `merge-wave.sh` still fast-forwards it after each wave in continuous mode (when it is on the base branch), because the reaper measures task branches against it (Cleanup, below).

**Why explicit, not `isolation: "worktree"`:** the harness's `isolation: "worktree"` worktrees the *session's* git root, not the target repo — from an ops/vault session it would grab `~/repos/workspaces` (the wrong repo) and ignore `repoPath` (verified empirically). Anchoring on `repoPath` makes the engine correct **from any launch location** (vault, ops, or the repo itself) and places worktrees under the target repo where the daily reaper finds them. The Workflow script has no shell, so the task's first agent creates the tree, not the engine.

**Cleanup** is the daily sweep's worktree reaper (`_shared/scripts/daily-sweep.sh` → `prune_worktrees`); the engine does not clean up after itself. Its rules, per worktree under `.claude/worktrees/`:

- It never reaps a tree whose `status --porcelain` is non-empty; untracked files count.
- `ahead` is `rev-list <main checkout's current branch>..<branch>`, measured against the **local** branch, not origin. A branch that reads as ahead is kept unless a merged PR exists for it. A detached tree resolves to `HEAD`, reads 0 ahead, and is reaped once clean.
- It skips a tree whose lock file names a live `pid N`, and unlocks and reaps stale locks.

Every `taskTreeSetup` locks the tree with `pid $PPID` (the Bash tool's parent is the long-lived Claude Code session), re-locking on each render, so **while a rollout session is alive its task trees cannot be reaped**, detached read-only trees included. The consequences:

- Merged-task cleanup waits for the first sweep after the session ends (the lock is then stale).
- A zero-commit `audit-fix/*` tree of a plan-blocked, gate-pending or deferred task reads as ahead while the local checkout lags, and persists until the local base branch advances: `merge-wave.sh` advances it in continuous mode, only the user does in `--gated` mode. Accepted and harmless: re-dispatch fast-forwards the tree.
- In `--gated` mode the session usually ends between waves, so a plan-approved tree can be reaped before its implementer runs; the implementer's setup then recreates it from a newer `origin/<base>` (its verifier and the master review are the backstop). If a future harness makes `$PPID` short-lived, the lock reads as stale at once and a clean tree becomes reapable mid-run; `TASK_TREE_RULE` tells an agent whose tree vanishes to re-run the setup once and say so.
- An **ungated** task that flips from read-only to code-writing on a reused slug has no `taskTreeSetup` before its (GOLDEN-pinned) implementer, which reuses the detached tree without attaching it; its PR step fails and the task blocks with no PR, never silently. It relies on the reaper (after the earlier session ended) or `/thread:repair`'s clean defer removing the tree first.
- Removing a task tree by hand, or in repair's clean defer, needs `git worktree remove -f -f` because of the lock.

(If a target repo ever lives outside `~/repos`, widen the reaper's `find` root.)

## Protocol versions

| Version | Contract | Status |
|---|---|---|
| (absent) / 2 | Legacy in-conversation playbook (prose-driven dispatch + sentinel parsing) | Retired — regenerate via `/thread:schedule --regenerate` |
| 3 | Workflow-engine convergence (`wave-execute.workflow.js`): structured output, in-pipeline parallel review, autonomous plan-gate judge, journaled resume | Current |

Future protocol bumps follow the same rule: a new executor refuses older versions and asks the user to regenerate.

## Resource budget

The engine chunks each wave by `parallel_ceiling` (default 4) so heavy-model waves never run more than that many worktrees concurrently. Convergence multiplies wall-clock, not memory: worst-case per task is roughly `max_iterations × verifier-time × max_review_rounds`. With defaults (3 × 5 min × 4) one stubborn task can occupy a worktree ~an hour. For waves dominated by cross-cutting long-verifier tasks, lower `max_review_rounds` in the rollout frontmatter.

Escalation shifts that arithmetic for `opus` tasks: the opus first pass costs at most one implementation + **one** verifier run, and only an escalated task pays the full fable convergence bill on top (`1 × verifier` + fable's `max_iterations × verifier × max_review_rounds`). Mechanical tasks that land first-shot get cheaper than the old always-iterate profile; proven-hard tasks cost one extra opus pass over pre-stamping them fable.

**Continuous auto-merge adds serial merge time per wave.** Merges into a `strict`-protected `main` can't be parallelised — each merge advances `main`, so the next PR must re-update its branch and re-pass its required checks. Budget ≈ (update-branch + required-checks runtime + squash) per approved PR, **sequentially** — new wall-clock the old "human merges later" path didn't charge to the run.
