# Engine snapshot — which root a rollout's commands run from

The one rule for the root of every command that acts on a rollout (ADR 0043). Schedule, execute (§ 1.5), status,
repair, close (§ Under a Leg) and execute's `legs.md` cite this file instead of restating it. The script,
`skills/_shared/scripts/engine-snapshot.py`, is the one copy of the mechanics: its header states the stamp grammar,
the Primary test, the move rule, the prose-id rule and the retire keep-list; this file says when each applies. A
command taken from text read as a file runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## The engine root

Every command acting on a rollout runs with its **engine root**:

- the rollout's **Engine snapshot**, named on its note by `engine_snapshot:` (with `engine_sha:`);
- for a note that names none (scheduled before P29), the **Primary checkout**, when there is one (below)
  (reconcile-rollout.py's `_engine_reads_carried` reads that engine through `engine-snapshot.py`'s `engine_root`, its
  `git_primary` branch, the one copy of the mechanics, and keeps no copy of its own: ADR 0078 d1);
- otherwise the session's plugin root (a version-cache install).

The existing commands stay byte-identical: `${CLAUDE_PLUGIN_ROOT}` in them means the engine root, put in place of the
rendered root by the hand-over below. A session's rendered root is never a rollout's root by default: a Primary
checkout that moved (a pull, a branch, a dirty tree) reaches no rollout that runs on a snapshot.

## The Primary

`engine-snapshot.py`'s `git_primary()` (and `primary-hold.sh`, in bash, the same test). The plugin root counts only
when it is the toplevel of its own work tree: a version-cache copy, even one nested in another repo (the cache under
`~/.claude`, which is itself a git repo), has none, so `cut` exits 4 with no fetch and the rollout runs unstamped
from the plugin root. Only then is the Primary `dirname(--git-common-dir)`, which must itself be its own toplevel: the
root itself for a main checkout, and the main checkout for a snapshot or any other linked worktree.

## The hand-over and its prose id

`resolve` (and `cut`) print `prose: {verb, rootId, identical}`. The four rollout verbs (schedule, execute, status,
repair) carry git's `ident` attribute: each checkout expands the one prose-id marker in its hand-over block to the id
of that file as committed. The lead passes the hex it reads in the text it is following as `--prose-id`; a bare
`$Id$` (no hex) is no id, so it passes none.

- **identical** → keep following the text in hand, with the engine root in place of the rendered root in every
  command, file read, Workflow `scriptPath` and the heartbeat prompt.
- **not identical** → read `<root>/skills/<verb>/SKILL.md` as a file and follow it from § 1 (plugin-root.md).

Only the id carried by the text being followed counts, never a hash of a file on disk: the session rendered its
text when the plugin loaded, so a copy on disk may have moved since. The script never compares two copies on disk.
An edit made under an unchanged id line is caught when the running root's own copy still carries it.

## When resolve runs

Only at a verb's § 1 entry (a fresh invocation), and again after a compaction. A heartbeat, a cold resume, a Stage
re-send or a repair hand-off is no § 1 entry for a lead already in hand: it keeps the root it resolved.

## Another rollout's commands

A command on another rollout (schedule's ten prior-acting commands on a superseded rollout, a lineage read, a
close-out) runs from that rollout's own `resolve` root: the Primary for an unstamped prior, never this run's snapshot.
So does a write to a rollout from a session that runs none: orient-all's Sign-off (§ 4) resolves the task's
`rollout:` and runs `approve-gates --tasks <slug> --rollout <its note>` from the `root` that prints. One exception:
schedule's `join` (ADR 0078 d6) runs from this run's own root, since a running rollout's snapshot predates it; it is
guard-exempt and writes only the cross-version forms below (§ Cross-version state).

Schedule's Pre-flight scripts (`estate-scan.py`, `estate-dispatch.py` `slices`, `preflight`, `record`,
`decided-for-you` and `log`, `estate-rank.py rank`) run from the session's own root: they are unguarded and write no
rollout note, and `record`'s `## Decisions (asked ahead <date>)` bullet and `decided-for-you`'s `## Decided for you
(<date>)` bullet into a carried queued task are forms every engine reads as note text (ADR 0047 § Build rulings;
ADR 0054).

status's Carried line (status § 4), reflect § 17's carried read and close's `prove --tasks` also run
`reconcile-rollout.py prove` from the session's own root: prove is exempt from the guard and works across versions, so
the newest prove available reads every rollout's notes, whatever its engine (ADR 0078 d1).

## The refusal rule

The guarded scripts refuse a wrong root: exit 2, nothing written, and one stderr line starting `engine-snapshot:` that
names the root to re-run from. They are:

- `reconcile-rollout.py`, every verb but `status`, `fold-journals`, `moving`, `join` and `prove` (and `triggers`,
  which names no note): it asks about the note `--rollout` (carry:
  `--from`) names, which `lane-hold` and `lane-ack` always take, and the rollout each `--tasks` slug's note (and, for
  `reconcile`, each result row's) names in its `rollout:`, so a task-keyed verb with `--rollout` left off (`reconcile`,
  `hand-back`, `mark-started`, `mark-integrating`, `origin-wait`, `mark-done`, `log-integration`, `bind-run`, `free-lane`, `hold`,
  `defer`, `approve-gates`) is guarded too;
- `git-env-canary.py`, `step-boundary.py begin` and `end`, `leg.py` but `status`, `close-score.py`,
  `lead-integrate.py prepare` and `set-aside`, `merge-settings.py` but `rows` (ADR 0080: `free`, `restore` and
  `dismiss`, on the rollout the task note names), and `merge-task.sh` through `guard-pr`.

The exemptions run from any root: `reconcile-rollout.py status` writes nothing (status and the estate scan read every
rollout with it); `moving` writes nothing either, and is the Watchdog's reading of any rollout from any root (status §
The Watchdog's reading); `fold-journals` reads the note only for its role-call gate and writes only call-journal and
role-call lines to the Run record, cross-version state (below), a role-call line only where the rollout's engine reads
the kind; `join` (ADR 0078 d6) is run by a newer `/thread:schedule` on this project's running
rollout, whose snapshot predates the verb, and writes only the forms § Cross-version state names for it, under the same
note lock; `prove` writes only proof stamps, which every engine reads as landed, and gates each write a queue reads per
note on `_carry_readers` (the note's own rollout and the rollouts of its unstarted dependants): when that gate reads
False, `--land` and its readers re-check write the old engine's own form (owed, `status: done`) and a carry-back waits,
so it works across versions by design, like `fold-journals` (ADR 0078 d1; vault-grammar § Proven);
`reconcile-rollout.py triggers` names no note (no `--rollout`, no `--tasks`), so the guard finds nothing to ask about
and it runs from any root, unguarded: `due` writes nothing and `fire` writes only the `fired:` of the one `when:` entry
it ran; `step-boundary.py stands`, `leg.py status`, and `lead-integrate.py inputs` and `plan` only read; and
`lead-integrate.py verify`, `push` and `undo` follow a guarded `prepare` in one flow.

An `engine-snapshot:` line, whatever its exit code, means a wrong root, never the script's own failure: re-run the
same command once from the root it names. An unstamped note, an archived note whose snapshot is gone, and a task
note that names no rollout pass from any root; a live note whose snapshot is gone, moved or edited refuses with the
reason and the remedy.

## Schedule's cut

`/thread:schedule`'s first step runs `cut`: a fresh `git fetch` of origin's default branch and a detached, locked
worktree at `<primary>-snapshots/<sha12>`, shared by every rollout cut at that tip. Never the Primary's HEAD or
working tree: a branch, an unpushed commit or a stale `origin/<default>` there reaches no rollout. Schedule then
writes the note, its queue and its task stamps with the snapshot's own scripts, and `adopt`, run from the snapshot,
stamps the note. A cut exit 4 (no git Primary) stamps nothing.

## The Reinstate's move

A rollout moves onto a newer snapshot only at its Reinstate, when `resolve` prints `move.due: true`:

- **parallel:** a hard pause (`paused:` with no `paused_for:`, no `superseded_by:`, status neither done nor dropped),
  then `/thread:execute`;
- **serial:** the first Leg begun after a Leg whose close was `stopped` (`skills/execute/legs.md` § Close maps "pause
  the rollout" and "stop the chain" to it); a halted, stuck, lost or handed-off Leg moves nothing for a stamped chain.
- **unstamped:** (no `engine_snapshot:`, scheduled before P29 or by a cut exit 4): stamped at the parallel moment, and
  for a serial chain at its first Leg or the first Leg begun after any close, never while a Leg is open (a resume or
  a take-over: that Leg stays on the Primary until it closes); with no git Primary (a version-cache install) never
  due, so nothing is cut.

Execute § 1.5 then runs `cut`, the new snapshot's `adopt` and `resolve` again, once per invocation. A sign-off pause
never moves: `paused_for: sign-off` (ADR 0034) is the engine's own pause, not Lachy's moment, so `move.due` is false
and its reinstate keeps the signed-gate handles and their cache replay. To move a rollout that awaits sign-off, sign
or defer its gates and reinstate it; the next hard pause, then `/thread:execute`, is its move point. On a move or a
first stamp (adopt's `changed: true`), the lead drops its runIds and signed-gate handles from the old snapshot's calls
(a first stamp's are the Primary checkout's): they restart fresh. Nothing else moves a rollout: no launch, heartbeat,
cold resume, Stage re-send or repair hand-off, and never the lead's own judgement; the Leg a launch or hand-off starts
resolves at its own § 1 entry, so the stamp is that Leg's.

## Retirement

`retire` runs after the completion ceremony's vault commit (execute § 4.5 step 5, `skills/execute/legs.md` § Complete
step 4, both templates' step 6) and, best-effort, inside every `cut`. It keeps, under the snapshots home's lock:

- its own root, and a snapshot a cut just made;
- a snapshot any live note names (outside `Archive/`), a hard-paused one or one past its last merge included;
- a snapshot an `Archive/Rollouts/` note names while that note's mtime is within the grace (24 h): `kept <sha12>:
  archived [[<slug>]] within 24h`, so no other session's sweep removes it between a Complete's archive and its
  `/thread:close`;
- an unnamed snapshot whose `.cut` marker is younger than the grace (a schedule still running);
- everything, when the tasks dir is missing or unreadable, a live note cannot be read, or `Archive/Rollouts/` cannot
  be listed.

The rest is unlocked, removed and pruned. A Leg's close re-resolves when its root no longer holds
`skills/execute/scripts/leg.py` (a snapshot retired after its grace, or an archived note's mtime a copy reset): an
archived note whose snapshot is gone resolves to the unstamped root, where the guard passes (close § Under a Leg).

## Cross-version state

Two rollouts can run on two snapshots at once, and a Reinstate crosses versions, so these stay readable across
versions and change only by migration (engine-snapshot.py's `MIGRATIONS`, run by `adopt` at a move): the machine-wide
state (verify slots, the Trickle's count, `~/.config/thread/*`); a rollout's own canary records, Run record lines and
note lines; and what a cross-rollout reader reads (the Run record, the notes the Trickle counts, the Watchdog's
reads). `rollouts.toml` carries a top-level `schema`: an older reader ignores a newer file's unknown key and still
refuses a typo, and every writer that adds a newer key raises the line (rollout-settings.py's header). `inert_paths`
(p29-3, ADR 0045) is the first schema-2 key: an older snapshot ignores it and re-runs its verifier, and inert-paths.py's
`record` refuses to raise the line while a live rollout's engine root cannot read the new file. `test_credentials` (ADR
0063) is the first schema-3 key: an older snapshot ignores it, so its rollouts ask every credential gate as before. `test_logins` (p37-4) is the first schema-5 key: an older snapshot ignores it, so its rollouts ask the Login gate as before. The plugin's
hooks run from the Primary checkout, not a snapshot, so the Stop-hook driver's `STATUS_RE` and the `ROLLOUT-STATUS`
line it parses are a cross-version contract (hooks/rollout-stop-driver.py). The stamps themselves are read only by
`resolve`, the guards, `unfinished-rollout.py running` (ADR 0031's hold, now only for an unsnapshotted rollout) and
`retire`. The standing approval's month line (ADR 0034's 2026-10-27 amendment) is cross-rollout state too: its
`signed under the standing approval:` lines in each rollout note's `## Needs-you log` and its machine-wide
`standing-spend.lock` keep their form across versions. A snapshot older than that amendment writes no such line and
takes no lock, so its signings stay outside the month sum until its rollout moves or retires. The origin lane
(ADR 0064) is cross-rollout state as well: `mark-integrating` and `origin-wait` read other rollouts' notes, leases and
Run records, and the machine-wide `origin-lane.lock` and `origin-lane.json` (its waiting list, `version: 1`, read as the
Trickle claims file is) beside the note locks keep their form across versions. A rollout on a snapshot older than that
change runs its own `mark-integrating`, which has no origin lane: it never checks, waits or writes an entry. From p28-4
on its engine writes a lease and `lane-taken`, so while it integrates it reads as a holder to a newer rollout, which
waits; it never waits for the newer one, so the two can integrate at once, and merge-task's base pin keeps every merge
correct (exit 3 re-integrates the second). An engine older than leases leaves lease state `none` and never holds.
The Trickle claims file's `woken` list (p28-9) widens it at `version: 1`, as `waiting` did: a snapshot from before p28-9
ignores it and drops it on rewrite, which costs a waiting lead only its wake (it re-checks at its trickle wait's timeout
or its tick). `ladder.toml` is machine-wide state with no `schema`: each running rollout reads it through its own
snapshot's `ladder.py`, whose validation refuses every key added after its cut (`plan` and `[role]` before ADR 0079,
`[share]` before p46-2), and a refused ladder halts that rollout at its next call. So a file that uses a newer key is
written only once every live rollout's engine root reads it: for each, `HOME=<tmp> python3 <its
root>/skills/_shared/scripts/ladder.py` with the candidate file at `<tmp>/.config/thread/ladder.toml` exits 0; else wait
for those rollouts to finish or move (ladder.py's docstring, *Across versions*). A task note's `arms:` stamp and a
rollout note's `arms: lead=…` (p46-2) are note lines an older engine ignores. A `role-call` Run record line (p46-2) is
not: an engine from before it reads one as a live line, task activity and the record's tail (`record-entry`'s
`NOT_LIVE_KINDS`, `score.py`'s `pair`, `ledger.py`'s `NOT_TAIL`), so a role-call stamped after a heartbeat would move
the time of a `dead-lead` stop. `fold-journals` runs from any root (every Reflection runs it from the newest), so it
writes role-call lines into a rollout's record only when that rollout's engine reads the kind
(`_engine_reads_role_call`, by the clauses `prove`'s `_engine_reads_carried` keeps for a carried fix: the
`ROLE_CALL_ENGINE` line in its `engine_snapshot:` root's `reconcile-rollout.py`, or in the root an unstamped note runs
on; a finished rollout, or no note, reads it). A fold the gate holds back still writes the call-journal line, and
prints `no role-call for <n> segments: <why>`. Those segments are lost: a later fold reopens a terminal call only when a
resume was bound after its last fold, and then reads only the journal the resume rewrote. So of the calls folded while
a rollout's engine predates the kind, only a resumed call's latest segment can still be written, by a fold after the
rollout moves to an engine that reads it or finishes.

Schedule's `join` (ADR 0078 d6) writes a running rollout's note from a newer root, so its forms are a cross-version
contract:

- the `## Queue` row `| <n> | [[<slug>\|<alias>]] | <scope> | joined <YYYY-MM-DD> |`, or `joined <YYYY-MM-DD>, solo`
  for a Solo task, and the list form `- [[<slug>|<alias>]] — joined <YYYY-MM-DD>`. Every engine reads the row only as a
  wikilink on a ranked line (RANKED_LINE_RE), and the weekly reading leaves a Mode starting `joined ` out of a wait to
  start (attention.py);
- the `- <slug>: a, b` `## File-sets` line (FILESET_RE);
- the task's `rollout: "[[<slug>]]"` stamp (`_scan`'s backlink);
- and the note lock it takes (`_note_lock_path`).

They change only by migration.
