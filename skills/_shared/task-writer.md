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
   `~/repos/obsidian/Work/Projects/**` for an entry matching the current
   path (expand `~` to `$HOME` before comparing). Exactly one match → use
   that project note. **More than one match** (a sibling project sharing the
   repo, or a monorepo with sub-project notes) → fall through to § 1.2–1.4
   among the matches: the one the active THREAD.md names, else the one the
   conversation is scoped to, else `AskUserQuestion` offering those matches.
   No match → § 1.2.
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
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py captures \
  [--slug <slug>] [--thread-file <abs path of the THREAD.md>]
```

It lists the thread captures — open, `thread`-tagged tasks directly under
`Work/Tasks/` (inline or block-list `tags:`) — one
`capture <task> <status> <match,…>` row each, the match adding `slug` or
`thread-file` when the capture is named `<slug>` or names the THREAD.md. A
follow-up or rollout task that merely links the THREAD.md is not a capture
and is never listed. Then read the captures: one whose slug matches, or
whose Notes link the same `THREAD.md`, or whose resume prompt describes the
same work. Found → **update it in place**: refresh the summary + resume prompt, set/move/remove
`scheduled:`, rewrite § 4b's two fields, leave `captured:` as the original date. Never write a second
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
- `next_action:` is not in this template: § 4b's script adds it to every
  stash and defer, quoted safely. Don't hand-write it.

## 4b. Next action — every set-down writes both fields

Estate ADR 0008 (`~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md`,
decisions 4, 5 and 6; vocabulary `~/repos/workspaces/_shared/CONTEXT.md`
§ Next action). A **set-down** — `thread:stash`, `thread:defer`, and
`thread:close` when it has a next task — writes two fields, overwriting
whatever is there: **the most recent set-down wins.** Stash runs this
exactly as defer does; stash is defer without a date, and either way it
names where the project is picked up. `/thread:open save` is not a
set-down and writes neither field.

**The line.** `next_action:` is one line, verb-first, one physical action
("Find the council's phone number"), taken from the resume prompt's
`Next move:` line (§ 5). A `Next move` that strings several steps together
gives its first physical one. A re-capture (§ 2) rewrites it with the new
`Next move`.

**The write — never by hand.** After the task file is written (§§ 4–5):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/next-action.py set-down \
  ~/repos/obsidian/Work/Tasks/<slug>.md --action - <<'EOF'
<the line>
EOF
```

`--action -` takes the line on stdin, so an apostrophe or any other
character needs no escaping; never put the line in shell quotes.

It sets the task's `next_action:`, then, for every link in the task's
`projects:`, sets `next_task: "[[<task-basename>]]"` on that project note:
the one note the link resolves to (as Obsidian resolves it) under
`~/repos/obsidian/Work/Projects/**` (never `Archive/`) whose `tags:` include
`project`. The task file goes first, so the pointer never lands before its
target. It reads frontmatter with PyYAML, changes one line per note, and
re-parses every edit before saving: any change to another key, or YAML
that no longer parses, is refused. It skips (never guesses at) an area
landing note (`tags: [area]`), an archived, ambiguous or noteless link, or
a note it cannot edit safely. Each outcome is one output row
(`project … written`, `skip <link> <reason>`). Exit 2 refuses the whole
write and changes nothing: a dead task (the pointer would be dead), or an
action that is blank or spans lines. Exit 3
means no vault or no PyYAML (`python3 -m pip install pyyaml`). Either way
the capture stands: say `Next action not written: <stderr>` in the
confirmation, and never retry the write by hand.

**Close's form.** `close` writes only when the thread has a concrete next
task, and never invents one. It stands down entirely — neither field — while
a pending handoff doc owns the thread's continuation (ADR 0017). Otherwise
its task is matched **concretely**, first hit wins: (1) this thread's
capture — the one row of `captures --slug <thread slug> --thread-file
<THREAD.md> --for-close`, run in close's step 5, before step 7.6 creates
any task (the flag keeps only a capture named for the thread or naming its
THREAD.md; a capture that merely describes similar work never qualifies);
(2) the one task THREAD.md's Resume instructions name by `[[link]]` as the
next step (a rollout task, say); (3) the one follow-up Lachy approved at
close that carries the thread's next step. A loose end never qualifies.
A task this close marks done
(`close/SKILL.md` § A finished task closes itself) is never the match: the
rule skips it and the next rule is tried.
Its `--action` is the next step this close
writes into THREAD.md's Resume instructions — never an older capture's
`Next move:`, which may be stale. No such task, or more than one with
nothing to choose between them → write neither field and leave every
project slot as it is.

This section is the only overwrite by an agent. Every other writer fills a
blank slot only, with `next-action.py fill` (orient's rule: `orient/SKILL.md`
§ Route, the slot write), and pickup clears neither field (`open/SKILL.md`, the
`[[<task>]]` pickup's step 3). Lachy edits either field any time.

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

**Lean capture.** The task note is a pointer to the work, not a store for it.

- **Scope.** The rule binds every task this spec shapes: stash and defer
  captures, and close's proposed follow-ups.
- **Ceiling.** `## Notes` holds at most **10 non-empty lines**, counting every
  non-empty body line up to the next heading, the `**Thread:**` and
  `**Set down:**` lines included — the same 10-line limit the vault's
  `check-research-landing` guard applies to research-family sections; the
  hook does not police `## Notes`, this spec does.
  - The ceiling counts only the `## Notes` body lines this spec writes
    (capture and § 2 re-capture). Handoff's `Superseded by handoff` Notes
    line is a lifecycle marker on a closed capture, so it is exempt.
  - A re-capture under § 2 rewrites Notes in place and never appends past the
    ceiling.
  - A capture may already carry a `## Findings` or `## Research` section from
    before this rule. A § 2 re-capture leaves any pre-existing
    research-family section untouched — never deleted, moved or condensed,
    since it holds no line this spec writes — and the route's confirmation
    offers to land it, as for an unlanded research pointer below.
- **Resume prompt.** Its `Context:` stays at 2–4 lines.
- **No research on the note.** No research-family section goes on the task
  note: no `## Findings` or `## Research` heading, no tables of results, no
  logs, no transcripts.
- **Research pointer.** Research worth keeping gets at most one pointer line:
  an already-landed digest under `Library/Research/Digests/`, a THREAD.md
  section, or `left in conversation`. Only research not yet landed earns the
  landing offer: a THREAD.md section or `left in conversation` pointer, or a
  pre-existing research-family section left untouched above — never for an
  already-landed digest. The route's own confirmation then offers, in one
  line, to land it per
  `~/repos/workspaces/_shared/knowledge/add-writers/research-landing.md` (its
  Step 0 asks first) — for stash and defer that confirmation is § 7, for
  close it is close's "What landed" report. The offer never blocks the exit:
  stash, defer and close never land research themselves.
- **Other homes.** Long state belongs in THREAD.md, per § 6. A live
  continuation belongs in a handoff doc (`thread:handoff`).

## 6. THREAD.md — optional upgrade, never manufactured

- Thread already exists → update it: set `state:` per
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state
  (stash → `parked`, defer → `paused`) and `last_touched:` to today, move a
  shared thread's INDEX line to that group with `last:` today, and add the
  session log line
  `- YYYY-MM-DD: set down via thread:<route> → [[<task-slug>]]`; link it from
  the task.
- No thread + work is **thread-worthy** (8+ substantive turns, deferred
  decisions, artefacts) → create one from the canonical template
  `~/.agents/skills/thread/THREAD-template.md` (project-side
  `~/Projects/<Area>/<Project>/THREAD.md`, or `_shared/threads/<slug>.md`),
  then link it. A thread created here takes the route's state, not
  `active` — the creation row and then the route's row of
  `handoff-lifecycle.md` § Thread state, in this one step.
- No thread + one-off work → **don't create one.** The task carries everything.

## 7. Confirm

One compact confirmation, always echoing the concrete outcome:

- defer: `→ [[<slug>]] scheduled **Mon 20 Jul** — on that day page's To do list. <Project>.`
- stash: `→ [[<slug>]] stashed (no date) — resurfaces in /weekly's Stashed threads. <Project>.`
- then, for both: `Next action: <the § 4b line> — next task on <Project>, …` naming each
  project note § 4b's `set-down` wrote, then every `skip` row with its reason, except an
  `area note` and § 1.5's `[[Vault]]` umbrella (`no note` by design) — or
  `Next action not written: <stderr>` when the script refused.

Render the task link clickable (`obsidian://open?...` per the global link
rules). When § 5 **Lean capture** leaves unlanded research — a THREAD.md
section or `left in conversation` pointer, or an untouched pre-existing
research-family section, never for an already-landed digest — add the
one-line research-landing offer after the confirmation; it never delays the
safe-to-end line. Then it is safe to end the session — say so.
