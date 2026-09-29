---
name: close
description: 'End-of-thread capture — update the active thread (project THREAD.md or shared _shared/threads/<slug>.md) with what happened this session, then save the rest autonomously: auto-memory (save-time triage, provenance-stamped), workspace knowledge, process-observation candidates to the METHOD.md the altitude routing test resolves (project, seat or estate), and git commits all happen without asking, and it lands its own close-out commits without asking too (pushes them, opens a `landing` PR and queues auto-merge, never waiting; ADR 0028); vault tasks are the only proposal. Available globally — works from any CWD. Use when the work is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it''s being set down for later use thread:stash or thread:defer. Invoke with `/thread:close` or "close this thread".'
---

# /thread:close — close out this thread

End-of-thread capture. The thread is about to end — make sure nothing valuable is lost. Triage what happened in this conversation and route each piece to exactly one destination.

**The active thread is always the primary destination.** Update its `THREAD.md` first; everything else (vault tasks, memory, etc.) is supporting capture.

**Everything saves autonomously except new vault tasks and unproven completions.**

- **Auto-execute, no asking**: git commits in `~/repos/workspaces/` and the Obsidian vault (session-changed files only) plus the handoff docs, each by pathspec in its own repo (§ The handoff owns the continuation), a tool repo's own `THREAD.md`, by pathspec in the repo that holds it (step 7.1), the landing of those close-out commits (**Land the close-outs**, ADR 0028: push, `landing` PR, queued auto-merge, no waiting), the thread update, the guarded flip of a finished task (§ A finished task closes itself), auto-memory entries (via the save-time triage below), and workspace knowledge edits. The safety net that replaced per-item approval sits downstream, not in a menu: auto-memory lands `provisional` with provenance, nothing is ever hard-deleted, and the weekly memory curator archives what turns out to be junk (ADR 0011).
- **Propose first, then wait**: new vault tasks, and a mark-done option for a worked task the guard cannot prove, except the execute-owned and partly-landed tasks that § A finished task closes itself reports instead of asking about (ADR 0026). Tasks surface on Lachy's daily agenda, so a junk task has ongoing attention cost — "don't create tasks unsolicited" survives as the approval gate for new tasks.

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
| An existing vault task this session finished | `status: done` + `completed: <today>` (set or replaced, never duplicated) on that task — § A finished task closes itself | Auto within the guard, else **Propose** (mark-done option) |
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

1. **Scope is the line.** For each vault-task candidate ask one question: *would the next session, working from this doc, do it?* Yes → it is **continuation**, and the doc is its only destination. No → it is a **loose end** — a malformed vault note to rename, a supplier to chase, anything the thread's `scope:` line does not cover — and it reaches the task menu exactly as before. The doc's own title and § What remains decide the question, not who asked for the handoff.
2. **Refresh, don't restate — continuation only.** Re-read the doc's § What remains and § Paste-ready prompt against **category 3** of the scan. A remaining item this session completed moves to § Done and verified; a next step the doc lacks is added; a next move that has moved on is rewritten; add `refreshed: <today>` to the front matter (the optional key handoff's contract reserves for this) and commit the file by pathspec in its own repo (step 7.2). Categories 1, 2, 4 and 5 land in THREAD.md exactly as before — the doc is refreshed for continuation, never as a second state record, so every candidate still has one destination. This is the whole handling for a handoff written mid-session and then overtaken by hours of further work: the doc stays the one true object instead of the menu quietly growing a second one. A doc the scan finds nothing to change is left byte-identical and reported `unchanged`.
3. **No annotation, no asking.** Never label a candidate "already in the handoff", never ask whether he has done it. Both hand back a decision the rule has already made. The report row in step 8 is the visibility — it carries the doc's `written:` date, so a handoff that has sat pending for weeks is visible at every close without a TTL deciding for him.

A **manual handoff** is a complete handoff for this rule (`handoff-lifecycle.md` § While pending); a handoff **withdrawn in the same session** is no handoff at all, and close finds nothing pending (`handoff-lifecycle.md` § Withdrawn).

THREAD.md is updated as normal — state, decisions, quirks, session log — but its *Resume instructions* point at the pending doc (`Read <home>/docs/handoffs/<doc> first`) rather than restating it: the doc is the single copy of the continuation. When the doc the pointer names is **consumed** — by any session, which step 7.2 deletes once the peer guard allows — or is **missing** (the scan's `pointer missing` note), the pointer goes with it: step 4 writes real resume instructions again.

## A finished task closes itself

ADR 0026 § Decision 4 amends ADR 0011 for one case: close marks an existing vault task `done` without asking only when all three conditions hold. A worked task that fails any condition becomes a mark-done option in step 6's question, never a silent flip. Every flip is reported in step 8 with a one-line reason. New tasks stay gated exactly as before. Close never searches the vault for tasks that look finished (that is orient's drift reconcile). It judges only the tasks this session worked.

**Candidates.** A task note under `~/repos/obsidian/Work/Tasks/` (never `Archive/`) at `status: open`, `in_progress` or `review` that this session worked. Worked means this session did the task's own work: it made the change the task describes, or ran the checks the task is about. A bare mention in chat is not work. Bookkeeping writes (orient's reshuffle, `/thread:schedule`'s `wave:` stamps, reconcile writes, slot fills, frontmatter edits) never make a task a candidate: a note this session only touched that way gets no flip, no mark-done option and no row. A task at any other status (`done`, `blocked`, `parked`) is not a candidate and gets no row. Three exclusions apply to candidates, in this order, and the first that matches decides:

- A candidate with `owner:` set whose `rollout:` link resolves to a note directly in `Work/Tasks/` (a live rollout, as `reconcile-project.py` defines one) is execute's to close. It gets no flip and no question, and step 8 reports `task left for execute: [[<task>]]` for a task under a live rollout.
- A candidate only partly landed (an unchecked `- [ ]` item in its note, or a Notes item not yet done) is neither flipped nor asked about. Step 8 reports `task flip skipped: [[<task>]] partly landed (<what remains>)`, so a box the session forgot to tick is visible.
- A task at `review` with no live rollout owner is never flipped: it becomes a mark-done option, because the confirmation it awaits is exactly that question.

**Condition 1 — explicitly working it.** One of four routes, each naming the task by its exact filename stem or path: (a) open's `[[<task>]]` pickup ran on this task, whether typed as `/thread:open [[<task>]]` or run by orient's Hands-on steer; (b) orient's Hands-on steer picked this task note as its focus item, by either branch (open's pickup, or following its `## Launch` / `## Resume prompt`; `${CLAUDE_PLUGIN_ROOT}/skills/orient/SKILL.md` § 6); (c) this session picked up a capture (`/thread:open [[<capture>]]`, or its pasted `## Resume prompt`, whose first instruction closes it) or a handoff doc (`/thread:open <doc>`, or the doc's prompt-carried first instruction) whose brief names this task as the work, meaning the capture's `## Resume prompt` or the doc's Paste-ready prompt links it by wikilink or path. Such a task counts as opened from it; a task named only elsewhere in the capture or doc does not; (d) the active THREAD.md, as it stood before this session's first write to it, names the task in Where we are, Next steps or Resume instructions as the thread's current work, and this session's work finished it. That text is the THREAD.md this session read before writing to it (open's briefing, or an earlier Read). It is judged before this close, never against this close's own step-4 diff or step-7.1 write. Lines written by an earlier `/thread:open save` in this session never count either: they are close's own flow certifying itself. A task matched by topic or similarity never satisfies condition 1.

**Condition 2 — landed on the default branch.** A code task is one whose work changed files in a git repo other than the vault and `~/repos/workspaces`, which close commits itself. For a code task, re-check at close, read-only. Either `gh pr view <url> --json state,headRefOid` prints `MERGED` for the PR carrying the work (the task's `pr:`, or the PR this session opened), or `git -C <repo> merge-base --is-ancestor <commit> refs/remotes/origin/<default>` exits 0 for the commit the Verify run tested, with `<default>` read from the local `origin/HEAD` symref as `repo-state.sh` reads it. An open PR or an unmerged branch fails condition 2, and so do a `gh` error and an unresolved default branch. Close never merges, pushes or fetches to prove it. When the task is not a code task, condition 2 holds. When unsure whether it is one, treat it as a code task.

**Condition 3 — its Verify line ran green.** The task's own `**Verify:**` line (orient's reshuffle writes one on every task). Every check it names ran this session after the last change to the work, and passed. Re-running it at close counts. The tested commit is the one holding exactly the tree the run passed on, so committing the tested edits unchanged is not a change. The landing itself is not a change to the work either: a merge or squash commit does not count when the merged PR's `headRefOid` is the commit the Verify run tested, or when that tested commit is itself an ancestor of `origin/<default>`. A commit pushed after the run is a change, and so is a merge conflict this session resolved by hand. No Verify line fails condition 3, and so do a check the agent cannot run (Lachy's confirmation, a device test), a run before a later edit, and a failing or skipped check.

**Evidence, not memory.** Condition 2 is re-checked by command at close. Conditions 1 and 3 rest on this session's own tool calls and messages, visible verbatim in the context. When a condition's evidence survives only in a compaction summary, or is otherwise uncertain, that condition fails and the task goes to the mark-done question. It never flips automatically.

**The write.** A flip, or a ticked mark-done option, sets `status: done` and sets (or replaces) `completed: <today>`: a `completed:` key already on the task, blank or stale (a hand-made, TaskNotes-edited or reopened task), is overwritten in place, as `reconcile-project.py` does, and never duplicated; with none, the key goes directly after `status:`. It is a field edit on an existing task, not a new task, and `/thread:open save` runs it too. The flip set is fixed at the head of step 4, before step 4 writes the Resume instructions and before step 6 asks: condition 1 is judged on this session's pickups and, for route (d), on the pre-close THREAD.md; condition 2 by command; condition 3 on this session's runs. Nothing steps 4–5 compute can change it. A flipped task is never the next task: step 5's next-task match (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4b, close's form) skips it and tries the rule after, and step 4's Resume instructions never name it as the next step. A mark-done option ticked in step 6 is dropped from both the same way before step 7.1 writes THREAD.md. Step 7.6 writes the flips and ticked options first, before the new tasks and before the set-down. It never touches a phase note: closing a finished phase is execute's ceremony and orient's drift fix.

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
- **Don't create tasks unsolicited** — propose them, let Lachy approve. A guarded flip (§ A finished task closes itself) creates nothing: it closes an existing task, and anything short of the guard is asked about.
- **Own work only**: close pushes only its own close-out commits, through land.sh (§ Land the close-outs), to the default branch or to a `close/…` branch it creates. It never force-pushes, rewrites a local merge, deletes a branch, or fetches into or moves a branch other than the default. Another session's branch is still only reported: `repo-state.sh` only reads local refs; an unmerged branch is reported and, if untracked, proposed as a task.
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

     The search is `command grep -rlF` (a fixed string, every `.md` under the task directory, subfolders included), then two filters per hit: the front-matter `status:` is `open` or `in_progress`, and the branch appears as an exact token — `feat/x` does not match `feat/x-2`, `feat/xy` or `feat/x.1`, but does match `` `feat/x` ``, `origin/feat/x` or a sentence-final `feat/x.`. `command` matters: in the Claude Code Bash tool `grep` (like `rg`) is a shell-snapshot function that runs ugrep with `--ignore-files --hidden -I --exclude-dir=.git`, so it would honour a `.gitignore` under the task tree. `repo-track.sh` runs in its own `bash`, which that zsh function does not reach; it keeps `command grep` anyway, so no grep function can ever stand in for the system binary the tests cover. rc 0 with a name → **tracked** by that task (the first by sorted name when several match); rc 0 and empty → **untracked**; any non-zero (no task directory on this host, `br` unset, a grep error such as an unreadable file) → `tracking unknown` with its first stderr line, report-only and never a candidate — never read as "untracked".

3. **Scan the conversation** for the seven categories above.

4. **Compute the thread-update diff** (if a thread is active):
   - Flip set, first, whether or not a thread is active: fix the flip set and the mark-done options first (§ A finished task closes itself), before any bullet below, so the Resume instructions are written against a known flip set.
   - Where-we-are: rewrite if state advanced; keep if not.
   - What's-built/decided: append new items.
   - Open questions: resolve answered ones (move to "decided"), add new ones.
   - Known quirks: append discoveries from this session.
   - Resume instructions: update if next-session entry-point shifted, never naming a task in the flip set as the next step (§ A finished task closes itself); when a handoff doc is pending, the entry point is `Read <home>/docs/handoffs/<doc> first` — a pointer, never a copy. When the doc the Resume instructions point at is consumed, by any session (step 7.2 deletes it once the peer guard allows), or is missing (the scan's `pointer missing` note), replace the pointer with real instructions, written from the doc before step 7.2 runs.
   - Session log: prepend `- YYYY-MM-DD: <one-line of what shifted>` (newest first).
   - Thread state: apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's close row — `last_touched:` and, for a shared thread, the INDEX line's `last:` set to today; `state: done` and the INDEX line's move to `## Done` only on Lachy's explicit word that the thread is finished. `/thread:open save` runs this same step.

5. **Compute the full save set silently** — no "proposed plan" message. Work out: the auto-commit file lists, the thread diff, each memory candidate's verb (via the four-verb triage), knowledge edits, process-observation candidates (category 7, with the METHOD.md path the routing test resolved — or NOOP), the pending handoff doc's refresh diff (§ The handoff owns the continuation — or `unchanged`), the set-down's next task (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4b, close's form — its `captures --for-close` run is here, before sub-step 7.6 creates any task; it skips the flip set), the flip set and the mark-done options as step 4 fixed them (§ A finished task closes itself), vault-task candidates (loose ends only while a handoff doc is pending), including the repo-state candidate (step 2), and what's being discarded. Nothing is shown to Lachy until the report in step 8 — except the task menu, if there is one.

6. **Vault tasks and mark-done options only — collect approval via `AskUserQuestion`.** If (and only if) there are proposed vault tasks or mark-done options: one multiSelect question per kind, both in the one `AskUserQuestion` call — new vault tasks first, one option per task (`label` = short title, `description` = the one-line why), then the mark-done options (§ A finished task closes itself), one per task (`label` = `Mark <short title> done`, `description` = the failing condition and why, e.g. `fails condition 2: PR #58 open`). A single task candidate gets an explicit second option (`Skip — don't create it`) to satisfy the ≥2-option minimum, and a lone mark-done option gets `Skip — leave it open`. More than 4 options of one kind: collapse that question per `_shared/knowledge/triage-batching-protocol.md` §6 (*Save all N* / *Save core set* / *Skip section* / named subset; for mark-done options *Mark all N done* / *Mark core set done* / *Skip section* / named subset). A mark-done option is never merged into the new-task question, so ticking *Save all N* never marks a task done. Zero task candidates and zero mark-done options — including when every candidate was continuation folded into a pending handoff doc — → no menu at all; go straight to step 7. Ticked → create in step 7, or for a mark-done option the flip in sub-step 7.6; unticked → discard silently, and an unticked mark-done option leaves its task as it is; "Other" free-text → treat as a redirect. An **untracked unmerged** branch from step 2's repo-state check is a vault-task candidate, and so is a tracked one whose tracking task is in the flip set, because the flip leaves the branch with no open tracker (`label` like `Merge or retire <branch>`, `description` = the repo-state line) and, like every vault-task candidate, goes through rule 1 of § The handoff owns the continuation: when a pending handoff doc's § What remains already covers merging or retiring `<branch>`, it is continuation — the doc is its destination and no task is proposed — otherwise it is a loose end and reaches the menu (rule 1 filters new-task candidates only: a mark-done option is never continuation); with the handoff scan failed, step 2's failure path applies (rule 1 is not applied) and it reaches the menu. Any other tracked branch is never a candidate, and the unresolved line, `check failed` and `tracking unknown` are report-only and never a candidate.

7. **Execute.** Order:
   1. Thread update — write THREAD.md (the most important file). When the active THREAD.md is a repo thread (a path `${CLAUDE_PLUGIN_ROOT}/skills/open/SKILL.md` § Repo-thread lookup lists with `slug=` empty), **whichever rung resolved it**, commit it in the repo that holds it, by pathspec per "Commit hygiene" below, through § Land the close-outs: (a) `top=$(git -C "$(dirname <path>)" rev-parse --show-toplevel)`, never the CWD's toplevel; on failure → `not versioned: <path> (not a git repo)`. (b) Scan `git -C "$top" diff --cached --name-only` first, per "Commit hygiene". (c) A stricter form of sub-step 2's guard — it adds `rebase-apply` and locates each marker through git rather than under `.git/`: a half-applied operation (`rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD` or `BISECT_LOG`, each tested as `[ -e "$(git -C "$top" rev-parse --path-format=absolute --git-path <name>)" ]`, so a linked worktree works too) or a detached HEAD → `not versioned: <path> (<reason>)`, the edit left in the tree. `--path-format=absolute` is load-bearing: without it a main worktree prints `.git/<name>`, relative to `$top`, and the existence test would check the CWD's repo instead — wrong exactly when rung 2 resolved another repo's thread or the CWD is a subdirectory of `$top`. (d) `git -C "$top" add -- <path>`; on failure, `git -C "$top" check-ignore -q -- <path>` succeeding → `not versioned: <path> (ignored)`, otherwise `not versioned: <path> (add failed: <first stderr line>)`. (e) `git -C "$top" diff --cached --quiet -- <path>` exits 0 → `unchanged`, no commit. (f) Otherwise hand `<path>` to § Land the close-outs, which commits it in the one landing call for `$top` at the end of sub-step 7.2, under the subject `📝 docs(thread): close-out — <one line>` (`📝 docs(thread): save — <one line>` under `/thread:open save`). Never call land.sh from this sub-step.
   2. Handoff lifecycle, each doc in **its own** repo — every git command is `git -C "$(dirname <doc>)"` (it resolves the containing repo from any subdirectory), by pathspec per "Commit hygiene" below. Each doc change is staged, then handed to landing (§ Land the close-outs): one commit per repo, on its current branch, holding that repo's handed paths and nothing else. That covers a doc outside `<home>`, such as the Resume-pointer doc at a consumer home in another repo. A pending doc for this thread: apply the refresh diff, then hand `<abs path>` to landing; skip when `unchanged`. **For every consumed doc, including one this session marked**, first run the peer guard's snippet (`handoff-lifecycle.md` § Close-out) with `f=<abs path>` — the pointer doc a producer-side close finds consumed included. `keep missing` → no git command; report `already gone` (both rules); a later `git rm -f` that reports its pathspec did not match (the doc vanished after the snippet ran) is treated the same way. Otherwise the doc is deleted in its own repo when this session marked it (`keep fresh` or `delete`), and when it did not, only when the output is `delete` and no harness-listed session *other than this one or a subagent it spawned* has a cwd inside the doc's `<home>` or inside the directory on the doc's ``**Run from:**`` line (a doc without that line matches on `<home>` alone; a clean or unavailable listing is no evidence, a row with no cwd is ignored). The listing is `list_agents` on Codex; on Claude the close **skips the `ListAgents` call**, because its rows carry no cwd as of 2026-09-25 and so cannot change the outcome (`handoff-lifecycle.md` § Close-out, **Listing rows with no cwd.**). `keep fresh`, or a positive listing → leave the doc in place, uncommitted, and report it; a doc that is both reports `left for live peer <session>` (step 8), which carries more than its age. To delete: `git -C "$(dirname <doc>)" rm -f <abs path>` (`-f` — the consumed mark is an uncommitted local modification, and plain `git rm` refuses it) then hand `<abs path>` to landing; a consumed doc that was never committed (handoff wrote it on a detached HEAD) is plain-`rm`'d and reported `not versioned: <path> (never committed)`. If that doc's repo has a half-applied git operation (`rebase-merge`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG` under `.git/`) or a detached HEAD, do not commit: leave the edit in place and report `not versioned: <path> (<reason>)`. A doc reported `not versioned` is not handed. When the doc's path is under `~/repos/workspaces` and the guard allowed the deletion, sub-step 7's auto-commit carries the deletion instead; a doc the guard kept is **not** carried — this session did not change it, and its uncommitted consumed mark belongs to the peer. Neither is handed to landing. After a failed scan (step 2) this sub-step does nothing for handoff docs. **Then land — the last act of this sub-step.** After every doc above is handled, and before sub-step 3, run § Land the close-outs once per repo, with that repo's paths from sub-step 1 and this one. It also runs when the handoff scan failed, for sub-step 1's repo.
   3. Workspace knowledge edits.
   4. Process-observation candidates — append to the `METHOD.md` the routing test resolved, per the Destinations row. Skip when category 7 resolved to NOOP. Commit the append immediately per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md` § One commit rule, with the add-then-pathspec form in "Commit hygiene" below. Sub-step 7's workspaces auto-commit then finds a seat or estate ledger already committed.
   5. Auto-memory via the four verbs + MEMORY.md index updates. Honour the scope hook per "Memory scope discipline" — redirect or NOOP, autonomously.
   6. Approved vault tasks, after the flips. The guarded flips and ticked mark-done options (§ A finished task closes itself) are written first: `status: done` and `completed: <today>` on each (an existing `completed:` key replaced, never duplicated), before the new tasks and before the set-down. Then new files at `vault/Work/Tasks/<slug>.md` with Task frontmatter. Then the set-down write for the task step 5 matched — `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 4b, close's form (estate ADR 0008), through `next-action.py set-down`; with no match, nothing. Not under `/thread:open save`: a checkpoint sets nothing down. The guarded flips and ticked mark-done options do run under save. These are field edits, not new tasks, so they need no approval; they are session-changed vault files — sub-step 8 commits them in ops-workspace, and elsewhere the vault's daily sweep does (the report names the edited notes either way).
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

### Land the close-outs

Landing (ADR 0028) is how close's own close-out commits reach origin's default branch without Lachy. One shared script, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh`, commits the handed paths on the repo's current branch and lands them by the repo's own rules. A repo listed on the landing register, with no GitHub origin, swept by the daily sweep, or checked out on a branch other than origin's default is committed only. An unprotected default branch is pushed. A protected one gets the commit pushed unchanged to a `close/…` branch, a `landing` PR and auto-merge queued with a merge commit. Landing does not wait for the merge: a queued merge that fails is retried by the next close in that repo and by the daily lander.

**When.** Only at the end of sub-step 7.2, as its last act, once per repo, after every repo's handed paths are collected. Never from sub-step 7.1, and never mid-7.2.

**Collecting per repo.** A repo's handed paths are:

- 7.1's THREAD.md, unless it was `unchanged` or `not versioned`;
- 7.2's refreshed pending doc;
- 7.2's guard-allowed deletions outside `~/repos/workspaces`.

Never handed: kept docs (the peer guard left them for their consumer or a live peer, and the uncommitted consumed mark belongs to the peer), `unchanged` refreshes, workspaces deletions (sub-step 7.7 carries them) and anything reported `not versioned`.

**One call per repo.** The thread's repo gets a call whenever 7.1(a) resolved and (c) passed, even when THREAD.md is `unchanged`: a call with no paths still lands earlier stranded close-outs and retries a queued merge. Every repo holding a refreshed pending doc or a guard-allowed deletion gets one too.

**Message.** With THREAD.md among the paths, the 7.1 close-out or save subject, and the body lists any handoff changes. Otherwise, for a refresh, `📝 docs(handoff): refresh <slug> at close`. Otherwise, for a deletion, `🔧 chore(handoff): <slug> consumed — delete (history keeps it)`. `msg` is a `mktemp` file written by a quoted heredoc, so an apostrophe survives.

**Slug.** `slug` is the thread's effective slug, as the handoff scan takes it: its `slug:`, or for a repo thread without one its directory's basename. With no active thread it is empty, and land.sh falls back to the repo's basename.

Fill in `top`, `slug`, the message and `mode`, and replace `<paths>` with that repo's handed absolute paths; a repo with no paths omits `<paths>`. `mode=''` in close. Under `/thread:open save`, set `mode='--commit-only'` for every call, 7.2's other repos included: save stays commit-only (ADR 0028, Decision 6).

```bash
# thread:land (extracted and run by tests/land.test.sh)
ld="${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh"
if [ ! -f "$ld" ]; then echo "land: script not found at $ld (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
top='<top>' slug='<slug>' mode=''
msg=$(mktemp "${TMPDIR:-/tmp}/land-msg.XXXXXX") || exit 2
trap 'rm -f "$msg"' EXIT
cat > "$msg" <<'MSG'
<message>
MSG
bash "$ld" ${mode:+"$mode"} --slug "$slug" -F "$msg" -- "$top" <paths>
# end thread:land
```

**Rules.**

- Each repo's land.sh call is its own Bash tool call with timeout 600000. Never chain two repos' calls with `&&`, `;` or a loop, and never add other commands to that Bash call. Run the calls one after another.
- `top` may be a removed directory: the `docs/handoffs/` that `git rm -f` just emptied. land.sh resolves it through the nearest existing ancestor.
- land.sh prints exactly one line on stdout: `landed`, `queued <url>`, `queued: needs merge <url>`, `not landed: <reason>` or `stuck: <reason>`. It exits 0, or 1 for `stuck`. stderr carries `land: commit <sha>` (this run's commit, at its final SHA) or `land: nothing committed`, and `land: carried <N> earlier close-out commit(s)` when older close-outs went with it. Step 8 reads both.
- Landing does not wait. Nothing polls after the call, and nothing calls again to check the merge.
- A dirty or pre-staged tree is fine. Landing commits only the handed paths, never pre-staged work, and it is stuck only when origin's new changes overlap a local change.

8. **Print the "What landed" report** (≤12 lines): thread-state pointer (e.g. `THREAD.md updated · state: active · open questions: 2`), for a repo thread followed by its step-7.1 commit (`THREAD.md: <sha> in <top> | unchanged | not versioned: <path> (<reason>)`), memory verbs with paths (`ADD feedback_x.md (provisional)` / `UPDATE reference_y.md` / `SUPERSEDE a.md → b.md` / `NOOP: <reason>`), knowledge edits, any METHOD.md candidate append, at any altitude (file path + the observation in one line — the project ledger lands outside the workspace and vault, and the seat/estate ledgers are doctrine surfaces; neither is ever silent), handoff rows — never silent when a doc exists — `handoff pending: <path> · written <date> · written this session | refreshed (<what changed>) | unchanged · continuation: <N> candidate(s) kept in the doc (<K> added this close), none proposed`, `handoff consumed: <path> · deleted in <sha>`, `handoff consumed: <path> · left for its consumer (marked <age> ago)`, `handoff consumed: <path> · left for live peer <session>`, `handoff consumed: <path> · already gone (removed by another close)` — `<age>` is whole hours since the doc's mtime, `$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h` (BSD and GNU `date` both take `-r <file>`), run as `f='<abs path>'; echo "$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h"` in one Bash call, like the guard snippet, since shell state does not persist between calls, so a kept-fresh doc reads `0h`–`23h`, one `handoff legacy: <N> doc(s) in <dir> (no or unknown front matter — untouched)` line per scanned directory whose count is non-zero, `handoff: none in <dirs scanned>` when the scan printed nothing and exited 0 (so a scan that ran reads differently from one that did not), `handoff pointer: <p> missing | not absolute` for a pointer note, and — when the scan failed — `handoff: scan failed (<stderr>) — lifecycle not run, no <home> guessed` in place of every other handoff row, never `handoff: none in …`, the repo-state row from step 2 — `Repo state: <line> — tracked by [[<task>]]`, `Repo state: <line> — tracked by [[<task>]] (flipped done this close)` when that task is in the flip set (the branch is then a `Merge or retire` candidate, step 6), `Repo state: <line> — tracked by [[<task>]] (ticked done this close)` when a mark-done option for it was ticked, `Repo state: <line> — not tracked by any open task`, `Repo state: <line> — not tracked by any open task · continuation in <handoff doc path>` (rule 1 of § The handoff owns the continuation folded it into a pending doc), `Repo state: <line> — tracking unknown (<first stderr line>)`, `Repo state: <line> — run \`git remote set-head origin --auto\` once in this repo to enable the check` for the unresolved line when the repo has an `origin` remote, `Repo state: <line> — no origin remote, check skipped` for the unresolved line when it has none (§ Edge cases), or `Repo state: check failed (<first stderr line>)`, and no row when the check printed nothing and exited 0 — vault task files as clickable `[[wiki-links]]`, the next-action row from sub-step 7.6 — `next task: [[<task>]] on <Project>, … · next action: <line>` or `next task: none (no concrete next task — slots left alone)` when a thread is active, the task rows from § A finished task closes itself, all on one line, rows joined with ` · ` (none, no line): `task done: [[<task>]] (<route>; <landing evidence>; <Verify run>)`, `task done (ticked): [[<task>]]`, `task left for execute: [[<task>]]`, `task flip skipped: [[<task>]] partly landed (<what remains>)`, the one-line research-landing offer when a created task carries an unlanded Lean-capture research pointer — a THREAD.md section or `left in conversation`, never for an already-landed digest (`task-writer.md` § 5 **Lean capture**; never blocks the close), commit SHAs for all repos touched, any `not versioned: <path> (<reason>)` line from a failed stage (see Commit hygiene), any `redirected:` or `Needs your call:` lines, and a one-line discard note.

   **Landing rows** (§ Land the close-outs):

   - **`<sha>` source.** The `THREAD.md: <sha> in <top>` and `handoff consumed: <path> · deleted in <sha>` rows are filled only after that repo's landing call, from its `land: commit <sha>` stderr line: the final SHA, after any rebase. When they share a repo, they share one SHA. THREAD.md handed, `land: nothing committed` and no `stuck:` means it was already committed: `unchanged`.
   - **The landing row.** One per call: `landing <top>: <result line>`, plus ` (carried <N> earlier close-out commit(s))` when stderr has that line. No row for `landed` with `land: nothing to land`, for `not landed: swept by the daily sweep` or for `not landed: commit-only`. `not landed: no push access` does get a row, as does every other `not landed:`.
   - **`stuck:` together with `land: nothing committed`.** Nothing was committed: each handed path maps to `not versioned: <path> (<reason>)` in place of its `<sha>` row, the reason being the stuck line's text. The landing row still prints.
   - **A `dropped` path** (`land: dropped <rel> (…)`) gets no `<sha>` row; it is listed as `not versioned: <path> (not on disk)`.
   - **Any other exit, or no result line** (the guard's 2, a crash) → `landing <top>: stuck: land.sh failed (<first stderr line>)`.

9. **End with the closing banner.** After the report, add a blank line, a horizontal rule (`---`), another blank line, then exactly one of these three lines as the final line of the response, chosen by the landing rows. C beats B, and B beats A.

   - **(A)** No landing row is landed, queued or stuck (no landing call, or only `not landed:` rows):

     ```
     **Thread closed. Safe to end this session — nothing valuable left in conversation state.**
     ```

   - **(B)** Some landing row is `landed` or `queued` (`queued: needs merge` included), and none is stuck:

     ```
     **Thread closed. Safe to end this session — close-out pushed where the landing rows say; any close-out PR is queued for merge, not merged yet.**
     ```

   - **(C)** Any landing row is `stuck:`, naming every stuck repo:

     ```
     **Thread closed. Safe to end this session, but the close-out is NOT queued to land in <repo>[, <repo>…]: see its landing row.**
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
- **A squash- or rebase-merged branch, or a stale local `origin/<default>`** (repo-state runs in step 2, before landing's fetch, so its base ref can still be stale) → the repo-state line still reads `unmerged to <default>`: the count is commits on HEAD not reachable from the base ref, and a squash or rebase rewrites them. The caveat lives here only; the line's wording stays exactly `unmerged to <default>`.
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
- **A repo thread this session did not change** → step 7.1 reports `unchanged` and makes no commit; a `/thread:open save` followed by a close finds it unchanged unless the work moved on. Landing still runs for that repo with no paths, and never commits pre-staged work.
- **A listed THREAD.md outside git** → written, then reported `not versioned: <path> (not a git repo)`.
- **No active thread, no project context.** That's fine — skip thread-update, still run the rest of the triage. Offer to create a thread if the conversation looks worth one.
- **Condition evidence only in a compaction summary** → that condition fails (§ A finished task closes itself, **Evidence, not memory.**), and the task becomes a mark-done option; it never flips automatically.
- **A task named only in THREAD.md lines this session wrote** (this close's step 4 or 7.1, or an earlier `/thread:open save`) → route (d) fails, and the task becomes a mark-done option.
- **A picked-up capture or handoff doc names the task** in its `## Resume prompt` or Paste-ready prompt → route (c): the task counts as opened from it. A task named only elsewhere in the capture or doc does not count.
- **A capture's Resume prompt pasted into a fresh session** → a pickup, the same as `/thread:open [[<capture>]]`: the prompt's `First:` line closes the capture, and a task its prompt names by wikilink or path counts as opened from it under route (c). `task-writer.md` § 5 makes a capture written while an existing task was being worked name that task, so a stash taken mid-task leads back to it.
- **Orient Hands-on on a task note** → route (b), by either branch: open's pickup, or following the note's `## Launch` / `## Resume prompt`.
- **A capture without the `thread` tag** → open's pickup leaves it open, as it does any task that is not a capture; at close it has no Verify line, so it becomes a mark-done option.
- **A task worked but never opened** (this session did its work, but the task reached the session only through chat, not a pickup or the pre-session THREAD.md) → condition 1 fails, and the task becomes a mark-done option. A task only mentioned in chat, its work not done here, is not a candidate at all.
- **A task this session only did bookkeeping on** (orient's reshuffle, a `/thread:schedule` `wave:` stamp, a reconcile write, a slot fill, any other frontmatter edit) → not a candidate: no flip, no mark-done option, no row.
- **A squash-merged PR** → `merge-base --is-ancestor` fails, so `gh pr view`'s `MERGED` is the evidence, with its `headRefOid` compared against the tested commit. A `gh` error fails condition 2.
- **A branch whose tracking task flips this close** (step 2's repo-track ran before the flip, so a squash-merged task's branch still reads unmerged) → the row reads `tracked by [[<task>]] (flipped done this close)` and the branch becomes a `Merge or retire <branch>` candidate, since no open task tracks it any more. A tracker ticked done in step 6 is annotated `(ticked done this close)` but proposes nothing: the menu has already been asked, so the next close finds the branch untracked and proposes it then.
- **A task that already carries `completed:`** (blank or stale: hand-made, TaskNotes-edited or reopened) → the write replaces that key in place; it never adds a second one.
- **A touched task already done or on hold** (`done`, `blocked`, `parked`, including one execute finished) → not a candidate, no row.
- **The finished task was the thread's next step** (THREAD.md's Resume instructions named it, so both route (d) and § 4b's rule 2 see it) → it flips; step 5's match skips it and falls to rule 3 or to no match; step 4 rewrites the Resume instructions past it; and 7.6 writes the flip before the set-down, so `next-action.py` is never handed a done task.
- **Landing runs once per repo at the end of 7.2**, after every repo's paths are collected, as one Bash call per repo, run one after another (§ Land the close-outs).
- **A repo listed on the landing register, with no GitHub origin, or swept by the daily sweep** → committed only: `not landed: listed …` or `not landed: no GitHub origin` gets a landing row; `swept by the daily sweep` gets none, since the sweep pushes it.
- **No push access** → `not landed: no push access`, a landing row, banner A. **Push access unknown** (a token with no permissions object) → `stuck: push access unknown (token lacks permissions)`, banner C.
- **A non-default checkout** (the repo sits on a feature branch) → the close-out is committed there, `not landed: on <branch>, not <default>`; that branch is never fetched into or fast-forwarded, and nothing is pushed.
- **Stuck** (the register unreadable, the default branch unresolved, a fetch or gh call failed or timed out, a non-close-out commit ahead, a rebase conflict) → the commit stays local, the landing row shows the reason, banner C names the repo. The next close in that repo tries again.
- **`queued: needs merge`** (auto-merge refused, or not enabled on the repo) → the PR is open and labelled `landing`; the daily lander or the next close merges it. Banner B.
- **`/thread:open save`** → every landing call is `--commit-only`: committed, never pushed.
- **An older close-out PR still queued** → the next close in that repo carries its commit (`carried <N>`) and reuses the open PR for the same head, or opens a new one for the new head; nothing is waited on.
- **A repo that refuses direct pushes to its default branch** without reading as protected → `stuck: push refused`, banner C.
- **Origin moved with local changes** → landed unless a local change overlaps origin's, then stuck until that file is committed or stashed. Non-overlapping dirty and pre-staged files are kept exactly.

## Why this exists

Threads routinely end with valuable state only in the conversation — open questions, rationale behind a pivot, a concrete next step that never made it to disk. Without a close ritual, that state evaporates and the next session re-derives it from scratch. `thread:close` is the ritual: triage, route, persist, commit, land its close-out, done. The approval gate moved from save-time to curation-time (ADR 0011): saves are cheap and reversible, so the weekly curator — not a menu — is what keeps memory clean. A pending handoff doc is the one narrowing of that gate: it is already the tracker for the thread's continuation, so close refreshes it rather than proposing a second (ADR 0017). For vault tasks close only proposes, with one exception: it marks a task this session explicitly worked `done` without asking when the work is on the default branch (or is not code) and its Verify line ran green; a task short of that becomes a mark-done question (ADR 0026).
