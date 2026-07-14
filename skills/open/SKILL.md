---
name: open
description: Open, resume, or start durable thread state. Use to load a THREAD.md (project threads at ~/Projects/<Area>/<Project>/THREAD.md, shared threads at ~/repos/workspaces/_shared/threads/<slug>.md), to list active threads, or to PICK UP a stashed/deferred thread capture from an Obsidian task — "/thread:open [[<task>]]" reads the task, primes from its resume prompt, and marks the capture done. Triggers on "open/load/resume the <slug> thread", "pick up [[task]]", "resume this task", "/thread:open", or when a conversation develops thread shape and no thread exists yet.
---

# /thread:open — open or resume durable thread state

A **thread** is a long-running unit of work that spans conversations. Two kinds, same shape:

- **Project thread** — `~/Projects/<Area>/<Project>/THREAD.md`. Bounded to a project under `~/Projects/`.
- **Shared thread** — `~/repos/workspaces/_shared/threads/<slug>.md`. Cross-workspace or meta-work.

Canonical template: `~/.agents/skills/thread/THREAD-template.md`. Index of shared threads: `~/repos/workspaces/_shared/threads/INDEX.md`.

Sibling routes for *leaving* a thread: `thread:next` (undecided), `thread:stash` / `thread:defer` (set down), `thread:handoff` (fork), `thread:close` (finish).

## Modes

### `/thread:open` (no args) — suggest or list

If the current conversation has thread shape (8+ substantive turns, decisions deferred to a future session, artefacts produced) and there is no active thread — propose creating one. Suggest a kebab-slug derived from the conversation's main topic.

Otherwise, fall through to `list`.

### `/thread:open list`

1. Read `~/repos/workspaces/_shared/threads/INDEX.md` — these are the shared threads.
2. Find recent project threads: `find ~/Projects -name THREAD.md -mtime -90 -not -path '*/_archive/*' 2>/dev/null` — sort by mtime descending.
3. Present grouped:

```
## Shared threads
- <slug> · <state> · <last-touched> — <one-line scope>

## Project threads (recent)
- <area>/<project> · <state> · <last-touched> — <one-line scope>
```

State comes from each file's frontmatter `state:` field. Skip threads with `state: done` unless asked.

### `/thread:open <slug>` — load or create

1. Look for existing thread:
   - `~/repos/workspaces/_shared/threads/<slug>.md`
   - `find ~/Projects -name THREAD.md` and grep frontmatter `slug: <slug>` matches.
2. If found → read the file, present a 4–6 line briefing (scope, state, where-we-are headline, top open question), and continue the conversation with that context loaded.
3. If not found → confirm with the user, ask for the scope (one line), then create the file from the canonical template with frontmatter populated. New shared threads also get appended to `INDEX.md`.

### `/thread:open [[<task>]]` — pick up a stashed/deferred capture

The pickup half of the stash/defer loop (see `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md`). Accepts a wiki-link, a slug, or a path under `~/repos/obsidian/Work/Tasks/`.

1. Read the task file. Prime from its `## Notes` summary and `## Resume prompt` — treat the prompt's context/read-first/next-move as the working brief.
2. Read the linked `THREAD.md` if the task has one; brief from both.
3. **Complete the capture**: set `status: done`, add `completed: <today>` in the task file. The capture's job ended the moment this thread went live — if the work gets set down again later, a fresh capture is written (dedup finds no open task).
4. Confirm in one line: `Picked up [[<slug>]] — capture closed. Next move: <from the prompt>.` Then get on with the work.

### `/thread:open save` — checkpoint without closing

Alias for `thread:close` when you want to save state mid-session without ending the thread. Same diff-and-confirm flow; doesn't change `state`.

## Creating a new thread

When creating, decide scope first:

| Question | Answer | Location |
|---|---|---|
| Is this work bounded to a single `~/Projects/<Area>/<Project>/`? | Yes | `<that project>/THREAD.md` |
| Does it span workspaces or live outside `~/Projects/`? | Yes | `_shared/threads/<slug>.md` |

Slug rules: kebab-case, ≤4 words, names the *topic* not the verb. `memory-system-redesign` not `redesigning-memory`.

Frontmatter on creation:

```yaml
---
slug: <slug>
created: <YYYY-MM-DD>
last_touched: <YYYY-MM-DD>
state: active
scope: <one-line>
---
```

Body sections from the template; mostly empty placeholders that fill in over time. The first session's `Session log` entry is `- YYYY-MM-DD: thread created — <brief context>`.

## Index updates (shared threads only)

When a shared thread is created or its state changes, update `_shared/threads/INDEX.md`:

```markdown
- [<slug>](<slug>.md) — <one-line scope>  · state: <active|paused|parked|done> · last: <YYYY-MM-DD>
```

Group by state in the index — Active first, then Paused, then Done at the bottom. Project threads are NOT indexed in `_shared/threads/INDEX.md` — they're discovered by walking `~/Projects/`.

## Don't

- Don't put project work into a shared thread "because it's easier to find" — locality wins. Project threads live next to the project files.
- Don't create a thread for one-shot work — daily-task-shaped things go to vault tasks, not threads (`thread:stash` / `thread:defer` handle the capture).
- Don't create a thread when an existing one fits — search first.
- Don't skip `thread:close` at the end of a session that touched a thread — the thread is only useful if it stays current.
- Don't leave the capture task open after a pickup — step 3 of pickup is not optional.
