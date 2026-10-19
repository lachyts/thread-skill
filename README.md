# thread — one system that drives work through time

Claude Code plugin, twelve skills, two lanes. The **continuity verbs** solve
"too many live agent threads, and shutting one down feels like losing context"
— every route out of a thread captures its state somewhere durable. The
**rollout verbs** run large multi-PR changes as a queue of tasks on a
convergence engine, each integrated with the latest main before it merges. One
rule connects them: the **execution-fit test** (`skills/_shared/execution-fit.md`)
decides which lane owns a cluster — hard, never as a preference. Parallel-shaped
work (one repo, PR-per-task, machine-verifiable in-run, no external publish, no
tool the lead lacks) rolls out as a parallel rollout; serial-shaped work an agent
can still finish unattended (vault notes, several repos, no machine check in the
run, an external publish, a tool or profile the lead lacks) as a serial rollout
(ADR 0040); work that needs Lachy present or waits on a date runs as scoped
sessions.

> Until v2.0.0 the rollout verbs shipped as the separate `wave` plugin
> (`lachyts/wave-skill`, now archived). The namespace is `/thread:*`
> throughout, and since ADR 0030 a rollout is a queue.

> **Built for one setup.** This is a working reference implementation, published as-is, not a
> general-purpose plugin. The skills assume the author's machine: an Obsidian vault at
> `~/repos/obsidian` (TaskNotes tasks under `Work/Tasks/`, phases under `Work/Phases/`), a
> workspaces repo at `~/repos/workspaces` whose `_shared/` holds the note-writer specs, shared threads
> and the native-workflow exchange, and a Melbourne clock. Read it for the ideas (the execution-fit
> test, the convergence engine, the handoff lifecycle); expect to adapt paths before running it
> anywhere else. `make test` is hermetic and runs on any machine with bash, `python3` (with PyYAML, which
> the next-action script reads frontmatter with: `python3 -m pip install pyyaml`) and `node`.

## Continuity verbs

| Member | Moment | What it does |
|---|---|---|
| `/thread:open` | resume/start | Open or create a durable `THREAD.md`; also picks up a stashed/deferred task (`/thread:open [[task]]`) and auto-completes it. |
| `/thread:next` | "what's my move?" | Router/advisor: summarise where we are, recommend a move, dispatch to a sibling route. |
| `/thread:orient` | back on a project, balls in the air | The one shaping verb (ADR 0027): resolves its target (a project, area or note) from the argument or the session directory, asking only on a close call, then audits it and recommends the best use of time, then reshuffles without asking (ADR 0036: re-sort bugs, brain dumps, loose tasks and unstarted phases; grill what is unclear; write phases and `pN-M` tasks at one gate); `--steer` routes the work as it stands and `--look` stops at the audit, writing nothing. Schedules parallel-shaped phases itself, steers the rest (a serial rollout for serial-shaped work, ADR 0040, or a focus item via `open`), and ends with the execute offer. Pointed at one plan, design note or brain dump it runs a scoped reshuffle that turns it into phased tasks. |
| `/thread:stash` | out of time, not my focus | Self-contained vault task, **no date**. Locked in, safely dormant. |
| `/thread:defer [day]` | tomorrow's problem | Self-contained vault task **scheduled** for `[day]` (default tomorrow). Surfaces on that day's page. |
| `/thread:handoff` | fork now | Write a durable `docs/handoffs/` doc and land it (committed, then pushed or its merge queued, never waited on — ADR 0028) + paste-ready prompt (never OS temp; the consumer marks it consumed, its close deletes it — ADR 0017). In Codex Desktop or a Chorus Session also create a fresh visible task seeded with it (a sidebar task in Codex Desktop); elsewhere label it a manual handoff. |
| `/thread:close` | done | Persist to THREAD.md + auto-commit; end-of-thread ritual; lands its close-out and its own branch (ADR 0028): the own branch is reviewed by `/fresh-review` before its merge is queued. |

Stash, defer and close are the **set-downs** (estate ADR 0008, `~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md`): each writes the task's `next_action:` and points the `next_task:` of every project note the task links (area notes skipped) at it, most recent winning — close only when the thread has a concrete next task. `orient` reads that slot first and fills it only when blank. Both go through `skills/_shared/scripts/next-action.py` (`skills/_shared/task-writer.md` § 4b).

## Rollout verbs

| Member | Role | What it does |
|---|---|---|
| `/thread:schedule` | planner | Orders the backlog into a queue (dependencies recorded in frontmatter, Solo for sweeping changes, affine same-file clusters folded into one unit) and refuses a second unfinished parallel rollout on a repo (`--regenerate` supersedes it, carrying its unlanded tasks); writes a thin, always-dated `<slug>-rollout-<YYYY-MM-DD>.md` (data only, `protocol_version: 5`). An all-serial set gets one `shape: serial` note per chain, refused while a live chain shares a surface. No minimum size — shape decides, not count. |
| `/thread:execute` | executor | Runs the rollout's queue on a dynamic **Workflow**: per-task plan-gate → Ralph-style verifier retry → master review, one task per Workflow call up to `parallel_ceiling`; the lead integrates each approved task with the latest main and auto-merges it (`--gated` = a merge hold before each merge). A serial rollout runs as Legs: this session works its tasks and hands the rest to a fresh Leg. |
| `/thread:status` | situational report | Read-only: where the rollout is, what's blocked, what drifted from GitHub reality, one recommended next action. |
| `/thread:repair` | conductor | Diagnose a stuck rollout, reconcile drift, ask only the decisions no agent can make, resume via execute — the engine keeps sole merge authority. |
| `/thread:reflect` | tuner | The Reflection (ADR 0032, renamed by ADR 0037): fold the journals, score the Run record on its two headlines (Hands-off rate, and Quality from the Escapes traced to its landed tasks), the Guardrails (Throughput among them, bounded in running hours per task, and Review churn) against their bounds and the last Reflection, Slot and lane use, load and the binding constraint, and propose Tunings to `rollouts.toml`, each weighed for what it serves and risks; by hand only the ones Lachy picks are applied, by the tune script, which records each by-hand Reflection in `tunings.jsonl`. The weekly reading (`--weekly`, ADR 0037 d3–d5) reads every rollout since the last one, traces the friction to its rules, keeps Watches in `reflections.jsonl`, files bugs and lands a knob three Reflections agree on, never a rule: a rule proposal, or a held trade (a knob that trades one headline against the other), waits in one decision task for Lachy. |

## Runtime support

Orient's audit, reshuffle and steering are portable, and orient spawns no child
agents (ADR 0040 retired the ADR 0023 batches). The rollout executor still
requires its canonical Workflow runtime; shared source and skill discovery do not
provide that runtime.

## The convergence engine

`skills/execute/task.workflow.js` runs **three layers per task**,
**one task per Workflow call**; the lead fills slots up to `parallel_ceiling`,
integrates each approved task and merges it:

1. **Plan-gate** — an autonomous judge approves the implementation plan before
   code is written (skippable per rollout; a plan's declared gated inputs
   pause the task for sign-off, never the rollout; a spend gate within the
   standing approval passes — ADR 0008, ADR 0034).
2. **Ralph-style verifier retry** — the implementer re-runs the rollout's
   verifier and self-corrects until green or the iteration budget is spent.
3. **Master review-and-revise** — a master-side reviewer accepts or sends the
   task back with feedback, up to `max_review_rounds`.

The standing approval is off until `~/.config/thread/rollouts.toml` sets
`spend_approval_usd` (whole US dollars) under `[defaults]`; set it only after
installing a version that knows the key, because an older `rollout-settings.py`
refuses it, and every rollout's settings with it. `skills/_shared/scripts/gated_inputs.py`
holds the exposure reading it applies and schedule's gated-input sweep.

A needs-you push that does not reach you (any "not sent" but you at the
terminal, such as Remote Control inactive or notifications turned off, a
push-tool error, or no push tool at all, as in Codex) falls back to ntfy once
`~/.config/thread/rollouts.toml` sets `[notify] ntfy_topic = "<topic>"`.
`rollout-settings.py` prints only whether a topic is set, never the topic.
Unset, there is no fallback, and an undelivered push is logged `push failed:`
in the rollout note's `## Needs-you log` and retried once at the next loop
entry. Install a release that knows the table before writing it: an older
`rollout-settings.py` refuses the table, and every rollout's settings with it.
`skills/execute/scripts/ntfy-push.py` sends the item (execute § 6.5, ADR 0038).

Worktree isolation is explicit: each task runs in
`<repoPath>/.claude/worktrees/<slug>`. Merges go **only** through
`skills/execute/scripts/merge-task.sh` — gated on *required* status checks,
never `--admin`, never force. `skills/execute/scripts/reconcile-rollout.py`
writes all per-task vault frontmatter transitions deterministically and drives
per-task resume; `skills/execute/scripts/lead-integrate.py` is the lead's side
of Integration (the clean-path merge and its bounded verify, the trouble-path
inputs and the lead's own set-aside rows).
`skills/execute/scripts/verify-slot.py` holds the machine's verify slots (p23-4):
at most `verify_slots` verifier suites run at once across every rollout on the
machine (the lead's Integration and RACE verifies, and every agent's
engine-rendered verifier), a further one waits, and each runs under a guard
that ends a killed holder's suite before its verify slot frees;
`verify-slot.py status` shows who holds each verify slot and who waits.
`skills/execute/scripts/git-env-canary.py` is the lead's git-env canary: it
watches the shared checkout's default branch and bareness around every launch
and halts the queue on a change that is not a close-out (execute § 4.5).
`skills/execute/scripts/step-boundary.py` is the lead's side of a Chorus room
stop: it reads the Workflow journals to stop each call at a step boundary and
records the stop on the rollout note (execute § Room stop).
`skills/_shared/scripts/run_record.py` is the Run record's one writer (ADR 0032):
every emitter appends its events through it, and its header is the schema.
`skills/reflect/scripts/score.py` reads a record into a Reflection's scores and
proposals (writing nothing), and `skills/reflect/scripts/escapes.py`, which it loads,
reads the landed tasks' Escapes and Quality from the task notes' `fixes:` and the
Project root's git (reverts, later review findings), writing nothing either.
`skills/reflect/scripts/tune.py` is the only writer of `rollouts.toml` and
`tunings.jsonl`: it applies the Tunings Lachy picks and the knobs the weekly
reading lands or reverts (ADR 0037 d5), and records one line per by-hand Reflection.
`skills/reflect/scripts/close-score.py` runs the script
half of a Reflection at each rollout's close (fold, settings, score,
`tune.py --record-only --close`) and records one line per rollout through it
(ADR 0037 d4). `skills/reflect/scripts/reflect.py` runs the weekly reading's
script half and is the only writer of `reflections.jsonl` and of the bug and
decision tasks. `skills/reflect/scripts/reflect-due.py` tells the daily sweep
when the weekly reading is due: 7 days after the last one, 14 after three quiet
Reflections in a row (ADR 0037 d4, d6).

## Design

- `CONTEXT.md` — the domain glossary (lane, parallel-shaped, Task floor, Router,
  rollout, cursor, conductor, drift, tier, …).
- `skills/_shared/execution-fit.md` — the canonical lane rule.
- `skills/_shared/task-writer.md` — the single spec for writing + routing the
  vault task (dedup, day parsing, resume prompt, pickup auto-complete).
- `skills/_shared/plugin-root.md` — the one rule for running a
  `${CLAUDE_PLUGIN_ROOT}` command from text read as a file rather than rendered
  (a sibling SKILL.md a router follows, a `_shared` spec); every skill cites it.
- `docs/adr/` — the decision record; read the directory for the current set.
  Each ADR's Status line is the one place its state is recorded: a
  back-reference in another ADR reads `*(Amended by ADR NNNN, <date>: <what
  changed>.)*` and never copies the target's status. This list says what each
  decided; read an ADR's own Status line for where it stands.
  `0001`–`0003` are the continuity decisions (task floor; next is a sibling;
  orient is project-altitude next — 0003's packaging and launch conclusions
  since superseded by 0009 and 0010, and 0010's in turn by 0023). `0004`–`0008`
  are the engine decisions (repair is a conductor; a phase is a plan; one-shot
  first pass, then iteration escalates, to Fable as first decided and up the
  operator's ladder since 0029; a tier is a model+effort bundle; a declared
  gate always pauses). `0009` — thread absorbs wave: one plugin, one prefix, two lanes.
  `0010` — orient launches its own batches (superseded by `0023`). `0011` —
  close saves autonomously; vault tasks stay gated. `0012` — process candidates flow to
  the project's METHOD.md (cross-repo interface with the `method` skill).
  `0013` — only list items declare gates. `0014` — stash and defer run the
  silent process scan. `0015` — process candidates route by altitude
  (project / seat / estate; amends 0012 and 0014; canonical design record is
  workspaces ADR 0003). `0016` — a tier ceiling caps escalation when quota is
  gone (amends 0006). `0017` — a pending handoff owns the thread's
  continuation: handoff docs are durable and self-cleaning, and close refreshes
  a pending one instead of proposing vault tasks that restate it (amends 0011).
  `0023` — orient dispatches native children of its own session: one launch
  model, collect-and-accept, a batch lands once (supersedes 0010; amends
  0003). `0024` — the operator's top tier sets every rollout's ceiling
  (amends 0016; superseded by 0029 before it was built). `0025` — master moves only by green
  PR, owner included. (0018–0022 are reserved: they are on the protocol 4
  branch.) `0026` — finished work closes itself (amends 0011). `0027` — orient is the one shaping
  verb (amends 0003, 0009, 0010 and 0026; retires `split` and `gather`).
  `0028` — agents land their own work (amends 0011). `0029` — escalation
  climbs the operator's ladder (supersedes 0024; amends 0006, 0007 and 0016).
  `0030` — a rollout is a queue that integrates at merge (one engine, no
  alias; amends 0009). `0031` — the primary checkout holds while a rollout
  runs (amends 0030). `0032` — rollouts keep a Run record and tune by Retro.
  `0033` — execute retries agent-fixable set-asides itself (amends 0004 and
  0030). `0034` — a gate never holds an unattended rollout (amends 0008).
  `0035` — one human fix per refusal (amends 0033). `0036` — orient resolves
  its target before it reads, then reshuffles without asking (amends 0026 and
  0027). `0037` — Reflections run on their own and tune for hands-off quality
  (amends 0032). `0038` — a Cap is a promise: a spend gate is one line, its split
  in sub-bullets, and an undelivered push falls back to ntfy (amends 0034).
  `0039` — a code project's thread lives in its repo; one live THREAD.md per
  project; the placement check (amends 0017). `0040` — a rollout is parallel or
  serial: a three-way execution-fit test, and orient's child-agent batches
  retire (amends 0023).
- `docs/wave-THREAD-archive.md` — wave's full build history, verbatim.
- `docs/build-plan.md` — the approved 2026-07-14 build plan, historical.

## Upgrading to 4.0.0

4.0.0 renames one verb and changes one record:

- **The scoring verb is `/thread:reflect` (ADR 0037).** It was renamed in
  4.0.0 with no alias, so a saved prompt, macro or task resume prompt that
  calls the previous name gets an unknown-skill error: point it at
  `/thread:reflect`. Completion logs written before 4.0.0 offer the previous
  name; read them as `/thread:reflect`.
- **Tuning records are schema v2.** `tunings.jsonl` lines written by 4.0.0
  carry the new fields; older lines still read.

## Upgrading to 3.0.0

3.0.0 breaks anyone running rollouts:

- **A rollout is a queue (ADR 0030).** Execute runs only
  `protocol_version: 5` rollout notes and refuses older ones. If a session is
  running an older rollout, hard-pause it, then run
  `/thread:schedule <project> --regenerate`: the supersede carries every
  unlanded task into a queue.
- **Escalation no longer climbs to Fable by default (ADR 0029).** It climbs
  the operator's ladder, `~/.config/thread/ladder.toml`. With no file,
  the built-in ladder has two Opus rungs, so a machine without the file never
  leaves Opus. To keep a Fable step, name it as a rung in that file. The
  rollout's `max_tier:` key is retired: execute ignores it with a warning. If
  an operator instruction (an AGENTS.md "model tier" section, say) tells
  schedule to stamp `max_tier:`, drop that line and set the ceiling as the
  ladder's top rung instead.
- **Rollout defaults are the operator's (ADR 0032).** `parallel_ceiling`,
  `max_iterations`, `max_review_rounds` and `max_plan_rounds` come from
  `~/.config/thread/rollouts.toml` (built-ins when it sets none), and
  `/thread:reflect` proposes changes to that file from a run's record. Schedule
  stamps the values it resolves into each rollout note's frontmatter, and
  execute reads the note first, so an edit to the file reaches the next
  scheduled (or `--regenerate`d) rollout, not one already written. A task's
  own frontmatter still overrides `max_iterations`, `max_review_rounds` and
  `max_plan_rounds`. `verify_slots` (built-in 2) is machine-wide: set it under
  `[defaults]` only (a `[repo."owner/name"]` table that sets it is refused); it
  is never stamped, and execute's `verify-timeout` reads it, validating the
  whole file, at each loop entry. So install first: write a new key only once
  the installed plugin knows it, because a refused file now halts every
  rollout on the machine at its next entry, stamped or not. Stamping a key on
  the rollout note does not clear that halt; only fixing the file at the line
  its stderr names does.
- **Schedule picks the rollout root (#108).** When the Project root is the
  live directory-source plugin checkout, schedule uses the separate
  `<repoPath>-rollout` clone, or refuses with the fix.

## Install

**Stable channel** (loads every session):

```sh
claude plugin marketplace add https://github.com/lachyts/thread-skill
claude plugin install thread@thread
```

**Dev / heavy iteration** — load the working tree directly, no reinstall loop:

```sh
claude --plugin-dir ~/repos/tools/thread-skill
```

A release bumps `plugin.json` and `marketplace.json` together (BOTH, always). `master` is protected
(ADR 0025): the bump, like every other change, lands through a pull request with a green `make test`
check, and nobody pushes to `master` directly, the owner included. **Tag after the merge, on master's
merged commit**: `git fetch origin && git switch --detach origin/master`, then `claude plugin tag --push`
(detached, so it works even while local `master` holds unpushed commits). Tagging the branch before a
squash merge tags a commit that never reaches master.

## Tests

```sh
make test            # = bash tests/run.sh — the one entrypoint, and the self-rollout verifier
make evals           # behaviour evals: real model calls, a human step, never part of make test
```

`tests/run.sh` runs everything hermetically (temp `HOME` and global git config, a temp verify-slot
pool, no bytecode, and a final check that the run wrote nothing into the tree). It runs at most a third
of the cores' worth of background suites at once (at least 2; 4 on 12 cores), largest first, and node
at the same concurrency; `THREAD_TEST_JOBS=<n> make test` sets the cap (CI pins 4):

- **Syntax** — `bash -n` on every shell script, `ast.parse` on every Python script, and a real parse
  of every `*.workflow.js` (`tests/lib/check-workflow-parse.sh`: the body wrapped the way the Workflow
  runtime wraps it; `node --check` silently passes broken ESM on Node 23, so it is not used).
- **Engine** — `skills/execute/tests/`: `prompt-invariants.test.mjs` guards the **resume-cache
  invariant** (optional engine features must render byte-identical Workflow `agent()` prompts when
  unset, or in-flight rollouts can't resume); `reconcile-rollout.test.sh`, `reconcile-rollout-queue.test.sh`
  (the queue verbs), `reconcile-rollout-runs.test.sh` (accumulated feedback runs), `reconcile-rollout-lead.test.sh`
  (`hand-back`, `log-integration`), `reconcile-rollout-descope.test.sh` (the automatic-descope verb and its recorded
  refusal) and `reconcile-rollout-human-fix.test.sh` (`inputs`' one Human fix per refusal, the recorded answer,
  `record-answer` and `hand-back --answer`, ADR 0035); `rollout-stop-driver.test.sh`; `tests/lead-integrate.test.sh` (the lead's
  Integration against a fake `gh` and real repos) and `tests/contracts/execute-queue.test.mjs` (the queue loop's prose);
  `merge-task.sh --self-test-classify` / `--self-test-base`, and `tests/merge-task-base.test.sh` /
  `tests/merge-task-integrated.test.sh` (one integrated PR per call, against a fake `gh` and a real bare repo).
- **Contracts** — `tests/contracts/*.test.mjs`: manifests agree, skill names and description budgets,
  `${CLAUDE_PLUGIN_ROOT}` references resolve, hooks target real files, no SKILL.md body holds a
  positional `$N` (Claude Code substitutes skill arguments into them; logic that needs one lives in a
  script), the next-action set-down write and orient's slot read (`next-action.test.mjs`), orient's
  target resolution before it reads and its one learned `repos:` write (`orient-target.test.mjs`),
  orient's declared check, its gate and digest-bound advance (`orient-declared-check.test.mjs`),
  orient's launch-model history (`orient-launch-model.test.mjs`), the three-way execution-fit test and
  orient's retired batches (`execution-fit-shapes.test.mjs`, ADR 0040), and
  `thread:handoff` as the handoff doc's one writer plus `next`'s compact recommendation
  (`handoff-one-writer.test.mjs`), `next`'s archive-this-session move and its session/thread menu wording
  (`next-archive-session.test.mjs`), and the queue as the only rollout (`queue-only.test.mjs`: retired names
  and files stay gone, and every surviving mention is a listed refusal, migration strip or history line).
- **Reflection** — `tests/reflect-score.test.mjs` (`score.py` on synthetic records: running time and its
  exclusions, the Hands-off rate and its acts, Throughput's bound, the Slot-bound and lane-bound fixtures, each
  proposal's direction, cause and weighing, the baseline (a v1 line included), load),
  `tests/reflect-escapes.test.mjs` (`escapes.py` through `score.py` against throwaway repos and vaults: `fixes:` in
  every form, reverts, later review findings of landed work bounded by blame, and the unread, unresolved and
  partial readings), `tests/reflect-tune.test.mjs` (`tune.py` edits only the picked keys, records one line, and
  writes nothing on a refusal or a failed write), `tests/reflect-close-score.test.mjs` (`close-score.py` end to end:
  one close line per rollout, the re-run, nothing ran, failures, step timeouts and the overall deadline, signals and
  the GIT_* scrub), `tests/reflect-weekly.test.mjs` (`reflect.py`'s weekly reading against throwaway records,
  vaults and repos: the span and its friction, close lines and the Escapes sweep, one line per Watch and per Tuning,
  the bug and decision tasks never written over, Lachy's recorded no, the close and the rung),
  `tests/reflect-due.test.mjs` (`reflect-due.py` on fixture records: due at day 7 and not day 6, three quiet
  Reflections to the 14-day cadence and a non-quiet one back to 7, and the cadence `close` writes),
  `tests/contracts/reflect.test.mjs` (the verb's wiring, every close scoring its rollout, its
  SKILL's order and triggers, and the retired name staying gone) and `tests/contracts/escapes-fixes-key.test.mjs` (every
  writer of a fix of landed work adds `fixes:`, and the Reflection presents Quality).
- **Next-action script** — `tests/next-action.test.mjs`: `next-action.py`'s set-down, fill, read and
  captures against throwaway vaults — byte-level one-line edits, YAML-safe quoting, both tag forms, the
  shared dead-link rule, and refusals that write nothing.
- **Target resolver** — `tests/resolve-target.test.mjs`: `resolve-target.py` against a fixture vault of real
  names, aliases and `area:`/`repos:` shapes and a fake HOME with umbrella repos — each rung and outcome,
  the clear winner and the close call, a shared directory, `--learn`'s one-line append and every refusal
  that writes nothing.
- **Placement check** — `tests/thread-placement.test.mjs`: `thread-placement.py` against a fixture vault and a fake
  HOME of repos, linked worktrees, a submodule, a clone, origins and seat subfolders — each kind and its owners, the
  folder-to-note attribution (declared entry, exact name, repo name; never an ancestor or a fuzzy hit), one finding
  per thread identity, `home`, the scopes, parity with open's lookup, and read-only runs;
  `tests/contracts/thread-placement-wiring.test.mjs` pins its callers in open, close, handoff, orient and the docs.
- **Estate scan** — `tests/estate-scan.test.mjs`: `estate-scan.py` against fixture vaults, fixture repos and a fake
  ssh remote — done and parked projects, open tasks homed under every live project and the unhomed with their
  reasons, each dispatch blocker (self-rollout, GitHub origin, landing register, unpushed default branch, unfinished
  rollout, verifier), the verifier's section reading (a `## Verifier`, `### Tests` or `## Testing` heading, an
  `@AGENTS.md` import, a `Tests:` line) and a live rollout's `verifier:` (given only to the repo whose toplevel its
  Project root is, never to a parent repo), phase members by filename prefix, content already on origin, live
  rollouts' status with pending sign-offs, BatchMode, `--offline`, the group-killing timeout and absolute deadline
  (and SIGTERM), an unreadable Tasks note, the env scrub when its probe fails, read-only runs, byte-equal reruns and
  parity with `pushed-base.sh` on copies of the fixtures.
- **Declared check** — `tests/declared-check.test.mjs`: `declared-check.py` against a fixture vault and repos
  with a fixture check — undeclared, whole untruncated output and its digest, the advance on a matching digest
  and the hold on a changed one or a failed re-run, the group-killing time limit (and on a signal, even one that
  lands while the check starts), the stderr tail, the one-simple-command guard through both verbs (read with sh's
  quoting rules), the scrubbed git env, and every refusal.
- **Default branch** — `tests/default-branch.test.{mjs,sh}`: `defaultBranch` keeps pre-fix bytes when
  unset, refuses unsafe names, and the resolver in `execute/SKILL.md` § 4 works against fixture remotes.
- **Release check** — `tests/release-check.test.sh`: the real `make release-check` recipe against a temp
  tree and a fake config dir (matching, stray, noise-only, differing, missing and mismatched caches,
  and a non-empty evals/results/).
- **Evals structure** — `tests/contracts/evals-structure.test.mjs` checks the `evals/` suite's shape for
  free and never runs it (case discovery, frontmatter keys and types, read-only tool grants, graders, and
  `make evals` kept out of `make test` and off the default goal). The suite itself is scored by
  `claude plugin eval` via `make evals`, a human step outside `make test`; its baseline is recorded in
  `docs/evals/`.

New suites join by filename: `tests/*.test.mjs`, `tests/contracts/*.test.mjs` and
`skills/execute/tests/*.test.mjs` run under `node --test`; `tests/*.test.sh` and
`skills/execute/tests/*.test.sh` run concurrently, output grouped per suite. `skills/execute/diagnostics/` holds paid live
diagnostics (Workflow runtime + real agents) — parse-checked, never run by `make test`.

After a release, `make release-check` confirms both manifests agree and the version-keyed plugin
cache (what `${CLAUDE_PLUGIN_ROOT}` — the engine, scripts and hook — runs from on a marketplace install)
matches the tree. It also fails on cache files the tree doesn't track (`.DS_Store` and `__pycache__/` exempt), so run it
on the released commit, right after the plugin update. It refuses first while `evals/results/` holds
`make evals` output: record what you need in `docs/evals/`, then clear it before the plugin update,
since the `./` source would copy it into the cache. If a copy already reached the cache, the refusal
names the `evals/results` dir to delete there. A directory-source install (or `--plugin-dir`) runs live from its
checkout instead, the **primary checkout**, which never moves while a rollout runs on it (ADR 0031).

## Coexistence with Orca

The rollout lane (autonomy) and **Orca** (https://www.onorca.dev/ — a GUI ADE
for supervised parallel agents) run in separate lanes: thread owns autonomous
batch rollouts; Orca owns supervised/exploratory work. They share repos and
the `.git/worktrees/` registry without colliding — Orca auto-discovers the
engine's worktrees as `external` and doubles as a **read-only window** onto a
running rollout. Rules of the road: observe, don't hand-edit mid-rollout
(repair with `/thread:repair`); the engine owns `audit-fix/*` branch names;
the 11am `daily-git-sweep` reaper only removes clean AND merged worktrees. If
you do hand-edit in Orca, commit on the existing `audit-fix/<alias>` branch,
push but never merge — the engine still merges.

## Lineage

The continuity verbs absorb three previously flat skills: `/thread`
(→ `thread:open`), `/close` (→ `thread:close`), and `/handoff`
(→ `thread:handoff`; originally from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT — attribution
retained in the skill). The rollout verbs were the `wave` plugin (v1.0.0 →
v1.4.1, merged in at thread 2.0.0 with full git history; born from a
2026-06-02 end-to-end giflab rollout — 8 waves, 14 PRs).
