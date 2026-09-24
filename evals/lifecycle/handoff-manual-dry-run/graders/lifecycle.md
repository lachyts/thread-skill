---
type: llm
focus: last_message
---

PASS only if all of these hold:

- The doc path is docs/handoffs/<YYYY-MM-DD>-<short-slug>.md under the current directory, shown relative or absolute. The prompt states the current directory is a git repo, so the doc belongs in that repo's own docs/handoffs/. This holds even if the current directory itself lives under a system temp folder, so do not fail a path only because its absolute prefix is a temp folder.
- Its front matter has thread, written and status: pending.
- Its body has, in order, Done and verified, What remains, Decisions settled, Gotchas, Suggested skills and Paste-ready prompt. It carries the PRs (#41 and #42), the v1-schema decision and the TZ=UTC gotcha.
- The doc is committed by pathspec before anything else.
- It says plainly that this is a manual handoff because no native task tool is available, and it launches no substitute such as a subagent or background session.
- The paste-ready prompt names the doc by an absolute path and tells the next session to mark it consumed.

FAIL if any of these:

- It claims a new session or task was created.
- It places the doc anywhere other than the current directory's own docs/handoffs/, for example a workspace directory elsewhere, a standalone temp location such as /tmp/<file>, or the vault.
- It omits status: pending.
- It starts a subagent or background process.
