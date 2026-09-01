---
name: close
description: 'End-of-thread capture — update the active thread (project THREAD.md or shared _shared/threads/<slug>.md) with what happened this session, then save the rest autonomously: auto-memory (save-time triage, provenance-stamped), workspace knowledge, process-observation candidates to the project''s METHOD.md (project closes only), and git commits all happen without asking; vault tasks are the only proposal. Available globally — works from any CWD. Use when the work is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it''s being set down for later use thread:stash or thread:defer. Invoke with `/thread:close` or "close this thread".'
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

## What to scan for

Walk the conversation back and collect candidates under these categories:

1. **Thread state** — where the active thread sits right now: what just got done, what's the current state, what shifted this session.
2. **Open threads/questions** — questions raised but not answered, decisions flagged but not made, work started but not finished. (These belong in the THREAD.md "Open questions" section.)
3. **Next steps** — concrete actions for the next session (Lachy's or Claude's).
4. **Decisions made in-thread that aren't yet persisted** — agreements or choices that only live in the conversation. If it's already in a file or commit, skip it.
5. **Discovered context a future session would miss** — non-obvious constraints, dead ends ruled out, why a particular path was chosen. (These belong in THREAD.md "Known quirks".)
6. **Patterns / preferences Lachy expressed** — feedback-style guidance worth saving across sessions (not just this thread).
7. **Process observations** — a genuine stage-shift, pivot, reusable move, revealing failure, or cross-workstream effect in *how the project is being made*. Stage-gated, never per-iteration: another numbered pass existing is not an observation; discovering that one variable had to lock before the others could move is. Most sessions have none — NOOP is the expected outcome here too. This category applies **only when the close resolves a project directory** (identification branch 1, or per-project in a multi-project close); shared threads and no-project closes NOOP it. Routing exception to the one-destination rule below: an observation about *how the work is done* goes to METHOD.md even when it would also fit Known quirks — Known quirks holds project-state gotchas, METHOD.md holds process.

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
| Reusable workspace knowledge (gotchas, schemas, processes) | `<workspace>/knowledge/<topic>.md` — same rules as `/learn` | Auto |
| Process observation (category 7) | Append to the project's `METHOD.md` `## Candidates` as a `- YYYY-MM-DD [provisional] <observation> — source: <harness/thread>, evidence: <links>` row, per the `method` skill's capture contract (create the file from `~/.agents/skills/method/METHOD-template.md` if absent, following its creation rules — fill frontmatter, keep placeholders commented out). Candidates are non-curated; the `## Method` section stays untouchable without Lachy's confirmed `/method` apply (ADR 0012) | Auto |
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

5. **Compute the full save set silently** — no "proposed plan" message. Work out: the auto-commit file lists, the thread diff, each memory candidate's verb (via the four-verb triage), knowledge edits, process-observation candidates (category 7, with the resolved METHOD.md path — or NOOP), vault-task candidates, and what's being discarded. Nothing is shown to Lachy until the report in step 8 — except the task menu, if there is one.

6. **Vault tasks only — collect approval via `AskUserQuestion`.** If (and only if) there are proposed vault tasks: one multiSelect question, one option per task (`label` = short title, `description` = the one-line why). A single task candidate gets an explicit second option (`Skip — don't create it`) to satisfy the ≥2-option minimum. More than 4 candidates: collapse per `_shared/knowledge/triage-batching-protocol.md` §6 (*Save all N* / *Save core set* / *Skip section* / named subset). Zero task candidates → no menu at all; go straight to step 7. Ticked → create in step 7; unticked → discard silently; "Other" free-text → treat as a redirect.

7. **Execute.** Order:
   1. Thread update — write THREAD.md (the most important file).
   2. Workspace knowledge edits.
   3. Process-observation candidates — append to the project's `METHOD.md` per the Destinations row, then **auto-commit that file in its containing repo** (named path, same hygiene rules as below) so the append is versioned immediately rather than waiting on the daily sweep. Skip when category 7 resolved to NOOP.
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

This commits only the named paths even if other files are staged. **Before committing**, run `git -C <repo> diff --cached --name-only` and scan what's already staged. If anything is staged that isn't a session-changed file, don't `git reset` it (destructive) — just use named-paths commit. Mention in the saved summary that other files sit in the index for separate handling.

8. **Print the "What landed" report** (≤12 lines): thread-state pointer (e.g. `THREAD.md updated · state: active · open questions: 2`), memory verbs with paths (`ADD feedback_x.md (provisional)` / `UPDATE reference_y.md` / `SUPERSEDE a.md → b.md` / `NOOP: <reason>`), knowledge edits, any METHOD.md candidate append (file path + the observation in one line — this write lands outside the workspace and vault, so it is never silent), vault task files as clickable `[[wiki-links]]`, commit SHAs for all repos touched, any `redirected:` or `Needs your call:` lines, and a one-line discard note.

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
