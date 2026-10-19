# 0042 — A parallel rollout always runs from its clone

Date: 2026-10-19
Status: proposed. Ruled with Lachy in the 2026-10-19 `/thread:orient Thread Skill` reshuffle grill, and to be built as P26 (p26-2).

## Context

A parallel rollout's Project root has been the repo's own checkout, except for a self-rollout, which runs from a separate clone `<repoPath>-rollout` (p12-4) so its merges never move the Primary checkout. The git-env canary (p14-6) holds the whole queue when the Project root's default branch moves during a window, until Lachy acks through `/thread:repair`.

On 2026-10-19, `agent-stable-rollout-2026-10-18` halted with two PRs left. It ran on `~/repos/workspaces`, where sessions commit to local master in place by house rule and the daily sweep commits there too. On a busy morning master moved every 10 to 20 minutes, which is shorter than one integrate window. Lachy acked twice, and both times master had moved again before the ack could run. No ack could finish that rollout: the canary was right, and the rollout shared its checkout.

## Decision

**Every parallel rollout runs from its clone.** Schedule § 0 resolves the Project root as `<repoPath>-rollout` for every repo, not only a self-rollout, and creates the clone on first use. A repo's primary checkout is never a parallel rollout's Project root.

- Peer sessions, the daily sweep and the workspaces memories (commit in place on master, the sweep lands it) stay as they are.
- The canary keeps its strict meaning: any move of the clone's default branch during a window is a trip, and only the rollout moves that branch.
- The clone usability checks `self-rollout-check.sh --resolve` already runs (a top-level, non-worktree checkout whose origin is the same GitHub repository) apply to every clone.

## Considered options

- **A clone only for repos declared or detected as shared in place:** rejected. It is a judgement every schedule would have to make, and it misses the next repo that grows in-place sessions.
- **The canary tolerates fast-forward descendants whose commits avoid the window's file-set:** rejected. The verify would have run on a tree that changed under it, and the canary would lose its one simple rule.
- **Workspaces gives way** (a hook refusing local master commits while a rollout runs there, which extends ADR 0031 to a rollout's Project root, with a clause added to the memories): rejected. It reaches into every peer session and the daily sweep to protect one lead.
- **Schedule refuses parallel rollouts on a shared in-place repo:** rejected. It strands parallel-shaped work there.

## Consequences

- Each repo with a rollout gains a sibling checkout on disk, kept current by the fetch the pushed-base check already runs.
- A rollout's hooks and the event logs it writes run from the clone, not from the live checkout's working tree. Anything that read them from the primary checkout must follow the Project root.
- The self-rollout gate becomes a special case of the rule. It still refuses a Project root that holds a live plugin checkout.
