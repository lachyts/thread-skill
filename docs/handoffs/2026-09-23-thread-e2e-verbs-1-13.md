---
thread: thread-skill
written: 2026-09-23
status: pending
---

# Handoff — thread E2E baseline, verbs 1–13 (S1, verbs session)

## Done and verified

- **Plugin and cache:**
  - `claude plugin list` shows `thread@thread` 2.5.3 at user scope, next to the stale 2.3.4 project-scope record.
  - `make -C ~/repos/tools/thread-skill release-check` passes.
  - The cached `wave-execute.workflow.js` and `merge-wave.sh` contain `defaultBranch`.
- **Checklist § 0 is done**, except the launch step, which is yours. The record is in `/Users/lachlants/repos/tools/thread-skill/docs/e2e/2026-09-23-baseline.md`, § 0 record.
- **Leak baseline:**
  - STAMP `1790150927` (18:08:47 AEST).
  - Heads: `~/.claude` `eee2821`, `~/repos/workspaces` `5ac0113`, `~/repos/obsidian` `8b8852a`.
  - Porcelain snapshots and the memory-file list are saved in `/Users/lachlants/repos/tools/zz-thread-e2e/.git/e2e-leak/`. They sit inside `.git` so they never show as untracked, and they survive until the § 4 `rm -rf`.
- **Fixture repo** `~/repos/tools/zz-thread-e2e`:
  - Contents: `a.txt` (`alpha`), `b.txt` (`bravo`) and a `Makefile` whose `make test` checks both files exist and contain no `FAIL` line. Positive and negative checks both pass.
  - Git: commit `ba48589`, pushed to private `lachyts/zz-thread-e2e`. `ls-remote` shows `master` only, the GitHub default is `master`, and there is no local `origin/HEAD`, so the resolver has to ask the remote.
  - No `.gitignore`, deliberately: the engine's `.claude/worktrees/` is untracked in the main checkout, as it would be in a real repo.
- **Vault fixture**, not committed; the 11am sweep may commit it:
  - Project note: `~/repos/obsidian/Work/Projects/Tools/ZZ Thread E2E.md` (`repos: [~/repos/tools/zz-thread-e2e]`).
  - Tasks in `Work/Tasks/`, all `status: open` with a verify line:
    - `zz-thread-e2e-t1`: append `t1` to a.txt.
    - `-t2`: append `t2` to b.txt.
    - `-t3`: append `t3` to a.txt, `depends-on: [[zz-thread-e2e-t1]]`.
    - `-cms`: publish a.txt to a CMS page, the misfit.
  - None has `touches:`. That is deliberate, so schedule has to infer the file-sets.

## What remains

You are the S1 verbs session, launched with cwd = `~/repos/tools/zz-thread-e2e`.

1. Confirm where you are and what's loaded:
   - `git rev-parse --show-toplevel` prints the fixture.
   - `claude plugin list` shows `thread@thread` 2.5.3.
   - Tick § 0's "Launch the session" box.
2. Run verbs 1–13 of the checklist in order. Fill each Result cell as you go (`PASS` / `FAIL — …` / `KNOWN — …`), editing the checklist by absolute path.
   - **Verb 2** (`gather --light`) renames t1–t3 to `zz-thread-e2e-p1-M-*`. From then on, use the new slugs.
   - **Verb 5** is the `defaultBranch` proof. Capture the evidence the row names:
     - the resolved `defaultBranch: master` in the launch args;
     - worktree bases (`git -C <wt> merge-base HEAD origin/master`);
     - PR base branches (`gh pr view <n> --json baseRefName`);
     - the merge-wave log line;
     - `git merge-base --is-ancestor <t1 merge> <t3 head>`.
   - **Verb 6:** run `/thread:status` while wave 2 is in flight. The Workflow runs in the background. Snapshot `git -C ~/repos/obsidian status --porcelain` before and after.
   - **Verb 7:** runs after the rollout finishes. Hand-flip t2 back to `in_progress`, then `/thread:repair`. It must resolve t2 from the merged PR with no re-dispatch.
   - **Verb 9:** choose **Hands-on**.
   - **Verb 12:** compute next Friday yourself first (`TZ=Australia/Melbourne`; today is Wed 23 Sep 2026).
3. **Verb 13** (`/thread:handoff`, run from the fixture) writes S2's doc into the fixture's `docs/handoffs/`.
   - S2's prompt must point at the brief `/Users/lachlants/repos/tools/thread-skill/docs/audits/2026-09-23-rollout-brief.md` § S2 and at the checklist.
   - It must also carry the S2 cwd problem (Gotchas, last bullet).
4. Before ending, commit the checklist in thread-skill by pathspec: `git -C ~/repos/tools/thread-skill commit -m "📝 docs(e2e): …" -- docs/e2e/2026-09-23-baseline.md`.
   - Your exit is verb 13's handoff, not a close. This doc and the earlier consumed `2026-09-23-thread-e2e-baseline.md` stay consumed until the next `thread:close` in thread-skill deletes them.

## Decisions settled

- Everything in the brief § Decisions already made stands.
- S1 is split: this setup session ran from thread-skill, and the verbs session runs from the fixture (Lachy's ruling, 2026-09-23).
- The fixture is kept to spec: no `.gitignore`, and no `touches:` on the tasks.
- The leak check diffs against the STAMP snapshots, not against a clean tree. Obsidian already had 71 dirty entries, and the three in-flight rollouts (audio-intake, giflab, narcissus-avp) write to it concurrently.

## Gotchas found the hard way

- **The harness resets a Bash `cd` outside the launch directory** (`Shell cwd was reset to …`). The old handoff's line "a `cd` moves the session's working directory" holds only *inside* it. Use absolute paths and `git -C` for thread-skill, the vault and the workspaces.
- **Skill text loads live from `~/repos/tools/thread-skill`**; the engine loads from the 2.5.3 cache. Edit nothing under `skills/` there during the run, only the checklist.
- **Never launch from `~`**, because of the stale 2.3.4 project-scope install (brief § Decision pending).
- **S2's cwd problem, for verb 13's handoff:**
  - The conflict: S2 must be launched in the fixture, for verbs 14–15 and the close's handoff scan. But § 4 ends with `rm -rf ~/repos/tools/zz-thread-e2e`, which deletes S2's own working directory before gather → schedule → execute.
  - Suggested split: S2 runs verbs 14–15, the leak check and cleanup, all except the final `rm -rf`. It then hands off to an S3 launched in `~/repos/tools/thread-skill`. S3 does the `rm -rf` and the rollout (`repoPath` = the GitHub-origin clone, per the brief).
  - One doc, one consumer.

## Suggested skills

`thread:open` for this doc, then in order: `thread:open` (verb 1), `thread:gather --light`, `thread:split`, `thread:schedule`, `thread:execute`, `thread:status`, `thread:repair`, `thread:next`, `thread:orient`, `thread:stash`, `thread:open [[…]]`, `thread:defer friday`, `thread:handoff`. Use `fresh-review` for any code you write, though none is expected.

## Paste-ready prompt

```
You're continuing "thread E2E baseline — verbs 1–13 (S1)" mid-stream — a live handoff, not a cold pickup.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-23-thread-e2e-verbs-1-13.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: thread 2.5.3 is installed and verified. The setup session finished checklist § 0: private master-only fixture repo lachyts/zz-thread-e2e at ~/repos/tools/zz-thread-e2e, vault fixture project [[ZZ Thread E2E]] with tasks t1/t2/t3/cms, leak baseline in the fixture's .git/e2e-leak/. You are launched in the fixture repo because the harness resets any cd outside the launch dir. Run verbs 1–13 for real, filling the checklist's Result column; verb 5 is the first live proof of the defaultBranch fix. Verb 13's handoff briefs S2.
Also read: /Users/lachlants/repos/tools/thread-skill/docs/e2e/2026-09-23-baseline.md, /Users/lachlants/repos/tools/thread-skill/docs/audits/2026-09-23-rollout-brief.md
Suggested skills: thread:open, then each checklist verb in order; fresh-review for any code written
Next move: confirm `git rev-parse --show-toplevel` is ~/repos/tools/zz-thread-e2e and `claude plugin list` shows thread@thread 2.5.3, tick § 0's launch box, then run verb 1 (/thread:open).
```
