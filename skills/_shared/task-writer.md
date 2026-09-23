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

- Bare `defer` → tomorrow.
- A named day (`monday`, `fri`, `next tue`) → the **next future** occurrence,
  never today: `defer monday` said on a Monday means +7 days. `next tue`
  means the same as `tue`.
- An explicit date (`2026-07-20`, `20 jul`) → that date; refuse past dates.

Never do this arithmetic in your head: run the resolver, which applies these
rules on the Melbourne calendar date (DST-safe, any OS):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-day.py [<day>]
```

- **Accepted `<day>`** (case-insensitive): absent or `tomorrow`; a weekday
  (`monday`/`mon` … `sunday`/`sun`, optional leading `next`); `YYYY-MM-DD`,
  `D mon` or `mon D` (English month name or 3-letter abbreviation; year = the
  current Melbourne year). Normalise any other phrasing to one of these first.
- **Exit 0** → one stdout line `YYYY-MM-DD Ddd` (e.g. `2026-09-25 Fri`): the
  date is `scheduled:` and the day note's stem (§ 3b); `Ddd` is what § 7 echoes.
- **Exit 2 with stderr starting `resolve-day:`** → the input was refused
  (unparseable, or before today). Apply the rules above: say a past date is
  refused, and a day that can't be resolved is a stash, not a guess.
- **Exit 3, or the resolver can't run at all** (no `python3`, the script
  missing, any other status) → compute the date by hand from these rules and
  state that interpretation explicitly in the § 7 confirmation — never
  silently. Exit 3 means no tz data: `python3 -m pip install tzdata`.

The confirmation ALWAYS echoes the resolved date (§ 7) so a parse surprise is
visible immediately.

## 3b. Make it visible on the day page (`defer` only)

`scheduled:` frontmatter alone is INVISIBLE — the day note's `## To do`
checklist is the surface Lachy actually works from (2026-07-30 feedback: a
deferred task he could not see on the Monday page). After writing the task
file, put a line on the target day's note:

1. **Locate the day note**: glob `~/repos/obsidian/Days/*/*/*/<YYYY-MM-DD> *.md`.
   If missing, create it at
   `Days/<YYYY>/<month-folder>/<YYYY>-W<ww>/<YYYY-MM-DD> <ddd>.md` from
   `_System/Templates/Day.md` — ISO week number; the month folder is the month
   of that ISO week's **Sunday** (so 2026-07-30 Thu lives under
   `2026-08/2026-W31/`).
2. **Append under `## To do`** (create the section above `## Notes` if absent):
   `- [ ] [[<slug>|<Short human title, incl. deadline if one exists>]]`
3. **Dedup**: skip if any line linking `[[<slug>]]` already exists in the note.
   Re-deferring moves the line — add to the new day, remove the unchecked line
   from the old day's note.

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
launch: <cc-* alias>           # qualifying tasks only — OMIT when no alias applies
---
```

- `<area>` tag = lowercase area (animately, art, skate, vault, life…), the
  same denormalisation every task carries.
- `launch:` = the `cc-*` launch-alias literal (e.g. `cc-animately-seo`) when
  the capture **qualifies for launch context** — any concrete signal: the
  project has a repo, the work needs named MCP servers, or live
  branch/worktree state exists (a stash/defer from a repo session almost
  always qualifies). Inherit the project note's `launch:` default as a prior,
  then fit-check it for this task. Omit the field when no alias applies.
  Threshold, fit check, canonical templates:
  `~/repos/workspaces/_shared/knowledge/task-launch-context.md`.
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

## Launch                                                    ← qualifying tasks only

- **Launch:** `<cc-* alias>` (Codex: `<cx-* twin>`)          ← or: `claude` from `~/repos/<path>`
- **Repo:** `~/repos/<path>` — branch `<name>` (WIP)         ← live state / real constraint only
- **MCP:** required `mcp__<ns>__*`, …; optional `mcp__<ns>__*`

## Resume prompt

Paste into a fresh agent session:

​```
You're picking up "<title>", set down on <date>.
Launch: <cc-* alias>   (Codex: <cx-* twin>)                      ← qualifying only
Preflight — before any work: verify each required namespace has   ← qualifying only,
tools loaded (mcp__<ns>__*, …) and make one cheap authenticated      MCP-needing tasks
call per namespace; if any is missing or unauthenticated: STOP
and report exactly which — do not proceed without it.
First: you now own this work — mark the capture done: set `status: done` and
add `completed: <today>` in ~/repos/obsidian/Work/Tasks/<slug>.md.
Context: <2–4 lines of state — what's built, what's decided, what's blocked.>
Read first: <THREAD.md path if one exists; 1–3 key file paths>
Next move: <the single concrete next step>
​```
```

The `## Launch` section and the Launch/Preflight prompt lines appear only when
the capture **qualifies** (any concrete launch signal — see § 4 `launch:`);
non-qualifying captures keep the original shape exactly. Preflight guards two
distinct failures: namespace absent (wrong profile) and
connected-but-unauthenticated (expired OAuth — the silent-degrade case).

The **close-the-capture instruction runs first once preflight passes** (pickup
auto-complete, ADR 0001 consequence) — deliberately *after* preflight, so a
failed pickup never marks the capture done. It's inside the prompt so it works
even when pasted into a non-Claude harness. If the work is conversation-gated (needs Lachy's input
before an agent can act), say so explicitly in the Notes line — this is what
keeps `/thread:schedule` from sweeping it into an autonomous rollout.

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

- defer: `→ [[<slug>]] scheduled **Mon 20 Jul** — on that day page's To do list. <Project>.`
- stash: `→ [[<slug>]] stashed (no date) — resurfaces in /weekly's Stashed threads. <Project>.`

Render the task link clickable (`obsidian://open?...` per the global link
rules). Then it is safe to end the session — say so.
