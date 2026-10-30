# 0055 — A serial chain runs its completion verifier on its checkout's HEAD

Date: 2026-10-27
Status: accepted. Planned and reviewed over three plan rounds for the vault task `thread-skill-p32-2-a-serial-chain-runs-its-completion-verifier`, a follow-up from the completion verifier's fresh review (finding 9). Extends ADR 0052 to serial chains, and amends ADR 0040's "no task worktrees" with one detached verify tree that is not a task worktree.

## Context

A project whose `verifier:` is a declared fast tier names its full suite as `completion_verifier:`, and a parallel rollout runs it once on merged main at its completion ceremony (estate ADR 0009 d6, ADR 0052). A serial chain's Complete (`skills/execute/legs.md` § Complete) never ran it, and `serial-rollout-template.md` had no key, so schedule never stamped it on a `shape: serial` note. A fast-tier project rolled out serially therefore never ran its full suite.

A serial chain differs from a parallel rollout in four ways that matter here. Its note has no `Project root:`. Its chain never pushes: its Legs commit in Lachy's in-place checkout, and Complete's land follow-on is where those commits wait for him (ADR 0028). It runs no Integration. And it has no heartbeat: a Leg is a visible session that ends its turn and waits for a notification, with no cron to re-enter it.

## Decision

**A serial chain whose note declares `completion_verifier:` runs it once in its Complete Leg, before the note reads done, through the same `reconcile-rollout.py completion-verify` read and `--run` (ADR 0052), on its one checkout's HEAD.**

- **Stamping.** schedule § Serial path S4 stores the key only for a chain with exactly one `repo:` token that is a git toplevel (`git -C <token> rev-parse --show-toplevel` prints the token itself, the test leg.py's claim stamps a `leg_base` by): the `Completion verifier:` line of that checkout's `CLAUDE.md`, with its `Env bootstrap:` line beside it. S5 stamps them quoted and runs `verify-timeout` on the note. Zero, several or a non-toplevel `repo:` token stores nothing, and that chain's Complete runs as before.
- **"Merged main" is HEAD.** The chain never pushes, so its merged main is its checkout's HEAD as `--run` starts. Attempt 1's sha is that HEAD; attempt 2 re-runs the red run's sha, as ADR 0052 says.
- **No origin read and no canary.** `--run` runs no `default-branch.sh`, no fetch and no git-env canary for a serial chain. The canary's window watches a shared checkout a parallel lead does not own. A chain's Legs work in that checkout, and the HEAD guard below is its check.
- **The HEAD guard.** Before anything runs, `--run` checks that the resolved sha (never the symbolic HEAD) holds the chain's work. Every done linked task with a `leg_base` in the checkout anchors it:
  - its `leg_head` there: `leg.py done`'s new stamp, per checkout the task's own newest `Task:`-trailered commit (`change_of`'s last commit, no extra git call);
  - none when it committed nothing there (`leg_head: []`);
  - its `leg_base`, only when it has no `leg_head:` key at all: a task done before this ADR.
  Each anchor must resolve and be an ancestor of the sha. A checkout no done task has a `leg_base` in is not one of the chain's checkouts. Either refusal is exit 1, nothing run or recorded, with its remedy: check out the branch that holds the commits, then `leg.py clear-halt`.
  - The anchor is never the checkout's HEAD at `done`. That HEAD can be a peer's commit made between the task's commit and its `done`, which a later amend or reset drops while every chain commit stays, so the guard would refuse a HEAD that holds all of the chain's work.
  - The guard cannot use leg.py's `chain_commits` either: `commits_for` reads `<base>..HEAD`, and once HEAD has moved off the chain's work it finds nothing, so the guard would pass exactly when it should refuse.
- **Paths outside the working tree.** The detached tree is `<state>/thread/completion-trees/completion-<rollout>-<n>` (`THREAD_COMPLETION_TREE_DIR` when it is absolute, else `XDG_STATE_HOME`'s or `~/.local/state`'s `thread/completion-trees`). The out and kept logs are `<git common dir>/thread/completion-<rollout>-<n>*`, beside the attempt's lock. A peer's `git add -A` in the in-place checkout therefore never stages an embedded repo or a log. The verify tree is a detached verify tree, not a task worktree, so ADR 0040's "no task worktrees" ruling stands.
- **`--wait`.** A Leg has no heartbeat. A `--run` killed outright (SIGKILL, or a CLI respawn after a usage limit or a Login switch) leaves its verify holding the attempt's lock until its deadline, and no task of the resumed session would ever notify it. A new read-only `completion-verify --wait [SECONDS]` (default 7000, inside the background command's 7200000 ms cap and past any attempt's verify under ADR 0052's budget) blocks while the attempt is in flight, then prints the read. The Leg launches it in the background whenever the read says `in-flight` and no `--run` or `--wait` of its own still runs, and after `--run` exits 3. It writes, arms and records nothing. Still `in-flight` after the full wait is a halt (`completion verify: in flight past its deadline`), not another wait: whatever holds the lock outlived every budget.
- **The Leg's rules** (`legs.md` § Complete's block). `absent` or decided goes to step 1, and a red's fix task goes in the Leg's report: the chain completes either way, since each task passed its own Leg verify. `run` or `rerun` launches `--run`. A no-verdict result relaunches at once, since the slot wait is the pause. The halts are `completion verify: no verdict in three runs`, `completion verify failed: <its ERROR line>` (exit 1), `completion verify: rollout note unreadable` (exit 2, or the read's exit 1 or 2) and `completion verify: in flight past its deadline`. A `--run` or `--wait` end is acted on only while the block is the Leg's current step.
- **`leg.py close --outcome complete` refuses an undecided verify** (`the completion verify is not decided (<state>, attempt <n>)`) and a value the reader refuses. A decided one's summary is a Completion log line, and a red's fix task (`completion-red-<rollout>.md`, when it sits in the tasks root) joins the vault commit. A note without the key completes byte-for-byte as before.
- **The fix task's words.** A serial red's fix task names the chain's checkout and says each task passed its own Leg verify, never merged main or an Integration.

## Considered options

- **origin/<default>, as the parallel path does.** Rejected: the chain never pushes, so origin holds none of its work, and the suite would verify a tree without it.
- **Running the suite in place, in the checkout.** Rejected: it runs on Lachy's working tree, with his uncommitted changes and a peer's edits mid-run, and a suite's writes would land there.
- **Arming the git-env canary.** Rejected: a chain's own Legs move the shared checkout by design, and the HEAD guard checks what matters, that the verified sha holds the chain's commits.
- **The tree under the checkout's `.claude/worktrees/`**, as the parallel path keeps it. Rejected: a checkout that does not ignore `.claude/` would stage an embedded repo on a peer's `git add -A` during the run.
- **The guard on `chain_commits`.** Rejected: it reads `<base>..HEAD`, which is empty once HEAD has moved off the chain's work.
- **The checkout's HEAD at `done` as the anchor.** Rejected: a peer's commit there, later amended or reset, makes the guard refuse a HEAD that holds every chain commit.
- **A branch or reflog scan** for the chain's commits. Rejected: it is slow and depends on refs a peer may prune, and the per-task anchor already names exactly what must be held.
- **A shell poll loop in the Leg's prose instead of `--wait`.** Rejected: it is untestable, and a foreground `sleep` is blocked in the harness.
- **An unbounded wait.** Rejected: a lock held past every budget is a process to look at, and an unbounded wait would leave the Leg waiting forever with no sign.

## Consequences

- repair and status are unchanged. repair § 7 (c) shows the halted Leg's `closed: halted:` line, cut at leg.py's 200 characters; the Leg's one needs-you push carries the whole ERROR line with its remedy. A status § 5 `Completion verify:` line for serial chains is left for a follow-up.
- `--run`'s `git worktree prune` now runs against Lachy's in-place checkout's worktree registry. It drops only that repo's stale entries whose directories are gone; locked ones stay.
- `leg.py done` stamps `leg_head` on every chain task note with a `leg_base` entry, not only on notes that declare a verifier. It is cheap, and status, serial-score, repair and `change` ignore it. In a non-linear local history (a merge inside the in-place checkout) it does not imply an older trailered commit on another branch, the same limit `commits_for`'s range already has.
- False refusals come only from a deliberate rewrite of the chain's own commits after `done` (land.sh never rebases them); the remedy is in the ERROR line. A reset that drops commits above every `leg_head`, none of them the chain's, is not checked.
- **Parent-directory resolution differs from the parallel path.** The serial tree sits under `~/.local/state/thread/completion-trees/`, outside the project directory; a parallel rollout's sits inside the checkout at `.claude/worktrees/`. A suite that resolves things by walking up the parent directories (Node finding the checkout's `node_modules`, a parent `pyproject.toml`, `.tool-versions` or `.nvmrc`, tools that find config by walking up) can go red on a serial chain only, unless the chain's `Env bootstrap:` (stored by S4 beside the verifier, and named in the template's `# env_bootstrap:` comment) sets the tree up. A red from this cause is a setup gap, not a Flake. Nothing in code detects it: its fix task's log shows it, and the remedy is the project's `Env bootstrap:` line.
- A no-verdict result relaunches at once, with no heartbeat to space the runs: a Mac that stays hot loops one turn per slot wait (about 50 minutes).
- `leg.py begin` does not validate the completion keys at every entry, so a hand edit after schedule halts at Complete. S5's `verify-timeout` catches a bad stamp at schedule time.
