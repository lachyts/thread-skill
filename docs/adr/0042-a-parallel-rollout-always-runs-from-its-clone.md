# 0042 — A parallel rollout always runs from its clone

Date: 2026-10-19
Status: proposed. Ruled with Lachy in the 2026-10-19 `/thread:orient Thread Skill` reshuffle grill, sharpened the same day after a clean-room review of the first write-up, and to be built as P26 (p26-2).

## Context

A parallel rollout's Project root has been the repo's main checkout, except for a self-rollout, which runs from a separate clone `<repoPath>-rollout` (p12-4) so its merges never move the Primary checkout. During a window, the git-env canary (p14-6) holds the whole queue when the Project root's default branch moves in a way the rollout did not make: a local commit that is neither a fast-forward to `origin` nor close-out-shaped. It stays held until Lachy acks through `/thread:repair`.

On 2026-10-19, `agent-stable-rollout-2026-10-18` halted with two PRs left. It ran on `~/repos/workspaces`, where sessions commit to local master in place by house rule and the daily sweep commits there too. On a busy morning master moved every 10 to 20 minutes, which is shorter than one integrate window. Lachy acked twice, and both times master had moved again before the ack could run. No ack could finish that rollout: the canary was right, and the rollout shared its checkout.

## Decision

**Every parallel rollout runs from its rollout clone.** A repo's rollout clone is a full clone of the repository at `<toplevel>-rollout`, a sibling of the repo's toplevel. It is never placed inside the toplevel, even when the project's `Local:` path is a subdirectory, and in that case the Project root is the same subdirectory inside the clone. Schedule § 0 resolves the Project root to it for every repo, not only a self-rollout. When the clone is missing, schedule creates it by cloning `origin`. That one `git clone` is the only write outside the vault that schedule's Scope gains. A repo's main checkout is never the Project root of a parallel rollout scheduled after P26.

- **Peers keep their habits.** Peer sessions, the daily sweep and the workspaces memories (commit in place on master, the sweep lands it) stay as they are.
- **The canary keeps its rule as written.** Fast-forwards to `origin` and close-out-shaped commits are benign; any other move of the clone's default branch during a window is a trip. Only the rollout moves the clone. Work on the plugin happens in a worktree, never in the clone (this narrows ADR 0031, whose "a worktree or the clone" predates the clone being every rollout's root).
- **The clone's checks apply everywhere.** `self-rollout-check.sh --resolve` already checks a clone's usability: a top-level checkout, not a linked worktree, with the same GitHub origin as the main checkout. Those checks now apply to every clone.
- **The pushed-base gate stops only on what agents need.** Commits on the main checkout's local default branch that are not on `origin` stop schedule and execute only when they touch a task's cited paths, since agents branch from `origin` and would miss them. Other local-only commits there are a pre-flight `WARN`. On `~/repos/workspaces` that is the norm, and none of those commits reach the clone.

## Considered options

- **A clone only for repos declared or detected as shared in place:** rejected. It is a judgement every schedule would have to make, and it misses the next repo that grows in-place sessions.
- **The canary tolerates local-only commits that descend from the armed sha and avoid the window's file-set:** rejected. The verify would have run on a tree that changed under it, and the canary would gain a judgement about which files a window owns.
- **Workspaces gives way** (a hook refusing local master commits while a rollout runs there, which extends ADR 0031 to a rollout's Project root, with a clause added to the memories): rejected. It reaches into every peer session and the daily sweep to protect one lead.
- **Schedule refuses parallel rollouts on a shared in-place repo:** rejected. It strands parallel-shaped work there.

## Consequences

- **The lead launches in the clone.** A parallel rollout's lead must be launched inside the rollout clone, since a session's Bash resets a `cd` outside its launch directory and agents work in worktrees under the Project root. Execute's start refuses a lead whose launch directory is outside it. Orient's execute offer recommends a fresh session there, and offers "Here" only to a session launched in the clone.
- **Execute refreshes the clone at start.** Each entry fast-forwards the clone's default branch to `origin`, which needs a clean tree, so its CLAUDE.md, hooks and THREAD.md are current. The pushed-base fetch alone moves only remote-tracking refs.
- **Clones never read as threads.** The repo-thread lookup and the thread placement check skip every `*-rollout` sibling, as they skip `~/repos/workspaces`, so a clone's copy of a THREAD.md never resolves as a thread.
- **The clone carries the rollout's state.** A rollout's hooks, and the event logs it writes, run from the clone. Anything that reads them from the main checkout must follow the Project root.
- **Earlier rollouts keep their root.** A rollout scheduled before P26 keeps the Project root it was written with until it finishes, since the re-root guard refuses to move started tasks. The rule binds new schedules only.
- **The self-rollout gate becomes a special case.** It still refuses a Project root that holds a live plugin checkout.
- **Each repo gains a sibling checkout on disk.**
