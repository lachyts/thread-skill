# 0042 — A parallel rollout always runs from its clone

Date: 2026-10-19
Status: proposed. Ruled with Lachy in the 2026-10-19 `/thread:orient Thread Skill` reshuffle grill, to be built as P26 (p26-2). Two clean-room review rounds followed, and the second stopped on its own regressions, so this record keeps to the decision. Its mechanics are P26's to settle against code, and the open review questions are on `thread-skill-p26-2-every-rollout-runs-from-its-clone`.

## Context

A parallel rollout's Project root has been the repo's own checkout, the one Lachy's sessions work in, except for a self-rollout, which runs from a separate clone `<repoPath>-rollout` (p12-4) so its merges never move the Primary checkout. During a window, the git-env canary (p14-6) holds the whole queue when the Project root's default branch moves in a way the rollout did not make: a local commit that is neither a fast-forward to `origin` nor close-out-shaped. It stays held until Lachy acks through `/thread:repair`.

On 2026-10-19, `agent-stable-rollout-2026-10-18` halted with two PRs left. It ran on `~/repos/workspaces`, where sessions commit to local master in place by house rule and the daily sweep commits there too. On a busy morning master moved every 10 to 20 minutes, which is shorter than one integrate window. Lachy acked twice, and both times master had moved again before the ack could run. No ack could finish that rollout: the canary was right, and the rollout shared its checkout.

## Decision

**Every parallel rollout scheduled after P26 runs from its rollout clone.** A rollout clone is a second full clone of the repository, a sibling of its toplevel (`<toplevel>-rollout`), never nested inside it. The self-rollout's clone is the first case of the rule, not an exception to it.

- **Peers keep their habits.** Peer sessions, the daily sweep and the workspaces memories (commit in place on master, let the sweep land it) stay as they are.
- **The canary keeps its rule.** Only the rollout moves its clone. Work on the plugin happens in a worktree, never in the clone. This narrows ADR 0031, whose "a worktree or the clone" predates the clone being every rollout's root.
- **The gates read the right checkout.** A local-only commit in the shared checkout must not halt a rollout that no longer runs there, unless the rollout's tasks need it.

## Considered options

- **A clone only for repos declared or detected as shared in place:** rejected. It is a judgement every schedule would have to make, and it misses the next repo that grows in-place sessions.
- **The canary tolerates local-only commits that descend from the armed sha and avoid the window's file-set:** rejected. The verify would have run on a tree that changed under it.
- **Workspaces gives way** (a hook refusing local master commits while a rollout runs there, which extends ADR 0031 to a rollout's Project root): rejected. It reaches into every peer session and the daily sweep to protect one lead.
- **Schedule refuses parallel rollouts on a shared in-place repo:** rejected. It strands parallel-shaped work there.

## Consequences

- **Each repo with rollouts gains a second checkout**, which has to be created, kept current and trusted, and launched into by the lead. It must never read as a thread.
- **Earlier rollouts keep their root.** A rollout scheduled before P26 keeps its Project root. One that cannot finish there, `agent-stable-rollout-2026-10-18` among them, takes `/thread:repair`'s clean defer of its started tasks, then `--regenerate` onto the clone.
