# Handoff lifecycle — the handoff-doc contract

The one statement of what a handoff doc is, the states it moves through, and the thread-state transitions every continuity route applies. `thread:handoff`, `thread:open`, `thread:close` and the capture writer cite this file; procedures stay with the skill that runs them — close's scan snippet and its step 7.2 git commands, handoff's commit and withdraw commands, open's pickup steps.

A **handoff doc** is a file in `<home>/docs/handoffs/`, written by `thread:handoff` or by the session-safepoint stop hook (`~/repos/workspaces/_shared/scripts/session_safepoint.py`, referenced here by path only, never edited). `<home>` is the *unit directory* defined in handoff § Handoff document (**Where.**). The working tree holds in-flight handoffs only: `ls docs/handoffs/` is the live list.

**One doc, one consumer**: a handoff that briefs two sessions is two docs (they may both point at one shared reference file) — § Close-out deletes a doc when its consumer closes, and a second reader would be stranded.

## Front matter

Every doc opens with this block, then the body sections handoff § Handoff document (**Shape.**) lists:

```yaml
---
thread: <the active THREAD.md's `slug:` front-matter value, whether project-side or shared; else this handoff's slug>
written: <YYYY-MM-DD>
status: pending          # pending -> consumed, set by the session that picks it up
refreshed: <YYYY-MM-DD>  # optional — added by thread:close when it refreshes a pending doc
---
```

## States

- **`pending`** — written and committed; the thread's continuation until a session picks it up (§ While pending).
- **`consumed`** — the picking-up session set it (§ Pickup); the doc's job is over.
- **deleted** — the consuming session's close removed it (§ Close-out); git history keeps every version.
- **legacy** — no `status:` line (written before ADR 0017). Counted in close's step-8 report and otherwise left alone: never refreshed, never deleted, never marked consumed, never a reason to suppress. Add the front matter by hand to bring one into the lifecycle.
- **`unknown(…)`** — a `status:` value other than the two above. One counted report line, untouched, like legacy.

The status is read from the front-matter block only (quotes stripped, case-folded, CRLF tolerated), so a body that mentions `status: pending` does not count. `close` § The handoff owns the continuation holds the scan that classifies them.

## Pickup

The consuming session's first instruction — carried in the prompt, and equally `thread:open`'s handoff-doc pickup or a `/thread:open <slug>` resume whose Resume instructions point at the doc — reads the doc and then sets `status: consumed` in its front matter, in place, with no commit. The doc's job ended the moment the thread went live, exactly as a stash/defer capture is marked done at pickup (ADR 0001). Marking it also applies § Thread state's pickup row. A legacy doc is briefed from but never marked.

## While pending

`thread:close` treats a pending doc as the thread's continuation: it refreshes the doc in place when later work has made it stale, and proposes no vault task for anything the doc carries (`close` § The handoff owns the continuation, ADR 0017).

A **manual handoff** — the doc and prompt were produced but no native task was created (handoff § Fail closed) — is a complete handoff for this rule: the committed doc is the object Lachy tracks, and close's step-8 row shows it pending. What it lacks is a task, not a tracker.

## Close-out

The consuming session's `thread:close` deletes the consumed doc in its close-out commit, **whoever marked it**: consumed means the thread it briefed went live, and git history keeps the pending version — nothing about that decision lives in the closing conversation. Deletion is the cleanup, so there is no buildup. The commands (`git rm -f`, since the consumed mark is a local modification plain `git rm` refuses, then a pathspec commit; plain `rm` for a doc that was never committed) are close's Process step 7.2.

A consumer that exits by `stash` or `defer` instead leaves the consumed doc for the next close in that repo.

## Withdrawn

A handoff called off in the same session ("never mind, keep going") is no handoff at all: the session removes the doc at once — the command is handoff § Lifecycle — so no pending doc outlives the intent, and close finds nothing pending. A doc left by a misfire is the one way the handoff route can silence a later close: a pending doc nobody meant suppresses that thread's continuation tasks.

## Thread state

The single definition of the `state:` transitions every continuity route applies to a THREAD.md:

| Route | Sets `state:` | Shared thread's INDEX line moves to |
|---|---|---|
| `stash` | `parked` | `## Parked` |
| `defer` | `paused` | `## Paused` |
| `handoff` | `active`; Resume instructions become the pointer `Read <abs doc path> first` | `## Active` |
| pickup: `/thread:open [[<task>]]`, `/thread:open <handoff doc>`, or `/thread:open <slug>` whose Resume points at a pending doc | `active` when it reads `parked` or `paused`; otherwise unchanged | `## Active` |
| `close`, `/thread:open save` | unchanged; `done` only when Lachy says the thread is finished | `## Done` when set |
| creation | `active` | `## Active` |

- Every transition also sets the THREAD.md's `last_touched:` and, for a shared thread, its INDEX line's `last:` to today — including a row that leaves `state:` unchanged. The INDEX is `~/repos/workspaces/_shared/threads/INDEX.md`; its line format is `open` § Index updates.
- Project threads have no INDEX line: the rows apply to front matter only.
- A thread **created at stash or defer** takes the creation row and then that route's row in the same step: it lands `parked` or `paused`, never `active`, and a shared thread's new INDEX line goes straight under `## Parked` or `## Paused`.
- The pickup row never reopens a `done` thread. On the handoff-doc and `<slug>` paths it applies only when a pending doc was actually consumed — a legacy doc, or a pointer to a doc already deleted, applies nothing.
- The handoff row applies only when the thread has a THREAD.md, after the doc is committed — or, when the commit was skipped (`not versioned:`), after it is written: the continuation is live either way.
- Applying a row writes the THREAD.md and INDEX only; it adds no commit of its own. They are carried by the same commits that already carry those files (the consumer's close, the workspaces and `~/Projects` sweeps), and handoff's own commit stays the one doc (ADR 0017).
