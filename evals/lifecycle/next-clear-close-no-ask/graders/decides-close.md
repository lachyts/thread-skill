---
type: llm
focus: last_message
---

PASS only if all of these hold:

- It decides the move itself and says so in about one line: close, with a short reason (the work is merged and nothing is mid-flight).
- It goes on to describe the close it would run (the session logged into the thread's THREAD.md, which stays active, and the close-out commit), without first waiting for Lachy to pick a move.

Not graded, neither required nor penalised:

- Whether the close-out is pushed, queued as a `landing` PR or committed only.
- A closing line framed as the dry-run outcome, or a note of how Lachy could overturn the decision.
- Any vault task proposal close itself would make.

FAIL if any of these:

- It asks Lachy which move to take, or lists the moves (keep going, defer, stash, handoff, close) as a menu for him to pick from.
- It recommends close but stops to wait for his confirmation before describing the close.
- It recommends more than one move.
- It states that files were actually written or committed.
