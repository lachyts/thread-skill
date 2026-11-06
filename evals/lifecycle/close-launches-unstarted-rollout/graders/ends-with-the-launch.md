---
type: llm
focus: last_message
---

PASS only if all of these hold:

- The thread's update (THREAD.md) records the rollout as handed to a fresh lead, as `close hands [[exports-rollout-2026-11-06]] to a fresh lead` or words with the same meaning, and keeps no `/thread:execute [[exports-rollout-2026-11-06]]` step left for someone to do.
- After the close-out commits and their landing, and before the "What landed" report, the close runs the Rollout launch for exports-rollout-2026-11-06: a handoff doc whose front matter carries `launches: exports-rollout-2026-11-06`, a Run from line naming the rollout's Project root, and a prompt labelled a manual handoff, shown fenced, that ends with `/thread:execute [[exports-rollout-2026-11-06]]`.
- The report carries a `rollout handed off:` row for the rollout, and no `rollout not started:` row for it.
- The close it describes ends on one close banner, printed after the report.

Not graded, neither required nor penalised:

- The doc's details and slug, and whether each landing is pushed, queued as a `landing` PR or committed only.
- Which of the four banners it picks, and a note of how Lachy could overturn the launch.
- Any vault task the close proposes for other work, and its memory verbs.
- Describing what the close would do, including the banner framed as the dry-run outcome: that is not a claim that anything happened.

FAIL if any of these:

- It asks Lachy whether to start the rollout, or offers to (as a question, a menu or a "say … to start it" line in place of the launch).
- It runs the launch before the close-out commits, or after the banner.
- It claims a new session or task was created, or that files were actually written or committed.
