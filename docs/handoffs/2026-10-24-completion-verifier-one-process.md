---
thread: thread-skill
written: 2026-10-24
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

# Completion verifier: grill and build the one-process design

The vault task [[thread-skill-the-rollout-runs-its-full-suite-at-completion]] (`~/repos/obsidian/Work/Tasks/thread-skill-the-rollout-runs-its-full-suite-at-completion.md`) is the brief: an optional `completion_verifier:` on v5 rollout notes, run once on merged main at the completion ceremony. It unblocks Chorus p86-5 (Integration verifies on the fast tier). Its `## Progress` section records the night's two attempts.

## 1. Done and verified

- Branch `chorus/build-thread-skill-s-completion-verifier-tonight`, pushed to origin, **no PR, not merged**. Base `0d45df4` (master at the time).
- **`72cee90` is the root to build from.** It is the redesign Lachy picked after the first review STOP, and `make test` is ALL PASS on it (run in a clean worktree). Its shape:
  - `lead-integrate.py verify --outcome` (opt-in, the completion verify's alone) writes `<out>.outcome.json` (`{v, id, sha, ended: running|done|deadline|bootstrap|signal|noslot, rc, step, signal}`), holds `<out>.lock` for its life and pid-locks its `--detach-at` tree. Without the flag, verify is master's byte for byte, so the Integration and RACE verifies never see the lock.
  - `reconcile-rollout.py completion-verify` (read mode, and `--record`) holds the state machine: `run`, `rerun`, `in-flight`, `record`, `green`, `flake`, `red`; one re-run of a red on the same tree (green is a Flake, no task); a final red files `completion-red-<rollout>.md`; no verdict (`noslot`, `unrun`, `stopped`) waits for the next tick, and three in a row halt.
  - A `completion-verify` Run record kind (`run_record.py`), a `completion-verify` git-env canary window kind (`git-env-canary.py`, the rollout's own slug), execute § 4.5 step 5's ceremony bullet, heartbeat clauses (4) and (7), room stop and hard pause, schedule step 2.5 and the template's commented `# completion_verifier:` line, CONTEXT.md's **Completion verifier**, and `skills/execute/tests/reconcile-rollout-completion.test.sh`.
- `cefee97` (the tip) is round 5's fix round: a claim-first `--record` under `<out>.record.lock` that runs the canary `check` itself. It drew round 6's STOP (regressions outnumber originals). `make test` is green on it too, but **do not build on it.**
- Seven fresh-review rounds, every doc under `docs/reviews/2026-10-23-*.md` on the branch. Ledger: chain 1 (rounds 1–4) STOP at round 3; chain 2 (from `72cee90`, `--baseline 72cee90`) STOP at round 6. Round 6's doc, `docs/reviews/2026-10-23-cefee97-63d7a0.md`, is **pending** and is the open findings list.
- Filed: [[thread-skill-a-serial-chain-runs-its-completion-verifier]] (serial chains don't read the key yet).

## 2. What remains

1. **Grill the one-process design with Lachy** (`/grill-with-docs`, writing an ADR as it settles). The proposal: `completion-verify --run` is a single background command that owns one attempt end to end, under one lock. It arms the canary window, runs `lead-integrate.py verify --outcome --detach-at`, checks the window, classifies and records, then exits with one JSON line. The lead launches it and reads its result. A crash leaves only "the lock is free and the attempt has no line", which reads as `unrun`. That removes the cross-entry states that produced rounds 2–6: claims, the record route, who checks the canary, double records, and tainted runs after an ack.
2. Build it from `72cee90` on a fresh branch off current origin/master: cherry-pick or re-apply `d377c6c..72cee90`, then the design. Carry forward the round-5 and round-6 findings that still apply to the new shape (below).
3. `/fresh-review` xhigh, then fix and merge on a clean round. Mark the vault task done with the PR, and delete the old branch once the new PR merges.

**Findings still live** (from `docs/reviews/2026-10-23-cefee97-63d7a0.md`; check each against the new shape):
- `import fcntl` at reconcile-rollout.py's module top breaks every verb on the Windows machine. Guard it (run_record.py does) or keep the lock code in lead-integrate.py.
- A false green: after a green env_bootstrap, `rc = 0` / `ended: done` are set before the verifier runs, so a verifier step that raises leaves done/rc 0. This is pre-existing on master too (the Integration verify pushes on it).
- Two queued `--record` calls on one run record it twice (stale state read before the lock).
- A trip caught by a loop-entry `check-all` and then acked lets the overlapping run be recorded (RACE's rule: an rc after a git-env halt is never acted on).
- `/thread:repair` and `/thread:status` know nothing of the completion verify's halts or `--discard`.

## 3. Decisions settled

- `completion_verifier:` absent: the ceremony is unchanged. A red still completes the rollout and files one fix task. A green re-run of a red is a Flake with **no task** (the brief, overriding ADR 0050's "filed for its repo").
- A deadline in the verifier is red at once (ADR 0050: a timeout names no failing test). A deadline in the env_bootstrap, a failed bootstrap or a dead verify is no verdict.
- `--outcome` is opt-in, so the Integration and RACE verifies stay master's.
- `#13` (SHA-256 repos) is out of scope: `--detach-at` is 40-hex engine-wide.
- Serial chains are a follow-up task, not this build.

## 4. Gotchas found the hard way

- **Never edit the tree while `make test` runs in it**, and never let a reviewer probe in it. Its "no `__pycache__`" and "run wrote nothing into the checkout" checks fail on stray writes. Run the suite in its own worktree: `git worktree add --detach .claude/worktrees/<name> <sha>`, then `verify-slot.py run --slots 2 -- bash tests/run.sh`.
- Under this Mac's load (load average 150–270), `make test` takes over an hour. Give it the 2 h background timeout.
- Execute § 4.5 step 5's bullets are parsed up to the first blank line (`tests/contracts/execute-archive-move.test.mjs`), so a ceremony bullet must hold no blank line.
- `tests/verify-slot.test.sh` V16 forbids `fcntl.LOCK_UN` anywhere: a lock is released by its close.
- The git-env canary's `check` on a closed tombstone trips `record not armed` by design (fail closed), so a window must be checked exactly once.
- `heartbeat clause (4)` is pinned byte for byte in `tests/contracts/git-env-canary.test.mjs` (HB4).

## 5. Suggested skills

`/grill-with-docs` (the design, ADR inline), `/fresh-review code xhigh` (rounds; every third `simplify`), `superpowers:test-driven-development`, `/thread:close` at the end.

## 6. Paste-ready prompt

```
You're continuing "Completion verifier: grill and build the one-process design" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-10-24-completion-verifier-one-process.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The vault task thread-skill-the-rollout-runs-its-full-suite-at-completion (an optional completion_verifier: run once on merged main at the completion ceremony; it unblocks Chorus p86-5) was built on branch chorus/build-thread-skill-s-completion-verifier-tonight and hit the fresh-review STOP rule twice, so it is unmerged. 72cee90 (verify --outcome writes a structured outcome; make test green) is the root to build from; cefee97's claim-first record is not. Lachy chose a fresh session: grill the one-process shape (completion-verify --run owns an attempt end to end under one lock), then build, review and merge on a clean round.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-the-rollout-runs-its-full-suite-at-completion.md; docs/reviews/2026-10-23-cefee97-63d7a0.md on the branch (pending findings); skills/execute/SKILL.md § 4.5 step 5 at 72cee90
Suggested skills: /grill-with-docs, /fresh-review, superpowers:test-driven-development, /thread:close
Gates: the one-process design returns to Lachy via grill-me — present it with the evidence (rounds 2-6's regression sources), let him rule, do not build before he does
Gates: verify_timeout vs a separate completion timeout (raised in rounds 1, 5 and 6; the brief says verify_timeout) returns to Lachy — report the risk for Chorus's 24-40 min full suite, do not resolve it downstream
Gates: the pre-existing false green in master's verify (a verifier step that raises after a green bootstrap records rc 0) — whether this build fixes it or files it returns to Lachy
Next move: run /grill-with-docs on the one-process completion-verify --run design, starting from the handoff doc's § 2.
```
