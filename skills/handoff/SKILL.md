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

Every handoff produces two artefacts: a **durable handoff doc**, committed to the repo the session is working in, and a **paste-ready prompt** that points at it. In **Codex Desktop or a Chorus Session**, the primary outcome is additionally a **new visible task** that the user can open and interact with; the prompt is the payload used to create that task. (On the Stage the call raises a Handoff card the listener Starts — an offer, not yet a live Session, which is what the queued `clientThreadId` form of the directive already means; ADR 0047.) The doc is the object Lachy tracks — it is never optional and never lives in OS temp (ADR 0017).

**Invocation gate.** Run this only on explicit fork intent (the user asked for a
handoff of THIS conversation) or when a router (`next`/`orient`) dispatched it.
Never self-initiate a handoff because the session feels long or the context is
filling — that is a recommendation, and recommendations for the undecided
moment belong to `thread:next`'s ask-first menu. (Model invocation enabled
2026-08-12: the old `disable-model-invocation` flag was inherited from the
flat-skill port, never a recorded decision, and handoff is the cheapest-misfire
route of the family. Since ADR 0017 a misfire costs one committed doc — and it
must be removed, not left: a pending doc nobody meant silences the next
`thread:close`'s continuation tasks for that thread. See § Lifecycle, withdrawn.)

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

**Where.** `<home>/docs/handoffs/<YYYY-MM-DD>-<slug>.md`. `<home>` is the **unit directory** — the smallest directory that owns the work, not the git toplevel, because two monorepos hold many units each:

- CWD under `~/Projects/<Area>/<Project>/` → that project directory (the `~/Projects` monorepo's toplevel would pool every project's handoffs).
- CWD under `~/repos/workspaces/<workspace>/` → that workspace directory (`_shared/` for a shared thread).
- Otherwise → `git rev-parse --show-toplevel` (a tool repo such as `~/repos/tools/<name>/`).
- CWD in no git repo at all → the session's workspace directory under `~/repos/workspaces/`.

Never the OS temp directory (macOS clears it on reboot; a handoff must survive reboots and account switches) and never the vault. Slug: ≤5 words naming the work. Create `docs/handoffs/` if absent. If `<home>`'s repo ignores the path (`git check-ignore -q <path>` — `~/Projects/Tutorials/`, `_archive/`, `TSMS/` are deliberately ignored), do **not** edit `.gitignore`: write the doc under the session's workspace directory instead, which is never ignored, and name that path in the prompt. **One doc, one consumer**: a handoff that briefs two sessions is two docs (they may both point at one shared reference file) — the lifecycle below deletes a doc when its consumer closes, and a second reader would be stranded. Every path in this skill, in `thread:close` and in `thread:open` is this same `<home>/docs/handoffs/<doc>`; the prompt carries it **absolute**.

**Shape.** Front matter, then the body:

```yaml
---
thread: <the active THREAD.md's `slug:` front-matter value, whether project-side or shared; else this handoff's slug>
written: <YYYY-MM-DD>
status: pending          # pending -> consumed, set by the session that picks it up
refreshed: <YYYY-MM-DD>  # optional — added by thread:close when it refreshes a pending doc
---
```

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

**Lifecycle.** The working tree holds in-flight handoffs only: `ls docs/handoffs/` is the live list, and a doc is pending until its front matter says `status: consumed` (close § The handoff owns the continuation has the scan).

- **Pickup.** The consuming session's first instruction — carried in the prompt, and equally `thread:open`'s handoff-doc pickup or a resume whose THREAD.md points at the doc — reads the doc and then sets `status: consumed` in its front matter, in place, with no commit. The doc's job ended the moment the thread went live, exactly as a stash/defer capture is marked done at pickup (ADR 0001).
- **Close-out.** That session's `thread:close` deletes the consumed doc in its close-out commit (`git rm -f` — the consumed mark is a local modification plain `git rm` refuses — committed by pathspec). Git history keeps it forever; deletion is the cleanup, so there is no buildup. A consumer that exits by `stash`/`defer` instead leaves the consumed doc for the next close in that repo.
- **While pending**, `thread:close` treats the doc as the thread's continuation: it refreshes the doc in place when later work has made it stale, and proposes no vault task for anything the doc carries (close § The handoff owns the continuation, ADR 0017).
- **Withdrawn.** If the handoff is called off in the same session ("never mind, keep going"), remove the doc at once — `git -C "<home>" rm -f <path> && git -C "<home>" commit -m "🔧 chore(handoff): withdraw <slug>" -- <path>` (plain `rm` if it was never committed; same repo-state guard as above) — so no pending doc outlives the intent. A doc left by a misfire is the one way this route can silence a later close.
- **Legacy.** Docs written before this contract carry no front matter. `thread:close` lists them and leaves them alone; add the front matter by hand to bring one into the lifecycle.

## Build the handoff prompt

Create this compact payload for the new task. Print it as a fenced block when native creation is unavailable or when the user asks to see it:

```
You're continuing "<task title>" mid-stream — a live handoff, not a cold pickup.
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
