#!/usr/bin/env python3
"""unfinished-rollout.py — at most one unfinished parallel rollout per repo and project, each project's in its own
rollout clone; serial chains ordered by their predicted surfaces (schedule § 0 and § Serial path; ADR 0027, ADR 0030,
ADR 0040, ADR 0060, ADR 0064, ADR 0067); the estate's one Waiting list of ready chains (ADR 0076); and the one list of
every open needs-you item (p48-1).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check [--shape parallel] --repo <path>
        (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --shape serial --surface <token>...
        [--checkout <dir>]... (--project <name> | --tasks <slug,...>) [--regenerate] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check [--shape parallel|serial]
        --resume <slug> (--repo <path> | --surface <token>... [--checkout <dir>]...) [--project <name> | --tasks <slug,...>]
        [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py check --shape parallel --repo <path>
        --resume <slug> --surface-wait --running <slug,...|""> [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py hold --rollout <slug> [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py clone --repo <Local:> --project <name> [--tasks <a,b>]
        [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py branches --repo <path> --tasks <slug,...>
        [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py waiting [--now <iso>] [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py awaited [--rollout <slug>]...
        [--task <slug>]... [--tasks-dir <dir>]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py needs-you [--now <iso>] [--gh-bin <gh>]
        [--tasks-dir <dir>]

/thread:schedule § 0 runs the parallel check last, after the remote, landing-register, self-rollout and pushed-base
checks, and acts on the one line it prints; § Serial path S3 runs the serial check once per chain. Stdlib only,
python >= 3.9. No network but `needs-you`'s gh read of a `hold_until` PR (below). Git runs only as `git rev-parse
--local-env-vars` (to scrub repo-local env vars such as a hook's GIT_DIR, landing-register.py's rule), `git -C <path>
remote get-url origin` and, in `check` and `clone`, `git -C <dir> rev-parse --show-toplevel` for the nested-checkout
rule (below), each Project root's checkout and each serial row's launch-folder checkout; plus one child,
`bash skills/execute/scripts/self-rollout-check.sh --in-place <path>` (check's step 2c, `clone`) and `--resolve <Local:>
<slug>` (`clone`'s rule 3 only), both read-only and memoised (SelfRollout), which run git and land.sh themselves. It
writes nothing, except `check --surface-wait`'s surface-wait marker (no note; *Surface wait*, below). The surface
grammar (parse_token,
overlaps, read_surfaces), norm_origin and the Git reader are serial-chains.py's, loaded by `check`, `hold` and
`pickups`, and by `running` (primary-hold.sh's verb, which otherwise loads only reconcile-rollout.py) only through leg.py,
for an unstamped serial note, with its statement of a chain's checkouts (repo_parts, checkout_of, checkouts_of). What a
serial chain holds is leg.py's hold_of (ADR 0060), loaded as a module (Chain, chain_read, hold_of, write_set,
write_rows, Refuse; its rr and sc set to this script's) once `check` or `hold` reads the first unfinished serial note
(one whose `surfaces:` reads as any included), or `running` the first unstamped serial one (to read whether its chain is
stuck), so a parallel-only estate never loads it.

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
  ADR 0064 amends it). A surface wait (P41-3: a readable surface-wait marker, *Surface wait* below) takes the place of
  that rule: released while no task the marker's `live` lists is running and none is integrating (an
  awaiting-integration task never counts), whatever is set aside, paused or halted; an unreadable marker releases
  nothing. A parallel rollout idle in a surface wait (no call in flight that its marker lists, no task integrating)
  holds no Project root against serial chains that read the marker: it launches nothing until its own Surface re-check
  passes, so no cycle forms. A serial chain on an engine snapshot from before P41-3 reads no marker (legacy_engine):
  every serial resume read of it reads the rule above alone.
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

Surfaces. Comparison is on canonical tokens (serial-chains.py's grammar: a `repo:<toplevel>//<path>` file or folder
token, or a bare `repo:<path>` covering its checkout) and literal, save its nested-checkout rule below: the
`--surface` values and each serial note's `surfaces:` (or a stuck chain's Queue cells, ADR 0060) are compared as
written; --repo, each `--checkout` and each parallel candidate's Project root go through `os.path.realpath`, then (all
but --checkout) the vault mapping (at or under the vault root: `vault` or `vault:<rel>`), else become the bare
`repo:<realpath>`. The vault root is the tasks dir's grandparent, used only when the tasks dir ends in `Work/Tasks`.
For a chain that works a checkout in place (ADR 0067 d4; a note with no `chain_copies:`, ADR 0067 d2), a chain's
checkouts are read too: turn(xs), the bare `repo:<key>` of each
`repo:` token (checkout_of); L(folders), the checkouts some Queue Launch-cell folders sit in (checkouts_of, the vault
and a folder in no checkout skipped); U(s) = turn(its unlanded rows' tokens) and L(those rows' folders), where it
still has work (a stuck chain's is empty: with no Leg open and nothing claimable it uses no index or HEAD, ADR 0060);
T(s) = turn(its next Leg's write set) and L(those rows' folders), where its next Leg works. Overlap
is serial-chains.py's `overlaps`,
with its nested-checkout rule (p33-3), in every mode (`--resume` and the released WARNs included): two `repo:` tokens
that meet only by containment are disjoint when both sit in git checkouts and the inner one's toplevel is not the
outer one's (a separate checkout nested by path, read from each path's nearest existing directory with `git rev-parse
--show-toplevel`); an outer path in no checkout still covers everything beneath it. A serial note with no
`surfaces:`, or with a token parse_token refuses, reads as `any` (its whole hold, scope `whole`), with `WARN: <slug>:
<why>: read as any`; a `--resume` still compares against its unlanded rows' own cells, `any` only when one of those
cells is empty or malformed too.

Every refusal of a run that would schedule (exit 3, `check` and `clone` alike, never a --resume re-check, which takes
nothing) also prints `this run would have taken: [[a]], [[b]]` as its last stderr line (ADR 0078 d7; would_take):
--tasks's names, else schedule step 1's open tasks on --project. None to take prints no line. Last, because a reader
of a refusal's first non-WARN line (estate-scan.py's clone blocker) reads who holds the repo.

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
  2b. Unfinished serial notes whose hold (above: a stuck chain's unlanded rows only) or U (none for a stuck chain)
     overlaps --repo's token (a live chain works its checkouts in place, so a parallel run rooted there would share
     their index and HEAD; one that overlaps only what a stuck chain released WARNs `WARN: [[s]] (<label>; <why>)
     released <token>, which this run claims: …` and is no hit) ->
     `refuse <their slugs, sorted>`, exit 3, one stderr line each: `[[s]] (<label>; <state>) is a serial chain working
     <token> in place, where this run would share its index and HEAD (ADR 0042): <remedy>`. A rollout clone's root
     never meets a chain in place (S13). The remedy names whose note it is: never started,
     run it (`/thread:execute [[slug]]` from its first row's launch) or stamp it `status: dropped`, which frees its
     tasks, an incomplete one with its incomplete line first; one that has run (a `## Leg log` counts), wait for it
     or /thread:status then /thread:repair. Then 2c (above). Else U empty -> `none`, exit 0.
  3. U is exactly one interrupted pair {P, N} and N is this project's: with --regenerate `interrupted P N`,
     exit 0; without, `refuse P,N` (sorted), exit 3, and stderr says N is incomplete.
  4. U is one note X: eligible with --regenerate -> `supersede X`, exit 0 (an incomplete X WARNs that this
     run finishes it). This project's, not eligible (it has run and is not paused), not incomplete, not
     pausing (`pause_requested`) and at protocol_version 5 -> `join X`, exit 0, with or without --regenerate
     (ADR 0078 d6: this run adds its tasks to X's queue in place, reconcile-rollout.py join; a join is no
     refusal, so it prints no `this run would have taken` line); with --regenerate it first WARNs `WARN:
     --regenerate not applied: [[X]] has run and is not paused (<why>), so this run joins its queue (ADR 0078
     d6): to supersede it, pause it first (execute § Pausing), then re-run with --regenerate`. Otherwise
     `refuse X`, exit 3, with the remedy for its case (incomplete: the
     incomplete line; eligible: re-run with --regenerate, and for one awaiting sign-off (below) the
     waiting tasks carry still gate-pending, or sign off, then /thread:execute; this project's, pausing: let
     it drain, then --regenerate once its `paused:` stamp lands, or /thread:status; this project's, has run,
     not paused, below protocol 5 (the protocol migration): let it finish, pause it, or hard-pause it, then
     --regenerate, or /thread:status then /thread:repair; another project's: wait, or /thread:status then
     /thread:repair; another project's
     awaiting sign-off: it waits only on Lachy's sign-off of its waiting tasks: sign off each gate, then
     /thread:execute (it runs them and closes), or /thread:repair to defer them, then /thread:execute
     closes it).
  5. Two or more -> `refuse <a>,<b>,…` (sorted), exit 3; stderr lists each with its project and state, the
     incomplete line for each pair among them and for each other incomplete note (another project's note:
     finish it with /thread:schedule <its project> --regenerate), and /thread:repair for a candidate named
     by the `supersedes:` of a note that has run.

Serial mode (`--shape serial`, one call per chain, its tokens as repeatable `--surface` and its checkouts, serial-
chains.py's chain `checkouts`, as repeatable `--checkout`): no `file`, `supersede` or `interrupted` outcome; with
--regenerate, `WARN: a serial run supersedes nothing (ADR 0040, p24-2): --regenerate ignored`. A live serial note is
never a hit (ADR 0067 d4: predicted claims order and wait, they never refuse a schedule); for each one (any project),
the first that applies: a --surface token overlapping its hold (above) WARNs `WARN: [[s]] (<label>; <state>) also
predicts <b>, which this chain predicts as <a>: they take turns on it by rank (ADR 0067 d4, d9)`
(a copy chain's done row holds its place until leg.py land puts it on the primary's default branch, so the one that goes
second begins with that work: ADR 0067 d3); one overlapping only
what a stuck one released WARNs as 2b does; else, when it works in place (no `chain_copies:`: the chain scheduled now
always gets its Chain copies at S5), turn(--surface) and --checkout meeting its U (a stuck
chain's is empty) WARN `WARN: [[s]] (<label>; <state>) works <checkout> in place too, with no Chain copy: the two work
it a chain at a time: the one that comes first (by rank: a chain that has begun before one that has not, then estate
rank, then the first to begin, else by slug) lands every unlanded row it has there
before the other begins a Leg in it`, as contend's checkout half makes them at Leg begin. Hits are every parallel candidate (root-level, unfinished, not complete, any project) whose
Project root's token overlaps a --surface or --checkout token (a missing Project root WARNs as above and is not
counted), so a chain that names no file in a checkout still refuses beside a parallel rollout rooted there
in place; a released parallel rollout is no hit, with `WARN: [[x]] (<label>; <why>) is released (ADR 0060): …`. Hits ->
`refuse <sorted>`, exit 3, one stderr line each naming the note, its project, its state, the overlapping pair and its
remedy; none -> `none`, exit 0. It reads notes (and a parallel candidate's Run record), and runs git only for the
nested-checkout rule and the launch folders' checkouts.

Resume mode (`--resume <slug>`, ADR 0060 d3, ADR 0067 d4; leg.py begin and status, and execute § 4.5's *Surface
re-check*): what a resuming rollout writes, as --surface tokens (serial: leg.py's write_set, ws(R)) or --repo's token
(parallel), against the others. The named note itself is skipped, and --project/--tasks are optional (they only set
`mine`). A parallel resume meets every other unfinished serial note's rows not yet done, their surfaces in any state
(never its whole claim, never its smoke rows, never a Chain copy's done row awaiting leg.py land: the parallel
rollout's clone integrates through origin, which that land never reaches, ADR 0067 d3): `[[<s>]] (<label>; <state>) holds `<token>` for an unlanded row, which this rollout
writes as `<token>` (ADR 0060): [[<slug>]] waits its turn: …`. A serial resume R reads its own chain through leg.py
first (a chain unreadable there is exit 2, so leg.py's re-check fails closed) and meets each other unfinished serial
note H by serial_waits: own(C) is a chain's unlanded rows' tokens (its rows not done, and in Chain copies its done
rows not yet landed: hold_of's `unlanded`), smoke(C) = ws(C) − own(C), the order key is leg.py's order_key, rank-led
(ADR 0067 d9: a chain that has begun before one that has not, a stamp that will not parse reading as never begun; then
its estate rank, a stamped chain before an unstamped one, a later pass first, the lower n first; then its first
`began:` stamp, or for a never-begun chain the earlier `captured:`; then the case-folded slug), and contend(X, Y) =
own(X) meets own(Y) or, unless both chains work in Chain copies (`chain_copies:` on both notes: they share no index or
HEAD, so they meet only file to file), T(X) meets U(Y). Between two copied chains a code file (a `repo:`-`repo:` pair)
meets at claim, by rank, while its holder has an open Leg (ADR 0067 d9; leg.py's *The rank*), so (M)'s file half and
(O)'s own-own meeting count only a pair where not both tokens are `repo:` (vault, `ext:` and `any` keep their begin
waits), and (O) gains its holder half: H has no open Leg, so it is not running and never waited on at claim, and the
code tokens of own(R) (serial-chains.py's rank_tokens) meet holding(H), its rows in progress and its done rows not yet
landed (hold_of's `holding`, the tokens claim reads), on a `repo:`-`repo:` pair. R waits on the first rule that applies: (M) H has an open Leg, and T(R) (with --checkout) meets OL(H),
T(H) and its open Leg folder's checkout: `[[H]] (…) holds `repo:<top>` with its open Leg <n>, where this chain's next
Leg works as `<a>` (ADR 0067 d4: a chain works it in place): [[R]] waits its turn: re-run once [[H]]'s Leg <n> closes`
(skipped when both work in Chain copies), or
ws(R) meets what that Leg writes (its write set and the next one's): `… with its open Leg <n>, which this chain writes
as `<a>` (ADR 0060): …`; (T) R itself has an open Leg (a take-over): only (M) applies; (O) H sorts before R and
contend(R, H): `[[H]] (…) holds `<b>` for an unlanded row and began first, which this chain writes as `<a>` (ADR 0067
d4): …`, `ranks above (estate rank <n>)` when the rank decides, `was scheduled first` for an earlier `captured:`, or
`comes first by slug (neither has begun)` or `(both began at the same stamp)` in place of `began first` when slug order
breaks a tie (leg.py's first_by), `<b>` `repo:<top>` for a checkout-level hit; the holder half's line reads `[[H]] (…)
holds `<b>` for an unlanded row and <first_by>, and has no open Leg to finish or land it, which this chain writes as
`<a>` (ADR 0067 d9): …` (H's row is own(H) until it is done and, in
Chain copies, until leg.py land puts it on its primary's default branch (ADR 0067 d3), so R begins with that work in its
copy: begin's fast-forward brings it, or the land it runs before its first claim); (Y) ADR 0060's yield, smoke(R)
meets own(H):
toward an H that sorts first always, toward a later H only when H is free (it waits on no chain, R included, by (M),
(O), a (Y) toward an earlier chain or an unreadable note): today's line, `… holds `<token>` for an unlanded row, which
this chain writes as `<token>` (ADR 0060): …`. An unreadable H holds its whole claim against ws(R) and T(R), whatever
the order (fail closed). No cycle forms, for any number of chains (serial_waits says why): (O) and an earlier-ward (Y)
point down the order (the holder half included), a later-ward (Y) lands only on a free chain, and (M) only on an open
Leg. When R does not yield to a later H that is not free, R goes first, and H, once free, waits on R's open Leg by
(M)'s file half, or, two copied chains on a code file, at claim by rank (ADR 0067 d9). ADR 0060's yield is decided
here, at begin, ahead of rank: rank orders only the claims after begin.
A serial resume then meets every unfinished, not complete parallel rollout's Project root that ws(R) or T(R) meets,
unless parallel_hold reads it released, or idle (nothing running, integrating or awaiting Integration) and paused
(`paused:` or `pause_requested`) or with an open halt in its Run record: a call still in flight after a halt or in a
pause's drain writes the root, so a rollout with one holds it (`… holds `<token>`, its Project root, …`). An idle surface
wait holds nothing against a chain that reads the marker (parallel_hold's release: it launches nothing until its own
check passes, and its check waits on that chain, so no cycle forms). The legacy reader rule (P41-3): a resuming chain
stamped with an engine snapshot from before P41-3 (legacy_engine: its snapshot's unfinished-rollout.py lacks the text
`--surface-wait`, SURFACE_WAIT_PROBE, or will not read) reads each parallel rollout by the old rule (parallel_hold's
marker=False), as its own begin does, so no reader frees a chain its own begin would refuse. Every line
keeps `holds `<token>``, which leg.py reads. A parallel resume (ADR 0064, clone_holders) also meets another project's
parallel rollout in its own clone: one
that is unfinished, not complete and has run (not never started), in no `supersedes:` link with this note, whose
Project root's checkout is --repo's, and that wins the tie (this rollout has not run, or the other's Run record began
earlier, its first line's ts; ties and unreadable records break by slug order): ``[[x]] (<label>; <state>) holds
`repo:<clone>`, its Project root, which this rollout writes as `repo:<clone>` (ADR 0064): [[me]] waits its turn: two
projects' rollouts never share a clone: /thread:schedule <me's project> --regenerate moves it to its own clone``; with
no --project or --tasks (execute's call), `mine` is the resuming note's own `projects:`. None -> `none`, exit 0. No `file`, `supersede` or `interrupted` outcome, and --regenerate WARNs and is ignored.
Whoever released a place yields it to a chain free to run, so a chain scheduled on a stuck chain's released place
never waits on that chain for it (nor for their checkout: a stuck chain works none), only for a place it still holds.
Like the serial check, it runs git only for the nested-checkout rule and the launch folders' checkouts.

    hold --rollout <slug> [--tasks-dir <dir>]

`hold` (read-only, for /thread:status § 4 and § 5): one JSON line, keys in this order: {"rollout", "shape", "scope",
"why", "held", "released"}, tokens in canonical text. Serial: scope `whole` or `stuck`, the hold above. Parallel: scope
`released` (held [], released [its root's token]) or `whole` (held [its root's token]), why parallel_hold's. A done or
dropped note, a complete one, or a parallel one with no Project root: scope `none`, held []. WARN lines go to stderr.
Exit 2 (no stdout, one `unfinished-rollout:` line): no note at `<tasks dir>/<slug>.md`, or a script unloadable.

    clone --repo <Local:> --project <name|slug> [--tasks <a,b>] [--tasks-dir <dir>]

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
2 on a usage error (no line). A named task whose note name is not a slug (project_slug would change it: spaces,
capitals, `_`, `.`) takes no branch git would make, and a refused branch never arms its task window (the 2026-11-02
halt, p47-6): it is checked for nothing else and gets one `unslug [[<task>]] <its project_slug>` line, the slug to
rename the note to, in its place in the order.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py running [--tasks-dir <dir>]

`running` answers primary-hold.sh (ADR 0031 says why): a live rollout note tagged `rollout` at the protocol
the schedule template writes, neither `done` nor `dropped`, not `paused:`, started (reconcile-rollout.py's
approved_unrun is false: never_started, widened for an approved queue whose only marks are the Stage's ended room stops)
and with no `engine_snapshot:` stamp is RUNNING. A stamped note runs on its own Engine
snapshot, never on the Primary checkout, so it holds nothing (ADR 0043; skills/_shared/engine-snapshot.md); only a
rollout scheduled before P29 (or on a version-cache install) still does, until its next Reinstate or Leg begin stamps
it. Nor is a serial note whose chain ADR 0060 decision 1 reads as stuck (leg.py's chain_read state `stuck`) with no
Queue row `running`: it has no Leg open and uses no index or HEAD, so it holds nothing on the Primary checkout (ADR
0066's 2026-11-05 amendment); a stuck chain with a row in progress, or a stuck parallel rollout, still runs. A chain
leg.py cannot read (leg.py will not load, or chain_read raises) is counted as running, with `WARN: <slug>: its chain is
unreadable (<why>): counted as running` on stderr. stdout: `running <slug>` per rollout,
sorted, or `none` (a missing tasks dir included); exit 0.

Surface wait (`check --shape parallel --repo <path> --resume <slug> --surface-wait --running <slugs>`, P41-3; execute
§ 4.5 *Surface re-check*, its only caller): the resume check above, which owns the rollout's surface-wait marker,
~/.config/thread/leases/<slug>.surface-wait.json (reconcile-rollout.py's _surface_wait_path; only this check writes
and deletes it). --running is required (the lead's live task-call and seeded-revise slugs, comma-separated, `""` when
none): without it, or with --surface-wait off a parallel --resume, or --running without --surface-wait, exit 2 before
anything loads, the marker untouched. Its run order (surface_wait_check): validate the flags; load reconcile-rollout.py;
check's own validation; resolve, read the old `since`, delete the marker (a delete that fails is exit 2); arm the deadline
($THREAD_SURFACE_CHECK_DEADLINE, default 240 s; SIGALRM, SurfaceDeadline); compute; disarm, then write and exit. A
refusal is exit 3 and writes the marker {rollout, written_at, since, why `[[<first>]] writes <token>`, holders, live},
`since` carried over from a standing marker, `live` --running's entries as `next --running` reads them (a wikilink
stripped to its slug, lowercased); a run its deadline cut is exit 4, stdout `unanswered`, and writes it with why
`surface re-check unanswered after <d> s`; a pass is exit 0, `none`, the marker gone. Exit 5: a refusal while a serial
chain on an engine snapshot from before P41-3 (legacy_engine) reaches the root (legacy_reach: every place a Leg it may
still begin can reach, erring wide), since such a chain reads no surface wait: no marker, the refuse line and holder
lines, then one `legacy: [[<c>]]: <why>: it reads no surface wait, so this rollout halts as before P41-3 (ADR 0043, ADR
0060 d5)` line per such chain; execute halts on it as before. A marker it cannot write is exit 2.

Output (check). stdout is exactly one line on exit 0, 3, 4 and 5: `none` | `supersede <slug>` | `interrupted <prior-slug>
<new-slug>` | `file <slug> <relpath>` | `join <slug>` (exit 0, outcome 4: this project's running rollout, joined; with
--regenerate, its `--regenerate not applied` WARN on stderr) | `refuse <slug>[,<slug>…]` | `unanswered` (exit 4,
--surface-wait only). Slugs are filename stems; an unfinished
note is root-only, so `<tasks dir>/<slug>.md` is exact. `WARN:` lines go only to stderr and never change
stdout or the exit code. Exit 2 prints no stdout and one `unfinished-rollout:` stderr line: a missing or
non-directory --repo, --repo with serial or --surface or --checkout with parallel, no --surface with serial, a
--surface token parse_token refuses, a relative --checkout, neither or both of --project/--tasks (both, with
--resume), a --tasks note not found, a --resume naming no note directly in the tasks dir, a serial --resume whose
chain leg.py cannot read, a missing tasks dir, reconcile-rollout.py, serial-chains.py or (once an unfinished serial
note is read) leg.py unloadable, or (*Surface wait*) a bad --surface-wait or --running and a marker it cannot write or
delete.

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
gated_inputs.py unloadable (gated_inputs.py is loaded by pickups only).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py unstarted --rollout <slug>
        [--handoffs <dir>]... [--tasks-dir <dir>]

`unstarted` answers close step 2's **Rollouts this session wrote.** for a note with no unwithdrawn handover (ADR 0057
d5): whether the rollout still needs its lead started. Close step 2's **Stale launch.** also runs it, with no
--handoffs, on each pending launch doc's `launches:` value: `closed`, or `started` with the doc 24 h old under the
peer guard, makes that doc stale (ADR 0057 d4). It reads the note (root-first, then under Archive/), its linked
tasks, the Run record (run_record.py's record_path for the slug; an unreadable record reads as none) and the `*.md`
directly in each --handoffs dir; it writes nothing and runs no git. It prints one line, the first that applies:
  closed <slug> (<status>|archived)     the root note is `done` or `dropped`, or the note sits only under Archive/
  serial <slug> (start: unattended)     `shape: serial` stamped `start: unattended` (P44-4), at any Leg: the stamp is
                                        never cleared while the chain is unfinished, so a chain that has already run
                                        reads so too. Its Legs start from the Waiting list on the Chorus Stage; this
                                        line says nothing of whether `waiting` lists it now (a Leg session or a manual
                                        hand-over keeps it off). No handoff is made for it. Never the parallel
                                        `stamped` line below, so a reader that accepts `stamped <slug> (start:
                                        unattended)` (backlog.md § B6 answer 6's supersede) never takes a chain.
  serial <slug>                         any other `shape: serial` note: no handoff is made for it (on the Chorus Stage
                                        its writer lists it; off it, Leg 1 is a paste-ready prompt)
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

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py awaited [--rollout <slug>]...
        [--task <slug>]... [--tasks-dir <dir>]

`awaited` answers close step 2's and next step 1's **Tasks a wait names.** (ADR 0082): whether anything is building
each task a wait names. The awaited tasks are each --task, as given (the waits the session read in THREAD.md or the
conversation), then, per --rollout (a paused rollout the session leads or its THREAD.md names), each wait its
`## Pause log` states and every `depends-on:` / `blocked-by:` entry (reconcile-rollout.py's _dep_entries) of its linked
tasks that have not landed. A Pause log entry (a list item with its continuation lines) states a wait only by a
wikilink a wait phrase introduces (WAIT_PHRASE_RE: `until [[x]]`, `once [[x]]`, `waits on [[x]]`, `waiting for [[x]]`,
a run of links joined by `,`, `&`, `and` or `or` included), so the engine's own lines (a sign-off's `awaiting
sign-off: [[a]] (gate-pending)`, a hard pause's in-flight calls) name no wait. A --rollout's own queue is never a wait:
the rollout itself, one of its linked tasks, or a name a fold tombstone resolves to one of them (a tombstone carries no
`rollout:`, schedule step 4.5), and nor is a task its `## Notes` records as `repair: [[<slug>]] deferred` (repair § 5:
his decline, which a later read must not undo). Each is followed through a fold tombstone to the unit that lands it
(_fold_unit), and named once (case-folded), in that order. It reads notes only (one walk of the tasks dir); it writes
nothing and runs no git and no gh. One line per awaited task, the first that applies, `<slug>` the unit's:
  missing <slug>                        no note at the root or under Archive/
  rollout <slug>                        a note tagged `rollout`: close step 2's **Rollouts this session wrote.** reads
                                        a wait on a rollout, never this verb
  landed <slug> (<status>)              reconcile-rollout.py's _landed (done, a carried fix, an approved read-only task)
  scheduled <slug> [[<rollout>]]        its `rollout:` links a live rollout note (schedule step 1's rule,
                                        _live_rollout); ` (paused)` is appended when that rollout carries `paused:`
  building <slug> (status: in_progress) in no live rollout, but `in_progress` (vault-grammar § Statuses: lower-cased,
                                        `-` read as `_`): a session holds it by hand
  held <slug> (hold_until: <pr>)        its frontmatter carries `hold_until:` (vault-grammar § Hold until), read with no
                                        gh call; one with no readable pr reads `(hold_until unreadable: <why>)`
  held <slug> (status: <status>)        any status but `open` (`review`, `blocked`, `parked`, `dropped`, … ; `none`
                                        when it has none)
  held <slug> (archived)                `open`, but not directly in the tasks dir (under Archive/): schedule step 1
                                        never takes it
  held <slug> (not a task)              `open`, but its `tags:` lack `task` (a phase note, a reference note): schedule
                                        step 1 never takes it
  held <slug> (a decisions task)        `open`, but tagged `decisions` (ADR 0037 d5: Lachy decides it at the
                                        Reflection Routine, so schedule step 1 never takes it)
  held <slug> (<why>)                   one that would read `unstarted`, held by a --rollout's held wait: the latest
                                        wait its `## Pause log` states for the unit carries `(held: <why>)` right
                                        after the link (close step 4's held form, `waits on [[<slug>]] (held: not
                                        yet)`, which close sub-step 7.11 writes there); a later plain wait lifts it
  unstarted <slug> (<Project>)          `open`, directly in the tasks dir, tagged `task` and not `decisions`, in no live
                                        rollout, with no hold: schedule step 1 would take it and nothing is building
                                        it; <Project> is its `projects:` names, comma-joined, or `no project`
Exit 0 (no lines when nothing is awaited), or 2 (no stdout, one `unfinished-rollout:` line) on a usage error (neither
--rollout nor --task), no tasks dir, a --rollout with no note or an unreadable one, or reconcile-rollout.py unloadable.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py waiting [--now <iso>] [--tasks-dir <dir>]

`waiting` answers ADR 0076 d3's *which chain starts next* for the whole estate (CONTEXT.md **Waiting list**), read-only,
for the Chorus Stage and a terminal alike. It runs in one process, never a child per chain (begin's per-chain surface
re-check, a child each, is what timed out under the 2026-11-06 start-up herd): one walk of the tasks dir (p41-2), one
leg.py read per serial note (chain_read_of), and begin's re-check run in-process per listed chain (serial_resume_hits, the
one copy `check --resume` runs too). It writes nothing and runs git only as the re-check does. --now (an ISO time; a
naive one reads local) is the clock for the Capacity, Away and lease reads; default the clock's now.
- On the list: each root-level serial note neither done nor dropped (one whose rows are all merged too: serial_notes
  drops it with the ceremony WARN, yet its Complete Leg still waits for a place) stamped `start: unattended`
  (reconcile-rollout.py's _start_unattended) whose chain and hold leg.py reads (an unreadable one is WARNed by
  serial_notes and left off, as begin's re-check would fail closed on it), and that has no Leg session and no stop
  needing Lachy: its chain state (leg.py's chain_read) is `not-started`, `ready`, `awaiting-successor` or
  `completable` (leg.py's WAITING_STATES), so never `paused`, `halted`, `restarting`, `live`, `stopped`, `stalled`,
  `stuck`, `incomplete`, `superseded`, `complete` or `dropped`, but `restarting` on repair's `restart: Leg N listed`
  (P44-4); it has no Leg session (leg.py's leg_session_of: an open Leg, a standing restart `pending` or `started`, a
  last Leg closed with a handoff and no hand-over line yet, `closing Leg N`, or a last Leg handed off to a `started`
  session that has not begun, one whose begin waited included, since begin writes nothing on a begin wait: P41-3); it
  has no manual hand-over standing; and leg.py's restart_of, from the contention-free plan for its next Leg, is a
  finish, claim, wait or complete with no blockedBy (a malformed `chain_copies:` or a missing Chain copy keeps it off).
  leg.py's waiting_listed is this rule's one copy, which begin's begin wait, status and handed read too (their
  `listed`). By the hand-over (ADR 0076 d4 as P44-4 amends it): `hand-over: listed` is on the list, for its next Leg;
  a manual hand-over is off it, since its paste-ready prompt is its one start path, until a Leg begins or repair writes
  `restart: Leg N listed`; a closing Leg is a Leg session, so its successor never opens while its close-outs land.
- Order: leg.py's order_key (rank-led, ADR 0067 d9: a chain that has begun before one that has not, then the estate
  rank, then the first to begin or the earlier `captured:`, then the slug). `rank` is the chain's 1-based place.
- Held (ADR 0076 d2): `held_by` is the first holder, by case-folded slug, that begin's surface re-check would name for
  its next Leg's write set (leg.py's write_set, as surface_recheck passes it, no --checkout): another serial chain by
  serial_waits (over serial_notes, so a chain whose rows are all merged holds nothing), or a parallel rollout's Project
  root that write set or its checkouts meet (a parallel rollout idle in a surface wait holds none, P41-3, unless the
  chain runs an engine snapshot from before P41-3: serial_resume_hits' legacy reader rule); else null (an empty write
  set, a Complete Leg's, is never held). A held chain keeps its place and is passed over.
- Room: the Mac-wide cap in force (reconcile-rollout.py's _capacity_state over capacity.py's read, then _cap_in_force:
  a fresh Capacity's C, else the Trickle, or the Away cap while Away; `cap` {n, by: capacity | trickle | away cap, why:
  the Capacity reading's why when it fell back, or its `maxWhy` when the reading is fresh but capacity_max will not
  resolve, else null}) less `running`: the Mac-wide running Rollout tasks (_running_by_rollout, leases read at --now,
  Leg claims never; under a rollout's surface-wait marker only its calls in flight, reconcile-rollout.py's
  _counted_tasks) plus every root serial note's Leg session, done and dropped ones aside (a Leg counts from its
  start, ADR 0076 d3: leg.py's leg_session_of, an open Leg, a standing restart `pending` or `started`, a closing Leg,
  or a last Leg handed off to a `started` session, one whose begin waited included; a listed restart holds no place),
  floored at 0. An open Leg whose Leg lease reads lapsed at --now (_Leases' Leg rule, the Capacity count's: 90 min
  after its last write, 180 for a waiting one) holds no place: its session died without `leg.py close`, and counting
  it would leave the room 0 until a repair; no lease file, or an unreadable one, still counts. A closing Leg counts
  until LEG_LEASE_LAPSE (90 min) after its `closed:` stamp (close deletes its lease; an unparseable stamp counts), so
  one that died inside /thread:close frees the room, though its chain stays off the list until repair lists it.
stdout is one JSON line, keys in this order: {"room": n, "running": n, "cap": {"n", "by", "why"}, "waiting": [{"slug",
"rank", "held_by", "cwd", "title", "prompt", "harness"}], "next": <slug> | null}; cwd, title, prompt and harness are
restart_of's (the Leg's launch folder, inside its Chain copy in a copy chain), but a Complete Leg's harness, which
restart_of leaves null (anyLaunch: begin takes any), reads `claude`, so every entry names one the Stage can start.
`next` is the first unheld chain, or null when room is 0 or every chain is held. `WARN:` lines (serial_notes', the
re-check's) go to stderr, each once.
Exit 0, or 2 (no stdout, one `unfinished-rollout:` line): a missing tasks dir, a --now that is no ISO time, or
reconcile-rollout.py, serial-chains.py or leg.py unloadable.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py needs-you [--now <iso>] [--gh-bin <gh>]
        [--tasks-dir <dir>]

`needs-you` (p48-1; CONTEXT.md **Needs-you item**) gathers every open stop that is Lachy's alone, across every rollout,
into one list the Chorus Stage opens as one board, so he never visits the rollout notes one by one. Read-only, one
process like `waiting`: one walk of the tasks dir, reconcile-rollout.py's readers in-process, and lead-integrate.py's
Human fix (ADR 0035) loaded in-process only once a parallel set-aside needs it. It runs no git but what
rollout-settings.py's resolve runs and a set-aside's bare-number `pr:` read (below), and gh only for a `hold_until` PR
(--gh-bin, default `gh`, memoised per PR). --now
(an ISO time; a naive one reads local) is the clock for a cool-down and the standing approval's month; default now.
The rollouts read: each rollout note directly in the tasks dir that is neither done nor dropped (rollout_notes, root
only), so an archived rollout, done or not, is never read. In each, its linked tasks (reconcile-rollout.py _scan):
- gate (kind `spend`, `credential` or `irreversible`, gated_inputs.py's gate_kind; any other kind reads `irreversible`,
  fail closed): each bullet of a gate-pending task's `## Gated inputs (awaiting sign-off)`, verbatim (its list marker
  stripped). A spend gate approve-gates --standing would sign never appears: the reading is _approve_standing's, read
  only (the limit, the exposure, a bounce, the gate already in `## Approved gates`, and this month's standing approvals
  on the gate's own limit's month line, summed as _StandingLedger sums them (p48-2), never locked, plus the spend this
  read let through on that line before it). Its ASK why is the item's `detail`. A gate-pending task whose section lists
  no gate (absent, empty or blank lines only, read as approve-gates reads it) is one item, fail closed: approve-gates
  refuses it (`nothing to sign off`), so only he moves it; kind `irreversible`, its `text` saying the section lists no
  gate. Once signed (the task leaves gate-pending) it drops out.
- set-aside (kind `sign-in` when its reason is a Leg preflight's `preflight: <namespace> did not answer`, legs.md §
  Preflight, after the `Set aside by Leg <n> of [[<rollout>]]: ` leg.py set-aside opens it with, else `hands-on`):
  each task set aside at its run or at Integration that only a person moves on. In a parallel rollout that is
  lead-integrate.py's auto_retry_verdict with a non-null humanFix (execute § 6.5 (c): a null one is the lead's own
  retry), over task_inputs read against the rollout's Project root (the lead's `inputs --repo`, as
  reconcile-rollout.py auto-retry reads it: a bare-number `pr:` runs one `git remote get-url origin` there); its
  `act` is humanFix.act and its `detail` humanFix.detail. In a serial chain every such task (no Leg retries one:
  leg.py needs_you's rule), its act `hand back or defer` and its `detail` the note's `## Needs you` question
  (needs_human), when it holds one. `text` is the set-aside reason, the first line of its latest block. Handed back,
  it drops out.
- hold (kind `hands-on`), parallel rollouts only: a rollout's or an unlanded task's `hold_until` that waits on him
  (_resolve_holds' `waits: you`: an unreadable hold, or a PR CLOSED unmerged), act `remove or fix hold_until on
  [[<note>]]`; and each open merge hold in the rollout's Run record (_record_state's `merge` holds: a `--gated`
  merge or a `review required:` PR), act `go ahead or decline the merge`.
Then, outside any rollout: each task directly in the tasks dir, tagged `task`, `status: open` and in no live rollout,
whose `## Left out at schedule` section holds an entry (schedule § Serial path writes one for each row its final S2
JSON's `leftOut` names, whether S3.7's re-run or a later S4 re-run left it out; S6 removes it once the row is
stamped): kind `sign-in`, `text` its latest entry, rollout null, act `sign in, then /thread:orient --steer`.
stdout is one JSON line: {"count": n, "items": [{"kind", "source": gate | set-aside | hold | left-out, "rollout":
<slug> | null, "project", "task": <slug> | null, "text", "act", "detail": <str> | null}], "warns": ["WARN: ...", ...]},
`project` the task's `projects:` names comma-joined (the rollout's when it has none, `no project` with neither). Items
run in rollout order (case-folded slug); within a rollout, its gates and set-asides by task, then its hold_until holds
(the rollout's, then its tasks' by task), then its merge holds by task; the left-out rows come last, by task. `warns`
holds every `WARN:` line, each also on stderr, so a list some note kept partial never reads as all clear, even at
`"count": 0`. A note that cannot be read (an OSError) is one: _scan raises on the first such note anywhere under the
tasks dir, Archive included, not only on a rollout's own tasks, so one unrelated unreadable note leaves every live
rollout's items unlisted, each rollout with its WARN; and each such note directly in the tasks dir has its own WARN,
since an item it holds (a rollout note's, or its left-out row) is not listed either. Exit 0, or 2 (no stdout, one
`unfinished-rollout:` line): a missing tasks dir, a --now that is no ISO time, or reconcile-rollout.py (or, once a
parallel set-aside needs it, lead-integrate.py) unloadable.
"""
import argparse
import importlib.util
import json
import math
import os
import re
import signal
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

DEFAULT_TASKS_DIR = Path(os.path.expanduser("~/repos/obsidian/Work/Tasks"))
RR_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/reconcile-rollout.py"
SC_SRC = Path(__file__).resolve().parent / "serial-chains.py"
GI_SRC = Path(__file__).resolve().parent / "gated_inputs.py"
RUN_RECORD_SRC = Path(__file__).resolve().parent / "run_record.py"
LEG_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/leg.py"
LI_SRC = Path(__file__).resolve().parent.parent.parent / "execute/scripts/lead-integrate.py"
TEMPLATE = Path(__file__).resolve().parent.parent.parent / "schedule/rollout-template.md"
SELF_ROLLOUT_SH = Path(__file__).resolve().parent.parent.parent / "execute/scripts/self-rollout-check.sh"
RR_NAMES = ("Note", "_scan", "_queue_state", "_counts", "_project_root", "_wikilink_slug", "_scalar", "_status",
            "_valued", "never_started", "approved_unrun", "incomplete", "_shape", "SHAPES", "_priority",
            "PRIORITY_WEIGHTS", "_dep_entries", "_fold_unit", "_dep_status", "_live_rollout", "_start_unattended",
            "_record_read", "_stop_state", "_truthy_flag", "_parse_ts", "_share_walks", "_walk_of", "_note_index",
            "_capacity_state", "_cap_in_force", "_away_state", "_running_by_rollout", "_Leases", "_surface_wait_read",
            "_surface_wait_write", "_surface_wait_drop", "_surface_wait_path", "_surface_wait_live",
            "LEG_LEASE_LAPSE",   # leg_session's closing-Leg clock (P44-4), read through LEG.rr
            # needs-you's readers (p48-1)
            "_gated", "_standing_limit", "_ask_why", "_bounce_why", "_month_why", "_StandingLedger", "_norm_gate",
            "_month_line_key",   # each limit's own month line (p48-2)
            "_hold_until", "_resolve_holds", "_record_state", "_pr", "needs_human", "BLOCKED_SECTIONS",
            "GATE_PENDING_SECTION", "APPROVED_GATES_SECTION", "GATE_BOUNCE_SECTION")
SC_NAMES = ("parse_token", "fmt_token", "overlaps", "overlap_pairs", "read_surfaces", "norm_origin", "Git", "repo_parts",
            "checkout_of", "checkouts_of", "read_chain_copies", "rank_tokens", "read_estate_rank")
GI_NAMES = ("sweep", "body_of", "SPEND", "CREDENTIAL", "IRREVERSIBLE")
RUN_RECORD_NAMES = ("record_path",)
LEG_NAMES = ("Chain", "chain_read", "hold_of", "write_set", "write_rows", "Refuse", "order_key", "first_by", "restart_of",
             "leg_outcome", "leg_session_of", "waiting_listed")
CLOSED = {"done", "dropped"}
PICKUP_CAP = 5
UNLANDED = ("queued", "running", "awaiting-integration", "integrating", "set-aside")  # `branches`: not yet merged
SC = None   # serial-chains.py, loaded by cmd_check and cmd_pickups (load_sc)
LEG = None  # leg.py, loaded once the first unfinished serial note is read (load_leg)
LI = None   # lead-integrate.py, loaded by needs-you once a parallel set-aside needs its Human fix (load_li)
LI_NAMES = ("task_inputs", "auto_retry_verdict")
CHAINS = {}  # chain_read_of's reads: one leg.py read per serial note per process (every verb here writes no note)
ENGINES = {}  # legacy_engine's reads: one probe read per distinct Engine snapshot per process, keyed by its path
# The text that marks an engine from P41-3 on (legacy_engine): argparse names this flag in every copy of this script
# from P41-3 on, and no older copy carries it.
SURFACE_WAIT_PROBE = "--surface-wait"
SURFACE_DEADLINE = 240.0   # check --surface-wait's own deadline, seconds ($THREAD_SURFACE_CHECK_DEADLINE)


def die(msg):
    print(f"unfinished-rollout: {msg}", file=sys.stderr)
    sys.exit(2)


class SurfaceDeadline(BaseException):
    """check --surface-wait's deadline cut the computation (exit 4, `unanswered`). A BaseException, never an Exception,
    so the `except Exception` handlers on the check's path (chain_hold, chain_read_of, load_module, reconcile-rollout.py's
    own) never swallow it as an unreadable chain or note: it always reaches surface_wait_check."""


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
    """serial-chains.py: the surface grammar and norm_origin (its one copy). `running` loads it only through leg.py, for
    an unstamped serial note."""
    global SC
    if SC is None:
        SC = load_module("serial_chains", SC_SRC, SC_NAMES, "skills/_shared/scripts/serial-chains.py")
    return SC


def load_leg(rr):
    """leg.py as a module (ADR 0060: a chain's hold is leg.py's hold_of, its one copy), sharing this script's
    reconcile-rollout.py and serial-chains.py. Loaded only once an unfinished serial note is read (by `running`, an
    unstamped one)."""
    global LEG
    if LEG is None:
        LEG = load_module("thread_leg", LEG_SRC, LEG_NAMES, "skills/execute/scripts/leg.py")
        LEG.rr, LEG.sc = rr, load_sc()
    return LEG


def load_li(rr):
    """lead-integrate.py as a module (its auto_retry_verdict is the Human fix's one copy, ADR 0035), sharing this
    script's reconcile-rollout.py. Loaded only once needs-you reads a parallel set-aside."""
    global LI
    if LI is None:
        LI = load_module("thread_lead_integrate", LI_SRC, LI_NAMES, "skills/execute/scripts/lead-integrate.py")
        LI.rr = rr
    return LI


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
    archive, directly in Archive/. A missing folder or an unreadable note yields nothing. Each note is the process's
    one walk's (reconcile-rollout.py's _walk_of, p41-2), read afresh only when that walk did not parse it."""
    folders = (("root", tasks_dir), ("archive", tasks_dir / "Archive")) if archive else (("root", tasks_dir),)
    walked = rr._walk_of(tasks_dir).notes
    for where, folder in folders:
        for path in sorted(folder.glob("*.md")):
            note = walked.get(path)
            if note is None:
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
    """The read a candidate gets: this project's, its label, never started, paused, complete, incomplete, pausing
    (pause_requested) and its protocol_version."""
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
        "pauseRequested": rr._truthy_flag(note.get("pause_requested")),
        "protocol": rr._scalar(note.get("protocol_version")),
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
    read the chain. The hold also carries `ws`, what its next Leg writes (leg.py's write_set for Leg n_next), and
    `wsFolders`, the launch folders of the rows that write set reads (write_rows): ADR 0067 d4's order and interim;
    and `openWs`, what its open Leg writes (write_set for that Leg; [] with none), which serial_waits' (M) meets; and
    hold_of's own `rank`, `captured` (the rank-led order's inputs) and `holding` ((O)'s holder half, ADR 0067 d9); and
    `engineStamp`, the note's `engine_snapshot:` (None when unstamped), which serial_resume_hits reads for the legacy
    reader rule (legacy_engine, P41-3)."""
    leg = load_leg(rr)
    _ctx, chain, read, why = chain_read_of(rr, path, tasks_dir)
    if why is not None:
        return None, why
    try:
        hold = leg.hold_of(chain, read)
        hold["ws"] = leg.write_set(chain, read["n_next"])
        hold["wsFolders"] = [r.folder for r in leg.write_rows(chain, read["n_next"]) if r.folder]
        hold["openWs"] = leg.write_set(chain, hold["open"]["n"]) if hold["open"] is not None else []
        hold["copied"] = copied_of(chain.note, path.stem, [])
        hold["engineStamp"] = rr._scalar(chain.note.get("engine_snapshot")) or None
        return hold, None
    except leg.Refuse as e:
        return None, e.msg
    except Exception as e:  # noqa: BLE001 — any unreadable chain fails closed to its whole claim
        return None, f"{type(e).__name__}: {e}"


def chain_read_of(rr, path, tasks_dir):
    """leg.py's Chain and chain_read for one serial note, read once per process and kept in CHAINS (every verb here
    writes no note, so a second read would read the same, as the shared walk's p41-2 rule): (ctx, chain, read, None), or
    (None, None, None, <why>) when leg.py cannot read the chain. chain_hold and `waiting` read it."""
    key = (os.path.realpath(path), os.path.realpath(tasks_dir))
    if key not in CHAINS:
        leg = load_leg(rr)
        ctx = SimpleNamespace(rollout=path, tasks=tasks_dir, vault=tasks_dir.parent.parent, slug=path.stem,
                              archived=False)
        try:
            chain = leg.Chain(ctx)
            CHAINS[key] = (ctx, chain, leg.chain_read(ctx, chain), None)
        except leg.Refuse as e:
            CHAINS[key] = (None, None, None, e.msg)
        except Exception as e:  # noqa: BLE001 — any unreadable chain fails closed to its whole claim
            CHAINS[key] = (None, None, None, f"{type(e).__name__}: {e}")
    return CHAINS[key]


def serial_notes(rr, notes, tasks_dir, warns, mine, warned, skip=None):
    """The unfinished serial notes: root-level, `shape: serial`, neither done nor dropped, not complete (a complete
    one is dropped with the ceremony WARN, unless its hold's `pending` names a done row not yet landed from its Chain
    copies, ADR 0067 d3: the hold is read first), each with its state, its whole claim (`claim`), what it holds
    (`tokens`: the whole claim, or a stuck chain's unlanded rows' surfaces, ADR 0060), what a stuck one released
    (`released`), its unlanded rows' surfaces in any state (`unlanded`: the rows not done, `undone`, and those `pending`
    rows), the hold's `scope`, and for ADR 0067 d4's order and interim
    its first `began` stamp, its `open` Leg ({n, folder}) and what that Leg writes (`openWs`), its unlanded rows'
    launch `folders`, and what its next Leg writes (`ws`, with those rows' launch folders, `wsFolders`), and for ADR
    0067 d9 its estate `rank`, `captured:` and `holding` (its rows in progress and done rows not yet landed); an
    unreadable chain has none of those but `ws`, its whole claim (`readable` False), with `rank` and `captured` read
    from its frontmatter. Each entry, an unreadable one too, carries `engineStamp`, its `engine_snapshot:` (None when
    unstamped: legacy_engine, P41-3). `skip` names a note left out (a resuming chain's own)."""
    out = []
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) != "serial":
            continue
        if skip is not None and path.stem.lower() == skip.lower():
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        # The hold is read first: a chain whose rows are all done but not yet all landed from its Chain copies (its
        # `pending`, ADR 0067 d3) still holds their cells, so it is no complete note yet.
        hold, why = chain_hold(rr, path, tasks_dir)
        if c["complete"] and (hold is None or not hold["pending"]):
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
        c.update(claim=tokens, tokens=tokens, unlanded=tokens, undone=tokens, pending=[], released=[], scope="whole",
                 why=f"{bad}: read as any, it holds everything" if bad else "", began=None, open=None, folders=[],
                 ws=tokens, wsFolders=[], openWs=[], readable=False, copied=copied_of(note, c["slug"], warns),
                 rank=SC.read_estate_rank(note, rr._parse_ts), captured=rr._scalar(note.get("captured")) or None,
                 holding=tokens, engineStamp=rr._scalar(note.get("engine_snapshot")) or None)
        # The hold is read even when `surfaces:` reads as any: a schedule still meets `any` (tokens, scope whole), but a
        # --resume compares against the unlanded rows' own cells (hold_of reads them apart from the claim, and falls
        # back to the whole claim, `any` here, only on a bad cell), so one hand-edited note never halts every rollout.
        if hold is None:
            unreadable = f"its chain is unreadable ({why}): it holds its whole claim"
            c["why"] = c["why"] or unreadable
            warns.append(f"WARN: {c['slug']}: {unreadable}")
        else:
            if hold["warn"]:
                warns.append(f"WARN: {c['slug']}: {hold['warn']}")
            parse = lambda xs: [SC.parse_token(x) for x in xs]  # noqa: E731
            c.update(unlanded=parse(hold["unlanded"]), undone=parse(hold["undone"]), pending=list(hold["pending"]),
                     began=hold["began"], open=hold["open"], readable=True,
                     folders=[r["folder"] for r in hold["rows"] if r.get("folder")], ws=parse(hold["ws"]),
                     wsFolders=hold["wsFolders"], openWs=parse(hold["openWs"]), rank=hold["rank"],
                     captured=hold["captured"], holding=parse(hold["holding"]))
            if not bad:
                c.update(scope=hold["scope"], why=hold["why"])
                if hold["scope"] == "stuck":
                    c.update(tokens=parse(hold["held"]), released=parse(hold["released"]))
        out.append(c)
    return out


def copied_of(note, slug, warns) -> bool:
    """Whether a serial note works its checkouts in Chain copies (`chain_copies:` present, ADR 0067 d2): two chains that
    both do share no index or HEAD, so they meet only file to file. A malformed key reads as in place, with a WARN."""
    try:
        return SC.read_chain_copies(note) is not None
    except ValueError as e:
        warns.append(f"WARN: {slug}: chain_copies: {e}: read as in place")
        return False


def released_warn(s, claimed) -> str:
    """A stuck chain released what this run claims (ADR 0060)."""
    return (f"WARN: [[{s['slug']}]] ({s['label']}; {s['why']}) released {SC.fmt_token(claimed)}, which this run "
            "claims: it reclaims it on resume and then waits its turn while this run holds it")


def union(*lists):
    """The tokens of several lists, each once, in order."""
    out = []
    for xs in lists:
        out += [t for t in xs if t not in out]
    return out


def turn(xs):
    """ADR 0067 d4, for a chain that works in place: the checkouts a token list names (serial-chains.py's checkout_of of
    each `repo:` token), as bare tokens."""
    return union([c for c in (SC.checkout_of(t) for t in xs) if c is not None])


def launch_checkouts(folders, git, vault):
    """L(folders): the checkouts some launch folders sit in (serial-chains.py's checkouts_of, the vault and a folder in
    no checkout skipped), as bare tokens."""
    return [("repo", p) for p in SC.checkouts_of([], folders, git.toplevel, vault)]


def works_in(s, git, vault):
    """U(s): the checkouts a chain still has work in, its unlanded rows' tokens' and their launch folders'. A stuck
    chain (scope `stuck`) works none: no Leg is open and nothing is claimable, so it uses no index or HEAD (ADR 0060:
    it holds only what it waits on, its unlanded rows' own surfaces)."""
    if s["scope"] == "stuck":
        return []
    return union(turn(s["unlanded"]), launch_checkouts(s["folders"], git, vault))


def next_works(s, git, vault):
    """T(s): the checkouts its next Leg would work in, its write set's and those rows' launch folders'."""
    return union(turn(s["ws"]), launch_checkouts(s["wsFolders"], git, vault))


def legacy_engine(stamp):
    """Whether a serial chain stamped `engine_snapshot: <stamp>` runs an engine from before P41-3, which reads no
    surface-wait marker (ADR 0043: it keeps its snapshot until one of its Legs closes `stopped:`): None (current), or
    why not. An empty or None stamp reads as current (an unstamped chain runs this tree). Otherwise the snapshot's
    skills/_shared/scripts/unfinished-rollout.py (the stamp's realpath, as engine-snapshot.py's real(stamp) reads it) is
    current when the text `--surface-wait` appears anywhere in it (SURFACE_WAIT_PROBE's value: argparse names that flag
    in every copy from P41-3 on, and no older copy carries it); a copy it cannot read is `its engine snapshot <stamp>
    cannot be read (<err>)`, and one without the text `its engine snapshot <stamp> is from before P41-3`. Memoised per
    path in ENGINES."""
    if not stamp:
        return None
    path = Path(os.path.realpath(os.path.expanduser(stamp))) / "skills/_shared/scripts/unfinished-rollout.py"
    key = str(path)
    if key not in ENGINES:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            ENGINES[key] = f"its engine snapshot {stamp} cannot be read ({e.strerror or type(e).__name__})"
        else:
            ENGINES[key] = None if SURFACE_WAIT_PROBE in text else f"its engine snapshot {stamp} is from before P41-3"
    return ENGINES[key]


def legacy_reach(s, git, vault):
    """Every place a Leg that serial chain s may still begin can reach, by its old begin's per-Leg re-check reach
    (serial_resume_hits' reach on each Leg's write set and launch folders), erring wide: its claim, its unlanded rows'
    tokens and its next Leg's write set, the checkouts each of those names (turn), and the checkouts of every unlanded
    row's and its next Leg's launch folders. An over-reach costs only today's halt (check --surface-wait's exit 5).
    serial_notes fills these keys for an unreadable chain too."""
    return union(s["claim"], s["unlanded"], s["ws"], turn(s["claim"]), turn(s["unlanded"]), turn(s["ws"]),
                 launch_checkouts(list(s["folders"]) + list(s["wsFolders"]), git, vault))


def order_key(rr, slug, began, rank=None, captured=None):
    """ADR 0067 d4's order, rank-led (d9; leg.py's order_key, its one copy, which land's actual-claim check and claim's
    rank read too): a chain that has begun before one that has not, then the estate rank (a stamped chain before an
    unstamped one, a later pass first, then the lower n), then the first to begin (never begun: the earlier
    `captured:`), else by slug. A stamp that will not parse reads as never begun, on either side alike."""
    return load_leg(rr).order_key(slug, began, rank, captured)


def parallel_hold(rr, path, note, linked, marker=True):
    """ADR 0060 d4: whether an unfinished parallel rollout holds its Project root against serial chains. {released,
    why, paused, halt, unreadable, busy, surfaceWait}, by one rule:
    - `marker` False (a reader on an engine snapshot from before P41-3, serial_resume_hits' legacy rule), or no
      surface-wait marker: released when nothing is running, integrating or awaiting Integration, a task is set aside,
      and it awaits sign-off (`paused_for: sign-off`), or it is not paused and its Run record's last open stop is a halt
      whose reason starts `nothing can start` (execute § 7's stuck halt). An unreadable record is not released. `busy`
      counts its tasks running, integrating or awaiting Integration: a call in flight still writes the root after a halt
      or during a pause's drain (check_resume reads it). `surfaceWait` is null.
    - A readable surface-wait marker (reconcile-rollout.py's _surface_wait_read `ok`; execute § 4.5 *Surface re-check*,
      P41-3): busy is its `integrating` tasks plus its `running` ones whose slug the marker's `live` lists (an
      `awaiting-integration` task never counts: `next` holds it); busy > 0 is not released, `<busy> task(s) running or
      in Integration`; busy 0 is released, why `surface wait: <the marker's why>`, whatever is set aside, paused or
      halted. A parallel rollout idle in a surface wait (no call in flight that its marker lists, no task integrating)
      holds no Project root against serial chains that read the marker: it launches nothing until its own Surface
      re-check passes, so no cycle forms.
    - An unreadable marker: the first rule exactly, never released (fail closed). `surfaceWait` is the marker's why,
      or `unreadable: <why>`."""
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
    sw = rr._surface_wait_read(path.stem) if marker else ("none", None, None)
    out = {"released": False, "why": "", "paused": paused, "halt": halt, "unreadable": lines is None, "busy": busy,
           "surfaceWait": None}
    if sw[0] == "ok":
        live = set(rr._surface_wait_live(sw[1]))
        busy = sum(st == "integrating" or (st == "running" and tp.stem.lower() in live)
                   for (tp, _t), st in zip(linked, states))
        why = str(sw[1].get("why") or "a surface wait stands")
        out.update(busy=busy, surfaceWait=why)
        if busy:
            out["why"] = f"{busy} task(s) running or in Integration"
        else:
            out.update(released=True, why=f"surface wait: {why}")
        return out
    if sw[0] == "unreadable":
        out["surfaceWait"] = f"unreadable: {sw[2]}"
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
    if out["released"] and sw[0] == "unreadable":
        out.update(released=False, why=f"{out['why']}, but its surface-wait marker is unreadable ({sw[2]})")
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


def would_take(rr, args, tasks_dir, mine):
    """The refusal's `this run would have taken:` stderr line (ADR 0078 d7), as a list of that one line, [] when the run
    would have taken nothing: --tasks's names, else schedule step 1's filter over --project (`mine`): open task notes
    directly in the tasks dir, tagged `task` and neither `rollout` nor `decisions`, on the project, on no live rollout.
    A task a refusal stops is otherwise named nowhere, so an orient that reports the refusal reports them too."""
    if getattr(args, "tasks", None):
        names = [name for name, _ in named_tasks(rr, args.tasks, tasks_dir)]
    else:
        names = []
        for path in sorted(tasks_dir.glob("*.md")) if mine else []:
            try:
                note = rr.Note(path)
            except (ValueError, OSError):
                continue
            tags = tags_of(rr, note)
            if "task" in tags and not tags & {"rollout", "decisions"} and rr._status(note) == "open" and \
                    projects_of(rr, note) & mine and not rr._live_rollout(tasks_dir, note.get("rollout")):
                names.append(path.stem)
    return [f"this run would have taken: {links(names)}"] if names else []


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
        if args.checkout:
            die("--checkout is the serial check's (a chain's checkouts from serial-chains.py); a parallel check takes "
                "--repo")
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
    checkouts = []
    for v in args.checkout or []:
        p = os.path.expanduser(v.strip())
        if not os.path.isabs(p):
            die(f"--checkout {v}: not an absolute path (a chain's checkout, as serial-chains.py printed it)")
        checkouts = union(checkouts, [("repo", os.path.realpath(p))])

    warns, warned = [], set()
    vault = vault_root(tasks_dir)
    if args.resume is not None:
        toks = surfaces if serial else [path_token(repo, vault)]
        if getattr(args, "surface_wait", False):
            return surface_wait_check(args, rr, tasks_dir, toks, checkouts, vault, warns, warned)
        return check_resume(args, rr, tasks_dir, toks, checkouts, vault, warns, warned)
    if serial:
        return check_serial(args, rr, tasks_dir, surfaces, checkouts, vault, warns, warned)
    env = git_env()
    repo_real = os.path.realpath(repo)
    same_repo, repo_origin = same_repo_rule(rr, repo, env, warns)
    if repo_origin is None:
        warns.append(f"WARN: --repo {args.repo} is not a git repo with an origin here: matched on its path only")

    mine = run_projects(rr, args, tasks_dir, warns)

    def refused(line, errors):
        return finish(warns, line, 3, list(errors) + would_take(rr, args, tasks_dir, mine))

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
            stems = {p.stem.lower() for p in rr._walk_of(tasks_dir).paths}
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

    # 2b. A live serial chain works its checkouts in place: a parallel run rooted there would share their index and
    # HEAD (ADR 0042), so it is refused, before any supersede (a supersede never crosses shapes). What the chain holds
    # meets --repo's token, or the checkouts it still has work in do (U: its unlanded rows' tokens' and launch folders';
    # none for a stuck chain, which uses no index or HEAD).
    repo_tok = path_token(repo, vault)
    git2b = SC.Git()
    top = git2b.checkout
    owners = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned):
        hit = next((tok for tok in union(s["tokens"], works_in(s, git2b, vault)) if SC.overlaps(repo_tok, tok, top)),
                   None)
        if hit is not None:
            owners[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) is a serial chain working "
                                 f"{SC.fmt_token(hit)} in place, where this run would share its index and HEAD (ADR "
                                 f"0042): {serial_remedy(s)}")
            continue
        freed = next((tok for tok in s["released"] if SC.overlaps(repo_tok, tok, top)), None)
        if freed is not None:
            warns.append(released_warn(s, freed))
    if owners:
        keys = sorted(owners, key=str.lower)
        return refused("refuse " + ",".join(keys), [owners[k] for k in keys])

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
            return refused("refuse " + ",".join(keys), lines)
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
        return refused(f"refuse {slugs_of(u)}", [pair_incomplete(p, n)])

    # 4. One unfinished parallel rollout.
    if len(u) == 1:
        x = cands[u[0]]
        if x["eligible"] and args.regenerate:
            if x["incomplete"]:
                warns.append(f"WARN: {x['slug']} is incomplete ({x['incomplete']}): this run supersedes it, "
                             "which finishes it")
            return finish(warns, f"supersede {x['slug']}", 0)
        # This project's running rollout (it has run and is not paused, nor draining a pause, at protocol 5) is joined in
        # place (ADR 0078 d6): no pause, no regenerate. --regenerate is not applied to it, and says so.
        if x["mine"] and not x["eligible"] and not x["incomplete"] and not x["pauseRequested"] and x["protocol"] == "5":
            if args.regenerate:
                warns.append(f"WARN: --regenerate not applied: [[{x['slug']}]] has run and is not paused ({x['why']}), "
                             "so this run joins its queue (ADR 0078 d6): to supersede it, pause it first (execute "
                             "§ Pausing), then re-run with --regenerate")
            return finish(warns, f"join {x['slug']}", 0)
        return refused(f"refuse {x['slug']}", [remedy(x)])

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
    return refused(f"refuse {slugs_of(u)}", lines)


# The works-too WARN, `works <checkout> in place too, with no Chain copy: ` and this tail (ADR 0067 d4, for a chain that
# works the checkout in place): contend's checkout half (serial_waits) serialises chains, not Legs.
ONE_AT_A_TIME = ("the two work it a chain at a time: the one that comes first (by rank: a chain that has begun before one "
                 "that has not, then estate rank, then the first to begin, else by slug) lands every unlanded row it has "
                 "there before the other begins a Leg in it")


def check_serial(args, rr, tasks_dir, surfaces, checkouts, vault, warns, warned) -> int:
    """Serial mode: the chain's tokens (and its checkouts) against every live serial note and every unfinished parallel
    rollout's root. A live chain is never a hit (ADR 0067 d4): a predicted overlap with what it holds WARNs that they
    take turns, one only with what a stuck one released keeps the released WARN (ADR 0060), and a chain working a
    checkout this one works in place (no `chain_copies:`) WARNs that the two work it a chain at a time (ONE_AT_A_TIME; a
    stuck chain works none, works_in; this chain gets its Chain copies at S5). Only a parallel root this chain's tokens or checkouts meet refuses (a released
    parallel rollout holds none). It supersedes nothing; its only git is the nested-checkout read (serial-chains.py's
    Git.checkout) and the launch folders' toplevels."""
    if args.regenerate:
        warns.append("WARN: a serial run supersedes nothing (ADR 0040, p24-2): --regenerate ignored")
    mine = run_projects(rr, args, tasks_dir, warns)
    notes = list(rollout_notes(rr, tasks_dir, archive=False))
    git = SC.Git()
    top = git.checkout
    here = union(turn(surfaces), checkouts)
    hits = {}
    for s in serial_notes(rr, notes, tasks_dir, warns, mine, warned):
        pairs = SC.overlap_pairs(surfaces, s["tokens"], top)
        if pairs:
            a, b = pairs[0]
            warns.append(f"WARN: [[{s['slug']}]] ({s['label']}; {s['state']}) also predicts {SC.fmt_token(b)}, which "
                         f"this chain predicts as {SC.fmt_token(a)}: they take turns on it by rank (ADR 0067 d4, d9)")
            continue
        freed = SC.overlap_pairs(surfaces, s["released"], top)
        if freed:
            warns.append(released_warn(s, freed[0][1]))
            continue
        # A chain in its own Chain copies shares no index or HEAD; the one scheduled now always gets copies at S5.
        shared = [] if s["copied"] else SC.overlap_pairs(here, works_in(s, git, vault), top)
        if shared:
            warns.append(f"WARN: [[{s['slug']}]] ({s['label']}; {s['state']}) works {shared[0][1][1]} in place too, "
                         f"with no Chain copy: {ONE_AT_A_TIME}")
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
        a = next((x for x in union(surfaces, checkouts) if SC.overlaps(x, rtok, top)), None)
        if a is None:
            continue
        ph = parallel_hold(rr, path, note, rr._scan(path, tasks_dir)[0])
        if ph["released"]:
            warns.append(f"WARN: [[{c['slug']}]] ({c['label']}; {ph['why']}) is released (ADR 0060): it holds no "
                         f"Project root against serial chains while it waits, so this chain may write "
                         f"{SC.fmt_token(rtok)}; on resume it waits its turn while this chain holds it")
            continue
        hits[c["slug"]] = (f"[[{c['slug']}]] ({c['label']}; {state_line(c)}) is an unfinished parallel rollout "
                           f"whose Project root {root} ({SC.fmt_token(rtok)}) overlaps this chain's "
                           f"{SC.fmt_token(a)}: wait for it to finish, or /thread:status then /thread:repair")
    if hits:
        keys = sorted(hits, key=str.lower)
        return finish(warns, "refuse " + ",".join(keys), 3,
                      [hits[k] for k in keys] + would_take(rr, args, tasks_dir, mine))
    return finish(warns, "none", 0)


def surface_deadline():
    """$THREAD_SURFACE_CHECK_DEADLINE seconds (default SURFACE_DEADLINE, 240): check --surface-wait's own deadline. A
    value that is not a positive number reads 240."""
    try:
        v = float(os.environ.get("THREAD_SURFACE_CHECK_DEADLINE") or SURFACE_DEADLINE)
    except ValueError:
        return SURFACE_DEADLINE
    return v if v > 0 and math.isfinite(v) else SURFACE_DEADLINE


def _on_deadline(_signum, _frame):
    raise SurfaceDeadline()   # the module-level name, looked up at raise time


def _utc_now_z():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def surface_wait_check(args, rr, tasks_dir, toks, checkouts, vault, warns, warned) -> int:
    """`check --shape parallel --resume <slug> --surface-wait --running <slugs>` (execute § 4.5 *Surface re-check*,
    P41-3): the parallel lead's Surface re-check, which owns the rollout's surface-wait marker (reconcile-rollout.py's
    _surface_wait_path). main has validated the flags, loaded reconcile-rollout.py and cmd_check has run its own
    validation; then, in order: resolve the slug, read the standing marker's `since`, delete the marker (a delete that
    fails is exit 2, `cannot delete <path>: <why>`, before any deadline is armed, so a slow delete never reads as
    unanswered); arm the deadline (surface_deadline(), SIGALRM raising SurfaceDeadline; none without setitimer);
    compute (check_resume(..., collect=True)); disarm (first, in an inner finally, then the old handler back); then
    write and exit:
    - a refusal while a chain on an engine snapshot from before P41-3 reaches the root (`legacy`) -> exit 5, no marker:
      the refuse line and holder lines, then one `legacy: [[<c>]]: <why>: …` line per such chain;
    - a refusal with none -> exit 3: the marker {rollout, written_at, since (the old since, else now), why: `[[<first>]]
      writes <token>`, holders, live (--running's entries, each a wikilink stripped to its slug and lowercased, as
      `next --running` reads them)}, then the refuse line and holder lines;
    - cut by the deadline -> exit 4: the marker, why `surface re-check unanswered after <d> s`; stdout `unanswered`;
    - a pass -> exit 0, `none` (the marker already gone).
    A marker it cannot write is exit 2, `cannot write <path>: <why>`."""
    me = rr._wikilink_slug(args.resume) or args.resume.strip()
    if not me:
        die(f"--resume {args.resume}: no rollout note at {tasks_dir / (me + '.md')}")
    # Each entry as `next --running` reads it: a wikilink stripped to its slug, lowercased (an entry left `[[pt1]]`
    # would never match pt1's stem, so parallel_hold would read its call in flight as none and release the root).
    live = [(rr._wikilink_slug(x) or x.strip()).lower() for x in (args.running or "").split(",") if x.strip()]
    state, data, _why = rr._surface_wait_read(me)
    old = data.get("since") if state == "ok" and isinstance(data.get("since"), str) and data.get("since") else None
    err = rr._surface_wait_drop(me)
    if err:
        die(f"cannot delete {rr._surface_wait_path(me)}: {err}")
    d = surface_deadline()
    armed = hasattr(signal, "setitimer") and hasattr(signal, "SIGALRM")
    result = None
    try:
        prior = None
        try:
            if armed:
                prior = signal.signal(signal.SIGALRM, _on_deadline)
                signal.setitimer(signal.ITIMER_REAL, d)
            result = check_resume(args, rr, tasks_dir, toks, checkouts, vault, warns, warned, collect=True)
        finally:
            if armed:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, prior if prior is not None else signal.SIG_DFL)
    except SurfaceDeadline:
        result = None
    now = _utc_now_z()

    def write(why, holders):
        e = rr._surface_wait_write(me, {"rollout": me, "written_at": now, "since": old or now, "why": why,
                                        "holders": holders, "live": live})
        if e:
            die(f"cannot write {rr._surface_wait_path(me)}: {e}")

    if result is None:
        write(f"surface re-check unanswered after {d:g} s", [])
        return finish(warns, "unanswered", 4)
    line, code, errors, firsts, legacy = result
    if code != 3:
        return finish(warns, line, code, errors)
    holders = line.split(" ", 1)[1].split(",")
    if legacy:
        return finish(warns, line, 5, list(errors) + [
            f"legacy: [[{c}]]: {why}: it reads no surface wait, so this rollout halts as before P41-3 (ADR 0043, ADR "
            "0060 d5)" for c, why in legacy])
    write(f"[[{holders[0]}]] writes {firsts.get(holders[0], '?')}", holders)
    return finish(warns, line, 3, errors)


def check_resume(args, rr, tasks_dir, toks, checkouts, vault, warns, warned, collect=False):
    """`--resume <slug>` (ADR 0060 d3, ADR 0067 d4): what a resuming rollout writes (a serial chain's write set, or a
    parallel rollout's root), against the others. A parallel resume meets every other unfinished serial note's rows
    not yet done (`undone`: a Chain copy's done row awaiting leg.py land holds no parallel rollout, whose clone
    integrates through origin, ADR 0067 d3), their surfaces in any state, and clone_holders. A serial resume R puts fresh contention in a total order
    (order_key, rank-led: a chain that has begun before one that has not, then estate rank, then the first to begin,
    else by slug; ADR 0067 d9), keeps ADR 0060's yield toward a chain free to run, and waits on any
    chain whose open Leg writes a place R's next Leg writes or, unless both work in Chain copies, works a checkout it
    would work in
    (serial_waits: no cycle forms); then every unfinished parallel rollout's root its write set or checkouts meet,
    unless that rollout is released, or idle and paused or halted. Its only git is the nested-checkout read
    (serial-chains.py's Git.checkout) and the launch folders' toplevels. `collect` (check --surface-wait's compute,
    P41-3) returns (line, code, errors, firsts, legacy) instead of printing: `firsts` maps each hit to its token (a
    serial hit's held token, a clone holder's `repo:<clone>`), and `legacy` is [(slug, why)] for each other unfinished
    serial note on an engine snapshot from before P41-3 (legacy_engine) whose legacy_reach meets this rollout's root,
    read only for a parallel resume under --surface-wait."""
    me = rr._wikilink_slug(args.resume) or args.resume.strip()
    if not me or not (tasks_dir / f"{me}.md").is_file():
        die(f"--resume {args.resume}: no rollout note at {tasks_dir / (me + '.md')}")
    if args.regenerate:
        warns.append("WARN: --resume re-checks a resuming rollout and supersedes nothing: --regenerate ignored")
    mine = run_projects(rr, args, tasks_dir, warns) if (args.project is not None or args.tasks is not None) else set()
    notes = list(rollout_notes(rr, tasks_dir, archive=False))
    git = SC.Git()
    top = git.checkout
    hits, firsts, legacy = {}, {}, []
    if args.shape == "serial":
        hold, why = chain_hold(rr, tasks_dir / f"{me}.md", tasks_dir)
        if hold is None:
            die(f"--resume {me}: its chain is unreadable ({why}): the re-check fails closed")
        hits.update(serial_resume_hits(rr, me, hold, toks, checkouts, notes, tasks_dir, git, vault, mine, warns,
                                       warned))
    else:
        serials = serial_notes(rr, notes, tasks_dir, warns, mine, warned, skip=me)
        for s in serials:
            # Only its rows not yet done: a Chain copy's done row awaiting leg.py land holds no parallel rollout, whose
            # clone integrates through origin, which that land never reaches (ADR 0067 d3).
            pairs = SC.overlap_pairs(toks, s["undone"], top)
            if pairs:
                a, b = pairs[0]
                firsts[s["slug"]] = SC.fmt_token(b)
                hits[s["slug"]] = (f"[[{s['slug']}]] ({s['label']}; {s['state']}) holds `{SC.fmt_token(b)}` for an "
                                   f"unlanded row, which this rollout writes as `{SC.fmt_token(a)}` (ADR 0060): "
                                   f"[[{me}]] waits its turn: re-run once [[{s['slug']}]] lands its rows there "
                                   f"({serial_remedy(s)})")
        hits.update(clone_holders(args, rr, tasks_dir, me, mine, toks[0], notes, vault, warns, warned, firsts))
        if getattr(args, "surface_wait", False):
            # A chain on an engine snapshot from before P41-3 reads no surface wait, so while one reaches this root a
            # refusal halts as before (exit 5): the old rule skips a halted, idle rollout, so no cycle forms.
            for s in serials:
                why = legacy_engine(s["engineStamp"])
                if why is not None and any(SC.overlaps(x, toks[0], top) for x in legacy_reach(s, git, vault)):
                    legacy.append((s["slug"], why))
    if hits:
        keys = sorted(hits, key=str.lower)
        line, code, errors = "refuse " + ",".join(keys), 3, [hits[k] for k in keys]
    else:
        line, code, errors = "none", 0, []
    if collect:
        return line, code, errors, firsts, legacy
    return finish(warns, line, code, errors)


def serial_resume_hits(rr, me, hold, toks, checkouts, notes, tasks_dir, git, vault, mine, warns, warned,
                       serials=None, parallels=None) -> dict:
    """A serial resume R's holders, {slug: line} (check_resume's serial half, its one copy, which `waiting` runs per
    listed chain in-process): every other unfinished serial note by serial_waits, then every unfinished, not complete
    parallel rollout whose Project root R's write set (`toks`), its launch folders' checkouts, the checkouts its tokens
    name or --checkout meet, unless parallel_hold reads it released (a rollout idle in a surface wait included, P41-3),
    or idle (nothing running, integrating or awaiting Integration) and paused or halted. The legacy reader rule
    (P41-3): R stamped with an engine snapshot from before P41-3 (legacy_engine of the hold's `engineStamp`, a snapshot
    it cannot read included) reads each parallel rollout by the old rule, never the marker's release
    (parallel_hold(..., marker=False)), since its own old begin reads no marker: so no reader (begin's re-check, `check
    --resume`, leg.py status's restart, the Waiting list) frees a chain that its own begin would refuse. `serials`
    (serial_notes over `notes`, all of them) and `parallels` (parallel_roots over `notes`) are read once by a caller
    that re-checks many chains; R's own entry is skipped in each."""
    top = git.checkout
    legacy = legacy_engine(hold.get("engineStamp")) is not None
    hits = serial_waits(rr, me, hold, toks, checkouts, notes, tasks_dir, git, vault, mine, warns, warned, serials)
    reach = union(toks, launch_checkouts(hold["wsFolders"], git, vault), turn(toks), checkouts)
    if parallels is None:
        parallels = parallel_roots(rr, notes, tasks_dir, vault, mine, warns, warned)
    for c, rtok, path, note in parallels:
        if c["slug"].lower() == me.lower():
            continue
        a = next((x for x in reach if SC.overlaps(x, rtok, top)), None)
        if a is None:
            continue
        ph = parallel_hold(rr, path, note, rr._scan(path, tasks_dir)[0], marker=not legacy)
        # Skipped only while it writes nothing: released (one idle in a surface wait included: it launches nothing until
        # its own Surface re-check passes, P41-3), or idle and paused or halted (one halted by its own entry re-check
        # launched nothing, so the chain it waits on never waits on it). A call still in flight after a halt, or in a
        # pause's drain, writes the root, so a rollout with one holds it. A chain on an engine snapshot from before
        # P41-3 reads no marker (marker=False), as its own begin does.
        if ph["released"] or (ph["busy"] == 0 and (ph["paused"] or ph["halt"] is not None)):
            continue
        hits[c["slug"]] = (f"[[{c['slug']}]] ({c['label']}; {state_line(c)}) holds `{SC.fmt_token(rtok)}`, its "
                           f"Project root, which this chain writes as `{SC.fmt_token(a)}` (ADR 0060): [[{me}]] waits "
                           f"its turn: re-run once [[{c['slug']}]] finishes or stops (/thread:status [[{c['slug']}]])")
    return hits


def parallel_roots(rr, notes, tasks_dir, vault, mine, warns, warned):
    """[(state, Project root token, path, note)] for each unfinished, not complete parallel rollout in `notes` that has
    a Project root: what a serial resume's write set may meet (serial_resume_hits)."""
    out = []
    for path, note, _ in notes:
        if rr._status(note) in CLOSED or shape_of(rr, path.stem, note, warns, warned) == "serial":
            continue
        c = note_state(rr, path, note, tasks_dir, mine)
        root = rr._project_root(note)
        if c["complete"] or root is None:
            continue
        out.append((c, path_token(root, vault), path, note))
    return out


def serial_waits(rr, me, hold, toks, checkouts, notes, tasks_dir, git, vault, mine, warns, warned,
                 serials=None) -> dict:
    """A resuming chain R against every other unfinished serial note H (ADR 0067 d4), {slug: line}; each line keeps
    `holds `<token>``, which leg.py's HELD_RE reads. own(C) is a chain's unlanded rows' tokens, ws(R) its write set
    (--surface), smoke(C) = ws(C) - own(C), U and T the checkouts it has work in and its next Leg works in
    (works_in, next_works; R's T also takes --checkout; a stuck chain's U is empty), H < R when order_key(H) <
    order_key(R) (rank-led, ADR 0067 d9), and contend(X, Y) = own(X) meets own(Y) or, unless both work in Chain copies
    (`copied`: they share no index or HEAD), T(X) meets U(Y). Between two copied chains a code file meets at claim, by
    rank, while its holder has an open Leg, so their file meetings here count only a pair where not both tokens are
    `repo:` (meet_off_repo), and (O) gains its holder half (holder_half). X waits on Y by
    the first of these that applies (wait_on):
      (M) Y has an open Leg, and T(X) meets OL(Y), Y's T and its open Leg folder's checkout (two Legs never commit in
          one index or HEAD at once; skipped when both work in Chain copies), or ws(X) meets what that Leg writes
          (OW(Y): openWs and ws, so two Legs never write one place at once);
      (T) X has an open Leg itself (a take-over): only (M), since its open Leg already holds its checkouts' turn;
      (O) Y < X and contend(X, Y), or, both copied, Y has no open Leg and own(X)'s code tokens meet holding(Y), Y's rows
          in progress and done rows not yet landed (the holder half: Y is not running, so claim never waits on it);
      (Y) ADR 0060's yield, smoke(X) meets own(Y): toward an earlier Y always; toward a later Y only when Y is free,
          waiting on no chain by (M), (O), a (Y) toward an earlier chain or an unreadable note, so a yield always
          lands on a chain that can run (R yields to a free H; else R goes first, and H, once free, meets R's open
          Leg by (M)'s file half). Between two copied chains a `repo:` pair with a bare toplevel on either side never
          meets here (meet_yield, ADR 0075 d4): a whole-checkout cell stands only an in-place peer.
    An unreadable Y holds its whole claim against ws(X) and T(X), whatever the order (fail closed), and is a sink: it
    cannot begin. No cycle forms, for any number of chains: (O) and an earlier-ward (Y) point down the total order;
    a later-ward (Y) lands only on a free chain, whose own waits can only climb on, so no path that climbs turns
    back down; and (M) lands only on an open Leg, whose chain waits only by (M), and between two open Legs only from
    the one opened first, since the later begin passed (M) against it and a chain's write set and checkouts only
    shrink as its rows land. The holder half is an edge of (O), down the order, so this argument covers it as it
    stands, and a chain it holds is no free chain to yield to. `serials`: serial_notes over `notes`, read once by a
    caller that re-checks many chains (serial_resume_hits); R's own entry is skipped."""
    top = git.checkout
    meet = lambda a, b: (SC.overlap_pairs(a, b, top) or [None])[0]  # noqa: E731
    parse = lambda xs: [SC.parse_token(x) for x in xs]  # noqa: E731

    def chain_of(slug, readable, own, ws, open_, open_ws, t, u, began, s, copied, rank, captured, holding):
        out = {"slug": slug, "readable": readable, "own": own, "ws": ws, "smoke": [x for x in ws if x not in own],
               "T": t, "U": u, "key": order_key(rr, slug, began, rank, captured), "open": open_, "s": s, "OL": [],
               "OW": [], "copied": copied, "holding": holding}
        if open_ is not None:
            out.update(OL=union(t, launch_checkouts([open_["folder"]], git, vault)), OW=union(open_ws, ws))
        return out

    own_r, ws_r = parse(hold["unlanded"]), list(toks)
    u_r = [] if hold["scope"] == "stuck" else \
        union(turn(own_r), launch_checkouts([r["folder"] for r in hold["rows"] if r.get("folder")], git, vault))
    t_r = union(turn(ws_r), launch_checkouts(hold["wsFolders"], git, vault), checkouts)
    r = chain_of(me, True, own_r, ws_r, hold["open"], parse(hold["openWs"]), t_r, u_r, hold["began"], None,
                 hold.get("copied", False), hold.get("rank"), hold.get("captured"), parse(hold.get("holding") or []))
    others = [chain_of(s["slug"], s["readable"], s["unlanded"], s["ws"], s["open"], s["openWs"],
                       next_works(s, git, vault), works_in(s, git, vault), s["began"], s, s["copied"], s["rank"],
                       s["captured"], s["holding"])
              for s in (serial_notes(rr, notes, tasks_dir, warns, mine, warned, skip=me) if serials is None else
                        [x for x in serials if x["slug"].lower() != me.lower()])]
    chains = [r] + others

    def meet_off_repo(a, b):
        """Two copied chains' file meeting at begin (ADR 0067 d9): the first overlapping pair where not both tokens are
        `repo:` (a vault, `ext:` or `any` meeting), since a code file between two copied chains meets at claim, by
        rank, while its holder has an open Leg."""
        return next((p for p in SC.overlap_pairs(a, b, top) if not (p[0][0] == "repo" and p[1][0] == "repo")), None)

    def whole_checkout(t):
        """A bare `repo:` token that is a checkout's toplevel (the whole checkout), not a path in none."""
        if t[0] != "repo" or SC.repo_parts(t[1])[1] is not None:
            return False
        c = top(t[1])
        return bool(c) and c.casefold() == t[1].casefold()

    def meet_yield(x, a, y, b):
        """ADR 0060's yield meeting, smoke(x)'s tokens a against own(y)'s b: plain meet, save that between two copied
        chains a `repo:`-`repo:` pair with a bare toplevel on either side never meets (ADR 0075 d4): a whole-checkout
        cell stands only an in-place peer, since copied chains share no index or HEAD, and their files meet at claim,
        by rank, and at land. A bare path in no checkout is no Chain copy and still meets."""
        if not (x["copied"] and y["copied"]):
            return meet(a, b)
        return next((p for p in SC.overlap_pairs(a, b, top)
                     if not (p[0][0] == "repo" and p[1][0] == "repo" and (whole_checkout(p[0]) or whole_checkout(p[1])))),
                    None)

    def holder_half(x, y):
        """(O)'s holder half (ADR 0067 d9): y has no open Leg, so it is not running and never waited on at claim; its
        rows in progress and its done rows not yet landed (hold_of's `holding`, the tokens claim reads) hold x's own
        code files, a `repo:`-`repo:` pair of SC.rank_tokens on both sides, until y's next Leg finishes or lands them."""
        if y["open"] is not None:
            return None
        return next((p for p in SC.overlap_pairs(SC.rank_tokens(x["own"]), SC.rank_tokens(y["holding"]), top)
                     if p[0][0] == "repo" and p[1][0] == "repo"), None)

    def wait_on(x, y):
        """Why x waits on y by (M), (O), an earlier-ward (Y) or y's unreadable note: (rule, (a, b)), else None. Two
        chains that both work in Chain copies (`copied`) share no index or HEAD, so their checkout halves are skipped:
        they meet only file to file, and a code file there (a `repo:`-`repo:` pair) meets at claim, by rank, while y
        has an open Leg (ADR 0067 d9): (M)'s file half and (O)'s own-own meeting read meet_off_repo, and (O) gains its
        holder half for a y with no open Leg."""
        both = x["copied"] and y["copied"]
        files = meet_off_repo if both else meet
        if not y["readable"]:
            p = meet(union(x["ws"], x["T"]), y["own"])
            return ("whole", p) if p else None
        if y["open"] is not None:
            p = None if both else meet(x["T"], y["OL"])
            if p:
                return ("M", p)
            p = files(x["ws"], y["OW"])
            if p:
                return ("M-file", p)
        if x["open"] is not None:
            return None
        if y["key"] < x["key"]:
            p = files(x["own"], y["own"]) or (None if both else meet(x["T"], y["U"]))
            if p:
                return ("O", p)
            p = holder_half(x, y) if both else None
            if p:
                return ("O-held", p)
            p = meet_yield(x, x["smoke"], y, y["own"])
            if p:
                return ("Y", p)
        return None

    hits = {}
    for h in others:
        s = h["s"]
        w = wait_on(r, h)
        if w is None and h["readable"] and r["open"] is None and r["key"] < h["key"]:
            p = meet_yield(r, r["smoke"], h, h["own"])
            if p and not any(wait_on(h, k) for k in chains if k is not h):
                w = ("Y", p)
        if w is None:
            continue
        rule, (a, b) = w
        who, a, b = f"[[{h['slug']}]] ({s['label']}; {s['state']})", SC.fmt_token(a), SC.fmt_token(b)
        tail = f"[[{me}]] waits its turn: re-run once [[{h['slug']}]] lands its rows there ({serial_remedy(s)})"
        if rule in ("M", "M-file"):
            n = h["open"]["n"]
            where = (f"where this chain's next Leg works as `{a}` (ADR 0067 d4: a chain works it in place)" if rule == "M"
                     else f"which this chain writes as `{a}` (ADR 0060)")
            hits[h["slug"]] = (f"{who} holds `{b}` with its open Leg {n}, {where}: [[{me}]] waits its turn: re-run "
                               f"once [[{h['slug']}]]'s Leg {n} closes")
        elif rule == "O":
            hits[h["slug"]] = (f"{who} holds `{b}` for an unlanded row and {first_by(rr, h['key'], r['key'])}, which this "
                               f"chain writes as `{a}` (ADR 0067 d4): {tail}")
        elif rule == "O-held":
            hits[h["slug"]] = (f"{who} holds `{b}` for an unlanded row and {first_by(rr, h['key'], r['key'])}, and has no "
                               f"open Leg to finish or land it, which this chain writes as `{a}` (ADR 0067 d9): {tail}")
        else:
            hits[h["slug"]] = (f"{who} holds `{b}` for an unlanded row, which this chain writes as `{a}` (ADR 0060): "
                               f"{tail}")
    return hits


def first_by(rr, key_h, key_r) -> str:
    """Why H sorts before R in ADR 0067 d4's order, rank-led by d9 (order_key): it began first, it ranks above (estate
    rank <n>), it was scheduled first (never begun, the earlier `captured:`), or slug order broke a tie (both began at
    the same stamp, or neither has begun). leg.py's first_by, its one copy."""
    return load_leg(rr).first_by(key_h, key_r)


def first_line_ts(rr, slug):
    """The aware ts of the rollout's Run record's first line, or None (no record, an empty or unreadable one)."""
    lines = rr._record_read(slug)
    return rr._parse_ts(lines[0].get("ts")) if lines else None


def clone_holders(args, rr, tasks_dir, me, mine, tok, notes, vault, warns, warned, firsts=None) -> dict:
    """ADR 0064: a resuming parallel rollout against another project's in the same clone, {slug: line}. A hit is another
    project's unfinished, not complete parallel rollout that has run, with no `supersedes:` link to this one, whose
    Project root's checkout is --repo's, and which wins the tie: this rollout has not run, or the other's Run record
    began earlier (its first line's ts); ties and unreadable records break by slug order. With no --project or --tasks,
    `mine` is the resuming note's own `projects:`. `firsts`, when given, gets each hit's token (`repo:<clone>`)."""
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
        if firsts is not None:
            firsts[c["slug"]] = SC.fmt_token(rtok)
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
    if x["mine"] and x["pauseRequested"]:
        return (f"unfinished rollout [[{s}]] ({x['label']}) is pausing (pause_requested): let it drain; once its "
                "`paused:` stamp lands, re-run with --regenerate to supersede it, or /thread:status "
                f"[[{s}]]")
    if x["mine"]:
        # A note below protocol 5 (execute refuses it): the protocol migration's hard pause, then --regenerate.
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
        if rr._shape(note) == "serial" and _stuck_chain(rr, path, tasks_dir):
            continue   # ADR 0060 d1: no Leg open, no index or HEAD used: it holds nothing on the Primary checkout
        running.append(path.stem)
    print("\n".join(f"running {slug}" for slug in running) or "none")
    return 0


def _stuck_chain(rr, path, tasks_dir) -> bool:
    """Whether an unstamped serial note's chain is stuck by ADR 0060 decision 1's test (leg.py's chain_read reads
    `stuck`, and no Queue row reads `running`), so `running` leaves it out (ADR 0066's 2026-11-05 amendment). A chain
    leg.py cannot read is counted as running, with a WARN: the hold fails closed."""
    ctx = SimpleNamespace(rollout=path, tasks=tasks_dir, vault=tasks_dir.parent.parent, slug=path.stem, archived=False)
    try:
        leg = load_leg(rr)
        chain = leg.Chain(ctx)
        read = leg.chain_read(ctx, chain)
        return read["state"] == "stuck" and not any(r.state == "running" for r in chain.rows)
    except (Exception, SystemExit) as e:  # noqa: BLE001 — any unreadable chain fails closed to running
        why = f"{type(e).__name__}: {e}" if not isinstance(e, SystemExit) else f"leg.py would not load (exit {e.code})"
        print(f"WARN: {path.stem}: its chain is unreadable ({why}): counted as running", file=sys.stderr)
        return False


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
    (reconcile-rollout.py's _note_index, over the process's one walk)."""
    return rr._note_index(tasks_dir)


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
        # Never the parallel `stamped` line: backlog.md's supersede accepts that one (P44-4 review).
        print(f"serial {slug} (start: unattended)" if rr._start_unattended(note) else f"serial {slug}")
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


# ---- the tasks a wait names (ADR 0082) ---------------------------------------------------------------------------------

PAUSE_LOG = "## Pause log"
# A wait a `## Pause log` entry states (the header's awaited table): a wikilink a wait phrase introduces, the phrases
# close step 2 reads in THREAD.md ("until [[x]] lands", "once [[x]] lands", "waits on [[x]]", "waiting for [[x]]"), a
# run of links joined by `,`, `&`, `and` or `or` included. The engine's own lines name the rollout's own tasks with no
# such phrase (a sign-off's `awaiting sign-off: [[a]] (gate-pending), [[b]] (depends on [[a]])`, a hard pause's
# in-flight calls; a room stop holds no link), so a task that leaves the queue is never read from them as a wait.
WAIT_PHRASE_RE = re.compile(r"\b(?:until|once|(?:wait|waits|waiting)\s+(?:on|for))\s+(?=\[\[)", re.I)
# A link with the held wait's mark right after it (close step 4's one held form, `waits on [[x]] (held: <why>)`).
WAIT_LINK_RE = re.compile(r"\[\[([^\]]+?)\]\](?:\s*\(held:\s*([^)]+?)\s*\))?")
WAIT_JOIN_RE = re.compile(r"\s*(?:,|&|\band\b|\bor\b)\s*(?=\[\[)", re.I)
# repair § 5's clean defer, on the rollout's `## Notes`: `- <date> repair: [[<slug>]] deferred: <reason>`, matched on the
# link's target (an alias or a heading after it allowed), as reconcile-rollout.py's RACE_DECIDED_RE matches its line.
DEFERRED_RE = re.compile(r"repair:\s*\[\[([^\]|#^\\]+)[^\]]*\]\]\s*deferred\b", re.I)


def log_entries(text: str):
    """A log section's entries: each list item with its continuation lines, joined by one space."""
    out = []
    for line in text.split("\n"):
        if LIST_LINE_RE.match(line) or not out:
            out.append(line.strip())
        elif line.strip():
            out[-1] = f"{out[-1]} {line.strip()}".strip()
    return [e for e in out if e]


def pause_waits(rr, note):
    """(slug, held) for each wait the note's `## Pause log` states (WAIT_PHRASE_RE), in order; held is the `<why>` of a
    `(held: <why>)` right after the link, else None."""
    out = []
    for entry in log_entries(note.section_text(PAUSE_LOG)):
        for m in WAIT_PHRASE_RE.finditer(entry):
            link = WAIT_LINK_RE.match(entry, m.end())
            while link is not None:
                slug = rr._wikilink_slug(link.group(1))
                if slug:
                    out.append((slug, link.group(2)))
                join = WAIT_JOIN_RE.match(entry, link.end())
                link = WAIT_LINK_RE.match(entry, join.end()) if join is not None else None
    return out


def deferred_out(rr, note) -> set:
    """The lowercased slugs the rollout's `## Notes` records as deferred out of it (repair § 5): his decline."""
    return {(rr._wikilink_slug(m.group(1)) or "").lower() for m in DEFERRED_RE.finditer(note.section_text("## Notes"))}


def awaited_line(rr, tasks_dir: Path, unit: str, entry) -> str:
    """The `awaited` line for one awaited unit (the header's table, first match, a Pause log's held wait aside)."""
    if entry is None:
        return f"missing {unit}"
    path, note = entry
    tags = tags_of(rr, note)
    if "rollout" in tags:
        return f"rollout {unit}"
    status = rr._status(note).replace("-", "_")
    if rr._landed(note):
        return f"landed {unit} ({status or 'none'})"
    if rr._live_rollout(tasks_dir, note.get("rollout")):
        ro = rr._wikilink_slug(rr._scalar(note.get("rollout")))
        try:
            paused = rr._valued(rr.Note(tasks_dir / f"{ro}.md").get("paused"))
        except (OSError, ValueError):
            paused = False
        return f"scheduled {unit} [[{ro}]]" + (" (paused)" if paused else "")
    if status == "in_progress":
        return f"building {unit} (status: in_progress)"
    hold = rr._hold_until(note, None)
    if hold is not None:
        # A readable pr is the hold whatever else its value lacks (a bare number needs the Project root only for gh).
        return f"held {unit} (hold_until: {hold['pr']})" if hold["pr"] \
            else f"held {unit} (hold_until unreadable: {hold['error']})"
    if status != "open":
        return f"held {unit} (status: {status or 'none'})"
    # Schedule step 1's filter: it takes only a note directly in the tasks dir, tagged `task` and not `decisions`.
    if path.parent != tasks_dir:
        return f"held {unit} (archived)"
    if "task" not in tags:
        return f"held {unit} (not a task)"
    if "decisions" in tags:
        return f"held {unit} (a decisions task)"
    return f"unstarted {unit} ({project_label(rr, note)})"


def cmd_awaited(args, rr) -> int:
    if not args.rollout and not args.task:
        die("awaited needs --rollout or --task")
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"no tasks dir at {tasks_dir}")
    index = rr._walk_of(tasks_dir).index

    def unit_of(slug):
        return rr._fold_unit(slug, index)[0].lower()

    named = [s for s in (rr._wikilink_slug(t) for t in args.task or []) if s]
    held = {}  # unit -> why, for each unit a --rollout's Pause log holds (its latest wait line naming it decides)
    for value in args.rollout or []:
        slug = rr._wikilink_slug(value) or ""
        path = find_task(tasks_dir, slug) if slug else None
        if path is None:
            die(f"--rollout {value}: no note at {tasks_dir / (slug + '.md')} or under Archive/")
        try:
            note = rr.Note(path)
            linked, _index = rr._scan(path, tasks_dir)
        except (ValueError, OSError) as e:
            die(f"--rollout {slug}: {e}")
        # Its own queue (a fold tombstone carries no `rollout:`, so a name is checked again once folded) and the
        # tasks deferred out of it are never a wait.
        skip = {slug.lower()} | {p.stem.lower() for p, _n in linked} | deferred_out(rr, note)
        waits = [(s, why) for s, why in pause_waits(rr, note) if s.lower() not in skip and unit_of(s) not in skip]
        latest = {unit_of(s): why for s, why in waits}  # the latest wait line naming a unit decides
        held.update({u: why for u, why in latest.items() if why is not None})
        deps = [d for _p, task in linked if not rr._landed(task) for d in rr._dep_entries(task)]
        named += [s for s, _why in waits] + [s for s in deps if s.lower() not in skip and unit_of(s) not in skip]
    seen = set()
    for slug in named:
        unit, entry, _folded = rr._fold_unit(slug, index)
        if unit.lower() in seen:
            continue
        seen.add(unit.lower())
        line = awaited_line(rr, tasks_dir, unit, entry)
        if line.startswith("unstarted ") and unit.lower() in held:
            line = f"held {unit} ({held[unit.lower()]})"
        print(line)
    return 0


# ---- the Waiting list (ADR 0076) --------------------------------------------------------------------------------------

def leg_session(leg, ctx, chain, read, leases) -> bool:
    """Whether a serial chain's Leg session holds a place in the room (ADR 0076 d3): leg.py's leg_session_of, its one
    copy (an open Leg, a standing restart `pending` or `started`, a closing Leg, or a last Leg handed off to a `started`
    session that has not begun, a session whose begin waited included, P41-3: begin writes nothing; a listed restart
    holds none), but an open Leg whose Leg lease reads lapsed (`leases`, a reconcile-rollout.py _Leases) is none (its
    session died without `leg.py close`: the Capacity count's rule, _running_by_rollout's Leg half, 90 min after the
    lease's last write, 180 for a waiting one, a later boot or wake restarting it); no lease file or an unreadable one
    still counts (a Leg on an older snapshot writes none). A closing Leg (`closing Leg N`, P44-4: closed with a handoff,
    no hand-over line yet) counts only while its `closed:` stamp is within LEG_LEASE_LAPSE (90 min) of leases.now (close
    deleted its lease, so its stamp is the one clock; an unparseable stamp counts), so one that died inside
    /thread:close frees the room; waiting_listed reads no lapse, so its chain stays off the list until repair lists it."""
    if read["open_leg"] is not None:
        return leases.state(ctx.slug, chain.note, leg=True)["state"] != "lapsed"
    session = leg.leg_session_of(chain, read)
    if session is None:
        return False
    if session.startswith("closing Leg "):
        closed = leg.rr._parse_ts(chain.legs[chain.last_n()]["closedStamp"])
        return closed is None or leases.now - closed <= leg.rr.LEG_LEASE_LAPSE
    return True


def now_of(args):
    """--now as an aware datetime (a naive one reads local), else the clock's now; exit 2 on no ISO time."""
    if not args.now:
        return datetime.now().astimezone()
    try:
        now = datetime.fromisoformat(args.now.strip().replace("Z", "+00:00"))
    except ValueError:
        die(f"--now {args.now}: not an ISO time")
    return now if now.tzinfo else now.astimezone()


def cmd_waiting(args, rr) -> int:
    """`waiting` (ADR 0076 d3): the Waiting list and its room, one JSON line (the module docstring)."""
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    now = now_of(args)
    load_sc()
    warns, warned = [], set()
    vault = vault_root(tasks_dir)
    notes = list(rollout_notes(rr, tasks_dir, archive=False))
    # Every root serial note neither done nor dropped, read once: the room counts their Leg sessions, and the list is
    # taken from them. Never from serial_notes, which drops a chain whose rows are all merged (the ceremony WARN), yet
    # such a chain's Complete Leg still waits for a place (a `completable` chain, or one whose last Leg handed off).
    chains = []
    for path, note, where in notes:
        if where != "root" or rr._status(note) in CLOSED or rr._shape(note) != "serial":
            continue
        ctx, chain, read, _why = chain_read_of(rr, path, tasks_dir)
        if read is not None:
            chains.append((path, ctx, chain, read))

    # Room: the cap in force less the Rollout tasks running and every Leg session.
    capacity = rr._capacity_state(now, quota=False)
    cap = rr._cap_in_force(rr._away_state(now), capacity)
    by = "capacity" if cap.get("by") == "capacity" else "away cap" if cap["away"] else "trickle"
    leases = rr._Leases(now)
    tasks = sum(rr._running_by_rollout(tasks_dir, rr._note_index(tasks_dir), leases=leases).values())
    legs = sum(1 for _path, ctx, chain, read in chains if leg_session(load_leg(rr), ctx, chain, read, leases))
    running = tasks + legs
    room = max(0, cap["n"] - running)

    serials = serial_notes(rr, notes, tasks_dir, warns, set(), warned)   # the hold reads only: what may hold a chain
    parallels = parallel_roots(rr, notes, tasks_dir, vault, set(), warns, warned)
    git = SC.Git() if chains else None
    listed = []
    for path, ctx, chain, read in chains:
        restart, _why = load_leg(rr).waiting_listed(ctx, chain, read)   # the list's rule, its one copy (begin's too)
        if restart is None:
            continue
        hold, _why = chain_hold(rr, path, tasks_dir)
        if hold is None:
            continue   # its hold will not read (serial_notes WARNs it): begin's re-check would fail closed on it too
        toks = [SC.parse_token(t) for t in hold["ws"]]
        held = serial_resume_hits(rr, ctx.slug, hold, toks, [], notes, tasks_dir, git, vault, set(), warns, warned,
                                  serials, parallels) if toks else {}
        listed.append((order_key(rr, ctx.slug, hold["began"], hold["rank"], hold["captured"]), ctx.slug,
                       min(held, key=str.lower) if held else None, restart))
    listed.sort(key=lambda x: x[0])
    # A Complete Leg's restart carries no harness (it works no row, so begin takes any): the Stage starts it on claude.
    waiting = [{"slug": slug, "rank": k, "held_by": held_by, "cwd": r["cwd"], "title": r["title"],
                "prompt": r["prompt"], "harness": r["harness"] or "claude"}
               for k, (_key, slug, held_by, r) in enumerate(listed, 1)]
    nxt = next((w["slug"] for w in waiting if w["held_by"] is None), None) if room > 0 else None
    for w in dict.fromkeys(warns):
        print(w, file=sys.stderr)
    why = None if by == "capacity" else capacity["why"] or capacity["maxWhy"]
    print(json.dumps({"room": room, "running": running, "cap": {"n": cap["n"], "by": by, "why": why},
                      "waiting": waiting, "next": nxt}, ensure_ascii=False))
    return 0


# ---- the needs-you list (p48-1) ----------------------------------------------------------------------------------------

# schedule § Serial path's line for a row its final S2 JSON's `leftOut` names (S3.7's re-run or a later S4 re-run)
LEFT_OUT_SECTION = "## Left out at schedule"
# legs.md § Preflight's set-aside reason, `preflight: <namespace> did not answer`, as leg.py set-aside writes it: the
# first line of its Blocker diagnosis run, after its `Set aside by Leg <n> of [[<rollout>]]: ` opening.
PREFLIGHT_SIGN_IN_RE = re.compile(
    r"^(?:Set aside by Leg \d+ of \[\[[^\]]*\]\]:\s*)?preflight:\s*\S+\s+did not answer\b", re.I)
BLOCKER_SECTION = "## Blocker diagnosis"


class StandingRead:
    """approve-gates --standing's spend reading (_approve_standing), read-only: never a lock, a ledger line or a save.
    asks() is None when the standing approval would sign the gate, else its ASK why. The month's standing approvals are
    _StandingLedger's sum for the gate's rollout note (on --dry-run, so unlocked) on the month line of the limit the
    gate resolves (_month_line_key, p48-2: a task stamp's line is that task's own, keyed by its note's slug), plus every
    spend this read already let through on that line, as one approve-gates call adds its own."""

    def __init__(self, rr, tasks_dir, now):
        self.rr, self.gi, self.tasks_dir = rr, rr._gated(), tasks_dir
        self.month = now.astimezone().strftime("%Y-%m")
        self.ledgers, self.added = {}, {}

    def asks(self, note, rollout_path, rollout_note, gate):
        rr, gi = self.rr, self.gi
        limit, err = rr._standing_limit(note, rollout_note)
        if err:
            return err
        verdict = gi.covered(gate, limit["value"])
        if note.has_heading(rr.GATE_BOUNCE_SECTION):
            return rr._bounce_why(verdict, gi)
        if not verdict["covered"]:
            return rr._ask_why(verdict, limit, gi)
        approved = {rr._norm_gate(line) for line in note.section_text(rr.APPROVED_GATES_SECTION).split("\n")
                    if line.strip()}
        if rr._norm_gate(gate) in approved:
            return None
        ledger = self.ledgers.get(rollout_path)
        if ledger is None:
            ledger = self.ledgers[rollout_path] = rr._StandingLedger(self.tasks_dir, rollout_path, self.month, True)
        line_key = rr._month_line_key(limit["source"], note.path.stem, os.path.realpath(str(rollout_path)))
        spent, why = ledger.spent(line_key)
        if why:
            return why
        total = spent + self.added.get(line_key, 0) + verdict["usd"]
        if total > limit["value"]:
            return rr._month_why(self.month, total, limit, gi)
        self.added[line_key] = self.added.get(line_key, 0) + verdict["usd"]
        return None


def set_aside_reason(rr, note) -> str:
    """A set-aside's reason: the first non-empty line of its status's latest block (`## Blocker diagnosis` for a status
    with no section of its own), as leg.py needs_you reads it."""
    text = note.latest_run_text(rr.BLOCKED_SECTIONS.get(rr._status(note), BLOCKER_SECTION))
    return next((line.strip() for line in text.split("\n") if line.strip()), "")


def needs_you_item(kind, source, rollout, project, task, text, act, detail=None):
    return {"kind": kind, "source": source, "rollout": rollout, "project": project, "task": task, "text": text,
            "act": act, "detail": detail or None}


def rollout_needs(rr, args, tasks_dir, path, note, now, standing, memo, warns):
    """One live rollout's needs-you items: its gates, its set-asides only a person moves on, and its holds that wait on
    him (the module docstring's `needs-you`)."""
    try:
        linked, _index = rr._scan(path, tasks_dir)
    except OSError as e:
        # _scan raises on the first unreadable note anywhere under the tasks dir, Archive included, not only this
        # rollout's: whether it is one of this rollout's tasks cannot be read, so none of its items is listed
        warns.append(f"WARN: {path.stem}: a note under the tasks dir cannot be read ({e}): its items are not listed")
        return []
    slug, serial = path.stem, rr._shape(note) == "serial"
    label, root = project_label(rr, note), rr._project_root(note)
    gi = standing.gi
    out = []

    def project(t):
        return project_label(rr, t) if t.get_list("projects") else label

    for tp, t in sorted(linked, key=lambda e: e[0].stem.lower()):
        state, at = rr._queue_state(t)
        if state != "set-aside":
            continue
        if at == "gate":
            # approve-gates' own read of the section: with no gate it refuses (`nothing to sign off`), so only he
            # moves the task on, and it is one item, fail closed
            gates = [re.sub(r"^[-*]\s+", "", line.strip())
                     for line in t.section_text(rr.GATE_PENDING_SECTION).split("\n") if line.strip()]
            if not gates:
                out.append(needs_you_item("irreversible", "gate", slug, project(t), tp.stem,
                                          f"gate-pending, but its {rr.GATE_PENDING_SECTION} lists no gate",
                                          "sign off gated input", "approve-gates has nothing to sign off: list its "
                                          "gates there, or hand it back"))
            for gate in gates:
                kind = gi.gate_kind(gate)
                why = standing.asks(t, path, note, gate) if kind == "spend" else None
                if kind == "spend" and why is None:
                    continue   # the standing approval signs it: it never needs him
                out.append(needs_you_item(kind if kind in GATE_KINDS else "irreversible", "gate", slug, project(t),
                                          tp.stem, gate, "sign off gated input", why))
            continue
        reason = set_aside_reason(rr, t)
        kind = "sign-in" if PREFLIGHT_SIGN_IN_RE.match(reason) else "hands-on"
        if serial:
            out.append(needs_you_item(kind, "set-aside", slug, project(t), tp.stem, reason or f"set aside "
                                      f"({rr._status(t)})", "hand back or defer", rr.needs_human(t)))
            continue
        li = load_li(rr)
        # the lead's `inputs --repo <Project root>`, as reconcile-rollout.py auto-retry reads it
        inp = li.task_inputs(tp, t, repo=str(root) if root is not None else None)
        fix = li.auto_retry_verdict(tp, t, inp, note, now)["humanFix"]
        if fix is None:
            continue   # the lead's own re-entry: a retry, a cool-down, a seeded revise
        text = reason or fix["detail"] or f"set aside {fix['label']}"
        out.append(needs_you_item(kind, "set-aside", slug, project(t), tp.stem, text, fix["act"],
                                  fix["detail"] if fix["detail"] != text else None))
    if serial:
        return out
    holds = []
    ro_hold = rr._hold_until(note, root)
    if ro_hold is not None:
        holds.append((slug, "rollout", ro_hold))
    for tp, t in sorted(linked, key=lambda e: e[0].stem.lower()):
        if rr._queue_state(t)[0] in UNLANDED:
            h = rr._hold_until(t, root)
            if h is not None:
                holds.append((tp.stem, "task", h))
    notes = {tp.stem: t for tp, t in linked}
    for entry, reason in rr._resolve_holds(args.gh_bin, holds, memo) if holds else []:
        if not entry["held"] or entry["waits"] != "you":
            continue
        task = entry["note"] if entry["scope"] == "task" else None
        out.append(needs_you_item("hands-on", "hold", slug, project(notes[task]) if task else label, task, reason,
                                  f"remove or fix hold_until on [[{entry['note']}]]", entry["url"] or entry["error"]))
    record = rr._record_state(slug)
    for hold, task in sorted((record or {}).get("holds", ()), key=lambda h: (str(h[0]), str(h[1]))):
        if hold != "merge":
            continue
        t = rr._walk_of(tasks_dir).index.get(str(task).lower())
        pr = rr._pr(t[1]) if t else ""
        out.append(needs_you_item("hands-on", "hold", slug, project(t[1]) if t else label, t[0].stem if t else task,
                                  "merge hold: awaiting your go-ahead" + (f" ({pr})" if pr else ""),
                                  "go ahead or decline the merge"))
    return out


def cmd_needs_you(args, rr) -> int:
    """`needs-you` (p48-1): every open needs-you item across every rollout, one JSON line (the module docstring)."""
    tasks_dir = Path(os.path.expanduser(args.tasks_dir))
    if not tasks_dir.is_dir():
        die(f"tasks dir {tasks_dir} not found")
    now = now_of(args)
    warns, items, memo = [], [], {}
    standing = StandingRead(rr, tasks_dir, now)
    live = [(p, n) for p, n, _w in rollout_notes(rr, tasks_dir, archive=False) if rr._status(n) not in CLOSED]
    for path, note in sorted(live, key=lambda e: e[0].stem.lower()):
        items += rollout_needs(rr, args, tasks_dir, path, note, now, standing, memo, warns)
    walk = rr._walk_of(tasks_dir)
    for path, e in sorted(walk.errors, key=lambda x: x[0].stem.lower()):
        if path.parent == tasks_dir:   # a rollout note (rollout_notes skips it) or a left-out row, either way unread
            warns.append(f"WARN: {path.stem}: cannot be read ({e}): an item it holds is not listed")
    for path, note in sorted(walk.entries, key=lambda e: e[0].stem.lower()):
        if path.parent != tasks_dir or rr._status(note) != "open" or rr._live_rollout(tasks_dir, note.get("rollout")):
            continue
        tags = tags_of(rr, note)
        if "task" not in tags or "rollout" in tags:
            continue
        entries = log_entries(note.section_text(LEFT_OUT_SECTION))
        if entries:
            text = re.sub(r"^(?:[-*+]|\d+[.)])\s+", "", entries[-1])
            items.append(needs_you_item("sign-in", "left-out", None, project_label(rr, note), path.stem, text,
                                        "sign in, then /thread:orient --steer"))
    warns = list(dict.fromkeys(warns))
    for w in warns:
        print(w, file=sys.stderr)
    print(json.dumps({"count": len(items), "items": items, "warns": warns}, ensure_ascii=False))
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
    mine = {norm_project(rr, args.project)} - {""}

    def refused(line, errors):
        return finish(warns, line, 3, list(errors) + would_take(rr, args, tasks_dir, mine))

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
        return refused("refuse " + ",".join(c["slug"] for c in mineall), lines)
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
    return refused("refuse " + ",".join(keys), lines)


def cmd_branches(args, rr) -> int:
    """`branches` (ADR 0064; schedule step 5's Branch check): each named task's branch `audit-fix/<shortAlias(slug)>`
    against the unlanded tasks of every other unfinished parallel rollout on the same repo, and against the earlier
    named tasks. One `collide <slug> <branch> <[[rollout]] | -> [[<task>]]` line per collision, and one `unslug
    [[<task>]] <slug>` line per task whose name is not a slug (p47-6), else `none`."""
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
        if project_slug(x) != x:
            out.append(f"unslug [[{x}]] {project_slug(x) or '-'}")
            continue
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
    c = sub.add_parser("check", help="print none | supersede | interrupted | file | join | refuse for this repo or chain")
    c.add_argument("--shape", choices=("parallel", "serial"), default="parallel",
                   help="parallel (schedule § 0, the default) or serial (schedule § Serial path S3)")
    c.add_argument("--repo", default=None, help="the target repo (the path schedule § 0 resolved); parallel only")
    c.add_argument("--surface", action="append", default=None,
                   help="one of the chain's surface tokens, as serial-chains.py printed it (repeatable); serial only")
    c.add_argument("--checkout", action="append", default=None,
                   help="one of the chain's checkouts, as serial-chains.py printed it (repeatable); serial only")
    c.add_argument("--project", default=None, help="the project schedule targets (a name or [[wikilink]])")
    c.add_argument("--tasks", default=None, help="comma-separated task slugs (a --tasks run): their shared projects")
    c.add_argument("--regenerate", action="store_true", help="this run may supersede (schedule --regenerate)")
    c.add_argument("--resume", default=None,
                   help="a resuming rollout's slug (ADR 0060): its writes against what the others hold for it")
    c.add_argument("--surface-wait", dest="surface_wait", action="store_true",
                   help="execute § 4.5's Surface re-check only (--shape parallel --resume): it owns the rollout's "
                        "surface-wait marker (P41-3)")
    c.add_argument("--running", default=None,
                   help="with --surface-wait: the lead's live task-call and seeded-revise slugs, comma-separated "
                        "(\"\" when none)")
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
    cl.add_argument("--tasks", default=None, help="comma-separated task slugs (a --tasks run): a refusal names them")
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
    aw = sub.add_parser("awaited", help="whether anything builds each task a wait names (ADR 0082; close step 2)")
    aw.add_argument("--rollout", action="append", default=None,
                    help="a paused rollout's slug (repeatable): its ## Pause log links and its tasks' dependencies")
    aw.add_argument("--task", action="append", default=None, help="an awaited task's slug or [[wikilink]] (repeatable)")
    aw.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    wl = sub.add_parser("waiting", help="the Waiting list (ADR 0076): which serial chain starts next, and the room")
    wl.add_argument("--now", default=None, help="the clock for the Capacity, Away and lease reads (an ISO time)")
    wl.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    ny = sub.add_parser("needs-you", help="every open needs-you item across every rollout, as one list (p48-1)")
    ny.add_argument("--now", default=None, help="the clock for a cool-down and the standing approval's month (ISO)")
    ny.add_argument("--gh-bin", default="gh", help="the gh executable a hold_until's PR is read through (tests stub it)")
    ny.add_argument("--tasks-dir", default=str(DEFAULT_TASKS_DIR), help="task-note dir (default: the vault's Work/Tasks)")
    args = p.parse_args()
    if args.cmd == "check":
        # check --surface-wait's flags, validated before anything is loaded or touched, so a standing marker stays
        # byte-identical on any of these (P41-3).
        if args.surface_wait and (args.resume is None or args.shape == "serial"):
            die("--surface-wait is the parallel resume check's (--shape parallel --resume)")
        if args.surface_wait and args.running is None:
            die('--surface-wait needs --running <live slugs, "" when none>')
        if args.running is not None and not args.surface_wait:
            die("--running is --surface-wait's")
    rr = load_rr()
    # Every verb here writes no note (but check --surface-wait's marker, no note), so one walk of the tasks dir serves
    # the whole process (p41-2): each serial note's _scan, leg.py's Chain (sharing this rr) and this script's own reads
    # share it, and nothing outlives the process.
    rr._share_walks()
    verbs = {"running": cmd_running, "check": cmd_check, "pickups": cmd_pickups, "unstarted": cmd_unstarted,
             "hold": cmd_hold, "clone": cmd_clone, "branches": cmd_branches, "waiting": cmd_waiting,
             "awaited": cmd_awaited, "needs-you": cmd_needs_you}
    return verbs[args.cmd](args, rr)


if __name__ == "__main__":
    sys.exit(main())
