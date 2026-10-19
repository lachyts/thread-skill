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
- **Serial-shaped:** unattended, but no PR per task, a shared surface, or an external tool or profile the lead lacks. Runs as a serial rollout. The P24 plan review settled how to read this (§ Build-grill rulings): a shared surface counts only alongside another failure, and an external publish is serial-shaped.
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
- **How the fit test reads** (the P24 plan review, 2026-10-19; `skills/_shared/execution-fit.md` is canonical). A shared surface makes work serial-shaped only alongside another failure: no PR per task, no machine check inside the run, an external publish, or a tool or profile the lead lacks. Same-repo tasks that share files or build on each other, and pass every parallel clause, stay parallel-shaped: ADR 0030's queue holds a task back only for its dependencies (`depends-on:`, `blocked-by:`) or a Solo task, never for a shared file, and Integration reconciles a shared file at merge. An external publish (CMS, live site, DNS, config console) is serial-shaped, never parallel-shaped, even in one repo with a PR per task: it is an irreversible or credential gate that sets the task aside for Lachy's sign-off (ADR 0008, ADR 0034).
- **There are no serial self-rollouts.** The plugin's own checkout never moves under a running rollout (ADR 0031), and its clone belongs to the parallel self-rollout. Thread-skill's own work lands as a PR per task, so it is parallel-shaped, and anything serial-shaped for this repo goes to the session lane.
- **How schedule reads shapes** (the p24-2 plan, 2026-10-19). These are mechanics within the rulings above, not a new ruling; `skills/schedule/SKILL.md` § Serial path and CONTEXT.md **Surface** are canonical.
  - *One chain per serial note.* A serial set that splits into surface-disjoint groups gets one note per group, and the chains run side by side. This narrows "in one rollout or several" to several, so a Leg, status and repair each read one queue.
  - *Surfaces are checked at schedule time.* A surface is a token of one of five kinds (`repo:<path>`, `vault:<path>`, `vault`, `ext:<name>`, `any`). A written checkout is claimed at its toplevel, declared or derived: a member's launch folder, the paths its `## Launch` names (a launch command's `--add-dir` and `cd` paths among them, fenced or not) and its first project's `Local:` widen to their checkouts, so every workspace-launched member claims the one workspaces checkout, and its chain refuses another chain, or a parallel rollout, rooted there while it lives. A declaration narrows only a path in no checkout. A member never claims its launch profile's other Working roots (a workspace launcher's `add_dirs`), another project's `Local:` or a project's `repos:`, nor a place it writes but names nowhere; it declares `surfaces:` for those.
  - *The vault is a note space, not a checkout*, for the ownership ruling. Every chain writes its own task notes there, so a whole-vault claim would make every pair of chains overlap, and the side-by-side case could never happen. This reading of "a chain that writes a repo checkout owns that checkout" is an interpretation for Lachy to confirm. A `vault` token still claims the whole vault when a member names it.
  - *A launch per row.* Each row of a serial note records its own launch (alias and folder). A Leg works only rows of the launch it opened in, so a launch change between two rows is a Leg boundary.
  - *A supersede never crosses shapes.* A serial run supersedes nothing yet. A parallel run on a place a live serial chain writes is refused, and so is a serial chain over a live chain's surface or an unfinished parallel rollout's Project root.
  - *A run writes one shape.* A mixed set's parallel run leaves its serial-shaped members unstamped, with a `/thread:schedule --tasks <serial members>` follow-up line.
