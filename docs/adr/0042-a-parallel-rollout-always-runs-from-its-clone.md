# 0042 — A parallel rollout always runs from its clone

Date: 2026-10-19
Status: accepted. Ruled with Lachy in the 2026-10-19 `/thread:orient Thread Skill` reshuffle grill, built by P26 (p26-2, `thread-skill-p26-2-every-rollout-runs-from-its-clone`, whose approved plan settled the review questions against code). This record keeps to the decision; the mechanics live in the files below.

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

## Mechanics (p26-2)

- **The clone's one script** is `skills/execute/scripts/self-rollout-check.sh`, whose header states every mode: `--resolve` (read-only, exit 4 when no clone exists yet, 5 for no GitHub origin), `--ensure` (schedule § 0 makes, re-checks and fast-forwards the clone after Lachy's yes, and notes the gitignored local state it lacks; nothing is copied), `--refresh` (execute § 2.7), `--refresh-in-place` (the twin), `--launch-check` (execute § 2.8) and `--in-place` (the one "is this a clone, and what is its twin" rule). `~/Projects` itself is never a Project root.
- **Schedule § 0** runs the remote, gh and landing-register checks on `Local:` first, so a repo they refuse is never cloned, then `--resolve` and `--ensure`, then pushed-base and unfinished-rollout against the clone (`skills/schedule/SKILL.md` § 0).
- **The gates read the right checkout.** `skills/_shared/scripts/pushed-base.sh` treats a clone root's other clones as peers that block only on a path a not-yet-merged task cites (`reconcile-rollout.py cited`, execute § 2.7), never through a cited directory; execute § 2.8 halts a lead launched outside the Project root.
- **Threads and homes.** open's § Repo-thread lookup ports `--in-place` as `rc` (its parity is pinned), so a clone's THREAD.md copy is never a thread; `handoff-home.sh` rule 0, `resolve-target.py`, close's rungs and step 7.2, and process-scan read a directory in a clone as its twin's, so no session commits on a clone's default branch.
- **Readers.** escapes.py reads git from the twin only when the twin's `origin/HEAD` is strictly fresher, and review docs from both checkouts; the canary arms only the clone (`tests/git-env-canary.test.sh` pc1-pc4).

## Consequences

- **Each repo with rollouts gains a second checkout**, which has to be created, kept current and trusted, and launched into by the lead. It must never read as a thread.
- **The in-place twin is kept current.** merge-task runs `self-rollout-check.sh --refresh-in-place` after every merge, and the completion ceremony once after its done stamp: `fetch` and `merge --ff-only --no-autostash` only, held while the twin is the primary checkout under a running rollout (ADR 0031). A diverged twin is never integrated here, swept or not: it is reported with a remedy that follows its landing route (`land.sh --route`): a commit-only twin (swept, or on the landing register) gets the `git merge --no-edit origin/<default>` advice, a landable one waits for its queued landing PR, which the next merge-task or land.sh S4 fast-forwards.
- **Workspaces diverges until the sweep integrates.** On `~/repos/workspaces`, peer commits on master plus the rollout's merges make the twin diverge routinely, and the daily sweep's push then fails (it did every day from 2026-10-10 to 2026-10-16, before P26). The fix is the sweep's: `push_repo` integrates origin before it pushes, a follow-on outside this repo (`workspaces-sweep-integrates-origin-before-push`).
- **Earlier rollouts keep their root.** A rollout scheduled before P26 keeps its Project root. One that cannot finish there, `agent-stable-rollout-2026-10-18` among them, takes `/thread:repair`'s clean defer of its started tasks, then `--regenerate` onto the clone.
