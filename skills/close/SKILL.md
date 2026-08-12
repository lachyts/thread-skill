---
name: close
description: 'End-of-thread capture — update the active thread (project THREAD.md or shared _shared/threads/<slug>.md) with what happened this session, then triage anything else worth saving (vault tasks, memory, knowledge). Auto-commits workspace + vault git repos for session-changed files. Available globally — works from any CWD. Use when the work is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it''s being set down for later use thread:stash or thread:defer. Invoke with `/thread:close` or "close this thread".'
---

# /thread:close — close out this thread

End-of-thread capture. The thread is about to end — make sure nothing valuable is lost. Triage what happened in this conversation and route each piece to exactly one destination.

**The active thread is always the primary destination.** Update its `THREAD.md` first; everything else (vault tasks, memory, etc.) is supporting capture.

**Commits are automatic. Creative writes are proposed first.**

- **Auto-execute, no asking**: git commits in `~/repos/workspaces/` and the Obsidian vault for any session-changed files. This includes staging + committing knowledge-file edits once they're written. Never surface these as approval items.
- **Propose first, then wait**: thread updates, vault tasks, auto-memory entries, and the *content* of any knowledge edits. These are creative decisions Lachy should confirm before they land on disk.

**Wrong route?** If the conversation reveals the work is *not* finished — it's being parked or continued — dispatch to the right sibling instead: `thread:stash` / `thread:defer` (set down, capture task per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md`) or `thread:handoff` (fork to a fresh agent now).

## Identify the active thread

In order:

1. **CWD inside `~/Projects/<Area>/<Project>/`** → that project's `THREAD.md` (create from the canonical template at `~/.agents/skills/thread/THREAD-template.md` if missing and the project has enough state to warrant one).
2. **Conversation explicitly references a thread by slug** ("this is the memory-system-redesign thread") → `_shared/threads/<slug>.md`.
3. **Conversation has thread shape but no thread exists** (8+ substantive turns, decisions deferred, artefacts produced) → offer to create one via `thread:open <suggested-slug>` first, then proceed.
4. **Genuinely no thread context** (quick lookup, one-shot edit) → skip thread update; still run the rest of the close flow.

## What to scan for

Walk the conversation back and collect candidates under these categories:

1. **Thread state** — where the active thread sits right now: what just got done, what's the current state, what shifted this session.
2. **Open threads/questions** — questions raised but not answered, decisions flagged but not made, work started but not finished. (These belong in the THREAD.md "Open questions" section.)
3. **Next steps** — concrete actions for the next session (Lachy's or Claude's).
4. **Decisions made in-thread that aren't yet persisted** — agreements or choices that only live in the conversation. If it's already in a file or commit, skip it.
5. **Discovered context a future session would miss** — non-obvious constraints, dead ends ruled out, why a particular path was chosen. (These belong in THREAD.md "Known quirks".)
6. **Patterns / preferences Lachy expressed** — feedback-style guidance worth saving across sessions (not just this thread).

Skip anything that's obvious from reading the current code, already in docs, or purely ephemeral (one-off debugging, tool noise).

## Destinations

Each candidate lands in exactly one of these. When in doubt, prefer the destination closer to the work (thread > project doc > workspace memory).

| Type | Destination | Approval |
|---|---|---|
| Workspace config / knowledge file edits made this session | Git commit in `~/repos/workspaces/` — auto, session-changed files only | Auto |
| Obsidian vault changes made this session (`ops-workspace` only) | Git commit in the vault repo — auto, session-changed files only | Auto |
| **Thread state — where we left off, what shifted, new decisions, new known quirks, session log entry** | **Active `THREAD.md` (project or shared)** | **Propose diff** |
| Concrete follow-up actions for Lachy | New file in `vault/Work/Tasks/<slug>.md` — routing + frontmatter shape per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` §§ 1 & 4 (ordinary follow-ups omit the `thread` marker tag — that's for stash/defer captures). Never to `vault/_Inbox/` — that's Lachy's capture surface only | Propose |
| User preferences, recurring patterns, reusable feedback | Auto-memory at the correct scope per `_shared/base-instructions.md` § Memory Management — global, workspace, or project area `CLAUDE.md` | Propose |
| Reusable workspace knowledge (gotchas, schemas, processes) | `<workspace>/knowledge/<topic>.md` — same rules as `/learn` | Propose content |
| Not worth keeping | Discard, note it briefly so Lachy can object | — |

## Memory scope discipline

A `PreToolUse` hook (`_shared/hooks/check-memory-scope.sh`) blocks Write calls to *global* memory paths if the content matches project-area or ops-only keywords. Don't fight it — read the redirect target in the block reason and save there instead.

Before proposing any auto-memory entry, run the scope test from `base-instructions.md`:

- **Global memory**: "Would this be loaded usefully in *every* conversation across *every* workspace?" If no, narrow.
- **Workspace memory**: "Is this relevant to multiple unrelated tasks in this workspace?" If only one project, narrow further.
- **Project area `CLAUDE.md`**: "Is this a rule that applies to all work in this area?" If yes, save here.
- **THREAD.md**: state-of-play of one effort — captured by the thread update, not memory.

## Guardrails

- **Respect the vault's write boundaries**: never write to `vault/_Inbox/` (capture surface — Lachy's only). New files land in their proper home folder. Typed fields hold typed values — dates as `YYYY-MM-DD`, wiki-links for references, lowercase-hyphen enum values.
- **Respect the workspace-vs-project split**: config lives in `~/repos/workspaces/`, project artefacts live in `~/Projects/<Area>/`. Project-specific notes go to the project's `THREAD.md` or files in the project directory — not the workspace.
- **UK English spelling.**
- **No em dashes in any message drafts Lachy will send.**
- **Don't create tasks unsolicited** — propose them, let Lachy approve.
- **Don't save ephemeral conversation context** as memory. The bar is: non-obvious, reusable, verified.

## Process

1. **Determine the working context**:
   - Active thread (per "Identify the active thread" above).
   - Workspace (CWD).
   - Recent project files touched (look at file reads / writes in this session).

2. **Check git state**:
   - `git -C ~/repos/workspaces status --short` — identify which modified files were actually touched in this session vs stale from prior threads. Only session-changed files are in scope.
   - If session is in `ops-workspace`, also `git -C "<vault-path>" status --short` — same filter: only files this thread touched.

3. **Scan the conversation** for the six categories above.

4. **Compute the thread-update diff** (if a thread is active):
   - Where-we-are: rewrite if state advanced; keep if not.
   - What's-built/decided: append new items.
   - Open questions: resolve answered ones (move to "decided"), add new ones.
   - Known quirks: append discoveries from this session.
   - Resume instructions: update if next-session entry-point shifted.
   - Session log: prepend `- YYYY-MM-DD: <one-line of what shifted>` (newest first).

5. **Present the save plan** as a single message, one section per destination. Auto-items are listed as "will do" (Lachy sees them but doesn't approve); proposed items are listed for the approval menu that follows:

   ```
   ## Proposed save plan

   ### Will auto-commit (workspaces repo)
   - <file path> — <one-line why>

   ### Will auto-commit (Obsidian vault)
   - <file path> — <one-line why>  (omit if no vault changes or not ops-workspace)

   ### Thread update — <path to active THREAD.md>
   - <summary of the diff: which sections change>

   ### Vault tasks
   - <task title> → `Work/Tasks/<slug>.md`, scheduled: <date | unscheduled>, project: [[<project>]] | standalone, <one-line context>

   ### Auto-memory
   - <title>, scope: global | workspace | project-area, <one-line why> + redirect target if narrowed

   ### Workspace knowledge
   - <file path> — <section> — <what to add>

   ### Discard
   - <brief list of what's being dropped and why>
   ```

   Do **not** end this message with a text question — the menu in step 6 replaces it.

6. **Collect approvals via `AskUserQuestion`.** One **multiSelect** question per destination that has proposed items (Thread update, Vault tasks, Auto-memory, Workspace knowledge). Each option = one candidate: `label` is a short title, `description` is the one-line why. Auto-commit sections are NOT in the menu — those happen regardless. If there are zero proposed items across all sections, skip the menu entirely and go straight to step 7.

   Handle answers:
   - Options the user ticks → execute in step 7.
   - Options not ticked → discard silently.
   - Free-text via "Other" → treat as a redirect. Scope tweaks apply directly. Substantive redirects re-propose with an updated plan + fresh menu.

   **Fitting within the menu limits (4 questions × 4 options).** Aim for a single `AskUserQuestion` call.

   - **>4 sections with proposed items:** merge low-volume sections (often Workspace knowledge) into a combined "Other saves" multiSelect. Each merged item becomes one option; prefix the label with type (`Knowledge: …`).
   - **>4 items in one section:** collapse to ≤4 options:
     1. *Save all N* — every candidate.
     2. *Save core set* — list top 2-3 in label.
     3. *Skip section* — discard all.
     4. Optional: a named subset.
   - **Still won't fit:** move overflow to Discard with "auto-discarding unless redirected", surface only top-priority in the menu.

7. **Execute.** Order:
   1. Approved thread update — write THREAD.md (the most important file).
   2. Approved creative writes: workspace knowledge edits.
   3. Approved vault tasks: new files at `vault/Work/Tasks/<slug>.md` with Task frontmatter.
   4. Approved auto-memory files + MEMORY.md index updates. Honour the scope hook — if a Write blocks, save to the redirect target instead.
   5. **Auto-commit workspaces repo** — see "Commit hygiene" below. Never ask.
   6. **Auto-commit vault repo** (if ops-workspace and session-changed files exist there) — same rules.

### Commit hygiene (both repos)

`git commit` without explicit paths includes **everything already in the index**, including stale pre-staged changes from prior sessions. That leaks unrelated work into the thread's commit.

Always commit with explicit file paths:

```
git -C <repo> commit <path1> <path2> ... -m "<message>"
```

This commits only the named paths even if other files are staged. **Before committing**, run `git -C <repo> diff --cached --name-only` and scan what's already staged. If anything is staged that isn't a session-changed file, don't `git reset` it (destructive) — just use named-paths commit. Mention in the saved summary that other files sit in the index for separate handling.

8. **Print a compact "saved" summary** (≤8 lines): what landed where, including commit SHAs for both repos, vault task file paths (as clickable `[[wiki-link]]`), and a one-line "thread state" pointer (e.g. `THREAD.md updated · state: active · open questions: 2`).

9. **End with the closing banner.** After the summary, add a blank line, a horizontal rule (`---`), another blank line, then this exact line as the final line of the response:

   ```
   **Thread closed. Safe to end this session — nothing valuable left in conversation state.**
   ```

   No emoji unless Lachy asks. Nothing after this line. The banner is the unmistakable signal that `thread:close` finished cleanly and the cmux pane / session can be shut down without losing state. If something is *not* safe (e.g. a hook block prevented a save and Lachy needs to redirect first), reword the banner to surface that — *"Thread NOT closed: <reason>. Resolve before ending."* — and put it in the same position so the eye lands on it.

## Edge cases

- **Nothing to save.** Say so: "Nothing worth capturing — closing cleanly." Still run the auto-commit step(s) if there are session-changed files.
- **Thread touched multiple projects.** Per-project sections in the thread-update + vault-tasks groupings. Don't merge.
- **Thread was mostly exploratory / no concrete outcome.** Maybe one or two memory saves; thread update may be just a session-log entry. Don't pad.
- **Thread produced destructive changes.** Make sure the "why" lands somewhere — commit message, THREAD.md "Known quirks", or memory.
- **Stale uncommitted files from prior sessions** (flagged by SessionStart hook) are **not in scope**. `thread:close` only handles this thread's work.
- **Not inside `~/repos/workspaces/`.** Skip the workspaces-commit step; everything else still applies.
- **No active thread, no project context.** That's fine — skip thread-update, still run the rest of the triage. Offer to create a thread if the conversation looks worth one.

## Why this exists

Threads routinely end with valuable state only in the conversation — open questions, rationale behind a pivot, a concrete next step that never made it to disk. Without a close ritual, that state evaporates and the next session re-derives it from scratch. `thread:close` is the ritual: triage, route, persist, commit, done.
