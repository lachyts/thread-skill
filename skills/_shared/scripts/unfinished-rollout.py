#!/usr/bin/env python3
"""unfinished-rollout.py — at most one unfinished parallel rollout per repo and project, each project's in its own
rollout clone; serial chains limited by surfaces (schedule § 0 and § Serial path; ADR 0027, ADR 0030, ADR 0040, ADR 0060,
ADR 0064).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check [--shape parallel] --repo <path>
        (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --shape serial --surface <token>...
        (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check [--shape parallel|serial]
        --resume <slug> (--repo <path> | --surface <token>...) [--project <name> | --tasks <slug,...>] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py hold --rollout <slug> [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py clone --repo <Local:> --project <name>
        [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py branches --repo <path> --tasks <slug,...>
        [--tasks-dir <dir>]

/thread:schedule § 0 runs the parallel check last, after the remote, landing-register, self-rollout and pushed-base
checks, and acts on the one line it prints; § Serial path S3 runs the serial check once per chain. Stdlib only,
python >= 3.9. No network. Git runs only as `git rev-parse --local-env-vars` (to scrub repo-local env vars such as a
hook's GIT_DIR, landing-register.py's rule), `git -C <path> remote get-url origin` and, in `check` and `clone`, `git -C
<dir> rev-parse --show-toplevel` for the nested-checkout rule (below) and each Project root's checkout; plus one child,
`bash skills/execute/scripts/self-rollout-check.sh --in-place <path>` (check's step 2c, `clone`) and `--resolve <Local:>
<slug>` (`clone`'s rule 3 only), both read-only and memoised (SelfRollout), which run git and land.sh themselves. It
writes nothing. The surface grammar (parse_token,
overlaps, read_surfaces), norm_origin and the Git reader are serial-chains.py's, loaded by `check`, `hold` and
`pickups` (never by `running`, primary-hold.sh's verb, which loads only reconcile-rollout.py). What a serial chain
holds is leg.py's hold_of (ADR 0060), loaded as a module (Chain, chain_read, hold_of, Refuse; its rr and sc set to this
script's) once `check` or `hold` reads the first unfinished serial note (one whose `surfaces:` reads as any included),
so a parallel-only estate never loads it.

Terms (CONTEXT.md). A LIVE rollout note sits directly in the tasks dir (location only, as
reconcile-project.py and /thread:close read it). An UNFINISHED rollout is narrower: a live rollout that is
neither `done` nor `dropped` and still has a task not merged (or no task yet).

Rules.
- Candidate: a note directly in the tasks dir (never Archive/**), tagged `rollout`, status not done/dropped.
- Same repo: the realpaths of the note's expanded `Project root:` and of --repo are equal, or both origins
  are readable and equal once normalised (serial-chains.py's norm_origin: an `https://github.com/`,
  `git@github.com:` or `ssh://git@github.com/` prefix stripped, a trailing `/` then `.git` dropped, lower-cased;
  any other URL is compared whole). A Project root that is missing here, or not a git repo with an origin, is compared on its
  path only, with `WARN: <slug>: Project root <p> is not a git repo with an origin here: matched on its path
  only`; --repo the same (`WARN: --repo <p> …`). No `Project root:` line: `WARN: <slug>: no Project root
  line: not counted`.
- This project's: the run's project set is {norm(--project)}, or with --tasks the intersection of the named
  tasks' `projects:` (each note found root-first, then under Archive/); an empty intersection WARNs `the
  named tasks share no project`, and no rollout is then this project's. A candidate is this project's when
  norm(its `projects:`) meets that set; the filename never counts. norm: the wikilink's note name,
  lower-cased, every run of non-alphanumerics turned into `-`, trimmed.
- Complete: at least one linked task and every one merged (reconcile-rollout.py's queue states).
- Never started: reconcile-rollout.py's never_started (only execute's own marks), widened for an approved queue whose
  only marks are the Stage's ended room stops (reconcile-rollout.py's approved_unrun; vault-grammar § Approved queue).
- Eligible: this project's, and paused (`paused:`) or never started.
- What a serial note holds (ADR 0060 d1, d2; leg.py's header, *The hold*): its whole `surfaces:`, but while leg.py
  reads its chain state as `stuck` only its unlanded rows' Queue `Surfaces` cells (set-aside rows, rows held behind
  them, a missing note's row) plus any `surfaces:` token no row's cell names; the rest, done rows on the next Leg's
  smoke list included, is released. A stuck chain whose Queue has no rows, an unlanded row's cell empty or malformed,
  or a row in progress, holds its whole claim with `WARN: <slug>: chain stuck, but <why>: it holds its whole claim`; a
  chain leg.py cannot read, `WARN: <slug>: its chain is unreadable (<why>): it holds its whole claim`. Its unlanded
  rows' cells in any state (the whole claim on those same failures) are what a `--resume` compares against.
- Released (a parallel rollout, ADR 0060 d4, parallel_hold): nothing running, integrating or awaiting Integration, a
  task set aside, and either `paused_for: sign-off`, or not paused (`paused:` or `pause_requested`) and its Run
  record's (rr._record_read) last open stop (rr._stop_state's `open`) a `halt` whose reason starts `nothing can start`.
  An unreadable record is not released. A released rollout holds no Project root against serial chains; against a
  second parallel run of its own project on the repo it is still that project's one unfinished rollout (ADR 0060 d5, as
  ADR 0064 amends it).
- Checkout (ADR 0064): a Project root's git toplevel (its realpath when it is in no checkout). Two projects' parallel
  rollouts on one repo each run from their own clone: the default `<T>-rollout`, or `<T>-<slug>-rollout` (`clone`,
  below). A candidate SHARES this run's checkout when its checkout is --repo's toplevel, or --repo's in-place twin
  (`self-rollout-check.sh --in-place <repo>`, memoised): a legacy rollout rooted in place at T shares every clone's.
- Awaiting sign-off (ADR 0034): paused with `paused_for: sign-off` (reconcile-rollout.py await-sign-off: the
  run finished everything else and closed, and only gates wait on Lachy). It is a `paused:` like any other
  (eligible, released by `running`); its state reads `awaiting sign-off since <stamp>: [[a]], [[b]]`, the
  linked tasks set aside at `gate`, and its refusal names the sign-off path.
- Interrupted pair (P, N): both candidates, N's `supersedes:` names P, N never started, P paused or never
  started. N is the note an interrupted /thread:schedule wrote and died before closing P out (step 7.5), so
  N's tasks may be unstamped.
- Incomplete: reconcile-rollout.py's incomplete (a never-started note that must not run as written: it
  carries `incomplete: true`, which every rollout note is born with until schedule step 7's (or § Serial path
  S6's) last write removes it, and which § 0 stamps on an interrupted supersede's note; or its `supersedes:`
  names a rollout still unfinished beside it). It never changes stdout or the exit code; it names the note as
  incomplete on stderr (a WARN beside `supersede`, a line of the refusal otherwise).
- Misfiled superseded note: tagged `rollout`, directly in the tasks dir or directly in Archive/ (where the
  daily sweep files it; never Archive/Rollouts/), `status: done`, a `superseded_by:` naming a note that
  exists under the tasks dir, same repo (any project: filing is housekeeping, as reconcile-project.py's
  rule 3). Archive/Rollouts/<name> already there, or a `superseded_by:` naming no note: a WARN, never a
  `file` line, so § 0 cannot loop on it.

Shape (ADR 0040). A rollout note's `shape:` (reconcile-rollout.py's _shape): `serial`, or `parallel` for no key,
`parallel` or anything else; a raw value other than empty, `parallel` or `serial` (case-folded) WARNs `<slug>:
unknown shape <v>: read as parallel`. The parallel check's rules and outcomes read parallel notes only (a serial
note is skipped before the same-repo test, so it never WARNs `no Project root line`), and a supersede never crosses
shapes. Serial notes are the root-level ones neither `done` nor `dropped` (serial_notes), with the same never-started,
incomplete and complete reads; a complete one is dropped with the ceremony WARN below.

Surfaces. Comparison is on canonical tokens (serial-chains.py's grammar) and literal, save its nested-checkout rule
below: the `--surface` values and each serial note's `surfaces:` (or a stuck chain's Queue cells, ADR 0060) are
compared as written; --repo and each parallel candidate's Project root go through `os.path.realpath`, then the vault
mapping (at or under the vault root: `vault` or `vault:<rel>`), else become `repo:<realpath>`. The vault root is the
tasks dir's grandparent, used only when the tasks dir ends in `Work/Tasks`. Overlap is serial-chains.py's `overlaps`,
with its nested-checkout rule (p33-3), in every mode (`--resume` and the released WARNs included): two `repo:` tokens
that meet only by containment are disjoint when both sit in git checkouts and the inner one's toplevel is not the
outer one's (a separate checkout nested by path, read from each path's nearest existing directory with `git rev-parse
--show-toplevel`); an outer path in no checkout still covers everything beneath it. A serial note with no
`surfaces:`, or with a token parse_token refuses, reads as `any` (its whole hold, scope `whole`), with `WARN: <slug>:
<why>: read as any`; a `--resume` still compares against its unlanded rows' own cells, `any` only when one of those
cells is empty or malformed too.

Outcomes (parallel, the default), the first that applies:
  1. A misfiled superseded note -> `file <slug> <path relative to the tasks dir>` (the first by slug), exit 0.
  2. Complete candidates are dropped with `WARN: <slug>: every task merged but its completion ceremony never
     ran (status <s>): run its ## Post-rollout steps — not counted as unfinished`, except a candidate in an
     interrupted pair or named by another candidate's `supersedes:` (never dropped, no ceremony WARN). The
     rest is U.
  2c (after 2b, below). With a non-empty project set: every candidate that is not this project's, in no interrupted
     pair and in no `supersedes:` link (it names no candidate, and none names it), and that shares this run's checkout
     -> `refuse <their slugs, sorted>`, exit 3, one stderr line each: `[[x]] (<label>; <state>) runs from <root>, which
     this run would share (its clone, or that clone's in-place twin): two projects' rollouts on one repo each take
     their own clone (ADR 0064): re-run /thread:schedule <this run's project | --tasks …>, whose § 0 resolves this
     project's clone`. Any other such candidate is dropped from U with `WARN: [[x]] (<label>; <state>) is another
     project's unfinished rollout on this repo, in its own clone <root>: both run, and Integration takes one merge at
     a time per origin (ADR 0064)`. So rules 3-5 count one unfinished rollout per repo and project. An empty project
     set (--tasks sharing no project) skips 2c: every candidate counts, the old one-per-repo rule.
  2b. Unfinished serial notes whose hold (above: a stuck chain's unlanded rows only) overlaps --repo's token (a live
     chain owns the places it writes; one that overlaps only what a stuck chain released WARNs `WARN: [[s]] (<label>;
     <why>) released <token>, which this run claims: …` and is no hit) ->
     `refuse <their slugs, sorted>`, exit 3, one stderr line each: `[[s]] (<label>; <state>) is a serial chain that
     writes <token> and owns that place (ADR 0040): <remedy>`. The remedy names whose note it is: never started,
     run it (`/thread:execute [[slug]]` from its first row's launch) or stamp it `status: dropped`, which frees its
     tasks, an incomplete one with its incomplete line first; one that has run (a `## Leg log` counts), wait for it
     or /thread:status then /thread:repair. Then 2c (above). Else U empty -> `none`, exit 0.
  3. U is exactly one interrupted pair {P, N} and N is this project's: with --regenerate `interrupted P N`,
     exit 0; without, `refuse P,N` (sorted), exit 3, and stderr says N is incomplete.
  4. U is one note X: eligible with --regenerate -> `supersede X`, exit 0 (an incomplete X WARNs that this
     run finishes it). Otherwise `refuse X`, exit 3, with the remedy for its case (incomplete: the
     incomplete line; eligible: re-run with --regenerate, and for one awaiting sign-off (below) the
     waiting tasks carry still gate-pending, or sign off, then /thread:execute; this project's, has run,
     not paused: let it finish, pause it, or hard-pause it, then --regenerate, or /thread:status then
     /thread:repair; another project's: wait, or /thread:status then /thread:repair; another project's
     awaiting sign-off: it waits only on Lachy's sign-off of its waiting tasks: sign off each gate, then
     /thread:execute (it runs them and closes), or /thread:repair to defer them, then /thread:execute
     closes it).
  5. Two or more -> `refuse <a>,<b>,…` (sorted), exit 3; stderr lists each with its project and state, the
     incomplete line for each pair among them and for each other incomplete note (another project's note:
     finish it with /thread:schedule <its project> --regenerate), and /thread:repair for a candidate named
     by the `supersedes:` of a note that has run.

Serial mode (`--shape serial`, one call per chain, its tokens as repeatable `--surface`): no `file`, `supersede` or
`interrupted` outcome; with --regenerate, `WARN: a serial run supersedes nothing (ADR 0040, p24-2): --regenerate
ignored`. Hits are every unfinished serial note (any project) with a surface overlapping a --surface token, and
every parallel candidate (root-level, unfinished, not complete, any project) whose Project root's token overlaps
one (a missing Project root WARNs as above and is not counted). A serial note is a hit through its hold (above), and a
stuck one that overlaps only through what it released WARNs as 2b does; a released parallel rollout is no hit, with
`WARN: [[x]] (<label>; <why>) is released (ADR 0060): …`. Hits -> `refuse <sorted>`, exit 3, one stderr line each naming
the note, its project, its state, the overlapping pair and its remedy; none -> `none`, exit 0. It reads notes (and a
parallel candidate's Run record), and runs git only for the nested-checkout rule.

Resume mode (`--resume <slug>`, ADR 0060 d3; leg.py begin and status, and execute § 4.5's *Surface re-check*): what a
resuming rollout writes, as --surface tokens (serial: leg.py's write_set) or --repo's token (parallel), against what
the others hold for it: every other unfinished serial note's unlanded rows' surfaces, in any state (never its whole
claim, never its smoke rows), and for a serial resume every unfinished, not complete parallel rollout's Project root
unless parallel_hold reads it released, or idle (nothing running, integrating or awaiting Integration) and paused
(`paused:` or `pause_requested`) or with an open halt in its Run record: a call still in flight after a halt or in a
pause's drain writes the root, so a rollout with one holds it. The named note itself is skipped, and
--project/--tasks are optional (they only set `mine`). Hits -> `refuse <sorted>`, exit 3, one stderr line each:
`[[<s>]] (<label>; <state>) holds `<token>` for an unlanded row, which this chain|rollout writes as `<token>` (ADR
0060): [[<slug>]] waits its turn: …` (a parallel holder: `… holds `<token>`, its Project root, …`); leg.py reads the
first. A parallel resume (ADR 0064, clone_holders) also meets another project's parallel rollout in its own clone: one
that is unfinished, not complete and has run (not never started), in no `supersedes:` link with this note, whose
Project root's checkout is --repo's, and that wins the tie (this rollout has not run, or the other's Run record began
earlier, its first line's ts; ties and unreadable records break by slug order): ``[[x]] (<label>; <state>) holds
`repo:<clone>`, its Project root, which this rollout writes as `repo:<clone>` (ADR 0064): [[me]] waits its turn: two
projects' rollouts never share a clone: /thread:schedule <me's project> --regenerate moves it to its own clone``; with
no --project or --tasks (execute's call), `mine` is the resuming note's own `projects:`. None -> `none`, exit 0. No `file`, `supersede` or `interrupted` outcome, and --regenerate WARNs and is ignored.
Whoever released a place yields it, so a chain scheduled on a stuck chain's released place never waits on that chain.
Like the serial check, it runs git only for the nested-checkout rule.

    hold --rollout <slug> [--tasks-dir <dir>]

`hold` (read-only, for /thread:status § 4 and § 5): one JSON line, keys in this order: {"rollout", "shape", "scope",
"why", "held", "released"}, tokens in canonical text. Serial: scope `whole` or `stuck`, the hold above. Parallel: scope
`released` (held [], released [its root's token]) or `whole` (held [its root's token]), why parallel_hold's. A done or
dropped note, a complete one, or a parallel one with no Project root: scope `none`, held []. WARN lines go to stderr.
Exit 2 (no stdout, one `unfinished-rollout:` line): no note at `<tasks dir>/<slug>.md`, or a script unloadable.

    clone --repo <Local:> --project <name|slug> [--tasks-dir <dir>]

`clone` (ADR 0064; schedule § 0 step 3, estate-scan.py per declaring project): which rollout clone this project's
parallel rollout on --repo's repo runs from, read-only. stdout is one line: `default` or `project <slug>` (exit 0), or
`refuse <slugs, sorted>` (exit 3, one stderr line per taker). Exit 2 (no stdout, one `unfinished-rollout:` line): --repo
missing or not in git, the tasks dir missing, or the P probe unable to run (its exit 2 or 5, with its stderr line).
Terms: T is the realpath of --repo's git toplevel; when `self-rollout-check.sh --in-place T` exits 0 (Local: is itself a
clone) it prints `default` with a WARN, and stops. The slug is project_slug(--project) (estate-dispatch.py's rule,
restated: NFKD to ASCII, lower-cased, apostrophes deleted, other runs `-`, trimmed). P is defined when the slug is
non-empty, not `rollout` and not ending in `-rollout` (else `WARN: project slug <s> takes no clone of its own …`). D is
`<T>-rollout`, P `<T>-<slug>-rollout`. Candidates: check's unfinished parallel candidates on the same repo, complete ones
dropped, whose Project root exists; a candidate's checkout is its root's toplevel; it is mine when project_slug of any of
its `projects:` equals the slug. Another project's candidate blocks clone X when its checkout is X, or is T (a legacy
in-place rollout blocks every clone). Rules, in order:
  1. Reuse by recorded root: this project's candidates rooted in rollout clones of T (siblings `<base(T)>-rollout` or
     `<base(T)>-<x>-rollout` whose `--in-place` twin is T). One clone K, no other project's candidate blocking it:
     `default` for D, else `project <x>` (x parsed from K's name). Two or more: refuse, naming each. K blocked: a WARN,
     then rule 2.
  2. D not blocked: `default`.
  3. P defined, not blocked, and not colliding: `project <slug>`. P collides when one read-only probe, `bash
     self-rollout-check.sh --resolve <--repo> <slug>` (run only here), exits 3; 0 and 4 mean usable or absent (P need
     not exist).
  4. Otherwise `refuse <taker slugs, sorted>`: one stderr line per taker, `[[x]] (<label>; <state>) runs from <clone>:
     …`, then a colliding P's probe line verbatim, then the remedy (wait for one to finish, or /thread:status then
     /thread:repair).

    branches --repo <path> --tasks <slug,...> [--tasks-dir <dir>]

`branches` (ADR 0064; schedule step 5's Branch check), read-only: each named task's engine branch, `audit-fix/<shortAlias
(slug)>` (short_alias: a leading `<project>-` dropped; lead-integrate.py's branch_of), against the unlanded tasks (queued,
running, awaiting Integration, integrating or set aside) of every unfinished parallel rollout on the same repo, a task
of a named slug excepted (the same task, carried), and against the earlier named tasks. One line per collision, `collide
<slug> <branch> [[<rollout>]] [[<task>]]` (`-` in the rollout's place for an earlier named task), else `none`; exit 0, or
2 on a usage error (no line).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py running [--tasks-dir <dir>]

`running` answers primary-hold.sh (ADR 0031 says why): a live rollout note tagged `rollout` at the protocol
the schedule template writes, neither `done` nor `dropped`, not `paused:`, started (reconcile-rollout.py's
approved_unrun is false: never_started, widened for an approved queue whose only marks are the Stage's ended room stops)
and with no `engine_snapshot:` stamp is RUNNING. A stamped note runs on its own Engine
snapshot, never on the Primary checkout, so it holds nothing (ADR 0043; skills/_shared/engine-snapshot.md); only a
rollout scheduled before P29 (or on a version-cache install) still does. stdout: `running <slug>` per rollout,
sorted, or `none` (a missing tasks dir included); exit 0.

Output (check). stdout is exactly one line on exit 0 and 3: `none` | `supersede <slug>` | `interrupted <prior-slug>
<new-slug>` | `file <slug> <relpath>` | `refuse <slug>[,<slug>…]`. Slugs are filename stems; an unfinished
note is root-only, so `<tasks dir>/<slug>.md` is exact. `WARN:` lines go only to stderr and never change
stdout or the exit code. Exit 2 prints no stdout and one `unfinished-rollout:` stderr line: a missing or
non-directory --repo, --repo with serial or --surface with parallel, no --surface with serial, a --surface token
parse_token refuses, neither or both of --project/--tasks (both, with --resume), a --tasks note not found, a --resume
naming no note directly in the tasks dir, a missing tasks dir, or reconcile-rollout.py, serial-chains.py or (once an
unfinished serial note is read) leg.py unloadable.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py pickups --repo <path> --tasks <slug,...>
        [--misfit <slug>=<why>]... [--tasks-dir <dir>]

`pickups` is schedule § 1.2's Pickup sweep (ADR 0057 d1), run only on a standalone parallel `--tasks` run: which other
open tasks on the same repo may join the named candidates. It reads notes and runs one `git remote get-url origin` for
--repo and one per distinct `## Launch` repo path (memoised), read-only; it writes nothing. The agent judges fit only
on the slugs in `join[]`, re-runs with `--misfit <slug>=<why>` for the misfits, and judges only the newly joined slugs,
until no slug joins unjudged. Rules, in order:
- Pool: each note directly in the tasks dir (never Archive/**), parsed as reconcile-rollout.py's Note, tagged `task`
  and neither `rollout` nor `decisions`, at `status: open`, not one of --tasks, whose `rollout:` links no live rollout
  (reconcile-rollout.py's _live_rollout, schedule step 1's skip rule), and whose normalised `projects:` meet the run's
  project set: the intersection of the --tasks notes' projects, as `check` builds it (each found root-first, then under
  Archive/). An empty set WARNs `the named tasks share no project: the pickup pool is empty`, and the pool is empty.
- Order: `priority:` weight descending (reconcile-rollout.py's PRIORITY_WEIGHTS; missing or unknown reads normal,
  `none` weighs 0), then `phase:` read as a finite float ascending (missing, empty or unparseable, `p30` or `30a`,
  sorts last; never _phase_sort, which raises on those), then the case-folded slug. `order` prints it, counted tasks
  left out.
- Repo rule: the first list line under `## Launch` holding `**Repo:**`; its value is the first backtick span after
  the label, else the first whitespace token, `~` expanded and a trailing `/` dropped. No such line, or an empty
  value: counted as `no ## Launch repo`, never read further. A path that is no directory here: left, `## Launch repo
  <p> is missing here: its origin is unread` (<p> as written). The same repo: its realpath is --repo's, or both
  origins read and are equal once normalised (serial-chains.py's norm_origin). Otherwise counted as `another repo`.
  With no origin for --repo, `WARN: --repo <p> is not a git repo with an origin here: only paths are compared`, and
  no task origin is read. `counted` is two integers and names nothing: a counted task appears in no other list, and
  is outside every rule below (a dependency on one is a dependency outside the pool).
- Gate rule: gated_inputs.py's `sweep(body_of(text))`; the first kind hit, spend then credential then irreversible,
  leaves the task, `gated: <kind> "<word>"` (<word> the first of that kind's list among its hits, so "usage credits"
  reads `credits`). No hit is ever dismissed here.
- Misfits: each --misfit leaves its task with its why. One naming no pool task, or not `slug=why`, is exit 2.
- Dependencies: reconcile-rollout.py's _dep_entries, each followed through _fold_unit to its unit. A dependency is
  satisfied when _dep_status reads it landed, or when its unit is a candidate or joins. A pool task on a dependency
  cycle (through unlanded dependencies whose units are pool tasks) is left, `a dependency cycle with [[x]]`.
  - Needed: the pool tasks reachable from the candidates through unlanded dependencies whose unit is a pool task,
    transitively, never through a task that is left. They are uncapped and join, `needed by [[t]]`, unless left. A
    needed task with an unlanded dependency whose unit is outside the candidates and the pool, or is a left pool task,
    is left, `depends on [[x]] (<why>)`, to a fixpoint (a needed task left stops needing what only it needed).
  - Extras: every other pool task, in order. Each takes its closure D(t): t plus its unlanded pool dependencies not
    yet joined, transitively. A member that is left, or a dependency outside the candidates, the pool and the landed
    set, leaves t, `depends on [[x]] (<why>)`. Otherwise, when the extras joined so far plus |D(t)| is at most the
    cap (5), all of D(t) joins: t `open on [[<project>]] on this repo, priority <p>`, each pulled-in dependency
    `needed by [[t]]`, every one counted against the cap; else t goes to `beyond`.
  - Warnings: a candidate or a joined needed task whose dependency's unit is a pool task left alone.
stdout is one JSON line, keys in this order: {"projects": [<normalised>], "order": [<slug>], "join": [{"slug", "kind":
"needed"|"extra", "why"}], "needed": [<slug>], "left": [{"slug", "why"}], "counted": {"another repo": n, "no ## Launch
repo": n}, "beyond": [<slug>], "warnings": [{"task", "dep", "why"}], "cap": 5}; `needed` is the joined needed slugs,
`left` is in order. `WARN:` lines go to stderr. Exit 2 prints no stdout and one `unfinished-rollout:` line: a missing
--repo or tasks dir, a --tasks note not found, a bad --misfit, or reconcile-rollout.py, serial-chains.py or
gated_inputs.py unloadable (loaded here only, never by `check` or `running`).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py unstarted --rollout <slug>
        [--handoffs <dir>]... [--tasks-dir <dir>]

`unstarted` answers close step 2's **Rollouts this session wrote.** for a note with no unwithdrawn handover (ADR 0057
d5): whether the rollout still needs its lead started. Close step 2's **Stale launch.** also runs it, with no
--handoffs, on each pending launch doc's `launches:` value: `closed`, or `started` with the doc 24 h old under the
peer guard, makes that doc stale (ADR 0057 d4). It reads the note (root-first, then under Archive/), its linked
tasks, the Run record (run_record.py's record_path for the slug; an unreadable record reads as none) and the `*.md`
directly in each --handoffs dir; it writes nothing and runs no git. It prints one line, the first that applies:
  closed <slug> (<status>|archived)     the root note is `done` or `dropped`, or the note sits only under Archive/
  serial <slug>                         `shape: serial` (Leg 1 starts by hand; no handoff is made for it)
  started <slug> (<why>)                reconcile-rollout.py's approved_unrun is false
  started <slug> (a lead entered <ts>)  the Run record holds a `kind: lead-entry` line (a lead waiting on `hold_until`
                                        stamps no `owner:`); <ts> is the first one's
  stamped <slug> (start: unattended|started_unattended: <v>)   the Chorus Stage starts it (Start when ready)
  incomplete <slug> (<why>)             reconcile-rollout.py's incomplete
  launched <slug> <path> (<status>)     a handoff doc whose front-matter `launches:` names the slug (a wikilink
                                        stripped, case-folded), the first by sorted path; <status> its `status:`
  unstarted <slug> <Project root>       none of the above: no lead has started it
Exit 0, or 2 (no stdout, one `unfinished-rollout:` line) when no note is found, on a usage error, or when
reconcile-rollout.py or run_record.py will not load.
"""
import argparse
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from types import SimpleNamespace

DEFAULT_TASKS_DIR = Path(os.path.expanduser("~/repos/obsidian/Work/Tasks"))
RR_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/reconcile-rollout.py"
SC_SRC = Path(__file__).resolve().parent / "serial-chains.py"
GI_SRC = Path(__file__).resolve().parent / "gated_inputs.py"
RUN_RECORD_SRC = Path(__file__).resolve().parent / "run_record.py"
LEG_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/leg.py"
TEMPLATE = Path(__file__).resolve().parent.parent.parent / "schedule/rollout-template.md"
SELF_ROLLOUT_SH = Path(__file__).resolve().parent.parent.parent / "execute/scripts/self-rollout-check.sh"
RR_NAMES = ("Note", "_scan", "_queue_state", "_counts", "_project_root", "_wikilink_slug", "_scalar", "_status",
            "_valued", "never_started", "approved_unrun", "incomplete", "_shape", "SHAPES", "_priority",
            "PRIORITY_WEIGHTS", "_dep_entries", "_fold_unit", "_dep_status", "_live_rollout", "_start_unattended",
            "_record_read", "_stop_state", "_truthy_flag", "_parse_ts")
SC_NAMES = ("parse_token", "fmt_token", "overlaps", "overlap_pairs", "read_surfaces", "norm_origin", "Git")
GI_NAMES = ("sweep", "body_of", "SPEND", "CREDENTIAL", "IRREVERSIBLE")
RUN_RECORD_NAMES = ("record_path",)
LEG_NAMES = ("Chain", "chain_read", "hold_of", "Refuse")
CLOSED = {"done", "dropped"}
PICKUP_CAP = 5
UNLANDED = ("queued", "running", "awaiting-integration", "integrating", "set-aside")  # `branches`: not yet merged
SC = None   # serial-chains.py, loaded by cmd_check and cmd_pickups (load_sc)
LEG = None  # leg.py, loaded once the first unfinished serial note is read (load_leg)


def die(msg):
    print(f"unfinished-rollout: {msg}", file=sys.stderr)
    sys.exit(2)


class Parser(argparse.ArgumentParser):
    """argparse's errors as the script's one-line exit 2 (subparsers inherit the class)."""

    def error(self, message):
        die(message)


def load_module(name, src, names, label):
    """A sibling script as a module (side-effect-free on import), as reconcile-project.py loads one."""
    sys.dont_write_bytecode = True
    try:
        spec = importlib.util.spec_from_file_location(name, src)
        if spec is None or spec.loader is None:
            raise ImportError("no loader for this path")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for n in names:
            getattr(mod, n)
        return mod
    except Exception as e:  # noqa: BLE001 — any failure to load is the same exit-2 condition
        die(f"cannot load {src} ({label}): {e}")


def load_rr():
    return load_module("reconcile_rollout", RR_SRC, RR_NAMES, "skills/execute/scripts/reconcile-rollout.py")


def load_sc():
    """serial-chains.py: the surface grammar and norm_origin (its one copy). `running` never loads it."""
    global SC
    if SC is None:
        SC = load_module("serial_chains", SC_SRC, SC_NAMES, "skills/_shared/scripts/serial-chains.py")
    return SC


def load_leg(rr):
    """leg.py as a module (ADR 0060: a chain's hold is leg.py's hold_of, its one copy), sharing this script's
    reconcile-rollout.py and serial-chains.py. Loaded only once an unfinished serial note is read."""
    global LEG
    if LEG is None:
        LEG = load_module("thread_leg", LEG_SRC, LEG_NAMES, "skills/execute/scripts/leg.py")
        LEG.rr, LEG.sc = rr, load_sc()
    return LEG


# ---- git ---------------------------------------------------------------------------------------

def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as landing-register.py scrubs them."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               timeout=30).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def norm_origin(url: str) -> str:
    """serial-chains.py's norm_origin, the one copy (cmd_check loads it before the first origin_of call)."""
    return load_sc().norm_origin(url)


def origin_of(path: Path, env):
    """The normalised origin URL of the git repo at path, or None (not a directory, not a repo, no origin)."""
    if not path.is_dir():
        return None
    try:
        r = subprocess.run(["git", "-C", str(path), "remote", "get-url", "origin"], env=env,
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    url = r.stdout.strip()
    return norm_origin(url) if r.returncode == 0 and url else None


def same_repo_rule(rr, repo: Path, env, warns):
    """(same_repo, repo_origin): the same-repo rule (Rules, above) as a function of (slug, note, warn=True): the
    realpaths of the note's expanded Project root and of `repo` are equal, or both origins are readable and equal once
    normalised, each root's origin read once. WARNs a note with no Project root line, or a root with no origin here."""
    repo_real = os.path.realpath(repo)
    repo_origin = origin_of(repo, env)
    origins = {}

    def same_repo(slug, note, warn=True):
        root = rr._project_root(note)
        if root is None:
            if warn:
                warns.append(f"WARN: {slug}: no Project root line: not counted")
            return False
        if os.path.realpath(root) == repo_real:
            return True
        if str(root) not in origins:
            origins[str(root)] = origin_of(root, env)
        o = origins[str(root)]
        if o is None:
            if warn:
                warns.append(f"WARN: {slug}: Project root {root} is not a git repo with an origin here: "
                             "matched on its path only")
            return False
        return repo_origin is not None and o == repo_origin

    return same_repo, repo_origin


class SelfRollout:
    """skills/execute/scripts/self-rollout-check.sh as a read-only child, memoised (ADR 0064): `--in-place <path>`, the
    twin's realpath or None, and `--resolve <Local:> <slug>`, (exit, stdout, stderr). Run with the repo-local git env
    scrubbed (git_env), stdin from /dev/null."""

    def __init__(self, env):
        self.env, self._twin, self._res = env, {}, {}

    def _run(self, *argv):
        try:
            r = subprocess.run(["bash", str(SELF_ROLLOUT_SH), *argv], env=self.env, capture_output=True, text=True,
                               timeout=120, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError) as e:
            return 2, "", f"cannot run {SELF_ROLLOUT_SH}: {e}"
        return r.returncode, r.stdout.strip(), r.stderr

    def twin(self, path):
        """The in-place twin of the rollout clone `path` is in (`--in-place`; a toplevel gives the twin's toplevel), or
        None when it is no rollout clone."""
        key = str(path)
        if key not in self._twin:
            rc, out, _err = self._run("--in-place", key)
            self._twin[key] = os.path.realpath(out) if rc == 0 and out else None
        return self._twin[key]

    def resolve(self, local, slug):
        key = (str(local), slug)
        if key not in self._res:
            self._res[key] = self._run("--resolve", str(local), slug)
        return self._res[key]


# ---- projects ------------------------------------------------------------------------------------

def norm_project(rr, value) -> str:
    name = rr._wikilink_slug(rr._scalar(value)) or ""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def projects_of(rr, note):
    return {p for p in (norm_project(rr, v) for v in note.get_list("projects")) if p}


def project_label(rr, note) -> str:
    names = [rr._wikilink_slug(rr._scalar(v)) for v in note.get_list("projects")]
    return ", ".join(n for n in names if n) or "no project"


def project_slug(name) -> str:
    """estate-dispatch.py's project_slug restated (schedule step 6's note slug, and the clone slug of ADR 0064): NFKD-folded
    to ASCII, lower-cased, apostrophes (' and ’) deleted, every other run outside [a-z0-9] a `-`, the ends trimmed
    ("Lachy's Tools" -> lachys-tools). Idempotent on a slug; tests/unfinished-rollout.test.sh P8e binds the copy."""
    s = str(name or "").replace("'", "").replace("\u2019", "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def clone_slug_ok(slug) -> bool:
    """Whether a project slug can name a clone of its own (P is defined, ADR 0064): non-empty, not `rollout`, and not
    ending in `-rollout`, whose clone `<T>-<slug>-rollout` would read as another clone's."""
    return bool(slug) and slug != "rollout" and not slug.endswith("-rollout")


def short_alias(slug) -> str:
    """The engine's shortAlias (task.workflow.js; lead-integrate.py short_alias): a leading `<project>-` segment
    dropped. A task's branch is `audit-fix/<shortAlias(slug)>`; tests/unfinished-rollout.test.sh P11 binds the copy."""
    i = slug.find("-")
    return slug if i == -1 else slug[i + 1:]


def find_task(tasks_dir: Path, slug: str):
    """A task note by name: the root copy, else the first under Archive/ (as reconcile-rollout's index)."""
    root = tasks_dir / f"{slug}.md"
    if root.is_file():
        return root
    archive = tasks_dir / "Archive"
    if archive.is_dir():
        found = sorted(archive.rglob(f"{slug}.md"))
        if found:
            return found[0]
    return None


# ---- the check -----------------------------------------------------------------------------------

def link_slug(rr, note, key) -> str:
    return (rr._wikilink_slug(rr._scalar(note.get(key))) or "").lower()


def tags_of(rr, note):
    return {rr._scalar(t).lower() for t in note.get_list("tags")}


def rollout_notes(rr, tasks_dir: Path, archive: bool):
    """(path, note, "root" | "archive") for each note tagged `rollout` directly in the tasks dir and, with
    archive, directly in Archive/. A missing folder or an unreadable note yields nothing."""
    folders = (("root", tasks_dir), ("archive", tasks_dir / "Archive")) if archive else (("root", tasks_dir),)
    for where, folder in folders:
        for path in sorted(folder.glob("*.md")):
            try:
                note = rr.Note(path)
            except (ValueError, OSError):
                continue
            if "rollout" in tags_of(rr, note):
                yield path, note, where


def vault_root(tasks_dir: Path):
    """The vault root's realpath (the tasks dir's grandparent) when the tasks dir ends in Work/Tasks, else None."""
    real = Path(os.path.realpath(tasks_dir))
    return str(real.parent.parent) if real.parts[-2:] == ("Work", "Tasks") else None


def path_token(path, vault):
    """A path as a canonical token, literally: its realpath, then the vault mapping, else ('repo', realpath). No git."""
    real = os.path.realpath(os.path.expanduser(str(path)))
    if vault is not None:
        rf, vf = real.casefold(), vault.casefold()
        if rf == vf:
            return ("vault", "")
        if rf.startswith(vf + "/"):
            return ("vault", real[len(vault) + 1:])
    return ("repo", real)


def shape_of(rr, slug, note, warns, warned):
    """reconcile-rollout.py's _shape, with a WARN (once per note) for a value it does not know."""
    raw = rr._scalar(note.get("shape")).lower()
    if raw not in ("",) + tuple(rr.SHAPES) and slug not in warned:
        warned.add(slug)
        warns.append(f"WARN: {slug}: unknown shape {raw}: read as parallel")
    return rr._shape(note)


def note_state(rr, path, note, tasks_dir, mine):
    """The read a candidate gets: this project's, its label, never started, paused, complete, incomplete."""
    linked, index = rr._scan(path, tasks_dir)
    fresh, why = rr.approved_unrun(note, linked)
    counts = rr._counts([dict(zip(("state", "setAsideAt"), rr._queue_state(t))) for _, t in linked])
    paused = rr._scalar(note.get("paused")) if rr._valued(note.get("paused")) else ""
    sign_off = bool(paused) and rr._scalar(note.get("paused_for")).lower() == "sign-off"
    waiting = sorted(p.stem for p, t in linked if rr._queue_state(t) == ("set-aside", "gate")) if sign_off else []
    return {
        "slug": path.stem, "mine": bool(projects_of(rr, note) & mine), "label": project_label(rr, note),
        "paused": paused, "fresh": fresh, "why": why, "status": rr._status(note) or "no status",
        "signOff": sign_off, "waiting": waiting,
        "complete": counts["total"] >= 1 and counts["merged"] == counts["total"],
        "supersedes": link_slug(rr, note, "supersedes"), "incomplete": rr.incomplete(path, note, linked, index),
    }


def state_line(c) -> str:
    return (f"awaiting sign-off since {c['paused']}: {links(c['waiting'])}" if c["signOff"]
            else f"paused {c['paused']}" if c["paused"] else "never started" if c["fresh"]
            else f"has run: {c['why']}")


def ceremony_warn(c) -> str:
    return (f"WARN: {c['slug']}: every task merged but its completion ceremony never ran (status "
            f"{c['status']}): run its ## Post-rollout steps — not counted as unfinished")


def chain_hold(rr, path, tasks_dir):
    """leg.py's hold_of for one serial note, in-process (ADR 0060): (hold, None), or (None, <why>) when leg.py cannot
    read the chain."""
    leg = load_leg(rr)
    ctx = SimpleNamespace(rollout=path, tasks=tasks_dir, vault=tasks_dir.parent.parent, slug=path.stem, archived=False)
    try:
        chain = leg.Chain(ctx)
        return leg.hold_of(chain, leg.chain_read(ctx, chain)), None
    except leg.Refuse as e:
        return None, e.msg
    except Exception as e:  # noqa: BLE001 — any unreadable chain fails closed to its whole claim
        return None, f"{type(e).__name__}: {e}"


def serial_notes(rr, notes, tasks_dir, warns, mine, warned, skip=None):
    """The unfinished serial notes: root-level, `shape: serial`, neither done nor dropped, not complete (a complete
    one is dropped with the ceremony WARN), each with its state, its whole claim (`claim`), what it holds (`tokens`:
    the whole claim, or a stuck chain's unlanded rows' surfaces, ADR 0060), what a stuck one released (`released`),
    its unlanded rows' surfaces in any state (`unlanded`) and the hold's `scope`. `skip` names a note left out (a
    resuming chain's own)."""
    out = []
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) != "serial":
            continue
        if skip is not None and path.stem.lower() == skip.lower():
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        if c["complete"]:
            warns.append(ceremony_warn(c))
            continue
        c["state"] = state_line(c)
        raw, tokens, bad = SC.read_surfaces(note), [], None
        if not raw:
            bad = "no surfaces"
        for r in raw:
            try:
                tokens.append(SC.parse_token(r))
            except ValueError as e:
                bad = f"surfaces: {r} is not a surface token ({e})"
                break
        if bad:
            warns.append(f"WARN: {c['slug']}: {bad}: read as any")
            tokens = [("any", "")]
        c.update(claim=tokens, tokens=tokens, unlanded=tokens, released=[], scope="whole",
                 why=f"{bad}: read as any, it holds everything" if bad else "")
        # The hold is read even when `surfaces:` reads as any: a schedule still meets `any` (tokens, scope whole), but a
        # --resume compares against the unlanded rows' own cells (hold_of reads them apart from the claim, and falls
        # back to the whole claim, `any` here, only on a bad cell), so one hand-edited note never halts every rollout.
        hold, why = chain_hold(rr, path, tasks_dir)
        if hold is None:
            unreadable = f"its chain is unreadable ({why}): it holds its whole claim"
            c["why"] = c["why"] or unreadable
            warns.append(f"WARN: {c['slug']}: {unreadable}")
        else:
            if hold["warn"]:
                warns.append(f"WARN: {c['slug']}: {hold['warn']}")
            parse = lambda xs: [SC.parse_token(x) for x in xs]  # noqa: E731
            c["unlanded"] = parse(hold["unlanded"])
            if not bad:
                c.update(scope=hold["scope"], why=hold["why"])
                if hold["scope"] == "stuck":
                    c.update(tokens=parse(hold["held"]), released=parse(hold["released"]))
        out.append(c)
    return out


def released_warn(s, claimed) -> str:
    """A stuck chain released what this run claims (ADR 0060)."""
    return (f"WARN: [[{s['slug']}]] ({s['label']}; {s['why']}) released {SC.fmt_token(claimed)}, which this run "
            "claims: it reclaims it on resume and then waits its turn while this run holds it")


def parallel_hold(rr, path, note, linked):
    """ADR 0060 d4: whether an unfinished parallel rollout holds its Project root against serial chains. {released,
    why, paused, halt, unreadable, busy}: released when nothing is running, integrating or awaiting Integration, a task
    is set aside, and it awaits sign-off (`paused_for: sign-off`), or it is not paused and its Run record's last open
    stop is a halt whose reason starts `nothing can start` (execute § 7's stuck halt). An unreadable record is not
    released. `busy` counts its tasks running, integrating or awaiting Integration: a call in flight still writes the
    root after a halt or during a pause's drain (check_resume reads it)."""
    states = [rr._queue_state(t)[0] for _, t in linked]
    stamped = rr._valued(note.get("paused"))
    paused = stamped or rr._truthy_flag(note.get("pause_requested"))
    sign_off = stamped and rr._scalar(note.get("paused_for")).lower() == "sign-off"
    lines = rr._record_read(path.stem)
    halt = None
    if lines is not None:
        stops = rr._stop_state(lines)["open"]
        if stops and stops[-1].get("cause") == "halt":
            halt = str(stops[-1].get("reason") or "")
    busy = sum(st in ("running", "integrating", "awaiting-integration") for st in states)
    out = {"released": False, "why": "", "paused": paused, "halt": halt, "unreadable": lines is None, "busy": busy}
    if busy:
        out["why"] = f"{busy} task(s) running or in Integration"
    elif "set-aside" not in states:
        out["why"] = "no task set aside"
    elif sign_off:
        out.update(released=True, why="awaiting sign-off")
    elif paused:
        out["why"] = "paused"
    elif lines is None:
        out["why"] = "its Run record is unreadable"
    elif halt is not None and halt.startswith("nothing can start"):
        out.update(released=True, why=f"halted: {halt}")
    else:
        out["why"] = "not halted on its set-asides"
    return out


def serial_remedy(s) -> str:
    """R3's remedy for a live serial note, naming whose note it is."""
    if s["fresh"]:
        drop = (f"run it (`/thread:execute [[{s['slug']}]]` from its first row's launch) or stamp [[{s['slug']}]] "
                "`status: dropped` to free its tasks (step 1 then takes them again), then re-run; declare `surfaces:` on "
                "its tasks before re-scheduling them if the claim was too broad")
        return f"{s['slug']} is incomplete: {s['incomplete']}; {drop}" if s["incomplete"] else drop
    return "wait for it to finish, or /thread:status then /thread:repair"


def named_tasks(rr, tasks_csv, tasks_dir):
    """[(slug, Note)] for each --tasks slug, found root-first, then under Archive/; a missing one is exit 2."""
    slugs = [s.strip() for s in tasks_csv.split(",") if s.strip()]
    if not slugs:
        die("--tasks names no task")
    out = []
    for s in slugs:
        name = rr._wikilink_slug(s) or s
        path = find_task(tasks_dir, name)
        if path is None:
            die(f"--tasks {name}: no note at {tasks_dir / (name + '.md')} or under Archive/")
        try:
            out.append((name, rr.Note(path)))
        except ValueError as e:
            die(f"--tasks {name}: {e}")
    return out


def rerun_of(rr, args) -> str:
    """This run's own /thread:schedule arguments, for a remedy that re-runs it: the --project name, else --tasks."""
    if args.project is not None:
        return rr._wikilink_slug(args.project) or args.project.strip()
    return f"--tasks {args.tasks}"


def run_projects(rr, args, tasks_dir, warns):
    """The run's project set: {norm(--project)}, or the intersection of the --tasks notes' projects."""
    if args.project is not None:
        return {norm_project(rr, args.project)} - {""}
    mine = set.intersection(*(projects_of(rr, note) for _, note in named_tasks(rr, args.tasks, tasks_dir)))
    if not mine:
        warns.append("WARN: the named tasks share no project: no unfinished rollout counts as this project's")
    return mine


def cmd_check(args, rr) -> int:
    serial = args.shape == "serial"
    if serial:
        if args.repo is not None:
            die("--repo is the parallel check's; a serial check takes --surface")
        if not args.surface:
            die("--shape serial needs --surface <token>, one per token of the chain")
    else:
        if args.surface:
            die("--surface is the serial check's; a parallel check takes --repo")
        if args.repo is None:
            die("--repo <path> is required (the parallel check)")
        repo = Path(os.path.expanduser(args.repo))
        if not repo.is_dir():
            die(f"--repo {args.repo}: not a directory")
    if args.resume is not None:
        if args.project is not None and args.tasks is not None:
            die("pass at most one of --project and --tasks")
    elif (args.project is None) == (args.tasks is None):
        die("pass exactly one of --project and --tasks")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    load_sc()
    surfaces = []
    for v in args.surface or []:
        try:
            surfaces.append(SC.parse_token(v))
        except ValueError as e:
            die(f"--surface {v}: {e}")

    warns, warned = [], set()
    vault = vault_root(tasks_dir)
    if args.resume is not None:
        return check_resume(args, rr, tasks_dir, surfaces if serial else [path_token(repo, vault)], vault, warns,
                            warned)
    if serial:
        return check_serial(args, rr, tasks_dir, surfaces, vault, warns, warned)
    env = git_env()
    repo_real = os.path.realpath(repo)
    same_repo, repo_origin = same_repo_rule(rr, repo, env, warns)
    if repo_origin is None:
        warns.append(f"WARN: --repo {args.repo} is not a git repo with an origin here: matched on its path only")

    mine = run_projects(rr, args, tasks_dir, warns)

    # Rollout notes directly in the tasks dir and directly in Archive/ (never Archive/Rollouts/ or deeper).
    notes = list(rollout_notes(rr, tasks_dir, archive=True))

    # 1. A superseded note that was stamped but never moved into Archive/Rollouts/ (a parallel one: a supersede
    # never crosses shapes).
    stems = None
    misfiled = []
    for path, note, where in notes:
        target = link_slug(rr, note, "superseded_by")
        if rr._status(note) != "done" or not target or rr._shape(note) == "serial" or \
                not same_repo(path.stem, note, warn=False):
            continue
        rel = path.name if where == "root" else f"Archive/{path.name}"
        if stems is None:
            stems = {p.stem.lower() for p in tasks_dir.rglob("*.md")}
        if target not in stems:
            warns.append(f"WARN: {path.stem}: superseded but filed at {rel}, and its superseded_by names no note "
                         f"([[{target}]]): resolve it by hand")
            continue
        if (tasks_dir / "Archive" / "Rollouts" / path.name).exists():
            warns.append(f"WARN: {path.stem}: superseded but filed at {rel}, and Archive/Rollouts/{path.name} "
                         "already exists: resolve the collision by hand")
            continue
        misfiled.append((path.stem.lower(), 0 if where == "root" else 1, path.stem, rel))
    if misfiled:
        _, _, slug, rel = min(misfiled)
        return finish(warns, f"file {slug} {rel}", 0)

    # The unfinished candidates on this repo (parallel notes: a serial one is skipped before the same-repo test).
    cands, roots = {}, {}
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial" \
                or not same_repo(path.stem, note):
            continue
        cands[path.stem.lower()] = note_state(rr, path, note, tasks_dir, mine)
        roots[path.stem.lower()] = rr._project_root(note)
    for c in cands.values():
        c["eligible"] = c["mine"] and (bool(c["paused"]) or c["fresh"])
        c["state"] = state_line(c)

    pairs = []  # (P key, N key)
    for nk, n in cands.items():
        pk = n["supersedes"]
        if pk and pk != nk and pk in cands and n["fresh"] and (cands[pk]["paused"] or cands[pk]["fresh"]):
            pairs.append((pk, nk))
    paired = {k for pair in pairs for k in pair}
    named = {c["supersedes"] for k, c in cands.items() if c["supersedes"] and c["supersedes"] != k}

    # 2. A complete rollout whose ceremony never ran is not unfinished (unless a supersede names it).
    for k in sorted(cands):
        c = cands[k]
        if c["complete"] and k not in paired and k not in named:
            warns.append(ceremony_warn(c))
            del cands[k]
    pairs = [(p, n) for p, n in pairs if p in cands and n in cands]

    # 2b. A live serial chain owns the places it writes (ADR 0040): a parallel run on one is refused, before any
    # supersede (a supersede never crosses shapes).
    repo_tok = path_token(repo, vault)
    top = SC.Git().checkout
    owners = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned):
        hit = next((tok for tok in s["tokens"] if SC.overlaps(repo_tok, tok, top)), None)
        if hit is not None:
            owners[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) is a serial chain that writes "
                                 f"{SC.fmt_token(hit)} and owns that place (ADR 0040): {serial_remedy(s)}")
            continue
        freed = next((tok for tok in s["released"] if SC.overlaps(repo_tok, tok, top)), None)
        if freed is not None:
            warns.append(released_warn(s, freed))
    if owners:
        keys = sorted(owners, key=str.lower)
        return finish(warns, "refuse " + ",".join(keys), 3, [owners[k] for k in keys])

    # 2c. Two projects' parallel rollouts on one repo each run from their own clone (ADR 0064): another project's
    # unfinished rollout, in no interrupted pair and no `supersedes:` link, that shares this run's checkout (its Project
    # root's checkout is --repo's, or --repo's in-place twin) is refused; any other is dropped with a WARN, so rules 3-5
    # count one unfinished rollout per repo and project. An empty project set (a --tasks run sharing no project) skips it.
    if mine:
        git, shared = SC.Git(), []
        here, twin = git.toplevel(str(repo)) or repo_real, None
        for k in sorted(cands):
            c = cands[k]
            if c["mine"] or k in paired or k in named or c["supersedes"] in cands:
                continue
            root = roots[k]
            co = (git.toplevel(str(root)) if root.is_dir() else None) or os.path.realpath(root)
            if twin is None:
                twin = SelfRollout(env).twin(here) or ""
            if co == here or (twin and co == twin):
                shared.append(f"[[{c['slug']}]] ({c['label']}; {c['state']}) runs from {root}, which this run would "
                              "share (its clone, or that clone's in-place twin): two projects' rollouts on one repo each "
                              f"take their own clone (ADR 0064): re-run /thread:schedule {rerun_of(rr, args)}, whose § 0 "
                              "resolves this project's clone")
                continue
            warns.append(f"WARN: [[{c['slug']}]] ({c['label']}; {c['state']}) is another project's unfinished rollout "
                         f"on this repo, in its own clone {root}: both run, and Integration takes one merge at a time "
                         "per origin (ADR 0064)")
            del cands[k]
        if shared:
            keys = sorted((ln[2:ln.index("]]")] for ln in shared), key=str.lower)
            lines = sorted(shared, key=lambda ln: ln[2:ln.index("]]")].lower())
            return finish(warns, "refuse " + ",".join(keys), 3, lines)
        pairs = [(p, n) for p, n in pairs if p in cands and n in cands]
    u = sorted(cands)
    if not u:
        return finish(warns, "none", 0)
    slugs_of = lambda keys: ",".join(cands[k]["slug"] for k in sorted(keys))  # noqa: E731

    # 3. One interrupted supersede, this project's.
    if len(u) == 2 and len(pairs) == 1 and set(pairs[0]) == set(u) and cands[pairs[0][1]]["mine"]:
        p, n = (cands[k] for k in pairs[0])
        if args.regenerate:
            return finish(warns, f"interrupted {p['slug']} {n['slug']}", 0)
        return finish(warns, f"refuse {slugs_of(u)}", 3, [pair_incomplete(p, n)])

    # 4. One unfinished parallel rollout.
    if len(u) == 1:
        x = cands[u[0]]
        if x["eligible"] and args.regenerate:
            if x["incomplete"]:
                warns.append(f"WARN: {x['slug']} is incomplete ({x['incomplete']}): this run supersedes it, "
                             "which finishes it")
            return finish(warns, f"supersede {x['slug']}", 0)
        return finish(warns, f"refuse {x['slug']}", 3, [remedy(x)])

    # 5. Two or more.
    lines = [f"at most one unfinished rollout per repo and project, and this repo has {len(u)}:"]
    lines += [f"  - [[{cands[k]['slug']}]] ({cands[k]['label']}; {cands[k]['state']})" for k in u]
    for pk, nk in pairs:
        p, n = cands[pk], cands[nk]
        lines.append(pair_incomplete(p, n))
    for k in u:
        c = cands[k]
        if c["incomplete"] and k not in paired:
            lines.append(lone_incomplete(c))
    for k in u:
        c = cands[k]
        if not c["fresh"] and c["supersedes"] in cands and (c["supersedes"], k) not in pairs:
            lines.append(f"{cands[c['supersedes']]['slug']} is named by the supersedes: of {c['slug']}, which "
                         "has since run: an interrupted supersede whose new rollout has since run: /thread:repair")
    lines.append("otherwise: let each finish, or /thread:status then /thread:repair the stuck one")
    return finish(warns, f"refuse {slugs_of(u)}", 3, lines)


def check_serial(args, rr, tasks_dir, surfaces, vault, warns, warned) -> int:
    """Serial mode: the chain's tokens against what every live serial note holds and every unfinished parallel rollout's
    root (ADR 0060: a stuck chain holds only its unlanded rows' surfaces; a released parallel rollout holds no root). It
    supersedes nothing; its only git is the nested-checkout read (serial-chains.py's Git.checkout)."""
    if args.regenerate:
        warns.append("WARN: a serial run supersedes nothing (ADR 0040, p24-2): --regenerate ignored")
    mine = run_projects(rr, args, tasks_dir, warns)
    notes = list(rollout_notes(rr, tasks_dir, archive=False))
    top = SC.Git().checkout
    hits = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned):
        pairs = SC.overlap_pairs(surfaces, s["tokens"], top)
        if pairs:
            a, b = pairs[0]
            hits[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) is a live serial chain whose surface "
                               f"{SC.fmt_token(b)} overlaps this chain's {SC.fmt_token(a)} (ADR 0040: a chain owns the "
                               f"places it writes): {serial_remedy(s)}")
            continue
        freed = SC.overlap_pairs(surfaces, s["released"], top)
        if freed:
            warns.append(released_warn(s, freed[0][1]))
    for path, note, _ in notes:
        if rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial":
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        if c["complete"]:
            warns.append(ceremony_warn(c))
            continue
        root = rr._project_root(note)
        if root is None:
            warns.append(f"WARN: {c['slug']}: no Project root line: not counted")
            continue
        rtok = path_token(root, vault)
        a = next((x for x in surfaces if SC.overlaps(x, rtok, top)), None)
        if a is None:
            continue
        ph = parallel_hold(rr, path, note, rr._scan(path, tasks_dir)[0])
        if ph["released"]:
            warns.append(f"WARN: [[{c['slug']}]] ({c['label']}; {ph['why']}) is released (ADR 0060): it holds no "
                         f"Project root against serial chains while it waits on you, so this chain may write "
                         f"{SC.fmt_token(rtok)}; on resume it waits its turn while this chain holds it")
            continue
        hits[c["slug"]] = (f"[[{c['slug']}]] ({c['label']}; {state_line(c)}) is an unfinished parallel rollout "
                           f"whose Project root {root} ({SC.fmt_token(rtok)}) overlaps this chain's "
                           f"{SC.fmt_token(a)}: wait for it to finish, or /thread:status then /thread:repair")
    if hits:
        keys = sorted(hits, key=str.lower)
        return finish(warns, "refuse " + ",".join(keys), 3, [hits[k] for k in keys])
    return finish(warns, "none", 0)


def check_resume(args, rr, tasks_dir, toks, vault, warns, warned) -> int:
    """`--resume <slug>` (ADR 0060 d3): what a resuming rollout writes (a serial chain's write set, or a parallel
    rollout's root), against what the others hold for it: every other unfinished serial note's unlanded rows'
    surfaces, in any state (never its whole claim or its smoke rows), and, for a serial resume, every unfinished
    parallel rollout's root unless it is released, or idle and paused or halted. Whoever released a place yields it,
    so the chain scheduled on it never waits on the one that released it. Its only git is the nested-checkout read
    (serial-chains.py's Git.checkout), as the schedule-time checks compare."""
    me = rr._wikilink_slug(args.resume) or args.resume.strip()
    if not me or not (tasks_dir / f"{me}.md").is_file():
        die(f"--resume {args.resume}: no rollout note at {tasks_dir / (me + '.md')}")
    if args.regenerate:
        warns.append("WARN: --resume re-checks a resuming rollout and supersedes nothing: --regenerate ignored")
    mine = run_projects(rr, args, tasks_dir, warns) if (args.project is not None or args.tasks is not None) else set()
    what = "chain" if args.shape == "serial" else "rollout"
    notes = list(rollout_notes(rr, tasks_dir, archive=False))
    top = SC.Git().checkout
    hits = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned, skip=me):
        pairs = SC.overlap_pairs(toks, s["unlanded"], top)
        if pairs:
            a, b = pairs[0]
            hits[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) holds `{SC.fmt_token(b)}` for an unlanded "
                               f"row, which this {what} writes as `{SC.fmt_token(a)}` (ADR 0060): [[{me}]] waits its "
                               f"turn: re-run once [[{s['slug']}]] lands its rows there ({serial_remedy(s)})")
    if args.shape != "serial":
        hits.update(clone_holders(args, rr, tasks_dir, me, mine, toks[0], notes, vault, warns, warned))
    if args.shape == "serial":
        for path, note, _ in notes:
            if path.stem.lower() == me.lower() or rr._status(note) in CLOSED or \
                    shape_of(rr, path.stem, note, warns, warned) == "serial":
                continue
            c = note_state(rr, path, note, tasks_dir, mine)
            root = rr._project_root(note)
            if c["complete"] or root is None:
                continue
            rtok = path_token(root, vault)
            a = next((x for x in toks if SC.overlaps(x, rtok, top)), None)
            if a is None:
                continue
            ph = parallel_hold(rr, path, note, rr._scan(path, tasks_dir)[0])
            # Skipped only while it writes nothing: released, or idle and paused or halted (one halted by its own entry
            # re-check launched nothing, so the chain it waits on never waits on it). A call still in flight after a
            # halt, or in a pause's drain, writes the root, so a rollout with one holds it.
            if ph["released"] or (ph["busy"] == 0 and (ph["paused"] or ph["halt"] is not None)):
                continue
            hits[c["slug"]] = (f"[[{c['slug']}]] ({c['label']}; {state_line(c)}) holds `{SC.fmt_token(rtok)}`, its "
                               f"Project root, which this chain writes as `{SC.fmt_token(a)}` (ADR 0060): [[{me}]] waits "
                               f"its turn: re-run once [[{c['slug']}]] finishes or stops (/thread:status [[{c['slug']}]])")
    if hits:
        keys = sorted(hits, key=str.lower)
        return finish(warns, "refuse " + ",".join(keys), 3, [hits[k] for k in keys])
    return finish(warns, "none", 0)


def first_line_ts(rr, slug):
    """The aware ts of the rollout's Run record's first line, or None (no record, an empty or unreadable one)."""
    lines = rr._record_read(slug)
    return rr._parse_ts(lines[0].get("ts")) if lines else None


def clone_holders(args, rr, tasks_dir, me, mine, tok, notes, vault, warns, warned) -> dict:
    """ADR 0064: a resuming parallel rollout against another project's in the same clone, {slug: line}. A hit is another
    project's unfinished, not complete parallel rollout that has run, with no `supersedes:` link to this one, whose
    Project root's checkout is --repo's, and which wins the tie: this rollout has not run, or the other's Run record
    began earlier (its first line's ts); ties and unreadable records break by slug order. With no --project or --tasks,
    `mine` is the resuming note's own `projects:`."""
    me_path = tasks_dir / f"{me}.md"
    try:
        me_note = rr.Note(me_path)
    except (ValueError, OSError) as e:
        die(f"--resume {me}: {e}")
    if args.project is None and args.tasks is None:
        mine = projects_of(rr, me_note)
    me_fresh = note_state(rr, me_path, me_note, tasks_dir, mine)["fresh"]
    me_sup = link_slug(rr, me_note, "supersedes")
    git = SC.Git()
    here = git.toplevel(os.path.expanduser(args.repo))
    hits, me_ts = {}, None
    for path, note, _ in notes:
        if path.stem.lower() == me.lower() or rr._status(note) in CLOSED or \
                shape_of(rr, path.stem, note, warns, warned) == "serial":
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        if c["mine"] or c["complete"] or c["fresh"] or c["supersedes"] == me.lower() or me_sup == path.stem.lower():
            continue
        root = rr._project_root(note)
        if root is None or here is None or not root.is_dir() or git.toplevel(str(root)) != here:
            continue
        if not me_fresh:
            if me_ts is None:
                me_ts = (first_line_ts(rr, me),)
            a, b = first_line_ts(rr, c["slug"]), me_ts[0]
            wins = (c["slug"].lower() < me.lower()) if a is None or b is None or a == b else a < b
            if not wins:
                continue
        rtok = path_token(root, vault)
        hits[c["slug"]] = (f"[[{c['slug']}]] ({c['label']}; {state_line(c)}) holds `{SC.fmt_token(rtok)}`, its Project "
                           f"root, which this rollout writes as `{SC.fmt_token(tok)}` (ADR 0064): [[{me}]] waits its "
                           "turn: two projects' rollouts never share a clone: /thread:schedule "
                           f"{project_label(rr, me_note).split(', ')[0]} --regenerate moves it to its own clone")
    return hits


def finish_with(x) -> str:
    """The re-run that supersedes x: --regenerate, or another project's own schedule run."""
    if x["mine"]:
        return "re-run with --regenerate to supersede it"
    return f"finish it with /thread:schedule {x['label'].split(', ')[0]} --regenerate"


def pair_incomplete(p, n) -> str:
    return (f"{n['slug']} is incomplete: an interrupted /thread:schedule wrote it to supersede {p['slug']} and "
            f"died before closing {p['slug']} out, so its tasks may be unstamped: {finish_with(n)}; never "
            f"/thread:execute [[{n['slug']}]] as written")


def lone_incomplete(x) -> str:
    return (f"{x['slug']} is incomplete: {x['incomplete']}: {finish_with(x)}; never /thread:execute "
            f"[[{x['slug']}]] as written")


def links(slugs) -> str:
    return ", ".join(f"[[{t}]]" for t in slugs) or "no task"


def remedy(x) -> str:
    s = x["slug"]
    if x["incomplete"]:
        return f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo, and {lone_incomplete(x)}"
    if x["eligible"] and x["signOff"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo: re-run with "
                "--regenerate to supersede it (its unlanded tasks carry into the new rollout; the waiting tasks carry "
                f"still gate-pending), or sign off, then /thread:execute [[{s}]]")
    if x["eligible"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}; {x['state']}) is on this repo: re-run with "
                "--regenerate to supersede it (its unlanded tasks carry into the new rollout)")
    if x["mine"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}) has run and is not paused ({x['why']}): if a session "
                "drives it, let it finish or pause it (execute § Pausing); if none does, hard-pause it (stamp "
                f"`paused:` and a `## Pause log` line) and re-run with --regenerate; if stuck: /thread:status "
                f"[[{s}]], then /thread:repair [[{s}]]")
    if x["signOff"]:
        return (f"unfinished rollout [[{s}]] is another project's ({x['label']}; awaiting sign-off since {x['paused']}): "
                f"at most one unfinished rollout per repo and project: it waits only on your sign-off of {links(x['waiting'])}: sign "
                f"off each gate, then /thread:execute [[{s}]] (it runs them and closes), or /thread:repair [[{s}]] to "
                f"defer them, then /thread:execute [[{s}]] closes it")
    return (f"unfinished rollout [[{s}]] is another project's ({x['label']}; {x['state']}): at most one unfinished "
            "rollout per repo and project: wait for it to finish, or /thread:status then /thread:repair")


def cmd_hold(args, rr) -> int:
    """What one rollout holds against the others (ADR 0060), for /thread:status: one JSON line."""
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slug = rr._wikilink_slug(args.rollout) or args.rollout.strip()
    path = tasks_dir / f"{slug}.md"
    if not slug or not tasks_dir.is_dir() or not path.is_file():
        die(f"--rollout {args.rollout}: no rollout note at {path}")
    try:
        note = rr.Note(path)
    except (ValueError, OSError) as e:
        die(f"--rollout {slug}: {e}")
    load_sc()
    warns, shape, status = [], rr._shape(note), rr._status(note)
    out = {"rollout": path.stem, "shape": shape, "scope": "none", "why": "", "held": [], "released": []}
    fmt = lambda toks: [SC.fmt_token(t) for t in toks]  # noqa: E731
    if status in CLOSED:
        out["why"] = f"{status}: it holds nothing"
    elif shape == "serial":
        found = serial_notes(rr, [(path, note, "root")], tasks_dir, warns, set(), set())
        if not found:
            out["why"] = "every task done (its completion ceremony never ran): it holds nothing"
        else:
            c = found[0]
            out.update(scope=c["scope"], why=c["why"], held=fmt(c["tokens"]), released=fmt(c["released"]))
    else:
        root = rr._project_root(note)
        linked = rr._scan(path, tasks_dir)[0]
        counts = rr._counts([dict(zip(("state", "setAsideAt"), rr._queue_state(t))) for _, t in linked])
        if root is None:
            out["why"] = "no Project root line: it holds nothing"
        elif counts["total"] >= 1 and counts["merged"] == counts["total"]:
            out["why"] = "every task merged (its completion ceremony never ran): it holds nothing"
        else:
            rtok = SC.fmt_token(path_token(root, vault_root(tasks_dir)))
            ph = parallel_hold(rr, path, note, linked)
            if ph["released"]:
                out.update(scope="released", released=[rtok],
                           why=f"{ph['why']}: it holds no Project root against serial chains, and is still this "
                               "project's one unfinished parallel rollout on this repo")
            else:
                out.update(scope="whole", held=[rtok], why=f"{ph['why']}: it holds its Project root")
    for w in warns:
        print(w, file=sys.stderr)
    print(json.dumps(out, ensure_ascii=False))
    return 0


def cmd_running(args, rr) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    protocol = rr._scalar(rr.Note(TEMPLATE).get("protocol_version"))  # what schedule writes, what execute runs
    running = []
    for path, note, _ in rollout_notes(rr, tasks_dir, archive=False):
        if rr._status(note) in CLOSED or rr._scalar(note.get("protocol_version")) != protocol:
            continue
        if rr._valued(note.get("engine_snapshot")):
            continue   # ADR 0043: it runs on its Engine snapshot, so the Primary checkout is free to move
        if rr._valued(note.get("paused")) or rr.approved_unrun(note, rr._scan(path, tasks_dir)[0])[0]:
            continue
        running.append(path.stem)
    print("\n".join(f"running {slug}" for slug in running) or "none")
    return 0


# ---- the pickup sweep (schedule § 1.2, ADR 0057 d1) -----------------------------------------------------------------

REPO_LABEL = "**Repo:**"
LIST_LINE_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s")
BACKTICK_RE = re.compile(r"`([^`]+)`")
GATE_KINDS = ("spend", "credential", "irreversible")


def launch_repo(note):
    """The `## Launch` **Repo:** value as written ('' when the section has no such list line, or it is empty): the first
    backtick span after the label, else the first whitespace token, a trailing `/` dropped."""
    for line in note.section_text("## Launch").split("\n"):
        if not LIST_LINE_RE.match(line) or REPO_LABEL not in line:
            continue
        rest = line.split(REPO_LABEL, 1)[1]
        m = BACKTICK_RE.search(rest)
        value = m.group(1).strip() if m else (rest.split() or [""])[0]
        return value.rstrip("/") if value not in ("", "/") else value
    return ""


def phase_key(rr, note):
    """`phase:` as a finite float, (0, n); a missing, empty, unparseable or non-finite one sorts last, (1, 0)."""
    try:
        n = float(rr._scalar(note.get("phase")))
    except ValueError:
        return (1, 0.0)
    return (0, n) if math.isfinite(n) else (1, 0.0)


def build_index(rr, tasks_dir: Path):
    """stem (lower-cased) -> (path, Note) for every note under the tasks dir, Archive included, a root copy preferred
    (reconcile-rollout.py's _scan builds its dependency index the same way)."""
    index = {}
    for path in sorted(tasks_dir.rglob("*.md")):
        try:
            note = rr.Note(path)
        except (ValueError, OSError):
            continue
        prev = index.get(path.stem.lower())
        if prev is None or (prev[0].parent != tasks_dir and path.parent == tasks_dir):
            index[path.stem.lower()] = (path, note)
    return index


def first_project(rr, note, mine):
    """The display name of the note's first project in the run's project set."""
    for v in note.get_list("projects"):
        name = rr._wikilink_slug(rr._scalar(v))
        if name and norm_project(rr, v) in mine:
            return name
    return "?"


def cmd_pickups(args, rr) -> int:
    repo = Path(os.path.expanduser(args.repo))
    if not repo.is_dir():
        die(f"--repo {args.repo}: not a directory")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    load_sc()
    gi = load_module("gated_inputs", GI_SRC, GI_NAMES, "skills/_shared/scripts/gated_inputs.py")
    warns = []
    named = named_tasks(rr, args.tasks, tasks_dir)
    cands = {name.lower() for name, _ in named}
    mine = set.intersection(*(projects_of(rr, note) for _, note in named))
    if not mine:
        warns.append("WARN: the named tasks share no project: the pickup pool is empty")
    misfits = {}
    for m in args.misfit or []:
        slug, sep, why = m.partition("=")
        slug = (rr._wikilink_slug(slug.strip()) or "").lower()
        if not sep or not slug or not why.strip():
            die(f"--misfit {m}: not <slug>=<why>")
        misfits[slug] = why.strip()

    # The pool: open tasks directly in the tasks dir, on the run's projects, owned by no live rollout.
    pool = {}
    for path in sorted(tasks_dir.glob("*.md")) if mine else []:
        try:
            note = rr.Note(path)
        except (ValueError, OSError):
            continue
        tags = tags_of(rr, note)
        key = path.stem.lower()
        if "task" not in tags or tags & {"rollout", "decisions"} or rr._status(note) != "open" or key in cands or \
                rr._live_rollout(tasks_dir, note.get("rollout")) or not projects_of(rr, note) & mine:
            continue
        pool[key] = (path, note)
    for slug in misfits:
        if slug not in pool:
            die(f"--misfit {slug}: no pool task of that name (an open task on these projects, not one of --tasks)")

    # The Repo rule: a task with no Repo line, or on another repo, is counted and never read further.
    env = git_env()
    repo_real = os.path.realpath(repo)
    repo_origin = origin_of(repo, env)
    if repo_origin is None:
        warns.append(f"WARN: --repo {args.repo} is not a git repo with an origin here: only paths are compared")
    origins = {}
    counted = {"another repo": 0, "no ## Launch repo": 0}
    left = {}
    readable = {}
    for key, (path, note) in pool.items():
        value = launch_repo(note)
        if not value:
            counted["no ## Launch repo"] += 1
            continue
        where = Path(os.path.expanduser(value))
        if not where.is_dir():
            readable[key] = (path, note)
            left[key] = f"## Launch repo {value} is missing here: its origin is unread"
            continue
        real = os.path.realpath(where)
        same = real == repo_real
        if not same and repo_origin is not None:
            if real not in origins:
                origins[real] = origin_of(where, env)
            same = origins[real] == repo_origin
        if not same:
            counted["another repo"] += 1
            continue
        readable[key] = (path, note)

    # The gate rule, then the misfits.
    for key, (path, note) in readable.items():
        if key in left:
            continue
        try:
            hits = gi.sweep(gi.body_of(path.read_text()))
        except (OSError, UnicodeDecodeError) as e:
            left[key] = f"unreadable: {e}"
            continue
        kind = next((k for k in GATE_KINDS if hits.get(k)), None)
        if kind is not None:
            found = {h["word"] for h in hits[kind]}
            word = next((w[0] for w in getattr(gi, kind.upper()) if w[0] in found), hits[kind][0]["word"])
            left[key] = f'gated: {kind} "{word}"'
        elif key in misfits:
            left[key] = misfits[key]

    weight = lambda key: rr.PRIORITY_WEIGHTS[rr._priority(readable[key][1])]  # noqa: E731
    order = sorted(readable, key=lambda k: (-weight(k), phase_key(rr, readable[k][1]), k.casefold()))
    rank = {k: i for i, k in enumerate(order)}
    stem = {k: readable[k][0].stem for k in readable}
    stem.update({name.lower(): name for name, _ in named})   # a candidate's name as given
    index = build_index(rr, tasks_dir)
    landed = {}

    def deps(key):
        """[(dep as written, its unit lower-cased)] for each unlanded dependency of a candidate or pool task."""
        note = readable[key][1] if key in readable else index.get(key, (None, None))[1]
        out = []
        for dep in rr._dep_entries(note) if note is not None else []:
            if dep.lower() not in landed:
                landed[dep.lower()] = rr._dep_status(dep, index)
            if not landed[dep.lower()][0]:
                out.append((dep, rr._fold_unit(dep, index)[0].lower()))
        return out

    # A dependency cycle among pool tasks leaves each member.
    def reach(start):
        seen, todo = set(), [start]
        while todo:
            for _, u in deps(todo.pop()):
                if u in readable and u not in seen:
                    seen.add(u)
                    todo.append(u)
        return seen

    reaches = {k: reach(k) for k in order}
    for k in order:
        if k in reaches[k] and k not in left:
            others = [u for u in order if u != k and u in reaches[k] and k in reaches[u]]
            left[k] = f"a dependency cycle with [[{stem[others[0] if others else k]}]]"

    # Needed: reachable from the candidates through unlanded pool dependencies, never through a left task; a needed
    # task whose dependency cannot be met is left, to a fixpoint.
    while True:
        needed, by = [], {}
        todo = [name.lower() for name, _ in named]
        while todo:
            t = todo.pop(0)
            for _, u in deps(t):
                if u in readable and u not in by and u not in cands:
                    by[u] = t
                    needed.append(u)
                    if u not in left:
                        todo.append(u)
        changed = False
        for u in needed:
            if u in left:
                continue
            for dep, unit in deps(u):
                if unit in cands or (unit in by and unit not in left):
                    continue
                left[u] = (f"depends on [[{dep}]] (left alone)" if unit in readable
                           else f"depends on [[{dep}]] ({landed[dep.lower()][1]})")
                changed = True
                break
        if not changed:
            break
    joined = {u for u in needed if u not in left}
    join = [{"slug": stem[u], "kind": "needed", "why": f"needed by [[{stem[by[u]]}]]"}
            for u in sorted(joined, key=rank.get)]

    # Extras: each other pool task in order, with its closure of unlanded pool dependencies not yet joined.
    def closure(t):
        members, todo, bad = [t], [t], None
        while todo and bad is None:
            m = todo.pop(0)
            for dep, unit in deps(m):
                if unit in cands or unit in joined or unit in members:
                    continue
                if unit not in readable:
                    bad = f"depends on [[{dep}]] ({landed[dep.lower()][1]})"
                    break
                if unit in left:
                    bad = f"depends on [[{dep}]] (left alone)"
                    break
                members.append(unit)
                todo.append(unit)
        return members, bad

    extras, beyond = 0, []
    for t in order:
        if t in joined or t in left or t in by:
            continue
        members, bad = closure(t)
        if bad is not None:
            left[t] = bad
            continue
        if extras + len(members) > PICKUP_CAP:
            beyond.append(t)
            continue
        extras += len(members)
        note = readable[t][1]
        join.append({"slug": stem[t], "kind": "extra", "why": f"open on [[{first_project(rr, note, mine)}]] on this "
                                                               f"repo, priority {rr._priority(note)}"})
        for m in members[1:]:
            join.append({"slug": stem[m], "kind": "extra", "why": f"needed by [[{stem[t]}]]"})
        joined.update(members)
    beyond = [t for t in beyond if t not in joined]

    warnings = []
    for t in [name.lower() for name, _ in named] + [u for u in needed if u in joined]:
        for dep, unit in deps(t):
            if unit in left:
                warnings.append({"task": stem[t], "dep": stem[unit], "why": left[unit]})
    for w in warns:
        print(w, file=sys.stderr)
    print(json.dumps({
        "projects": sorted(mine), "order": [stem[k] for k in order], "join": join,
        "needed": [stem[u] for u in sorted((u for u in needed if u in joined), key=rank.get)],
        "left": [{"slug": stem[k], "why": left[k]} for k in order if k in left], "counted": counted,
        "beyond": [stem[k] for k in beyond], "warnings": warnings, "cap": PICKUP_CAP,
    }))
    return 0


# ---- unstarted (close step 2, ADR 0057 d5) ---------------------------------------------------------------------------

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.S)


def front_matter(path: Path) -> dict:
    """A doc's top-level `key: value` front-matter lines, quotes stripped, CRLF tolerated ({} when it has none)."""
    try:
        m = FM_RE.match(path.read_text())
    except (OSError, UnicodeDecodeError):
        return {}
    out = {}
    for line in m.group(1).split("\n") if m else []:
        kv = re.match(r"^([A-Za-z_][\w-]*):[ \t]*(.*?)\s*$", line.rstrip("\r"))
        if kv and kv.group(1) not in out:
            out[kv.group(1)] = kv.group(2).strip().strip("\"'").strip()
    return out


def lead_entry(rec, slug):
    """The ts of the first `kind: lead-entry` line in the slug's Run record, or None (an unreadable record is none)."""
    try:
        with open(rec.record_path(slug)) as fh:
            for line in fh:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if isinstance(ev, dict) and ev.get("kind") == "lead-entry":
                    return ev.get("ts") or "?"
    except Exception:  # noqa: BLE001 — a missing or unreadable record (or a slug it refuses) reads as none
        return None
    return None


def cmd_unstarted(args, rr) -> int:
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    slug = rr._wikilink_slug(args.rollout) or ""
    if not slug:
        die("--rollout names no rollout")
    rec = load_module("run_record", RUN_RECORD_SRC, RUN_RECORD_NAMES, "skills/_shared/scripts/run_record.py")
    path = find_task(tasks_dir, slug) if tasks_dir.is_dir() else None
    if path is None:
        die(f"--rollout {slug}: no note at {tasks_dir / (slug + '.md')} or under Archive/")
    try:
        note = rr.Note(path)
    except (ValueError, OSError) as e:
        die(f"--rollout {slug}: {e}")
    status = rr._status(note)
    if path.parent != tasks_dir:
        print(f"closed {slug} ({status if status in CLOSED else 'archived'})")
        return 0
    if status in CLOSED:
        print(f"closed {slug} ({status})")
        return 0
    if rr._shape(note) == "serial":
        print(f"serial {slug}")
        return 0
    linked, index = rr._scan(path, tasks_dir)
    fresh, why = rr.approved_unrun(note, linked)
    if not fresh:
        print(f"started {slug} ({why})")
        return 0
    ts = lead_entry(rec, slug)
    if ts is not None:
        print(f"started {slug} (a lead entered {ts})")
        return 0
    if rr._start_unattended(note):
        print(f"stamped {slug} (start: unattended)")
        return 0
    if rr._valued(note.get("started_unattended")):
        print(f"stamped {slug} (started_unattended: {rr._scalar(note.get('started_unattended'))})")
        return 0
    why = rr.incomplete(path, note, linked, index)
    if why:
        print(f"incomplete {slug} ({why})")
        return 0
    dirs = [Path(os.path.expanduser(d)) for d in args.handoffs or []]
    for doc in sorted({p for d in dirs if d.is_dir() for p in d.glob("*.md") if p.is_file()}, key=str):
        fm = front_matter(doc)
        if (rr._wikilink_slug(fm.get("launches", "")) or "").lower() == slug.lower():
            print(f"launched {slug} {doc} ({fm.get('status', '').lower() or 'no status'})")
            return 0
    root = rr._project_root(note)
    print(f"unstarted {slug} {root if root is not None else '(no Project root line)'}")
    return 0


# ---- the clone verb and the branch check (ADR 0064) -------------------------------------------------------------------

def cmd_clone(args, rr) -> int:
    """`clone` (ADR 0064; schedule § 0 step 3, estate-scan.py): which rollout clone this project's parallel rollout on
    --repo's repo runs from. One stdout line: `default` or `project <slug>` (exit 0), `refuse <slugs>` (exit 3)."""
    local = Path(os.path.expanduser(args.repo))
    if not local.is_dir():
        die(f"--repo {args.repo}: not a directory")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    load_sc()
    git, env, warns, warned = SC.Git(), git_env(), [], set()
    top = git.toplevel(str(local))
    if top is None:
        die(f"--repo {args.repo}: not in a git work tree")
    sr = SelfRollout(env)
    if sr.twin(top) is not None:
        warns.append(f"WARN: --repo {args.repo} is itself a rollout clone ({top}, of {sr.twin(top)}): its Local: line "
                     "names the clone, so this project's rollout runs from it as is")
        return finish(warns, "default", 0)
    slug = project_slug(rr._wikilink_slug(args.project) or args.project)
    has_p = clone_slug_ok(slug)
    if not has_p:
        warns.append(f"WARN: project slug {slug or '(empty)'} takes no clone of its own (empty, or it ends in -rollout, "
                     "so its clone would read as another's)")
    d_clone, p_clone = f"{top}-rollout", f"{top}-{slug}-rollout"
    same_repo, _origin = same_repo_rule(rr, local, env, warns)
    cands = []
    for path, note, _w in rollout_notes(rr, tasks_dir, archive=False):
        if rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial" or \
                not same_repo(path.stem, note):
            continue
        c = note_state(rr, path, note, tasks_dir, set())
        root = rr._project_root(note)
        if c["complete"] or root is None or not root.exists():
            continue
        c.update(state=state_line(c), root=str(root),
                 checkout=(git.toplevel(str(root)) if root.is_dir() else None) or os.path.realpath(root),
                 mine=bool(slug) and any(project_slug(rr._wikilink_slug(rr._scalar(v)) or "") == slug
                                         for v in note.get_list("projects")))
        cands.append(c)

    def takers(clone):
        """Another project's candidates that block `clone`: rooted in it, or in place at T (blocking every clone)."""
        return [c for c in cands if not c["mine"] and c["checkout"] in (clone, top)]

    parent, base = os.path.dirname(top), os.path.basename(top)

    def clone_x(co):
        """'' for D, x for a sibling `<base(T)>-<x>-rollout` whose in-place twin is T, else None."""
        b = os.path.basename(co)
        if os.path.dirname(co) != parent or not b.endswith("-rollout"):
            return None
        if b == f"{base}-rollout":
            x = ""
        elif b.startswith(f"{base}-") and len(b) > len(base) + 1 + len("-rollout"):
            x = b[len(base) + 1:-len("-rollout")]
        else:
            return None
        return x if sr.twin(co) == top else None

    # 1. Reuse by recorded root: this project's candidates rooted in a rollout clone of T.
    own = {}
    for c in cands:
        x = clone_x(c["checkout"]) if c["mine"] else None
        if x is not None:
            own.setdefault(c["checkout"], (x, []))[1].append(c)
    if len(own) >= 2:
        mineall = sorted((c for _x, cs in own.values() for c in cs), key=lambda c: c["slug"].lower())
        lines = [f"[[{c['slug']}]] ({c['label']}; {c['state']}) runs from {c['checkout']}" for c in mineall]
        lines.append(f"this project's unfinished rollouts on this repo run from {len(own)} clones "
                     f"({', '.join(sorted(own))}): one clone per (repo, project) (ADR 0064): let one finish, or "
                     "/thread:status then /thread:repair, then re-run")
        return finish(warns, "refuse " + ",".join(c["slug"] for c in mineall), 3, lines)
    if own:
        k, (x, cs) = next(iter(own.items()))
        held = takers(k)
        if not held:
            return finish(warns, "default" if x == "" else f"project {x}", 0)
        warns.append(f"WARN: this project's {links(c['slug'] for c in cs)} runs from {k}, which another project's "
                     f"{links(c['slug'] for c in held)} also holds: its clone is chosen afresh")
    # 2. The default clone, unless another project's rollout holds it.
    if not takers(d_clone):
        return finish(warns, "default", 0)
    # 3. This project's own clone: P defined, not held, and colliding with no checkout (it need not exist).
    collision = None
    if has_p and not takers(p_clone):
        rc, _out, err = sr.resolve(local, slug)
        if rc in (0, 4):
            return finish(warns, f"project {slug}", 0)
        if rc != 3:
            die(f"self-rollout-check.sh --resolve {args.repo} {slug} exited {rc}: "
                f"{next((ln for ln in reversed(err.splitlines()) if ln.strip()), 'no stderr')}")
        collision = next((ln for ln in err.splitlines() if "is not a usable rollout clone" in ln),
                         next((ln for ln in err.splitlines() if ln.strip()), f"{p_clone} collides"))
    # 4. Refuse: every taker of D and P.
    held = {c["slug"]: c for c in takers(d_clone) + (takers(p_clone) if has_p else [])}
    keys = sorted(held, key=str.lower)
    lines = [f"[[{k}]] ({held[k]['label']}; {held[k]['state']}) runs from {held[k]['checkout']}: "
             + ("in place, so it holds every clone of this repo" if held[k]["checkout"] == top else
                "another project's rollout holds that clone") for k in keys]
    if collision:
        lines.append(collision)
    lines.append(f"this project's parallel rollout on this repo has no clone free (ADR 0064): wait for one of them to "
                 "finish, or /thread:status then /thread:repair, then re-run")
    return finish(warns, "refuse " + ",".join(keys), 3, lines)


def cmd_branches(args, rr) -> int:
    """`branches` (ADR 0064; schedule step 5's Branch check): each named task's branch `audit-fix/<shortAlias(slug)>`
    against the unlanded tasks of every other unfinished parallel rollout on the same repo, and against the earlier
    named tasks. One `collide <slug> <branch> <[[rollout]] | -> [[<task>]]` line per collision, else `none`."""
    repo = Path(os.path.expanduser(args.repo))
    if not repo.is_dir():
        die(f"--repo {args.repo}: not a directory")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    slugs = [rr._wikilink_slug(x) or x.strip() for x in args.tasks.split(",") if x.strip()]
    if not slugs:
        die("--tasks names no task")
    load_sc()
    warns, warned = [], set()
    same_repo, repo_origin = same_repo_rule(rr, repo, git_env(), warns)
    if repo_origin is None:
        warns.append(f"WARN: --repo {args.repo} is not a git repo with an origin here: matched on its path only")
    want = {x.lower() for x in slugs}
    taken = []  # (branch, task, rollout)
    for path, note, _w in rollout_notes(rr, tasks_dir, archive=False):
        if rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial" or \
                not same_repo(path.stem, note, warn=False):
            continue
        for tp, t in rr._scan(path, tasks_dir)[0]:
            if tp.stem.lower() not in want and rr._queue_state(t)[0] in UNLANDED:
                taken.append((f"audit-fix/{short_alias(tp.stem)}", tp.stem, path.stem))
    out, first = [], {}
    for x in slugs:
        br = f"audit-fix/{short_alias(x)}"
        out += [f"collide {x} {br} [[{ro}]] [[{t}]]" for b, t, ro in sorted(taken, key=lambda e: (e[2], e[1])) if b == br]
        if br in first:
            out.append(f"collide {x} {br} - [[{first[br]}]]")
        else:
            first[br] = x
    return finish(warns, "\n".join(out) or "none", 0)


def finish(warns, line, code, errors=()):
    for w in warns:
        print(w, file=sys.stderr)
    for e in errors:
        print(e, file=sys.stderr)
    print(line)
    return code


def main() -> int:
    p = Parser(prog="unfinished-rollout.py", description="At most one unfinished parallel rollout per repo and "
                                                         "project, each in its own clone; serial chains limited by "
                                                         "surfaces (schedule § 0, § Serial path).")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="print none | supersede | interrupted | file | refuse for this repo or chain")
    c.add_argument("--shape", choices=("parallel", "serial"), default="parallel",
                   help="parallel (schedule § 0, the default) or serial (schedule § Serial path S3)")
    c.add_argument("--repo", default=None, help="the target repo (the path schedule § 0 resolved); parallel only")
    c.add_argument("--surface", action="append", default=None,
                   help="one of the chain's surface tokens, as serial-chains.py printed it (repeatable); serial only")
    c.add_argument("--project", default=None, help="the project schedule targets (a name or [[wikilink]])")
    c.add_argument("--tasks", default=None, help="comma-separated task slugs (a --tasks run): their shared projects")
    c.add_argument("--regenerate", action="store_true", help="this run may supersede (schedule --regenerate)")
    c.add_argument("--resume", default=None,
                   help="a resuming rollout's slug (ADR 0060): its writes against what the others hold for it")
    c.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    h = sub.add_parser("hold", help="what one rollout holds against the others (ADR 0060): one JSON line")
    h.add_argument("--rollout", required=True, help="the rollout note's slug (or [[wikilink]])")
    h.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    r = sub.add_parser("running", help="print the rollouts that may have a lead running on the primary checkout")
    r.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    k = sub.add_parser("pickups", help="the Pickup sweep (schedule § 1.2): open tasks on this repo that may join")
    k.add_argument("--repo", required=True, help="the target repo (the path schedule § 0 resolved)")
    k.add_argument("--tasks", required=True, help="comma-separated candidate slugs (step 1's set)")
    k.add_argument("--misfit", action="append", default=None,
                   help="<slug>=<why>: a pool task the agent judged a misfit (repeatable)")
    k.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    cl = sub.add_parser("clone", help="which rollout clone this project's parallel rollout runs from (ADR 0064)")
    cl.add_argument("--repo", required=True, help="the project note's Local: path (the in-place checkout)")
    cl.add_argument("--project", required=True, help="the project schedule § 0 reads Local: for (a name or [[wikilink]])")
    cl.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    b = sub.add_parser("branches", help="the Branch check (schedule step 5): named tasks whose branch another run uses")
    b.add_argument("--repo", required=True, help="the target repo (the path schedule § 0 resolved)")
    b.add_argument("--tasks", required=True, help="comma-separated task slugs, in queue order")
    b.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    u = sub.add_parser("unstarted", help="whether a rollout this session wrote still needs its lead started (close step 2)")
    u.add_argument("--rollout", required=True, help="the rollout note's slug (or [[wikilink]])")
    u.add_argument("--handoffs", action="append", default=None,
                   help="a docs/handoffs dir close's scan read (repeatable): a doc there with `launches:` names a launch")
    u.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    args = p.parse_args()
    rr = load_rr()
    verbs = {"running": cmd_running, "check": cmd_check, "pickups": cmd_pickups, "unstarted": cmd_unstarted,
             "hold": cmd_hold, "clone": cmd_clone, "branches": cmd_branches}
    return verbs[args.cmd](args, rr)


if __name__ == "__main__":
    sys.exit(main())
