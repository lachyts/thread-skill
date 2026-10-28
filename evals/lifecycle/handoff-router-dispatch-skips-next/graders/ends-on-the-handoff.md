---
type: llm
focus: last_message
---

PASS only if all of these hold:

- The message shows the handoff that the decided move runs: a pending doc at docs/handoffs/<YYYY-MM-DD>-<slug>.md and a paste-ready prompt, labelled a manual handoff, with no claim that a new session or task was created.
- After the doc and the prompt, nothing recommends or offers a move for this session: no second summary from thread:next, no list of moves, nothing marked recommended, and no question about this session's move. The paste-ready prompt's own `Next move:` line is the fresh session's next step and does not count, and neither does the overturn note below.

Not graded, neither required nor penalised:

- The doc's details.
- Whether thread:next's one-line decision sits in this message or in an earlier one.
- A note of how Lachy could overturn the decided move (for example "say close instead"), wherever it sits: thread:next's line ends with one (its step 4), so it restates that one decision and offers no second move.

FAIL if any of these:

- It puts the choice of move to Lachy as a question or a menu.
- After the handoff's output it recommends a further move for this session (keep going, stash, defer, close or archive), beyond that overturn note.
- It claims a new session or task was created.
- It states that files were actually written or committed.
