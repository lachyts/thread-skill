# Spike: every project's rollout runs at once

Date: 2026-11-02 · Handoff: `docs/handoffs/2026-11-02-every-rollout-at-once.md` · For: the ADR that supersedes ADR 0040's "a chain that writes a repo checkout owns that checkout"

## Question

Lachy's ruling (2026-11-02 grill): a clash is only two runs editing the same file or note, for both shapes. Sharing a repo, a monorepo or the vault never blocks. Can every project's rollout run at once on that rule, and what must change?

## Method

- Read origin/master at `29d2f2f` (worktree `thread-skill-wt-every-rollout`): ADR 0040, 0042, 0059, 0060, 0064; CONTEXT.md; `serial-chains.py`, `unfinished-rollout.py`, `leg.py`, `land.sh`, `reconcile-rollout.py`, `verify-slot.py`; Chorus `companion.py`, `cores_probe.py`, `burn.py`, `logins.py`; workspaces `daily-sweep.sh`, `vault-autosync.sh`, `launch-folders.json`.
- Re-ran orient-all's 28 serial batches (`serial-args.txt` from the 2026-11-02 pass) through origin's `serial-chains.py plan`, read-only, and computed every pairwise `overlaps` among the resulting chains (`docs/spikes/2026-11-02-replan.py`, run from the repo root with `serial-args.txt` as its argument).
- Read-only facts from `~/repos/workspaces`, `~/.agents`, `~/Projects` and `~/repos/obsidian` (git log, worktree list, ignored paths, sweep and autosync scripts).
- Prior art on the web (sources below).

## Result

### 0. The pass ran rules four days old

orient-all loads its skills from the primary checkout (`/Users/lachlants/repos/tools/thread-skill`, the directory marketplace). That checkout sat at `ef2ffb6` plus one local handoff commit, 95 commits behind origin: it lacked p33-1 (ADR 0059, vault chains claim their project places), p33-2 (ADR 0060), p33-3 (nested checkouts) and p33-4 (ADR 0064). Its merge-task refresh is fast-forward-only, so the one local commit kept it from moving. Every vault-only chain claimed bare `vault` for that reason alone.

Under origin's rules the same 28 batches give 33 chains:

| | 2026-11-02 pass (stale rules) | origin rules |
|---|---|---|
| Vault-only chains (Narcissus, Ikeda, personal admin, fresh-review, news scan, culture queue, health admin, house dance, obsidian-vault#0, next-action#1, chorus#0) | all `vault`, all clash | each its project place; **none clash** |
| Chains with any clash | 23 of 28 refused or untried | **19 of 33** |
| Clash causes left | `vault`, workspaces | `repo:~/repos/workspaces` (15 chains), `repo:~/.agents` (5), `repo:~/Projects` (4, a text-only monorepo) |

Every clash left is a checkout-toplevel widening (`serial-chains.py:420-422`, "its index and HEAD are what Legs share"). The vault is already note-level enough.

### 1. Serial chains: a working copy per chain

A git worktree per (chain, repo), never a clone: it shares the object store and refs, so integrating the primary's local `master` costs nothing, and a branch checked out in one worktree cannot move under another. Placed under `~/.local/state/thread/chains/` (outside `~/repos` and `~/Projects`, like ADR 0055's verify trees), so no thread walk, `-rollout` prefilter, sweep discovery (`daily-sweep.sh:239`) or worktree reaper (`:260`, `*/.claude/worktrees/*` only) ever sees it. `self-rollout-check.sh --in-place` already never reads a linked worktree as a clone (`:38-39`).

What has to change (file:line from the Leg-landing research):

- `stamp_bases` (`leg.py:1149-1162`) stamps only a `repo:` token that is a toplevel; a file token would get no `leg_base`, so `done` would ask no review and a code row would land unreviewed. It must stamp one base per covering checkout, keyed to the copy.
- `done`'s "changed `<top>`, not this Leg's checkout" (`leg.py:1527-1532`, legs.md:76) becomes "a top among this chain's copies".
- `commits_for` (`leg.py:1201-1219`) works unchanged if integration **merges** the primary's master in (a rebase breaks the `leg_head` anchors); exclude `^master` from the range so peers' commits raise no WARN.
- `land.sh --route` asked of a copy routes it landable, then S3 strands it `not landed: on chain/<x>` and `leg.py route` files nothing (`land.sh:265-275, 402`; `leg.py:1789-1835`). The route is asked of the primary (`git rev-parse --git-common-dir`), never the copy.
- **Landing**: a new `leg.py land` after each `done` and at every close: under a per-repo lock (`<git common dir>/thread/chain-land.lock`), merge the primary's local `master` into `chain/<slug>`, re-run the landed tasks' Verify lines in the copy, then `git -C <primary> merge --ff-only --no-autostash chain/<slug>`; retry when master moved, stand (unlanded, retried next `done` or close) on a conflict it cannot resolve or a peer's uncommitted overlap (git refuses the fast-forward then). The end state equals today's in-place commit on the primary's master, so ADR 0028 is untouched: a swept repo is pushed by the sweep, a pushable repo keeps today's land-chain follow-on.
- **Launch**: a row's folder maps to `copy + relpath(folder, primary)` for begin's check (`leg.py:1097-1103`), the hand-over cwd (`:1898`) and repair's restart.
- Cleanup at Complete, after landing: `git worktree remove`, `git branch -d` (never `-D`).

**The copy is only partly isolated on workspaces.** Launch markers (`.workspace-launch.json`) and generated `AGENTS.md` hard-code `workspace_dir`/`add_dirs` into the primary, and Chorus passes them through as the Session's extra directories (Chorus ADR 0026); every `.mcp.json` and `settings.local.json` is gitignored (116 ignored paths), so a fresh worktree has no MCP servers and Chorus refuses the marker; 34 global hooks and 57 tracked scripts hard-code `~/repos/workspaces`; 32 of 33 `~/.claude/skills` entries symlink into `~/.agents`. Fixes: the copy symlinks each ignored config file from the primary; the marker generator emits repo-relative paths (a workspaces change, with Chorus resolving them against the marker); a chain whose task edits live infrastructure (hooks, skills) tests its change in the copy, and it takes effect only once landed, as with any branch.

Tracked files every run appends to (`_shared/state/thread-events/*.jsonl`, `reviews.jsonl`) are written into the primary by scripts with absolute paths: bookkeeping, never a claim, like `Work/Tasks` in the vault (ADR 0059 d2).

### 2. Claim granularity

- Token: `repo:<twin toplevel>//<rel>`, keyed to the in-place twin's toplevel so it reads the same from any copy; `rel` normalised before `normpath` (which turns `//` into `/`, `serial-chains.py:166`); a trailing `/` is a directory. A bare `repo:<top>` stays legal and covers every file under it. `overlaps` adds same-key-and-prefix. Toplevel consumers (`serial-chains.py:870-875`, `stamp_bases`, `_serial_root` `reconcile-rollout.py:11629-11650`, schedule S4) derive the checkout from the key.
- Formed three ways, each with its job:
  1. **Predicted**, at schedule: declared `surfaces:`, S2's body-named paths (today the schedule session's own reading, `schedule/SKILL.md:957`). Used to group, order and wait, never to refuse. A task that names no paths predicts nothing in a checkout.
  2. **Actual**, at each `done`: the Leg's `Task:`-commit paths since `leg_base` (`change_of`, `leg.py:1201-1252`), published to the note before landing and checked against other live chains' predicted and actual unlanded files.
  3. **git merge at landing** is the backstop, and the landed tasks' Verify lines re-run on the merged tree catch the cross-file semantic clash a file set cannot see (Uber's SubmitQueue uses build targets for that reason; file sets schedule, the post-merge test gates).
- A write-time lease hook on Edit/Write alone was rejected for code: Bash edits, generators and formatters bypass it, and per-file leases taken mid-task are hold-and-wait (deadlock-prone). No shipped tool enforces file leases; MCP Agent Mail's advisory leases plus a commit-time guard are the closest prior art, and the design here is that guard.

### 3. Parallel rollouts

ADR 0064 already does this: two projects' parallel rollouts on one repo run side by side, each in its own clone, and Integration passes per origin through the Origin lane, merge-task's base pin keeping every merge correct. Integration is where a shared file reconciles (ADR 0040's fit-test reading). Left as is:

- Two rollouts of the **same** project on one repo: still one clone, so new work supersedes the unfinished one. That joins one queue, it refuses no work.
- Serial vs parallel on one repo: already disjoint (the clone is its own checkout, ADR 0042); with chain copies a chain's landing and an Integration both end on `master` and the base pin and the ff-only landing each re-check it.
- Serial chains landing on a pushable repo's origin are untouched (see § 1: they land on the primary's local master as today).

### 4. The vault

No working copy is possible: Obsidian Sync carries the live folder, and `vault-autosync.sh` merges the git remote into it every 30 minutes. Facts:

- **Different notes at once are safe.** Sync tracks each file on its own; autosync skips on `index.lock` and refuses a merge touching an uncommitted edit; `leg.py` commits the vault by pathspec (`leg.py:2036-2059`); no conflicted copies and no lock contention on record (235 autosync log lines since 10-27).
- **The same note at once cannot be made fully safe.** Nothing lands a vault change, so there is no gate to check at. Claude Code's Edit/Write refuse a file changed since it was read, so two agents' edits never silently overwrite each other through those tools; a script or Bash write has no such check. Sync merges a same-note clash with diff-match-patch by default (Obsidian 1.9.7+: or a conflict file, per device). Which notes a task touches is often unknowable ahead (a Day note, a contact, a hub note).
- What exists: ADR 0059 claims a project's place, so chains of different projects run side by side and two of one project wait; d5 accepted the cross-project same-note collision.
- **This is the one surface where "same note only" cannot be made fully safe** (the handoff's gate). Carried to Lachy rather than widened.

### 5. Capacity

- Serial Legs count toward neither the Trickle nor the Away cap (`_trickle_eligible`, `reconcile-rollout.py:4281`, requires `shape == parallel`; away.md), and their Verify suites take no verify slot.
- The Trickle is a fixed 2 by day (Chorus `companion.py:108`, Chorus ADR 0104 d2), the Away cap 4. Neither reacts to headroom; with ten rollouts open by day, eight run nothing.
- No RAM or quota signal admits anything. Heat (thermal pressure 2+) holds starts; Chorus's Cores line and Mac word report CPU and never act (Chorus ADR 0106 d4); Login room acts only at the wind-down line (Chorus ADR 0071, 0111).
- What it has sustained: 8-9 tasks at 5-minute load 212 on 12 cores (2026-10-27), a thermal freeze at 7 suites (2026-10-21, estate ADR 0009); today 96 GB, pressure level 1, 17.9 of 19.5 GB swap used.
- Governor: AIMD on a Mac-wide capacity C (Netflix concurrency-limits pattern). +1 every ~10 min while green; halve on yellow (memory pressure warn `kern.memorystatus_vm_pressure_level` = 2, swap growth, load above 1.5× cores by day, suite time inflating against its median); freeze on thermal 2+ or memory warn; stop slotted suites on thermal 3+ or memory critical (4). Per-Login quota (Chorus's burn forecast; statusline `rate_limits.*.used_percentage`) holds a start whose lead's Login is inside its line. C never below 1 and never above a tuned hard maximum. Units: a parallel task start, a Leg's task claim (behind a Leg lease, the reason Legs were left out), a full suite (verify slots sized from C). Interactive sessions are load, never refused. Chorus measures and writes `~/.config/thread/capacity.json` (signals, a suggested C, `written_at`) beside `away.json`; thread-skill's `next` and `leg.py` decide, so a terminal-run rollout obeys too. Missing, stale or unreadable → today's fixed 2/4, never open.

### 6. Same-file waits ordered by rank

- orient-all's rank (`estate-rank.py:93-116`) is persisted nowhere a Leg can read: `rank.json` lives in the pass's `mktemp` dir; the Grade log keeps a per-pass `rank?`.
- Stamp it on the rollout note at dispatch (`estate_rank:`, with the pass time); each later pass re-stamps every live rollout it ranks; a standalone schedule ranks below every stamped one, ties by schedule time.
- **Wait-die at task boundaries**: a Leg about to claim a row whose predicted files another live chain holds unlanded (predicted or actual) waits on a higher-ranked holder, and skips to another claimable row (or closes `waiting`) rather than wounding it; a running agent is never stopped mid-task (CoAgent: aborting an agent wastes minutes of inference). Against a lower-ranked holder it still never preempts: the holder's files free at its next landing, and the higher-ranked chain takes the place first among waiters. Priority inheritance: a low-ranked holder that blocks a higher-ranked waiter lands at its next `done` rather than its close.
- ADR 0060's "whoever released a place yields it" stays first; rank orders only fresh contention.
- Aging: a waiter's rank lifts after a set wait, so nothing starves.

## Ruled with Lachy

The vault's same-note clash (§ 4), grilled 2026-11-02: a best-effort Note wait (higher rank first), every wait and every note two runs both changed recorded for the weekly Reflection; vault copies (a git worktree of the vault per run, landed by merge) considered and held back until that record shows real clashes ("Wait, and watch it"). ADR 0065 records the decision and every technical call made for him.

## Sources

Claude Code worktrees and agent teams (code.claude.com/docs/en/worktrees, /agent-teams); MCP Agent Mail (github.com/Dicklesworthstone/mcp_agent_mail); git-worktree and git-config (git-scm.com); Uber SubmitQueue (EuroSys '19; arXiv 2501.03440); Mergify partitions (docs.mergify.com/merge-queue/partitions); GitHub merge queue docs; CoAgent (arXiv 2606.15376); CooperBench (arXiv 2601.13295); wound-wait / wait-die (Wikipedia, Emory CS 554); Obsidian Sync troubleshoot, settings and headless (obsidian.md/help/sync/*); Claude Code statusline `rate_limits` (code.claude.com/docs/en/statusline); Anthropic rate-limit headers (platform.claude.com/docs/en/api/rate-limits); Netflix concurrency-limits (github.com/Netflix/concurrency-limits).
