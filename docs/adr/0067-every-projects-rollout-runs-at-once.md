# 0067 — Every project's rollout runs at once

Date: 2026-11-02
Status: proposed. Ruled with Lachy in two grills on 2026-11-02: the first in the ops-workspace orient-all session, the second in the spike session (`docs/spikes/2026-11-02-every-rollout-at-once.md`). To be built as Thread Skill's next phase. The technical calls below were decided for him from the spike's evidence and are listed at the end so he can overturn them. Supersedes ADR 0040's ruling "a chain that writes a repo checkout owns that checkout". Amends ADR 0059 (the project place becomes a prediction, and d5's accepted collision becomes a warned, recorded Note overlap) and ADR 0060 (its yield rule now sits beside rank). Leaves ADR 0064's one-clone-per-(repo, project) rule as it is.

## Context

The 2026-11-02 `/thread:orient-all` pass refused or never tried 23 of its 28 serial chains. One SEO chain's claim on `repo:~/repos/workspaces` blocked 17 projects that each touch one or two unrelated files in that monorepo. Narcissus's default `vault` claim blocked 7 vault-only chains. Lachy:

> We should be able to run a rollout for each project at exactly the same time, assuming we have resources and RAM ready to go, but the workspace shouldn't block that.

He ruled that a clash is only two runs editing the same file or note, for both shapes.

The spike found that the pass ran rules four days old. orient-all loads skills from the primary checkout, which one local commit had kept 95 commits behind origin, so it lacked ADR 0059, 0060, p33-3 and 0064. Re-planned on origin's rules, the vault chains all come apart, and 19 of 33 chains still clash. Every remaining clash is a checkout widened to its toplevel: `~/repos/workspaces` (15 chains), `~/.agents` (5), `~/Projects` (4). Today a claim anywhere in a checkout owns all of it, because Legs share its index and HEAD.

## Decision

1. **A clash is two runs editing the same file or note.** Sharing a repo, a monorepo or the vault never blocks, in either shape. Every other limit is capacity (decision 8).

2. **A serial chain works each repo it writes in its own Chain copy.**
   - A Chain copy is a git worktree of the repo's primary checkout, on branch `chain/<rollout-slug>`, at `~/.local/state/thread/chains/<repo-name>-<rollout-slug>/`. It sits outside `~/repos` and `~/Projects`, so no thread walk, rollout-clone prefilter, daily-sweep discovery or worktree reaper ever reads it.
   - Schedule makes it when it writes the chain, and records `chain_copies:` on the note. `leg.py begin` remakes a missing copy.
   - The copy links each gitignored config file (`.mcp.json`, `.claude/settings.local.json`) from the primary.
   - A row's launch folder maps to the same relative folder inside the copy, for begin's launch check, the hand-over and repair's restart.
   - `done` accepts commits in any of the chain's copies.
   - `leg_base` is stamped per copy the claim covers. A file token must never leave a code row unstamped and so unreviewed.
   - A row that writes two checkouts stays refused (ADR 0059 d4) until a launch can be granted both copies.

3. **A chain lands each finished task.** A new `leg.py land` runs after every `done` and at every close, under a per-repo lock held in the repo's common git directory:
   - merge the primary's local default branch into `chain/<slug>` (always a merge, never a rebase, so `leg_head` stays an ancestor);
   - re-run the landed tasks' Verify lines in the copy;
   - fast-forward the primary's default branch to it, never autostashing, retrying when it moved.
   
   A conflict the Leg cannot resolve, or a peer's uncommitted edit on a landed file (git then refuses the fast-forward), leaves the task unlanded. It retries at the next `done` or close, and Complete waits until everything has landed.
   
   The landing route is always read from the primary, never the copy. The end state is today's commit in place on the primary's default branch, so ADR 0028 is unchanged: the sweep pushes a swept repo, and a pushable repo keeps the land-chain follow-on. At Complete the copy is removed and its branch deleted with `-d`, never `-D`.

4. **Claims are files.**
   - **The token.** A surface inside a checkout is `repo:<toplevel>//<path in it>`, the toplevel being the in-place twin's, so the token reads the same from any copy. A trailing `/` makes it a folder. A bare `repo:<toplevel>` stays legal, covers every file under it, and is what a declaration that names a whole checkout gets.
   - **Predicted claims** are made at schedule: declared `surfaces:` and the paths a task's body names. They group, order and wait. They never refuse a schedule. A task that names no paths predicts nothing in a checkout.
   - **Actual claims** are the paths of the Leg's `Task:` commits since `leg_base`. They are published to the note at each `done` and checked against other live chains' unlanded files before landing.
   - **The backstop** is git's merge at landing plus the re-run Verify lines. They catch the cross-file clash a file set cannot see.

5. **Bookkeeping is never a claim.** Tracked files every run appends to are no surface, the same as `Work/Tasks` in the vault (ADR 0059 d2). These are the workspaces `_shared/state/thread-events/*.jsonl` and the review ledgers.

6. **The vault: a Note overlap is let through, warned and watched.** Vault runs write the live vault, with no copy. A project's place (ADR 0059) becomes a predicted claim, so two chains of one project may run side by side. Ruled with Lachy on 2026-11-03, after review found the planned wait cannot be built: "I'm happy to be led by you … and for us to track this so that we can see the impact."
   - **Nothing in the vault waits or is refused.** A hook has to answer within seconds, while a holder's task can run 40 minutes, so a real wait cannot be built. A hook that runs past its limit lets the edit through anyway. A refusal would leave half-done tasks in the live vault, with no copy to roll back. It would also turn a shared note such as the Day note into a queue that every vault run waits in.
   - **The warning.** The plugin's PreToolUse hook on Edit, Write and MultiEdit records which live run's task has written each vault note. Each record runs from the task's first write until that task is done or set aside, or its Leg is lost. When another run's edit meets such a note (another run is another rollout: Decided for Lachy 9), the hook lets it through and tells its agent which run is in the note, and to re-read it before changing it. Claude Code's own refusal to save over a file changed since it was read keeps the two edits from overwriting each other blindly. A record that outlives its run costs no more than a spurious warning.
   - **What it misses, accepted.** Script and shell writes pass no hook, and neither do Codex Legs, which have no Claude Code hooks. The vault's git backup and Obsidian's version history keep any note those writes muddle recoverable.
   - **Watched.** Every warned overlap goes in the Run record, naming the note and both runs. The weekly Reflection reports the week's overlaps (how many, which notes, which runs) and reports none when there were none.
   - **When copies come.** Vault copies (Considered options) are built once the record shows an overlap that left a note wrong, or overlaps in two weeks running.

7. **Parallel rollouts keep ADR 0064.**
   - Two projects' parallel rollouts already run side by side on one repo, each in its own clone. Their Integrations pass one at a time per origin, and Integration reconciles a shared file at merge.
   - A second rollout of the same project on a repo still supersedes the first. It joins that one queue and refuses no work, since the two would share one clone's worktrees and canary.
   - A chain landing on the primary and an Integration landing through origin each re-check the base they land on: the fast-forward in one case, merge-task's base pin in the other.

8. **Capacity is the limit, set automatically.**
   - **What counts.** One Mac-wide Capacity bounds parallel task starts, Leg task claims and full suites. Legs now count, behind a Leg lease, so a dead Leg drops out of the count. Interactive sessions count as load and are never refused.
   - **How it moves.** Capacity rises by one about every 10 minutes while every signal is green. It halves on a yellow signal: memory-pressure warning, swap growing, load above 1.5× cores by day, or suites slowing against their median. It freezes on thermal heavy or a memory warning. Thermal trapping or memory critical also stops slotted suites, as the Heat hold does today.
   - **Quota.** A start waits while its lead's Login is inside its line.
   - **Bounds.** Capacity never goes below 1, nor above a hard maximum tuned from the Run record. Away raises its target.
   - **Who measures and who decides.** Chorus measures and writes `~/.config/thread/capacity.json`. thread-skill's `next` and `leg.py` decide, so a rollout run from a terminal obeys too.
   - **Failure.** A missing, stale or unreadable reading falls back to today's fixed Trickle and Away cap, never to open.
   - This replaces the fixed day Trickle of 2 (Chorus ADR 0104 d2), so Chorus records the matching change.

9. **Same-file waits go by rank, wait-die.** These are code files only: the vault never waits (decision 6).
   - **The rank.** orient-all stamps its rank on each rollout note it dispatches (`estate_rank:`, with the pass time), and each later pass re-stamps the live ones. A standalone schedule ranks below every stamped rollout, and ties go to the earlier schedule.
   - **A higher-ranked run** that meets a lower-ranked holder waits for the holder's task to finish and land, then goes first among the waiters.
   - **A lower-ranked run** that meets a higher-ranked holder does not wait. It sets that task aside to retry later, keeping its rank, and moves to another claimable row. So no two runs ever wait on each other.
   - **No preemption.** Nobody is stopped mid-task.
   - **Aging.** A run that has waited past a set time is lifted a rank, so nothing starves.
   - **ADR 0060's rule still comes first.** Whoever released a place yields it, and rank orders only fresh contention.

## Considered options

- **Vault copies**, with each vault run writing a git worktree of the vault and landing by merge. This is watertight for same-note clashes, scripts included. Rejected for now (Lachy, "Wait, and watch it"):
  - a run's notes would reach Obsidian and his phone only at each landing;
  - 26 vault-writing hooks and skills would have to be re-pointed;
  - landings would have to commit around his uncommitted Sync edits (60 notes on 2026-11-02).
  
  It is built if decision 6's record shows real clashes.
- **A Note wait** (the edit pauses until the other run's task is done): rejected 2026-11-03. A hook cannot hold an edit for the length of a task, and one that runs past its limit lets the edit through.
- **A refusing hook** (fail closed: the edit is refused, and the run retries or sets its task aside): rejected 2026-11-03. It leaves half-done tasks in the live vault, makes the Day note a queue every vault run waits in, and invites a shell write that no hook sees.
- **Strict vault claims** (runs that might share a note never run together): rejected. It brings back the wide claims Lachy ruled out.
- **A clone per chain**, in place of a worktree: rejected. It needs a fetch to see the primary's default branch, and a push into a checked-out branch is refused. A worktree shares objects and refs, so integrating costs nothing.
- **A write-time lease for code files**: rejected. Bash edits, generators and formatters bypass it, and leases taken mid-task are hold-and-wait. Code relies on the landing check instead (decision 4), which is the commit-time guard prior art points to (MCP Agent Mail).
- **Landing by rebase**: rejected. It rewrites the hashes the Leg's HEAD guard anchors on.
- **Wound-wait** (a higher-ranked run stops the holder): rejected. Stopping an agent mid-task throws away minutes of work.
- **Predicted claims that refuse a schedule**: rejected. Prediction over-reaches on folders and misses new files, so it orders runs and the landing check decides.

## Consequences

- **The orient-all evidence above came partly from a stale install.** A primary checkout that cannot fast-forward keeps every merged rule out of the installed plugin. Bringing it current, and keeping it so, is the build's first task: the Primary refresh (ADR 0066), which moves it once the live rollouts are quiet.
- **Cross-repo work.**
  - Workspaces' launch markers and generated `AGENTS.md` hard-code the primary's paths, and Chorus passes them on as a Session's folders (Chorus ADR 0026). The marker generator has to emit repo-relative paths, which Chorus resolves against the marker.
  - Chorus writes `capacity.json`, and records decision 8 against Chorus ADR 0104.
- **A copy is isolated for files, not for live infrastructure.** Hooks, skills and the 57 workspaces scripts with absolute paths run from the primary. So a change to them is tested in the copy and takes effect only once it lands.
- **Token consumers change together.** These are `serial-chains.py` (claim, `overlaps`, the launch choice), `unfinished-rollout.py`, `leg.py` (`stamp_bases`, `done`, hold, write set), `reconcile-rollout.py` `_serial_root`, status, repair, the serial template and their tests.
- **Limits.**
  - A cross-file clash that no Verify line covers can still land.
  - A vault note written by a script can still collide.
  - A lower-ranked run's set-aside costs it the time until it retries.

## Decided for Lachy

1. Chain copies are git worktrees under `~/.local/state/thread/chains/`, not clones. They are cheaper, and integrating needs no fetch.
2. A chain lands each task on the primary's local default branch, just as its commits land today. So nothing new pushes unattended.
3. Predicted claims only order runs. The real check is at landing, because prediction misses new files.
4. Same-file waits are wait-die by rank. Nobody is ever stopped mid-task, and two runs can never wait on each other.
5. Capacity rises and falls on its own with heat, memory, load and quota. It replaces the fixed day Trickle of 2, and falls back to it if a reading fails.
6. Rollouts of the same project on one repo still share one queue. A second clone would buy nothing.
7. A vault overlap is let through with a warning, never refused. Two runs in one note is expected to be rare, and a muddled note is recoverable from the vault's git backup and Obsidian's version history.
8. Vault copies are built on the first overlap that left a note wrong, or on overlaps in two weeks running. Until then the weekly Reflection's report is the investigation, and no other spike runs.
9. Another run is another rollout. A Note overlap is warned and recorded only between tasks of two different rollouts, so two tasks of one parallel rollout in one vault note are neither warned nor recorded, and never count toward decision 6's trigger for vault copies. ADR 0059 d5's collision was between chains, and each serial chain is its own rollout note. Overturning this means warning between two tasks of one rollout as well.
