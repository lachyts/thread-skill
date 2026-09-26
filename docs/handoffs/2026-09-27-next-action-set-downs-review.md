---
thread: gtd-next-action-grill
written: 2026-09-27
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill-wt-next-action`

## 1. Done and verified

- Estate design: `~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md` (read decisions 4, 5 and 7
  and the Amendments). Vocabulary: `~/repos/workspaces/_shared/CONTEXT.md` § Next action.
- This branch, `feat/next-action-set-downs` off `master`, is vault task
  `next-action-p1-4-set-downs-write-and-orient-reads` (project [[Next Action]]):
  - `1b0dd5d` ✨ set-downs write `next_action` + `next_task`; orient reads the slot first. The one home is
    `skills/_shared/task-writer.md` § 4b; stash/defer/close cite it; open leaves both fields alone.
  - `0ace7fd` 🧪 `tests/contracts/next-action.test.mjs` pins the writes and orient's read.
  - `9bf58a7` 📝 dead links are read as blank, not swept (ADR 0008 d5 was amended after the sweep was
    dropped); orient's dead list gains `dropped`.
- `make test` → `ALL PASS` at `9bf58a7`. **Not yet reviewed** by `/fresh-review`: the producing session
  could not bind the review engine to this repo from the ops seat.

## 2. What remains

1. `/fresh-review xhigh` on this branch (target `master...HEAD` — launching here is what makes the engine
   review this tree). Annotate, fix in this worktree, honour the ledger's stop rule.
2. Once clean: `git rm` this doc and commit **before** merging, so it never lands on `master`.
3. Merge to `master` per the repo's CLAUDE.md, with Lachy's go. The main checkout
   (`~/repos/tools/thread-skill`) is on another session's branch (`p5-2/snippets-to-scripts`) — do not
   check out or disturb it; the installed plugin runs from there.
4. Vault: set `status: done` + `completed:` on
   `~/repos/obsidian/Work/Tasks/next-action-p1-4-set-downs-write-and-orient-reads.md`. Leave
   [[Next Action]]'s `next_task:` alone (it points at p1-5, the Chorus card).

## 3. Decisions settled

- Any set-down overwrites; stash exactly like defer (Lachy: "Defer is doing a stash to a specific time").
- `close` writes only when an open task carries the thread's continuation — never a loose end; else
  it leaves both fields alone (ADR 0008 d4).
- A dead link (target done / merged / dropped / archived / missing) reads as blank everywhere and is
  never rewritten; there is no sweep (d5, amended).
- The builder's calls, accepted: area notes get no `next_task:`; orient fills a blank only for the
  task it recommends, never in Report-only mode; stash/defer always write `next_action`.

## 4. Gotchas found the hard way

- The review engine resolves `git diff` against the session's launch directory; a `cd` does not stick.
  Launch in this worktree or it reviews the wrong tree silently.
- `tests/contracts/refs.test.mjs` treats "estate ADR" citations as another repo's numbering (this repo
  has its own, unrelated ADR 0008).

## 5. Suggested skills

`/fresh-review`, then `/thread:close`.

## 6. Paste-ready prompt

```
You're continuing "Next Action p1-4 — review and merge the set-down writes" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill-wt-next-action — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill-wt-next-action/docs/handoffs/2026-09-27-next-action-set-downs-review.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: estate ADR 0008 adds next_action (task) and next_task (project). This branch (feat/next-action-set-downs, 3 commits, make test ALL PASS) makes defer/stash/close write both and orient read the slot first. It has not had a /fresh-review yet. Dead links read as blank; there is no sweep.
Also read: ~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md; skills/_shared/task-writer.md § 4b
Suggested skills: /fresh-review, /thread:close
Next move: run /fresh-review xhigh on master...HEAD from this worktree.
```
