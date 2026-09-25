---
name: close
description: 'End-of-thread capture — update the active thread (project THREAD.md or shared _shared/threads/<slug>.md) with what happened this session, then save the rest autonomously: auto-memory (save-time triage, provenance-stamped), workspace knowledge, process-observation candidates to the METHOD.md the altitude routing test resolves (project, seat or estate), and git commits all happen without asking; vault tasks are the only proposal. Available globally — works from any CWD. Use when the work is FINISHED for now and state should persist; if the work continues elsewhere use thread:handoff, if it''s being set down for later use thread:stash or thread:defer. Invoke with `/thread:close` or "close this thread".'
---

# /thread:close — close out this thread

End-of-thread capture. The thread is about to end — make sure nothing valuable is lost. Triage what happened in this conversation and route each piece to exactly one destination.

**The active thread is always the primary destination.** Update its `THREAD.md` first; everything else (vault tasks, memory, etc.) is supporting capture.

**Everything saves autonomously except vault tasks.**

- **Auto-execute, no asking**: git commits in `~/repos/workspaces/` and the Obsidian vault (session-changed files only) plus the handoff docs, each by pathspec in its own repo (§ The handoff owns the continuation), the thread update, auto-memory entries (via the save-time triage below), and workspace knowledge edits. The safety net that replaced per-item approval sits downstream, not in a menu: auto-memory lands `provisional` with provenance, nothing is ever hard-deleted, and the weekly memory curator archives what turns out to be junk (ADR 0011).
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
7. **Process observations** — run `${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md` in full (not silent mode): its bar, routing, project-directory rungs, Windows NOOP, row form and commit rule are the whole of category 7. Most sessions have none — NOOP is the expected outcome here too; any append is listed in the step-8 report. Routing exception to the one-destination rule below: an observation about *how the work is done* goes to METHOD.md even when it would also fit Known quirks — Known quirks holds project-state gotchas, METHOD.md holds process.

Skip anything that's obvious from reading the current code, already in docs, or purely ephemeral (one-off debugging, tool noise).

## Destinations

Each candidate lands in exactly one of these. When in doubt, prefer the destination closer to the work (thread > project doc > workspace memory).

| Type | Destination | Approval |
|---|---|---|
| Workspace config / knowledge file edits made this session | Git commit in `~/repos/workspaces/` — auto, session-changed files only | Auto |
| Obsidian vault changes made this session (`ops-workspace` only) | Git commit in the vault repo — auto, session-changed files only | Auto |
| Thread state — where we left off, what shifted, new decisions, new known quirks, session log entry, resume instructions (a pointer to the pending handoff doc when one exists — never a copy of it) | Active `THREAD.md` (project or shared) | Auto |
| Thread continuation while a handoff doc is pending — category 3 only: what remains, the next move, the paste-ready prompt | The pending doc itself, `<home>/docs/handoffs/<date>-<slug>.md`, refreshed in place and committed by pathspec — § The handoff owns the continuation | Auto |
| Concrete follow-up actions for Lachy. While a handoff doc is pending, only *loose ends* qualify — the thread's continuation belongs to the row above (§ The handoff owns the continuation) | New file in `vault/Work/Tasks/<slug>.md` — routing + frontmatter shape per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` §§ 1 & 4; the body obeys `task-writer.md` § 5 **Lean capture** (ordinary follow-ups omit the `thread` marker tag — that's for stash/defer captures). Never to `vault/_Inbox/` — that's Lachy's capture surface only | **Propose** |
| User preferences, recurring patterns, reusable feedback | Auto-memory at the correct scope per `~/repos/workspaces/_shared/claude-base-instructions.md` § Claude memory management — global, workspace, or project area `AGENTS.md` — via the save-time triage below | Auto |
| Reusable workspace knowledge — facts about a tool or system (gotchas, schemas, limits, quirks) | `<workspace>/knowledge/<topic>.md` — same rules as `/learn`. A process observation is not a fact about a tool: it takes the row below | Auto |
| Process observation (category 7) | Append to the `METHOD.md` `## Candidates` the routing test resolves — project, seat or estate — per `${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md` § Row form | Auto |
| Not worth keeping | Discard; one line in the "What landed" report so Lachy can object | — |

## The handoff owns the continuation

A **handoff doc** is a file in `<home>/docs/handoffs/`; what it is, who writes it and the states it moves through are `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § States (its front matter is `handoff-lifecycle.md` § Front matter). `<home>` is resolved by the rules in `handoff-lifecycle.md` § Home, whose only implementation is `${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh` — handoff's writer calls the same script, so the scan below looks exactly where the doc was written. Outside `_shared`, a pending doc in `<home>/docs/handoffs/` is *this thread's* by construction; the one exception is a `<home>` that carries more than one THREAD.md-backed thread, where a doc whose `thread:` names a thread other than the active one is that thread's and is left alone. In `_shared`, ownership is by `thread:` only, because `_shared` holds every shared thread's docs: with a non-empty `slug` the scan lists only this thread's docs there, so step 7.2 can never delete another thread's consumed doc, and a legacy doc in a slug-filtered `_shared` (it has no `thread:`) is neither listed nor counted. Lachy tracks the doc as a **single object**: he acts on it, or he converts it into a task himself. A close that proposes vault tasks restating it is a second tracker for work he is already tracking, and reads as though the handoff did not count (ruled 2026-09-19; ADR 0017).

**The test is on disk, never in memory** — run the scan in step 2 and again before step 6, so it survives a context compaction. Each scanned directory, no recursion (`<home>/docs/handoffs/` is where handoff writes); `find`, not a glob, because the Bash tool is zsh, where an unmatched glob aborts the command before it runs. The scan takes three inputs, set on a line of their own before the snippet (`slug=… shared=… pointer=…`; the snippet only defaults them, so values already in the environment survive):

- `slug` — the active THREAD.md's `slug:` (empty when no thread is active).
- `shared` — `1` when the active thread is a `_shared/threads/<slug>.md`, else empty. With a slug, the scan then also covers `_shared/docs/handoffs/` (filtered by `thread:`) when `<home>` is somewhere else.
- `pointer` — the path in the THREAD.md Resume instructions (`Read <path> first`), else empty. The doc it names is classified even when it lies outside the scanned directories — a doc written at a consumer home in another repo (handoff **Consumer home.**) stays visible here — and is never printed twice.

```bash
# thread:handoff-scan (extracted and run by tests/handoff-scan.test.sh)
: "${slug:=}" "${shared:=}" "${pointer:=}"
hh="${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh"
if [ ! -f "$hh" ]; then echo "handoff-scan: resolver not found at $hh (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
if [ -n "$shared" ]; then home="$(bash "$hh" --shared)" || home=''; else home="$(bash "$hh")" || home=''; fi
shd="$(bash "$hh" --shared-root)" || shd=''
if [ -z "$home" ] || [ -z "$shd" ]; then echo "handoff-scan: no <home> (resolver failed)" >&2; exit 2; fi
thr() { awk '{ sub(/\r$/, "") } NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^thread:/{sub(/^thread:[ \t]*/, ""); print; exit}' "$1" | tr -d "\"'\r" | sed 's/[[:space:]]*$//'; }
mine() { if [ -n "$slug" ] && [ "$(dirname "$1")" = "$shd/docs/handoffs" ] && [ "$(thr "$1")" != "$slug" ]; then return 1; fi; }
cls() {
  s="$(awk '{ sub(/\r$/, "") } NR==1 && $0!="---"{exit} NR>1 && $0=="---"{exit} /^status:/{print $2; exit}' "$1" | tr -d "\"'\r" | tr '[:upper:]' '[:lower:]')"
  case "$s" in pending|consumed) ;; "") s=legacy ;; *) s="unknown($s)" ;; esac
  echo "$s $1"
}
scan_one() {
  echo "# scanned $1" >&2
  find "$1" -maxdepth 1 -name '*.md' 2>/dev/null | while IFS= read -r f; do
    if mine "$f"; then cls "$f"; fi
  done
}
scan_one "$home/docs/handoffs"
sd=''
if [ -n "$shared" ] && [ -n "$slug" ] && [ "$home" != "$shd" ]; then sd="$shd/docs/handoffs"; scan_one "$sd"; fi
if [ -n "$pointer" ]; then
  p="$pointer"
  if [ "${p%"${p#??}"}" = '~/' ]; then p="$HOME/${p#??}"; fi
  if [ "${p#/}" = "$p" ]; then echo "handoff-scan: pointer not absolute ($p) — not classified" >&2
  elif [ ! -f "$p" ]; then echo "handoff-scan: pointer missing ($p)" >&2
  else
    pf="$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"
    if { [ "$(dirname "$pf")" = "$home/docs/handoffs" ] || [ "$(dirname "$pf")" = "$sd" ]; } && [ "${pf%.md}" != "$pf" ] && mine "$pf"; then :; else cls "$pf"; fi
  fi
fi
# end thread:handoff-scan
```

The snippet announces each directory it scanned as a `# scanned <dir>` line on stderr, and a pointer it could not classify as `handoff-scan: pointer not absolute (<p>)` or `handoff-scan: pointer missing (<p>)`; stdout stays `<status> <path>` lines only. When the resolver cannot be run (`CLAUDE_PLUGIN_ROOT` unset, a stale cache, a host without the plugin) or prints nothing, the scan exits 2 with a `handoff-scan:` line on stderr and prints nothing — it never guesses a directory (step 2's failure path).

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

3. **Scan the conversation** for the seven categories above.

4. **Compute the thread-update diff** (if a thread is active):
   - Where-we-are: rewrite if state advanced; keep if not.
   - What's-built/decided: append new items.
   - Open questions: resolve answered ones (move to "decided"), add new ones.
   - Known quirks: append discoveries from this session.
   - Resume instructions: update if next-session entry-point shifted; when a handoff doc is pending, the entry point is `Read <home>/docs/handoffs/<doc> first` — a pointer, never a copy. When the doc the Resume instructions point at is consumed, by any session (step 7.2 deletes it once the peer guard allows), or is missing (the scan's `pointer missing` note), replace the pointer with real instructions, written from the doc before step 7.2 runs.
   - Session log: prepend `- YYYY-MM-DD: <one-line of what shifted>` (newest first).
   - Thread state: apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's close row — `last_touched:` and, for a shared thread, the INDEX line's `last:` set to today; `state: done` and the INDEX line's move to `## Done` only on Lachy's explicit word that the thread is finished. `/thread:open save` runs this same step.

5. **Compute the full save set silently** — no "proposed plan" message. Work out: the auto-commit file lists, the thread diff, each memory candidate's verb (via the four-verb triage), knowledge edits, process-observation candidates (category 7, with the METHOD.md path the routing test resolved — or NOOP), the pending handoff doc's refresh diff (§ The handoff owns the continuation — or `unchanged`), vault-task candidates (loose ends only while a handoff doc is pending), and what's being discarded. Nothing is shown to Lachy until the report in step 8 — except the task menu, if there is one.

6. **Vault tasks only — collect approval via `AskUserQuestion`.** If (and only if) there are proposed vault tasks: one multiSelect question, one option per task (`label` = short title, `description` = the one-line why). A single task candidate gets an explicit second option (`Skip — don't create it`) to satisfy the ≥2-option minimum. More than 4 candidates: collapse per `_shared/knowledge/triage-batching-protocol.md` §6 (*Save all N* / *Save core set* / *Skip section* / named subset). Zero task candidates — including when every candidate was continuation folded into a pending handoff doc — → no menu at all; go straight to step 7. Ticked → create in step 7; unticked → discard silently; "Other" free-text → treat as a redirect.

7. **Execute.** Order:
   1. Thread update — write THREAD.md (the most important file).
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

8. **Print the "What landed" report** (≤12 lines): thread-state pointer (e.g. `THREAD.md updated · state: active · open questions: 2`), memory verbs with paths (`ADD feedback_x.md (provisional)` / `UPDATE reference_y.md` / `SUPERSEDE a.md → b.md` / `NOOP: <reason>`), knowledge edits, any METHOD.md candidate append, at any altitude (file path + the observation in one line — the project ledger lands outside the workspace and vault, and the seat/estate ledgers are doctrine surfaces; neither is ever silent), handoff rows — never silent when a doc exists — `handoff pending: <path> · written <date> · written this session | refreshed (<what changed>) | unchanged · continuation: <N> candidate(s) kept in the doc (<K> added this close), none proposed`, `handoff consumed: <path> · deleted in <sha>`, `handoff consumed: <path> · left for its consumer (marked <age> ago)`, `handoff consumed: <path> · left for live peer <session>`, `handoff consumed: <path> · already gone (removed by another close)` — `<age>` is whole hours since the doc's mtime, `$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h` (BSD and GNU `date` both take `-r <file>`), run as `f='<abs path>'; echo "$(( ($(date +%s) - $(date -r "$f" +%s)) / 3600 ))h"` in one Bash call, like the guard snippet, since shell state does not persist between calls, so a kept-fresh doc reads `0h`–`23h`, one `handoff legacy: <N> doc(s) in <dir> (no or unknown front matter — untouched)` line per scanned directory whose count is non-zero, `handoff: none in <dirs scanned>` when the scan printed nothing and exited 0 (so a scan that ran reads differently from one that did not), `handoff pointer: <p> missing | not absolute` for a pointer note, and — when the scan failed — `handoff: scan failed (<stderr>) — lifecycle not run, no <home> guessed` in place of every other handoff row, never `handoff: none in …`, vault task files as clickable `[[wiki-links]]`, the one-line research-landing offer when a created task carries an unlanded Lean-capture research pointer — a THREAD.md section or `left in conversation`, never for an already-landed digest (`task-writer.md` § 5 **Lean capture**; never blocks the close), commit SHAs for all repos touched, any `not versioned: <path> (<reason>)` line from a failed stage (see Commit hygiene), any `redirected:` or `Needs your call:` lines, and a one-line discard note.

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
- **Not inside `~/repos/workspaces/`.** Skip the workspaces-commit step; everything else still applies.
- **No active thread, no project context.** That's fine — skip thread-update, still run the rest of the triage. Offer to create a thread if the conversation looks worth one.

## Why this exists

Threads routinely end with valuable state only in the conversation — open questions, rationale behind a pivot, a concrete next step that never made it to disk. Without a close ritual, that state evaporates and the next session re-derives it from scratch. `thread:close` is the ritual: triage, route, persist, commit, done. The approval gate moved from save-time to curation-time (ADR 0011): saves are cheap and reversible, so the weekly curator — not a menu — is what keeps memory clean. A pending handoff doc is the one narrowing of that gate: it is already the tracker for the thread's continuation, so close refreshes it rather than proposing a second (ADR 0017).
