# 0031 — the primary checkout holds while a rollout runs

Date: 2026-10-03
Status: accepted (amends ADR 0030's migration consequence; decided with Lachy in the 2026-10-03
`/thread:orient Thread Skill` reshuffle, after two clean-room review rounds of PR #72)

## Context

When the plugin runs live from a git checkout (a directory-source install, or `--plugin-dir`), that
checkout, the **primary checkout**, is every rollout lead's engine, in any repo
(`skills/execute/scripts/self-rollout-check.sh`). That is why a self-rollout already runs from a separate
clone (p12-4). Lachy wanted two rollouts at once: Chorus's on the engine as it stands, and thread-skill's
own P13/P14, whose merges change that engine. Those merges land on `origin`, not in the primary checkout,
so the two can share a machine, but the shared landing route did not respect it: `land.sh` S4
fast-forwards a repo on its default branch on every close or handoff landing (three times on 2026-10-03
alone), and S11 rebases and moves an unprotected branch. Either one, run on the primary checkout, swaps
the engine under a running lead.

## Decision

The primary checkout never moves as a side effect while a **running rollout** exists: a live, started
rollout note at the current protocol (`protocol_version: 5`), neither `done` nor `dropped`, not hard-paused
(`unfinished-rollout.py running`). One script decides (`skills/_shared/scripts/primary-hold.sh`), and it
finds the primary checkout by where it runs from: the plugin root that is itself a git toplevel. Running
from the version cache, there is none, and nothing holds.

- `land.sh` S4 skips the fast-forward; S11 pushes its rebased tip (made in a scratch worktree) without
  moving the branch, so the landing still lands. A protected landing is unaffected: its PR merges on
  GitHub. pushed-base's reset remedy says to wait.
- "Running", not "unfinished": a rollout whose completion ceremony has not run still has a lead at work;
  a paused, never-started or incomplete note has none, and a protocol-3 note cannot run on this engine.
  Leaving never-started notes out also keeps a first dispatch's own gates from waiting on themselves.
- A missing vault is no rollout. A check that fails or times out holds: holding only skips moving.

Moving it mid-run is a deliberate cut-over: hard-pause each running rollout, update the checkout,
reinstate. ADR 0030's migration (a rollout in flight moves to a new engine by `--regenerate`) is that
cut-over, done by hand.

## Considered options

- **Never move the plugin's checkout automatically.** Rejected: between rollouts the refresh is wanted.
- **The plugin registry names the checkout** (known_marketplaces.json directory sources). Rejected after
  review: it misses `--plugin-dir` and holds every directory-source plugin repo, not this one.
- **A lock the lead takes.** Rejected for now: a crashed lead leaves it held, and the vault notes are
  already the cursor (ADR 0030), so they are the one signal.
- **Discipline alone** (no close from the primary checkout during a run). Rejected: one slip swaps the
  engine, and `/thread:close` lands by default.

## Consequences

- Only landing is guarded. Checking out another branch in the primary checkout, own-branch work there
  (`land.sh --own-branch` moves that branch), a manual pull or a plugin update are moves too: don't, while
  a rollout runs. Work on the plugin happens in a worktree or the clone.
- While held, the checkout's THREAD.md and handoff docs go stale against `origin`, and a close-out made
  there commits on that stale base (a protected repo's PR may then conflict). During a self-rollout, close
  thread-skill sessions from the clone or a worktree.
- Once nothing runs, `git -C <primary> reset --keep origin/<default>` catches it up: held commits are
  already on `origin` by content (S11 pushed them; a protected PR merged them). Until their PR merges,
  wait, as pushed-base's remedy says.
- A rollout started from another machine's synced vault, or one halted with no ceremony, holds this
  machine's primary checkout too; hard-pausing it, or running its ceremony, releases it.
