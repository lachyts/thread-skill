---
type: llm
focus: last_message
---

PASS only if all of these hold:

- The message closes on this session's own next move from thread:next: exactly one move, decided in about one line (for example "Next move: keep going, because …"), or, only if the pick turns on what only Lachy knows, one menu with exactly one option marked recommended. What that move then does (for keep going, the next step named) may follow it.
- The JSON writer counts as handed off: the move never keeps going on it in this session and never hands it off again.
- The move is about what is left in this session: the README fix.
- When the handoff doc and the paste-ready prompt also appear in this message, the move comes after both. The paste-ready prompt's own `Next move:` line is the fresh session's next step, not this session's move.

Not graded, neither required nor penalised:

- The handoff doc's own content (the handoff-manual-dry-run case grades it).
- Whether the move is keep going, stash or defer on the README fix.
- A note of how Lachy could overturn the decision.

FAIL if any of these:

- It gives no move for this session, or marks more than one option recommended.
- It recommends archiving this session, says this session can be ended or archived, or says another session holds the thread or has started. This is a manual handoff, so no successor was started.
- Outside a menu of moves, thread:next's part of the message (everything after the paste-ready prompt, or the whole message when the handoff came in an earlier one) asks Lachy a question, for example an open question in a summary of where the work is. The handoff doc's and the prompt's own content do not count.
- It recommends or runs close while the README fix is still to do.
- The move comes before the handoff doc and prompt, or between them.
- It claims a new session or task was created.
- It states that files were actually written or committed.
