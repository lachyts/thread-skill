---
name: close
description: 'End-of-thread capture — update the active thread (project THREAD.md or shared _shared/threads/<slug>.md) with what happened this session, then save the rest autonomously: auto-memory (save-time triage, provenance-stamped), workspace knowledge, process-observation candidates to the METHOD.md the altitude routing test resolves (project, seat or estate), and git commits all happen without asking; vault tasks are the only proposal. Available globally — works from any CWD. Use when the work is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it''s being set down for later use thread:stash or thread:defer. Invoke with `/thread:close` or "close this thread".'
---

# /thread:close — close out this thread

End-of-thread capture. The thread is about to end — make sure nothing valuable is lost. Triage what happened in this conversation and route each piece to exactly one destination.

**The active thread is always the primary destination.** Update its `THREAD.md` first; everything else (vault tasks, memory, etc.) is supporting capture.

**Everything saves autonomously except vault tasks.**

- **Auto-execute, no asking**: git commits in `~/repos/workspaces/` and the Obsidian vault (session-changed files only) plus the handoff docs, each by pathspec in its own repo (§ The handoff owns the continuation), a tool repo's own `THREAD.md`, by pathspec in the repo that holds it (step 7.1), the thread update, auto-memory entries (via the save-time triage below), and workspace knowledge edits. The safety net that replaced per-item approval sits downstream, not in a menu: auto-memory lands `provisional` with provenance, nothing is ever hard-deleted, and the weekly memory curator archives what turns out to be junk (ADR 0011).
- **Propose first, then wait**: vault tasks only. Tasks surface on Lachy's daily agenda, so a junk task has ongoing attention cost — "don't create tasks unsolicited" survives as the sole approval gate.

**Wrong route?** If the conversation reveals the work is *not* finished — it's being parked or continued — dispatch to the right sibling instead: `thread:stash` / `thread:defer` (set down, capture task per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md`) or `thread:handoff` (fork to a fresh agent now).

## Identify the active thread

In order:

1. **CWD inside `~/Projects/<Area>/<Project>/`** → that project's `THREAD.md` (create from the canonical template at `~/.agents/skills/thread/THREAD-template.md` if missing and the project has enough state to warrant one).
2. **Conversation explicitly references a thread by slug** ("this is the memory-system-redesign thread") → run `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Repo-thread lookup in full with `slug=<slug>`. It checks `_shared/threads/<slug>.md`, then `~/Projects`, then repo threads, and the first hit wins. A repo THREAD.md with no front-matter `slug:` matches its directory's basename. One path → that file. Several (only possible within a tier, and within the repo tier only when none is in the CWD's repo) → list the paths and ask. No hit → rung 4, **never rung 3**, so naming a thread that does not exist never writes the CWD repo's THREAD.md.
3. **CWD inside a git repo whose toplevel holds a `THREAD.md` that `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Repo-thread lookup lists with `slug=` empty** → that file. The test is membership: the lookup's output contains `$(git rev-parse --show-toplevel)/THREAD.md`, and both sides are physical paths. The exclusions are therefore the lookup's by construction: `~/repos/obsidian`, `~/repos/workspaces`, depth > 3, anything outside `~/repos` (which includes `~/Projects`), and `*/.claude/*`. A `.claude/worktrees/<w>` toplevel never qualifies, for two independent reasons: it sits deeper than 3 below `~/repos`, and the `*/.claude/*` rule drops it even if the depth limit changes. A worktree copy therefore falls through to rungs 4 and 5.
4. **Conversation has thread shape but no thread exists** (8+ substantive turns, decisions deferred, artefacts produced) → offer to create one via `thread:open <suggested-slug>` first, then proceed.
5. **Genuinely no thread context** (quick lookup, one-shot edit) → skip thread update; still run the rest of the close flow.

## What to scan for

Walk the conversation back and collect candidates under these categories:

1. **Thread state** — where the active thread sits right now: what just got done, what's the current state, what shifted this session.
2. **Open threads/questions** — questions raised but not answered, decisions flagged but not made, work started but not finished. (These belong in the THREAD.md "Open questions" section.)
3. **Next steps** — concrete actions for the next session (Lachy's or Claude's).
4. **Decisions made in-thread that aren't yet persisted** — agreements or choices that only live in the conversation. If it's already in a file or commit, skip it.
5. **Discovered context a future session would miss** — non-obvious constraints, dead ends ruled out, why a particular path was chosen. (These belong in THREAD.md "Known quirks".)
6. **Patterns / preferences Lachy expressed** — feedback-style guidance worth saving across sessions (not just this thread).
7. **Process observations** — run `${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md` in full (not silent mode): its bar, routing, project-directory rungs, Windows NOOP, row form and commit rule are the whole of category 7. Most sessions have none — NOOP is the expected outcome here too; any append is listed in the step-8 report. Routing exception to the one-destination rule below: an observation about *how the work is done* goes to METHOD.md even when it would also fit Known quirks — Known quirks holds project-state gotchas, METHOD.md holds process.

Skip anything that's obvious from reading the current code, already in docs, or purely ephemeral (one-off debugging, tool noise).

## Destinations

Each candidate lands in exactly one of these. When in doubt, prefer the destination closer to the work (thread > project doc > workspace memory).

| Type | Destination | Approval |
|---|---|---|
| Workspace config / knowledge file edits made this session | Git commit in `~/repos/workspaces/` — auto, session-changed files only | Auto |
| Obsidian vault changes made this session (`ops-workspace` only) | Git commit in the vault repo — auto, session-changed files only | Auto |
| Thread state — where we left off, what shifted, new decisions, new known quirks, session log entry, resume instructions (a pointer to the pending handoff doc when one exists — never a copy of it) | Active `THREAD.md` (project, shared or repo) | Auto |
| Thread continuation while a handoff doc is pending — category 3 only: what remains, the next move, the paste-ready prompt | The pending doc itself, `<home>/docs/handoffs/<date>-<slug>.md`, refreshed in place and committed by pathspec — § The handoff owns the continuation | Auto |
| Concrete follow-up actions for Lachy. While a handoff doc is pending, only *loose ends* qualify — the thread's continuation belongs to the row above (§ The handoff owns the continuation) | New file in `vault/Work/Tasks/<slug>.md` — routing + frontmatter shape per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` §§ 1 & 4; the body obeys `task-writer.md` § 5 **Lean capture** (ordinary follow-ups omit the `thread` marker tag — that's for stash/defer captures). Never to `vault/_Inbox/` — that's Lachy's capture surface only | **Propose** |
| User preferences, recurring patterns, reusable feedback | Auto-memory at the correct scope per `~/repos/workspaces/_shared/claude-base-instructions.md` § Claude memory management — global, workspace, or project area `AGENTS.md` — via the save-time triage below | Auto |
| Reusable workspace knowledge — facts about a tool or system (gotchas, schemas, limits, quirks) | `<workspace>/knowledge/<topic>.md` — same rules as `/learn`. A process observation is not a fact about a tool: it takes the row below | Auto |
| Process observation (category 7) | Append to the `METHOD.md` `## Candidates` the routing test resolves — project, seat or estate — per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md` § Row form | Auto |
| Not worth keeping | Discard; one line in the "What landed" report so Lachy can object | — |

## The handoff owns the continuation

A **handoff doc** is a file in `<home>/docs/handoffs/`; what it is, who writes it and the states it moves through are `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § States (its front matter is `handoff-lifecycle.md` § Front matter). `<home>` is resolved by the rules in `handoff-lifecycle.md` § Home, whose only implementation is `${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh` — handoff's writer calls the same script, so the scan below looks exactly where the doc was written. Outside `_shared`, a pending doc in `<home>/docs/handoffs/` is *this thread's* by construction; the one exception is a `<home>` that carries more than one THREAD.md-backed thread, where a doc whose `thread:` names a thread other than the active one is that thread's and is left alone. In `_shared`, ownership is by `thread:` only, because `_shared` holds every shared thread's docs: with a non-empty `slug` the scan lists only this thread's docs there, so step 7.2 can never delete another thread's consumed doc, and a legacy doc in a slug-filtered `_shared` (it has no `thread:`) is neither listed nor counted. Lachy tracks the doc as a **single object**: he acts on it, or he converts it into a task himself. A close that proposes vault tasks restating it is a second tracker for work he is already tracking, and reads as though the handoff did not count (ruled 2026-09-19; ADR 0017).

**The test is on disk, never in memory** — run the scan in step 2 and again before step 6, so it survives a context compaction. Each scanned directory, no recursion (`<home>/docs/handoffs/` is where handoff writes); `find`, not a glob. The logic is `${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/handoff-scan.sh`, called by the snippet below and never inlined: Claude Code substitutes skill arguments into every positional dollar-digit parameter in a SKILL.md body, awk's field references included, so an inline scan runs corrupted whenever close is invoked with arguments. The scan takes three inputs, set on a line of their own before the snippet (`slug=… shared=… pointer=…`; the snippet only defaults them, so values already in the environment survive):

- `slug` — the active thread's effective slug: its THREAD.md `slug:`, or for a repo thread without one its directory's basename (`${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Repo-thread lookup) (empty when no thread is active).
- `shared` — `1` when the active thread is a `_shared/threads/<slug>.md`, else empty. With a slug, the scan then also covers `_shared/docs/handoffs/` (filtered by `thread:`) when `<home>` is somewhere else.
- `pointer` — the path in the THREAD.md Resume instructions (`Read <path> first`), else empty. The doc it names is classified even when it lies outside the scanned directories — a doc written at a consumer home in another repo (handoff **Consumer home.**) stays visible here — and is never printed twice.

```bash
# thread:handoff-scan (extracted and run by tests/handoff-scan.test.sh)
hs="${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/handoff-scan.sh"
if [ ! -f "$hs" ]; then echo "handoff-scan: script not found at $hs (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
slug="${slug:-}" shared="${shared:-}" pointer="${pointer:-}" bash "$hs"
# end thread:handoff-scan
```

The snippet announces each directory it scanned as a `# scanned <dir>` line on stderr, and a pointer it could not classify as `handoff-scan: pointer not absolute (<p>)` or `handoff-scan: pointer missing (<p>)`; stdout stays `<status> <path>` lines only. When the script or its resolver cannot be run (`CLAUDE_PLUGIN_ROOT` unset, a stale cache, a host without the plugin) or the resolver prints nothing, the scan exits 2 with a `handoff-scan:` line on stderr and prints nothing — it never guesses a directory (step 2's failure path).

`pending` → this thread's continuation (the rules below). `consumed` → deleted in step 7 once the peer guard (`handoff-lifecycle.md` § Close-out) allows: at this session's close if it marked the doc, otherwise at the first close after 24 h with no listed peer in its `<home>` or `Run from:` directory; until then left for its consumer and reported. `legacy` and `unknown(…)` → one counted report line, untouched. The status is read from the front-matter block only (quotes stripped, case-folded, CRLF tolerated), so a body that mentions `status: pending` does not count.

Three rules, for this thread's pending doc:

1. **Scope is the line.** For each vault-task candidate ask one question: *would the next session, working from this doc, do it?* Yes → it is **continuation**, and the doc is its only destination. No → it is a **loose end** — a malformed vault note to rename, a supplier to chase, anything the thread's `scope:` line does not cover — and it reaches the task menu exactly as before. The doc's own title and § What remains decide the question, not who asked for the handoff: a hook-forced handoff counts exactly like a requested one.
2. **Refresh, don't restate — continuation only.** Re-read the doc's § What remains and § Paste-ready prompt against **category 3** of the scan. A remaining item this session completed moves to § Done and verified; a next step the doc lacks is added; a next move that has moved on is rewritten; add `refreshed: <today>` to the front matter (the optional key handoff's contract reserves for this) and commit the file by pathspec in its own repo (step 7.2). Categories 1, 2, 4 and 5 land in THREAD.md exactly as before — the doc is refreshed for continuation, never as a second state record, so every candidate still has one destination. This is the whole handling for a handoff written mid-session and then overtaken by hours of further work: the doc stays the one true object instead of the menu quietly growing a second one. A doc the scan finds nothing to change is left byte-identical and reported `unchanged`.
3. **No annotation, no asking.** Never label a candidate "already in the handoff", never ask whether he has done it. Both hand back a decision the rule has already made. The report row in step 8 is the visibility — it carries the doc's `written:` date, so a handoff that has sat pending for weeks is visible at every close without a TTL deciding for him.

A **manual handoff** is a complete handoff for this rule (`handoff-lifecycle.md` § While pending); a handoff **withdrawn in the same session** is no handoff at all, and close finds nothing pending (`handoff-lifecycle.md` § Withdrawn).

THREAD.md is updated as normal — state, decisions, quirks, session log — but its *Resume instructions* point at the pending doc (`Read <home>/docs/handoffs/<doc> first`) rather than restating it: the doc is the single copy of the continuation. When the doc the pointer names is **consumed** — by any session, which step 7.2 deletes once the peer guard allows — or is **missing** (the scan's `pointer missing` note), the pointer goes with it: step 4 writes real resume instructions again.

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
- **Never touch a branch**: close never merges, pushes, rebases or deletes a branch — `repo-state.sh` only reads local refs; an unmerged branch is reported and, if untracked, proposed as a task.
- **Don't save ephemeral conversation context** as memory. The bar is: non-obvious, reusable, verified. When in doubt, NOOP — the four-verb triage makes "don't save" a first-class outcome.

## Process

1. **Determine the working context**:
   - Active thread (per "Identify the active thread" above).
   - Workspace (CWD).
   - Recent project files touched (look at file reads / writes in this session).

2. **Check git state**:
   - `git -C ~/repos/workspaces status --short` — identify which modified files were actually touched in this session vs stale from prior threads. Only session-changed files are in scope.
   - If session is in `ops-workspace`, also `git -C "<vault-path>" status --short` — same filter: only files this thread touched.
   - Run the handoff scan from § The handoff owns the continuation, with its `slug`, `shared` and `pointer` inputs set. Record: pending doc(s) for this thread, consumed doc(s), the legacy/unknown count per scanned directory, the directories scanned (the `# scanned` stderr lines), and any `handoff-scan:` stderr note.
   - **Failure path.** If the scan exits non-zero, record `scan failed` and its stderr, and then: no `<home>` is guessed; step 7.2 does nothing for handoff docs; § The handoff owns the continuation is not applied, so vault-task candidates reach the menu as they would with no doc pending; and step 8's `handoff: scan failed` line makes the gap visible.
   - **Repo state.** Is the CWD's repo sitting on a feature branch with unmerged commits? The check reads local refs only and never calls the network: the default branch is the local `origin/HEAD` symref, never a guessed name. Run it as one Bash call:

     ```bash
     # thread:repo-state (extracted and run by tests/repo-state.test.sh)
     rs="${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/repo-state.sh"
     if [ ! -f "$rs" ]; then echo "repo-state: script not found at $rs (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
     bash "$rs"
     # end thread:repo-state
     ```

     Only rc 0 with empty stdout means nothing to flag. Any non-zero exit (the guard's 2, or the script's 2 or 3) is recorded as `check failed` with the first stderr line — it is **never read as "no feature branch"**. rc 0 with a line is one of two forms. An `on <branch>, <N> commit(s) unmerged to <default>` line runs the tracked-task search below, in one Bash call prefixed with `br='<branch>'` (shell state does not persist between calls). The `on <branch>, default branch unresolved — unmerged check skipped` line runs no search and is report-only.

     ```bash
     # thread:repo-track (extracted and run by tests/repo-state.test.sh)
     rt="${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/repo-track.sh"
     if [ ! -f "$rt" ]; then echo "repo-track: script not found at $rt (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
     br="${br:-}" bash "$rt"
     # end thread:repo-track
     ```

     The search is `command grep -rlF` (a fixed string, every `.md` under the task directory, subfolders included), then two filters per hit: the front-matter `status:` is `open` or `in_progress`, and the branch appears as an exact token — `feat/x` does not match `feat/x-2`, `feat/xy` or `feat/x.1`, but does match `` `feat/x` ``, `origin/feat/x` or a sentence-final `feat/x.`. `command` matters: in the Claude Code Bash tool `grep` (like `rg`) is a shell-snapshot function that runs ugrep with `--ignore-files --hidden -I --exclude-dir=.git`, so it would honour a `.gitignore` under the task tree; `command grep` runs the system binary the tests cover. rc 0 with a name → **tracked** by that task (the first by sorted name when several match); rc 0 and empty → **untracked**; any non-zero (no task directory on this host, `br` unset, a grep error such as an unreadable file) → `tracking unknown` with its first stderr line, report-only and never a candidate — never read as "untracked".

3. **Scan the conversation** for the seven categories above.

4. **Compute the thread-update diff** (if a thread is active):
   - Where-we-are: rewrite if state advanced; keep if not.
   - What's-built/decided: append new items.
   - Open questions: resolve answered ones (move to "decided"), add new ones.
   - Known quirks: append discoveries from this session.
   - Resume instructions: update if next-session entry-point shifted; when a handoff doc is pending, the entry point is `Read <home>/docs/handoffs/<doc> first` — a pointer, never a copy. When the doc the Resume instructions point at is consumed, by any session (step 7.2 deletes it once the peer guard allows), or is missing (the scan's `pointer missing` note), replace the pointer with real instructions, written from the doc before step 7.2 runs.
   - Session log: prepend `- YYYY-MM-DD: <one-line of what shifted>` (newest first).
   - Thread state: apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's close row — `last_touched:` and, for a shared thread, the INDEX line's `last:` set to today; `state: done` and the INDEX line's move to `## Done` only on Lachy's explicit word that the thread is finished. `/thread:open save` runs this same step.

5. **Compute the full save set silently** — no "proposed plan" message. Work out: the auto-commit file lists, the thread diff, each memory candidate's verb (via the four-verb triage), knowledge edits, process-observation candidates (category 7, with the METHOD.md path the routing test resolved — or NOOP), the pending handoff doc's refresh diff (§ The handoff owns the continuation — or `unchanged`), vault-task candidates (loose ends only while a handoff doc is pending), including the repo-state candidate (step 2), and what's being discarded. Nothing is shown to Lachy until the report in step 8 — except the task menu, if there is one.

6. **Vault tasks only — collect approval via `AskUserQuestion`.** If (and only if) there are proposed vault tasks: one multiSelect question, one option per task (`label` = short title, `description` = the one-line why). A single task candidate gets an explicit second option (`Skip — don't create it`) to satisfy the ≥2-option minimum. More than 4 candidates: collapse per `_shared/knowledge/triage-batching-protocol.md` §6 (*Save all N* / *Save core set* / *Skip section* / named subset). Zero task candidates — including when every candidate was continuation folded into a pending handoff doc — → no menu at all; go straight to step 7. Ticked → create in step 7; unticked → discard silently; "Other" free-text → treat as a redirect. An **untracked unmerged** branch from step 2's repo-state check is a vault-task candidate (`label` like `Merge or retire <branch>`, `description` = the repo-state line) and, like every vault-task candidate, goes through rule 1 of § The handoff owns the continuation: when a pending handoff doc's § What remains already covers merging or retiring `<branch>`, it is continuation — the doc is its destination and no task is proposed — otherwise it is a loose end and reaches the menu; with the handoff scan failed, step 2's failure path applies (rule 1 is not applied) and it reaches the menu. A tracked branch is never a candidate, and the unresolved line, `check failed` and `tracking unknown` are report-only and never a candidate.

7. **Execute.** Order:
   1. Thread update — write THREAD.md (the most important file). When the active THREAD.md is a repo thread (a path `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Repo-thread lookup lists with `slug=` empty), **whichever rung resolved it**, commit it in the repo that holds it, by pathspec per "Commit hygiene" below: (a) `top=$(git -C "$(dirname <path>)" rev-parse --show-toplevel)`, never the CWD's toplevel; on failure → `not versioned: <path> (not a git repo)`. (b) Scan `git -C "$top" diff --cached --name-only` first, per "Commit hygiene". (c) A stricter form of sub-step 2's guard — it adds `rebase-apply` and locates each marker through git rather than under `.git/`: a half-applied operation (`rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD` or `BISECT_LOG`, each tested as `[ -e "$(git -C "$top" rev-parse --path-format=absolute --git-path <name>)" ]`, so a linked worktree works too) or a detached HEAD → `not versioned: <path> (<reason>)`, the edit left in the tree. `--path-format=absolute` is load-bearing: without it a main worktree prints `.git/<name>`, relative to `$top`, and the existence test would check the CWD's repo instead — wrong exactly when rung 2 resolved another repo's thread or the CWD is a subdirectory of `$top`. (d) `git -C "$top" add -- <path>`; on failure, `git -C "$top" check-ignore -q -- <path>` succeeding → `not versioned: <path> (ignored)`, otherwise `not versioned: <path> (add failed: <first stderr line>)`. (e) `git -C "$top" diff --cached --quiet -- <path>` exits 0 → `unchanged`, no commit. (f) Otherwise `git -C "$top" commit -m "📝 docs(thread): close-out — <one line>" -- <path>` (`save — <one line>` under `/thread:open save`); a failure → `not versioned: <path> (commit failed: <first stderr line>)`.
   2. Handoff lifecycle, each doc in **its own** repo — every git command is `git -C "$(dirname <doc>)"` (it resolves the containing repo from any subdirectory), by pathspec per "Commit hygiene" below: one file per commit, on the branch the work is on, and nothing else in that repo. That covers a doc outside `<home>`, such as the Resume-pointer doc at a consumer home in another repo. A pending doc for this thread: apply the refresh diff, then `git -C "$(dirname <doc>)" commit -m "📝 docs(handoff): refresh <slug> at close" -- <abs path>`; skip when `unchanged`. **For every consumed doc, including one this session marked**, first run the peer guard's snippet (`handoff-lifecycle.md` § Close-out) with `f=<abs path>` — the pointer doc a producer-side close finds consumed included. `keep missing` → no git command; report `already gone` (both rules); a later `git rm -f` that reports its pathspec did not match (the doc vanished after the snippet ran) is treated the same way. Otherwise the doc is deleted in its own repo when this session marked it (`keep fresh` or `delete`), and when it did not, only when the output is `delete` and no harness-listed session *other than this one or a subagent it spawned* has a cwd inside the doc's `<home>` or inside the directory on the doc's ``**Run from:**`` line (a doc without that line matches on `<home>` alone; a clean or unavailable listing is no evidence, a row with no cwd is ignored). The listing is `list_agents` on Codex; on Claude the close **skips the `ListAgents` call**, because its rows carry no cwd as of 2026-09-25 and so cannot change the outcome (`handoff-lifecycle.md` § Close-out, **Listing rows with no cwd.**). `keep fresh`, or a positive listing → leave the doc in place, uncommitted, and report it; a doc that is both reports `left for live peer <session>` (step 8), which carries more than its age. To delete: `git -C "$(dirname <doc>)" rm -f <abs path>` (`-f` — the consumed mark is an uncommitted local modification, and plain `git rm` refuses it) then `git -C "$(dirname <doc>)" commit -m "🔧 chore(handoff): <slug> consumed — delete (history keeps it)" -- <abs path>`; a consumed doc that was never committed (handoff wrote it on a detached HEAD) is plain-`rm`'d and reported `not versioned: <path> (never committed)`. If that doc's repo has a half-applied git operation (`rebase-merge`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG` under `.git/`) or a detached HEAD, do not commit: leave the edit in place and report `not versioned: <path> (<reason>)`. When the doc's path is under `~/repos/workspaces` and the guard allowed the deletion, sub-step 7's auto-commit carries the deletion instead; a doc the guard kept is **not** carried — this session did not change it, and its uncommitted consumed mark belongs to the peer. After a failed scan (step 2) this sub-step does nothing for handoff docs.
   3. Workspace knowledge edits.
   4. Process-observation candidates — append to the `METHOD.md` the routing test resolved, per the Destinations row. Skip when category 7 resolved to NOOP. Commit the append immediately per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md` § One commit rule, with the add-then-pathspec form in "Commit hygiene" below. Sub-step 7's workspaces auto-commit then finds a seat or estate ledger already committed.
   5. Auto-memory via the four verbs + MEMORY.md index updates. Honour the scope hook per "Memory scope discipline" — redirect or NOOP, autonomously.
   6. Approved vault tasks: new files at `vault/Work/Tasks/<slug>.md` with Task frontmatter.
   7. **Auto-commit workspaces repo** — see "Commit hygiene" below. Never ask.
   8. **Auto-commit vault repo** (if ops-workspace and session-changed files exist there) — same rules.

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

8. **Print the "What landed" report** (≤12 lines): thread-state pointer (e.g. `THREAD.md updated · state: active · open questions: 2`), for a repo thread followed by its step-7.1 commit (`THREAD.md: <sha> in <top> | unchanged | not versioned: <path> (<reason>)`), memory verbs with paths (`ADD feedback_x.md (provisional)` / `UPDATE reference_y.md` / `SUPERSEDE a.md → b.md` / `NOOP: <reason>`), knowledge edits, any METHOD.md candidate append, at any altitude (file path + the observation in one line — the project ledger lands outside the workspace and vault, and the seat/estate ledgers are doctrine surfaces; neither is ever silent), handoff rows — never silent when a doc exists — `handoff pending: <path> · written <date> · written this session | refreshed (<what changed>) | unchanged · continuation: <N> candidate(s) kept in the doc (<K> added this close), none proposed`, `handoff consumed: <path> · deleted in <sha>`, `handoff consumed: <path> · left for its consumer (marked <age> ago)`, `handoff consumed: <path> · left for live peer <session>`, `handoff consumed: <path> · already gone (removed by another close)` — `<age>` is whole hours since the doc's mtime, `$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h` (BSD and GNU `date` both take `-r <file>`), run as `f='<abs path>'; echo "$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h"` in one Bash call, like the guard snippet, since shell state does not persist between calls, so a kept-fresh doc reads `0h`–`23h`, one `handoff legacy: <N> doc(s) in <dir> (no or unknown front matter — untouched)` line per scanned directory whose count is non-zero, `handoff: none in <dirs scanned>` when the scan printed nothing and exited 0 (so a scan that ran reads differently from one that did not), `handoff pointer: <p> missing | not absolute` for a pointer note, and — when the scan failed — `handoff: scan failed (<stderr>) — lifecycle not run, no <home> guessed` in place of every other handoff row, never `handoff: none in …`, the repo-state row from step 2 — `Repo state: <line> — tracked by [[<task>]]`, `Repo state: <line> — not tracked by any open task`, `Repo state: <line> — not tracked by any open task · continuation in <handoff doc path>` (rule 1 of § The handoff owns the continuation folded it into a pending doc), `Repo state: <line> — tracking unknown (<first stderr line>)`, `Repo state: <line> — run \`git remote set-head origin --auto\` once in this repo to enable the check` for the unresolved line when the repo has an `origin` remote, `Repo state: <line> — no origin remote, check skipped` for the unresolved line when it has none (§ Edge cases), or `Repo state: check failed (<first stderr line>)`, and no row when the check printed nothing and exited 0 — vault task files as clickable `[[wiki-links]]`, the one-line research-landing offer when a created task carries an unlanded Lean-capture research pointer — a THREAD.md section or `left in conversation`, never for an already-landed digest (`task-writer.md` § 5 **Lean capture**; never blocks the close), commit SHAs for all repos touched, any `not versioned: <path> (<reason>)` line from a failed stage (see Commit hygiene), any `redirected:` or `Needs your call:` lines, and a one-line discard note.

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
- **A handoff doc is pending but this session's work was unrelated to it.** The refresh finds nothing to add; the doc is left byte-identical and reported `unchanged`; loose ends reach the menu as normal.
- **A consumed handoff doc left by a session that died before its close** → deleted once the peer guard allows, at the latest by the first close after 24 h with no listed peer in its `<home>` or `Run from:` directory (consumed is decided on disk; the dead session's own uncommitted work, not the doc, is where its state sits, and SessionStart flags that as stale).
- **Unsure whether this session marked a consumed doc** (after a compaction) → treat it as not its own; it lingers until a later close the peer guard allows (`handoff-lifecycle.md` § Close-out).
- **A consumed doc this session marked but another close already removed** (a long-running consumer the listing missed) → the guard prints `keep missing`: `already gone`, no git command.
- **A legacy handoff doc** (no `status:` front matter — written before ADR 0017) → counted on the `handoff legacy:` line; never refreshed, deleted or used to suppress. If it is plainly this thread's continuation and Lachy wants it in the lifecycle, he adds the front matter; close never guesses.
- **A handoff doc's repo mid-rebase / mid-merge / detached HEAD** → that doc's handoff-lifecycle commit is skipped with a `not versioned:` line; the edit stays in the tree for the next close.
- **The resolver cannot run** (`CLAUDE_PLUGIN_ROOT` unset, a stale plugin cache, another host) → the scan exits 2; step 2's failure path applies and step 8 prints `handoff: scan failed (…)`. Close never falls back to a hand-resolved `<home>`.
- **A squash- or rebase-merged branch, or a stale local `origin/<default>`** (close never fetches) → the repo-state line still reads `unmerged to <default>`: the count is commits on HEAD not reachable from the base ref, and a squash or rebase rewrites them. The caveat lives here only; the line's wording stays exactly `unmerged to <default>`.
- **Default branch unresolved** (no local `origin/HEAD` — the common case for a repo that pushed its first branch, and for many https origins) → the unresolved line, on the default branch too, and step 8's row carries the one-time fix, `git remote set-head origin --auto`. Close never guesses `main` or `master`, and never treats the unresolved line as a candidate.
- **A repo with no `origin` remote** (a local-only repo, or one whose remote has another name) → the same unresolved line, on every close. The set-head hint applies only when an `origin` remote exists: there it would fail with `No such remote 'origin'`. Tell the two apart with one read-only `git remote` call when the unresolved line appears, and print `Repo state: <line> — no origin remote, check skipped` without the hint. The script's output does not change.
- **A repo git refuses to open** (dubious ownership under `safe.directory`, an unreadable `.git`) or any other git failure → `Repo state: check failed (…)`, never silence. A corrupt `.git/HEAD` is reported by git itself as "not a git repository", so the check stays silent there; git gives no way to tell the two apart.
- **Detached HEAD, an unborn branch, a bare repo, or no git repo at the CWD** → the repo-state check has nothing to report.
- **The branch's task search** matches the branch as an exact token in an `open` or `in_progress` task (`status: review` or `blocked` does not count); several hits → the first by sorted name. A missing task directory (a host without the vault) or a failed grep → `tracking unknown`, never "untracked", never a candidate.
- **Not inside `~/repos/workspaces/`.** Skip the workspaces-commit step; everything else still applies.
- **A slug naming another tool repo's thread** → rung 2 resolves it and step 7.1 commits it in *that* repo's `<top>`; the handoff scan's `<home>` is still resolved from the CWD.
- **A slug with no match** → rung 4 (offer to create), never rung 3: the CWD repo's THREAD.md is not written under a name that does not exist.
- **A repo thread with no front matter** (`~/repos/tools/maquette/THREAD.md`) → matched by its directory's basename, which is its effective slug; close never adds front matter to it (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state).
- **A `_shared` or `~/Projects` thread with the same slug as a repo thread** → the `_shared` or `~/Projects` one wins; the lookup stops at the first tier with a hit.
- **Closing from a `.claude/worktrees/<w>` copy** → rung 3 never matches (the lookup excludes it twice over); rungs 4 and 5 apply.
- **A repo thread's repo mid-rebase, mid-merge or on a detached HEAD** → the step-7.1 commit is skipped with a `not versioned:` line; the edit stays in the tree for the next close.
- **A repo thread this session did not change** → step 7.1 reports `unchanged` and makes no commit; a `/thread:open save` followed by a close finds it unchanged unless the work moved on.
- **A listed THREAD.md outside git** → written, then reported `not versioned: <path> (not a git repo)`.
- **No active thread, no project context.** That's fine — skip thread-update, still run the rest of the triage. Offer to create a thread if the conversation looks worth one.

## Why this exists

Threads routinely end with valuable state only in the conversation — open questions, rationale behind a pivot, a concrete next step that never made it to disk. Without a close ritual, that state evaporates and the next session re-derives it from scratch. `thread:close` is the ritual: triage, route, persist, commit, done. The approval gate moved from save-time to curation-time (ADR 0011): saves are cheap and reversible, so the weekly curator — not a menu — is what keeps memory clean. A pending handoff doc is the one narrowing of that gate: it is already the tracker for the thread's continuation, so close refreshes it rather than proposing a second (ADR 0017).
