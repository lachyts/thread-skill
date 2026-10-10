# The execution-fit test — which lane owns a cluster

One system, two dispatch lanes. Every cluster of open tasks gets exactly one:

- **The rollout lane** (`/thread:schedule` → `/thread:execute`): worktrees, PRs,
  the three-layer convergence engine, Integration and auto-merge.
- **The session lane**: scoped sessions dispatched by calendar and attention —
  `defer` (`scheduled:` dates do the dispatch), a task's `## Launch` block via
  `open`, or orient's parallel-safe cc-* batches.

**The test decides, hard.** It is not a preference and not a count. A cluster is
**rollout-shaped** when all three hold:

1. **One repo** — the tasks converge on ONE code repository.
2. **PR-per-task** — each task lands as an independently-shippable PR.
3. **In-run verification** — success is machine-checkable inside the run
   (tests / build / greps), not days later.

Rollout-shaped → the rollout lane, even for a single task: a one-task rollout still
buys the plan gate, the verifier retry loop, the master review, and auto-merge —
autonomous convergence on one PR. Not rollout-shaped → the session lane; a rollout
buys nothing there.

**Signs a task is NOT rollout-shaped** (any one disqualifies it):

- Its core action is an external publish — CMS, live site, DNS, config console.
  (These always pause at the human gate regardless — ADR 0008; execute § 3.7.)
- Its ordering constraint is a measurement window or calendar date, not file
  overlap. The engine's parallelism is forbidden by isolation windows, and
  the queue cannot see a window or calendar constraint.
- Its verification only arrives days or weeks later (impact measures) — the
  verifier loop has nothing to verify inside the run.
- It is conversation-gated: it needs Lachy's input before an agent can act
  (task-writer § 5 notes this in the body).

**Mixed sets split.** The rollout-shaped subset rolls out; the misfits stay
unstamped in the session lane. Name the split when reporting.

**Count is never a criterion.** There is no minimum rollout size — shape
decides, not size. (Decided 2026-08-12, ADR 0009; supersedes schedule's old
"<3 tasks" floor.)

## Dispatch blockers — rollout-shaped but not yet runnable

A cluster that fails a blocker is **still rollout-shaped**: do not route it to the
session lane. schedule § 0 runs these checks; callers that read this file
for the fit test route through schedule rather than checking themselves. The
schedule gate stops before anything is written (no task stamped, no rollout
note, no heartbeat) and names the remedy. Fix the blocker, then schedule again.
Six blockers:

**GitHub `origin`.** The engine branches every worktree from
`origin/<default branch>` and lands each task as a GitHub PR that merge-task
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
  *) echo "origin for $R is not a GitHub remote ($u): a rollout lands GitHub PRs, so point origin at GitHub (a path or other-host origin breaks gh pr create and merge-task)" >&2; exit 1 ;;
esac
# end thread:remote-check
```

On exit 1, stop and print its stderr line verbatim: that line is the remedy. On
success it prints the URL. Derive `<owner>/<name>` from it the way merge-task
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
execute § 4.5 re-runs it before every task call, Integration push and merge.

The check is lead-side, so it has limits. It re-runs before every task call, so a
repo listed while a task's Workflow call is in flight is caught only when that call
returns: until then the engine's agents keep pushing that task's branch and opening
its PR on it, and only the merge is stopped. For an
urgent mid-rollout listing, hard pause the rollout (execute § Pausing + reinstating a
rollout): pausing is exempt from the check, so it never blocks stopping work. One
repair step is deliberately ungated too: `/thread:repair` § 5's clean defer runs
`gh pr close --delete-branch` on a task the user chose to defer. That removes the
rollout's own branch and PR and lands nothing on the default branch, so, like a
pause, it is cleanup that the register never blocks.

**Self-rollout.** A rollout must never run against the checkout the plugin itself runs from. When the
repo path is, or contains, the plugin's live checkout (a **directory-source** marketplace,
`claude plugin marketplace add <dir>`, or a `--plugin-dir` session), `${CLAUDE_PLUGIN_ROOT}` IS that
checkout, so every engine or skill change a merge lands there becomes the engine of the rollout's next task
call (p12-4, ADR 0030). Run this against the same resolved path, after the landing register check:

```bash
# thread:self-rollout-check (extracted and tested by tests/self-rollout-check.test.sh)
R="<repoPath>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
sc="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh"
[ -f "$sc" ] || { echo "self-rollout-check.sh not found at $sc: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }
bash "$sc" "$R"
# end thread:self-rollout-check
```

`self-rollout-check.sh` compares two sources with the repo path (`~/` expanded, trailing slashes stripped,
symlinks resolved) by **containment**: `${CLAUDE_PLUGIN_ROOT}`, the root this session runs the plugin
from (so a `--plugin-dir` session the registry never lists is caught too), and every directory source's
`path` and `installLocation` in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/known_marketplaces.json`. A
path equal to the repo path or nested inside it (`<repoPath>/…`, a monorepo with the plugin in a
subdirectory) matches, since `merge-task.sh` fast-forwards the whole checkout. A missing registry passes; a
malformed one passes with a warning (the registry format is Claude Code's, so the check fails open). Exit 0
is no match: pass any warning on. Exit 3 is a match: what matched, the path, and the fix on stderr (make a
separate clone at `<repoPath>-rollout`, then run `/thread:schedule <project> --regenerate`, which re-roots
the rollout there; never hand-edit a Project root). Exit 2 is a failure of the check itself (the script
not found, an empty path, no python3), and any other non-zero exit fails closed the same way. schedule § 0 runs it before anything is written; execute § 2.6 re-runs it at every
launch and after every § 4.5 re-check of the landing register, since a written rollout note can still name
the primary checkout (one scheduled before this check, or edited by hand).

The separate clone always sits at `<repoPath>-rollout` (the repo path canonicalised as above, then
`-rollout` appended): the path the check's remedy names. On the check's exit 3, schedule § 0 looks for it
with this, against the same path:

```bash
# thread:rollout-clone (extracted and tested by tests/self-rollout-check.test.sh)
R="<repoPath>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
sc="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh"
[ -f "$sc" ] || { echo "self-rollout-check.sh not found at $sc: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }
bash "$sc" --rollout-clone "$R"
# end thread:rollout-clone
```

`self-rollout-check.sh --rollout-clone` (its header is the one statement of the rule) prints that path
(exit 0) only when it is a directory, the top of a git work tree, its own clone rather than a linked
worktree (its `--git-common-dir` is inside it), a GitHub clone of the same repository
(`land.sh --origin-slug` exits 0 for both trees and the two `<owner>/<name>` match, case-insensitively),
and holds no live plugin checkout itself. Nothing else is asked of it: its branch, its working tree (the
engine's own scratch included) and how far it is behind are no rollout's concern, since execute's
worktrees branch from a freshly fetched `origin/<default>` and the pushed-base check fetches every clone
and blocks a local default branch that is ahead. Any other state prints nothing and exits 1 with one
`self-rollout-check: <path> is not a usable rollout clone: <reason>` line naming the condition that
failed; exit 2 is land.sh or the script missing. It drops inherited repo-local git env first, and never
clones, fetches or writes. Only schedule § 0 swaps a root this way, and only before anything is written;
execute § 2.6 halts instead, since its rollout note is already written. The location is a convention, not
a setting: a clone anywhere else is not found.

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
registry source matters here: the self-rollout blocker above forces a separate rollout clone when the repo
path is a directory-source marketplace checkout, so the registry names the primary checkout then, and a
close-out committed in the primary is still seen (a `--plugin-dir` primary is in no registry: the project
note's `Local:` path, passed as `<localPath>`, covers it).

- **Exit 0** prints `pushed`; any notes and WARN lines on stderr pass through to the user.
- **Exit 3**: some known clone's local `<default>` is ahead of `origin/<default>` with content that
  `origin/<default>` lacks. Stop, and print the stderr verbatim: it lists the commits
  (`git log --oneline origin/<default>..<default>`) and the remedy. The remedy is to land them on
  `origin/<default>` by PR first (the default branch is PR-only, ADR 0025), then drop the local copies
  with `git reset --keep origin/<default>` (that clone on the default branch) or
  `git branch -f <default> origin/<default>` (not checked out). When that clone's HEAD is the default
  branch, close's `repo-state.sh` line is reused with merge-task's wording: commits **queued** in a
  `close/…` landing PR mean wait for GitHub to merge it (never a second PR); **stranded** ones must be
  landed; a split names both. Otherwise the remedy is the generic one.
  Ahead by ancestry alone is not a block: commits whose content already reached `origin/<default>` by a
  squash or cherry-picked PR (no file they touch, merges included, differs from `origin/<default>`) are a
  note naming that reset. Landed content that `origin/<default>` has since changed, and an ahead set that
  touches no file, still block.
- **Exit 2**: the check itself failed (a fetch, the default-branch lookup, a missing script). Stop, and
  print the stderr verbatim.

Each cited path is compared on its own, never batched: a relative path in every clone of the set, an
absolute or `~/` path in the clone that contains it (anything else, such as a vault note, is a note and is
never compared). For each pair it warns on an **uncommitted change** (`git diff HEAD` plus
`git diff --cached`), a file **committed on the checked-out branch** and still different on
`origin/<default>` (in `git diff origin/<default>...HEAD`, three-dot, so a checkout that is merely behind
stays silent, and in `git diff origin/<default> HEAD`, so a branch whose PR was squash-merged stays
silent too) and an **untracked** file (`git ls-files --others --exclude-standard`). Other local branches
that are not checked out are never read; the local `<default>` is covered by the block. A git failure on
one pair is a WARN for that pair only. THREAD.md is out of scope both ways: a cited THREAD.md is dropped, and ahead commits that
touch only THREAD.md are a note, not a block, since agents never read it.

The check runs `git fetch --prune` of `origin/<default>` and `origin/close/*` in every known clone, so it
moves remote-tracking refs only: no working tree, branch or HEAD changes. The prune drops the tracking ref
of a `close/…` branch deleted on origin, so its commits read stranded, never queued for ever. It runs
from schedule § 0 with no cited paths, again after schedule's step-2 detection with the cited paths, and
from execute § 2.7 at entry points only, never per merge: `origin/<default>` moves with every merge, and a close-out committed
mid-rollout must not halt an unattended run. Nothing names such a commit at each merge in the general case:
merge-task's local refresh reads only the rollout's repo path, so it names one committed there, but one
committed in another clone of the set (the primary checkout of a self-rollout's separate clone) first
surfaces when the next entry halts on it.

**Unfinished rollout.** A repo holds at most one unfinished rollout: one directly in `Work/Tasks/`, neither
`done` nor `dropped`, with a task not yet merged. schedule § 0 runs
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check` against the resolved repo path last,
after the pushed-base check, and its one stdout line decides: see schedule § 0 for each outcome (`none`,
`supersede`, `file`, `interrupted`, `refuse`) and its remedy. A running or never-superseded rollout on the
repo is a stop, never a second rollout beside it. Beside it sits orient § 6's *Uncommitted grill docs* hold:
`CONTEXT.md` or `docs/adr/` changes a grill left uncommitted in the target repo hold scheduling there too,
because every worktree branches from `origin`, which lacks them.

**Engine path.** The Workflow tool may refuse the plugin-cache `scriptPath`. That
depends on the harness and cannot be checked at schedule time; execute § 5
carries the scratchpad fallback.
