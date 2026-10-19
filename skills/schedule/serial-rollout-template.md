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
shape: serial
surfaces:
{{SURFACES}}
---

## Notes

Serial-rollout plan for one chain of `[[{{PROJECT_NAME}}]]` tasks (ADR 0040): Legs work its rows in order, one task at a time, each Leg in the launch its rows name. The chain owns the surfaces in this note's frontmatter while it is unfinished.

{{THREAD_LINE}}

## How to execute

Legs run this chain from p24-3: each Leg opens in a row's launch and works only rows of the launch it opened in, so a launch change between two rows is a Leg boundary. Until then `/thread:execute` stops at its § 2 shape line: nothing runs this note, and it takes no execute offer and no start stamp. To give its surfaces back before it runs, stamp it `status: dropped`; its tasks are then free for a later `/thread:schedule`.

## Queue

One row per task, in chain order: its rank, its launch (the alias and the folder its Leg opens in) and the surfaces it claims.

{{CHAIN_TABLE}}

### Why this order

{{QUEUE_RATIONALE}}

## Surfaces

The frontmatter's `surfaces:` is the union of the members' claims below. While this note is unfinished, no other serial chain over any of them is scheduled, and no parallel rollout rooted on one of them. Each member's claim and where it came from (`declared`: its own `surfaces:`; `derived`: its `## Launch` paths and launch folder, or a surface added at schedule; `default`: no source, so the vault only):

{{SURFACE_SOURCES}}

## Post-rollout

When every task is done, run the completion ceremony:

1. Mark this rollout `status: done` and stamp `completed: <YYYY-MM-DD>` in the frontmatter.
2. File any follow-on work as new open tasks in `Work/Tasks/` and rewrite the items below as thin pointers to them. Never leave live work as checklist prose inside a done note.
3. Append a `## Completion log`: each Leg, the tasks it finished, and the disposition of each item below.
4. Move this note to `Work/Tasks/Archive/Rollouts/`, never overwriting a same-named note there.

Rollout-specific items go here:

{{POST_ROLLOUT_ITEMS}}
