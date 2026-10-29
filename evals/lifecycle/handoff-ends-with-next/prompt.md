---
description: An explicit handoff ends by running next once for this session, with the handed-off work counted as gone
tags: [lifecycle]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

We're partway through the exports migration in the repo at the current directory (a git repo on master; you can't run git or write files in this session). The repo's files aren't present in this sandbox; treat what I describe as what your scan and git would find, with the current directory as the repo's toplevel. Done so far: the CSV writer merged (PRs #41 and #42) and `make test` is green. Decided: keep the v1 CSV schema and add no new dependencies. Gotcha: the fixture generator needs TZ=UTC or the timestamps drift. Next is the JSON writer. Separately, the README's install section still says Python 3.9; I'll fix that myself in this session.

Hand the JSON writer off to a fresh agent so it can carry on straight away. Dry run: you have no write or shell tools here, so don't attempt any. Show me exactly what the handoff would write and commit, including the full handoff doc and the paste-ready prompt.
