---
tags:
  - task
  - rollout
status: open
incomplete: true  # every rollout note is born with this; /thread:schedule § Serial path removes it as S6's last write, once every member is stamped. Until then reconcile-rollout.py next refuses the note.
priority: high
work_depth: shallow
projects:
  - "[[{{PROJECT_NAME}}]]"
contexts: []
scheduled: 
due: 
captured: {{DATE}}
# saved as: <slug>-rollout-<YYYY-MM-DD>.md, named as schedule step 6 names every rollout note (one note per chain; a further chain takes the next -N). See schedule SKILL.md § Serial path.
protocol_version: 5
# engine_snapshot: "<path>" and engine_sha: <sha>   # ADR 0043: stamped by `engine-snapshot.py adopt` just below protocol_version:, never by hand
# completion_verifier:   # optional (ADR 0055): the chain checkout's full suite, run once on its HEAD by the last Leg's Complete. Uncommented, quoted, by thread:schedule § Serial path S4/S5 with that checkout's CLAUDE.md `Completion verifier:` command
# env_bootstrap:   # optional, only beside completion_verifier: the detached verify tree's setup. The tree sits outside the checkout, so set up here what the suite finds by walking up from it — thread:schedule § Serial path S4/S5
# completion_timeout:   # optional (ADR 0052): seconds, 1 to 6600, for that run; absent: 3600
shape: serial
surfaces:
{{SURFACES}}
---

## Notes

Serial-rollout plan for one chain of `[[{{PROJECT_NAME}}]]` tasks (ADR 0040): Legs work its rows in order, one task at a time, each Leg in the launch its rows name. The chain owns the surfaces in this note's frontmatter while it is unfinished.

{{THREAD_LINE}}

## How to execute

Legs run this chain (execute's legs.md). Leg 1 opens in row 1's launch (its alias, from its folder) and runs `/thread:execute [[<this note>]]`. Each Leg works only rows of the launch it opened in, so a launch change between two rows is a Leg boundary: it claims up to five tasks, one at a time, closes, and hands the rest to a fresh Leg, whose brief is this note's `## Leg log`. This note takes no execute handoff and no start stamp, and it is never paused: a Leg stops through `leg.py close --outcome stopped`. To give its surfaces back before it runs, stamp it `status: dropped`; its tasks are then free for a later `/thread:schedule`.

## Queue

One row per task, in chain order: its rank, its launch (the alias and the folder its Leg opens in) and the surfaces it claims.

{{CHAIN_TABLE}}

### Why this order

{{QUEUE_RATIONALE}}

## Surfaces

The frontmatter's `surfaces:` is the union of the members' claims below. While this note is unfinished, no other serial chain over any of them is scheduled (while it is stuck, only its unlanded rows' surfaces: ADR 0060), and no parallel rollout rooted on one of them. Each member's claim and where it came from (`declared`: its own `surfaces:`; `derived`: its `## Launch` paths (its launch commands' `--add-dir` and `cd` paths among them), its first project's `Local:` and its launch folder, or a surface added at schedule, where a path that is the vault root gives its first project's place and its own task note instead (the whole vault, with a WARN, when it names no project), and so does naming nothing else when it names a project; `default`: no project and no path, so the whole vault, with a WARN):

{{SURFACE_SOURCES}}

## Post-rollout

When every task is done, the last Leg runs the completion ceremony (the Complete section of execute's `legs.md`). When this note declares `completion_verifier:`, the Leg first runs it once on the chain checkout's HEAD: its summary goes in the Completion log, and a red files one fix task without stopping the ceremony. Then, in this order:

1. Close the phases this chain touched (`touched-phases`, then `reconcile-project.py --kinds phase --apply`), filing a `phase-close-followup-*` task on a failure.
2. File each item below that is live work as a new open follow-on task in `Work/Tasks/`, and rewrite the item as a thin pointer to it; give every other item a disposition. The land-chain follow-on joins them when a chain checkout lands on origin and the chain's `Task:` commits are not on it yet. Never leave live work as checklist prose inside a done note.
3. Score the chain: run `close-score.py --rollout <this note> --close completion`, and keep its one line as the reflection; a failed score never stops the ceremony.
4. Mark this rollout `status: done` and stamp `completed: <YYYY-MM-DD>` in the frontmatter.
5. Append a `## Completion log`: each Leg, the tasks it finished and set aside, the disposition of each item below, and the reflection.
6. Move this note to `Work/Tasks/Archive/Rollouts/`, never overwriting a same-named note there, and commit it by pathspec. Then run `engine-snapshot.py retire` (engine-snapshot.md § Retirement).
7. Run `/thread:close`.

Rollout-specific items go here:

{{POST_ROLLOUT_ITEMS}}
