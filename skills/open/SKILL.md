---
name: open
description: 'Open, resume, or start durable thread state. Use to load a THREAD.md (project threads at ~/Projects/<Area>/<Project>/THREAD.md, shared threads at ~/repos/workspaces/_shared/threads/<slug>.md), to list active threads, or to PICK UP a stashed/deferred thread capture from an Obsidian task — "/thread:open [[<task>]]" reads the task, primes from its resume prompt, and marks the capture done; "/thread:open docs/handoffs/<doc>" does the same for a handoff doc and marks it consumed. Triggers on "open/load/resume the <slug> thread", "pick up [[task]]", "resume this task", "/thread:open", or when a conversation develops thread shape and no thread exists yet.'
---

# /thread:open — open or resume durable thread state

A **thread** is a long-running unit of work that spans conversations. Three kinds, same shape:

- **Project thread** — `~/Projects/<Area>/<Project>/THREAD.md`, for a project under `~/Projects/` with no code repo.
- **Shared thread** — `~/repos/workspaces/_shared/threads/<slug>.md`. Cross-workspace or meta-work.
- **Repo thread** — a `THREAD.md` at a repo's toplevel under `~/repos` that § Repo-thread lookup lists: a code project's thread lives in its repo (ADR 0039). Its **effective slug** is its front-matter `slug:`, else its directory's name (`~/repos/tools/maquette/THREAD.md`, which has no front matter, is `maquette`).

Wherever a skill reads a THREAD.md's `slug:` (handoff's `thread:` field and capture match, close's handoff scan), a repo thread supplies its effective slug. One without front matter never gains any (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state).

Canonical template: `~/.agents/skills/thread/THREAD-template.md`. Index of shared threads: `~/repos/workspaces/_shared/threads/INDEX.md`.

Sibling routes for *leaving* a thread: `thread:next` (undecided), `thread:stash` / `thread:defer` (set down), `thread:handoff` (fork), `thread:close` (finish).

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Modes

### `/thread:open` (no args) — suggest or list

If the current conversation has thread shape (8+ substantive turns, decisions deferred to a future session, artefacts produced) and there is no active thread — propose creating one. Suggest a kebab-slug derived from the conversation's main topic.

Otherwise, fall through to `list`.

### `/thread:open list`

1. Read `~/repos/workspaces/_shared/threads/INDEX.md` — these are the shared threads.
2. Find recent project threads: `find ~/Projects -maxdepth 5 \( -name _archive -o -name .claude -o -name .git -o -name node_modules \) -prune -o -name THREAD.md -mtime -90 -print 2>/dev/null` — sort by mtime descending. It walks `~/Projects` exactly as § Repo-thread lookup's slug tier does (same prunes, same depth bound), so an archived project or a worktree, `.git` or `node_modules` copy is never listed as a live thread. Then drop each THREAD.md under a `*-rollout/` path component whose directory passes `bash "${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh" --in-place <dir>` (exit 0): a nested rollout clone's copy (ADR 0042), never a thread, as the slug tier skips it.
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
3. If not found → confirm with the user, ask for the scope (one line), then create the file at the location § Creating a new thread gives, from the canonical template with frontmatter populated. New shared threads also get appended to `INDEX.md`.

### `/thread:open [[<task>]]` — pick up a stashed/deferred capture

The pickup half of the stash/defer loop (see `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md`). Accepts a wiki-link, a slug, or a path under `~/repos/obsidian/Work/Tasks/`.

1. Read the task file. Prime from its `## Notes` summary and `## Resume prompt` — treat the prompt's context/read-first/next-move as the working brief.
2. Read the linked `THREAD.md` if the task has one; brief from both, and apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's pickup row to it (a `parked` or `paused` thread goes `active`).
3. **Complete the capture** when the task is a capture, i.e. its `tags:` include `thread` (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4): set `status: done` and set (or replace) `completed: <today>` in the task file, never adding a second `completed:` key. The capture's job ended the moment this thread went live — if the work gets set down again later, a fresh capture is written (dedup finds no open task). Leave the capture's `next_action:` and every project's `next_task:` untouched: a project pointing at the done capture holds a dead link, which every reader treats as blank and nothing rewrites — the next set-down or `/weekly` replaces it (estate ADR 0008 decision 5, amended). Any other task stays at its status: its work is still ahead. `thread:close` marks it done when the work passes its guard and otherwise asks, as a mark-done option (`${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md` § A finished task closes itself).
4. Confirm in one line: `Picked up [[<slug>]] — capture closed. Next move: <from the prompt>.` (for any other task, `Picked up [[<slug>]] — task left open until close. Next move: <from the prompt>.`). Then get on with the work.

### `/thread:open <path-to-handoff-doc>` — pick up a handed-off thread

The pickup half of the handoff loop (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md`). Accepts a path under a `docs/handoffs/` directory.

1. **A doc in a rollout clone reads as its twin's.** When the doc's directory is inside a rollout clone (`bash "${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh" --in-place "$(dirname <doc>)"` exits 0 and prints the twin's directory), and the in-place twin holds the same file, the doc path is that twin's copy: handoff-home.sh rule 0 wrote it there, and the clone's copy only arrived through origin. Steps 2–4 read and mark the twin's copy, never the clone's (ADR 0042: no session commits or leaves a consumed mark in a rollout clone, whose default branch only merge-task moves). A doc the twin does not hold (one homed in a clone before ADR 0042) is read and marked where it is. Then read the doc. Prime from its § What remains, § Decisions settled and § Gotchas; its § Paste-ready prompt is the working brief.
2. **Check `Run from:`.** Read the doc's ``**Run from:** `<abs dir>` `` line and compare it with `pwd -P`. If they differ, say so in one line — `Run from: <dir>, but this session launched in <pwd>; close, stash and defer resolve their homes from the launch directory` — and continue. Never block; a doc without the line (written before it existed) is checked for nothing.
3. Read the linked `THREAD.md` if the doc's `thread:` names one: `thread:` is an effective slug (a repo thread with no front matter goes by its directory's name, so a doc written from maquette carries `thread: maquette`), so run § Repo-thread lookup with `slug=<thread:>` and take its first hit, with the same ask rule as `<slug>` step 1 when several paths print. No hit → brief from the doc alone. Brief from both, and — for a pending doc — apply `handoff-lifecycle.md` § Thread state's pickup row to it.
4. **Consume it**: set `status: consumed` in the doc's front matter, in place, with no commit. Deletion is the consuming session's close (`handoff-lifecycle.md` § Close-out); a legacy doc is briefed from but left untouched (`handoff-lifecycle.md` § States).
5. Confirm in one line: `Picked up <doc> — marked consumed. Next move: <from the prompt>.` Then get on with the work.

### `/thread:open save` — checkpoint without closing

Runs `thread:close`'s flow as written, mid-session, without ending the thread.

- Thread identification comes first and may ask: close § Identify the active thread's rung-2 question (several matches, none in the CWD's repo) and its rung-4 offer to create a thread both happen before the flow starts.
- Inside the flow every save is autonomous per ADR 0011, and the guarded flip of a finished task runs as at close (ADR 0026, `${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md` § A finished task closes itself): the thread update, auto-memory, knowledge and every commit, a repo thread's THREAD.md included (close step 7.1, with `save` in place of `close-out` in its commit message). Step 6's menu, with its new vault tasks and its mark-done options, is the only question.
- Close sub-step 7.6's set-down write does not run: a save sets nothing down, so neither next-action field changes (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4b).
- `state:` stays unchanged, and save never sets `state: done` — the close row it follows (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state) allows `done` when Lachy says the thread is finished, but that is `thread:close`'s to write.
- In place of close's banner the last line is `Thread saved — session continues.`

## Repo-thread lookup

The one implementation of thread lookup by slug, and of the repo-thread list. Set the input on a line of its own before the snippet (`slug=<slug>`, or `slug=` for the list); the snippet only defaults it. It prints one physical absolute path per line, writes nothing to stderr and exits 0, printing nothing when there is no hit. Plain `find`, no globs, no arrays, every expansion quoted, so it runs the same under bash and zsh. It holds no positional parameter (Claude Code substitutes skill arguments into them, so `fms` reads the loop's `f` and parses with `sed`) and no plugin-root path, so it runs the same whether this skill is rendered or read as a file by a caller such as close.

```bash
# thread:repo-thread-lookup (extracted and run by tests/repo-threads.test.sh)
: "${slug:=}"
nl='
'
# fms: the front-matter slug: of the loop's current file f (CR-tolerant, quotes stripped). sed, not awk,
# and no function arguments: a SKILL.md body must hold no positional parameter (Claude Code substitutes them).
fms() { tr -d '\r' < "$f" | sed -n '1{/^---$/!q;d;}; /^---$/q; /^slug:/{s/^slug:[[:space:]]*//;p;q;}' | tr -d "\"'" | sed 's/[[:space:]]*$//'; }
# ghs: the lower-cased GitHub <owner>/<name> of directory g's origin, empty for none (land.sh origin_slug's three forms).
ghs() { git -C "$g" remote get-url origin 2>/dev/null | tr -d '\r' | sed -n -e 's#^https://github\.com/##p' -e 's#^git@github\.com:##p' -e 's#^ssh://git@github\.com/##p' | sed -e 's#/$##' -e 's#\.git$##' | tr '[:upper:]' '[:lower:]' | grep -E '^[a-z0-9][a-z0-9._-]*/[a-z0-9._-]+$'; }
# rc: 0 when directory c (a physical git toplevel) is a rollout clone: named <S>-rollout, its own clone, beside a
# main checkout <S> of the same GitHub repository (self-rollout-check.sh --in-place's rule, ported because this
# snippet holds no plugin-root path; tests/repo-threads.test.sh pins parity). The loops' case patterns open with
# `(`, so bash 3.2 parses them inside $( ).
rc() {
  case "$c" in *-rollout) ;; *) return 1 ;; esac
  if [ ! -d "$c/.git" ] || [ ! -d "${c%-rollout}/.git" ]; then return 1; fi
  g=$c; ga=$(ghs); g=${c%-rollout}; gb=$(ghs)
  [ -n "$ga" ] && [ "$ga" = "$gb" ]
}
hits=''
if [ -n "$slug" ] && [ -f "$HOME/repos/workspaces/_shared/threads/$slug.md" ]; then
  hits="$(cd "$HOME/repos/workspaces/_shared/threads" 2>/dev/null && pwd -P)/$slug.md"
fi
if [ -n "$slug" ] && [ -z "$hits" ] && [ -d "$HOME/Projects" ]; then
  p=$(cd "$HOME/Projects" 2>/dev/null && pwd -P)
  hits=$(find "$p" -maxdepth 5 \( -name _archive -o -name .claude -o -name .git -o -name node_modules \) -prune -o -name THREAD.md -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
    case "$f" in (*-rollout/*) if c=$(git -C "${f%/*}" rev-parse --show-toplevel 2>/dev/null) && rc; then continue; fi ;; esac
    if [ "$(fms)" = "$slug" ]; then printf '%s\n' "$f"; fi
  done)
fi
if [ -z "$hits" ] && [ -d "$HOME/repos" ]; then
  r=$(cd "$HOME/repos" 2>/dev/null && pwd -P)
  hits=$(find "$r" -maxdepth 4 -name THREAD.md -not -path '*/.claude/*' -not -path '*/_archive/*' -not -path "$r/obsidian/*" -not -path "$r/workspaces/*" -not -path "$r/workspaces-rollout/*" 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do
    case "$f" in (*-rollout/*) if c=$(git -C "${f%/*}" rev-parse --show-toplevel 2>/dev/null) && rc; then continue; fi ;; esac
    d=${f%/THREAD.md}; d=${d##*/}
    s=$(fms); if [ -z "$s" ]; then s=$d; fi
    if [ -z "$slug" ] || [ "$s" = "$slug" ] || [ "$d" = "$slug" ]; then printf '%s\n' "$f"; fi
  done)
  if [ -n "$slug" ] && [ -n "$hits" ] && t=$(git rev-parse --show-toplevel 2>/dev/null); then
    c=$t; if rc; then t=${t%-rollout}; fi
    case "$nl$hits$nl" in *"$nl$t/THREAD.md$nl"*) hits="$t/THREAD.md" ;; esac
  fi
fi
if [ -n "$hits" ]; then printf '%s\n' "$hits"; fi
# end thread:repo-thread-lookup
```

- **First hit wins.** With a slug the tiers run in order — `~/repos/workspaces/_shared/threads/<slug>.md`, then every `~/Projects` THREAD.md whose front-matter `slug:` matches (depth 5 or less, never under an `_archive`, `.claude`, `.git` or `node_modules` directory, never a rollout clone's copy), then repo threads matched by effective slug or directory name — and the first tier with a match is the whole answer. A `_shared` or `~/Projects` thread therefore beats a repo thread with the same slug — which is why the `~/Projects` walk prunes: an archived or worktree copy would otherwise hide a live repo thread, and the bounded walk keeps close's rung 2 cheap. With `slug=` empty only repo threads are listed.
- **Repo threads** are the `THREAD.md` files at depth 4 or less under `~/repos`, outside `~/repos/obsidian`, `~/repos/workspaces`, its rollout clone `~/repos/workspaces-rollout`, any `.claude` directory, any `_archive` directory and any rollout clone, so a repo one level deeper (`tools/mcp/<repo>`) is reached. A repo thread is matched by effective slug or directory name (ADR 0039 d4): `slug=` hits a THREAD.md whose effective slug or whose directory's name equals it, so `tools/renamed/THREAD.md` with `slug: other` answers both `slug=other` and `slug=renamed`. Its effective slug is its front-matter `slug:` (CR-tolerant, quotes stripped), else the directory's name, and that is what a handoff doc's `thread:` and close's scan carry. A `slug:` in the body never counts. A clone whose directory name differs from what Lachy calls it (`overlay-carousel (codex)`) is reached by its directory name too, `slug='overlay-carousel (codex)'`, and by its `slug:` once its THREAD.md carries one.
- **The CWD tiebreak.** When several repo threads match the slug and one is at the toplevel of the CWD's git repo (from inside a rollout clone, its in-place twin's), that one alone is printed. Outside a git repo the tiebreak is skipped silently.
- **Rollout clones.** A rollout clone (ADR 0042) is a second full clone of a repository, `<S>-rollout`, beside its in-place checkout `<S>`, that every parallel rollout scheduled after P26 runs from. Its THREAD.md is a copy of the twin's, never a thread: both tiers skip a THREAD.md whose toplevel `rc` names a rollout clone (named `<S>-rollout`, its own `.git` directory, beside a main checkout `<S>` of the same GitHub `<owner>/<name>`: `self-rollout-check.sh --in-place`'s rule, ported because the snippet holds no plugin-root path, with parity pinned by `tests/repo-threads.test.sh`), and the CWD tiebreak reads a clone as its twin, so `slug=<s>` from inside a clone answers with the twin's thread and close commits it there. A `*-rollout` with no GitHub origin, or no same-origin sibling, is no rollout clone and stays listed.
- **Several paths printed** → list them as `<label> — <abs path>` and ask. A repo thread's **label** is its path relative to `~/repos` (`tools/overlay-carousel (codex)/THREAD.md`).
- **Callers.** `list` step 3, `<slug>` step 1, the handoff-doc pickup's step 3 (`slug=<thread:>`), `${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md` § Identify the active thread (rungs 2 and 3) and its Process step 7.1, and `${CLAUDE_PLUGIN_ROOT}/skills/handoff/SKILL.md` **Split launch.** (case 2) all run this snippet; the placement check (`thread-placement.py`) walks the same files.
- **Worktrees are excluded twice.** A `.claude/worktrees/<w>` copy sits deeper than depth 4 below `~/repos` for every realistic repo (`tools/<repo>/.claude/worktrees/<w>/THREAD.md` is depth 6), and `-not -path '*/.claude/*'` drops it independently, so a later change to the depth limit cannot bring worktree copies in. A linked worktree kept outside `.claude` (`animately/optimizer-worktrees/<w>`) is listed: the CWD tiebreak or the several-hits ask settles it, and the placement check reads it as its main checkout (ADR 0039 d5). `tests/repo-threads.test.sh` checks each exclusion with a mutation.

## Creating a new thread

When creating, decide scope first. The first row answered Yes gives the location:

| Question | Answer | Location |
|---|---|---|
| Does the project's note declare a qualifying repo (ADR 0039 d1: a main checkout, ≤3 below `~/repos`, outside obsidian/workspaces/`.claude`/`_archive`)? `python3 "${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/thread-placement.py" home --project "<note>"` prints its first one. From a `~/Projects` folder, `home --dir "$PWD"` answers without naming the note | Yes | `<repo>/THREAD.md` |
| Is this work bounded to a single `~/Projects/<Area>/<Project>/` with no code repo? | Yes | `<that project>/THREAD.md` |
| Does it span workspaces or live outside `~/Projects/`? | Yes | `_shared/threads/<slug>.md` |

**One live thread per project.** A project has one live thread, always named `THREAD.md`. A finished or parked arc moves out of the way: to `docs/threads/<slug>.md` in a repo, or to `_archive/` under `~/Projects`; it never becomes a sibling `THREAD-<name>.md`. The hardcoded name is the contract: the lookup, close's rungs and step 7.1, land.sh and the git-env canary all key on `THREAD.md`, so a named sibling is invisible to every one of them (ADR 0039 d2).

**Workspace subfolders.** A workspace seat's subfolder (`~/repos/workspaces/<seat>/<dir>/`, or its copy in the rollout clone `~/repos/workspaces-rollout/`) is not a thread home: the lookup never reaches it. Seat-hosted work keeps its thread in `_shared/threads/<slug>.md` (ADR 0039 d3).

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

- Don't put project work into a shared thread "because it's easier to find" — locality wins. A code project's thread lives in its repo, any other project's next to its files.
- Don't start a sibling `THREAD-<name>.md` beside a live THREAD.md — move the finished arc out instead (§ Creating a new thread, **One live thread per project.**).
- Don't create a thread for one-shot work — daily-task-shaped things go to vault tasks, not threads (`thread:stash` / `thread:defer` handle the capture).
- Don't create a thread when an existing one fits — search first.
- Don't skip `thread:close` at the end of a session that touched a thread — the thread is only useful if it stays current.
- Don't leave the capture task open after a pickup — step 3 of pickup is not optional. The same for a handoff doc: an unmarked doc stays pending forever and keeps the next close from proposing that thread's tasks.
