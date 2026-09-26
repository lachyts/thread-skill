---
thread: thread-skill
written: 2026-09-26
status: pending
---

**Run from:** `/Users/lachlants/repos/tools/thread-skill`

## 1. Done and verified

- **Roadmap regathered (2026-09-26):** P5 Release safety, P6 Protocol 4 lands, P7 Top tier, P8 Planning-lane
  gaps, P9 Continuity refinements. Vault phase notes `~/repos/obsidian/Work/Phases/thread-skill-p5-…` to
  `…-p9-…`. THREAD.md § Where we are (2026-09-26) has the summary.
- **p5-1 done** (vault task `thread-skill-p5-1-protect-master-ci`, `status: done`): the repo is public; CI
  `.github/workflows/test.yml` runs `make test` on Ubuntu and macOS; rulesets `master-green-pr-only`
  (24028790) and `no-main-branch` (24028787) are the only enforcement. Live probes were refused. Merged in
  #21 and #22, and master is at `ffcb918`. ADRs 0024 and 0025 are on master.

## 2. What remains (p5-2, then the rest of P5)

1. **p5-2 — move every `$N`-bearing SKILL.md snippet into a script.** Task:
   `~/repos/obsidian/Work/Tasks/thread-skill-p5-2-snippets-move-to-scripts.md` (§ Notes, § Decisions). The
   inventory on 2026-09-26 found 16 lines across 4 SKILL.md files:
   - `skills/close/SKILL.md:77–86` (the handoff-scan helpers `thr`, `mine`, the status awk, the dir walk)
     and `:199–206` (the continuation-task awk);
   - `skills/open/SKILL.md:93` (`fms`, the front-matter slug reader);
   - `skills/execute/SKILL.md:177` (the default-branch resolver's awk `$2`);
   - `skills/schedule/SKILL.md:136, :306` hold **prose** dollar amounts ("~$30"), not snippets.
   Scripts go under `skills/close/scripts/`, `skills/open/scripts/` or `skills/_shared/scripts/` (precedent:
   `handoff-home.sh`, `repo-state.sh`), called through `${CLAUDE_PLUGIN_ROOT}`. Repoint the existing
   snippet-extraction tests (`tests/handoff-scan.test.sh` and others that `sed` a marked block out of a
   SKILL.md) at the scripts.
2. **The contract test**: fail on a positional `$N` inside a fenced shell or awk block in any SKILL.md.
   Prose like "$30" must pass. Scope it to code fences, or allowlist.
3. **Live probe (why this is hands-on, not a rollout):** after the plugin cache holds the change, run
   `/thread:close some words here` in a scratch repo and confirm the handoff scan runs uncorrupted. A
   rollout can't verify that in-run.
4. **Land it by PR** (ADR 0025): a branch, a green `make test (ubuntu-latest)` and `(macos-latest)`, then
   `gh pr merge --merge`. Run `/fresh-review` (floor `xhigh`) on the diff before merging, and honour the
   ledger's stop rule.
5. Then p5-3 (retire `~/repos/tools/thread-skill-rollout`, a session) and p5-4 (close and handoff on a
   protected default branch).

## 3. Decisions settled

- Scripts, not escapes: `$$2`-style escape probing was rejected as undocumented behaviour (gather,
  2026-09-26).
- Protocol 4 lands (P6); no release between p6-1 and p6-10.
- Master moves only by green PR, owner included (ADR 0025). Rulesets, not classic protection.
- ADR 0024's mechanics are open questions on p7-1. Don't settle them here.

## 4. Gotchas found the hard way

- **Claude Code substitutes skill arguments into `$0`, `$1`, … across the whole SKILL.md body,** awk's `$0`
  included. That's the bug. Until p5-2 lands, run close's scan snippets from the source file with `sed`,
  prefixed with `CLAUDE_PLUGIN_ROOT=<plugin root>` (THREAD.md § Known quirks).
- **Local master is one commit ahead of origin: this handoff doc.** Master refuses direct pushes, so cut the
  p5-2 branch from local master and it rides along. Delete this doc and the two consumed review docs
  (`docs/reviews/2026-09-26-56679f6-ad8453.md`, `…-d2b36d6-b59fd7.md`) in the same PR; that's the p5-4
  problem in miniature.
- **zsh eats `$var:r…`:** `"$p:refs/heads/x"` expands `:r` as a modifier. Write `"${p}:refs/heads/x"`.
- A peer session (`thread-skill-53`) was open in this checkout on 2026-09-26. Check `git status` and
  the current branch before switching branches.

## 5. Suggested skills

- `/thread:open` (pickup), `/fresh-review` before the merge, `/thread:close` at the end (on a branch).

## 6. Paste-ready prompt

```
You're continuing "thread-skill p5-2: snippets into scripts" mid-stream — a live handoff, not a cold pickup.
Run from: /Users/lachlants/repos/tools/thread-skill — launch the session there; a cd from another launch directory is reset.
Read first: /Users/lachlants/repos/tools/thread-skill/docs/handoffs/2026-09-26-p5-2-snippets-to-scripts.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The Thread Skill roadmap was just regathered into P5–P9 and p5-1 is done (repo public, CI on Ubuntu + macOS, rulesets: master moves only by green PR, owner included). p5-2 moves every SKILL.md shell/awk snippet that uses a positional $N into scripts, because Claude Code substitutes skill arguments into $0/$1/… and corrupts them. It's hands-on (needs a live /thread:close <args> probe), not a rollout. Local master is one commit ahead (this doc): branch from it.
Also read: ~/repos/obsidian/Work/Tasks/thread-skill-p5-2-snippets-move-to-scripts.md; THREAD.md § Where we are and § Known quirks; docs/adr/0025-master-moves-only-by-green-pr-owner-included.md
Suggested skills: /fresh-review (xhigh) before merging; /thread:close at the end, on a branch
Next move: git switch -c p5-2/snippets-to-scripts, then move close's handoff-scan helpers (skills/close/SKILL.md:77–86) into skills/close/scripts/ first.
```
