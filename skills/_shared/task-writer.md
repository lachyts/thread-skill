# task-writer — the shared capture engine

The single spec for writing the **task floor**: the self-contained Obsidian
task that `thread:stash` and `thread:defer` always produce (and that
`thread:next` produces when dispatching to either). Route skills MUST follow
this spec rather than re-deriving task shape — any change to capture behaviour
lands here, once.

Invariant (ADR 0001): **the task is complete on its own.** A cold session — any
harness — must be able to resume the work from the task file alone.

## 1. Resolve the project

The task is never orphaned and never lands in `_Inbox/`. Resolve `projects:`
in this order:

1. **CWD inside a code repo** → grep `repos:` frontmatter across
   `~/repos/obsidian/Work/Projects/*/*.md` for an entry matching the current
   path (expand `~` to `$HOME` before comparing). Use that project note.
2. **Active THREAD.md** names/implies a project → use it.
3. **Conversation clearly scoped** to a known project → use it.
4. **Still ambiguous** → ask via `AskUserQuestion` (offer the 2–3 most likely
   project notes).
5. **Genuinely project-less** → umbrella: `[[Vault]]` for vault/system work,
   `[[Personal admin]]` for life admin.

Set `projects: ["[[<Project>]]", "[[<Area>]]"]` — project first, area for
roll-up — matching the global task-home convention.

## 2. Dedup — a re-capture is an update, not a new file

Before writing, look for an existing **open** capture for this same thread:

```bash
rg -l '^tags:.*\bthread\b' ~/repos/obsidian/Work/Tasks/ | xargs rg -l '^status: open'
```

then read the hits: an open task whose slug matches, or whose Notes link the same
`THREAD.md`, or whose resume prompt describes the same work. Found → **update
it in place**: refresh the summary + resume prompt, set/move/remove
`scheduled:`, leave `captured:` as the original date. Never write a second
task for the same thread. Re-deferring is a reschedule, not a new capture.

## 3. Resolve the day (`defer` only)

Deterministic rules, `Australia/Melbourne`:

- Bare `defer` → tomorrow: `TZ="Australia/Melbourne" date -v +1d "+%Y-%m-%d"`.
- A named day (`monday`, `fri`, `next tue`) → the **next future** occurrence,
  never today: `defer monday` said on a Monday means +7 days.
- An explicit date (`2026-07-20`, `20 jul`) → that date; refuse past dates.

The confirmation ALWAYS echoes the resolved date (§ 7) so a parse surprise is
visible immediately.

## 4. Task file shape

Path: `~/repos/obsidian/Work/Tasks/<kebab-slug>.md`. Slug: ≤5 words, names the
topic (`narcissus-mirror-shader-fix`, not `continue-working-on-thing`).

```yaml
---
tags: [task, <area>, thread]
status: open
priority: normal
projects: ["[[<Project>]]", "[[<Area>]]"]
scheduled: <YYYY-MM-DD>        # defer only — OMIT the line entirely for stash
captured: <YYYY-MM-DD today>
---
```

- `<area>` tag = lowercase area (animately, art, skate, vault, life…), the
  same denormalisation every task carries.
- `thread` marker tag = this is a thread capture; makes dateless stashes
  queryable (`/weekly`'s Stashed-threads pass depends on it). Documented in
  `_shared/knowledge/obsidian-schema.md`.
- Typed values: dates as `YYYY-MM-DD`, wiki-links quoted.

## 5. Body — everything lives inside

```markdown
## Notes

<1–3 lines: where the work is right now, and why it was set down.>

**Thread:** [THREAD.md](<absolute path>) · state: <state>   ← only if one exists
**Set down:** <YYYY-MM-DD> from <workspace/project context>

## Resume prompt

Paste into a fresh agent session:

​```
You're picking up "<title>", set down on <date>.
First: you now own this work — mark the capture done: set `status: done` and
add `completed: <today>` in ~/repos/obsidian/Work/Tasks/<slug>.md.
Context: <2–4 lines of state — what's built, what's decided, what's blocked.>
Read first: <THREAD.md path if one exists; 1–3 key file paths>
Next move: <the single concrete next step>
​```
```

The **first instruction closes the capture** (pickup auto-complete, ADR 0001
consequence). It's inside the prompt so it works even when pasted into a
non-Claude harness. If the work is conversation-gated (needs Lachy's input
before an agent can act), say so explicitly in the Notes line — this is what
keeps `/wave:schedule` from sweeping it into an autonomous rollout.

## 6. THREAD.md — optional upgrade, never manufactured

- Thread already exists → update it (state, session log line
  `- YYYY-MM-DD: set down via thread:<route> → [[<task-slug>]]`), link it from
  the task.
- No thread + work is **thread-worthy** (8+ substantive turns, deferred
  decisions, artefacts) → create one from the canonical template
  `~/.agents/skills/thread/THREAD-template.md` (project-side
  `~/Projects/<Area>/<Project>/THREAD.md`, or `_shared/threads/<slug>.md`),
  then link it.
- No thread + one-off work → **don't create one.** The task carries everything.

## 7. Confirm

One compact confirmation, always echoing the concrete outcome:

- defer: `→ [[<slug>]] scheduled **Mon 20 Jul** — surfaces on that day's page. <Project>.`
- stash: `→ [[<slug>]] stashed (no date) — resurfaces in /weekly's Stashed threads. <Project>.`

Render the task link clickable (`obsidian://open?...` per the global link
rules). Then it is safe to end the session — say so.
