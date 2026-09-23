---
thread: thread-skill
written: 2026-09-23
status: pending
---

# Handoff — thread 2.5.3 live end-to-end baseline (S1)

## Done and verified

- **Audit:** `docs/audits/2026-09-23-thread-audit.md` covers where the plugin is, its inefficiencies, the backlog and its direction.
- **2.5.2** (`f25793a` ✅ harness, `4002185` 🐛 default branch, `b490c4b` ♻️ one-source base, `593849c` 🔖):
  - `make test` / `tests/run.sh` is a single hermetic entrypoint. It includes a real workflow parse; the old `node --check` silently passed a broken engine, and I mutation-checked that the new parse catches one.
  - Contract floor: `tests/contracts/manifest.test.mjs`.
  - `args.defaultBranch` fixes the hardcoded `origin/main`. The resolver asks the remote, and `merge-wave.sh` checks every PR against GitHub's default before the first merge.
- **2.5.3** (`aa7fc57`, `da7dea2`): `execute/SKILL.md` § Worktree lifecycle now names the read-only agents that read `repoPath`.
- **Evidence:**
  - `make test: ALL PASS`: node tests 15/0, prompt-invariants 191/0, reconcile 115/0, stop driver 16/0, default-branch 14/14, merge-wave base, both merge-wave self-tests.
  - `make release-check: 2.5.3 — manifests agree, cache … matches skills/ and hooks/`.
  - The self-test runs green from the cache copy.
  - Pushed: `origin/master` is `ba8066a` or later.
- **Reviews:** three clean-room xhigh rounds and one simplify pass; their docs are in `docs/reviews/`.
  - The round 2 ledger fired STOP, so I reverted to one source for the base rather than patching again.
  - The three consumed docs are deleted at this session's close.
  - The simplify doc `docs/reviews/2026-09-23-c5f7421-399e2e.md` stays **pending**. It is rollout task p1-0.
- **Vault:**
  - Project note [[Thread Skill]] changed from `parked` to `active`.
  - Progress notes added to `thread-plugin-default-branch-fix` (close it after verb 5 passes), `thread-wave-engine-repo-shape-defects` (Defect 1 fixed) and `thread-skill-handoff-widens-to-a-chorus-session` (half done).
  - New held task: `thread-skill-read-only-agents-read-a-mutable-checkout`.

## What remains

**This session (S1)** runs the live end-to-end checklist `/Users/lachlants/repos/tools/thread-skill/docs/e2e/2026-09-23-baseline.md`: § 0 setup, then verbs 1–13.

1. Start fresh on 2.5.3. Check `claude plugin list` and `make -C ~/repos/tools/thread-skill release-check`.
2. Create the fixture repo `~/repos/tools/zz-thread-e2e`, its private GitHub repo (`master` only), and the vault fixture project and tasks.
3. Run verbs 1–13, filling in the Result column as you go.
4. Verb 5 (`/thread:execute`) is the live proof of `defaultBranch` on a `master`-only repo.
5. Verb 13 (`/thread:handoff`, in the fixture repo) writes **S2's** handoff. Its prompt must point S2 at the shared brief `/Users/lachlants/repos/tools/thread-skill/docs/audits/2026-09-23-rollout-brief.md` § S2. After verbs 14–15, cleanup and the leak check, S2 runs `/thread:gather Thread Skill`, then `/thread:schedule`, then `/thread:execute` from a separate rollout clone.

Commit the partly filled checklist in thread-skill before ending S1.

## Decisions settled

All of them are in the brief § Decisions already made. The short version:

- **Three test layers:** contract tests, then evals, then this live baseline.
- **Engine work is held** for protocol 4 (`codex/thread-rollout-redesign`, owned by thread 1).
- **Merging:** the self-rollout uses continuous auto-merge with `make test` as the verifier. It runs from a **GitHub-origin clone under `~/repos`**, never from the live checkout.
- **Test repo:** creating and deleting `lachyts/zz-thread-e2e` is authorised.
- **Naming:** the argument is `defaultBranch`, never `baseBranch`.

## Gotchas found the hard way

- **Working directory:**
  - A `cd` in a Bash call moves the session's working directory, and background reviewers resolve `git diff` against it. Use `git -C` and absolute paths.
  - A clean-room review of an uncommitted tree records `head:` as the old commit. Commit before each review round, or the ledger can't classify the next round's findings.
- **Two loading sources:** skill **text** loads from this working tree, while `${CLAUDE_PLUGIN_ROOT}` (the engine, `merge-wave.sh`, the hook) loads from the version-keyed cache. Changing content requires a version bump and a `claude plugin update`, and only a fresh session loads the new engine.
- **Stale 2.3.4 install:** the 2.3.4 **project-scope** record at `~` is still installed. Its project settings file `~/.claude/settings.json` is the target of every profile's `settings.json` symlink, so a `--scope project` uninstall could disable `thread` everywhere. Don't launch thread sessions from `~`. The pending decision is in the brief § Decision pending.
- **Review rounds:** xhigh reviews of prose return near-cap lists. Stop by the ledger and the named test, not by an empty list.
- **In-flight rollouts:** three protocol 3 rollouts (audio-intake, giflab, narcissus-avp) dispatched waves today. Their running leads keep the 2.5.1 engine, and a resume must re-pass its original args.

## Suggested skills

`thread:open` (to pick this up), then each checklist verb in order: `thread:gather --light`, `thread:split`, `thread:schedule`, `thread:execute`, `thread:status`, `thread:repair`, `thread:next`, `thread:orient`, `thread:stash`, `thread:defer`, `thread:handoff`. Use `fresh-review` for any code you write.

## Paste-ready prompt

```
You're continuing "thread 2.5.3 live end-to-end baseline (S1)" mid-stream — a live handoff, not a cold pickup.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-23-thread-e2e-baseline.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: thread 2.5.3 is shipped (make test, the contract floor, args.defaultBranch for non-main repos) and verified in the plugin cache. This session runs the live end-to-end checklist — § 0 setup (fixture repo ~/repos/tools/zz-thread-e2e with a master-only private GitHub repo, and a vault fixture project), then verbs 1–13 for real — as the baseline and the first live proof of the default-branch fix (verb 5). Verb 13's handoff briefs S2, which cleans up and runs gather → schedule → execute on the plugin itself.
Also read: /Users/lachlants/repos/tools/thread-skill/docs/e2e/2026-09-23-baseline.md, /Users/lachlants/repos/tools/thread-skill/docs/audits/2026-09-23-rollout-brief.md
Suggested skills: thread:open, then the checklist verbs in order; fresh-review for any code written
Next move: confirm `claude plugin list` shows thread@thread 2.5.3 (user scope) and `make -C ~/repos/tools/thread-skill release-check` passes, then run checklist § 0.
```
