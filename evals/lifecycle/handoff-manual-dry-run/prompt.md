---
description: Handoff plans a dated pending doc in the repo and labels itself a manual handoff
tags: [lifecycle]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

We're partway through the exports migration in the repo at the current directory (a git repo on master; you can't run git or write files in this session). Done so far: waves 1 and 2 merged (PRs #41 and #42) and `make test` is green. Decided: keep the v1 CSV schema and add no new dependencies. Gotcha: the fixture generator needs TZ=UTC or the timestamps drift. Next is wave 3, the JSON writer.

Hand this off to a fresh agent so it can carry on with wave 3 straight away. Dry run: you have no write or shell tools here, so don't attempt any. Show me exactly what the handoff would write and commit, including the full handoff doc and the paste-ready prompt.
