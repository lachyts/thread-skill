---
thread: thread-skill
written: 2026-10-24
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

# Verify and canary structural follow-ups: grill, then build

The vault task [[thread-skill-the-verify-and-canary-structural-follow-ups]] (`~/repos/obsidian/Work/Tasks/thread-skill-the-verify-and-canary-structural-follow-ups.md`) is the brief: six roots in master's Integration verify, RACE re-verify and git-env canary that the completion verifier's review chains kept naming. They were deferred out of that build by Lachy's ruling.

## 1. Done and verified

- **The completion verifier merged as PR #211** (`ebe060c` on master, CI green on macOS and Ubuntu). It carries:
  - ADR 0052, `docs/adr/0052-one-process-owns-a-completion-verify-attempt.md`. Its Consequences section names the canary trip-line workaround this task should replace.
  - `reconcile-rollout.py completion-verify --run`, which runs verify as its child under the attempt's lock, plus `completion_timeout:`.
  - The master false-green fix in `lead-integrate.py verify`.
- The vault task `thread-skill-the-rollout-runs-its-full-suite-at-completion` is done. The old branches and worktrees are deleted.
- The review history is in #211's commits (`docs/reviews/2026-10-24-*.md` were deleted there once consumed; `git log --diff-filter=D -- docs/reviews/` finds them). The rounds that cite each follow-up:
  - Trip memory: chain-1 rounds 2, 3 and 4; chain-2 rounds 1, 2, 3 and 4.
  - Note-writer lock: chain-2 round 4 #13.
  - `run_verify` core: chain-1 round 3 #1.
  - `--detach-at` lock: chain-1 round 3 #3; chain-2 round 3 #7.
  - Strict command reader: chain-1 round 3 #4; chain-2 round 3 #1.
  - `_scalar`: chain-1 round 4 #7.

## 2. What remains

1. **Grill with Lachy** (`/grill-with-docs`) on which items to build and in what order. Recommended order:
   - (1) **The canary trip memory.** A real defect: on an Integration or RACE window, a trip acked mid-run lets the run's rc be acted on. Its fix lets `--run` drop `_git_env_trips`.
   - (2) **One lock for every rollout-note writer.** Also a real defect: the canary's `Note.save()` is a truncating `write_text` under its own lock only, so a concurrent writer can lose a trip line or save a truncated note.
   - (6) **`_scalar`'s comment-only value bug.** Small, and shared by every key.
   - Then (4) the `--detach-at` pid-lock, (5) one strict command reader, and (3) the `run_verify` core, each only if Lachy wants it.
2. Build each chosen item test-first. A fixture should show the old failure on current master before the fix lands.
3. Review with `/fresh-review` at xhigh, and run the ledger with `--baseline` pinned at the build's first commit. Merge on a clean round, or on the Verify list if Lachy rules that again.
4. When done, mark the vault task done with the PR.

## 3. Decisions settled

- ADR 0052's shape stands. The completion verify is merged and is not reopened here.
- SHA-256 repositories stay out of scope: `--detach-at` is 40-hex engine-wide.
- A completion Flake files no task (ADR 0052, which amends ADR 0050).
- The read verb (`completion-verify` without `--run`) must not load `lead-integrate.py`. That module pulls in `verify-slot.py`, which imports fcntl unconditionally, and loading it would break the read verb on the Windows machine. `run_record.py` and `reconcile-rollout.py` guard their fcntl imports.

## 4. Gotchas found the hard way

- **Run `make test` in its own worktree, and lock that worktree.** The daily sweep's reaper deleted a clean detached test tree mid-run: `git worktree add --lock --reason "make test" --detach <path> <sha>`, then `python3 <wt>/skills/execute/scripts/verify-slot.py run --slots 2 -- bash <wt>/tests/run.sh`.
- **Allow up to two hours for `make test`.** A Chorus rollout holds the Mac's verify slots, and the wait for one has run past 15 minutes.
- **Watch the shared tokens in contract tests.** `tests/contracts/execute-queue.test.mjs` slices the heartbeat line at the first `(7)`, so a heartbeat clause must never contain the text `clause (7)`. `HB4` in `tests/contracts/git-env-canary.test.mjs` pins clause (4) byte for byte.
- **Status's script reads are pinned.** `/thread:status` may run only its two named script reads (`tests/contracts/status-repair-queue.test.mjs`, rule `read-only`).
- **After writing a fix, prove the new tests catch it.** Copy the new test file into a detached worktree of the old head and run it: the tests should fail there. One test passed on the old code and turned out to be flaky.
- **Never use a bare `git stash`.** The stash stack is shared across worktrees and sessions.

## 5. Suggested skills

`/grill-with-docs` (an ADR if the canary record changes shape), `superpowers:test-driven-development`, `/fresh-review code xhigh` (with a `simplify` round every third round), and `/thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "Verify and canary structural follow-ups: grill, then build" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-24-verify-canary-structural-follow-ups.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The completion verifier merged as #211 (ADR 0052). Its review chains kept naming six roots in master's verify, RACE and canary paths; Lachy deferred them to the vault task thread-skill-the-verify-and-canary-structural-follow-ups. Two carry real defects: the canary's ack re-baselines an open window, so an Integration or RACE rc after an acked mid-run trip is acted on; and rollout-note writers share no lock beside the canary's truncating write_text.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-the-verify-and-canary-structural-follow-ups.md; docs/adr/0052-one-process-owns-a-completion-verify-attempt.md (Consequences); skills/execute/scripts/git-env-canary.py (cmd_ack, cmd_check)
Suggested skills: /grill-with-docs, superpowers:test-driven-development, /fresh-review, /thread:close
Gates: which of the six items to build, and in what order, returns to Lachy via grill-me — present the doc's recommended order with its evidence, do not build before he rules
Gates: any change to the canary record's shape or check's exit codes (it touches every window kind) returns to Lachy as an ADR decision
Next move: run /grill-with-docs on the follow-up task, starting from the handoff doc's § 2.
```
