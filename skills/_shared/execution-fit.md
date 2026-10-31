# The execution-fit test — which lane and shape own a cluster

One system, two lanes, three outcomes. Every cluster of open tasks gets exactly one:

- **The rollout lane**: unattended work run from a rollout note (`/thread:schedule` →
  `/thread:execute`), in two shapes (ADR 0040):
  - a **parallel rollout**: worktrees, a PR per task, the three-layer convergence engine,
    Integration and auto-merge;
  - a **serial rollout**: a chain of Legs working its tasks one at a time.
- **The session lane**: work that needs Lachy present or waits on a date, dispatched by calendar
  and attention — `defer` (`scheduled:` dates do the dispatch), or a task's `## Launch` block via
  `open`.

**Plugin root.** This spec is read as a file, never rendered: run its commands by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

**The test decides, hard.** It is not a preference and not a count. It runs in order, and the
first outcome that holds wins:

1. **Session lane** — any one of these sends a task there:
   - It is conversation-gated: it needs Lachy present, for input before an agent can act
     (task-writer § 5 notes this in the body).
   - Its ordering constraint is a measurement window or calendar date, not file overlap. The
     engine's parallelism is forbidden by isolation windows, and the queue cannot see a window
     or calendar constraint.
   - Its verification only arrives days or weeks later (impact measures): nothing inside a run
     can verify it.
2. **Parallel-shaped** — all three clauses below hold, its core action is not an external publish,
   and it needs no external tool or launch profile the lead lacks (a parallel rollout's agents run
   on the lead session's tools):
   1. **One repo** — the tasks converge on ONE code repository.
   2. **PR-per-task** — each task lands as an independently-shippable PR.
   3. **In-run verification** — success is machine-checkable inside the run
      (tests / build / greps), not days later.

   Parallel-shaped → a parallel rollout, even for a single task: a one-task rollout still buys
   the plan gate, the verifier retry loop, the master review, and auto-merge — autonomous
   convergence on one PR.
3. **Serial-shaped** — everything else an agent can finish unattended:
   - a parallel clause fails: no PR per task (vault notes, or work spread over several repos), or
     no machine check inside the run;
   - its core action is an external publish (CMS, live site, DNS, config console);
   - it needs an external tool or launch profile the lead lacks.

   A shared surface, or tasks that build on each other, make work serial-shaped only when one of
   these already holds: a parallel rollout orders dependent same-repo tasks itself (`depends-on:`,
   Solo). Serial-shaped → a serial rollout.

**Rulings** (2026-10-19, ADR 0040 and the P24 plan review):

- (a) **An external publish is serial-shaped**, never parallel-shaped, even in one repo with a PR
  per task. It is an irreversible or credential gate: the gate sets the task aside for Lachy's
  sign-off while the chain goes on, and never passes the standing approval (ADR 0008, ADR 0034;
  execute § 3.7). A publish that needs him in the conversation is conversation-gated, so it is
  session lane.
- (b) A measurement window or delayed verification **waits on a date**, so it is session lane.
- (c) **No serial self-rollouts.** Serial-shaped work for the plugin's own repo (any checkout of
  `lachyts/thread-skill`) goes to the session lane. Its clone belongs to the parallel
  self-rollout (ADR 0031, ADR 0042). Orient § 6 applies this ruling now, before it calls schedule;
  schedule's serial path enforces it (`serial-chains.py` sends a member whose `## Launch` `--add-dir`
  or `cd` path, repo surface, launch folder or project `Local:` or `repos:` is a checkout of
  `lachyts/thread-skill` to the session lane).

**Mixed sets split.** The parallel-shaped subset becomes a parallel rollout, the serial-shaped
subset a serial rollout, and session-lane members stay unstamped. Name the split when reporting.

**Count is never a criterion.** There is no minimum rollout size — shape
decides, not size. (Decided 2026-08-12, ADR 0009; supersedes schedule's old
"<3 tasks" floor.)

## Dispatch blockers — parallel-shaped but not yet runnable

A cluster that fails a blocker is **still parallel-shaped**: do not route it to the
session lane or a serial rollout. schedule § 0 runs these checks; callers that read this file
for the fit test route through schedule rather than checking themselves. The
schedule gate stops before anything is written (no task stamped, no rollout
note, no heartbeat) and names the remedy. Fix the blocker, then schedule again.
Six blockers:

**Self-rollout.** Every parallel rollout scheduled after P26 runs from its **rollout clone** (ADR 0042): a
second full clone of the repository beside its toplevel, `<toplevel>-rollout`, never nested inside it, so a
peer session's commit in the in-place checkout never moves the tree a rollout integrates in; the
self-rollout's clone is the first case of that rule, not an exception to it. And a rollout must never run
against the checkout the plugin itself runs from. When the repo path is, or contains, the plugin's live
checkout (a **directory-source** marketplace, `claude plugin marketplace add <dir>`, or a `--plugin-dir`
session), `${CLAUDE_PLUGIN_ROOT}` IS that checkout, so every engine or skill change a merge lands there
becomes the engine of the rollout's next task call (p12-4, ADR 0030). Execute § 2.6 runs this blocker first,
on the Project root. Schedule § 0 runs the GitHub origin and landing register checks below on the `Local:`
path first (they key on the GitHub origin, which the clone shares, so a repo they refuse is never cloned),
then this snippet's `--resolve` and `--ensure`, which decide the path the pushed-base and unfinished-rollout
checks use:

```bash
# thread:self-rollout-check (extracted and tested by tests/self-rollout-check.test.sh)
R="<repoPath>"
M="<mode>"
case "$R" in "~"/*) R="$HOME/${R#\~/}" ;; esac
sc="${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/self-rollout-check.sh"
[ -f "$sc" ] || { echo "self-rollout-check.sh not found at $sc: is CLAUDE_PLUGIN_ROOT set?" >&2; exit 2; }
bash "$sc" $M "$R"
# end thread:self-rollout-check
```

`<mode>` is `--resolve`, then `--ensure`, in schedule § 0 (estate-scan.py runs `--resolve` too) and empty in
execute § 2.6. The plain mode and `--resolve` are read-only; `--ensure` writes only the rollout clone. The
script's header is the one statement of what matches, of what makes a clone usable, and of every mode.

- **`--resolve`** (schedule § 0, read-only): every git `Local:` maps to its rollout clone, `C[/<sub>]` (a
  sub-path kept; `C` is the toplevel itself when it already is a rollout clone). Exit 0 prints the usable
  clone. Exit 4 prints the would-be clone when none exists yet, its stderr naming the origin URL and, when it
  would sit inside another work tree P, a `nested in <P>` line. Exit 5 is no GitHub origin (empty stdout;
  the remote check's remedy). Exit 3 is no usable clone, nothing on stdout and the reason on stderr: outside
  git, a linked worktree (point `Local:` at the main checkout), `~/Projects` itself (a text-only monorepo,
  never a Project root), `self-rollout-check: <path> is not a usable rollout clone: <reason>` (not a
  directory, not a work tree's top, a linked worktree, another repository, a live plugin checkout, or a
  parent work tree that would track it). A sub-path the clone lacks is no refusal here: `--resolve` never
  fetches, so the clone may only be stale, and it exits 0 with `C/<sub>` and a `note:`.
- **`--ensure`** (schedule § 0, after Lachy's yes when the clone is new): makes a missing clone (inside another
  work tree, an empty-directory `git check-ignore` probe first, removed and exit 3 when that tree would track
  it; then one `git clone` of the raw origin URL, never prompting), re-runs the usable checks, fast-forwards
  the clone's default branch (`fetch`, then `merge --ff-only --no-autostash`; a note when it cannot move),
  notes the gitignored local state the in-place checkout has and the clone lacks (nothing is copied), and
  prints the Project root. Exits 0, 2 (a failed clone, nothing left behind), 3 (`--resolve`'s refusals, a
  parent that would track a new clone, or a sub-path the clone still lacks after its fast-forward: land it
  first, or, when `origin/<default>` has it, let the clone move) and 5.
- **Empty** (execute § 2.6): exit 0 is no match; exit 3 is a match, with the match lines and the fix on
  stderr. Execute never swaps a root: its rollout note is already written.
- **Exit 2**, in either mode, is the check itself failing (the script missing with the root set, an empty
  path, no python3), and any other non-zero exit fails closed the same way. A missing registry passes; a
  malformed one passes with a warning, to pass on (the registry format is Claude Code's, so the check fails
  open). The guard's `not found at /skills/…` is not this exit 2: the root was never exported, so export it
  and re-run by `plugin-root.md` rule 4 first.

On any non-zero exit from a run with the root set, except `--resolve`'s exit 4, which schedule § 0
answers with its question, stop and print the stderr verbatim: it names the fix. The clone's location is
a convention, not a setting: a clone anywhere else is not found.

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
Never read 2 or 4 as "not listed": only exit 0 permits a rollout. The guard's
`not found at /skills/…` is not that exit 2 but an unexported root: export it and
re-run by `plugin-root.md` rule 4 before stopping. This is a blocker,
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
repo path is the rollout clone, so the project note's `Local:` path, passed as `<localPath>`, names the
in-place checkout, and the registry names a self-rollout's primary checkout (a `--plugin-dir` primary is in
no registry: `Local:` covers it).

**Clone-rooted.** When the repo path's toplevel is a rollout clone (`self-rollout-check.sh --in-place` names
its twin: every rollout scheduled after P26, and every self-rollout), the root keeps the rule below and every
other member is a peer: the in-place checkout, the primary checkout of a self-rollout among them. A peer's
ahead commits block only when they touch a **scoping** cited path; any other ahead peer is one note naming up
to three of its commits (with the ADR 0031 wait for a held primary). A cited path scopes a member when it
resolves there as the Warn half below resolves it (relative paths and globs in every member, `~/` and
absolute paths only in the member that contains them) and is not an existing directory in that member, its
toplevel included: a task body that names a repo root or a folder notes it, `cited directory <p> does not
scope <member>'s ahead commits`, and never re-blocks every peer. With no cited paths no peer blocks. A
rollout rooted in place before ADR 0042 keeps the strict rule for every member.

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
- **Exit 2**: the check itself failed (a fetch, the default-branch lookup, a missing script with the root
  set). Stop, and print the stderr verbatim. The guard's `pushed-base: /skills/… not found` is not this
  stop: the root was never exported, so export it and re-run by `plugin-root.md` rule 4 first.

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
from execute § 2.7 at entry points only, never per merge, with the paths the not-yet-merged tasks cite
(`reconcile-rollout.py cited`; when that call fails, the entry halts instead of passing none, since with no
cited paths no peer blocks): `origin/<default>` moves with every merge, and a close-out committed
mid-rollout must not halt an unattended run. merge-task's local refresh reads only the rollout's repo path,
so it names a commit made there; its in-place refresh (`self-rollout-check.sh --refresh-in-place`) names one
in a clone-rooted rollout's in-place checkout as `ahead` or `diverged`, and that halts the next entry only
when it touches a cited path. In a rollout rooted in place before ADR 0042, one committed in another clone
of the set first surfaces when the next entry halts on it.

**Unfinished rollout.** A repo holds at most one unfinished parallel rollout: one directly in `Work/Tasks/`,
neither `done` nor `dropped`, with a task not yet merged; and none on a place a live serial chain writes
(ADR 0040; a stuck chain holds only its unlanded rows' surfaces, ADR 0060). Surfaces compare `repo:<realpath>` literally, so a rollout rooted in its clone and a chain on
the in-place checkout coexist as peers (ADR 0042). schedule § 0 runs
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check` against the resolved repo path last,
after the pushed-base check, and its one stdout line decides: see schedule § 0 for each outcome (`none`,
`supersede`, `file`, `interrupted`, `refuse`) and its remedy. A running or never-superseded rollout on the
repo is a stop, never a second rollout beside it. Serial chains are limited by surfaces instead: schedule
§ Serial path runs the same script with `--shape serial`, once per chain. Beside it sits orient § 6's
*Uncommitted grill docs* hold:
`CONTEXT.md` or `docs/adr/` changes a grill left uncommitted in the target repo hold scheduling there too,
because every worktree branches from `origin`, which lacks them.

**Engine path.** The Workflow tool may refuse the plugin-cache `scriptPath`. That
depends on the harness and cannot be checked at schedule time; execute § 5
carries the scratchpad fallback.
