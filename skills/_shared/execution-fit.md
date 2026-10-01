# The execution-fit test — which lane owns a cluster

One system, two dispatch lanes. Every cluster of open tasks gets exactly one:

- **The rollout lane** (`/thread:schedule` → `/thread:execute`): worktrees, PRs,
  the three-layer convergence engine, per-wave auto-merge.
- **The session lane**: scoped sessions dispatched by calendar and attention —
  `defer` (`scheduled:` dates do the dispatch), a task's `## Launch` block via
  `open`, or orient's parallel-safe cc-* batches.

**The test decides, hard.** It is not a preference and not a count. A cluster is
**wave-shaped** when all three hold:

1. **One repo** — the tasks converge on ONE code repository.
2. **PR-per-task** — each task lands as an independently-shippable PR.
3. **In-run verification** — success is machine-checkable inside the run
   (tests / build / greps), not days later.

Wave-shaped → the rollout lane, even for a single task: a one-task rollout still
buys the plan gate, the verifier retry loop, the master review, and auto-merge —
autonomous convergence on one PR. Not wave-shaped → the session lane; a rollout
buys nothing there.

**Signs a task is NOT wave-shaped** (any one disqualifies it):

- Its core action is an external publish — CMS, live site, DNS, config console.
  (These always pause at the human gate regardless — ADR 0008; execute § 3.7.)
- Its ordering constraint is a measurement window or calendar date, not file
  overlap. The engine's parallelism is forbidden by isolation windows, and
  file-overlap wave computation cannot see window/calendar constraints.
- Its verification only arrives days or weeks later (impact measures) — the
  verifier loop has nothing to verify inside the run.
- It is conversation-gated: it needs Lachy's input before an agent can act
  (task-writer § 5 notes this in the body).

**Mixed sets split.** The wave-shaped subset rolls out; the misfits stay
unstamped in the session lane. Name the split when reporting.

**Count is never a criterion.** There is no minimum rollout size — shape
decides, not size. (Decided 2026-08-12, ADR 0009; supersedes schedule's old
"<3 tasks" floor.)

## Dispatch blockers — wave-shaped but not yet runnable

A cluster that fails a blocker is **still wave-shaped**: do not route it to the
session lane. schedule § 0 runs these checks; callers that read this file
for the fit test route through schedule rather than checking themselves. The
schedule gate stops before anything is written (no task stamped, no rollout
note, no heartbeat) and names the remedy. Fix the blocker, then schedule again.
Four blockers:

**GitHub `origin`.** The engine branches every worktree from
`origin/<default branch>` and lands each task as a GitHub PR that merge-wave
merges, so the target repo needs an `origin` on GitHub. A repo with no `origin`
(a `git filter-repo` seed, a fresh `git init`) fails, and so does one whose
`origin` is a local path (a clone of the live checkout) or another host. Run this
against the target repo:

```bash
# thread:remote-check (extracted and tested by tests/execution-fit-remote.test.sh)
R="<repoPath>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
u=$(git -C "$R" remote get-url origin 2>/dev/null) || {
  echo "no origin remote in $R: create one with: gh repo create <owner>/<name> --private --source \"$R\" --remote origin --push" >&2; exit 1; }
case "$u" in
  https://github.com/*|git@github.com:*|ssh://git@github.com/*) echo "$u" ;;
  *) echo "origin for $R is not a GitHub remote ($u): a rollout lands GitHub PRs, so point origin at GitHub (a path or other-host origin breaks gh pr create and merge-wave)" >&2; exit 1 ;;
esac
# end thread:remote-check
```

On exit 1, stop and print its stderr line verbatim: that line is the remedy. On
success it prints the URL. Derive `<owner>/<name>` from it the way merge-wave
does (strip everything through `github.com:` or `github.com/`, then a trailing
`.git`), then confirm GitHub can see the repo with
`gh repo view <owner>/<name> --json nameWithOwner`. That call uses the network,
so it stays outside the markers and the test. If it fails (gh not
authenticated, repo not visible, offline), the gate also stops and prints gh's
error.

**Landing register.** A rollout pushes a branch and merges a PR into the target
repo for every task, so it is never scheduled, dispatched or merged against a repo
on the landing register: the repos agents must not push to on their own (ADR 0028
§ Decision). Run this after the GitHub-origin check above, against the same repo
path:

```bash
# thread:register-check (extracted and tested by tests/execution-fit-remote.test.sh)
R="<repoPath>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
lr="${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/landing-register.py"
[ -f "$lr" ] || { echo "landing-register.py not found at $lr: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }
v=$(python3 "$lr" check "$R"); rc=$?
case "$rc" in
  0) echo "$v" ;;
  3) echo "$v: a rollout pushes a branch and merges a PR per task; unlisting is Lachy's call" >&2; exit 3 ;;
  4) echo "no GitHub origin in $R: run the remote check in skills/_shared/execution-fit.md § Dispatch blockers" >&2; exit 4 ;;
  *) exit 2 ;;  # any stderr already printed stands
esac
# end thread:register-check
```

It captures the reader's stdout only and never redirects its stderr, so the
reader's own warnings (no register file, a malformed entry) and its
`landing-register:` errors always show. Every snippet expands `~/` because rollout
notes carry `Project root: ~/...` and project notes a `Local: ~/...` line. On exit 0 it prints `land` (any warning the
reader wrote still shows): the repo may land. On any non-zero exit, stop and print
its stderr verbatim: that stderr is the remedy, or the reader's error. Exit 3 is a
listed repo (`listed <owner/name>: <reason>` plus the remedy), 4 is no GitHub
origin, and 2 is any failure of the check itself, where any stderr already printed
stands (python3 missing, exit 127, or a crash prints no `landing-register:` line).
Never read 2 or 4 as "not listed": only exit 0 permits a rollout. This is a blocker,
not a re-route: the session lane can't push to a listed repo either. A repo can be
listed after scheduling, so execute § 2.5 re-runs this check at every launch, and
execute § 4.5 re-runs it before every wave dispatch, Workflow call and merge.

The check is lead-side, so it has limits. A repo listed while a wave's Workflow is
in flight is caught only when that wave returns: until then the engine's agents keep
pushing task branches and opening PRs on it, and only the merge is stopped. For an
urgent mid-wave listing, hard pause the rollout (execute § Pausing + reinstating a
rollout): pausing is exempt from the check, so it never blocks stopping work. One
repair step is deliberately ungated too: `/thread:repair` § 5's clean defer runs
`gh pr close --delete-branch` on a task the user chose to defer. That removes the
rollout's own branch and PR and lands nothing on the default branch, so, like a
pause, it is cleanup that the register never blocks.

**Pushed base.** Rollout worktrees branch from a freshly fetched `origin/<default>`, and the agents
read only their task note, the rollout note and the repo: never THREAD.md, and never anything that exists
only in a local clone. So before launch, everything the tasks cite must be on GitHub. Run this against the
same resolved path, after the landing register check:

```bash
# thread:pushed-base-check (extracted and tested by tests/pushed-base.test.sh)
R="<repoPath>"
L="<localPath>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
db="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/default-branch.sh"
pb="${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/pushed-base.sh"
for f in "$db" "$pb"; do [ -f "$f" ] || { echo "pushed-base: $f not found: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }; done
b=$(bash "$db" "$R") || exit 2
bash "$pb" --also "$L" "$R" "$b" <citedPaths>
# end thread:pushed-base-check
```

`<localPath>` is the project note's `Local:` path, or empty. `<citedPaths>` is each cited path
single-quoted, or nothing. The check runs over a **clone set**, not one checkout: the repo path's own
clone, plus `<localPath>`, plus every directory-source plugin marketplace path in
`known_marketplaces.json` (read through `self-rollout-check.sh --list-dirs`, the one registry parser),
each kept only when its raw `origin` URL names the same `<owner>/<name>` and de-duplicated by real path. The
registry source matters here: execute § 2.6 forces a separate rollout clone exactly when the repo path is a
directory-source marketplace checkout, so the registry names the primary checkout exactly when a rollout
clone exists, and a close-out committed in the primary is still seen.

- **Exit 0** prints `pushed`; any notes and WARN lines on stderr pass through to the user.
- **Exit 3**: some known clone's local `<default>` is ahead of `origin/<default>`. Stop, and print the
  stderr verbatim: it lists the commits (`git log --oneline origin/<default>..<default>`) and the remedy.
  The remedy is to land them on `origin/<default>` by PR first (the default branch is PR-only, ADR 0025).
  When that clone's HEAD is the default branch, close's `repo-state.sh` line is reused with merge-wave's
  wording: commits **queued** in a `close/…` landing PR mean wait for GitHub to merge it (never a second
  PR); **stranded** ones must be landed; a split names both. Otherwise the remedy is the generic one.
- **Exit 2**: the check itself failed (a fetch, the default-branch lookup, a missing script). Stop, and
  print the stderr verbatim.

Each cited path is compared on its own, never batched: a relative path in every clone of the set, an
absolute or `~/` path in the clone that contains it (anything else, such as a vault note, is a note and is
never compared). For each pair it warns on an **uncommitted change** (`git diff HEAD` plus
`git diff --cached`), a file **committed on the checked-out branch** but not on `origin/<default>`
(`git diff origin/<default>...HEAD`, three-dot, so a checkout that is merely behind stays silent) and an
**untracked** file (`git ls-files --others --exclude-standard`). Other local branches that are not checked
out are never read; the local `<default>` is covered by the block. A git failure on one pair is a WARN for
that pair only. THREAD.md is out of scope both ways: a cited THREAD.md is dropped, and ahead commits that
touch only THREAD.md are a note, not a block, since agents never read it.

The check runs `git fetch` of `origin/<default>` and `origin/close/*` in every known clone, so it moves
remote-tracking refs only: no working tree, branch or HEAD changes. It runs from schedule § 0 with no
cited paths, again after schedule's step-2 confirm with the cited paths, and from execute § 2.7 at entry
points only, never per wave: `origin/<default>` moves with every merge, and a close-out committed
mid-rollout must not halt an unattended run (merge-wave names those commits after each wave, and the next
entry halts on them).

**Engine path.** The Workflow tool may refuse the plugin-cache `scriptPath`. That
depends on the harness and cannot be checked at schedule time; execute § 5
carries the scratchpad fallback.
