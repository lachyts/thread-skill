# Plan: `thread:*` — a continuity family (router + intentional routes)

## Context — why

Lachy runs too many agent threads at once and resists shutting them down for
fear of losing context, so they pile up. The recurring question underneath is
**"what's my next move?"** — asked constantly across threads and projects. He
wants one coherent, named *system* (like his `wave` plugin, not "random words")
that lets him either **ask** what to do next, or **decisively** dispatch a thread
he already has a plan for — always capturing state into Obsidian so nothing is
lost and shutting an agent down stops feeling like loss.

Today three unrelated flat skills half-cover this: `/thread` (open/resume a
`THREAD.md`), `/close` (persist session + commit), `/handoff` (compact → fork
doc). They share no name, namespace, or model, and none makes the keep / defer /
hand-off / close **decision**, none does "defer to tomorrow on my day page", and
none routes captured state into the right Obsidian project.

## The system (decided)

A small **plugin** named `thread` (colon namespace requires plugin packaging,
exactly like `wave` → `lachyts/wave-skill`). It absorbs the three existing skills
as members and adds the new ones. Hybrid by design: a router member for the
undecided moments, decisive members for when he knows.

| Member | Invoke | What it does |
|---|---|---|
| `thread:open` | resume/start | Open or create the durable `THREAD.md` surface. *(migrates `/thread` + `THREAD-template.md`)* |
| `thread:next` | "what's my move?" | **Router/advisor.** Summarise where we are, recommend the next move, then either keep going or dispatch to a sibling route. "New thread / new prompt" = the handoff route. |
| `thread:stash` | lock dormant | Out of time / not my focus → write a **self-contained vault task, no date**. Get it safely out of the way. |
| `thread:defer [day]` | set down for a day | Write a self-contained vault task **scheduled** for `[day]` (default **tomorrow**; accepts `monday`, `friday`, `"next tue"`). Always echoes the concrete date back: "→ scheduled **Mon 20 Jul**, on that day's page". |
| `thread:handoff` | fork now | Compact the conversation into an **inline copy-paste prompt** (+ optional temp doc) so a fresh agent continues this task now. *(reuses `/handoff`, MIT/Pocock — keep attribution; adds the inline prompt)* |
| `thread:close` | done | Persist to `THREAD.md` + auto-commit, end-of-thread ritual. *(reuses `/close`)* |

`next` is the "undecided" child that sits alongside the decisive routes and can
call any of them — not the top of the tree.

## Capture model — nothing is ever lost (FIRM)

**The vault task is the guaranteed floor.** `stash` and `defer` (and `close`'s
follow-up routing) always write a real task at `Work/Tasks/<slug>.md`, routed to
the **right project** and **self-contained**:

- Frontmatter: `tags: [task, <area>]`, `status: open`, `captured: <today>`,
  `projects: [["<Project>"]]` (never `_Inbox`, never orphaned), plus
  `scheduled: <day>` for `defer` (omitted for `stash`).
- Body `## Notes`: a 1–3 line **summary** of where things are, the **copy-paste
  resume prompt**, and a link to `THREAD.md` if one exists.
- **Project routing** reuses the existing rule: resolve from CWD repo via the
  `repos:` frontmatter map across `Work/Projects/*/*.md`, else the active
  thread's project, else ask (`AskUserQuestion`), else umbrella (`[[Vault]]` /
  `[[Personal admin]]`). Same logic `/close` + the task-home instructions use.
- **Day-page surfacing is free**: a task with `scheduled: <day>` shows on that
  day via `/morning`'s `rg "^scheduled: <day>"` + the TaskNotes agenda. No
  day-note editing. (Exactly how `/reflect`'s carry-forward already works.)

**THREAD.md is an optional upgrade, handled for the no-thread case (Lachy's note):**

- Thread already exists → update it, task links to it.
- No thread, work is **thread-worthy** (the `/thread` "thread shape" test: 8+
  substantive turns, deferred decisions, artefacts) → create the `THREAD.md`
  (agent-side: `~/Projects/<Area>/<Project>/` or `_shared/threads/<slug>.md`) as
  part of wrap-up, task links to it.
- No thread, one-off work → **don't manufacture one**; everything lives inside
  the self-contained task.

So the task never depends on a thread existing; the thread is created only when
the work earns it.

**Task-writer hard rules (added on Fable re-review):**

- **No duplicates.** Before writing, check for an existing *open* task for this
  same thread (slug match, or a task whose Notes link the same `THREAD.md`).
  Found → update it in place (refresh summary + resume prompt, move/set
  `scheduled:`), never write a second task. Re-deferring a thread is a
  reschedule, not a new capture.
- **Day parsing is deterministic.** A named day always means the *next future*
  occurrence in `Australia/Melbourne`: `defer monday` said on a Monday →
  **+7 days**, never today. Bare `defer` → tomorrow
  (`TZ="Australia/Melbourne" date -v +1d "+%Y-%m-%d"`). The confirmation always
  echoes the resolved date so a parse surprise is visible immediately.
- **Marker tag `thread`** — stash/defer tasks carry `tags: [task, <area>, thread]`
  so dateless stashes stay queryable (see open question on stash surfacing).
  This is a schema extension → update `_shared/knowledge/obsidian-schema.md`
  in the same change, per the Schema Sync Rule.
- **Wave coexistence note:** these are ordinary open tasks, so `/wave:schedule`
  *could* sweep one into a rollout. That's acceptable — the body carries a
  self-sufficient resume prompt — but the task-writer notes in the body when
  work is conversation-gated so wave's "exclude human-gated tasks" rule applies.

## Files & structure

New plugin repo `~/repos/tools/thread-skill/` (private mirror `lachyts/thread-skill`
per repo conventions), mirroring the **actual** wave layout (verified — wave has
`CONTEXT.md`, `docs/adr/`, `README.md`, own `THREAD.md`):

```
thread-skill/
  .claude-plugin/plugin.json        name: "thread", author, repo, license
  .claude-plugin/marketplace.json   single plugin, source "./"
  CONTEXT.md                        domain glossary (seeded from § Glossary below)
  docs/adr/                         ADRs (see § ADR candidates)
  README.md
  THREAD.md                         the repo's own state-of-play (wave precedent)
  skills/open/SKILL.md
  skills/next/SKILL.md
  skills/stash/SKILL.md
  skills/defer/SKILL.md
  skills/handoff/SKILL.md           (MIT attribution retained)
  skills/close/SKILL.md
  skills/_shared/task-writer.md     shared spec: write+route the vault task
```

Each `SKILL.md` frontmatter carries the **bare** `name:` (e.g. `name: defer`);
Claude Code composes `thread:defer` from the plugin name. Internal cross-skill
references use `${CLAUDE_PLUGIN_ROOT}/skills/...` (wave precedent — never
hardcode the marketplace install path).

**Install mechanics (mirror wave exactly):** dev-iterate with
`--plugin-dir ~/repos/tools/thread-skill`; then push to GitHub and register as
a marketplace the way wave is (`known_marketplaces.json` shows wave: source
`github: lachyts/wave-skill` → installed at
`~/.claude/plugins/marketplaces/wave`).

**THREAD-template.md — single canonical home:** the template currently exists
in TWO places: `~/.claude/skills/thread/` and `~/.agents/skills/thread/` (the
Codex adapter), and `check-agent-parity.py:471` hard-requires the `.agents`
copy. Decision: canonical template = **`~/.agents/skills/thread/THREAD-template.md`**
(harness-neutral, parity-guaranteed). The plugin's `open` skill references that
absolute path; no duplicate copy in the plugin repo (avoids three-way drift);
the `~/.claude/skills/thread/` copy retires with the flat skill.

## Migration

- Port `/close`, `/handoff`, `/thread` logic into `skills/close`, `skills/handoff`,
  `skills/open`. Retire the flat `~/.claude/skills/{close,handoff,thread}` (or
  leave thin aliases for one transition week, then remove) so there's one home.
- `thread:handoff` keeps `disable-model-invocation: true` (verified mechanism:
  hides from the model's skill list, keeps the `/slash` form — per
  `_shared/threads/claude-code-skill-augmentation.md`) and the Pocock
  attribution; adds the inline copy-paste prompt as primary output.
- Reuse `_shared/knowledge/obsidian-ops-patterns.md` (Pattern 3 reschedule) and
  `_System/Templates/Task.md` for the task-writer; do not reinvent.

**Reference-update checklist (grep-verified consumers of the old names/paths):**

| File | What to update |
|---|---|
| `_shared/claude-base-instructions.md:77` § Claude thread workflows | `/thread`→`thread:open`, `/close`→`thread:close`, template path → `.agents` canonical |
| `_shared/commands/project-init.md:92,99` | template copy source → `~/.agents/skills/thread/THREAD-template.md`; `/close` mention. ⚠ hardlinked file — follow the relink procedure (`reference_shared_commands_hardlinks`) |
| `_shared/knowledge/projects-schema.md:45` | template path + `/project` reads / `thread:close` writes |
| `2d-workspace/knowledge/dual-track-projects.md:53` | `/thread` + `/close` → new names |
| `_shared/base-instructions.md:167` | "update via `/close`" → harness-neutral phrasing |
| `_shared/knowledge/daily-git-sweep.md` (3 mentions + § Relationship to /close) | rename mentions |
| `_shared/knowledge/triage-batching-protocol.md:11,197` | **already stale** — points at `_shared/commands/close.md` which no longer exists. Fix while in there: extract the "Fitting within the menu limits" consolidation rules INTO the protocol doc (it's the shared consumer), so it stops depending on close's home at all |
| `_shared/knowledge/ai-agents-claude-codex.md:154` | `~/.claude/skills/close` mention |

**Codex parity (`~/.agents/skills/{thread,close,handoff}/`):** these stay —
Codex can't read Claude plugins, and `base-instructions.md` promises non-Claude
harnesses a thread workflow. They become thin adapters pointing at the plugin
repo's SKILL.md content (the `_adapter-common` pattern already in
`~/.agents/skills/`), so substance lives once in `~/repos/tools/thread-skill/`.
`check-agent-parity.py` keeps passing because the `.agents` template stays put.

## `thread:next` mechanics

1. Read the live conversation + active `THREAD.md` (if any) + open tasks whose
   `projects:` match this project.
2. Summarise "where we are" (headline + open question).
3. Recommend one move: keep going (name the next concrete step) / `defer` /
   `stash` / `handoff` / `close`.
4. Offer the routes via `AskUserQuestion`; execute the chosen route by running
   that sibling member's logic (defer/stash → task-writer; handoff → inline
   prompt; close → persist+commit).

## Verification (end-to-end)

Install locally with `--plugin-dir ~/repos/tools/thread-skill`, then on a real
test conversation:

- `thread:defer` → task at `Work/Tasks/<slug>.md` with `scheduled: <tomorrow>`,
  correct `projects:`, self-contained body; confirm it appears in the TaskNotes
  agenda and via `rg "^scheduled: <tomorrow>" Work/Tasks/`.
- `thread:defer friday` → `scheduled:` = the correct Friday; confirmation echoes
  the date.
- `thread:stash` → task with **no** `scheduled:`, correct project, self-contained.
- No-thread one-off → task only, no `THREAD.md` created. Thread-worthy → a
  `THREAD.md` is created and linked.
- `thread:next` → prints summary + route menu, dispatches to the picked route.
- `thread:handoff` → inline paste prompt produced (+ temp doc); fresh session
  primed from it.
- `thread:close` → `THREAD.md` updated + commit (existing behaviour intact).
- **Pickup loop**: paste a defer task's resume prompt into a fresh session →
  the task flips to `status: done` unprompted; `thread:open [[<task>]]` does the
  same. Re-stash from the resumed session → ONE new task, no duplicate.
- **Re-defer dedup**: `thread:defer` twice on the same thread → single task,
  `scheduled:` moved, not duplicated.
- **Stash review**: `/weekly` lists the stashed task and its verdict menu works.
- Migration check: old `/thread /close /handoff` no longer double-fire; every
  file in the reference-update checklist actually updated (re-run the grep);
  `check-agent-parity.py` still passes.

## Glossary (seeds `CONTEXT.md` in the plugin repo at build)

Plan mode blocks creating the repo, so the domain language crystallised during
grilling lives here and becomes `thread-skill/CONTEXT.md` verbatim at build.

- **Thread** — a live agent conversation carrying working context. Ephemeral;
  dies with the session. (Deliberately overloaded with the file below — the
  plugin name trades on the overlap, but the two must never be confused in
  skill prose.)
- **THREAD.md** — the durable state-of-play *file* a thread can be persisted
  into. Project-side (`~/Projects/<Area>/<Project>/`) or shared
  (`_shared/threads/<slug>.md`). Agent-facing.
- **Route** — a decisive member (`stash`, `defer`, `handoff`, `close`) that
  disposes of the current thread with known intent.
- **Router (`next`)** — the undecided sibling. Answers "what's my next move?"
  then dispatches to a route. A sibling, not a parent.
- **Task floor** — the invariant: every stash/defer writes a self-contained
  vault task routed to the right project. The guarantee that makes shutting an
  agent down feel safe.
- **Thread-worthy** — passes the thread-shape test (8+ substantive turns,
  deferred decisions, artefacts). Only thread-worthy work earns a THREAD.md.
- **Stash** — dispose dormant, no date. "Not my focus, lock it in."
- **Defer** — dispose onto a specific day (`scheduled:`). "Tomorrow's problem."
- **Handoff** — fork the working context to a fresh agent *now*; work continues
  immediately, this session ends.
- **Close** — the work is finished; persist + commit, end-of-thread ritual.

## ADR candidates (offer at build, wave-style `docs/adr/`)

1. **0001 — The task is the floor; the thread is the upgrade.** Real trade-off
   (THREAD.md-first vs task-embedded context), surprising to a future reader,
   and sticky once tasks exist under this model. Mirrors wave's
   `0001-repair-is-a-conductor-not-an-engine.md` in spirit.
2. **0002 — `next` is a sibling, not a parent.** The hybrid decision: router
   AND decisive routes coexist because intent-detection can't be trusted with
   decisive moods.

## The pickup loop (DECIDED: auto-complete on pickup)

The capture's job — don't lose the thread — is finished the moment the thread
is resumed. Two complementary mechanisms, both cheap:

- **The resume prompt closes its own task.** The task-writer embeds, as the
  *first instruction* of the copy-paste resume prompt: "you now own this work —
  mark `Work/Tasks/<slug>.md` `status: done` (`completed: <today>`)". Works
  even when pasted into a non-Claude harness.
- **`thread:open` accepts a task reference.** `thread:open [[<task>]]` (or a
  path) reads the task, primes from its resume prompt + linked THREAD.md, and
  completes the task natively.

If the resumed session is later set down again, the dedup rule finds no *open*
task and writes a fresh capture — the loop closes itself, no manual bookkeeping.

## Stash surfacing (DECIDED: /weekly review section)

`/weekly` gains a **"Stashed threads"** pass: list open tasks tagged `thread`
with no `scheduled:` (`rg`-able thanks to the marker tag), oldest first, and
ask a verdict per item — resume now / defer to a day (runs the defer
task-writer) / let sit / kill. Mirrors `/weekly`'s existing stale-`.scratch`
review. Touch: the `/weekly` command file (⚠ if it's a `_shared/commands/`
hardlink, follow the relink procedure).

## Deferred (not this build)

- Whether `THREAD.md` should eventually live *in* the vault (two-tier project-note
  view) — revisit only if the self-contained task proves insufficient in practice.
- Extra `defer` day-shortcuts as aliases — only if real friction shows up.
