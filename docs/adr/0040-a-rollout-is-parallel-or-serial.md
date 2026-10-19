# 0040 — A rollout is parallel or serial

Date: 2026-10-19
Status: proposed. Grilled with Lachy on 2026-10-19 (`/grill-with-docs`, in the "Obsidian rollout audit" session), and to be built as P24.

## Context

Until now, the rollout lane ran only work that converges on one repo, lands as a PR per task and verifies inside the run. Everything else went to the session lane: `defer`, a hands-on pickup, or orient's child-agent batches. The 2026-10-18 vault audit found that most open work outside code repos had no unattended runner. Batches inherit only the lead session's tools, so work that needs another launch profile was marked blocked. Batches also handle badly any tasks that share notes or build on each other.

## Decision

**"Rollout" covers two shapes.** A rollout note carries `shape: parallel | serial`, and every rollout verb (schedule, execute, status, repair, reflect) takes either shape.

- **A parallel rollout** is today's engine, unchanged: a Queue of worktree-isolated tasks, a PR each, Integration, auto-merge. Every earlier rollout is one.
- **A serial rollout** runs as a chain of **Legs**. Each Leg is one visible, interactive session, with no worktrees and no subagents. It:
  1. finishes any task its predecessor left claimed;
  2. claims tasks one at a time from the rollout note (up to five, fewer when its context grows heavy or a task proves large) and works them itself;
  3. runs the close ritual;
  4. hands the rest to a fresh successor through the Stage. Outside Chorus, it prints a paste-ready prompt instead.

**The execution-fit test becomes three-way.**
- **Parallel-shaped:** the old "rollout-shaped" test. Runs as a parallel rollout.
- **Serial-shaped:** unattended, but no PR per task, a shared surface, or an external tool or profile the lead lacks. Runs as a serial rollout.
- **Session lane:** work that needs Lachy present, or waits on a date.

**Orient's child-agent batches retire.** Serial-shaped work always runs as a serial rollout. When its surfaces are disjoint, it runs as several chains side by side.

## Considered options

- **Separate verbs per shape** (a parallel runner and a serial runner, each with its own status and repair): rejected. It doubles the run-side verbs for what is one concept with two shapes.
- **Fan-out / relay nouns:** rejected. Renaming "rollout" would touch every script, ADR and archived note, and "relay" is already Chorus's word for sending a command to a session.
- **Keep batches as a fast path beside serial rollouts:** rejected. Two runners would do the same job, and the three-way test would leave batches with no work.
- **"Shift" or "stint" for the per-session unit:** rejected for **Leg**, which fits the relay image of a baton passed to a fresh runner. Anthropic's harness post (Nov 2025) calls this pattern working in "shifts".

## Consequences

- A Leg resets context at a natural boundary, never mid-task. Anthropic's March 2026 harness post dropped resets because Opus 4.5 no longer needed them for context anxiety. The resets here buy other things: crash checkpoints, the right launch profile, and protection from context rot.
- Left for the P24 build grill:
  - the startup smoke test a Leg runs on the state its predecessor left;
  - how a Leg's work is reviewed, given that self-review runs lenient;
  - whether a serial rollout may share a repo with an unfinished parallel rollout.
