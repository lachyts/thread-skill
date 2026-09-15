---
name: close
description: 'End-of-thread capture — update the active thread (project THREAD.md or shared _shared/threads/<slug>.md) with what happened this session, then save the rest autonomously: auto-memory (save-time triage, provenance-stamped), workspace knowledge, process-observation candidates to the METHOD.md the altitude routing test resolves (project, seat or estate), and git commits all happen without asking; vault tasks are the only proposal. Available globally — works from any CWD. Use when the work is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it''s being set down for later use thread:stash or thread:defer. Invoke with `/thread:close` or "close this thread".'
---

# /thread:close — close out this thread

End-of-thread capture. The thread is about to end — make sure nothing valuable is lost. Triage what happened in this conversation and route each piece to exactly one destination.

**The active thread is always the primary destination.** Update its `THREAD.md` first; everything else (vault tasks, memory, etc.) is supporting capture.

**Everything saves autonomously except vault tasks.**

- **Auto-execute, no asking**: git commits in `~/repos/workspaces/` and the Obsidian vault (session-changed files only), the thread update, auto-memory entries (via the save-time triage below), and workspace knowledge edits. The safety net that replaced per-item approval sits downstream, not in a menu: auto-memory lands `provisional` with provenance, nothing is ever hard-deleted, and the weekly memory curator archives what turns out to be junk (ADR 0011).
- **Propose first, then wait**: vault tasks only. Tasks surface on Lachy's daily agenda, so a junk task has ongoing attention cost — "don't create tasks unsolicited" survives as the sole approval gate.

**Wrong route?** If the conversation reveals the work is *not* finished — it's being parked or continued — dispatch to the right sibling instead: `thread:stash` / `thread:defer` (set down, capture task per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md`) or `thread:handoff` (fork to a fresh agent now).

## Identify the active thread

In order:

1. **CWD inside `~/Projects/<Area>/<Project>/`** → that project's `THREAD.md` (create from the canonical template at `~/.agents/skills/thread/THREAD-template.md` if missing and the project has enough state to warrant one).
2. **Conversation explicitly references a thread by slug** ("this is the memory-system-redesign thread") → `_shared/threads/<slug>.md`.
3. **Conversation has thread shape but no thread exists** (8+ substantive turns, decisions deferred, artefacts produced) → offer to create one via `thread:open <suggested-slug>` first, then proceed.
4. **Genuinely no thread context** (quick lookup, one-shot edit) → skip thread update; still run the rest of the close flow.

### Project directory resolution

Category 7's **project** ledger needs a project *directory* on disk, and a code repo is not one: `~/repos/animately/giflab` is the code, `~/Projects/Animately/giflab/` is the project. Resolve the directory in order, stopping at the first hit:

1. **CWD inside `~/Projects/<Area>/<Project>/`** (branch 1 above) → that directory.
2. **CWD inside a code repo** → the vault project note paired with it: grep `repos:` frontmatter across `~/repos/obsidian/Work/Projects/**` for an entry matching this CWD's repo (expand `~` to `$HOME` before comparing). If that note names a project directory under `~/Projects/` — its `Local:` line, or the paired path the `repos:` entry resolves to — that directory is the answer.
3. **The paired note names no `~/Projects/` path at all** → take the note's area (its `area:` frontmatter, else the `Work/Projects/<Area>/` folder it sits in) plus the code repo's basename, and use `~/Projects/<Area>/<basename>/` **only if that directory already exists**. GifLab is the case: its note's `repos:` and `Local:` both name the code repo `~/repos/animately/giflab`, area `Animately`, basename `giflab` — and `~/Projects/Animately/giflab/` exists, so that is the answer. Never create the directory, and never guess past this rung.

Nothing else resolves. Never invent a path from the note's title, and never create a project directory just to hold a ledger. **A tool repo — any repo outside `~/Projects/` — is never a project surface, even when it has its own `THREAD.md`**: a THREAD.md is thread state, not a project ledger, and a tool repo's process rows go to the estate. If no rung hits, there is no project directory — say so and let the routing test skip its project step. Stash and defer cite this sub-section rather than restating it.

## What to scan for

Walk the conversation back and collect candidates under these categories:

1. **Thread state** — where the active thread sits right now: what just got done, what's the current state, what shifted this session.
2. **Open threads/questions** — questions raised but not answered, decisions flagged but not made, work started but not finished. (These belong in the THREAD.md "Open questions" section.)
3. **Next steps** — concrete actions for the next session (Lachy's or Claude's).
4. **Decisions made in-thread that aren't yet persisted** — agreements or choices that only live in the conversation. If it's already in a file or commit, skip it.
5. **Discovered context a future session would miss** — non-obvious constraints, dead ends ruled out, why a particular path was chosen. (These belong in THREAD.md "Known quirks".)
6. **Patterns / preferences Lachy expressed** — feedback-style guidance worth saving across sessions (not just this thread).
7. **Process observations** — a genuine stage-shift, pivot, reusable move, revealing failure, or cross-workstream effect in *how the project is being made*. Stage-gated, never per-iteration: another numbered pass existing is not an observation; discovering that one variable had to lock before the others could move is. Most sessions have none — NOOP is the expected outcome here too. Route with the `method` skill's routing test — `~/.agents/skills/method/SKILL.md` § Which ledger a row goes to; unsure → project; when no project directory resolves, unsure → the seat if a workspace resolves, else the estate (ADR 0015). That section is the single definition of the test, including sub-seats, areas with no paired workspace, and contexts with no project or no workspace: cite it, never restate its rungs here. A project ledger is a destination only when `close`'s § Project directory resolution yields a directory; otherwise the routing test skips its project step. On Windows (no `~/.agents` tree — the method contract and template are not shipped there) the category-7 scan NOOPs at every altitude; never hand-roll a row or a ledger. Routing exception to the one-destination rule below: an observation about *how the work is done* goes to METHOD.md even when it would also fit Known quirks — Known quirks holds project-state gotchas, METHOD.md holds process.

Skip anything that's obvious from reading the current code, already in docs, or purely ephemeral (one-off debugging, tool noise).

## Destinations

Each candidate lands in exactly one of these. When in doubt, prefer the destination closer to the work (thread > project doc > workspace memory).

| Type | Destination | Approval |
|---|---|---|
| Workspace config / knowledge file edits made this session | Git commit in `~/repos/workspaces/` — auto, session-changed files only | Auto |
| Obsidian vault changes made this session (`ops-workspace` only) | Git commit in the vault repo — auto, session-changed files only | Auto |
| Thread state — where we left off, what shifted, new decisions, new known quirks, session log entry | Active `THREAD.md` (project or shared) | Auto |
| Concrete follow-up actions for Lachy | New file in `vault/Work/Tasks/<slug>.md` — routing + frontmatter shape per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` §§ 1 & 4 (ordinary follow-ups omit the `thread` marker tag — that's for stash/defer captures). Never to `vault/_Inbox/` — that's Lachy's capture surface only | **Propose** |
| User preferences, recurring patterns, reusable feedback | Auto-memory at the correct scope per `~/repos/workspaces/_shared/claude-base-instructions.md` § Claude memory management — global, workspace, or project area `AGENTS.md` — via the save-time triage below | Auto |
| Reusable workspace knowledge — facts about a tool or system (gotchas, schemas, limits, quirks) | `<workspace>/knowledge/<topic>.md` — same rules as `/learn`. A process observation is not a fact about a tool: it takes the row below | Auto |
| Process observation (category 7) | Append to the `METHOD.md` `## Candidates` the routing test resolves — project, seat (`~/repos/workspaces/<workspace>/knowledge/METHOD.md`, or a declared sub-seat's such as `~/repos/workspaces/animately-workspace/seo/knowledge/METHOD.md`) or estate (`~/repos/workspaces/_shared/knowledge/METHOD.md`) — as a `- YYYY-MM-DD [provisional] K<nn> — <observation> — source: <harness/thread>, evidence: <path § heading>` row (`K` + one more than the highest existing `K` ordinal in that ledger, `K01` when none, independent of other prefixes; link-checked), per the `method` skill's capture contract (create the file from `~/.agents/skills/method/METHOD-template.md` if absent, following its creation rules — fill the frontmatter for that altitude, keep placeholders commented out). Capture does not curate `## Method`; an authorised method pass follows the method skill's working agreement for routine curation and user decisions on exceptions (the 2026-09-15 agreement supersedes the earlier blanket apply gate) | Auto |
| Not worth keeping | Discard; one line in the "What landed" report so Lachy can object | — |

## Memory scope discipline

A `PreToolUse` hook (`_shared/hooks/check-memory-scope.sh`) blocks Write calls to *global* memory paths if the content matches project-area or ops-only keywords. Don't fight it — read the redirect target in the block reason and save there instead, recording `redirected: global → <scope>` in the report. If the redirect target is ambiguous, or the redirected write also blocks, do **not** save anywhere: emit NOOP for that candidate and list it under a `Needs your call:` line in the report — never as a question (the banner stays last).

Before saving any auto-memory entry, run the scope test from `claude-base-instructions.md` § Claude memory management:

- **Global memory**: "Would this be loaded usefully in *every* conversation across *every* workspace?" If no, narrow.
- **Workspace memory**: "Is this relevant to multiple unrelated tasks in this workspace?" If only one project, narrow further.
- **Project area `AGENTS.md`**: "Is this a rule that applies to all work in this area?" If yes, save here.
- **THREAD.md**: state-of-play of one effort — captured by the thread update, not memory.

## Save-time triage — four verbs

Before **any** memory Write, resolve the candidate against what already exists. Grep the target scope's `MEMORY.md` for hook keywords from the candidate, Read the 1–3 plausibly related topic files, then emit exactly one verb:

- **ADD** — genuinely new: write a new topic file + index line.
- **UPDATE `<file>`** — the fact enriches or extends an existing memory: edit that file in place, bump its `metadata.last_confirmed`, leave its status untouched.
- **SUPERSEDE `<file>`** — the fact contradicts or replaces an existing memory: write the new file, set the old file's `metadata.status: superseded` + `metadata.superseded_by: <new-file>.md`, and swap the index line to the new file. The curator archives superseded files on its next pass — never delete them here.
- **NOOP** — already covered, ephemeral, or below the bar. **NOOP is a success state**, listed in the report with its one-line reason.

Every file written or updated carries the memory frontmatter contract, nested under the harness's existing shape:

```yaml
metadata:
  type: feedback            # user | feedback | project | reference
  captured: 2026-08-29
  last_confirmed: 2026-08-29
  status: provisional       # provisional | active | superseded
  provenance: close-inferred  # close-inferred | user-explicit | legacy
  permanent: false
```

Close-inferred saves land `status: provisional` — the curator promotes them to `active` once they're recalled again, and archives them if they never are. An explicit in-conversation "remember this" from Lachy lands `provenance: user-explicit, status: active`. Set `permanent: true` only when Lachy says so or the fact is plainly identity/health/hard-constraint — permanent entries are never recency-culled.

## Guardrails

- **Respect the vault's write boundaries**: never write to `vault/_Inbox/` (capture surface — Lachy's only). New files land in their proper home folder. Typed fields hold typed values — dates as `YYYY-MM-DD`, wiki-links for references, lowercase-hyphen enum values.
- **Respect the workspace-vs-project split**: config lives in `~/repos/workspaces/`, project artefacts live in `~/Projects/<Area>/`. Project-specific notes go to the project's `THREAD.md` or files in the project directory — not the workspace.
- **UK English spelling.**
- **No em dashes in any message drafts Lachy will send.**
- **Don't create tasks unsolicited** — propose them, let Lachy approve. The one surviving gate.
- **Don't save ephemeral conversation context** as memory. The bar is: non-obvious, reusable, verified. When in doubt, NOOP — the four-verb triage makes "don't save" a first-class outcome.

## Process

1. **Determine the working context**:
   - Active thread (per "Identify the active thread" above).
   - Workspace (CWD).
   - Recent project files touched (look at file reads / writes in this session).

2. **Check git state**:
   - `git -C ~/repos/workspaces status --short` — identify which modified files were actually touched in this session vs stale from prior threads. Only session-changed files are in scope.
   - If session is in `ops-workspace`, also `git -C "<vault-path>" status --short` — same filter: only files this thread touched.

3. **Scan the conversation** for the seven categories above.

4. **Compute the thread-update diff** (if a thread is active):
   - Where-we-are: rewrite if state advanced; keep if not.
   - What's-built/decided: append new items.
   - Open questions: resolve answered ones (move to "decided"), add new ones.
   - Known quirks: append discoveries from this session.
   - Resume instructions: update if next-session entry-point shifted.
   - Session log: prepend `- YYYY-MM-DD: <one-line of what shifted>` (newest first).

5. **Compute the full save set silently** — no "proposed plan" message. Work out: the auto-commit file lists, the thread diff, each memory candidate's verb (via the four-verb triage), knowledge edits, process-observation candidates (category 7, with the METHOD.md path the routing test resolved — or NOOP), vault-task candidates, and what's being discarded. Nothing is shown to Lachy until the report in step 8 — except the task menu, if there is one.

6. **Vault tasks only — collect approval via `AskUserQuestion`.** If (and only if) there are proposed vault tasks: one multiSelect question, one option per task (`label` = short title, `description` = the one-line why). A single task candidate gets an explicit second option (`Skip — don't create it`) to satisfy the ≥2-option minimum. More than 4 candidates: collapse per `_shared/knowledge/triage-batching-protocol.md` §6 (*Save all N* / *Save core set* / *Skip section* / named subset). Zero task candidates → no menu at all; go straight to step 7. Ticked → create in step 7; unticked → discard silently; "Other" free-text → treat as a redirect.

7. **Execute.** Order:
   1. Thread update — write THREAD.md (the most important file).
   2. Workspace knowledge edits.
   3. Process-observation candidates — append to the `METHOD.md` the routing test resolved, per the Destinations row. Skip when category 7 resolved to NOOP. **One rule at every altitude:** commit the append immediately in its containing repo — a project ledger in the `~/Projects` monorepo, a seat or estate ledger in `~/repos/workspaces` — with the add-then-pathspec form in "Commit hygiene" below, so it is versioned immediately rather than waiting on the daily sweep (ADR 0012). Sub-step 6's workspaces auto-commit then finds a seat or estate ledger already committed.
   4. Auto-memory via the four verbs + MEMORY.md index updates. Honour the scope hook per "Memory scope discipline" — redirect or NOOP, autonomously.
   5. Approved vault tasks: new files at `vault/Work/Tasks/<slug>.md` with Task frontmatter.
   6. **Auto-commit workspaces repo** — see "Commit hygiene" below. Never ask.
   7. **Auto-commit vault repo** (if ops-workspace and session-changed files exist there) — same rules.

### Commit hygiene (both repos)

`git commit` without explicit paths includes **everything already in the index**, including stale pre-staged changes from prior sessions. That leaks unrelated work into the thread's commit.

Always commit with explicit file paths:

```
git -C <repo> commit <path1> <path2> ... -m "<message>"
```

This commits only the named paths even if other files are staged. **Before staging or committing anything**, run `git -C <repo> diff --cached --name-only` and scan what is already in the index — the scan comes first, because the `git add` below writes to that same index and would hide what was there. If anything is staged that isn't a session-changed file, don't `git reset` it (destructive) — just use named-paths commit. Mention in the saved summary that other files sit in the index for separate handling.

Only then stage. A file **created this session** — a `METHOD.md` written from the template, a new knowledge topic file — is untracked, so a pathspec commit alone fails with `pathspec ... did not match any file(s) known to git`. Add it first, then commit that path:

```
git -C <repo> add <path> && git -C <repo> commit -m "<message>" -- <path>
```

If `git add` fails — an ignored path such as `~/Projects/Tutorials/`, `_archive/` or `TSMS/` — **do not commit**. Report `not versioned: <path> (<reason>)` in the What landed report instead of a SHA.

8. **Print the "What landed" report** (≤12 lines): thread-state pointer (e.g. `THREAD.md updated · state: active · open questions: 2`), memory verbs with paths (`ADD feedback_x.md (provisional)` / `UPDATE reference_y.md` / `SUPERSEDE a.md → b.md` / `NOOP: <reason>`), knowledge edits, any METHOD.md candidate append, at any altitude (file path + the observation in one line — the project ledger lands outside the workspace and vault, and the seat/estate ledgers are doctrine surfaces; neither is ever silent), vault task files as clickable `[[wiki-links]]`, commit SHAs for all repos touched, any `not versioned: <path> (<reason>)` line from a failed stage (see Commit hygiene), any `redirected:` or `Needs your call:` lines, and a one-line discard note.

9. **End with the closing banner.** After the report, add a blank line, a horizontal rule (`---`), another blank line, then this exact line as the final line of the response:

   ```
   **Thread closed. Safe to end this session — nothing valuable left in conversation state.**
   ```

   No emoji unless Lachy asks. Nothing after this line. The banner is the unmistakable signal that `thread:close` finished cleanly and the cmux pane / session can be shut down without losing state. If something is *not* safe (e.g. a hook block prevented a save and Lachy needs to redirect first), reword the banner to surface that — *"Thread NOT closed: <reason>. Resolve before ending."* — and put it in the same position so the eye lands on it.

## Edge cases

- **Nothing to save.** Say so: "Nothing worth capturing — closing cleanly." An all-NOOP close is a healthy close. Still run the auto-commit step(s) if there are session-changed files.
- **Ambiguous scope redirect.** A blocked memory write whose redirect target is unclear (or itself blocks) becomes a NOOP + `Needs your call:` report line — never a question, never a fought hook.
- **Thread touched multiple projects.** Per-project sections in the thread-update + vault-tasks groupings. Don't merge.
- **Thread was mostly exploratory / no concrete outcome.** Maybe one or two memory saves; thread update may be just a session-log entry. Don't pad.
- **Thread produced destructive changes.** Make sure the "why" lands somewhere — commit message, THREAD.md "Known quirks", or memory.
- **Stale uncommitted files from prior sessions** (flagged by SessionStart hook) are **not in scope**. `thread:close` only handles this thread's work.
- **Not inside `~/repos/workspaces/`.** Skip the workspaces-commit step; everything else still applies.
- **No active thread, no project context.** That's fine — skip thread-update, still run the rest of the triage. Offer to create a thread if the conversation looks worth one.

## Why this exists

Threads routinely end with valuable state only in the conversation — open questions, rationale behind a pivot, a concrete next step that never made it to disk. Without a close ritual, that state evaporates and the next session re-derives it from scratch. `thread:close` is the ritual: triage, route, persist, commit, done. The approval gate moved from save-time to curation-time (ADR 0011): saves are cheap and reversible, so the weekly curator — not a menu — is what keeps memory clean.
