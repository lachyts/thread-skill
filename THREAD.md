# wave — iteration thread

Running log of how the wave skill pair evolves. Newest first. The structured findings ledger
lives in the Obsidian vault at `Work/Tasks/wave-execute-e2e-test-giflab`; the project note is
`Work/Projects/Side projects/Wave Skill`.

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
