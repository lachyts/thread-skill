---
audited: 2026-09-23
head: 1c87bd4 (master, 2.5.1)
scope: whole plugin — state, inefficiencies, backlog, direction; tests; rollout readiness
method: /thread:orient [[Thread Skill]] — three read-only explorers (vault + redesign, tests, drift) and one design pass
---

# Thread plugin audit — 2026-09-23

## Headline

2.5.1 is shipped and its engine suites are green (prompt-invariants 191/191, reconcile 115/0, stop
driver 16/0, classifier 12/12). The plugin carries **two eras at once**: master (protocol 3) and a
**paused protocol 4 redesign** on `codex/thread-rollout-redesign` (36 commits, +15.6k lines, three
live pilots merged on agent-reader, release blocked on the native max-effort review contract, owned by
the Codex thread 1 coordinator, nothing running). The backlog is **33 open [[Thread Skill]] tasks
and no phases**; the project note said `status: parked` while the redesign was being worked.

## Where it's at

| Group | Item |
|---|---|
| Active | Nothing running on this plugin. Three unrelated protocol 3 rollouts (audio-intake, giflab, narcissus-avp, all 2026-09-23) dispatched waves today — the live test bed for the engine. |
| In flight, paused | Protocol 4. Vault gate `thread-rollout-v4-native-acceptance` (high). Remaining, in the pending handoff on that branch: decide the native max-effort review contract (ADR), dispatch/result shape, finish the helper audit, commit the Claude review-path report, a fresh bounded check, then a two-task pilot per harness. The shared adapter branch `codex/thread-native-recovery` in `~/repos/workspaces` is unmerged. `codex/codex-routing-capability-check` holds two commits (`8c5980b`, `150504d`) the redesign branch cites but does not contain. |
| Stalled | `method-skill-bakeoff-fixes` — `dispatched: 2026-09-13`, still open (includes a thread:close fix). Handoff-tripwire captures overdue (09-21, 09-22) and due today. `Consider rewriting the ralph loop…` scheduled 2026-07-19. |
| Stale-open | 8 agent-reader protocol 4 pilot requirement notes (PRs #13–#20 merged, rollout notes archived) — protocol 4 treats requirement notes as immutable, so nothing closes them: a design gap for thread 1. `thread-skill-handoff-widens-to-a-chorus-session` — half done: the handoff wording landed in `5f4e666`; the `/thread:schedule` card (Chorus p12) remains. `wave-skill-live-bed-v13-features` — stale since the engine reached 2.x. |
| Loading | Skill **text** loads from this working tree (directory-source marketplace); `${CLAUDE_PLUGIN_ROOT}` — the engine, scripts and Stop hook — loads from the version-keyed cache. HEAD had diverged from the 2.5.1 cache (`5f4e666`, unbumped). A stale project-scope `thread@thread` 2.3.4 install was registered at `/Users/lachlants`. |

## Inefficiencies (ranked by impact × ease)

1. **Orient's doctrine is split.** Orient dispatches native children through
   `~/repos/workspaces/_shared/scripts/native_workflow.md` (commits `e586b19`, `e4b8378`, no ADR),
   but ADR 0010 (cmux) is still `accepted` and calls in-session fan-out "impossible". Orient
   contradicts itself: "background scoped sessions" (`:13`, `:98`), cc-* batches (`:121`, `:218`),
   launch-profile matching (`:134-137`) against "a workspace path does not load another profile"
   (`:36-37`), fire-and-forget (`:196`) against collect-and-accept (`:160`). README (`:22`, `:41-45`),
   `_shared/execution-fit.md:9` and the Codex orient adapter still say cmux.
2. **Context cost.** About 3.1k tokens always-on (`claude plugin details thread`). On invoke: execute
   ~19.6k, schedule ~14k, close ~11.4k. stash and defer cite close three times (category 7, project
   directory resolution, commit hygiene), so a "lightweight exit" loads ~11.4k tokens of close; their
   process-scan paragraph is byte-identical (`stash:18`, `defer:18`). Five descriptions exceed the
   ~700-char target (handoff 787, orient 742, schedule 722, split 721, close 707). The Codex `thread`
   router is symlinked into `~/.claude/skills`, adding 274 chars of duplicate listing.
3. **THREAD.md is 34KB.** "Where we are" is 212 lines against the template's 2–4 sentences, and six
   passages disagree about the plugin cache (`:62-63`, `:169-170`, `:304-307`, `:351-374`,
   `:375-394`, resume step 0).
4. **Tests were thin and partly vacuous.** `node --check` on the engine passes broken ESM on Node 23
   (the orchestration tail was never parsed by anything); `py_compile` wrote `__pycache__` into the
   tree; no runner, no CI. Nine skills and both `_shared` specs had no test at all.
5. **Duplication and drift.** Execution-fit restated near-verbatim in schedule §0 (`:31-46`); split
   inlines a task schema (`:106-128`) against its own Don'ts; the handoff lifecycle is written in five
   places and `<home>` resolves differently in handoff (`:62-64`) and close (`:78`); the EFFORT matrix
   has three homes; execute explains pause mechanics five times. `rollout-template.md:45` uses
   `{{THREAD_LINE}}` where schedule documents `{{THREAD_PATH}}`; `{{PROJECT_SLUG}}` is documented and
   unused. Loose references: "ADR 0008 §3.7" (means execute § 3.7), gather's "add-task.md § Phased
   tasks" (no such heading), handoff's unqualified "ADR 0047" (Chorus's), THREAD.md citing deleted
   review and handoff docs by path.
6. **Instruction gaps.** close has no rule for a THREAD.md inside a tool repo and no step that
   commits one; open's `save` alias is under-specified; close's handoff scan misclassifies CRLF docs
   as legacy; `task-writer.md:48` and `defer/SKILL.md:14` use macOS-only `date -v`.
7. **Stop hook overhead** (engine surface, held). It runs every turn in every session, reads a 5MB
   transcript tail when no WAVE-STATUS line is in the payload, and after releasing a stalled rollout
   repeats its system message on every later Stop.

## Known open defects

- **The engine hardcoded `origin/main`** (`wave-execute.workflow.js:720,726`, `merge-wave.sh`), so a
  rollout on a `master` repo — this one included — failed at its first worktree; audio-intake only
  works because someone keeps an `origin/main` copy by hand. **Fixed in 2.5.2** (`defaultBranch`,
  below). The redesign still hardcodes it on its protocol 3 path.
- `/thread:status` and `/thread:repair` never read `tier_capped`, and `reconcile-wave.py status` does
  not emit it (`cmd_status`, `:732-787`) — the redesign already carries most of the fix.
- A capped run that goes green first time records nothing (`tierCapped: !!st.capSuppressed`).
- `planLoop`/`reviewLoop` return undefined at a zero round budget, so the ADR 0008 gate fails open —
  a safety bug worth gating the protocol 4 release on.
- close's consumed-handoff delete has no peer-session guard (two sessions can share one checkout).

## Things to pick up

The 33 open tasks sort into four wave-shaped phases for a self-rollout (test floor and contracts;
continuity core; routing and docs coherence; behaviour evals), a **held** set that belongs to
protocol 4 (every engine defect, the tier doctrine, the Stop hook), and session-lane misfits (the
context-level handoff tripwire, which lives in `~/repos/workspaces`; defer-as-project-next-step; the
Codex adapters; THREAD.md compaction after protocol 4). The draft phase table is in the 2026-09-23
handoff doc and is grilled through `/thread:gather`.

## Where it's going

Protocol 4 native rollouts (thread 1's release gate); Opus 5.5 as the top tier (a doctrine ADR, held
with the engine); handoff as a suggestion rather than an automatic context tripwire; the Chorus
Suggestion-card seam; and a plugin that is cheaper to load with a real test floor, so skill edits stop
depending on live runs to find drift.

## Done in this pass (2.5.2 enabler)

- `make test` / `tests/run.sh` — one hermetic entrypoint that also hosts the redesign's suites.
- A real Workflow parse (`tests/lib/check-workflow-parse.sh`) with a broken-body control; mutation
  check: a truncated orchestration tail passes `node --check` and fails the new check.
- `tests/contracts/manifest.test.mjs` — manifests, skill names, description cap and total ratchet,
  hook targets, `${CLAUDE_PLUGIN_ROOT}` references.
- One source for the base: the repo's GitHub default branch. `args.defaultBranch` in the engine
  (validated against git's ref-name rules; byte-identical prompts when unset or `main`, golden-hashed)
  cuts fresh worktrees from `origin/<it>`; `gh pr create` targets the same default on its own. The
  resolver in `execute/SKILL.md` § 4 asks the remote (`ls-remote --symref`; a cached `origin/HEAD` can
  be stale) and stops rather than assume `main`. `merge-wave.sh` reads the default from GitHub and
  checks every PR before the first merge — off-base, mixed, unreadable or CLOSED halts with nothing
  merged (`tests/merge-wave-base.test.sh`, fake `gh`); `--self-test-base` proves a checkout on another branch
  is left untouched.
- `make release-check` for the version-keyed cache.
