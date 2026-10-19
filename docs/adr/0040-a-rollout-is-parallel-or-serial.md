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
- The three questions left for the P24 build grill were ruled in the same day's `/thread:orient Thread Skill` reshuffle (below).

## Build-grill rulings

Ruled with Lachy on 2026-10-19, in the `/thread:orient Thread Skill` reshuffle grill.

- **A Leg's startup smoke test** is the preflight (the rollout's required tools and accounts answer) plus the Verify line of the predecessor's last done task. A failing Verify reopens that task as the Leg's first claim, so nothing new starts on a broken base. Re-running every finished task's Verify was rejected: it grows with each Leg and re-touches external surfaces. A per-rollout smoke command was rejected too, because most serial work has no repo verifier to declare.
- **A Leg's code is reviewed at close by `/fresh-review` at xhigh.** It is the one subagent a Leg may spawn, and the clean room offsets lenient self-review. Findings are fixed before the handover. A review-ledger STOP sets the task aside, and the chain goes on. Having the successor Leg review its predecessor's diff was rejected: the last Leg has no successor.
- **The one-per-repo limit follows writes, not shape.** A repo has at most one unfinished rollout that writes its checkout, of either shape. A serial rollout whose tasks only launch from the repo (they write the vault or external tools, never that checkout) may run beside a parallel one. A Leg works in place, so a checkout-writing Leg beside a parallel rollout would move the master that rollout's git-env canary watches. ADR 0042 moves every parallel rollout to its own clone, but the rule stands for a serial rollout's own checkout.
