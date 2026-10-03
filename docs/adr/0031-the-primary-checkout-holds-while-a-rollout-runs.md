# 0031 — the primary checkout holds while a rollout runs

Date: 2026-10-03
Status: accepted (amends ADR 0030's migration consequence; decided with Lachy in the 2026-10-03
`/thread:orient Thread Skill` reshuffle, after a clean-room review of PR #72)

## Context

With a directory-source install, Claude Code runs the plugin live from its checkout, the **primary
checkout** (`skills/execute/scripts/self-rollout-check.sh`), so every rollout's lead, in any repo, runs
its engine from it. That is why a self-rollout already runs from a separate clone (p12-4). Lachy wanted
two rollouts at once: Chorus's on the engine as it stands, and thread-skill's own P13/P14, whose merges
change that engine. Thread-skill's merges land on `origin`, not in the primary checkout, so the two can
share a machine, but the shared landing route did not respect that: `land.sh` S4 fast-forwards a repo on
its default branch to `origin/<default>` on every close or handoff landing (three times on 2026-10-03
alone), and its unprotected route rebases and moves the branch. Either one, run from the primary
checkout, swaps the engine under a running lead.

## Decision

The primary checkout never moves while a **running rollout** exists: a live rollout note at the current
protocol (`protocol_version: 5`), neither `done` nor `dropped`, and not hard-paused
(`unfinished-rollout.py running`). The condition is "running", not "unfinished": a rollout whose
completion ceremony has not run still has a lead at work, and a protocol-3 note cannot run on this engine
at all. `land.sh` skips the S4 fast-forward of a checkout that is (or contains) a directory-source
marketplace while one runs, and lands a diverged unprotected branch as `not landed` instead of moving it;
a protected landing is unaffected (its PR merges on GitHub). A failed check holds too, since holding only
skips a refresh. pushed-base's reset remedy says to wait.

Moving it mid-run is a deliberate cut-over, never a side effect: hard-pause each running rollout, update
the checkout, reinstate. ADR 0030's migration (a rollout in flight moves to a new engine by `--regenerate`)
is that cut-over, done by hand.

## Considered options

- **Never auto-fast-forward the plugin's checkout.** Rejected: between rollouts the refresh is wanted,
  and a stale primary checkout makes every close-out commit diverge from `origin`.
- **A lock the lead takes.** Rejected for now: a crashed lead leaves it held, and the vault notes are
  already the cursor (ADR 0030), so they are the one signal.
- **Discipline alone** (no close from the primary checkout during a run). Rejected: one slip swaps the
  engine, and `/thread:close` lands by default.

## Consequences

- A long or forgotten never-started note holds the primary checkout; stamping it `paused:` releases it.
- A marketplace install (Windows, a GitHub source) has no primary checkout and is untouched: its engine
  is the version cache, which only a plugin update changes.
- Held close-outs leave the primary checkout's local default branch behind `origin`; once nothing runs,
  pushed-base's `reset --keep origin/<default>` remedy (or the next landing's fast-forward) catches it up.
