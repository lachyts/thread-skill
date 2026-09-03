---
name: handoff
description: 'Fork the current conversation to a fresh agent NOW. In Codex Desktop, a successful handoff creates a new visible sidebar task with the compacted context and starts it; a headless CLI session or subagent is never an acceptable substitute. In hosts without native visible-task creation, produce a clearly labelled copy-paste prompt plus an optional temp doc and say that no new task was created. Trigger ONLY on explicit fork intent — "hand this off", "handoff this thread", "fork this to a fresh agent", "new session and keep going", explicit /thread:handoff — or on dispatch from a router (thread:next / thread:orient). Do NOT trigger when "handoff" refers to people or other systems, when handoffs are merely being discussed, or proactively because the context feels long — for the undecided moment recommend thread:next instead.'
argument-hint: "What will the next session focus on?"
author: Matt Pocock
license: MIT
source: https://github.com/mattpocock/skills (skills/productivity/handoff) — adapted under MIT
---

# /thread:handoff — fork this thread into a visible fresh task

Compact the current conversation so a fresh agent can continue the work *immediately*.

In **Codex Desktop**, the primary outcome is a **new visible sidebar task** that the user can open and interact with. The compact prompt is the payload used to create that task. A temp-file handoff doc is the optional deep-context companion.

**Invocation gate.** Run this only on explicit fork intent (the user asked for a
handoff of THIS conversation) or when a router (`next`/`orient`) dispatched it.
Never self-initiate a handoff because the session feels long or the context is
filling — that is a recommendation, and recommendations for the undecided
moment belong to `thread:next`'s ask-first menu. (Model invocation enabled
2026-08-12: the old `disable-model-invocation` flag was inherited from the
flat-skill port, never a recorded decision, and handoff is the cheapest-misfire
route of the family — it writes nothing durable.)

## Success contract in Codex Desktop

A handoff is complete only when all of these are true:

1. A host-native `create_thread` call succeeds and returns a `threadId` or queued `clientThreadId`.
2. The new task is seeded with the compact handoff prompt and the correct project/workspace context.
3. Use `wait_threads` for an initial progress snapshot when available, so creation is verified without waiting for the whole job to finish.
4. The response emits the host directive exactly as required:
   - `::created-thread{threadId="..."}` for a created task, or
   - `::created-thread{clientThreadId="..."}` for queued worktree setup.

Search specifically for the host-native task tools before acting: `create_thread`, `wait_threads`, `read_thread`, `send_message_to_thread`, and related tools. Do not confuse them with third-party tools whose names also contain “thread”, such as Twist or email connectors.

The user's explicit handoff request is the authorisation to call `create_thread`; do not ask them to confirm the same action again. Unless they specify another destination, create the new task in the same project/workspace and give it a concise title derived from the task.

## Fail closed — never create an invisible substitute

If the native task-creation tool is absent, unavailable, or fails:

- Do **not** run `codex exec`, `codex resume`, or another shell command to create a non-interactive Codex session. These sessions are not visible sidebar tasks.
- Do **not** substitute a subagent, goal, background process, browser session, or desktop-automation attempt and describe it as a new thread.
- Do **not** emit `::created-thread` without a successful native creation result.
- Preserve the current work, prepare the prompt and optional temp doc below, and state plainly: “I couldn’t create a visible sidebar task from this session because the native task tool is unavailable. No hidden substitute was launched.”
- Give the user the ready-to-paste prompt so they can open a new task manually. Treat this as a blocked handoff, not a successful one.

This strict failure behaviour matters because a technically persistent session that the user cannot see, inspect, or message does not satisfy the purpose of a handoff.

## Build the handoff prompt

Create this compact payload for the new task. Print it as a fenced block when native creation is unavailable or when the user asks to see it:

```
You're continuing "<task title>" mid-stream — a live handoff, not a cold pickup.
Context: <2–5 lines: goal, state of play, what's built/decided, what's blocked.>
Read first: <handoff doc path if written; key file paths / artefact links>
Suggested skills: <skills the next agent should invoke>
Next move: <the single concrete next step>
```

Keep it tight — the doc (below) carries the depth; the prompt carries the momentum.

## Handoff document (when the context is too rich for a prompt)

Write a handoff document summarising the conversation and save it to the temporary directory of the OS — not the current workspace or the vault. Skip it when the inline prompt alone is genuinely sufficient.

Include a **"Suggested skills"** section that names the skills the next agent should invoke to continue.

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs, THREAD.md). Reference them by path or URL instead.

Redact any sensitive information — API keys, passwords, tokens, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor both outputs accordingly.

When native task creation succeeds, pass the prompt and handoff-file path into the new task, then report the created task and emit the required directive. When native task creation is unavailable, print the inline prompt and the absolute path of the handoff file so the user can open a new task manually.

## Other hosts

In a host with an equivalent native visible-session creation tool, use that tool and verify the returned session identifier. In a host with no such capability, the prompt/doc fallback is allowed only when it is explicitly labelled as a manual handoff; never claim that a new task was created.

## Relationship to the other thread:* routes

This is **not** a replacement for the rest of the family:

- `thread:open` + `thread:close` = persistent, durable continuity for ongoing work that spans many sessions.
- `thread:stash` / `thread:defer` = the work stops *for now*; a self-contained vault task guarantees it isn't lost.
- `thread:handoff` = the work continues *right now*, in a new visible task when the host supports it. Its compaction is throwaway and lives in temp, not the vault.

If the work is an ongoing project that should be remembered, use `thread:close` instead. Use `thread:handoff` for the live "carry this task to a new agent" moment.
