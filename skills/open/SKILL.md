---
name: open
description: 'Open, resume, or start durable thread state. Use to load a THREAD.md (project threads at ~/Projects/<Area>/<Project>/THREAD.md, shared threads at ~/repos/workspaces/_shared/threads/<slug>.md), to list active threads, or to PICK UP a stashed/deferred thread capture from an Obsidian task — "/thread:open [[<task>]]" reads the task, primes from its resume prompt, and marks the capture done; "/thread:open docs/handoffs/<doc>" does the same for a handoff doc and marks it consumed. Triggers on "open/load/resume the <slug> thread", "pick up [[task]]", "resume this task", "/thread:open", or when a conversation develops thread shape and no thread exists yet.'
---

# /thread:open — open or resume durable thread state

A **thread** is a long-running unit of work that spans conversations. Three kinds, same shape:

- **Project thread** — `~/Projects/<Area>/<Project>/THREAD.md`. Bounded to a project under `~/Projects/`.
- **Shared thread** — `~/repos/workspaces/_shared/threads/<slug>.md`. Cross-workspace or meta-work.
- **Repo thread** — a `THREAD.md` at a tool repo's toplevel under `~/repos` that § Repo-thread lookup lists. Its **effective slug** is its front-matter `slug:`, else its directory's name (`~/repos/tools/maquette/THREAD.md`, which has no front matter, is `maquette`).

Wherever a skill reads a THREAD.md's `slug:` (handoff's `thread:` field and capture match, close's handoff scan), a repo thread supplies its effective slug. One without front matter never gains any (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state).

Canonical template: `~/.agents/skills/thread/THREAD-template.md`. Index of shared threads: `~/repos/workspaces/_shared/threads/INDEX.md`.

Sibling routes for *leaving* a thread: `thread:next` (undecided), `thread:stash` / `thread:defer` (set down), `thread:handoff` (fork), `thread:close` (finish).

## Modes

### `/thread:open` (no args) — suggest or list

If the current conversation has thread shape (8+ substantive turns, decisions deferred to a future session, artefacts produced) and there is no active thread — propose creating one. Suggest a kebab-slug derived from the conversation's main topic.

Otherwise, fall through to `list`.

### `/thread:open list`

1. Read `~/repos/workspaces/_shared/threads/INDEX.md` — these are the shared threads.
2. Find recent project threads: `find ~/Projects -name THREAD.md -mtime -90 -not -path '*/_archive/*' 2>/dev/null` — sort by mtime descending.
3. Find repo threads: run § Repo-thread lookup with `slug=` empty — it prints every repo thread. Sort them by mtime descending.
4. Present grouped:

```
## Shared threads
- <slug> · <state> · <last-touched> — <one-line scope>

## Project threads (recent)
- <area>/<project> · <state> · <last-touched> — <one-line scope>

## Repo threads
- <label> · <slug> · <state> · <last-touched> — <one-line scope>
```

State comes from each file's frontmatter `state:` field. Skip threads with `state: done` unless asked.

A repo-thread row's `<label>` is its path relative to `~/repos`, as in § Repo-thread lookup; `<slug>` its effective slug, and `<last-touched>` the file's mtime, `date -r <file> +%F`. Any field the file does not carry shows `—`. A thread with a missing `state:` is listed and treated as not done; only an explicit `state: done` is skipped unless asked. A THREAD.md with no front matter at all reads `- tools/maquette/THREAD.md · maquette · — · <mtime> — —`.

### `/thread:open <slug>` — load or create

1. Look for an existing thread: run § Repo-thread lookup with `slug=<slug>`. It searches `_shared/threads/<slug>.md`, then `~/Projects`, then repo threads, and stops at the first tier with a match; close's rung 2 uses this same order. One path → that file. Several → the CWD repo's has already won inside the repo tier; otherwise list labels and paths and ask. A hit comes before any creation rule, so `/thread:open maquette` opens the repo thread `~/repos/tools/maquette/THREAD.md`.
2. If found → read the file, present a 4–6 line briefing (scope, state, where-we-are headline, top open question), and continue the conversation with that context loaded. If its Resume instructions point at a handoff doc (`Read <home>/docs/handoffs/<doc> first`), read that too, apply the `Run from:` check below (the handoff-doc pickup's step 2), and, when it is pending, **mark it consumed** — set `status: consumed` in its front matter, no commit — exactly as the handoff-doc pickup below does (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Pickup), then apply `handoff-lifecycle.md` § Thread state's pickup row; the thread is live again and `thread:close` will delete the doc. If the file is gone (its consumer's close deleted it and the pointer was never rewritten), say so in one line and brief from THREAD.md alone — `git log --all -- '<path>'` recovers the text if it matters.
3. If not found → confirm with the user, ask for the scope (one line), then create the file from the canonical template with frontmatter populated. New shared threads also get appended to `INDEX.md`.

### `/thread:open [[<task>]]` — pick up a stashed/deferred capture

The pickup half of the stash/defer loop (see `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md`). Accepts a wiki-link, a slug, or a path under `~/repos/obsidian/Work/Tasks/`.

1. Read the task file. Prime from its `## Notes` summary and `## Resume prompt` — treat the prompt's context/read-first/next-move as the working brief.
2. Read the linked `THREAD.md` if the task has one; brief from both, and apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's pickup row to it (a `parked` or `paused` thread goes `active`).
3. **Complete the capture**: set `status: done`, add `completed: <today>` in the task file. The capture's job ended the moment this thread went live — if the work gets set down again later, a fresh capture is written (dedup finds no open task).
4. Confirm in one line: `Picked up [[<slug>]] — capture closed. Next move: <from the prompt>.` Then get on with the work.

### `/thread:open <path-to-handoff-doc>` — pick up a handed-off thread

The pickup half of the handoff loop (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md`). Accepts a path under a `docs/handoffs/` directory.

1. Read the doc. Prime from its § What remains, § Decisions settled and § Gotchas; its § Paste-ready prompt is the working brief.
2. **Check `Run from:`.** Read the doc's ``**Run from:** `<abs dir>` `` line and compare it with `pwd -P`. If they differ, say so in one line — `Run from: <dir>, but this session launched in <pwd>; close, stash and defer resolve their homes from the launch directory` — and continue. Never block; a doc without the line (written before it existed) is checked for nothing.
3. Read the linked `THREAD.md` if the doc's `thread:` names one; brief from both, and — for a pending doc — apply `handoff-lifecycle.md` § Thread state's pickup row to it.
4. **Consume it**: set `status: consumed` in the doc's front matter, in place, with no commit. Deletion is the consuming session's close (`handoff-lifecycle.md` § Close-out); a legacy doc is briefed from but left untouched (`handoff-lifecycle.md` § States).
5. Confirm in one line: `Picked up <doc> — marked consumed. Next move: <from the prompt>.` Then get on with the work.

### `/thread:open save` — checkpoint without closing

Runs `thread:close`'s flow as written, mid-session, without ending the thread.

- Thread identification comes first and may ask: close § Identify the active thread's rung-2 question (several matches, none in the CWD's repo) and its rung-4 offer to create a thread both happen before the flow starts.
- Inside the flow every save is autonomous per ADR 0011: the thread update, auto-memory, knowledge and every commit, a repo thread's THREAD.md included (close step 7.1, with `save` in place of `close-out` in its commit message). Step 6's vault-task menu is the only question.
- `state:` stays unchanged (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's close row).
- In place of close's banner the last line is `Thread saved — session continues.`

## Repo-thread lookup

The one implementation of thread lookup by slug, and of the repo-thread list. Set the input on a line of its own before the snippet (`slug=<slug>`, or `slug=` for the list); the snippet only defaults it. It prints one physical absolute path per line, writes nothing to stderr and exits 0, printing nothing when there is no hit. Plain `find`, no globs, no arrays, every expansion quoted, so it runs the same under bash and zsh.

```bash
# thread:repo-thread-lookup (extracted and run by tests/repo-threads.test.sh)
: "${slug:=}"
nl='
'
fms() { awk '{ sub(/\r$/, "") } NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^slug:/{sub(/^slug:[ \t]*/, ""); print; exit}' "$1" | tr -d "\"'\r" | sed 's/[[:space:]]*$//'; }
hits=''
if [ -n "$slug" ] && [ -f "$HOME/repos/workspaces/_shared/threads/$slug.md" ]; then
  hits="$(cd "$HOME/repos/workspaces/_shared/threads" 2>/dev/null && pwd -P)/$slug.md"
fi
if [ -n "$slug" ] && [ -z "$hits" ] && [ -d "$HOME/Projects" ]; then
  p=$(cd "$HOME/Projects" 2>/dev/null && pwd -P)
  hits=$(find "$p" -name THREAD.md 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
    if [ "$(fms "$f")" = "$slug" ]; then printf '%s\n' "$f"; fi
  done)
fi
if [ -z "$hits" ] && [ -d "$HOME/repos" ]; then
  r=$(cd "$HOME/repos" 2>/dev/null && pwd -P)
  hits=$(find "$r" -maxdepth 3 -name THREAD.md -not -path '*/.claude/*' -not -path "$r/obsidian/*" -not -path "$r/workspaces/*" 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
    s=$(fms "$f"); if [ -z "$s" ]; then d=${f%/THREAD.md}; s=${d##*/}; fi
    if [ -z "$slug" ] || [ "$s" = "$slug" ]; then printf '%s\n' "$f"; fi
  done)
  if [ -n "$slug" ] && [ -n "$hits" ] && t=$(git rev-parse --show-toplevel 2>/dev/null); then
    case "$nl$hits$nl" in *"$nl$t/THREAD.md$nl"*) hits="$t/THREAD.md" ;; esac
  fi
fi
if [ -n "$hits" ]; then printf '%s\n' "$hits"; fi
# end thread:repo-thread-lookup
```

- **First hit wins.** With a slug the tiers run in order — `~/repos/workspaces/_shared/threads/<slug>.md`, then every `~/Projects` THREAD.md whose front-matter `slug:` matches, then repo threads — and the first tier with a match is the whole answer. A `_shared` or `~/Projects` thread therefore beats a repo thread with the same slug. With `slug=` empty only repo threads are listed.
- **Repo threads** are the `THREAD.md` files at depth 3 or less under `~/repos`, outside `~/repos/obsidian`, `~/repos/workspaces` and any `.claude` directory. A repo thread's effective slug is its front-matter `slug:` (CR-tolerant, quotes stripped); only when it has no front-matter `slug:` does the directory's name stand in, so a front-matter slug always wins. A `slug:` in the body never counts. A clone whose directory name differs from what Lachy calls it (`overlay-carousel (codex)`) is reached by slug only once its THREAD.md gains `slug:` front matter; add it by hand.
- **The CWD tiebreak.** When several repo threads match the slug and one is at the toplevel of the CWD's git repo, that one alone is printed (the rollout clone's and the original's THREAD.md share a slug). Outside a git repo the tiebreak is skipped silently.
- **Several paths printed** → list them as `<label> — <abs path>` and ask. A repo thread's **label** is its path relative to `~/repos` (`tools/overlay-carousel (codex)/THREAD.md`).
- **Callers.** `list` step 3, `<slug>` step 1, and `${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md` § Identify the active thread (rungs 2 and 3) and its Process step 7.1 all run this snippet.
- **Worktrees are excluded twice.** A `.claude/worktrees/<w>` toplevel sits deeper than depth 3 below `~/repos` for every realistic repo, and `-not -path '*/.claude/*'` drops it independently, so a later change to the depth limit cannot bring worktree copies in. `tests/repo-threads.test.sh` checks each exclusion with a mutation.

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

On a shared thread's creation and on every `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state transition (including one that leaves `state:` unchanged), update `_shared/threads/INDEX.md`:

```markdown
- [<slug>](<slug>.md) — <one-line scope>  · state: <active|paused|parked|done> · last: <YYYY-MM-DD>
```

Group by state in the index — Active, Paused, Parked, Done, in that order; which route moves a line where is `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state. Project and repo threads are NOT indexed in `_shared/threads/INDEX.md` — they're discovered by walking `~/Projects/` and by § Repo-thread lookup.

## Don't

- Don't put project work into a shared thread "because it's easier to find" — locality wins. Project threads live next to the project files.
- Don't create a thread for one-shot work — daily-task-shaped things go to vault tasks, not threads (`thread:stash` / `thread:defer` handle the capture).
- Don't create a thread when an existing one fits — search first.
- Don't skip `thread:close` at the end of a session that touched a thread — the thread is only useful if it stays current.
- Don't leave the capture task open after a pickup — step 3 of pickup is not optional. The same for a handoff doc: an unmarked doc stays pending forever and keeps the next close from proposing that thread's tasks.
