---
type: llm
focus: last_message
---

PASS only if all of these hold:

- The pending doc docs/handoffs/2026-09-22-exports-wave-3.md is kept, refreshed in place for the finished schema work (the schema moves to done, and what remains and the next move are updated), and committed by pathspec. It is never deleted.
- No vault task is proposed for the JSON writer or the 1.4 release, because that continuation lives in the pending doc.
- The thread's resume instructions point at the pending doc instead of restating its remaining work.
- The README Python-version fix, if raised, is only a proposal awaiting approval.

Not graded, neither required nor penalised:

- Where the thread file lives, and whether the run updates an existing one, creates one or offers to create one. Grade only its content: state, session-log entry and resume instructions.
- Whether the thread is marked done or finished.
- Describing what the close would do, including a closing banner explicitly framed as the dry-run outcome. That is not a claim that anything happened.

FAIL if any of these:

- It deletes the pending doc, or treats it as withdrawn.
- It proposes a vault task for the JSON writer or the release.
- It copies the doc's remaining work into the resume instructions instead of pointing at the doc.
- It states that files were actually written or committed.
