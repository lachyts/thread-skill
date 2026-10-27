---
name: schedule
description: 'Use when planning a rollout (parallel or serial) of Obsidian tasks under a single project — produces a thin rollout note (data only) that `/thread:execute` runs as a queue. Reads tasks from ~/repos/obsidian/Work/Tasks/, orders the queue (dependencies in frontmatter, Solo for sweeping changes), folds affine same-file task clusters into one dispatch unit, refuses a second unfinished parallel rollout on a repo (--regenerate supersedes this project''s paused or unstarted one, carrying its unlanded tasks), writes one `shape: serial` note per serial chain, and always dates <project-slug>-rollout-<YYYY-MM-DD>.md, with `protocol_version: 5`. Scope: Obsidian, plus § 0''s rollout-clone setup.'
---

# /thread:schedule — turn a backlog of Obsidian tasks into a rollout note

A **rollout** orders a backlog of related Obsidian tasks into a queue that one Claude Code session runs across worktree-isolated subagents.

This skill is the **planner**. The rollout note it produces is a data artefact — the dispatch + convergence contract lives in the sibling **`/thread:execute`** skill (`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`).

**Plugin root.** A command taken from text read as a file (a plugin file this skill sends you to, or this SKILL.md itself when a router or `sed` reads it instead of the Skill tool rendering it) runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## Scope

**Obsidian only**, plus the Engine snapshot (ADR 0043: the first step's `engine-snapshot.py cut` runs `default-branch.sh`'s `git ls-remote`, one `git fetch` of origin's default branch into the Primary checkout's remote-tracking ref, and `git worktree add --detach` plus `git worktree lock` of a snapshot under `<primary>-snapshots/`, then its best-effort retire sweep's `git worktree unlock`, `remove` and `prune` of unneeded snapshots; never the Primary's HEAD, branch or working tree; and step 6's and S5's `adopt` writes only the two stamps, `engine_snapshot:` and `engine_sha:`, on the note this run wrote), plus § 0's rollout-clone setup (ADR 0042) and its remote, landing-register, self-rollout and pushed-base probes of the target repo; the self-rollout probe's `--resolve` makes read-only `git rev-parse`, `git check-ignore` and `git remote get-url` calls in the repo and its rollout clone `<toplevel>-rollout` and reads the plugin marketplace registry; its `--ensure` writes only that clone, after Lachy's yes when it is new: an empty-directory probe with `git check-ignore` (removed again when the parent work tree would track it) when it would sit inside another work tree, one `git clone` of the repo's origin into it, and on every run a `git fetch` of its default branch and, with that branch checked out, a `git merge --ff-only --no-autostash`; a clone it made stays when a later step stops; the pushed-base probe runs `git fetch --prune` of `origin/<default>` and `origin/close/*` in the target repo and its known clones, moving or pruning only remote-tracking refs; § 0's unfinished-rollout check reads `git remote get-url` in each rollout note's Project root; a supersede's `reconcile-rollout.py resume` makes read-only `gh pr view`/`gh repo view` calls; a supersede's `git-env-canary.py check-all` and `retire` (steps 1 and 6) read the prior's Project root with read-only git calls and write only the prior note's `## Git-env log` and the canary's own records, kept outside the repo; § 4.7 reads the operator's ladder file through `ladder.py` (a local file, no network); step 2.8 reads the operator's `~/.config/thread/rollouts.toml` through `rollout-settings.py` (a local file, no network), which runs `land.sh --origin-slug` and so a read-only `git remote get-url origin` in the Project root when the file holds a repo table; § 3.6 runs `gated_inputs.py sweep` (it reads task notes only); step 7.5 (and § 0's `file` finish) runs `close-score.py` on the prior (ADR 0037 d4), which reads the prior note, the Run record, `reviews.jsonl` and `tunings.jsonl` under the events directory, `rollouts.toml` through `rollout-settings.py`, every note under `Work/Tasks/` (Archive included) for `fixes:`/`merged_into:`, and the Project root's git (or its in-place checkout's when fresher, ADR 0042), read-only and never fetched (land.sh's `git remote get-url origin`, escapes.py's read-only rev-parse/symbolic-ref/log/show/rev-list/merge-base/cat-file/diff-tree/blame reads, and `git remote get-url origin` in each clone `reviews.jsonl` names), and writes only fold-journals' `call-journal` lines to the prior's Run record and tune.py's one `tunings.jsonl` line, both under the events directory, outside the vault and the repo (its scratch dir is removed on exit); and step 7.5 moves a superseded rollout note with a plain `mv`; § Serial path's `serial-chains.py` (S2) reads task notes, project notes under `Work/Projects/`, `launch-folders.json` and the plugin's `.claude-plugin/plugin.json`, with a read-only `git rev-parse --show-toplevel` and `git remote get-url origin` per path it claims, its S3 check reads notes only, and its S4 runs `rollout-settings.py` as step 2.8 does; step 2.9's `inert-paths.py` reads the repo with read-only git calls (`ls-tree`, `cat-file --batch`, `rev-parse`, `worktree list`, `remote get-url`), reads the Run record's lines for its drop rule, and writes only `~/.config/thread/rollouts.toml` (`record` on Lachy's yes, `drop` by the drop rule). § 1.5's Pre-flight (and S3.5): `estate-scan.py --deadline 0` reads the vault and starts no subprocess; `slices` writes only under a `mktemp` dir; the grading agents are read-only (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/readiness-grade.md` § The grading agents); `rank` and `preflight` write nothing; on every run but an orient-all fork, `log` writes one `grade` line per graded task to `grades.jsonl` under the events directory; `record` writes each answer's bullet into its task note's `## Decisions (asked ahead <date>)`, and with a fork the `orient ruling:` line; and step 6's `reconcile-rollout.py defer`, from the prior's root, writes only the carried queued tasks § 1.5 left out (`status: open`, with `rollout:`, `owner:`, the run stamps and the automatic-retry markers cleared). Reads from and writes to `~/repos/obsidian/Work/Tasks/`. Not for Linear, GitHub issues, or any other backlog source.

## Invocation forms

```
/thread:schedule GifLab                       # default: all open tasks linked to [[GifLab]]
/thread:schedule [[GifLab]]                   # explicit wikilink form
/thread:schedule GifLab --regenerate          # supersede this project's unfinished rollout on the repo (paused or never started), carrying its unlanded tasks
/thread:schedule --tasks task-a,task-b,task-c # explicit set instead of project filter
```

The argument resolves to a project-note slug (the thing the task's `projects:` frontmatter list contains). Strip `[[...]]` wrappers and case-fold for comparison.

## Skill flow

### Cut the Engine snapshot, first (ADR 0043)

Before § 0, cut this run's **Engine snapshot**: a frozen copy of the plugin at origin's freshly fetched tip of its default branch, never the Primary checkout's own state, which each note this run writes names and runs on (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/engine-snapshot.md`, the one copy of the rules). This text's prose id: `$Id$` (git `ident`, engine-snapshot.md): pass its hex as `--prose-id`; when it shows no hex, pass none. Run, with the Bash tool's `timeout: 600000`:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py cut --verb schedule --prose-id <id>
```

- **Exit 0** prints one JSON line; its `snapshot` is this run's engine root. The hand-over: when `prose.identical` is true, keep following this text with `<snapshot>` in place of the rendered root in every command and file read from here on; when it is false, read `<snapshot>/skills/schedule/SKILL.md` as a file and follow it from § 0 (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`), skipping its cut: this one stands. So the note, its queue and its task stamps are written by the snapshot's own scripts, the version that will read them, and step 6 and § Serial path S5 stamp each note with it (`adopt`).
- **Exit 4** (no git Primary: a version-cache install) → run on from the session's root, stamp nothing (no `adopt`), and name its stderr reason in step 8's `Engine:` line.
- **Any other exit** stops the run before anything is written: print its stderr line verbatim (exit 2: origin's default branch, the fetch or the snapshots-home lock failed; exit 3: origin's tip predates snapshots, the snapshots home would sit inside a work tree that tracks it, or a directory squats at its path, each with its remedy).

### 0. Execution-fit gate

Run the execution-fit test (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` — the
canonical definition, three-way since ADR 0040). This run writes a **parallel rollout** for
**parallel-shaped** work, or, for an all-serial set, serial rollouts (§ Serial path). Parallel-shaped
work is tasks that converge on ONE code repo, land as a PR each, and verify machine-checkably inside
the run (tests / build / greps), with no external publish and no tool or launch profile the lead
lacks. Before computing anything, scan the candidate set for misfits of two kinds. **Session-lane misfits**: tasks that are conversation-gated, whose ordering constraint
is a measurement window or calendar date rather than file overlap, or whose verification only
arrives days later (impact measures). **Serial-shaped members**: tasks with no PR per task (vault
notes, several repos) or no machine check inside the run, whose core action is an external
publish (CMS / live site / DNS / config console), or that need an external tool or launch profile
the lead lacks. In a mixed set each is named in the gate as serial-shaped and left unstamped; a
serial-shaped member is never routed to the session lane, save ruling (c)'s plugin-repo work (the fit
doc's **Rulings**). Orient § 6 applies ruling (c) before it calls schedule, and schedule's serial path
enforces it (`serial-chains.py`).

When no member is parallel-shaped and any is serial-shaped, this run takes **## Serial path** below
and skips the rest of § 0: no `Local:` read, no probe, no fetch. Any session-lane misfit is named as
such and left unstamped there (S1).

If session-lane misfits dominate, **stop and route the set to the session lane** (`defer` for
`scheduled:`-date dispatch, `open` via the task's `## Launch` block), its serial-shaped members
excepted, instead of forcing a rollout: the engine's parallelism is forbidden by isolation
windows, and the queue cannot see a window or calendar constraint. A mixed set is fine if the
parallel-shaped subset can roll out while the misfits stay unstamped — name each misfit in the gate
with its outcome (serial-shaped or session lane), and end the gate with the serial-shaped members'
follow-up line, `/thread:schedule --tasks <serial members>`, which takes them down the serial path once
this run is done. A run writes one shape.

**Under orient-all.** A fork of `/thread:orient-all` runs this skill with `--tasks` and asks nothing: the
decision round there authorised the member set. Each question below takes orient-all § 6's answer, and step 6
names the note with the slug its prompt gives. It routes nothing: § 0's session-lane routing and the follow-up
`/thread:schedule --tasks <serial members>` line are returned to orient-all, never run. Step 8 (or S7) reports
them. § 1.5 takes the estate pass's grades and answers from the prompt's Pre-flight line and asks no second round.

After the misfit scan, resolve the target repo and the Project root the rollout note will carry, and
check the dispatch blockers. Every parallel rollout runs from its **rollout clone** (ADR 0042): a second
full clone of the repository beside its toplevel, `<toplevel>-rollout`, never nested inside it, so a
peer session's commit in the in-place checkout never moves the tree a rollout integrates in. In order:

1. Read the project note's `Local:` line; if there is none, ask the user for the path.
2. Run the remote check in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/execution-fit.md` § Dispatch blockers
   against the `Local:` path (a pointer, never a copy), followed by its `gh repo view` confirmation. Then
   run the landing register check from the same § Dispatch blockers against the same path (again a
   pointer, never a copy): a rollout never pushes to or merges into a repo on the landing register
   (ADR 0028 § Decision). All three key on the GitHub origin, which a usable clone shares, so they answer
   the same for the toplevel as for its clone, and a repo they refuse is never cloned.
3. Then run the self-rollout check from the same § Dispatch blockers (point at it; never copy the
   snippet here) on the `Local:` path, with `<mode>` set to `--resolve`: read-only, it names the Project
   root, the clone, keeping a sub-path `Local:` as the same sub-path of the clone.
4. Act on its exit. **Exit 4** (no clone yet; its stdout line is the would-be root, its stderr the origin
   URL): ask one AskUserQuestion, "Create the rollout clone `<C>`, a full `git clone` of `<origin URL>`?";
   when its stderr has a `nested in <P>` line, the question adds "<P> must ignore it: the clone step checks
   that first and creates nothing if <P> would track it". Yes → run the same snippet with `<mode>` set to
   `--ensure`, with the Bash tool's `timeout: 600000`; No → stop before step 1, with nothing written. That question
   is Owner *technical*, kept a question by ADR 0042 until p30-10 decides it, and is put in the Framing of
   `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`.
   **Exit 0** (the clone exists) → run the snippet with `<mode>` set to `--ensure` directly, even when its
   stderr has a `note:` that the clone has no `<sub>` yet: `--resolve` never fetches, so a stale clone is no
   stop, and `--ensure` refuses only when the clone still lacks it after its fast-forward. `--ensure`
   makes the clone when it is missing (an empty-directory ignore probe first when it would sit inside
   another work tree, then one `git clone`), re-checks it, fast-forwards it (`git fetch` and a
   `merge --ff-only` of its default branch) and notes the gitignored local state the in-place checkout
   has and the clone lacks; nothing is copied. Its one stdout line is the resolved path: every check
   below runs against it, and step 6 writes it as `{{REPO_PATH}}`. Say in one line that the rollout runs
   from the clone, naming both paths, and carry its `note:` and `WARN:` lines to step 8's "Checklist —
   rollout clone". Only the Project root moves: `<localPath>` below and step 6's Thread line keep the
   `Local:` path, where the thread lives. Exit 3 (no usable clone: outside git, a linked worktree,
   `~/Projects` itself, an unusable clone, a parent that would track it, or, from `--ensure` alone, a
   sub-path the clone still lacks after its fast-forward), exit 5 (no GitHub origin), exit 2 or any other
   non-zero exit of either mode is a stop, below.
5. Then run the pushed-base check from the same § Dispatch blockers (a pointer, never a copy) with the
   resolved path, `<localPath>` set to the project note's `Local:` path (empty if the user gave the
   path), and no cited paths: rollout worktrees branch from `origin/<default>`, so a local default branch
   ahead of it hides those commits from the agents. The clone's own ahead commits block; another clone of
   the set (the in-place checkout) blocks only on a path a task cites, which the re-run after step 2
   passes.
6. Last, run the unfinished-rollout check against the same resolved path, passing `--regenerate` exactly
   when this run has it:
   `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --shape parallel --repo <resolved path> (--project <target> | --tasks <this run's --tasks list>) [--regenerate]`.

Pushed-base and unfinished-rollout run after `--ensure` because both need the real root: the
unfinished-rollout check compares `repo:<realpath>` literally (and exits 2 on a missing path), and a
toplevel standing in for it would hold the rollout to the in-place checkout's own commits. A repo holds
at most one unfinished parallel rollout (one directly in `Work/Tasks/`, neither `done` nor `dropped`,
with a task not yet merged), and none on a place a live serial chain writes: the check refuses a
parallel run whose root overlaps a surface of an unfinished serial chain, since that chain owns it,
and a supersede never crosses shapes. A clone root never overlaps a chain on the in-place checkout, so the
two coexist as peers (ADR 0042, intended); the refusal still fires for a chain that claims
`repo:<clone>`, and for a rollout rooted in place before ADR 0042.
A rollout awaiting sign-off (`paused_for: sign-off`, execute § 4.5 step 5's form: only gates wait on Lachy) is unfinished too: the refusal names its waiting tasks and the
sign-off path (sign off, then `/thread:execute`, or `/thread:repair` to defer them), and `--regenerate` on
this project's rollout carries them forward still gate-pending. The check prints exactly one stdout line:

- `none` → go on.
- `supersede <prior>` → this run supersedes `<prior>`: run the **Supersede prep** below.
- `file <slug> <path>` → an earlier supersede stamped `<slug>` but died before its move. Run step
  7.5's score and move for it now: first
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/close-score.py --rollout ~/repos/obsidian/Work/Tasks/<path> --close supersede`
  from that note's root (*The prior's root*, below) with the Bash tool's `timeout: 600000` (report its line; a non-zero exit is a `WARN:` for step 8,
  never a stop), then `mkdir -p` `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`, then a plain
  `mv` of `~/repos/obsidian/Work/Tasks/<path>` into it. Report it, then re-run only the check. A
  failed `mv` stops the run with its error.
- `interrupted <prior> <new>` (printed only with `--regenerate`, and only when those two notes are
  the repo's whole unfinished set) → an earlier supersede wrote `<new>` and died before step 7.5
  closed out `<prior>`, so `<new>`'s tasks may be unstamped. Finish that supersede:
  1. Stamp `incomplete: true` in `<new>`'s frontmatter, just below its `status:` line. It is usually
     still there: `<new>` was born with it (step 6), and only the end of its own run's step 7 removes
     it. This run never removes it (step 7 clears only the note this run writes), so only a later
     supersede of `<new>` ends it, by closing the note out (step 7.5). Until then
     `reconcile-rollout.py next` refuses `<new>`, so a cancelled run never leaves it runnable once
     `<prior>` is closed.
  2. Step 6's carry, from `<prior>`'s root (*The prior's root*, below): `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py carry --from ~/repos/obsidian/Work/Tasks/<prior>.md --to ~/repos/obsidian/Work/Tasks/<new>.md`.
     It also maps each carried task's legacy stamps to a rung (step 1's `restamp` lines; a re-run maps
     nothing twice). A non-zero exit stops the run with its stderr. It also prints `order` lines (step 1)
     for `<prior>`'s prose: keep them for step 1's confirm and step 3, since this is the only run that
     reads that prose (the re-check's `supersede <new>` previews from `<new>`). With `<prior>` still open,
     carry reads that prose against the tasks already on `<new>` too, so the lines print even when the
     dying run's own carry had moved every task.
  3. Step 7.5's close-out of `<prior>`: the score, the stamps, then the move.
  4. Print the pinned report: "**[[<new>]] is incomplete**: the run that wrote it died before closing out [[<prior>]], so its tasks may be unstamped and its queue can name tasks `next` and `status` never see; it must be superseded with `--regenerate` (this run goes on to do that; a cancelled run leaves it stamped `incomplete: true`, which `next` refuses, for the next `--regenerate`), never `/thread:execute`d as written."
  5. Re-run only the check. It prints `supersede <new>`.
- **Loop guard.** Each finish removes the note it names from the next check, so a second `file`
  or `interrupted` line naming the same note stops the run with that line.
- `refuse …` (exit 3) or exit 2 → a failure, below.
- `WARN:` lines (stderr, on any exit) → carry them to step 8's checklist.

On any failure **stop before step 1**: no task stamped, no rollout note, no heartbeat, with two
exceptions: a `file` move or an `interrupted` finish that § 0 made before a later refusal stays,
since it completes a supersede an earlier run confirmed; and a rollout clone `--ensure` made stays.
Any § 0 stop after that clone was made, a cancel at step 1, or any stop before step 6 prints
`rollout clone <C> was created by this run and stays: the next /thread:schedule reuses it`. Print the
snippet's remedy line verbatim (or gh's error); for a listed repo that is the `listed <owner/name>: <reason>` line with its remedy,
since unlisting is Lachy's call, for the self-rollout check's `--resolve` or `--ensure` it is the whole
stderr (it names the fix), for the pushed-base check's exit 3 it is the whole stderr (the
ahead commits and the land-by-PR or wait-for-the-landing-PR remedy), and for the unfinished-rollout
check's refusal or exit 2 it is the whole stderr (each unfinished rollout with its remedy). The
cluster is still parallel-shaped; don't re-route it to the session lane or a serial rollout.

**The prior's root (ADR 0043).** Every command this run runs on a prior rollout runs from that rollout's own
engine root, never this run's snapshot: the `root` that
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/engine-snapshot.py resolve --rollout <the prior note where it sits>`
prints (its Engine snapshot, or the Primary for an unstamped prior), exported as `CLAUDE_PLUGIN_ROOT` for that Bash
call (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md` rule 2). Those are the ten commands that name it: the
Supersede prep's `resume`, step 1's canary `check-all` and carry preview, step 6's `check-all`, `defer` (of § 1.5's
leavers), carry and canary `retire`, step 7.5's `close-score.py`, § 0's `file` finish's `close-score.py` and the
`interrupted` finish's carry (with its step 7.5). Each passes only flags every snapshot a live prior can name already
has (ADR 0047 § Build rulings): a new flag would exit 2 on an older prior, so new work on a prior's tasks takes an
existing verb, as step 6's `defer` does, or runs from this run's root, as § 1.5's unguarded estate scripts do.
Resolve once per prior, before its first such command; an exit 3 (its snapshot is unusable)
stops the run before anything is written, with its stderr line and remedy. A guarded script run from another root
refuses with an `engine-snapshot:` line and writes nothing: re-run it once from the root that line names.

**Supersede prep.** Only once every § 0 check has passed and the unfinished-rollout check printed
`supersede <prior>` (directly, or on the re-run after an `interrupted` finish), run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py resume --rollout ~/repos/obsidian/Work/Tasks/<prior>.md`
before step 1 (an unfinished note always sits directly in `Work/Tasks/`, so the path is exact). It
flips done any prior task whose PR already merged, so step 1's preview and step 6's carry never take
a landed task. Exit 3 (an undecided RACE or UNVERIFIED on the prior) is a stop: before step 1 and
before this run writes anything, print its `HOLD:` lines and point at `/thread:repair [[<prior>]]`,
which records Lachy's decision (step 6's carry would refuse the prior anyway). Any other non-zero exit
(a gh failure) is no stop: carry its `ERROR:` lines into step 1's confirm and go on. A task it could
not resolve carries at its recorded status, and execute's resume asks GitHub again.
When `<prior>` carries `start: unattended` (*Start when ready*, `_shared/vault-grammar.md` § Rollout
start stamp), remove that line before step 1 too, after `resume` (whose exit 3 stops the run first,
the line untouched), and keep the exact line and its place: the Chorus Stage must never start a lead
on a note this run supersedes, which would make step 6's carry refuse a running prior. Step 1's
confirm names the clear: `cleared [[<prior>]]'s start when ready: a cancel puts it back`.
**Put back.** A run that stops before step 6 writes its note (a cancel at step 1's confirm, or any
stop from step 1 to step 5) puts that exact line back at its place in `<prior>`'s frontmatter, just
below `status:` when that place is gone, and prints `restored [[<prior>]]'s start when ready: this run
stopped before writing its note`. Once step 6 has written the note, the line is never put back: the
prior's unlanded tasks are on their way to it, and a stop before step 7.5's close-out is the next
`--regenerate`'s `interrupted` finish. The prior's other stamps, `superseded_by:` and the move stay
step 7.5's. Report the clear in step 8 as `cleared [[<prior>]]'s start when ready: superseded here`.

There is no minimum size: shape decides, not count. A parallel-shaped cluster of one still rolls
out — the plan gate, verifier retry, master review, and auto-merge are the point. For N ≤ 2,
note that the ceremony is thin and proceed.

### 1. Discover tasks

Walk `~/repos/obsidian/Work/Tasks/*.md`. Filter:

- `status: open` (default — `--include-done` to override)
- `projects:` contains the target wikilink
- `tags:` **contains** `task` — phase notes (`tags: [phase]`, see ADR 0005) and any other non-task
  note linked to the project are never dispatched
- `tags:` does **not** contain `rollout` (rollouts aren't tasks)
- `tags:` does **not** contain `decisions` (the weekly Reflection's decision task, ADR 0037 d5: Lachy decides it at the top of a run, never during one), with or without `--tasks`. Name each skipped decision task in the count report.
- Skip a task whose `rollout:` links a rollout note directly in `Work/Tasks/` that is neither `done` nor `dropped`: it belongs to that rollout, and only a supersede may take it. Name each skipped task and its rollout in the count report.
- Skip tasks with `status: merged` — step 4.5 folded these into a combined note; their `merged_into:` target carries the work and gets dispatched in their place

On `supersede <prior>` (§ 0), first run the git-env canary's `check-all` on the prior (execute § 4.5 *Git-env canary*), from the prior's root (§ 0's *The prior's root*), as is the carry preview below: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout ~/repos/obsidian/Work/Tasks/<prior>.md`. It compares the prior's windows left open (a hard pause's TaskStop'd calls) before its tasks move. A non-zero exit stops the run before this run writes a rollout note or a task stamp: print its stderr verbatim (exit 3 → `/thread:repair [[<prior>]]`, which shows the evidence and records Lachy's ack). This preview may append a trip line to the prior rollout note's `## Git-env log` before you confirm anything. That write is intended: it records evidence that a window changed. The decision to accept it stays with `/thread:repair`. Then preview the carry: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py carry --from ~/repos/obsidian/Work/Tasks/<prior>.md --dry-run`. It writes nothing and prints one line per task linked to the prior rollout. Its `carry <slug> <state>` lines join the candidate set (deduplicated, whatever their status: a carried `review`, `in_progress` or set-aside task keeps its place in the queue). Its `keep <slug> <state>` lines (merged, folded, or another status such as `dropped` or `parked`) stay with the prior rollout. After a carried task's line it prints `restamp <slug> rung=<name|kept|-> drop=<keys|->` when carry will map that task's legacy stamps (ADR 0029): `rung=<name>` is the ladder's top rung it writes (a `model: fable`, or an `effort: xhigh` or `max`), `kept` its own `rung:` staying, `-` none; `drop=` the legacy keys it removes. § 4.7 reads these lines and never lowers the rung they name. After the carry and keep lines it prints `order <slug-a>,<slug-b>[,…]: <clause>` for each clause of the prior note's own prose (its lead's rules, its queue rationale; never fenced code) that names two or more carried tasks, at least one `queued`, beside an ordering word ("after", "needs", "→" and the like). An order kept only in that prose never reached `depends-on:`, so the carry alone drops it: step 3 reads each `order` line's clause.

**Re-root guard.** When the prior's `Project root` differs from § 0's resolved path (both `~/` expanded and compared by real path: § 0's rollout clone, or a changed `Local:` line) and any task on a `carry` line has started (its note carries `started:`, whatever its state), stop before this run writes a rollout note or a task stamp, and never re-root those tasks silently: their worktrees, branches and PRs were made under the prior root, and no step moves them. Print each such task, both roots and the remedy: defer those tasks through `/thread:repair [[<prior>]]` (`/thread:repair` § 5's clean defer), then run `--regenerate` again. A carry with no started task takes the new root.

A non-zero preview exit stops the run before this run writes a rollout note or a task stamp: print its stderr verbatim. Exit 2 is a refusal, for one of two causes: an undecided RACE or UNVERIFIED on the prior (`/thread:repair [[<prior>]]` records Lachy's decision), or a refused ladder file when a carried task needs the top rung (`ERROR: carry: ladder file refused: <path>:<line>: <reason>`). The refused ladder's remedy is Lachy's edit to `~/.config/thread/ladder.toml` at the line named, then `--regenerate` again.

Report the count and let the user confirm before proceeding. The confirm lists the candidates, each skipped task with its rollout, each skipped decision task and, on a supersede, both the carried and the kept lists (the carried list with its `restamp` lines and any `WARN: carry:` line for a value carry left in place), the `order` lines (this preview's and, after an `interrupted` finish, § 0's carry's) with step 3's proposals from them, any `ERROR:` lines from § 0's `resume`, § 0's `cleared [[<prior>]]'s start when ready` line when the Supersede prep removed one, the check's `WARN: <prior> is incomplete` line when it printed one, and, after an `interrupted` finish, § 0's pinned report.

### 1.5. Pre-flight (ADR 0047)

Before anything below writes a rollout note, grade every task still to start and settle the decisions it hides with
Lachy in one round (CONTEXT.md **Pre-flight**). Ready tasks queue as they stand; One call and Grill tasks queue once
their decisions are answered and recorded; Orient tasks stay out with their Dependent closure, so nothing queued waits
on a task this rollout never runs. It runs no plan gate: a task's plan is still drafted and judged at its start
(ADR 0030).

**The sets.** From step 1's confirmed set:
- *candidates*: every task in it, carried tasks included, less any § 0 misfit;
- *kept*: each task on a step 1 `carry <slug> <state>` line whose state is not `queued`. A carried task that has
  started keeps its state, as the supersede rules, and is never graded or asked about;
- *the graded set*: the candidates less the kept ones, so a carried task still queued is graded like any other. An
  empty graded set runs nothing below and says so in step 8, and `queue[]` is then the candidates. A carried task at
  an empty `status:` is `queued` in the carry preview, so it is in the graded set, but the grading takes only an
  `open` one: it is asked as ungraded, its reason `status outside Active`.

**Grade.** Every command here runs from this run's root, never a prior's: these scripts are unguarded and write no
rollout note (ADR 0047 § Build rulings).
1. `S=$(mktemp -d -t schedule-preflight)`. It stays in temp, as orient-all's `$S` does.
2. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-scan.py --deadline 0 --compact > "$S/scan.json"`: it
   reads the vault only and starts no subprocess. Exit 2 or 3 stops the run here, with its one line, under § 0's
   **Put back**.
3. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py slices --scan "$S/scan.json" --dir "$S/slices" --tasks <graded set> [--superseding <prior>]`.
   `--superseding` is passed exactly on a supersede, naming § 0's final `supersede <prior>` (after an `interrupted`
   finish, that is `<new>`), so a carried task still queued is gradeable. Each task in its `notGradeable[]` is asked
   about in the round as ungraded, never graded.
4. The grading agents, as orient-all § 2 steps 4–5 run them: started in one message, one read-only agent per slice
   file, each briefed with `${CLAUDE_PLUGIN_ROOT}/skills/_shared/readiness-grade.md` § The grading agents, the slice
   file's path and "return only the § Output JSON". Save each answer as `$S/grades-<NN>.json`. An answer that does
   not parse, or a task the ranker lists in `invalid[]`, is re-asked once with its errors; still invalid, the task is
   ungraded. With no subagent available, grade each slice here, one at a time.
5. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-rank.py rank --scan "$S/scan.json" --grades <each grades file> [--superseding <prior>] --compact > "$S/rank.json"`.
6. On every run that grades, all but an orient-all fork,
   `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py log --rank "$S/rank.json" --scan "$S/scan.json"`:
   one line per graded task into the Grade log (CONTEXT.md **Grade log**). Its outcome line and any skipped slugs go
   to step 8; a non-zero exit is a caveat there, never a stop.
7. `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py preflight --rank "$S/rank.json" --scan "$S/scan.json" --tasks <every candidate> [--kept <each kept slug>] > "$S/preflight.json"`.
   Every later `preflight` call in this run passes the same `--rank`, `--scan`, `--tasks` and `--kept`, and adds only
   `--decided` and `--dep`.

**The round.** Pass each `asks[i]` to AskUserQuestion's `questions` verbatim, one question per call, each with its
recommendation first, in its order: the One calls, then each Grill's decisions (`[[slug]] (k/n) …`), then the
ungraded tasks. Only his decisions are asked (Owner *yours*): the rest were ruled by the grade, and each question
carries the Framing from the grade (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 6). `index[]` maps each
question to its task (`slug`, `kind`, `decision`), each picked label to its full text (`texts[]`), and names the
`recommended` one. A Ready, Orient or kept task gets no question, and a task already
out through an Orient dependency (directly or through others) is never asked, whatever its grade: it leaves whatever
Lachy answers, so `preflight` puts it in `out[]` as `dependency` before it builds the round. Lachy's "stop" ends the
round, and the rest stay undecided.

**Record each answer at once**, a One call's or a Grill's, before step 6 writes anything:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task <slug> --question <decision.question> --answer <the full option text, or his words> --recommended <the index entry's recommended> [--fork <decision.fork>] --by schedule [--superseding <prior>]`,
`--fork` exactly when the decision carries one, and `--superseding` as at `slices`.
- A One call is decided once it is answered and its `record` exits 0; a Grill only once every one of its decisions
  is answered and recorded.
- An answer that defers or drops the work is recorded, and the task stays undecided.
- A One call or Grill whose `record` refuses stays undecided; step 8 names its answer as unrecorded.
- An ungraded task's answer is never recorded: it governs this run alone. A `## Decisions` bullet would outlive the
  run, since descope reads that section as recorded decisions and every later grader and planner reads the note in
  full. `Queue it as it stands` decides it, and step 8 names it; `Leave it out` (recommended) decides nothing, so the
  next schedule asks again. Its question is his (Owner *yours*: whether to queue a task nobody could read), worded by
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md` § 6's Ungraded row.

**The final call.** `preflight` with the same four flags and `--decided <each decided slug>`. Its `queue[]` is the
candidate set from step 2 on.
- A task in `out[]` that is not carried leaves now: no `rollout:` stamp, no `## Queue` row, no `## File-sets` line.
- A carried `queued` task in `out[]` leaves through step 6's `defer`, run from the prior's root before the carry.
- Its `warnings[]` (a kept task that depends on a task left out) go to step 8.

**Decided for you.** When the final `queue[]` is non-empty, write the calls the grade ruled for Lachy into its tasks
(ADR 0054 d4), never under `## Decisions`:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py decided-for-you --rank "$S/rank.json" --tasks <queue[]> --by schedule [--superseding <prior>] --write`,
`--superseding` as at `slices`. Each task's `## Decided for you (<date>)` section opens with its preamble, and step 8
lists the calls. Each `refused[]` item (a task that went in flight since the scan, say) goes to step 8 as unwritten,
and the rest are still written. A task dropped later keeps its bullets: the next grade reads them as settled, and a
plan may overturn one on code evidence.

**An empty queue.** When the final `queue[]` is empty, stop before step 2 and print step 8's left-out block as the
stop's report. Nothing is stamped, no note is written, there is no `## Queue` row and nothing is deferred. What this
step wrote stays: `record`'s `## Decisions (asked ahead <date>)` bullets and the Grade log lines `log` wrote. § 0's
**Put back** restores a prior's `start: unattended`, and a rollout clone § 0 made stays.

**The orient-all form.** Under orient-all there are no `slices`, no grading agent, no `rank`, no round, no `log` and
no `record`: the estate pass graded, asked and logged (orient-all § 6 step 3). The fork's prompt carries
`Pre-flight: rank <R>, scan <S>, decided <slugs or none>`, and the fork runs
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py preflight --rank <R> --scan <S> --tasks <step 1's confirmed candidates> [--decided <each slug that line names that is among them>]`
once. A decided slug step 1 skipped is never passed: `preflight` exits 2 on a `--decided` slug outside `--tasks`.
Its `queue[]` is the candidate set; each `out[]` member is left out with its Dependent closure, unstamped, and
returned with its why. Then, when its `queue[]` is non-empty, the fork writes its own members' ruled calls:
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py decided-for-you --rank <R> --tasks <its queue[]> --by orient-all --write`,
whose `refused[]` the fork returns.

### 2. Extract file scope per task — best effort

File-sets are best-effort. For each task:

1. **If the task's frontmatter has `touches: [...]`** — use that as authoritative. No further detection needed.
2. **Otherwise — read the paths the body names**:
   - Inline code: `` `src/foo/bar.py` ``
   - Fenced code blocks: paths inside ```python … ``` blocks
   - Bare paths in prose: `src/...`, repo-root-relative paths
   - Common patterns: `src/giflab/<module>.py`, `tests/<layer>/<name>.py`

There is no confirmation turn and no agent sweep. A file-set only breaks queue-order ties (`reconcile-rollout.py next` prefers the task with the least overlap with what is running) and feeds step 4.5's affine merge. It never keeps two tasks apart: Integration (ADR 0030 decision 3) merges the latest `main` into each approved task and re-runs the verifier before its merge, which is what makes two tasks on one file safe. So a missed file costs a little ordering, never a dropped change.

If a task touches zero files after both passes, classify it as `scope: read-only` (see step 4).

After detection, re-run the pushed-base check (§ 0's pointer, same path and `<localPath>`) with
cited paths: the detected file-sets plus every repo path the task bodies name (`docs/adr/NNNN-*.md`
as a git glob, `CONTEXT.md`, any `~/…` path as written; do not pre-filter them), never THREAD.md.
Its `pushed-base: WARN:` lines name local copies the agents won't see (an uncommitted change, a
commit only on the checked-out branch, an untracked file); carry them to step 8's checklist. Show
its notes here. With the rollout clone as the root (ADR 0042), this re-run is where a commit in another
clone of the set, the in-place checkout among them, blocks: only when it touches one of these cited
paths, and never through a cited existing directory (a repo root a body names notes, never scopes);
any other ahead commit there is a note. An exit 3 or 2 stops exactly as in § 0; nothing has been
written yet, except `resume`'s done flips (§ 0's Supersede prep), a § 0 `file` or `interrupted` finish,
§ 1.5's `## Decisions` bullets and Grade log lines, and a rollout clone § 0 made.

### 2.5. Detect the project's verifier

Resolve the rollout-level default verifier — the shell command(s) `/thread:execute` will run inside each subagent's worktree to decide pass/fail. Detection order:

1. Project's `CLAUDE.md` — look for a line starting `Verifier: \`<cmd>\`` (never a `Completion verifier:` line, step 2.5's full suite) or a "Verification" / "Testing" section that names a single canonical command
2. Project's `Makefile` at repo root — presence of a `test` target → `make test`
3. `pyproject.toml` with `[tool.poetry]` → `poetry run pytest`
4. `package.json` with a `test` script → `npm test`
5. Fall back to no detection → surface to user, ask them to provide one (or proceed without; `/thread:execute` will refuse to dispatch without a verifier)

Print the detected command and ask the user to confirm or override before continuing. Store it for step 6.

**The completion verifier (estate ADR 0009 d6).** A project that declares a **fast tier** for Integration names its full suite beside it: a `Completion verifier: \`<cmd>\`` line in its `CLAUDE.md` (the fast tier is then its `Verifier:`). Found → the rollout runs that suite once on merged main at its completion ceremony (execute § 4.5 step 5): show it with the verifier for the same confirm, and store it for step 6, where it uncomments the template's `completion_verifier:` line. None → leave the line commented out: the ceremony then runs as it did before the key existed. Never derive one from a project that declares no fast tier: its `verifier:` already is its full suite, at every Integration. A `shape: serial` note never carries it: a serial chain's Complete does not run it yet (execute § 3's `completion_verifier` row).

### 2.6. Capture known baseline failures

Some repos carry tests that already fail on a clean `main` for environmental / pre-existing reasons (an ImageMagick 0-byte quirk, a perf ratio over a hardcoded ceiling, a Windows-only tool gap). Without a manifest, **every** dispatched agent independently re-diagnoses the same reds and burns tool-calls proving they're out of scope (14× in the first giflab run). Capture them once here so `/thread:execute` can thread them into every agent and treat "only these fail" as green.

- **Declare by default** — ask the user for the known baseline failures as `<test_id> — <one-line reason>` lines.
- **Opt-in detection** — offer to run the verifier once on a clean `main` (clean checkout, run `{{VERIFIER}}`, collect the failing test ids) and present the set for the user to confirm + annotate with reasons.
- If clean `main` is fully green, record `none`.

**Honesty constraint** (per the project's `CLAUDE.md`): the manifest is a **comparison reference, not a mute button** — `/thread:execute` keeps running the full verifier and only ignores these exact reds; it never `--deselect`s them (that would hide a real regression in them). The manifest is a point-in-time snapshot with no liveness guarantee — re-capture on `--regenerate`.

Store the confirmed lines for step 6's `{{KNOWN_BASELINE_FAILURES}}` block.

### 2.7. Detect the env-bootstrap command (optional)

If the verifier needs a one-time environment setup before it runs in a **fresh** worktree — the recurring "wrong Python / no editable install" friction where each agent independently rediscovers `poetry env use 3.11 && poetry install` — capture it once as the rollout's `env_bootstrap`. `/thread:execute` then runs it once per worktree right after the agent enters it, so no agent has to rediscover it. Detection:

1. Project's `CLAUDE.md` — a line like `Env bootstrap: \`<cmd>\`` or a documented "set up the worktree env" command.
2. Otherwise ask the user (the common shapes are `poetry env use <ver> && poetry install`, `npm ci`, `uv sync`), or leave it unset.

Leave it unset when the verifier works in a bare checkout — the worktree setup then renders byte-identically to before. Store the command for step 6 (it becomes the rollout frontmatter's `env_bootstrap:` line).

### 2.8. Resolve the rollout settings

The rollout's four numeric defaults (`parallel_ceiling`, `max_review_rounds`, `max_iterations`, `max_plan_rounds`) are the operator's, not this skill's: they live in `~/.config/thread/rollouts.toml` (ADR 0032; a Reflection proposes changes to it), beside ADR 0029's `ladder.toml`. Resolve them once, here, before step 4.5's first vault write:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py --repo <§ 0's resolved repo path>
```

It prints one JSON line: each key's `value` and its `source`, `file:repo` (the file's `[repo."owner/name"]` table for this repo's GitHub origin, read from the local `git remote`, so a rollout clone resolves the same as its in-place checkout), `file:defaults` (its `[defaults]` table) or `built-in` (4 / 4 / 3 / 3 when the file sets none, or there is no file). The script's header is the one copy of the file format.

- **A non-zero exit stops the run before this run writes a rollout note or a task stamp**: print its stderr line verbatim (`rollout-settings: <path>:<line>: <reason>`, or `rollout-settings: --repo <p>: <reason>`) with the remedy "edit `~/.config/thread/rollouts.toml` at the named line, then re-run". Exit 3 adds "needs python ≥ 3.11" (a present file needs tomllib). A bad value is refused loudly, never dropped (ADR 0016).
- **On success**, name each value and its source in the confirm batch (e.g. `parallel_ceiling 5 (file:repo), max_review_rounds 4 (built-in), …`) and store them for step 6's four settings substitutions. When its `ignored` list is non-empty (a `rollouts.toml` whose `schema` is newer than this snapshot's reader, ADR 0043), name each ignored key in the confirm batch too: this rollout runs without it.
- **`spend_approval_usd`** resolves here too (ADR 0034: the standing approval's limit in US dollars; built-in `0`, which is off). Name it beside the four (`standing approval 50 USD (file:defaults)`, or `standing approval off (built-in 0)`) for § 3.6's ask-ahead question. It is never stamped on the rollout: execute's `approve-gates --standing` resolves it itself at run time.
- **`verify_slots`** resolves here too (machine-wide, `[defaults]` only, built-in 2): name it in the confirm batch; it is never stamped on the rollout, and execute's `verify-timeout` reads it at each entry.

### 2.9. Propose Inert paths (ADR 0045)

A repo's **Inert paths** (CONTEXT.md) are git pathspec globs whose moves leave a green verifier run standing: at Integration, `lead-integrate.py prepare` skips the re-run when `main` moved only in them and the **Inert proof** holds on the tree being merged. They live per repo in `~/.config/thread/rollouts.toml` (`inert_paths` under `[repo."owner/name"]`, schema 2, empty by default, so an unchecked repo always re-runs), never on a rollout note. This step only proposes; the proof runs again at every skip. Parallel path only, after § 2.5's verifier and § 2.7's bootstrap, which the proof reads as steps (the task note's "§ 0" predates that order):

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py propose --repo <§ 0's resolved repo path> --tree origin/<default> --verifier '<verifier>' --bootstrap '<env_bootstrap>'
```

(no `--bootstrap` when there is none; both single-quoted, each `'` written `'\''`). Its JSON names the candidates (THREAD.md, docs/handoffs/**, docs/reviews/**) that passed the proof and are not yet recorded (`proposed`), those that failed with their readers (`refused`), the recorded globs with their streaks (`recorded`), and `drop`. inert-paths.py's header is the one copy of the proof's rules.

- **`drop` non-empty**: run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py drop --repo <repo path> --glob <g>` (one `--glob` per dropped glob) at once and name each dropped glob in the confirm batch. The drop rule reads the Run record: a recorded glob whose last three proofs at skips failed is dropped; a line with an `error` (the check itself failed) is neither a failure nor a pass. A drop only makes the repo stricter.
- **`proposed` non-empty**: one question in the confirm batch, *"Record these Inert paths for <owner/name>: <globs>? A move only in them re-runs nothing, and each is proven again at every skip."* On yes: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/inert-paths.py record --repo <repo path> --tree origin/<default> --glob <g> … --verifier '<verifier>' --bootstrap '<env_bootstrap>'`. On no, nothing.
- **`record` exit 1** (a glob failed its proof again, or the reader check refused: a live rollout's engine root cannot read the raised `schema`, ADR 0043): print its lines, name the refusing rollout in the confirm batch, and go on. It never blocks the schedule, and this skill never passes `--force` (the operator's alone).
- **Any other non-zero exit** (2: a refused rollouts.toml, no GitHub origin, a git failure): print its stderr line and go on.

### 3. Extract dependencies

Look for:

- `blocked-by:` or `depends-on:` in frontmatter (list of task slugs or wikilinks) — the only one of these that holds a task back in the queue
- `[[other-task]]` wikilinks in the body that match tasks in the discovered set — soft order hints for step 5's tiebreak, never recorded
- Body phrases like "gated on", "after X lands", "depends on" — surface them in the confirm batch (step 5) when the dependant is in the `queued` state (step 5 says why); a confirmed one is written into the dependant's frontmatter `depends-on:` at step 7, so the queue holds it back
- On a supersede, step 1's `order` lines (and, after an `interrupted` finish, § 0's): each is an order the prior rollout kept only in prose. Read each `order` line's clause: when it states that a `queued` carried task waits on another candidate, surface that `depends-on:` in the confirm batch (step 5). Skip one the dependant already records, and a clause that orders no two candidates (such as a kept task's own order: "p37-4 after p36-2, p36-6" with p37-4 landed). A confirmed one is written at step 7
- A body dependency or order line confirmed at step 5 whose dependency is in § 1.5's `out[]` re-runs § 1.5's final `preflight` with `--dep <dependant>=<dependency>`, keeping the earlier `--dep`s, and a § 4.5 combined note passed as its members. Every task the re-run newly leaves out leaves before step 6 as § 1.5's leavers do, a carried `queued` one through step 6's `defer`; a combined note leaves when any member does

### 3.5. Detect human/release gates

Some task notes carry a **human/release gate** in prose — "don't action until a release ships", "hold for sign-off", "gated on the next deploy". A `/thread:execute` agent reads the note and may refuse mid-dispatch when it hits one, so a buried gate is unreliable either way. Scan each task body, case-insensitively and with each phrase matched where a word starts (so `hold for` skips "threshold for"), for gate language of three kinds: a release hold (`don't action until`, `do not action until`, `hold for`, `until a release`, `until the next release`, `gated on a release`), sign-off in any wording, named or not (sign, signs, signed or signing before off, spaced, hyphenated or, for `signoff`, joined: `sign-off`, `sign off`, `signoff`, `signs off`, `signs-off`, `signed off`, `signed-off`, `signing off`, `signing-off`, which catch "would need Lachy's sign-off" and "until Lachy signs off" as well as `human sign-off`), and a decision the note leaves to a human (`not decide`, which catches "for the planner to raise, not decide" and "deliberately not decided"). The sign-off and decision kinds matter most unattended: a planner can declare such a line as a gated input (ADR 0008), which `ignore_gate` does not override, and an unattended lead never signs one off, so the task halts at its plan-gate (the 2.7 rollout's p2-6, whose "raise, not decide … would need Lachy's sign-off" the old fixed phrases missed). A match is a question, not a verdict. A note that only quotes or describes such wording (a task about this sweep, say) carries no gate: dismiss that match with no question, or put it to the user with a no-gate recommendation; either way it never reaches step 8's gated-tasks block, unless the user answers that it is a gate. Put each gate to the user in the confirm batch (Owner *yours*, in the Framing of `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`: a gate is his, and a `## Decided for you` bullet clears no gate, ADR 0054): keep the task (and clear the gate before executing: decide the open question in the note, remove the gate text, or set `ignore_gate: true` on the task, which overrides a release hold for the run) or drop it from this rollout. A task dropped here leaves the candidate set before step 6, so it gets no `## Queue` row, no `## File-sets` line and no `rollout:` stamp. A carried task (step 1) is the exception: step 6's carry takes every unlanded task of the prior rollout, so its drop waits for step 8's checklist, which takes it out whole. Each gate kept here becomes step 8's checklist. Don't bury the gate in the body and hope the agent honours it.

### 3.6. Sweep for gated-input smell (advisory — ADR 0008, ADR 0034)

Distinct from 3.5's release/hold gates: **gated inputs** are human *authorisations* — API spend, credentials, irreversible actions. Run the sweep over every candidate's note instead of reading word lists by eye:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/gated_inputs.py sweep <note>...
```

It prints one JSON line per note, `{slug, spend, credential, irreversible}`, each hit with its `word` and its `at` context (the script's header is the one copy of the lists). Spend smell is `credits`, `credit`, `usage credits`, `extra usage`, `paid API`, `API cost`, `budget`, `max_budget`, `billable`, `fast mode`, `per month`, `AUD` and a currency amount marker: `US$`, `A$`, `AU$`, `NZ$`, `C$` or `CA$` before an amount, or a bare `$` before an amount in prose, never a shell variable. Credential smell is `API key`, `token`, `secret`, `credential` and `prod access`; irreversibility smell is `irreversible`, `cannot be undone`, `delete production` and `wipe`. The 2026-10-10 miss (a fast-mode task whose note named usage credits) was a by-eye one: `credits` was already on the list, and the script is what closes it.

**The sweep is the recall floor, never the verdict** (as § 3.5's "A match is a question, not a verdict"):
- each hit carries its `at` context;
- a hit whose context plainly names nothing the task pays for or authorises is dismissed with no question: an LLM or design token count, a shell variable, a note that only describes this sweep;
- a currency amount, or a spend word about something the task buys or runs, is never dismissed;
- step 8 lists each dismissal on one line (`swept, dismissed: [[task]] <word> (<why>)`), so nothing drops silently;
- every other hit is put to Lachy in the confirm batch, as below.

A task with an undismissed hit gets **`plan_approval: required`** stamped in step 7 (user-confirmed in the confirm batch), so it always produces a plan whose required `### Gated inputs` declaration the engine can stop on. Like every step-7 stamp, it is proposed only for a task in the `queued` state: step 7 writes nothing to a carried task that has started.

**Ask ahead (ADR 0034).** In the confirm batch, for each `queued` task with an undismissed hit (Owner *yours*: a sign-off is his, ADR 0008; each in the Framing of `${CLAUDE_PLUGIN_ROOT}/skills/_shared/asking.md`):
- **Spend.** Ask: "up to what total exposure in USD (summed across Logins, a recurring cap counted per month)? The standing approval covers <t> USD (<source>)", from step 2.8's `spend_approval_usd`; when its source is `built-in`, say "standing approval off (built-in 0)" instead. A task that already carries an answer (a `spend_approval_usd:` stamp, or a `## Decisions (asked ahead <date>)` Spend line, an earlier schedule's or orient's, kept through a defer) shows "approved up to <N> USD (asked ahead <date>)" and is not asked again unless he changes it. An answer above <t> is stamped at step 7 as `spend_approval_usd: <N>`; any amount, above <t> or at or below it, also gets step 7's `## Decisions (asked ahead <date>)` section; "ask me" writes nothing.
- **Credential or irreversible:** sign it now, or leave it. A sign-off becomes a `## Approved gates` bullet, `- <kind>: <his words> (approved <date>, asked ahead at schedule)`, which the engine's planner restates verbatim, so a matching declaration never stops the task.

**Advisory only — the plan's declaration is authoritative** (ADR 0008): only the implementer's plan reliably knows the task needs 30 USD of Replicate credits, so the engine stops on the *declaration*, never on this sweep. The stamp merely guarantees the gate surfaces predictively at the plan-gate rather than reactively mid-implementation (a missed smell still stops — every code-writing agent carries the same stop rule). A declared gate that nothing recorded covers sets its task aside for sign-off, never the rollout (execute § 3.7). List the stamped tasks in step 8's summary as **expected to gate**, so a mid-run ask reads as designed when it happens.

### 4. Classify scope per task

Look for a `scope:` frontmatter field. Valid values:

- `single-file` — touches 1 file, no cross-cutting effects
- `cross-cutting` — touches >1 file OR modifies aggregation/composite logic that other tasks may have changed
- `read-only` — investigation / audit / no source edits

If `scope:` is absent, infer:

- 1 file detected → `single-file`
- >5 files detected → `cross-cutting`
- 0 files detected + the body mentions "investigate" / "characterise" / "audit" → `read-only`
- Otherwise leave it `single-file` but flag for user review

### 4.5. Detect and merge affine same-file clusters

Same-file tasks run side by side in the queue, and each pays for it at merge: its Integration merges the latest `main` in, re-runs the verifier, and re-reviews when a landed PR shares a file with it. When several small tasks all edit one hot file and are really **the same change, artificially split** (the recurring shape of audit-fix backlogs), every split piece pays its own plan-gate, review and Integration for what is one change, and each later piece integrates against the earlier ones. Consolidating them saves those Integrations. This step finds those clusters and folds each into **one task** before the queue is ordered.

Do this **automatically** — don't ask the user which clusters to merge. The judgement lives in the task bodies; your job is to read them carefully and apply the heuristic + guards below the same way every run. (You still confirm the *result* before authoring — see the end of this step.)

**A cluster qualifies only if BOTH hold:**

1. **Shared file** — the members' resolved file-sets (from step 2) overlap on ≥1 file.
2. **Affinity** — they are the *same kind of change*, not merely the same file. Require **≥1 strong** signal, or **≥2 weak**:
   - *Strong* — a body literally invites the fold: "consider folding X into the same Y", "same DRY-up", "shared `_helper()`", "treat as in-scope for the same PR". (Conditional phrasing — "if X is still in flight, fold it in" — still counts: once both are in one unit, the condition is moot.)
   - *Strong* — same source audit doc **and** same fix-shape verb (all "replace sentinel → NaN + NaN-aware aggregation"; all "add classifier + lossy ceiling").
   - *Weak* — mutual `[[cross-reference]]` wikilinks between the members.
   - *Weak* — shared `parent:` frontmatter, or near-identical acceptance-criteria structure.

**Never merge — even when same-file — if any of these fire (hard blocks):**

These are the guardrails on "trust Claude's read." A human who split tasks deliberately is handing you information — don't overrule it.

- **Explicit independence** — a body calls another member "independent changes to different callsites", lists it under "Out of scope", or otherwise scopes it out. The split was on purpose.
- **Dependency** — one blocks or gates the other → keep them ordered in the queue, don't fuse.
- **Mismatched review depth** — don't fold a `read-only` audit into a `cross-cutting` fix; they want different scrutiny.
- **Too big to review well** — if the merged file-set exceeds ~6 files, or you'd be fusing two `deep` (`work_depth`) tasks, the cost of reviewing one giant PR defeats the time saved. Keep them separate.
- **A carried task that has started** — never fold a task carried from a superseded rollout (step 1) whose queue state is anything but `queued`: it already has a branch, a PR or an Integration of its own.

Same-file tasks that share a file but *fail* the affinity test — three *different* fixes to one module — are the normal case. Leave them as separate queue entries; Integration serialises their merges. **Merging is the exception, not the default.**

**A merged cluster is ONE dispatch unit.** One agent, one branch, one PR, sub-tasks done *in sequence* in a single worktree. "Merge" must never mean "two same-file agents in parallel": a merged unit is still one agent, one branch, one PR. Representing the cluster as a single task (below) keeps the executor ignorant of clusters, which is why we consolidate at plan time instead of teaching the executor about them.

**How to represent it — author one combined note, tombstone the members.**

For each confirmed cluster, author a new task note at `~/repos/obsidian/Work/Tasks/<descriptive-cluster-slug>.md`, named after the *change* (e.g. `giflab-metrics-nan-sentinel-hardening.md` — pick a basename nothing else uses). Give it normal Task frontmatter:

- `tags: [task, <area>]`, `status: open`, `priority`, `projects:` (copied from the members)
- `scope: cross-cutting` — a merge always crosses the members' concerns, so the plan-gate + rigorous review apply
- `touches:` = the **union** of the members' own `touches:`, only when every member has one — the one sanctioned place the planner writes `touches:` (see Don'ts): a union of authoritative sets, not a fresh guess. Otherwise leave it unset: the union of the members' detected file-sets lives only in the rollout's `## File-sets` (step 6).
- `fixes:` = the **union** of the members' `fixes:` (task-writer § 4), when any member carries one, so the combined note names every landed task its work fixes. The Escape count does not depend on it: each tombstone keeps its own `fixes:` at `status: merged`, which the Reflection's score counts, and the count dedupes per landed task.

In the body, aggregate every member's acceptance criteria under one `## Acceptance criteria` (the implementer must satisfy all of them, in sequence), and link each original with an unpathed `[[wikilink]]` under a `## Folded-in tasks` heading so the per-task detail stays discoverable.

Then turn each member into a **tombstone** — don't delete it (backlinks to it must keep resolving, and a wrong merge has to stay trivially reversible):

- set `status: merged`
- add `merged_into: "[[<combined-note-slug>]]"`
- clear any legacy `wave:` — tombstones are never dispatched, and step 1 skips them on re-plans

`merged` is a configured TaskNotes status (`isCompleted: true`, `autoArchive: true`), so tombstones auto-archive into `Work/Tasks/Archive/` and leave the active list — their backlinks (and the combined note's `## Folded-in tasks` links) still resolve, since wikilinks are unpathed. See `obsidian-schema.md` § Task.

The rollout then references only the combined note, as an ordinary `cross-cutting` task — so `/thread:execute` and its engine need to know nothing about merging.

**After the Pre-flight.** A combined note folds only tasks still in the candidate set (§ 1.5's `queue[]`). It copies each member's `## Decisions (asked ahead <date>)` bullets into its own section of that heading, and each member's `## Decided for you (<date>)` bullets into its own section of that heading (its preamble once), each prefixed `[[<member>]]:`, so the decisions § 1.5 recorded and the calls it ruled reach the one note the engine reads. It is not graded again.

**Confirm the result before writing.** Show the user each proposed merge (members → combined note, plus the affinity signal that fired) and — just as important — the same-file pairs you deliberately *kept apart* and the guard that fired for each. This is where a misread gets caught. Get a y/n before authoring anything.

### 4.7. Offer a starting rung per task

Every task starts on the **bottom rung** of the operator's ladder (ADR 0029), and the engine climbs one rung at a stage's first evidence of hardness (see `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` § Climbing the ladder). No task needs a stamp to reach the top rung: a starting rung only saves a task judged hard the cheap first pass below it. Read the rung names, bottom first, from `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py` (one JSON line; a local file, no network).

Offer `rung: <name>` only for a task in the `queued` state that is hard:

- **`work_depth: deep`** — flagged deep/design-heavy (algorithm choice, subtle interactions, long-horizon investigation), **or**
- **`scope: cross-cutting`** that needs real design judgement, merged units from step 4.5 included.

The default offer is the rung just above the bottom (the top rung on the built-in ladder). Lachy may name any listed rung instead; refuse an unlisted name at offer time. A one-rung ladder gets no offers. Veto a rote cross-cutting task (e.g. a mechanical rename across files) back to the bottom rung: it gets no stamp. A borderline task stays on the bottom rung, unstamped: the engine climbs on evidence, so a wrong call costs one cheap first pass, not a blocked rollout.

**§ 4.7 never lowers a rung.** It makes no offer for a task that already has a non-empty `rung:`, for one step 1's preview lists as `restamp <slug> rung=<name>` (a name, not `-` or `kept`: carry writes that rung), or for a non-carried candidate whose legacy stamps map to the top rung (step 7). Show each such task in the confirm batch as `<slug>: rung <name> (kept)`. Only Lachy explicitly naming a different listed rung changes it: no default and no batch "y" ever writes a lower rung over it.

Present the offers in the confirm batch, beside step 5's Solo and dependency proposals and the gates of § 3.5 and § 3.6: "these N are hard → rung <name>: …", one line of justification each, and get a y/n (or per-task veto) before step 7 stamps them. Never stamp a rung by default, and never add `rung:` to the rollout note: it is per-task only. When `ladder.py` exits non-zero (the file is refused), make no offers: step 7's fallback leaves a top-mapping legacy stamp for execute, and step 8's "Checklist — ladder refused" block shows the file's error.

### 5. Order the queue

The rollout is a queue (ADR 0030 decision 1): tasks run in parallel up to `parallel_ceiling`, each from the `main` of its start, and only a dependency, a Solo task or, by day, the Trickle (Chorus ADR 0104; execute `away.md`) holds one back (while Lachy is Away, the Away cap does in the Trickle's place, ADR 0049; toward the Morning while Away, the last starts too). Schedule decides the order, written as the `## Queue` table's rows (step 6): a task's row is its schedule rank.

Solo and dependency proposals apply only to tasks in the `queued` state, and the confirm batch offers them for no other task. Step 7 writes nothing to a carried task that has started (running, awaiting or in Integration, or set aside), so a confirmed `solo: true` or `depends-on:` on one would be silently dropped, and a started task can't be held back anyway. Such a task keeps its place in the order (1. below) all the same.

1. **Order.** Topological by `depends-on:` / `blocked-by:` (step 3), so a task never ranks above one it depends on. A dependency cycle stays a Don't: surface it and ask. Ties are broken by step 3's soft hints (a task another body links ranks before the task linking it), then by `-p<N>-<M>-` numbering, then by slug. `priority:` is ignored here: the lead applies it at every start, then least file overlap with what is running, then this order (`reconcile-rollout.py next`), so a `priority:` edit in the vault reorders a live queue, except that a queued Solo task whose dependencies are met holds every task whose row is below it, whatever their `priority:`: place a Solo task by its row, never by raising its `priority:`.
2. **Solo.** Propose `solo: true` for a `queued` task whose sweeping change every concurrent task would otherwise redo its work around (a rename across the tree, a hub-file restructure, a shared-module move). When a Solo task is next to start, nothing new starts until every started task has merged or been set aside, and the queue resumes once it merges or is set aside. Give each proposal one line of justification, in the confirm batch, beside § 4.7's rung offers, and place a Solo task where the sweep should land, usually ahead of the work it reshapes: its row, not its `priority:`, decides which tasks wait for it.
3. **Dependencies.** The body dependencies the user confirmed (step 3), each on a `queued` dependant, are recorded in the dependant's frontmatter at step 7, so the queue holds it back.

No step here keeps same-file tasks apart or places them by file overlap: Integration keeps two tasks on one file intact.

### 6. Write the rollout note

Location: `~/repos/obsidian/Work/Tasks/<slug>-rollout-<YYYY-MM-DD>.md` — **always dated** (slug = the lowercase kebab form of the project wikilink, or a natural scope slug when the batch has one; date = today, the day you write the note — e.g. `[[GifLab]]` on 2026-07-18 → `giflab-rollout-2026-07-18.md`). The date is mandatory: an undated `<slug>-rollout` name collides with the project's next rollout, so it is **never emitted**. Legacy undated notes keep their names — no migration; the readers (`/thread:execute`, `/thread:status`, `/thread:repair`) still resolve both forms. This is the canonical rule in CONTEXT.md § Rollout.

**Dated-note naming — handles more than one rollout per day.** The filename is `<slug>-rollout-<YYYY-MM-DD>.md` for the **first** rollout of a given day, and `<slug>-rollout-<YYYY-MM-DD>-<N>.md` (N≥2) for each **subsequent** rollout that same day. Resolve N deterministically: glob `<slug>-rollout-<YYYY-MM-DD>*.md` — nothing matches → bare date (no `-N`); only the bare-date note exists → `-2`; otherwise → one past the highest existing ordinal. The first-of-day note never carries `-1` (kept bare, backward-compatible with every existing dated rollout). So a day's sequence reads `…-2026-06-09.md`, `…-2026-06-09-2.md`, `…-2026-06-09-3.md`. **Never overwrite or reuse an existing dated note** — always advance to the next free ordinal. When today's name is taken, offer only **Advance** or **Cancel**, never **Overwrite**: Advance writes the next free ordinal. A note you just wrote in error is unfinished, so § 0 already supersedes it (`--regenerate`, which writes a new note: `carry` refuses to run from a note into itself) or refuses. Any other same-day note is finished, and reusing its slug would attach its tasks' `rollout:` backlinks to the new note and lose its record, `## Completion log` included. Substitute the resolved slug into `{{ROLLOUT_SLUG}}` everywhere downstream — the note's own filename, the per-task `rollout:` stamps (step 7), the summary (step 8), and any `supersedes:` / `superseded_by:` links.

**Supersede: write, then carry.** When § 0 printed `supersede <prior-slug>`, stamp `supersedes: "[[<prior-slug>]]"` in this note's frontmatter (the template's commented line, uncommented). Once this note is written and stamped (below), run, from the prior's root (§ 0's *The prior's root*, as are this paragraph's canary `check-all` and `retire`), `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py carry --from ~/repos/obsidian/Work/Tasks/<prior-slug>.md --to ~/repos/obsidian/Work/Tasks/<this-slug>.md`. Before it, run step 1's canary `check-all` on the prior again (`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py check-all --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md`; a non-zero exit stops the run with its stderr, exit 3 → `/thread:repair [[<prior-slug>]]`). Then, when § 1.5's final `out[]` (with § 3's re-runs) holds a carried `queued` task, run from the same prior's root, before the carry, `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py defer --tasks <each such slug, comma-joined> --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md` (`/thread:repair` § 5's clean defer, which takes no `## Queue` row edit here: the prior note is closed at step 7.5). It sets each back to `status: open` with its `rollout:`, `owner:`, run stamps and automatic-retry markers cleared, so the carry, which takes every task still linked to the prior, never sees it: never carried into this queue, never left stamped to the prior. A carried task that has started is kept, never in `out[]`, so it is never passed. A non-zero exit stops the run before the carry, with its stderr: the prior is still open, so the next run's § 0 pairs the two notes as `interrupted`, and that run's Pre-flight grades the tasks again. § 0's `interrupted` finish and step 1's preview run no `defer`. Once carry exits 0, run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/git-env-canary.py retire --rollout ~/repos/obsidian/Work/Tasks/<prior-slug>.md`, which removes the prior's canary records (a retire failure is a `WARN:` carried to step 8's checklist, never a stop). The carry re-points every unlanded task still linked to the prior rollout to this note, clears its `owner:`, `integrating:` and legacy `wave:`, and maps its legacy stamps to a rung (step 1's `restamp` lines); it never writes the prior note. Its `order` lines repeat step 1's preview, and nothing reads them again. A non-zero exit stops the run with its stderr: the prior note is still open, so the next run's § 0 pairs the two notes as `interrupted` and finishes the supersede. Step 7 then stamps every task, and step 7.5 closes out the prior rollout.

**Stamp the Engine snapshot (ADR 0043).** Right after writing the note, before the carry, run from the cut's snapshot `python3 <snapshot>/skills/_shared/scripts/engine-snapshot.py adopt --rollout ~/repos/obsidian/Work/Tasks/<this-slug>.md`: it writes `engine_snapshot:` and `engine_sha:` just below `protocol_version:` (never by hand). A non-zero exit stops the run with its stderr, and the note keeps `incomplete: true`. After a cut exit 4 there is no snapshot: skip it, and the note runs unstamped.

Use the template at `${CLAUDE_PLUGIN_ROOT}/skills/schedule/rollout-template.md`. Substitute:
- `{{PROJECT_NAME}}` — display name (e.g. `GifLab`)
- `{{ROLLOUT_SLUG}}` — the resolved dated rollout slug, no extension (e.g. `giflab-rollout-2026-07-18`)
- `{{DATE}}` — today's date (YYYY-MM-DD)
- `{{VERIFIER}}` — the verifier command detected in step 2.5 (or user-provided)
- The `# completion_verifier:` line — when step 2.5 found the project's `Completion verifier:`, replace the whole line (its trailing comment included) with `completion_verifier: "<cmd>"`, on one line, always quoted, so an inline ` #` in the command survives: double-quoted, or single-quoted when it holds a `"` or a `\` (the reader takes the text up to the matching quote and refuses an escape: a `\` inside double quotes, a `''` inside single ones); a command holding a `'` and a `"` or a `\` cannot be stamped, so wrap it in a script the project runs. Otherwise leave the line commented out as written. Leave the `# completion_timeout:` line commented out as written (3600 s); a project whose full suite runs longer sets it on the note by hand.
- `{{MAX_ITERATIONS}}` — `max_iterations` as step 2.8 resolved it
- `{{MAX_REVIEW_ROUNDS}}` — `max_review_rounds` as step 2.8 resolved it
- `{{MAX_PLAN_ROUNDS}}` — `max_plan_rounds` as step 2.8 resolved it (the template's trailing comment on that line stays)
- `{{PARALLEL_CEILING}}` — `parallel_ceiling` as step 2.8 resolved it
- `{{REPO_PATH}}` — the Project root § 0 resolved and checked: `--ensure`'s output, the rollout clone of the project note's `Local:` line or of the path the user gave (ADR 0042), with that path's sub-path kept
- `{{THREAD_LINE}}` — the whole line `` Thread: `<path to the thread file>` ``, naming the project's THREAD.md or its shared thread file when one exists (e.g. `` Thread: `~/repos/tools/chorus/THREAD.md` ``); otherwise delete the line entirely — no blank placeholder line
- `{{QUEUE_TABLE}}` — the rendered `## Queue` table, header row `| # | Task | Scope | Mode |` included, one row per task in schedule order (step 5): `| <n> | [[<full-slug>\|<alias>]] | <scope> | <mode> |`. Mode is `solo` (a confirmed Solo task), `sequential-merged (one agent/PR)` (a merged unit from step 4.5: one agent does the folded sub-tasks in sequence), `carried (<queue state>)` (a task carried from the superseded rollout, with its state from step 1's preview) or `—`. The row is the task's rank (`reconcile-rollout.py next` reads a task's first wikilink on a table row or list item), so nothing above the table lists a task.
- `{{QUEUE_RATIONALE}}` — short prose explaining the order (dependencies, Solo placement, ties)
- `{{FILE_SETS}}` — a **machine-readable** per-task file-set block, one line per *editing* task: `- <full-slug>: a, b`, from step 2's best-effort file-sets (`touches:` or the paths the body names, unioned for merged units). Omit read-only tasks (no edits). `reconcile-rollout.py next` reads it only for its overlap tiebreak, and nothing halts on it. This is **rollout-note data**, distinct from the task-frontmatter `touches:` Don't (it lives in the rollout note, never stamped onto the individual tasks).
- `{{KNOWN_BASELINE_FAILURES}}` — the `## Known baseline failures` block from step 2.6: one `- <test_id> — <reason>` line per test already red on a clean `main`, or `none`. `/thread:execute` reads this block, threads it into every agent, and shifts the Ralph green criterion to "no NEW failures beyond this set" (never `--deselect`). Like `{{FILE_SETS}}`, this is rollout-note data the executor reads, never task frontmatter.
- `{{POST_ROLLOUT_ITEMS}}` — rollout-specific post-completion items (audit re-runs, downstream unblocks, validation sweeps), one numbered/bulleted line each, or `none`. These slot under the template's fixed completion-ceremony steps; at completion the ceremony (execute SKILL §4.5 step 5) converts each into a new open task + thin pointer, so phrase them as work descriptions, not instructions to leave in place.

The template's frontmatter carries `incomplete: true`: keep it as written. Step 7 removes it as its last write, once every task is stamped, and until then `reconcile-rollout.py next` refuses the note, so a run that stops between here and there (a crash, a cancel, a failed carry) never leaves a note `/thread:execute` would run with tasks unstamped. It also carries `protocol_version: 5` plus rollout-level convergence defaults: `plan_approval: scope-gated`, and `max_iterations`, `max_review_rounds`, `max_plan_rounds` and `parallel_ceiling` at the values step 2.8 resolved (with no `rollouts.toml`, the built-ins 3, 4, 3 and 4). `--regenerate` stamps freshly resolved values; a carried task's own overrides are untouched. These are inherited by every task in the rollout; per-task overrides go in the task's own frontmatter. When step 2.7 detected an env-bootstrap command, uncomment the template's `env_bootstrap:` line and set it (`/thread:execute` runs it once per worktree); leave it commented out when none. `plan_approval: scope-gated` means the plan-gate fires only for `scope: cross-cutting` tasks (other values: `off`, `required`) — see `${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md` for the gate semantics. (`completion_sentinel` is gone as of protocol 3 — the Workflow engine returns validated structured output instead of parsing sentinel strings.)

Render each task reference in the queue table as `[[<full-slug>|<short-alias>]]` for readability (escaping the alias pipe as `\|` inside the table).

### 7. Update each task's frontmatter

For each task in the rollout:

- Add `rollout: "[[<rollout-slug>]]"` backlink (a carried task already has it)
- Remove a legacy `wave:`, and a stale `owner:` on an open task (an open task has no live owner)
- Add `scope:` if not already set (single-file / cross-cutting / read-only — see step 4) — `/thread:execute` uses this to route master-review depth
- For `scope: read-only` tasks specifically, also add `max_iterations: 1` (nothing to retry)
- For tasks the user confirmed as Solo in step 5, add `solo: true`
- For the body dependencies the user confirmed in step 3 (its body phrases and its `order` lines), append `depends-on:` entries (`- "[[<slug>]]"`) to the dependant; never drop an existing entry
- For a task whose § 4.7 offer the user confirmed, or whose rung the user named explicitly, add `rung: <name>` (a rung the ladder lists) — never by default, and never on the rollout note
- For a non-carried `queued` candidate that still has a legacy stamp (a `model:`, an `effort:` or the stale cap stamp), apply carry's mapping (`reconcile-rollout.py carry`): with no non-empty `rung:` of its own, a `model: fable` or an `effort: xhigh` or `max` (trimmed, any case) becomes `rung: <the ladder's top rung>`; then remove each recognised key (`model:` at fable, opus or empty; `effort:` at low, medium, high, xhigh, max or empty; the cap stamp at any value) and leave an unrecognised value in place, listing it in step 8's "Checklist — legacy values left in place" block. When `ladder.py` refused at schedule time, still remove the drop-only keys (they need no rung name, as in carry), but leave a top-mapping legacy stamp in place, unmapped: execute's compat read (execute SKILL.md, *Legacy stamps*) maps it at runtime once the file reads, and execute halts `ladder file refused` until then. List each such task in step 8's "Checklist — ladder refused" block
- For tasks the §3.6 sweep flagged (user-confirmed), add `plan_approval: required` — advisory: it guarantees a plan-gate exists where the plan's own `### Gated inputs` declaration (the authoritative signal, ADR 0008) can stop for sign-off
- For a task whose § 3.6 spend answer is above the standing approval, add `spend_approval_usd: <N>` (whole US dollars): `approve-gates --standing` reads it before rollouts.toml (ADR 0034)
- For each § 3.6 spend answer (any amount, above, at or below the standing approval), append the `## Decisions (asked ahead <YYYY-MM-DD>)` section below to the task body, or extend in place one for the same date
- For a credential or irreversible gate he signed at § 3.6, append its bullet to the task's `## Approved gates` section (created when absent): `- <kind>: <his words> (approved <date>, asked ahead at schedule)`
- Preserve all other frontmatter fields verbatim

The ask-ahead section is exactly:

```
## Decisions (asked ahead <YYYY-MM-DD>)

- Spend: Lachy approved up to <N> USD total exposure for this task at /thread:schedule (summed across Logins, a recurring cap counted per month).
- Planner: word each spend gate as one line whose Cap is one priceable total, its period and count (in the cap's own unit) inside the cap clause, e.g. `spend: <what> — cap 50 USD per Login per month across 3 Logins`; the Cap is the task's whole ceiling, so price per-item spend into the total (never "every push" or "each image"); put how it splits (run counts, per-call limits, iterations) in sub-bullets nested under the gate, which the Cap must hold, and keep other counts, `per`/`each` words, bare numbers and words that widen the cap (`plus` tax, fees or overage, `soft`, `to start`) off the gate's own line (ADR 0038). A cap the standing approval cannot price is asked mid-run.
```

The `## Decisions` prefix makes it a recorded decision (descope asks before touching it) and keeps it out of the brief; the planner reads the note in full, so its Planner line shapes the gate the standing approval prices.

A carried task that has started (any queue state but `queued` in step 1's preview) keeps the frontmatter `carry` left it: step 7 writes nothing to it. A carried `queued` task is stamped like any other, unless § 1.5 left it out (step 6's `defer` unlinked it).

The combined notes authored in step 4.5 are stamped here like any other task (`rollout:`, `scope: cross-cutting`). Their folded-in members are **not** stamped — they already carry `status: merged` + `merged_into:` from step 4.5 and are never dispatched.

Use the same YAML field ordering the file already has; insert the new fields just below the existing `status:` line.

**Do NOT stamp `verifier:` / `max_iterations:` / `max_review_rounds:` on individual tasks by default, and never stamp a `model:` or an `effort:` at all.** The first three are rollout-level defaults — tasks inherit them automatically. Only set them per-task if the user explicitly asks to override the rollout default for a specific task during the confirm-batch step. `model:` and `effort:` are legacy stamps the engine never dispatches at: step 7 only maps and removes them. The sanctioned exceptions are read-only's `max_iterations: 1`, the user-confirmed `rung:` from § 4.7 (a rung offer confirmed, or a rung named explicitly; per-task only, it has no rollout-level form), the §3.6 sweep's `plan_approval: required` on gated-input-smelling tasks, and the § 3.6 ask-ahead answer: `spend_approval_usd: <N>` above the standing approval, the `## Decisions (asked ahead <date>)` section, and a credential or irreversible sign-off's `## Approved gates` bullet — all deliberate per-task decisions, not defaults.

**Then clear this note's stamp.** Once every task above has its stamps (a carried task that has started keeps what `carry` wrote), remove the `incomplete: true` line from this rollout note's frontmatter: it is step 7's last write, after every task stamp and before step 7.5's close-out. A run that stops anywhere earlier leaves the stamp, so `reconcile-rollout.py next` refuses the note and § 0 offers it to the next `--regenerate`. Remove only the stamp on the note this run wrote: one § 0 put on an interrupted supersede's note ends only when a supersede closes that note.

### 7.5. Close out a superseded rollout

**Score the prior rollout first (ADR 0037 d4).** Before the close-out below stamps the prior note, run the script half of a Reflection on it, from the prior's root (§ 0's *The prior's root*), with the Bash tool's `timeout: 600000`:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/close-score.py --rollout <the prior note where it sits> --close supersede
```

It records one `tunings.jsonl` line, or prints `already recorded <id>` (a re-run, after a run that died past this point) or `not recorded: nothing ran` (a never-started prior). Report its one line in step 8's summary. A non-zero exit is a `WARN:` for step 8's checklist, never a stop: the close-out goes on.

**Superseding a prior rollout.** Close out the prior rollout last, after step 7 has stamped this rollout's tasks, so an interrupted run always leaves the prior note open for § 0 to pair with this one. Step 6 stamped `supersedes: "[[<prior-slug>]]"` in this note's frontmatter and carried the prior note's unlanded tasks here. Now set `status: done` + `superseded_by: "[[<this-slug>]]"` on the prior note, stamps first and then the move. This note is always a new file (step 6 never offers **Overwrite**), so the prior note is never the note this run wrote. Then move it with a plain `mv` into `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`, running `mkdir -p` on that folder first if it is absent. The move is explicit because a note left in `Work/Tasks/` at `status: done` is filed into `Work/Tasks/Archive/` by the daily sweep (`_shared/scripts/daily-sweep.sh`), which is the wrong folder for a rollout. Find the prior note wherever it now sits: `Work/Tasks/<prior-slug>.md` is the normal case; at `Work/Tasks/Archive/<prior-slug>.md` the daily sweep already filed it (a run that died between the stamps and the move, which § 0's `file` line finishes, or a note superseded under older wording), so move it on from there; already in `Work/Tasks/Archive/Rollouts/`, leave it where it is. Never overwrite a same-named file already in `Archive/Rollouts/`: on a collision skip only the move, report the collision and continue the run; meanwhile the daily sweep files the stamped note into `Work/Tasks/Archive/`, and ADR 0026's shared reconcile step flags it as drift until someone resolves the collision. Schedule leaves the commit to the daily sweep, which commits the move with the rest of this run's vault writes (the planner runs no git, per the Don'ts). Wikilinks resolve by filename, so `supersedes:`, `superseded_by:` and the tasks' `rollout:` backlinks survive the move. As a backstop, ADR 0026's shared reconcile step reports a superseded rollout note outside `Archive/Rollouts/` as drift. Landed tasks stay linked to the prior note; carried ones now belong here.

### 8. Print summary

```
Queue for {{PROJECT_NAME}} written to [[{{ROLLOUT_SLUG}}]] — N tasks (K carried from [[<prior>]], S solo).
filed [[<P>]] into Archive/Rollouts/                     # one line per § 0 `file` finish
finished the interrupted supersede of [[<P>]]; [[<N>]] was incomplete and is superseded here   # per `interrupted` finish
scored [[<P>]]: <close-score's line>                     # per close-score.py run (step 7.5, § 0's `file` finish)
cleared [[<P>]]'s start when ready: superseded here      # when § 0's Supersede prep removed its start: unattended
Engine: snapshot <sha12> at <path> (origin/<default>)     # or: Engine: no snapshot (<the cut's exit-4 reason>)
Verifier: <detected command>
Settings: parallel_ceiling <n> (<source>), max_review_rounds <n> (<source>), max_iterations <n> (<source>), max_plan_rounds <n> (<source>); standing approval <t> USD (<source>), or off (built-in 0)
Pre-flight: <n> graded (<r> Ready, <c> One call, <g> Grill, <o> Orient), <u> ungraded, <k> decided in the round, <m> left out; Grade log: <log's line>
                                                         # under orient-all: Pre-flight: grades and answers from the estate pass, <m> left out

Project root: {{REPO_PATH}}                              # the rollout clone (ADR 0042)
Open in Obsidian to review. To execute, start a session in the Project root, then:
  execute [[{{ROLLOUT_SLUG}}]]                # continuous: the queue runs and merges to the end
  execute [[{{ROLLOUT_SLUG}}]] --gated        # pause for a human before each merge
  start when ready                            # stamp start: unattended; the Chorus Stage starts the lead once the note is runnable

The thread:execute skill at ${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md reads this note and runs the three-layer convergence engine (plan-gate → Ralph retry → master review) via the Workflow tool.
```

**Start when ready.** When Lachy answers a standalone run's summary with it, stamp `start: unattended` as a top-level frontmatter line just below `status:` on the note this run wrote (`_shared/vault-grammar.md` § Rollout start stamp) and stop: nothing runs. Under orient § 6, schedule writes nothing here, because orient § 9's offer asks it. Under orient-all, schedule writes nothing here either. The stamp is never written before step 7's last write; the vault grammar's reader would wait on `incomplete:` anyway.

**Pre-flight's left-out tasks.** List above the summary every task § 1.5 left out (its final `out[]`, with § 3's re-runs), each with its why, then each answer § 1.5 could not write, each ungraded task queued as it stands (its answer is never recorded, so this line is its only trace) and each of its `warnings[]`. None of the left-out tasks is stamped, and a carried one is no longer linked to the prior:

```
Left out by the Pre-flight (none is stamped; each waits on what its line names):
  - [[task-o]] — graded Orient: /thread:orient [[<home>]]
  - [[task-c]] — One call, waiting on your answer: the next schedule asks it again
  - [[task-u]] — ungraded (no grade), left out at your answer: the next schedule asks again
  - [[task-d]] — depends on [[x]], which is left out (the Dependent closure)
  - [[task-q]] — Grill, waiting on your answer; carried from [[<prior>]], deferred out of it at step 6
answered, not written: [[task-g]] Cache? → lru (record refused: <its estate-dispatch line>)
queued as it stands: [[task-v]] (ungraded: status outside Active), at your answer, for this run only
warning: [[task-s]] keeps its place (a carried task that has started) but depends on [[task-o]], which this rollout leaves out
```

Under orient-all, the block lists the fork's leavers the same way, and the fork returns them with each one's why (orient-all § 8 lists each by that why, as this block does).

**Decided for you.** List above the summary what § 1.5's `decided-for-you` wrote (asking.md § 2): the less sure first,
at most 8 lines, then `and <k> more in the task notes`; then one line per `refused[]` item. Under orient-all, the fork's
summary carries the block:

```
Decided for you (<n>; each in its task note's ## Decided for you, where you can overturn it):
  - [[task-g]] Cache? → none (technical, medium: <why>)
  - [[task-r]] Log format? → jsonl (priorities: <why>)
  and <k> more in the task notes
not written: [[task-q]] Lock file? (<the refusal's why>)
```

**Checklist — gated tasks.** If the user kept any of step 3.5's human/release-gated tasks (a quote-only match is none), list them above the summary so the user clears them before executing (an unaddressed gate makes the agent refuse mid-run):

```
⚠️ Checklist — these tasks carry a human/release gate. Clear each before executing, or they'll refuse mid-dispatch:
  - [[task-x]] — "don't action until the v0.5 release ships"
  - [[task-u]] — "open question for the planner to raise, not decide … would need Lachy's sign-off"
To run a release hold anyway, set `ignore_gate: true` on its task note (overrides the gate for the run). A sign-off or an undecided question needs deciding in the note (or its text removed): `ignore_gate` cannot unblock a gated input a planner declares from it. To drop one after all, take it out whole: clear its `rollout:` and delete its `## Queue` row and its `## File-sets` line from this note.
```

**Checklist — capture-shaped notes.** Engine agents read a task note in full, so a note still shaped as a capture (`skills/_shared/task-writer.md` § 5) steers them wrong. Scan each task in the rollout (carried ones included) for either shape: a `## Resume prompt` carrying task-writer's close-the-capture line (`mark the capture done`), which tells an agent to set `status: done` on a note the engine owns, or a `## Launch` section whose **Repo:** names another checkout of the same repo: a path other than § 0's resolved repo path with the same `origin` URL (`git -C <path> remote get-url origin`), which points an agent at the wrong tree. A **Repo:** that names a different repository (another `origin`) is no capture shape: that task's work is not in this rollout's repo, so it is a misfit under § 0's rule, to drop and never to clear (take it out whole, as for a gated task above). When the path is missing here, so no origin can be read, ask the user which it is. Skip a note only when its **Rollout run** line names this rollout, `[[{{ROLLOUT_SLUG}}]]`: that note is already cleared. A **Rollout run** line that names another rollout (a carried task's line, written for the superseded rollout and perhaps its old root) is stale, so flag the note to have that line rewritten for this one. The repo comparison is against § 0's path. § 0's self-rollout check keeps a rollout off a primary checkout it can see (a directory-source marketplace in a readable registry, or this session's `${CLAUDE_PLUGIN_ROOT}`), so a **Repo:** naming that checkout is flagged; one it cannot see (another session's `--plugin-dir`, or a malformed registry, where the check fails open) may be § 0's path itself, and then a **Repo:** naming it matches and is not flagged. List each match above the summary with the shape it shows, then the line that clears it, to add at the top of the note's `## Notes` (in place of a stale **Rollout run** line) with the sentence for each shape the note shows, and list each misfit to drop:

```
⚠️ Checklist — capture-shaped notes (engine agents read the whole note and may follow its resume prompt):
  - [[task-v]] — resume prompt says "mark the capture done"; ## Launch repo ~/repos/tools/x-old, another checkout of ~/repos/tools/x
  - [[task-s]] — its Rollout run line names [[<prior>]], not this rollout
Clear each by adding at the top of its ## Notes (keep the sentence for each shape it shows; replace a stale Rollout run line):
  **Rollout run (lead, <date>): read this first.** This task runs under [[{{ROLLOUT_SLUG}}]]; work only in your worktree of `<§ 0's repo>`.
  The `## Launch` repo names another checkout of this repo, so edit the same repo-relative files in your worktree instead.
  Skip the resume prompt's "mark the capture done" step, because the engine owns this note's `status`.
Drop each of these whole, as for a gated task (its ## Launch repo is another repository, so it is a § 0 misfit):
  - [[task-t]] — ## Launch repo ~/repos/workspaces, another origin
```

**Checklist — rollout clone.** List the `note:` and `WARN:` lines § 0's `--ensure` printed verbatim
above the summary: the gitignored local state the in-place checkout has and the clone lacks (nothing is
copied; copy an item by hand when the lead needs it), a clone it could not fast-forward, and a launch
marker with no `.mcp.json` beside it, which the Chorus Stage refuses to start a Session in. Name the
clone when § 0 made it this run. A lead runs at the Project root, or at an ancestor of it within its
toplevel (execute § 2.8): a lead started by hand in a never-opened clone sees the workspace trust dialog
once; the Stage's unattended start does not.

```
⚠️ Checklist — rollout clone (~/repos/<repo>-rollout; made by this run):
  self-rollout-check: note: ~/repos/<repo>-rollout lacks .claude/settings.local.json, which ~/repos/<repo> has: …
```

**Checklist — local copies agents won't see.** If step 2's pushed-base re-run printed any WARN
lines, list them verbatim above the summary, so the user commits and lands those files (or accepts
GitHub's copy) before executing:

```
⚠️ Checklist — local copies agents won't see (agents read origin/<default>'s copy):
  pushed-base: WARN: docs/adr/0031-x.md: uncommitted change: agents see origin/master's copy, not this one
```

**Checklist — ladder refused.** If `ladder.py` exited non-zero at § 4.7 (so no rung was offered), show its stderr line verbatim above the summary, then one line per task whose top-mapping legacy stamp step 7 left in place, then the remedy:

```
⚠️ Checklist — ladder refused (execute halts `ladder file refused` at each call's start until it reads):
  ladder: /Users/<you>/.config/thread/ladder.toml:11: rung 2 ("opus-xhigh"): effort "huge" is not one of low, medium, high, xhigh, max
  - [[task-z]] — model: fable left for execute's compat read
Fix: edit the named line of ~/.config/thread/ladder.toml, then execute.
```

**Checklist — legacy values left in place.** If step 7 left an unrecognised legacy value on a non-carried candidate, list one line per value above the summary, in carry's own `WARN: carry:` format with `schedule` in its place, so the two read alike (a carried task's lines already showed in step 1's confirm):

```
⚠️ Checklist — legacy values left in place (no rung was mapped from them; correct or remove each by hand):
  WARN: schedule: task-w: effort: banana unrecognised, left in place
```

**Checklist — unfinished-rollout warnings.** List the `WARN:` lines § 0's unfinished-rollout check printed (a Project root matched on its path only, a rollout left out for want of a Project root line, a complete rollout whose ceremony never ran, a superseded note it could not file, an incomplete rollout this run superseded) verbatim above the summary, so the user can resolve each.

The detected file-sets (step 2) are listed as information, never as a question: they only break queue-order ties.

Likewise list the §3.6 gated-input stamps with what was recorded ahead and what will still ask mid-run, so a mid-run ask reads as designed (ADR 0008, ADR 0034: a declared gate nothing recorded covers sets its task aside for your sign-off, never the rollout; `ignore_gate` does NOT override a gated input). A carried gate-pending task is listed with its pending gates verbatim and "waiting on your sign-off", and each § 3.6 dismissal gets its `swept, dismissed:` line:

```
Expected to gate (each set aside for your sign-off if its plan declares a gate nothing recorded covers; never the rollout):
  - [[task-y]] — smells of API spend ("~30 USD of Replicate credits") → plan_approval: required; approved up to 30 USD (asked ahead 2026-10-14)
  - [[task-x]] — smells of a credential ("the Stripe API key") → plan_approval: required; signed ahead: credential: the Stripe test key
  - [[task-w]] — smells of API spend ("fast mode") → plan_approval: required; a gate above the standing approval (50 USD, file:defaults) still asks mid-run
  - [[task-v]] — carried gate-pending, waiting on your sign-off: spend: fast mode — cap 50 USD per Login per month
swept, dismissed: [[task-u]] token (an LLM token count: "~31.5k tokens")
```

## Serial path

An all-serial set (§ 0: no member parallel-shaped, at least one serial-shaped) runs here instead of steps 1–8, and
writes one **serial rollout** note per chain (ADR 0040): `shape: serial`, the chain's tasks in order, each row with
the launch its Leg opens in, and the chain's surfaces. Chains whose surfaces are disjoint run side by side; a chain
that writes a repo checkout owns that checkout. A member claims its launch folder, each path its `## Launch` names
(its launch commands' `--add-dir` and `cd` paths among them, fenced or not), each `Local:` path of its first
project and each surface added for it, or exactly what it declares in `surfaces:`, and every claimed path inside a
git checkout widens to that checkout's toplevel. It never claims its launch profile's other Working roots (a
workspace launcher's `add_dirs`), another project's `Local:`, a project's `repos:`, nor a repo or external system
it writes but names nowhere: those are outside schedule's sight, which is why the default's WARN says to declare
`surfaces:` for them (`serial-chains.py`'s header is the one statement of the surface grammar). Nor does it claim a
`## Launch` path that is `/` or the home directory (a bare `cd ~` or `--add-dir ~`), which would contain every
repo: a WARN names it.

**S1. Discover.** Step 1's filters and skip rules pick the members (or take the `--tasks` set): a task already
linked to a live rollout of either shape is skipped and named, and so is a decision task. Session-lane misfits are
named as such and left unstamped. A standalone run confirms the member list in S4's batch; under orient § 7
or orient-all § 6 nothing is asked.

**S2. Plan.** Run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/serial-chains.py plan --tasks <serial members> [--surface <slug>=<raw>]… [--dep <slug>=<slug>]…`.
It prints one JSON line: `chains` (each with its `tasks` in order, its `surfaces`, its `members` with each one's
`surfaces`, `source`, `added` and `launch`, and its `externalDeps`), `sessionLane` and `warns`. Pass a path the
agent reads in a member's body (outside `## Launch`) as `--surface <slug>=<path>` only for a member with no
declared `surfaces:`: a declaration is the member's whole claim. Exit 3 (an unknown, null or missing launch
folder, a missing launch-folders file an alias needs, a dependency cycle, a malformed declared token) or exit 2
stops the run before anything is written: print its stderr verbatim. Name each `sessionLane` member, with its
`why`, as ruling (c)'s session lane (no serial self-rollouts, the fit doc's **Rulings**) and leave it unstamped.
Carry the `warns` to the confirm and to S7.

**S3. Live chains.** For every chain, run
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --shape serial --surface <token>… (--project <target> | --tasks <the chain's members>)`,
one `--surface` per token of the chain's `surfaces`, passed verbatim from S2's JSON (and `--regenerate` when this
run has it, which only WARNs: a serial run supersedes nothing). Every chain is checked, even after one is refused.
`none` → go on. Any refusal (`refuse …`, exit 3) or exit 2 stops the whole run before anything is written, and
every refusal's stderr goes in one report: each line names the live chain or unfinished parallel rollout, its
project and state, the overlapping pair and its remedy (a never-started chain's is `status: dropped`, which frees
its tasks for a later run). Tokens compare literally (`repo:<realpath>`), so a chain on a repo's in-place checkout
never overlaps a parallel rollout rooted in its rollout clone: the two coexist as peers (ADR 0042, intended), while a
chain that claims `repo:<clone>`, or a parallel rollout rooted in place before ADR 0042, still refuses. Carry `WARN:`
lines to S7.

**S3.5. Pre-flight.** It runs step 1.5 over S2's chain members, the session-lane ones left out; nothing is kept and
nothing is superseded on this path, so there is no `--kept` and no `--superseding`. Under orient's § 7 too it asks its
round (decisions, never a confirm). A member that leaves re-runs S2 and S3 without it, as S4's confirmed dependency
does. An empty queue stops before S4 with step 1.5's empty-queue report. Under orient-all it takes § 1.5's
orient-all form, with `--tasks` the chain members.

**S4. Gates and confirm.** § 3's dependency extraction, § 3.5's gate sweep and § 3.6's gated-input sweep run over
the members. § 3.6's `<t>` comes from
`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py`, with `--repo <path>` exactly when the
chain holds one `repo:` token that is a directory, else with no `--repo`; a non-zero exit stops the run as step
2.8's does. A standalone run's confirm batch lists S1's members; each chain (its order, each row's launch, each
member's surfaces with its source and its added tokens); the session-lane members; the WARNs; and the questions
(§ 3's dependencies, § 3.5's gates, § 3.6's ask-ahead). A confirmed dependency (passed as
`--dep <dependant>=<dependency>`), or a surface Lachy adds for any member (passed as `--surface`, which always
unions in, declared or not), re-runs S2 and S3; a confirmed dependency whose dependency left at S3.5 also re-runs
step 1.5's final `preflight` with `--dep`. Under orient § 7 or orient-all § 6 nothing is asked: the kept gates and § 3.6's hits
are listed in S7. Steps 2, 2.5–2.9, 4, 4.5, 4.7 and Solo are skipped on this path, and `plan_approval:`, `scope:`,
`rung:` and `solo:` are never proposed.

**S5. Write.** One note per chain, from `${CLAUDE_PLUGIN_ROOT}/skills/schedule/serial-rollout-template.md`. Naming
follows step 6: the first chain takes the next free `<slug>-rollout-<YYYY-MM-DD>` name and each further chain the
next ordinal (`-2`, `-3`, …), never **Overwrite**. The shared placeholders (`{{PROJECT_NAME}}`, `{{DATE}}`,
`{{THREAD_LINE}}`, `{{QUEUE_RATIONALE}}`, `{{POST_ROLLOUT_ITEMS}}`) are substituted as step 6's bullets say, and
the template's own as below. Keep the template's `incomplete: true`: S6 removes it.
- `{{SURFACES}}` — the chain's `surfaces` from S2, one `  - "<token>"` line each (quoted, two-space indent), under the template's `surfaces:` key: the places this chain owns while it is unfinished.
- `{{CHAIN_TABLE}}` — the rendered `## Queue` table, header row `| # | Task | Launch | Surfaces |` included, one row per task in S2's order: `| <n> | [[<full-slug>\|<short-alias>]] | <launch> | <tokens> |` (the Task cell's `<short-alias>` is step 6's display alias, never the launch alias), where `<launch>` is the row's launch alias and folder, each in backticks, joined by `from` (`` `cc-ops` from `<folder>` ``), and `<tokens>` its member's surfaces, each in backticks. A launch change between two rows is a Leg boundary: a Leg works only rows of the launch it opened in. No wikilink appears outside the Task cell, since a row's first wikilink is its rank.
- `{{SURFACE_SOURCES}}` — one line per member, `- <slug>: <tokens> (<source>[; added: <tokens>])`, from S2's `members`.

Then stamp each note written with the Engine snapshot, as step 6 does: `python3 <snapshot>/skills/_shared/scripts/engine-snapshot.py adopt --rollout <the note>` from the cut's snapshot, right after writing it; a non-zero exit stops the run with its stderr, the note keeping `incomplete: true`; skipped after a cut exit 4.

**S6. Stamp.** Each member of each note written gets `rollout: "[[<its note>]]"`, step 7's clear (its second
bullet), its confirmed `depends-on:` entries and, on a standalone run, § 3.6's ask-ahead writes (step 7's
`spend_approval_usd:`, `## Decisions (asked ahead <date>)` and `## Approved gates` bullets). Nothing else is
stamped: no `scope:`, `plan_approval:`, `rung:` or `solo:`, and never a derived or added `surfaces:`. Then remove
the note's `incomplete: true` line, as its last write, once every member is stamped.

**S7. Summary.** Per note: its name, its chain order with each row's launch, and its surfaces. Then
the Pre-flight line and its left-out tasks, as step 8 lists them (Orient → `/thread:orient [[<project>]]`, undecided
→ waiting on your answer, ungraded, `depends on [[x]]`), its Decided for you block, the session-lane members, the WARNs and the gated checklist (§ 3.5's kept gates, § 3.6's ask-ahead and dismissals, as
step 8 lists them). Then one line: "Leg 1 opens in row 1's launch and runs `/thread:execute [[<note>]]`;
no execute offer, no `start: unattended` (the Stage's unattended start needs a Project root); until it finishes or
is dropped (`status: dropped`) it holds its surfaces, so a parallel run on a checkout it claims, or another chain
over them, is refused".

## Execution lives in `/thread:execute`

This skill does not execute anything. The rollout note it produces is read by the sibling **`/thread:execute`** skill (`${CLAUDE_PLUGIN_ROOT}/skills/execute/SKILL.md`), which resolves per-task config and calls the **Workflow** tool with `task.workflow.js` — the convergence engine (plan-gate → Ralph retry → master review). The engine is not duplicated into individual rollout notes; improvements to the script reach a rollout at its next Reinstate (ADR 0043): each rollout runs on the Engine snapshot its note names.

## Don'ts

- Don't refuse small rollouts — shape decides, not count (`skills/_shared/execution-fit.md`). A one-task parallel rollout is valid; note the ceremony is thin and proceed.
- Don't auto-merge dependency cycles silently — if A depends on B and B depends on A, surface and ask. (This is about *dependency* cycles — distinct from the affinity-cluster consolidation in step 4.5, which is a sanctioned auto-merge of same-*change* tasks.)
- Never overwrite or reuse an existing rollout note: step 6's naming prompt offers only Advance or Cancel.
- Never remove `incomplete: true` from a rollout note except as step 7's (or § Serial path S6's) last write on the note this run wrote: a stamp on any other parallel note (§ 0's on an interrupted supersede's note, or one a stopped run left) ends only when a supersede closes that note out, and one on a serial note, which a supersede never takes, ends only by `status: dropped`.
- Don't touch tasks outside the target project (the `projects:` filter is strict).
- Don't fill in `touches:` on tasks where you regex-detected files — that promotes a guess into authoritative metadata. Only the user does that. The **one** exception is the combined note authored in step 4.5: when every member has its own `touches:`, its `touches:` is their union, so it's a derivation, not a fresh guess. (Separately, the `## File-sets` block in the **rollout note** — step 6 — records the best-effort file-sets, but that's rollout-note data the executor reads, never task frontmatter, so it doesn't touch this rule.)
- Don't run `git` operations or open PRs from the planner — the planner only reads/writes vault files, except the Engine snapshot's cut and its sweep (listed under Scope), § 0's probes (listed under Scope) and its rollout-clone setup (the `git clone`, the empty-directory probe, and the fetch plus `--ff-only` merge of the clone, listed there too), a supersede's `reconcile-rollout.py resume`, whose `gh pr view` / `gh repo view` calls are read-only, a supersede's `git-env-canary.py check-all` and `retire`, whose git calls are read-only, step 2.8's `rollout-settings.py`, whose `land.sh --origin-slug` runs a read-only `git remote get-url origin` (only when `rollouts.toml` holds a repo table), `close-score.py` (step 7.5, § 0's `file` finish), whose git calls are read-only and whose only writes are its events-directory lines (both listed under Scope), § Serial path's `serial-chains.py`, whose `git rev-parse --show-toplevel` and `git remote get-url origin` calls are read-only (listed under Scope), and § 1.5's grading agents, which only read (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/readiness-grade.md` § What the agent reads).
- Never write a second unfinished parallel rollout on a repo, or a serial chain over a live chain's surface, and never supersede one that § 0 did not print as `supersede`.
- Never supersede across shapes: a serial run supersedes nothing, and a parallel run never takes a serial note.
- Never stamp a derived or added `surfaces:` on a task: a task's `surfaces:` is its own declaration.
- Never write `inert_paths` except through step 2.9's `inert-paths.py record` (after Lachy's yes) and `drop`, and never pass `--force` to `record`: a refused reader check is printed and the schedule goes on.
- Never move a rollout note except by step 7.5's move (which § 0 also runs for `file` and `interrupted`).
- Never hand-edit `engine_snapshot:` or `engine_sha:`: only `engine-snapshot.py adopt` writes them (ADR 0043), and never run a prior's commands from this run's snapshot (§ 0's *The prior's root*).
- Never write `start: unattended` except at the execute offer (orient § 9, step 8's **Start when ready.**) on the note just written, or as § 0's **Put back**: the exact line the Supersede prep removed, restored to the prior when the run stops before step 6 writes its note. The prep otherwise only removes it; never on a serial note.

## Verification

End-to-end test against an existing backlog (e.g. GifLab):

1. `/thread:schedule GifLab` from any Claude Code session
2. § 0's unfinished-rollout check prints `none` (or `supersede <prior>` on `--regenerate`), then it confirms ~9 open tasks and prints the detected file-sets as information, with no confirm turn for them
3. § 1.5 grades the tasks still to start, asks One calls and Grills one question at a time with a recommendation each, and leaves Orient tasks out with their dependants, listed with `/thread:orient`
4. Step 2.5 detects `make test` (or whatever GifLab's CLAUDE.md prescribes) — prints it and asks to confirm
5. Orders the queue (dependencies first, Solo proposals and § 4.7's rung offers in the confirm batch)
6. Writes the always-dated note `giflab-rollout-<YYYY-MM-DD>.md` (advancing to the next `-N` ordinal if today's already exists), its `## Queue` table in schedule order.
7. Rollout note carries no `incomplete:` line (step 7's last write removed the one it was born with), and carries `protocol_version: 5`, `verifier:`, `plan_approval: scope-gated`, and `max_iterations`, `max_review_rounds`, `max_plan_rounds` and `parallel_ceiling` at the four values step 2.8 printed (with no `rollouts.toml`, the built-ins 3, 4, 3 and 4) in frontmatter, plus a commented-out `env_bootstrap:` line (set only when the run needs it) and a `completion_verifier:` line, commented out unless step 2.5 found the project's `Completion verifier:`. No inline execution playbook — the rollout body is data only.
8. Stamps `rollout: "[[...]]"` and `scope:` on each task, and removes any legacy `wave:`
9. Prints summary pointing the user toward `/thread:execute`

Then from a fresh session: paste `execute [[giflab-rollout-<YYYY-MM-DD>]]` (the dated note just written) — the `/thread:execute` skill should pick it up, gate on `protocol_version: 5`, resolve per-task config, and call the Workflow tool with `task.workflow.js` to run the three-layer convergence engine per task (visible live via `/workflows`).

### Serial regression (§ Serial path)

- Two serial-shaped tasks that declare disjoint `surfaces:` give two notes, `<slug>-rollout-<date>` and `-2`, each `shape: serial` with one chain, and no task stamped with a `surfaces:`.
- Two tasks in one checkout give one note with one chain; when their aliases differ, its `## Queue` rows carry two launches, a Leg boundary between them.
- A chain whose surface overlaps a live serial note's is refused at S3 with that note's remedy, and nothing is written.

### Merge regression (step 4.5)

The GifLab backlog is a good fixture because it exercises both a merge and a deliberate non-merge in one run. Against the open backlog, `/thread:schedule GifLab --regenerate` should:

- **MERGE → "metrics.py sentinel → NaN hardening":** `giflab-dry-ssimulacra2-fallback-dict` + `giflab-lpips-fallback-nan-sentinel` + `giflab-per-frame-exception-nan-sentinel`. All replace fabricated sentinels with `float("nan")` + NaN-aware aggregation in `metrics.py` error paths, and the LPIPS task literally says *"consider folding LPIPS into the same DRY-up… shared `_nan_fallback_dict(keys)`"* (strong signal). 3 Integrations → 1.
- **MERGE → "content-classifier lossy ceiling":** `giflab-data-viz-animation-lossy-guard` + `giflab-photographic-content-lossy-ceiling`. Both build the same pre-compression classifier + `lossy_max` machinery; only the heuristic differs. 2 → 1.
- **KEEP SEPARATE (guard fires):** the `composite_quality` trio `giflab-composite-quality-bare-vs-mean-key-mismatch` + `giflab-composite-quality-nan-guard` + `giflab-temporal-consistency-composite-quality-fix`. They share `enhanced_metrics.py`, but the nan-guard task calls the per-frame task *"independent changes to different callsites"* and scopes the temporal task out — explicit-independence hard block. Kept apart; Integration serialises their merges.
- Members of the two merges end up `status: merged` + `merged_into:`, any legacy `wave:` cleared; a second `--regenerate` skips them (step 1).
- The queue drops from ~9 entries to ~6 (the two merges save three Integrations).
