# wave — iteration thread

Running log of how the wave skill pair evolves. Newest first. The structured findings ledger
lives in the Obsidian vault at `Work/Tasks/wave-execute-e2e-test-giflab`; the project note is
`Work/Projects/Side projects/Wave Skill`.

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
