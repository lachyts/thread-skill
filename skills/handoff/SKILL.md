---
name: handoff
description: 'Fork the current conversation to a fresh agent NOW. Always writes and commits a durable handoff doc at docs/handoffs/YYYY-MM-DD-<slug>.md in the session''s repo (never OS temp) plus a paste-ready prompt; the consumer marks it consumed and its close deletes it. In Codex Desktop or a Chorus Session a successful handoff also creates a new visible task seeded with that prompt — a headless session or subagent is never a substitute; elsewhere label it a manual handoff. Trigger ONLY on explicit fork intent — "hand this off", "fork this to a fresh agent", "new session and keep going", /thread:handoff — or on router dispatch (thread:next / thread:orient). Never when "handoff" means people or other systems, never proactively because the context feels long — recommend thread:next instead.'
argument-hint: "What will the next session focus on?"
author: Matt Pocock
license: MIT
source: https://github.com/mattpocock/skills (skills/productivity/handoff) — adapted under MIT
---

# /thread:handoff — fork this thread into a visible fresh task

Compact the current conversation so a fresh agent can continue the work *immediately*.

Every handoff produces two artefacts: a **durable handoff doc**, committed to the repo the session is working in, and a **paste-ready prompt** that points at it. In **Codex Desktop or a Chorus Session**, the primary outcome is additionally a **new visible task** that the user can open and interact with; the prompt is the payload used to create that task. (On the Stage the call raises a Handoff card the listener Starts — an offer, not yet a live Session, which is what the queued `clientThreadId` form of the directive already means; Chorus ADR 0047.) The doc is the object Lachy tracks — it is never optional and never lives in OS temp (ADR 0017).

**Invocation gate.** Run this only on explicit fork intent (the user asked for a
handoff of THIS conversation) or when a router (`next`/`orient`) dispatched it.
Never self-initiate a handoff because the session feels long or the context is
filling — that is a recommendation, and recommendations for the undecided
moment belong to `thread:next`'s ask-first menu. (Model invocation enabled
2026-08-12: the old `disable-model-invocation` flag was inherited from the
flat-skill port, never a recorded decision, and handoff is the cheapest-misfire
route of the family. Since ADR 0017 a misfire costs one committed doc — and it
must be removed, not left: a pending doc nobody meant silences the next
`thread:close`'s continuation tasks for that thread. See `handoff-lifecycle.md` § Withdrawn.)

## Success contract in Codex Desktop or a Chorus Session

A handoff is complete only when all of these are true:

1. The handoff doc below is written and committed — *before* the task is created, so the prompt's `Read first` path resolves the moment the new task starts.
2. A host-native `create_thread` call succeeds and returns a `threadId` or queued `clientThreadId`.
3. The new task is seeded with the compact handoff prompt and the correct project/workspace context.
4. Use `wait_threads` for an initial progress snapshot when available, so creation is verified without waiting for the whole job to finish.
5. The response emits the host directive exactly as required:
   - `::created-thread{threadId="..."}` for a created task, or
   - `::created-thread{clientThreadId="..."}` for queued worktree setup.

Search specifically for the host-native task tools before acting: `create_thread`, `wait_threads`, `read_thread`, `send_message_to_thread`, and related tools. Do not confuse them with third-party tools whose names also contain “thread”, such as Twist or email connectors.

The user's explicit handoff request is the authorisation to call `create_thread`; do not ask them to confirm the same action again. Unless they specify another destination, create the new task in the same project/workspace and give it a concise title derived from the task.

## Fail closed — never create an invisible substitute

If the native task-creation tool is absent, unavailable, or fails:

- Do **not** run `codex exec`, `codex resume`, or another shell command to create a non-interactive Codex session. These sessions are not visible sidebar tasks.
- Do **not** substitute a subagent, goal, background process, browser session, or desktop-automation attempt and describe it as a new thread.
- Do **not** emit `::created-thread` without a successful native creation result.
- Preserve the current work (the handoff doc is already written and committed — § Success contract, step 1), print the prompt, and state plainly: “I couldn’t create a visible sidebar task from this session because the native task tool is unavailable. No hidden substitute was launched.”
- Give the user the ready-to-paste prompt so they can open a new task manually. This is a **manual handoff**: the doc and prompt are complete and the lifecycle below applies to them in full — what is missing is the native task, not the handoff.

This strict failure behaviour matters because a technically persistent session that the user cannot see, inspect, or message does not satisfy the purpose of a handoff.

## Handoff document — durable, committed, self-cleaning

**Where.** `<home>/docs/handoffs/<YYYY-MM-DD>-<slug>.md`, where `<home>` is what the resolver prints:

```
bash "${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh"            # add --shared when the active thread is a _shared/threads/<slug>.md
```

Its rules — project directory, seat, `_shared`, git toplevel, and `_shared` for a unit outside git or one whose repo ignores `docs/handoffs/` — are `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Home; never resolve `<home>` by hand, and never edit a `.gitignore` to make room. Never the OS temp directory (macOS clears it on reboot; a handoff must survive reboots and account switches) and never the vault. Slug: ≤5 words naming the work. Create `docs/handoffs/` if absent. A doc briefs exactly one consumer (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md`). Every path in this skill, in `thread:close` and in `thread:open` is this same `<home>/docs/handoffs/<doc>`; the prompt carries it **absolute**.

**Failure path.** If the resolver exits non-zero, prints nothing, or cannot be run (`CLAUDE_PLUGIN_ROOT` unset, a stale cache), stop before writing: no doc, no commit, no Thread-state row, no captures touched, no task created. Print `handoff: resolver failed (<its stderr, or "not found at <path>">) — no doc written` and ask Lachy for an absolute directory. Only a directory he names is used as `<home>`, never one the agent infers.

**Consumer home.** When the consumer will launch somewhere other than this session's launch directory — the work moves to another repo, or this repo is about to be deleted or moved — resolve with `--dir <consumer launch dir>` (plus `--shared` for a shared thread), then write and commit the doc there, with `git -C` on that home. The prompt names that absolute path, and the producer's later `thread:close` still finds the doc through the THREAD.md Resume pointer.

**Shape.** Front matter — the block in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Front matter, written with `status: pending` — then the body. The body's first line, above § 1, is ``**Run from:** `<abs dir>` ``: the directory the consumer must launch in, because the harness resets a `cd` out of the launch directory. It is this session's launch directory, or the consumer's under **Consumer home.**; for a shared thread written from a seat it is the seat, never `_shared`, which is not a launch directory.

Body sections, in this order — the same list the session-safepoint stop hook mandates, so a hook-forced handoff and a requested one produce the same artefact:

1. **Done and verified** — what landed this session, with evidence (paths, SHAs, test output).
2. **What remains** — the continuation: what the next session does, in order.
3. **Decisions settled** — rulings already made, so they are not re-litigated.
4. **Gotchas found the hard way.**
5. **Suggested skills** — the skills the next agent should invoke to continue.
6. **Paste-ready prompt** — compose it first, per § Build the handoff prompt below, then write the doc carrying it verbatim, verified against live state.

Do not duplicate content already captured in other artefacts (PRDs, plans, ADRs, issues, commits, diffs, THREAD.md) — reference them by path or URL instead. Redact any sensitive information — API keys, passwords, tokens, or personally identifiable information. If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc and the prompt accordingly.

**Commit it**, by pathspec, before anything else (`git -C "<home>"` resolves the containing repo from a subdirectory):

```
git -C "<home>" add "<home>/docs/handoffs/<doc>" && git -C "<home>" commit -m "📝 docs(handoff): <slug>" -- "<home>/docs/handoffs/<doc>"
```

The pathspec keeps a dirty index out of the commit (close § Commit hygiene). An uncommitted handoff is not durable, and an uncommitted doc the consumer later deletes is destroyed rather than archived. Same guard as close's: if the repo has a half-applied operation (`rebase-merge`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG` under `.git/`) or a detached HEAD, write the doc but do not commit — a commit on a detached HEAD is dropped by the next checkout — and say `not versioned: <path> (<reason>)` in the handoff output so Lachy knows the doc is on disk only.

**Thread state.** If the thread has a THREAD.md, apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's handoff row now, after the doc is committed (or written, when the commit was skipped as `not versioned`).

**Open captures.** Before the prompt is printed, close the thread's own open stash/defer captures, because the doc is now the single tracker for its continuation (ADR 0017). Run the query from `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 2, then act on each hit **only** on a deterministic match: its Notes `**Thread:**` link resolves to the active THREAD.md's absolute path, or its filename stem equals the THREAD.md `slug:` (the doc's `thread:` value). Each matched capture gets `status: done`, `completed: <today>` and a Notes line `Superseded by handoff <abs doc path>`; one with `scheduled:` also loses its unchecked day-page line (`task-writer.md` § 3b). A hit that matches only because its resume prompt describes the same work is **left open** — reported, not written. The handoff output lists every write: `capture closed: [[<slug>]] (superseded)`, `day-page line removed: <day-note path>`, and `capture left open (fuzzy match only): [[<slug>]]`. Skipped entirely on the resolver failure path.

**Lifecycle.** The doc's states, pickup, close-out and the manual-handoff rule are `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md`. The one lifecycle procedure that runs here is **withdrawal** (`handoff-lifecycle.md` § Withdrawn): if the handoff is called off in the same session, remove the doc at once — `git -C "<home>" rm -f <path> && git -C "<home>" commit -m "🔧 chore(handoff): withdraw <slug>" -- <path>` (plain `rm` if it was never committed; same repo-state guard as above), and undo the handoff row: when the thread has a THREAD.md, rewrite real Resume instructions there in place of the `Read <abs doc path> first` pointer, and reopen the captures it superseded: every task note carrying `Superseded by handoff <abs doc path>` (`rg` over `~/repos/obsidian/Work/Tasks/`) returns to `status: open`, loses `completed:` and that line, and a scheduled one gets its day-page line back per `task-writer.md` § 3b. The choice is reopen, not "close only once final": a handoff has no later final moment that the producing session observes.

## Build the handoff prompt

Create this compact payload for the new task. Print it as a fenced block when native creation is unavailable or when the user asks to see it:

```
You're continuing "<task title>" mid-stream — a live handoff, not a cold pickup.
Run from: <abs dir> — launch the session there; a cd from another launch directory is reset.
Read first: <home>/docs/handoffs/<YYYY-MM-DD>-<slug>.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: <2–5 lines: goal, state of play, what's built/decided, what's blocked.>
Also read: <key file paths / artefact links>
Suggested skills: <skills the next agent should invoke>
Next move: <the single concrete next step>
```

Keep it tight — the doc carries the depth; the prompt carries the momentum.

When native task creation succeeds, seed the new task with the prompt (the doc path travels inside it), then report the created task and emit the required directive. When native task creation is unavailable, print the prompt and the absolute path of the handoff doc so the user can open a new task manually.

## Other hosts

In a host with an equivalent native visible-session creation tool — a Chorus Session serves `create_thread` under the same name — use that tool and verify the returned session identifier. In a host with no such capability, the doc + prompt manual handoff is allowed only when it is explicitly labelled as a manual handoff; never claim that a new task was created.

## Relationship to the other thread:* routes

This is **not** a replacement for the rest of the family:

- `thread:open` + `thread:close` = persistent, durable continuity for ongoing work that spans many sessions.
- `thread:stash` / `thread:defer` = the work stops *for now*; a self-contained vault task guarantees it isn't lost.
- `thread:handoff` = the work continues *right now*, in a new visible task when the host supports it. Its doc is durable but transient: it lives in the repo's `docs/handoffs/` until the consuming session deletes it, and while it is pending `thread:close` treats it as the thread's continuation. THREAD.md remains the long-lived record; the doc is the hand-carried brief.

If the work is an ongoing project that should be remembered, use `thread:close` instead. Use `thread:handoff` for the live "carry this task to a new agent" moment.
