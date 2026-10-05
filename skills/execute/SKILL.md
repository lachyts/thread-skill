---
name: execute
description: 'Use to execute a rollout queue — reads the rollout note, resolves per-task config, and runs the convergence engine on the Workflow tool (plan-gate → verifier retry → master review), one task per call up to the parallel ceiling; the lead integrates each approved task with the latest main and is its only merger. Continuous by default; --gated pauses before each merge; a plan-declared gated input always pauses for human sign-off. Triggers on "execute [[rollout-slug]]", "pause the rollout", "reinstate [[rollout]]", or explicit /thread:execute. Only runs `protocol_version: 5` rollouts; older notes are refused with a /thread:schedule --regenerate prompt.'
---

# /thread:execute — run a rollout's queue on the Workflow engine

`/thread:execute` is the executor half of the rollout split. Where `/thread:schedule` writes the rollout note (data), this skill reads it, resolves config, and hands the convergence work to a **dynamic Workflow** script. This skill is a thin shim; the engine lives in `${CLAUDE_PLUGIN_ROOT}/skills/execute/task.workflow.js`.

The engine runs three layers per task — optional plan-gate (autonomous judge) → Ralph-style agent-side verifier retry → master-side review-and-revise loop — and converges **one task per Workflow call**. The lead session **runs the queue** (ADR 0030): it keeps up to `parallel_ceiling` task calls in flight, integrates each approved task with the latest `main` one at a time, and is the rollout's **only merger**. The skill itself stays in the conversation to do vault I/O, the protocol gate, status reconciliation, Integration, merging, reporting and the `--gated` merge hold (which an autonomous background workflow cannot do).

## Native runtime binding

The canonical JavaScript engine also runs through
`~/repos/workspaces/_shared/scripts/native_workflow.mjs`; read the co-located
`native_workflow.md` host protocol before dispatch. It injects `agent`, `pipeline`,
`phase` and `log` and journals native-child requests/results. Claude and Codex
both keep children, nested reviewers and retries in the calling harness/account.
The ladder's model names (each rung's `model`: `opus` / `fable`) require explicit verified
native model bindings; do not silently downgrade a climb to one inherited model.

**Preflight before any task status or owner stamp:** select a supported execution
mode and verify native children, role/model bindings and required project tools.
A session-driven `--gated` run can use the exchange. Use one stable private run
directory; recover claims and bound native IDs on interruption, never dispatch
again because an `advance` call was repeated. The canonical engine still owns
convergence, budgets and gates; the lead still owns reconciliation, Integration and merging.

The continuous detached lifecycle in §8 (Stop hook, heartbeat and cold-resume
notifications) is still a Claude runtime integration. It is **not ported to Codex**
by the exchange adapter. In Codex, a default invocation requiring that lifecycle
must stop at this preflight and report the unsupported driver; do not stamp tasks,
register a substitute cron, or silently reinterpret the invocation as a `--gated` run.
Only a specifically requested session-driven `--gated` run bypasses the detached
driver requirement. Codex has no heartbeat: its session drives. There the verify
command and `merge-task.sh` run in the foreground (`verify --timeout` still bounds the
verifier), and the exit-8 backoff is a foreground `sleep N; merge-task.sh …`.
Existing scheduled jobs and journals retain their runtime.

## Scope

Reads `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` produced by `/thread:schedule` (older undated `<slug>-rollout` notes still resolve — see step 1). The Workflow's agents operate in isolated git worktrees they create under the target repo (`<repoPath>/.claude/worktrees/`) and open PRs. The lead session updates task frontmatter in the vault and, at completion, sets `status: done` on the phase notes the rollout finished and may file a `phase-close-followup-*` task (ADR 0026). Does not touch any other backlog source.

## Invocation forms

```
execute [[giflab-rollout]]                   # run the queue, CONTINUOUS AUTO-MERGE (zero-touch — the default)
/thread:execute [[giflab-rollout]]           # explicit, the same
/thread:execute [[giflab-rollout]] --gated   # the same queue, with a MERGE HOLD before each merge for your go-ahead
```

Bare `execute [[rollout]]` is **continuous**: the lead fills the slots up to `parallel_ceiling`, integrates each
approved task with the latest base branch (`main` unless §4's `defaultBranch` says otherwise) one at a time, and
merges it — no per-PR confirmation. `--gated` is the same queue with a **merge hold** before each merge (§4.5
*Merge hold*): task calls keep running while the lane waits for your go-ahead.

**A wave number is refused.** `execute Wave N of [[rollout]]` prints "single-wave mode is gone (ADR 0030): run `execute [[rollout]]`, or add `--gated` to approve each merge" and stops.

In a live session, "retry [[task]]" re-enters a set-aside task: run `reconcile-rollout.py hand-back --tasks <slug>` (§4.5 *Set aside*), then §4.5 step 1. Its exit 2 means an undecided RACE or UNVERIFIED holds the task: print its ERROR line and stop there, since only Lachy's `RACE decided:` line (through `/thread:repair`) releases it.

## Skill flow

### 1. Read the rollout note

Resolve `[[<slug>]]` to `~/repos/obsidian/Work/Tasks/<slug>.md`. Read frontmatter + body.

The slug is whatever the invocation names. `/thread:schedule` writes rollout notes **always dated** — `<project-slug>-rollout-<YYYY-MM-DD>` for the first rollout of a day, or `<project-slug>-rollout-<YYYY-MM-DD>-<N>` (N≥2) for each subsequent rollout that same day (the first-of-day stays bare-date). Legacy notes from before this rule use the undated `<project-slug>-rollout`; execute still resolves them. The ordinal is purely `/thread:schedule`'s collision-avoidance scheme; execute reads the exact note it's handed and needs no special parsing. If the user names a rollout ambiguously (e.g. "execute today's giflab rollout") and several dated/ordinal notes match, **list the matches and ask which** — don't assume the highest ordinal.

If the frontmatter carries a `paused:` stamp, this invocation is a **reinstate** — see §4.5 *Reinstate* and *Pausing + reinstating a rollout* below.

### 2. Protocol-version gate

**Lineage first, whatever the version**, read as status § 1 and repair § 1 read it: a supersede is how a legacy rollout migrates, so a legacy note can be a close-out, and the version's `--regenerate` would only meet schedule's refusal again.

- `superseded_by:` → print "superseded by [[N]]: run `/thread:execute [[N]]`". Stop.
- Another rollout `[[N]]`'s `supersedes:` names this one (status § 1's reverse-lineage grep): a supersede carried this rollout's unlanded tasks to N, so this note is never reinstated or resumed. N's `incomplete` (`reconcile-rollout.py status --rollout <N's path>`) non-null → print "supersede interrupted: `/thread:schedule <project> --regenerate`"; otherwise → print "close-out interrupted: `/thread:repair [[this]]`". Stop.

Then the version:

- `protocol_version: 5` → proceed.
- Missing `protocol_version`, or `protocol_version: 2` or `3` → print: "This rollout predates the queue (ADR 0030). If a session is running it, hard-pause it (*Pausing + reinstating a rollout*), then `/thread:schedule <project> --regenerate`: the supersede carries every unlanded task into a `protocol_version: 5` queue." Stop. (The legacy prose executor and the stored-cursor engine are retired — there is no engine to fall back to.)
- `protocol_version` other than `5` → print "unsupported protocol version <N>; this executor supports protocol_version: 5" and stop.

**Incomplete check (once, after § 2.7).** Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py status --rollout <rollout-note>` (read-only). A non-null `incomplete` is printed with its remedy, `/thread:schedule <project> --regenerate`, before the first `next` (which refuses the same rollout, exit 1, on its own: § 7).

### 2.5. Landing-register gate

The lead session never starts a task, calls or resumes a Workflow, pushes an Integration, or merges into a
repo on the landing register (ADR 0028 § Decision). Run the register check in
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` § Dispatch blockers (point at it; never copy the
snippet here) against the rollout's `Project root`. `/thread:schedule` § 0 already ran it, but a repo can
be listed after scheduling, so run it again at **every** invocation that starts or continues work (fresh,
cold resume, reinstate, `--gated`), before anything writes or merges: before the §3/§4
stamps, and before §4.5 *Reinstate*'s `clear-pause`.

**Pausing is exempt.** A pause invocation (*Pausing + reinstating a rollout* below) skips this gate
entirely: the soft pause's `pause_requested: true` stamp, and every hard-pause step (the **TaskStop**, the
`paused:` stamp and its `## Pause log` entry, the heartbeat `CronDelete`). The gate never blocks stopping
work: a listed repo, or an exit-2 failure such as a malformed or unterminated register, still lets the
user pause.

**What the gate cannot catch.** It runs lead-side, between engine calls. The re-check runs before every
Workflow call, so a repo listed while a task's Workflow call is in flight is only caught at the next
re-check: until that call returns, its agents keep pushing the task's branch and opening its PR on the
repo. Exposure is bounded to the in-flight calls; no later task call is launched. § 4.5 step 4's re-check
still stops the merge, so nothing lands on the default branch. For an urgent listing mid-rollout, **hard
pause** the rollout (TaskStop kills the in-flight agents now); the exemption above means the gate never
stands in the way of that.

- **Exit 0** (`land`): proceed. Any warning the reader printed on stderr (no register file, a malformed
  entry) still shows; pass it on to the user.
- **Any non-zero exit**: write nothing (no stamp, no `mark-started`, `mark-integrating` or `log-integration`, no
  push, no merge, no Workflow call). Print the snippet's stderr verbatim above the ROLLOUT-STATUS line (the
  `listed <owner/name>: <reason>` line with its remedy, the reader's `landing-register:` error, or the
  no-origin remedy), then end the turn with
  `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="<owner/name> is on the landing register"`
  (exit 3), or `reason="landing-register check failed"` (exit 2 or 4). The reason stays short and
  quote-free for the Stop-hook regex; the verbatim stderr above it says where to go. Unlisting is Lachy's
  call, so this is a designed stop (§7), not something to route around.

"Re-run § 2.5" elsewhere in this skill means exactly this: the same check with the same halt, followed
at once by § 2.6.

### 2.6. Self-rollout gate

A rollout must never run against the checkout the plugin itself runs from. When `repoPath` is a
**directory-source** plugin marketplace path (`claude plugin marketplace add <dir>`), `${CLAUDE_PLUGIN_ROOT}`
IS that checkout, so every engine or skill change a merge lands there becomes the engine of the rollout's
next task call (p12-4, ADR 0030). Run this wherever § 2.5 runs: directly after it at every invocation that
starts or continues work, and after every §4.5 re-check of it. **Pausing is exempt**, exactly as for § 2.5.

```bash
# thread:self-rollout-check (extracted and tested by tests/self-rollout-check.test.sh)
R="<repoPath>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
sc="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh"
[ -f "$sc" ] || { echo "self-rollout-check.sh not found at $sc: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }
bash "$sc" "$R"
# end thread:self-rollout-check
```

`scripts/self-rollout-check.sh` reads `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json`
and compares every directory source's `path` and `installLocation` with `repoPath` (`~/` expanded,
trailing slashes stripped, symlinks resolved) by **containment**: a marketplace path equal to `repoPath` or
nested inside it (`<repoPath>/…`, a monorepo with the marketplace in a subdirectory) matches, since
`merge-task.sh` fast-forwards the whole checkout. A missing registry passes; a malformed one passes with a
warning (the registry format is Claude Code's, so the check fails open).

- **Exit 0**: proceed; pass any warning on to the user.
- **Exit 3**: write nothing (no stamp, no `mark-started`, `mark-integrating` or `log-integration`, no push, no
  merge, no Workflow call). Print the stderr verbatim above the ROLLOUT-STATUS line and end the turn with
  `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="repoPath is a live plugin marketplace checkout"`.
  The remedy: clone the repo to a separate path (e.g. `~/repos/<repo>-rollout`), set the rollout's
  `Project root` to that clone, and re-invoke.
- **Exit 2** (the script not found, an empty `repoPath`, no python3): the same write-nothing halt with
  `reason="self-rollout check failed"`.
- **Any other non-zero exit** (1, 127, …: bash or the script crashing): the same write-nothing halt with
  `reason="self-rollout check failed"`. The gate fails closed on any status it does not define.

### 2.7. Pushed-base gate

Every task worktree branches from a freshly fetched `origin/<default>`, so commits that exist only on a
local default branch (a close-out, an ADR a task cites) are invisible to the agents. Run the pushed-base
check in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` § Dispatch blockers (point at it; never
copy the snippet here) against the rollout's `Project root`, with no cited paths. For `<localPath>`, take
the rollout's first `projects:` wikilink and resolve it with
`find ~/repos/obsidian/Work/Projects -name '<Name>.md'`: with exactly one match carrying a `Local:` line,
use its backticked path; otherwise leave it empty (the marketplace registry still covers the primary
checkout of a self-rollout's separate clone).

**Entry points only.** § 2.7 runs only when this invocation **entered at § 1**: a user turn naming
`/thread:execute` or `execute [[…]]` (fresh, cold resume, reinstate, `--gated` and its
re-invocations), or a router such as `/thread:orient` dispatching this skill. It does **not** run on a turn
whose prompt begins `ROLLOUT-HEARTBEAT` (even when that turn loads this skill), on the Stop-hook
`ROLLOUT-DRIVER` continuation or a Workflow-completion or background-command notification (they continue
the current invocation's loop), on § 5's `resumeFromRunId` resume, or on `/thread:repair` §§ 4 and 6 (they
follow §4.5 directly). When it
runs, it runs directly after § 2.6, before the § 3/§ 4 stamps and before §4.5 *Reinstate*'s `clear-pause`.

It runs at entry points and never per merge: `origin/<default>` moves with every merge, and a close-out
committed on the local default branch mid-rollout must not halt an unattended run. The git-env canary (§ 4.5) honours this: it accepts local commits not on `origin/<default>` when every one is a non-merge commit touching only close-out paths (land.sh's `closeout_shaped`; stricter than its S9, so no merge and no empty commit), so a close-out landed mid-run trips no window; any other local commit, reset or bare flip during a window still does. Only one in `repoPath`
itself is named at each merge (`merge-task.sh`'s local refresh reads `repoPath` alone); one committed in another
clone of the set, such as the primary checkout of a self-rollout's separate clone, is named first when the
next entry at § 1 halts on it with the queued-aware remedy.
"Re-run § 2.5" keeps its meaning (§ 2.5 then § 2.6); it does not include this gate. **Pausing is exempt**,
exactly as for § 2.5.

- **Exit 0** (`pushed`): proceed; pass any `pushed-base: note:` line on to the user.
- **Exit 3**: write nothing (no stamp, no `clear-pause`, no `mark-started`, `mark-integrating` or
  `log-integration`, no push, no merge, no Workflow call). Print the stderr verbatim (the ahead commits per
  clone, and the remedy: land them by PR, or wait for the queued `close/…` landing PR) above the
  ROLLOUT-STATUS line and end the turn with
  `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="local default branch is ahead of origin"`.
- **Exit 2** (a fetch or the default-branch lookup failed, a script not found): the same write-nothing
  halt with `reason="pushed-base check failed"`.
- **Any other non-zero exit** (1, 127, …): the same write-nothing halt with
  `reason="pushed-base check failed"`. The gate fails closed on any status it does not define.

### 3. Resolve effective config per task

For each task as it starts, resolve, in order **task frontmatter → rollout frontmatter → the operator's rollout settings** (`rollout-settings.py --repo <Project root>`: rollouts.toml, then built-in):

| Field | Default | Becomes (in args) |
|---|---|---|
| `verifier` | fail with a message asking the user to provide one | `verifier` (rollout-level) |
| `max_iterations` | resolved (built-in `3`), or `1` if `scope: read-only` | `task.maxIterations` |
| `max_review_rounds` | resolved (built-in `4`) | `task.maxReviewRounds`; also passed to `lead-integrate.py inputs --max-review-rounds` (§4.5 step 1.2, *Restart routing*) |
| `max_plan_rounds` | resolved (built-in `3`) | `task.maxPlanRounds` |
| `plan_approval` | `scope-gated` | drives `task.planGate` (see 3.5) |
| `parallel_ceiling` | resolved by `next` itself when absent (built-in `4`); an unresolvable value (a refused file, a Project root that is not a directory) makes `next` exit 1 | not passed to the engine. `reconcile-rollout.py next` reads it from the rollout note: it must be an integer ≥ 1, or `next` exits 1. The lead's limit on task calls in flight, seeded revises included (Integration holds none, §4.5). |
| `verify_timeout` | `1800` | not passed to the engine. Rollout-level only (a task-level key is ignored): `reconcile-rollout.py verify-timeout` reads it from the rollout note, an integer from 1 to 6600 (seconds), or it exits 1. The `--timeout` of the Integration verify and the RACE re-verify (§4.5); their harness `timeout:` is its `harnessTimeoutMs`, (<verify_timeout> + 600) × 1000. |
| `env_bootstrap` | none (omit) | `envBootstrap` (rollout-level) |
| `ignore_gate` | `false` (omit) | `task.ignoreGate` (per-task) |
| `rung` | the ladder's bottom rung (omit) | `task.rung` (per-task ONLY: the rung the task starts on, ADR 0029 decision 4; reconcile stamps the rung a task reached, §6) |

**The operator's rollout settings (p15-4).** Schedule stamps all four numeric keys on every rollout it writes (schedule step 2.8), so the resolver is only for a key absent at both levels (a legacy note). For such a key the lead runs `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py --repo <Project root>` once per loop entry and reads `settings.<key>.value` from its JSON line (`~/.config/thread/rollouts.toml`'s `[repo."owner/name"]`, then `[defaults]`, then the built-in). Its exit 2 or 3 is the round-budget write-nothing halt: print its stderr line verbatim above the ROLLOUT-STATUS line and end the turn with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="rollout settings refused"`. The fix follows the stderr line: one naming `~/.config/thread/rollouts.toml` (`rollout-settings: <path>:<line>: …`) is fixed at that line, or by stamping the key on the rollout note; one naming `--repo` (the Project root is gone or its origin unreadable) is fixed by stamping the key. Then re-invoke.

**Legacy stamps.** A task note with no `rung:` passes its stale `model:` (task, then rollout frontmatter) and `effort:` (task frontmatter) as `task.model` / `task.effort`, each omitted when absent. The engine reads them only to choose the starting rung (the same mapping a supersede's `carry` writes, schedule § 0: `model: fable`, or `effort: xhigh` or `max`, starts on the top rung; anything else on the bottom one) and never dispatches at them; a note with a `rung:` passes only that. Any other legacy stamp is ignored.

**Validate the round budgets before anything else.** Each resolved `max_iterations`, `max_review_rounds` and `max_plan_rounds` must be an **integer >= 1** — a YAML int, never `0`, negative, fractional, a string, empty or `null` (the resolved value, rollouts.toml then built-in, applies only when the key is absent at every level; an empty `max_plan_rounds:` is null, not absent). On any violation the lead writes nothing: no `status: in_progress` stamp, no `mark-started`, no Workflow call. Name the field, the bad value and its source (task or rollout frontmatter), then end the turn with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="invalid round budget: <field> on [[task]]"` — for a rollout-level value, name the rollout instead of the task. This is the upstream refusal; the engine also fails closed per task (`plan-blocked` / `review-blocked` naming the field) so a bad budget can never silently disable a plan or review layer (ADR 0008).

**Validate `verify_timeout` once per loop entry, before anything the entry writes.** Every entry into §4.5's loop (top-down, *Cold resume*, *Reinstate*, the § 5 heartbeat's re-entry and `/thread:repair`'s hand-off) runs `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py verify-timeout --rollout <rollout-note>` once: after § 2.5 and § 2.6 (and § 2.7 when it runs), before `resume`, `clear-pause`, `next` and any stamp. It is read-only, so a repeat is harmless. Exit 0 prints `{"verifyTimeout": <verify_timeout>, "harnessTimeoutMs": <harnessTimeoutMs>}`, and that entry's verify commands (*The background verify command* and the RACE re-verify) use those values until the next entry: an edit takes effect, or halts, at the next entry, and a verify already in flight keeps its own deadline. The check runs here, never at the verify line. On exit 1 the lead writes nothing (no stamp, no `clear-pause`, `resume` or `mark-*`, no push, no merge, no Workflow call): print its stderr line verbatim above the ROLLOUT-STATUS line and end the turn with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="invalid verify_timeout on [[rollout]]"`. A halt at *Reinstate* leaves the `paused:` stamp in place.

`scope:` is read directly from each task's frontmatter (set by `/thread:schedule`). `completion_sentinel` is no longer used — the Workflow returns validated structured output instead of parsing sentinel strings.

`env_bootstrap` (rollout-level) is an optional shell command the engine runs once per worktree so agents start from a working interpreter + deps (e.g. `poetry env use 3.11 && poetry install`) — read it from the rollout frontmatter and pass it as `envBootstrap`; **omit the key when absent** so the worktree-setup prompt stays byte-identical (resume-cache invariant). `ignore_gate` (per-task) is an explicit override for a task note that carries a human/release gate in prose ("don't action until a release ships"); when `true`, pass `ignoreGate: true` on that task so the engine tells the agent the gate is overridden for this run — **omit/false** otherwise.

A rollout note that still carries `max_tier:` (any value, an empty one included) gets one warning per invocation, "`max_tier:` ignored; the ceiling is the ladder's top rung", and nothing is passed to the engine.

**The ladder, at each call's start (ADR 0029 decision 6).** Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py` at the start of each Workflow call that starts agents — a start or restart (the task's own call), a seeded revise, and each integrate call — and pass its stdout JSON, verbatim, as `args.ladder`. It runs before any stamp for that call: for a task call before § 4's `status: in_progress` and `owner:` stamps and `mark-started`; for an integrate call before its `startedAt` stamp (step 3's `mark-integrating` already stands, so a refusal leaves the lane on the task's `integrating:` stamp, and a cold resume re-enters it first). The lead's clean Integration (`lead-integrate.py prepare` and `push`) starts no agent and needs none. A resume — *Lost call*'s `resumeFromRunId`, or § 3.7's signed-gate resume — re-passes its call's own ladder with the rest of its args, never a fresh read, so a ladder edit reaches a task at its next call. On any non-zero exit (2: the file is refused; 3: it needs python >= 3.11), write nothing for that call: no stamp, no `mark-started`, no Workflow call. Print its stderr line verbatim above the ROLLOUT-STATUS line and end the turn with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="ladder file refused"`.

**Climbing the ladder (ADR 0029 decision 3).** A rung is a model plus three efforts: `effort` for the code-writing roles (planner, plan reviser, implementer, reviser, read-only investigator), `judge` for the plan gate and `review` for the master review. Every dispatch runs on the task's **current** rung, **judges included**, so a climb moves the model and every role's effort at once. Each stage — plan, implement, review — climbs **one rung** at its first evidence of hardness (a planner that produced no plan, a plan-judge `changes`, a red one-shot or a blocked first implementer pass, a blocked investigator, a review-judge `changes`), **once per stage** in a call and **never past the top**; on the top rung the climb is **a recorded no-op**. A gate stop and a dead agent are never evidence. Below the top a stage's first pass is **one-shot**: one implementation with a **single** verifier run (the `max_iterations` budget does not apply), and **only below the top on a stage's first pass**; the retry after a real climb takes the task over one rung up with the full Ralph loop and the full `max_iterations`. Every pass on the top rung runs the full loop, so its first pass has already spent a full budget: **a top-rung retry is a same-rung second pass that keeps `CAPPED_RETRY_ITERATIONS` (2)**, and the planner and the read-only investigator retry once on the same rung. Climbs are **durable**: reconcile (§6) stamps the reached `rung:` on the task note, so a resume or `/thread:repair` re-dispatch starts there and never re-pays the lower rungs. There is no rollout- or task-level effort knob: the ladder is the operator's (ADR 0029), and tuning it is an edit to `~/.config/thread/ladder.toml`, never to the engine or a rollout.

### 3.5. Resolve the plan-gate per task → `task.planGate` (boolean)

- `plan_approval: off` → `planGate: false`
- `plan_approval: required` → `planGate: true`
- `plan_approval: scope-gated` → `planGate: true` iff `scope: cross-cutting`; `single-file` and `read-only` → `false`

(`/thread:schedule`'s gated-input sweep may have stamped `plan_approval: required` on tasks that smell of spend/credentials — that per-task frontmatter wins here as usual. It is advisory: it guarantees a plan-gate exists where the plan's own declaration can pause; the declaration itself is authoritative — §3.7.)

### 3.7. Gated inputs — the unconditional human stop (ADR 0008)

Every plan the engine's planner produces must carry a **`### Gated inputs`** section — API spend (with a **hard cap**), credentials, irreversible actions, or exactly `None`. Gates are **top-level markdown bullets, one per line**; prose, footnotes, and nested sub-bullets in the section are commentary the engine ignores (ADR 0013). A missing section — or one with no bullet gates and no exact `None` — is a plan-judge `changes` (and the engine fails closed to `plan-blocked` if a judge ever approves one anyway). After the plan-judge approves a plan, the engine compares the declared gates against the task's **approved gates** and, if any declared gate is not yet approved, returns the task at **`status: gate-pending`** without implementing — **regardless of `plan_approval` config or continuous mode**. Tasks with no plan-gate are covered by the same rule reactively: every code-writing prompt carries a stop rule, so an implementer that finds an undeclared/unapproved gated input stops *before* the gated action and returns it in `gatedInputs`, which the engine converts to the same `gate-pending` stop. A gate stop is a human decision, not evidence of hardness — it never climbs.

**Resolve `task.approvedGates` when building args (step 4):** read the task note's `## Approved gates` section; each bullet, with its `(approved …)` annotation stripped, becomes one entry. Omit the key when the note has no such section. The engine skips the stop for exactly these gates (whitespace/case-insensitive match; **a changed cap is a NEW gate**). Declared gates arrive bullet-clean — markers stripped, soft-wraps rejoined (ADR 0013) — so an approval matches only that exact text. The approval is durable on the note, so re-dispatches and resumes never re-ask.

**Sign-off flow (the pause continuous mode makes for gated tasks):** reconcile (§6) writes the declared gates under `## Gated inputs (awaiting sign-off)` and sets `status: gate-pending`. Present each gate **verbatim** to the user and ask for sign-off — this pause is **designed** (ADR 0008), not a failure. On sign-off run:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <slugA,slugB>
```

(moves the pending gates to `## Approved gates` with the sign-off date — gate + cap + sign-off — and flips the note by the stage it stopped: `review` at Integration, else `in_progress`). Until then the task is **set aside** (§4.5 *Set aside*): its slot frees, its dependants wait and the queue runs on. After `approve-gates`, the task re-enters at the stage it stopped (ADR 0030 decision 4): while the lead holds its signed-gate handle it resumes its gate-pending call, on the plan the human signed; a stop at Integration rejoins the Integration queue; otherwise it takes a fresh call behind a printed warning (the four parts below). If the user declines a gate, defer the task or leave it set aside. If nobody is present to sign off, the task stays set aside: the queue runs on, and § 7's stuck halt names it once nothing else can start (`reason="gated inputs await sign-off: [[task]]"`). `next` never starts or restarts a `gate-pending` note, so no unattended re-entry (heartbeat included) can bypass or spam a pending gate — only `approve-gates`, run after an explicit human sign-off, makes the task startable again. The approved cap is a **ceiling** the implementer must respect; blowing it is a verifier/review failure, not a re-ask.

**Stage routing by `approve-gates`.** It reads the stage before it flips the status: the `## Integration log`'s last line, paired with `status: gate-pending` (the rule `lead-integrate.py inputs` applies). A stop at Integration (that last line `set-aside`, and a `pr:`) goes to `review` with `ready:` restamped: it rejoins the Integration queue at §4.5 step 1.4, where `prepare` reads the latest main. Its integrate call is never resumed: Integration must re-read the latest main (ADR 0030 decision 3), and the fresh integrator reads `## Approved gates`, so an unchanged gate is not re-asked. Every other stop (its own call, or a seeded revise) goes to `in_progress` with a `gates_signed: <now>` marker: the next `next --running` lists it in `restart`, and §4.5 *Restart routing* resumes it. The restart's `mark-started` removes the marker and prints `<slug>: signed-gate restart …`, so only the restart that directly follows a sign-off, in whichever session, can print the fresh-call warning below.

**The signed-gate handle.** When a task call (its own call or a seeded revise) returns `gate-pending`, the lead keeps four things in this session's record: its `runId`, its `scriptPath`, the exact args object it was launched with, and the `shasum -a 256 <scriptPath>` recorded with that runId just before its Workflow launch (§4.5 steps 1.2 and 1.3, and *Lost call*), never one taken at reconcile: an engine change between the launch and the stop would otherwise pass unseen. The handle is dropped once it is resumed, or when the task is deferred or re-dispatched any other way. It lives only in this session: compaction or a new session loses it, which is safe (*Can no longer resume*, below).

**Signed-gate resume.** From *Restart routing*, while this session holds the handle, after §4.5 step 1.3's restart sequence (it has run § 2.5, § 4's git-env check, the stamps and `mark-started`, and a resume passes no fresh `progress`): `shasum -a 256 <scriptPath>` again (a sha other than the handle's, or no file, is *Can no longer resume*), then the canary arm (§ 4.5 *Git-env canary*, `--kind task`; a non-zero exit halts and resumes nothing), then:

```
Workflow({ scriptPath: <the handle's scriptPath>, args: <the handle's args, with task.approvedGates set from the note's ## Approved gates>, resumeFromRunId: <the handle's runId> })
```

Every agent up to the stop replays from cache. A plan-gated task implements the plan the human signed; an implementer or reviser that stopped replays its stop, and the engine re-dispatches it past the sign-off (`SIGNED_GATES_RESUME`), once for each signed gate it has not yet passed at that site, so an agent that finds gates one after another goes on past each sign-off and a stop that repeats a passed gate takes the old path. Print `[[task]] → resumed on its signed plan (run <runId>)` (§ 6) and record the new `runId` against the task; drop the handle. `task.approvedGates` is the **one sanctioned exception** to "a resume re-passes the run's ORIGINAL args unchanged" (§ 4, § 5): the engine reads it only in its gate filter and it never reaches a prompt (`skills/execute/tests/approved-gates-resume.test.mjs` renders every prompt with and without it). **Never rebuild** a resumed call's args from the note: a climb's `rung:` stamp or a ladder edit (a fresh `ladder.py` read) changes prompt bytes or opts and re-runs the plan, and a fresh `progress` line is an args change the exception does not cover. The resume keeps its call's own `ladder`. A call that dies after the resume is a plain *Lost call*: it resumes the new `runId` with these same args.

**Can no longer resume.** Four cases: no handle (another session, or the record was lost), the script's sha differs, the script file is gone, or the Workflow tool refuses the resume. The task then takes a fresh call: *Restart routing*'s seeded revise when `resumeAt: revise`, else its own call. On the restart whose `mark-started` printed `signed-gate restart`, the lead first prints:

```
[[task]] restarts on a fresh call, not a resume of its gate-pending call (<why>): it re-runs from its first agent (a plan-gated task's plan is re-judged), and a gate it words differently from ## Approved gates, a changed cap included, is asked again.
```

### 4. Stamp in-progress + build args

**Git-env check (before any stamp).** Agents and verifiers inherit this session's environment. A `GIT_DIR`, `GIT_WORK_TREE` & co. exported here (a git hook or a `git -c` wrapper launched Claude Code) overrides every `git -C` the engine renders and every scrub an agent forgets: its git commands, the verifier's and `merge-task.sh`'s run against whatever repository the variable names (the 2026-09-23 leak, p12-3). The engine prefixes each rendered command with `unset $(git rev-parse --local-env-vars 2>/dev/null);`, but only this session can check the environment it hands down. Run this first, before every stamp (§4.5 step 1, *Lost call*, and § 5's resume):

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

`$vars` only proves the list is readable; the loop iterates the command substitution itself, because zsh (the Bash tool's shell on macOS) never word-splits a parameter expansion. On **any non-zero exit, write nothing**: no stamp, no `mark-started`, no Workflow call. Print its stderr verbatim above the ROLLOUT-STATUS line and end the turn with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="git env set in the lead session"` (exit 1) or `reason="git-env check failed"` (exit 2).

Before every task call — a start, a restart and a seeded revise alike — stamp `status: in_progress` and `owner: <session-tag>` on the task's frontmatter (it blocks duplicate starts). Keep this in the lead session — subagents never write task `status:`. In the launch message, **flag any task expected to gate** (a `plan_approval: required` stamped by `/thread:schedule`'s gated-input sweep, or a note that smells of spend/credentials) so the eventual `gate-pending` pause is expected, not a surprise (§3.7).

Build the args object for each task call:

```jsonc
{
  "rolloutSlug": "giflab-rollout",
  "repoPath": "/abs/path/to/repo",      // from the rollout's "Project root" line
  // "defaultBranch": "master",           // ONLY when the resolver below prints something other than
                                          //   "main"; absent for main repos like this giflab example
                                          //   (byte-identical prompts)
  "verifier": "make test",               // resolved rollout-level verifier
  "date": "2026-05-29",                  // pass it in — Date.now() is unavailable in the script
  "knownBaselineFailures": [              // from the "## Known baseline failures" block; omit when none
    "test_color_reducer_functionality — ImageMagick 0-byte output (pre-existing, env)"
  ],
  "envBootstrap": "poetry env use 3.11 && poetry install",  // from rollout `env_bootstrap:`; OMIT when absent
  "ladder": { "source": "/Users/<you>/.config/thread/ladder.toml",   // ladder.py's stdout, verbatim,
    "rungs": [ { "name": "opus-high", "model": "opus", "effort": "high", "judge": "high", "review": "xhigh" },
               { "name": "opus-xhigh", "model": "opus", "effort": "xhigh", "judge": "high", "review": "xhigh" } ] },
                                          //   read at THIS call's start (§ 3); "source": "built-in" when
                                          //   there is no file. A resume re-passes its call's own ladder.
  "progress": "progress: 2/6 merged, 1 running, 3 queued — 42m elapsed, ~50m remaining (rough)",
                                          // optional; the progress line `mark-started --rollout` or
                                          //   `next` prints (reconcile-rollout.py) — the engine log()s it
                                          //   verbatim (its sandbox has no clock); OMIT when none was printed
  "task": { "slug": "giflab-fix-x", "taskPath": "/abs/.../giflab-fix-x.md",   // ONE task per call
    "scope": "single-file", "planGate": false,
    "maxIterations": 3, "maxReviewRounds": 4, "maxPlanRounds": 2,  // positive integers only (§3)
    "ignoreGate": false,                 // per-task; omit/false unless overriding a human/release gate
    "rung": "opus-high" }                // per-task, the note's `rung:` (§ 3): the rung it STARTS on. OMIT when
                                         //   absent (the bottom rung, or § 3's legacy model/effort mapping).
                                         //   The engine climbs from here, once per stage (§ 3).
}
```

**Resolve `defaultBranch` when building each task call's args** — it is the repo's GitHub default branch, the one source the whole rollout shares: fresh worktrees branch from `origin/<it>`, `gh pr create` targets the same default on its own, and `merge-task.sh` refuses a PR that targets anything else. Ask the **remote**: the local `refs/remotes/origin/HEAD` is often unset and can be stale (it survives a default-branch rename and even the deletion of the branch it names). The answer is deterministic, so a resume re-passes the same value. **Stop** when the remote does not answer — never assume `main`, which fails at the first worktree of a `master` repo:

```bash
# thread:default-branch-resolver (extracted and tested by tests/default-branch.test.sh)
R="<repoPath>"
db="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/default-branch.sh"
if [ ! -f "$db" ]; then echo "default-branch: script not found at $db (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
bash "$db" "$R"
# end thread:default-branch-resolver
```

Pass the printed name as `defaultBranch` only when it is not `main`. Any non-zero exit stops: 1 means the remote did not answer, 2 means `scripts/default-branch.sh` was not found or `<repoPath>` was left empty. A resume (`resumeFromRunId`) re-passes the run's ORIGINAL args unchanged — adding `defaultBranch` to a run that started without it changes prompt bytes and re-runs cached agents. The one sanctioned exception is § 3.7's signed-gate resume, which adds `task.approvedGates`: it never reaches a prompt.

Also read the rollout note's **`## Known baseline failures`** block (`/thread:schedule` step 2.6): when it lists tests (not `none`/empty), pass them as `knownBaselineFailures: ["<test_id> — <reason>", …]`. The engine threads the manifest into every agent and shifts the Ralph green criterion to "no NEW failures beyond this set" — it keeps running the full verifier and never `--deselect`s the listed reds (per the project's `CLAUDE.md`: a comparison reference, not a mute button). Omit the key when the block is absent or `none` — the engine then behaves exactly as before (`verifier` exit 0 = pass).

- **Continuous** (`execute [[rollout]]`, no flag — the DEFAULT) → the §4.5 queue: up to `parallel_ceiling` task calls in flight, one Integration at a time, and each approved task merged as soon as it integrates. This is the zero-touch path.
- **`--gated`** → the **same** queue with a **merge hold** before each merge (§4.5 *Merge hold*): the lane waits for your go-ahead while task calls keep running. The escape hatch for eyeballing PRs before they land.

> Correctness comes from **Integration** (§4.5 step 3), not from a barrier: before an approved task merges, the latest `origin/<default branch>` (`origin/main` unless `defaultBranch` says otherwise) is merged into its branch and verified, so nothing merges from a base older than the `main` it lands on (ADR 0030 decision 3). A frozen base silently re-created the #30/#31 squash-drop exposure; Integration replaces it, and GitHub's update-branch, for every repo, CI or none.

### 4.5. The queue — the lead's loop (ADR 0030)

The lead session is the conductor: it starts tasks up to the parallel ceiling, integrates each approved task with the latest `main` one at a time, and merges it. The loop is driven across turns by Workflow-completion notifications, background-command notifications and the heartbeat (§ 5). The task notes are its only state (there is no cursor), so any entry resumes it.

**Landing-register re-check.** Every entry into this loop (top-down, *Cold resume*, *Reinstate*, the § 5 heartbeat's re-entry, `/thread:repair`'s hand-off) re-runs § 2.5 before anything else it does, and the loop re-runs § 2.5 before every Workflow call (a task call, a seeded revise, an integrate call, a *Lost call* `resumeFromRunId` resume, a restart), before every Integration push and before every `merge-task.sh` call (a merge-hold release and a backoff included); each of those re-runs is followed at once by § 2.6's self-rollout gate. A halt leaves open PRs open and any `paused:` stamp in place. Every entry then runs § 3's `verify_timeout` check once, before anything it writes; the lane uses that value until the next entry. Then, once per entry and still before `resume`, `clear-pause`, `next` or any stamp, it runs the canary's `check-all` (*Git-env canary*): a non-zero exit halts.

**Slots and the lane.** A **slot** is one task's own Workflow call — a start, a restart or a seeded revise — held from its launch until its row is reconciled; at most `parallel_ceiling` run at once (`next` reports `ceiling` and `slotsInUse`). Integration holds **no slot**. One Integration runs at a time, in **the lane**: it is held from step 3's `mark-integrating` until step 4 resolves (a merge, a set-aside or a halt), and a merge hold, a backoff and the RACE procedure keep it held.

**Git-env canary.** A lead-side check that the shared checkout did not change under a launch (ADR 0030 Consequences; `scripts/git-env-canary.py`). A **window** runs from a launch's `arm` to its `check`: every Workflow call (a start, a restart, a seeded revise, an integrate call, a *Lost call* or § 3.7 resume), the lead's own Integration verify and each RACE re-verify. `arm` records `repoPath`'s `refs/heads/<B>` and its effective bareness, in records kept outside the repo; `check` compares them when the window ends. Every call passes `--rollout <rollout-note>`, and `--repo <repoPath> --default <B>` where the verb takes them (`arm` and `check` add `--slug <slug> --kind task|integrate|verify|race-verify`); the canary refuses a `--repo` other than the rollout's `Project root` and a `--default` other than the one its records and trip lines name.
- **The owner rule.** A window can only be open while its vault owner holds: a task call's note reads `in_progress`; an integrate call's, a verify's or a RACE re-verify's note carries `integrating:`. Once the owner no longer holds, any canary verb compares the window once and closes it, so a hard pause's TaskStop'd calls, a crash between `arm` and launch and a dead call's window all end.
- **The close-out rule.** A local commit not on `origin/<B>` is benign only when every one is a non-merge commit touching only land.sh's `closeout_shaped` paths, stricter than S9: no merge commit and no empty commit (§ 2.7). Any other local commit, a reset behind origin, a deleted ref or a bare flip during a window is a trip.
- **What a trip does.** It appends a `git-env trip` line to the rollout note's `## Git-env log`. Until `/thread:repair` (its git-env step, 3e) records Lachy's ack (a `git-env ack` line), `next` reports `gitEnvHold` and `halt: "git-env"`, every canary verb exits 3 and `carry` refuses the rollout. Never ack from execute.
- **The exit rule.** Any non-zero exit halts: exit 3 `reason="git-env trip: the shared checkout changed"`, anything else `reason="git-env canary failed"`, stderr printed verbatim above the ROLLOUT-STATUS line. A halt here writes nothing more, except the one write below.
- **Arm sites**, each right before its launch, once that launch's args and ladder are built, next to its `shasum -a 256 <scriptPath>`. `<B>` is that call's `defaultBranch`, else `main`, or `prepare`'s `--default` for a lead verify. They are: step 1.2's seeded revise and step 1.3's start and restart, *Restart routing*'s fresh-call routes included (`--kind task`); *Lost call*'s `resumeFromRunId` and § 5's resume (`--kind task`, or `integrate` for an integrate call's resume); § 3.7's signed-gate resume (`--kind task`); step 3's integrate call (`--kind integrate`); step 3's `verify`, before *The background verify command* (`--kind verify`); and the RACE procedure, after its `## Race log` line and before its re-verify (`--kind race-verify`).
- **Check sites:** step 2, when a task call returns (`check`, then reconcile the row whatever the exit); the integrate call's return (`check`, then reconcile the row whatever the exit, and act on no `integration.outcome` after a non-zero check); the verify rc, before `push` or `undo`; the RACE rc, before `mark-done`; a *Lost call* resume that returns a row (`check` for the resume's window, `task` or `integrate`, then reconcile the row whatever the exit); and a dead call's lead-written row (*Lost call*: `check` for that call's window first). Every other orphan closes through the owner rule. Check each window once: `check` on a closed window (a tombstone an earlier window of the same slug and kind left) trips `record not armed`, because the owner holds at its own check, so that window was never armed.
- **check-all sites:** every loop entry, once, after § 3's `verify_timeout` check and before `resume`, `clear-pause`, `next` or any stamp (top-down, *Cold resume*, *Reinstate*, the heartbeat re-entry and repair's hand-off); step 3's start, before `mark-integrating`; before EVERY `merge-task.sh` launch (step 4, the *Merge hold* release, the *Backoff* chain, the exit-6 re-run and the 143/130/129/missing-sentinel re-run); before any step-4 route other than 0/5/2/70; and completion step 5, before the sweep, then `retire` before the archive move.
- **The merge-result rule.** Before routing ANY merge-task result (step 4's sentinel table, a merge-hold release's result, each backoff result, and § 5 heartbeat clause (4)'s "act on it as §4.5 would"), run `check-all`. Exit 0 routes by the table as written. Any non-zero exit, or a non-empty `gitEnvHold`, takes **the hold route**: 0 → `mark-done`; 5 → the `## Race log` line only, written as `- <now> [[<slug>]] <the script's RACE line>; re-verify not run: git-env halt`, with no re-verify; 2/70 → halt; `failed:git-env:<rc>` → halt by the exit rule (rc 3 the trip reason, any other `git-env canary failed`); anything else does nothing: no step 3, no re-run, no backoff, no merge hold, no set-aside row.
- **The lane-free rule.** Any canary trip or failure at a lane-holding site frees the lane (this session's state): the integrate arm after `mark-integrating`, *Lost call*'s `integrate` arm, the verify arm after `prepare` merged M, the race-verify arm, the integrate, verify and RACE checks, and the pre-merge `check-all`. The note keeps `integrating:`, except where a reconciled row removed it. After a verify-arm or verify-check trip the lead first runs `lead-integrate.py undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`. After the ack, at an integrate or verify site or the pre-merge `check-all` (no `## Race log` line names the slug), the next entry re-enters the task through step 3's `prepare`, which re-derives the case from the PR head and the `## Integration log`: **case (i)** when the PR head is still the anchor (a verify-arm or verify-check trip after `undo`, which wrote no `log-integration`; the integrate arm before any push; the pre-merge `check-all` on the `merge` route's case (i), where `prepare` tests `H == A` first); **case (ii)** when a pushed Integration was logged (the pre-merge `check-all` after a verify-green `push` and `log-integration`, or an integrate call's reconciled `integrated` row); and **`trouble []`** after a pushed shared-file merge that has no log line. An integrate call's reconciled `rejected` row goes to step 1.2's seeded revise instead, and a reconciled set-aside follows *Set aside*'s re-entry rules. At a RACE site (the race-verify arm, the RACE check, the hold route's exit 5) the PR is already merged and `## Race log` names the slug with a `git-env halt` line: after the ack, `next` moves the task to `raceHold`, and step 1.1 halts `reason="RACE undecided: [[<slug>]]"` once the lane is free. That is on purpose: main holds a combination nobody verified, and a re-verify is never re-run automatically after a human-visible git-env halt. Repair § 3e hands such a slug straight to § 3c.
- **The one write a git-env halt makes** is the `git-env halt` line on the `## Race log` at a RACE site, evidence like the hold route's exit-5 line: `- <now> [[<slug>]] re-verify not run: git-env halt` when the race-verify arm exits non-zero, `- <now> [[<slug>]] re-verify stopped: git-env halt (rc <rc|absent>)` when the RACE check exits non-zero, and the same `re-verify stopped` line for any RACE rc that arrives after a git-env halt in this session, whatever its check says. That rc is never acted on: no `mark-done`.

```bash
# thread:git-env-canary (extracted and tested by tests/git-env-canary.test.sh)
gc="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py"
[ -f "$gc" ] || { echo "git-env-canary.py not found at $gc: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }
python3 "$gc" <verb> --rollout <rollout-note> <its flags: --repo <repoPath> --default <B> [--slug <slug> --kind <kind>]>
# end thread:git-env-canary
```

**The loop**

1. **Fill the slots.**
   1. Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py next --rollout <rollout-note> --running <this session's live task-call slugs, comma-separated; "" when none>`. On exit 1, print its ERROR line verbatim and halt (§ 7). Do not act on its `halt` yet. Its `raceHold` is read now: if it names a `RACE` task and the lane is free, halt (§ 7) with `reason="RACE undecided: [[<slug>]]"`. Main holds a combination nobody verified, and only Lachy's `RACE decided:` line (through `/thread:repair`) releases it. The lane is this session's own state, and this session's RACE procedure keeps it held, so a re-verify in flight here never halts on its own task. An `UNVERIFIED` entry stays set aside like any other: its dependants wait and the queue runs on. Its `gitEnvHold` comes first of all: while it is non-empty (`halt: "git-env"`), halt at once (§ 7) with `reason="git-env trip: the shared checkout changed"` and launch nothing, whatever the lane or live calls say: no seeded revise, no start or restart, no *Lost call* `resumeFromRunId` (§ 5's resume sentence included), no § 3.7 signed-gate resume, no integrate call, no Integration verify or RACE re-verify and no merge-task. After that halt, in-flight returns still run their check and are reconciled, and a RACE rc gets its `git-env halt` line (*Git-env canary*); nothing else happens.
   2. **Seeded revises (automatic), before any halt verdict.** Skip this when `paused` or `pauseRequested` is set. For each `setAside` entry with `setAsideAt: run` and status `blocked`, in `next` order, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py inputs --note <task note> --max-review-rounds <§ 3's max_review_rounds> --repo <repoPath>`. Launch one only when it reports `autoRevise: true`, and only while `slotsInUse` (live plus restarts) plus the revises already launched in this step is below `ceiling`; otherwise it waits, blocked, for a later step 1. A launch is: § 2.5, § 3's config, stamp `status: in_progress` and `owner:` (§ 4), `mark-started --tasks <slug> --rollout <rollout-note>`, `shasum -a 256 <scriptPath>` (recorded with the call's runId, § 3.7), the canary arm (*Git-env canary*, `--kind task`; a non-zero exit halts and launches nothing), `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py plan --note <task note>`, then the Workflow call with § 4's task object plus `resume: {stage: 'revise', prUrl: <inputs.pr>, branch: <inputs.branch>, worktreePath: <inputs.worktreePath>, reviewHistory: <inputs.history>, reviewRoundsUsed: <inputs.lastRound>, plan: <plan.plan>}`, where `plan.plan` is the `plan` output's `plan`, passed verbatim as the same JSON string, never retyped, summarised or truncated. A `revise stopped:`, review-blocked or out-of-rounds note is never launched here: it waits for `hand-back` (*Set aside*). If any revise launched, re-run `next --running <the live slugs, them included>` and use that output from here on. **Automatic descope (p14-4).** Skip it when `paused` or `pauseRequested` is set. For each `setAside` entry with status `plan-blocked` whose key this session has not judged (the key: its slug, its highest `## Plan-blocked feedback` run number and that run's `<!-- run <n> end sha=… -->` sha, held for the session's life, so a heartbeat or another loop entry never re-judges it, and a new run or sha does), read its note and judge whether the feedback centres on one part of the task that the note marks optional ("consider", "optionally", "nice to have") or that a later task in this rollout owns or replaces; the key is judged either way. When it does, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py descope --tasks <slug> --rollout <rollout-note> --part "<a verbatim quote>" (--optional --short <kebab> | --owner <owner slug> --owner-quote "<a verbatim quote from the owner's note>") --reason "<one line>"`, which checks that judgement and writes the records (the follow-up note, the note's `## Scope decision (automatic)`, a brief pointer, an `(automatic)` `## Repair input` line, `descope_armed:` and a rollout `## Notes` line): exit 0 → `hand-back --tasks <slug>` and print § 6's descope line, then re-run `next --running <the live slugs>` and use that output from here on (the task restarts in sub-step 3, its own call, and its `mark-started` prints `descope restart`); exit 3 → leave it set aside and print its `ASK:` line: `/thread:repair` asks Lachy (required scope, an ADR decision, a recorded decision, an owner that cannot take it, or a second block after an automatic descope); exit 1 → print its ERROR line and leave it set aside. The verb, not the lead, makes it once per task: a block after the restart always asks (repair § 2's **plan-blocked after a descope**, never a silent hand-back).
   3. For each slug in `restart`, then each in `start`: § 2.5, § 3's config, stamp `status: in_progress` and `owner:` (§ 4), `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py mark-started --tasks <slug> --rollout <rollout-note>`, then the call *Restart routing* chooses for a restart; a start is always the task's own call (§ 5). For a fresh call (a start, or a restart's seeded revise or own call) mark-started's `progress:` line becomes the args `progress`. A resume is exempt: *Lost call* and § 3.7's signed-gate resume re-pass the args of the call they resume (the handle's, for a signed gate), so its `progress:` line is shown to the user, not passed. Just before each task call's Workflow launch, a resume included, take `shasum -a 256 <scriptPath>` and record it with the returned runId (§ 3.7 *The signed-gate handle*). Next to it runs the canary arm (*Git-env canary*: `--kind task`, or `integrate` for an integrate call's *Lost call* resume); a non-zero exit halts and launches nothing.
   4. If the lane is free, take `next`'s first `integrating` task, else its first `awaitingIntegration` task, through step 3 (and step 4 when step 3 reaches it in this turn), then come back here. A soft pause still drains here: what has a PR integrates and merges.
   5. **Halt guard (last).** Act on the current output's `halt` only when the lane is free, no task call is live and sub-step 2 launched nothing; otherwise end the turn `waiting`. `complete` → step 5; `stuck` → § 7; `paused` → halt with `reason="paused at user request"`; `empty` → report that the rollout links no task and halt with `reason="the rollout links no task"`.
   6. End the turn `waiting` while anything is in flight or a merge hold stands. At each loop entry, the first such turn registers the heartbeat (§ 5 *Heartbeat*).
2. **A task call returns.** Run the canary `check` for its window first (*Git-env canary*: `--kind task`); a non-zero exit halts, but the row is still reconciled whatever the exit. Reconcile its row (§ 6), print one line (e.g. "[[task-a]] → review, PR <url>"), and drop its runId from this session's record (a `gate-pending` row from a task call keeps it as the task's signed-gate handle, § 3.7). `review` with a PR joins the Integration queue (reconcile stamps `ready:`); a read-only task is done on approval. `blocked`, `plan-blocked`, `review-blocked` or `gate-pending` is set aside by that row itself: the lead writes no row of its own, and only *Set aside*'s re-entry rules apply. An error, or no row: *Lost call*. Then step 1.
3. **Integrate one task.** Re-run § 2.5, then the canary's `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout <rollout-note>` (*Git-env canary*; a non-zero exit halts before anything is stamped), then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py mark-integrating --tasks <slug>`, `S=$(python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py stamp)` and `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py prepare --repo <repoPath> --slug <slug> --default <defaultBranch> --note <task note>`. Route on its JSON (`route`, `case`, `prHead`, `anchor`, `taskBase`, `mainSha`, `record`, `trouble`, `landed`, `mergeCommit`, `sharedFiles`):
   - **`merge`** — main has not moved since the task's base (case i) or since its recorded Integration (case ii): nothing is merged and no verifier runs. Case (i) first records the lead's Integration: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py log-integration --tasks <slug> --started "$S" --anchor <anchor> --head <prHead> --base <taskBase>`; case (ii) writes nothing. Then step 4 with (`prHead`, `taskBase`), or (`prHead`, `record.base`) in case (ii).
   - **`verify`** — `prepare` merged `mainSha` into the branch as `mergeCommit` M (unpushed). Run the canary arm (*Git-env canary*: `--kind verify`, `--default` as passed to `prepare`), then *The background verify command* on the task tree. When its rc is read, run the canary `check` first, before `push` or `undo`: on a non-zero arm or check, `lead-integrate.py undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`, then halt (the lane-free rule). Otherwise:
     - green (rc 0) and no shared file: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py push --repo <repoPath> --slug <slug> --head M`, then `log-integration --tasks <slug> --started "$S" --anchor <anchor> --head M --base <mainSha>`, then step 4 with (M, `mainSha`);
     - green with a shared file: push, then the integrate call with `trouble ["shared-file"]` and `leadMerge: {mergeCommit: M, headSha: M, baseSha: <mainSha>, verified: true}` (the judge reads it alone);
     - red, rc 124, a failed bootstrap or a missing rc: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py undo --repo <repoPath> --slug <slug> --merge M --to <prHead>`, then the integrate call with `trouble ["red"]` (plus `"shared-file"` when there was one);
     - push refused (exit 1): `undo`, then the integrate call with `trouble []`.
   - **`trouble`** — the integrate call with `prepare`'s `trouble` (`["conflict"]` or `[]`).
   - **`set-aside`** — the lead's own *Set aside* row at Integration (`--kind integration`) with `prepare`'s `reason`.
   - **exit 8** (origin unreachable) — *Backoff* (60 s, then 120 s), re-running `prepare`; a third failure halts with `reason="origin unreachable while integrating [[slug]]"`.
   - **exit 2** — halt (§ 7).

   **The integrate call** is § 5's Workflow call with § 4's args and task object (never `task.resume`), a freshly resolved `ladder` (§ 3: read at this call's start), `mode: 'integrate'` and `integration: {prUrl, branch, worktreePath, headSha: <anchor>, taskBase, mainSha, trouble, landed, plan, reviewHistory, reviewRoundsUsed, rung, readyAt, startedAt}`: `reviewHistory` and `reviewRoundsUsed` from the approving row when this session holds it, else from `lead-integrate.py inputs`; `rung` is the task's own rung record, from that row (`startRung`, `rung`, `climbs`), else `lead-integrate.py inputs`' `rung` record, verbatim (neutral, `{startRung: "", rung: "", climbs: []}`, when the note has no `rung:`), never the ladder's top rung: Integration runs on the top rung whatever the record says, and the record only passes through to the row (a bare name or any other shape fails the engine's args check before dispatch, which reads as a *Lost call*); `readyAt` the note's `ready:`; `startedAt` a fresh `lead-integrate.py stamp` taken at launch; `leadMerge` only on a green shared file, as above. `plan` is `lead-integrate.py plan --note <task note>`'s `plan`, read at this launch (after the approving row is reconciled) and passed verbatim as the same JSON string, never retyped, summarised or truncated; `""` when the task's last own call was not plan-gated. The integrator reads it as reference: the brief is the contract. It holds no slot. The canary arm (*Git-env canary*: `--kind integrate`) runs right before its launch. When it returns, run the canary `check` for its window first, then reconcile the row whatever the exit, exactly as at step 2 (that writes its `## Integration log` line and removes `integrating:`), and drop its runId. On a non-zero check act on no `integration.outcome`: no step 4, no seeded revise, no stale-anchor-ref deletion (`prepare` deletes a stale one itself); halt (the lane-free rule). An error, or no row: *Lost call*, which keeps the lane held until a row is reconciled. Otherwise, by `integration.outcome`:
   - `integrated` → step 4 with `integration.headSha` and `integration.baseSha`;
   - `rejected` → the lane frees, step 1.2 launches the seeded revise, and on approval the task rejoins the Integration queue (`max_review_rounds` across those rounds sets it aside review-blocked);
   - review-blocked or `set-aside` → reconcile has already written the engine's row (the note reads `review-blocked`, or `blocked` set aside at Integration), so the lead writes **no** set-aside row of its own: the lane frees, and only *Set aside*'s re-entry rules apply (`hand-back`; for review-blocked, once `max_review_rounds` is raised). A `set-aside` reason starting `merge step STOP: stale anchor ref <X>` also means: delete the ref, guarded (*Anchor ref lifecycle*).
4. **Merge it.** Re-run § 2.5, then the canary's `check-all` (*Git-env canary*: before EVERY `merge-task.sh` launch, the table's re-runs included; a non-zero exit halts and launches nothing). Under `--gated`, enter a *Merge hold* with `reason="gated: awaiting merge approval for [[slug]] (PR #N)"`. Otherwise run, in the background with `run_in_background` and `timeout: 7200000`:
   ```
   ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/merge-task.sh <repoPath> <pr> <head> <base>   # the pair from step 3; exit codes and lead routes in the script header
   ```
   **The sentinel is authoritative, not the reported exit.** The script writes `<repoPath>/.claude/merge-task.status` on exit — `ok` only on a clean merge, `failed:<code>` otherwise; a backgrounded wrapper can mask its exit, so read the file. A missing file is a signal. Before routing ANY merge-task result, run the canary's `check-all` (*Git-env canary*'s merge-result rule): exit 0 routes by the table; any non-zero exit, or a non-empty `gitEnvHold`, takes the hold route (0 → `mark-done`; 5 → the `## Race log` line only, `- <now> [[<slug>]] <the script's RACE line>; re-verify not run: git-env halt`; 2/70 → halt; `failed:git-env` → halt; anything else does nothing). Route by its code:

   | Exit | Lead action |
   |---|---|
   | 0 (`ok`) | `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py mark-done --tasks <slug> --rollout <rollout-note>`. On a WARN that the anchor ref survived, delete it, guarded. The lane frees; step 1 |
   | 1 | *Set aside* at its own run (`--kind own`), reason `merge-task: <its message>` |
   | 2 | Halt |
   | 3 | Base moved: step 3 again for the same task (case (ii) holds through the log); merge-task caps this with exit 4 |
   | 4 | *Set aside* at Integration (`--kind integration`). The reason on stdin is merge-task's text after `set-aside reason: `, verbatim (it already starts `integration: `, and the renderer strips that one prefix, so the first line equals it) |
   | 5 | RACE procedure (below). Never re-call merge-task for this PR |
   | 6 | Re-run once. A second 6: `mark-done`, and report "merged and verified; local refresh failed: <message>". The re-run follows the canary's `check-all` |
   | 7 | *Merge hold* with `reason="review required: approve PR #N (<url>)"`. Never set aside, never re-integrated |
   | 8 | *Backoff* (60 s, then 120 s). A third 8 sets aside at Integration with reason `merge-task exit 8 three times: <merge-task's last message>` |
   | 70 | Halt |
   | 143 / 130 / 129, or a missing sentinel | Re-run once, unless the rollout note carries `paused:`; a second one halts. The re-run follows the canary's `check-all` |
   | `failed:git-env:3` | Halt with `reason="git-env trip: the shared checkout changed"`: the backoff's `check-all` found a trip or a hold (*Backoff*), so merge-task never ran |
   | `failed:git-env:<any other rc>` | Halt with `reason="git-env canary failed"`: the backoff's `check-all` failed (a lock timeout, a validation error), so merge-task never ran; the exit rule, never the trip reason |

   **RACE procedure** (exit 5: merged, but as an unverified combination). Append `- <now> [[<slug>]] <the script's RACE line>` to the rollout note's `## Race log` (the wikilink is what `reconcile-rollout.py`'s RACE hold reads); then the canary arm (*Git-env canary*: `--kind race-verify`; on a non-zero exit append `- <now> [[<slug>]] re-verify not run: git-env halt` to the `## Race log`, launch nothing and halt); then run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py verify --repo <repoPath> --detach-at <the merge commit> --tree <repoPath>/.claude/worktrees/race-<slug> --out <repoPath>/.claude/integration/race-<slug> --timeout <verify_timeout> --bootstrap '<env_bootstrap>' --verifier '<verifier>'` in the background with `timeout: <harnessTimeoutMs>` (no `--bootstrap` when there is none; both single-quoted as in *The background verify command*). When its rc is read, run the canary `check` first: on a non-zero check append `- <now> [[<slug>]] re-verify stopped: git-env halt (rc <rc|absent>)` to the `## Race log`, never `mark-done`, and halt; any RACE rc that arrives after a git-env halt in this session gets the same line and is never acted on, whatever its check says. Otherwise green → `mark-done` (the RACE line stays); red, rc 124 or a missing rc → halt with `reason="RACE: origin/<default> fails the verifier"`. The lane stays held until then.
5. **Completion.** When the halt guard allows `halt: complete`, **perform the completion ceremony** (don't just point the user at the checklist):
   - Run the canary's `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout <rollout-note>` first (*Git-env canary*): a non-zero exit halts the ceremony before anything is swept.
   - Sweep the rollout's task notes: every task should already read `status: done` (step 4's `mark-done` flips each as it merges). Flip any straggler still at `review` whose PR is verifiably merged (`mark-done` again); a straggler at any *other* status means the rollout isn't actually complete — stop and say so.
   - **Fold the Workflow journals into the Run record (ADR 0032).** Each Workflow call's journal is cleaned up with its transcripts after about 30 days, and its tokens, duration and agent count are lost with it, so fold them before the note moves:
     ```
     python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py fold-journals --rollout <rollout-note>
     ```
     It reads only the rollout's Run record (its `run-bound` lines name each call's runId and journal dir) and writes one `call-journal` line per call through `run_record.py`. Record its summary line and every `WARN:` line in the Completion log. A non-zero exit (1: the events directory cannot be resolved or the record cannot be read; 2: usage or a refused slug) is surfaced to the user and the ceremony **continues**: it never halts and never files a follow-on. It is idempotent, so every Retro also runs it first (mid-run, at close, or on a superseded or dropped rollout, which folds the same way from its record alone).
   - **Close the phases this rollout finished (ADR 0026).** Without this step a phase closes only when a lead remembers to. Run it here, before the rollout stamp, never after:
     ```
     python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py touched-phases --rollout <rollout-note>
     python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/reconcile-project.py <line> --kinds phase --apply
     ```
     The first prints one `--project <slug> --phases <N,M,...>` line per project slug among the rollout's linked task notes named `<slug>-p<N>-*` (archived ones included, loose tasks ignored); run the second once for each line it prints, with `<line>` as that line verbatim.
     - **Scope.** Phases come only from `touched-phases`. A phase the rollout did not touch is never passed, so it is left alone even when it is finished.
     - **Mapping output back to phase numbers.** reconcile-project prints each item as an indented line under its section header: under `Written (n)`, `  - phase <stem>: status: done, completed: <date>`; under `Ambiguous (n)`, `  - phase <stem>: <reason>`; under `Errors (n)`, `  - phase <stem> skipped: dependency ...` or `  - phase <stem> not written: ...`. Map each `<stem>` to a touched number N by its literal `<slug>-p<N>-` prefix, where `<slug>` is that line's `--project` value. The match is on the whole prefix, so `-p1-` never matches `-p10-`.
     - **Outcome per touched phase**, in this precedence, each reported to the user and recorded in the Completion log. **closed**: it appears under Written. **ambiguous**: it appears under Ambiguous and is never applied; record it with the tool's reason for the user to decide. **failed**: it appears under Errors, or its line exited non-zero and printed no sections (exit 2, a usage or loader error, or a crash: the tool prints every section at once, so a run that printed `Errors (n)` is never a whole-line failure); every phase on such a line without its own Written, Ambiguous or Errors entry is failed, never left open. Handle it as in *Failure* below. **already closed**: any other touched phase whose phase note (`Work/Phases/<slug>-p<N>-*.md`, then `Work/Phases/Archive/**`) reads `status: done`, because an interrupted ceremony already closed it or a lead closed it by hand; the log records it among the closed phases, marked already closed. **left open**: every other touched phase, i.e. touched minus Written, Ambiguous and Errors and minus the already closed, recorded with the fixed reason `not closed: a task is still open or held, or the phase note is missing or not open` (the cases the tool is silent on: QUIET phases, phases with no tasks, and phase notes missing or at a status other than open or done). Surface any `Skipped` lines (gh unavailable) as-is.
     - **Empty output.** If `touched-phases` exits 0 and prints nothing, record "no phased tasks: nothing to close" in the log.
     - **Failure, for either command.** When `touched-phases` exits non-zero (1: rollout note not found; 2: usage error) or reconcile-project exits non-zero (1: an apply write failed or a dependent phase was skipped; 2: usage or loader error, nothing written): surface the message verbatim to the user, file a follow-on open task at `Work/Tasks/phase-close-followup-<rollout-slug>.md`, record the failure in the Completion log linking the follow-on, and **continue the ceremony**. Why a task and not only a log line: orient's audit runs the reconcile step and would re-find the drift (ADR 0027), but only when someone next orients on the project; this open task is visible now, and a line only in a done, archived rollout's log is exactly the invisible state ADR 0026 fixes.
       - Name: it deliberately starts `phase-close-followup-`, so it never prefix-matches schedule's same-day glob `<slug>-rollout-<YYYY-MM-DD>*.md`, step 1's "several dated/ordinal notes match" lookup, status/repair's `<slug>-rollout-<date>` reads or reconcile-project's `<slug>-rollout` detection. It has no `-p<digits>-` segment of its own, so it is never a phase task.
       - Frontmatter: the same new-task shape as the follow-on tasks in the follow-on bullet below (its fenced block), minus `rollout:` and `phase:`. With no `phase:` key it is a loose task, never a phase member. Copy `projects:` from the rollout.
       - Body: one line per failure, `close phase <slug>-p<N>: reconcile-project exited <code>: <message>` for a phase under Errors, or `close phases <slug>-p<N,M>: reconcile-project exited <code>: <message>` for a whole-line failure, or `touched-phases exited <code>: <message>`. Then the exact commands to re-run, with `--rollout` given the post-move path `Work/Tasks/Archive/Rollouts/<rollout-slug>.md` (the move below archives the rollout note, so its `Work/Tasks/` path would exit 1 on every re-run), and "a re-run resolves lines as in *Resolving a stale follow-on*; once every line is resolved, set this task done".
       - Existing follow-on: look in `Work/Tasks/` root, then `Work/Tasks/Archive/**`, and never create a second same-named note. A failure already listed (an unresolved line with the same `close phase <slug>-p<N>`, `close phases <slug>-p<N,M>` or `touched-phases` key) gets only the in-place `still failing` annotation below, never a second line; only failures not yet listed are appended as new lines. If the only copy is archived and done, `git mv` it back to `Work/Tasks/` and reset `status: open` before appending.
     - **Resolving a stale follow-on (resume or hand fix).** On any re-run where `phase-close-followup-<rollout-slug>` already exists, walk its unresolved lines. Append `resolved <date>: <outcome>` to a `close phase <slug>-p<N>` line when phase N is absent from Errors in a run of its line that printed sections, whatever the exit code and whatever its new outcome; to a `close phases` line when that line no longer exits 2 or crashes (it printed sections); and to a `touched-phases` line when `touched-phases` exits 0. Append `still failing <date>: exited <code>: <message>` in place to each line that still fails. When every line is resolved, stamp the follow-on `status: done` + `completed: <date>`, so a follow-on never keeps claiming a failure that no longer exists.
   - Stamp `status: done` + `completed: <date>` on the rollout frontmatter.
   - File any follow-on work the rollout's Post-rollout section names (validation re-runs, audits, deferred items) as **new open tasks** in `Work/Tasks/`, and rewrite those items in the rollout note as thin pointers to the new tasks, and add a pointer to any phase-close follow-on filed above. Both kinds of follow-on use the vault's new-task frontmatter (after `_System/Templates/Task.md` and the rollout template's own), never `rollout:`, `phase:` or `owner:`:
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
   - Append a `## Completion log` to the rollout note: dispatch dates, tasks → PRs (links + merge dates), convergence stats per task, **total duration + a per-task duration breakdown** (read the `timeline` block from `reconcile-rollout.py status --rollout <rollout-note>` — it's computed from each task note's `started:`/`merged:` stamps, ADR 0030), the rollout note's `## Race log` copied (when it has one), phase closure: phases closed, already closed, ambiguous (with the tool's reason), failed (with the follow-on task link), left open (with the fixed reason), the automatic descopes copied from the rollout note's `## Notes` `descope:` lines (task, part, follow-up or owner, run), and the disposition of each post-rollout item.
   - Close out the associated thread (run `/thread:close` — a sibling: `${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md`) — or record in the log why it stays open.
   - Delete the rollout's `ROLLOUT-HEARTBEAT` cron if one is registered (`CronList` → `CronDelete`); the heartbeat also self-deletes on its next tick, but don't leave it ticking for up to 20 minutes against a finished rollout.
   - Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py retire --rollout <rollout-note>` (*Git-env canary*): it runs `check-all`, then removes the rollout's records. A non-zero exit halts before the move.
   - Move the rollout note to `Work/Tasks/Archive/Rollouts/` (`git mv` in the vault) and commit the vault (task, phase, follow-on and rollout notes). Wikilinks resolve by filename, so `[[<slug>]]` references and task `rollout:` backlinks survive the move.

   A done rollout left sitting in `Work/Tasks/` is invisible-but-present — every Bases view filters `status != done`, so it vanishes from view with no record of what happened. The ceremony is what makes completion legible weeks later.

**Lost call.** A Workflow call — a task call, a seeded revise or an integrate call — whose notification is an error or carries no row, or which the heartbeat finds no longer in flight with no reconciled row.
- If the rollout note carries `paused:`, or this lead stopped the call for a hard pause, write nothing: the note stays `in_progress` (or keeps `integrating:`), and *Reinstate* restarts it.
- Under a git-env hold (`gitEnvHold` non-empty, step 1.1), *Lost call* writes nothing and resumes nothing; after the ack the next entry's *Restart routing* handles it.
- Otherwise, once: § 2.5, § 4's git-env check, then the canary arm (*Git-env canary*: `--kind task`, or `integrate` for an integrate call; a non-zero exit halts and resumes nothing), then `resumeFromRunId` with the same `scriptPath` and args, the ladder included (§ 5); a finished call replays its row from cache. A task call's resume records the `shasum -a 256 <scriptPath>` taken just before it with its new runId (§ 3.7 *The signed-gate handle*). When the resume returns a row, run the canary `check` for the resume's window first (*Git-env canary*: the kind it armed, `task` or `integrate`); a non-zero exit halts, but the row is still reconciled whatever the exit. Then reconcile the row it returns, exactly as step 2 (a task call) or the integrate call's return would: after a non-zero check on an integrate call, act on no `integration.outcome`.
- If the resume errors or returns no row too, the call is dead. Run the canary `check` for that call's window first (a non-zero exit halts, but the row is still written), then write its row and reconcile it: `printf '%s' "workflow call failed: <its first error line, or: no result row>" | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py set-aside --note <task note> --kind <own | revise-stopped | integration> | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py reconcile --result -` — `own` for a task call, `revise-stopped` for a seeded revise, `integration` for an integrate call.
- The row removes `integrating:`, so a dead integrate call frees the lane. The task is set aside at its stage and re-enters only through `hand-back`; `prepare` then cleans its tree (it aborts a merge left in progress, stashes tracked leftovers, and routes a pushed half-Integration to `trouble []`).
- A runId is dropped from this session's record once any row for it is reconciled, so a later restart never resumes a dead call — except a `gate-pending` task call's, which stays as its signed-gate handle (§ 3.7) until *Restart routing* resumes it; *Lost call* never resumes a handle.

**Restart routing** (a stalled `in_progress` note `next` lists in `restart`):
- this session holds an unreconciled runId for its last call → *Lost call*;
- else this session holds its signed-gate handle → § 3.7's signed-gate resume;
- else `lead-integrate.py inputs --note <task note> --max-review-rounds <N> --repo <repoPath>` reports `resumeAt: revise` → step 1.2's seeded revise, without the `autoRevise` test;
- else the task's own call.

A restart whose `mark-started` printed `signed-gate restart` (approve-gates' `gates_signed:` marker, which that `mark-started` consumed, so only the restart that directly follows a sign-off) and that takes either of the last two branches prints § 3.7's fresh-call warning first. Any later restart, a hand-back included, prints nothing.

Each completion leaves `in_progress`, and a dead call gets a lead-written row, so restarts are bounded.

**The background verify command.** The lead runs it with `run_in_background` and `timeout: <harnessTimeoutMs>` ((<verify_timeout> + 600) × 1000, from this entry's § 3 `verify_timeout` check; `timeout: 2400000` at the default) on the task tree (`<repoPath>/.claude/worktrees/<slug>`), reading only `<out>.rc` and `tail -n 20 <out>.log`, never the command's reported exit:

```bash
# thread:integration-verify (extracted and run by tests/lead-integrate.test.sh)
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py verify --tree "<tree>" --out "<repoPath>/.claude/integration/<slug>" --timeout <verify_timeout> --bootstrap '<env_bootstrap>' --verifier '<verifier>'
# end thread:integration-verify
```

Omit `--bootstrap` when the rollout has no `env_bootstrap`. `<verifier>` and `<env_bootstrap>` go inside **single quotes**, with each `'` in them written as `'\''`, so no `$`, `$(…)`, backtick or backslash expands in the lead's shell (in the lead's cwd): `verify` hands them, byte for byte, to `bash -c` in the task tree. `env_bootstrap` re-runs after the merge, so a `main` that changed dependencies is installed before the verifier. At the `--timeout` deadline the verifier's process group is killed and the rc is 124. A TERM (the harness backstop, or a hard pause's TaskStop) makes `verify` kill the group too and write rc 143; only a SIGKILL leaves no rc, which reads as red. Any rc but 0 is red.

**Merge hold** (`--gated`, and merge-task's exit 7). The lane stays held, and each turn ends `ROLLOUT-STATUS: <rollout-slug> merged=<K>/<N> running=<R> state=waiting reason="<hold reason>"`, never `halted`. Task calls keep going: completions reconcile, approved tasks queue behind the lane, and step 1 keeps filling slots and launching seeded revises. The heartbeat stays registered (no `CronDelete`). **Release:** the user's go-ahead (`gated:`), or the user or a heartbeat tick (`review required:`), re-runs § 2.5, then the canary's `check-all` (a non-zero exit halts and releases nothing), and then step 4's `merge-task.sh` with the same pair — this session's, else the `## Integration log`'s last line; exit 3 re-integrates as usual. Under `--gated`, a decline sets the task aside at Integration with reason `merge declined at the --gated hold` (*Set aside*).

**Backoff** (merge-task's exit 8, and `prepare`'s exit 8). One background command with `timeout: 7200000`: the `# thread:git-env-backoff` snippet below (`rm -f` the sentinel, `sleep 60`, the canary's `check-all`, then `merge-task.sh <the same four args>`), then the same with `sleep 120`; `prepare`'s backoff re-runs `prepare` instead. The turn ends `waiting`, and the lead counts the tries. Removing the sentinel first means a command stopped during the sleep reads as a signal, never as the last run's result. A `check-all` that exits non-zero leaves `failed:git-env:<its exit>` and never runs merge-task (step 4's `failed:git-env:3` and `failed:git-env:<any other rc>` rows, which route it as the exit rule does).

```bash
# thread:git-env-backoff (extracted and run by tests/git-env-canary.test.sh)
rm -f "<repoPath>/.claude/merge-task.status"; sleep 60; python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout <rollout-note> || { c=$?; printf 'failed:git-env:%s\n' "$c" > "<repoPath>/.claude/merge-task.status"; exit "$c"; }; ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/merge-task.sh <the same four args>
# end thread:git-env-backoff
```

**Set aside.** A task that stops short of merging frees its slot (or the lane); its dependants wait, and the queue runs on (ADR 0030 decision 4). An engine row that sets a task aside (`blocked`, `plan-blocked`, `review-blocked`, `gate-pending`, or an integrate call's `set-aside`) is already reconciled (§ 6): the lead writes no row for it, and only the re-entry rules below apply. The lead's own set-asides (a `prepare` or merge-task route, a decline, a dead call) are written as rows: `printf '%s' "<reason>" | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py set-aside --note <task note> --kind <integration | revise-stopped | own> | python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py reconcile --result -`. The reason goes on stdin with no `integration: ` prefix — the renderer writes it — except merge-task's exit-4 text, which is passed verbatim. Lead-written rows carry no `integration` key, so they add no `## Integration log` line: an `integrated` record survives an exit-4 (b), exit-8 or decline set-aside, and a later `hand-back` merges through case (ii) when main has not moved since that Integration; otherwise `prepare` integrates it again. Where a task resumes:
- a plain rejection: automatically (step 1.2);
- `revise stopped:` or review-blocked: only after `hand-back` (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py hand-back --tasks <slug>`; for review-blocked, once `max_review_rounds` is raised), then it restarts as a seeded revise through *Restart routing*;
- at Integration: `hand-back` sets `review`, and it rejoins the Integration queue;
- a `plan-blocked` task the notes settle: automatically (step 1.2's *Automatic descope*: `descope`, then `hand-back`), once; a refusal (exit 3) or any other plan-block waits for `/thread:repair`, then re-enters at its own run below;
- at its own run: `hand-back` (or `/thread:repair` § 4) sets `in_progress`, then *Restart routing*. That includes a code-writing `review` note with no `pr:` (approved without a PR: `next` reports it set aside at its run, since Integration has nothing to merge): `hand-back` sets it `in_progress` too, and its own call re-runs on the task's existing tree and branch (*Worktree lifecycle*) and ends at a PR or a set-aside;
- a signed gate: `approve-gates`, never `hand-back` (§ 3.7): at Integration it rejoins the Integration queue; otherwise *Restart routing* resumes its gate-pending call while this session holds the handle, else takes a fresh call behind the warning;
- an undecided RACE or UNVERIFIED (`next`'s `raceHold`): only after its `RACE decided:` line (through `/thread:repair`); until then `hand-back` refuses it (exit 2, nothing written);
- merge-task's exit 3 is not a set-aside: the task integrates again.

**Anchor ref lifecycle.** `refs/integration-anchor/<branch>` (the engine's, created by an integrator) is deleted, guarded by its old value (`git -C <repoPath> update-ref -d refs/integration-anchor/<branch> <X>`): after the merge (merge-task deletes it; the lead does on its WARN that it survived), on a closed PR, on a recut or a from-scratch re-dispatch, and on a `stale anchor ref` reason (`prepare` deletes a stale one itself). Old Integration-log lines survive all of these; their head never equals a recut PR head, so case (ii) cannot misfire.

**Cold resume.** Re-invoking `execute [[rollout]]` on a rollout that has run: first re-run § 2.5, and § 2.7 when this invocation entered at § 1 (§ 2.7's entry rule; the heartbeat re-entry does not); then § 3's `verify_timeout` check; then `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout <rollout-note>` (a PR that merged is flipped done, so it is never re-sent to `merge-task.sh`). Exit 3 means `resume` held back an undecided RACE or UNVERIFIED (one `HOLD:` line each, the note untouched): print the lines and go on, since the loop's step 1.1 holds them; then the loop, an `integrating` task first, with `--running` = this session's live task-call slugs (a re-invocation in the session that launched them, after a § 7 halt say, still has calls in flight: they are running, never stalled, and are never sent to *Restart routing* or *Lost call*). Pass `--running ""` only when this session holds no live task call (a new session, or every call it launched has reconciled). `prepare` reads the `## Integration log`'s last line, so an integrated-but-unmerged task merges through case (ii).

**Reinstate (resuming a paused rollout).** If the rollout note carries a `paused:` stamp, this invocation IS the reinstate — re-run § 2.5 and § 2.7 first, then § 3's `verify_timeout` check (a halt in any leaves the `paused:` stamp in place, so the heartbeat's paused-stamp check and `/thread:status` still read it as paused); then clear the stamp, deterministically:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py clear-pause --rollout <rollout-note>
```

then continue the normal cold resume above (`resume`, then the loop with `--running` = this session's live task-call slugs, exactly as there: a hard pause's TaskStop ended its calls, so what it stopped is `in_progress`, absent from `--running`, and restarts through *Restart routing*). There is no separate resume command. `clear-pause` also removes any still-pending `pause_requested` (the hard-pause-before-honour edge) so a freshly reinstated rollout doesn't immediately re-pause. **Only trigger it on a `paused:` stamp** — a pending `pause_requested` with no stamp is a live user request that must survive resumes (including the heartbeat cron's re-entry); `next` drains it.

### 5. Call the Workflow

This skill instruction is the sanctioned opt-in for the Workflow tool — call it directly:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/execute/task.workflow.js",
  args: <the args object above>,
})
```

Pass `args` as an actual JSON object in the tool call. (Note: the Workflow tool delivers `args` to a `scriptPath` workflow JSON-**stringified** — confirmed by smoke test — so the engine parses it defensively with `typeof args === 'string' ? JSON.parse(args) : args`. Don't remove that parse thinking it's redundant.)

**If the Workflow tool refuses the engine path.** Some harnesses refuse the `${CLAUDE_PLUGIN_ROOT}` path with "scriptPath must be a script path this tool returned, or a file you can already read"; a prior `Read` of the file does not help. Fall back to a scratchpad copy:

1. `mkdir -p "<scratchpad>/task" && cp "${CLAUDE_PLUGIN_ROOT}/skills/execute/task.workflow.js" "<scratchpad>/task/task.workflow.js"`, where `<scratchpad>` is this session's scratchpad directory.
2. `cmp` the copy against the source. If `cmp` reports any difference, stop.
3. Pass `<scratchpad>/task/task.workflow.js` as `scriptPath`.

The engine has no relative imports, so the copy runs unchanged. A `resumeFromRunId` resume re-passes the same `scriptPath` the run started with, exactly like its args. A later session (a new scratchpad) re-copies the same bytes, and the task notes still keep the tasks that already landed. Never edit the copy. This is a fallback only: the cache path is the default (the 2026-09-23 E2E ran it unrefused).

Tell the user the call launched, which task it covers, the ladder it runs on (its `source`: the file's path, or `built-in`) and the progress line; they can watch live with `/workflows`. Record the returned `runId` against the task. If a call dies or its notification never arrives (§ 4.5 *Lost call*), re-run § 2.5 first (a listed repo halts instead of replaying agents that push branches) and § 4's git-env check (a halt there writes nothing), then the canary arm (§ 4.5 *Git-env canary*: `--kind task`, or `integrate` for an integrate call; a non-zero exit halts and resumes nothing), then resume once with `Workflow({ scriptPath, args, resumeFromRunId: <runId> })`, passing the `scriptPath` the run started with (unchanged `agent()` calls replay from cache). The check is lead-side only, so the resume's args and prompt bytes are unchanged and the replay cache stays valid.

**Heartbeat (idempotent).** At each loop entry (top-down, *Cold resume*, *Reinstate*, `/thread:repair`'s hand-off), the first turn that ends `state=waiting` runs `CronList` before `CronCreate`, and creates `ROLLOUT-HEARTBEAT <rollout-slug>` (schedule `*/20 * * * *`) only if it is absent. That covers whatever the turn launched: a task call, a seeded revise, an integrate call, a background Integration command (the verifier, `merge-task.sh`, a backoff), or a merge hold. Its prompt:

> ROLLOUT-HEARTBEAT <rollout-slug>: Run these clauses in order. (1) Read the last ROLLOUT-STATUS line for this rollout in the conversation; if state=done or state=halted (or the rollout note is archived), find this cron via CronList, CronDelete it and stop. (2) If the rollout note's frontmatter carries a `paused:` stamp, the rollout is deliberately paused — a hard pause emits no halted line, so check the note BEFORE any stall diagnosis: CronDelete this cron and stop; never resume a paused rollout. (3) Lost calls (always run this clause, under a merge hold too): if a Workflow call this session launched and has not reconciled is no longer in flight in /workflows, or a task of this rollout reads `in_progress` with no call in flight for it, apply §4.5 *Lost call* to each call this session launched that is no longer in flight in /workflows with no reconciled row (never to a call still in flight: *Lost call* resumes without re-checking), then §4.5 step 1 with `--running` = the calls still in flight. (4) If a background Integration command this session launched (the verifier, merge-task.sh, a backoff) has not reported: when its result file exists (`<out>.rc`, or `.claude/merge-task.status`), act on it as §4.5 would; otherwise do nothing more. (5) If the reason starts `gated:`, take no merge action — the user decides. (6) If the reason starts `review required:`, re-run §4.5 step 4 for that task (it re-checks the approval). (7) Otherwise, with no hold standing: if no Workflow call for this rollout is in flight and work remains, the rollout has stalled — re-enter /thread:execute [[<rollout-slug>]] §4.5 *Cold resume* (this re-entry skips § 2.7, execute's entry-point-only pushed-base gate); else end the turn silently.

This is the backstop for a hung or lost Workflow call, a lost background-command notification and a missed completion — the stall modes nothing else catches. End a launch turn with `ROLLOUT-STATUS: <rollout-slug> merged=<K>/<N> running=<R> state=waiting` so the Stop-hook driver (§8) lets the session idle until the notification arrives.

### 6. Reconcile + report

The workflow returns `{ rolloutSlug, tasks: [{ slug, scope, status, prUrl, branch, worktreePath, reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, reviewHistory, approvedAtCeiling, summary, startRung, rung, climbs, rungDrift, ran, gatedInputs, plan }] }` — `tasks` holds exactly one row, the called task's; a mode-`integrate` row carries one more key, `integration` — where `status ∈ review | review-blocked | blocked | plan-blocked | gate-pending`, the rung record (ADR 0029 decision 7) is `startRung` (the rung the call started on), `rung` (the one it ended on), `climbs` (each stage that climbed, `{stage: plan | implement | review, from, to}`, a no-op on the top rung with `from` equal to `to`), `rungDrift` (the note's `rung:` when the ladder lacks it, read as the top rung; `""` otherwise) and `ran` (every dispatch, `{label, rung, model, effort}`, as it ran; an integrate row passes the task's record through and lists Integration's agents, all on the top rung), `gatedInputs` lists the declared-but-unapproved gates when the task paused at `gate-pending` (§3.7), `reviewHistory` is the accumulated by-round review-judge rejection rationale, `approvedAtCeiling` marks an approval on the final review round with real rejection history (a ceiling approval), and `plan` is the approved plan, which only the task's own call settles: the plan it ran with when plan-gated, `""` when not plan-gated, `null` when the call reached no plan outcome (plan-blocked, a gate-pending stop at the plan, the pre-flight budget block, a call that threw, and every seeded-revise and integrate row).

**Reconcile with the deterministic helper — do NOT hand-edit frontmatter.** Write the returned object to a temp file (or pipe it on stdin) and run:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py reconcile --result /tmp/task-result.json
#   --result -   reads the JSON from stdin instead
```

The helper resolves each task note by slug under `~/repos/obsidian/Work/Tasks/` and performs every per-task write the old hand-edit loop did — **idempotently**, so it's safe to re-run on resume. Per returned `status`:
- `review` → `status: review`, `pr: <url>`, `review_rounds_used: <n>` (and `plan_rounds_used: <n>` when the task was plan-gated). A **read-only** task (the row's `scope`, else the note's) with no PR is written **`status: done`** instead: it is done when its review approves, has nothing to merge and never enters Integration (ADR 0030); its approval is its completion, so it is stamped `merged:` then (the first stamp wins) and its duration counts in the `status` timeline. A ceiling approval (`approvedAtCeiling`) additionally records the grouped `reviewHistory` as a run under `## Review history (approved at ceiling)` — an audit record, never re-dispatch input. A later ceiling approval of the same task (an Integration rejection can produce one) is a new run.
- `review-blocked` → `status: review-blocked`, `pr: <url>`; records the grouped `reviewHistory` (every round, latest last; legacy results without it fall back to final-round `reviewFeedback`) as a run under `## Review-blocked feedback`
- `blocked` → `status: blocked`; records `blockerDiagnosis` as a run under `## Blocker diagnosis`. A diagnosis that starts `integration:` (any case) marks the task **set aside at Integration**, where it re-enters (`status` and `next` report `setAsideAt: integration`); any other blocked task is set aside at its run.
- `plan-blocked` → `status: plan-blocked`; records the accumulated plan feedback as a run under `## Plan-blocked feedback`
- `gate-pending` → `status: gate-pending`; **upserts** the declared gates under `## Gated inputs (awaiting sign-off)` (upsert, not a run — the pending list always reflects the latest declaration)
- every row → removes `integrating:`: the run that produced the row ended any Integration the task was in
- a mode-`integrate` row's `integration` key → one `## Integration log` line (its outcome, path, anchor, head, base and metrics); the lead's own clean-path record is `log-integration`'s `path=lead` line (§4.5 step 3)
- a lead-written set-aside row (`lead-integrate.py set-aside`, §4.5 *Set aside*) → `status: blocked` and its diagnosis run; it carries no `integration` key, so it adds no log line
- any status's `plan` → a non-empty `plan` upserts it, quoted, under `## Approved plan` below the record line (a lead-in saying it is a record, not authoritative); `""` removes that section; `null` or absent leaves it; anything else is an ERROR (exit 1) and leaves it. `lead-integrate.py plan` reads it back for §4.5 steps 1.2 and 3
- any status with a non-empty `rung` → stamps **`rung: <name>`**, the rung the task reached, so a later re-dispatch starts there (a drifted `rung:` is overwritten). An integrate row passes the task's record through, so it stamps the same name again; a neutral record (`rung: ""`) and a lead-written set-aside row stamp nothing and keep the note's `rung:`. A malformed name is an ERROR, and nothing is stamped. Reconcile never writes a legacy stamp (a supersede's `carry` maps stale ones, schedule § 0). Its line prints `rung=<name>`, plus `from=`, `climbs=` and `rung-drift=` when they apply: report a `rungDrift` (the ladder file lost the task's rung under a running rollout).
- a pre-3.0.0 row (no `rung`; a call started on the tier engine finished there, e.g. a *Lost call* resume of its old `scriptPath`) whose `escalated` or `tierCapped` is true → stamps **`rung: <the ladder's top rung>`**, read through `ladder.py`, so its re-dispatch does not restart on the bottom rung, and prints a `WARNING:` line naming the slug: relay it. When the ladder file is refused that is an ERROR and nothing is stamped: fix the file, then re-run the same reconcile. A legacy row with neither flag stamps nothing.

**Feedback accumulates per run (p6-4).** The three blocked sections and the ceiling history keep every run's feedback, never only the first. Each run is a block: `### Run <n> (<stamp>)`, a blank line, the content, a blank line, then `<!-- run <n> end sha=<12 hex> -->`, where sha is the sha256 of the content normalised (lines right-stripped, outer blank lines dropped, runs of blank lines collapsed) and n is the highest existing run + 1.
- **The content can never break the note's structure.** Diagnoses are free LLM text, so a heading at level 1–3 in the content is written three levels down (`## Root cause` becomes `##### Root cause`) and a line shaped like a run end marker is indented one space. A `## ` line can then never end the section, and no line can open or close a run. The sha stays over the content as given. A gate-pending section's content is written the same way.
- **A re-reconcile is a no-op** when the new content hashes equal to the **highest** run (a run whose end marker was removed by hand is compared by its extent). Earlier runs are never compared, so a finding that recurs after a different run is recorded again.
- **The agent's copy is adopted, not duplicated.** The engine tells the implementer to write its diagnosis into the note itself. When the text after the last end marker (or the whole section, when it has no runs yet) normalises equal to the new content, and that content has no heading or marker line to rewrite, reconcile makes it the run in place: the heading goes before it and the marker after it, its bytes unchanged. Otherwise the run is appended at the section's end, after any differing agent text.
- **Nothing is deleted or rewritten.** Earlier runs stay byte-identical, and legacy text with no run heading (a section written before runs existed, or an orphan from a climbed-then-approved run) stays where it is, unnumbered.
- **The latest diagnosis** of a section is the content of its highest run, or the whole section when it has no runs. It is what `status` reports as `blockerSummary` (the section matching the note's own status first) and what the `integration:` marker is read from.

(This replaces ~5 fumble-prone frontmatter edits per task — finding #6. The lead session still owns the call; subagents never write task `status:`.)

**One line per event.** Print one short line per reconciled call ("[[task-a]] → review, PR <url>"; "[[task-b]] → set aside at its run (see its Blocker diagnosis)"), per Integration ("[[task-a]] integrated by the lead, no merge needed"; "[[task-c]] → integrate call: conflict"), per merge ("[[task-a]] merged, PR #5"), per signed-gate resume ("[[task-k]] → resumed on its signed plan (run <runId>)", § 3.7) and per automatic descope ("[[task-p]] descoped: <part> → follow-up [[proj-followup-x]] (or owned by [[task-q]]); restarting", §4.5 step 1.2: Lachy is told afterwards, never asked).

**Rollout report** (at a halt, a merge hold or completion):

```
Rollout report for [[<rollout-slug>]] — progress: 3/6 merged, 1 running, 1 awaiting integration, 1 set aside

Merged:
- [[task-a]] — PR <url> (approved clean, 1 round)
- [[task-c]] — PR <url> (2 rounds; climbed at implement to opus-xhigh)
Running:
- [[task-d]] — own call
- [[task-e]] — seeded revise r3
Awaiting Integration: [[task-f]]
Lane: [[task-g]] — merge hold: gated: awaiting merge approval for [[task-g]] (PR #9)
Set aside:
- at its run: [[task-h]] — blocked, see "## Blocker diagnosis"
- at Integration: [[task-i]] — integration: head moved after Integration (…)
- review-blocked: [[task-j]] — see "## Review-blocked feedback"
Gate-pending (awaiting YOUR sign-off — a declared gate always pauses, ADR 0008):
- [[task-k]] — declared: spend: Replicate API — cap USD 30
  → sign off, then: reconcile-rollout.py approve-gates --tasks task-k (it resumes its gate-pending call on the plan you signed while this session holds it, else takes a fresh call with a warning; a stop at Integration rejoins the Integration queue)
Held: [[task-l]] — depends on [[task-h]] (blocked)
Descoped: [[task-p]] — "a canary" → follow-up [[proj-followup-canary]] (automatic, Plan-blocked feedback run 1; restarted)
```

The `Descoped:` line lists every automatic descope this rollout has recorded (its `## Notes` `descope:` lines), so a wrong one is caught at the first report. Undo it (repair § 3, on Lachy's word) by removing every record the verb wrote: on the task note, the `## Scope decision (automatic)` section (its entry and its `<!-- descope run=… -->` marker: a marker left behind makes the next block read as a second one), the brief pointer or pointer line, the `(automatic)` `## Repair input` line and `descope_armed:` if it still stands; the follow-up note set to `status: dropped`; and the rollout's `## Notes` `descope:` line removed (or rewritten as `descope undone:`), so this line and the Completion log stop listing it. Then `hand-back`.

**End every execute turn with the machine-readable status line** (after the report, or alone on turns that only reconcile, integrate or merge):

```
ROLLOUT-STATUS: <rollout-slug> merged=<K>/<N> running=<R> state=<running|waiting|halted|done>[ reason="<short reason>"]
```

- `K/N` come from the latest `progress:` line (`next`, `mark-started` or `resume`: merged of total). `R` counts task calls in flight, seeded revises included and integrate calls excluded.
- `running` — in-session driving work remains **right now** (a call returned and needs reconcile, a task needs integrating or merging, a slot is free). The plugin's Stop-hook driver (§8) refuses to let the session stop on this state — so never end a turn on `running` unless you genuinely stopped mid-work.
- `waiting` — a task call, an integrate call, a background Integration command or a merge hold is in flight; nothing to do until its notification (the heartbeat cron is the backstop). A hold's `waiting` carries its `reason=` (`gated: …` or `review required: …`).
- `halted` — a §7 stop condition fired, or a requested pause took effect (*Pausing + reinstating a rollout*) — always include `reason=`.
- `done` — completion ceremony performed.

`reason` appears only on `halted` and on a hold. Keep it short and quote-free. This line is the contract the automatic driver (§8) keys off — the Stop hook parses it with a strict regex, so keep the format byte-stable.

**Merging:** the lead merges only after Integration (§4.5 steps 3-4), through `scripts/merge-task.sh` — never an inline `gh pr merge`; under `--gated` it first waits at a merge hold for your go-ahead. merge-task.sh never updates a branch: it merges a PR only onto the base its Integration used (exit 3 otherwise).

The merge gate is the repo's **required** checks — branch-protection's own definition of mergeable — **not** GitHub's cosmetic `CLEAN` (which also waits on non-required checks). A base branch that legitimately carries red *non-required* checks reports every PR as `UNSTABLE`, never `CLEAN`; gating on `CLEAN` would merge nothing at all. `merge-task.sh`'s `UNSTABLE)` case handles this by waiting on `--required` checks only — a genuinely-failing required check surfaces as `BLOCKED`, not `UNSTABLE`, so it stays safe. Don't "tidy" it back to `CLEAN`-only (the 2026-06-02 giflab run).

### 7. Continuous-mode stop conditions

The queue (§4.5) halts only when nothing can start and nothing is running or integrating — a stuck task is set aside, not a halt (ADR 0030 decision 4) — or on a designed stop below. Every halt passes the halt guard (§4.5 step 1.5): surface the reason prominently, leave everything merged so far landed, end the turn with `ROLLOUT-STATUS: <slug> merged=<K>/<N> running=<R> state=halted reason="…"` (§6) so the automatic driver releases (§8), and stop — when:

- `next` reports a `RACE` in `raceHold` while the lane is free (§4.5 step 1.1: `reason="RACE undecided: [[task]]"` — a **designed** stop: `/thread:repair` shows the evidence and records Lachy's decision, and re-invocation resumes), or
- `next` reports `halt: stuck` (`reason="nothing can start: <n> set aside"`; with an UNVERIFIED hold among them, `reason="UNVERIFIED undecided: [[task]]"`, checked first; with a gate-pending task among them, `reason="gated inputs await sign-off: …"` — a **designed** pause, ADR 0008, not a failure: the user signs off, `approve-gates` runs, and re-invocation resumes (§ 3.7: on its signed plan while this session holds the handle, through the Integration queue for a stop at Integration, else a fresh call with the warning); when the user IS present, ask for the sign-off in-conversation instead of halting — §3.7), or
- `next` exits 1 (an invalid `parallel_ceiling`, an absent one `rollout-settings.py` could not resolve, or an incomplete rollout: its ERROR line verbatim, which for a ceiling ends with the remedy for its cause, `reason="next refused the rollout"`), or
- `merge-task.sh` exits 2 or 70, or a signal recurs on its re-run (`reason="merge-task.sh exited <code> on [[task]]"`), or
- `lead-integrate.py` exits 2, or `prepare`'s backoff runs out (`reason="lead-integrate.py failed on [[task]]"`, or `reason="origin unreachable while integrating [[task]]"`), or
- a RACE re-verify is red, timed out or left no rc (`reason="RACE: origin/<default> fails the verifier"`), or
- § 2.5, or a §4.5 re-check of it, reports the repo on the landing register, or the check itself fails (`reason="<owner/name> is on the landing register"` or `reason="landing-register check failed"` — a **designed** stop: unlisting is Lachy's call; open PRs stay open and re-invocation after unlisting flushes them), or
- § 2.6, or its run after a §4.5 re-check, finds `repoPath` is a directory-source plugin marketplace checkout, or the check itself fails (`reason="repoPath is a live plugin marketplace checkout"` or `reason="self-rollout check failed"` — nothing is stamped, dispatched or merged; clone the repo to a separate path such as `~/repos/<repo>-rollout`, point the rollout's `Project root` at it and re-invoke), or
- § 2.7, at an entry point, finds a known clone's local `<default>` ahead of `origin/<default>` beyond THREAD.md, or the check itself fails (`reason="local default branch is ahead of origin"` or `reason="pushed-base check failed"` — nothing is stamped, cleared or dispatched; land those commits by PR, or wait for the queued `close/…` landing PR to merge, then re-invoke), or
- § 4's git-env check finds a repo-local `GIT_*` variable exported in the lead session, or the check itself fails (`reason="git env set in the lead session"` or `reason="git-env check failed"` — nothing is stamped or dispatched; relaunch Claude Code from a shell without them, or put a working `git` on PATH, then re-invoke), or
- the git-env canary (§ 4.5 *Git-env canary*) exits non-zero anywhere, or `next` reports `halt: "git-env"` (`reason="git-env trip: the shared checkout changed"` on exit 3 or a hold, `reason="git-env canary failed"` on anything else — a **designed** stop: `/thread:repair` (its git-env step, 3e) shows the evidence and records Lachy's ack, and re-invocation resumes), or
- `reconcile-rollout.py verify-timeout` exits 1 at an entry (`reason="invalid verify_timeout on [[rollout]]"`: nothing is stamped, cleared or dispatched; fix the rollout frontmatter and re-invoke), or
- §3's round-budget validation finds a `max_iterations`, `max_review_rounds` or `max_plan_rounds` that is not an integer >= 1 (`reason="invalid round budget: <field> on [[task]]"` — nothing is stamped or dispatched; fix the frontmatter and re-invoke), or
- `rollout-settings.py` exits 2 or 3 for a round-budget key absent at both levels (§ 3: `reason="rollout settings refused"` — nothing is stamped or dispatched; fix `~/.config/thread/rollouts.toml` at the line its stderr names, or stamp the key on the rollout note, the only fix when its stderr names `--repo` (the Project root is gone), then re-invoke), or
- `ladder.py` exits non-zero at a call's start (§ 3: `reason="ladder file refused"` — nothing is written for that call; fix `~/.config/thread/ladder.toml` at the line its stderr names, or run a python >= 3.11, then re-invoke).

A **merge hold** (`--gated`, or merge-task's exit 7) is not a halt: it ends `waiting` (§4.5 *Merge hold*). A **soft pause** (*Pausing + reinstating a rollout* below) exits through `state=halted reason="paused at user request"` once it drains, but is **deliberate**, not a failure — there is no cause to fix, and reinstating is plain re-invocation. After a halt, completions of calls still in flight are only reconciled: nothing new starts, integrates or merges.

In every halt case the work merged so far stays on the base branch; the user fixes the cause and re-invokes `execute [[rollout]]`, which resumes from the task notes (§4.5 *Cold resume*). To see *why* a rollout halted, run `/thread:status [[rollout]]` (read-only situational report). To **sort out** a stalled rollout without ceding merge authority, run `/thread:repair [[rollout]]` — it reconciles drift, re-dispatches agent-fixable blocks, captures input-gated decisions, defers wedged tasks, and resumes via this skill's §4.5 loop (`merge-task.sh` stays the sole merger). `/thread:repair` is the systematised replacement for hand-repairing a worktree in an external cockpit (README → *Coexistence with Orca*).

### 8. Unattended driving — the automatic driver

The §4.5 loop is driven across turns by Workflow-completion and background-command notifications — nothing in the notifications themselves *enforces* that it keeps going. The plugin closes that gap with two self-managing pieces; **the user types nothing**:

**The Stop-hook driver** (`hooks/rollout-stop-driver.py`, wired via the plugin's `hooks.json`). On every session stop it reads the last `ROLLOUT-STATUS` line (§6) and, while `state=running`, **blocks the stop** and hands back the next step (reconcile every returned call → integrate and merge one task at a time → `next`, filling the free slots). It releases on `waiting` (a call, a background Integration command or a merge hold is in flight), `halted` (§7 — human's turn), and `done`. It is progress-aware: three consecutive blocks without `merged` advancing release the stop and surface "likely wedged — run /thread:status or /thread:repair" instead of spinning forever. This is the programmatic twin of a `/goal` condition, shipped so nobody has to remember to set one.

**The heartbeat cron** (§ 5 *Heartbeat*: registered at the first `waiting` turn of each loop entry, `*/20 * * * *`). Catches the stalls the Stop hook can't see: a hung or lost Workflow call, a lost background-command notification, or a missed completion while the session idles at `state=waiting`. Each tick first recovers lost calls (§4.5 *Lost call*, under a merge hold too) and reads any unreported background command's result file; if the rollout stalled it re-enters §4.5 *Cold resume*. Re-entry is duplicate-free: `resume` flips merged PRs done and skips a held RACE or UNVERIFIED task, and `next` keeps a held task out of Integration, so a merged PR is never re-sent to `merge-task.sh` and a PR whose last exit was 5 is never re-called; `next --running` restarts only stalled notes, and `prepare` reads the Integration log. It deletes itself once the rollout is done, halted, or paused (its prompt checks the rollout note's `paused:` stamp before diagnosing a stall — a hard pause emits no `halted` line, and "stalled" must never restart work the user deliberately stopped).

Division of labour: **Stop hook** = "don't stop while there's driving work"; **heartbeat** = "wake up if the thing you were waiting for never arrives"; **§7 HALTs** = the deliberate exits both respect.

**Manual fallbacks** (when the plugin's hooks are disabled, or driving from an environment without them):

- `/goal The ROLLOUT-STATUS line for <rollout-slug> reports state=done or state=halted, or stop after 4 hours` — transcript-only evaluator, auto-continues a stopped session; always include the time/turn bound and the `state=halted` release clause. Note it will also bounce `state=waiting` turns, so expect some no-op continuations while calls run.
- `/loop 45m /thread:status [[<rollout>]]` — read-only watchdog for drift and stranded-`review` tasks (the failure mode that let seven landed tasks sit unnoticed in the giflab rollout); stop it (`/loop stop`) once the rollout archives.

**Guardrails + limits:**

- **Everything here is session-scoped.** The Stop hook and heartbeat cron only act while the session is alive; a closed terminal stops them all (they resume with `claude --resume`). True detachment is a `/schedule` cloud routine — out of scope here.
- **Never automate `/thread:repair`** — it is input-gated by design (it asks the user decisions no agent can make); the driver, the heartbeat, and any loop must route a wedged rollout *to* repair, never *through* it. One verb is the lead's as well as repair's, and running it is not automating repair. The lead runs `reconcile-rollout.py descope` itself (§ 4.5 step 1.2), a guarded deterministic verb that checks the lead's judgement, and its refusal (exit 3) routes the task to repair, which asks Lachy.
- **`--gated` holds end `waiting`, never `halted`.** A merge hold keeps the lane and the heartbeat; task calls keep running while it waits for your go-ahead, and the Stop hook releases on `waiting`.
- **A §7 HALT ends unattended driving.** Emit `state=halted` with the reason — the Stop hook releases, the heartbeat self-deletes on its next tick, and a well-worded `/goal` fallback releases on the clause.
- **Every background command names its `timeout:`.** The verify command and a RACE re-verify run with `timeout: <harnessTimeoutMs>` (their own `--timeout <verify_timeout>` bounds the verifier; `timeout: 2400000` at the default); `merge-task.sh` and a backoff run with `timeout: 7200000`, the harness maximum (merge-task's required-check wait is bounded only by GitHub's job timeouts). A harness TERM leaves rc 143 for a verify (red) and the sentinel `failed:143` for merge-task (a signal); only a SIGKILL leaves no result file, which reads as red for a verify and as a signal for merge-task.
- **What none of this fixes:** the blocking wait *inside* one Workflow call (~1h worst case per stubborn task, §Resource budget) is untouched by any driver.
- **Skill invocation under /loop (fallbacks):** slash-command payloads are invoked normally (`/loop 5m /babysit-prs` is the built-in's own example). The only frontmatter that breaks this is `disable-model-invocation: true` — never add it to `execute` or `status`. (There is no `autonomous:` frontmatter key; that's a myth — verified against the 2.1.199 binary.)
- Cloud providers (Bedrock/Vertex) downgrade dynamic `/loop` to a fixed ~10-minute cadence.

## Pausing + reinstating a rollout

"Pause the rollout" means **soft pause** by default; **hard pause** only when it must stop *now*. Either way the pause is recorded on the rollout note, and reinstating is plain `/thread:execute [[rollout]]` — no separate resume command, no new state machine. Neither pause runs the § 2.5, § 2.6 or § 2.7 gates: stopping work is never blocked, even for a listed repo or a register the check can't read. (Terms: `CONTEXT.md` → *Pause*, *Reinstate*.)

**Soft pause (default).** Stamp `pause_requested: true` on the rollout note's frontmatter (a lead-session edit — it's rollout config, not task status). Nothing is interrupted, and **the queue drains** (ADR 0030 decision 5): `next` starts and restarts nothing new, step 1.2 launches no seeded revise, and every running task call finishes while every approved task integrates and merges. Once nothing runs, awaits Integration or integrates, `next` stamps `paused: <timestamp>`, removes `pause_requested` and reports `halt: paused`; the loop exits with `state=halted reason="paused at user request"`. A plain rejection during the drain waits, set aside, for the reinstate. Zero extra agent calls. To cancel a pending request before it takes effect, remove the `pause_requested:` line (or run `clear-pause`).

**Hard pause (urgent).** Stop now — in-flight agents die, but their worktrees keep all committed (and any uncommitted) work. This is a documented protocol, not engine code, and its order matters:

1. Stamp the rollout note by hand FIRST: `paused: <timestamp>` in frontmatter, plus a `## Pause log` body entry with every in-flight call's `runId` and the lane holder — so every later completion of a stopped call sees `paused:`, and *Lost call* writes nothing.
2. **TaskStop** every Workflow call of the rollout (`/workflows`, or the task list) and every background Integration command (a verify, `merge-task.sh`, a backoff). `verify`'s TERM handler kills its verifier's process group.
3. Delete the rollout's `ROLLOUT-HEARTBEAT` cron (`CronList` → `CronDelete`), mirroring the completion-ceremony step (§4.5). A hard pause emits no `state=halted` line, so the last ROLLOUT-STATUS still reads `waiting` — a live heartbeat would diagnose "stalled" on its next ≤20-min tick and restart the work you just stopped. The heartbeat prompt's own paused-stamp check (§5) is the backstop if this step is missed, but delete the cron anyway rather than leaning on it.

While `paused:` stands, nothing is launched, undone, set aside or re-run: a stopped call's error is not a *Lost call*, and a stopped verify's rc 143 is not acted on (no `undo`, no integrate call). The stopped tasks simply didn't land: their notes still read `in_progress` (or keep `integrating:`), so the reinstate's `next` (its `--running` lists only calls still live, never a stopped one) restarts them through *Restart routing*, and the engine's worktree setup reuses each task's existing worktree + branch (resume-safe by design). A task stopped mid-verify keeps the lead's unpushed merge in its tree; `prepare` routes it to `trouble []`. Losses are bounded to in-flight agent context — committed work, and uncommitted files sitting in the worktrees, survive. TaskStop'd calls keep their open git-env records, and the reinstate's entry `check-all` compares them (§ 4.5 *Git-env canary*).

**Reinstate.** `/thread:execute [[rollout]]`. The resume path (§4.5 *Reinstate*) re-runs § 2.5 and § 2.7, then § 3's `verify_timeout` check, then sees the `paused:` stamp, clears it via `reconcile-rollout.py clear-pause`, and continues the cold resume — restarting what the pause stopped and integrating what awaits. The heartbeat re-registers at the first `waiting` turn (§5; the paused rollout's old one is already gone — self-deleted on the soft pause's `halted` line or on its prompt's paused-stamp check, or deleted directly by hard-pause step 3 — so a pause is never auto-resumed by a leftover tick).

A paused rollout is **intentional**, not stalled: `/thread:status` reports it as paused (stamp + since-when + what's left). Under a pause `/thread:repair` only records escalations and decisions (a `RACE decided:` line included) and defers a set-aside task; when the pause is stamped, it may also write a confirmed `pr:` or defer a RACE task whose merge does not stand. It never hands back.

## Don'ts

- Merge ONLY via `scripts/merge-task.sh`, ONLY after Integration (§4.5 steps 3-4), ONLY from the lead session — under `--gated`, only after your go-ahead at the merge hold. Never an inline `gh pr merge`, never `--admin` (it would bypass branch protection and merge a red branch), never a force-push — ever. The engine (`task.workflow.js`) never merges.
- Never start a task, call or resume a Workflow, push an Integration, or call `merge-task.sh` for a repo the landing register lists. § 2.5 runs first, every time (and §4.5 re-runs it before each of those). Never gate a pause on it: soft and hard pause (TaskStop, the `paused:` stamp, the heartbeat `CronDelete`) are exempt, so the register check never blocks stopping work.
- Never run two Integrations at once: one task holds the lane from `mark-integrating` until its merge, set-aside or halt.
- Never exceed `parallel_ceiling` task calls in flight, seeded revises included.
- Never auto-launch a seeded revise unless `lead-integrate.py inputs` reports `autoRevise: true`.
- Never write a descope by hand: `reconcile-rollout.py descope` writes every record and decides once per task, and its exit 3 goes to `/thread:repair`, never to `hand-back`.
- Never read `next`'s `halt` before step 1.2 has launched its revises, or while the lane is held or a task call is live.
- Never write the `integration: ` prefix into a set-aside reason yourself: `lead-integrate.py set-aside` renders it (merge-task's exit-4 text passes through verbatim).
- Never resume a runId whose row was reconciled — except § 3.7's signed-gate resume of a `gate-pending` task call after `approve-gates`, with only `task.approvedGates` added to its args.
- Never re-call `merge-task.sh` for a PR whose last exit was 5.
- Never launch, resume, verify or call merge-task without its canary step (§ 4.5 *Git-env canary*), never route a merge-task result without the `check-all`, never take a route under a git-env hold but 0/5/2/70, never `mark-done` on a RACE rc after a git-env halt, and never ack from execute: the ack is `/thread:repair`'s, on Lachy's word.
- Never launch a background command without a `timeout`.
- Don't skip the protocol-version gate. Legacy (absent, 2 or 3) rollouts must be regenerated, not retrofitted.
- Don't update a task's `status:` from inside a subagent — the lead session reconciles after the workflow returns.
- Don't hand-roll the convergence loop in the conversation — that engine moved into `task.workflow.js`. If the loop needs changing, edit the script and (for an interrupted run) re-invoke with `resumeFromRunId`.
- Don't raise `parallel_ceiling` blindly. `parallel_ceiling` (resolved by schedule from rollouts.toml; a Retro proposes changes) caps how many task calls (worktrees) the lead runs at once. The Workflow tool's own agent cap (CPU-core-based: 10 on the M2 Max, 12 cores) is per call, so it never bounds the ceiling, and how many calls can safely run together is still open (ADR 0032 leaves it to the first Retro). Heavy-model tasks (LPIPS ≈ 500 MB/process) argue for a lower ceiling: raise it only for light rollouts.

## Worktree lifecycle (how the engine isolates + reuses worktrees)

**Every task gets ONE worktree, created by its first agent** (ADR 0030, p12-4), at `<repoPath>/.claude/worktrees/<slug>`; every later agent on the task reuses it. A **code-writing** task's tree is its branch `audit-fix/<alias>`, cut from a **freshly fetched** `origin/<default branch>` (`git -C <repoPath> fetch origin && git -C <repoPath> worktree add <repoPath>/.claude/worktrees/<slug> -b audit-fix/<alias> origin/<default branch>` — `main` unless §4's `defaultBranch` is passed) so it includes every task that has already merged. On a plan-gated task the planner creates it (`taskTreeSetup`), so the plan and the code share one base; otherwise the implementer creates it (`worktreeSetup`), exactly as before. A **read-only** task's tree is a detached worktree at the same path, created by its planner when it is plan-gated (`plan_approval: required` gates read-only tasks too, §3.5), else by its investigator. Implementers return the tree's absolute path (`git rev-parse --show-toplevel`) in the structured result; downstream revisers `cd` into that threaded `worktreePath` to reuse it (push to the existing branch, the PR auto-updates). Every setup is resume-safe: it reuses the dir if it already exists and attaches an existing branch rather than failing.

**The five read-only agents read the task tree, never `repoPath`.** The planner, plan judge, plan reviser and investigator are handed `Task tree: <tree>` and enter it with `taskTreeSetup`; the review judge is handed the same path as context only (the PR is authoritative: it reads the tree only when its HEAD equals the PR head and its status is clean, else `gh pr diff` / `gh pr view` alone). The planner and investigator **refresh** a reused tree: after a fetch they fast-forward it to `origin/<default branch>` only when it has no tracked changes and no commits of its own (`merge --ff-only` on a branch, `checkout --detach` only when already detached, so a branch tree is never detached); any skip prints `tree NOT refreshed: <why>; N behind origin/<base> as last fetched` for the agent to quote. The plan judge and reviser never move it. The planner and investigator also run the rollout's `env_bootstrap`, last and only once the shell is inside a tree that is its own toplevel, so a failed fetch or a stale plain directory at the tree path never runs it in (or under) the main checkout. Every `taskTreeSetup` prints `tree base: <sha>`; the plan's first line is `Planned on: <sha>`, and the plan judge compares the two and returns `changes` when a tree recreated or moved since planning no longer backs the plan. A detached tree met by a code-writing task's planner or judge (a read-only → code-writing scope flip on the same slug) is attached to `audit-fix/<alias>`: the existing branch, else a new one at HEAD, so no commit is lost. Agents tidy only what their own verifier run added (a before/after `status --porcelain` diff), never the env bootstrap's output. **`repoPath` is only the anchor and the branch source**; no agent reads its files. `merge-task.sh` still fast-forwards it after each merge (when it is on the base branch), because the reaper measures task branches against it (Cleanup, below).

**Why explicit, not `isolation: "worktree"`:** the harness's `isolation: "worktree"` worktrees the *session's* git root, not the target repo — from an ops/vault session it would grab `~/repos/workspaces` (the wrong repo) and ignore `repoPath` (verified empirically). Anchoring on `repoPath` makes the engine correct **from any launch location** (vault, ops, or the repo itself) and places worktrees under the target repo where the daily reaper finds them. The Workflow script has no shell, so the task's first agent creates the tree, not the engine.

**Cleanup** is the daily sweep's worktree reaper (`_shared/scripts/daily-sweep.sh` → `prune_worktrees`); the engine does not clean up after itself. Its rules, per worktree under `.claude/worktrees/`:

- It never reaps a tree whose `status --porcelain` is non-empty; untracked files count.
- `ahead` is `rev-list <main checkout's current branch>..<branch>`, measured against the **local** branch, not origin. A branch that reads as ahead is kept unless a merged PR exists for it. A detached tree resolves to `HEAD`, reads 0 ahead, and is reaped once clean.
- It skips a tree whose lock file names a live `pid N`, and unlocks and reaps stale locks.

Every `taskTreeSetup` locks the tree with `pid $PPID` (the Bash tool's parent is the long-lived Claude Code session), re-locking on each render, so **while a rollout session is alive its plan-gated and read-only task trees cannot be reaped**, detached read-only trees included. Only trees that went through `taskTreeSetup` are locked: an **ungated code-writing** task's tree is created by the implementer's GOLDEN-pinned `worktreeSetup`, which never locks it, so it is reapable as before (once clean and merged). A locked tree deleted by hand (`rm -rf`, no `worktree remove`) stays registered and `git worktree prune` skips it, so `taskTreeSetup` unlocks and prunes a missing tree's registration before its arms; re-running the setup recovers it. The consequences:

- Merged-task cleanup waits for the first sweep after the session ends (the lock is then stale).
- A zero-commit `audit-fix/*` tree of a plan-blocked, gate-pending or deferred task reads as ahead while the local checkout lags, and persists until the local base branch advances: `merge-task.sh` advances it after each merge, `--gated` included. Accepted and harmless: re-dispatch fast-forwards the tree.
- A tree can be reaped when the lead session ends before its implementer runs (a halt, a hard pause, a closed terminal), a plan-approved one included; the implementer's setup then recreates it from a newer `origin/<base>` (its verifier and the master review are the backstop). If a future harness makes `$PPID` short-lived, the lock reads as stale at once and a clean tree becomes reapable mid-run; `TASK_TREE_RULE` tells an agent whose tree vanishes to re-run the setup once and say so.
- An **ungated** task that flips from read-only to code-writing on a reused slug has no `taskTreeSetup` before its (GOLDEN-pinned) implementer, which reuses the detached tree without attaching it; its PR step fails and the task blocks with no PR, never silently. It relies on the reaper (after the earlier session ended) or `/thread:repair`'s clean defer removing the tree first.
- Removing a task tree by hand, or in repair's clean defer, needs `git worktree remove -f -f` because of the lock.

(If a target repo ever lives outside `~/repos`, widen the reaper's `find` root.)

## Protocol versions

| Version | Contract | Status |
|---|---|---|
| (absent) / 2 | Legacy in-conversation playbook (prose-driven dispatch + sentinel parsing) | Retired — regenerate via `/thread:schedule --regenerate` |
| 3 | Per-task Workflow convergence driven by a stored cursor, merged batch by batch | Retired — `/thread:schedule --regenerate` supersedes it into a queue |
| 4 | The readiness redesign on `codex/thread-rollout-redesign` | Never landed |
| 5 | The queue (ADR 0030): one task per Workflow call up to the parallel ceiling, the lead's Integration, `merge-task.sh` merging one integrated PR at a time | Current |

Future protocol bumps follow the same rule: a new executor refuses older versions and asks the user to regenerate.

## Resource budget

The lead caps task calls in flight at `parallel_ceiling` (resolved from rollouts.toml, built-in 4) so heavy-model rollouts never run more than that many worktrees concurrently. Convergence multiplies wall-clock, not memory: worst-case per task is roughly `max_iterations × verifier-time × max_review_rounds`. With the built-in values (3 × 5 min × 4) one stubborn task can occupy a worktree ~an hour. For rollouts dominated by cross-cutting long-verifier tasks, lower `max_review_rounds` in the rollout frontmatter.

Climbing shifts that arithmetic in rungs: a first pass below the top rung costs at most one implementation + **one** verifier run, and only a task that climbs pays the full convergence bill on the rung above (`1 × verifier` + that rung's `max_iterations × verifier × max_review_rounds`). A task on the top rung runs the full loop from its first pass, and its one same-rung retry adds `CAPPED_RETRY_ITERATIONS` (2) verifier runs: `max_iterations + 2` against a climbing task's `1 + max_iterations`. Mechanical tasks that land first-shot stay cheap on the bottom rung; proven-hard tasks cost one extra pass below over starting them on a higher `rung:`.

**Continuous auto-merge adds serial Integration time.** Integrations run one at a time: each merges the latest `main` in, re-runs the verifier unless `main` has not moved, re-reviews when needed, and waits on the PR's required checks before the squash. Budget ≈ (merge-in + verifier + any re-review + required checks + squash) per approved task, **sequentially** — new wall-clock the old "human merges later" path didn't charge to the run.
