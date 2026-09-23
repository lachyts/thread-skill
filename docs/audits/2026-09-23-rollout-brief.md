# Rollout brief — thread plugin: live E2E baseline, then gather → schedule → self-rollout

Continues the 2026-09-23 audit session (`docs/audits/2026-09-23-thread-audit.md`). That session
shipped **2.5.2** (test runner + contract floor + the `origin/main` fix) and **2.5.3** (the self-rollout
guidance: run it from a separate clone), both through the cache and verified by `make release-check`. This brief carries two
sessions: **S1** runs verbs 1–13 of the live end-to-end checklist and ends in the fixture's own
handoff; **S2** consumes that fixture handoff (verbs 14–15), cleans up, then runs
`/thread:gather Thread Skill` → `/thread:schedule` → `/thread:execute` from a separate rollout clone.

## Decisions already made (do not re-open)

- Big test = three layers: contract tests (`make test`, shipped), behaviour evals (built by the
  rollout's P4), and this live E2E pass as the baseline.
- **Engine work is held for protocol 4** (`codex/thread-rollout-redesign`, paused, thread 1's). The
  rollout touches continuity verbs, shared specs, docs and tests only.
- The self-rollout runs **continuous auto-merge**; verifier `make test`; known baseline failures `none`.
- The live E2E may create and delete the private GitHub repo `lachyts/zz-thread-e2e` (master only).
- `defaultBranch` is the argument name (never `baseBranch` — protocol 4 owns that); the resolver
  **stops** when it cannot resolve, never assumes `main`; a resume re-passes the original args.

## S1 — live E2E, verbs 1–13

Launch a **fresh** session (the engine binds `${CLAUDE_PLUGIN_ROOT}` to the cache at start) with
cwd = `~/repos/tools/zz-thread-e2e` after § 0 of the checklist creates it. Checklist:
`~/repos/tools/thread-skill/docs/e2e/2026-09-23-baseline.md` — fill the Result column as you go.
Verbs that ask questions need Lachy present. Verb 13's `/thread:handoff` writes the fixture's handoff
doc; S2 starts from it.

## S2 — verbs 14–15, cleanup, then the rollout

1. `/thread:open <fixture handoff doc>` and `/thread:close` (verbs 14–15), leak check, cleanup (§§ 3–4),
   record findings (§ 5) — each FAIL/KNOWN becomes a vault task before gather. Commit the filled
   checklist in thread-skill.
2. `/thread:gather Thread Skill` — full mode, **grill-with-docs**. Two rules for the grill: new ADRs
   number from **0023** (the redesign uses 0018–0022); **decline CONTEXT.md edits** (the redesign
   rewrites it). Every task gets `touches:`, `depends-on:` and a verify line (`make test` plus its
   check). The draft below is a proposal — every row is Lachy's call.
3. Execution-fit per phase (P1–P4 are expected wave-shaped), then `/thread:schedule Thread Skill`.
4. **Run the rollout from a separate clone.** Skill text loads live from `~/repos/tools/thread-skill`,
   so merges must not land there mid-rollout; and the engine's read-only agents (planner, plan judge and
   reviser, investigator, review judge) read `repoPath` directly, so `repoPath` must be a checkout that
   merge-wave keeps fast-forwarded (execute/SKILL.md § Worktree lifecycle). So:
   - `gh repo clone lachyts/thread-skill ~/repos/tools/thread-skill-rollout` — **GitHub origin**, never a
     clone of the live checkout (a path origin breaks the resolver, `gh pr create` and merge-wave), and
     **under `~/repos`** so the daily reaper finds its `.claude/worktrees/`.
   - Set the rollout note's **Project root** to the clone: schedule takes it from the project note's
     `repos:`/`Local:` (the live checkout), so override it at schedule's confirm step, and check it before
     `/thread:execute`.
   - **Task bodies cite repo-relative paths only** (`skills/close/SKILL.md`, never
     `~/repos/tools/thread-skill/...`) — make this a grill rule in gather. Planners read "every source file
     it references", and an absolute path would send them (and an implementer) to the live checkout.
   - The clone stays on `master`, clean. Known limit, held for protocol 4:
     `thread-skill-read-only-agents-read-a-mutable-checkout`.
5. `/thread:execute [[thread-skill-rollout-…]]` continuous.
6. **Release 2.6.0** after the rollout: `git -C ~/repos/tools/thread-skill pull --ff-only`, commit the
   2.6.0 bump of both manifests and push, `claude plugin marketplace update thread && claude plugin
   update thread@thread`, `make release-check` (pulling alone updates the skill text but not the cached engine), fresh session,
   re-run the E2E checklist + an eval smoke run
   (`claude plugin eval . --runs 1 --max-cost-usd 5 --no-publish --threshold 0`), record the eval
   baseline in `docs/evals/`, then approve p4-5's gate.

## Draft phase table (gather step 2 proposal)

**P1 — Test floor and contracts**
- p1-0 Consume the 2.5.2 simplify round (`docs/reviews/2026-09-23-c5f7421-399e2e.md`, status pending):
  16 apply (default-branch resolver as a script `skills/execute/scripts/default-branch.sh`; one
  "base branch" definition in execute § 4; `--self-test-base` moves into `tests/merge-wave-base.test.sh`;
  dead empty-base branch; shared `tests/lib/engine.mjs` + `tests/lib/assert.sh`; release-check reuses
  the contract test; parallel shell suites; the stamp sleep; a readable branch-name check; one
  pairs array in merge-wave; the delete guard as a `case`; the recursive reference scan; the
  diagnostic's base), 2 skip (#3 answered by the rollout clone in 2.5.3; #18), #13 simpler form only.
  Touches the enabler's own files (tests/, Makefile, merge-wave.sh, execute § 4) — first in P1 so later
  test tasks build on the shared helpers. Mark the doc consumed and delete it at close.
- p1-1 Templates + references contract (`{{THREAD_LINE}}`/`{{THREAD_PATH}}`, unused `{{PROJECT_SLUG}}`,
  "ADR 0008 §3.7" → execute § 3.7, gather:112 heading, handoff:14 "Chorus ADR 0047") —
  `tests/contracts/{templates,refs}.test.mjs`.
- p1-2 close's handoff-scan snippet extracted by marker + fixtures (LF, CRLF, consumed, legacy, body
  mentions) + the CRLF misclassification fix — `tests/handoff-scan.test.sh`.
- p1-3 Portable day resolution (python3 `zoneinfo`, injectable now, DST 2026-10-04) in task-writer,
  defer points at it — verify `! grep -rn 'date -v' skills`.

**P2 — Continuity core** (after p1-2, p1-3)
- p2-1 Extract `_shared/process-scan.md` + `_shared/handoff-lifecycle.md` (absorbs
  `thread-skill-category-7-shared-fragment`).
- p2-2 One `<home>` resolver for handoff + close; scan finds shared-thread handoffs; "Run from:" line
  (absorbs `thread-close-handoff-scan-shared-threads` + the title-only "which directory" capture).
- p2-3 close repo state: flag an unmerged feature branch; a THREAD.md-in-a-tool-repo commit rule;
  open's lookup covers tool repos; fix open:69 vs ADR 0011 (absorbs `thread-close-feature-branch-awareness`).
- p2-4 Peer-session guard before deleting a consumed handoff (`thread-close-peer-session-guard`).
- p2-5 Lean-summary rule (`thread-skill-lean-summary-rule`, low).

**P3 — Routing and docs coherence**
- p3-1 Orient on native children: one launch model, double-dispatch guard (`orient-guard-double-dispatch`),
  **ADR 0023 supersedes 0010**, cmux lines out of README + execution-fit (not CONTEXT.md).
- p3-2 execution-fit remote + scriptPath blockers (`thread-skill-execution-fit-remote-and-scriptpath`).
- p3-3 Grill-fit check in orient/handoff prompt composition (`thread-orient-handoff-grill-fit-check`).
- p3-4 split drops its inline task schema (split:106-128) → points at `add-task.md`.
- p3-5 Windows setup docs (`patch-thread-skill-windows-setup-docs`).

**P4 — Behaviour evals**
- p4-1 `evals/` scaffold (`claude plugin eval init --bare`), `make evals` (never in `make test`),
  `tests/contracts/evals-structure.test.mjs` (case/prompt + ≥1 grader, runs ≤ 3, no Write/Edit grants,
  no real vault paths).
- p4-2 Routing cases, continuity verbs incl. near-misses (next/orient, stash/defer, handoff/close).
- p4-3 Routing cases, rollout verbs (split/gather, schedule/execute, status/repair).
- p4-4 Dry lifecycle cases for close and handoff.
- p4-5 Trim the five >700-char descriptions, make 700 a hard contract — a **declared gated input**
  (ADR 0008) waiting on the recorded eval baseline.
- Scored eval runs are session-lane (nested `claude`, quota, nondeterminism), run by the lead.

Serialising files (≈5 waves): close/SKILL.md p1-2→p2-1→p2-3 · handoff-lifecycle.md p2-1→p2-2→p2-4 ·
handoff/SKILL.md p1-1→p2-2→p3-3→p4-5 · execution-fit.md p1-1→p3-1→p3-2 · task-writer.md p1-3→p2-5 ·
orient/SKILL.md p3-1→p3-3→p4-5.

**Held for protocol 4** (misfits at the gate): repo-shape-defects (Defect 2 only — Defect 1 fixed in
2.5.2), package-init file-set blindness (maybe already covered by the redesign), capped-green-run-
records-nothing, tier-capped-unread-by-status-and-repair (redesign has most of it), plan-blocked-
feedback-append-once, the Ralph-loop ladder, opus-label + opus-top-tier-default (+ADR),
subagent-model-effort-nomination, **plan-loop-fails-open-on-zero-rounds** (safety — recommend gating the
protocol 4 release on it), execute-feel-decision-gates, quota-refusal-preflight, ceremony-writeback-
guard, close-parent-phase, the Stop hook's per-turn 5MB read, execute's token diet,
simplify-round-on-tier-ceiling, and the new
`thread-skill-read-only-agents-read-a-mutable-checkout` (read-only agents plan against a stale checkout).

**Session-lane misfits** (stay loose): the two context-level handoff-tripwire captures (merge them;
the hook lives in `~/repos/workspaces`); defer-as-project-next-step (design); Codex adapters + parity
checker (other repos); THREAD.md compaction (after protocol 4); `thread-rollout-v4-native-acceptance`
and the 8 agent-reader pilot notes (thread 1's — do not touch). Close as stale:
`wave-skill-live-bed-v13-features`. `thread-skill-handoff-widens-to-a-chorus-session` is half done
(handoff part in `5f4e666`; the `/thread:schedule` card remains — Chorus p12's).

## Decision pending for Lachy — the stale project-scope 2.3.4 install

`installed_plugins.json` still carries `thread@thread` 2.3.4 at **project scope, projectPath
`/Users/lachlants`**. Not uninstalled: that "project" is `~`, whose project settings file is
`~/.claude/settings.json` — and every profile's `settings.json` (animately, fauxmuse, lachlants) is a
symlink to that same file, so `claude plugin uninstall thread@thread --scope project` from `~` could
remove `thread@thread` from `enabledPlugins` for every profile. Options: (a) leave it and never launch
thread sessions from `~` (recorded as a known quirk); (b) remove only that record from
`~/.claude/plugins/installed_plugins.json` by hand, after a backup, leaving settings untouched;
(c) run the uninstall, then re-check and re-enable `thread@thread` in `~/.claude/settings.json`.

## Cautions

- In-flight protocol 3 rollouts (audio-intake, giflab, narcissus-avp): their running leads keep the
  2.5.1 cache path; resumes must re-pass original args (no `defaultBranch` added mid-run).
  audio-intake keeps a hand-made `origin/main` copy on a `master` repo — new launches there should now
  pass `defaultBranch: master` instead.
- For thread 1 (protocol 4): the redesign's protocol 3 path still hardcodes `origin/main`; port
  `defaultBranch` (not `baseBranch`); `tests/run.sh` picks up the redesign's `*.test.mjs`/`*.test.sh`
  unchanged; the pilot requirement notes never close by design; the zero-rounds fail-open bug.
