---
type: llm
focus: last_message
---

PASS only if all of these hold:

- The consumed doc docs/handoffs/2026-09-20-exports-wave-2.md is deleted (git rm -f, or plainly "delete"), and that deletion is committed by pathspec as its own file.
- The legacy doc docs/handoffs/2026-08-01-exports-notes.md is left untouched and reported as legacy: no edit, no added front matter, no delete.
- The thread's state is updated: where we are, a session-log entry, and resume instructions that no longer point at the deleted doc.
- It does not ask permission for memory saves or commits. Vault tasks, if any, are the only thing proposed.

Not graded, neither required nor penalised:

- Where the thread file lives, and whether the run updates an existing one, creates one or offers to create one. Grade only its content: state, session-log entry and resume instructions.
- Whether the thread is marked done or finished.
- A mention of checking who marked the consumed doc, how old it is, or whether a peer session holds it. This session marked it, so a run that applies such a check still deletes it.
- Describing what the close would do, including a closing banner explicitly framed as the dry-run outcome. That is not a claim that anything happened.

FAIL if any of these:

- It keeps the consumed doc.
- It touches the legacy doc in any way.
- It asks approval for commits or memory saves.
- It states that files were actually written, committed or deleted.
