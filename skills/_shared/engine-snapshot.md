# Engine snapshot — which root a rollout's commands run from

The one rule for the root of every command that acts on a rollout (ADR 0043). Schedule, execute (§ 1.5), status,
repair, close (§ Under a Leg) and execute's `legs.md` cite this file instead of restating it. The script,
`skills/_shared/scripts/engine-snapshot.py`, is the one copy of the mechanics: its header states the stamp grammar,
the Primary test, the move rule, the prose-id rule and the retire keep-list; this file says when each applies. A
command taken from text read as a file runs by `${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md`.

## The engine root

Every command acting on a rollout runs with its **engine root**:

- the rollout's **Engine snapshot**, named on its note by `engine_snapshot:` (with `engine_sha:`);
- for a note that names none (scheduled before P29), the **Primary checkout**, when there is one (below);
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

A command on another rollout (schedule's nine prior-acting commands on a superseded rollout, a lineage read, a
close-out) runs from that rollout's own `resolve` root: the Primary for an unstamped prior, never this run's snapshot.
So does a write to a rollout from a session that runs none: orient-all's Sign-off (§ 4) resolves the task's
`rollout:` and runs `approve-gates --tasks <slug> --rollout <its note>` from the `root` that prints.

## The refusal rule

The guarded scripts refuse a wrong root: exit 2, nothing written, and one stderr line starting `engine-snapshot:` that
names the root to re-run from. They are:

- `reconcile-rollout.py`, every verb but `status` and `fold-journals`: it asks about the note `--rollout` (carry:
  `--from`) names, and the rollout each `--tasks` slug's note (and, for `reconcile`, each result row's) names in its
  `rollout:`, so a task-keyed verb with `--rollout` left off (`reconcile`, `hand-back`, `mark-started`,
  `mark-integrating`, `mark-done`, `log-integration`, `bind-run`, `free-lane`, `hold`, `defer`, `approve-gates`) is
  guarded too;
- `git-env-canary.py`, `step-boundary.py begin` and `end`, `leg.py` but `status`, `close-score.py`,
  `lead-integrate.py prepare` and `set-aside`, and `merge-task.sh` through `guard-pr`.

The exemptions run from any root: `reconcile-rollout.py status` writes nothing (status and the estate scan read every
rollout with it); `fold-journals` never reads the note and writes only call-journal lines to the Run record,
cross-version state (below); `step-boundary.py stands`, `leg.py status`, and `lead-integrate.py inputs` and `plan`
only read; and `lead-integrate.py verify`, `push` and `undo` follow a guarded `prepare` in one flow.

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
  the rollout" and "stop the chain" to it); a halted, stuck, lost or handed-off Leg moves nothing.

Execute § 1.5 then runs `cut`, the new snapshot's `adopt` and `resolve` again, once per invocation. A sign-off pause
never moves: `paused_for: sign-off` (ADR 0034) is the engine's own pause, not Lachy's moment, so `move.due` is false
and its reinstate keeps the signed-gate handles and their cache replay. To move a rollout that awaits sign-off, sign
or defer its gates and reinstate it; the next hard pause, then `/thread:execute`, is its move point. On a move, the
lead drops its runIds and signed-gate handles from the old snapshot's calls: they restart fresh. Nothing else moves a
rollout: no launch, heartbeat, cold resume, Stage re-send or repair hand-off, and never the lead's own judgement.

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
refuses a typo, and every writer that adds a newer key raises the line (rollout-settings.py's header). The plugin's
hooks run from the Primary checkout, not a snapshot, so the Stop-hook driver's `STATUS_RE` and the `ROLLOUT-STATUS`
line it parses are a cross-version contract (hooks/rollout-stop-driver.py). The stamps themselves are read only by
`resolve`, the guards, `unfinished-rollout.py running` (ADR 0031's hold, now only for an unsnapshotted rollout) and
`retire`.
