---
description: Close deletes a consumed handoff doc and leaves a legacy doc untouched
tags: [lifecycle]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

This is the exports-migration thread, in the repo at the current directory (a git repo on master; you can't run git or write files in this session). Earlier in this session I picked up the handoff doc docs/handoffs/2026-09-20-exports-wave-2.md and marked it consumed, then finished wave 2: the CSV writer merged as PR #42 and `make test` is green. docs/handoffs/ holds exactly two files:

- 2026-09-20-exports-wave-2.md, whose front matter has `thread: exports-migration` and `status: consumed`
- 2026-08-01-exports-notes.md, which has no front matter at all

We're done for today, so close this thread. Dry run: you have no write or shell tools here, so don't attempt any. Instead, list in order exactly what the close would write, commit and delete, and anything it would ask me.
