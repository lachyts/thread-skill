# 0040 — A rollout is parallel or serial

Date: 2026-10-19
Status: proposed. Grilled with Lachy on 2026-10-19 (`/grill-with-docs`, in the "Obsidian rollout audit" session), and to be built as P24.

## Context

Until now, the rollout lane ran only work that converges on one repo, lands as a PR per task and verifies inside the run. Everything else went to the session lane: `defer`, a hands-on pickup, or orient's child-agent batches. The 2026-10-18 vault audit found that most open work outside code repos had no unattended runner. Batches inherit only the lead session's tools, so work that needs another launch profile was marked blocked. Batches also handle badly any tasks that share notes or build on each other.

## Decision

**"Rollout" covers two shapes.** A rollout note carries `shape: parallel | serial`, and every rollout verb (schedule, execute, status, repair, reflect) takes either shape.

- **A parallel rollout** is today's engine, unchanged: a Queue of worktree-isolated tasks, a PR each, Integration, auto-merge. Every earlier rollout is one.
- **A serial rollout** runs as a chain of **Legs**. Each Leg is one visible, interactive session, with no worktrees and no subagents except each task's clean-room review (§ Build-grill rulings). It:
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
- The three questions left for the P24 build grill were ruled in the same day's `/thread:orient Thread Skill` reshuffle (below).

## Build-grill rulings

Ruled with Lachy on 2026-10-19 in the `/thread:orient Thread Skill` reshuffle grill. Two clean-room review rounds followed. The second stopped on its own regressions, so these rulings stay at the level of decisions, and the mechanics are P24's to settle against code. The open review questions are on `thread-skill-p24-3-execute-runs-legs` and `thread-skill-p24-2-schedule-writes-serial-rollouts`.

- **A Leg's startup smoke test** runs the preflight (the rollout's required tools and accounts answer), then the Verify line of every task its predecessor Leg finished. Leg 1 runs the preflight alone. A failing Verify never reopens a finished task: the Leg files a fix task (`fixes:` that task) and works it before it claims new work.
- **Each code-writing task gets a clean-room review before it is done.** The review is `/fresh-review` at xhigh over that task's change, and it is the only subagent a Leg spawns.
- **Serial rollouts are limited by surfaces, not by repo.** Serial chains, whether in one rollout or several, may run side by side when their surfaces are disjoint. A chain that writes a repo checkout owns that checkout, so no second chain writes there. A repo still holds at most one unfinished parallel rollout, which runs from its rollout clone (ADR 0042).
- **There are no serial self-rollouts.** The plugin's own checkout never moves under a running rollout (ADR 0031), and its clone belongs to the parallel self-rollout. Thread-skill's own work lands as a PR per task, so it is parallel-shaped, and anything serial-shaped for this repo goes to the session lane.
