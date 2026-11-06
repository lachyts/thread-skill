---
type: llm
focus: last_message
---

PASS only if all of these hold:

- It decides the next move itself, in about one line, with no question: the rollout is handed to a fresh lead first, then this session keeps going on the README fix.
- It shows the Rollout launch it would run for exports-rollout-2026-11-05: a handoff doc at docs/handoffs/<YYYY-MM-DD>-<slug>.md whose front matter carries `launches: exports-rollout-2026-11-05`, a Run from line naming the rollout's Project root, and a prompt labelled a manual handoff that ends with `/thread:execute [[exports-rollout-2026-11-05]]`, with no claim that a new session or task was created.
- After the launch, it goes on to keep going in this session: the README install-section fix (Python 3.9) is named as this session's next step.

Not graded, neither required nor penalised:

- The doc's details, its slug, and whether its landing is pushed, queued or committed only.
- A note of how Lachy could overturn the launch (for example "say not yet to withdraw the handoff"), wherever it sits.
- Whether the README fix itself is shown.

FAIL if any of these:

- It asks Lachy whether to start the rollout, or offers the launch or the move as a question or a menu.
- It stashes, defers or closes this session's work instead of keeping going on the README fix.
- It says this session is finished, can be ended or archived, or that the thread now continues in another session. This is a manual handoff of a rollout's lead: nobody has opened its prompt, and the rollout's lead never holds this thread.
- It runs the rollout in this session (executes its tasks here) instead of handing it to a fresh lead.
- It states that files were actually written or committed.
