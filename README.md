# thread — one system that drives work through time

Claude Code plugin, thirteen skills, two lanes. The **continuity verbs** solve
"too many live agent threads, and shutting one down feels like losing context"
— every route out of a thread captures its state somewhere durable. The
**rollout verbs** run large multi-PR changes as a wave-by-wave convergence
rollout on a Workflow engine. One rule connects them: the **execution-fit
test** (`skills/_shared/execution-fit.md`) decides which lane owns a cluster —
hard, never as a preference. Wave-shaped work (one repo, PR-per-task,
machine-verifiable in-run) rolls out; everything else runs as scoped sessions.

> Until v2.0.0 the rollout verbs shipped as the separate `wave` plugin
> (`lachyts/wave-skill`, now archived). "Wave" lives on as the domain term —
> rollouts still have waves — but the namespace is `/thread:*` throughout.

## Continuity verbs

| Member | Moment | What it does |
|---|---|---|
| `/thread:open` | resume/start | Open or create a durable `THREAD.md`; also picks up a stashed/deferred task (`/thread:open [[task]]`) and auto-completes it. |
| `/thread:next` | "what's my move?" | Router/advisor: summarise where we are, recommend a move, dispatch to a sibling route. |
| `/thread:orient` | back on a project, balls in the air | Project-altitude router: audit an area's open work, recommend the best use of time, ask the steering mode, then route by the execution-fit test — wave-shaped clusters to `gather`/`schedule`, the rest to `open` or to background batch sessions it launches itself (ADR 0010; the steering answer is the authorisation, dispatch artefacts are the no-cmux fallback). |
| `/thread:stash` | out of time, not my focus | Self-contained vault task, **no date**. Locked in, safely dormant. |
| `/thread:defer [day]` | tomorrow's problem | Self-contained vault task **scheduled** for `[day]` (default tomorrow). Surfaces on that day's page. |
| `/thread:handoff` | fork now | Compact this conversation into an inline copy-paste prompt for a fresh agent. |
| `/thread:close` | done | Persist to THREAD.md + auto-commit; end-of-thread ritual. |

## Rollout verbs

| Member | Role | What it does |
|---|---|---|
| `/thread:split` | decomposer | Turns a plan or design into numbered, phased, PR-sized Obsidian task notes. |
| `/thread:gather` | roadmap-former | Split's inverse: loose, unphased tasks → phased roadmap (cluster proposal → grilled meaning → phase notes + `pN-M` renames). |
| `/thread:schedule` | planner | Computes wave structure from file-overlap + dependency analysis; writes a thin, always-dated `<slug>-rollout-<YYYY-MM-DD>.md` (data only, `protocol_version: 3`). No minimum size — shape decides, not count. |
| `/thread:execute` | executor | Runs the rollout on a dynamic **Workflow**: per-task plan-gate → Ralph-style verifier retry → master review, converging in parallel within each wave; continuous mode auto-merges each wave (`--gated` = manual merge). |
| `/thread:status` | situational report | Read-only: where the rollout is, what's blocked, what drifted from GitHub reality, one recommended next action. |
| `/thread:repair` | conductor | Diagnose a stuck rollout, reconcile drift, ask only the decisions no agent can make, resume via execute — the engine keeps sole merge authority. |

## The convergence engine

`skills/execute/wave-execute.workflow.js` runs **three layers per task**,
converging tasks **in parallel within each wave**:

1. **Plan-gate** — an autonomous judge approves the implementation plan before
   code is written (skippable per rollout; a plan's declared gated inputs
   always pause for human sign-off — ADR 0008).
2. **Ralph-style verifier retry** — the implementer re-runs the rollout's
   verifier and self-corrects until green or the iteration budget is spent.
3. **Master review-and-revise** — a master-side reviewer accepts or sends the
   task back with feedback, up to `max_review_rounds`.

Worktree isolation is explicit: each task runs in
`<repoPath>/.claude/worktrees/<slug>`. Merges go **only** through
`skills/execute/scripts/merge-wave.sh` — gated on *required* status checks,
never `--admin`, never force. `skills/execute/scripts/reconcile-wave.py`
writes all per-task vault frontmatter transitions deterministically and drives
per-task resume.

## Design

- `CONTEXT.md` — the domain glossary (lane, wave-shaped, Task floor, Router,
  rollout, cursor, conductor, drift, tier, …).
- `skills/_shared/execution-fit.md` — the canonical lane rule.
- `skills/_shared/task-writer.md` — the single spec for writing + routing the
  vault task (dedup, day parsing, resume prompt, pickup auto-complete).
- `docs/adr/` — the decision record; read the directory for the current set.
  `0001`–`0003` are the continuity decisions (task floor; next is a sibling;
  orient is project-altitude next — 0003's packaging and launch conclusions
  since superseded by 0009 and 0010). `0004`–`0008` are the engine decisions
  (repair is a conductor; a phase is a plan; one-shot first pass, iteration
  escalates to Fable; a tier is a model+effort bundle; a declared gate always
  pauses). `0009` — thread absorbs wave: one plugin, one prefix, two lanes.
  `0010` — orient launches its own batches. `0011` — close saves
  autonomously; vault tasks stay gated.
- `docs/wave-THREAD-archive.md` — wave's full build history, verbatim.
- `docs/build-plan.md` — the approved 2026-07-14 build plan, historical.

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

Cut a versioned release with `claude plugin tag` once `plugin.json` +
`marketplace.json` agree (bump BOTH, always).

## Tests

```sh
node --check          skills/execute/wave-execute.workflow.js
bash -n               skills/execute/scripts/merge-wave.sh
bash                  skills/execute/scripts/merge-wave.sh --self-test-classify
python3 -m py_compile skills/execute/scripts/reconcile-wave.py
bash                  skills/execute/tests/reconcile-wave.test.sh
node                  skills/execute/tests/prompt-invariants.test.mjs
bash                  skills/execute/tests/wave-stop-driver.test.sh
```

`prompt-invariants.test.mjs` guards the **resume-cache invariant**: optional
engine features must render byte-identical Workflow `agent()` prompts when
unset, or in-flight rollouts can't resume.

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
